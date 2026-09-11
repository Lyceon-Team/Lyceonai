/**
 * §31.3 — a guardian's premium derives from ANY ONE active premium student.
 *
 * @spec [Doc 01 V8 §31.3; SP25-001 single evaluator] | @implemented [2026-08-27]
 * @revised [2026-09-01 — Gate A: the links come from Postgres, not a fake query chain]
 *
 * plain English: proves a guardian with two linked students gets premium when
 * EITHER is premium — including when it is the second one, which is the case
 * that was broken. Expected outcome: the fold looks past the first link.
 * Trade-off: the ENTITLEMENT EVALUATOR is still stubbed, because this pins the
 * FOLD and not the evaluator's internals — that is a different module with its
 * own coverage, and stubbing it is what lets the short-circuit assertion below
 * count calls. The QUERY LAYER is not stubbed. Edge cases: no links at all, a
 * revoked link, and links present but no entitled student, which must stay
 * distinguishable from one another.
 *
 * The defect this guards: `getPrimaryGuardianLink` returns the OLDEST active
 * link, so a guardian whose SECOND student is the premium one derived `free`.
 *
 * WHY THE ROWS ARE NOT WRITTEN HERE (guardian schema-truth gate, RULE A).
 * This file used to mock `supabase-server` with a hand-built `.select().eq()
 * .eq().order()` chain and feed it a `link()` factory spelling twelve column
 * names. Both halves were guesses: the chain guessed which builder methods
 * `getAllGuardianStudentLinks` calls, and the factory guessed the columns. Two
 * guesses agreeing with each other is what green looked like while
 * `guardian_consent_requests` was queried on columns that do not exist. The
 * links are now INSERTed into a real `guardian_links` table built from
 * `supabase/migrations` and read back through the real reader, so a renamed
 * column or a builder call the harness does not implement fails here.
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
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "guardian_premium_fold_ci";

const GUARDIAN = "11111111-1111-4111-8111-111111111111";
const STUDENT_A = "22222222-2222-4222-8222-222222222222";
const STUDENT_B = "33333333-3333-4333-8333-333333333333";

let pg: Client;

const dbMocks = vi.hoisted(() => ({ isActive: vi.fn() }));

// TRANSPORT ONLY. `supabaseServer` is backed by a live pg.Client — the mock is
// the seam, not the substitute (see tests/helpers/pg-supabase.ts).
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
}));

// The EVALUATOR, deliberately stubbed: this suite pins the fold over links, and
// counting its calls is how the short-circuit is proved.
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: dbMocks.isActive,
  },
}));

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * Insert a real link row. Every column the reader projects is written by
 * Postgres, so nothing here restates the schema: a column that does not exist
 * raises 42703 on INSERT instead of passing against an invented shape.
 */
async function seedLink(
  studentProfileId: string,
  createdAt: string,
  status: "active" | "revoked" = "active",
): Promise<void> {
  await pg.query(
    `INSERT INTO public.guardian_links
       (guardian_profile_id, student_profile_id, status, initiated_by,
        initiated_at, accepted_at, accepted_by_profile_id, created_at,
        revoked_at, revoked_by_profile_id, revocation_reason)
     VALUES ($1,$2,$3,'guardian',$4,$4,$2,$4,$5,$6,$7)`,
    [
      GUARDIAN,
      studentProfileId,
      status,
      createdAt,
      status === "revoked" ? createdAt : null,
      status === "revoked" ? GUARDIAN : null,
      status === "revoked" ? "guardian_revoked" : null,
    ],
  );
}

/**
 * Insert a real `entitlements` row.
 *
 * The fold now reads `tier` and `status` from this table, because §31.2's
 * derivation is `snap.isActive && snap.tier === 'premium'` and the tier half was
 * missing until 2026-09-03. The evaluator stub answers the STANDING-GOOD half
 * (so its calls can still be counted); Postgres answers the product half. A
 * student with no row is `free`/`missing`, which is the state of everyone who
 * has never bought anything.
 */
