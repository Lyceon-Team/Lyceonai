/**
 * @spec [CC Brief "Book Ingestion into the Knowledge Base" (Karl, 2026-10-22) §2.1 (extract with
 *       structure; page numbers into provenance where sections are long), §2.2 (chunk on
 *       meaning; each chunk stands alone), §3 (review CSV: provenance, skill_codes,
 *       content_type, first 200 chars); Doc-03D_V1.2 §6.5 (provenance) as amended by SCL-231]
 *       | @implemented [2026-10-22]
 *
 * plain English: the pure half of the book pipeline (scripts/rag/ingest-book.ts does the IO).
 *  1. `splitPages` / `stripFurniture`: pdftotext output → pages, with running headers, footers
 *     and bare page numbers removed (a line that recurs at the top or bottom of many pages is
 *     page furniture, not teaching).
 *  2. `BookText`: the pages joined into one string, remembering which page each character is on.
 *  3. `locateQuote`: finds a model-quoted phrase in the source. Matching ignores case,
 *     punctuation and whitespace, because pdftotext and the model disagree about quotes, dashes
 *     and line breaks; the match is mapped back to exact offsets in the original text. The model
 *     names a unit's boundaries by quoting its first and last words; the CODE cuts the text, so
 *     a chunk's source is always a contiguous, verbatim stretch of the book.
 *  4. `nextCursor`: the windowing rule that keeps a rule whole. Only units that END inside a
 *     window are taken; the next window starts exactly where the first unfinished unit starts.
 *     A unit is therefore never cut at a window edge, which is where "starts mid-rule" chunks
 *     come from in a fixed-length chunker.
 *  5. `assignProvenance`: book:<slug>:<chapter>:<section>, with :p<page> appended when a section
 *     yields more than one chunk (brief §2.1), and .<n> when two start on the same page.
 *  6. The review CSV, written and parsed strictly (scripts/rag/apply-book-review.ts).
 *
 * edge cases: a quote that cannot be found, or units out of order, throws (the window is
 *  retried or the run fails): a guessed boundary is the defect this module exists to prevent.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { parseCsv } from "../reference-data/import-reference-data";

export const BOOK_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BOOK_PROVENANCE_RE =
  /^book:[a-z0-9]+(?:-[a-z0-9]+)*:[0-9]+:[0-9]+(?::p[0-9]+(?:\.[0-9]+)?)?$/;

export const CONTENT_TYPES = [
  "textbook",
  "worked_example",
  "strategy",
] as const;
export const SURFACE_GATES = ["pre_and_post", "post_only"] as const;
export const contentTypeSchema = z.enum(CONTENT_TYPES);
export const surfaceGateSchema = z.enum(SURFACE_GATES);

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== "").length;
}

/** pdftotext separates pages with a form feed; the text after the last one is empty. */
export function splitPages(raw: string): string[] {
  const pages = raw.replace(/\r\n?/g, "\n").split("\f");
  if (pages.length > 1 && pages[pages.length - 1]?.trim() === "") pages.pop();
  return pages;
}

/**
 * A running head's shape. Digits are folded only in short lines that do not end like a
 * sentence (at most 6 words: "Chapter 7 | 142", "SAT Grammar 23"), so that numbered teaching
 * lines ("Example 3: ...", "Step 1: find the subject.") that happen to sit at a page edge are
 * never mistaken for one repeated head.
 */
function furnitureKey(line: string): string {
  const t = line.toLowerCase().replace(/\s+/g, " ").trim();
  const headLike = t.split(" ").length <= 6 && !/[.?!;:]$/.test(t);
  return headLike ? t.replace(/[0-9]+/g, "#") : t;
}

/**
 * Pure. Removes running heads and feet: a line among the first or last two non-blank lines of
 * a page whose shape recurs at a page edge on at least `minPages` pages, and any line that is
 * only a page number. A count, not a share of the book: a head that carries the chapter title
 * recurs only through its chapter.
 */
