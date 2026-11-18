/**
 * @spec [owner brief "One watch, two outputs" (Karl, 2026-11-04), Step 0 design §2 (one chunk
 *       pipeline, books and video segments); rulings of 2026-11-05 (rule 3: the "how it's
 *       explained" fields take the same rewrite and drop-only check as the facts)]
 *       | @implemented [2026-11-05]
 *
 * plain English:
 *   U1 the book's chunk steps, lifted into chunk-unit.ts, ask the same calls in the same order with
 *      the same cache keys and stages as ingest-book.ts did, so the Meltzer cache stays valid:
 *      rewrite, audit, example check; one repair on a repairable failure; none on a boundary
 *      failure; an example mismatch drops and is never repaired.
 *   U2 BOOK_PROMPT_VERSION is unchanged by the video prompts (pinned), and the video wording is
 *      the book's with exactly the stated substitutions.
 *   U3 the delivery notes: rendered for the audit, kept without skill codes, never example-checked,
 *      and the delivery audit drops kept instructor wording.
 *   U4 the runner's pure parts: the write-up renders in book.ts's shape, a short unit stays
 *      whole and a long one is cut at each example after the first with its opening; provenance;
 *      an entry's skills must lie within the segment's.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  AUDIT_SYSTEM,
  BOOK_PROMPT_VERSION,
  DELIVERY_AUDIT_SYSTEM,
  DELIVERY_REWRITE_SYSTEM,
  REWRITE_SYSTEM,
  VIDEO_AUDIT_SYSTEM,
  VIDEO_REWRITE_SYSTEM,
  deliveryRewriteResponseSchema,
  deliveryRewriteSchema,
  deliveryText,
  rewriteResponseSchema,
  rewriteSchemaFor,
} from "../../scripts/rag/book-prompts";
import { type UnitCall, rewriteAuditCheck } from "../../scripts/rag/chunk-unit";
import {
  renderUnit,
  segmentProvenance,
  skillsWithin,
  unitPieces,
} from "../../scripts/rag/chunk-segments";

type Answer = Record<string, unknown>;

/** A scripted model: answers by step, in order, and records every call. */
function scripted(answers: Record<string, Answer[]>): {
  call: UnitCall;
  calls: Array<{ key: string; stage: string; step: string; video: boolean }>;
} {
  const calls: Array<{
    key: string;
    stage: string;
    step: string;
    video: boolean;
  }> = [];
  const call: UnitCall = <T>(a: {
    key: string;
    stage: string;
    step: string;
    schema: z.ZodType<T>;
    video?: unknown;
  }): Promise<T> => {
    calls.push({
      key: a.key,
      stage: a.stage,
      step: a.step,
      video: a.video !== undefined,
    });
    const next = answers[a.step]?.shift();
    if (next === undefined) throw new Error(`no scripted answer for ${a.step}`);
    return Promise.resolve(a.schema.parse(next));
  };
  return { call, calls };
}

const PASS = {
  complete: true,
  starts_mid_idea: false,
  faithful: true,
  self_contained: true,
  correct: true,
  act_scope_respected: true,
  issues: "",
};
const ENTRY = {
  keep: true,
  drop_reason: null,
  content: "Factor, then cancel the common factor.",
  skill_codes: ["Equivalent Expressions"],
  content_type: "textbook",
  surface_gate: "pre_and_post",
  surface_gate_reason: "a method",
  taxonomy_gap: null,
};
const SCHEMA = rewriteSchemaFor(["Equivalent Expressions", "Circles"]);

function bookUnit(call: UnitCall) {
  return rewriteAuditCheck({
    model: "m",
    call,
    rewrite: {
      system: REWRITE_SYSTEM,
      user: "UNIT",
      responseSchema: rewriteResponseSchema(["Equivalent Expressions"]),
      schema: SCHEMA,
      contentOf: (rw) => rw.content,
      skillsOf: (rw) => rw.skill_codes,
      detailOf: (rw) => rw.taxonomy_gap ?? "",
    },
    audit: {
      system: AUDIT_SYSTEM,
      source: "S",
      before: "B",
      after: "A",
      ruleOpening: null,
    },
    exampleCheck: true,
  });
}

