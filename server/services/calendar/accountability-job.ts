/**
 * The evening accountability job: missed planned days, back on track, and the guardian digest.
 *
 * @spec [owner brief "Guardian accountability loop (plan changes, missed days, daily digest)"
 *       (Karl, 2026-10-13): "Missed days and back on track", "Delivery" ("one email at 6 PM
 *       Chicago (two UTC cron entries with a Chicago-hour guard, like the QOTD email), only if
 *       there's something to report that day"); Doc-05F_V1.0 §13, §14; contracts/
 *       notifications.contract.md §2.3, §6.2 (amended in the same change)] | @implemented [2026-10-13]
 *
 * plain English, every run (two daily runs, 23:00 and 00:00 UTC; see the cron route):
 *   1. If the America/Chicago hour is not 18, stop. 18:00 CDT is 23:00 UTC and 18:00 CST is
 *      00:00 UTC, so exactly one of the two runs passes on any day (the QOTD job's pattern).
 *   2. For every entitled student with a finished calendar setup, read the days since the last
 *      evaluation through the calendar's own read model (`readAccountabilityDays`: the same
 *      assembly and §13 allocator both calendars use; it generates nothing), turn them into
 *      did_work / missed outcomes (`evaluateAccountabilityDays`, pure) and hand them to the SQL
 *      rule, `accountability_record_day_outcomes`, which owns the run, emits the missed-plan alert
 *      and the back-on-track note in the same transaction as the state change, and records the
 *      digest day's completion. One student's failure is logged and counted; the loop goes on.
 *   3. Run `guardian_daily_digest_notify` in batches: one digest per guardian per Chicago day,
 *      only when there is something to report and the guardian's digest email is on.
 *   4. Hand the queued emails of the three types this run creates — and only those — to the
 *      notification dispatcher (Idempotency-Key = message id, Resend's suppression list, the
 *      attempt cap, the event's expiry, quiet hours). Every other type keeps the daily sweep as
 *      its one retry path.
 *
 * One alert per run, one digest per guardian per day: the ledger's guarantee, not this job's.
 * Every event id is deterministic (student + day, guardian + day) and the state row is locked and
 * skips days already evaluated, so a rerun or both crons emit and send nothing new. Logs carry
 * counts only — never a name, a date of birth or a plan.
 *
 * FIRST RUN FOR A STUDENT. With no state row the rule starts from yesterday, so a student is not
 * told on the day this ships about a run of misses that began before it. LOOKBACK_DAYS bounds the
 * read if the job has not run for a while.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { addDaysToLocalDate, evaluateAccountabilityDays } from "@lyceon/shared";
import {
  GUARDIAN_DIGEST_SEND_HOUR_CHICAGO,
  GUARDIAN_DIGEST_TIME_ZONE,
  type NotificationEventType,
} from "../../../packages/shared/src/notifications-schema";
import {
  dispatchQueuedMessages,
  type DispatchOptions,
  type DispatchSummary,
} from "../../lib/notifications/dispatch";
import type { RpcClient } from "../../lib/rpc-client";
import { logger } from "../../logger";
import { localHourIn, localTodayIn } from "./adapters/local-day";
import type { readAccountabilityDays } from "./read-service";

const COMPONENT = "ACCOUNTABILITY";

/** Students per candidates page. */
const CANDIDATE_BATCH = 500;
/** Guardians per digest call; the job calls again while a full batch comes back. */
const DIGEST_BATCH = 500;
/** Dispatcher passes per type; each pass sends at most DISPATCH_BATCH queued emails. */
const DISPATCH_BATCH = 100;
const MAX_DISPATCH_PASSES = 50;
/** The furthest back one run reads for a student (a job that missed days catches up this far). */
export const LOOKBACK_DAYS = 14;

/** The three types this run creates and therefore sends. */
export const ACCOUNTABILITY_EMAIL_TYPES: readonly NotificationEventType[] = [
  "missed_plan_alert",
  "back_on_track",
  "guardian_daily_digest",
];

export type AccountabilityJobSummary = {
  ok: boolean;
  chicago_hour: number;
  skipped?: "not_send_hour";
  students: number;
  student_failures: number;
  alerts: number;
  back_on_track: number;
  digests: number;
  sent: number;
  failed: number;
};

export type AccountabilityJobDeps = {
  db: RpcClient;
  readDays: typeof readAccountabilityDays;
  dispatch: (options: DispatchOptions) => Promise<DispatchSummary>;
  now: Date;
};

const candidateRowSchema = z.object({
  student_id: z.string().uuid(),
  timezone: z.string().min(1),
  last_evaluated_date: z
    .union([z.string(), z.date(), z.null()])
    .transform((v) =>
      v === null
        ? null
        : typeof v === "string"
          ? v.slice(0, 10)
          : v.toISOString().slice(0, 10),
    ),
});

const outcomeResultSchema = z.object({
  alerts: z.number().int().min(0),
  back_on_track: z.number().int().min(0),
});

const digestResultSchema = z.object({
  emitted: z.number().int().min(0),
  guardians: z.number().int().min(0),
});

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}
function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** The days this run evaluates for one student: [from, today], and the read window. */
export function evaluationWindow(input: {
  today: string;
  lastEvaluated: string | null;
  digestDate: string;
}): { from: string; readFrom: string; readTo: string; through: string } {
  const yesterday = addDaysToLocalDate(input.today, -1);
  const floor = addDaysToLocalDate(input.today, -LOOKBACK_DAYS);
  const from = maxDate(
    input.lastEvaluated === null
      ? yesterday
      : addDaysToLocalDate(input.lastEvaluated, 1),
    floor,
  );
  return {
    from,
    readFrom: minDate(minDate(from, input.digestDate), input.today),
    readTo: maxDate(input.today, input.digestDate),
    through: yesterday,
  };
}

