/**
 * @spec [contracts/notifications.contract.md §3.1, §9.4, §10; lyceon-coding-standards §8
 *        thin handlers (auth → parse → domain → serialize), §8.2 envelope, §7.1 Zod at every
 *        boundary] | @implemented [2026-09-03]
 *
 * plain English: the in-app feed. Four routes, one recipient rule: the recipient is the
 * authenticated principal, resolved ONCE by `recipientOf`, and no request value can name a
 * different one. Every read and write goes through a recipient-scoped SQL function
 * (`notification_feed`, `notification_unread_count`, `mark_notification`,
 * `mark_all_notifications_seen`), so a `message_id` that belongs to someone else is simply
 * not found — 404, never 403, and never a row change. Titles and bodies are rendered here
 * from the event's payload so the client carries no copy and no payload knowledge.
 *
 * Mounted at NOTIFICATION_API_MOUNT behind requireSupabaseAuth + doubleCsrfProtection in
 * server/index.ts. Envelope: `{ data, requestId }` / `{ error: { message, code }, requestId }`.
 *
 * Cursor pagination: the opaque cursor is the last item's (created_at, message_id); the SQL
 * function applies the row comparison, so a page boundary between two rows created in the
 * same microsecond is still deterministic.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  notificationFeedCursorSchema,
  notificationFeedQuerySchema,
  notificationFeedRowSchema,
  notificationMessageIdParamSchema,
  notificationMessageRowSchema,
  notificationPatchBodySchema,
  type NotificationFeedCursor,
  type NotificationFeedItem,
} from "../../packages/shared/src/notifications-schema";
import { renderInApp, siteUrlFromEnv } from "../lib/notifications/templates";
import { logger } from "../logger";

const router = Router();

/** §9.4 — the recipient is the session principal. A request cannot name one. */
function recipientOf(req: Request, res: Response): string | null {
  const id = req.user?.id;
  if (!id) {
    res.status(401).json({
      error: { message: "Authentication required", code: "UNAUTHENTICATED" },
      requestId: req.requestId,
    });
    return null;
  }
  return id;
}

function sendInvalid(
  res: Response,
  requestId: string | undefined,
  details: unknown,
): void {
  res.status(400).json({
    error: { message: "Invalid input", code: "INVALID_INPUT", details },
    requestId,
  });
}

function sendServerError(res: Response, requestId: string | undefined): void {
  res.status(500).json({
    error: { message: "Internal server error", code: "INTERNAL" },
    requestId,
  });
}

