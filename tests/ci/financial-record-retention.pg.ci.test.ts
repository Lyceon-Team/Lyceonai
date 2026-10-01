/**
 * Seven-year payment-record retention — proved on real Postgres.
 *
 * @spec [Privacy Policy v3 §6.2 ("Payment records, kept for 7 years, because tax
 *        and financial rules require it"); Doc-01_V8 §5.1 (entitlement/billing
 *        events, 7 years); Doc-06D_V1.0 §9; SCL-101; owner ruling 2026-09-22 B2]
 * @implemented 2026-09-22
 *
 * plain English: §6.2 published a seven-year period that nothing enforced.
 * SCL-101 filed it as a build commitment so it would not be mistaken for an
 * as-built claim. This is what turns it into one.
 *
 * Nothing will qualify for deletion until 2033. That is exactly why the tests
 * seed rows with back-dated timestamps: a sweep whose input is empty for seven
 * years is a sweep nobody would notice was broken, so its behaviour has to be
 * pinned now rather than discovered later.
 *
 * B2.5 is the one worth reading. `deletion_billing_record` has NO timestamptz
 * column — SCL-088 deliberately removed time-of-deletion signals from the
 * evidence side — so it ages on `cancelled_on`, a DATE. That is the date the
 * financial record is actually about, and it is NOT NULL, so every row has an
 * age. B2.5 pins the column choice rather than trusting the comment.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "financial_record_retention_ci";

const LOG_PAST = "0b2b2b2b-0000-4000-8000-00000000000a";
const LOG_INSIDE = "0b2b2b2b-0000-4000-8000-00000000000b";

/** The two tables and the column each ages on. Mirrors the migration's array. */
const TARGETS = [
  { table: "deletion_billing_record", column: "cancelled_on" },
  { table: "stripe_webhook_events", column: "created_at" },
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
 * deletion_billing_record.log_id references deletion_request_log, so the parent
 * rows come first. request_channel has a single-value CHECK and requested_on and
 * status are NOT NULL with no default — all three are supplied rather than
 * discovered by a failing insert.
 */
async function seedBothSides(): Promise<void> {
  await pg.query(
    `INSERT INTO public.deletion_request_log
       (log_id, request_channel, requested_on, status)
     VALUES ($1, 'self_service_web', (now() - interval '2558 days')::date, 'completed'),
            ($2, 'self_service_web', (now() - interval '2556 days')::date, 'completed')
     ON CONFLICT DO NOTHING`,
    [LOG_PAST, LOG_INSIDE],
  );
  await pg.query(
    `INSERT INTO public.deletion_billing_record (log_id, cancelled_on, final_status)
     VALUES ($1, (now() - interval '2558 days')::date, 'cancelled'),
            ($2, (now() - interval '2556 days')::date, 'cancelled')`,
    [LOG_PAST, LOG_INSIDE],
  );
  await pg.query(
    `INSERT INTO public.stripe_webhook_events (id, type, created_at)
     VALUES ('evt_past',   'invoice.paid', now() - interval '2558 days'),
            ('evt_inside', 'invoice.paid', now() - interval '2556 days')`,
  );
}

describe.skipIf(!PG_AVAILABLE)(
  "Seven-year payment-record retention (v3 §6.2 / SCL-101)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
    }, 240_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      await pg.query(`DELETE FROM public.deletion_billing_record`);
      await pg.query(`DELETE FROM public.stripe_webhook_events`);
      await pg.query(`DELETE FROM public.deletion_request_log`);
    });

    it("B2.1 — the window is defined once, in SQL, and is seven years", async () => {
      const r = await pg.query(
        `SELECT public.financial_record_retention_days() AS d`,
      );
      // 2557 = 365*7 + 2 leap days. Asserted as the number AND as the span, so
      // a plausible-looking wrong value (2555, seven non-leap years) fails.
      expect(r.rows[0].d).toBe(2557);
      expect(r.rows[0].d / 365.25).toBeCloseTo(7, 2);
    });

    it("B2.2 — the two windows are separate definitions, not one shared constant", async () => {
      // §6.2 and §6.7 rest on different bases and are separately amendable.
      // If someone collapses them, amending one silently moves the other.
      const r = await pg.query(
        `SELECT public.financial_record_retention_days()   AS fin,
                public.operational_log_retention_days()    AS ops`,
      );
      expect(r.rows[0].fin).toBe(2557);
      expect(r.rows[0].ops).toBe(90);
    });

    it("B2.3 — a row past its window goes", async () => {
      await seedBothSides();
      const before = await counts();
      for (const { table } of TARGETS) expect(before[table]).toBe(2);

      const swept = await pg.query(
        `SELECT swept_table, deleted_count
           FROM public.sweep_financial_record_retention(100)`,
      );
      const deleted = Object.fromEntries(
        swept.rows.map((r) => [r.swept_table, r.deleted_count]),
      );
      for (const { table } of TARGETS) expect(deleted[table]).toBe(1);
    });

    it("B2.4 — a row inside its window stays, and it is the right row", async () => {
      await seedBothSides();
      await pg.query(`SELECT public.sweep_financial_record_retention(100)`);

      const after = await counts();
      for (const { table } of TARGETS) expect(after[table]).toBe(1);

      const survivor = await pg.query(
        `SELECT id FROM public.stripe_webhook_events`,
      );
      expect(survivor.rows.map((r) => r.id)).toEqual(["evt_inside"]);
    });

    it("B2.5 — deletion_billing_record ages on cancelled_on, its only temporal column", async () => {
      // The table carries no timestamptz by design (SCL-088). If the migration
      // ever ages it on something else, or the column is dropped, this fails.
      const cols = await pg.query(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_name = 'deletion_billing_record'
            AND data_type LIKE 'timestamp%'`,
      );
      expect(cols.rows).toEqual([]); // no timestamptz at all

      const c = await pg.query(
        `SELECT data_type, is_nullable FROM information_schema.columns
          WHERE table_name = 'deletion_billing_record' AND column_name = 'cancelled_on'`,
      );
      expect(c.rows[0].data_type).toBe("date");
      // NOT NULL is what guarantees every row can age. A nullable column would
      // mean rows that never expire behind a successful-looking sweep.
      expect(c.rows[0].is_nullable).toBe("NO");

      await seedBothSides();
      await pg.query(`SELECT public.sweep_financial_record_retention(100)`);
      const left = await pg.query(
        `SELECT cancelled_on FROM public.deletion_billing_record`,
      );
      expect(left.rows).toHaveLength(1);
    });

    it("B2.6 — a zero-row run still reports every table, with its cutoff", async () => {
      const r = await pg.query(
        `SELECT swept_table, deleted_count, cutoff
           FROM public.sweep_financial_record_retention(100)`,
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

    it("B2.7 — oldest goes first", async () => {
      await pg.query(
        `INSERT INTO public.stripe_webhook_events (id, type, created_at)
         VALUES ('evt_oldest', 'invoice.paid', now() - interval '4000 days'),
                ('evt_newer',  'invoice.paid', now() - interval '3000 days')`,
      );
      await pg.query(`SELECT public.sweep_financial_record_retention(1)`);
      const left = await pg.query(
        `SELECT id FROM public.stripe_webhook_events`,
      );
      expect(left.rows.map((r) => r.id)).toEqual(["evt_newer"]);
    });

    it("B2.8 — the sweep is not callable by anon or authenticated", async () => {
      const r = await pg.query(
        `SELECT
           has_function_privilege('anon',          'public.sweep_financial_record_retention(integer)', 'EXECUTE') AS anon,
           has_function_privilege('authenticated', 'public.sweep_financial_record_retention(integer)', 'EXECUTE') AS auth_role,
           has_function_privilege('service_role',  'public.sweep_financial_record_retention(integer)', 'EXECUTE') AS svc`,
      );
      expect(r.rows[0].anon).toBe(false);
      expect(r.rows[0].auth_role).toBe(false);
      expect(r.rows[0].svc).toBe(true);
    });

    it("B2.9 — config history CANNOT be swept: it is append-only (the §6.5 blocker)", async () => {
      // This is the finding that kept §6.5 out of this migration, pinned so the
      // eventual ruling is made against a fact rather than a memory. Nineteen
      // tables carry the shared prevent_update_delete() guard.
      //
      // E1 exam deletion ruling, 2026-09-23: pre-baseline full-length runtime removed
      // pending Doc 04 rebuild. 20260930020000 drops exam_runtime_config_history and
      // full_length_adaptive_config_history, two of the guarded tables, so the floor
      // moves 19 -> 17 (the same slack as before, minus exactly those two). A fresh
      // apply now carries 18. The append-only proof below is unchanged.
      const guarded = await pg.query(
        `SELECT count(*)::int AS n
           FROM pg_trigger t
           JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE p.proname = 'prevent_update_delete' AND NOT t.tgisinternal`,
      );
      expect(guarded.rows[0].n).toBeGreaterThanOrEqual(17);

      // And the guard actually bites — proved against a REAL row, because a
      // row-level trigger does not fire on an empty table and an empty-table
      // delete would pass vacuously.
      await pg.query(
        `INSERT INTO public.auth_runtime_config_history
           (table_name, key, new_value, changed_at)
         VALUES ('auth_runtime_config', 'seeded', '1'::jsonb, now() - interval '3000 days')`,
      );
      await expect(
        pg.query(`DELETE FROM public.auth_runtime_config_history WHERE true`),
      ).rejects.toThrow(/append-only/i);

      const survived = await pg.query(
        `SELECT count(*)::int AS n FROM public.auth_runtime_config_history`,
      );
      expect(survived.rows[0].n).toBe(1);
    });
  },
);
