/**
 * The G0-2 evaluation tables on real Postgres: `tutor_eval_cases` and `tutor_eval_runs` hold
 * student conversation text, so no client may ever reach them.
 *
 * @spec [docs/eval/lisa/G0-2_Teaching_Quality_Set_Design.md §3.2; Karl's ruling 2026-10-27:
 *       student cases live in a server-only table, RLS on, no client policies, service role
 *       only] | @implemented [2026-10-27]
 *
 * plain English:
 *   E1 RLS is on and there are ZERO policies on both tables: one added policy fails this test.
 *   E2 anon and authenticated hold no privilege at all; service_role holds exactly what the
 *      migration grants.
 *   E3 as a service_role probe a case and a run can be written and read; as anon, reading is
 *      refused outright (no policy, no grant).
 *   E4 deleting the student's profile removes their case and every run of it.
 *   E5 a re-run of the same batch cannot double a run; an owner grade needs its timestamp.
 *   E6 SCL-251, 90 days fixed from import: the sweep deletes a case captured 91 days ago and its
 *      runs, and a 91-day-old run of a fresh case; keeps an 89-day case; a dry run counts the
 *      same rows and deletes nothing; anon cannot call it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { PG_AVAILABLE, bootstrapPgDatabase } from "../helpers/pg-supabase";

const DB = "tutor_eval_tables_ci";
const PROBE = "te_service_role_probe";
const TABLES = ["tutor_eval_cases", "tutor_eval_runs"];

describe.skipIf(!PG_AVAILABLE)("tutor eval tables (real Postgres)", () => {
  let admin: pg.Client;
  let n = 0;

  async function student(): Promise<string> {
    n += 1;
    const id = `7e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    await admin.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
      id,
      `te${n}@school.example`,
    ]);
    await admin.query(
      `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at)
       VALUES ($1, $2, 'student', 'Test Student', '2010-01-01'::date, now())
       ON CONFLICT (id) DO NOTHING`,
      [id, `te${n}@school.example`],
    );
    return id;
  }

  async function addCase(caseId: string, studentId: string): Promise<void> {
    await admin.query(
      `INSERT INTO public.tutor_eval_cases (case_id, set_version, student_id, request, production_reply)
       VALUES ($1, 'teaching-quality v1', $2, '{"entry_mode":"scoped_question"}'::jsonb, 'reply')`,
      [caseId, studentId],
    );
  }

  async function addRun(
    caseId: string,
    batch: string,
    index: number,
  ): Promise<void> {
    await admin.query(
      `INSERT INTO public.tutor_eval_runs (case_id, batch_id, run_index, record, verdict)
       VALUES ($1, $2, $3, '{"k":1}'::jsonb, 'unscored')`,
      [caseId, batch, index],
    );
  }

  beforeAll(async () => {
    admin = await bootstrapPgDatabase(DB);
    await admin.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PROBE}') THEN
          CREATE ROLE ${PROBE} NOLOGIN BYPASSRLS INHERIT;
        END IF;
      END $$;
      GRANT service_role TO ${PROBE};
    `);
  });

  afterAll(async () => {
    await admin?.end();
  });

  it("E1 RLS is on and both tables have zero policies", async () => {
    const r = await admin.query<{
      relname: string;
      relrowsecurity: boolean;
      policies: string;
    }>(
      `SELECT c.relname, c.relrowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public' AND c.relname = ANY($1::text[])
        ORDER BY c.relname`,
      [TABLES],
    );
    expect(r.rowCount).toBe(TABLES.length);
    for (const row of r.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(Number(row.policies)).toBe(0);
    }
  });

  it("E2 anon and authenticated hold nothing; service_role holds exactly the grants", async () => {
    const r = await admin.query<{
      t: string;
      r: string;
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
    }>(
      `SELECT t, r,
              has_table_privilege(r, 'public.' || t, 'SELECT') AS sel,
              has_table_privilege(r, 'public.' || t, 'INSERT') AS ins,
              has_table_privilege(r, 'public.' || t, 'UPDATE') AS upd,
              has_table_privilege(r, 'public.' || t, 'DELETE') AS del
         FROM unnest($1::text[]) t, unnest(ARRAY['anon','authenticated','service_role']) r
        ORDER BY t, r`,
      [TABLES],
    );
    expect(r.rows).toEqual([
      {
        t: "tutor_eval_cases",
        r: "anon",
        sel: false,
        ins: false,
        upd: false,
        del: false,
      },
      {
        t: "tutor_eval_cases",
        r: "authenticated",
        sel: false,
        ins: false,
        upd: false,
        del: false,
      },
      {
        t: "tutor_eval_cases",
        r: "service_role",
        sel: true,
        ins: true,
        upd: true,
        del: true,
      },
      {
        t: "tutor_eval_runs",
        r: "anon",
        sel: false,
        ins: false,
        upd: false,
        del: false,
      },
      {
        t: "tutor_eval_runs",
        r: "authenticated",
        sel: false,
        ins: false,
        upd: false,
        del: false,
      },
      {
        t: "tutor_eval_runs",
        r: "service_role",
        sel: true,
        ins: true,
        upd: true,
        del: false,
      },
    ]);
  });

  it("E3 the service_role probe writes and reads; anon is refused", async () => {
    const s = await student();
    await admin.query(`SET ROLE ${PROBE}`);
    try {
      await addCase("E3-CASE", s);
      await addRun("E3-CASE", "11111111-1111-4111-8111-111111111111", 1);
      const read = await admin.query(
        `SELECT count(*)::int AS n FROM public.tutor_eval_runs WHERE case_id = 'E3-CASE'`,
      );
      expect(read.rows[0]).toEqual({ n: 1 });
    } finally {
      await admin.query("RESET ROLE");
    }
    await admin.query("SET ROLE anon");
    try {
      await expect(
        admin.query(`SELECT * FROM public.tutor_eval_cases`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await admin.query("RESET ROLE");
    }
  });

  it("E4 deleting the student's profile removes their case and its runs", async () => {
    const s = await student();
    await addCase("E4-CASE", s);
    await addRun("E4-CASE", "22222222-2222-4222-8222-222222222222", 1);
    await addRun("E4-CASE", "22222222-2222-4222-8222-222222222222", 2);
    const before = await admin.query(
      `SELECT count(*)::int AS n FROM public.tutor_eval_runs WHERE case_id = 'E4-CASE'`,
    );
    expect(before.rows[0]).toEqual({ n: 2 });
    await admin.query(`DELETE FROM public.profiles WHERE id = $1`, [s]);
    const cases = await admin.query(
      `SELECT count(*)::int AS n FROM public.tutor_eval_cases WHERE case_id = 'E4-CASE'`,
    );
    const runs = await admin.query(
      `SELECT count(*)::int AS n FROM public.tutor_eval_runs WHERE case_id = 'E4-CASE'`,
    );
    expect(cases.rows[0]).toEqual({ n: 0 });
    expect(runs.rows[0]).toEqual({ n: 0 });
  });

  it("E5 a batch cannot double a run; an owner grade needs its timestamp", async () => {
    const s = await student();
    await addCase("E5-CASE", s);
    const batch = "33333333-3333-4333-8333-333333333333";
    await addRun("E5-CASE", batch, 1);
    await expect(addRun("E5-CASE", batch, 1)).rejects.toThrow(/duplicate key/);
    await expect(
      admin.query(
        `UPDATE public.tutor_eval_runs SET owner_grade = 'pass' WHERE case_id = 'E5-CASE'`,
      ),
    ).rejects.toThrow(/check constraint/);
    await admin.query(
      `UPDATE public.tutor_eval_runs SET owner_grade = 'pass', owner_graded_at = now()
        WHERE case_id = 'E5-CASE'`,
    );
  });
  it("E6 the 90-day sweep (SCL-251): import time decides; dry run counts what live deletes", async () => {
    const s = await student();
    await addCase("E6-OLD", s);
    await addCase("E6-NEW", s);
    await admin.query(
      `UPDATE public.tutor_eval_cases SET captured_at = now() - interval '91 days' WHERE case_id = 'E6-OLD'`,
    );
    await admin.query(
      `UPDATE public.tutor_eval_cases SET captured_at = now() - interval '89 days' WHERE case_id = 'E6-NEW'`,
    );
    const batch = "66666666-6666-4666-8666-666666666666";
    await addRun("E6-OLD", batch, 1);
    await addRun("E6-NEW", batch, 1);
    await addRun("E6-NEW", batch, 2);
    await admin.query(
      `UPDATE public.tutor_eval_runs SET created_at = now() - interval '91 days'
        WHERE case_id = 'E6-NEW' AND run_index = 2`,
    );
    const left = async (): Promise<{ cases: number; runs: number }> => {
      const r = await admin.query<{ cases: number; runs: number }>(
        `SELECT (SELECT count(*)::int FROM public.tutor_eval_cases WHERE case_id LIKE 'E6-%') AS cases,
                (SELECT count(*)::int FROM public.tutor_eval_runs WHERE case_id LIKE 'E6-%') AS runs`,
      );
      return r.rows[0] ?? { cases: -1, runs: -1 };
    };
    expect(await left()).toEqual({ cases: 2, runs: 3 });

    const dry = await admin.query<{
      swept_table: string;
      deleted_count: number;
    }>(
      `SELECT swept_table, deleted_count FROM public.sweep_tutor_eval_retention(true)`,
    );
    expect(dry.rows).toEqual([
      { swept_table: "tutor_eval_cases", deleted_count: 1 },
      { swept_table: "tutor_eval_runs", deleted_count: 2 },
    ]);
    expect(await left()).toEqual({ cases: 2, runs: 3 });

    const live = await admin.query<{
      swept_table: string;
      deleted_count: number;
    }>(
      `SELECT swept_table, deleted_count FROM public.sweep_tutor_eval_retention(false)`,
    );
    expect(live.rows).toEqual(dry.rows);
    expect(await left()).toEqual({ cases: 1, runs: 1 });
    const kept = await admin.query(
      `SELECT case_id, run_index FROM public.tutor_eval_runs WHERE case_id LIKE 'E6-%'`,
    );
    expect(kept.rows).toEqual([{ case_id: "E6-NEW", run_index: 1 }]);

    await admin.query("SET ROLE anon");
    try {
      await expect(
        admin.query(`SELECT * FROM public.sweep_tutor_eval_retention(true)`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await admin.query("RESET ROLE");
    }
  });
});
