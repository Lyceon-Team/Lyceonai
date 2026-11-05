/**
 * @spec [owner brief "Help-level engine", Karl 2026-11-05 (rules 1–5 and the tests it names);
 *       rulings of 2026-11-05 (prompt v7 composing v3; a correct typed step is a typed message
 *       stating the keyed answer; the wire carries the worked step; Student B's sequence is
 *       synthesised); SCL-275] | @implemented [2026-11-05]
 *
 * plain English: the help-level engine through its real pure functions, its wire, its migration
 * and its prompt rule.
 *  - Student B (synthesised from the brief: "Walk me through it", then "Got it, next step" 21
 *    times on one problem): level 3 by tap 3, the last allowed step within 3 taps, and no tap
 *    after that loops back down.
 *  - The ceiling: every sequence of up to six signals stays at or below level 3 before submission
 *    (practice, or a review re-attempt before its answer); after submission level 4 is reachable.
 *  - "idk" twice moves up two; a correct typed step moves down one.
 *  - The wire's enums equal the shared ones; the migration's CHECKs list exactly the shared
 *    values; the seeded keyword map parses and detects.
 *  - v7 renders v3 byte for byte when no level is sent, and never tells LISA to give the full
 *    solution before submission.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HELP_LEVEL_NUMBER,
  HELP_LEVELS,
  HELP_SIGNALS,
  MAX_WORKED_STEPS,
  SUBMIT_STATES,
  detectHelpSignal,
  helpDirective,
  helpForTurn,
  helpKeywordMapSchema,
  helpSignalFor,
  isCorrectTypedAnswer,
  nextHelpState,
  type HelpSignal,
  type HelpState,
  type SubmitState,
} from "../../packages/shared/src/tutor-help-level";
import {
  ORCHESTRATE_HELP_LEVELS,
  ORCHESTRATE_MAX_WORKED_STEPS,
  ORCHESTRATE_SUBMIT_STATES,
  orchestrateRequestSchema,
} from "../../shared/tutor-orchestrator-wire";
import {
  HELP_LEVEL_RULE,
  LISA_DEFAULT_V7,
} from "../../apps/workers/tutor-orchestrator/src/prompts/lisa-default-v7";
import { LISA_DEFAULT_V3 } from "../../apps/workers/tutor-orchestrator/src/prompts/lisa-default-v3";
import { resolvePromptArtifact } from "../../apps/workers/tutor-orchestrator/src/prompts/prompt-registry";
import type { PromptFields } from "../../apps/workers/tutor-orchestrator/src/prompts/types";

const ROOT = join(__dirname, "../..");
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20261201000000_lisa_help_level.sql"),
  "utf8",
);

/** Replays signals from no recorded state; returns the state after each. */
function replay(
  signals: readonly HelpSignal[],
  submitState: SubmitState,
  itemSkipped = false,
): HelpState[] {
  const out: HelpState[] = [];
  let state: HelpState | null = null;
  for (const signal of signals) {
    state = helpForTurn(state, signal, submitState, itemSkipped);
    out.push(state);
  }
  return out;
}

const level = (s: HelpState): number => HELP_LEVEL_NUMBER[s.level];

// Synthesised from the brief (Karl's ruling 2026-11-05: no production read): one walkthrough
// opened on one problem, then 21 "Got it, next step" taps.
const STUDENT_B: HelpSignal[] = [
  "walkthrough",
  ...Array.from({ length: 21 }, (): HelpSignal => "step_understood"),
];

describe("Student B: the tap loop ends", () => {
  it("post-submit (review): level 3 by tap 3, the full solution at tap 3, and it stays there", () => {
    const states = replay(STUDENT_B, "post_submit");
    expect(states[0]).toMatchObject({ level: "hint" }); // "Walk me through it" starts at 2
    const taps = states.slice(1);
    expect(level(taps[2]!)).toBeGreaterThanOrEqual(3); // by tap 3
    expect(taps.slice(0, 3).map((s) => [s.level, s.workedStep])).toEqual([
      ["worked_step", 1],
      ["worked_step", 2],
      ["full_solution", null],
    ]);
    for (const s of taps.slice(3)) expect(s.level).toBe("full_solution");
  });

  it("pre-submit: the final worked step at tap 3, never the full solution", () => {
    const states = replay(STUDENT_B, "pre_submit");
    const taps = states.slice(1);
    expect(level(taps[2]!)).toBe(3);
    expect(helpDirective(taps[2]!, "pre_submit").workedStep).toEqual({
      index: 3,
      final: true,
    });
    for (const s of taps) expect(level(s)).toBeLessThanOrEqual(3);
  });
});

