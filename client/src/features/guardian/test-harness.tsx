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
import { billingStatusResponseSchema } from "@lyceon/shared/billing-schema";
import { masteryDomainsResponseSchema } from "@lyceon/shared/mastery-levels";
import {
  toGuardianExamList,
  toGuardianExamReport,
} from "@lyceon/shared/exam-guardian-report-schema";
import {
  FIXTURE_SESSION_ID,
  formsListing,
  scoredReport,
} from "@/features/exam/test-fixtures/report-fixtures";

export const ADA = "33333333-3333-4333-8333-333333333333";
export const BO = "44444444-4444-4444-8444-444444444444";
export const CY = "55555555-5555-4555-8555-555555555555";

export type Roster = ReturnType<typeof guardianStudentsResponseSchema.parse>;

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

export type Handler = (
  url: string,
  init: RequestInit | undefined,
) => Response | undefined;

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
      <WouterRouter hook={location.hook}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>,
  );
  return { history: location.history, client };
}

// ── Per-student payloads, each through its shared schema or the real projection ──────────

export const EXAM_SESSION = FIXTURE_SESSION_ID;

/** A ready guardian calendar week, parsed by the schema the client parses it with. */
export function calendarWeek(
  over: {
    streak?: number | null;
    completed?: number;
    total?: number;
    targetScore?: number | null;
    testDate?: string | null;
  } = {},
): Record<string, unknown> {
  const payload = guardianCalendarResponseSchema.parse({
    status: "ready",
    target_score: over.targetScore === undefined ? 1350 : over.targetScore,
    target_exam_date:
      over.testDate === undefined ? "2026-12-06" : over.testDate,
    projection: [
      {
        section: "RW",
        projectedScoreLow: 590,
        projectedScoreMid: 620,
        projectedScoreHigh: 650,
        relevantQuestionCount: 40,
        computedAt: "2026-09-29T00:00:00Z",
      },
      {
        section: "M",
        projectedScoreLow: 590,
        projectedScoreMid: 610,
        projectedScoreHigh: 610,
        relevantQuestionCount: 40,
        computedAt: "2026-09-29T00:00:00Z",
      },
    ],
    estimates: { practice_seconds_per_unit: 90, review_seconds_per_unit: 60 },
    full_length_suppressions: [],
    days: [],
    facts: {
      blocks_total: over.total ?? 6,
      blocks_completed: over.completed ?? 4,
      blocks_partial: 0,
      blocks_missed: 1,
      blocks_in_progress: 0,
      blocks_scheduled: 1,
      questions_completed: 80,
      full_lengths_completed: 0,
      extra_questions: 5,
    },
    streak: {
      current: over.streak === undefined ? 12 : over.streak,
      longest: 19,
      history_complete: false,
    },
  });
  return { ok: true, ...payload, requestId: "r" };
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

/** The guardian exam list, through the real projection (SCL-192 `completed_at`). */
export function examList(): Record<string, unknown> {
  return {
    ok: true,
    ...toGuardianExamList(formsListing, {
      [FIXTURE_SESSION_ID]: "2026-09-20T15:00:00.000Z",
    }),
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
    requestId: "r",
    ...over,
  });
}
