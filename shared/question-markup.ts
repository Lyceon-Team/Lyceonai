/**
 * The one inline tag question content may carry: `<u>...</u>`.
 *
 * @spec [questions_governance.md §A (assembly gate); Coding Standards §5 / §17 (no raw HTML
 *       injection); live bug 2026-10-11 — Text Structure and Purpose passages wrap the target
 *       sentence in <u>...</u> and the renderer printed the tags] | @implemented [2026-10-11]
 *
 * plain English: an SAT "function of the underlined sentence" item needs the sentence to be
 * underlined, and the bank marks it with a literal `<u>...</u>` in the passage. This module
 * finds those tags so every renderer (MathRenderer, StaticMath, the exam passage view) can
 * draw an underline from them WITHOUT treating content as HTML: nothing here produces markup,
 * it only reports where the tags and the underlined text are. The assembly gate reads the
 * same functions, so what authoring accepts and what the renderers underline cannot disagree.
 *
 * trade-offs:
 *  - The allowlist is exactly two strings, `<u>` and `</u>`: lower case, no attributes, no
 *    spaces. `<U>`, `<u class=x>` or `<b>` stay literal text on screen and fail the gate,
 *    so a malformed tag is visible to a reviewer instead of silently "fixed".
 *  - Tags pair left to right and do not nest. An unmatched `<u>` or `</u>` is left as
 *    literal text (and fails the gate) rather than underlining to the end of the passage.
 *  - Tags inside a maths token (`$...$`) are maths source, not markup; callers pass the
 *    maths ranges so those are skipped.
 *
 * edge cases: offsets are UTF-16 indexes into the source string, the same unit the shared
 * tokenizer's `rawStart`/`rawEnd` use; the exam view converts to code points itself.
 */

export const UNDERLINE_OPEN = "<u>";
export const UNDERLINE_CLOSE = "</u>";

/** A [start, end) range in UTF-16 indexes of the source string. */
export type MarkupRange = { start: number; end: number };

export type UnderlineMarkup = {
  /** Every paired `<u>` / `</u>` tag: hidden when rendered. */
  tags: MarkupRange[];
  /** The text between each pair: drawn underlined. */
  underlined: MarkupRange[];
};

function insideAny(index: number, ranges: ReadonlyArray<MarkupRange>): boolean {
  return ranges.some((r) => index >= r.start && index < r.end);
}

/**
 * Paired underline tags in `source`, skipping any that start inside `skip` (maths ranges).
 */
export function findUnderlineMarkup(
  source: string,
  skip: ReadonlyArray<MarkupRange> = [],
): UnderlineMarkup {
  const tags: MarkupRange[] = [];
  const underlined: MarkupRange[] = [];
  let open: number | null = null;
  let i = 0;
  while (i < source.length) {
    if (source.startsWith(UNDERLINE_OPEN, i) && !insideAny(i, skip)) {
      // A second `<u>` before a close: the earlier one stays literal; pair from here.
      open = i;
      i += UNDERLINE_OPEN.length;
      continue;
    }
    if (source.startsWith(UNDERLINE_CLOSE, i) && !insideAny(i, skip)) {
      if (open !== null) {
        const innerStart = open + UNDERLINE_OPEN.length;
        tags.push({ start: open, end: innerStart });
        tags.push({ start: i, end: i + UNDERLINE_CLOSE.length });
        underlined.push({ start: innerStart, end: i });
        open = null;
      }
      i += UNDERLINE_CLOSE.length;
      continue;
    }
    i += 1;
  }
  return { tags, underlined };
}

export type MarkupPiece =
  | { kind: "text"; start: number; end: number; underlined: boolean }
  | { kind: "tag"; start: number; end: number };

/**
 * Splits [start, end) of the source into text pieces (each flagged underlined or not) and
 * tag pieces, in order. For callers that render a text run.
 */
export function splitByUnderlineMarkup(
  markup: UnderlineMarkup,
  start: number,
  end: number,
): MarkupPiece[] {
  const cuts = new Set<number>([start, end]);
  for (const r of [...markup.tags, ...markup.underlined]) {
    if (r.start > start && r.start < end) cuts.add(r.start);
    if (r.end > start && r.end < end) cuts.add(r.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const pieces: MarkupPiece[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const s = points[k]!;
    const e = points[k + 1]!;
    if (markup.tags.some((t) => t.start <= s && e <= t.end)) {
      pieces.push({ kind: "tag", start: s, end: e });
    } else {
      pieces.push({
        kind: "text",
        start: s,
        end: e,
        underlined: isUnderlined(markup, s, e),
      });
    }
  }
  return pieces;
}

/** True when [start, end) lies wholly inside one underlined range. */
export function isUnderlined(
  markup: UnderlineMarkup,
  start: number,
  end: number,
): boolean {
  return markup.underlined.some((r) => r.start <= start && end <= r.end);
}

// ── Content gate ─────────────────────────────────────────────────────────

/** A stem that points at an underlined target: "the underlined sentence/portion/word/...". */
const UNDERLINED_REFERENCE = /\bthe\s+underlined\b/i;

/** Anything shaped like an HTML tag: `<` then a letter, `/` or `!`, through the next `>`. */
const HTML_TAG = /<[A-Za-z/!][^<>]*>/g;

export type MarkupViolation = { field: string; message: string };

/**
 * The two authoring rules, as pure checks over one question's rendered text fields:
 *  1. a stem that references "the underlined ..." has exactly one paired `<u>...</u>` in its
 *     passage, with non-blank text between the tags;
 *  2. no field carries any tag other than the paired `<u>` / `</u>` — an unpaired or
 *     malformed `<u>` counts as raw HTML, because it would render as literal tag text.
 */
export function questionMarkupViolations(fields: {
  stem: string;
  passage: string | null;
  others: ReadonlyArray<{ field: string; value: string | null | undefined }>;
}): MarkupViolation[] {
  const out: MarkupViolation[] = [];
  const passage = fields.passage ?? "";
  if (UNDERLINED_REFERENCE.test(fields.stem)) {
    const { underlined } = findUnderlineMarkup(passage);
    const nonBlank = underlined.filter(
      (r) => passage.slice(r.start, r.end).trim().length > 0,
    );
    if (underlined.length !== 1 || nonBlank.length !== 1) {
      out.push({
        field: "passage",
        message:
          `MISSING_UNDERLINED_TARGET: the stem references "the underlined ..." but the passage ` +
          `has ${underlined.length} paired <u>...</u> span(s)` +
          (underlined.length === 1 ? " and it is blank" : "") +
          `; it must have exactly one, wrapping the target text.`,
      });
    }
  }
  const all = [
    { field: "stem", value: fields.stem },
    { field: "passage", value: fields.passage },
    ...fields.others,
  ];
  for (const { field, value } of all) {
    if (typeof value !== "string" || value.length === 0) continue;
    const paired = findUnderlineMarkup(value).tags;
    const stray = [...value.matchAll(HTML_TAG)]
      .filter(
        (m) =>
          !paired.some(
            (t) => t.start === m.index && t.end === m.index + m[0].length,
          ),
      )
      .map((m) => m[0]);
    if (stray.length > 0) {
      out.push({
        field,
        message:
          `RAW_HTML: ${field} carries ${[...new Set(stray)].slice(0, 3).join(", ")}; the only ` +
          `markup allowed in question content is a paired <u>...</u>.`,
      });
    }
  }
  return out;
}
