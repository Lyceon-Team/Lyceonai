/**
 * Review pool: which questions a review session is built from.
 *
 * @spec [Doc-02B_V4 §16; ruled plan §2 rows 1-4, rulings 3/7/15/18/19; brief R3 §2.3/§2.4]
 * @implemented [2026-09-21]
 *
 * plain English: review is practice with a different pool, and this file IS the
 * different pool. Everything else in the vertical is practice's code. What it does:
 * reads the student's OPEN queue entries, joins them to `servable_questions`, narrows
 * by mode, and hands back an ordered list ready to snapshot. expected outcome: oldest
 * mistake first, never a retired or issue-flagged question, never a question the queue
 * has already closed. trade-offs and edge cases are on each function.
 *
 * THE ANTI-RAW-BANK RULE (ruling 19, enforced by
 * tests/ci/runtime-materialization-law.ci.test.ts): no review code reads `questions`.
 * The only question source in this file is `servable_questions`, which is `questions`
 * filtered to published-and-not-issue-flagged. A retired question keeps its queue entry
 * (ruling 18) and simply stops being poolable.
 *
 * THE QUEUE IS READ-ONLY HERE. `review_schedule` has exactly two writers, both database
 * triggers installed by 20260921000000_review_queue_runtime.sql. Nothing in R3 inserts,
 * updates or deletes a queue row, and the absence of a write is deliberate: routing the
 * queue through the API would reintroduce the race the advisory lock in
 * `review_queue_record` exists to prevent.
 */

import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import type {
  ReviewFilterSpec,
  ReviewPoolSpec,
  ReviewPoolSummaryResponse,
  ReviewSourceEngine,
} from "@lyceon/shared";
import {
  mapGenesisQuestionRow,
  isCanonicalRuntimeQuestion,
  type CanonicalQuestionRowLike,
} from "../../shared/question-bank-contract";
import {
  toCanonicalQuestionForServing,
  type CanonicalQuestionForServing,
} from "../routes/practice-canonical";

const COMPONENT = "REVIEW_POOL";

/**
 * The 16 columns `select_practice_pool_random` returns
 * (genesis-schema.expected.sql:6558-6574). Review reads the same set from the same
 * view so `mapGenesisQuestionRow` -> `toCanonicalQuestionForServing` behaves
 * identically for both engines. Answer-bearing columns are present because the
 * SNAPSHOT needs them for grading; they are stripped on the way to the client by
 * `toStudentSafeQuestionDTO`, which is the single chokepoint for that (Coding
 * Standards §5.2).
 */
const SERVABLE_SELECT =
  "id, section, stem, options, difficulty, correct_answer, explanation, domain, skill_codes, source_type, item_type, correct_variants, passage, assets, option_metadata, estimated_time_seconds";

/** Postgrest `.in()` is a URL filter, so the id list is chunked rather than unbounded. */
const ID_CHUNK = 200;

export type ReviewQueueEntry = {
  id: string;
  question_id: string;
  queued_at: string;
  source_engine: string;
  source_session_id: string;
};

export type ReviewPoolRow = {
  entry: ReviewQueueEntry;
  question: CanonicalQuestionForServing;
  /** Kept for the pool summary's facets; the snapshot does not use it. */
  skillCodes: string[];
};

export type ReviewPoolResult =
  | { ok: true; value: ReviewPoolRow[] }
  | { ok: false; error: string };

/**
 * @spec [ruled plan ruling 12; brief R3 §2.3] | @implemented [2026-09-21]
 * plain English: every queue entry still open for this student, oldest first.
 * expected outcome: at most one row per question, because
 * `uq_review_schedule_open_question` allows only one active entry per (student,
 * question). trade-offs: the whole open queue is read into memory; production's queue
 * is 79 rows and the per-student ceiling is the size of the question bank, so paging
 * would be complexity without a payer. edge cases: ordering is `queued_at` then
 * `question_id` (ruling 7 — oldest first), and the `question_id` tiebreak is what makes
 * two entries queued in the same transaction deterministic rather than arbitrary.
 */
async function loadOpenQueueEntries(
  studentId: string,
): Promise<
  { ok: true; value: ReviewQueueEntry[] } | { ok: false; error: string }
