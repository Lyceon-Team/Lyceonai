// @vitest-environment jsdom
/**
 * UI-50: Home (`/dashboard`), paid and free, rendered in the real App shell.
 *
 * @spec [student-UI register UI-50; DESIGN.md §1 (one primary action), §3, §4 Home;
 *        evidence/wiring-table.md §3 Home (the endpoint behind each element); register §2 (free
 *        vs paid; mastery_level only; no raw accuracy; no bank counts; no confidence), OQ-21,
 *        OQ-22, OQ-23, OQ-29, OQ-36, OQ-39(c), §8 F-51; owner ruling (Karl, 2026-10-05) item 4,
 *        the "Start a full-length test" card] | @implemented [2026-10-03; card 2026-10-05]
 *
 * plain English: the page is mounted with the real query layer, the real App shell (its right
 * panel is where the panel sections portal), the real upgrade modal and a scripted network
 * standing in for `csrfFetch` (the one transport every read here uses). Every request is logged,
 * so "this element reads that endpoint" is asserted from the log AND from the text the payload
 * put on screen.
 *
 * FIXTURES FROM REAL PRODUCERS. The feature-access map is `resolveFeatureAccess`'s output (the
 * function GET /api/profile calls), with only the entitlement answer stubbed. The calendar week is
 * `studentCalendarWeek`, built by the real read model (`buildCalendarRange`) and parsed by the
 * calendar schema. The quota is `toPracticeQuota`'s output, the route's own serializer. Session
 * criteria come from the shared `toSessionCriteria`. The launch's `next` is the review adapter's
 * own `resumeHref`. Every other body is parsed by its shared schema before it is served, so a
 * shape no route emits cannot be built here.
 *
 * PRESENCE BEFORE ABSENCE. Each "never shows" assertion runs after the payload is proven to
 * carry the thing (a confidence band, a bank-sized count, raw filters) and the page is proven
 * to have rendered the data around it.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
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
import type { FeatureAccessMap } from "@lyceon/shared/feature-access";
import { masteryDomainsResponseSchema } from "@lyceon/shared/mastery-levels";
import { practiceOpenSessionsResponseSchema } from "@lyceon/shared/practice-response-schema";
import {
  reviewOpenSessionsResponseSchema,
  reviewPoolSummaryResponseSchema,
} from "@lyceon/shared/review-schema";
import { toSessionCriteria } from "@lyceon/shared/session-criteria";
import { sectionProjectionsResponseSchema } from "@lyceon/shared/student-resources";
import { examFormsResponseSchema } from "@lyceon/shared/exam-report-schema";
import {
  calendarSetupRequiredResponseSchema,
  launchResponseSchema,
} from "@lyceon/shared/calendar";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { UPGRADE_MODAL_COPY } from "@/components/billing/upgrade-modal";
import { AppShell } from "@/components/layout/app-shell";
import { studentCalendarWeek } from "@/features/calendar/calendar-week.fixture";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { getQueryFn } from "@/lib/queryClient";
import type { EstimateResponse } from "@/lib/projectionApi";
import { resolveFeatureAccess } from "../../../server/lib/feature-access";
import { toPracticeQuota } from "../../../server/lib/practice-quota";
import { reviewAdapter } from "../../../server/services/calendar/adapters/review";
import LyceonDashboard from "./lyceon-dashboard";
import fs from "node:fs";
import path from "node:path";
import {
  FULL_LENGTH_CARD_ACTION,
  FULL_LENGTH_CARD_LINE,
} from "@/components/home/FullLengthCard";

// ── The network ────────────────────────────────────────────────────────────────────────────

const net = vi.hoisted(() => ({
  log: [] as string[],
  handlers: [] as Array<
    (url: string, init: RequestInit | undefined) => Response | undefined
  >,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    net.log.push(`${init?.method ?? "GET"} ${url}`);
    for (const handler of net.handlers) {
      const answer = handler(url, init);
      if (answer !== undefined) return answer;
    }
    if (url.startsWith("/api/notifications")) {
      return json({ data: { unread: 0 }, requestId: "r" });
    }
    return json({ error: "Not found" }, 404);
  },
}));

const auth = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    display_name: string;
    role: "student";
  },
}));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: auth.user,
    isLoading: false,
    authLoading: false,
    isAuthenticated: auth.user !== null,
    isAdmin: false,
    isGuardian: false,
    signOut: async () => undefined,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
}));

// The server modules the producers import reach for a database; none is used here.
vi.mock("../../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: () => {
      throw new Error("no database in this test");
    },
    from: () => {
      throw new Error("no database in this test");
    },
  },
}));
const entitlement = vi.hoisted(() => ({ paid: false }));
vi.mock("../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: async () => entitlement.paid,
    isEntitlementActiveForProfile: async () => entitlement.paid,
  },
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────

const STUDENT = "00000000-0000-4000-8000-000000000001";
/** A Thursday: the calendar fixture's today has one block done and one still to do. */
const TODAY = "2026-10-01";
const MONDAY = "2026-09-28";
const SUNDAY = "2026-10-04";

