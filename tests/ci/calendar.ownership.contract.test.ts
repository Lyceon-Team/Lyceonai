import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { DateTime } from "luxon";

const mocks = vi.hoisted(() => ({
  client: null as any,
  resolveAccess: vi.fn(),
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => mocks.client.from(table),
  },
}));

vi.mock("../../server/services/kpi-access", () => ({
  resolvePaidKpiAccessForUser: (...args: any[]) => mocks.resolveAccess(...args),
}));

type TableName =
  | "student_study_profile"
  | "student_study_plan_days"
  | "student_study_plan_tasks"
  | "student_question_attempts"
  | "practice_sessions"
  | "skill_mastery"
  | "system_event_logs";

type TableRow = Record<string, any>;

interface FakeStore {
  tables: Record<TableName, TableRow[]>;
  writes: {
    upsert: number;
    update: number;
    insert: number;
    delete: number;
  };
}

class FakeQueryBuilder {
  private readonly store: FakeStore;
  private readonly table: TableName;
  private filters: Array<(row: TableRow) => boolean> = [];
  private sorts: Array<{ column: string; ascending: boolean }> = [];
  private maxRows: number | null = null;
  private pendingUpdate: Record<string, any> | null = null;
  private pendingDelete = false;
  private mutationRows: TableRow[] | null = null;

  constructor(store: FakeStore, table: TableName) {
    this.store = store;
    this.table = table;
  }