describe("U1 chunk-unit.ts is ingest-book.ts's loop, keys and stages unchanged", () => {
  it("keeps an entry: rewrite, audit, example check, with the book's cache keys", async () => {
    const s = scripted({
      rewrite: [ENTRY],
      audit: [PASS],
      "example-check": [{ pairs: [] }],
    });
    const out = await bookUnit(s.call);
    expect(out.kept).toBe(true);
    expect(s.calls.map((c) => c.stage)).toEqual([
      "rewrite",
      "audit",
      "example check",
    ]);
    expect(s.calls[0]?.key).toBe("rewrite\u0000m\u0000UNIT");
    expect(s.calls[1]?.key.startsWith("audit\u0000m\u0000SOURCE:\nS")).toBe(
      true,
    );
    expect(s.calls[2]?.key).toBe(`example-check\u0000m\u0000${ENTRY.content}`);
    expect(s.calls.some((c) => c.video)).toBe(false);
  });

  it("repairs a repairable failure once, then keeps", async () => {
    const s = scripted({
      rewrite: [ENTRY, ENTRY],
      audit: [{ ...PASS, faithful: false, issues: "adds a rule" }, PASS],
      "example-check": [{ pairs: [] }],
    });
    const out = await bookUnit(s.call);
    expect(out).toMatchObject({ kept: true, repaired: true });
    expect(s.calls.map((c) => c.stage)).toEqual([
      "rewrite",
      "audit",
      "rewrite (repair)",
      "audit (repair)",
      "example check",
    ]);
    expect(s.calls[2]?.key).toContain(
      "A REVIEWER REJECTED YOUR PREVIOUS ENTRY FOR THIS UNIT: adds a rule",
    );
  });

  it("never repairs a boundary failure, and drops after one failed repair", async () => {
    const boundary = scripted({
      rewrite: [ENTRY],
      audit: [{ ...PASS, complete: false, issues: "x" }],
    });
    expect(await bookUnit(boundary.call)).toEqual({
      kept: false,
      reason: "audit_incomplete",
      detail: "x",
    });
    expect(boundary.calls).toHaveLength(2);
    const twice = scripted({
      rewrite: [ENTRY, ENTRY],
      audit: [
        { ...PASS, correct: false, issues: "a" },
        { ...PASS, correct: false, issues: "b" },
      ],
    });
    expect(await bookUnit(twice.call)).toEqual({
      kept: false,
      reason: "audit_incorrect",
      detail: "b",
    });
  });

  it("drops on an example mismatch without repair, and on the rewrite's own drop", async () => {
    const mismatch = scripted({
      rewrite: [ENTRY],
      audit: [PASS],
      "example-check": [
        {
          pairs: [
            {
              statement: "st",
              example: "ex",
              example_shows_it: false,
              why: "w",
            },
          ],
        },
      ],
    });
    expect(await bookUnit(mismatch.call)).toMatchObject({
      kept: false,
      reason: "audit_self_contradictory",
    });
    expect(mismatch.calls).toHaveLength(3);
    const dropped = scripted({
      rewrite: [
        {
          ...ENTRY,
          keep: false,
          drop_reason: "not_sat_specific",
          taxonomy_gap: "g",
        },
      ],
    });
    expect(await bookUnit(dropped.call)).toEqual({
      kept: false,
      reason: "not_sat_specific",
      detail: "g",
    });
    const noSkill = scripted({ rewrite: [{ ...ENTRY, skill_codes: [] }] });
    expect(await bookUnit(noSkill.call)).toMatchObject({
      kept: false,
      reason: "no_taxonomy_skill",
    });
  });
});

describe("U2 the video wording leaves the book's prompts alone", () => {
  it("pins BOOK_PROMPT_VERSION", () => {
    expect(BOOK_PROMPT_VERSION).toBe("b9677deab859");
  });
  it("substitutes exactly the stated phrases", () => {
    expect(VIDEO_REWRITE_SYSTEM).toContain(
      "a written account of one segment of an SAT preparation video",
    );
    expect(VIDEO_REWRITE_SYSTEM).toContain('"the instructor"');
    expect(VIDEO_REWRITE_SYSTEM.length).toBeGreaterThan(REWRITE_SYSTEM.length);
    expect(VIDEO_AUDIT_SYSTEM).toContain("the video segment you are watching");
    expect(VIDEO_AUDIT_SYSTEM).not.toContain("the book text around the source");
    // Everything after the swapped opening is the book's audit, word for word.
    const tail = AUDIT_SYSTEM.slice(
      AUDIT_SYSTEM.indexOf("When the source is one lettered"),
    );
    expect(VIDEO_AUDIT_SYSTEM.endsWith(tail)).toBe(true);
  });
});

