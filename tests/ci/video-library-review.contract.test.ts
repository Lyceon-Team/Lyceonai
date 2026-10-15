/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §4 (tags constrained to the 29
 *       taxonomy names), §5 (review as a CSV; no row approved without approved_by)]
 * @implemented 2026-10-15
 *
 * plain English: what reaches video_resources is the reviewed file, parsed strictly.
 *  - The committed review file itself parses (presence: every video, the tagged count).
 *  - A skill outside the taxonomy, yes on a failed or untagged row, an unknown approve value,
 *    or a start outside the video fails the whole file.
 *  - The tagger's toRow: no chapters → the model's chapter_skills are ignored, not a failure;
 *    an out-of-range chapter with chapters present still fails the row.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseReviewedCsv } from "../../scripts/rag/apply-video-library";
import { REVIEW_CSV, loadTaxonomy, toRow } from "../../scripts/rag/tag-videos";

const { domainOf } = loadTaxonomy();
const REAL = readFileSync(REVIEW_CSV, "utf8");
const [HEADER, ...LINES] = REAL.trimEnd().split("\n");

function withLine(line: string): string {
  return `${HEADER}\n${line}\n`;
}
const TAGGED = LINES.find((l) => l.includes("Slope of Line")) ?? "";

describe("the reviewed file", () => {
  it("the committed review file parses: every video, none approved yet", () => {
    const rows = parseReviewedCsv(REAL, domainOf);
    expect(rows.length).toBe(LINES.length);
    expect(rows.filter((r) => r.skill_codes.length > 0).length).toBeGreaterThan(
      100,
    );
    for (const r of rows) {
      if (r.skill_codes.length > 0) expect(r.domain).not.toBeNull();
    }
  });

  it("yes is honoured, with the domain re-derived from the taxonomy", () => {
    expect(TAGGED).not.toBe("");
    const [row] = parseReviewedCsv(withLine(`yes${TAGGED}`), domainOf);
    expect(row).toMatchObject({
      video_id: "Al-6NAp5O8I",
      approve: true,
      skill_codes: ["Linear Functions"],
      domain: "Algebra",
    });
  });

  it("a skill outside the taxonomy fails the file", () => {
    expect(() =>
      parseReviewedCsv(
        withLine(TAGGED.replace("Linear Functions", "Calculus")),
        domainOf,
      ),
    ).toThrow(/not a taxonomy skill/);
  });

  it("yes on a row with no skills fails the file", () => {
    const untagged = LINES.find((l) =>
      /^,[^,]+,\d,[^,]*,[^,]*,[^,]*,[\d:]+,,/.test(l),
    );
    expect(untagged).toBeDefined();
    expect(() =>
      parseReviewedCsv(withLine(`yes${untagged ?? ""}`), domainOf),
    ).toThrow(/no skills/);
  });

  it("an approve value other than yes or blank fails the file", () => {
    expect(() => parseReviewedCsv(withLine(`y${TAGGED}`), domainOf)).toThrow(
      /approve must be/,
    );
  });

  it("a start outside the video fails the file", () => {
    const cells = TAGGED.split(",");
    cells[cells.length - 1] = "999";
    expect(() => parseReviewedCsv(withLine(cells.join(",")), domainOf)).toThrow(
      /outside the video/,
    );
  });
});

describe("toRow chapters", () => {
  const video = {
    video_id: "o8mfb_2bQ50",
    title: "t",
    channel_name: "c",
    duration_seconds: 600,
    description: "",
    chapters: [] as {
      title: string;
      start_seconds: number;
      end_seconds: number;
    }[],
    tier: 2,
    source_label: "s",
  };
  it("no chapters: chapter_skills are ignored, the row is kept", () => {
    const row = toRow(
      video,
      {
        skill_codes: ["Circles"],
        chapter_skills: [{ chapter: 0, skill: "Circles" }],
        reason: "r",
      },
      domainOf,
    );
    expect(row.error).toBeNull();
    expect(row.skill_codes).toEqual(["Circles"]);
    expect(row.start_seconds).toBeNull();
  });

  it("with chapters: an out-of-range index still fails the row; a valid one gives the start", () => {
    const chaptered = {
      ...video,
      chapters: [
        { title: "intro", start_seconds: 0, end_seconds: 30 },
        { title: "circles", start_seconds: 30, end_seconds: 600 },
      ],
    };
    expect(
      toRow(
        chaptered,
        {
          skill_codes: ["Circles"],
          chapter_skills: [{ chapter: 2, skill: "Circles" }],
          reason: "r",
        },
        domainOf,
      ).error,
    ).toMatch(/out of range/);
    expect(
      toRow(
        chaptered,
        {
          skill_codes: ["Circles"],
          chapter_skills: [
            { chapter: 0, skill: null },
            { chapter: 1, skill: "Circles" },
          ],
          reason: "r",
        },
        domainOf,
      ).start_seconds,
    ).toBe(30);
  });
});
