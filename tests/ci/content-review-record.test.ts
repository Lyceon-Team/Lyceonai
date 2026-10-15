/**
 * The review record check (Doc 10B §8.7): a batch pull request cannot be marked ready without the
 * Codex audit and a Claude response to every REVISE; Codex writes only its own section; section 1
 * is the structural record of what was produced and nothing else (SCL-229).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §8.7, amended by SCL-229; owner brief "Doc 10B Phase 1"
 *       (Karl, 2026-10-11) scope 2; owner answer on Step 0, item 3; Karl's ruling 2026-10-13
 *       ("Claude's self-audit is private")] | @implemented [2026-10-11; section 1 2026-10-13]
 *
 * plain English: every record here is the real template (content/batches/REVIEW.template.md) with
 * its table rows filled in, and section 1's rows are printed by the real producer
 * (scripts/content/production-record.ts) from posts built by the real post builder, so the check
 * is proven against the file the triggers copy and the rows the triggers print.
 */
import { describe, expect, it } from "vitest";
import { toScheduledPost } from "../../shared/content/blog";
import {
  SAT_DATES_SOURCE_URL,
  SAT_SCORE_RELEASE_SOURCE_URL,
} from "../../shared/sat-test-dates";
import { planSkeleton } from "../../scripts/content/plan-skeleton";
import {
  PASSED_INTERNAL_AUDIT,
  cycleProduction,
  planProduction,
  productionRow,
  productionTable,
} from "../../scripts/content/production-record";
import {
  codexCommitProblems,
  copiedCommentProblems,
  productionRecordProblems,
  reviewRecordProblems,
  reviewSections,
} from "../../scripts/content/review-record";
import {
  FIXTURE_APPROVALS,
  reviewRecord as record,
  scheduledSpec,
  type ReviewRows as Rows,
} from "../lib/content-fixtures";

const POSTS = [
  toScheduledPost(
    scheduledSpec({
      slug: "post-a",
      publishAt: "2026-10-19T07:00",
      targetKeyword: "fixture a",
    }),
    FIXTURE_APPROVALS,
  ),
  toScheduledPost(
    scheduledSpec({
      slug: "post-b",
      publishAt: "2026-10-21T07:00",
      targetKeyword: "fixture b",
    }),
    FIXTURE_APPROVALS,
  ),
];
const PRODUCTION = cycleProduction(POSTS[0]?.batch ?? "", POSTS);
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture is missing an item");
  return value;
}
const PROD_A = must(PRODUCTION[0]);
const PROD_B = must(PRODUCTION[1]);
const SELF = PRODUCTION.map(productionRow);
const CODEX_OK = [
  '| `post-a` | APPROVE | Every claim cited. | https://satsuite.collegeboard.org/sat/dates-deadlines: "Nov. 7, 2026" |',
  '| `post-b` | REVISE | The deadline is wrong. | https://satsuite.collegeboard.org/sat/dates-deadlines: "Oct. 23, 2026" |',
];
const READY_RECORD: Rows = {
  self: SELF,
  source: "Codex scheduled task, 2026-10-15",
  codex: CODEX_OK,
  response: [
    "| `post-b` | The deadline is wrong. | Fixed: Oct. 23, 2026. | abc1234 |",
  ],
};
const draft = (self: string[]): string[] =>
  reviewRecordProblems(record({ self, codex: [], response: [] }), {
    production: PRODUCTION,
    ready: false,
  });

