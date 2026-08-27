import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const accountMocks = {
  createGuardianLink: vi.fn(),
  revokeGuardianLink: vi.fn(),
  isGuardianLinkedToStudent: vi.fn(),
  getAllGuardianStudentLinks: vi.fn(),
  ensureAccountForUser: vi.fn(),
};

const kpiMocks = {
  buildStudentKpiViewFromCanonical: vi.fn(),
  buildStudentFullLengthReportView: vi.fn(),
  projectGuardianFullLengthReportView: vi.fn(),
};
const calendarMocks = {
  buildCalendarMonthView: vi.fn(),
};
const weaknessViewMocks = {
  buildWeaknessSkillsView: vi.fn(async () => ({
    ok: true,
    count: 0,
    skills: [],
  })),
};

const systemEventInserts: Record<string, unknown>[] = [];
const guardianAuditInserts: Record<string, unknown>[] = [];
let profileSelectError: { message: string } | null = null;

class FakeSelectBuilder {
  private readonly rows: any[];
  private readonly error: any;

  constructor(rows: any[], error: any = null) {
    this.rows = rows;
    this.error = error;
  }

  eq(): this {
    return this;
  }

  in(): this {
    return this;
  }

  gte(): this {
    return this;
  }

  lte(): this {
    return this;
  }

  order(): this {
    return this;
  }

  limit(count: number): this {
    if (count < this.rows.length) {
      this.rows.length = count;
    }
    return this;
  }

  async single() {
    if (this.error) {
      return { data: null, error: this.error };
    }
    const row = this.rows[0] ?? null;
    if (!row) {
      return {
        data: null,
        error: { code: "PGRST116", message: "No rows found" },
      };
    }
    return { data: row, error: null };
  }

  async maybeSingle() {
    if (this.error) {
      return { data: null, error: this.error };
    }
    return { data: this.rows[0] ?? null, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: any[];
          error: any;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({
      data: this.error ? null : this.rows,
      error: this.error,
    }).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

const seed = {
  profiles: [
    {
      id: "student-1",
      role: "student",
      email: "student1@example.com",
      display_name: "Student One",
      created_at: "2026-03-01T00:00:00.000Z",
    },
  ],
  student_study_profile: [
    {
      user_id: "student-1",
      timezone: "America/Chicago",
    },
  ],
  student_study_plan_days: [
    {
      user_id: "student-1",
      day_date: "2026-03-01",
      planned_minutes: 45,
      completed_minutes: 30,
      status: "in_progress",
      focus: [{ section: "Math", weight: 1 }],
      tasks: [{ type: "practice" }],
      is_user_override: true,
      plan_version: 3,
    },
  ],
  student_question_attempts: [
    {
      user_id: "student-1",
      attempted_at: "2026-03-01T15:00:00.000Z",
      is_correct: true,
      time_spent_ms: 120000,
      event_type: null,
    },
  ],
};

vi.mock("../../server/middleware/supabase-auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/middleware/supabase-auth")
  >("../../server/middleware/supabase-auth");
  return {
    ...actual,
    getSupabaseAdmin: vi.fn(() => ({})),
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
      req.requestId ??= "req-guardian-reporting";
      next();
    },
  };
});

vi.mock("../../server/middleware/guardian-entitlement", () => ({
  requireGuardianEntitlement: (req: any, res: any, next: any) => {
    if (req.headers["x-entitled"] === "false") {
      return res
        .status(402)
        .json({ error: "Subscription required", code: "PAYMENT_REQUIRED" });
    }
    next();
  },
}));

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => "test-csrf-token",
}));

