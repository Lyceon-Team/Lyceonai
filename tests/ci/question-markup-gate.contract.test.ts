/**
 * The question markup gate over the seeded bank: green on the real tree, red on each defect it
 * exists to catch, and its baseline can only shrink.
 *
 * @spec [scripts/ci/question-markup-gate.ts; shared/question-markup.ts; live bug 2026-10-11]
 *       | @implemented [2026-10-11]
 *
 * plain English: every fixture is a real seeded row (or the real NDJSON it was assembled from),
 * edited in memory to carry one defect, so the gate is proved against the shapes the bank
 * actually holds rather than hand-written ones.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MISSING_TARGET_BASELINE,
  SEED_DIR,
  loadSeedQuestions,
  parseSeedQuestions,
  runGate,
  type SeedQuestion,
} from "../../scripts/ci/question-markup-gate";

const REAL = loadSeedQuestions();
const UNDERLINED = REAL.filter((q) => (q.passage ?? "").includes("<u>"));

function withEdit(
  id: string,
  edit: (q: SeedQuestion) => SeedQuestion,
): SeedQuestion[] {
  return REAL.map((q) => (q.id === id ? edit(q) : q));
}

describe("question-markup gate on the seeded bank", () => {
  it("reads the whole bank, including the 21 underlined items (presence)", () => {
    expect(REAL.length).toBeGreaterThan(6000);
    expect(UNDERLINED).toHaveLength(21);
    expect(MISSING_TARGET_BASELINE.size).toBeGreaterThan(0);
  });

  it("is green on the real tree", () => {
    expect(runGate(REAL)).toEqual({
      failures: [],
      baselined: MISSING_TARGET_BASELINE.size,
    });
  });

  it("goes red, naming the item, when an underlined item loses its <u>", () => {
    const victim = UNDERLINED[0]!;
    const { failures } = runGate(
      withEdit(victim.id, (q) => ({
        ...q,
        passage: (q.passage ?? "").replace("<u>", "").replace("</u>", ""),
      })),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(victim.id);
    expect(failures[0]).toContain("MISSING_UNDERLINED_TARGET");
  });

  it("goes red on a second <u> span in an underlined item's passage", () => {
    const victim = UNDERLINED[1]!;
    const { failures } = runGate(
      withEdit(victim.id, (q) => ({
        ...q,
        passage: `${q.passage ?? ""} <u>Extra.</u>`,
      })),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("has 2 paired <u>...</u> span(s)");
  });

  it("goes red on raw HTML in an option, the stem or the explanation", () => {
    const victim = UNDERLINED[2]!;
    for (const edit of [
      (q: SeedQuestion) => ({
        ...q,
        options: q.options.map((o, i) =>
          i === 0 ? { ...o, text: `${o.text}<br>` } : o,
        ),
      }),
      (q: SeedQuestion) => ({ ...q, stem: `${q.stem} <i>now</i>` }),
      (q: SeedQuestion) => ({
        ...q,
        explanation: `<script>x</script>${q.explanation}`,
      }),
    ]) {
      const { failures } = runGate(withEdit(victim.id, edit));
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain(victim.id);
      expect(failures[0]).toContain("RAW_HTML");
    }
  });

  it("baselines only missing targets: raw HTML in a baselined item still fails", () => {
    const id = [...MISSING_TARGET_BASELINE][0]!;
    const { failures } = runGate(
      withEdit(id, (q) => ({ ...q, stem: `${q.stem} <b>x</b>` })),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("RAW_HTML");
  });

  it("goes red when a baselined item is repaired but its baseline line stays", () => {
    const id = [...MISSING_TARGET_BASELINE][0]!;
    const { failures } = runGate(
      withEdit(id, (q) => ({ ...q, passage: `<u>${q.passage ?? ""}</u>` })),
    );
    expect(failures).toEqual([
      `${id}: in MISSING_TARGET_BASELINE but no longer missing its target — delete the line`,
    ]);
  });

  it("a new missing-target item outside the baseline fails", () => {
    const victim = REAL.find(
      (q) =>
        q.passage !== null &&
        !MISSING_TARGET_BASELINE.has(q.id) &&
        !q.passage.includes("<u>"),
    )!;
    const { failures } = runGate(
      withEdit(victim.id, () => ({
        ...victim,
        stem: "Which choice best describes the function of the underlined sentence in the text?",
      })),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(victim.id);
  });
});

describe("the seed reader round-trips what the assembly gate wrote", () => {
  it("reads batch_024's underlined item back exactly as its NDJSON source", () => {
    const source = readFileSync(
      resolve("content/canonical/batch_024_parts/craft_and_structure.ndjson"),
      "utf-8",
    )
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map(
        (l) =>
          JSON.parse(l) as {
            stem: string;
            passage: string;
            explanation: string;
          },
      )
      .find((r) => r.passage.includes("<u>"));
    expect(source).toBeDefined();
    const seeded = parseSeedQuestions(
      "proving_batch_024.sql",
      readFileSync(resolve(SEED_DIR, "proving_batch_024.sql"), "utf-8"),
    ).find((q) => q.passage === source!.passage);
    expect(seeded).toBeDefined();
    expect(seeded!.stem).toBe(source!.stem);
    expect(seeded!.explanation).toBe(source!.explanation);
    expect(seeded!.options).toHaveLength(4);
  });

  it("refuses a statement it cannot read instead of skipping it", () => {
    expect(() =>
      parseSeedQuestions(
        "broken.sql",
        "INSERT INTO questions (id, stem, passage, options, explanation) VALUES ('X', E'unterminated",
      ),
    ).toThrow(/unterminated string literal/);
  });
});
