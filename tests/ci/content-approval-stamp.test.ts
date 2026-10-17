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
  anchorFromEnv,
  approvalsEditProblem,
  cyclesTouched,
  mergeEventFromPull,
  serializeApprovals,
  stampApprovals,
  unstampedOutcome,
  type MergeAnchor,
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
const PUSHED: MergeAnchor = { kind: "push", sha: MERGE_SHA };
const BATCH_FILES = [
  "content/batches/2026-W45/REVIEW.md",
  "shared/content/posts/sat-test-day-checklist.ts",
];

describe("the merge is read from GitHub's record of the pull request", () => {
  it("a merged pull request whose merge commit is this push yields the merge event", () => {
    expect(mergeEventFromPull(githubPull(), PUSHED, BATCH_FILES)).toEqual({
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
    const merge = mergeEventFromPull(githubPull(), PUSHED, BATCH_FILES);
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
      mergeEventFromPull(
        githubPull(),
        { kind: "push", sha: "f".repeat(40) },
        BATCH_FILES,
      ),
    ).toEqual({
      ok: false,
      reason: "pull request #1192 was not merged by this push (fffffff)",
    });
  });

  it("an unmerged pull request, or no pull request at all (the stamp commit itself), stamps nothing", () => {
    expect(
      mergeEventFromPull(
        githubPull({ merged_at: null, merged_by: null }),
        PUSHED,
        BATCH_FILES,
      ),
    ).toEqual({ ok: false, reason: "pull request #1192 is not merged" });
    expect(mergeEventFromPull(null, PUSHED, [APPROVALS_PATH])).toEqual({
      ok: false,
      reason: "no pull request record for this push",
    });
  });

  it("a merge by someone else, read from GitHub's record, is still refused by the stamp", () => {
    const merge = mergeEventFromPull(
      githubPull({ merged_by: { login: "someone-else" } }),
      PUSHED,
      BATCH_FILES,
    );
    if (!merge.ok) throw new Error(merge.reason);
    expect(stampApprovals({}, merge.event, "kingk237").ok).toBe(false);
  });
});

/**
 * GitHub's record of #1240 (content: 2026-10 plan), the merge whose stamp run failed on the App
 * token before Karl's ruling of 2026-10-15: merged by kingk237 at 2026-10-15T04:31:12Z as merge
 * commit bbc0c392 on social. Its two content/batches paths are the real ones
 * (`git diff --name-only e534d35c 9de504b3 -- content/batches/`); the other path stands in for
 * the 282 files the plan's merge of main carried.
 */
const PLAN_MERGE_SHA = "bbc0c392c42a7adde52eec23449430c8769ebb4b";
function planPull(over: Record<string, unknown> = {}): Record<string, unknown> {
  return githubPull({
    url: "https://api.github.com/repos/Lyceon-Team/Lyceonai/pulls/1240",
    number: 1240,
    title: "content: 2026-10 plan",
    merged_at: "2026-10-15T04:31:12Z",
    merge_commit_sha: PLAN_MERGE_SHA,
    head: {
      ref: "claude/content-2026-10-plan",
      sha: "9de504b3c183c82543dd9e2e74a0109c1124e443",
    },
    base: { ref: "social", sha: "e534d35c7a4d83ea3ba5389d8d9ada29e3df2524" },
    ...over,
  });
}
/** social's approvals.json as it stood when #1240's stamp run failed (git show bbc0c392:…). */
const FIXTURE_APPROVALS_BEFORE_PLAN = {
  "2026-11-plan": {
    by: "Karl",
    date: "2026-10-12",
    pr: 1201,
    mergedBy: "kingk237",
    mergeSha: "903a409b95c3d90fe5f0609d63594365ce896bb8",
  },
  "2026-W45": {
    by: "Karl",
    date: "2026-10-12",
    pr: 1202,
    mergedBy: "kingk237",
    mergeSha: "1108c0ac14b94f96ce4c743b555462c94d6a79e7",
  },
} as const;
const PLAN_FILES = [
  "content/batches/2026-10-plan/PLAN.md",
  "content/batches/2026-10-plan/REVIEW.md",
  "scripts/content/plan-skeleton.ts",
];
const dispatch = (
  over: Partial<Extract<MergeAnchor, { kind: "dispatch" }>> = {},
): MergeAnchor => ({
  kind: "dispatch",
  pr: 1240,
  mergeCommitOnBranch: true,
  ...over,
});

describe("Karl stamps a past merge by dispatch (pr_number)", () => {
  it("#1240, merged into social by the approver and on social, stamps 2026-10-plan on its Chicago merge day", () => {
    const merge = mergeEventFromPull(planPull(), dispatch(), PLAN_FILES);
    if (!merge.ok) throw new Error(merge.reason);
    expect(
      stampApprovals(FIXTURE_APPROVALS_BEFORE_PLAN, merge.event, "kingk237"),
    ).toEqual({
      ok: true,
      stamped: ["2026-10-plan"],
      approvals: {
        ...FIXTURE_APPROVALS_BEFORE_PLAN,
        // 04:31 UTC on Oct 15 is 23:31 on Oct 14 in Chicago.
        "2026-10-plan": {
          by: "Karl",
          date: "2026-10-14",
          pr: 1240,
          mergedBy: "kingk237",
          mergeSha: PLAN_MERGE_SHA,
        },
      },
    });
  });

  it("a dispatch whose merge commit is not on social stamps nothing", () => {
    expect(
      mergeEventFromPull(
        planPull(),
        dispatch({ mergeCommitOnBranch: false }),
        PLAN_FILES,
      ),
    ).toEqual({
      ok: false,
      reason: "pull request #1240's merge commit is not on social",
    });
  });

  it("a dispatch naming one pull request never stamps another's record", () => {
    expect(
      mergeEventFromPull(planPull(), dispatch({ pr: 1247 }), PLAN_FILES),
    ).toEqual({
      ok: false,
      reason: "the record is pull request #1240, not the requested #1247",
    });
  });

  it("a dispatch for an open pull request, or one with no record, stamps nothing", () => {
    expect(
      mergeEventFromPull(
        planPull({ merged_at: null, merged_by: null, merge_commit_sha: null }),
        dispatch(),
        PLAN_FILES,
      ),
    ).toEqual({ ok: false, reason: "pull request #1240 is not merged" });
    expect(mergeEventFromPull(null, dispatch(), PLAN_FILES)).toEqual({
      ok: false,
      reason: "no pull request record for #1240",
    });
  });

  it("a dispatched merge is held to the same rules: the approver, into social, no hand stamp", () => {
    const into = (pull: Record<string, unknown>, files = PLAN_FILES) => {
      const m = mergeEventFromPull(pull, dispatch(), files);
      if (!m.ok) throw new Error(m.reason);
      return stampApprovals({}, m.event, "kingk237");
    };
    expect(into(planPull({ merged_by: { login: "someone-else" } })).ok).toBe(
      false,
    );
    expect(into(planPull({ base: { ref: "seo" } }))).toEqual({
      ok: false,
      error:
        "merged into seo, not social: content is approved only from social",
    });
    expect(into(planPull(), [...PLAN_FILES, APPROVALS_PATH]).ok).toBe(false);
    // Presence: the unaltered record stamps.
    expect(into(planPull()).ok).toBe(true);
  });

  it("a dispatch for a cycle already stamped changes nothing", () => {
    const merge = mergeEventFromPull(planPull(), dispatch(), PLAN_FILES);
    if (!merge.ok) throw new Error(merge.reason);
    const first = stampApprovals({}, merge.event, "kingk237");
    if (!first.ok) throw new Error(first.error);
    expect(stampApprovals(first.approvals, merge.event, "kingk237")).toEqual({
      ok: true,
      approvals: first.approvals,
      stamped: [],
    });
  });
});

describe("the workflow's environment selects the path", () => {
  it("no dispatch number means the push of STAMP_PUSH_SHA", () => {
    expect(anchorFromEnv({ STAMP_PUSH_SHA: PLAN_MERGE_SHA })).toEqual({
      ok: true,
      anchor: { kind: "push", sha: PLAN_MERGE_SHA },
    });
    // The workflow passes an empty output on a push.
    expect(
      anchorFromEnv({
        STAMP_PUSH_SHA: PLAN_MERGE_SHA,
        STAMP_DISPATCH_PR: "",
        STAMP_MERGE_ON_BRANCH: "",
      }),
    ).toEqual({ ok: true, anchor: { kind: "push", sha: PLAN_MERGE_SHA } });
  });

  it("a dispatch number means a dispatch; only the exact string true puts the merge on social", () => {
    expect(
      anchorFromEnv({
        STAMP_DISPATCH_PR: "1240",
        STAMP_MERGE_ON_BRANCH: "true",
      }),
    ).toEqual({ ok: true, anchor: dispatch() });
    for (const onBranch of ["false", "", "TRUE", "1", undefined])
      expect(
        anchorFromEnv({
          STAMP_DISPATCH_PR: "1240",
          STAMP_MERGE_ON_BRANCH: onBranch,
        }),
        String(onBranch),
      ).toEqual({ ok: true, anchor: dispatch({ mergeCommitOnBranch: false }) });
  });

  it("a dispatch number that is not a pull request number is refused", () => {
    for (const bad of ["abc", "0", "-3", "12.5"])
      expect(anchorFromEnv({ STAMP_DISPATCH_PR: bad }).ok, bad).toBe(false);
  });
});

describe("a run with nothing to stamp", () => {
  it("a dispatch that cannot stamp fails the run; a push that merged nothing does not", () => {
    expect(
      unstampedOutcome(dispatch(), "pull request #1240 is not merged"),
    ).toEqual({
      exitCode: 1,
      message:
        "stamp-approval: pull request #1240 is not merged; nothing stamped",
    });
    expect(
      unstampedOutcome(PUSHED, "no pull request record for this push"),
    ).toEqual({
      exitCode: 0,
      message:
        "stamp-approval: no pull request record for this push; nothing to stamp",
    });
  });
});
