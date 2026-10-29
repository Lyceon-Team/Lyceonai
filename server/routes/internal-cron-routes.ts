import crypto from "node:crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { logger } from "../logger.js";
import { getSupabaseAdmin } from "../middleware/supabase-auth.js";
import { drainAllPendingLegalAcceptances } from "../lib/legal-acceptance.js";
import {
  executeDueDeletions,
  isDeletionLifecycleV2Enabled,
} from "../lib/account-deletion-execute.js";
import { getBreachedCases } from "../services/crisis-review-queue";
import {
  runVideoLinkCheck,
  youtubeFetcher,
} from "../services/video-link-check";
import { notifySlaBreaches } from "../services/crisis-notification";
import {
  oidcAuthMiddlewareWithConfigGuard,
  type OidcConfigReader,
} from "../../packages/shared/internal-auth/verify-oidc-middleware";
import {
  sweepStalePracticeSessions,
  STALE_PRACTICE_SESSION_TTL_DAYS,
} from "../lib/stale-session-sweep.js";
import { sweepStaleReviewSessions } from "../lib/review-stale-session-sweep.js";
import { readBaselinePendingReport } from "../lib/baseline-pending.js";
import { diagnosticProjectionRepairResultSchema } from "../../packages/shared/src/diagnostic-projection.js";
import { dispatchQueuedMessages } from "../lib/notifications/dispatch.js";
import {
  defaultLifecycleRuleDeps,
  runLifecycleRule,
  type LifecycleRuleSummary,
} from "../lib/lifecycle-email.js";
import { runLandingSummaries } from "../services/landing/landing-service";
import { sweepNotificationRetention } from "../lib/notifications/retention.js";
import {
  sweepOperationalLogRetention,
  sweepFinancialRecordRetention,
} from "../lib/retention/sweeps.js";
import { runWeeklyRegeneration } from "../services/calendar/weekly-job.js";
import { runExamNotifications } from "../services/calendar/exam-notify-job.js";
import {
  defaultAccountabilityJobDeps,
  runGuardianAccountabilityJob,
} from "../services/calendar/accountability-job.js";
import { runExamScoreRenewal } from "../services/exam-score-renewal/job.js";
import {
  defaultOpsAlertDeps,
  defaultSendAlert,
  runMonitoredQotdSchedule,
} from "../services/qotd/qotd-health.js";
import { sendOpsAlert } from "../lib/ops-alerts.js";
import type { QotdDbClient } from "../services/qotd/qotd-service.js";
import { reconcileMarketingContacts } from "../lib/marketing-email-sync.js";
import { ALL_BLOG_POSTS } from "../../shared/content/blog.js";
import { runContentPublish } from "../services/content/publish-job.js";
import { quietHoursDeferral } from "../lib/notifications/quiet-hours.js";
import {
  defaultQotdEmailJobDeps,
  runQotdEmailJob,
} from "../services/qotd/qotd-email-job.js";
import {
  runReviewAskEmailRule,
  type ReviewAskEmailSummary,
} from "../services/product-feedback/review-ask-email-job.js";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1/§3 | AS1-DRAIN-LIVENESS-001] | @implemented 2026-06-18
 * plain English: cron-only endpoints. The legal-acceptance drain guarantees eventual recording of
 * queued consent independent of user navigation (the /api/profile drain is only the fast path — a
 * user who never returns would otherwise leave consent durable-but-unrecorded). Secured by CRON_SECRET:
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when that env var is set. Unauthorized (or
 * unconfigured) => 404, so the endpoint reveals nothing and fails closed.
 */
const router = Router();

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Timing-safe comparison (Doc-01A §63/§67) — constant-time so the secret can't be brute-forced
  // via response-time side-channel.
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(req.get("authorization") ?? "");
  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
}

router.get(
  "/legal-acceptance-drain",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const usersDrained =
        await drainAllPendingLegalAcceptances(getSupabaseAdmin());
      logger.info(
        "AUTH",
        "legal_acceptance_drain_job",
        "Scheduled legal-acceptance drain completed",
        { usersDrained },
      );
      res.json({ ok: true, usersDrained });
    } catch (err) {
      logger.error(
        "AUTH",
        "legal_acceptance_drain_job_error",
        "Scheduled legal-acceptance drain endpoint failed",
        err,
      );
      res.status(500).json({ error: "drain_failed" });
    }
  },
);

/**
 * GET /api/internal/execute-deletions
 * @spec [Doc-01 §40.5 Hard delete at T+7] cron-only anonymize pass. Vercel Cron dispatches GET
 * (matching the legal-acceptance-drain pattern). The IRREVERSIBLE path is behind TWO gates:
 *   1. CRON_SECRET (like the legal-acceptance drain) — nothing but the scheduled job can trigger it;
 *      unauthorized/unconfigured => 404 (fails closed, reveals nothing).
 *   2. ACCOUNT_DELETION_LIFECYCLE_V2 — flag-OFF is genuinely dormant: a no-op acknowledgement, no
 *      selector, no deidentify_user call. So shipping with the staged migration unapplied / flag off
 *      cannot anonymize anyone.
 *
 * SCHEDULE AND QUIET HOURS (owner ruling, Karl 2026-10-09, schedule audit Step 2 items 1 and 2)
 * | @implemented [2026-10-09]: scheduled at 15:00 UTC (vercel.json `0 15 * * *`) = 10:00 CDT /
 * 09:00 CST, so the deletion-completed email it sends is never due in quiet hours. A run that
 * lands in 21:00–08:00 America/Chicago anyway (a manual trigger) does nothing and says so: the
 * notice is not exempt, and it cannot be postponed past the step after it — the do-not-contact
 * suppression added right after the notice would swallow a notice scheduled for 08:00 (the
 * executor's step 7 comment). The next scheduled run, at most a few hours later, does the work.
 */