describe("U3 the delivery notes take the same rewrite and drop-only audit", () => {
  const DELIVERY = {
    keep: true,
    drop_reason: null,
    step_order: "Goal first, then an example.",
    click_phrases: ["A factor that appears top and bottom divides out."],
    analogies: [],
    understanding_checks: ["Pause and try the next line."],
  };
  const run = (call: UnitCall) =>
    rewriteAuditCheck({
      model: "m",
      call,
      rewrite: {
        system: DELIVERY_REWRITE_SYSTEM,
        user: "NOTES",
        responseSchema: deliveryRewriteResponseSchema,
        schema: deliveryRewriteSchema,
        contentOf: (rw) => deliveryText(rw),
        skillsOf: () => null,
        detailOf: () => "",
      },
      audit: {
        system: DELIVERY_AUDIT_SYSTEM,
        source: "(the video segment you are watching)",
        before: "B",
        after: "A",
        ruleOpening: null,
        video: { videoId: "abcdefghijk", start: 10, end: 70 },
      },
      exampleCheck: false,
    });

  it("keeps without skill codes, watches the segment, and is never example-checked", async () => {
    const s = scripted({ rewrite: [DELIVERY], audit: [PASS] });
    const out = await run(s.call);
    expect(out).toMatchObject({ kept: true, skill_codes: [] });
    expect(s.calls.map((c) => c.step)).toEqual(["rewrite", "audit"]);
    expect(s.calls[1]?.video).toBe(true);
    if (out.kept)
      expect(out.content).toContain("Ways of putting it:\n- A factor");
  });

  it("drops notes that keep the instructor's wording after the one repair", async () => {
    const wording = { ...PASS, faithful: false, issues: "echoes the speaker" };
    const s = scripted({
      rewrite: [DELIVERY, DELIVERY],
      audit: [wording, wording],
    });
    expect(await run(s.call)).toEqual({
      kept: false,
      reason: "audit_unfaithful",
      detail: "echoes the speaker",
    });
    expect(DELIVERY_AUDIT_SYSTEM).toContain(
      "reproduces the instructor's own wording",
    );
  });

  it("renders nothing for empty notes", () => {
    expect(
      deliveryText({
        step_order: " ",
        click_phrases: [],
        analogies: [],
        understanding_checks: [],
      }),
    ).toBeNull();
  });
});

describe("U4 the runner's pure parts", () => {
  const W = {
    what_is_taught: "Simplify a rational expression by factoring.",
    method: "Factor top and bottom, cancel.",
    steps: ["Factor the numerator.", "Factor the denominator.", "Cancel."],
    look_at: [],
    pitfalls: ["Cancelling terms instead of factors."],
    examples: [
      {
        setup: "(x^2 - 4)/(x^2 + 2x - 8)",
        steps: ["(x-2)(x+2)/((x+4)(x-2))", "(x+2)/(x+4)"],
      },
    ],
    delivery: {
      step_order: "",
      click_phrases: [],
      analogies: [],
      understanding_checks: [],
    },
  };

  it("renders the facts in book.ts's shape and keeps a short unit whole", () => {
    const text = renderUnit(W);
    expect(text.startsWith("## Simplify a rational expression")).toBe(true);
    expect(text).toContain("### Example 1");
    expect(text).toContain("Pitfalls the instructor names:");
    expect(text).not.toContain("delivery");
    expect(unitPieces(text)).toEqual([{ text, opening: null }]);
  });

  it("cuts a long unit at each example after the first, each piece with its opening", () => {
    const long = {
      ...W,
      steps: Array.from(
        { length: 60 },
        (_, i) => `Step ${i} of a long method with words.`,
      ),
      examples: [1, 2, 3].map((n) => ({
        setup: `Example problem ${n}`,
        steps: Array.from(
          { length: 12 },
          (_, i) => `worked step ${i} of example ${n}`,
        ),
      })),
    };
    const pieces = unitPieces(renderUnit(long));
    expect(pieces).toHaveLength(3);
    expect(pieces[1]?.text.trimStart().startsWith("### Example 2")).toBe(true);
    expect(pieces[1]?.opening).toContain("Method: Factor top and bottom");
    expect(pieces[2]?.opening).toBe(pieces[1]?.opening);
  });

  it("names provenance per Doc 03D §6.5, with .n only for split segments", () => {
    expect(segmentProvenance("abcdefghijk", 55, 198, 0, 1)).toBe(
      "youtube:abcdefghijk:55-198",
    );
    expect(segmentProvenance("abcdefghijk", 55, 198, 1, 3)).toBe(
      "youtube:abcdefghijk:55-198.2",
    );
  });

  it("keeps an entry only when its skills lie within the segment's", () => {
    const seg = new Set(["Equivalent Expressions", "Nonlinear Functions"]);
    expect(skillsWithin(["Equivalent Expressions"], seg)).toEqual({ ok: true });
    expect(skillsWithin(["Circles", "Equivalent Expressions"], seg)).toEqual({
      ok: false,
      outside: ["Circles"],
    });
    expect(skillsWithin([], seg)).toEqual({ ok: false, outside: [] });
  });
});
