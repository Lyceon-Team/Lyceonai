/**
 * The prompt LISA runs on by default: lisa-default-v6.
 *
 * @spec [Doc-03A_V3 §11.4 (latest artifact per variant), Doc-03C_V3 §4.3 (registry resolution);
 *       SCL-275; Karl's rulings 2026-11-11 on the real G0-2 runs] | @implemented [2026-11-11]
 *
 * plain English: the BFF sends `prompt_version: null` (server/services/tutor-context.ts), so
 * production runs whatever the registry resolves for a null version. Karl ruled on 2026-11-11:
 *  - first v5 (#1465), from the Desmos cases (batches e449d327, 85775569, 20a40389, e6a7752c:
 *    v3 0/20, v4 18/20, v5 19/20, v6 16/20; no leaks);
 *  - then v6, from G0-2-04, the "Got it" loop (batch c9f89683, help level computed in the
 *    replay): v6 did the worked step 5/5 (v5 0/5), no smaller question, restarted 1/5, leaked 0.
 *    With no help level sent v6 renders exactly as v5, so the Desmos gap is run-to-run variation.
 *   P1 every policy variant resolves a null version to v6.
 *   P2 an unknown variant (the fallback) and an unknown version both land on v6.
 *   P3 every other artifact still resolves by exact version, so attribution and the eval
 *      harness can name it.
 *   P4 what the worker builds for a null-version request carrying a help level, on every
 *      variant, has v6's [HELP LEVEL] block, which v5 and earlier never render.
 *   P5 the shared `DEFAULT_PROMPT_VERSION` other tests read agrees with this file.
 * Changing the default means changing this file and that constant, with the ruling.
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
import { LISA_DEFAULT_V6 } from "../../apps/workers/tutor-orchestrator/src/prompts/lisa-default-v6";
import { buildSystemInstruction } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import { DATA_BLOCK_OPEN_PREFIX } from "../../shared/tutor-safety-constants";
import {
  DEFAULT_PROMPT_VERSION,
  buildGoldenEnvelope,
} from "./lisa-golden-set-helpers";

const DEFAULT_VERSION = "lisa-default-v6";
const VARIANTS = [
  "default",
  "scaffolded",
  "socratic",
  "concise",
  "strategy_first",
] as const;

describe("the default prompt is lisa-default-v6 (Karl, 2026-11-11)", () => {
  it("P1 every variant resolves a null version to v6", () => {
    for (const variant of VARIANTS) {
      expect(resolvePromptArtifact(variant, null)).toBe(LISA_DEFAULT_V6);
    }
    expect(LISA_DEFAULT_V6.version).toBe(DEFAULT_VERSION);
  });

  it("P2 the fallback is v6: an unknown variant, and an unknown version", () => {
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

  it("P3 every other artifact resolves by exact version", () => {
    for (const version of [
      "lisa-default-v1",
      "lisa-default-v2",
      "lisa-default-v3",
      "lisa-default-v4",
      "lisa-default-v5",
    ]) {
      expect(resolvePromptArtifact("default", version).version).toBe(version);
    }
  });

  it("P4 a null-version request with a help level is built with v6's block, on every variant", () => {
    const base = buildGoldenEnvelope({
      surface: "review",
      isPostSubmit: false,
      question: {
        stem: "If 4x - 7 = 13, what is the value of x?",
        itemType: "grid_in",
      },
      correctAnswer: null,
      messages: [{ role: "student", text: "Got it, next step" }],
    });
    // What production sends: no version, so the registry decides.
    expect(base.policy_assignment.prompt_version).toBeNull();
    for (const variant of VARIANTS) {
      const instruction = buildSystemInstruction({
        ...base,
        policy_assignment: {
          ...base.policy_assignment,
          policy_variant: variant,
        },
        help_level: "worked_step",
        submit_state: "pre_submit",
        worked_step: { index: 2, final: false },
      });
      // v6's block (v1–v5 never render it), on v5's data-boundary line.
      expect(instruction).toContain("[HELP LEVEL]");
      expect(instruction).toContain(DATA_BLOCK_OPEN_PREFIX);
    }
  });

  it("P5 the shared DEFAULT_PROMPT_VERSION agrees with this file", () => {
    expect(DEFAULT_PROMPT_VERSION).toBe(DEFAULT_VERSION);
  });
});
