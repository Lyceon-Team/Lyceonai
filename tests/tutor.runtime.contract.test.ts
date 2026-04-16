import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const {
  callTutorOrchestratorMock,
  callLlmMock,
  handleRagQueryMock,
} = vi.hoisted(() => ({
  callTutorOrchestratorMock: vi.fn(),
  callLlmMock: vi.fn(),
  handleRagQueryMock: vi.fn(),
}));

type Role = "student" | "guardian" | "admin";

type ConversationRow = {
  id: string;
  student_id: string;
  entry_mode: "scoped_question" | "scoped_session" | "general";
  source_surface: "practice" | "review" | "test_review" | "dashboard";
  source_session_id: string | null;
  source_session_item_id: string | null;
  source_question_row_id: string | null;
  source_question_canonical_id: string | null;
  policy_family: string;
  policy_variant: string;
  policy_version: string;
  prompt_version: string;
  assignment_mode: string;
  assignment_key: string;
  initialization_snapshot: Record<string, unknown>;
  status: "active" | "closed" | "abandoned";
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  student_id: string;
  role: "student" | "tutor" | "system";
  content_kind: "message" | "suggestion" | "consent_prompt" | "system_note";
  message: string;
  content_json: Record<string, unknown> | null;
  client_turn_id: string | null;
  explanation_level: string | null;
  source_session_id: string | null;
  source_session_item_id: string | null;
  source_question_row_id: string | null;
  source_question_canonical_id: string | null;
  created_at: string;
};

type InstructionAssignmentRow = {
  id: string;
  conversation_id: string;
  student_id: string;
  related_message_id: string;
  source_session_id: string | null;
  source_session_item_id: string | null;
  source_question_row_id: string | null;
  source_question_canonical_id: string | null;
  policy_family: string;
  policy_variant: string;
  policy_version: string;
  prompt_version: string;
  assignment_mode: string;
  assignment_key: string;
  reason_snapshot: Record<string, unknown>;
  created_at: string;
};

type QuestionLinkRow = {
  id: string;
  conversation_id: string;
  student_id: string;
  source_question_row_id: string | null;
  source_question_canonical_id: string | null;
  related_question_row_id: string | null;
  related_question_canonical_id: string | null;
  relationship_type: string;
  difficulty_delta: number | null;
  reason_code: string;
  link_snapshot: Record<string, unknown>;
  created_at: string;
};

type InstructionExposureRow = {
  id: string;
  assignment_id: string;
  conversation_id: string;
  student_id: string;
  exposure_type: string;
  content_variant_key: string | null;
  content_version: string | null;
  rendered_difficulty: number | null;
  hint_depth: number | null;
  tone_style: string | null;
  sequence_ordinal: number;
  shown_at: string;
  consumed_ms: number | null;
};

type QuestionRow = {
  id: string;
  canonical_id: string;
};

type FullLengthSessionRow = {
  id: string;
  user_id: string;
  status: string;
};

type PracticeSessionRow = {
  id: string;
  user_id: string;
};

type PracticeItemRow = {
  id: string;
  user_id: string;
  status: string;
};

const state = vi.hoisted(() => ({
  currentRole: "student" as Role,
  currentUserId: "11111111-1111-4111-8111-111111111111",
  hasPaidAccess: true,
  orchestratorResult: {
    response: {
      content: "Let's work through this step-by-step.",
      content_kind: "message",
      suggested_action: {
        type: "offer_stay_focused",
        label: "Stay on this question",
      },
      ui_hints: {
        show_accept_decline: false,
        allow_freeform_reply: true,
        suggested_chip: "Stay on this question",
      },
    },
    question_links: [],
    instruction_exposures: [
      {
        exposure_type: "hint",
        content_variant_key: "offer_stay_focused",
        content_version: "1",
        rendered_difficulty: null,
        hint_depth: 1,
        tone_style: "neutral",
        sequence_ordinal: 1,
      },
    ],
    orchestration_meta: {
      model_name: "vertex-test-model",
      cache_used: false,
      compaction_recommended: false,
    },
  },
  conversations: [] as ConversationRow[],
  messages: [] as MessageRow[],
  assignments: [] as InstructionAssignmentRow[],
  questionLinks: [] as QuestionLinkRow[],
  exposures: [] as InstructionExposureRow[],
  memorySummaries: [] as Array<{
    student_id: string;
    summary_type: string;
    summary_version: string;
    content_json: Record<string, unknown>;
    source_window_start: string | null;
    source_window_end: string | null;
    created_at: string;
  }>,
  questions: [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", canonical_id: "q1" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", canonical_id: "q2" },
  ] as QuestionRow[],
  practiceSessions: [
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", user_id: "11111111-1111-4111-8111-111111111111" },
  ] as PracticeSessionRow[],
  practiceItems: [
    { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", user_id: "11111111-1111-4111-8111-111111111111", status: "in_progress" },
  ] as PracticeItemRow[],
  fullLengthSessions: [] as FullLengthSessionRow[],
  failStudentMessageInsert: false,
  failAssignmentInsert: false,
  failTutorMessageInsert: false,
  failQuestionLinkInsert: false,
  failExposureInsert: false,
  nowCursor: 0,
}));

let userSeed = 0;

function nextUserId(): string {
  userSeed += 1;
  const tail = userSeed.toString().padStart(12, "0");
  return `11111111-1111-4111-8111-${tail}`;
}