async function evaluateStudent(
  deps: AccountabilityJobDeps,
  row: z.infer<typeof candidateRowSchema>,
  digestDate: string,
): Promise<{ alerts: number; backOnTrack: number }> {
  const today = localTodayIn(row.timezone, deps.now);
  const window = evaluationWindow({
    today,
    lastEvaluated: row.last_evaluated_date,
    digestDate,
  });
  const read = await deps.readDays({
    student_id: row.student_id,
    from: window.readFrom,
    to: window.readTo,
    now: deps.now,
  });
  if (read === null) return { alerts: 0, backOnTrack: 0 };
  const evaluation = evaluateAccountabilityDays({
    days: read.days,
    from: window.from,
    today: read.today,
    digestDate,
  });
  const { data, error } = await deps.db.rpc(
    "accountability_record_day_outcomes",
    {
      p_student_id: row.student_id,
      p_days: JSON.stringify(evaluation.days),
      p_through: window.through,
      p_digest_date: digestDate,
      p_completion_planned: evaluation.completion.planned,
      p_completion_completed: evaluation.completion.completed,
      p_now: deps.now.toISOString(),
    },
  );
  if (error) {
    throw new Error(
      `accountability_record_day_outcomes failed: ${error.message}`,
    );
  }
  const result = outcomeResultSchema.parse(data);
  return { alerts: result.alerts, backOnTrack: result.back_on_track };
}

export async function runGuardianAccountabilityJob(
  deps: AccountabilityJobDeps,
): Promise<AccountabilityJobSummary> {
  const summary: AccountabilityJobSummary = {
    ok: true,
    chicago_hour: localHourIn(GUARDIAN_DIGEST_TIME_ZONE, deps.now),
    students: 0,
    student_failures: 0,
    alerts: 0,
    back_on_track: 0,
    digests: 0,
    sent: 0,
    failed: 0,
  };
  if (summary.chicago_hour !== GUARDIAN_DIGEST_SEND_HOUR_CHICAGO) {
    return { ...summary, skipped: "not_send_hour" };
  }
  const digestDate = localTodayIn(GUARDIAN_DIGEST_TIME_ZONE, deps.now);

  // 2. Missed days and back on track, per student.
  let after: string | null = null;
  for (;;) {
    const page = await deps.db.rpc("accountability_evaluation_candidates", {
      p_limit: CANDIDATE_BATCH,
      ...(after === null ? {} : { p_after: after }),
    });
    if (page.error) {
      throw new Error(
        `accountability_evaluation_candidates failed: ${page.error.message}`,
      );
    }
    const rows = z.array(candidateRowSchema).parse(page.data);
    for (const row of rows) {
      summary.students += 1;
      try {
        const done = await evaluateStudent(deps, row, digestDate);
        summary.alerts += done.alerts;
        summary.back_on_track += done.backOnTrack;
      } catch (error: unknown) {
        summary.student_failures += 1;
        logger.error(
          COMPONENT,
          "accountability_student_failed",
          "Could not evaluate one student's planned days; the run continues",
          undefined,
          {
            studentId: row.student_id,
            reason: error instanceof Error ? error.message : "unknown",
          },
        );
      }
    }
    const last = rows[rows.length - 1];
    if (rows.length < CANDIDATE_BATCH || last === undefined) break;
    after = last.student_id;
  }

  // 3. The digests.
  for (;;) {
    const { data, error } = await deps.db.rpc("guardian_daily_digest_notify", {
      p_now: deps.now.toISOString(),
      p_limit: DIGEST_BATCH,
    });
    if (error) {
      throw new Error(`guardian_daily_digest_notify failed: ${error.message}`);
    }
    const batch = digestResultSchema.parse(data);
    summary.digests += batch.emitted;
    if (batch.guardians < DIGEST_BATCH) break;
  }

  // 4. Send what this run created.
  for (const eventType of ACCOUNTABILITY_EMAIL_TYPES) {
    for (let pass = 0; pass < MAX_DISPATCH_PASSES; pass += 1) {
      const d = await deps.dispatch({
        limit: DISPATCH_BATCH,
        now: deps.now,
        eventType,
      });
      summary.sent += d.sent;
      summary.failed += d.failed;
      if (d.selectFailed) {
        summary.ok = false;
        break;
      }
      if (d.selected < DISPATCH_BATCH || d.sent === 0) break;
    }
  }

  summary.ok =
    summary.ok && summary.failed === 0 && summary.student_failures === 0;
  logger.info(
    COMPONENT,
    "accountability_run_done",
    "Guardian accountability run",
    {
      students: summary.students,
      studentFailures: summary.student_failures,
      alerts: summary.alerts,
      backOnTrack: summary.back_on_track,
      digests: summary.digests,
      sent: summary.sent,
      failed: summary.failed,
    },
  );
  return summary;
}

export function defaultAccountabilityJobDeps(
  now: Date = new Date(),
): AccountabilityJobDeps {
  return {
    db: supabaseServer,
    // Loaded on first use: the read model pulls in the engine adapters, whose modules mount
    // routers, and the cron route file that imports this job must not load them at import time.
    readDays: async (request) =>
      (await import("./read-service")).readAccountabilityDays(request),
    dispatch: (options) => dispatchQueuedMessages(options),
    now,
  };
}
