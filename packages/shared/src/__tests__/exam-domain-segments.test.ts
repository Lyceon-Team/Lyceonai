/**
 * @spec [Doc-04C §8.1/§9.1; SCL-180 (amended 2026-09-29), owner ruling 7] | @implemented [2026-09-29]
 *
 * plain English: pins `segmentsFilled` = round_half_up(correct × 7 / total) clamped to
 * 0..7 — 0, 7, every rounding boundary, and an exhaustive check against exact rational
 * comparison for every total 1..60 and correct 0..total — and pins `toDomainSegments`'s
 * omission rules (total = 0, unscored section) and its output keys (no correct/total).
 */
import { describe, expect, it } from "vitest";
import {
  DOMAIN_SEGMENT_COUNT,
  examDomainSegmentRowSchema,
  segmentsFilled,
  toDomainSegments,
  type DomainCountRow,
} from "../exam-domain-segments";

/**
 * The reference: the unique n in 0..7 with n - 1/2 <= 7c/t < n + 1/2, decided in exact
 * integers ((2n-1)t <= 14c < (2n+1)t), independent of the implementation's formula.
 */
function exactRoundHalfUp(correct: number, total: number): number {
  for (let n = 0; n <= DOMAIN_SEGMENT_COUNT; n++) {
    if (
      (2 * n - 1) * total <= 14 * correct &&
      14 * correct < (2 * n + 1) * total
    ) {
      return n;
    }
  }
  throw new Error(`no n for ${correct}/${total}`);
}