async function accessMap(paid: boolean): Promise<FeatureAccessMap> {
  entitlement.paid = paid;
  const map = await resolveFeatureAccess({
    id: STUDENT,
    role: "student",
    is_under_13: false,
  });
  if (map === null) throw new Error("a student always gets a map");
  return map;
}

/** GET /api/progress/projection, `computed` arm, carrying a band and a different range. */
const PROJECTION_ROUTE: EstimateResponse = {
  estimateStatus: "computed",
  estimate: {
    composite: 1180,
    math: 600,
    rw: 580,
    range: { low: 1130, high: 1230 },
    confidenceBand: "Medium",
  },
  baseline: {
    composite: 1050,
    math: 530,
    rw: 520,
    range: { low: 990, high: 1110 },
    confidenceBand: "Low",
    capturedAt: "2026-09-20T12:00:00.000Z",
  },
  totalQuestionsAttempted: 214,
  lastUpdated: "2026-10-01T12:00:00.000Z",
  entitlement: {
    hasPaidAccess: true,
    plan: "paid",
    status: "active",
    reason: "active",
    currentPeriodEnd: null,
  },
};

function estimateStatusBody(
  status: EstimateResponse["estimateStatus"],
): EstimateResponse {
  if (status === "computed") return PROJECTION_ROUTE;
  const base = {
    totalQuestionsAttempted: 0,
    lastUpdated: PROJECTION_ROUTE.lastUpdated,
    entitlement: PROJECTION_ROUTE.entitlement,
  };
  if (status === "baseline_only") {
    return {
      ...base,
      estimateStatus: "baseline_only",
      estimate: null,
      baseline: PROJECTION_ROUTE.baseline,
      cta: true,
    };
  }
  return { ...base, estimateStatus: status, estimate: null, baseline: null };
}

const SECTIONS = sectionProjectionsResponseSchema.parse({
  ok: true,
  sections: [
    {
      section: "M",
      projectedScoreMid: 600,
      projectedScoreLow: 560,
      projectedScoreHigh: 640,
      relevantQuestionCount: 120,
      computedAt: "2026-10-01T00:00:00Z",
    },
    {
      section: "RW",
      projectedScoreMid: 620,
      projectedScoreLow: 580,
      projectedScoreHigh: 660,
      relevantQuestionCount: 110,
      computedAt: "2026-10-01T00:00:00Z",
    },
  ],
  requestId: "r",
});

const MASTERY = masteryDomainsResponseSchema.parse({
  ok: true,
  domains: [
    {
      section: "M",
      domain: "Algebra",
      levelKey: "L1",
      level: 1,
      displayName: "Building",
    },
    {
      section: "M",
      domain: "Advanced Math",
      levelKey: "L2",
      level: 2,
      displayName: "Developing",
    },
    {
      section: "RW",
      domain: "Craft and Structure",
      levelKey: "L0",
      level: 0,
      displayName: "Foundations",
    },
  ],
});

const PRACTICE_ID = "11111111-1111-4111-8111-111111111111";
const DIAGNOSTIC_ID = "22222222-2222-4222-8222-222222222222";
const REVIEW_ID = "33333333-3333-4333-8333-333333333333";
const EXAM_SESSION_ID = "44444444-4444-4444-8444-444444444444";

