// @vitest-environment jsdom
/**
 * G1-03 — one browser tab, two guardians: A's cached roster must never render for B.
 *
 * @spec [Guardian_Closure_Plan G1-03 named proof (1); audit G-AUD-01] | @implemented [2026-09-29]
 *
 * plain English: mounts the REAL `SupabaseAuthProvider` and the REAL `useGuardianStudents`
 * hook under one real React Query client, exactly as the app does (`staleTime: Infinity`).
 * Only the network is scripted: `/api/profile` answers for whoever is "signed in", and
 * `/api/guardian/students` answers with that guardian's roster — B's roster is HELD until the
 * test releases it, which is the window a stale cache would render A's names into.
 *
 * The roster component records every name it ever renders. The assertion is over that whole
 * log, so a single-frame flash of A's student counts as a failure.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const GUARDIAN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GUARDIAN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const net = vi.hoisted(() => ({
  signedIn: null as string | null,
  releaseB: null as null | (() => void),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function roster(id: string, name: string) {
  return {
    students: [
      {
        id,
        email: `${name.toLowerCase().replace(" ", ".")}@example.test`,
        display_name: name,
        created_at: "2026-09-01T00:00:00.000Z",
        has_active_entitlement: true,
        entitlement_lapsed: false,
      },
    ],
    requestId: "g1-03",
  };
}

vi.mock("@/lib/csrf", () => ({
  getCsrfToken: vi.fn(async () => "t"),
  clearCsrfToken: vi.fn(),
  csrfFetch: vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/signout") {
      net.signedIn = null;
      return json({ ok: true });
    }
    if (url === "/api/auth/signin") {
      const body = JSON.parse(String(init?.body)) as { email: string };
      net.signedIn = body.email.startsWith("a@") ? GUARDIAN_A : GUARDIAN_B;
      return json({ ok: true });
    }
    if (url === "/api/profile") {
      if (!net.signedIn) return json({ authenticated: false }, 401);
      return json({
        user: {
          id: net.signedIn,
          email:
            net.signedIn === GUARDIAN_A ? "a@example.test" : "b@example.test",
          display_name:
            net.signedIn === GUARDIAN_A ? "Guardian A" : "Guardian B",
          role: "guardian",
        },
      });
    }
    if (url === "/api/guardian/students") {
      if (net.signedIn === GUARDIAN_A) {
        return json(
          roster("11111111-1111-4111-8111-111111111111", "Alice Achild"),
        );
      }
      // B's roster is held: this is the window a stale cache renders into.
      await new Promise<void>((resolve) => {
        net.releaseB = resolve;
      });
      return json(
        roster("22222222-2222-4222-8222-222222222222", "Bobby Bchild"),
      );
    }
    throw new Error(`unscripted request ${url}`);
  }),
}));
vi.mock("@/lib/supabase", () => ({ getSupabaseBrowserClient: () => ({}) }));
vi.mock("@/components/legal/reconsent-dismissal", () => ({
  clearReconsentDismissal: vi.fn(),
}));

import { SupabaseAuthProvider, useSupabaseAuth } from "./SupabaseAuthContext";
import { useGuardianStudents } from "@/hooks/useGuardianStudents";

const rendered: string[] = [];

function Roster(): JSX.Element {
  const { data } = useGuardianStudents();
  for (const s of data?.students ?? []) rendered.push(s.display_name ?? "");
  return (
    <ul>
      {(data?.students ?? []).map((s) => (
        <li key={s.id}>{s.display_name}</li>
      ))}
    </ul>
  );
}

let auth: ReturnType<typeof useSupabaseAuth> | null = null;
function Harness(): JSX.Element {
  auth = useSupabaseAuth();
  return auth.user ? <Roster /> : <p>signed out</p>;
}

describe("G1-03 cache isolation across sign-out / sign-in in one tab", () => {
  it("guardian B never sees guardian A's student, not even for a frame", async () => {
    // The app's own defaults: data never goes stale on its own.
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    net.signedIn = GUARDIAN_A;

    render(
      <QueryClientProvider client={client}>
        <SupabaseAuthProvider>
          <Harness />
        </SupabaseAuthProvider>
      </QueryClientProvider>,
    );

    // Presence first: A's student really did render, so the absence below means something.
    expect(await screen.findByText("Alice Achild")).toBeInTheDocument();

    await act(async () => {
      await auth!.signOut();
    });
    expect(await screen.findByText("signed out")).toBeInTheDocument();

    rendered.length = 0;
    await act(async () => {
      await auth!.signIn("b@example.test", "pw");
    });
    await waitFor(() => expect(net.releaseB).not.toBeNull());

    // B's roster is still in flight. Nothing of A's may be on screen, or have been.
    expect(screen.queryByText("Alice Achild")).toBeNull();

    await act(async () => {
      net.releaseB!();
    });
    expect(await screen.findByText("Bobby Bchild")).toBeInTheDocument();
    expect(rendered).not.toContain("Alice Achild");
  });
});