router.get(
  "/execute-deletions",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!isDeletionLifecycleV2Enabled()) {
      // Flag OFF: destructive path inert. Acknowledge to the scheduler as a no-op, not an error.
      res.json({
        ok: true,
        skipped: "lifecycle_v2_disabled",
        executedCount: 0,
      });
      return;
    }
    if (quietHoursDeferral(new Date()) !== null) {
      // Quiet hours (owner ruling 2026-10-09): no deletion-completed email at night. Not an error.
      logger.info(
        "DELETION",
        "execute_deletions_quiet_hours",
        "Anonymize pass skipped: inside 21:00-08:00 America/Chicago; the next scheduled run does it",
      );
      res.json({ ok: true, skipped: "quiet_hours", executedCount: 0 });
      return;
    }
    try {
      const { executedCount, skippedCount, failedCount } =
        await executeDueDeletions(getSupabaseAdmin(), req.requestId);
      logger.info(
        "DELETION",
        "execute_deletions_job",
        "Scheduled anonymize pass completed",
        { executedCount, skippedCount, failedCount },
      );
      res.json({ ok: true, executedCount, skippedCount, failedCount });
    } catch (err) {
      logger.error(
        "DELETION",
        "execute_deletions_job_error",
        "Scheduled anonymize pass failed",
        err,
      );
      res.status(500).json({ error: "execute_deletions_failed" });
    }
  },
);

/**
 * POST /api/internal/crisis-sla-sweep
 * @spec [Doc-03_V3 §21.3; Doc-03C_V3 §9.3; CC Brief "Close the LISA Vertical" PR 2.2]
 * @implemented 2026-08-13 | rescheduled 2026-09-23
 *
 * plain English: finds open crisis review cases past their 48h SLA deadline
 * and logs an ERROR alert for each run that finds any. Does not auto-resolve
 * or auto-escalate — the sweep is an alerting mechanism so ops can
 * prioritize breached cases.
 *
 * WHY POST + OIDC (was GET + CRON_SECRET). Nothing ever called the GET: it
 * was in neither vercel.json nor infra/terraform. An hourly cadence (this
 * handler's documented schedule) cannot live in vercel.json — the Hobby plan
 * rejects any cron more frequent than daily (see baseline-pending-sweep
 * below) — so the caller is Cloud Scheduler
 * (`google_cloud_scheduler_job.crisis_sla_sweep`, infra/terraform/
 * cloud-scheduler-crisis.tf), which signs an OIDC token rather than sending
 * CRON_SECRET. The guard is the same one the retention sweep uses: `aud`
 * must equal CRISIS_SLA_SWEEP_OIDC_AUDIENCE and `email` must equal
 * CLOUD_TASKS_SERVICE_ACCOUNT. Deliberately NO fallback to
 * CLOUD_TASKS_OIDC_AUDIENCE: that is a different URL, so a fallback could only
 * convert a visible "config missing" 500 (ERROR) into an hourly 401.
 *
 * ALERTING (closure plan W2-2a, 2026-09-24). A sweep that finds breaches
 * logs ERROR `sla_breach_detected` AND posts one Slack message naming every
 * breached case to LYCEON_CRISIS_ALERTS, through the same Cloud Tasks path a
 * new case uses (notifySlaBreaches). Before this the sweep stopped at the log
 * line. Breached means unresolved — open OR claimed (in_review) — past the
 * deadline, and the alert repeats on every sweep while the breach stands;
 * the turn-path two-minute throttle does not apply to a scheduled sweep.
 */
const readSlaSweepOidcConfig: OidcConfigReader = () => ({
  expectedAudience: process.env.CRISIS_SLA_SWEEP_OIDC_AUDIENCE,
  expectedServiceAccount: process.env.CLOUD_TASKS_SERVICE_ACCOUNT,
});

router.post(
  "/crisis-sla-sweep",
  oidcAuthMiddlewareWithConfigGuard(readSlaSweepOidcConfig),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const breachedCases = await getBreachedCases();

      if (breachedCases.length > 0) {
        logger.error(
          "CRISIS_SLA",
          "sla_breach_detected",
          `${breachedCases.length} crisis review case(s) past SLA deadline`,
          undefined,
          {
            breachedCount: breachedCases.length,
            caseIds: breachedCases.map((c) => c.id as string),
            oldestDeadline: breachedCases[0]?.sla_deadline,
          },
        );
        await notifySlaBreaches(
          breachedCases.map((c) => ({
            caseId: String(c.id),
            status: c.status === "in_review" ? "in_review" : "open",
            slaDeadline: String(c.sla_deadline),
          })),
        );
      } else {
        logger.info(
          "CRISIS_SLA",
          "sla_sweep_clean",
          "No crisis review cases past SLA deadline",
        );
      }

      res.json({
        ok: true,
        breachedCount: breachedCases.length,
      });
    } catch (err) {
      logger.error(
        "CRISIS_SLA",
        "sla_sweep_error",
        "Crisis SLA sweep failed",
        err,
      );
      res.status(500).json({ error: "crisis_sla_sweep_failed" });
    }
  },
);

/**
 * GET /api/internal/stale-session-sweep
 * @spec [Doc-02B_V4 §14 session lifecycle; owner rulings Q1 + Q4, 2026-08-17]
 * @implemented 2026-08-17
 *
 * plain English: closes practice AND review sessions nobody has touched in
 * STALE_PRACTICE_SESSION_TTL_DAYS days. Diagnostics are never swept — the rule and
 * the reason live in server/lib/stale-session-sweep.ts, and this handler is
 * transport only.
 *
 * @rescoped [2026-09-21, brief R3 §2.5] Review sweeps from this same job rather than
 * a seventh cron entry: the two sweeps share a TTL and a cadence, and one scheduler
 * entry is one thing to misconfigure instead of two. Review has no diagnostic mode,
 * so its predicate is status + last_activity_at only — see
 * server/lib/review-stale-session-sweep.ts for why it is a sibling function and not
 * a flag on practice's. A review sweep NEVER touches review_schedule: abandoning a
 * session leaves its queue entries open, which is the point.
 *
 * Managed-service first: this is a Vercel cron entry in vercel.json, the same
 * scheduler already driving legal-acceptance-drain and execute-deletions. Not
 * pg_cron (genesis excludes it as platform-managed; production runs exactly two pg_cron jobs,
 * `exam-abandonment-sweep` and `projection-refresh-outbox-drain`, per the owner's report of
 * 2026-10-09, both installed by owner-run scripts under scripts/ops/).
 *
 * Runs daily. The window is seven days, so the exact hour is immaterial and a
 * missed run costs nothing — the next run sweeps the same rows plus a day's worth.
 */
