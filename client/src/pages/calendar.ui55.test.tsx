// @vitest-environment jsdom
/**
 * UI-55: the student calendar (`/calendar`), paid and free, rendered in the real App shell.
 *
 * @spec [student-UI register UI-55; §2 Free versus paid (Step 2 ruling 3: the calendar page does
 *        its own upsell; SCL-130 setup before the gate; calendar denials stay 402 flat;
 *        SCL-185), OQ-25 (free reads `GET /api/calendar/profile`; plan grids stay premium),
 *        OQ-37 (no "Training for" until UI-S8 closes), UI-44 (the upgrade modal never auto-
 *        opens on a calendar 402); DESIGN.md §4 Calendar; prototype Calendar.dc.html;
 *        evidence/wiring-table.md §9; Doc 05F §15, §17.5, §7.8 idempotency; Doc 05F §17.1 and
 *        §17.5 as amended by SCL-211 (OQ-56: no streak line, no facts strip; the free form is
 *        read-only after the first save)]
 *       [owner ruling (Karl, 2026-10-05, OQ-63): "Phone notice: show it for every full-length
 *        start on a phone, including calendar-launched starts. One shared pre-start check, same
 *        \"Continue anyway\". Test it from a calendar block at 390px."]
 *       [Codex audit finding 2; owner ruling (Karl, 2026-10-05): "split it" — the student
 *        calendar's stylesheet is `calendar-student.css` alone; `calendar.css` is the guardian's]
 * @implemented [2026-10-03; SCL-211 2026-10-05; OQ-63 2026-10-05; split 2026-10-05]
 *
 * plain English: the page is mounted with the real query layer, the real App shell (the right
 * panel portals into it) and the real upgrade modal with auto-open ON, over a scripted network
 * standing in for `csrfFetch`. Every request is logged, so "this control calls that endpoint"
 * and "the free page reads no plan" are asserted from the log.
 *
 * FIXTURES FROM REAL PRODUCERS. The paid week is `studentCalendarWeek` (the real read model,
 * `buildCalendarRange`, through `calendarReadyResponseSchema`), its SAT date moved into the
 * week. The free student's saved profile is the calendar service harness's `PROFILE_ROW`
 * (the nine columns `readStudyProfile` names), served through `profileReadResponseSchema`.
 * The pre-setup answer's `defaults` are the harness's `CONFIG_ROWS`, mapped as the read
 * service's `setupDefaults` maps them, through `calendarResponseSchema`. The feature-access map
 * is `resolveFeatureAccess`'s output; the 402 is `sendPaymentRequired`'s own body. A profile
 * save is parsed by the route's own `makeStudyProfileUpsertSchema`.
 *
 * PRESENCE BEFORE ABSENCE: every "not there" check runs after the page has drawn what sits
 * beside it.
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  featureAccessMapSchema,
  type FeatureAccessMap,
} from "@lyceon/shared/feature-access";
import {
  calendarResponseSchema,
  launchResponseSchema,
  makeStudyProfileUpsertSchema,
  profileReadResponseSchema,
  profileUpsertResponseSchema,
  versionResponseSchema,
  type CalendarSetupDefaults,
  type StudyProfile,
} from "@lyceon/shared/calendar";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { UPGRADE_PLANS_DESTINATION } from "@/components/billing/upgrade-modal";
import { AppShell } from "@/components/layout/app-shell";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { getQueryFn } from "@/lib/queryClient";
import { studentCalendarWeek } from "@/features/calendar/calendar-week.fixture";
import { resolveFeatureAccess } from "../../../server/lib/feature-access";
import { sendPaymentRequired } from "../../../server/lib/http-errors";
import { fullLengthAdapter } from "../../../server/services/calendar/adapters/full-length";
import { practiceAdapter } from "../../../server/services/calendar/adapters/practice";
import {
  CONFIG_ROWS,
  PROFILE_ROW,
} from "../../../tests/ci/calendar.service-harness";

// ── The network ────────────────────────────────────────────────────────────────────────────

const net = vi.hoisted(() => ({
  log: [] as string[],
  bodies: [] as Array<{ method: string; url: string; body: unknown }>,
  handler: null as
    | null
    | ((url: string, init: RequestInit | undefined) => Response | undefined),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    net.log.push(`${method} ${url}`);
    if (typeof init?.body === "string") {
      net.bodies.push({ method, url, body: JSON.parse(init.body) as unknown });
    }
    const answer = net.handler?.(url, init);
    if (answer !== undefined) return answer;
    if (url.startsWith("/api/notifications")) {
      return json({ data: { unread: 0 }, requestId: "r" });
    }
    return json({ error: "Not found" }, 404);
  },
}));

const auth = vi.hoisted(() => ({
  user: {
    id: "00000000-0000-4000-8000-000000000055",
    email: "sam@example.test",
    display_name: "Sam Rivera",
    role: "student" as const,
  },
}));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: auth.user,
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
const entitlement = vi.hoisted(() => ({ paid: false }));
vi.mock("../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: async () => entitlement.paid,
    isEntitlementActiveForProfile: async () => entitlement.paid,
  },
}));

import CalendarPage from "./calendar";

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────

/** Thursday 1 October 2026: the week shown is Monday 28 September to Sunday 4 October. */
const NOW = new Date("2026-10-01T15:00:00Z");
const TODAY = "2026-10-01";
/** The SAT date, moved inside the week so the grid can star it. */
const TEST_DATE = "2026-10-03";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The fixture week's Saturday full-length block (day 5, slot 0), scheduled after today. */
const FULL_LENGTH_BLOCK = "7c9e6679-7425-40de-944b-000000000050";
/** The fixture week's Friday practice block (day 4, slot 0), scheduled after today. */
const PRACTICE_BLOCK = "7c9e6679-7425-40de-944b-000000000040";
const LAUNCHED_EXAM = "5e551011-0000-4000-8000-000000000055";
const LAUNCHED_PRACTICE = "5e551011-0000-4000-8000-000000000056";

/** The paid student's `GET /api/calendar`, from the real read model. */
function paidWeek(): unknown {
  return studentCalendarWeek(TODAY, { testDate: TEST_DATE });
}

