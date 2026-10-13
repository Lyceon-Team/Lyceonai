/**
 * QOTD health: the schedule horizon, the checks that alert the owner, and the monitored
 * schedule run.
 *
 * @spec [owner brief "QOTD resilience (no-question state, error logging, alerting)" (Karl,
 *       2026-10-09) §2 (the schedule job's one summary line; any failure at ERROR with the date
 *       and reason, no question content, no student data) and §3 (alert when the schedule job
 *       throws or inserts nothing when it should have; horizon < 7 after the job runs; no row
 *       for today, checked just after Chicago midnight; the same horizon check run from a
 *       different daily job, which catches the scheduler never running; at most one alert per
 *       condition per day; each alert names what is wrong, the horizon and the date questions
 *       run out; a recovery message once the horizon is back at 7 or more)]
 *       | @implemented [2026-10-09]
 *
 * plain English:
 *   - `readQotdHorizon`: today's America/Chicago date, whether today has a servable question, the
 *     first date with none (`runs_out_on`) and the horizon in whole days after today.
 *   - `checkQotdHealth`: runs the checks asked for (`noQuestionToday`, `horizon`), logs each
 *     problem at ERROR, and sends one alert per condition per day (the ledger enforces "per
 *     day"). With the horizon check on, a healthy reading (today covered, horizon >= 7) after
 *     an alert sends ONE recovery message.
 *   - `runMonitoredQotdSchedule`: the 07:15 UTC fill, wrapped: one summary line per run, every
 *     unfilled day at ERROR, a throw at ERROR plus an alert (then rethrown, so the route answers
 *     500), then both health checks.
 *
 * WHICH JOB CHECKS WHAT. The fill runs at 07:15 UTC and covers today + 7. The daily-email job
 * runs at 06:05, 22:00 and 23:00 UTC. At 06:05 (just after Chicago midnight) the new day's
 * +7 is not filled yet, so the horizon there is legitimately 6: that run checks only "is there a
 * question today". The two evening runs come after the fill, so they run the horizon check too:
 * if the fill never ran, they find 6 and alert. That is the independent check.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { defaultEmailTransport } from "../../lib/notifications/transport";
import {
  sendOpsAlert,
  type OpsAlert,
  type OpsAlertDeps,
  type OpsAlertOutcome,
} from "../../lib/ops-alerts";
import type { RpcClient } from "../../lib/rpc-client";
import { logger } from "../../logger";
import { runQotdSchedule, type QotdScheduleSummary } from "./schedule-job";
import type { QotdDbClient } from "./qotd-service";

const COMPONENT = "QOTD";

/** The horizon the owner wants: a week of questions after today, always. */
export const QOTD_MIN_HORIZON_DAYS = 7;

const horizonSchema = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  today_covered: z.boolean(),
  runs_out_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horizon: z.number().int().min(0),
});
export type QotdHorizon = z.infer<typeof horizonSchema>;

