/**
 * @spec [Doc 05 Parent AC#20 / RB-05P-V1-14 — student AND guardian read surfaces return
 *   `mastery_level` and entity identifiers only; `mastery_score` / `mastery_pct` are
 *   admin/internal/audit-only. Doc 05 Parent AC#19 — no guardian route exposes per-skill
 *   rows, per-question rows, or audit rows. Doc 05B §10.5 — column projection, never
 *   `SELECT *` then serialise. Doc 04C invariant #7 — the guardian payload is a strict
 *   SUBSET of the student payload. Owner ruling 2026-08-23 — "the guardian sees exactly
 *   what the student sees, no more and no less."]
 * | @implemented [2026-08-24]
 *
 * plain English: every guardian route that returns data is driven with service rows that
 * carry ALL of the forbidden columns, and the response is walked to every depth to prove
 * each one was stripped.
 *
 * WHY THIS FILE EXISTS AT ALL.
 *   `tests/ci/mastery.anti-leak.ci.test.ts` holds the recursive nine-key walk — and sets
 *   `isGuardian: false`. It has never once run against a guardian path. Guardian coverage
 *   was two flat string assertions in guardian-reporting.contract.test.ts, and the MA-07
 *   leak (#419) rode one layer down inside a spread. A flat check passes that.
 *
 *   So the gate that exists to catch RULE-4 exposure had never run against the surface
 *   where the trust stakes are highest: a parent, looking at a child's data. That is the
 *   ninth instance in this vertical of a check that looks like coverage and is not.
 *
 * WHY THE MOCKS RETURN THE FORBIDDEN COLUMNS.
 *   Feeding a route clean rows can only prove it did not INVENT a leak. These rows carry
 *   the columns exactly as the real tables do, so a pass proves the route STRIPS them. The
 *   mutation this is built to catch is one character: `...row` instead of naming fields.
 *
 * WHY THE FORBIDDEN SET IS NOT COPIED FROM THE STUDENT MASTERY GATE.
 *   That gate forbids bare `accuracy` — correct for a mastery surface, where an accuracy
 *   figure is a probability framing RULE 4 bans. It is WRONG for the KPI surface: the
 *   owner's Q1 ruling (2026-08-23) is that a 7-day accuracy the student sees on their own
 *   dashboard is not "raw" internal machinery, it is the same derived aggregate read
 *   through a gate. Copying the mastery list wholesale would fail the build on a value the
 *   owner explicitly sanctioned. So the set is split: RULE-4 machinery is forbidden
 *   everywhere; the mastery-display extras are forbidden on the mastery surface only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { masteryLevelLabelsFixture } from "../utils/mastery-levels-fixture";

const GUARDIAN_ID = "guardian-1";
const STUDENT_ID = "student-1";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// The forbidden sets
// ---------------------------------------------------------------------------

/**
 * RULE-4 machinery. Forbidden on EVERY guardian surface, at every depth. The nine columns
 * of owner ruling 2026-08-20 RULE 4, plus RULE 9's raw confidence float, plus the KPI
 * admin-only columns Doc 05B §10.5 names.
 */
const RULE_4_KEYS = [
  "mastery_score",
  "mastery_pct",
  "acc_test",
  "acc_practice",
  "acc_review",
  "event_count_total",
  "constants_snapshot_hash",
  "mastery_model_version",
  "last_event_id",
  "last_event_occurred_at",
  "confidence",
  // Doc 05B §10.5 / §6.7 — KPI admin-only columns.
  "refreshed_at",
  "refreshed_at_t_now",
  "kpi_refresh_version",
  // Doc 05C §10.5 — projection blend anchors.
  "mastery_term",
  "fl1_score",
  "fl2_score",
  "blend_denominator",
  "projection_constants_hash",
] as const;

/**
 * Mastery-surface extras. A domain-mastery response carries a LEVEL and the NAME of that
 * level; an accuracy or percentage there is the probability framing RULE 4 forbids. NOT
 * applied to the KPI surface — see the header note on the Q1 ruling.
 */
