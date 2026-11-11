/**
 * The gaps-run apply SQL is what the reviewed files produce, and the generator refuses a
 * control character.
 *
 * @spec [owner brief "apply SQL for the gaps run" (#1447 merged), Karl 2026-11-11]
 *       | @implemented [2026-11-11]
 *
 * plain English:
 *   G1 regenerating from the committed reviewed files gives the committed SQL byte for byte, so
 *      neither file can drift from what Karl reviewed (edit the CSV, regenerate, commit both).
 *   G2 both files carry Karl's id as approver, the library file names none of the 230 existing
 *      rows, and the segment file's guard requires approved videos.
 *   G3 a control character in a reviewed file is refused with its line (2026-11-11: one NUL in
 *      a gaps evidence line would have rolled the whole segment transaction back).
 * The database behaviour (guards, totals, a second run writing nothing) was proven against a
 * local database loaded with the committed production state; see the PR.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GAPS_APPROVER,
  GAPS_PROPOSAL_CSV,
  LIBRARY_SQL,
  SEGMENTS_SQL,
  assertNoControlChars,
  buildGapsApply,
  videoIdsOf,
} from "../../scripts/rag/apply-video-gaps";
import { REVIEW_CSV } from "../../scripts/rag/tag-videos";

describe("gaps-run apply SQL (2026-11-11)", () => {
  const built = buildGapsApply(GAPS_APPROVER);

  it("G1 the committed SQL is the reviewed files' output", () => {
    expect(built.librarySql).toBe(readFileSync(LIBRARY_SQL, "utf8"));
    expect(built.segmentsSql).toBe(readFileSync(SEGMENTS_SQL, "utf8"));
    expect(built.summary).toBe(
      "library: 75 new rows (230 existing untouched); segments: 75 videos, 161 written, 136 approved",
    );
  });

  it("G2 Karl approves; the existing rows are never named; file 2 needs approved videos", () => {
    expect(built.librarySql).toContain(`'${GAPS_APPROVER}'::uuid`);
    expect(built.segmentsSql).toContain(`'${GAPS_APPROVER}'::uuid`);
    // Chunk steps stay parked: no statement touches curriculum_chunks (the header says so).
    for (const sql of [built.librarySql, built.segmentsSql]) {
      const statements = sql
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"));
      expect(statements.some((l) => l.includes("curriculum_chunks"))).toBe(
        false,
      );
    }
    const gaps = videoIdsOf(readFileSync(GAPS_PROPOSAL_CSV, "utf8"));
    const existing = [...videoIdsOf(readFileSync(REVIEW_CSV, "utf8"))].filter(
      (v) => !gaps.has(v),
    );
    expect(existing).toHaveLength(230);
    for (const v of existing) expect(built.librarySql).not.toContain(`'${v}'`);
    expect(built.segmentsSql).toContain(
      "WHERE x.video_id = t.id AND x.approved_by IS NOT NULL",
    );
  });

  it("G3 a control character is refused, naming the line", () => {
    expect(() => assertNoControlChars("a,b\nc,\u0000d\n", "f.csv")).toThrow(
      "f.csv line 2: control character",
    );
    expect(() => assertNoControlChars("a,\tb\r\nc\n", "f.csv")).not.toThrow();
  });
});