router.get(
  "/stale-session-sweep",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const now = new Date();
      const { sweptCount, cutoff } = await sweepStalePracticeSessions(
        getSupabaseAdmin(),
        { now },
      );
      const { sweptCount: reviewSweptCount } = await sweepStaleReviewSessions(
        getSupabaseAdmin(),
        { now },
      );
      logger.info(
        "SESSION_LIFECYCLE",
        "stale_session_sweep_job",
        "Scheduled stale practice-session sweep completed",
        {
          sweptCount,
          reviewSweptCount,
          cutoff,
          ttlDays: STALE_PRACTICE_SESSION_TTL_DAYS,
        },
      );
      res.json({ ok: true, sweptCount, reviewSweptCount, cutoff });
    } catch (err) {
      logger.error(
        "SESSION_LIFECYCLE",
        "stale_session_sweep_job_error",
        "Scheduled stale practice-session sweep failed",
        err,
      );
      res.status(500).json({ error: "stale_session_sweep_failed" });
    }
  },
);

/**
 * GET /api/internal/baseline-pending-sweep
 * @spec [Doc-01A_V1.0 §18 alert routing; SCL-236 (Doc 05C §12A); owner ruling 2026-10-17
 *        ("Replace the alert-only baseline-pending-sweep with a sweep that repairs")]
 * @implemented 2026-08-17 | @changed 2026-10-17
 *
 * plain English: REPAIRS, then alerts. First it stores the diagnostic projection for every
 * completed diagnostic that has none (public.diagnostic_projection_repair — the same function the
 * owner-run backfill calls, so there is one repair, not two). Then it reads who is STILL
 * baseline_pending and alerts on age, exactly as before, plus on any session the repair could not
 * store. A completed diagnostic now stores its projection in the completing transaction, so a
 * non-zero repair count is itself worth a log line: it means a completion path missed it.
 *
 * WHY IT ALERTS ON AGE, NOT COUNT: every student who finishes a diagnostic is
 * briefly pending. An alert on count > 0 fires on every healthy completion and is
 * muted within a week.
 *
 * SCHEDULE — DAILY, AND NOT BY CHOICE. The threshold is 24h, so an hourly check
 * would surface a stuck student within an hour of crossing it; daily means up to
 * a further 24h. Vercel's Hobby plan rejects any cron expression that runs more
 * than once per day (the deploy fails outright, it does not degrade), so daily is
 * the most frequent schedule this plan permits. Raised as an owner question.
 */
/** Sessions repaired per run; the backlog at launch is single digits. */
const DIAGNOSTIC_REPAIR_BATCH = 500;

router.get(
  "/baseline-pending-sweep",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const repairCall = await getSupabaseAdmin().rpc(
        "diagnostic_projection_repair",
        { p_limit: DIAGNOSTIC_REPAIR_BATCH },
      );
      if (repairCall.error) {
        throw new Error(
          `diagnostic_projection_repair_failed: ${repairCall.error.message}`,
        );
      }
      const repair = diagnosticProjectionRepairResultSchema.parse(
        repairCall.data,
      );
      if (repair.failed > 0) {
        logger.error(
          "BASELINE_PENDING",
          "diagnostic_projection_repair_failures",
          `${repair.failed} completed diagnostic(s) could not have their projection stored`,
          undefined,
          { ...repair },
        );
      } else if (repair.examined > 0) {
        logger.warn(
          "BASELINE_PENDING",
          "diagnostic_projection_repaired",
          `stored the diagnostic projection for ${repair.examined} completed diagnostic(s) that had none`,
          { ...repair },
        );
      }

      const report = await readBaselinePendingReport(getSupabaseAdmin());

      if (report.staleCount > 0) {
        logger.error(
          "BASELINE_PENDING",
          "baseline_pending_stale",
          `${report.staleCount} student(s) have completed a diagnostic with no baseline for over ${Math.round(report.thresholdSeconds / 3600)}h`,
          undefined,
          {
            staleCount: report.staleCount,
            pendingCount: report.pendingCount,
            oldestPendingSeconds: report.oldestPendingSeconds,
            thresholdSeconds: report.thresholdSeconds,
            // Bounded: the alert names who to look at, not everyone. Student ids
            // are opaque uuids — no name, no email, no answer content.
            studentIds: report.stale.slice(0, 20).map((r) => r.student_id),
          },
        );
      } else {
        logger.info(
          "BASELINE_PENDING",
          "baseline_pending_clean",
          "No student stuck in baseline_pending beyond the threshold",
          {
            pendingCount: report.pendingCount,
            oldestPendingSeconds: report.oldestPendingSeconds,
          },
        );
      }

      res.json({
        ok: true,
        repaired: repair.examined - repair.failed,
        repairFailed: repair.failed,
        pendingCount: report.pendingCount,
        staleCount: report.staleCount,
      });
    } catch (err) {
      logger.error(
        "BASELINE_PENDING",
        "baseline_pending_sweep_error",
        "Baseline-pending staleness sweep failed",
        err,
      );
      res.status(500).json({ error: "baseline_pending_sweep_failed" });
    }
  },
);

/**
 * GET /api/internal/notification-dispatch-sweep
 * @spec [contracts/notifications.contract.md §6.2] | @implemented 2026-09-03
 *
 * plain English: backstop only. Timeliness comes from the inline dispatch in the request
 * that produced the event; this daily pass picks up `queued` email rows a frozen function
 * left behind (attempts below the cap) and hands them to the same dispatcher. Vercel Cron
 * on the hobby plan runs at most daily, so nothing here may be relied on for latency.
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404.
 *
 * SCHEDULE (owner ruling, Karl 2026-10-09, schedule audit Step 2 item 1) | @implemented
 * [2026-10-09]: 14:00 UTC (`0 14 * * *`) = 09:00 CDT / 08:00 CST — after quiet hours end, so it
 * is also what delivers the emails quiet hours postponed to 08:00 Chicago (their `not_before`
 * has passed by then), and it is the ONE retry path for every type but `qotd_daily` (the 17:00
 * QOTD run dispatches only its own type). A retried email whose event has expired is dropped.
 *
 * REVIEW ASK (Karl, 2026-10-20) | @implemented [2026-10-20]: the review ask's one follow-up
 * email rule runs here first (review-ask-email-job.ts), inside an existing daily pass rather
 * than behind a new cron (the owner brief of 2026-09-15's rule for new sweeps), so the emails it
 * queues go out in this same dispatch. Its failure is logged and does not stop the dispatch.
 *
 * Lifecycle email (the founding reminder from #1279, then the behaviour triggers) ran here until
 * the owner rulings on #1284 (Karl, 2026-10-21) moved it to GET /api/internal/lifecycle-email.
 */
