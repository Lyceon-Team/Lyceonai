/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 C: content gate first (Karl, 2026-10-13), then
 *       segmentation + description, never handing a student half an explanation; §D.2 B as
 *       replaced by R-14 (Karl, 2026-10-15: Gemini reads the video, decided per tier)]
 *       | @implemented [2026-10-15]
 *
 * plain English: step C of the build-time pipeline, per video of the chosen tier, from one of
 * two sources chosen per tier (`--source`; Karl 2026-10-15: "decide per tier, not globally"):
 *
 * `video` — for tiers that teach on screen (R-14). Gemini watches the public YouTube video on
 * Vertex; nothing is fetched or cached here, so no transcript exists at all.
 *  1. Segment: one call watches the WHOLE video and proposes segments that tile it, cut
 *     between problems, each marked teaching or not (the content gate). `normalizeSegmentation`
 *     checks the tiling and refuses a bad one (one retry). Why whole-video and not fixed
 *     windows + merge: on Tutorllini lesson 1, per-window boundary judgements flipped between
 *     two identical runs (1 vs 3 segments kept), because a window can't see where the problem
 *     it cuts through ends; the whole-video proposal was identical on two runs and cut exactly
 *     at the problem boundaries (2026-10-15).
 *  2. Boundary check on every cut between two teaching segments (watches 20 s either side),
 *     then `mergeOnBoundary` rejoins segments across any cut that splits an explanation, up to
 *     180 s. A group still open at the cap, or one over 180 s, is dropped as open-ended.
 *  3. Describe: one call per group watches that clip. A describe-stage "mid" flag on a cut
 *     already checked defers to the check; on an unchecked cut (beside a non-teaching span)
 *     the boundary check decides, and a cut it says splits an explanation drops the group.
 *
 * `transcript` — for tiers that are a person talking over text, from fetch-transcripts.ts:
 * ~60 s windows aligned to cues, a gate + boundary call per window, `mergeOnBoundary` (cap
 * 180 s; a group still open is dropped), then a describe call per group with the 8-word
 * verbatim check.
 *
 * Output: `scripts/rag/.cache/tier-<n>/videos/<video_id>.json`, one per video: times, the
 * model's judgements, the Lyceon-written descriptions and token usage per stage. **No
 * transcript text is written anywhere.** A video already processed with the same
 * PROMPT_VERSION, model and source is skipped, so a run resumes where it stopped.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/generate-descriptions.ts --tier 1
 *          --source video [--model gemini-3.5-flash] [--only <video_id>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { CACHE_DIR, readCachedTranscript } from "./fetch-transcripts";
import {
  BOUNDARY_VIDEO_SYSTEM,
  DESCRIBE_SYSTEM,
  DESCRIBE_VIDEO_SYSTEM,
  GATE_SYSTEM,
  PROMPT_VERSION,
  SEGMENT_VIDEO_SYSTEM,
  type DescribeResult,
  boundaryResponseSchema,
  boundarySchema,
  describeResponseSchema,
  describeSchema,
  firstWords,
  formatSeconds,
  gateResponseSchema,
  gateSchema,
  lastWords,
  segmentResponseSchema,
  segmentSchema,
} from "./prompts";
import {
  SEGMENT_MAX_SECONDS,
  type WindowAssessment,
  cutWindows,
  mergeOnBoundary,
  normalizeSegmentation,
  provenanceOf,
  sharesVerbatimRun,
  windowAssessmentSchema,
  windowText,
} from "./segments";
import {
  GENERATION_MODEL_DEFAULT,
  type Usage,
  ZERO_USAGE,
  addUsage,
  assertProxied,
  generateJson,
  usageSchema,
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

const tiebreakSchema = z.object({
  edge: z.enum(["start", "end"]),
  at: z.number(),
  explanation_spans_cut: z.boolean(),
  reason: z.string(),
});

export const groupOutcomeSchema = z.object({
  start: z.number(),
  end: z.number(),
  windows: z.array(z.number()),
  provenance: z.string(),
  outcome: z.enum(["kept", "dropped"]),
  drop_reason: z.string().nullable(),
  describe: describeSchema.nullable(),
  /** the boundary tie-break, when the describe call contradicted the cut (video only) */
  tiebreak: z.array(tiebreakSchema),
});
export type GroupOutcome = z.infer<typeof groupOutcomeSchema>;

export const sourceSchema = z.enum(["video", "transcript"]);
export type Source = z.infer<typeof sourceSchema>;

export const videoResultSchema = z.object({
  video_id: z.string(),
  prompt_version: z.string(),
  model: z.string(),
  /** what the model read: the video itself (R-14) or the cached captions */
  source: sourceSchema,
  transcript_track: z.enum(["manual", "asr"]).nullable(),
  used_chapters: z.boolean(),
  /** the content-gate units: proposed segments (video) or fixed windows (transcript) */
  windows: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      assessment: windowAssessmentSchema,
    }),
  ),
  groups: z.array(groupOutcomeSchema),
  /** video: every cut between two teaching segments, and whether an explanation spans it */
  edge_checks: z.array(
    z.object({
      at: z.number(),
      explanation_spans_cut: z.boolean(),
      reason: z.string(),
    }),
  ),
  usage: z.object({
    /** video: the whole-video segmentation call; transcript: the per-window gate */
    gate: usageSchema,
    describe: usageSchema,
    tiebreak: usageSchema,
  }),
});
export type VideoResult = z.infer<typeof videoResultSchema>;

