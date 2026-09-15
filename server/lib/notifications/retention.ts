/**
 * @spec [contracts/notifications.contract.md §11 — C11.1 (90-day window, defined once in
 *        SQL as `notification_retention_days()`), C11.2 (the sweep: ONE function, one
 *        transaction, two branches under one window — expired events with messages and
 *        matched delivery events by FK cascade, and unmatched delivery events aged on
 *        received_at — each bounded per call), C11.3 (every run logs its outcome, zero-row
 *        runs included, with both counts and the cutoff); Doc-06D_V1.0 §9 (a retention
 *        rule without a mechanism is retention drift); lyceon-coding-standards §7.1 (parse
 *        at the boundary), §12.1 (ids and counts only), §13 (no silent catch); owner briefs
 *        2026-09-15 Part A and 2026-09-16 (orphaned delivery events)]
 *        | @implemented [2026-09-15, amended 2026-09-16]
 *
 * plain English: the one code path that enforces notification retention. It calls the SQL
 * function that owns the rule and reports what happened. The window lives in SQL and ONLY
 * in SQL; this module passes a batch bound and reads back the cutoff the function used.
 *
 * WHY THE LOG LINE IS UNCONDITIONAL. Nobody can read the Vercel cron list from tooling, so a
 * sweep that was never scheduled would look exactly like a sweep that runs and finds nothing.
 * `retention_sweep_completed` is emitted on every run with the counts and the cutoff; its
 * absence from the logs over a day is the signal that the job is not running. Failure is
 * logged at error and rethrown to the route (500), never swallowed.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import {
  NOTIFICATION_RETENTION_SWEEP_BATCH_SIZE,
  notificationRetentionSweepRowSchema,
} from "../../../packages/shared/src/notifications-schema";
import { logger } from "../../logger";

export type NotificationRetentionSweepSummary = {
  deletedEvents: number;
  deletedMessages: number;
  /** Unmatched delivery events (no message) aged out on received_at — the orphan branch. */
  deletedOrphanDeliveryEvents: number;
  /** ISO timestamp: rows older than this (events by created_at, orphans by received_at) were eligible. */
  cutoff: string;
  /** Per-branch bound: at most this many events AND at most this many orphans per call. */
  batchSize: number;
  /** true when either branch hit its bound, so more rows may remain for the next run. */
  batchFull: boolean;
};

export async function sweepNotificationRetention(
  options: { batchSize?: number; requestId?: string } = {},
): Promise<NotificationRetentionSweepSummary> {
  const batchSize =
    options.batchSize ?? NOTIFICATION_RETENTION_SWEEP_BATCH_SIZE;

  const { data, error } = await supabaseServer.rpc(
    "sweep_notification_retention",
    { p_batch_size: batchSize },
  );
  if (error) {
    logger.error(
      "NOTIFICATIONS",
      "retention_sweep_failed",
      "sweep_notification_retention failed",
      {
        requestId: options.requestId,
        batchSize,
        code: error.code,
        message: error.message,
      },
    );
    throw new Error(`sweep_notification_retention failed: ${error.message}`);
  }

  const rows = z.array(notificationRetentionSweepRowSchema).safeParse(data);
  const row = rows.success ? rows.data[0] : undefined;
  if (!row) {
    logger.error(
      "NOTIFICATIONS",
      "retention_sweep_malformed",
      "sweep_notification_retention returned no parsable row",
      { requestId: options.requestId, batchSize },
    );
    throw new Error("sweep_notification_retention returned no parsable row");
  }

  const summary: NotificationRetentionSweepSummary = {
    deletedEvents: row.deleted_events,
    deletedMessages: row.deleted_messages,
    deletedOrphanDeliveryEvents: row.deleted_orphan_delivery_events,
    cutoff: row.cutoff,
    batchSize,
    batchFull:
      row.deleted_events >= batchSize ||
      row.deleted_orphan_delivery_events >= batchSize,
  };

  // C11.3 — on EVERY run, including a run that deleted nothing on BOTH branches.
  logger.info(
    "NOTIFICATIONS",
    "retention_sweep_completed",
    "Notification retention sweep finished",
    { requestId: options.requestId, ...summary },
  );

  return summary;
}
