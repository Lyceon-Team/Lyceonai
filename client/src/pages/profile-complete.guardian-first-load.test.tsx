// @vitest-environment jsdom
/**
 * G-NEW-03 — a new guardian's first load reaches /guardian without touching a student route.
 *
 * @spec [Guardian_Closure_Plan G-NEW-03 named proof: "an RTL test: the guardian first-load path
 *       makes zero requests to student-only routes"; G1-02 (refresh the session role before
 *       navigating)] | @implemented [2026-09-30]
 *
 * plain English: the REAL route switch and the REAL app query client, from /profile/complete
 * through a guardian's completion. Only the network (`csrfFetch`) and the auth context are
 * scripted — and the auth context behaves as the real one does: its role stays the
 * pre-completion "student" until `refreshUser()` has run.
 *
 * THE RACE THIS PINS (production, 2026-09-29 07:44Z: `GET /api/progress/kpis` and
 * `/api/progress/projection` twice each, both 403 `guardian_blocked`). On success the page
 * invalidated its own `/api/profile` query BEFORE refreshing the session role. The refetch
 * answered "completed guardian", so the page's own render-time `<Redirect to="/guardian">`
 * fired while the auth context still said student — `RequireRole` bounced the new guardian to
 * /dashboard, whose student widgets made those reads. The fix holds the render-time redirect
 * while the completion is in flight, so the one navigation is the post-refresh one.
 */
import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The auth context's state, as the real provider holds it: changed only by refreshUser. */
const auth = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { role: "student" as "student" | "guardian", version: 0 };
  return {
    state,
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(role: "student" | "guardian"): void {
      state.role = role;
      state.version += 1;
      listeners.forEach((fn) => fn());
    },
  };
});

/** The scripted server. `completed` flips when the PATCH lands. */
const server = vi.hoisted(() => ({ completed: false, log: [] as string[] }));

vi.mock("@/contexts/SupabaseAuthContext", async () => {
  const react = await import("react");
  return {
    useSupabaseAuth: () => {
      react.useSyncExternalStore(auth.subscribe, () => auth.state.version);
      const role = auth.state.role;
      return {
        user: { id: "guardian-1", email: "g@example.test", role },
        isLoading: false,
        authLoading: false,
        isAuthenticated: true,
        isGuardian: role === "guardian",
        isAdmin: false,
        accountUnavailable: false,
        signOut: vi.fn(async () => undefined),
        refreshUser: vi.fn(async () => {
          // The real refresh is a network round trip that re-reads /api/profile. What
          // matters is that the role only changes here, and not instantly: at 20ms the stale
          // window was too short to show the race; at 400ms it reproduces the production pair.
          await new Promise((r) => setTimeout(r, 400));
          auth.set(server.completed ? "guardian" : "student");
        }),
      };
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));
vi.mock("@/lib/csrf", () => {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  return {
    getCsrfToken: vi.fn(async () => "t"),
    clearCsrfToken: vi.fn(),
    csrfFetch: vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      server.log.push(`${method} ${url}`);
      if (url === "/api/profile" && method === "PATCH") {
        server.completed = true;
        return json({
          success: true,
          profile: {
            role: "guardian",
            profileCompletedAt: "2026-09-30T00:00:00Z",
          },
          guardianConsentRequired: false,
        });
      }
      if (url === "/api/profile") {
        return json({
          authenticated: true,
          user: {
            role: server.completed ? "guardian" : "student",
            requiredProfileComplete: server.completed,
            profileCompletedAt: server.completed
              ? "2026-09-30T00:00:00Z"
              : null,
            guardianConsentRequired: false,
          },
        });
      }
      if (url === "/api/guardian/students") return json({ students: [] });
      // Every other read — student routes included — answers as the server would to a
      // guardian: refused. The assertion is that none is made.
      return json({ error: "Forbidden", code: "guardian_blocked" }, 403);
    }),
  };
});

const { Router } = await import("@/App");
const { queryClient } = await import("@/lib/queryClient");

/** Routes that only ever serve a student's own learning state. */
const STUDENT_ONLY =
  /^(GET|POST|PATCH|PUT|DELETE) \/api\/(progress|practice|review|tutor|chat|calendar|tests|mastery|diagnostic)\b/;

beforeEach(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
  server.completed = false;
  server.log.length = 0;
  auth.set("student");
  queryClient.clear();
});
afterEach(() => queryClient.clear());

describe("G-NEW-03 a new guardian's first load", () => {
  it("completes the profile and lands on /guardian with zero student-only requests", async () => {
    const location = memoryLocation({
      path: "/profile/complete",
      record: true,
    });
    render(
      <QueryClientProvider client={queryClient}>
        <WouterRouter hook={location.hook}>
          <Router />
        </WouterRouter>
      </QueryClientProvider>,
    );

    const trigger = await screen.findByTestId("select-role");
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Guardian" }));
    fireEvent.change(screen.getByTestId("input-display-name"), {
      target: { value: "Pat Parent" },
    });
    fireEvent.change(screen.getByTestId("input-date-of-birth"), {
      target: { value: "1980-05-01" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-complete-profile"));
    });

    // Presence first: the guardian arrived.
    await waitFor(() => expect(location.history.at(-1)).toMatch(/^\/guardian/));
    expect(await screen.findByTestId("guardian-no-students")).toBeTruthy();
    // Let anything a wrong page would have fetched settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(server.log).toContain("PATCH /api/profile");
    expect(server.log.filter((l) => STUDENT_ONLY.test(l))).toEqual([]);
    // (The bounce to /dashboard used `replace`, so it never shows in history; the requests
    // above are what give it away, as they did in production.)
  });
});
