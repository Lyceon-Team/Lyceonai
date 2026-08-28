/**
 * INV-03-08 Tier-1 country gate — enforced at its production call site.
 *
 * @spec [INV-03-08 (Doc 03 §2156, heading verified); SCL-046 as amended
 *        2026-08-27] | @implemented [2026-08-28 — closes Codex HIGH-1]
 *
 * plain English: proves the country rule actually RUNS. Codex found
 * `evaluateCountryEligibility` had no application call site at all — "a
 * fail-open money path" — so entitlement was granted with no country decision
 * while the module's presence suggested otherwise. Expected outcome: an
 * ineligible or unknown billing country denies entitlement at
 * `checkout.session.completed`, and an eligible one grants.
 *
 * Trade-off: this tests the WIRING through the real handler, not the pure rule
 * — that already has its own suite
 * (`tests/ci/stripe-country-eligibility.contract.test.ts`). A green rule with
 * no caller is exactly the defect being closed, so the rule's own tests could
 * not have caught it and neither could a unit test of the rule here.
 *
 * BOTH HALVES ARE ASSERTED. A denial that returned an error while still writing
 * the entitlement would be the same money path with a louder log, so every
 * denial case asserts `upsertEntitlement` was NOT called.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_secret_for_country_gate";
const STUDENT_ID = "88888888-8888-4888-8888-888888888888";

const state = vi.hoisted(() => ({ expectedLivemode: false }));
const dbMocks = vi.hoisted(() => ({
  insert: vi.fn(async () => ({
    error: null as { code?: string; message?: string } | null,
  })),
  delete: vi.fn(async () => ({ error: null })),
}));
const accountMocks = vi.hoisted(() => ({
  upsertEntitlement: vi.fn(async () => ({})),
  mapStripeStatusToEntitlement: vi.fn((s: string) => ({
    tier: s === "active" ? "premium" : "free",
    status: s,
  })),
  getEntitlementsBySubscriptionId: vi.fn(async () => []),
  getAllGuardianStudentLinks: vi.fn(async () => []),
}));
const configMocks = vi.hoisted(() => ({
  getTier1Countries: vi.fn(),
}));
const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsResume: vi.fn(),
  subscriptionsList: vi.fn(),
  chargesRetrieve: vi.fn(),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_country_gate_placeholder");
  return {
    getStripeClient: () => ({
      webhooks: real.webhooks,
      subscriptions: {
        retrieve: stripeApi.subscriptionsRetrieve,
        list: stripeApi.subscriptionsList,
        update: stripeApi.subscriptionsUpdate,
        resume: stripeApi.subscriptionsResume,
      },
      charges: { retrieve: stripeApi.chargesRetrieve },
    }),
    getExpectedLivemode: () => state.expectedLivemode,
  };
});
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: dbMocks.insert,
      delete: () => ({ eq: dbMocks.delete }),
    }),
  },
}));
vi.mock("../../server/lib/account", () => ({
  upsertEntitlement: accountMocks.upsertEntitlement,
  mapStripeStatusToEntitlement: accountMocks.mapStripeStatusToEntitlement,
  getEntitlementsBySubscriptionId: accountMocks.getEntitlementsBySubscriptionId,
  getAllGuardianStudentLinks: accountMocks.getAllGuardianStudentLinks,
}));
vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  getTier1Countries: configMocks.getTier1Countries,
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function signedCheckout(country: string | null | undefined) {
  const event = {
    id: "evt_country_gate",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_country_gate",
        object: "checkout.session",
        mode: "subscription",
        subscription: "sub_country_gate",
        client_reference_id: STUDENT_ID,
        metadata: { student_profile_id: STUDENT_ID },
        customer_details:
          country === undefined ? null : { address: { country } },
      },
    },
  };
  const payload = JSON.stringify(event);
  return {
    body: Buffer.from(payload, "utf8"),
    signature: Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
  };
}

async function handler() {
  return (await import("../../server/lib/stripe/webhook-handler"))
    .processStripeWebhook;
}

describe("INV-03-08 country gate at checkout.session.completed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_country_gate",
      object: "subscription",
      status: "active",
      items: {
        object: "list",
        data: [
          {
            id: "si_country_gate",
            object: "subscription_item",
            current_period_start: 1_756_000_000,
            current_period_end: 1_758_600_000,
            price: { id: "price_test" },
            metadata: { student_profile_id: STUDENT_ID },
          },
        ],
      },
    });
  });

  it("GRANTS when the billing country is on the Tier-1 list", async () => {
    configMocks.getTier1Countries.mockResolvedValue(["US", "CA", "GB"]);
    const process_ = await handler();
    const { body, signature } = signedCheckout("US");

    const outcome = await process_(body, signature, "req_eligible");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_ID,
      expect.objectContaining({ tier: "premium" }),
    );
  });

  it("DENIES an ineligible country, and writes nothing", async () => {
    configMocks.getTier1Countries.mockResolvedValue(["US", "CA", "GB"]);
    const process_ = await handler();
    const { body, signature } = signedCheckout("FR");

    await expect(process_(body, signature, "req_ineligible")).rejects.toThrow(
      /not Tier-1 eligible \(verdict=ineligible\)/,
    );
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("DENIES when the completed session carries no country — unknown denies after payment", async () => {
    configMocks.getTier1Countries.mockResolvedValue(["US", "CA", "GB"]);
    const process_ = await handler();
    const { body, signature } = signedCheckout(undefined);

    await expect(process_(body, signature, "req_nocountry")).rejects.toThrow(
      /not Tier-1 eligible \(verdict=unknown\)/,
    );
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("DENIES while the Tier-1 list is unseeded — the fail-closed default, and why the gate is INERT until the owner DML is applied", async () => {
    // Owner ruling 2026-08-27: keep the fail-closed default; no
    // empty-config-means-allow path. This is the state of production TODAY,
    // because Owner_DML_tier_1_countries.sql has not been applied.
    configMocks.getTier1Countries.mockResolvedValue(null);
    const process_ = await handler();
    const { body, signature } = signedCheckout("US");

    await expect(process_(body, signature, "req_unseeded")).rejects.toThrow(
      /not Tier-1 eligible \(verdict=unknown\)/,
    );
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("uses `GB`, not `UK` — the encoding the owner ruled on", async () => {
    // INV-03-08's prose says "UK"; Stripe sends ISO 3166-1 alpha-2, in which
    // the code is `GB`. A list seeded with the prose spelling would deny every
    // genuine UK customer while believing it admitted them. This test fails if
    // anyone re-seeds `UK` by copying the invariant literally.
    configMocks.getTier1Countries.mockResolvedValue(["US", "CA", "GB"]);
    const process_ = await handler();
    const { body, signature } = signedCheckout("GB");

    const outcome = await process_(body, signature, "req_gb");
    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalled();
  });

  it("normalises case and whitespace but performs NO UK-to-GB translation", async () => {
    // The config holds correct codes; a normalisation layer that silently
    // translated a wrong code is how the next wrong code would survive.
    configMocks.getTier1Countries.mockResolvedValue(["us"]);
    const process_ = await handler();

    const ok = await process_(
      ...Object.values(signedCheckout(" us ")),
      "req_case",
    );
    expect(ok).toMatchObject({ ok: true, status: "processed" });

    vi.clearAllMocks();
    configMocks.getTier1Countries.mockResolvedValue(["UK"]);
    const { body, signature } = signedCheckout("GB");
    await expect(process_(body, signature, "req_uk_seed")).rejects.toThrow(
      /verdict=ineligible/,
    );
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });
});
