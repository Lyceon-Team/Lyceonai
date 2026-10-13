/**
 * The approval stamp from a batch merge (Doc 10B §2.4; owner answer 2026-10-11 item 1: "merge
 * alone counts … a plain workflow script stamps the approval from the merge event").
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §2.4, §8.7] | @implemented [2026-10-11]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVALS_PATH,
  approvalsEditProblem,
  cyclesTouched,
  mergeEventFromPull,
  serializeApprovals,
  stampApprovals,
  type MergeEvent,
} from "../../scripts/content/stamp-approval";
import { FIXTURE_APPROVALS } from "../lib/content-fixtures";
import {
  CONTENT_BRANCH,
  approvalsFileSchema,
} from "../../shared/content/approvals";
import { REPO_ROOT } from "../lib/prerendered-site";

const SHA = "b".repeat(40);
const merge = (over: Partial<MergeEvent> = {}): MergeEvent => ({
  pr: 1201,
  base: CONTENT_BRANCH,
  mergedBy: "karl-login",
  // 2026-10-17 03:30 UTC is still Friday 2026-10-16 in Chicago.
  mergedAt: "2026-10-17T03:30:00Z",
  mergeSha: SHA,
  changedFiles: [
    "content/batches/2026-W43/REVIEW.md",
    "shared/content/posts/sat-registration-deadlines.ts",
  ],
  ...over,
});

describe("stamping a merged batch", () => {
  it("a merge by the approver stamps each cycle it touched, dated the Chicago merge day", () => {
    const r = stampApprovals({}, merge(), "karl-login");
    expect(r).toEqual({
      ok: true,
      stamped: ["2026-W43"],
      approvals: {
        "2026-W43": {
          by: "Karl",
          date: "2026-10-16",
          pr: 1201,
          mergedBy: "karl-login",
          mergeSha: SHA,
        },
      },
    });
  });

  it("a merge by anyone else records nothing", () => {
    const r = stampApprovals(
      {},
      merge({ mergedBy: "someone-else" }),
      "karl-login",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not the approver/);
  });

  it("a merge by the approver into seo (or any base but social) records nothing", () => {
    expect(CONTENT_BRANCH).toBe("social");
    for (const base of ["seo", "main", "cleanup"]) {
      const r = stampApprovals({}, merge({ base }), "karl-login");
      expect(r, base).toEqual({
        ok: false,
        error: `merged into ${base}, not social: content is approved only from social`,
      });
    }
    // Presence: the same merge into social stamps.
    expect(stampApprovals({}, merge(), "karl-login").ok).toBe(true);
  });

  it("with no approver configured, nothing is recorded", () => {
    expect(stampApprovals({}, merge(), undefined)).toEqual({
      ok: false,
      error: "CONTENT_APPROVER_LOGIN is not set: no approval recorded",
    });
  });

  it("a pull request that edits the approvals file by hand is refused", () => {
    const r = stampApprovals(
      {},
      merge({
        changedFiles: [APPROVALS_PATH, "content/batches/2026-W43/REVIEW.md"],
      }),
      "karl-login",
    );
    expect(r.ok).toBe(false);
  });

  it("a re-run keeps the first stamp", () => {
    const first = stampApprovals({}, merge(), "karl-login");
    if (!first.ok) throw new Error(first.error);
    const again = stampApprovals(
      first.approvals,
      merge({ pr: 1300, mergeSha: "c".repeat(40) }),
      "karl-login",
    );
    expect(again).toEqual({
      ok: true,
      approvals: first.approvals,
      stamped: [],
    });
  });

  it("only cycle folders count; other paths and malformed names are ignored", () => {
    expect(
      cyclesTouched([
        "content/batches/2026-11-plan/PLAN.md",
        "content/batches/README.md",
        "content/batches/draft/x.md",
        "docs/a.md",
      ]),
    ).toEqual(["2026-11-plan"]);
  });

  it("the committed approvals file is valid and in the stable serialized form", () => {
    const text = readFileSync(join(REPO_ROOT, APPROVALS_PATH), "utf8");
    const parsed = approvalsFileSchema.parse(JSON.parse(text));
    expect(serializeApprovals(parsed)).toBe(text);
  });
});

describe("a pull request may not stamp approvals by hand", () => {
  const stamped = serializeApprovals(FIXTURE_APPROVALS);
  const empty = serializeApprovals({});
  it("adding the empty file (this pipeline's first PR) is not a hand stamp", () => {
    expect(approvalsEditProblem(null, empty)).toBe(null);
    expect(approvalsEditProblem(empty, "{}")).toBe(null);
  });
  it("adding, editing or removing a stamp is", () => {
    const byHand = `${APPROVALS_PATH} is changed by hand; only the merge workflow writes it`;
    expect(approvalsEditProblem(empty, stamped)).toBe(byHand);
    expect(approvalsEditProblem(null, stamped)).toBe(byHand);
    expect(approvalsEditProblem(stamped, empty)).toBe(byHand);
    expect(
      approvalsEditProblem(
        stamped,
        stamped.replace("2026-10-16", "2026-10-15"),
      ),
    ).toBe(byHand);
  });
  it("an unparseable or malformed file is refused", () => {
    expect(approvalsEditProblem(empty, "{")).toBe(
      `${APPROVALS_PATH} is not a valid approvals file`,
    );
    expect(approvalsEditProblem(empty, '{"2026-W43": {"by": "Someone"}}')).toBe(
      `${APPROVALS_PATH} is not a valid approvals file`,
    );
  });
});

/**
 * GitHub's REST record of a merged pull request (`GET /repos/{owner}/{repo}/pulls/{number}`),
 * trimmed to a realistic subset: the values are #1192's real ones (merged by kingk237 at
 * 2026-10-11T07:56:55Z as merge commit 024256a4 on seo), re-based onto social for the batch case.
 * Extra fields stay in so the parser is shown to ignore them.
 */
