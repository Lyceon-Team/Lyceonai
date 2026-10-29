/**
 * @spec [owner brief "Video segments tagged by sub-skill and cluster", Karl 2026-10-29, Phase A
 *       steps 2 and 4, as amended by the Phase A rulings of 2026-10-29 (2: cluster-only
 *       segments; 5: agreement on tags only, over the same segments; mixed-topic flags to
 *       review); docs/plans/lisa-video-library/segments-phase-a.md §3.3, §5]
 *       | @implemented [2026-10-29]
 *
 * plain English: compares the two tagging passes of `segment-videos.ts` and keeps only what both
 * agree on, as the earlier library runs did (a value kept only when both runs saw it).
 *  - Segments: both passes tag the SAME segments (chapters, or pass 1's cuts; ruling 5), so they
 *    are aligned one to one by time. Files whose spans differ are refused, not paired loosely.
 *  - Tags, per skill: Jaccard over the aligned segments' tags (|both| / |either|), sub-skills and
 *    clusters separately. A cluster belongs to the skills of the segment's sub-skills (either
 *    pass); on a segment neither pass gave a sub-skill (ruling 2: calculator technique), clusters
 *    count under CLUSTERS_ONLY. A segment one pass calls teaching and the other does not counts
 *    its tags as disagreements.
 *  - Kept: a segment keeps the tags both passes gave.
 *  - Boundary check: pass 2's `mixes_topics` flags are reported and carried into the review CSV,
 *    separately from tag agreement.
 *  - The review CSV (Karl approves before anything is written): one row per segment, pre-marked
 *    `approve` (both passes agree on every tag; sub-skills kept, or clusters only where neither
 *    pass gave a sub-skill), `retag` (some tag disputed, or nothing shared) or `drop` (not
 *    teaching), each `retag` and `drop` with a one-line reason.
 *
 * Usage: pnpm exec tsx scripts/rag/segment-agreement.ts --only <ids> [--taxonomy <path>]
 *          [--csv <out.csv>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { SEGMENTS_DIR } from "./segment-videos";

/** The skill label for clusters on segments with no sub-skill in either pass (ruling 2). */
export const CLUSTERS_ONLY = "(clusters only)";

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
  mixes_topics: z.boolean(),
  mixes_topics_note: z.string(),
});
export type Segment = z.infer<typeof segmentSchema>;
const passSchema = z.object({
  pass: z.number(),
  video_id: z.string(),
  duration_seconds: z.number(),
  taxonomy_version: z.string(),
  boundaries: z.enum(["chapters", "pass1_cuts"]),
  segments: z.array(segmentSchema),
  usage: z.object({ usd: z.number() }).passthrough(),
});
export type PassFile = z.infer<typeof passSchema>;

export type Pair = { a: Segment; b: Segment };

/**
 * Pure. Aligns the passes' segments one to one by index; the spans must be identical (both
 * passes tagged the same boundaries). Pairs are the segments both call teaching; `unpaired` are
 * those only one calls teaching (the teaching side's segment).
 */
export function alignPasses(
  a: Segment[],
  b: Segment[],
):
  | { ok: true; pairs: Pair[]; unpaired: Segment[] }
  | { ok: false; error: string } {
  if (a.length !== b.length) {
    return {
      ok: false,
      error: `segment counts differ: ${a.length} vs ${b.length}`,
    };
  }
  const pairs: Pair[] = [];
  const unpaired: Segment[] = [];
  for (const [i, x] of a.entries()) {
    const y = b[i];
    if (
      y === undefined ||
      x.start_seconds !== y.start_seconds ||
      x.end_seconds !== y.end_seconds
    ) {
      return { ok: false, error: `segment ${i + 1} spans differ` };
    }
    if (x.teaches_sat_content && y.teaches_sat_content)
      pairs.push({ a: x, b: y });
    else if (x.teaches_sat_content) unpaired.push(x);
    else if (y.teaches_sat_content) unpaired.push(y);
  }
  return { ok: true, pairs, unpaired };
}

export type SkillAgreement = {
  skill: string;
  subSkills: { both: number; either: number };
  clusters: { both: number; either: number };
};

/**
 * Pure. Per-skill Jaccard. `skillOf` maps a sub-skill id to its skill. Clusters count toward
 * every skill of the segment's sub-skills (from either pass), or toward CLUSTERS_ONLY when neither
 * pass gave one. Unpaired segments add only to `either`.
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
  const clusterAgreement = (a: Segment, b: Segment): [number, number] => {
    const ca = ids(a.clusters);
    const cb = ids(b.clusters);
    const cboth = [...ca].filter((id) => cb.has(id)).length;
    return [cboth, ca.size + cb.size - cboth];
  };
  for (const { a, b } of pairs) {
    const sa = ids(a.sub_skills);
    const sb = ids(b.sub_skills);
    const skills = skillsOf(new Set([...sa, ...sb]));
    if (skills.size === 0) {
      bump(CLUSTERS_ONLY, "clusters", ...clusterAgreement(a, b));
      continue;
    }
    for (const skill of skills) {
      const inSkill = (x: Set<string>): Set<string> =>
        new Set([...x].filter((id) => skillOf(id) === skill));
      const xa = inSkill(sa);
      const xb = inSkill(sb);
      const both = [...xa].filter((id) => xb.has(id)).length;
      bump(skill, "subSkills", both, xa.size + xb.size - both);
      bump(skill, "clusters", ...clusterAgreement(a, b));
    }
  }
  for (const s of unpaired) {
    const subs = ids(s.sub_skills);
    const skills = skillsOf(subs);
    if (skills.size === 0)
      bump(CLUSTERS_ONLY, "clusters", 0, s.clusters.length);
    for (const skill of skills) {
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
  /** Pass 2's boundary check (ruling 5); "" when not flagged. */
  mixes_topics_note: string;
  summary: string;
  not_in_taxonomy: string;
};

