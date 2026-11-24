/**
 * @spec [ruling on #1456 (Karl, via the audit, 2026-11-08): "one prompt line, v3 → v4 → v5 → v6
 *        … lisa-default-v6 = lisa-default-v5 + the help-level directive blocks, registered by
 *        exact version only"; owner brief "Help-level engine", Karl 2026-11-05; Doc-03C_V3 §4.3
 *        — versioned prompt artifact; SCL-275]
 * @implemented 2026-11-08
 *
 * plain English: v5's rules, unchanged, plus one state block. When the BFF sends a help level
 * (`help_level`, and at level 3 which worked step), the context gains a [HELP LEVEL] fact and a
 * [DIRECTIVE] telling LISA to give exactly that much help (render-state-blocks.ts
 * `renderHelpLevelBlock`). Before submission the ceiling is a worked step and the final value is
 * never stated; after submission the full solution is allowed.
 *
 * trade-offs:
 *  - v5 is immutable (§4.3). v6 composes it: v5's rules are reproduced byte for byte, and v5's
 *    data boundary carries over (`dataBoundary`). The only difference is `helpLevelBlock`, so a
 *    request with no help level renders exactly as v5.
 *  - The default since Karl's second ruling of 2026-11-11: the latest for every variant and the
 *    fallback (prompt-registry.ts; pinned by tests/ci/lisa-prompt-default.contract.test.ts), on
 *    G0-2-04 (batch c9f89683: worked step 5/5 against v5's 0/5). With no help level sent it
 *    renders exactly as v5.
 *  - The help level is a state block, not a rule: it changes per turn, and a fact paired with a
 *    directive is how every per-turn instruction reaches the model (Doc 03D §7.4).
 */

import type { PromptArtifact, PromptFields } from "./types.js";
import { LISA_DEFAULT_V5 } from "./lisa-default-v5.js";

export const LISA_DEFAULT_V6: PromptArtifact = {
  version: "lisa-default-v6",
  policyVariant: "default",
  dataBoundary: true,
  helpLevelBlock: true,

  renderSystemInstruction: (fields: PromptFields): string =>
    LISA_DEFAULT_V5.renderSystemInstruction(fields),
};
