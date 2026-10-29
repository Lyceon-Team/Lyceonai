/**
 * The video segment tagger's deterministic half: what the code enforces regardless of the model.
 *
 * @spec [owner brief "Video segments tagged by sub-skill and cluster", Karl 2026-10-29 (tag by
 *       id only; method_in present by default, never tagged; several tags, no primary; keep only
 *       what two passes agree on), as amended by the Phase A rulings of 2026-10-29 (2: clusters
 *       only for calculator technique; 5: fixed boundaries, agreement on tags only, mixed-topic
 *       flags); docs/plans/lisa-video-library/segments-phase-a.md §3] | @implemented [2026-10-29]
 *
 * plain English:
 *   S1 an id outside the closed list is rejected and reported, never kept.
 *   S2 a method_in cluster in its own skill is moved to method_in_defaults, not tagged.
 *   S3 cut mode: clip times are offset onto the video's clock; a gap or a short tiling is refused.
 *   S4 fixed boundaries: chapters become clips that break only at chapter starts; a chapter over
 *      10 minutes is split; a malformed chapter list falls back (null); pass 2 reuses pass 1's.
 *   S5 alignment is by identical spans; per-skill agreement is Jaccard; a teaching dispute counts
 *      against it; cluster-only segments count under CLUSTERS_ONLY.
 *   S6 review proposals: approve on full agreement (clusters-only too), retag on any
 *      disagreement (shared tags only), drop for non-teaching, each non-approval with a reason;
 *      pass 2's boundary flag is carried.
 *   S7 fixed mode: the given spans are kept exactly; every number answered once, or refused.
 */
import { describe, expect, it } from "vitest";
import {
  chapterClips,
  checkClipAnswer,
  checkFixedAnswer,
  clipsFromPass1,
  vocabularyFor,
  vocabularyText,
  type Taxonomy,
} from "../../scripts/rag/segment-videos";
import {
  CLUSTERS_ONLY,
  alignPasses,
  reviewRows,
  skillAgreement,
  type PassFile,
  type Segment,
} from "../../scripts/rag/segment-agreement";

const TAXONOMY: Taxonomy = {
  taxonomy_version: "scl-test",
  sub_skills: [
    {
      id: "EE.2",
      skill_code: "Equivalent Expressions",
      section: "M",
      name: "Expand",
      definition: "d",
      inclusion_test: "t",
    },
    {
      id: "EE.5",
      skill_code: "Equivalent Expressions",
      section: "M",
      name: "Rational",
      definition: "d",
      inclusion_test: "t",
    },
    {
      id: "PCT.1",
      skill_code: "Percentages",
      section: "M",
      name: "Percent of",
      definition: "d",
      inclusion_test: "t",
    },
    {
      id: "WIC.1",
      skill_code: "Words in Context",
      section: "RW",
      name: "Meaning",
      definition: "d",
      inclusion_test: "t",
    },
  ],
  clusters: [
    {
      id: "CL.0001",
      display_name: "distribute",
      family: "by_hand_doing",
      definition: "d",
      skills_seen_in: ["Equivalent Expressions"],
      method_in: {},
    },
    {
      id: "CL.0222",
      display_name: "convert percent",
      family: "by_hand_doing",
      definition: "d",
      skills_seen_in: ["Percentages"],
      method_in: { Percentages: 0.934 },
    },
    {
      id: "CL.0215",
      display_name: "graph both",
      family: "desmos",
      definition: "d",
      skills_seen_in: ["Equivalent Expressions"],
      method_in: {},
      playbook_move: "Equivalent expressions",
    },
    {
      id: "CL.0100",
      display_name: "reading",
      family: "by_hand_recognizing",
      definition: "d",
      skills_seen_in: ["Words in Context"],
      method_in: {},
    },
  ],
};
const M = vocabularyFor(TAXONOMY, "M");

