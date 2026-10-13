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
 *
 * TONE. @spec [production QA 2026-10-07 items 12 and 13 (Karl: the popover on the student tokens
 * and fonts, nothing under 14px, a skeleton not "Loading…", an unread badge on the bell, and dark
 * mode); item 14 (the rail shows the current section on /notifications); DESIGN.md §1; register
 * §8 F-70 (an overlay follows the page theme)] | @implemented [2026-10-07]
 * `tone="student"` (the App shell) portals the popover into its own `.lyc` root carrying the
 * shell's theme lock, as the avatar menu does since F-70, and draws it, the badge and the
 * loading skeleton with the student tokens at 14px and up; on a desktop rail it opens beside the
 * rail. `current` marks the bell as the current section (aria-current="page") on the
 * notifications page, which has no rail item of its own. The guardian shell keeps the default
 * `app` tone: its pages use the app-wide tokens. The badge count is still the server's unread
 * count (`GET /api/notifications/unread-count`), never a client-side guess.
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
import { PHONE_LAYOUT_QUERY, useMediaQuery } from "@/hooks/use-mobile";
import { useActiveThemeLock } from "@/components/layout/theme-lock";
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

type BellTone = "app" | "student";

type ToneClasses = {
  readonly badge: string;
  readonly content: string;
  readonly header: string;
  readonly heading: string;
  readonly muted: string;
  readonly list: string;
  readonly item: string;
  readonly title: string;
  readonly time: string;
  readonly body: string;
  readonly footer: string;
  readonly link: string;
  readonly bar: string;
};

const TONE: Readonly<Record<BellTone, ToneClasses>> = {
  app: {
    badge:
      "absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-primary text-primary-foreground text-[0.65rem] leading-[1.1rem] text-center",
    content: "w-80 p-0",
    header: "px-4 py-3 border-b",
    heading: "font-semibold text-sm",
    muted: "p-4 text-sm text-muted-foreground",
    list: "divide-y",
    item: "w-full text-left px-4 py-3 hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    title: "text-sm font-medium",
    time: "text-xs text-muted-foreground whitespace-nowrap",
    body: "mt-1 text-xs text-muted-foreground",
    footer: "border-t px-4 py-2",
    link: "text-sm font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
    bar: "rounded bg-muted",
  },
  // DESIGN.md §1: the student tokens only, the student fonts, nothing below 14px. The badge sits
  // on the rail (or the phone top bar), which is --rail in both themes, so it takes the rail's
  // "on" pair, the same contrast as the current rail item.
  student: {
    badge:
      "absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-lyc-rail-on-bg px-1 font-lyc-sans text-lyc-meta font-semibold leading-none text-lyc-rail-on-ink",
    content:
      "w-[340px] max-w-[calc(100vw-32px)] border-lyc-rule bg-lyc-sheet p-0 font-lyc-sans text-lyc-ink",
    header: "border-b border-lyc-rule px-4 py-3",
    heading:
      "m-0 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong",
    muted: "m-0 p-4 text-lyc-body text-lyc-muted",
    list: "divide-y divide-lyc-rule",
    item: "w-full px-4 py-3 text-left hover:bg-lyc-hover focus-visible:bg-lyc-hover focus-visible:outline-none",
    title: "text-lyc-body font-semibold text-lyc-ink-strong",
    time: "whitespace-nowrap text-lyc-meta text-lyc-muted",
    body: "m-0 mt-1 text-lyc-meta text-lyc-muted",
    footer: "border-t border-lyc-rule px-4 py-3",
    link: "rounded-sm text-lyc-meta-lg font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline",
    bar: "rounded-md bg-lyc-seg-empty",
  },
};

/** QA 13: the feed's loading state, three item-shaped placeholders (no motion, DESIGN.md §1). */
function FeedSkeleton({ t }: { t: ToneClasses }): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading notifications"
      aria-busy="true"
      data-testid="notifications-loading"
    >
      <ul aria-hidden="true" className={`m-0 list-none p-0 ${t.list}`}>
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className={`${t.bar} h-4 w-3/5`} />
              <div className={`${t.bar} h-3.5 w-12`} />
            </div>
            <div className={`${t.bar} h-3.5 w-4/5`} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NotificationBell({
  tone = "app",
  current = false,
  railItem,
}: {
  /** QA 12/13: `student` draws the popover in the student tokens, inside the page's theme. */
  tone?: BellTone;
  /** QA 14: the notifications page is open, so the bell is the current section. */
  current?: boolean;
  /**
   * QA2-H (production re-test 2026-10-08): the App shell draws the bell as one of its rail items,
   * with the rail item's own classes (its active style included) and a visible "Notifications"
   * label. The shell owns both class strings, so the rail's look has one source.
   */
  railItem?: { readonly className: string; readonly labelClassName: string };
} = {}) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  // F-65 / F-70: the portal takes the lock of the shell on screen (layout/theme-lock.tsx).
  const themeLock = useActiveThemeLock();
  // On the desktop rail the bell sits low in a 96px column: open beside it, not over it.
  const phoneLayout = useMediaQuery(PHONE_LAYOUT_QUERY, false);
  const t = TONE[tone];

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
  const student = tone === "student";
  const triggerName =
    unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  const badge =
    unread > 0 ? (
      <span
        aria-hidden="true"
        className={t.badge}
        data-testid="notification-badge"
      >
        {unread > 9 ? "9+" : unread}
      </span>
    ) : null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {railItem !== undefined ? (
          <button
            type="button"
            className={railItem.className}
            aria-label={triggerName}
            aria-current={current ? "page" : undefined}
            data-testid="button-notifications"
          >
            {/* The badge rides the icon, as the rail's lock glyph rides its item. */}
            <span className="relative inline-flex">
              <Bell aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />
              {badge}
            </span>
            <span className={railItem.labelClassName}>Notifications</span>
          </button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={triggerName}
            aria-current={current ? "page" : undefined}
            data-testid="button-notifications"
          >
            <Bell className="h-5 w-5" />
            {badge}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={t.content}
        data-testid="notification-feed"
        {...(student
          ? {
              portalClassName: "lyc contents",
              portalThemeLock: themeLock,
              side: phoneLayout ? "bottom" : "right",
            }
          : {})}
      >
        <div className={t.header}>
          <h3 className={t.heading}>Notifications</h3>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {feedQuery.isLoading ? (
            <FeedSkeleton t={t} />
          ) : feedQuery.isError ? (
            <div className="p-4 space-y-2" data-testid="notifications-error">
              <p
                className={
                  student
                    ? "m-0 text-lyc-body text-lyc-muted"
                    : "text-sm text-muted-foreground"
                }
              >
                Could not load notifications.
              </p>
              <Button
                size="sm"
                variant={student ? "lyc-outline" : "outline"}
                onClick={() => void feedQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className={t.muted} data-testid="notifications-empty">
              You're all caught up.
            </p>
          ) : (
            <ul className={student ? `m-0 list-none p-0 ${t.list}` : t.list}>
              {items.map((item) => (
                <li key={item.messageId}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={`${t.item} ${item.readAt ? "opacity-80" : ""}`}
                    data-testid={`notification-item-${item.messageId}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={t.title}>{item.title}</span>
                      <span className={t.time}>
                        {relativeTime(item.createdAt)}
                      </span>
                    </div>
                    {item.body && <p className={t.body}>{item.body}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={t.footer}>
          <Link
            href="/notifications"
            className={t.link}
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
