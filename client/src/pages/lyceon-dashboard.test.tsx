// @vitest-environment jsdom
/**
 * UI-50: Home (`/dashboard`), paid and free, rendered in the real App shell.
 *
 * @spec [student-UI register UI-50; DESIGN.md §1 (one primary action), §3, §4 Home;
 *        evidence/wiring-table.md §3 Home (the endpoint behind each element); register §2 (free
 *        vs paid; mastery_level only; no raw accuracy; no bank counts; no confidence), OQ-21,
 *        OQ-22, OQ-23, OQ-29, OQ-36, OQ-39(c), §8 F-51; owner ruling (Karl, 2026-10-05) item 4,
 *        the "Start a full-length test" card; owner ruling (Karl, 2026-10-05, OQ-63): the phone
 *        notice for every full-length start, one shared pre-start check]
 *        | @implemented [2026-10-03; card 2026-10-05; OQ-63 2026-10-05]
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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
  calendarReadyResponseSchema,
  calendarSetupRequiredResponseSchema,
  launchResponseSchema,
} from "@lyceon/shared/calendar";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { UPGRADE_MODAL_COPY } from "@/components/billing/upgrade-modal";
import { AppShell } from "@/components/layout/app-shell";
import { studentCalendarWeek } from "@/features/calendar/calendar-week.fixture";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { EMPTY_DAY_MESSAGE } from "@/lib/empty-day";
import { formatDate } from "@/lib/format-date";
import { getQueryFn } from "@/lib/queryClient";
import type { EstimateResponse } from "@/lib/projectionApi";
import { resolveFeatureAccess } from "../../../server/lib/feature-access";
import { toPracticeQuota } from "../../../server/lib/practice-quota";
import { practiceAdapter } from "../../../server/services/calendar/adapters/practice";
import { reviewAdapter } from "../../../server/services/calendar/adapters/review";
import { fullLengthAdapter } from "../../../server/services/calendar/adapters/full-length";
import {
  capTables,
  reviewCapRefusal,
} from "@/components/review/review-cap.fixture";
import LyceonDashboard from "./lyceon-dashboard";
import fs from "node:fs";
import path from "node:path";

/** The Full-Length card's words, verbatim: the ruling's action and the page's approved subtitle. */
const FULL_LENGTH_CARD_ACTION = "Start a full-length test";
const FULL_LENGTH_CARD_LINE =
  "Timed like test day: two modules per section, a break between sections, and a scored report at the end.";

// ── The network ────────────────────────────────────────────────────────────────────────────

