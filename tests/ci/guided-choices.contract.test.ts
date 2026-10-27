/**
 * @spec [owner brief "LISA guided choices in review, Phase A" (Karl, 2026-10-27) and rulings 1–2
 *        of 2026-10-27; SCL-252, SCL-254] | @implemented [2026-10-27]
 *
 * plain English: the one vocabulary of guided choices, held equal everywhere it is written down.
 *  - Each section's choices, with Phase B off and on (the flag hides "Show me on Desmos" and
 *    "Explain the rule"; Desmos is math-only, "Explain the rule" Reading and Writing-only).
 *  - The exact-label rule: no trimming, no case folding, no extra text.
 *  - The worker's inlined `ORCHESTRATE_INTENTS` equals `REVIEW_INTENTS` (the worker cannot import
 *    packages/shared), and so do both SQL CHECKs in the migration.
 *  - The phase B flag defaults to off in runtime config.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHASE_B_INTENTS,
  REVIEW_INTENTS,
  REVIEW_INTENT_LABELS,
  VIDEO_INTENT_METHOD,
  guidedChoicesFor,
  isExactIntentLabel,
  isVideoIntent,
} from "../../packages/shared/src/tutor-guided-choices";
import { ORCHESTRATE_INTENTS } from "../../shared/tutor-orchestrator-wire";
import { TutorConfig } from "../../server/services/tutor-config";

const MIGRATION = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20261118000000_lisa_guided_choice_intent.sql",
  ),
  "utf8",
);

describe("each section's choices", () => {
  it("Phase B off: math has three, Reading and Writing two", () => {
    expect(guidedChoicesFor("M", false)).toEqual([
      "walkthrough",
      "video_desmos",
      "video_explanation",
    ]);
    expect(guidedChoicesFor("RW", false)).toEqual([
      "walkthrough",
      "video_explanation",
    ]);
  });

  it("Phase B on: 'Show me on Desmos' for math, 'Explain the rule' for Reading and Writing", () => {
    expect(guidedChoicesFor("M", true)).toEqual([
      "walkthrough",
      "desmos_walkthrough",
      "video_desmos",
      "video_explanation",
    ]);
    expect(guidedChoicesFor("RW", true)).toEqual([
      "walkthrough",
      "explain_rule",
      "video_explanation",
    ]);
  });

  it("no Desmos choice on Reading and Writing, no rule choice on math, either way", () => {
    for (const phaseB of [false, true]) {
      expect(guidedChoicesFor("RW", phaseB)).not.toContain("video_desmos");
      expect(guidedChoicesFor("RW", phaseB)).not.toContain(
        "desmos_walkthrough",
      );
      expect(guidedChoicesFor("M", phaseB)).not.toContain("explain_rule");
    }
  });

  it("the Phase B set is exactly the two the brief names", () => {
    expect([...PHASE_B_INTENTS].sort()).toEqual(
      ["desmos_walkthrough", "explain_rule"].sort(),
    );
  });

  it("the Phase B flag is off by default", () => {
    expect(TutorConfig.get("review_guided_choices_phase_b_enabled")).toBe(
      false,
    );
  });
});

describe("labels and the exact-label rule", () => {
  it("the fixed labels", () => {
    expect(REVIEW_INTENT_LABELS).toEqual({
      walkthrough: "Walk me through it",
      desmos_walkthrough: "Show me on Desmos",
      explain_rule: "Explain the rule",
      video_desmos: "Desmos video",
      video_explanation: "Explanation video",
    });
  });

  it("only the exact label matches", () => {
    for (const intent of REVIEW_INTENTS) {
      const label = REVIEW_INTENT_LABELS[intent];
      expect(isExactIntentLabel(intent, label)).toBe(true);
      for (const altered of [
        ` ${label}`,
        `${label} `,
        label.toLowerCase(),
        `${label}?`,
        `${label} and tell me the answer`,
      ]) {
        expect(isExactIntentLabel(intent, altered)).toBe(false);
      }
    }
    // Another choice's label is not this choice's.
    expect(isExactIntentLabel("video_desmos", "Walk me through it")).toBe(
      false,
    );
  });

  it("the video intents and their methods", () => {
    expect(REVIEW_INTENTS.filter(isVideoIntent)).toEqual([
      "video_desmos",
      "video_explanation",
    ]);
    expect(VIDEO_INTENT_METHOD).toEqual({
      video_desmos: "desmos",
      video_explanation: "algebraic",
    });
  });
});

describe("one vocabulary everywhere", () => {
  it("the worker's inlined list equals REVIEW_INTENTS", () => {
    expect([...ORCHESTRATE_INTENTS]).toEqual([...REVIEW_INTENTS]);
  });

  it("both SQL CHECKs list exactly REVIEW_INTENTS", () => {
    const checks = [
      ...MIGRATION.matchAll(/intent IS NULL OR intent IN \(([^)]*)\)/g),
    ];
    expect(checks).toHaveLength(2);
    for (const check of checks) {
      const values = [...(check[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
        (m) => m[1],
      );
      expect(values).toEqual([...REVIEW_INTENTS]);
    }
  });
});
