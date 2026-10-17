/**
 * Diagnostic handler → real PostgreSQL LOGIC proof (NOT an end-to-end proof)
 *
 * @spec [Doc-05A §11, Codex re-audit Fix C] | @implemented [2026-08-08]
 * @rescoped [2026-08-16] Claim narrowed to what this test actually covers.
 *
 * SCOPE AND LIMITS — read before trusting a green run.
 * This suite vi.mocks BOTH Supabase clients (see the createPgBackedSupabase
 * adapter below) and substitutes a node-pg client running as the `postgres`
 * SUPERUSER. It therefore proves the handler's LOGIC against the real schema and
 * the real SQL functions, and nothing about:
 *   - PostgREST (the transport prod actually uses)
 *   - the service_role identity or any GRANT
 *   - the supabase-js query builder
 * It also runs on a FRESH database, so it cannot reproduce a data-state failure
 * such as a legacy NULL occurred_at row poisoning refresh_overall_kpi student-wide.
 * A green run here was compatible with a 100%-failure production outage for seven
 * weeks. tests/ci/mastery-emission.transport.ci.test.ts covers what this cannot.
 *
 * What it DOES prove, which is genuinely useful and fast:
 *   1. Applies all migrations to an ephemeral PG16 database
 *   2. Seeds 40 diagnostic questions (8 domains × 5)
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

const CANONICAL_DOMAINS: [string, string, string, string][] = [
  ["M", "Algebra", "ALG.D01", "DGA"],
  ["M", "Advanced Math", "ADV.D01", "DGB"],
  ["M", "Problem Solving and Data Analysis", "PSD.D01", "DGC"],
  ["M", "Geometry and Trigonometry", "GEO.D01", "DGD"],
  ["RW", "Information and Ideas", "INI.D01", "DGE"],
  ["RW", "Craft and Structure", "CAS.D01", "DGF"],
  ["RW", "Expression of Ideas", "EOI.D01", "DGG"],
  ["RW", "Standard English Conventions", "SEC.D01", "DGH"],
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
      // .limit(n) already emits LIMIT; append one only when the chain set none (a second LIMIT
      // is a syntax error the real PostgREST builder never produces).
      const sql = `SELECT * FROM public."${this.table}"${whereSql}${this.buildOrderLimit()}${this.limitN === null ? " LIMIT 1" : ""}`;
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
        const row = result.rows[0] ?? null;
        // PostgREST returns a SCALAR function's value itself (e.g. the jsonb of
        // complete_diagnostic_session), not a one-column row named after the function.
        if (row && Object.keys(row).length === 1 && fnName in row) {
          return { data: row[fnName], error: null };
        }
        return { data: row, error: null };
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
    // 4b. Raise rate-limit ceiling so the suite's rapid answers don't 429 (six diagnostics of
    //     40 answers plus replays run inside one limiter window)
    // ---------------------------------------------------------------
    await testPg.query(
      `UPDATE public.practice_runtime_config
         SET value = '5000'
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
    vi.spyOn(authModule, "requireGuardianLinkForUnder13").mockImplementation(
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

  // ===================================================================
  // SCL-236 — the stored diagnostic projection and the ONE completion path
  // @spec [SCL-236 (Doc 05C §12A, §12); owner rulings 2026-10-16 and 2026-10-17 (constraints 2-4)]
  // @implemented 2026-10-17
  //
  // Every completion path below — the 40th answer, a skip on the last question, next-question
  // with nothing left, a replay of the final answer, two concurrent final answers — must leave
  // exactly two write-once rows in student_diagnostic_projections, computed from that session's
  // answers, with completed_at stamped once.
  // ===================================================================

  type StoredRow = {
    section: string;
    status: string;
    projected_score_mid: number | null;
    projected_score_low: number | null;
    projected_score_high: number | null;
    computed_at: Date;
  };

  async function storedRows(sessionId: string): Promise<StoredRow[]> {
    const r = await testPg!.query(
      `SELECT section, status, projected_score_mid, projected_score_low,
              projected_score_high, computed_at
         FROM public.student_diagnostic_projections
        WHERE practice_session_id = $1
        ORDER BY section`,
      [sessionId],
    );
    return r.rows as StoredRow[];
  }

  async function sessionRow(
    sessionId: string,
  ): Promise<{ status: string; completed_at: Date | null }> {
    const r = await testPg!.query(
      `SELECT status, completed_at FROM public.practice_sessions WHERE id = $1`,
      [sessionId],
    );
    return r.rows[0] as { status: string; completed_at: Date | null };
  }

  async function actAs(userId: string): Promise<void> {
    const authModule = await import("../../server/middleware/supabase-auth");
    vi.spyOn(authModule, "supabaseAuthMiddleware").mockImplementation(
      (req: Request, _res: Response, next: NextFunction) => {
        (req as Record<string, unknown>).user = {
          id: userId,
          email: `${userId}@example.com`,
          role: "student",
          isAdmin: false,
          isGuardian: false,
          display_name: "Path Student",
        };
        next();
      },
    );
  }

  /** A fresh student with an ACTIVE 40-item diagnostic, every item served. */
  async function seedDiagnostic(tag: number): Promise<{
    userId: string;
    sessionId: string;
    itemId: (ordinal: number) => string;
  }> {
    const hex = tag.toString(16).padStart(2, "0");
    const userId = `a1a1a1a1-0000-4000-8000-0000000000${hex}`;
    const sessionId = `b1b1b1b1-0000-4000-8000-0000000000${hex}`;
    const itemId = (ordinal: number): string =>
      `c1c1c1c1-00${hex}-4000-8000-${ordinal.toString(16).padStart(12, "0")}`;
    await testPg!.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
      userId,
      `${userId}@example.com`,
    ]);
    await testPg!.query(
      `INSERT INTO public.practice_sessions
          (id, user_id, actor_id, mode, filters, target_count, platform, status)
        VALUES ($1, $2, $2, 'diagnostic',
          '{"target_question_count": 40, "prebuilt": true}', 40, 'web', 'active')`,
      [sessionId, userId],
    );
    let ordinal = 0;
    for (let d = 0; d < 8; d++) {
      const [section, domain, skillCode] = CANONICAL_DOMAINS[d]!;
      for (let q = 1; q <= 5; q++) {
        ordinal++;
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
            itemId(ordinal),
            sessionId,
            userId,
            ordinal,
            questionId(d, q),
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
    return { userId, sessionId, itemId };
  }

  /** Answer items 1..n through the handler; correct on odd ordinals (a real spread). */
  async function answerThrough(
    sessionId: string,
    n: number,
  ): Promise<request.Response[]> {
    const out: request.Response[] = [];
    for (let i = 1; i <= n; i++) {
      const res = await request(app)
        .post("/api/practice/answer")
        .send({
          sessionId,
          questionId: questionId(Math.floor((i - 1) / 5), ((i - 1) % 5) + 1),
          selectedAnswer: i % 2 === 1 ? "opt_tok_B" : "opt_tok_A",
        });
      expect(res.status, `answer ${i}: ${JSON.stringify(res.body)}`).toBe(200);
      out.push(res);
    }
    return out;
  }

  it("40th answer: stores exactly two computed diagnostic projection rows; for a fresh student they equal the live projection refreshed at completion", async () => {
    const rows = await storedRows(TEST_SESSION_ID);
    expect(rows.map((r) => [r.section, r.status])).toEqual([
      ["M", "computed"],
      ["RW", "computed"],
    ]);
    const live = await testPg!.query(
      `SELECT section, projected_score_mid, projected_score_low, projected_score_high
         FROM public.student_section_projections WHERE student_id = $1 ORDER BY section`,
      [TEST_USER_ID],
    );
    for (const row of rows) {
      const l = live.rows.find(
        (x: Record<string, unknown>) => x.section === row.section,
      );
      expect(row.projected_score_mid).not.toBeNull();
      expect([
        row.projected_score_mid,
        row.projected_score_low,
        row.projected_score_high,
      ]).toEqual([
        l!.projected_score_mid,
        l!.projected_score_low,
        l!.projected_score_high,
      ]);
    }
    // Nothing writes the retired snapshot kind any more.
    const old = await testPg!.query(
      `SELECT count(*)::int AS n FROM public.student_section_projection_snapshots
        WHERE student_id = $1 AND snapshot_kind = 'diagnostic_baseline'`,
      [TEST_USER_ID],
    );
    expect(old.rows[0]!.n).toBe(0);
    expect(
      (
        await testPg!.query(`SELECT public.student_diagnostic_state($1) AS s`, [
          TEST_USER_ID,
        ])
      ).rows[0]!.s,
    ).toBe("baseline_ready");
  }, 30_000);

  it("replaying the final answer stores nothing new, changes no value, and keeps completed_at", async () => {
    const before = await storedRows(TEST_SESSION_ID);
    const sessBefore = await sessionRow(TEST_SESSION_ID);
    const res = await request(app)
      .post("/api/practice/answer")
      .send({
        sessionId: TEST_SESSION_ID,
        questionId: questionId(7, 5),
        selectedAnswer: "opt_tok_B",
      });
    expect([200, 409]).toContain(res.status);
    expect(await storedRows(TEST_SESSION_ID)).toEqual(before);
    expect((await sessionRow(TEST_SESSION_ID)).completed_at).toEqual(
      sessBefore.completed_at,
    );
  }, 30_000);

  it("THE FAILURE THIS FIXES: mastery emission broken, live projection empty — the 40th answer still stores the diagnostic projection", async () => {
    const { userId, sessionId } = await seedDiagnostic(1);
    await actAs(userId);
    // Every apply_mastery_event call now fails, exactly like the mastery outage: the answers are
    // recorded, no mastery is written, the live projection can never clear its gate.
    await testPg!.query(
      `ALTER FUNCTION public.apply_mastery_event(uuid, text, text, text, smallint, text, text, boolean, timestamptz, uuid, text, text) RENAME TO apply_mastery_event_disabled`,
    );
    try {
      const responses = await answerThrough(sessionId, 40);
      expect(responses[39]!.body.state).toBe("completed");
    } finally {
      await testPg!.query(
        `ALTER FUNCTION public.apply_mastery_event_disabled(uuid, text, text, text, smallint, text, text, boolean, timestamptz, uuid, text, text) RENAME TO apply_mastery_event`,
      );
    }
    const live = await testPg!.query(
      `SELECT count(*)::int AS n FROM public.student_section_projections
        WHERE student_id = $1 AND projected_score_mid IS NOT NULL`,
      [userId],
    );
    expect(live.rows[0]!.n).toBe(0);
    const rows = await storedRows(sessionId);
    expect(rows.map((r) => r.status)).toEqual(["computed", "computed"]);
    expect(rows.every((r) => r.projected_score_mid !== null)).toBe(true);
  }, 120_000);

  it("skip on the last question completes the diagnostic through the same path and stores its projection (insufficient_evidence: that domain has 4 answers)", async () => {
    const { userId, sessionId, itemId } = await seedDiagnostic(2);
    await actAs(userId);
    await answerThrough(sessionId, 39);
    const res = await request(app)
      .post(`/api/practice/sessions/${sessionId}/skip`)
      .send({ sessionItemId: itemId(40) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.state).toBe("completed");
    expect((await sessionRow(sessionId)).status).toBe("completed");
    const rows = await storedRows(sessionId);
    expect(rows.map((r) => [r.section, r.status])).toEqual([
      ["M", "insufficient_evidence"],
      ["RW", "insufficient_evidence"],
    ]);
    expect(rows.every((r) => r.projected_score_mid === null)).toBe(true);
  }, 120_000);

  it("next-question with nothing left completes the diagnostic and stores its projection", async () => {
    const { userId, sessionId } = await seedDiagnostic(3);
    await actAs(userId);
    // Every item resolved, the session still active: the shape a lost final-answer response
    // leaves behind. Asking for the next question is what completes it.
    await testPg!.query(
      `UPDATE public.practice_session_items
          SET status = 'answered', selected_answer = 'B', is_correct = (ordinal % 2 = 1),
              outcome = CASE WHEN ordinal % 2 = 1 THEN 'correct' ELSE 'incorrect' END,
              answered_at = now() - make_interval(mins => 40 - ordinal),
              occurred_at = now() - make_interval(mins => 40 - ordinal)
        WHERE session_id = $1`,
      [sessionId],
    );
    const res = await request(app).get(
      `/api/practice/sessions/${sessionId}/next?client_instance_id=path-test`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("session_closed");
    expect((await sessionRow(sessionId)).status).toBe("completed");
    const rows = await storedRows(sessionId);
    expect(rows.map((r) => r.status)).toEqual(["computed", "computed"]);
  }, 120_000);

  it("replay of the final answer after a lost completion completes the diagnostic and stores its projection", async () => {
    const { userId, sessionId, itemId } = await seedDiagnostic(4);
    await actAs(userId);
    await answerThrough(sessionId, 39);
    // The first request for item 40 committed the answer and then died before completing the
    // session (the Codex Fix A case). The client retries with the same attempt id.
    await testPg!.query(
      `UPDATE public.practice_session_items
          SET status = 'answered', selected_answer = 'B', is_correct = false, outcome = 'incorrect',
              answered_at = now(), occurred_at = now(), client_attempt_id = 'attempt-40'
        WHERE id = $1`,
      [itemId(40)],
    );
    const res = await request(app)
      .post("/api/practice/answer")
      .send({
        sessionId,
        questionId: questionId(7, 5),
        selectedAnswer: "opt_tok_A",
        clientAttemptId: "attempt-40",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.state).toBe("completed");
    expect(res.body.idempotentRetried).toBe(true);
    const rows = await storedRows(sessionId);
    expect(rows.map((r) => r.status)).toEqual(["computed", "computed"]);
  }, 120_000);

  it("two concurrent final answers: one completion, two rows, one completed_at", async () => {
    const { userId, sessionId } = await seedDiagnostic(5);
    await actAs(userId);
    await answerThrough(sessionId, 39);
    const final = {
      sessionId,
      questionId: questionId(7, 5),
      selectedAnswer: "opt_tok_B",
    };
    const [a, b] = await Promise.all([
      request(app).post("/api/practice/answer").send(final),
      request(app).post("/api/practice/answer").send(final),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);
    expect((await sessionRow(sessionId)).status).toBe("completed");
    const rows = await storedRows(sessionId);
    expect(rows).toHaveLength(2);
    const firstCompletedAt = (await sessionRow(sessionId)).completed_at;
    // A third call after the race changes nothing.
    await request(app).post("/api/practice/answer").send(final);
    expect(await storedRows(sessionId)).toEqual(rows);
    expect((await sessionRow(sessionId)).completed_at).toEqual(
      firstCompletedAt,
    );
  }, 120_000);

  it("terminate on a completed diagnostic is refused and leaves it completed", async () => {
    const userId = "a1a1a1a1-0000-4000-8000-000000000001";
    const sessionId = "b1b1b1b1-0000-4000-8000-000000000001";
    await actAs(userId);
    const before = await sessionRow(sessionId);
    const res = await request(app)
      .post(`/api/practice/sessions/${sessionId}/terminate`)
      .send({});
    expect(res.status).toBe(409);
    expect(await sessionRow(sessionId)).toEqual(before);
  }, 30_000);

  it("a regular practice session completes normally and stores no diagnostic projection", async () => {
    const REGULAR_USER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const REGULAR_SESSION_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
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
    for (let q = 1; q <= 5; q++) {
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
          questionId(0, q),
          `Regular Algebra Q${q}`,
          `Explanation for Algebra Q${q}`,
          "Algebra",
          "ALG.D01",
          DIFFICULTIES[q - 1],
          "M",
        ],
      );
    }
    await actAs(REGULAR_USER_ID);
    for (let q = 1; q <= 5; q++) {
      const res = await request(app)
        .post("/api/practice/answer")
        .send({
          sessionId: REGULAR_SESSION_ID,
          questionId: questionId(0, q),
          selectedAnswer: "opt_tok_B",
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      if (q === 5) expect(res.body.state).toBe("completed");
    }
    expect((await sessionRow(REGULAR_SESSION_ID)).status).toBe("completed");
    const n = await testPg!.query(
      `SELECT count(*)::int AS n FROM public.student_diagnostic_projections WHERE student_id = $1`,
      [REGULAR_USER_ID],
    );
    expect(n.rows[0]!.n).toBe(0);
  }, 120_000);
});
