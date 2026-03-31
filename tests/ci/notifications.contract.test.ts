import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TableName = "notifications" | "user_notification_preferences";
type Row = Record<string, any>;

const mocks = vi.hoisted(() => ({
  client: null as FakeSupabaseClient | null,
  readErrors: {} as Partial<Record<TableName, { message: string }>>,
}));

class FakeQueryBuilder {
  private filters: Array<(row: Row) => boolean> = [];
  private sorts: Array<{ column: string; ascending: boolean }> = [];
  private rangeWindow: { from: number; to: number } | null = null;
  private pendingInsert: Row[] | null = null;
  private pendingUpdate: Record<string, any> | null = null;
  private pendingUpsert: { row: Row; onConflict: string[] } | null = null;
  private head = false;

  constructor(private readonly store: FakeStore, private readonly table: TableName, private readonly readError: { message: string } | null) {}

  select(_columns?: string, options?: { count?: "exact"; head?: boolean }): this {
    this.head = Boolean(options?.head);
    return this;
  }

  eq(column: string, value: any): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: any): this {
    this.filters.push((row) => (value === null ? row[column] === null : row[column] === value));
    return this;
  }

  or(expression: string): this {
    const rules = expression.split(",").map((part) => part.trim());
    this.filters.push((row) =>
      rules.some((rule) => {
        if (rule === "expires_at.is.null") return row.expires_at == null;
        const match = rule.match(/^expires_at\.gte\.(.+)$/);
        if (match) return row.expires_at == null || row.expires_at >= match[1];
        return false;
      })
    );
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.sorts.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  range(from: number, to: number): this {
    this.rangeWindow = { from, to };
    return this;
  }

  update(values: Record<string, any>): this {
    this.pendingUpdate = values;
    return this;
  }

  insert(values: Row | Row[]): this {
    this.pendingInsert = Array.isArray(values) ? values.map((row) => ({ ...row })) : [{ ...values }];
    return this;
  }

  upsert(values: Row | Row[], options?: { onConflict?: string }): this {
    const row = Array.isArray(values) ? values[0] : values;
    this.pendingUpsert = {
      row: { ...row },
      onConflict: (options?.onConflict ?? "id").split(",").map((part) => part.trim()).filter(Boolean),
    };
    return this;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: any }> {
    if (this.readError) return { data: null, error: this.readError };
    const rows = this.computeRows();
    return { data: rows[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: any }> {
    if (this.readError) return { data: null, error: this.readError };
    const rows = this.computeRows();
    if (rows.length === 0) return { data: null, error: { code: "PGRST116", message: "No rows found" } };
    return { data: rows[0], error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: any; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private execute(): { data: Row[]; error: any; count?: number } {
    if (this.pendingInsert) {
      const tableRows = this.store.tables[this.table];
      const now = new Date().toISOString();
      const inserted = this.pendingInsert.map((row, index) => ({
        id: row.id ?? `${this.table}-${tableRows.length + index + 1}`,
        created_at: row.created_at ?? now,
        updated_at: row.updated_at ?? now,
        ...row,
      }));
      tableRows.push(...inserted);
      this.pendingInsert = null;
      return { data: inserted.map((row) => ({ ...row })), error: null };
    }

    if (this.pendingUpsert) {
      const tableRows = this.store.tables[this.table];
      const { row, onConflict } = this.pendingUpsert;
      const existingIndex = tableRows.findIndex((existing) => onConflict.every((column) => existing[column] === row[column]));
      const now = new Date().toISOString();
      const nextRow = {
        id: row.id ?? `${this.table}-${tableRows.length + 1}`,
        created_at: row.created_at ?? now,
        updated_at: now,
        ...row,
      };

      if (existingIndex >= 0) {
        tableRows[existingIndex] = { ...tableRows[existingIndex], ...nextRow };
        this.pendingUpsert = null;
        return { data: [{ ...tableRows[existingIndex] }], error: null };
      }

      tableRows.push(nextRow);
      this.pendingUpsert = null;
      return { data: [{ ...nextRow }], error: null };
    }

    if (this.pendingUpdate) {
      const tableRows = this.store.tables[this.table];
      const matched = tableRows.filter((row) => this.matches(row));
      const now = new Date().toISOString();
      for (const row of matched) {
        Object.assign(row, this.pendingUpdate, { updated_at: now });
      }
      this.pendingUpdate = null;
      return { data: matched.map((row) => ({ ...row })), error: null };
    }

    if (this.readError) {
      return { data: [], error: this.readError };
    }

    const rows = this.computeRows();
    if (this.head) {
      return { data: [], error: null, count: rows.length };
    }
    return { data: rows, error: null };
  }

  private computeRows(): Row[] {
    let rows = [...this.store.tables[this.table]];
    rows = rows.filter((row) => this.matches(row));
    for (const sort of this.sorts) {
      rows.sort((a, b) => {
        if (a[sort.column] === b[sort.column]) return 0;
        if (a[sort.column] == null) return sort.ascending ? -1 : 1;
        if (b[sort.column] == null) return sort.ascending ? 1 : -1;
        return a[sort.column] > b[sort.column] ? (sort.ascending ? 1 : -1) : sort.ascending ? -1 : 1;
      });
    }
    if (this.rangeWindow) {
      rows = rows.slice(this.rangeWindow.from, this.rangeWindow.to + 1);
    }
    return rows;
  }

  private matches(row: Row): boolean {
    return this.filters.every((predicate) => predicate(row));
  }
}

interface FakeStore {
  tables: Record<TableName, Row[]>;
}

class FakeSupabaseClient {
  readonly store: FakeStore;

  constructor(seed?: Partial<FakeStore["tables"]>) {
    this.store = {
      tables: {
        notifications: seed?.notifications ? [...seed.notifications] : [],
        user_notification_preferences: seed?.user_notification_preferences ? [...seed.user_notification_preferences] : [],
      },
    };
  }

  from(table: string): FakeQueryBuilder {
    if (!Object.prototype.hasOwnProperty.call(this.store.tables, table)) {
      throw new Error(`Unknown table: ${table}`);
    }
    return new FakeQueryBuilder(this.store, table as TableName, mocks.readErrors[table as TableName] ?? null);
  }
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => mocks.client!.from(table),
  },
}));

vi.mock("../../server/middleware/supabase-auth.js", () => ({
  requireSupabaseAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "student-1" };
    next();
  },
}));

