/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §10 (link rot: a scheduled
 *       YouTube Data API check marks unavailable videos; the Cloud Scheduler pattern)]
 *       | @implemented [2026-10-15]
 *
 * plain English: once a day, every row in `video_resources` is checked against the YouTube
 * Data API (`videos.list`, part=status,contentDetails, 50 ids a call, 1 quota unit each). A
 * video that is gone, private, not fully processed, not embeddable, or blocked in the US is
 * marked `unavailable` — retrieval already filters on `status = 'available'`, so it stops
 * being offered on the next turn. A video that comes back is marked `available` again. Every
 * checked row gets `last_checked_at`.
 *
 * trade-offs and edge cases:
 *  - Fail safe, never mass-unavailable: any API error (non-200, bad body) aborts the run
 *    before anything is written. And a run in which more than half of at least
 *    LINK_CHECK_MIN_ROWS_FOR_BREAKER videos come back unavailable writes nothing and errors
 *    instead: that shape is a key/quota/API fault far more often than a real mass takedown,
 *    and one bad run would otherwise empty the library.
 *  - The key travels in the `X-goog-api-key` header, never in the URL, so no request log
 *    carries it. No video content is logged; ids and counts only.
 *  - Approval is untouched: an unavailable video keeps its review, and returns to the
 *    student only when it is playable again.
 */
import { z } from "zod";

export const YOUTUBE_VIDEOS_ENDPOINT =
  "https://youtube.googleapis.com/youtube/v3/videos";
export const LINK_CHECK_BATCH = 50;
export const LINK_CHECK_MIN_ROWS_FOR_BREAKER = 10;

const videosListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        status: z
          .object({
            uploadStatus: z.string().optional(),
            privacyStatus: z.string().optional(),
            embeddable: z.boolean().optional(),
          })
          .optional(),
        contentDetails: z
          .object({
            regionRestriction: z
              .object({
                allowed: z.array(z.string()).optional(),
                blocked: z.array(z.string()).optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});
export type VideosListItem = z.infer<typeof videosListSchema>["items"][number];

/** Pure. Why a returned video cannot be played in our embed, or null when it can. */
export function unavailableReason(item: VideosListItem): string | null {
  if (item.status?.privacyStatus === "private") return "private";
  if (item.status?.uploadStatus !== "processed") return "not_processed";
  if (item.status?.embeddable === false) return "not_embeddable";
  const region = item.contentDetails?.regionRestriction;
  if (region?.blocked?.includes("US")) return "region_blocked";
  if (region?.allowed !== undefined && !region.allowed.includes("US"))
    return "region_blocked";
  return null;
}

export type LinkCheckResult = { available: string[]; unavailable: string[] };

/** Pure. Every checked id lands in exactly one list; an id the API did not return is gone. */
export function classifyVideos(
  ids: readonly string[],
  items: readonly VideosListItem[],
): LinkCheckResult {
  const byId = new Map(items.map((i) => [i.id, i]));
  const available: string[] = [];
  const unavailable: string[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item === undefined || unavailableReason(item) !== null)
      unavailable.push(id);
    else available.push(id);
  }
  return { available, unavailable };
}

export type LinkCheckDeps = {
  listVideoIds: () => Promise<string[]>;
  fetchVideos: (ids: readonly string[]) => Promise<VideosListItem[]>;
  markChecked: (result: LinkCheckResult) => Promise<void>;
};

export type LinkCheckOutcome =
  | ({ kind: "written"; checked: number } & LinkCheckResult)
  | ({ kind: "breaker_tripped"; checked: number } & LinkCheckResult);

/** Checks every row, then writes once — or not at all (see the breaker above). */
export async function runVideoLinkCheck(
  deps: LinkCheckDeps,
): Promise<LinkCheckOutcome> {
  const ids = await deps.listVideoIds();
  const items: VideosListItem[] = [];
  for (let i = 0; i < ids.length; i += LINK_CHECK_BATCH) {
    items.push(...(await deps.fetchVideos(ids.slice(i, i + LINK_CHECK_BATCH))));
  }
  const result = classifyVideos(ids, items);
  if (
    ids.length >= LINK_CHECK_MIN_ROWS_FOR_BREAKER &&
    result.unavailable.length * 2 > ids.length
  ) {
    return { kind: "breaker_tripped", checked: ids.length, ...result };
  }
  await deps.markChecked(result);
  return { kind: "written", checked: ids.length, ...result };
}

/** The real `videos.list` call. Throws on any non-200 or malformed body. */
export function youtubeFetcher(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): LinkCheckDeps["fetchVideos"] {
  return async (ids) => {
    const params = new URLSearchParams({
      part: "status,contentDetails",
      id: ids.join(","),
      maxResults: String(LINK_CHECK_BATCH),
    });
    const res = await fetchImpl(`${YOUTUBE_VIDEOS_ENDPOINT}?${params}`, {
      headers: { "X-goog-api-key": apiKey, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`youtube videos.list returned ${res.status}`);
    return videosListSchema.parse(await res.json()).items;
  };
}
