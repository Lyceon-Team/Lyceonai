/**
 * GET /api/sat-dates/bound — the role-agnostic SAT-date bound, against real Postgres.
 *
 * @spec [owner rulings (Karl): 2026-10-11 on #1204 ruling 2 ("the calendar profile read returns
 *       the furthest accepted test date, and every SAT-date picker … uses that one bound");
 *       2026-10-12 on #1211 ("any signed-in account (including one whose role isn't saved yet)
 *       can read latest_test_date. Use the account's stored timezone if present, else
 *       America/Chicago. Same shared helper as the save, so the read and the write can't
 *       disagree. … The student-only calendar profile routes stay student-only.")]
 * | @implemented [2026-10-12]
 *
 * plain English: real producer through real consumer. The bound route and the calendar router
 * are mounted as server/index.ts mounts them: the bound behind sign-in only, the calendar behind
 * the real `requireStudentOrAdmin`. Then:
 *   - a guardian-intent account (stored role `guardian`, as during onboarding before the switch
 *     is saved) reads the bound, in America/Chicago, while the calendar profile read still
 *     answers it 403;
 *   - once that account is a student, the served date saves through the real PUT and the day
 *     after it is refused, so a date past the bound can never be stored;
 *   - an account with a stored zone a day ahead of Chicago gets a bound a day ahead, as the
 *     write does;
 *   - the body is the date and the correlation id only, even for a student whose profile
 *     carries dates and a score.
 *
 * Substituted: the database client (real SQL through `tests/helpers/pg-supabase`), the session
 * (a canonical `SupabaseUser` per request), CSRF and the rate limiter. NOT substituted: the two
 * routers, `profile-service`, `loadCalendarConfig`, `requireStudentOrAdmin`, the schemas, the
 * migrations.
 */
import express from "express";
import request from "supertest";
import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  addDaysToLocalDate,
  localDateSchema,
} from "../../packages/shared/src/calendar/time";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "sat_date_bound_ci";
const ACCOUNT = "79797979-7979-4797-8797-797979797979";
const ACTOR = "89898989-8989-4898-8898-898989898989";

let pg: Client;
/** The stored role, as the session reads it from `profiles` (what onboarding's save changes). */
let role: "student" | "guardian" = "guardian";

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

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: { canAccessFeature: vi.fn(async () => false) },
}));

async function buildApp(): Promise<express.Express> {
  const { calendarRouter } =
    await import("../../server/routes/calendar-routes");
  const { satDateRouter } = await import("../../server/routes/sat-date-routes");
  const { requireStudentOrAdmin } =
    await import("../../server/middleware/supabase-auth");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.requestId = "sat-bound";
    req.user = {
      id: ACCOUNT,
      email: "switcher@example.test",
      display_name: null,
      role,
      isAdmin: false,
      isGuardian: role === "guardian",
      actor_id: ACTOR,
      // The session carries the age the profile's date of birth gives (16), as the real auth
      // middleware reads it; the student routes' under-13 gate reads it from here (G2-06).
      is_under_13: false,
    };
    next();
  });
  // As server/index.ts mounts them (auth is the fixture above).
  app.use("/api/sat-dates", satDateRouter);
  app.use("/api/calendar", requireStudentOrAdmin, calendarRouter);
  return app;
}

let app: express.Express;

async function maxDays(): Promise<number> {
  const r = await pg.query<{ value: unknown }>(
    `SELECT value FROM public.calendar_runtime_config
      WHERE key = 'target_exam_date_max_days'`,
  );
  return Number(r.rows[0]?.value);
}

