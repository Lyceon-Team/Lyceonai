/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §4 (tags constrained to the 29
 *       taxonomy names), §5 (review as a CSV; no row approved without approved_by)]
 * @implemented 2026-10-15
 *
 * @spec [Doc-03D_V1.2 §6.7 as amended (methods); owner brief "Video retrieval: method tags",
 *       Karl 2026-10-27] | @implemented [2026-10-27]
 *
 * plain English: what reaches video_resources is the reviewed file, parsed strictly.
 *  - Methods and format: a value outside VIDEO_METHODS / VIDEO_FORMATS fails the file, and so
 *    does yes on a row with no format; the committed file's 150 approved rows (85, plus 65
 *    from the 2026-10-27 expansion proposal) all carry a format, and the Desmos lessons carry
 *    `desmos`.
 *  - The methods pass's pure parts: the watch clip is the landing chapter (or the opening 20
 *    minutes); two watch runs keep only the methods both saw, and disagreeing formats fail.
 *  - apply-video-library.ts's entry check works on Windows (pathToFileURL, not `file://` +
 *    argv[1]).
 *  - The committed review file itself parses (presence: every video, the tagged count).
 *  - A skill outside the taxonomy, yes on a failed or untagged row, an unknown approve value,
 *    or a start outside the video fails the whole file.
 *  - The tagger's toRow: no chapters → the model's chapter_skills are ignored, not a failure;
 *    an out-of-range chapter with chapters present still fails the row.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReviewedCsv } from "../../scripts/rag/apply-video-library";
import { parseCsv } from "../../scripts/reference-data/import-reference-data";
import {
  REVIEW_CSV,
  WATCH_CAP_SECONDS,
  combineWatchRuns,
  loadTaxonomy,
  toRow,
  watchClip,
} from "../../scripts/rag/tag-videos";

const { domainOf } = loadTaxonomy();
const REAL = readFileSync(REVIEW_CSV, "utf8");
const [HEADER, ...LINES] = REAL.trimEnd().split("\n");

function withLine(line: string): string {
  return `${HEADER}\n${line}\n`;
}
const TAGGED = LINES.find((l) => l.includes("Slope of Line")) ?? "";
const COLS = (HEADER ?? "").split(",");
/** A data line with one named cell replaced, parsed and re-serialised as CSV. */
function setCell(line: string, name: string, value: string): string {
  const cells = parseCsv(`${line}\n`)[0] ?? [];
  cells[COLS.indexOf(name)] = value;
  return cells
    .map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
    .join(",");
}
const DESMOS_LESSON = LINES.find((l) => l.startsWith("yes,a1QNaRnn6cE,")) ?? "";

describe("the reviewed file", () => {
  it("the committed review file parses: every video; the approved rows carry methods and a format", () => {
    const rows = parseReviewedCsv(REAL, domainOf);
    expect(rows.length).toBe(LINES.length);
    const approved = rows.filter((r) => r.approve);
    expect(approved.length).toBe(150);
    expect(approved.every((r) => r.format !== null)).toBe(true);
    expect(approved.filter((r) => r.methods.includes("desmos")).length).toBe(
      30,
    );
    expect(
      rows.filter((r) => !r.approve).every((r) => r.methods.length === 0),
    ).toBe(true);
    expect(rows.find((r) => r.video_id === "a1QNaRnn6cE")).toMatchObject({
      methods: ["desmos"],
      format: "lesson",
      skill_codes: ["Equivalent Expressions"],
    });
    expect(rows.filter((r) => r.skill_codes.length > 0).length).toBeGreaterThan(
      100,
    );
    for (const r of rows) {
      if (r.skill_codes.length > 0) expect(r.domain).not.toBeNull();
    }
  });

  it("yes is honoured, with the domain re-derived from the taxonomy", () => {
    expect(TAGGED).not.toBe("");
    const [row] = parseReviewedCsv(
      withLine(`yes${setCell(TAGGED, "format", "formula")}`),
      domainOf,
    );
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
    expect(() =>
      parseReviewedCsv(withLine(setCell(TAGGED, "start_s", "999")), domainOf),
    ).toThrow(/outside the video/);
  });

  it("a method outside the vocabulary fails the file", () => {
    expect(DESMOS_LESSON).not.toBe("");
    expect(() =>
      parseReviewedCsv(
        withLine(setCell(DESMOS_LESSON, "methods", "calculator")),
        domainOf,
      ),
    ).toThrow(/not a video method/);
    expect(() =>
      parseReviewedCsv(
        withLine(setCell(DESMOS_LESSON, "methods", "Desmos")),
        domainOf,
      ),
    ).toThrow(/not a video method/);
  });

  it("a format outside the vocabulary fails the file; yes with no format fails it", () => {
    expect(() =>
      parseReviewedCsv(
        withLine(setCell(DESMOS_LESSON, "format", "tips")),
        domainOf,
      ),
    ).toThrow(/not a video format/);
    expect(() =>
      parseReviewedCsv(
        withLine(setCell(DESMOS_LESSON, "format", "")),
        domainOf,
      ),
    ).toThrow(/no format/);
  });

  it("several methods are read in order, de-duplicated", () => {
    const [row] = parseReviewedCsv(
      withLine(setCell(DESMOS_LESSON, "methods", "desmos; backsolve; desmos")),
      domainOf,
    );
    expect(row?.methods).toEqual(["desmos", "backsolve"]);
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

describe("the methods pass", () => {
  it("watches the landing chapter, or the opening 20 minutes", () => {
    expect(watchClip(2018, 751, [0, 60, 212, 368, 639, 751, 1385])).toEqual({
      start: 751,
      end: 1385,
    });
    expect(watchClip(1187, null, [])).toEqual({ start: 0, end: 1187 });
    expect(watchClip(8481, null, [])).toEqual({
      start: 0,
      end: WATCH_CAP_SECONDS,
    });
    expect(watchClip(8481, 57, [0, 57])).toEqual({
      start: 57,
      end: 57 + WATCH_CAP_SECONDS,
    });
  });

  it("two watch runs keep only the methods both saw; different formats fail", () => {
    const a = {
      methods: [
        { method: "algebraic", evidence: "solves by hand" },
        { method: "backsolve", evidence: "plugs in 100" },
      ],
      format: "lesson" as const,
      format_evidence: "teaches a setup",
    };
    const b = {
      ...a,
      methods: [{ method: "backsolve", evidence: "tests choices" }],
    };
    expect(combineWatchRuns(a, b)).toEqual({
      methods: ["backsolve"],
      format: "lesson",
      evidence: "backsolve: plugs in 100 | format lesson: teaches a setup",
      source: "video",
    });
    expect(() => combineWatchRuns(a, { ...b, format: "strategy" })).toThrow(
      /disagree on format/,
    );
  });
});

describe("apply-video-library.ts runs on Windows", () => {
  it("its entry check compares with pathToFileURL, not file:// + argv[1]", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "../../scripts/rag/apply-video-library.ts"),
      "utf8",
    );
    expect(src).not.toContain("`file://${process.argv[1]}`");
    expect(src).toContain("pathToFileURL(process.argv[1]).href");
  });
});