const MASTERY_SURFACE_EXTRA_KEYS = [
  "accuracy",
  "accuracyPercent",
  "avgMastery",
  "overallAccuracy",
  "tier",
] as const;

/** Every RULE-4 column, exactly as the real tables carry them. Never serialised. */
const INTERNAL_COLUMNS = {
  mastery_score: 0.42,
  mastery_pct: 42,
  acc_test: 0.4,
  acc_practice: 0.44,
  acc_review: 0.41,
  event_count_total: 37,
  constants_snapshot_hash: "0f2037d1deadbeef",
  mastery_model_version: "v1.0",
  last_event_id: "evt-999",
  last_event_occurred_at: "2026-08-01T00:00:00.000Z",
  refreshed_at: "2026-08-01T00:00:00.000Z",
  refreshed_at_t_now: "2026-08-01T00:00:00.000Z",
  kpi_refresh_version: 7,
};

// ---------------------------------------------------------------------------
// Recursive walk — the MA-07 leak was one layer down inside a spread
// ---------------------------------------------------------------------------

function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectKeys(entry, into);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      into.add(key);
      collectKeys(child, into);
    }
  }
}

function assertNoForbiddenKeys(
  surface: string,
  body: unknown,
  forbidden: readonly string[],
): void {
  const keys = new Set<string>();
  collectKeys(body, keys);
  const found = forbidden.filter((key) => keys.has(key));
  expect(
    found,
    `${surface}: response carries forbidden key(s) ${JSON.stringify(found)} at some depth`,
  ).toEqual([]);
}

// ---------------------------------------------------------------------------
// Service doubles. Every one returns rows carrying INTERNAL_COLUMNS.
// ---------------------------------------------------------------------------

const accountMocks = {
  isGuardianLinkedToStudent: vi.fn(async () => true),
  getAllGuardianStudentLinks: vi.fn(async () => [
    { student_user_id: STUDENT_ID },
  ]),
  createGuardianLink: vi.fn(),
  revokeGuardianLink: vi.fn(),
  ensureAccountForUser: vi.fn(async () => ({ id: "acc-1" })),
};

/**
 * SEAM CHOICE — the row layer, exactly where the student gate mocks.
 *   Mocking `readDomainMasteryView` instead would inject junk DOWNSTREAM of the sanitizer
 *   and then assert the route sanitizes again. That tests nothing: the real function never
 *   emits these columns, so the failure would be the mock's, not the code's. Mocking
 *   `fetchDomainMasteryRows` lets the REAL view builder run, which is the thing that has to
 *   strip.
 */
const fetchDomainMasteryRows = vi.fn(async () => [
  {
    section: "M",
    domain: "Algebra",
    mastery_level: 2,
    ...INTERNAL_COLUMNS,
  },
]);

const kpiMocks = {
  buildStudentKpiViewFromCanonical: vi.fn(async () => ({
    modelVersion: "kpi-v1",
    timezone: "America/Chicago",
    week: { start: "2026-08-17", end: "2026-08-23" },
    recency: { lastActiveAt: "2026-08-23T00:00:00.000Z" },
    metrics: [
      {
        id: "week_questions",
        label: "Questions (7d)",
        value: 12,
        explanation: { whatThisMeans: "…" },
      },
      {
        id: "week_accuracy",
        label: "Accuracy (7d)",
        value: 75,
        explanation: { whatThisMeans: "…" },
      },
      {
        id: "current_streak",
        label: "Streak",
        value: 3,
        explanation: { whatThisMeans: "…" },
      },
    ],
    gating: { historicalTrends: { allowed: false } },
    measurementModel: { official: [], weighted: [], diagnostic: [] },
  })),
};

