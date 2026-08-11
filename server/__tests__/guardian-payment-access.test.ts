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
    single: async () => result,
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
              data: {
                account_id: "student_account",
                student_user_id: "student_123",
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
