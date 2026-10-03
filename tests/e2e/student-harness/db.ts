/**
 * The student screenshot harness's database.
 *
 * @spec [student-UI register §6 Wave 5; CLAUDE.md "derive the fixture from real output"]
 * @implemented [2026-10-03]
 *
 * plain English: the exam harness's database (this repo's migrations, two published forms of
 * readable questions, the paid student with a premium/active entitlement, a linked guardian, a
 * finished calendar setup) built under its own name, plus the free student. Only identity rows
 * are written here: accounts, profiles, the date of birth (the real trigger derives the age
 * fields) and profile completion, which production writes through Supabase Auth and the
 * onboarding form. Learning history is NOT written here: the server seeds it after start-up
 * through the real practice routes (see seed.ts), so the pages render payloads the real
 * producers made.
 */
import type { Client } from "pg";
import { buildHarnessDb } from "../exam-harness/db";
import { PERSONAS } from "./personas";

export const STUDENT_HARNESS_DB = "student_e2e_harness";

export async function buildStudentHarnessDb(): Promise<Client> {
  const pg = await buildHarnessDb(STUDENT_HARNESS_DB);
  const free = PERSONAS.free;
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, [
    free.id,
    free.email,
  ]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name) VALUES ($1::uuid, $2, 'student', $3)`,
    [free.id, free.email, free.displayName],
  );
  for (const persona of Object.values(PERSONAS)) {
    await pg.query(
      `UPDATE public.profiles SET date_of_birth = $2::date, profile_completed_at = '2026-09-01T00:00:00Z'
        WHERE id = $1::uuid`,
      [persona.id, persona.dateOfBirth],
    );
  }
  // The answer rate limit (Doc 02B §14, practice_runtime_config, 30 per minute) is keyed by IP,
  // and every persona's seed answers come from this one local address (about 70 in a few
  // seconds). Raised in this throwaway database only, through the config row the route reads.
  await pg.query(
    `UPDATE public.practice_runtime_config SET value = '1000' WHERE key = 'answer_rate_limit_max'`,
  );
  const check = await pg.query<{ id: string; is_under_13: boolean | null }>(
    `SELECT id, is_under_13 FROM public.profiles WHERE id = ANY($1::uuid[])`,
    [Object.values(PERSONAS).map((p) => p.id)],
  );
  for (const row of check.rows) {
    if (row.is_under_13 !== false) {
      throw new Error(
        `persona ${row.id} is not a known 13+ student (is_under_13=${String(row.is_under_13)})`,
      );
    }
  }
  return pg;
}
