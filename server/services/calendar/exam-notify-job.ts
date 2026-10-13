/**
 * The two practice-test notifications, once a day (Brief 14 Step 5).
 *
 * @spec [Doc-05F_V1.0 §8.1 (full-length placement), §12.5 (the daily-job pattern),
 *        §7.8 `calendar_job_runs`, §18 (job outcomes), §13 (progress is the allocator over
 *        engine events); contracts/notifications.contract.md §2.2, §2.3, §5.1, §5.2, §6.1;
 *        owner ruling 2026-09-26 ("two event types, not one with a kind in the payload")]
 * | @implemented [2026-09-27]
 *
 * plain English: a student with a practice test in their plan is told twice — on the Monday of
 * the week it falls in, and the day before. Expected outcome: exactly two notifications per
 * exam block, in the student's own dates, and none at all once the sitting is done.
 *
 * NOT A SECOND NOTIFICATION SYSTEM. The bell, the feed, the unread count, the dispatcher, the
 * Resend transport and the retention sweep all already exist and are untouched. This file adds
 * a population loop and calls the same `emit_notification_event` every other event goes
 * through, from inside a SQL function, in one transaction (contract §2.2).
 *
 * "ONCE A DAY," NEVER "ON MONDAY." Same reason as §12.5's weekly job: the cron fires in one
 * timezone and the students are in all of them. The schedule wakes the job;
 * `calendar_exam_notification_candidates` decides who is due, in each student's own zone. A
 * student in Auckland and one in Los Angeles each get their Monday notice on their own Monday.
 *
 * NEITHER PREDICATE NOR RULE LIVES IN THIS FILE. The population is
 * `calendar_exam_notification_candidates`; "the sitting is done" is
 * `calendar_full_length_complete`, called from `calendar_emit_exam_notification` and nowhere
 * else. This file loops, records the outcome, and delivers the email. A second copy of either
 * here would be a second answer to a question the database already answers.
 *
 * IDEMPOTENT WITHOUT A LEDGER. `notification_event_id(event_type, source_id)` hashes the type,
 * so `(block, week)` and `(block, tomorrow)` are two ids, and a replay of either is an
 * ON CONFLICT DO NOTHING inside the emit (contract §5.1, §5.2). Rerunning the job the same day
 * writes nothing and records `skipped_duplicate`. That is also why the two notices had to be
 * two EVENT TYPES rather than one type with a kind in its payload — one id per block would have
 * made the second notice a duplicate of the first.
 *
 * PER-STUDENT ISOLATION, as the weekly job has: one row's failure is caught, recorded as
 * `failed`, and the loop continues. A job that aborts on the first bad row leaves everybody
 * after it un-notified and gives no clue which row it was.
 *
 * RE-PLAN FIRST, THEN "THIS WEEK" (owner ruling, Karl 2026-10-09, schedule audit Step 2 item
 * 3(4)) | @implemented [2026-10-09]. The week notice must come after the student's weekly
 * re-plan for that local week, because the re-plan may move the exam. Crons cannot promise that
 * order (the weekly cron fires at one UTC instant and students' Mondays begin at many: a Chicago
 * student in CST was told on Monday and re-planned that night). So it is made structural, twice:
 *   1. this job, before notifying, re-plans every student who has a week notice due and whose
 *      week §12.5 still says "generate" (`ensureWeeklyReplan`, the weekly job's own code path),
 *      then reads the population AGAIN, so the notice names the re-planned exam;
 *   2. `calendar_emit_exam_notification` refuses a week notice while that predicate still says
 *      "generate" (`skipped_not_replanned`, recorded), whoever calls it.
 *
 * EMAIL IS DELIVERED INLINE, awaited (contract §6.1). Vercel may freeze the function the moment
 * the response is written, so fire-and-forget would leave the row queued until the next daily
 * sweep — a day late for a notice whose whole content is "tomorrow". The dispatcher never
 * throws; a failed send stays queued with its error and the sweep retries it.
 */
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";
import { classifyError } from "../../lib/redact";
import { dispatchQueuedMessages } from "../../lib/notifications/dispatch";
import { notificationEventId } from "../../lib/notifications/event-id";
import { ensureWeeklyReplan } from "./weekly-job";

