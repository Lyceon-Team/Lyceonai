import { afterEach, describe, expect, it, vi } from "vitest";

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
    rpc: vi.fn(),
  },
}));

vi.mock("../services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn().mockResolvedValue(false),
  },
}));

import * as accountLib from "../lib/account";

function buildChain(result: { data: any; error: any }) {
  const chain: any = {
    eq: () => chain,
    select: () => chain,
    order: () => chain,
    single: async () => result,
    // WS-GL Phase B: the guardian-link reads use `maybeSingle()` now — "no row" is the
    // not-linked answer, not an error to be recognised by its PostgREST code.
    maybeSingle: async () => result,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: result.data ? [result.data] : [],
        error: result.error,
      }).then(resolve),
  };
  return chain;
}

describe("Guardian payment access", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fromMock.mockReset();
  });

  it("guardian payment does not grant guardian-owned access when student is not entitled", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "guardian_links") {
        return {
          select: () =>
            buildChain({
              // WS-GL Phase B: `guardian_links` has no `student_user_id` and no
              // `account_id` — it never did. The real columns are `student_profile_id`
              // and the §36.1/§36.3 lifecycle set. With the old names this fixture made
              // the resolver take its no-link branch, so the test asserted the wrong
              // path's reason string.
              data: {
                id: "link_1",
                guardian_profile_id: "guardian_123",
                student_profile_id: "student_123",
                status: "active",
                initiated_by: "guardian",
                initiated_at: "2026-03-01T00:00:00.000Z",
                accepted_at: "2026-03-01T00:00:00.000Z",
                accepted_by_profile_id: "student_123",
                revoked_at: null,
                revoked_by_profile_id: null,
                revocation_reason: null,
                created_at: "2026-03-01T00:00:00.000Z",
              },
              error: null,
            }),
        };
      }

      if (table === "entitlements") {
        return {
          select: () => ({
            eq: (_field: string, value: string) => ({
              maybeSingle: async () => {
                if (value === "guardian_123") {
                  return {
                    data: {
                      profile_id: "guardian_123",
                      tier: "premium",
                      status: "active",
                      stripe_subscription_id: null,
                      stripe_price_id: null,
                      current_period_start: null,
                      current_period_end: null,
                      cancel_at_period_end: false,
                    },
                    error: null,
                  };
                }
                if (value === "student_123") {
                  return {
                    data: null,
                    error: null,
                  };
                }
                return { data: null, error: null };
              },
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const access = await accountLib.resolveLinkedPairPremiumAccessForGuardian(
      "guardian_123",
      "student_123",
    );

    expect(access.hasPremiumAccess).toBe(false);
    expect(access.premiumSource).toBe("none");
    expect(access.reason).toBe(
      "Linked student account does not have an active premium entitlement.",
    );
  });
});
