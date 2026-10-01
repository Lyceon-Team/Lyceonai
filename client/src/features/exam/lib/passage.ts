/**
 * Passage highlights — code-point offsets into the passage, maths left whole.
 *
 * @spec [SCL-145 (a highlight is a [start, end) range in Unicode CODE POINTS of the
 *        passage — what Postgres char_length counts — offsets only, no text);
 *        Doc 05E INV-05E-04 (no free text)]
 *       [E7b owner ruling 5; decision log D5]
 * @implemented [2026-09-25]
 *
 * plain English: the passage is cut into segments with MathRenderer's own tokenizer.
 * Text segments can be split anywhere; a maths token (and a `\$` escape, which is two
 * source characters drawn as one) is an ATOM that can only be highlighted whole, so a
 * selection that starts or ends inside a formula snaps outward to the formula's edges.
 * Every offset is a code-point index into the passage string exactly as the server
 * stores it, so what the server validates (0 <= start < end <= char_length) is what
 * this computes.
 *
 * trade-offs: text segments render as plain text, without MathRenderer's caret-
 * exponent enhancement (x^2 -> x<sup>2</sup>): that enhancement drops the caret, and
 * a highlight offset must count every source character. Passages are prose; maths in
 * a passage is written in $...$ and still renders through MathRenderer.
 */
import { tokenizeMathContent } from "@/components/MathRenderer";
import {
  EXAM_WORKSPACE_MAX_HIGHLIGHTS,
  type ExamHighlight,
} from "@lyceon/shared/exam-runtime-schema";

export type PassageSegment =
  | { kind: "text"; start: number; end: number; text: string; highlighted: boolean }
  | { kind: "math"; start: number; end: number; source: string; highlighted: boolean }
  | { kind: "escape"; start: number; end: number; text: string; highlighted: boolean };

type Piece =
  | { kind: "text"; start: number; end: number }
  | { kind: "math"; start: number; end: number }
  | { kind: "escape"; start: number; end: number };

/** UTF-16 index -> code-point index within `s`. */
function codePointIndex(s: string, utf16Index: number): number {
  return Array.from(s.slice(0, utf16Index)).length;
}

/** Pieces in CODE POINTS: text runs, maths atoms, `\$` escape atoms. */
function passagePieces(passage: string): Piece[] {
  const pieces: Piece[] = [];
  for (const token of tokenizeMathContent(passage)) {
    const start = codePointIndex(passage, token.rawStart);
    const end = codePointIndex(passage, token.rawEnd);
    if (end <= start) continue;
    if (token.type === "math") {
      pieces.push({ kind: "math", start, end });
      continue;
    }
    // Split the text run at every `\$` so each escape is an atom of its own.
    const raw = Array.from(passage.slice(token.rawStart, token.rawEnd));
    let runStart = 0;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "\\" && raw[i + 1] === "$") {
        if (i > runStart) pieces.push({ kind: "text", start: start + runStart, end: start + i });
        pieces.push({ kind: "escape", start: start + i, end: start + i + 2 });
        i += 1;
        runStart = i + 1;
      }
    }
    if (runStart < raw.length) {
      pieces.push({ kind: "text", start: start + runStart, end: start + raw.length });
    }
  }
  return pieces;
}

/** Sorted, disjoint, adjacent ranges merged. */
export function normalizeHighlights(
  highlights: ReadonlyArray<ExamHighlight>,
): ExamHighlight[] {
  const sorted = [...highlights]
    .filter((h) => h.start < h.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: ExamHighlight[] = [];
  for (const h of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && h.start <= last.end) {
      last.end = Math.max(last.end, h.end);
    } else {
      out.push({ start: h.start, end: h.end });
    }
  }
  return out;
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export function buildPassageSegments(
  passage: string,
  highlights: ReadonlyArray<ExamHighlight>,
): PassageSegment[] {
  const cps = Array.from(passage);
  const ranges = normalizeHighlights(highlights);
  const segments: PassageSegment[] = [];
  for (const piece of passagePieces(passage)) {
    if (piece.kind !== "text") {
      const highlighted = ranges.some((r) => overlaps(r, piece));
      const source = cps.slice(piece.start, piece.end).join("");
      segments.push(
        piece.kind === "math"
          ? { kind: "math", start: piece.start, end: piece.end, source, highlighted }
          : { kind: "escape", start: piece.start, end: piece.end, text: "$", highlighted },
      );
      continue;
    }
    const cuts = new Set<number>([piece.start, piece.end]);
    for (const r of ranges) {
      if (r.start > piece.start && r.start < piece.end) cuts.add(r.start);
      if (r.end > piece.start && r.end < piece.end) cuts.add(r.end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < points.length; i++) {
      const start = points[i]!;
      const end = points[i + 1]!;
      segments.push({
        kind: "text",
        start,
        end,
        text: cps.slice(start, end).join(""),
        highlighted: ranges.some((r) => r.start <= start && end <= r.end),
      });
    }
  }
  return segments;
}

/**
 * Widens [start, end) so it never cuts an atom; null when nothing is left. Offsets
 * outside the passage are clamped to it.
 */
export function snapRange(
  passage: string,
  start: number,
  end: number,
): ExamHighlight | null {
  const length = Array.from(passage).length;
  let s = Math.max(0, Math.min(start, end));
  let e = Math.min(length, Math.max(start, end));
  for (const piece of passagePieces(passage)) {
    if (piece.kind === "text") continue;
    if (piece.start < s && s < piece.end) s = piece.start;
    if (piece.start < e && e < piece.end) e = piece.end;
  }
  return s < e ? { start: s, end: e } : null;
}

export type HighlightEdit =
  | { ok: true; highlights: ExamHighlight[] }
  | { ok: false; reason: "empty" | "limit" };

export function addHighlight(
  passage: string,
  existing: ReadonlyArray<ExamHighlight>,
  start: number,
  end: number,
): HighlightEdit {
  const range = snapRange(passage, start, end);
  if (range === null) return { ok: false, reason: "empty" };
  const next = normalizeHighlights([...existing, range]);
  if (next.length > EXAM_WORKSPACE_MAX_HIGHLIGHTS) return { ok: false, reason: "limit" };
  return { ok: true, highlights: next };
}

/** Removes every highlight the range touches. */
export function removeHighlights(
  existing: ReadonlyArray<ExamHighlight>,
  start: number,
  end: number,
): ExamHighlight[] {
  const probe = { start: Math.min(start, end), end: Math.max(start, end, Math.min(start, end) + 1) };
  return normalizeHighlights(existing).filter((h) => !overlaps(h, probe));
}