async function seedEntitlement(
  profileId: string,
  status: string,
  tier: "premium" | "free" = "premium",
): Promise<void> {
  await pg.query(
    `INSERT INTO public.entitlements (profile_id, tier, status)
     VALUES ($1,$2,$3)
     ON CONFLICT (profile_id) DO UPDATE SET tier = EXCLUDED.tier, status = EXCLUDED.status`,
    [profileId, tier, status],
  );
}

async function resolver() {
  return (await import("../../server/lib/account"))
    .resolveLinkedPairPremiumAccessForGuardian;
}

describe.skipIf(!PG_AVAILABLE)(
  "guardian premium folds over ALL active links (§31.3)",
  () => {
    beforeAll(async () => {
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
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      // Each case owns the link set it describes; no case inherits another's rows.
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.entitlements`);
    });

    it("derives premium when only the SECOND student is entitled — the broken case", async () => {
      await seedLink(STUDENT_A, "2026-01-01T00:00:00Z"); // oldest — NOT premium
      await seedLink(STUDENT_B, "2026-02-01T00:00:00Z"); // premium
      await seedEntitlement(STUDENT_B, "active");
      dbMocks.isActive.mockImplementation(
        async (id: string) => id === STUDENT_B,
      );

      const resolve = await resolver();
      const access = await resolve(GUARDIAN);

      // Both halves: premium AND the link that conferred it.
      expect(access.hasPremiumAccess).toBe(true);
      expect(access.hasActiveLink).toBe(true);
      expect(access.studentUserId).toBe(STUDENT_B);
    });

    it("derives premium when the FIRST student is entitled", async () => {
      await seedLink(STUDENT_A, "2026-01-01T00:00:00Z");
      await seedLink(STUDENT_B, "2026-02-01T00:00:00Z");
      await seedEntitlement(STUDENT_A, "active");
      dbMocks.isActive.mockImplementation(
        async (id: string) => id === STUDENT_A,
      );

      const resolve = await resolver();
      const access = await resolve(GUARDIAN);

      expect(access.hasPremiumAccess).toBe(true);
      expect(access.studentUserId).toBe(STUDENT_A);
      /**
       * EVERY link is evaluated — the short-circuit this used to assert is
       * GONE, deliberately (owner ruling 2026-09-03).
       *
       * `isEntitlementActiveForProfile` counts `past_due` as entitled
       * (SCL-029), so stopping at the first accepted link let a `past_due`
       * student mask an `active` one and report their status as the guardian's.
       * Doc 01 V8 §31.2's own reference derivation is a `Promise.all` over all
       * linked students, and §31.2.1 rules that sufficient at V1 scale, so this
       * moves toward the spec. The cost is bounded by the linked-student count.
       */
      expect(dbMocks.isActive).toHaveBeenCalledTimes(2);
    });

    /**
     * TEST 2 of the owner's 2026-09-03 acceptance list: with one `past_due` and
     * one `active` student, the conferring link is the `active` one.
     *
     * THE FAILURE THIS PINS, END TO END. `past_due` is entitled, so the old
     * first-match-wins loop stopped at student A, `GET /api/billing/status`
     * reported `stripeStatus: "past_due"` as the GUARDIAN's status, and
     * `SubscriptionPaywall`'s `needsPaymentUpdate` early return (the component
     * is now `CheckoutReturnPoller`) then replaced
     * the entire guardian dashboard — link panel, purchase card and all — for a
     * guardian whose other student was paying perfectly well.
     */
    it("prefers a healthy ACTIVE student over an entitled-but-past_due one", async () => {
      await seedLink(STUDENT_A, "2026-01-01T00:00:00Z"); // oldest, and past_due
      await seedLink(STUDENT_B, "2026-02-01T00:00:00Z"); // healthy
      await seedEntitlement(STUDENT_A, "past_due");
      await seedEntitlement(STUDENT_B, "active");
      // Both are entitled by the platform predicate; that is the whole point.
      dbMocks.isActive.mockResolvedValue(true);

      const resolve = await resolver();
      const access = await resolve(GUARDIAN);

      expect(access.hasPremiumAccess).toBe(true);
      expect(access.studentUserId).toBe(STUDENT_B);
      expect(access.studentEntitlementStatus).toBe("active");
    });

    /**
     * The other direction, so the preference is a PREFERENCE and not a filter:
     * a `past_due` student with no healthier sibling still confers access.
     * SCL-029 is explicit that a student mid-retry keeps what they paid for.
     */
    it("still confers premium when the only entitled student is past_due", async () => {
      await seedLink(STUDENT_A, "2026-01-01T00:00:00Z");
      await seedEntitlement(STUDENT_A, "past_due");
      dbMocks.isActive.mockResolvedValue(true);

      const resolve = await resolver();
      const access = await resolve(GUARDIAN);

      expect(access.hasPremiumAccess).toBe(true);
      expect(access.studentUserId).toBe(STUDENT_A);
      expect(access.studentEntitlementStatus).toBe("past_due");
    });

    /**
     * §31.2's derivation is `isActive && tier === 'premium'`. The tier half had
     * no implementation on this path until 2026-09-03, so a row that was
     * billing-healthy on the FREE tier conferred guardian access it had never
     * paid for.
     */
    it("refuses premium for a billing-healthy student on the FREE tier", async () => {
      await seedLink(STUDENT_A, "2026-01-01T00:00:00Z");
      await seedEntitlement(STUDENT_A, "active", "free");
      dbMocks.isActive.mockResolvedValue(true);

      const resolve = await resolver();
      const access = await resolve(GUARDIAN);

      expect(access.hasPremiumAccess).toBe(false);
      expect(access.premiumSource).toBe("none");
      // The link is still real — "linked but not premium" must not collapse
      // into "not linked".
      expect(access.hasActiveLink).toBe(true);
    });

    it("keeps 'linked but not premium' distinguishable from 'not linked'", async () => {
      await seedLink(STUDENT_A, "2026-01-01T00:00:00Z");
      dbMocks.isActive.mockResolvedValue(false);

      const resolve = await resolver();
      const access = await resolve(GUARDIAN);

      // The distinction that must not collapse: no premium, but the link is real.
      expect(access.hasPremiumAccess).toBe(false);
      expect(access.hasActiveLink).toBe(true);
    });

    it("a REVOKED link confers nothing immediately — visibility follows the link", async () => {
      // Owner ruling 2026-08-27: a guardian revoking a link is a CONSENT action,
      // and making it wait on a billing cycle would invert the trust model. This
      // already holds — `revokeGuardianLink` sets status='revoked' and the fold's
      // reader filters status='active' — so this test pins existing behaviour
      // rather than introducing it. It exists so the coupling cannot be
      // reintroduced by someone "fixing" the reader to include paid-through links.
      //
      // The MONEY is a separate question, settled by pro-rated refund. That is an
      // SCL candidate, not assumed here.
      //
      // The row is REALLY revoked in Postgres now. The previous version asserted
      // this by handing the reader an empty array — which proved the reader
      // ignores rows nobody gave it, not that it filters on `status`.
      await seedLink(STUDENT_A, "2026-01-01T00:00:00Z", "revoked");
      dbMocks.isActive.mockResolvedValue(true); // student still entitled, still paid for

      const resolve = await resolver();
      const access = await resolve(GUARDIAN);

      // Both halves: no premium AND no active link, even though the student's own
      // entitlement is live and the period is paid through.
      expect(access.hasPremiumAccess).toBe(false);
      expect(access.hasActiveLink).toBe(false);
      expect(dbMocks.isActive).not.toHaveBeenCalled();
    });

    it("reports no link when the guardian has none", async () => {
      const resolve = await resolver();
      const access = await resolve(GUARDIAN);

      expect(access.hasPremiumAccess).toBe(false);
      expect(access.hasActiveLink).toBe(false);
      expect(dbMocks.isActive).not.toHaveBeenCalled();
    });
  },
);