function localToday(zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function datesOnly(date: string): Record<string, unknown> {
  return { target_exam_dates: [date], idempotency_key: crypto.randomUUID() };
}

/** A full setup body in a given zone, with a date well inside the window. */
function setupBody(zone: string): Record<string, unknown> {
  return {
    timezone: zone,
    target_exam_date: addDaysToLocalDate(localToday(zone), 60),
    target_score: 1400,
    study_days_mask: 62,
    daily_minutes: 60,
    full_length_weekday: 6,
    full_length_interval_weeks: 2,
    idempotency_key: crypto.randomUUID(),
  };
}

async function setStoredRole(next: "student" | "guardian"): Promise<void> {
  role = next;
  await pg.query(`UPDATE public.profiles SET role = $2 WHERE id = $1`, [
    ACCOUNT,
    next,
  ]);
}

describe.skipIf(!PG_AVAILABLE)(
  "GET /api/sat-dates/bound — role-agnostic, the write's own bound, against real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [
        ACCOUNT,
        "switcher@example.test",
      ]);
      await pg.query(
        // Sixteen: the onboarding switcher this ruling is about (13+, so the under-13 link gate
        // that every student route inherits does not stand in front of the save).
        `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
         VALUES ($1, $2, 'guardian', 'Sam', (current_date - interval '16 years')::date)`,
        [ACCOUNT, "switcher@example.test"],
      );
      app = await buildApp();
    });

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      await pg.query(
        `DELETE FROM public.student_study_profile WHERE student_id = $1`,
        [ACCOUNT],
      );
      await setStoredRole("guardian");
    });

    it("a guardian-intent account reads the bound (Chicago); the calendar profile read stays student-only", async () => {
      const days = await maxDays();
      expect(days).toBeGreaterThan(0);

      const res = await request(app).get("/api/sat-dates/bound");

      expect(res.status).toBe(200);
      expect(localDateSchema.safeParse(res.body.latest_test_date).success).toBe(
        true,
      );
      expect(res.body.latest_test_date).toBe(
        addDaysToLocalDate(localToday("America/Chicago"), days),
      );
      expect(res.body).toEqual({
        latest_test_date: res.body.latest_test_date,
        requestId: "sat-bound",
      });

      const profile = await request(app).get("/api/calendar/profile");
      expect(profile.status).toBe(403);
    });

    it("after the switch to Student: the served date saves, and the day after it is refused", async () => {
      const latest = String(
        (await request(app).get("/api/sat-dates/bound")).body.latest_test_date,
      );
      await setStoredRole("student");

      const accepted = await request(app)
        .put("/api/calendar/profile")
        .send(datesOnly(latest));
      expect(accepted.status).toBe(200);
      expect(accepted.body.profile.target_exam_dates).toEqual([latest]);

      const refused = await request(app)
        .put("/api/calendar/profile")
        .send(datesOnly(addDaysToLocalDate(latest, 1)));
      expect(refused.status).toBe(400);
      const stored = await pg.query<{ target_exam_dates: string[] }>(
        `SELECT target_exam_dates::text[] AS target_exam_dates
           FROM public.student_study_profile WHERE student_id = $1`,
        [ACCOUNT],
      );
      expect(stored.rows[0]?.target_exam_dates).toEqual([latest]);
    });

    it("an account with a stored zone gets that zone's bound, as the write uses it", async () => {
      await setStoredRole("student");
      const zone = "Pacific/Kiritimati"; // UTC+14: a day ahead of Chicago at every hour
      const put = await request(app)
        .put("/api/calendar/profile")
        .send(setupBody(zone));
      expect(put.status).toBe(200);
      expect(put.body.profile.timezone).toBe(zone);

      const res = await request(app).get("/api/sat-dates/bound");
      const latest = String(res.body.latest_test_date);
      expect(latest).toBe(
        addDaysToLocalDate(localToday(zone), await maxDays()),
      );
      expect(
        latest >
          addDaysToLocalDate(localToday("America/Chicago"), await maxDays()),
      ).toBe(true);

      expect(
        (
          await request(app)
            .put("/api/calendar/profile")
            .send(datesOnly(latest))
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .put("/api/calendar/profile")
            .send(datesOnly(addDaysToLocalDate(latest, 1)))
        ).status,
      ).toBe(400);
    });

    it("carries no student data: a student with saved dates and a score reads the date alone", async () => {
      await setStoredRole("student");
      const put = await request(app)
        .put("/api/calendar/profile")
        .send(setupBody("America/Chicago"));
      expect(put.status).toBe(200);
      // Presence first: the profile really has values that could leak.
      expect(put.body.profile.target_score).toBe(1400);
      expect(put.body.profile.target_exam_dates.length).toBe(1);

      const res = await request(app).get("/api/sat-dates/bound");
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        "latest_test_date",
        "requestId",
      ]);
    });
  },
);
