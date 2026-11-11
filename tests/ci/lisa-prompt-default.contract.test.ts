/**
 * The prompt LISA runs on by default: lisa-default-v5.
 *
 * @spec [Doc-03A_V3 §11.4 (latest artifact per variant), Doc-03C_V3 §4.3 (registry resolution);
 *       Karl's ruling 2026-11-11 on the real G0-2 run] | @implemented [2026-11-11]
 *
 * plain English: the BFF sends `prompt_version: null` (server/services/tutor-context.ts), so
 * production runs whatever the registry resolves for a null version. Karl ruled v5 the default
 * on 2026-11-11 from the real-case evaluation (batches e449d327, 85775569, 20a40389, e6a7752c):
 * Desmos cases v3 0/20, v4 18/20, v5 19/20, v6 16/20; no leaks on any version.
 *   P1 every policy variant resolves a null version to v5.
 *   P2 an unknown variant (the fallback) and an unknown version both land on v5.
 *   P3 every other artifact still resolves by exact version, so attribution and the eval
 *      harness can name it, and none of them is reached by default.
 *   P4 what the worker actually builds for a null-version request is v5's rendering: the
 *      data-block rule is present and the state values are inside data blocks.
 * Changing the default means changing this file, with the ruling that allowed it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "../../apps/workers/tutor-orchestrator/src/lib/vertex-client",
  async (orig) => ({
    ...(await orig<object>()),
    logEvent: vi.fn(),
  }),
);

import { resolvePromptArtifact } from "../../apps/workers/tutor-orchestrator/src/prompts/prompt-registry";
import { LISA_DEFAULT_V5 } from "../../apps/workers/tutor-orchestrator/src/prompts/lisa-default-v5";
import { buildSystemInstruction } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import {
  DATA_BLOCK_CLOSE,
  DATA_BLOCK_OPEN_PREFIX,
} from "../../shared/tutor-safety-constants";
import { buildGoldenEnvelope } from "./lisa-golden-set-helpers";

const DEFAULT_VERSION = "lisa-default-v5";
const VARIANTS = [
  "default",
  "scaffolded",
  "socratic",
  "concise",
  "strategy_first",
] as const;

describe("the default prompt is lisa-default-v5 (Karl, 2026-11-11)", () => {
  it("P1 every variant resolves a null version to v5", () => {
    for (const variant of VARIANTS) {
      expect(resolvePromptArtifact(variant, null)).toBe(LISA_DEFAULT_V5);
    }
    expect(LISA_DEFAULT_V5.version).toBe(DEFAULT_VERSION);
  });

  it("P2 the fallback is v5: an unknown variant, and an unknown version", () => {
    expect(resolvePromptArtifact("no-such-variant", null).version).toBe(
      DEFAULT_VERSION,
    );
    expect(resolvePromptArtifact("default", "lisa-default-v99").version).toBe(
      DEFAULT_VERSION,
    );
    expect(
      resolvePromptArtifact("no-such-variant", "lisa-default-v99").version,
    ).toBe(DEFAULT_VERSION);
  });

  it("P3 every other artifact resolves by exact version only", () => {
    for (const version of [
      "lisa-default-v1",
      "lisa-default-v2",
      "lisa-default-v3",
      "lisa-default-v4",
      "lisa-default-v6",
    ]) {
      expect(resolvePromptArtifact("default", version).version).toBe(version);
    }
  });

  it("P4 a null-version request is built with v5's rendering", () => {
    const envelope = buildGoldenEnvelope({
      surface: "practice",
      isPostSubmit: false,
      question: {
        stem: "If 2x + 3 = 7, what is x?",
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
        ],
      },
      correctAnswer: null,
    });
    // What production sends: no version, so the registry decides. Each variant in turn, so a
    // default changed for any one of them is caught here too.
    expect(envelope.policy_assignment.prompt_version).toBeNull();
    for (const variant of VARIANTS) {
      const request = {
        ...envelope,
        policy_assignment: {
          ...envelope.policy_assignment,
          policy_variant: variant,
        },
      };
      expect(buildSystemInstruction(request)).toContain(
        LISA_DEFAULT_V5.renderSystemInstruction({
          entryMode: request.entry_mode,
          sourceSurface: request.source_surface,
          policyVariant: variant,
          isPostSubmit: request.is_post_submit,
        }),
      );
    }
    const instruction = buildSystemInstruction(envelope);
    // Presence: the instruction is v5's, and its state values are in data blocks.
    expect(instruction).toContain(
      LISA_DEFAULT_V5.renderSystemInstruction({
        entryMode: envelope.entry_mode,
        sourceSurface: envelope.source_surface,
        policyVariant: envelope.policy_assignment.policy_variant,
        isPostSubmit: envelope.is_post_submit,
      }),
    );
    expect(instruction).toContain(DATA_BLOCK_OPEN_PREFIX);
    expect(instruction).toContain(DATA_BLOCK_CLOSE);
  });
});
