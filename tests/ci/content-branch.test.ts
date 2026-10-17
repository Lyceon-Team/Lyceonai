/**
 * Content PRs go into `social`, never `seo` (owner brief "Doc 10B pipeline — move content to the
 * social branch", Karl, 2026-10-11).
 *
 * @spec [owner brief 2026-10-11 items 1-2, 5 ("update any test that pins seo as the base; add a
 *       planted defect showing a PR into seo with batch content does not satisfy the pipeline
 *       checks"); docs/Spec/Lyceon_Doc_10B.md §8.7] | @implemented [2026-10-11]
 *
 * plain English: the three content workflows trigger on base CONTENT_BRANCH and nothing else
 * (GitHub's own branch filter, evaluated here on the real workflow files: a PR into social runs
 * the review-record check and one into seo does not); the approval stamp checks out and pushes to
 * that branch, with the workflow's own token (Karl's ruling, 2026-10-11, restated 2026-10-15: no
 * GitHub App), on the merge's push or on Karl's dispatch for a past merge; and the PR check itself refuses a cycle aimed at any other base, so a content PR
 * into seo can never pass the pipeline's checks even if a trigger is widened later.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { CONTENT_BRANCH } from "../../shared/content/approvals";
import { baseBranchProblem } from "../../scripts/content/check-batch-pr";
import { REPO_ROOT } from "../lib/prerendered-site";

type Step = {
  name?: string;
  uses?: string;
  with?: Record<string, string | number>;
  env?: Record<string, string>;
  run?: string;
};
type Workflow = {
  on: {
    pull_request?: { types: string[]; branches: string[] };
    push?: { branches: string[]; paths?: string[] };
    workflow_dispatch?: {
      inputs?: Record<string, { required?: boolean; description?: string }>;
    };
  };
  permissions?: Record<string, string>;
  jobs: Record<string, { steps: Step[]; environment?: string; if?: string }>;
};

function workflow(file: string): Workflow {
  return parseYaml(
    readFileSync(join(REPO_ROOT, ".github/workflows", file), "utf8"),
  ) as Workflow;
}

/** The pull-request-triggered content workflows (the approval stamp runs on the merge's push). */
const CONTENT_WORKFLOWS = [
  "content-batch-checks.yml",
  "content-batch-notify.yml",
];

/** GitHub's `branches:` filter for pull_request: the event runs when the base matches. */
function runsOn(wf: Workflow, base: string): boolean {
  return wf.on.pull_request?.branches.includes(base) ?? false;
}

describe("the content workflows run on PRs into social only", () => {
  it.each(CONTENT_WORKFLOWS)("%s filters on base social", (file) => {
    expect(CONTENT_BRANCH).toBe("social");
    expect(workflow(file).on.pull_request?.branches).toEqual([CONTENT_BRANCH]);
  });

  it("a batch PR into social triggers the review-record check; the same into seo does not", () => {
    const checks = workflow("content-batch-checks.yml");
    expect(runsOn(checks, "social")).toBe(true);
    expect(runsOn(checks, "seo")).toBe(false);
    expect(Object.keys(checks.jobs)).toEqual(["review-record"]);
  });

  it("the review-record check is told the base, so it can refuse any other", () => {
    const step = workflow("content-batch-checks.yml").jobs[
      "review-record"
    ]?.steps.find((s) => s.run?.includes("check-batch-pr.ts"));
    expect(step?.env?.BASE_REF).toBe(
      "${{ github.event.pull_request.base.ref }}",
    );
  });

  it("the approval stamp runs on a push to social or Karl's dispatch, only on social, with no Environment", () => {
    const wf = workflow("content-batch-approval.yml");
    expect(wf.on.pull_request).toBeUndefined();
    expect(wf.on.push?.branches).toEqual([CONTENT_BRANCH]);
    expect(wf.on.workflow_dispatch?.inputs?.["pr_number"]?.required).toBe(true);
    // A dispatch from another branch is refused before any step runs.
    expect(wf.jobs["stamp"]?.if).toBe("github.ref == 'refs/heads/social'");
    expect(wf.jobs["stamp"]?.environment).toBeUndefined();
    // The workflow's own token writes the stamp (the ruleset on social blocks only deletion
    // and force pushes).
    expect(wf.permissions).toEqual({
      contents: "write",
      "pull-requests": "read",
    });
  });

  it("the merge is read from GitHub's record and must be this push's merge commit", () => {
    const steps =
      workflow("content-batch-approval.yml").jobs["stamp"]?.steps ?? [];
    const find = steps.find((s) => s.run?.includes("/commits/"))?.run ?? "";
    expect(find).toContain("repos/${GITHUB_REPOSITORY}/commits/${SHA}/pulls");
    expect(find).toContain('.merge_commit_sha == \\"${SHA}\\"');
    expect(
      steps.find((s) => s.run?.includes("stamp-approval.ts"))?.env
        ?.STAMP_PUSH_SHA,
    ).toBe("${{ github.sha }}");
  });

  it("the stamp is pushed to social with the workflow token: no App, no key", () => {
    const steps =
      workflow("content-batch-approval.yml").jobs["stamp"]?.steps ?? [];
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.uses ?? "", step.name).not.toMatch(/create-github-app-token/);
      expect(JSON.stringify(step).includes("secrets."), step.name).toBe(false);
    }
    // No token override: checkout persists GITHUB_TOKEN, which the push then uses. Full
    // history, so a dispatch can check its merge commit is on social.
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(checkout?.with).toEqual({ ref: CONTENT_BRANCH, "fetch-depth": 0 });
    const push = steps.find((s) => s.run?.includes("git push"))?.run ?? "";
    expect(push).toContain("git push origin HEAD:social");
    expect(push).not.toMatch(/\bseo\b/);
  });

  it("a dispatch reads only the requested pull request, validates the number, and checks its merge commit is on social", () => {
    const steps =
      workflow("content-batch-approval.yml").jobs["stamp"]?.steps ?? [];
    const dispatched = steps.find(
      (s) => s.env?.PR_NUMBER === "${{ inputs.pr_number }}",
    );
    const run = dispatched?.run ?? "";
    // The input reaches the shell as an environment variable, never interpolated into it.
    for (const step of steps)
      expect(step.run ?? "", step.name).not.toContain("${{ inputs.");
    expect(run).toContain('[[ "$PR_NUMBER" =~ ^[1-9][0-9]{0,6}$ ]]');
    expect(run).toContain(
      'gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}"',
    );
    expect(run).toContain('git merge-base --is-ancestor "$merge_sha" HEAD');
    const stamp = steps.find((s) => s.run?.includes("stamp-approval.ts"));
    expect(stamp?.env?.STAMP_DISPATCH_PR).toBe(
      "${{ steps.dispatched.outputs.number }}",
    );
    expect(stamp?.env?.STAMP_MERGE_ON_BRANCH).toBe(
      "${{ steps.dispatched.outputs.on_branch }}",
    );
  });
});

describe("the PR check refuses content aimed at any base but social", () => {
  it("a batch PR into seo fails; the same into social passes; no content passes anywhere", () => {
    expect(baseBranchProblem("seo", ["2026-W45"])).toBe(
      "this pull request carries content (2026-W45) into seo; batch and plan pull requests go into social",
    );
    expect(baseBranchProblem("main", ["2026-11-plan"])).toMatch(/into main/);
    expect(baseBranchProblem("social", ["2026-W45"])).toBe(null);
    expect(baseBranchProblem("seo", [])).toBe(null);
  });
});
