/**
 * The §15 calendar routes — statuses, gates, and what a denial says.
 *
 * @spec [Doc-05F_V1.0 §15, §15.1, §16, §18; Doc_05F_formula_sheet.md §8 items 11, 14;
 *        lyceon-coding-standards §8.1, §8.3] | @implemented [2026-09-21]
 *
 * These are ROUTE tests. The workflow underneath has its own tests
 * (`calendar.{read,plan,profile}-service.test.ts`); here the services are stubbed and the
 * question is only which status each outcome produces and what travels with it.
 *
 * The two load-bearing cases:
 *   - every calendar route answers 402 with the SHARED CTA payload for a caller without
 *     `calendar_access`, and answers it before doing any work;
 *   - `GET /api/me/streak` answers 200 for that SAME caller, because INV-08-20 serves the
 *     streak to any tier. A test that only proved the 402s would pass just as well with the
 *     streak wrongly gated, which is the mistake this pair exists to catch.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const BLOCK_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TODAY = "2026-09-21";

let entitled = true;
const readCalendarMock = vi.fn();
const upsertProfileMock = vi.fn();
const readProfileMock = vi.fn();
const regeneratePlanMock = vi.fn();
const regenerateDayMock = vi.fn();
const editDayMock = vi.fn();
const doItNowMock = vi.fn();
const moveBlockMock = vi.fn();
const acknowledgeMock = vi.fn();
const launchBlockMock = vi.fn();
const streakMock = vi.fn();
const rateLimitCalls: string[] = [];

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: { canAccessFeature: vi.fn(async () => entitled) },
}));

vi.mock("../../server/services/calendar/config", () => ({
  loadCalendarConfig: vi.fn(async () => ({
    bounds: {
      daily_minutes_min: 15,
      daily_minutes_max: 180,
      daily_minutes_presets: [15, 30, 45, 60, 90, 120],
      target_exam_date_max_days: 540,
    },
    horizonDays: 14,
    weeklyJobIntervalMinutes: 1440,
    generatorVersion: "20260917140000",
    // §17.1's "~N min" readout. On the config object because the read service puts it on
    // the ready payload; the route itself never reads it.
    estimates: { practice_seconds_per_unit: 90, review_seconds_per_unit: 120 },
  })),
}));

vi.mock("../../server/services/calendar/read-service", () => ({
  readCalendar: readCalendarMock,
  readGuardianCalendar: vi.fn(),
}));

vi.mock("../../server/services/calendar/profile-service", () => ({
  upsertStudyProfile: upsertProfileMock,
  readStudyProfile: readProfileMock,
  FALLBACK_TIMEZONE: "America/Chicago",
}));

vi.mock("../../server/services/calendar/plan-service", () => ({
  regeneratePlan: regeneratePlanMock,
  regenerateDay: regenerateDayMock,
  editDay: editDayMock,
  doItNow: doItNowMock,
  moveBlock: moveBlockMock,
  acknowledgeVersion: acknowledgeMock,
}));

vi.mock("../../server/services/calendar/launch-service", () => ({
  launchBlock: launchBlockMock,
}));

vi.mock("../../server/services/calendar/launch-deps", () => ({
  liveLaunchDeps: {},
}));

vi.mock("../../server/services/activity-streak", () => ({
  getStudentActivityStreak: streakMock,
}));

// The limiter has its own ledger tests; here it only has to prove it is WIRED, and to which
// bucket. A real one would need the rate_limit ledger tables.
vi.mock("../../server/middleware/rate-limit", () => ({
  singleBucketRateLimit: (bucketKey: string) => (_req: unknown, _res: unknown, next: () => void) => {
    rateLimitCalls.push(bucketKey);
    next();
  },
  applyRateLimitHeaders: vi.fn(),
  denyRateLimited: vi.fn(),
}));

const { calendarRouter, streakRouter } = await import(
  "../../server/routes/calendar-routes"
);

/** @param authenticated false mounts no user, so `callerOf` must answer 401. */
function buildApp(authenticated = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.requestId = "req-test";
    if (authenticated) {
      req.user = {
        id: STUDENT,
        email: "s@example.test",
        display_name: null,
        role: "student",
        isAdmin: false,
        isGuardian: false,
        actor_id: STUDENT,
      };
    }
    next();
  });
  app.use("/api/calendar", calendarRouter);
  app.use("/api/me", streakRouter);
  return app;
}

