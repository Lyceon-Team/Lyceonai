/**
 * The end-of-session summary: what one completed practice or review session did.
 *
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 3; Coding Standards
 *        §10 (mastery is earned from observed events only: "Do not introduce 'predicted score,'
 *        'confidence,' or vanity metrics"), §8.1 (thin route; domain logic pure), §12 (no answers
 *        or content in logs); Doc 05 Parent §6.6 / RULE 3 (NULL is unmeasured, never level 0);
 *        review ruled plan §3 rulings 2 and 12 (a miss or a skip writes one review_schedule row,
 *        sourced to its session); SCL-226 (the one daily streak)] | @implemented [2026-10-13]
 *
 * plain English: four reads, each of something the server already recorded for the session.
 *   - Counts: the session's resolved items, from its own items table (practice_session_items or
 *     review_session_items), owner column matched to the student.
 *   - Sent to review: `review_schedule` rows whose source is this session (the database trigger
 *     writes one per miss or skip, so this is what the student will find in Review, counted when it
 *     was queued, not after later graduations).
 *   - Streak: `readDailyStreak`, the read every surface shares; a failed read is `null` (unknown),
 *     as on the calendar and kpi/overall.
 *   - Mastery: `{ access: "locked" }` unless the student can access `mastery_detail` (the Mastery
 *     page's own gate, `canAccessFeature`; owner ruling 2026-10-15 on #1233: a locked line, never
 *     a level). With access, the
 *     mastery engine writes one `mastery_event_audit_log` row per applied event, with the skill's
 *     level before and after, keyed `(event_source_kind, event_id)` where the event id IS the
 *     session item's id (practice-canonical.ts and review-canonical.ts pass `eventId:
 *     sessionItem.id`). `summarizeMasteryChanges` (pure) takes, per skill, the level before the
 *     session's first event and after its last, and keeps the skills whose level differs. Nothing
 *     is computed beyond picking those two recorded values: no score, no estimate.
 *
 * trade-offs: an event another tab applied to the same skill between this session's first and last
 * events is inside the span, so it is part of the change shown; it was still an observed event.
 * Events the mastery engine failed to apply (warn-and-continue on the answer path) have no audit row
 * and so move nothing here, which is what the student's mastery really did.
 *
 * edge cases: a session with no answered items reads no audit rows. Levels are labelled through
 * `loadMasteryLevels` (the `mastery_levels` table), which throws on an unlabelled level; the route
 * answers 500 then, never an invented name.
 */
import { z } from "zod";
import type {
  SessionMasteryChange,
  SessionSummary,
  SessionSummaryMastery,
} from "../../packages/shared/src/session-summary-schema";
import type { Streak } from "../../packages/shared/src/home-qotd-schema";
import { masterySectionSchema } from "../../packages/shared/src/mastery-levels";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  loadMasteryLevels,
  type MasteryLevelLabels,
} from "../../apps/api/src/services/mastery-levels-read";
import { EntitlementService } from "./entitlement-service";
import { readDailyStreak } from "./activity-streak";
import { logger } from "../logger";
import { classifyError } from "../lib/redact";

export type SummaryEngine = "practice" | "review";

const ENGINE_TABLES: Record<
  SummaryEngine,
  {
    items: "practice_session_items" | "review_session_items";
    owner: "user_id" | "student_id";
    eventKinds: readonly string[];
  }
> = {
  practice: {
    items: "practice_session_items",
    owner: "user_id",
    eventKinds: ["practice_attempt", "diagnostic_attempt"],
  },
  review: {
    items: "review_session_items",
    owner: "student_id",
    eventKinds: ["review_error_attempt"],
  },
};

const itemRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  is_correct: z.boolean().nullable(),
  outcome: z.string().nullable(),
});

export type SessionCounts = {
  answered: number;
  correct: number;
  skipped: number;
  /** The answered items' ids: the mastery events' keys. */
  answeredItemIds: string[];
};

/** Pure: the counts from the session's resolved items. A skip is never an answer. */
export function countResolvedItems(
  rows: ReadonlyArray<z.infer<typeof itemRowSchema>>,
): SessionCounts {
  let correct = 0;
  let skipped = 0;
  const answeredItemIds: string[] = [];
  for (const row of rows) {
    if (row.status === "skipped" || row.outcome === "skipped") {
      skipped += 1;
      continue;
    }
    if (row.status !== "answered") continue;
    answeredItemIds.push(row.id);
    if (row.is_correct === true) correct += 1;
  }
  return {
    answered: answeredItemIds.length,
    correct,
    skipped,
    answeredItemIds,
  };
}

async function readCounts(
  engine: SummaryEngine,
  sessionId: string,
  studentId: string,
): Promise<SessionCounts> {
  const t = ENGINE_TABLES[engine];
  const { data, error } = await supabaseServer
    .from(t.items)
    .select("id, status, is_correct, outcome")
    .eq("session_id", sessionId)
    .eq(t.owner, studentId)
    .in("status", ["answered", "skipped"]);
  if (error)
    throw new Error(`${t.items}_summary_read_failed: ${error.message}`);
  return countResolvedItems(z.array(itemRowSchema).parse(data ?? []));
}

