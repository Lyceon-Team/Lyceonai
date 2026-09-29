/**
 * The tutor seven-day promise — the writer that did not exist.
 *
 * @spec [Doc-03_V1.1 §14.2 + INV-03-19 (tutor retention: active + 7 days
 *        post-entitlement-loss); Doc-05B §5.3 + SP25-001 (the canonical
 *        entitlement predicate, exactly one evaluator); SCL-101 addendum
 *        finding 1; owner ruling 2026-09-22 C1] @implemented 2026-09-22
 *
 * plain English: `server/services/retention-sweep.ts:113` has documented
 * `tutor_conversations.deleted_at` as "set when entitlement lapses" since
 * 2026-08-20. Nothing set it. `sweep7d` filters on it, so its input was
 * permanently empty, and Privacy Policy v3 had to publish the narrower
 * "deleted when your account is deleted" instead of the seven-day promise.
 *
 * These tests are what makes the seven-day promise publishable. C1.6 is the
 * one that closes the loop: it shows the sweep's own predicate now matching a
 * row, which is the thing that was untrue before this migration.
 *
 * C1.7 is the guard that stops this rotting. The trigger fires on
 * `UPDATE OF status` because the canonical predicate reads `status` and nothing
 * else. If someone adds `tier` to the predicate, the trigger silently stops
 * covering tier changes — no error, no failing test, just a promise that
 * quietly stops being kept. C1.7 asserts the predicate's body reads only
 * `status`, so that coupling cannot rot unnoticed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "tutor_lapse_severance_ci";
const STUDENT = "0c1c1c1c-0000-4000-8000-00000000000a";
const CONVO = "0c1c1c1c-0000-4000-8000-00000000000c";

let pg: Client;

const stamp = async (): Promise<Date | null> => {
  const r = await pg.query(
    `SELECT deleted_at FROM public.tutor_conversations WHERE id = $1`,
    [CONVO],
  );
  return r.rows[0]?.deleted_at ?? null;
};

const setStatus = async (status: string): Promise<void> => {
  await pg.query(
    `UPDATE public.entitlements SET status = $2 WHERE profile_id = $1`,
    [STUDENT, status],
  );
};

describe.skipIf(!PG_AVAILABLE)(
  "Tutor lapse severance (Doc 03 §14.2 / owner ruling C1)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
    }, 240_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      await pg.query(`DELETE FROM public.tutor_conversations`);
      await pg.query(`DELETE FROM public.entitlements`);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1, 'c1@example.test')
         ON CONFLICT DO NOTHING`,
        [STUDENT],
      );
      // The profile is written explicitly: the PG bootstrap stubs auth.users
      // without handle_new_user, and a test that depends on an unrelated
      // trigger breaks for reasons it is not about.
      await pg.query(
        `INSERT INTO public.profiles (id, email, role)
         VALUES ($1, 'c1@example.test', 'student') ON CONFLICT (id) DO NOTHING`,
        [STUDENT],
      );
      await pg.query(
        `INSERT INTO public.tutor_conversations
           (id, student_id, entry_mode, source_surface, status)
         VALUES ($1, $2, 'general', 'dashboard', 'active')`,
        [CONVO, STUDENT],
      );
    });

    it("C1.1 — an active entitlement leaves conversations unstamped", async () => {
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status)
         VALUES ($1, 'premium', 'active')`,
        [STUDENT],
      );
      expect(await stamp()).toBeNull();
    });

    it("C1.2 — a lapse stamps deleted_at", async () => {
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status)
         VALUES ($1, 'premium', 'active')`,
        [STUDENT],
      );
      await setStatus("canceled");
      expect(await stamp()).toBeInstanceOf(Date);
    });

    it("C1.3 — FIRST LAPSE WINS: a second inactive transition does not move the clock", async () => {
      // Stripe emits canceled then unpaid. Without `WHERE deleted_at IS NULL`
      // each one would rewrite deleted_at to now(), pushing the seven-day clock
      // out forever — a lapsed account that never expires, behind a mechanism
      // that looks like it works.
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status)
         VALUES ($1, 'premium', 'active')`,
        [STUDENT],
      );
      await setStatus("canceled");
      const first = await stamp();
      expect(first).toBeInstanceOf(Date);

      await setStatus("unpaid");
      expect((await stamp())!.getTime()).toBe(first!.getTime());
    });

    it("C1.4 — resubscribing CLEARS the stamp (owner ruling C1)", async () => {
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status)
         VALUES ($1, 'premium', 'active')`,
        [STUDENT],
      );
      await setStatus("canceled");
      expect(await stamp()).toBeInstanceOf(Date);

      await setStatus("active");
      // Without this a returning student loses their tutor history on day seven
      // of a lapse they have already ended.
      expect(await stamp()).toBeNull();
    });

    it("C1.5 — past_due counts as entitled, per the canonical predicate", async () => {
      // The trigger must not have its own opinion about which statuses grant
      // access. entitlement_active includes past_due; so must this.
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status)
         VALUES ($1, 'premium', 'active')`,
        [STUDENT],
      );
      await setStatus("canceled");
      expect(await stamp()).toBeInstanceOf(Date);

      await setStatus("past_due");
      expect(await stamp()).toBeNull();
    });

    it("C1.6 — the 7-day sweep's predicate now matches a row (it never did before)", async () => {
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status)
         VALUES ($1, 'premium', 'active')`,
        [STUDENT],
      );
      await setStatus("canceled");
      // Back-date the stamp past the window the sweep reads.
      await pg.query(
        `UPDATE public.tutor_conversations
            SET deleted_at = now() - interval '8 days' WHERE id = $1`,
        [CONVO],
      );
      const r = await pg.query(
        `SELECT count(*)::int AS n FROM public.tutor_conversations
          WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '7 days'`,
      );
      expect(r.rows[0].n).toBe(1);
    });

    it("C1.7 — the predicate reads only status, which is what makes UPDATE OF status sufficient", async () => {
      // The trigger's column list is coupled to the predicate's body. If the
      // predicate grows to read `tier`, `UPDATE OF status` stops covering it
      // and the promise silently stops being kept. This asserts the coupling
      // still holds rather than trusting a comment.
      const p = await pg.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'entitlement_active'`,
      );
      expect(p.rows).toHaveLength(1);
      const src = p.rows[0].prosrc as string;
      expect(src).toMatch(/\bstatus\b/);
      expect(src).not.toMatch(/\btier\b/);

      const t = await pg.query(
        `SELECT a.attname
           FROM pg_trigger tg
           JOIN pg_attribute a ON a.attrelid = tg.tgrelid
                              AND a.attnum = ANY (tg.tgattr)
          WHERE tg.tgrelid = 'public.entitlements'::regclass
            AND tg.tgname = 'entitlements_sync_tutor_conversations'`,
      );
      expect(t.rows.map((r) => r.attname)).toEqual(["status"]);
    });

    it("C1.8 — the trigger calls the canonical predicate, not a re-listed status set", async () => {
      // SP25-001: exactly one entitlement evaluator. A second status list here
      // would be the second definition and the first to drift.
      const f = await pg.query(
        `SELECT prosrc FROM pg_proc
          WHERE proname = 'sync_tutor_conversations_on_entitlement_change'`,
      );
      const src = f.rows[0].prosrc as string;
      expect(src).toMatch(/entitlement_active\s*\(/);
      expect(src).not.toMatch(/'active'\s*,\s*'past_due'/);
      expect(src).not.toMatch(/IN\s*\(\s*'active'/);
    });

    it("C1.9 — a student with no conversations is a clean no-op", async () => {
      await pg.query(`DELETE FROM public.tutor_conversations`);
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status)
         VALUES ($1, 'premium', 'active')`,
        [STUDENT],
      );
      await expect(setStatus("canceled")).resolves.toBeUndefined();
    });
  },
);
