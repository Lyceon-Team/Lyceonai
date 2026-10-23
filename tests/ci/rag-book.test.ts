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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOK_PROVENANCE_RE,
  BOOK_REVIEW_HEADER,
  BookText,
  type LocatedUnit,
  type ProposedUnit,
  dropActSections,
  parseOcrPage,
  assignProvenance,
  locateQuote,
  onSubsectionBoundary,
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

  it("accepts a short heading quote only when it occurs once in the range", () => {
    const text =
      "### A. Two Commas\nThe first rule.\n\n### B. Two Dashes\nThe second rule.\n\n### B. Two Items\nx\n\n### B. Two Items\ny";
    // 10 characters, once: placed.
    const d = locateQuote(text, "B. Two Dashes");
    expect(text.slice(d?.start, d?.end)).toBe("B. Two Dashes");
    // 9 characters, twice in the range: ambiguous, refused.
    expect(locateQuote(text, "B. Two Items")).toBeNull();
    // ...but once after the first of them: placed at the second.
    const second = text.lastIndexOf("### B. Two Items");
    expect(locateQuote(text, "B. Two Items", second)?.start).toBe(second + 4);
    // the range end counts: once before `to`, so placed even with `last`.
    expect(
      locateQuote(text, "B. Two Items", 0, { to: second, last: true })?.start,
    ).toBe(text.indexOf("B. Two Items"));
    // a 12+ character quote that recurs is still placed (first, or last with `last`).
    expect(locateQuote(text, "### B. Two Items x", 0)).not.toBeNull();
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
    ).toThrow(/start_quote ".*" not found/);
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
    act_scope_respected: true,
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
    // ACT advice stated as general fails on its own, whatever else passed.
    expect(auditFailure({ ...pass, act_scope_respected: false })).toBe(
      "audit_act_generalised",
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

describe("OCR markdown input and the ACT-only ruling", () => {
  const page = (n: number, body: string): string =>
    `<!-- PDF page ${n + 1}; printed page ${n} -->\n\n${body}\n`;

  it("reads the printed page and strips the header comments", () => {
    expect(parseOcrPage(15, page(14, "## 10. PRONOUNS"))).toEqual({
      pdfPage: 15,
      printed: 14,
      body: "## 10. PRONOUNS",
    });
    expect(parseOcrPage(1, "# Cover")).toMatchObject({ printed: null });
  });

  const pages = [
    parseOcrPage(
      3,
      page(
        2,
        [
          "## 1. PERIODS & SEMICOLONS",
          "",
          "[ACT NOTE] **Note:** ACT grammar questions testing *however* use a semicolon.",
          "",
          "#### Who's vs. Whose (Primarily ACT)",
          "[ACT ONLY]",
          "",
          "**Correct:** a scientist **who's** best known",
        ].join("\n"),
      ),
    ),
    parseOcrPage(
      4,
      page(
        3,
        [
          "whose continues here",
          "",
          "## 2. COLONS",
          "",
          "### C. Then vs. Than (ACT)",
          "[ACT ONLY]",
          "",
          "Use *than*.",
          "",
          "### D. Quantity Words",
          "",
          "*Number* modifies plural nouns.",
        ].join("\n"),
      ),
    ),
    parseOcrPage(
      5,
      page(
        4,
        "## ACT ONLY\n[ACT ONLY]\n\n## 17. SHORTER IS BETTER\n\nAvoid wordiness.",
      ),
    ),
    parseOcrPage(6, page(5, "## Preposition-Based Idioms\n\nBe curious about")),
  ];

  it("drops by section: flagged subsections to the next heading at their level, the banner to the end", () => {
    const { pages: kept, dropped } = dropActSections(pages);
    const text = kept.map((p) => p.body).join("\n");
    expect(dropped.map((d) => [d.reason, d.heading, d.page])).toEqual([
      ["act_only_subsection", "Who's vs. Whose (Primarily ACT)", 2],
      ["act_only_subsection", "C. Then vs. Than (ACT)", 3],
      ["act_only_section", "ACT ONLY", 4],
    ]);
    // presence before absence: what must survive does
    expect(text).toContain("## 2. COLONS");
    expect(text).toContain("### D. Quantity Words");
    for (const gone of [
      "who's",
      "whose continues",
      "Use *than*",
      "SHORTER",
      "Be curious about",
    ])
      expect(text).not.toContain(gone);
    expect(kept.map((p) => p.printed)).toEqual([2, 3]);
  });

  it("keeps [ACT NOTE] paragraphs (a general rule may mention the ACT) and their marker", () => {
    const text = dropActSections(pages)
      .pages.map((p) => p.body)
      .join("\n");
    // The marker stays: the rewrite and the audit need it to keep ACT-scoped advice out of an
    // entry rather than state it as general (Karl, 2026-10-23).
    expect(text).toContain(
      "[ACT NOTE] **Note:** ACT grammar questions testing *however* use a semicolon.",
    );
    expect(text).not.toContain("[ACT ONLY]");
  });

  it("quote matching skips the [ACT NOTE] marker", () => {
    const text =
      "A rule.\n\n[ACT NOTE]\nIn addition, if there is an OMIT option, check it first.";
    const m = locateQuote(
      text,
      "A rule. In addition, if there is an OMIT option",
    );
    expect(m).not.toBeNull();
    expect(text.slice(m?.start, m?.end)).toBe(
      "A rule.\n\n[ACT NOTE]\nIn addition, if there is an OMIT option",
    );
  });

  it("on the accepted Meltzer extraction: exactly the ruled sections go", () => {
    const dir = resolve(
      import.meta.dirname,
      "../../scripts/rag/.cache/book-meltzer-grammar/ocr",
    );
    if (!existsSync(resolve(dir, "page-03.md"))) return; // the book is not in the repo
    const files = readdirSync(dir)
      .map((f) => /^page-(\d+)\.md$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]));
    const { pages: kept, dropped } = dropActSections(
      files.map((m) =>
        parseOcrPage(Number(m[1]), readFileSync(resolve(dir, m[0]), "utf8")),
      ),
    );
    expect(dropped.map((d) => [d.heading, d.page])).toEqual([
      ["Who’s vs. Whose (Primarily ACT)", 13],
      ["C. Then vs. Than (ACT)", 23],
      ["ACT ONLY", 25],
    ]);
    const text = kept.map((p) => p.body).join("\n");
    expect(text).toContain("## 16. QUESTION MARKS");
    expect(text).toContain("No *that* = no comma");
    expect(text).not.toContain("## 17. SHORTER IS BETTER");
    expect(text).not.toContain("Preposition-Based Idioms");
  });

  it("BookText reports printed pages when it has them", () => {
    const b = new BookText(["one", "two"], [13, 14]);
    expect(b.pageAt(b.text.indexOf("two"))).toBe(14);
    expect(b.marked(0, b.text.length)).toContain("[page 14]");
  });
});

