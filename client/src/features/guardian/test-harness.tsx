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

export const ADA = "33333333-3333-4333-8333-333333333333";
export const BO = "44444444-4444-4444-8444-444444444444";
export const CY = "55555555-5555-4555-8555-555555555555";

export type Roster = ReturnType<typeof guardianStudentsResponseSchema.parse>;

/** Roster entries through the shared contract. `lapsed` students have ended subscriptions. */
export function roster(
  entries: ReadonlyArray<{ id: string; name: string; lapsed?: boolean }>,
): Roster {
  return guardianStudentsResponseSchema.parse({
    students: entries.map((e) => ({
      id: e.id,
      email: `${e.name.toLowerCase()}@example.test`,
      display_name: e.name,
      created_at: "2026-09-01T00:00:00.000Z",
      has_active_entitlement: e.lapsed !== true,
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