vi.mock("../../server/middleware/csrf.js", () => ({
  csrfGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => "test-csrf-token",
}));

import notificationRoutes from "../../server/routes/notification-routes";
import {
  fanoutNotificationDecisions,
  writeNotificationDecision,
} from "../../server/services/notification-authority";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/notifications", notificationRoutes);
  return app;
}

function buildPreferenceRow(userId: string, overrides: Partial<Row> = {}): Row {
  return {
    user_id: userId,
    email_enabled: false,
    study_reminders_enabled: true,
    streak_enabled: true,
    plan_updates_enabled: true,
    guardian_updates_enabled: true,
    marketing_enabled: false,
    digest_frequency: "daily",
    quiet_hours: null,
    created_at: "2026-03-26T12:00:00.000Z",
    updated_at: "2026-03-26T12:00:00.000Z",
    ...overrides,
  };
}

describe("Notification contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readErrors = {};
    mocks.client = new FakeSupabaseClient({
      notifications: [
        {
          id: "notif-1",
          user_id: "student-1",
          type: "study_reminder",
          category: "study_progress",
          title: "Time to study",
          body: "Keep your streak alive.",
          message: "Legacy body",
          priority: "normal",
          cta_url: "/calendar",
          action_url: "/legacy-calendar",
          cta_text: "Open calendar",
          action_text: "Legacy CTA",
          channel_origin: "planner",
          metadata: { source: "system" },
          is_read: false,
          read_at: null,
          archived_at: null,
          expires_at: null,
          created_at: "2026-03-26T12:00:00.000Z",
          updated_at: "2026-03-26T12:00:00.000Z",
        },
        {
          id: "notif-2",
          user_id: "student-1",
          type: "progress_alert",
          category: "learning_analytics",
          title: "Archived",
          body: "Should stay hidden",
          priority: "normal",
          is_read: false,
          read_at: null,
          archived_at: "2026-03-26T09:00:00.000Z",
          expires_at: null,
          created_at: "2026-03-26T09:00:00.000Z",
          updated_at: "2026-03-26T09:00:00.000Z",
        },
        {
          id: "notif-3",
          user_id: null,
          type: "system_update",
          category: "technical",
          title: "Broadcast",
          body: "Legacy broadcast",
          priority: "normal",
          is_read: false,
          read_at: null,
          archived_at: null,
          expires_at: null,
          created_at: "2026-03-26T11:00:00.000Z",
          updated_at: "2026-03-26T11:00:00.000Z",
        },
      ],
      user_notification_preferences: [],
    });
  });

  it("returns only active per-user notifications and hides legacy broadcasts", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/notifications");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: "notif-1",
      userId: "student-1",
      body: "Keep your streak alive.",
      ctaUrl: "/calendar",
      channelOrigin: "planner",
      isRead: false,
    });
    expect(res.body[0].message).toBe("Legacy body");
    expect(res.body[0].actionUrl).toBe("/calendar");
  });

  it("counts only active unread per-user notifications", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/notifications/unread-count");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 1 });
  });

  it("marks a notification read with persisted read_at", async () => {
    const app = buildApp();
    const res = await request(app).patch("/api/notifications/notif-1/read").send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(mocks.client?.store.tables.notifications.find((row) => row.id === "notif-1")?.is_read).toBe(true);
    expect(mocks.client?.store.tables.notifications.find((row) => row.id === "notif-1")?.read_at).toEqual(expect.any(String));
  });

  it("reads and updates persisted notification preferences", async () => {
    const app = buildApp();

    const initial = await request(app).get("/api/notifications/preferences");
    expect(initial.status).toBe(200);
    expect(initial.body.preferences).toMatchObject({
      userId: "student-1",
      emailEnabled: false,
      studyRemindersEnabled: true,
      digestFrequency: "daily",
      quietHours: null,
    });

    const updated = await request(app)
      .patch("/api/notifications/preferences")
      .send({
        emailEnabled: true,
        planUpdatesEnabled: false,
        digestFrequency: "weekly",
        quietHours: { start: "21:00", end: "07:00" },
      });

    expect(updated.status).toBe(200);
    expect(updated.body.preferences).toMatchObject({
      userId: "student-1",
      emailEnabled: true,
      planUpdatesEnabled: false,
      digestFrequency: "weekly",
      quietHours: { start: "21:00", end: "07:00" },
    });
  });

  it("suppresses study reminders when the central writer sees them disabled", async () => {
    mocks.client = new FakeSupabaseClient({
      notifications: [],
      user_notification_preferences: [
        buildPreferenceRow("student-1", {
          study_reminders_enabled: false,
        }),
      ],
    });

    const result = await writeNotificationDecision({
      recipientUserIds: ["student-1"],
      kind: "study_reminder",
      type: "study_reminder",
      category: "study_progress",
      title: "Time to study",
      body: "Your plan is ready.",
      channelOrigin: "planner",
    });

    expect(result).toMatchObject({
      userId: "student-1",
      delivered: false,
      suppressed: true,
      reason: "study_reminders_disabled",
      notificationId: null,
    });
    expect(mocks.client.store.tables.notifications).toHaveLength(0);
  });

  it("fans out user-facing notifications through the central writer", async () => {
    mocks.client = new FakeSupabaseClient({
      notifications: [],
      user_notification_preferences: [
        buildPreferenceRow("student-1"),
        buildPreferenceRow("student-2"),
      ],
    });

    const result = await fanoutNotificationDecisions({
      recipientUserIds: ["student-1", "student-2"],
      kind: "system",
      type: "plan_refreshed",
      category: "study_progress",
      title: "Study plan updated",
      body: "Your study plan has been refreshed.",
      channelOrigin: "planner",
      priority: "normal",
    });

    expect(result.delivered).toBe(2);
    expect(result.suppressed).toBe(0);
    expect(mocks.client.store.tables.notifications).toHaveLength(2);
    expect(mocks.client.store.tables.notifications.map((row) => row.user_id)).toEqual([
      "student-1",
      "student-2",
    ]);
  });
});
