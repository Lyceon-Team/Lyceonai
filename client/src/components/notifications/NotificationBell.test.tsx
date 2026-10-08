// @vitest-environment jsdom
/**
 * @spec [production QA 2026-10-07 items 12 and 13 (Karl: the notifications popover on the student
 *        tokens and fonts, nothing under 14px, a skeleton not "Loading…", an unread badge on the
 *        bell, and dark mode); contracts/notifications.contract.md §3 (the badge is the server's
 *        unread count); register §8 F-70 (an overlay follows the page theme)]
 *        | @implemented [2026-10-07]
 *
 * plain English: the App shell's bell (`tone="student"`) against the guardian shell's (`app`,
 * the control). The feed items are the REAL in-app renderer's output (`renderInApp`, which the
 * notifications route calls) parsed through the shared feed-item schema, so the popover is shown
 * the titles and bodies production sends. The network layer is the only stub: the unread count,
 * the feed (held unanswered for the loading state) and mark-all-seen.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  notificationFeedItemSchema,
  type NotificationFeedItem,
  type NotificationFeedResponse,
} from "@lyceon/shared/notifications-schema";
import { renderInApp } from "../../../../server/lib/notifications/templates";
import { NotificationBell } from "./NotificationBell";

const api = vi.hoisted(() => ({
  unread: 3,
  feed: null as null | Promise<NotificationFeedResponse>,
}));

vi.mock("@/lib/notificationsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notificationsApi")>()),
  fetchUnreadCount: async () => ({ unread: api.unread }),
  fetchNotificationsPage: () => api.feed ?? new Promise(() => undefined),
  markAllNotificationsSeen: async () => 0,
  patchNotification: async () => ({}),
}));

function feedItem(n: number): NotificationFeedItem {
  const rendered = renderInApp(
    "full_length_tomorrow",
    {
      block_id: `00000000-0000-4000-8000-00000000000${n}`,
      local_date: "2026-10-17",
    },
    { recipientIsSubject: true, siteUrl: "" },
  );
  if (!rendered.ok) throw new Error("the real renderer refused the payload");
  return notificationFeedItemSchema.parse({
    messageId: `00000000-0000-4000-8000-0000000000a${n}`,
    eventId: `00000000-0000-4000-8000-0000000000b${n}`,
    eventType: "full_length_tomorrow",
    ...rendered.value,
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    seenAt: null,
    readAt: null,
    archivedAt: null,
  });
}

function renderBell(tone: "app" | "student"): void {
  const { hook } = memoryLocation({ path: "/dashboard" });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <NotificationBell tone={tone} />
      </Router>
    </QueryClientProvider>,
  );
}

async function openFeed(): Promise<HTMLElement> {
  const trigger = await screen.findByRole("button", {
    name: "Notifications, 3 unread",
  });
  fireEvent.click(trigger);
  return screen.findByTestId("notification-feed");
}

/** Every class token under `root`, the root's own included. */
function classTokens(root: HTMLElement): string[] {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
    .flatMap((el) => (el.getAttribute("class") ?? "").split(/\s+/))
    .filter((c) => c.length > 0);
}

/** Font sizes below 14px: Tailwind's xs/sm steps and any bracketed px value under 14. */
function under14(tokens: string[]): string[] {
  return tokens.filter((c) => {
    if (/(^|:)text-(xs|sm)$/.test(c)) return true;
    const px = /(^|:)text-\[(\d+(?:\.\d+)?)px\]$/.exec(c);
    if (px) return Number(px[2]) < 14;
    return /(^|:)text-\[0?\.\d+rem\]$/.test(c);
  });
}

beforeEach(() => {
  api.unread = 3;
  api.feed = null;
});

afterEach(() => {
  cleanup();
});

describe("QA 13: the student bell", () => {
  it("shows the server's unread count as a 14px badge on the rail's 'on' colours", async () => {
    renderBell("student");
    const badge = await screen.findByTestId("notification-badge");
    expect(badge.textContent).toBe("3");
    const c = badge.className.split(/\s+/);
    expect(c).toEqual(
      expect.arrayContaining([
        "text-lyc-meta",
        "bg-lyc-rail-on-bg",
        "text-lyc-rail-on-ink",
      ]),
    );
    expect(under14(c)).toEqual([]);
  });

  it("no unread, no badge (control)", async () => {
    api.unread = 0;
    renderBell("student");
    await screen.findByRole("button", { name: "Notifications" });
    expect(screen.queryByTestId("notification-badge")).toBeNull();
  });

  it("while the feed loads it shows a skeleton (a named status), never the word 'Loading'", async () => {
    renderBell("student");
    const feed = await openFeed();
    const skeleton = within(feed).getByRole("status", {
      name: "Loading notifications",
    });
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    expect(skeleton.querySelectorAll("li").length).toBe(3);
    expect(feed.textContent).not.toMatch(/loading/i);
  });

  it("the open popover sits in its own .lyc root (the page's theme), on the student tokens, nothing below 14px", async () => {
    api.feed = Promise.resolve({
      items: [feedItem(1), feedItem(2)],
      nextCursor: null,
    });
    renderBell("student");
    const feed = await openFeed();
    // Presence first: the real items rendered.
    await waitFor(() =>
      expect(within(feed).getAllByRole("listitem")).toHaveLength(2),
    );
    expect(feed.textContent).toContain(feedItem(1).title);

    const root = feed.closest<HTMLElement>(".lyc");
    expect(root).not.toBeNull();
    expect(root?.hasAttribute("data-theme-lock")).toBe(false);
    const own = feed.className.split(/\s+/);
    expect(own).toEqual(
      expect.arrayContaining([
        "bg-lyc-sheet",
        "border-lyc-rule",
        "font-lyc-sans",
      ]),
    );
    expect(own).not.toContain("bg-popover");
    const tokens = classTokens(feed);
    expect(under14(tokens)).toEqual([]);
    expect(
      tokens.filter((c) => /muted-foreground|text-primary$/.test(c)),
    ).toEqual([]);
  });
});

describe("control: the guardian shell's bell keeps the app-wide tokens", () => {
  it("portals with no .lyc root and draws on bg-popover", async () => {
    api.feed = Promise.resolve({ items: [feedItem(1)], nextCursor: null });
    renderBell("app");
    const feed = await openFeed();
    await waitFor(() =>
      expect(within(feed).getAllByRole("listitem")).toHaveLength(1),
    );
    expect(feed.closest(".lyc")).toBeNull();
    expect(feed.className.split(/\s+/)).toContain("bg-popover");
  });
});
