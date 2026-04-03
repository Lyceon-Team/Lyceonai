import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const state = vi.hoisted(() => ({
  currentUser: {
    id: "student-auth-user",
    role: "student",
    isAdmin: false,
    isGuardian: false,
  } as any,
  hasActiveFullTest: false,
  hasVerifiedRetry: false,
  retryIsCorrect: false,
  retryOutcome: "incorrect" as "correct" | "incorrect" | "skipped",
  questionLookupMissing: false,
  tableCalls: [] as string[],
  rpcCalls: [] as string[],
}));

const accountMocks = vi.hoisted(() => ({
  checkUsageLimit: vi.fn(async () => ({
    allowed: true,
    current: 0,
    limit: 10,
    resetAt: "2099-01-01T00:00:00.000Z",
  })),
  incrementUsage: vi.fn(async () => ({ ai_messages_used: 1, practice_questions_used: 0 })),
  getAccountIdForUser: vi.fn(async () => "acct-test"),
  ensureAccountForUser: vi.fn(async () => "acct-test"),
  resolveLinkedPairPremiumAccessForStudent: vi.fn(async () => ({ hasPremiumAccess: false })),
  resolveLinkedPairPremiumAccessForGuardian: vi.fn(async () => ({ hasPremiumAccess: false })),
  FREE_TIER_LIMITS: { ai_chat: 5, practice: 10 },
}));

const { callLlmMock, handleRagQueryMock, updateStudentStyleMock, logTutorInteractionMock } = vi.hoisted(() => ({
  callLlmMock: vi.fn().mockResolvedValue("Mock tutor response"),
  handleRagQueryMock: vi.fn(async (request: any) => {
    if (request.mode === "strategy") {
      return {
        context: {
          primaryQuestion: null,
          supportingQuestions: [],
          competencyContext: {
            studentWeakAreas: [],
            studentStrongAreas: [],
            competencyLabels: [],
          },
          studentProfile: {
            overallLevel: 3,
            primaryStyle: "step-by-step",
            secondaryStyle: null,
            explanationLevel: 2,
          },
        },
        metadata: { canonicalIdsUsed: [] },
      };
    }

    return {
      context: {
        primaryQuestion: {
          canonicalId: "q1",
          stem: "What is 2 + 2?",
          options: [{ key: "A", text: "4" }],
          answer: "A",
          explanation: "2 + 2 = 4",
          competencies: [],
        },
        supportingQuestions: [
          {
            canonicalId: "q2",
            stem: "What is 3 + 3?",
            options: [{ key: "B", text: "6" }],
            answer: "B",
            explanation: "3 + 3 = 6",
            competencies: [],
          },
        ],
        competencyContext: {
          studentWeakAreas: [],
          studentStrongAreas: [],
          competencyLabels: [],
        },
        studentProfile: {
          overallLevel: 3,
          primaryStyle: "step-by-step",
          secondaryStyle: null,
          explanationLevel: 2,
        },
      },
      metadata: { canonicalIdsUsed: ["q1", "q2"] },
    };
  }),
  updateStudentStyleMock: vi.fn().mockResolvedValue(true),
  logTutorInteractionMock: vi.fn().mockResolvedValue(true),
}));

vi.mock("../apps/api/src/lib/embeddings", () => ({
  callLlm: callLlmMock,
  generateEmbedding: vi.fn(),
}));

vi.mock("../apps/api/src/lib/rag-service", () => ({
  getRagService: () => ({
    handleRagQuery: handleRagQueryMock,
  }),
}));

vi.mock("../apps/api/src/lib/profile-service", () => ({
  updateStudentStyle: updateStudentStyleMock,
}));

vi.mock("../apps/api/src/lib/tutor-log", () => ({
  logTutorInteraction: logTutorInteractionMock,
}));

vi.mock("../server/lib/account", () => accountMocks);

