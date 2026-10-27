/**
 * Hot-path harness — the four first-run server paths over real PostgreSQL.
 *
 * @spec [owner brief 2026-10-13 "first-run activation fixes" item 2 (performance pass): per-step
 *        timings for practice session start, answer submit, review session start and the
 *        calendar read; measure p50/p95 before and after; Coding Standards §5.2 (answer
 *        checking stays server-side)] | @implemented [2026-10-13]
 *
 * plain English: one throwaway database built from this repo's migrations, one seeded student
 * with a premium entitlement, a question bank, an open review queue and a completed study
 * profile, and the REAL practice, review, calendar and practice-topics routers mounted behind an
 * auth stand-in. Two suites use it: the golden regression test (`tests/ci/hot-paths.golden.pg.ci
 * .test.ts`, responses unchanged by the performance pass) and the local benchmark
 * (`tests/perf/hot-paths.bench.pg.test.ts`, p50/p95 per path).
 *
 * THE DATABASE TRANSPORT IS COUNTED AND CAN BE SLOWED. Every logical Supabase call — one
 * `.from(...)` chain awaited, or one `.rpc(...)` — passes through `transport`, which counts it
 * and, when `latencyMs` is set, waits that long first. Local Postgres answers in well under a
 * millisecond, so a raw local timing hides exactly what this pass changes (how many round
 * trips a request waits on, one after another). `latencyMs` models the network distance to
 * PostgREST; the benchmark reports both. Parallel calls overlap their waits, as they do in
 * production, because the shim runs over a node-pg POOL (separate connections).
 *
 * LIMITS: auth, CSRF and the rate limiter are stand-ins (the same posture as
 * practice-runner.pg.ci.test.ts); the Supabase client is `makePgSupabase`, so this proves the
 * handlers against the real schema and RPCs, not PostgREST wire behaviour.
 */
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import pg from "pg";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  pgConnConfig,
} from "../helpers/pg-supabase";

export const STUDENT = "5e5e5e5e-0000-4000-8000-000000000001";
/** A second student with NO study profile: the pre-setup calendar read (timezone lookup). */
export const NEW_STUDENT = "5e5e5e5e-0000-4000-8000-000000000002";

/** The state the vi.mock factories in each suite read. Set by `bootHarness`. */
export const harness: {
  pool: pg.Pool | null;
  setup: pg.Client | null;
  actingStudent: string;
  latencyMs: number;
  roundTrips: number;
  /** Round trips per table or rpc name, so a test can count one target's reads. */
  calls: Map<string, number>;
  /**
   * Every round trip's [start, end] (performance.now), for `sequentialDepth`. Always recorded;
   * a test reads the slice it made (owner ruling 2026-10-15 on #1238: dependency DEPTH).
   */
  intervals: Array<{ start: number; end: number }>;
} = {
  pool: null,
  setup: null,
  actingStudent: STUDENT,
  latencyMs: 0,
  roundTrips: 0,
  calls: new Map(),
  intervals: [],
};

/**
 * The longest chain of round trips in which each one STARTED after the previous one ENDED — the
 * number of waits a request sat through one after another. Parallel reads overlap and add one
 * level; a read that waited for another adds one more. With an injected latency (say 10 ms) per
 * round trip and local PG answering in well under a millisecond, unrelated parallel reads never
 * appear ordered, so this is the request's sequential dependency depth.
 */
export function sequentialDepth(
  intervals: ReadonlyArray<{ start: number; end: number }>,
): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const depth: number[] = [];
  let best = 0;
  for (const [i, current] of sorted.entries()) {
    let level = 1;
    for (let j = 0; j < i; j += 1) {
      const earlier = sorted[j]!;
      if (earlier.end <= current.start) level = Math.max(level, depth[j]! + 1);
    }
    depth.push(level);
    best = Math.max(best, level);
  }
  return best;
}

function count(target: string): void {
  harness.roundTrips += 1;
  harness.calls.set(target, (harness.calls.get(target) ?? 0) + 1);
}

/** Round trips to one table or rpc since the harness booted. */
export function callsTo(target: string): number {
  return harness.calls.get(target) ?? 0;
}

type Facade = ReturnType<typeof makePgSupabase>;
type Runnable = { run: () => Promise<unknown> };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The counted, optionally slowed transport. Wraps the builder's private `run` (the single
 * point every terminal — `await`, `.single()`, `.maybeSingle()` — goes through) and `rpc`.
 */
