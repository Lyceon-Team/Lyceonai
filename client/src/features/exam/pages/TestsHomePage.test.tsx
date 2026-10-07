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
 *       [owner ruling (Karl, 2026-10-05): on phone widths "Full-length tests are built for a
 *        laptop or tablet, like test day." with "Continue anyway"; never blocked; owner ruling
 *        (Karl, 2026-10-05, OQ-63): shown for every full-length start on a phone, one shared
 *        pre-start check]
 * @implemented [2026-10-03; phone notice 2026-10-05; OQ-63 2026-10-05]
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
  /** POST /api/tests/sessions answers 500 (Start's error line). */
  startError?: boolean;
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
        name: "Full-Length Practice Test 3",
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
      if (s.startError === true)
        return json({ error: { message: "boom" } }, 500);
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
  net.hold = null;
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
    const resume = await within(row("Full-Length Test 2")).findByRole("link", {
      name: "Resume",
    });
    expect(resume.getAttribute("href")).toBe(`/tests/${OPEN_SESSION}`);
    // Presence: Start on the never-taken form is drawn too, as an outline.
    const start = within(row("Full-Length Test 3")).getByRole("button", {
      name: "Start",
    });
    expect(start.className).toContain("border-lyc-ink-strong");
    expect(filledActions()).toEqual([resume]);
  });

  it("with nothing in progress, Start on the first never-taken form is the one primary", async () => {
    await mount("paid", { inProgress: false });
    const start2 = await within(row("Full-Length Test 2")).findByRole(
      "button",
      {
        name: "Start",
      },
    );
    const start3 = within(row("Full-Length Test 3")).getByRole("button", {
      name: "Start",
    });
    expect(filledActions()).toEqual([start2]);
    expect(start3.className).not.toContain("bg-lyc-primary-bg");
  });

  it("OQ-31: a completed test shows its score, with the disclosure beside it (§15.1)", async () => {
    await mount("paid");
    const card = row("Full-Length Test 1");
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
    const card = row("Full-Length Test 2");
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
      within(row("Full-Length Test 3")).getByTestId("exam-form-state")
        .textContent,
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
      within(row("Full-Length Test 1")).getByRole("button", { name: "Start" }),
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
      await within(row("Full-Length Test 3")).findByRole("button", {
        name: "Start",
      }),
    );
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${OPEN_SESSION}`));
  });
});

/**
 * Owner ruling OQ-62 (b) (Karl, 2026-10-05): "'full-length test' wording". The list's heading and
 * its two states name the sittings "full-length tests"; the bare "Your tests" / "the tests" are
 * gone. (Form names are database values; they are shown through `displayFormName`, below.)
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

  it("Start's failure line says 'the full-length test'", async () => {
    await mount("paid", { startError: true });
    fireEvent.click(
      await within(row("Full-Length Test 3")).findByRole("button", {
        name: "Start",
      }),
    );
    expect(
      await screen.findByText(
        "We couldn't start the full-length test. Check your connection and try again.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bstart the test\b/);
  });
});

/**
 * Owner ruling (Karl, 2026-10-05): "Form names: display \"Full-Length Test 1/2/3\" in student UI
 * as a display mapping only." The payload keeps the stored names ("Practice Test 1/2", and the E5
 * seed's "Full-Length Practice Test 3"); every row title, its accessible name and the report
 * link's label read "Full-Length Test N".
 */
describe("owner ruling 2026-10-05: form names display as 'Full-Length Test N'", () => {
  it("row titles, row names and View report labels map the stored names; the payload is untouched", async () => {
    await mount("paid");
    const list = screen.getByTestId("tests-list");
    const rows = within(list).getAllByTestId("tests-row");
    // Presence first: three rows, each with a title.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.querySelector("h3")?.textContent)).toEqual([
      "Full-Length Test 1",
      "Full-Length Test 2",
      "Full-Length Test 3",
    ]);
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Full-Length Test 1",
      "Full-Length Test 2",
      "Full-Length Test 3",
    ]);
    const report = await within(row("Full-Length Test 1")).findByTestId(
      "tests-view-report",
    );
    expect(report.getAttribute("aria-label")).toBe(
      "View report, Full-Length Test 1",
    );
    // The stored values are what the fixture serves; none reaches the page.
    expect(forms({}).forms.map((f) => f.name)).toEqual([
      "Practice Test 1",
      "Practice Test 2",
      "Full-Length Practice Test 3",
    ]);
    expect(document.body.textContent).not.toContain("Practice Test");
  });

  it("score history rows map the stored name", async () => {
    await mount("paid");
    const history = await screen.findByTestId("tests-history");
    const rows = within(history).getAllByTestId("tests-history-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector("span span")?.textContent).toBe(
      "Full-Length Test 1",
    );
    expect(history.textContent).not.toContain("Practice Test");
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
      "Full-Length Test 11120" +
        "26 September. Reading & Writing 620, Math 500",
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

// ── Phone widths (owner rulings, Karl, 2026-10-05; OQ-63) ──────────────────────────────────

const PHONE_TEXT =
  "Full-length tests are built for a laptop or tablet, like test day.";

function createRequests(): string[] {
  return net.log.filter((l) => l === "POST /api/tests/sessions");
}

/** The shared pre-start check's notice (a student Modal, portalled to <body>). */
function phoneNotice(): HTMLElement | null {
  return screen.queryByTestId("full-length-phone-notice");
}

describe("phone widths: the shared pre-start check (OQ-63)", () => {
  it("phone: the home is never held; the whole list, timing and panel draw with no notice", async () => {
    await mount("paid", {}, "phone");
    // Presence first: the title, the list, the timing and the panel are drawn.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Full-Length",
    );
    expect(screen.getByTestId("tests-home-body")).toBeTruthy();
    expect(screen.getAllByTestId("tests-row")).not.toHaveLength(0);
    expect(screen.getByTestId("tests-panel")).toBeTruthy();
    expect(phoneNotice()).toBeNull();
    expect(screen.queryByText(PHONE_TEXT)).toBeNull();
  });

  it("phone Start: the ruling's notice with an outline Continue anyway, and no create request until it is pressed", async () => {
    const { history } = await mount(
      "paid",
      { inProgress: false, scored: false },
      "phone",
    );
    fireEvent.click(
      within(row("Full-Length Test 1")).getByRole("button", { name: "Start" }),
    );
    const notice = await screen.findByTestId("full-length-phone-notice");
    expect(notice.getAttribute("role")).toBe("dialog");
    expect(within(notice).getByRole("heading").textContent).toBe(PHONE_TEXT);
    const button = within(notice).getByTestId("full-length-phone-continue");
    expect(button.textContent).toBe("Continue anyway");
    // An outline, never a filled primary: it acknowledges a note.
    expect(button.className).toContain("border-lyc-ink-strong");
    expect(button.className).not.toContain("bg-lyc-primary-bg");
    // Exactly the ruling's words, plus the Modal's named Close.
    expect(notice.textContent).toBe(PHONE_TEXT + "Continue anywayClose");
    // The check runs BEFORE the start: nothing has been created.
    expect(createRequests()).toEqual([]);
    expect(history.at(-1)).toBe("/tests");

    fireEvent.click(button);
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${NEW_SESSION}`));
    expect(createRequests()).toEqual(["POST /api/tests/sessions"]);
    expect(phoneNotice()).toBeNull();
  });

  it("phone Resume: the same notice; Continue anyway lands on the sitting", async () => {
    const { history } = await mount("paid", {}, "phone");
    const resume = await within(row("Full-Length Test 2")).findByRole("link", {
      name: "Resume",
    });
    expect(resume.getAttribute("href")).toBe(`/tests/${OPEN_SESSION}`);
    fireEvent.click(resume);
    expect(await screen.findByTestId("full-length-phone-notice")).toBeTruthy();
    expect(history.at(-1)).toBe("/tests");
    fireEvent.click(screen.getByTestId("full-length-phone-continue"));
    expect(history.at(-1)).toBe(`/tests/${OPEN_SESSION}`);
  });

  it("cancel: closing the notice starts nothing and leaves the student where they were; Start asks again", async () => {
    const { history } = await mount(
      "paid",
      { inProgress: false, scored: false },
      "phone",
    );
    const start = within(row("Full-Length Test 1")).getByRole("button", {
      name: "Start",
    });
    fireEvent.click(start);
    const notice = await screen.findByTestId("full-length-phone-notice");
    fireEvent.click(within(notice).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(phoneNotice()).toBeNull());
    expect(createRequests()).toEqual([]);
    expect(history.at(-1)).toBe("/tests");
    // Not remembered: a cancel is not a Continue anyway.
    fireEvent.click(start);
    expect(await screen.findByTestId("full-length-phone-notice")).toBeTruthy();
    expect(createRequests()).toEqual([]);
  });

  it("Continue anyway is remembered for the tab: the next start goes straight through", async () => {
    await mount("paid", { inProgress: false, scored: false }, "phone");
    fireEvent.click(
      within(row("Full-Length Test 1")).getByRole("button", { name: "Start" }),
    );
    fireEvent.click(await screen.findByTestId("full-length-phone-continue"));
    await waitFor(() => expect(createRequests()).toHaveLength(1));
    cleanup();
    net.log.length = 0;
    const { history } = await mount(
      "paid",
      { inProgress: false, scored: false },
      "phone",
    );
    fireEvent.click(
      within(row("Full-Length Test 1")).getByRole("button", { name: "Start" }),
    );
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${NEW_SESSION}`));
    expect(phoneNotice()).toBeNull();
  });

  it("free plan on a phone: the upgrade card draws directly, no notice", async () => {
    await mount("free", {}, "phone");
    expect(await screen.findByTestId("tests-upgrade-card")).toBeTruthy();
    expect(phoneNotice()).toBeNull();
  });

  it("desktop (lg and up): Start creates the session at once, no notice", async () => {
    const { history } = await mount(
      "paid",
      { inProgress: false, scored: false },
      "desktop",
    );
    fireEvent.click(
      within(row("Full-Length Test 1")).getByRole("button", { name: "Start" }),
    );
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${NEW_SESSION}`));
    expect(createRequests()).toEqual(["POST /api/tests/sessions"]);
    expect(phoneNotice()).toBeNull();
  });

  it("widening a phone past lg: Start goes straight through", async () => {
    const { history } = await mount(
      "paid",
      { inProgress: false, scored: false },
      "phone",
    );
    React.act(() => viewport.resize(false));
    fireEvent.click(
      within(row("Full-Length Test 1")).getByRole("button", { name: "Start" }),
    );
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${NEW_SESSION}`));
    expect(phoneNotice()).toBeNull();
  });

  it("no matchMedia at all (a non-browser render): the desktop path, no notice", async () => {
    const { history } = await mount(
      "paid",
      { inProgress: false, scored: false },
      "absent",
    );
    fireEvent.click(
      within(row("Full-Length Test 1")).getByRole("button", { name: "Start" }),
    );
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${NEW_SESSION}`));
    expect(phoneNotice()).toBeNull();
  });

  it("one shared check: only it imports the notice; every full-length start calls it; no exam session, module or report page does", () => {
    const clientSrc = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          !/\.test\.(ts|tsx)$/.test(entry.name)
        )
          sources.push(full);
      }
    };
    walk(clientSrc);
    const matching = (pattern: RegExp): string[] =>
      sources
        .filter((f) => pattern.test(fs.readFileSync(f, "utf8")))
        .map((f) => path.relative(clientSrc, f))
        .sort();
    // Presence: the walk saw the exam pages.
    expect(sources.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining([
        "ExamSessionPage.tsx",
        "ExamModulePage.tsx",
        "ExamReportPage.tsx",
        "TestsHomePage.tsx",
      ]),
    );
    // The notice's words and memory are imported by the shared check alone.
    expect(matching(/from "[^"]*\/phone-notice"/)).toEqual([
      "features/exam/lib/useFullLengthPhonePrecheck.tsx",
    ]);
    // Every full-length start calls it: the Full-Length home, Home (Today's plan and Pick up),
    // and the calendar (the block sheet's Start/Resume).
    expect(matching(/useFullLengthPhonePrecheck\(\)/)).toEqual([
      "components/home/PaidHome.tsx",
      "features/exam/lib/useFullLengthPhonePrecheck.tsx",
      "features/exam/pages/TestsHomePage.tsx",
      "pages/calendar.tsx",
    ]);
    // The sitting's own pages never ask.
    expect(
      matching(
        /useFullLengthPhonePrecheck|phone-notice|PHONE_LAYOUT_QUERY/,
      ).filter((f) => /Exam(Session|Module|Report)Page/.test(f)),
    ).toEqual([]);
  });
});

// ── Owner QA list (Karl, 2026-10-07) item 5 ───────────────────────────────────────────────────

describe("QA item 5: Full-Length's Start shows a pending state from the first click", () => {
  it("'Starting…', disabled and busy while the create is in flight; one create", async () => {
    let release: () => void = () => undefined;
    net.hold = {
      pattern: /^\/api\/tests\/sessions$/,
      gate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const { history } = await mount("paid", {
      inProgress: false,
      scored: false,
    });
    const start = (await within(row("Full-Length Test 1")).findByRole(
      "button",
      { name: "Start" },
    )) as HTMLButtonElement;
    fireEvent.click(start);
    expect(start.textContent).toBe("Starting…");
    expect(start.disabled).toBe(true);
    expect(start.getAttribute("aria-busy")).toBe("true");
    expect(within(start).getByTestId("button-pending-spinner")).toBeTruthy();
    fireEvent.click(start);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${NEW_SESSION}`));
    expect(
      net.bodies.filter((b) => b.url === "/api/tests/sessions"),
    ).toHaveLength(1);
  });
});