> {
  const { data, error } = await supabaseServer
    .from("review_schedule")
    .select("id, question_id, queued_at, source_engine, source_session_id")
    .eq("student_id", studentId)
    .eq("status", "active")
    .order("queued_at", { ascending: true })
    .order("question_id", { ascending: true });

  if (error) {
    return { ok: false, error: `review_queue_read_failed: ${error.message}` };
  }
  return { ok: true, value: (data ?? []) as ReviewQueueEntry[] };
}

/**
 * @spec [brief R3 §2.3 "session" mode] | @implemented [2026-09-21]
 * plain English: the set of questions this student ever queued FROM one past session,
 * whatever state those entries are in now. expected outcome: combined with the open-
 * entry list, it selects "missed in that session, and still open" — which keeps a
 * question that was missed there, graduated, and missed again later, because the later
 * miss is the open entry while the earlier one carries the session provenance.
 * trade-offs: two reads instead of a join, because PostgREST cannot embed a view.
 * edge cases: `full_length` is a valid engine with no rows yet (ruling 6); it returns
 * an empty set and the caller lands on the ordinary empty-pool response, no special case.
 */
async function loadQuestionIdsFromSourceSession(
  studentId: string,
  sourceEngine: ReviewSourceEngine,
  sourceSessionId: string,
): Promise<{ ok: true; value: Set<string> } | { ok: false; error: string }> {
  const { data, error } = await supabaseServer
    .from("review_schedule")
    .select("question_id")
    .eq("student_id", studentId)
    .eq("source_engine", sourceEngine)
    .eq("source_session_id", sourceSessionId);

  if (error) {
    return {
      ok: false,
      error: `review_queue_source_read_failed: ${error.message}`,
    };
  }
  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ question_id?: unknown }>) {
    if (typeof row.question_id === "string") ids.add(row.question_id);
  }
  return { ok: true, value: ids };
}

/**
 * @spec [ruled plan ruling 18/19] | @implemented [2026-09-21]
 * plain English: fetch the servable row for each candidate question. expected outcome:
 * a map keyed by question id, missing exactly the questions that are no longer
 * servable. trade-offs: chunked `.in()` rather than one giant URL. edge cases: an empty
 * id list short-circuits without a round trip.
 */
async function loadServableQuestions(
  questionIds: string[],
): Promise<
  | { ok: true; value: Map<string, CanonicalQuestionRowLike> }
  | { ok: false; error: string }
> {
  const out = new Map<string, CanonicalQuestionRowLike>();
  for (let i = 0; i < questionIds.length; i += ID_CHUNK) {
    const chunk = questionIds.slice(i, i + ID_CHUNK);
    if (chunk.length === 0) continue;
    const { data, error } = await supabaseServer
      .from("servable_questions")
      .select(SERVABLE_SELECT)
      .in("id", chunk);
    if (error) {
      return {
        ok: false,
        error: `servable_questions_read_failed: ${error.message}`,
      };
    }
    for (const raw of (data ?? []) as CanonicalQuestionRowLike[]) {
      const mapped = mapGenesisQuestionRow(raw);
      const id =
        typeof mapped.canonical_id === "string" ? mapped.canonical_id : null;
      if (id) out.set(id, mapped);
    }
  }
  return { ok: true, value: out };
}

/** Practice's difficulty-token mapping, verbatim (practice-canonical.ts:1519-1521). */
function difficultyTokenToInt(token: string): number {
  return token === "easy" ? 1 : token === "hard" ? 3 : 2;
}

/**
 * `select_practice_pool_random`'s WHERE clause, expressed over one already-fetched row
 * (genesis-schema.expected.sql:6576-6580). Same four predicates, same semantics:
 * section/domain/difficulty are membership, skills is ARRAY OVERLAP (`&&`), and an
 * empty filter list means "no constraint" rather than "match nothing".
 */
function matchesFilter(
  row: CanonicalQuestionRowLike,
  skillCodes: string[],
  filter: ReviewFilterSpec,
): boolean {
  const sections = (filter.sections ?? []).filter((s) => s.length > 0);
  const domains = (filter.domains ?? []).filter((s) => s.length > 0);
  const skills = (filter.skills ?? []).filter((s) => s.length > 0);
  const difficulties = (filter.difficulties ?? [])
    .filter((s) => s.length > 0)
    .map(difficultyTokenToInt);

  const section =
    typeof row.section_code === "string" ? row.section_code : null;
  const domain = typeof row.domain === "string" ? row.domain : null;
  const difficulty = typeof row.difficulty === "number" ? row.difficulty : null;

  if (sections.length > 0 && (!section || !sections.includes(section)))
    return false;
  if (domains.length > 0 && (!domain || !domains.includes(domain)))
    return false;
  if (
    difficulties.length > 0 &&
    (difficulty === null || !difficulties.includes(difficulty))
  )
    return false;
  if (skills.length > 0 && !skillCodes.some((code) => skills.includes(code)))
    return false;
  return true;
}