function practiceOpen(withPractice: boolean, diagnosticAnswered: number) {
  return practiceOpenSessionsResponseSchema.parse({
    sessions: [
      ...(withPractice
        ? [
            {
              id: PRACTICE_ID,
              section: "M",
              mode: "custom",
              status: "active",
              created_at: "2026-09-30T14:00:00Z",
              target_question_count: 26,
              total_items: 26,
              answered_items: 7,
              criteria: toSessionCriteria({
                sections: ["M"],
                domains: ["Algebra"],
                difficulties: ["easy"],
              }),
            },
          ]
        : []),
      {
        id: DIAGNOSTIC_ID,
        section: null,
        mode: "diagnostic",
        status: "active",
        created_at: "2026-09-29T14:00:00Z",
        target_question_count: 40,
        total_items: 40,
        answered_items: diagnosticAnswered,
        criteria: toSessionCriteria(null),
      },
    ],
    maxConcurrentSessions: 3,
    requestId: "r",
  });
}

const REVIEW_OPEN = reviewOpenSessionsResponseSchema.parse({
  sessions: [
    {
      id: REVIEW_ID,
      section: null,
      mode: "queue",
      status: "active",
      created_at: "2026-09-30T15:00:00Z",
      target_question_count: 17,
      total_items: 17,
      answered_items: 0,
      criteria: toSessionCriteria(null),
    },
  ],
  maxConcurrentSessions: 3,
  requestId: "r",
});

/** One past session with open misses; its criteria (F-52 shape) name a domain Home does not print. */
const POOL = reviewPoolSummaryResponseSchema.parse({
  total: 5,
  timezone: "UTC",
  timezoneFallback: false,
  bySection: [],
  byDomain: [],
  bySkill: [],
  sessions: [
    {
      source_engine: "practice",
      source_session_id: PRACTICE_ID,
      created_at: "2026-09-30T14:40:00Z",
      local_date: "2026-09-30",
      local_time: "2:40 PM",
      mode: "custom",
      filters: {
        sections: [],
        domains: ["Raw Filter Domain"],
        skills: [],
        difficulties: [],
      },
      open_count: 4,
    },
    {
      source_engine: "review",
      source_session_id: REVIEW_ID,
      created_at: "2026-09-26T02:12:00Z",
      local_date: "2026-09-26",
      local_time: "2:12 AM",
      mode: "queue",
      filters: null,
      open_count: 1,
    },
  ],
  sessions_next_cursor: null,
});

/** One form with a test in progress; `question_count` is a bank-sized figure Home must not show. */
const FORMS = examFormsResponseSchema.parse({
  forms: [
    {
      test_form_id: "f0f00000-0000-4000-8000-000000000001",
      name: "Practice Test 1",
      is_selectable: true,
      question_count: 98,
      break_duration_ms: 600_000,
      sections: [],
      latest_session: {
        session_id: EXAM_SESSION_ID,
        state: "active",
        mode: "strict",
        attempt_number_for_form: 1,
        report_state: "not_completed",
      },
    },
  ],
});

function quota(remaining: number | "unlimited") {
  const result = toPracticeQuota(
    remaining === "unlimited"
      ? {
          allowed: true,
          code: "PRACTICE_BYPASS_ENTITLED",
          message: "",
          limitType: "practice",
          current: null,
          limit: null,
          remaining: null,
          resetAt: null,
          cooldownUntil: null,
          reservationId: null,
          duplicate: false,
        }
      : {
          allowed: true,
          code: "PRACTICE_QUOTA_OK",
          message: "",
          limitType: "practice",
          current: 40 - remaining,
          limit: 40,
          remaining,
          resetAt: "2026-10-02T05:00:00.000Z",
          cooldownUntil: null,
          reservationId: null,
          duplicate: false,
        },
  );
  if (!result.ok) throw new Error("quota fixture did not serialize");
  return result.value;
}

/** The review block today's plan should launch first (the fixture's Thursday, slot 1). */
const TODAY_REVIEW_BLOCK = "7c9e6679-7425-40de-944b-000000000031";
const LAUNCHED_SESSION = "55555555-5555-4555-8555-555555555555";