export function stripFurniture(pages: string[], minPages = 3): string[] {
  const edgeLines = (p: string): string[] => {
    const lines = p.split("\n").filter((l) => l.trim() !== "");
    return [...lines.slice(0, 2), ...lines.slice(-2)];
  };
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const k of new Set(edgeLines(p).map(furnitureKey)))
      counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const recurring = new Set(
    [...counts].filter(([k, n]) => k !== "" && n >= minPages).map(([k]) => k),
  );
  return pages.map((p) => {
    const lines = p.split("\n");
    const nonBlank = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.trim() !== "");
    const edge = new Set(
      [...nonBlank.slice(0, 2), ...nonBlank.slice(-2)].map(({ i }) => i),
    );
    return lines
      .filter((l, i) => {
        const t = l.trim();
        if (/^(page\s+)?[0-9ivxlc]{1,5}$/i.test(t)) return false;
        return !(edge.has(i) && recurring.has(furnitureKey(l)));
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  });
}

/** The book as one string, with the page (1-based) of every offset. */
export class BookText {
  readonly text: string;
  private readonly pageStarts: number[];

  /** Printed page numbers by page index, when the source knows them (OCR input). */
  private readonly labels: readonly (number | null)[];

  constructor(pages: string[], labels: readonly (number | null)[] = []) {
    this.labels = labels;
    const starts: number[] = [];
    let text = "";
    for (const p of pages) {
      if (text !== "") text += "\n\n";
      starts.push(text.length);
      text += p;
    }
    this.text = text;
    this.pageStarts = starts;
  }

  /** The page an offset is on: its printed number when known, else its 1-based index. */
  pageAt(offset: number): number {
    let lo = 0;
    let hi = this.pageStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.pageStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return this.labels[lo] ?? lo + 1;
  }

  /** The text of [start, end) with a "[page n]" marker where each page begins. */
  marked(start: number, end: number): string {
    let out = "";
    let at = start;
    for (const [i, s] of this.pageStarts.entries()) {
      if (s > at && s < end) {
        out += this.text.slice(at, s) + `[page ${this.labels[i] ?? i + 1}]\n`;
        at = s;
      }
    }
    return out + this.text.slice(at, end);
  }

  /** Cuts at a paragraph break (else a line break) at or before `target`, after `min`. */
  cutBefore(target: number, min: number): number {
    if (target >= this.text.length) return this.text.length;
    const para = this.text.lastIndexOf("\n\n", target);
    if (para > min) return para;
    const line = this.text.lastIndexOf("\n", target);
    return line > min ? line : target;
  }
}

/** Letters and digits only, lower-cased, with a map from each kept char to its source offset. */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (/[\p{L}\p{N}]/u.test(ch)) {
      norm += ch.toLowerCase();
      map.push(i);
    }
  }
  return { norm, map };
}

function normalize(text: string): string {
  return normalizeWithMap(text).norm;
}

/**
 * Pure. Where `quote` occurs in `text` within [from, to): [start, end) offsets of the match in
 * the ORIGINAL text, or null. `last` picks the last occurrence in the range instead of the
 * first. A quote that normalizes to fewer than 12 characters is refused (too short to place one
 * boundary unambiguously).
 */
export function locateQuote(
  text: string,
  quote: string,
  from = 0,
  opts: { to?: number; last?: boolean } = {},
): { start: number; end: number } | null {
  const q = normalize(quote);
  if (q.length < 12) return null;
  const to = opts.to ?? text.length;
  const { norm, map } = normalizeWithMap(text);
  const fromNorm = map.findIndex((o) => o >= from);
  if (fromNorm === -1) return null;
  let found = -1;
  for (
    let at = norm.indexOf(q, fromNorm);
    at !== -1;
    at = norm.indexOf(q, at + 1)
  ) {
    const last = map[at + q.length - 1];
    if (last === undefined || last >= to) break;
    found = at;
    if (opts.last !== true) break;
  }
  if (found === -1) return null;
  const start = map[found];
  const last = map[found + q.length - 1];
  if (start === undefined || last === undefined) return null;
  return { start, end: last + 1 };
}

