/**
 * lisa-default-v7: a Reading & Writing worked step before submission never touches an answer
 * choice.
 *
 * @spec [owner brief "Reading & Writing worked step", Karl 2026-11-22: "before submission, a
 *       worked step on an RW item must never name, rank or rule out an answer option. It works
 *       only from the passage and the question … rubric rule 'no option named before
 *       submission'"] | @implemented [2026-11-22]
 *
 * plain English:
 *   V1 on an RW item before submission, every worked step (1, 2, the final 3, and a full solution
 *      clamped to the last step) carries RW_WORKED_STEP_RULE on v7, and v7's instruction is v6's
 *      with exactly that sentence added. v6 never carries it.
 *   V2 everywhere else v7 renders exactly as v6: a Math worked step, an RW hint, an RW item
 *      after submission, and a turn with no help level.
 *   O1 `optionMentions` catches the production reply ("Let's look at Option B") and the other
 *      ways of naming a choice; it does not flag a reply that works from the passage, quotes the
 *      passage, or says "a correct answer". `hasAnswerLeak` misses the production reply (it
 *      looks only for the key's letter), which is why the rule needs its own check.
 *   R1 G0-2-09's rubric (the before-submission case, re-scoped from G0-2-08 on 2026-11-22) carries
 *      the rule as a must-not item and is complete (scoreable), and the
 *      judge's message for it shows the passage and the rule, never the key.
 * The item is SATRW23GOZ2P as the bank holds it. No student text exists in this file.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "../../apps/workers/tutor-orchestrator/src/lib/vertex-client",
  async (orig) => ({
    ...(await orig<object>()),
    logEvent: vi.fn(),
  }),
);

import { buildSystemInstruction } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import { RW_WORKED_STEP_RULE } from "../../apps/workers/tutor-orchestrator/src/prompts/render-state-blocks";
import { hasAnswerLeak } from "../../shared/tutor-safety-constants";
import type { OrchestrateRequest } from "../../shared/tutor-orchestrator-wire";
import { completeRubric } from "../../packages/shared/src/tutor-eval-schema";
import {
  RW_ITEM,
  isSubmitOnly,
  rwTurnRequest,
} from "../eval/help-level/rw-worked-step";
import { REVIEW_PRE_SUBMIT_COPY } from "../../apps/workers/tutor-orchestrator/src/prompts/lisa-default-v2";
import { optionMentions } from "../eval/teaching-quality/option-mentions";
import { buildJudgeUserMessage } from "../eval/teaching-quality/judge";
import {
  ENDORSES_WRONG_OPTION,
  EXPLAINS_KEY_FROM_PASSAGE,
  NO_OPTION_NAMED_BEFORE_SUBMISSION,
  TEACHING_QUALITY_RUBRICS,
  rubricFor,
  rubricScopeConflict,
} from "../eval/teaching-quality/rubrics";

type Over = Partial<OrchestrateRequest>;
const STATE = {
  level: "worked_step",
  workedStep: 2,
  signal: "step_understood",
} as const;

function request(version: string, over: Over = {}): OrchestrateRequest {
  return {
    ...rwTurnRequest(
      version,
      [{ role: "student", text: "Got it, next step" }],
      STATE,
    ),
    ...over,
  };
}

const PRE_SUBMIT_WORKED: Over[] = [
  {
    help_level: "worked_step",
    submit_state: "pre_submit",
    worked_step: { index: 1, final: false },
  },
  {
    help_level: "worked_step",
    submit_state: "pre_submit",
    worked_step: { index: 2, final: false },
  },
  {
    help_level: "worked_step",
    submit_state: "pre_submit",
    worked_step: { index: 3, final: true },
  },
  {
    help_level: "full_solution",
    submit_state: "pre_submit",
    worked_step: null,
  },
];

describe("v7: the Reading & Writing worked step (owner brief 2026-11-22)", () => {
  it("V1 every RW worked step before submission carries the rule on v7, and only that is added", () => {
    for (const over of PRE_SUBMIT_WORKED) {
      const v6 = buildSystemInstruction(request("lisa-default-v6", over));
      const v7 = buildSystemInstruction(request("lisa-default-v7", over));
      expect(v6).not.toContain(RW_WORKED_STEP_RULE);
      expect(v7).toContain(RW_WORKED_STEP_RULE);
      expect(v7.replace(` ${RW_WORKED_STEP_RULE}`, "")).toBe(v6);
    }
  });

  it("V2 everywhere else v7 is v6 byte for byte", () => {
    const math = (o: Over): Over => ({
      ...o,
      question_content: {
        stem: "If 4x - 7 = 13, what is the value of x?",
        passage: null,
        options: [],
        item_type: "grid_in",
        explanation: null,
        student_answer: null,
        attempt_number: 0,
        section: "M",
      },
    });
    const elsewhere: Over[] = [
      math(PRE_SUBMIT_WORKED[1] ?? {}),
      { help_level: "hint", submit_state: "pre_submit", worked_step: null },
      { help_level: "ask", submit_state: "pre_submit", worked_step: null },
      {
        help_level: "worked_step",
        submit_state: "post_submit",
        worked_step: { index: 2, final: false },
        is_post_submit: true,
        correct_answer: "A",
      },
      {
        help_level: undefined,
        submit_state: undefined,
        worked_step: undefined,
      },
    ];
    for (const over of elsewhere) {
      const v6 = buildSystemInstruction(request("lisa-default-v6", over));
      expect(buildSystemInstruction(request("lisa-default-v7", over))).toBe(v6);
      expect(v6).not.toContain(RW_WORKED_STEP_RULE);
    }
  });
});

describe("optionMentions: the deterministic half of the rule", () => {
  const item = {
    options: RW_ITEM.options,
    passage: RW_ITEM.passage,
    stem: RW_ITEM.stem,
  };
  const PRODUCTION = "Let's look at Option B. Does it describe oral tradition?";

  it("O1 catches the production reply and every way of naming a choice", () => {
    expect(optionMentions(PRODUCTION, item)).toEqual([
      { kind: "letter", option: "B" },
    ]);
    // The key's own letter only: the shared leak scan does not see a wrong choice named.
    expect(hasAnswerLeak(PRODUCTION, RW_ITEM.correct)).toBe(false);
    const named: Array<[string, string]> = [
      ["Choice (C) is about money, not storytelling.", "C"],
      ["We can rule out D right away.", "D"],
      ["It comes down to A or B.", "A"],
      ["(D) talks about language choice.", "D"],
      ["Option A connects a specific proverb to a structural role.", "A"],
      [
        "The critic says it reflects the influence of Ernest Hemingway more than any African oral tradition.",
        "B",
      ],
    ];
    for (const [reply, option] of named) {
      expect(optionMentions(reply, item).map((m) => m.option)).toContain(
        option,
      );
    }
  });

  it("O1 does not flag a reply that works from the passage and the question", () => {
    for (const reply of [
      "The passage says Achebe's frequent use of proverbs, embedded folk tales, and cyclical plot patterns carries Igbo oral tradition into the novel. So a quotation that illustrates the claim has to show one of those devices doing that work.",
      "A correct answer would have to show an oral-tradition device inside the novel's structure. A good test: does the quotation name a proverb, folk tale or cycle?",
      "First, what is the claim? Put it in your own words before you look at the choices.",
    ]) {
      expect(optionMentions(reply, item)).toEqual([]);
    }
  });

  it("R1 G0-2-09's rubric carries the rule and is scoreable", () => {
    const rubric = rubricFor("G0-2-09");
    expect(rubric?.must_not).toContain(NO_OPTION_NAMED_BEFORE_SUBMISSION);
    expect(NO_OPTION_NAMED_BEFORE_SUBMISSION).toMatch(
      /^No option named before submission/,
    );
    const complete = rubric === null ? null : completeRubric(rubric);
    expect(complete).not.toBeNull();
    if (complete === null) return;
    // The judge sees the item before submission and never the key, in any words.
    const message = buildJudgeUserMessage({
      request: request("lisa-default-v7", PRE_SUBMIT_WORKED[1]),
      rubric: complete,
      visibleReply: "What does the passage say Achebe's proverbs are doing?",
    });
    expect(message).toContain("Chinua Achebe");
    expect(message).toContain("No option named before submission");
    expect(message).not.toMatch(/correct answer|answer key/i);
  });

  it("S1 the RW worked step names the submit line as never a step (Karl, 2026-11-22)", () => {
    expect(RW_WORKED_STEP_RULE).toContain(`"${REVIEW_PRE_SUBMIT_COPY}"`);
    expect(RW_WORKED_STEP_RULE).toMatch(
      /always give the next step from the passage and the question/,
    );
    expect(RW_WORKED_STEP_RULE).toMatch(
      /only for a direct request for the answer/,
    );
    // The replay's count: the line alone is a deflection; the line inside a real step is not.
    expect(isSubmitOnly("Submit it and we'll go through it together.")).toBe(
      true,
    );
    expect(isSubmitOnly("  submit it and we’ll go through it together! ")).toBe(
      true,
    );
    expect(
      isSubmitOnly(
        "The passage says the proverbs carry the argument. Submit it and we'll go through it together.",
      ),
    ).toBe(false);
  });
});

describe("G0-2-08 / G0-2-09 scopes (owner brief 2026-11-22)", () => {
  it("R2 G0-2-08 is the post-submit control; G0-2-09 holds the before-submission rule", () => {
    const g08 = rubricFor("G0-2-08");
    const g09 = rubricFor("G0-2-09");
    expect(g08?.submit_state).toBe("post_submit");
    expect(g08?.must).toContain(EXPLAINS_KEY_FROM_PASSAGE);
    expect(g08?.must_not).toContain(ENDORSES_WRONG_OPTION);
    expect(g08?.must_not).not.toContain(NO_OPTION_NAMED_BEFORE_SUBMISSION);
    expect(g09?.submit_state).toBe("pre_submit");
    expect(g09?.must_not).toContain(NO_OPTION_NAMED_BEFORE_SUBMISSION);
  });

  it("R3 every rubric's wording agrees with its scope; only a post-submit rubric names the key", () => {
    for (const r of TEACHING_QUALITY_RUBRICS) {
      const text = [
        r.judge_note ?? "",
        ...(r.must ?? []),
        ...(r.must_not ?? []),
      ].join("\n");
      if (/before submission/i.test(text))
        expect(r.submit_state, r.case_id).toBe("pre_submit");
      if (/after submission/i.test(text))
        expect(r.submit_state, r.case_id).toBe("post_submit");
      if (/the key is [A-D]\b/i.test(text))
        expect(r.submit_state, r.case_id).toBe("post_submit");
    }
    // The scope check the import makes, both ways.
    const g09 = rubricFor("G0-2-09");
    expect(
      g09 === null ? "missing" : rubricScopeConflict(g09, false),
    ).toBeNull();
    expect(g09 === null ? null : rubricScopeConflict(g09, true)).toMatch(
      /scoped before submission, but this cut-off is after it/,
    );
  });
});
