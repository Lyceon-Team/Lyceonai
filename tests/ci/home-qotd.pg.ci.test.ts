/**
 * The Question of the Day on Home, the daily streak, the daily email and the SAT test dates —
 * against real Postgres (genesis + every migration).
 *
 * @spec [owner brief "Question of the Day on Home, daily streak, email, SAT dates in onboarding"
 *       (Karl, decisions 2026-10-08/09) "Acceptance" 1-9; SCL-223 (test dates), SCL-224 (the QOTD
 *       as a practice answer, outside the free daily 40), SCL-225 (consent purpose), SCL-226 (the
 *       streak); Coding Standards §5.2, §4.2, §14] | @implemented [2026-10-09]
 *
 * plain English: the REAL routes (/api/qotd behind the real student gates, the public
 * unsubscribe router), the REAL services and the REAL SQL, over the shared `makePgSupabase`
 * transport. Only the session is injected and CSRF is left out. Clock-dependent rules are proved
 * through the SQL functions' own `p_now`, at instants either side of America/Chicago midnight in
 * summer (CDT) and winter (CST), and the email job at 17:00 Chicago in both.
 *
 * Acceptance map:
 *   A1 one QOTD per Chicago day: replay-safe, 409 on a second answer, midnight summer + winter
 *   A2 no answer or explanation before submit
 *   A3 the answer is a practice item + mastery event; a miss enters review; not in the free 40
 *   A4 streak: each source extends it; a missed day resets it
 *   A5 prompt: after every answer until granted; "Don't ask again" from the 3rd ask; never for
 *      under-13s; a grant writes consent with a version
 *   A6 email job: ≤1 per student per day; skipped if answered / paused / unsubscribed; the
 *      7-send sunset; 17:00 Chicago across DST
 *   A7 unsubscribe: no sign-in; a tampered link is refused
 *   A8 test dates: several stored; the effective date is the closest future one; saving dates
 *      does not complete calendar setup; past dates refused
 *   A9 account deletion removes attempts, sends, prompt state and test dates
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import {
  homeQotdAnswerResponseSchema,
  homeQotdTodayResponseSchema,
  QOTD_EMAIL_CONSENT_VERSION,
} from "../../packages/shared/src/home-qotd-schema";
import { chicagoToday } from "../../shared/sat-test-dates";

process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET = "home-qotd-ci-secret";

const DB_NAME = "home_qotd_ci";
const ANSWERER = "a7000000-0000-4000-8000-000000000001";
const REPLAYER = "a7000000-0000-4000-8000-000000000002";
const PROMPTED = "a7000000-0000-4000-8000-000000000003";
const UNDER13 = "a7000000-0000-4000-8000-000000000004";
const GUARDIAN = "a7000000-0000-4000-8000-000000000005";
const STREAKER = "a7000000-0000-4000-8000-000000000006";
const MAILED = "a7000000-0000-4000-8000-000000000007";
const MAILED_ANSWERED = "a7000000-0000-4000-8000-000000000008";
const MAILED_SUNSET = "a7000000-0000-4000-8000-000000000009";
const MAILED_UNSUB = "a7000000-0000-4000-8000-00000000000a";
const DATES = "a7000000-0000-4000-8000-00000000000b";
const DELETED = "a7000000-0000-4000-8000-00000000000c";
const NEVERER = "a7000000-0000-4000-8000-00000000000d";

const TODAY_Q = "SATM1Q90001";
const SUMMER_Q = "SATM1Q90002";
const WINTER_Q = "SATM1Q90003";
const STEM = "If 3x + 2 = 11, what is the value of x?";
const EXPLANATION = "Subtract 2 then divide by 3: x = 3.";
/** Summer (CDT, UTC-5) and winter (CST, UTC-6) days with their own scheduled question. */
const SUMMER_DAY = "2026-07-14";
const WINTER_DAY = "2026-01-14";

let pg: Client;
const session: {
  id: string | null;
  role: "student" | "guardian";
  under13: boolean;
} = { id: null, role: "student", under13: false };
const emitted: { name: string; payload: Record<string, unknown> }[] = [];
const logs: string[] = [];

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
vi.mock("../../server/lib/analytics/emit-event", () => ({
  emitEvent: async (
    _id: string,
    name: string,
    payload: Record<string, unknown>,
  ) => {
    emitted.push({ name, payload });
    return { ok: true };
  },
}));
vi.mock("../../server/logger", () => {
  const record = (...args: unknown[]): void => {
    logs.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  };
  return {
    logger: { info: record, warn: record, error: record, debug: record },
  };
});

function injectSession(req: Request, _res: Response, next: NextFunction) {
  if (session.id) {
    req.user = {
      id: session.id,
      email: `${session.id}@example.test`,
      display_name: null,
      role: session.role,
      isAdmin: false,
      isGuardian: session.role === "guardian",
      is_under_13: session.under13,
      profile_completed_at: "2026-09-01T00:00:00Z",
      actor_id: session.id,
    };
  }
  next();
}