export function encodeFeedCursor(cursor: NotificationFeedCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeFeedCursor(raw: string): NotificationFeedCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const result = notificationFeedCursorSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/** GET / — reverse-chronological in_app feed, cursor paginated. */
router.get("/", async (req: Request, res: Response) => {
  const recipientId = recipientOf(req, res);
  if (!recipientId) return;

  const query = notificationFeedQuerySchema.safeParse(req.query);
  if (!query.success)
    return sendInvalid(res, req.requestId, query.error.flatten());

  let before: NotificationFeedCursor | null = null;
  if (query.data.cursor !== undefined) {
    before = decodeFeedCursor(query.data.cursor);
    if (!before)
      return sendInvalid(res, req.requestId, { cursor: ["malformed cursor"] });
  }

  const limit = query.data.limit;
  const { data, error } = await supabaseServer.rpc("notification_feed", {
    p_recipient_id: recipientId,
    p_limit: limit + 1,
    p_before_created_at: before?.createdAt ?? null,
    p_before_message_id: before?.messageId ?? null,
  });
  if (error) {
    logger.error(
      "NOTIFICATIONS",
      "feed_read_failed",
      "notification_feed failed",
      {
        requestId: req.requestId,
        code: error.code,
        message: error.message,
      },
    );
    return sendServerError(res, req.requestId);
  }
  const rows = z.array(notificationFeedRowSchema).safeParse(data ?? []);
  if (!rows.success) {
    logger.error(
      "NOTIFICATIONS",
      "feed_rows_malformed",
      "notification_feed rows did not match the schema",
      {
        requestId: req.requestId,
        issues: rows.error.issues.length,
      },
    );
    return sendServerError(res, req.requestId);
  }

  const siteUrl = siteUrlFromEnv();
  const page = rows.data.slice(0, limit);
  const items: NotificationFeedItem[] = page.map((row) => {
    const rendered = renderInApp(row.event_type, row.payload, {
      recipientIsSubject: row.subject_profile_id === recipientId,
      siteUrl,
    });
    if (!rendered.ok) {
      // An event that will not render is still a feed row the recipient owns; it shows a
      // neutral title rather than disappearing. Logged with ids only.
      logger.warn(
        "NOTIFICATIONS",
        "feed_item_unrenderable",
        "Feed item could not be rendered",
        {
          requestId: req.requestId,
          messageId: row.message_id,
          eventType: row.event_type,
          reason: rendered.error,
        },
      );
    }
    return {
      messageId: row.message_id,
      eventId: row.event_id,
      eventType: row.event_type,
      title: rendered.ok ? rendered.value.title : "Notification",
      body: rendered.ok ? rendered.value.body : "",
      href: rendered.ok ? rendered.value.href : null,
      createdAt: row.created_at,
      seenAt: row.seen_at,
      readAt: row.read_at,
    };
  });

  const last = page[page.length - 1];
  const nextCursor =
    rows.data.length > limit && last
      ? encodeFeedCursor({
          createdAt: last.created_at,
          messageId: last.message_id,
        })
      : null;

  return res.json({ data: { items, nextCursor }, requestId: req.requestId });
});

/** GET /unread-count — rows with seen_at IS NULL, for the badge. */
router.get("/unread-count", async (req: Request, res: Response) => {
  const recipientId = recipientOf(req, res);
  if (!recipientId) return;

  const { data, error } = await supabaseServer.rpc(
    "notification_unread_count",
    {
      p_recipient_id: recipientId,
    },
  );
  if (error) {
    logger.error(
      "NOTIFICATIONS",
      "unread_count_failed",
      "notification_unread_count failed",
      {
        requestId: req.requestId,
        code: error.code,
        message: error.message,
      },
    );
    return sendServerError(res, req.requestId);
  }
  const unread = z.number().int().min(0).safeParse(data);
  if (!unread.success) return sendServerError(res, req.requestId);
  return res.json({ data: { unread: unread.data }, requestId: req.requestId });
});

/** POST /mark-all-seen — stamps seen_at on every unseen, unarchived in_app row. */
router.post("/mark-all-seen", async (req: Request, res: Response) => {
  const recipientId = recipientOf(req, res);
  if (!recipientId) return;

  const { data, error } = await supabaseServer.rpc(
    "mark_all_notifications_seen",
    {
      p_recipient_id: recipientId,
    },
  );
  if (error) {
    logger.error(
      "NOTIFICATIONS",
      "mark_all_seen_failed",
      "mark_all_notifications_seen failed",
      {
        requestId: req.requestId,
        code: error.code,
        message: error.message,
      },
    );
    return sendServerError(res, req.requestId);
  }
  const marked = z.number().int().min(0).safeParse(data);
  if (!marked.success) return sendServerError(res, req.requestId);
  return res.json({ data: { marked: marked.data }, requestId: req.requestId });
});

/** PATCH /:message_id — sets seen_at, read_at, or archived_at (first observation wins). */
router.patch("/:message_id", async (req: Request, res: Response) => {
  const recipientId = recipientOf(req, res);
  if (!recipientId) return;

  const params = notificationMessageIdParamSchema.safeParse(req.params);
  if (!params.success)
    return sendInvalid(res, req.requestId, params.error.flatten());
  const body = notificationPatchBodySchema.safeParse(req.body);
  if (!body.success)
    return sendInvalid(res, req.requestId, body.error.flatten());

  const { data, error } = await supabaseServer.rpc("mark_notification", {
    p_recipient_id: recipientId,
    p_message_id: params.data.message_id,
    p_seen: body.data.seen === true,
    p_read: body.data.read === true,
    p_archived: body.data.archived === true,
  });
  if (error) {
    logger.error("NOTIFICATIONS", "mark_failed", "mark_notification failed", {
      requestId: req.requestId,
      code: error.code,
      message: error.message,
    });
    return sendServerError(res, req.requestId);
  }
  const rows = z.array(notificationMessageRowSchema).safeParse(data ?? []);
  if (!rows.success) return sendServerError(res, req.requestId);
  const row = rows.data[0];
  if (!row) {
    // Not this recipient's message (or no such message): identical answer, no enumeration.
    return res.status(404).json({
      error: { message: "Not found", code: "NOT_FOUND" },
      requestId: req.requestId,
    });
  }
  return res.json({
    data: {
      messageId: row.message_id,
      seenAt: row.seen_at,
      readAt: row.read_at,
      archivedAt: row.archived_at,
    },
    requestId: req.requestId,
  });
});

export default router;