const OK_DAY = {
  local_date: TODAY,
  timezone: "America/Chicago",
  is_user_override: false,
  is_study_day: true,
  version_no: 3,
  status: "today",
  blocks: [],
  extra_work: [],
  planned_count: 0,
  actual_count: 0,
  extra_count: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitCalls.length = 0;
  entitled = true;
  // A profile EXISTS by default, so the §16 cases below still exercise the gated path.
  // Setup-before-the-gate is the exception and says so explicitly.
  readProfileMock.mockResolvedValue({ timezone: "America/Chicago" });
  readCalendarMock.mockResolvedValue({
    ok: true,
    value: {
      status: "ready",
      profile: {},
      days: [OK_DAY],
      facts: {},
      streak: { current: 3, longest: null, history_complete: false },
      latest_unacknowledged_nonstudent_change: null,
      diagnostic_state: "baseline_ready",
    },
  });
  regeneratePlanMock.mockResolvedValue({ ok: true, value: { version_no: 4 } });
  regenerateDayMock.mockResolvedValue({ ok: true, value: { version_no: 5 } });
  editDayMock.mockResolvedValue({ ok: true, value: { version_no: 6 } });
  doItNowMock.mockResolvedValue({ ok: true, value: { version_no: 7 } });
  moveBlockMock.mockResolvedValue({ ok: true, value: { version_no: 8 } });
  acknowledgeMock.mockResolvedValue({ ok: true, value: true });
  upsertProfileMock.mockResolvedValue({ ok: true, value: { profile: {}, version_no: 8 } });
  launchBlockMock.mockResolvedValue({
    ok: true,
    value: {
      engine: "practice",
      session_id: "5f0a6b1c-2d3e-4f50-8a9b-0c1d2e3f4a5b",
      next: "/practice/session/5f0a6b1c-2d3e-4f50-8a9b-0c1d2e3f4a5b",
      resumed: false,
    },
  });
  streakMock.mockResolvedValue({ current: 3, longest: null, history_complete: false });
});

/**
 * Every mutating route that is GATED, so a new one cannot quietly skip the checks below.
 *
 * `PUT /profile` is deliberately NOT here since 2026-09-24 (SCL-130): setup runs before the
 * entitlement gate, so a free student's answers are saved. Its own behaviour is asserted in
 * "setup runs before the entitlement gate" — removed from this list rather than deleted,
 * because an ungated route with no assertion at all is how a gate goes missing.
 */
const MUTATIONS: { name: string; call: (app: express.Express) => request.Test }[] = [
  { name: "POST /plan/regenerate", call: (app) => request(app).post("/api/calendar/plan/regenerate").send({ idempotency_key: KEY }) },
  { name: "POST /days/:date/regenerate", call: (app) => request(app).post(`/api/calendar/days/${TODAY}/regenerate`).send({ idempotency_key: KEY }) },
  { name: "POST /days/:date/reset", call: (app) => request(app).post(`/api/calendar/days/${TODAY}/reset`).send({ idempotency_key: KEY }) },
  { name: "PUT /days/:date", call: (app) => request(app).put(`/api/calendar/days/${TODAY}`).send({ members: [], idempotency_key: KEY }) },
  { name: "POST /blocks/:id/launch", call: (app) => request(app).post(`/api/calendar/blocks/${BLOCK_ID}/launch`).send({ client_instance_id: "c1", platform: "web" }) },
  { name: "POST /blocks/:id/do-it-now", call: (app) => request(app).post(`/api/calendar/blocks/${BLOCK_ID}/do-it-now`).send({ idempotency_key: KEY }) },
  { name: "POST /blocks/:id/move", call: (app) => request(app).post(`/api/calendar/blocks/${BLOCK_ID}/move`).send({ to_date: TODAY, idempotency_key: KEY }) },
  { name: "POST /acknowledge", call: (app) => request(app).post("/api/calendar/acknowledge").send({ version_no: 3 }) },
];

