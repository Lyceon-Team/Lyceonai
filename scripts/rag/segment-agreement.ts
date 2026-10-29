/**
 * @spec [owner brief "Video segments tagged by sub-skill and cluster", Karl 2026-10-29, Phase A
 *       steps 2 and 4, as amended by the Phase A rulings of 2026-10-29 (2: cluster-only
 *       segments; 5: agreement on tags only, over the same segments; mixed-topic flags to
 *       review) and the re-pilot rulings of 2026-10-29 (2: one topic per segment; 3: the
 *       corrected gate); docs/plans/lisa-video-library/segments-phase-a.md §3, §5]
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
 *  - One topic (re-pilot rule 2): a segment EITHER pass calls mixed or an overview keeps clusters
 *    only; its sub-skills are set aside (listed in the review reason), not counted. Either pass, so
 *    a doubtful segment is never served as targeted teaching; the run prints who flagged each one
 *    and what the set-aside tags would have scored.
 *  - Gate (re-pilot rule 3): 70% sub-skill agreement, judged only for skills with at least 3
 *    tagged segments in the sample; fewer are reported, not gated (`gate`).
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
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  topic_change_seconds: z.array(z.number()),
  overview: z.boolean(),
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
 * The one-topic rule (2026-10-29 rule 2): a segment either pass flags as mixing topics, or as an
 * overview, is not targeted teaching and gets clusters only. Mixed outranks overview.
 */
export type Focus = "focused" | "mixed" | "overview";

export function focusOf(a: Segment, b: Segment): Focus {
  if (a.mixes_topics || b.mixes_topics) return "mixed";
  if (a.overview || b.overview) return "overview";
  return "focused";
}

/** Which passes raised the flag behind a segment's focus ("" when focused). */
export function flaggedBy(a: Segment, b: Segment, focus: Focus): string {
  if (focus === "focused") return "";
  const by = (x: Segment): boolean =>
    focus === "mixed" ? x.mixes_topics : x.overview;
  return by(a) && by(b) ? "both passes" : by(a) ? "pass 1" : "pass 2";
}

function clustersOnly(s: Segment): Segment {
  return { ...s, sub_skills: [] };
}

/**
 * Pure. Aligns the passes' segments one to one by index; the spans must be identical (both
 * passes tagged the same boundaries). Pairs are the segments both call teaching; `unpaired` are
 * those only one calls teaching (the teaching side's segment). A pair or unpaired segment that is
 * not focused has its sub-skills set aside, so it counts toward clusters only.
 */
export function alignPasses(
  a: Segment[],
  b: Segment[],
):
  | { ok: true; pairs: Pair[]; unpaired: Segment[]; focus: Focus[] }
  | { ok: false; error: string } {
  if (a.length !== b.length) {
    return {
      ok: false,
      error: `segment counts differ: ${a.length} vs ${b.length}`,
    };
  }
  const pairs: Pair[] = [];
  const unpaired: Segment[] = [];
  const focus: Focus[] = [];
  for (const [i, x] of a.entries()) {
    const y = b[i];
    if (
      y === undefined ||
      x.start_seconds !== y.start_seconds ||
      x.end_seconds !== y.end_seconds
    ) {
      return { ok: false, error: `segment ${i + 1} spans differ` };
    }
    const f = focusOf(x, y);
    focus.push(f);
    const fit = (s: Segment): Segment =>
      f === "focused" ? s : clustersOnly(s);
    if (x.teaches_sat_content && y.teaches_sat_content)
      pairs.push({ a: fit(x), b: fit(y) });
    else if (x.teaches_sat_content) unpaired.push(fit(x));
    else if (y.teaches_sat_content) unpaired.push(fit(y));
  }
  return { ok: true, pairs, unpaired, focus };
}

export type SkillAgreement = {
  skill: string;
  /** Teaching segments where either pass tagged a sub-skill of this skill (the gate's count). */
  segments: number;
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
      segments: 0,
      subSkills: { both: 0, either: 0 },
      clusters: { both: 0, either: 0 },
    };
    cur[kind].both += both;
    cur[kind].either += either;
    if (kind === "subSkills") cur.segments += 1;
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

/** The corrected gate (Karl, 2026-10-29 rule 3): judged only where a skill has this many segments. */
export const GATE_MIN_SEGMENTS = 3;
export const GATE_MIN_AGREEMENT = 0.7;

export type GateResult = {
  /** Skills with at least GATE_MIN_SEGMENTS tagged segments, each with its verdict. */
  judged: Array<SkillAgreement & { passes: boolean }>;
  /** Skills below the count: reported, not gated. */
  reported: SkillAgreement[];
  /** True only when at least one skill is judged and every judged skill passes. */
  passed: boolean;
};