export function transport(): Facade {
  if (!harness.pool) throw new Error("hot-path harness not booted");
  // makePgSupabase is typed over a Client; a Pool answers the same `query` call and gives
  // concurrent calls separate connections, which is what production does.
  const sb = makePgSupabase(harness.pool as unknown as pg.Client);
  return {
    from: (table: string) => {
      const builder = sb.from(table);
      const runnable = builder as unknown as Runnable;
      const original = runnable.run.bind(builder);
      runnable.run = async () => {
        count(table);
        const start = performance.now();
        try {
          if (harness.latencyMs > 0) await sleep(harness.latencyMs);
          return await original();
        } finally {
          harness.intervals.push({ start, end: performance.now() });
        }
      };
      return builder;
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      count(`rpc:${fn}`);
      const start = performance.now();
      try {
        if (harness.latencyMs > 0) await sleep(harness.latencyMs);
        return await sb.rpc(fn, args);
      } finally {
        harness.intervals.push({ start, end: performance.now() });
      }
    },
  };
}

/** A `supabaseServer`-shaped proxy over `transport()`. */
export function transportProxy(): object {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        return (transport() as unknown as Record<string, unknown>)[
          prop as string
        ];
      },
    },
  );
}

export function authStub(): Record<string, unknown> {
  const pass = (_q: Request, _s: Response, next: NextFunction): void => next();
  return {
    requireSupabaseAuth: (req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: unknown }).user = {
        id: harness.actingStudent,
        actor_id: harness.actingStudent,
        role: "student",
        isAdmin: false,
        isGuardian: false,
        is_under_13: false,
        profile_completed_at: "2026-09-01T00:00:00.000Z",
      };
      next();
    },
    requireStudentOrAdmin: pass,
    requireProfileComplete: pass,
    requireGuardianLinkForUnder13: pass,
    getSupabaseAdmin: () => transport(),
  };
}

const DOMAINS: ReadonlyArray<{
  section: "M" | "RW";
  domain: string;
  code: string;
}> = [
  { section: "M", domain: "Algebra", code: "ALG" },
  { section: "M", domain: "Advanced Math", code: "ADV" },
  { section: "RW", domain: "Craft and Structure", code: "CRS" },
  { section: "RW", domain: "Information and Ideas", code: "INF" },
];

/** Ten questions per domain, two skills per domain: 40 questions, 8 catalog triples. */
export const QUESTION_IDS: string[] = DOMAINS.flatMap((d) =>
  Array.from(
    { length: 10 },
    (_, i) => `SAT${d.section}1${d.code}${String(i).padStart(3, "0")}`,
  ),
);

async function seed(client: pg.Client): Promise<void> {
  for (const [id, email] of [
    [STUDENT, "hotpath@example.test"],
    [NEW_STUDENT, "hotpath-new@example.test"],
  ] as const) {
    await client.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [
      id,
      email,
    ]);
    await client.query(
      `INSERT INTO public.profiles (id, email, role) VALUES ($1,$2,'student')`,
      [id, email],
    );
  }
  await client.query(
    `INSERT INTO public.entitlements
       (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id, current_period_end)
     VALUES ($1, 'premium', 'active', 'sub_hotpath', 'si_hotpath', now() + interval '20 days')`,
    [STUDENT],
  );
  await client.query(
    `UPDATE public.entitlement_features SET enabled = true WHERE feature_key = 'calendar_access'`,
  );

  for (const d of DOMAINS) {
    for (let i = 0; i < 10; i += 1) {
      const id = `SAT${d.section}1${d.code}${String(i).padStart(3, "0")}`;
      await client.query(
        `INSERT INTO public.questions
           (id, section, source_type, domain, skill_codes, difficulty, stem, options,
            correct_answer, explanation, option_metadata, status, item_type, published_at)
         VALUES ($1,$2,1,$3,$4,$5,$6,
           '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
           'C',$7,
           '{"A":{"role":"distractor"},"B":{"role":"distractor"},"C":{"role":"correct"},"D":{"role":"distractor"}}'::jsonb,
           'published','mcq', now())`,
        [
          id,
          d.section,
          d.domain,
          [`${d.code}.S${i % 2}`],
          (i % 3) + 1,
          `Stem ${id}`,
          `Expl ${id}`,
        ],
      );
    }
  }

  // An open review queue of ten mistakes, oldest first.
  for (let i = 0; i < 10; i += 1) {
    await client.query(
      `INSERT INTO public.review_schedule
         (student_id, question_id, queued_at, status, source_engine,
          source_session_id, source_item_id, source_outcome)
       VALUES ($1,$2,$3,'active','practice', gen_random_uuid(), gen_random_uuid(), 'incorrect')`,
      [
        STUDENT,
        QUESTION_IDS[i * 4],
        new Date(Date.UTC(2026, 8, 1 + i, 10)).toISOString(),
      ],
    );
  }
}

