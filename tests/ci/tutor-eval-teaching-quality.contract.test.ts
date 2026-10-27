/**
 * The G0-2 teaching-quality harness, end to end with planted replies and a mocked judge.
 *
 * @spec [docs/eval/lisa/G0-2_Teaching_Quality_Set_Design.md §4, §5, §9 step 4; Karl's rulings
 *       2026-10-27: D3 (the judge reports, the code decides, deterministic checks first),
 *       rubrics held until the golds exist] | @implemented [2026-10-27]
 *
 * plain English:
 *   T1 the replay sends the worker's production config (lisa-default-v3, thinking 1024,
 *      temperature 0.3) and records it.
 *   T2 no rubric: the judge is never called and the run is unscored.
 *   T3 a planted bad reply (ignores the Desmos request, asks an algebra question) fails, and
 *      trips the deterministic tool-request flag.
 *   T4 a planted good reply passes.
 *   T5 a leak fails without the judge, and the visible reply is the substitution.
 *   T6 a judge claim whose quote is not in the reply is not trusted: REVIEW_NEEDED.
 *   T7 the verdict table, agreement, the cut-off submission rule and the shipped rubrics.
 * The case is synthetic: no student text exists in this file or anywhere in the repo.
 */
import { describe, expect, it, vi } from "vitest";
import {
  decideTutorEvalVerdict,
  tutorEvalAgreement,
  type CompleteTutorEvalRubric,
  type TutorEvalJudgeResponse,
  type TutorEvalRubric,
} from "../../packages/shared/src/tutor-eval-schema";
import { TUTOR_ANTI_LEAK_SUBSTITUTION } from "../../shared/tutor-safety-constants";
import {
  replayOnce,
  toolRequestUnanswered,
  type GenerateFn,
  type ReplayCase,
} from "../eval/teaching-quality/replay";
import {
  buildJudgeUserMessage,
  type JudgeFn,
} from "../eval/teaching-quality/judge";
import { TEACHING_QUALITY_RUBRICS } from "../eval/teaching-quality/rubrics";
import { isPostSubmitAtCutoff } from "../eval/teaching-quality/import-case";
import { buildGoldenEnvelope } from "./lisa-golden-set-helpers";

const BAD_REPLY =
  "Let's work it out by hand first. What do you get when you subtract 3 from both sides?";
const GOOD_REPLY =
  "Sure — open Desmos and type y = 2x + 3 and y = 7. Where do the two lines cross?\n[OFFER_PRACTICE]";
const LEAK_REPLY = "The answer is B, because the lines cross at x = 2.";

const MUST = "acts on the Desmos request";
const MUST_NOT = "asks an unrelated algebra question";
const COMPLETE: CompleteTutorEvalRubric = {
  case_id: "G0-2-TEST",
  gold_response: "Open Desmos, graph both sides, and read the intersection.",
  judge_note: "Synthetic test rubric.",
  must: [MUST],
  must_not: [MUST_NOT],
};
const RUBRIC: TutorEvalRubric = COMPLETE;

function makeCase(): ReplayCase {
  return {
    caseId: "G0-2-TEST",
    setVersion: "teaching-quality v1",
    request: {
      ...buildGoldenEnvelope({
        surface: "practice",
        isPostSubmit: false,
        question: {
          stem: "If 2x + 3 = 7, what is x?",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
            { key: "C", text: "3" },
            { key: "D", text: "4" },
          ],
        },
        correctAnswer: "B",
        messages: [{ role: "student", text: "can I use desmos for this" }],
      }),
      runtime_limits: { max_output_tokens: 2048, timeout_ms: 30_000 },
    },
    scanCorrectAnswer: "B",
  };
}

function planted(text: string) {
  return vi.fn<GenerateFn>(async () => ({
    text,
    finishReason: "STOP",
    usage: { prompt: 4000, cached: 0, candidates: 60, thoughts: 300 },
  }));
}

function judgeSaying(response: TutorEvalJudgeResponse): JudgeFn {
  return vi.fn(async () => ({
    response,
    usage: {
      calls: 1,
      prompt: 1500,
      cached: 0,
      output: 400,
      thoughts: 300,
      usd: 0.0078,
    },
  }));
}

const NEVER_CALLED = vi.fn<JudgeFn>(async () => {
  throw new Error("the judge must not be called");
});

const base = {
  runIndex: 1,
  judgeModel: "gemini-3.1-pro-preview",
  workerGitSha: "e7314a09",
};

