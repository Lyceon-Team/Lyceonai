/**
 * Guardian-link rate limit middleware — consumes the canonical RateLimitLedger.
 *
 * @spec [Doc-01_V8, §36.2 Rate limiting and abuse controls | Doc-01A_V1.0, §39–§46;
 *        §44 Hard limit — 429 response; §47 migration-path step 2]
 *        | @implemented [2026-08-25]
 *
 * plain English: before `POST /api/guardian/link` runs, count this guardian's link
 * attempt for the day against `rate_limit_ledger` and deny with a §44-shaped 429 once
 * the configured limit is reached. Expected outcome: a row in `rate_limit_ledger`
 * keyed (guardian profile, `guardian_link_attempts_daily`, today), and the request
 * continuing when allowed. Trade-off: an unconfigured bucket or an unreachable
 * database denies with 503 rather than opening — a rate limiter that fails open is
 * not one. Edge case: an unauthenticated request is passed through untouched, because
 * there is no profile to key a bucket on and auth denies it a moment later anyway.
 *
 * REPLACES `server/lib/durable-rate-limiter.ts`, which counted rows in
 * `guardian_link_audit` — a table that does not exist in production. That is why
 * every link attempt returned 500 before reaching its handler
 * (`docs/plans/WS-GL_Stage1_Audit.md` §0). Doc 01A §47 migration-path step 2 names
 * this consolidation, and §46 lists `V8 guardian linking (§36.2)` as a
 * `guardian_link_attempts_daily` consumer by name.
 */

import type { Request, Response, NextFunction } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import {
  checkAndIncrement,
  rateLimitDenialBody,
  rateLimitDenialHeaders,
  RateLimitUnavailableError,
  type LedgerClient,
} from "../../packages/shared/src/services/rate-limit-ledger";

/** §46's literal bucket name for this consumer. */
export const GUARDIAN_LINK_BUCKET = "guardian_link_attempts_daily";

export async function guardianLinkRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const requestId = req.requestId;
  const profileId = req.user?.id;

  // No authenticated profile means no bucket to key on. Auth rejects this next.
  if (!profileId) {
    next();
    return;
  }

  try {
    const result = await checkAndIncrement(
      supabaseServer as unknown as LedgerClient,
      { profileId, bucketKey: GUARDIAN_LINK_BUCKET },
    );

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

    if (!result.allowed) {
      for (const [h, v] of Object.entries(rateLimitDenialHeaders(result))) {
        res.setHeader(h, v);
      }
      res
        .status(429)
        .json({
          ...rateLimitDenialBody(GUARDIAN_LINK_BUCKET, result),
          requestId,
        });
      return;
    }

    next();
  } catch (err: unknown) {
    const unavailable = err instanceof RateLimitUnavailableError;
    logger.error(
      "RATE_LIMIT",
      "guardian_link",
      "Rate limit check failed — blocking request",
      {
        requestId,
        bucket: GUARDIAN_LINK_BUCKET,
        reason: err instanceof Error ? err.message : "unknown",
      },
    );
    res.status(unavailable ? 503 : 500).json({
      error:
        "Rate limit check failed. Please contact support if this persists.",
      requestId,
    });
  }
}