/** The read service's `setupDefaults`, over the service harness's config rows. */
function harnessDefaults(): CalendarSetupDefaults {
  const config = new Map(CONFIG_ROWS.map((row) => [row.key, row.value]));
  return {
    timezone: "America/Chicago",
    daily_minutes_presets: config.get("daily_minutes_presets") as number[],
    daily_minutes_min: config.get("daily_minutes_min") as number,
    daily_minutes_max: config.get("daily_minutes_max") as number,
    target_exam_date_max_days: config.get(
      "target_exam_date_max_days",
    ) as number,
    default_full_length_interval_weeks: config.get(
      "default_full_length_interval_weeks",
    ) as number,
    default_full_length_weekday: config.get(
      "default_full_length_weekday",
    ) as number,
    final_exam_lead_days: config.get("final_exam_lead_days") as number,
  };
}

/** A free student's pre-setup answer: served before the gate, no plan in it (SCL-130). */
function freeSetupRequired(): unknown {
  return {
    ...calendarResponseSchema.parse({
      status: "setup_required",
      defaults: harnessDefaults(),
      entitled: false,
    }),
    requestId: "r",
  };
}

/** The harness's saved profile, as `GET /api/calendar/profile` serves it. */
function savedProfile(): StudyProfile {
  const parsed = profileReadResponseSchema.parse({ profile: PROFILE_ROW });
  if (parsed.profile === null) throw new Error("the harness row is a profile");
  return parsed.profile;
}

/** The calendar's real 402 body (`sendPaymentRequired`), as the route sends it. */
function calendarDenial(): Response {
  const served = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      served.status = code;
      return res;
    },
    json(body: unknown) {
      served.body = body;
      return res;
    },
  };
  sendPaymentRequired(res as never, "calendar_access", "req-ui55");
  return json(served.body, served.status);
}

type Scenario = {
  /** The plan read's answer; `null` answers the real calendar 402. */
  calendar?: (() => unknown) | null | Response;
  /** What `GET /api/calendar/profile` serves (mutable: a save changes it). */
  profile?: StudyProfile | null;
};

const state = { profile: null as StudyProfile | null };

function install(scenario: Scenario): void {
  state.profile = scenario.profile === undefined ? null : scenario.profile;
  let version = 4;
  net.handler = (url, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url.startsWith("/api/calendar?")) {
      if (scenario.calendar === null) return calendarDenial();
      if (scenario.calendar instanceof Response)
        return scenario.calendar.clone();
      return json((scenario.calendar ?? paidWeek)());
    }
    if (method === "GET" && url === "/api/calendar/profile") {
      return json({
        ...profileReadResponseSchema.parse({ profile: state.profile }),
        requestId: "r",
      });
    }
    if (method === "PUT" && url === "/api/calendar/profile") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const next: StudyProfile = {
        ...(state.profile ?? {
          ...savedProfile(),
          target_exam_date: null,
          target_score: null,
          full_length_weekday: null,
          full_length_interval_weeks: null,
        }),
        target_exam_date: body.target_exam_date as string | null,
        target_score: body.target_score as number | null,
      };
      state.profile = next;
      return json({
        ...profileUpsertResponseSchema.parse({ profile: next }),
        requestId: "r",
      });
    }
    // §15.1 launch, answered with the engine adapters' own `resumeHref` (create and resume
    // cannot disagree on where the student lands).
    if (
      method === "POST" &&
      url === `/api/calendar/blocks/${FULL_LENGTH_BLOCK}/launch`
    ) {
      return json({
        ...launchResponseSchema.parse({
          engine: "full_length",
          session_id: LAUNCHED_EXAM,
          next: fullLengthAdapter.resumeHref(LAUNCHED_EXAM),
          resumed: false,
        }),
        requestId: "r",
      });
    }
    if (
      method === "POST" &&
      url === `/api/calendar/blocks/${PRACTICE_BLOCK}/launch`
    ) {
      return json({
        ...launchResponseSchema.parse({
          engine: "practice",
          session_id: LAUNCHED_PRACTICE,
          next: practiceAdapter.resumeHref(LAUNCHED_PRACTICE),
          resumed: false,
        }),
        requestId: "r",
      });
    }
    if (method === "POST" && url === "/api/calendar/plan/regenerate") {
      version += 1;
      return json({
        ...versionResponseSchema.parse({ version_no: version }),
        requestId: "r",
      });
    }
    return undefined;
  };
}

async function accessMap(
  plan: "paid" | "free",
  ageLock = false,
): Promise<FeatureAccessMap> {
  entitlement.paid = plan === "paid";
  const map = await resolveFeatureAccess({
    id: auth.user.id,
    role: "student",
    is_under_13: false,
  });
  if (map === null) throw new Error("a student always gets a map");
  // The resolver gives `age` to LISA only today; the map's schema allows it for any feature,
  // so the page's age branch is driven by the one entry the schema permits.
  return ageLock
    ? featureAccessMapSchema.parse({
        ...map,
        calendar_access: { access: "locked", reason: "age" },
      })
    : map;
}

async function mount(
  plan: "paid" | "free",
  scenario: Scenario = {},
  options: { ageLock?: boolean; phone?: boolean } = {},
): Promise<{ history: string[] }> {
  install(scenario);
  if (options.phone === true) installPhone();
  const map = await accessMap(plan, options.ageLock ?? false);
  const { hook, history } = memoryLocation({ path: "/calendar", record: true });
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
        <UpgradeModalProvider autoOpenOnDenial>
          <AppShell panel={340} content="full">
            <CalendarPage />
          </AppShell>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  return { history };
}

/**
 * A phone width for the shared full-length pre-start check: the App shell's phone query
 * (Tailwind's `max-lg`, `PHONE_LAYOUT_QUERY`) matches; every other query answers as the test
 * setup's does. The grid's own phone layout is `mobile-390.test.tsx`'s subject, and the real
 * 390px page is the UI-55 capture's; this file asserts the start's behaviour.
 */
const SETUP_MATCH_MEDIA = window.matchMedia;
function installPhone(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "not all and (min-width: 1024px)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function launches(): string[] {
  return net.log.filter(
    (l) => l.startsWith("POST /api/calendar/blocks/") && l.endsWith("/launch"),
  );
}

/** Open a block's sheet from the week grid and press its Start. */
async function startBlock(blockId: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(`calendar-block-${blockId}`));
  const sheet = await screen.findByTestId("calendar-block-sheet");
  fireEvent.click(within(sheet).getByRole("button", { name: "Start" }));
}

function gets(): string[] {
  return net.log.filter((l) => l.startsWith("GET ")).map((l) => l.slice(4));
}

