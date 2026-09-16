/**
 * @spec [contracts/notifications.contract.md §3 (in_app rows are the feed; seen_at, read_at
 *        and archived_at are the recipient's writes, and they are separate columns on
 *        purpose), §3.1 (`?archived=true` is the archive view), §3.2 (mark-all-read), §9.4
 *        (the recipient is the session principal); Doc-01_V8 §36.1 step 6 / §36.3 (both
 *        parties are told when a link is made or revoked — this page is where a student
 *        learns their guardian access changed); lyceon-coding-standards §11.1 (components
 *        render; fetching and mutation live in @/lib/notificationsApi), §11.2 (TanStack
 *        Query), §11.4 (no effect for derived state); owner brief 2026-09-15 Part B]
 *        | @implemented [2026-09-15]
 *
 * plain English: /notifications — the full history the bell dropdown only previews.
 * Reverse-chronological, cursor-paginated, inbox and archive as two views of the same rows.
 * Opening the page marks everything SEEN (the badge clears); READ is an explicit act —
 * opening an item, its "Mark as read" control, or "Mark all as read". Archiving moves a row
 * from the inbox view to the archive view; nothing is deleted here. Each item shows the
 * server-rendered in-app title and body in full (the email rendering of the same event
 * never reaches the client — one event, one payload, two channel-appropriate renderings).
 * Rendered inside the shell that matches the viewer: GuardianShell for a guardian, AppShell
 * for a student — the same page in both, so neither role is a recipient without a surface.
 *
 * Accessibility: the heading takes focus on mount so a keyboard or screen-reader user lands
 * on the page's name; the unread count is announced from a polite live region; every control
 * is a labelled button (no icon-only actions); the relative time carries the absolute time
 * as its accessible name and its hover title.
 */
import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/app-shell";
import { GuardianShell } from "@/components/layout/GuardianShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  NOTIFICATIONS_QUERY_ROOT,
  NOTIFICATIONS_UNREAD_KEY,
  absoluteTime,
  fetchNotificationsPage,
  fetchUnreadCount,
  markAllNotificationsRead,
  markAllNotificationsSeen,
  notificationsPageFeedKey,
  patchNotification,
  relativeTime,
  type NotificationsView,
} from "@/lib/notificationsApi";
import type { NotificationFeedItem } from "@lyceon/shared/notifications-schema";

export default function NotificationsPage() {
  const { isGuardian } = useSupabaseAuth();
  const content = <NotificationsFeed />;
  return isGuardian ? (
    <GuardianShell>{content}</GuardianShell>
  ) : (
    <AppShell>{content}</AppShell>
  );
}

