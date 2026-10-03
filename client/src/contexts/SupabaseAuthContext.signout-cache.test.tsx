// @vitest-environment jsdom
/**
 * @spec [student-ui register UI-14; Coding Standards §6.1 (server-authoritative auth)]
 * @implemented [2026-09-29]
 *
 * plain English: the auth provider reads the profile THROUGH the query cache, and signing out
 * empties that cache entry (and the billing status). Expected outcome: a second account signing
 * in within the same tab can never be routed or rendered on the first account's cached profile
 * or entitlement — which a 30 s freshness window would otherwise allow.
 *
 * Uses the real provider and a real QueryClient; only `fetch` is replaced. The profile body
 * carries the fields `server/routes/profile-routes.ts` writes.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SupabaseAuthProvider,
  useSupabaseAuth,
} from "@/contexts/SupabaseAuthContext";

const PROFILE_KEY = ["/api/profile"];
const BILLING_KEY = ["/api/billing/status"];

const profileBody = {
  authenticated: true,
  featureFlags: { accountDeletionLifecycleV2: false },
  pendingDeletion: null,
  user: {
    id: "00000000-0000-4000-8000-000000000002",
    email: "first@example.test",
    display_name: "First",
    name: "First",
    username: "first",
    role: "student",
    isAdmin: false,
    isGuardian: false,
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

const requests: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const path = new URL(raw, "http://localhost").pathname;
  requests.push(path);
  if (path === "/api/csrf-token") return json({ csrfToken: "csrf-test" });
  if (path === "/api/profile") return json(profileBody);
  if (path === "/api/auth/signout") return json({ success: true });
  return json({});
});

let signOutRef: (() => Promise<void>) | null = null;

function Probe(): React.ReactElement {
  const { user, signOut } = useSupabaseAuth();
  signOutRef = signOut;
  return <div data-testid="who">{user?.email ?? "signed-out"}</div>;
}

let client: QueryClient;

beforeEach(() => {
  requests.length = 0;
  signOutRef = null;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  client.clear();
});

describe("UI-14: sign-out clears the cached profile", () => {
  it("the provider's profile read lands in the query cache, and sign-out removes it", async () => {
    render(
      <QueryClientProvider client={client}>
        <SupabaseAuthProvider>
          <Probe />
        </SupabaseAuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("who").textContent).toBe("first@example.test"),
    );

    // Presence first: the provider read the profile through the cache, once.
    expect(client.getQueryData(PROFILE_KEY)).toMatchObject({
      authenticated: true,
      user: { email: "first@example.test" },
    });
    expect(requests.filter((p) => p === "/api/profile")).toHaveLength(1);

    // An entitlement the first account held.
    client.setQueryData(BILLING_KEY, { effectiveAccess: true });

    await act(async () => {
      await signOutRef?.();
    });

    expect(screen.getByTestId("who").textContent).toBe("signed-out");
    expect(client.getQueryData(PROFILE_KEY)).toBeUndefined();
    expect(client.getQueryData(BILLING_KEY)).toBeUndefined();
    // And signing out did not itself re-read the profile it just dropped.
    expect(requests.filter((p) => p === "/api/profile")).toHaveLength(1);
  });
});
