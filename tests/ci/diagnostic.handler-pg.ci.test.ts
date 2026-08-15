/**
 * Diagnostic handler → real PostgreSQL proof
 *
 * @spec [Doc-05A §11, Codex re-audit Fix C] | @implemented [2026-08-08]
 *
 * Proves the HANDLER actually drives mastery emission and completion against
 * real PostgreSQL — not SQL mimicry. This test:
 *   1. Applies all migrations to an ephemeral PG16 database
 *   2. Seeds 40 diagnostic questions (8 domains × 5)
 *   2b. Seeds a PRIOR practice answer with occurred_at = NULL — reproduces
 *       LIVE BUG #3 where historical NULL occurred_at poisoned
 *       compute_mastery_for_entity during diagnostic answer submission.
 *       The backfill migration (20260815000000) applies COALESCE defense
 *       so the NULL is harmless when answered_at is present.
 *   3. Creates a diagnostic session + 40 served items
 *   4. Submits all 40 answers THROUGH the handler (/api/practice/answer)
 *   5. Queries PG and asserts:
 *      (a) 40 diagnostic_attempt audit rows (session-scoped JOIN)
 *      (b) student_skill_mastery rows with event_count_total > 0
 *      (c) student_section_projections non-NULL for both M and RW
 *      (d) Replay → no duplicate audit rows (idempotency)
 *      (e) Session status = 'completed' in PG
 *
 * If the handler stops calling applyMasteryEvent, (a)–(c) fail immediately.
 *
 * GROUNDED SEED CONTRACT — seed data matches the real published-question shape:
 *   - questions.options: [{key,text}] A–D (exactly 4, canonical keys)
 *   - questions.correct_answer: keyed 'B' (MCQ key match)
 *   - questions.option_metadata: {"A":{role:"distractor",...},"B":{role:"correct",...},...}
 *   - questions.correct_variants: NULL (MCQs are NOT graded via correct_variants)
 *   - NO option_order / option_token_map on questions (those live on PSI only)
 *   - PSI.option_order: text[] randomized serve order
 *   - PSI.option_token_map: token→key map (grading resolves tokens to canonical keys)
 *   - PSI.question_option_metadata: mirrors questions.option_metadata in snapshot
 *   - PSI.question_correct_variants: NULL for MCQ
 *
 * Runs ONLY in CI jobs with PG16 service container (PGHOST set).
 * Skipped silently in the regular `ci` job (no PG available).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express, Request, Response, NextFunction } from "express";
import { Client } from "pg";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// PG availability gate — skip entirely when no PG is available
// ---------------------------------------------------------------------------
const CAN_RUN = !!process.env.PGHOST;
const PG_HOST = process.env.PGHOST ?? "localhost";
const PG_PORT = process.env.PGPORT ?? "5432";
const PG_USER = process.env.PGUSER ?? "postgres";
const PG_PASSWORD = process.env.PGPASSWORD ?? "postgres";
const DB_NAME = "diagnostic_handler_ci";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const TEST_USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TEST_SESSION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PRIOR_PRACTICE_SESSION_ID = "11111111-1111-1111-1111-111111111111";
const PRIOR_PRACTICE_ITEM_ID = "22222222-2222-2222-2222-222222222222";

// PROD-SHAPED skill names: real SAT skill taxonomy uses human-readable skill
// names, NOT short codes.  The original test used 'ALG.D01' etc., which hid
// the prod bug (NULL occurred_at on prior practice answers) because the test
// had no prior history.  These names match the shape of real published
// questions in the Lyceon question bank.
const CANONICAL_DOMAINS: [string, string, string, string][] = [
  ["M", "Algebra", "Linear Equations in One Variable", "DGA"],
  ["M", "Advanced Math", "Nonlinear Functions", "DGB"],
  ["M", "Problem Solving and Data Analysis", "Ratios and Proportions", "DGC"],
  ["M", "Geometry and Trigonometry", "Right Triangles and Trigonometry", "DGD"],
  ["RW", "Information and Ideas", "Central Ideas and Details", "DGE"],
  ["RW", "Craft and Structure", "Words in Context", "DGF"],
  ["RW", "Expression of Ideas", "Rhetorical Synthesis", "DGG"],
  ["RW", "Standard English Conventions", "Boundaries", "DGH"],
];

const DIFFICULTIES = [1, 2, 3, 1, 2];

/** Build a deterministic item UUID from ordinal (1–40). */
function itemUuid(ordinal: number): string {
  const hex = ordinal.toString(16).padStart(4, "0");
  return `cccccccc-cccc-cccc-cccc-cccccccc${hex}`;
}

/** Build a question ID from domain index (0–7) and question index (1–5). */
function questionId(domainIdx: number, qIdx: number): string {
  const [section, , , abbr] = CANONICAL_DOMAINS[domainIdx]!;
  return `SAT${section}1${abbr}${String(qIdx).padStart(2, "0")}X`;
}

// ---------------------------------------------------------------------------
// PG-backed Supabase query builder — handles ONLY the patterns the handler uses
// ---------------------------------------------------------------------------

/**
 * Minimal PG-backed Supabase-like query builder.
 * NOT a general PostgREST replacement — covers only the chain patterns
 * used by submitPracticeAnswer and its helpers.
 */
