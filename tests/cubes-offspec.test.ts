/**
 * @spec [docs/questions_governance.md §A.5 "No sum/difference-of-cubes factoring"]
 * | @implemented [2026-10-29]
 *
 * plain English: CUBES_OFFSPEC is proved on real data in both directions —
 * zero hits across the official CB OCR corpus (the evidence that the pattern
 * is off-spec), and a hit on every authored cube-factoring record in
 * content/canonical. Each detector arm is also shown to fire on its own.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cubeFactoringMatch } from "../scripts/cubes-offspec";

const ROOT = resolve(import.meta.dirname, "..");

type AuthoredRecord = {
  section?: string;
  stem?: string;
  explanation?: string;
  options?: Array<{ text?: string }>;
};

function fields(r: AuthoredRecord): Parameters<typeof cubeFactoringMatch>[0] {
  return {
    stem: r.stem ?? "",
    explanation: r.explanation ?? null,
    options: (r.options ?? []).map((o) => o.text ?? ""),
  };
}

function readNdjson<T>(path: string): T[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

describe("CUBES_OFFSPEC detector", () => {
  it("never fires on the official CB OCR corpus", () => {
    const dir = join(ROOT, "content", "official-corpus");
    const rows = readdirSync(dir)
      .filter((f) => f.endsWith(".ndjson"))
      .flatMap((f) =>
        readNdjson<{ official_id: string; ocr_text: string }>(join(dir, f)),
      );
    // Presence before absence: the corpus is the full official bank, not a stub.
    expect(rows.length).toBeGreaterThan(1000);
    const hits = rows
      .map((r) => ({
        id: r.official_id,
        m: cubeFactoringMatch({
          stem: r.ocr_text,
          explanation: null,
          options: [],
        }),
      }))
      .filter((h) => h.m !== null);
    expect(hits).toEqual([]);
  });

  // Authored records that factor a^3 ± b^3, each named by its batch file and a
  // stem fragment; the record itself is read from the file, not hand-written.
  const AUTHORED_CUBE_ITEMS: Array<[string, string]> = [
    ["batch_014_parts/advanced_math.ndjson", "x^3 - 8"],
    ["batch_026_parts/advanced_math.ndjson", "8x^3 + 27"],
    ["batch_029_parts/advanced_math.ndjson", "125p^3 - 64q^3"],
    ["batch_030_parts/advanced_math.ndjson", "8x^3 - 27"],
    ["batch_033_parts/advanced_math.ndjson", "27x^3 + 125"],
    ["batch_036_parts/advanced_math.ndjson", "a^3 + b^3"],
    ["batch_042_parts/advanced_math.ndjson", "27x^3 + 125"],
    ["batch_049_parts/advanced_math.ndjson", "8x^3 - 27"],
    ["batch_063_parts/advanced_math.ndjson", "8x^3 + 27"],
    ["batch_069_parts/advanced_math.ndjson", "27x^6 - 8"],
  ];

  for (const [file, fragment] of AUTHORED_CUBE_ITEMS) {
    it(`fires on the authored cube item in ${file} ("${fragment}")`, () => {
      const rec = readNdjson<AuthoredRecord>(
        join(ROOT, "content", "canonical", file),
      ).find((r) => (r.stem ?? "").includes(fragment));
      expect(rec, `${file} has no stem containing ${fragment}`).toBeDefined();
      expect(cubeFactoringMatch(fields(rec ?? {}))).not.toBeNull();
    });
  }

  it("arm 1: a standalone cube binomial in the stem fires on its own", () => {
    expect(
      cubeFactoringMatch({
        stem: "Which expression is equivalent to $\\frac{64x^3 - 1}{4x - 1}$?",
        explanation: "Divide.",
        options: [],
      }),
    ).toBe("64x^3 - 1");
    expect(
      cubeFactoringMatch({
        stem: "Which expression is equivalent to $x^3 + 27y^3$?",
        explanation: "Factor.",
        options: [],
      }),
    ).toBe("x^3 + 27y^3");
  });

  it("arm 2: naming the identity fires on its own", () => {
    expect(
      cubeFactoringMatch({
        stem: "Which expression is equivalent to $p - q$?",
        explanation: "Apply the difference of two cubes identity.",
        options: [],
      }),
    ).toBe("difference of two cubes");
  });

  it("arm 3: the a^2 ∓ ab + b^2 factor in an option fires on its own", () => {
    expect(
      cubeFactoringMatch({
        stem: "Which expression is equivalent to the given expression?",
        explanation: "Expand and compare.",
        options: ["$(2x + 3)(4x^2 - 6x + 9)$", "$x$"],
      }),
    ).toBe("(4x^2 - 6x + 9)");
  });

  it("does not fire on like terms, longer polynomials, non-cube constants or ordinary quadratic factors", () => {
    for (const stem of [
      "Which expression is equivalent to $12x^3 - 5x^3$?",
      "Which expression is equivalent to $(8x^3 + 8) - (x^3 - 2)$?",
      "The function $f$ is defined by $f(x) = x^3 + 9$. What is $f(2)$?",
      "The function $f$ is defined by $f(x) = x^3 + 3x^2 - 6x - 1$.",
      "Which expression is equivalent to $\\frac{x^2 + 6x - 7}{x + 7}$?",
    ]) {
      expect(
        cubeFactoringMatch({ stem, explanation: null, options: [] }),
        stem,
      ).toBeNull();
    }
    // A perfect-square trinomial factor (B^2 = 4AC) is not the cube factor (B^2 = AC).
    expect(
      cubeFactoringMatch({
        stem: "Which is equivalent?",
        explanation: null,
        options: ["$(x^2 + 4x + 4)$"],
      }),
    ).toBeNull();
  });
});