async function readSentToReview(
  engine: SummaryEngine,
  sessionId: string,
  studentId: string,
): Promise<number> {
  const { data, error } = await supabaseServer
    .from("review_schedule")
    .select("id")
    .eq("student_id", studentId)
    .eq("source_engine", engine)
    .eq("source_session_id", sessionId);
  if (error)
    throw new Error(`review_schedule_summary_read_failed: ${error.message}`);
  return z.array(z.object({ id: z.string() })).parse(data ?? []).length;
}

async function readStreakOrUnknown(
  studentId: string,
  now: Date,
  requestId: string | undefined,
): Promise<Streak | null> {
  try {
    return await readDailyStreak(studentId, now);
  } catch (readError) {
    logger.warn(
      "SESSION_SUMMARY",
      "streak_read_failed",
      "the daily streak could not be read; the summary serves it as unknown",
      { ...classifyError(readError), requestId },
    );
    return null;
  }
}

const auditRowSchema = z.object({
  section: z.string(),
  domain: z.string(),
  skill: z.string(),
  mastery_level_before: z.coerce.number().int().nullable(),
  mastery_level_after: z.coerce.number().int().nullable(),
  event_count_after: z.coerce.number().int(),
});
export type MasteryAuditRow = z.infer<typeof auditRowSchema>;

/**
 * Pure: per skill, the level before the session's first recorded event and after its last
 * (ordered by the skill's own event counter), kept only where they differ. Unmeasured (null) to a
 * level, and back, are changes; equal levels are not. Sorted by section, domain, skill so the
 * order is stable.
 */
export function summarizeMasteryChanges(
  rows: readonly MasteryAuditRow[],
  labels: Pick<MasteryLevelLabels, "forLevel">,
): SessionMasteryChange[] {
  const bySkill = new Map<
    string,
    { first: MasteryAuditRow; last: MasteryAuditRow }
  >();
  for (const row of rows) {
    const key = `${row.section}\u0000${row.domain}\u0000${row.skill}`;
    const seen = bySkill.get(key);
    if (seen === undefined) {
      bySkill.set(key, { first: row, last: row });
      continue;
    }
    if (row.event_count_after < seen.first.event_count_after) seen.first = row;
    if (row.event_count_after > seen.last.event_count_after) seen.last = row;
  }
  const changes: SessionMasteryChange[] = [];
  for (const { first, last } of bySkill.values()) {
    const before = first.mastery_level_before;
    const after = last.mastery_level_after;
    if (before === after) continue;
    const section = masterySectionSchema.safeParse(first.section);
    if (!section.success) continue;
    changes.push({
      section: section.data,
      domain: first.domain,
      skill: first.skill,
      before: labels.forLevel(before),
      after: labels.forLevel(after),
    });
  }
  return changes.sort(
    (a, b) =>
      a.section.localeCompare(b.section) ||
      a.domain.localeCompare(b.domain) ||
      a.skill.localeCompare(b.skill),
  );
}

async function readMasteryChanges(
  engine: SummaryEngine,
  studentId: string,
  answeredItemIds: readonly string[],
): Promise<SessionSummaryMastery> {
  if (!(await EntitlementService.canAccessFeature(studentId, "mastery_detail")))
    return { access: "locked" };
  return {
    access: "granted",
    changes: await readRecordedChanges(engine, studentId, answeredItemIds),
  };
}

async function readRecordedChanges(
  engine: SummaryEngine,
  studentId: string,
  answeredItemIds: readonly string[],
): Promise<SessionMasteryChange[]> {
  if (answeredItemIds.length === 0) return [];
  const { data, error } = await supabaseServer
    .from("mastery_event_audit_log")
    .select(
      "section, domain, skill, mastery_level_before, mastery_level_after, event_count_after",
    )
    .eq("student_id", studentId)
    .in("event_source_kind", [...ENGINE_TABLES[engine].eventKinds])
    .in("event_id", [...answeredItemIds]);
  if (error)
    throw new Error(
      `mastery_event_audit_log_summary_read_failed: ${error.message}`,
    );
  const rows = z.array(auditRowSchema).parse(data ?? []);
  if (rows.length === 0) return [];
  return summarizeMasteryChanges(rows, await loadMasteryLevels());
}

export type SummaryCore = Omit<
  SessionSummary,
  "engine" | "again" | "sessionId"
>;

/** The engine-independent part of the summary; the route adds `engine`, `sessionId`, `again`. */
export async function buildSessionSummaryCore(args: {
  engine: SummaryEngine;
  sessionId: string;
  studentId: string;
  now?: Date;
  requestId?: string;
}): Promise<SummaryCore> {
  const now = args.now ?? new Date();
  const counts = await readCounts(args.engine, args.sessionId, args.studentId);
  const [sentToReview, streak, mastery] = await Promise.all([
    readSentToReview(args.engine, args.sessionId, args.studentId),
    readStreakOrUnknown(args.studentId, now, args.requestId),
    readMasteryChanges(args.engine, args.studentId, counts.answeredItemIds),
  ]);
  return {
    state: "completed",
    answered: counts.answered,
    correct: counts.correct,
    skipped: counts.skipped,
    sent_to_review: sentToReview,
    streak,
    mastery,
  };
}
