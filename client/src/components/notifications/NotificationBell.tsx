/**
 * @spec [contracts/notifications.contract.md §3, §9.4; lyceon-coding-standards §11.1
 *        (components render, hooks fetch), §11.2 TanStack Query for server state] |
 *        @implemented [2026-09-03]
 *
 * plain English: the bell in the app header. The badge is the unread count
 * (`seen_at IS NULL`); opening the popover loads the feed and marks everything seen; clicking
 * an item marks it read and follows its link. Server state lives in TanStack Query — refetch
 * on open and on window focus, no polling, no Realtime (the publication has zero tables and
 * adding one is a product decision nobody has made). Titles and bodies arrive rendered from
 * the server; this component carries no copy and no payload knowledge. The dropdown keeps
 * the recent items and links to /notifications for history, archive and mark-all-read
 * (owner brief 2026-09-15 Part B1); the fetchers, keys and time formatting are shared with
 * that page through @/lib/notificationsApi so the two surfaces cannot drift.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  NOTIFICATIONS_BELL_PAGE_LIMIT,
  NOTIFICATIONS_FEED_KEY,
  NOTIFICATIONS_QUERY_ROOT,
  NOTIFICATIONS_UNREAD_KEY,
  fetchNotificationsPage,
  fetchUnreadCount,
  markAllNotificationsSeen,
  patchNotification,
  relativeTime,
} from "@/lib/notificationsApi";
import type { NotificationFeedItem } from "@lyceon/shared/notifications-schema";

const FEED_KEY = NOTIFICATIONS_FEED_KEY;
const UNREAD_KEY = NOTIFICATIONS_UNREAD_KEY;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const unreadQuery = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: fetchUnreadCount,
    refetchOnWindowFocus: true,
    refetchInterval: false,
    staleTime: 15_000,
  });

  const feedQuery = useQuery({
    queryKey: FEED_KEY,
    queryFn: () =>
      fetchNotificationsPage({
        view: "inbox",
        limit: NOTIFICATIONS_BELL_PAGE_LIMIT,
      }),
    enabled: open,
    refetchOnWindowFocus: true,
    refetchInterval: false,
  });

  const markAllSeen = useMutation({
    mutationFn: markAllNotificationsSeen,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });

  const markRead = useMutation({
    mutationFn: (messageId: string) =>
      patchNotification(messageId, { read: true }),
    onSuccess: () => {
      // The page shares the root key, so a read here refreshes it there too.
      void queryClient.invalidateQueries({
        queryKey: [NOTIFICATIONS_QUERY_ROOT],
      });
    },
  });

  const unread = unreadQuery.data?.unread ?? 0;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void feedQuery.refetch();
      if (unread > 0) markAllSeen.mutate();
    }
  };

  const handleItemClick = (item: NotificationFeedItem) => {
    if (!item.readAt) markRead.mutate(item.messageId);
    setOpen(false);
    if (item.href) navigate(item.href);
  };

  const items = feedQuery.data?.items ?? [];

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
          }
          data-testid="button-notifications"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-primary text-primary-foreground text-[0.65rem] leading-[1.1rem] text-center"
              data-testid="notification-badge"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        data-testid="notification-feed"
      >
        <div className="px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Notifications</h3>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {feedQuery.isLoading ? (
            <p
              className="p-4 text-sm text-muted-foreground"
              data-testid="notifications-loading"
            >
              Loading…
            </p>
          ) : feedQuery.isError ? (
            <div className="p-4 space-y-2" data-testid="notifications-error">
              <p className="text-sm text-muted-foreground">
                Could not load notifications.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void feedQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p
              className="p-4 text-sm text-muted-foreground"
              data-testid="notifications-empty"
            >
              You're all caught up.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.messageId}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={`w-full text-left px-4 py-3 hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      item.readAt ? "opacity-80" : ""
                    }`}
                    data-testid={`notification-item-${item.messageId}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{item.title}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {relativeTime(item.createdAt)}
                      </span>
                    </div>
                    {item.body && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.body}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t px-4 py-2">
          <Link
            href="/notifications"
            className="text-sm font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            onClick={() => setOpen(false)}
            data-testid="link-notifications-see-all"
          >
            See all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default NotificationBell;
