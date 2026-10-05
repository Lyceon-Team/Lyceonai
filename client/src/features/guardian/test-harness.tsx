/**
 * ONE scenario for the guardian surface's RTL tests (CLAUDE.md: "one scenario, shared").
 *
 * @spec [Guardian_Closure_Plan G4-02..G4-10] | @implemented [2026-09-30]
 *
 * plain English: a scripted network for `csrfFetch` (the one transport every guardian read
 * uses) and a mount of the app's REAL route switch at a path, signed in as a guardian. The
 * roster rows pass through the shared contract (`guardianStudentsResponseSchema`), so a row
 * the real hook would refuse cannot be built here; per-student reads answer through handlers
 * a test installs. Every request is logged for the "which route did this widget call" proofs.
 */
import React from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { guardianStudentsResponseSchema } from "@lyceon/shared/guardian-student-schema";
import { guardianCalendarResponseSchema } from "@lyceon/shared";
import { guardianCalendarWeek } from "@/features/calendar/calendar-week.fixture";
import { addDays, browserLocalToday } from "@/features/calendar/lib/dates";
import { billingStatusResponseSchema } from "@lyceon/shared/billing-schema";
import { masteryDomainsResponseSchema } from "@lyceon/shared/mastery-levels";
import {
  toGuardianExamList,
  toGuardianExamReport,
  type GuardianListSessionFacts,
} from "@lyceon/shared/exam-guardian-report-schema";
import type { ExamSessionState } from "@lyceon/shared/exam-runtime-schema";
import {
  examFormsResponseSchema,
  examReportPayloadSchema,
  type ExamReportPayload,
} from "@lyceon/shared/exam-report-schema";
import {
  FIXTURE_SESSION_ID,
  formsListing,
  scoredReport,
} from "@/features/exam/test-fixtures/report-fixtures";

export const ADA = "33333333-3333-4333-8333-333333333333";
export const BO = "44444444-4444-4444-8444-444444444444";
export const CY = "55555555-5555-4555-8555-555555555555";

type Roster = ReturnType<typeof guardianStudentsResponseSchema.parse>;

/**
 * Roster entries through the shared contract. `lapsed` students have ended subscriptions;
 * `unpaid` students never had one (neither entitled nor lapsed).
 */
export function roster(
  entries: ReadonlyArray<{
    id: string;
    name: string;
    lapsed?: boolean;
    unpaid?: boolean;
  }>,
): Roster {
  return guardianStudentsResponseSchema.parse({
    students: entries.map((e) => ({
      id: e.id,
      email: `${e.name.toLowerCase()}@example.test`,
      display_name: e.name,
      created_at: "2026-09-01T00:00:00.000Z",
      has_active_entitlement: e.lapsed !== true && e.unpaid !== true,
      entitlement_lapsed: e.lapsed === true,
    })),
  });
}

type Handler = (
  url: string,
  init: RequestInit | undefined,
) => Response | Promise<Response> | undefined;

/** A request that never answers: the loading state, held. */
export function pending(): Promise<Response> {
  return new Promise<Response>(() => undefined);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const net = {
  log: [] as string[],
  roster: roster([]),
  handlers: [] as Handler[],
  reset(): void {
    this.log.length = 0;
    this.roster = roster([]);
    this.handlers = [];
  },
};

/** The `csrfFetch` stand-in: tests install it with `vi.mock("@/lib/csrf", ...)`. */
export async function scriptedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  net.log.push(`${init?.method ?? "GET"} ${url}`);
  for (const handler of net.handlers) {
    const answer = handler(url, init);
    if (answer !== undefined) return answer;
  }
  if (url === "/api/profile") {
    return json({
      user: {
        role: "guardian",
        profileCompletedAt: "2026-09-01T00:00:00.000Z",
        requiredProfileComplete: true,
        guardianConsentRequired: false,
      },
    });
  }
  if (url === "/api/guardian/students") return json(net.roster);
  return json({ error: "Not found" }, 404);
}

export const GUARDIAN_AUTH = {
  user: { id: "guardian-1", email: "g@example.test", role: "guardian" },
  isLoading: false,
  authLoading: false,
  isAuthenticated: true,
  isGuardian: true,
  isAdmin: false,
  accountUnavailable: false,
};

