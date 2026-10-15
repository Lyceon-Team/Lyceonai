/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 A; LISA_Video_RAG_Seed_Sources.md §1, §9]
 *       | @implemented [2026-10-13]
 *
 * plain English: the seed-source list for video ingestion, and the pure helpers the metadata
 * step uses. Sources are playlist-level or single-video, never channel-level: a channel's
 * uploads are mostly not SAT content (Seed Sources §1), so channel ingestion would flood the
 * content gate. The schema has no "channel" source kind, so one can't be added by accident.
 *
 * edge cases: chapter parsing follows YouTube's own rules for when a description's timestamps
 * become chapters: the first timestamp is 0:00, there are at least three, they ascend, and
 * each chapter runs at least 10 seconds. A description that breaks any rule yields no
 * chapters, matching what YouTube itself shows. Fixed windows are then used for that video.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const PLAYLIST_ID = /^PL[A-Za-z0-9_-]{16,32}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const seedSourceSchema = z
  .discriminatedUnion("source_kind", [
    z.object({
      source_kind: z.literal("playlist"),
      id: z.string().regex(PLAYLIST_ID),
      tier: z.number().int().min(1).max(5),
      label: z.string().min(1),
      channel: z.string().min(1),
      review_level: z.enum(["standard", "strict"]),
    }),
    z.object({
      source_kind: z.literal("video"),
      id: z.string().regex(VIDEO_ID),
      tier: z.number().int().min(1).max(5),
      label: z.string().min(1),
      channel: z.string().min(1),
      review_level: z.enum(["standard", "strict"]),
    }),
  ])
  .superRefine((source, ctx) => {
    // Seed Sources §9: Tier 5 (independent, unvetted creators) is reviewed strictly.
    if (source.tier === 5 && source.review_level !== "strict") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tier 5 sources must have review_level "strict"',
      });
    }
  });

export const seedSourcesSchema = z
  .array(seedSourceSchema)
  .min(1)
  .superRefine((sources, ctx) => {
    const seen = new Set<string>();
    for (const source of sources) {
      if (seen.has(source.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate source id ${source.id}`,
        });
      }
      seen.add(source.id);
    }
  });

export type SeedSource = z.infer<typeof seedSourceSchema>;

export const SOURCES_PATH = resolve(import.meta.dirname, "sources.json");

export function loadSeedSources(path: string = SOURCES_PATH): SeedSource[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  return seedSourcesSchema.parse(raw);
}

/** ISO 8601 duration as the Data API returns it (`PT1H2M3S`, `P1DT2H`) → seconds. */
export function parseIsoDuration(iso: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    iso,
  );
  if (!match || iso === "P" || iso === "PT") return null;
  const [, d, h, m, s] = match;
  return (
    Number(d ?? 0) * 86_400 +
    Number(h ?? 0) * 3_600 +
    Number(m ?? 0) * 60 +
    Number(s ?? 0)
  );
}

export type Chapter = {
  title: string;
  start_seconds: number;
  end_seconds: number;
};

const TIMESTAMP_LINE =
  /^\s*(?:[-•*]\s*)?\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:|]?\s*(.+?)\s*$/;

function timestampToSeconds(stamp: string): number {
  return stamp
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

/**
 * Chapters from a video description, by YouTube's rules: first at 0:00, at least three,
 * strictly ascending, each at least 10 seconds long. Anything else → [].
 */
export function parseChapters(
  description: string,
  durationSeconds: number,
): Chapter[] {
  const marks: Array<{ title: string; start: number }> = [];
  for (const line of description.split(/\r?\n/)) {
    const match = TIMESTAMP_LINE.exec(line);
    if (!match) continue;
    const [, stamp, title] = match;
    if (stamp === undefined || title === undefined) continue;
    marks.push({ title, start: timestampToSeconds(stamp) });
  }
  if (marks.length < 3 || marks[0]?.start !== 0) return [];

  const chapters: Chapter[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const current = marks[i];
    if (current === undefined) return [];
    const end = marks[i + 1]?.start ?? durationSeconds;
    if (end - current.start < 10) return [];
    chapters.push({
      title: current.title,
      start_seconds: current.start,
      end_seconds: end,
    });
  }
  return chapters;
}
