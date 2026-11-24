/**
 * Which worked examples are approved, and which are due today.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): "weekly batch PR (3
 *       examples; Codex audits the maths and hook rules; Karl merges)", "a daily job at 17:00 UTC
 *       renders any approved example with post_on = today and posts it … once", acceptance "the
 *       daily job posts only approved, post_on-today examples, once"; docs/Spec/Lyceon_Doc_10B.md
 *       §2.4 ("Karl's approval is a merge of the batch pull request") and Karl's answer on its
 *       Step 0 item 1 (2026-10-11): "merge alone counts"] | @implemented [2026-10-27]
 *
 * plain English: an example is approved when the commit that last changed its folder on `social`
 * (following first parents, so it is the merge itself) is the merge commit of a pull request into
 * `social` that Karl merged, read from GitHub's own record of that pull request. The record is
 * parsed by the same function that stamps blog cycles (mergeEventFromPull). Any later change to the
 * folder that is not Karl's merge makes it unapproved until he merges again: approval belongs to
 * the exact content he merged. A weekly worked-example batch does not use the blog's cycle stamps
 * in content/batches/approvals.json, because a week's blog batch and its worked-example batch
 * share a cycle name and a cycle keeps its first stamp.
 *
 * FROM 2026-11-24 (Karl's ruling "Worked examples: drop the merge gate", SCL-288): a scheduled
 * Claude task writes next week's examples on Thursday morning and pushes them straight to `social`
 * with the trailer `Authored-By: worked-examples-task`. An example whose folder commit carries that
 * trailer is approved by the task (approvalFromTrailer), recorded as "worked-examples-task" with
 * the commit and its date; Karl reviews when he posts from Slack. Karl's merge still approves
 * (approvalFromRecord). Either way the weekly job then runs every pull-request check on the example
 * and writes its approved row, whose database trigger is the anti-leak half (weekly-admit.ts).
 * This supersedes Doc 10B principle 4 ("Karl's approval is a merge of the batch pull request") for
 * worked examples, by the owner's ruling recorded in SCL-288; folding it into Doc 10B is Karl's.
 *
 * dueExamples is the day's selection: post_on is today (America/Chicago), not retired, not already
 * in the posted ledger. Approval is checked after it, per example, and an unapproved example is
 * never rendered.
 */
import {
  WORKED_EXAMPLES_TASK,
  workedExampleId,
  type WorkedExampleApproval,
  type WorkedExampleContent,
  type WorkedExampleMergeApproval,
  type WorkedExamplePostedLedger,
  type WorkedExampleTaskApproval,
} from "../../packages/shared/src/worked-example-schema";
import { CONTENT_BRANCH } from "../../shared/content/approvals";
import { mergeEventFromPull } from "../content/stamp-approval";

/** Karl's merge (the QOTD breakdowns' only kind of approval). */
export type MergeApproval = WorkedExampleMergeApproval;
/** Either kind: Karl's merge, or the scheduled task's trailer commit (SCL-288). */
export type ExampleApproval = WorkedExampleApproval;

/** The trailer key and the one value that approves (Karl, 2026-11-24). */
export const AUTHORED_BY_TRAILER = "Authored-By";

/** What the approval reads of the commit that last changed an example's folder on `social`. */
export type FolderCommitRecord = {
  sha: string;
  /** The commit date, ISO 8601. */
  committedAt: string;
  /** Every `Authored-By:` trailer value on the commit message. */
  authoredBy: readonly string[];
};

/**
 * The scheduled task's approval: the folder commit carries `Authored-By: worked-examples-task`.
 * Any other value, or none, approves nothing here (the merge path may still approve).
 */
export function approvalFromTrailer(
  commit: FolderCommitRecord,
):
  | { ok: true; approval: WorkedExampleTaskApproval }
  | { ok: false; reason: string } {
  if (!commit.authoredBy.includes(WORKED_EXAMPLES_TASK))
    return {
      ok: false,
      reason: `${commit.sha.slice(0, 7)} carries no "${AUTHORED_BY_TRAILER}: ${WORKED_EXAMPLES_TASK}" trailer`,
    };
  return {
    ok: true,
    approval: {
      by: WORKED_EXAMPLES_TASK,
      sha: commit.sha,
      at: commit.committedAt,
    },
  };
}