vi.mock("../apps/api/src/lib/supabase-server", () => {
  function createBuilder(table: string) {
    const filters: Record<string, any> = {};
    const builder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((column: string, value: any) => {
        filters[column] = value;
        return builder;
      }),
      in: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => {
        if (table === "full_length_exam_sessions") {
          if (state.hasActiveFullTest) {
            return { data: { id: "exam-1", status: "in_progress" }, error: null };
          }
          return { data: null, error: null };
        }

        if (table === "questions") {
          if (state.questionLookupMissing) {
            return { data: null, error: null };
          }
          if (filters.canonical_id === "q1") {
            return { data: { id: "question-row-q1" }, error: null };
          }
          return { data: null, error: null };
        }

        if (table === "answer_attempts") {
          if (
            state.hasVerifiedRetry
            && filters.user_id === "student-auth-user"
            && filters.question_id === "question-row-q1"
          ) {
            return { data: { id: "attempt-1", is_correct: state.retryIsCorrect, outcome: state.retryOutcome }, error: null };
          }
          return { data: null, error: null };
        }

        return { data: null, error: null };
      }),
      single: vi.fn(async () => ({ data: null, error: null })),
    };

    return builder;
  }

  return {
    supabaseServer: {
      from: vi.fn((table: string) => {
        state.tableCalls.push(table);
        return createBuilder(table);
      }),
      rpc: vi.fn(async (fnName: string) => {
        state.rpcCalls.push(fnName);
        return { data: null, error: null };
      }),
    },
  };
});

vi.mock("../server/routes/questions-runtime", () => ({
  getQuestions: (_req: any, res: any) => res.json([]),
  getRandomQuestions: (_req: any, res: any) => res.json([]),
  getQuestionCount: (_req: any, res: any) => res.json({ count: 0 }),
  getQuestionStats: (_req: any, res: any) => res.json({}),
  getQuestionsFeed: (_req: any, res: any) => res.json([]),
  getRecentQuestions: (_req: any, res: any) => res.json([]),
  getQuestionById: (_req: any, res: any) => res.status(404).json({ error: "not found" }),
  getReviewErrors: (_req: any, res: any) => res.json([]),
  submitQuestionFeedback: (_req: any, res: any) => res.json({ ok: true }),
}));

vi.mock("../server/middleware/supabase-auth", () => ({
  supabaseAuthMiddleware: (req: any, _res: any, next: any) => {
    if (state.currentUser) {
      req.user = { ...state.currentUser };
      req.requestId ??= "req-tutor-runtime";
    }
    next();
  },
  requireSupabaseAuth: (req: any, res: any, next: any) => {
    if (!state.currentUser) {
      return res.status(401).json({ error: "Authentication required" });
    }
    req.user = { ...state.currentUser };
    req.requestId ??= "req-tutor-runtime";
    return next();
  },
  requireRequestUser: (req: any, res: any) => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Authentication required", message: "You must be signed in to access this resource" });
      return null;
    }
    return req.user;
  },
  requireRequestAuthContext: (req: any, res: any) => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Authentication required", message: "You must be signed in to access this resource" });
      return null;
    }
    return { user: req.user, supabase: req.supabase };
  },
  requireStudentOrAdmin: (req: any, res: any, next: any) => {
    const user = req.user || state.currentUser;
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (user.isGuardian && !user.isAdmin) {
      return res.status(403).json({ error: "Student access required" });
    }
    return next();
  },
  requireSupabaseAdmin: (_req: any, res: any) => {
    return res.status(403).json({ error: "Admin access required" });
  },
  getSupabaseAdmin: () => ({
    rpc: vi.fn(async () => ({ data: "acc-test", error: null })),
  }),
}));

const { default: app } = await import("../server/index");
let agent: request.SuperAgentTest;
let csrfToken: string;

async function getCsrfToken(agent: request.SuperAgentTest): Promise<string> {
  const res = await agent.get("/api/csrf-token");
  expect(res.status).toBe(200);
  return res.body.csrfToken as string;
}