describe("segmentsFilled (owner ruling 7)", () => {
  it("0 correct is 0 segments, all correct is 7", () => {
    for (const total of [1, 7, 13, 21, 27]) {
      expect(segmentsFilled(0, total)).toBe(0);
      expect(segmentsFilled(total, total)).toBe(7);
    }
  });

  it("exact halves round UP (round_half_up, not banker's or float)", () => {
    expect(segmentsFilled(1, 14)).toBe(1); // 0.5
    expect(segmentsFilled(3, 14)).toBe(2); // 1.5
    expect(segmentsFilled(5, 14)).toBe(3); // 2.5
    expect(segmentsFilled(1, 2)).toBe(4); // 3.5
    expect(segmentsFilled(13, 14)).toBe(7); // 6.5
    expect(segmentsFilled(9, 14)).toBe(5); // 4.5
  });

  it("every rounding boundary for every total 1..60: the first correct at or past k + 1/2 fills more than k, the one before it at most k", () => {
    let checked = 0;
    for (let total = 1; total <= 60; total++) {
      for (let k = 0; k < DOMAIN_SEGMENT_COUNT; k++) {
        // smallest c with 7c/t >= k + 1/2  <=>  14c >= (2k + 1)t
        const cMin = Math.ceil(((2 * k + 1) * total) / 14);
        if (cMin > total) continue;
        expect(
          segmentsFilled(cMin, total),
          `${cMin}/${total}`,
        ).toBeGreaterThanOrEqual(k + 1);
        if (cMin - 1 >= 0) {
          expect(
            segmentsFilled(cMin - 1, total),
            `${cMin - 1}/${total}`,
          ).toBeLessThanOrEqual(k);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("exhaustive: equals exact round_half_up(7c/t) for every total 1..60 and correct 0..total", () => {
    let cases = 0;
    const mismatches: string[] = [];
    for (let total = 1; total <= 60; total++) {
      for (let correct = 0; correct <= total; correct++) {
        const got = segmentsFilled(correct, total);
        const want = exactRoundHalfUp(correct, total);
        if (got !== want)
          mismatches.push(`${correct}/${total}: ${got} != ${want}`);
        cases++;
      }
    }
    expect(cases).toBe(1890); // sum_{t=1}^{60} (t + 1)
    expect(mismatches).toEqual([]);
  });

  it("clamps to 0..7", () => {
    expect(segmentsFilled(20, 13)).toBe(7);
    expect(segmentsFilled(-3, 13)).toBe(0);
  });

  it("total = 0 is not a segment count: it throws (the caller omits the domain)", () => {
    expect(() => segmentsFilled(0, 0)).toThrow(RangeError);
    expect(() => segmentsFilled(1.5, 3)).toThrow(RangeError);
  });
});

const FULL: ReadonlyArray<DomainCountRow> = [
  { section: "RW", domain: "Craft and Structure", correct: 10, total: 13 },
  { section: "RW", domain: "Expression of Ideas", correct: 6, total: 8 },
  { section: "RW", domain: "Information and Ideas", correct: 9, total: 12 },
  {
    section: "RW",
    domain: "Standard English Conventions",
    correct: 11,
    total: 21,
  },
  { section: "M", domain: "Advanced Math", correct: 12, total: 15 },
  { section: "M", domain: "Algebra", correct: 11, total: 13 },
  { section: "M", domain: "Geometry and Trigonometry", correct: 4, total: 7 },
  {
    section: "M",
    domain: "Problem Solving and Data Analysis",
    correct: 5,
    total: 9,
  },
];

describe("toDomainSegments", () => {
  it("scored: eight rows, canonical order, segments only — no correct, no total", () => {
    const out = toDomainSegments(FULL, ["RW", "M"]);
    expect(out.omitted_domains).toEqual([]);
    expect(out.domain_segments).toHaveLength(8);
    expect(
      out.domain_segments.map((r) => [r.domain, r.segments_filled]),
    ).toEqual([
      ["Information and Ideas", 5], // 63/12 = 5.25
      ["Craft and Structure", 5], // 70/13 = 5.38
      ["Expression of Ideas", 5], // 42/8 = 5.25
      ["Standard English Conventions", 4], // 77/21 = 3.67
      ["Algebra", 6], // 77/13 = 5.92
      ["Advanced Math", 6], // 84/15 = 5.6
      ["Problem Solving and Data Analysis", 4], // 35/9 = 3.89
      ["Geometry and Trigonometry", 4], // 28/7 = 4
    ]);
    for (const row of out.domain_segments) {
      expect(Object.keys(row).sort()).toEqual([
        "domain",
        "section",
        "segments_filled",
      ]);
      examDomainSegmentRowSchema.parse(row);
    }
  });

  it("total = 0 is omitted with reason no_items_served, never drawn as 0 segments", () => {
    const rows = FULL.map((r) =>
      r.domain === "Algebra" ? { ...r, correct: 0, total: 0 } : r,
    );
    const out = toDomainSegments(rows, ["RW", "M"]);
    expect(out.domain_segments.map((r) => r.domain)).not.toContain("Algebra");
    expect(out.domain_segments).toHaveLength(7);
    expect(out.omitted_domains).toEqual([
      { section: "M", domain: "Algebra", reason: "no_items_served" },
    ]);
  });

  it("partial: the unscored section's four domains are omitted as section_not_scored", () => {
    const out = toDomainSegments(
      FULL.filter((r) => r.section === "RW"),
      ["RW"],
    );
    expect(out.domain_segments.map((r) => r.section)).toEqual([
      "RW",
      "RW",
      "RW",
      "RW",
    ]);
    expect(out.omitted_domains).toEqual([
      { section: "M", domain: "Algebra", reason: "section_not_scored" },
      { section: "M", domain: "Advanced Math", reason: "section_not_scored" },
      {
        section: "M",
        domain: "Problem Solving and Data Analysis",
        reason: "section_not_scored",
      },
      {
        section: "M",
        domain: "Geometry and Trigonometry",
        reason: "section_not_scored",
      },
    ]);
  });

  it("the strict row schema refuses a correct or total key", () => {
    const row = { section: "M", domain: "Algebra", segments_filled: 6 };
    expect(examDomainSegmentRowSchema.safeParse(row).success).toBe(true);
    expect(
      examDomainSegmentRowSchema.safeParse({ ...row, correct: 11 }).success,
    ).toBe(false);
    expect(
      examDomainSegmentRowSchema.safeParse({ ...row, total: 13 }).success,
    ).toBe(false);
    expect(
      examDomainSegmentRowSchema.safeParse({ ...row, segments_filled: 8 })
        .success,
    ).toBe(false);
  });
});