router.get(
  "/notification-dispatch-sweep",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      let reviewAsk: ReviewAskEmailSummary | { error: true };
      try {
        reviewAsk = await runReviewAskEmailRule(new Date());
      } catch (err) {
        logger.error(
          "NOTIFICATIONS",
          "review_ask_email_rule_error",
          "Review ask email rule failed; dispatching anyway",
          err,
        );
        reviewAsk = { error: true };
      }
      const summary = await dispatchQueuedMessages();
      logger.info(
        "NOTIFICATIONS",
        "dispatch_sweep_job",
        "Scheduled notification dispatch sweep completed",
        summary,
      );
      res.json({ ok: true, ...summary, reviewAsk });
    } catch (err) {
      logger.error(
        "NOTIFICATIONS",
        "dispatch_sweep_job_error",
        "Scheduled notification dispatch sweep failed",
        err,
      );
      res.status(500).json({ error: "notification_dispatch_sweep_failed" });
    }
  },
);

/**
 * GET /api/internal/notification-retention-sweep
 * @spec [contracts/notifications.contract.md §11 (C11.1 window, C11.2 sweep, C11.3 logged
 *        on every run); Doc-06D_V1.0 §9 (retention drift); owner brief 2026-09-15 Part A]
 *        | @implemented [2026-09-15]
 *
 * plain English: the daily retention pass. Two sweeps run here, each owning its own window
 * in SQL and each logging on EVERY run, zero rows included — a run that deleted nothing and
 * a run that never happened must be distinguishable from the logs alone, because cron
 * registration cannot be verified from tooling.
 *
 *   1. NOTIFICATIONS — deletes events older than `notification_retention_days()`; messages
 *      and delivery events go by FK cascade.
 *   2. OPERATIONAL LOGS — deletes rows older than `operational_log_retention_days()` from
 *      the four identity-bearing operational tables. This is the mechanism behind Privacy
 *      Policy v3 §6.7, which SCL-101 recorded as a commitment with nothing behind it.
 *   3. FINANCIAL RECORDS — deletes payment records older than
 *      `financial_record_retention_days()` (seven years). The mechanism behind v3 §6.2.
 *      It will delete nothing until 2033; that is expected, and shipping it now is the
 *      point — a published period needs a mechanism on the day it is published.
 *
 * WHY THE SECOND SWEEP LIVES BEHIND THIS PATH. The owner brief asked for new sweeps to run
 * inside an existing cron pass rather than behind a new route, and this is the only existing
 * pass whose job already IS retention. The consequence is that the path name is now narrower
 * than what it does. Renaming it to `/retention-sweep` means editing vercel.json and
 * re-registering the cron, which is a deployment concern rather than a code one — proposed,
 * not done here.
 *
 * ORDERING IS DELIBERATE BUT NOT LOAD-BEARING: the three sweeps touch disjoint tables. They
 * run in ascending order of retention window so that a failure in a longer-window sweep
 * cannot mask a shorter-window one — the short windows are the ones where a missed day
 * actually retains something it should not. All three are idempotent, so the 500-and-retry
 * path re-runs them harmlessly.
 *
 * Scheduled by the vercel.json entry for this path; CRON_SECRET-gated like every other
 * endpoint in this file; unauthorized => 404. Not pg_cron: production runs exactly two pg_cron
 * jobs, `exam-abandonment-sweep` and `projection-refresh-outbox-drain`, per the owner's report of
 * 2026-10-09 (this comment used to say pg_cron was unused).
 */
router.get(
  "/notification-retention-sweep",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const notifications = await sweepNotificationRetention();
      const operationalLogs = await sweepOperationalLogRetention();
      const financialRecords = await sweepFinancialRecordRetention();
      res.json({ ok: true, notifications, operationalLogs, financialRecords });
    } catch (err) {
      logger.error(
        "NOTIFICATIONS",
        "retention_sweep_job_error",
        "Scheduled retention pass failed",
        err,
      );
      res.status(500).json({ error: "retention_sweep_failed" });
    }
  },
);

/**
 * GET /api/internal/calendar-weekly-regen
 * @spec [Doc-05F_V1.0 §12.5 (weekly job, R-08-30), §12.1 (`weekly` trigger), §18 (job
 *        outcomes); `calendar_runtime_config.weekly_job_interval_minutes` = 1440]
 *        | @implemented [2026-09-21]
 *
 * plain English: the once-per-local-week plan refresh. Scheduled DAILY, not weekly, because
 * §12.5 says "once per local week, never at 00:00" — a cron fires in one timezone and the
 * students are in all of them, so the schedule wakes the job and
 * `calendar_weekly_candidates` decides who is actually due in their OWN Monday-anchored
 * week. A student in Auckland and one in Los Angeles both get exactly one refresh a week.
 *
 * Safe to rerun: the idempotency key is derived from (student, local week), so a second call
 * the same day replays the ledger rather than writing a second version — and the predicate
 * would answer `skipped_fresh` even without it.
 *
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404, which
 * reveals nothing and fails closed. Not pg_cron: production runs exactly two pg_cron jobs,
 * `exam-abandonment-sweep` and `projection-refresh-outbox-drain`, per the owner's report of
 * 2026-10-09 (this comment used to say pg_cron was unused).
 *
 * The "this week" exam notice no longer depends on this cron running first: the notify job
 * re-plans a due student itself (owner ruling, Karl 2026-10-09, schedule audit Step 2 item 3(4)).
 */
