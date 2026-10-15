/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 C: content gate first (Karl, 2026-10-13), then
 *       segmentation + description, merging where an explanation spans a window edge]
 *       | @implemented [2026-10-15]
 *
 * plain English: step C of the build-time pipeline, per video of the chosen tier.
 *  1. Cut windows (`cutWindows`: chapters where present, ~60 s windows otherwise).
 *  2. Gate + boundary call per window (GATE_SYSTEM): does it teach SAT content, and does it
 *     start or end mid-explanation? The text just before and after is given for context.
 *  3. Merge on boundary (`mergeOnBoundary`, cap 180 s). A group still open at either end is
 *     dropped: it would hand a student half an explanation.
 *  4. Describe call per merged group (DESCRIBE_SYSTEM). Dropped when the model returns null
 *     (nothing self-contained), when it still judges the segment open at an end that isn't the
 *     video's, or when the description shares an 8-word run with the transcript.
 *
 * Output: `scripts/rag/.cache/tier-<n>/videos/<video_id>.json`, one per video, holding times,
 * the model's judgements and the Lyceon-written descriptions. **No transcript text is written
 * anywhere.** A video already processed with the same PROMPT_VERSION and model is skipped, so
 * a run resumes where it stopped.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/generate-descriptions.ts --tier 1
 *          [--model gemini-3.5-flash] [--only <video_id>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { CACHE_DIR, readCachedTranscript } from "./fetch-transcripts";
import {
  DESCRIBE_SYSTEM,
  GATE_SYSTEM,
  PROMPT_VERSION,
  type DescribeResult,
  describeResponseSchema,
  describeSchema,
  firstWords,
  formatSeconds,
  gateResponseSchema,
  gateSchema,
  lastWords,
} from "./prompts";
import {
  type WindowAssessment,
  cutWindows,
  mergeOnBoundary,
  provenanceOf,
  sharesVerbatimRun,
  windowAssessmentSchema,
  windowText,
} from "./segments";
import { type Chapter } from "./sources";
import {
  GENERATION_MODEL_DEFAULT,
  assertProxied,
  generateJson,
} from "./vertex";

const metadataSchema = z.array(
  z.object({
    source: z.object({ tier: z.number(), label: z.string() }),
    videos: z.array(
      z.object({
        video_id: z.string(),
        title: z.string(),
        channel_name: z.string(),
        duration_seconds: z.number(),
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
export type VideoMeta = z.infer<
  typeof metadataSchema
>[number]["videos"][number];

export function loadTierVideos(tier: number): VideoMeta[] {
  const metadata = metadataSchema.parse(
    JSON.parse(readFileSync(resolve(CACHE_DIR, "metadata.json"), "utf8")),
  );
  return metadata
    .filter((r) => r.source.tier === tier)
    .flatMap((r) => r.videos);
}

export const groupOutcomeSchema = z.object({
  start: z.number(),
  end: z.number(),
  windows: z.array(z.number()),
  provenance: z.string(),
  outcome: z.enum(["kept", "dropped"]),
  drop_reason: z.string().nullable(),
  describe: describeSchema.nullable(),
});
export type GroupOutcome = z.infer<typeof groupOutcomeSchema>;

export const videoResultSchema = z.object({
  video_id: z.string(),
  prompt_version: z.string(),
  model: z.string(),
  transcript_track: z.enum(["manual", "asr"]),
  used_chapters: z.boolean(),
  windows: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      assessment: windowAssessmentSchema,
    }),
  ),
  groups: z.array(groupOutcomeSchema),
});
export type VideoResult = z.infer<typeof videoResultSchema>;

export function tierDir(tier: number): string {
  return resolve(CACHE_DIR, `tier-${tier}`);
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next;
      next += 1;
      const item = items[i];
      if (item !== undefined) out[i] = await fn(item, i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

async function processVideo(
  video: VideoMeta,
  model: string,
): Promise<VideoResult | null> {
  const transcript = readCachedTranscript(video.video_id);
  if (transcript === null) return null;
  const chapters: Chapter[] = video.chapters;
  const windows = cutWindows(transcript.cues, chapters);
  const texts = windows.map((w) => windowText(w.cues));
  const span = `of ${formatSeconds(video.duration_seconds)}`;

  const assessments: WindowAssessment[] = await pool(windows, 4, (w, i) =>
    generateJson({
      step: `gate ${video.video_id} ${formatSeconds(w.start)}`,
      model,
      system: GATE_SYSTEM,
      user: [
        `Video title: ${video.title}`,
        `Window: ${formatSeconds(w.start)}–${formatSeconds(w.end)} ${span}`,
        "",
        `Text just before the window (context only): «${lastWords(texts[i - 1] ?? "", 40) || "(start of video)"}»`,
        "",
        `WINDOW TEXT: «${texts[i] ?? ""}»`,
        "",
        `Text just after the window (context only): «${firstWords(texts[i + 1] ?? "", 40) || "(end of video)"}»`,
      ].join("\n"),
      responseSchema: gateResponseSchema,
      schema: gateSchema,
    }),
  );

  const groups = mergeOnBoundary(windows, assessments);
  const lastWindow = windows.length - 1;
  const outcomes: GroupOutcome[] = await pool(groups, 4, async (g) => {
    const provenance = provenanceOf(video.video_id, g.start, g.end);
    const base = { start: g.start, end: g.end, windows: g.windows, provenance };
    if (g.open_start || g.open_end) {
      return {
        ...base,
        outcome: "dropped" as const,
        drop_reason: `open boundary (${[g.open_start ? "starts" : "", g.open_end ? "ends" : ""].filter(Boolean).join(" and ")} mid-explanation after merge)`,
        describe: null,
      };
    }
    const first = g.windows[0] ?? 0;
    const last = g.windows[g.windows.length - 1] ?? 0;
    const text = g.windows.map((i) => texts[i] ?? "").join(" ");
    const d: DescribeResult = await generateJson({
      step: `describe ${provenance}`,
      model,
      system: DESCRIBE_SYSTEM,
      user: [
        `Video title: ${video.title}`,
        `Segment: ${formatSeconds(g.start)}–${formatSeconds(g.end)} ${span}`,
        "",
        `Text just before the segment (context only): «${lastWords(texts[first - 1] ?? "", 40) || "(start of video)"}»`,
        "",
        `SEGMENT TEXT: «${text}»`,
        "",
        `Text just after the segment (context only): «${firstWords(texts[last + 1] ?? "", 40) || "(end of video)"}»`,
      ].join("\n"),
      responseSchema: describeResponseSchema,
      schema: describeSchema,
    });
    let drop: string | null = null;
    if (d.description === null) drop = "teaches nothing self-contained";
    else if (d.starts_mid_explanation && first > 0)
      drop = "describe: starts mid-explanation";
    else if (d.ends_mid_explanation && last < lastWindow)
      drop = "describe: ends mid-explanation";
    else if (sharesVerbatimRun(d.description, text))
      drop = "description repeats the transcript (8-word run)";
    return {
      ...base,
      outcome: drop === null ? ("kept" as const) : ("dropped" as const),
      drop_reason: drop,
      describe: d,
    };
  });

  return {
    video_id: video.video_id,
    prompt_version: PROMPT_VERSION,
    model,
    transcript_track: transcript.track,
    used_chapters: chapters.length > 0,
    windows: windows.map((w, i) => {
      const assessment = assessments[i];
      if (assessment === undefined)
        throw new Error(`missing assessment ${video.video_id} #${i}`);
      return { start: w.start, end: w.end, assessment };
    }),
    groups: outcomes,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tier: { type: "string" },
      model: { type: "string", default: GENERATION_MODEL_DEFAULT },
      only: { type: "string" },
    },
  });
  assertProxied();
  const tier = z.coerce.number().int().min(1).max(5).parse(values.tier);
  const model = z.string().min(1).parse(values.model);
  const dir = resolve(tierDir(tier), "videos");
  mkdirSync(dir, { recursive: true });
  const videos = loadTierVideos(tier).filter(
    (v) => values.only === undefined || v.video_id === values.only,
  );
  let done = 0;
  let resumed = 0;
  const noTranscript: string[] = [];
  for (const video of videos) {
    const out = resolve(dir, `${video.video_id}.json`);
    if (existsSync(out)) {
      const prior = videoResultSchema.safeParse(
        JSON.parse(readFileSync(out, "utf8")),
      );
      if (
        prior.success &&
        prior.data.prompt_version === PROMPT_VERSION &&
        prior.data.model === model
      ) {
        resumed += 1;
        continue;
      }
    }
    const result = await processVideo(video, model);
    if (result === null) {
      noTranscript.push(video.video_id);
      continue;
    }
    writeFileSync(out, JSON.stringify(result, null, 2));
    done += 1;
    const kept = result.groups.filter((g) => g.outcome === "kept").length;
    process.stdout.write(
      `${video.video_id}: ${result.windows.length} windows, ${result.groups.length} groups, ${kept} kept\n`,
    );
  }
  process.stdout.write(
    `tier ${tier}: ${done} processed, ${resumed} already done (prompt ${PROMPT_VERSION}), ${noTranscript.length} without a cached transcript${noTranscript.length > 0 ? `: ${noTranscript.join(", ")}` : ""}\n`,
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
