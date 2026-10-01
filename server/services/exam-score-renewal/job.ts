/**
 * The post-exam score prompt, the renewal reminder, and the silence that ends a subscription.
 *
 * @spec [Doc-01_V8 §36.4 (the payer decides), §955 (canceled at period end);
 *        Doc-05F_V1.0 §7.10 `calendar_job_runs`, §12.5 (the daily-job pattern), §18 (outcomes);
 *        contracts/notifications.contract.md §2.2, §2.3, §6.1;
 *        SCL-191; owner rulings 2026-09-30 (#1 the billing-cycle fallback, #3 the 14-day window,
 *        #5 consume the existing job shape, #6 cancellation writes to Stripe)]
 * | @implemented [2026-09-30]
 *
 * plain English: once a day, ask the students whose exam has passed what they scored and whether
 * they are retaking; ask the payers whose subscription is about to renew whether to keep going;
 * and, for anyone who was asked a fortnight ago and has said nothing, tell Stripe to stop the
 * subscription at the end of the period they have already paid for. Expected outcome: nobody is
 * charged months after they stopped studying, and every score we are given arrives beside the
 * projection that was live when they sat the exam.
 *
 * NOT A SECOND SCHEDULED-JOB SYSTEM (owner ruling 2026-09-30 #5: "Consume the existing job shape.
 * Do not fork a second scheduled-job pattern."). This is `exam-notify-job.ts`'s shape, line for
 * line: a SQL candidates function that returns an outcome rather than a filtered list, a SQL
 * emitter that is the only write path, per-row isolation, `calendar_job_runs` for the record, and
 * the same `dispatchQueuedMessages` every other event goes through. The bell, the feed, the
 * dispatcher, the Resend transport and the retention sweep are untouched.
 *
 * "ONCE A DAY," NEVER "ON THE EIGHTEENTH DAY." Same reason as §12.5's weekly job and the
 * practice-test notices: the cron fires in one timezone and the students are in all of them. The
 * schedule wakes the job; `exam_score_renewal_candidates` decides who is due, in each student's
 * own zone (owner ruling 2026-09-30 #5, "timezone in the predicate").
 *
 * TAKE THE PATTERN, NOT THE PREDICATE — the owner's caution, and it is load-bearing. The calendar's
 * `full_length` blocks are PRACTICE tests inside a study plan; this job is about the real sitting,
 * which the calendar does not model at all. The anchor is `student_study_profile.target_exam_date`
 * and nothing else, and `calendar_full_length_complete` is deliberately not consulted: whether a
 * student finished a practice test says nothing about whether they sat the SAT.
 *
 * NEITHER PREDICATE NOR RULE LIVES IN THIS FILE. The population is
 * `exam_score_renewal_candidates`; the silence rule is `exam_renewal_no_answer_candidates`; who
 * receives what is `exam_score_renewal_emit`; the Stripe write is `setCancelAtPeriodEnd`. This
 * file loops, records the outcome, and delivers the email.
 *
 * IDEMPOTENT WITHOUT A LEDGER. `notification_event_id(event_type, source_id)` hashes the type, and
 * the source id is `<student>:<occasion>`, so the score prompt and the renewal prompt for one
 * occasion are two ids and a replay of either is an ON CONFLICT DO NOTHING inside the emit.
 * Rerunning the job the same day writes nothing and records `skipped_duplicate` — §5 of the brief:
 * "a job that runs twice must not email twice."
 *
 * PER-STUDENT ISOLATION, as both existing jobs have: one row's failure is caught, recorded as
 * `failed`, and the loop continues.
 *
 * EMAIL IS DELIVERED INLINE, awaited (contract §6.1), for the same reason the practice-test job
 * does it: Vercel may freeze the function the moment the response is written, and a notice whose
 * whole content is a question deserves better than waiting for the next sweep.
 */
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";
import { classifyError } from "../../lib/redact";
import { dispatchQueuedMessages } from "../../lib/notifications/dispatch";
import { notificationEventId } from "../../lib/notifications/event-id";
import { getExamRenewalConfig } from "../../lib/entitlement-runtime-config";
import { setCancelAtPeriodEnd } from "../../lib/stripe/renewal-cancellation";
import type { NotificationEventType } from "../../../packages/shared/src/notifications-schema";

/** `calendar_job_runs.job` — the value 20261015000000 added beside the two calendar jobs. */
export const EXAM_SCORE_RENEWAL_JOB = "exam_score_renewal" as const;

/**
 * The outcomes this job can record. A subset of `calendar_job_runs.outcome`'s CHECK: the
 * calendar's three (`skipped_fresh`, `skipped_custom`, `skipped_complete`) are unreachable here.
 */
