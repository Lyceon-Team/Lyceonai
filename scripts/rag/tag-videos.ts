/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §4 (one Gemini call per video
 *       on title + description + chapter titles; tags constrained to the 29 taxonomy names, an
 *       invalid name fails the row; multi-tag expected; no SAT skill → zero tags → excluded;
 *       chapters mapped to skills, the best chapter's start stored), §5 (review all of it as a
 *       CSV; no row approved without approved_by)] | @implemented [2026-10-15]
 *
 * plain English: tags every available video in `scripts/rag/.cache/metadata.json` (all
 * sources, from fetch-video-metadata.ts) with the SAT skills it covers. Text in, text out:
 * no video reading, no transcript. Per video:
 *  - `skill_codes`: 0–8 of the 29 names in content/canonical/taxonomy.json, most prominent
 *    first. Enforced by the response schema's enum and again by Zod; a row that fails either
 *    is reported as failed, never coerced. Zero tags = the video teaches no SAT skill and is
 *    never offered.
 *  - `domain`: derived from the first skill through the taxonomy (deterministic, not the
 *    model's), for a coarser fallback.
 *  - `start_seconds`: where the video has chapters, each is mapped to a skill; the first
 *    chapter whose skill is the video's first skill gives the start. An opening chapter, or no
 *    chapters, means null: the video plays from the beginning.
 *
 * Writes `scripts/rag/.cache/video-library/tags.jsonl` and the review file
 * `docs/plans/lisa-video-library/video-tags-review.csv` (one row per video, with an empty
 * `approve` column for Karl). It never writes a database: scripts/rag/apply-video-library.ts
 * writes the reviewed CSV, so what is stored is exactly what Karl read, never a fresh (and
 * possibly different) model answer.
 *
 * @spec [Doc-03D_V1.2 §6.7 as amended (methods); owner brief "Video retrieval: method tags",
 *       Karl 2026-10-27 (Step 0 ruled)] | @implemented [2026-10-27]
 * The methods pass (`--methods`): for every row of the REVIEWED file marked `approve = yes`,
 * how the video solves (`methods`, packages/shared/src/video-methods.ts) and what shape it
 * takes (`format`), each value with one line of evidence. Every reviewed cell is kept as it is
 * (skills, start, approve): the pass only fills the four columns at the end of the row.
 *  - First from text: title, description and chapters, one call per video. Where the video has
 *    a start, the text call is told the chapter the student lands on and tags that chapter.
 *  - Where the text cannot decide (`needs_video`), Gemini watches the clip the student would
 *    see (the landing chapter, or the opening 20 minutes), twice. Only a method both runs see
 *    is kept; a format the two runs disagree on fails the row. `method_source` says which.
 *  - `--candidate-methods a,b` adds values the vocabulary does not hold yet, to count how many
 *    approved videos carry them (a value enters VIDEO_METHODS only at three or more). Candidate
 *    tags are reported, never written to the file.
 * Answers are cached in .cache/video-library/methods.jsonl by video and prompt version, so a
 * second invocation rewrites the file without calling the model again.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/tag-videos.ts
 *        NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/tag-videos.ts --only <id>,<id>
 *        NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/tag-videos.ts --methods [--candidate-methods backsolve]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  VIDEO_FORMATS,
  VIDEO_FORMAT_DEFINITIONS,
  VIDEO_METHODS,
  VIDEO_METHOD_DEFINITIONS,
  type VideoFormat,
} from "../../packages/shared/src/video-methods";
import { parseCsv } from "../reference-data/import-reference-data";
import { CACHE_DIR } from "./fetch-transcripts";
import { pool } from "./generate-descriptions";
import { formatSeconds } from "./prompts";
import {
  GENERATION_MODEL_DEFAULT,
  type Usage,
  ZERO_USAGE,
  addUsage,
  assertProxied,
  generateJson,
  usageCostUsd,
} from "./vertex";