const examMocks = {
  listExamSessions: vi.fn(async () => [
    {
      sessionId: SESSION_ID,
      status: "completed",
      startedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T03:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      module2_path: "B", // Doc 04C §2.3 — never student/guardian-facing.
      ...INTERNAL_COLUMNS,
    },
  ]),
  /**
   * `buildStudentFullLengthReportView` does `...report` — a SPREAD, which is precisely the
   * MA-07 chokepoint (#419): a new field on a spread object bypasses per-field null-outs.
   * So the internal columns are injected HERE, upstream of both real builders, and both the
   * student view and the guardian projection are left REAL. Mocking the projection would
   * have made this case pass vacuously by stripping in the double.
   */
  getExamReport: vi.fn(async () => ({
    sessionId: SESSION_ID,
    scaledScore: { total: 1200, rw: 600, math: 600 },
    rawScore: { total: { correct: 40, total: 54 } },
    sections: [{ section: "M", scaledScore: 600, ...INTERNAL_COLUMNS }],
    ...INTERNAL_COLUMNS,
  })),
};

const calendarMocks = {
  buildCalendarMonthView: vi.fn(async () => ({
    days: [
      {
        day_date: "2026-08-01",
        planned_minutes: 45,
        completed_minutes: 30,
        status: "in_progress",
        attempt_count: 4,
        accuracy: 75,
        avg_seconds_per_question: 42,
        ...INTERNAL_COLUMNS,
      },
    ],
    streak: { current: 3, longest: 5 },
  })),
};

vi.mock("../../server/lib/account", () => accountMocks);
vi.mock("../../apps/api/src/services/mastery-read", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/services/mastery-read")
  >("../../apps/api/src/services/mastery-read");
  return { ...actual, fetchDomainMasteryRows };
});
vi.mock("../../apps/api/src/services/mastery-levels-read", () => ({
  loadMasteryLevels: vi.fn(async () => masteryLevelLabelsFixture()),
  resetMasteryLevelsCache: vi.fn(),
}));
vi.mock("../../server/services/canonical-runtime-views", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/canonical-runtime-views")
  >("../../server/services/canonical-runtime-views");
  // The KPI projection is gone (owner ruling 2026-08-26); the guardian route returns the
  // builder's view directly, so the route itself is what this gate walks.
  return { ...actual, ...kpiMocks };
});
vi.mock("../../apps/api/src/services/fullLengthExam", () => examMocks);
vi.mock("../../apps/api/src/services/calendar-month-view", () => ({
  ...calendarMocks,
  isCalendarCountedEventType: () => true,
}));
vi.mock("../../server/services/kpi-access", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/kpi-access")
  >("../../server/services/kpi-access");
  return { ...actual, resolveHistoricalTrendsAccess: vi.fn(async () => false) };
});

// Gate doubles — denial behaviour is proved by guardian-reporting.contract.test.ts.
vi.mock("../../server/middleware/supabase-auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/middleware/supabase-auth")
  >("../../server/middleware/supabase-auth");
  return {
    ...actual,
    getSupabaseAdmin: vi.fn(() => ({})),
    requireSupabaseAuth: (
      req: express.Request,
      _res: unknown,
      next: () => void,
    ) => {
      (req as express.Request & { requestId?: string }).requestId ??=
        "req-guardian-antileak";
      next();
    },
  };
});
vi.mock("../../server/middleware/guardian-entitlement", () => ({
  requireGuardianEntitlement: (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ) => next(),
}));
vi.mock("../../server/middleware/guardian-role", () => ({
  requireGuardianRole: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));
vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  generateToken: () => "test-csrf-token",
}));
vi.mock("../../server/lib/durable-rate-limiter", () => ({
  createDurableRateLimiter:
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      const rows =
        table === "profiles"
          ? [
              {
                id: STUDENT_ID,
                role: "student",
                email: "student@example.com",
                display_name: "Student One",
                created_at: "2026-03-01T00:00:00.000Z",
                ...INTERNAL_COLUMNS,
              },
            ]
          : table === "student_study_profile"
            ? [{ user_id: STUDENT_ID, timezone: "America/Chicago" }]
            : [];
      // The fake HONOURS `.select(...)`, projecting to the named columns. Without that,
      // a route that regressed to `.select("*")` would look identical to one naming a safe
      // column list — the check would pass on both, which is no check at all.
      let projected = rows;
      const builder = {
        select: (columns?: string) => {
          if (typeof columns === "string" && columns !== "*") {
            const names = columns.split(",").map((c) => c.trim());
            projected = rows.map((row) =>
              Object.fromEntries(
                names
                  .filter((n) => n in (row as Record<string, unknown>))
                  .map((n) => [n, (row as Record<string, unknown>)[n]]),
              ),
            ) as typeof rows;
          }
          return builder;
        },
        eq: () => builder,
        in: () => builder,
        gte: () => builder,
        lte: () => builder,
        order: () => builder,
        limit: () => builder,
        insert: async () => ({ error: null }),
        single: async () => ({ data: projected[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: projected[0] ?? null, error: null }),
        then: (
          onfulfilled?: (v: { data: unknown[]; error: null }) => unknown,
        ) =>
          Promise.resolve({ data: projected, error: null }).then(onfulfilled),
      };
      return builder;
    },
  },
}));

