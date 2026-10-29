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
 *   S7 fixed mode: the given spans are kept exactly; every number answered once, or refused;
 *      topic changes land on the video's clock, inside their segment only.
 *   S8 one-topic rule (Karl, 2026-10-29 rule 2): split points cut chapters (and pass 1's cuts)
 *      strictly inside; a mixed or overview segment, flagged by EITHER pass, keeps clusters only
 *      and its sub-skills are set aside from agreement.
 *   S9 the corrected gate (rule 3): 70% on sub-skills, judged only for skills with at least 3
 *      tagged segments; fewer are reported, not gated; an empty judged set does not pass.
 *   S10 the review file carries each tag's evidence, and the apply reads it back (Phase B: the
 *       apply SQL is built from the reviewed file alone).
 *   S11 the apply refuses a bad file whole: unknown id, wrong section, span outside the video,
 *       overlap, a yes row with no tag, a video outside the library; drop and untagged rows are
 *       left out.
 *   S12 the apply SQL: one transaction, the vocabulary precondition first, one writer call per
 *       video, only yes rows approved, the approver a placeholder that fails the cast, and no
 *       text able to close its dollar quote.
 *   S13 the shopping list names every skill and sub-skill with no focused segment.
 *   S14 a skill below the gate has no row pre-marked for approval (held as retag, with the
 *       skill named); rows of passing skills and clusters-only rows are untouched.
 *   S15 Phase B ruling 2: a row with only clusters disputed is approved with the agreed tags;
 *       a disputed sub-skill, a teaching dispute and drop stay; the hold runs after and wins.
 *   S16 the spot-check sample: approved rows with sub-skills only, one skill per turn, the same
 *       draw for the same seed, each row's evidence narrowed to its sub-skills.
 */
import { describe, expect, it } from "vitest";
import {
  chapterClips,
  checkClipAnswer,
  checkFixedAnswer,
  clipsFromPass1,
  splitSpans,
  vocabularyFor,
  vocabularyText,
  type Taxonomy,
} from "../../scripts/rag/segment-videos";
import {
  APPROVER_PLACEHOLDER,
  buildApplySql,
  parseEvidence,
  parseReviewedSegments,
  type ApplyTaxonomy,
} from "../../scripts/rag/apply-video-segments";
import {
  CLUSTERS_ONLY,
  alignPasses,
  CLUSTER_DISPUTE_APPROVED,
  approveClusterOnlyDisputes,
  coverageReport,
  evidenceCell,
  gate,
  holdFailedSkills,
  spotCheckSample,
  reviewCsv,
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
    topic_change_seconds: [],
    overview: false,
  };
}

