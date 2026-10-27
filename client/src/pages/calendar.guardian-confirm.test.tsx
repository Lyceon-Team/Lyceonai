// @vitest-environment jsdom
/**
 * "Your guardian will be notified" — the confirmation before a recorded calendar write.
 *
 * @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part A, and its tests: "the dialog for
 *        each recorded action with an active link; never without a link; Cancel writes nothing;
 *        confirm writes once"; SCL-238] | @implemented [2026-10-21]
 *
 * plain English: the REAL `/calendar` page (query layer, App shell, CalendarView, the sheets and
 * the shared Modal) over a scripted network. Each case presses the real control and reads the
 * request log, so "no write" means no request left the page and "writes once" means exactly one
 * did. The week is the real read model's (`studentCalendarWeek`); the links answer is the
 * route's own schema (`studentGuardianLinksViewSchema`) with `guardian_notified` as the server
 * sets it. Which actions ask is the shared predicate's call (`willNotifyGuardian`); the parity
 * test (`tests/ci/guardian-notify.parity.pg.ci.test.ts`) holds that predicate to the SQL.
 *
 * PRESENCE BEFORE ABSENCE: a "no dialog" case first proves the write it guards was sent.
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
  dayEditResponseSchema,
  profileUpsertResponseSchema,
  versionResponseSchema,
} from "@lyceon/shared/calendar";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { AppShell } from "@/components/layout/app-shell";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { getQueryFn } from "@/lib/queryClient";
import { studentCalendarWeek } from "@/features/calendar/calendar-week.fixture";
import {
  GUARDIAN_CONFIRM_ACTION,
  GUARDIAN_CONFIRM_BODY,
  GUARDIAN_CONFIRM_CANCEL,
  GUARDIAN_CONFIRM_TITLE,
} from "@/features/calendar/copy/guardian-notice";
import { studentGuardianLinksViewSchema } from "../../../packages/shared/src/student-resources";
import { resolveFeatureAccess } from "../../../server/lib/feature-access";

const net = vi.hoisted(() => ({
  log: [] as string[],
  guardianNotified: true,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const STUDENT = "00000000-0000-4000-8000-000000000238";
/** Thursday 1 October 2026: the week shown is Monday 28 September to Sunday 4 October. */
const NOW = new Date("2026-10-01T15:00:00Z");
const TODAY = "2026-10-01";
/** Friday: one practice block, not started. */
const FRIDAY = "2026-10-02";
const PRACTICE_BLOCK = "7c9e6679-7425-40de-944b-000000000040";
/** Saturday's full-length block. */
const FULL_LENGTH_BLOCK = "7c9e6679-7425-40de-944b-000000000050";

/** The paid week, as `GET /api/calendar` serves it (the real read model). */
function week(): { profile: unknown; days: { local_date: string }[] } {
  return studentCalendarWeek(TODAY, { testDate: "2026-10-03" }) as {
    profile: unknown;
    days: { local_date: string }[];
  };
}

/**
 * Every write answered with its route's real success shape, so no write fails and is retried
 * (the calendar mutations retry once): a retry would count as a second write.
 */
