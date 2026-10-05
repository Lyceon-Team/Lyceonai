// @vitest-environment jsdom
/**
 * UI-54: Full-Length home (`/tests`), paid and free, rendered in the real App shell.
 *
 * @spec [student-UI register UI-54; DESIGN.md §1 (one primary action), §4 "Full-Length home";
 *        prototype FullLength.dc.html; evidence/wiring-table.md §7; register §2 (paid =
 *        Full-Length; the entitlement denial contract), OQ-30 (score history from
 *        `GET /api/tests/sessions?state=scored`), OQ-31 (owner ruling 2026-10-02: the card shows
 *        the completed test's score; supersedes E7b ruling 2), OQ-32 (owner ruling 2026-10-02:
 *        "section, module" from the in-progress session's `/state`)]
 *       [Doc-04C §15.1: a scaled score always ships with its disclosure]
 *       [owner ruling (Karl, 2026-10-05): on phone widths the home shows "Full-length tests are
 *        built for a laptop or tablet, like test day." with "Continue anyway"; never blocked]
 * @implemented [2026-10-03; phone notice 2026-10-05]
 *
 * plain English: the page is mounted with the real query layer, the real App shell (the right
 * panel portals into it) and the real upgrade modal, over a scripted network standing in for
 * `csrfFetch`. Every request is logged, so "this element reads that endpoint" and "the free plan
 * asks for nothing gated" are asserted from the log.
 *
 * FIXTURES FROM REAL PRODUCERS. The feature-access map is `resolveFeatureAccess`'s output; the
 * scored session's numbers are the server's own report serializer's (`serializeStudentReport`)
 * projected to the strict score-history row; the forms listing and the session state are parsed
 * by their shared strict schemas before they are served.
 *
 * PRESENCE BEFORE ABSENCE: each "not there" check runs after the page has drawn what sits
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
import type { FeatureAccessMap } from "@lyceon/shared/feature-access";
import { examFormsResponseSchema } from "@lyceon/shared/exam-report-schema";
import { examSessionResponseSchema } from "@lyceon/shared/exam-runtime-schema";
import {
  examScoredSessionRowSchema,
  type ExamScoredSessionRow,
} from "@lyceon/shared/exam-scored-sessions-schema";
import { toStudentExamReport } from "@lyceon/shared/exam-student-report-schema";
import { masteryDomainsResponseSchema } from "@lyceon/shared/mastery-levels";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { AppShell } from "@/components/layout/app-shell";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { getQueryFn } from "@/lib/queryClient";
import { resolveFeatureAccess } from "../../../../../server/lib/feature-access";
import {
  FIXTURE_BREAKDOWN,
  FIXTURE_DISCLOSURE,
} from "../test-fixtures/report-fixtures";

// ── The network ────────────────────────────────────────────────────────────────────────────

const net = vi.hoisted(() => ({
  log: [] as string[],
  bodies: [] as Array<{ url: string; body: unknown }>,
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
    net.log.push(`${init?.method ?? "GET"} ${url}`);
    if (typeof init?.body === "string") {
      net.bodies.push({ url, body: JSON.parse(init.body) as unknown });
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
    id: "00000000-0000-4000-8000-000000000054",
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
vi.mock("../../../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: async () => entitlement.paid,
    isEntitlementActiveForProfile: async () => entitlement.paid,
  },
}));
vi.mock("../../../../../server/services/exam-runtime-service", () => ({
  callExamRpc: () => {
    throw new Error("no database in this test");
  },
}));

import { serializeStudentReport } from "../../../../../server/services/exam-report-service";
import TestsHomePage from "./TestsHomePage";

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────

const STUDENT = auth.user.id;
const FORM_1 = "f0f00000-0000-4000-8000-000000000541";
const FORM_2 = "f0f00000-0000-4000-8000-000000000542";
const FORM_3 = "f0f00000-0000-4000-8000-000000000543";
const SCORED_SESSION = "5e551011-0000-4000-8000-000000000541";
const OPEN_SESSION = "5e551011-0000-4000-8000-000000000542";
const NEW_SESSION = "5e551011-0000-4000-8000-000000000543";

/** The score-history row for a scored sitting, from the server's own report serializer. */
function scoredRow(): ExamScoredSessionRow {
  const report = toStudentExamReport(
    serializeStudentReport(
      {
        session: {
          session_id: SCORED_SESSION,
          test_form_id: FORM_1,
          test_form_name: "Practice Test 1",
          state: "completed",
          mode: "strict",
          grace_expires_at: "2026-09-27T15:00:00Z",
          completed_at: "2026-09-26T15:00:00Z",
          abandoned_at: null,
          attempt_number_for_form: 1,
          is_first_seen_form_attempt: true,
        },
        server_now: "2026-09-26T15:05:00Z",
        sections: [
          {
            section: "RW",
            state: "submitted",
            module2_submitted_by: "student",
          },
          { section: "M", state: "submitted", module2_submitted_by: "student" },
        ],
        score_run: {
          score_run_id: "a0a00000-0000-4000-8000-000000000541",
          rw_scored: true,
          math_scored: true,
          rw_scaled: 620,
          math_scaled: 500,
          total_scaled: 1120,
          partial_display_scaled: null,
          scoring_model_version: "v1.0",
          scored_at: "2026-09-26T15:00:05Z",
        },
        failure: null,
        disclosure: FIXTURE_DISCLOSURE,
      },
      "scored",
      FIXTURE_BREAKDOWN,
    ),
  );
  if (report.report_state !== "scored") throw new Error("expected scored");
  return examScoredSessionRowSchema.parse({
    session_id: report.session_id,
    test_form_name: report.test_form_name,
    completed_at: report.completed_at,
    total_scaled: report.score.total_scaled,
    rw_scaled: report.score.rw_scaled,
    math_scaled: report.score.math_scaled,
    disclosure: report.disclosure,
  });
}