let cachedApp: express.Express | null = null;
async function app(): Promise<express.Express> {
  if (cachedApp) return cachedApp;
  const { createHomeQotdRouter } =
    await import("../../server/routes/home-qotd-routes");
  const { createPublicQotdEmailRouter } =
    await import("../../server/routes/public-qotd-email-routes");
  const { requireSupabaseAuth, requireStudentAccount } =
    await import("../../server/middleware/supabase-auth");
  const a = express();
  a.use(express.json());
  a.use(injectSession);
  // As server/index.ts mounts them (CSRF left out).
  a.use(
    "/api/qotd",
    requireSupabaseAuth,
    requireStudentAccount,
    createHomeQotdRouter(),
  );
  a.use(
    "/api/public/qotd-email",
    createPublicQotdEmailRouter(() => makePgSupabase(pg)),
  );
  cachedApp = a;
  return a;
}

function as(
  id: string | null,
  role: "student" | "guardian" = "student",
  under13 = false,
): void {
  session.id = id;
  session.role = role;
  session.under13 = under13;
}

async function getToday(id: string) {
  as(id);
  const res = await request(await app()).get("/api/qotd/today");
  expect(res.status).toBe(200);
  return { res, body: homeQotdTodayResponseSchema.parse(res.body.data) };
}

async function postAnswer(
  id: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  as(id);
  return request(await app())
    .post("/api/qotd/answer")
    .send(body);
}

async function consent(id: string, decision: string) {
  as(id);
  return request(await app())
    .post("/api/qotd/email-consent")
    .send({ decision, consent_version: QOTD_EMAIL_CONSENT_VERSION });
}

/** The option token whose canonical key is `key`, read from the served question's order. */
async function tokenFor(id: string, letter: "A" | "B" | "C" | "D") {
  const { body } = await getToday(id);
  if (body.state !== "unanswered") throw new Error(`state ${body.state}`);
  const index = ["A", "B", "C", "D"].indexOf(letter);
  const token = body.question.options[index]?.id;
  if (!token) throw new Error("no token");
  return { token, qotdDate: body.qotd_date };
}