/** `calendar_job_runs.job` — the value 20261012000000 added beside `weekly_regen`. */
export const EXAM_NOTIFY_JOB = "exam_notify" as const;

/**
 * The outcomes this job can record. A subset of `calendar_job_runs.outcome`'s CHECK: the three
 * `skipped_fresh` / `skipped_custom` values belong to the weekly job and are unreachable here.
 */
export const EXAM_NOTIFY_OUTCOMES = [
  "ok",
  "skipped_no_entitlement",
  "skipped_complete",
  "skipped_duplicate",
  "skipped_not_replanned",
  "failed",
] as const;
export type ExamNotifyOutcome = (typeof EXAM_NOTIFY_OUTCOMES)[number];

export type ExamNotifySummary = {
  considered: number;
  ok: number;
  skipped_no_entitlement: number;
  skipped_complete: number;
  skipped_duplicate: number;
  skipped_not_replanned: number;
  failed: number;
};

/** One row of `calendar_exam_notification_candidates`. */
type Candidate = {
  student_id: string;
  block_id: string;
  local_date: string;
  timezone: string;
  kind: string;
  period_key: string;
  /** null means "notify"; otherwise the skip this row gets recorded against. */
  outcome: string | null;
};

/**
 * The writer's return value, mapped to the outcome recorded. The mapping is here and nowhere
 * else, so a new return value from the SQL cannot be silently read as success.
 */
function outcomeFor(emitted: string): ExamNotifyOutcome | null {
  if (emitted === "emitted") return "ok";
  if (emitted === "skipped_complete") return "skipped_complete";
  if (emitted === "duplicate") return "skipped_duplicate";
  if (emitted === "skipped_not_replanned") return "skipped_not_replanned";
  return null;
}

async function recordRun(
  studentId: string,
  periodKey: string,
  outcome: ExamNotifyOutcome,
  detail: Record<string, unknown> | null,
  requestId?: string,
): Promise<void> {
  const { error } = await supabaseServer.from("calendar_job_runs").insert({
    job: EXAM_NOTIFY_JOB,
    student_id: studentId,
    period_key: periodKey,
    outcome,
    detail,
  });
  if (error) {
    // The notification may already be written, so this is a bookkeeping failure and not a
    // reason to fail the row. Loud, and it does not throw.
    logger.error(
      "CALENDAR_JOB",
      "run_record_failed",
      "a calendar_job_runs row could not be written; the notification itself is unaffected",
      { ...classifyError(error), job: EXAM_NOTIFY_JOB, outcome, requestId },
    );
  }
}

function isCandidate(value: unknown): value is Candidate {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.student_id === "string" &&
    typeof row.block_id === "string" &&
    typeof row.local_date === "string" &&
    typeof row.timezone === "string" &&
    typeof row.kind === "string" &&
    typeof row.period_key === "string" &&
    (row.outcome === null || typeof row.outcome === "string")
  );
}

async function readCandidates(
  limit: number,
  requestId: string | undefined,
): Promise<unknown[]> {
  const { data, error } = await supabaseServer.rpc(
    "calendar_exam_notification_candidates",
    { p_limit: limit },
  );

  if (error) {
    logger.error(
      "CALENDAR_JOB",
      "exam_notify_candidates_read_failed",
      "the exam notification job could not read its population; nothing was sent",
      { ...classifyError(error), requestId },
    );
    throw new Error(
      `calendar_exam_notification_candidates_failed: ${error.message}`,
    );
  }
  return Array.isArray(data) ? data : [];
}

/**
 * One pass. Returns the counts §18's `calendar.job_run {job, outcome}` event reports.
 *
 * `limit` bounds one invocation so a cold start cannot try to notify the whole user base in one
 * request. The default matches the SQL function's own.
 */
