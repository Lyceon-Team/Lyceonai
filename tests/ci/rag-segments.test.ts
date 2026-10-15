/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 B, C, E] | @implemented [2026-10-15]
 *
 * plain English: the deterministic core of the ingestion pipeline. Windows never split a cue
 * and cover the transcript in order; chapters win when present; merge-on-boundary joins
 * across every mid-explanation edge up to the cap and flags anything still open; the
 * automated gate and the seeded per-skill sample behave as the plan says.
 */
import { describe, expect, it } from "vitest";
import {
  SEGMENT_MAX_SECONDS,
  cutWindows,
  mergeOnBoundary,
  fromClockSegments,
  normalizeSegmentation,
  parseClock,
  provenanceOf,
  segmentGateFailures,
  selectReviewSample,
  sharesVerbatimRun,
  type TranscriptCue,
  type Window,
  type WindowAssessment,
} from "../../scripts/rag/segments";

/** Cues of `len` seconds back to back, with a longer pause after every `pauseEvery`th cue. */
function cues(
  total: number,
  len = 4,
  pauseEvery = 0,
  pause = 2,
): TranscriptCue[] {
  const out: TranscriptCue[] = [];
  let t = 0;
  let i = 0;
  while (t + len <= total) {
    out.push({ start: t, end: t + len, text: `cue ${i}` });
    t += len + (pauseEvery > 0 && (i + 1) % pauseEvery === 0 ? pause : 0.2);
    i += 1;
  }
  return out;
}

const teach = (starts_mid = false, ends_mid = false): WindowAssessment => ({
  teaches_sat_content: true,
  gate_reason: "teaches",
  starts_mid_explanation: starts_mid,
  ends_mid_explanation: ends_mid,
});
const promo: WindowAssessment = {
  teaches_sat_content: false,
  gate_reason: "channel promo",
  starts_mid_explanation: false,
  ends_mid_explanation: false,
};
const win = (start: number, end: number): Window => ({ start, end, cues: [] });

describe("cutWindows", () => {
  it("covers every cue once, in order, never splitting one", () => {
    const c = cues(355);
    const w = cutWindows(c, []);
    expect(w.length).toBeGreaterThan(3);
    expect(w.flatMap((x) => x.cues)).toEqual(c);
    for (const x of w) {
      expect(x.start).toBe(x.cues[0]?.start);
      expect(x.end).toBe(x.cues[x.cues.length - 1]?.end);
    }
  });

  it("keeps fixed windows near the 60 s target and folds a short tail into the last", () => {
    const w = cutWindows(cues(330), []);
    for (const x of w.slice(0, -1)) {
      expect(x.end - x.start).toBeGreaterThanOrEqual(44);
      expect(x.end - x.start).toBeLessThanOrEqual(76);
    }
    const tail = w[w.length - 1];
    expect(tail && tail.end - tail.start).toBeGreaterThanOrEqual(20);
  });

  it("cuts at the longest pause inside the target band", () => {
    // a 3 s pause after every 12th cue (~50 s) — inside [45, 75]
    const w = cutWindows(cues(200, 4, 12, 3), []);
    const first = w[0];
    const c = cues(200, 4, 12, 3);
    expect(first?.end).toBe(c[11]?.end);
  });

  it("uses chapters when present, and re-cuts a chapter over the cap", () => {
    const c = cues(400);
    const w = cutWindows(c, [
      { title: "intro", start_seconds: 0, end_seconds: 90 },
      { title: "long", start_seconds: 90, end_seconds: 400 },
    ]);
    expect(w[0]?.start).toBe(0);
    expect(w[0]?.end).toBe(90);
    expect(w.length).toBeGreaterThan(2);
    for (const x of w.slice(1))
      expect(x.end - x.start).toBeLessThanOrEqual(SEGMENT_MAX_SECONDS);
  });
});

describe("clock times (video source)", () => {
  it("parses M:SS and H:MM:SS, and refuses the fused form the model once wrote", () => {
    expect(parseClock("0:00")).toBe(0);
    expect(parseClock("5:46")).toBe(346);
    expect(parseClock("12:03")).toBe(723);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(parseClock("546")).toBeNull();
    expect(parseClock("5:76")).toBeNull();
    expect(parseClock("")).toBeNull();
  });

  it("converts a proposal, or names the unparseable time", () => {
    expect(
      fromClockSegments([
        { start: "0:00", end: "5:46", teaches_sat_content: true, summary: "s" },
      ]),
    ).toEqual({
      ok: true,
      segments: [
        {
          start_seconds: 0,
          end_seconds: 346,
          teaches_sat_content: true,
          summary: "s",
        },
      ],
    });
    expect(
      fromClockSegments([
        { start: "0:00", end: "546", teaches_sat_content: true, summary: "s" },
      ]),
    ).toEqual({ ok: false, error: "unparseable time 546" });
  });
});

