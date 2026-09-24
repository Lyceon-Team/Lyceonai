/**
 * The header's projected range — the SUM of Doc 05C's section rows, and nothing else.
 *
 * @spec [Doc 05F §17.1 (header zones); Doc 05C §7 (student_section_projections);
 *        owner ruling 2026-09-24 (Brief 10 Step 4)] | @implemented [2026-09-24]
 *
 * plain English: the calendar shows "680 – 1060 Projected". Those two numbers are the low
 * of Math plus the low of R&W, and the high of Math plus the high of R&W. Expected outcome:
 * the number in the header and the number on the dashboard are the same number, because
 * they are the same rows added the same way.
 *
 * THE WHOLE POINT IS THAT THERE IS NO ARITHMETIC HERE BEYOND `+`. Doc 05C owns the
 * projection: the blend, the Q4 gate, the band width, the mastery term, the full-length
 * weighting. A composite SAT score is the sum of its two section scores, so summing is the
 * ONE operation that composes the two rows without deciding anything. Anything else — a
 * midpoint, a re-derived width, a rounding rule, a clamp to 400..1600 — would be the
 * calendar holding a second opinion about a student's projected score, and the first time
 * the two disagreed the student would see two different numbers for the same thing and
 * have no way to tell which was true. `scripts/ci/calendar-projection-gate.mjs` asserts
 * that this file contains no operator but `+`.
 *
 * NULL IS AN ANSWER, NOT A FAILURE. Doc 05C nulls `projected_score_low/mid/high` TOGETHER
 * below its Q4 gate (INV-05C-14/15) — a student without enough answered questions has no
 * projection yet, which is a true statement about them rather than an error. This returns
 * `null` for that case and the header renders copy. A zero would be a lie (200 is the floor
 * of a real SAT section, so 0 is not a score at all) and a blank would look like a bug.
 *
 * BOTH SECTIONS OR NEITHER. A composite needs Math AND R&W. With one section projected and
 * the other not, the sum would silently read as a whole-test score roughly half what it
 * should be — worse than showing nothing, because it looks plausible. So a missing or
 * un-projected section yields `null`, not a partial sum.
 */
import type { SectionProjectionDto } from "@lyceon/shared";

/** The composite band, or `null` when Doc 05C has not projected both sections yet. */
export type ProjectedRange = { low: number; high: number };

/** The two sections a composite is made of. Not configurable: the SAT has these two. */
const COMPOSITE_SECTIONS = ["M", "RW"] as const;

export function projectedRange(
  sections: readonly SectionProjectionDto[] | undefined,
): ProjectedRange | null {
  if (sections === undefined) return null;

  let low = 0;
  let high = 0;

  for (const wanted of COMPOSITE_SECTIONS) {
    const row = sections.find((s) => s.section === wanted);
    // Absent row, or present but below the Q4 gate. Same answer either way: no composite.
    if (row === undefined) return null;
    if (row.projectedScoreLow === null || row.projectedScoreHigh === null)
      return null;
    low = low + row.projectedScoreLow;
    high = high + row.projectedScoreHigh;
  }

  return { low, high };
}
