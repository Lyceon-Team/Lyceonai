/**
 * CUBES_OFFSPEC detector — the Digital SAT does not test factoring a sum or
 * difference of cubes (a^3 ± b^3).
 *
 * @spec [docs/questions_governance.md §A.5 "No sum/difference-of-cubes factoring"]
 * | @implemented [2026-10-29]
 * | plain English: returns the matched text when a Math record factors (or
 *   divides out) a^3 ± b^3, else null. Three arms, any one fires:
 *   1. the stem holds a cube binomial standing alone — a whole $…$ span or a
 *      \frac numerator/denominator — whose coefficient and constant are both
 *      perfect cubes (8x^3 + 27, x^3 - 8, 125p^3 - 64q^3, 27x^6 - 8);
 *   2. the stem or explanation names the identity ("sum of cubes",
 *      "difference of two cubes");
 *   3. the stem, an option or the explanation holds the identity's quadratic
 *      factor (A v^2 ± B v + C) with B^2 = A·C — the a^2 ∓ ab + b^2 factor.
 *   Trade-off: tuned so the 1,618-item official CB OCR corpus produces zero
 *   hits (tested); like terms (12x^3 - 5x^3), a cubed term inside a longer
 *   polynomial (x^3 + 3x^2 - 6x - 1) and a non-cube constant (x^3 + 9) do not
 *   fire. Owner ruling 2026-10-29 (Karl): off-spec; 15 items retired, CL.0231
 *   dropped, gate added — mirrors COMPOSITION_OFFSPEC.
 */

const PERFECT_CUBES = new Set([1, 8, 27, 64, 125, 216, 343, 512, 729, 1000]);

const WHOLE_BINOMIAL =
  /^\s*(\d*)\s*([a-z])\^\{?(?:3|6|9)\}?\s*[+-]\s*(\d*)\s*(?:([a-z])\^\{?(?:3|6|9)\}?)?\s*$/;

const FRAC =
  /\\frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

const MATH_SPAN = /\$([^$]+)\$/g;

const IDENTITY_WORDS =
  /\b(?:sum|difference)\s+of\s+(?:two\s+)?(?:perfect\s+)?cubes\b/i;

const CUBE_TRINOMIAL =
  /\(\s*(\d*)\s*([a-z])\^\{?2\}?\s*[+-]\s*(\d*)\s*\2\s*([a-z])?\s*\+\s*(\d*)\s*(?:([a-z])\^\{?2\}?)?\s*\)/g;

function isCubeBinomial(s: string): boolean {
  const m = WHOLE_BINOMIAL.exec(s);
  if (m === null) return false;
  const [, a, v, c, w] = m;
  if (w === undefined && (c === undefined || c === "")) return false;
  if (w !== undefined && w === v) return false; // like terms, e.g. 12x^3 - 5x^3
  const coef = Number(a === undefined || a === "" ? "1" : a);
  const constant = Number(c === undefined || c === "" ? "1" : c);
  return PERFECT_CUBES.has(coef) && PERFECT_CUBES.has(constant);
}

function standaloneCubeBinomial(stem: string): string | null {
  for (const m of stem.matchAll(FRAC)) {
    for (const part of [m[1], m[2]]) {
      if (part !== undefined && isCubeBinomial(part)) return part.trim();
    }
  }
  for (const m of stem.matchAll(MATH_SPAN)) {
    const inner = m[1];
    if (inner !== undefined && isCubeBinomial(inner)) return inner.trim();
  }
  return null;
}

function cubeTrinomialFactor(text: string): string | null {
  for (const m of text.matchAll(CUBE_TRINOMIAL)) {
    const [whole, a, , b, w1, c, w2] = m;
    if ((w1 ?? null) !== (w2 ?? null)) continue;
    if (w1 === undefined && (c === undefined || c === "")) continue;
    const A = Number(a === undefined || a === "" ? "1" : a);
    const B = Number(b === undefined || b === "" ? "1" : b);
    const C = Number(c === undefined || c === "" ? "1" : c);
    if (B * B === A * C) return whole;
  }
  return null;
}

export type OffspecFields = {
  stem: string;
  explanation: string | null;
  options: readonly string[];
};

/** The matched text when the record factors a^3 ± b^3, else null. */
export function cubeFactoringMatch(rec: OffspecFields): string | null {
  const binomial = standaloneCubeBinomial(rec.stem);
  if (binomial !== null) return binomial;
  for (const t of [rec.stem, rec.explanation ?? ""]) {
    const words = IDENTITY_WORDS.exec(t);
    if (words !== null) return words[0];
  }
  for (const t of [rec.stem, rec.explanation ?? "", ...rec.options]) {
    const factor = cubeTrinomialFactor(t);
    if (factor !== null) return factor;
  }
  return null;
}
