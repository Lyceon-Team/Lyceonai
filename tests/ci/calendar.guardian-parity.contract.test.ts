import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const accountMocks = vi.hoisted(() => ({
  isGuardianLinkedToStudent: vi.fn(async () => true),
  getAllGuardianStudentLinks: vi.fn(async () => []),
  createGuardianLink: vi.fn(),
  revokeGuardianLink: vi.fn(),
  ensureAccountForUser: vi.fn(),
}));

const kpiAccessMocks = vi.hoisted(() => ({
  resolvePaidKpiAccessForUser: vi.fn(async () => ({
    hasPaidAccess: true,
    reason: "active entitlement",
    plan: "paid",
    status: "active",
    currentPeriodEnd: "2026-12-31T00:00:00.000Z",
  })),
}));

const kpiMocks = vi.hoisted(() => ({
  buildCanonicalPracticeKpiSnapshot: vi.fn(),
  buildStudentKpiView: vi.fn(),
  buildFullTestKpis: vi.fn(),
  fullTestMeasurementModel: vi.fn(),
}));

type TableName =
  | "student_study_profile"
  | "student_study_plan_days"
  | "student_study_plan_tasks"
  | "student_question_attempts"
  | "system_event_logs";

class FakeSelectBuilder {
  private readonly rows: Record<string, any>[];
  private filters: Array<(row: Record<string, any>) => boolean> = [];
  private sorts: Array<{ column: string; ascending: boolean }> = [];
  private maxRows: number | null = null;

  constructor(rows: Record<string, any>[]) {
    this.rows = rows;
  }

  select(): this {
    return this;
  }

  eq(column: string, value: any): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  gte(column: string, value: any): this {
    this.filters.push((row) => row[column] >= value);
    return this;
  }

  lte(column: string, value: any): this {
    this.filters.push((row) => row[column] <= value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.sorts.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number): this {
    this.maxRows = count;
    return this;
  }

  async single() {
    const rows = this.computeRows();
    const row = rows[0] ?? null;
    if (!row) return { data: null, error: { code: "PGRST116", message: "No rows found" } };
    return { data: row, error: null };
  }

  async maybeSingle() {
    const rows = this.computeRows();
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: Record<string, any>[]; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.computeRows(), error: null }).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private computeRows(): Record<string, any>[] {
    let rows = this.rows.map((row) => ({ ...row }));
    for (const filter of this.filters) rows = rows.filter(filter);
    for (const sort of this.sorts) {
      rows.sort((a, b) => {
        if (a[sort.column] === b[sort.column]) return 0;
        return a[sort.column] > b[sort.column] ? (sort.ascending ? 1 : -1) : sort.ascending ? -1 : 1;
      });
    }
    if (this.maxRows != null) rows = rows.slice(0, this.maxRows);
    return rows;
  }
}

const tables = vi.hoisted((): Record<TableName, Record<string, any>[]> => ({
  student_study_profile: [
    { user_id: "student-1", timezone: "America/Chicago", daily_minutes: 40, planner_mode: "auto", full_test_cadence: "biweekly", preferred_study_days: [1, 2, 3, 4, 5, 6, 7] },
  ],
  student_study_plan_days: [
    {
      id: "day-1",
      user_id: "student-1",
      day_date: "2026-03-01",
      planned_minutes: 45,
      completed_minutes: 30,
      focus: [{ section: "Math", weight: 1 }],
      tasks: [{ type: "practice" }],
      plan_version: 3,
      generated_at: "2026-03-01T10:00:00.000Z",
      is_user_override: true,
      status: "in_progress",
      generation_source: "generate",
      is_exam_day: false,
      is_taper_day: false,
      is_full_test_day: false,
      required_task_count: 1,
      completed_task_count: 0,
      study_minutes_target: 45,
    },
  ],
  student_study_plan_tasks: [
    {
      id: "task-1",
      day_id: "day-1",
      user_id: "student-1",
      day_date: "2026-03-01",
      ordinal: 1,
      task_type: "math_practice",
      section: "MATH",
      duration_minutes: 45,
      source_skill_code: null,
      source_domain: null,
      source_subskill: null,
      source_reason: {},
      status: "planned",
      is_user_override: true,
      planner_owned: false,
      metadata: { required: true },
      completed_at: null,
    },
  ],
  student_question_attempts: [
    {
      user_id: "student-1",
      attempted_at: "2026-03-01T15:00:00.000Z",
      is_correct: true,
      time_spent_ms: 120000,
      event_type: "practice_pass",
    },
  ],
  system_event_logs: [],
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "system_event_logs") {
        return {
          insert: async () => ({ error: null }),
        };
      }
      const rows = tables[table as TableName] ?? [];
      return new FakeSelectBuilder(rows);
    },
  },
}));

