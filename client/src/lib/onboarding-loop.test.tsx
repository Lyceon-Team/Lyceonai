// @vitest-environment jsdom
/**
 * The 2026-10-11 login/dashboard reload loop, reproduced end to end and pinned shut.
 *
 * @spec [Doc-01_V8 §9 (server-side profile soft-gate); contracts/auth-standard-flow.contract.md
 *        AS-3; hotfix 2026-10-11 (owner brief: one definition of "profile complete", admins
 *        exempt, no full-page reload, a loop guard)] | @implemented [2026-10-11]
 *
 * plain English: the real client gate (`RequireRole`), the real completion page
 * (`ProfileComplete`) and a dashboard read sit on the app's own query client, against a fake API
 * whose learning endpoints answer through the REAL server middleware (`requireProfileComplete`,
 * then `requireGuardianLinkForUnder13`) for the account under test, and whose `/api/profile`
 * answers as the profile route does. A full-page navigation (`navigation.assign`) is emulated
 * as what it is in a browser: the URL changes and the whole app mounts again on an empty cache.
 *
 * Production evidence (Vercel, 2026-10-11 21:15Z): an admin with a date of birth and
 * `profile_completed_at` NULL loaded /dashboard, the dashboard's practice reads came back 403
 * PROFILE_INCOMPLETE, the query client reloaded the page onto /profile/complete, the completion
 * page sent the admin back to /dashboard, and around again, every ~1.5s.
 *
 * For each account the app may visit /profile/complete at most ONCE, and must come to rest:
 *   - the admin rests on the dashboard;
 *   - a student with a date of birth but no completion timestamp rests on the completion form;
 *   - a student with no date of birth rests on the completion form, and stays there.
 */
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isProfileGateSatisfied } from "@lyceon/shared/profile-completion";

type Account = {
  id: string;
  role: "student" | "admin";
  dateOfBirth: string | null;
  profileCompletedAt: string | null;
};

const harness = vi.hoisted(() => ({
  account: null as Account | null,
  practiceReads: 0,
}));

// ── The fake API: practice through the real server gates, /api/profile as the route builds it ──
async function runServerGates(
  account: Account,
): Promise<{ status: number; body: unknown }> {
  const { requireProfileComplete, requireGuardianLinkForUnder13 } =
    await import("../../../server/middleware/supabase-auth");
  const isUnder13 =
    account.dateOfBirth === null
      ? null
      : new Date().getFullYear() - new Date(account.dateOfBirth).getFullYear() <
        13;
  const req = {
    user: {
      id: account.id,
      role: account.role,
      isAdmin: account.role === "admin",
      isGuardian: false,
      profile_completed_at: account.profileCompletedAt,
      is_under_13: isUnder13,
    },
    path: "/api/practice/quota",
    requestId: "req-loop",
    headers: {},
  } as unknown as Request;
  let status = 200;
  let body: unknown = { ok: true };
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  } as unknown as Response;
  const chain = [requireProfileComplete, requireGuardianLinkForUnder13];
  for (const gate of chain) {
    let passed = false;
    await gate(req, res, (() => {
      passed = true;
    }) as NextFunction);
    if (!passed) return { status, body };
  }
  return { status: 200, body: { ok: true } };
}

function json(status: number, body: unknown): Response {
  return new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (input: string) => {
    const account = harness.account!;
    const path = String(input).split("?")[0];
    if (path === "/api/profile") {
      return json(200, {
        authenticated: true,
        featureAccess: null,
        user: {
          id: account.id,
          email: "loop@example.com",
          display_name: "Loop",
          role: account.role,
          isAdmin: account.role === "admin",
          dateOfBirth: account.dateOfBirth,
          marketingOptIn: null,
          profileCompletedAt: account.profileCompletedAt,
          // The profile route's own answer (server/routes/profile-routes.ts).
          requiredProfileComplete: isProfileGateSatisfied({
            isAdmin: account.role === "admin",
            profileCompletedAt: account.profileCompletedAt,
          }),
          guardianConsentRequired: false,
          outstandingLegal: [],
          hasPassword: true,
        },
      });
    }
    if (path.startsWith("/api/practice/")) {
      harness.practiceReads += 1;
      const answer = await runServerGates(account);
      return json(answer.status, answer.body);
    }
    return json(404, { error: "not in harness" });
  },
  getCsrfToken: async () => "t",
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => {
    const account = harness.account!;
    return {
      user: { id: account.id, role: account.role, email: "loop@example.com" },
      authLoading: false,
      isAdmin: account.role === "admin",
      isGuardian: false,
      accountUnavailable: false,
      refreshUser: async () => undefined,
      signOut: async () => undefined,
    };
  },
}));

