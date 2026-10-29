/**
 * @spec [owner brief "Video segments tagged by sub-skill and cluster", Karl 2026-10-29, Phase A
 *       (design and pilot); docs/plans/lisa-video-library/segments-phase-a.md §3; R-14 (Gemini
 *       reads the video; transcripts are blocked)] | @implemented [2026-10-29]
 *
 * plain English: one tagging PASS over one or more approved library videos. Gemini watches the
 * video (10-minute clips over 15 minutes, as in the Desmos extraction), splits it at topic
 * changes using the creator's chapters as hints, and tags each segment from the CLOSED list of
 * taxonomy ids for the video's section (sub-skills and clusters), with one line of evidence per
 * tag in our own words. Run it twice (`--pass 1`, `--pass 2`); `segment-agreement.ts` compares
 * the passes and keeps only what both agree on.
 *
 * Rules (Karl, 2026-10-29), all enforced here, not left to the model:
 *  - Tag by id only. Any id not in the closed list is REJECTED and reported, never kept.
 *  - `method_in`: a cluster listed there for a segment's skill is present by default and is not
 *    tagged per segment. A tag the model gives anyway is moved to `method_in_defaults`, so the
 *    record shows it was seen, and it is never read as evidence that other segments lack it.
 *  - Several sub-skills and clusters per segment; no primary.
 *  - No second vocabulary: the ids come from the canonical taxonomy file the production tables
 *    mirror (`scripts/scl-taxonomy-loader.ts`). `--taxonomy` points at it.
 *
 * Independence between passes: both run at temperature 0 (generateJson); pass 2 lists the
 * vocabulary in reverse order, so a tag that depends on list position rather than on the video
 * shows up as a disagreement.
 *
 * Output: `scripts/rag/.cache/segments/<video_id>.pass<n>.json` (gitignored), with token usage.
 * Each clip is cached on its own, so a retry never re-pays for a clip that finished. Prints ids,
 * counts and cost only; no instructor text (the model is told not to quote).
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/segment-videos.ts --pass 1 \
 *          --only a1QNaRnn6cE,qQzeFyLYt1A,UDJ2RHMFax8 [--taxonomy <path>] [--cap-usd 2]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { clipsOf } from "./extract-desmos-moves";
import { parseClock } from "./segments";
import {
  GENERATION_MODEL_DEFAULT,
  ZERO_USAGE,
  addUsage,
  assertProxied,
  generateJson,
  priceOf,
  usageSchema,
  type Usage,
} from "./vertex";

export const SEGMENT_TAG_VERSION = "segment-tags-v1";
const REVIEW_CSV = resolve(
  "docs/plans/lisa-video-library/video-tags-review.csv",
);
const METADATA = resolve("scripts/rag/.cache/metadata.json");
const OUT_DIR = resolve("scripts/rag/.cache/segments");
const TAXONOMY_DEFAULT = resolve(
  "content/canonical/subskill-cluster-taxonomy.json",
);
/** Measured on the Desmos extraction (27 videos, 2026-10-27): 92.5 prompt tokens per second. */
const VIDEO_TOKENS_PER_SECOND = 110;
const OUTPUT_TOKENS_ESTIMATE = 16_000;

// ── The taxonomy (the canonical file; production mirrors it) ────────────────────────────

const taxonomySchema = z.object({
  taxonomy_version: z.string().min(1),
  sub_skills: z.array(
    z.object({
      id: z.string(),
      skill_code: z.string(),
      section: z.enum(["M", "RW"]),
      name: z.string(),
      definition: z.string(),
      inclusion_test: z.string(),
    }),
  ),
  clusters: z.array(
    z.object({
      id: z.string(),
      display_name: z.string(),
      family: z.enum(["by_hand_doing", "by_hand_recognizing", "desmos"]),
      definition: z.string(),
      skills_seen_in: z.array(z.string()),
      method_in: z.record(z.number()),
      playbook_move: z.string().optional(),
    }),
  ),
});
export type Taxonomy = z.infer<typeof taxonomySchema>;

export type Vocabulary = {
  version: string;
  section: "M" | "RW";
  subSkills: Taxonomy["sub_skills"];
  clusters: Taxonomy["clusters"];
  subSkillOf: Map<string, Taxonomy["sub_skills"][number]>;
  clusterOf: Map<string, Taxonomy["clusters"][number]>;
};

/** The closed list for one section: its sub-skills, and every cluster seen in its skills. */
export function vocabularyFor(t: Taxonomy, section: "M" | "RW"): Vocabulary {
  const subSkills = t.sub_skills.filter((s) => s.section === section);
  const skills = new Set(subSkills.map((s) => s.skill_code));
  const clusters = t.clusters.filter((c) =>
    c.skills_seen_in.some((s) => skills.has(s)),
  );
  return {
    version: t.taxonomy_version,
    section,
    subSkills,
    clusters,
    subSkillOf: new Map(subSkills.map((s) => [s.id, s])),
    clusterOf: new Map(clusters.map((c) => [c.id, c])),
  };
}

