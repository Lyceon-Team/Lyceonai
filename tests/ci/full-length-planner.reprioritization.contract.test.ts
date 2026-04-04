import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { applyFullLengthExamPlannerReprioritization } from "../../apps/api/src/services/calendar-planner-reprioritization";

const mocks = vi.hoisted(() => ({
  client: null as any,
}));

vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => mocks.client,
}));

type TableName =
  | "student_study_profile"
  | "student_study_plan_days"
  | "student_study_plan_tasks"
  | "student_question_attempts"
  | "student_skill_mastery";

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
        student_skill_mastery: seed?.student_skill_mastery ? [...seed.student_skill_mastery] : [],
      },
      writes: {
        upsert: 0,
        update: 0,
        insert: 0,
        delete: 0,
      },
    };
  }

  from(table: TableName) {
    return new FakeQueryBuilder(this.store, table);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-02T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Full-length planner reprioritization", () => {
  it("refreshes future days only, preserves overrides, and inserts reprioritized task in auto mode", async () => {
    const today = "2026-04-02";
    const tomorrow = "2026-04-03";
    const nextDay = "2026-04-04";
    const baseDay = {
      user_id: "student-1",
      planned_minutes: 20,
      completed_minutes: 0,
      focus: [],
      tasks: [],
      plan_version: 1,
      generated_at: DateTime.fromISO(today).toUTC().toISO(),
      status: "planned",
      generation_source: "auto",
      is_exam_day: false,
      is_taper_day: false,
      is_full_test_day: false,
      required_task_count: 0,
      completed_task_count: 0,
      study_minutes_target: 30,
      replaces_override: false,
      replaced_override_day_id: null,
      replacement_source: null,
      replacement_at: null,
    };

    const store = new FakeSupabaseClient({
      student_study_profile: [
        {
          user_id: "student-1",
          timezone: "America/Chicago",
          daily_minutes: 40,
          planner_mode: "auto",
          full_test_cadence: "none",
          study_days_of_week: [1, 2, 3, 4, 5, 6, 7],
          preferred_study_days: [1, 2, 3, 4, 5, 6, 7],
          blocked_weekdays: [],
          blocked_dates: [],
          blocked_windows: [],
        },
      ],
      student_skill_mastery: [
        {
          user_id: "student-1",
          section: "Math",
          domain: "algebra",
          skill: "math.linear_equations",
          mastery_score: 0.3,
          accuracy: 0.4,
          last_attempt_at: "2026-03-30T00:00:00.000Z",
        },
        {
          user_id: "student-1",
          section: "Reading & Writing",
          domain: "information_and_ideas",
          skill: "rw.command_of_evidence",
          mastery_score: 0.6,
          accuracy: 0.7,
          last_attempt_at: "2026-03-29T00:00:00.000Z",
        },
      ],
      student_study_plan_days: [
        { id: "day-past", day_date: "2026-04-01", is_user_override: false, ...baseDay },
        { id: "day-override", day_date: tomorrow, is_user_override: true, ...baseDay },
        { id: "day-next", day_date: nextDay, is_user_override: false, ...baseDay },
      ],
      student_study_plan_tasks: [
        {
          id: "override-task-1",
          day_id: "day-override",
          user_id: "student-1",
          day_date: tomorrow,
          ordinal: 1,
          task_type: "practice",
          section: "MATH",
          duration_minutes: 25,
          source_skill_code: "math.linear_equations",
          source_domain: "algebra",
          source_subskill: null,
          source_reason: {},
          status: "planned",
          is_user_override: true,
          planner_owned: false,
          metadata: {},
          completed_at: null,
          replaces_override: false,
          replaced_override_task_id: null,
          replacement_source: null,
          replacement_at: null,
          override_target_type: null,
          override_target_domain: null,
          override_target_skill: null,
          override_target_session_id: null,
          override_target_exam_id: null,
        },
      ],
      student_question_attempts: [],
    });

    mocks.client = store;

    await applyFullLengthExamPlannerReprioritization({
      userId: "student-1",
      examSessionId: "exam-1",
      completedAt: new Date("2026-04-02T12:00:00.000Z"),
      skillDiagnostics: [
        {
          section: "MATH",
          domain: "algebra",
          skill: "MATH.LINEAR_EQUATIONS",
          accuracy: 0.2,
          performanceBand: "needs_focus",
        },
        {
          section: "RW",
          domain: "information_and_ideas",
          skill: "rw.command_of_evidence",
          accuracy: 0.4,
          performanceBand: "needs_focus",
        },
      ],
    });

    const pastDay = store.store.tables.student_study_plan_days.find((day) => day.day_date === "2026-04-01");
    expect(pastDay?.plan_version).toBe(1);

    const overrideTasks = store.store.tables.student_study_plan_tasks.filter((task) => task.day_date === tomorrow);
    expect(overrideTasks).toHaveLength(1);
    expect(overrideTasks[0].is_user_override).toBe(true);

    const nextDayTasks = store.store.tables.student_study_plan_tasks.filter((task) => task.day_date === nextDay);
    const reprioritized = nextDayTasks.find((task) => task.task_type === "focused_drill" && task.metadata?.reprioritized);
    expect(reprioritized).toBeDefined();
    expect(reprioritized?.source_skill_code).toBe("math.linear_equations");
    expect(reprioritized?.metadata?.exam_session_id).toBe("exam-1");
    expect(reprioritized?.source_reason?.source).toBe("full_length_exam");

    const countAfterFirst = nextDayTasks.length;

    await applyFullLengthExamPlannerReprioritization({
      userId: "student-1",
      examSessionId: "exam-1",
      completedAt: new Date("2026-04-02T12:00:00.000Z"),
      skillDiagnostics: [
        {
          section: "MATH",
          domain: "algebra",
          skill: "MATH.LINEAR_EQUATIONS",
          accuracy: 0.2,
          performanceBand: "needs_focus",
        },
      ],
    });

    const nextDayTasksSecond = store.store.tables.student_study_plan_tasks.filter((task) => task.day_date === nextDay);
    expect(nextDayTasksSecond.length).toBe(countAfterFirst);
  });

  it("inserts a single reprioritized task for custom mode without regenerating tasks", async () => {
    const today = "2026-04-02";
    const tomorrow = "2026-04-03";
    const nextDay = "2026-04-04";
    const baseDay = {
      user_id: "student-2",
      planned_minutes: 25,
      completed_minutes: 0,
      focus: [],
      tasks: [],
      plan_version: 1,
      generated_at: DateTime.fromISO(today).toUTC().toISO(),
      status: "planned",
      generation_source: "user",
      is_exam_day: false,
      is_taper_day: false,
      is_full_test_day: false,
      required_task_count: 2,
      completed_task_count: 0,
      study_minutes_target: 30,
      replaces_override: false,
      replaced_override_day_id: null,
      replacement_source: null,
      replacement_at: null,
    };

    const store = new FakeSupabaseClient({
      student_study_profile: [
        {
          user_id: "student-2",
          timezone: "America/Chicago",
          daily_minutes: 32,
          planner_mode: "custom",
          full_test_cadence: "none",
          study_days_of_week: [1, 2, 3, 4, 5, 6, 7],
          preferred_study_days: [1, 2, 3, 4, 5, 6, 7],
          blocked_weekdays: [],
          blocked_dates: [],
          blocked_windows: [],
        },
      ],
      student_skill_mastery: [
        {
          user_id: "student-2",
          section: "Math",
          domain: "problem_solving",
          skill: "math.problem_solving",
          mastery_score: 0.4,
          accuracy: 0.5,
          last_attempt_at: "2026-03-31T00:00:00.000Z",
        },
      ],
      student_study_plan_days: [
        { id: "custom-override", day_date: tomorrow, is_user_override: true, ...baseDay },
        { id: "custom-day", day_date: nextDay, is_user_override: false, ...baseDay },
      ],
      student_study_plan_tasks: [
        {
          id: "custom-task-1",
          day_id: "custom-day",
          user_id: "student-2",
          day_date: nextDay,
          ordinal: 1,
          task_type: "practice",
          section: "MATH",
          duration_minutes: 15,
          source_skill_code: "math.problem_solving",
          source_domain: "problem_solving",
          source_subskill: null,
          source_reason: {},
          status: "planned",
          is_user_override: false,
          planner_owned: true,
          metadata: {},
          completed_at: null,
          replaces_override: false,
          replaced_override_task_id: null,
          replacement_source: null,
          replacement_at: null,
          override_target_type: null,
          override_target_domain: null,
          override_target_skill: null,
          override_target_session_id: null,
          override_target_exam_id: null,
        },
        {
          id: "custom-task-2",
          day_id: "custom-day",
          user_id: "student-2",
          day_date: nextDay,
          ordinal: 2,
          task_type: "review_practice",
          section: null,
          duration_minutes: 8,
          source_skill_code: null,
          source_domain: null,
          source_subskill: null,
          source_reason: {},
          status: "planned",
          is_user_override: false,
          planner_owned: true,
          metadata: {},
          completed_at: null,
          replaces_override: false,
          replaced_override_task_id: null,
          replacement_source: null,
          replacement_at: null,
          override_target_type: null,
          override_target_domain: null,
          override_target_skill: null,
          override_target_session_id: null,
          override_target_exam_id: null,
        },
      ],
      student_question_attempts: [],
    });

    mocks.client = store;

    await applyFullLengthExamPlannerReprioritization({
      userId: "student-2",
      examSessionId: "exam-2",
      completedAt: new Date("2026-04-02T12:00:00.000Z"),
      skillDiagnostics: [
        {
          section: "MATH",
          domain: "problem_solving",
          skill: "math.problem_solving",
          accuracy: 0.2,
          performanceBand: "needs_focus",
        },
      ],
    });

    const tasksAfter = store.store.tables.student_study_plan_tasks.filter((task) => task.day_date === nextDay);
    expect(tasksAfter.length).toBe(3);
    expect(tasksAfter.find((task) => task.id === "custom-task-1")?.task_type).toBe("practice");
    expect(tasksAfter.find((task) => task.id === "custom-task-2")?.task_type).toBe("review_practice");

    const reprioritized = tasksAfter.find((task) => task.metadata?.reprioritized);
    expect(reprioritized).toBeDefined();
    expect(reprioritized?.metadata?.exam_session_id).toBe("exam-2");

    await applyFullLengthExamPlannerReprioritization({
      userId: "student-2",
      examSessionId: "exam-2",
      completedAt: new Date("2026-04-02T12:00:00.000Z"),
      skillDiagnostics: [
        {
          section: "MATH",
          domain: "problem_solving",
          skill: "math.problem_solving",
          accuracy: 0.2,
          performanceBand: "needs_focus",
        },
      ],
    });

    const tasksAfterSecond = store.store.tables.student_study_plan_tasks.filter((task) => task.day_date === nextDay);
    expect(tasksAfterSecond.length).toBe(3);
  });
});