export function NotificationsFeed() {
  const [view, setView] = useState<NotificationsView>("inbox");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const seenOnce = useRef(false);

  const feed = useInfiniteQuery({
    queryKey: notificationsPageFeedKey(view),
    queryFn: ({ pageParam }) =>
      fetchNotificationsPage({ view, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchOnWindowFocus: true,
  });

  const unreadQuery = useQuery({
    queryKey: NOTIFICATIONS_UNREAD_KEY,
    queryFn: fetchUnreadCount,
    staleTime: 15_000,
  });

  const invalidateAll = () =>
    void queryClient.invalidateQueries({
      queryKey: [NOTIFICATIONS_QUERY_ROOT],
    });

  const markAllSeen = useMutation({
    mutationFn: markAllNotificationsSeen,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: NOTIFICATIONS_UNREAD_KEY,
      });
    },
  });
  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: invalidateAll,
  });
  const markRead = useMutation({
    mutationFn: (messageId: string) =>
      patchNotification(messageId, { read: true }),
    onSuccess: invalidateAll,
  });
  const archive = useMutation({
    mutationFn: (messageId: string) =>
      patchNotification(messageId, { archived: true }),
    onSuccess: invalidateAll,
  });

  // Side effects on arrival, not derived state: take focus, and mark everything SEEN once.
  // Seen is what opening the page means; read stays an explicit act (§3, separate columns).
  useEffect(() => {
    headingRef.current?.focus();
    if (!seenOnce.current) {
      seenOnce.current = true;
      markAllSeen.mutate();
    }
  }, []);

  const items: NotificationFeedItem[] =
    feed.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = unreadQuery.data?.unread ?? 0;
  const hasUnreadInInbox = items.some((item) => !item.readAt);

  const openItem = (item: NotificationFeedItem) => {
    if (!item.readAt) markRead.mutate(item.messageId);
    if (item.href) navigate(item.href);
  };

  return (
    <div
      className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-3xl"
      data-testid="notifications-page"
    >
      <p
        className="sr-only"
        aria-live="polite"
        data-testid="notifications-live"
      >
        {unread === 1
          ? "1 unread notification"
          : `${unread} unread notifications`}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold focus:outline-none"
          data-testid="notifications-heading"
        >
          Notifications
        </h1>
        {view === "inbox" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={!hasUnreadInInbox || markAllRead.isPending}
            data-testid="button-mark-all-read"
          >
            Mark all as read
          </Button>
        )}
      </div>

      <Tabs
        value={view}
        onValueChange={(next) =>
          setView(next === "archived" ? "archived" : "inbox")
        }
        className="mb-4"
      >
        <TabsList aria-label="Notification views">
          <TabsTrigger value="inbox" data-testid="tab-inbox">
            Inbox
          </TabsTrigger>
          <TabsTrigger value="archived" data-testid="tab-archived">
            Archived
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {feed.isLoading ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="notifications-page-loading"
        >
          Loading…
        </p>
      ) : feed.isError ? (
        <div className="space-y-2" data-testid="notifications-page-error">
          <p className="text-sm text-muted-foreground">
            Could not load your notifications.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void feed.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-8 text-center"
          data-testid="notifications-page-empty"
        >
          <p className="font-medium">
            {view === "inbox" ? "You're all caught up" : "Nothing archived"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {view === "inbox"
              ? "When a guardian is linked to or removed from your account, it will show up here."
              : "Notifications you archive from your inbox will be kept here."}
          </p>
        </div>
      ) : (
        <ul
          className="divide-y rounded-lg border"
          data-testid="notifications-list"
        >
          {items.map((item) => (
            <NotificationRow
              key={item.messageId}
              item={item}
              view={view}
              onOpen={openItem}
              onMarkRead={(id) => markRead.mutate(id)}
              onArchive={(id) => archive.mutate(id)}
            />
          ))}
        </ul>
      )}

      {feed.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={() => void feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
            data-testid="button-load-more"
          >
            {feed.isFetchingNextPage ? "Loading…" : "Load older notifications"}
          </Button>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  item,
  view,
  onOpen,
  onMarkRead,
  onArchive,
}: {
  item: NotificationFeedItem;
  view: NotificationsView;
  onOpen: (item: NotificationFeedItem) => void;
  onMarkRead: (messageId: string) => void;
  onArchive: (messageId: string) => void;
}) {
  const unread = !item.readAt;
  const absolute = absoluteTime(item.createdAt);
  return (
    <li
      className={`px-4 py-4 ${unread ? "bg-muted/40" : ""}`}
      data-testid={`notification-row-${item.messageId}`}
      data-unread={unread ? "true" : "false"}
    >
      <article aria-labelledby={`notification-title-${item.messageId}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2
              id={`notification-title-${item.messageId}`}
              className={`text-base ${unread ? "font-semibold" : "font-medium"}`}
            >
              {unread && (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full bg-primary mr-2 align-middle"
                  />
                  <span className="sr-only">Unread: </span>
                </>
              )}
              {item.href ? (
                <button
                  type="button"
                  className="text-left hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  onClick={() => onOpen(item)}
                  data-testid={`notification-open-${item.messageId}`}
                >
                  {item.title}
                </button>
              ) : (
                item.title
              )}
            </h2>
            {item.body && (
              <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">
                {item.body}
              </p>
            )}
          </div>
          <time
            dateTime={item.createdAt}
            title={absolute}
            aria-label={absolute}
            className="text-xs text-muted-foreground whitespace-nowrap"
            data-testid={`notification-time-${item.messageId}`}
          >
            {relativeTime(item.createdAt)}
          </time>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {unread && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onMarkRead(item.messageId)}
              aria-label={`Mark "${item.title}" as read`}
              data-testid={`button-mark-read-${item.messageId}`}
            >
              Mark as read
            </Button>
          )}
          {view === "inbox" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onArchive(item.messageId)}
              aria-label={`Archive "${item.title}"`}
              data-testid={`button-archive-${item.messageId}`}
            >
              Archive
            </Button>
          ) : (
            item.archivedAt && (
              <span className="text-xs text-muted-foreground self-center">
                Archived{" "}
                <time
                  dateTime={item.archivedAt}
                  title={absoluteTime(item.archivedAt)}
                >
                  {relativeTime(item.archivedAt)}
                </time>
              </span>
            )
          )}
        </div>
      </article>
    </li>
  );
}
