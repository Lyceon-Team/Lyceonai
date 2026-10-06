/**
 * POST /api/public/cookie-consent — the cookie consent log.
 *
 * @spec [Doc 10 §9.11 ("consent log with timestamp + cookie category granularity for audit
 *       purposes"); GDPR Art. 7(1) via docs/compliance/legal-drafts/README.md (banner requirements:
 *       "Consent log: timestamp, categories accepted, banner text version"); SCL-202 (public
 *       endpoints are rate-limited on the anonymous ledger); plan F11] | @implemented [2026-10-05]
 *
 * plain English: the banner and the Settings card POST each choice here — the random consent id
 * from the visitor's consent cookie, accepted or refused, the banner version, and where it was
 * made. The server stamps the time. No user id, no IP, no user agent: the row evidences that this
 * choice was made on this banner text, not who made it.
 *
 * Fixed order (Coding Standards §8.1): rate limit (the only gate a public write has) → Zod parse →
 * insert → 204.
 *
 * edge cases: a repeat POST with the same consent id is a new row by design — a later choice is a
 * new event in the log, and the latest row is the standing choice.
 */
import { Router, type Request, type Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { anonymousBucketRateLimit } from "../middleware/rate-limit";
import { cookieConsentRecordSchema } from "../../packages/shared/src/analytics-consent-schema";

const router = Router();

// CSRF_EXEMPT_REASON: unauthenticated; reads no cookie or session, so there is no ambient credential to forge; rate-limited on the SCL-202 hashed-IP ledger.
router.post(
  "/",
  anonymousBucketRateLimit("cookie_consent_ip", "cookie_consent"),
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const parsed = cookieConsentRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: "Invalid input", code: "invalid_input" },
        requestId,
      });
    }
    const { error } = await supabaseServer.from("cookie_consent_log").insert({
      consent_id: parsed.data.consent_id,
      analytics: parsed.data.analytics,
      banner_version: String(parsed.data.banner_version),
      source: parsed.data.source,
    });
    if (error) {
      logger.error(
        "COOKIE_CONSENT",
        "log_insert_failed",
        "Consent log insert failed",
        undefined,
        {
          code: error.code ?? "unknown",
          requestId,
        },
      );
      return res.status(503).json({
        error: {
          message: "This is temporarily unavailable. Please try again shortly.",
          code: "consent_log_unavailable",
        },
        requestId,
      });
    }
    return res.status(204).end();
  },
);

export default router;
