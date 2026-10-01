/**
 * PG-backed Supabase client harness — shared test helper.
 *
 * @spec [Doc-01_V8, §35/§36/§37; Doc-01A_V1.0, §39–§47] | @implemented [2026-08-25]
 *
 * plain English: gives a test a `supabaseServer`-shaped object whose queries run
 * against a REAL PostgreSQL database with the real migrations applied, instead of
 * against hand-written row fixtures. What it does: translates the subset of the
 * Supabase query-builder chain this repo actually uses into SQL. Expected outcome:
 * a route test exercises the real domain module and the real schema, so a column
 * that does not exist fails the test rather than passing against an invented shape.
 * Trade-off: it implements a SUBSET of PostgREST semantics, so it proves schema and
 * SQL behaviour, not PostgREST wire behaviour. Edge case: `.single()` on zero rows
 * returns PostgREST's `PGRST116`, because callers branch on that code.
 *
 * WHY THIS FILE EXISTS. Two independent copies of this shim already existed —
 * `tests/ci/entitlement-write-path.ci.test.ts` and `tests/ci/diagnostic.handler-pg.ci.test.ts` —
 * with no shared helper. Writing a third copy for WS-GL would be the divergence
 * CLAUDE.md forbids by name. This is the extraction; the two existing copies are
 * reported as consolidation candidates, not edited, because they belong to other
 * surfaces (Charter §4 / WS-GL §0 substitution).
 *
 * This substitutes the DATABASE TRANSPORT, never the module under test. A test that
 * mocks `server/lib/account` is disqualified by construction; a test that runs
 * `server/lib/account` against real SQL through this harness is the correction.
 */

import { Client, types as pgTypes } from "pg";
import fs from "node:fs";
import path from "node:path";

/**
 * DATES AND TIMESTAMPS COME BACK AS STRINGS through this shim, because that is what the real
 * transport sends.
 *
 * PostgREST serialises rows to JSON, where a `Date` cannot exist: `timestamptz` arrives as
 * an ISO string and `date` as `YYYY-MM-DD`. node-pg parses all three into `Date` objects,
 * so a shared schema that production satisfies — `setup_completed_at: z.string().nullable()`
 * on `studyProfileSchema`, `localDateSchema` on `target_exam_date` — fails against this
 * harness for a reason that exists nowhere but in this harness. That is the fixture
 * disagreeing with real output, in the shape CLAUDE.md names: the harness has to produce
 * what the wire produces, or a route test through it proves something about node-pg.
 *
 * SCOPED TO THE SHIM'S OWN QUERIES, NOT SET GLOBALLY. A test's direct `pg.query` is node-pg
 * and is read as node-pg — several suites assert `toBeInstanceOf(Date)` on a stamp they read
 * that way, correctly, because nothing in production sees those rows. Setting the parsers on
 * the `pg` module turned seven of those red for no defect at all. Per-query `types` keeps the
 * substitution where it belongs: the transport this shim is pretending to be.
 *
 * NOTHING ROUND-TRIPS THROUGH `Date`. Every parser below rewrites the RAW TEXT, for two
 * reasons. PostgREST emits `2026-09-29T06:44:10.442123+00:00` — a numeric offset, and
 * microseconds — while `new Date(v).toISOString()` emits `…442Z`: it truncates to
 * milliseconds and substitutes `Z`, so a schema written as `z.string().datetime()` (no
 * `{offset: true}`) would pass here and fail in production, which is the inverse of what
 * this whole block is for. And `timestamptz 'infinity'` makes `toISOString()` throw
 * `RangeError` — inside a try block, so it would surface as a query failure rather than as
 * itself. Rewriting the text has neither problem.
 *
 * `date` is returned verbatim rather than via `Date` for the same family of reason: node-pg
 * builds a `Date` at LOCAL midnight, so a conversion moves the day in any zone west of UTC.
 * The raw text is already exactly `YYYY-MM-DD`.
 *
 * THE LIMITS, STATED RATHER THAN LEFT TO BE FOUND. This covers the three scalar types the
 * calendar surface reads. It does NOT cover the array forms (`date[]` 1082→1182,
 * `timestamptz[]` 1185), which still arrive as node-pg `Date` objects inside an array; and
 * it does not touch `numeric`/`int8`, which node-pg hands back as STRINGS where PostgREST
 * sends JSON numbers — a pre-existing disagreement in the opposite direction, left alone
 * because narrowing it is a change to every suite that reads a count. A test that parses an
 * array of timestamps, or a `numeric`, through a shared schema will meet those; the fix is
 * to extend this block, not to loosen the schema.
 */

