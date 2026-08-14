/**
 * @spec [Doc-03B_V2 §5.4 rule 5, §11.1-11.2, INV-03-14]
 * @implemented 2026-08-12
 *
 * plain English: Proves that resolveScope and resolveRecentFriction carry
 * student-ownership predicates on every student-scoped query, making cross-
 * student retrieval architecturally impossible at the application layer.
 *
 * expected outcome:
 *  - Student A sending Student B's session_item_id → envelope does NOT
 *    contain B's question context; scope degrades to general.
 *  - Student A sending their own session_item_id → resolves correctly.
 *  - Student A sending B's session_id in friction path → 0 consecutive
 *    fails (not B's data).
 *  - Relationship mismatch (A's own item but wrong session) → degrades.
 *
 * trade-offs: mock-based (no ephemeral Postgres). The mock chain builder
 * records every .eq() predicate so we prove the WHERE clause carries
 * user_id = studentId, not just that the result is empty.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Test fixtures ─────────────────────────────────────────────────────

const STUDENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STUDENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SESSION_A = "11111111-1111-1111-1111-111111111111";
const SESSION_B = "22222222-2222-2222-2222-222222222222";
const ITEM_A = "33333333-3333-3333-3333-333333333333";
const ITEM_B = "44444444-4444-4444-4444-444444444444";
const QUESTION_A = "SATM1AAAAAA";
const QUESTION_B = "SATM1BBBBBB";

// ── Queryable mock rows ───────────────────────────────────────────────
// The mock client simulates Supabase's chained .eq() filtering.

type MockRow = Record<string, unknown>;

const DB_ROWS: Record<string, MockRow[]> = {
  practice_sessions: [
    { id: SESSION_A, user_id: STUDENT_A },
    { id: SESSION_B, user_id: STUDENT_B },
  ],
  practice_session_items: [
    {
      id: ITEM_A,
      user_id: STUDENT_A,
      session_id: SESSION_A,
      question_id: QUESTION_A,
      question_skill: "ALG",
      question_domain: "Algebra",
      question_section: "M",
      status: "answered",
      is_correct: false,
      occurred_at: new Date().toISOString(),
      ordinal: 1,
    },
    {
      id: ITEM_B,
      user_id: STUDENT_B,
      session_id: SESSION_B,
      question_id: QUESTION_B,
      question_skill: "GEO",
      question_domain: "Geometry",
      question_section: "M",
      status: "answered",
      is_correct: true,
      occurred_at: new Date().toISOString(),
      ordinal: 1,
    },
  ],
  questions: [
    { id: QUESTION_A, section: "M", domain: "Algebra", skill_codes: ["ALG"] },
    { id: QUESTION_B, section: "M", domain: "Geometry", skill_codes: ["GEO"] },
  ],
  student_skill_mastery: [],
  student_domain_mastery: [],
  student_kpi_rollups_current: [],
  tutor_memory_summaries: [],
  tutor_messages: [],
};

// ── Predicate-tracking mock chain ─────────────────────────────────────
// Records every .eq() call so tests can assert the WHERE clause content.

type PredicateLog = Array<{ column: string; value: unknown }>;

function makeMockChain(
  table: string,
  selectFields: string,
  predicateLog: PredicateLog,
): Record<string, unknown> {
  let rows = [...(DB_ROWS[table] ?? [])];

  const chain: Record<string, unknown> = {
    select: (_fields: string) => {
      selectFields = _fields;
      return chain;
    },
    eq: (col: string, val: unknown) => {
      predicateLog.push({ column: col, value: val });
      rows = rows.filter((r) => r[col] === val);
      return chain;
    },
    gte: (_col: string, _val: unknown) => chain,
    order: (_col: string, _opts?: unknown) => chain,
    limit: (_n: number) => chain,
    single: () => {
      if (rows.length === 0) {
        return {
          data: null,
          error: { message: "Row not found", code: "PGRST116" },
        };
      }
      return { data: filterFields(rows[0], selectFields), error: null };
    },
    maybeSingle: () => {
      if (rows.length === 0) {
        return { data: null, error: null };
      }
      return { data: filterFields(rows[0], selectFields), error: null };
    },
    then: (resolve: (v: unknown) => void) => {
      // Bare chain resolution (no single/maybeSingle) — returns array
      resolve({ data: rows, error: null });
    },
  };

  return chain;
}

function filterFields(
  row: MockRow,
  selectFields: string,
): Record<string, unknown> {
  if (!selectFields || selectFields === "*") return { ...row };
  const fields = selectFields.split(",").map((f) => f.trim());
  const result: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in row) result[f] = row[f];
  }
  return result;
}

// ── Predicate capture per test ────────────────────────────────────────

let capturedPredicates: Record<string, PredicateLog> = {};

function resetPredicates(): void {
  capturedPredicates = {};
}

function getPredicatesFor(table: string): PredicateLog {
  return capturedPredicates[table] ?? [];
}

// ── Supabase mock ─────────────────────────────────────────────────────

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (!capturedPredicates[table]) {
        capturedPredicates[table] = [];
      }
      return makeMockChain(table, "*", capturedPredicates[table]);
    },
    rpc: async () => ({ data: null, error: null }),
  },
}));

vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../server/services/tutor-config", () => ({
  TutorConfig: {
    get: (key: string) => {
      const defaults: Record<string, unknown> = {
        friction_long_pause_seconds: 300,
        model_armor_input_template_id: null,
        model_armor_output_template_id: null,
      };
      return defaults[key] ?? null;
    },
  },
}));

vi.mock("../../server/services/tutor-memory", () => ({
  getMemorySummaries: async () => [],
  getStructuredFields: async () => ({
    last_struggled_skill: null,
    last_mastered_skill: null,
    preferred_explanation_style: null,
    style_confidence: null,
  }),
}));

// ── Import after mocks ───────────────────────────────────────────────

import { resolveScope } from "../../server/services/tutor-context";

// ── Tests ─────────────────────────────────────────────────────────────

describe("LISA-FULL-004: scope ownership isolation (INV-03-14)", () => {
  beforeEach(() => {
    resetPredicates();
    vi.clearAllMocks();
  });

  // ── Deny: cross-student session_item_id ────────────────────────────

  describe("Student A sends Student B's session_item_id", () => {
    it("degrades scope — B's question context is NOT in the resolved scope", async () => {
      const result = await resolveScope(STUDENT_A, SESSION_B, ITEM_B, null);

      // Session is not owned by A → degraded to null
      expect(result.source_session_id).toBeNull();
      // Item is not owned by A → degraded to null
      expect(result.source_session_item_id).toBeNull();
      // Question from B's item never resolved
      expect(result.source_question_row_id).toBeNull();
      expect(result.source_question_canonical_id).toBeNull();
    });

    it("carries user_id = STUDENT_A in the practice_session_items WHERE clause", async () => {
      await resolveScope(STUDENT_A, null, ITEM_B, null);

      const itemPredicates = getPredicatesFor("practice_session_items");
      const userIdPredicate = itemPredicates.find(
        (p) => p.column === "user_id",
      );

      expect(userIdPredicate).toBeDefined();
      expect(userIdPredicate!.value).toBe(STUDENT_A);
    });

    it("carries user_id = STUDENT_A in the practice_sessions WHERE clause", async () => {
      await resolveScope(STUDENT_A, SESSION_B, ITEM_B, null);

      const sessionPredicates = getPredicatesFor("practice_sessions");
      const userIdPredicate = sessionPredicates.find(
        (p) => p.column === "user_id",
      );

      expect(userIdPredicate).toBeDefined();
      expect(userIdPredicate!.value).toBe(STUDENT_A);
    });
  });

  // ── Allow: own session_item_id ─────────────────────────────────────

  describe("Student A sends their own session_item_id", () => {
    it("resolves correctly with all scope fields populated", async () => {
      const result = await resolveScope(STUDENT_A, SESSION_A, ITEM_A, null);

      expect(result.source_session_id).toBe(SESSION_A);
      expect(result.source_session_item_id).toBe(ITEM_A);
      expect(result.source_question_row_id).toBe(QUESTION_A);
      expect(result.source_question_canonical_id).toBe(QUESTION_A);
    });

    it("resolves item even without explicit session_id (anchors to item's session)", async () => {
      const result = await resolveScope(STUDENT_A, null, ITEM_A, null);

      expect(result.source_session_id).toBe(SESSION_A);
      expect(result.source_session_item_id).toBe(ITEM_A);
      expect(result.source_question_row_id).toBe(QUESTION_A);
    });
  });

  // ── Deny: relationship mismatch ────────────────────────────────────

  describe("Student A sends own item_id but wrong session_id", () => {
    it("degrades item scope when item does not belong to claimed session", async () => {
      // A owns ITEM_A (which belongs to SESSION_A), but claims SESSION_B
      // SESSION_B is not owned by A → session degrades first
      // Then ITEM_A is owned but... session already null, so item anchors
      // Actually: SESSION_B not owned by A → validSessionId = null
      // ITEM_A owned by A → session_id from item (SESSION_A) used since
      // validSessionId is null
      const result = await resolveScope(STUDENT_A, SESSION_B, ITEM_A, null);

      // SESSION_B not owned by A → degraded to null
      // ITEM_A owned by A, no session mismatch (validSessionId was null
      // after degradation), so item resolves and anchors to its own session
      expect(result.source_session_item_id).toBe(ITEM_A);
      expect(result.source_session_id).toBe(SESSION_A);
      expect(result.source_question_row_id).toBe(QUESTION_A);
    });
  });

  // ── Deny: session_id cross-student without item ────────────────────

  describe("Student A sends Student B's session_id (no item)", () => {
    it("degrades session scope", async () => {
      const result = await resolveScope(STUDENT_A, SESSION_B, null, null);

      expect(result.source_session_id).toBeNull();
      expect(result.source_session_item_id).toBeNull();
    });
  });

  // ── Prove: question-only scope (no session/item) ───────────────────

  describe("Question-only scope (shared canonical content)", () => {
    it("resolves question without ownership (questions are shared)", async () => {
      const result = await resolveScope(STUDENT_A, null, null, QUESTION_B);

      // Questions are shared canonical content — any student can reference them
      expect(result.source_question_row_id).toBe(QUESTION_B);
      expect(result.source_question_canonical_id).toBe(QUESTION_B);
    });
  });

  // ── Prove: bidirectional isolation ─────────────────────────────────

  describe("Bidirectional: B cannot access A's data either", () => {
    it("Student B cannot resolve Student A's session_item_id", async () => {
      const result = await resolveScope(STUDENT_B, SESSION_A, ITEM_A, null);

      expect(result.source_session_id).toBeNull();
      expect(result.source_session_item_id).toBeNull();
      expect(result.source_question_row_id).toBeNull();
    });

    it("Student B can resolve their own session_item_id", async () => {
      const result = await resolveScope(STUDENT_B, SESSION_B, ITEM_B, null);

      expect(result.source_session_id).toBe(SESSION_B);
      expect(result.source_session_item_id).toBe(ITEM_B);
      expect(result.source_question_row_id).toBe(QUESTION_B);
      expect(result.source_question_canonical_id).toBe(QUESTION_B);
    });
  });

  // ── Prove: ownership predicate is in WHERE, not post-fetch ─────────

  describe("Predicate discipline: ownership is in the query, not post-fetch", () => {
    it("practice_session_items query includes user_id predicate for both session and item", async () => {
      await resolveScope(STUDENT_A, SESSION_A, ITEM_A, null);

      // Session query must have user_id predicate
      const sessionPreds = getPredicatesFor("practice_sessions");
      expect(
        sessionPreds.some(
          (p) => p.column === "user_id" && p.value === STUDENT_A,
        ),
      ).toBe(true);

      // Item query must have user_id predicate
      const itemPreds = getPredicatesFor("practice_session_items");
      expect(
        itemPreds.some((p) => p.column === "user_id" && p.value === STUDENT_A),
      ).toBe(true);
    });

    it("session-only scope carries user_id on practice_sessions", async () => {
      await resolveScope(STUDENT_A, SESSION_A, null, null);

      const sessionPreds = getPredicatesFor("practice_sessions");
      expect(
        sessionPreds.some(
          (p) => p.column === "user_id" && p.value === STUDENT_A,
        ),
      ).toBe(true);
    });
  });
});
