/**
 * @spec [CC Brief "Book Ingestion into the Knowledge Base" (Karl, 2026-10-22) §2.1, §2.2, §3, §5,
 *       §6.5 (re-ingest is idempotent on provenance), §7 (a chunk that starts mid-rule and
 *       teaches half of it)] | @implemented [2026-10-22]
 *
 * plain English: the pure half of the book pipeline (scripts/rag/book.ts).
 *  - Furniture: running heads, feet and page numbers go; teaching lines that merely start a page
 *    stay.
 *  - Boundaries: a unit's end is the LAST occurrence of its end phrase before the next unit
 *    (the regression from the first real run: an example sentence restated in its fix cut the
 *    comma-splice rule short and left its four fixes uncovered); uncovered text between units
 *    rejects the window; a unit is never cut at a window edge.
 *  - Chapters: an unnumbered window inherits the chapter before it; printed and ordinal numbers
 *    never mix (the first run filed Chapter 1's comma splices under chapter 2).
 *  - Provenance: deterministic, unique, and in the brief's book:<slug>:<chapter>:<section> form.
 *  - The review CSV: round-trips; only yes rows come back; anything off-taxonomy fails the file.
 */
import { describe, expect, it } from "vitest";
import {
  BOOK_PROVENANCE_RE,
  BOOK_REVIEW_HEADER,
  BookText,
  type LocatedUnit,
  type ProposedUnit,
  assignProvenance,
  locateQuote,
  locateUnits,
  nextCursor,
  parseBookReviewCsv,
  resolveChapters,
  sha256,
  splitPages,
  stripFurniture,
  toReviewCsv,
  unassignedGaps,
} from "../../scripts/rag/book";
import { auditFailure } from "../../scripts/rag/book-prompts";
import { loadTaxonomy } from "../../scripts/rag/tag-videos";

const SKILLS = new Set(loadTaxonomy().skills);

function unit(over: Partial<ProposedUnit>): ProposedUnit {
  return {
    chapter_number: 1,
    chapter_title: "Joining Clauses",
    section_title: "Comma Splices",
    kind: "rule",
    start_quote: "",
    end_quote: "",
    ends_in_window: true,
    ...over,
  };
}

// The comma-splice text of the first test book, as pdftotext gave it.
const SPLICE =
  'Comma Splices\nA comma splice is two independent clauses joined by only a comma. "The tide rose quickly, the boats drifted toward the pier" is a comma splice. A comma alone is never strong enough to join two complete sentences.\nThere are four standard fixes. First, replace the comma with a period. Second, replace the comma with a semicolon. Third, keep the comma and add a coordinating conjunction: "The tide rose quickly, and the boats drifted toward the pier." Fourth, make one clause dependent: "As the tide rose quickly, the boats drifted toward the pier."\nWorked example. Sentence: "Marie Curie won two Nobel Prizes, she remains the only person honored in two different sciences." Step 1: test the part before the comma.';

describe("extract", () => {
  it("splits pdftotext pages on form feeds", () => {
    expect(splitPages("a\fb\f")).toEqual(["a", "b"]);
  });

  it("removes running heads, feet and page numbers, keeps teaching", () => {
    const body = [
      "A semicolon joins two independent clauses.",
      "Rule 2: a colon must follow an independent clause.",
      "Example 3: the collection of stamps is kept in a vault.",
      "A comma alone never joins two complete sentences.",
    ];
    const pages = body.map(
      (line, i) =>
        `SAT Grammar Field Guide\n${line}\nIts explanation, page ${i + 1}, continues here.\n${i + 1}`,
    );
    const out = stripFurniture(pages);
    out.forEach((p, i) => {
      expect(p).toBe(
        `${body[i]}\nIts explanation, page ${i + 1}, continues here.`,
      );
    });
  });

  it("knows the page of every offset and marks page starts", () => {
    const b = new BookText(["one two", "three four"]);
    expect(b.pageAt(0)).toBe(1);
    expect(b.pageAt(b.text.indexOf("three"))).toBe(2);
    expect(b.marked(0, b.text.length)).toContain("[page 2]\nthree");
  });
});

