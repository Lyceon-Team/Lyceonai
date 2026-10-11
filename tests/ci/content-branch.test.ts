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
 * that branch; and the PR check itself refuses a cycle aimed at any other base, so a content PR
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
  with?: Record<string, string>;
  env?: Record<string, string>;
  run?: string;
};
type Workflow = {
  on: { pull_request: { types: string[]; branches: string[] } };
  jobs: Record<string, { steps: Step[] }>;
};

function workflow(file: string): Workflow {
  return parseYaml(
    readFileSync(join(REPO_ROOT, ".github/workflows", file), "utf8"),
  ) as Workflow;
}

const CONTENT_WORKFLOWS = [
  "content-batch-checks.yml",
  "content-batch-notify.yml",
  "content-batch-approval.yml",
];

/** GitHub's `branches:` filter for pull_request: the event runs when the base matches. */
function runsOn(wf: Workflow, base: string): boolean {
  return wf.on.pull_request.branches.includes(base);
}

describe("the content workflows run on PRs into social only", () => {
  it.each(CONTENT_WORKFLOWS)("%s filters on base social", (file) => {
    expect(CONTENT_BRANCH).toBe("social");
    expect(workflow(file).on.pull_request.branches).toEqual([CONTENT_BRANCH]);
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

  it("the approval stamp checks out social, is told the base, and pushes the stamp to social", () => {
    const steps =
      workflow("content-batch-approval.yml").jobs["stamp"]?.steps ?? [];
    expect(
      steps.find((s) => s.uses?.startsWith("actions/checkout"))?.with?.ref,
    ).toBe(CONTENT_BRANCH);
    expect(
      steps.find((s) => s.run?.includes("stamp-approval.ts"))?.env?.STAMP_BASE,
    ).toBe("${{ github.event.pull_request.base.ref }}");
    const push = steps.find((s) => s.run?.includes("git push"))?.run ?? "";
    expect(push).toContain("git push origin HEAD:social");
    expect(push).not.toMatch(/\bseo\b/);
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