const ROOT = resolve(import.meta.dirname, "../..");
const TAXONOMY_PATH = resolve(ROOT, "content/canonical/taxonomy.json");
export const REVIEW_CSV = resolve(
  ROOT,
  "docs/plans/lisa-video-library/video-tags-review.csv",
);
const OUT_DIR = resolve(CACHE_DIR, "video-library");

export const VIDEO_TAG_SYSTEM = `You tag SAT preparation videos for Lyceon, an SAT practice platform, so that a student practising a skill can be offered a video that teaches it. You see a video's title, its creator's description and its chapter titles, never the video itself.

skill_codes: the SAT skills the video actually teaches, chosen only from the list in the response schema, most prominent first, at most eight. A video covering many skills (a masterclass, a full practice test walkthrough, an "all of Desmos" video) gets each skill it really teaches. A skill merely mentioned, or listed only in a link to another video, does not count. If the video teaches no SAT skill (a webinar, a channel trailer, admissions or test-registration logistics, general motivation, a course advertisement), return an empty list. Do not guess from a vague title: if the title, description and chapters do not show which skills are taught, return only the skills they do show.

chapter_skills: only when chapters are given, one entry per chapter (by its index), naming the one skill from your skill_codes that the chapter teaches, or null for an intro, outro or non-teaching chapter.

reason: one sentence, at most 25 words, saying what in the title, description or chapters shows the skills. Do not quote promotional text.`;

export const VIDEO_TAG_PROMPT_VERSION = createHash("sha256")
  .update(VIDEO_TAG_SYSTEM)
  .digest("hex")
  .slice(0, 12);

const metadataSchema = z.array(
  z.object({
    source: z.object({ tier: z.number(), label: z.string() }),
    videos: z.array(
      z.object({
        video_id: z.string(),
        title: z.string(),
        channel_name: z.string(),
        duration_seconds: z.number(),
        description: z.string(),
        chapters: z.array(
          z.object({
            title: z.string(),
            start_seconds: z.number(),
            end_seconds: z.number(),
          }),
        ),
      }),
    ),
  }),
);
type Video = z.infer<typeof metadataSchema>[number]["videos"][number] & {
  tier: number;
  source_label: string;
};

/** skill name → its domain, and the 29 names in a stable order, read from the taxonomy. */
export function loadTaxonomy(): {
  skills: [string, ...string[]];
  domainOf: Map<string, string>;
} {
  const parsed = z
    .object({ skills: z.record(z.array(z.string())) })
    .parse(JSON.parse(readFileSync(TAXONOMY_PATH, "utf8")));
  const domainOf = new Map<string, string>();
  for (const [domain, names] of Object.entries(parsed.skills)) {
    for (const n of names) domainOf.set(n, domain);
  }
  const [first, ...rest] = [...domainOf.keys()].sort();
  if (first === undefined) throw new Error("taxonomy has no skills");
  return { skills: [first, ...rest], domainOf };
}

export function tagResponseSchemaFor(
  skills: readonly string[],
): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      skill_codes: {
        type: "ARRAY",
        items: { type: "STRING", enum: [...skills] },
      },
      chapter_skills: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            chapter: { type: "INTEGER" },
            skill: { type: "STRING", enum: [...skills], nullable: true },
          },
          required: ["chapter", "skill"],
        },
      },
      reason: { type: "STRING" },
    },
    required: ["skill_codes", "chapter_skills", "reason"],
  };
}

export function tagSchemaFor(skills: readonly [string, ...string[]]) {
  return z.object({
    skill_codes: z.array(z.enum(skills)).max(8),
    chapter_skills: z.array(
      z.object({
        chapter: z.number().int().nonnegative(),
        skill: z.enum(skills).nullable(),
      }),
    ),
    reason: z.string(),
  });
}

export type VideoTagRow = {
  video_id: string;
  tier: number;
  source: string;
  title: string;
  channel_name: string;
  duration_seconds: number;
  skill_codes: string[];
  domain: string | null;
  start_seconds: number | null;
  chapters: number;
  reason: string;
  error: string | null;
};

