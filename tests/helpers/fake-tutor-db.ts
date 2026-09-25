/**
 * In-memory `supabaseServer` stand-in for LISA tutor-runtime route tests.
 *
 * @spec [Doc-03B_V4.1 §7.5, §14.3, §14.4] | @implemented [2026-09-23]
 *
 * plain English: implements the subset of the Supabase query-builder chain that
 * `server/routes/tutor-runtime.ts` uses (select/insert/update with eq/is/in/lt/gte/
 * order/limit/single/maybeSingle, count+head) over plain arrays, so a route test can
 * drive the REAL route handler end to end. Expected outcome: a test observes the rows
 * the route actually writes and the JSON it actually returns.
 *
 * WHY NOT tests/helpers/pg-supabase.ts. That harness needs a real Postgres with the
 * `vector` extension and a per-file CI job; the tutor route tests run in the default
 * `pnpm test` suite. The one database behaviour these tests depend on — the partial
 * unique index `idx_tutor_messages_client_turn_idempotency` on
 * (student_id, conversation_id, client_turn_id, role) — is modelled explicitly in
 * UNIQUE_KEYS below and returns PostgreSQL's 23505, and the route test asserts that
 * key against the migration text so the model cannot drift from the schema silently.
 *
 * Trade-off: proves route logic against the schema's uniqueness rule, not PostgREST
 * wire behaviour or column existence. Column projection is ignored (full rows return).
 */

type Row = Record<string, unknown>;
type Result = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};
type Filter = (row: Row) => boolean;

/** Partial unique indexes modelled per table (NULL in any key column exempts the row). */
export const UNIQUE_KEYS: Record<
  string,
  ReadonlyArray<{ name: string; columns: readonly string[] }>
> = {
  tutor_messages: [
    {
      name: "idx_tutor_messages_client_turn_idempotency",
      columns: ["student_id", "conversation_id", "client_turn_id", "role"],
    },
  ],
};

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  const hex = idCounter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

class FakeQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private ascending = true;
  private limitN: number | null = null;
  private mode: "select" | "insert" | "update" = "select";
  private payload: Row | Row[] | null = null;
  private singleMode: "single" | "maybe" | null = null;
  private countExact = false;
  private headOnly = false;

  constructor(
    private readonly db: FakeTutorDb,
    private readonly table: string,
  ) {}

  select(_cols?: string, opts?: { count?: "exact"; head?: boolean }): this {
    if (opts?.count === "exact") this.countExact = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(data: Row | Row[]): this {
    this.mode = "insert";
    this.payload = data;
    return this;
  }
  update(data: Row): this {
    this.mode = "update";
    this.payload = data;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: null): this {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  lt(col: string, val: string): this {
    this.filters.push((r) => String(r[col]) < val);
    return this;
  }
  gte(col: string, val: string): this {
    this.filters.push((r) => String(r[col]) >= val);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.ascending = opts?.ascending ?? true;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  single(): this {
    this.singleMode = "single";
    return this;
  }
  maybeSingle(): this {
    this.singleMode = "maybe";
    return this;
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private matching(): Row[] {
    return this.db
      .rows(this.table)
      .filter((r) => this.filters.every((f) => f(r)));
  }

  private shape(rows: Row[]): Result {
    if (this.singleMode === null) {
      return { data: rows, error: null };
    }
    if (rows.length === 0) {
      return this.singleMode === "maybe"
        ? { data: null, error: null }
        : { data: null, error: { message: "no rows", code: "PGRST116" } };
    }
    if (rows.length > 1) {
      return {
        data: null,
        error: { message: "multiple rows", code: "PGRST116" },
      };
    }
    return { data: rows[0], error: null };
  }

  private execute(): Result {
    const failure = this.db.failureFor(this.table, this.mode);
    if (failure) return { data: null, error: failure };

    if (this.mode === "insert") {
      const incoming = Array.isArray(this.payload)
        ? this.payload
        : [this.payload ?? {}];
      const now = this.db.nextTimestamp();
      const prepared = incoming.map((r) => ({
        id: newId(),
        created_at: now,
        updated_at: now,
        ...this.db.defaultsFor(this.table),
        ...r,
      }));
      for (const row of prepared) {
        const violation = this.db.uniqueViolation(this.table, row);
        if (violation) return { data: null, error: violation };
      }
      this.db.rows(this.table).push(...prepared);
      return this.shape(prepared);
    }

    if (this.mode === "update") {
      const rows = this.matching();
      for (const r of rows) Object.assign(r, this.payload);
      return this.shape(rows);
    }

    let rows = this.matching();
    if (this.orderCol) {
      const col = this.orderCol;
      const dir = this.ascending ? 1 : -1;
      rows = rows
        .slice()
        .sort((a, b) =>
          String(a[col]) < String(b[col])
            ? -dir
            : String(a[col]) > String(b[col])
              ? dir
              : 0,
        );
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.countExact) {
      return {
        data: this.headOnly ? null : rows,
        error: null,
        count: rows.length,
      };
    }
    return this.shape(rows);
  }
}

export class FakeTutorDb {
  private tables = new Map<string, Row[]>();
  private failures = new Map<string, { message: string; code?: string }>();
  private clock = Date.parse("2026-09-23T10:00:00.000Z");

  rows(table: string): Row[] {
    let t = this.tables.get(table);
    if (!t) {
      t = [];
      this.tables.set(table, t);
    }
    return t;
  }

  seed(table: string, row: Row): Row {
    const full = {
      id: newId(),
      created_at: this.nextTimestamp(),
      ...this.defaultsFor(table),
      ...row,
    };
    this.rows(table).push(full);
    return full;
  }

  /** Monotonic timestamps so created_at ordering is deterministic. */
  nextTimestamp(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  defaultsFor(table: string): Row {
    if (table === "tutor_messages") return { status: "completed" };
    // The column defaults production applies on INSERT (migrations
    // 20260805000000 and 20260922000000_lisa_session_lifecycle). Without
    // them a conversation created through POST /conversations had no status,
    // so it was neither reusable nor able to take a turn in tests.
    if (table === "tutor_conversations") {
      return {
        status: "active",
        crisis_flagged: false,
        deleted_at: null,
        closed_at: null,
        title: "New session",
        crisis_paused_at: null,
        ended_at: null,
      };
    }
    return {};
  }

  /** Make every `mode` operation on `table` return this error until cleared. */
  failNext(
    table: string,
    mode: "select" | "insert" | "update",
    error: { message: string; code?: string },
  ): void {
    this.failures.set(`${table}:${mode}`, error);
  }

  failureFor(
    table: string,
    mode: string,
  ): { message: string; code?: string } | null {
    const key = `${table}:${mode}`;
    const f = this.failures.get(key) ?? null;
    if (f) this.failures.delete(key);
    return f;
  }

  uniqueViolation(
    table: string,
    row: Row,
  ): { message: string; code: string } | null {
    for (const { name, columns } of UNIQUE_KEYS[table] ?? []) {
      if (columns.some((c) => row[c] === null || row[c] === undefined)) {
        continue;
      }
      const clash = this.rows(table).some((existing) =>
        columns.every((c) => existing[c] === row[c]),
      );
      if (clash) {
        // PostgreSQL's wording; PostgREST passes it through as `message`.
        return {
          message: `duplicate key value violates unique constraint "${name}"`,
          code: "23505",
        };
      }
    }
    return null;
  }

  client(): { from: (table: string) => FakeQuery } {
    return { from: (table: string) => new FakeQuery(this, table) };
  }
}
