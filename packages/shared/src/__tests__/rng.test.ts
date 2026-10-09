import { describe, it, expect } from "vitest";
import { createRng, seededShuffle, deriveSelectionSeed } from "../rng.js";

describe("createRng", () => {
  it("same seed produces an identical sequence", () => {
    const a = createRng("seed-1");
    const b = createRng("seed-1");
    const seqA = Array.from({ length: 25 }, () => a());
    const seqB = Array.from({ length: 25 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = createRng("seed-1");
    const b = createRng("seed-2");
    const seqA = Array.from({ length: 25 }, () => a());
    const seqB = Array.from({ length: 25 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("numeric and string seeds both produce values in [0, 1)", () => {
    const r = createRng(12345);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("seededShuffle", () => {
  const items = Array.from({ length: 50 }, (_, i) => i);

  it("same seed → identical permutation", () => {
    expect(seededShuffle(items, "s")).toEqual(seededShuffle(items, "s"));
  });

  it("output is a permutation of the input (same multiset)", () => {
    const out = seededShuffle(items, "s");
    expect(out.length).toBe(items.length);
    expect([...out].sort((x, y) => x - y)).toEqual(items);
  });

  it("does not mutate the input array", () => {
    const copy = items.slice();
    seededShuffle(items, "s");
    expect(items).toEqual(copy);
  });

  it("different seed → different order", () => {
    expect(seededShuffle(items, "s1")).not.toEqual(seededShuffle(items, "s2"));
  });

  it("is process-stable: independent invocations match (no Date/global state)", () => {
    expect(seededShuffle(items, "abc")).toEqual(seededShuffle(items, "abc"));
  });

  it("handles empty and single-element arrays", () => {
    expect(seededShuffle([], "s")).toEqual([]);
    expect(seededShuffle([7], "s")).toEqual([7]);
  });
});

describe("deriveSelectionSeed (Doc 02B §684)", () => {
  const base = { profileId: "p1", filterHash: "f1", sessionId: "s1" };

  it("identical parts → identical seed", () => {
    expect(deriveSelectionSeed(base)).toBe(deriveSelectionSeed({ ...base }));
  });

  it("changing any one of profile_id / filter_hash / session_id changes the seed", () => {
    const s0 = deriveSelectionSeed(base);
    expect(deriveSelectionSeed({ ...base, profileId: "p2" })).not.toBe(s0);
    expect(deriveSelectionSeed({ ...base, filterHash: "f2" })).not.toBe(s0);
    expect(deriveSelectionSeed({ ...base, sessionId: "s2" })).not.toBe(s0);
  });

  it("changing any one input changes the resulting order", () => {
    const pool = Array.from({ length: 40 }, (_, i) => i);
    const order0 = seededShuffle(pool, deriveSelectionSeed(base));
    expect(seededShuffle(pool, deriveSelectionSeed({ ...base, profileId: "pX" }))).not.toEqual(order0);
    expect(seededShuffle(pool, deriveSelectionSeed({ ...base, filterHash: "fX" }))).not.toEqual(order0);
    expect(seededShuffle(pool, deriveSelectionSeed({ ...base, sessionId: "sX" }))).not.toEqual(order0);
  });
});
