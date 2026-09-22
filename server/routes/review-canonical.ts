/**
 * Review engine routes — practice's loop, pointed at the review tables.
 *
 * @spec [Doc-02B_V4 §16; ruled plan §2/§3; brief R3 §2.2] | @implemented [2026-09-21]
 *
 * plain English: review is practice with a different pool. Every route here is
 * practice's route with the table names changed; the only real logic difference lives
 * in server/services/review-pool.ts. expected outcome: R4 can run practice's loop
 * component against these endpoints unchanged, which is what the A14 shape test holds.
 *
 * WHAT IS SHARED, NOT COPIED. The snapshot builder, the option shuffle, the student-safe
 * DTO, the grader and the mastery writer are IMPORTED from practice. A second grader or
 * a second shuffle would be the divergence CLAUDE.md forbids by name, and the first
 * review vertical died of exactly that kind of drift.
 *
 * WHAT DIFFERS FROM PRACTICE, and the ruling for each:
 *   - the pool (plan §2 rows 1-3, ruling 7/15/18/19) — see review-pool.ts;
 *   - the whole pool is prefilled, or `target_count` rows (plan §2 row 4, ruling 15);
 *   - no entitlement check and no daily quota (ruling 10). The concurrent-session cap
 *     is NOT a quota and is kept, counted separately from practice's but read from
 *     practice's config value so the two cannot drift (owner ruling 2026-09-21);
 *   - mastery source is `review` with the review item's id as the event id (ruling 11);
 *   - the answer/skip CAS targets review_session_items, and a DATABASE TRIGGER writes
 *     the attempt row and moves the queue in the same statement (ruling 3/5). Nothing
 *     here writes review_schedule or review_error_attempts;
 *   - open sessions list `created` and `active` only (ruling 17 — abandoned sessions
 *     never show in the UI).
 *
 * ANTI-LEAK. Every pre-submit payload goes through `toStudentSafeQuestionDTO`, which
 * pins `correct_answer` and `explanation` to null and emits opaque per-serve option
 * tokens. The answer-bearing columns exist on the snapshot for grading and are never
 * projected. That single chokepoint is the invariant (Coding Standards §5.2); adding a
 * field to a response here means checking it against that function, not around it.
 */

import { Router, type Request, type Response } from "express";
import * as crypto from "node:crypto";
import { logger } from "../logger";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
} from "../middleware/supabase-auth.js";
import { applyMasteryEvent } from "../../apps/api/src/services/mastery-write";
import {
  MASTERY_EMISSION_COMPONENT,
  MASTERY_EMISSION_EVENT,
  MASTERY_EMISSION_FAILURE_CODE,
} from "../../packages/shared/src/mastery-emission";
import {
  buildSafeOptionsForItem,
  buildSessionItemInsertRows,
  gradeAnswer,
  hydrateSessionItemOptionTokens,
  loadPracticeConfig,
  normalizeSessionState,
  practiceAnswerRateLimiter,
  toCanonicalQuestionFromSessionItem,
  toStudentSafeQuestionDTO,
  type CanonicalQuestionForServing,
  type PracticeLifecycleState,
} from "./practice-canonical";
import {
  buildReviewPool,
  buildReviewPoolSummary,
  type ReviewPoolRow,
} from "../services/review-pool";
import {
  parseReviewSessionCreate,
  reviewAnswerBodySchema,
  reviewCalculatorStateBodySchema,
  reviewCreateSessionBodySchema,
  reviewNextQuerySchema,
  reviewPoolQuerySchema,
  reviewResumeBodySchema,
  reviewSkipBodySchema,
  type ReviewPoolSpec,
} from "@lyceon/shared";
import type { ReviewSessionItemRow } from "../../packages/shared/src/review-table-schema";

const router = Router();

const COMPONENT = "REVIEW_ENGINE";

/** Sessions a student can still work in. Mirrors practice's ACTIVE_DB_STATUSES. */
const OPEN_STATUSES = ["created", "active"] as const;

/**
 * A review item as this module reads it. It is the schema-derived row type, so a
 * column that does not exist is a compile error (the same discipline
 * `scripts/ci/practice-schema-types-gate.sh` enforces at the schema end). It satisfies
 * practice's `QuestionSnapshotRow` structurally, which is why the snapshot, DTO and
 * grader functions take it unchanged and with no cast.
 */
type ReviewItemRow = ReviewSessionItemRow;

/**
 * Practice's SESSION_ITEM_SELECT (practice-canonical.ts:253), on review's columns,
 * plus the three review has that practice does not read back: `queue_entry_id`, and
 * `question_assets` / `question_estimated_time_seconds`.
 *
 * Practice's own select omits those last two although it writes them, so every
 * practice read-back reports `assets: null`. That is a live gap in practice, reported
 * not fixed here (it is not review's to change); review simply does not inherit it,
 * because a review item re-rendering a question without its stimulus SVG would be
 * unanswerable.
 */
const REVIEW_ITEM_SELECT =
  "id, session_id, student_id, question_id, question_section, question_stem, question_passage, question_options, question_correct_answer, question_explanation, question_option_metadata, question_domain, question_skill, question_difficulty, question_item_type, question_correct_variants, question_assets, question_estimated_time_seconds, option_order, option_token_map, ordinal, status, client_instance_id, selected_answer, is_correct, outcome, answered_at, served_at, occurred_at, time_spent_ms, client_attempt_id, actor_id, queue_entry_id";

const REVIEW_SESSION_SELECT =
  "id, student_id, mode, filters, target_count, platform, client_instance_id, status, created_at, updated_at, last_activity_at, completed_at, abandoned_at, actor_id";

type ReviewSessionRecord = {
  id: string;
  student_id: string | null;
  mode: string;
  filters: unknown;
  target_count: number;
  platform: string;
  client_instance_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  completed_at: string | null;
  abandoned_at: string | null;
  actor_id: string;
};

/**
 * `review_sessions.filters` carries two things at once, exactly as
 * `practice_sessions.filters` does: the pool spec the student chose (brief R3 §2.3's
 * shapes, which R4 renders from) and the session metadata practice keeps there. The
 * key sets do not overlap, so one JSONB column serves both without nesting.
 */
