/**
 * The billing lapse flow on real Postgres: the grace deadline in `entitlement_active`, the webhook
 * side (first failure sets the deadline once, paid clears it, a payment-caused cancel ends access
 * with one email) and the daily job (card-needed reminders once per milestone, none once a card is
 * on file, none for an under-13 payer, the deadline cancel).
 *
 * @spec [Doc 01 §21, §22.1, §23; owner brief "Founding lapse flow" (Karl, 2026-11-24) rulings
 *       1-8; SCL-289] | @implemented [2026-11-24]
 *
 * plain English: the whole migration pipeline and the shared lifecycle scenario (real profiles),
 * with `supabaseServer` pointed at that database. Stripe is a small in-memory double whose shape
 * is parsed by the same functions that parse the real API (`toLapseSubscription`,
 * `toLapseInvoice`), so the fixtures are the Stripe objects themselves, not hand-reduced facts.
 * The email side is the real `sendBillingEvent` (its real under-13 and deleted-account rules) over
 * a recording contacts transport: what is asserted is what Resend would receive.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Client } from "pg";
import { makePgSupabase, PG_AVAILABLE } from "../helpers/pg-supabase";
import {
  DAY,
  setupLifecycleDb,
  yearsAgo,
  type LifecycleDb,
} from "./lifecycle.pg-harness";
import type { ContactsTransport } from "../../server/lib/notifications/transport";

let pgRef: Client;
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pgRef);
  },
}));
vi.mock("../../server/logger", () => {
  const noop = (): void => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

const lapse = await import("../../server/lib/stripe/billing-lapse");
const { sendBillingEvent, defaultLifecycleDeps } =
  await import("../../server/lib/lifecycle-email");

type SentEvent = {
  event: string;
  email: string;
  payload: Record<string, string>;
};

/** A Stripe subscription object as the API returns it with `expand: ["customer"]`. */
type FakeSub = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  default_payment_method: string | null;
  customer: {
    invoice_settings: { default_payment_method: string | null };
    default_source: null;
  };
  items: { data: { current_period_end: number }[] };
};

