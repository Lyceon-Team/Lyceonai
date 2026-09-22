/**
 * INV-08-18 — a crashed launch heals, proven through the real transport.
 *
 * @spec [Doc-05F_V1.0 §15.1 (launch, INV-08-18), §7.7 `calendar_block_launches`,
 *        §18 "Created but link failed | Retry → same engine key → same session → link";
 *        Doc-02B_V4 §14 session create] | @implemented [2026-09-21]
 *
 * plain English: the student presses Start, the practice session is created, and the
 * server dies before it records the launch. On retry the student must get the SAME
 * session — not a second one — and the launch row must land.
 *
 * WHY THIS CANNOT BE PROVEN WITH A MOCK. `tests/ci/calendar.launch-service.test.ts`
 * already asserts the sequence arithmetic against fake ports, and it is a good test —
 * but the property here is not arithmetic. It is that `calendar_link_launch` and the
 * practice engine's own idempotency ledger, reached over a wire, as a real
 * `service_role` JWT, agree about what a repeated key means. A recorder cannot see a
 * missing GRANT, a role without BYPASSRLS, or a `FOR UPDATE` that was never taken,
 * and those are what a production launch failure is actually made of.
 *
 *   real CalendarLaunchService
 *     -> real liveLaunchDeps (every read, unmodified)
 *       -> real practice adapter -> real startOrReplaySession
 *         -> real supabase-js (the app's own lazy singletons, pointed by env)
 *           -> real PostgREST, on a real HS256 service_role JWT
 *             -> real Postgres carrying genesis + every migration
 *
 * WHAT IS SUBSTITUTED, AND IT IS EXACTLY ONE THING. `linkLaunch` is wrapped so the
 * first call fails — that IS the crash, and it is the one event a test cannot produce
 * by asking politely. Every other port is `liveLaunchDeps`'s own. The failure injected
 * is the one §18 names by name, not a convenient one.
 *
 * WHY THE SERVICE AND NOT THE ROUTE. The route imports `liveLaunchDeps` directly, so
 * mocking the module to inject the crash would mean the route was no longer using the
 * live deps — the substitution would swallow the thing being proved. Driving the
 * service keeps every port real except the one being failed on purpose. The route's own
 * mapping of this failure to a 502 is covered by `calendar.routes.contract.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "pg";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { CalendarEngine, Result } from "@lyceon/shared";

const PGRST_URL = process.env.CALENDAR_PGRST_URL ?? "";
const JWT_SECRET = process.env.CALENDAR_PGRST_JWT_SECRET ?? "";
const DB_NAME = process.env.CALENDAR_PGRST_DB ?? "calendar_postgrest_ci";
const CAN_RUN = PGRST_URL.length > 0 && JWT_SECRET.length > 0;

const STUDENT_ID = "8a8a8a8a-1111-4111-8111-111111111111";
const VERSION_ID = "8a8a8a8a-2222-4222-8222-222222222222";
const BLOCK_ID = "8a8a8a8a-3333-4333-8333-333333333333";
/** `questions_id_check` is `^SAT(M|RW)[12][A-Z0-9]{6}$` — six chars after the form digit. */
const QUESTIONS = ["SATM1CRR001", "SATM1CRR002", "SATM1CRR003", "SATM1CRR004"] as const;
const DOMAIN = "Algebra";

// ── HS256 JWT, the shape a Supabase service key carries ─────────────────────

