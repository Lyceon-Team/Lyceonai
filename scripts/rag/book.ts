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
  // Markup tags (<u>, </u> in OCR markdown) and the "[ACT NOTE]" marker are not text: their
  // letters would otherwise break a quote that spans them ("<u>Although</u> London" must match
  // "Although London").
  const tags = new Set<number>();
  for (const m of text.matchAll(/<\/?[a-z]+>|\[ACT NOTE\]/gi))
    for (let k = m.index ?? 0; k < (m.index ?? 0) + m[0].length; k += 1)
      tags.add(k);
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (!tags.has(i) && /[\p{L}\p{N}]/u.test(ch)) {
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
 * first. A quote that normalizes to fewer than 12 characters is accepted only when it occurs
 * exactly once in the range, and never below 5: OCR markdown makes short heading quotes normal
 * ("### B. Two Dashes" is 10, "#### Their" 5; 23 of the Meltzer headings are under 12), and one
 * occurrence places the boundary unambiguously however short it is.
 */
/** Normalized length from which a quote places a boundary by itself; below it, only if unique. */
const UNAMBIGUOUS_QUOTE = 12;
/** Normalized length below which a quote is refused even when unique. */
const SHORT_QUOTE_FLOOR = 5;

export function locateQuote(
  text: string,
  quote: string,
  from = 0,
  opts: { to?: number; last?: boolean; unique?: boolean } = {},
): { start: number; end: number } | null {
  const q = normalize(quote);
  if (q.length < SHORT_QUOTE_FLOOR) return null;
  const to = opts.to ?? text.length;
  const { norm, map } = normalizeWithMap(text);
  const fromNorm = map.findIndex((o) => o >= from);
  if (fromNorm === -1) return null;
  let found = -1;
  let count = 0;
  const short = q.length < UNAMBIGUOUS_QUOTE || opts.unique === true;
  for (
    let at = norm.indexOf(q, fromNorm);
    at !== -1;
    at = norm.indexOf(q, at + 1)
  ) {
    const last = map[at + q.length - 1];
    if (last === undefined || last >= to) break;
    count += 1;
    if (count === 1 || opts.last === true) found = at;
    if (opts.last !== true && !short) break;
  }
  if (found === -1 || (short && count !== 1)) return null;
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
  return {
    pdfPage,
    printed: printed === undefined ? null : Number(printed),
    body: text.replace(/<!--[\s\S]*?-->/g, "").trim(),
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
 * "[ACT NOTE]" paragraphs are KEPT, and so is their marker: the flag means "mentions the ACT",
 * not "ACT-only" (printed page 11 is a general comma rule the SAT can test), and the rewrite
 * and the audit need to see it to drop the ACT-scoped advice from an entry rather than state
 * it as general (Karl, 2026-10-23: chunks 9:2 and 5:1 did that with the marker stripped). Quote
 * matching skips the marker (normalizeWithMap). Every dropped section is returned with its
 * page and size, so the cut can be checked.
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
      kept.push(line);
    }
    const body = kept
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (body !== "") out.push({ ...page, body });
  }
  return { pages: out, dropped };
}

/**
 * Pure. Whether the unit [start, end) of `text` starts or ends at a lettered-subsection heading
 * ("### ", OCR markdown) inside a numbered rule ("## "): the boundary where one rule was split
 * into units. Measured on drops (Karl, 2026-10-23: 8 of 10 audit drops sat on one when the
 * segmenter put each lettered subsection in its own unit). Blank space at the edges is skipped.
 */
