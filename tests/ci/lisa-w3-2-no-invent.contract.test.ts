/**
 * @spec [closure plan W3-2 / W3-2a (owner ruling 2026-09-25: LISA never
 *        grades, never invents questions, never asserts computed answers;
 *        general mode hands off to practice); Doc-02B_V4 §21, CR-02B-29;
 *        Doc-03C_V3 §4.3 (versioned, immutable prompt artifacts)]
 * @implemented 2026-09-25
 *
 * plain English: what the worker deterministically does about a student who
 * asks LISA to make up a question. The model's wording is a Phase B judgement
 * (golden CASE-36); everything here is code:
 *
 *   - the prompt LISA runs on says: no grading, no invented question, no
 *     computed answer; offer practice, and the owner's copy verbatim;
 *   - the handoff marker never reaches the student, and becomes the
 *     start_practice action only in general mode;
 *   - v1 is untouched: a turn attributed to v1 renders exactly as before.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  buildOrchestrateResponse,
  buildSystemInstruction,
} from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import { resolvePromptArtifact } from "../../apps/workers/tutor-orchestrator/src/prompts/prompt-registry";
import { LISA_DEFAULT_V1 } from "../../apps/workers/tutor-orchestrator/src/prompts/lisa-default-v1";
import {
  NO_BANK_ITEM_CHECK_COPY,
  PRACTICE_HANDOFF_MARKER,
  REVIEW_PRE_SUBMIT_COPY,
  extractPracticeHandoff,
} from "../../apps/workers/tutor-orchestrator/src/prompts/lisa-default-v2";
import { orchestrateResponseSchema } from "../../shared/tutor-orchestrator-wire";
import { CASE_36, CASE_35 } from "./lisa-golden-set-fixtures";
import {
  HEURISTIC_FABRICATED_ITEM,
  buildGoldenEnvelope,
} from "./lisa-golden-set-helpers";

type VertexResponse = Parameters<typeof buildOrchestrateResponse>[0];

function vertex(text: string): VertexResponse {
  return { text, providerModel: "test-model" } as VertexResponse;
}

describe("W3-2 — the prompt LISA runs on", () => {
  it("latest is v2 for every variant, and v1 still resolves by exact version", () => {
    for (const variant of [
      "default",
      "scaffolded",
      "socratic",
      "concise",
      "strategy_first",
    ]) {
      expect(resolvePromptArtifact(variant, null).version).toBe(
        "lisa-default-v2",
      );
    }
    expect(resolvePromptArtifact("default", "lisa-default-v1").version).toBe(
      "lisa-default-v1",
    );
  });

  it("CASE-36 (general mode): no grading, no invented question, no computed answer; offer practice; owner copy verbatim", () => {
    const si = buildSystemInstruction(CASE_36.request);
    expect(si).toContain("You do not grade.");
    expect(si).toContain(
      "Never write, invent, or pose an SAT question, practice problem, or quiz",
    );
    expect(si).toContain(
      "Never state the computed result of a problem that is not in the context blocks",
    );
    expect(si).toContain(
      `Offer to start them on a practice question that counts`,
    );
    expect(si).toContain(PRACTICE_HANDOFF_MARKER);
    expect(si).toContain(
      "I can't check that one — I don't grade, and I only have answers for questions in Lyceon's bank. Walk me through how you got it and we'll check your reasoning, or I can start you on a practice question that counts.",
    );
    expect(si).toContain(NO_BANK_ITEM_CHECK_COPY);
    // No item: no item block, and the review copy does not apply.
    expect(si).not.toContain("[ITEM]");
    expect(si).not.toContain(REVIEW_PRE_SUBMIT_COPY);
  });

  it("review, before submit: the owner's copy for asking for the answer", () => {
    const si = buildSystemInstruction(CASE_35.request);
    expect(CASE_35.request.source_surface).toBe("review");
    expect(CASE_35.request.is_post_submit).toBe(false);
    expect(si).toContain(
      `reply with exactly: "Submit it and we'll go through it together."`,
    );
  });

  it("review, after submit — and practice: the review copy does not apply", () => {
    const post = buildGoldenEnvelope({
      surface: "review",
      isPostSubmit: true,
      question: { stem: "If 3x - 4 = 11, what is x?", itemType: "grid_in" },
      correctAnswer: "5",
    });
    expect(buildSystemInstruction(post)).not.toContain(REVIEW_PRE_SUBMIT_COPY);
    const practice = buildGoldenEnvelope({
      surface: "practice",
      isPostSubmit: false,
      question: { stem: "If 3x - 4 = 11, what is x?", itemType: "grid_in" },
      correctAnswer: null,
    });
    expect(buildSystemInstruction(practice)).not.toContain(
      REVIEW_PRE_SUBMIT_COPY,
    );
  });

  it("v1 is immutable: v2 begins with v1's rendering byte-for-byte", () => {
    const fields = {
      entryMode: "general",
      sourceSurface: "dashboard",
      policyVariant: "default",
      isPostSubmit: false,
    } as const;
    const v1 = LISA_DEFAULT_V1.renderSystemInstruction(fields);
    const v2 = resolvePromptArtifact("default", null).renderSystemInstruction(
      fields,
    );
    expect(v2.startsWith(v1 + "\n\n")).toBe(true);
    expect(v1).not.toContain("You do not grade.");
  });
});

describe("W3-2 — the handoff to practice", () => {
  const GOLD = CASE_36.goldResponse ?? "";

  it("general mode: the marker becomes start_practice, and the student never sees it", () => {
    const res = buildOrchestrateResponse(
      vertex(`${GOLD}\n${PRACTICE_HANDOFF_MARKER}`),
      CASE_36.request,
      "lisa-default-v2",
    );
    expect(res.response.suggested_action).toEqual({
      type: "start_practice",
      label: "Start a practice question",
    });
    expect(res.response.content).toBe(GOLD);
    expect(res.response.content).not.toContain("OFFER_PRACTICE");
    // The BFF parses worker responses with this schema: it must accept it.
    expect(orchestrateResponseSchema.safeParse(res).success).toBe(true);
  });

  it("inside an item (review, practice): the marker is stripped, and no action is offered — LISA stays on the item", () => {
    const res = buildOrchestrateResponse(
      vertex(`Let's stay on this one.\n${PRACTICE_HANDOFF_MARKER}`),
      CASE_35.request,
      "lisa-default-v2",
    );
    expect(res.response.suggested_action).toEqual({
      type: "none",
      label: null,
    });
    expect(res.response.content).toBe("Let's stay on this one.");
  });

  it("no marker: no action, content untouched", () => {
    const res = buildOrchestrateResponse(
      vertex("Where does it go wrong — setting it up, or the moves after?"),
      CASE_36.request,
      "lisa-default-v2",
    );
    expect(res.response.suggested_action.type).toBe("none");
    expect(res.response.content).toBe(
      "Where does it go wrong — setting it up, or the moves after?",
    );
  });

  it("marker variants the model may produce are all stripped", () => {
    for (const marker of [
      "[OFFER_PRACTICE]",
      "[ OFFER_PRACTICE ]",
      "[offer_practice]",
    ]) {
      const h = extractPracticeHandoff(`Sure.\n\n${marker}\n`);
      expect(h).toEqual({ content: "Sure.", offered: true });
    }
  });
});

describe("CASE-36 — the fabricated-item heuristic", () => {
  it("catches the shapes a made-up question takes", () => {
    for (const invented of [
      "Try this one: 2x + 3 = 11. Solve for x.",
      "Here's one: 4x - 7 = 9, what is x?",
      "Quick check: 5x = 20. x = ?",
      "Which is right? A) 2 B) 4 C) 6 D) 8",
    ]) {
      expect(HEURISTIC_FABRICATED_ITEM.test(invented)).toBe(true);
    }
  });

  it("does not flag the handoff, or the owner's copy", () => {
    expect(HEURISTIC_FABRICATED_ITEM.test(CASE_36.goldResponse ?? "")).toBe(
      false,
    );
    expect(HEURISTIC_FABRICATED_ITEM.test(NO_BANK_ITEM_CHECK_COPY)).toBe(false);
  });
});
