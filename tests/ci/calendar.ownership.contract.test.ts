import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  client: null as any,
  resolveAccess: vi.fn(),
  getWeakestSkills: vi.fn(),
}));

vi.mock('../../apps/api/src/lib/supabase-server', () => ({
  supabaseServer: {
    from: (table: string) => mocks.client.from(table),
  },
}));

vi.mock('../../apps/api/src/services/studentMastery', () => ({
  getWeakestSkills: (...args: any[]) => mocks.getWeakestSkills(...args),
}));

vi.mock('../../server/services/kpi-access', () => ({
  resolvePaidKpiAccessForUser: (...args: any[]) => mocks.resolveAccess(...args),
}));

type TableName =
  | 'student_study_profile'
  | 'student_study_plan_days'
  | 'student_question_attempts'
  | 'practice_sessions'
  | 'system_event_logs';

type TableRow = Record<string, any>;

interface FakeStore {
  tables: Record<TableName, TableRow[]>;
  writes: {
    upsert: number;
    update: number;
    insert: number;
  };
}

class FakeQueryBuilder {
  private readonly store: FakeStore;
  private readonly table: TableName;
  private filters: Array<(row: TableRow) => boolean> = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private maxRows: number | null = null;
  private pendingUpdate: Record<string, any> | null = null;
  private mutationRows: TableRow[] | null = null;

  constructor(store: FakeStore, table: TableName) {
    this.store = store;
    this.table = table;
  }

