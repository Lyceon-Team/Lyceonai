/**
 * Guardian-link rate limit middleware — consumes the canonical RateLimitLedger.
 *
 * @spec [Doc-01_V8, §36.2 Rate limiting and abuse controls | Doc-01A_V1.0, §39–§46;
 *        §43 Soft warning at 80%; §44 Hard limit — 429 response; §47 migration-path step 2]
 *        | @implemented [2026-08-26]
 *
 * plain English: before `POST /api/guardian/link` runs, count the attempt against BOTH
 * controls §36.2 names — max 10 per guardian per day, and max 3 per targeted email per day —
 * and deny with a §44-shaped 429 once either is reached. Expected outcome: a row in
 * `rate_limit_ledger` for each bucket, keyed (guardian profile, bucket, today), and the
 * request continuing when both allow.
 *
 * Trade-off: an unconfigured bucket or an unreachable database denies with 503 rather than
 * opening — a rate limiter that fails open is not one. Edge cases: (a) an unauthenticated
 * request passes through untouched, because there is no profile to key a bucket on and auth
 * denies it a moment later anyway; (b) when the guardian bucket allows and the email bucket
 * then denies, the guardian increment is ROLLED BACK (§47's rollback pattern) so a denial on
 * one control does not silently consume quota on the other; (c) a request carrying no email
 * is checked against the guardian bucket only — the per-email control has no subject, and
 * the route rejects the body a moment later.
 *
 * REPLACES `server/lib/durable-rate-limiter.ts`, which counted rows in `guardian_link_audit`
 * — a table that does not exist in production. That is why every link attempt returned 500
 * before reaching its handler (`docs/plans/WS-GL_Stage1_Audit.md` §0). Doc 01A §47
 * migration-path step 2 names this consolidation, and §46 lists `V8 guardian linking (§36.2)`
 * as a `guardian_link_attempts_daily` consumer by name.
 */

import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import {
  checkAndIncrement,
  rateLimitDenialBody,
  rateLimitDenialHeaders,
  RateLimitUnavailableError,
  rollback,
  type LedgerClient,
  type RateLimitResult,
} from "../../packages/shared/src/services/rate-limit-ledger";

function applyHeaders(res: Response, result: RateLimitResult): void {
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

function deny(
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
 * SCL-080 buckets. Two distinct quantities, so two buckets rather than one shared number:
 * ENTRY is the guessing surface (a guardian trying codes), REGENERATION is the churn surface
 * (a student cycling their own code). Both are seeded by D-9 in
 * `docs/plans/GUARDIAN_LINK_CODE_DDL.md`.
 */
export const GUARDIAN_LINK_CODE_ENTRY_BUCKET = "guardian_link_code_entry";
export const STUDENT_LINK_CODE_REGENERATION_BUCKET =
  "student_link_code_regeneration";

/**
 * One bucket, keyed on the authenticated caller.
 *
 * @spec [Doc-01A_V1.0 §39–§47; SCL-080] | @implemented [2026-09-01]
 *
 * plain English: the single-control shape the two code surfaces need, built directly on the
 * `checkAndIncrement` primitive. Expected outcome: adding a
 * bucket is a config row and one line here, never a second limiter — which is what
 * `CLAUDE.md`'s "one implementation per operation" and Doc 01A's ledger ownership require.
 *
 * Fails CLOSED on an unreadable ledger, exactly as the two-control limiter does: a rate
 * limiter that opens when its own storage is down is not one.
 */
function singleBucketRateLimit(
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
      applyHeaders(res, result);
      if (!result.allowed) {
        deny(res, bucketKey, result, requestId);
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

/** A guardian submitting a code. The guessing surface. */
export const guardianLinkCodeEntryRateLimit = singleBucketRateLimit(
  GUARDIAN_LINK_CODE_ENTRY_BUCKET,
  "guardian_link_code_entry",
);

/** A student cycling their own code. The churn surface. */
export const studentLinkCodeRegenerationRateLimit = singleBucketRateLimit(
  STUDENT_LINK_CODE_REGENERATION_BUCKET,
  "student_link_code_regeneration",
);

/**
 * §36.2's two buckets, applied to the guardian INVITE by email (2026-09-15). Both are seeded
 * by SCL-080's D-9: 10 attempts per student per day, and 3 per (student, address) per day.
 * The per-address bucket key is the family name plus a hash of the normalised address, so
 * `readBucketDefinition`'s family fallback resolves its limit and the ledger never stores
 * an email address.
 */
export const GUARDIAN_LINK_INVITE_DAILY_BUCKET = "guardian_link_attempts_daily";
export const GUARDIAN_LINK_INVITE_EMAIL_BUCKET = "guardian_link_email_attempts";

export function guardianInviteEmailBucketKey(email: string): string {
  const digest = createHash("sha256")
    .update(email.trim().toLowerCase(), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `${GUARDIAN_LINK_INVITE_EMAIL_BUCKET}:${digest}`;
}

/**
 * @spec [Doc-01_V8 §36.2 (per-guardian 10/day; per-email 3/day — "prevents spam linking to
 *        an email"); Doc-01A_V1.0 §39–§47 (RateLimitLedger; §45 rollback; §44 429 shape)]
 *        | @implemented [2026-09-15]
 *
 * plain English: count one invite against BOTH controls before any email is sent. Not an
 * Express middleware because the per-address bucket needs the PARSED address, which only the
 * handler has after its Zod parse — so the handler calls this and returns if it wrote the
 * 429. Expected outcome: when the daily bucket allows and the per-address bucket denies, the
 * daily increment is rolled back (§45) so a denial on one control does not consume quota on
 * the other. Fails CLOSED on an unreadable ledger (503), like every limiter on this surface.
 * Returns true when the response has been written and the caller must stop.
 */
export async function applyGuardianInviteRateLimit(
  res: Response,
  profileId: string,
  email: string,
  requestId: string | undefined,
): Promise<boolean> {
  const client = supabaseServer as unknown as LedgerClient;
  const emailBucketKey = guardianInviteEmailBucketKey(email);
  try {
    const daily = await checkAndIncrement(client, {
      profileId,
      bucketKey: GUARDIAN_LINK_INVITE_DAILY_BUCKET,
    });
    if (!daily.allowed) {
      deny(res, GUARDIAN_LINK_INVITE_DAILY_BUCKET, daily, requestId);
      return true;
    }
    const perEmail = await checkAndIncrement(client, {
      profileId,
      bucketKey: emailBucketKey,
    });
    if (!perEmail.allowed) {
      const rolled = await rollback(client, {
        profileId,
        bucketKey: GUARDIAN_LINK_INVITE_DAILY_BUCKET,
      });
      if (!rolled.ok) {
        logger.warn(
          "RATE_LIMIT",
          "guardian_link_invite",
          "Daily bucket rollback failed after per-address denial",
          { requestId, reason: rolled.error ?? "unknown" },
        );
      }
      // The family name in the body, never the hashed key.
      deny(res, GUARDIAN_LINK_INVITE_EMAIL_BUCKET, perEmail, requestId);
      return true;
    }
    applyHeaders(res, perEmail.remaining < daily.remaining ? perEmail : daily);
    return false;
  } catch (err: unknown) {
    const unavailable = err instanceof RateLimitUnavailableError;
    logger.error(
      "RATE_LIMIT",
      "guardian_link_invite",
      "Rate limit check failed — blocking request",
      {
        requestId,
        reason: err instanceof Error ? err.message : "unknown",
      },
    );
    res.status(unavailable ? 503 : 500).json({
      error:
        "Rate limit check failed. Please contact support if this persists.",
      requestId,
    });
    return true;
  }
}
