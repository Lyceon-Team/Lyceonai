/**
 * The header's range IS the sum of Doc 05C's section rows.
 *
 * @spec [Doc 05F §17.1; Doc 05C §7] | @implemented [2026-09-24]
 *
 * The fixture is the prototype's own data — `docs/design/calendar-prototype.html` declares
 * `PROJECTION={M:{mid:470,lo:380,hi:560},RW:{mid:400,lo:300,hi:500}}` and renders
 * `680 – 1060`. Using the same numbers means this test and the visual contract cannot
 * disagree about what composition means; if someone changes one, the other says so.
 */
import { describe, expect, it } from "vitest";
import type { SectionProjectionDto } from "@lyceon/shared";
import { projectedRange } from "./projection";

function row(
  section: "M" | "RW",
  low: number | null,
  mid: number | null,
  high: number | null,
): SectionProjectionDto {
  return {
    section,
    projectedScoreLow: low,
    projectedScoreMid: mid,
    projectedScoreHigh: high,
    relevantQuestionCount: 40,
    computedAt: "2026-09-24T00:00:00Z",
  };
}

/** The prototype's fixture, verbatim. */
const PROTOTYPE = [row("M", 380, 470, 560), row("RW", 300, 400, 500)];

describe("projectedRange — the composite is the sum of the sections", () => {
  it("sums the prototype's own rows to the prototype's own range", () => {
    expect(projectedRange(PROTOTYPE)).toEqual({ low: 680, high: 1060 });
  });

  it("is the sum and nothing else — asserted against the addends, not a literal", () => {
    const result = projectedRange(PROTOTYPE);
    // Restating the arithmetic from the fixture rather than repeating `680` means a change
    // to the composition rule fails here even if someone updates the expected literal.
    expect(result?.low).toBe(380 + 300);
    expect(result?.high).toBe(560 + 500);
  });

  it("does not care what order the sections arrive in", () => {
    const reversed = [PROTOTYPE[1]!, PROTOTYPE[0]!];
    expect(projectedRange(reversed)).toEqual(projectedRange(PROTOTYPE));
  });

  it("ignores the mid entirely — the header shows a band, never a midpoint", () => {
    const noMid = [row("M", 380, null, 560), row("RW", 300, null, 500)];
    expect(projectedRange(noMid)).toEqual({ low: 680, high: 1060 });
  });

  // ── The absences. Each returns null so the header renders copy. ──────────

  it("no projection at all -> null, so the header can say so", () => {
    expect(projectedRange([])).toBeNull();
    expect(projectedRange(undefined)).toBeNull();
  });

  it("below Doc 05C's Q4 gate (low/high null together) -> null", () => {
    expect(
      projectedRange([row("M", null, null, null), row("RW", null, null, null)]),
    ).toBeNull();
  });

  it("ONE section projected -> null, never half a composite", () => {
    // The trap this exists for: 380 + 0 = 380 would render as a whole-test projection of
    // 380, which is plausible enough that nobody would question it, and wrong.
    const mathOnly = [row("M", 380, 470, 560), row("RW", null, null, null)];
    expect(projectedRange(mathOnly)).toBeNull();
  });

  it("a section row missing altogether -> null", () => {
    expect(projectedRange([row("M", 380, 470, 560)])).toBeNull();
  });
});
