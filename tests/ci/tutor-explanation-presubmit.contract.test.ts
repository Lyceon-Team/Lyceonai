/**
 * @spec [CR-02B-29; Doc-02B_V4 §21 Question Awareness; INV-03-04;
 *        closure plan W3-10; SCL-144 (PROPOSED, reversing SCL-060)]
 * @implemented 2026-09-25
 *
 * plain English: before the student submits, the model does not receive the
 * explanation. After, it does.
 *
 * WHY. SCL-060 sent the active question's explanation to the worker
 * pre-submit as "internal context", behind a prompt directive not to reveal
 * it. The model therefore held the explanation while the student was still
 * working. Owner ruling 2026-09-25: possession is the control, instruction is
 * not — "cannot leak what it doesn't have".
 *
 * This drives the real `resolveQuestionContent` (the envelope's only source of
 * `question_content`) over the in-memory DB, with a session item whose
 * snapshot carries an explanation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../helpers/fake-tutor-db";

const db = { current: new FakeTutorDb() };

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { resolveQuestionContent } from "../../server/services/tutor-context";

const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const EXPLANATION = "zqx-explanation-marker: subtract 3, then divide by 2.";

function scopeFor(
  itemId: string,
): Parameters<typeof resolveQuestionContent>[1] {
  return {
    source_session_id: null,
    source_session_item_id: itemId,
    source_question_row_id: null,
    source_question_canonical_id: null,
  } as Parameters<typeof resolveQuestionContent>[1];
}

beforeEach(() => {
  db.current = new FakeTutorDb();
});

function seedItem(): string {
  const row = db.current.seed("practice_session_items", {
    user_id: STUDENT_ID,
    status: "served",
    question_stem: "If 2x + 3 = 7, what is x?",
    question_passage: null,
    question_options: [
      { key: "A", text: "1" },
      { key: "B", text: "2" },
    ],
    question_item_type: "mcq",
    question_explanation: EXPLANATION,
    question_correct_answer: "B",
    selected_answer: null,
    ordinal: 1,
  });
  return row.id as string;
}

describe("W3-10 — explanation is post-submit only", () => {
  it("PRE-submit: question content is delivered, the explanation is null", async () => {
    const qc = await resolveQuestionContent(
      STUDENT_ID,
      scopeFor(seedItem()),
      false,
    );
    expect(qc).not.toBeNull();
    expect(qc?.stem).toBe("If 2x + 3 = 7, what is x?");
    expect(qc?.options).toHaveLength(2);
    expect(qc?.explanation).toBeNull();
    expect(JSON.stringify(qc)).not.toContain("zqx-explanation-marker");
  });

  it("POST-submit: the explanation is delivered", async () => {
    const qc = await resolveQuestionContent(
      STUDENT_ID,
      scopeFor(seedItem()),
      true,
    );
    expect(qc?.explanation).toBe(EXPLANATION);
  });

  it("neither path ever carries the correct answer in question content", async () => {
    for (const post of [false, true]) {
      const qc = await resolveQuestionContent(
        STUDENT_ID,
        scopeFor(seedItem()),
        post,
      );
      expect(Object.keys(qc ?? {})).not.toContain("correct_answer");
    }
  });
});