type ReviewSessionMetadata = {
  client_instance_id?: string | null;
  active_session_item_id?: string | null;
  last_served_ordinal?: number;
  calculator_state?: unknown | null;
  target_question_count?: number;
  prebuilt?: boolean;
  session_start_idempotency_key?: string | null;
  pool_mode?: string;
  source_engine?: string;
  source_session_id?: string;
  sections?: string[] | null;
  domains?: string[] | null;
  skills?: string[] | null;
  difficulties?: string[] | null;
};

function asReviewSessionMetadata(raw: unknown): ReviewSessionMetadata {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as ReviewSessionMetadata) };
}

function normalizeClientInstanceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The pool-spec half of `filters`, in the shapes brief R3 §2.3 specifies. */
function poolSpecToFilters(spec: ReviewPoolSpec): Record<string, unknown> {
  if (spec.mode === "queue") return { pool_mode: "queue" };
  if (spec.mode === "session") {
    return {
      pool_mode: "session",
      source_engine: spec.source.source_engine,
      source_session_id: spec.source.source_session_id,
    };
  }
  return {
    pool_mode: "filter",
    sections: spec.filter.sections ?? null,
    domains: spec.filter.domains ?? null,
    skills: spec.filter.skills ?? null,
    difficulties: spec.filter.difficulties ?? null,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Ownership. Practice's `loadOwnedSession` with `hideForbidden` — another student's
 * session is a 404, not a 403, so the endpoint does not confirm the id exists
 * (Coding Standards §6.1; A5). `student_id` is matched server-side and never taken
 * from the request.
 */
async function loadOwnedReviewSession(
  sessionId: string,
  studentId: string,
): Promise<ReviewSessionRecord | null> {
  const { data, error } = await supabaseServer
    .from("review_sessions")
    .select(REVIEW_SESSION_SELECT)
    .eq("id", sessionId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ReviewSessionRecord;
}

async function updateSessionLifecycle(
  sessionId: string,
  metadata: ReviewSessionMetadata,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseServer
    .from("review_sessions")
    .update({
      filters: metadata,
      updated_at: now,
      last_activity_at: now,
      ...patch,
    })
    .eq("id", sessionId);
  if (error) {
    throw new Error(`review_session_lifecycle_update_failed: ${error.message}`);
  }
}

/** The served-but-unresolved item, highest ordinal first. Practice's :1183. */
async function getCurrentUnansweredItem(
  sessionId: string,
): Promise<ReviewItemRow | null> {
  const { data, error } = await supabaseServer
    .from("review_session_items")
    .select(REVIEW_ITEM_SELECT)
    .eq("session_id", sessionId)
    .eq("status", "served")
    .order("ordinal", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`review_session_items_read_failed: ${error.message}`);
  }
  return (data as ReviewItemRow | null) ?? null;
}

/** The queue head, lowest ordinal first. Practice's :1771. */
async function getNextPendingItem(
  sessionId: string,
): Promise<ReviewItemRow | null> {
  const { data, error } = await supabaseServer
    .from("review_session_items")
    .select(REVIEW_ITEM_SELECT)
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .order("ordinal", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`review_session_items_read_failed: ${error.message}`);
  }
  return (data as ReviewItemRow | null) ?? null;
}

async function getLatestSessionItem(
  sessionId: string,
): Promise<ReviewItemRow | null> {
  const { data, error } = await supabaseServer
    .from("review_session_items")
    .select(REVIEW_ITEM_SELECT)
    .eq("session_id", sessionId)
    .order("ordinal", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`review_session_items_read_failed: ${error.message}`);
  }
  return (data as ReviewItemRow | null) ?? null;
}

async function countSessionItems(sessionId: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from("review_session_items")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (error) {
    throw new Error(`review_session_items_count_failed: ${error.message}`);
  }
  return Number.isFinite(count as number) ? Number(count) : 0;
}

type ResolvedCounts = {
  answeredCount: number;
  skippedCount: number;
  completedCount: number;
};

async function getSessionProgressCounts(
  sessionId: string,
): Promise<ResolvedCounts> {
  const { data, error } = await supabaseServer
    .from("review_session_items")
    .select("status")
    .eq("session_id", sessionId)
    .in("status", ["answered", "skipped"]);
  if (error) {
    throw new Error(`review_session_items_progress_failed: ${error.message}`);
  }
  let answeredCount = 0;
  let skippedCount = 0;
  for (const row of (data ?? []) as Array<{ status?: unknown }>) {
    if (row.status === "answered") answeredCount += 1;
    else if (row.status === "skipped") skippedCount += 1;
  }
  return {
    answeredCount,
    skippedCount,
    completedCount: answeredCount + skippedCount,
  };
}

type SessionStats = {
  correct: number;
  incorrect: number;
  skipped: number;
  total: number;
  streak: number;
};