vi.mock("../../server/lib/durable-rate-limiter", () => ({
  createDurableRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

const kpiAccessMocks = {
  resolveHistoricalTrendsAccess: vi.fn(async () => false),
};
vi.mock("../../server/services/kpi-access", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/kpi-access")
  >("../../server/services/kpi-access");
  return { ...actual, ...kpiAccessMocks };
});

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "system_event_logs") {
        return {
          insert: async (payload: any) => {
            if (Array.isArray(payload)) {
              systemEventInserts.push(...payload);
            } else {
              systemEventInserts.push(payload);
            }
            return { error: null };
          },
        };
      }

      // WS-GL Phase B: the guardian-link audit trail moved from `guardian_link_audit` —
      // a table that does not exist in production — to `audit_logs`, which does. Owner
      // ruling 2026-08-24. This capture follows the writer; the assertions below follow
      // the new row shape.
      if (table === "audit_logs") {
        return {
          insert: async (payload: any) => {
            if (Array.isArray(payload)) {
              guardianAuditInserts.push(...payload);
            } else if (payload) {
              guardianAuditInserts.push(payload);
            }
            return { error: null };
          },
        };
      }

      const rows = (seed as Record<string, any[]>)[table] ?? [];
      const selectError =
        table === "student_study_profile" ? profileSelectError : null;
      return {
        select: () => new FakeSelectBuilder([...rows], selectError),
        insert: async () => ({ error: null }),
      };
    },
  },
}));

vi.mock("../../server/lib/account", () => accountMocks);
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("../../apps/api/src/services/fullLengthExam", () => ({
  getExamReport: vi.fn(),
}));
vi.mock("../../apps/api/src/services/weakness-view", () => ({
  buildWeaknessSkillsView: weaknessViewMocks.buildWeaknessSkillsView,
}));

import { masteryLevelLabelsFixture } from "../utils/mastery-levels-fixture";

const masteryReadMocks = {
  fetchDomainMasteryRows: vi.fn(async () => []),
};
vi.mock("../../apps/api/src/services/mastery-read", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/services/mastery-read")
  >("../../apps/api/src/services/mastery-read");
  return {
    // buildDomainLevelView is the pure builder under test here — use the real one so
    // the case proves the route's own shaping rather than a stub's.
    buildDomainLevelView: actual.buildDomainLevelView,
    buildSkillLevelView: actual.buildSkillLevelView,
    fetchDomainMasteryRows: masteryReadMocks.fetchDomainMasteryRows,
    fetchSkillMasteryRows: vi.fn(async () => []),
    fetchWeakestSkills: vi.fn(async () => []),
  };
});

vi.mock("../../apps/api/src/services/mastery-levels-read", () => ({
  loadMasteryLevels: vi.fn(async () => masteryLevelLabelsFixture()),
  resetMasteryLevelsCache: vi.fn(),
}));

vi.mock("../../apps/api/src/services/calendar-month-view", () => ({
  buildCalendarMonthView: calendarMocks.buildCalendarMonthView,
}));
vi.mock("../../server/services/canonical-runtime-views", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/canonical-runtime-views")
  >("../../server/services/canonical-runtime-views");
  // Only the IO-bearing builders are stubbed; everything else stays real. `actual` is
  // still imported so that a future stub can be layered over the real module rather than
  // replacing it wholesale.
  void actual;
  return { ...kpiMocks };
});

function buildApp(role: "guardian" | "student" = "guardian") {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = {
      id: role === "guardian" ? "guardian-1" : "student-9",
      role,
      email:
        role === "guardian" ? "guardian@example.com" : "student9@example.com",
    };
    next();
  });
  return app;
}

