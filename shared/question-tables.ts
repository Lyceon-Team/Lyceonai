/**
 * The ONE GFM-table finder: splits question content into text and table blocks.
 *
 * @spec [owner brief 2026-11-04 ("Detect GFM table blocks, split the content into text, table
 *        and text, render the text exactly as today, and build a real <table> ... Implement it
 *        once in shared code so both MathRenderer and StaticMath use it. No markdown parsing
 *        for non-table content, no innerHTML, no new dependencies.");
 *        live defect: SATM2K9CGMN's stem drew `| $x$ |` as a modulus bar]
 * | @implemented [2026-11-04]
 *
 * plain English: finds the markdown tables in a stem or passage and reports where they are,
 * as cell text. Expected outcome: a renderer can draw a real table for those ranges and leave
 * every other character on the path it is on today, so the ~thousands of questions without a
 * table render byte-identically.
 *
 * IT PARSES TABLES AND NOTHING ELSE. This is deliberately NOT a markdown parser. `*`, `_`, `#`,
 * `[]()` and every other markdown construct stay literal text, because the question bank is
 * written in LaTeX and plain prose and has never been markdown: turning `*` into emphasis across
 * the corpus would be a far larger change than the one being asked for. A line only joins a
 * table when it sits in a block whose second line is a GFM delimiter row.
 *
 * PURE: no DOM, no React, no IO — the same reason `shared/math/tokenize.ts` lives beside it.
 * `MathRenderer` (client) and `StaticMath` (prerender) both consume this, so the two cannot
 * disagree about where a table starts.
 *
 * LINE ENDINGS. Lines are split on `\r?\n` and a surviving `\r` is whitespace when a cell is
 * trimmed, so CRLF and LF content parse identically. The trim is where that actually happens:
 * the line-level `\r` strip below only keeps the reported offsets tidy, and a mutation of it
 * stays green (checked, 2026-11-04) precisely because `trim()` has already done the work. That is not a nicety: every one of the 23
 * published table questions carries CRLF in the stem or passage (owner's read-only production
 * query, 2026-11-04) while the seed corpus is entirely LF. Content is never edited to fix this;
 * the ingestion path that introduces it is tracked separately.
 *
 * edge cases:
 *   - `\|` inside a cell is an escaped pipe, not a cell boundary (GFM), and reaches the renderer
 *     as a literal `|`.
 *   - A row with more cells than the header is truncated and one with fewer is padded, which is
 *     what GFM says and what keeps a ragged row from losing its columns' alignment.
 *   - A header whose cell count does not match the delimiter row is NOT a table (GFM), so it
 *     stays text and renders exactly as it does today rather than becoming a broken table.
 */

/**
 * Line endings, normalised once, before anything looks at the content.
 *
 * @spec [owner note 2026-11-04: "Table detection must split on \r?\n and treat a trailing \r
 *        on a cell as whitespace"] | @implemented [2026-11-04]
 *
 * plain English: every published table row stores CRLF while the seed stores LF (owner's
 * read-only production query, 2026-11-04), and the question stem is rendered with
 * `white-space: pre-wrap`, where a carriage return is a segment break of its own. Normalising
 * first means the two corpora render identically and a stray CR can never show up as an extra
 * blank line. The content in the database is NOT edited; this is the rendering layer.
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export type TableAlignment = "left" | "center" | "right" | null;

export type ContentSegment =
  /** A run of ordinary content: the renderer puts it through its existing path, unchanged. */
  | { readonly kind: "text"; readonly start: number; readonly end: number }
  | {
      readonly kind: "table";
      readonly start: number;
      readonly end: number;
      readonly header: readonly string[];
      readonly align: readonly TableAlignment[];
      readonly rows: readonly (readonly string[])[];
    };

/** A delimiter cell: optional colons around one or more dashes. */
const DELIMITER_CELL = /^:?-+:?$/;

function alignmentOf(cell: string): TableAlignment {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/**
 * Split one table row into cells.
 *
 * The outer pipes are optional in GFM and present in all of our content; both are handled. A
 * backslash-escaped pipe is content, so the split walks the string rather than calling
 * `String.prototype.split`, which cannot see the escape.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      cell += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  // Drop the empty cells the leading and trailing pipes produce, and only those.
  if (cells.length > 0 && cells[0]!.trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

function isDelimiterRow(line: string, headerCells: number): boolean {
  if (!line.includes("-")) return false;
  const cells = splitRow(line);
  if (cells.length !== headerCells) return false;
  return cells.every((c) => DELIMITER_CELL.test(c));
}

/** A line that can belong to a table body: it has a pipe and some content. */
function isRowLine(line: string): boolean {
  return line.includes("|") && line.trim() !== "";
}

/**
 * Split `content` into text and table segments, in order, covering it exactly.
 *
 * Offsets are into the ORIGINAL string, so a caller can slice it and hand the slice to the
 * pipeline it already uses — which is how "render the text exactly as today" is kept honest.
 */
export function splitTableBlocks(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  if (content === "") return segments;

  // Line starts and ends in the ORIGINAL string, so offsets survive CRLF.
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let at = 0;
  for (const raw of content.split("\n")) {
    const hasCr = raw.endsWith("\r");
    const text = hasCr ? raw.slice(0, -1) : raw;
    lines.push({ text, start: at, end: at + text.length });
    at += raw.length + 1; // the "\n" the split consumed
  }

  let textFrom = 0;
  let i = 0;
  while (i < lines.length) {
    const head = lines[i]!;
    const next = lines[i + 1];
    if (
      next === undefined ||
      !isRowLine(head.text) ||
      !isDelimiterRow(next.text, splitRow(head.text).length)
    ) {
      i += 1;
      continue;
    }

    const header = splitRow(head.text);
    const align = splitRow(next.text).map(alignmentOf);

    let last = i + 1;
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length && isRowLine(lines[j]!.text); j += 1) {
      const cells = splitRow(lines[j]!.text);
      // GFM: too many cells are dropped, too few are padded.
      rows.push(
        Array.from({ length: header.length }, (_, c) => cells[c] ?? ""),
      );
      last = j;
    }

    if (textFrom < head.start) {
      segments.push({ kind: "text", start: textFrom, end: head.start });
    }
    segments.push({
      kind: "table",
      start: head.start,
      end: lines[last]!.end,
      header,
      align,
      rows,
    });
    textFrom = lines[last]!.end;
    i = last + 1;
  }

  if (textFrom < content.length) {
    segments.push({ kind: "text", start: textFrom, end: content.length });
  }
  return segments;
}

/**
 * The text of a run, with the blank line that separates it from an adjacent table removed.
 *
 * plain English: `prose\n\n| a |…` keeps its two newlines in the text segment, and a stem is
 * rendered with `white-space: pre-wrap`, so without this the reader gets two blank lines and
 * then the table's own margin on top. The table's CSS margin is the spacing; the newlines that
 * only ever existed to separate the markdown block are not.
 *
 * It trims ONLY at a table boundary, so a blank line between two paragraphs of prose is kept.
 */
export function trimAtTableBoundary(
  text: string,
  options: { readonly tableBefore: boolean; readonly tableAfter: boolean },
): string {
  let out = text;
  if (options.tableBefore) out = out.replace(/^(?:\r?\n)+/, "");
  if (options.tableAfter) out = out.replace(/(?:\r?\n)+$/, "");
  return out;
}

/** True when `content` holds at least one table. Lets a renderer skip all of this. */
export function hasTableBlock(content: string): boolean {
  return splitTableBlocks(content).some((s) => s.kind === "table");
}
