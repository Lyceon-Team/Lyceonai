/**
 * @spec [Doc-03C_V3 §4.3 — prompt artifact loading at bootstrap]
 * @implemented 2026-08-17
 *
 * plain English: The prompt registry maps (policy_variant, prompt_version) to
 * a loaded prompt artifact. All artifacts are loaded at module import time
 * (bootstrap), not at request time. The registry is immutable after load.
 *
 * expected outcome: resolvePromptArtifact("default", null) returns the latest
 * default artifact. resolvePromptArtifact("default", "lisa-default-v1") returns
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
import { logEvent } from "../lib/vertex-client.js";

// ── Artifact registry (loaded at bootstrap per §4.3) ────────────────

/** All registered artifacts, keyed by version string. */
const ARTIFACTS_BY_VERSION: ReadonlyMap<string, PromptArtifact> = new Map([
  [LISA_DEFAULT_V1.version, LISA_DEFAULT_V1],
  [LISA_DEFAULT_V2.version, LISA_DEFAULT_V2],
  [LISA_DEFAULT_V3.version, LISA_DEFAULT_V3],
  // v4 (2026-10-27, the Desmos block) resolves by exact version only and is not the latest for
  // any variant, so production stays on v3 until Karl rules on the G0-2 replies.
  [LISA_DEFAULT_V4.version, LISA_DEFAULT_V4],
]);

/** Latest artifact version per policy variant (Doc 03A §11.4). */
const LATEST_BY_VARIANT: ReadonlyMap<string, PromptArtifact> = new Map([
  ["default", LISA_DEFAULT_V3],
  // V1 starter set per Doc 03A §11.4 — all four variants resolve to the
  // same artifact. When variant-specific artifacts are authored, each entry
  // points to its own artifact. v3 (2026-10-15, video library: v2 + the video
  // offer) is the latest; v1 and v2 stay resolvable by exact version for attribution.
  ["scaffolded", LISA_DEFAULT_V3],
  ["socratic", LISA_DEFAULT_V3],
  ["concise", LISA_DEFAULT_V3],
  ["strategy_first", LISA_DEFAULT_V3],
]);

/** The absolute fallback artifact — used when both variant and version miss. */
const FALLBACK_ARTIFACT: PromptArtifact = LISA_DEFAULT_V3;

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