function isoAt(offset: number): string {
  return new Date(Date.UTC(2026, 3, 9, 12, 0, offset)).toISOString();
}

function nextId(prefix: string): string {
  state.nowCursor += 1;
  const n = state.nowCursor.toString().padStart(12, "0");
  return `${prefix}-0000-4000-8000-${n}`;
}

function nextIso(): string {
  state.nowCursor += 1;
  return isoAt(state.nowCursor);
}

function getCurrentUser() {
  const role = state.currentRole;
  return {
    id: state.currentUserId,
    role,
    isAdmin: role === "admin",
    isGuardian: role === "guardian",
  };
}

type AnyRow = Record<string, unknown>;

function matchFilters<T extends AnyRow>(rows: T[], filters: Array<{ op: string; column: string; value: any }>): T[] {
  return rows.filter((row) => {
    for (const filter of filters) {
      const current = row[filter.column];
      if (filter.op === "eq" && current !== filter.value) return false;
      if (filter.op === "lt" && !(String(current) < String(filter.value))) return false;
      if (filter.op === "gte" && !(String(current) >= String(filter.value))) return false;
      if (filter.op === "in" && (!Array.isArray(filter.value) || !filter.value.includes(current))) return false;
    }
    return true;
  });
}

function orderRows<T extends AnyRow>(rows: T[], orderBy: { column: string; ascending: boolean } | null): T[] {
  if (!orderBy) return rows;
  const out = [...rows];
  out.sort((a, b) => {
    const av = String(a[orderBy.column] ?? "");
    const bv = String(b[orderBy.column] ?? "");
    if (av === bv) return 0;
    if (orderBy.ascending) return av < bv ? -1 : 1;
    return av > bv ? -1 : 1;
  });
  return out;
}

function selectColumns<T extends AnyRow>(row: T, selectSpec: string | null): AnyRow {
  if (!selectSpec || selectSpec.trim() === "*" || selectSpec.trim() === "") return { ...row };
  const columns = selectSpec.split(",").map((c) => c.trim()).filter(Boolean);
  const out: AnyRow = {};
  for (const column of columns) out[column] = row[column];
  return out;
}

function tableStore(table: string): AnyRow[] {
  switch (table) {
    case "tutor_conversations":
      return state.conversations as unknown as AnyRow[];
    case "tutor_messages":
      return state.messages as unknown as AnyRow[];
    case "tutor_instruction_assignments":
      return state.assignments as unknown as AnyRow[];
    case "tutor_question_links":
      return state.questionLinks as unknown as AnyRow[];
    case "tutor_instruction_exposures":
      return state.exposures as unknown as AnyRow[];
    case "tutor_memory_summaries":
      return state.memorySummaries as unknown as AnyRow[];
    case "questions":
      return state.questions as unknown as AnyRow[];
    case "practice_sessions":
      return state.practiceSessions as unknown as AnyRow[];
    case "practice_session_items":
      return state.practiceItems as unknown as AnyRow[];
    case "full_length_exam_sessions":
      return state.fullLengthSessions as unknown as AnyRow[];
    case "review_sessions":
    case "review_session_items":
    case "full_length_exam_questions":
      return [];
    default:
      throw new Error(`Unexpected table "${table}" in test mock`);
  }
}

