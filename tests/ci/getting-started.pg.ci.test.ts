/**
 * The Home "Getting started" checklist — real Postgres, real router, real auth and entitlement.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §2 steps, §3 completion rules, §8 server; rulings 1–4 of
 *       2026-10-13] | @implemented [2026-10-13]
 *
 * plain English: every assertion is made against what the REAL migrations, the real
 * `getting_started_observe` and the real route (mounted as server/index.ts mounts it, CSRF left
 * out) return for rows the product itself would write. Each case seeds the real-data fact behind
 * one step and reads the checklist back:
 *   GS1  a new free student: five steps, all open, in the brief's order, with their links
 *   GS2  each step follows its own real data (date and score, today's question, the email
 *        opt-in, an answered practice item, a review session)
 *   GS3  today's question counts for steps 2 AND 4; a practice answer counts for 4 only
 *   GS4  "Not sure yet" counts for step 1, for the date and for the score; a date alone does not
 *   GS5  step 3: done only on opt-in; "Not now" skips it (counts toward finishing); opting in
 *        later makes it done; hidden for a student who cannot opt in (under 13)
 *   GS6  sticky: a LISA message deleted after the step was reached leaves it done
 *   GS7  Pro: eight steps; calendar, LISA and guardian follow their data; free never sees them
 *   GS8  dismiss: refused (409) until complete; then 200, idempotent, and stored
 *   GS9  guardians and admins get 403; a bad "Not sure yet" body is a 400
 *   GS10 presence only: the LISA message's text never reaches the response or the logs
 *   GS11 only the student's own message counts for LISA (not the tutor's, not a suggestion)
 *   GS12 the three POSTs share one rate-limit bucket (Karl, 2026-10-13 on #1230); GET is not limited
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
  GETTING_STARTED_HREF,
  gettingStartedResponseSchema,
  type GettingStartedResponse,
} from "../../packages/shared/src/getting-started-schema";

const DB_NAME = "getting_started_ci";
const LISA_TEXT = "my private question about circles";

let pg: Client;
const session: {
  id: string | null;
  role: "student" | "guardian" | "admin";
  under13: boolean;
} = { id: null, role: "student", under13: false };
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
      isAdmin: session.role === "admin",
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
  const { createGettingStartedRouter } =
    await import("../../server/routes/getting-started-routes");
  const { requireSupabaseAuth, requireStudentAccount } =
    await import("../../server/middleware/supabase-auth");
  const a = express();
  a.use(express.json());
  a.use(injectSession);
  // As server/index.ts mounts it (CSRF left out).
  a.use(
    "/api/home/getting-started",
    requireSupabaseAuth,
    requireStudentAccount,
    createGettingStartedRouter(),
  );
  cachedApp = a;
  return a;
}

function as(
  id: string,
  role: "student" | "guardian" | "admin" = "student",
  under13 = false,
): void {
  session.id = id;
  session.role = role;
  session.under13 = under13;
}

async function read(
  id: string,
  under13 = false,
): Promise<GettingStartedResponse> {
  as(id, "student", under13);
  const res = await request(await app()).get("/api/home/getting-started");
  expect(res.status).toBe(200);
  return gettingStartedResponseSchema.parse(res.body.data);
}

function statusOf(view: GettingStartedResponse): Record<string, string> {
  return Object.fromEntries(view.steps.map((s) => [s.id, s.status]));
}

// ── Seeds: the rows the product writes ─────────────────────────────────────────────────────

async function seedStudent(id: string, dob = "2008-01-01"): Promise<void> {
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    id,
    `${id}@example.test`,
  ]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
     VALUES ($1, $2, 'student', 'Someone', $3::date)`,
    [id, `${id}@example.test`, dob],
  );
}

async function seedGuardian(id: string): Promise<void> {
  await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    id,
    `${id}@example.test`,
  ]);
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
     VALUES ($1, $2, 'guardian', 'Parent', '1980-01-01')`,
    [id, `${id}@example.test`],
  );
}

async function makePro(id: string): Promise<void> {
  await pg.query(
    "INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')",
    [id],
  );
}

async function replica<T>(work: () => Promise<T>): Promise<T> {
  await pg.query(`SET session_replication_role = replica`);
  try {
    return await work();
  } finally {
    await pg.query(`SET session_replication_role = origin`);
  }
}

/** One answered practice item; `mode = 'qotd'` is how today's question is stored (SCL-224). */
async function seedPracticeAnswer(
  id: string,
  mode: "balanced" | "qotd",
): Promise<string> {
  return replica(async () => {
    const s = randomUUID();
    const item = randomUUID();
    await pg.query(
      `INSERT INTO public.practice_sessions (id, user_id, actor_id, mode, target_count, platform, status)
       VALUES ($1, $2, $2, $3, 1, 'web', 'completed')`,
      [s, id, mode],
    );
    await pg.query(
      `INSERT INTO public.practice_session_items
         (id, session_id, user_id, actor_id, ordinal, question_id, question_stem, question_options,
          question_correct_answer, question_explanation, question_domain, question_skill,
          question_difficulty, question_section, question_item_type, status, is_correct,
          selected_answer, occurred_at, answered_at)
       VALUES ($1, $2, $3, $3, 1, 'SATM1Q90001', 's', '[]'::jsonb, 'B', 'e', 'Algebra', 'ALG.D01', 2,
               'M', 'mcq', 'answered', true, 'B', now(), now())`,
      [item, s, id],
    );
    return item;
  });
}