export async function runExamNotifications(options?: {
  limit?: number;
  requestId?: string;
}): Promise<ExamNotifySummary> {
  const requestId = options?.requestId;
  const summary: ExamNotifySummary = {
    considered: 0,
    ok: 0,
    skipped_no_entitlement: 0,
    skipped_complete: 0,
    skipped_duplicate: 0,
    skipped_not_replanned: 0,
    failed: 0,
  };
  const limit = options?.limit ?? 500;

  // Step 1: re-plan, for every student with a week notice due, whose week is not re-planned yet.
  // Distinct students, in the population's own stable order.
  const firstRead = await readCandidates(limit, requestId);
  const weekStudents = new Set<string>();
  for (const row of firstRead) {
    if (
      isCandidate(row) &&
      row.kind === "full_length_week" &&
      row.outcome === null
    ) {
      weekStudents.add(row.student_id);
    }
  }
  let replanned = 0;
  for (const studentId of weekStudents) {
    // A failure is logged inside; the emitter then refuses that student's notice and the
    // refusal is recorded below.
    if ((await ensureWeeklyReplan(studentId, requestId)) === "replanned") {
      replanned += 1;
    }
  }

  // Step 2: the population again, so a notice names the exam as re-planned. When nobody was
  // re-planned nothing moved, and the first read stands.
  const rows: unknown[] =
    replanned === 0 ? firstRead : await readCandidates(limit, requestId);

  for (const row of rows) {
    if (!isCandidate(row)) continue;
    summary.considered += 1;

    // The SQL already decided who is out of the population. A skip is RECORDED, not filtered
    // away: a student the job passed over silently is a student nobody can explain later.
    if (row.outcome !== null) {
      if (row.outcome === "skipped_no_entitlement") {
        summary.skipped_no_entitlement += 1;
        await recordRun(
          row.student_id,
          row.period_key,
          "skipped_no_entitlement",
          null,
          requestId,
        );
      } else {
        // An outcome this file does not know is a contract change, not a row to skip quietly.
        summary.failed += 1;
        await recordRun(
          row.student_id,
          row.period_key,
          "failed",
          { reason: "unknown_candidate_outcome" },
          requestId,
        );
        logger.error(
          "CALENDAR_JOB",
          "exam_notify_unknown_outcome",
          "the candidate predicate returned an outcome this job does not handle",
          { requestId },
        );
      }
      continue;
    }

    try {
      const emitted = await supabaseServer.rpc(
        "calendar_emit_exam_notification",
        {
          p_student_id: row.student_id,
          p_block_id: row.block_id,
          p_kind: row.kind,
          p_local_date: row.local_date,
          p_timezone: row.timezone,
        },
      );
      if (emitted.error) {
        throw new Error(emitted.error.message);
      }

      const outcome =
        typeof emitted.data === "string" ? outcomeFor(emitted.data) : null;
      if (outcome === null) {
        summary.failed += 1;
        await recordRun(
          row.student_id,
          row.period_key,
          "failed",
          { reason: "unknown_emit_result" },
          requestId,
        );
        logger.error(
          "CALENDAR_JOB",
          "exam_notify_unknown_emit_result",
          "calendar_emit_exam_notification returned a value this job does not handle",
          { requestId },
        );
        continue;
      }

      summary[outcome] += 1;
      await recordRun(
        row.student_id,
        row.period_key,
        outcome,
        { kind: row.kind },
        requestId,
      );

      // Contract §6.1 — deliver THIS event's email now, awaited. Only when something was
      // actually written: a duplicate or a completed exam has no queued row, and asking the
      // dispatcher to find one would be a pointless select on every rerun.
      if (outcome === "ok") {
        await dispatchQueuedMessages({
          eventId: notificationEventId(row.kind, row.block_id),
        });
      }
    } catch (thrown) {
      // Per-row isolation. One bad row must not leave everybody after it un-notified.
      summary.failed += 1;
      await recordRun(
        row.student_id,
        row.period_key,
        "failed",
        { reason: "threw" },
        requestId,
      );
      logger.error(
        "CALENDAR_JOB",
        "exam_notify_threw",
        "an exam notification threw for one row; the loop continued",
        {
          requestId,
          reason: thrown instanceof Error ? thrown.message : "unknown",
        },
      );
    }
  }

  // §18 `calendar.job_run {job, outcome}`. One line per pass, counts only — no student ids, no
  // block ids, no dates.
  logger.info(
    "CALENDAR_JOB",
    "job_run",
    "the exam notification job finished a pass",
    { job: EXAM_NOTIFY_JOB, ...summary, requestId },
  );
  return summary;
}
