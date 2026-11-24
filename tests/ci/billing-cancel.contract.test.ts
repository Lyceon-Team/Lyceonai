/**
 * The cancellation routes: who may, what happens, and what happens TWICE.
 *
 * @spec [SCL-271 (cancellation at every status, never gated on a balance; every
 *        open invoice voided; access to the grace deadline); SCL-272 (our
 *        endpoint, payer-only); Charter §6 (a selection is not a claim);
 *        owner rulings Karl 2026-11-03] @implemented [2026-11-03]
 *
 * plain English: drives the real Express router with a fake Stripe that RECORDS
 * every call, so each assertion is about the call made rather than the state
 * that followed. Expected outcome: the four branches do exactly the Stripe work
 * SCL-271 names, a replay does none of it, a non-payer is refused, and no
 * entitlement row is touched by any of it.
 *
 * WHY THE FAKE RECORDS CALLS INSTEAD OF RETURNING STATE. "No second action" is a
 * claim about what was SENT. A test that only re-read the subscription would
 * pass on an implementation that re-sent `cancel_at` every time — the state
 * looks identical, and the customer gets a second email and a second webhook.
 * The call log is the only thing that can tell those apart.
 *
 * THE ENTITLEMENT GUARD IS A THROWING PROXY, not an assertion after the fact.
 * `supabaseServer.from("entitlements")` throws, so a cancel route that ever grew
 * an entitlement write would fail here loudly instead of being caught by a
 * reviewer noticing. Owner ruling 2026-11-03 clause 1 keeps the webhook the one
 * writer, and this is what holds it.
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SELF_PAYER = "c1000000-0000-4000-8000-000000000001";
const GUARDIAN = "c1000000-0000-4000-8000-000000000002";
const STUDENT_OF_GUARDIAN = "c1000000-0000-4000-8000-000000000003";
const OTHER_USER = "c1000000-0000-4000-8000-000000000004";

const SELF_CUSTOMER = "cus_self";
const GUARDIAN_CUSTOMER = "cus_guardian";
const OTHER_CUSTOMER = "cus_other";

const NOW = Math.floor(Date.now() / 1000);
const PERIOD_END = NOW + 9 * 86_400;
const INVOICE_FINALIZED = NOW - 2 * 86_400;

type FakeSub = {
  id: string;
  customer: string;
  status: string;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  items: {
    data: Array<{
      current_period_end: number;
      metadata: Record<string, string>;
    }>;
  };
  metadata: Record<string, string>;
};

const state = vi.hoisted(() => ({
  session: { id: "", role: "student" },
  /** profile id -> stripe customer id. `null` means the profile is nobody's payer. */
  customers: new Map<string, string | null>(),
  subs: new Map<string, FakeSub>(),
  openInvoices: new Map<string, Array<{ id: string; finalized: number }>>(),
  calls: [] as string[],
  emails: [] as Array<{ subscriptionId: string; accessEndsAt: string | null }>,
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => {
  const guard = {
    from(table: string) {
      if (table === "entitlements") {
        throw new Error(
          "a cancellation route must never read or write entitlements — the webhook is the one writer",
        );
      }
      throw new Error(`unexpected supabase table in a cancel test: ${table}`);
    },
  };
  return { supabaseServer: guard, supabaseAdmin: guard };
});

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireSupabaseAuth: (req: Request, res: Response, next: NextFunction) => {
      if (state.session.id === "") {
        // The logged-out case, answered the way the real middleware answers it.
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      (req as Request & { user?: unknown }).user = {
        id: state.session.id,
        email: `${state.session.id}@example.test`,
        display_name: null,
        role: state.session.role,
        isAdmin: state.session.role === "admin",
        isGuardian: state.session.role === "guardian",
        is_under_13: false,
        actor_id: state.session.id,
      };
      next();
    },
    requireGuardianLinkForUnder13: (
      _q: Request,
      _s: Response,
      next: NextFunction,
    ) => next(),
  };
});

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_q: Request, _s: Response, next: NextFunction) =>
    next(),
}));