export const EXAM_SCORE_RENEWAL_OUTCOMES = [
  "ok",
  "skipped_no_entitlement",
  "skipped_cancel_pending",
  "skipped_new_exam_date",
  "skipped_answered",
  "skipped_duplicate",
  "canceled_no_answer",
  "failed",
] as const;
export type ExamScoreRenewalOutcome =
  (typeof EXAM_SCORE_RENEWAL_OUTCOMES)[number];

export type ExamScoreRenewalSummary = {
  considered: number;
  ok: number;
  skipped_no_entitlement: number;
  skipped_cancel_pending: number;
  skipped_new_exam_date: number;
  skipped_answered: number;
  skipped_duplicate: number;
  canceled_no_answer: number;
  failed: number;
};

function emptySummary(): ExamScoreRenewalSummary {
  return {
    considered: 0,
    ok: 0,
    skipped_no_entitlement: 0,
    skipped_cancel_pending: 0,
    skipped_new_exam_date: 0,
    skipped_answered: 0,
    skipped_duplicate: 0,
    canceled_no_answer: 0,
    failed: 0,
  };
}

/** One row of `exam_score_renewal_candidates`. */
type PromptCandidate = {
  student_id: string;
  payer_profile_id: string | null;
  timezone: string;
  anchor: string;
  occasion_key: string;
  /** null means "prompt"; otherwise the skip this row gets recorded against. */
  outcome: string | null;
};

/** One row of `exam_renewal_no_answer_candidates`. */
type SilenceCandidate = {
  student_id: string;
  anchor: string;
  occasion_key: string;
  stripe_subscription_id: string | null;
  outcome: string | null;
};

function isPromptCandidate(value: unknown): value is PromptCandidate {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.student_id === "string" &&
    (row.payer_profile_id === null ||
      typeof row.payer_profile_id === "string") &&
    typeof row.timezone === "string" &&
    typeof row.anchor === "string" &&
    typeof row.occasion_key === "string" &&
    (row.outcome === null || typeof row.outcome === "string")
  );
}

function isSilenceCandidate(value: unknown): value is SilenceCandidate {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.student_id === "string" &&
    typeof row.anchor === "string" &&
    typeof row.occasion_key === "string" &&
    (row.stripe_subscription_id === null ||
      typeof row.stripe_subscription_id === "string") &&
    (row.outcome === null || typeof row.outcome === "string")
  );
}

/**
 * A candidate's outcome string, mapped to an outcome this job records. The mapping is here and
 * nowhere else, so a new value from the SQL cannot be silently read as success.
 */
function skipOutcomeFor(value: string): ExamScoreRenewalOutcome | null {
  switch (value) {
    case "skipped_no_entitlement":
      return "skipped_no_entitlement";
    case "skipped_cancel_pending":
      return "skipped_cancel_pending";
    case "skipped_new_exam_date":
      return "skipped_new_exam_date";
    case "skipped_answered":
      return "skipped_answered";
    default:
      return null;
  }
}

/**
 * Which notices this candidate is owed.
 *
 * EDGE CASE 4, AND THE WHOLE OF IT. The brief's own framing is the answer: "the student reports
 * the score; the guardian pays and decides renewal." So on the exam anchor the student is always
 * asked for the score (which, on a self-paid subscription, is also where the retake question
 * lives), and the payer is asked about the money only when the payer is somebody else. A
 * self-paid student gets ONE email about their sitting, not two on the same morning. On the
 * billing-cycle anchor there is no sitting, so only the renewal question is asked — owner ruling
 * 2026-09-30 #1.
 */
export function noticesFor(
  candidate: Pick<
    PromptCandidate,
    "anchor" | "student_id" | "payer_profile_id"
  >,
): readonly NotificationEventType[] {
  if (candidate.anchor !== "exam_date") {
    return ["renewal_decision_requested"];
  }
  const payerIsSomebodyElse =
    candidate.payer_profile_id !== null &&
    candidate.payer_profile_id !== candidate.student_id;
  return payerIsSomebodyElse
    ? ["exam_score_report_requested", "renewal_decision_requested"]
    : ["exam_score_report_requested"];
}

async function recordRun(
  studentId: string,
  periodKey: string,
  outcome: ExamScoreRenewalOutcome,
  detail: Record<string, unknown> | null,
  requestId?: string,
): Promise<void> {
  const { error } = await supabaseServer.from("calendar_job_runs").insert({
    job: EXAM_SCORE_RENEWAL_JOB,
    student_id: studentId,
    period_key: periodKey,
    outcome,
    detail,
  });
  if (error) {
    // The notification or the Stripe write may already have happened, so this is a bookkeeping
    // failure and not a reason to fail the row. Loud, and it does not throw.
    logger.error(
      "BILLING_JOB",
      "run_record_failed",
      "a calendar_job_runs row could not be written; the work it describes is unaffected",
      {
        ...classifyError(error),
        job: EXAM_SCORE_RENEWAL_JOB,
        outcome,
        requestId,
      },
    );
  }
}

