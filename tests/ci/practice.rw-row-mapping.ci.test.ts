/**
 * Practice R&W Row-Mapping + DTO Anti-Leak Gate
 *
 * @spec [Doc-02B_V4 §14/§20; Preamble V3 §12 INV-02B-01] | @implemented [2026-07-24]
 *
 * Proves BY CALLING PRODUCTION FUNCTIONS with real shapes that:
 *
 * Row-mapping (buildSessionItemInsertRows):
 *   - R&W question with passage → insert row has question_passage populated
 *   - Grid-in question → insert row has question_item_type "grid_in" and
 *     question_correct_variants populated
 *   - MCQ question → insert row has question_item_type "mcq" and
 *     question_correct_variants null
 *
 * Student DTO anti-leak (toStudentSafeQuestionDTO):
 *   - R&W item with passage + correct_answer + explanation →
 *     DTO has passage PRESENT, correct_answer null, explanation null
 *   - correct_variants is ABSENT from the DTO type entirely
 *
 * These are pure-function tests — no mocks, no HTTP, no Supabase.
 * They fail if anyone regresses the row-mapping (e.g. question_passage: null)
 * or breaks the DTO strip.
 *
 * Coverage map:
 *   RPC→passage:        proven in real Postgres (practice-integration.sh P.9)
 *   Row-mapping:        proven here by direct production function call
 *   DTO anti-leak strip: proven here by direct production function call
 *   HTTP wiring:        proven by supertest (practice.rw-passage-anti-leak.ci.test.ts)
 *   Full single-process wire (session create → RPC → prepopulation → DB → serve):
 *     NOT covered end-to-end — CI cannot run the Node server against bare Postgres
 */

import { describe, it, expect } from "vitest";
import {
  buildSessionItemInsertRows,
  toStudentSafeQuestionDTO,
  type CanonicalQuestionForServing,
  type SessionItemInsertContext,
} from "../../server/routes/practice-canonical";

const RW_QUESTION: CanonicalQuestionForServing = {
  id: "SATRW1CAS001",
  canonical_id: "SATRW1CAS001",
  section_code: "RW",
  item_type: "mcq",
  stem: 'Based on the passage, the author most likely uses the word "luminous" to mean',
  passage:
    "The scholar's luminous analysis of the text stood in stark contrast to the opaque reasoning that had dominated the field for decades.",
  options: [
    { token: "A", text: "brightly lit" },
    { token: "B", text: "intellectually brilliant" },
    { token: "C", text: "clearly visible" },
    { token: "D", text: "warmly glowing" },
  ],
  difficulty: 2,
  domain: "Craft and Structure",
  skill: "CAS.01",
  subskill: null,
  exam: null,
  structure_cluster_id: null,
  correct_answer: "B",
  explanation:
    'In context, "luminous" describes the quality of the argument, not physical light.',
  correct_variants: null,
};

const GRID_IN_QUESTION: CanonicalQuestionForServing = {
  id: "SATM1GRID001",
  canonical_id: "SATM1GRID001",
  section_code: "M",
  item_type: "grid_in",
  stem: "If 3x + 7 = 22, what is the value of x?",
  passage: null,
  options: [],
  difficulty: 1,
  domain: "Algebra",
  skill: "ALG.01",
  subskill: null,
  exam: null,
  structure_cluster_id: null,
  correct_answer: "5",
  explanation: "3x = 15, x = 5.",
  correct_variants: ["5", "5.0", "5.00"],
};

const MCQ_QUESTION: CanonicalQuestionForServing = {
  id: "SATM1AAAA01",
  canonical_id: "SATM1AAAA01",
  section_code: "M",
  item_type: "mcq",
  stem: "If 2x + 3 = 7, what is x?",
  passage: null,
  options: [
    { token: "A", text: "1" },
    { token: "B", text: "2" },
    { token: "C", text: "3" },
    { token: "D", text: "4" },
  ],
  difficulty: 1,
  domain: "Algebra",
  skill: "ALG.01",
  subskill: null,
  exam: null,
  structure_cluster_id: null,
  correct_answer: "B",
  explanation: "Subtract 3: 2x=4, divide by 2: x=2.",
  correct_variants: null,
};

const CTX: SessionItemInsertContext = {
  sessionId: "00000000-0000-0000-0000-aaaaaaaaaaaa",
  userId: "00000000-0000-0000-0000-bbbbbbbbbbbb",
  actorId: "00000000-0000-0000-0000-bbbbbbbbbbbb",
  clientInstanceId: "ci-test",
  now: "2026-07-24T00:00:00Z",
};

