/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 D (skill tagging constrained to the 29 names in
 *       content/canonical/taxonomy.json; invalid fails the row), §D.2 E (automated gates; review
 *       sample at least 5 per skill, seeded and recorded), §D.4 proofs 1a, 3, 4, 5]
 *       | @implemented [2026-10-15]
 *
 * plain English: steps D and E for a tier already through generate-descriptions.ts.
 *  1. Tag every kept segment: Gemini picks one to three skills from the 29 taxonomy names,
 *     enforced by the response schema's enum and again by Zod. An empty pick drops the row.
 *  2. Automated gates (`segmentGateFailures`): bounds, 20–180 s, description length, every
 *     skill in the taxonomy, no duplicate provenance.
 *  3. Proof 4: every kept description is checked for an 8-word run against the video's WHOLE
 *     cached transcript (not only its own segment), while the cache still exists.
 *  4. Writes `scripts/rag/.cache/tier-<n>/segments.jsonl` (the rows to embed and upsert) and
 *     `report.md`: the content-gate drop rate with every gated-out window and its reason, the
 *     merge and drop counts by reason, skill counts, and the seeded per-skill review sample
 *     with a timestamped link for each segment.
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
  tierDir,
  videoResultSchema,
} from "./generate-descriptions";
import {
  TAG_SYSTEM,
  formatSeconds,
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
  assertProxied,
  generateJson,
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

function link(videoId: string, start: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(start)}s`;
}

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

  const rows: SegmentRow[] = [];
  const drops: Drop[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const video = meta.get(r.video_id);
    if (video === undefined)
      throw new Error(`${r.video_id} is not in the tier ${tier} metadata`);
    const transcript = readCachedTranscript(r.video_id);
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
      const description = g.describe.description;
      const tagged = await generateJson({
        step: `tag ${g.provenance}`,
        model,
        system: TAG_SYSTEM,
        user: [
          `Video title: ${video.title}`,
          `Concepts: ${g.describe.concepts.join("; ")}`,
          `Description: ${description}`,
        ].join("\n"),
        responseSchema: tagResponseSchema(skills),
        schema: tagSchema(skills),
      });
      const skillCodes = [...new Set(tagged.skill_codes)];
      const failures = segmentGateFailures(
        {
          provenance: g.provenance,
          start: g.start,
          end: g.end,
          duration_seconds: video.duration_seconds,
          description,
          skill_codes: skillCodes,
        },
        taxonomy,
        seen,
      );
      if (fullText === null)
        failures.push("transcript cache missing: proof 4 cannot run");
      else if (sharesVerbatimRun(description, fullText))
        failures.push("repeats the transcript (8-word run, whole video)");
      if (failures.length > 0) {
        drops.push({
          provenance: g.provenance,
          video_id: r.video_id,
          stage: skillCodes.length === 0 ? "tag" : "gate",
          reason: failures.join("; "),
        });
        continue;
      }
      seen.add(g.provenance);
      rows.push(
        segmentRowSchema.parse({
          provenance: g.provenance,
          video_id: r.video_id,
          start: g.start,
          end: g.end,
          content: description,
          concepts: g.describe.concepts,
          skill_codes: skillCodes,
          surface_gate: "pre_and_post",
          content_type: "video_transcript",
        }),
      );
    }
  }

  const out = tierDir(tier);
  writeFileSync(
    resolve(out, "segments.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  writeFileSync(
    resolve(out, "drops.jsonl"),
    drops.map((d) => JSON.stringify(d)).join("\n") + "\n",
  );
  writeFileSync(
    resolve(out, "report.md"),
    report({ tier, seed, model, results, meta, rows, drops }),
  );
  process.stdout.write(
    `tier ${tier}: ${rows.length} segments kept, ${drops.length} dropped after the gate; report: ${resolve(out, "report.md")}\n`,
  );
}

function pct(n: number, d: number): string {
  return d === 0 ? "0%" : `${Math.round((100 * n) / d)}%`;
}

function report(x: {
  tier: number;
  seed: string;
  model: string;
  results: VideoResult[];
  meta: Map<string, VideoMeta>;
  rows: SegmentRow[];
  drops: Drop[];
}): string {
  const windows = x.results.flatMap((r) =>
    r.windows.map((w) => ({ ...w, video_id: r.video_id })),
  );
  const gated = windows.filter((w) => !w.assessment.teaches_sat_content);
  const groups = x.results.flatMap((r) => r.groups);
  const merged = groups.filter((g) => g.windows.length > 1);
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

  const lines: string[] = [];
  lines.push(`# Tier ${x.tier} ingestion run — review report`, "");
  lines.push(
    `Model \`${x.model}\`, prompt version \`${x.results[0]?.prompt_version ?? "?"}\`, sample seed \`${x.seed}\`.`,
    "",
  );
  lines.push("## Content gate", "");
  lines.push(
    `- Videos: ${x.results.length} (${x.results.filter((r) => r.transcript_track === "asr").length} on automatic captions, ${x.results.filter((r) => r.used_chapters).length} segmented by chapters)`,
  );
  lines.push(
    `- Windows: ${windows.length}; **gated out as not teaching SAT content: ${gated.length} (${pct(gated.length, windows.length)})**`,
  );
  lines.push(
    `- Merge: ${groups.length} groups from the teaching windows, ${merged.length} of them merged across a mid-explanation edge`,
  );
  lines.push(
    `- Kept: **${x.rows.length} segments**; dropped after grouping: ${x.drops.length}`,
    "",
  );
  if (byReason.size > 0) {
    lines.push("| Drop reason (after the gate) | Count |", "|---|---|");
    for (const [k, v] of [...byReason.entries()].sort((a, b) => b[1] - a[1]))
      lines.push(`| ${k} | ${v} |`);
    lines.push("");
  }
  lines.push(
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
  lines.push("", "## Skills", "", "| Skill | Segments |", "|---|---|");
  for (const [k, v] of [...bySkill.entries()].sort((a, b) => b[1] - a[1]))
    lines.push(`| ${k} | ${v} |`);
  lines.push("", "## Per-skill review sample", "");
  lines.push(
    "At least 5 segments per tagged skill, or all of a skill's segments when it has fewer. Check each description against what is on screen at its timestamp.",
    "",
  );
  for (const [skill, list] of sample) {
    lines.push(
      `### ${skill} (${list.length} of ${bySkill.get(skill) ?? 0})`,
      "",
    );
    for (const r of list) {
      lines.push(
        `- **${title(r.video_id)}**, [${formatSeconds(r.start)}–${formatSeconds(r.end)}](${link(r.video_id, r.start)}) — tags: ${r.skill_codes.join(", ")}`,
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
