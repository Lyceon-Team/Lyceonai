/**
 * The §12.5 weekly regeneration job.
 *
 * @spec [Doc-05F_V1.0 §12.5 (weekly job, R-08-30 Monday-anchored local ISO week),
 *        §7.8 `calendar_job_runs`, §12.1 (`weekly` trigger), §18 (job outcomes);
 *        lyceon-coding-standards §4.2, §13] | @implemented [2026-09-21]
 *
 * plain English: once per student per local week, replan the future half of the horizon so
 * a plan that has drifted out of date gets refreshed without the student asking. A student
 * who already got a horizon refresh this week is skipped, and every skip is recorded.
 *
 * "ONCE PER LOCAL WEEK," NEVER "AT 00:00." §12.5 is explicit about that, and it is why the
 * cron runs DAILY while the predicate — not the schedule — decides who generates. A student
 * who completed setup on Wednesday gets their first weekly run the following Monday, in
 * THEIR timezone, because `calendar_weekly_candidates` truncates the week in each student's
 * own zone. A schedule can only be right for one timezone; a predicate is right for all of
 * them.
 *
 * THE PREDICATE IS NOT IN THIS FILE. It is `calendar_weekly_candidates`, one SQL function,
 * because it is a query over three tables in a per-student timezone and a second copy here
 * would be a second answer to "is this student fresh". This file loops, calls the writer,
 * and records the outcome.
 *
 * PER-STUDENT ISOLATION. One student's failure is caught, recorded as `failed`, and the loop
 * continues. A job that aborts on the first bad row leaves everyone after it unplanned and
 * gives no clue which row it was.
 *
 * SAFE TO RERUN, TWICE OVER. The idempotency key is derived from (student, period_key), so a
 * rerun inside the same local week replays the ledger entry and writes no second version;
 * and even without the ledger the predicate itself would answer `skipped_fresh` on the
 * second pass. Rerunning is therefore cheap and never duplicates a plan.
 *
 * edge cases: a student with no profile, or one whose setup is unfinished, is not in the
 * population at all — `calendar_weekly_candidates` inner-joins the profile, and R-08-04 puts
 * their first generation on their first entitled open rather than here.
 *
 * KNOWN GAP, stated rather than worked around: §12.5 also routes failures to a Doc 06C
 * dead-letter. Doc 06C has not landed — a repository-wide search finds no dead-letter table
 * and no enqueue helper — so a failure is recorded in `calendar_job_runs` with its detail
 * and logged at ERROR, and nothing is enqueued. When 06C ships, the `failed` branch below is
 * where the enqueue goes.
 */
import { createHash } from "node:crypto";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";
import { classifyError } from "../../lib/redact";
import { loadCalendarConfig } from "./config";
import { regeneratePlan } from "./plan-service";

/** `calendar_job_runs.job` — the CHECK admits exactly this one value. */
export const WEEKLY_JOB = "weekly_regen" as const;

/** `calendar_job_runs.outcome`, the CHECK verbatim. */
export const JOB_OUTCOMES = [
  "ok",
  "skipped_fresh",
  "skipped_custom",
  "skipped_no_entitlement",
  "failed",
] as const;
export type JobOutcome = (typeof JOB_OUTCOMES)[number];

export type WeeklyJobSummary = {
  considered: number;
  ok: number;
  skipped_fresh: number;
  skipped_custom: number;
  skipped_no_entitlement: number;
  failed: number;
};

type Candidate = {
  student_id: string;
  period_key: string;
  /** null means "generate"; otherwise the skip this student gets recorded against. */
  outcome: string | null;
};

/**
 * `calendar:weekly:<student>:<period_key>`, hashed into a uuid because
 * `calendar_mutation_ledger.idempotency_key` is a uuid column.
 *
 * Deterministic per student-week, which is what makes a rerun a replay rather than a second
 * version. Exported for the test, and for nobody else.
 */
export function weeklyIdempotencyKey(studentId: string, periodKey: string): string {
  const digest = createHash("sha256")
    .update(`calendar:weekly:${studentId}:${periodKey}`, "utf8")
    .digest("hex");
  // RFC 4122 §4.4: a name-based key still has to be a well-formed uuid for the column to
  // take it, so the version and variant nibbles are set rather than left to the hash.
  const bytes = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ];
  return bytes.join("-");
}