export async function readQotdHorizon(
  db: RpcClient,
  now: Date,
): Promise<QotdHorizon> {
  const { data, error } = await db.rpc("qotd_horizon", {
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`qotd_horizon failed: ${error.message}`);
  return horizonSchema.parse(data);
}

export type SendAlert = (alert: OpsAlert) => Promise<OpsAlertOutcome>;

function detailLines(h: QotdHorizon): string[] {
  return [
    `Horizon: ${h.horizon} day(s) of questions scheduled after today (${h.today}, America/Chicago).`,
    `Questions run out on ${h.runs_out_on}: that day has no Question of the Day yet.`,
    "Check the qotd-schedule job and the published, eligible question pool. If a scheduled question was unpublished, delete that day's qotd_schedule row and rerun the job (it never replaces a filled day).",
  ];
}

export type QotdHealthResult = {
  horizon: QotdHorizon;
  raised: OpsAlert["condition"][];
  recovered: boolean;
};

export async function checkQotdHealth(params: {
  db: RpcClient;
  now: Date;
  sendAlert: SendAlert;
  checks: { noQuestionToday: boolean; horizon: boolean };
  source: "schedule_job" | "daily_job";
}): Promise<QotdHealthResult> {
  const h = await readQotdHorizon(params.db, params.now);
  const raised: OpsAlert["condition"][] = [];

  if (params.checks.noQuestionToday && !h.today_covered) {
    logger.error(
      COMPONENT,
      "qotd_no_question_today",
      "No Question of the Day today",
      undefined,
      {
        date: h.today,
        horizon: h.horizon,
        runsOutOn: h.runs_out_on,
        source: params.source,
      },
    );
    await params.sendAlert({
      condition: "qotd_no_question_today",
      title: `No Question of the Day for today (${h.today})`,
      lines: detailLines(h),
    });
    raised.push("qotd_no_question_today");
  }

  if (params.checks.horizon && h.horizon < QOTD_MIN_HORIZON_DAYS) {
    logger.error(
      COMPONENT,
      "qotd_horizon_low",
      "QOTD schedule horizon under 7 days",
      undefined,
      {
        date: h.today,
        horizon: h.horizon,
        runsOutOn: h.runs_out_on,
        source: params.source,
      },
    );
    await params.sendAlert({
      condition: "qotd_horizon_low",
      title: `Question of the Day schedule is short: ${h.horizon} day(s) ahead`,
      lines: detailLines(h),
    });
    raised.push("qotd_horizon_low");
  }

  let recovered = false;
  if (
    params.checks.horizon &&
    raised.length === 0 &&
    h.today_covered &&
    h.horizon >= QOTD_MIN_HORIZON_DAYS
  ) {
    const { data, error } = await params.db.rpc("qotd_recovery_due", {});
    if (error) throw new Error(`qotd_recovery_due failed: ${error.message}`);
    if (z.boolean().parse(data)) {
      logger.info(
        COMPONENT,
        "qotd_schedule_recovered",
        "QOTD schedule recovered",
        {
          date: h.today,
          horizon: h.horizon,
          runsOutOn: h.runs_out_on,
        },
      );
      const outcome = await params.sendAlert({
        condition: "qotd_recovered",
        title: `Question of the Day schedule recovered: ${h.horizon} day(s) ahead`,
        lines: [
          `Horizon: ${h.horizon} day(s) of questions scheduled after today (${h.today}, America/Chicago).`,
          `Questions now run out on ${h.runs_out_on}.`,
        ],
      });
      // Recovered only when the message reached someone; a failed one stays due and is retried.
      recovered = outcome.slack === "sent" || outcome.email === "sent";
    }
  }

  return { horizon: h, raised, recovered };
}

/** The monitored 07:15 UTC fill (see the file header). */
export async function runMonitoredQotdSchedule(params: {
  client: QotdDbClient;
  now?: Date;
  deployHookUrl?: string | undefined;
  sendAlert: SendAlert;
  run?: typeof runQotdSchedule;
}): Promise<{ summary: QotdScheduleSummary; health: QotdHealthResult }> {
  const now = params.now ?? new Date();
  const started = Date.now();
  let summary: QotdScheduleSummary;
  try {
    summary = await (params.run ?? runQotdSchedule)({
      client: params.client,
      now,
      deployHookUrl: params.deployHookUrl,
    });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "unknown";
    logger.error(
      COMPONENT,
      "qotd_schedule_failed",
      "QOTD schedule job failed",
      undefined,
      {
        reason,
        durationMs: Date.now() - started,
      },
    );
    await params.sendAlert({
      condition: "qotd_schedule_failed",
      title: "The Question of the Day schedule job failed",
      lines: [
        `The 07:15 UTC fill stopped with an error (${reason.slice(0, 200)}).`,
        "Today's question may still exist; the evening daily check will report the horizon.",
      ],
    });
    throw err;
  }

  const unfilled = summary.days.filter((d) => d.outcome === "unfilled");
  for (const day of unfilled) {
    logger.error(
      COMPONENT,
      "qotd_schedule_day_unfilled",
      "No eligible question for a QOTD day",
      undefined,
      {
        date: day.date,
        reason: "no_eligible_candidate",
      },
    );
  }

  let health: QotdHealthResult;
  try {
    health = await checkQotdHealth({
      db: params.client,
      now,
      sendAlert: params.sendAlert,
      checks: { noQuestionToday: true, horizon: true },
      source: "schedule_job",
    });
  } catch (err: unknown) {
    // The monitor itself failing is the one failure the owner could not otherwise hear about.
    const reason = err instanceof Error ? err.message : "unknown";
    logger.error(
      COMPONENT,
      "qotd_health_check_failed",
      "QOTD health check failed",
      undefined,
      {
        reason,
        source: "schedule_job",
      },
    );
    await params.sendAlert({
      condition: "qotd_schedule_failed",
      title: "The Question of the Day health check could not read the schedule",
      lines: [
        `After the 07:15 UTC fill, the horizon could not be read (${reason.slice(0, 200)}).`,
        "The evening daily check will try again.",
      ],
    });
    throw err;
  }

  if (unfilled.length > 0) {
    await params.sendAlert({
      condition: "qotd_schedule_failed",
      title: `The Question of the Day schedule job could not fill ${unfilled.length} day(s)`,
      lines: [
        `No eligible question for: ${unfilled.map((d) => d.date).join(", ")}.`,
        ...detailLines(health.horizon),
      ],
    });
  }

  logger.info(COMPONENT, "qotd_schedule_run", "QOTD schedule run", {
    datesAttempted: summary.days.length,
    inserted: summary.days.filter((d) => d.outcome === "inserted").length,
    alreadyExisted: summary.days.filter((d) => d.outcome === "exists").length,
    unfilled: unfilled.length,
    horizon: health.horizon.horizon,
    runsOutOn: health.horizon.runs_out_on,
    deploy: summary.deploy,
    durationMs: Date.now() - started,
  });
  return { summary, health };
}

export function defaultOpsAlertDeps(now: Date = new Date()): OpsAlertDeps {
  return {
    db: supabaseServer,
    now,
    slackWebhookUrl: process.env.SLACK_ALERTS_WEBHOOK_URL || undefined,
    emailTo: process.env.OPS_ALERT_EMAIL || undefined,
    transport: defaultEmailTransport(),
    fetchImpl: fetch,
  };
}

export function defaultSendAlert(now: Date = new Date()): SendAlert {
  const deps = defaultOpsAlertDeps(now);
  return (alert) => sendOpsAlert(alert, deps);
}