async function runPromptPass(
  summary: ExamScoreRenewalSummary,
  thresholds: {
    offsetDays: number;
    maxExamAgeDays: number;
    reminderLeadDays: number;
  },
  limit: number,
  requestId?: string,
): Promise<void> {
  const { data, error } = await supabaseServer.rpc(
    "exam_score_renewal_candidates",
    {
      p_offset_days: thresholds.offsetDays,
      p_max_exam_age_days: thresholds.maxExamAgeDays,
      p_lead_days: thresholds.reminderLeadDays,
      p_limit: limit,
    },
  );

  if (error) {
    logger.error(
      "BILLING_JOB",
      "renewal_candidates_read_failed",
      "the post-exam job could not read its population; nothing was sent",
      { ...classifyError(error), requestId },
    );
    throw new Error(`exam_score_renewal_candidates_failed: ${error.message}`);
  }

  const rows: unknown[] = Array.isArray(data) ? data : [];

  for (const row of rows) {
    if (!isPromptCandidate(row)) continue;
    summary.considered += 1;

    // The SQL already decided who is out of the population. A skip is RECORDED, not filtered
    // away: a student the job passed over silently is a student nobody can explain later.
    if (row.outcome !== null) {
      const mapped = skipOutcomeFor(row.outcome);
      if (mapped === null) {
        // An outcome this file does not know is a contract change, not a row to skip quietly.
        summary.failed += 1;
        await recordRun(
          row.student_id,
          row.occasion_key,
          "failed",
          { reason: "unknown_candidate_outcome" },
          requestId,
        );
        logger.error(
          "BILLING_JOB",
          "renewal_unknown_outcome",
          "the candidate predicate returned an outcome this job does not handle",
          { requestId },
        );
        continue;
      }
      summary[mapped] += 1;
      await recordRun(
        row.student_id,
        row.occasion_key,
        mapped,
        { anchor: row.anchor },
        requestId,
      );
      continue;
    }

    try {
      const sourceId = `${row.student_id}:${row.occasion_key}`;
      const emitted: NotificationEventType[] = [];
      let unknownResult = false;

      for (const eventType of noticesFor(row)) {
        const result = await supabaseServer.rpc("exam_score_renewal_emit", {
          p_student_id: row.student_id,
          p_anchor: row.anchor,
          p_occasion_key: row.occasion_key,
          p_payer_profile_id: row.payer_profile_id,
          p_event_type: eventType,
        });
        if (result.error) throw new Error(result.error.message);
        if (result.data === "emitted") emitted.push(eventType);
        else if (result.data !== "duplicate") unknownResult = true;
      }

      if (unknownResult) {
        summary.failed += 1;
        await recordRun(
          row.student_id,
          row.occasion_key,
          "failed",
          { reason: "unknown_emit_result" },
          requestId,
        );
        logger.error(
          "BILLING_JOB",
          "renewal_unknown_emit_result",
          "exam_score_renewal_emit returned a value this job does not handle",
          { requestId },
        );
        continue;
      }

      // ANY fresh notice makes the pass a write for this student. All duplicates means the day
      // was already done — the shape a rerun takes, and the shape §5's "must not email twice"
      // asks to be observable.
      const outcome: ExamScoreRenewalOutcome =
        emitted.length > 0 ? "ok" : "skipped_duplicate";
      summary[outcome] += 1;
      await recordRun(
        row.student_id,
        row.occasion_key,
        outcome,
        { anchor: row.anchor, notices: emitted.length },
        requestId,
      );

      // Contract §6.1 — deliver THESE events' email now, awaited. Only for what was actually
      // written: a duplicate has no queued row and asking the dispatcher to find one would be a
      // pointless select on every rerun.
      for (const eventType of emitted) {
        await dispatchQueuedMessages({
          eventId: notificationEventId(eventType, sourceId),
        });
      }
    } catch (thrown) {
      summary.failed += 1;
      await recordRun(
        row.student_id,
        row.occasion_key,
        "failed",
        { reason: "threw" },
        requestId,
      );
      logger.error(
        "BILLING_JOB",
        "renewal_prompt_threw",
        "a post-exam prompt threw for one row; the loop continued",
        {
          requestId,
          reason: thrown instanceof Error ? thrown.message : "unknown",
        },
      );
    }
  }
}

