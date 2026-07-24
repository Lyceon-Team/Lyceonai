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
  assets: { illustration: "luminous-diagram.svg" },
  option_metadata: { A: { role: "distractor" }, B: { role: "correct" } },
  estimated_time_seconds: 90,
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
  assets: null,
  option_metadata: null,
  estimated_time_seconds: 60,
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
  assets: null,
  option_metadata: null,
  estimated_time_seconds: null,
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

  it("new content-pipeline fields (assets, option_metadata, estimated_time_seconds) propagate", () => {
    const rows = buildSessionItemInsertRows([RW_QUESTION], CTX);
    const row = rows[0];
    expect(row.question_assets).toEqual({
      illustration: "luminous-diagram.svg",
    });
    expect(row.question_option_metadata).toEqual({
      A: { role: "distractor" },
      B: { role: "correct" },
    });
    expect(row.question_estimated_time_seconds).toBe(90);
  });

  it("null content-pipeline fields propagate as null", () => {
    const rows = buildSessionItemInsertRows([MCQ_QUESTION], CTX);
    const row = rows[0];
    expect(row.question_assets).toBeNull();
    expect(row.question_option_metadata).toBeNull();
    expect(row.question_estimated_time_seconds).toBeNull();
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

  it("legacy flat assets are excluded pre-submit (fail-closed)", () => {
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-001",
      question: RW_QUESTION,
      safeOptions: [],
    });

    expect(dto.assets).toBeNull();
  });

  it("structured v1 assets with safe roles are served pre-submit", () => {
    const questionWithStructured: CanonicalQuestionForServing = {
      ...RW_QUESTION,
      assets: {
        v: 1,
        items: [{ id: "a1", kind: "svg", role: "stimulus", alt: "diagram" }],
      },
    };
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-structured-safe",
      question: questionWithStructured,
      safeOptions: [],
    });

    const assets = dto.assets as { v: number; items: Array<{ id: string }> };
    expect(assets).not.toBeNull();
    expect(assets.v).toBe(1);
    expect(assets.items).toHaveLength(1);
    expect(assets.items[0].id).toBe("a1");
  });

  it("assets is null when question has no assets", () => {
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-002",
      question: MCQ_QUESTION,
      safeOptions: [],
    });

    expect(dto.assets).toBeNull();
  });

  it("option_metadata is absent from DTO (server-only, type-absent)", () => {
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-001",
      question: RW_QUESTION,
      safeOptions: [],
    });

    expect("option_metadata" in dto).toBe(false);
  });

  it("estimated_time_seconds is absent from DTO (server-only, type-absent)", () => {
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-001",
      question: RW_QUESTION,
      safeOptions: [],
    });

    expect("estimated_time_seconds" in dto).toBe(false);
  });

  it("structured assets: explanation-role items excluded pre-submit", () => {
    const questionWithStructuredAssets: CanonicalQuestionForServing = {
      ...RW_QUESTION,
      assets: {
        v: 1,
        items: [
          {
            id: "a1",
            kind: "svg",
            role: "stimulus",
            alt: "passage diagram",
            svg: "<svg/>",
          },
          {
            id: "a2",
            kind: "table",
            role: "option",
            alt: "option table",
            option_key: "A",
            headers: ["x"],
            rows: [["1"]],
          },
          {
            id: "a3",
            kind: "svg",
            role: "explanation",
            alt: "answer diagram",
            svg: "<svg/>",
          },
        ],
      },
    };
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-structured",
      question: questionWithStructuredAssets,
      safeOptions: [],
    });

    const assets = dto.assets as {
      v: number;
      items: Array<{ id: string; role: string }>;
    };
    expect(assets).not.toBeNull();
    expect(assets.v).toBe(1);
    expect(assets.items).toHaveLength(2);
    expect(assets.items.map((i) => i.role)).toEqual(["stimulus", "option"]);
    expect(assets.items.map((i) => i.id)).toEqual(["a1", "a2"]);
  });

  it("structured assets: all-explanation returns null", () => {
    const questionAllExplanation: CanonicalQuestionForServing = {
      ...RW_QUESTION,
      assets: {
        v: 1,
        items: [{ id: "a1", kind: "svg", role: "explanation", alt: "answer" }],
      },
    };
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-allexpl",
      question: questionAllExplanation,
      safeOptions: [],
    });

    expect(dto.assets).toBeNull();
  });

  it("structured assets serialization never contains explanation-role items", () => {
    const questionWithExplanationAsset: CanonicalQuestionForServing = {
      ...RW_QUESTION,
      assets: {
        v: 1,
        items: [
          { id: "keep", kind: "svg", role: "stimulus", alt: "safe" },
          {
            id: "leak",
            kind: "svg",
            role: "explanation",
            alt: "answer key diagram",
          },
        ],
      },
    };
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-serial",
      question: questionWithExplanationAsset,
      safeOptions: [],
    });

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('"role":"explanation"');
    expect(serialized).not.toContain("leak");
    expect(serialized).not.toContain("answer key diagram");
    expect(serialized).toContain("keep");
  });

  it("DTO body serialization never contains answer, explanation, or server-only field values", () => {
    const dto = toStudentSafeQuestionDTO({
      sessionItemId: "item-001",
      question: RW_QUESTION,
      safeOptions: [],
    });

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("describes the quality of the argument");
    expect(serialized).not.toContain('"B"');
    expect(serialized).not.toContain("option_metadata");
    expect(serialized).not.toContain("estimated_time_seconds");
    expect(serialized).not.toContain("correct_variants");
  });
});
