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
 * dueExamples is the day's selection: post_on is today (America/Chicago), not retired, not already
 * in the posted ledger. Approval is checked after it, per example, and an unapproved example is
 * never rendered.
 */
import {
  workedExampleId,
  type WorkedExampleContent,
  type WorkedExamplePostedLedger,
} from "../../packages/shared/src/worked-example-schema";
import { CONTENT_BRANCH } from "../../shared/content/approvals";
import { mergeEventFromPull } from "../content/stamp-approval";

export type ExampleApproval = {
  pr: number;
  mergedBy: string;
  mergeSha: string;
  mergedAt: string;
};

/**
 * The approval of an example whose folder was last changed by `folderCommit` on `social`, from
 * GitHub's record of the pull request that commit belongs to (null when it belongs to none).
 */
export function approvalFromRecord(
  pull: unknown,
  folderCommit: string,
  approverLogin: string | undefined,
): { ok: true; approval: ExampleApproval } | { ok: false; reason: string } {
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
  if (event.base !== CONTENT_BRANCH)
    return {
      ok: false,
      reason: `pull request #${event.pr} was merged into ${event.base}, not ${CONTENT_BRANCH}`,
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