describe("section 1 is the structural record of what was produced (SCL-229)", () => {
  it("the producer builds each row from the post itself", () => {
    expect(PRODUCTION.map((p) => p.item)).toEqual(["post-a", "post-b"]);
    expect(PROD_A.title).toBe(POSTS[0]?.page.title);
    expect(PROD_A.publishes).toBe("2026-10-19 07:00 CT");
    expect(PROD_A.keyword).toBe("fixture a");
    expect(PROD_A.sources.length).toBeGreaterThan(0);
    expect(SELF[0]?.endsWith(`| ${PASSED_INTERNAL_AUDIT} |`)).toBe(true);
  });

  it("a monthly plan's row comes from the month's slots and College Board's date pages", () => {
    expect(planProduction("2026-11-plan")).toEqual({
      item: "plan",
      title: "November 2026 content plan",
      publishes: "13 posts, 2026-11-02 to 2026-11-30",
      keyword: "One per post, in PLAN.md",
      sources: [SAT_DATES_SOURCE_URL, SAT_SCORE_RELEASE_SOURCE_URL].sort(),
    });
  });

  it("a plan's row counts the slots its PLAN.md lists, so a rest-of-month plan says so", () => {
    const october = planSkeleton("2026-10", "2026-10-19");
    expect(planProduction("2026-10-plan", october).publishes).toBe(
      "6 posts, 2026-10-19 to 2026-10-30",
    );
    expect(
      cycleProduction("2026-10-plan", [], () => october)[0]?.publishes,
    ).toBe("6 posts, 2026-10-19 to 2026-10-30");
    // A whole-month PLAN.md gives the same row as the month itself.
    expect(planProduction("2026-11-plan", planSkeleton("2026-11"))).toEqual(
      planProduction("2026-11-plan"),
    );
  });

  it("a draft passes with the printed rows and nothing else", () => {
    expect(draft(SELF)).toEqual([]);
    expect(productionTable(PRODUCTION).split("\n").slice(2)).toEqual(SELF);
  });

  it("a missing item, or one the cycle does not carry, is reported", () => {
    expect(draft([SELF[0] ?? ""])).toEqual(["section 1 has no row for post-b"]);
    const extra = productionRow({ ...PROD_B, item: "post-c" });
    expect(draft([...SELF, extra])).toEqual([
      "section 1 has a row for post-c, which the cycle does not carry",
    ]);
  });

  it("a note, finding or doubt anywhere in section 1 is refused", () => {
    const record1 = record({ self: SELF, codex: [], response: [] }).replace(
      "## 2. Codex audit",
      "Notes for Karl: the Nov 4 post has two inferences worth a look.\n\n## 2. Codex audit",
    );
    expect(
      reviewRecordProblems(record1, { production: PRODUCTION, ready: false }),
    ).toEqual([
      'section 1 holds only the production table (SCL-229); remove "Notes for Karl: the Nov 4 post has two inferences worth a lo"',
    ]);
  });

  it("the old self-audit row, with gates and notes, is refused", () => {
    const old = [
      "| Item | Gates | Notes |",
      "| --- | --- | --- |",
      "| `post-a` | pass | Two sentences are my reasoning from the sources. |",
    ].join("\n");
    const problems = productionRecordProblems(old, PRODUCTION.slice(0, 1));
    expect(problems).toEqual([
      'section 1\'s table header is "| Item | Gates | Notes |", not "| Item | Title | Publishes | Target keyword | Sources | Audit |"',
      "section 1's row for post-a has 3 cells, not 6",
    ]);
  });

  it("each cell must equal what was produced", () => {
    const a = PROD_A;
    const row = (over: Partial<typeof a>): string =>
      productionRow({ ...a, ...over });
    expect(draft([row({ title: "Another title" }), SELF[1] ?? ""])).toEqual([
      `section 1's title for post-a is "Another title", not "${a.title}"`,
    ]);
    expect(
      draft([row({ publishes: "2026-10-20 07:00 CT" }), SELF[1] ?? ""]),
    ).toEqual([
      `section 1's publish time for post-a is "2026-10-20 07:00 CT", not "2026-10-19 07:00 CT"`,
    ]);
    expect(draft([row({ keyword: "fixture z" }), SELF[1] ?? ""])).toEqual([
      `section 1's target keyword for post-a is "fixture z", not "fixture a"`,
    ]);
    const doubted = (SELF[0] ?? "").replace(
      PASSED_INTERNAL_AUDIT,
      "Passed, but the second source is thin.",
    );
    expect(draft([doubted, SELF[1] ?? ""])).toEqual([
      `section 1's audit cell for post-a is "Passed, but the second source is thin.", not "${PASSED_INTERNAL_AUDIT}"`,
    ]);
  });

  it("the sources cell holds exactly the cited links and no words", () => {
    const a = PROD_A;
    const missing = productionRow({ ...a, sources: a.sources.slice(1) });
    expect(draft([missing, SELF[1] ?? ""])).toEqual([
      `section 1's sources for post-a are not the ${a.sources.length} it cites: ${a.sources.join(", ")}`,
    ]);
    const worded = (SELF[0] ?? "").replace(
      `<${a.sources[0] ?? ""}>`,
      `<${a.sources[0] ?? ""}> (checked)`,
    );
    expect(draft([worded, SELF[1] ?? ""])).toEqual([
      `section 1's sources for post-a hold only links; remove "(checked)"`,
    ]);
  });
});