const SECTIONS = [
  {
    section: "RW",
    questions_per_module: 27,
    module1_ms: 1_920_000,
    module2_ms: 1_920_000,
  },
  {
    section: "M",
    questions_per_module: 22,
    module1_ms: 2_100_000,
    module2_ms: 2_100_000,
  },
];

type Scenario = {
  /** Practice Test 2 in progress (Reading & Writing Module 2 active). Default true. */
  inProgress?: boolean;
  /** Practice Test 1 scored. Default true. */
  scored?: boolean;
  /** POST /api/tests/sessions answers 409 existing_active_session. */
  conflict?: boolean;
  /** GET /api/tests/forms answers 500 (the list's load-error state). */
  formsError?: boolean;
  /** GET /api/tests/forms answers with no forms (the list's empty state). */
  noForms?: boolean;
};

function forms(s: Scenario) {
  return examFormsResponseSchema.parse({
    forms: [
      {
        test_form_id: FORM_1,
        name: "Practice Test 1",
        is_selectable: true,
        question_count: 98,
        break_duration_ms: 600_000,
        sections: SECTIONS,
        latest_session:
          s.scored === false
            ? null
            : {
                session_id: SCORED_SESSION,
                state: "completed",
                mode: "strict",
                attempt_number_for_form: 1,
                report_state: "scored",
              },
      },
      {
        test_form_id: FORM_2,
        name: "Practice Test 2",
        is_selectable: true,
        question_count: 98,
        break_duration_ms: 600_000,
        sections: SECTIONS,
        latest_session:
          s.inProgress === false
            ? null
            : {
                session_id: OPEN_SESSION,
                state: "active",
                mode: "lenient",
                attempt_number_for_form: 1,
                report_state: "not_completed",
              },
      },
      {
        test_form_id: FORM_3,
        name: "Practice Test 3",
        is_selectable: true,
        question_count: 98,
        break_duration_ms: 600_000,
        sections: SECTIONS,
        latest_session: null,
      },
    ],
  });
}

function openState() {
  return examSessionResponseSchema.parse({
    session_id: OPEN_SESSION,
    test_form_id: FORM_2,
    state: "active",
    mode: "lenient",
    active_section: "RW",
    grace_expires_at: "2026-10-04T15:00:00Z",
    attempt_number_for_form: 1,
    is_first_seen_form_attempt: true,
    break_remaining_ms: null,
    sections: [
      {
        section: "RW",
        state: "module2_active",
        remaining_ms: 1_500_000,
        module2_path_locked: true,
        current_ordinal: 3,
      },
      {
        section: "M",
        state: "not_started",
        remaining_ms: null,
        module2_path_locked: false,
        current_ordinal: null,
      },
    ],
  });
}

