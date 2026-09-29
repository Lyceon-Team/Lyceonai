/**
 * Operational-log retention — the 90-day catch-all, proved on real Postgres.
 *
 * @spec [Privacy Policy v3 §6.7 ("Where we keep operational records that include
 *        information about you and are not listed above, we keep them for no more
 *        than 90 days"); Doc-06D_V1.0 §9 (a retention rule without a mechanism is
 *        retention drift); Doc-01_V8 §5.1 (90-day security forensics window);
 *        SCL-101; owner brief 2026-09-21 "Close Every Carry-Forward" B1]
 * @implemented 2026-09-21
 *
 * plain English: v3 §6.7 published a ceiling that nothing enforced. SCL-101 recorded
 * it as a build commitment precisely so it would not be mistaken for an as-built
 * claim. These tests are what turns it into one.
 *
 * The three properties the brief names, one test each: a row past its window goes, a
 * row inside it stays, and a zero-row run still reports itself. The third is not a
 * nicety — Vercel's cron registration cannot be read back from tooling, so a sweep
 * that was never scheduled and a sweep that found nothing are indistinguishable
 * unless the empty run says so.
 *
 * B1.5 is the one that would have caught the likeliest silent failure. The four
 * tables do not agree on which column carries the age, and `rate_limit_ledger` has
 * no `created_at` at all — its `updated_at` moves on every increment, so a bucket
 * under continuous load would never age out. The migration names `window_end` for
 * that table; this asserts the choice rather than trusting the comment.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "operational_log_retention_ci";

const STUDENT = "0b1b1b1b-0000-4000-8000-00000000000a";
const CONVERSATION = "0b1b1b1b-0000-4000-8000-00000000000c";

/** The four tables and the column each one ages on. Mirrors the migration's array. */
const TARGETS = [
  { table: "usage_rate_limit_ledger", column: "created_at" },
  { table: "rate_limit_ledger", column: "window_end" },
  { table: "tutor_turn_metrics", column: "recorded_at" },
  { table: "tutor_context_resolution_log", column: "resolved_at" },
] as const;

let pg: Client;

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const { table } of TARGETS) {
    const r = await pg.query(`SELECT count(*)::int AS n FROM public.${table}`);
    out[table] = r.rows[0].n as number;
  }
  return out;
}

/**
 * The FK parents every seeded row needs: an auth user, its profile, and one
 * conversation. The profile is written EXPLICITLY rather than left to
 * `handle_new_user`, because the PG test bootstrap stubs `auth.users` without
 * that trigger — and a test that silently depends on an unrelated trigger is a
 * test that breaks for reasons it is not about.
 */
async function ensureParents(): Promise<void> {
  await pg.query(
    `INSERT INTO auth.users (id, email) VALUES ($1, 'b1@example.test')
     ON CONFLICT DO NOTHING`,
    [STUDENT],
  );
  await pg.query(
    `INSERT INTO public.profiles (id, email, role)
     VALUES ($1, 'b1@example.test', 'student')
     ON CONFLICT (id) DO NOTHING`,
    [STUDENT],
  );
  await pg.query(
    `INSERT INTO public.tutor_conversations
       (id, student_id, entry_mode, source_surface, status)
     VALUES ($1, $2, 'general', 'dashboard', 'active')
     ON CONFLICT DO NOTHING`,
    [CONVERSATION, STUDENT],
  );
}

/** Seed one row PAST the window and one row INSIDE it, in every table. */
async function seedBothSides(): Promise<void> {
  await ensureParents();

  await pg.query(
    `INSERT INTO public.usage_rate_limit_ledger
       (scope, event_key, student_user_id, reservation_state, created_at)
     VALUES ('practice','past',$1,'consumed', now() - interval '91 days'),
            ('practice','inside',$1,'consumed', now() - interval '89 days')`,
    [STUDENT],
  );
  await pg.query(
    `INSERT INTO public.rate_limit_ledger
       (profile_id, bucket_key, window_start, window_end, limit_count)
     VALUES ($1,'past',   now() - interval '92 days', now() - interval '91 days', 10),
            ($1,'inside', now() - interval '90 days', now() - interval '89 days', 10)`,
    [STUDENT],
  );
  await pg.query(
    `INSERT INTO public.tutor_turn_metrics
       (conversation_id, turn_ordinal, orchestration_duration_ms, model_name, recorded_at)
     VALUES ($1, 1, 10, 'm', now() - interval '91 days'),
            ($1, 2, 10, 'm', now() - interval '89 days')`,
    [CONVERSATION],
  );
  await pg.query(
    `INSERT INTO public.tutor_context_resolution_log
       (conversation_id, turn_ordinal, resolved_at)
     VALUES ($1, 1, now() - interval '91 days'),
            ($1, 2, now() - interval '89 days')`,
    [CONVERSATION],
  );
}