vi.mock("../../server/services/kpi-access", () => ({
  resolvePaidKpiAccessForUser: (...args: any[]) => kpiAccessMocks.resolvePaidKpiAccessForUser(...args),
}));

vi.mock("../../server/middleware/supabase-auth", async () => {
  const actual = await vi.importActual<typeof import("../../server/middleware/supabase-auth")>("../../server/middleware/supabase-auth");
  return {
    ...actual,
    getSupabaseAdmin: vi.fn(() => ({})),
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
      req.requestId ??= "req-calendar-parity";
      next();
    },
  };
});

vi.mock("../../server/middleware/guardian-entitlement", () => ({
  requireGuardianEntitlement: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/middleware/csrf", () => ({
  csrfGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/lib/durable-rate-limiter", () => ({
  createDurableRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/lib/account", () => accountMocks);
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../apps/api/src/services/fullLengthExam", () => ({
  getExamReport: vi.fn(),
}));
vi.mock("../../apps/api/src/services/mastery-derived", () => ({
  getDerivedWeaknessSignals: vi.fn(async () => []),
}));
vi.mock("../../server/services/kpi-truth-layer", () => kpiMocks);

import { calendarRouter } from "../../apps/api/src/routes/calendar";

function buildStudentApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: "student-1", role: "student", isGuardian: false, isAdmin: false };
    req.supabase = {};
    next();
  });
  app.use("/api/calendar", calendarRouter);
  return app;
}

function buildGuardianApp(guardianRouter: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: "guardian-1", role: "guardian", isGuardian: true, isAdmin: false };
    req.supabase = {};
    next();
  });
  app.use("/api/guardian", guardianRouter);
  return app;
}

describe("Calendar student/guardian parity contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
  });

  it("guardian calendar is a projection of the same student month builder output", async () => {
    const guardianRouter = (await import("../../server/routes/guardian-routes")).default;
    const studentApp = buildStudentApp();
    const guardianApp = buildGuardianApp(guardianRouter);

    const student = await request(studentApp).get("/api/calendar/month?start=2026-03-01&end=2026-03-31");
    const guardian = await request(guardianApp).get("/api/guardian/students/student-1/calendar/month?start=2026-03-01&end=2026-03-31");

    expect(student.status).toBe(200);
    expect(guardian.status).toBe(200);
    expect(guardian.body.streak).toEqual(student.body.streak);
    expect(Array.isArray(student.body.days)).toBe(true);
    expect(Array.isArray(guardian.body.days)).toBe(true);
    expect(guardian.body.days).toHaveLength(student.body.days.length);

    for (let i = 0; i < guardian.body.days.length; i++) {
      const g = guardian.body.days[i];
      const s = student.body.days[i];
      expect(g).toEqual({
        day_date: s.day_date,
        planned_minutes: s.planned_minutes,
        completed_minutes: s.completed_minutes,
        status: s.status,
        attempt_count: s.attempt_count,
        accuracy: s.accuracy,
        avg_seconds_per_question: s.avg_seconds_per_question,
      });
    }
  });
});
