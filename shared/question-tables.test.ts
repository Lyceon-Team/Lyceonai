/**
 * The table finder, over the real content and the shapes that must NOT become tables.
 *
 * @spec [owner brief 2026-11-04 (approach A: detect table blocks, leave everything else alone);
 *        owner note: "Table detection must split on \r?\n and treat a trailing \r on a cell as
 *        whitespace"] | @implemented [2026-11-04]
 *
 * plain English: the fixture is SATM2K9CGMN's stem, taken verbatim from
 * `infra/supabase/seed/proving_batch_004.sql:73`, at both line endings — because the seed is LF
 * and all 23 published rows are CRLF (owner's production read, 2026-11-04), so BOTH have to
 * parse the same or the fix works in the repo and not in production.
 *
 * THE NEGATIVE CASES ARE THE POINT. This is not a markdown parser, and a test that only proves
 * tables become tables would pass just as well for one that turned the whole bank into markdown.
 */
import { describe, expect, it } from "vitest";
import {
  hasTableBlock,
  splitRow,
  splitTableBlocks,
} from "./question-tables";

/** SATM2K9CGMN, verbatim from the seed. */
const STEM_LF = [
  "The linear function $g$ is defined for all real numbers. The table below shows selected values of $g$.",
  "",
  "| $x$ | $g(x)$ |",
  "|---|---|",
  "| $-2$ | $11$ |",
  "| $1$ | $5$ |",
  "| $4$ | $-1$ |",
  "",
  "For what value of $x$ does $g(x) = 0$?",
].join("\n");
const STEM_CRLF = STEM_LF.replace(/\n/g, "\r\n");

describe("the real stem, at both line endings", () => {
  for (const [label, stem] of [
    ["LF (the seed)", STEM_LF],
    ["CRLF (every published row)", STEM_CRLF],
  ] as const) {
    it(`finds one table with its cells — ${label}`, () => {
      const segments = splitTableBlocks(stem);
      const tables = segments.filter((s) => s.kind === "table");
      expect(tables).toHaveLength(1);
      const t = tables[0]!;
      if (t.kind !== "table") throw new Error("unreachable");

      // The cells carry the MATH SOURCE, for the renderer to tokenize as it always has.
      expect(t.header).toEqual(["$x$", "$g(x)$"]);
      expect(t.rows).toEqual([
        ["$-2$", "$11$"],
        ["$1$", "$5$"],
        ["$4$", "$-1$"],
      ]);
      // No cell keeps a carriage return: a trailing \r is whitespace, so CRLF and LF agree.
      for (const cell of [...t.header, ...t.rows.flat()]) {
        expect(cell).not.toMatch(/[\r\n]/);
      }
    });

    it(`covers the whole string, in order, losing nothing — ${label}`, () => {
      const segments = splitTableBlocks(stem);
      // Every character is accounted for exactly once: the prose before and after the table is
      // still handed to the renderer's existing path, which is what "unchanged" has to mean.
      expect(segments[0]!.start).toBe(0);
      expect(segments[segments.length - 1]!.end).toBe(stem.length);
      for (let i = 1; i < segments.length; i += 1) {
        expect(segments[i]!.start).toBe(segments[i - 1]!.end);
      }
      const text = segments
        .filter((s) => s.kind === "text")
        .map((s) => stem.slice(s.start, s.end))
        .join("");
      expect(text).toContain("The linear function");
      expect(text).toContain("For what value of");
      expect(text).not.toContain("|");
    });
  }

  it("parses CRLF and LF to the same cells", () => {
    const lf = splitTableBlocks(STEM_LF).filter((s) => s.kind === "table");
    const crlf = splitTableBlocks(STEM_CRLF).filter((s) => s.kind === "table");
    expect(JSON.stringify(crlf.map((t) => (t.kind === "table" ? [t.header, t.rows] : null))))
      .toBe(JSON.stringify(lf.map((t) => (t.kind === "table" ? [t.header, t.rows] : null))));
  });
});

describe("what is NOT a table", () => {
  const notTables: ReadonlyArray<readonly [string, string]> = [
    ["ordinary prose", "If $x | y$ then $y$ divides $x$."],
    [
      "absolute value, which really does use pipes",
      "Solve $|x - 3| = 7$ for $x$.",
    ],
    [
      "a pipe line with no delimiter row under it",
      "| a | b |\nand then some prose",
    ],
    [
      "a delimiter row whose cell count disagrees with the header (GFM says no)",
      "| a | b |\n|---|---|---|\n| 1 | 2 |",
    ],
    ["emphasis and headings stay literal", "# Heading\n*not emphasis* _nor this_"],
    ["an empty string", ""],
  ];

  for (const [label, content] of notTables) {
    it(`leaves it alone: ${label}`, () => {
      expect(hasTableBlock(content)).toBe(false);
      const segments = splitTableBlocks(content);
      expect(segments.every((s) => s.kind === "text")).toBe(true);
      // and the text segments still cover the input exactly
      const joined = segments.map((s) => content.slice(s.start, s.end)).join("");
      expect(joined).toBe(content);
    });
  }
});

describe("cell splitting", () => {
  it("drops the outer pipes and trims", () => {
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
  });

  it("an escaped pipe is content, not a boundary", () => {
    expect(splitRow("| $a \\| b$ | c |")).toEqual(["$a | b$", "c"]);
  });

  it("a trailing carriage return trims away", () => {
    expect(splitRow("| a | b |\r")).toEqual(["a", "b"]);
  });
});

describe("alignment and ragged rows", () => {
  it("reads the delimiter row's colons", () => {
    const t = splitTableBlocks("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |")[0]!;
    if (t.kind !== "table") throw new Error("expected a table");
    expect(t.align).toEqual(["left", "center", "right"]);
  });

  it("pads a short row and truncates a long one (GFM)", () => {
    const t = splitTableBlocks("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |")[0]!;
    if (t.kind !== "table") throw new Error("expected a table");
    expect(t.rows).toEqual([["1", ""], ["1", "2"]]);
  });
});