function mastery() {
  return masteryDomainsResponseSchema.parse({
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
        section: "RW",
        domain: "Information and Ideas",
        levelKey: "L3",
        level: 3,
        displayName: "Proficient",
      },
    ],
  });
}

const meta = { request_id: "r", served_at: "2026-10-03T00:00:00Z" };

function install(s: Scenario): void {
  net.handler = (url, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "/api/tests/forms") {
      if (s.formsError === true)
        return json({ error: { message: "boom" } }, 500);
      if (s.noForms === true) return json({ ...forms(s), forms: [] });
      return json(forms(s));
    }
    if (method === "GET" && url === "/api/tests/sessions?state=scored")
      return json({
        data: { sessions: s.scored === false ? [] : [scoredRow()] },
        meta,
      });
    if (method === "GET" && url === `/api/tests/sessions/${OPEN_SESSION}/state`)
      return json(openState());
    if (method === "GET" && url === `/api/students/${STUDENT}/mastery/domains`)
      return json(mastery());
    if (method === "POST" && url === "/api/tests/sessions") {
      if (s.conflict === true)
        return json(
          {
            error: {
              code: "existing_active_session",
              message: "A session is already in progress.",
              details: { session_id: OPEN_SESSION },
            },
          },
          409,
        );
      return json(
        {
          ...openState(),
          session_id: NEW_SESSION,
          state: "created",
          active_section: null,
        },
        201,
      );
    }
    return undefined;
  };
}

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

/**
 * The viewport, as `matchMedia` reports it. "default" keeps the test setup's own `matchMedia`
 * (vitest.setup.ts: every query answers "no match", the desktop layout a test that never mentions
 * viewports means); "absent" removes `matchMedia` altogether (a non-browser render). "phone" and
 * "desktop" install a fake that answers the App shell's phone query (Tailwind's `max-lg`) and can
 * be resized, firing `change` the way a browser does.
 */
type Viewport = "default" | "absent" | "phone" | "desktop";
const SETUP_MATCH_MEDIA = window.matchMedia;
const viewport = {
  phone: false,
  listeners: new Set<() => void>(),
  resize(phone: boolean): void {
    this.phone = phone;
    for (const l of this.listeners) l();
  },
};
function installViewport(v: Viewport): void {
  if (v === "default") return;
  if (v === "absent") {
    Reflect.deleteProperty(window, "matchMedia");
    return;
  }
  viewport.phone = v === "phone";
  viewport.listeners.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      if (query !== "not all and (min-width: 1024px)") {
        throw new Error(`unexpected media query ${query}`);
      }
      return {
        get matches(): boolean {
          return viewport.phone;
        },
        media: query,
        addEventListener: (_: "change", l: () => void) =>
          viewport.listeners.add(l),
        removeEventListener: (_: "change", l: () => void) =>
          viewport.listeners.delete(l),
      };
    },
  });
}

async function mount(
  plan: "paid" | "free",
  scenario: Scenario = {},
  view: Viewport = "default",
): Promise<{ history: string[] }> {
  install(scenario);
  installViewport(view);
  const map = await accessMap(plan === "paid");
  const { hook, history } = memoryLocation({ path: "/tests", record: true });
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
          <AppShell panel={360} footer>
            <TestsHomePage />
          </AppShell>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  await screen.findByTestId("tests-home");
  if (
    plan === "paid" &&
    view !== "phone" &&
    scenario.formsError !== true &&
    scenario.noForms !== true
  ) {
    await screen.findAllByTestId("tests-row");
  }
  return { history };
}

function gets(): string[] {
  return net.log.filter((l) => l.startsWith("GET ")).map((l) => l.slice(4));
}

function row(name: string): HTMLElement {
  return screen.getByRole("article", { name });
}

/** Every filled (primary) button or link on the page. */
function filledActions(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("main button, main a"),
  ).filter((el) => el.className.includes("bg-lyc-primary-bg"));
}

beforeEach(() => {
  net.log.length = 0;
  net.bodies.length = 0;
  net.handler = null;
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: SETUP_MATCH_MEDIA,
  });
});

// ── Paid ────────────────────────────────────────────────────────────────────────────────────

