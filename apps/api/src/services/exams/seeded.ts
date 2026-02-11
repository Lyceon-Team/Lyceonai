// apps/api/src/services/exams/seeded.ts
import * as crypto from 'node:crypto';

export function hashToUint32(seed: string): number {
  const h = crypto.createHash('sha256').update(seed).digest();
  // Use first 4 bytes as uint32
  return (h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!;
}

export function stableSeededShuffle<T>(items: readonly T[], seed: string): T[] {
  // Fisher-Yates with deterministic PRNG from seed
  const out = items.slice() as T[];
  let x = hashToUint32(seed) >>> 0;

  // xorshift32
  const rand = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Deterministic rotation offset in [-1, 0, +1] based on seed + tag.
 */
export function seedOffset3(seed: string, tag: string): number {
  const u = hashToUint32(`${seed}:${tag}`) >>> 0;
  const r = u % 3; // 0,1,2
  return r === 0 ? -1 : r === 1 ? 0 : 1;
}
