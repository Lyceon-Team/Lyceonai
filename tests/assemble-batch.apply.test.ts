/**
 * Apply-proof: verifies the gate's rendered SQL applies cleanly against
 * the real `questions` schema constraints on an ephemeral Postgres.
 *
 * SCHEMA PROVENANCE: QUESTIONS_DDL below is the authoritative committed
 * test fixture, sourced from the deployed `questions` table DDL (prod
 * Supabase project, 2026-07-01). infra/supabase/migrations/ does not
 * exist in-repo — tracked as a follow-up gap (see PR #465 close-out
 * Step 3.3). If the prod schema changes, this fixture must be updated
 * to match. CHECK constraints reproduced verbatim from prod.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, execSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { resolve, join } from "path";
import pg from "pg";

const ROOT = resolve(import.meta.dirname, "..");
const SCRATCH = resolve(ROOT, "tests/__fixtures__/assemble-batch-apply");
const ASSEMBLE_BATCH_SCRIPT = resolve(ROOT, "scripts/assemble-batch.ts");

const QUESTIONS_DDL = `
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY
    CHECK (id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$'),
  section TEXT NOT NULL
    CHECK (section = ANY (ARRAY['M','RW'])),
  source_type INTEGER NOT NULL
    CHECK (source_type = ANY (ARRAY[1,2])),
  domain TEXT NOT NULL,
  skill_codes TEXT[] NOT NULL,
  difficulty INTEGER NOT NULL
    CHECK (difficulty >= 1 AND difficulty <= 3),
  item_type TEXT NOT NULL DEFAULT 'mcq'
    CHECK (item_type = ANY (ARRAY['mcq','grid_in'])),
  stem TEXT NOT NULL,
  passage TEXT,
  options JSONB NOT NULL,
  correct_answer TEXT NOT NULL,
  correct_variants TEXT[],
  explanation TEXT NOT NULL,
  option_metadata JSONB,
  assets JSONB,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft','qa','published','retired'])),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  estimated_time_seconds INTEGER,
  premium_flag BOOLEAN DEFAULT FALSE,
  quality_score NUMERIC,
  issue_flags TEXT[],
  source_lineage JSONB,
  generation_attribution JSONB,
  CONSTRAINT questions_item_shape_chk CHECK (
    (item_type='mcq'     AND jsonb_typeof(options)='array' AND jsonb_array_length(options)=4 AND correct_variants IS NULL)
    OR
    (item_type='grid_in' AND jsonb_typeof(options)='array' AND jsonb_array_length(options)=0 AND correct_variants IS NOT NULL AND array_length(correct_variants,1)>=1)
  )
);
`;

function pgAvailable(): boolean {
  try {
    execSync("pg_isready -h localhost -p 5432", {
      encoding: "utf-8",
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

describe("assemble-batch apply-proof (ephemeral PG)", () => {
  let client: pg.Client;
  const skip = !pgAvailable();

  beforeAll(async () => {
    if (skip) return;
    mkdirSync(SCRATCH, { recursive: true });

    const admin = new pg.Client({
      host: "localhost",
      port: 5432,
      database: "postgres",
      user: "postgres",
    });
    await admin.connect();
    await admin.query("DROP DATABASE IF EXISTS gate_test");
    await admin.query("CREATE DATABASE gate_test");
    await admin.end();

    client = new pg.Client({
      host: "localhost",
      port: 5432,
      database: "gate_test",
      user: "postgres",
    });
    await client.connect();
    await client.query(QUESTIONS_DDL);
  });

  afterAll(async () => {
    if (skip) return;
    await client?.end();
  });

  it.skipIf(skip)(
    "gate-rendered SQL for MCQ + grid-in applies with zero constraint violations",
    async () => {
      const partsDir = join(SCRATCH, "apply-parts");
      mkdirSync(partsDir, { recursive: true });

      const mcqRecord = {
        section: "M",
        domain: "Algebra",
        skill: "Linear Equations in One Variable",
        difficulty: 1,
        item_type: "mcq",
        stem: "If $2x = 10$, what is $x$?",
        passage: null,
        options: [
          { key: "A", text: "5" },
          { key: "B", text: "10" },
          { key: "C", text: "2" },
          { key: "D", text: "-5" },
        ],
        correct_option: "A",
        option_metadata: {
          A: { role: "correct", error_taxonomy: null },
          B: { role: "distractor", error_taxonomy: "partial_reasoning" },
          C: { role: "distractor", error_taxonomy: "arithmetic_slip" },
          D: { role: "distractor", error_taxonomy: "sign_error" },
        },
        explanation:
          "The correct answer is A. Divide both sides by 2 to get x = 5.",
        estimated_time_seconds: 45,
      };

      const gridInRecord = {
        section: "M",
        domain: "Algebra",
        skill: "Linear Equations in One Variable",
        difficulty: 2,
        item_type: "grid_in",
        stem: "If $3x + 6 = 21$, what is the value of $x$?",
        passage: null,
        correct_answer: "5",
        explanation:
          "The correct answer is 5. Subtract 6: 3x=15, divide by 3: x=5.",
        estimated_time_seconds: 60,
      };

      const ndjson = [
        JSON.stringify(mcqRecord),
        JSON.stringify(gridInRecord),
      ].join("\n");
      writeFileSync(join(partsDir, "test.ndjson"), ndjson);

      const outPath = join(SCRATCH, "apply-test.sql");
      const reportPath = join(SCRATCH, "apply-report.json");
      execFileSync(
        "pnpm",
        [
          "exec",
          "tsx",
          ASSEMBLE_BATCH_SCRIPT,
          "--in",
          partsDir,
          "--out",
          outPath,
          "--report",
          reportPath,
        ],
        { cwd: ROOT, encoding: "utf-8", timeout: 30000 },
      );

      const sql = readFileSync(outPath, "utf-8");
      expect(sql).toBeTruthy();

      await client.query(sql);

      const { rows } = await client.query(
        "SELECT id, item_type, jsonb_array_length(options) AS opt_len, correct_variants, option_metadata FROM questions ORDER BY id",
      );

      expect(rows).toHaveLength(2);

      const mcqRow = rows.find(
        (r: Record<string, unknown>) => r.item_type === "mcq",
      );
      const gridInRow = rows.find(
        (r: Record<string, unknown>) => r.item_type === "grid_in",
      );

      expect(mcqRow).toBeDefined();
      expect(gridInRow).toBeDefined();

      expect(mcqRow!.opt_len).toBe(4);
      expect(mcqRow!.correct_variants).toBeNull();
      expect(mcqRow!.option_metadata).toBeTruthy();

      expect(gridInRow!.opt_len).toBe(0);
      expect(gridInRow!.correct_variants).toBeTruthy();
      expect(Array.isArray(gridInRow!.correct_variants)).toBe(true);
      expect(
        (gridInRow!.correct_variants as string[]).length,
      ).toBeGreaterThanOrEqual(1);
      expect(gridInRow!.correct_variants as string[]).toContain("5");
    },
  );

  it.skipIf(skip)(
    "grid-in with fraction (2/3) applies and has correct variants",
    async () => {
      await client.query("DELETE FROM questions;");

      const partsDir = join(SCRATCH, "apply-fraction");
      mkdirSync(partsDir, { recursive: true });

      const gridInFractionRecord = {
        section: "M",
        domain: "Advanced Math",
        skill: "Nonlinear Functions",
        difficulty: 3,
        item_type: "grid_in",
        stem: "If $f(x) = \\frac{2}{3}x$, what is $f(1)$?",
        passage: null,
        correct_answer: "2/3",
        explanation: "The correct answer is 2/3. Substitute x=1: f(1)=2/3.",
        estimated_time_seconds: 60,
      };

      writeFileSync(
        join(partsDir, "test.ndjson"),
        JSON.stringify(gridInFractionRecord),
      );

      const outPath = join(SCRATCH, "apply-fraction.sql");
      const reportPath = join(SCRATCH, "apply-fraction-report.json");
      execFileSync(
        "pnpm",
        [
          "exec",
          "tsx",
          ASSEMBLE_BATCH_SCRIPT,
          "--in",
          partsDir,
          "--out",
          outPath,
          "--report",
          reportPath,
        ],
        { cwd: ROOT, encoding: "utf-8", timeout: 30000 },
      );

      const sql = readFileSync(outPath, "utf-8");
      await client.query(sql);

      const { rows } = await client.query(
        "SELECT correct_variants, correct_answer FROM questions WHERE item_type='grid_in'",
      );
      expect(rows).toHaveLength(1);

      const variants = rows[0].correct_variants as string[];
      expect(variants).toContain("2/3");
      expect(variants).toContain(".666");
      expect(variants).toContain("0.666");
      expect(variants).toContain(".667");
      expect(variants).toContain("0.667");
    },
  );

  it.skipIf(skip)(
    "item_shape_chk rejects MCQ with correct_variants (proves CHECK is active)",
    async () => {
      await expect(
        client.query(`
          INSERT INTO questions (id, section, source_type, domain, skill_codes, difficulty,
            item_type, stem, options, correct_answer, correct_variants, explanation)
          VALUES ('SATM2TESTAA', 'M', 2, 'Algebra', ARRAY['Linear Equations in One Variable'], 1,
            'mcq', 'test stem', '[{"key":"A","text":"1"},{"key":"B","text":"2"},{"key":"C","text":"3"},{"key":"D","text":"4"}]'::jsonb,
            'A', ARRAY['1'], 'test explanation')
        `),
      ).rejects.toThrow(/questions_item_shape_chk/);
    },
  );

  it.skipIf(skip)(
    "item_shape_chk rejects grid_in without correct_variants (proves CHECK is active)",
    async () => {
      await expect(
        client.query(`
          INSERT INTO questions (id, section, source_type, domain, skill_codes, difficulty,
            item_type, stem, options, correct_answer, explanation)
          VALUES ('SATM2TESTBB', 'M', 2, 'Algebra', ARRAY['Linear Equations in One Variable'], 1,
            'grid_in', 'test stem', '[]'::jsonb, '5', 'test explanation')
        `),
      ).rejects.toThrow(/questions_item_shape_chk/);
    },
  );

  it.skipIf(skip)(
    "MCQ with embedded double-quotes and backslashes in option text applies cleanly",
    async () => {
      await client.query("DELETE FROM questions;");

      const partsDir = join(SCRATCH, "apply-embedded-quotes");
      mkdirSync(partsDir, { recursive: true });

      const record = {
        section: "RW",
        domain: "Information and Ideas",
        skill: "Command of Evidence",
        difficulty: 3,
        item_type: "mcq",
        stem: "Which quotation most effectively supports the critic's argument?",
        passage:
          'In Voss\'s novel, Thomas states, "My brother and I were inseparable." However, other textual evidence contradicts this claim.',
        options: [
          {
            key: "A",
            text: 'Thomas states, "My brother and I were inseparable; every summer we explored the woods together, never once quarreling."',
          },
          {
            key: "B",
            text: 'A letter from Thomas\'s mother reads, "I worry about the boys constantly fighting."',
          },
          {
            key: "C",
            text: 'Thomas reflects, "Looking back, I realize childhood has \\frac{many}{layers}."',
          },
          {
            key: "D",
            text: "The novel's epilogue describes a holiday dinner.",
          },
        ],
        correct_option: "B",
        option_metadata: {
          A: { role: "distractor", error_taxonomy: "partial_reasoning" },
          B: { role: "correct", error_taxonomy: null },
          C: { role: "distractor", error_taxonomy: "partial_reasoning" },
          D: { role: "distractor", error_taxonomy: "evidence_mismatch" },
        },
        explanation:
          "The correct answer is B. The mother's letter directly contradicts Thomas's claim. Option A illustrates Thomas's own narration. Option C is a qualified reflection. Option D is neutral.",
        estimated_time_seconds: 120,
      };

      writeFileSync(join(partsDir, "test.ndjson"), JSON.stringify(record));

      const outPath = join(SCRATCH, "apply-embedded-quotes.sql");
      const reportPath = join(SCRATCH, "apply-embedded-quotes-report.json");
      execFileSync(
        "pnpm",
        [
          "exec",
          "tsx",
          ASSEMBLE_BATCH_SCRIPT,
          "--in",
          partsDir,
          "--out",
          outPath,
          "--report",
          reportPath,
        ],
        { cwd: ROOT, encoding: "utf-8", timeout: 30000 },
      );

      const sql = readFileSync(outPath, "utf-8");
      expect(sql).toContain("$lyceon_json$");

      await client.query(sql);

      const { rows } = await client.query(
        "SELECT id, options, option_metadata, source_lineage, generation_attribution FROM questions",
      );
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      const options = row.options as Array<{ key: string; text: string }>;
      expect(options).toHaveLength(4);
      expect(options[0].text).toContain("My brother and I were inseparable");
      expect(options[1].text).toContain(
        "I worry about the boys constantly fighting",
      );
      expect(row.option_metadata).toBeTruthy();
      expect(row.source_lineage).toBeTruthy();
      expect(row.generation_attribution).toBeTruthy();
    },
  );
});
