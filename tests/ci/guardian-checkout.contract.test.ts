/**
 * §4.8 guardian-paid purchase — PER STUDENT, and the item-level entitlement write.
 *
 * @spec [Doc 01 V8 §20 "Who pays"; §31.4; §36.4; SCL-043 payer identity;
 *        SCL-045 one SubscriptionItem per student; Charter §6]
 * @implemented [2026-08-27] | @revised [2026-08-28 — owner ruling: per-student]
 *
 * plain English: proves a guardian buys for ONE selected student at a time, that
 * a student they are not linked to is refused, and that the webhook writes one
 * entitlement row per funded item. Expected outcome: the guardian is charged for
 * the child they chose and nobody else. Trade-off: the Stripe API and the
 * database are stubbed; the selection rule is pure so it is tested directly, and
 * the write path runs through the REAL handler.
 *
 * Edge cases that carry the ruling: NO student selected (must refuse rather than
 * default, even with exactly one link — that is how cover-all would creep back),
 * a student already funded, and items arriving with no metadata.
 *
 * @revised [2026-09-01 — Gate A + Gate B: links and the event ledger come from Postgres]
 *
 * WHY THE ROWS ARE NOT WRITTEN HERE (guardian schema-truth gate, RULES A and B).
 * This file used to mock `supabase-server` with `from: () => ({ insert, delete })`
 * and feed the resolver a `link()` factory spelling twelve column names by hand.
 * Both were private copies of the schema, reconciled against nothing. They are
 * replaced by real `guardian_links` rows INSERTed into a database built from
 * `supabase/migrations` and read back through `GUARDIAN_LINK_COLUMNS` — the same
 * projection the production reader uses — then parsed with `guardianLinkSchema`,
 * so a renamed column fails here instead of agreeing with itself.
 *
 * WHAT THE REAL LEDGER IMMEDIATELY EXPOSED. `claimEvent` inserts into
 * `stripe_webhook_events`, whose `id` is the PRIMARY KEY and whose 23505 is the
 * idempotency gate. Against the old always-succeeds mock, every test reused the
 * event id `evt_guardian_sub` — and the "A survives B being added" case sent it
 * TWICE, which against a real ledger is a replay Stripe would decline to
 * reprocess. Each event now carries its own id, which is what Stripe actually
 * sends, and the gate is exercised rather than stubbed past.
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
import Stripe from "stripe";
import type { Client } from "pg";
import {
  GUARDIAN_LINK_COLUMNS,
  guardianLinkSchema,
} from "@lyceon/shared/guardian-link-schema";
import type { GuardianLink } from "@lyceon/shared/guardian-link-schema";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import {
  resolveGuardianPurchaseSubject,
  subscriptionAlreadyFundsStudent,
} from "../../server/lib/stripe/guardian-checkout";

const WEBHOOK_SECRET = "whsec_test_secret_for_guardian_checkout";
const GUARDIAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STUDENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STUDENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRICE = "price_guardian_test";

const DB_NAME = "guardian_checkout_ci";

let pg: Client;
/** Real rows, read back from Postgres in `beforeAll`. Never spelled by hand. */
let LINK_A: GuardianLink;
let LINK_B: GuardianLink;

async function seedLink(
  studentProfileId: string,
  createdAt: string,
): Promise<void> {
  await pg.query(
    `INSERT INTO public.guardian_links
       (guardian_profile_id, student_profile_id, status, initiated_by,
        initiated_at, accepted_at, accepted_by_profile_id, created_at)
     VALUES ($1,$2,'active','guardian',$3,$3,$2,$3)`,
    [GUARDIAN, studentProfileId, createdAt],
  );
}

/**
 * Read a link back through the SAME projection the production reader uses, and
 * parse it with the SAME schema. If `GUARDIAN_LINK_COLUMNS` and the table ever
 * disagree, this raises 42703 rather than handing the resolver a shape that
 * exists nowhere.
 */
async function readLink(studentProfileId: string): Promise<GuardianLink> {
  const r = await pg.query(
    `SELECT ${GUARDIAN_LINK_COLUMNS} FROM public.guardian_links
      WHERE student_profile_id = $1`,
    [studentProfileId],
  );
  expect(r.rowCount).toBe(1);
  return guardianLinkSchema.parse(r.rows[0]);
}

