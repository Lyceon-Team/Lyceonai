/**
 * @spec [Doc-03D_V1.2 §6.6, §6.3; SCL-043]
 * @implemented 2026-08-26
 *
 * plain English: Negative-control contract tests for tutor-retrieval.ts
 * retrieval scope per Karl ruling (SCL-043). Two retrieval scope invariants:
 *
 *   1. Pre-submit: unseen same-skill questions MUST NOT appear.
 *      (a student who has never answered question Q must not receive Q's
 *      explanation — it contains the answer value.)
 *
 *   2. Pre-submit: the active question's explanation MUST appear.
 *      (LISA needs the authored reasoning path; the output serializer
 *      INV-03-04 prevents it from reaching the student.)
 *
 * Without both negative controls, the filter could silently pass unseen
 * explanations (direction 1) or silently block the active question's
 * explanation (direction 2).
 *
 * trade-offs:
 *  - Mocks supabaseServer at module level to provide deterministic rows.
 *    Does not exercise real Postgres — the negative control is that the
 *    filter predicates (.in / allowedIds construction) produce the correct
 *    inclusion/exclusion set.
 *  - The semantic path (Vertex AI RAG Engine) is empty at V1 and is not
 *    the subject of these tests.
 *  - retrieveCurriculum is not yet wired into tutor-runtime.ts — these
 *    tests exercise the service directly.
 *
 * edge cases:
 *  - Pre-submit with no answered questions and no active question: empty set.
 *  - Post-submit: all same-skill explanations permitted (no filter).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock supabaseServer ──────────────────────────────────────────────

/**
 * In-memory question bank and practice_session_items for the mock.
 * Seeded per-test via resetMockData().
 */
const mockQuestions: Array<{
  canonical_id: string;
  explanation: string | null;
  skill_codes: string[];
}> = [];

const mockPracticeSessionItems: Array<{
  question_id: string;
  user_id: string;
  status: string;
}> = [];

/**
 * Filtering mock: applies .overlaps(), .not("is", null), .in(), .eq()
 * against the seeded data. The chain is thenable (Supabase pattern).
 */
function makeMockSupabase() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from: (table: string) => {
      if (table === "servable_questions") {
        return makeQueryChain(mockQuestions);
      }
      if (table === "practice_session_items") {
        return makeQueryChain(mockPracticeSessionItems);
      }
      return makeQueryChain([]);
    },
  };
  return client;
}

type Row = Record<string, unknown>;

function makeQueryChain(initialRows: Row[]) {
  let rows = [...initialRows];
  let selectedFields: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let countOpts: any = undefined;

  const chain: Record<string, unknown> = {};

  chain.select = (
    fields?: string,
    opts?: { count?: string; head?: boolean },
  ) => {
    selectedFields = fields;
    countOpts = opts;
    return chain;
  };

  chain.eq = (col: string, val: unknown) => {
    rows = rows.filter((r) => r[col] === val);
    return chain;
  };

  chain.not = (col: string, op: string, val: unknown) => {
    if (op === "is" && val === null) {
      rows = rows.filter((r) => r[col] !== null && r[col] !== undefined);
    }
    return chain;
  };

  chain.overlaps = (col: string, vals: unknown[]) => {
    rows = rows.filter((r) => {
      const arr = r[col];
      if (!Array.isArray(arr)) return false;
      return arr.some((v: unknown) => (vals as unknown[]).includes(v));
    });
    return chain;
  };

  chain.in = (col: string, vals: unknown[]) => {
    rows = rows.filter((r) => (vals as unknown[]).includes(r[col]));
    return chain;
  };

  chain.limit = (_n: number) => {
    return chain;
  };

  chain.then = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => {
    let result: unknown;
    if (countOpts?.head && countOpts?.count === "exact") {
      result = { data: null, count: rows.length, error: null };
    } else {
      const projected = selectedFields
        ? projectFields(rows, selectedFields)
        : rows;
      result = { data: projected, error: null };
    }
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };

  return chain;
}

