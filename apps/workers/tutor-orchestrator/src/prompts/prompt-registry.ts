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
import { logEvent } from "../lib/vertex-client.js";

// ── Artifact registry (loaded at bootstrap per §4.3) ────────────────

/** All registered artifacts, keyed by version string. */
const ARTIFACTS_BY_VERSION: ReadonlyMap<string, PromptArtifact> = new Map([
  [LISA_DEFAULT_V1.version, LISA_DEFAULT_V1],
]);

/** Latest artifact version per policy variant. */
const LATEST_BY_VARIANT: ReadonlyMap<string, PromptArtifact> = new Map([
  ["default", LISA_DEFAULT_V1],
]);

/** The absolute fallback artifact — used when both variant and version miss. */
const FALLBACK_ARTIFACT: PromptArtifact = LISA_DEFAULT_V1;

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
