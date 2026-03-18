
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
let activeUserId = "00000000-0000-0000-0000-000000000000";

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

  const questionC = {
    id: "00000000-0000-0000-0000-000000000003",
    canonical_id: "SATM1ABC125",
    section: "Math",
    section_code: "MATH",
    status: "published",
    stem: "Solve for x: x + 5 = 8",
    question_type: "multiple_choice",
    options: JSON.stringify([
      { key: "A", text: "1" },
      { key: "B", text: "2" },
      { key: "C", text: "3" },
      { key: "D", text: "4" },
    ]),
    correct_answer: "C",
    explanation: "x=3",
    domain: "Geometry",
    skill: "Lines and angles",
    difficulty: "hard",
  };

  const questionRw = {
    id: "00000000-0000-0000-0000-000000000004",
    canonical_id: "SATRW2ABC123",
    section: "RW",
    section_code: "RW",
    status: "published",
    stem: "Choose the best transition.",
    question_type: "multiple_choice",
    options: JSON.stringify([
      { key: "A", text: "However" },
      { key: "B", text: "Therefore" },
      { key: "C", text: "Meanwhile" },
      { key: "D", text: "Likewise" },
    ]),
    correct_answer: "A",
    explanation: "Transition logic",
    domain: "Grammar",
    skill: "Transitions",
    difficulty: "easy",
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
        id: activeUserId,
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
    activeUserId = "00000000-0000-0000-0000-000000000000";
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
    expect(first.body.targetQuestionCount).toBe(20);
    expect(db.practice_sessions).toHaveLength(1);
  });

  it("accepts multi-select start payload and persists normalized canonical session spec metadata", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "random",
        sections: ["rw", "math", "rw"],
        domains: [" Algebra ", "Geometry", "algebra"],
        difficulties: ["hard", "2", "easy", "hard"],
        target_question_count: 12,
        mode: "balanced",
        client_instance_id: "tab-1",
      });

    expect(start.status).toBe(200);
    expect(start.body.targetQuestionCount).toBe(12);

    const session = db.practice_sessions.find((row) => row.id === start.body.sessionId);
    if (!session) throw new Error("missing session fixture");

    expect(session.section).toBe("Random");
    expect(session.metadata.session_spec).toEqual({
      sections: ["Math", "RW"],
      domains: ["algebra", "geometry"],
      difficulties: ["easy", "medium", "hard"],
      target_minutes: null,
      target_question_count: 12,
      mode: "balanced",
    });
  });

  it("derives deterministic target question count from target_minutes when count is absent", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        target_minutes: 25,
        client_instance_id: "tab-1",
      });

    expect(start.status).toBe(200);
    expect(start.body.targetQuestionCount).toBe(17);

    const session = db.practice_sessions.find((row) => row.id === start.body.sessionId);
    if (!session) throw new Error("missing session fixture");
    expect(session.metadata.target_question_count).toBe(17);
    expect(session.metadata.session_spec).toEqual(expect.objectContaining({
      target_minutes: 25,
      target_question_count: 17,
    }));
  });

  it("selection consumes persisted session_spec sections/domains/difficulties", async () => {
    db.questions.push(cloneRow(questionC), cloneRow(questionRw));

    const sessionId = "00000000-0000-0000-0000-00000000aa09";
    db.practice_sessions.push({
      id: sessionId,
      user_id: "00000000-0000-0000-0000-000000000000",
      section: "Random",
      mode: "balanced",
      status: "in_progress",
      completed: false,
      metadata: {
        client_instance_id: "tab-1",
        lifecycle_state: "created",
        target_question_count: 20,
        session_spec: {
          sections: ["RW"],
          domains: ["grammar"],
          difficulties: ["easy"],
          target_minutes: null,
          target_question_count: 20,
          mode: "balanced",
        },
      },
    });

    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    expect(next.status).toBe(200);

    const served = db.practice_session_items.find((row) => row.id === next.body.sessionItemId);
    if (!served) throw new Error("missing served item fixture");
    expect(served.question_id).toBe(questionRw.id);
  });

  it("session start prebuilds full persisted item count", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        target_question_count: 5,
        client_instance_id: "tab-1",
      });

    expect(start.status).toBe(200);
    expect(db.practice_session_items).toHaveLength(5);
    expect(db.practice_session_items.map((row) => row.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(db.practice_session_items.filter((row) => row.status === "served")).toHaveLength(1);
    expect(db.practice_session_items.filter((row) => row.status === "queued")).toHaveLength(4);
    expect(db.practice_session_items.some((row) => row.status === "answered" && row.attempt_id == null)).toBe(false);
  });

  it("fills smaller exact pool via deterministic exact-only reuse", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        domains: ["algebra"],
        difficulties: ["easy"],
        target_question_count: 4,
        client_instance_id: "tab-1",
      });

    expect(start.status).toBe(200);
    expect(db.practice_session_items).toHaveLength(4);
    expect(new Set(db.practice_session_items.map((row) => row.question_id))).toEqual(new Set([questionA.id]));

    const session = db.practice_sessions.find((row) => row.id === start.body.sessionId);
    if (!session) throw new Error("missing session fixture");
    expect(session.metadata.selection_mode).toBe("exact_reuse");
    expect(session.metadata.source_pool_count).toBe(1);
    expect(session.metadata.requested_count).toBe(4);
  });

  it("next serves prebuilt ordinals without dynamic row creation", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        target_question_count: 3,
        client_instance_id: "tab-1",
      });

    const sessionId = start.body.sessionId;
    const prebuiltCount = db.practice_session_items.length;

    const nextOne = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    expect(nextOne.status).toBe(200);
    expect(nextOne.body.ordinal).toBe(1);
    expect(db.practice_session_items).toHaveLength(prebuiltCount);
    expect(db.practice_session_items.filter((row) => row.status === "served")).toHaveLength(1);
    expect(db.practice_session_items.filter((row) => row.status === "queued")).toHaveLength(2);
    expect(db.practice_session_items.filter((row) => row.status === "answered")).toHaveLength(0);

    const submit = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId: nextOne.body.sessionItemId,
        selectedOptionId: nextOne.body.question.options[0].id,
        clientAttemptId: "prebuilt-next-step-1",
      });
    expect(submit.status).toBe(200);

    const nextTwo = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    expect(nextTwo.status).toBe(200);
    expect(nextTwo.body.ordinal).toBe(2);
    expect(db.practice_session_items).toHaveLength(prebuiltCount);
    expect(db.practice_session_items.filter((row) => row.status === "served")).toHaveLength(1);
    expect(db.practice_session_items.filter((row) => row.status === "queued")).toHaveLength(1);
    expect(db.practice_session_items.filter((row) => row.status === "answered" && row.attempt_id == null)).toHaveLength(0);
  });

  it("skip persists attempt truth and marks served item as skipped", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        target_question_count: 3,
        client_instance_id: "tab-1",
      });

    const sessionId = start.body.sessionId;
    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    const sessionItemId = next.body.sessionItemId as string;

    const skip = await request(app)
      .post(`/api/practice/sessions/${sessionId}/skip`)
      .set("Origin", "http://localhost:5000")
      .send({
        sessionItemId,
        clientAttemptId: "skip-attempt-1",
        client_instance_id: "tab-1",
      });

    expect(skip.status).toBe(200);
    expect(skip.body.skipped).toBe(true);

    const item = db.practice_session_items.find((row) => row.id === sessionItemId);
    if (!item) throw new Error("missing skipped session item fixture");
    expect(item.status).toBe("skipped");
    expect(item.attempt_id).toBeTruthy();

    const attempt = db.answer_attempts.find((row) => row.session_item_id === sessionItemId);
    if (!attempt) throw new Error("missing skip attempt fixture");
    expect(attempt.outcome).toBe("skipped");
    expect(masteryMocks.applyMasteryUpdate).not.toHaveBeenCalled();
  });

  it("skip advances deterministically to next queued item without regenerating items", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        target_question_count: 3,
        client_instance_id: "tab-1",
      });

    const sessionId = start.body.sessionId;
    const prebuiltCount = db.practice_session_items.length;

    const first = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    expect(first.status).toBe(200);
    expect(first.body.ordinal).toBe(1);

    const skipped = await request(app)
      .post(`/api/practice/sessions/${sessionId}/skip`)
      .set("Origin", "http://localhost:5000")
      .send({
        sessionItemId: first.body.sessionItemId,
        clientAttemptId: "skip-attempt-2",
        client_instance_id: "tab-1",
      });
    expect(skipped.status).toBe(200);

    const second = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    expect(second.status).toBe(200);
    expect(second.body.ordinal).toBe(2);
    expect(db.practice_session_items).toHaveLength(prebuiltCount);
  });

  it("fails closed when answering a queued prebuilt item directly", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        target_question_count: 3,
        client_instance_id: "tab-1",
      });

    const sessionId = start.body.sessionId;
    const first = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    expect(first.status).toBe(200);

    const queuedItem = db.practice_session_items.find((row) => row.session_id === sessionId && row.status === "queued");
    if (!queuedItem) throw new Error("missing queued session item fixture");

    const beforeAttempts = db.answer_attempts.length;
    const directAnswer = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId: queuedItem.id,
        selectedOptionId: first.body.question.options[0].id,
        clientAttemptId: "queued-direct-answer-1",
      });

    expect(directAnswer.status).toBe(409);
    expect(db.answer_attempts).toHaveLength(beforeAttempts);
  });

  it("state counts keep skipped separate from answered and track completed progress", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        target_question_count: 3,
        client_instance_id: "tab-1",
      });

    const sessionId = start.body.sessionId;
    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    const skip = await request(app)
      .post(`/api/practice/sessions/${sessionId}/skip`)
      .set("Origin", "http://localhost:5000")
      .send({
        sessionItemId: next.body.sessionItemId,
        clientAttemptId: "skip-attempt-3",
        client_instance_id: "tab-1",
      });
    expect(skip.status).toBe(200);

    const state = await request(app).get(`/api/practice/sessions/${sessionId}/state?client_instance_id=tab-1`);
    expect(state.status).toBe(200);
    expect(state.body.answeredCount).toBe(0);
    expect(state.body.skippedCount).toBe(1);
    expect(state.body.completedCount).toBe(1);
  });

  it("final-item skip closes session and blocks further progression", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        target_question_count: 1,
        client_instance_id: "tab-1",
      });

    const sessionId = start.body.sessionId;
    const first = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);

    const skip = await request(app)
      .post(`/api/practice/sessions/${sessionId}/skip`)
      .set("Origin", "http://localhost:5000")
      .send({
        sessionItemId: first.body.sessionItemId,
        clientAttemptId: "skip-final-1",
        client_instance_id: "tab-1",
      });

    expect(skip.status).toBe(200);
    expect(skip.body.state).toBe("completed");

    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    expect(next.status).toBe(409);
    expect(next.body.error).toBe("session_closed");
  });

  it("skipped item cannot later be answered through normal submit path", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        target_question_count: 3,
        client_instance_id: "tab-1",
      });

    const sessionId = start.body.sessionId;
    const first = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);

    const skip = await request(app)
      .post(`/api/practice/sessions/${sessionId}/skip`)
      .set("Origin", "http://localhost:5000")
      .send({
        sessionItemId: first.body.sessionItemId,
        clientAttemptId: "skip-then-answer-1",
        client_instance_id: "tab-1",
      });
    expect(skip.status).toBe(200);

    const answerLater = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId: first.body.sessionItemId,
        selectedOptionId: first.body.question.options[0].id,
        clientAttemptId: "answer-after-skip-1",
      });

    expect(answerLater.status).toBe(200);
    expect(answerLater.body.feedback).toBe("Skipped");
    expect(answerLater.body.isCorrect).toBe(false);
  });

  it("terminated session blocks skip", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        target_question_count: 3,
        client_instance_id: "tab-1",
      });

    const sessionId = start.body.sessionId;
    const first = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);

    const terminated = await request(app)
      .post(`/api/practice/sessions/${sessionId}/terminate`)
      .set("Origin", "http://localhost:5000")
      .send({});
    expect(terminated.status).toBe(200);

    const skipAfterTerminate = await request(app)
      .post(`/api/practice/sessions/${sessionId}/skip`)
      .set("Origin", "http://localhost:5000")
      .send({
        sessionItemId: first.body.sessionItemId,
        clientAttemptId: "skip-after-terminate-1",
        client_instance_id: "tab-1",
      });

    expect(skipAfterTerminate.status).toBe(409);
    expect(skipAfterTerminate.body.error).toBe("session_closed");
  });

  it("state answeredCount is driven by real attempts, not queued prebuilt rows", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        section: "math",
        target_question_count: 3,
        client_instance_id: "tab-1",
      });

    const sessionId = start.body.sessionId;
    const before = await request(app).get(`/api/practice/sessions/${sessionId}/state?client_instance_id=tab-1`);
    expect(before.status).toBe(200);
    expect(before.body.answeredCount).toBe(0);

    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    const submit = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId: next.body.sessionItemId,
        selectedOptionId: next.body.question.options[0].id,
        clientAttemptId: "count-real-attempts-1",
      });

    expect(submit.status).toBe(200);
    const after = await request(app).get(`/api/practice/sessions/${sessionId}/state?client_instance_id=tab-1`);
    expect(after.status).toBe(200);
    expect(after.body.answeredCount).toBe(1);
  });

  it("replay start does not duplicate prebuilt session items", async () => {
    const payload = {
      section: "math",
      target_question_count: 6,
      idempotency_key: "prebuild-replay-1",
      client_instance_id: "tab-1",
    };

    const first = await request(app).post("/api/practice/sessions").set("Origin", "http://localhost:5000").send(payload);
    const second = await request(app).post("/api/practice/sessions").set("Origin", "http://localhost:5000").send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.sessionId).toBe(second.body.sessionId);
    expect(db.practice_session_items).toHaveLength(6);
  });

  it("fails closed when exact filtered pool is empty", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({
        sections: ["rw"],
        domains: ["grammar"],
        difficulties: ["hard"],
        target_question_count: 4,
        client_instance_id: "tab-1",
      });

    expect(start.status).toBe(422);
    expect(start.body).toEqual(expect.objectContaining({
      error: "empty_exact_pool",
      code: "PRACTICE_EXACT_POOL_EMPTY",
    }));
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
    expect(db.practice_session_items).toHaveLength(20);
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

  it("fails closed when a foreign user's attempt exists for the same session_item_id", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    const sessionItemId = next.body.sessionItemId;

    db.answer_attempts.push({
      id: "00000000-0000-0000-0000-00000000fa11",
      user_id: "00000000-0000-0000-0000-000000000999",
      session_id: sessionId,
      question_id: questionA.id,
      session_item_id: sessionItemId,
      is_correct: false,
      outcome: "incorrect",
      attempted_at: "2026-03-15T00:00:00.000Z",
      client_attempt_id: "foreign-attempt",
    });

    const submit = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId,
        selectedOptionId: next.body.question.options[0].id,
        clientAttemptId: "attempt-local-collision",
      });

    expect(submit.status).toBe(409);
    expect(submit.body.error).toBe("duplicate_submission");
    expect(submit.body.idempotentRetried).toBeUndefined();
    expect(masteryMocks.applyMasteryUpdate).not.toHaveBeenCalled();
  });

  it("submit with opaque selectedOptionId resolves correctly", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    const selectedOptionId = getCorrectTokenFromSessionItem(next.body.sessionItemId);

    expect(next.body.question.correct_answer).toBeNull();
    expect(next.body.question.explanation).toBeNull();

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
    expect(submit.body.correctOptionId).toBe(selectedOptionId);
    expect(submit.body.explanation).toEqual(expect.stringMatching(/\S/));
  });

  it("fails closed when payload is free-response-only on mounted MC submit", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);

    const submit = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId: next.body.sessionItemId,
        freeResponseAnswer: "4",
        clientAttemptId: "attempt-free-response-only",
      });

    expect(submit.status).toBe(400);
    expect(submit.body.code).toBe("MC_OPTION_REQUIRED");
    expect(db.answer_attempts).toHaveLength(0);
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

    expect(submit.status).toBe(403);
    expect(submit.body.error).toBe("forbidden");
  });

  it("keeps ownership-hidden session lookup behavior on state (non-owner => 404)", async () => {
    db.practice_sessions.push({
      id: "00000000-0000-0000-0000-00000000f301",
      user_id: "00000000-0000-0000-0000-000000000999",
      section: "Math",
      mode: "balanced",
      status: "in_progress",
      completed: false,
      metadata: { client_instance_id: "tab-foreign", lifecycle_state: "active", target_question_count: 20 },
    });

    const state = await request(app)
      .get("/api/practice/sessions/00000000-0000-0000-0000-00000000f301/state?client_instance_id=tab-1");

    expect(state.status).toBe(404);
    expect(state.body.error).toBe("session_not_found");
  });

  it("fails closed on session/item mismatch during submit", async () => {
    const startA = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });
    const sessionA = startA.body.sessionId;
    const sessionB = "00000000-0000-0000-0000-00000000f302";
    const sessionItemB = "00000000-0000-0000-0000-00000000f303";

    db.practice_sessions.push({
      id: sessionB,
      user_id: "00000000-0000-0000-0000-000000000000",
      section: "Math",
      mode: "balanced",
      status: "in_progress",
      completed: false,
      metadata: { client_instance_id: "tab-2", lifecycle_state: "active", target_question_count: 20 },
    });

    db.practice_session_items.push({
      id: sessionItemB,
      session_id: sessionB,
      user_id: "00000000-0000-0000-0000-000000000000",
      question_id: questionA.id,
      ordinal: 1,
      status: "served",
      attempt_id: null,
      option_order: ["A", "B", "C", "D"],
      option_token_map: { opt_b1: "A", opt_b2: "B", opt_b3: "C", opt_b4: "D" },
      client_instance_id: "tab-2",
    });

    const submit = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId: sessionA,
        sessionItemId: sessionItemB,
        selectedOptionId: "opt_b1",
        clientAttemptId: "attempt-session-item-mismatch",
      });

    expect(submit.status).toBe(404);
    expect(submit.body.error).toBe("question_not_served");
    expect(db.answer_attempts).toHaveLength(0);
  });

  it("keeps same-user idempotent replay working with clientAttemptId", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    const selectedOptionId = next.body.question.options[0].id;

    const first = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId: next.body.sessionItemId,
        selectedOptionId,
        clientAttemptId: "attempt-idempotent-still-works",
      });

    const second = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId: next.body.sessionItemId,
        selectedOptionId,
        clientAttemptId: "attempt-idempotent-still-works",
      });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.idempotentRetried).toBe(true);
    expect(db.answer_attempts).toHaveLength(1);
  });

  it("fails closed when served session item has missing owner", async () => {
    const sessionId = "00000000-0000-0000-0000-00000000f201";
    const sessionItemId = "00000000-0000-0000-0000-00000000f202";

    db.practice_sessions.push({
      id: sessionId,
      user_id: "00000000-0000-0000-0000-000000000000",
      section: "Math",
      mode: "balanced",
      status: "in_progress",
      completed: false,
      metadata: { client_instance_id: "tab-1", lifecycle_state: "active", target_question_count: 20 },
    });

    db.practice_session_items.push({
      id: sessionItemId,
      session_id: sessionId,
      user_id: null,
      question_id: questionA.id,
      ordinal: 1,
      status: "served",
      attempt_id: null,
      option_order: ["A", "B", "C", "D"],
      option_token_map: { opt_a: "A", opt_b: "B", opt_c: "C", opt_d: "D" },
      client_instance_id: "tab-1",
    });

    const submit = await request(app)
      .post("/api/practice/answer")
      .set("Origin", "http://localhost:5000")
      .send({
        sessionId,
        sessionItemId,
        selectedOptionId: "opt_a",
        clientAttemptId: "attempt-missing-owner",
      });

    expect(submit.status).toBe(403);
    expect(submit.body.error).toBe("forbidden");
    expect(db.answer_attempts).toHaveLength(0);
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

  it("terminate endpoint marks session abandoned and closed", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    const terminated = await request(app)
      .post(`/api/practice/sessions/${sessionId}/terminate`)
      .set("Origin", "http://localhost:5000")
      .send({});

    expect(terminated.status).toBe(200);
    expect(terminated.body.state).toBe("abandoned");
    expect(terminated.body.readOnly).toBe(true);

    const session = db.practice_sessions.find((row) => row.id === sessionId);
    if (!session) throw new Error("missing session fixture");
    expect(session.status).toBe("abandoned");
    expect(session.completed).toBe(true);
    expect(session.metadata.lifecycle_state).toBe("abandoned");
  });

  it("persists and restores calculator state in practice session metadata", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    const calculatorState = {
      version: 10,
      expressions: {
        list: [
          {
            id: "1",
            latex: "y=x^2",
          },
        ],
      },
    };

    const save = await request(app)
      .post(`/api/practice/sessions/${sessionId}/calculator-state`)
      .set("Origin", "http://localhost:5000")
      .send({
        client_instance_id: "tab-1",
        calculator_state: calculatorState,
      });

    expect(save.status).toBe(200);
    expect(save.body.calculatorState).toEqual(calculatorState);

    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    expect(next.status).toBe(200);
    expect(next.body.calculatorState).toEqual(calculatorState);

    const state = await request(app).get(`/api/practice/sessions/${sessionId}/state?client_instance_id=tab-1`);
    expect(state.status).toBe(200);
    expect(state.body.calculatorState).toEqual(calculatorState);
  });

  it("terminate clears persisted calculator state", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;

    await request(app)
      .post(`/api/practice/sessions/${sessionId}/calculator-state`)
      .set("Origin", "http://localhost:5000")
      .send({
        client_instance_id: "tab-1",
        calculator_state: { version: 10, expressions: { list: [{ id: "1", latex: "y=2x" }] } },
      });

    const terminated = await request(app)
      .post(`/api/practice/sessions/${sessionId}/terminate`)
      .set("Origin", "http://localhost:5000")
      .send({});

    expect(terminated.status).toBe(200);
    const session = db.practice_sessions.find((row) => row.id === sessionId);
    if (!session) throw new Error("missing session fixture");
    expect(session.metadata.calculator_state).toBeNull();
  });

  it("terminated session is no longer resumable as active", async () => {
    const start = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    const sessionId = start.body.sessionId;
    await request(app)
      .post(`/api/practice/sessions/${sessionId}/terminate`)
      .set("Origin", "http://localhost:5000")
      .send({});

    const next = await request(app).get(`/api/practice/sessions/${sessionId}/next?client_instance_id=tab-1`);
    expect(next.status).toBe(409);
    expect(next.body.error).toBe("session_closed");

    const restarted = await request(app)
      .post("/api/practice/sessions")
      .set("Origin", "http://localhost:5000")
      .send({ section: "math", mode: "balanced", client_instance_id: "tab-1" });

    expect(restarted.status).toBe(200);
    expect(restarted.body.sessionId).not.toBe(sessionId);
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

