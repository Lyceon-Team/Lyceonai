// @vitest-environment jsdom
/**
 * @spec [student-ui register UI-14 — "a /dashboard load requests each endpoint once";
 *        Coding Standards §11.2] | @implemented [2026-09-29]
 *
 * plain English: renders the REAL app — `App.tsx`, the real `SupabaseAuthProvider`, the real
 * `RequireRole`, the real shared `queryClient` and its defaults — at `/dashboard` and at
 * `/guardian`, with only `fetch` replaced, and counts the requests each endpoint received.
 *
 * WHY THE WHOLE APP AND NOT THE HOOKS. The duplicate profile read lived BETWEEN two modules:
 * the auth provider's plain fetch and the route guard's query. Each module's own test was
 * green. Only a render that mounts both, in the order the app mounts them, sees two requests.
 *
 * Fixture bodies carry the fields the routes write (`server/routes/profile-routes.ts` GET,
 * `server/routes/billing-routes.ts` `/status`, both branches), because the guard routes on them:
 * a profile missing `profileCompletedAt` would redirect to onboarding and never mount the
 * dashboard, and the test would count the wrong page.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { queryClient } from "@/lib/queryClient";

type Role = "student" | "guardian";

function profileBody(role: Role): Record<string, unknown> {
  return {
    authenticated: true,
    featureFlags: { accountDeletionLifecycleV2: false },
    pendingDeletion: null,
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "learner@example.test",
      display_name: "Learner",
      name: "Learner",
      username: "learner",
      role,
      isAdmin: false,
      isGuardian: role === "guardian",
      is_under_13: false,
      guardian_consent: false,
      dateOfBirth: null,
      marketingOptIn: false,
      profileCompletedAt: "2026-09-01T00:00:00.000Z",
      requiredProfileComplete: true,
      guardianConsentRequired: false,
      outstandingLegal: [],
    },
  };
}

function billingBody(role: Role): Record<string, unknown> {
  const common = {
    plan: "free",
    stripeStatus: "missing",
    currentPeriodEnd: null,
    stripeSubscriptionId: null,
    effectiveAccess: false,
    needsPaymentUpdate: false,
    lapsed: false,
    hasBillingAccount: false,
    isPaid: false,
    requestId: "req-test",
  };
  return role === "guardian"
    ? { ...common, hasActiveLink: false, source: "guardian_linked_student" }
    : common;
}

let role: Role = "student";
const requests: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pathOf(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return new URL(raw, "http://localhost").pathname;
}

const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const path = pathOf(input);
  requests.push(path);
  switch (path) {
    case "/api/csrf-token":
      return json({ csrfToken: "csrf-test" });
    case "/api/profile":
      return json(profileBody(role));
    case "/api/billing/status":
      return json(billingBody(role));
    case "/api/progress/projection":
      // `baseline_only` is the state in which the dashboard mounts PremiumUpgradePrompt,
      // which is the dashboard's billing-status reader.
      // Shape per `EstimateResponse` (client/src/lib/projectionApi.ts), baseline_only arm.
      return json({
        estimateStatus: "baseline_only",
        cta: true,
        estimate: null,
        baseline: {
          composite: 1100,
          math: 550,
          rw: 550,
          range: { low: 1050, high: 1150 },
          confidenceBand: "low",
          capturedAt: "2026-09-01T00:00:00.000Z",
        },
        totalQuestionsAttempted: 20,
        lastUpdated: "2026-09-01T00:00:00.000Z",
        entitlement: {
          hasPaidAccess: false,
          plan: "free",
          status: "missing",
          reason: "no_entitlement",
          currentPeriodEnd: null,
        },
      });
    case "/api/progress/kpis":
      return json({ week: { accuracy: 0, questionsSolved: 0 }, metrics: [] });
    case "/api/guardian/students":
      return json({ students: [] });
    default:
      return json({});
  }
});

function count(path: string): number {
  return requests.filter((p) => p === path).length;
}

// Generous: the lazy route chunk is compiled on first import, which under a loaded CI runner
// takes seconds. A timeout here is not a count, and must not read as one.
const WAIT = { timeout: 15_000 };
const TEST_TIMEOUT_MS = 30_000;

function renderAt(path: string): void {
  window.history.pushState({}, "", path);
  render(<App />);
}

/**
 * Once the page has mounted, let every query it mounts settle — including ones enabled only
 * after the auth provider resolves. Counting before that would undercount.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
}

beforeEach(() => {
  requests.length = 0;
  queryClient.clear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
});

describe("UI-14: one request per endpoint on page load", () => {
  it(
    "a signed-in /dashboard load requests /api/profile ONCE and /api/billing/status ONCE",
    async () => {
      role = "student";
      renderAt("/dashboard");

      // Presence first: the dashboard itself mounted, so the counts below are the dashboard's.
      await waitFor(
        () =>
          expect(screen.getByTestId("page-title").textContent).toContain(
            "Welcome back",
          ),
        WAIT,
      );
      await waitFor(
        () =>
          expect(
            screen.getByTestId("premium-upgrade-prompt"),
          ).toBeInTheDocument(),
        WAIT,
      );
      await settle();

      expect({
        profile: count("/api/profile"),
        billingStatus: count("/api/billing/status"),
      }).toEqual({ profile: 1, billingStatus: 1 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a signed-in /guardian load requests /api/billing/status ONCE across the dashboard and the checkout poller",
    async () => {
      role = "guardian";
      renderAt("/guardian");

      await waitFor(
        () => expect(count("/api/billing/status")).toBeGreaterThan(0),
        WAIT,
      );
      await settle();

      expect({
        profile: count("/api/profile"),
        billingStatus: count("/api/billing/status"),
      }).toEqual({ profile: 1, billingStatus: 1 });
    },
    TEST_TIMEOUT_MS,
  );
});