vi.mock("../../server/lib/account", () => ({
  getProfileStripeCustomerId: async (profileId: string) =>
    state.customers.get(profileId) ?? null,
  // The cancel routes use none of these; they exist because the module is
  // imported whole by billing-routes.
  getEntitlementForProfile: async () => null,
  setProfileStripeCustomerId: async () => undefined,
  getAllGuardianStudentLinks: async () => [],
  resolveLinkedPairPremiumAccessForGuardian: async () => null,
}));

vi.mock("../../server/lib/notifications/direct-sends", () => ({
  sendSubscriptionCanceledEmail: async (input: {
    subscriptionId: string;
    accessEndsAt: string | null;
  }) => {
    state.emails.push({
      subscriptionId: input.subscriptionId,
      accessEndsAt: input.accessEndsAt,
    });
    return { ok: true, value: { providerMessageId: "msg_test" } };
  },
}));

vi.mock("../../server/logger", () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

vi.mock("../../server/lib/stripe/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/lib/stripe/client")>();
  return {
    ...actual,
    getStripeClient: () => fakeStripe(),
  };
});

/** Records every call, and mutates just enough that a replay sees the new state. */
function fakeStripe() {
  return {
    subscriptions: {
      retrieve: async (id: string) => {
        const sub = state.subs.get(id);
        if (!sub) throw new Error(`No such subscription: ${id}`);
        return sub;
      },
      list: async (params: { customer: string }) => ({
        data: [...state.subs.values()].filter(
          (s) => s.customer === params.customer,
        ),
        has_more: false,
      }),
      update: async (
        id: string,
        params: Record<string, unknown>,
        _opts?: unknown,
      ) => {
        state.calls.push(`update:${id}:${JSON.stringify(params)}`);
        const sub = state.subs.get(id);
        if (sub) {
          if ("cancel_at" in params) {
            sub.cancel_at = params.cancel_at as number | null;
          }
          if ("cancel_at_period_end" in params) {
            sub.cancel_at_period_end = params.cancel_at_period_end === true;
          }
        }
        return sub;
      },
      cancel: async (
        id: string,
        params: Record<string, unknown>,
        _opts?: unknown,
      ) => {
        state.calls.push(`cancel:${id}:${JSON.stringify(params)}`);
        const sub = state.subs.get(id);
        if (sub) sub.status = "canceled";
        return sub;
      },
    },
    invoices: {
      list: async (params: { subscription: string; status: string }) => ({
        data: (state.openInvoices.get(params.subscription) ?? []).map((i) => ({
          id: i.id,
          created: i.finalized,
          status_transitions: { finalized_at: i.finalized },
        })),
        has_more: false,
      }),
      voidInvoice: async (id: string, _p?: unknown, _o?: unknown) => {
        state.calls.push(`void:${id}`);
        for (const [sub, list] of state.openInvoices) {
          state.openInvoices.set(
            sub,
            list.filter((i) => i.id !== id),
          );
        }
        return { id, status: "void" };
      },
    },
  } as unknown as import("stripe").Stripe;
}

function sub(
  over: Partial<FakeSub> & { id: string; customer: string },
): FakeSub {
  return {
    status: "active",
    cancel_at: null,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          current_period_end: PERIOD_END,
          metadata: { student_profile_id: STUDENT_OF_GUARDIAN },
        },
      ],
    },
    metadata: {},
    ...over,
  };
}

async function buildApp(): Promise<express.Express> {
  const { default: billingRoutes } =
    await import("../../server/routes/billing-routes");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "cancel-test";
    next();
  });
  app.use("/api/billing", billingRoutes);
  return app;
}

async function post(path: string, body: unknown, id: string, role = "student") {
  state.session = { id, role };
  return request(await buildApp())
    .post(path)
    .send(body);
}

async function getState(id: string, role = "student") {
  state.session = { id, role };
  return request(await buildApp()).get("/api/billing/cancel-state");
}

beforeEach(() => {
  state.calls = [];
  state.emails = [];
  state.subs = new Map();
  state.openInvoices = new Map();
  state.customers = new Map([
    [SELF_PAYER, SELF_CUSTOMER],
    [GUARDIAN, GUARDIAN_CUSTOMER],
    // A student whose guardian pays holds no Stripe Customer of their own.
    [STUDENT_OF_GUARDIAN, null],
    [OTHER_USER, OTHER_CUSTOMER],
  ]);
  state.session = { id: SELF_PAYER, role: "student" };
});

