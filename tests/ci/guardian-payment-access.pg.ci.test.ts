/**
 * Guardian payment does not grant access; only the STUDENT's entitlement does → real PG.
 *
 * @spec [Doc 01 V8 §31.1 (guardians have no entitlement of their own), §31.3 (access derives
 *        from a linked student), §6.3 payment ≠ permission; Guardian_Closure_Plan G1-10,
 *        audit G-AUD-15b] | @implemented [2026-09-29]
 *
 * plain English: REPLACES server/__tests__/guardian-payment-access.test.ts, which could not
 * fail: it mocked `EntitlementService.isEntitlementActiveForProfile` to return `false` — the
 * very input that forces the verdict it asserted — and its link fixture carried
 * `initiated_by: 'guardian'`, which no code path writes since SCL-080.
 *
 * Here nothing about the decision is mocked. A real guardian with a real ACTIVE premium
 * entitlement row, linked to a real student with NONE, asks
 * `resolveLinkedPairPremiumAccessForGuardian` — which reads the real tables and calls the real
 * `entitlement_active` function. The control case flips only the student's row, so the
 * assertion is shown to be able to come out the other way.
 *
 * MUTATION THAT REDS IT: in `resolveLinkedPairPremiumAccessForGuardian`
 * (server/lib/account.ts), let an active GUARDIAN entitlement confer access.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { Client } from "pg";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "guardian_payment_access_ci";
const GUARDIAN = "b7111111-1111-4111-8111-111111111111";
const STUDENT = "b7222222-2222-4222-8222-222222222222";

let pg: Client;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));

describe.skipIf(!PG_AVAILABLE)(
  "guardian payment ≠ access (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,'g@x.test'),($2,'s@x.test')`,
        [GUARDIAN, STUDENT],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role) VALUES ($1,'g@x.test','guardian'),($2,'s@x.test','student')`,
        [GUARDIAN, STUDENT],
      );
      // The link as SCL-080's writer produces it.
      await pg.query(
        `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at, accepted_by_profile_id)
       VALUES ($1, $2, 'active', 'student', now(), now(), $2)`,
        [GUARDIAN, STUDENT],
      );
      // The GUARDIAN holds a paid, active premium entitlement.
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')`,
        [GUARDIAN],
      );
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      await pg.query(`DELETE FROM public.entitlements WHERE profile_id = $1`, [
        STUDENT,
      ]);
    });

    it("an active guardian entitlement grants nothing while the student has none", async () => {
      const { resolveLinkedPairPremiumAccessForGuardian } =
        await import("../../server/lib/account");
      const access = await resolveLinkedPairPremiumAccessForGuardian(
        GUARDIAN,
        STUDENT,
      );

      // The link is real: this is the entitlement branch, not the no-link branch.
      expect(access.hasActiveLink).toBe(true);
      expect(access.hasPremiumAccess).toBe(false);
      expect(access.premiumSource).toBe("none");
    });

    it("control: the same pair with the STUDENT entitled has access", async () => {
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')`,
        [STUDENT],
      );
      const { resolveLinkedPairPremiumAccessForGuardian } =
        await import("../../server/lib/account");
      const access = await resolveLinkedPairPremiumAccessForGuardian(
        GUARDIAN,
        STUDENT,
      );

      expect(access.hasActiveLink).toBe(true);
      expect(access.hasPremiumAccess).toBe(true);
    });
  },
);