/** Video calls in flight per video; video input hits the per-minute token quota fast. */
const VIDEO_CONCURRENCY = 2;

export function tierDir(tier: number): string {
  return resolve(CACHE_DIR, `tier-${tier}`);
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function pool<T, R>(
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

function dropReasonFor(
  d: DescribeResult,
  startOpen: boolean,
  endOpen: boolean,
): string | null {
  if (d.description === null) return "teaches nothing self-contained";
  if (startOpen) return "describe: starts mid-explanation";
  if (endOpen) return "describe: ends mid-explanation";
  return null;
}

async function processFromVideo(
  video: VideoMeta,
  model: string,
): Promise<VideoResult> {
  const span = `of ${formatSeconds(video.duration_seconds)}`;
  let gateUsage: Usage = ZERO_USAGE;
  let describeUsage: Usage = ZERO_USAGE;
  let tiebreakUsage: Usage = ZERO_USAGE;

  // 1. Whole-video segmentation (one retry on a tiling that fails validation).
  let segmentation = null as ReturnType<typeof normalizeSegmentation> | null;
  for (let attempt = 0; attempt < 2 && !segmentation?.ok; attempt += 1) {
    const proposed = await generateJson({
      step: `segment ${video.video_id}`,
      model,
      system: SEGMENT_VIDEO_SYSTEM,
      video: { videoId: video.video_id, start: 0, end: video.duration_seconds },
      user: `Video title: ${video.title}\nThe video is ${Math.round(video.duration_seconds)} seconds long.`,
      responseSchema: segmentResponseSchema,
      schema: segmentSchema,
      onUsage: (u) => {
        gateUsage = addUsage(gateUsage, u);
      },
    });
    segmentation = normalizeSegmentation(
      proposed.segments,
      video.duration_seconds,
    );
  }
  if (!segmentation?.ok) {
    throw new Error(
      `segment ${video.video_id}: ${segmentation?.error ?? "no proposal"} (twice)`,
    );
  }
  const segments = segmentation.segments;

  const spansCut = (at: number) =>
    generateJson({
      step: `boundary ${video.video_id} ${formatSeconds(at)}`,
      model,
      system: BOUNDARY_VIDEO_SYSTEM,
      video: {
        videoId: video.video_id,
        start: Math.max(0, at - 20),
        end: Math.min(video.duration_seconds, at + 20),
      },
      user: `Video title: ${video.title}\nThe cut is at ${formatSeconds(at)} of the video, the middle of this clip.`,
      responseSchema: boundaryResponseSchema,
      schema: boundarySchema,
      onUsage: (u) => {
        tiebreakUsage = addUsage(tiebreakUsage, u);
      },
    });

  // 2. Boundary check on every cut between two teaching segments: does one explanation run
  //    across it? The segmentation is told never to cut inside a problem, but it can (Tutorllini
  //    lesson 9 split each regression problem into setup / perform / check, 2026-10-15). The
  //    check's verdict feeds mergeOnBoundary, so a split problem is rejoined up to the cap.
  const internal: number[] = [];
  for (let i = 0; i + 1 < segments.length; i += 1) {
    if (
      segments[i]?.teaches_sat_content &&
      segments[i + 1]?.teaches_sat_content
    )
      internal.push(i);
  }
  const checks = await pool(internal, VIDEO_CONCURRENCY, (i) =>
    spansCut(segments[i]?.end_seconds ?? 0),
  );
  const edgeVerdict = new Map<
    number,
    { explanation_spans_cut: boolean; reason: string }
  >();
  internal.forEach((i, k) => {
    const v = checks[k];
    if (v !== undefined) edgeVerdict.set(i, v);
  });
  const units = segments.map((s) => ({
    start: s.start_seconds,
    end: s.end_seconds,
    cues: [],
  }));
  const assessments: WindowAssessment[] = segments.map((s, i) => ({
    teaches_sat_content: s.teaches_sat_content,
    gate_reason: s.summary,
    starts_mid_explanation:
      edgeVerdict.get(i - 1)?.explanation_spans_cut ?? false,
    ends_mid_explanation: edgeVerdict.get(i)?.explanation_spans_cut ?? false,
  }));
  const groups = mergeOnBoundary(units, assessments);
  const lastUnit = segments.length - 1;

  // 3. Describe each group. A describe-stage "mid" flag on a cut already checked defers to the
  //    check; on an unchecked cut (next to a non-teaching span) the tie-break decides.
  const outcomes: GroupOutcome[] = await pool(
    groups,
    VIDEO_CONCURRENCY,
    async (g) => {
      const provenance = provenanceOf(video.video_id, g.start, g.end);
      const base = {
        start: g.start,
        end: g.end,
        windows: g.windows,
        provenance,
      };
      if (g.open_start || g.open_end) {
        return {
          ...base,
          outcome: "dropped" as const,
          drop_reason: `open boundary (${[g.open_start ? "starts" : "", g.open_end ? "ends" : ""].filter(Boolean).join(" and ")} mid-explanation after merge, cap ${SEGMENT_MAX_SECONDS} s)`,
          describe: null,
          tiebreak: [],
        };
      }
      if (g.end - g.start > SEGMENT_MAX_SECONDS) {
        return {
          ...base,
          outcome: "dropped" as const,
          drop_reason: `open boundary (over ${SEGMENT_MAX_SECONDS} s with no clean cut)`,
          describe: null,
          tiebreak: [],
        };
      }
      const first = g.windows[0] ?? 0;
      const last = g.windows[g.windows.length - 1] ?? 0;
      const atStart = first === 0;
      const atEnd = last === lastUnit;
      const d = await generateJson({
        step: `describe ${provenance}`,
        model,
        system: DESCRIBE_VIDEO_SYSTEM,
        video: { videoId: video.video_id, start: g.start, end: g.end },
        user: [
          `Video title: ${video.title}`,
          `This segment is ${formatSeconds(g.start)}–${formatSeconds(g.end)} ${span}.`,
          atStart ? "It is the start of the video." : "",
          atEnd ? "It is the end of the video." : "",
        ]
          .filter(Boolean)
          .join("\n"),
        responseSchema: describeResponseSchema,
        schema: describeSchema,
        onUsage: (u) => {
          describeUsage = addUsage(describeUsage, u);
        },
      });
      const tiebreak: GroupOutcome["tiebreak"] = [];
      let startOpen = false;
      let endOpen = false;
      if (d.starts_mid_explanation && !atStart && !edgeVerdict.has(first - 1)) {
        const t = await spansCut(g.start);
        tiebreak.push({ edge: "start", at: g.start, ...t });
        startOpen = t.explanation_spans_cut;
      }
      if (d.ends_mid_explanation && !atEnd && !edgeVerdict.has(last)) {
        const t = await spansCut(g.end);
        tiebreak.push({ edge: "end", at: g.end, ...t });
        endOpen = t.explanation_spans_cut;
      }
      const drop = dropReasonFor(d, startOpen, endOpen);
      return {
        ...base,
        outcome: drop === null ? ("kept" as const) : ("dropped" as const),
        drop_reason: drop,
        describe: d,
        tiebreak,
      };
    },
  );

  return {
    video_id: video.video_id,
    prompt_version: PROMPT_VERSION,
    model,
    source: "video",
    transcript_track: null,
    used_chapters: false,
    windows: segments.map((s, i) => {
      const assessment = assessments[i];
      if (assessment === undefined)
        throw new Error(`missing assessment ${video.video_id} #${i}`);
      return { start: s.start_seconds, end: s.end_seconds, assessment };
    }),
    edge_checks: [...edgeVerdict.entries()].map(([i, v]) => ({
      at: segments[i]?.end_seconds ?? 0,
      ...v,
    })),
    groups: outcomes,
    usage: {
      gate: gateUsage,
      describe: describeUsage,
      tiebreak: tiebreakUsage,
    },
  };
}

async function processFromTranscript(
  video: VideoMeta,
  model: string,
): Promise<VideoResult | null> {
  const transcript = readCachedTranscript(video.video_id);
  if (transcript === null) return null;
  const windows = cutWindows(transcript.cues, video.chapters);
  const texts = windows.map((w) => windowText(w.cues));
  const span = `of ${formatSeconds(video.duration_seconds)}`;
  let gateUsage: Usage = ZERO_USAGE;
  let describeUsage: Usage = ZERO_USAGE;

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
      onUsage: (u) => {
        gateUsage = addUsage(gateUsage, u);
      },
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
        tiebreak: [],
      };
    }
    const first = g.windows[0] ?? 0;
    const last = g.windows[g.windows.length - 1] ?? 0;
    const text = g.windows.map((i) => texts[i] ?? "").join(" ");
    const d = await generateJson({
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
      onUsage: (u) => {
        describeUsage = addUsage(describeUsage, u);
      },
    });
    let drop = dropReasonFor(
      d,
      d.starts_mid_explanation && first > 0,
      d.ends_mid_explanation && last < lastWindow,
    );
    if (
      drop === null &&
      d.description !== null &&
      sharesVerbatimRun(d.description, text)
    )
      drop = "description repeats the transcript (8-word run)";
    return {
      ...base,
      outcome: drop === null ? ("kept" as const) : ("dropped" as const),
      drop_reason: drop,
      describe: d,
      tiebreak: [],
    };
  });

  return {
    video_id: video.video_id,
    prompt_version: PROMPT_VERSION,
    model,
    source: "transcript",
    transcript_track: transcript.track,
    used_chapters: video.chapters.length > 0,
    windows: windows.map((w, i) => {
      const assessment = assessments[i];
      if (assessment === undefined)
        throw new Error(`missing assessment ${video.video_id} #${i}`);
      return { start: w.start, end: w.end, assessment };
    }),
    groups: outcomes,
    edge_checks: [],
    usage: { gate: gateUsage, describe: describeUsage, tiebreak: ZERO_USAGE },
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tier: { type: "string" },
      model: { type: "string", default: GENERATION_MODEL_DEFAULT },
      only: { type: "string" },
      source: { type: "string" },
    },
  });
  assertProxied();
  const tier = z.coerce.number().int().min(1).max(5).parse(values.tier);
  const model = z.string().min(1).parse(values.model);
  // Per tier, not global (Karl, 2026-10-15): video where the teaching is on screen,
  // captions where it is a person talking over text.
  const source = sourceSchema.parse(values.source);
  const dir = resolve(tierDir(tier), "videos");
  mkdirSync(dir, { recursive: true });
  const videos = loadTierVideos(tier).filter(
    (v) => values.only === undefined || v.video_id === values.only,
  );
  let done = 0;
  let resumed = 0;
  const skipped: string[] = [];
  for (const video of videos) {
    const out = resolve(dir, `${video.video_id}.json`);
    if (existsSync(out)) {
      const prior = videoResultSchema.safeParse(
        JSON.parse(readFileSync(out, "utf8")),
      );
      if (
        prior.success &&
        prior.data.prompt_version === PROMPT_VERSION &&
        prior.data.model === model &&
        prior.data.source === source
      ) {
        resumed += 1;
        continue;
      }
    }
    let result: VideoResult | null;
    try {
      result =
        source === "video"
          ? await processFromVideo(video, model)
          : await processFromTranscript(video, model);
    } catch (err: unknown) {
      // One video failing (a refused tiling, a Vertex error) is reported, not fatal.
      skipped.push(
        `${video.video_id} (${err instanceof Error ? err.message : String(err)})`,
      );
      continue;
    }
    if (result === null) {
      skipped.push(`${video.video_id} (no cached transcript)`);
      continue;
    }
    writeFileSync(out, JSON.stringify(result, null, 2));
    done += 1;
    const kept = result.groups.filter((g) => g.outcome === "kept").length;
    process.stdout.write(
      `${video.video_id}: ${result.windows.length} units, ${result.groups.length} teaching, ${kept} kept\n`,
    );
  }
  process.stdout.write(
    `tier ${tier} (${source}): ${done} processed, ${resumed} already done (prompt ${PROMPT_VERSION}), ${skipped.length} skipped${skipped.length > 0 ? `:\n  ${skipped.join("\n  ")}` : ""}\n`,
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
