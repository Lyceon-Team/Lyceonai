/**
 * Migration 20261027000000 against real PostgreSQL.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R26, R28, R30, rows Q5/Q6 ("DB check", "DB
 *       rows"); Doc 10 §9.21 ("logged consent", "revocable"); owner Step 0 answers 2026-10-05]
 *       | @implemented [2026-10-05]
 *
 * plain English: builds the schema as it stood BEFORE the migration, seeds the opt-ins the
 * migration has to deal with (13+, under-13, a guardian with no date of birth), applies the
 * migration and the rest of the pipeline, and proves what the DATABASE enforces:
 *   - the data step: under-13 / unknown-age opt-ins cleared and logged `age_clear`, 13+ kept
 *     and logged `backfill`;
 *   - under-13 (or unknown age) can never be turned on, by any writer;
 *   - a grant that does not come through set_marketing_consent is refused (no version), so
 *     every grant in the log says when, where and against which wording;
 *   - account deletion's date-of-birth wipe CLEARS the flag instead of failing;
 *   - one review per profile (replay vs conflict), compare-and-set prompt claim, one dismissal
 *     per showing, idempotent feedback;
 *   - RLS on, no anon/authenticated access, the logs and reviews are not editable;
 *   - deleting the profile removes every row (ON DELETE CASCADE).
 * Runs only where PGHOST is set; named by file in CI.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  applyMigrationsFrom,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "marketing_consent_reviews_ci";
const MIGRATION = "20261027000000_marketing_consent_and_product_reviews.sql";

const TEEN = "1a1a1a1a-1111-4222-8333-444444444444"; // 15, opted in before → kept
const CHILD = "2b2b2b2b-1111-4222-8333-444444444444"; // 10, opted in before → cleared
const NO_DOB = "3c3c3c3c-1111-4222-8333-444444444444"; // guardian, no DOB, opted in → cleared
const FRESH = "4d4d4d4d-1111-4222-8333-444444444444"; // 16, never opted in

let pg: Client | null = null;

function yearsAgo(years: number, extraDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - extraDays);
  return d.toISOString().slice(0, 10);
}

async function q<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!pg) throw new Error("PG client not initialised");
  return (await pg.query(sql, params)).rows as T[];
}

async function expectRaise(
  sql: string,
  params: unknown[],
  pattern: RegExp,
): Promise<void> {
  if (!pg) throw new Error("PG client not initialised");
  await pg.query("SAVEPOINT probe");
  let message = "";
  try {
    await pg.query(sql, params);
  } catch (err: unknown) {
    message = err instanceof Error ? err.message : String(err);
  }
  await pg.query("ROLLBACK TO SAVEPOINT probe");
  expect(message).toMatch(pattern);
}

async function logOf(
  id: string,
): Promise<
  { granted: boolean; source: string; consent_version: string | null }[]
> {
  return q(
    `SELECT granted, source, consent_version FROM public.marketing_consent_log
      WHERE profile_id = $1 ORDER BY id`,
    [id],
  );
}

async function optIn(id: string): Promise<boolean> {
  const [row] = await q<{ marketing_opt_in: boolean }>(
    `SELECT marketing_opt_in FROM public.profiles WHERE id = $1`,
    [id],
  );
  if (!row) throw new Error(`profile ${id} missing`);
  return row.marketing_opt_in;
}

describe.skipIf(!PG_AVAILABLE)(
  "marketing consent + product reviews → real PG",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME, { stopBefore: MIGRATION });
      const seeds: [string, "student" | "guardian", string | null, boolean][] =
        [
          [TEEN, "student", yearsAgo(15), true],
          [CHILD, "student", yearsAgo(10), true],
          [NO_DOB, "guardian", null, true],
          [FRESH, "student", yearsAgo(16), false],
        ];
      for (const [id, role, dob, opted] of seeds) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          `${id}@ci.test`,
        ]);
        await pg.query(
          `INSERT INTO public.profiles
             (id, email, role, display_name, date_of_birth, marketing_opt_in, profile_completed_at)
           VALUES ($1, $2, $3, 'CI', $4, $5, now())`,
          [id, `${id}@ci.test`, role, dob, opted],
        );
      }
      await applyMigrationsFrom(pg, MIGRATION);
      await pg.query("BEGIN");
    }, 180_000);

    afterAll(async () => {
      if (pg) {
        await pg.query("ROLLBACK");
        await pg.end();
      }
    });

    describe("the data step", () => {
      it("keeps the 13+ opt-in and logs it as a backfill with no wording version", async () => {
        expect(await optIn(TEEN)).toBe(true);
        expect(await logOf(TEEN)).toEqual([
          { granted: true, source: "backfill", consent_version: null },
        ]);
      });

      it("clears the under-13 and the unknown-age opt-ins, and logs each as age_clear", async () => {
        expect(await optIn(CHILD)).toBe(false);
        expect(await optIn(NO_DOB)).toBe(false);
        expect(await logOf(CHILD)).toEqual([
          { granted: false, source: "age_clear", consent_version: null },
        ]);
        expect(await logOf(NO_DOB)).toEqual([
          { granted: false, source: "age_clear", consent_version: null },
        ]);
      });

      it("leaves a profile that never opted in untouched", async () => {
        expect(await optIn(FRESH)).toBe(false);
        expect(await logOf(FRESH)).toEqual([]);
      });
    });

    describe("under-13 can never be opted in", () => {
      it("a direct write is refused for an under-13 date of birth", async () => {
        await expectRaise(
          `UPDATE public.profiles SET marketing_opt_in = true WHERE id = $1`,
          [CHILD],
          /requires a known date of birth at least 13 years ago/,
        );
      });

      it("a direct write is refused for an unknown date of birth", async () => {
        await expectRaise(
          `UPDATE public.profiles SET marketing_opt_in = true WHERE id = $1`,
          [NO_DOB],
          /requires a known date of birth at least 13 years ago/,
        );
      });

      it("the day before the 13th birthday is refused; the birthday itself is allowed", async () => {
        const almost = yearsAgo(13, -1);
        const exactly = yearsAgo(13);
        const [a] = await q<{ ok: boolean }>(
          `SELECT public.marketing_opt_in_age_eligible($1::date) AS ok`,
          [almost],
        );
        const [b] = await q<{ ok: boolean }>(
          `SELECT public.marketing_opt_in_age_eligible($1::date) AS ok`,
          [exactly],
        );
        expect([a?.ok, b?.ok]).toEqual([false, true]);
      });

      it("set_marketing_consent answers age_ineligible and writes nothing", async () => {
        const [row] = await q<{ r: unknown }>(
          `SELECT public.set_marketing_consent($1, true, 'settings', '1.0.0') AS r`,
          [CHILD],
        );
        expect(row?.r).toEqual({ ok: false, reason: "age_ineligible" });
        expect(await optIn(CHILD)).toBe(false);
        expect(await logOf(CHILD)).toHaveLength(1);
      });
    });

    describe("proof of consent", () => {
      it("a grant through set_marketing_consent records when, where and which wording", async () => {
        const before = new Date();
        const [row] = await q<{ r: unknown }>(
          `SELECT public.set_marketing_consent($1, true, 'signup', '1.0.0') AS r`,
          [FRESH],
        );
        expect(row?.r).toEqual({ ok: true, changed: true, granted: true });
        expect(await optIn(FRESH)).toBe(true);
        const log = await q<{
          granted: boolean;
          source: string;
          consent_version: string;
          captured_at: Date;
        }>(
          `SELECT granted, source, consent_version, captured_at
             FROM public.marketing_consent_log WHERE profile_id = $1`,
          [FRESH],
        );
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({
          granted: true,
          source: "signup",
          consent_version: "1.0.0",
        });
        // Inside one transaction now() is the transaction start, so allow a little slack.
        expect(log[0]!.captured_at.getTime()).toBeLessThanOrEqual(
          before.getTime() + 1000,
        );
      });

      it("writing the value it already holds changes and logs nothing", async () => {
        const [row] = await q<{ r: unknown }>(
          `SELECT public.set_marketing_consent($1, true, 'settings', '1.0.0') AS r`,
          [FRESH],
        );
        expect(row?.r).toEqual({ ok: true, changed: false, granted: true });
        expect(await logOf(FRESH)).toHaveLength(1);
      });

      it("a withdrawal from Settings is logged with its source", async () => {
        await q(
          `SELECT public.set_marketing_consent($1, false, 'settings', '1.0.0')`,
          [FRESH],
        );
        expect(await optIn(FRESH)).toBe(false);
        expect((await logOf(FRESH)).at(-1)).toEqual({
          granted: false,
          source: "settings",
          consent_version: null,
        });
      });

      it("a grant written around set_marketing_consent is refused: it names no wording", async () => {
        await expectRaise(
          `UPDATE public.profiles SET marketing_opt_in = true WHERE id = $1`,
          [FRESH],
          /marketing_consent_log_grant_versioned/,
        );
      });

      it("set_marketing_consent refuses an unknown source", async () => {
        await expectRaise(
          `SELECT public.set_marketing_consent($1, true, 'backfill', '1.0.0')`,
          [FRESH],
          /unknown source/,
        );
      });
    });

    it("account deletion's date-of-birth wipe clears the opt-in instead of failing", async () => {
      expect(await optIn(TEEN)).toBe(true);
      // As deidentify_user does it: the profile is marked deleted first, which is what lets the
      // date-of-birth lock (profiles_lock_date_of_birth, case b) accept the wipe.
      await q(`UPDATE public.profiles SET deleted_at = now() WHERE id = $1`, [
        TEEN,
      ]);
      await q(`UPDATE public.profiles SET date_of_birth = NULL WHERE id = $1`, [
        TEEN,
      ]);
      expect(await optIn(TEEN)).toBe(false);
      expect((await logOf(TEEN)).at(-1)).toEqual({
        granted: false,
        source: "system",
        consent_version: null,
      });
    });

    describe("reviews, prompt state, feedback", () => {
      it("one review per profile: a retry replays, a different second review conflicts", async () => {
        const submit = async (rating: number, body: string | null) =>
          (
            await q<{ r: { outcome: string } }>(
              `SELECT public.product_review_submit($1, 'student', $2::smallint, $3, false) AS r`,
              [FRESH, rating, body],
            )
          )[0]?.r.outcome;
        expect(await submit(5, "Clear explanations.")).toBe("created");
        expect(await submit(5, "Clear explanations.")).toBe("replayed");
        expect(await submit(2, "Changed my mind.")).toBe("conflict");
        const rows = await q(
          `SELECT rating, body, quote_permission FROM public.product_reviews WHERE profile_id = $1`,
          [FRESH],
        );
        expect(rows).toEqual([
          { rating: 5, body: "Clear explanations.", quote_permission: false },
        ]);
        const [state] = await q<{ reviewed_via: string }>(
          `SELECT reviewed_via FROM public.product_review_prompt_state WHERE profile_id = $1`,
          [FRESH],
        );
        expect(state?.reviewed_via).toBe("in_app");
      });

      it("the rating is bounded 1-5 and an empty body is refused", async () => {
        await expectRaise(
          `SELECT public.product_review_submit($1, 'student', 6::smallint, NULL, false)`,
          [CHILD],
          /product_reviews_rating_check/,
        );
        await expectRaise(
          `SELECT public.product_review_submit($1, 'student', 4::smallint, '', false)`,
          [CHILD],
          /product_reviews_body_check/,
        );
      });

      it("the prompt claim is compare-and-set: two tabs reading the same state show it once", async () => {
        const claim = async (expected: string | null) =>
          (
            await q<{ ok: boolean }>(
              `SELECT public.product_review_prompt_claim($1, $2::timestamptz) AS ok`,
              [NO_DOB, expected],
            )
          )[0]?.ok;
        expect(await claim(null)).toBe(true);
        expect(await claim(null)).toBe(false);
      });

      it("a dismissal counts once per showing", async () => {
        const dismiss = async () =>
          (
            await q<{ ok: boolean }>(
              `SELECT public.product_review_prompt_dismiss($1) AS ok`,
              [NO_DOB],
            )
          )[0]?.ok;
        expect(await dismiss()).toBe(true);
        expect(await dismiss()).toBe(false);
        const [state] = await q<{ dismiss_count: number }>(
          `SELECT dismiss_count FROM public.product_review_prompt_state WHERE profile_id = $1`,
          [NO_DOB],
        );
        expect(state?.dismiss_count).toBe(1);
      });

      it("the Trustpilot button counts as reviewed and stops further claims", async () => {
        await q(`SELECT public.product_review_mark_external($1)`, [NO_DOB]);
        const [state] = await q<{ reviewed_via: string; last_shown_at: Date }>(
          `SELECT reviewed_via, last_shown_at FROM public.product_review_prompt_state WHERE profile_id = $1`,
          [NO_DOB],
        );
        expect(state?.reviewed_via).toBe("trustpilot");
        const [again] = await q<{ ok: boolean }>(
          `SELECT public.product_review_prompt_claim($1, $2::timestamptz) AS ok`,
          [NO_DOB, state?.last_shown_at],
        );
        expect(again?.ok).toBe(false);
      });

      it("feedback is idempotent per (profile, key)", async () => {
        const key = "9f9f9f9f-1111-4222-8333-444444444444";
        const send = async () =>
          (
            await q<{ r: { outcome: string } }>(
              `SELECT public.product_feedback_submit($1, 'guardian', 'The calendar is hard to find.', 'menu', $2) AS r`,
              [NO_DOB, key],
            )
          )[0]?.r.outcome;
        expect(await send()).toBe("created");
        expect(await send()).toBe("replayed");
        const rows = await q(
          `SELECT count(*)::int AS n FROM public.product_feedback WHERE profile_id = $1`,
          [NO_DOB],
        );
        expect(rows).toEqual([{ n: 1 }]);
      });
    });

    describe("access", () => {
      const TABLES = [
        "marketing_consent_log",
        "product_reviews",
        "product_feedback",
        "product_review_prompt_state",
      ];

      it("RLS is on and anon/authenticated hold no privilege on any of the four tables", async () => {
        const rows = await q<{ relname: string; relrowsecurity: boolean }>(
          `SELECT relname, relrowsecurity FROM pg_class
            WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1) ORDER BY relname`,
          [TABLES],
        );
        expect(rows.map((r) => r.relname)).toEqual([...TABLES].sort());
        expect(rows.every((r) => r.relrowsecurity)).toBe(true);
        const grants = await q(
          `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = ANY($1)
              AND grantee IN ('anon', 'authenticated', 'PUBLIC')`,
          [TABLES],
        );
        expect(grants).toEqual([]);
      });

      it("service_role can neither edit nor delete a consent row or a review", async () => {
        const grants = await q<{ table_name: string; privilege_type: string }>(
          `SELECT table_name, privilege_type FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND grantee = 'service_role'
              AND table_name IN ('marketing_consent_log', 'product_reviews', 'product_feedback')
            ORDER BY table_name, privilege_type`,
        );
        expect(grants).toEqual([
          { table_name: "marketing_consent_log", privilege_type: "INSERT" },
          { table_name: "marketing_consent_log", privilege_type: "SELECT" },
          { table_name: "product_feedback", privilege_type: "INSERT" },
          { table_name: "product_feedback", privilege_type: "SELECT" },
          { table_name: "product_reviews", privilege_type: "INSERT" },
          { table_name: "product_reviews", privilege_type: "SELECT" },
        ]);
      });

      it("the product_feedback bucket is seeded", async () => {
        const [row] = await q<{ b: unknown }>(
          `SELECT value -> 'product_feedback' AS b FROM public.rate_limit_runtime_config WHERE key = 'bucket_definitions'`,
        );
        expect(row?.b).toEqual({ limit: 10, window_seconds: 86400 });
      });
    });

    it("deleting the profile removes its rows from all four tables", async () => {
      const count = async (id: string) =>
        (
          await q<{ n: number }>(
            `SELECT (SELECT count(*) FROM public.marketing_consent_log WHERE profile_id = $1)
                  + (SELECT count(*) FROM public.product_reviews WHERE profile_id = $1)
                  + (SELECT count(*) FROM public.product_feedback WHERE profile_id = $1)
                  + (SELECT count(*) FROM public.product_review_prompt_state WHERE profile_id = $1) AS n`,
            [id],
          )
        )[0]?.n;
      expect(Number(await count(FRESH))).toBeGreaterThan(0);
      expect(Number(await count(NO_DOB))).toBeGreaterThan(0);
      await q(`DELETE FROM public.profiles WHERE id = ANY($1)`, [
        [FRESH, NO_DOB],
      ]);
      expect(Number(await count(FRESH))).toBe(0);
      expect(Number(await count(NO_DOB))).toBe(0);
    });
  },
);