describe("POST /api/billing/cancel — one branch per status", () => {
  it("active: sets cancel_at_period_end and promises the period's own end", async () => {
    state.subs.set("sub_a", sub({ id: "sub_a", customer: SELF_CUSTOMER }));

    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_a" },
      SELF_PAYER,
    );

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("at_period_end");
    expect(res.body.accessEndsAt).toBe(
      new Date(PERIOD_END * 1000).toISOString(),
    );
    // The canonical writer was used, and NO invoice was voided: the customer
    // keeps the period they paid for, so its invoice is theirs to pay.
    expect(state.calls.some((c) => c.startsWith("update:sub_a"))).toBe(true);
    expect(state.calls.some((c) => c.startsWith("void:"))).toBe(false);
    expect(state.calls.some((c) => c.startsWith("cancel:"))).toBe(false);
  });

  it("trialing behaves as active, founding coupon or not", async () => {
    state.subs.set(
      "sub_t",
      sub({ id: "sub_t", customer: SELF_CUSTOMER, status: "trialing" }),
    );
    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_t" },
      SELF_PAYER,
    );
    expect(res.body.decision).toBe("at_period_end");
    expect(state.calls.some((c) => c.startsWith("void:"))).toBe(false);
  });

  it("past_due: voids EVERY open invoice, pauses collection, schedules the grace deadline", async () => {
    state.subs.set(
      "sub_p",
      sub({ id: "sub_p", customer: SELF_CUSTOMER, status: "past_due" }),
    );
    // Two open invoices, not one: the defect this guards is voiding only
    // `latest_invoice` and leaving an older balance standing.
    state.openInvoices.set("sub_p", [
      { id: "in_old", finalized: INVOICE_FINALIZED },
      { id: "in_new", finalized: INVOICE_FINALIZED + 3600 },
    ]);

    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_p" },
      SELF_PAYER,
    );

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("past_due_scheduled");

    const deadline = INVOICE_FINALIZED + 7 * 86_400;
    expect(res.body.accessEndsAt).toBe(new Date(deadline * 1000).toISOString());

    const update = state.calls.find((c) => c.startsWith("update:sub_p"));
    expect(update).toBeDefined();
    expect(update).toContain('"behavior":"void"');
    expect(update).toContain(`"cancel_at":${deadline}`);

    // Both invoices, and the EARLIEST one is the anchor.
    expect(state.calls).toContain("void:in_old");
    expect(state.calls).toContain("void:in_new");
    // Not cancelled outright: that is the whole point of the branch.
    expect(state.calls.some((c) => c.startsWith("cancel:"))).toBe(false);
  });

  it("unpaid: voids the open invoices and cancels now, promising no date", async () => {
    state.subs.set(
      "sub_u",
      sub({ id: "sub_u", customer: SELF_CUSTOMER, status: "unpaid" }),
    );
    state.openInvoices.set("sub_u", [
      { id: "in_u", finalized: INVOICE_FINALIZED },
    ]);

    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_u" },
      SELF_PAYER,
    );

    expect(res.body.decision).toBe("immediate");
    // Null, not a date: `unpaid` grants nothing, so there is no access to end.
    expect(res.body.accessEndsAt).toBeNull();
    expect(state.calls).toContain("void:in_u");
    const cancel = state.calls.find((c) => c.startsWith("cancel:sub_u"));
    expect(cancel).toBeDefined();
    // Owner brief: no proration, no final invoice.
    expect(cancel).toContain('"prorate":false');
    expect(cancel).toContain('"invoice_now":false');
  });

  it("already scheduled: returns the state and takes NO action", async () => {
    state.subs.set(
      "sub_s",
      sub({
        id: "sub_s",
        customer: SELF_CUSTOMER,
        status: "active",
        cancel_at_period_end: true,
      }),
    );

    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_s" },
      SELF_PAYER,
    );

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("already_scheduled");
    expect(res.body.alreadyStopping).toBe(true);
    // The assertion that matters: nothing was SENT, and nobody was emailed.
    expect(state.calls).toEqual([]);
    expect(state.emails).toEqual([]);
  });

  it("already canceled: the same, and no error", async () => {
    state.subs.set(
      "sub_c",
      sub({ id: "sub_c", customer: SELF_CUSTOMER, status: "canceled" }),
    );
    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_c" },
      SELF_PAYER,
    );
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("already_canceled");
    expect(state.calls).toEqual([]);
    expect(state.emails).toEqual([]);
  });

  it("an unrecognised status refuses with 409 rather than guessing", async () => {
    state.subs.set(
      "sub_x",
      sub({ id: "sub_x", customer: SELF_CUSTOMER, status: "paused" }),
    );
    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_x" },
      SELF_PAYER,
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("UNSUPPORTED_SUBSCRIPTION_STATUS");
    expect(state.calls).toEqual([]);
  });
});

