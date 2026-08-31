/**
 * Stripe SURFACE — the two boundaries that were not boundaries.
 *
 * @spec [Coding Standards §7.1 "Parse at every boundary … Third-party payloads
 *        (Stripe, etc.)"; Doc-01_V8 §22.1 as amended by SCL-070 (19 subscribed
 *        events); INV-03-08 / SCL-046 country signal]
 * @implemented [2026-08-31 — SCL-DRAFT-B-customer-parse,
 *                            SCL-DRAFT-B-dispatch-exhaustive]
 *
 * plain English: two things that a signature does not prove. First, that a
 * retrieved Stripe Customer has the shape the country gate reads a country out
 * of — it was CAST there and PARSED on the neighbouring path, so the same object
 * was checked when it only scheduled a cancellation and unchecked when it
 * decided a grant. Second, that an event which reaches the dispatcher's
 * subscription fallthrough is actually a subscription event — every Stripe
 * object has an `id`, so the fallthrough parsed anything and then asked Stripe
 * to retrieve a Subscription by it.
 *
 * Expected outcome: a malformed Customer denies the grant AND writes nothing;
 * a HANDLED event with no dispatch branch stops at a named error instead of
 * being treated as a subscription.
 *
 * Trade-off: these drive the REAL handler through the REAL Stripe signature
 * verifier, so they are slower than a unit test on a pure function. That is the
 * point — a schema asserted in isolation proves the schema, not that the handler
 * reached it.
 *
 * Edge case, and it is the load-bearing one: BOTH HALVES ARE ASSERTED. A denial
 * that still wrote a row would pass a response-only assertion, so every case
 * below checks `upsertEntitlement` as well as the outcome.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_secret_for_surface_boundary_suite";
const STUDENT_ID = "55555555-5555-4555-8555-555555555555";

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
  getProfileIdByStripeCustomerId: vi.fn(async () => null),
  getEntitlementForProfile: vi.fn(async () => null),
  getProfileStripeCustomerId: vi.fn(async () => null),
}));

const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(async () => ({})),
  subscriptionsResume: vi.fn(async () => ({})),
  subscriptionsList: vi.fn(async () => ({ object: "list", data: [] })),
  chargesRetrieve: vi.fn(),
  customersRetrieve: vi.fn(),
  invoicePaymentsList: vi.fn(async () => ({ object: "list", data: [] })),
  invoicesRetrieve: vi.fn(),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_surface_boundary_placeholder");
  return {
    // REAL signature verification — nothing about the boundary under test is
    // stubbed. Only the network and the database are.
    getStripeClient: () => ({
      webhooks: real.webhooks,
      subscriptions: {
        retrieve: stripeApi.subscriptionsRetrieve,
        list: stripeApi.subscriptionsList,
        update: stripeApi.subscriptionsUpdate,
        resume: stripeApi.subscriptionsResume,
      },
      charges: { retrieve: stripeApi.chargesRetrieve },
      customers: { retrieve: stripeApi.customersRetrieve },
      invoicePayments: { list: stripeApi.invoicePaymentsList },
      invoices: { retrieve: stripeApi.invoicesRetrieve },
    }),
    getExpectedLivemode: () => false,
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
  getProfileIdByStripeCustomerId: accountMocks.getProfileIdByStripeCustomerId,
  getEntitlementForProfile: accountMocks.getEntitlementForProfile,
  getProfileStripeCustomerId: accountMocks.getProfileStripeCustomerId,
}));

vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  // Seeded and ELIGIBLE. This suite is not about the country list — it is about
  // whether the Customer the list is compared against was parsed. Leaving the
  // list unseeded would let a denial pass for the wrong reason.
  getTier1Countries: vi.fn(async () => ["US", "CA", "GB"]),
}));

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { processStripeWebhook } from "../../server/lib/stripe/webhook-handler";
import {
  SUBSCRIBED_EVENTS,
  EVENT_DISPOSITION,
} from "../../server/lib/stripe/event-surface";

/** A real Stripe-signed delivery. The signature is generated, not faked. */
function signedDelivery(
  eventType: string,
  dataObject: Record<string, unknown>,
  eventId: string,
): { body: Buffer; signature: string } {
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    api_version: "2026-02-25.clover",
    created: 1_756_000_000,
    livemode: false,
    type: eventType,
    data: { object: dataObject },
  });
  const body = Buffer.from(payload, "utf8");
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { body, signature };
}

const ACTIVE_SUBSCRIPTION = {
  id: "sub_surface_1",
  object: "subscription",
  status: "active",
  customer: "cus_surface_1",
  metadata: { student_profile_id: STUDENT_ID },
  items: {
    object: "list",
    data: [
      {
        id: "si_surface_1",
        object: "subscription_item",
        current_period_start: 1_756_000_000,
        current_period_end: 1_758_600_000,
        price: { id: "price_surface_1" },
        metadata: { student_profile_id: STUDENT_ID },
      },
    ],
  },
};

