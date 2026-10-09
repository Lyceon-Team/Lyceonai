/**
 * The daily-question reminder job: the 17:00 Chicago rule of the `qotd_daily` notification.
 *
 * @spec [owner rulings on #1166 (Karl, 2026-10-09) item 1: "one scheduled rule at 17:00 Chicago
 *       (keep the two daily UTC crons): if the student has answered no question today, create the
 *       notification and deliver on the student's enabled channels; reuse the notification
 *       system's email sending, ledger, suppression and unsubscribe; keep the 7-day pause rule
 *       inside the notification rule"; owner brief "Question of the Day on Home" (Karl,
 *       2026-10-08/09) "Daily email" (5 PM America/Chicago, correct across DST); SCL-223 (the
 *       test-date roll rides on this job); contracts/notifications.contract.md §2.3, §4]
 *       | @implemented [2026-10-09]
 *
 * plain English, every run (three daily runs: 06:05, 22:00 and 23:00 UTC; see the cron route):
 *   1. Roll the study profiles' effective SAT date (`study_profile_roll_exam_dates`).
 *   2. If the America/Chicago hour is not 17, stop. 17:00 CDT is 22:00 UTC and 17:00 CST is
 *      23:00 UTC, so exactly one of the two evening runs passes on any day.
 *   3. Run the rule, `qotd_daily_notify`, in batches until a batch comes back short: one
 *      `qotd_daily` event per student who has answered nothing today, in-app always and email on
 *      the student's enabled channel (the SQL decides who, including the 7-send pause).
 *   4. Hand the queued emails to the notification dispatcher, the same one every other email
 *      uses: Idempotency-Key = message id, Resend's suppression list, the attempt cap.
 *
 * One per student per day is the ledger's guarantee, not this job's: the event id is
 * deterministic per (student, day), so a second run (or both evening crons) emits nothing new and
 * the dispatcher never sends a message twice. Logs carry counts only.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { QOTD_EMAIL_SEND_HOUR_CHICAGO } from "../../../packages/shared/src/home-qotd-schema";
import {
  dispatchQueuedMessages,
  type DispatchOptions,
  type DispatchSummary,
} from "../../lib/notifications/dispatch";
import { logger } from "../../logger";
import { QOTD_TIME_ZONE } from "./qotd-service";
import type { RpcClient } from "../../lib/rpc-client";

const COMPONENT = "QOTD_EMAIL";

/** Events per `qotd_daily_notify` call; the job calls again while a full batch comes back. */
const NOTIFY_BATCH = 1000;
/** Dispatcher passes per run; each pass sends at most DISPATCH_BATCH queued emails. */
const DISPATCH_BATCH = 100;
const MAX_DISPATCH_PASSES = 50;

export type QotdEmailJobSummary = {
  ok: boolean;
  rolled_exam_dates: number;
  chicago_hour: number;
  skipped?: "not_send_hour";
  emitted: number;
  with_email: number;
  paused_notices: number;
  sent: number;
  failed: number;
};

export type QotdEmailJobDeps = {
  db: RpcClient;
  dispatch: (options: DispatchOptions) => Promise<DispatchSummary>;
  now: Date;
};

/** The America/Chicago wall-clock hour (0-23) at `now`. DST is the zone database's job. */
export function chicagoHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: QOTD_TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return Number(hour);
}

const notifyResultSchema = z.object({
  emitted: z.number().int().min(0),
  with_email: z.number().int().min(0),
  paused_notices: z.number().int().min(0),
});

export async function runQotdEmailJob(
  deps: QotdEmailJobDeps,
): Promise<QotdEmailJobSummary> {
  const { db, dispatch, now } = deps;
  const summary: QotdEmailJobSummary = {
    ok: true,
    rolled_exam_dates: 0,
    chicago_hour: chicagoHour(now),
    emitted: 0,
    with_email: 0,
    paused_notices: 0,
    sent: 0,
    failed: 0,
  };

  const { data: rolled, error: rollError } = await db.rpc(
    "study_profile_roll_exam_dates",
    {},
  );
  if (rollError) {
    throw new Error(
      `study_profile_roll_exam_dates failed: ${rollError.message}`,
    );
  }
  summary.rolled_exam_dates = z.number().int().min(0).parse(rolled);

  if (summary.chicago_hour !== QOTD_EMAIL_SEND_HOUR_CHICAGO) {
    return { ...summary, skipped: "not_send_hour" };
  }

  for (;;) {
    const { data, error } = await db.rpc("qotd_daily_notify", {
      p_now: now.toISOString(),
      p_limit: NOTIFY_BATCH,
    });
    if (error) throw new Error(`qotd_daily_notify failed: ${error.message}`);
    const batch = notifyResultSchema.parse(data);
    summary.emitted += batch.emitted;
    summary.with_email += batch.with_email;
    summary.paused_notices += batch.paused_notices;
    if (batch.emitted < NOTIFY_BATCH) break;
  }

  if (summary.with_email > 0) {
    for (let pass = 0; pass < MAX_DISPATCH_PASSES; pass += 1) {
      const d = await dispatch({ limit: DISPATCH_BATCH, now });
      summary.sent += d.sent;
      summary.failed += d.failed;
      if (d.selectFailed) {
        summary.ok = false;
        break;
      }
      if (d.selected < DISPATCH_BATCH || d.sent === 0) break;
    }
  }

  summary.ok = summary.ok && summary.failed === 0;
  logger.info(COMPONENT, "qotd_daily_rule_done", "Daily question rule run", {
    emitted: summary.emitted,
    withEmail: summary.with_email,
    pausedNotices: summary.paused_notices,
    sent: summary.sent,
    failed: summary.failed,
  });
  return summary;
}

export function defaultQotdEmailJobDeps(
  now: Date = new Date(),
): QotdEmailJobDeps {
  return {
    db: supabaseServer,
    dispatch: (options) => dispatchQueuedMessages(options),
    now,
  };
}