/** The vocabulary as the prompt shows it. `reverse` is pass 2's order. Labels are hints only. */
export function vocabularyText(v: Vocabulary, reverse: boolean): string {
  const order = <T>(xs: T[]): T[] => (reverse ? [...xs].reverse() : xs);
  return [
    "SUB-SKILLS. Tag by id. Use the inclusion test to decide.",
    ...order(v.subSkills).map(
      (s) =>
        `${s.id} [${s.skill_code}] ${s.name}: ${s.definition} Inclusion test: ${s.inclusion_test}`,
    ),
    "",
    "CLUSTERS (actions a student performs). Tag by id.",
    ...order(v.clusters).map(
      (c) =>
        `${c.id} (${c.family}) ${c.display_name}: ${c.definition}` +
        (Object.keys(c.method_in).length > 0
          ? ` [present by default in: ${Object.keys(c.method_in).join("; ")}; do not tag there]`
          : ""),
    ),
  ].join("\n");
}

// ── The model's answer ─────────────────────────────────────────────────────────────────

const tagSchema = z.object({ id: z.string(), evidence: z.string() });
export const segmentAnswerSchema = z.object({
  segments: z.array(
    z.object({
      start: z.string(),
      end: z.string(),
      teaches_sat_content: z.boolean(),
      summary: z.string(),
      sub_skills: z.array(tagSchema),
      clusters: z.array(tagSchema),
      /** What the segment teaches that no sub-skill or cluster expresses; "" when all fits. */
      not_in_taxonomy: z.string(),
    }),
  ),
});
type SegmentAnswer = z.infer<typeof segmentAnswerSchema>;

const segmentResponseSchema = {
  type: "OBJECT",
  properties: {
    segments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          start: { type: "STRING" },
          end: { type: "STRING" },
          teaches_sat_content: { type: "BOOLEAN" },
          summary: { type: "STRING" },
          sub_skills: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                evidence: { type: "STRING" },
              },
              required: ["id", "evidence"],
            },
          },
          clusters: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                evidence: { type: "STRING" },
              },
              required: ["id", "evidence"],
            },
          },
          not_in_taxonomy: { type: "STRING" },
        },
        required: [
          "start",
          "end",
          "teaches_sat_content",
          "summary",
          "sub_skills",
          "clusters",
          "not_in_taxonomy",
        ],
      },
    },
  },
  required: ["segments"],
} as const;

export function segmentSystem(vocabulary: string): string {
  return `You segment one SAT preparation video and tag each segment with what it teaches, from a closed list of ids. Watch the video, using what is shown and typed on screen as well as what is said.

SEGMENTS. Split the part you are shown at topic changes: a new kind of problem, a new skill or a new technique. The creator's chapters, when given, are hints, not rules: keep a chapter whole when it teaches one thing, and split it where it moves to another. Do not cut inside one worked problem. Segments tile the part in order with no gaps or overlaps. teaches_sat_content is false for intros, sign-offs, promotion and general advice.

TIMES. Clock times relative to the start of the part you are watching, as "M:SS": the first segment starts at "0:00" and the last ends at the part's length.

TAGS. For each teaching segment, tag every sub-skill and every cluster the segment actually teaches, as many as apply, none primary. A sub-skill only when its inclusion test holds for what is taught; a cluster only when a student watching would perform that action. Use ids exactly as listed; never invent one. Do not tag a cluster in a skill where it is marked present by default. For every tag, evidence is one short line in your own words saying what in the segment shows it. Never quote the speaker.

not_in_taxonomy: if the segment teaches something no listed sub-skill or cluster expresses (for example a concept that spans a whole skill, or a calculator feature with no matching cluster), describe it in one line; otherwise "".

summary: one line, at most 20 words, in your own words.

${vocabulary}`;
}

// ── One video, one pass ────────────────────────────────────────────────────────────────

export type TaggedSegment = {
  start_seconds: number;
  end_seconds: number;
  teaches_sat_content: boolean;
  summary: string;
  sub_skills: Array<{ id: string; evidence: string }>;
  clusters: Array<{ id: string; evidence: string }>;
  method_in_defaults: string[];
  rejected_ids: string[];
  not_in_taxonomy: string;
};

/**
 * Pure. Turns one clip's answer into checked segments on the video's own clock: times offset by
 * the clip start; ids outside the closed list rejected (and listed); method_in defaults moved
 * aside. Returns an error when the times do not parse or do not tile the clip.
 */