router.get(
  "/calendar-weekly-regen",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const summary = await runWeeklyRegeneration(
        req.requestId === undefined ? {} : { requestId: req.requestId },
      );
      // NESTED, not spread. The summary is keyed by `calendar_job_runs.outcome` and one of
      // those values IS `ok` — spreading it would overwrite the envelope's `ok: true` with
      // a COUNT, so a run that generated nothing would report `ok: 0` and read to every
      // caller and every log scraper as a failure. tsc caught it (TS2783).
      res.json({ ok: true, job: "weekly_regen", summary });
    } catch (err) {
      logger.error(
        "CALENDAR_JOB",
        "weekly_regen_job_error",
        "Scheduled calendar weekly regeneration failed",
        err,
      );
      res.status(500).json({ error: "calendar_weekly_regen_failed" });
    }
  },
);

/**
 * GET /api/internal/calendar-exam-notify
 * @spec [Doc-05F_V1.0 §8.1, §12.5 (the daily-job pattern), §18 (job outcomes);
 *        contracts/notifications.contract.md §2.2, §2.3, §6.1; Brief 14 Step 5]
 *        | @implemented [2026-09-27]
 *
 * plain English: the practice-test reminders — one on the Monday of a week holding a
 * full-length, one the day before. Scheduled DAILY for the same reason the weekly regen is: a
 * cron fires in one timezone and the students are in all of them, so the schedule wakes the job
 * and `calendar_exam_notification_candidates` decides who is due in their OWN week.
 *
 * Safe to rerun: the event id is derived from (event type, block), so a second call the same day
 * finds the event already there and records `skipped_duplicate` rather than sending twice.
 *
 * SCHEDULE (owner ruling, Karl 2026-10-09, schedule audit Step 2 item 1) | @implemented
 * [2026-10-09]: 21:00 UTC (`0 21 * * *`) = 16:00 CDT / 15:00 CST, the afternoon before the test
 * for a Chicago student, outside quiet hours. "Tomorrow" stays right in every zone because the
 * predicate reads each student's own local today.
 *
 * ORDER AGAINST THE WEEKLY RE-PLAN IS NOT A CRON ORDER. This comment used to claim the weekly
 * regeneration (`30 5`) ran first and that this made the "this week" notice safe. It did not hold
 * for every zone (a Chicago student in CST was notified at local 00:00 Monday and re-planned at
 * 23:30 that night), and no single UTC time can make it hold. So the job re-plans any student
 * whose week notice is due and whose week is not re-planned yet, and the emitter refuses the
 * notice until it is (exam-notify-job.ts; ruling item 3(4)). Delivery does not depend on the
 * dispatch sweep — this job sends its own email inline (contract §6.1) and the sweep (14:00 UTC)
 * is only the backstop for a row whose send failed; the reminder expires at the start of the test
 * day, so a retry never arrives late.
 *
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404, which reveals
 * nothing and fails closed. Scheduled by Vercel Cron, not pg_cron (production runs exactly two
 * pg_cron jobs, `exam-abandonment-sweep` and `projection-refresh-outbox-drain`, per the owner's
 * report of 2026-10-09; neither touches notifications).
 */
router.get(
  "/calendar-exam-notify",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const summary = await runExamNotifications(
        req.requestId === undefined ? {} : { requestId: req.requestId },
      );
      // NESTED, not spread — the summary is keyed by `calendar_job_runs.outcome` and one of
      // those keys IS `ok`, so spreading it would overwrite the envelope's `ok: true` with a
      // COUNT and a pass that notified nobody would read as a failure. The weekly regen route
      // below learned this from tsc (TS2783); stated here so the next route does not relearn it.
      res.json({ ok: true, job: "exam_notify", summary });
    } catch (err) {
      logger.error(
        "CALENDAR_JOB",
        "exam_notify_job_error",
        "Scheduled calendar exam notifications failed",
        err,
      );
      res.status(500).json({ error: "calendar_exam_notify_failed" });
    }
  },
);

/**
 * GET /api/internal/exam-score-renewal
 * @spec [Doc-01_V8 §36.4, §955; Doc-05F_V1.0 §12.5 (the daily-job pattern), §18 (job outcomes);
 *        contracts/notifications.contract.md §2.2, §2.3, §6.1; SCL-191]
 *        | @implemented [2026-09-30]
 *
 * plain English: the post-exam score prompt, the billing-cycle renewal reminder, and the
 * cancellation that follows a fortnight of silence. Scheduled DAILY for the same reason every
 * other job in this file is: a cron fires in one timezone and the students are in all of them, so
 * the schedule wakes the job and `exam_score_renewal_candidates` decides who is due in their OWN
 * zone.
 *
 * Safe to rerun: the event id is derived from (event type, student, occasion), so a second call
 * the same day finds the event already there and records `skipped_duplicate` rather than emailing
 * twice. The silence pass is safe to rerun for a different reason — `setCancelAtPeriodEnd` reads
 * Stripe before writing, so a second pass is a no-op rather than a second webhook.
 *
 * SCHEDULE (owner ruling, Karl 2026-10-09, schedule audit Step 2 item 1) | @implemented
 * [2026-10-09]: 20:00 UTC (`0 20 * * *`) = 15:00 CDT / 14:00 CST, outside quiet hours. It shares
 * nothing with the exam notifications (21:00 UTC), so their order is immaterial. This job sends
 * its own email inline (contract §6.1); the dispatch sweep (14:00 UTC) is only the backstop for a
 * row whose send failed.
 *
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404, which reveals
 * nothing and fails closed. Scheduled by Vercel Cron, not pg_cron (production runs exactly two
 * pg_cron jobs, `exam-abandonment-sweep` and `projection-refresh-outbox-drain`, per the owner's
 * report of 2026-10-09).
 */
router.get(
  "/exam-score-renewal",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const summary = await runExamScoreRenewal(
        req.requestId === undefined ? {} : { requestId: req.requestId },
      );
      // NESTED, not spread — the summary is keyed by `calendar_job_runs.outcome` and one of those
      // keys IS `ok`, so spreading it would overwrite the envelope's `ok: true` with a COUNT and a
      // pass that prompted nobody would read as a failure. The two calendar routes above learned
      // this from tsc (TS2783).
      res.json({ ok: true, job: "exam_score_renewal", summary });
    } catch (err) {
      logger.error(
        "BILLING_JOB",
        "exam_score_renewal_job_error",
        "Scheduled post-exam score and renewal job failed",
        err,
      );
      res.status(500).json({ error: "exam_score_renewal_failed" });
    }
  },
);

