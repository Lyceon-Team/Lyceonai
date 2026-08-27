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

import { Client } from "pg";

export type PgSupabaseResult<T = unknown> = {
  data: T | null;
  error: { message: string; code?: string; details?: string } | null;
};

type Filter = { op: string; col: string; val: unknown };

const PGREST_NO_ROWS = "PGRST116";

/**
 * One query chain. Instances are single-use, matching the Supabase builder.
 */
class PgQueryBuilder implements PromiseLike<PgSupabaseResult> {
  private selectCols = "*";
  private filters: Filter[] = [];
  private orderBy: { col: string; ascending: boolean } | null = null;
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

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { col, ascending: opts?.ascending ?? true };
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
        const params: unknown[] = [];
        const tuples = rows.map((r) => {
          const ph = cols.map((c) => {
            params.push(r[c]);
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
        const r = await this.pg.query(sql, params);
        return { data: r.rows, error: null };
      }

      if (this.writeMode === "update") {
        const data = this.payload as Record<string, unknown>;
        const cols = Object.keys(data);
        const params: unknown[] = [];
        const sets = cols.map((c) => {
          params.push(data[c]);
          return `"${c}" = $${params.length}`;
        });
        const where = this.buildWhere(params.length + 1);
        const sql = `UPDATE ${t} SET ${sets.join(", ")}${where.sql}${this.returning()}`;
        const r = await this.pg.query(sql, [...params, ...where.params]);
        return { data: r.rows, error: null };
      }

      if (this.writeMode === "delete") {
        const where = this.buildWhere(1);
        const sql = `DELETE FROM ${t}${where.sql}${this.returning()}`;
        const r = await this.pg.query(sql, where.params);
        return { data: r.rows, error: null };
      }

      // SELECT
      const where = this.buildWhere(1);
      if (this.countMode === "exact" && this.headOnly) {
        const sql = `SELECT count(*)::int AS c FROM ${t}${where.sql}`;
        const r = await this.pg.query(sql, where.params);
        return {
          data: null,
          error: null,
          ...({ count: r.rows[0]?.c ?? 0 } as Record<string, unknown>),
        } as PgSupabaseResult;
      }
      let sql = `SELECT ${this.selectCols === "*" ? "*" : this.selectCols} FROM ${t}${where.sql}`;
      if (this.orderBy) {
        sql += ` ORDER BY "${this.orderBy.col}" ${this.orderBy.ascending ? "ASC" : "DESC"}`;
      }
      if (this.limitN !== null) sql += ` LIMIT ${this.limitN}`;
      const r = await this.pg.query(sql, where.params);
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
        const r = await pg.query(
          `SELECT * FROM public."${fn}"(${call})`,
          params,
        );
        // Scalar-returning functions surface as the bare value, matching supabase-js.
        if (r.rows.length === 1 && r.fields.length === 1) {
          const only = r.fields[0]!.name;
          return { data: r.rows[0]![only] as unknown, error: null };
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