/** Bootstrap shared by both halves of this file. */
async function setUpDatabase(): Promise<void> {
  pg = await bootstrapPgDatabase(DB_NAME);
  await pg.query(
    `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6)`,
    [
      GUARDIAN,
      "guardian@example.test",
      STUDENT_A,
      "student.a@example.test",
      STUDENT_B,
      "student.b@example.test",
    ],
  );
  await pg.query(
    `INSERT INTO public.profiles (id, email, role) VALUES
       ($1,$2,'guardian'),($3,$4,'student'),($5,$6,'student')`,
    [
      GUARDIAN,
      "guardian@example.test",
      STUDENT_A,
      "student.a@example.test",
      STUDENT_B,
      "student.b@example.test",
    ],
  );
  await seedLink(STUDENT_A, "2026-01-01T00:00:00Z");
  await seedLink(STUDENT_B, "2026-02-01T00:00:00Z");
  LINK_A = await readLink(STUDENT_A);
  LINK_B = await readLink(STUDENT_B);
}

/**
 * OWNER RULING 2026-08-28 — guardian purchase is PER STUDENT, selected by the
 * guardian. These tests replace the cover-all-links suite: that behaviour
 * charged a guardian for every linked child the moment they pressed Subscribe,
 * was never ruled, and is now reversed.
 */
// One database for the file. Guarded so a machine with no Postgres skips rather
// than erroring in a hook, which reports as an infrastructure failure and buries
// the real signal.
beforeAll(async () => {
  if (PG_AVAILABLE) await setUpDatabase();
});
afterAll(async () => {
  if (pg) await pg.end();
});

describe.skipIf(!PG_AVAILABLE)(
  "resolveGuardianPurchaseSubject (§20, §31.4, §36.4)",
  () => {
    const links = (): GuardianLink[] => [LINK_A, LINK_B];

    it("returns the selected student when the guardian is actively linked to them", () => {
      const subject = resolveGuardianPurchaseSubject(links(), STUDENT_B);
      expect(subject.ok).toBe(true);
      if (!subject.ok) return;
      expect(subject.studentProfileId).toBe(STUDENT_B);
    });

    it("refuses a student the guardian is NOT linked to — the request selects, the server authorises", () => {
      const stranger = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      const subject = resolveGuardianPurchaseSubject(links(), stranger);
      expect(subject.ok).toBe(false);
      if (subject.ok) return;
      expect(subject.code).toBe("STUDENT_NOT_LINKED");
    });

    it("refuses when no student is selected, rather than defaulting to one", () => {
      // The load-bearing case. If this ever starts returning a student, the
      // cover-all default has been reintroduced by another name: a guardian would
      // be charged for a child they never chose.
      const subject = resolveGuardianPurchaseSubject(links(), undefined);
      expect(subject.ok).toBe(false);
      if (subject.ok) return;
      expect(subject.code).toBe("STUDENT_NOT_SELECTED");
    });

    it("refuses to default even when the guardian has exactly ONE link", () => {
      const subject = resolveGuardianPurchaseSubject([LINK_A], undefined);
      expect(subject.ok).toBe(false);
      if (subject.ok) return;
      expect(subject.code).toBe("STUDENT_NOT_SELECTED");
    });

    it("refuses a guardian with no active links rather than charging for nobody", () => {
      const subject = resolveGuardianPurchaseSubject([], STUDENT_A);
      expect(subject.ok).toBe(false);
      if (subject.ok) return;
      expect(subject.code).toBe("NO_ACTIVE_LINKED_STUDENTS");
    });
  },
);