function readSkillCodes(row: CanonicalQuestionRowLike): string[] {
  const raw = (row as { skill_codes?: unknown }).skill_codes;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is string => typeof c === "string" && c.trim().length > 0,
  );
}

/**
 * @spec [brief R3 §2.3; ruled plan §2 row 1] | @implemented [2026-09-21]
 *
 * plain English: the review pool. Open queue entries, joined to servable questions,
 * narrowed by mode, oldest first. expected outcome: the exact list a review session is
 * prefilled from, and the same list the pool summary counts.
 *
 * trade-offs: two reads and an in-memory join rather than one SQL join. PostgREST
 * cannot embed `servable_questions` (a view with no inferable FK from review_schedule),
 * and the alternative — a new SQL function — means another migration for an owner to
 * apply before an API PR can ship. The join key is a primary key and the pool is
 * bounded by the student's open queue, so the cost is one extra round trip.
 *
 * edge cases:
 *   - a question open in ANOTHER review session is NOT excluded (ruling 15); practice
 *     excludes in-flight questions and review deliberately does not;
 *   - a row that is servable but cannot fill review's NOT NULL snapshot columns is
 *     dropped and logged, see `isSnapshottable`;
 *   - `full_length` source sessions are accepted and yield nothing until the exam
 *     vertical writes to the queue (ruling 6).
 */
export async function buildReviewPool(args: {
  studentId: string;
  poolSpec: ReviewPoolSpec;
  requestId?: string;
}): Promise<ReviewPoolResult> {
  const entriesResult = await loadOpenQueueEntries(args.studentId);
  if (!entriesResult.ok) return entriesResult;
  let entries = entriesResult.value;

  if (args.poolSpec.mode === "session") {
    const idsResult = await loadQuestionIdsFromSourceSession(
      args.studentId,
      args.poolSpec.source.source_engine,
      args.poolSpec.source.source_session_id,
    );
    if (!idsResult.ok) return idsResult;
    const fromSession = idsResult.value;
    entries = entries.filter((e) => fromSession.has(e.question_id));
  }

  if (entries.length === 0) return { ok: true, value: [] };

  const servableResult = await loadServableQuestions(
    entries.map((e) => e.question_id),
  );
  if (!servableResult.ok) return servableResult;
  const servable = servableResult.value;

  const rows: ReviewPoolRow[] = [];
  let droppedNonServable = 0;
  let droppedUnsnapshottable = 0;

  for (const entry of entries) {
    const raw = servable.get(entry.question_id);
    if (!raw) {
      droppedNonServable += 1;
      continue;
    }
    if (!isCanonicalRuntimeQuestion(raw)) {
      droppedUnsnapshottable += 1;
      continue;
    }
    const skillCodes = readSkillCodes(raw);
    if (
      args.poolSpec.mode === "filter" &&
      !matchesFilter(raw, skillCodes, args.poolSpec.filter)
    ) {
      continue;
    }
    const question = toCanonicalQuestionForServing(raw);
    if (!isSnapshottable(question)) {
      droppedUnsnapshottable += 1;
      continue;
    }
    rows.push({ entry, question, skillCodes });
  }

  if (droppedNonServable > 0 || droppedUnsnapshottable > 0) {
    // Counts only. A question id is bank metadata, not student content, but there is
    // no reason to emit it here and every reason not to grow the habit.
    logger.info(
      COMPONENT,
      "pool_rows_dropped",
      "Review pool dropped queue entries",
      {
        droppedNonServable,
        droppedUnsnapshottable,
        poolMode: args.poolSpec.mode,
        requestId: args.requestId,
      },
    );
  }

  return { ok: true, value: rows };
}