/**
 * Pure. 70% sub-skill agreement (Jaccard), judged only for skills with at least 3 tagged
 * segments in the sample; the rest are reported, not gated. Clusters-only is never gated. An
 * empty judged set does not pass: a gate over nothing proves nothing. Phase B applies the same
 * rule per skill across the full library.
 */
export function gate(agreements: SkillAgreement[]): GateResult {
  const subSkillRows = agreements.filter((a) => a.skill !== CLUSTERS_ONLY);
  const judged = subSkillRows
    .filter((a) => a.segments >= GATE_MIN_SEGMENTS)
    .map((a) => ({
      ...a,
      passes:
        a.subSkills.either > 0 &&
        a.subSkills.both / a.subSkills.either >= GATE_MIN_AGREEMENT,
    }));
  return {
    judged,
    reported: subSkillRows.filter((a) => a.segments < GATE_MIN_SEGMENTS),
    passed: judged.length > 0 && judged.every((j) => j.passes),
  };
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
  /**
   * One evidence line per tag on the row, kept or disputed ("ID: line | ID: line"), pass 1's line
   * where it gave the tag, else pass 2's. The reviewed file carries it, so the apply SQL is built
   * from the file alone.
   */
  evidence: string;
};

/** "ID: line | ID: line", one line per id, pass 1's first. A "|" in a line becomes "/". */
export function evidenceCell(ids: string[], ...segments: Segment[]): string {
  const lineOf = (id: string): string | undefined => {
    for (const seg of segments) {
      const t = [...seg.sub_skills, ...seg.clusters].find((x) => x.id === id);
      if (t !== undefined) return t.evidence;
    }
    return undefined;
  };
  return [...new Set(ids)]
    .flatMap((id) => {
      const line = lineOf(id);
      return line === undefined
        ? []
        : [`${id}: ${line.replace(/\|/g, "/").replace(/\s+/g, " ").trim()}`];
    })
    .join(" | ");
}

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
    const focus = aligned.focus[i] ?? "focused";
    const by = flaggedBy(s, t, focus);
    const note = (x: Segment): string =>
      x.mixes_topics
        ? x.mixes_topics_note === ""
          ? "flagged"
          : x.mixes_topics_note
        : "";
    const flag = [
      ...(focus === "focused" ? [] : [`${focus} (${by})`]),
      ...[note(s), note(t)].filter((x) => x !== ""),
    ].join(" / ");
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
    // Rule 2: a mixed or overview segment keeps clusters only; its sub-skills are set aside.
    const setAside =
      focus === "focused"
        ? []
        : [...new Set([...ids(s.sub_skills), ...ids(t.sub_skills)])].sort();
    const sa = new Set(focus === "focused" ? ids(s.sub_skills) : []);
    const sb = new Set(focus === "focused" ? ids(t.sub_skills) : []);
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
    const why =
      focus === "focused"
        ? "calculator technique (ruling 2)"
        : `${focus}, flagged by ${by} (rule 2)` +
          (setAside.length > 0
            ? `; sub-skills set aside: ${setAside.join(";")}`
            : "");
    if (keptS.length === 0 && !(clustersOnly && keptC.length > 0)) {
      rows.push(
        row(
          videoId,
          base,
          "retag",
          clustersOnly
            ? `clusters only, ${why}; no shared cluster`
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
          `${clustersOnly ? `clusters only, ${why}; ` : ""}the passes disagree on ${disS.length + disC.length} tag(s); only shared tags kept`,
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
          clustersOnly ? `clusters only, ${why}` : "",
          keptS,
          keptC,
          [],
          [],
        ),
      );
    }
  }
  return rows.map((r) => {
    const i = p1.segments.findIndex((x) => x.start_seconds === r.start_seconds);
    const a = p1.segments[i];
    const b = p2.segments[i];
    if (a === undefined || b === undefined) return r;
    return {
      ...r,
      evidence: evidenceCell(
        [
          ...r.sub_skills,
          ...r.clusters,
          ...r.disputed_sub_skills,
          ...r.disputed_clusters,
        ],
        a,
        b,
      ),
    };
  });
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
    evidence: "",
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
    "evidence",
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
      r.evidence,
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
      `${label} skill ${s.skill} [${s.segments} seg]: sub-skills ${pct(s.subSkills)}; clusters ${pct(s.clusters)}\n`,
    );
  }
}

/**
 * Pure. The shopping list (Karl, 2026-10-29, Phase B): for each skill and sub-skill of the
 * vocabulary, how many focused segments carry it, a focused segment being a teaching row both
 * passes gave that sub-skill to (approve or retag; drop rows and clusters-only rows carry none).
 * Lines name every skill with no focused segment at all, then every sub-skill with none.
 */