describe("the ceiling", () => {
  // Every state reachable from "nothing recorded" by any sequence of signals: a closure over the
  // engine's own transitions, so it covers sequences of any length.
  function reachable(submitState: SubmitState): HelpState[] {
    const seen = new Map<string, HelpState>();
    const queue: Array<HelpState | null> = [null];
    while (queue.length > 0) {
      const from = queue.shift()!;
      for (const signal of HELP_SIGNALS) {
        for (const skipped of [false, true]) {
          const to = helpForTurn(from, signal, submitState, skipped);
          const k = JSON.stringify(to);
          if (!seen.has(k)) {
            seen.set(k, to);
            queue.push(to);
          }
        }
      }
    }
    return [...seen.values()];
  }

  it("before submission no reachable state is level 4 (practice and a review re-attempt)", () => {
    const states = reachable("pre_submit");
    expect(states.length).toBeGreaterThan(10);
    for (const s of states) {
      expect(level(s)).toBeLessThanOrEqual(3);
      expect(helpDirective(s, "pre_submit").helpLevel).not.toBe(
        "full_solution",
      );
    }
  });

  it("after submission level 4 is allowed: 'just solve it' goes straight there", () => {
    expect(replay(["solve_it"], "post_submit")).toEqual([
      { level: "full_solution", workedStep: null, signal: "solve_it" },
    ]);
    expect(replay(["solve_it"], "pre_submit")).toEqual([
      { level: "worked_step", workedStep: 3, signal: "solve_it" },
    ]);
  });
});

describe("the rules", () => {
  it("'idk' twice moves up two", () => {
    const [first, second] = replay(["stuck", "stuck"], "post_submit");
    expect(first).toMatchObject({ level: "hint" }); // ask → hint: up one
    expect(second).toMatchObject({ level: "worked_step", workedStep: 2 }); // hint → step 2: up two
  });

  it("a stuck signal after something else moves up one again", () => {
    const states = replay(["stuck", "none", "stuck"], "post_submit");
    expect(states.map((s) => [s.level, s.workedStep])).toEqual([
      ["hint", null],
      ["hint", null],
      ["worked_step", 1],
    ]);
  });

  it("a skipped question counts as stuck: an 'idk' right after it moves up two", () => {
    expect(replay(["none"], "post_submit", true)[0]).toMatchObject({
      level: "hint",
      signal: "skipped",
    });
    expect(replay(["stuck"], "post_submit", true)[0]).toMatchObject({
      level: "worked_step",
      workedStep: 2,
    });
  });

  it("a correct typed step moves down one level", () => {
    const at = replay(
      ["walkthrough", "step_understood", "step_understood"],
      "pre_submit",
    );
    expect(at[2]).toMatchObject({ level: "worked_step", workedStep: 2 });
    expect(nextHelpState(at[2]!, "correct_step", "pre_submit")).toMatchObject({
      level: "hint",
    });
    expect(
      nextHelpState(
        { level: "full_solution", workedStep: null, signal: "solve_it" },
        "correct_step",
        "post_submit",
      ),
    ).toMatchObject({ level: "worked_step", workedStep: 1 });
    expect(nextHelpState(null, "correct_step", "pre_submit")).toMatchObject({
      level: "ask",
    });
  });

  it("'Walk me through it' starts at 2 from anywhere", () => {
    const from: HelpState = {
      level: "worked_step",
      workedStep: 3,
      signal: "solve_it",
    };
    expect(nextHelpState(from, "walkthrough", "post_submit")).toMatchObject({
      level: "hint",
    });
  });

  it("deterministic: the same inputs give the same state", () => {
    expect(replay(STUDENT_B, "pre_submit")).toEqual(
      replay(STUDENT_B, "pre_submit"),
    );
  });
});