async function seedPerson(
  id: string,
  role: "student" | "guardian",
  dob: string,
): Promise<void> {
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    id,
    `${id}@example.test`,
  ]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
     VALUES ($1, $2, $3, 'Someone', $4::date)`,
    [id, `${id}@example.test`, role, dob],
  );
}

async function seedQuestion(id: string): Promise<void> {
  await pg.query(
    `INSERT INTO public.questions
       (id, section, source_type, domain, skill_codes, difficulty, stem, options,
        correct_answer, explanation, option_metadata, status, item_type, published_at)
     VALUES ($1,'M',1,'Algebra',ARRAY['ALG.D01'],2,$2,
       '[{"key":"A","text":"2"},{"key":"B","text":"3"},{"key":"C","text":"4"},{"key":"D","text":"5"}]'::jsonb,
       'B',$3,
       '{"A":{"role":"distractor"},"B":{"role":"correct"},"C":{"role":"distractor"},"D":{"role":"distractor"}}'::jsonb,
       'published','mcq', now())`,
    [id, STEM, EXPLANATION],
  );
}

/** One answered question from `source` at instant `at`, as that source stores it. */
async function seedAnswer(
  source: "practice" | "review" | "full_length",
  studentId: string,
  at: string,
): Promise<void> {
  // Replica role: the seed is the row the source writes, without the side effects (queues,
  // mastery) that are not what a streak test is about. CHECK constraints still apply.
  await pg.query(`SET session_replication_role = replica`);
  try {
    if (source === "practice") {
      const s = randomUUID();
      await pg.query(
        `INSERT INTO public.practice_sessions (id, user_id, actor_id, mode, target_count, platform, status)
         VALUES ($1, $2, $2, 'balanced', 1, 'web', 'completed')`,
        [s, studentId],
      );
      await pg.query(
        `INSERT INTO public.practice_session_items
           (session_id, user_id, actor_id, ordinal, question_id, question_stem, question_options,
            question_correct_answer, question_explanation, question_domain, question_skill,
            question_difficulty, question_section, question_item_type, status, is_correct,
            selected_answer, occurred_at, answered_at)
         VALUES ($1, $2, $2, 1, $3, 's', '[]'::jsonb, 'B', 'e', 'Algebra', 'ALG.D01', 2, 'M',
                 'mcq', 'answered', true, 'B', $4, $4)`,
        [s, studentId, TODAY_Q, at],
      );
    } else if (source === "review") {
      const s = randomUUID();
      await pg.query(
        `INSERT INTO public.review_sessions (id, student_id, actor_id, mode, target_count, platform, status)
         VALUES ($1, $2, $2, 'queue', 1, 'web', 'completed')`,
        [s, studentId],
      );
      await pg.query(
        `INSERT INTO public.review_session_items
           (session_id, student_id, actor_id, ordinal, question_id, question_stem, question_options,
            question_correct_answer, question_explanation, question_domain, question_skill,
            question_difficulty, question_section, question_item_type, status, is_correct,
            selected_answer, occurred_at, answered_at)
         VALUES ($1, $2, $2, 1, $3, 's', '[]'::jsonb, 'B', 'e', 'Algebra', 'ALG.D01', 2, 'M',
                 'mcq', 'answered', true, 'B', $4, $4)`,
        [s, studentId, TODAY_Q, at],
      );
    } else {
      const t = randomUUID();
      await pg.query(
        `INSERT INTO public.test_sessions
           (id, student_id, actor_id, test_form_id, state, mode, grace_expires_at,
            attempt_number_for_form, is_first_seen_form_attempt)
         VALUES ($1, $2, $2, gen_random_uuid(), 'created', 'strict', now(), 1, true)`,
        [t, studentId],
      );
      await pg.query(
        `INSERT INTO public.test_answer_submissions
           (test_session_id, idempotency_key, section, module, ordinal, question_id,
            response_json, response_schema_version, was_canonical_update, answer, created_at)
         VALUES ($1, $2, 'M', '1', 1, $3, '{}'::jsonb, '1', false, 'B', $4)`,
        [t, randomUUID(), TODAY_Q, at],
      );
    }
  } finally {
    await pg.query(`SET session_replication_role = origin`);
  }
}

type StreakRow = {
  current_streak: number;
  today_done: boolean;
  broken: boolean;
};
async function streakAt(id: string, nowIso: string): Promise<StreakRow> {
  const r = await pg.query<StreakRow>(
    `SELECT * FROM public.student_streak($1, $2::timestamptz)`,
    [id, nowIso],
  );
  const row = r.rows[0];
  if (!row) throw new Error("no streak row");
  return row;
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const r = await pg.query<{ n: number }>(sql, params);
  return Number(r.rows[0]?.n ?? 0);
}

describe.skipIf(!PG_AVAILABLE)(
  "Home QOTD, streak, daily email, SAT dates — real Postgres",
  () => {
    const today = chicagoToday();

    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const id of [
        ANSWERER,
        REPLAYER,
        PROMPTED,
        STREAKER,
        MAILED,
        MAILED_ANSWERED,
        MAILED_SUNSET,
        MAILED_UNSUB,
        DATES,
        DELETED,
        NEVERER,
      ]) {
        await seedPerson(id, "student", "2008-01-01");
      }
      await seedPerson(UNDER13, "student", "2016-01-01");
      await seedPerson(GUARDIAN, "guardian", "1980-01-01");
      for (const q of [TODAY_Q, SUMMER_Q, WINTER_Q]) await seedQuestion(q);
      await pg.query(
        `INSERT INTO public.qotd_schedule (qotd_date, question_id) VALUES ($1, $2), ($3, $4), ($5, $6)`,
        [today, TODAY_Q, SUMMER_DAY, SUMMER_Q, WINTER_DAY, WINTER_Q],
      );
    }, 180_000);

    afterAll(async () => {
      await pg?.end();
    });

    // ── A2 ─────────────────────────────────────────────────────────────────
    it("A2: before submit the question carries no answer and no explanation", async () => {
      const { res, body } = await getToday(ANSWERER);
      // Presence before absence: a real question with four opaque options.
      expect(body.state).toBe("unanswered");
      if (body.state !== "unanswered") return;
      expect(body.question.stem).toBe(STEM);
      expect(body.question.options).toHaveLength(4);
      expect(body.question.correct_answer).toBeNull();
      expect(body.question.explanation).toBeNull();
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(EXPLANATION);
      expect(raw).not.toContain(TODAY_Q);
      for (const o of body.question.options) {
        expect(o.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      }
      expect(body.streak).toEqual({
        current: 0,
        today_done: false,
        broken: false,
      });
    });

    // ── A1 + A3 ────────────────────────────────────────────────────────────
    it("A3: a miss is a practice answer: a qotd session, an answered item, a mastery event, a review entry", async () => {
      const { token, qotdDate } = await tokenFor(ANSWERER, "A");
      const key = randomUUID();
      const res = await postAnswer(ANSWERER, {
        qotd_date: qotdDate,
        option_token: token,
        idempotency_key: key,
      });
      expect(res.status).toBe(201);
      const body = homeQotdAnswerResponseSchema.parse(res.body.data);
      expect(body.result.is_correct).toBe(false);
      expect(body.result.correct_display_letter).toBe("B");
      expect(body.result.explanation).toBe(EXPLANATION);
      expect(body.streak).toEqual({
        current: 1,
        today_done: true,
        broken: false,
      });
      expect(body.streak_extended).toBe(true);

      const item = await pg.query(
        `SELECT i.id, i.status, i.is_correct, i.selected_answer, s.mode, s.status AS session_status
           FROM public.practice_session_items i
           JOIN public.practice_sessions s ON s.id = i.session_id
          WHERE i.user_id = $1`,
        [ANSWERER],
      );
      expect(item.rows).toHaveLength(1);
      expect(item.rows[0]).toMatchObject({
        status: "answered",
        is_correct: false,
        selected_answer: "A",
        mode: "qotd",
        session_status: "completed",
      });
      const itemId = String(item.rows[0].id);
      expect(
        await count(
          `SELECT count(*)::int AS n FROM public.student_qotd_attempts
            WHERE student_id = $1 AND practice_session_item_id = $2 AND is_correct = false`,
          [ANSWERER, itemId],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*)::int AS n FROM public.mastery_event_audit_log
            WHERE student_id = $1 AND event_id = $2 AND event_source_kind = 'practice_attempt'`,
          [ANSWERER, itemId],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*)::int AS n FROM public.review_schedule
            WHERE student_id = $1 AND question_id = $2`,
          [ANSWERER, TODAY_Q],
        ),
      ).toBe(1);
      expect(emitted.map((e) => e.name)).toEqual(
        expect.arrayContaining([
          "qotd_viewed",
          "qotd_answered",
          "streak_extended",
        ]),
      );
    });

    it("A3: the QOTD answer does not use the free daily 40", async () => {
      const r = await pg.query<{ d: { current: number; remaining: number } }>(
        `SELECT public.check_and_reserve_practice_quota(
           $1::uuid, NULL::uuid, NULL::uuid, NULL::uuid, true, NULL::text, now()) AS d`,
        [ANSWERER],
      );
      // Presence: the answered qotd item exists (previous test), and the quota counts none of it.
      expect(
        await count(
          `SELECT count(*)::int AS n FROM public.practice_session_items WHERE user_id = $1 AND status = 'answered'`,
          [ANSWERER],
        ),
      ).toBe(1);
      expect(r.rows[0]?.d.current).toBe(0);
    });

    it("A1: a replay returns the original; a second, different answer the same day is 409", async () => {
      const { token, qotdDate } = await tokenFor(REPLAYER, "B");
      const key = randomUUID();
      const first = await postAnswer(REPLAYER, {
        qotd_date: qotdDate,
        option_token: token,
        idempotency_key: key,
      });
      expect(first.status).toBe(201);
      const replay = await postAnswer(REPLAYER, {
        qotd_date: qotdDate,
        option_token: token,
        idempotency_key: key,
      });
      expect(replay.status).toBe(200);
      expect(replay.body.data.result).toEqual(first.body.data.result);
      expect(replay.body.data.result.is_correct).toBe(true);
      const second = await postAnswer(REPLAYER, {
        qotd_date: qotdDate,
        option_token: token,
        idempotency_key: randomUUID(),
      });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("qotd_already_answered");
      expect(
        await count(
          `SELECT count(*)::int AS n FROM public.practice_session_items WHERE user_id = $1`,
          [REPLAYER],
        ),
      ).toBe(1);
      const after = await getToday(REPLAYER);
      expect(after.body.state).toBe("answered");
    });

    it("A1: a raw canonical letter or another day's token is refused before grading", async () => {
      const { qotdDate } = await tokenFor(PROMPTED, "B");
      const res = await postAnswer(PROMPTED, {
        qotd_date: qotdDate,
        option_token: "B",
        idempotency_key: randomUUID(),
      });
      expect(res.status).toBe(400);
      expect(
        await count(
          `SELECT count(*)::int AS n FROM public.student_qotd_attempts WHERE student_id = $1`,
          [PROMPTED],
        ),
      ).toBe(0);
    });

    it("A1: the day is America/Chicago's, at midnight in summer (CDT) and winter (CST)", async () => {
      const day = async (iso: string) =>
        (
          await pg.query<{ d: string }>(
            `SELECT public.chicago_day($1::timestamptz)::text AS d`,
            [iso],
          )
        ).rows[0]?.d;
      expect(await day("2026-07-15T04:59:59Z")).toBe(SUMMER_DAY);
      expect(await day("2026-07-15T05:00:00Z")).toBe("2026-07-15");
      expect(await day("2026-01-15T05:59:59Z")).toBe(WINTER_DAY);
      expect(await day("2026-01-15T06:00:00Z")).toBe("2026-01-15");

      const answerAt = async (date: string, q: string, iso: string) =>
        (
          await pg.query<{ r: { status: string } }>(
            `SELECT public.qotd_student_answer($1, $1, $2::date, $3, $4::jsonb, 'B', true, $5, $6::timestamptz) AS r`,
            [
              STREAKER,
              date,
              q,
              JSON.stringify({
                question_stem: "s",
                question_options: [],
                question_correct_answer: "B",
                question_explanation: "e",
                question_domain: "Algebra",
                question_skill: "ALG.D01",
                question_difficulty: 2,
                question_section: "M",
                question_item_type: "mcq",
              }),
              randomUUID(),
              iso,
            ],
          )
        ).rows[0]?.r.status;
      // One second after Chicago midnight the day's question is no longer today's.
      expect(await answerAt(SUMMER_DAY, SUMMER_Q, "2026-07-15T05:00:01Z")).toBe(
        "not_today",
      );
      expect(await answerAt(SUMMER_DAY, SUMMER_Q, "2026-07-15T04:59:00Z")).toBe(
        "created",
      );
      expect(await answerAt(WINTER_DAY, WINTER_Q, "2026-01-15T06:00:01Z")).toBe(
        "not_today",
      );
      expect(await answerAt(WINTER_DAY, WINTER_Q, "2026-01-15T05:59:00Z")).toBe(
        "created",
      );
      // A question that is not the day's scheduled one is refused even on the right day.
      expect(await answerAt(SUMMER_DAY, WINTER_Q, "2026-07-14T18:00:00Z")).toBe(
        "not_today",
      );
    });

    // ── A4 ─────────────────────────────────────────────────────────────────
    it("A4: every source extends the streak; a missed day resets it; it ends today or yesterday", async () => {
      const S = "a7000000-0000-4000-8000-0000000000ff";
      await seedPerson(S, "student", "2008-01-01");
      // Presence: nothing yet.
      expect(await streakAt(S, "2026-02-10T18:00:00Z")).toEqual({
        current_streak: 0,
        today_done: false,
        broken: false,
      });
      await seedAnswer("practice", S, "2026-02-05T18:00:00Z");
      await seedAnswer("review", S, "2026-02-06T18:00:00Z");
      await seedAnswer("full_length", S, "2026-02-07T18:00:00Z");
      // 02-08 at 23:30 Chicago (CST, so 05:30Z on the 9th) is still the 8th. (February: March 8
      // 2026 is the DST switch.)
      await seedAnswer("practice", S, "2026-02-09T05:30:00Z");
      expect(await streakAt(S, "2026-02-08T20:00:00Z")).toEqual({
        current_streak: 4,
        today_done: true,
        broken: false,
      });
      // The next day, unanswered: the run still counts (ends yesterday), today not done.
      expect(await streakAt(S, "2026-02-09T20:00:00Z")).toEqual({
        current_streak: 4,
        today_done: false,
        broken: false,
      });
      // Two days later with nothing: broken.
      expect(await streakAt(S, "2026-02-10T20:00:00Z")).toEqual({
        current_streak: 0,
        today_done: false,
        broken: true,
      });
      // A new answer after the gap starts again at 1.
      await seedAnswer("review", S, "2026-02-10T21:00:00Z");
      expect(await streakAt(S, "2026-02-10T22:00:00Z")).toEqual({
        current_streak: 1,
        today_done: true,
        broken: false,
      });
    });

    // ── A5 ─────────────────────────────────────────────────────────────────
    it("A5: the prompt shows after the answer; 'Don't ask again' only from the 3rd ask; a grant writes consent with a version", async () => {
      // Two earlier asks on earlier days.
      await pg.query(
        `INSERT INTO public.student_qotd_email_prefs (student_id, ask_count, last_asked_on, updated_at)
         VALUES ($1, 2, ($2::date - 1), now())`,
        [PROMPTED, today],
      );
      const { token, qotdDate } = await tokenFor(PROMPTED, "B");
      const res = await postAnswer(PROMPTED, {
        qotd_date: qotdDate,
        option_token: token,
        idempotency_key: randomUUID(),
      });
      expect(res.status).toBe(201);
      expect(res.body.data.show_email_prompt).toBe(true);
      expect(res.body.data.show_dont_ask_again).toBe(true);
      expect(emitted).toContainEqual({
        name: "qotd_email_prompt_shown",
        payload: { ask_number: 3 },
      });
      // Reading the page again the same day counts no extra ask.
      const again = await getToday(PROMPTED);
      expect(again.body.show_email_prompt).toBe(true);
      expect(
        (
          await pg.query(
            `SELECT ask_count FROM public.student_qotd_email_prefs WHERE student_id = $1`,
            [PROMPTED],
          )
        ).rows[0]?.ask_count,
      ).toBe(3);

      const granted = await consent(PROMPTED, "grant");
      expect(granted.status).toBe(200);
      expect(granted.body.data).toEqual({
        consented: true,
        show_email_prompt: false,
      });
      const log = await pg.query(
        `SELECT granted, source, consent_version, purpose FROM public.marketing_consent_log WHERE profile_id = $1`,
        [PROMPTED],
      );
      expect(log.rows).toEqual([
        {
          granted: true,
          source: "qotd_prompt",
          consent_version: QOTD_EMAIL_CONSENT_VERSION,
          purpose: "qotd_daily_email",
        },
      ]);
      // A daily-question yes is not a marketing opt-in.
      expect(
        (
          await pg.query(
            `SELECT marketing_opt_in FROM public.profiles WHERE id = $1`,
            [PROMPTED],
          )
        ).rows[0]?.marketing_opt_in,
      ).toBe(false);
      expect((await getToday(PROMPTED)).body.show_email_prompt).toBe(false);
    });

    it("A5: the first ask has no 'Don't ask again', and 'never' before the 3rd ask is refused", async () => {
      // REPLAYER answered earlier today: its first ask happened then.
      const t = await getToday(REPLAYER);
      expect(t.body.show_email_prompt).toBe(true);
      expect(t.body.show_dont_ask_again).toBe(false);
      const never = await consent(REPLAYER, "never");
      expect(never.status).toBe(409);
      // "Not now" hides it for the rest of the day.
      expect((await consent(REPLAYER, "not_now")).status).toBe(200);
      expect((await getToday(REPLAYER)).body.show_email_prompt).toBe(false);
    });

    it("A5: 'never' is permanent once offered", async () => {
      await pg.query(
        `INSERT INTO public.student_qotd_email_prefs (student_id, ask_count, last_asked_on, updated_at)
         VALUES ($1, 3, ($2::date - 1), now())`,
        [NEVERER, today],
      );
      expect((await consent(NEVERER, "never")).status).toBe(200);
      const r = await pg.query<{ s: { never_ask: boolean } }>(
        `SELECT public.qotd_email_prompt_state($1, now() + interval '3 days') AS s`,
        [NEVERER],
      );
      expect(r.rows[0]?.s.never_ask).toBe(true);
      const { token, qotdDate } = await tokenFor(NEVERER, "B");
      const res = await postAnswer(NEVERER, {
        qotd_date: qotdDate,
        option_token: token,
        idempotency_key: randomUUID(),
      });
      expect(res.status).toBe(201);
      expect(res.body.data.show_email_prompt).toBe(false);
    });

    it("A5: never for an under-13 — no prompt, and a grant is refused", async () => {
      const state = await pg.query<{ s: { eligible: boolean } }>(
        `SELECT public.qotd_email_prompt_state($1) AS s`,
        [UNDER13],
      );
      expect(state.rows[0]?.s.eligible).toBe(false);
      const r = await pg.query<{ r: { ok: boolean; reason?: string } }>(
        `SELECT public.set_qotd_email_consent($1, 'grant', $2) AS r`,
        [UNDER13, QOTD_EMAIL_CONSENT_VERSION],
      );
      expect(r.rows[0]?.r).toEqual({ ok: false, reason: "ineligible" });
      expect(
        await count(
          `SELECT count(*)::int AS n FROM public.marketing_consent_log WHERE profile_id = $1`,
          [UNDER13],
        ),
      ).toBe(0);
    });

    it("A5: a grant without a version is refused", async () => {
      let message = "";
      try {
        await pg.query(
          `SELECT public.set_qotd_email_consent($1, 'grant', NULL)`,
          [MAILED],
        );
      } catch (error: unknown) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/version/);
    });

    it("guardians and unlinked under-13s are refused by the student gate", async () => {
      as(GUARDIAN, "guardian");
      expect((await request(await app()).get("/api/qotd/today")).status).toBe(
        403,
      );
      as(UNDER13, "student", true);
      expect((await request(await app()).get("/api/qotd/today")).status).toBe(
        403,
      );
      as(null);
      expect((await request(await app()).get("/api/qotd/today")).status).toBe(
        401,
      );
    });

    // ── A6 ─────────────────────────────────────────────────────────────────
    describe("A6: the daily email", () => {
      const sent: {
        to: string;
        subject: string;
        text: string;
        html: string;
        headers?: Record<string, string>;
      }[] = [];
      const fakeTransport = async (input: {
        to: string;
        subject: string;
        text: string;
        html: string;
        headers?: Record<string, string>;
      }) => {
        sent.push(input);
        return {
          ok: true as const,
          value: { providerMessageId: `re_${sent.length}` },
        };
      };
      async function run(nowIso: string) {
        const { runQotdEmailJob } =
          await import("../../server/services/qotd/qotd-email-job");
        return runQotdEmailJob({
          db: makePgSupabase(pg),
          transport: fakeTransport,
          siteUrl: "https://lyceon.test",
          now: new Date(nowIso),
        });
      }
      async function grantAt(id: string, iso: string) {
        const r = await pg.query<{ r: { ok: boolean } }>(
          `SELECT public.set_qotd_email_consent($1, 'grant', $2, $3::timestamptz) AS r`,
          [id, QOTD_EMAIL_CONSENT_VERSION, iso],
        );
        expect(r.rows[0]?.r.ok).toBe(true);
      }

      beforeAll(async () => {
        for (const id of [
          MAILED,
          MAILED_ANSWERED,
          MAILED_SUNSET,
          MAILED_UNSUB,
        ]) {
          await grantAt(id, "2026-07-01T12:00:00Z");
        }
        // Answered on the send day (summer), so no email.
        await seedAnswer("practice", MAILED_ANSWERED, "2026-07-14T15:00:00Z");
        // Seven earlier sends, none followed by an answer that day: the sunset.
        for (let d = 7; d <= 13; d += 1) {
          await pg.query(
            `INSERT INTO public.qotd_email_sends (student_id, send_date, kind, status, created_at, sent_at)
             VALUES ($1, $2::date, 'daily', 'sent', now(), now())`,
            [MAILED_SUNSET, `2026-07-${String(d).padStart(2, "0")}`],
          );
        }
        await pg.query(`SELECT public.qotd_email_unsubscribe($1)`, [
          MAILED_UNSUB,
        ]);
        await seedQuestion("SATM1Q90004");
        await pg.query(
          `INSERT INTO public.qotd_schedule (qotd_date, question_id) VALUES ('2026-07-15', 'SATM1Q90004')`,
        );
      });

      it("outside the 17:00 Chicago hour nothing is sent (16:59 CDT)", async () => {
        const summary = await run("2026-07-14T21:59:00Z");
        expect(summary.skipped).toBe("not_send_hour");
        expect(sent).toHaveLength(0);
      });

      it("at 17:00 CDT: one email to each eligible student, none to the answered or unsubscribed; the sunset sends the pause email", async () => {
        const summary = await run("2026-07-14T22:00:00Z");
        expect(summary.chicago_hour).toBe(17);
        const to = sent.map((s) => s.to).sort();
        // PROMPTED said yes earlier in this file (A5) and has not answered on this day.
        expect(to).toEqual(
          [
            `${MAILED}@example.test`,
            `${MAILED_SUNSET}@example.test`,
            `${PROMPTED}@example.test`,
          ].sort(),
        );
        const daily = sent.find((s) => s.to === `${MAILED}@example.test`);
        expect(daily?.subject).toBe("Your question is ready");
        expect(daily?.text).toContain(STEM);
        expect(daily?.text).toContain("https://lyceon.test/dashboard#qotd");
        // No choices and no answer in the email.
        expect(daily?.html).not.toContain(EXPLANATION);
        expect(daily?.text).not.toMatch(/\b(A|B|C|D)\)\s/);
        expect(daily?.headers?.["List-Unsubscribe"]).toMatch(
          /^<https:\/\/lyceon\.test\/api\/public\/qotd-email\/unsubscribe\?t=/,
        );
        expect(daily?.headers?.["List-Unsubscribe-Post"]).toBe(
          "List-Unsubscribe=One-Click",
        );
        const pause = sent.find(
          (s) => s.to === `${MAILED_SUNSET}@example.test`,
        );
        expect(pause?.subject).toBe("We've paused your daily question");
        expect(pause?.text).toContain("/api/public/qotd-email/resume?t=");
        // Privacy: no address and no question text in any log line.
        for (const line of logs) {
          expect(line).not.toContain("@example.test");
          expect(line).not.toContain(STEM);
        }
      });

      it("a second run in the same hour sends nothing more (claimed before sending)", async () => {
        const before = sent.length;
        const summary = await run("2026-07-14T22:30:00Z");
        expect(summary.sent + summary.paused).toBe(0);
        expect(sent.length).toBe(before);
        expect(
          await count(
            `SELECT count(*)::int AS n FROM public.qotd_email_sends WHERE student_id = $1 AND send_date = '2026-07-14'`,
            [MAILED],
          ),
        ).toBe(1);
      });

      it("the claim is insert-once: two runs racing for the same student and day get one send", async () => {
        // The candidate read already skips a student with a send today; this is the guard for
        // two runs that read candidates before either claimed (concurrent cron invocations).
        const claim = async () =>
          (
            await pg.query<{ id: string | null }>(
              `SELECT public.qotd_email_claim($1, 'daily', '2026-07-20T22:00:00Z'::timestamptz) AS id`,
              [MAILED_ANSWERED],
            )
          ).rows[0]?.id ?? null;
        const first = await claim();
        expect(first).toMatch(/^[0-9a-f-]{36}$/);
        expect(await claim()).toBeNull();
        expect(
          await count(
            `SELECT count(*)::int AS n FROM public.qotd_email_sends WHERE student_id = $1 AND send_date = '2026-07-20'`,
            [MAILED_ANSWERED],
          ),
        ).toBe(1);
      });

      it("after the pause email, the student gets nothing the next day", async () => {
        const before = sent.length;
        await run("2026-07-15T22:00:00Z");
        const fresh = sent.slice(before).map((s) => s.to);
        expect(fresh).toContain(`${MAILED}@example.test`);
        expect(fresh).not.toContain(`${MAILED_SUNSET}@example.test`);
      });

      it("at 17:00 CST in winter it sends too (23:00Z), and the subject carries the streak", async () => {
        await seedAnswer("practice", MAILED, "2026-01-13T18:00:00Z");
        const before = sent.length;
        const summary = await run("2026-01-14T23:00:00Z");
        expect(summary.chicago_hour).toBe(17);
        const mine = sent
          .slice(before)
          .find((s) => s.to === `${MAILED}@example.test`);
        expect(mine?.subject).toBe("Day 1 🔥 Your question is ready");
        // 22:00Z in January is 16:00 CST: not the hour.
        expect((await run("2026-01-15T22:00:00Z")).skipped).toBe(
          "not_send_hour",
        );
      });
    });

    // ── A7 ─────────────────────────────────────────────────────────────────
    it("A7: unsubscribe needs no sign-in; GET only shows the button; a tampered link is refused", async () => {
      const { qotdEmailLinkToken } =
        await import("../../server/services/qotd/qotd-email-links");
      const token = qotdEmailLinkToken("unsubscribe", MAILED);
      as(null);
      const page = await request(await app()).get(
        `/api/public/qotd-email/unsubscribe?t=${encodeURIComponent(token)}`,
      );
      expect(page.status).toBe(200);
      expect(page.text).toContain('<form method="post"');
      // The GET changed nothing.
      const still = await pg.query(
        `SELECT consented FROM public.student_qotd_email_prefs WHERE student_id = $1`,
        [MAILED],
      );
      expect(still.rows[0]?.consented).toBe(true);

      const tampered = `${token.slice(0, -2)}xx`;
      const bad = await request(await app()).post(
        `/api/public/qotd-email/unsubscribe?t=${encodeURIComponent(tampered)}`,
      );
      expect(bad.status).toBe(400);
      const wrongAction = await request(await app()).post(
        `/api/public/qotd-email/unsubscribe?t=${encodeURIComponent(qotdEmailLinkToken("resume", MAILED))}`,
      );
      expect(wrongAction.status).toBe(400);
      expect(
        (
          await pg.query(
            `SELECT consented FROM public.student_qotd_email_prefs WHERE student_id = $1`,
            [MAILED],
          )
        ).rows[0]?.consented,
      ).toBe(true);

      const ok = await request(await app()).post(
        `/api/public/qotd-email/unsubscribe?t=${encodeURIComponent(token)}`,
      );
      expect(ok.status).toBe(200);
      const after = await pg.query(
        `SELECT consented, unsubscribed_at IS NOT NULL AS unsub, never_ask FROM public.student_qotd_email_prefs WHERE student_id = $1`,
        [MAILED],
      );
      expect(after.rows[0]).toEqual({
        consented: false,
        unsub: true,
        never_ask: true,
      });
      const withdrawal = await pg.query(
        `SELECT granted, source, purpose FROM public.marketing_consent_log
          WHERE profile_id = $1 ORDER BY captured_at DESC LIMIT 1`,
        [MAILED],
      );
      expect(withdrawal.rows[0]).toEqual({
        granted: false,
        source: "email_unsubscribe",
        purpose: "qotd_daily_email",
      });
    });

    // ── A8 ─────────────────────────────────────────────────────────────────
    it("A8: several dates stored through the one write; the effective date is the closest future one; setup stays outstanding", async () => {
      const { upsertStudyProfile, readStudyProfile } =
        await import("../../server/services/calendar/profile-service");
      const { completedStudyProfile } =
        await import("../../packages/shared/src/calendar/profile");
      const later = "2027-05-01";
      const sooner = "2026-12-05";
      const written = await upsertStudyProfile(DATES, {
        target_exam_dates: [later, sooner],
        idempotency_key: randomUUID(),
      });
      expect(written.ok).toBe(true);
      const profile = await readStudyProfile(DATES);
      expect(profile?.target_exam_dates).toEqual([sooner, later]);
      expect(profile?.target_exam_date).toBe(sooner);
      expect(profile?.setup_completed_at).toBeNull();
      expect(profile?.study_days_mask).toBeNull();
      expect(completedStudyProfile(profile ?? null)).toBeNull();

      // A past date is refused at the boundary.
      const past = await upsertStudyProfile(DATES, {
        target_exam_dates: ["2020-01-01"],
        idempotency_key: randomUUID(),
      });
      expect(past.ok).toBe(false);

      // When the sooner date passes, the roll hands over to the next one. The row is put in the
      // state an hour after a date passes — the cached effective date still the passed one —
      // with the trigger off (replica), because that state only ever arises from time passing.
      await pg.query(`SET session_replication_role = replica`);
      try {
        await pg.query(
          `UPDATE public.student_study_profile
              SET target_exam_dates = ARRAY['2026-10-03'::date, $2::date],
                  target_exam_date = '2026-10-03'::date
            WHERE student_id = $1`,
          [DATES, later],
        );
      } finally {
        await pg.query(`SET session_replication_role = origin`);
      }
      const moved = await pg.query<{ n: number }>(
        `SELECT public.study_profile_roll_exam_dates() AS n`,
      );
      expect(Number(moved.rows[0]?.n)).toBeGreaterThanOrEqual(1);
      const rolled = await readStudyProfile(DATES);
      expect(rolled?.target_exam_date).toBe(later);
      expect(rolled?.target_exam_dates).toEqual(["2026-10-03", later]);

      // A setup write (with the schedule) completes setup and keeps the dates.
      const setup = await upsertStudyProfile(DATES, {
        study_days_mask: 62,
        daily_minutes: 30,
        idempotency_key: randomUUID(),
      });
      expect(setup.ok).toBe(true);
      const done = await readStudyProfile(DATES);
      expect(done?.setup_completed_at).not.toBeNull();
      expect(done?.target_exam_dates).toEqual(["2026-10-03", later]);

      // A write without the schedule cannot complete setup.
      const incomplete = await upsertStudyProfile(UNDER13, {
        target_score: 1400,
        idempotency_key: randomUUID(),
      });
      expect(incomplete.ok).toBe(false);
    });

    // ── A9 ─────────────────────────────────────────────────────────────────
    it("A9: deleting the account removes attempts, sends, prompt state and test dates", async () => {
      const { token, qotdDate } = await tokenFor(DELETED, "B");
      expect(
        (
          await postAnswer(DELETED, {
            qotd_date: qotdDate,
            option_token: token,
            idempotency_key: randomUUID(),
          })
        ).status,
      ).toBe(201);
      await pg.query(`SELECT public.set_qotd_email_consent($1, 'grant', $2)`, [
        DELETED,
        QOTD_EMAIL_CONSENT_VERSION,
      ]);
      await pg.query(
        `INSERT INTO public.qotd_email_sends (student_id, send_date, kind, status) VALUES ($1, '2026-07-01', 'daily', 'sent')`,
        [DELETED],
      );
      await pg.query(
        `INSERT INTO public.student_study_profile (student_id, timezone, target_exam_dates)
         VALUES ($1, 'America/Chicago', ARRAY['2027-03-06'::date])`,
        [DELETED],
      );
      const tables = [
        "student_qotd_attempts",
        "student_qotd_email_prefs",
        "qotd_email_sends",
        "student_study_profile",
      ];
      // Presence before absence.
      for (const t of tables) {
        expect(
          await count(
            `SELECT count(*)::int AS n FROM public.${t} WHERE student_id = $1`,
            [DELETED],
          ),
        ).toBe(1);
      }
      await pg.query(`DELETE FROM public.profiles WHERE id = $1`, [DELETED]);
      for (const t of tables) {
        expect(
          await count(
            `SELECT count(*)::int AS n FROM public.${t} WHERE student_id = $1`,
            [DELETED],
          ),
        ).toBe(0);
      }
    });
  },
);