async function seedQotdAnswer(id: string): Promise<void> {
  const item = await seedPracticeAnswer(id, "qotd");
  await replica(() =>
    pg.query(
      `INSERT INTO public.student_qotd_attempts
         (student_id, qotd_date, question_id, practice_session_item_id, selected_answer, is_correct,
          idempotency_key)
       VALUES ($1, CURRENT_DATE, 'SATM1Q90001', $2, 'B', true, $3)`,
      [id, item, `key-${randomUUID()}`],
    ),
  );
}

async function seedReviewSession(id: string): Promise<void> {
  await replica(() =>
    pg.query(
      `INSERT INTO public.review_sessions (id, student_id, actor_id, mode, target_count, platform, status)
       VALUES ($1, $2, $2, 'queue', 1, 'web', 'completed')`,
      [randomUUID(), id],
    ),
  );
}

async function seedOptIn(id: string, enabled: boolean): Promise<void> {
  await pg.query(
    `INSERT INTO public.notification_channel_preferences
       (profile_id, event_type, channel, enabled, updated_source)
     VALUES ($1, 'qotd_daily', 'email', $2, 'settings')
     ON CONFLICT (profile_id, event_type, channel) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [id, enabled],
  );
}

async function seedGoal(
  id: string,
  goal: { dates?: string[]; score?: number | null },
): Promise<void> {
  await pg.query(
    `INSERT INTO public.student_study_profile (student_id, timezone, target_exam_dates, target_score)
     VALUES ($1, 'America/Chicago', $2::date[], $3)
     ON CONFLICT (student_id) DO UPDATE
       SET target_exam_dates = EXCLUDED.target_exam_dates, target_score = EXCLUDED.target_score`,
    [id, goal.dates ?? [], goal.score ?? null],
  );
}

async function seedPlan(id: string): Promise<void> {
  const version = randomUUID();
  await replica(async () => {
    await pg.query(
      `INSERT INTO public.calendar_plan_versions
         (plan_version_id, student_id, version_no, generator_version, trigger, initiated_by,
          input_snapshot, input_snapshot_hash, constants_snapshot, validator_result)
       VALUES ($1, $2, 1, 'v1', 'setup', 'student', '{}', 'h', '{}', 'accepted')`,
      [version, id],
    );
    await pg.query(
      `INSERT INTO public.calendar_plan_dates (plan_version_id, student_id, scheduled_date, timezone)
       VALUES ($1, $2, CURRENT_DATE, 'America/Chicago')`,
      [version, id],
    );
  });
}

async function seedLisaMessage(
  id: string,
  role: "student" | "tutor" = "student",
  contentKind: "message" | "suggestion" = "message",
): Promise<string> {
  const conversation = randomUUID();
  await pg.query(
    `INSERT INTO public.tutor_conversations (id, student_id, entry_mode, source_surface, status)
     VALUES ($1, $2, 'general', 'dashboard', 'active')`,
    [conversation, id],
  );
  await pg.query(
    `INSERT INTO public.tutor_messages (conversation_id, student_id, role, content_kind, message)
     VALUES ($1, $2, $3, $4, $5)`,
    [conversation, id, role, contentKind, LISA_TEXT],
  );
  return conversation;
}

async function seedGuardianLink(
  student: string,
  guardian: string,
): Promise<void> {
  await pg.query(
    `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at)
     VALUES ($1, $2, 'active', 'student', now(), now())`,
    [guardian, student],
  );
}

const id = (n: number): string =>
  `b8000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe.skipIf(!PG_AVAILABLE)(
  "Getting started checklist — real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
    }, 180_000);

    afterAll(async () => {
      await pg?.end();
    });

    it("GS1: a new free student sees five open steps, in order, each linking where it is done", async () => {
      const s = id(1);
      await seedStudent(s);
      const view = await read(s);
      expect(view.plan).toBe("free");
      expect(view.steps.map((x) => x.id)).toEqual([
        "test_date",
        "qotd",
        "email",
        "blind_spots",
        "review",
      ]);
      expect(view.steps.every((x) => x.status === "open")).toBe(true);
      for (const step of view.steps) {
        expect(step.href).toBe(GETTING_STARTED_HREF[step.id]);
      }
      expect(view.complete).toBe(false);
      expect(view.dismissed).toBe(false);
    });

    it("GS2: each step follows its own real data, and the card completes", async () => {
      const s = id(2);
      await seedStudent(s);
      await seedGoal(s, { dates: ["2026-12-05"], score: 1400 });
      expect(statusOf(await read(s)).test_date).toBe("done");
      await seedQotdAnswer(s);
      expect(statusOf(await read(s)).qotd).toBe("done");
      await seedOptIn(s, true);
      expect(statusOf(await read(s)).email).toBe("done");
      await seedReviewSession(s);
      const view = await read(s);
      expect(statusOf(view)).toEqual({
        test_date: "done",
        qotd: "done",
        email: "done",
        blind_spots: "done",
        review: "done",
      });
      expect(view.complete).toBe(true);
    });

    it("GS3: today's question counts for steps 2 AND 4; a practice answer counts for 4 only", async () => {
      const qotd = id(3);
      const practice = id(4);
      await seedStudent(qotd);
      await seedStudent(practice);
      await seedQotdAnswer(qotd);
      await seedPracticeAnswer(practice, "balanced");
      const a = statusOf(await read(qotd));
      expect([a.qotd, a.blind_spots]).toEqual(["done", "done"]);
      const b = statusOf(await read(practice));
      expect([b.qotd, b.blind_spots]).toEqual(["open", "done"]);
    });

    it("GS4: 'Not sure yet' counts for step 1, for the date and the score; a date alone does not", async () => {
      const s = id(5);
      await seedStudent(s);
      await seedGoal(s, { dates: ["2026-12-05"], score: null });
      expect(statusOf(await read(s)).test_date).toBe("open");
      as(s);
      const res = await request(await app())
        .post("/api/home/getting-started/not-sure")
        .send({ target_score: true });
      expect(res.status).toBe(200);
      expect(
        statusOf(gettingStartedResponseSchema.parse(res.body.data)).test_date,
      ).toBe("done");

      const both = id(6);
      await seedStudent(both);
      as(both);
      const again = await request(await app())
        .post("/api/home/getting-started/not-sure")
        .send({ test_date: true, target_score: true });
      expect(
        statusOf(gettingStartedResponseSchema.parse(again.body.data)).test_date,
      ).toBe("done");
      // Idempotent: the same answer again changes nothing.
      const twice = await request(await app())
        .post("/api/home/getting-started/not-sure")
        .send({ test_date: true, target_score: true });
      expect(twice.status).toBe(200);
      const rows = await pg.query(
        `SELECT test_date_not_sure_at = target_score_not_sure_at AS same
           FROM public.student_getting_started_state WHERE profile_id = $1`,
        [both],
      );
      expect(rows.rows[0]?.same).toBe(true);
    });

    it("GS5: step 3 — open until opt-in, 'Not now' skips it, opting in later makes it done; hidden under 13", async () => {
      const s = id(7);
      await seedStudent(s);
      await seedOptIn(s, false);
      expect(statusOf(await read(s)).email).toBe("open");
      as(s);
      const skip = await request(await app()).post(
        "/api/home/getting-started/skip-email",
      );
      expect(skip.status).toBe(200);
      expect(
        statusOf(gettingStartedResponseSchema.parse(skip.body.data)).email,
      ).toBe("skipped");
      await seedOptIn(s, true);
      expect(statusOf(await read(s)).email).toBe("done");

      // An under-13 with an active guardian link (the live link gate admits them).
      const young = id(8);
      const parent = id(9);
      await seedStudent(young, "2016-01-01");
      await seedGuardian(parent);
      await seedGuardianLink(young, parent);
      const view = await read(young, true);
      expect(view.steps.map((x) => x.id)).not.toContain("email");
      expect(view.steps).toHaveLength(4);
    });

    it("GS6: sticky — a LISA message deleted after the step was reached leaves it done", async () => {
      const s = id(10);
      await seedStudent(s);
      await makePro(s);
      const conversation = await seedLisaMessage(s);
      expect(statusOf(await read(s)).lisa).toBe("done");
      await pg.query(`DELETE FROM public.tutor_conversations WHERE id = $1`, [
        conversation,
      ]);
      const gone = await pg.query(
        `SELECT count(*)::int AS n FROM public.tutor_messages WHERE student_id = $1`,
        [s],
      );
      expect(gone.rows[0]?.n).toBe(0);
      expect(statusOf(await read(s)).lisa).toBe("done");
    });

    it("GS11: only a message the student sent counts for LISA — not the tutor's, not a suggestion", async () => {
      const s = id(20);
      await seedStudent(s);
      await makePro(s);
      await seedLisaMessage(s, "tutor", "message");
      await seedLisaMessage(s, "student", "suggestion");
      // Presence first: both rows are there.
      const rows = await pg.query(
        `SELECT count(*)::int AS n FROM public.tutor_messages WHERE student_id = $1`,
        [s],
      );
      expect(rows.rows[0]?.n).toBe(2);
      expect(statusOf(await read(s)).lisa).toBe("open");
      await seedLisaMessage(s);
      expect(statusOf(await read(s)).lisa).toBe("done");
    });

    it("GS12: the three POSTs share the getting_started_action bucket (seeded 30 / hour); the GET is not limited", async () => {
      const seeded = await pg.query(
        `SELECT value -> 'getting_started_action' AS def FROM public.rate_limit_runtime_config WHERE key = 'bucket_definitions'`,
      );
      expect(seeded.rows[0].def).toEqual({ limit: 30, window_seconds: 3600 });

      // The mechanism, at a limit small enough to reach: one bucket across all three actions.
      const s = id(21);
      await seedStudent(s);
      as(s);
      await pg.query(
        `UPDATE public.rate_limit_runtime_config
            SET value = jsonb_set(value, '{getting_started_action,limit}', '2')
          WHERE key = 'bucket_definitions'`,
      );
      try {
        const a = await app();
        const statuses: number[] = [];
        statuses.push(
          (
            await request(a)
              .post("/api/home/getting-started/not-sure")
              .send({ test_date: true })
          ).status,
        );
        statuses.push(
          (await request(a).post("/api/home/getting-started/skip-email"))
            .status,
        );
        const denied = await request(a).post(
          "/api/home/getting-started/dismiss",
        );
        statuses.push(denied.status);
        expect(statuses).toEqual([200, 200, 429]);
        expect(denied.headers["x-ratelimit-limit"]).toBe("2");
        // Nothing was written by the refused request: still not dismissed.
        const row = await pg.query(
          `SELECT dismissed_at FROM public.student_getting_started_state WHERE profile_id = $1`,
          [s],
        );
        expect(row.rows[0]?.dismissed_at).toBeNull();
        // Home's read is not limited.
        expect((await request(a).get("/api/home/getting-started")).status).toBe(
          200,
        );
      } finally {
        await pg.query(
          `UPDATE public.rate_limit_runtime_config
              SET value = jsonb_set(value, '{getting_started_action,limit}', '30')
            WHERE key = 'bucket_definitions'`,
        );
      }
    });

    it("GS7: Pro sees eight steps and its three follow their data; free never sees them", async () => {
      const pro = id(11);
      const parent = id(12);
      await seedStudent(pro);
      await seedGuardian(parent);
      await makePro(pro);
      let view = await read(pro);
      expect(view.plan).toBe("pro");
      expect(view.steps.map((x) => x.id)).toEqual([
        "test_date",
        "qotd",
        "email",
        "blind_spots",
        "review",
        "calendar",
        "lisa",
        "guardian",
      ]);
      expect([
        statusOf(view).calendar,
        statusOf(view).lisa,
        statusOf(view).guardian,
      ]).toEqual(["open", "open", "open"]);
      await seedPlan(pro);
      await seedLisaMessage(pro);
      await seedGuardianLink(pro, parent);
      view = await read(pro);
      expect([
        statusOf(view).calendar,
        statusOf(view).lisa,
        statusOf(view).guardian,
      ]).toEqual(["done", "done", "done"]);

      // A free student with the same three facts still never sees the Pro steps.
      const free = id(13);
      const parent2 = id(14);
      await seedStudent(free);
      await seedGuardian(parent2);
      await seedPlan(free);
      await seedLisaMessage(free);
      await seedGuardianLink(free, parent2);
      const freeView = await read(free);
      expect(freeView.plan).toBe("free");
      expect(freeView.steps.map((x) => x.id)).not.toEqual(
        expect.arrayContaining(["calendar"]),
      );
      for (const pro of ["calendar", "lisa", "guardian"]) {
        expect(freeView.steps.map((x) => x.id)).not.toContain(pro);
      }
    });

    it("GS8: dismiss is refused until complete, then idempotent and stored", async () => {
      const s = id(15);
      await seedStudent(s);
      as(s);
      const early = await request(await app()).post(
        "/api/home/getting-started/dismiss",
      );
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe("GETTING_STARTED_INCOMPLETE");
      expect((await read(s)).dismissed).toBe(false);

      await seedGoal(s, { dates: ["2026-12-05"], score: 1300 });
      await seedQotdAnswer(s);
      await seedReviewSession(s);
      as(s);
      await request(await app()).post("/api/home/getting-started/skip-email");
      expect((await read(s)).complete).toBe(true);

      as(s);
      const first = await request(await app()).post(
        "/api/home/getting-started/dismiss",
      );
      expect(first.status).toBe(200);
      const stamp = await pg.query(
        `SELECT dismissed_at FROM public.student_getting_started_state WHERE profile_id = $1`,
        [s],
      );
      const second = await request(await app()).post(
        "/api/home/getting-started/dismiss",
      );
      expect(second.status).toBe(200);
      const again = await pg.query(
        `SELECT dismissed_at FROM public.student_getting_started_state WHERE profile_id = $1`,
        [s],
      );
      expect(again.rows[0]?.dismissed_at).toEqual(stamp.rows[0]?.dismissed_at);
      expect((await read(s)).dismissed).toBe(true);
    });

    it("GS9: guardians and admins get 403; a bad 'Not sure yet' body is a 400", async () => {
      const g = id(16);
      const admin = id(17);
      await seedGuardian(g);
      await seedStudent(admin);
      for (const [who, role] of [
        [g, "guardian"],
        [admin, "admin"],
      ] as const) {
        as(who, role);
        const res = await request(await app()).get("/api/home/getting-started");
        expect(res.status).toBe(403);
        const dismiss = await request(await app()).post(
          "/api/home/getting-started/dismiss",
        );
        expect(dismiss.status).toBe(403);
      }
      const s = id(18);
      await seedStudent(s);
      as(s);
      const bad = await request(await app())
        .post("/api/home/getting-started/not-sure")
        .send({});
      expect(bad.status).toBe(400);
    });

    it("GS10: presence only — the LISA message's text never reaches the response or the logs", async () => {
      const s = id(19);
      await seedStudent(s);
      await makePro(s);
      await seedLisaMessage(s);
      as(s);
      const res = await request(await app()).get("/api/home/getting-started");
      // Presence first: the step this message completes is done.
      expect(
        statusOf(gettingStartedResponseSchema.parse(res.body.data)).lisa,
      ).toBe("done");
      expect(JSON.stringify(res.body)).not.toContain(LISA_TEXT);
      expect(logs.join("\n")).not.toContain(LISA_TEXT);
    });
  },
);