export function mountApp(
  Router: React.ComponentType,
  path: string,
): { history: string[]; client: QueryClient } {
  const location = memoryLocation({ path, record: true });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <WouterRouter hook={location.hook} searchHook={location.searchHook}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>,
  );
  return { history: location.history, client };
}

// ── Per-student payloads, each through its shared schema or the real projection ──────────

export const EXAM_SESSION = FIXTURE_SESSION_ID;

/**
 * A ready guardian calendar week. By default it is the REAL week: the blocks and the facts
 * come out of `buildCalendarRange`, projected by `toGuardianCalendarDay` exactly as the server
 * does (`calendar-week.fixture.ts`), so the Dashboard's header and the Calendar tab read one
 * story. `completed`/`total` override the facts alone, for a case about the header's words.
 */
export function calendarWeek(
  over: {
    streak?: number | null;
    completed?: number;
    total?: number;
    targetScore?: number | null;
    testDate?: string | null;
    /** The week's "today"; the browser specs pin it (`tests/e2e/guardian-harness/today.ts`). */
    today?: string;
  } = {},
): Record<string, unknown> {
  const real = guardianCalendarWeek(over.today ?? browserLocalToday(), {
    ...(over.streak === undefined ? {} : { streak: over.streak }),
    ...(over.targetScore === undefined
      ? {}
      : { targetScore: over.targetScore }),
    ...(over.testDate === undefined ? {} : { testDate: over.testDate }),
  });
  if (over.completed === undefined && over.total === undefined) return real;
  const { ok, requestId, ...body } = real;
  const facts = body.facts as Record<string, number>;
  return {
    ok,
    ...guardianCalendarResponseSchema.parse({
      ...body,
      facts: {
        ...facts,
        blocks_completed: over.completed ?? facts.blocks_completed,
        blocks_total: over.total ?? facts.blocks_total,
      },
    }),
    requestId,
  };
}

/** Mastery by domain across both sections, parsed by the client's schema. */
export function masteryDomains(): Record<string, unknown> {
  return masteryDomainsResponseSchema.parse({
    ok: true,
    domains: [
      {
        section: "RW",
        domain: "Craft and Structure",
        levelKey: "L3",
        level: 3,
        displayName: "Proficient",
      },
      {
        section: "RW",
        domain: "Expression of Ideas",
        levelKey: "L2",
        level: 2,
        displayName: "Developing",
      },
      {
        section: "M",
        domain: "Algebra",
        levelKey: "L4",
        level: 4,
        displayName: "Strong",
      },
      {
        section: "M",
        domain: "Advanced Math",
        levelKey: "unmeasured",
        level: null,
        displayName: "Not enough answers yet",
      },
    ],
  });
}

/**
 * A report's own instants, as `exam_list_forms` reads them from the same session (SCL-192,
 * SCL-199) — so a list built from them agrees with the report. No score: the list carries none
 * (G5-09).
 */
export function listFactsOf(
  report: ExamReportPayload,
): GuardianListSessionFacts {
  const at = (key: "completed_at" | "abandoned_at"): string | null =>
    key in report
      ? ((report as Record<string, unknown>)[key] as string | null)
      : null;
  return {
    completed_at: at("completed_at"),
    abandoned_at: at("abandoned_at"),
  };
}

/**
 * A scored report for another session, built from the fixture's scored report through the
 * report schema: its own id, name, completion and section scores (the total is their sum).
 */
export function scoredReportFor(o: {
  session_id: string;
  name: string;
  completed_at: string;
  rw: number;
  math: number;
}): ExamReportPayload {
  if (scoredReport.report_state !== "scored") throw new Error("fixture drift");
  return examReportPayloadSchema.parse({
    ...scoredReport,
    session_id: o.session_id,
    test_form_name: o.name,
    completed_at: o.completed_at,
    score: {
      ...scoredReport.score,
      total_scaled: o.rw + o.math,
      rw_scaled: o.rw,
      math_scaled: o.math,
    },
    sections: [
      {
        section: "RW",
        section_state: "submitted",
        scaled: o.rw,
        scoreable: true,
      },
      {
        section: "M",
        section_state: "submitted",
        scaled: o.math,
        scoreable: true,
      },
    ],
  });
}