// Pure predicate over Stripe item metadata — no database in the path, so this
// half keeps running in the general suite whether or not Postgres is present.
describe("subscriptionAlreadyFundsStudent", () => {
  it("detects a student already funded by an item, so nobody is billed twice", () => {
    const items = [
      { metadata: { student_profile_id: STUDENT_A } },
      { metadata: { student_profile_id: STUDENT_B } },
    ];
    expect(subscriptionAlreadyFundsStudent(items, STUDENT_A)).toBe(true);
    expect(
      subscriptionAlreadyFundsStudent(
        items,
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ),
    ).toBe(false);
  });

  it("treats an item with no metadata as funding nobody", () => {
    expect(
      subscriptionAlreadyFundsStudent([{ metadata: null }], STUDENT_A),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The webhook half: N items -> N entitlement rows.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({ expectedLivemode: false }));
const accountMocks = vi.hoisted(() => ({
  upsertEntitlement: vi.fn(async () => ({})),
  mapStripeStatusToEntitlement: vi.fn((s: string) => ({
    tier: s === "active" ? "premium" : "free",
    status: s,
  })),
  getEntitlementsBySubscriptionId: vi.fn(),
  getAllGuardianStudentLinks: vi.fn(async () => []),
}));
const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsResume: vi.fn(),
  subscriptionsList: vi.fn(),
  chargesRetrieve: vi.fn(),
  // INV-03-08 now gates EVERY grant, so the writer reads the payer\'s
  // Customer. Eligible by default here; denial has its own suites.
  customersRetrieve: vi.fn(async () => ({
    id: "cus_test_1",
    address: { country: "US" },
  })),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_guardian_checkout_placeholder");
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
      customers: { retrieve: stripeApi.customersRetrieve },
    }),
    getExpectedLivemode: () => state.expectedLivemode,
  };
});
// TRANSPORT ONLY. `claimEvent` now inserts into a REAL `stripe_webhook_events`
// table, so the insert-once idempotency gate — a 23505 on the primary key — is
// exercised instead of stubbed past.
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
}));
vi.mock("../../server/lib/account", () => ({
  upsertEntitlement: accountMocks.upsertEntitlement,
  mapStripeStatusToEntitlement: accountMocks.mapStripeStatusToEntitlement,
  getEntitlementsBySubscriptionId: accountMocks.getEntitlementsBySubscriptionId,
  getAllGuardianStudentLinks: accountMocks.getAllGuardianStudentLinks,
}));
vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  // The country gate now runs on checkout.session.completed. These suites are
  // about disputes/refunds/guardian writes, so the Tier-1 list is seeded
  // eligible here — the gate has its OWN suite
  // (tests/ci/stripe-country-gate.contract.test.ts) where denial is the subject.
  getTier1Countries: vi.fn(async () => ["US", "CA", "GB"]),
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function item(id: string, studentProfileId: string | null) {
  return {
    id,
    object: "subscription_item",
    current_period_start: 1_756_000_000,
    current_period_end: 1_758_600_000,
    price: { id: PRICE },
    metadata: studentProfileId ? { student_profile_id: studentProfileId } : {},
  };
}