/** A test date 60 days out, so the §8.1 window never makes this file date-dependent. */
const EXAM_DATE = new Date(Date.now() + 60 * 86_400_000)
  .toISOString()
  .slice(0, 10);

export function setupBody(): Record<string, unknown> {
  return {
    timezone: "America/Chicago",
    target_exam_date: EXAM_DATE,
    target_score: 1400,
    study_days_mask: 62,
    daily_minutes: 60,
    full_length_weekday: 6,
    full_length_interval_weeks: 2,
    idempotency_key: "5e5e5e5e-0000-4000-8000-0000000000ff",
  };
}

export async function bootHarness(dbName: string): Promise<void> {
  harness.setup = await bootstrapPgDatabase(dbName);
  await seed(harness.setup);
  harness.pool = new pg.Pool({ ...pgConnConfig(dbName), max: 16 });
}

export async function shutdownHarness(): Promise<void> {
  await harness.pool?.end();
  harness.pool = null;
  await harness.setup?.end();
  harness.setup = null;
}

/** The four routers as production mounts them (auth stand-in, no CSRF). */
export async function buildApp(): Promise<Express> {
  const { default: practiceRouter } =
    await import("../../server/routes/practice-canonical");
  const { default: reviewRouter } =
    await import("../../server/routes/review-canonical");
  const { calendarRouter } =
    await import("../../server/routes/calendar-routes");
  const { getPracticeTopics } =
    await import("../../server/routes/practice-topics-routes");
  const auth = authStub() as {
    requireSupabaseAuth: express.RequestHandler;
  };

  const app = express();
  app.use(express.json());
  // A stand-in for requestIdMiddleware without its per-request access log (which would add
  // stdout work to every benchmarked request): honours `x-request-id` as production does.
  app.use((req, _res, next) => {
    req.requestId =
      req.header("x-request-id") ?? `hotpath-${harness.roundTrips}`;
    next();
  });
  app.use("/api/practice/topics", auth.requireSupabaseAuth, getPracticeTopics);
  app.use("/api/practice", auth.requireSupabaseAuth, practiceRouter);
  app.use("/api/review", auth.requireSupabaseAuth, reviewRouter);
  app.use("/api/calendar", auth.requireSupabaseAuth, calendarRouter);
  return app;
}

/** Close every open practice and review session so the concurrent-session caps never bite. */
export async function closeOpenSessions(): Promise<void> {
  const client = harness.setup;
  if (!client) throw new Error("hot-path harness not booted");
  await client.query(
    `UPDATE public.practice_sessions SET status = 'abandoned', abandoned_at = now()
      WHERE status IN ('created','active')`,
  );
  await client.query(
    `UPDATE public.review_sessions SET status = 'abandoned', abandoned_at = now()
      WHERE status IN ('created','active')`,
  );
}

/**
 * The served token for the CORRECT option of an item, read the way a test oracle reads it:
 * from the persisted token map, which the client never sees. Lets the golden test submit a
 * known-correct answer through the real route.
 */
export async function correctTokenFor(sessionItemId: string): Promise<string> {
  const client = harness.setup;
  if (!client) throw new Error("hot-path harness not booted");
  const r = await client.query(
    `SELECT option_token_map, question_correct_answer
       FROM public.practice_session_items WHERE id = $1`,
    [sessionItemId],
  );
  const row = r.rows[0] as
    | {
        option_token_map: Record<string, string>;
        question_correct_answer: string;
      }
    | undefined;
  if (!row) throw new Error("session item not found");
  const entry = Object.entries(row.option_token_map).find(
    ([, key]) => key === row.question_correct_answer,
  );
  if (!entry) throw new Error("no token maps to the correct answer");
  return entry[0];
}