function createBuilder(table: string) {
  const filters: Array<{ op: string; column: string; value: any }> = [];
  let orderBy: { column: string; ascending: boolean } | null = null;
  let rowLimit: number | null = null;
  let selectSpec: string | null = null;
  let pendingInsert: AnyRow[] | null = null;
  let pendingUpdate: AnyRow | null = null;

  const execSelect = () => {
    const rows = tableStore(table);
    const filtered = matchFilters(rows, filters);
    const ordered = orderRows(filtered, orderBy);
    const limited = rowLimit === null ? ordered : ordered.slice(0, rowLimit);
    const projected = limited.map((row) => selectColumns(row, selectSpec));
    return { data: projected, error: null as any };
  };

  const execMutation = () => {
    if (pendingInsert) {
      if (table === "tutor_messages" && pendingInsert[0]?.role === "student" && state.failStudentMessageInsert) {
        pendingInsert = null;
        return { data: null, error: { code: "insert_failed", message: "student insert failed" } };
      }
      if (table === "tutor_messages" && pendingInsert[0]?.role === "tutor" && state.failTutorMessageInsert) {
        pendingInsert = null;
        return { data: null, error: { code: "insert_failed", message: "tutor insert failed" } };
      }
      if (table === "tutor_instruction_assignments" && state.failAssignmentInsert) {
        pendingInsert = null;
        return { data: null, error: { code: "insert_failed", message: "assignment insert failed" } };
      }
      if (table === "tutor_question_links" && state.failQuestionLinkInsert) {
        pendingInsert = null;
        return { data: null, error: { code: "insert_failed", message: "question link insert failed" } };
      }
      if (table === "tutor_instruction_exposures" && state.failExposureInsert) {
        pendingInsert = null;
        return { data: null, error: { code: "insert_failed", message: "exposure insert failed" } };
      }

      const inserted = pendingInsert.map((row) => {
        const withDefaults: AnyRow = { ...row };
        if (!withDefaults.id) withDefaults.id = nextId("dddddddd");
        if (!withDefaults.created_at) withDefaults.created_at = nextIso();
        if (table === "tutor_conversations" && !withDefaults.updated_at) withDefaults.updated_at = withDefaults.created_at;
        return withDefaults;
      });
      tableStore(table).push(...inserted);
      pendingInsert = null;
      return { data: inserted.map((row) => selectColumns(row, selectSpec)), error: null };
    }

    if (pendingUpdate) {
      const rows = tableStore(table);
      const filtered = matchFilters(rows, filters);
      if (filtered.length === 0) return { data: null, error: { code: "not_found", message: "no rows updated" } };
      for (const target of filtered) {
        Object.assign(target, pendingUpdate);
      }
      pendingUpdate = null;
      return { data: filtered.map((row) => selectColumns(row, selectSpec)), error: null };
    }

    return execSelect();
  };

  const builder: any = {
    select(spec: string) {
      selectSpec = spec;
      return builder;
    },
    eq(column: string, value: any) {
      filters.push({ op: "eq", column, value });
      return builder;
    },
    in(column: string, values: any[]) {
      filters.push({ op: "in", column, value: values });
      return builder;
    },
    lt(column: string, value: any) {
      filters.push({ op: "lt", column, value });
      return builder;
    },
    gte(column: string, value: any) {
      filters.push({ op: "gte", column, value });
      return builder;
    },
    order(column: string, options?: { ascending?: boolean }) {
      orderBy = { column, ascending: options?.ascending !== false };
      return builder;
    },
    limit(count: number) {
      rowLimit = count;
      return builder;
    },
    insert(payload: AnyRow | AnyRow[]) {
      pendingInsert = Array.isArray(payload) ? payload : [payload];
      return builder;
    },
    update(payload: AnyRow) {
      pendingUpdate = payload;
      return builder;
    },
    async maybeSingle() {
      if (pendingInsert || pendingUpdate) {
        const single = await builder.single();
        return single.data ? single : { data: null, error: single.error };
      }
      const { data, error } = execSelect();
      if (error) return { data: null, error };
      return { data: data[0] ?? null, error: null };
    },
    async single() {
      const { data, error } = execMutation();
      if (error) return { data: null, error };
      if (!Array.isArray(data) || !data[0]) return { data: null, error: { code: "not_found", message: "no row" } };
      return { data: data[0], error: null };
    },
    then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
      const result = execMutation();
      return Promise.resolve(result).then(resolve, reject);
    },
  };

  return builder;
}

vi.mock("../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn((table: string) => createBuilder(table)),
  },
}));

vi.mock("../server/lib/tutor-orchestrator-client", () => ({
  callTutorOrchestrator: callTutorOrchestratorMock,
}));

vi.mock("../apps/api/src/lib/rag-service", () => ({
  getRagService: () => ({
    handleRagQuery: handleRagQueryMock,
  }),
}));

vi.mock("../apps/api/src/lib/embeddings", () => ({
  callLlm: callLlmMock,
}));

vi.mock("../apps/api/src/lib/rate-limit-ledger", () => ({
  RateLimitUnavailableError: class extends Error {
    code = "RATE_LIMIT_DB_UNAVAILABLE";
  },
  checkAndReserveTutorBudget: vi.fn(async (args: any) => ({
    allowed: true,
    code: "TUTOR_RESERVED",
    message: "Tutor budget reserved.",
    limitType: "tutor",
    current: 1,
    limit: 100,
    remaining: 99,
    resetAt: "2099-01-01T00:00:00.000Z",
    cooldownUntil: null,
    reservationId: args?.role === "admin" ? null : "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    duplicate: false,
  })),
  finalizeTutorUsage: vi.fn(async () => ({
    ok: true,
    code: "TUTOR_FINALIZED",
    message: "ok",
    reservationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    state: "finalized",
    finalInputTokens: 100,
    finalOutputTokens: 100,
    finalCostMicros: 100,
  })),
  estimateTokenCount: (input: string | null | undefined) => Math.max(1, Math.ceil((input ?? "").length / 4)),
  estimateTutorCostMicros: (input: number, output: number) => Math.max(0, input + output),
}));

vi.mock("../server/services/kpi-access", () => ({
  resolvePaidKpiAccessForUser: vi.fn(async (_userId: string, role: Role) => ({
    hasPaidAccess: role === "admin" ? true : state.hasPaidAccess,
    accountId: "acct",
    plan: state.hasPaidAccess ? "paid" : "free",
    status: state.hasPaidAccess ? "active" : "inactive",
    currentPeriodEnd: null,
    reason: state.hasPaidAccess ? "ok" : "inactive",
  })),
}));

vi.mock("../server/middleware/supabase-auth", () => ({
  supabaseAuthMiddleware: (req: any, _res: any, next: any) => {
    req.requestId ??= "req-tutor-runtime";
    req.user = getCurrentUser();
    next();
  },
  requireSupabaseAuth: (req: any, res: any, next: any) => {
    req.requestId ??= "req-tutor-runtime";
    const user = getCurrentUser();
    if (!user?.id) return res.status(401).json({ error: "Authentication required" });
    req.user = user;
    return next();
  },
  requireStudentOrAdmin: (req: any, res: any, next: any) => {
    const user = req.user ?? getCurrentUser();
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (user.role === "guardian" && !user.isAdmin) {
      return res.status(403).json({ error: "Student access required", message: "Guardian access is denied." });
    }
    return next();
  },
  requireSupabaseAdmin: (_req: any, res: any) => res.status(403).json({ error: "Admin access required" }),
  requireRequestUser: (req: any, res: any) => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Authentication required", message: "You must be signed in to access this resource" });
      return null;
    }
    return req.user;
  },
  sendForbidden: (res: any, body: any) => res.status(403).json(body),
  resolveTokenFromRequest: () => ({
    token: "token",
    tokenSource: "cookie:sb-access-token",
    tokenLength: 21,
    bearerParsed: false,
    authHeaderPresent: false,
    cookieKeys: ["sb-access-token"],
  }),
  getSupabaseAdmin: () => ({ rpc: vi.fn(async () => ({ data: null, error: null })) }),
}));

