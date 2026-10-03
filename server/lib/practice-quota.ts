/**
 * The free daily practice quota, read without consuming it (OQ-21).
 *
 * @spec [student-UI register OQ-21, owner ruling (Karl) 2026-10-02: a read-only
 *        `GET /api/practice/quota`, computed by the same function as the 402
 *        (`checkAndReservePracticeQuota`, dry run); Doc 02B §12 Entitlement Matrix and §13
 *        "Pre-Cap at Session Creation"; Doc 01A §40 `getUsage` (read-only usage of a bucket),
 *        §44 (hard-limit body), §46 (`practice_daily_free`); contracts/freemium-practice-quota.contract.md]
 *        | @implemented [2026-10-03]
 *
 * plain English: `dryRunPracticeQuota` is the ONE dry-run call of the practice ledger
 * function. The session-start pre-cap (and its 402 at zero) and `GET /api/practice/quota` both
 * go through it, with the same arguments (no session, no item, `dryRun: true`), so the number
 * the student is shown and the number that refuses them come from one SQL evaluation of
 * `check_and_reserve_practice_quota`. A dry run writes no ledger row, so the read consumes
 * nothing. The serve-time reservation (`GET /sessions/:id/next`) calls the same SQL function
 * with `dryRun: false`; its cap test (`used >= daily_quota_free`) is the one that sets the dry
 * run's `remaining` to 0.
 *
 * `toPracticeQuota` maps the decision onto the wire shape:
 *   - `PRACTICE_BYPASS_ENTITLED` (the SQL's code for an active entitlement, which skips the
 *     daily cap) and `RATE_LIMIT_BYPASS_ADMIN` (the wrapper's admin bypass) → unlimited. The
 *     limit the SQL reports for an entitled dry run is the per-session cap, not a daily quota,
 *     so it is not shown.
 *   - anything else must carry `limit`, `remaining` and `resetAt` (the free branch always does,
 *     allowed or denied). A decision without them is not invented into numbers: it is an error,
 *     and the route fails closed with 503, as the 402 sites do when the ledger is unavailable.
 *
 * Doc 01A §44 (hard limit) names `limit` and `resetAt` on the denial body, and §40 `getUsage`
 * returns `{used, limit, resetAt}`; this read carries `limit`, `remaining` and `resetAt` under
 * the same names as the practice 402 body. The practice denial itself stays what it is (402,
 * flat body, ledger scope `practice` rather than §46's `practice_daily_free` bucket key); this
 * change reads it and does not reshape it.
 *
 * trade-offs: the read reports the rule as enforced today, a UTC-midnight window counting
 * questions served; Doc 02B §13 describes America/Chicago midnight and counting submissions.
 * Changing the rule is a change to the SQL function, and this read follows it automatically.
 */
import {
  checkAndReservePracticeQuota,
  type RateLimitDecision,
} from "../../apps/api/src/lib/rate-limit-ledger";
import {
  practiceQuotaSchema,
  type PracticeQuota,
} from "../../packages/shared/src/practice-quota";
import { err, ok, type Result } from "../../packages/shared/src/result";

/** Decision codes under which the enforcement never applies the daily cap. */
export const UNLIMITED_PRACTICE_DECISION_CODES: ReadonlySet<string> = new Set([
  "PRACTICE_BYPASS_ENTITLED",
  "RATE_LIMIT_BYPASS_ADMIN",
]);

export async function dryRunPracticeQuota(args: {
  userId: string;
  role: string | undefined;
}): Promise<RateLimitDecision> {
  return checkAndReservePracticeQuota({
    studentUserId: args.userId,
    role: args.role ?? null,
    sessionId: null,
    sessionItemId: null,
    dryRun: true,
    requestId: null,
  });
}

export function toPracticeQuota(
  decision: RateLimitDecision,
): Result<PracticeQuota, "quota_decision_incomplete"> {
  const candidate = UNLIMITED_PRACTICE_DECISION_CODES.has(decision.code)
    ? { unlimited: true, limit: null, remaining: null, resetAt: null }
    : {
        unlimited: false,
        limit: decision.limit,
        remaining: decision.remaining,
        resetAt: decision.resetAt,
      };
  const parsed = practiceQuotaSchema.safeParse(candidate);
  return parsed.success ? ok(parsed.data) : err("quota_decision_incomplete");
}
