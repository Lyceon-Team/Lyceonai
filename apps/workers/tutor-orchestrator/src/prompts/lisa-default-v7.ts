/**
 * @spec [owner brief "Reading & Writing worked step", Karl 2026-11-22: "before submission, a
 *        worked step on an RW item must never name, rank or rule out an answer option. It works
 *        only from the passage and the question … Bump the prompt version"; Doc-03C_V3 §4.3 —
 *        versioned prompt artifact; SCL-275 (the help-level block v7 builds on)]
 * @implemented 2026-11-22
 *
 * plain English: v6, plus one sentence in the help-level block. On a Reading & Writing item,
 * before the student answers, a worked step works only from the passage and the question and
 * never names, quotes, ranks or rules out an answer choice (render-state-blocks.ts
 * `RW_WORKED_STEP_RULE`). In production (SATRW23GOZ2P, key A) v6's worked step said "Let's look
 * at Option B": walking the choices is the answer itself.
 *
 * trade-offs:
 *  - v6 is immutable (§4.3). v7 composes it: the rules are v6's (and so v5's) byte for byte, and
 *    the data boundary and help-level block carry over. The only difference is
 *    `rwWorkedStepRule`, so a request that is not an RW worked step before submission renders
 *    exactly as v6.
 *  - Math items are untouched: a worked step there is algebra, and naming a choice is already
 *    ruled out by "never state … which choice is correct".
 *  - Default for every variant (prompt-registry.ts), effective when Karl deploys the worker.
 *  - Evidence (synthetic replay of SATRW23GOZ2P, tests/eval/help-level/rw-worked-step.ts, 5 runs
 *    of walkthrough + 3 "Got it" taps, 2026-11-22), on Karl's pass test of 2026-11-22 (0 of 15
 *    name a choice AND worked steps that are only the submit line <= v6's): named a choice v6
 *    8/15, v7 0/15; only the submit line v6 3/15, v7 1/15. PASS. The real case is G0-2-08
 *    (owner-run import).
 */

import type { PromptArtifact } from "./types.js";
import { LISA_DEFAULT_V6 } from "./lisa-default-v6.js";

export const LISA_DEFAULT_V7: PromptArtifact = {
  version: "lisa-default-v7",
  policyVariant: "default",
  dataBoundary: true,
  helpLevelBlock: true,
  rwWorkedStepRule: true,

  renderSystemInstruction: (fields) =>
    LISA_DEFAULT_V6.renderSystemInstruction(fields),
};