/**
 * Turns the model's answer into the stored row: de-duplicated skills in the model's order, the
 * first skill's domain, and the start of the first chapter mapped to the first skill (null at
 * 0, without chapters, or outside the video). A chapter index out of range fails the row; a
 * video with no chapters has nothing to map, so any chapter_skills the model returns for it
 * are ignored (August 2024 predictions, 2026-10-15: chapter 0 of none failed the whole row).
 */
export function toRow(
  v: Video,
  out: {
    skill_codes: string[];
    chapter_skills: Array<{ chapter: number; skill: string | null }>;
    reason: string;
  },
  domainOf: ReadonlyMap<string, string>,
): VideoTagRow {
  const base = {
    video_id: v.video_id,
    tier: v.tier,
    source: v.source_label,
    title: v.title,
    channel_name: v.channel_name,
    duration_seconds: v.duration_seconds,
    chapters: v.chapters.length,
    reason: out.reason,
  };
  const skills = [...new Set(out.skill_codes)];
  const chapterSkills = v.chapters.length === 0 ? [] : out.chapter_skills;
  const bad = chapterSkills.find((c) => c.chapter >= v.chapters.length);
  if (bad !== undefined) {
    return {
      ...base,
      skill_codes: [],
      domain: null,
      start_seconds: null,
      error: `chapter index ${bad.chapter} out of range`,
    };
  }
  const first = skills[0];
  const domain = first === undefined ? null : (domainOf.get(first) ?? null);
  const chapter =
    first === undefined
      ? undefined
      : [...chapterSkills]
          .sort((a, b) => a.chapter - b.chapter)
          .find((c) => c.skill === first);
  const start =
    chapter === undefined
      ? null
      : (v.chapters[chapter.chapter]?.start_seconds ?? null);
  return {
    ...base,
    skill_codes: skills,
    domain,
    start_seconds:
      start === null || start <= 0 || start >= v.duration_seconds
        ? null
        : Math.floor(start),
    error: null,
  };
}