export function onSubsectionBoundary(
  text: string,
  start: number,
  end: number,
): boolean {
  // Unit edges sit on letters and digits (quotes are matched on those), so a start lands after
  // the "### " the model left out of its quote, and an end before the sentence's last period:
  // a start is at a heading when only "#" and blanks precede it on its line, and an end is at
  // one when only punctuation and blanks lie between it and the next "### ".
  const lineOf = (i: number): number => text.lastIndexOf("\n", i - 1) + 1;
  const subLineAt = (i: number): boolean => text.startsWith("### ", i);
  let s0 = start;
  while (s0 < end && /\s/.test(text[s0] ?? "")) s0 += 1;
  const startLine = lineOf(s0);
  const startsAtSub =
    subLineAt(startLine) && /^[#\s]*$/.test(text.slice(startLine, s0));
  let e0 = end;
  while (e0 < text.length && /[^\p{L}\p{N}#]/u.test(text[e0] ?? "")) e0 += 1;
  const endsAtSub = lineOf(e0) === e0 && subLineAt(e0);
  const ruleBefore = (i: number): boolean =>
    [...text.slice(0, i).matchAll(/^## /gm)].length > 0;
  return (startsAtSub && ruleBefore(s0)) || (endsAtSub && ruleBefore(e0));
}

/** A numbered rule shorter than this is one idea and stays in one unit (Karl, 2026-10-23). */
export const SHORT_RULE_WORDS = 400;

/**
 * Pure. The numbered rules ("## " headings of OCR markdown) lying wholly in [winStart, winEnd)
 * that are under `maxWords` words yet were split by a unit starting at one of their lettered-
 * subsection headings ("### "). The segment prompt says to keep such a rule in one unit; the
 * model split rule 15 (251 words) anyway on 2026-10-23, so the rule is enforced here and the
 * window is asked again. A rule running past the window cannot be judged and is skipped. Words
 * are counted without the markdown symbols. Returns each offending rule's heading line.
 */
export function shortRulesSplit(
  text: string,
  units: readonly { start: number }[],
  winStart: number,
  winEnd: number,
  maxWords = SHORT_RULE_WORDS,
): string[] {
  const heads = [...text.matchAll(/^## .*$/gm)].map((m) => ({
    at: m.index ?? 0,
    line: m[0],
  }));
  const out: string[] = [];
  for (const [i, h] of heads.entries()) {
    const ruleEnd = heads[i + 1]?.at ?? text.length;
    if (h.at < winStart || ruleEnd > winEnd) continue;
    if (ruleWords(text, h.at, ruleEnd) >= maxWords) continue;
    const split = units.some(
      (u) =>
        u.start > h.at &&
        u.start < ruleEnd &&
        startsAtSubsection(text, u.start),
    );
    if (split) out.push(h.line);
  }
  return out;
}

/**
 * Pure. The other half of the rule shortRulesSplit enforces (Karl, 2026-10-26: "short rules
 * stay whole, long rules split; neither trusted to the prompt"): the numbered rules lying
 * wholly in [winStart, winEnd) of `maxWords` words or more that have lettered subsections
 * ("### ") and at least one subsection heading after the first that no unit starts at (the
 * first shares its unit with the rule's opening explanation). The 2026-10-26
 * run kept rules of 401-489 words whole (chunks up to 453 words; median 185 -> 337), against
 * the brief's one teachable idea per chunk. Units may also split inside a subsection. Returns
 * each offending rule's heading line.
 */
export function longRulesWhole(
  text: string,
  units: readonly { start: number }[],
  winStart: number,
  winEnd: number,
  maxWords = SHORT_RULE_WORDS,
): string[] {
  const heads = [...text.matchAll(/^## .*$/gm)].map((m) => ({
    at: m.index ?? 0,
    line: m[0],
  }));
  const unitLines = units.map((u) => lineStartOfEdge(text, u.start));
  const out: string[] = [];
  for (const [i, h] of heads.entries()) {
    const ruleEnd = heads[i + 1]?.at ?? text.length;
    if (h.at < winStart || ruleEnd > winEnd) continue;
    if (ruleWords(text, h.at, ruleEnd) < maxWords) continue;
    const subs = [...text.slice(h.at, ruleEnd).matchAll(/^### /gm)].map(
      (m) => h.at + (m.index ?? 0),
    );
    // The first subsection shares its unit with the rule's opening explanation, so only the
    // headings after it must start a unit.
    // A unit may start at the subsection heading or anywhere in the block of minor headings
    // directly above it (where splitLongRules cuts).
    const started = (at: number): boolean => {
      const from = headingBlockStart(text, at, h.at);
      return unitLines.some((l) => l >= from && l <= at);
    };
    if (subs.slice(1).some((at) => !started(at))) out.push(h.line);
  }
  return out;
}

/**
 * Pure. The units of one window with every numbered rule of `maxWords` words or more (lying
 * wholly in [winStart, winEnd), with lettered subsections) cut at each lettered-subsection
 * heading after its first. The cut is made here, in code, not asked of the model: on 2026-10-26
 * the model kept rule 8 whole on three answers in a row despite being told each time, and the
 * code, not the model, cuts the text in any case. A cut lands at the start of the block of
 * heading lines directly above the subsection heading, so a minor heading introducing a group
 * ("#### Commas should NOT be used:") goes with the subsections it introduces. Each new piece
 * takes its subsection heading as section_title; only the last piece of a unit keeps that
 * unit's ends_in_window. Afterwards longRulesWhole finds nothing in the window.
 */
export function splitLongRules<
  U extends {
    start: number;
    end: number;
    section_title: string;
    ends_in_window: boolean;
  },
>(
  text: string,
  units: readonly U[],
  winStart: number,
  winEnd: number,
  maxWords = SHORT_RULE_WORDS,
): { units: U[]; cuts: number } {
  const heads = [...text.matchAll(/^## .*$/gm)].map((m) => m.index ?? 0);
  const cuts: { at: number; title: string }[] = [];
  for (const [i, h] of heads.entries()) {
    const ruleEnd = heads[i + 1] ?? text.length;
    if (h < winStart || ruleEnd > winEnd) continue;
    if (ruleWords(text, h, ruleEnd) < maxWords) continue;
    const subs = [...text.slice(h, ruleEnd).matchAll(/^### (.*)$/gm)].slice(1);
    for (const m of subs) {
      const at = h + (m.index ?? 0);
      cuts.push({
        at: headingBlockStart(text, at, h),
        title: plainHeading(m[1] ?? ""),
      });
    }
  }
  const out: U[] = [];
  let n = 0;
  for (const u of units) {
    const inside = cuts.filter((c) => c.at > u.start && c.at < u.end);
    if (inside.length === 0) {
      out.push(u);
      continue;
    }
    const edges = [u.start, ...inside.map((c) => c.at), u.end];
    for (let k = 0; k + 1 < edges.length; k += 1) {
      out.push({
        ...u,
        start: edges[k] ?? u.start,
        end: edges[k + 1] ?? u.end,
        section_title:
          k === 0 ? u.section_title : (inside[k - 1]?.title ?? u.section_title),
        ends_in_window: k + 2 === edges.length ? u.ends_in_window : true,
      });
    }
    n += inside.length;
  }
  return { units: out, cuts: n };
}

/** Pure. Where the run of heading and blank lines ending at the heading `at` begins (not before `floor`). */
function headingBlockStart(text: string, at: number, floor: number): number {
  let start = at;
  for (;;) {
    const prevEnd = start - 1;
    if (prevEnd <= floor) return start;
    const prevStart = text.lastIndexOf("\n", prevEnd - 1) + 1;
    const line = text.slice(prevStart, prevEnd);
    if (prevStart <= floor || !/^(#### .*|\s*)$/.test(line)) break;
    start = prevStart;
  }
  // Blank lines at the top of the block stay with the piece before.
  while (start < at && /\s/.test(text[start] ?? "")) start += 1;
  return start;
}

/** Pure. A heading's words without markdown symbols. */
function plainHeading(h: string): string {
  return h.replace(/<\/?[a-z]+>|[*_]/gi, "").trim();
}

/**
 * Pure. The opening explanation of the numbered rule a unit belongs to (from its "## " heading
 * to its first "### " subsection heading), when the unit is one piece of a rule that has
 * subsections; null when the unit holds the whole rule, or the rule has no subsections, or the
 * unit is under no rule. Karl, 2026-10-26: the 400-word cut gave rule 6's subsections B and C
 * no definition, so the two correct pieces dropped and the flawed one survived; every piece of
 * a cut rule now gets the rule's opening, as part of its source. Mechanical: headings only.
 */
export function ruleOpening(
  text: string,
  start: number,
  end: number,
): string | null {
  const heads = [...text.matchAll(/^## .*$/gm)].map((m) => m.index ?? 0);
  const s0 = lineStartOfEdge(text, start);
  let rule = -1;
  for (const h of heads) if (h <= s0) rule = h;
  if (rule === -1) return null;
  const ruleEnd = heads.find((h) => h > rule) ?? text.length;
  const firstSub = /^### /m.exec(text.slice(rule, ruleEnd));
  if (firstSub === null) return null;
  // A whole-rule unit, by its real edges: it starts on the rule's heading line (after the "## "
  // its quote left out) and every subsection heading of the rule lies inside it. Its end is not
  // compared with the rule's end: a unit may stop before a closing "</u>." or a short closing
  // remark (Meltzer 15:1 and 14:1, 2026-10-26).
  const startsAtRule = lineStartOfEdge(text, start) === rule;
  const lastSub = [...text.slice(rule, ruleEnd).matchAll(/^### /gm)].pop();
  const holdsAllSubs = rule + (lastSub?.index ?? 0) < end;
  if (startsAtRule && holdsAllSubs) return null;
  return text.slice(rule, rule + firstSub.index).trim();
}

/** Pure. Words of a rule, without the markdown symbols. */
function ruleWords(text: string, from: number, to: number): number {
  return wordCount(
    text.slice(from, to).replace(/<\/?[a-z]+>|\[ACT NOTE\]|[#*]/gi, " "),
  );
}

/** Pure. The start of the line a unit edge sits on, past leading blanks. */
function lineStartOfEdge(text: string, at: number): number {
  let s0 = at;
  while (s0 < text.length && /\s/.test(text[s0] ?? "")) s0 += 1;
  return text.lastIndexOf("\n", s0 - 1) + 1;
}

/** Pure. A unit edge at `at` is on a "### " heading line, past only "#" and blanks. */
function startsAtSubsection(text: string, at: number): boolean {
  let s0 = at;
  while (s0 < text.length && /\s/.test(text[s0] ?? "")) s0 += 1;
  const line = text.lastIndexOf("\n", s0 - 1) + 1;
  return text.startsWith("### ", line) && /^[#\s]*$/.test(text.slice(line, s0));
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
/**
 * Pure. A unit's start (or end) quote located in [from, to). The quote as given first, with
 * locateQuote's rules; failing that, its longest word-prefix (for a start) or word-suffix (for
 * an end) that normalizes to at least 12 characters and occurs exactly once in the range. The
 * model sometimes joins headings across skipped lines ("15. FAULTY COMPARISONS A. Singular
 * Comparison Though the work", measured 2026-10-23: two intro paragraphs lie between); the
 * edge of a unit is fixed by the words at that edge, and a unique 12-character run places it as
 * firmly as any quote the matcher accepts.
 */
export function locateEdge(
  text: string,
  quote: string,
  from: number,
  to: number,
  side: "start" | "end",
): { start: number; end: number } | null {
  const whole = locateQuote(text, quote, from, { to, last: side === "end" });
  if (whole !== null) return whole;
  const words = quote.trim().split(/\s+/);
  for (let k = words.length - 1; k >= 1; k -= 1) {
    const part = (
      side === "start" ? words.slice(0, k) : words.slice(words.length - k)
    ).join(" ");
    if (normalize(part).length < UNAMBIGUOUS_QUOTE) break;
    const m = locateQuote(text, part, from, {
      to,
      last: side === "end",
      unique: true,
    });
    if (m !== null) return m;
  }
  return null;
}

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
    const s = locateEdge(win, u.start_quote, from, win.length, "start");
    if (s === null)
      throw new Error(
        `unit ${i + 1}: start_quote ${JSON.stringify(u.start_quote.slice(0, 120))} not found in the window after unit ${i}'s start`,
      );
    starts.push(s.start);
    from = s.start + 1;
  }
  const located = units.map((u, i) => {
    const start = starts[i] ?? 0;
    const e = locateEdge(
      win,
      u.end_quote,
      start,
      starts[i + 1] ?? win.length,
      "end",
    );
    if (e === null)
      throw new Error(
        `unit ${i + 1}: end_quote ${JSON.stringify(u.end_quote.slice(0, 120))} not found between its start and the next unit`,
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
