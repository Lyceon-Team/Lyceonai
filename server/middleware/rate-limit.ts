/**
 * The shared single-bucket rate-limit shapes, over the canonical `RateLimitLedger`.
 *
 * @spec [Doc-01A_V1.0 §39–§47 (RateLimitLedger, §43 soft warning, §44 429 shape, §47
 *        migration path); Doc-05F_V1.0 §7 "Rate limiting | Doc 01A Part V | RateLimitLedger |
 *        Regenerate routes"; lyceon-coding-standards §13]
 * | @implemented [2026-09-21]
 *
 * plain English: the response headers, the 429 body, and the one-bucket Express middleware
 * every rate-limited surface uses. Adding a limited route is a config row plus one line at
 * the route — never a second limiter.
 *
 * WHY THIS FILE EXISTS. `singleBucketRateLimit` was a private function inside
 * `guardian-link-rate-limit.ts`, which is the only place it could be imported from. The
 * calendar's regenerate routes need the same shape, and CLAUDE.md is explicit that the
 * answer to "I need the helper that already exists" is to consume the canonical one, never
 * to fork a second. So it moved here UNCHANGED, and the guardian module imports it — its
 * exports and their behaviour are byte-for-byte what they were.
 *
 * Fails CLOSED, everywhere. An unreadable ledger or an unseeded bucket denies (503) rather
 * than opening: a rate limiter that opens when its own storage is down is not one.
 */
import type { NextFunction, Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import {
  checkAndIncrement,
  rateLimitDenialBody,
  rateLimitDenialHeaders,
  RateLimitUnavailableError,
  type LedgerClient,
  type RateLimitResult,
} from "../../packages/shared/src/services/rate-limit-ledger";

export function applyRateLimitHeaders(res: Response, result: RateLimitResult): void {
  res.setHeader("X-RateLimit-Limit", String(result.limit));
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  res.setHeader(
    "X-RateLimit-Reset",
    String(Math.floor(result.resetAt.getTime() / 1000)),
  );
  if (result.softWarning) {
    // §43 — surface the approach without blocking.
    res.setHeader(
      "X-RateLimit-Warning",
      `Approaching limit: ${result.remaining} remaining`,
    );
  }
}

export function denyRateLimited(
  res: Response,
  bucketKey: string,
  result: RateLimitResult,
  requestId: string | undefined,
): void {
  for (const [h, v] of Object.entries(rateLimitDenialHeaders(result))) {
    res.setHeader(h, v);
  }
  res.status(429).json({
    ...rateLimitDenialBody(bucketKey, result),
    requestId,
  });
}

/**
 * One bucket, keyed on the authenticated caller.
 *
 * plain English: the single-control shape, built directly on the `checkAndIncrement`
 * primitive. Expected outcome: adding a bucket is a config row and one line at the call
 * site, never a second limiter — which is what CLAUDE.md's "one implementation per
 * operation" and Doc 01A's ledger ownership require.
 */
export function singleBucketRateLimit(
  bucketKey: string,
  component: string,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.requestId;
    const profileId = req.user?.id;

    // No authenticated profile means no bucket to key on. Auth rejects this next.
    if (!profileId) {
      next();
      return;
    }

    const client = supabaseServer as unknown as LedgerClient;

    try {
      const result = await checkAndIncrement(client, { profileId, bucketKey });
      applyRateLimitHeaders(res, result);
      if (!result.allowed) {
        denyRateLimited(res, bucketKey, result, requestId);
        return;
      }
      next();
    } catch (err: unknown) {
      const unavailable = err instanceof RateLimitUnavailableError;
      logger.error(
        "RATE_LIMIT",
        component,
        "Rate limit check failed — blocking request",
        {
          requestId,
          bucket: bucketKey,
          reason: err instanceof Error ? err.message : "unknown",
        },
      );
      res.status(unavailable ? 503 : 500).json({
        error:
          "Rate limit check failed. Please contact support if this persists.",
        requestId,
      });
    }
  };
}
