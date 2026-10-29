/**
 * The video segment tagger's deterministic half: what the code enforces regardless of the model.
 *
 * @spec [owner brief "Video segments tagged by sub-skill and cluster", Karl 2026-10-29 (tag by
 *       id only; method_in present by default, never tagged; several tags, no primary; keep only
 *       what two passes agree on); docs/plans/lisa-video-library/segments-phase-a.md §3]
 *       | @implemented [2026-10-29]
 *
 * plain English:
 *   S1 an id outside the closed list is rejected and reported, never kept.
 *   S2 a method_in cluster in its own skill is moved to method_in_defaults, not tagged.
 *   S3 clip times are offset onto the video's clock; a gap or a short tiling is refused.
 *   S4 boundaries agree within ±15 s, one-to-one; clip edges are not counted as cuts.
 *   S5 pairing needs IoU ≥ 0.5; per-skill agreement is Jaccard, unpaired tags count against it.
 *   S6 review proposals: approve on full agreement, retag on any disagreement (shared tags only),
 *      drop for non-teaching or unpaired segments, each with a reason.
 */
import { describe, expect, it } from "vitest";
import {
  checkClipAnswer,
  vocabularyFor,
  vocabularyText,
  type Taxonomy,
} from "../../scripts/rag/segment-videos";
import {
  boundaryAgreement,
  cutsOf,
  pairSegments,
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
  };
}

function passFile(segments: Segment[], duration: number): PassFile {
  return {
    pass: 1,
    video_id: "a1QNaRnn6cE",
    duration_seconds: duration,
    taxonomy_version: "scl-test",
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

  it("S4 boundaries agree within 15 s, one to one; clip edges are not cuts", () => {
    expect(boundaryAgreement([60, 200, 400], [70, 230, 401])).toEqual({
      agreed: 2,
      union: 4,
    });
    expect(boundaryAgreement([60], [55, 65])).toEqual({ agreed: 1, union: 2 });
    const long = passFile(
      [
        seg(0, 300, ["EE.2"]),
        seg(300, 600, ["EE.2"]),
        seg(600, 1000, ["EE.5"]),
      ],
      1000,
    );
    expect(cutsOf(long)).toEqual([300]);
  });

  it("S5 pairing and per-skill Jaccard", () => {
    const a = [
      seg(0, 100, ["EE.2", "EE.5"], ["CL.0001"]),
      seg(100, 200, ["PCT.1"]),
    ];
    const b = [seg(0, 110, ["EE.5"], ["CL.0001"]), seg(150, 400, ["PCT.1"])];
    const { pairs, onlyA, onlyB } = pairSegments(a, b);
    expect(pairs).toHaveLength(1);
    expect(onlyA).toHaveLength(1);
    expect(onlyB).toHaveLength(1);
    const skillOf = (id: string): string | undefined =>
      TAXONOMY.sub_skills.find((s) => s.id === id)?.skill_code;
    const agree = skillAgreement(pairs, [...onlyA, ...onlyB], skillOf);
    const ee = agree.find((x) => x.skill === "Equivalent Expressions");
    expect(ee?.subSkills).toEqual({ both: 1, either: 2 });
    expect(ee?.clusters).toEqual({ both: 1, either: 1 });
    expect(agree.find((x) => x.skill === "Percentages")?.subSkills).toEqual({
      both: 0,
      either: 2,
    });
  });

  it("S6 review proposals, each non-approval with a reason; times widen to both passes", () => {
    const p1 = passFile(
      [
        seg(0, 20, [], [], false),
        seg(20, 100, ["EE.2"], ["CL.0001"]),
        seg(100, 200, ["EE.2", "EE.5"]),
      ],
      200,
    );
    const p2 = passFile(
      [
        seg(0, 15, [], [], false),
        seg(15, 100, ["EE.2"], ["CL.0001"]),
        seg(100, 200, ["EE.5"]),
      ],
      200,
    );
    const rows = reviewRows("a1QNaRnn6cE", p1, p2);
    expect(rows.map((r) => r.proposal)).toEqual(["drop", "approve", "retag"]);
    expect(rows[1]).toMatchObject({
      start_seconds: 15,
      end_seconds: 100,
      sub_skills: ["EE.2"],
      clusters: ["CL.0001"],
    });
    expect(rows[2]).toMatchObject({
      sub_skills: ["EE.5"],
      disputed_sub_skills: ["EE.2"],
    });
    for (const r of rows.filter((x) => x.proposal !== "approve"))
      expect(r.reason).not.toBe("");
  });
});