describe("idempotency — a double submit is one cancellation and one email", () => {
  it("the second POST sends nothing and emails nobody", async () => {
    state.subs.set(
      "sub_d",
      sub({ id: "sub_d", customer: SELF_CUSTOMER, status: "past_due" }),
    );
    state.openInvoices.set("sub_d", [
      { id: "in_d", finalized: INVOICE_FINALIZED },
    ]);

    const first = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_d" },
      SELF_PAYER,
    );
    expect(first.body.decision).toBe("past_due_scheduled");
    const afterFirst = [...state.calls];
    expect(state.emails).toHaveLength(1);

    const second = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_d" },
      SELF_PAYER,
    );

    // The replay reads Stripe, sees `cancel_at`, and performs nothing.
    expect(second.body.decision).toBe("already_scheduled");
    expect(second.body.alreadyStopping).toBe(true);
    expect(state.calls).toEqual(afterFirst);
    expect(state.emails).toHaveLength(1);
  });

  it("the email key is the subscription AND the access-end moment", async () => {
    // Not an assertion about Resend, which is mocked here, but about what the
    // route hands it: a key built from durable facts rather than a clock.
    state.subs.set("sub_k", sub({ id: "sub_k", customer: SELF_CUSTOMER }));
    await post("/api/billing/cancel", { subscriptionId: "sub_k" }, SELF_PAYER);
    expect(state.emails).toEqual([
      {
        subscriptionId: "sub_k",
        accessEndsAt: new Date(PERIOD_END * 1000).toISOString(),
      },
    ]);
  });
});