vi.mock("@/lib/signed-in-surface", () => ({
  enterSignedInSurface: () => () => undefined,
}));

import { RequireRole } from "@/components/auth/RequireRole";
import ProfileComplete from "@/pages/profile-complete";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "./api-error";
import { navigation, queryClient } from "./queryClient";

/** The dashboard's two practice reads, as the production log shows them. */
function Dashboard(): JSX.Element {
  const read = (path: string) => async () => {
    const r = await csrfFetch(path);
    if (!r.ok) throw await parseApiErrorFromResponse(r, "Refused");
    return r.json() as Promise<unknown>;
  };
  useQuery({
    queryKey: ["/api/practice/quota"],
    queryFn: read("/api/practice/quota"),
  });
  useQuery({
    queryKey: ["/api/practice/sessions/open"],
    queryFn: read("/api/practice/sessions/open"),
  });
  return <div data-testid="dashboard">dashboard</div>;
}

function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Switch>
          <Route path="/dashboard">
            <RequireRole allow={["student", "admin"]}>
              <Dashboard />
            </RequireRole>
          </Route>
          <Route path="/profile/complete">
            <RequireRole allow={["student", "guardian", "admin"]}>
              <ProfileComplete />
            </RequireRole>
          </Route>
        </Switch>
      </Router>
    </QueryClientProvider>
  );
}

/** Every URL the app was on, in order: in-app history writes and emulated full reloads. */
let visited: string[] = [];
let reloadTo: string | null = null;
let reloads = 0;

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

/** Mount at `start`, then follow full reloads the way a browser would (capped, so a loop ends). */
async function run(account: Account, start = "/dashboard"): Promise<void> {
  harness.account = account;
  window.history.replaceState({}, "", start);
  render(<App />);
  await settle();
  while (reloadTo !== null && reloads < 6) {
    const to = reloadTo;
    reloadTo = null;
    cleanup();
    queryClient.clear();
    window.history.replaceState({}, "", to);
    render(<App />);
    await settle();
  }
}

const origPush = window.history.pushState.bind(window.history);
const origReplace = window.history.replaceState.bind(window.history);

beforeEach(() => {
  visited = [];
  reloadTo = null;
  reloads = 0;
  harness.practiceReads = 0;
  queryClient.clear();
  window.sessionStorage.clear();
  window.history.pushState = (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) => {
    if (url) visited.push(new URL(String(url), window.location.href).pathname);
    origPush(data, unused, url);
  };
  window.history.replaceState = (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) => {
    if (url) visited.push(new URL(String(url), window.location.href).pathname);
    origReplace(data, unused, url);
  };
  vi.spyOn(navigation, "assign").mockImplementation((path: string) => {
    reloads += 1;
    reloadTo = path;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState = origPush;
  window.history.replaceState = origReplace;
  queryClient.clear();
});

const toCompletion = () =>
  visited.filter((p) => p === "/profile/complete").length;

describe("no login/dashboard reload loop (hotfix 2026-10-11)", () => {
  it("an admin with a date of birth and profile_completed_at NULL rests on the dashboard", async () => {
    await run({
      id: "08af8504-0000-4000-8000-000000000001",
      role: "admin",
      dateOfBirth: "1990-01-01",
      profileCompletedAt: null,
    });
    expect({ reloads, toCompletion: toCompletion() }).toEqual({
      reloads: 0,
      toCompletion: 0,
    });
    expect(window.location.pathname).toBe("/dashboard");
    expect(screen.getByTestId("dashboard")).toBeTruthy();
  });

  it("a student with a date of birth but no completion timestamp lands on the form once and stays", async () => {
    await run({
      id: "0c0c0c0c-0000-4000-8000-000000000002",
      role: "student",
      dateOfBirth: "2009-05-05",
      profileCompletedAt: null,
    });
    expect(reloads).toBe(0);
    expect(toCompletion()).toBeLessThanOrEqual(1);
    expect(window.location.pathname).toBe("/profile/complete");
    expect(screen.queryByTestId("dashboard")).toBeNull();
  });

  it("a student with no date of birth lands on the completion form and stays there", async () => {
    await run({
      id: "0c0c0c0c-0000-4000-8000-000000000003",
      role: "student",
      dateOfBirth: null,
      profileCompletedAt: null,
    });
    expect(reloads).toBe(0);
    expect(toCompletion()).toBeLessThanOrEqual(1);
    expect(window.location.pathname).toBe("/profile/complete");
    // the form itself, not a redirect: the date-of-birth field is on screen
    expect(document.querySelector('input[type="date"]')).not.toBeNull();
    // and a second settle moves nothing
    await settle();
    expect(window.location.pathname).toBe("/profile/complete");
    expect(toCompletion()).toBeLessThanOrEqual(1);
  });
});