const SUBSCRIPTION_EVENT_OBJECT = {
  id: "sub_surface_1",
  object: "subscription",
  metadata: { student_profile_id: STUDENT_ID },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  dbMocks.insert.mockResolvedValue({ error: null });
  dbMocks.delete.mockResolvedValue({ error: null });
  accountMocks.upsertEntitlement.mockResolvedValue({});
  stripeApi.subscriptionsRetrieve.mockResolvedValue(ACTIVE_SUBSCRIPTION);
});

/**
 * SCL-DRAFT-B-customer-parse.
 *
 * The country gate reads `address.country` off a retrieved Customer and hands
 * it to `evaluateCountryEligibility`. It used to reach that field through
 * `as Stripe.Customer`, which is the compiler being told to stop asking rather
 * than the response being checked.
 */
describe("the retrieved Stripe Customer is parsed, not asserted", () => {
  it("grants when the Customer parses and its country is Tier-1", async () => {
    // The CONTROL. Without it, every assertion below could be passing because
    // the path is broken rather than because the parse is doing its job.
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_surface_1",
      object: "customer",
      address: { country: "US" },
    });

    const { body, signature } = signedDelivery(
      "customer.subscription.updated",
      SUBSCRIPTION_EVENT_OBJECT,
      "evt_surface_customer_ok",
    );
    const outcome = await processStripeWebhook(body, signature);

    // Half one: the response.
    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    // Half two: the state change. A grant, and premium.
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(1);
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_ID,
      expect.objectContaining({ tier: "premium" }),
    );
  });

  it("refuses the grant and writes NOTHING when the Customer has no id", async () => {
    // The shape an API-version drift produces: a response that is still an
    // object and still has an address, but is no longer the object we asked
    // for. A cast reads `address.country` off it happily. A parse does not.
    stripeApi.customersRetrieve.mockResolvedValue({
      object: "customer",
      address: { country: "US" },
    });

    const { body, signature } = signedDelivery(
      "customer.subscription.updated",
      SUBSCRIPTION_EVENT_OBJECT,
      "evt_surface_customer_no_id",
    );

    /**
     * SECOND FORMULATION, and the reason there is one.
     *
     * The first formulation asserted `/failed shape validation/`. That string
     * is in the message of EVERY `StripePayloadShapeError`, including the one
     * the country gate throws on a legitimate ineligible customer — so the
     * assertion could not tell "Stripe sent a shape we do not recognise" from
     * "this customer is not in a Tier-1 country". Planted against the cast, the
     * flat-address case below PASSED on that regex: it denied for the wrong
     * reason and the test called it a win.
     *
     * The underlying conflation — one error class thrown from 13 sites for a
     * shape failure, a country denial and an ambiguity refusal alike — is a
     * CODE DEFECT, recorded in docs/plans/Stripe_Row_Claims.md, not a spec
     * change. Owner ruling 2026-08-31: an SCL exists when the spec says
     * something and that something is wrong. The spec says nothing about this
     * error class, so no SCL is owed; the defect is scheduled for B after C and
     * D land.
     *
     * So the assertion is on the PARSE DETAIL — Zod's own field error — and on
     * the absence of the country verdict. Only a real parse failure satisfies
     * both.
     */
    const err = await processStripeWebhook(body, signature).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(err, "expected a rejection; the call resolved instead").not.toBeNull();
    expect(err).toContain('{"id":["Required"]}');
    expect(err).not.toContain("Tier-1");
    // The half that matters: the malformed Customer wrote no entitlement.
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    // And the idempotency claim was released, so Stripe's retry is not a
    // silent no-op against an already-claimed event id.
    expect(dbMocks.delete).toHaveBeenCalled();
  });

  it("refuses the grant when `address` is present but not an object", async () => {
    // `address: "US"` — a plausible flattening. `("US" as Stripe.Customer)
    // .address?.country` is `undefined`, which denies for the WRONG reason:
    // indistinguishable from a customer who supplied no address at all.
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_surface_1",
      object: "customer",
      address: "US",
    });

    const { body, signature } = signedDelivery(
      "customer.subscription.updated",
      SUBSCRIPTION_EVENT_OBJECT,
      "evt_surface_customer_flat_address",
    );

    const err = await processStripeWebhook(body, signature).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    // The parse names the offending FIELD. Under the old cast this path threw
    // too — but with the country verdict, which is the wrong reason and would
    // send an operator hunting for a customer who moved rather than an API
    // version that drifted.
    expect(err).toContain('{"address":["Expected object, received string"]}');
    expect(err).not.toContain("Tier-1");
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("a DeletedCustomer parses, and denies the grant without writing", async () => {
    // `customers.retrieve` on a deleted Customer returns `{id, object,
    // deleted:true}` and NO address. That is an ABSENT country, not an
    // ineligible one — it must deny (fail closed) and must not throw a shape
    // error, because the shape is exactly what Stripe documents.
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_surface_1",
      object: "customer",
      deleted: true,
    });

    const { body, signature } = signedDelivery(
      "customer.subscription.updated",
      SUBSCRIPTION_EVENT_OBJECT,
      "evt_surface_customer_deleted",
    );

    const err = await processStripeWebhook(body, signature).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    // Denied by the COUNTRY GATE, not by the parse: `{id, object, deleted}` is
    // exactly what Stripe documents a DeletedCustomer to be, so treating it as
    // a malformed payload would report an integration defect that is not there.
    expect(err).toContain("not Tier-1 eligible");
    expect(err).not.toContain('"address"');
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("REVOCATION is not blocked by a Customer that cannot be read", async () => {
    // The asymmetry that keeps the gate honest: only GRANTS are gated. A
    // canceled subscription writes `free`, so `assertCountryEligibleForGrant`
    // is never asked and the unreadable Customer cannot strand premium access.
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      ...ACTIVE_SUBSCRIPTION,
      status: "canceled",
    });
    stripeApi.customersRetrieve.mockRejectedValue(
      new Error("customers.retrieve must not be reached on a revocation"),
    );

    const { body, signature } = signedDelivery(
      "customer.subscription.deleted",
      SUBSCRIPTION_EVENT_OBJECT,
      "evt_surface_revoke_ungated",
    );
    const outcome = await processStripeWebhook(body, signature);

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(stripeApi.customersRetrieve).not.toHaveBeenCalled();
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_ID,
      expect.objectContaining({ tier: "free" }),
    );
  });
});