export function coverageReport(
  rows: ReviewRow[],
  subSkills: Array<{ id: string; skill_code: string; section: string }>,
): string[] {
  const perSub = new Map<string, number>();
  for (const r of rows) {
    if (r.proposal === "drop") continue;
    for (const id of r.sub_skills) perSub.set(id, (perSub.get(id) ?? 0) + 1);
  }
  const skills = [
    ...new Set(subSkills.map((s) => `${s.section}|${s.skill_code}`)),
  ].sort();
  const lines: string[] = [];
  const noSkill = skills.filter((k) =>
    subSkills
      .filter((s) => `${s.section}|${s.skill_code}` === k)
      .every((s) => (perSub.get(s.id) ?? 0) === 0),
  );
  const noSub = subSkills.filter((s) => (perSub.get(s.id) ?? 0) === 0);
  lines.push(
    `coverage: ${subSkills.length - noSub.length}/${subSkills.length} sub-skills and ${skills.length - noSkill.length}/${skills.length} skills have a focused segment`,
  );
  for (const k of noSkill)
    lines.push(`no focused segment, skill: ${k.replace("|", " ")}`);
  for (const s of noSub)
    lines.push(`no focused segment, sub-skill: ${s.id} [${s.skill_code}]`);
  return lines;
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
      // Every video with both pass files in this version's cache (Phase B's whole set).
      "all-tagged": { type: "boolean", default: false },
    },
  });
  const ids =
    values.only !== undefined
      ? values.only.split(",")
      : values["all-tagged"]
        ? readdirSync(SEGMENTS_DIR)
            .filter((f) => f.endsWith(".pass1.json"))
            .map((f) => f.slice(0, -".pass1.json".length))
            .filter((id) =>
              existsSync(resolve(SEGMENTS_DIR, `${id}.pass2.json`)),
            )
            .sort()
        : null;
  if (ids === null) throw new Error("--only <ids> or --all-tagged is required");
  const taxonomy = z
    .object({
      sub_skills: z.array(
        z.object({
          id: z.string(),
          skill_code: z.string(),
          section: z.string(),
        }),
      ),
    })
    .parse(JSON.parse(readFileSync(values.taxonomy, "utf8")));
  const skillOfId = new Map(
    taxonomy.sub_skills.map((s) => [s.id, s.skill_code]),
  );
  const skillOf = (x: string): string | undefined => skillOfId.get(x);
  const allRows: ReviewRow[] = [];
  const allPairs: Pair[] = [];
  const allUnpaired: Segment[] = [];
  const setAside: Pair[] = [];
  let usd = 0;
  for (const id of ids) {
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
    process.stdout.write(
      `${id} (${p1.boundaries}): ${p1.segments.length} segment(s), both teaching ${aligned.pairs.length}, teaching disputed ${aligned.unpaired.length}\n`,
    );
    // Clusters-only segments by reason, and who flagged them (rule 2 is a union of the passes).
    for (const [i, a] of p1.segments.entries()) {
      const b = p2.segments[i];
      const f = aligned.focus[i];
      if (b === undefined || f === undefined) continue;
      const teaching = a.teaches_sat_content || b.teaches_sat_content;
      const subs = a.sub_skills.length + b.sub_skills.length;
      if (teaching && (f !== "focused" || subs === 0)) {
        process.stdout.write(
          `  clusters-only ${a.start_seconds}-${a.end_seconds}s: ${f === "focused" ? "no sub-skill in either pass" : `${f}, ${flaggedBy(a, b, f)}`}\n`,
        );
        if (f !== "focused" && a.teaches_sat_content && b.teaches_sat_content)
          setAside.push({ a, b });
      }
    }
    printAgreement(
      `  ${id}`,
      skillAgreement(aligned.pairs, aligned.unpaired, skillOf),
    );
    allRows.push(...reviewRows(id, p1, p2));
  }
  const all = skillAgreement(allPairs, allUnpaired, skillOf);
  printAgreement("all", all);
  const g = gate(all);
  for (const j of g.judged) {
    process.stdout.write(
      `gate ${j.passes ? "PASS" : "FAIL"} ${j.skill} [${j.segments} seg]: ${pct(j.subSkills)}\n`,
    );
  }
  for (const r of g.reported) {
    process.stdout.write(
      `reported (under ${GATE_MIN_SEGMENTS} seg) ${r.skill} [${r.segments} seg]: ${pct(r.subSkills)}\n`,
    );
  }
  process.stdout.write(`gate: ${g.passed ? "PASSED" : "NOT PASSED"}\n`);
  // Sensitivity: what the set-aside segments' sub-skills would have scored, had they counted.
  printAgreement(
    "set-aside (not gated)",
    skillAgreement(setAside, [], skillOf),
  );
  process.stdout.write(
    coverageReport(allRows, taxonomy.sub_skills).join("\n") + "\n",
  );
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