describe("buildSessionItemInsertRows — row-mapping regression guard", () => {
  it("R&W question with passage → question_passage populated", () => {
    const rows = buildSessionItemInsertRows([RW_QUESTION], CTX);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.question_passage).toBe(RW_QUESTION.passage);
    expect(typeof row.question_passage).toBe("string");
    expect((row.question_passage as string).length).toBeGreaterThan(0);
  });

  it("R&W question maps all required fields", () => {
    const rows = buildSessionItemInsertRows([RW_QUESTION], CTX);
    const row = rows[0];
    expect(row.question_id).toBe("SATRW1CAS001");
    expect(row.question_section).toBe("RW");
    expect(row.question_stem).toBe(RW_QUESTION.stem);
    expect(row.question_domain).toBe("Craft and Structure");
    expect(row.question_skill).toBe("CAS.01");
    expect(row.question_item_type).toBe("mcq");
    expect(row.question_correct_answer).toBe("B");
    expect(row.question_explanation).toBe(RW_QUESTION.explanation);
  });

  it("grid-in question → question_item_type 'grid_in', question_correct_variants populated", () => {
    const rows = buildSessionItemInsertRows([GRID_IN_QUESTION], CTX);
    const row = rows[0];
    expect(row.question_item_type).toBe("grid_in");
    expect(row.question_correct_variants).toEqual(["5", "5.0", "5.00"]);
  });

  it("MCQ question → question_item_type 'mcq', question_correct_variants null", () => {
    const rows = buildSessionItemInsertRows([MCQ_QUESTION], CTX);
    const row = rows[0];
    expect(row.question_item_type).toBe("mcq");
    expect(row.question_correct_variants).toBeNull();
  });

  it("context fields (session_id, user_id, actor_id) propagate correctly", () => {
    const rows = buildSessionItemInsertRows([RW_QUESTION], CTX);
    const row = rows[0];
    expect(row.session_id).toBe(CTX.sessionId);
    expect(row.user_id).toBe(CTX.userId);
    expect(row.actor_id).toBe(CTX.actorId);
  });

  it("first item is served, second is pending", () => {
    const rows = buildSessionItemInsertRows([RW_QUESTION, MCQ_QUESTION], CTX);
    expect(rows[0].status).toBe("served");
    expect(rows[0].served_at).toBe(CTX.now);
    expect(rows[0].client_instance_id).toBe(CTX.clientInstanceId);
    expect(rows[1].status).toBe("pending");
    expect(rows[1].served_at).toBeNull();
    expect(rows[1].client_instance_id).toBeNull();
  });

  it("ordinals are 1-based", () => {
    const rows = buildSessionItemInsertRows(
      [RW_QUESTION, MCQ_QUESTION, GRID_IN_QUESTION],
      CTX,
    );
    expect(rows[0].ordinal).toBe(1);
    expect(rows[1].ordinal).toBe(2);
    expect(rows[2].ordinal).toBe(3);
  });
});

describe("toStudentSafeQuestionDTO — anti-leak strip proof", () => {
  it("R&W item: passage PRESENT, correct_answer null, explanation null", () => {
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-001",
      question: RW_QUESTION,
      safeOptions: [
        { token: "opt_A", text: "brightly lit" },
        { token: "opt_B", text: "intellectually brilliant" },
        { token: "opt_C", text: "clearly visible" },
        { token: "opt_D", text: "warmly glowing" },
      ],
    });

    expect(dto.passage).toBe(RW_QUESTION.passage);
    expect(typeof dto.passage).toBe("string");
    expect((dto.passage as string).length).toBeGreaterThan(0);
    expect(dto.correct_answer).toBeNull();
    expect(dto.explanation).toBeNull();
  });

  it("correct_variants is absent from DTO output", () => {
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-001",
      question: RW_QUESTION,
      safeOptions: [],
    });

    expect("correct_variants" in dto).toBe(false);
  });

  it("MCQ item: correct_answer null, explanation null (non-regression)", () => {
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-002",
      question: MCQ_QUESTION,
      safeOptions: [
        { token: "opt_A", text: "1" },
        { token: "opt_B", text: "2" },
        { token: "opt_C", text: "3" },
        { token: "opt_D", text: "4" },
      ],
    });

    expect(dto.correct_answer).toBeNull();
    expect(dto.explanation).toBeNull();
    expect(dto.passage).toBeNull();
    expect("correct_variants" in dto).toBe(false);
  });

  it("grid-in item: correct_answer null, explanation null, inputMode numeric_entry", () => {
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-003",
      question: GRID_IN_QUESTION,
      safeOptions: [],
    });

    expect(dto.correct_answer).toBeNull();
    expect(dto.explanation).toBeNull();
    expect(dto.inputMode).toBe("numeric_entry");
    expect(dto.itemType).toBe("grid_in");
    expect(dto.options).toEqual([]);
    expect("correct_variants" in dto).toBe(false);
  });

  it("DTO body serialization never contains answer or explanation text", () => {
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-001",
      question: RW_QUESTION,
      safeOptions: [],
    });

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("describes the quality of the argument");
    expect(serialized).not.toContain('"B"');
  });
});