/**
 * GET /api/internal/qotd-schedule
 * @spec [docs/plans/seo/seo-marketing-vertical.md Q1, R18; SCL-202 (anonymous ledger rows expire
 *        with their window); owner Step 0 decisions 2026-10-05 (Vercel cron, then a daily deploy
 *        hook rebuilds the archive pages)] | @implemented [2026-10-05]
 *
 * plain English: fills the Question of the Day schedule from today through a week ahead, sweeps
 * expired anonymous rate-limit rows, then (when VERCEL_DEPLOY_HOOK_URL is set) triggers the
 * production build that prerenders yesterday's archive page. Safe to rerun: a filled day is left
 * alone (date primary key), and a question can be scheduled once ever (question_id UNIQUE).
 *
 * SCHEDULED AT 07:15 UTC: after America/Chicago midnight in both CST (06:00 UTC) and CDT
 * (05:00 UTC), so the build it triggers sees the day that just ended as an archive day. Because
 * the schedule is filled a week ahead, a missed run never leaves today without a question.
 * The run is monitored (QOTD resilience brief, Karl 2026-10-09; qotd-health.ts): one summary
 * line, every unfilled day at ERROR, and an owner alert (Slack + email, once per condition per
 * day) when it throws, leaves a day unfilled, or leaves the horizon under 7 days.
 *
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404.
 */
router.get(
  "/qotd-schedule",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      // QOTD resilience brief (Karl, 2026-10-09): one summary line per run, every failure at
      // ERROR, an alert on a throw, an unfilled day or a horizon under 7 (qotd-health.ts).
      const { summary, health } = await runMonitoredQotdSchedule({
        client: getSupabaseAdmin() as unknown as QotdDbClient,
        deployHookUrl: process.env.VERCEL_DEPLOY_HOOK_URL,
        sendAlert: defaultSendAlert(),
      });
      res.json({
        ok: true,
        job: "qotd_schedule",
        summary,
        horizon: health.horizon.horizon,
        runsOutOn: health.horizon.runs_out_on,
      });
    } catch (err) {
      logger.error(
        "QOTD",
        "qotd_schedule_job_error",
        "Scheduled Question of the Day fill failed",
        err,
      );
      res.status(500).json({ error: "qotd_schedule_failed" });
    }
  },
);

/**
 * GET /api/internal/content-publish
 * @spec [docs/Spec/Lyceon_Doc_10B.md §8.3, §8.4 ("a daily job triggers the production deploy hook
 *        only on days when an item's date arrives"); owner answers on Doc 10B Phase 1 Step 0
 *        (Karl, 2026-10-11)] | @implemented [2026-10-11]
 *
 * plain English: scheduled at 12:05 and 13:05 UTC (vercel.json); each run acts only when it is the
 * 07:00 hour in America/Chicago, so exactly one run a day can act in summer or winter time. It
 * triggers the production build only when an approved blog post's publishAt is today and has
 * arrived (server/services/content/publish-job.ts); otherwise it does nothing. Safe to rerun: a
 * second build on a publish day rebuilds the same site.
 *
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404.
 */
router.get(
  "/content-publish",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const summary = await runContentPublish({
        posts: ALL_BLOG_POSTS,
        now: new Date(),
        deployHookUrl: process.env.VERCEL_DEPLOY_HOOK_URL,
      });
      res.status(summary.deploy === "failed" ? 500 : 200).json({
        ok: summary.deploy !== "failed",
        job: "content_publish",
        ...summary,
      });
    } catch (err) {
      logger.error(
        "CONTENT",
        "content_publish_job_error",
        "Content publish job failed",
        err,
      );
      res.status(500).json({ error: "content_publish_failed" });
    }
  },
);

/**
 * GET /api/internal/marketing-email-reconcile
 * @spec [contracts/notifications.contract.md §14 (marketing lane, amended 2026-10-07); owner
 *        Step 0 decision 1, 2026-10-07 ("daily reconcile only, no new Cloud Tasks queue")]
 *        | @implemented [2026-10-07]
 *
 * plain English: makes Resend's two marketing segments equal to `marketing_email_audience()`,
 * bringing any unsubscribe back to Lyceon before the contact carrying it is deleted. Opt-outs
 * made in Lyceon reach Resend at the next run; unsubscribes made in Resend reach Lyceon
 * immediately through the webhook. Safe to rerun: the plan is computed from state.
 *
 * Answers 500 when the run stopped before writing (missing config, a missing segment, a failed
 * read) or when any single write failed, so the cron run shows as failed and is looked at; the
 * summary carries counts only.
 *
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404.
 */
router.get(
  "/marketing-email-reconcile",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const summary = await reconcileMarketingContacts(
        req.requestId === undefined ? {} : { requestId: req.requestId },
      );
      res
        .status(summary.ok ? 200 : 500)
        .json({ ok: summary.ok, job: "marketing_email_reconcile", summary });
    } catch (err) {
      logger.error(
        "MARKETING_EMAIL",
        "marketing_email_reconcile_job_error",
        "Scheduled marketing contact reconcile failed",
        err,
      );
      res.status(500).json({ error: "marketing_email_reconcile_failed" });
    }
  },
);

/**
 * GET /api/internal/lifecycle-email
 * @spec [owner rulings on #1284 (Karl, 2026-10-21) §2: weekdays `0 22 * * 1-5`, weekends
 *        `0 15 * * 0,6`, no time-zone or DST logic, "fold into existing crons if the Hobby cron
 *        count is tight" — it is not: 18 crons in vercel.json against Vercel's 100 per project,
 *        each still at most daily; contracts/notifications.contract.md C6.2, C14A.4–C14A.5]
 *        | @implemented [2026-10-21]
 *
 * plain English: the one place lifecycle emails are sent (the founding reminder and the three
 * behaviour triggers). Two crons call it, 22:00 UTC Monday to Friday and 15:00 UTC Saturday and
 * Sunday; the rule itself refuses any other hour (`isLifecycleSendSlot`), and quiet hours stay as
 * a backstop. Safe to rerun: every email is claimed once in the ledger. 500 when the rule throws,
 * so the run shows as failed.
 *
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404.
 */
