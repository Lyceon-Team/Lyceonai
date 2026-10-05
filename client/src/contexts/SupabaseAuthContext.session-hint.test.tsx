// @vitest-environment jsdom
/**
 * F8 — no profile read, and so no 401, when the visitor has no session cookie.
 *
 * @spec [SEO plan F8; Coding Standards §6.1, §14] | @implemented [2026-10-05]
 *
 * plain English: mounts the REAL `SupabaseAuthProvider` with the REAL `csrf.ts` and
 * `session-hint.ts`; only `fetch` is scripted. The CSRF bootstrap answers with the hint the
 * scenario sets, and every request URL is recorded.
 *  - hint `false`: boot finishes signed out and `/api/profile` is never requested;
 *  - hint `true`: the profile is read and the user is signed in;
 *  - hint absent (a server that does not send it): the profile is read, as before the hint.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({
  csrfBody: {} as Record<string, unknown>,
  requests: [] as string[],
}));

vi.mock("@/lib/supabase", () => ({ getSupabaseBrowserClient: () => ({}) }));
vi.mock("@/components/legal/reconsent-dismissal", () => ({
  clearReconsentDismissal: vi.fn(),
}));

import { SupabaseAuthProvider, useSupabaseAuth } from "./SupabaseAuthContext";
import { clearCsrfToken } from "@/lib/csrf";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const STUDENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function Harness(): JSX.Element {
  const { user, authLoading } = useSupabaseAuth();
  if (authLoading) return <p>loading</p>;
  return <p>{user ? `signed in ${user.id}` : "signed out"}</p>;
}

function mount(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SupabaseAuthProvider>
        <Harness />
      </SupabaseAuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  clearCsrfToken();
  net.requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      net.requests.push(url);
      if (url === "/api/csrf-token") return json(net.csrfBody);
      if (url === "/api/profile") {
        return json({
          authenticated: true,
          user: {
            id: STUDENT,
            email: "c@example.test",
            display_name: "C",
            role: "student",
          },
        });
      }
      throw new Error(`unscripted request ${url}`);
    }),
  );
});

describe("F8 boot profile read follows the session hint", () => {
  it("hint false: signed out, and /api/profile is never requested", async () => {
    net.csrfBody = { csrfToken: "t", sessionCookiePresent: false };
    mount();
    expect(await screen.findByText("signed out")).toBeInTheDocument();
    // Presence before absence: the bootstrap really ran, so the missing profile read means something.
    expect(net.requests).toContain("/api/csrf-token");
    expect(net.requests).not.toContain("/api/profile");
  });

  it("hint true: the profile is read and the user is signed in", async () => {
    net.csrfBody = { csrfToken: "t", sessionCookiePresent: true };
    mount();
    expect(await screen.findByText(`signed in ${STUDENT}`)).toBeInTheDocument();
    expect(net.requests).toContain("/api/profile");
  });

  it("hint absent: the profile is read, as before the hint existed", async () => {
    net.csrfBody = { csrfToken: "t" };
    mount();
    expect(await screen.findByText(`signed in ${STUDENT}`)).toBeInTheDocument();
    await waitFor(() => expect(net.requests).toContain("/api/profile"));
  });
});
