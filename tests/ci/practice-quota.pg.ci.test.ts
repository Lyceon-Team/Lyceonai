/**
 * The free daily practice quota: Doc 02B §13 clock, the OQ-50 basis, the read and the 402 agreeing.
 *
 * @spec [student-UI register OQ-21, owner ruling (Karl) 2026-10-02: a read-only
 *        `GET /api/practice/quota`, computed by the same function as the 402
 *        (`checkAndReservePracticeQuota`, dry run), built with tests observed failing once;
 *        owner ruling (Karl) 2026-10-03 OQ-43 / F-61: "follow Doc 02B. The quota counts
 *        submitted answers and resets at Chicago midnight. One shared function for the 402 and
 *        the quota read; tests at the day boundary and for served-but-unanswered questions";
 *        Doc 02B §13 "Quota Contract", "Reset Algorithm", "Quota Check Mechanism", "Pre-Cap at
 *        Session Creation", "Zero Quota Remaining", "What Counts Against Quota"; §12 Entitlement
 *        Matrix; Doc 01A §40 `getUsage`; owner ruling (Karl) 2026-10-05 OQ-50: "skips count,
 *        diagnostic doesn't, SCL against Doc 02B" (SCL-209, migration 20261024000000)]
 *        | @implemented [2026-10-03; OQ-50 2026-10-05]
 *
 * plain English: the REAL practice router behind the REAL mount gates (`requireSupabaseAuth`,
 * `requireStudentOrAdmin`, as `server/index.ts` mounts it) and the REAL
 * `check_and_reserve_practice_quota` over real Postgres (genesis + every migration). Only the
 * session is injected, and CSRF is left out. Sessions are started, served and answered through
 * the real routes (`POST /sessions`, `GET /sessions/:id/next`, `POST /answer`, `POST /skip`, and
 * the diagnostic's `POST /diagnostic/sessions`), so the rows the quota counts are the rows
 * production writes:
 *   - a fresh free student: remaining = limit, resetAt = the next America/Chicago midnight
 *     (an oracle computed here with Intl, independent of the SQL);
 *   - a served question consumes nothing; a skip consumes one (OQ-50, Karl 2026-10-05; until
 *     that ruling a skip consumed nothing and this file asserted so); an answer consumes one,
 *     and its idempotent replay nothing more;
 *   - the diagnostic: its answers and skips consume nothing, and its next question is still
 *     served to a free student at the limit (OQ-50), while practice stays refused;
 *   - limit−1 and limit: the read, the `GET /next` 402 and the `POST /sessions` 402 carry the
 *     same limit, remaining and resetAt; the session-start pre-cap equals the read's remaining;
 *   - the day boundary and DST, through the SQL function's `p_now` over real answered and
 *     skipped rows whose `occurred_at` is moved to the instant under test;
 *   - a paid student: unlimited; reading twice writes nothing; 401, guardian 403, admin unlimited.
 * The limit is read from `practice_runtime_config.daily_quota_free`, never written here. The
 * answer route's own per-minute limiter (`answer_rate_limit_max`, a different control) is raised
 * in this throwaway database so that reaching the daily limit through real answers is possible.
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { practiceQuotaSchema } from "../../packages/shared/src/practice-quota";

const DB_NAME = "practice_quota_ci";
const FREE_FRESH = "f2100000-0000-4000-8000-000000000001";
const FREE_SERVED = "f2100000-0000-4000-8000-000000000002";
const FREE_LIMIT = "f2100000-0000-4000-8000-000000000003";
const FREE_TWICE = "f2100000-0000-4000-8000-000000000004";
const PAID = "f2100000-0000-4000-8000-000000000005";
const GUARDIAN = "f2100000-0000-4000-8000-000000000006";
const ADMIN = "f2100000-0000-4000-8000-000000000007";
const FREE_REPLAY = "f2100000-0000-4000-8000-000000000008";
const FREE_CLOCK = "f2100000-0000-4000-8000-000000000009";
/** The seven canonical domains besides Algebra, so the real diagnostic (8 × 5) can start. */
const DIAGNOSTIC_DOMAINS: ReadonlyArray<readonly [string, string, string]> = [
  ["M", "Advanced Math", "ADV.D01"],
  ["M", "Problem Solving and Data Analysis", "PSD.D01"],
  ["M", "Geometry and Trigonometry", "GEO.D01"],
  ["RW", "Information and Ideas", "INI.D01"],
  ["RW", "Craft and Structure", "CAS.D01"],
  ["RW", "Expression of Ideas", "EOI.D01"],
  ["RW", "Standard English Conventions", "SEC.D01"],
];
const CLIENT = "quota-ci";
const QUESTION_COUNT = 60;

