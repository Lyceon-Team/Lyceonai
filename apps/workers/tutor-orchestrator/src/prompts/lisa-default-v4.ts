/**
 * @spec [docs/lisa/desmos-playbook.md §1–§4, §8, §9 (accepted 2026-10-27, pending Karl's read);
 *        Doc-03C_V3 §4.3 — versioned prompt artifact; Karl's gating ruling 2026-10-27]
 * @implemented 2026-10-27
 *
 * plain English: v3's rules, unchanged, plus the Desmos block from the playbook (349 tokens on
 * gemini-3.5-flash). The block goes in only when:
 *  - the item is a math item (`questionSection === "M"`, from questions.section); or
 *  - the turn is general mode and the student's current message asks for the `desmos` method
 *    (`requestedMethod`, the BFF's video_method_keywords detector, #1335).
 * Nowhere else: not on Reading and Writing items, not when the section could not be read.
 *
 * trade-offs:
 *  - v3 is immutable (§4.3). v4 composes it: v3's rendered text is reproduced byte-for-byte.
 *  - NOT the latest for any variant. v4 resolves by exact version only, so production (which
 *    sends prompt_version null) stays on v3 until Karl rules on the G0-2 replies. The harness
 *    selects v4 explicitly. Promoting it is a one-line registry change.
 *  - The open conflicts and the answer-box rules (playbook §6a, §7) are deliberately absent
 *    (Karl, 2026-10-27).
 */

import type { PromptArtifact, PromptFields } from "./types.js";
import { LISA_DEFAULT_V3 } from "./lisa-default-v3.js";

/** The playbook §9 block, verbatim. A contract test pins it to the playbook. */
export const DESMOS_BLOCK =
  "DESMOS (math only). When the student asks for Desmos or a calculator, switch method: begin \"Using Desmos…\", give the first concrete input for this question, then go one step at a time, checking they follow. Name the graph feature that answers it.\n- Equation: type it as written, or y= each side; the x of the vertical line or crossing. Rename other letters to x.\n- System: the crossing; parallel is none, same line is infinitely many.\n- Zeros, factors: y= expression; click x-axis points.\n- Max, min: click the vertex; x or y as asked. Restricted interval: check endpoints.\n- Equivalent: graph original and each choice; the match overlaps.\n- Constant: slider (widen bounds), or type each choice's value.\n- Points, table: table, then y_1 ~ m x_1 + b.\n- Function: f(x)=…, then f(3).\n- Circle: click top and bottom points; midpoint is the center, half their distance the radius.\n- Inequality: shaded region; dashed edge excluded; systems need the overlap.\n- mean(…), median(…), 35% of 80.\nDesmos doesn't fit every question; say so in one line and still help, never refuse. Never judge slope, parallel or perpendicular by eye; read slopes from equations. Decimals vs fractions: 0.667 is 2/3; use the fraction button. Trig: switch to degrees. Before submit, give the steps and where to look; never read the result for the student.";

/** Karl's gating ruling, 2026-10-27 (playbook §8). */
export function desmosBlockApplies(fields: PromptFields): boolean {
  if (fields.questionSection === "M") return true;
  return fields.entryMode === "general" && fields.requestedMethod === "desmos";
}

export const LISA_DEFAULT_V4: PromptArtifact = {
  version: "lisa-default-v4",
  policyVariant: "default",

  renderSystemInstruction: (fields: PromptFields): string => {
    const v3 = LISA_DEFAULT_V3.renderSystemInstruction(fields);
    return desmosBlockApplies(fields) ? `${v3}\n\n${DESMOS_BLOCK}` : v3;
  },
};
