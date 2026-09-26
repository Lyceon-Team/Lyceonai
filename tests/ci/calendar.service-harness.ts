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
  // §17.2's engine picker, and V-03's allow-list. Matches production on 2026-09-24:
  // full-length is absent because it has not shipped.
  { key: "enabled_block_types", value: ["practice", "review"] },
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

// ── One canonical realistic scenario, shared ────────────────────────────────
//
// These rows were local consts in `calendar.read-service.test.ts` and are hoisted here so
// the wire-contract test parses the SAME plan the service test asserts on. Two copies would
// let one test's fixture drift from the other's and both stay green — the duplication
// CLAUDE.md calls a defect even when no two edits touch the same line.
//
// `vi.mock` factories still live in each test file: vitest hoists them above imports, so
// they cannot be shared from here. Only the DATA moves, which is the half that drifts.

export const SCENARIO_STUDENT = "11111111-1111-1111-1111-111111111111";
export const SCENARIO_BLOCK_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
export const SCENARIO_TODAY = "2026-09-21";
/** 2026-09-21T18:00:00Z is still the 21st in Chicago (UTC−5) and in New York (UTC−4). */
export const SCENARIO_NOW = new Date("2026-09-21T18:00:00.000Z");

export const PROFILE_ROW = {
  timezone: "America/Chicago",
  target_exam_date: null,
  target_score: 1400,
  study_days_mask: 127,
  daily_minutes: 60,
  full_length_weekday: 6,
  planner_mode: "auto" as const,
  setup_completed_at: "2026-09-01T00:00:00.000Z",
};

/**
 * A practice block whose mix carries `explanation_key` — deliberately. The guardian
 * projection must strip it at the per-domain level as well as the block level (§16), and a
 * fixture without it would let that leak through untested.
 */
export const BLOCK_ROW = {
  block_id: SCENARIO_BLOCK_ID,
  scheduled_date: SCENARIO_TODAY,
  block_type: "practice",
  section: "M",
  scope: {
    level: "domain",
    mix: [{ domain: "Algebra", count: 20, explanation_key: "weak" }],
  },
  target_count: 20,
  source: "auto",
  derived_from_block_id: null,
  explanation_key: "weighted",
};

export const PLAN_ROW = {
  scheduled_date: SCENARIO_TODAY,
  timezone: "America/Chicago",
  is_user_override: false,
  version_no: 3,
  block_id: SCENARIO_BLOCK_ID,
  display_ordinal: 1,
  membership_type: "created",
};

export type ScenarioOptions = {
  profile?: typeof PROFILE_ROW | null;
  /** The zones `calendar_is_known_timezone` answers true for. */
  knownZones?: readonly string[];
  acceptedVersions?: number;
  planRows?: (typeof PLAN_ROW)[];
  unacknowledged?: {
    version_no: number;
    trigger: string;
    created_at: string;
  } | null;
};

/**
 * THE canonical fake database for a calendar read. Extracted from
 * `calendar.read-service.test.ts` so the wire-contract test drives the real serializer over
 * the SAME rows the service test asserts on — two hand-built scenarios would let the
 * serializer satisfy one and not the other, and both files would stay green.
 *
 * It returns the client rather than assigning it, because each test file owns its own
 * `vi.mock` factory for `supabase-server` (vitest hoists those above imports, so they cannot
 * live here).
 */
export function makeScenarioClient(options: ScenarioOptions = {}): FakeClient {
  const profile = options.profile === undefined ? PROFILE_ROW : options.profile;
  const planRows = options.planRows ?? [PLAN_ROW];

  return makeFakeClient({
    tables: {
      calendar_runtime_config: () => okReply(CONFIG_ROWS),
      practice_runtime_config: () => okReply([PRACTICE_CONFIG_ROW]),
      student_study_profile: (state: QueryState) =>
        state.columns.includes("last_acknowledged")
          ? okReply({ last_acknowledged_nonstudent_version_no: 0 })
          : okReply(profile),
      calendar_plan_versions: (state: QueryState) => {
        if (state.head) return okReply(null, options.acceptedVersions ?? 0);
        if (state.columns.includes("input_snapshot")) {
          return okReply([
            {
              version_no: 3,
              input_snapshot: { profile: { study_days_mask: 127 } },
            },
          ]);
        }
        return okReply(options.unacknowledged ?? null);
      },
      calendar_current_plan: () => okReply(planRows),
      calendar_blocks: () => okReply([BLOCK_ROW]),
      calendar_block_launches: () => okReply([]),
      student_overall_kpi: () =>
        okReply({ current_streak_days: 4, longest_streak_days: 9 }),
    },
    rpcs: {
      calendar_persist_version: () =>
        okReply({ version_no: 1, validator_result: "accepted" }),
      student_diagnostic_state: () => okReply("baseline_ready"),
      calendar_is_known_timezone: (args) =>
        okReply(
          (options.knownZones ?? ["America/Chicago"]).includes(
            String(args.p_timezone),
          ),
        ),
    },
  });
}

export const okReply = (data: unknown, count?: number): FakeReply =>
  count === undefined ? { data, error: null } : { data, error: null, count };

export const errReply = (message: string, code?: string): FakeReply =>
  code === undefined
    ? { data: null, error: { message } }
    : { data: null, error: { message, code } };