  select(_columns: string): this {
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
    this.sort = {
      column,
      ascending: options?.ascending !== false,
    };
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

  upsert(values: TableRow | TableRow[], options?: { onConflict?: string }): this {
    const rows = Array.isArray(values) ? values : [values];
    const conflictColumns = (options?.onConflict ?? 'id')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const tableRows = this.store.tables[this.table];
    const affected: TableRow[] = [];

    for (const rawRow of rows) {
      const row = { ...rawRow };
      const existingIndex = tableRows.findIndex((existing) =>
        conflictColumns.every((column) => existing[column] === row[column])
      );

      if (existingIndex >= 0) {
        tableRows[existingIndex] = {
          ...tableRows[existingIndex],
          ...row,
          updated_at: tableRows[existingIndex].updated_at ?? new Date().toISOString(),
        };
        affected.push({ ...tableRows[existingIndex] });
      } else {
        const withDefaults = {
          ...row,
          created_at: row.created_at ?? new Date().toISOString(),
          updated_at: row.updated_at ?? new Date().toISOString(),
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
    for (const row of rows) {
      tableRows.push({ ...row });
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
      return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
    }
    return { data: rows[0], error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: TableRow[]; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private execute(): { data: TableRow[]; error: any } {
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
          updated_at: tableRows[index].updated_at ?? new Date().toISOString(),
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

    if (this.sort) {
      const { column, ascending } = this.sort;
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

  constructor(seed?: Partial<FakeStore['tables']>) {
    this.store = {
      tables: {
        student_study_profile: seed?.student_study_profile ? [...seed.student_study_profile] : [],
        student_study_plan_days: seed?.student_study_plan_days ? [...seed.student_study_plan_days] : [],
        student_question_attempts: seed?.student_question_attempts ? [...seed.student_question_attempts] : [],
        practice_sessions: seed?.practice_sessions ? [...seed.practice_sessions] : [],
        system_event_logs: seed?.system_event_logs ? [...seed.system_event_logs] : [],
      },
      writes: {
        upsert: 0,
        update: 0,
        insert: 0,
      },
    };
  }

  from(table: string): FakeQueryBuilder {
    return new FakeQueryBuilder(this.store, table as TableName);
  }
}

import { calendarRouter, syncCalendarDayFromSessions } from '../../apps/api/src/routes/calendar';

function buildCalendarApp(role: 'student' | 'guardian' = 'student') {
  const app = express();
  app.use(express.json());

  app.use((req: any, _res, next) => {
    req.user = {
      id: role === 'guardian' ? 'guardian-1' : 'student-1',
      email: role === 'guardian' ? 'guardian@test.com' : 'student@test.com',
      display_name: null,
      role,
      isAdmin: false,
      isGuardian: role === 'guardian',
    };
    req.supabase = mocks.client;
    next();
  });

  app.use('/api/calendar', (req: any, res, next) => {
    if (req.user?.isGuardian) {
      return res.status(403).json({ error: 'Student access required' });
    }
    next();
  });

  app.use('/api/calendar', calendarRouter);

  return app;
}

function defaultSeed(overrides?: Partial<FakeStore['tables']>): Partial<FakeStore['tables']> {
  return {
    student_study_profile: [
      {
        user_id: 'student-1',
        baseline_score: null,
        target_score: null,
        exam_date: null,
        daily_minutes: 40,
        timezone: 'America/Chicago',
        planner_mode: 'auto',
      },
    ],
    student_study_plan_days: [],
    student_question_attempts: [],
    system_event_logs: [],
    ...overrides,
  };
}

describe('Calendar Ownership Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccess.mockResolvedValue({
      hasPaidAccess: true,
      reason: 'active entitlement',
      plan: 'paid',
      status: 'active',
      currentPeriodEnd: '2026-12-31T00:00:00.000Z',
    });
    mocks.getWeakestSkills.mockResolvedValue([]);
    mocks.client = new FakeSupabaseClient(defaultSeed());
  });

  it('manual day edits persist and overridden days survive auto/full refresh', async () => {
    const app = buildCalendarApp('student');

    const initialGenerate = await request(app)
      .post('/api/calendar/generate')
      .send({ start_date: '2026-03-10', days: 3 });

    expect(initialGenerate.status).toBe(200);

    const manualEdit = await request(app)
      .put('/api/calendar/day/2026-03-11')
      .send({
        planned_minutes: 55,
        focus: [{ section: 'Math', weight: 1, competencies: ['math.algebra'] }],
        tasks: [{ type: 'practice', section: 'Math', mode: 'skill-focused', minutes: 55 }],
      });

    expect(manualEdit.status).toBe(200);
    expect(manualEdit.body.day.is_user_override).toBe(true);
    expect(manualEdit.body.day.planned_minutes).toBe(55);

    const autoRefresh = await request(app)
      .post('/api/calendar/refresh/auto')
      .send({ start_date: '2026-03-10', days: 3 });

    expect(autoRefresh.status).toBe(200);
    expect(autoRefresh.body.applied).toBe(true);
    expect(autoRefresh.body.refreshed.skipped_override_days).toContain('2026-03-11');

    const fullRefresh = await request(app)
      .post('/api/calendar/generate')
      .send({ start_date: '2026-03-10', days: 3 });

    expect(fullRefresh.status).toBe(200);
    expect(fullRefresh.body.generated.skipped_override_days).toContain('2026-03-11');

    const month = await request(app)
      .get('/api/calendar/month?start=2026-03-10&end=2026-03-12');

    expect(month.status).toBe(200);

    const editedDay = month.body.days.find((day: any) => day.day_date === '2026-03-11');
    expect(editedDay).toBeDefined();
    expect(editedDay.is_user_override).toBe(true);
    expect(editedDay.planned_minutes).toBe(55);
    expect(editedDay.tasks[0].mode).toBe('skill-focused');
  });

  it('single-day regenerate recalculates only that day', async () => {
    mocks.client = new FakeSupabaseClient(
      defaultSeed({
        student_study_plan_days: [
          {
            user_id: 'student-1',
            day_date: '2026-03-10',
            planned_minutes: 50,
            focus: [{ section: 'Math', weight: 1 }],
            tasks: [{ type: 'practice', section: 'Math', mode: 'manual', minutes: 50 }],
            plan_version: 7,
            is_user_override: true,
            generated_at: '2026-03-09T00:00:00.000Z',
          },
          {
            user_id: 'student-1',
            day_date: '2026-03-11',
            planned_minutes: 50,
            focus: [{ section: 'Math', weight: 1 }],
            tasks: [{ type: 'practice', section: 'Math', mode: 'manual', minutes: 50 }],
            plan_version: 4,
            is_user_override: true,
            generated_at: '2026-03-09T00:00:00.000Z',
          },
        ],
      })
    );

    const app = buildCalendarApp('student');

    const regenerate = await request(app).post('/api/calendar/day/2026-03-11/regenerate').send({});

    expect(regenerate.status).toBe(200);
    expect(regenerate.body.day.day_date).toBe('2026-03-11');
    expect(regenerate.body.day.is_user_override).toBe(false);
    expect(regenerate.body.day.planned_minutes).toBe(40);

    const month = await request(app)
      .get('/api/calendar/month?start=2026-03-10&end=2026-03-11');

    expect(month.status).toBe(200);

    const day10 = month.body.days.find((day: any) => day.day_date === '2026-03-10');
    const day11 = month.body.days.find((day: any) => day.day_date === '2026-03-11');

    expect(day10.is_user_override).toBe(true);
    expect(day10.planned_minutes).toBe(50);
    expect(day11.is_user_override).toBe(false);
    expect(day11.planned_minutes).toBe(40);
  });

  it('guardians cannot edit or regenerate student calendar days', async () => {
    const app = buildCalendarApp('guardian');

    const edit = await request(app)
      .put('/api/calendar/day/2026-03-11')
      .send({ planned_minutes: 45 });
    const regenerate = await request(app)
      .post('/api/calendar/day/2026-03-11/regenerate')
      .send({});

    expect(edit.status).toBe(403);
    expect(regenerate.status).toBe(403);
  });

  it('entitlement loss gates locked features while preserving existing override history', async () => {
    mocks.client = new FakeSupabaseClient(
      defaultSeed({
        student_study_plan_days: [
          {
            user_id: 'student-1',
            day_date: '2026-03-20',
            planned_minutes: 60,
            focus: [{ section: 'Math', weight: 1 }],
            tasks: [{ type: 'practice', section: 'Math', mode: 'manual', minutes: 60 }],
            plan_version: 5,
            is_user_override: true,
            generated_at: '2026-03-19T00:00:00.000Z',
          },
        ],
      })
    );

    mocks.resolveAccess.mockResolvedValue({
      hasPaidAccess: false,
      reason: 'subscription expired',
      plan: 'free',
      status: 'inactive',
      currentPeriodEnd: '2026-03-01T00:00:00.000Z',
    });

    const app = buildCalendarApp('student');

    const refresh = await request(app)
      .post('/api/calendar/refresh/auto')
      .send({ start_date: '2026-03-20', days: 1 });

    const regenerate = await request(app)
      .post('/api/calendar/day/2026-03-20/regenerate')
      .send({});

    expect(refresh.status).toBe(402);
    expect(regenerate.status).toBe(402);

    const month = await request(app)
      .get('/api/calendar/month?start=2026-03-20&end=2026-03-20');

    expect(month.status).toBe(200);
    expect(month.body.days).toHaveLength(1);
    expect(month.body.days[0].is_user_override).toBe(true);
    expect(month.body.days[0].planned_minutes).toBe(60);
    expect(mocks.client.store.writes.upsert).toBe(0);
  });

  it('emits canonical calendar observability events for generate/edit/refresh flows', async () => {
    const app = buildCalendarApp('student');

    const generate = await request(app)
      .post('/api/calendar/generate')
      .send({ start_date: '2026-03-10', days: 2 });

    expect(generate.status).toBe(200);

    const edit = await request(app)
      .put('/api/calendar/day/2026-03-10')
      .send({
        planned_minutes: 55,
        focus: [{ section: 'Math', weight: 1 }],
        tasks: [{ type: 'practice', section: 'Math', mode: 'manual', minutes: 55 }],
      });

    expect(edit.status).toBe(200);

    const refresh = await request(app)
      .post('/api/calendar/refresh/auto')
      .send({ start_date: '2026-03-10', days: 2 });

    expect(refresh.status).toBe(200);

    const eventTypes = mocks.client.store.tables.system_event_logs.map((row: any) => row.event_type);
    expect(eventTypes).toContain('plan_generated');
    expect(eventTypes).toContain('day_edited');
    expect(eventTypes).toContain('override_applied');
    expect(eventTypes).toContain('plan_refreshed');
  });

  it('custom-mode refresh emits non-applying plan_refreshed observability event', async () => {
    mocks.client = new FakeSupabaseClient(
      defaultSeed({
        student_study_profile: [
          {
            user_id: 'student-1',
            baseline_score: null,
            target_score: null,
            exam_date: null,
            daily_minutes: 45,
            timezone: 'America/Chicago',
            planner_mode: 'custom',
          },
        ],
      })
    );

    const app = buildCalendarApp('student');

    const refresh = await request(app)
      .post('/api/calendar/refresh/auto')
      .send({ start_date: '2026-03-22', days: 1 });

    expect(refresh.status).toBe(200);
    expect(refresh.body.applied).toBe(false);

    const events = mocks.client.store.tables.system_event_logs.filter((row: any) => row.event_type === 'plan_refreshed');
    expect(events).toHaveLength(1);
    expect(events[0].details.applied).toBe(false);
    expect(events[0].details.planner_mode).toBe('custom');
  });

  it('emits block_completed once when session-derived completion crosses complete threshold', async () => {
    mocks.client = new FakeSupabaseClient(
      defaultSeed({
        student_study_plan_days: [
          {
            user_id: 'student-1',
            day_date: '2026-03-10',
            planned_minutes: 40,
            completed_minutes: 10,
            focus: [],
            tasks: [],
            plan_version: 1,
            is_user_override: false,
            generated_at: '2026-03-09T00:00:00.000Z',
          },
        ],
        practice_sessions: [
          {
            user_id: 'student-1',
            started_at: '2026-03-10T13:00:00.000Z',
            finished_at: '2026-03-10T14:00:00.000Z',
            actual_duration_ms: 3600000,
          },
        ],
      })
    );

    await syncCalendarDayFromSessions('student-1', '2026-03-10', 'America/Chicago');
    await syncCalendarDayFromSessions('student-1', '2026-03-10', 'America/Chicago');

    const planDay = mocks.client.store.tables.student_study_plan_days.find((row: any) => row.day_date === '2026-03-10');
    expect(planDay.completed_minutes).toBe(60);

    const blockEvents = mocks.client.store.tables.system_event_logs.filter((row: any) => row.event_type === 'block_completed');
    expect(blockEvents).toHaveLength(1);
    expect(blockEvents[0].details.day_date).toBe('2026-03-10');
  });

  it('custom mode returns catch-up suggestions without forced writes', async () => {
    mocks.client = new FakeSupabaseClient(
      defaultSeed({
        student_study_profile: [
          {
            user_id: 'student-1',
            baseline_score: null,
            target_score: null,
            exam_date: null,
            daily_minutes: 45,
            timezone: 'America/Chicago',
            planner_mode: 'custom',
          },
        ],
        student_study_plan_days: [
          {
            user_id: 'student-1',
            day_date: '2026-03-22',
            planned_minutes: 30,
            focus: [{ section: 'Math', weight: 0.6 }],
            tasks: [{ type: 'practice', section: 'Math', mode: 'mixed', minutes: 18 }],
            plan_version: 2,
            is_user_override: false,
            generated_at: '2026-03-21T00:00:00.000Z',
          },
        ],
      })
    );

    const app = buildCalendarApp('student');

    const response = await request(app)
      .post('/api/calendar/refresh/auto')
      .send({ start_date: '2026-03-22', days: 1 });

    expect(response.status).toBe(200);
    expect(response.body.applied).toBe(false);
    expect(response.body.planner_mode).toBe('custom');
    expect(response.body.suggestions).toBeDefined();
    expect(response.body.suggestions[0].type).toBe('catch_up_block');
    expect(mocks.client.store.writes.upsert).toBe(0);

    const month = await request(app)
      .get('/api/calendar/month?start=2026-03-22&end=2026-03-22');

    expect(month.status).toBe(200);
    expect(month.body.days[0].planned_minutes).toBe(30);
  });
});
