import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fromMock,
  applyLearningEventToMasteryMock,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  applyLearningEventToMasteryMock: vi.fn(),
}));

vi.mock("../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

vi.mock("../apps/api/src/services/studentMastery", () => ({
  applyLearningEventToMastery: applyLearningEventToMasteryMock,
}));

vi.mock("../server/lib/review-runtime-gate", () => ({
  getReviewRuntimeAvailability: vi.fn(async () => ({ available: true })),
  sendReviewRuntimeUnavailable: vi.fn(),
}));

import { submitReviewSessionAnswer } from "../server/routes/review-session-routes";

function makeRes() {
  let statusCode = 200;
  let body: any = null;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  };

  return { res, getStatus: () => statusCode, getBody: () => body };
}

function buildChain(result: { data: any; error: any }) {
  const chain: any = {
    error: result.error,
    select: () => chain,
    eq: () => chain,
    contains: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => chain,
    gt: () => chain,
    in: () => chain,
    update: () => chain,
    single: async () => result,
    maybeSingle: async () => result,
  };
  return chain;
}

function setupSupabase(options: { hasTutorContext: boolean }) {
  fromMock.mockImplementation((table: string) => {
    if (table === "review_sessions") {
      const sessionRow = {
        id: "sess-1",
        student_id: "student-1",
        status: "active",
        started_at: "2026-03-10T10:00:00.000Z",
        completed_at: null,
        abandoned_at: null,
        client_instance_id: null,
      };
      const sessionResult = { data: sessionRow, error: null };
      return {
        select: () => buildChain(sessionResult),
        update: () => buildChain({ data: null, error: null }),
      };
    }

    if (table === "review_session_items") {
      const itemRow = {
        id: "item-1",
        review_session_id: "sess-1",
        student_id: "student-1",
        ordinal: 1,
        question_canonical_id: "SATM1ABC123",
        source_question_id: "q-1",
        source_question_canonical_id: "SATM1ABC123",
        source_origin: "practice",
        retry_mode: "same_question",
        status: "served",
        attempt_id: null,
        tutor_opened_at: null,
        source_attempted_at: "2026-03-10T09:58:00.000Z",
        option_order: ["A", "B", "C", "D"],
        option_token_map: { opt_A: "A", opt_B: "B", opt_C: "C", opt_D: "D" },
        question_section: "Math",
        question_stem: "What is 1+1?",
        question_options: [
          { key: "A", text: "2" },
          { key: "B", text: "3" },
          { key: "C", text: "4" },
          { key: "D", text: "5" },
        ],
        question_difficulty: 2,
        question_difficulty_bucket: 2,
        question_domain: "Algebra",
        question_skill: "Linear equations",
        question_subskill: null,
        question_exam: "SAT",
        question_structure_cluster_id: null,
        question_correct_answer: "A",
        question_explanation: "Because 1+1=2.",
      };
      const itemResult = { data: itemRow, error: null };
      const emptyResult = { data: null, error: null };

      return {
        select: (columns?: string) => {
          if (typeof columns === "string" && columns.includes("question_canonical_id")) {
            return buildChain(itemResult);
          }
          return buildChain(emptyResult);
        },
        update: () => buildChain({ data: null, error: null }),
      };
    }

    if (table === "review_error_attempts") {
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: "attempt-1", question_id: "q-1", is_correct: true },
              error: null,
            }),
          }),
        }),
        select: () => buildChain({ data: null, error: null }),
      };
    }

    if (table === "review_session_events") {
      return {
        insert: async () => ({ error: null }),
      };
    }

    if (table === "tutor_interactions") {
      const tutorResult = {
        data: options.hasTutorContext ? { id: "ti-1", created_at: "2026-03-10T10:05:00.000Z" } : null,
        error: null,
      };
      return {
        select: () => buildChain(tutorResult),
      };
    }

    throw new Error(`Unexpected table mock request: ${table}`);
  });
}

describe("Review Error -> Canonical Mastery Bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyLearningEventToMasteryMock.mockResolvedValue({
      ok: true,
      error: undefined,
    });
  });

  it("emits REVIEW_PASS when retry is correct without tutor context", async () => {
    setupSupabase({ hasTutorContext: false });
    const { res, getStatus, getBody } = makeRes();

    const req: any = {
      user: { id: "student-1" },
      requestId: "req-review-1",
      body: {
        session_id: "sess-1",
        review_session_item_id: "item-1",
        selected_option_id: "opt_A",
        seconds_spent: 12,
        source_context: "review_errors",
      },
    };

    await submitReviewSessionAnswer(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().reviewOutcome).toBe("review_pass");
    expect(applyLearningEventToMasteryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: "student-1",
        sourceFamily: "review",
        section: "Math",
        domain: "Algebra",
        skill: "Linear equations",
        difficulty: 2,
        correct: true,
      })
    );
  });

  it("emits REVIEW_PASS only when tutor context is present (no tutor mastery)", async () => {
    setupSupabase({ hasTutorContext: true });
    const { res, getStatus, getBody } = makeRes();

    const req: any = {
      user: { id: "student-1" },
      requestId: "req-review-2",
      body: {
        session_id: "sess-1",
        review_session_item_id: "item-1",
        selected_option_id: "opt_A",
        seconds_spent: 12,
        source_context: "review_errors",
      },
    };

    await submitReviewSessionAnswer(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().reviewOutcome).toBe("review_pass");
    expect(applyLearningEventToMasteryMock).toHaveBeenCalledTimes(1);
    expect(applyLearningEventToMasteryMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sourceFamily: "review",
        correct: true,
      })
    );
  });
});