/**
 * @spec [20260921000000_review_queue_runtime.sql:229-249; brief R3 §2.3] | @implemented [2026-09-21]
 *
 * plain English: can this question fill every NOT NULL column of
 * `review_session_items`? expected outcome: a question that cannot is left in the
 * queue and left out of the session, instead of aborting the whole create with a 23502.
 *
 * WHY REVIEW NEEDS THIS AND PRACTICE DOES NOT. `review_session_items` inherited its
 * snapshot columns from 20260610020000, where stem, options, correct_answer,
 * explanation, domain, skill, difficulty and section are all NOT NULL;
 * `practice_session_items` declares the same eight nullable. R2 altered the review
 * table in place and did not relax them. `questions` guarantees seven of the eight,
 * but `skill_codes` is `text[] NOT NULL` with no length constraint, so an empty array
 * yields a null skill — which practice tolerates and review's schema refuses.
 *
 * trade-offs: silently shrinking a pool is its own hazard, which is why the caller
 * logs a count. edge cases: this is the same posture as practice's own validity filter
 * (`isCanonicalRuntimeQuestion`, practice-canonical.ts:1553) — drop the unusable row,
 * then let the empty-pool response speak if nothing survives. It is a wider predicate,
 * not a different one.
 */
function isSnapshottable(question: CanonicalQuestionForServing): boolean {
  if (!question.stem || question.stem.trim().length === 0) return false;
  if (!question.section_code) return false;
  if (!question.domain) return false;
  if (!question.skill || question.skill.trim().length === 0) return false;
  if (question.difficulty === null || question.difficulty === undefined)
    return false;
  if (!question.correct_answer) return false;
  if (!question.explanation || question.explanation.trim().length === 0)
    return false;
  return true;
}

// ---------------------------------------------------------------------------
// Pool summary (brief R3 §2.4)
// ---------------------------------------------------------------------------

/**
 * @spec [brief R3 §2.4; ruling 20] | @implemented [2026-09-21]
 * plain English: validate an IANA zone without touching the database. expected
 * outcome: the requested zone when it is real, UTC otherwise, and never a throw.
 * trade-offs: brief R3 §2.4 says validate against `pg_timezone_names`. That relation
 * is not reachable through PostgREST, and adding an RPC for it means another migration
 * before an API-layer PR can ship. `Intl` resolves against the same IANA database the
 * server's zoneinfo provides, so the answer is the same one Postgres would give.
 * edge cases: an empty or absent `tz` is not an error — it is the default, and
 * `fallback` stays false so the caller does not log a non-event.
 */
export function resolveTimeZone(tz: string | null | undefined): {
  timeZone: string;
  fallback: boolean;
} {
  const candidate = tz?.trim();
  if (!candidate) return { timeZone: "UTC", fallback: false };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(
      new Date(),
    );
    return { timeZone: candidate, fallback: false };
  } catch {
    // Not swallowed: the caller logs it, and the whole point is that an unknown zone
    // degrades to UTC rather than 500ing a picker (Coding Standards §13).
    return { timeZone: "UTC", fallback: true };
  }
}

function localParts(
  iso: string | null,
  timeZone: string,
): { date: string | null; time: string | null } {
  if (!iso) return { date: null, time: null };
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return { date: null, time: null };
  try {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsed);
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(parsed);
    return { date, time };
  } catch {
    return { date: null, time: null };
  }
}

