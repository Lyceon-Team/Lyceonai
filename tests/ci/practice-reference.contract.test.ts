import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

describe("Practice reference questions contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads published MC questions and emits student-safe anti-leak payloads", async () => {
    const eqCalls: Array<[string, unknown]> = [];
    const rows = [{
      id: "00000000-0000-0000-0000-000000000001",
      canonical_id: "SATM1ABC123",
      stem: "What is 1 + 1?",
      section: "Math",
      section_code: "MATH",
      question_type: "multiple_choice",
      options: [
        { key: "A", text: "2" },
        { key: "B", text: "3" },
        { key: "C", text: "4" },
        { key: "D", text: "5" },
      ],
      difficulty: "easy",
      domain: "Algebra",
      skill: "linear_equations",
      subskill: "one_step",
      skill_code: "MATH.ALG.LINEAR",
      tags: [],
      competencies: [],
      answer_choice: "A",
      status: "published",
      explanation: "secret",
    }];

    const query = {
      select: vi.fn(function () { return this; }),
      eq: vi.fn(function (column: string, value: unknown) {
        eqCalls.push([column, value]);
        return this;
      }),
      in: vi.fn(function () { return this; }),
      order: vi.fn(function () { return this; }),
      limit: vi.fn(function () { return this; }),
      then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };

    fromMock.mockReturnValue(query);

    const { getPracticeQuestions } = await import("../../server/routes/practice-topics-routes");

    const req: any = { query: { limit: "1", section: "math" } };
    let statusCode = 200;
    let payload: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        payload = body;
        return this;
      },
    };

    await getPracticeQuestions(req, res);

    expect(statusCode).toBe(200);
    expect(eqCalls).toEqual(expect.arrayContaining([
      ["question_type", "multiple_choice"],
      ["status", "published"],
    ]));
    expect(payload.questions).toHaveLength(1);
    expect(payload.questions[0].correct_answer).toBeNull();
    expect(payload.questions[0].explanation).toBeNull();
    expect(payload.questions[0].answer_choice).toBeUndefined();
    expect(payload.questions[0].answer).toBeUndefined();
  });
});

