/**
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 1 ("reload once
 *        automatically (guard against loops)")] | @implemented [2026-10-13]
 *
 * plain English: the loop guard on its own. Which errors count as a chunk-load failure (the
 * messages Chromium, Firefox, Safari and Vite really throw, and nothing else), and when a reload
 * is allowed: once per chunk per ten minutes, never twice within thirty seconds for any chunk,
 * and never when storage cannot keep the record that guards the next load.
 */
import { describe, expect, it } from "vitest";
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  CHUNK_RELOAD_STORAGE_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  chunkKeyOf,
  claimChunkReload,
  isChunkLoadError,
  type ChunkReloadStorage,
} from "./chunk-reload";

function memoryStorage(): ChunkReloadStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

const CHROME = new TypeError(
  "Failed to fetch dynamically imported module: https://lyceon.ai/assets/practice-3f9a1c.js",
);
const T0 = 1_760_000_000_000;

describe("isChunkLoadError", () => {
  it("recognises each engine's chunk failure", () => {
    expect(isChunkLoadError(CHROME)).toBe(true);
    expect(
      isChunkLoadError(
        new TypeError("error loading dynamically imported module"),
      ),
    ).toBe(true);
    expect(
      isChunkLoadError(new TypeError("Importing a module script failed.")),
    ).toBe(true);
    expect(
      isChunkLoadError(
        new Error("Unable to preload CSS for /assets/practice-3f9a1c.css"),
      ),
    ).toBe(true);
    const named = new Error("x");
    named.name = "ChunkLoadError";
    expect(isChunkLoadError(named)).toBe(true);
  });

  it("leaves every other error alone", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of null"))).toBe(
      false,
    );
    expect(
      isChunkLoadError("Failed to fetch dynamically imported module"),
    ).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("keys a failure by the chunk URL it names", () => {
    expect(chunkKeyOf(CHROME)).toBe(
      "https://lyceon.ai/assets/practice-3f9a1c.js",
    );
    expect(chunkKeyOf(new TypeError("Importing a module script failed."))).toBe(
      "Importing a module script failed.",
    );
  });
});

describe("claimChunkReload", () => {
  it("allows the first reload and records it before it happens", () => {
    const storage = memoryStorage();
    expect(claimChunkReload("a.js", T0, storage)).toEqual({ kind: "reload" });
    const raw = storage.data.get(CHUNK_RELOAD_STORAGE_KEY);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw ?? "{}")).toEqual({
      entries: { "a.js": T0 },
      last: T0,
    });
  });

  it("never reloads twice for the same chunk inside the window (no loop)", () => {
    const storage = memoryStorage();
    expect(claimChunkReload("a.js", T0, storage).kind).toBe("reload");
    expect(claimChunkReload("a.js", T0 + 5_000, storage)).toEqual({
      kind: "show",
      reason: "already_reloaded",
    });
    expect(
      claimChunkReload("a.js", T0 + CHUNK_RELOAD_WINDOW_MS - 1, storage).kind,
    ).toBe("show");
  });

  it("allows the same chunk again once the window has passed", () => {
    const storage = memoryStorage();
    claimChunkReload("a.js", T0, storage);
    expect(
      claimChunkReload("a.js", T0 + CHUNK_RELOAD_WINDOW_MS, storage).kind,
    ).toBe("reload");
  });

  it("stops two failing chunks from alternating into a loop", () => {
    const storage = memoryStorage();
    expect(claimChunkReload("a.js", T0, storage).kind).toBe("reload");
    // b fails straight after the reload a caused: refused.
    expect(claimChunkReload("b.js", T0 + 2_000, storage).kind).toBe("show");
    // Long after, a different chunk may reload once.
    expect(
      claimChunkReload("b.js", T0 + CHUNK_RELOAD_COOLDOWN_MS, storage).kind,
    ).toBe("reload");
  });

  it("shows the error screen when storage throws on read or write", () => {
    const throwsOnRead: ChunkReloadStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => undefined,
    };
    expect(claimChunkReload("a.js", T0, throwsOnRead)).toEqual({
      kind: "show",
      reason: "storage_unavailable",
    });
    const throwsOnWrite: ChunkReloadStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(claimChunkReload("a.js", T0, throwsOnWrite).kind).toBe("show");
  });

  it("shows the error screen when storage keeps nothing, or there is none", () => {
    const keepsNothing: ChunkReloadStorage = {
      getItem: () => null,
      setItem: () => undefined,
    };
    expect(claimChunkReload("a.js", T0, keepsNothing)).toEqual({
      kind: "show",
      reason: "storage_unavailable",
    });
    expect(claimChunkReload("a.js", T0, null).kind).toBe("show");
  });

  it("treats a record it did not write as no record", () => {
    const storage = memoryStorage();
    storage.data.set(CHUNK_RELOAD_STORAGE_KEY, "{not json");
    expect(claimChunkReload("a.js", T0, storage).kind).toBe("reload");
  });
});