export function checkClipAnswer(
  answer: SegmentAnswer,
  clip: { start: number; end: number },
  v: Vocabulary,
): { ok: true; segments: TaggedSegment[] } | { ok: false; error: string } {
  const length = clip.end - clip.start;
  const out: TaggedSegment[] = [];
  let cursor = 0;
  for (const s of answer.segments) {
    const start = parseClock(s.start);
    const end = parseClock(s.end);
    if (start === null || end === null) {
      return { ok: false, error: `unparseable time ${s.start}-${s.end}` };
    }
    if (end <= start)
      return { ok: false, error: `empty segment at ${s.start}` };
    if (Math.abs(start - cursor) > 3) {
      return {
        ok: false,
        error: `${start > cursor ? "gap" : "overlap"} at ${cursor}s`,
      };
    }
    cursor = end;
    const skillsOfSegment = new Set(
      s.sub_skills
        .map((t) => v.subSkillOf.get(t.id)?.skill_code)
        .filter((x): x is string => x !== undefined),
    );
    const rejected: string[] = [];
    const subSkills = s.sub_skills.filter((t) => {
      if (v.subSkillOf.has(t.id)) return true;
      rejected.push(t.id);
      return false;
    });
    const methodInDefaults: string[] = [];
    const clusters = s.clusters.filter((t) => {
      const c = v.clusterOf.get(t.id);
      if (c === undefined) {
        rejected.push(t.id);
        return false;
      }
      if (
        Object.keys(c.method_in).some((skill) => skillsOfSegment.has(skill))
      ) {
        methodInDefaults.push(t.id);
        return false;
      }
      return true;
    });
    out.push({
      start_seconds: clip.start + start,
      end_seconds: clip.start + end,
      teaches_sat_content: s.teaches_sat_content,
      summary: s.summary,
      sub_skills: dedupe(subSkills),
      clusters: dedupe(clusters),
      method_in_defaults: [...new Set(methodInDefaults)],
      rejected_ids: [...new Set(rejected)],
      not_in_taxonomy: s.not_in_taxonomy.trim(),
    });
  }
  if (Math.abs(cursor - length) > 3) {
    return { ok: false, error: `ends at ${cursor}s of ${length}s` };
  }
  const last = out[out.length - 1];
  if (last) last.end_seconds = clip.end;
  return { ok: true, segments: out };
}