describe("signals", () => {
  const SEEDED = helpKeywordMapSchema.parse(
    JSON.parse(/\$json\$([\s\S]*?)\$json\$/.exec(MIGRATION)![1]!),
  );

  it("the seeded map parses and detects the brief's phrases", () => {
    expect(SEEDED.version).toBe(1);
    expect(detectHelpSignal("idk", SEEDED)).toBe("stuck");
    expect(detectHelpSignal("I'm stuck!!", SEEDED)).toBe("stuck");
    expect(detectHelpSignal("Just solve it", SEEDED)).toBe("solve_it");
    expect(detectHelpSignal("can you show me", SEEDED)).toBe("solve_it");
    expect(detectHelpSignal("how do I solve it?", SEEDED)).toBeNull();
    expect(detectHelpSignal("what is a coefficient", SEEDED)).toBeNull();
  });

  it("taps carry their own signal; a video tap carries none; typed text uses the map, then the key", () => {
    const base = {
      message: "x",
      keywordMap: SEEDED,
      answerKey: null,
      submitState: "post_submit" as const,
    };
    expect(helpSignalFor({ ...base, intent: "walkthrough" })).toBe(
      "walkthrough",
    );
    expect(helpSignalFor({ ...base, intent: "step_understood" })).toBe(
      "step_understood",
    );
    expect(helpSignalFor({ ...base, intent: "step_stuck" })).toBe("stuck");
    expect(helpSignalFor({ ...base, intent: "video_desmos" })).toBe("none");
    const key = {
      itemType: "mcq" as const,
      correctAnswer: "B",
    };
    expect(
      helpSignalFor({
        intent: null,
        message: "it's B",
        keywordMap: SEEDED,
        answerKey: key,
        submitState: "post_submit",
      }),
    ).toBe("correct_step");
    // Before submission a correct guess is NOT a signal: a level that moved on it would tell the
    // student the guess was right (an answer oracle; anti-leak).
    expect(
      helpSignalFor({
        intent: null,
        message: "it's B",
        keywordMap: SEEDED,
        answerKey: key,
        submitState: "pre_submit",
      }),
    ).toBe("none");
    expect(
      helpSignalFor({
        intent: null,
        message: "idk, B?",
        keywordMap: SEEDED,
        answerKey: key,
        submitState: "post_submit",
      }),
    ).toBe("stuck");
    expect(
      helpSignalFor({
        intent: null,
        message: "idk",
        keywordMap: null,
        answerKey: null,
        submitState: "post_submit",
      }),
    ).toBe("none");
  });

  it("a correct typed answer: the keyed letter as a commitment, or the grid-in value", () => {
    const mcq = {
      itemType: "mcq" as const,
      correctAnswer: "B",
    };
    for (const m of ["B", "b", "(B)", "it's B", "the answer is b", "I got B"]) {
      expect(isCorrectTypedAnswer(m, mcq)).toBe(true);
    }
    for (const m of ["is it B?", "C", "B or C", "maybe b because", "b?"]) {
      expect(isCorrectTypedAnswer(m, mcq)).toBe(false);
    }
    const grid = {
      itemType: "grid_in" as const,
      correctAnswer: "3/4",
    };
    expect(isCorrectTypedAnswer("x = 0.75", grid)).toBe(true);
    expect(isCorrectTypedAnswer("I got 3/4", grid)).toBe(true);
    expect(isCorrectTypedAnswer("x = 4", grid)).toBe(false);
  });
});

