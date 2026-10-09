/**
 * What a `qotd_daily` email needs at send time that its payload deliberately does not carry.
 *
 * @spec [owner ruling on #1166 (Karl, 2026-10-09) item 1: reuse the notification system's
 *       sending, ledger, suppression and unsubscribe; contracts/notifications.contract.md §8.1
 *       (payload: identifiers and rendering parameters only)] | @implemented [2026-10-09]
 *
 * plain English: the payload names the day (`qotd_date`), never the question. At send time the
 * dispatcher reads that day's stem through the canonical QOTD read (`readQotd`) and builds the
 * recipient's signed unsubscribe and resume links. A paused notice needs no stem. Expected
 * failures come back as a Result so the dispatcher can record the row (it stays queued and is
 * retried within the attempt cap) instead of failing every other row.
 *
 * STALE IS FINAL. A daily-question email is about TODAY's question. If its row is still queued
 * once the America/Chicago day has passed (the evening dispatch failed and the next morning's
 * backstop sweep finds it), sending it would deliver yesterday's question in the middle of the
 * night. `final: true` tells the dispatcher to fail the row at once rather than retry it.
 *
 * WITHDRAWN IS FINAL TOO. The preference is re-read at send time (the same read Settings shows):
 * a student who unsubscribes, or turns the email off in Settings, after the 17:00 rule queued
 * their email is not sent it, and neither is an account that is no longer 13+-eligible. The rule
 * decides at emit time; this is the second check that makes a withdrawal take effect at once
 * (contract §2A; F-83 withdrawal intent).
 */
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { qotdEmailPreferenceSchema } from "../../../packages/shared/src/home-qotd-schema";
import { qotdDailyPayloadSchema } from "../../../packages/shared/src/notifications-schema";
import { err, ok, type Result } from "../../../packages/shared/src/result";
import { qotdEmailLinkUrl } from "../../services/qotd/qotd-email-links";
import { qotdToday, readQotd } from "../../services/qotd/qotd-service";
import type { RenderContext } from "./templates";

export async function qotdDailySendContext(
  payload: unknown,
  recipientProfileId: string,
  siteUrl: string,
  now: Date = new Date(),
): Promise<
  Result<
    NonNullable<RenderContext["qotdEmail"]>,
    { reason: string; final: boolean }
  >
> {
  const parsed = qotdDailyPayloadSchema.safeParse(payload);
  if (!parsed.success)
    return err({
      reason: "qotd_daily payload does not match its schema",
      final: false,
    });
  if (parsed.data.qotd_date !== qotdToday(now)) {
    return err({
      reason: "qotd_daily: its day has passed (stale, not sent)",
      final: true,
    });
  }
  try {
    // The same SQL read Settings shows (qotd_daily_email_preference). Called directly, not through
    // the QOTD service, so the dispatcher never imports the route layer.
    const { data, error } = await supabaseServer.rpc(
      "qotd_daily_email_preference",
      { p_student_id: recipientProfileId },
    );
    if (error)
      throw new Error(`qotd_daily_email_preference failed: ${error.message}`);
    const preference = qotdEmailPreferenceSchema.parse(data);
    if (!preference.enabled || !preference.eligible) {
      return err({
        reason:
          "qotd_daily: the email is off for this student (withdrawn, not sent)",
        final: true,
      });
    }
    const stem =
      parsed.data.email_variant === "daily"
        ? ((await readQotd(supabaseServer, parsed.data.qotd_date))?.stem ??
          null)
        : null;
    return ok({
      stem,
      unsubscribeUrl: qotdEmailLinkUrl(
        siteUrl,
        "unsubscribe",
        recipientProfileId,
      ),
      resumeUrl: qotdEmailLinkUrl(siteUrl, "resume", recipientProfileId),
    });
  } catch (error) {
    return err({
      reason: `qotd_daily send context failed: ${error instanceof Error ? error.message : "unknown"}`,
      final: false,
    });
  }
}