describe("Tutor Runtime Contract - Wave 1.5", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.currentUser = {
      id: "student-auth-user",
      role: "student",
      isAdmin: false,
      isGuardian: false,
    };
    state.hasActiveFullTest = false;
    state.hasVerifiedRetry = false;
    state.retryIsCorrect = false;
    state.retryOutcome = "incorrect";
    state.questionLookupMissing = false;
    state.tableCalls = [];
    state.rpcCalls = [];
    agent = request.agent(app);
    csrfToken = await getCsrfToken(agent);
  });

  it("enforces CSRF on tutor POST when auth is present", async () => {
    const res = await request(app)
      .post("/api/tutor/v2")
      .send({ message: "help", mode: "concept" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("csrf_blocked");
  });

  it("uses authenticated user id and ignores body userId", async () => {
    const res = await agent
      .post("/api/tutor/v2")
      .set("x-csrf-token", csrfToken)
      .send({ userId: "attacker-id", message: "help", mode: "question", canonicalQuestionId: "q1" });

    expect(res.status).toBe(200);
    expect(handleRagQueryMock).toHaveBeenCalledTimes(1);
    expect(handleRagQueryMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "student-auth-user" }));
    expect(handleRagQueryMock).not.toHaveBeenCalledWith(expect.objectContaining({ userId: "attacker-id" }));
  });

  it("does not leak answers pre-submit", async () => {
    const res = await agent
      .post("/api/tutor/v2")
      .set("x-csrf-token", csrfToken)
      .send({ message: "help", mode: "question", canonicalQuestionId: "q1" });

    expect(res.status).toBe(200);
    expect(res.body.ragContext.primaryQuestion.answer).toBeNull();
    expect(res.body.ragContext.primaryQuestion.explanation).toBeNull();
    expect(res.body.ragContext.supportingQuestions[0].answer).toBeNull();
    expect(res.body.ragContext.supportingQuestions[0].explanation).toBeNull();
    expect(res.body.metadata.fullTestStrategyEnforced).toBe(false);
  });

  it("does not leak taxonomy codes or Lisa branding in tutor prompt/response", async () => {
    handleRagQueryMock.mockResolvedValueOnce({
      context: {
        primaryQuestion: {
          canonicalId: "q1",
          stem: "What is 2 + 2?",
          options: [{ key: "A", text: "4" }],
          answer: "A",
          explanation: "2 + 2 = 4",
          competencies: [],
        },
        supportingQuestions: [],
        competencyContext: {
          studentWeakAreas: ["M.LIN.1"],
          studentStrongAreas: ["M.GEO.2"],
          competencyLabels: ["M.LIN.1", "M.GEO.2"],
        },
        studentProfile: {
          overallLevel: 3,
          primaryStyle: "step-by-step",
          secondaryStyle: null,
          explanationLevel: 2,
        },
      },
      metadata: { canonicalIdsUsed: ["q1"] },
    });

    const res = await agent
      .post("/api/tutor/v2")
      .set("x-csrf-token", csrfToken)
      .send({ message: "help", mode: "question", canonicalQuestionId: "q1" });

    expect(res.status).toBe(200);
    expect(res.body.ragContext.competencyContext.studentWeakAreas).toEqual([]);
    expect(res.body.ragContext.competencyContext.studentStrongAreas).toEqual([]);
    expect(res.body.ragContext.competencyContext.competencyLabels).toEqual([]);

    const [userContents, systemInstruction] = callLlmMock.mock.calls[0] ?? [];
    const parts = Array.isArray(userContents)
      ? userContents.flatMap((item: any) => item?.parts ?? []).map((p: any) => p?.text ?? "")
      : [];
    const promptText = parts.join("\n");

    expect(systemInstruction).not.toContain("Lisa");
    expect(promptText).not.toContain("M.LIN.1");
    expect(promptText).not.toContain("M.GEO.2");
  });

  it("forces strategy mode and blocks leakage during active full-length exam", async () => {
    state.hasActiveFullTest = true;
    state.hasVerifiedRetry = true;

    const res = await agent
      .post("/api/tutor/v2")
      .set("x-csrf-token", csrfToken)
      .send({ message: "help", mode: "question", canonicalQuestionId: "q1" });

    expect(res.status).toBe(200);
    expect(handleRagQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "strategy", canonicalQuestionId: undefined })
    );
    expect(res.body.metadata.mode).toBe("strategy");
    expect(res.body.metadata.requestedMode).toBe("question");
    expect(res.body.metadata.fullTestStrategyEnforced).toBe(true);
    expect(res.body.ragContext.primaryQuestion).toBeNull();
    expect(res.body.ragContext.supportingQuestions).toEqual([]);
  });

  it("tutor open without verified retry does not write mastery tables", async () => {
    const res = await agent
      .post("/api/tutor/v2")
      .set("x-csrf-token", csrfToken)
      .send({ message: "help", mode: "question", canonicalQuestionId: "q1" });

    expect(res.status).toBe(200);
    expect(state.tableCalls).not.toContain("student_skill_mastery");
    expect(state.tableCalls).not.toContain("student_cluster_mastery");
    expect(state.rpcCalls).not.toContain("upsert_skill_mastery");
    expect(state.rpcCalls).not.toContain("upsert_cluster_mastery");
  });

  it.each([
    { retryIsCorrect: true, label: "correct" },
    { retryIsCorrect: false, label: "incorrect" },
  ])("verified retry ($label) enables downstream tutor reveal behavior", async ({ retryIsCorrect }) => {
    state.hasVerifiedRetry = true;
    state.retryIsCorrect = retryIsCorrect;
    state.retryOutcome = retryIsCorrect ? "correct" : "incorrect";

    const res = await agent
      .post("/api/tutor/v2")
      .set("x-csrf-token", csrfToken)
      .send({ message: "help", mode: "question", canonicalQuestionId: "q1" });

    expect(res.status).toBe(200);
    expect(res.body.metadata.fullTestStrategyEnforced).toBe(false);
    expect(res.body.ragContext.primaryQuestion.answer).toBe("A");
    expect(res.body.ragContext.primaryQuestion.explanation).toBe("2 + 2 = 4");
  });

  it("skipped attempt does not unlock tutor reveal", async () => {
    state.hasVerifiedRetry = true;
    state.retryIsCorrect = false;
    state.retryOutcome = "skipped";

    const res = await agent
      .post("/api/tutor/v2")
      .set("x-csrf-token", csrfToken)
      .send({ message: "help", mode: "question", canonicalQuestionId: "q1" });

    expect(res.status).toBe(200);
    expect(res.body.ragContext.primaryQuestion.answer).toBeNull();
    expect(res.body.ragContext.primaryQuestion.explanation).toBeNull();
    expect(res.body.ragContext.supportingQuestions[0].answer).toBeNull();
    expect(res.body.ragContext.supportingQuestions[0].explanation).toBeNull();
  });

  it("fails closed when canonical question cannot be resolved for verified retry check", async () => {
    state.hasVerifiedRetry = true;
    state.questionLookupMissing = true;

    const res = await agent
      .post("/api/tutor/v2")
      .set("x-csrf-token", csrfToken)
      .send({ message: "help", mode: "question", canonicalQuestionId: "q1" });

    expect(res.status).toBe(200);
    expect(res.body.metadata.fullTestStrategyEnforced).toBe(false);
    expect(res.body.ragContext.primaryQuestion.answer).toBeNull();
    expect(res.body.ragContext.primaryQuestion.explanation).toBeNull();
    expect(res.body.ragContext.supportingQuestions[0].answer).toBeNull();
    expect(res.body.ragContext.supportingQuestions[0].explanation).toBeNull();
  });

  it("enforces role guard server-side (guardian blocked)", async () => {
    state.currentUser = {
      id: "guardian-user",
      role: "guardian",
      isAdmin: false,
      isGuardian: true,
    };

    const res = await agent
      .post("/api/tutor/v2")
      .set("x-csrf-token", csrfToken)
      .send({ message: "help", mode: "question", canonicalQuestionId: "q1" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Student access required");
  });
});

