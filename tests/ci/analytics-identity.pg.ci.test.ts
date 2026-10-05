/**
 * Migration 20261026000000 against real PostgreSQL.
 *
 * @spec [Doc 07A V1.0 §7.1 ("immutable column on the user record"); SCL-201 IS 6 (signup_source,
 *       set once); Doc 10 §9.11 (consent log); SCL-202] | @implemented [2026-10-05]
 *
 * plain English: applies the whole migration pipeline to a throwaway database and proves what the
 * database itself enforces — not what the writer promises:
 *   - analytics_user_id and signup_source can go from NULL to a value once, and never change again;
 *   - signup_source takes only the five Doc 07A values;
 *   - analytics_user_id is unique;
 *   - cookie_consent_log has RLS on, no anon/authenticated grant, and service_role can only
 *     SELECT and INSERT (a log is never edited);
 *   - the cookie_consent_ip bucket is seeded.
 * Runs only where PGHOST is set; named by file in CI.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "analytics_identity_ci";
const USER = "0a0a0a0a-1111-4222-8333-444444444444";
const OTHER = "0b0b0b0b-1111-4222-8333-444444444444";
const THIRD = "0c0c0c0c-1111-4222-8333-444444444444";
const ID_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ID_B = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";

let pg: Client | null = null;

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

describe.skipIf(!PG_AVAILABLE)(
  "analytics identity + cookie consent log → real PG",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      // The harness drops on_auth_user_created (tests/helpers/pg-supabase.ts), so profiles are
      // inserted directly, as the other PG suites do.
      for (const id of [USER, OTHER, THIRD]) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          `${id}@ci.test`,
        ]);
        await pg.query(
          `INSERT INTO public.profiles (id, email, role, display_name) VALUES ($1, $2, 'student', 'CI')`,
          [id, `${id}@ci.test`],
        );
      }
      await pg.query("BEGIN");
    }, 120_000);

    afterAll(async () => {
      if (pg) {
        await pg.query("ROLLBACK");
        await pg.end();
      }
    });

    it("the profile rows exist (presence before absence)", async () => {
      const rows = await pg!.query(
        `SELECT id, analytics_user_id, signup_source FROM public.profiles WHERE id = ANY($1) ORDER BY id`,
        [[USER, OTHER, THIRD]],
      );
      expect(rows.rows).toEqual([
        { id: USER, analytics_user_id: null, signup_source: null },
        { id: OTHER, analytics_user_id: null, signup_source: null },
        { id: THIRD, analytics_user_id: null, signup_source: null },
      ]);
    });

    it("analytics_user_id: NULL → value once, then immutable", async () => {
      await pg!.query(
        `UPDATE public.profiles SET analytics_user_id = $2 WHERE id = $1`,
        [USER, ID_A],
      );
      await expectRaise(
        `UPDATE public.profiles SET analytics_user_id = $2 WHERE id = $1`,
        [USER, ID_B],
        /analytics_user_id is immutable/,
      );
      await expectRaise(
        `UPDATE public.profiles SET analytics_user_id = NULL WHERE id = $1`,
        [USER],
        /analytics_user_id is immutable/,
      );
      // Writing the same value again is not a change.
      await pg!.query(
        `UPDATE public.profiles SET analytics_user_id = $2 WHERE id = $1`,
        [USER, ID_A],
      );
    });

    it("the conditional write the wrapper uses touches a row only the first time", async () => {
      const first = await pg!.query(
        `UPDATE public.profiles SET analytics_user_id = $2 WHERE id = $1 AND analytics_user_id IS NULL RETURNING id`,
        [OTHER, ID_B],
      );
      const second = await pg!.query(
        `UPDATE public.profiles SET analytics_user_id = $2 WHERE id = $1 AND analytics_user_id IS NULL RETURNING id`,
        [OTHER, ID_B],
      );
      expect([first.rowCount, second.rowCount]).toEqual([1, 0]);
    });

    it("analytics_user_id is unique", async () => {
      // ID_A is already USER's (set above).
      await expectRaise(
        `UPDATE public.profiles SET analytics_user_id = $2 WHERE id = $1`,
        [THIRD, ID_A],
        /profiles_analytics_user_id_key/,
      );
    });

    it("signup_source: only the five Doc 07A values, set once", async () => {
      await expectRaise(
        `UPDATE public.profiles SET signup_source = 'tiktok' WHERE id = $1`,
        [USER],
        /profiles_signup_source_check/,
      );
      await pg!.query(
        `UPDATE public.profiles SET signup_source = 'organic_search' WHERE id = $1`,
        [USER],
      );
      await expectRaise(
        `UPDATE public.profiles SET signup_source = 'direct' WHERE id = $1`,
        [USER],
        /signup_source is immutable/,
      );
    });

    it("cookie_consent_log: RLS on, no client-role grant, service_role may only read and insert", async () => {
      const rls = await pg!.query(
        `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cookie_consent_log'::regclass`,
      );
      expect(rls.rows[0]?.relrowsecurity).toBe(true);
      const grants = await pg!.query(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'cookie_consent_log'
        ORDER BY grantee, privilege_type`,
      );
      expect(
        grants.rows.filter((r) =>
          ["anon", "authenticated", "service_role"].includes(r.grantee),
        ),
      ).toEqual([
        { grantee: "service_role", privilege_type: "INSERT" },
        { grantee: "service_role", privilege_type: "SELECT" },
      ]);
    });

    it("cookie_consent_log: one row per choice, server-stamped; bad values refused", async () => {
      const row = await pg!.query(
        `INSERT INTO public.cookie_consent_log (consent_id, analytics, banner_version, source)
       VALUES ('0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a', true, '1', 'banner') RETURNING recorded_at`,
      );
      expect(row.rows[0]?.recorded_at).toBeInstanceOf(Date);
      await expectRaise(
        `INSERT INTO public.cookie_consent_log (consent_id, analytics, banner_version, source)
       VALUES ('0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a', true, '1', 'gpc')`,
        [],
        /cookie_consent_log_source_check/,
      );
      await expectRaise(
        `INSERT INTO public.cookie_consent_log (consent_id, analytics, banner_version, source)
       VALUES ('0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a', true, 'v1', 'banner')`,
        [],
        /cookie_consent_log_banner_version_check/,
      );
    });

    it("the cookie_consent_ip bucket is seeded", async () => {
      const r = await pg!.query(
        `SELECT value -> 'cookie_consent_ip' AS b FROM public.rate_limit_runtime_config WHERE key = 'bucket_definitions'`,
      );
      expect(r.rows[0]?.b).toEqual({ limit: 30, window_seconds: 3600 });
    });
  },
);
