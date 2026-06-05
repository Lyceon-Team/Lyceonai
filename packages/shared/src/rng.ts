/**
 * @spec [Coding Standards, §4.1 Determinism] + [Doc 02B §684 seeded Fisher-Yates] | @implemented 2026-06-05
 * plain English: Deterministic seeded RNG + Fisher-Yates shuffle. Question
 * selection must be reproducible from its inputs — never `Math.random()`. The
 * canonical selection seed is derived from `profile_id + filter_hash + session_id`
 * (Doc 02B §684), so the same student/filter/session always yields the same order,
 * and changing any of the three changes it. Pure functions: no Date, no global
 * state, identical across processes and runs. The determinism wave consumes this.
 * trade-offs: 32-bit FNV-1a hash + mulberry32 PRNG — not cryptographic; selection
 * variety/unpredictability is not a security property here, reproducibility is.
 * edge cases: empty/one-element arrays return a copy unchanged.
 */

// FNV-1a string hash → unsigned 32-bit seed.
function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32: deterministic uint32 seed → infinite [0, 1) sequence.
 * Same seed always produces the same sequence.
 */
export function createRng(seed: number | string): () => number {
  let a = (typeof seed === "string" ? hashString(seed) : seed) >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher-Yates shuffle. Returns a new array (does not mutate input).
 * Same `seed` → identical permutation; different `seed` → (almost surely) different.
 */
export function seededShuffle<T>(items: readonly T[], seed: number | string): T[] {
  const out = items.slice();
  const rng = createRng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export type SelectionSeedParts = {
  profileId: string;
  filterHash: string;
  sessionId: string;
};

/**
 * Canonical selection seed (Doc 02B §684): stable string from the three inputs.
 * Changing any one of them produces a different seed → different ordering.
 */
export function deriveSelectionSeed(parts: SelectionSeedParts): string {
  return `${parts.profileId}::${parts.filterHash}::${parts.sessionId}`;
}