describe("Guardian reporting runtime contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemEventInserts.length = 0;
    guardianAuditInserts.length = 0;
    profileSelectError = null;
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      // WS-GL Phase B: the real column is `student_profile_id`; `linked_at` does not
      // exist on this table (`created_at` does).
      {
        student_profile_id: "student-1",
        status: "active",
        created_at: "2026-03-01T00:00:00.000Z",
      },
    ]);

    kpiMocks.buildStudentKpiViewFromCanonical.mockResolvedValue({
      modelVersion: "kpi-v1",
      timezone: "America/Chicago",
      week: {
        questionsSolved: 30,
        accuracy: 80,
        explanations: {},
      },
      recency: {
        window: 30,
        totalAttempts: 200,
        accuracy: 78,
        explanations: {},
      },
      metrics: [
        {
          id: "week_questions",
          label: "Questions Solved (7d)",
          kind: "diagnostic",
          unit: "count",
          value: 30,
          explanation: {
            ruleId: "RULE_WEEK_QUESTIONS",
            whatThisMeans: "wq",
            whyThisChanged: "up",
            whatToDoNext: "keep going",
          },
        },
        {
          id: "week_accuracy",
          label: "Accuracy (7d)",
          kind: "diagnostic",
          unit: "percent",
          value: 80,
          explanation: {
            ruleId: "RULE_WEEK_ACCURACY",
            whatThisMeans: "wa",
            whyThisChanged: "up",
            whatToDoNext: "keep going",
          },
        },
        {
          id: "current_streak",
          label: "Current Streak (days)",
          kind: "diagnostic",
          unit: "count",
          value: 3,
          explanation: {
            ruleId: "RULE_CURRENT_STREAK",
            whatThisMeans: "cs",
            whyThisChanged: "active today",
            whatToDoNext: "protect the streak",
          },
        },
        {
          id: "recency_accuracy",
          label: "Accuracy (30d)",
          kind: "diagnostic",
          unit: "percent",
          value: 78,
          explanation: {
            ruleId: "RULE_RECENCY_ACCURACY",
            whatThisMeans: "ra",
            whyThisChanged: "flat",
            whatToDoNext: "maintain",
          },
        },
      ],
      gating: {
        historicalTrends: {
          allowed: true,
          requiredPlan: "paid",
          reason: "allowed",
        },
      },
      measurementModel: {
        official: [],
        weighted: [],
        diagnostic: [
          "week_questions",
          "week_accuracy",
          "current_streak",
          "recency_accuracy",
        ],
      },
    });
    kpiMocks.buildStudentFullLengthReportView.mockImplementation(
      (report: any) => report,
    );
    kpiMocks.projectGuardianFullLengthReportView.mockImplementation(
      (view: any) => view,
    );
    weaknessViewMocks.buildWeaknessSkillsView.mockResolvedValue({
      ok: true,
      count: 0,
      skills: [],
    });
    calendarMocks.buildCalendarMonthView.mockResolvedValue({
      days: [
        {
          day_date: "2026-03-01",
          planned_minutes: 45,
          completed_minutes: 30,
          status: "in_progress",
          attempt_count: 1,
          accuracy: 100,
          avg_seconds_per_question: 120,
          focus: [{ section: "Math" }],
          tasks: [{ type: "practice" }],
          plan_version: 3,
          is_user_override: true,
        },
      ],
      streak: { current: 2, longest: 4 },
    });
  });

  it("returns linked students list and emits guardian_dashboard_viewed", async () => {
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get("/api/guardian/students");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.students)).toBe(true);
    expect(response.body.students).toHaveLength(1);
    expect(response.body.students[0]).toMatchObject({
      id: "student-1",
      display_name: "Student One",
    });

    const dashboardViewed = systemEventInserts.find(
      (row) => row.event_type === "guardian_dashboard_viewed",
    );
    expect(dashboardViewed).toBeDefined();
    expect(dashboardViewed).toMatchObject({
      user_id: "guardian-1",
      details: expect.objectContaining({
        linked_student_count: 1,
      }),
    });
  });

  it("fails closed when guardian link source lookup fails for students list", async () => {
    accountMocks.getAllGuardianStudentLinks.mockRejectedValueOnce(
      new Error("guardian_links_source_failed"),
    );
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get("/api/guardian/students");

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error");
    const dashboardViewed = systemEventInserts.find(
      (row) => row.event_type === "guardian_dashboard_viewed",
    );
    expect(dashboardViewed).toBeUndefined();
  });

  it("fails closed on unlink conflict when link is no longer active and does not emit unlink success audit", async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
    const conflict = new Error("Guardian link is not active") as Error & {
      code?: string;
    };
    conflict.code = "LINK_NOT_ACTIVE";
    accountMocks.revokeGuardianLink.mockRejectedValueOnce(conflict);
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).delete("/api/guardian/link/student-1");

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("LINK_NOT_ACTIVE");
    const unlinkSuccess = guardianAuditInserts.find(
      (row: any) => row.action === "guardian_link_revoked",
    );
    expect(unlinkSuccess).toBeUndefined();
  });

  it("keeps valid unlink transition behavior and emits unlink success audit", async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
    // `revokeGuardianLink` returns the revoked row now (§36.3 needs `revoked_at`,
    // `revoked_by_profile_id` and `revocation_reason` to be observable).
    accountMocks.revokeGuardianLink.mockResolvedValueOnce({
      id: "11111111-1111-1111-1111-111111111111",
      guardian_profile_id: "guardian-1",
      student_profile_id: "student-1",
      status: "revoked",
    });
    accountMocks.getAllGuardianStudentLinks.mockResolvedValueOnce([]);
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).delete("/api/guardian/link/student-1");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.students).toEqual([]);
    const unlinkSuccess = guardianAuditInserts.find(
      (row: any) => row.action === "guardian_link_revoked",
    );
    expect(unlinkSuccess).toBeDefined();
    expect(unlinkSuccess).toMatchObject({
      actor_profile_id: "guardian-1",
      target_profile_id: "student-1",
    });
  });

  it("denies non-guardian users at guardian reporting routes", async () => {
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("student");
    app.use("/api/guardian", router);

    const response = await request(app).get(
      "/api/guardian/students/student-1/summary",
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Guardian role required");
  });

  it("denies entitlement-gated summary surfaces when entitlement check fails", async () => {
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app)
      .get("/api/guardian/students/student-1/summary")
      .set("x-entitled", "false");

    expect(response.status).toBe(402);
    expect(response.body.code).toBe("PAYMENT_REQUIRED");
  });

  it("returns guardian-safe summary payload and emits guardian_report_viewed", async () => {
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get(
      "/api/guardian/students/student-1/summary",
    );

    expect(response.status).toBe(200);
    // `student: {id, displayName}` was a guardian-ONLY addition — a key the student's own
    // KPI body never had, so it broke the strict-subset invariant (Doc 04C #7). The
    // dashboard already knows which student it selected; it does not need the server to
    // name them back inside a KPI payload.
    expect(response.body).not.toHaveProperty("student");
    expect(response.body).not.toHaveProperty("progress");
    expect(response.body.questions).toBeUndefined();
    expect(response.body.correct_answer).toBeUndefined();
    expect(response.body.explanation).toBeUndefined();
    expect(response.body.tutorInteractions).toBeUndefined();
    expect(response.body.mastery_score).toBeUndefined();
    expect(kpiMocks.buildStudentKpiViewFromCanonical).toHaveBeenCalledTimes(1);
    // THIS ASSERTION USED TO READ `true`, AND THAT WAS THE DEFECT IT PINNED.
    //   The guardian route hardcoded `true` while the student route derived the flag from
    //   the student's own entitlement, fail-closed — so a guardian saw a premium surface
    //   the student's entitlement denied the student. Doc 04C invariant #7: "Guardians
    //   MUST NOT see fields the student does not see." A green test asserting `true` is
    //   not a specification; it was the divergence, written down.
    //   Both paths now call resolveHistoricalTrendsAccess, subject = the student.
    expect(kpiAccessMocks.resolveHistoricalTrendsAccess).toHaveBeenCalledWith(
      "student-1",
    );
    expect(kpiMocks.buildStudentKpiViewFromCanonical).toHaveBeenCalledWith(
      "student-1",
      false,
    );
    // `progress` is gone. The same three numbers live in `metrics` — where the student has
    // them — and are asserted from there below. Two shapes for one fact was the
    // duplication ruled out in Q4.
    const metrics = response.body.metrics as Array<{
      id: string;
      value: number | null;
    }>;
    const metricValue = (id: string): number | null | undefined =>
      metrics.find((metric) => metric.id === id)?.value;
    // EVERY metric the builder emitted, in order. Not a guardian-granted subset: the
    // allowlist that produced one was deleted 2026-08-26 (owner ruling) — it was the field
    // list of the removed `progress` block, and it re-decided statically what the
    // entitlement gate already decides dynamically.
    expect(metrics.map((metric) => metric.id)).toEqual([
      "week_questions",
      "week_accuracy",
      "current_streak",
      "recency_accuracy",
    ]);
    expect(metricValue("week_questions")).toBe(30);
    expect(metricValue("week_accuracy")).toBe(80);
    expect(metricValue("current_streak")).toBe(3);
    expect(metricValue("recency_accuracy")).toBe(78);
    // PASSED THROUGH from the builder, unfiltered — it is the student's value verbatim.
    // The guardian projection used to hardcode `official: []` / `weighted: []` and rebuild
    // `diagnostic` from its own filtered list; the literals could never track the builder,
    // so if it ever populated official/weighted the guardian's copy stayed empty forever.
    //
    // `diagnostic` names `recency_accuracy` and the guardian now RECEIVES `recency_accuracy`
    // — the description and the payload agree again. The mismatch flagged as owner question
    // 2 was the metric filter, not the diagnostic list, and it went with the filter.
    expect(response.body.measurementModel).toEqual({
      official: [],
      weighted: [],
      diagnostic: [
        "week_questions",
        "week_accuracy",
        "current_streak",
        "recency_accuracy",
      ],
    });
    // Old-gen engagement metrics are dropped under the genesis event vocabulary. Note that
    // `recency_accuracy` is NOT one of them — it is a live, entitlement-gated metric and is
    // asserted present above.
    expect(
      metrics.find((metric) => metric.id === "week_minutes"),
    ).toBeUndefined();
    expect(
      metrics.find((metric) => metric.id === "week_sessions"),
    ).toBeUndefined();

    const reportViewed = systemEventInserts.find(
      (row) => row.event_type === "guardian_report_viewed",
    );
    expect(reportViewed).toBeDefined();
    expect(reportViewed).toMatchObject({
      user_id: "guardian-1",
      details: expect.objectContaining({
        student_id: "student-1",
        surface: "summary",
      }),
    });
  });

  it("returns guardian-safe calendar payload and emits guardian_calendar_viewed", async () => {
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get(
      "/api/guardian/students/student-1/calendar/month?start=2026-03-01&end=2026-03-31",
    );

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.days)).toBe(true);
    expect(response.body.days.length).toBeGreaterThan(0);

    const day = response.body.days[0];
    expect(day).toMatchObject({
      day_date: "2026-03-01",
      planned_minutes: 45,
      completed_minutes: 30,
      status: "in_progress",
      attempt_count: 1,
      accuracy: 100,
    });
    expect(day.focus).toBeUndefined();
    expect(day.tasks).toBeUndefined();
    expect(day.plan_version).toBeUndefined();
    expect(day.is_user_override).toBeUndefined();
    expect(calendarMocks.buildCalendarMonthView).toHaveBeenCalledWith(
      "student-1",
      "2026-03-01",
      "2026-03-31",
      "America/Chicago",
    );

    const calendarViewed = systemEventInserts.find(
      (row) => row.event_type === "guardian_calendar_viewed",
    );
    expect(calendarViewed).toBeDefined();
    expect(calendarViewed).toMatchObject({
      user_id: "guardian-1",
      details: expect.objectContaining({
        student_id: "student-1",
        surface: "calendar",
      }),
    });
  });

  it("fails closed when canonical student KPI snapshot source fails", async () => {
    kpiMocks.buildStudentKpiViewFromCanonical.mockRejectedValueOnce(
      new Error("snapshot_failed"),
    );
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get(
      "/api/guardian/students/student-1/summary",
    );

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error");
    const reportViewed = systemEventInserts.find(
      (row) => row.event_type === "guardian_report_viewed",
    );
    expect(reportViewed).toBeUndefined();
  });

  it("fails closed when canonical student calendar source fails", async () => {
    calendarMocks.buildCalendarMonthView.mockRejectedValueOnce(
      new Error("calendar_source_failed"),
    );
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get(
      "/api/guardian/students/student-1/calendar/month?start=2026-03-01&end=2026-03-31",
    );

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error");
    const calendarViewed = systemEventInserts.find(
      (row) => row.event_type === "guardian_calendar_viewed",
    );
    expect(calendarViewed).toBeUndefined();
  });

  it("fails closed when calendar timezone source query fails", async () => {
    profileSelectError = { message: "profile_timezone_query_failed" };
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get(
      "/api/guardian/students/student-1/calendar/month?start=2026-03-01&end=2026-03-31",
    );

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Failed to load calendar data");
    const calendarViewed = systemEventInserts.find(
      (row) => row.event_type === "guardian_calendar_viewed",
    );
    expect(calendarViewed).toBeUndefined();
  });

  it("fails closed when canonical weakness view source fails", async () => {
    masteryReadMocks.fetchDomainMasteryRows.mockRejectedValueOnce(
      new Error("domain_mastery_fetch_failed"),
    );

    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get(
      "/api/guardian/weaknesses/student-1",
    );

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error");
    const weaknessViewed = systemEventInserts.find(
      (row) =>
        row.event_type === "guardian_report_viewed" &&
        (row.details as any)?.surface === "weaknesses",
    );
    expect(weaknessViewed).toBeUndefined();
  });

  it("returns canonical student domain mastery payload (AC#19 domain-grain)", async () => {
    // Canonical DB values: section is 'M'/'RW' (CHECK-constrained) and the domain is
    // the College Board display string. The old fixture said "math", which the
    // database would reject and which now matches no canonical pair.
    masteryReadMocks.fetchDomainMasteryRows.mockResolvedValueOnce([
      { section: "M", domain: "Algebra", mastery_level: 1 },
    ]);

    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get(
      "/api/guardian/weaknesses/student-1",
    );

    expect(response.status).toBe(200);
    // All eight canonical domains are present, not just the one with a row: a guardian
    // sees the same picture the student does (owner ruling R4 / RULE 6). A domain with
    // no events carries the `unmeasured` label rather than being absent.
    expect(response.body.ok).toBe(true);
    // `count` is deliberately absent — it was a second shape of `domains.length`, and it
    // is the field the broken client branched on. Parity with the student envelope is
    // asserted in tests/ci/guardian-student-path-parity.contract.test.ts.
    expect(response.body).not.toHaveProperty("count");
    expect(response.body.domains).toHaveLength(8);
    expect(
      response.body.domains.find(
        (d: { section: string; domain: string }) =>
          d.section === "M" && d.domain === "Algebra",
      ),
    ).toEqual(
      expect.objectContaining({
        section: "M",
        domain: "Algebra",
        levelKey: "L1",
        level: 1,
        displayName: "Building",
      }),
    );
    // NULL is a distinct state, never level 0 (RULE 3 / RULE 6).
    expect(
      response.body.domains.find(
        (d: { section: string; domain: string }) =>
          d.section === "RW" && d.domain === "Expression of Ideas",
      ),
    ).toEqual(
      expect.objectContaining({
        levelKey: "unmeasured",
        level: null,
        displayName: "Not enough answers yet",
      }),
    );
    expect(masteryReadMocks.fetchDomainMasteryRows).toHaveBeenCalledWith({
      userId: "student-1",
      section: undefined,
    });
    const weaknessViewed = systemEventInserts.find(
      (row) =>
        row.event_type === "guardian_report_viewed" &&
        (row.details as any)?.surface === "weaknesses",
    );
    expect(weaknessViewed).toBeDefined();
  });

  it("projects guardian weakness output as domain-grain without raw mastery internals (AC#19)", async () => {
    masteryReadMocks.fetchDomainMasteryRows.mockResolvedValue([
      { section: "M", domain: "Algebra", mastery_level: 1 },
      { section: "RW", domain: "Information and Ideas", mastery_level: 2 },
    ]);

    const guardianRouter = (await import("../../server/routes/guardian-routes"))
      .default;
    const guardianApp = buildApp("guardian");
    guardianApp.use("/api/guardian", guardianRouter);

    const guardianResponse = await request(guardianApp).get(
      "/api/guardian/weaknesses/student-1",
    );

    expect(guardianResponse.status).toBe(200);
    expect(guardianResponse.body.domains).toHaveLength(8);
    const byPair = (section: string, domain: string) =>
      guardianResponse.body.domains.find(
        (d: { section: string; domain: string }) =>
          d.section === section && d.domain === domain,
      );
    expect(byPair("M", "Algebra")).toEqual(
      expect.objectContaining({
        levelKey: "L1",
        level: 1,
        displayName: "Building",
      }),
    );
    expect(byPair("RW", "Information and Ideas")).toEqual(
      expect.objectContaining({
        levelKey: "L2",
        level: 2,
        displayName: "Developing",
      }),
    );
    const json = JSON.stringify(guardianResponse.body);
    expect(json).not.toContain('"mastery_score"');
    expect(json).not.toContain('"accuracy"');
    expect(json).not.toContain('"accuracyPercent"');
    // RULE 7: guardians get domain grain only — no drill-down, and no skill array to
    // drill into.
    expect(json).not.toContain('"skills"');
  });

  it("guardian inherits the STUDENT's historical-trends entitlement, not a wider one", async () => {
    // The subject is the student on both paths. When the student is entitled, the guardian
    // sees trends; when the student is not, neither does the guardian. The guardian's own
    // status never widens it.
    kpiAccessMocks.resolveHistoricalTrendsAccess.mockResolvedValueOnce(true);
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);
    await request(app)
      .get("/api/guardian/students/student-1/summary")
      .expect(200);
    expect(kpiAccessMocks.resolveHistoricalTrendsAccess).toHaveBeenCalledWith(
      "student-1",
    );
    expect(kpiMocks.buildStudentKpiViewFromCanonical).toHaveBeenCalledWith(
      "student-1",
      true,
    );
  });

  it("a failed entitlement read narrows the guardian view, never widens it", async () => {
    // Fail-closed. An error is not an entitlement: an unreadable entitlement must hide the
    // premium surface, not grant it. The mutation this catches is `?? true` / a catch that
    // defaults open.
    kpiAccessMocks.resolveHistoricalTrendsAccess.mockResolvedValueOnce(false);
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);
    await request(app)
      .get("/api/guardian/students/student-1/summary")
      .expect(200);
    expect(kpiMocks.buildStudentKpiViewFromCanonical).toHaveBeenCalledWith(
      "student-1",
      false,
    );
  });

  it("denies unlinked guardian summary requests and emits denied event", async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(false);

    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get(
      "/api/guardian/students/student-1/summary",
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Student not found");

    const denied = systemEventInserts.find(
      (row) => row.event_type === "guardian_access_denied",
    );
    expect(denied).toBeDefined();
    expect(denied).toMatchObject({
      user_id: "guardian-1",
      details: expect.objectContaining({
        student_id: "student-1",
        surface: "summary",
        reason: "not_linked",
      }),
    });
  });
});
