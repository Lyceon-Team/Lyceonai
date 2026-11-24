/**
 * The weekly job's approved-row write against the real `worked_examples` table and its trigger.
 *
 * @spec [Karl's ruling "Worked examples: drop the merge gate" (2026-11-24, SCL-288) item 3: "The
 *       weekly job writes the approved rows itself (what seed-sql.ts produces), using the service
 *       role it already has, before rendering. If the database refuses a row, refuse that
 *       example."; supabase/migrations/20261118000000_worked_examples.sql (worked_examples_leak_guard)]
 *       | @implemented [2026-11-24]
 *
 * plain English: the database is built from supabase/migrations; the job's own admission
 * (admitExample) and its own writer (supabaseRowWriter) run against it through the shared Postgres
 * double. With the fixture's question free, the example is admitted and its row is approved by the
 * task. With the question scheduled as today's QOTD, or in a full-length form, the trigger refuses
 * the row and the example is refused, with no approved row left behind.
 */
import type { Client } from "pg";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { loadExamples } from "../../scripts/worked-examples/content";
import { loadKit } from "../../scripts/worked-examples/kit";
import {
  admitExample,
  supabaseRowWriter,
  type RowTableClient,
} from "../../scripts/worked-examples/weekly-admit";

const DB = "worked_examples_admit_ci";
const CONTENT = join(
  __dirname,
  "../..",
  "tests/fixtures/worked-examples/social",
);
const fixture = loadExamples(CONTENT).find(
  (e) => e.content.question_id === "SATM2CZS1BE",
);
if (!fixture) throw new Error("no fixture example");
const kit = loadKit();
const TASK = {
  by: "worked-examples-task",
  sha: "e".repeat(40),
  at: "2026-11-26T14:07:00Z",
} as const;

let pg: Client;

describe.skipIf(!PG_AVAILABLE)("the job's approved row (real Postgres)", () => {
  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB);
    await pg.query(
      `INSERT INTO public.questions
         (id, section, source_type, domain, skill_codes, difficulty, stem, options,
          correct_answer, explanation, option_metadata, status, item_type, published_at)
       VALUES ($1,'M',1,'Algebra',ARRAY['ALG.D01'],3,'stem',
         '[{"key":"A","text":"1"},{"key":"B","text":"2"},{"key":"C","text":"3"},{"key":"D","text":"4"}]'::jsonb,
         'B','explanation',
         '{"A":{"role":"distractor"},"B":{"role":"correct"},"C":{"role":"distractor"},"D":{"role":"distractor"}}'::jsonb,
         'published','mcq', now())`,
      [fixture.content.question_id],
    );
  }, 240_000);

  afterAll(async () => {
    await pg?.end();
  });

  beforeEach(async () => {
    await pg.query(`DELETE FROM public.worked_examples`);
    await pg.query(`DELETE FROM public.qotd_schedule`);
  });

  const admit = () =>
    admitExample(fixture, {
      checkProblems: [],
      approve: async () => ({ ok: true, approval: TASK }),
      writeRow: supabaseRowWriter(
        makePgSupabase(pg) as unknown as RowTableClient,
      ),
      outroText: kit.voice.outro_text,
    });

  it("DB1 a free question: admitted, and its row is approved by worked-examples-task", async () => {
    expect(await admit()).toEqual({ ok: true, approval: TASK });
    const r = await pg.query(
      `SELECT status, approved_by, approved_at, post_on::text FROM public.worked_examples WHERE question_id = $1`,
      [fixture.content.question_id],
    );
    expect(r.rows).toEqual([
      {
        status: "approved",
        approved_by: "worked-examples-task",
        approved_at: new Date(TASK.at),
        post_on: fixture.content.post_on,
      },
    ]);
    // Idempotent: the same admission again upserts the same row.
    expect(await admit()).toEqual({ ok: true, approval: TASK });
    const n = await pg.query(
      `SELECT count(*)::int AS n FROM public.worked_examples`,
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("DB2 a question that is today's QOTD: the database refuses the row, so the example is refused", async () => {
    await pg.query(
      `INSERT INTO public.qotd_schedule (qotd_date, question_id) VALUES (public.qotd_today(), $1)`,
      [fixture.content.question_id],
    );
    const admitted = await admit();
    expect(admitted).toMatchObject({
      ok: false,
      reason: expect.stringMatching(
        /^the database refused the approved row: .*worked_example_leak: .* is a QOTD today or later/,
      ),
    });
    const r = await pg.query(
      `SELECT count(*)::int AS n FROM public.worked_examples WHERE status = 'approved'`,
    );
    expect(r.rows[0].n).toBe(0);
  });
});