/** `2026-09-29 06:44:10.442123+00` -> `2026-09-29T06:44:10.442123+00:00`, PostgREST's form. */
function wireTimestamptz(value: string): string {
  const withT = value.replace(" ", "T");
  // `infinity` / `-infinity` have no offset to normalise, and PostgREST passes them through.
  const offset = /([+-])(\d{2})(?::?(\d{2}))?$/.exec(withT);
  if (offset === null) return withT;
  return (
    withT.slice(0, offset.index) +
    `${offset[1]}${offset[2]}:${offset[3] ?? "00"}`
  );
}

const WIRE_TYPES = {
  getTypeParser: (
    oid: number,
    format?: unknown,
  ): ((value: string) => unknown) => {
    if (oid === 1082) return (value: string) => value;
    if (oid === 1114) return (value: string) => value.replace(" ", "T");
    if (oid === 1184) return wireTimestamptz;
    return pgTypes.getTypeParser(
      oid,
      format as Parameters<typeof pgTypes.getTypeParser>[1],
    ) as (value: string) => unknown;
  },
};

/** One `pg.query` that answers in the shape PostgREST answers in. */
async function wireQuery(
  pg: Client,
  text: string,
  values: unknown[] = [],
): Promise<{ rows: Record<string, unknown>[]; fields: { name: string }[] }> {
  const r = await pg.query({ text, values, types: WIRE_TYPES });
  return { rows: r.rows as Record<string, unknown>[], fields: r.fields };
}

export type PgSupabaseResult<T = unknown> = {
  data: T | null;
  error: { message: string; code?: string; details?: string } | null;
};

type Filter = { op: string; col: string; val: unknown };

/**
 * Per-table set of json/jsonb column names, read once from information_schema.
 *
 * WHY THIS EXISTS. node-pg serializes a JS array as a POSTGRES ARRAY LITERAL, which is
 * right for `text[]` and wrong for `jsonb`. A snapshot row carries both —
 * `option_order text[]` and `question_options jsonb` — so a single blanket rule breaks
 * one or the other. PostgREST does not have this problem, so the failure exists only
 * in this harness, and a test that hit it would look like a product bug. Added
 * 2026-09-21 (R3), when review's prefill insert became the first one to write a jsonb
 * ARRAY through this shim.
 */
const jsonColumnCache = new Map<string, Set<string>>();