let pg: Client;
const session: { id: string | null; role: "student" | "guardian" | "admin" } = {
  id: null,
  role: "student",
};

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => makePgSupabase(pg),
}));

function injectSession(req: Request, _res: Response, next: NextFunction) {
  if (session.id) {
    req.user = {
      id: session.id,
      email: `${session.id}@example.test`,
      display_name: null,
      role: session.role,
      isAdmin: session.role === "admin",
      isGuardian: session.role === "guardian",
      is_under_13: false,
      profile_completed_at: "2026-09-01T00:00:00Z",
      actor_id: session.id,
    };
  }
  next();
}

let cachedApp: express.Express | null = null;
async function app(): Promise<express.Express> {
  if (cachedApp) return cachedApp;
  const { default: practiceRouter } =
    await import("../../server/routes/practice-canonical");
  const { default: diagnosticRouter } =
    await import("../../server/routes/diagnostic-routes");
  const { requireSupabaseAuth, requireStudentOrAdmin } =
    await import("../../server/middleware/supabase-auth");
  const a = express();
  a.use(express.json());
  a.use(injectSession);
  // As server/index.ts mounts it: the diagnostic before the practice router (CSRF left out).
  a.use(
    "/api/practice/diagnostic",
    requireSupabaseAuth,
    requireStudentOrAdmin,
    diagnosticRouter,
  );
  a.use(
    "/api/practice",
    requireSupabaseAuth,
    requireStudentOrAdmin,
    practiceRouter,
  );
  cachedApp = a;
  return a;
}

function as(id: string | null, role: typeof session.role = "student"): void {
  session.id = id;
  session.role = role;
}

async function quotaAs(
  id: string | null,
  role: typeof session.role = "student",
) {
  as(id, role);
  return request(await app()).get("/api/practice/quota");
}

async function readQuota(studentId: string) {
  const res = await quotaAs(studentId);
  expect(res.status).toBe(200);
  return practiceQuotaSchema.parse(res.body);
}

/** One question served: the reservation `GET /sessions/:id/next` makes for the item it serves. */
async function serveOne(studentId: string) {
  const { checkAndReservePracticeQuota } =
    await import("../../apps/api/src/lib/rate-limit-ledger");
  return checkAndReservePracticeQuota({
    studentUserId: studentId,
    role: "student",
    sessionId: null,
    sessionItemId: randomUUID(),
    dryRun: false,
    requestId: null,
  });
}

async function startSession(studentId: string, target: number) {
  as(studentId);
  return request(await app())
    .post("/api/practice/sessions")
    .send({
      target_question_count: target,
      client_instance_id: CLIENT,
      idempotency_key: randomUUID(),
    });
}

async function nextItem(studentId: string, sessionId: string) {
  as(studentId);
  return request(await app()).get(
    `/api/practice/sessions/${sessionId}/next?client_instance_id=${CLIENT}`,
  );
}

