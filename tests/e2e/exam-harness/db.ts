/**
 * The harness database: this repo's migrations on a throwaway Postgres database,
 * two published forms with readable demo content, and one student.
 *
 * @spec [E7b owner ruling 6] | @implemented [2026-09-25]
 *
 * plain English: builds the schema with the SAME bootstrap the handler-pg tests use
 * (tests/helpers/pg-supabase.ts), loads the CI form fixture, and rewrites its
 * placeholder stems/options into readable ones so the screenshots show a test, not
 * "exg fixture". The canonical answer stays the fixture's ('A' / grid-in '1').
 */
import fs from "fs";
import path from "path";
import type { Client } from "pg";
import { bootstrapPgDatabase } from "../../helpers/pg-supabase";

export const HARNESS_DB = "exam_e2e_harness";
export const STUDENT_ID = "00000000-0000-4000-8000-0000000e7b01";
export const FORMS = [
  { id: "e7b00000-0000-4000-8000-0000000000f1", tag: "E1", name: "Practice Test 1" },
  { id: "e7b00000-0000-4000-8000-0000000000f2", tag: "E2", name: "Practice Test 2" },
] as const;

const here = path.dirname(new URL(import.meta.url).pathname);

const RW_PASSAGES = [
  "Marine biologist Aiko Tanabe has spent nine seasons cataloguing the kelp forests off the Oregon coast. Her surveys show that stands thinned by sea urchins recover fastest where sunflower sea stars have returned, since the stars prey on the urchins that graze young kelp. Tanabe cautions, however, that recovery in her survey plots has been uneven: two sites with similar star densities diverged sharply in kelp cover over the same three years.",
  "In a survey of 400 community gardens, researchers found that roughly $\\frac{1}{3}$ of plots were tended by first-time growers. Those growers were more likely than experienced ones to plant a single crop, a choice the researchers attribute less to preference than to the advice printed on seed packets.",
  "The novelist wrote her early drafts by hand, a habit she kept long after typewriters became common. She claimed that the slowness of the pen forced her to choose each sentence before committing it to the page, and that revision, for her, meant rewriting rather than rearranging.",
];

const RW_OPTIONS = [
  "It presents a finding and then qualifies it with an observation that complicates it.",
  "It describes a method and then explains why that method was abandoned.",
  "It introduces a claim and then offers several examples that support it.",
  "It compares two explanations and then rejects both of them.",
];

export async function buildHarnessDb(): Promise<Client> {
  const pg = await bootstrapPgDatabase(HARNESS_DB);
  await pg.query(fs.readFileSync(path.resolve(here, "../../../scripts/ci/lib/exam-form-fixture.sql"), "utf-8"));
  for (const form of FORMS) {
    await pg.query(`SELECT pg_temp.exam_fixture_make_form($1, $2, 20, 15)`, [form.id, form.tag]);
    await pg.query(
      `UPDATE public.test_forms SET status = 'published', published_at = now(), name = $2 WHERE id = $1`,
      [form.id, form.name],
    );
    // Reading and Writing: a passage, a stem, four prose options.
    await pg.query(
      `UPDATE public.questions q
          SET passage = ($2::text[])[1 + (fi.ordinal % 3)],
              stem = 'Which choice best describes the overall structure of the text?',
              options = jsonb_build_array(
                jsonb_build_object('key','A','text',($3::text[])[1]),
                jsonb_build_object('key','B','text',($3::text[])[2]),
                jsonb_build_object('key','C','text',($3::text[])[3]),
                jsonb_build_object('key','D','text',($3::text[])[4]))
         FROM public.test_form_items fi
        WHERE fi.question_id = q.id AND fi.test_form_id = $1 AND fi.section = 'RW'`,
      [form.id, RW_PASSAGES, RW_OPTIONS],
    );
    // Math multiple choice: the correct option (A) is x = ordinal + 2.
    await pg.query(
      `UPDATE public.questions q
          SET stem = 'If $3x + ' || (fi.ordinal + 1) || ' = ' || (3 * (fi.ordinal + 2) + fi.ordinal + 1) || '$, what is the value of $x$?',
              options = jsonb_build_array(
                jsonb_build_object('key','A','text', (fi.ordinal + 2)::text),
                jsonb_build_object('key','B','text', (fi.ordinal + 3)::text),
                jsonb_build_object('key','C','text', (fi.ordinal + 5)::text),
                jsonb_build_object('key','D','text', (fi.ordinal + 7)::text))
         FROM public.test_form_items fi
        WHERE fi.question_id = q.id AND fi.test_form_id = $1 AND fi.section = 'M' AND q.item_type = 'mcq'`,
      [form.id],
    );
    // Math grid-in: the fixture's accepted answer is '1'.
    await pg.query(
      `UPDATE public.questions q
          SET stem = 'A line in the $xy$-plane passes through $(0, -3)$ and $(2, -1)$. What is the slope of the line?'
         FROM public.test_form_items fi
        WHERE fi.question_id = q.id AND fi.test_form_id = $1 AND q.item_type = 'grid_in'`,
      [form.id],
    );
  }
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, 'student@example.test')`, [STUDENT_ID]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name) VALUES ($1::uuid, 'student@example.test', 'student', 'Sam Rivera')`,
    [STUDENT_ID],
  );
  // E9b: a finished calendar setup (UTC, every day, 60 minutes, no test weekday), so the
  // first open of /calendar generates the plan (R-08-04) and the student can add a
  // full-length block to today.
  await pg.query(
    `INSERT INTO public.student_study_profile
       (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
     VALUES ($1, 'UTC', 127, 60, NULL, 1400, now())`,
    [STUDENT_ID],
  );
  return pg;
}