async function jsonColumnsFor(pg: Client, table: string): Promise<Set<string>> {
  const cached = jsonColumnCache.get(table);
  if (cached) return cached;
  const r = await pg.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
        AND data_type IN ('json', 'jsonb')`,
    [table],
  );
  const cols = new Set<string>(
    r.rows.map((row) => String((row as { column_name: unknown }).column_name)),
  );
  jsonColumnCache.set(table, cols);
  return cols;
}

/** JSON-encode a value bound for a json/jsonb column; pass everything else through. */
function encodeForColumn(
  value: unknown,
  column: string,
  jsonColumns: Set<string>,
): unknown {
  if (!jsonColumns.has(column)) return value;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

const PGREST_NO_ROWS = "PGRST116";

/**
 * One query chain. Instances are single-use, matching the Supabase builder.
 */
class PgQueryBuilder implements PromiseLike<PgSupabaseResult> {
  private selectCols = "*";
  private filters: Filter[] = [];
  private orderBy: Array<{ col: string; ascending: boolean }> = [];
  private limitN: number | null = null;
  private writeMode: "insert" | "update" | "upsert" | "delete" | null = null;
  private payload: Record<string, unknown> | Record<string, unknown>[] | null =
    null;
  private conflictTarget: string | null = null;
  private wantsReturning = false;
  private countMode: "exact" | null = null;
  private headOnly = false;

  constructor(
    private readonly pg: Client,
    private readonly table: string,
  ) {}

  select(cols?: string, opts?: { count?: "exact"; head?: boolean }): this {
    if (cols) this.selectCols = cols;
    if (opts?.count) this.countMode = opts.count;
    if (opts?.head) this.headOnly = true;
    this.wantsReturning = true;
    return this;
  }

  insert(data: Record<string, unknown> | Record<string, unknown>[]): this {
    this.writeMode = "insert";
    this.payload = data;
    return this;
  }

  update(data: Record<string, unknown>): this {
    this.writeMode = "update";
    this.payload = data;
    return this;
  }

  upsert(data: Record<string, unknown>, opts?: { onConflict?: string }): this {
    this.writeMode = "upsert";
    this.payload = data;
    this.conflictTarget = opts?.onConflict ?? null;
    return this;
  }

  delete(): this {
    this.writeMode = "delete";
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ op: "=", col, val });
    return this;
  }
  neq(col: string, val: unknown): this {
    this.filters.push({ op: "<>", col, val });
    return this;
  }
  gt(col: string, val: unknown): this {
    this.filters.push({ op: ">", col, val });
    return this;
  }
  gte(col: string, val: unknown): this {
    this.filters.push({ op: ">=", col, val });
    return this;
  }
  lt(col: string, val: unknown): this {
    this.filters.push({ op: "<", col, val });
    return this;
  }
  lte(col: string, val: unknown): this {
    this.filters.push({ op: "<=", col, val });
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push({ op: "IS", col, val });
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push({ op: "IN", col, val: vals });
    return this;
  }

  /**
   * Chained `.order()` calls ACCUMULATE, as they do in supabase-js: the first is the
   * primary sort and each later one is a tiebreak. Extended 2026-09-21 (R3) — this
   * used to overwrite, which silently dropped every tiebreak key. A test asserting a
   * deterministic order would then have passed on whatever order Postgres happened to
   * return, which is the shape of a green test proving nothing.
   */
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  async single(): Promise<PgSupabaseResult> {
    const res = await this.run();
    if (res.error) return res;
    const rows = (res.data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) {
      // PostgREST's no-rows code. Callers branch on it, so it must be exact.
      return {
        data: null,
        error: { message: "Row not found", code: PGREST_NO_ROWS },
      };
    }
    return { data: rows[0] ?? null, error: null };
  }

  async maybeSingle(): Promise<PgSupabaseResult> {
    const res = await this.run();
    if (res.error) return res;
    const rows = (res.data ?? []) as Record<string, unknown>[];
    return { data: rows[0] ?? null, error: null };
  }

  then<R1 = PgSupabaseResult, R2 = never>(
    onfulfilled?: ((value: PgSupabaseResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  // -------------------------------------------------------------------------

  private buildWhere(startAt: number): { sql: string; params: unknown[] } {
    if (this.filters.length === 0) return { sql: "", params: [] };
    const params: unknown[] = [];
    const parts = this.filters.map((f) => {
      if (f.op === "IS") {
        return `"${f.col}" IS ${f.val === null ? "NULL" : String(f.val)}`;
      }
      if (f.op === "IN") {
        const list = f.val as unknown[];
        const ph = list.map((v) => {
          params.push(v);
          return `$${startAt + params.length - 1}`;
        });
        return `"${f.col}" IN (${ph.join(", ")})`;
      }
      params.push(f.val);
      return `"${f.col}" ${f.op} $${startAt + params.length - 1}`;
    });
    return { sql: ` WHERE ${parts.join(" AND ")}`, params };
  }

  private returning(): string {
    if (!this.wantsReturning) return "";
    return ` RETURNING ${this.selectCols === "*" ? "*" : this.selectCols}`;
  }

  private async run(): Promise<PgSupabaseResult> {
    try {
      const t = `public."${this.table}"`;

      if (this.writeMode === "insert" || this.writeMode === "upsert") {
        const rows = Array.isArray(this.payload)
          ? this.payload
          : [this.payload as Record<string, unknown>];
        const cols = Object.keys(rows[0] ?? {});
        const jsonCols = await jsonColumnsFor(this.pg, this.table);
        const params: unknown[] = [];
        const tuples = rows.map((r) => {
          const ph = cols.map((c) => {
            params.push(encodeForColumn(r[c], c, jsonCols));
            return `$${params.length}`;
          });
          return `(${ph.join(", ")})`;
        });
        let sql = `INSERT INTO ${t} (${cols
          .map((c) => `"${c}"`)
          .join(", ")}) VALUES ${tuples.join(", ")}`;
        if (this.writeMode === "upsert" && this.conflictTarget) {
          const target = this.conflictTarget
            .split(",")
            .map((c) => `"${c.trim()}"`)
            .join(", ");
          const sets = cols
            .filter(
              (c) =>
                !this.conflictTarget!.split(",")
                  .map((x) => x.trim())
                  .includes(c),
            )
            .map((c) => `"${c}" = EXCLUDED."${c}"`);
          sql += ` ON CONFLICT (${target}) DO UPDATE SET ${sets.join(", ")}`;
        }
        sql += this.returning();
        const r = await wireQuery(this.pg, sql, params);
        return { data: r.rows, error: null };
      }

      if (this.writeMode === "update") {
        const data = this.payload as Record<string, unknown>;
        const cols = Object.keys(data);
        const jsonCols = await jsonColumnsFor(this.pg, this.table);
        const params: unknown[] = [];
        const sets = cols.map((c) => {
          params.push(encodeForColumn(data[c], c, jsonCols));
          return `"${c}" = $${params.length}`;
        });
        const where = this.buildWhere(params.length + 1);
        const sql = `UPDATE ${t} SET ${sets.join(", ")}${where.sql}${this.returning()}`;
        const r = await wireQuery(this.pg, sql, [...params, ...where.params]);
        return { data: r.rows, error: null };
      }

      if (this.writeMode === "delete") {
        const where = this.buildWhere(1);
        const sql = `DELETE FROM ${t}${where.sql}${this.returning()}`;
        const r = await wireQuery(this.pg, sql, where.params);
        return { data: r.rows, error: null };
      }

      // SELECT
      const where = this.buildWhere(1);
      if (this.countMode === "exact" && this.headOnly) {
        const sql = `SELECT count(*)::int AS c FROM ${t}${where.sql}`;
        const r = await wireQuery(this.pg, sql, where.params);
        return {
          data: null,
          error: null,
          ...({ count: r.rows[0]?.c ?? 0 } as Record<string, unknown>),
        } as PgSupabaseResult;
      }
      let sql = `SELECT ${this.selectCols === "*" ? "*" : this.selectCols} FROM ${t}${where.sql}`;
      if (this.orderBy.length > 0) {
        const keys = this.orderBy
          .map((o) => `"${o.col}" ${o.ascending ? "ASC" : "DESC"}`)
          .join(", ");
        sql += ` ORDER BY ${keys}`;
      }
      if (this.limitN !== null) sql += ` LIMIT ${this.limitN}`;
      const r = await wireQuery(this.pg, sql, where.params);
      // `count: "exact"` WITHOUT `head`: PostgREST returns the rows AND the total
      // matching count, and the total ignores the limit. Added 2026-09-29 for the
      // tutor conversation list, which reads a row's newest message and its message
      // count in one request.
      if (this.countMode === "exact") {
        const c = await wireQuery(
          this.pg,
          `SELECT count(*)::int AS c FROM ${t}${where.sql}`,
          where.params,
        );
        return {
          data: r.rows,
          error: null,
          ...({ count: c.rows[0]?.c ?? 0 } as Record<string, unknown>),
        } as PgSupabaseResult;
      }
      return { data: r.rows, error: null };
    } catch (err: unknown) {
      const e = err as Error & { code?: string; detail?: string };
      return {
        data: null,
        error: { message: e.message, code: e.code, details: e.detail },
      };
    }
  }
}

/**
 * Build a `supabaseServer`-shaped object over a live pg Client.
 * `.from()` returns a fresh builder; `.rpc()` calls the real Postgres function.
 */
/** Per-function `proretset`, so the SETOF question is asked once rather than per call. */
const setReturningCache = new Map<string, boolean>();

export function makePgSupabase(pg: Client): {
  from: (table: string) => PgQueryBuilder;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<PgSupabaseResult>;
} {
  return {
    from: (table: string) => new PgQueryBuilder(pg, table),
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      try {
        const names = Object.keys(args ?? {});
        const params = names.map((n) => (args as Record<string, unknown>)[n]);
        const call = names.length
          ? names.map((n, i) => `${n} => $${i + 1}`).join(", ")
          : "";
        const r = await wireQuery(
          pg,
          `SELECT * FROM public."${fn}"(${call})`,
          params,
        );
        // Scalar-returning functions surface as the bare value, matching supabase-js.
        if (r.rows.length === 1 && r.fields.length === 1) {
          const only = r.fields[0]!.name;
          return { data: r.rows[0]![only] as unknown, error: null };
        }
        // A function returning ONE composite row surfaces as an OBJECT, not a one-element
        // array — that is what PostgREST does, and a harness that returns the array instead
        // makes callers written against production fail here for a reason production does not
        // have. The discriminator is `proretset`, which is the same thing PostgREST asks:
        // SETOF -> array, single composite -> object. Cached per function name; the answer
        // cannot change inside a run.
        if (!setReturningCache.has(fn)) {
          const meta = await pg.query(
            `SELECT p.proretset FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = $1
              LIMIT 1`,
            [fn],
          );
          setReturningCache.set(fn, meta.rows[0]?.proretset === true);
        }
        if (!setReturningCache.get(fn) && r.rows.length === 1) {
          return { data: r.rows[0] as unknown, error: null };
        }
        return { data: r.rows, error: null };
      } catch (err: unknown) {
        const e = err as Error & { code?: string; detail?: string };
        return {
          data: null,
          error: { message: e.message, code: e.code, details: e.detail },
        };
      }
    },
  };
}

/**
 * Connection settings shared by every PG-backed test. `PGHOST` gates the suite:
 * absent means no server, and the test skips rather than failing for the wrong reason.
 */
export const PG_AVAILABLE = !!process.env.PGHOST;

export function pgConnConfig(database: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  return {
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? "5432"),
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "postgres",
    database,
  };
}

/**
 * Create a throwaway database, apply the real genesis + migration pipeline to it, and
 * return a connected client.
 *
 * @spec [Doc-01_V8, §35/§36; owner instruction 2026-08-28 Task 1 Gate A] | @implemented [2026-09-01]
 *
 * plain English: every PG-backed test needs the same four steps before it can assert
 * anything — make a clean database, stub the Supabase-provided roles and `auth` schema,
 * replay `supabase/migrations` in sorted order, and drop the `on_auth_user_created`
 * trigger so a test can seed `auth.users` and `profiles` explicitly. Expected outcome:
 * one definition of "a database with this repo's schema in it".
 *
 * WHY IT LIVES HERE. Four test files had already inlined their own `applyMigrations`
 * (the two guardian-link PG suites, since deleted with the email link flow;
 * `diagnostic.handler-pg.ci.test.ts`, `entitlement-write-path.ci.test.ts`). Adding a
 * fifth, sixth and seventh copy for the three files converted on 2026-09-01 is the
 * divergence CLAUDE.md forbids by name, so the canonical version is extracted here and
 * the new conversions consume it. The four existing copies are consolidation candidates
 * and are deliberately NOT edited — they belong to other surfaces, and rewriting them
 * would widen a CI fix into a refactor.
 *
 * Trade-off: drops `on_auth_user_created`. That trigger's own behaviour is proved by
 * `scripts/ci/genesis-fresh-apply.sh` A.2/A.3, not here; leaving it armed would pre-empt
 * the explicit `profiles` rows a fixture needs. Edge case: `DROP DATABASE` fails if a
 * previous run left a connection open, so the caller owns `client.end()`.
 */
export async function bootstrapPgDatabase(dbName: string): Promise<Client> {
  const admin = new Client(pgConnConfig("postgres"));
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const client = new Client(pgConnConfig(dbName));
  await client.connect();

  // Supabase provides these in real environments; a bare Postgres does not.
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
  `);

  const dir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../supabase/migrations",
  );
  for (const f of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
  }

  await client.query(
    `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;`,
  );
  return client;
}