/** Pure. One review row per segment, in time order. Throws when the passes' spans differ. */
export function reviewRows(
  videoId: string,
  p1: PassFile,
  p2: PassFile,
): ReviewRow[] {
  const aligned = alignPasses(p1.segments, p2.segments);
  if (!aligned.ok) throw new Error(`${videoId}: ${aligned.error}`);
  const rows: ReviewRow[] = [];
  for (const [i, s] of p1.segments.entries()) {
    const t = p2.segments[i];
    if (t === undefined) continue;
    const flag = t.mixes_topics
      ? t.mixes_topics_note === ""
        ? "flagged"
        : t.mixes_topics_note
      : "";
    const base = {
      ...s,
      mixes_topics_note: flag,
      not_in_taxonomy: [s.not_in_taxonomy, t.not_in_taxonomy]
        .filter((x) => x !== "")
        .join(" / "),
    };
    if (!s.teaches_sat_content && !t.teaches_sat_content) {
      rows.push(
        row(
          videoId,
          base,
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
    if (s.teaches_sat_content !== t.teaches_sat_content) {
      const teaching = s.teaches_sat_content ? s : t;
      rows.push(
        row(
          videoId,
          base,
          "retag",
          "the passes disagree on whether it teaches SAT content",
          [],
          [],
          ids(teaching.sub_skills),
          ids(teaching.clusters),
        ),
      );
      continue;
    }
    const sa = new Set(ids(s.sub_skills));
    const sb = new Set(ids(t.sub_skills));
    const ca = new Set(ids(s.clusters));
    const cb = new Set(ids(t.clusters));
    const keptS = [...sa].filter((id) => sb.has(id)).sort();
    const keptC = [...ca].filter((id) => cb.has(id)).sort();
    const disS = [...new Set([...sa, ...sb])]
      .filter((id) => !(sa.has(id) && sb.has(id)))
      .sort();
    const disC = [...new Set([...ca, ...cb])]
      .filter((id) => !(ca.has(id) && cb.has(id)))
      .sort();
    const clustersOnly = sa.size === 0 && sb.size === 0;
    if (keptS.length === 0 && !(clustersOnly && keptC.length > 0)) {
      rows.push(
        row(
          videoId,
          base,
          "retag",
          clustersOnly
            ? "no sub-skill in either pass and no shared cluster"
            : "the passes share no sub-skill",
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
          base,
          "retag",
          `the passes disagree on ${disS.length + disC.length} tag(s); only shared tags kept`,
          keptS,
          keptC,
          disS,
          disC,
        ),
      );
    } else {
      rows.push(
        row(
          videoId,
          base,
          "approve",
          clustersOnly ? "clusters only (ruling 2)" : "",
          keptS,
          keptC,
          [],
          [],
        ),
      );
    }
  }
  return rows;
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
    mixes_topics_note: s.mixes_topics_note,
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
    "boundary_flag",
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
      r.mixes_topics_note,
      r.summary,
      r.not_in_taxonomy,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[header.join(","), ...lines].join("\n")}\n`;
}

function pct(x: { both: number; either: number }): string {
  return x.either === 0
    ? "n/a"
    : `${Math.round((100 * x.both) / x.either)}% (${x.both}/${x.either})`;
}

function printAgreement(label: string, rows: SkillAgreement[]): void {
  for (const s of rows) {
    process.stdout.write(
      `${label} skill ${s.skill}: sub-skills ${pct(s.subSkills)}; clusters ${pct(s.clusters)}\n`,
    );
  }
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
  const skillOf = (x: string): string | undefined => skillOfId.get(x);
  const allRows: ReviewRow[] = [];
  const allPairs: Pair[] = [];
  const allUnpaired: Segment[] = [];
  let usd = 0;
  for (const id of values.only.split(",")) {
    const load = (n: number): PassFile =>
      passSchema.parse(
        JSON.parse(
          readFileSync(resolve(SEGMENTS_DIR, `${id}.pass${n}.json`), "utf8"),
        ),
      );
    const p1 = load(1);
    const p2 = load(2);
    usd += p1.usage.usd + p2.usage.usd;
    const aligned = alignPasses(p1.segments, p2.segments);
    if (!aligned.ok) throw new Error(`${id}: ${aligned.error}`);
    allPairs.push(...aligned.pairs);
    allUnpaired.push(...aligned.unpaired);
    const flags = p2.segments.filter((s) => s.mixes_topics);
    process.stdout.write(
      `${id} (${p1.boundaries}): ${p1.segments.length} segment(s), both teaching ${aligned.pairs.length}, teaching disputed ${aligned.unpaired.length}; pass-2 boundary flags ${flags.length}\n`,
    );
    for (const f of flags) {
      process.stdout.write(
        `  flag ${f.start_seconds}-${f.end_seconds}s: ${f.mixes_topics_note}\n`,
      );
    }
    printAgreement(
      `  ${id}`,
      skillAgreement(aligned.pairs, aligned.unpaired, skillOf),
    );
    allRows.push(...reviewRows(id, p1, p2));
  }
  printAgreement("all", skillAgreement(allPairs, allUnpaired, skillOf));
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
