/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 A, §D.6; closure plan R-8]
 *       | @implemented [2026-10-13]
 *
 * plain English: step A of the build-time ingestion pipeline. For every seed source in
 * `scripts/rag/sources.json` it lists the videos through the official YouTube Data API v3
 * (`youtube.googleapis.com`), then reads each video's title, channel, duration, publish date
 * and description, and parses chapter markers from the description. It writes the full
 * result to `scripts/rag/.cache/metadata.json` (gitignored) and prints a per-source report:
 * video count, available count, and chapter coverage.
 *
 * Nothing here fetches a transcript. The report comes first, because it answers R-8 and
 * decides whether each source segments by chapters or by fixed windows.
 *
 * trade-offs: results go to a local file, not the `video_resources` table. That table's
 * migration is still owed (R-3), and production writes are owner-run. A later step loads
 * this file once the table exists.
 *
 * edge cases: a playlist item that is deleted or private appears in `playlistItems` but not in
 * `videos.list`; it is counted as unavailable, not dropped silently.
 *
 * credentials: the session's egress proxy attaches the YouTube credential to requests for
 * `youtube.googleapis.com`. The script never reads a key from the environment and never
 * puts one in a URL. So it must run with Node's fetch routed through the proxy
 * (`NODE_USE_ENV_PROXY=1`); without that, the guard stops before any request is sent. A
 * proxy that can't attach the credential answers 502 "injection failed", and the script
 * reports that as a credential problem rather than a YouTube one.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/fetch-video-metadata.ts [--tier N]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  type Chapter,
  type SeedSource,
  loadSeedSources,
  parseChapters,
  parseIsoDuration,
} from "./sources";

const API = "https://youtube.googleapis.com/youtube/v3";
const OUT_PATH = resolve(import.meta.dirname, ".cache", "metadata.json");

// Credentials are attached by the egress proxy; all this checks is that fetch goes through it.
const proxyEnvSchema = z.object({
  HTTPS_PROXY: z.string().min(1),
  NODE_USE_ENV_PROXY: z.literal("1"),
});

const playlistItemsPageSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(
    z.object({ contentDetails: z.object({ videoId: z.string() }) }),
  ),
});

const videosPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        title: z.string(),
        channelTitle: z.string(),
        publishedAt: z.string(),
        description: z.string(),
      }),
      contentDetails: z.object({ duration: z.string() }),
      status: z.object({
        privacyStatus: z.string(),
        embeddable: z.boolean().optional(),
      }),
    }),
  ),
});

export type VideoMetadata = {
  video_id: string;
  title: string;
  channel_name: string;
  duration_seconds: number;
  published_at: string;
  embeddable: boolean;
  chapters: Chapter[];
};

export type SourceReport = {
  source: SeedSource;
  listed: number;
  available: number;
  with_chapters: number;
  videos: VideoMetadata[];
  unavailable_ids: string[];
};

async function getJson(
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 502 && body.startsWith("injection failed")) {
      throw new Error(
        `egress proxy could not attach the YouTube credential (502 ${body.trim()})`,
      );
    }
    // Names the endpoint and status only; the body is not echoed.
    throw new Error(`YouTube Data API ${path} returned ${response.status}`);
  }
  return response.json();
}

async function listPlaylistVideoIds(playlistId: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = playlistItemsPageSchema.parse(
      await getJson("playlistItems", {
        part: "contentDetails",
        playlistId,
        maxResults: "50",
        ...(pageToken ? { pageToken } : {}),
      }),
    );
    ids.push(...page.items.map((item) => item.contentDetails.videoId));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return ids;
}

async function fetchVideos(ids: string[]): Promise<VideoMetadata[]> {
  const out: VideoMetadata[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const page = videosPageSchema.parse(
      await getJson("videos", {
        part: "snippet,contentDetails,status",
        id: batch.join(","),
        maxResults: "50",
      }),
    );
    for (const item of page.items) {
      if (item.status.privacyStatus === "private") continue;
      const duration = parseIsoDuration(item.contentDetails.duration);
      if (duration === null) {
        throw new Error(
          `unparseable duration for ${item.id}: ${item.contentDetails.duration}`,
        );
      }
      out.push({
        video_id: item.id,
        title: item.snippet.title,
        channel_name: item.snippet.channelTitle,
        duration_seconds: duration,
        published_at: item.snippet.publishedAt,
        embeddable: item.status.embeddable ?? false,
        chapters: parseChapters(item.snippet.description, duration),
      });
    }
  }
  return out;
}

export async function reportSource(source: SeedSource): Promise<SourceReport> {
  const ids =
    source.source_kind === "playlist"
      ? await listPlaylistVideoIds(source.id)
      : [source.id];
  const videos = await fetchVideos(ids);
  const found = new Set(videos.map((v) => v.video_id));
  return {
    source,
    listed: ids.length,
    available: videos.length,
    with_chapters: videos.filter((v) => v.chapters.length > 0).length,
    videos,
    unavailable_ids: ids.filter((id) => !found.has(id)),
  };
}

function formatReport(reports: SourceReport[]): string {
  const rows = reports.map((r) => {
    const pct =
      r.available === 0 ? 0 : Math.round((100 * r.with_chapters) / r.available);
    return `| ${r.source.tier} | ${r.source.label} | ${r.listed} | ${r.available} | ${r.with_chapters} (${pct}%) |`;
  });
  return [
    "| Tier | Source | Listed | Available | With chapters |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { tier: { type: "string" } } });
  if (!proxyEnvSchema.safeParse(process.env).success) {
    process.stderr.write(
      "fetch is not routed through the egress proxy (set NODE_USE_ENV_PROXY=1); no request was sent.\n",
    );
    process.exit(1);
  }
  const tier = values.tier === undefined ? null : Number(values.tier);
  const sources = loadSeedSources().filter(
    (s) => tier === null || s.tier === tier,
  );

  const reports: SourceReport[] = [];
  for (const source of sources) {
    reports.push(await reportSource(source));
  }

  mkdirSync(resolve(OUT_PATH, ".."), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(reports, null, 2));
  process.stdout.write(`${formatReport(reports)}\n\nWritten: ${OUT_PATH}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
