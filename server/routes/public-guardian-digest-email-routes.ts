/**
 * /api/public/guardian-digest-email — one-click unsubscribe from the guardian's daily summary
 * email, no sign-in.
 *
 * @spec [Karl's rulings on #1223 (2026-10-13) item 5: "Add one-click unsubscribe to the digest: a
 *       signed link + List-Unsubscribe (and List-Unsubscribe-Post one-click) header, setting the
 *       SAME guardian preference as Settings (one writer). Follow the existing QOTD-email
 *       one-click unsubscribe pattern exactly"; RFC 8058; contracts/notifications.contract.md
 *       C2A.2, C2A.3 (amended)] | @implemented [2026-10-13]
 *
 * plain English: the QOTD email's link routes (public-qotd-email-routes.ts), for the guardian pair:
 *   GET  /unsubscribe?t=…  a small page with one "Unsubscribe" button (a form POST to the same
 *                          URL). The GET changes nothing, so a mail scanner that follows links
 *                          cannot unsubscribe anyone.
 *   POST /unsubscribe?t=…  turns the guardian's daily summary email OFF through the switch's one
 *                          writer, `set_guardian_daily_digest_email` — the same write the Settings
 *                          card makes. Also the RFC 8058 target a mailbox provider calls from the
 *                          List-Unsubscribe-Post header. Idempotent.
 * The token is the shared signing primitive's (`qotd-email-links.ts`), action
 * `guardian_digest_unsubscribe`, so a QOTD token is refused here and this token there. A missing,
 * malformed or tampered token is 400 and nothing changes. Limited per hashed IP with the email
 * links' existing bucket (`qotd_unsubscribe_ip`). Logs carry the outcome and the request id only;
 * never the token or the guardian id. In-app notifications are not affected.
 */
import { Router, type Request, type Response } from "express";
import { anonymousBucketRateLimit } from "../middleware/rate-limit";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { escapeHtml } from "../lib/notifications/templates/shared";
import { logger } from "../logger";
import { verifyQotdEmailLinkToken } from "../services/qotd/qotd-email-links";
import type { RpcClient } from "../lib/rpc-client";
import { emailLinkPage, refusedEmailLink } from "./public-qotd-email-routes";

const COMPONENT = "GUARDIAN_DIGEST_LINK";
const ACTION = "guardian_digest_unsubscribe" as const;
const TITLE = "Unsubscribe from the daily summary?";
const DONE =
  "You're unsubscribed from the daily summary email. Plan changes and missed-day notes still appear in your Lyceon notifications, and you can turn the email back on in Settings.";

export function createPublicGuardianDigestEmailRouter(
  db: () => RpcClient = () => supabaseServer,
): Router {
  const router = Router();
  const limit = anonymousBucketRateLimit("qotd_unsubscribe_ip", COMPONENT);

  router.get("/unsubscribe", limit, (req: Request, res: Response) => {
    const token = req.query.t;
    if (verifyQotdEmailLinkToken(ACTION, token) === null)
      return refusedEmailLink(res);
    const actionUrl = `?t=${encodeURIComponent(String(token))}`;
    return res
      .status(200)
      .type("html")
      .send(
        emailLinkPage(
          TITLE,
          `<h1>${escapeHtml(TITLE)}</h1><form method="post" action="${escapeHtml(actionUrl)}"><button type="submit" style="font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#111;color:#fff;cursor:pointer">Unsubscribe</button></form>`,
        ),
      );
  });

  // CSRF_EXEMPT_REASON: unauthenticated; no cookie or session is read, so there is no ambient credential to forge; the only authority is the HMAC-signed single-purpose token (RFC 8058 one-click POST).
  router.post("/unsubscribe", limit, async (req: Request, res: Response) => {
    const guardianId = verifyQotdEmailLinkToken(ACTION, req.query.t);
    if (guardianId === null) {
      logger.warn(
        COMPONENT,
        "link_refused",
        "Digest unsubscribe link refused",
        {
          requestId: req.requestId,
        },
      );
      return refusedEmailLink(res);
    }
    try {
      const { error } = await db().rpc("set_guardian_daily_digest_email", {
        p_guardian_id: guardianId,
        p_enabled: false,
        p_now: new Date().toISOString(),
      });
      if (error)
        throw new Error(
          `set_guardian_daily_digest_email failed: ${error.message}`,
        );
      logger.info(COMPONENT, "link_applied", "Digest unsubscribe applied", {
        requestId: req.requestId,
      });
      return res
        .status(200)
        .type("html")
        .send(emailLinkPage(TITLE, `<p>${escapeHtml(DONE)}</p>`));
    } catch {
      logger.error(
        COMPONENT,
        "link_failed",
        "Digest unsubscribe failed",
        undefined,
        { requestId: req.requestId },
      );
      return res
        .status(500)
        .type("html")
        .send(
          emailLinkPage(
            "Something went wrong",
            "<p>Something went wrong. Please try the link again in a minute.</p>",
          ),
        );
    }
  });

  return router;
}

export default createPublicGuardianDigestEmailRouter();