async function runSilencePass(
  summary: ExamScoreRenewalSummary,
  windowDays: number,
  limit: number,
  requestId?: string,
): Promise<void> {
  const { data, error } = await supabaseServer.rpc(
    "exam_renewal_no_answer_candidates",
    { p_window_days: windowDays, p_limit: limit },
  );

  if (error) {
    logger.error(
      "BILLING_JOB",
      "renewal_silence_read_failed",
      "the post-exam job could not read the no-answer population; nothing was cancelled",
      { ...classifyError(error), requestId },
    );
    throw new Error(
      `exam_renewal_no_answer_candidates_failed: ${error.message}`,
    );
  }

  const rows: unknown[] = Array.isArray(data) ? data : [];

  for (const row of rows) {
    if (!isSilenceCandidate(row)) continue;
    summary.considered += 1;

    if (row.outcome !== null) {
      const mapped = skipOutcomeFor(row.outcome);
      if (mapped === null) {
        summary.failed += 1;
        await recordRun(
          row.student_id,
          row.occasion_key,
          "failed",
          { reason: "unknown_candidate_outcome" },
          requestId,
        );
        continue;
      }
      summary[mapped] += 1;
      await recordRun(
        row.student_id,
        row.occasion_key,
        mapped,
        { anchor: row.anchor, phase: "silence" },
        requestId,
      );
      continue;
    }

    if (row.stripe_subscription_id === null) {
      // An entitled student with no subscription id is an entitlement written by something other
      // than a Stripe subscription (a comp, a manual grant). There is nothing to cancel and
      // nothing this job can do about it, and inventing a cancellation would be worse.
      summary.failed += 1;
      await recordRun(
        row.student_id,
        row.occasion_key,
        "failed",
        { reason: "no_subscription_id" },
        requestId,
      );
      logger.error(
        "BILLING_JOB",
        "renewal_silence_no_subscription",
        "an entitled student is past the no-answer window with no Stripe subscription to cancel",
        { requestId },
      );
      continue;
    }

    // Owner ruling 2026-09-30 #6: the write goes to Stripe, never to our column. Our row catches
    // up when `customer.subscription.updated` arrives.
    const applied = await setCancelAtPeriodEnd(
      row.stripe_subscription_id,
      true,
      requestId === undefined ? {} : { requestId },
    );

    if (applied.kind === "failed") {
      summary.failed += 1;
      await recordRun(
        row.student_id,
        row.occasion_key,
        "failed",
        { reason: "stripe_cancel_failed", phase: "silence" },
        requestId,
      );
      continue;
    }

    if (applied.kind === "already") {
      // Stripe held it and our row did not — the pre-webhook window, or a cancellation made in
      // the Customer Portal. Recorded as the skip it is, not as a cancellation this job made.
      summary.skipped_cancel_pending += 1;
      await recordRun(
        row.student_id,
        row.occasion_key,
        "skipped_cancel_pending",
        { anchor: row.anchor, phase: "silence", source: "stripe" },
        requestId,
      );
      continue;
    }

    summary.canceled_no_answer += 1;
    await recordRun(
      row.student_id,
      row.occasion_key,
      "canceled_no_answer",
      { anchor: row.anchor, windowDays },
      requestId,
    );
  }
}

/**
 * One pass: the prompts, then the silences. Returns the counts §18's
 * `calendar.job_run {job, outcome}` event reports.
 *
 * THE ORDER IS PROMPTS FIRST, AND IT DOES NOT MATTER — but it is worth saying why, because the
 * obvious worry is wrong. A prompt written in this pass cannot be swept in the same pass: the
 * silence predicate requires `prompted_at <= now - windowDays`, and a row created seconds ago is
 * not. The two passes are independent; running them in one request is a scheduling convenience,
 * not a pipeline.
 *
 * `limit` bounds each pass so a cold start cannot try to notify the whole user base in one
 * request. The default matches the SQL functions' own.
 */
export async function runExamScoreRenewal(options?: {
  limit?: number;
  requestId?: string;
}): Promise<ExamScoreRenewalSummary> {
  const requestId = options?.requestId;
  const limit = options?.limit ?? 500;
  const summary = emptySummary();

  const config = await getExamRenewalConfig();
  if (!config.ok) {
    // Fail closed and loudly. A misconfigured window is the one state in which running would be
    // worse than not running: it would cancel subscriptions after the invoice it exists to stop.
    throw new Error(`exam_score_renewal_config_refused: ${config.error}`);
  }

  await runPromptPass(
    summary,
    {
      offsetDays: config.value.offsetDays,
      maxExamAgeDays: config.value.maxExamAgeDays,
      reminderLeadDays: config.value.reminderLeadDays,
    },
    limit,
    requestId,
  );
  await runSilencePass(
    summary,
    config.value.noAnswerWindowDays,
    limit,
    requestId,
  );

  // §18 `calendar.job_run {job, outcome}`. One line per pass, counts only — no student ids, no
  // occasion dates, no scores.
  logger.info(
    "BILLING_JOB",
    "job_run",
    "the post-exam score and renewal job finished a pass",
    { job: EXAM_SCORE_RENEWAL_JOB, ...summary, requestId },
  );
  return summary;
}
