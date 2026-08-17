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
  sweepStalePracticeSessions,
  STALE_PRACTICE_SESSION_TTL_DAYS,
} from "../lib/stale-session-sweep.js";
import { readBaselinePendingReport } from "../lib/baseline-pending.js";

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
 * GET /api/internal/crisis-sla-sweep
 * @spec [Doc-03_V3 §21.3] Cloud Scheduler SLA breach sweep. Finds open crisis
 * review cases past their 48h SLA deadline and logs a HIGH alert for each.
 * Does not auto-resolve or auto-escalate — the sweep is an alerting mechanism
 * so ops can prioritize breached cases.
 *
 * @implemented 2026-08-13
 *
 * trade-offs: Alerting only, no auto-action. At V1 scale (founder-staffed),
 * the sweep surfaces overdue cases via structured logging. Cloud Monitoring
 * alert policies pick up the log entries and route to the on-call channel.
 * At V2 scale, this should emit to PagerDuty/Slack directly.
 *
 * IAM requirements (report only — Karl provisions):
 *   - Cloud Scheduler job: `crisis-sla-sweep` targeting this endpoint.
 *   - Runs every hour (0 * * * *).
 *   - Uses CRON_SECRET for auth (same as other cron endpoints).
 */
router.get(
  "/crisis-sla-sweep",
  async (req: Request, res: Response): Promise<void> => {
    if (!cronAuthorized(req)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
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
 * plain English: closes practice sessions nobody has touched in
 * STALE_PRACTICE_SESSION_TTL_DAYS days. Diagnostics are never swept — the rule and
 * the reason live in server/lib/stale-session-sweep.ts, and this handler is
 * transport only.
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
      const { sweptCount, cutoff } = await sweepStalePracticeSessions(
        getSupabaseAdmin(),
        { now: new Date() },
      );
      logger.info(
        "SESSION_LIFECYCLE",
        "stale_session_sweep_job",
        "Scheduled stale practice-session sweep completed",
        { sweptCount, cutoff, ttlDays: STALE_PRACTICE_SESSION_TTL_DAYS },
      );
      res.json({ ok: true, sweptCount, cutoff });
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

export default router;