describe.skipIf(!PG_AVAILABLE)("billing lapse → real PG", () => {
  let h: LifecycleDb;
  let pg: Client;
  const sent: SentEvent[] = [];
  const subs = new Map<string, FakeSub>();
  const previews = new Map<string, { amount_due: number; currency: string }>();
  const openInvoices = new Map<string, number[]>();
  const cancelled: string[] = [];

  // The two members the billing path calls, recorded; the lifecycle harness passes its partial
  // transport the same way (`contacts as never`, lifecycle.pg-harness.ts).
  const recording: Pick<ContactsTransport, "upsertContact" | "sendEvent"> = {
    upsertContact: async () => ({ ok: true, value: { created: false } }),
    sendEvent: async (event, email, payload) => {
      sent.push({ event, email, payload });
      return { ok: true, value: true };
    },
  };

  const stripe: import("../../server/lib/stripe/billing-lapse").BillingLapseStripe =
    {
      retrieveSubscription: async (id) => {
        const raw = subs.get(id);
        if (!raw) throw new Error(`no such subscription ${id}`);
        return lapse.toLapseSubscription(raw);
      },
      previewNextInvoice: async (id) => {
        const p = previews.get(id) ?? { amount_due: 5999, currency: "usd" };
        return { amountDue: p.amount_due, currency: p.currency };
      },
      earliestUnpaidInvoiceFinalizedAt: async (id) => {
        const times = openInvoices.get(id) ?? [];
        return times.length > 0 ? Math.min(...times) : null;
      },
      cancelSubscription: async (id) => {
        cancelled.push(id);
        const s = subs.get(id);
        if (s) s.status = "canceled";
      },
    };

  function deps(
    now: Date,
  ): import("../../server/lib/stripe/billing-lapse").BillingLapseDeps {
    return {
      stripe,
      send: (payer, event, payload) =>
        sendBillingEvent(payer, event, payload, {
          ...defaultLifecycleDeps(),
          contacts: recording as never,
          env: {},
          now: () => now,
        }),
      now: () => now,
      siteUrl: "https://lyceon.test",
    };
  }

  let seq = 0;
  /** A paying student with an entitlement on subscription `sub_<n>`. */
  async function member(
    opts: {
      status?: string;
      renewsAt?: Date;
      grace?: Date | null;
      dob?: string;
      cancelAtPeriodEnd?: boolean;
    } = {},
  ): Promise<{ id: string; email: string; sub: string }> {
    seq += 1;
    const p = await h.person(opts.dob === undefined ? {} : { dob: opts.dob });
    const sub = `sub_lapse_${seq}`;
    const renewsAt =
      opts.renewsAt ?? new Date(Date.now() + 14 * DAY + 3_600_000);
    await pg.query(
      `INSERT INTO public.entitlements
         (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id,
          current_period_end, cancel_at_period_end, grace_period_ends_at)
       VALUES ($1, 'premium', $2, $3, $4, $5, $6, $7)`,
      [
        p.id,
        opts.status ?? "active",
        sub,
        `si_lapse_${seq}`,
        renewsAt.toISOString(),
        opts.cancelAtPeriodEnd === true,
        opts.grace === undefined || opts.grace === null
          ? null
          : opts.grace.toISOString(),
      ],
    );
    subs.set(sub, {
      id: sub,
      status: opts.status ?? "active",
      cancel_at_period_end: opts.cancelAtPeriodEnd === true,
      default_payment_method: null,
      customer: {
        invoice_settings: { default_payment_method: null },
        default_source: null,
      },
      items: {
        data: [{ current_period_end: Math.floor(renewsAt.getTime() / 1000) }],
      },
    });
    return { ...p, sub };
  }

  async function grace(sub: string): Promise<string | null> {
    const r = await pg.query<{ g: Date | null }>(
      `SELECT grace_period_ends_at AS g FROM public.entitlements WHERE stripe_subscription_id = $1`,
      [sub],
    );
    const g = r.rows[0]?.g ?? null;
    return g === null ? null : new Date(g).toISOString();
  }
  async function entitled(id: string): Promise<boolean> {
    return h.asProbe(async () => {
      const r = await pg.query<{ a: boolean }>(
        `SELECT public.entitlement_active($1) AS a`,
        [id],
      );
      return r.rows[0]!.a;
    });
  }
  const eventsFor = (email: string, event: string): SentEvent[] =>
    sent.filter((e) => e.email === email && e.event === event);
  const failedInvoice = (
    sub: string,
    attempt: number,
    id = `in_${sub}`,
  ): unknown => ({
    id,
    object: "invoice",
    attempt_count: attempt,
    amount_due: 5999,
    currency: "usd",
    hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: sub },
    },
  });

  beforeAll(async () => {
    h = await setupLifecycleDb("billing_lapse_pg_ci", "b1a5e000");
    pg = h.pg;
    pgRef = pg;
  }, 300_000);
  afterAll(async () => {
    await pg?.end();
  });
  beforeEach(() => {
    sent.length = 0;
    cancelled.length = 0;
  });

  describe("entitlement_active and the grace deadline", () => {
    it("past_due counts until grace_period_ends_at; an expired grace removes the entitlement; no deadline keeps Pro", async () => {
      const inGrace = await member({
        status: "past_due",
        grace: new Date(Date.now() + DAY),
      });
      const expired = await member({
        status: "past_due",
        grace: new Date(Date.now() - 60_000),
      });
      const undated = await member({ status: "past_due", grace: null });
      const active = await member({ status: "active" });
      expect(await entitled(inGrace.id)).toBe(true);
      expect(await entitled(expired.id)).toBe(false);
      expect(await entitled(undated.id)).toBe(true);
      expect(await entitled(active.id)).toBe(true);
    });

    it("the deadline only ever reaches the client as an entitlement verdict: anon and authenticated cannot read the notice ledger", async () => {
      for (const role of ["anon", "authenticated"]) {
        const r = await pg.query<{ ok: boolean }>(
          `SELECT has_table_privilege($1, 'public.billing_lapse_notices', 'SELECT') AS ok`,
          [role],
        );
        expect(r.rows[0]?.ok, role).toBe(false);
      }
    });
  });

  describe("webhook side", () => {
    it("the first failed payment sets the deadline once; later attempts keep it and each attempt is emailed once", async () => {
      const m = await member({ status: "past_due" });
      const t0 = new Date();
      expect(
        await lapse.handleInvoicePaymentFailed(
          lapse.toLapseInvoice(failedInvoice(m.sub, 1)),
          deps(t0),
        ),
      ).toBe("sent");
      const deadline = await grace(m.sub);
      expect(deadline).toBe(new Date(t0.getTime() + 7 * DAY).toISOString());

      const t3 = new Date(t0.getTime() + 3 * DAY);
      await lapse.handleInvoicePaymentFailed(
        lapse.toLapseInvoice(failedInvoice(m.sub, 2)),
        deps(t3),
      );
      expect(await grace(m.sub)).toBe(deadline);

      // A redelivered attempt 1 sends nothing new.
      expect(
        await lapse.handleInvoicePaymentFailed(
          lapse.toLapseInvoice(failedInvoice(m.sub, 1)),
          deps(t3),
        ),
      ).toBe("already_sent");

      const events = eventsFor(m.email, "lyceon.billing_payment_failed");
      expect(events.map((e) => e.payload.attempt)).toEqual(["1", "2"]);
      expect(events[0]?.payload).toEqual({
        attempt: "1",
        grace_ends_on: deadline!.slice(0, 10),
        amount: "$59.99",
        currency: "usd",
        add_card_url: "https://lyceon.test/profile?tab=billing",
        invoice_url: `https://invoice.stripe.com/i/in_${m.sub}`,
      });
      expect(events[1]?.payload.grace_ends_on).toBe(deadline!.slice(0, 10));
    });

    it("a fourth attempt still keeps the deadline but sends no email", async () => {
      const m = await member({ status: "past_due" });
      expect(
        await lapse.handleInvoicePaymentFailed(
          lapse.toLapseInvoice(failedInvoice(m.sub, 4)),
          deps(new Date()),
        ),
      ).toBe("beyond_third_attempt");
      expect(await grace(m.sub)).not.toBeNull();
      expect(eventsFor(m.email, "lyceon.billing_payment_failed")).toEqual([]);
    });

    it("a paid invoice clears the deadline", async () => {
      const m = await member({
        status: "past_due",
        grace: new Date(Date.now() + 2 * DAY),
      });
      await lapse.handleInvoicePaymentSucceeded(
        lapse.toLapseInvoice({
          ...(failedInvoice(m.sub, 2) as object),
          attempt_count: 2,
        }),
      );
      expect(await grace(m.sub)).toBeNull();
    });

    it("back in good standing clears the deadline on the subscription write; past_due leaves it", () => {
      expect(lapse.graceClearedWhenGoodStanding("active")).toEqual({
        grace_period_ends_at: null,
      });
      expect(lapse.graceClearedWhenGoodStanding("trialing")).toEqual({
        grace_period_ends_at: null,
      });
      expect(lapse.graceClearedWhenGoodStanding("past_due")).toEqual({});
      expect(lapse.graceClearedWhenGoodStanding("canceled")).toEqual({});
    });

    it("a cancel caused by non-payment sends access_ended once; a self-cancel sends nothing", async () => {
      const paymentCancel = await member({ status: "canceled" });
      const selfCancel = await member({ status: "canceled" });
      const now = new Date();
      expect(
        await lapse.handleSubscriptionDeletedForLapse(
          {
            id: selfCancel.sub,
            cancellation_details: { reason: "cancellation_requested" },
          },
          () => deps(now),
        ),
      ).toBe("not_payment");
      const first = await lapse.handleSubscriptionDeletedForLapse(
        {
          id: paymentCancel.sub,
          cancellation_details: { reason: "payment_failed" },
        },
        () => deps(now),
      );
      expect(first).toEqual({ kind: "sent" });
      expect(
        await lapse.handleSubscriptionDeletedForLapse(
          {
            id: paymentCancel.sub,
            cancellation_details: { reason: "payment_failed" },
          },
          () => deps(now),
        ),
      ).toBe("already_sent");
      expect(
        eventsFor(paymentCancel.email, "lyceon.billing_access_ended"),
      ).toEqual([
        {
          event: "lyceon.billing_access_ended",
          email: paymentCancel.email,
          payload: {
            ended_on: now.toISOString().slice(0, 10),
            reason: "payment_failed",
          },
        },
      ]);
      expect(
        eventsFor(selfCancel.email, "lyceon.billing_access_ended"),
      ).toEqual([]);
    });

    it("reads the subscription id from the invoice's parent (API 2025-03-31 and later)", () => {
      expect(
        lapse.toLapseInvoice(failedInvoice("sub_x", 1)).subscriptionId,
      ).toBe("sub_x");
      expect(
        lapse.toLapseInvoice({
          id: "in_one_off",
          amount_due: 100,
          currency: "usd",
          parent: null,
        }).subscriptionId,
      ).toBeNull();
    });
  });

  describe("the daily job", () => {
    it("reminders fire once per milestone, with the previewed amount and the true days left", async () => {
      const now = new Date();
      const renewsAt = new Date(now.getTime() + 14 * DAY + 3_600_000);
      const m = await member({ renewsAt });
      previews.set(m.sub, { amount_due: 14999, currency: "usd" });

      await lapse.runBillingLapseJob(deps(now));
      await lapse.runBillingLapseJob(deps(now)); // a rerun the same day
      const day7 = new Date(now.getTime() + 7 * DAY);
      await lapse.runBillingLapseJob(deps(day7));
      await lapse.runBillingLapseJob(deps(new Date(now.getTime() + 8 * DAY))); // still the 7 band

      const events = eventsFor(m.email, "lyceon.billing_card_needed");
      expect(events.map((e) => e.payload.days_left)).toEqual(["14", "7"]);
      expect(events[0]?.payload).toEqual({
        days_left: "14",
        invoice_date: renewsAt.toISOString().slice(0, 10),
        amount: "$149.99",
        currency: "usd",
        add_card_url: "https://lyceon.test/profile?tab=billing",
      });
    });

    it("no reminder once a card is on file (on the subscription or the customer)", async () => {
      const onSub = await member();
      const onCustomer = await member();
      subs.get(onSub.sub)!.default_payment_method = "pm_card";
      subs.get(
        onCustomer.sub,
      )!.customer.invoice_settings.default_payment_method = "pm_card";
      const summary = await lapse.runBillingLapseJob(deps(new Date()));
      expect(eventsFor(onSub.email, "lyceon.billing_card_needed")).toEqual([]);
      expect(eventsFor(onCustomer.email, "lyceon.billing_card_needed")).toEqual(
        [],
      );
      expect(summary.cardNeeded.hasCard).toBeGreaterThanOrEqual(2);
    });

    it("skips a subscription set to cancel at period end, a $0 next invoice, and an under-13 payer (counted)", async () => {
      const stopping = await member();
      subs.get(stopping.sub)!.cancel_at_period_end = true;
      const free = await member();
      previews.set(free.sub, { amount_due: 0, currency: "usd" });
      const young = await member({ dob: yearsAgo(12) });
      const summary = await lapse.runBillingLapseJob(deps(new Date()));
      for (const m of [stopping, free, young]) {
        expect(eventsFor(m.email, "lyceon.billing_card_needed"), m.sub).toEqual(
          [],
        );
      }
      expect(summary.cardNeeded.cancelAtPeriodEnd).toBeGreaterThanOrEqual(1);
      expect(summary.cardNeeded.zeroAmount).toBeGreaterThanOrEqual(1);
      expect(summary.cardNeeded.skippedUnder13).toBeGreaterThanOrEqual(1);
      // Counted once: the claim is kept, so a rerun does not count the same child again.
      const again = await lapse.runBillingLapseJob(deps(new Date()));
      expect(again.cardNeeded.skippedUnder13).toBe(0);
    });

    it("a past_due row with no deadline gets the earliest unpaid invoice + 7 days", async () => {
      const m = await member({ status: "past_due", grace: null });
      const finalized = Math.floor(Date.now() / 1000) - 2 * 86_400;
      openInvoices.set(m.sub, [finalized + 3600, finalized]);
      await lapse.runBillingLapseJob(deps(new Date()));
      expect(await grace(m.sub)).toBe(
        new Date((finalized + 7 * 86_400) * 1000).toISOString(),
      );
      expect(await entitled(m.id)).toBe(true);
    });

    it("an expired deadline cancels the subscription in Stripe and sends access_ended once; the student keeps the account", async () => {
      const m = await member({
        status: "past_due",
        grace: new Date(Date.now() - 60_000),
      });
      subs.get(m.sub)!.status = "past_due";
      const now = new Date();
      const first = await lapse.runBillingLapseJob(deps(now));
      expect(cancelled).toContain(m.sub);
      expect(first.deadlineCancelled).toBeGreaterThanOrEqual(1);
      await lapse.runBillingLapseJob(deps(now));
      expect(cancelled.filter((s) => s === m.sub)).toHaveLength(1);
      expect(eventsFor(m.email, "lyceon.billing_access_ended")).toHaveLength(1);
      expect(await entitled(m.id)).toBe(false);
      const profile = await pg.query(
        `SELECT id FROM public.profiles WHERE id = $1`,
        [m.id],
      );
      expect(profile.rows).toHaveLength(1);
    });
  });

  describe("bands", () => {
    it("milestoneFor maps days left to 14 / 7 / 2 bands, and daysUntil counts UTC dates", () => {
      expect([15, 14, 8, 7, 3, 2, 1, 0].map(lapse.milestoneFor)).toEqual([
        null,
        14,
        14,
        7,
        7,
        2,
        2,
        null,
      ]);
      const now = new Date("2026-11-26T23:30:00Z");
      expect(
        lapse.daysUntil(Date.parse("2026-12-10T00:10:00Z") / 1000, now),
      ).toBe(14);
    });
  });
});