function projectFields(rows: Row[], fields: string): Row[] {
  const keys = fields.split(",").map((f) => f.trim());
  return rows.map((row) => {
    const out: Row = {};
    for (const k of keys) {
      if (k in row) out[k] = row[k];
    }
    return out;
  });
}

// ── Module mocks ─────────────────────────────────────────────────────

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: makeMockSupabase(),
}));

vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import after mocks ──────────────────────────────────────────────

import { retrieveCurriculum } from "../../server/services/tutor-retrieval";

// ── Helpers ──────────────────────────────────────────────────────────

function resetMockData(
  questions: typeof mockQuestions,
  items: typeof mockPracticeSessionItems,
): void {
  mockQuestions.length = 0;
  mockQuestions.push(...questions);
  mockPracticeSessionItems.length = 0;
  mockPracticeSessionItems.push(...items);
}

// ── Tests ────────────────────────────────────────────────────────────

describe("tutor-retrieval scope — negative controls (SCL-043, LISA-RAG-001)", () => {
  beforeEach(() => {
    resetMockData([], []);
  });

  // ── Direction 1: unseen must NOT appear pre-submit ──────────────

  it("pre-submit: unseen same-skill question's explanation does NOT appear", async () => {
    resetMockData(
      [
        {
          canonical_id: "q-active",
          explanation: "Active Q explanation",
          skill_codes: ["ALG-01"],
        },
        {
          canonical_id: "q-unseen",
          explanation: "Unseen Q explanation (contains answer!)",
          skill_codes: ["ALG-01"],
        },
      ],
      [
        // Student has NOT answered q-unseen — no practice_session_items entry
        // Student has answered some other question (not in this skill)
      ],
    );

    const result = await retrieveCurriculum({
      student_id: "student-1",
      active_skill_codes: ["ALG-01"],
      active_question_canonical_id: "q-active",
      is_pre_submit: true,
      surface: "practice",
      max_items: 10,
    });

    // Active question's explanation MUST appear (direction 2)
    const ids = result.items.map((i) => i.provenance);
    expect(ids).toContain("question_explanation:q-active");

    // NEGATIVE CONTROL: unseen question's explanation MUST NOT appear
    expect(ids).not.toContain("question_explanation:q-unseen");
  });

  // ── Direction 2: active question MUST appear pre-submit ─────────

  it("pre-submit: active question's explanation IS included", async () => {
    resetMockData(
      [
        {
          canonical_id: "q-active",
          explanation: "Active Q explanation with reasoning path",
          skill_codes: ["GEO-02"],
        },
      ],
      [],
    );

    const result = await retrieveCurriculum({
      student_id: "student-1",
      active_skill_codes: ["GEO-02"],
      active_question_canonical_id: "q-active",
      is_pre_submit: true,
      surface: "practice",
      max_items: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].provenance).toBe("question_explanation:q-active");
    expect(result.items[0].content).toBe(
      "Active Q explanation with reasoning path",
    );
  });

  // ── Answered questions DO appear pre-submit ─────────────────────

  it("pre-submit: previously answered same-skill question's explanation appears", async () => {
    resetMockData(
      [
        {
          canonical_id: "q-active",
          explanation: "Active explanation",
          skill_codes: ["ALG-01"],
        },
        {
          canonical_id: "q-answered",
          explanation: "Previously answered explanation",
          skill_codes: ["ALG-01"],
        },
        {
          canonical_id: "q-unseen",
          explanation: "Unseen explanation",
          skill_codes: ["ALG-01"],
        },
      ],
      [
        {
          question_id: "q-answered",
          user_id: "student-1",
          status: "answered",
        },
      ],
    );

    const result = await retrieveCurriculum({
      student_id: "student-1",
      active_skill_codes: ["ALG-01"],
      active_question_canonical_id: "q-active",
      is_pre_submit: true,
      surface: "practice",
      max_items: 10,
    });

    const ids = result.items.map((i) => i.provenance);
    // Active: included (Karl ruling)
    expect(ids).toContain("question_explanation:q-active");
    // Answered: included (student has already seen it)
    expect(ids).toContain("question_explanation:q-answered");
    // Unseen: EXCLUDED (negative control)
    expect(ids).not.toContain("question_explanation:q-unseen");
  });

  // ── "served but unanswered" is NOT "seen" ───────────────────────

  it("pre-submit: served-but-unanswered question is treated as unseen (excluded)", async () => {
    resetMockData(
      [
        {
          canonical_id: "q-active",
          explanation: "Active explanation",
          skill_codes: ["ALG-01"],
        },
        {
          canonical_id: "q-served",
          explanation: "Served-only explanation",
          skill_codes: ["ALG-01"],
        },
      ],
      [
        {
          question_id: "q-served",
          user_id: "student-1",
          status: "served", // served but NOT answered
        },
      ],
    );

    const result = await retrieveCurriculum({
      student_id: "student-1",
      active_skill_codes: ["ALG-01"],
      active_question_canonical_id: "q-active",
      is_pre_submit: true,
      surface: "practice",
      max_items: 10,
    });

    const ids = result.items.map((i) => i.provenance);
    expect(ids).toContain("question_explanation:q-active");
    // NEGATIVE CONTROL: served-but-unanswered is not "answered",
    // so it's treated as unseen and excluded
    expect(ids).not.toContain("question_explanation:q-served");
  });

  // ── Post-submit: no filter — all same-skill appear ──────────────

  it("post-submit: all same-skill explanations appear (no pre-submit filter)", async () => {
    resetMockData(
      [
        {
          canonical_id: "q-a",
          explanation: "Explanation A",
          skill_codes: ["ALG-01"],
        },
        {
          canonical_id: "q-b",
          explanation: "Explanation B",
          skill_codes: ["ALG-01"],
        },
        {
          canonical_id: "q-c",
          explanation: "Explanation C",
          skill_codes: ["ALG-01"],
        },
      ],
      [], // No practice_session_items — doesn't matter post-submit
    );

    const result = await retrieveCurriculum({
      student_id: "student-1",
      active_skill_codes: ["ALG-01"],
      active_question_canonical_id: "q-a",
      is_pre_submit: false,
      surface: "practice",
      max_items: 10,
    });

    const ids = result.items.map((i) => i.provenance);
    expect(ids).toContain("question_explanation:q-a");
    expect(ids).toContain("question_explanation:q-b");
    expect(ids).toContain("question_explanation:q-c");
  });

  // ── Pre-submit with no answered and no active: empty set ────────

  it("pre-submit: no answered questions and no active question returns empty", async () => {
    resetMockData(
      [
        {
          canonical_id: "q-unseen",
          explanation: "Should not appear",
          skill_codes: ["ALG-01"],
        },
      ],
      [],
    );

    const result = await retrieveCurriculum({
      student_id: "student-1",
      active_skill_codes: ["ALG-01"],
      active_question_canonical_id: null,
      is_pre_submit: true,
      surface: "practice",
      max_items: 10,
    });

    // No answered questions, no active question → empty allowlist → empty result
    expect(result.items).toHaveLength(0);
  });

  // ── Meta: response shape ────────────────────────────────────────

  it("response includes retrieval metadata", async () => {
    resetMockData(
      [
        {
          canonical_id: "q-active",
          explanation: "Explanation",
          skill_codes: ["ALG-01"],
        },
      ],
      [],
    );

    const result = await retrieveCurriculum({
      student_id: "student-1",
      active_skill_codes: ["ALG-01"],
      active_question_canonical_id: "q-active",
      is_pre_submit: true,
      surface: "practice",
      max_items: 10,
    });

    expect(result.meta).toBeDefined();
    expect(typeof result.meta.deterministic_candidates).toBe("number");
    expect(typeof result.meta.semantic_candidates).toBe("number");
    expect(typeof result.meta.gated_out).toBe("number");
    expect(typeof result.meta.duration_ms).toBe("number");
  });
});
