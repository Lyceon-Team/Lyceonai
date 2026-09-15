// @vitest-environment jsdom
/**
 * /notifications page — behaviour against a recorded fake of the notification API.
 *
 * @spec [contracts/notifications.contract.md §3 (seen / read / archived are separate
 *        columns and separate acts), §3.1 (archive view), §3.2 (mark-all-read);
 *        owner brief 2026-09-15 Part B3 (1)–(3) and B2 (accessibility)] | @implemented [2026-09-15]
 *
 * plain English: the fake records every request the page makes and keeps an inbox and an
 * archive so an archive PATCH is observable as a row moving between the two views. The
 * assertions are on the requests (what the page told the server) and on what the page
 * shows after the query layer refetches — not on component internals.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationFeedItem } from "@lyceon/shared/notifications-schema";

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, useLocation: () => ["/notifications", navigateMock] };
});
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "u1", email: "s@example.test", role: "student" },
    isGuardian: false,
    isAdmin: false,
    authLoading: false,
    isAuthenticated: true,
    signOut: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];
const state: {
  inbox: NotificationFeedItem[];
  archived: NotificationFeedItem[];
} = {
  inbox: [],
  archived: [],
};
const PAGE = 2;
/** Fixed clock for fixtures so an item's createdAt is the same on every call. */
const BASE = Date.parse("2026-09-15T12:00:00.000Z");