describe("G0-2 teaching-quality harness", () => {
  it("T1 replays on the production config and records it", async () => {
    const generate = planted(BAD_REPLY);
    const record = await replayOnce({
      ...base,
      evalCase: makeCase(),
      rubric: null,
      generate,
      judge: NEVER_CALLED,
    });
    const call = generate.mock.calls[0]?.[0];
    expect(call?.config.thinkingConfig).toEqual({ thinkingBudget: 1024 });
    expect(call?.config.temperature).toBe(0.3);
    expect(call?.config.safetySettings).toHaveLength(4);
    expect(call?.config.maxOutputTokens).toBe(2048);
    expect(call?.model).toBe("gemini-3.5-flash");
    expect(record).toMatchObject({
      prompt_version: "lisa-default-v3",
      thinking_budget: 1024,
      temperature: 0.3,
      top_p: 0.95,
      top_k: 40,
      provider_model: "gemini-3.5-flash",
      context_hash: { kind: "provisional" },
    });
    expect(record.context_hash.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("T2 without a rubric the judge is not called and the run is unscored", async () => {
    const record = await replayOnce({
      ...base,
      evalCase: makeCase(),
      rubric: null,
      generate: planted(GOOD_REPLY),
      judge: NEVER_CALLED,
    });
    expect(record.verdict).toBe("unscored");
    expect(record.judge).toBeNull();
    expect(record.judge_skipped).toBe("no_rubric");
    expect(NEVER_CALLED).not.toHaveBeenCalled();
  });

  it("T3 the planted bad reply fails and trips the tool-request flag", async () => {
    const judge = judgeSaying({
      must: [{ item: MUST, met: false, quote: "" }],
      must_not: [
        {
          item: MUST_NOT,
          violated: true,
          quote: "What do you get when you subtract 3 from both sides?",
        },
      ],
      gold_move: "different_move",
      tutor_act: "diagnostic_question",
      tool_request_addressed: false,
    });
    const record = await replayOnce({
      ...base,
      evalCase: makeCase(),
      rubric: RUBRIC,
      generate: planted(BAD_REPLY),
      judge,
    });
    expect(record.class1.tool_request_unanswered).toBe(true);
    expect(record.verdict).toBe("fail");
    expect(record.judge?.model).toBe("gemini-3.1-pro-preview");
  });

  it("T4 the planted good reply passes, marker stripped from what is judged", async () => {
    const judge = judgeSaying({
      must: [{ item: MUST, met: true, quote: "open Desmos" }],
      must_not: [{ item: MUST_NOT, violated: false, quote: "" }],
      gold_move: "same_move",
      tutor_act: "hint",
      tool_request_addressed: true,
    });
    const record = await replayOnce({
      ...base,
      evalCase: makeCase(),
      rubric: RUBRIC,
      generate: planted(GOOD_REPLY),
      judge,
    });
    expect(record.visible_reply).not.toContain("[OFFER_PRACTICE]");
    expect(record.raw_reply).toContain("[OFFER_PRACTICE]");
    expect(record.class1.tool_request_unanswered).toBe(false);
    expect(record.verdict).toBe("pass");
  });

  it("T5 a leak fails without the judge; the student would see the substitution", async () => {
    const record = await replayOnce({
      ...base,
      evalCase: makeCase(),
      rubric: RUBRIC,
      generate: planted(LEAK_REPLY),
      judge: NEVER_CALLED,
    });
    expect(record.class1.answer_leak).toBe(true);
    expect(record.class1.scan_classes).toContain("answer_leak");
    expect(record.visible_reply).toBe(TUTOR_ANTI_LEAK_SUBSTITUTION);
    expect(record.judge_skipped).toBe("leak");
    expect(record.verdict).toBe("fail");
  });

  it("T6 a judge quote that is not in the reply is not trusted", async () => {
    const judge = judgeSaying({
      must: [{ item: MUST, met: true, quote: "graph it in Desmos" }],
      must_not: [{ item: MUST_NOT, violated: false, quote: "" }],
      gold_move: "same_move",
      tutor_act: "hint",
      tool_request_addressed: true,
    });
    const record = await replayOnce({
      ...base,
      evalCase: makeCase(),
      rubric: RUBRIC,
      generate: planted(GOOD_REPLY),
      judge,
    });
    expect(record.verdict).toBe("review_needed");
  });

  it("T7a the verdict table", () => {
    const clean = {
      answer_leak: false,
      scan_blocked: false,
      scan_classes: [],
      tool_request_unanswered: false,
    };
    const rubric = COMPLETE;
    const ok: TutorEvalJudgeResponse = {
      must: [{ item: "a", met: true, quote: "desmos" }],
      must_not: [{ item: "b", violated: false, quote: "" }],
      gold_move: "partial",
      tutor_act: "hint",
      tool_request_addressed: true,
    };
    const reply = "Try Desmos.";
    expect(
      decideTutorEvalVerdict({
        class1: clean,
        judge: ok,
        rubric,
        visibleReply: reply,
      }),
    ).toBe("pass");
    expect(
      decideTutorEvalVerdict({
        class1: { ...clean, tool_request_unanswered: true },
        judge: ok,
        rubric,
        visibleReply: reply,
      }),
    ).toBe("review_needed");
    expect(
      decideTutorEvalVerdict({
        class1: clean,
        judge: { ...ok, gold_move: "different_move" },
        rubric,
        visibleReply: reply,
      }),
    ).toBe("review_needed");
    expect(
      decideTutorEvalVerdict({
        class1: clean,
        judge: { ...ok, must: [] },
        rubric,
        visibleReply: reply,
      }),
    ).toBe("review_needed");
    expect(
      decideTutorEvalVerdict({
        class1: { ...clean, answer_leak: true },
        judge: null,
        rubric: null,
        visibleReply: reply,
      }),
    ).toBe("fail");
    expect(
      decideTutorEvalVerdict({
        class1: clean,
        judge: null,
        rubric: null,
        visibleReply: reply,
      }),
    ).toBe("unscored");
  });

  it("T7b agreement counts only scored, graded runs", () => {
    expect(
      tutorEvalAgreement([
        { verdict: "pass", owner_grade: "pass" },
        { verdict: "fail", owner_grade: "review_needed" },
        { verdict: "unscored", owner_grade: "fail" },
        { verdict: "pass", owner_grade: null },
      ]),
    ).toEqual({
      graded: 2,
      agreed: 1,
      pairs: { "pass->pass": 1, "fail->review_needed": 1 },
    });
  });

  it("T7c submission state at the cut-off fails closed", () => {
    const at = "2026-10-18T10:00:00Z";
    expect(isPostSubmitAtCutoff("test_review", null, at)).toBe(true);
    expect(isPostSubmitAtCutoff("dashboard", null, at)).toBe(false);
    expect(isPostSubmitAtCutoff("practice", null, at)).toBe(false);
    expect(
      isPostSubmitAtCutoff(
        "practice",
        { status: "answered", answered_at: "2026-10-18T09:59:00Z" },
        at,
      ),
    ).toBe(true);
    // Answered later than the turn: the turn was pre-submit.
    expect(
      isPostSubmitAtCutoff(
        "practice",
        { status: "answered", answered_at: "2026-10-18T10:05:00Z" },
        at,
      ),
    ).toBe(false);
    expect(
      isPostSubmitAtCutoff(
        "review",
        { status: "skipped", answered_at: null },
        at,
      ),
    ).toBe(false);
  });

  it("T7d the shipped rubrics are all held, and the judge never sees the answer pre-submit", () => {
    expect(TEACHING_QUALITY_RUBRICS.map((r) => r.case_id)).toEqual([
      "G0-2-01",
      "G0-2-02",
      "G0-2-03",
    ]);
    for (const r of TEACHING_QUALITY_RUBRICS) {
      expect([r.gold_response, r.judge_note, r.must, r.must_not]).toEqual([
        null,
        null,
        null,
        null,
      ]);
    }
    const evalCase = makeCase();
    const message = buildJudgeUserMessage({
      request: evalCase.request,
      rubric: COMPLETE,
      visibleReply: GOOD_REPLY,
    });
    expect(message).toContain("If 2x + 3 = 7");
    expect(message).toContain("has not answered");
    expect(evalCase.request.correct_answer).toBeNull();
    expect(message).not.toMatch(/correct answer|answer key/i);
  });

  it("toolRequestUnanswered: no tool named and ends in a question", () => {
    expect(toolRequestUnanswered(BAD_REPLY)).toBe(true);
    expect(toolRequestUnanswered("Use the calculator. What do you see?")).toBe(
      false,
    );
    expect(toolRequestUnanswered("Subtract 3 from both sides.")).toBe(false);
  });
});