describe("quotes across OCR markup", () => {
  it("a quote matches across <u> tags, mapped to the original offsets", () => {
    const text =
      "**Correct:** <u>Although</u> London is a very old **city, it** has many modern buildings.";
    const m = locateQuote(
      text,
      "Although London is a very old city, it has many",
    );
    expect(m).not.toBeNull();
    expect(text.slice(m?.start, m?.end)).toBe(
      "Although</u> London is a very old **city, it** has many",
    );
  });
});

describe("onSubsectionBoundary", () => {
  const text = [
    "## 6. NON-ESSENTIAL CLAUSES",
    "Non-essential information can be removed.",
    "",
    "### A. Two Commas",
    "Use two commas.",
    "",
    "### B. Two Dashes",
    "Use two dashes.",
    "",
    "## 7. NAMES AND TITLES",
    "Commas around a name.",
  ].join("\n");
  const at = (q: string): number => text.indexOf(q);

  it("is true for a unit that ends at a sibling subsection", () => {
    expect(onSubsectionBoundary(text, 0, at("### B."))).toBe(true);
  });
  it("is true for a unit that starts at a subsection inside a rule", () => {
    expect(onSubsectionBoundary(text, at("### B."), at("## 7."))).toBe(true);
  });
  it("is false for a whole numbered rule, siblings and all", () => {
    expect(onSubsectionBoundary(text, 0, at("## 7."))).toBe(false);
    expect(onSubsectionBoundary(text, at("## 7."), text.length)).toBe(false);
  });
  it("is false for a split inside a subsection's prose", () => {
    expect(
      onSubsectionBoundary(text, at("Use two commas."), at("Use two dashes.")),
    ).toBe(false);
  });
});
