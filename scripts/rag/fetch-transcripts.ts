/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 B; closure plan R-4 (ruled 2026-10-13: go — read
 *       once at build time, deleted after the descriptions are generated)] | @implemented [2026-10-15]
 *
 * plain English: step B of the build-time pipeline. For each available video of the chosen
 * tier (from `scripts/rag/.cache/metadata.json`, written by fetch-video-metadata.ts), read the
 * video's caption track once and cache it as timed cues in
 * `scripts/rag/.cache/transcripts/<video_id>.json`. A video already cached is not fetched
 * again. A video with no English track is skipped and listed: no partial entries.
 *
 * The cache is working material: gitignored, never uploaded, never imported. Step C reads it,
 * the verbatim check runs against it, and `--purge` deletes it.
 *
 * Track choice: a creator-uploaded English track over YouTube's automatic one (`kind: "asr"`),
 * because hand-made captions are more accurate on mathematical terms.
 *
 * NOT YET RUN AGAINST LIVE YOUTUBE: this session's network policy denies www.youtube.com
 * (proxy 403 on CONNECT, 2026-10-15). The parsing below is unit-tested on the documented
 * player-response and json3 shapes; the fetch itself is unverified until the host is allowed.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/fetch-transcripts.ts --tier 1
 *        pnpm exec tsx scripts/rag/fetch-transcripts.ts --purge
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { type TranscriptCue, transcriptCueSchema } from "./segments";

export const CACHE_DIR = resolve(import.meta.dirname, ".cache");
export const TRANSCRIPT_DIR = resolve(CACHE_DIR, "transcripts");

const captionTrackSchema = z.object({
  baseUrl: z.string().url(),
  languageCode: z.string(),
  kind: z.string().optional(),
});
export type CaptionTrack = z.infer<typeof captionTrackSchema>;

const playerResponseSchema = z.object({
  captions: z
    .object({
      playerCaptionsTracklistRenderer: z.object({
        captionTracks: z.array(captionTrackSchema).optional(),
      }),
    })
    .optional(),
});

/** The caption tracks listed in a watch page's `ytInitialPlayerResponse`. */
export function captionTracksFromWatchPage(html: string): CaptionTrack[] {
  const marker = "ytInitialPlayerResponse = ";
  const at = html.indexOf(marker);
  if (at === -1) return [];
  // The object is followed by ";" then a closing script tag or the next var.
  const start = at + marker.length;
  const end = html.indexOf(";</script>", start);
  const raw = html.slice(start, end === -1 ? undefined : end);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error("watch page: ytInitialPlayerResponse is not JSON", {
      cause: err,
    });
  }
  const parsed = playerResponseSchema.safeParse(json);
  if (!parsed.success) return [];
  return (
    parsed.data.captions?.playerCaptionsTracklistRenderer.captionTracks ?? []
  );
}

/** Creator-made English first, then automatic English; null when neither exists. */
export function chooseTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const english = tracks.filter(
    (t) => t.languageCode === "en" || t.languageCode.startsWith("en-"),
  );
  return (
    english.find((t) => t.kind !== "asr") ??
    english.find((t) => t.kind === "asr") ??
    null
  );
}

const json3Schema = z.object({
  events: z.array(
    z.object({
      tStartMs: z.number().optional(),
      dDurationMs: z.number().optional(),
      segs: z.array(z.object({ utf8: z.string() })).optional(),
    }),
  ),
});

/** json3 caption events → cues in seconds; empty and newline-only events are dropped. */
export function cuesFromJson3(raw: unknown): TranscriptCue[] {
  const parsed = json3Schema.parse(raw);
  const out: TranscriptCue[] = [];
  for (const e of parsed.events) {
    if (e.tStartMs === undefined || e.segs === undefined) continue;
    const text = e.segs
      .map((s) => s.utf8)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length === 0) continue;
    const start = e.tStartMs / 1000;
    out.push({ start, end: start + (e.dDurationMs ?? 0) / 1000, text });
  }
  return out.sort((a, b) => a.start - b.start);
}

const cachedTranscriptSchema = z.object({
  video_id: z.string(),
  track: z.enum(["manual", "asr"]),
  cues: z.array(transcriptCueSchema),
});
export type CachedTranscript = z.infer<typeof cachedTranscriptSchema>;

export function readCachedTranscript(videoId: string): CachedTranscript | null {
  const p = resolve(TRANSCRIPT_DIR, `${videoId}.json`);
  if (!existsSync(p)) return null;
  return cachedTranscriptSchema.parse(JSON.parse(readFileSync(p, "utf8")));
}

async function fetchTranscript(
  videoId: string,
): Promise<CachedTranscript | null> {
  const page = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: { "accept-language": "en-US,en;q=0.9" },
  });
  if (!page.ok) throw new Error(`watch page ${videoId}: ${page.status}`);
  const track = chooseTrack(captionTracksFromWatchPage(await page.text()));
  if (track === null) return null;
  const url = new URL(track.baseUrl);
  url.searchParams.set("fmt", "json3");
  const captions = await fetch(url);
  if (!captions.ok) throw new Error(`captions ${videoId}: ${captions.status}`);
  const cues = cuesFromJson3(await captions.json());
  if (cues.length === 0) return null;
  return {
    video_id: videoId,
    track: track.kind === "asr" ? "asr" : "manual",
    cues,
  };
}

const metadataSchema = z.array(
  z.object({
    source: z.object({ tier: z.number() }),
    videos: z.array(z.object({ video_id: z.string() })),
  }),
);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tier: { type: "string" },
      purge: { type: "boolean", default: false },
    },
  });
  if (values.purge === true) {
    rmSync(TRANSCRIPT_DIR, { recursive: true, force: true });
    process.stdout.write(`deleted ${TRANSCRIPT_DIR}\n`);
    return;
  }
  if (process.env.NODE_USE_ENV_PROXY !== "1") {
    process.stderr.write(
      "run with NODE_USE_ENV_PROXY=1; no request was sent.\n",
    );
    process.exit(1);
  }
  const tier = z.coerce.number().int().min(1).max(5).parse(values.tier);
  const metadata = metadataSchema.parse(
    JSON.parse(readFileSync(resolve(CACHE_DIR, "metadata.json"), "utf8")),
  );
  const ids = metadata
    .filter((r) => r.source.tier === tier)
    .flatMap((r) => r.videos.map((v) => v.video_id));
  mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  const skipped: string[] = [];
  let fetched = 0;
  let cached = 0;
  for (const id of ids) {
    if (readCachedTranscript(id) !== null) {
      cached += 1;
      continue;
    }
    const t = await fetchTranscript(id);
    if (t === null) {
      skipped.push(id);
      continue;
    }
    writeFileSync(resolve(TRANSCRIPT_DIR, `${id}.json`), JSON.stringify(t));
    fetched += 1;
    await new Promise((r) => setTimeout(r, 1_500)); // rate limit: one video every 1.5 s
  }
  process.stdout.write(
    `tier ${tier}: ${ids.length} videos, ${fetched} fetched, ${cached} already cached, ${skipped.length} skipped (no English track)${skipped.length > 0 ? `: ${skipped.join(", ")}` : ""}\n`,
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