// ---------------------------------------------------------------------------------------------
// OCR markdown input (scripts/rag/ocr-book.ts output)
// ---------------------------------------------------------------------------------------------

export type OcrPage = { pdfPage: number; printed: number | null; body: string };

/** Pure. One page-NN.md file → its printed page (from the header comment) and its body. */
export function parseOcrPage(pdfPage: number, text: string): OcrPage {
  const printed = /<!-- PDF page \d+; printed page (\d+) -->/.exec(text)?.[1];

  let body = text;
  let previous: string;
  do {
    previous = body;
    body = body.replace(/<!--[\s\S]*?-->/g, "");
  } while (body !== previous);

  return {
    pdfPage,
    printed: printed === undefined ? null : Number(printed),
    body: body.trim(),
  };
}

export type DroppedSection = {
  heading: string;
  page: number;
  words: number;
  reason: "act_only_section" | "act_only_subsection";
};

const HEADING_RE = /^(#{1,4})\s+(.*)$/;

/**
 * Pure. The pages with ACT-only material removed, by SECTION, as ruled by Karl (2026-10-23):
 *  - an "ACT ONLY" banner heading drops everything from the banner to the end of the book
 *    (in the Meltzer guide: rules 17-20 and the idiom table);
 *  - a heading followed by an "[ACT ONLY]" line drops that heading's section, up to the next
 *    heading of the same or a higher level (in the Meltzer guide: "Who's vs. Whose (Primarily
 *    ACT)" and "Then vs. Than (ACT)").
 * "[ACT NOTE]" paragraphs are KEPT, with the marker removed: the flag means "mentions the ACT",
 * not "ACT-only" (printed page 11 is a general comma rule the SAT can test). Every dropped
 * section is returned with its page and size, so the cut can be checked.
 */
export function dropActSections(pages: OcrPage[]): {
  pages: OcrPage[];
  dropped: DroppedSection[];
} {
  const dropped: DroppedSection[] = [];
  const out: OcrPage[] = [];
  let banner = false;
  let skipLevel: number | null = null;
  let current: DroppedSection | null = null;
  for (const page of pages) {
    const lines = page.body.split("\n");
    const kept: string[] = [];
    for (const [i, line] of lines.entries()) {
      const h = HEADING_RE.exec(line);
      const level = h?.[1]?.length ?? 0;
      const title = (h?.[2] ?? "").trim();
      if (!banner && h !== null && /^ACT ONLY$/i.test(title)) {
        banner = true;
        current = {
          heading: title,
          page: page.printed ?? page.pdfPage,
          words: 0,
          reason: "act_only_section",
        };
        dropped.push(current);
        continue;
      }
      if (banner) {
        if (current !== null) current.words += wordCount(line);
        continue;
      }
      if (skipLevel !== null && h !== null && level <= skipLevel) {
        skipLevel = null;
        current = null;
      }
      if (skipLevel === null && h !== null) {
        const next = lines.slice(i + 1).find((l) => l.trim() !== "");
        if (next?.trim() === "[ACT ONLY]") {
          skipLevel = level;
          current = {
            heading: title,
            page: page.printed ?? page.pdfPage,
            words: 0,
            reason: "act_only_subsection",
          };
          dropped.push(current);
          continue;
        }
      }
      if (skipLevel !== null) {
        if (current !== null && line.trim() !== "[ACT ONLY]")
          current.words += wordCount(line);
        continue;
      }
      if (line.trim() === "[ACT ONLY]") continue;
      kept.push(line.replace(/^\[ACT NOTE\]\s*/, ""));
    }
    const body = kept
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (body !== "") out.push({ ...page, body });
  }
  return { pages: out, dropped };
}

export const UNIT_KINDS = [
  "rule",
  "worked_example",
  "strategy",
  "exercises",
  "answer_key",
  "front_or_back_matter",
  "other",
] as const;
export const TEACHING_KINDS: ReadonlySet<string> = new Set([
  "rule",
  "worked_example",
  "strategy",
]);

export const proposedUnitSchema = z.object({
  chapter_number: z.number().int().positive().nullable(),
  chapter_title: z.string(),
  section_title: z.string(),
  kind: z.enum(UNIT_KINDS),
  start_quote: z.string(),
  end_quote: z.string(),
  ends_in_window: z.boolean(),
});
export type ProposedUnit = z.infer<typeof proposedUnitSchema>;

export type LocatedUnit = ProposedUnit & { start: number; end: number };

/** Uncovered text between two units, above which a window's segmentation is rejected. */
export const MAX_GAP_WORDS = 30;

/**
 * Pure. The model's units for the window [winStart, winEnd) → source spans, in order.
 *  - Each start is the first occurrence of its start_quote after the previous unit's start.
 *  - Each end is the LAST occurrence of its end_quote before the next unit's start (or the end
 *    of the window). An end phrase often recurs inside its own unit (an example sentence
 *    restated in its fix); the first occurrence would cut the unit short and leave the rest of
 *    the idea uncovered.
 *  - More than MAX_GAP_WORDS words left between two units, or before the first, means text no
 *    unit holds: rejected, so the caller asks again rather than losing part of a rule.
 * Throws on any of these.
 */
export function locateUnits(
  book: BookText,
  winStart: number,
  winEnd: number,
  units: ProposedUnit[],
): LocatedUnit[] {
  const win = book.text.slice(winStart, winEnd);
  const starts: number[] = [];
  let from = 0;
  for (const [i, u] of units.entries()) {
    const s = locateQuote(win, u.start_quote, from);
    if (s === null)
      throw new Error(`unit ${i + 1}: start_quote not found in the window`);
    starts.push(s.start);
    from = s.start + 1;
  }
  const located = units.map((u, i) => {
    const start = starts[i] ?? 0;
    const e = locateQuote(win, u.end_quote, start, {
      to: starts[i + 1] ?? win.length,
      last: true,
    });
    if (e === null)
      throw new Error(
        `unit ${i + 1}: end_quote not found between its start and the next unit`,
      );
    return { ...u, start: winStart + start, end: winStart + e.end };
  });
  let at = winStart;
  for (const [i, u] of located.entries()) {
    const gap = wordCount(book.text.slice(at, u.start));
    if (gap > MAX_GAP_WORDS)
      throw new Error(
        `${gap} words before unit ${i + 1} belong to no unit; every stretch of the window must be in a unit`,
      );
    at = Math.max(at, u.end);
  }
  return located;
}

/**
 * Pure. The units to keep from one window, and where the next window starts.
 *  - At the end of the book every unit is kept.
 *  - Otherwise only units that end in the window are kept, and the next window starts at the
 *    first one that does not, so an unfinished unit is re-read whole next time.
 *  - If no unit finishes (one idea longer than the window), nothing is kept and `grow` is set:
 *    the caller widens the window rather than cutting the idea.
 */
export function nextCursor(
  units: LocatedUnit[],
  winEnd: number,
  bookEnd: number,
): { keep: LocatedUnit[]; cursor: number; grow: boolean } {
  if (winEnd >= bookEnd) return { keep: units, cursor: bookEnd, grow: false };
  const firstOpen = units.findIndex((u) => !u.ends_in_window);
  const keep = firstOpen === -1 ? units : units.slice(0, firstOpen);
  if (keep.length === 0)
    return { keep: [], cursor: units[0]?.start ?? winEnd, grow: true };
  const open = firstOpen === -1 ? undefined : units[firstOpen];
  const lastKept = keep[keep.length - 1];
  return {
    keep,
    cursor: open?.start ?? lastKept?.end ?? winEnd,
    grow: false,
  };
}

/**
 * Pure. Stretches of the book no unit covers (between units, before the first, after the last)
 * holding more than `minWords` words. The model is told to classify every stretch, so a gap is
 * text that silently went missing; it is reported, never dropped quietly.
 */
export function unassignedGaps(
  text: string,
  units: { start: number; end: number }[],
  minWords = 30,
): { start: number; end: number; words: number }[] {
  const out: { start: number; end: number; words: number }[] = [];
  let at = 0;
  for (const u of [...units, { start: text.length, end: text.length }]) {
    if (u.start > at) {
      const words = wordCount(text.slice(at, u.start));
      if (words > minWords) out.push({ start: at, end: u.start, words });
    }
    at = Math.max(at, u.end);
  }
  return out;
}

/**
 * Pure. The chapter number of every unit, in book order. A unit the model could not number
 * (its window did not show a chapter heading) is in the same chapter as the unit before it: a
 * chapter cannot change without a heading, and the next window is told where the last one left
 * off. A book that prints no chapter numbers is numbered by the order of its chapter titles.
 * Units before the first chapter (front matter) are chapter 0. Printed and ordinal numbers are
 * never mixed: a book with any printed number uses printed numbers throughout.
 */
export function resolveChapters(
  units: { chapter_number: number | null; chapter_title: string }[],
): number[] {
  const printed = units.some((u) => u.chapter_number !== null);
  const ordinals = new Map<string, number>();
  let current = 0;
  return units.map((u) => {
    if (printed) {
      if (u.chapter_number !== null) current = u.chapter_number;
      return current;
    }
    const k = u.chapter_title.trim().toLowerCase();
    if (k !== "" && !ordinals.has(k)) ordinals.set(k, ordinals.size + 1);
    return ordinals.get(k) ?? current;
  });
}

export type ProvenanceInput = {
  chapterNumber: number;
  sectionTitle: string;
  page: number;
};

/**
 * Pure. book:<slug>:<chapter>:<section>[:p<page>[.<n>]]. Sections are numbered 1.. within a
 * chapter by first appearance of their title; a section that yields one chunk gets the bare
 * form, one that yields several gets the start page of each, and .<n> separates two that start
 * on the same page. Deterministic in input order, so a re-run assigns the same provenance.
 */
export function assignProvenance(
  slug: string,
  chunks: ProvenanceInput[],
): string[] {
  if (!BOOK_SLUG_RE.test(slug)) throw new Error(`bad book slug "${slug}"`);
  const sectionNo = new Map<string, number>();
  const perChapter = new Map<number, number>();
  const keyOf = chunks.map((c) => {
    const k = `${c.chapterNumber}\u0000${c.sectionTitle.trim().toLowerCase()}`;
    if (!sectionNo.has(k)) {
      const n = (perChapter.get(c.chapterNumber) ?? 0) + 1;
      perChapter.set(c.chapterNumber, n);
      sectionNo.set(k, n);
    }
    return k;
  });
  const perSection = new Map<string, number>();
  for (const k of keyOf) perSection.set(k, (perSection.get(k) ?? 0) + 1);
  const seen = new Map<string, number>();
  return chunks.map((c, i) => {
    const k = keyOf[i] ?? "";
    const base = `book:${slug}:${c.chapterNumber}:${sectionNo.get(k) ?? 0}`;
    if ((perSection.get(k) ?? 0) === 1) return base;
    const paged = `${base}:p${c.page}`;
    const n = (seen.get(paged) ?? 0) + 1;
    seen.set(paged, n);
    return n === 1 ? paged : `${paged}.${n}`;
  });
}

// ---------------------------------------------------------------------------------------------
// The review CSV (brief §3)
// ---------------------------------------------------------------------------------------------

export const BOOK_REVIEW_HEADER = [
  "approve",
  "provenance",
  "skill_codes",
  "content_type",
  "surface_gate",
  "words",
  "first_200",
  "content_sha256",
] as const;

export type BookChunk = {
  provenance: string;
  content: string;
  skill_codes: string[];
  content_type: (typeof CONTENT_TYPES)[number];
  surface_gate: (typeof SURFACE_GATES)[number];
};

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Pure. The chunks as the review CSV, approve blank, in input order. */
export function toReviewCsv(chunks: BookChunk[]): string {
  const lines = [BOOK_REVIEW_HEADER.join(",")];
  for (const c of chunks) {
    lines.push(
      [
        "",
        c.provenance,
        c.skill_codes.join(";"),
        c.content_type,
        c.surface_gate,
        wordCount(c.content),
        c.content.replace(/\s+/g, " ").slice(0, 200),
        sha256(c.content),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export type ReviewedBookRow = {
  provenance: string;
  skill_codes: string[];
  content_type: (typeof CONTENT_TYPES)[number];
  surface_gate: (typeof SURFACE_GATES)[number];
  content_sha256: string;
};

/**
 * Pure. The reviewed CSV → the rows marked approve = yes. Throws on an unknown header, an
 * approve value other than yes/blank, a provenance that is not a book's, a duplicate, a skill
 * outside the taxonomy, an empty skill list, a content type or gate outside the book values,
 * or a malformed hash. Skills, content type and gate may be corrected in the file; the content
 * may not (the hash pins exactly the text that was exported).
 */
export function parseBookReviewCsv(
  text: string,
  skills: ReadonlySet<string>,
): ReviewedBookRow[] {
  const [header, ...body] = parseCsv(text).filter(
    (r) => !(r.length === 1 && r[0] === ""),
  );
  if (header?.join(",") !== BOOK_REVIEW_HEADER.join(","))
    throw new Error("book review CSV: unexpected header");
  const seen = new Set<string>();
  const out: ReviewedBookRow[] = [];
  body.forEach((cells, i) => {
    const at = `book review CSV data row ${i + 1}`;
    const cell = (k: (typeof BOOK_REVIEW_HEADER)[number]): string =>
      (cells[BOOK_REVIEW_HEADER.indexOf(k)] ?? "").trim();
    const provenance = cell("provenance");
    if (!BOOK_PROVENANCE_RE.test(provenance))
      throw new Error(`${at}: "${provenance}" is not a book provenance`);
    if (seen.has(provenance)) throw new Error(`${at}: duplicate ${provenance}`);
    seen.add(provenance);
    const mark = cell("approve").toLowerCase();
    if (mark !== "" && mark !== "yes")
      throw new Error(
        `${at}: approve must be "yes" or blank, got "${cell("approve")}"`,
      );
    if (mark !== "yes") return;
    const codes = [
      ...new Set(
        cell("skill_codes")
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s !== ""),
      ),
    ];
    if (codes.length === 0)
      throw new Error(`${at}: approve=yes with no skills`);
    for (const s of codes) {
      if (!skills.has(s))
        throw new Error(`${at}: "${s}" is not a taxonomy skill`);
    }
    const type = contentTypeSchema.safeParse(cell("content_type"));
    if (!type.success)
      throw new Error(`${at}: content_type "${cell("content_type")}"`);
    const gate = surfaceGateSchema.safeParse(cell("surface_gate"));
    if (!gate.success)
      throw new Error(`${at}: surface_gate "${cell("surface_gate")}"`);
    const hash = cell("content_sha256");
    if (!/^[0-9a-f]{64}$/.test(hash))
      throw new Error(`${at}: content_sha256 is not a sha256`);
    out.push({
      provenance,
      skill_codes: codes,
      content_type: type.data,
      surface_gate: gate.data,
      content_sha256: hash,
    });
  });
  return out;
}