const net = vi.hoisted(() => ({
  log: [] as string[],
  handlers: [] as Array<
    (url: string, init: RequestInit | undefined) => Response | undefined
  >,
  /** QA item 5: requests matching `pattern` wait for `gate` (a slow server). */
  hold: null as null | { pattern: RegExp; gate: Promise<void> },
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
    if (net.hold !== null && net.hold.pattern.test(url)) await net.hold.gate;
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

// The server modules the producers import reach for a database; only the review cap's producer
// reads one, through `db.from`, while its refusal is built (QA2-A, review-cap.fixture.ts).
const db = vi.hoisted(() => ({
  from: null as null | ((table: string) => unknown),
}));
vi.mock("../../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: () => {
      throw new Error("no database in this test");
    },
    from: (table: string) => {
      if (db.from !== null) return db.from(table);
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
/** OQ-63: the fixture's Saturday, whose one block is the full-length sitting (day 5, slot 0). */
const SATURDAY = "2026-10-03";
const SATURDAY_FULL_LENGTH_BLOCK = "7c9e6679-7425-40de-944b-000000000050";
const LAUNCHED_EXAM = "66666666-6666-4666-8666-666666666666";

type Scenario = {
  calendar?: "ready" | "setup_required";
  estimateStatus?: EstimateResponse["estimateStatus"];
  projection?: "projected" | "none";
  diagnosticAnswered?: number;
  quota?: number | "unlimited";
  /** OQ-63: today is the fixture's Saturday, its full-length block not started. */
  fullLengthToday?: boolean;
  /** QA item 15: the fixture week as of another day (its Sunday has no blocks). */
  today?: string;
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
      : s.fullLengthToday === true
        ? studentCalendarWeek(SATURDAY, { openToday: true })
        : studentCalendarWeek(s.today ?? TODAY);
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
      if (
        method === "POST" &&
        path === `/api/calendar/blocks/${SATURDAY_FULL_LENGTH_BLOCK}/launch`
      )
        return json(
          launchResponseSchema.parse({
            engine: "full_length",
            session_id: LAUNCHED_EXAM,
            next: fullLengthAdapter.resumeHref(LAUNCHED_EXAM),
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

/**
 * A phone width for the shared full-length pre-start check: the App shell's phone query
 * (Tailwind's `max-lg`, `PHONE_LAYOUT_QUERY`) matches; every other query answers as the test
 * setup's does.
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
  net.hold = null;
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
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: SETUP_MATCH_MEDIA,
  });
  window.sessionStorage.clear();
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
        `${formatDate(TODAY, "weekday-month-day") ?? ""}. 66 days until your SAT on ${formatDate("2026-12-06", "weekday-month-day") ?? ""}.`,
      ),
    ).toBeTruthy();
    // OQ-66 (g): the US form, month before day.
    expect(
      screen.getByText(
        "Thursday, October 1. 66 days until your SAT on Sunday, December 6.",
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
    // OQ-66 (g) the older day in the shared formatter's US short form; (h) each row's
    // explicit action.
    const sat26 = formatDate("2026-09-26", "short-weekday-month-day") ?? "";
    expect(sat26).toBe("Sat, Sep 26");
    expect(recent.map((r) => r.textContent)).toEqual([
      "PracticeYesterday, 2:40 PM · 4 to reviewReview this session",
      `Review${sat26}, 2:12 AM · 1 to reviewReview this session`,
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
    expect(
      screen.getByText(`${formatDate(TODAY, "weekday-month-day") ?? ""}.`),
    ).toBeTruthy();
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

  it("its words are the ruling's action and the Full-Length page's approved subtitle", async () => {
    await mount("paid", { calendar: "ready" });
    const card = await screen.findByTestId("home-full-length");
    expect(within(card).getByTestId("home-full-length-start").textContent).toBe(
      FULL_LENGTH_CARD_ACTION,
    );
    expect(within(card).getByText(FULL_LENGTH_CARD_LINE)).toBeTruthy();
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

// ── OQ-63: the shared full-length pre-start check on Home ───────────────────────────────

describe("phone: Home's full-length starts ask the shared pre-start check first (OQ-63)", () => {
  const PHONE_TEXT =
    "Full-length tests are built for a laptop or tablet, like test day.";

  it("Today's plan, a full-length block: the notice, no launch until Continue anyway, then the sitting", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 15, 0, 0));
    installPhone();
    const { history } = await mount("paid", {
      calendar: "ready",
      fullLengthToday: true,
    });
    // Presence: today's one row is the full-length block, and Start today's plan launches it.
    const plan = await screen.findByTestId("home-plan");
    await waitFor(() =>
      expect(within(plan).getAllByTestId("home-plan-row")).toHaveLength(1),
    );
    fireEvent.click(screen.getByTestId("home-start-plan"));
    const notice = await screen.findByTestId("full-length-phone-notice");
    expect(within(notice).getByRole("heading").textContent).toBe(PHONE_TEXT);
    expect(launches()).toEqual([]);
    expect(history.at(-1)).toBe("/dashboard");

    await act(async () => {
      fireEvent.click(within(notice).getByTestId("full-length-phone-continue"));
    });
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${LAUNCHED_EXAM}`));
    expect(launches()).toEqual([
      `POST /api/calendar/blocks/${SATURDAY_FULL_LENGTH_BLOCK}/launch`,
    ]);
  });

  it("Today's plan, a review block on a phone: launches at once, no notice", async () => {
    installPhone();
    const { history } = await mount("paid", { calendar: "ready" });
    const start = await screen.findByTestId("home-start-plan");
    await act(async () => {
      fireEvent.click(start);
    });
    await waitFor(() =>
      expect(history.at(-1)).toBe(`/review/session/${LAUNCHED_SESSION}`),
    );
    expect(screen.queryByTestId("full-length-phone-notice")).toBeNull();
  });

  it("Pick up, the full-length sitting: the notice first; the practice and review rows go straight", async () => {
    installPhone();
    const { history } = await mount("paid", { calendar: "ready" });
    const resume = await screen.findByTestId("home-resume");
    await waitFor(() =>
      expect(within(resume).getAllByTestId("home-resume-row")).toHaveLength(3),
    );
    const [practice, , exam] = within(resume).getAllByRole("link", {
      name: "Continue",
    });
    if (practice === undefined || exam === undefined)
      throw new Error("three Continue links");
    fireEvent.click(exam);
    expect(await screen.findByTestId("full-length-phone-notice")).toBeTruthy();
    expect(history.at(-1)).toBe("/dashboard");
    fireEvent.click(screen.getByTestId("full-length-phone-continue"));
    expect(history.at(-1)).toBe(`/tests/${EXAM_SESSION_ID}`);

    cleanup();
    window.sessionStorage.clear();
    installPhone();
    const second = await mount("paid", { calendar: "ready" });
    const rows = await screen.findByTestId("home-resume");
    await waitFor(() =>
      expect(within(rows).getAllByTestId("home-resume-row")).toHaveLength(3),
    );
    const [practiceAgain] = within(rows).getAllByRole("link", {
      name: "Continue",
    });
    if (practiceAgain === undefined) throw new Error("a practice Continue");
    fireEvent.click(practiceAgain);
    expect(second.history.at(-1)).toBe(`/practice/session/${PRACTICE_ID}`);
    expect(screen.queryByTestId("full-length-phone-notice")).toBeNull();
  });

  it("desktop: the full-length Pick up row goes straight to the sitting", async () => {
    const { history } = await mount("paid", { calendar: "ready" });
    const resume = await screen.findByTestId("home-resume");
    await waitFor(() =>
      expect(within(resume).getAllByTestId("home-resume-row")).toHaveLength(3),
    );
    const exam = within(resume).getAllByRole("link", { name: "Continue" })[2];
    if (exam === undefined) throw new Error("the exam Continue");
    fireEvent.click(exam);
    expect(history.at(-1)).toBe(`/tests/${EXAM_SESSION_ID}`);
    expect(screen.queryByTestId("full-length-phone-notice")).toBeNull();
  });
});

// ── Owner QA list (Karl, 2026-10-07) items 4 and 5 ────────────────────────────────────────────

/**
 * Today's blocks as the fixture week serves them, each with the launch response the REAL adapter
 * for its engine produces (`resumeHref` is what the launch service puts in `next`, Doc 05F §15.1).
 * The session id is per block, so two rows can never satisfy each other's assertion.
 */
function todaysLaunches(): Array<{
  blockId: string;
  completed: boolean;
  next: string;
  body: unknown;
}> {
  const week = calendarReadyResponseSchema.parse(
    Object.fromEntries(
      Object.entries(studentCalendarWeek(TODAY)).filter(
        ([k]) => k !== "requestId",
      ),
    ),
  );
  const day = week.days.find((d) => d.local_date === TODAY);
  if (day === undefined) throw new Error("the fixture week has today");
  return day.blocks.map((entry, i) => {
    const { block } = entry;
    const sessionId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`;
    const adapter =
      block.block_type === "practice"
        ? practiceAdapter
        : block.block_type === "review"
          ? reviewAdapter
          : fullLengthAdapter;
    const next = adapter.resumeHref(sessionId);
    return {
      blockId: block.block_id,
      completed: entry.status === "completed",
      next,
      body: launchResponseSchema.parse({
        engine: block.block_type,
        session_id: sessionId,
        next,
        resumed: false,
      }),
    };
  });
}

function answerLaunches(rows: ReturnType<typeof todaysLaunches>): void {
  net.handlers.unshift((url, init) => {
    if ((init?.method ?? "GET") !== "POST") return undefined;
    const row = rows.find(
      (r) => url.split("?")[0] === `/api/calendar/blocks/${r.blockId}/launch`,
    );
    return row === undefined ? undefined : json(row.body);
  });
}

describe("QA item 4: every Home CTA lands on its exact destination (owner ruling: option a)", () => {
  it("each Today's plan row's Start opens exactly the session its launch response names", async () => {
    const rows = todaysLaunches();
    const open = rows.filter((r) => !r.completed);
    // Presence: today has more than one block, and at least one can be started.
    expect(rows.length).toBeGreaterThan(1);
    expect(open.length).toBeGreaterThan(0);
    for (const row of open) {
      cleanup();
      net.log.length = 0;
      const { history } = await mount("paid", { calendar: "ready" });
      answerLaunches(rows);
      const plan = await screen.findByTestId("home-plan");
      const index = rows.indexOf(row);
      const button = within(plan).getAllByTestId("home-plan-start")[index];
      if (button === undefined) throw new Error(`a Start for row ${index}`);
      await act(async () => {
        fireEvent.click(button);
      });
      await waitFor(() => expect(history.at(-1)).toBe(row.next));
      expect(launches()).toEqual([
        `POST /api/calendar/blocks/${row.blockId}/launch`,
      ]);
    }
  });

  it("'Start today's plan' opens exactly the session the first open block's launch names", async () => {
    const rows = todaysLaunches();
    const first = rows.find((r) => !r.completed);
    if (first === undefined) throw new Error("an open block today");
    const { history } = await mount("paid", { calendar: "ready" });
    answerLaunches(rows);
    const start = await screen.findByTestId("home-start-plan");
    await act(async () => {
      fireEvent.click(start);
    });
    await waitFor(() => expect(history.at(-1)).toBe(first.next));
    expect(first.next).toMatch(/^\/(practice|review)\/session\/|^\/tests\//);
  });
});

describe("QA item 5: Home's starts show a pending state from the first click", () => {
  it("'Start today's plan': 'Starting…', disabled and busy while the launch is in flight; one launch", async () => {
    let release: () => void = () => undefined;
    net.hold = {
      pattern: /\/api\/calendar\/blocks\/[^/]+\/launch$/,
      gate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const { history } = await mount("paid", { calendar: "ready" });
    const start = (await screen.findByTestId(
      "home-start-plan",
    )) as HTMLButtonElement;
    expect(start.textContent).toBe("Start today's plan");
    await act(async () => {
      fireEvent.click(start);
    });
    expect(start.textContent).toBe("Starting…");
    expect(start.disabled).toBe(true);
    expect(start.getAttribute("aria-busy")).toBe("true");
    expect(within(start).getByTestId("button-pending-spinner")).toBeTruthy();
    // The rows are disabled too, and none of them claims to be the one starting.
    for (const row of screen.getAllByTestId("home-plan-start")) {
      expect((row as HTMLButtonElement).disabled).toBe(true);
      expect(row.getAttribute("aria-busy")).toBeNull();
    }
    await act(async () => {
      fireEvent.click(start);
    });
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(history.at(-1)).toBe(`/review/session/${LAUNCHED_SESSION}`),
    );
    expect(launches()).toEqual([
      `POST /api/calendar/blocks/${TODAY_REVIEW_BLOCK}/launch`,
    ]);
  });

  it("a Today's plan row's Start: that row says 'Starting…', the primary keeps its label", async () => {
    net.hold = {
      pattern: /\/api\/calendar\/blocks\/[^/]+\/launch$/,
      gate: new Promise<void>(() => undefined),
    };
    await mount("paid", { calendar: "ready" });
    const plan = await screen.findByTestId("home-plan");
    const rows = within(plan).getAllByTestId("home-plan-start");
    const open = rows.find((b) => !(b as HTMLButtonElement).disabled);
    if (open === undefined) throw new Error("an open row");
    const label = open.textContent;
    await act(async () => {
      fireEvent.click(open);
    });
    expect(open.textContent).toBe("Starting…");
    expect(open.getAttribute("aria-busy")).toBe("true");
    expect(label).not.toBe("Starting…");
    expect(screen.getByTestId("home-start-plan").textContent).toBe(
      "Start today's plan",
    );
  });

  it("'Start diagnostic' (free): 'Starting…' and disabled while the diagnostic starts", async () => {
    net.hold = {
      pattern: /\/api\/practice\/diagnostic\/sessions$/,
      gate: new Promise<void>(() => undefined),
    };
    await mount("free", { estimateStatus: "no_baseline" });
    const start = (await screen.findByTestId(
      "home-start-diagnostic",
    )) as HTMLButtonElement;
    expect(start.textContent).toBe("Start diagnostic");
    await act(async () => {
      fireEvent.click(start);
    });
    expect(start.textContent).toBe("Starting…");
    expect(start.disabled).toBe(true);
    expect(start.getAttribute("aria-busy")).toBe("true");
  });
});

describe("QA item 14: Home's mastery rows and recent sessions go somewhere", () => {
  it("each mastery row links to its own domain on /mastery", async () => {
    await mount("paid", { calendar: "ready" });
    const mastery = await screen.findByTestId("home-mastery");
    const rows = await within(mastery).findAllByTestId("mastery-row");
    // Presence: the eight canonical domains.
    expect(rows).toHaveLength(8);
    const hrefs = rows.map((r) => (r.closest("a") ?? r).getAttribute("href"));
    expect(hrefs[0]).toBe("/mastery?domain=M%3AAlgebra");
    expect(hrefs[4]).toBe(
      `/mastery?domain=${encodeURIComponent("RW:Craft and Structure")}`,
    );
    expect(new Set(hrefs).size).toBe(8);
    // "See every skill" still opens the whole page.
    expect(
      within(mastery)
        .getByRole("link", { name: "See every skill" })
        .getAttribute("href"),
    ).toBe("/mastery");
  });

  it("a recent-session row reviews that session's open questions and lands in the review", async () => {
    const { history } = await mount("paid", { calendar: "ready" });
    net.handlers.unshift((url, init) =>
      init?.method === "POST" && url === "/api/review/sessions"
        ? json({ sessionId: LAUNCHED_SESSION }, 201)
        : undefined,
    );
    const panel = screen.getByTestId("app-shell-panel");
    const rows = await within(panel).findAllByTestId("home-recent-review");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.tagName).toBe("BUTTON");
    expect(rows[0]?.textContent).toBe("Review this session");
    const first = rows[0];
    if (first === undefined) throw new Error("a recent row");
    await act(async () => {
      fireEvent.click(first);
    });
    await waitFor(() =>
      expect(history.at(-1)).toBe(`/review/session/${LAUNCHED_SESSION}`),
    );
    const create = net.log.filter((l) => l === "POST /api/review/sessions");
    expect(create).toHaveLength(1);
  });

  it("a pressed recent row says 'Starting…' and the others wait", async () => {
    net.hold = {
      pattern: /^\/api\/review\/sessions$/,
      gate: new Promise<void>(() => undefined),
    };
    await mount("paid", { calendar: "ready" });
    const panel = screen.getByTestId("app-shell-panel");
    const [first, second] =
      await within(panel).findAllByTestId("home-recent-review");
    if (first === undefined || second === undefined)
      throw new Error("two recent rows");
    await act(async () => {
      fireEvent.click(first);
    });
    expect(first.getAttribute("aria-busy")).toBe("true");
    expect(first.textContent).toContain("Starting…");
    expect((second as HTMLButtonElement).disabled).toBe(true);
    expect(second.textContent).toBe("Review this session");
    expect(second.closest("li")?.textContent).toContain("1 to review");
  });

  it("OQ-66 (h): each row names its action, 'Review this session', with the session in its accessible name", async () => {
    await mount("paid", { calendar: "ready" });
    const panel = screen.getByTestId("app-shell-panel");
    const rows = await within(panel).findAllByTestId("home-recent-row");
    // Presence: both pool rows, each with one visible action.
    expect(rows).toHaveLength(2);
    const sat26 = formatDate("2026-09-26", "short-weekday-month-day") ?? "";
    const actions = within(panel).getAllByRole("button", {
      name: /^Review this session: /,
    });
    expect(actions.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Review this session: Practice, Yesterday, 2:40 PM",
      `Review this session: Review, ${sat26}, 2:12 AM`,
    ]);
    // The visible label is the start of the accessible name (label in name), and no two
    // rows share one.
    for (const [i, row] of rows.entries()) {
      const action = within(row).getByRole("button");
      expect(action).toBe(actions[i]);
      expect(action.textContent).toBe("Review this session");
    }
    expect(new Set(actions.map((b) => b.getAttribute("aria-label"))).size).toBe(
      2,
    );
  });
});

describe("QA item 15: one empty-day sentence", () => {
  it("a day with no blocks says the calendar's 'No study planned' (the shared constant), not 'Rest day'", async () => {
    vi.setSystemTime(new Date(2026, 9, 4, 15, 0, 0));
    // Presence: the fixture's Sunday is in its week, with no blocks.
    const week = calendarReadyResponseSchema.parse(
      Object.fromEntries(
        Object.entries(studentCalendarWeek(SUNDAY)).filter(
          ([k]) => k !== "requestId",
        ),
      ),
    );
    expect(week.days.find((d) => d.local_date === SUNDAY)?.blocks).toEqual([]);
    await mount("paid", { calendar: "ready", today: SUNDAY });
    const empty = await screen.findByTestId("home-plan-empty");
    expect(empty.textContent).toBe(EMPTY_DAY_MESSAGE);
    expect(EMPTY_DAY_MESSAGE).toBe("No study planned");
    expect(screen.getByTestId("home-plan").textContent).not.toContain(
      "Rest day",
    );
    expect(screen.queryByTestId("home-start-plan")).toBeNull();
  });
});

// ── Owner re-test (Karl, 2026-10-08) item A: the review cap ───────────────────────────────────

describe("QA2-A: a recent session's review start, refused by the review cap, is answered at that row", () => {
  /** The real producer's cap refusal (review-cap.fixture.ts). */
  let CAP_BODY: Record<string, unknown>;
  beforeAll(async () => {
    db.from = capTables;
    try {
      CAP_BODY = (await reviewCapRefusal()).body;
    } finally {
      db.from = null;
    }
  });

  let scrolled: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    scrolled = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrolled,
    });
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  function refuseCreate(body: unknown, status: number): void {
    net.handlers.unshift((url, init) =>
      init?.method === "POST" && url === "/api/review/sessions"
        ? json(body, status)
        : undefined,
    );
  }

  async function pressFirstRecent(): Promise<HTMLElement> {
    const panel = screen.getByTestId("app-shell-panel");
    const [first] = await within(panel).findAllByTestId("home-recent-review");
    if (first === undefined) throw new Error("a recent row");
    await act(async () => {
      fireEvent.click(first);
    });
    return first;
  }

  it.each([403, 409])(
    "refused with %i: the message directly under the pressed row, scrolled into view; Continue opens the open session",
    async (status) => {
      const { history } = await mount("paid", { calendar: "ready" });
      expect(CAP_BODY.code).toBe("SESSION_LIMIT_EXCEEDED");
      refuseCreate(CAP_BODY, status);
      const pressed = await pressFirstRecent();
      const cap = await screen.findByTestId("review-cap");
      expect(screen.getAllByTestId("review-cap")).toHaveLength(1);
      expect(cap.textContent).toContain("Too many open review sessions");
      expect(cap.textContent).toContain(String(CAP_BODY.message));
      // At the pressed row: the list item right after it holds the notice.
      const row = pressed.closest("li");
      expect(row?.nextElementSibling?.contains(cap)).toBe(true);
      expect(row?.nextElementSibling?.getAttribute("data-testid")).toBe(
        "home-recent-cap",
      );
      // Not the old red line under the whole list.
      expect(
        within(screen.getByTestId("home-recent")).queryByRole("alert"),
      ).toBeNull();
      // Never below the fold.
      expect(scrolled.mock.contexts).toContain(cap.parentElement);
      // The row is not left pending.
      expect(pressed.textContent).toBe("Review this session");

      fireEvent.click(
        within(cap).getByRole("button", { name: "Continue your open session" }),
      );
      expect(history.at(-1)).toBe(`/review/session/${REVIEW_ID}`);
    },
  );

  it("End a session goes to Review's open sessions, focused there", async () => {
    const { history } = await mount("paid", { calendar: "ready" });
    refuseCreate(CAP_BODY, 409);
    await pressFirstRecent();
    const cap = await screen.findByTestId("review-cap");
    fireEvent.click(within(cap).getByRole("button", { name: "End a session" }));
    expect(history.at(-1)).toBe("/review?focus=open-sessions");
  });

  it.each([403, 409])(
    "a different refusal under %i is not the cap: the plain failure line, no cap actions",
    async (status) => {
      await mount("paid", { calendar: "ready" });
      refuseCreate(
        {
          error: "forbidden",
          code: "STUDENT_ROLE_REQUIRED",
          message: "Only students can start review sessions.",
        },
        status,
      );
      await pressFirstRecent();
      const recent = screen.getByTestId("home-recent");
      expect((await within(recent).findByRole("alert")).textContent).toBe(
        "Only students can start review sessions.",
      );
      expect(screen.queryByTestId("review-cap")).toBeNull();
      expect(screen.queryByTestId("home-recent-cap")).toBeNull();
    },
  );
});
