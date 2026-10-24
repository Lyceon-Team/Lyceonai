/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 D (skill tagging constrained to the 29 names in
 *       content/canonical/taxonomy.json; invalid fails the row), §D.2 E (automated gates; review
 *       sample at least 5 per skill, seeded and recorded), §D.4 proofs 1a, 3, 4, 5; R-14
 *       (ruled 2026-10-15: video source)] | @implemented [2026-10-15]
 *
 * plain English: steps D and E for a tier already through generate-descriptions.ts.
 *  1. Tag every kept segment: Gemini picks one to three skills from the 29 taxonomy names,
 *     enforced by the response schema's enum and again by Zod. An empty pick drops the row.
 *  2. Automated gates (`segmentGateFailures`): bounds, 20–180 s, description length, every
 *     skill in the taxonomy, no duplicate provenance.
 *  3. Proof 4. Transcript source: every kept description is checked for an 8-word run against
 *     the video's WHOLE cached transcript, while the cache still exists. Video source: no
 *     transcript was ever obtained, so there is nothing to repeat; recorded as such.
 *  4. Tag audit (Karl, 2026-10-15: "the tag-quality number matters most"): a second Gemini
 *     call WATCHES the segment and judges each assigned skill taught / mentioned / absent. It
 *     sees the video, where the tagger saw only the description, so it is an independent
 *     check. It measures; it removes nothing. Karl's sample review is the ruling.
 *  5. Writes `scripts/rag/.cache/tier-<n>/segments.jsonl` (the rows to embed and upsert),
 *     `drops.jsonl`, `audit.jsonl` and `report.md`: the content-gate drop rate with every
 *     gated-out window and its reason, merge and drop counts (open-ended drops counted on
 *     their own), the tag audit, cost per segment, skill counts, and the seeded per-skill
 *     review sample with a timestamped link for each segment.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/map-skills.ts --tier 1 [--seed <s>]
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { readCachedTranscript } from "./fetch-transcripts";
import {
  type VideoMeta,
  type VideoResult,
  loadTierVideos,
  pool,
  tierDir,
  videoResultSchema,
} from "./generate-descriptions";
import {
  TAG_AUDIT_SYSTEM,
  TAG_SYSTEM,
  type TagAudit,
  formatSeconds,
  tagAuditResponseSchema,
  tagAuditSchema,
  tagResponseSchema,
  tagSchema,
} from "./prompts";
import {
  segmentGateFailures,
  selectReviewSample,
  sharesVerbatimRun,
  windowText,
} from "./segments";
import {
  GENERATION_MODEL_DEFAULT,
  PRICE_PER_MTOK,
  type Usage,
  ZERO_USAGE,
  addUsage,
  assertProxied,
  generateJson,
  usageCostUsd,
} from "./vertex";

const TAXONOMY_PATH = resolve(
  import.meta.dirname,
  "../../content/canonical/taxonomy.json",
);

/** The 29 full skill names, read from the taxonomy at run time (never typed). */
export function loadSkillNames(): [string, ...string[]] {
  const parsed = z
    .object({ skills: z.record(z.array(z.string())) })
    .parse(JSON.parse(readFileSync(TAXONOMY_PATH, "utf8")));
  const names = [...new Set(Object.values(parsed.skills).flat())].sort();
  const [first, ...rest] = names;
  if (first === undefined) throw new Error("taxonomy has no skills");
  return [first, ...rest];
}

export const segmentRowSchema = z.object({
  provenance: z.string(),
  video_id: z.string(),
  start: z.number(),
  end: z.number(),
  content: z.string(),
  concepts: z.array(z.string()),
  skill_codes: z.array(z.string()).min(1),
  surface_gate: z.literal("pre_and_post"),
  content_type: z.literal("video_transcript"),
});
export type SegmentRow = z.infer<typeof segmentRowSchema>;

type Drop = {
  provenance: string;
  video_id: string;
  stage: string;
  reason: string;
};

type AuditRow = { provenance: string; video_id: string; audit: TagAudit };

