/**
 * @spec [contracts/notifications.contract.md §3 (channel matrix: in_app rows are the feed;
 *        seen_at / read_at / archived_at are the recipient's only writes), §9.4 (the recipient
 *        is the session principal); lyceon-coding-standards §11.1 (domain logic in lib, not
 *        components), §11.2 (server state through the query layer), §7.2 (shapes from
 *        packages/shared, never hand-written); owner brief 2026-09-15 Part B]
 *        | @implemented [2026-09-15]
 *
 * plain English: the client's one view of the notification API, consumed by the bell and by
 * the /notifications page so the two cannot drift. Every response is parsed against the
 * shared schema before a component sees it. Query keys live here too, so an invalidation in
 * one surface refreshes the other. No copy, no payload knowledge: titles and bodies arrive
 * rendered from the server (one event, one payload, two channel-appropriate renderings —
 * the email rendering never reaches the client).
 */
import {
  notificationFeedResponseSchema,
  notificationMarkAllReadResponseSchema,
  notificationMarkAllSeenResponseSchema,
  notificationPatchResponseSchema,
  notificationUnreadCountResponseSchema,
  type NotificationFeedResponse,
  type NotificationPatchBody,
  type NotificationPatchResponse,
  type NotificationUnreadCountResponse,
} from "@lyceon/shared/notifications-schema";
import { apiRequest } from "./queryClient";

export const NOTIFICATIONS_QUERY_ROOT = "/api/notifications" as const;
/** The bell's recent-items page (inbox, first page only). */
export const NOTIFICATIONS_FEED_KEY = [
  NOTIFICATIONS_QUERY_ROOT,
  "feed",
] as const;
export const NOTIFICATIONS_UNREAD_KEY = [
  NOTIFICATIONS_QUERY_ROOT,
  "unread-count",
] as const;
/** The page's paginated feed, one key per view. */
export function notificationsPageFeedKey(view: NotificationsView) {
  return [NOTIFICATIONS_QUERY_ROOT, "page", view] as const;
}

export type NotificationsView = "inbox" | "archived";

export const NOTIFICATIONS_BELL_PAGE_LIMIT = 20;
export const NOTIFICATIONS_PAGE_LIMIT = 20;

/** Every route answers `{ data, requestId }`; parse the `data` half against its schema. */
async function readEnvelope<T>(
  res: Response,
  parse: (value: unknown) => T,
): Promise<T> {
  const json: unknown = await res.json();
  const data =
    json && typeof json === "object" && "data" in json
      ? (json as { data: unknown }).data
      : undefined;
  return parse(data);
}

export async function fetchUnreadCount(): Promise<NotificationUnreadCountResponse> {
  const res = await apiRequest(`${NOTIFICATIONS_QUERY_ROOT}/unread-count`);
  return readEnvelope(res, (d) =>
    notificationUnreadCountResponseSchema.parse(d),
  );
}

export async function fetchNotificationsPage(input: {
  view: NotificationsView;
  cursor?: string | null;
  limit?: number;
}): Promise<NotificationFeedResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? NOTIFICATIONS_PAGE_LIMIT));
  if (input.view === "archived") params.set("archived", "true");
  if (input.cursor) params.set("cursor", input.cursor);
  const res = await apiRequest(
    `${NOTIFICATIONS_QUERY_ROOT}?${params.toString()}`,
  );
  return readEnvelope(res, (d) => notificationFeedResponseSchema.parse(d));
}

export async function markAllNotificationsSeen(): Promise<number> {
  const res = await apiRequest(`${NOTIFICATIONS_QUERY_ROOT}/mark-all-seen`, {
    method: "POST",
  });
  const parsed = await readEnvelope(res, (d) =>
    notificationMarkAllSeenResponseSchema.parse(d),
  );
  return parsed.marked;
}

export async function markAllNotificationsRead(): Promise<number> {
  const res = await apiRequest(`${NOTIFICATIONS_QUERY_ROOT}/mark-all-read`, {
    method: "POST",
  });
  const parsed = await readEnvelope(res, (d) =>
    notificationMarkAllReadResponseSchema.parse(d),
  );
  return parsed.marked;
}

export async function patchNotification(
  messageId: string,
  patch: NotificationPatchBody,
): Promise<NotificationPatchResponse> {
  const res = await apiRequest(`${NOTIFICATIONS_QUERY_ROOT}/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return readEnvelope(res, (d) => notificationPatchResponseSchema.parse(d));
}

/** "just now", "5m ago", "3h ago", "2d ago" — the compact form both surfaces show. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** The absolute time behind a relative label (hover / long-press), in the viewer's locale. */
export function absoluteTime(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  return then.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