type Scenario = {
  calendar?: "ready" | "setup_required";
  estimateStatus?: EstimateResponse["estimateStatus"];
  projection?: "projected" | "none";
  diagnosticAnswered?: number;
  quota?: number | "unlimited";
};

function install(s: Scenario): void {
  const calendarBody =
    s.calendar === "setup_required"
      ? {
          ...calendarSetupRequiredResponseSchema.parse({
            status: "setup_required",
            defaults: {
              timezone: "UTC",
              daily_minutes_presets: [30, 45, 60],
              daily_minutes_min: 15,
              daily_minutes_max: 180,
              target_exam_date_max_days: 540,
              default_full_length_interval_weeks: 2,
              default_full_length_weekday: 6,
              final_exam_lead_days: 7,
            },
            entitled: true,
          }),
          requestId: "r",
        }
      : studentCalendarWeek(TODAY);
  net.handlers = [
    (url, init) => {
      const path = url.split("?")[0];
      const method = init?.method ?? "GET";
      if (method === "GET" && path === "/api/calendar")
        return json(calendarBody);
      if (path === `/api/students/${STUDENT}/mastery/domains`)
        return json(MASTERY);
      if (path === `/api/students/${STUDENT}/projections/sections`)
        return json(
          s.projection === "none"
            ? { ok: true, sections: [], requestId: "r" }
            : SECTIONS,
        );
      if (path === "/api/progress/projection")
        return json(estimateStatusBody(s.estimateStatus ?? "computed"));
      if (path === "/api/practice/sessions/open")
        return json(
          practiceOpen(s.calendar !== undefined, s.diagnosticAnswered ?? 12),
        );
      if (path === "/api/review/sessions/open") return json(REVIEW_OPEN);
      if (path === "/api/review/pool") return json(POOL);
      if (path === "/api/tests/forms") return json(FORMS);
      if (path === "/api/practice/quota") return json(quota(s.quota ?? 12));
      if (
        method === "POST" &&
        path === `/api/calendar/blocks/${TODAY_REVIEW_BLOCK}/launch`
      )
        return json(
          launchResponseSchema.parse({
            engine: "review",
            session_id: LAUNCHED_SESSION,
            next: reviewAdapter.resumeHref(LAUNCHED_SESSION),
            resumed: false,
          }),
        );
      if (path.startsWith(`/api/review/sessions/${LAUNCHED_SESSION}/state`))
        return json({});
      if (method === "POST" && path === "/api/practice/diagnostic/sessions")
        return json({ sessionId: DIAGNOSTIC_ID }, 201);
      return undefined;
    },
  ];
}

// ── Mount ──────────────────────────────────────────────────────────────────────────────────