  select(_columns?: string): this {
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

  in(column: string, values: any[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.sorts.push({
      column,
      ascending: options?.ascending !== false,
    });
    return this;
  }

  limit(count: number): this {
    this.maxRows = count;
    return this;
  }

  update(values: Record<string, any>): this {
    this.pendingUpdate = values;
    return this;
  }

  delete(): this {
    this.pendingDelete = true;
    return this;
  }

  upsert(values: TableRow | TableRow[], options?: { onConflict?: string }): this {
    const rows = Array.isArray(values) ? values : [values];
    const conflictColumns = (options?.onConflict ?? "id")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const tableRows = this.store.tables[this.table];
    const affected: TableRow[] = [];

    for (const rawRow of rows) {
      const row = { ...rawRow };
      const existingIndex = tableRows.findIndex((existing) =>
        conflictColumns.every((column) => existing[column] === row[column]),
      );

      if (existingIndex >= 0) {
        tableRows[existingIndex] = {
          ...tableRows[existingIndex],
          ...row,
          updated_at: new Date().toISOString(),
        };
        affected.push({ ...tableRows[existingIndex] });
      } else {
        const now = new Date().toISOString();
        const withDefaults = {
          id: row.id ?? `${this.table}-${tableRows.length + 1}`,
          created_at: row.created_at ?? now,
          updated_at: row.updated_at ?? now,
          ...row,
        };
        tableRows.push(withDefaults);
        affected.push({ ...withDefaults });
      }
    }

    this.store.writes.upsert += rows.length;
    this.mutationRows = affected;
    return this;
  }

  insert(values: TableRow | TableRow[]): this {
    const rows = Array.isArray(values) ? values : [values];
    const tableRows = this.store.tables[this.table];
    const now = new Date().toISOString();
    for (const row of rows) {
      tableRows.push({
        id: row.id ?? `${this.table}-${tableRows.length + 1}`,
        created_at: row.created_at ?? now,
        updated_at: row.updated_at ?? now,
        ...row,
      });
    }
    this.store.writes.insert += rows.length;
    this.mutationRows = rows.map((row) => ({ ...row }));
    return this;
  }

  async maybeSingle(): Promise<{ data: TableRow | null; error: any }> {
    const rows = this.computeRows();
    return { data: rows[0] ?? null, error: null };
  }

  async single(): Promise<{ data: TableRow | null; error: any }> {
    const rows = this.computeRows();
    if (rows.length === 0) {
      return { data: null, error: { code: "PGRST116", message: "No rows found" } };
    }
    return { data: rows[0], error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: TableRow[]; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private execute(): { data: TableRow[]; error: any } {
    if (this.pendingDelete) {
      const tableRows = this.store.tables[this.table];
      const kept: TableRow[] = [];
      const removed: TableRow[] = [];
      for (const row of tableRows) {
        if (this.matchesFilters(row)) removed.push(row);
        else kept.push(row);
      }
      this.store.tables[this.table] = kept;
      this.store.writes.delete += removed.length;
      this.pendingDelete = false;
      return { data: removed.map((row) => ({ ...row })), error: null };
    }

    if (this.pendingUpdate) {
      const tableRows = this.store.tables[this.table];
      const matchingIndexes = tableRows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => this.matchesFilters(row))
        .map(({ index }) => index);

      for (const index of matchingIndexes) {
        tableRows[index] = {
          ...tableRows[index],
          ...this.pendingUpdate,
          updated_at: new Date().toISOString(),
        };
      }

      this.store.writes.update += matchingIndexes.length;
      this.pendingUpdate = null;
      return {
        data: matchingIndexes.map((index) => ({ ...tableRows[index] })),
        error: null,
      };
    }

    return { data: this.computeRows(), error: null };
  }

  private computeRows(): TableRow[] {
    let rows = (this.mutationRows ?? this.store.tables[this.table]).map((row) => ({ ...row }));

    for (const predicate of this.filters) {
      rows = rows.filter(predicate);
    }

    for (const sort of this.sorts) {
      const { column, ascending } = sort;
      rows.sort((a, b) => {
        if (a[column] === b[column]) return 0;
        if (a[column] == null) return ascending ? -1 : 1;
        if (b[column] == null) return ascending ? 1 : -1;
        return a[column] > b[column] ? (ascending ? 1 : -1) : ascending ? -1 : 1;
      });
    }

    if (this.maxRows != null) {
      rows = rows.slice(0, this.maxRows);
    }
    return rows;
  }

  private matchesFilters(row: TableRow): boolean {
    return this.filters.every((predicate) => predicate(row));
  }
}

class FakeSupabaseClient {
  readonly store: FakeStore;

  constructor(seed?: Partial<FakeStore["tables"]>) {
    this.store = {
      tables: {
        student_study_profile: seed?.student_study_profile ? [...seed.student_study_profile] : [],
        student_study_plan_days: seed?.student_study_plan_days ? [...seed.student_study_plan_days] : [],
        student_study_plan_tasks: seed?.student_study_plan_tasks ? [...seed.student_study_plan_tasks] : [],
        student_question_attempts: seed?.student_question_attempts ? [...seed.student_question_attempts] : [],
        practice_sessions: seed?.practice_sessions ? [...seed.practice_sessions] : [],
        skill_mastery: seed?.skill_mastery ? [...seed.skill_mastery] : [],
        system_event_logs: seed?.system_event_logs ? [...seed.system_event_logs] : [],
      },
      writes: {
        upsert: 0,
        update: 0,
        insert: 0,
        delete: 0,
      },
    };
  }

  from(table: string): FakeQueryBuilder {
    if (!Object.prototype.hasOwnProperty.call(this.store.tables, table)) {
      throw new Error(`Unknown table in fake supabase: ${table}`);
    }
    return new FakeQueryBuilder(this.store, table as TableName);
  }
}

import { calendarRouter, syncCalendarDayFromSessions } from "../../apps/api/src/routes/calendar";

function isoDatePlus(days: number): string {
  return DateTime.now().plus({ days }).toISODate()!;
}

function buildCalendarApp(role: "student" | "guardian" = "student") {
  const app = express();
  app.use(express.json());

  app.use((req: any, _res, next) => {
    req.user = {
      id: role === "guardian" ? "guardian-1" : "student-1",
      email: role === "guardian" ? "guardian@test.com" : "student@test.com",
      display_name: null,
      role,
      isAdmin: false,
      isGuardian: role === "guardian",
    };
    req.supabase = mocks.client;
    next();
  });

  app.use("/api/calendar", (req: any, res, next) => {
    if (req.user?.isGuardian) {
      return res.status(403).json({ error: "Student access required" });
    }
    next();
  });

  app.use("/api/calendar", calendarRouter);

  return app;
}

function defaultSeed(overrides?: Partial<FakeStore["tables"]>): Partial<FakeStore["tables"]> {
  return {
    student_study_profile: [
      {
        user_id: "student-1",
        baseline_score: null,
        target_score: null,
        exam_date: null,
        daily_minutes: 40,
        timezone: "America/Chicago",
        planner_mode: "auto",
        full_test_cadence: "biweekly",
        preferred_study_days: [1, 2, 3, 4, 5, 6, 7],
      },
    ],
    student_study_plan_days: [],
    student_study_plan_tasks: [],
    student_question_attempts: [],
    skill_mastery: [],
    system_event_logs: [],
    ...overrides,
  };
}

describe("Calendar Ownership Contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccess.mockResolvedValue({
      hasPaidAccess: true,
      reason: "active entitlement",
      plan: "paid",
      status: "active",
      currentPeriodEnd: "2026-12-31T00:00:00.000Z",
    });
    mocks.client = new FakeSupabaseClient(defaultSeed());
  });

  it("refresh preserves user-overridden future days", async () => {
    const app = buildCalendarApp("student");
    const start = isoDatePlus(1);
    const overrideDay = isoDatePlus(2);
    const end = isoDatePlus(3);

    const generated = await request(app).post("/api/calendar/generate").send({ start_date: start, days: 3 });
    expect(generated.status).toBe(200);

    const edit = await request(app).put(`/api/calendar/day/${overrideDay}`).send({
      planned_minutes: 55,
      focus: [{ section: "Math", weight: 1, competencies: ["math.algebra"] }],
      tasks: [{ type: "practice", section: "Math", mode: "skill-focused", minutes: 55 }],
    });
    expect(edit.status).toBe(200);
    expect(edit.body.day.is_user_override).toBe(true);

    const refresh = await request(app).post("/api/calendar/refresh/auto").send({ start_date: start, days: 3 });
    expect(refresh.status).toBe(200);
    expect(refresh.body.applied).toBe(true);
    expect(refresh.body.refreshed.skipped_override_days).toContain(overrideDay);

    const month = await request(app).get(`/api/calendar/month?start=${start}&end=${end}`);
    expect(month.status).toBe(200);
    const edited = month.body.days.find((day: any) => day.day_date === overrideDay);
    expect(edited).toBeDefined();
    expect(edited.is_user_override).toBe(true);
    expect(edited.planned_minutes).toBe(55);
  });

  it("regenerate-one-day replaces override for that day only", async () => {
    const dayA = isoDatePlus(1);
    const dayB = isoDatePlus(2);
    mocks.client = new FakeSupabaseClient(
      defaultSeed({
        student_study_plan_days: [
          {
            id: "day-a",
            user_id: "student-1",
            day_date: dayA,
            planned_minutes: 50,
            completed_minutes: 0,
            focus: [{ section: "Math", weight: 1 }],
            tasks: [{ type: "practice", section: "Math", mode: "manual", minutes: 50 }],
            plan_version: 7,
            generated_at: new Date().toISOString(),
            is_user_override: true,
            status: "planned",
            generation_source: "user",
            is_exam_day: false,
            is_taper_day: false,
            is_full_test_day: false,
            required_task_count: 1,
            completed_task_count: 0,
            study_minutes_target: 50,
          },
          {
            id: "day-b",
            user_id: "student-1",
            day_date: dayB,
            planned_minutes: 50,
            completed_minutes: 0,
            focus: [{ section: "Math", weight: 1 }],
            tasks: [{ type: "practice", section: "Math", mode: "manual", minutes: 50 }],
            plan_version: 4,
            generated_at: new Date().toISOString(),
            is_user_override: true,
            status: "planned",
            generation_source: "user",
            is_exam_day: false,
            is_taper_day: false,
            is_full_test_day: false,
            required_task_count: 1,
            completed_task_count: 0,
            study_minutes_target: 50,
          },
        ],
      }),
    );
    const app = buildCalendarApp("student");

    const regenerate = await request(app).post(`/api/calendar/day/${dayB}/regenerate`).send({});
    expect(regenerate.status).toBe(200);
    expect(regenerate.body.day.day_date).toBe(dayB);
    expect(regenerate.body.day.is_user_override).toBe(false);

    const month = await request(app).get(`/api/calendar/month?start=${dayA}&end=${dayB}`);
    expect(month.status).toBe(200);
    const persistedDayA = month.body.days.find((day: any) => day.day_date === dayA);
    const persistedDayB = month.body.days.find((day: any) => day.day_date === dayB);
    expect(persistedDayA.is_user_override).toBe(true);
    expect(persistedDayA.planned_minutes).toBe(50);
    expect(persistedDayB.is_user_override).toBe(false);
    expect(persistedDayB.planned_minutes).toBeGreaterThan(0);
  });

  it("guardian is read-blocked from student calendar mutation routes", async () => {
    const day = isoDatePlus(2);
    const app = buildCalendarApp("guardian");

    const edit = await request(app).put(`/api/calendar/day/${day}`).send({ planned_minutes: 45 });
    const regenerate = await request(app).post(`/api/calendar/day/${day}/regenerate`).send({});
    expect(edit.status).toBe(403);
    expect(regenerate.status).toBe(403);
  });

  it("premium entitlement gates calendar reads and writes", async () => {
    const start = isoDatePlus(1);
    const end = isoDatePlus(2);
    mocks.resolveAccess.mockResolvedValue({
      hasPaidAccess: false,
      reason: "subscription expired",
      plan: "free",
      status: "inactive",
      currentPeriodEnd: "2026-03-01T00:00:00.000Z",
    });
    const app = buildCalendarApp("student");

    const month = await request(app).get(`/api/calendar/month?start=${start}&end=${end}`);
    const refresh = await request(app).post("/api/calendar/refresh/auto").send({ start_date: start, days: 2 });
    const edit = await request(app).put(`/api/calendar/day/${start}`).send({ planned_minutes: 10 });

    expect(month.status).toBe(402);
    expect(refresh.status).toBe(402);
    expect(edit.status).toBe(402);
    expect(mocks.client.store.writes.upsert).toBe(0);
  });

  it("custom mode returns catch-up suggestions without writes", async () => {
    const start = isoDatePlus(1);
    mocks.client = new FakeSupabaseClient(
      defaultSeed({
        student_study_profile: [
          {
            user_id: "student-1",
            baseline_score: null,
            target_score: null,
            exam_date: null,
            daily_minutes: 45,
            timezone: "America/Chicago",
            planner_mode: "custom",
            full_test_cadence: "biweekly",
            preferred_study_days: [1, 2, 3, 4, 5, 6, 7],
          },
        ],
      }),
    );
    const app = buildCalendarApp("student");

    const response = await request(app).post("/api/calendar/refresh/auto").send({ start_date: start, days: 1 });
    expect(response.status).toBe(200);
    expect(response.body.applied).toBe(false);
    expect(response.body.planner_mode).toBe("custom");
    expect(response.body.suggestions[0].type).toBe("catch_up_block");
    expect(mocks.client.store.writes.upsert).toBe(0);

    const events = mocks.client.store.tables.system_event_logs.filter((row) => row.event_type === "plan_refreshed");
    expect(events).toHaveLength(1);
    expect(events[0].details.applied).toBe(false);
  });

  it("emits canonical observability events for generate/edit/refresh", async () => {
    const app = buildCalendarApp("student");
    const start = isoDatePlus(1);

    const generated = await request(app).post("/api/calendar/generate").send({ start_date: start, days: 2 });
    expect(generated.status).toBe(200);

    const edited = await request(app).put(`/api/calendar/day/${start}`).send({
      planned_minutes: 40,
      focus: [{ section: "Math", weight: 1 }],
      tasks: [{ type: "practice", section: "Math", mode: "manual", minutes: 40 }],
    });
    expect(edited.status).toBe(200);

    const refresh = await request(app).post("/api/calendar/refresh/auto").send({ start_date: start, days: 2 });
    expect(refresh.status).toBe(200);

    const eventTypes = mocks.client.store.tables.system_event_logs.map((row) => row.event_type);
    expect(eventTypes).toContain("plan_generated");
    expect(eventTypes).toContain("day_edited");
    expect(eventTypes).toContain("override_applied");
    expect(eventTypes).toContain("plan_refreshed");
  });

  it("syncCalendarDayFromSessions emits block_completed once at threshold crossing", async () => {
    const day = isoDatePlus(1);
    mocks.client = new FakeSupabaseClient(
      defaultSeed({
        student_study_plan_days: [
          {
            id: "day-1",
            user_id: "student-1",
            day_date: day,
            planned_minutes: 40,
            completed_minutes: 10,
            focus: [],
            tasks: [],
            plan_version: 1,
            generated_at: new Date().toISOString(),
            is_user_override: false,
            status: "planned",
            generation_source: "generate",
            is_exam_day: false,
            is_taper_day: false,
            is_full_test_day: false,
            required_task_count: 0,
            completed_task_count: 0,
            study_minutes_target: 40,
          },
        ],
        practice_sessions: [
          {
            user_id: "student-1",
            started_at: DateTime.fromISO(day).set({ hour: 9 }).toUTC().toISO(),
            finished_at: DateTime.fromISO(day).set({ hour: 10 }).toUTC().toISO(),
            actual_duration_ms: 3600000,
          },
        ],
      }),
    );

    await syncCalendarDayFromSessions("student-1", day, "America/Chicago");
    await syncCalendarDayFromSessions("student-1", day, "America/Chicago");

    const planDay = mocks.client.store.tables.student_study_plan_days.find((row) => row.day_date === day);
    expect(planDay.completed_minutes).toBe(60);
    const events = mocks.client.store.tables.system_event_logs.filter((row) => row.event_type === "block_completed");
    expect(events).toHaveLength(1);
    expect(events[0].details.day_date).toBe(day);
  });

  it("planner horizon caps at exam date and defaults to 28 days without exam date", async () => {
    const app = buildCalendarApp("student");
    const start = isoDatePlus(1);

    const withoutExam = await request(app).post("/api/calendar/generate").send({ start_date: start, days: 60 });
    expect(withoutExam.status).toBe(200);
    expect(withoutExam.body.generated.horizon_days).toBe(28);

    const examDate = isoDatePlus(5);
    const profileUpdate = await request(app).put("/api/calendar/profile").send({ exam_date: examDate });
    expect(profileUpdate.status).toBe(200);

    const withExam = await request(app).post("/api/calendar/generate").send({ start_date: start, days: 28 });
    expect(withExam.status).toBe(200);
    expect(withExam.body.generated.end_date).toBe(examDate);
    expect(withExam.body.generated.horizon_days).toBe(5);
  });
});