describe("boundaries", () => {
  it("matches quotes across punctuation, case and line breaks", () => {
    const text = "Alpha—beta: “The museum\nopened in 1902,” she said.";
    const m = locateQuote(text, 'the museum opened in 1902" she');
    expect(m).not.toBeNull();
    expect(text.slice(m?.start, m?.end)).toBe(
      "The museum\nopened in 1902,” she",
    );
    expect(locateQuote(text, "beta")).toBeNull(); // too short to place a boundary
  });

  it("an end phrase that recurs inside the unit ends the unit at its LAST occurrence", () => {
    const b = new BookText([SPLICE]);
    const [rule, example] = locateUnits(b, 0, b.text.length, [
      unit({
        start_quote: "Comma Splices A comma splice is two independent clauses",
        end_quote: "rose quickly, the boats drifted toward the pier.",
      }),
      unit({
        kind: "worked_example",
        start_quote: "Worked example. Sentence: Marie Curie won two",
        end_quote: "Step 1: test the part before the comma.",
      }),
    ]);
    const ruleText = b.text.slice(rule?.start, rule?.end);
    expect(ruleText).toContain("Fourth, make one clause dependent");
    expect(
      ruleText.endsWith('drifted toward the pier."') ||
        ruleText.endsWith("drifted toward the pier"),
    ).toBe(true);
    expect(example?.start).toBeGreaterThanOrEqual(rule?.end ?? 0);
  });

  it("text no unit covers rejects the window", () => {
    const b = new BookText([SPLICE]);
    expect(() =>
      locateUnits(b, 0, b.text.length, [
        unit({
          start_quote:
            "Comma Splices A comma splice is two independent clauses",
          end_quote: "never strong enough to join two complete sentences.",
        }),
        unit({
          kind: "worked_example",
          start_quote: "Worked example. Sentence: Marie Curie won two",
          end_quote: "Step 1: test the part before the comma.",
        }),
      ]),
    ).toThrow(/belong to no unit/);
  });

  it("a quote not in the window throws", () => {
    const b = new BookText([SPLICE]);
    expect(() =>
      locateUnits(b, 0, b.text.length, [
        unit({
          start_quote: "a sentence that is not in the book at all",
          end_quote: "x",
        }),
      ]),
    ).toThrow(/start_quote not found/);
  });

  const located = (start: number, end: number, ends: boolean): LocatedUnit => ({
    ...unit({ ends_in_window: ends }),
    start,
    end,
  });

  it("an unfinished unit is re-read whole by the next window", () => {
    const step = nextCursor(
      [
        located(0, 100, true),
        located(100, 200, true),
        located(200, 300, false),
      ],
      300,
      1_000,
    );
    expect(step.keep.map((u) => u.start)).toEqual([0, 100]);
    expect(step.cursor).toBe(200);
    expect(step.grow).toBe(false);
  });

  it("no finished unit widens the window instead of cutting the idea", () => {
    expect(nextCursor([located(50, 300, false)], 300, 1_000)).toEqual({
      keep: [],
      cursor: 50,
      grow: true,
    });
  });

  it("at the end of the book every unit is kept", () => {
    const step = nextCursor([located(0, 100, false)], 1_000, 1_000);
    expect(step.keep).toHaveLength(1);
    expect(step.cursor).toBe(1_000);
  });

  it("uncovered stretches of the whole book are reported", () => {
    const text = `${"word ".repeat(40)}${"kept ".repeat(10)}`;
    expect(unassignedGaps(text, [{ start: 200, end: text.length }])).toEqual([
      { start: 0, end: 200, words: 40 },
    ]);
    expect(unassignedGaps(text, [{ start: 0, end: text.length }])).toEqual([]);
  });
});

describe("chapters and provenance", () => {
  it("an unnumbered window inherits the chapter before it; front matter is 0", () => {
    expect(
      resolveChapters([
        { chapter_number: null, chapter_title: "About This Guide" },
        { chapter_number: 1, chapter_title: "Chapter 1" },
        { chapter_number: null, chapter_title: "Comma Splices" },
        { chapter_number: 2, chapter_title: "Agreement" },
      ]),
    ).toEqual([0, 1, 1, 2]);
  });

  it("a book with no printed numbers is numbered by chapter title order", () => {
    expect(
      resolveChapters([
        { chapter_number: null, chapter_title: "Commas" },
        { chapter_number: null, chapter_title: "Commas" },
        { chapter_number: null, chapter_title: "Verbs" },
      ]),
    ).toEqual([1, 1, 2]);
  });

  it("book:<slug>:<chapter>:<section>, paged only where a section has several chunks", () => {
    const p = assignProvenance("meltzer-grammar", [
      { chapterNumber: 7, sectionTitle: "Semicolons", page: 140 },
      { chapterNumber: 7, sectionTitle: "Comma Splices", page: 142 },
      { chapterNumber: 7, sectionTitle: "comma splices ", page: 142 },
      { chapterNumber: 7, sectionTitle: "Comma Splices", page: 143 },
      { chapterNumber: 8, sectionTitle: "Semicolons", page: 150 },
    ]);
    expect(p).toEqual([
      "book:meltzer-grammar:7:1",
      "book:meltzer-grammar:7:2:p142",
      "book:meltzer-grammar:7:2:p142.2",
      "book:meltzer-grammar:7:2:p143",
      "book:meltzer-grammar:8:1",
    ]);
    expect(new Set(p).size).toBe(p.length);
    for (const x of p) expect(x).toMatch(BOOK_PROVENANCE_RE);
    expect(() => assignProvenance("Bad Slug", [])).toThrow(/slug/);
  });

  it("is deterministic: the same chunks get the same provenance", () => {
    const input = [
      { chapterNumber: 1, sectionTitle: "A", page: 1 },
      { chapterNumber: 1, sectionTitle: "A", page: 2 },
    ];
    expect(assignProvenance("b", input)).toEqual(assignProvenance("b", input));
  });
});