function dedupe(
  tags: Array<{ id: string; evidence: string }>,
): Array<{ id: string; evidence: string }> {
  const seen = new Set<string>();
  return tags.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

type VideoRow = {
  video_id: string;
  title: string;
  duration_seconds: number;
  skills: string[];
};

const chapterSchema = z.object({
  title: z.string(),
  start_seconds: z.number(),
  end_seconds: z.number(),
});
type Chapter = z.infer<typeof chapterSchema>;

function chaptersByVideo(): Map<string, Chapter[]> {
  const out = new Map<string, Chapter[]>();
  if (!existsSync(METADATA)) return out;
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) {
      o.forEach(walk);
      return;
    }
    if (typeof o !== "object" || o === null) return;
    const rec = o as Record<string, unknown>;
    if (typeof rec.video_id === "string" && Array.isArray(rec.chapters)) {
      const parsed = z.array(chapterSchema).safeParse(rec.chapters);
      if (parsed.success) out.set(rec.video_id, parsed.data);
    }
    Object.values(rec).forEach(walk);
  };
  walk(JSON.parse(readFileSync(METADATA, "utf8")));
  return out;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function approvedVideos(): VideoRow[] {
  const [header, ...rows] = parseCsv(readFileSync(REVIEW_CSV, "utf8"));
  if (!header) throw new Error("review CSV is empty");
  const col = (n: string): number => {
    const i = header.indexOf(n);
    if (i < 0) throw new Error(`review CSV has no ${n} column`);
    return i;
  };
  const [a, id, title, dur, skills] = [
    col("approve"),
    col("video_id"),
    col("title"),
    col("duration_s"),
    col("skills"),
  ];
  return rows
    .filter((r) => r[a]?.trim().toLowerCase() === "yes")
    .map((r) => ({
      video_id: r[id] ?? "",
      title: r[title] ?? "",
      duration_seconds: Number(r[dur]),
      skills: (r[skills] ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
    }));
}

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

const clipCacheSchema = z.object({
  version: z.literal(SEGMENT_TAG_VERSION),
  model: z.string(),
  answer: segmentAnswerSchema,
  usage: usageSchema,
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      pass: { type: "string" },
      only: { type: "string" },
      taxonomy: { type: "string", default: TAXONOMY_DEFAULT },
      model: { type: "string", default: GENERATION_MODEL_DEFAULT },
      "cap-usd": { type: "string", default: "2" },
    },
  });
  const pass = Number(values.pass);
  if (pass !== 1 && pass !== 2) throw new Error("--pass must be 1 or 2");
  const cap = Number(values["cap-usd"]);
  const model = values.model;
  assertProxied();
  mkdirSync(OUT_DIR, { recursive: true });

  const taxonomy = taxonomySchema.parse(
    JSON.parse(readFileSync(values.taxonomy, "utf8")),
  );
  const sectionOf = new Map(
    taxonomy.sub_skills.map((s) => [s.skill_code, s.section]),
  );
  const only =
    values.only === undefined ? null : new Set(values.only.split(","));
  const videos = approvedVideos().filter(
    (v) => only === null || only.has(v.video_id),
  );
  if (only !== null && videos.length !== only.size) {
    throw new Error("an --only id is not an approved row of the review CSV");
  }
  const chapters = chaptersByVideo();
  const price = priceOf(model);
  let spent = 0;

  for (const video of videos) {
    const sections = new Set(video.skills.map((s) => sectionOf.get(s)));
    const section = sections.has("M") ? "M" : "RW";
    const vocab = vocabularyFor(taxonomy, section);
    const system = segmentSystem(vocabularyText(vocab, pass === 2));
    let usage: Usage = ZERO_USAGE;
    const segments: TaggedSegment[] = [];
    for (const [start, end] of clipsOf(video.duration_seconds)) {
      const clipPath = resolve(
        OUT_DIR,
        `${video.video_id}.pass${pass}.clip-${start}.json`,
      );
      const cached = existsSync(clipPath)
        ? clipCacheSchema.safeParse(JSON.parse(readFileSync(clipPath, "utf8")))
        : null;
      let answer: SegmentAnswer;
      if (cached?.success && cached.data.model === model) {
        answer = cached.data.answer;
        usage = addUsage(usage, cached.data.usage);
      } else {
        const estimate =
          (((end - start) * VIDEO_TOKENS_PER_SECOND + system.length / 4) *
            price.input +
            OUTPUT_TOKENS_ESTIMATE * price.output) /
          1_000_000;
        if (spent + estimate > cap) {
          throw new Error(
            `stopping before ${video.video_id} ${clock(start)}: $${spent.toFixed(4)} + $${estimate.toFixed(4)} would pass the $${cap} cap`,
          );
        }
        const hints = (chapters.get(video.video_id) ?? []).filter(
          (c) => c.end_seconds > start && c.start_seconds < end,
        );
        let clipUsage: Usage = ZERO_USAGE;
        answer = await generateJson({
          step: `segment-tags ${video.video_id} pass${pass} ${clock(start)}`,
          model,
          system,
          video: { videoId: video.video_id, start, end },
          user: [
            `Video title: ${video.title}`,
            `Library skills: ${video.skills.join("; ")} (the video may teach others too).`,
            start === 0 && end === video.duration_seconds
              ? `You are watching the whole video, ${clock(end)} long.`
              : `You are watching the part from ${clock(start)} to ${clock(end)} of a ${clock(video.duration_seconds)} video; it is ${clock(end - start)} long and your times start at 0:00.`,
            hints.length === 0
              ? "The creator gave no chapters for this part."
              : `Creator's chapters in this part (times relative to the part): ${hints
                  .map(
                    (c) =>
                      `${clock(Math.max(0, c.start_seconds - start))} ${c.title}`,
                  )
                  .join(" | ")}`,
          ].join("\n"),
          responseSchema: segmentResponseSchema,
          schema: segmentAnswerSchema,
          onUsage: (u) => {
            clipUsage = u;
          },
        });
        writeFileSync(
          clipPath,
          `${JSON.stringify({ version: SEGMENT_TAG_VERSION, model, answer, usage: clipUsage }, null, 2)}\n`,
        );
        usage = addUsage(usage, clipUsage);
        spent += clipUsage.usd;
      }
      const checked = checkClipAnswer(answer, { start, end }, vocab);
      if (!checked.ok) {
        throw new Error(`${video.video_id} ${clock(start)}: ${checked.error}`);
      }
      segments.push(...checked.segments);
    }
    writeFileSync(
      resolve(OUT_DIR, `${video.video_id}.pass${pass}.json`),
      `${JSON.stringify(
        {
          version: SEGMENT_TAG_VERSION,
          taxonomy_version: vocab.version,
          model,
          pass,
          video_id: video.video_id,
          duration_seconds: video.duration_seconds,
          section,
          segments,
          usage,
        },
        null,
        2,
      )}\n`,
    );
    const teaching = segments.filter((s) => s.teaches_sat_content).length;
    const rejected = segments.reduce((n, s) => n + s.rejected_ids.length, 0);
    process.stdout.write(
      `${video.video_id} pass${pass}: ${segments.length} segment(s), ${teaching} teaching; rejected ids ${rejected}; ${usage.prompt} in (${usage.cached} cached) / ${usage.output} out; $${usage.usd.toFixed(4)}\n`,
    );
  }
  process.stdout.write(`new spend this pass: $${spent.toFixed(4)}\n`);
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