function item(
  n: number,
  extra: Partial<NotificationFeedItem> = {},
): NotificationFeedItem {
  return {
    messageId: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
    eventId: `10000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
    eventType: "guardian_linked",
    title: `Notification ${n}`,
    body: `Body of notification ${n}, in full.`,
    href: "/profile?tab=settings",
    createdAt: new Date(BASE - n * 3600_000).toISOString(),
    seenAt: null,
    readAt: null,
    archivedAt: null,
    ...extra,
  };
}

function json(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data, requestId: "t" }),
  };
}

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const u = new URL(url, "http://test.local");
      if (
        method === "GET" &&
        u.pathname === "/api/notifications/unread-count"
      ) {
        return json({ unread: state.inbox.filter((i) => !i.seenAt).length });
      }
      if (method === "GET" && u.pathname === "/api/notifications") {
        const source =
          u.searchParams.get("archived") === "true"
            ? state.archived
            : state.inbox;
        const cursor = u.searchParams.get("cursor");
        const start = cursor
          ? source.findIndex((i) => i.messageId === cursor) + 1
          : 0;
        const page = source.slice(start, start + PAGE);
        const last = page[page.length - 1];
        const nextCursor =
          last && start + PAGE < source.length ? last.messageId : null;
        return json({ items: page, nextCursor });
      }
      if (
        method === "POST" &&
        u.pathname === "/api/notifications/mark-all-seen"
      ) {
        const now = new Date().toISOString();
        let marked = 0;
        for (const i of state.inbox)
          if (!i.seenAt) {
            i.seenAt = now;
            marked++;
          }
        return json({ marked });
      }
      if (
        method === "POST" &&
        u.pathname === "/api/notifications/mark-all-read"
      ) {
        const now = new Date().toISOString();
        let marked = 0;
        for (const i of state.inbox)
          if (!i.readAt) {
            i.readAt = now;
            i.seenAt ??= now;
            marked++;
          }
        return json({ marked });
      }
      if (method === "PATCH") {
        const id = u.pathname.split("/").pop();
        const idx = state.inbox.findIndex((i) => i.messageId === id);
        const target = state.inbox[idx];
        if (!target)
          return { ok: false, status: 404, json: async () => ({ error: {} }) };
        const now = new Date().toISOString();
        if (body?.read) {
          target.readAt ??= now;
          target.seenAt ??= now;
        }
        if (body?.archived) {
          target.archivedAt ??= now;
          state.inbox.splice(idx, 1);
          state.archived.unshift(target);
        }
        return json({
          messageId: target.messageId,
          seenAt: target.seenAt,
          readAt: target.readAt,
          archivedAt: target.archivedAt,
        });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    },
  ),
}));

import { NotificationsFeed } from "./notifications";

function renderFeed() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationsFeed />
    </QueryClientProvider>,
  );
}

function selectTab(testId: string) {
  const tab = screen.getByTestId(testId);
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

beforeEach(() => {
  calls.length = 0;
  navigateMock.mockReset();
  state.inbox = [
    item(1),
    item(2),
    item(3, {
      readAt: new Date().toISOString(),
      seenAt: new Date().toISOString(),
    }),
  ];
  state.archived = [
    item(9, {
      archivedAt: new Date().toISOString(),
      readAt: new Date().toISOString(),
      seenAt: new Date().toISOString(),
    }),
  ];
});

describe("NotificationsFeed (B3)", () => {
  it("B3.1 renders the inbox in full (title AND body), paginates by cursor, and shows archived items only when asked", async () => {
    renderFeed();
    expect(await screen.findByText("Notification 1")).toBeTruthy();
    expect(screen.getByText("Body of notification 1, in full.")).toBeTruthy();
    expect(screen.getByText("Notification 2")).toBeTruthy();
    // Page size is 2 in the fake: the third item is behind "Load older".
    expect(screen.queryByText("Notification 3")).toBeNull();
    expect(screen.queryByText("Notification 9")).toBeNull(); // archived, not in the inbox

    fireEvent.click(screen.getByTestId("button-load-more"));
    expect(await screen.findByText("Notification 3")).toBeTruthy();
    const pagedCall = calls.find(
      (c) => c.method === "GET" && c.url.includes("cursor="),
    );
    expect(pagedCall?.url).toContain(`cursor=${item(2).messageId}`);
    expect(pagedCall?.url).not.toContain("archived=true");
    expect(screen.queryByTestId("button-load-more")).toBeNull();

    selectTab("tab-archived");
    expect(await screen.findByText("Notification 9")).toBeTruthy();
    expect(screen.queryByText("Notification 1")).toBeNull();
    const archivedCall = calls.find(
      (c) => c.method === "GET" && c.url.includes("archived=true"),
    );
    expect(archivedCall).toBeDefined();
    // In the archive there is nothing to archive; the row says when it was archived instead.
    expect(
      screen.queryByTestId(`button-archive-${item(9).messageId}`),
    ).toBeNull();
    expect(
      within(
        screen.getByTestId(`notification-row-${item(9).messageId}`),
      ).getByText(/^Archived/),
    ).toBeTruthy();
  });

  it("B3.2 opening the page marks everything SEEN once and marks nothing READ", async () => {
    renderFeed();
    await screen.findByText("Notification 1");
    await waitFor(() => {
      expect(
        calls.filter(
          (c) => c.method === "POST" && c.url.endsWith("/mark-all-seen"),
        ),
      ).toHaveLength(1);
    });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect(
      calls.filter(
        (c) => c.method === "POST" && c.url.endsWith("/mark-all-read"),
      ),
    ).toHaveLength(0);
    // Unread stays unread in the UI: read is an explicit act.
    expect(
      screen
        .getByTestId(`notification-row-${item(1).messageId}`)
        .getAttribute("data-unread"),
    ).toBe("true");
    expect(
      screen
        .getByTestId(`notification-row-${item(2).messageId}`)
        .getAttribute("data-unread"),
    ).toBe("true");
  });

  it("B3.3 Archive removes the item from the inbox and it is retrievable in the archived view", async () => {
    renderFeed();
    await screen.findByText("Notification 1");
    fireEvent.click(screen.getByTestId(`button-archive-${item(1).messageId}`));
    await waitFor(() => {
      expect(screen.queryByText("Notification 1")).toBeNull();
    });
    const patch = calls.find(
      (c) => c.method === "PATCH" && c.url.endsWith(item(1).messageId),
    );
    expect(patch?.body).toEqual({ archived: true });

    selectTab("tab-archived");
    expect(await screen.findByText("Notification 1")).toBeTruthy();
    expect(screen.getByText("Notification 9")).toBeTruthy();
  });

  it("read is explicit: 'Mark as read' PATCHes read; opening an item marks it read and follows its link; 'Mark all as read' POSTs once", async () => {
    renderFeed();
    await screen.findByText("Notification 1");

    fireEvent.click(
      screen.getByTestId(`button-mark-read-${item(2).messageId}`),
    );
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.method === "PATCH" &&
            c.url.endsWith(item(2).messageId) &&
            (c.body as { read?: boolean }).read === true,
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(
        screen
          .getByTestId(`notification-row-${item(2).messageId}`)
          .getAttribute("data-unread"),
      ).toBe("false");
    });

    fireEvent.click(
      screen.getByTestId(`notification-open-${item(1).messageId}`),
    );
    expect(navigateMock).toHaveBeenCalledWith("/profile?tab=settings");
    await waitFor(() => {
      expect(
        calls.some(
          (c) => c.method === "PATCH" && c.url.endsWith(item(1).messageId),
        ),
      ).toBe(true);
    });

    // Everything visible is read now; the control disables itself until something is unread.
    await waitFor(() => {
      expect(
        (screen.getByTestId("button-mark-all-read") as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });
  });

  it("'Mark all as read' POSTs once while something is unread, and the rows render as read afterwards", async () => {
    renderFeed();
    await screen.findByText("Notification 1");
    const button = screen.getByTestId(
      "button-mark-all-read",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => {
      expect(
        calls.filter(
          (c) => c.method === "POST" && c.url.endsWith("/mark-all-read"),
        ),
      ).toHaveLength(1);
    });
    await waitFor(() => {
      expect(
        screen
          .getByTestId(`notification-row-${item(1).messageId}`)
          .getAttribute("data-unread"),
      ).toBe("false");
    });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("B2 accessibility: heading takes focus on arrival, controls are labelled, the time carries the absolute value, the live region announces unread", async () => {
    renderFeed();
    await screen.findByText("Notification 1");
    expect(document.activeElement).toBe(
      screen.getByTestId("notifications-heading"),
    );

    const row = screen.getByTestId(`notification-row-${item(1).messageId}`);
    expect(
      within(row).getByRole("button", { name: 'Archive "Notification 1"' }),
    ).toBeTruthy();
    expect(
      within(row).getByRole("button", {
        name: 'Mark "Notification 1" as read',
      }),
    ).toBeTruthy();
    const time = screen.getByTestId(`notification-time-${item(1).messageId}`);
    expect(time.getAttribute("dateTime")).toBe(item(1).createdAt);
    expect(time.getAttribute("title")).not.toBe("");
    expect(time.getAttribute("title")).toBe(time.getAttribute("aria-label"));
    expect(time.textContent).toMatch(/ago|just now/);
    expect(within(row).getByText("Unread:")).toBeTruthy();

    const live = screen.getByTestId("notifications-live");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toMatch(/unread notification/);
    expect(
      screen.getByRole("tablist", { name: "Notification views" }),
    ).toBeTruthy();
  });

  it("empty states read as intentional in both views", async () => {
    state.inbox = [];
    state.archived = [];
    renderFeed();
    expect(await screen.findByText("You're all caught up")).toBeTruthy();
    expect(screen.queryByTestId("notifications-page-error")).toBeNull();
    selectTab("tab-archived");
    expect(await screen.findByText("Nothing archived")).toBeTruthy();
  });
});
