
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express, NextFunction, Request, Response } from "express";

type TableRow = Record<string, any>;

type DbState = {
  practice_sessions: TableRow[];
  practice_session_items: TableRow[];
  answer_attempts: TableRow[];
  questions: TableRow[];
  practice_events: TableRow[];
  student_skill_mastery: TableRow[];
};

let db: DbState;

const accountMocks = vi.hoisted(() => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true, current: 0, limit: 10, resetAt: "2099-01-01T00:00:00.000Z" })),
  ensureAccountForUser: vi.fn(async () => "acct-test"),
  getAccountIdForUser: vi.fn(async () => "acct-test"),
  incrementUsage: vi.fn(async () => ({ practice_questions_used: 1, ai_messages_used: 0 })),
  resolveLinkedPairPremiumAccessForStudent: vi.fn(async () => ({ hasPremiumAccess: false })),
}));

const masteryMocks = vi.hoisted(() => ({
  getQuestionMetadataForAttempt: vi.fn(async (questionId: string) => ({
    canonicalId: questionId === "00000000-0000-0000-0000-000000000001" ? "SATM1ABC123" : "SATM1ABC124",
    exam: "SAT",
    section: "Math",
    domain: "Algebra",
    skill: "Linear equations",
    subskill: "Linear",
    skill_code: "MATH.ALG.LINEAR",
    difficulty: "medium",
    structure_cluster_id: null,
  })),
  applyMasteryUpdate: vi.fn(async () => undefined),
}));

function cloneRow<T extends TableRow>(row: T): T {
  return JSON.parse(JSON.stringify(row));
}

function applyFilters(rows: TableRow[], filters: Array<(row: TableRow) => boolean>): TableRow[] {
  return rows.filter((row) => filters.every((fn) => fn(row)));
}

function applyOrder(rows: TableRow[], orderBy: { column: string; ascending: boolean } | null): TableRow[] {
  if (!orderBy) return rows;
  const { column, ascending } = orderBy;
  return [...rows].sort((a, b) => {
    const av = a[column];
    const bv = b[column];
    if (av === bv) return 0;
    if (av == null) return ascending ? -1 : 1;
    if (bv == null) return ascending ? 1 : -1;
    return ascending ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

class MockBuilder {
  private readonly table: keyof DbState;
  private readonly state: DbState;
  private filters: Array<(row: TableRow) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitValue: number | null = null;
  private operation: "select" | "insert" | "update" = "select";
  private inserted: TableRow[] = [];
  private insertError: any = null;
  private patch: TableRow = {};
  private selectHead = false;
  private selectCountExact = false;

  constructor(table: keyof DbState, state: DbState) {
    this.table = table;
    this.state = state;
  }

  select(_columns?: string, opts?: { head?: boolean; count?: "exact" }) {
    this.selectHead = !!opts?.head;
    this.selectCountExact = opts?.count === "exact";
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  insert(payload: TableRow | TableRow[]) {
    this.operation = "insert";
    const rows = Array.isArray(payload) ? payload : [payload];

    for (const row of rows) {
      const rowWithDefaults = {
        ...row,
        id: row.id ?? `00000000-0000-0000-0000-${String((this.state[this.table] as TableRow[]).length + this.inserted.length + 1).padStart(12, "0")}`,
      };

      if (this.table === "practice_session_items") {
        const hasUnanswered = this.state.practice_session_items.some(
          (item) => item.session_id === rowWithDefaults.session_id && item.status === "served",
        );
        const ordinalConflict = this.state.practice_session_items.some(
          (item) => item.session_id === rowWithDefaults.session_id && item.ordinal === rowWithDefaults.ordinal,
        );

        if ((rowWithDefaults.status === "served" && hasUnanswered) || ordinalConflict) {
          this.insertError = { message: "duplicate key value violates unique constraint" };
          break;
        }
      }

      if (this.table === "answer_attempts") {
        const duplicateClient = rowWithDefaults.client_attempt_id
          ? this.state.answer_attempts.some((a) => a.user_id === rowWithDefaults.user_id && a.client_attempt_id === rowWithDefaults.client_attempt_id)
          : false;
        const duplicateSessionQuestion = this.state.answer_attempts.some(
          (a) => a.session_id === rowWithDefaults.session_id && a.question_id === rowWithDefaults.question_id,
        );
        const duplicateSessionItem = rowWithDefaults.session_item_id
          ? this.state.answer_attempts.some((a) => a.session_item_id === rowWithDefaults.session_item_id)
          : false;

        if (duplicateClient || duplicateSessionQuestion || duplicateSessionItem) {
          this.insertError = { message: "duplicate key value violates unique constraint" };
          break;
        }
      }

      this.inserted.push(cloneRow(rowWithDefaults));
    }

    if (!this.insertError) {
      (this.state[this.table] as TableRow[]).push(...this.inserted.map(cloneRow));
    }

    return this;
  }

  update(patch: TableRow) {
    this.operation = "update";
    this.patch = patch;
    return this;
  }

  maybeSingle() {
    const result = this.execute();
    if (result.error) return Promise.resolve({ data: null, error: result.error });
    const first = result.data?.[0] ?? null;
    return Promise.resolve({ data: first, error: null });
  }

  single() {
    const result = this.execute();
    if (result.error) return Promise.resolve({ data: null, error: result.error });
    const first = result.data?.[0] ?? null;
    if (!first) {
      return Promise.resolve({ data: null, error: { message: "No rows" } });
    }
    return Promise.resolve({ data: first, error: null });
  }

  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    const result = this.execute();
    return Promise.resolve(result).then(resolve, reject);
  }

  private execute() {
    if (this.operation === "insert") {
      if (this.insertError) {
        return { data: null, error: this.insertError, count: null };
      }
      return { data: this.inserted.map(cloneRow), error: null, count: this.inserted.length };
    }

    if (this.operation === "update") {
      const tableRows = this.state[this.table] as TableRow[];
      const matched = applyFilters(tableRows, this.filters);
      for (const row of matched) {
        Object.assign(row, this.patch);
      }
      const ordered = applyOrder(matched.map(cloneRow), this.orderBy);
      const limited = this.limitValue == null ? ordered : ordered.slice(0, this.limitValue);
      return { data: limited, error: null, count: limited.length };
    }

    const tableRows = this.state[this.table] as TableRow[];
    const filtered = applyFilters(tableRows, this.filters);

    if (this.selectHead && this.selectCountExact) {
      return { data: null, error: null, count: filtered.length };
    }

    const ordered = applyOrder(filtered.map(cloneRow), this.orderBy);
    const limited = this.limitValue == null ? ordered : ordered.slice(0, this.limitValue);
    return { data: limited, error: null, count: limited.length };
  }
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn((table: keyof DbState) => new MockBuilder(table, db)),
  },
}));

