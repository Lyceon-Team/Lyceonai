// @vitest-environment jsdom
/**
 * UI-55: the student calendar (`/calendar`), paid and free, rendered in the real App shell.
 *
 * @spec [student-UI register UI-55; §2 Free versus paid (Step 2 ruling 3: the calendar page does
 *        its own upsell; SCL-130 setup before the gate; calendar denials stay 402 flat;
 *        SCL-185), OQ-25 (free reads `GET /api/calendar/profile`; plan grids stay premium),
 *        OQ-37 (no "Training for" until UI-S8 closes), UI-44 (the upgrade modal never auto-
 *        opens on a calendar 402); DESIGN.md §4 Calendar; prototype Calendar.dc.html;
 *        evidence/wiring-table.md §9; Doc 05F §15, §17.5, §7.8 idempotency]
 * @implemented [2026-10-03]
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
  makeStudyProfileUpsertSchema,
  profileReadResponseSchema,
  profileUpsertResponseSchema,
  streakSummarySchema,
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
    if (method === "POST" && url === "/api/calendar/plan/regenerate") {
      version += 1;
      return json({
        ...versionResponseSchema.parse({ version_no: version }),
        requestId: "r",
      });
    }
    if (method === "GET" && url === "/api/me/streak") {
      return json({
        ...streakSummarySchema.parse({
          current: 4,
          longest: 11,
          history_complete: false,
        }),
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
  options: { ageLock?: boolean } = {},
): Promise<{ history: string[] }> {
  install(scenario);
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

function gets(): string[] {
  return net.log.filter((l) => l.startsWith("GET ")).map((l) => l.slice(4));
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
    expect(title()).toBe("September 2026");
  });

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
    ).toBe("★ Saturday, 3 October");
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
    ).toEqual(["Math", "Reading & Writing", "Review", "Practice test"]);
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
    expect(gets()).not.toContain("/api/me/streak");
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
    ).toBe("★ Saturday, 5 December");
    expect(
      (screen.getByLabelText("Target score") as HTMLInputElement).value,
    ).toBe("1400");
    expect(
      gets().filter((u) => u === "/api/calendar/profile").length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });
});

describe("free: with a profile saved (OQ-25)", () => {
  it("reads GET /api/calendar/profile and no plan; the form and the goal card show the saved goal", async () => {
    await mount("free", { calendar: null, profile: savedProfile() });
    const form = await screen.findByTestId("calendar-free-setup");
    expect(
      (within(form).getByLabelText("Test date") as HTMLInputElement).value,
    ).toBe(PROFILE_ROW.target_exam_date);
    expect(
      (within(form).getByLabelText("Target score") as HTMLInputElement).value,
    ).toBe(String(PROFILE_ROW.target_score));
    const card = screen.getByTestId("calendar-goal-card");
    expect(within(card).getByTestId("calendar-target").textContent).toBe(
      String(PROFILE_ROW.target_score),
    );
    expect(
      within(card).getByTestId("calendar-test-date-pill").textContent,
    ).toBe("★ Saturday, 5 December");
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

  it("a second save sends the two answers alone", async () => {
    await mount("free", { calendar: null, profile: savedProfile() });
    const form = await screen.findByTestId("calendar-free-setup");
    fireEvent.change(within(form).getByLabelText("Target score"), {
      target: { value: "1450" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(sent("PUT", "/api/calendar/profile")).toHaveLength(1),
    );
    const body = sent("PUT", "/api/calendar/profile")[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(body).sort()).toEqual([
      "idempotency_key",
      "target_exam_date",
      "target_score",
    ]);
    expect(body.target_score).toBe(1450);
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