vi.mock("../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => "test-csrf-token",
}));

let app: any;

async function createConversation(agent: request.SuperAgentTest, payload?: Record<string, unknown>) {
  const res = await agent.post("/api/tutor/conversations").send({
    entry_mode: "scoped_question",
    source_surface: "practice",
    source_session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    source_session_item_id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    source_question_row_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    source_question_canonical_id: "q1",
    ...payload,
  });
  return res;
}

describe("Tutor Runtime Contract Cutover", () => {
  let agent: request.SuperAgentTest;

  beforeEach(async () => {
    vi.resetModules();
    app = (await import("../server/index")).default;
    state.currentRole = "student";
    state.currentUserId = nextUserId();
    state.hasPaidAccess = true;
    state.orchestratorResult = {
      response: {
        content: "Let's work through this step-by-step.",
        content_kind: "message",
        suggested_action: {
          type: "offer_stay_focused",
          label: "Stay on this question",
        },
        ui_hints: {
          show_accept_decline: false,
          allow_freeform_reply: true,
          suggested_chip: "Stay on this question",
        },
      },
      question_links: [],
      instruction_exposures: [
        {
          exposure_type: "hint",
          content_variant_key: "offer_stay_focused",
          content_version: "1",
          rendered_difficulty: null,
          hint_depth: 1,
          tone_style: "neutral",
          sequence_ordinal: 1,
        },
      ],
      orchestration_meta: {
        model_name: "vertex-test-model",
        cache_used: false,
        compaction_recommended: false,
      },
    };
    state.conversations = [];
    state.messages = [];
    state.assignments = [];
    state.questionLinks = [];
    state.exposures = [];
    state.memorySummaries = [];
    state.fullLengthSessions = [];
    state.failStudentMessageInsert = false;
    state.failAssignmentInsert = false;
    state.failTutorMessageInsert = false;
    state.failQuestionLinkInsert = false;
    state.failExposureInsert = false;
    state.nowCursor = 0;
    state.practiceItems = [
      { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", user_id: state.currentUserId, status: "in_progress" },
    ];
    state.practiceSessions = [
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", user_id: state.currentUserId },
    ];
    callTutorOrchestratorMock.mockReset();
    callTutorOrchestratorMock.mockImplementation(async () => state.orchestratorResult);
    callLlmMock.mockReset();
    callLlmMock.mockResolvedValue("legacy fallback should not run");
    handleRagQueryMock.mockReset();
    handleRagQueryMock.mockResolvedValue({
      context: {
        primaryQuestion: {
          canonicalId: "q1",
          difficulty: 2,
          stem: "A sample SAT question",
        },
        supportingQuestions: [
          {
            canonicalId: "q2",
            difficulty: 1,
            stem: "A similar SAT question",
          },
        ],
      },
    });
    agent = request.agent(app);
  });

  it("creates a conversation and appends a turn through canonical endpoints", async () => {
    const start = await createConversation(agent);
    expect(start.status).toBe(200);
    const conversationId = start.body.data.conversation_id;

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Help me understand this",
      content_kind: "message",
      client_turn_id: "f1111111-1111-4111-8111-111111111111",
    });
    expect(turn.status).toBe(200);
    expect(turn.body.data.conversation_id).toBe(conversationId);
    expect(turn.body.data.response.content).toContain("step-by-step");
    expect(turn.body.data.response.ui_hints).toEqual(state.orchestratorResult.response.ui_hints);
    expect(state.messages.filter((m) => m.role === "student")).toHaveLength(1);
    expect(state.assignments).toHaveLength(1);
    expect(state.messages.filter((m) => m.role === "tutor")).toHaveLength(1);
    const tutorMessage = state.messages.find((m) => m.role === "tutor");
    expect(tutorMessage?.content_json?.orchestration_meta).toEqual(state.orchestratorResult.orchestration_meta);
    expect(callTutorOrchestratorMock).toHaveBeenCalledTimes(1);
    expect(callLlmMock).not.toHaveBeenCalled();
    expect(handleRagQueryMock).not.toHaveBeenCalled();
  });

  it("denies guardians from tutor boundaries", async () => {
    state.currentRole = "guardian";
    const start = await createConversation(agent);
    expect(start.status).toBe(403);
  });

  it("blocks append turn when entitlement is lost mid-conversation", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;

    state.hasPaidAccess = false;
    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Continue",
      content_kind: "message",
      client_turn_id: "f2222222-2222-4222-8222-222222222222",
    });

    expect(turn.status).toBe(402);
    expect(turn.body.error.code).toBe("PREMIUM_REQUIRED");
  });

  it("enforces stored scope precedence over conflicting client scope", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Use this question please",
      content_kind: "message",
      client_turn_id: "f3333333-3333-4333-8333-333333333333",
      client_scope: {
        source_question_row_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        source_question_canonical_id: "q2",
      },
    });

    expect(turn.status).toBe(200);
    const studentMessage = state.messages.find((m) => m.role === "student");
    expect(studentMessage?.source_question_canonical_id).toBe("q1");
    expect(studentMessage?.source_question_row_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
  });

  it("reuses recent valid conversation scope when stored scoped question becomes stale", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    const conversation = state.conversations.find((row) => row.id === conversationId)!;
    conversation.source_question_row_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
    conversation.source_question_canonical_id = "q_missing";
    state.messages.push({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
      conversation_id: conversationId,
      student_id: state.currentUserId,
      role: "student",
      content_kind: "message",
      message: "Earlier scoped context",
      content_json: {},
      client_turn_id: "f9999999-9999-4999-8999-999999999991",
      explanation_level: null,
      source_session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      source_session_item_id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      source_question_row_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      source_question_canonical_id: "q2",
      created_at: isoAt(100),
    });

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Scope should reuse recent valid question",
      content_kind: "message",
      client_turn_id: "f9999999-9999-4999-8999-999999999992",
    });

    expect(turn.status).toBe(200);
    const newStudentMessage = state.messages.find((m) => m.client_turn_id === "f9999999-9999-4999-8999-999999999992");
    expect(newStudentMessage?.source_question_row_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2");
    expect(newStudentMessage?.source_question_canonical_id).toBe("q2");
    expect(state.assignments[0]?.reason_snapshot?.fallback_used).toBe("reused_recent_conversation_scope");
    const payload = callTutorOrchestratorMock.mock.calls[0]?.[0] as any;
    expect(payload.resolved_scope.source_question_row_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2");
    expect(payload.resolved_scope.source_question_canonical_id).toBe("q2");
    expect(payload.policy_assignment.reason_snapshot.fallback_used).toBe("reused_recent_conversation_scope");
  });

  it("degrades stale scoped question to scoped_session when session remains valid", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    const conversation = state.conversations.find((row) => row.id === conversationId)!;
    conversation.source_question_row_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
    conversation.source_question_canonical_id = "q_missing";

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Use scoped session fallback",
      content_kind: "message",
      client_turn_id: "fa999999-9999-4999-8999-999999999991",
    });

    expect(turn.status).toBe(200);
    const newStudentMessage = state.messages.find((m) => m.client_turn_id === "fa999999-9999-4999-8999-999999999991");
    expect(newStudentMessage?.source_session_id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1");
    expect(newStudentMessage?.source_session_item_id).toBe("cccccccc-cccc-4ccc-8ccc-ccccccccccc1");
    expect(newStudentMessage?.source_question_row_id).toBeNull();
    expect(newStudentMessage?.source_question_canonical_id).toBeNull();
    expect(state.assignments[0]?.reason_snapshot?.fallback_used).toBe("degraded_to_scoped_session");
    const payload = callTutorOrchestratorMock.mock.calls[0]?.[0] as any;
    expect(payload.resolved_scope).toMatchObject({
      source_session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      source_session_item_id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      source_question_row_id: null,
      source_question_canonical_id: null,
    });
    expect(payload.policy_assignment.reason_snapshot.fallback_used).toBe("degraded_to_scoped_session");
  });

  it("degrades stale scoped references to general when no valid scoped session exists (no fail-open)", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    const conversation = state.conversations.find((row) => row.id === conversationId)!;
    conversation.source_session_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9";
    conversation.source_session_item_id = "cccccccc-cccc-4ccc-8ccc-ccccccccccc9";
    conversation.source_question_row_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
    conversation.source_question_canonical_id = "q_missing";

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Degrade safely",
      content_kind: "message",
      client_turn_id: "fb999999-9999-4999-8999-999999999991",
    });

    expect(turn.status).toBe(200);
    const newStudentMessage = state.messages.find((m) => m.client_turn_id === "fb999999-9999-4999-8999-999999999991");
    expect(newStudentMessage).toMatchObject({
      source_session_id: null,
      source_session_item_id: null,
      source_question_row_id: null,
      source_question_canonical_id: null,
    });
    expect(state.assignments[0]?.reason_snapshot?.fallback_used).toBe("degraded_to_general");
    const payload = callTutorOrchestratorMock.mock.calls[0]?.[0] as any;
    expect(payload.resolved_scope).toEqual({
      source_session_id: null,
      source_session_item_id: null,
      source_question_row_id: null,
      source_question_canonical_id: null,
    });
    expect(payload.policy_assignment.reason_snapshot.fallback_used).toBe("degraded_to_general");
  });

  it("is idempotent on duplicate client_turn_id and does not duplicate student rows", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    const payload = {
      conversation_id: conversationId,
      message: "Retry this safely",
      content_kind: "message",
      client_turn_id: "f4444444-4444-4444-8444-444444444444",
    };

    const first = await agent.post("/api/tutor/messages").send(payload);
    const second = await agent.post("/api/tutor/messages").send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.messages.filter((m) => m.role === "student" && m.client_turn_id === payload.client_turn_id)).toHaveLength(1);
  });

  it("replay uses stored suggested_action and ui_hints from persisted tutor content_json", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    const payload = {
      conversation_id: conversationId,
      message: "Please help again",
      content_kind: "message",
      client_turn_id: "f4444444-4444-4444-8444-444444444445",
    };

    const first = await agent.post("/api/tutor/messages").send(payload);
    expect(first.status).toBe(200);

    const tutorMessage = state.messages.find((m) => m.role === "tutor");
    expect(tutorMessage).toBeTruthy();
    tutorMessage!.content_json = {
      ...(tutorMessage!.content_json ?? {}),
      suggested_action: {
        type: "offer_broader_coaching",
        label: "Zoom out",
      },
      ui_hints: {
        show_accept_decline: true,
        allow_freeform_reply: false,
        suggested_chip: "Zoom out",
      },
    };

    const replay = await agent.post("/api/tutor/messages").send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body.data.response.suggested_action).toEqual({
      type: "offer_broader_coaching",
      label: "Zoom out",
    });
    expect(replay.body.data.response.ui_hints).toEqual({
      show_accept_decline: true,
      allow_freeform_reply: false,
      suggested_chip: "Zoom out",
    });
    expect(callTutorOrchestratorMock).toHaveBeenCalledTimes(1);
  });

  it("returns recoverable retry when question link persistence fails, then replay-heals without re-orchestrating", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    state.orchestratorResult = {
      ...state.orchestratorResult,
      question_links: [
        {
          source_question_row_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          source_question_canonical_id: "q1",
          related_question_row_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          related_question_canonical_id: "q2",
          relationship_type: "similar_retry",
          difficulty_delta: -1,
          reason_code: "student_consented_similar_offer",
          link_snapshot: { source: "orchestrator" },
        },
      ],
    };
    state.failQuestionLinkInsert = true;

    const payload = {
      conversation_id: conversationId,
      message: "Try this",
      content_kind: "message",
      client_turn_id: "f4444444-4444-4444-8444-444444444446",
    };

    const failed = await agent.post("/api/tutor/messages").send(payload);
    expect(failed.status).toBe(409);
    expect(failed.body.error.code).toBe("TUTOR_RECOVERABLE_RETRY_REQUIRED");
    expect(state.messages.filter((m) => m.role === "tutor")).toHaveLength(1);
    expect(state.questionLinks).toHaveLength(0);

    state.failQuestionLinkInsert = false;
    const recovered = await agent.post("/api/tutor/messages").send(payload);
    expect(recovered.status).toBe(200);
    expect(state.questionLinks).toHaveLength(1);
    expect(callTutorOrchestratorMock).toHaveBeenCalledTimes(1);
  });

  it("returns recoverable retry when instruction exposure persistence fails, then replay-heals without re-orchestrating", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    state.failExposureInsert = true;

    const payload = {
      conversation_id: conversationId,
      message: "Try this",
      content_kind: "message",
      client_turn_id: "f4444444-4444-4444-8444-444444444447",
    };

    const failed = await agent.post("/api/tutor/messages").send(payload);
    expect(failed.status).toBe(409);
    expect(failed.body.error.code).toBe("TUTOR_RECOVERABLE_RETRY_REQUIRED");
    expect(state.messages.filter((m) => m.role === "tutor")).toHaveLength(1);
    expect(state.exposures).toHaveLength(0);

    state.failExposureInsert = false;
    const recovered = await agent.post("/api/tutor/messages").send(payload);
    expect(recovered.status).toBe(200);
    expect(state.exposures).toHaveLength(1);
    expect(callTutorOrchestratorMock).toHaveBeenCalledTimes(1);
  });

  it("returns recoverable retry when replayed tutor content_json is missing stored ui helpers", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    const payload = {
      conversation_id: conversationId,
      message: "Retry this safely",
      content_kind: "message",
      client_turn_id: "f4444444-4444-4444-8444-444444444448",
    };

    const first = await agent.post("/api/tutor/messages").send(payload);
    expect(first.status).toBe(200);
    const tutorMessage = state.messages.find((m) => m.role === "tutor");
    expect(tutorMessage).toBeTruthy();
    const stripped = { ...(tutorMessage!.content_json ?? {}) };
    delete (stripped as Record<string, unknown>).suggested_action;
    tutorMessage!.content_json = stripped;

    const replay = await agent.post("/api/tutor/messages").send(payload);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe("TUTOR_RECOVERABLE_RETRY_REQUIRED");
  });

  it("passes compatible memory summaries through to orchestrator unchanged", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    state.memorySummaries = [
      {
        student_id: state.currentUserId,
        summary_type: "teaching_profile",
        summary_version: "1",
        content_json: { pace: "steady" },
        source_window_start: "2026-04-09T00:00:00.000Z",
        source_window_end: "2026-04-10T00:00:00.000Z",
        created_at: isoAt(10),
      },
    ];

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Use memory summaries",
      content_kind: "message",
      client_turn_id: "fc999999-9999-4999-8999-999999999991",
    });

    expect(turn.status).toBe(200);
    const payload = callTutorOrchestratorMock.mock.calls[0]?.[0] as any;
    expect(payload.memory_summaries).toEqual([
      {
        summary_type: "teaching_profile",
        summary_version: "1",
        content_json: { pace: "steady" },
        source_window_start: "2026-04-09T00:00:00.000Z",
        source_window_end: "2026-04-10T00:00:00.000Z",
      },
    ]);
    expect(payload.policy_assignment.reason_snapshot.policy_inputs.memory_summary_counts).toEqual({
      accepted: 1,
      rejected: 0,
    });
  });

  it("filters incompatible memory summaries and only reduces memory context for the turn", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    state.memorySummaries = [
      {
        student_id: state.currentUserId,
        summary_type: "teaching_profile",
        summary_version: "1",
        content_json: { confidence: "medium" },
        source_window_start: "2026-04-09T00:00:00.000Z",
        source_window_end: "2026-04-10T00:00:00.000Z",
        created_at: isoAt(30),
      },
      {
        student_id: state.currentUserId,
        summary_type: "unsupported_type",
        summary_version: "1",
        content_json: { invalid: true },
        source_window_start: "2026-04-09T00:00:00.000Z",
        source_window_end: "2026-04-10T00:00:00.000Z",
        created_at: isoAt(20),
      },
      {
        student_id: state.currentUserId,
        summary_type: "study_context",
        summary_version: 7 as unknown as string,
        content_json: "not-an-object" as unknown as Record<string, unknown>,
        source_window_start: null,
        source_window_end: null,
        created_at: isoAt(10),
      },
    ];

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Filter invalid summaries safely",
      content_kind: "message",
      client_turn_id: "fd999999-9999-4999-8999-999999999991",
    });

    expect(turn.status).toBe(200);
    const payload = callTutorOrchestratorMock.mock.calls[0]?.[0] as any;
    expect(payload.memory_summaries).toHaveLength(1);
    expect(payload.memory_summaries[0]).toMatchObject({
      summary_type: "teaching_profile",
      summary_version: "1",
      content_json: { confidence: "medium" },
    });
    expect(payload.policy_assignment.reason_snapshot.policy_inputs.memory_summary_counts).toEqual({
      accepted: 1,
      rejected: 2,
    });
    expect(payload.resolved_scope.source_question_canonical_id).toBe("q1");
    expect(payload.resolved_scope.source_question_row_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    expect(callLlmMock).not.toHaveBeenCalled();
    expect(handleRagQueryMock).not.toHaveBeenCalled();
  });

  it("continues safely with empty memory summaries when all stored rows are incompatible", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    state.memorySummaries = [
      {
        student_id: state.currentUserId,
        summary_type: "unsupported_type",
        summary_version: "1",
        content_json: { invalid: true },
        source_window_start: "2026-04-09T00:00:00.000Z",
        source_window_end: "2026-04-10T00:00:00.000Z",
        created_at: isoAt(20),
      },
      {
        student_id: state.currentUserId,
        summary_type: "study_context",
        summary_version: "1",
        content_json: [] as unknown as Record<string, unknown>,
        source_window_start: 1 as unknown as string,
        source_window_end: null,
        created_at: isoAt(10),
      },
    ];

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "All summaries invalid should still be bounded-safe",
      content_kind: "message",
      client_turn_id: "fe999999-9999-4999-8999-999999999991",
    });

    expect(turn.status).toBe(200);
    const payload = callTutorOrchestratorMock.mock.calls[0]?.[0] as any;
    expect(payload.memory_summaries).toEqual([]);
    expect(payload.policy_assignment.reason_snapshot.policy_inputs.memory_summary_counts).toEqual({
      accepted: 0,
      rejected: 2,
    });
  });

  it("returns explicit recoverable failure shape when blocking assignment write fails", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    state.failAssignmentInsert = true;

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Try turn",
      content_kind: "message",
      client_turn_id: "f5555555-5555-4555-8555-555555555555",
    });

    expect(turn.status).toBe(409);
    expect(turn.body).toMatchObject({
      error: {
        code: "TUTOR_RECOVERABLE_RETRY_REQUIRED",
        message: "The tutor turn could not be completed safely. Please retry.",
        retryable: true,
      },
    });
  });

  it("returns recoverable retry when orchestrator call throws", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    callTutorOrchestratorMock.mockRejectedValueOnce(new Error("orchestrator unavailable"));

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Try turn",
      content_kind: "message",
      client_turn_id: "f5555555-5555-4555-8555-555555555556",
    });

    expect(turn.status).toBe(409);
    expect(turn.body).toMatchObject({
      error: {
        code: "TUTOR_RECOVERABLE_RETRY_REQUIRED",
        message: "The tutor turn could not be completed safely. Please retry.",
        retryable: true,
      },
    });
    expect(callLlmMock).not.toHaveBeenCalled();
    expect(handleRagQueryMock).not.toHaveBeenCalled();
  });

  it("returns recoverable retry when orchestrator response shape is invalid", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    callTutorOrchestratorMock.mockRejectedValueOnce(
      new Error("Tutor orchestrator returned invalid response shape"),
    );

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Try turn",
      content_kind: "message",
      client_turn_id: "f5555555-5555-4555-8555-555555555557",
    });

    expect(turn.status).toBe(409);
    expect(turn.body).toMatchObject({
      error: {
        code: "TUTOR_RECOVERABLE_RETRY_REQUIRED",
        message: "The tutor turn could not be completed safely. Please retry.",
        retryable: true,
      },
    });
    expect(callLlmMock).not.toHaveBeenCalled();
    expect(handleRagQueryMock).not.toHaveBeenCalled();
  });

  it.each([
    "The correct answer is A.",
    "Choose option C.",
    "Option B is correct.",
    "Eliminate all but option D.",
  ])("blocks anti-leak answer reveal in pre-submit practice for '%s'", async (content) => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    state.orchestratorResult = {
      ...state.orchestratorResult,
      response: {
        ...state.orchestratorResult.response,
        content,
      },
    };
    state.practiceItems = [
      { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", user_id: state.currentUserId, status: "in_progress" },
    ];

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Just tell me the answer",
      content_kind: "message",
      client_turn_id: "f6666666-6666-4666-8666-666666666666",
    });

    expect(turn.status).toBe(422);
    expect(turn.body.error.code).toBe("TUTOR_ANTI_LEAK_BLOCKED");
    expect(callTutorOrchestratorMock).toHaveBeenCalledTimes(1);
    expect(state.assignments).toHaveLength(1);
    expect(state.messages.filter((m) => m.role === "tutor")).toHaveLength(0);
    expect(state.questionLinks).toHaveLength(0);
    expect(state.exposures).toHaveLength(0);
  });

  it("allows direct-answer explanation content after submit in practice", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    state.orchestratorResult = {
      ...state.orchestratorResult,
      response: {
        ...state.orchestratorResult.response,
        content: "The correct answer is A because the slope is positive across the interval.",
      },
    };
    state.practiceItems = [
      { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", user_id: state.currentUserId, status: "answered" },
    ];

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Explain why that answer works",
      content_kind: "message",
      client_turn_id: "f6766666-6666-4666-8666-666666666666",
    });

    expect(turn.status).toBe(200);
    expect(state.messages.filter((m) => m.role === "tutor")).toHaveLength(1);
  });

  it("keeps non-answer instructional hints allowed in pre-submit practice", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    state.orchestratorResult = {
      ...state.orchestratorResult,
      response: {
        ...state.orchestratorResult.response,
        content: "Try eliminating choices that violate the units before solving exactly.",
      },
    };
    state.practiceItems = [
      { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", user_id: state.currentUserId, status: "in_progress" },
    ];

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Give me a strategy hint only",
      content_kind: "message",
      client_turn_id: "f6866666-6666-4666-8666-666666666666",
    });

    expect(turn.status).toBe(200);
    expect(turn.body.data.response.content).toContain("eliminating");
  });

  it("blocks tutor while a full-length exam is live", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    state.fullLengthSessions = [
      { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", user_id: state.currentUserId, status: "in_progress" },
    ];

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Can you help now?",
      content_kind: "message",
      client_turn_id: "f7777777-7777-4777-8777-777777777777",
    });

    expect(turn.status).toBe(409);
    expect(turn.body.error.code).toBe("TUTOR_UNAVAILABLE_LIVE_FULL_LENGTH");
  });

  it("reuses most recently updated eligible active conversation", async () => {
    const envelope = {
      student_id: state.currentUserId,
      entry_mode: "scoped_question" as const,
      source_surface: "practice" as const,
      source_session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      source_session_item_id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      source_question_row_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      source_question_canonical_id: "q1",
      policy_family: "tutor_v1",
      policy_variant: "default",
      policy_version: "1",
      prompt_version: "1",
      assignment_mode: "deterministic",
      assignment_key: "default",
      initialization_snapshot: {},
      status: "active" as const,
    };
    state.conversations.push(
      { id: "99999999-9999-4999-8999-999999999991", ...envelope, created_at: isoAt(1), updated_at: isoAt(2) },
      { id: "99999999-9999-4999-8999-999999999992", ...envelope, created_at: isoAt(3), updated_at: isoAt(4) },
    );

    const start = await createConversation(agent);
    expect(start.status).toBe(200);
    expect(start.body.data.conversation_id).toBe("99999999-9999-4999-8999-999999999992");
  });

  it("persists similar-question links with row+canonical ids and difficulty delta", async () => {
    const start = await createConversation(agent);
    const conversationId = start.body.data.conversation_id;
    state.orchestratorResult = {
      response: {
        content: "Let's try a similar one next.",
        content_kind: "message",
        suggested_action: {
          type: "offer_similar_question",
          label: "Try a similar question",
        },
        ui_hints: {
          show_accept_decline: true,
          allow_freeform_reply: true,
          suggested_chip: "Try a similar question",
        },
      },
      question_links: [
        {
          source_question_row_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          source_question_canonical_id: "q1",
          related_question_row_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          related_question_canonical_id: "q2",
          relationship_type: "similar_retry",
          difficulty_delta: -1,
          reason_code: "student_consented_similar_offer",
          link_snapshot: {
            source: "orchestrator",
          },
        },
      ],
      instruction_exposures: [
        {
          exposure_type: "similar_question_offer",
          content_variant_key: "offer_similar_question",
          content_version: "1",
          rendered_difficulty: null,
          hint_depth: null,
          tone_style: "neutral",
          sequence_ordinal: 1,
        },
      ],
      orchestration_meta: {
        model_name: "vertex-test-model",
        cache_used: false,
        compaction_recommended: false,
      },
    };

    const turn = await agent.post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "Can I try a similar question?",
      content_kind: "message",
      client_turn_id: "f8888888-8888-4888-8888-888888888888",
    });

    expect(turn.status).toBe(200);
    expect(turn.body.data.response.suggested_action.type).toBe("offer_similar_question");
    expect(state.questionLinks).toHaveLength(1);
    expect(state.questionLinks[0]).toMatchObject({
      source_question_row_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      source_question_canonical_id: "q1",
      related_question_row_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      related_question_canonical_id: "q2",
      relationship_type: "similar_retry",
      difficulty_delta: -1,
    });
    expect(state.exposures).toHaveLength(1);
    expect(state.exposures[0]).toMatchObject({
      exposure_type: "similar_question_offer",
      content_variant_key: "offer_similar_question",
    });
  });
});
