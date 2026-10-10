// @vitest-environment jsdom
/**
 * The client half of the role round trip: what goes on the wire.
 *
 * @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rule 2] |
 * @implemented [2026-10-10]
 *
 * plain English: the REAL auth provider. The email sign-up's request body carries `role` only
 * when the form gave one; the Google sign-in's `redirectTo` carries `role` beside `next`, the
 * same way `next` rides it, so the server callback can read both. The server half (the account
 * created is a guardian) is tests/ci/signup-role-intent.pg.ci.test.ts.
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ bodies: [] as unknown[] }));
const oauth = vi.hoisted(() => ({
  calls: [] as { provider: string; options: { redirectTo: string } }[],
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function scriptedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  if (url === "/api/csrf-token") return json({ csrfToken: "t" });
  if (url === "/api/auth/signup") {
    sent.bodies.push(JSON.parse(String(init?.body)));
    return json({ outcome: "verification_required", message: "verify" }, 202);
  }
  if (url === "/api/profile") return json({ authenticated: false }, 401);
  throw new Error(`unscripted ${url}`);
}

vi.mock("@/lib/supabase", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      signInWithOAuth: async (args: {
        provider: string;
        options: { redirectTo: string };
      }) => {
        oauth.calls.push(args);
        return { error: null };
      },
    },
  }),
}));
vi.mock("@/components/legal/reconsent-dismissal", () => ({
  clearReconsentDismissal: vi.fn(),
}));

import {
  SupabaseAuthProvider,
  useSupabaseAuth,
} from "@/contexts/SupabaseAuthContext";
import { clearCsrfToken } from "@/lib/csrf";

let auth: ReturnType<typeof useSupabaseAuth> | null = null;
function Probe(): null {
  auth = useSupabaseAuth();
  return null;
}

async function mount(): Promise<void> {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SupabaseAuthProvider>
        <Probe />
      </SupabaseAuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(auth?.authLoading).toBe(false));
}

describe("role intent on the wire", () => {
  beforeEach(() => {
    sent.bodies.length = 0;
    oauth.calls.length = 0;
    auth = null;
    clearCsrfToken();
    vi.stubGlobal("fetch", vi.fn(scriptedFetch));
    window.history.replaceState(
      {},
      "",
      "/login?mode=signup&role=guardian&next=%2Fguardian",
    );
  });

  it("the email sign-up body carries role guardian", async () => {
    await mount();
    await act(async () => {
      await auth!.signUp(
        "pat@example.test",
        "correct-horse-9",
        { consentSource: "email_signup_form" },
        "Pat",
        "guardian",
      );
    });
    expect(sent.bodies).toHaveLength(1);
    expect(sent.bodies[0]).toMatchObject({ role: "guardian" });
  });

  it("no role intent sends no role key at all", async () => {
    await mount();
    await act(async () => {
      await auth!.signUp(
        "sam@example.test",
        "correct-horse-9",
        { consentSource: "email_signup_form" },
        "Sam",
        null,
      );
    });
    expect(sent.bodies).toHaveLength(1);
    expect(Object.keys(sent.bodies[0] as object)).not.toContain("role");
  });

  it("Google's redirectTo carries role beside next", async () => {
    await mount();
    await act(async () => {
      await auth!.signInWithGoogle(
        { consentSource: "google_continue_click" },
        "guardian",
      );
    });
    expect(oauth.calls).toHaveLength(1);
    const redirect = new URL(oauth.calls[0]?.options.redirectTo ?? "");
    expect(redirect.pathname).toBe("/auth/callback");
    expect(redirect.searchParams.get("role")).toBe("guardian");
    expect(redirect.searchParams.get("next")).toBe("/guardian");
  });

  it("Google without a role intent sends no role", async () => {
    await mount();
    await act(async () => {
      await auth!.signInWithGoogle(
        { consentSource: "google_continue_click" },
        null,
      );
    });
    const redirect = new URL(oauth.calls[0]?.options.redirectTo ?? "");
    expect(redirect.searchParams.has("role")).toBe(false);
  });
});