function writeFor(method: string, url: string): Response | undefined {
  const day = /^\/api\/calendar\/days\/([^/]+)$/.exec(url);
  if (method === "PUT" && day !== null) {
    return json(
      dayEditResponseSchema.parse({
        version_no: 9,
        day: week().days.find((d) => d.local_date === day[1]),
      }),
    );
  }
  if (method === "PUT" && url === "/api/calendar/profile")
    return json(profileUpsertResponseSchema.parse({ profile: week().profile }));
  if (
    method === "POST" &&
    (/^\/api\/calendar\/blocks\/[^/]+\/move$/.test(url) ||
      url === "/api/calendar/plan/regenerate" ||
      /^\/api\/calendar\/days\/[^/]+\/regenerate$/.test(url))
  )
    return json(versionResponseSchema.parse({ version_no: 9 }));
  return undefined;
}

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    net.log.push(`${method} ${url}`);
    if (method === "GET" && url.startsWith("/api/calendar?"))
      return json(week());
    if (method === "GET" && url === `/api/students/${STUDENT}/links`) {
      return json({
        data: studentGuardianLinksViewSchema.parse({
          links: [
            {
              link_id: "l1",
              guardian_display_name: "Pat Parent",
              linked_at: "2026-09-01T00:00:00Z",
            },
          ],
          guardian_notified: net.guardianNotified,
        }),
      });
    }
    const write = writeFor(method, url);
    if (write !== undefined) return write;
    if (url.startsWith("/api/notifications"))
      return json({ data: { unread: 0 }, requestId: "r" });
    return json({ error: "Not found" }, 404);
  },
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: {
      id: "00000000-0000-4000-8000-000000000238",
      email: "sam@example.test",
      display_name: "Sam Rivera",
      role: "student",
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isAdmin: false,
    isGuardian: false,
    signOut: async () => undefined,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
}));
vi.mock("../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: async () => true,
    isEntitlementActiveForProfile: async () => true,
  },
}));

import CalendarPage from "./calendar";

async function mount(guardianNotified: boolean): Promise<void> {
  net.guardianNotified = guardianNotified;
  const map = await resolveFeatureAccess({
    id: STUDENT,
    role: "student",
    is_under_13: false,
  });
  const { hook } = memoryLocation({ path: "/calendar" });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "throw" }),
        retry: false,
        staleTime: Infinity,
      },
      mutations: { retry: false },
    },
  });
  client.setQueryData(PROFILE_QUERY_KEY, {
    authenticated: true,
    featureAccess: map,
    user: null,
  });
  render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <UpgradeModalProvider>
          <AppShell panel={340} content="full">
            <CalendarPage />
          </AppShell>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  await screen.findByTestId(`calendar-block-${PRACTICE_BLOCK}`);
  // The server's answer has landed before any press (the dialog states a known fact).
  await waitFor(() =>
    expect(net.log).toContain(`GET /api/students/${STUDENT}/links`),
  );
}

function writes(): string[] {
  const out = net.log.filter(
    (l) => !l.startsWith("GET ") && !l.startsWith("POST /api/notifications"),
  );
  return out;
}

function dialog(): HTMLElement | null {
  return screen.queryByTestId("guardian-notify-confirm");
}

function openBlock(blockId: string): HTMLElement {
  fireEvent.click(screen.getByTestId(`calendar-block-${blockId}`));
  return screen.getByTestId("calendar-block-sheet");
}