/** The guardian exam list, through the real projection (SCL-192 `completed_at`). */
export function examList(): Record<string, unknown> {
  return {
    ok: true,
    ...toGuardianExamList(formsListing, {
      [FIXTURE_SESSION_ID]: {
        ...listFactsOf(scoredReport),
        completed_at: "2026-09-20T15:00:00.000Z",
      },
    }),
    requestId: "r",
  };
}

/** A guardian calendar for a student who has not set up a plan, through the schema. */
export function calendarSetupRequired(): Record<string, unknown> {
  return {
    ok: true,
    ...guardianCalendarResponseSchema.parse({ status: "setup_required" }),
    requestId: "r",
  };
}

/**
 * A test the student sat on another form, for `examListWith`: its report (the one place its
 * scores live, G5-09) and, where the report alone does not say it, the session state.
 */
export type OtherExam = {
  report: ExamReportPayload;
  /** Defaults from the report state: partial → abandoned with a score, else completed. */
  session_state?: ExamSessionState;
};

/** The listing's session state for a report: what `exam_list_forms` reads for that state. */
function sessionStateOf(
  report: ExamReportPayload,
  over?: ExamSessionState,
): ExamSessionState {
  if (over !== undefined) return over;
  if (report.report_state === "partial_scored")
    return "partial_scored_abandoned";
  if (report.report_state === "not_completed") return report.session_state;
  return "completed";
}

/**
 * The guardian exam list holding `latest` (a report; the fixture's scored one by default) plus
 * `others`, each the latest attempt on a form of its own — built as a forms listing from each
 * report's own name, state and instants and put through the real projection (SCL-192, SCL-199),
 * never as hand-written list items. No score reaches the list (G5-09); `serveReports` answers
 * each session's report.
 */