function seg(
  start: number,
  end: number,
  subs: string[],
  clusters: string[] = [],
  teaches = true,
  mixesNote = "",
): Segment {
  return {
    start_seconds: start,
    end_seconds: end,
    teaches_sat_content: teaches,
    summary: "s",
    sub_skills: subs.map((id) => ({ id, evidence: "e" })),
    clusters: clusters.map((id) => ({ id, evidence: "e" })),
    method_in_defaults: [],
    rejected_ids: [],
    not_in_taxonomy: "",
    mixes_topics: mixesNote !== "",
    mixes_topics_note: mixesNote,
  };
}

function passFile(segments: Segment[], duration: number): PassFile {
  return {
    pass: 1,
    video_id: "a1QNaRnn6cE",
    duration_seconds: duration,
    taxonomy_version: "scl-test",
    boundaries: "pass1_cuts",
    segments,
    usage: { usd: 0 },
  };
}

describe("segment tagging: what the code enforces", () => {
  it("S1 the closed list: only the section's ids are offered, and an unknown id is rejected", () => {
    expect(M.subSkills.map((s) => s.id)).toEqual(["EE.2", "EE.5", "PCT.1"]);
    expect(M.clusters.map((c) => c.id)).not.toContain("CL.0100");
    const text = vocabularyText(M, false);
    expect(text).toContain("EE.5 [Equivalent Expressions]");
    expect(vocabularyText(M, true).indexOf("EE.5")).toBeLessThan(
      vocabularyText(M, true).indexOf("EE.2"),
    );
    const r = checkClipAnswer(
      {
        segments: [
          {
            start: "0:00",
            end: "0:48",
            teaches_sat_content: true,
            summary: "s",
            sub_skills: [
              { id: "EE.2", evidence: "e" },
              { id: "EE.9", evidence: "invented" },
              { id: "WIC.1", evidence: "other section" },
            ],
            clusters: [
              { id: "CL.0001", evidence: "e" },
              { id: "CL.9999", evidence: "invented" },
            ],
            not_in_taxonomy: "",
          },
        ],
      },
      { start: 0, end: 48 },
      M,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segments[0]?.sub_skills.map((t) => t.id)).toEqual(["EE.2"]);
    expect(r.segments[0]?.clusters.map((t) => t.id)).toEqual(["CL.0001"]);
    expect(r.segments[0]?.rejected_ids.sort()).toEqual([
      "CL.9999",
      "EE.9",
      "WIC.1",
    ]);
  });

  it("S2 a method_in cluster in its own skill is a default, not a tag", () => {
    const r = checkClipAnswer(
      {
        segments: [
          {
            start: "0:00",
            end: "1:00",
            teaches_sat_content: true,
            summary: "s",
            sub_skills: [{ id: "PCT.1", evidence: "e" }],
            clusters: [{ id: "CL.0222", evidence: "e" }],
            not_in_taxonomy: "",
          },
        ],
      },
      { start: 0, end: 60 },
      M,
    );
    expect(r.ok && r.segments[0]?.clusters).toEqual([]);
    expect(r.ok && r.segments[0]?.method_in_defaults).toEqual(["CL.0222"]);
  });

  it("S3 clip times land on the video's clock; a gap or a short tiling is refused", () => {
    const answer = (end2: string) => ({
      segments: [
        {
          start: "0:00",
          end: "4:00",
          teaches_sat_content: false,
          summary: "s",
          sub_skills: [],
          clusters: [],
          not_in_taxonomy: "",
        },
        {
          start: "4:00",
          end: end2,
          teaches_sat_content: true,
          summary: "s",
          sub_skills: [{ id: "EE.5", evidence: "e" }],
          clusters: [],
          not_in_taxonomy: "",
        },
      ],
    });
    const ok = checkClipAnswer(answer("10:00"), { start: 600, end: 1200 }, M);
    expect(
      ok.ok && ok.segments.map((s) => [s.start_seconds, s.end_seconds]),
    ).toEqual([
      [600, 840],
      [840, 1200],
    ]);
    expect(
      checkClipAnswer(answer("8:00"), { start: 600, end: 1200 }, M),
    ).toMatchObject({ ok: false });
  });

  it("S4 fixed boundaries: chapter-aligned clips, long chapters split, bad lists fall back", () => {
    const ch = (title: string, a: number, b: number) => ({
      title,
      start_seconds: a,
      end_seconds: b,
    });
    const spans = (c: ReturnType<typeof chapterClips>) =>
      c?.map((x) => [
        x.start,
        x.end,
        x.segments?.map((g) => [g.start, g.end, g.title]),
      ]);
    expect(
      spans(
        chapterClips(
          [ch("A", 0, 100), ch("B", 100, 500), ch("C", 500, 1000)],
          1000,
        ),
      ),
    ).toEqual([
      [
        0,
        500,
        [
          [0, 100, "A"],
          [100, 500, "B"],
        ],
      ],
      [500, 1000, [[500, 1000, "C"]]],
    ]);
    expect(spans(chapterClips([ch("X", 0, 1500)], 1500))).toEqual([
      [0, 600, [[0, 600, "X"]]],
      [600, 1200, [[600, 1200, "X"]]],
      [1200, 1500, [[1200, 1500, "X"]]],
    ]);
    expect(
      spans(chapterClips([ch("A", 0, 100), ch("B", 100, 400)], 400)),
    ).toEqual([
      [
        0,
        400,
        [
          [0, 100, "A"],
          [100, 400, "B"],
        ],
      ],
    ]);
    expect(chapterClips([ch("A", 0, 100), ch("B", 150, 400)], 400)).toBeNull();
    expect(chapterClips([ch("A", 0, 100)], 400)).toBeNull();
    expect(chapterClips([], 400)).toBeNull();
    // Pass 2 on pass 1's cuts: same clips, pass 1's spans, no titles (nothing of pass 1's tags).
    expect(
      clipsFromPass1(
        [
          { start: 0, end: 600 },
          { start: 600, end: 1000 },
        ],
        [
          { start: 0, end: 250 },
          { start: 250, end: 600 },
          { start: 600, end: 1000 },
        ],
      ),
    ).toEqual([
      {
        start: 0,
        end: 600,
        segments: [
          { start: 0, end: 250, title: "" },
          { start: 250, end: 600, title: "" },
        ],
      },
      {
        start: 600,
        end: 1000,
        segments: [{ start: 600, end: 1000, title: "" }],
      },
    ]);
  });

  it("S5 alignment by identical spans and per-skill Jaccard", () => {
    const a = [
      seg(0, 100, ["EE.2", "EE.5"], ["CL.0001"]),
      seg(100, 200, ["PCT.1"]),
      seg(200, 300, [], ["CL.0215"]),
      seg(300, 400, ["EE.2"], [], false),
    ];
    const b = [
      seg(0, 100, ["EE.5"], ["CL.0001"]),
      seg(100, 200, [], [], false),
      seg(200, 300, [], ["CL.0215"]),
      seg(300, 400, [], [], false),
    ];
    const aligned = alignPasses(a, b);
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) return;
    expect(aligned.pairs).toHaveLength(2);
    expect(aligned.unpaired).toEqual([a[1]]);
    const skillOf = (id: string): string | undefined =>
      TAXONOMY.sub_skills.find((s) => s.id === id)?.skill_code;
    const agree = skillAgreement(aligned.pairs, aligned.unpaired, skillOf);
    const ee = agree.find((x) => x.skill === "Equivalent Expressions");
    expect(ee?.subSkills).toEqual({ both: 1, either: 2 });
    expect(ee?.clusters).toEqual({ both: 1, either: 1 });
    expect(agree.find((x) => x.skill === "Percentages")?.subSkills).toEqual({
      both: 0,
      either: 1,
    });
    expect(agree.find((x) => x.skill === CLUSTERS_ONLY)?.clusters).toEqual({
      both: 1,
      either: 1,
    });
    // A start-only and an end-only shift are each refused.
    expect(alignPasses(a, [...b.slice(0, 3), seg(310, 400, [])])).toMatchObject(
      {
        ok: false,
      },
    );
    expect(alignPasses(a, [...b.slice(0, 3), seg(300, 410, [])])).toMatchObject(
      {
        ok: false,
      },
    );
    expect(alignPasses(a, b.slice(0, 3))).toMatchObject({ ok: false });
  });

  it("S6 review proposals, each non-approval with a reason; the boundary flag is carried", () => {
    const p1 = passFile(
      [
        seg(0, 20, [], [], false),
        seg(20, 100, ["EE.2"], ["CL.0001"]),
        seg(100, 200, ["EE.2", "EE.5"]),
        seg(200, 260, [], ["CL.0215"]),
        seg(260, 300, ["PCT.1"]),
      ],
      300,
    );
    const p2 = passFile(
      [
        seg(0, 20, [], [], false),
        seg(
          20,
          100,
          ["EE.2"],
          ["CL.0001"],
          true,
          "expanding, then factoring at 1:00",
        ),
        seg(100, 200, ["EE.5"]),
        seg(200, 260, [], ["CL.0215"]),
        seg(260, 300, [], [], false),
      ],
      300,
    );
    const rows = reviewRows("a1QNaRnn6cE", p1, p2);
    expect(rows.map((r) => r.proposal)).toEqual([
      "drop",
      "approve",
      "retag",
      "approve",
      "retag",
    ]);
    expect(rows[1]).toMatchObject({
      start_seconds: 20,
      end_seconds: 100,
      sub_skills: ["EE.2"],
      clusters: ["CL.0001"],
      mixes_topics_note: "expanding, then factoring at 1:00",
    });
    expect(rows[2]).toMatchObject({
      sub_skills: ["EE.5"],
      disputed_sub_skills: ["EE.2"],
      mixes_topics_note: "",
    });
    expect(rows[3]).toMatchObject({ sub_skills: [], clusters: ["CL.0215"] });
    expect(rows[4]?.disputed_sub_skills).toEqual(["PCT.1"]);
    for (const r of rows.filter((x) => x.proposal !== "approve"))
      expect(r.reason).not.toBe("");
  });

  it("S7 fixed mode keeps the given spans; each number answered exactly once", () => {
    const given = [
      { start: 600, end: 700 },
      { start: 700, end: 1000 },
    ];
    const ans = (numbers: number[]) => ({
      segments: numbers.map((number) => ({
        number,
        teaches_sat_content: true,
        summary: "s",
        sub_skills: [
          { id: "EE.5", evidence: "e" },
          { id: "EE.9", evidence: "x" },
        ],
        clusters: [],
        not_in_taxonomy: "",
        mixes_topics: number === 2,
        mixes_topics_note: number === 2 ? "two kinds at 2:00" : "ignored",
      })),
    });
    const ok = checkFixedAnswer(ans([2, 1]), given, M);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.segments.map((s) => [s.start_seconds, s.end_seconds])).toEqual([
      [600, 700],
      [700, 1000],
    ]);
    expect(ok.segments[0]?.sub_skills.map((t) => t.id)).toEqual(["EE.5"]);
    expect(ok.segments[0]?.rejected_ids).toEqual(["EE.9"]);
    expect(ok.segments.map((s) => s.mixes_topics_note)).toEqual([
      "",
      "[times from 10:00] two kinds at 2:00",
    ]);
    expect(checkFixedAnswer(ans([1]), given, M)).toMatchObject({ ok: false });
    expect(checkFixedAnswer(ans([1, 1, 2]), given, M)).toMatchObject({
      ok: false,
    });
    expect(checkFixedAnswer(ans([1, 3]), given, M)).toMatchObject({
      ok: false,
    });
  });
});
