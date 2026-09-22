/**
 * A fake `supabaseServer` for the calendar service tests.
 *
 * @spec [lyceon-coding-standards §14] | @implemented [2026-09-21]
 *
 * plain English: the four calendar services are workflow over a handful of queries. This
 * stands in for the database so the workflow can be tested without one — which query was
 * issued, with which filters, and what the service did with the answer.
 *
 * It is NOT a database. It does not evaluate filters, enforce constraints or order rows;
 * a test says "this table answers with these rows" and the harness records how it was
 * asked. The real schema is proved by `scripts/ci/calendar-*-gates.sql` against a live
 * Postgres, which is the right place for it and the wrong place for "does the service
 * regenerate on first open".
 */
export type FakeError = { message: string; code?: string };
export type FakeReply = {
  data: unknown;
  error: FakeError | null;
  count?: number | null;
};

export type QueryState = {
  /** A single counter shared with `rpcs`, so a test can compare their ORDER. */
  seq: number;
  table: string;
  columns: string;
  head: boolean;
  op: "select" | "upsert" | "insert";
  payload: unknown;
  filters: { kind: string; column: string; value: unknown }[];
  mode: "list" | "single" | "maybeSingle";
};

export type TableResolver = (state: QueryState) => FakeReply;
export type RpcResolver = (args: Record<string, unknown>) => FakeReply;

export type FakeClient = {
  from(table: string): FakeBuilder;
  rpc(fn: string, args: Record<string, unknown>): Promise<FakeReply>;
  /** Every query the services issued, oldest first. */
  readonly queries: QueryState[];
  /** Every RPC the services issued, oldest first. `seq` interleaves with `queries`. */
  readonly rpcs: { seq: number; fn: string; args: Record<string, unknown> }[];
};

type FakeBuilder = {
  select(
    columns?: string,
    options?: { count?: string; head?: boolean },
  ): FakeBuilder;
  upsert(row: unknown, options?: { onConflict?: string }): FakeBuilder;
  insert(row: unknown): Promise<FakeReply>;
  eq(column: string, value: unknown): FakeBuilder;
  neq(column: string, value: unknown): FakeBuilder;
  gt(column: string, value: unknown): FakeBuilder;
  gte(column: string, value: unknown): FakeBuilder;
  lt(column: string, value: unknown): FakeBuilder;
  lte(column: string, value: unknown): FakeBuilder;
  in(column: string, value: unknown): FakeBuilder;
  not(column: string, operator: string, value: unknown): FakeBuilder;
  order(column: string, options?: unknown): FakeBuilder;
  limit(n: number): FakeBuilder;
  single(): Promise<FakeReply>;
  maybeSingle(): Promise<FakeReply>;
  then<T>(onFulfilled: (reply: FakeReply) => T): Promise<T>;
};

export function makeFakeClient(options: {
  tables: Record<string, TableResolver>;
  rpcs?: Record<string, RpcResolver>;
}): FakeClient {
  const queries: QueryState[] = [];
  const rpcs: { seq: number; fn: string; args: Record<string, unknown> }[] = [];
  let seq = 0;

  const settle = (state: QueryState): FakeReply => {
    seq += 1;
    state.seq = seq;
    queries.push(state);
    // `practice_runtime_config` is read by `loadCalendarConfig` for §17.1's minute estimate
    // (Doc 02B §41 owns practice timing, so the calendar references its table rather than
    // copying the constant). Defaulted here rather than in every suite that builds a fake
    // client: a test about the weekly job or the profile upsert has no opinion about it, and
    // making each one restate it would be six copies of someone else's constant.
    const resolver =
      options.tables[state.table] ??
      (state.table === "practice_runtime_config"
        ? () => okReply([PRACTICE_CONFIG_ROW])
        : undefined);
    if (resolver === undefined) {
      throw new Error(
        `fake supabase: no resolver registered for table ${state.table}`,
      );
    }
    return resolver(state);
  };

  const builder = (table: string): FakeBuilder => {
    const state: QueryState = {
      seq: 0,
      table,
      columns: "",
      head: false,
      op: "select",
      payload: undefined,
      filters: [],
      mode: "list",
    };
    const push = (
      kind: string,
      column: string,
      value: unknown,
    ): FakeBuilder => {
      state.filters.push({ kind, column, value });
      return api;
    };
    const api: FakeBuilder = {
      select(columns, opts) {
        state.columns = columns ?? "";
        if (opts?.head === true) state.head = true;
        return api;
      },
      upsert(row) {
        state.op = "upsert";
        state.payload = row;
        return api;
      },
      // An insert with no `.select()` resolves on its own rather than returning a builder,
      // which is how `@supabase/supabase-js` behaves and how `recordRun` awaits it.
      insert(row) {
        state.op = "insert";
        state.payload = row;
        state.mode = "list";
        return Promise.resolve(settle(state));
      },
      eq: (column, value) => push("eq", column, value),
      neq: (column, value) => push("neq", column, value),
      gt: (column, value) => push("gt", column, value),
      gte: (column, value) => push("gte", column, value),
      // `lt` was missing until 2026-09-23, which is why nothing had ever driven the practice
      // adapter's local-day window through this fake — it builds a half-open [gte, lt) range.
      lt: (column, value) => push("lt", column, value),
      lte: (column, value) => push("lte", column, value),
      in: (column, value) => push("in", column, value),
      not: (column, operator, value) => push(`not.${operator}`, column, value),
      order: () => api,
      limit: () => api,
      single() {
        state.mode = "single";
        return Promise.resolve(settle(state));
      },
      maybeSingle() {
        state.mode = "maybeSingle";
        return Promise.resolve(settle(state));
      },
      then(onFulfilled) {
        state.mode = "list";
        return Promise.resolve(settle(state)).then(onFulfilled);
      },
    };
    return api;
  };

  return {
    from: builder,
    rpc(fn, args) {
      seq += 1;
      rpcs.push({ seq, fn, args });
      const resolver = options.rpcs?.[fn];
      if (resolver === undefined) {
        throw new Error(`fake supabase: no resolver registered for rpc ${fn}`);
      }
      return Promise.resolve(resolver(args));
    },
    queries,
    rpcs,
  };
}

/** The six §8.1/§12.5/§10.2 rows, as `calendar_runtime_config` holds them. */
export const CONFIG_ROWS: { key: string; value: unknown }[] = [
  { key: "daily_minutes_min", value: 15 },
  { key: "daily_minutes_max", value: 180 },
  { key: "daily_minutes_presets", value: [15, 30, 45, 60, 90, 120] },
  { key: "target_exam_date_max_days", value: 540 },
  { key: "weekly_job_interval_minutes", value: 1440 },
  { key: "horizon_days", value: 14 },
  { key: "generator_version", value: "20260917140000" },
  // §17.1's "~N min" readout. Calendar-owned (SCL-08-F); its practice counterpart lives in
  // `practice_runtime_config` because Doc 02B §41 owns practice timing.
  { key: "review_estimated_seconds_per_item", value: 120 },
];

/**
 * `practice_runtime_config.target_seconds_per_question` — Doc 02B §41. A separate table, so
 * a separate fixture: the config accessor reads it with its own query and a harness that
 * folded it into CONFIG_ROWS would pass while the real accessor failed.
 */
export const PRACTICE_CONFIG_ROW = {
  key: "target_seconds_per_question",
  value: 90,
};

export const okReply = (data: unknown, count?: number): FakeReply =>
  count === undefined ? { data, error: null } : { data, error: null, count };

export const errReply = (message: string, code?: string): FakeReply =>
  code === undefined
    ? { data: null, error: { message } }
    : { data: null, error: { message, code } };
