// @vitest-environment jsdom
/**
 * G-NEW-12 — the first write after sign-up succeeds first time, with no CSRF retry.
 *
 * @spec [Guardian_Closure_Plan G-NEW-12; production 2026-09-30 02:22:40Z: PATCH /api/profile
 *       403 for profile d708ede4 (request 6b0dd278), unlogged, then 200 on a retry 0.3s later]
 *       | @implemented [2026-09-30]
 *
 * plain English: the CSRF token is an HMAC over a session identifier — the access token when
 * there is one, the IP when there is not (`server/middleware/csrf-double-submit.ts`). A token
 * minted before sign-up is therefore dead the moment sign-up sets a session. `signIn` already
 * drops the cached token; `signUp` did not, so the first write after sign-up failed the check,
 * and `csrfFetch` fetched a new token and retried. This mounts the REAL `SupabaseAuthProvider`
 * and the REAL `@/lib/csrf` over a scripted server that binds each token to the identifier it
 * was minted for, exactly as `csrf-csrf` does, and asserts the profile write goes out ONCE.
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  /** The session identifier csrf-csrf would derive: the access token, or the IP without one. */
  session: null as string | null,
  minted: 0,
  log: [] as string[],
}));

const identifier = (): string => server.session ?? "ip:203.0.113.7";

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
  const method = (init?.method ?? "GET").toUpperCase();
  server.log.push(`${method} ${url}`);
  const token = new Headers(init?.headers).get("x-csrf-token");
  const tokenValid = token !== null && token.endsWith(`|${identifier()}`);

  if (url === "/api/csrf-token") {
    server.minted += 1;
    return json({ csrfToken: `t${server.minted}|${identifier()}` });
  }
  if (method !== "GET" && !tokenValid) {
    // The final error handler's answer to csrf-csrf's invalid-token error.
    return json({ error: { code: "csrf_blocked", message: "blocked" } }, 403);
  }
  if (url === "/api/auth/signup") {
    server.session = "access-token-new-student";
    return json({ outcome: "authenticated", message: "ok" });
  }
  if (url === "/api/profile" && method === "GET") {
    if (!server.session) return json({ authenticated: false }, 401);
    return json({
      user: {
        id: "d708ede4-0000-4000-8000-000000000001",
        email: "new@example.test",
        display_name: "New",
        role: "student",
      },
    });
  }
  if (url === "/api/profile" && method === "PATCH") {
    return json({ ok: true });
  }
  throw new Error(`unscripted ${method} ${url}`);
}

vi.mock("@/lib/supabase", () => ({ getSupabaseBrowserClient: () => ({}) }));
vi.mock("@/components/legal/reconsent-dismissal", () => ({
  clearReconsentDismissal: vi.fn(),
}));

import {
  SupabaseAuthProvider,
  useSupabaseAuth,
} from "@/contexts/SupabaseAuthContext";
import { clearCsrfToken, csrfFetch } from "@/lib/csrf";

let auth: ReturnType<typeof useSupabaseAuth> | null = null;
function Probe(): null {
  auth = useSupabaseAuth();
  return null;
}

describe("G-NEW-12 the first write after sign-up needs no CSRF retry", () => {
  beforeEach(() => {
    server.session = null;
    server.minted = 0;
    server.log.length = 0;
    auth = null;
    clearCsrfToken();
    vi.stubGlobal("fetch", vi.fn(scriptedFetch));
  });

  it("sign-up, then PATCH /api/profile: 200 on the first attempt, one PATCH on the wire", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SupabaseAuthProvider>
          <Probe />
        </SupabaseAuthProvider>
      </QueryClientProvider>,
    );
    // The provider pre-fetches a token on mount — minted for the ANONYMOUS identifier.
    await waitFor(() => expect(auth?.authLoading).toBe(false));
    expect(server.log).toContain("GET /api/csrf-token");

    await act(async () => {
      await auth!.signUp("new@example.test", "pw-long-enough", {
        consentSource: "email_signup_form",
      });
    });
    expect(auth!.user?.id).toBe("d708ede4-0000-4000-8000-000000000001");

    const mark = server.log.length;
    const res = await csrfFetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "student" }),
    });

    expect(res.status).toBe(200);
    expect(
      server.log.slice(mark).filter((l) => l === "PATCH /api/profile"),
    ).toHaveLength(1);
  });
});
