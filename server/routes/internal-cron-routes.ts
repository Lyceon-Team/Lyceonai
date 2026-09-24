import crypto from "node:crypto";
import { Router, Request, Response } from "express";
import { logger } from "../logger.js";
import { getSupabaseAdmin } from "../middleware/supabase-auth.js";
import { drainAllPendingLegalAcceptances } from "../lib/legal-acceptance.js";
import {
  executeDueDeletions,
  isDeletionLifecycleV2Enabled,
} from "../lib/account-deletion-execute.js";
import { getBreachedCases } from "../services/crisis-review-queue";
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
import { dispatchQueuedMessages } from "../lib/notifications/dispatch.js";
import { sweepNotificationRetention } from "../lib/notifications/retention.js";
import {
  sweepOperationalLogRetention,
  sweepFinancialRecordRetention,
} from "../lib/retention/sweeps.js";
import { runWeeklyRegeneration } from "../services/calendar/weekly-job.js";

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
 * trade-offs: alerting via the error log only; whether an ERROR entry
 * reaches a human depends on ERROR_MONITOR_WEBHOOK_URL or a Cloud Logging
 * alert policy, neither of which is in this repo (reported). Only `open`
 * cases are checked (getBreachedCases); an `in_review` case past its SLA is
 * not surfaced (reported, not changed here).
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
 * scheduler already driving legal-acceptance-drain and execute-deletions. No
 * pg_cron (genesis excludes it as platform-managed), no second scheduler.
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
 * @spec [Doc-01A_V1.0 §18 alert routing; Doc-05C_V1.0 §7.4; owner ruling Q2]
 * @implemented 2026-08-17
 *
 * plain English: alerts when a student has been sitting in baseline_pending long
 * enough that the pipeline, not the clock, explains it. Read-only — this endpoint
 * repairs nothing. Repair is scripts/prod-verify/baseline-repair.sql, which Karl
 * runs deliberately after reading the preview.
 *
 * WHY IT ALERTS ON AGE, NOT COUNT: every student who finishes a diagnostic is
 * briefly pending. An alert on count > 0 fires on every healthy completion and is
 * muted within a week.
 *
 * trade-offs: alerting only, matching crisis-sla-sweep. At V1 the structured
 * ERROR log is the signal; the substrate that consumes it is the open Doc-01A §18
 * question already raised on the mastery-emission workstream, not re-litigated
 * here.
 *
 * SCHEDULE — DAILY, AND NOT BY CHOICE. The threshold is 24h, so an hourly check
 * would surface a stuck student within an hour of crossing it; daily means up to
 * a further 24h. Vercel's Hobby plan rejects any cron expression that runs more
 * than once per day (the deploy fails outright, it does not degrade), so daily is
 * the most frequent schedule this plan permits. Raised as an owner question.
 */
router.get(
  "/baseline-pending-sweep",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
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
 */
router.get(
  "/notification-dispatch-sweep",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const summary = await dispatchQueuedMessages();
      logger.info(
        "NOTIFICATIONS",
        "dispatch_sweep_job",
        "Scheduled notification dispatch sweep completed",
        summary,
      );
      res.json({ ok: true, ...summary });
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
 * endpoint in this file; unauthorized => 404. No pg_cron (installed, unused, stays so).
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
 * reveals nothing and fails closed. No pg_cron (installed, unused, stays so).
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

export default router;