export function examListWith(
  others: readonly OtherExam[],
  latest: ExamReportPayload = scoredReport,
): Record<string, unknown> {
  const [sat] = formsListing.forms;
  if (sat === undefined || sat.latest_session === null) {
    throw new Error("fixture drift");
  }
  const forms = examFormsResponseSchema.parse({
    forms: [
      {
        ...sat,
        name: latest.test_form_name,
        latest_session: {
          ...sat.latest_session,
          session_id: latest.session_id,
          state: sessionStateOf(latest),
          report_state: latest.report_state,
        },
      },
      ...others.map((o, index) => ({
        ...sat,
        test_form_id: `f0f00000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
        name: o.report.test_form_name,
        latest_session: {
          session_id: o.report.session_id,
          state: sessionStateOf(o.report, o.session_state),
          mode: "strict",
          attempt_number_for_form: 1,
          report_state: o.report.report_state,
        },
      })),
    ],
  });
  const sessions: Record<string, GuardianListSessionFacts> = {
    [latest.session_id]: listFactsOf(latest),
  };
  for (const o of others) {
    sessions[o.report.session_id] = listFactsOf(o.report);
  }
  return {
    ok: true,
    ...toGuardianExamList(forms, sessions),
    requestId: "r",
  };
}

/**
 * Answers `GET /api/students/:studentId/tests/:sessionId/report` for each report, through the
 * real guardian projection — the route the card reads every score from (G5-09).
 */
export function serveReports(
  studentId: string,
  reports: readonly ExamReportPayload[],
): Handler {
  return (url) => {
    for (const r of reports) {
      if (url === `/api/students/${studentId}/tests/${r.session_id}/report`) {
        return json({
          ok: true,
          report: toGuardianExamReport(r),
          requestId: "r",
        });
      }
    }
    return undefined;
  };
}

/**
 * THE BOARD SCENARIO — the values on the canvas boards "Wave 5 — BUILD TARGET" (a real
 * student's numbers on 2026-10-02, per the owner brief; the student's name is not carried),
 * built through the same schemas and projections as the shared scenario, so the review
 * screenshots can sit beside the boards number for number. Used only by the Playwright
 * screenshot run (`tests/e2e/guardian-harness/fixtures.ts` → `board`).
 */
export function boardScenario(today: string = browserLocalToday()): {
  calendarWeek: Record<string, unknown>;
  masteryDomains: Record<string, unknown>;
  examList: Record<string, unknown>;
  examReports: Record<string, Record<string, unknown>>;
} {
  const { ok, requestId, ...week } = calendarWeek({
    today,
    completed: 2,
    total: 15,
    targetScore: 1400,
    testDate: addDays(today, 64),
  });
  const projection = (
    [
      ["RW", 280, 380, 480],
      ["M", 340, 430, 520],
    ] as const
  ).map(([section, low, mid, high]) => ({
    section,
    projectedScoreLow: low,
    projectedScoreMid: mid,
    projectedScoreHigh: high,
    relevantQuestionCount: 40,
    computedAt: `${today}T00:00:00Z`,
  }));
  const calendar = {
    ok,
    ...guardianCalendarResponseSchema.parse({
      ...week,
      projection,
      streak: { current: 3, longest: 3, history_complete: true },
    }),
    requestId,
  };
  const level = (
    section: "RW" | "M",
    domain: string,
    key: "L1" | "L2" | "L3",
  ): Record<string, unknown> => ({
    section,
    domain,
    levelKey: key,
    level: Number(key.slice(1)),
    displayName: { L1: "Building", L2: "Developing", L3: "Proficient" }[key],
  });
  const mastery = masteryDomainsResponseSchema.parse({
    ok: true,
    domains: [
      level("RW", "Craft and Structure", "L1"),
      level("RW", "Information and Ideas", "L1"),
      level("RW", "Standard English Conventions", "L1"),
      level("RW", "Expression of Ideas", "L2"),
      level("M", "Algebra", "L2"),
      level("M", "Advanced Math", "L2"),
      level("M", "Problem Solving and Data Analysis", "L3"),
      level("M", "Geometry and Trigonometry", "L1"),
    ],
  });
  const latest = scoredReportFor({
    session_id: scoredReport.session_id,
    name: "Full-Length Practice Test 2",
    completed_at: `${addDays(today, -2)}T16:00:00Z`,
    rw: 220,
    math: 240,
  });
  const previous = scoredReportFor({
    session_id: "5e551011-0000-4000-8000-0000000001b1",
    name: "Full-Length Practice Test 1",
    completed_at: `${addDays(today, -16)}T16:00:00Z`,
    rw: 240,
    math: 260,
  });
  return {
    calendarWeek: calendar,
    masteryDomains: mastery,
    examList: examListWith([{ report: previous }], latest),
    // G5-09: every score on the card comes from these, by session id — at most two reads.
    examReports: Object.fromEntries(
      [latest, previous].map((r) => [
        r.session_id,
        { ok: true, report: toGuardianExamReport(r), requestId: "r" },
      ]),
    ),
  };
}

/** The guardian exam list with no attempts, through the real projection. */
export function noExams(): Record<string, unknown> {
  return {
    ok: true,
    ...toGuardianExamList({ forms: [] }, {}),
    requestId: "r",
  };
}

/** The guardian exam report, through the real projection (bars only, SCL-189). */
export function examReport(): Record<string, unknown> {
  return {
    ok: true,
    report: toGuardianExamReport(scoredReport),
    requestId: "r",
  };
}

/** Answers every Dashboard read for `studentId` with its payload. */
export function serveDashboard(studentId: string): Handler {
  return (url) => {
    const base = `/api/students/${studentId}`;
    if (url.startsWith(`${base}/calendar?`)) return json(calendarWeek());
    if (url === `${base}/mastery/domains`) return json(masteryDomains());
    if (url === `${base}/tests`) return json(examList());
    if (url === `${base}/tests/${EXAM_SESSION}/report`)
      return json(examReport());
    return undefined;
  };
}

/**
 * The guardian branch of `GET /api/billing/status`, through the shared schema (G4-09) — the
 * same keys the route writes, which `identity-entitlement.contract.test.ts` holds it to.
 */
export function billingStatus(
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return billingStatusResponseSchema.parse({
    plan: "premium",
    stripeStatus: "active",
    currentPeriodEnd: null,
    stripeSubscriptionId: null,
    effectiveAccess: true,
    hasActiveLink: true,
    needsPaymentUpdate: false,
    lapsed: false,
    hasBillingAccount: true,
    isPaid: true,
    source: "guardian_linked_student",
    managedBy: "self",
    requestId: "r",
    ...over,
  });
}