class PgQueryBuilder {
  private pgClient: Client;
  private table: string;
  private selectCols = "*";
  private isCount = false;
  private isHead = false;
  private whereClauses: { type: string; col: string; val: unknown }[] = [];
  private updatePatch: Record<string, unknown> | null = null;
  private orderCols: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;

  constructor(pgClient: Client, table: string) {
    this.pgClient = pgClient;
    this.table = table;
  }

  select(cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (cols) this.selectCols = cols;
    if (opts?.count === "exact") this.isCount = true;
    if (opts?.head) this.isHead = true;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.whereClauses.push({ type: "eq", col, val });
    return this;
  }

  neq(col: string, val: unknown): this {
    this.whereClauses.push({ type: "neq", col, val });
    return this;
  }

  in(col: string, vals: unknown[]): this {
    this.whereClauses.push({ type: "in", col, val: vals });
    return this;
  }

  // Chain-compat no-ops for patterns the handler chains but this test doesn't need
  is(): this {
    return this;
  }
  or(): this {
    return this;
  }
  not(): this {
    return this;
  }
  gt(): this {
    return this;
  }
  gte(): this {
    return this;
  }
  lt(): this {
    return this;
  }
  lte(): this {
    return this;
  }
  like(): this {
    return this;
  }
  ilike(): this {
    return this;
  }
  filter(): this {
    return this;
  }
  match(): this {
    return this;
  }
  contains(): this {
    return this;
  }
  containedBy(): this {
    return this;
  }
  range(): this {
    return this;
  }
  overlaps(): this {
    return this;
  }
  textSearch(): this {
    return this;
  }
  private insertRows: Record<string, unknown>[] | null = null;
  private upsertIgnoreDuplicates = false;
  private upsertConflictCols: string | null = null;

