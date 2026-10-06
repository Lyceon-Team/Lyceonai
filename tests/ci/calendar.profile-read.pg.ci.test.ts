/**
 * GET /api/calendar/profile → real route, real service, real PostgreSQL.
 *
 * @spec [Doc-05F_V1.0 §15 (API surface), §16 (entitlement applies to the plan), §7.1
 *        `student_study_profile`; SCL-130 (setup renders before the entitlement gate); owner
 *        ruling OQ-25 (Karl, 2026-10-02, clarified: "An ungated `GET /api/calendar/profile`
 *        returns the study profile only ... never plan blocks"); lyceon-coding-standards §14]
 * | @implemented [2026-10-03]
 *
 * plain English: a student saves their setup through the real `PUT /profile`, then reads it
 * back through the real `GET /profile`, and what comes back is exactly what was saved — for
 * a FREE student as much as a paid one. The fixture is the PUT's own response, so the read is
 * compared against what the system actually produced, not against a hand-written shape.
 *
 * Why this cannot live in the route contract test: there the service is stubbed, so "the
 * read returns what the write stored" is a statement about the stub. Here `readStudyProfile`
 * selects real columns from a real row, through the real `studyProfileSchema` parse.
 *
 * MOCK BOUNDARY. Substituted: the DATABASE TRANSPORT (`supabaseServer` → real SQL via
 * `tests/helpers/pg-supabase`), the AUTH boundary (a session fixture in the canonical
 * `SupabaseUser` shape), CSRF, the rate limiter and the entitlement answer (toggled per case,
 * because the point is that the answer does not matter to this route). NOT substituted:
 * `calendar-routes`, `profile-service`, `loadCalendarConfig`, the schemas, the migrations.
 */
import express from "express";
import request from "supertest";
import { Client } from "pg";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { studyProfileSchema } from "../../packages/shared/src/calendar/profile";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "calendar_profile_read_ci";
const STUDENT = "77777777-7777-4777-8777-777777777777";
const ACTOR = "88888888-8888-4888-8888-888888888888";

let pg: Client;
let entitled = false;

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

vi.mock("../../server/middleware/csrf", () => ({
  doubleCsrfProtection: (_q: unknown, _s: unknown, next: () => void) => next(),
  generateToken: () => "test-csrf-token",
}));

vi.mock("../../server/middleware/rate-limit", () => ({
  singleBucketRateLimit:
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
  applyRateLimitHeaders: vi.fn(),
  denyRateLimited: vi.fn(),
}));

const canAccessFeature = vi.fn(async () => entitled);
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: { canAccessFeature },
}));

async function buildApp(): Promise<express.Express> {
  const router = (await import("../../server/routes/calendar-routes"))
    .calendarRouter;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.requestId = "oq-25";
    req.user = {
      id: STUDENT,
      email: "reader@example.test",
      display_name: null,
      role: "student",
      isAdmin: false,
      isGuardian: false,
      actor_id: ACTOR,
    };
    next();
  });
  app.use("/api/calendar", router);
  return app;
}

let app: express.Express;

/**
 * A test date 60 days out. Computed, not fixed: the schema's window is relative to the
 * student's local today, so a literal date would turn this file red on some calendar day. 60
 * days is far from both edges (past, and `target_exam_date_max_days`), so the UTC/Chicago
 * one-day difference cannot matter.
 */
const EXAM_DATE = new Date(Date.now() + 60 * 86_400_000)
  .toISOString()
  .slice(0, 10);

/** The body the setup form produces, with every goal answered so the read has values to return. */
function setupBody(): Record<string, unknown> {
  return {
    timezone: "America/Chicago",
    target_exam_date: EXAM_DATE,
    target_score: 1400,
    study_days_mask: 62,
    daily_minutes: 60,
    full_length_weekday: 6,
    full_length_interval_weeks: 2,
    idempotency_key: crypto.randomUUID(),
  };
}

/** Every top-level key a plan read carries, which this route must never. */
const PLAN_KEYS = [
  "status",
  "days",
  "blocks",
  "facts",
  "streak",
  "projection",
  "version_no",
  "plan_version_id",
  "latest_unacknowledged_nonstudent_change",
  "diagnostic_state",
  "entitled",
] as const;

describe.skipIf(!PG_AVAILABLE)(
  "GET /api/calendar/profile — the ungated study-profile read, against real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [
        STUDENT,
        "reader@example.test",
      ]);
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name)
         VALUES ($1, $2, 'student', 'Riley')`,
        [STUDENT, "reader@example.test"],
      );
      app = await buildApp();
    });

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      entitled = false;
      canAccessFeature.mockClear();
      await pg.query(
        `DELETE FROM public.student_study_profile WHERE student_id = $1`,
        [STUDENT],
      );
    });

    it("a FREE student with no profile row reads { profile: null }", async () => {
      const rows = await pg.query(
        `SELECT 1 FROM public.student_study_profile WHERE student_id = $1`,
        [STUDENT],
      );
      expect(rows.rowCount).toBe(0);

      const res = await request(app).get("/api/calendar/profile");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ profile: null, requestId: "oq-25" });
    });

    for (const tier of [
      { name: "FREE", entitled: false },
      { name: "PAID", entitled: true },
    ]) {
      it(`a ${tier.name} student reads back exactly what PUT saved, and no plan data`, async () => {
        entitled = tier.entitled;

        const put = await request(app)
          .put("/api/calendar/profile")
          .send(setupBody());
        expect(put.status).toBe(200);
        // The fixture is the real write's own answer, not a hand-built shape.
        const saved = studyProfileSchema.parse(put.body.profile);

        const res = await request(app).get("/api/calendar/profile");

        expect(res.status).toBe(200);
        // Presence before absence: the profile is there and carries the saved answers.
        expect(res.body.profile).not.toBeNull();
        expect(res.body.profile.target_exam_date).toBe(EXAM_DATE);
        expect(res.body.profile.target_score).toBe(1400);
        expect(res.body.profile.study_days_mask).toBe(62);
        expect(res.body.profile.daily_minutes).toBe(60);
        expect(res.body.profile.full_length_weekday).toBe(6);
        expect(res.body.profile.full_length_interval_weeks).toBe(2);
        expect(res.body.profile.setup_completed_at).not.toBeNull();
        // Round trip: the read equals the write, field for field, and nothing more.
        expect(res.body.profile).toEqual(saved);
        expect(Object.keys(res.body.profile).sort()).toEqual(
          Object.keys(studyProfileSchema.shape).sort(),
        );
        // Absence: the top level is the profile and the correlation id, and no plan key.
        expect(Object.keys(res.body).sort()).toEqual(["profile", "requestId"]);
        for (const key of PLAN_KEYS) {
          expect(res.body).not.toHaveProperty(key);
          expect(res.body.profile).not.toHaveProperty(key);
        }
      });
    }

    it("the read never asks for calendar_access", async () => {
      await request(app).put("/api/calendar/profile").send(setupBody());
      canAccessFeature.mockClear();

      const res = await request(app).get("/api/calendar/profile");

      expect(res.status).toBe(200);
      expect(res.body.profile).not.toBeNull();
      expect(canAccessFeature).not.toHaveBeenCalled();
    });
  },
);