describe("§16 — every calendar route is gated on calendar_access", () => {
  it("GET /api/calendar answers 402 with the shared CTA payload", async () => {
    entitled = false;

    const res = await request(buildApp()).get("/api/calendar");

    expect(res.status).toBe(402);
    // The flat platform shape the client's `getPremiumDenialReason` gates on: status + a
    // TOP-LEVEL code, deliberately not the §8.2 nested envelope.
    expect(res.body.code).toBe("PAYMENT_REQUIRED");
    expect(readCalendarMock).not.toHaveBeenCalled();
  });

  for (const mutation of MUTATIONS) {
    it(`${mutation.name} answers 402 and does no work`, async () => {
      entitled = false;

      const res = await mutation.call(buildApp());

      expect(res.status).toBe(402);
      expect(res.body.code).toBe("PAYMENT_REQUIRED");
      for (const mock of [regeneratePlanMock, regenerateDayMock, editDayMock, doItNowMock, launchBlockMock, upsertProfileMock, acknowledgeMock]) {
        expect(mock).not.toHaveBeenCalled();
      }
    });
  }
});

describe("INV-08-20 — the streak carries NO calendar_access check", () => {
  it("answers 200 for the very caller every calendar route refuses", async () => {
    entitled = false;

    const res = await request(buildApp()).get("/api/me/streak");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ current: 3, longest: null, history_complete: false });
    expect(streakMock).toHaveBeenCalledWith(STUDENT, "req-test");
  });

  it("still requires an authenticated caller", async () => {
    const res = await request(buildApp(false)).get("/api/me/streak");

    expect(res.status).toBe(401);
    expect(streakMock).not.toHaveBeenCalled();
  });
});

describe("§8.1 — the caller is the session, never the body", () => {
  it("refuses every route without a session", async () => {
    const app = buildApp(false);

    const statuses = await Promise.all([
      request(app).get("/api/calendar").then((r) => r.status),
      ...MUTATIONS.map((m) => m.call(app).then((r) => r.status)),
    ]);

    expect(statuses).toEqual(statuses.map(() => 401));
  });

  it("refuses a body that even MENTIONS a student id — the schema is strict", async () => {
    const res = await request(buildApp())
      .post("/api/calendar/plan/regenerate")
      .send({ idempotency_key: KEY, student_id: "99999999-9999-9999-9999-999999999999" });

    // Stronger than ignoring it: a client that tries to name a subject is told no, rather
    // than being silently served its own plan and left believing the field works.
    expect(res.status).toBe(400);
    expect(regeneratePlanMock).not.toHaveBeenCalled();
  });

  it("passes the SESSION's student id to every service", async () => {
    const app = buildApp();
    await request(app).post("/api/calendar/plan/regenerate").send({ idempotency_key: KEY });
    await request(app).post(`/api/calendar/blocks/${BLOCK_ID}/launch`).send({ client_instance_id: "c1", platform: "web" });

    expect(regeneratePlanMock.mock.calls[0]?.[0].student_id).toBe(STUDENT);
    expect(launchBlockMock.mock.calls[0]?.[0].student_id).toBe(STUDENT);
    expect(readCalendarMock.mock.calls[0]?.[0]?.student_id ?? STUDENT).toBe(STUDENT);
  });
});

