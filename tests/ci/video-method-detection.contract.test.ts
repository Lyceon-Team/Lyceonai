/**
 * @spec [Doc-03D_V1.2 §6.7/§6.8 as amended by the video-method SCLs; owner brief "Video
 *       retrieval: method tags", Karl 2026-10-27 (detection: deterministic, no model call, a
 *       versioned keyword map in runtime config, no match → no preference)] | @implemented [2026-10-27]
 *
 * plain English: how a turn's requested method is found, against the REAL seed (the keyword map
 * the migration writes into tutor_context_runtime_config, parsed out of the migration file, so
 * the test reads what production reads).
 *  - The proof message ("is there a Desmos video for this?") and the student's real message
 *    ("can you show me how to do this on desmos") are desmos; "without desmos" is algebraic,
 *    because the longest matching phrase wins; nothing matches → no preference.
 *  - Deterministic: the same message gives the same method on every call and whatever the
 *    order of the phrases in the map; two methods tied on length → no preference.
 *  - One vocabulary: the SQL CHECKs, the SQL format order, the wire's inlined lists and the
 *    keyword map's methods are all exactly packages/shared/src/video-methods.ts.
 *  - `requestedVideoMethod`: no map in config → no preference, no version; a map → its version.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../server/services/tutor-config", () => ({
  TutorConfig: { get: vi.fn(() => config.value) },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  VIDEO_FORMATS,
  VIDEO_FORMAT_PRIORITY,
  VIDEO_METHODS,
  detectRequestedMethod,
  normaliseForMatch,
  videoMethodKeywordMapSchema,
  type VideoMethodKeywordMap,
} from "../../packages/shared/src/video-methods";
import {
  OFFERED_VIDEO_FORMATS,
  OFFERED_VIDEO_METHODS,
} from "../../shared/tutor-orchestrator-wire";
import { requestedVideoMethod } from "../../server/services/tutor-video-library";

const MIGRATION = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20261116000000_lisa_video_methods.sql",
  ),
  "utf8",
);
const SEED_JSON = /\$json\$([\s\S]*?)\$json\$/.exec(MIGRATION)?.[1] ?? "";
const SEED: VideoMethodKeywordMap = videoMethodKeywordMapSchema.parse(
  JSON.parse(SEED_JSON),
);

beforeEach(() => {
  config.value = null;
});

describe("the seeded keyword map", () => {
  it("parses, is versioned, and names exactly the vocabulary methods", () => {
    expect(SEED_JSON).not.toBe("");
    expect(SEED.version).toBe(1);
    expect(Object.keys(SEED.methods).sort()).toEqual([...VIDEO_METHODS].sort());
  });

  it("the proof message and the real student message ask for Desmos", () => {
    expect(
      detectRequestedMethod("is there a Desmos video for this?", SEED),
    ).toBe("desmos");
    expect(
      detectRequestedMethod("can you show me how to do this on desmos", SEED),
    ).toBe("desmos");
    expect(detectRequestedMethod("show me on DESMOS!!", SEED)).toBe("desmos");
  });

  it("the longest matching phrase wins: 'without desmos' is algebraic", () => {
    expect(
      detectRequestedMethod("how do I solve it without desmos?", SEED),
    ).toBe("algebraic");
    expect(
      detectRequestedMethod("can I do this without a calculator", SEED),
    ).toBe("algebraic");
    expect(
      detectRequestedMethod("should I just plug in the answer choices", SEED),
    ).toBe("backsolve");
  });

  it("no matching phrase → no preference; whole words only", () => {
    expect(detectRequestedMethod("can you explain this one?", SEED)).toBeNull();
    expect(detectRequestedMethod("", SEED)).toBeNull();
    expect(detectRequestedMethod("?!", SEED)).toBeNull();
    expect(detectRequestedMethod("is graphite a mineral", SEED)).toBeNull();
    expect(detectRequestedMethod("desmosaurus", SEED)).toBeNull();
  });
});

describe("detection is deterministic", () => {
  const messages = [
    "is there a Desmos video for this?",
    "how do I solve it without desmos?",
    "should I just plug in the answer choices",
    "can you explain this one?",
  ];

  it("the same message gives the same method on every call", () => {
    for (const m of messages) {
      const first = detectRequestedMethod(m, SEED);
      for (let i = 0; i < 50; i += 1) {
        expect(detectRequestedMethod(m, SEED)).toBe(first);
      }
    }
  });

  it("the order of the phrases in the map does not change the answer", () => {
    const reversed: VideoMethodKeywordMap = {
      version: SEED.version,
      methods: Object.fromEntries(
        Object.entries(SEED.methods)
          .reverse()
          .map(([k, v]) => [k, [...(v ?? [])].reverse()]),
      ),
    };
    for (const m of messages) {
      expect(detectRequestedMethod(m, reversed)).toBe(
        detectRequestedMethod(m, SEED),
      );
    }
  });

  it("two methods tied on phrase length → no preference", () => {
    const tie: VideoMethodKeywordMap = {
      version: 9,
      methods: { desmos: ["aa bb"], algebraic: ["cc dd"] },
    };
    expect(detectRequestedMethod("aa bb then cc dd", tie)).toBeNull();
    expect(detectRequestedMethod("aa bb", tie)).toBe("desmos");
  });

  it("normalisation: case, punctuation and spacing do not matter", () => {
    expect(normaliseForMatch("  Show me, on   DESMOS?! ")).toBe(
      " show me on desmos ",
    );
  });

  it("a map phrase that is not normalised is refused at parse", () => {
    expect(
      videoMethodKeywordMapSchema.safeParse({
        version: 1,
        methods: { desmos: ["Desmos"] },
      }).success,
    ).toBe(false);
    expect(
      videoMethodKeywordMapSchema.safeParse({
        version: 1,
        methods: { geometry: ["shapes"] },
      }).success,
    ).toBe(false);
  });
});

describe("one vocabulary, everywhere", () => {
  it("the SQL CHECKs on both tables list exactly VIDEO_METHODS", () => {
    const lists = [
      ...MIGRATION.matchAll(/methods <@ ARRAY\[([^\]]*)\]::text\[\]/g),
    ].map((m) =>
      (m[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, "")),
    );
    expect(lists).toHaveLength(2);
    for (const l of lists) expect(l).toEqual([...VIDEO_METHODS]);
  });

  it("the SQL format CHECK lists VIDEO_FORMATS; the ranking uses VIDEO_FORMAT_PRIORITY", () => {
    const check = /format IN \(([^)]*)\)/.exec(MIGRATION)?.[1] ?? "";
    expect(check.split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([
      ...VIDEO_FORMATS,
    ]);
    const order =
      /array_position\(ARRAY\[([^\]]*)\]::text\[\], v\.format\)/.exec(
        MIGRATION,
      )?.[1] ?? "";
    expect(order.split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([
      ...VIDEO_FORMAT_PRIORITY,
    ]);
    expect([...VIDEO_FORMAT_PRIORITY].sort()).toEqual(
      [...VIDEO_FORMATS].sort(),
    );
  });

  it("the wire's inlined lists are the vocabulary", () => {
    expect([...OFFERED_VIDEO_METHODS]).toEqual([...VIDEO_METHODS]);
    expect([...OFFERED_VIDEO_FORMATS]).toEqual([...VIDEO_FORMATS]);
  });
});

describe("requestedVideoMethod (the BFF's Step 13d detection)", () => {
  it("no map in config → no preference, no version", () => {
    config.value = null;
    expect(requestedVideoMethod("show me on desmos")).toEqual({
      method: null,
      mapVersion: null,
    });
  });

  it("with the seeded map → the method and the map's version", () => {
    config.value = SEED;
    expect(requestedVideoMethod("is there a Desmos video for this?")).toEqual({
      method: "desmos",
      mapVersion: 1,
    });
    expect(requestedVideoMethod("can you explain this one?")).toEqual({
      method: null,
      mapVersion: 1,
    });
  });
});