async function mount(
  plan: "paid" | "free",
  scenario: Scenario,
): Promise<{ container: HTMLElement; history: string[] }> {
  install(scenario);
  const map = await accessMap(plan === "paid");
  const { hook, history } = memoryLocation({
    path: "/dashboard",
    record: true,
  });
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
  // GET /api/profile as the route sends it: the feature-access map at the top level.
  client.setQueryData(PROFILE_QUERY_KEY, {
    authenticated: true,
    featureAccess: map,
    user: null,
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <UpgradeModalProvider autoOpenOnDenial>
          <AppShell panel={360} footer>
            <LyceonDashboard />
          </AppShell>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  await screen.findByTestId("home");
  return { container, history };
}

function gets(): string[] {
  return net.log
    .filter((l) => l.startsWith("GET "))
    .map((l) => l.slice(4).split("?")[0] ?? "");
}

/** The buttons and links drawn as the screen's primary action (filled --primary-bg). */
function primaries(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.ownerDocument.querySelectorAll<HTMLElement>("a, button"),
  ).filter((el) => el.className.includes("bg-lyc-primary-bg"));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 15, 0, 0));
  net.log.length = 0;
  net.handlers = [];
  auth.user = {
    id: STUDENT,
    email: "sam@example.test",
    display_name: "Sam Rivera",
    role: "student",
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── Paid ───────────────────────────────────────────────────────────────────────────────────

describe("Home, paid (featureAccess grants calendar and mastery)", () => {
  it("renders the paid Home from the endpoints the wiring table names", async () => {
    const { container } = await mount("paid", { calendar: "ready" });
    const home = screen.getByTestId("home");
    expect(home.getAttribute("data-plan")).toBe("paid");

    // Greeting and date line: the profile's name, the calendar profile's test date.
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Good afternoon, Sam Rivera",
      }),
    ).toBeTruthy();
    expect(
      await screen.findByText(
        "Thursday, 1 October. 66 days until your SAT on Sunday, 6 December.",
      ),
    ).toBeTruthy();

    // Today's plan: GET /api/calendar for this week, today's blocks in plan order.
    const plan = await screen.findByTestId("home-plan");
    const rows = within(plan).getAllByTestId("home-plan-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Math15 questions in Problem Solving and Data AnalysisAbout 23 minDone",
      "Review10 questions from your review queueAbout 10 minStart",
    ]);
    expect(within(plan).getByText("About 33 min")).toBeTruthy();

    // Mastery: GET /api/students/:id/mastery/domains; all eight canonical domains, wide rows.
    const mastery = await screen.findByTestId("home-mastery");
    const masteryRows = within(mastery).getAllByTestId("mastery-row");
    expect(masteryRows).toHaveLength(8);
    expect(
      masteryRows.every((r) => r.getAttribute("data-variant") === "wide"),
    ).toBe(true);
    expect(within(mastery).getByText("Algebra").closest("a")?.textContent).toBe(
      "AlgebraBuilding",
    );
    expect(within(mastery).getAllByText("Not enough answers yet")).toHaveLength(
      5,
    );

    // Pick up: practice (named by criteria), review and the in-progress test; no diagnostic.
    const resume = await screen.findByTestId("home-resume");
    await waitFor(() =>
      expect(within(resume).getAllByTestId("home-resume-row")).toHaveLength(3),
    );
    const resumeText = within(resume)
      .getAllByTestId("home-resume-row")
      .map((r) => r.textContent);
    // The in-progress test's stored form name "Practice Test 1" (FORMS) is shown as
    // "Full-Length Test 1" (owner ruling 2026-10-05, `displayFormName`).
    expect(resumeText).toEqual([
      "Algebra7 of 26 answeredContinue",
      "Review session0 of 17 answeredContinue",
      "Full-Length Test 1Continue",
    ]);
    expect(FORMS.forms[0]?.name).toBe("Practice Test 1");
    expect(
      within(resume)
        .getAllByRole("link", { name: "Continue" })
        .map((a) => a.getAttribute("href")),
    ).toEqual([
      `/practice/session/${PRACTICE_ID}`,
      `/review/session/${REVIEW_ID}`,
      `/tests/${EXAM_SESSION_ID}`,
    ]);

    // Right panel: the projection from projections/sections, the target from the calendar.
    const panel = screen.getByTestId("app-shell-panel");
    await waitFor(() =>
      expect(
        within(panel).getByTestId("home-projection-range").textContent,
      ).toBe("1140–1300"),
    );
    expect(within(panel).getByText(/Your target is 1350\./)).toBeTruthy();
    const week = within(panel).getByTestId("home-week");
    expect(within(week).getAllByRole("listitem")).toHaveLength(7);
    expect(
      within(week)
        .getAllByRole("listitem")
        .find((li) => li.getAttribute("aria-current") === "date")?.textContent,
    ).toBe("Thu1");
    expect(within(week).getByText("1 of 6 days done.")).toBeTruthy();
    const recent = await within(panel).findAllByTestId("home-recent-row");
    expect(recent.map((r) => r.textContent)).toEqual([
      "PracticeYesterday, 2:40 PM4 to review",
      "ReviewSat, Sep 26, 2:12 AM1 to review",
    ]);

    // The slim legal footer is on (the shell's prop).
    expect(container.querySelector("footer[aria-label]")).not.toBeNull();

    // Each element's endpoint was read, and only these.
    const read = gets();
    for (const endpoint of [
      "/api/calendar",
      `/api/students/${STUDENT}/mastery/domains`,
      "/api/practice/sessions/open",
      "/api/review/sessions/open",
      "/api/tests/forms",
      "/api/review/pool",
      `/api/students/${STUDENT}/projections/sections`,
      "/api/progress/projection",
    ]) {
      expect(read, endpoint).toContain(endpoint);
    }
    expect(read).not.toContain("/api/practice/quota");
    expect(net.log.find((l) => l.startsWith("GET /api/calendar?"))).toContain(
      `from=${MONDAY}&to=${SUNDAY}`,
    );
  });

  it("has exactly one primary action, and it launches the day's first open block", async () => {
    const { container, history } = await mount("paid", { calendar: "ready" });
    const start = await screen.findByTestId("home-start-plan");
    await waitFor(() =>
      expect(screen.getByTestId("home-mastery")).toBeTruthy(),
    );
    expect(primaries(container)).toEqual([start]);

    await act(async () => {
      fireEvent.click(start);
    });
    await waitFor(() =>
      expect(history[history.length - 1]).toBe(
        `/review/session/${LAUNCHED_SESSION}`,
      ),
    );
    expect(net.log).toContain(
      `POST /api/calendar/blocks/${TODAY_REVIEW_BLOCK}/launch`,
    );
  });

  it("before calendar setup, the primary is 'Set up your study calendar' and there is no plan", async () => {
    const { container } = await mount("paid", { calendar: "setup_required" });
    const setup = await screen.findByTestId("home-plan-setup");
    expect(setup.getAttribute("href")).toBe("/calendar");
    await waitFor(() =>
      expect(screen.getByTestId("home-mastery")).toBeTruthy(),
    );
    expect(primaries(container)).toEqual([setup]);
    expect(screen.queryByTestId("home-start-plan")).toBeNull();
    expect(screen.queryByTestId("home-week")).toBeNull();
    expect(screen.getByText("Thursday, 1 October.")).toBeTruthy();
  });
});