function signedSubscriptionEvent(eventId = "evt_guardian_sub") {
  const event = {
    id: eventId,
    object: "event",
    type: "customer.subscription.updated",
    livemode: false,
    data: {
      object: {
        id: "sub_guardian_1",
        object: "subscription",
        // SUBSCRIPTION metadata names the PAYER, not any one student (SCL-043).
        metadata: { payer_profile_id: GUARDIAN },
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

describe.skipIf(!PG_AVAILABLE)(
  "a guardian subscription writes one entitlement row per student",
  () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      state.expectedLivemode = false;
      // Each case owns the ledger it writes into. Without this every case after
      // the first would replay an id already claimed by the previous one — which
      // is precisely the gate working, and not what these cases are about.
      await pg.query(`DELETE FROM public.stripe_webhook_events`);
      // Charter §6 (Codex HIGH-3): the writer authorises every item subject
      // against the payer's ACTIVE links, read server-side. Both students are
      // linked here; the refusal case has its own test below.
      accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
        LINK_A,
        LINK_B,
      ]);
    });

    it("writes TWO rows for two students, each keyed to its own item", async () => {
      stripeApi.subscriptionsRetrieve.mockResolvedValue({
        id: "sub_guardian_1",
        object: "subscription",
        customer: "cus_test_1",
        status: "active",
        // SCL-043 / Charter §6: the RETRIEVED subscription names the payer, and
        // the writer resolves that payer's active links server-side.
        metadata: { payer_profile_id: GUARDIAN },
        items: {
          object: "list",
          data: [item("si_a", STUDENT_A), item("si_b", STUDENT_B)],
        },
      });

      const process_ = await handler();
      const { body, signature } = signedSubscriptionEvent();
      const outcome = await process_(body, signature, "req_guardian");

      expect(outcome).toMatchObject({ ok: true, status: "processed" });
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(2);
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
        STUDENT_A,
        expect.objectContaining({
          tier: "premium",
          stripe_subscription_item_id: "si_a",
        }),
      );
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
        STUDENT_B,
        expect.objectContaining({
          tier: "premium",
          stripe_subscription_item_id: "si_b",
        }),
      );
    });

    /**
     * THE SEPARATION THE GUARDIAN PATH EXISTS FOR, PROVED SEQUENTIALLY.
     *
     * @spec [Doc 01 V8 §20 "Who pays"; §31.1 "Guardians do NOT have their own
     *        entitlement"; §31.4; §36.4; SCL-043 payer identity;
     *        SCL-045 one SubscriptionItem per student]
     *
     * The Stripe Customer is the GUARDIAN; the entitlement is the STUDENT's. The
     * existing sibling test writes both students in ONE event, which cannot
     * distinguish "each item wrote its own row" from "the last write won". This
     * one buys for A, then later adds B, and asserts A is still premium on A's own
     * item afterwards.
     *
     * Two distinct failures are in scope and both are caught here: keying the row
     * to the PAYER (the guardian would hold the entitlement and neither child
     * would), and letting the second purchase overwrite or drop the first.
     */
    it("keys entitlement to the STUDENT, not the paying guardian, and A survives B being added", async () => {
      const process_ = await handler();

      // ---- FIRST PURCHASE: only student A is funded ----------------------
      stripeApi.subscriptionsRetrieve.mockResolvedValue({
        id: "sub_guardian_1",
        object: "subscription",
        // The Customer is the GUARDIAN's. Nothing about that makes the guardian
        // the entitled party.
        customer: "cus_test_1",
        status: "active",
        metadata: { payer_profile_id: GUARDIAN },
        items: { object: "list", data: [item("si_a", STUDENT_A)] },
      });

      const first = signedSubscriptionEvent("evt_guardian_sub_first");
      const firstOutcome = await process_(first.body, first.signature, "req_a");

      expect(firstOutcome).toMatchObject({ ok: true, status: "processed" });
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(1);
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
        STUDENT_A,
        expect.objectContaining({
          tier: "premium",
          stripe_subscription_item_id: "si_a",
        }),
      );
      // The payer holds NO entitlement row of their own (§31.1).
      const payerWrites = accountMocks.upsertEntitlement.mock.calls.filter(
        (c: unknown[]) => c[0] === GUARDIAN,
      );
      expect(payerWrites).toEqual([]);

      // ---- LATER: the guardian adds student B to the SAME subscription ----
      accountMocks.upsertEntitlement.mockClear();
      stripeApi.subscriptionsRetrieve.mockResolvedValue({
        id: "sub_guardian_1",
        object: "subscription",
        customer: "cus_test_1",
        status: "active",
        metadata: { payer_profile_id: GUARDIAN },
        items: {
          object: "list",
          data: [item("si_a", STUDENT_A), item("si_b", STUDENT_B)],
        },
      });

      const second = signedSubscriptionEvent("evt_guardian_sub_second");
      const secondOutcome = await process_(
        second.body,
        second.signature,
        "req_b",
      );

      expect(secondOutcome).toMatchObject({ ok: true, status: "processed" });

      // A SURVIVES: still premium, still keyed to A's own item — not dropped, and
      // not re-pointed at B's item.
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
        STUDENT_A,
        expect.objectContaining({
          tier: "premium",
          stripe_subscription_item_id: "si_a",
        }),
      );
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
        STUDENT_B,
        expect.objectContaining({
          tier: "premium",
          stripe_subscription_item_id: "si_b",
        }),
      );
      // Still nothing on the payer after a second purchase.
      expect(
        accountMocks.upsertEntitlement.mock.calls.filter(
          (c: unknown[]) => c[0] === GUARDIAN,
        ),
      ).toEqual([]);
    });

    /**
     * CHARTER §6 — Codex HIGH-3. The writer previously entitled whatever uuid an
     * item carried, without ever asking whether the payer was linked to that
     * student. `getAllGuardianStudentLinks` existed and was not called.
     *
     * ALL OR NOTHING: the authorised sibling must NOT be written either. Writing
     * the students who did resolve would grant paid access off a payload we have
     * just established we cannot trust.
     */
    it("REFUSES the whole event when an item names a student the payer is not linked to", async () => {
      const UNLINKED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      stripeApi.subscriptionsRetrieve.mockResolvedValue({
        id: "sub_guardian_1",
        object: "subscription",
        customer: "cus_test_1",
        status: "active",
        metadata: { payer_profile_id: GUARDIAN },
        items: {
          object: "list",
          data: [item("si_a", STUDENT_A), item("si_x", UNLINKED)],
        },
      });
      // The server-read link set does NOT contain UNLINKED.
      accountMocks.getAllGuardianStudentLinks.mockResolvedValue([LINK_A]);

      const process_ = await handler();
      const { body, signature } = signedSubscriptionEvent();

      await expect(
        process_(body, signature, "req_guardian_unlinked"),
      ).rejects.toThrow(/not actively linked/);

      // Both halves: the refusal AND the absence of a partial write.
      expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    });

    it("REFUSES when the subscription names no payer at all", async () => {
      stripeApi.subscriptionsRetrieve.mockResolvedValue({
        id: "sub_guardian_1",
        object: "subscription",
        customer: "cus_test_1",
        status: "active",
        // No payer_profile_id: nothing to resolve links against, so nothing can
        // be authorised. Refuse rather than fall back to trusting the metadata.
        items: {
          object: "list",
          data: [item("si_a", STUDENT_A), item("si_b", STUDENT_B)],
        },
      });

      const process_ = await handler();
      const { body, signature } = signedSubscriptionEvent();

      await expect(
        process_(body, signature, "req_guardian_nopayer"),
      ).rejects.toThrow(/carries no payer_profile_id/);
      expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    });

    /**
     * REPLACES the hollow test Codex found (HIGH-7). The previous version
     * supplied bare items AND payer-only subscription metadata, so it never
     * reached the N-row branch at all — it passed through the single-subject
     * failure path, and deleting the writer's zero-write guard left it GREEN
     * while it was cited as the reason guardian work could ship ahead of the
     * metadata probe.
     *
     * This drives the ACTUAL seam: the subscription IS guardian-paid (so the
     * dispatcher takes the item path) and the items are bare (so the writer's own
     * guard is what must refuse). Proven by deleting that guard and observing the
     * failure.
     */
    it("grants NOTHING when items carry no student metadata — the unverified-propagation case", async () => {
      // If Checkout does not propagate `line_items[].metadata` onto the
      // SubscriptionItem — the one mechanism §4.8's plan could not verify without
      // a Stripe key — items arrive bare. The requirement is that this grants
      // nothing rather than granting the WRONG student.
      stripeApi.subscriptionsRetrieve.mockResolvedValue({
        id: "sub_guardian_1",
        object: "subscription",
        customer: "cus_test_1",
        status: "active",
        // Guardian-paid, so the dispatcher takes the ITEM path even though no
        // item names a student — which is what puts the writer's zero-candidate
        // guard on the execution path instead of the single-subject resolver.
        metadata: { payer_profile_id: GUARDIAN },
        items: {
          object: "list",
          data: [item("si_a", null), item("si_b", null)],
        },
      });

      const process_ = await handler();
      const { body, signature } = signedSubscriptionEvent();

      // The writer's own guard is what refuses here — named in the assertion so
      // this cannot silently start passing through some other failure path.
      await expect(
        process_(body, signature, "req_guardian_bare"),
      ).rejects.toThrow(/none carries student_profile_id/);
      expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    });

    it("a PAUSED guardian subscription writes every student to free", async () => {
      stripeApi.subscriptionsRetrieve.mockResolvedValue({
        id: "sub_guardian_1",
        object: "subscription",
        customer: "cus_test_1",
        status: "active",
        // SCL-043 / Charter §6: the RETRIEVED subscription names the payer, and
        // the writer resolves that payer's active links server-side.
        metadata: { payer_profile_id: GUARDIAN }, // Stripe still says active while collection is paused
        pause_collection: { behavior: "keep_as_draft", resumes_at: null },
        items: {
          object: "list",
          data: [item("si_a", STUDENT_A), item("si_b", STUDENT_B)],
        },
      });

      const process_ = await handler();
      const { body, signature } = signedSubscriptionEvent();
      await process_(body, signature, "req_guardian_paused");

      // The fan-out consequence, made visible: one chargeback on the guardian's
      // invoice suspends every student on it. Argued in the 4.8 plan §7a.
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(2);
      for (const student of [STUDENT_A, STUDENT_B]) {
        expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
          student,
          expect.objectContaining({ tier: "free" }),
        );
      }
    });
  },
);
