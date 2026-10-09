/**
 * The daily-question email job.
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09), "Daily email":
 *       5 PM America/Chicago every day, correct across DST — the job sends only
 *       in the 17:00 Chicago hour; recipients consented, 13+, no question answered today, not
 *       paused or unsubscribed; idempotent via qotd_email_sends (write before send); the 7-send
 *       sunset; via Resend. SCL-223 (the test-date roll rides on this job)]
 *       | @implemented [2026-10-09]
 *
 * plain English, every run (three daily runs: 06:05, 22:00 and 23:00 UTC; see the cron route):
 *   1. Roll the study profiles' effective SAT date (`study_profile_roll_exam_dates`), so a date
 *      that has just passed hands over to the next one within the hour.
 *   2. If the America/Chicago hour is not 17, stop. The hour is computed from the zone database,
 *      so 17:00 CDT (22:00 UTC) in summer and 17:00 CST (23:00 UTC) in winter both qualify.
 *   3. Read today's question; no row → nothing to send.
 *   4. For each candidate from `qotd_email_candidates`: CLAIM today's one send (insert-once on
 *      (student_id, send_date)) BEFORE sending — a second run in the same hour finds the claim
 *      and skips. Then render, send with Resend (Idempotency-Key = the send id) and record.
 *      A student whose last 7 sends went unanswered gets the one "paused" email instead.
 *
 * A failed send stays `failed` for the day: there is no retry the same day, by design (one email
 * at most). Logs carry counts and send ids; never an address, a subject or a body.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import {
  QOTD_EMAIL_SEND_HOUR_CHICAGO,
  QOTD_EMAIL_SUNSET_SENDS,
} from "../../../packages/shared/src/home-qotd-schema";
import {
  defaultEmailTransport,
  type EmailTransport,
} from "../../lib/notifications/transport";
import { siteUrlFromEnv } from "../../lib/notifications/templates";
import {
  qotdDailyEmail,
  qotdPausedEmail,
} from "../../lib/notifications/templates/qotd-daily";
import { logger } from "../../logger";
import { qotdEmailLinkUrl } from "./qotd-email-links";
import { QOTD_TIME_ZONE, qotdToday, readQotd } from "./qotd-service";
import type { RpcClient } from "../../lib/rpc-client";

const COMPONENT = "QOTD_EMAIL";

export type QotdEmailJobSummary = {
  ok: boolean;
  rolled_exam_dates: number;
  chicago_hour: number;
  skipped?: "not_send_hour" | "no_question_today";
  candidates: number;
  sent: number;
  paused: number;
  failed: number;
  already_claimed: number;
};

/** What the job needs from the database: SQL functions only. */
export type QotdEmailJobDb = RpcClient;

export type QotdEmailJobDeps = {
  db: QotdEmailJobDb;
  transport: EmailTransport;
  siteUrl: string;
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

const candidateSchema = z.object({
  student_id: z.string().uuid(),
  email: z.string().nullable(),
  current_streak: z.number().int().min(0).nullable(),
  unanswered_run: z.number().int().min(0).nullable(),
});

async function record(
  db: QotdEmailJobDb,
  sendId: string,
  ok: boolean,
  providerMessageId: string | null,
  now: Date,
): Promise<void> {
  const { error } = await db.rpc("qotd_email_record", {
    p_send_id: sendId,
    p_ok: ok,
    p_provider_message_id: providerMessageId,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`qotd_email_record failed: ${error.message}`);
}

export async function runQotdEmailJob(
  deps: QotdEmailJobDeps,
): Promise<QotdEmailJobSummary> {
  const { db, transport, siteUrl, now } = deps;
  const summary: QotdEmailJobSummary = {
    ok: true,
    rolled_exam_dates: 0,
    chicago_hour: chicagoHour(now),
    candidates: 0,
    sent: 0,
    paused: 0,
    failed: 0,
    already_claimed: 0,
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

  // The job's own clock decides the day (so a run is reproducible at any instant).
  const row = await readQotd(db, qotdToday(now));
  if (row === null) return { ...summary, skipped: "no_question_today" };

  const { data, error } = await db.rpc("qotd_email_candidates", {
    p_now: now.toISOString(),
    p_limit: 5000,
  });
  if (error) throw new Error(`qotd_email_candidates failed: ${error.message}`);
  const candidates = z.array(candidateSchema).parse(data ?? []);
  summary.candidates = candidates.length;

  for (const c of candidates) {
    const sunset = (c.unanswered_run ?? 0) >= QOTD_EMAIL_SUNSET_SENDS;
    const kind = sunset ? "paused_notice" : "daily";
    const { data: claimed, error: claimError } = await db.rpc(
      "qotd_email_claim",
      { p_student_id: c.student_id, p_kind: kind, p_now: now.toISOString() },
    );
    if (claimError) {
      throw new Error(`qotd_email_claim failed: ${claimError.message}`);
    }
    const sendId = z.string().uuid().nullable().parse(claimed);
    if (sendId === null) {
      summary.already_claimed += 1;
      continue;
    }

    const address = c.email;
    if (address === null || address.trim() === "") {
      await record(db, sendId, false, null, now);
      summary.failed += 1;
      continue;
    }
    const unsubscribeUrl = qotdEmailLinkUrl(
      siteUrl,
      "unsubscribe",
      c.student_id,
    );
    const rendered = sunset
      ? qotdPausedEmail({
          resumeUrl: qotdEmailLinkUrl(siteUrl, "resume", c.student_id),
          unsubscribeUrl,
        })
      : qotdDailyEmail({
          currentStreak: c.current_streak ?? 0,
          stem: row.stem,
          siteUrl,
          unsubscribeUrl,
        });
    const sent = await transport({
      idempotencyKey: `qotd-email:${sendId}`,
      to: address,
      recipientProfileId: c.student_id,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(unsubscribeUrl
        ? {
            headers: {
              "List-Unsubscribe": `<${unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    });
    if (sent.ok) {
      await record(db, sendId, true, sent.value.providerMessageId, now);
      if (sunset) summary.paused += 1;
      else summary.sent += 1;
    } else {
      await record(db, sendId, false, null, now);
      summary.failed += 1;
    }
  }

  summary.ok = summary.failed === 0;
  logger.info(COMPONENT, "qotd_email_job_done", "Daily question email run", {
    candidates: summary.candidates,
    sent: summary.sent,
    paused: summary.paused,
    failed: summary.failed,
    alreadyClaimed: summary.already_claimed,
  });
  return summary;
}

export function defaultQotdEmailJobDeps(
  now: Date = new Date(),
): QotdEmailJobDeps {
  return {
    db: supabaseServer,
    transport: defaultEmailTransport(),
    siteUrl: siteUrlFromEnv(),
    now,
  };
}
