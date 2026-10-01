/**
 * The password-recovery grant: single use, short-lived, one per profile — real PostgreSQL proof.
 *
 * @spec [Brief 8 ruling 4; owner choice 2026-10-01 ("recovery marker")] | @implemented [2026-10-01]
 *
 * plain English: the SQL behind `/update-password`'s gate. A grant written by the callback is live
 * until it expires or is spent; spending it is atomic and happens once; a TTL outside 1..60 minutes
 * is refused; and deleting the account deletes the grant.
 */
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "password_recovery_grant_ci";
const USER = "6a000000-0000-4000-8000-000000000001";
let pg: Client;

async function live(): Promise<boolean> {
  const r = await pg.query(`SELECT public.password_recovery_live($1) AS v`, [
    USER,
  ]);
  return r.rows[0].v as boolean;
}
async function consume(): Promise<boolean> {
  const r = await pg.query(`SELECT public.consume_password_recovery($1) AS v`, [
    USER,
  ]);
  return r.rows[0].v as boolean;
}

describe.skipIf(!PG_AVAILABLE)(
  "password recovery grant (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
    }, 120_000);
    afterAll(async () => {
      await pg?.end();
    });
    beforeEach(async () => {
      await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [USER]);
      await pg.query(`DELETE FROM auth.users WHERE id = $1`, [USER]);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1, 'r@example.test')`,
        [USER],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name) VALUES ($1, 'r@example.test', 'student', 'R')`,
        [USER],
      );
    });

    it("no grant: not live, and nothing to spend", async () => {
      expect(await live()).toBe(false);
      expect(await consume()).toBe(false);
    });

    it("a grant is live, is spent exactly once, and is gone after", async () => {
      await pg.query(`SELECT public.grant_password_recovery($1, 900)`, [USER]);
      expect(await live()).toBe(true);
      expect(await consume()).toBe(true);
      expect(await consume()).toBe(false);
      expect(await live()).toBe(false);
    });

    it("an expired grant is not live and spends as false", async () => {
      await pg.query(`SELECT public.grant_password_recovery($1, 900)`, [USER]);
      await pg.query(
        `UPDATE public.password_recovery_grants
          SET granted_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes'
        WHERE profile_id = $1`,
        [USER],
      );
      expect(await live()).toBe(false);
      expect(await consume()).toBe(false);
    });

    it("a new recovery link replaces the old grant rather than adding a second", async () => {
      await pg.query(`SELECT public.grant_password_recovery($1, 60)`, [USER]);
      await pg.query(`SELECT public.grant_password_recovery($1, 900)`, [USER]);
      const rows = await pg.query(
        `SELECT extract(epoch FROM expires_at - granted_at)::int AS ttl FROM public.password_recovery_grants WHERE profile_id = $1`,
        [USER],
      );
      expect(rows.rows).toEqual([{ ttl: 900 }]);
    });

    it("refuses a TTL outside 60..3600 seconds", async () => {
      await expect(
        pg.query(`SELECT public.grant_password_recovery($1, 59)`, [USER]),
      ).rejects.toThrow(/outside/);
      await expect(
        pg.query(`SELECT public.grant_password_recovery($1, 3601)`, [USER]),
      ).rejects.toThrow(/outside/);
    });

    it("deleting the profile deletes the grant", async () => {
      await pg.query(`SELECT public.grant_password_recovery($1, 900)`, [USER]);
      await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [USER]);
      const left = await pg.query(
        `SELECT count(*)::int AS n FROM public.password_recovery_grants`,
      );
      expect(left.rows[0].n).toBe(0);
    });

    it("anon and authenticated cannot execute any of the three functions", async () => {
      for (const fn of [
        "grant_password_recovery(uuid, integer)",
        "password_recovery_live(uuid)",
        "consume_password_recovery(uuid)",
      ]) {
        for (const role of ["anon", "authenticated"]) {
          const r = await pg.query(
            `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`,
            [role, `public.${fn}`],
          );
          expect(r.rows[0].ok).toBe(false);
        }
      }
    });
  },
);
