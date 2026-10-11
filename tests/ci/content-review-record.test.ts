/**
 * The review record check (Doc 10B §8.7): a batch pull request cannot be marked ready without the
 * Codex audit and a Claude response to every REVISE; Codex writes only its own section.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §8.7; owner brief "Doc 10B Phase 1" (Karl, 2026-10-11)
 *       scope 2; owner answer on Step 0, item 3] | @implemented [2026-10-11]
 *
 * plain English: every record here is the real template (content/batches/REVIEW.template.md) with
 * its table rows filled in, so the check is proven against the file the triggers copy.
 */
import { describe, expect, it } from "vitest";
import {
  codexCommitProblems,
  copiedCommentProblems,
  reviewRecordProblems,
  reviewSections,
} from "../../scripts/content/review-record";
import {
  reviewRecord as record,
  type ReviewRows as Rows,
} from "../lib/content-fixtures";

const ITEMS = ["post-a", "post-b"];
const SELF = ["| `post-a` | pass | ok |", "| `post-b` | pass | ok |"];
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

describe("a draft batch pull request", () => {
  it("needs only the self-audit, one row per item", () => {
    expect(
      reviewRecordProblems(record({ self: SELF, codex: [], response: [] }), {
        items: ITEMS,
        ready: false,
      }),
    ).toEqual([]);
  });
  it("a self-audit missing an item is reported", () => {
    expect(
      reviewRecordProblems(
        record({ self: [SELF[0] ?? ""], codex: [], response: [] }),
        { items: ITEMS, ready: false },
      ),
    ).toEqual(["self-audit has no row for post-b"]);
  });
});

describe("a batch pull request marked ready", () => {
  it("passes with a Codex verdict for every item and a Claude response to the REVISE", () => {
    expect(
      reviewRecordProblems(record(READY_RECORD), { items: ITEMS, ready: true }),
    ).toEqual([]);
  });

  it("is blocked when the Codex section has not been written", () => {
    const problems = reviewRecordProblems(
      record({ self: SELF, codex: [], response: [] }),
      { items: ITEMS, ready: true },
    );
    expect(problems).toContain(
      "the Codex audit has no Source line naming Codex and a date (it has not been written)",
    );
    expect(problems).toContain("the Codex audit has no verdict for post-a");
  });

  it("is blocked when a REVISE has no Claude response", () => {
    expect(
      reviewRecordProblems(record({ ...READY_RECORD, response: [] }), {
        items: ITEMS,
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
      reviewRecordProblems(record(noEvidence), { items: ITEMS, ready: true }),
    ).toContain("Codex verdict for post-b has no reasons or no evidence");
    const odd = {
      ...READY_RECORD,
      codex: [CODEX_OK[0] ?? "", "| `post-b` | MAYBE | x | y |"],
    };
    expect(
      reviewRecordProblems(record(odd), { items: ITEMS, ready: true }).join(
        "\n",
      ),
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
      reviewRecordProblems(record(rejected), { items: ITEMS, ready: true }),
    ).toContain("post-b was REJECTed but is still in the batch");
    expect(
      reviewRecordProblems(record(rejected), {
        items: ["post-a"],
        ready: true,
      }),
    ).toEqual([]);
    const carried: Rows = {
      ...READY_RECORD,
      response: ["| `post-b` | Wrong deadline. | Carried to 2026-W44. | - |"],
    };
    expect(
      reviewRecordProblems(record(carried), { items: ITEMS, ready: true }).join(
        "\n",
      ),
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
        items: ITEMS,
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
      "| `post-a` | pass | ok |",
      "| `post-a` | pass | edited by Codex |",
    );
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
