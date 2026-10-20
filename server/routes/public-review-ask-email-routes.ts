/**
 * /api/public/review-ask-email — the review email's one-click "Stop review requests", no sign-in.
 *
 * @spec [Karl's Step 0 decision 5 on the review ask (2026-10-20): "Keep the signed one-click
 *       'Stop review requests' link"; owner brief "Review ask" Behaviour 3 ("unsubscribe;
 *       respects opt-outs"); RFC 8058; the digest's unsubscribe pattern
 *       (public-guardian-digest-email-routes.ts)] | @implemented [2026-10-20]
 *
 * plain English: the digest's link routes, for the review ask:
 *   GET  /stop?t=…  a small page with one "Stop review requests" button (a form POST to the same
 *                   URL). The GET changes nothing, so a mail scanner that follows links cannot
 *                   stop anyone's asks.
 *   POST /stop?t=…  ends the review asks, in the app and by email, through
 *                   `product_review_prompt_stop`. Also the RFC 8058 target a mailbox provider
 *                   calls from the List-Unsubscribe-Post header. Idempotent.
 * The token is the shared signing primitive's (`qotd-email-links.ts`), action `review_ask_stop`,
 * so no other email's token is accepted here. A missing, malformed or tampered token is 400 and
 * nothing changes. Limited per hashed IP with the email links' existing bucket
 * (`qotd_unsubscribe_ip`). Logs carry the outcome and the request id only; never the token or
 * the profile id.
 */
import { Router, type Request, type Response } from "express";
import { anonymousBucketRateLimit } from "../middleware/rate-limit";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { escapeHtml } from "../lib/notifications/templates/shared";
import { logger } from "../logger";
import { verifyQotdEmailLinkToken } from "../services/qotd/qotd-email-links";
import type { RpcClient } from "../lib/rpc-client";
import { emailLinkPage, refusedEmailLink } from "./public-qotd-email-routes";

const COMPONENT = "REVIEW_ASK_LINK";
const ACTION = "review_ask_stop" as const;
const TITLE = "Stop review requests?";
const DONE =
  "Done. We won't ask you for a review again. You can still send us feedback any time from the menu in Lyceon.";

export function createPublicReviewAskEmailRouter(
  db: () => RpcClient = () => supabaseServer,
): Router {
  const router = Router();
  const limit = anonymousBucketRateLimit("qotd_unsubscribe_ip", COMPONENT);

  router.get("/stop", limit, (req: Request, res: Response) => {
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
          `<h1>${escapeHtml(TITLE)}</h1><form method="post" action="${escapeHtml(actionUrl)}"><button type="submit" style="font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#111;color:#fff;cursor:pointer">Stop review requests</button></form>`,
        ),
      );
  });

  // CSRF_EXEMPT_REASON: unauthenticated; no cookie or session is read, so there is no ambient credential to forge; the only authority is the HMAC-signed single-purpose token (RFC 8058 one-click POST).
  router.post("/stop", limit, async (req: Request, res: Response) => {
    const profileId = verifyQotdEmailLinkToken(ACTION, req.query.t);
    if (profileId === null) {
      logger.warn(COMPONENT, "link_refused", "Review ask stop link refused", {
        requestId: req.requestId,
      });
      return refusedEmailLink(res);
    }
    try {
      const { error } = await db().rpc("product_review_prompt_stop", {
        p_profile_id: profileId,
      });
      if (error)
        throw new Error(`product_review_prompt_stop failed: ${error.message}`);
      logger.info(COMPONENT, "link_applied", "Review asks stopped", {
        requestId: req.requestId,
      });
      return res
        .status(200)
        .type("html")
        .send(emailLinkPage(TITLE, `<p>${escapeHtml(DONE)}</p>`));
    } catch (error) {
      logger.error(
        COMPONENT,
        "link_failed",
        "Review ask stop failed",
        undefined,
        {
          requestId: req.requestId,
          reason: error instanceof Error ? error.message : "unknown",
        },
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

export default createPublicReviewAskEmailRouter();