describe("a batch pull request marked ready", () => {
  it("passes with a Codex verdict for every item and a Claude response to the REVISE", () => {
    expect(
      reviewRecordProblems(record(READY_RECORD), {
        production: PRODUCTION,
        ready: true,
      }),
    ).toEqual([]);
  });

  it("is blocked when the Codex section has not been written", () => {
    const problems = reviewRecordProblems(
      record({ self: SELF, codex: [], response: [] }),
      { production: PRODUCTION, ready: true },
    );
    expect(problems).toContain(
      "the Codex audit has no Source line naming Codex and a date (it has not been written)",
    );
    expect(problems).toContain("the Codex audit has no verdict for post-a");
  });

  it("is blocked when a REVISE has no Claude response", () => {
    expect(
      reviewRecordProblems(record({ ...READY_RECORD, response: [] }), {
        production: PRODUCTION,
        ready: true,
      }),
    ).toEqual(["no Claude response to the Codex REVISE of post-b"]);
  });

  it("is blocked when a verdict has no evidence, or is not one of the three", () => {
    const noEvidence = {
      ...READY_RECORD,
      codex: [CODEX_OK[0] ?? "", "| `post-b` | APPROVE | Fine. |  |"],
    };
    expect(
      reviewRecordProblems(record(noEvidence), {
        production: PRODUCTION,
        ready: true,
      }),
    ).toContain("Codex verdict for post-b has no reasons or no evidence");
    const odd = {
      ...READY_RECORD,
      codex: [CODEX_OK[0] ?? "", "| `post-b` | MAYBE | x | y |"],
    };
    expect(
      reviewRecordProblems(record(odd), {
        production: PRODUCTION,
        ready: true,
      }).join("\n"),
    ).toMatch(/MAYBE/);
  });

  it("a REJECTed item, or one carried to the next cycle, must have left the batch", () => {
    const rejected: Rows = {
      ...READY_RECORD,
      codex: [
        CODEX_OK[0] ?? "",
        "| `post-b` | REJECT | Duplicates /what-is-a-good-sat-score. | gate 11 |",
      ],
      response: ["| `post-b` | Duplicate topic. | Dropped. | - |"],
    };
    expect(
      reviewRecordProblems(record(rejected), {
        production: PRODUCTION,
        ready: true,
      }),
    ).toContain("post-b was REJECTed but is still in the batch");
    // Dropping an item removes its module and reprints section 1, so its row goes too.
    expect(
      reviewRecordProblems(record({ ...rejected, self: SELF.slice(0, 1) }), {
        production: PRODUCTION.slice(0, 1),
        ready: true,
      }),
    ).toEqual([]);
    expect(
      reviewRecordProblems(record(rejected), {
        production: PRODUCTION.slice(0, 1),
        ready: true,
      }),
    ).toEqual([
      "section 1 has a row for post-b, which the cycle does not carry",
    ]);
    const carried: Rows = {
      ...READY_RECORD,
      response: ["| `post-b` | Wrong deadline. | Carried to 2026-W44. | - |"],
    };
    expect(
      reviewRecordProblems(record(carried), {
        production: PRODUCTION,
        ready: true,
      }).join("\n"),
    ).toMatch(/still in the batch/);
  });

  it("the four sections must all be there, in order", () => {
    const shuffled = record(READY_RECORD)
      .replace("## 3. Claude response", "## X")
      .replace(
        "## 4. Karl decision",
        "## 3. Claude response\n\n## 4. Karl decision",
      );
    expect(
      reviewRecordProblems(shuffled.replace("## 1. Claude self-audit", ""), {
        production: PRODUCTION,
        ready: false,
      }),
    ).toContain('missing the heading "## 1. Claude self-audit"');
  });
});

describe("Codex writes only its own section", () => {
  const before = record({ self: SELF, codex: [], response: [] });
  const after = record({
    self: SELF,
    source: "Codex scheduled task, 2026-10-15",
    codex: CODEX_OK,
    response: [],
  });
  it("a Codex commit that fills the Codex section is fine", () => {
    expect(
      codexCommitProblems([
        { path: "content/batches/2026-W43/REVIEW.md", before, after },
      ]),
    ).toEqual([]);
  });
  it("a Codex commit that edits a post, or another section, is refused", () => {
    expect(
      codexCommitProblems([
        { path: "shared/content/posts/post-a.ts", before: "a", after: "b" },
      ])[0],
    ).toMatch(/changed shared\/content\/posts\/post-a\.ts/);
    const editedSelfAudit = after.replace(
      SELF[0] ?? "",
      (SELF[0] ?? "").replace(PASSED_INTERNAL_AUDIT, "Edited by Codex."),
    );
    expect(editedSelfAudit).not.toBe(after);
    expect(
      codexCommitProblems([
        {
          path: "content/batches/2026-W43/REVIEW.md",
          before,
          after: editedSelfAudit,
        },
      ]),
    ).toEqual([
      'a Codex audit commit changed content/batches/2026-W43/REVIEW.md outside "## 2. Codex audit"',
    ]);
  });
});

describe("a Codex audit copied from Codex's pull request comment", () => {
  const section = reviewSections(record(READY_RECORD))[1] ?? "";
  it("matches when every verdict row is in the comment verbatim", () => {
    expect(
      copiedCommentProblems(
        section,
        `Audit\n\n| Item | Verdict | Reasons | Evidence |\n|---|---|---|---|\n${CODEX_OK.join("\n")}`,
      ),
    ).toEqual([]);
  });
  it("a row that differs from the comment is reported", () => {
    expect(copiedCommentProblems(section, CODEX_OK[0] ?? "")).toEqual([
      "the Codex row for post-b is not in Codex's comment verbatim",
    ]);
  });
});