function csvCell(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: VideoTagRow[]): string {
  const header = [
    "approve",
    "video_id",
    "tier",
    "source",
    "title",
    "channel",
    "duration",
    "skills",
    "domain",
    "start",
    "chapters",
    "reason",
    "error",
    "url",
    "duration_s",
    "start_s",
    ...METHOD_COLUMNS,
  ];
  const lines = rows.map((r) =>
    [
      "",
      r.video_id,
      r.tier,
      r.source,
      r.title,
      r.channel_name,
      formatSeconds(r.duration_seconds),
      r.skill_codes.join("; "),
      r.domain,
      r.start_seconds === null ? null : formatSeconds(r.start_seconds),
      r.chapters,
      r.reason,
      r.error,
      `https://www.youtube.com/watch?v=${r.video_id}${r.start_seconds === null ? "" : `&t=${r.start_seconds}s`}`,
      Math.round(r.duration_seconds),
      r.start_seconds,
      // The methods pass fills these (`--methods`); a fresh tagging run leaves them blank.
      ...METHOD_COLUMNS.map(() => null),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

const tagRowSchema = z.object({
  video_id: z.string(),
  tier: z.number(),
  source: z.string(),
  title: z.string(),
  channel_name: z.string(),
  duration_seconds: z.number(),
  skill_codes: z.array(z.string()),
  domain: z.string().nullable(),
  start_seconds: z.number().nullable(),
  chapters: z.number(),
  reason: z.string(),
  error: z.string().nullable(),
});

// ── The methods pass ─────────────────────────────────────────────────────────

/** The four columns the methods pass fills, at the end of every review row. */
export const METHOD_COLUMNS = [
  "methods",
  "format",
  "method_evidence",
  "method_source",
] as const;

/** Clips the watch call to what the student sees: the landing chapter, or the opening 20 min. */
export const WATCH_CAP_SECONDS = 1200;

export function methodRules(methods: readonly string[]): string {
  const known = VIDEO_METHOD_DEFINITIONS as Readonly<
    Record<string, { means: string; test: string }>
  >;
  const candidates: Readonly<Record<string, { means: string; test: string }>> =
    {
      backsolve: {
        means:
          "Solves by trying the answer choices, or numbers it picks, in the question.",
        test: "The video substitutes the given choices or chosen test numbers into the question to find or eliminate the answer.",
      },
    };
  const line = (m: string): string => {
    const d = known[m] ?? candidates[m];
    if (d === undefined) throw new Error(`no definition for method "${m}"`);
    return `- ${m}: ${d.means} Test: ${d.test}`;
  };
  return [
    "methods: how the video solves SAT math questions, from this list only, each with one sentence of evidence (at most 25 words) naming what the video does. A video may use several. A math formula or rule video carries the method its formula is used with: algebraic, since the formula is applied by hand. A Reading and Writing video gets an empty list.",
    ...methods.map(line),
    "",
    "format: exactly one, with one sentence of evidence (at most 25 words).",
    ...VIDEO_FORMATS.map(
      (f) =>
        `- ${f}: ${VIDEO_FORMAT_DEFINITIONS[f].means} Test: ${VIDEO_FORMAT_DEFINITIONS[f].test}`,
    ),
  ].join("\n");
}

export const METHODS_TEXT_SYSTEM = (methods: readonly string[]): string =>
  `You tag SAT preparation videos for Lyceon, so a student who asks for a way of solving (for example "show me on Desmos") is offered a video that solves that way. You see the video's title, its creator's description and its chapters, not the video itself. When the student starts partway in (a "Student starts at" line), tag only what is taught from that point to the next chapter.

${methodRules(methods)}

Tag a method from text only when the title, description or chapter titles name it for the part being tagged ("Desmos", "by hand", "plug in the answer choices", a formula series). A problem or strategy named without saying how it is solved does not show the method.

needs_video: true when the text does not show the methods or the format for the part being tagged. Do not guess; say you need the video.`;

export const METHODS_WATCH_SYSTEM = (methods: readonly string[]): string =>
  `You tag SAT preparation videos for Lyceon, so a student who asks for a way of solving (for example "show me on Desmos") is offered a video that solves that way. You watch the clip the student would see (what is on screen and what is said). Tag only what the clip shows.

${methodRules(methods)}`;

function methodsResponseSchemaFor(
  methods: readonly string[],
  withNeedsVideo: boolean,
): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      methods: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            method: { type: "STRING", enum: [...methods] },
            evidence: { type: "STRING" },
          },
          required: ["method", "evidence"],
        },
      },
      format: { type: "STRING", enum: [...VIDEO_FORMATS] },
      format_evidence: { type: "STRING" },
      ...(withNeedsVideo ? { needs_video: { type: "BOOLEAN" } } : {}),
    },
    required: [
      "methods",
      "format",
      "format_evidence",
      ...(withNeedsVideo ? ["needs_video"] : []),
    ],
  };
}

function methodsZodFor(methods: readonly [string, ...string[]]) {
  return z.object({
    methods: z.array(
      z.object({ method: z.enum(methods), evidence: z.string().min(1) }),
    ),
    format: z.enum(VIDEO_FORMATS),
    format_evidence: z.string().min(1),
    needs_video: z.boolean().optional(),
  });
}
type MethodsAnswer = z.infer<ReturnType<typeof methodsZodFor>>;

/** The clip a watch call reads: from the start to the next chapter, capped. Pure. */
export function watchClip(
  durationSeconds: number,
  startSeconds: number | null,
  chapterStarts: readonly number[],
): { start: number; end: number } {
  const start = startSeconds ?? 0;
  const next = [...chapterStarts].sort((a, b) => a - b).find((c) => c > start);
  const end = Math.min(
    durationSeconds,
    next ?? durationSeconds,
    start + WATCH_CAP_SECONDS,
  );
  return { start, end };
}

export type MethodsResult = {
  methods: string[];
  format: VideoFormat;
  evidence: string;
  source: "text" | "video";
};

/**
 * Two watch runs → one result. A method counts only when both runs saw it; the evidence is
 * the first run's. Two different formats fail the row (it goes to review by hand). Pure.
 */
