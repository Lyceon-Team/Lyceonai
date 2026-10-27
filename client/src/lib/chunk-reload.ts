/**
 * Chunk-load failures: reload once, never loop.
 *
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 1: 'on "Failed to
 *        fetch dynamically imported module" (or any lazy-route load failure), reload once
 *        automatically (guard against loops); the error screen renders inside the app shell with
 *        rail/tabs'; Coding Standards §13 (no silent catch), §12 (nothing sensitive logged)]
 *        | @implemented [2026-10-13]
 *
 * plain English: every page is a lazy chunk. After a deploy, a tab opened on the old build asks
 * for chunk files that no longer exist, and the import rejects ("Failed to fetch dynamically
 * imported module"). A reload fetches the new index.html and the new chunk names, which fixes it;
 * a second failure means something else is wrong, and reloading again would loop. So:
 *
 *   - `isChunkLoadError` recognises the failure by the messages browsers and Vite actually throw
 *     (Chromium, Firefox, Safari, Vite's CSS preload) or the conventional `ChunkLoadError` name.
 *   - `claimChunkReload` decides, and records the decision BEFORE the reload happens, in
 *     sessionStorage (per tab, survives the reload): a reload is allowed only when this chunk has
 *     not been reloaded for in the last ten minutes AND no chunk at all was reloaded for in the
 *     last thirty seconds (the second rule stops two failing chunks from alternating into a
 *     loop). Anything else shows the error screen with a manual "Reload page".
 *
 * Fail safe: storage can throw (private windows, blocked site data) or silently not keep a write.
 * Without a record that survives the reload nothing can prove the next load is not a loop, so the
 * answer is then "show the error screen", never "reload". The record is read back after writing to
 * catch a storage that accepts a write and keeps nothing.
 *
 * trade-offs: a student who meets a second, unrelated stale chunk within ten minutes of the first
 * sees the error screen (one press of Reload) instead of a silent reload. Ten minutes is far longer
 * than any reload takes, and far shorter than the gap between two deploys a tab could straddle.
 *
 * edge cases: the key is the failing chunk's URL when the message names one, else the message
 * itself (trimmed); no user data is in either. Nothing is logged: the client has no structured
 * logger, and the error screen is the surfaced failure.
 */
import { z } from "zod";

export const CHUNK_RELOAD_STORAGE_KEY = "lyceon:chunk-reload";
/** One automatic reload per failing chunk per this window. */
export const CHUNK_RELOAD_WINDOW_MS = 10 * 60 * 1000;
/** No automatic reload at all within this long of the last one, for any chunk. */
export const CHUNK_RELOAD_COOLDOWN_MS = 30 * 1000;

/** What each engine throws when a dynamic import or its preload fails. */
const CHUNK_ERROR_PATTERNS: readonly RegExp[] = [
  // Chromium
  /Failed to fetch dynamically imported module/i,
  // Firefox
  /error loading dynamically imported module/i,
  // Safari / WebKit
  /Importing a module script failed/i,
  // Vite's CSS preload for a lazy chunk
  /Unable to preload CSS/i,
  // webpack-style naming, kept so a future bundler change is still caught
  /Loading (?:CSS )?chunk [\w-]+ failed/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ChunkLoadError") return true;
  return CHUNK_ERROR_PATTERNS.some((p) => p.test(error.message));
}

/** The failing chunk's URL when the message names one, else the trimmed message. */
export function chunkKeyOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const url = /(https?:\/\/\S+|\/assets\/\S+)/.exec(message)?.[1];
  return (url ?? message).slice(0, 300);
}

const recordSchema = z.object({
  /** chunk key → epoch ms of the automatic reload made for it. */
  entries: z.record(z.string(), z.number()),
  /** epoch ms of the most recent automatic reload, for any chunk. */
  last: z.number(),
});
type ReloadRecord = z.infer<typeof recordSchema>;

export type ChunkReloadDecision =
  | { kind: "reload" }
  | { kind: "show"; reason: "already_reloaded" | "storage_unavailable" };

export type ChunkReloadStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): ChunkReloadStorage | null {
  // Reading `window.sessionStorage` itself throws where site data is blocked.
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Not silent: no storage means `claimChunkReload` answers "show", and the error screen is
    // the surfaced failure. A DOMException is not an `Error` in every realm, so nothing is
    // narrowed here: whatever the access threw, there is no storage to guard with.
    return null;
  }
}

function readRecord(storage: ChunkReloadStorage): ReloadRecord | null {
  const raw = storage.getItem(CHUNK_RELOAD_STORAGE_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // A value we did not write (or a truncated one) is no record at all.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const result = recordSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * Decide whether this failure may reload the page, and record it if so. Call once per failure,
 * immediately before reloading; never reload on a `show`.
 */
export function claimChunkReload(
  key: string,
  now: number,
  storage: ChunkReloadStorage | null = defaultStorage(),
): ChunkReloadDecision {
  if (storage === null) return { kind: "show", reason: "storage_unavailable" };
  try {
    const record = readRecord(storage);
    if (record !== null) {
      const sameChunk = record.entries[key];
      if (sameChunk !== undefined && now - sameChunk < CHUNK_RELOAD_WINDOW_MS)
        return { kind: "show", reason: "already_reloaded" };
      if (now - record.last < CHUNK_RELOAD_COOLDOWN_MS)
        return { kind: "show", reason: "already_reloaded" };
    }
    // Keep only entries still inside the window, so the record stays small.
    const kept: Record<string, number> = {};
    for (const [k, at] of Object.entries(record?.entries ?? {}))
      if (now - at < CHUNK_RELOAD_WINDOW_MS) kept[k] = at;
    kept[key] = now;
    const next = JSON.stringify({ entries: kept, last: now });
    storage.setItem(CHUNK_RELOAD_STORAGE_KEY, next);
    // A storage that accepted the write but kept nothing cannot guard the next load.
    if (storage.getItem(CHUNK_RELOAD_STORAGE_KEY) !== next)
      return { kind: "show", reason: "storage_unavailable" };
    return { kind: "reload" };
  } catch {
    // getItem/setItem throw (a DOMException, not an `Error` in every realm) in private windows
    // and when quota or site data is blocked. Not silent: the answer is the error screen.
    return { kind: "show", reason: "storage_unavailable" };
  }
}
