/**
 * @spec [owner brief "Video segments tagged by sub-skill and cluster", Karl 2026-10-29, Phase A
 *       steps 2 and 4; docs/plans/lisa-video-library/segments-phase-a.md §3.3, §5]
 *       | @implemented [2026-10-29]
 *
 * plain English: compares the two tagging passes of `segment-videos.ts` and keeps only what both
 * agree on, as the earlier library runs did (a value kept only when both runs saw it).
 *  - Boundaries: a cut inside the video agrees when the other pass cuts within ±15 s. A clip edge
 *    (every 10 minutes on a video over 15) is not a topic change and is not counted.
 *  - Segments: each pass-1 teaching segment is paired with the pass-2 teaching segment it
 *    overlaps most, when their intersection over union is at least 0.5.
 *  - Tags, per skill: Jaccard over the paired segments' tags (|both| / |either|), sub-skills and
 *    clusters separately. Tags of unpaired segments count as disagreements. A cluster belongs to
 *    the skills of the segment's sub-skills.
 *  - Kept: a paired segment keeps the tags both passes gave. Its times are the earlier start and
 *    the later end, so playback never starts after the teaching does.
 *  - The review CSV (Karl approves before anything is written): one row per segment, pre-marked
 *    `approve` (paired, kept sub-skills, the passes agree on every tag), `retag` (paired, but the
 *    passes disagree on some tag, or no sub-skill survived) or `drop` (not teaching, or unpaired),
 *    each `retag` and `drop` with a one-line reason.
 *
 * Usage: pnpm exec tsx scripts/rag/segment-agreement.ts --only <ids> [--taxonomy <path>]
 *          [--csv <out.csv>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

export const BOUNDARY_TOLERANCE_SECONDS = 15;
export const PAIR_MIN_IOU = 0.5;
export const CLIP_EDGE_SECONDS = 600;
const OUT_DIR = resolve("scripts/rag/.cache/segments");

const tagSchema = z.object({ id: z.string(), evidence: z.string() });
const segmentSchema = z.object({
  start_seconds: z.number(),
  end_seconds: z.number(),
  teaches_sat_content: z.boolean(),
  summary: z.string(),
  sub_skills: z.array(tagSchema),
  clusters: z.array(tagSchema),
  method_in_defaults: z.array(z.string()),
  rejected_ids: z.array(z.string()),
  not_in_taxonomy: z.string(),
});
export type Segment = z.infer<typeof segmentSchema>;
const passSchema = z.object({
  pass: z.number(),
  video_id: z.string(),
  duration_seconds: z.number(),
  taxonomy_version: z.string(),
  segments: z.array(segmentSchema),
  usage: z.object({ usd: z.number() }).passthrough(),
});
export type PassFile = z.infer<typeof passSchema>;

/** Internal cuts: every segment start but the first, minus clip edges on a clipped video. */
export function cutsOf(p: PassFile): number[] {
  const clipped = p.duration_seconds > 900;
  return p.segments
    .slice(1)
    .map((s) => s.start_seconds)
    .filter((t) => !(clipped && t % CLIP_EDGE_SECONDS === 0));
}

