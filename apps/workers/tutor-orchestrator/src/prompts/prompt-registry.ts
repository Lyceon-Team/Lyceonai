/**
 * @spec [Doc-03C_V3 §4.3 — prompt artifact loading at bootstrap]
 * @implemented 2026-08-17
 *
 * plain English: The prompt registry maps (policy_variant, prompt_version) to
 * a loaded prompt artifact. All artifacts are loaded at module import time
 * (bootstrap), not at request time. The registry is immutable after load.
 *
 * expected outcome: resolvePromptArtifact("default", null) returns the latest
 * default artifact. Since 2026-11-22 (W4-13) the BFF sends an exact version
 * (shared/tutor-orchestrator-wire.ts TUTOR_DEFAULT_PROMPT_VERSION), so production
 * runs the version the BFF names: a new default goes live when that constant
 * changes, and this registry's default must equal it (pinned by
 * tests/ci/tutor-turn-attribution-path.route.contract.test.ts). resolvePromptArtifact("default", "lisa-default-v1") returns
 * that specific version. Unknown variants/versions fall back to the default.
 *
 * trade-offs:
 *  - Only the "default" variant is registered in this pass. Other variants
 *    will be added as separate artifact files when authored.
 *  - Fallback to default on unknown variant is intentional: the BFF resolves
 *    policy_variant before calling the worker, so an unknown variant here is
 *    a BFF bug, not a student-facing state. Falling back is safer than 500ing.
 *  - The registry logs a warning on fallback so the bug is observable.
 */

import type { PromptArtifact } from "./types.js";
import { LISA_DEFAULT_V1 } from "./lisa-default-v1.js";
import { LISA_DEFAULT_V2 } from "./lisa-default-v2.js";
import { LISA_DEFAULT_V3 } from "./lisa-default-v3.js";
import { LISA_DEFAULT_V4 } from "./lisa-default-v4.js";
import { LISA_DEFAULT_V5 } from "./lisa-default-v5.js";
import { LISA_DEFAULT_V6 } from "./lisa-default-v6.js";
import { LISA_DEFAULT_V7 } from "./lisa-default-v7.js";
import { logEvent } from "../lib/vertex-client.js";

// ── Artifact registry (loaded at bootstrap per §4.3) ────────────────

/** All registered artifacts, keyed by version string. */
const ARTIFACTS_BY_VERSION: ReadonlyMap<string, PromptArtifact> = new Map([
  [LISA_DEFAULT_V1.version, LISA_DEFAULT_V1],
  [LISA_DEFAULT_V2.version, LISA_DEFAULT_V2],
  [LISA_DEFAULT_V3.version, LISA_DEFAULT_V3],
  // v4 (2026-10-27, the Desmos block) resolves by exact version only.
  [LISA_DEFAULT_V4.version, LISA_DEFAULT_V4],
  // v5 (2026-11-02, G2-1: v4 + the data-block rule, state blocks as data blocks) resolves by
  // exact version only. It was the default from Karl's first 2026-11-11 ruling (#1465) until his
  // second, the same day, which made v6 the default.
  [LISA_DEFAULT_V5.version, LISA_DEFAULT_V5],
  // v6 (2026-11-08, SCL-275: v5 + the help-level directive block) was the default from Karl's
  // second 2026-11-11 ruling until v7.
  [LISA_DEFAULT_V6.version, LISA_DEFAULT_V6],
  // v7 (2026-11-22, owner brief: v6 + the Reading & Writing worked-step rule) is the default for
  // every variant and the fallback (see LATEST_BY_VARIANT).
  [LISA_DEFAULT_V7.version, LISA_DEFAULT_V7],
]);

/**
 * Latest artifact version per policy variant (Doc 03A §11.4).
 *
 * @spec [Doc-03A_V3 §11.4, Doc-03C_V3 §4.3; owner brief "Reading & Writing worked step", Karl
 *       2026-11-22 ("Bump the prompt version")] | @implemented [2026-11-22]
 * plain English: `lisa-default-v7` is the default for every variant and the fallback, effective
 * when Karl deploys the worker. It is v6 plus one sentence on Reading & Writing worked steps
 * before submission, so every other turn renders exactly as v6. History: v6 was the default from
 * Karl's second ruling of 2026-11-11 (G0-2-04, batch c9f89683: worked step 5/5 against v5's 0/5),
 * replacing v5 (his first ruling that day, #1465).
 * V1 starter set per Doc 03A §11.4: all variants resolve to the same artifact until
 * variant-specific artifacts are authored. v1–v6 stay resolvable by exact version for
 * attribution and evaluation. Pinned by tests/ci/lisa-prompt-default.contract.test.ts.
 */
const LATEST_BY_VARIANT: ReadonlyMap<string, PromptArtifact> = new Map([
  ["default", LISA_DEFAULT_V7],
  ["scaffolded", LISA_DEFAULT_V7],
  ["socratic", LISA_DEFAULT_V7],
  ["concise", LISA_DEFAULT_V7],
  ["strategy_first", LISA_DEFAULT_V7],
]);

/** The absolute fallback artifact — used when both variant and version miss (v7, 2026-11-22). */
const FALLBACK_ARTIFACT: PromptArtifact = LISA_DEFAULT_V7;

// ── Public API ──────────────────────────────────────────────────────

/**
 * Resolves a prompt artifact from the registry.
 *
 * Resolution order (§4.3):
 * 1. If prompt_version is non-null, look up by exact version string.
 * 2. If not found (or null), look up the latest for the policy_variant.
 * 3. If the variant is unknown, fall back to the default artifact.
 *
 * Never throws — always returns an artifact.
 *
 * @spec [Doc-03C_V3 §4.3]
 */
export function resolvePromptArtifact(
  policyVariant: string,
  promptVersion: string | null,
): PromptArtifact {
  // 1. Exact version lookup
  if (promptVersion !== null) {
    const exact = ARTIFACTS_BY_VERSION.get(promptVersion);
    if (exact) return exact;

    logEvent(
      "warn",
      "prompt_registry",
      "unknown_prompt_version",
      "Requested prompt_version not found in registry; falling back to latest for variant",
      { requestedVersion: promptVersion, policyVariant },
    );
  }

  // 2. Latest for variant
  const latest = LATEST_BY_VARIANT.get(policyVariant);
  if (latest) return latest;

  // 3. Fallback to default
  logEvent(
    "warn",
    "prompt_registry",
    "unknown_policy_variant",
    "Unknown policy_variant; falling back to default artifact",
    { policyVariant },
  );
  return FALLBACK_ARTIFACT;
}