describe("payer-only authorization", () => {
  it("the student is refused when the guardian pays", async () => {
    state.subs.set(
      "sub_g",
      sub({
        id: "sub_g",
        customer: GUARDIAN_CUSTOMER,
        metadata: { payer_profile_id: GUARDIAN },
      }),
    );

    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_g" },
      STUDENT_OF_GUARDIAN,
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NO_STRIPE_CUSTOMER");
    expect(state.calls).toEqual([]);
  });

  /**
   * The edge `BillingSection` annotates: a student who once paid for themselves
   * and is now funded by a guardian still HOLDS a Stripe Customer, so they are
   * not refused at `NO_STRIPE_CUSTOMER` like the case above — the payer
   * comparison itself has to refuse them. Without this case the comparison
   * would be unproven on the student path, since the test above passes for the
   * earlier reason.
   */
  it("a student who has their own Customer is still refused the guardian's subscription", async () => {
    state.customers.set(STUDENT_OF_GUARDIAN, "cus_student_legacy");
    state.subs.set(
      "sub_g2",
      sub({ id: "sub_g2", customer: GUARDIAN_CUSTOMER }),
    );

    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_g2" },
      STUDENT_OF_GUARDIAN,
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_THE_PAYER");
    expect(state.calls).toEqual([]);
  });

  it("the guardian is refused when the student pays for themselves", async () => {
    state.subs.set(
      "sub_self",
      sub({ id: "sub_self", customer: SELF_CUSTOMER }),
    );

    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_self" },
      GUARDIAN,
      "guardian",
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_THE_PAYER");
    expect(state.calls).toEqual([]);
  });

  it("another signed-in user naming someone else's subscription is refused", async () => {
    state.subs.set("sub_v", sub({ id: "sub_v", customer: SELF_CUSTOMER }));

    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_v" },
      OTHER_USER,
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_THE_PAYER");
    expect(state.calls).toEqual([]);
  });

  it("a logged-out request is refused", async () => {
    state.subs.set("sub_l", sub({ id: "sub_l", customer: SELF_CUSTOMER }));
    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_l" },
      "",
    );
    expect(res.status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("an admin is refused", async () => {
    state.subs.set("sub_adm", sub({ id: "sub_adm", customer: SELF_CUSTOMER }));
    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_adm" },
      SELF_PAYER,
      "admin",
    );
    expect(res.status).toBe(403);
    expect(state.calls).toEqual([]);
  });
});

describe("a tampered client request cannot change the outcome", () => {
  it("extra keys are rejected outright by the strict schema", async () => {
    state.subs.set(
      "sub_tamper",
      sub({ id: "sub_tamper", customer: SELF_CUSTOMER, status: "past_due" }),
    );
    state.openInvoices.set("sub_tamper", [
      { id: "in_t", finalized: INVOICE_FINALIZED },
    ]);

    // The shapes a client would reach for to skip the voiding step or to keep
    // premium: a decision, a date, a status. `.strict()` refuses the body.
    const res = await request(await buildApp())
      .post("/api/billing/cancel")
      .send({
        subscriptionId: "sub_tamper",
        decision: "at_period_end",
        accessEndsAt: new Date((NOW + 999 * 86_400) * 1000).toISOString(),
        stripeStatus: "active",
      });

    expect(res.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("a valid request cannot smuggle a decision: the server re-derives it", async () => {
    state.subs.set(
      "sub_re",
      sub({ id: "sub_re", customer: SELF_CUSTOMER, status: "past_due" }),
    );
    state.openInvoices.set("sub_re", [
      { id: "in_r", finalized: INVOICE_FINALIZED },
    ]);

    const res = await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_re" },
      SELF_PAYER,
    );

    // Stripe said `past_due`, so the answer is the `past_due` branch whatever
    // the client believes — and the date is the server's deadline.
    expect(res.body.decision).toBe("past_due_scheduled");
    expect(res.body.accessEndsAt).toBe(
      new Date((INVOICE_FINALIZED + 7 * 86_400) * 1000).toISOString(),
    );
  });
});

describe("GET /api/billing/cancel-state — the button is the server's answer", () => {
  it("a student whose guardian pays gets an empty list, not an error", async () => {
    state.subs.set(
      "sub_gs",
      sub({ id: "sub_gs", customer: GUARDIAN_CUSTOMER }),
    );
    const res = await getState(STUDENT_OF_GUARDIAN);
    expect(res.status).toBe(200);
    expect(res.body.subscriptions).toEqual([]);
  });

  it("the guardian gets a row per funded student, labelled with the student", async () => {
    state.subs.set(
      "sub_one",
      sub({ id: "sub_one", customer: GUARDIAN_CUSTOMER }),
    );
    const res = await getState(GUARDIAN, "guardian");
    expect(res.status).toBe(200);
    expect(res.body.subscriptions).toHaveLength(1);
    expect(res.body.subscriptions[0].studentProfileId).toBe(
      STUDENT_OF_GUARDIAN,
    );
    expect(res.body.subscriptions[0].decision).toBe("at_period_end");
    expect(res.body.subscriptions[0].undoable).toBe(false);
  });

  it("a scheduled cancellation reports its date and is undoable", async () => {
    const when = NOW + 4 * 86_400;
    state.subs.set(
      "sub_sched",
      sub({
        id: "sub_sched",
        customer: SELF_CUSTOMER,
        status: "past_due",
        cancel_at: when,
      }),
    );
    const res = await getState(SELF_PAYER);
    expect(res.body.subscriptions[0].decision).toBe("already_scheduled");
    expect(res.body.subscriptions[0].cancelAt).toBe(
      new Date(when * 1000).toISOString(),
    );
    expect(res.body.subscriptions[0].undoable).toBe(true);
    // A read must never mutate: cancel-state sends nothing.
    expect(state.calls).toEqual([]);
  });
});

describe("POST /api/billing/cancel/undo", () => {
  it("clears a scheduled cancellation and resumes collection", async () => {
    state.subs.set(
      "sub_undo",
      sub({
        id: "sub_undo",
        customer: SELF_CUSTOMER,
        status: "past_due",
        cancel_at: NOW + 5 * 86_400,
      }),
    );

    const res = await post(
      "/api/billing/cancel/undo",
      { subscriptionId: "sub_undo" },
      SELF_PAYER,
    );

    expect(res.status).toBe(200);
    expect(res.body.restored).toBe(true);
    const update = state.calls.find((c) => c.startsWith("update:sub_undo"));
    expect(update).toBeDefined();
    expect(update).toContain('"cancel_at":null');
    // Collection must resume, or the subscription is restored unable to bill.
    expect(update).toContain('"pause_collection":null');
  });

  it("nothing scheduled is not an error", async () => {
    state.subs.set("sub_n", sub({ id: "sub_n", customer: SELF_CUSTOMER }));
    const res = await post(
      "/api/billing/cancel/undo",
      { subscriptionId: "sub_n" },
      SELF_PAYER,
    );
    expect(res.status).toBe(200);
    expect(res.body.restored).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("a cancelled subscription cannot be revived", async () => {
    state.subs.set(
      "sub_dead",
      sub({ id: "sub_dead", customer: SELF_CUSTOMER, status: "canceled" }),
    );
    const res = await post(
      "/api/billing/cancel/undo",
      { subscriptionId: "sub_dead" },
      SELF_PAYER,
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_CANCELED");
  });

  it("a non-payer cannot undo either", async () => {
    state.subs.set(
      "sub_gu",
      sub({
        id: "sub_gu",
        customer: GUARDIAN_CUSTOMER,
        cancel_at_period_end: true,
      }),
    );
    const res = await post(
      "/api/billing/cancel/undo",
      { subscriptionId: "sub_gu" },
      STUDENT_OF_GUARDIAN,
    );
    expect(res.status).toBe(403);
    expect(state.calls).toEqual([]);
  });
});

describe("the handoff to the webhook — access ends at the right moment", () => {
  /**
   * THE HALF THIS PR OWNS. Revocation itself is already proven elsewhere and is
   * deliberately not duplicated here:
   *   - `customer.subscription.deleted` writes the student to `free`, and only
   *     that student — `tests/ci/guardian-one-subscription-per-student.contract.test.ts:509`.
   *   - a `canceled` row makes `entitlement_active` false in real PostgreSQL —
   *     `tests/ci/entitlement-write-path.ci.test.ts:537`.
   * What those cannot show is that OUR cancellation leaves Stripe in a state
   * whose eventual event is the revoking one, and not before. That is here.
   */
  it("past_due: the subscription still grants today, and is scheduled to stop at the deadline", async () => {
    state.subs.set(
      "sub_handoff",
      sub({ id: "sub_handoff", customer: SELF_CUSTOMER, status: "past_due" }),
    );
    state.openInvoices.set("sub_handoff", [
      { id: "in_h", finalized: INVOICE_FINALIZED },
    ]);

    await post(
      "/api/billing/cancel",
      { subscriptionId: "sub_handoff" },
      SELF_PAYER,
    );

    const after = state.subs.get("sub_handoff");
    // STILL `past_due`, which `entitlement_active` grants
    // (20260616120000_entitlement_active_include_trialing.sql). Access has not
    // ended, which is the ruling: never earlier than doing nothing would.
    expect(after?.status).toBe("past_due");
    // And the revoking event is scheduled, not sent.
    expect(after?.cancel_at).toBe(INVOICE_FINALIZED + 7 * 86_400);
    expect(after?.cancel_at).toBeGreaterThan(NOW);
    // `cancel_at_period_end` is NOT the mechanism here: the period end is a
    // date nobody has paid for.
    expect(after?.cancel_at_period_end).toBe(false);
  });

  it("active: the subscription still grants, and stops at the period it paid for", async () => {
    state.subs.set("sub_ha", sub({ id: "sub_ha", customer: SELF_CUSTOMER }));

    await post("/api/billing/cancel", { subscriptionId: "sub_ha" }, SELF_PAYER);

    const after = state.subs.get("sub_ha");
    expect(after?.status).toBe("active");
    expect(after?.cancel_at_period_end).toBe(true);
  });

  it("unpaid: cancelled now, because there was no access to preserve", async () => {
    state.subs.set(
      "sub_hu",
      sub({ id: "sub_hu", customer: SELF_CUSTOMER, status: "unpaid" }),
    );
    await post("/api/billing/cancel", { subscriptionId: "sub_hu" }, SELF_PAYER);
    // `canceled` is the status the two cited tests prove revokes.
    expect(state.subs.get("sub_hu")?.status).toBe("canceled");
  });
});