describe("paid: the test list (DESIGN.md §4)", () => {
  it("one primary action: Resume over Start", async () => {
    await mount("paid");
    const resume = await within(row("Practice Test 2")).findByRole("link", {
      name: "Resume",
    });
    expect(resume.getAttribute("href")).toBe(`/tests/${OPEN_SESSION}`);
    // Presence: Start on the never-taken form is drawn too, as an outline.
    const start = within(row("Practice Test 3")).getByRole("button", {
      name: "Start",
    });
    expect(start.className).toContain("border-lyc-ink-strong");
    expect(filledActions()).toEqual([resume]);
  });

  it("with nothing in progress, Start on the first never-taken form is the one primary", async () => {
    await mount("paid", { inProgress: false });
    const start2 = await within(row("Practice Test 2")).findByRole("button", {
      name: "Start",
    });
    const start3 = within(row("Practice Test 3")).getByRole("button", {
      name: "Start",
    });
    expect(filledActions()).toEqual([start2]);
    expect(start3.className).not.toContain("bg-lyc-primary-bg");
  });

  it("OQ-31: a completed test shows its score, with the disclosure beside it (§15.1)", async () => {
    await mount("paid");
    const card = row("Practice Test 1");
    await waitFor(() =>
      expect(within(card).getByTestId("exam-form-state").textContent).toBe(
        "Completed 26 September. Score 1120.",
      ),
    );
    const note = within(card).getByTestId("exam-disclosure");
    expect(note.textContent).toBe(FIXTURE_DISCLOSURE.summary);
    expect(
      within(card)
        .getByRole("link", { name: /View report/ })
        .getAttribute("href"),
    ).toBe(`/tests/${SCORED_SESSION}/report`);
    expect(gets()).toContain("/api/tests/sessions?state=scored");
  });

  it("OQ-32: the in-progress test reads 'section, module' from its own /state", async () => {
    await mount("paid");
    const card = row("Practice Test 2");
    await waitFor(() =>
      expect(within(card).getByTestId("exam-form-state").textContent).toBe(
        "In progress: Reading & Writing, Module 2",
      ),
    );
    expect(gets()).toContain(`/api/tests/sessions/${OPEN_SESSION}/state`);
    // Only the in-progress session's state is read.
    expect(gets().filter((g) => g.endsWith("/state"))).toEqual([
      `/api/tests/sessions/${OPEN_SESSION}/state`,
    ]);
    expect(
      within(row("Practice Test 3")).getByTestId("exam-form-state").textContent,
    ).toBe("Not started");
  });

  it("Start creates the session with the chosen timing and lands on the exam session route", async () => {
    const { history } = await mount("paid", {
      inProgress: false,
      scored: false,
    });
    fireEvent.click(await screen.findByLabelText(/Practice timing/));
    expect(screen.getByTestId("tests-before-timing").textContent).toBe(
      "The clock pauses when you step away. Your report says so.",
    );
    fireEvent.click(
      within(row("Practice Test 1")).getByRole("button", { name: "Start" }),
    );
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${NEW_SESSION}`));
    expect(
      net.bodies
        .filter((b) => b.url === "/api/tests/sessions")
        .map((b) => b.body),
    ).toEqual([{ test_form_id: FORM_1, mode: "lenient" }]);
    // The module is begun on the session page, not here.
    expect(net.log.some((l) => l.includes("/modules/"))).toBe(false);
  });

  it("a 409 existing_active_session takes the student to that session", async () => {
    const { history } = await mount("paid", { conflict: true });
    fireEvent.click(
      await within(row("Practice Test 3")).findByRole("button", {
        name: "Start",
      }),
    );
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${OPEN_SESSION}`));
  });
});

/**
 * Owner ruling OQ-62 (b) (Karl, 2026-10-05): "'full-length test' wording". The list's heading and
 * its two states name the sittings "full-length tests"; the bare "Your tests" / "the tests" are
 * gone. (Form names such as "Practice Test 2" are database values, not copy, and stay.)
 */
