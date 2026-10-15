/**
 * @spec [Doc-02B_v4 §14 (resumable sessions), §28 (Desmos); register G-NEW-14; owner brief
 *       2026-10-12 ("skip the save if the state is identical to the last one saved (compare a
 *       hash)"; server: "if the saved state is identical, return early and don't write")]
 *       | @implemented [2026-10-12]
 *
 * plain English: THE one fingerprint of a calculator state, used by the client (skip a save
 * whose state matches the last one saved) and by both calculator-state routes (skip the write
 * when the posted state matches the stored one). The state is serialized canonically — object
 * keys sorted at every depth — because the server stores it as jsonb, which does not keep key
 * order, so a byte comparison of what was sent against what comes back would never match. The
 * canonical text is then hashed (cyrb53, 53 bits, twice with different seeds) so callers keep a
 * short string, not a copy of the whole state.
 * Trade-offs: a non-cryptographic hash. A collision would skip one save of a state that differs
 * from the stored one; at 106 bits over one student's calculator states that is not a practical
 * risk, and the next change saves again. `undefined` inside objects is dropped and inside arrays
 * becomes null, exactly as JSON does.
 */

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const text = JSON.stringify(value);
    return text === undefined ? "null" : text;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    .join(",")}}`;
}

function cyrb53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The fingerprint of a calculator state; equal states (in any key order) hash equal. */
export function calculatorStateHash(state: unknown): string {
  const text = canonicalJson(state ?? null);
  return `${cyrb53(text, 0)}.${cyrb53(text, 0x9e3779b9)}.${text.length}`;
}