/** Practice's getSessionStats (:1134), on review's tables and owner column. */
async function getSessionStats(
  sessionId: string,
  studentId: string,
): Promise<SessionStats> {
  const { data, error } = await supabaseServer
    .from("review_session_items")
    .select("is_correct, outcome, answered_at, status")
    .eq("session_id", sessionId)
    .eq("student_id", studentId)
    .in("status", ["answered", "skipped"])
    .order("answered_at", { ascending: false });

  if (error) {
    throw new Error(`review_session_stats_failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    is_correct?: unknown;
    outcome?: unknown;
    status?: unknown;
  }>;

  let correct = 0;
  let incorrect = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.status === "skipped" || row.outcome === "skipped") skipped += 1;
    else if (row.is_correct === true) correct += 1;
    else incorrect += 1;
  }

  // Newest-first order above makes the leading run the current streak.
  let streak = 0;
  for (const row of rows) {
    if (row.is_correct === true && row.outcome !== "skipped") streak += 1;
    else break;
  }

  return { correct, incorrect, skipped, total: rows.length, streak };
}

async function findReviewItemForSubmission(
  sessionId: string,
  args: { sessionItemId?: string; questionId?: string },
): Promise<ReviewItemRow | null> {
  let query = supabaseServer
    .from("review_session_items")
    .select(REVIEW_ITEM_SELECT)
    .eq("session_id", sessionId);

  if (args.sessionItemId) query = query.eq("id", args.sessionItemId);
  else if (args.questionId) query = query.eq("question_id", args.questionId);
  else
    query = query
      .eq("status", "served")
      .order("ordinal", { ascending: false })
      .limit(1);

  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0] as ReviewItemRow;
}

/**
 * Practice's cross-item binding check (:1812). A `clientAttemptId` already bound to a
 * DIFFERENT item is a 409, not a silent overwrite: the same key naming two items means
 * the client lost track of which attempt it is retrying.
 */
async function findReviewItemByClientAttemptId(
  studentId: string,
  clientAttemptId: string,
): Promise<ReviewItemRow | null> {
  const { data, error } = await supabaseServer
    .from("review_session_items")
    .select(REVIEW_ITEM_SELECT)
    .eq("student_id", studentId)
    .eq("client_attempt_id", clientAttemptId)
    .maybeSingle();
  if (error) return null;
  return (data as ReviewItemRow | null) ?? null;
}

function isDuplicateConflict(message: string): boolean {
  return (
    message.includes("duplicate key") ||
    message.includes("uq_review_items_idem") ||
    message.includes("23505")
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

type CreateResult =
  | {
      ok: true;
      session: ReviewSessionRecord;
      metadata: ReviewSessionMetadata;
      replayed: boolean;
    }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * @spec [ruled plan §2 rows 4/7, rulings 10/15; brief R3 §2.2/§2.3] | @implemented [2026-09-21]
 *
 * plain English: start a review session, or return the one an identical
 * `idempotency_key` already started. expected outcome: a session prefilled with the
 * whole pool, oldest mistake first, its first item already served.
 *
 * trade-offs: the idempotency mechanism is practice's, verbatim — an opaque key inside
 * `filters`, scanned across OPEN sessions (owner ruling, R2 check 8). It is neither
 * durable past session close nor atomic under concurrent creates, and that is accepted
 * by ruling rather than overlooked: review mirrors practice exactly, including this.
 *
 * edge cases:
 *   - an empty pool is a 422 decision response BEFORE any row is written, so it leaves
 *     no orphan session (practice's shape, :1562);
 *   - the concurrent-session cap is review's own count, using practice's configured
 *     value (owner ruling 2026-09-21), so five open practice sessions do not block a
 *     review session and vice versa;
 *   - a question already open in another review session is NOT excluded (ruling 15).
 */
async function startOrReplayReviewSession(args: {
  studentId: string;
  actorId: string;
  poolSpec: ReviewPoolSpec;
  clientInstanceId: string;
  idempotencyKey: string | null;
  targetCount: number | null;
  requestId?: string;
}): Promise<CreateResult> {
  const { data: openSessions, error: openErr } = await supabaseServer
    .from("review_sessions")
    .select(REVIEW_SESSION_SELECT)
    .eq("student_id", args.studentId)
    .in("status", [...OPEN_STATUSES])
    .order("created_at", { ascending: false });

  if (openErr) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_lookup_failed",
        message: openErr.message,
      },
    };
  }

  const sessions = (openSessions ?? []) as ReviewSessionRecord[];

  let replay: ReviewSessionRecord | null = null;
  if (args.idempotencyKey) {
    replay =
      sessions.find(
        (candidate) =>
          asReviewSessionMetadata(candidate.filters)
            .session_start_idempotency_key === args.idempotencyKey,
      ) ?? null;
  }

  const config = await loadPracticeConfig();
  if (!replay && sessions.length >= config.maxConcurrentSessions) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "session_limit_exceeded",
        code: "SESSION_LIMIT_EXCEEDED",
        message: `You already have ${sessions.length} open review sessions. Finish or end one first.`,
        maxConcurrentSessions: config.maxConcurrentSessions,
      },
    };
  }

  if (replay) {
    return {
      ok: true,
      session: replay,
      metadata: asReviewSessionMetadata(replay.filters),
      replayed: true,
    };
  }

  const poolResult = await buildReviewPool({
    studentId: args.studentId,
    poolSpec: args.poolSpec,
    requestId: args.requestId,
  });
  if (!poolResult.ok) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_create_failed",
        message: poolResult.error,
      },
    };
  }

  const pool = poolResult.value;
  if (pool.length === 0) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "empty_pool",
        code: "REVIEW_POOL_EMPTY",
        message: "You have nothing to review in this selection.",
      },
    };
  }

  // Ruling 15 / plan §2 row 4: the WHOLE pool, or the calendar's size when it asks.
  const selected =
    args.targetCount && args.targetCount > 0
      ? pool.slice(0, args.targetCount)
      : pool;

  const now = new Date().toISOString();
  const metadata: ReviewSessionMetadata = {
    ...poolSpecToFilters(args.poolSpec),
    client_instance_id: args.clientInstanceId,
    active_session_item_id: null,
    target_question_count: selected.length,
    prebuilt: false,
    session_start_idempotency_key: args.idempotencyKey,
    calculator_state: null,
  };

  const { data: inserted, error: insertErr } = await supabaseServer
    .from("review_sessions")
    .insert({
      student_id: args.studentId,
      actor_id: args.actorId,
      mode: args.poolSpec.mode,
      filters: metadata,
      target_count: selected.length,
      platform: "web",
      client_instance_id: args.clientInstanceId,
      status: "created",
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    })
    .select(REVIEW_SESSION_SELECT)
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_create_failed",
        message: insertErr?.message ?? "review session insert returned no row",
      },
    };
  }

  const session = inserted as ReviewSessionRecord;

  const materialized = await materializeReviewItems({
    sessionId: session.id,
    studentId: args.studentId,
    actorId: args.actorId,
    clientInstanceId: args.clientInstanceId,
    now,
    selected,
  });

  if (!materialized.ok) {
    await cleanupFailedReviewMaterialization(session.id);
    return {
      ok: false,
      status: 500,
      body: { error: "session_create_failed", message: materialized.error },
    };
  }

  metadata.prebuilt = true;
  await updateSessionLifecycle(session.id, metadata);

  return { ok: true, session, metadata, replayed: false };
}

/**
 * Snapshot the pool into `review_session_items`, then hydrate the option tokens.
 *
 * `buildSessionItemInsertRows` is practice's, with `ownerColumn: "student_id"` — one
 * definition of the 30-column snapshot shape for both engines. The only review
 * addition is `queue_entry_id`, the link back to the queue row each item is working
 * off, which is what lets the deletion cascade and the G15 rehearsal reason about the
 * pair. Ordinals follow pool order, so item 1 is the oldest mistake (ruling 7).
 */
async function materializeReviewItems(args: {
  sessionId: string;
  studentId: string;
  actorId: string;
  clientInstanceId: string;
  now: string;
  selected: ReviewPoolRow[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let rows: Record<string, unknown>[];
  try {
    rows = buildSessionItemInsertRows(
      args.selected.map((row) => row.question),
      {
        sessionId: args.sessionId,
        userId: args.studentId,
        actorId: args.actorId,
        clientInstanceId: args.clientInstanceId,
        now: args.now,
        ownerColumn: "student_id",
      },
    ).map((row, index) => ({
      ...row,
      queue_entry_id: args.selected[index]?.entry.id ?? null,
    }));
  } catch (err) {
    // assertCanonicalDomain throws on a non-canonical (section, domain) pair. Practice
    // treats that as a materialization failure rather than a silent drop, and so does
    // review — a permanently un-masterable item is worse than a failed create.
    return {
      ok: false,
      error: `review_item_build_failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const { error: insertErr } = await supabaseServer
    .from("review_session_items")
    .insert(rows);
  if (insertErr) {
    return {
      ok: false,
      error: `review_item_insert_failed: ${insertErr.message}`,
    };
  }

  try {
    await hydrateSessionItemOptionTokens(
      args.sessionId,
      "review_session_items",
    );
  } catch (err) {
    return {
      ok: false,
      error: `review_item_hydrate_failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  return { ok: true };
}

async function cleanupFailedReviewMaterialization(
  sessionId: string,
): Promise<void> {
  await supabaseServer
    .from("review_session_items")
    .delete()
    .eq("session_id", sessionId);
  await supabaseServer.from("review_sessions").delete().eq("id", sessionId);
}

// ---------------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------------

function questionForItem(
  item: ReviewItemRow,
): CanonicalQuestionForServing | null {
  return toCanonicalQuestionFromSessionItem(item);
}

async function serveNextForSession(args: {
  res: Response;
  requestId: string | undefined;
  sessionId: string;
  studentId: string;
  clientInstanceId: string;
}): Promise<Response> {
  const session = await loadOwnedReviewSession(args.sessionId, args.studentId);
  if (!session) {
    return args.res.status(404).json({
      error: "session_not_found",
      message: "Review session not found",
      requestId: args.requestId,
    });
  }

  const state = normalizeSessionState(session.status);
  if (state === "completed" || state === "abandoned") {
    return args.res.status(409).json({
      error: "session_closed",
      message: "This review session is closed.",
      state,
      requestId: args.requestId,
    });
  }

  const metadata = asReviewSessionMetadata(session.filters);
  const boundClient = normalizeClientInstanceId(metadata.client_instance_id);
  if (boundClient && boundClient !== args.clientInstanceId) {
    return args.res.status(409).json({
      error: "client_instance_conflict",
      code: "CLIENT_INSTANCE_CONFLICT",
      message: "This session is open in another tab or device.",
      requestId: args.requestId,
    });
  }

  const unresolved = await getCurrentUnansweredItem(args.sessionId);
  const item =
    unresolved ??
    (await promoteNextItem(args.sessionId, args.clientInstanceId));

  if (!item) {
    const total = await countSessionItems(args.sessionId);
    if (total === 0) {
      return args.res.status(409).json({
        error: "session_materialization_missing",
        code: "REVIEW_SESSION_ITEMS_MISSING",
        message: "This review session has no items.",
        requestId: args.requestId,
      });
    }
    await updateSessionLifecycle(args.sessionId, metadata, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
    return args.res.status(409).json({
      error: "session_closed",
      message: "This review session is complete.",
      state: "completed",
      requestId: args.requestId,
    });
  }

  const canonicalQuestion = questionForItem(item);
  if (!canonicalQuestion) {
    return args.res.status(409).json({
      error: "session_item_unrenderable",
      message: "Persisted review item could not be reconstituted.",
      requestId: args.requestId,
    });
  }

  const safeOptions = buildSafeOptionsForItem(
    canonicalQuestion,
    item.option_order ?? null,
    item.option_token_map ?? null,
  );
  if (!safeOptions) {
    return args.res.status(409).json({
      error: "session_item_mapping_missing",
      message: "Persisted option mapping is missing for this review item.",
      requestId: args.requestId,
    });
  }

  metadata.active_session_item_id = item.id;
  metadata.last_served_ordinal = item.ordinal;
  metadata.client_instance_id = args.clientInstanceId;
  await updateSessionLifecycle(args.sessionId, metadata, { status: "active" });

  return args.res.json({
    sessionId: session.id,
    sessionItemId: item.id,
    ordinal: item.ordinal,
    state: "active",
    calculatorState: metadata.calculator_state ?? null,
    question: toStudentSafeQuestionDTO({
      sessionItemId: item.id,
      question: canonicalQuestion,
      safeOptions,
    }),
    stats: await getSessionStats(args.sessionId, args.studentId),
    totalQuestions: await countSessionItems(args.sessionId),
  });
}

/**
 * `pending` -> `served`, as a compare-and-swap. Two concurrent `/next` calls race on
 * the same row; one wins and the other sees `null`, which the caller then re-reads as
 * an already-served item rather than reporting a failure.
 */
async function promoteNextItem(
  sessionId: string,
  clientInstanceId: string,
): Promise<ReviewItemRow | null> {
  const next = await getNextPendingItem(sessionId);
  if (!next) return null;

  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from("review_session_items")
    .update({
      status: "served",
      client_instance_id: clientInstanceId,
      served_at: now,
    })
    .eq("id", next.id)
    .eq("status", "pending")
    .select(REVIEW_ITEM_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(`review_session_item_promote_failed: ${error.message}`);
  }
  if (!data) {
    // Lost the CAS. Practice returns 500 here; review re-reads instead, because the
    // row is now `served` and re-serving it is the correct, idempotent answer.
    return await getCurrentUnansweredItem(sessionId);
  }
  return data as ReviewItemRow;
}

// ---------------------------------------------------------------------------
// Answer
// ---------------------------------------------------------------------------

function answerRevealFields(
  question: CanonicalQuestionForServing,
  correctOptionId: string | null,
): Record<string, unknown> {
  return question.item_type === "grid_in"
    ? { correctAnswer: question.correct_answer }
    : { correctOptionId };
}

export async function submitReviewAnswer(
  req: Request,
  res: Response,
): Promise<Response> {
  const requestId = (req as unknown as { requestId?: string }).requestId;
  const user = (req as unknown as { user?: { id?: string } }).user;
  const studentId = user?.id;

  if (!studentId) {
    return res.status(401).json({
      error: "Authentication required",
      message: "You must be signed in",
      requestId,
    });
  }

  const parsed = reviewAnswerBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_payload",
      issues: parsed.error.issues,
      requestId,
    });
  }

  const selectedRaw =
    parsed.data.selectedAnswer ??
    parsed.data.selectedOptionId ??
    parsed.data.answer ??
    null;
  const selectedAnswer =
    typeof selectedRaw === "string" && selectedRaw.trim().length > 0
      ? selectedRaw.trim()
      : null;
  const clientAttemptId = parsed.data.clientAttemptId?.trim() || null;

  const session = await loadOwnedReviewSession(
    parsed.data.sessionId,
    studentId,
  );
  if (!session) {
    return res.status(404).json({
      error: "session_not_found",
      message: "Review session not found",
      requestId,
    });
  }

  const sessionItem = await findReviewItemForSubmission(parsed.data.sessionId, {
    sessionItemId: parsed.data.sessionItemId,
    questionId: parsed.data.questionId,
  });
  if (!sessionItem) {
    return res.status(404).json({
      error: "session_item_not_found",
      message: "Review item not found in this session.",
      requestId,
    });
  }

  const canonicalQuestion = questionForItem(sessionItem);
  if (!canonicalQuestion) {
    return res.status(409).json({
      error: "session_item_unrenderable",
      message: "Persisted review item could not be reconstituted.",
      requestId,
    });
  }

  const responseMode =
    canonicalQuestion.item_type === "grid_in" ? "grid_in" : "multiple_choice";

  // Replay detection, practice's order: the status guard owns it (:3218). An item that
  // is no longer `served` was already resolved, and the stored outcome is replayed
  // verbatim rather than re-graded.
  if (sessionItem.status !== "served") {
    if (sessionItem.outcome) {
      const replayCorrectOptionId = resolveCorrectOptionId(
        canonicalQuestion,
        sessionItem.option_token_map ?? null,
      );
      return res.json({
        sessionId: parsed.data.sessionId,
        sessionItemId: sessionItem.id,
        isCorrect: !!sessionItem.is_correct,
        mode: responseMode,
        ...answerRevealFields(canonicalQuestion, replayCorrectOptionId),
        explanation: canonicalQuestion.explanation ?? null,
        feedback: sessionItem.is_correct
          ? "Correct"
          : sessionItem.outcome === "skipped"
            ? "Skipped"
            : "Incorrect",
        stats: await getSessionStats(parsed.data.sessionId, studentId),
        idempotentRetried: true,
      });
    }
    return res.status(409).json({
      error: "session_item_not_open",
      message: "This review item was already resolved by another request.",
      requestId,
    });
  }

  if (clientAttemptId) {
    const bound = await findReviewItemByClientAttemptId(
      studentId,
      clientAttemptId,
    );
    if (bound && bound.id !== sessionItem.id) {
      return res.status(409).json({
        error: "idempotency_key_reuse",
        message:
          "The provided clientAttemptId is already bound to a different session item.",
        requestId,
      });
    }
  }

  if (selectedAnswer === null) {
    return res.status(400).json({
      error: "invalid_answer",
      message: "selectedAnswer is required.",
      requestId,
    });
  }

  const graded = gradeAnswer(
    canonicalQuestion,
    selectedAnswer,
    sessionItem.option_token_map ?? null,
  );
  if (!graded.ok) {
    return res.status(graded.status).json({
      error: graded.error,
      message: graded.message,
      requestId,
    });
  }

  const now = new Date().toISOString();

  // THE CAS. `occurred_at` is not decoration: trg_review_item_resolve copies it into
  // review_error_attempts.occurred_at, which is what canonical_mastery_events orders
  // and windows on. The trigger fires on this statement and writes the attempt row and
  // the queue move atomically with it (ruling 3/5).
  const { data: updatedItem, error: updateErr } = await supabaseServer
    .from("review_session_items")
    .update({
      status: "answered",
      selected_answer: selectedAnswer,
      is_correct: graded.isCorrect,
      outcome: graded.outcome,
      time_spent_ms: null,
      answered_at: now,
      occurred_at: now,
      client_attempt_id: clientAttemptId,
    })
    .eq("id", sessionItem.id)
    .eq("status", "served")
    .select(REVIEW_ITEM_SELECT)
    .maybeSingle();

  if (updateErr) {
    if (isDuplicateConflict(updateErr.message)) {
      return res.status(409).json({
        error: "idempotency_key_reuse",
        message:
          "The provided clientAttemptId is already bound to a different session item.",
        requestId,
      });
    }
    return res.status(500).json({
      error: "session_item_update_failed",
      message: updateErr.message,
      requestId,
    });
  }

  if (!updatedItem) {
    return res.status(409).json({
      error: "session_item_not_open",
      message: "This review item was already resolved by another request.",
      requestId,
    });
  }

  await emitReviewMastery({
    item: updatedItem as ReviewItemRow,
    studentId,
    isCorrect: graded.isCorrect,
    occurredAt: now,
    requestId,
    sessionId: parsed.data.sessionId,
  });

  const metadata = asReviewSessionMetadata(session.filters);
  const remaining = await getNextPendingItem(parsed.data.sessionId);
  const shouldComplete = remaining === null;
  metadata.active_session_item_id = null;
  await updateSessionLifecycle(
    parsed.data.sessionId,
    metadata,
    shouldComplete
      ? { status: "completed", completed_at: now }
      : { status: "active" },
  );

  return res.json({
    sessionId: parsed.data.sessionId,
    sessionItemId: sessionItem.id,
    isCorrect: graded.isCorrect,
    mode: responseMode,
    ...answerRevealFields(canonicalQuestion, graded.correctOptionId),
    explanation: canonicalQuestion.explanation ?? null,
    feedback: graded.isCorrect ? "Correct" : "Incorrect",
    stats: await getSessionStats(parsed.data.sessionId, studentId),
    state: shouldComplete ? "completed" : "active",
  });
}

function resolveCorrectOptionId(
  question: CanonicalQuestionForServing,
  optionTokenMap: Record<string, string> | null,
): string | null {
  if (question.item_type === "grid_in") return null;
  if (!optionTokenMap || !question.correct_answer) return null;
  const found = Object.entries(optionTokenMap).find(
    ([, key]) => key === question.correct_answer,
  );
  return found?.[0] ?? null;
}

/**
 * @spec [ruled plan ruling 11; brief R3 §2.2] | @implemented [2026-09-21]
 *
 * plain English: emit the mastery event for a resolved review answer. expected
 * outcome: `applyMasteryEvent` with source family `review` and **event id = the review
 * item's id**, because trg_review_item_resolve wrote review_error_attempts with
 * `id = NEW.id`, and canonical_mastery_events reads that column as `event_id`. Passing
 * anything else — the attempt's client id, a fresh uuid — silently double-counts.
 *
 * trade-offs: warn-and-continue, exactly as practice does (:3528). The answer is
 * already persisted and the attempt row already written by the trigger; mastery is a
 * downstream consumer and must not 500 the answer. edge cases: an item missing
 * section/domain/skill/difficulty emits nothing and logs — the same branch practice has.
 */
async function emitReviewMastery(args: {
  item: ReviewItemRow;
  studentId: string;
  isCorrect: boolean;
  occurredAt: string;
  requestId: string | undefined;
  sessionId: string;
}): Promise<void> {
  const canonicalId =
    typeof args.item.question_id === "string" ? args.item.question_id : null;
  const section =
    typeof args.item.question_section === "string"
      ? args.item.question_section.trim()
      : "";
  const domain =
    typeof args.item.question_domain === "string"
      ? args.item.question_domain.trim()
      : "";
  const skill =
    typeof args.item.question_skill === "string"
      ? args.item.question_skill.trim()
      : "";
  const difficulty = resolveDifficultyBucket(args.item.question_difficulty);

  if (!canonicalId || !difficulty || !section || !domain || !skill) {
    logger.error(
      MASTERY_EMISSION_COMPONENT,
      MASTERY_EMISSION_EVENT.SKIPPED,
      "Review answer resolved without the metadata mastery requires",
      undefined,
      {
        code:
          difficulty === null
            ? MASTERY_EMISSION_FAILURE_CODE.INVALID_DIFFICULTY
            : MASTERY_EMISSION_FAILURE_CODE.MISSING_METADATA,
        requestId: args.requestId,
        reviewSessionId: args.sessionId,
        hasSection: section.length > 0,
        hasDomain: domain.length > 0,
        hasSkill: skill.length > 0,
        hasDifficulty: difficulty !== null,
      },
    );
    return;
  }

  const result = await applyMasteryEvent({
    studentId: args.studentId,
    section,
    domain,
    skill,
    difficulty,
    sourceFamily: "review",
    eventSourceKind: "review_error_attempt",
    correct: args.isCorrect,
    occurredAt: args.occurredAt,
    eventId: args.item.id,
    questionId: canonicalId,
  });

  if (!result.ok) {
    logger.error(
      MASTERY_EMISSION_COMPONENT,
      MASTERY_EMISSION_EVENT.FAILED,
      "Review mastery emission returned error — warn-and-continue",
      undefined,
      {
        code: result.code ?? MASTERY_EMISSION_FAILURE_CODE.RPC_ERROR,
        requestId: args.requestId,
        reviewSessionId: args.sessionId,
        questionCanonicalId: canonicalId,
        dbError: result.error ?? "unknown",
      },
    );
  }
}

function resolveDifficultyBucket(raw: unknown): 1 | 2 | 3 | null {
  if (raw === 1 || raw === 2 || raw === 3) return raw;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "easy" || normalized === "1") return 1;
    if (normalized === "medium" || normalized === "2") return 2;
    if (normalized === "hard" || normalized === "3") return 3;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Skip
// ---------------------------------------------------------------------------

/**
 * @spec [ruled plan ruling 16; brief R3 §2.2; R2 pre-build check 7] | @implemented [2026-09-21]
 * plain English: skip the served item. expected outcome: the trigger requeues the
 * question at the back of the line with outcome `skipped`, and NO attempt row is
 * written. trade-offs: no mastery call, mirroring practice, where
 * canonical_mastery_events' practice branch reads `status = 'answered'` only. A student
 * can therefore skip the same question indefinitely with no mastery signal — recorded
 * as a post-launch policy candidate in plan §6, not a defect here.
 */
export async function submitReviewSkip(
  req: Request,
  res: Response,
): Promise<Response> {
  const requestId = (req as unknown as { requestId?: string }).requestId;
  const user = (req as unknown as { user?: { id?: string } }).user;
  const studentId = user?.id;
  const sessionId = req.params.sessionId;

  if (!studentId) {
    return res.status(401).json({
      error: "Authentication required",
      message: "You must be signed in",
      requestId,
    });
  }
  if (!sessionId) {
    return res.status(400).json({
      error: "invalid_session_id",
      message: "sessionId is required",
      requestId,
    });
  }

  const parsed = reviewSkipBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_payload",
      issues: parsed.error.issues,
      requestId,
    });
  }
  const clientAttemptId = parsed.data.clientAttemptId?.trim() || null;

  const session = await loadOwnedReviewSession(sessionId, studentId);
  if (!session) {
    return res.status(404).json({
      error: "session_not_found",
      message: "Review session not found",
      requestId,
    });
  }

  const sessionItem = await findReviewItemForSubmission(sessionId, {
    sessionItemId: parsed.data.sessionItemId,
    questionId: parsed.data.questionId,
  });
  if (!sessionItem) {
    return res.status(404).json({
      error: "session_item_not_found",
      message: "Review item not found in this session.",
      requestId,
    });
  }

  const canonicalQuestion = questionForItem(sessionItem);
  const skipResponseMode =
    canonicalQuestion?.item_type === "grid_in" ? "grid_in" : "multiple_choice";

  if (sessionItem.status !== "served") {
    if (sessionItem.outcome) {
      return res.json({
        sessionId,
        sessionItemId: sessionItem.id,
        skipped: true,
        mode: skipResponseMode,
        feedback: "Skipped",
        stats: await getSessionStats(sessionId, studentId),
        idempotentRetried: true,
      });
    }
    return res.status(409).json({
      error: "session_item_not_open",
      message: "This review item was already resolved by another request.",
      requestId,
    });
  }

  if (clientAttemptId) {
    const bound = await findReviewItemByClientAttemptId(
      studentId,
      clientAttemptId,
    );
    if (bound && bound.id !== sessionItem.id) {
      return res.status(409).json({
        error: "idempotency_key_reuse",
        message:
          "The provided clientAttemptId is already bound to a different session item.",
        requestId,
      });
    }
  }

  const now = new Date().toISOString();
  const { data: updatedItem, error: updateErr } = await supabaseServer
    .from("review_session_items")
    .update({
      status: "skipped",
      outcome: "skipped",
      is_correct: null,
      answered_at: now,
      occurred_at: now,
      client_attempt_id: clientAttemptId,
    })
    .eq("id", sessionItem.id)
    .eq("status", "served")
    .select("id")
    .maybeSingle();

  if (updateErr) {
    if (isDuplicateConflict(updateErr.message)) {
      return res.status(409).json({
        error: "idempotency_key_reuse",
        message:
          "The provided clientAttemptId is already bound to a different session item.",
        requestId,
      });
    }
    return res.status(500).json({
      error: "session_item_update_failed",
      message: updateErr.message,
      requestId,
    });
  }

  if (!updatedItem) {
    return res.status(409).json({
      error: "session_item_not_open",
      message: "This review item was already resolved by another request.",
      requestId,
    });
  }

  const metadata = asReviewSessionMetadata(session.filters);
  const remaining = await getNextPendingItem(sessionId);
  const shouldComplete = remaining === null;
  metadata.active_session_item_id = null;
  await updateSessionLifecycle(
    sessionId,
    metadata,
    shouldComplete
      ? { status: "completed", completed_at: now }
      : { status: "active" },
  );

  return res.json({
    sessionId,
    sessionItemId: sessionItem.id,
    skipped: true,
    mode: skipResponseMode,
    feedback: "Skipped",
    stats: await getSessionStats(sessionId, studentId),
    state: shouldComplete ? "completed" : "active",
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function requireStudentId(req: Request, res: Response): string | null {
  const user = (req as unknown as { user?: { id?: string } }).user;
  const studentId = user?.id;
  if (!studentId) {
    res.status(401).json({
      error: "Authentication required",
      message: "You must be signed in",
      requestId: (req as unknown as { requestId?: string }).requestId,
    });
    return null;
  }
  return studentId;
}

/**
 * GET /api/review/pool — one read for both pickers (brief R3 §2.4).
 * Registered before `/sessions/...` for readability only; the paths do not collide.
 */
router.get(
  "/pool",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
    const requestId = (req as unknown as { requestId?: string }).requestId;
    const studentId = requireStudentId(req, res);
    if (!studentId) return;

    const parsed = reviewPoolQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        issues: parsed.error.issues,
        requestId,
      });
    }

    const summary = await buildReviewPoolSummary({
      studentId,
      tz: parsed.data.tz ?? null,
      requestId,
    });
    if (!summary.ok) {
      return res.status(500).json({
        error: "review_pool_summary_failed",
        message: summary.error,
        requestId,
      });
    }
    return res.json(summary.value);
  },
);

/** GET /api/review/sessions/open — `created` and `active` only (ruling 17). */
router.get(
  "/sessions/open",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
    const requestId = (req as unknown as { requestId?: string }).requestId;
    const studentId = requireStudentId(req, res);
    if (!studentId) return;

    const config = await loadPracticeConfig();
    const { data, error } = await supabaseServer
      .from("review_sessions")
      .select(REVIEW_SESSION_SELECT)
      .eq("student_id", studentId)
      .in("status", [...OPEN_STATUSES])
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: "session_lookup_failed",
        message: error.message,
        requestId,
      });
    }

    const sessions = await Promise.all(
      ((data ?? []) as ReviewSessionRecord[]).map(async (s) => {
        const counts = await getSessionProgressCounts(s.id);
        const total = await countSessionItems(s.id);
        const metadata = asReviewSessionMetadata(s.filters);
        const sections = metadata.sections ?? [];
        return {
          id: s.id,
          section: sections.length === 1 ? (sections[0] ?? null) : null,
          mode: s.mode,
          status: s.status,
          created_at: s.created_at,
          target_question_count:
            metadata.target_question_count ?? s.target_count,
          total_items: total,
          answered_items: counts.completedCount,
        };
      }),
    );

    return res.json({
      sessions,
      maxConcurrentSessions: config.maxConcurrentSessions,
      requestId,
    });
  },
);

/** POST /api/review/sessions */
router.post(
  "/sessions",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
    const requestId = (req as unknown as { requestId?: string }).requestId;
    const user = (
      req as unknown as { user?: { id?: string; actor_id?: string } }
    ).user;
    const studentId = requireStudentId(req, res);
    if (!studentId) return;

    const parsed = reviewCreateSessionBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        issues: parsed.error.issues,
        requestId,
      });
    }

    const spec = parseReviewSessionCreate(parsed.data);
    if (!spec.ok) {
      return res.status(400).json({
        error: "invalid_payload",
        message: spec.error,
        details: spec.details,
        requestId,
      });
    }

    const clientInstanceId =
      spec.value.clientInstanceId ?? `server-${crypto.randomUUID()}`;

    const result = await startOrReplayReviewSession({
      studentId,
      actorId: user?.actor_id ?? studentId,
      poolSpec: spec.value.poolSpec,
      clientInstanceId,
      idempotencyKey: spec.value.idempotencyKey,
      targetCount: spec.value.targetCount,
      requestId,
    });

    if (!result.ok) {
      return res.status(result.status).json({ ...result.body, requestId });
    }

    return res.json({
      id: result.session.id,
      sessionId: result.session.id,
      userId: studentId,
      mode: result.session.mode,
      state: normalizeSessionState(result.session.status),
      replayed: result.replayed,
      clientInstanceId,
      targetQuestionCount:
        result.metadata.target_question_count ?? result.session.target_count,
      calculatorState: result.metadata.calculator_state ?? null,
    });
  },
);

/** GET /api/review/sessions/:sessionId/state */
router.get(
  "/sessions/:sessionId/state",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
    const requestId = (req as unknown as { requestId?: string }).requestId;
    const studentId = requireStudentId(req, res);
    if (!studentId) return;
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      return res.status(400).json({
        error: "invalid_session_id",
        message: "sessionId is required",
        requestId,
      });
    }

    const session = await loadOwnedReviewSession(sessionId, studentId);
    if (!session) {
      return res.status(404).json({
        error: "session_not_found",
        message: "Review session not found",
        requestId,
      });
    }

    const metadata = asReviewSessionMetadata(session.filters);
    const latestItem = await getLatestSessionItem(sessionId);
    const unresolved = await getCurrentUnansweredItem(sessionId);
    const counts = await getSessionProgressCounts(sessionId);
    const state: PracticeLifecycleState = normalizeSessionState(session.status);
    const sections = metadata.sections ?? [];

    return res.json({
      sessionId: session.id,
      section: sections.length === 1 ? (sections[0] ?? null) : null,
      mode: session.mode,
      state,
      currentOrdinal: unresolved?.ordinal ?? latestItem?.ordinal ?? 0,
      answeredCount: counts.answeredCount,
      skippedCount: counts.skippedCount,
      completedCount: counts.completedCount,
      targetQuestionCount:
        metadata.target_question_count ?? session.target_count,
      calculatorState: metadata.calculator_state ?? null,
      lastServedUnansweredItem: unresolved
        ? { sessionItemId: unresolved.id, ordinal: unresolved.ordinal }
        : null,
      clientInstanceId: normalizeClientInstanceId(metadata.client_instance_id),
      readOnly: state === "completed" || state === "abandoned",
    });
  },
);

/** GET /api/review/sessions/:sessionId/next */
router.get(
  "/sessions/:sessionId/next",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
    const requestId = (req as unknown as { requestId?: string }).requestId;
    const studentId = requireStudentId(req, res);
    if (!studentId) return;
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      return res.status(400).json({
        error: "invalid_session_id",
        message: "sessionId is required",
        requestId,
      });
    }

    const parsed = reviewNextQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "missing_client_instance_id",
        message: "client_instance_id is required",
        requestId,
      });
    }

    return serveNextForSession({
      res,
      requestId,
      sessionId,
      studentId,
      clientInstanceId: parsed.data.client_instance_id,
    });
  },
);

/** POST /api/review/sessions/:sessionId/resume */
router.post(
  "/sessions/:sessionId/resume",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
    const requestId = (req as unknown as { requestId?: string }).requestId;
    const studentId = requireStudentId(req, res);
    if (!studentId) return;
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      return res.status(400).json({
        error: "invalid_session_id",
        message: "sessionId is required",
        requestId,
      });
    }

    const parsed = reviewResumeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        issues: parsed.error.issues,
        requestId,
      });
    }

    const session = await loadOwnedReviewSession(sessionId, studentId);
    if (!session) {
      return res.status(404).json({
        error: "session_not_found",
        message: "Review session not found",
        requestId,
      });
    }

    const metadata = asReviewSessionMetadata(session.filters);
    const boundClient = normalizeClientInstanceId(metadata.client_instance_id);
    const requested = normalizeClientInstanceId(parsed.data.client_instance_id);
    const clientInstanceId =
      requested ?? boundClient ?? `server-${crypto.randomUUID()}`;

    if (
      boundClient &&
      requested &&
      boundClient !== requested &&
      !parsed.data.force_takeover
    ) {
      return res.status(409).json({
        error: "client_instance_conflict",
        code: "CLIENT_INSTANCE_CONFLICT",
        message: "This session is open in another tab or device.",
        requestId,
      });
    }

    return serveNextForSession({
      res,
      requestId,
      sessionId,
      studentId,
      clientInstanceId,
    });
  },
);

/** POST /api/review/sessions/:sessionId/terminate */
router.post(
  "/sessions/:sessionId/terminate",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
    const requestId = (req as unknown as { requestId?: string }).requestId;
    const studentId = requireStudentId(req, res);
    if (!studentId) return;
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      return res.status(400).json({
        error: "invalid_session_id",
        message: "sessionId is required",
        requestId,
      });
    }

    const session = await loadOwnedReviewSession(sessionId, studentId);
    if (!session) {
      return res.status(404).json({
        error: "session_not_found",
        message: "Review session not found",
        requestId,
      });
    }

    const metadata = asReviewSessionMetadata(session.filters);
    metadata.active_session_item_id = null;
    metadata.client_instance_id = null;
    metadata.calculator_state = null;

    // completed_at stays null: stamping it on abandonment makes abandoned work read as
    // finished work, and review_sessions_abandoned_not_completed refuses the row
    // outright (20260921000000:214-219).
    await updateSessionLifecycle(sessionId, metadata, {
      status: "abandoned",
      abandoned_at: new Date().toISOString(),
      completed_at: null,
    });

    return res.json({ sessionId, state: "abandoned", readOnly: true });
  },
);

/** POST /api/review/sessions/:sessionId/calculator-state */
router.post(
  "/sessions/:sessionId/calculator-state",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
    const requestId = (req as unknown as { requestId?: string }).requestId;
    const studentId = requireStudentId(req, res);
    if (!studentId) return;
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      return res.status(400).json({
        error: "invalid_session_id",
        message: "sessionId is required",
        requestId,
      });
    }

    const parsed = reviewCalculatorStateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        issues: parsed.error.issues,
        requestId,
      });
    }

    const session = await loadOwnedReviewSession(sessionId, studentId);
    if (!session) {
      return res.status(404).json({
        error: "session_not_found",
        message: "Review session not found",
        requestId,
      });
    }

    const metadata = asReviewSessionMetadata(session.filters);
    metadata.calculator_state = parsed.data.calculator_state ?? null;
    await updateSessionLifecycle(sessionId, metadata);

    return res.json({
      sessionId,
      calculatorState: metadata.calculator_state ?? null,
    });
  },
);

router.post(
  "/answer",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  practiceAnswerRateLimiter,
  submitReviewAnswer,
);

router.post(
  "/sessions/:sessionId/skip",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  practiceAnswerRateLimiter,
  submitReviewSkip,
);

export default router;

// Named export for the observability gate and tests; the default export is what
// server/index.ts mounts.
export { router as reviewCanonicalRouter, COMPONENT as REVIEW_COMPONENT };
