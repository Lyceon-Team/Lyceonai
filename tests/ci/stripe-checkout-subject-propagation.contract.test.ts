/**
 * Checkout leaves the SubscriptionItem bare — and the Customer has no address.
 *
 * @spec [SCL-045 one SubscriptionItem per student; INV-03-08 Tier-1 country
 *        gate; Charter §6 metadata identifies, it does not authorise;
 *        Charter §7 one fact, one source] | @implemented [2026-09-02]
 *
 * plain English: pins the two facts that took the money path down on
 * 2026-09-02, and the behaviour that closes them.
 *
 * WHAT ACTUALLY HAPPENED, from live Stripe and the production ledger. Guardian
 * `c6d3fc60` paid $0.99 for student `00625591`. Session `cs_live_a1izRz…` was
 * `paid`/`complete` with `customer_details.address.country: "US"`. Subscription
 * `sub_1UB8p5DPtjyWEVqErGBHVFQF` went `active` carrying the full subject in its
 * own metadata, while item `si_VBVqCKx5JSjVkF` carried `metadata: {}` —
 * Checkout does not propagate `line_items[].metadata`. `cus_TmPAI2XDmhuWJu`
 * carried `address: null`. `evt_1UB8p8…` sits in `stripe_webhook_events`, so the
 * event SETTLED rather than throwing, and no entitlement row was ever written.
 *
 * THE FIXTURE'S LOAD-BEARING FIELD IS `customer.address = null`. Every existing
 * suite in this repo hands the Customer `{ address: { country: "US" } }` — the
 * convenient case — which is why none of them could catch a gate that reads a
 * field nobody populates. Empty item metadata is NOT what makes this a
 * regression test; the null address is. A test built on a Customer with an
 * address passes today and pins nothing.
 *
 * The two gates read the same fact from different sources and disagreed:
 * `fulfilCheckoutSession` passed the session's `US`, and
 * `assertCountryEligibleForGrant` refused the Customer's `null` seconds later.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_secret_for_subject_propagation";
const GUARDIAN_ID = "c6d3fc60-2323-4a92-b3fd-b5e5d8612c1f";
const STUDENT_A = "00625591-d585-44b7-a4d8-f80c0672646b";
const STUDENT_B = "3f18cbe2-a999-41d4-852b-2af27e19d04e";

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
  getAllGuardianStudentLinks: vi.fn(async () => [
    { student_profile_id: STUDENT_A },
    { student_profile_id: STUDENT_B },
  ]),
}));
const configMocks = vi.hoisted(() => ({
  getTier1Countries: vi.fn(async () => [
    "US",
    "CA",
    "GB",
    "AU",
    "NZ",
    "IE",
    "SG",
  ]),
}));
const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionItemsUpdate: vi.fn(),
  customersRetrieve: vi.fn(),
  subscriptionsCancel: vi.fn(async () => ({ id: "sub_x", status: "canceled" })),
  invoicePaymentsList: vi.fn(async () => ({ data: [] })),
  paymentIntentsRetrieve: vi.fn(async () => ({
    id: "pi_x",
    latest_charge: null,
  })),
  refundsCreate: vi.fn(async () => ({ id: "re_x", amount: 0 })),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_subject_propagation_placeholder");
  return {
    getStripeClient: () => ({
      webhooks: real.webhooks,
      subscriptions: {
        retrieve: stripeApi.subscriptionsRetrieve,
        cancel: stripeApi.subscriptionsCancel,
      },
      subscriptionItems: { update: stripeApi.subscriptionItemsUpdate },
      customers: { retrieve: stripeApi.customersRetrieve },
      invoicePayments: { list: stripeApi.invoicePaymentsList },
      paymentIntents: { retrieve: stripeApi.paymentIntentsRetrieve },
      refunds: { create: stripeApi.refundsCreate },
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

/** The real session, reduced to the fields this handler reads. */
function signedCheckout(eventId: string) {
  const event = {
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_live_a1izRz",
        object: "checkout.session",
        mode: "subscription",
        subscription: "sub_guardian_first_purchase",
        payment_status: "paid",
        // The address the payer typed. Present, complete, and — before this
        // change — never written back to the Customer.
        customer_details: {
          address: {
            city: "Carmel",
            country: "US",
            line1: "14264 Langham Dr. ",
            postal_code: "46074",
            state: "IN",
          },
        },
        metadata: {
          payer_profile_id: GUARDIAN_ID,
          payer_relationship: "guardian",
          plan: "yearly",
          student_profile_id: STUDENT_A,
        },
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

function item(id: string, studentProfileId?: string) {
  return {
    id,
    object: "subscription_item",
    current_period_start: 1_788_334_984,
    current_period_end: 1_819_870_984,
    price: { id: "price_1SnWvoDPtjyWEVqEohJvlvvq" },
    metadata: studentProfileId ? { student_profile_id: studentProfileId } : {},
  };
}

function subscriptionWith(items: ReturnType<typeof item>[]) {
  return {
    id: "sub_guardian_first_purchase",
    object: "subscription",
    customer: "cus_TmPAI2XDmhuWJu",
    status: "active",
    cancel_at_period_end: false,
    // SCL-043: the subscription names the PAYER, and on a first purchase the
    // single student too.
    metadata: {
      payer_profile_id: GUARDIAN_ID,
      payer_relationship: "guardian",
      student_profile_id: STUDENT_A,
    },
    items: { object: "list", data: items },
  };
}

async function handler() {
  return (await import("../../server/lib/stripe/webhook-handler"))
    .processStripeWebhook;
}

describe("guardian first purchase: bare item, and a Customer with no address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    configMocks.getTier1Countries.mockResolvedValue([
      "US",
      "CA",
      "GB",
      "AU",
      "NZ",
      "IE",
      "SG",
    ]);
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      { student_profile_id: STUDENT_A },
      { student_profile_id: STUDENT_B },
    ]);
    // Checkout's own item: it exists, and it carries nothing.
    stripeApi.subscriptionsRetrieve.mockResolvedValue(
      subscriptionWith([item("si_VBVqCKx5JSjVkF")]),
    );
    stripeApi.subscriptionItemsUpdate.mockImplementation(
      async (id: string, params: { metadata: Record<string, string> }) => ({
        ...item(id, params.metadata.student_profile_id),
      }),
    );
    // The default is the SHAPE THAT FAILED: a real Customer with no address.
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_TmPAI2XDmhuWJu",
      address: null,
    });
  });

  /**
   * THE PRODUCTION FAILURE, PINNED. This is the state that existed at 07:43Z on
   * 2026-09-02 and it must never read as success. The event settles — a denial
   * is a decision, and `unknown` holds rather than auto-refunding, because an
   * unseeded config would otherwise refund every paying customer at once — but
   * NOTHING is granted.
   *
   * The plant that proves it bites is the change the brief proposed and the
   * owner forbade: point `assertCountryEligibleForGrant` at the session instead
   * of the Customer and this test grants, going red. That is the whole reason
   * the fix lives at session creation rather than in the gate's read.
   */
  it("HOLDS and writes nothing when the Customer carries no address, even though the session does", async () => {
    const process_ = await handler();
    const { body, signature } = signedCheckout("evt_null_address");

    const outcome = await process_(body, signature, "req_null_address");

    expect(outcome).toMatchObject({ ok: true, status: "held" });
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    // Held means held: no money is moved on `unknown`.
    expect(stripeApi.subscriptionsCancel).not.toHaveBeenCalled();
    expect(stripeApi.refundsCreate).not.toHaveBeenCalled();
  });

  /**
   * The same purchase once `customer_update: { address: "auto" }` has done its
   * job and Stripe has saved the address onto the Customer. This is what the
   * recovered subscription looks like.
   */
  it("GRANTS the selected student once the Customer carries the address, with the item id", async () => {
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_TmPAI2XDmhuWJu",
      address: { country: "US" },
    });
    const process_ = await handler();
    const { body, signature } = signedCheckout("evt_address_saved");

    const outcome = await process_(body, signature, "req_address_saved");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_A,
      expect.objectContaining({
        tier: "premium",
        stripe_subscription_item_id: "si_VBVqCKx5JSjVkF",
      }),
    );
  });

  /**
   * The item write itself. Plant: delete the `propagateSubjectToBareItem` call
   * from `fulfilCheckoutSession` and this goes red while the entitlement
   * assertion above stays green — which is precisely the point. The grant never
   * depended on this; the SECOND student's renewal does.
   */
  it("writes the session's student onto the item Checkout left bare", async () => {
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_TmPAI2XDmhuWJu",
      address: { country: "US" },
    });
    const process_ = await handler();
    const { body, signature } = signedCheckout("evt_item_written");

    await process_(body, signature, "req_item_written");

    expect(stripeApi.subscriptionItemsUpdate).toHaveBeenCalledWith(
      "si_VBVqCKx5JSjVkF",
      { metadata: { student_profile_id: STUDENT_A } },
    );
  });

  /**
   * THE DEFECT THIS FIX ACTUALLY CLOSES. Once a guardian adds a second student,
   * the subscription has two items and `writeEntitlementsForAllItems`'s
   * single-student fallback is — correctly — restricted to the one-item case.
   * A first student whose item stayed bare would silently stop being refreshed
   * on every renewal from then on. Filling the item in at purchase time is what
   * keeps both resolving.
   *
   * Plant: remove the propagation call and only STUDENT_B resolves.
   */
  it("resolves BOTH students when one item was left bare and the other names its own", async () => {
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_TmPAI2XDmhuWJu",
      address: { country: "US" },
    });
    stripeApi.subscriptionsRetrieve.mockResolvedValue(
      subscriptionWith([
        item("si_bare_from_checkout"),
        item("si_added_directly", STUDENT_B),
      ]),
    );
    const process_ = await handler();
    const { body, signature } = signedCheckout("evt_two_items");

    const outcome = await process_(body, signature, "req_two_items");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_A,
      expect.objectContaining({
        stripe_subscription_item_id: "si_bare_from_checkout",
      }),
    );
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_B,
      expect.objectContaining({
        stripe_subscription_item_id: "si_added_directly",
      }),
    );
  });

  /**
   * NEVER OVERWRITE A SUBJECT THAT IS ALREADY THERE. This is also what makes a
   * replayed event a no-op on its second pass, independently of the event
   * ledger: the item is no longer bare, so there is nothing to write.
   */
  it("does not touch an item that already names its student", async () => {
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_TmPAI2XDmhuWJu",
      address: { country: "US" },
    });
    stripeApi.subscriptionsRetrieve.mockResolvedValue(
      subscriptionWith([item("si_already_named", STUDENT_A)]),
    );
    const process_ = await handler();
    const { body, signature } = signedCheckout("evt_no_overwrite");

    await process_(body, signature, "req_no_overwrite");

    expect(stripeApi.subscriptionItemsUpdate).not.toHaveBeenCalled();
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_A,
      expect.objectContaining({ tier: "premium" }),
    );
  });

  /**
   * SEVERAL BARE ITEMS IS A GUESS, AND THE GUESS IS REFUSED. The session names
   * one student; two bare items means it names at most one of them. Nothing is
   * written to Stripe and the writer's own zero-candidate refusal is what
   * speaks — the event fails and Stripe retries, rather than one student being
   * entitled off a coin flip.
   */
  it("writes nothing to Stripe when several items are bare, and entitles nobody", async () => {
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_TmPAI2XDmhuWJu",
      address: { country: "US" },
    });
    stripeApi.subscriptionsRetrieve.mockResolvedValue(
      subscriptionWith([item("si_bare_one"), item("si_bare_two")]),
    );
    const process_ = await handler();
    const { body, signature } = signedCheckout("evt_ambiguous");

    await expect(process_(body, signature, "req_ambiguous")).rejects.toThrow();

    expect(stripeApi.subscriptionItemsUpdate).not.toHaveBeenCalled();
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  /**
   * A FAILED BOOKKEEPING WRITE MUST NOT TAKE DOWN THE MONEY PATH.
   *
   * If `subscriptionItems.update` throws, the payer has still paid and the
   * subject still resolves from subscription metadata. Letting it propagate
   * would make Stripe retry, and a persistent API failure would leave a charged
   * payer with no entitlement for the whole retry window — the exact shape this
   * whole change closes, rebuilt one layer over.
   *
   * Plant: remove the try/catch and this goes red.
   */
  it("still grants when the item write fails, and says what was not written", async () => {
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_TmPAI2XDmhuWJu",
      address: { country: "US" },
    });
    stripeApi.subscriptionItemsUpdate.mockRejectedValue(
      new Error("Stripe is unavailable"),
    );
    const process_ = await handler();
    const { body, signature } = signedCheckout("evt_item_write_failed");

    const outcome = await process_(body, signature, "req_item_write_failed");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_A,
      expect.objectContaining({
        tier: "premium",
        stripe_subscription_item_id: "si_VBVqCKx5JSjVkF",
      }),
    );
  });

  /**
   * CHARTER §6: the identifier is made durable, authorisation is not moved.
   * A student the payer is not actively linked to is refused AFTER the item is
   * written, because the §6 check has exactly one home and duplicating it here
   * would be a second copy of the rule. Writing metadata grants nothing.
   */
  it("still refuses a student the payer is not linked to, having written the item", async () => {
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_TmPAI2XDmhuWJu",
      address: { country: "US" },
    });
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      { student_profile_id: STUDENT_B },
    ]);
    const process_ = await handler();
    const { body, signature } = signedCheckout("evt_unlinked");

    await expect(process_(body, signature, "req_unlinked")).rejects.toThrow();

    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });
});
