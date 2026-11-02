/**
 * The email send gate's daily pass: the SAT milestones, the state sweep, and the Resend mirror.
 *
 * @spec [owner brief "Email send gate" (Karl, 2026-10-30): states, transitions "mirrored to
 *       Resend contact property email_state with retry, never blocking sends"; owner rulings
 *       2026-11-02 round 2 (the milestones; "Got your scores?" on College Board's release day,
 *       skipped when no date is published); contracts/notifications.contract.md C15]
 *       | @implemented [2026-11-02]
 *
 * plain English, in order, inside the existing 14:00 UTC dispatch sweep (no new cron):
 *   1. `email_milestones_notify` emits the week-before, day-after and release-day emails that are
 *      due, with College Board's release dates from `SAT_TEST_DATES` (only dates it published).
 *   2. `email_gate_sweep` refreshes every student's and guardian's state, in pages, recording
 *      each change (and the pause note on entering paused).
 *   3. The Resend mirror: each queued `email_state` is PATCHed onto the person's existing Resend
 *      contact. A failure backs off in SQL (`email_gate_outbox_mark`) and is retried next run;
 *      it never blocks or delays a send.
 * The dispatch that follows (the sweep route) sends whatever steps 1 and 2 queued.
 *
 * trade-offs: each step's failure is logged and the next step still runs; the route reports
 * them. The address read for the mirror is used for the one PATCH and never logged.
 */
import { z } from "zod";
import { SAT_TEST_DATES } from "../../../shared/sat-test-dates";
import {
  EMAIL_GATE_RESEND_PROPERTY,
  emailGateOutboxRowSchema,
  emailGateSweepResultSchema,
  emailMilestonesResultSchema,
} from "../../../packages/shared/src/email-gate";
import type { RpcClient } from "../../lib/rpc-client";
import {
  createResendContactPropertiesUpdater,
  type ContactPropertiesUpdater,
} from "../../lib/notifications/transport";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";

const COMPONENT = "EMAIL_GATE";
export const EMAIL_GATE_SWEEP_PAGE = 500;
const EMAIL_GATE_SWEEP_MAX_PAGES = 200;
export const EMAIL_GATE_OUTBOX_BATCH = 100;
const EMAIL_GATE_OUTBOX_MAX_BATCHES = 20;

export type EmailGateJobDeps = {
  db: RpcClient;
  updateContactProperties: ContactPropertiesUpdater;
  now: Date;
};

export type EmailGateJobSummary = {
  ok: boolean;
  milestones: z.infer<typeof emailMilestonesResultSchema> | null;
  swept: number;
  changed: number;
  mirrored: number;
  mirrorFailed: number;
};

/**
 * Test date -> College Board's published student score release date. A date without one is
 * absent, so its release-day email is skipped (ruling 2026-11-02).
 */
export function scoreReleaseDates(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of SAT_TEST_DATES) {
    if (d.deadlines) out[d.date] = d.deadlines.scores_released;
  }
  return out;
}

export async function runEmailGateJob(
  deps: EmailGateJobDeps,
): Promise<EmailGateJobSummary> {
  const { db, now } = deps;
  const summary: EmailGateJobSummary = {
    ok: true,
    milestones: null,
    swept: 0,
    changed: 0,
    mirrored: 0,
    mirrorFailed: 0,
  };

  // 1. Milestones.
  const m = await db.rpc("email_milestones_notify", {
    p_now: now.toISOString(),
    p_release_dates: scoreReleaseDates(),
  });
  if (m.error) {
    summary.ok = false;
    logger.error(
      COMPONENT,
      "milestones_failed",
      "Milestone rule failed",
      undefined,
      {
        reason: m.error.message,
      },
    );
  } else {
    summary.milestones = emailMilestonesResultSchema.parse(m.data);
  }

  // 2. The state sweep.
  let after: string | null = null;
  for (let page = 0; page < EMAIL_GATE_SWEEP_MAX_PAGES; page += 1) {
    const r = await db.rpc("email_gate_sweep", {
      p_now: now.toISOString(),
      p_limit: EMAIL_GATE_SWEEP_PAGE,
      ...(after === null ? {} : { p_after: after }),
    });
    if (r.error) {
      summary.ok = false;
      logger.error(
        COMPONENT,
        "sweep_failed",
        "Email gate sweep failed",
        undefined,
        {
          reason: r.error.message,
        },
      );
      break;
    }
    const result = emailGateSweepResultSchema.parse(r.data);
    summary.swept += result.processed;
    summary.changed += result.changed;
    if (result.processed < EMAIL_GATE_SWEEP_PAGE || result.last_id === null)
      break;
    after = result.last_id;
  }

  // 3. The Resend mirror.
  for (let batch = 0; batch < EMAIL_GATE_OUTBOX_MAX_BATCHES; batch += 1) {
    const due = await db.rpc("email_gate_outbox_due", {
      p_now: now.toISOString(),
      p_limit: EMAIL_GATE_OUTBOX_BATCH,
    });
    if (due.error) {
      summary.ok = false;
      logger.error(
        COMPONENT,
        "outbox_read_failed",
        "Mirror queue read failed",
        undefined,
        {
          reason: due.error.message,
        },
      );
      break;
    }
    const rows = z.array(emailGateOutboxRowSchema).parse(due.data ?? []);
    for (const row of rows) {
      const result = await deps.updateContactProperties(
        row.email,
        { [EMAIL_GATE_RESEND_PROPERTY]: row.email_state },
        { recipientProfileId: row.profile_id },
      );
      const mark = await db.rpc("email_gate_outbox_mark", {
        p_profile_id: row.profile_id,
        p_email_state: row.email_state,
        p_ok: result.ok,
        p_error: result.ok
          ? null
          : `${result.error.kind}:${result.error.status ?? ""}`,
        p_now: now.toISOString(),
      });
      if (mark.error) {
        summary.ok = false;
        logger.error(
          COMPONENT,
          "outbox_mark_failed",
          "Mirror mark failed",
          undefined,
          {
            profileId: row.profile_id,
            reason: mark.error.message,
          },
        );
      }
      if (result.ok) summary.mirrored += 1;
      else summary.mirrorFailed += 1;
    }
    // A failed row is backed off past `now`, so the next read never returns it again this run.
    if (rows.length < EMAIL_GATE_OUTBOX_BATCH) break;
  }

  logger.info(COMPONENT, "email_gate_job_done", "Email gate daily pass", {
    ok: summary.ok,
    weekBefore: summary.milestones?.week_before ?? null,
    dayAfter: summary.milestones?.day_after ?? null,
    scoresReleased: summary.milestones?.scores_released ?? null,
    swept: summary.swept,
    changed: summary.changed,
    mirrored: summary.mirrored,
    mirrorFailed: summary.mirrorFailed,
  });
  return summary;
}

export function defaultEmailGateJobDeps(
  now: Date = new Date(),
): EmailGateJobDeps {
  return {
    db: supabaseServer,
    updateContactProperties: createResendContactPropertiesUpdater(),
    now,
  };
}
