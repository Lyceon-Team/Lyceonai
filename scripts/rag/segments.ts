/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 B (chapters when present, fixed windows when not),
 *       §D.2 C (merge where boundary_confidence says an explanation spans a window edge),
 *       §D.2 E (automated gates; review sample: at least 5 per skill, seeded, recorded);
 *       Doc-03D_V1.2 §6.5 (provenance)] | @implemented [2026-10-15]
 *
 * plain English: the deterministic core of the build-time pipeline. No IO, no model calls.
 *  - `cutWindows` turns a transcript into candidate windows: a video's chapters where it has
 *    them, otherwise ~60-second windows that end on a cue boundary (never mid-cue), preferring
 *    the longest pause near the target length.
 *  - `mergeOnBoundary` joins consecutive teaching windows wherever either side says the
 *    explanation runs across the edge, up to a 180-second cap. This is load-bearing: chapters
 *    are rare in the seed set (R-8), so most boundaries are arbitrary, and a segment that ends
 *    mid-derivation is the most visible failure a student hits. A group that still begins or
 *    ends inside an explanation (the cap stopped the merge, or the neighbour was gated out) is
 *    marked `open_start` / `open_end`, and the caller drops it.
 *  - `segmentGateFailures` is the §D.2 E automated gate; `sharesVerbatimRun` is its
 *    no-transcript-verbatim check; `selectReviewSample` is the seeded per-skill sample.
 *
 * trade-offs: windows are cut on cue boundaries, so a window's length varies (45–75 s for a
 *  60 s target). Merge decisions come from the model's boundary judgement on each side of an
 *  edge (OR, not AND): a missed merge is a broken segment for a student, an extra merge is
 *  only a longer one.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Chapter } from "./sources";

export const transcriptCueSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
});
export type TranscriptCue = z.infer<typeof transcriptCueSchema>;

export type Window = { start: number; end: number; cues: TranscriptCue[] };

export const WINDOW_TARGET_SECONDS = 60;
export const SEGMENT_MIN_SECONDS = 20;
export const SEGMENT_MAX_SECONDS = 180;

/** Fixed windows over a run of cues. Never splits a cue; prefers the longest pause near target. */
function fixedWindows(cues: TranscriptCue[], target: number): Window[] {
  const out: Window[] = [];
  let startIdx = 0;
  while (startIdx < cues.length) {
    const first = cues[startIdx];
    if (first === undefined) break;
    const lo = first.start + target * 0.75;
    const hi = first.start + target * 1.25;
    let cutIdx = -1;
    let bestGap = -1;
    for (let i = startIdx; i < cues.length; i += 1) {
      const cue = cues[i];
      if (cue === undefined) break;
      if (cue.end < lo) continue;
      if (cue.end > hi) break;
      const gap = (cues[i + 1]?.start ?? cue.end) - cue.end;
      if (gap > bestGap) {
        bestGap = gap;
        cutIdx = i;
      }
    }
    if (cutIdx === -1) {
      // No cue ends inside [lo, hi]: take the first cue that ends at or past lo.
      cutIdx = startIdx;
      while (cutIdx < cues.length - 1 && (cues[cutIdx]?.end ?? 0) < lo)
        cutIdx += 1;
    }
    const slice = cues.slice(startIdx, cutIdx + 1);
    out.push({
      start: slice[0]?.start ?? 0,
      end: slice[slice.length - 1]?.end ?? 0,
      cues: slice,
    });
    startIdx = cutIdx + 1;
  }
  // A short tail joins the window before it rather than standing alone.
  const last = out[out.length - 1];
  const prev = out[out.length - 2];
  if (last && prev && last.end - last.start < SEGMENT_MIN_SECONDS) {
    out.splice(out.length - 2, 2, {
      start: prev.start,
      end: last.end,
      cues: [...prev.cues, ...last.cues],
    });
  }
  return out;
}

function cuesBetween(
  cues: TranscriptCue[],
  start: number,
  end: number,
): TranscriptCue[] {
  return cues.filter((c) => c.start >= start && c.start < end);
}

/**
 * Candidate windows for one video: its chapters where present (a chapter over the cap is
 * re-cut into fixed windows inside it), otherwise fixed windows.
 */