/** The session's currently served item and the option token of its correct answer. */
async function servedItem(
  sessionId: string,
): Promise<{ id: string; token: string }> {
  const r = await pg.query(
    `SELECT id, option_token_map, question_correct_answer
       FROM public.practice_session_items
      WHERE session_id = $1 AND status = 'served'`,
    [sessionId],
  );
  expect(r.rows).toHaveLength(1);
  const row = r.rows[0] as {
    id: string;
    option_token_map: Record<string, string>;
    question_correct_answer: string;
  };
  const hit = Object.entries(row.option_token_map).find(
    ([, key]) => key === row.question_correct_answer,
  );
  if (!hit) throw new Error(`no token for the correct answer of ${row.id}`);
  return { id: row.id, token: hit[0] };
}

async function answer(
  studentId: string,
  sessionId: string,
  item: { id: string; token: string },
  clientAttemptId: string = randomUUID(),
) {
  as(studentId);
  return request(await app())
    .post("/api/practice/answer")
    .send({
      sessionId,
      sessionItemId: item.id,
      selectedAnswer: item.token,
      clientAttemptId,
      client_instance_id: CLIENT,
    });
}

/** Answer the served item of a session through the real route, expecting success. */
async function answerServed(studentId: string, sessionId: string) {
  const item = await servedItem(sessionId);
  const res = await answer(studentId, sessionId, item);
  expect(res.status).toBe(200);
  return item;
}

/** Skip a served item through the real route, expecting success. */
async function skip(studentId: string, sessionId: string, itemId: string) {
  as(studentId);
  const res = await request(await app())
    .post(`/api/practice/sessions/${sessionId}/skip`)
    .send({
      sessionItemId: itemId,
      clientAttemptId: randomUUID(),
      client_instance_id: CLIENT,
    });
  expect(res.status).toBe(200);
  expect(res.body.skipped).toBe(true);
  return res;
}

/** Answered plus skipped items of the student: the rows the free quota counts (OQ-50). */
async function resolvedCount(studentId: string): Promise<number> {
  const r = await pg.query(
    `SELECT count(*)::int AS n FROM public.practice_session_items
      WHERE user_id = $1 AND status IN ('answered', 'skipped')`,
    [studentId],
  );
  return Number(r.rows[0]?.n);
}

async function answeredCount(studentId: string): Promise<number> {
  const r = await pg.query(
    `SELECT count(*)::int AS n FROM public.practice_session_items
      WHERE user_id = $1 AND status = 'answered'`,
    [studentId],
  );
  return Number(r.rows[0]?.n);
}

async function ledgerRows(studentId: string): Promise<number> {
  const r = await pg.query(
    `SELECT count(*)::int AS n FROM public.usage_rate_limit_ledger WHERE student_user_id = $1`,
    [studentId],
  );
  return Number(r.rows[0]?.n);
}

type SqlDecision = {
  allowed: boolean;
  code: string;
  current: number;
  limit: number;
  remaining: number;
  reset_at: string;
};

/** The SQL function's dry run at a chosen instant (`p_now`), the one way to test the clock. */
async function dryRunAt(
  studentId: string,
  nowIso: string,
): Promise<SqlDecision> {
  const r = await pg.query(
    `SELECT public.check_and_reserve_practice_quota(
       $1::uuid, NULL::uuid, NULL::uuid, NULL::uuid, true, NULL::text, $2::timestamptz) AS d`,
    [studentId, nowIso],
  );
  return r.rows[0].d as SqlDecision;
}

/**
 * The next America/Chicago midnight after `at`, as an epoch ms — computed with Intl, not with
 * the SQL under test. Chicago's offset is −5 or −6 hours, so the instant is 05:00Z or 06:00Z of
 * the next local date; the one that reads 00:00 in Chicago is it.
 */
function nextChicagoMidnight(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? NaN);
  const y = get("year");
  const m = get("month");
  const d = get("day");
  for (const offsetHours of [5, 6]) {
    const candidate = new Date(Date.UTC(y, m - 1, d + 1, offsetHours));
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Chicago",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(candidate);
    if (local === "00:00") return candidate.getTime();
  }
  throw new Error("no Chicago midnight found");
}

let dailyLimit = 0;