async function recordRun(
  studentId: string,
  periodKey: string,
  outcome: JobOutcome,
  detail: Record<string, unknown> | null,
  requestId?: string,
): Promise<void> {
  const { error } = await supabaseServer.from("calendar_job_runs").insert({
    job: WEEKLY_JOB,
    student_id: studentId,
    period_key: periodKey,
    outcome,
    detail,
  });
  if (error) {
    // The plan itself may already have been written, so this is a bookkeeping failure and
    // not a reason to fail the student's run. Loud, and it does not throw.
    logger.error(
      "CALENDAR_JOB",
      "run_record_failed",
      "a calendar_job_runs row could not be written; the run itself is unaffected",
      { ...classifyError(error), outcome, requestId },
    );
  }
}

/**
 * One pass. Returns the counts §18's `calendar.job_run {job, outcome}` event reports.
 *
 * `limit` bounds one invocation so a cold start cannot try to replan the whole user base in
 * one request. The default matches the SQL function's own default.
 */
export async function runWeeklyRegeneration(options?: {
  limit?: number;
  requestId?: string;
}): Promise<WeeklyJobSummary> {
  const requestId = options?.requestId;
  const summary: WeeklyJobSummary = {
    considered: 0,
    ok: 0,
    skipped_fresh: 0,
    skipped_custom: 0,
    skipped_no_entitlement: 0,
    failed: 0,
  };

  const config = await loadCalendarConfig();
  const { data, error } = await supabaseServer.rpc("calendar_weekly_candidates", {
    p_limit: options?.limit ?? 500,
  });

  if (error) {
    logger.error(
      "CALENDAR_JOB",
      "candidates_read_failed",
      "the weekly job could not read its population; nothing was generated",
      { ...classifyError(error), requestId },
    );
    throw new Error(`calendar_weekly_candidates_failed: ${error.message}`);
  }

  const candidates = Array.isArray(data) ? (data as Candidate[]) : [];

  for (const candidate of candidates) {
    if (typeof candidate.student_id !== "string" || typeof candidate.period_key !== "string") {
      continue;
    }
    summary.considered += 1;

    // The SQL already decided. A skip is RECORDED, not filtered away: a student the job
    // passed over silently is a student nobody can explain later.
    if (candidate.outcome !== null) {
      const outcome = candidate.outcome as JobOutcome;
      if (outcome === "skipped_fresh") summary.skipped_fresh += 1;
      else if (outcome === "skipped_custom") summary.skipped_custom += 1;
      else if (outcome === "skipped_no_entitlement") summary.skipped_no_entitlement += 1;
      await recordRun(candidate.student_id, candidate.period_key, outcome, null, requestId);
      continue;
    }

    try {
      const result = await regeneratePlan(
        {
          student_id: candidate.student_id,
          // §12.1: `weekly`, `initiated_by: system`. That pairing is what makes the plan
          // show up in `latest_unacknowledged_nonstudent_change` and raise §17.4's banner —
          // a refresh the student did not ask for has to announce itself.
          trigger: "weekly",
          initiated_by: "system",
          generator_version: config.generatorVersion,
          idempotency_key: weeklyIdempotencyKey(candidate.student_id, candidate.period_key),
        },
        requestId,
      );

      if (result.ok) {
        summary.ok += 1;
        await recordRun(
          candidate.student_id,
          candidate.period_key,
          "ok",
          { version_no: result.value.version_no },
          requestId,
        );
        continue;
      }

      // A refusal the writer decided is still a failed run for this student. The KIND is
      // recorded; the plan scope, the timezone and the body are not (§18 "never logged").
      summary.failed += 1;
      await recordRun(
        candidate.student_id,
        candidate.period_key,
        "failed",
        { reason: result.error.kind },
        requestId,
      );
      logger.error(
        "CALENDAR_JOB",
        "weekly_regenerate_refused",
        "the weekly regeneration was refused for one student; the prior plan stands",
        { reason: result.error.kind, requestId },
      );
    } catch (thrown) {
      // Per-student isolation. One bad row must not leave everybody after it unplanned.
      summary.failed += 1;
      await recordRun(
        candidate.student_id,
        candidate.period_key,
        "failed",
        { reason: "threw" },
        requestId,
      );
      logger.error(
        "CALENDAR_JOB",
        "weekly_regenerate_threw",
        "the weekly regeneration threw for one student; the loop continued",
        { requestId, reason: thrown instanceof Error ? thrown.message : "unknown" },
      );
    }
  }

  // §18 `calendar.job_run {job, outcome}`. One line per pass, counts only — no student ids.
  logger.info("CALENDAR_JOB", "job_run", "the weekly calendar regeneration finished a pass", {
    job: WEEKLY_JOB,
    ...summary,
    requestId,
  });
  return summary;
}