/** Greedy one-to-one matching of cuts within the tolerance. */
export function boundaryAgreement(
  a: number[],
  b: number[],
): { agreed: number; union: number } {
  const free = [...b];
  let agreed = 0;
  for (const t of a) {
    let best = -1;
    let bestD = Infinity;
    free.forEach((u, i) => {
      const d = Math.abs(u - t);
      if (d <= BOUNDARY_TOLERANCE_SECONDS && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best >= 0) {
      agreed += 1;
      free.splice(best, 1);
    }
  }
  return { agreed, union: a.length + b.length - agreed };
}

function iou(x: Segment, y: Segment): number {
  const inter = Math.max(
    0,
    Math.min(x.end_seconds, y.end_seconds) -
      Math.max(x.start_seconds, y.start_seconds),
  );
  const union =
    Math.max(x.end_seconds, y.end_seconds) -
    Math.min(x.start_seconds, y.start_seconds);
  return union === 0 ? 0 : inter / union;
}

export type Pair = { a: Segment; b: Segment };

/** Pairs teaching segments one-to-one by best overlap (IoU ≥ 0.5). */
export function pairSegments(
  a: Segment[],
  b: Segment[],
): { pairs: Pair[]; onlyA: Segment[]; onlyB: Segment[] } {
  const ta = a.filter((s) => s.teaches_sat_content);
  const free = b.filter((s) => s.teaches_sat_content);
  const pairs: Pair[] = [];
  const onlyA: Segment[] = [];
  for (const s of ta) {
    let best = -1;
    let bestIou = PAIR_MIN_IOU;
    free.forEach((u, i) => {
      const v = iou(s, u);
      if (v >= bestIou) {
        best = i;
        bestIou = v;
      }
    });
    const match = best >= 0 ? free.splice(best, 1)[0] : undefined;
    if (match) pairs.push({ a: s, b: match });
    else onlyA.push(s);
  }
  return { pairs, onlyA, onlyB: free };
}

export type SkillAgreement = {
  skill: string;
  subSkills: { both: number; either: number };
  clusters: { both: number; either: number };
};

/**
 * Per-skill Jaccard. `skillOf` maps a sub-skill id to its skill. Clusters count toward every
 * skill of the segment's sub-skills (from either pass). Unpaired segments add only to `either`.
 */
export function skillAgreement(
  pairs: Pair[],
  unpaired: Segment[],
  skillOf: (subSkillId: string) => string | undefined,
): SkillAgreement[] {
  const acc = new Map<string, SkillAgreement>();
  const bump = (
    skill: string,
    kind: "subSkills" | "clusters",
    both: number,
    either: number,
  ): void => {
    const cur = acc.get(skill) ?? {
      skill,
      subSkills: { both: 0, either: 0 },
      clusters: { both: 0, either: 0 },
    };
    cur[kind].both += both;
    cur[kind].either += either;
    acc.set(skill, cur);
  };
  const ids = (tags: Array<{ id: string }>): Set<string> =>
    new Set(tags.map((t) => t.id));
  const skillsOf = (subs: Set<string>): Set<string> =>
    new Set([...subs].map(skillOf).filter((s): s is string => s !== undefined));
  for (const { a, b } of pairs) {
    const sa = ids(a.sub_skills);
    const sb = ids(b.sub_skills);
    for (const skill of skillsOf(new Set([...sa, ...sb]))) {
      const inSkill = (x: Set<string>): Set<string> =>
        new Set([...x].filter((id) => skillOf(id) === skill));
      const xa = inSkill(sa);
      const xb = inSkill(sb);
      const both = [...xa].filter((id) => xb.has(id)).length;
      bump(skill, "subSkills", both, xa.size + xb.size - both);
      const ca = ids(a.clusters);
      const cb = ids(b.clusters);
      const cboth = [...ca].filter((id) => cb.has(id)).length;
      bump(skill, "clusters", cboth, ca.size + cb.size - cboth);
    }
  }
  for (const s of unpaired) {
    const subs = ids(s.sub_skills);
    for (const skill of skillsOf(subs)) {
      bump(
        skill,
        "subSkills",
        0,
        [...subs].filter((id) => skillOf(id) === skill).length,
      );
      bump(skill, "clusters", 0, s.clusters.length);
    }
  }
  return [...acc.values()].sort((x, y) => x.skill.localeCompare(y.skill));
}

export type ReviewRow = {
  video_id: string;
  start_seconds: number;
  end_seconds: number;
  proposal: "approve" | "retag" | "drop";
  reason: string;
  sub_skills: string[];
  clusters: string[];
  disputed_sub_skills: string[];
  disputed_clusters: string[];
  summary: string;
  not_in_taxonomy: string;
};

/** One review row per segment of pass 1 (paired or not), plus pass-2-only teaching segments. */
export function reviewRows(
  videoId: string,
  p1: PassFile,
  p2: PassFile,
): ReviewRow[] {
  const { pairs, onlyA, onlyB } = pairSegments(p1.segments, p2.segments);
  const rows: ReviewRow[] = [];
  const pairOf = new Map(pairs.map((p) => [p.a, p]));
  const onlyASet = new Set(onlyA);
  for (const s of p1.segments) {
    if (!s.teaches_sat_content) {
      rows.push(
        row(
          videoId,
          s,
          "drop",
          "not teaching (intro, outro, promotion or general advice)",
          [],
          [],
          [],
          [],
        ),
      );
      continue;
    }
    const pair = pairOf.get(s);
    if (pair === undefined || onlyASet.has(s)) {
      rows.push(
        row(
          videoId,
          s,
          "drop",
          "pass 2 found no matching segment (IoU < 0.5)",
          [],
          [],
          ids(s.sub_skills),
          ids(s.clusters),
        ),
      );
      continue;
    }
    const sa = new Set(ids(pair.a.sub_skills));
    const sb = new Set(ids(pair.b.sub_skills));
    const ca = new Set(ids(pair.a.clusters));
    const cb = new Set(ids(pair.b.clusters));
    const keptS = [...sa].filter((id) => sb.has(id)).sort();
    const keptC = [...ca].filter((id) => cb.has(id)).sort();
    const disS = [...new Set([...sa, ...sb])]
      .filter((id) => !(sa.has(id) && sb.has(id)))
      .sort();
    const disC = [...new Set([...ca, ...cb])]
      .filter((id) => !(ca.has(id) && cb.has(id)))
      .sort();
    const merged: Segment = {
      ...s,
      start_seconds: Math.min(pair.a.start_seconds, pair.b.start_seconds),
      end_seconds: Math.max(pair.a.end_seconds, pair.b.end_seconds),
      not_in_taxonomy: [pair.a.not_in_taxonomy, pair.b.not_in_taxonomy]
        .filter((x) => x !== "")
        .join(" / "),
    };
    if (keptS.length === 0) {
      rows.push(
        row(
          videoId,
          merged,
          "retag",
          "the passes share no sub-skill",
          keptS,
          keptC,
          disS,
          disC,
        ),
      );
    } else if (disS.length > 0 || disC.length > 0) {
      rows.push(
        row(
          videoId,
          merged,
          "retag",
          `the passes disagree on ${disS.length + disC.length} tag(s); only shared tags kept`,
          keptS,
          keptC,
          disS,
          disC,
        ),
      );
    } else {
      rows.push(row(videoId, merged, "approve", "", keptS, keptC, [], []));
    }
  }
  for (const s of onlyB) {
    rows.push(
      row(
        videoId,
        s,
        "drop",
        "pass 1 found no matching segment (IoU < 0.5)",
        [],
        [],
        ids(s.sub_skills),
        ids(s.clusters),
      ),
    );
  }
  return rows.sort((x, y) => x.start_seconds - y.start_seconds);
}

function ids(tags: Array<{ id: string }>): string[] {
  return tags.map((t) => t.id);
}

function row(
  videoId: string,
  s: Segment,
  proposal: ReviewRow["proposal"],
  reason: string,
  subSkills: string[],
  clusters: string[],
  disputedSubSkills: string[],
  disputedClusters: string[],
): ReviewRow {
  return {
    video_id: videoId,
    start_seconds: s.start_seconds,
    end_seconds: s.end_seconds,
    proposal,
    reason,
    sub_skills: subSkills,
    clusters,
    disputed_sub_skills: disputedSubSkills,
    disputed_clusters: disputedClusters,
    summary: s.summary,
    not_in_taxonomy: s.not_in_taxonomy,
  };
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function reviewCsv(rows: ReviewRow[]): string {
  const header = [
    "approve",
    "proposal",
    "reason",
    "video_id",
    "start_s",
    "end_s",
    "sub_skills",
    "clusters",
    "disputed_sub_skills",
    "disputed_clusters",
    "summary",
    "not_in_taxonomy",
  ];
  const lines = rows.map((r) =>
    [
      r.proposal === "approve" ? "yes" : "",
      r.proposal,
      r.reason,
      r.video_id,
      String(r.start_seconds),
      String(r.end_seconds),
      r.sub_skills.join(";"),
      r.clusters.join(";"),
      r.disputed_sub_skills.join(";"),
      r.disputed_clusters.join(";"),
      r.summary,
      r.not_in_taxonomy,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[header.join(","), ...lines].join("\n")}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      only: { type: "string" },
      taxonomy: {
        type: "string",
        default: resolve("content/canonical/subskill-cluster-taxonomy.json"),
      },
      csv: { type: "string" },
    },
  });
  if (values.only === undefined) throw new Error("--only <ids> is required");
  const taxonomy = z
    .object({
      sub_skills: z.array(z.object({ id: z.string(), skill_code: z.string() })),
    })
    .parse(JSON.parse(readFileSync(values.taxonomy, "utf8")));
  const skillOfId = new Map(
    taxonomy.sub_skills.map((s) => [s.id, s.skill_code]),
  );
  const allRows: ReviewRow[] = [];
  const allPairs: Pair[] = [];
  const allUnpaired: Segment[] = [];
  let usd = 0;
  for (const id of values.only.split(",")) {
    const load = (n: number): PassFile =>
      passSchema.parse(
        JSON.parse(
          readFileSync(resolve(OUT_DIR, `${id}.pass${n}.json`), "utf8"),
        ),
      );
    const p1 = load(1);
    const p2 = load(2);
    usd += p1.usage.usd + p2.usage.usd;
    const b = boundaryAgreement(cutsOf(p1), cutsOf(p2));
    const { pairs, onlyA, onlyB } = pairSegments(p1.segments, p2.segments);
    allPairs.push(...pairs);
    allUnpaired.push(...onlyA, ...onlyB);
    process.stdout.write(
      `${id}: segments ${p1.segments.length}/${p2.segments.length} (teaching ${p1.segments.filter((s) => s.teaches_sat_content).length}/${p2.segments.filter((s) => s.teaches_sat_content).length}); boundaries agreed ${b.agreed}/${b.union}; paired ${pairs.length}, unpaired ${onlyA.length}+${onlyB.length}\n`,
    );
    allRows.push(...reviewRows(id, p1, p2));
  }
  for (const s of skillAgreement(allPairs, allUnpaired, (x) =>
    skillOfId.get(x),
  )) {
    const pct = (x: { both: number; either: number }): string =>
      x.either === 0
        ? "n/a"
        : `${Math.round((100 * x.both) / x.either)}% (${x.both}/${x.either})`;
    process.stdout.write(
      `skill ${s.skill}: sub-skills ${pct(s.subSkills)}; clusters ${pct(s.clusters)}\n`,
    );
  }
  const counts = { approve: 0, retag: 0, drop: 0 };
  for (const r of allRows) counts[r.proposal] += 1;
  process.stdout.write(
    `review rows: ${JSON.stringify(counts)}; both passes $${usd.toFixed(4)}\n`,
  );
  if (values.csv !== undefined) writeFileSync(values.csv, reviewCsv(allRows));
}

// R-16 (LISA_Video_RAG_Closure_Plan.md): the entry check that also matches a Windows path.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