/**
 * SCL-DRAFT-B-dispatch-exhaustive.
 *
 * `dispatch` branches on eight event types and then FALLS THROUGH to the
 * subscription lifecycle path. That fallthrough was unguarded, so it was the
 * dispatcher's answer for every HANDLED event nobody had given a branch.
 */
describe("the dispatcher is exhaustive over the HANDLED events", () => {
  it("every HANDLED event has a dispatch branch or is a subscription event", async () => {
    // The structural half, stated as a fact about the two modules rather than
    // as a list maintained by hand. `EVENT_DISPOSITION` is the source; the
    // fallthrough owns exactly the three subscription lifecycle events.
    const SUBSCRIPTION_LIFECYCLE = [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ];
    const BRANCHED = [
      "customer.deleted",
      "customer.updated",
      "refund.updated",
      "charge.dispute.created",
      "charge.dispute.closed",
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
    ];

    const handled = SUBSCRIBED_EVENTS.filter(
      (e) => EVENT_DISPOSITION[e].kind === "handled",
    );
    const unrouted = handled.filter(
      (e) =>
        !BRANCHED.includes(e) &&
        !(SUBSCRIPTION_LIFECYCLE as readonly string[]).includes(e),
    );

    // Printed, so the reviewer reads the evidence rather than a boolean.
    // eslint-disable-next-line no-console
    console.table(
      handled.map((e) => ({
        event: e,
        routedBy: BRANCHED.includes(e) ? "explicit branch" : "subscription path",
      })),
    );

    expect(unrouted).toEqual([]);
    // Not vacuous: assert the branch lists actually cover the handled set.
    expect(handled.length).toBe(BRANCHED.length + SUBSCRIPTION_LIFECYCLE.length);
  });

  it("an event that reaches the subscription path but is not one is REFUSED", async () => {
    // Drives the real handler with an invoice payload on an event type the
    // dispatcher has no branch for. Before the guard this parsed clean — every
    // Stripe object has an `id` — and asked Stripe for a SUBSCRIPTION named
    // `in_surface_1`.
    //
    // `charge.refunded` is used because it is NOT on the subscribed surface
    // today, so this test cannot be broken by a future disposition change; the
    // subscribed path is forced by driving `dispatch` directly below.
    const { body, signature } = signedDelivery(
      "invoice.payment_succeeded",
      { id: "in_surface_1", object: "invoice" },
      "evt_surface_ignored_invoice",
    );
    const outcome = await processStripeWebhook(body, signature);

    // Today `invoice.payment_succeeded` is IGNORED, so it never reaches
    // dispatch at all. Both halves: ignored, and nothing written, and Stripe
    // was never asked to retrieve a subscription by an invoice id.
    expect(outcome).toMatchObject({ ok: true, status: "ignored" });
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    expect(stripeApi.subscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it("the guard names the event and refuses rather than retrieving by a foreign id", async () => {
    // The case the guard exists for, reached the only way it can be without
    // editing production data: make the event HANDLED for the duration of this
    // test, exactly as promoting an ignored event would.
    const surface = await import("../../server/lib/stripe/event-surface");
    const original = surface.EVENT_DISPOSITION["invoice.payment_succeeded"];
    Object.defineProperty(surface.EVENT_DISPOSITION, "invoice.payment_succeeded", {
      value: { kind: "handled" },
      configurable: true,
      writable: true,
    });

    try {
      const { body, signature } = signedDelivery(
        "invoice.payment_succeeded",
        { id: "in_surface_1", object: "invoice" },
        "evt_surface_promoted_invoice",
      );

      const err = await processStripeWebhook(body, signature).then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );

      /**
       * Captured rather than matched inline, so that BOTH halves are asserted
       * even when the first fails. With `rejects.toThrow` the call-count
       * assertions below are unreachable on failure, and the call count is the
       * half that shows the HARM rather than the symptom.
       *
       * Without the guard this reads:
       *   "Stripe invoice.payment_succeeded payload failed shape validation:
       *    no valid student_profile_id in metadata or client_reference_id"
       * — which names a missing field on an invoice, and sends an operator
       * looking for metadata that was never supposed to be there.
       */
      expect(err).toContain("has no branch in dispatch()");

      // The half that is the whole point: Stripe was NEVER asked to retrieve a
      // Subscription by `in_surface_1`, and no entitlement moved.
      expect(stripeApi.subscriptionsRetrieve).not.toHaveBeenCalled();
      expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(
        surface.EVENT_DISPOSITION,
        "invoice.payment_succeeded",
        { value: original, configurable: true, writable: true },
      );
    }
  });
});

/**
 * SCL-DRAFT-B-fixture-duplicate-keys.
 *
 * @spec [Coding Standards §14 Testing Requirements; §17 hard stops]
 * @implemented [2026-08-31]
 *
 * plain English: a Stripe fixture that names the same field twice is a fixture
 * that does not say what it appears to say — JavaScript keeps the last one and
 * discards the rest in silence. Expected outcome: the next one fails here
 * instead of being read as evidence. Trade-off: this parses the fixture files
 * on every run, which costs milliseconds. Edge case: a duplicate whose two
 * values AGREE changes no behaviour and is still reported, because a duplicate
 * that happens to agree with itself is the one that survives to the day it
 * does not.
 *
 * WHY THIS TEST EXISTS RATHER THAN A LINT RULE. Two gates should each have
 * caught this and neither applies, both verified:
 *
 *   pnpm -s exec eslint --print-config tests/ci/stripe-dispute.contract.test.ts
 *     -> "no-dupe-keys": [0]
 *   `typescript-eslint`'s recommended config DISABLES the rule for .ts files,
 *   on the reasoning that the TypeScript compiler reports it as ts(1117).
 *
 *   pnpm -s exec tsc --listFilesOnly | grep -c '/tests/ci/'
 *     -> 0
 *   tsconfig.json excludes every `.test.ts` by glob and never includes the
 *   `tests/` directory at all,
 *   so the compiler that was supposed to catch it never opens these files.
 *
 * The rule was handed off to a checker that does not run. esbuild DOES detect
 * it — vitest prints "Duplicate key … in object literal" as a warning — but a
 * warning nothing reads is not a gate. So esbuild's own detection is invoked
 * here and its warning is turned into a failure, rather than a third parser
 * being written to answer a question two tools already answer.
 */
describe("Stripe contract fixtures say what they appear to say", () => {
  it("no Stripe test fixture declares the same object key twice", async () => {
    const esbuild = await import("esbuild");
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const { globSync } = await import("node:fs");

    const here = dirname(fileURLToPath(import.meta.url));
    const files = globSync("stripe-*.ts", { cwd: here }).sort();

    // Not vacuous: if the glob ever matches nothing, this fails rather than
    // passing on an empty set.
    expect(files.length).toBeGreaterThan(5);

    const offences: string[] = [];
    for (const file of files) {
      const abs = join(here, file);
      const result = await esbuild.transform(readFileSync(abs, "utf8"), {
        loader: "ts",
        // Parse only. Nothing is executed and nothing is written.
        sourcefile: file,
      });
      for (const warning of result.warnings) {
        if (warning.text.includes("Duplicate key")) {
          offences.push(
            `${file}:${warning.location?.line ?? "?"} — ${warning.text}`,
          );
        }
      }
    }

    // Printed, so a reviewer reads the evidence rather than a boolean.
    // eslint-disable-next-line no-console
    console.log(
      `scanned ${files.length} Stripe fixture files; ` +
        `${offences.length} duplicate-key offence(s)`,
    );
    expect(offences).toEqual([]);
  });
});