describe("OQ-62 (b): the list names its sittings 'full-length tests'", () => {
  it("the heading is 'Your full-length tests', never 'Your tests'", async () => {
    await mount("paid");
    const list = screen.getByTestId("tests-list");
    // Presence first: the list is drawn with its rows.
    expect(within(list).getAllByTestId("tests-row").length).toBeGreaterThan(0);
    expect(within(list).getByRole("heading", { level: 2 }).textContent).toBe(
      "Your full-length tests",
    );
    expect(document.body.textContent).not.toMatch(/\bYour tests\b/);
  });

  it("the load error says 'the full-length tests'", async () => {
    await mount("paid", { formsError: true });
    const error = await screen.findByTestId("tests-error");
    expect(error.textContent).toContain(
      "We couldn't load the full-length tests.",
    );
    expect(document.body.textContent).not.toMatch(/\bthe tests\b/);
  });

  it("the empty state says 'No full-length tests are available yet.'", async () => {
    await mount("paid", { noForms: true });
    expect(
      await screen.findByText("No full-length tests are available yet."),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bNo tests\b/);
  });
});

describe("paid: the right panel", () => {
  it("OQ-30: score history from the scored-sessions endpoint, each row linking to its report, with the disclosure", async () => {
    await mount("paid");
    const history = await screen.findByTestId("tests-history");
    const rows = within(history).getAllByTestId("tests-history-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("href")).toBe(
      `/tests/${SCORED_SESSION}/report`,
    );
    expect(rows[0]!.textContent).toBe(
      "Practice Test 11120" + "26 September. Reading & Writing 620, Math 500",
    );
    expect(within(history).getByTestId("exam-disclosure").textContent).toBe(
      FIXTURE_DISCLOSURE.summary,
    );
    expect(gets()).toContain("/api/tests/sessions?state=scored");
  });

  it("mastery: compact rows, read only with mastery_detail", async () => {
    await mount("paid");
    const panel = await screen.findByTestId("tests-mastery");
    await waitFor(() =>
      expect(within(panel).getByText("Algebra")).toBeTruthy(),
    );
    expect(gets()).toContain(`/api/students/${STUDENT}/mastery/domains`);
  });
});

// ── Free ────────────────────────────────────────────────────────────────────────────────────

describe("free plan (register §2: Full-Length is paid)", () => {
  it("shows the in-page upgrade card and asks for nothing gated", async () => {
    const { history } = await mount("free");
    const card = await screen.findByTestId("tests-upgrade-card");
    expect(card.textContent).toContain("Included with every paid plan");
    expect(card.textContent).toContain(
      "Timed full-length tests with two modules per section that adapt to how you do, like the real SAT. You get a scored report after each one.",
    );
    expect(screen.getByTestId("locked-mastery-card")).toBeTruthy();
    // Give any stray query a chance to fire before the absence check.
    await new Promise((r) => setTimeout(r, 20));
    expect(gets().filter((g) => g.startsWith("/api/tests"))).toEqual([]);
    expect(gets().filter((g) => g.includes("/mastery/"))).toEqual([]);
    expect(screen.queryByTestId("tests-list")).toBeNull();
    expect(screen.queryByTestId("tests-history")).toBeNull();
    fireEvent.click(screen.getByTestId("tests-see-plans"));
    expect(history.at(-1)).toBe("/profile?tab=billing");
  });
});

// ── Phone widths (owner ruling, Karl, 2026-10-05) ────────────────────────────────────────────

const PHONE_TEXT =
  "Full-length tests are built for a laptop or tablet, like test day.";