// ── Free ───────────────────────────────────────────────────────────────────────────────────

describe("Home, free (featureAccess locks calendar and mastery)", () => {
  it("renders the free Home and calls no paid route", async () => {
    const { container } = await mount("free", {
      estimateStatus: "no_baseline",
      projection: "none",
    });
    expect(screen.getByTestId("home").getAttribute("data-plan")).toBe("free");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Welcome to Lyceon, Sam Rivera",
      }),
    ).toBeTruthy();

    // The diagnostic card: the open diagnostic's own count, ruler filled to match.
    const card = await screen.findByTestId("home-diagnostic");
    await waitFor(() =>
      expect(within(card).getByText("12 of 40 answered")).toBeTruthy(),
    );
    expect(
      within(card)
        .getByTestId("home-diagnostic-ruler")
        .getAttribute("data-filled"),
    ).toBe("12");

    // How Lyceon works: three steps, tagged.
    const how = screen.getByTestId("home-how");
    expect(within(how).getAllByRole("listitem")).toHaveLength(3);
    expect(within(how).getAllByText("Free")).toHaveLength(2);
    expect(within(how).getByText("Paid plans")).toBeTruthy();

    // Panel: the pre-diagnostic projection sentence, the locked card, today's quota.
    const panel = screen.getByTestId("app-shell-panel");
    expect(
      within(panel).getByText(
        "Your projected score appears here when you finish the diagnostic.",
      ),
    ).toBeTruthy();
    expect(within(panel).getByTestId("locked-mastery-card")).toBeTruthy();
    await within(panel).findByTestId("home-quota");

    // One primary: Start diagnostic.
    expect(primaries(container)).toEqual([
      screen.getByTestId("home-start-diagnostic"),
    ]);

    // No paid route was asked: no calendar, mastery, exam forms.
    const read = gets();
    expect(read).toContain("/api/practice/quota");
    expect(read).toContain("/api/practice/sessions/open");
    expect(read).toContain(`/api/students/${STUDENT}/projections/sections`);
    expect(read).toContain("/api/progress/projection");
    expect(
      read.filter((p) => /^\/api\/(calendar|tests|tutor)|\/mastery\//.test(p)),
    ).toEqual([]);
  });

  it("the quota ruler reflects GET /api/practice/quota, and an unlimited quota hides it", async () => {
    await mount("free", { estimateStatus: "no_baseline", quota: 12 });
    const q = await screen.findByTestId("home-quota");
    expect(
      within(q).getByText("12 of 40 practice questions left"),
    ).toBeTruthy();
    expect(within(q).getByText("Review is unlimited")).toBeTruthy();
    expect(
      within(q).getByTestId("home-quota-ruler").getAttribute("data-filled"),
    ).toBe("12");
    cleanup();

    net.log.length = 0;
    await mount("free", { estimateStatus: "no_baseline", quota: "unlimited" });
    await waitFor(() => expect(gets()).toContain("/api/practice/quota"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByTestId("home-quota")).toBeNull();
  });

  it("See what's included opens the upgrade modal for mastery_detail, with no request", async () => {
    await mount("free", { estimateStatus: "no_baseline" });
    const before = net.log.length;
    fireEvent.click(screen.getByTestId("locked-mastery-see-included"));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(UPGRADE_MODAL_COPY.mastery_detail.plan.title),
    ).toBeTruthy();
    expect(net.log.slice(before).filter((l) => /mastery/.test(l))).toEqual([]);
  });

  it("Start diagnostic starts (or resumes) the diagnostic and opens its session", async () => {
    const { history } = await mount("free", { estimateStatus: "no_baseline" });
    const startButton = await screen.findByTestId("home-start-diagnostic");
    await act(async () => {
      fireEvent.click(startButton);
    });
    await waitFor(() =>
      expect(history[history.length - 1]).toBe(
        `/practice/session/${DIAGNOSTIC_ID}`,
      ),
    );
    expect(net.log).toContain("POST /api/practice/diagnostic/sessions");
  });

  it("a finished diagnostic (baseline_pending) offers no diagnostic, and Go to practice is the primary", async () => {
    const { container } = await mount("free", {
      estimateStatus: "baseline_pending",
      projection: "none",
    });
    await waitFor(() =>
      expect(
        screen.getByText("Your baseline is being calculated."),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId("home-diagnostic")).toBeNull();
    expect(screen.queryByText("Start diagnostic")).toBeNull();
    expect(primaries(container)).toEqual([
      screen.getByTestId("home-go-practice"),
    ]);
  });

  it("after the diagnostic (OQ-39(c)): the projection range and Go to practice as the primary", async () => {
    const { container } = await mount("free", {
      estimateStatus: "baseline_only",
    });
    const range = await screen.findByTestId("home-projection-range");
    expect(range.textContent).toBe("1140–1300");
    expect(screen.queryByTestId("home-diagnostic")).toBeNull();
    expect(primaries(container)).toEqual([
      screen.getByTestId("home-go-practice"),
    ]);
    expect(screen.getByTestId("home-go-practice").getAttribute("href")).toBe(
      "/practice",
    );
  });
});