/**
 * Every GET whose path names a streak, under any prefix. SCL-211 / OQ-56: the student
 * calendar reads no streak. §15's standalone streak route is retired (SCL-212, OQ-61 (a))
 * and `scripts/ci/retired-endpoints-gate.mjs` refuses its path anywhere in the tree; this
 * catches the read the gate cannot — a streak route under a NEW path.
 */
function streakReads(): string[] {
  return gets().filter((url) => /streak/i.test(url));
}

function planReads(): string[] {
  return gets().filter((url) => url.startsWith("/api/calendar?"));
}

function sent(method: string, url: string): unknown[] {
  return net.bodies
    .filter((b) => b.method === method && b.url === url)
    .map((b) => b.body);
}

function title(): string {
  return screen.getByTestId("calendar-range-title").textContent ?? "";
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  net.log.length = 0;
  net.bodies.length = 0;
  net.handler = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: SETUP_MATCH_MEDIA,
  });
  window.sessionStorage.clear();
});

// ── Paid ────────────────────────────────────────────────────────────────────────────────────

describe("paid: the Canvas-style header (DESIGN.md §4)", () => {
  it("Week/Month, Today and the arrows on the left; the range centred as M/D – M/D; Edit schedule and Regenerate plan on the right", async () => {
    await mount("paid");
    await screen.findByTestId("calendar-week-grid");
    expect(title()).toBe("9/28 – 10/4");

    const nav = screen.getByTestId("calendar-header-nav");
    const view = within(nav).getByRole("group", { name: "View" });
    expect(
      within(view)
        .getByRole("button", { name: "Week" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(within(nav).getByRole("button", { name: "Today" })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "Previous" })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "Next" })).toBeTruthy();
    const header = screen.getByTestId("calendar-header");
    expect(
      within(header).getByRole("button", { name: "Edit schedule" }),
    ).toBeTruthy();
    expect(
      within(header).getByRole("button", { name: "Regenerate plan" }),
    ).toBeTruthy();

    // The arrows step a week and re-read that range; Today comes back.
    fireEvent.click(within(nav).getByRole("button", { name: "Next" }));
    expect(title()).toBe("10/5 – 10/11");
    await waitFor(() =>
      expect(planReads().some((u) => u.includes("from=2026-10-05"))).toBe(true),
    );
    fireEvent.click(within(nav).getByRole("button", { name: "Previous" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Previous" }));
    expect(title()).toBe("9/21 – 9/27");
    fireEvent.click(within(nav).getByRole("button", { name: "Today" }));
    expect(title()).toBe("9/28 – 10/4");

    // Month: the month grid replaces the week, and the title names the month.
    fireEvent.click(within(view).getByRole("button", { name: "Month" }));
    expect(
      within(view)
        .getByRole("button", { name: "Month" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(await screen.findByTestId("calendar-month-grid")).toBeTruthy();
    expect(screen.queryByTestId("calendar-week-grid")).toBeNull();
    // QA 2026-10-07 item 11(a): the week 28 September – 4 October holds today (1 October), so
    // Month opens October — today's month — and reads October's whole grid.
    expect(title()).toBe("October 2026");
    await waitFor(() => expect(monthRead()).toBe(true));
  });
});

/** October 2026's grid, as `rangeForView("month", …)` names it: Monday 28 Sep – Sunday 8 Nov. */
const MONTH_READ = "/api/calendar?from=2026-09-28&to=2026-11-08";

/** True once October's grid has been read (the query string goes on with `device_timezone`). */
function monthRead(): boolean {
  return planReads().some(
    (url) => url === MONTH_READ || url.startsWith(`${MONTH_READ}&`),
  );
}

/**
 * The month read's answer: the fixture week plus the NEXT week's days (its block ids remapped so
 * they cannot collide with this week's), so a month cell after 4 October has a block only when
 * the MONTH's rows are on screen — the week held over by `keepPreviousData` has none there.
 */
function paidMonth(): unknown {
  const week = paidWeek() as { days: unknown[] };
  const next = JSON.parse(
    JSON.stringify(
      studentCalendarWeek("2026-10-08", { testDate: TEST_DATE }),
    ).replaceAll("7c9e6679-7425-40de-944b-", "7c9e6679-7425-40de-944c-"),
  ) as { days: unknown[] };
  return { ...week, days: [...week.days, ...next.days] };
}

describe("paid: the month view's first render is the whole month (QA 2026-10-07 item 11(a))", () => {
  it("in week view the month the toggle opens is read ahead, so Month draws the month's rows at once", async () => {
    await mount("paid", {
      calendar: () => paidMonth(),
    });
    await screen.findByTestId("calendar-week-grid");
    // The week's own read first; then, once idle, the month the toggle would open.
    await waitFor(() => expect(monthRead()).toBe(true), {
      timeout: 3_000,
    });
    // Presence: the month payload has a block after this week (Wednesday 7 October).
    const reads = planReads().length;
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    // The FIRST render after the click, with no wait: next week's day already has its chips.
    const cell = screen.getByTestId("calendar-month-cell-2026-10-07");
    expect(cell.querySelectorAll(".mchip").length).toBeGreaterThan(0);
    expect(title()).toBe("October 2026");
    // Served from the read-ahead: the toggle sent no new plan read.
    expect(planReads().length).toBe(reads);
  });
});

describe("paid: Regenerate plan", () => {
  it("Regenerate plan posts to /api/calendar/plan/regenerate with one fresh idempotency key per press", async () => {
    await mount("paid");
    const button = await screen.findByRole("button", {
      name: "Regenerate plan",
    });
    fireEvent.click(button);
    await screen.findByRole("button", { name: "Plan regenerated" });
    fireEvent.click(screen.getByRole("button", { name: "Plan regenerated" }));
    await waitFor(() =>
      expect(sent("POST", "/api/calendar/plan/regenerate")).toHaveLength(2),
    );
    const [first, second] = sent("POST", "/api/calendar/plan/regenerate") as {
      idempotency_key: string;
    }[];
    expect(first?.idempotency_key).toMatch(UUID);
    expect(second?.idempotency_key).toMatch(UUID);
    expect(second?.idempotency_key).not.toBe(first?.idempotency_key);
    // And the plan is read again after it (the settle-invalidate).
    await waitFor(() => expect(planReads().length).toBeGreaterThanOrEqual(2));
  });
});

describe("paid: no streak line and no facts strip (SCL-211, OQ-56)", () => {
  it("the week draws; neither the streak line nor the facts strip does, and no streak is read", async () => {
    await mount("paid");
    // Presence first: the grid, the header and the payload's own streak and facts are real.
    const grid = await screen.findByTestId("calendar-week-grid");
    expect(grid.textContent?.length).toBeGreaterThan(0);
    expect(screen.getByTestId("calendar-header")).toBeTruthy();
    const week = paidWeek() as {
      streak: { current: number | null };
      facts: { blocks_total: number };
    };
    expect(week.streak.current).not.toBeNull();
    expect(week.facts.blocks_total).toBeGreaterThan(0);
    // Absence.
    expect(screen.queryByTestId("calendar-facts")).toBeNull();
    expect(document.querySelector('[data-item="streak"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/day streak/);
    expect(document.body.textContent).not.toMatch(/blocks complete/);
    expect(streakReads()).toEqual([]);
  });
});

describe("paid: the test day is starred (DESIGN.md §4)", () => {
  it("in the week, the month and the mini month — and on no other day", async () => {
    await mount("paid");
    await screen.findByTestId("calendar-week-grid");
    // Week: the star beside the date, and the "★ SAT test day" card.
    const column = screen.getByTestId(`calendar-day-${TEST_DATE}`);
    expect(
      within(column).getByRole("img", { name: "Test day" }).textContent,
    ).toBe("★");
    expect(
      within(column).getByTestId("calendar-test-day-card").textContent,
    ).toContain("SAT test day");
    expect(
      within(screen.getByTestId(`calendar-day-${TODAY}`)).queryByRole("img", {
        name: "Test day",
      }),
    ).toBeNull();
    // Mini month (in the shell's right panel).
    const panel = screen.getByTestId("app-shell-panel");
    const mini = within(panel).getByTestId(`calendar-mini-day-${TEST_DATE}`);
    expect(mini.getAttribute("data-test-day")).toBe("true");
    expect(mini.textContent).toBe("★3");
    expect(
      within(panel)
        .getByTestId(`calendar-mini-day-${TODAY}`)
        .getAttribute("data-test-day"),
    ).toBeNull();
    // Month.
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    const cell = await screen.findByTestId(`calendar-month-cell-${TEST_DATE}`);
    expect(within(cell).getByRole("img", { name: "Test day" })).toBeTruthy();
    expect(cell.textContent).toContain("SAT test day");
    expect(
      within(screen.getByTestId(`calendar-month-cell-${TODAY}`)).queryByRole(
        "img",
        { name: "Test day" },
      ),
    ).toBeNull();
  });
});

describe("paid: the goal card (DESIGN.md §4, OQ-37)", () => {
  it("days until the SAT, the ★ date pill, Target and Projected side by side, Edit goals", async () => {
    await mount("paid");
    const card = await screen.findByTestId("calendar-goal-card");
    expect(within(card).getByTestId("calendar-countdown").textContent).toBe(
      "2",
    );
    expect(card.textContent).toContain("days until your SAT");
    expect(
      within(card).getByTestId("calendar-test-date-pill").textContent,
    ).toBe("★ Saturday, October 3");
    expect(within(card).getByTestId("calendar-target").textContent).toBe(
      "1350",
    );
    // Doc 05C's two rows, summed by `projectedRange` (590 + 590, 650 + 630).
    expect(within(card).getByTestId("calendar-projection").textContent).toBe(
      "1180–1280",
    );
    expect(
      within(card)
        .getByRole("link", { name: "Edit goals" })
        .getAttribute("href"),
    ).toBe("/profile");
  });

  it("keeps the projected range on one line, sized to fit its half of the card (QA 2026-10-07 item 11(g))", async () => {
    await mount("paid");
    const card = await screen.findByTestId("calendar-goal-card");
    const figure = within(card).getByTestId("calendar-projection");
    // Presence: the range is drawn.
    expect(figure.textContent).toBe("1180–1280");
    // One line: no wrap at the en dash. The real layout is measured in the browser
    // (tests/e2e/student-calendar.spec.ts); here the two rules that hold it are pinned.
    expect(figure.className.split(" ")).toContain("whitespace-nowrap");
    expect(figure.className).toContain(
      "[font-size:min(32px,calc(100cqi/(var(--lyc-figure-chars)*0.56)))]",
    );
    expect(figure.style.getPropertyValue("--lyc-figure-chars")).toBe("9");
    expect(figure.parentElement?.className).toContain(
      "[container-type:inline-size]",
    );
  });

  it('says "1 day until your SAT", singular, the day before the test', async () => {
    await mount("paid", {
      calendar: () => studentCalendarWeek(TODAY, { testDate: "2026-10-02" }),
    });
    const card = await screen.findByTestId("calendar-goal-card");
    expect(within(card).getByTestId("calendar-countdown").textContent).toBe(
      "1",
    );
    expect(card.textContent).toContain("day until your SAT");
    expect(card.textContent).not.toContain("days until your SAT");
  });

  it('shows no "Training for" while the dream school is held (OQ-37) and reads no background', async () => {
    await mount("paid");
    const card = await screen.findByTestId("calendar-goal-card");
    // Presence: the card drew its figures.
    expect(within(card).getByTestId("calendar-target")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Training for");
    expect(gets().some((u) => u.startsWith("/api/profile/background"))).toBe(
      false,
    );
  });
});

describe("paid: the header and card layout rules (QA 2026-10-07 items 11(c), 11(d))", () => {
  /**
   * The layout itself is measured in a real browser at 390–1440 (`tests/e2e/student-calendar.spec.ts`,
   * "QA 2026-10-07 item 11 layout": nothing past a card's edge, the header's groups never broken,
   * one/two/three header rows by the column's width). jsdom lays nothing out, so this pins the
   * wiring the browser test depends on: the header and the body carry the classes the rules
   * select, and the rules that hold the layout are in the stylesheet the page loads.
   */
  function studentCss(): string {
    return fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../features/calendar/calendar-student.css",
      ),
      "utf8",
    );
  }

  /** The declarations of the FIRST rule with exactly this selector. */
  function rule(css: string, selector: string): string {
    const at = css.indexOf(`${selector} {`);
    expect(at).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  }

  it("(d) the header is laid out against the calendar column, not the viewport", async () => {
    await mount("paid");
    const header = await screen.findByTestId("calendar-header");
    expect(header.classList.contains("lyc-cal-head")).toBe(true);
    // No viewport breakpoint decides the header's columns any more.
    expect(header.className).not.toMatch(/\blg:/);
    expect(
      screen
        .getByTestId("calendar-header-nav")
        .classList.contains("lyc-cal-head__group"),
    ).toBe(true);
    expect(
      screen
        .getByTestId("calendar-student-body")
        .classList.contains("lyc-cal-body"),
    ).toBe(true);
    const css = studentCss();
    expect(rule(css, ".lyc-cal-body")).toContain(
      "container-type: inline-size;",
    );
    expect(css).toContain("@container lyc-cal-body (min-width: 700px) {");
    expect(css).toContain("@container lyc-cal-body (min-width: 920px) {");
  });

  it("(c) a card's text breaks rather than overflow, and the started tag is cut", () => {
    const css = studentCss();
    // The QA block's `.block` rule (the first is the base card's).
    const block = css.slice(css.indexOf("QA 2026-10-07 item 11(c)"));
    expect(rule(block, ".lyceon-calendar.lyc-cal .block")).toContain(
      "overflow-wrap: anywhere;",
    );
    expect(rule(block, ".lyceon-calendar.lyc-cal .block .ttl")).toContain(
      "flex-wrap: wrap;",
    );
    const lock = rule(block, ".lyceon-calendar.lyc-cal .block .lock");
    expect(lock).toContain("text-overflow: ellipsis;");
    expect(lock).toContain("max-width: 100%;");
    expect(rule(block, ".lyceon-calendar.lyc-cal .block .dom span")).toContain(
      "max-width: 100%;",
    );
  });
});

describe('paid: no "+ Add block" on the test day (QA 2026-10-07 item 11(f))', () => {
  it("the other days still to come offer it; the test day does not", async () => {
    await mount("paid");
    await screen.findByTestId("calendar-week-grid");
    const add = (date: string): HTMLElement | null =>
      within(screen.getByTestId(`calendar-day-${date}`)).queryByRole("button", {
        name: "+ Add block",
      });
    // Presence: today and the day before the test (both to come) offer it.
    expect(add(TODAY)).toBeTruthy();
    expect(add("2026-10-02")).toBeTruthy();
    // The test day (starred, so the grid knows it) does not.
    expect(
      within(screen.getByTestId(`calendar-day-${TEST_DATE}`)).getByTestId(
        "calendar-test-day-card",
      ),
    ).toBeTruthy();
    expect(add(TEST_DATE)).toBeNull();
    // And the day after the test, still to come, offers it again.
    expect(add("2026-10-04")).toBeTruthy();
  });
});

describe('paid: the right panel has no "Your schedule" (QA 2026-10-07 item 11(e))', () => {
  it("mini month, goal card and Show, in that order; no schedule summary", async () => {
    await mount("paid");
    await screen.findByTestId("calendar-week-grid");
    const panel = within(screen.getByTestId("app-shell-panel")).getByTestId(
      "calendar-panel",
    );
    // Presence: the panel's three sections drew, and the schedule exists to summarise
    // (Edit schedule is in the header).
    expect(
      Array.from(panel.children).map((el) => el.getAttribute("data-testid")),
    ).toEqual([
      "calendar-mini-month",
      "calendar-goal-card",
      "calendar-show-filters",
    ]);
    expect(screen.getByRole("button", { name: "Edit schedule" })).toBeTruthy();
    // Absence.
    expect(panel.textContent).not.toContain("Your schedule");
    expect(screen.queryByTestId("calendar-schedule-card")).toBeNull();
  });
});

describe("paid: the Show filters (DESIGN.md §4)", () => {
  it("hide and show a category's blocks", async () => {
    await mount("paid");
    const grid = await screen.findByTestId("calendar-week-grid");
    const count = (tone: string): number =>
      grid.querySelectorAll(`.block.${tone}`).length;
    // Presence: the week has Math and Reading & Writing blocks.
    expect(count("math")).toBeGreaterThan(0);
    const rwBefore = count("rw");
    expect(rwBefore).toBeGreaterThan(0);
    const filters = screen.getByTestId("calendar-show-filters");
    const math = within(filters).getByRole("checkbox", { name: "Math" });
    expect((math as HTMLInputElement).checked).toBe(true);
    fireEvent.click(math);
    expect(count("math")).toBe(0);
    expect(count("rw")).toBe(rwBefore);
    fireEvent.click(math);
    expect(count("math")).toBeGreaterThan(0);
    // All four categories are listed, with the canonical section name.
    expect(
      within(filters)
        .getAllByRole("checkbox")
        .map((c) => c.closest("label")?.textContent),
    ).toEqual(["Math", "Reading & Writing", "Review", "Full-length test"]);
    // OQ-62 (b) (Karl, 2026-10-05): a sitting is a "full-length test" everywhere the student
    // sees the calendar; "practice test" is gone from the whole page.
    expect(document.body.textContent).not.toMatch(/\bpractice tests?\b/i);
  });
});

describe("paid: only the calendar's own denial is an upsell (SCL-185: the code, not the status)", () => {
  it("another 402 (the practice quota's) is an error with a retry, not the free page", async () => {
    await mount("paid", {
      calendar: json(
        {
          error: "Daily limit reached",
          code: "PRACTICE_FREE_DAILY_QUOTA_EXCEEDED",
          message: "Daily limit reached",
        },
        402,
      ),
      profile: savedProfile(),
    });
    const error = await screen.findByTestId("calendar-error", undefined, {
      timeout: 4_000,
    });
    expect(
      within(error).getByRole("button", { name: "Try again" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("calendar-plan-upsell")).toBeNull();
  });
});

describe("paid: a calendar 402 is the page's own upsell (UI-44, ruling 3)", () => {
  it("never auto-opens the upgrade modal; the free page renders from the ungated profile read", async () => {
    await mount("paid", { calendar: null, profile: savedProfile() });
    // `useCalendar` retries a failed read once (about a second) before the page sees it.
    await screen.findByTestId("calendar-plan-upsell", undefined, {
      timeout: 4_000,
    });
    expect(screen.getByTestId("calendar-free-setup")).toBeTruthy();
    // The denial reached the page (the plan read was made and refused) ...
    expect(planReads().length).toBeGreaterThan(0);
    expect(gets()).toContain("/api/calendar/profile");
    // ... and the modal stayed closed.
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });
});

// ── Free ────────────────────────────────────────────────────────────────────────────────────

describe("free: before setup (DESIGN.md §4, SCL-130)", () => {
  it("the inline setup form and the plan upsell card; no plan grid, no setup popup", async () => {
    await mount("free", { calendar: freeSetupRequired, profile: null });
    const form = await screen.findByTestId("calendar-free-setup");
    // Editable until the first save (OQ-56 (b)).
    expect(form.getAttribute("data-state")).toBe("editing");
    expect(within(form).getByLabelText("Test date")).toBeTruthy();
    expect(within(form).getByLabelText("Target score")).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Save" })).toBeTruthy();
    const upsell = screen.getByTestId("calendar-plan-upsell");
    expect(upsell.textContent).toContain("Your day-by-day plan");
    // The panel: the mini month and the Target-only goal card, absence copy and all.
    const panel = screen.getByTestId("app-shell-panel");
    expect(within(panel).getByTestId("calendar-mini-month")).toBeTruthy();
    const card = within(panel).getByTestId("calendar-goal-card");
    expect(within(card).getByTestId("calendar-target-absent")).toBeTruthy();
    expect(card.textContent).not.toContain("Projected");
    // Absence: no grid, no plan controls, no popup, no Show filters.
    expect(screen.queryByTestId("calendar-week-grid")).toBeNull();
    expect(screen.queryByTestId("calendar-header")).toBeNull();
    expect(screen.queryByTestId("calendar-setup-popup")).toBeNull();
    expect(screen.queryByTestId("calendar-show-filters")).toBeNull();
    // Reads: the ungated profile, and the pre-gate setup answer for its defaults (no plan).
    expect(gets()).toContain("/api/calendar/profile");
    expect(planReads()).toHaveLength(1);
    expect(streakReads()).toEqual([]);
  });

  it("Save sends PUT /api/calendar/profile with a key the route accepts, then shows the saved goal", async () => {
    await mount("free", { calendar: freeSetupRequired, profile: null });
    const form = await screen.findByTestId("calendar-free-setup");
    fireEvent.change(within(form).getByLabelText("Test date"), {
      target: { value: "2026-12-05" },
    });
    fireEvent.change(within(form).getByLabelText("Target score"), {
      target: { value: "1400" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(sent("PUT", "/api/calendar/profile")).toHaveLength(1),
    );
    const body = sent("PUT", "/api/calendar/profile")[0];
    // Presence first: a body with fields in it.
    expect(Object.keys(body as object).length).toBeGreaterThan(2);
    const defaults = harnessDefaults();
    const parsed = makeStudyProfileUpsertSchema({
      bounds: {
        daily_minutes_min: defaults.daily_minutes_min,
        daily_minutes_max: defaults.daily_minutes_max,
        daily_minutes_presets: defaults.daily_minutes_presets,
        target_exam_date_max_days: defaults.target_exam_date_max_days,
      },
      localToday: TODAY,
    }).safeParse(body);
    expect(
      parsed.success ? [] : Object.keys(parsed.error.flatten().fieldErrors),
    ).toEqual([]);
    if (!parsed.success) throw new Error("asserted above");
    expect(parsed.data.idempotency_key).toMatch(UUID);
    expect(parsed.data.target_exam_date).toBe("2026-12-05");
    expect(parsed.data.target_score).toBe(1400);
    // A first save carries the schedule the route requires on create (REQUIRED_ON_CREATE).
    expect(parsed.data.study_days_mask).toBeGreaterThan(0);
    expect(parsed.data.daily_minutes).toBe(60);
    expect(parsed.data.full_length_weekday).toBeNull();
    expect(parsed.data.full_length_interval_weeks).toBeNull();

    // The ungated read is asked again and the page shows what was saved.
    const card = screen.getByTestId("calendar-goal-card");
    await waitFor(() =>
      expect(within(card).getByTestId("calendar-target").textContent).toBe(
        "1400",
      ),
    );
    expect(
      within(card).getByTestId("calendar-test-date-pill").textContent,
    ).toBe("★ Saturday, December 5");
    // OQ-56 (b), SCL-211: the form is now read-only — the saved answers, "Edit goals in
    // Settings", and no input or Save left to press.
    const saved = screen.getByTestId("calendar-free-setup");
    expect(saved.getAttribute("data-state")).toBe("saved");
    expect(
      within(saved).getByTestId("calendar-free-saved-target").textContent,
    ).toBe("1400");
    expect(
      within(saved).getByTestId("calendar-free-saved-date").textContent,
    ).toBe("Saturday, December 5");
    expect(
      within(saved).getByRole("link", { name: "Edit goals in Settings" }),
    ).toBeTruthy();
    expect(within(saved).queryByLabelText("Target score")).toBeNull();
    expect(within(saved).queryByLabelText("Test date")).toBeNull();
    expect(within(saved).queryByRole("button", { name: "Save" })).toBeNull();
    expect(
      gets().filter((u) => u === "/api/calendar/profile").length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });
});

describe("free: with a profile saved (OQ-25)", () => {
  it("reads GET /api/calendar/profile and no plan; the card (read-only) and the goal card show the saved goal", async () => {
    await mount("free", { calendar: null, profile: savedProfile() });
    const form = await screen.findByTestId("calendar-free-setup");
    expect(form.getAttribute("data-state")).toBe("saved");
    expect(
      within(form).getByTestId("calendar-free-saved-date").textContent,
    ).toBe("Saturday, December 5");
    expect(
      within(form).getByTestId("calendar-free-saved-target").textContent,
    ).toBe(String(PROFILE_ROW.target_score));
    const card = screen.getByTestId("calendar-goal-card");
    expect(within(card).getByTestId("calendar-target").textContent).toBe(
      String(PROFILE_ROW.target_score),
    );
    expect(
      within(card).getByTestId("calendar-test-date-pill").textContent,
    ).toBe("★ Saturday, December 5");
    // Free: Target only.
    expect(within(card).queryByTestId("calendar-projection")).toBeNull();
    expect(within(card).queryByTestId("calendar-projection-absent")).toBeNull();
    // The test day is starred in the mini month from the profile alone.
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(
      screen
        .getByTestId("calendar-mini-day-2026-12-05")
        .getAttribute("data-test-day"),
    ).toBe("true");
    // No plan read at all, and no upgrade modal.
    expect(gets()).toContain("/api/calendar/profile");
    expect(planReads()).toEqual([]);
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });

  it("is read-only (OQ-56 (b), SCL-211): no input, no Save, and Edit goals in Settings goes where the goal card's Edit goals goes", async () => {
    const { history } = await mount("free", {
      calendar: null,
      profile: savedProfile(),
    });
    const form = await screen.findByTestId("calendar-free-setup");
    // Presence first: the saved answers are drawn.
    expect(
      within(form).getByTestId("calendar-free-saved-target").textContent,
    ).toBe(String(PROFILE_ROW.target_score));
    expect(within(form).queryByRole("textbox")).toBeNull();
    expect(within(form).queryByRole("spinbutton")).toBeNull();
    expect(form.querySelector("input")).toBeNull();
    expect(within(form).queryByRole("button")).toBeNull();
    const cardLink = within(screen.getByTestId("calendar-goal-card")).getByRole(
      "link",
      { name: "Edit goals" },
    );
    const link = within(form).getByRole("link", {
      name: "Edit goals in Settings",
    });
    expect(link.getAttribute("href")).toBe(cardLink.getAttribute("href"));
    fireEvent.click(link);
    expect(history.at(-1)).toBe("/profile");
    expect(sent("PUT", "/api/calendar/profile")).toEqual([]);
  });

  it("a saved profile with no date or target reads the shipped absence copy", async () => {
    await mount("free", {
      calendar: null,
      profile: {
        ...savedProfile(),
        target_exam_date: null,
        target_score: null,
      },
    });
    const form = await screen.findByTestId("calendar-free-setup");
    expect(form.getAttribute("data-state")).toBe("saved");
    expect(
      within(form).getByTestId("calendar-free-saved-date").textContent,
    ).toBe("Add your test date");
    expect(
      within(form).getByTestId("calendar-free-saved-target").textContent,
    ).toBe("Set a target");
  });
});

describe("free: the plan upsell card", () => {
  it("See plans goes where the upgrade modal's does (OQ-39(e))", async () => {
    const { history } = await mount("free", {
      calendar: null,
      profile: savedProfile(),
    });
    const upsell = await screen.findByTestId("calendar-plan-upsell");
    fireEvent.click(within(upsell).getByRole("button", { name: "See plans" }));
    expect(history.at(-1)).toBe(UPGRADE_PLANS_DESTINATION);
  });

  it("a lock with reason age gets no See plans, as the modal gives none", async () => {
    await mount(
      "free",
      { calendar: null, profile: savedProfile() },
      { ageLock: true },
    );
    const upsell = await screen.findByTestId("calendar-plan-upsell");
    expect(within(upsell).getByTestId("calendar-upsell-age")).toBeTruthy();
    expect(
      within(upsell).queryByRole("button", { name: "See plans" }),
    ).toBeNull();
  });
});

// ── QA 2026-10-07 item 11(b): the block sheet is a modal dialog ───────────────────────────

describe("paid: the block sheet is a modal dialog (QA 2026-10-07 item 11(b))", () => {
  /** Open a block's sheet from the week grid by pressing its card, as a keyboard user would. */
  async function openSheet(blockId: string): Promise<{
    card: HTMLElement;
    sheet: HTMLElement;
  }> {
    const card = await screen.findByTestId(`calendar-block-${blockId}`);
    card.focus();
    fireEvent.click(card);
    const sheet = await screen.findByTestId("calendar-block-sheet");
    return { card, sheet };
  }

  it("is a dialog named by its title, with focus moved into it on Close", async () => {
    await mount("paid");
    const { card, sheet } = await openSheet(PRACTICE_BLOCK);
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    const title = sheet.querySelector("h3");
    // Presence: the title is the block's.
    expect(title?.textContent).toBeTruthy();
    expect(card.getAttribute("aria-label")).toContain(title?.textContent);
    expect(sheet.getAttribute("aria-labelledby")).toBe(title?.id);
    expect(screen.getByRole("dialog", { name: title?.textContent ?? "" })).toBe(
      sheet,
    );
    const close = within(sheet).getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
  });

  it("Esc closes it and focus returns to the block that opened it", async () => {
    await mount("paid");
    const { card } = await openSheet(PRACTICE_BLOCK);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByTestId("calendar-block-sheet")).toBeNull();
    expect(document.activeElement).toBe(card);
  });

  it("Close closes it and focus returns to the block that opened it", async () => {
    await mount("paid");
    const { card, sheet } = await openSheet(PRACTICE_BLOCK);
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("calendar-block-sheet")).toBeNull();
    expect(document.activeElement).toBe(card);
  });

  it("Tab and Shift+Tab stay inside it", async () => {
    await mount("paid");
    const { sheet } = await openSheet(PRACTICE_BLOCK);
    const close = within(sheet).getByRole("button", { name: "Close" });
    const start = within(sheet).getByRole("button", { name: "Start" });
    const tabbable = Array.from(
      sheet.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]",
      ),
    );
    const last = tabbable[tabbable.length - 1];
    // Presence: more than one control, Close first.
    expect(tabbable.length).toBeGreaterThan(1);
    expect(tabbable[0]).toBe(close);
    expect(tabbable).toContain(start);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    last?.focus();
    fireEvent.keyDown(last ?? sheet, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("on a phone, Esc with the pre-start notice open closes the notice and leaves the sheet", async () => {
    await mount("paid", {}, { phone: true });
    await startBlock(FULL_LENGTH_BLOCK);
    const notice = await screen.findByTestId("full-length-phone-notice");
    fireEvent.keyDown(notice, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("full-length-phone-notice")).toBeNull(),
    );
    expect(screen.getByTestId("calendar-block-sheet")).toBeTruthy();
    expect(launches()).toEqual([]);
  });
});

// ── OQ-63: the shared full-length pre-start check from a calendar block ──────────────────

describe("phone: a full-length block's Start asks the shared pre-start check first (OQ-63)", () => {
  const PHONE_TEXT =
    "Full-length tests are built for a laptop or tablet, like test day.";

  it("the notice opens over the sheet and nothing is launched until Continue anyway; then it launches and lands on the sitting", async () => {
    const { history } = await mount("paid", {}, { phone: true });
    await startBlock(FULL_LENGTH_BLOCK);
    const notice = await screen.findByTestId("full-length-phone-notice");
    expect(within(notice).getByRole("heading").textContent).toBe(PHONE_TEXT);
    const button = within(notice).getByTestId("full-length-phone-continue");
    expect(button.textContent).toBe("Continue anyway");
    expect(button.className).toContain("border-lyc-ink-strong");
    // BEFORE the launch: no request, no navigation.
    expect(launches()).toEqual([]);
    expect(history.at(-1)).toBe("/calendar");

    fireEvent.click(button);
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${LAUNCHED_EXAM}`));
    expect(launches()).toEqual([
      `POST /api/calendar/blocks/${FULL_LENGTH_BLOCK}/launch`,
    ]);
  });

  it("cancel: closing the notice launches nothing and leaves the student on the calendar", async () => {
    const { history } = await mount("paid", {}, { phone: true });
    await startBlock(FULL_LENGTH_BLOCK);
    const notice = await screen.findByTestId("full-length-phone-notice");
    fireEvent.click(within(notice).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByTestId("full-length-phone-notice")).toBeNull(),
    );
    expect(launches()).toEqual([]);
    expect(history.at(-1)).toBe("/calendar");
  });

  it("Continue anyway is remembered for the tab: the next full-length start launches at once", async () => {
    await mount("paid", {}, { phone: true });
    await startBlock(FULL_LENGTH_BLOCK);
    fireEvent.click(await screen.findByTestId("full-length-phone-continue"));
    await waitFor(() => expect(launches()).toHaveLength(1));
    cleanup();
    net.log.length = 0;
    const { history } = await mount("paid", {}, { phone: true });
    await startBlock(FULL_LENGTH_BLOCK);
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${LAUNCHED_EXAM}`));
    expect(screen.queryByTestId("full-length-phone-notice")).toBeNull();
  });

  it("a practice block is unaffected on a phone: Start launches at once", async () => {
    const { history } = await mount("paid", {}, { phone: true });
    await startBlock(PRACTICE_BLOCK);
    await waitFor(() =>
      expect(history.at(-1)).toBe(
        practiceAdapter.resumeHref(LAUNCHED_PRACTICE),
      ),
    );
    expect(launches()).toEqual([
      `POST /api/calendar/blocks/${PRACTICE_BLOCK}/launch`,
    ]);
    expect(screen.queryByTestId("full-length-phone-notice")).toBeNull();
  });

  it("at 390 the block sheet (and its Start) sits above the phone tab bar, and below the notice", async () => {
    await mount("paid", {}, { phone: true });
    // The tab bar's layer, read off the rendered App shell (Tailwind `z-N`).
    const bar = await screen.findByTestId("app-tab-bar");
    const barZ = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(bar.className)?.[1];
    expect(barZ).toBe("40");
    // The student sheet's and scrim's layers (calendar-student.css; the shared calendar.css
    // puts them at 9 and 8, under the bar, which then took the tap on Start).
    const css = fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../features/calendar/calendar-student.css",
      ),
      "utf8",
    );
    const layer = (selector: string): number => {
      const at = css.indexOf(`${selector} {`);
      expect(at).toBeGreaterThan(-1);
      const rule = css.slice(at, css.indexOf("}", at));
      const z = /z-index:\s*(\d+);/.exec(rule)?.[1];
      return z === undefined ? Number.NaN : Number(z);
    };
    const sheet = layer(".lyceon-calendar.lyc-cal .sheet");
    const scrim = layer(".lyceon-calendar.lyc-cal .scrim");
    expect(sheet).toBeGreaterThan(Number(barZ));
    expect(scrim).toBeGreaterThan(Number(barZ));
    expect(sheet).toBeGreaterThan(scrim);
    // Below the student Modal (Radix Dialog, z-50), so the pre-start check opens over the sheet.
    expect(sheet).toBeLessThan(50);
  });

  it("desktop: a full-length block's Start launches at once, no notice", async () => {
    const { history } = await mount("paid");
    await startBlock(FULL_LENGTH_BLOCK);
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${LAUNCHED_EXAM}`));
    expect(launches()).toEqual([
      `POST /api/calendar/blocks/${FULL_LENGTH_BLOCK}/launch`,
    ]);
    expect(screen.queryByTestId("full-length-phone-notice")).toBeNull();
  });
});

/**
 * The split (Codex audit finding 2; owner ruling, Karl, 2026-10-05: "split it"). The student
 * calendar draws with `calendar-student.css` alone; the legacy `calendar.css` (literal palette,
 * labels under 14px) is the guardian calendar's. This walks the static import graph from each
 * page, through the `@/` alias and relative paths, and lists every stylesheet it reaches, so a
 * re-import anywhere in the student tree (the page, `CalendarView`, a component) fails here.
 * Presence before absence: the student graph must reach `calendar-student.css` and the shared
 * `CalendarView`, and the guardian page's graph must reach `calendar.css`, so an absence cannot
 * pass because the walker went blind.
 */
describe("UI-55 split: the student calendar's import graph never reaches calendar.css", () => {
  const CLIENT_SRC = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const LEGACY = path.join(CLIENT_SRC, "features/calendar/calendar.css");
  const STUDENT = path.join(
    CLIENT_SRC,
    "features/calendar/calendar-student.css",
  );
  const VIEW = path.join(CLIENT_SRC, "features/calendar/CalendarView.tsx");

  const stripComments = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

  const resolveSpecifier = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(CLIENT_SRC, spec.slice(2));
    else if (spec.startsWith("."))
      base = path.resolve(path.dirname(from), spec);
    else return null; // a package: outside the client tree
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
        return candidate;
    }
    return null;
  };

  /** Every file the entry reaches through static and dynamic imports. */
  const importGraph = (entry: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);
      if (!/\.tsx?$/.test(file)) continue;
      const src = stripComments(fs.readFileSync(file, "utf8"));
      const specifiers = [
        ...src.matchAll(/\bimport\s+(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']/g),
        ...src.matchAll(/\bexport\s+[^'"`;]*?\sfrom\s+["']([^"']+)["']/g),
        ...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
      ].map((m) => m[1] ?? "");
      for (const spec of specifiers) {
        const resolved = resolveSpecifier(file, spec);
        if (resolved !== null) queue.push(resolved);
      }
    }
    return seen;
  };

  it("the student page reaches calendar-student.css and CalendarView, and not calendar.css", () => {
    const graph = importGraph(path.join(CLIENT_SRC, "pages/calendar.tsx"));
    expect(graph.has(STUDENT)).toBe(true);
    expect(graph.has(VIEW)).toBe(true);
    const sheets = [...graph]
      .filter((file) => file.endsWith(".css"))
      .map((file) => path.relative(CLIENT_SRC, file))
      .sort();
    expect(sheets).toContain("features/calendar/calendar-student.css");
    expect(sheets).not.toContain("features/calendar/calendar.css");
    expect(graph.has(LEGACY)).toBe(false);
  });

  it("the guardian calendar still reaches calendar.css (the walker can see the import)", () => {
    const graph = importGraph(
      path.join(CLIENT_SRC, "pages/guardian-student-calendar.tsx"),
    );
    expect(graph.has(VIEW)).toBe(true);
    expect(graph.has(LEGACY)).toBe(true);
  });
});