describe("phone widths: the laptop-or-tablet notice (owner ruling 2026-10-05)", () => {
  it("phone: the title and the ruling's notice with Continue anyway, in place of the home's body", async () => {
    await mount("paid", {}, "phone");
    // Presence first: the title and the notice are drawn.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Full-Length",
    );
    const notice = screen.getByTestId("tests-phone-notice");
    expect(within(notice).getByText(PHONE_TEXT)).toBeTruthy();
    const button = within(notice).getByRole("button");
    expect(button.textContent).toBe("Continue anyway");
    // Exactly the ruling's words: the title line and the button, nothing else.
    expect(notice.textContent).toBe(PHONE_TEXT + "Continue anyway");
    // The notice's action is an outline (it dismisses a note); no filled primary while held.
    expect(button.className).toContain("border-lyc-ink-strong");
    expect(filledActions()).toEqual([]);
    expect(screen.queryByTestId("tests-home-body")).toBeNull();
    expect(screen.queryByTestId("tests-list")).toBeNull();
    expect(screen.queryByTestId("tests-panel")).toBeNull();
  });

  it("Continue anyway reveals the whole home: Resume and Start are reachable, the panel too", async () => {
    await mount("paid", {}, "phone");
    fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));
    expect(screen.queryByTestId("tests-phone-notice")).toBeNull();
    const body = screen.getByTestId("tests-home-body");
    // Focus moves to the revealed body, not to <body>.
    expect(document.activeElement).toBe(body);
    const resume = await within(row("Practice Test 2")).findByRole("link", {
      name: "Resume",
    });
    expect(resume.getAttribute("href")).toBe(`/tests/${OPEN_SESSION}`);
    expect(
      within(row("Practice Test 3")).getByRole("button", { name: "Start" }),
    ).toBeTruthy();
    expect(filledActions()).toEqual([resume]);
    expect(await screen.findByTestId("tests-history")).toBeTruthy();
  });

  it("nothing is blocked: after Continue anyway, Start creates the session and lands on it", async () => {
    const { history } = await mount(
      "paid",
      { inProgress: false, scored: false },
      "phone",
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));
    fireEvent.click(
      await within(row("Practice Test 1")).findByRole("button", {
        name: "Start",
      }),
    );
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${NEW_SESSION}`));
  });

  it("Continue anyway is remembered for the visit (this tab)", async () => {
    await mount("paid", {}, "phone");
    fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));
    await screen.findAllByTestId("tests-row");
    cleanup();
    await mount("paid", {}, "phone");
    expect(await screen.findAllByTestId("tests-row")).not.toHaveLength(0);
    expect(screen.queryByTestId("tests-phone-notice")).toBeNull();
  });

  it("free plan on a phone: Continue anyway reveals the upgrade card", async () => {
    await mount("free", {}, "phone");
    expect(screen.getByTestId("tests-phone-notice")).toBeTruthy();
    expect(screen.queryByTestId("tests-upgrade-card")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));
    expect(await screen.findByTestId("tests-upgrade-card")).toBeTruthy();
  });

  it("desktop (lg and up): no notice, the home as before", async () => {
    await mount("paid", {}, "desktop");
    // Naming ruling (Karl, 2026-10-05): the page title is the section's name.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Full-Length",
    );
    expect(screen.getAllByTestId("tests-row")).not.toHaveLength(0);
    expect(screen.queryByTestId("tests-phone-notice")).toBeNull();
    expect(screen.queryByText(PHONE_TEXT)).toBeNull();
  });

  it("widening a phone past lg reveals the home with no tap", async () => {
    await mount("paid", {}, "phone");
    expect(screen.getByTestId("tests-phone-notice")).toBeTruthy();
    React.act(() => viewport.resize(false));
    expect(screen.queryByTestId("tests-phone-notice")).toBeNull();
    expect(await screen.findAllByTestId("tests-row")).not.toHaveLength(0);
  });

  it("no matchMedia at all (a non-browser render): the desktop path, no notice", async () => {
    await mount("paid", {}, "absent");
    expect(screen.getAllByTestId("tests-row")).not.toHaveLength(0);
    expect(screen.queryByTestId("tests-phone-notice")).toBeNull();
  });

  it("the test setup's default matchMedia (no query matches) is the desktop path", async () => {
    await mount("paid");
    expect(screen.getAllByTestId("tests-row")).not.toHaveLength(0);
    expect(screen.queryByTestId("tests-phone-notice")).toBeNull();
  });

  it("only the Full-Length home shows it: no exam session, module or report page imports the notice", () => {
    const pages = path.dirname(fileURLToPath(import.meta.url));
    const sources = fs
      .readdirSync(pages)
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));
    // Presence: the pages directory holds the session, module and report pages.
    expect(sources).toEqual(
      expect.arrayContaining([
        "ExamSessionPage.tsx",
        "ExamModulePage.tsx",
        "ExamReportPage.tsx",
        "TestsHomePage.tsx",
      ]),
    );
    const users = sources.filter((f) =>
      /phone-notice|PHONE_LAYOUT_QUERY/.test(
        fs.readFileSync(path.join(pages, f), "utf8"),
      ),
    );
    expect(users).toEqual(["TestsHomePage.tsx"]);
  });
});