async function buildGuardianApp() {
  const router = (await import("../../server/routes/guardian-routes")).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (
      req as express.Request & {
        user?: { id: string; role: string; email: string };
        requestId?: string;
      }
    ).user = {
      id: GUARDIAN_ID,
      role: "guardian",
      email: "guardian@example.com",
    };
    next();
  });
  app.use("/api/guardian", router);
  return app;
}

describe("Guardian surfaces strip every RULE-4 column, at every depth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      { student_user_id: STUDENT_ID },
    ]);
  });

  // `/guardian/weaknesses/:studentId` and `/guardian/students/:studentId/summary` are GONE
  // (PR 2). Both were guardian-only paths to a resource that also had a student twin, and
  // every such twin in this vertical produced a privilege divergence. They are now
  // `/api/students/:studentId/mastery/domains` and `/kpi/overall`, walked for RULE-4 keys on
  // BOTH `via` values by tests/ci/student-resources.contract.test.ts — which is the gap this
  // file never covered: it sets `isGuardian: false` and has never exercised a guardian path.
  it("full-length history — /guardian/students/:studentId/exams/full-length/sessions", async () => {
    const res = await request(await buildGuardianApp()).get(
      `/api/guardian/students/${STUDENT_ID}/exams/full-length/sessions`,
    );
    expect(res.status).toBe(200);
    assertNoForbiddenKeys("exam-sessions", res.body, RULE_4_KEYS);
    // Doc 04C §2.3 — the routed Module 2 path is never guardian-facing.
    const keys = new Set<string>();
    collectKeys(res.body, keys);
    expect(keys.has("module2_path")).toBe(false);
  }, 15000);

  it("full-length report — /guardian/students/:studentId/tests/:sessionId/report", async () => {
    const res = await request(await buildGuardianApp()).get(
      `/api/guardian/students/${STUDENT_ID}/tests/${SESSION_ID}/report`,
    );
    expect(res.status).toBe(200);
    assertNoForbiddenKeys("exam-report", res.body, RULE_4_KEYS);
  }, 15000);

  it("calendar month — /guardian/students/:studentId/calendar/month", async () => {
    const res = await request(await buildGuardianApp()).get(
      `/api/guardian/students/${STUDENT_ID}/calendar/month?start=2026-08-01&end=2026-08-31`,
    );
    expect(res.status).toBe(200);
    // `accuracy` is a per-day engagement figure the student's own calendar shows.
    assertNoForbiddenKeys("calendar", res.body, RULE_4_KEYS);
  }, 15000);

  it("linked students — /guardian/students", async () => {
    const res = await request(await buildGuardianApp()).get(
      "/api/guardian/students",
    );
    expect(res.status).toBe(200);
    assertNoForbiddenKeys("students", res.body, RULE_4_KEYS);
  }, 15000);

  it("the walk itself catches a leak one layer down (gate self-check)", () => {
    // Without this, a walk that silently stopped at depth 1 would make every case above
    // pass vacuously — which is exactly how the MA-07 leak survived a top-level check.
    const nested = { ok: true, data: { nodes: [{ mastery_score: 0.42 }] } };
    expect(() =>
      assertNoForbiddenKeys("self-check", nested, RULE_4_KEYS),
    ).toThrow();
  });
});