describe("§15 — the happy paths and their shapes", () => {
  it("GET /api/calendar returns the payload with a correlation id", async () => {
    const res = await request(buildApp()).get("/api/calendar");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.days).toHaveLength(1);
    expect(res.body.requestId).toBe("req-test");
  });

  it("POST /plan/regenerate sends student_refresh, not weekly", async () => {
    const res = await request(buildApp())
      .post("/api/calendar/plan/regenerate")
      .send({ idempotency_key: KEY });

    expect(res.status).toBe(200);
    expect(res.body.version_no).toBe(4);
    expect(regeneratePlanMock.mock.calls[0]?.[0].trigger).toBe("student_refresh");
    expect(regeneratePlanMock.mock.calls[0]?.[0].initiated_by).toBe("student");
  });

  it("regenerate and reset differ only in the trigger", async () => {
    const app = buildApp();
    await request(app).post(`/api/calendar/days/${TODAY}/regenerate`).send({ idempotency_key: KEY });
    await request(app).post(`/api/calendar/days/${TODAY}/reset`).send({ idempotency_key: KEY });

    const [first, second] = regenerateDayMock.mock.calls;
    expect(first?.[0].trigger).toBe("day_regenerate");
    expect(second?.[0].trigger).toBe("day_reset");
    expect({ ...first?.[0], trigger: null }).toEqual({ ...second?.[0], trigger: null });
  });

  it("PUT /days/:date reads the day BACK rather than echoing the edit", async () => {
    const res = await request(buildApp())
      .put(`/api/calendar/days/${TODAY}`)
      .send({ members: [], idempotency_key: KEY });

    expect(res.status).toBe(200);
    expect(res.body.version_no).toBe(6);
    // The read-back is what surfaces a started block V-12 injected and the client omitted.
    expect(readCalendarMock).toHaveBeenCalled();
    expect(res.body.day.local_date).toBe(TODAY);
  });

  it("POST /blocks/:id/launch returns the engine's own next path", async () => {
    const res = await request(buildApp())
      .post(`/api/calendar/blocks/${BLOCK_ID}/launch`)
      .send({ client_instance_id: "c1", platform: "web" });

    expect(res.status).toBe(200);
    expect(res.body.next).toBe("/practice/session/5f0a6b1c-2d3e-4f50-8a9b-0c1d2e3f4a5b");
    expect(res.body.resumed).toBe(false);
  });

  it("POST /acknowledge answers { ok: true }", async () => {
    const res = await request(buildApp()).post("/api/calendar/acknowledge").send({ version_no: 3 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("§15.1 — the launch body carries no idempotency key", () => {
  it("does not forward a client-supplied key to the service", async () => {
    await request(buildApp())
      .post(`/api/calendar/blocks/${BLOCK_ID}/launch`)
      .send({ client_instance_id: "c1", platform: "web" });

    const request_ = launchBlockMock.mock.calls[0]?.[0];
    expect(request_).not.toHaveProperty("idempotency_key");
  });

  it("refuses a body carrying one, because the schema is strict", async () => {
    const res = await request(buildApp())
      .post(`/api/calendar/blocks/${BLOCK_ID}/launch`)
      .send({ client_instance_id: "c1", platform: "web", idempotency_key: KEY });

    expect(res.status).toBe(400);
    expect(launchBlockMock).not.toHaveBeenCalled();
  });
});

describe("§7 / §15 — the regenerate routes are rate limited, the others are not", () => {
  it("wires the plan bucket to /plan/regenerate", async () => {
    await request(buildApp()).post("/api/calendar/plan/regenerate").send({ idempotency_key: KEY });

    expect(rateLimitCalls).toEqual(["calendar_plan_regenerate"]);
  });

  it("wires the day bucket to both day routes", async () => {
    const app = buildApp();
    await request(app).post(`/api/calendar/days/${TODAY}/regenerate`).send({ idempotency_key: KEY });
    await request(app).post(`/api/calendar/days/${TODAY}/reset`).send({ idempotency_key: KEY });

    expect(rateLimitCalls).toEqual(["calendar_day_regenerate", "calendar_day_regenerate"]);
  });

  it("leaves the read, the day edit and the launch unlimited", async () => {
    const app = buildApp();
    await request(app).get("/api/calendar");
    await request(app).put(`/api/calendar/days/${TODAY}`).send({ members: [], idempotency_key: KEY });
    await request(app).post(`/api/calendar/blocks/${BLOCK_ID}/launch`).send({ client_instance_id: "c1", platform: "web" });

    expect(rateLimitCalls).toEqual([]);
  });
});

describe("§15's error list — every failure gets its own status", () => {
  const planCases: { kind: string; extra?: Record<string, unknown>; status: number; code: string }[] = [
    { kind: "past_date", extra: { date: "2026-09-01" }, status: 409, code: "CALENDAR_PAST_DATE" },
    { kind: "beyond_horizon", extra: { date: "2027-01-01" }, status: 404, code: "CALENDAR_BEYOND_HORIZON" },
    { kind: "no_profile", status: 404, code: "CALENDAR_NO_PROFILE" },
    { kind: "not_found", status: 404, code: "CALENDAR_NOT_FOUND" },
    // SYSTEM-authored: the student asked for a fresh day, but WE composed it
    // (`calendar_regenerate_day` validates in `day_regenerate` mode). Our generator
    // emitting an invalid plan is a fault, so this one stays 500 and keeps §18's alert.
    { kind: "rejected", extra: { authored: "system", violations: [], unreadable: 0 }, status: 500, code: "CALENDAR_PLAN_REJECTED" },
    { kind: "write_failed", extra: { detail: "boom" }, status: 500, code: "CALENDAR_ERROR" },
  ];

  for (const testCase of planCases) {
    it(`a ${testCase.kind} day regeneration is ${testCase.status} ${testCase.code}`, async () => {
      regenerateDayMock.mockResolvedValue({
        ok: false,
        error: { kind: testCase.kind, ...(testCase.extra ?? {}) },
      });

      const res = await request(buildApp())
        .post(`/api/calendar/days/${TODAY}/regenerate`)
        .send({ idempotency_key: KEY });

      expect(res.status).toBe(testCase.status);
      expect(res.body.error.code).toBe(testCase.code);
      expect(res.body.requestId).toBe("req-test");
    });
  }

  /** The shape the validator really returns — objects, never strings. See SCL-131. */
  const V05 = {
    rule: "V-05",
    date: "2026-09-25",
    detail: "planned seconds 5400 exceed the day budget 3600",
  } as const;

  it("a rejected plan tells the student their CURRENT plan is unchanged", async () => {
    regenerateDayMock.mockResolvedValue({
      ok: false,
      error: { kind: "rejected", authored: "system", violations: [V05], unreadable: 0 },
    });

    const res = await request(buildApp())
      .post(`/api/calendar/days/${TODAY}/regenerate`)
      .send({ idempotency_key: KEY });

    expect(res.body.error.message).toContain("unchanged");
    // Still withheld HERE, and for the original reason: this rejection is ours, not the
    // student's, so there is nothing for them to act on. The student-authored case below
    // is the one the ruling changed.
    expect(JSON.stringify(res.body)).not.toContain("V-05");
  });

  describe("a refused DAY EDIT is a decision, not a fault (§15; SCL-131)", () => {
    it("answers 409, not 500 — the request was understood and declined", async () => {
      editDayMock.mockResolvedValue({
        ok: false,
        error: { kind: "rejected", authored: "student", violations: [V05], unreadable: 0 },
      });

      const res = await request(buildApp())
        .put(`/api/calendar/days/${TODAY}`)
        .send({ members: [], idempotency_key: KEY });

      // Production on 2026-09-24 answered 500 here, fifteen times. A 500 tells the client
      // to retry, and this can only fail again until the student changes the day.
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CALENDAR_PLAN_REJECTED");
    });

    it("carries the violations, so the refusal can be explained", async () => {
      editDayMock.mockResolvedValue({
        ok: false,
        error: { kind: "rejected", authored: "student", violations: [V05], unreadable: 0 },
      });

      const res = await request(buildApp())
        .put(`/api/calendar/days/${TODAY}`)
        .send({ members: [], idempotency_key: KEY });

      expect(res.body.error.details.violations).toEqual([V05]);
      // The rule id alone is unactionable; the detail is what names the day and the budget.
      expect(res.body.error.details.violations[0].detail).toContain("budget");
    });

    it("PLANT: an empty violations list still answers 409 and says so", async () => {
      // The pre-fix production shape. It must not read as success, and must not read as a
      // fault either — the status is decided by WHO authored the plan, never by whether we
      // managed to parse the reasons.
      editDayMock.mockResolvedValue({
        ok: false,
        error: { kind: "rejected", authored: "student", violations: [], unreadable: 2 },
      });

      const res = await request(buildApp())
        .put(`/api/calendar/days/${TODAY}`)
        .send({ members: [], idempotency_key: KEY });

      expect(res.status).toBe(409);
      expect(res.body.error.details.violations).toEqual([]);
    });

    it("a REAL fault on the same route is still 500", async () => {
      // The other half of the validation: 409 must not have swallowed the fault case.
      editDayMock.mockResolvedValue({
        ok: false,
        error: { kind: "write_failed", detail: "connection reset" },
      });

      const res = await request(buildApp())
        .put(`/api/calendar/days/${TODAY}`)
        .send({ members: [], idempotency_key: KEY });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("CALENDAR_ERROR");
      // And the operator detail never reaches the student.
      expect(JSON.stringify(res.body)).not.toContain("connection reset");
    });
  });

  const launchCases: { kind: string; extra?: Record<string, unknown>; status: number; code: string }[] = [
    { kind: "not_found", status: 404, code: "CALENDAR_NOT_FOUND" },
    { kind: "not_today", extra: { when: "past", scheduled_date: "2026-09-01", local_today: TODAY }, status: 409, code: "CALENDAR_NOT_TODAY" },
    { kind: "already_complete", extra: { target: 20, actual: 20 }, status: 409, code: "CALENDAR_ALREADY_COMPLETE" },
    { kind: "engine_unavailable", extra: { engine: "review" }, status: 409, code: "CALENDAR_ENGINE_UNAVAILABLE" },
    { kind: "engine_error", extra: { engine: "practice" }, status: 502, code: "CALENDAR_ENGINE_ERROR" },
    { kind: "link_failed", extra: { detail: "boom" }, status: 502, code: "CALENDAR_ENGINE_ERROR" },
  ];

  for (const testCase of launchCases) {
    it(`a ${testCase.kind} launch is ${testCase.status} ${testCase.code}`, async () => {
      launchBlockMock.mockResolvedValue({
        ok: false,
        error: { kind: testCase.kind, ...(testCase.extra ?? {}) },
      });

      const res = await request(buildApp())
        .post(`/api/calendar/blocks/${BLOCK_ID}/launch`)
        .send({ client_instance_id: "c1", platform: "web" });

      expect(res.status).toBe(testCase.status);
      expect(res.body.error.code).toBe(testCase.code);
    });
  }

  it("a past-day launch says WHICH side of today it fell on, so the client can offer Do it now", async () => {
    launchBlockMock.mockResolvedValue({
      ok: false,
      error: { kind: "not_today", when: "past", scheduled_date: "2026-09-01", local_today: TODAY },
    });

    const res = await request(buildApp())
      .post(`/api/calendar/blocks/${BLOCK_ID}/launch`)
      .send({ client_instance_id: "c1", platform: "web" });

    expect(res.body.error.details).toEqual({ when: "past" });
  });

  it("a pre-setup read is a 200 carrying the state, not a 404", async () => {
    // Owner ruling on addendum item 26. A student who has not set up has an EMPTY
    // calendar, not a missing one; a 404 makes every fetch hook treat the most common
    // first visit as an error and log it as one.
    readCalendarMock.mockResolvedValue({
      ok: true,
      value: {
        status: "setup_required",
        defaults: {
          timezone: "America/Chicago",
          daily_minutes_presets: [15, 30, 45, 60, 90, 120],
          daily_minutes_min: 15,
          daily_minutes_max: 180,
          target_exam_date_max_days: 540,
        },
      },
    });

    const res = await request(buildApp()).get("/api/calendar");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("setup_required");
    expect(res.body.defaults.daily_minutes_presets).toEqual([15, 30, 45, 60, 90, 120]);
    expect(res.body.error).toBeUndefined();
  });

  it("the 404 that remains is the MUTATION path, under its own code", async () => {
    // A write against a student with no study profile at all. A correct client never
    // issues it, and it must not be conflated with the pre-setup read.
    regenerateDayMock.mockResolvedValue({ ok: false, error: { kind: "no_profile" } });

    const res = await request(buildApp())
      .post(`/api/calendar/days/${TODAY}/regenerate`)
      .send({ idempotency_key: KEY });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CALENDAR_NO_PROFILE");
  });

  it("a thrown service is a 500 with a correlation id and no detail", async () => {
    readCalendarMock.mockRejectedValue(new Error("calendar_runtime_config: horizon_days is not seeded"));

    const res = await request(buildApp()).get("/api/calendar");

    expect(res.status).toBe(500);
    expect(res.body.requestId).toBe("req-test");
    expect(JSON.stringify(res.body)).not.toContain("horizon_days");
  });
});

describe("§8.1 step 3 — bad input is 400 before any work", () => {
  it("refuses a day route whose date is not a local date", async () => {
    const res = await request(buildApp())
      .post("/api/calendar/days/not-a-date/regenerate")
      .send({ idempotency_key: KEY });

    expect(res.status).toBe(400);
    expect(regenerateDayMock).not.toHaveBeenCalled();
  });

  it("refuses a mutation with no idempotency key (§4.2)", async () => {
    const res = await request(buildApp()).post("/api/calendar/plan/regenerate").send({});

    expect(res.status).toBe(400);
    expect(regeneratePlanMock).not.toHaveBeenCalled();
  });

  it("refuses a block route whose id is not a uuid", async () => {
    const res = await request(buildApp())
      .post("/api/calendar/blocks/not-a-uuid/launch")
      .send({ client_instance_id: "c1", platform: "web" });

    expect(res.status).toBe(404);
    expect(launchBlockMock).not.toHaveBeenCalled();
  });
});

describe("POST /blocks/:id/move (§12.2, §12.4)", () => {
  it("returns the single version that now owns BOTH dates", async () => {
    const res = await request(buildApp())
      .post(`/api/calendar/blocks/${BLOCK_ID}/move`)
      .send({ to_date: "2026-09-25", idempotency_key: KEY });

    expect(res.status).toBe(200);
    expect(res.body.version_no).toBe(8);
    expect(moveBlockMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        block_id: BLOCK_ID,
        to_date: "2026-09-25",
        idempotency_key: KEY,
        generator_version: "20260917140000",
      }),
    );
  });

  it("spends the EXISTING day-scoped rate-limit bucket, not a new one", async () => {
    await request(buildApp())
      .post(`/api/calendar/blocks/${BLOCK_ID}/move`)
      .send({ to_date: "2026-09-25", idempotency_key: KEY });

    // A second bucket would let a caller spend twice the day-scoped budget.
    expect(rateLimitCalls).toEqual(["calendar_day_regenerate"]);
  });

  /**
   * The three §12.2 refusals. Each is an OUTCOME a student can reach with a drag handle, so
   * each answers 409 under its OWN code — the client needs to tell them apart to say the
   * right thing, and a shared code would make all three "something went wrong".
   */
  const REFUSALS: { reason: string; code: string }[] = [
    { reason: "block_started", code: "CALENDAR_BLOCK_STARTED" },
    { reason: "date_in_past", code: "CALENDAR_PAST_DATE" },
    { reason: "same_date", code: "CALENDAR_SAME_DATE" },
  ];

  for (const refusal of REFUSALS) {
    it(`answers 409 ${refusal.code} when the writer refuses with ${refusal.reason}`, async () => {
      moveBlockMock.mockResolvedValue({
        ok: false,
        error: { kind: "move_refused", reason: refusal.reason },
      });

      const res = await request(buildApp())
        .post(`/api/calendar/blocks/${BLOCK_ID}/move`)
        .send({ to_date: "2026-09-25", idempotency_key: KEY });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(refusal.code);
    });
  }

  it("rejects a body with no target date", async () => {
    const res = await request(buildApp())
      .post(`/api/calendar/blocks/${BLOCK_ID}/move`)
      .send({ idempotency_key: KEY });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_BODY");
    expect(moveBlockMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed block id as a 404 rather than reaching the writer", async () => {
    const res = await request(buildApp())
      .post("/api/calendar/blocks/not-a-uuid/move")
      .send({ to_date: "2026-09-25", idempotency_key: KEY });

    expect(res.status).toBe(404);
    expect(moveBlockMock).not.toHaveBeenCalled();
  });
});


// ── Setup before the gate (owner ruling 2026-09-24, SCL-130) ────────────────

describe("setup runs before the entitlement gate", () => {
  it("GET /api/calendar answers setup_required to a FREE student with no profile", async () => {
    entitled = false;
    readProfileMock.mockResolvedValue(null);
    readCalendarMock.mockResolvedValue({
      ok: true,
      value: { status: "setup_required", defaults: { timezone: "America/Chicago" } },
    });

    const res = await request(buildApp()).get("/api/calendar");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("setup_required");
    // The popup needs its bounds, and they come from config rather than from the client.
    expect(res.body.defaults).toBeDefined();
  });

  it("GET /api/calendar still answers 402 to a free student who HAS a profile — the plan is gated", async () => {
    entitled = false;
    readProfileMock.mockResolvedValue({ timezone: "America/Chicago" });

    const res = await request(buildApp()).get("/api/calendar");

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("PAYMENT_REQUIRED");
    // The whole point of checking the profile directly: `readCalendar` runs
    // `generateOnFirstOpen`, and an unentitled student must not get a plan generated.
    expect(readCalendarMock).not.toHaveBeenCalled();
  });

  it("PUT /profile SAVES a free student's answers rather than answering 402", async () => {
    entitled = false;
    upsertProfileMock.mockResolvedValue({ ok: true, value: { status: "ready" } });

    const res = await request(buildApp())
      .put("/api/calendar/profile")
      .send({ daily_minutes: 60, idempotency_key: KEY });

    expect(res.status).toBe(200);
    // "their answers are saved either way" — a popup that discards what it collects is
    // worse than no popup, because the student answers twice and notices.
    expect(upsertProfileMock).toHaveBeenCalled();
  });

  it("a free student pressing straight through — no target score, no exam date — is still saved", async () => {
    entitled = false;
    upsertProfileMock.mockResolvedValue({ ok: true, value: { status: "ready" } });

    const res = await request(buildApp())
      .put("/api/calendar/profile")
      .send({ target_score: null, target_exam_date: null, idempotency_key: KEY });

    expect(res.status).toBe(200);
    expect(upsertProfileMock).toHaveBeenCalled();
  });
});