function tally(
  counts: Map<string, number>,
  key: string | null | undefined,
): void {
  if (!key) return;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function toFacets(
  counts: Map<string, number>,
): Array<{ key: string; count: number }> {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * @spec [brief R3 §2.4; ruling 20] | @implemented [2026-09-21]
 *
 * plain English: one read that answers both pickers — how many open questions there
 * are, how they break down by section/domain/skill, and which past sessions still have
 * open entries. expected outcome: R4 renders "Thu, Sep 17 → Practice · 2:40 PM · Math ·
 * Algebra · 4 to review" from these fields; nothing is stored pre-formatted.
 *
 * trade-offs: it computes the facets from the FULL pool (mode `queue`), so the counts
 * describe what each filter would actually yield rather than what the queue contains
 * before the servable join — a count that promised four and delivered three would be
 * worse than no count.
 *
 * edge cases: a source session whose parent row has been deleted still appears, with
 * `created_at`, `mode` and `filters` null and its `open_count` intact — the entries are
 * real even when the session that produced them is gone.
 */
export async function buildReviewPoolSummary(args: {
  studentId: string;
  tz: string | null | undefined;
  requestId?: string;
}): Promise<
  { ok: true; value: ReviewPoolSummaryResponse } | { ok: false; error: string }
> {
  const { timeZone, fallback } = resolveTimeZone(args.tz);
  if (fallback) {
    logger.warn(
      COMPONENT,
      "timezone_fallback",
      "Unrecognised IANA timezone on review pool summary; falling back to UTC",
      { requestId: args.requestId },
    );
  }

  const poolResult = await buildReviewPool({
    studentId: args.studentId,
    poolSpec: { mode: "queue" },
    requestId: args.requestId,
  });
  if (!poolResult.ok) return poolResult;
  const pool = poolResult.value;

  const bySection = new Map<string, number>();
  const byDomain = new Map<string, number>();
  const bySkill = new Map<string, number>();
  const openBySource = new Map<
    string,
    { engine: string; sessionId: string; count: number }
  >();

  for (const row of pool) {
    tally(bySection, row.question.section_code);
    tally(byDomain, row.question.domain ?? null);
    tally(bySkill, row.question.skill ?? null);
    const key = `${row.entry.source_engine}:${row.entry.source_session_id}`;
    const existing = openBySource.get(key);
    if (existing) existing.count += 1;
    else
      openBySource.set(key, {
        engine: row.entry.source_engine,
        sessionId: row.entry.source_session_id,
        count: 1,
      });
  }

  const sessions = await describeSourceSessions(
    [...openBySource.values()],
    timeZone,
  );

  return {
    ok: true,
    value: {
      total: pool.length,
      timezone: timeZone,
      timezoneFallback: fallback,
      bySection: toFacets(bySection),
      byDomain: toFacets(byDomain),
      bySkill: toFacets(bySkill),
      sessions,
    },
  };
}

/**
 * Reads the parent session rows so the picker can show when a batch of mistakes was
 * made and what it was. Practice and review sessions live in different tables and
 * full-length has none yet, hence the per-engine branch. Newest first (brief §2.4).
 */
async function describeSourceSessions(
  sources: Array<{ engine: string; sessionId: string; count: number }>,
  timeZone: string,
): Promise<ReviewPoolSummaryResponse["sessions"]> {
  const practiceIds = sources
    .filter((s) => s.engine === "practice")
    .map((s) => s.sessionId);
  const reviewIds = sources
    .filter((s) => s.engine === "review")
    .map((s) => s.sessionId);

  const meta = new Map<
    string,
    { created_at: string | null; mode: string | null; filters: unknown }
  >();

  if (practiceIds.length > 0) {
    const { data } = await supabaseServer
      .from("practice_sessions")
      .select("id, created_at, mode, filters")
      .in("id", practiceIds);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      meta.set(`practice:${String(row.id)}`, {
        created_at: typeof row.created_at === "string" ? row.created_at : null,
        mode: typeof row.mode === "string" ? row.mode : null,
        filters: row.filters ?? null,
      });
    }
  }

  if (reviewIds.length > 0) {
    const { data } = await supabaseServer
      .from("review_sessions")
      .select("id, created_at, mode, filters")
      .in("id", reviewIds);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      meta.set(`review:${String(row.id)}`, {
        created_at: typeof row.created_at === "string" ? row.created_at : null,
        mode: typeof row.mode === "string" ? row.mode : null,
        filters: row.filters ?? null,
      });
    }
  }

  const described = sources.map((source) => {
    const found = meta.get(`${source.engine}:${source.sessionId}`) ?? {
      created_at: null,
      mode: null,
      filters: null,
    };
    const parts = localParts(found.created_at, timeZone);
    return {
      source_engine: source.engine as ReviewSourceEngine,
      source_session_id: source.sessionId,
      created_at: found.created_at,
      local_date: parts.date,
      local_time: parts.time,
      mode: found.mode,
      filters: found.filters,
      open_count: source.count,
    };
  });

  // Newest first. A session with no surviving parent row sorts last rather than
  // first — an unknown date is not a recent one.
  return described.sort((a, b) => {
    if (a.created_at === b.created_at) return 0;
    if (a.created_at === null) return 1;
    if (b.created_at === null) return -1;
    return a.created_at < b.created_at ? 1 : -1;
  });
}