function link(videoId: string, start: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(start)}s`;
}

type Candidate = {
  r: VideoResult;
  video: VideoMeta;
  fullText: string | null;
  provenance: string;
  start: number;
  end: number;
  description: string;
  concepts: string[];
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tier: { type: "string" },
      model: { type: "string", default: GENERATION_MODEL_DEFAULT },
      seed: { type: "string" },
    },
  });
  assertProxied();
  const tier = z.coerce.number().int().min(1).max(5).parse(values.tier);
  const model = z.string().min(1).parse(values.model);
  const seed =
    values.seed ?? `tier${tier}-${new Date().toISOString().slice(0, 10)}`;
  const skills = loadSkillNames();
  if (skills.length !== 29)
    throw new Error(`taxonomy lists ${skills.length} skills, expected 29`);
  const taxonomy = new Set<string>(skills);

  const dir = resolve(tierDir(tier), "videos");
  const meta = new Map<string, VideoMeta>(
    loadTierVideos(tier).map((v) => [v.video_id, v]),
  );
  const results: VideoResult[] = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) =>
      videoResultSchema.parse(
        JSON.parse(readFileSync(resolve(dir, f), "utf8")),
      ),
    );

  const drops: Drop[] = [];
  const candidates: Candidate[] = [];
  for (const r of results) {
    const video = meta.get(r.video_id);
    if (video === undefined)
      throw new Error(`${r.video_id} is not in the tier ${tier} metadata`);
    const transcript =
      r.source === "transcript" ? readCachedTranscript(r.video_id) : null;
    const fullText = transcript === null ? null : windowText(transcript.cues);
    for (const g of r.groups) {
      if (
        g.outcome === "dropped" ||
        g.describe === null ||
        g.describe.description === null
      ) {
        drops.push({
          provenance: g.provenance,
          video_id: r.video_id,
          stage: "describe",
          reason: g.drop_reason ?? "dropped",
        });
        continue;
      }
      candidates.push({
        r,
        video,
        fullText,
        provenance: g.provenance,
        start: g.start,
        end: g.end,
        description: g.describe.description,
        concepts: g.describe.concepts,
      });
    }
  }

  let tagUsage: Usage = ZERO_USAGE;
  let auditUsage: Usage = ZERO_USAGE;
  const tagged = await pool(candidates, 4, (c) =>
    generateJson({
      step: `tag ${c.provenance}`,
      model,
      system: TAG_SYSTEM,
      user: [
        `Video title: ${c.video.title}`,
        `Concepts: ${c.concepts.join("; ")}`,
        `Description: ${c.description}`,
      ].join("\n"),
      responseSchema: tagResponseSchema(skills),
      schema: tagSchema(skills),
      onUsage: (u) => {
        tagUsage = addUsage(tagUsage, u);
      },
    }),
  );

  const rows: SegmentRow[] = [];
  const seen = new Set<string>();
  for (const [i, c] of candidates.entries()) {
    const skillCodes = [...new Set(tagged[i]?.skill_codes ?? [])];
    const failures = segmentGateFailures(
      {
        provenance: c.provenance,
        start: c.start,
        end: c.end,
        duration_seconds: c.video.duration_seconds,
        description: c.description,
        skill_codes: skillCodes,
      },
      taxonomy,
      seen,
    );
    if (c.r.source === "transcript") {
      if (c.fullText === null)
        failures.push("transcript cache missing: proof 4 cannot run");
      else if (sharesVerbatimRun(c.description, c.fullText))
        failures.push("repeats the transcript (8-word run, whole video)");
    }
    if (failures.length > 0) {
      drops.push({
        provenance: c.provenance,
        video_id: c.r.video_id,
        stage: skillCodes.length === 0 ? "tag" : "gate",
        reason: failures.join("; "),
      });
      continue;
    }
    seen.add(c.provenance);
    rows.push(
      segmentRowSchema.parse({
        provenance: c.provenance,
        video_id: c.r.video_id,
        start: c.start,
        end: c.end,
        content: c.description,
        concepts: c.concepts,
        skill_codes: skillCodes,
        surface_gate: "pre_and_post",
        content_type: "video_transcript",
      }),
    );
  }

  const audits: AuditRow[] = await pool(rows, 2, async (row) => ({
    provenance: row.provenance,
    video_id: row.video_id,
    audit: await generateJson({
      step: `audit ${row.provenance}`,
      model,
      system: TAG_AUDIT_SYSTEM,
      video: { videoId: row.video_id, start: row.start, end: row.end },
      user: `Skills to check:\n${row.skill_codes.map((s) => `- ${s}`).join("\n")}`,
      responseSchema: tagAuditResponseSchema,
      schema: tagAuditSchema,
      onUsage: (u) => {
        auditUsage = addUsage(auditUsage, u);
      },
    }),
  }));

  const out = tierDir(tier);
  const jsonl = (xs: unknown[]): string =>
    xs.map((x) => JSON.stringify(x)).join("\n") + "\n";
  writeFileSync(resolve(out, "segments.jsonl"), jsonl(rows));
  writeFileSync(resolve(out, "drops.jsonl"), jsonl(drops));
  writeFileSync(resolve(out, "audit.jsonl"), jsonl(audits));
  writeFileSync(
    resolve(out, "report.md"),
    report({
      tier,
      seed,
      model,
      results,
      meta,
      rows,
      drops,
      audits,
      tagUsage,
      auditUsage,
    }),
  );
  process.stdout.write(
    `tier ${tier}: ${rows.length} segments kept, ${drops.length} dropped after the gate; report: ${resolve(out, "report.md")}\n`,
  );
}

function pct(n: number, d: number): string {
  return d === 0 ? "0%" : `${Math.round((100 * n) / d)}%`;
}

function usd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
}

function report(x: {
  tier: number;
  seed: string;
  model: string;
  results: VideoResult[];
  meta: Map<string, VideoMeta>;
  rows: SegmentRow[];
  drops: Drop[];
  audits: AuditRow[];
  tagUsage: Usage;
  auditUsage: Usage;
}): string {
  const windows = x.results.flatMap((r) =>
    r.windows.map((w) => ({ ...w, video_id: r.video_id })),
  );
  const gated = windows.filter((w) => !w.assessment.teaches_sat_content);
  const groups = x.results.flatMap((r) => r.groups);
  const merged = groups.filter((g) => g.windows.length > 1);
  const openEnded = x.drops.filter((d) => d.reason.startsWith("open boundary"));
  const byReason = new Map<string, number>();
  for (const d of x.drops) {
    const key = d.reason.replace(/ \(.*\)$/, "").split(";")[0] ?? d.reason;
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  const bySkill = new Map<string, number>();
  for (const r of x.rows)
    for (const s of r.skill_codes) bySkill.set(s, (bySkill.get(s) ?? 0) + 1);
  const sample = selectReviewSample(x.rows, x.seed);
  const title = (id: string): string => x.meta.get(id)?.title ?? id;
  const sources = [...new Set(x.results.map((r) => r.source))].join(", ");

  // Tag audit.
  const verdicts = x.audits.flatMap((a) =>
    a.audit.verdicts.map((v) => ({ ...v, provenance: a.provenance })),
  );
  const assigned = x.rows.reduce((n, r) => n + r.skill_codes.length, 0);
  const taught = verdicts.filter((v) => v.verdict === "taught").length;
  const overTags = verdicts.filter((v) => v.verdict !== "taught");
  const rowsWithOverTag = new Set(overTags.map((v) => v.provenance)).size;
  const multi = x.rows.filter((r) => r.skill_codes.length > 1).length;
  const auditBySkill = new Map<string, { n: number; taught: number }>();
  for (const v of verdicts) {
    const e = auditBySkill.get(v.skill) ?? { n: 0, taught: 0 };
    e.n += 1;
    if (v.verdict === "taught") e.taught += 1;
    auditBySkill.set(v.skill, e);
  }
  const rowByProv = new Map(x.rows.map((r) => [r.provenance, r]));

  // Cost.
  const gate = x.results.reduce(
    (u, r) => addUsage(u, r.usage.gate),
    ZERO_USAGE,
  );
  const describe = x.results.reduce(
    (u, r) => addUsage(u, r.usage.describe),
    ZERO_USAGE,
  );
  const tiebreak = x.results.reduce(
    (u, r) => addUsage(u, r.usage.tiebreak),
    ZERO_USAGE,
  );
  const pipeline = addUsage(
    addUsage(addUsage(gate, describe), tiebreak),
    x.tagUsage,
  );
  const seconds = x.results.reduce(
    (n, r) => n + (r.windows[r.windows.length - 1]?.end ?? 0),
    0,
  );

  const lines: string[] = [];
  lines.push(`# Tier ${x.tier} ingestion run — review report`, "");
  lines.push(
    `Model \`${x.model}\`, source \`${sources}\`, prompt version \`${x.results[0]?.prompt_version ?? "?"}\`, sample seed \`${x.seed}\`.`,
    "",
  );
  lines.push("## Summary", "");
  lines.push(
    `- Videos: ${x.results.length}, ${Math.round(seconds / 60)} min; ${x.results.filter((r) => r.used_chapters).length} segmented by chapters`,
  );
  lines.push(
    `- Windows: ${windows.length}; **gated out as not teaching SAT content: ${gated.length} (${pct(gated.length, windows.length)})**`,
  );
  lines.push(
    `- Merge: ${groups.length} groups from the teaching windows, ${merged.length} merged across a mid-explanation edge`,
  );
  lines.push(
    `- **Dropped as open-ended after merge: ${openEnded.length}** (of ${groups.length} groups, ${pct(openEnded.length, groups.length)})`,
  );
  lines.push(
    `- Kept: **${x.rows.length} segments**; dropped after grouping, all reasons: ${x.drops.length}`,
  );
  lines.push(
    `- Tag audit: **${taught} of ${verdicts.length} assigned tags judged taught (${pct(taught, verdicts.length)})**; ${rowsWithOverTag} of ${x.rows.length} segments carry at least one tag judged not taught; ${multi} segments have more than one tag`,
  );
  lines.push(
    `- Cost (pipeline: gate + describe + tie-break + tag): ${usd(usageCostUsd(pipeline))} total, **${usd(usageCostUsd(pipeline) / Math.max(1, x.rows.length))} per kept segment**; the tag audit added ${usd(usageCostUsd(x.auditUsage))}`,
    "",
  );
  if (byReason.size > 0) {
    lines.push("| Drop reason (after the gate) | Count |", "|---|---|");
    for (const [k, v] of [...byReason.entries()].sort((a, b) => b[1] - a[1]))
      lines.push(`| ${k} | ${v} |`);
    lines.push("");
  }

  lines.push("## Tag audit", "");
  lines.push(
    "A second Gemini call watched each kept segment and judged each assigned skill. It saw the video; the tagger saw only the description. It measures; it removed nothing.",
    "",
  );
  lines.push(
    `Assigned tags: ${assigned}; judged: ${verdicts.length}. Taught ${taught}, mentioned only ${verdicts.filter((v) => v.verdict === "mentioned").length}, absent ${verdicts.filter((v) => v.verdict === "absent").length}.`,
    "",
  );
  lines.push("| Skill | Assigned | Judged taught |", "|---|---|---|");
  for (const [k, e] of [...auditBySkill.entries()].sort(
    (a, b) => b[1].n - a[1].n,
  ))
    lines.push(`| ${k} | ${e.n} | ${e.taught} (${pct(e.taught, e.n)}) |`);
  lines.push("", "### Every tag judged not taught", "");
  if (overTags.length === 0) lines.push("None.");
  for (const v of overTags) {
    const r = rowByProv.get(v.provenance);
    if (r === undefined) continue;
    lines.push(
      `- **${v.skill}** — ${v.verdict}: ${v.reason} · ${title(r.video_id)}, [${formatSeconds(r.start)}–${formatSeconds(r.end)}](${link(r.video_id, r.start)}); all tags: ${r.skill_codes.join(", ")}`,
    );
  }

  lines.push("", "## Cost", "");
  lines.push(
    `Rates: $${PRICE_PER_MTOK.input}/M input (text, audio, video), $${PRICE_PER_MTOK.cached}/M cached input, $${PRICE_PER_MTOK.output}/M output incl. thinking — third-party aggregator figures for gemini-3.5-flash on Vertex, not the official rate card (see scripts/rag/vertex.ts). Token counts are exact.`,
    "",
  );
  lines.push(
    "| Stage | Calls | Prompt tokens | of which cached | Output tokens | Cost |",
    "|---|---|---|---|---|---|",
  );
  for (const [name, u] of [
    ["gate (per window)", gate],
    ["describe (per group)", describe],
    ["boundary tie-break", tiebreak],
    ["tag", x.tagUsage],
    ["**pipeline total**", pipeline],
    ["tag audit (measurement only)", x.auditUsage],
  ] as const) {
    lines.push(
      `| ${name} | ${u.calls} | ${u.prompt} | ${u.cached} | ${u.output} | ${usd(usageCostUsd(u))} |`,
    );
  }
  lines.push(
    "",
    `Per kept segment: ${usd(usageCostUsd(pipeline) / Math.max(1, x.rows.length))}. Per video minute: ${usd(usageCostUsd(pipeline) / Math.max(1, seconds / 60))}.`,
  );

  lines.push(
    "",
    "### Every gated-out window",
    "",
    "| Video | Window | Reason |",
    "|---|---|---|",
  );
  for (const w of gated) {
    lines.push(
      `| ${title(w.video_id)} | [${formatSeconds(w.start)}–${formatSeconds(w.end)}](${link(w.video_id, w.start)}) | ${w.assessment.gate_reason} |`,
    );
  }
  lines.push("", "### Every open-ended drop", "");
  // Lengths of the open-ended groups, and how many a longer cap would admit: the 180 s cap
  // (plan §D.2 E) meets worked examples that run 4–5 minutes. Admitted ≠ described: a group
  // over the cap was never described, so these counts are an upper bound for a ruling.
  const groupBy = new Map(
    x.results.flatMap((r) => r.groups.map((g) => [g.provenance, g] as const)),
  );
  const lengths = openEnded
    .map((d) => groupBy.get(d.provenance))
    .filter((g) => g !== undefined)
    .map((g) => g.end - g.start);
  if (lengths.length > 0) {
    lines.push(
      `Lengths: ${[...lengths]
        .sort((a, b) => a - b)
        .map((n) => `${Math.round(n)} s`)
        .join(", ")}.`,
      "",
      "| Cap | Open-ended groups it would admit |",
      "|---|---|",
    );
    for (const cap of [240, 300, 360])
      lines.push(
        `| ${cap} s | ${lengths.filter((n) => n <= cap).length} of ${lengths.length} |`,
      );
    lines.push("");
  }
  if (openEnded.length === 0) lines.push("None.");
  for (const d of openEnded)
    lines.push(`- ${title(d.video_id)} \`${d.provenance}\`: ${d.reason}`);

  lines.push("", "## Skills", "", "| Skill | Segments |", "|---|---|");
  for (const [k, v] of [...bySkill.entries()].sort((a, b) => b[1] - a[1]))
    lines.push(`| ${k} | ${v} |`);
  lines.push("", "## Per-skill review sample", "");
  lines.push(
    "At least 5 segments per tagged skill, or all of a skill's segments when it has fewer. Check each description, and each tag, against what is on screen at its timestamp. A ⚠ marks a tag the audit judged not taught.",
    "",
  );
  const flagged = new Set(
    overTags.map((v) => `${v.provenance}\u0000${v.skill}`),
  );
  for (const [skill, list] of sample) {
    lines.push(
      `### ${skill} (${list.length} of ${bySkill.get(skill) ?? 0})`,
      "",
    );
    for (const r of list) {
      const tags = r.skill_codes
        .map((s) => (flagged.has(`${r.provenance}\u0000${s}`) ? `⚠ ${s}` : s))
        .join(", ");
      lines.push(
        `- **${title(r.video_id)}**, [${formatSeconds(r.start)}–${formatSeconds(r.end)}](${link(r.video_id, r.start)}) — tags: ${tags}`,
      );
      lines.push(`  ${r.content}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