export function combineWatchRuns(
  a: MethodsAnswer,
  b: MethodsAnswer,
): MethodsResult {
  if (a.format !== b.format)
    throw new Error(
      `the two watch runs disagree on format: ${a.format} / ${b.format}`,
    );
  const seen = new Set(b.methods.map((m) => m.method));
  const kept = a.methods.filter((m) => seen.has(m.method));
  return {
    methods: [...new Set(kept.map((m) => m.method))],
    format: a.format,
    evidence: evidenceLine(kept, a.format, a.format_evidence),
    source: "video",
  };
}

function evidenceLine(
  methods: ReadonlyArray<{ method: string; evidence: string }>,
  format: string,
  formatEvidence: string,
): string {
  return [
    ...methods.map((m) => `${m.method}: ${m.evidence}`),
    `format ${format}: ${formatEvidence}`,
  ].join(" | ");
}

const methodsCacheSchema = z.object({
  video_id: z.string(),
  prompt: z.string(),
  methods: z.array(z.string()),
  format: z.enum(VIDEO_FORMATS),
  evidence: z.string(),
  source: z.enum(["text", "video"]),
});

/** The reviewed file's rows by column name, header first; every cell kept as read. */
function readReviewRows(): { header: string[]; rows: string[][] } {
  const [header, ...rows] = parseCsv(readFileSync(REVIEW_CSV, "utf8")).filter(
    (r) => !(r.length === 1 && r[0] === ""),
  );
  if (header === undefined) throw new Error("video-tags-review.csv is empty");
  return { header, rows };
}