export function cutWindows(
  cues: TranscriptCue[],
  chapters: Chapter[],
  target: number = WINDOW_TARGET_SECONDS,
): Window[] {
  if (chapters.length === 0) return fixedWindows(cues, target);
  const out: Window[] = [];
  for (const ch of chapters) {
    const inside = cuesBetween(cues, ch.start_seconds, ch.end_seconds);
    if (inside.length === 0) continue;
    if (ch.end_seconds - ch.start_seconds <= SEGMENT_MAX_SECONDS) {
      out.push({ start: ch.start_seconds, end: ch.end_seconds, cues: inside });
    } else {
      out.push(...fixedWindows(inside, target));
    }
  }
  return out;
}

export const proposedSegmentSchema = z.object({
  start_seconds: z.number().int().nonnegative(),
  end_seconds: z.number().int().nonnegative(),
  teaches_sat_content: z.boolean(),
  summary: z.string(),
});
export type ProposedSegment = z.infer<typeof proposedSegmentSchema>;

/** Seconds of gap, overlap or end mismatch tolerated (and closed) in a proposed tiling. */
export const TILING_TOLERANCE_SECONDS = 3;

export type Segmentation =
  | { ok: true; segments: ProposedSegment[] }
  | { ok: false; error: string };

/**
 * Checks and normalises a whole-video segmentation proposed by the model (video source, R-14).
 * The segments must tile [0, duration] in order; gaps and overlaps up to the tolerance are
 * closed by moving each start onto the previous end. Anything worse is refused, never patched:
 * a tiling that skips or repeats content is not one this pipeline can trust. Length is NOT
 * enforced here — an over-cap teaching segment is the caller's open-ended drop.
 */
export function normalizeSegmentation(
  proposed: ProposedSegment[],
  durationSeconds: number,
): Segmentation {
  if (proposed.length === 0) return { ok: false, error: "no segments" };
  const sorted = [...proposed].sort(
    (a, b) => a.start_seconds - b.start_seconds,
  );
  const out: ProposedSegment[] = [];
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.end_seconds <= seg.start_seconds) {
      return { ok: false, error: `empty segment at ${seg.start_seconds}s` };
    }
    if (Math.abs(seg.start_seconds - cursor) > TILING_TOLERANCE_SECONDS) {
      return {
        ok: false,
        error: `${seg.start_seconds > cursor ? "gap" : "overlap"} at ${cursor}s`,
      };
    }
    out.push({ ...seg, start_seconds: cursor });
    cursor = seg.end_seconds;
  }
  if (Math.abs(cursor - durationSeconds) > TILING_TOLERANCE_SECONDS) {
    return { ok: false, error: `ends at ${cursor}s of ${durationSeconds}s` };
  }
  const last = out[out.length - 1];
  if (last) out[out.length - 1] = { ...last, end_seconds: durationSeconds };
  return { ok: true, segments: out };
}

export function windowText(cues: TranscriptCue[]): string {
  return cues
    .map((c) => c.text.replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0)
    .join(" ");
}

export const windowAssessmentSchema = z.object({
  teaches_sat_content: z.boolean(),
  gate_reason: z.string(),
  starts_mid_explanation: z.boolean(),
  ends_mid_explanation: z.boolean(),
});
export type WindowAssessment = z.infer<typeof windowAssessmentSchema>;

export type SegmentGroup = {
  /** indices into the window list, consecutive */
  windows: number[];
  start: number;
  end: number;
  /**
   * The group begins or ends inside an explanation that runs past it: the cap stopped a
   * merge, or the neighbour across the edge was gated out. Such a group is a broken segment
   * for a student, so the caller drops it (and counts it in the run report).
   */
  open_start: boolean;
  open_end: boolean;
};

function midEdge(assessments: WindowAssessment[], left: number): boolean {
  return (
    (assessments[left]?.ends_mid_explanation ?? false) ||
    (assessments[left + 1]?.starts_mid_explanation ?? false)
  );
}

/**
 * Joins consecutive teaching windows across every edge either side marks as mid-explanation
 * (OR, not AND), while the merged span stays within `maxSeconds`. Gated-out windows are never
 * merged and break a chain. A video's first start and last end are never "open".
 */