  insert(
    rows: Record<string, unknown> | Record<string, unknown>[],
    _opts?: Record<string, unknown>,
  ): this {
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(
    rows: Record<string, unknown> | Record<string, unknown>[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    this.upsertIgnoreDuplicates = opts?.ignoreDuplicates ?? false;
    this.upsertConflictCols = opts?.onConflict ?? null;
    return this;
  }

  delete(): this {
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.updatePatch = patch;
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCols.push({ col, asc: opts?.ascending !== false });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  private buildWhere(startIdx: number): {
    sql: string;
    params: unknown[];
  } {
    const parts: string[] = [];
    const params: unknown[] = [];
    let idx = startIdx;
    for (const w of this.whereClauses) {
      if (w.type === "eq") {
        if (w.val === null) {
          parts.push(`"${w.col}" IS NULL`);
        } else {
          parts.push(`"${w.col}" = $${idx}`);
          params.push(w.val);
          idx++;
        }
      } else if (w.type === "neq") {
        if (w.val === null) {
          parts.push(`"${w.col}" IS NOT NULL`);
        } else {
          parts.push(`"${w.col}" != $${idx}`);
          params.push(w.val);
          idx++;
        }
      } else if (w.type === "in") {
        const vals = w.val as unknown[];
        if (vals.length === 0) {
          parts.push("FALSE");
        } else {
          const placeholders = vals.map(() => `$${idx++}`).join(", ");
          parts.push(`"${w.col}" IN (${placeholders})`);
          params.push(...vals);
        }
      }
    }
    return {
      sql: parts.length > 0 ? " WHERE " + parts.join(" AND ") : "",
      params,
    };
  }

  private buildOrderLimit(): string {
    let sql = "";
    if (this.orderCols.length > 0) {
      sql +=
        " ORDER BY " +
        this.orderCols
          .map((o) => `"${o.col}" ${o.asc ? "ASC" : "DESC"}`)
          .join(", ");
    }
    if (this.limitN !== null) {
      sql += ` LIMIT ${this.limitN}`;
    }
    return sql;
  }

  async maybeSingle(): Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }> {
    try {
      if (this.updatePatch) {
        const cols = Object.keys(this.updatePatch);
        const vals = Object.values(this.updatePatch);
        const setParts = cols.map((c, i) => `"${c}" = $${i + 1}`);
        const { sql: whereSql, params: whereParams } = this.buildWhere(
          cols.length + 1,
        );
        const sql = `UPDATE public."${this.table}" SET ${setParts.join(", ")}${whereSql} RETURNING *`;
        const result = await this.pgClient.query(sql, [
          ...vals,
          ...whereParams,
        ]);
        return { data: result.rows[0] ?? null, error: null };
      }
      const { sql: whereSql, params } = this.buildWhere(1);
      const sql = `SELECT * FROM public."${this.table}"${whereSql}${this.buildOrderLimit()} LIMIT 1`;
      const result = await this.pgClient.query(sql, params);
      return { data: result.rows[0] ?? null, error: null };
    } catch (err: unknown) {
      return { data: null, error: { message: (err as Error).message } };
    }
  }

  async single(): Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }> {
    const result = await this.maybeSingle();
    if (!result.data && !result.error) {
      return { data: null, error: { message: "Row not found" } };
    }
    return result;
  }

  then(
    resolve: (v: {
      data: unknown[] | null;
      count?: number;
      error: { message: string } | null;
    }) => void,
  ): void {
    (async () => {
      try {
        // INSERT / UPSERT (e.g. captureDiagnosticBaseline)
        if (this.insertRows && this.insertRows.length > 0) {
          const cols = Object.keys(this.insertRows[0]!);
          const allVals: unknown[] = [];
          const rowPlaceholders: string[] = [];
          let pIdx = 1;
          for (const row of this.insertRows) {
            const ph = cols.map(() => `$${pIdx++}`);
            rowPlaceholders.push(`(${ph.join(", ")})`);
            for (const c of cols) allVals.push(row[c]);
          }
          const colList = cols.map((c) => `"${c}"`).join(", ");
          let sql = `INSERT INTO public."${this.table}" (${colList}) VALUES ${rowPlaceholders.join(", ")}`;
          if (this.upsertIgnoreDuplicates && this.upsertConflictCols) {
            sql += ` ON CONFLICT (${this.upsertConflictCols}) DO NOTHING`;
          }
          sql += " RETURNING *";
          try {
            const result = await this.pgClient.query(sql, allVals);
            resolve({ data: result.rows, error: null });
          } catch (insertErr: unknown) {
            const pgErr = insertErr as { message: string; code?: string };
            resolve({
              data: null,
              error: { message: pgErr.message, code: pgErr.code },
            });
          }
          return;
        }

        // Bare .update().eq() without .select() (e.g. updateSessionLifecycle)
        if (this.updatePatch) {
          const cols = Object.keys(this.updatePatch);
          const vals = Object.values(this.updatePatch);
          const setParts = cols.map((c, i) => `"${c}" = $${i + 1}`);
          const { sql: whereSql, params: whereParams } = this.buildWhere(
            cols.length + 1,
          );
          const sql = `UPDATE public."${this.table}" SET ${setParts.join(", ")}${whereSql}`;
          await this.pgClient.query(sql, [...vals, ...whereParams]);
          resolve({ data: null, error: null });
          return;
        }

        const { sql: whereSql, params } = this.buildWhere(1);

        if (this.isCount) {
          const countSql = `SELECT count(*)::integer AS count FROM public."${this.table}"${whereSql}`;
          const countResult = await this.pgClient.query(countSql, params);
          const count = countResult.rows[0]?.count ?? 0;
          if (this.isHead) {
            resolve({ data: null, count, error: null });
          } else {
            const dataSql = `SELECT * FROM public."${this.table}"${whereSql}${this.buildOrderLimit()}`;
            const dataResult = await this.pgClient.query(dataSql, params);
            resolve({ data: dataResult.rows, count, error: null });
          }
          return;
        }

        const sql = `SELECT * FROM public."${this.table}"${whereSql}${this.buildOrderLimit()}`;
        const result = await this.pgClient.query(sql, params);
        resolve({ data: result.rows, error: null });
      } catch (err: unknown) {
        const pgErr = err as { message: string; code?: string };
        resolve({
          data: [],
          error: { message: pgErr.message, code: pgErr.code },
        });
      }
    })();
  }
}

function createPgBackedSupabase(pgClient: Client): Record<string, unknown> {
  return {
    from: (table: string) => new PgQueryBuilder(pgClient, table),
    rpc: async (fnName: string, params: Record<string, unknown>) => {
      try {
        const keys = Object.keys(params);
        const placeholders = keys.map((k, i) => `${k} := $${i + 1}`).join(", ");
        const values = keys.map((k) => params[k]);
        const sql = `SELECT * FROM public.${fnName}(${placeholders})`;
        const result = await pgClient.query(sql, values);
        return { data: result.rows[0] ?? null, error: null };
      } catch (err: unknown) {
        return { data: null, error: { message: (err as Error).message } };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Module-level PG client — set before vi.mock factories can access it
// ---------------------------------------------------------------------------
let testPg: Client | null = null;

// ---------------------------------------------------------------------------
// Mock supabase-server to use PG-backed adapter
// ---------------------------------------------------------------------------
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: new Proxy(
    {},
    {
      get(_target, prop) {
        if (!testPg) throw new Error("PG client not initialised");
        const adapter = createPgBackedSupabase(testPg);
        return (adapter as Record<string, unknown>)[prop as string];
      },
    },
  ),
}));

// ---------------------------------------------------------------------------
// Mock supabase-admin to use PG-backed RPC adapter
// ---------------------------------------------------------------------------
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    if (!testPg) throw new Error("PG client not initialised");
    return createPgBackedSupabase(testPg);
  },
}));

