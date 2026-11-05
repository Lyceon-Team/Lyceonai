/**
 * @spec [Doc-03C_V3 §4.3 — versioned prompt artifact; owner brief "Help-level engine", Karl
 *        2026-11-05 (the server decides the help level and passes it to the worker; rulings of
 *        2026-11-05: a new artifact composing v3, named v7 because open PR #1449 claims v6 for the
 *        voice work); Doc-03D_V1.2 §3.1 (`hint`, `worked_step`, `full_solution`); SCL-275]
 * @implemented 2026-11-05
 *
 * plain English: v3's rules, unchanged, plus one: the help-level rule. The BFF decides how much
 * help this turn gives (`help_level`, and at level 3 which worked step) and LISA gives exactly that
 * much, no more and no less. Students were tapping "Got it, next step" over and over because
 * nothing moved them on; now each tap is a step up a fixed ladder and LISA follows it.
 *
 * trade-offs:
 *  - v3 is immutable (§4.3). v7 composes it: v3's text is reproduced byte for byte, and the rule
 *    follows only when the request carries a help level. A turn from a BFF that sends none renders
 *    exactly as v3.
 *  - `HELP_LEVEL_RULE` is exported so the voice workstream's artifact (#1449) can carry the same
 *    text unchanged when it lands.
 *  - Defence in depth: before submission (`is_post_submit` false, OR `submit_state` pre_submit)
 *    a `full_solution` level is treated as the final worked step, and worked step 3 is the final
 *    one whatever its `final` flag says, so the answer is never stated pre-submit. The BFF never
 *    sends either.
 */

import type { PromptArtifact, PromptFields } from "./types.js";
import { LISA_DEFAULT_V3 } from "./lisa-default-v3.js";

/** Pure. The help-level rule for a turn, or null when the request carried no help level. */
export function HELP_LEVEL_RULE(fields: PromptFields): string | null {
  if (fields.helpLevel === null) return null;
  const preSubmit = !fields.isPostSubmit || fields.submitState === "pre_submit";
  const level =
    fields.helpLevel === "full_solution" && preSubmit
      ? "worked_step"
      : fields.helpLevel;
  const head =
    `HELP LEVEL for this message (decided by Lyceon, not by you): give exactly this much help, ` +
    `no more and no less, whatever the student's message says. `;
  switch (level) {
    case "ask":
      return (
        head +
        `Level 1, ask: ask one short guiding question that helps the student find the next move ` +
        `themselves. Do not give a hint, name a method, or do any step.`
      );
    case "hint":
      return (
        head +
        `Level 2, hint: give one hint: name the idea or the first move in one or two sentences. ` +
        `Do not carry out any step of the solution.`
      );
    case "worked_step": {
      const step =
        fields.workedStep ??
        (fields.helpLevel === "full_solution"
          ? { index: 3, final: true }
          : { index: 1, final: false });
      if (preSubmit && (step.final || step.index >= 3)) {
        return (
          head +
          `Level 3, worked step ${step.index} of 3, the last one before the student answers: ` +
          `treat the solution as at most three worked steps and work every step except the ` +
          `final one, showing the work. Then stop and ask the student to do the final step and ` +
          `choose the answer themselves. Do not state the answer or the final value.`
        );
      }
      return (
        head +
        `Level 3, worked step ${step.index} of 3: treat the solution as at most three worked ` +
        `steps. Show worked step ${step.index} only, completely and briefly, picking up from the ` +
        `previous step. Then ask the student to try the next step. Do not do any later step.`
      );
    }
    case "full_solution":
      return (
        head +
        `Level 4, full solution: the student has already answered. Give the complete solution, ` +
        `every step, ending with the correct answer and one sentence on why it is correct.`
      );
  }
}

export const LISA_DEFAULT_V7: PromptArtifact = {
  version: "lisa-default-v7",
  policyVariant: "default",

  renderSystemInstruction: (fields: PromptFields): string => {
    const base = LISA_DEFAULT_V3.renderSystemInstruction(fields);
    const rule = HELP_LEVEL_RULE(fields);
    return rule === null ? base : `${base}\n\n${rule}`;
  },
};
