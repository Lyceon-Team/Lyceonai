/**
 * Contract tests — Question Ingestion QA validator + grid-in normalizer.
 *
 * @spec [Doc-02A_V6 §18/§23 + 280-discard taxonomy] | @spec [Doc-04A §7.3.1 / 04B SPR]
 * plain English: the fail-closed self-tests with PLANTED violations per blocker class
 * (QI-BLOCK-001/002/005/006) + HALT-2 + the grid-in normalizer grounded in College
 * Board's published SPR equivalence (2/3 → .666 AND .667). These are the falsifiable
 * core a Codex audit re-runs.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateIngestionCandidate,
  parseGridInValue,
  gridInEquivalent,
  gridInAcceptedForms,
  gridInResponseMatches,
  normalizeGridInKey,
  extractMathSpans,
  type IngestionCandidate,
  type IngestionQaContext,
} from "../shared/question-ingestion-qa";

const lineage = {
  provenance: "College Board official" as const,
  cb_question_id: "fa80893a",
  source_filename:
    "Easy - Linear equations in one variabe - Algebra - Math.pdf",
  source_page: 1,
  extracted_at: "2026-06-14T00:00:00Z",
  extractor_version: "vision-extract.v0",
};

function mcq(overrides: Partial<IngestionCandidate> = {}): IngestionCandidate {
  return {
    staging_id: "11111111-1111-4111-8111-111111111111",
    item_type: "mcq",
    section: "M",
    source_type: 1,
    domain: "Algebra",
    skill_codes: ["linear_equations_one_variable"],
    difficulty: 1,
    stem: "If $4x - 28 = -24$, what is the value of $x - 7$?",
    options: [
      { key: "A", text: "$-24$" },
      { key: "B", text: "$-22$" },
      { key: "C", text: "$-6$" },
      { key: "D", text: "$-1$" },
    ],
    correct_answer: "C",
    explanation:
      "Dividing all terms by 4 yields x - 7 = -6, so the value is -6.",
    source_lineage: lineage,
    ...overrides,
  };
}

function gridIn(
  overrides: Partial<IngestionCandidate> = {},
): IngestionCandidate {
  return {
    staging_id: "22222222-2222-4222-8222-222222222222",
    item_type: "grid_in",
    section: "M",
    source_type: 1,
    domain: "Algebra",
    skill_codes: ["linear_equations_one_variable"],
    difficulty: 1,
    stem: "If $\\frac{x}{8} = 5$, what is the value of $\\frac{8}{x}$?",
    options: null,
    correct_answer: "0.2",
    correct_variants: ["1/5", "0.2", ".2"], // exhaustive CB set for 1/5
    explanation:
      "Since x = 40, 8/x = 8/40 = 1/5 = 0.2. Both 1/5 and .2 are accepted.",
    source_lineage: lineage,
    ...overrides,
  };
}

// A full, all-clean probe context (every required probe ran and passed, covering
// every math span and asset the candidate carries). Pass-on-no-probe is impossible.
function clean(q: IngestionCandidate): IngestionQaContext {
  return {
    dedup: { exactDuplicateOf: null, nearDuplicateOf: null },
    mathRender: extractMathSpans(q).map((span) => ({ span, ok: true })),
    assetResolution: (q.assets ?? []).map((a) => ({
      id: a.id,
      resolved: true,
      sha256Match: true,
      mediaTypeOk: true,
    })),
  };
}

const codes = (r: ReturnType<typeof evaluateIngestionCandidate>): string[] =>
  r.reasons.map((x) => x.code);

describe("grid-in normalizer — CB SPR equivalence (not invented)", () => {
  it("treats 1/5, .2, 0.2, 0.20 as the same value", () => {
    expect(gridInEquivalent("1/5", ".2")).toBe(true);
    expect(gridInEquivalent("0.2", "0.20")).toBe(true);
    expect(gridInEquivalent("1/5", "0.20")).toBe(true);
  });

  it("parses integers/signed decimals/fractions; rejects mixed/percent/sep/÷0", () => {
    expect(parseGridInValue("-7/4")).toEqual({ num: -7n, den: 4n });
    expect(parseGridInValue("2/4")).toEqual({ num: 1n, den: 2n });
    expect(parseGridInValue(".5")).toEqual({ num: 1n, den: 2n });
    expect(parseGridInValue("3 1/2")).toBeNull();
    expect(parseGridInValue("20%")).toBeNull();
    expect(parseGridInValue("1,000")).toBeNull();
    expect(parseGridInValue("5/0")).toBeNull();
  });

  // QI-BLOCK-002 (highest scrutiny): exhaustive set incl. repeating-decimal forms.
  it("generates CB's exhaustive set for 2/3 = {2/3, .666, 0.666, .667, 0.667}", () => {
    const v = parseGridInValue("2/3");
    expect(v).not.toBeNull();
    expect(new Set(gridInAcceptedForms(v!))).toEqual(
      new Set(["2/3", "0.666", ".666", "0.667", ".667"]),
    );
  });

  it("for 1/3 truncate==round (no spurious .334)", () => {
    expect(new Set(gridInAcceptedForms(parseGridInValue("1/3")!))).toEqual(
      new Set(["1/3", "0.333", ".333"]),
    );
  });

  it("for a terminating value prefers the exact decimal, no grid-fill", () => {
    expect(new Set(gridInAcceptedForms(parseGridInValue("1/5")!))).toEqual(
      new Set(["1/5", "0.2", ".2"]),
    );
  });

  it("runtime match accepts both .666 and .667 for 2/3, and zero-padded exacts", () => {
    const twoThirds = parseGridInValue("2/3")!;
    expect(gridInResponseMatches(".666", twoThirds)).toBe(true);
    expect(gridInResponseMatches(".667", twoThirds)).toBe(true);
    expect(gridInResponseMatches(".5", twoThirds)).toBe(false);
    expect(gridInResponseMatches("0.20", parseGridInValue("1/5")!)).toBe(true);
  });

  it("normalizeGridInKey requires the exhaustive set (rejects a partial one)", () => {
    expect(
      normalizeGridInKey("2/3", ["2/3", "0.666", ".666", "0.667", ".667"]).ok,
    ).toBe(true);
    expect(normalizeGridInKey("2/3", ["2/3", ".667"]).ok).toBe(false); // partial
    expect(normalizeGridInKey("0.2", ["1/5", "0.2", ".2"]).ok).toBe(true);
  });
});

describe("ingestion QA verdict — happy paths (require all probes clean)", () => {
  it("passes a clean MCQ", () => {
    const q = mcq();
    expect(evaluateIngestionCandidate(q, clean(q)).status).toBe("pass");
  });
  it("passes a clean grid-in", () => {
    const q = gridIn();
    expect(evaluateIngestionCandidate(q, clean(q)).status).toBe("pass");
  });
});

describe("QI-BLOCK-001 — fail-closed: a missing probe is a REJECT", () => {
  it("rejects when the dedup probe did not run", () => {
    const q = mcq();
    const { dedup: _omit, ...noDedup } = clean(q);
    void _omit;
    const r = evaluateIngestionCandidate(q, noDedup);
    expect(r.status).toBe("reject");
    expect(codes(r)).toContain("QA-DUP-EXACT");
  });
  it("rejects when KaTeX-strict did not cover the candidate's math spans", () => {
    const r = evaluateIngestionCandidate(mcq(), {
      dedup: { exactDuplicateOf: null, nearDuplicateOf: null },
    });
    expect(r.status).toBe("reject");
    expect(codes(r)).toContain("QA-MATH-RENDER");
  });
  it("rejects on a KaTeX-strict failure folded in via context", () => {
    const q = mcq();
    const ctx = clean(q);
    ctx.mathRender = (ctx.mathRender ?? []).map((m, i) =>
      i === 0 ? { ...m, ok: false } : m,
    );
    expect(codes(evaluateIngestionCandidate(q, ctx))).toContain(
      "QA-MATH-RENDER",
    );
  });
});

describe("the 280-discard taxonomy + structure", () => {
  it("rejects duplicate option texts (280 #1)", () => {
    const q = mcq({
      options: [
        { key: "A", text: "$-6$" },
        { key: "B", text: "$-6$" },
        { key: "C", text: "$-22$" },
        { key: "D", text: "$-1$" },
      ],
    });
    expect(codes(evaluateIngestionCandidate(q, clean(q)))).toContain(
      "QA-OPT-DUP",
    );
  });
  it("rejects a wrong section code (280 #6)", () => {
    const q = mcq({ section: "GEOMETRY" });
    expect(codes(evaluateIngestionCandidate(q, clean(q)))).toContain(
      "QA-SECTION",
    );
  });
  it("rejects non-official source_type for this wave (280 #7)", () => {
    const q = mcq({ source_type: 2 });
    expect(codes(evaluateIngestionCandidate(q, clean(q)))).toContain(
      "QA-SOURCE",
    );
  });
  it("rejects an exact duplicate (280 #3)", () => {
    const q = mcq();
    const r = evaluateIngestionCandidate(q, {
      ...clean(q),
      dedup: { exactDuplicateOf: "SATM1ABC123", nearDuplicateOf: null },
    });
    expect(codes(r)).toContain("QA-DUP-EXACT");
  });
  it("flags (not rejects) a near-duplicate", () => {
    const q = mcq();
    const r = evaluateIngestionCandidate(q, {
      ...clean(q),
      dedup: { exactDuplicateOf: null, nearDuplicateOf: "SATM1ABC123" },
    });
    expect(r.status).toBe("flag");
  });
});

describe("QI-BLOCK-006 — taxonomy enum + passage truncation reject", () => {
  it("rejects a distractor error_taxonomy outside the §18 enum", () => {
    const q = mcq({
      option_metadata: {
        A: { role: "distractor", error_taxonomy: "sign_error" },
        B: { role: "distractor", error_taxonomy: "not_a_real_label" },
        C: { role: "correct", error_taxonomy: null },
        D: { role: "distractor", error_taxonomy: "arithmetic_slip" },
      },
    });
    expect(codes(evaluateIngestionCandidate(q, clean(q)))).toContain(
      "QA-TAXONOMY",
    );
  });
  it("passes valid §18 taxonomy labels", () => {
    const q = mcq({
      option_metadata: {
        A: { role: "distractor", error_taxonomy: "sign_error" },
        B: { role: "distractor", error_taxonomy: "misread_question" },
        C: { role: "correct", error_taxonomy: null },
        D: { role: "distractor", error_taxonomy: "arithmetic_slip" },
      },
    });
    expect(evaluateIngestionCandidate(q, clean(q)).status).toBe("pass");
  });
  it("rejects a truncated RW passage (machine-detected, not advisory)", () => {
    const q = mcq({
      section: "RW",
      domain: "Information and Ideas",
      passage:
        "The committee reviewed the proposal carefully before deciding to",
    });
    expect(codes(evaluateIngestionCandidate(q, clean(q)))).toContain(
      "QA-RW-PASSAGE",
    );
  });
});

describe("HALT-2 + QI-BLOCK-005 — figures: owner-SVG only, sniffed media, faithful", () => {
  const fig = (faithful: boolean): IngestionCandidate =>
    mcq({
      stem: "Using {{asset:fig1}}, find $x$.",
      assets: [
        {
          id: "fig1",
          kind: "svg",
          provenance: "owner-regenerated-svg",
          source_ref: "Math-10 p.1 right-triangle figure",
          faithfulness_verified: faithful,
          uri: "https://storage.example/fig1.svg",
          alt: "a regenerated right triangle",
          sha256: "a".repeat(64),
        },
      ],
    });

  it("flags a figure pending owner-eye faithfulness (HALT-2)", () => {
    const q = fig(false);
    const r = evaluateIngestionCandidate(q, clean(q));
    expect(r.status).toBe("flag");
    expect(codes(r)).toContain("QA-ASSET-FAITHFUL");
  });
  it("passes a faithful, resolved, correctly-sniffed figure", () => {
    const q = fig(true);
    expect(evaluateIngestionCandidate(q, clean(q)).status).toBe("pass");
  });
  it("QI-BLOCK-005: rejects a raster sniffed under an svg label", () => {
    const q = fig(true);
    const r = evaluateIngestionCandidate(q, {
      ...clean(q),
      assetResolution: [
        { id: "fig1", resolved: true, sha256Match: true, mediaTypeOk: false },
      ],
    });
    expect(codes(r)).toContain("QA-ASSET-MEDIA");
  });
  it("rejects a captured CB raster — path (b) is structurally unrepresentable", () => {
    const badRaster = {
      ...mcq(),
      stem: "Using {{asset:fig1}}, find $x$.",
      assets: [
        {
          id: "fig1",
          kind: "image",
          uri: "https://storage.example/cb-crop.png",
          alt: "a cropped CB figure",
          sha256: "a".repeat(64),
        },
      ],
    };
    const r = evaluateIngestionCandidate(badRaster);
    expect(r.status).toBe("reject");
    expect(codes(r)).toContain("QA-SCHEMA");
  });
  it("rejects a dangling {{asset:id}} reference", () => {
    const q = mcq({ stem: "What does {{asset:fig1}} show?", assets: [] });
    expect(codes(evaluateIngestionCandidate(q, clean(q)))).toContain(
      "QA-ASSET-REF",
    );
  });
});

describe("grid-in shape", () => {
  it("rejects a grid-in carrying A/B/C/D options", () => {
    const q = gridIn({
      options: [
        { key: "A", text: "1" },
        { key: "B", text: "2" },
        { key: "C", text: "3" },
        { key: "D", text: "4" },
      ],
    });
    expect(codes(evaluateIngestionCandidate(q, clean(q)))).toContain(
      "QA-GRID-SHAPE",
    );
  });
  it("rejects a grid-in whose correct_answer is not in correct_variants", () => {
    const q = gridIn({ correct_answer: "9" });
    expect(codes(evaluateIngestionCandidate(q, clean(q)))).toContain(
      "QA-GRID-VARIANTS",
    );
  });
});
