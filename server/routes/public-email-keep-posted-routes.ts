/**
 * /api/public/email — the pause emails' signed "Keep me posted" link, no sign-in.
 *
 * @spec [owner brief "Email send gate" (Karl, 2026-10-30): the sunset note and the parent pause
 *       email's "[Keep me posted]", "signed single-purpose keep-me-posted link"; the review ask's
 *       link pattern (public-review-ask-email-routes.ts)] | @implemented [2026-11-02]
 *
 * plain English:
 *   GET  /keep-posted?t=…  a small page with one "Keep me posted" button (a form POST to the same
 *                          URL). The GET changes nothing, so a mail scanner that follows links
 *                          cannot resume anyone's emails.
 *   POST /keep-posted?t=…  lifts the pause through `email_gate_keep_posted`: a student's governed
 *                          emails switch back on now; a guardian's paused digests resume.
 *                          Idempotent.
 * The token is the shared signing primitive's (`qotd-email-links.ts`), action
 * `email_keep_posted`, so no other email's token is accepted here. A missing, malformed or
 * tampered token is 400 and nothing changes. Limited per hashed IP with the email links' existing
 * bucket. Logs carry the outcome and the request id only; never the token or the profile id.
 */
import { Router, type Request, type Response } from "express";
import { anonymousBucketRateLimit } from "../middleware/rate-limit";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { escapeHtml } from "../lib/notifications/templates/shared";
import { logger } from "../logger";
import { verifyQotdEmailLinkToken } from "../services/qotd/qotd-email-links";
import type { RpcClient } from "../lib/rpc-client";
import { emailLinkPage, refusedEmailLink } from "./public-qotd-email-routes";
import { emailGateKeepPostedResultSchema } from "../../packages/shared/src/email-gate";

const COMPONENT = "EMAIL_KEEP_POSTED_LINK";
const ACTION = "email_keep_posted" as const;
const TITLE = "Turn your emails back on?";
const DONE = "Done. Your emails are back on. Welcome back.";

export function createPublicEmailKeepPostedRouter(
  db: () => RpcClient = () => supabaseServer,
  now: () => Date = () => new Date(),
): Router {
  const router = Router();
  const limit = anonymousBucketRateLimit("qotd_unsubscribe_ip", COMPONENT);

  router.get("/keep-posted", limit, (req: Request, res: Response) => {
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
          `<h1>${escapeHtml(TITLE)}</h1><form method="post" action="${escapeHtml(actionUrl)}"><button type="submit" style="font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#111;color:#fff;cursor:pointer">Keep me posted</button></form>`,
        ),
      );
  });

  // CSRF_EXEMPT_REASON: unauthenticated; no cookie or session is read, so there is no ambient credential to forge; the only authority is the HMAC-signed single-purpose token.
  router.post("/keep-posted", limit, async (req: Request, res: Response) => {
    const profileId = verifyQotdEmailLinkToken(ACTION, req.query.t);
    if (profileId === null) {
      logger.warn(COMPONENT, "link_refused", "Keep me posted link refused", {
        requestId: req.requestId,
      });
      return refusedEmailLink(res);
    }
    try {
      const { data, error } = await db().rpc("email_gate_keep_posted", {
        p_profile_id: profileId,
        p_now: now().toISOString(),
      });
      if (error)
        throw new Error(`email_gate_keep_posted failed: ${error.message}`);
      const result = emailGateKeepPostedResultSchema.safeParse(data);
      if (!result.success)
        throw new Error("email_gate_keep_posted returned a malformed result");
      logger.info(COMPONENT, "link_applied", "Keep me posted applied", {
        requestId: req.requestId,
        changed: result.data.changed,
      });
      return res
        .status(200)
        .type("html")
        .send(emailLinkPage(TITLE, `<p>${escapeHtml(DONE)}</p>`));
    } catch (error) {
      logger.error(
        COMPONENT,
        "link_failed",
        "Keep me posted failed",
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

export default createPublicEmailKeepPostedRouter();