async function runMethodsPass(opts: {
  model: string;
  candidates: string[];
}): Promise<void> {
  const methods = [...VIDEO_METHODS, ...opts.candidates] as [
    string,
    ...string[],
  ];
  const version = createHash("sha256")
    .update(METHODS_TEXT_SYSTEM(methods) + METHODS_WATCH_SYSTEM(methods))
    .digest("hex")
    .slice(0, 12);
  const meta = new Map(
    metadataSchema
      .parse(
        JSON.parse(readFileSync(resolve(CACHE_DIR, "metadata.json"), "utf8")),
      )
      .flatMap((r) => r.videos)
      .map((v) => [v.video_id, v]),
  );
  const { header, rows } = readReviewRows();
  const base = header.filter(
    (h) => !(METHOD_COLUMNS as readonly string[]).includes(h),
  );
  const col = (name: string): number => {
    const i = base.indexOf(name);
    if (i < 0) throw new Error(`video-tags-review.csv has no "${name}" column`);
    return i;
  };
  const cachePath = resolve(OUT_DIR, "methods.jsonl");
  const cached = new Map(
    (existsSync(cachePath) ? readFileSync(cachePath, "utf8").split("\n") : [])
      .filter((l) => l.trim() !== "")
      .map((l) => methodsCacheSchema.parse(JSON.parse(l)))
      .filter((c) => c.prompt === version)
      .map((c) => [c.video_id, c]),
  );
  let usage: Usage = ZERO_USAGE;
  const onUsage = (u: Usage): void => {
    usage = addUsage(usage, u);
  };
  const textSchema = methodsZodFor(methods);
  const results = await pool(rows, 4, async (cells) => {
    const id = cells[col("video_id")] ?? "";
    if ((cells[col("approve")] ?? "").trim().toLowerCase() !== "yes")
      return null;
    const hit = cached.get(id);
    if (hit !== undefined) return { id, ...hit };
    const v = meta.get(id);
    if (v === undefined)
      throw new Error(
        `${id}: not in metadata.json; run fetch-video-metadata.ts`,
      );
    const startCell = (cells[col("start_s")] ?? "").trim();
    const start = startCell === "" ? null : Number(startCell);
    const landing =
      start === null
        ? undefined
        : [...v.chapters].reverse().find((c) => c.start_seconds <= start);
    const text = await generateJson({
      step: `methods ${id}`,
      model: opts.model,
      system: METHODS_TEXT_SYSTEM(methods),
      user: [
        `Title: ${v.title}`,
        `Channel: ${v.channel_name}`,
        `Length: ${formatSeconds(v.duration_seconds)}`,
        ...(start === null
          ? []
          : [
              `Student starts at: ${formatSeconds(start)}${landing ? ` (${landing.title})` : ""}`,
            ]),
        v.chapters.length > 0
          ? `Chapters:\n${v.chapters.map((c) => `${formatSeconds(c.start_seconds)} ${c.title}`).join("\n")}`
          : "Chapters: none",
        `Description:\n${v.description.slice(0, 4000)}`,
      ].join("\n"),
      responseSchema: methodsResponseSchemaFor(methods, true),
      schema: textSchema,
      onUsage,
    });
    let result: MethodsResult;
    if (text.needs_video !== true) {
      result = {
        methods: [...new Set(text.methods.map((m) => m.method))],
        format: text.format,
        evidence: evidenceLine(text.methods, text.format, text.format_evidence),
        source: "text",
      };
    } else {
      const clip = watchClip(
        v.duration_seconds,
        start,
        v.chapters.map((c) => c.start_seconds),
      );
      const watch = () =>
        generateJson({
          step: `methods-watch ${id}`,
          model: opts.model,
          system: METHODS_WATCH_SYSTEM(methods),
          user: `Title: ${v.title}\nClip: ${formatSeconds(clip.start)} to ${formatSeconds(clip.end)}`,
          responseSchema: methodsResponseSchemaFor(methods, false),
          schema: textSchema,
          video: { videoId: id, start: clip.start, end: clip.end },
          onUsage,
        });
      result = combineWatchRuns(await watch(), await watch());
    }
    const entry = { video_id: id, prompt: version, ...result };
    return { id, ...entry };
  });

  const done = results.filter((r): r is NonNullable<typeof r> => r !== null);
  mkdirSync(OUT_DIR, { recursive: true });
  const merged = new Map(cached);
  for (const r of done) {
    const { id: _id, ...entry } = r;
    merged.set(r.video_id, entry);
  }
  writeFileSync(
    cachePath,
    [...merged.values()].map((c) => JSON.stringify(c)).join("\n") + "\n",
  );
  const byId = new Map(done.map((r) => [r.video_id, r]));
  const vocabulary = new Set<string>(VIDEO_METHODS);
  const out = rows.map((cells) => {
    const kept = base.map((h) => cells[header.indexOf(h)] ?? "");
    const r = byId.get(kept[col("video_id")] ?? "");
    if (r === undefined) return [...kept, "", "", "", ""];
    return [
      ...kept,
      r.methods.filter((m) => vocabulary.has(m)).join("; "),
      r.format,
      r.evidence,
      r.source,
    ];
  });
  writeFileSync(
    REVIEW_CSV,
    [[...base, ...METHOD_COLUMNS], ...out]
      .map((cells) => cells.map(csvCell).join(","))
      .join("\n") + "\n",
  );
  const count = (m: string): string[] =>
    done.filter((r) => r.methods.includes(m)).map((r) => r.video_id);
  process.stdout.write(
    [
      `methods pass: ${done.length} approved rows (${done.filter((r) => r.source === "video").length} needed the video); ${usage.calls} calls, $${usageCostUsd(usage).toFixed(3)}`,
      ...methods.map(
        (m) =>
          `  ${m}${vocabulary.has(m) ? "" : " (candidate, not written)"}: ${count(m).length}${vocabulary.has(m) ? "" : ` ${count(m).join(",")}`}`,
      ),
      ...VIDEO_FORMATS.map(
        (f) => `  format ${f}: ${done.filter((r) => r.format === f).length}`,
      ),
      `  needed the video: ${
        done
          .filter((r) => r.source === "video")
          .map((r) => r.video_id)
          .join(",") || "none"
      }`,
      `review: ${REVIEW_CSV}`,
    ].join("\n") + "\n",
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      model: { type: "string", default: GENERATION_MODEL_DEFAULT },
      // Re-tag only these ids (comma-separated); every other row is kept from tags.jsonl.
      only: { type: "string" },
      // The methods pass over the reviewed file (see the header).
      methods: { type: "boolean", default: false },
      "candidate-methods": { type: "string" },
    },
  });
  assertProxied();
  const model = z.string().min(1).parse(values.model);
  if (values.methods === true) {
    const candidates = (values["candidate-methods"] ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c !== "");
    await runMethodsPass({ model, candidates });
    return;
  }
  const { skills, domainOf } = loadTaxonomy();
  if (skills.length !== 29)
    throw new Error(`taxonomy lists ${skills.length} skills, expected 29`);
  const videos: Video[] = metadataSchema
    .parse(
      JSON.parse(readFileSync(resolve(CACHE_DIR, "metadata.json"), "utf8")),
    )
    .flatMap((r) =>
      r.videos.map((v) => ({
        ...v,
        tier: r.source.tier,
        source_label: r.source.label,
      })),
    );
  const seen = new Set<string>();
  const unique = videos.filter((v) =>
    seen.has(v.video_id) ? false : (seen.add(v.video_id), true),
  );
  const only =
    values.only === undefined ? null : new Set(values.only.split(","));
  const kept = new Map<string, VideoTagRow>(
    only === null
      ? []
      : readFileSync(resolve(OUT_DIR, "tags.jsonl"), "utf8")
          .split("\n")
          .filter((l) => l.trim() !== "")
          .map((l) => tagRowSchema.parse(JSON.parse(l)))
          .map((r) => [r.video_id, r]),
  );

  let usage: Usage = ZERO_USAGE;
  const schema = tagSchemaFor(skills);
  const rows: VideoTagRow[] = await pool(unique, 4, async (v) => {
    const previous = kept.get(v.video_id);
    if (only !== null && !only.has(v.video_id) && previous !== undefined)
      return previous;
    try {
      const out = await generateJson({
        step: `tag ${v.video_id}`,
        model,
        system: VIDEO_TAG_SYSTEM,
        user: [
          `Title: ${v.title}`,
          `Channel: ${v.channel_name}`,
          `Length: ${formatSeconds(v.duration_seconds)}`,
          v.chapters.length > 0
            ? `Chapters:\n${v.chapters.map((c, i) => `${i}. ${formatSeconds(c.start_seconds)} ${c.title}`).join("\n")}`
            : "Chapters: none",
          `Description:\n${v.description.slice(0, 4000)}`,
        ].join("\n"),
        responseSchema: tagResponseSchemaFor(skills),
        schema,
        onUsage: (u) => {
          usage = addUsage(usage, u);
        },
      });
      return toRow(v, out, domainOf);
    } catch (err: unknown) {
      // A row that fails its schema (an invented skill name included) is reported, not coerced.
      return {
        video_id: v.video_id,
        tier: v.tier,
        source: v.source_label,
        title: v.title,
        channel_name: v.channel_name,
        duration_seconds: v.duration_seconds,
        skill_codes: [],
        domain: null,
        start_seconds: null,
        chapters: v.chapters.length,
        reason: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(resolve(REVIEW_CSV, ".."), { recursive: true });
  writeFileSync(
    resolve(OUT_DIR, "tags.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  writeFileSync(REVIEW_CSV, toCsv(rows));
  const failed = rows.filter((r) => r.error !== null);
  const untagged = rows.filter(
    (r) => r.error === null && r.skill_codes.length === 0,
  );
  process.stdout.write(
    `${rows.length} videos: ${rows.length - failed.length - untagged.length} tagged, ${untagged.length} with no SAT skill, ${failed.length} failed; ${usage.calls} calls, $${usageCostUsd(usage).toFixed(3)} (prompt ${VIDEO_TAG_PROMPT_VERSION})\nreview: ${REVIEW_CSV}\nnext: Karl marks approve=yes, then scripts/rag/apply-video-library.ts writes exactly the reviewed file.\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