export function mergeOnBoundary(
  windows: Window[],
  assessments: WindowAssessment[],
  maxSeconds: number = SEGMENT_MAX_SECONDS,
): SegmentGroup[] {
  if (windows.length !== assessments.length) {
    throw new Error(
      `mergeOnBoundary: ${windows.length} windows, ${assessments.length} assessments`,
    );
  }
  const raw: Array<{ windows: number[]; start: number; end: number }> = [];
  let current: { windows: number[]; start: number; end: number } | null = null;
  for (let i = 0; i < windows.length; i += 1) {
    const w = windows[i];
    const a = assessments[i];
    if (w === undefined || a === undefined) continue;
    if (!a.teaches_sat_content) {
      if (current) raw.push(current);
      current = null;
      continue;
    }
    if (
      current !== null &&
      midEdge(assessments, i - 1) &&
      w.end - current.start <= maxSeconds
    ) {
      current.windows.push(i);
      current.end = w.end;
      continue;
    }
    if (current) raw.push(current);
    current = { windows: [i], start: w.start, end: w.end };
  }
  if (current) raw.push(current);
  const lastIdx = windows.length - 1;
  return raw.map((g) => {
    const first = g.windows[0] ?? 0;
    const last = g.windows[g.windows.length - 1] ?? lastIdx;
    return {
      ...g,
      open_start: first > 0 && midEdge(assessments, first - 1),
      open_end: last < lastIdx && midEdge(assessments, last),
    };
  });
}

export function provenanceOf(
  videoId: string,
  start: number,
  end: number,
): string {
  return `youtube:${videoId}:${Math.floor(start)}-${Math.ceil(end)}`;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** True when `candidate` shares a run of `n` consecutive words with `source` (§D.2 E). */
export function sharesVerbatimRun(
  candidate: string,
  source: string,
  n = 8,
): boolean {
  const src = words(source);
  if (src.length < n) return false;
  const grams = new Set<string>();
  for (let i = 0; i + n <= src.length; i += 1)
    grams.add(src.slice(i, i + n).join(" "));
  const cand = words(candidate);
  for (let i = 0; i + n <= cand.length; i += 1) {
    if (grams.has(cand.slice(i, i + n).join(" "))) return true;
  }
  return false;
}

export const DESCRIPTION_MIN_CHARS = 120;
export const DESCRIPTION_MAX_CHARS = 900;

export type SegmentForGate = {
  provenance: string;
  start: number;
  end: number;
  duration_seconds: number;
  description: string;
  skill_codes: string[];
};

/** §D.2 E automated gate. Returns the reasons a segment fails; empty means it passes. */
export function segmentGateFailures(
  seg: SegmentForGate,
  taxonomy: ReadonlySet<string>,
  seenProvenance: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  const length = seg.end - seg.start;
  if (!(seg.start < seg.end)) out.push("start not before end");
  if (seg.start < 0 || seg.end > seg.duration_seconds + 1)
    out.push("bounds outside the video");
  if (length < SEGMENT_MIN_SECONDS)
    out.push(`shorter than ${SEGMENT_MIN_SECONDS}s`);
  if (length > SEGMENT_MAX_SECONDS)
    out.push(`longer than ${SEGMENT_MAX_SECONDS}s`);
  if (seg.description.length < DESCRIPTION_MIN_CHARS)
    out.push("description too short");
  if (seg.description.length > DESCRIPTION_MAX_CHARS)
    out.push("description too long");
  if (seg.skill_codes.length === 0) out.push("no skill");
  for (const s of seg.skill_codes)
    if (!taxonomy.has(s)) out.push(`skill not in taxonomy: ${s}`);
  if (seenProvenance.has(seg.provenance)) out.push("duplicate provenance");
  return out;
}

/**
 * The per-skill review sample (Karl, 2026-10-13): at least `perSkill` segments for every
 * skill tagged in the run, or all of a skill's segments when it has fewer. The order is a
 * hash of seed + provenance, so the same seed reproduces the same sample. A segment tagged
 * with several skills can serve each.
 */
export function selectReviewSample<
  T extends { provenance: string; skill_codes: string[] },
>(rows: T[], seed: string, perSkill = 5): Map<string, T[]> {
  const rank = (p: string): string =>
    createHash("sha256").update(`${seed}\u0000${p}`).digest("hex");
  const bySkill = new Map<string, T[]>();
  for (const row of rows) {
    for (const skill of row.skill_codes) {
      const list = bySkill.get(skill) ?? [];
      list.push(row);
      bySkill.set(skill, list);
    }
  }
  const out = new Map<string, T[]>();
  for (const skill of [...bySkill.keys()].sort()) {
    const list = [...(bySkill.get(skill) ?? [])].sort((a, b) =>
      rank(a.provenance) < rank(b.provenance) ? -1 : 1,
    );
    out.set(skill, list.slice(0, perSkill));
  }
  return out;
}