// ── What Home never shows ─────────────────────────────────────────────────────────────────

describe("Home shows no raw accuracy, bank count or confidence (register §2; F-51)", () => {
  it("paid: no '%', no correct/total, no confidence, no bank count, no raw filters", async () => {
    await mount("paid", { calendar: "ready" });
    await screen.findAllByTestId("home-recent-row");
    await waitFor(() =>
      expect(screen.getAllByTestId("home-resume-row")).toHaveLength(3),
    );
    await screen.findByTestId("home-projection-range");

    // Presence: the payloads carry what must not be shown.
    expect(PROJECTION_ROUTE.estimate?.confidenceBand).toBe("Medium");
    expect(FORMS.forms[0]?.question_count).toBe(98);
    expect(JSON.stringify(POOL.sessions[0]?.filters)).toContain(
      "Raw Filter Domain",
    );

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("%");
    expect(text).not.toMatch(/\bcorrect\b/i);
    expect(text).not.toMatch(/accuracy/i);
    expect(text).not.toMatch(/confidence/i);
    expect(text).not.toMatch(/\bMedium\b/);
    expect(text).not.toContain("98");
    expect(text).not.toContain("Raw Filter Domain");
    // The range is the sections' sum, not /api/progress/projection's estimate.
    expect(text).toContain("1140–1300");
    expect(text).not.toContain("1130");
    expect(text).not.toContain("1230");
  });

  it("free: no '%', no correct/total, no confidence", async () => {
    await mount("free", { estimateStatus: "computed" });
    await screen.findByTestId("home-projection-range");
    await screen.findByTestId("home-quota");
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("%");
    expect(text).not.toMatch(/\bcorrect\b/i);
    expect(text).not.toMatch(/confidence/i);
    expect(text).not.toContain("1130");
  });
});