/** The recorded actions, each as the student performs it on the page, and the write it sends. */
const RECORDED: ReadonlyArray<{
  name: string;
  act: () => void;
  write: string;
}> = [
  {
    name: "blocking out (clearing) a day",
    act: () => {
      fireEvent.click(screen.getByTestId(`day-menu-${FRIDAY}`));
      fireEvent.click(screen.getByTestId(`day-block-${FRIDAY}`));
    },
    write: `PUT /api/calendar/days/${FRIDAY}`,
  },
  {
    name: "removing a block",
    act: () => {
      const sheet = openBlock(PRACTICE_BLOCK);
      fireEvent.click(within(sheet).getByRole("button", { name: "Remove" }));
    },
    write: `PUT /api/calendar/days/${FRIDAY}`,
  },
  {
    name: "moving a block",
    act: () => {
      const sheet = openBlock(PRACTICE_BLOCK);
      fireEvent.change(within(sheet).getByLabelText("Move to…"), {
        target: { value: "2026-10-04" },
      });
    },
    write: `POST /api/calendar/blocks/${PRACTICE_BLOCK}/move`,
  },
  {
    name: "moving a full-length test",
    act: () => {
      const sheet = openBlock(FULL_LENGTH_BLOCK);
      fireEvent.change(within(sheet).getByLabelText("Move to…"), {
        target: { value: "2026-10-04" },
      });
    },
    write: `POST /api/calendar/blocks/${FULL_LENGTH_BLOCK}/move`,
  },
  {
    name: "removing a full-length test",
    act: () => {
      const sheet = openBlock(FULL_LENGTH_BLOCK);
      fireEvent.click(within(sheet).getByRole("button", { name: "Remove" }));
    },
    write: "PUT /api/calendar/days/2026-10-03",
  },
  {
    name: "saving a change to minutes per day",
    act: () => {
      fireEvent.click(screen.getAllByTestId("topbar-edit-schedule")[0]!);
      fireEvent.click(
        within(screen.getByTestId("settings-minutes")).getByRole("button", {
          name: "1 hr",
        }),
      );
      fireEvent.click(screen.getByTestId("settings-save"));
    },
    write: "PUT /api/calendar/profile",
  },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  net.log.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("with a guardian who will be told (guardian_notified: true)", () => {
  it.each(RECORDED)(
    "$name asks first, with the brief's exact words, and writes nothing yet",
    async ({ act }) => {
      await mount(true);
      act();
      const d = await screen.findByTestId("guardian-notify-confirm");
      expect(within(d).getByText(GUARDIAN_CONFIRM_TITLE)).toBeInTheDocument();
      expect(within(d).getByText(GUARDIAN_CONFIRM_BODY)).toBeInTheDocument();
      expect(
        within(d).getByRole("button", { name: GUARDIAN_CONFIRM_ACTION }),
      ).toBeInTheDocument();
      expect(
        within(d).getByRole("button", { name: GUARDIAN_CONFIRM_CANCEL }),
      ).toBeInTheDocument();
      expect(writes()).toEqual([]);
    },
  );

  it.each(RECORDED)(
    "$name: Cancel writes nothing and closes",
    async ({ act }) => {
      await mount(true);
      act();
      const d = await screen.findByTestId("guardian-notify-confirm");
      fireEvent.click(
        within(d).getByRole("button", { name: GUARDIAN_CONFIRM_CANCEL }),
      );
      await waitFor(() => expect(dialog()).toBeNull());
      expect(writes()).toEqual([]);
    },
  );

  it.each(RECORDED)(
    "$name: Make change writes exactly once and closes",
    async ({ act, write }) => {
      await mount(true);
      act();
      const d = await screen.findByTestId("guardian-notify-confirm");
      const make = within(d).getByRole("button", {
        name: GUARDIAN_CONFIRM_ACTION,
      });
      fireEvent.click(make);
      await waitFor(() => expect(writes()).toEqual([write]));
      await waitFor(() => expect(dialog()).toBeNull());
    },
  );

  it("Esc is Cancel: nothing is written", async () => {
    await mount(true);
    RECORDED[0]!.act();
    const d = await screen.findByTestId("guardian-notify-confirm");
    fireEvent.keyDown(d, { key: "Escape" });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(writes()).toEqual([]);
  });

  it("actions the loop never records do not ask: Regenerate plan, Regenerate day, and a save that changes only the target score", async () => {
    await mount(true);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Regenerate plan" })[0]!,
    );
    await waitFor(() =>
      expect(writes()).toContain("POST /api/calendar/plan/regenerate"),
    );
    fireEvent.click(screen.getByTestId(`day-menu-${FRIDAY}`));
    fireEvent.click(screen.getByTestId(`day-regenerate-${FRIDAY}`));
    await waitFor(() =>
      expect(writes()).toContain(
        `POST /api/calendar/days/${FRIDAY}/regenerate`,
      ),
    );
    fireEvent.click(screen.getAllByTestId("topbar-edit-schedule")[0]!);
    fireEvent.change(screen.getByLabelText("Target score"), {
      target: { value: "1500" },
    });
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() =>
      expect(writes()).toContain("PUT /api/calendar/profile"),
    );
    expect(dialog()).toBeNull();
  });
});

describe("with no guardian who will be told (guardian_notified: false)", () => {
  it.each(RECORDED)(
    "$name writes at once, with no dialog",
    async ({ act, write }) => {
      await mount(false);
      act();
      await waitFor(() => expect(writes()).toEqual([write]));
      expect(dialog()).toBeNull();
    },
  );
});