router.get(
  "/lifecycle-email",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const summary: LifecycleRuleSummary = await runLifecycleRule(
        new Date(),
        defaultLifecycleRuleDeps(),
      );
      res.json({ ok: true, job: "lifecycle_email", summary });
    } catch (err) {
      logger.error(
        "LIFECYCLE_EMAIL",
        "lifecycle_email_job_error",
        "Scheduled lifecycle email run failed",
        err,
      );
      res.status(500).json({ error: "lifecycle_email_failed" });
    }
  },
);

/**
 * GET /api/internal/landing-summaries
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26) "Data" (`landing_session_summary` at
 *        session end/timeout, with `questions_answered`); Karl's ruling D on Step 0 the same day ("a
 *        nightly `landing_session_summary` job"); Managed-service first: a Vercel cron, the
 *        project's existing scheduler] | @implemented [2026-10-26]
 *
 * plain English: once a night, every landing shown on a Chicago day that has ended gets one
 * `landing_session_summary` carrying the questions the student answered from that landing until
 * their next landing or the end of that day. 06:30 UTC is after Chicago midnight in both CST and
 * CDT. Safe to rerun: each show is claimed once (`landing_claim_summaries`); a transient send
 * failure releases its claim so the next night retries it. 500 when the run throws.
 *
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404.
 */
router.get(
  "/landing-summaries",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      // Loaded on use: the live deps reach the practice router (set creation), which this cron
      // module has no other reason to load.
      const { liveLandingDeps } =
        await import("../services/landing/landing-deps");
      const summary = await runLandingSummaries(liveLandingDeps);
      logger.info(
        "LANDING",
        "landing_summaries_job",
        "Landing summaries sent",
        summary,
      );
      res.json({ ok: true, job: "landing_summaries", summary });
    } catch (err) {
      logger.error(
        "LANDING",
        "landing_summaries_job_error",
        "Scheduled landing summary run failed",
        err,
      );
      res.status(500).json({ error: "landing_summaries_failed" });
    }
  },
);

/**
 * GET /api/internal/qotd-daily-email
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09), "Daily email": the job
 *        sends only in the 17:00 America/Chicago hour, so 5 PM is right in both CST and CDT;
 *        SCL-223 (the roll of the effective SAT date rides on it)] | @implemented [2026-10-09]
 *
 * SCHEDULE: three DAILY Vercel crons, not one hourly one — the project's plan allows daily crons
 * only (Vercel refused `5 * * * *` on the preview deploy, 2026-10-09). 22:00 UTC is 17:00 CDT and
 * 23:00 UTC is 17:00 CST, so exactly one of the two lands in the 17:00 Chicago hour each day and
 * the other only rolls dates; 06:05 UTC is just after Chicago midnight in both, so a passed SAT
 * date hands over to the next at the start of the day. An hourly schedule on a plan that allows
 * it needs no code change.
 *
 * plain English: every run rolls the effective SAT dates; in the 17:00 Chicago hour, runs the
 * `qotd_daily` notification rule (owner ruling on #1166, 2026-10-09): every student who has
 * answered nothing today gets the in-app notification, and the email too when its channel is on,
 * then the notification dispatcher sends the queued `qotd_daily` emails — that type only (owner
 * ruling, Karl 2026-10-09, schedule audit Step 2 item 3(3)). Safe to rerun: the event id is
 * deterministic per (student, day), so a second run the same day emits and sends nothing. 500
 * when any send failed, so the run shows as failed.
 *
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404.
 */
router.get(
  "/qotd-daily-email",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const summary = await runQotdEmailJob(defaultQotdEmailJobDeps());
      res
        .status(summary.ok ? 200 : 500)
        .json({ ok: summary.ok, job: "qotd_daily_email", summary });
    } catch (err) {
      logger.error(
        "QOTD_EMAIL",
        "qotd_daily_email_job_error",
        "Scheduled daily question email failed",
        err,
      );
      res.status(500).json({ error: "qotd_daily_email_failed" });
    }
  },
);

/**
 * GET /api/internal/guardian-daily-digest
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Delivery": "one email at
 *        6 PM Chicago (two UTC cron entries with a Chicago-hour guard, like the QOTD email)";
 *        "Missed days and back on track"; contracts/notifications.contract.md §2.3, §6.2]
 *        | @implemented [2026-10-13]
 *
 * SCHEDULE: two DAILY Vercel crons (the plan allows daily crons only, see /qotd-daily-email):
 * 23:00 UTC is 18:00 CDT and 00:00 UTC is 18:00 CST, so exactly one of the two lands in the
 * 18:00 Chicago hour each day; the other does nothing.
 *
 * plain English: in the 18:00 Chicago hour, evaluates every entitled student's planned days
 * (missed-plan alert, back on track), then builds each guardian's digest (one per guardian per
 * day, only with something to report, only when their digest email is on), then sends the queued
 * emails of those three types. Safe to rerun: every event id is deterministic and the rule skips
 * days already evaluated. 500 when any send or any student evaluation failed, so the run shows as
 * failed.
 *
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404.
 */
router.get(
  "/guardian-daily-digest",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const summary = await runGuardianAccountabilityJob(
        defaultAccountabilityJobDeps(),
      );
      res
        .status(summary.ok ? 200 : 500)
        .json({ ok: summary.ok, job: "guardian_daily_digest", summary });
    } catch (err) {
      logger.error(
        "ACCOUNTABILITY",
        "guardian_daily_digest_job_error",
        "Scheduled guardian accountability run failed",
        err,
      );
      res.status(500).json({ error: "guardian_daily_digest_failed" });
    }
  },
);

/**
 * GET /api/internal/ops-alert-test — the owner's test alert.
 *
 * @spec [owner brief "QOTD resilience" (Karl, 2026-10-09) "Production proof": "Karl confirms he
 *       received one test alert, triggered by an owner-only test command; no fake production
 *       data"] | @implemented [2026-10-09]
 *
 * plain English: sends ONE test message through the real ops alert path (Slack and email, the
 * same ledger), condition `ops_test`, so it goes at most once a day like every other alert. It
 * writes no QOTD data. Owner-only because it is CRON_SECRET-gated like the rest of this file
 * (unauthorized => 404); run it with the secret:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://lyceon.ai/api/internal/ops-alert-test
 */
