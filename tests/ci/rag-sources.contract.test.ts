/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 A; LISA_Video_RAG_Seed_Sources.md §1, §9]
 *       | @implemented [2026-10-13]
 *
 * plain English: the seed list parses, is playlist- or video-level only, keeps Tier 5 strict,
 * and has no duplicates; the duration and chapter parsers follow the Data API's format and
 * YouTube's own chapter rules.
 */
import { describe, expect, it } from "vitest";
import {
  loadSeedSources,
  parseChapters,
  parseIsoDuration,
  seedSourcesSchema,
} from "../../scripts/rag/sources";

describe("scripts/rag/sources.json", () => {
  const sources = loadSeedSources();

  it("parses and is non-trivial", () => {
    expect(sources.length).toBeGreaterThanOrEqual(12);
    expect(sources.filter((s) => s.tier === 1).map((s) => s.id)).toEqual([
      "PLf3ypEs9Kobgascv5bwpOadB0UiVI5IQS",
    ]);
  });

  it("has no channel-level source", () => {
    for (const s of sources)
      expect(["playlist", "video"]).toContain(s.source_kind);
    const channel = {
      ...sources[0],
      source_kind: "channel",
      id: "UCabcdefghijklmnopqrstuv",
    };
    expect(seedSourcesSchema.safeParse([channel]).success).toBe(false);
  });

  it("keeps every tier 5 source strict, and rejects a standard one", () => {
    const tier5 = sources.filter((s) => s.tier === 5);
    // 6, plus Penguin SAT Prep (7 entries) and Dr. TestPrep (6) from the 2026-10-27 expansion.
    expect(tier5.length).toBe(19);
    for (const s of tier5) expect(s.review_level).toBe("strict");
    const loosened = tier5.map((s) => ({ ...s, review_level: "standard" }));
    expect(seedSourcesSchema.safeParse(loosened).success).toBe(false);
  });

  it("rejects a duplicate id", () => {
    expect(seedSourcesSchema.safeParse([sources[0], sources[0]]).success).toBe(
      false,
    );
  });
});

describe("parseIsoDuration", () => {
  it.each([
    ["PT45S", 45],
    ["PT9M3S", 543],
    ["PT1H2M3S", 3723],
    ["P1DT1S", 86401],
  ])("%s → %d", (iso, seconds) => {
    expect(parseIsoDuration(iso)).toBe(seconds);
  });

  it("rejects malformed input", () => {
    expect(parseIsoDuration("PT")).toBeNull();
    expect(parseIsoDuration("12:00")).toBeNull();
  });
});

describe("parseChapters (YouTube's rules)", () => {
  const valid =
    "Intro text\n0:00 Intro\n1:05 Systems of equations\n4:30 - Practice\n";

  it("parses a valid chapter list, closing the last at the duration", () => {
    expect(parseChapters(valid, 600)).toEqual([
      { title: "Intro", start_seconds: 0, end_seconds: 65 },
      { title: "Systems of equations", start_seconds: 65, end_seconds: 270 },
      { title: "Practice", start_seconds: 270, end_seconds: 600 },
    ]);
  });

  it("handles h:mm:ss", () => {
    const long = "0:00 A\n30:00 B\n1:02:03 C";
    expect(parseChapters(long, 4000).map((c) => c.start_seconds)).toEqual([
      0, 1800, 3723,
    ]);
  });

  it.each([
    ["first timestamp not 0:00", "0:05 A\n1:00 B\n2:00 C"],
    ["fewer than three", "0:00 A\n1:00 B"],
    ["a chapter under 10s", "0:00 A\n0:05 B\n2:00 C"],
    ["not ascending", "0:00 A\n2:00 B\n1:00 C"],
  ])("returns [] when %s", (_why, description) => {
    expect(parseChapters(description, 600)).toEqual([]);
  });
});
