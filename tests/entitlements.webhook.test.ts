import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookHandlers } from "../server/lib/webhookHandlers";
import { supabaseServer } from "../apps/api/src/lib/supabase-server";
import { upsertEntitlement } from "../server/lib/account";

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

vi.mock("../server/lib/stripeClient", () => {
  const retrieveMock = vi.fn();
  return {
    getUncachableStripeClient: vi.fn().mockResolvedValue({
      webhooks: {
        constructEvent: vi.fn().mockImplementation((payload, sig) => {
          if (sig === "invalid") throw new Error("Invalid sig");
          return JSON.parse(payload.toString());
        }),
      },
      subscriptions: {
        retrieve: retrieveMock,
      },
    }),
    __retrieveMock: retrieveMock,
  };
});

vi.mock("../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
  },
}));

vi.mock("../server/lib/account", () => ({
  upsertEntitlement: vi.fn(),
  mapStripeStatusToEntitlement: vi
    .fn()
    .mockReturnValue({ tier: "premium", status: "active" }),
}));

function mockWebhookGate(
  insertError: { code?: string; message?: string } | null = null,
) {
  const insertMock = vi.fn().mockResolvedValue({ error: insertError });
  const eqMock = vi.fn().mockResolvedValue({ error: null });
  const deleteMock = vi.fn().mockReturnValue({ eq: eqMock });

  (supabaseServer.from as any).mockReturnValue({
    insert: insertMock,
    delete: deleteMock,
  });

  return { insertMock, deleteMock, eqMock };
}

describe("Webhook & Entitlements Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("duplicate webhook replay does not double-write", async () => {
    mockWebhookGate({ code: "23505", message: "duplicate key value" });

    const payload = Buffer.from(
      JSON.stringify({
        id: "evt_123",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_123",
            metadata: { account_id: "acc123" },
            customer: "cus_123",
            status: "active",
          },
        },
      }),
    );

    const result = await WebhookHandlers.processWebhook(payload, "valid_sig");

    expect(result.status).toBe("already_processed");
    expect(upsertEntitlement).not.toHaveBeenCalled();
  });

  it("out-of-order webhook events resolve to latest subscription state from Stripe", async () => {
    mockWebhookGate(null);

    const { __retrieveMock } = await import("../server/lib/stripeClient");
    (__retrieveMock as any).mockResolvedValue({
      id: "sub_123",
      status: "active",
      customer: "cus_latest",
      current_period_end: 1234567890,
      metadata: { profile_id: "prof123" },
    });

    const payload = Buffer.from(
      JSON.stringify({
        id: "evt_old",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_123",
            metadata: { profile_id: "prof123" },
            customer: "cus_old",
            status: "past_due",
          },
        },
      }),
    );

    await WebhookHandlers.processWebhook(payload, "valid_sig");

    expect(__retrieveMock).toHaveBeenCalledWith("sub_123");
    expect(upsertEntitlement).toHaveBeenCalledWith(
      "prof123",
      expect.objectContaining({
        stripe_subscription_id: "sub_123",
      }),
    );
  });

  it("guardian-paid checkout writes entitlement to the linked student profile", async () => {
    mockWebhookGate(null);

    const { __retrieveMock } = await import("../server/lib/stripeClient");
    (__retrieveMock as any).mockResolvedValue({
      id: "sub_guardian_123",
      status: "active",
      customer: "cus_guardian_paid",
      current_period_end: 9999999999,
      metadata: {
        profile_id: "student_profile_1",
        payer_role: "guardian",
        payer_user_id: "guardian_1",
        linked_student_id: "student_1",
      },
    });

    const payload = Buffer.from(
      JSON.stringify({
        id: "evt_guardian",
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub_guardian_123",
            metadata: {
              profile_id: "student_profile_1",
              payer_role: "guardian",
              payer_user_id: "guardian_1",
              linked_student_id: "student_1",
            },
            customer: "cus_guardian_paid",
            status: "active",
          },
        },
      }),
    );

    await WebhookHandlers.processWebhook(payload, "valid_sig");

    expect(upsertEntitlement).toHaveBeenCalledWith(
      "student_profile_1",
      expect.objectContaining({
        stripe_subscription_id: "sub_guardian_123",
      }),
    );
  });

  it("webhook fails closed when profile_id metadata is missing", async () => {
    const { deleteMock, eqMock } = mockWebhookGate(null);

    const payload = Buffer.from(
      JSON.stringify({
        id: "evt_missing_profile",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_missing_profile",
            metadata: {},
            customer: "cus_missing_profile",
            status: "active",
          },
        },
      }),
    );

    await expect(
      WebhookHandlers.processWebhook(payload, "valid_sig"),
    ).rejects.toThrow(/Missing profile_id/);

    expect(upsertEntitlement).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(eqMock).toHaveBeenCalledWith("id", "evt_missing_profile");
  });
});