function mintJwt(role: string, secret: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({
    role,
    iss: "supabase",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${payload}.${sig}`;
}

/** Rewrites /rest/v1/* to /* and proxies verbatim. Nothing else is altered. */
function startRestShim(upstream: string): Promise<{ url: string; close: () => Promise<void> }> {
  const target = new URL(upstream);
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").replace(/^\/rest\/v1/, "");
    const proxyReq = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: path === "" ? "/" : path,
        method: req.method,
        headers: { ...req.headers, host: target.host },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", () => {
      res.writeHead(502);
      res.end('{"message":"shim upstream error"}');
    });
    req.pipe(proxyReq);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

const describeIf = CAN_RUN ? describe : describe.skip;

if (!CAN_RUN) {
  // process.stdout.write, not console.log: no-console is a hard rule here, and the gate
  // greps stdout for these markers, so they must reach the stream.
  process.stdout.write(
    "CALENDAR-POSTGREST-PROOF: SKIPPED — CALENDAR_PGRST_URL / CALENDAR_PGRST_JWT_SECRET unset\n",
  );
}

describeIf("INV-08-18 — a crashed launch heals into ONE session", () => {
  let pg: Client;
  let shim: { url: string; close: () => Promise<void> };
  let launchBlock: typeof import("../../server/services/calendar/launch-service").launchBlock;
  let launchIdempotencyKey: typeof import("../../server/services/calendar/launch-service").launchIdempotencyKey;
  let liveLaunchDeps: typeof import("../../server/services/calendar/launch-deps").liveLaunchDeps;
  let today: string;

  beforeAll(async () => {
    shim = await startRestShim(PGRST_URL);

    // Set BEFORE the modules are imported. The clients are lazy, so this POINTS the real
    // supabase-js at real PostgREST rather than substituting anything.
    process.env.SUPABASE_URL = shim.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = mintJwt("service_role", JWT_SECRET);
    process.env.SUPABASE_ANON_KEY = mintJwt("anon", JWT_SECRET);
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";

    pg = new Client({
      host: process.env.PGHOST ?? "localhost",
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? "postgres",
      password: process.env.PGPASSWORD ?? "postgres",
      database: DB_NAME,
    });
    await pg.connect();

    // Today in the profile's zone, computed by Postgres so the fixture and the service
    // agree about the date even if the runner's clock sits either side of midnight.
    const { rows } = await pg.query<{ d: string }>(
      "SELECT to_char((now() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS d",
    );
    today = rows[0]?.d ?? "";

    await seed(pg, today);

    ({ launchBlock, launchIdempotencyKey } = await import(
      "../../server/services/calendar/launch-service"
    ));
    ({ liveLaunchDeps } = await import("../../server/services/calendar/launch-deps"));

    process.stdout.write("CALENDAR-POSTGREST-PROOF: EXECUTING\n");
  }, 60_000);

  afterAll(async () => {
    await pg?.end();
    await shim?.close();
    vi.restoreAllMocks();
  });

  const request = () => ({
    student_id: STUDENT_ID,
    actor_id: STUDENT_ID,
    role: "student",
    block_id: BLOCK_ID,
    client_instance_id: "crash-retry-instance",
    platform: "web" as const,
  });

  it("creates the engine session on the first launch", async () => {
    // The crash: `linkLaunch` fails AFTER the engine session exists. This is §18's
    // "Created but link failed" exactly, and it is the one event a test cannot produce
    // by asking politely. Every other port below is liveLaunchDeps' own.
    const crashing = {
      ...liveLaunchDeps,
      linkLaunch: async (): Promise<Result<{ launch_sequence: number; replayed: boolean }, string>> => ({
        ok: false,
        error: "simulated crash between create and link",
      }),
    };

    const first = await launchBlock(request(), crashing);

    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error.kind).toBe("link_failed");

    // The engine session EXISTS — that is what makes the retry a real recovery and not
    // a first attempt wearing a disguise.
    const sessions = await pg.query("SELECT id FROM public.practice_sessions WHERE user_id = $1", [STUDENT_ID]);
    expect(sessions.rowCount).toBe(1);

    // And nothing was recorded against the block.
    const launches = await pg.query("SELECT * FROM public.calendar_block_launches WHERE block_id = $1", [BLOCK_ID]);
    expect(launches.rowCount).toBe(0);
  }, 60_000);

  it("the retry returns the SAME session and lands the launch row", async () => {
    const second = await launchBlock(request(), liveLaunchDeps);

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // ONE session, still. The engine replayed it for the repeated key rather than
    // making a second — which only holds because `seq` is derived from the STORED
    // launch rows, so the retry rebuilt the same key from a database that had
    // forgotten the first attempt.
    const sessions = await pg.query<{ id: string }>(
      "SELECT id FROM public.practice_sessions WHERE user_id = $1",
      [STUDENT_ID],
    );
    expect(sessions.rowCount).toBe(1);
    expect(second.value.session_id).toBe(sessions.rows[0]?.id);
    expect(second.value.engine).toBe<CalendarEngine>("practice");

    // And the link landed this time, at sequence 1 — not 2. A crash must not consume a
    // sequence number, or the key would differ and the engine would make a new session.
    const launches = await pg.query<{ launch_sequence: number; engine_session_id: string }>(
      "SELECT launch_sequence, engine_session_id FROM public.calendar_block_launches WHERE block_id = $1",
      [BLOCK_ID],
    );
    expect(launches.rowCount).toBe(1);
    expect(launches.rows[0]?.launch_sequence).toBe(1);
    expect(launches.rows[0]?.engine_session_id).toBe(second.value.session_id);
  }, 60_000);

  it("the key the engine saw is the one the calendar owns, for sequence 1", async () => {
    // §15.1: `calendar:block:<block_id>:<seq>`. The practice engine stores it as
    // `session_start_idempotency_key` inside `practice_sessions.filters` — the jsonb its
    // OWN replay check reads — so this is what actually crossed the wire, not what the
    // service says it sent.
    const { rows } = await pg.query<{ key: string | null }>(
      "SELECT filters ->> 'session_start_idempotency_key' AS key FROM public.practice_sessions WHERE user_id = $1",
      [STUDENT_ID],
    );
    // Sequence 1, not 2. A crash must not consume a sequence number, or the retry would
    // build a different key and the engine would make a second session.
    expect(rows[0]?.key).toBe(launchIdempotencyKey(BLOCK_ID, 1));
  }, 60_000);

  it("a third launch RESUMES the live session rather than making a second", async () => {
    const third = await launchBlock(request(), liveLaunchDeps);

    expect(third.ok).toBe(true);
    if (!third.ok) return;
    // §15.1 step 3: a live session is handed back, `resumed = true`, and no new link row.
    expect(third.value.resumed).toBe(true);

    const sessions = await pg.query("SELECT id FROM public.practice_sessions WHERE user_id = $1", [STUDENT_ID]);
    expect(sessions.rowCount).toBe(1);
    const launches = await pg.query("SELECT * FROM public.calendar_block_launches WHERE block_id = $1", [BLOCK_ID]);
    expect(launches.rowCount).toBe(1);
  }, 60_000);
});

/**
 * A premium student with a practice block on today, and enough published Math questions
 * for the practice engine to fill a session.
 *
 * Written with `pg` as the superuser rather than through the app: this is arranging the
 * WORLD, not exercising the seam. What must go over the wire is the launch.
 */
async function seed(pg: Client, today: string): Promise<void> {
  await pg.query("DELETE FROM auth.users WHERE id = $1", [STUDENT_ID]);
  await pg.query(
    "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'crash-retry@example.test', '{}'::jsonb)",
    [STUDENT_ID],
  );

  await pg.query(
    `INSERT INTO public.student_study_profile
       (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
     VALUES ($1, 'America/Chicago', 127, 60, 6, 1400, now())`,
    [STUDENT_ID],
  );
  await pg.query(
    "INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')",
    [STUDENT_ID],
  );

  // One accepted version owning today, one practice block on it. Written directly
  // because the GENERATOR is not what this file proves — `calendar-parity.ts` does that,
  // byte-exactly, 6018 times.
  await pg.query(
    `INSERT INTO public.calendar_plan_versions
       (plan_version_id, student_id, version_no, generator_version, trigger, initiated_by,
        input_snapshot, input_snapshot_hash, constants_snapshot, validator_result)
     VALUES ($1, $2, 1, 'v1', 'setup', 'student', '{"profile":{"study_days_mask":127}}', 'h', '{}', 'accepted')`,
    [VERSION_ID, STUDENT_ID],
  );
  await pg.query(
    `INSERT INTO public.calendar_plan_dates (plan_version_id, student_id, scheduled_date, timezone)
     VALUES ($1, $2, $3, 'America/Chicago')`,
    [VERSION_ID, STUDENT_ID, today],
  );
  await pg.query(
    `INSERT INTO public.calendar_blocks
       (block_id, student_id, created_in_version_id, scheduled_date, block_type, section,
        scope, target_count, source, explanation_key)
     VALUES ($1, $2, $3, $4, 'practice', 'M',
             $5::jsonb, 4, 'auto', 'weighted')`,
    [
      BLOCK_ID,
      STUDENT_ID,
      VERSION_ID,
      today,
      JSON.stringify({
        level: "domain",
        mix: [{ domain: DOMAIN, count: 4, explanation_key: "weak" }],
      }),
    ],
  );
  await pg.query(
    `INSERT INTO public.calendar_plan_block_memberships
       (plan_version_id, student_id, scheduled_date, block_id, display_ordinal, membership_type)
     VALUES ($1, $2, $3, $4, 1, 'created')`,
    [VERSION_ID, STUDENT_ID, today, BLOCK_ID],
  );

  // `questions_id_check` is `^SAT(M|RW)[12][A-Z0-9]{6}$`; `skill_codes` is the column
  // (there is no `skill`); and `questions_item_shape_chk` wants exactly four options.
  //
  // THE OPTIONS ARE {key, text} OBJECTS, NOT BARE STRINGS, and that is load-bearing.
  // `parseCanonicalMcOptions` skips any element without both a key and a text, so a
  // `["A","B","C","D"]` fixture parses to ZERO options, `isCanonicalRuntimeQuestion`
  // drops every row, and the practice engine answers 422 `empty_pool` — which is what
  // this fixture did on its first run. The CHECK constraint accepts both shapes, so the
  // database cannot catch it; only actually serving the question can.
  const OPTIONS = JSON.stringify([
    { key: "A", text: "one" },
    { key: "B", text: "two" },
    { key: "C", text: "three" },
    { key: "D", text: "four" },
  ]);
  for (const [index, id] of QUESTIONS.entries()) {
    await pg.query(
      `INSERT INTO public.questions
         (id, section, source_type, domain, skill_codes, difficulty, stem, options,
          correct_answer, explanation, status, published_at)
       VALUES ($1, 'M', 1, $2, '{LIN}', 2, $3, $4::jsonb, 'A', 'e', 'published', now())
       ON CONFLICT (id) DO NOTHING`,
      [id, DOMAIN, `Crash-retry stem ${index + 1}`, OPTIONS],
    );
  }
}