// ── The full-length card (owner ruling, Karl, 2026-10-05, item 4) ─────────────────────────

describe("Home's 'Start a full-length test' card (owner ruling, Karl, 2026-10-05)", () => {
  /** The card is drawn at every size: nothing on it or above it (to <main>) hides it. */
  function expectShownAtEverySize(card: HTMLElement): void {
    const HIDE = /(^|\s)((sm|md|lg|xl|max-lg|max-md):)?hidden(\s|$)/;
    for (
      let el: HTMLElement | null = card;
      el !== null && el.tagName !== "MAIN";
      el = el.parentElement
    ) {
      expect([el.getAttribute("data-testid"), HIDE.test(el.className)]).toEqual(
        [el.getAttribute("data-testid"), false],
      );
    }
  }

  it("its words are the ruling's action and the Full-Length page's approved subtitle", () => {
    expect(FULL_LENGTH_CARD_ACTION).toBe("Start a full-length test");
    const prototype = fs.readFileSync(
      path.join(
        __dirname,
        "../../../docs/plans/student-ui/design/prototype/FullLength.dc.html",
      ),
      "utf8",
    );
    expect(prototype).toContain(FULL_LENGTH_CARD_LINE);
  });

  it("paid: after today's plan, shown at every size, an outline link to /tests that navigates", async () => {
    const { container, history } = await mount("paid", { calendar: "ready" });
    const card = await screen.findByTestId("home-full-length");
    expectShownAtEverySize(card);
    expect(within(card).getByRole("heading", { level: 2 }).textContent).toBe(
      "Full-Length",
    );
    expect(within(card).getByText(FULL_LENGTH_CARD_LINE)).toBeTruthy();
    // Placed straight after today's plan.
    expect(screen.getByTestId("home-plan").nextElementSibling).toBe(card);

    const start = within(card).getByTestId("home-full-length-start");
    expect(start.tagName).toBe("A");
    expect(start.getAttribute("href")).toBe("/tests");
    expect(start.textContent).toBe("Start a full-length test");
    expect(within(card).queryByTestId("home-full-length-lock")).toBeNull();
    // Not a second filled primary: Start today's plan stays the one.
    await waitFor(() =>
      expect(screen.getByTestId("home-mastery")).toBeTruthy(),
    );
    expect(primaries(container)).toEqual([
      screen.getByTestId("home-start-plan"),
    ]);

    fireEvent.click(start);
    expect(history[history.length - 1]).toBe("/tests");
  });

  it("free: last in the column, shown at every size, locked; a click opens the upgrade modal in place with no navigation and no gated request", async () => {
    const { container, history } = await mount("free", {
      estimateStatus: "no_baseline",
    });
    const card = await screen.findByTestId("home-full-length");
    expectShownAtEverySize(card);
    expect(screen.getByTestId("home-how").nextElementSibling).toBe(card);

    const start = within(card).getByTestId("home-full-length-start");
    expect(within(card).getByTestId("home-full-length-lock")).toBeTruthy();
    // A button: no href, so nothing can navigate.
    expect(start.tagName).toBe("BUTTON");
    expect(start.getAttribute("href")).toBeNull();
    expect(start.getAttribute("aria-label")).toBe(
      "Start a full-length test, included with a paid plan",
    );
    expect(primaries(container)).toEqual([
      screen.getByTestId("home-start-diagnostic"),
    ]);

    const before = net.log.length;
    fireEvent.click(start);
    const modal = await screen.findByTestId("upgrade-modal");
    expect(modal.textContent).toContain(
      UPGRADE_MODAL_COPY.exam_full_length.plan.title,
    );
    expect(history).toEqual(["/dashboard"]);
    expect(
      net.log.slice(before).filter((l) => /\/api\/(tests|exam)/.test(l)),
    ).toEqual([]);
    expect(gets().filter((p) => /^\/api\/(tests|exam)/.test(p))).toEqual([]);
  });
});
