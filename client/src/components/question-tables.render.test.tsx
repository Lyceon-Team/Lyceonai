// @vitest-environment jsdom
/**
 * A markdown table in a question renders as a real table, everywhere — and nothing else changes.
 *
 * @spec [owner brief 2026-11-04, approach A ("Detect GFM table blocks … build a real <table> …
 *        Implement it once in shared code so both MathRenderer and StaticMath use it"); proof
 *        required: "a CRLF table stem with $…$ cells renders a <table> with no raw | text, and
 *        … a non-table stem's output is unchanged"] | @implemented [2026-11-04]
 *
 * plain English: the fixtures are the REAL seeded questions, read by `loadSeedQuestions()` —
 * the same reader the question-markup CI gate and the underline tests use, not a second parser
 * written for this file. Every seeded question whose stem or passage holds a table is rendered
 * through `MathRenderer` (practice, diagnostic, Review, both signed-in QOTD surfaces and the
 * exam stem) and `StaticMath` (the prerendered public pages), at CRLF, because every published
 * table row carries CRLF (owner's production read, 2026-11-04) while the seed is LF.
 *
 * THE CONTROL HALF IS THE POINT, and it is why this file renders questions WITHOUT tables too.
 * A suite that only proved tables become tables would pass just as happily for a change that
 * turned the whole bank into markdown. The controls assert no table appears and the text comes
 * through character for character.
 */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MathRenderer } from "./MathRenderer";
import { StaticMath } from "./qotd/StaticMath";
import { hasTableBlock } from "@shared/question-tables";
import { tokenizeMathContent } from "@shared/math/tokenize";
import { loadSeedQuestions } from "../../../scripts/ci/question-markup-gate";

type Fixture = { id: string; field: "stem" | "passage"; text: string };

const SEEDED = loadSeedQuestions();

/** Every seeded question with a table, in the field that holds it. */
const WITH_TABLES: Fixture[] = SEEDED.flatMap((q) => {
  const out: Fixture[] = [];
  if (hasTableBlock(q.stem)) out.push({ id: q.id, field: "stem", text: q.stem });
  if (q.passage !== null && hasTableBlock(q.passage)) {
    out.push({ id: q.id, field: "passage", text: q.passage });
  }
  return out;
});

/** Controls: real stems with no table at all. */
const WITHOUT_TABLES: Fixture[] = SEEDED.filter(
  (q) => !hasTableBlock(q.stem) && q.stem.length > 40,
)
  .slice(0, 15)
  .map((q) => ({ id: q.id, field: "stem" as const, text: q.stem }));

/** As the published rows are stored. */
const crlf = (s: string): string => s.replace(/\r?\n/g, "\r\n");

it("the corpus is the one the owner counted", () => {
  // 23 published questions hold a table (owner, 2026-11-04). If the seed stops agreeing, the
  // fixtures below are quietly covering something else and should say so here first.
  expect(WITH_TABLES.length).toBe(23);
  expect(WITHOUT_TABLES.length).toBeGreaterThanOrEqual(10);
});

describe("MathRenderer — a CRLF table renders as a <table>", () => {
  for (const fixture of WITH_TABLES) {
    it(`${fixture.id} (${fixture.field})`, async () => {
      const { container } = render(
        <MathRenderer content={crlf(fixture.text)} />,
      );
      const table = await waitFor(() => {
        const t = container.querySelector("table");
        if (t === null) throw new Error("no <table> yet");
        return t;
      });

      // A real table, with a header row and a body.
      expect(table.querySelectorAll("thead th").length).toBeGreaterThan(0);
      expect(table.querySelectorAll("tbody tr").length).toBeGreaterThan(0);

      // Where the content HAS math, the cells carry it typeset rather than as source. Seven of
      // the 23 are two-way frequency tables of plain counts with no `$` at all, so this is
      // conditional on the fixture — an unconditional assertion would have been failing on the
      // content rather than on the renderer.
      if (fixture.text.includes("$")) {
        expect(container.querySelectorAll(".katex").length).toBeGreaterThan(0);
      }
      // Presence before absence: the table has cells, so the missing `|` below is missing from
      // something that rendered.
      expect(table.querySelectorAll("td").length).toBeGreaterThan(0);

      // And no raw markdown is left anywhere in the rendered text — the student's complaint.
      expect(container.textContent ?? "").not.toContain("|");
      expect(container.textContent ?? "").not.toMatch(/\|-{2,}/);
      // No carriage return survives into the rendered text either.
      expect(container.textContent ?? "").not.toContain("\r");
    });
  }
});

describe("StaticMath (prerendered) — the same content, the same table", () => {
  for (const fixture of WITH_TABLES) {
    it(`${fixture.id} (${fixture.field})`, () => {
      const { container } = render(
        <StaticMath content={crlf(fixture.text)} />,
      );
      const table = container.querySelector("table");
      expect(table).not.toBeNull();
      expect(table!.querySelectorAll("thead th").length).toBeGreaterThan(0);
      expect(table!.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
      if (fixture.text.includes("$")) {
        expect(container.querySelectorAll(".katex").length).toBeGreaterThan(0);
      }
      expect(table!.querySelectorAll("td").length).toBeGreaterThan(0);
      expect(container.textContent ?? "").not.toContain("|");
      expect(container.textContent ?? "").not.toContain("\r");
    });
  }
});

describe("LF and CRLF render the same table", () => {
  for (const fixture of WITH_TABLES.slice(0, 5)) {
    it(`${fixture.id}: the line ending does not change the cells`, () => {
      const lf = render(
        <StaticMath content={fixture.text.replace(/\r\n/g, "\n")} />,
      ).container;
      const cr = render(<StaticMath content={crlf(fixture.text)} />).container;
      const cells = (el: HTMLElement): string[] =>
        [...el.querySelectorAll("th,td")].map((c) => c.textContent ?? "");
      expect(cells(cr)).toEqual(cells(lf));
      expect(cells(cr).length).toBeGreaterThan(0);
    });
  }
});

describe("a stem with no table is untouched", () => {
  for (const fixture of WITHOUT_TABLES) {
    it(`${fixture.id}: no table, and the text comes through`, async () => {
      const { container } = render(<MathRenderer content={fixture.text} />);
      await waitFor(() =>
        expect(container.querySelector("[data-testid='math-content']")).not.toBeNull(),
      );
      expect(container.querySelector("table")).toBeNull();
      expect(container.querySelector(".question-table-wrap")).toBeNull();

      // Character for character, over the runs the RENDERER itself calls text: the same
      // tokenizer it uses, rather than a regex written here that would disagree with it about
      // where a `$` ends (KaTeX also emits its MathML annotation into `textContent`, so the
      // math runs cannot be compared this way and are not).
      const plainRuns = tokenizeMathContent(fixture.text)
        .filter((t) => t.type === "text")
        .map((t) => t.content.trim())
        .filter((t) => t.length > 12);
      expect(plainRuns.length).toBeGreaterThan(0);
      const rendered = container.textContent ?? "";
      for (const run of plainRuns) expect(rendered).toContain(run);
    });
  }
});
