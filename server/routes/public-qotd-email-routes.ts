/**
 * /api/public/qotd-email — unsubscribe from (and resume) the daily-question email, no sign-in.
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09), "API": "A one-click
 *       unsubscribe link (signed, single-purpose, no sign-in) plus a List-Unsubscribe header";
 *       "Daily email": the pause email's resume link; acceptance 7; RFC 8058 (one-click POST)]
 *       | @implemented [2026-10-09]
 *
 * plain English:
 *   GET  /unsubscribe?t=…  a small page with one "Unsubscribe" button (a form POST to the same
 *                          URL). The GET changes nothing, so a mail scanner that follows links
 *                          cannot unsubscribe anyone; the one click is the button.
 *   POST /unsubscribe?t=…  does it. This is also the RFC 8058 target a mailbox provider calls
 *                          from the List-Unsubscribe-Post header. Idempotent.
 *   GET/POST /resume?t=…   the same pair for the pause email's resume link.
 * A missing, malformed or tampered token is refused (400) and nothing changes. Each request is
 * limited per hashed IP (`qotd_unsubscribe_ip`). Logs carry the action and outcome only; the
 * token and the student id are never logged.
 */
import { Router, type Request, type Response } from "express";
import { anonymousBucketRateLimit } from "../middleware/rate-limit";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { escapeHtml } from "../lib/notifications/templates/shared";
import { logger } from "../logger";
import {
  verifyQotdEmailLinkToken,
  type QotdEmailLinkAction,
} from "../services/qotd/qotd-email-links";
import type { RpcClient } from "../lib/rpc-client";

const COMPONENT = "QOTD_EMAIL_LINK";

const COPY: Record<
  QotdEmailLinkAction,
  { title: string; button: string; done: string; fn: string }
> = {
  unsubscribe: {
    title: "Unsubscribe from daily questions?",
    button: "Unsubscribe",
    done: "You're unsubscribed. We won't email you the daily question again.",
    fn: "qotd_email_unsubscribe",
  },
  resume: {
    title: "Resume daily questions?",
    button: "Resume",
    done: "Done. Your daily question will be back tomorrow at 5 PM Central.",
    fn: "qotd_email_resume",
  },
};

function page(title: string, body: string): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)} · Lyceon</title></head>`,
    '<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111;max-width:480px;margin:48px auto;padding:0 16px">',
    body,
    "</body></html>",
  ].join("");
}

function refused(res: Response): Response {
  return res
    .status(400)
    .type("html")
    .send(
      page(
        "This link isn't valid",
        "<h1>This link isn't valid</h1><p>Open the latest email from Lyceon and try its link again.</p>",
      ),
    );
}

export function createPublicQotdEmailRouter(
  db: () => RpcClient = () => supabaseServer,
): Router {
  const router = Router();
  const limit = anonymousBucketRateLimit("qotd_unsubscribe_ip", COMPONENT);

  for (const action of ["unsubscribe", "resume"] as const) {
    const copy = COPY[action];

    router.get(`/${action}`, limit, (req: Request, res: Response) => {
      const token = req.query.t;
      if (verifyQotdEmailLinkToken(action, token) === null) return refused(res);
      const actionUrl = `?t=${encodeURIComponent(String(token))}`;
      return res
        .status(200)
        .type("html")
        .send(
          page(
            copy.title,
            `<h1>${escapeHtml(copy.title)}</h1><form method="post" action="${escapeHtml(actionUrl)}"><button type="submit" style="font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#111;color:#fff;cursor:pointer">${escapeHtml(copy.button)}</button></form>`,
          ),
        );
    });

    // CSRF_EXEMPT_REASON: unauthenticated; no cookie or session is read, so there is no ambient credential to forge; the only authority is the HMAC-signed single-purpose token (RFC 8058 one-click POST).
    router.post(`/${action}`, limit, async (req: Request, res: Response) => {
      const studentId = verifyQotdEmailLinkToken(action, req.query.t);
      if (studentId === null) {
        logger.warn(COMPONENT, "link_refused", "QOTD email link refused", {
          requestId: req.requestId,
          action,
        });
        return refused(res);
      }
      try {
        const { error } = await db().rpc(copy.fn, {
          p_student_id: studentId,
          p_now: new Date().toISOString(),
        });
        if (error) throw new Error(`${copy.fn} failed: ${error.message}`);
        logger.info(COMPONENT, "link_applied", "QOTD email link applied", {
          requestId: req.requestId,
          action,
        });
        return res
          .status(200)
          .type("html")
          .send(page(copy.title, `<p>${escapeHtml(copy.done)}</p>`));
      } catch (error) {
        logger.error(COMPONENT, "link_failed", "QOTD email link failed", {
          requestId: req.requestId,
          action,
          reason: error instanceof Error ? error.message : "unknown",
        });
        return res
          .status(500)
          .type("html")
          .send(
            page(
              "Something went wrong",
              "<p>Something went wrong. Please try the link again in a minute.</p>",
            ),
          );
      }
    });
  }

  return router;
}

export default createPublicQotdEmailRouter();