describe("the audit decides what is kept", () => {
  const pass = {
    complete: true,
    starts_mid_idea: false,
    faithful: true,
    self_contained: true,
    correct: true,
    issues: "",
  };
  it("passes only when every check passes", () => {
    expect(auditFailure(pass)).toBeNull();
    expect(auditFailure({ ...pass, starts_mid_idea: true })).toBe(
      "audit_starts_mid_idea",
    );
    expect(auditFailure({ ...pass, complete: false })).toBe("audit_incomplete");
    expect(auditFailure({ ...pass, faithful: false })).toBe("audit_unfaithful");
    expect(auditFailure({ ...pass, correct: false })).toBe("audit_incorrect");
    expect(auditFailure({ ...pass, self_contained: false })).toBe(
      "audit_not_self_contained",
    );
  });
});

describe("the review CSV", () => {
  const chunk = {
    provenance: "book:meltzer-grammar:7:3",
    content:
      'A semicolon joins two independent clauses, "like this"; both sides stand alone.',
    skill_codes: ["Boundaries"],
    content_type: "textbook" as const,
    surface_gate: "pre_and_post" as const,
  };
  const csv = toReviewCsv([
    chunk,
    { ...chunk, provenance: "book:meltzer-grammar:7:4" },
  ]);
  const lines = csv.trimEnd().split("\n");
  const yes = (i: number): string => {
    const l = [...lines];
    l[i] = `yes${l[i] ?? ""}`;
    return `${l.join("\n")}\n`;
  };

  it("has the brief's columns, the first 200 characters and the content hash", () => {
    expect(lines[0]).toBe(BOOK_REVIEW_HEADER.join(","));
    expect(lines[1]).toContain(sha256(chunk.content));
    expect(lines[1]).toContain("A semicolon joins two independent clauses");
  });

  it("nothing marked: nothing approved", () => {
    expect(parseBookReviewCsv(csv, SKILLS)).toEqual([]);
  });

  it("returns exactly the rows marked yes, with the reviewed hash", () => {
    expect(parseBookReviewCsv(yes(2), SKILLS)).toEqual([
      {
        provenance: "book:meltzer-grammar:7:4",
        skill_codes: ["Boundaries"],
        content_type: "textbook",
        surface_gate: "pre_and_post",
        content_sha256: sha256(chunk.content),
      },
    ]);
  });

  it("anything off-taxonomy, off-enum or malformed fails the whole file", () => {
    const bad = (from: string, to: string): string => yes(1).replace(from, to);
    expect(() =>
      parseBookReviewCsv(bad("Boundaries", "Grammar"), SKILLS),
    ).toThrow(/not a taxonomy skill/);
    expect(() =>
      parseBookReviewCsv(bad(",textbook,", ",video_transcript,"), SKILLS),
    ).toThrow(/content_type/);
    expect(() =>
      parseBookReviewCsv(bad(",pre_and_post,", ",review_only,"), SKILLS),
    ).toThrow(/surface_gate/);
    expect(() =>
      parseBookReviewCsv(
        bad("book:meltzer-grammar:7:3", "youtube:abcdefghijk:0-10"),
        SKILLS,
      ),
    ).toThrow(/not a book provenance/);
    expect(() =>
      parseBookReviewCsv(yes(1).replace(/^yes/m, "maybe"), SKILLS),
    ).toThrow(/approve must be/);
    expect(() =>
      parseBookReviewCsv(yes(1).replace(sha256(chunk.content), "abc"), SKILLS),
    ).toThrow(/sha256/);
    expect(() =>
      parseBookReviewCsv(`${yes(1)}${lines[1] ?? ""}\n`, SKILLS),
    ).toThrow(/duplicate/);
  });
});