function overview(x: Segment): Segment {
  return { ...x, overview: true };
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
            overview: false,
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
            overview: false,
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
          overview: false,
        },
        {
          start: "4:00",
          end: end2,
          teaches_sat_content: true,
          summary: "s",
          sub_skills: [{ id: "EE.5", evidence: "e" }],
          clusters: [],
          not_in_taxonomy: "",
          overview: false,
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
    // Pass 2 flagged it as mixing topics, so rule 2 keeps clusters only (S8 covers the rule).
    expect(rows[1]).toMatchObject({
      start_seconds: 20,
      end_seconds: 100,
      sub_skills: [],
      clusters: ["CL.0001"],
      mixes_topics_note: "mixed (pass 2) / expanding, then factoring at 1:00",
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
        // 1:00 is before segment 2 on the video's clock (10:00 + 1:00 = 660 < 700): dropped.
        topic_changes: number === 2 ? ["2:00", "1:00"] : ["0:30"],
        overview: number === 1,
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
    expect(ok.segments.map((s) => s.topic_change_seconds)).toEqual([[], [720]]);
    expect(ok.segments.map((s) => s.overview)).toEqual([true, false]);
    expect(checkFixedAnswer(ans([1]), given, M)).toMatchObject({ ok: false });
    expect(checkFixedAnswer(ans([1, 1, 2]), given, M)).toMatchObject({
      ok: false,
    });
    expect(checkFixedAnswer(ans([1, 3]), given, M)).toMatchObject({
      ok: false,
    });
  });

  it("S8 one-topic rule: splits cut inside spans; mixed or overview keeps clusters only", () => {
    expect(
      splitSpans(
        [
          { start: 0, end: 100, title: "A" },
          { start: 100, end: 300, title: "" },
        ],
        [50, 100, 102, 200, 299],
      ),
    ).toEqual([
      { start: 0, end: 50, title: "A, part 1 of 2" },
      { start: 50, end: 100, title: "A, part 2 of 2" },
      { start: 100, end: 200, title: "" },
      { start: 200, end: 300, title: "" },
    ]);
    const ch = [
      { title: "A", start_seconds: 0, end_seconds: 500 },
      { title: "B", start_seconds: 500, end_seconds: 1000 },
    ];
    const clips = chapterClips(ch, 1000, [450, 700]);
    expect(clips?.map((c) => c.segments?.map((g) => [g.start, g.end]))).toEqual(
      [
        [
          [0, 450],
          [450, 500],
        ],
        [
          [500, 700],
          [700, 1000],
        ],
      ],
    );
    expect(
      clipsFromPass1(
        [{ start: 0, end: 400 }],
        [{ start: 0, end: 400 }],
        [150],
      )[0]?.segments,
    ).toEqual([
      { start: 0, end: 150, title: "" },
      { start: 150, end: 400, title: "" },
    ]);

    // Focus is a union of the passes: one pass's flag makes the segment clusters-only.
    const p1 = passFile(
      [
        seg(0, 100, ["EE.2"], ["CL.0001"]),
        overview(seg(100, 200, ["LF.1", "EE.5"], ["CL.0215"])),
        seg(200, 300, ["PCT.1"], ["CL.0222"]),
      ],
      300,
    );
    const p2 = passFile(
      [
        seg(0, 100, ["EE.2"], ["CL.0001"]),
        seg(100, 200, ["EE.2"], ["CL.0215"]),
        seg(
          200,
          300,
          ["PCT.1"],
          ["CL.0222"],
          true,
          "percent, then ratios at 4:10",
        ),
      ],
      300,
    );
    const aligned = alignPasses(p1.segments, p2.segments);
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) return;
    expect(aligned.focus).toEqual(["focused", "overview", "mixed"]);
    expect(
      aligned.pairs.map((p) => [p.a.sub_skills.length, p.b.sub_skills.length]),
    ).toEqual([
      [1, 1],
      [0, 0],
      [0, 0],
    ]);
    const skillOf = (id: string): string | undefined =>
      TAXONOMY.sub_skills.find((x) => x.id === id)?.skill_code;
    const agree = skillAgreement(aligned.pairs, aligned.unpaired, skillOf);
    // Only the focused segment counts toward Equivalent Expressions; nothing toward Percentages.
    expect(
      agree.find((x) => x.skill === "Equivalent Expressions"),
    ).toMatchObject({
      segments: 1,
      subSkills: { both: 1, either: 1 },
    });
    expect(agree.find((x) => x.skill === "Percentages")).toBeUndefined();
    expect(agree.find((x) => x.skill === CLUSTERS_ONLY)?.clusters).toEqual({
      both: 2,
      either: 2,
    });
    const rows = reviewRows("a1QNaRnn6cE", p1, p2);
    expect(rows.map((r) => r.proposal)).toEqual([
      "approve",
      "approve",
      "approve",
    ]);
    expect(rows[1]).toMatchObject({ sub_skills: [], clusters: ["CL.0215"] });
    expect(rows[1]?.reason).toContain("overview, flagged by pass 1");
    expect(rows[1]?.reason).toContain("set aside: EE.2;EE.5;LF.1");
    expect(rows[2]?.reason).toContain("mixed, flagged by pass 2");
    expect(rows[2]?.mixes_topics_note).toContain(
      "percent, then ratios at 4:10",
    );
  });

  it("S9 the corrected gate: judged at 3 or more segments, 70%, never on nothing", () => {
    const row = (
      skill: string,
      segments: number,
      both: number,
      either: number,
    ) => ({
      skill,
      segments,
      subSkills: { both, either },
      clusters: { both: 0, either: 0 },
    });
    const g = gate([
      row("Equivalent Expressions", 3, 7, 10),
      row("Linear Functions", 2, 0, 3),
      row(CLUSTERS_ONLY, 9, 0, 0),
    ]);
    expect(g.judged.map((j) => [j.skill, j.passes])).toEqual([
      ["Equivalent Expressions", true],
    ]);
    expect(g.reported.map((r) => r.skill)).toEqual(["Linear Functions"]);
    expect(g.passed).toBe(true);
    expect(gate([row("Equivalent Expressions", 4, 6, 10)]).passed).toBe(false);
    expect(gate([row("Equivalent Expressions", 2, 0, 5)]).passed).toBe(false);
    expect(gate([]).passed).toBe(false);
    // Segment counts come from the tagged segments themselves (one per segment per skill).
    const agree = skillAgreement(
      [
        { a: seg(0, 1, ["EE.2", "EE.5"]), b: seg(0, 1, ["EE.2"]) },
        { a: seg(1, 2, ["EE.2"]), b: seg(1, 2, []) },
      ],
      [seg(2, 3, ["EE.3"])],
      (id) =>
        TAXONOMY.sub_skills.find((x) => x.id === id)?.skill_code ??
        (id.startsWith("EE.") ? "Equivalent Expressions" : undefined),
    );
    expect(
      agree.find((x) => x.skill === "Equivalent Expressions")?.segments,
    ).toBe(3);
  });

  it("S10 evidence travels in the review file and back", () => {
    const a = seg(0, 100, ["EE.2"], ["CL.0001"]);
    const b = seg(0, 100, ["EE.2", "EE.5"], ["CL.0001"]);
    a.sub_skills[0] = { id: "EE.2", evidence: "expands | combines" };
    b.sub_skills[1] = { id: "EE.5", evidence: "only pass 2" };
    const cell = evidenceCell(["EE.2", "EE.5", "CL.0001", "CL.9999"], a, b);
    expect(cell).toBe(
      "EE.2: expands / combines | EE.5: only pass 2 | CL.0001: e",
    );
    expect([...parseEvidence(cell)]).toEqual([
      ["EE.2", "expands / combines"],
      ["EE.5", "only pass 2"],
      ["CL.0001", "e"],
    ]);
    const rows = reviewRows(
      "a1QNaRnn6cE",
      passFile([a], 100),
      passFile([b], 100),
    );
    // Kept tags first (sub-skills, clusters), then the disputed ones.
    expect(rows[0]?.evidence).toBe(
      "EE.2: expands / combines | CL.0001: e | EE.5: only pass 2",
    );
    expect(reviewCsv(rows).split("\n")[0]).toMatch(/,evidence$/);
  });

  const APPLY_TAX: ApplyTaxonomy = {
    taxonomy_version: "scl-test",
    sub_skills: TAXONOMY.sub_skills.map((x) => ({
      id: x.id,
      skill_code: x.skill_code,
      section: x.section,
    })),
    clusters: TAXONOMY.clusters.map((x) => ({
      id: x.id,
      skills_seen_in: x.skills_seen_in,
    })),
  };
  const VIDEOS = new Map([
    [
      "a1QNaRnn6cE",
      { video_id: "a1QNaRnn6cE", duration_seconds: 398, section: "M" as const },
    ],
    [
      "qQzeFyLYt1A",
      { video_id: "qQzeFyLYt1A", duration_seconds: 48, section: "M" as const },
    ],
  ]);
  const HEADER =
    "approve,proposal,reason,video_id,start_s,end_s,sub_skills,clusters,disputed_sub_skills,disputed_clusters,boundary_flag,summary,not_in_taxonomy,evidence";
  const line = (cells: string[]): string => cells.join(",");

  it("S11 the apply refuses a bad file whole and leaves out drop and untagged rows", () => {
    const good = [
      HEADER,
      line([
        "yes",
        "approve",
        "",
        "a1QNaRnn6cE",
        "0",
        "158",
        "EE.5",
        "CL.0215",
        "",
        "",
        "",
        "rational",
        "",
        "EE.5: graphs both",
      ]),
      line([
        "",
        "retag",
        "r",
        "a1QNaRnn6cE",
        "158",
        "257",
        "EE.2;EE.5",
        "",
        "",
        "",
        "",
        "expand",
        "",
        "",
      ]),
      line([
        "",
        "drop",
        "not teaching",
        "a1QNaRnn6cE",
        "358",
        "398",
        "",
        "",
        "",
        "",
        "",
        "outro",
        "",
        "",
      ]),
      line([
        "",
        "retag",
        "r",
        "qQzeFyLYt1A",
        "0",
        "48",
        "",
        "",
        "EE.1",
        "",
        "",
        "foil",
        "",
        "",
      ]),
    ].join("\n");
    const ok = parseReviewedSegments(good, APPLY_TAX, VIDEOS);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.segments.map((x) => [x.start_seconds, x.approve])).toEqual([
      [0, true],
      [158, false],
    ]);
    expect(ok.segments[0]?.sub_skills).toEqual([
      { id: "EE.5", evidence: "graphs both" },
    ]);
    expect(ok.segments[1]?.sub_skills[0]?.evidence).toBe("added in review");

    const bad = [
      HEADER,
      line([
        "yes",
        "approve",
        "",
        "a1QNaRnn6cE",
        "0",
        "158",
        "EE.9",
        "",
        "",
        "",
        "",
        "s",
        "",
        "",
      ]),
      line([
        "",
        "retag",
        "",
        "a1QNaRnn6cE",
        "100",
        "200",
        "WIC.1",
        "",
        "",
        "",
        "",
        "s",
        "",
        "",
      ]),
      line([
        "",
        "retag",
        "",
        "a1QNaRnn6cE",
        "300",
        "400",
        "EE.2",
        "CL.9999",
        "",
        "",
        "",
        "s",
        "",
        "",
      ]),
      line([
        "yes",
        "retag",
        "",
        "qQzeFyLYt1A",
        "0",
        "48",
        "",
        "",
        "",
        "",
        "",
        "s",
        "",
        "",
      ]),
      line([
        "yes",
        "approve",
        "",
        "ZZZZZZZZZZZ",
        "0",
        "10",
        "EE.2",
        "",
        "",
        "",
        "",
        "s",
        "",
        "",
      ]),
    ].join("\n");
    const refused = parseReviewedSegments(bad, APPLY_TAX, VIDEOS);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    const all = refused.errors.join("\n");
    for (const want of [
      "EE.9 is not a sub-skill",
      "WIC.1 is a RW sub-skill on a M video",
      "span 300-400 is outside a1QNaRnn6cE",
      "CL.9999 is not a cluster",
      "marked yes with no tag",
      "ZZZZZZZZZZZ is not an approved library video",
      "segments at 0 and 100 overlap",
    ]) {
      expect(all).toContain(want);
    }
  });

  it("S12 the apply SQL: one transaction, precondition, one call per video, placeholder approver", () => {
    const segs = [
      {
        video_id: "a1QNaRnn6cE",
        start_seconds: 158,
        end_seconds: 257,
        summary: "uses $seg$ in text",
        sub_skills: [{ id: "EE.5", evidence: "e" }],
        clusters: [],
        approve: false,
      },
      {
        video_id: "a1QNaRnn6cE",
        start_seconds: 0,
        end_seconds: 158,
        summary: "s",
        sub_skills: [],
        clusters: [{ id: "CL.0215", evidence: "e" }],
        approve: true,
      },
    ];
    const sql = buildApplySql(segs, "scl-test", "segment-tags-v4", 4);
    expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.indexOf("DO $pre$"));
    expect(sql.indexOf("DO $pre$")).toBeLessThan(
      sql.indexOf("video_segments_set"),
    );
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain("taxonomy_version = $seg$scl-test$seg$) <> 4");
    expect(sql.match(/video_segments_set\(/g)).toHaveLength(1);
    // Start order inside the one call; the summary's "$seg$" forces a longer tag.
    const call =
      sql.split("\n").find((l) => l.includes("video_segments_set(")) ?? "";
    expect(call.indexOf('"start_seconds":0')).toBeLessThan(
      call.indexOf('"start_seconds":158'),
    );
    expect(call).toContain("$segx$[");
    expect(sql).toContain("('a1QNaRnn6cE', 0)");
    expect(sql).not.toContain("('a1QNaRnn6cE', 158)");
    expect(sql).toContain(`'${APPROVER_PLACEHOLDER}'::uuid`);
    const none = buildApplySql(
      [{ ...segs[0]!, approve: false }],
      "scl-test",
      "t",
      4,
    );
    expect(none).toContain("nothing to approve");
    expect(none).not.toContain("video_segments_approve");
  });

  it("S13 the shopping list names every uncovered skill and sub-skill", () => {
    const rows = reviewRows(
      "a1QNaRnn6cE",
      passFile(
        [seg(0, 100, ["EE.2"]), seg(100, 200, ["PCT.1"], [], false)],
        200,
      ),
      passFile(
        [seg(0, 100, ["EE.2"]), seg(100, 200, ["PCT.1"], [], false)],
        200,
      ),
    );
    const report = coverageReport(rows, APPLY_TAX.sub_skills);
    expect(report[0]).toBe(
      "coverage: 1/4 sub-skills and 1/3 skills have a focused segment",
    );
    expect(report).toContain("no focused segment, skill: M Percentages");
    expect(report).toContain("no focused segment, skill: RW Words in Context");
    expect(report).not.toContain(
      "no focused segment, skill: M Equivalent Expressions",
    );
    expect(report).toContain(
      "no focused segment, sub-skill: EE.5 [Equivalent Expressions]",
    );
  });

  it("S14 a skill below the gate is held for review, nothing else moves", () => {
    const p1 = passFile(
      [
        seg(0, 100, ["EE.2"]),
        seg(100, 200, ["PCT.1"]),
        seg(200, 300, [], ["CL.0215"]),
      ],
      300,
    );
    const rows = reviewRows("a1QNaRnn6cE", p1, p1);
    expect(rows.map((r) => r.proposal)).toEqual([
      "approve",
      "approve",
      "approve",
    ]);
    const skillOf = (id: string): string | undefined =>
      TAXONOMY.sub_skills.find((x) => x.id === id)?.skill_code;
    const result = gate([
      {
        skill: "Equivalent Expressions",
        segments: 3,
        subSkills: { both: 3, either: 3 },
        clusters: { both: 0, either: 0 },
      },
      {
        skill: "Percentages",
        segments: 4,
        subSkills: { both: 2, either: 4 },
        clusters: { both: 0, either: 0 },
      },
    ]);
    const held = holdFailedSkills(rows, result, skillOf);
    expect(held.map((r) => r.proposal)).toEqual([
      "approve",
      "retag",
      "approve",
    ]);
    expect(held[1]?.reason).toBe(
      "Percentages is below the gate (50% sub-skill agreement); held for review",
    );
    expect(held[1]?.sub_skills).toEqual(["PCT.1"]);
  });

  it("S15 only-clusters-disputed rows are approved with the agreed tags; the hold still wins", () => {
    const p1 = passFile(
      [
        seg(0, 100, ["EE.2"], ["CL.0001", "CL.0215"]),
        seg(100, 200, ["EE.2", "EE.5"], ["CL.0001"]),
        seg(200, 300, ["PCT.1"], ["CL.0222", "CL.0001"]),
        seg(300, 400, ["EE.2"], ["CL.0001"]),
        seg(400, 500, [], [], false),
        seg(500, 600, [], ["CL.0215"]),
      ],
      600,
    );
    const p2 = passFile(
      [
        seg(0, 100, ["EE.2"], ["CL.0001"]),
        seg(100, 200, ["EE.2"], ["CL.0215"]),
        seg(200, 300, ["PCT.1"], ["CL.0001"]),
        seg(300, 400, ["EE.2"], ["CL.0001"], false),
        seg(400, 500, [], [], false),
        seg(500, 600, [], [], false),
      ],
      600,
    );
    const rows = reviewRows("a1QNaRnn6cE", p1, p2);
    expect(rows.map((r) => r.proposal)).toEqual([
      "retag",
      "retag",
      "retag",
      "retag",
      "drop",
      "retag",
    ]);
    const promoted = approveClusterOnlyDisputes(rows);
    expect(promoted.map((r) => r.proposal)).toEqual([
      "approve", // only CL.0215 disputed
      "retag", // EE.5 disputed
      "approve", // only CL.0222 disputed
      "retag", // the passes disagree it teaches (a disputed sub-skill)
      "drop",
      "retag", // the passes disagree it teaches (clusters only): no tag is kept
    ]);
    expect(promoted[0]).toMatchObject({
      sub_skills: ["EE.2"],
      clusters: ["CL.0001"],
      disputed_clusters: ["CL.0215"],
      reason: CLUSTER_DISPUTE_APPROVED,
    });
    const skillOf = (id: string): string | undefined =>
      TAXONOMY.sub_skills.find((x) => x.id === id)?.skill_code;
    const failed = gate([
      {
        skill: "Percentages",
        segments: 3,
        subSkills: { both: 1, either: 3 },
        clusters: { both: 0, either: 0 },
      },
    ]);
    const held = holdFailedSkills(promoted, failed, skillOf);
    expect(held.map((r) => r.proposal)).toEqual([
      "approve",
      "retag",
      "retag",
      "retag",
      "drop",
      "retag",
    ]);
    expect(held[2]?.reason).toContain("Percentages is below the gate");
  });

  it("S16 the spot-check sample: approved with sub-skills, spread across skills, reproducible", () => {
    const rows = [
      ...[0, 100, 200, 300].map((s) => seg(s, s + 100, ["EE.2"], ["CL.0001"])),
      seg(400, 500, ["PCT.1"]),
      seg(500, 600, [], ["CL.0215"]),
      seg(600, 700, ["EE.5"], [], true),
    ];
    const p = passFile(rows, 700);
    const review = reviewRows("a1QNaRnn6cE", p, p);
    review[6] = { ...review[6]!, proposal: "retag" };
    const skillOf = (id: string): string | undefined =>
      TAXONOMY.sub_skills.find((x) => x.id === id)?.skill_code;
    const a = spotCheckSample(review, 3, skillOf);
    expect(a).toEqual(spotCheckSample(review, 3, skillOf));
    expect(a).toHaveLength(3);
    expect(new Set(a.map((x) => x.skill))).toEqual(
      new Set(["Equivalent Expressions", "Percentages"]),
    );
    expect(
      a.every((x) => x.sub_skills.length > 0 && x.start_seconds !== 600),
    ).toBe(true);
    expect(a.find((x) => x.skill === "Equivalent Expressions")?.evidence).toBe(
      "EE.2: e",
    );
    expect(spotCheckSample(review, 50, skillOf)).toHaveLength(5);
  });
});