describe("normalizeSegmentation (video source)", () => {
  const seg = (a: number, b: number, t = true) => ({
    start_seconds: a,
    end_seconds: b,
    teaches_sat_content: t,
    summary: "s",
  });

  it("accepts a tiling, closes small gaps and overlaps, and snaps the end", () => {
    const r = normalizeSegmentation(
      [seg(0, 14, false), seg(15, 112), seg(111, 228), seg(228, 353)],
      355,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segments.map((x) => [x.start_seconds, x.end_seconds])).toEqual([
      [0, 14],
      [14, 112],
      [112, 228],
      [228, 355],
    ]);
  });

  it("sorts an out-of-order proposal", () => {
    const r = normalizeSegmentation([seg(60, 120), seg(0, 60)], 120);
    expect(r.ok && r.segments[0]?.start_seconds).toBe(0);
  });

  it("refuses gaps, overlaps, empty segments and a wrong end", () => {
    expect(normalizeSegmentation([seg(0, 50), seg(60, 120)], 120)).toEqual({
      ok: false,
      error: "gap at 50s",
    });
    expect(normalizeSegmentation([seg(0, 70), seg(60, 120)], 120)).toEqual({
      ok: false,
      error: "overlap at 70s",
    });
    expect(normalizeSegmentation([seg(0, 0)], 10).ok).toBe(false);
    expect(normalizeSegmentation([seg(0, 100)], 120)).toEqual({
      ok: false,
      error: "ends at 100s of 120s",
    });
    expect(normalizeSegmentation([], 120).ok).toBe(false);
  });
});

describe("mergeOnBoundary", () => {
  const w4 = [win(0, 60), win(60, 120), win(120, 180), win(180, 240)];

  it("joins across an edge when the left side ends mid-explanation", () => {
    const g = mergeOnBoundary(w4.slice(0, 2), [teach(false, true), teach()]);
    expect(g.map((x) => x.windows)).toEqual([[0, 1]]);
  });

  it("joins across an edge when the right side starts mid-explanation", () => {
    const g = mergeOnBoundary(w4.slice(0, 2), [teach(), teach(true, false)]);
    expect(g.map((x) => x.windows)).toEqual([[0, 1]]);
  });

  it("keeps clean edges apart", () => {
    const g = mergeOnBoundary(w4.slice(0, 2), [teach(), teach()]);
    expect(g.map((x) => x.windows)).toEqual([[0], [1]]);
    expect(g.every((x) => !x.open_start && !x.open_end)).toBe(true);
  });

  it("never merges a gated-out window, and flags the explanation it interrupts", () => {
    const g = mergeOnBoundary(w4.slice(0, 3), [
      teach(false, true),
      promo,
      teach(),
    ]);
    expect(g.map((x) => x.windows)).toEqual([[0], [2]]);
    expect(g[0]?.open_end).toBe(true);
    expect(g[1]?.open_start).toBe(false);
  });

  it("stops at the cap and flags both sides of the cut", () => {
    const g = mergeOnBoundary(w4, [
      teach(false, true),
      teach(true, true),
      teach(true, true),
      teach(true, false),
    ]);
    expect(g.map((x) => x.windows)).toEqual([[0, 1, 2], [3]]);
    expect(g[0]?.end).toBe(180);
    expect(g[0]?.open_end).toBe(true);
    expect(g[1]?.open_start).toBe(true);
  });

  it("does not call a video's last window open at its end", () => {
    const g = mergeOnBoundary(w4.slice(0, 1), [teach(false, true)]);
    expect(g[0]?.open_end).toBe(false);
  });

  it("refuses mismatched inputs", () => {
    expect(() => mergeOnBoundary(w4, [teach()])).toThrow();
  });
});

describe("provenance and the automated gate", () => {
  const taxonomy = new Set(["Linear Functions", "Circles"]);
  const ok = {
    provenance: provenanceOf("TFmt1VwZte8", 12.4, 71.2),
    start: 12.4,
    end: 71.2,
    duration_seconds: 355,
    description: "x".repeat(200),
    skill_codes: ["Linear Functions"],
  };

  it("provenance matches the migration's video format", () => {
    expect(ok.provenance).toBe("youtube:TFmt1VwZte8:12-72");
    expect(ok.provenance).toMatch(/^youtube:[A-Za-z0-9_-]{11}:[0-9]+-[0-9]+$/);
  });

  it("passes a good segment and names each failure", () => {
    expect(segmentGateFailures(ok, taxonomy, new Set())).toEqual([]);
    const bad = segmentGateFailures(
      { ...ok, end: 20, description: "short", skill_codes: ["Made Up Skill"] },
      taxonomy,
      new Set([ok.provenance]),
    );
    expect(bad).toEqual([
      "shorter than 20s",
      "description too short",
      "skill not in taxonomy: Made Up Skill",
      "duplicate provenance",
    ]);
    expect(
      segmentGateFailures({ ...ok, skill_codes: [] }, taxonomy, new Set()),
    ).toEqual(["no skill"]);
  });

  it("detects an 8-word verbatim run and ignores shorter overlap", () => {
    const src =
      "so now we type y equals two x plus three into desmos and look at the line";
    expect(
      sharesVerbatimRun(
        "Then type y equals two x plus three into Desmos.",
        src,
      ),
    ).toBe(true);
    expect(
      sharesVerbatimRun(
        "Enter the equation y = 2x + 3 in Desmos and read the line.",
        src,
      ),
    ).toBe(false);
  });
});

describe("selectReviewSample", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    provenance: `youtube:AAAAAAAAAAA:${i * 60}-${i * 60 + 60}`,
    skill_codes: i < 9 ? ["Linear Functions"] : ["Circles"],
  }));

  it("takes 5 per skill, or every segment of a smaller skill", () => {
    const s = selectReviewSample(rows, "tier1-2026-10-15");
    expect(s.get("Linear Functions")?.length).toBe(5);
    expect(s.get("Circles")?.length).toBe(3);
  });

  it("is reproducible from its seed", () => {
    const a = selectReviewSample(rows, "seed-a").get("Linear Functions");
    const b = selectReviewSample(rows, "seed-a").get("Linear Functions");
    expect(a?.map((r) => r.provenance)).toEqual(b?.map((r) => r.provenance));
  });
});
