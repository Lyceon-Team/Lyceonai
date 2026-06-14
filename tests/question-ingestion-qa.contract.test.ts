/**
 * Contract tests — Question Ingestion QA validator + grid-in normalizer.
 *
 * @spec [Doc-02A_V6 §23 + 280-discard taxonomy] | @spec [Doc-04A §7.3.1 / 04B SPR]
 * plain English: proves the moat rejects the 280-class defects and that the grid-in
 * normalizer matches College Board's published equivalence (1/5 = .2 = 0.20), not an
 * invented one. These assertions are the falsifiable core a Codex audit re-runs.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateIngestionCandidate,
  parseGridInValue,
  gridInEquivalent,
  normalizeGridInKey,
  type IngestionCandidate,
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
    correct_variants: ["0.2", ".2", "1/5"],
    explanation:
      "Since x = 40, 8/x = 8/40 = 1/5 = 0.2. Both 1/5 and .2 are accepted.",
    source_lineage: lineage,
    ...overrides,
  };
}

describe("grid-in normalizer (CB SPR equivalence, not invented)", () => {
  it("treats 1/5, .2, 0.2, 0.20 as the same value", () => {
    expect(gridInEquivalent("1/5", ".2")).toBe(true);
    expect(gridInEquivalent("0.2", "0.20")).toBe(true);
    expect(gridInEquivalent("1/5", "0.20")).toBe(true);
  });

  it("parses integers, signed decimals, and fractions; reduces fractions", () => {
    expect(parseGridInValue("-7/4")).toEqual({ num: -7n, den: 4n });
    expect(parseGridInValue("2/4")).toEqual({ num: 1n, den: 2n });
    expect(parseGridInValue("3")).toEqual({ num: 3n, den: 1n });
    expect(parseGridInValue(".5")).toEqual({ num: 1n, den: 2n });
  });

  it("rejects mixed numbers, percents, separators, and divide-by-zero", () => {
    expect(parseGridInValue("3 1/2")).toBeNull();
    expect(parseGridInValue("20%")).toBeNull();
    expect(parseGridInValue("1,000")).toBeNull();
    expect(parseGridInValue("5/0")).toBeNull();
    expect(parseGridInValue("")).toBeNull();
  });

  it("normalizeGridInKey accepts a consistent set and rejects an inconsistent one", () => {
    expect(normalizeGridInKey(["0.2", "1/5"]).ok).toBe(true);
    const bad = normalizeGridInKey(["0.2", "1/4"]);
    expect(bad.ok).toBe(false);
  });
});

describe("ingestion QA verdict", () => {
  it("passes a clean MCQ", () => {
    expect(evaluateIngestionCandidate(mcq()).status).toBe("pass");
  });

  it("passes a clean grid-in", () => {
    expect(evaluateIngestionCandidate(gridIn()).status).toBe("pass");
  });

  it("rejects duplicate option texts (280 #1)", () => {
    const r = evaluateIngestionCandidate(
      mcq({
        options: [
          { key: "A", text: "$-6$" },
          { key: "B", text: "$-6$" },
          { key: "C", text: "$-22$" },
          { key: "D", text: "$-1$" },
        ],
      }),
    );
    expect(r.status).toBe("reject");
    expect(r.reasons.map((x) => x.code)).toContain("QA-OPT-DUP");
  });

  it("rejects a wrong section code like 'MATH'-only nonsense (280 #6)", () => {
    const r = evaluateIngestionCandidate(mcq({ section: "GEOMETRY" }));
    expect(r.status).toBe("reject");
    expect(r.reasons.map((x) => x.code)).toContain("QA-SECTION");
  });

  it("rejects non-official source_type for this wave (280 #7)", () => {
    const r = evaluateIngestionCandidate(mcq({ source_type: 2 }));
    expect(r.reasons.map((x) => x.code)).toContain("QA-SOURCE");
  });

  it("rejects an RW item with a missing passage (280 #5)", () => {
    const r = evaluateIngestionCandidate(
      mcq({ section: "RW", passage: null, domain: "Information and Ideas" }),
    );
    expect(r.reasons.map((x) => x.code)).toContain("QA-RW-PASSAGE");
  });

  it("rejects a grid-in that carries A/B/C/D options", () => {
    const r = evaluateIngestionCandidate(
      gridIn({
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
          { key: "C", text: "3" },
          { key: "D", text: "4" },
        ],
      }),
    );
    expect(r.reasons.map((x) => x.code)).toContain("QA-GRID-SHAPE");
  });

  it("rejects a grid-in whose correct_answer is not among correct_variants", () => {
    const r = evaluateIngestionCandidate(gridIn({ correct_answer: "9" }));
    expect(r.reasons.map((x) => x.code)).toContain("QA-GRID-VARIANTS");
  });

  it("rejects a dangling {{asset:id}} reference", () => {
    const r = evaluateIngestionCandidate(
      mcq({ stem: "What does the figure {{asset:fig1}} show?", assets: [] }),
    );
    expect(r.reasons.map((x) => x.code)).toContain("QA-ASSET-REF");
  });

  it("rejects on an injected exact-duplicate probe result (280 #3)", () => {
    const r = evaluateIngestionCandidate(mcq(), {
      exactDuplicateOf: "SATM1ABC123",
    });
    expect(r.reasons.map((x) => x.code)).toContain("QA-DUP-EXACT");
  });

  it("flags (not rejects) on an injected near-duplicate probe result", () => {
    const r = evaluateIngestionCandidate(mcq(), {
      nearDuplicateOf: "SATM1ABC123",
    });
    expect(r.status).toBe("flag");
  });

  it("rejects on KaTeX-strict failure folded in via context", () => {
    const r = evaluateIngestionCandidate(mcq(), {
      mathRender: [{ span: "4x - 28 = -24", ok: false }],
    });
    expect(r.reasons.map((x) => x.code)).toContain("QA-MATH-RENDER");
  });

  it("emits advisory (never silent pass) when IO probes have not run", () => {
    const r = evaluateIngestionCandidate(
      mcq({
        stem: "See {{asset:fig1}} for $x$.",
        assets: [
          {
            id: "fig1",
            kind: "svg",
            provenance: "owner-regenerated-svg",
            source_ref: "Math-10 p.1 right-triangle figure",
            faithfulness_verified: true,
            uri: "https://storage.example/fig1.svg",
            alt: "a regenerated right triangle",
            sha256: "a".repeat(64),
          },
        ],
      }),
    );
    expect(r.status).toBe("pass");
    expect(r.advisory_flags.join(" ")).toMatch(
      /QA-ASSET-RESOLVE|QA-MATH-RENDER/,
    );
  });

  // HALT-2: figures are owner-regenerated SVGs (path a), owner-eye-verified.
  it("flags a figure-bearing item pending owner-eye faithfulness (HALT-2)", () => {
    const r = evaluateIngestionCandidate(
      mcq({
        stem: "Using {{asset:fig1}}, find $x$.",
        assets: [
          {
            id: "fig1",
            kind: "svg",
            provenance: "owner-regenerated-svg",
            source_ref: "Math-10 p.1 right-triangle figure",
            faithfulness_verified: false,
            uri: "https://storage.example/fig1.svg",
            alt: "a regenerated right triangle",
            sha256: "a".repeat(64),
          },
        ],
      }),
    );
    expect(r.status).toBe("flag");
    expect(r.reasons.map((x) => x.code)).toContain("QA-ASSET-FAITHFUL");
  });

  it("rejects a captured CB raster — path (b) is structurally unrepresentable (HALT-2)", () => {
    // kind 'image' has no schema; capturing CB artwork cannot even be expressed.
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
    expect(r.reasons.map((x) => x.code)).toContain("QA-SCHEMA");
  });
});