// ---------------------------------------------------------------------------
// Mock CSRF (same as other CI tests)
// ---------------------------------------------------------------------------
vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  generateToken: () => "test-csrf-token",
}));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe.skipIf(!CAN_RUN)("Diagnostic handler → real PG proof", () => {
  let adminPg: Client;
  let app: Express;

  beforeAll(async () => {
    // ---------------------------------------------------------------
    // 1. Create throwaway database
    // ---------------------------------------------------------------
    adminPg = new Client({
      host: PG_HOST,
      port: Number(PG_PORT),
      user: PG_USER,
      password: PG_PASSWORD,
      database: "postgres",
    });
    await adminPg.connect();
    await adminPg.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await adminPg.query(`CREATE DATABASE ${DB_NAME}`);

    // ---------------------------------------------------------------
    // 2. Connect to test database
    // ---------------------------------------------------------------
    testPg = new Client({
      host: PG_HOST,
      port: Number(PG_PORT),
      user: PG_USER,
      password: PG_PASSWORD,
      database: DB_NAME,
    });
    await testPg.connect();

    // ---------------------------------------------------------------
    // 3. Stub Supabase auth schema (same as practice-integration.sh)
    // ---------------------------------------------------------------
    await testPg.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')
            THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated')
            THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')
            THEN CREATE ROLE service_role NOLOGIN; END IF;
        END $$;
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE IF NOT EXISTS auth.users (
          id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb
        );
        CREATE OR REPLACE FUNCTION auth.uid()
          RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
      `);

    // ---------------------------------------------------------------
    // 4. Apply all migrations
    // ---------------------------------------------------------------
    const migrationsDir = path.resolve(__dirname, "../../supabase/migrations");
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      await testPg.query(sql);
    }

    // ---------------------------------------------------------------
    // 4b. Raise rate-limit ceiling so 40 rapid answers don't 429
    // ---------------------------------------------------------------
    await testPg.query(
      `UPDATE public.practice_runtime_config
         SET value = '200'
       WHERE key = 'answer_rate_limit_max'`,
    );

    // ---------------------------------------------------------------
    // 5. Seed 40 diagnostic questions (8 domains × 5)
    // ---------------------------------------------------------------
    for (let d = 0; d < 8; d++) {
      const [section, domain, skillCode] = CANONICAL_DOMAINS[d]!;
      for (let q = 1; q <= 5; q++) {
        const qid = questionId(d, q);
        // Seed matches grounded real-question contract:
        // - options: [{key,text}] A–D (4 canonical options)
        // - correct_answer: keyed 'B' (MCQ key match)
        // - option_metadata: one key role:"correct" (B), rest "distractor"
        // - correct_variants: NULL (MCQs are NOT graded via correct_variants — that's grid-in)
        // - NO option_order, NO option_token_map on questions (those live on PSI snapshot)
        await testPg.query(
          `INSERT INTO public.questions
              (id, section, source_type, domain, skill_codes, difficulty,
               stem, options, correct_answer, explanation,
               option_metadata, status, published_at)
            VALUES ($1, $2, 1, $3, ARRAY[$4], $5,
              $6,
              '[{"key":"A","text":"Option A"},{"key":"B","text":"Option B"},{"key":"C","text":"Option C"},{"key":"D","text":"Option D"}]'::jsonb,
              'B', $7,
              '{"A":{"role":"distractor","error_taxonomy":"common-misconception"},"B":{"role":"correct","error_taxonomy":null},"C":{"role":"distractor","error_taxonomy":"common-misconception"},"D":{"role":"distractor","error_taxonomy":"common-misconception"}}'::jsonb,
              'published', now())`,
          [
            qid,
            section,
            domain,
            skillCode,
            DIFFICULTIES[q - 1],
            `Diagnostic ${domain} Q${q}`,
            `Explanation for ${domain} Q${q}`,
          ],
        );
      }
    }

    // ---------------------------------------------------------------
    // 6. Create test user
    // ---------------------------------------------------------------
    await testPg.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, 'handler-pg-ci@example.com')`,
      [TEST_USER_ID],
    );

    // ---------------------------------------------------------------
    // 6b. Seed a PRIOR practice session with an answered item whose
    //     occurred_at is NULL — reproduces LIVE BUG #3.
    //
    //     ROOT CAUSE: practice_session_items answered before the handler
    //     began stamping occurred_at (2026-07-22 → 2026-08-06) carry
    //     occurred_at = NULL.  When the diagnostic handler later submits
    //     an answer for the SAME (student, section, domain, skill) entity,
    //     compute_mastery_for_entity validates ALL historical events and
    //     raises MASTERY_HISTORICAL_DATA_INVALID on the NULL occurred_at.
    //
    //     The item shares (M, "Advanced Math", "Nonlinear Functions") with
    //     diagnostic domain index 1, so the first diagnostic answer for
    //     that skill hits the poisoned history.
    //
    //     With the backfill migration (20260815000000_backfill_occurred_at)
    //     applied, the COALESCE defence in canonical_mastery_events makes
    //     the NULL safe: COALESCE(NULL, '2026-07-22T12:00:00Z') returns the
    //     answered_at value, and compute_mastery_for_entity sees no bad rows.
    // ---------------------------------------------------------------
    await testPg.query(
      `INSERT INTO public.practice_sessions
          (id, user_id, actor_id, mode, filters, target_count, platform, status)
        VALUES ($1, $2, $2, 'balanced',
          '{"target_question_count": 20}', 20, 'web', 'completed')`,
      [PRIOR_PRACTICE_SESSION_ID, TEST_USER_ID],
    );

    // Prior answered item: shares skill "Nonlinear Functions" in domain
    // "Advanced Math", section "M" with diagnostic question SATM1DGB01X.
    // occurred_at is deliberately NULL to reproduce the prod bug.
    await testPg.query(
      `INSERT INTO public.practice_session_items
          (id, session_id, user_id, actor_id, ordinal,
           question_id, question_stem, question_options,
           question_correct_answer, question_explanation,
           question_option_metadata,
           question_domain, question_skill, question_difficulty,
           question_section, status, question_item_type,
           option_order, option_token_map,
           is_correct, selected_option_key, answered_at, occurred_at)
        VALUES ($1, $2, $3, $3, 1,
          $4, 'Prior practice Q',
          '[{"key":"A","text":"Option A"},{"key":"B","text":"Option B"},{"key":"C","text":"Option C"},{"key":"D","text":"Option D"}]'::jsonb,
          'B', 'Prior explanation',
          '{"A":{"role":"distractor","error_taxonomy":"common-misconception"},"B":{"role":"correct","error_taxonomy":null},"C":{"role":"distractor","error_taxonomy":"common-misconception"},"D":{"role":"distractor","error_taxonomy":"common-misconception"}}'::jsonb,
          'Advanced Math', 'Nonlinear Functions', 2, 'M',
          'answered', 'mcq',
          ARRAY['A','B','C','D']::text[],
          '{"opt_tok_A":"A","opt_tok_B":"B","opt_tok_C":"C","opt_tok_D":"D"}'::jsonb,
          false, 'A', '2026-07-22T12:00:00Z'::timestamptz, NULL)`,
      [
        PRIOR_PRACTICE_ITEM_ID,
        PRIOR_PRACTICE_SESSION_ID,
        TEST_USER_ID,
        questionId(1, 1), // SATM1DGB01X — shares entity with diagnostic domain 1
      ],
    );

    // ---------------------------------------------------------------
    // 7. Create diagnostic session (ACTIVE) + 40 served items
    // ---------------------------------------------------------------
    await testPg.query(
      `INSERT INTO public.practice_sessions
          (id, user_id, actor_id, mode, filters, target_count, platform, status)
        VALUES ($1, $2, $2, 'diagnostic',
          '{"target_question_count": 40}', 40, 'web', 'active')`,
      [TEST_SESSION_ID, TEST_USER_ID],
    );

    let ordinal = 0;
    for (let d = 0; d < 8; d++) {
      const [section, domain, skillCode] = CANONICAL_DOMAINS[d]!;
      for (let q = 1; q <= 5; q++) {
        ordinal++;
        const iid = itemUuid(ordinal);
        const qid = questionId(d, q);
        // PSI snapshot matches grounded real-question contract:
        // - question_options: [{key,text}] A–D (canonical 4-option set)
        // - question_correct_answer: 'B' (MCQ keyed answer)
        // - question_option_metadata: {"A":{"role":"distractor",...},"B":{"role":"correct",...},...}
        // - question_correct_variants: NULL (MCQ — NOT graded via correct_variants)
        // - option_order: text[] (randomized serve order — on PSI, not questions)
        // - option_token_map: jsonb token→key (on PSI, not questions)
        await testPg.query(
          `INSERT INTO public.practice_session_items
              (id, session_id, user_id, actor_id, ordinal,
               question_id, question_stem, question_options,
               question_correct_answer, question_explanation,
               question_option_metadata,
               question_domain, question_skill, question_difficulty,
               question_section, status, question_item_type,
               option_order, option_token_map)
            VALUES ($1, $2, $3, $3, $4,
              $5, $6,
              '[{"key":"A","text":"Option A"},{"key":"B","text":"Option B"},{"key":"C","text":"Option C"},{"key":"D","text":"Option D"}]'::jsonb,
              'B', $7,
              '{"A":{"role":"distractor","error_taxonomy":"common-misconception"},"B":{"role":"correct","error_taxonomy":null},"C":{"role":"distractor","error_taxonomy":"common-misconception"},"D":{"role":"distractor","error_taxonomy":"common-misconception"}}'::jsonb,
              $8, $9, $10, $11, 'served', 'mcq',
              ARRAY['A','B','C','D']::text[],
              '{"opt_tok_A":"A","opt_tok_B":"B","opt_tok_C":"C","opt_tok_D":"D"}'::jsonb)`,
          [
            iid,
            TEST_SESSION_ID,
            TEST_USER_ID,
            ordinal,
            qid,
            `Diagnostic ${domain} Q${q}`,
            `Explanation for ${domain} Q${q}`,
            domain,
            skillCode,
            DIFFICULTIES[q - 1],
            section,
          ],
        );
      }
    }

    // ---------------------------------------------------------------
    // 8. Clear config cache + start Express app
    // ---------------------------------------------------------------
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";

    const authModule = await import("../../server/middleware/supabase-auth");
    vi.spyOn(authModule, "supabaseAuthMiddleware").mockImplementation(
      (req: Request, _res: Response, next: NextFunction) => {
        (req as Record<string, unknown>).user = {
          id: TEST_USER_ID,
          email: "handler-pg-ci@example.com",
          role: "student",
          isAdmin: false,
          isGuardian: false,
          display_name: "Test Student",
        };
        next();
      },
    );
    vi.spyOn(authModule, "requireSupabaseAuth").mockImplementation(
      (req: Request, res: Response, next: NextFunction) => {
        if (!(req as Record<string, unknown>).user) {
          return res.status(401).json({ error: "auth_required" });
        }
        next();
      },
    );
    vi.spyOn(authModule, "requireStudentOrAdmin").mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next(),
    );
    vi.spyOn(authModule, "requireProfileComplete").mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next(),
    );
    vi.spyOn(authModule, "requireConsentCompliance").mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next(),
    );

    const serverModule = await import("../../server/index");
    app = serverModule.default;
  }, 120_000); // Migration application can be slow

  afterAll(async () => {
    await testPg?.end();
    testPg = null;
    if (adminPg) {
      await adminPg.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
      await adminPg.end();
    }
    delete process.env.VITEST;
    vi.restoreAllMocks();
  });

  it("submits 40 diagnostic answers through the handler and produces real PG audit trail", async () => {
    // Submit all 40 answers sequentially through the HTTP handler.
    // Each answer goes through submitPracticeAnswer → applyMasteryEvent → real PG.
    for (let i = 1; i <= 40; i++) {
      const domainIdx = Math.floor((i - 1) / 5);
      const qIdx = ((i - 1) % 5) + 1;
      const qid = questionId(domainIdx, qIdx);

      const res = await request(app).post("/api/practice/answer").send({
        sessionId: TEST_SESSION_ID,
        questionId: qid,
        selectedAnswer: "opt_tok_B",
      });

      // Every answer must succeed — mastery emission must not fail
      expect(
        res.status,
        `answer ${i} (${qid}) failed: ${JSON.stringify(res.body)}`,
      ).toBe(200);

      // Last answer should report session completed
      if (i === 40) {
        expect(res.body.state).toBe("completed");
      }
    }

    // ---------------------------------------------------------------
    // A. Assert: exactly 40 diagnostic_attempt audit rows (session-scoped)
    // ---------------------------------------------------------------
    const auditResult = await testPg!.query(
      `SELECT count(*)::integer AS cnt
         FROM public.mastery_event_audit_log mal
         JOIN public.practice_session_items psi ON psi.id = mal.event_id
         WHERE psi.session_id = $1
           AND mal.event_source_kind = 'diagnostic_attempt'`,
      [TEST_SESSION_ID],
    );
    expect(auditResult.rows[0]!.cnt).toBe(40);

    // ---------------------------------------------------------------
    // B. Assert: student_skill_mastery has rows
    // ---------------------------------------------------------------
    const masteryResult = await testPg!.query(
      `SELECT count(*)::integer AS cnt
         FROM public.student_skill_mastery
         WHERE student_id = $1`,
      [TEST_USER_ID],
    );
    expect(masteryResult.rows[0]!.cnt).toBeGreaterThan(0);

    // ---------------------------------------------------------------
    // C. Assert: student_domain_mastery covers all 8 domains
    // ---------------------------------------------------------------
    const domainResult = await testPg!.query(
      `SELECT count(*)::integer AS cnt
         FROM public.student_domain_mastery
         WHERE student_id = $1
           AND event_count_total >= 5`,
      [TEST_USER_ID],
    );
    expect(domainResult.rows[0]!.cnt).toBe(8);

    // ---------------------------------------------------------------
    // D. Assert: student_section_projections non-NULL for M and RW
    // ---------------------------------------------------------------
    const projMResult = await testPg!.query(
      `SELECT projected_score_mid
         FROM public.student_section_projections
         WHERE student_id = $1 AND section = 'M'`,
      [TEST_USER_ID],
    );
    expect(projMResult.rows.length).toBe(1);
    expect(projMResult.rows[0]!.projected_score_mid).not.toBeNull();

    const projRWResult = await testPg!.query(
      `SELECT projected_score_mid
         FROM public.student_section_projections
         WHERE student_id = $1 AND section = 'RW'`,
      [TEST_USER_ID],
    );
    expect(projRWResult.rows.length).toBe(1);
    expect(projRWResult.rows[0]!.projected_score_mid).not.toBeNull();

    // ---------------------------------------------------------------
    // E. Assert: session status = 'completed' in PG
    // ---------------------------------------------------------------
    const sessionResult = await testPg!.query(
      `SELECT status, completed_at
         FROM public.practice_sessions
         WHERE id = $1`,
      [TEST_SESSION_ID],
    );
    expect(sessionResult.rows[0]!.status).toBe("completed");
    expect(sessionResult.rows[0]!.completed_at).not.toBeNull();
  }, 120_000);

  it("replay same 40 answers → no duplicate audit rows (idempotency)", async () => {
    // Replay: submit the same 40 answers again with clientAttemptId.
    // All should succeed (idempotent) and no new audit rows should appear.
    for (let i = 1; i <= 40; i++) {
      const domainIdx = Math.floor((i - 1) / 5);
      const qIdx = ((i - 1) % 5) + 1;
      const qid = questionId(domainIdx, qIdx);

      const res = await request(app).post("/api/practice/answer").send({
        sessionId: TEST_SESSION_ID,
        questionId: qid,
        selectedAnswer: "opt_tok_B",
      });

      // Replay paths return 200 (idempotent) or 409 (item already resolved)
      // — both are acceptable for replay proof. What matters is: no new audit rows.
      expect(
        [200, 409].includes(res.status),
        `replay ${i} (${qid}) unexpected status ${res.status}: ${JSON.stringify(res.body)}`,
      ).toBe(true);
    }

    // Still exactly 40 audit rows — no duplicates
    const auditResult = await testPg!.query(
      `SELECT count(*)::integer AS cnt
         FROM public.mastery_event_audit_log mal
         JOIN public.practice_session_items psi ON psi.id = mal.event_id
         WHERE psi.session_id = $1
           AND mal.event_source_kind = 'diagnostic_attempt'`,
      [TEST_SESSION_ID],
    );
    expect(auditResult.rows[0]!.cnt).toBe(40);
  }, 120_000);

  // -------------------------------------------------------------------
  // F. Assert: diagnostic completion captures exactly one diagnostic_baseline
  //    snapshot per section (M + RW), values match the live projection at
  //    completion time.
  // @spec [Doc-05C §7.4, Vertical-B Slice 2]
  // @implemented 2026-08-12
  // -------------------------------------------------------------------
  it("diagnostic completion writes exactly one diagnostic_baseline per section, values match live projection", async () => {
    const baselineResult = await testPg!.query(
      `SELECT student_id, section, snapshot_kind,
              projected_score_mid, projected_score_low, projected_score_high
         FROM public.student_section_projection_snapshots
         WHERE student_id = $1
           AND snapshot_kind = 'diagnostic_baseline'
         ORDER BY section`,
      [TEST_USER_ID],
    );

    // Exactly 2 baseline rows: one for M, one for RW.
    expect(baselineResult.rows.length).toBe(2);

    const sections = baselineResult.rows.map(
      (r: Record<string, unknown>) => r.section,
    );
    expect(sections).toContain("M");
    expect(sections).toContain("RW");

    // Each baseline has a non-NULL projected_score_mid (evidence gate passed).
    for (const row of baselineResult.rows) {
      expect(row.projected_score_mid).not.toBeNull();
      expect(row.snapshot_kind).toBe("diagnostic_baseline");
    }

    // FIX B (Codex REVISE): assert captured baseline values EQUAL the live
    // projection in student_section_projections at completion time.
    const liveResult = await testPg!.query(
      `SELECT section, projected_score_mid, projected_score_low, projected_score_high
         FROM public.student_section_projections
         WHERE student_id = $1
         ORDER BY section`,
      [TEST_USER_ID],
    );
    expect(liveResult.rows.length).toBe(2);

    for (const baseline of baselineResult.rows) {
      const live = liveResult.rows.find(
        (r: Record<string, unknown>) => r.section === baseline.section,
      );
      expect(
        live,
        `live projection missing for section ${baseline.section}`,
      ).toBeDefined();
      expect(baseline.projected_score_mid).toEqual(live!.projected_score_mid);
      expect(baseline.projected_score_low).toEqual(live!.projected_score_low);
      expect(baseline.projected_score_high).toEqual(live!.projected_score_high);
    }
  }, 30_000);

  // -------------------------------------------------------------------
  // G. Assert: second diagnostic baseline capture through the PRODUCTION
  //    code path (.insert() + catch-23505) is a harmless no-op — original
  //    baseline values preserved (immutability proof).
  //
  //    This test calls the exported captureDiagnosticBaseline function
  //    directly — the same code the handler calls on diagnostic completion.
  //    The function reads live projections, attempts a plain INSERT (no
  //    ON CONFLICT), and catches error code 23505 from the partial unique
  //    index as an idempotent no-op. If the catch-23505 were removed,
  //    the function would log "baseline insert failed" instead of
  //    "baseline already captured" — the spied logger assertion below
  //    detects that regression.
  // @spec [Doc-05C §7.4, Vertical-B Slice 2]
  // @implemented 2026-08-13
  // -------------------------------------------------------------------
  it("second baseline capture via production path is blocked — original preserved (immutability)", async () => {
    // Capture original baseline values.
    const originalResult = await testPg!.query(
      `SELECT snapshot_id, section, projected_score_mid, projected_score_low, projected_score_high, snapshot_at
         FROM public.student_section_projection_snapshots
         WHERE student_id = $1
           AND snapshot_kind = 'diagnostic_baseline'
         ORDER BY section`,
      [TEST_USER_ID],
    );
    expect(originalResult.rows.length).toBe(2);
    const originalM = originalResult.rows.find(
      (r: Record<string, unknown>) => r.section === "M",
    );
    const originalRW = originalResult.rows.find(
      (r: Record<string, unknown>) => r.section === "RW",
    );
    expect(originalM).toBeDefined();
    expect(originalRW).toBeDefined();

    // Spy on logger to verify the 23505 idempotent path is taken.
    const { logger } = await import("../../server/logger");
    const infoSpy = vi.spyOn(logger, "info");

    // Call the PRODUCTION baseline-capture function a second time.
    // This exercises: supabaseServer.from(...).insert(rows) → PG raises
    // 23505 from the partial unique index → production catches it as a no-op.
    const { captureDiagnosticBaseline } =
      await import("../../server/routes/practice-canonical");
    await captureDiagnosticBaseline(TEST_USER_ID, "req-immutability-proof");

    // The production catch-23505 path logs "baseline already captured".
    // If the 23505 catch were removed, the fallback logs "baseline insert
    // failed" — this assertion would fail, detecting the regression.
    const capturedCall = infoSpy.mock.calls.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("baseline already captured"),
    );
    expect(
      capturedCall,
      'Expected logger.info("[diagnostic] baseline already captured ...") — ' +
        "the production catch-23505 path must be exercised",
    ).toBeDefined();

    infoSpy.mockRestore();

    // Verify original values are preserved (not overwritten).
    const afterResult = await testPg!.query(
      `SELECT snapshot_id, section, projected_score_mid, projected_score_low, projected_score_high, snapshot_at
         FROM public.student_section_projection_snapshots
         WHERE student_id = $1
           AND snapshot_kind = 'diagnostic_baseline'
         ORDER BY section`,
      [TEST_USER_ID],
    );
    expect(afterResult.rows.length).toBe(2);

    const afterM = afterResult.rows.find(
      (r: Record<string, unknown>) => r.section === "M",
    );
    const afterRW = afterResult.rows.find(
      (r: Record<string, unknown>) => r.section === "RW",
    );

    // snapshot_id unchanged (same row, not replaced).
    expect(afterM!.snapshot_id).toEqual(originalM!.snapshot_id);
    expect(afterRW!.snapshot_id).toEqual(originalRW!.snapshot_id);
    // Scores unchanged (original preserved).
    expect(afterM!.projected_score_mid).toEqual(originalM!.projected_score_mid);
    expect(afterM!.projected_score_low).toEqual(originalM!.projected_score_low);
    expect(afterM!.projected_score_high).toEqual(
      originalM!.projected_score_high,
    );
    expect(afterRW!.projected_score_mid).toEqual(
      originalRW!.projected_score_mid,
    );
    expect(afterRW!.projected_score_low).toEqual(
      originalRW!.projected_score_low,
    );
    expect(afterRW!.projected_score_high).toEqual(
      originalRW!.projected_score_high,
    );
  }, 30_000);

  // -------------------------------------------------------------------
  // H. Assert: regular practice completion writes NO diagnostic_baseline.
  //    The mode gate (session.mode === 'diagnostic') is correct in code;
  //    this proves it against real Postgres.
  // @spec [Doc-05C §7.4, Vertical-B Slice 2]
  // @implemented 2026-08-12
  // -------------------------------------------------------------------
  it("regular practice session writes no diagnostic_baseline snapshot", async () => {
    const REGULAR_USER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const REGULAR_SESSION_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

    // Create a regular (non-diagnostic) user + session + 5 items
    await testPg!.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, 'regular-pg-ci@example.com')`,
      [REGULAR_USER_ID],
    );

    await testPg!.query(
      `INSERT INTO public.practice_sessions
          (id, user_id, actor_id, mode, filters, target_count, platform, status)
        VALUES ($1, $2, $2, 'flow',
          '{"target_question_count": 5}', 5, 'web', 'active')`,
      [REGULAR_SESSION_ID, REGULAR_USER_ID],
    );

    // Serve 5 items (reuse first domain's questions)
    for (let q = 1; q <= 5; q++) {
      const qid = questionId(0, q);
      const iid = `ffffffff-ffff-ffff-ffff-ffffffff${String(q).padStart(4, "0")}`;
      await testPg!.query(
        `INSERT INTO public.practice_session_items
            (id, session_id, user_id, actor_id, ordinal,
             question_id, question_stem, question_options,
             question_correct_answer, question_explanation,
             question_option_metadata,
             question_domain, question_skill, question_difficulty,
             question_section, status, question_item_type,
             option_order, option_token_map)
          VALUES ($1, $2, $3, $3, $4,
            $5, $6,
            '[{"key":"A","text":"Option A"},{"key":"B","text":"Option B"},{"key":"C","text":"Option C"},{"key":"D","text":"Option D"}]'::jsonb,
            'B', $7,
            '{"A":{"role":"distractor","error_taxonomy":"common-misconception"},"B":{"role":"correct","error_taxonomy":null},"C":{"role":"distractor","error_taxonomy":"common-misconception"},"D":{"role":"distractor","error_taxonomy":"common-misconception"}}'::jsonb,
            $8, $9, $10, $11, 'served', 'mcq',
            ARRAY['A','B','C','D']::text[],
            '{"opt_tok_A":"A","opt_tok_B":"B","opt_tok_C":"C","opt_tok_D":"D"}'::jsonb)`,
        [
          iid,
          REGULAR_SESSION_ID,
          REGULAR_USER_ID,
          q,
          qid,
          `Regular Algebra Q${q}`,
          `Explanation for Algebra Q${q}`,
          "Algebra",
          "ALG.D01",
          DIFFICULTIES[q - 1],
          "M",
        ],
      );
    }

    // Submit all 5 answers (completing the session)
    // Mock auth to use the regular user for these requests
    const authModule = await import("../../server/middleware/supabase-auth");
    vi.spyOn(authModule, "supabaseAuthMiddleware").mockImplementation(
      (req: Request, _res: Response, next: NextFunction) => {
        (req as Record<string, unknown>).user = {
          id: REGULAR_USER_ID,
          email: "regular-pg-ci@example.com",
          role: "student",
          isAdmin: false,
          isGuardian: false,
          display_name: "Regular Student",
        };
        next();
      },
    );

    for (let q = 1; q <= 5; q++) {
      const qid = questionId(0, q);
      const res = await request(app).post("/api/practice/answer").send({
        sessionId: REGULAR_SESSION_ID,
        questionId: qid,
        selectedAnswer: "opt_tok_B",
      });
      expect(
        res.status,
        `regular answer ${q} (${qid}) failed: ${JSON.stringify(res.body)}`,
      ).toBe(200);
    }

    // Assert: NO diagnostic_baseline snapshot for the regular user.
    const baselineResult = await testPg!.query(
      `SELECT count(*)::integer AS cnt
         FROM public.student_section_projection_snapshots
         WHERE student_id = $1
           AND snapshot_kind = 'diagnostic_baseline'`,
      [REGULAR_USER_ID],
    );
    expect(baselineResult.rows[0]!.cnt).toBe(0);

    // Restore auth mock to diagnostic user for any subsequent tests.
    vi.spyOn(authModule, "supabaseAuthMiddleware").mockImplementation(
      (req: Request, _res: Response, next: NextFunction) => {
        (req as Record<string, unknown>).user = {
          id: TEST_USER_ID,
          email: "handler-pg-ci@example.com",
          role: "student",
          isAdmin: false,
          isGuardian: false,
          display_name: "Test Student",
        };
        next();
      },
    );
  }, 120_000);
});