describe.skipIf(!PG_AVAILABLE)(
  "Practice free quota (OQ-21 read, OQ-43 Doc 02B §13 rule) — real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const [id, role] of [
        [FREE_FRESH, "student"],
        [FREE_SERVED, "student"],
        [FREE_LIMIT, "student"],
        [FREE_TWICE, "student"],
        [PAID, "student"],
        [GUARDIAN, "guardian"],
        [ADMIN, "admin"],
        [FREE_REPLAY, "student"],
        [FREE_CLOCK, "student"],
      ] as const) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          `${id}@example.test`,
        ]);
        await pg.query(
          `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
         VALUES ($1, $2, $3, 'Someone', '2008-01-01'::date)`,
          [id, `${id}@example.test`, role],
        );
      }
      await pg.query(
        `INSERT INTO public.entitlements
         (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id, current_period_end)
       VALUES ($1, 'premium', 'active', 'sub_oq21', 'si_oq21', now() + interval '20 days')`,
        [PAID],
      );
      // A published pool large enough for one student to hold two sessions (limit + 5 items).
      for (let i = 1; i <= QUESTION_COUNT; i += 1) {
        const id = `SATM1Q${String(i).padStart(5, "0")}`;
        await pg.query(
          `INSERT INTO public.questions
             (id, section, source_type, domain, skill_codes, difficulty, stem, options,
              correct_answer, explanation, option_metadata, status, item_type, published_at)
           VALUES ($1,'M',1,'Algebra',ARRAY['ALG.D01'],2,$2,
             '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
             'B',$3,
             '{"A":{"role":"distractor"},"B":{"role":"correct"},"C":{"role":"distractor"},"D":{"role":"distractor"}}'::jsonb,
             'published','mcq', now())`,
          [id, `Stem ${id}`, `Expl ${id}`],
        );
      }
      // Five questions in each of the other seven canonical domains, so the real diagnostic
      // start finds its 8 × 5 (Algebra is covered by the pool above).
      for (const [
        d,
        [section, domain, skill],
      ] of DIAGNOSTIC_DOMAINS.entries()) {
        for (let i = 1; i <= 5; i += 1) {
          const id = `SAT${section}1D${d}${String(i).padStart(4, "0")}`;
          await pg.query(
            `INSERT INTO public.questions
               (id, section, source_type, domain, skill_codes, difficulty, stem, options,
                correct_answer, explanation, option_metadata, status, item_type, published_at)
             VALUES ($1,$2,1,$3,$4,$5,$6,
               '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
               'B',$7,
               '{"A":{"role":"distractor"},"B":{"role":"correct"},"C":{"role":"distractor"},"D":{"role":"distractor"}}'::jsonb,
               'published','mcq', now())`,
            [
              id,
              section,
              domain,
              [skill],
              (i % 3) + 1,
              `Stem ${id}`,
              `Expl ${id}`,
            ],
          );
        }
      }
      await pg.query(
        `UPDATE public.practice_runtime_config SET value = '1000'::jsonb
          WHERE key = 'answer_rate_limit_max'`,
      );
      const cfg = await pg.query(
        `SELECT value FROM public.practice_runtime_config WHERE key = 'daily_quota_free'`,
      );
      dailyLimit = Number.parseInt(String(cfg.rows[0]?.value), 10);
    }, 120_000);

    afterAll(async () => {
      await pg?.end();
    });

    it("a fresh free student: remaining = limit, reset at the next America/Chicago midnight", async () => {
      // Presence before absence: the configured limit is a real number, or nothing below means much.
      expect(Number.isInteger(dailyLimit)).toBe(true);
      expect(dailyLimit).toBeGreaterThan(1);
      const before = new Date();
      const quota = await readQuota(FREE_FRESH);
      expect(quota.unlimited).toBe(false);
      expect(quota.limit).toBe(dailyLimit);
      expect(quota.remaining).toBe(dailyLimit);
      expect(Date.parse(String(quota.resetAt))).toBe(
        nextChicagoMidnight(before),
      );
    });

    it("a served question consumes nothing; a skip consumes one; a submitted answer consumes one", async () => {
      const started = await startSession(FREE_SERVED, 3);
      expect(started.status).toBe(200);
      const sessionId = String(started.body.sessionId);
      // Presence: the session start really served an item and wrote its serve-log row.
      const first = await servedItem(sessionId);
      expect(await ledgerRows(FREE_SERVED)).toBe(1);
      expect((await readQuota(FREE_SERVED)).remaining).toBe(dailyLimit);

      // Re-requesting the served item, then skipping it. OQ-50 (Karl, 2026-10-05): a skip
      // counts. Until that ruling this asserted `remaining = limit` here — the ruling changed,
      // the test did not weaken.
      expect((await nextItem(FREE_SERVED, sessionId)).status).toBe(200);
      await skip(FREE_SERVED, sessionId, first.id);
      const skippedRow = await pg.query(
        `SELECT status FROM public.practice_session_items WHERE id = $1`,
        [first.id],
      );
      expect(skippedRow.rows[0].status).toBe("skipped");
      expect((await readQuota(FREE_SERVED)).remaining).toBe(dailyLimit - 1);

      // The next question served: nothing more consumed.
      expect((await nextItem(FREE_SERVED, sessionId)).status).toBe(200);
      expect(await ledgerRows(FREE_SERVED)).toBe(2);
      expect((await readQuota(FREE_SERVED)).remaining).toBe(dailyLimit - 1);

      // Submitted: one more consumed.
      await answerServed(FREE_SERVED, sessionId);
      expect(await answeredCount(FREE_SERVED)).toBe(1);
      expect(await resolvedCount(FREE_SERVED)).toBe(2);
      expect((await readQuota(FREE_SERVED)).remaining).toBe(dailyLimit - 2);
    });

    it("an idempotent replay of the same answer counts once", async () => {
      const started = await startSession(FREE_REPLAY, 2);
      expect(started.status).toBe(200);
      const sessionId = String(started.body.sessionId);
      const item = await servedItem(sessionId);
      const attempt = randomUUID();
      const first = await answer(FREE_REPLAY, sessionId, item, attempt);
      expect(first.status).toBe(200);
      expect((await readQuota(FREE_REPLAY)).remaining).toBe(dailyLimit - 1);
      const replay = await answer(FREE_REPLAY, sessionId, item, attempt);
      expect(replay.status).toBe(200);
      expect(replay.body.idempotentRetried).toBe(true);
      const again = await answer(FREE_REPLAY, sessionId, item, attempt);
      expect(again.status).toBe(200);
      expect(await answeredCount(FREE_REPLAY)).toBe(1);
      expect((await readQuota(FREE_REPLAY)).remaining).toBe(dailyLimit - 1);
    });

    it("limit−1 and limit: the read, the GET /next 402 and the POST /sessions 402 agree", async () => {
      // Session A holds `limit` items, B five; both started at full quota (serving consumes none).
      const a = await startSession(FREE_LIMIT, dailyLimit);
      expect(a.status).toBe(200);
      expect(a.body.targetQuestionCount).toBe(dailyLimit);
      const b = await startSession(FREE_LIMIT, 5);
      expect(b.status).toBe(200);
      const sessionA = String(a.body.sessionId);
      const sessionB = String(b.body.sessionId);

      // B's first question is SKIPPED, not answered: a skip uses quota (OQ-50), so the limit
      // below is reached with limit − 1 answers and one skip.
      await skip(FREE_LIMIT, sessionB, (await servedItem(sessionB)).id);
      for (let i = 1; i <= dailyLimit - 2; i += 1) {
        await answerServed(FREE_LIMIT, sessionA);
        const served = await nextItem(FREE_LIMIT, sessionA);
        expect(served.status).toBe(200);
      }
      // limit − 1 resolved (limit − 2 answers, one skip), one more question of A on screen.
      expect(await answeredCount(FREE_LIMIT)).toBe(dailyLimit - 2);
      expect(await resolvedCount(FREE_LIMIT)).toBe(dailyLimit - 1);
      const almost = await readQuota(FREE_LIMIT);
      expect(almost).toMatchObject({ unlimited: false, remaining: 1 });
      // The session-start pre-cap uses the same number: a request for 5 is capped to 1.
      const capped = await startSession(FREE_LIMIT, 5);
      expect(capped.status).toBe(200);
      expect(capped.body.targetQuestionCount).toBe(almost.remaining);
      const sessionC = String(capped.body.sessionId);

      await answerServed(FREE_LIMIT, sessionA); // limit resolved
      expect(await resolvedCount(FREE_LIMIT)).toBe(dailyLimit);
      const quota = await readQuota(FREE_LIMIT);
      expect(quota.unlimited).toBe(false);
      expect(quota.remaining).toBe(0);
      expect(quota.limit).toBe(dailyLimit);

      // GET /next on A: 402 with the read's numbers; the refused item goes back to pending.
      const refusedNext = await nextItem(FREE_LIMIT, sessionA);
      expect(refusedNext.status).toBe(402);
      expect(refusedNext.body).toMatchObject({
        code: "PRACTICE_FREE_DAILY_QUOTA_EXCEEDED",
        limit: quota.limit,
        remaining: quota.remaining,
        resetAt: quota.resetAt,
      });
      const pendingA = await pg.query(
        `SELECT count(*)::int AS n FROM public.practice_session_items
          WHERE session_id = $1 AND status = 'pending'`,
        [sessionA],
      );
      expect(Number(pendingA.rows[0].n)).toBe(1);
      expect((await nextItem(FREE_LIMIT, sessionB)).status).toBe(402);

      const start = await startSession(FREE_LIMIT, 5);
      expect(start.status).toBe(402);
      expect(start.body).toMatchObject({
        code: "PRACTICE_FREE_DAILY_QUOTA_EXCEEDED",
        limit: quota.limit,
        remaining: quota.remaining,
        resetAt: quota.resetAt,
      });

      // Doc 02B §13 refuses at session start and next question, not at submit: the question C
      // put on screen at limit−1 can still be answered (OQ-50 (b), not ruled; kept). The read
      // then floors at 0.
      await answerServed(FREE_LIMIT, sessionC);
      expect(await resolvedCount(FREE_LIMIT)).toBe(dailyLimit + 1);
      expect((await readQuota(FREE_LIMIT)).remaining).toBe(0);
    });

    it("the diagnostic: answers and skips consume nothing, and it is served past the limit (OQ-50)", async () => {
      // FREE_LIMIT is past the limit (the test above): practice is refused, as the control.
      const before = await dryRunAt(FREE_LIMIT, new Date().toISOString());
      expect(before.current).toBe(dailyLimit + 1);
      expect(before.allowed).toBe(false);

      as(FREE_LIMIT);
      const started = await request(await app())
        .post("/api/practice/diagnostic/sessions")
        .send({ client_instance_id: CLIENT, idempotency_key: randomUUID() });
      expect(started.status).toBe(201);
      const diagId = String(started.body.sessionId);
      const mode = await pg.query(
        `SELECT mode FROM public.practice_sessions WHERE id = $1`,
        [diagId],
      );
      expect(mode.rows[0].mode).toBe("diagnostic");

      // A diagnostic answer: one more answered row, nothing consumed.
      await answerServed(FREE_LIMIT, diagId);
      expect(await resolvedCount(FREE_LIMIT)).toBe(dailyLimit + 2);
      expect(
        (await dryRunAt(FREE_LIMIT, new Date().toISOString())).current,
      ).toBe(dailyLimit + 1);

      // The diagnostic's next question is served to a free student at the limit...
      const nextDiag = await nextItem(FREE_LIMIT, diagId);
      expect(nextDiag.status).toBe(200);
      // ...while practice is still refused with the read's numbers.
      const quota = await readQuota(FREE_LIMIT);
      expect(quota.remaining).toBe(0);
      const startPractice = await startSession(FREE_LIMIT, 5);
      expect(startPractice.status).toBe(402);
      expect(startPractice.body).toMatchObject({
        code: "PRACTICE_FREE_DAILY_QUOTA_EXCEEDED",
        limit: quota.limit,
        remaining: quota.remaining,
        resetAt: quota.resetAt,
      });

      // A diagnostic skip: one more skipped row, nothing consumed.
      await skip(FREE_LIMIT, diagId, (await servedItem(diagId)).id);
      expect(await resolvedCount(FREE_LIMIT)).toBe(dailyLimit + 3);
      expect(
        (await dryRunAt(FREE_LIMIT, new Date().toISOString())).current,
      ).toBe(dailyLimit + 1);
      expect((await nextItem(FREE_LIMIT, diagId)).status).toBe(200);
    });

    it("the day boundary: 23:59 Chicago counts toward that day, 00:00 Chicago resets, UTC days do not", async () => {
      const started = await startSession(FREE_CLOCK, 4);
      expect(started.status).toBe(200);
      const sessionId = String(started.body.sessionId);
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        if (i > 0)
          expect((await nextItem(FREE_CLOCK, sessionId)).status).toBe(200);
        if (i === 2) {
          // The 23:59 row is a SKIP: it counts toward its Chicago day like an answer (OQ-50).
          const item = await servedItem(sessionId);
          await skip(FREE_CLOCK, sessionId, item.id);
          ids.push(item.id);
        } else {
          ids.push((await answerServed(FREE_CLOCK, sessionId)).id);
        }
      }
      expect(await answeredCount(FREE_CLOCK)).toBe(3);
      expect(await resolvedCount(FREE_CLOCK)).toBe(4);
      // Real resolved rows, their `occurred_at` moved to the instants under test (CDT = UTC−5 on
      // 2026-10-02/03). `answered_at` is deliberately LEFT at the real resolution time: the
      // window is on `occurred_at` (OQ-50 migration; CHECK psi_resolved_requires_occurred_at
      // guarantees it, nothing guarantees `answered_at`), and a fixture that moved both could
      // not tell the two columns apart.
      const moves: Array<[string, string]> = [
        [ids[0]!, "2026-10-02T23:00:00Z"], // 18:00 Chicago Oct 2, UTC Oct 2
        [ids[1]!, "2026-10-03T03:00:00Z"], // 22:00 Chicago Oct 2, UTC Oct 3
        [ids[2]!, "2026-10-03T04:59:00Z"], // 23:59 Chicago Oct 2, UTC Oct 3 (the skip)
        [ids[3]!, "2026-11-02T05:30:00Z"], // 23:30 Chicago Nov 1 (CST), UTC Nov 2
      ];
      for (const [id, at] of moves) {
        await pg.query(
          `UPDATE public.practice_session_items SET occurred_at = $2::timestamptz WHERE id = $1`,
          [id, at],
        );
      }

      // Morning of Chicago Oct 2 (still UTC Oct 2): all three Oct-2 answers count.
      const morning = await dryRunAt(FREE_CLOCK, "2026-10-02T12:00:00Z");
      expect(morning.current).toBe(3);
      expect(morning.remaining).toBe(dailyLimit - 3);
      // 23:59:30 Chicago Oct 2: the 23:59 answer counts toward Oct 2; reset is 00:00 Chicago.
      const lastMinute = await dryRunAt(FREE_CLOCK, "2026-10-03T04:59:30Z");
      expect(lastMinute.current).toBe(3);
      expect(Date.parse(lastMinute.reset_at)).toBe(
        Date.parse("2026-10-03T05:00:00Z"),
      );
      // 00:00 Chicago Oct 3: reset.
      const midnight = await dryRunAt(FREE_CLOCK, "2026-10-03T05:00:00Z");
      expect(midnight.current).toBe(0);
      expect(midnight.remaining).toBe(dailyLimit);
      expect(Date.parse(midnight.reset_at)).toBe(
        Date.parse("2026-10-04T05:00:00Z"),
      );
      // 03:30 UTC Oct 3 is 22:30 Chicago Oct 2: the UTC day has turned, the Chicago day has not.
      const utcTurned = await dryRunAt(FREE_CLOCK, "2026-10-03T03:30:00Z");
      expect(utcTurned.current).toBe(3);
      // UTC Oct 3 noon: two of these answers are on UTC Oct 3, none on Chicago Oct 3.
      const utcSameDay = await dryRunAt(FREE_CLOCK, "2026-10-03T12:00:00Z");
      expect(utcSameDay.current).toBe(0);
    });

    it("DST: resetAt is the next local midnight on transition days, and the 25-hour day counts whole", async () => {
      // Fall back (2026-11-01, CDT→CST): the day began 05:00Z and resets 06:00Z next day.
      const fallBack = await dryRunAt(FREE_CLOCK, "2026-11-01T12:00:00Z");
      expect(Date.parse(fallBack.reset_at)).toBe(
        Date.parse("2026-11-02T06:00:00Z"),
      );
      expect(Date.parse(fallBack.reset_at)).toBe(
        nextChicagoMidnight(new Date("2026-11-01T12:00:00Z")),
      );
      // The 23:30 CST answer (05:30Z Nov 2) is still Nov 1 in Chicago; a fixed −5h offset would
      // put it on Nov 2.
      expect(fallBack.current).toBe(1);
      const afterReset = await dryRunAt(FREE_CLOCK, "2026-11-02T06:00:00Z");
      expect(afterReset.current).toBe(0);
      // Spring forward (2026-03-08, CST→CDT): the day began 06:00Z and resets 05:00Z next day.
      const springForward = await dryRunAt(FREE_CLOCK, "2026-03-08T12:00:00Z");
      expect(Date.parse(springForward.reset_at)).toBe(
        Date.parse("2026-03-09T05:00:00Z"),
      );
      expect(Date.parse(springForward.reset_at)).toBe(
        nextChicagoMidnight(new Date("2026-03-08T12:00:00Z")),
      );
    });

    it("a paid student: unlimited, also after questions served", async () => {
      await serveOne(PAID);
      await serveOne(PAID);
      const res = await quotaAs(PAID);
      expect(res.status).toBe(200);
      expect(practiceQuotaSchema.parse(res.body)).toEqual({
        unlimited: true,
        limit: null,
        remaining: null,
        resetAt: null,
      });
    });

    it("reading twice consumes nothing: no ledger row, remaining unchanged", async () => {
      await serveOne(FREE_TWICE);
      const before = await ledgerRows(FREE_TWICE);
      expect(before).toBe(1);
      const first = await quotaAs(FREE_TWICE);
      const second = await quotaAs(FREE_TWICE);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await ledgerRows(FREE_TWICE)).toBe(before);
      expect(first.body.remaining).toBe(dailyLimit);
      expect(second.body).toEqual(first.body);
    });

    it("no session: 401, no quota body", async () => {
      const res = await quotaAs(null);
      expect(res.status).toBe(401);
      expect(res.body).not.toHaveProperty("remaining");
    });

    it("a guardian: 403 at the student gate, no quota body, no ledger row", async () => {
      const res = await quotaAs(GUARDIAN, "guardian");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Student access required");
      expect(res.body).not.toHaveProperty("remaining");
      expect(await ledgerRows(GUARDIAN)).toBe(0);
    });

    it("an admin: unlimited (the enforcement's admin bypass), no ledger row", async () => {
      const res = await quotaAs(ADMIN, "admin");
      expect(res.status).toBe(200);
      expect(practiceQuotaSchema.parse(res.body)).toEqual({
        unlimited: true,
        limit: null,
        remaining: null,
        resetAt: null,
      });
      expect(await ledgerRows(ADMIN)).toBe(0);
    });
  },
);