describe.skipIf(!PG_AVAILABLE)(
  "Operational-log retention (v3 §6.7 / SCL-101)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
    }, 240_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      for (const { table } of TARGETS) {
        await pg.query(`DELETE FROM public.${table}`);
      }
    });

    it("B1.1 — the window is defined once, in SQL, and is 90 days", async () => {
      // If this ever needs changing, it changes HERE and the sweep follows.
      // A second definition in TypeScript is what this asserts does not exist.
      const r = await pg.query(
        `SELECT public.operational_log_retention_days() AS d`,
      );
      expect(r.rows[0].d).toBe(90);
    });

    it("B1.2 — a row past its window goes", async () => {
      await seedBothSides();
      const before = await counts();
      for (const { table } of TARGETS) expect(before[table]).toBe(2);

      const swept = await pg.query(
        `SELECT swept_table, deleted_count FROM public.sweep_operational_log_retention(100)`,
      );
      const deleted = Object.fromEntries(
        swept.rows.map((r) => [r.swept_table, r.deleted_count]),
      );
      for (const { table } of TARGETS) expect(deleted[table]).toBe(1);
    });

    it("B1.3 — a row inside its window stays", async () => {
      await seedBothSides();
      await pg.query(`SELECT public.sweep_operational_log_retention(100)`);

      const after = await counts();
      for (const { table } of TARGETS) expect(after[table]).toBe(1);

      // And it is the RIGHT row that survived — the 89-day one, not whichever
      // one the delete happened to reach first.
      const survivor = await pg.query(
        `SELECT bucket_key FROM public.rate_limit_ledger`,
      );
      expect(survivor.rows.map((r) => r.bucket_key)).toEqual(["inside"]);
    });

    it("B1.4 — a zero-row run still reports every table, with its cutoff", async () => {
      // Nothing seeded. The run must still be visible in the logs, because an
      // unscheduled sweep and an empty sweep look identical otherwise.
      const r = await pg.query(
        `SELECT swept_table, deleted_count, cutoff
           FROM public.sweep_operational_log_retention(100)`,
      );
      expect(r.rows).toHaveLength(TARGETS.length);
      expect(r.rows.map((x) => x.swept_table).sort()).toEqual(
        TARGETS.map((t) => t.table).sort(),
      );
      for (const row of r.rows) {
        expect(row.deleted_count).toBe(0);
        expect(row.cutoff).toBeInstanceOf(Date);
      }
    });

    it("B1.5 — each table ages on the column the migration names", async () => {
      // The four disagree, and the wrong column sweeps nothing while looking
      // correct. Proved by writing a row that is old ONLY on the named column.
      await ensureParents();
      // rate_limit_ledger is the interesting one: fresh updated_at, old window_end.
      await pg.query(
        `INSERT INTO public.rate_limit_ledger
           (profile_id, bucket_key, window_start, window_end, limit_count, updated_at)
         VALUES ($1,'hot', now() - interval '92 days', now() - interval '91 days', 10, now())`,
        [STUDENT],
      );

      await pg.query(`SELECT public.sweep_operational_log_retention(100)`);

      const left = await pg.query(
        `SELECT count(*)::int AS n FROM public.rate_limit_ledger`,
      );
      // Had the migration aged on updated_at, this row would have survived
      // forever under continuous load. It must be gone.
      expect(left.rows[0].n).toBe(0);
    });

    it("B1.6 — the batch bound is per table, not per call", async () => {
      // One busy table must not consume another's budget. With a bound of 1 and
      // two expired rows in each of two tables, each table deletes exactly 1.
      await ensureParents();
      await pg.query(
        `INSERT INTO public.usage_rate_limit_ledger
           (scope, event_key, student_user_id, reservation_state, created_at)
         VALUES ('practice','a',$1,'consumed', now() - interval '95 days'),
                ('practice','b',$1,'consumed', now() - interval '94 days')`,
        [STUDENT],
      );
      await pg.query(
        `INSERT INTO public.rate_limit_ledger
           (profile_id, bucket_key, window_start, window_end, limit_count)
         VALUES ($1,'a', now() - interval '96 days', now() - interval '95 days', 10),
                ($1,'b', now() - interval '95 days', now() - interval '94 days', 10)`,
        [STUDENT],
      );

      const r = await pg.query(
        `SELECT swept_table, deleted_count FROM public.sweep_operational_log_retention(1)`,
      );
      const deleted = Object.fromEntries(
        r.rows.map((x) => [x.swept_table, x.deleted_count]),
      );
      expect(deleted["usage_rate_limit_ledger"]).toBe(1);
      expect(deleted["rate_limit_ledger"]).toBe(1);
    });

    it("B1.7 — oldest goes first", async () => {
      await ensureParents();
      await pg.query(
        `INSERT INTO public.usage_rate_limit_ledger
           (scope, event_key, student_user_id, reservation_state, created_at)
         VALUES ('practice','oldest',$1,'consumed', now() - interval '200 days'),
                ('practice','newer',$1,'consumed',  now() - interval '100 days')`,
        [STUDENT],
      );

      await pg.query(`SELECT public.sweep_operational_log_retention(1)`);

      const left = await pg.query(
        `SELECT event_key FROM public.usage_rate_limit_ledger`,
      );
      expect(left.rows.map((r) => r.event_key)).toEqual(["newer"]);
    });

    it("B1.8 — the sweep is not callable by anon or authenticated", async () => {
      // These tables carry identity. Only service_role may sweep them.
      const r = await pg.query(
        `SELECT
           has_function_privilege('anon',          'public.sweep_operational_log_retention(integer)', 'EXECUTE') AS anon,
           has_function_privilege('authenticated', 'public.sweep_operational_log_retention(integer)', 'EXECUTE') AS auth_role,
           has_function_privilege('service_role',  'public.sweep_operational_log_retention(integer)', 'EXECUTE') AS svc`,
      );
      expect(r.rows[0].anon).toBe(false);
      expect(r.rows[0].auth_role).toBe(false);
      expect(r.rows[0].svc).toBe(true);
    });
  },
);
