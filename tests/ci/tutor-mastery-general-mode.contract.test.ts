/**
 * @spec [Doc-03A_V3.0 §5.4 mastery_snapshot; Doc-03D_V1.2 §7.1, §7.4;
 *        closure plan W3-4b] | @implemented 2026-09-25
 *
 * plain English: in general mode — the only mode production has ever used —
 * the student's mastery reaches the SYSTEM INSTRUCTION, not just the envelope.
 *
 * WHY. General mode sent `mastery_snapshot = {scope:"all"}` with every field
 * null. `hasMastery` logged true because the object was not null; the
 * worker's mastery block rendered nothing from it. Verified 2026-09-25: both
 * students who have used LISA have mastery rows (50 skill, 16 domain), and no
 * turn ever carried any of it.
 *
 * The assertion is on the assembled system instruction (owner's requirement),
 * built by the worker's own `buildSystemInstruction` from a learning context
 * the BFF's own `resolveLearningContext` produced over the in-memory DB.
 *
 * Domain bands: the BFF now sends every domain with an observed level
 * (`domain_mastery`). The worker renders them in the worker prompt PR (Cloud
 * Build); here they are asserted on the envelope, and the 7-day activity line
 * — which the deployed worker already renders — on the instruction.
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

import {
  resolveLearningContext,
  snapshotCarriesMastery,
} from "../../server/services/tutor-context";
import { buildSystemInstruction } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import { buildGoldenEnvelope } from "./lisa-golden-set-helpers";

const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const GENERAL_SCOPE = {
  source_session_id: null,
  source_session_item_id: null,
  source_question_row_id: null,
  source_question_canonical_id: null,
} as Parameters<typeof resolveLearningContext>[1];

function generalRequest(
  learning: Awaited<ReturnType<typeof resolveLearningContext>>,
): Parameters<typeof buildSystemInstruction>[0] {
  const base = buildGoldenEnvelope({
    surface: "practice",
    isPostSubmit: false,
    correctAnswer: "B",
    question: { stem: "x", options: [] },
    messages: [],
  } as never);
  return {
    ...base,
    entry_mode: "general",
    source_surface: "dashboard",
    question_content: null,
    correct_answer: null,
    is_post_submit: false,
    student_learning_context: learning,
  } as Parameters<typeof buildSystemInstruction>[0];
}

beforeEach(() => {
  db.current = new FakeTutorDb();
});

function seedMasteryAndActivity(): void {
  db.current.seed("student_domain_mastery", {
    student_id: STUDENT_ID,
    domain: "Algebra",
    section: "M",
    mastery_score: 0.31,
    mastery_level: 1,
  });
  db.current.seed("student_domain_mastery", {
    student_id: STUDENT_ID,
    domain: "Advanced Math",
    section: "M",
    mastery_score: 0.62,
    mastery_level: 3,
  });
  db.current.seed("practice_session_items", {
    user_id: STUDENT_ID,
    status: "answered",
    question_skill: "Linear Equations in One Variable",
    is_correct: false,
    occurred_at: new Date().toISOString(),
  });
}

describe("W3-4b — mastery reaches the system instruction in general mode", () => {
  it("a student with mastery and recent practice: the instruction carries their mastery", async () => {
    seedMasteryAndActivity();
    const learning = await resolveLearningContext(STUDENT_ID, GENERAL_SCOPE);
    const snapshot = learning.mastery_snapshot;

    // Envelope: student-wide, from observed rows, deterministic order.
    expect(snapshot?.scope).toBe("all");
    expect(snapshot?.domain_mastery).toEqual([
      { domain: "Advanced Math", section: "M", mastery_level: 3 },
      { domain: "Algebra", section: "M", mastery_level: 1 },
    ]);
    expect(snapshot?.recent_activity_summary?.skills_with_fails_7d).toEqual([
      "Linear Equations in One Variable",
    ]);
    expect(snapshotCarriesMastery(snapshot)).toBe(true);

    // The system instruction — what the model actually sees.
    const instruction = buildSystemInstruction(generalRequest(learning));
    expect(instruction).toContain("--- CONTEXT FOR CURRENT QUESTION ---");
    expect(instruction).toContain(
      "They have had difficulty with these skills in the past 7 days: Linear Equations in One Variable.",
    );
    // The domain bands — as bands, never the raw score (Doc 03D §7.1).
    expect(instruction).toContain(
      `[MASTERY] Their domain mastery across the SAT: Advanced Math (Math): "proficient"; Algebra (Math): "needs_work".`,
    );
    expect(instruction).not.toContain("0.62");
    expect(instruction).not.toContain("0.31");
  });

  it("a student with no rows: nothing is invented, and hasMastery is false", async () => {
    const learning = await resolveLearningContext(STUDENT_ID, GENERAL_SCOPE);
    expect(learning.mastery_snapshot?.domain_mastery).toEqual([]);
    expect(snapshotCarriesMastery(learning.mastery_snapshot)).toBe(false);
    const instruction = buildSystemInstruction(generalRequest(learning));
    expect(instruction).not.toContain("[MASTERY]");
    expect(instruction).not.toContain("had difficulty");
  });

  it("the all-null placeholder is no longer reported as mastery", () => {
    expect(
      snapshotCarriesMastery({
        scope: "all",
        current_skill: null,
        current_domain: null,
        section_projection: null,
        section_projection_trend: null,
        recent_activity_summary: null,
      }),
    ).toBe(false);
  });
});