const MERGE_SHA = "024256a4cbdc0384b6cefdd488856d690fd475d5";
function githubPull(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    url: "https://api.github.com/repos/Lyceon-Team/Lyceonai/pulls/1192",
    number: 1192,
    state: "closed",
    title: "content: 2026-W45 batch",
    user: { login: "kingk237", id: 223177803 },
    merged: true,
    merged_at: "2026-10-11T07:56:55Z",
    merge_commit_sha: MERGE_SHA,
    merged_by: { login: "kingk237", id: 223177803, type: "User" },
    head: {
      ref: "claude/content-2026-W45",
      sha: "afef05f3b9a69e55a837a0e4f69c08aeda49749e",
    },
    base: { ref: "social", sha: "419b240b88b79142b97813c5a890cc27159251c5" },
    ...over,
  };
}
const BATCH_FILES = [
  "content/batches/2026-W45/REVIEW.md",
  "shared/content/posts/sat-test-day-checklist.ts",
];

describe("the merge is read from GitHub's record of the pull request", () => {
  it("a merged pull request whose merge commit is this push yields the merge event", () => {
    expect(mergeEventFromPull(githubPull(), MERGE_SHA, BATCH_FILES)).toEqual({
      ok: true,
      event: {
        pr: 1192,
        base: "social",
        mergedBy: "kingk237",
        mergedAt: "2026-10-11T07:56:55Z",
        mergeSha: MERGE_SHA,
        changedFiles: BATCH_FILES,
      },
    });
  });

  it("and the stamp it leads to is Karl's, dated the Chicago merge day", () => {
    const merge = mergeEventFromPull(githubPull(), MERGE_SHA, BATCH_FILES);
    if (!merge.ok) throw new Error(merge.reason);
    const r = stampApprovals({}, merge.event, "kingk237");
    expect(r).toEqual({
      ok: true,
      approvals: {
        "2026-W45": {
          by: "Karl",
          date: "2026-10-11",
          pr: 1192,
          mergedBy: "kingk237",
          mergeSha: MERGE_SHA,
        },
      },
      stamped: ["2026-W45"],
    });
  });

  it("a push that is not that pull request's merge commit stamps nothing", () => {
    expect(
      mergeEventFromPull(githubPull(), "f".repeat(40), BATCH_FILES),
    ).toEqual({
      ok: false,
      reason: "pull request #1192 was not merged by this push (fffffff)",
    });
  });

  it("an unmerged pull request, or no pull request at all (the App's own stamp commit), stamps nothing", () => {
    expect(
      mergeEventFromPull(
        githubPull({ merged_at: null, merged_by: null }),
        MERGE_SHA,
        BATCH_FILES,
      ),
    ).toEqual({ ok: false, reason: "pull request #1192 is not merged" });
    expect(mergeEventFromPull(null, MERGE_SHA, [APPROVALS_PATH])).toEqual({
      ok: false,
      reason: "no pull request record for this push",
    });
  });

  it("a merge by someone else, read from GitHub's record, is still refused by the stamp", () => {
    const merge = mergeEventFromPull(
      githubPull({ merged_by: { login: "someone-else" } }),
      MERGE_SHA,
      BATCH_FILES,
    );
    if (!merge.ok) throw new Error(merge.reason);
    expect(stampApprovals({}, merge.event, "kingk237").ok).toBe(false);
  });
});