vi.mock("../../server/lib/account", () => accountMocks);
vi.mock("../../apps/api/src/services/studentMastery", () => masteryMocks);

describe("Practice Runtime Contract", () => {
  let app: Express;
  let activeRole: "student" | "guardian" = "student";

  const questionA = {
    id: "00000000-0000-0000-0000-000000000001",
    canonical_id: "SATM1ABC123",
    section: "Math",
    section_code: "MATH",
    status: "published",
    stem: "What is 1+1?",
    question_type: "multiple_choice",
    options: JSON.stringify([
      { key: "A", text: "2" },
      { key: "B", text: "3" },
      { key: "C", text: "4" },
      { key: "D", text: "5" },
    ]),
    correct_answer: "A",
    explanation: "1+1=2",
    domain: "Algebra",
    skill: "Linear equations",
    difficulty: "easy",
  };

  const questionB = {
    id: "00000000-0000-0000-0000-000000000002",
    canonical_id: "SATM1ABC124",
    section: "Math",
    section_code: "MATH",
    status: "published",
    stem: "What is 2+2?",
    question_type: "multiple_choice",
    options: JSON.stringify([
      { key: "A", text: "3" },
      { key: "B", text: "4" },
      { key: "C", text: "5" },
      { key: "D", text: "6" },
    ]),
    correct_answer: "B",
    explanation: "2+2=4",
    domain: "Algebra",
    skill: "Linear equations",
    difficulty: "medium",
  };

  function getCorrectTokenFromSessionItem(sessionItemId: string): string {
    const item = db.practice_session_items.find((row) => row.id === sessionItemId);
    if (!item || !item.option_token_map) {
      throw new Error("missing option token map fixture");
    }

    const question = db.questions.find((row) => row.id === item.question_id);
    if (!question) {
      throw new Error("missing question fixture");
    }

    const correctKey = String(question.correct_answer || "");
    const token = Object.entries(item.option_token_map as Record<string, string>).find((entry) => entry[1] === correctKey)?.[0];
    if (!token) {
      throw new Error("missing correct token fixture");
    }

    return token;
  }

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";

    const authModule = await import("../../server/middleware/supabase-auth");

    vi.spyOn(authModule, "supabaseAuthMiddleware").mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      (req as any).user = {
        id: "00000000-0000-0000-0000-000000000000",
        email: "practice-contract@example.com",
        role: activeRole,
        isAdmin: false,
        isGuardian: activeRole === "guardian",
      };
      next();
    });

    vi.spyOn(authModule, "requireSupabaseAuth").mockImplementation((_req, _res, next) => next());
    vi.spyOn(authModule, "requireStudentOrAdmin").mockImplementation((req: Request, res: Response, next: NextFunction) => {
      if ((req as any).user?.isGuardian) {
        return res.status(403).json({ error: "Student access required" });
      }
      next();
    });

    const serverModule = await import("../../server/index");
    app = serverModule.default;
  });

  beforeEach(() => {
    activeRole = "student";
    db = {
      practice_sessions: [],
      practice_session_items: [],
      answer_attempts: [],
      questions: [cloneRow(questionA), cloneRow(questionB)],
      practice_events: [],
      student_skill_mastery: [],
    };

    accountMocks.checkUsageLimit.mockResolvedValue({
      allowed: true,
      current: 0,
      limit: 10,
      resetAt: "2099-01-01T00:00:00.000Z",
    });

    masteryMocks.applyMasteryUpdate.mockClear();
  });

  afterAll(() => {
    delete process.env.VITEST;
    vi.restoreAllMocks();
  });

  it("creates one canonical session and replays on matching start idempotency", async () => {
    const payload = {
      section: "math",
      mode: "balanced",
      client_instance_id: "tab-1",
      idempotency_key: "start-1",
    };

    const first = await request(app).post("/api/practice/sessions").set("Origin", "http://localhost:5000").send(payload);
    const second = await request(app).post("/api/practice/sessions").set("Origin", "http://localhost:5000").send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.sessionId).toBe(second.body.sessionId);
    expect(db.practice_sessions).toHaveLength(1);
  });

  it("replays same unanswered session item and enforces anti-leak on /next", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;

    const nextA = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    const nextB = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);

    expect(nextA.status).toBe(200);
    expect(nextA.body.question.correct_answer).toBeNull();
    expect(nextA.body.question.explanation).toBeNull();
    expect(nextA.body.question).not.toHaveProperty("id");
    expect(nextA.body.question).not.toHaveProperty("questionId");
    expect(nextA.body.question).not.toHaveProperty("option_token_map");
    expect(nextA.body.question).not.toHaveProperty("optionTokenMap");
    expect(Array.isArray(nextA.body.question.options)).toBe(true);
    expect(nextA.body.question.options).toHaveLength(4);

    for (const option of nextA.body.question.options) {
      expect(option).toHaveProperty("id");
      expect(option).toHaveProperty("text");
      expect(option).not.toHaveProperty("key");
      expect(option).not.toHaveProperty("canonicalKey");
    }

    expect(nextB.status).toBe(200);
    expect(nextB.body.sessionItemId).toBe(nextA.body.sessionItemId);
    expect(nextB.body.question.options).toEqual(nextA.body.question.options);
    expect(db.practice_session_items).toHaveLength(1);
  });

  it("returns authoritative state with ordinal + unresolved item", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    const state = await request(app).get(`/api/practice/sessions/${sessionId}/state?client_instance_id=tab-1`);

    expect(state.status).toBe(200);
    expect(state.body.currentOrdinal).toBe(1);
    expect(state.body.lastServedUnansweredItem.sessionItemId).toBe(next.body.sessionItemId);
    expect(state.body.lastServedUnansweredItem).not.toHaveProperty("questionId");
  });

  it("blocks second client_instance_id from advancing same session", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);

    const conflict = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-2`);

    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("conflict");
  });

  it("is idempotent per served item and does not double-write mastery", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);

    const payload = {
      sessionId,
      sessionItemId: next.body.sessionItemId,
      selectedOptionId: next.body.question.options[0].id,
      clientAttemptId: "attempt-1",
    };

    const first = await request(app).post("/api/practice/answer").set("Origin", "http://localhost:5000").send(payload);
    const second = await request(app).post("/api/practice/answer").set("Origin", "http://localhost:5000").send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.idempotentRetried).toBe(true);
    expect(db.answer_attempts).toHaveLength(1);
    expect(masteryMocks.applyMasteryUpdate).toHaveBeenCalledTimes(1);
  });

  it("submit with opaque selectedOptionId resolves correctly", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    const selectedOptionId = getCorrectTokenFromSessionItem(next.body.sessionItemId);

    const submit = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId: next.body.sessionItemId,
        selectedOptionId,
        clientAttemptId: "attempt-correct-token",
      });

    expect(submit.status).toBe(200);
    expect(submit.body.isCorrect).toBe(true);
    expect(submit.body).toHaveProperty("correctOptionId");
  });

  it("allows current-item completion after entitlement loss but blocks next-item progression", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);

    accountMocks.checkUsageLimit.mockResolvedValue({
      allowed: false,
      current: 10,
      limit: 10,
      resetAt: "2099-01-01T00:00:00.000Z",
    });

    const answer = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId: next.body.sessionItemId,
        selectedOptionId: next.body.question.options[0].id,
        clientAttemptId: "attempt-mid-session",
      });

    const blockedNext = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);

    expect(answer.status).toBe(200);
    expect(blockedNext.status).toBe(402);
  });

  it("keeps selector deterministic and applies recent-question exclusion", async () => {
    const sessionId = "00000000-0000-0000-0000-00000000aa01";
    db.practice_sessions.push({
      id: sessionId,
      user_id: "00000000-0000-0000-0000-000000000000",
      section: "Math",
      mode: "balanced",
      status: "in_progress",
      completed: false,
      metadata: { client_instance_id: "tab-1", lifecycle_state: "created", target_question_count: 20 },
    });

    db.answer_attempts.push({
      id: "00000000-0000-0000-0000-00000000bb01",
      user_id: "00000000-0000-0000-0000-000000000000",
      session_id: "old-session",
      question_id: "00000000-0000-0000-0000-000000000001",
      attempted_at: "2026-03-01T00:00:00.000Z",
      is_correct: false,
      outcome: "incorrect",
    });

    const first = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    const firstSessionItem = db.practice_session_items.find((row) => row.id === first.body.sessionItemId);

    db.practice_session_items = [];

    const second = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    const secondSessionItem = db.practice_session_items.find((row) => row.id === second.body.sessionItemId);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstSessionItem?.question_id).toBe(secondSessionItem?.question_id);
    expect(firstSessionItem?.question_id).toBe("00000000-0000-0000-0000-000000000002");
  });

  it("denies non-owner answer submit", async () => {
    const foreignSessionId = "00000000-0000-0000-0000-00000000f001";
    const foreignSessionItemId = "00000000-0000-0000-0000-00000000f101";

    db.practice_sessions.push({
      id: foreignSessionId,
      user_id: "00000000-0000-0000-0000-000000000999",
      section: "Math",
      mode: "balanced",
      status: "in_progress",
      completed: false,
      metadata: { client_instance_id: "tab-foreign", lifecycle_state: "active", target_question_count: 20 },
    });

    db.practice_session_items.push({
      id: foreignSessionItemId,
      session_id: foreignSessionId,
      user_id: "00000000-0000-0000-0000-000000000999",
      question_id: questionA.id,
      ordinal: 1,
      status: "served",
      attempt_id: null,
      option_order: ["A", "B", "C", "D"],
      option_token_map: { opt_foreign: "A", opt_foreign_b: "B", opt_foreign_c: "C", opt_foreign_d: "D" },
      client_instance_id: "tab-foreign",
    });

    const submit = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId: foreignSessionId,
        sessionItemId: foreignSessionItemId,
        selectedOptionId: "opt_foreign",
        clientAttemptId: "foreign-attempt-1",
      });

    expect(submit.status).toBe(404);
    expect(submit.body.error).toBe("session_not_found");
  });

  it("denies submit after session completion", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);

    const first = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId: next.body.sessionItemId,
        selectedOptionId: next.body.question.options[0].id,
        clientAttemptId: "attempt-before-close",
      });

    const target = db.practice_sessions.find((row) => row.id === sessionId);
    if (!target) throw new Error("missing session fixture");
    target.status = "completed";
    target.completed = true;
    target.metadata = { ...(target.metadata ?? {}), lifecycle_state: "completed" };

    const second = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId: next.body.sessionItemId,
        selectedOptionId: next.body.question.options[0].id,
        clientAttemptId: "attempt-after-close",
      });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("session_closed");
  });
  it("denies guardian practice writes", async () => {
    activeRole = "guardian";

    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-guardian" });

    expect(start.status).toBe(403);
  });
});