/**
 * The approval of an example from its folder commit: the task's trailer, else Karl's merge read
 * from GitHub's record (`pullFor` is only asked when there is no trailer). Refused when neither.
 */
export async function approvalForCommit(
  commit: FolderCommitRecord,
  pullFor: (sha: string) => Promise<unknown>,
  approverLogin: string | undefined,
): Promise<
  { ok: true; approval: ExampleApproval } | { ok: false; reason: string }
> {
  const task = approvalFromTrailer(commit);
  if (task.ok) return task;
  const merge = approvalFromRecord(
    await pullFor(commit.sha),
    commit.sha,
    approverLogin,
  );
  if (merge.ok) return merge;
  return { ok: false, reason: `${task.reason}, and ${merge.reason}` };
}

/**
 * The approval of an example whose folder was last changed by `folderCommit` on `social`, from
 * GitHub's record of the pull request that commit belongs to (null when it belongs to none).
 * `branch` is the branch whose merge approves: `social` for the worked examples; the QOTD
 * breakdowns pass their private repo's `main` (Karl, 2026-11-03).
 */
export function approvalFromRecord(
  pull: unknown,
  folderCommit: string,
  approverLogin: string | undefined,
  branch: string = CONTENT_BRANCH,
): { ok: true; approval: MergeApproval } | { ok: false; reason: string } {
  if (!approverLogin)
    return { ok: false, reason: "CONTENT_APPROVER_LOGIN is not set" };
  if (pull === null)
    return {
      ok: false,
      reason: `${folderCommit.slice(0, 7)} belongs to no pull request (a direct push approves nothing)`,
    };
  const merge = mergeEventFromPull(
    pull,
    { kind: "push", sha: folderCommit },
    [],
  );
  if (!merge.ok) return { ok: false, reason: merge.reason };
  const { event } = merge;
  if (event.base !== branch)
    return {
      ok: false,
      reason: `pull request #${event.pr} was merged into ${event.base}, not ${branch}`,
    };
  if (event.mergedBy !== approverLogin)
    return {
      ok: false,
      reason: `pull request #${event.pr} was merged by ${event.mergedBy}, not the approver`,
    };
  return {
    ok: true,
    approval: {
      pr: event.pr,
      mergedBy: event.mergedBy,
      mergeSha: event.mergeSha,
      mergedAt: event.mergedAt,
    },
  };
}

export type ExampleOnBranch = {
  /** content/worked-examples/<cycle>/<question_id> */
  dir: string;
  cycle: string;
  content: WorkedExampleContent;
};

/** The examples to post today: post_on is today, not retired, not posted before. */
export function dueExamples(
  examples: readonly ExampleOnBranch[],
  today: string,
  posted: Readonly<WorkedExamplePostedLedger>,
): ExampleOnBranch[] {
  return examples
    .filter(
      (e) =>
        e.content.post_on === today &&
        e.content.retired !== true &&
        posted[workedExampleId(e.content.question_id)] === undefined,
    )
    .sort((a, b) => a.content.question_id.localeCompare(b.content.question_id));
}

/** The ledger after posting `id` today in `run`; refuses an id already present (posted once). */
export function recordPosted(
  posted: Readonly<WorkedExamplePostedLedger>,
  id: string,
  today: string,
  run: string,
):
  | { ok: true; ledger: WorkedExamplePostedLedger }
  | { ok: false; reason: string } {
  if (posted[id] !== undefined)
    return {
      ok: false,
      reason: `${id} was already posted on ${posted[id]?.date}`,
    };
  const ledger: WorkedExamplePostedLedger = {
    ...posted,
    [id]: { date: today, run },
  };
  return {
    ok: true,
    ledger: Object.fromEntries(
      Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