router.get(
  "/ops-alert-test",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const outcome = await sendOpsAlert(
        {
          condition: "ops_test",
          title: "Test alert (owner-triggered)",
          lines: [
            "This is a test of the Lyceon ops alert path. Nothing is wrong.",
            "Real alerts: QOTD schedule failures, a horizon under 7 days, no question today, and the recovery message.",
          ],
        },
        defaultOpsAlertDeps(),
      );
      res.json({ ok: true, job: "ops_alert_test", outcome });
    } catch (err) {
      logger.error(
        "OPS_ALERT",
        "ops_alert_test_error",
        "Ops test alert failed",
        err,
      );
      res.status(500).json({ error: "ops_alert_test_failed" });
    }
  },
);

/**
 * POST /api/internal/video-link-check
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §10 (link rot: scheduled
 *       YouTube Data API check; the Cloud Scheduler pattern)] | @implemented 2026-10-15
 *
 * plain English: the daily link-rot check for the LISA video library. Caller: Cloud Scheduler
 * (`google_cloud_scheduler_job.video_link_check`, infra/terraform/
 * cloud-scheduler-video-link-check.tf), OIDC-signed like the crisis sweep: `aud` must equal
 * VIDEO_LINK_CHECK_OIDC_AUDIENCE and `email` CLOUD_TASKS_SERVICE_ACCOUNT, no fallback.
 * YOUTUBE_DATA_API_KEY unset → 500 + ERROR, nothing checked (fail closed). The rules, and the
 * breaker that refuses to mark most of the library unavailable in one run, are in
 * server/services/video-link-check.ts. Logs carry counts and ids, never titles.
 */
const readVideoLinkCheckOidcConfig: OidcConfigReader = () => ({
  expectedAudience: process.env.VIDEO_LINK_CHECK_OIDC_AUDIENCE,
  expectedServiceAccount: process.env.CLOUD_TASKS_SERVICE_ACCOUNT,
});

router.post(
  "/video-link-check",
  oidcAuthMiddlewareWithConfigGuard(readVideoLinkCheckOidcConfig),
  async (_req: Request, res: Response): Promise<void> => {
    const apiKey = process.env.YOUTUBE_DATA_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      logger.error(
        "VIDEO_LIBRARY",
        "video_link_check_config_missing",
        "YOUTUBE_DATA_API_KEY is not set; the link check did not run",
      );
      res.status(500).json({ error: "video_link_check_config_missing" });
      return;
    }
    try {
      const db = getSupabaseAdmin();
      const outcome = await runVideoLinkCheck({
        // Paged, so PostgREST's row cap can never silently leave part of the library
        // unchecked; Zod at the boundary.
        listVideoIds: async () => {
          const page = 1000;
          const ids: string[] = [];
          for (let from = 0; ; from += page) {
            const { data, error } = await db
              .from("video_resources")
              .select("video_id")
              .order("video_id")
              .range(from, from + page - 1);
            if (error) throw error;
            const rows = z
              .array(z.object({ video_id: z.string() }))
              .parse(data ?? []);
            ids.push(...rows.map((r) => r.video_id));
            if (rows.length < page) return ids;
          }
        },
        fetchVideos: youtubeFetcher(apiKey),
        markChecked: async ({ available, unavailable }) => {
          const now = new Date().toISOString();
          for (const [status, ids] of [
            ["available", available],
            ["unavailable", unavailable],
          ] as const) {
            if (ids.length === 0) continue;
            const { error } = await db
              .from("video_resources")
              .update({ status, last_checked_at: now })
              .in("video_id", ids);
            if (error) throw error;
          }
        },
      });
      if (outcome.kind === "breaker_tripped") {
        logger.error(
          "VIDEO_LIBRARY",
          "video_link_check_breaker_tripped",
          "most of the library came back unavailable; nothing was written",
          undefined,
          {
            checked: outcome.checked,
            unavailableCount: outcome.unavailable.length,
          },
        );
        res.status(500).json({ error: "video_link_check_breaker_tripped" });
        return;
      }
      if (outcome.unavailable.length > 0) {
        logger.warn(
          "VIDEO_LIBRARY",
          "video_link_check_unavailable",
          `${outcome.unavailable.length} video(s) marked unavailable`,
          { unavailableIds: outcome.unavailable },
        );
      }
      res.json({
        ok: true,
        checked: outcome.checked,
        unavailable: outcome.unavailable.length,
      });
    } catch (err) {
      logger.error(
        "VIDEO_LIBRARY",
        "video_link_check_error",
        "Video link check failed",
        err,
      );
      res.status(500).json({ error: "video_link_check_failed" });
    }
  },
);

/**
 * GET /api/internal/growth-report
 * @spec [owner brief "One funnel for every social post: /start + CTAs + weekly growth report"
 *        (Karl, 2026-10-28) item 3 ("Monday growth report to #social at 14:00 UTC");
 *        CLAUDE.md "Managed-service first": a Vercel cron (`0 14 * * 1`), the project's existing
 *        scheduler] | @implemented [2026-10-28]
 *
 * plain English: every Monday at 14:00 UTC, last week's numbers (Monday–Sunday, Chicago) go to
 * #social once (server/lib/growth-report.ts). Safe to rerun: a week already posted, or claimed by
 * a run in progress, is skipped. A Slack failure or missing Slack setting releases the week and
 * answers 500, so the run shows as failed and re-running it by hand posts the report.
 *
 * CRON_SECRET-gated like every other endpoint in this file; unauthorized => 404.
 */
router.get(
  "/growth-report",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      // Loaded on use: the report's module reaches the lifecycle email rule (the denylist).
      const { liveGrowthReportDeps, runGrowthReport } =
        await import("../lib/growth-report.js");
      const summary = await runGrowthReport(liveGrowthReportDeps());
      res.status(summary.status === "not_posted" ? 500 : 200).json({
        ok: summary.status !== "not_posted",
        job: "growth_report",
        summary,
      });
    } catch (err) {
      logger.error(
        "GROWTH_REPORT",
        "growth_report_job_error",
        "Scheduled growth report failed",
        err,
      );
      res.status(500).json({ error: "growth_report_failed" });
    }
  },
);

export default router;