describe("wire, migration and registry agree with the one definition", () => {
  it("the wire repeats the shared enums exactly", () => {
    expect([...ORCHESTRATE_HELP_LEVELS]).toEqual([...HELP_LEVELS]);
    expect([...ORCHESTRATE_SUBMIT_STATES]).toEqual([...SUBMIT_STATES]);
    expect(ORCHESTRATE_MAX_WORKED_STEPS).toBe(MAX_WORKED_STEPS);
  });

  it("the wire refuses a level or step outside the closed set", () => {
    const shape = orchestrateRequestSchema.shape;
    expect(shape.help_level.safeParse("everything").success).toBe(false);
    expect(
      shape.worked_step.safeParse({ index: 4, final: false }).success,
    ).toBe(false);
    expect(shape.worked_step.safeParse({ index: 3, final: true }).success).toBe(
      true,
    );
    expect(shape.help_level.safeParse(undefined).success).toBe(true);
  });

  it("the migration's CHECKs list exactly the shared values, and it is the last to define them", () => {
    const levels = /help_level IN \(([^)]*)\)/.exec(MIGRATION)![1]!;
    expect(levels.match(/'([a-z_]+)'/g)!.map((v) => v.slice(1, -1))).toEqual([
      ...HELP_LEVELS,
    ]);
    const signals = /help_signal IN \(([^)]*)\)/.exec(MIGRATION)![1]!;
    expect(signals.match(/'([a-z_]+)'/g)!.map((v) => v.slice(1, -1))).toEqual([
      ...HELP_SIGNALS,
    ]);
    expect(MIGRATION).toContain(
      `help_worked_step BETWEEN 1 AND ${MAX_WORKED_STEPS}`,
    );
    const later = readdirSync(join(ROOT, "supabase/migrations"))
      .filter((f) => f > "20261201000000_lisa_help_level.sql")
      .filter((f) =>
        readFileSync(join(ROOT, "supabase/migrations", f), "utf8").includes(
          "tutor_turn_metrics_help_",
        ),
      );
    expect(later).toEqual([]);
  });

  it("v7 is the latest for every variant", () => {
    for (const variant of [
      "default",
      "scaffolded",
      "socratic",
      "concise",
      "strategy_first",
    ]) {
      expect(resolvePromptArtifact(variant, null).version).toBe(
        "lisa-default-v7",
      );
    }
    expect(resolvePromptArtifact("default", "lisa-default-v3").version).toBe(
      "lisa-default-v3",
    );
  });
});

describe("prompt v7", () => {
  const base: PromptFields = {
    entryMode: "scoped_question",
    sourceSurface: "review",
    policyVariant: "default",
    isPostSubmit: false,
    questionSection: "M",
    requestedMethod: null,
    helpLevel: null,
    submitState: null,
    workedStep: null,
  };

  it("no level sent: v3's text, byte for byte", () => {
    expect(LISA_DEFAULT_V7.renderSystemInstruction(base)).toBe(
      LISA_DEFAULT_V3.renderSystemInstruction(base),
    );
  });

  it("a level sent: v3's text, then the rule for that level", () => {
    const fields = { ...base, helpLevel: "hint" as const };
    const rule = HELP_LEVEL_RULE(fields)!;
    expect(LISA_DEFAULT_V7.renderSystemInstruction(fields)).toBe(
      `${LISA_DEFAULT_V3.renderSystemInstruction(fields)}\n\n${rule}`,
    );
    expect(rule).toContain("Level 2, hint");
  });

  it("before submission it never asks for the full solution, even if one is sent", () => {
    const pre = HELP_LEVEL_RULE({ ...base, helpLevel: "full_solution" })!;
    expect(pre).not.toContain("full solution");
    expect(pre).toContain("Level 3");
    const final = HELP_LEVEL_RULE({
      ...base,
      helpLevel: "worked_step",
      workedStep: { index: 3, final: true },
    })!;
    expect(final).toContain("Do not state the answer");
    const post = HELP_LEVEL_RULE({
      ...base,
      isPostSubmit: true,
      helpLevel: "full_solution",
    })!;
    expect(post).toContain("Level 4, full solution");
    // Worked step 3 is the final one before submission whatever its flag says, and either source
    // saying pre-submit (is_post_submit false, or submit_state pre_submit) is pre-submit.
    expect(
      HELP_LEVEL_RULE({
        ...base,
        helpLevel: "worked_step",
        workedStep: { index: 3, final: false },
      }),
    ).toContain("Do not state the answer");
    const mixed = HELP_LEVEL_RULE({
      ...base,
      isPostSubmit: true,
      submitState: "pre_submit",
      helpLevel: "full_solution",
    })!;
    expect(mixed).not.toContain("full solution");
    expect(mixed).toContain("Do not state the answer");
  });
});
