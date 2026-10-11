/**
 * Karl's approval of each content cycle, as recorded from the merge of its batch pull request.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §2.4 ("Karl's approval is a merge of the batch pull
 *       request. Nothing reaches the public without it"), §8.7 ("Triggers never merge"); owner
 *       answer on Doc 10B Phase 1 Step 0, item 1 (Karl, 2026-10-11): "merge alone counts. Record
 *       it with the fewest moving parts (e.g. a plain workflow script stamps the approval from the
 *       merge event) … No extra click."] | @implemented [2026-10-11]
 *
 * plain English: `content/batches/approvals.json` maps a cycle (`2026-W43`, `2026-11-plan`) to the
 * merge that approved it. Its ONE writer is the `content-batch-approval` workflow
 * (.github/workflows/content-batch-approval.yml → scripts/content/stamp-approval.ts), which runs
 * when a batch pull request into `seo` is merged by Karl and commits the stamp. No person and no
 * agent edits the file: the `content-approvals-guard` step fails any pull request that touches it.
 * A post in a cycle is approved exactly when its cycle has a stamp here.
 *
 * edge cases: the file starts as `{}`. A cycle stamped twice (a re-run) keeps its first stamp.
 */
import { z } from "zod";
import approvalsJson from "../../content/batches/approvals.json";

/** A content cycle: an ISO week (`2026-W43`) or a monthly plan (`2026-11-plan`). */
export const contentCycleSchema = z
  .string()
  .regex(/^\d{4}-(W(0[1-9]|[1-4]\d|5[0-3])|(0[1-9]|1[0-2])-plan)$/);
export type ContentCycle = z.infer<typeof contentCycleSchema>;

export const cycleApprovalSchema = z
  .object({
    by: z.literal("Karl"),
    /** The merge date, America/Chicago (YYYY-MM-DD). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pr: z.number().int().positive(),
    mergedBy: z.string().min(1),
    mergeSha: z.string().regex(/^[0-9a-f]{40}$/),
  })
  .strict();
export type CycleApproval = z.infer<typeof cycleApprovalSchema>;

export const approvalsFileSchema = z.record(
  contentCycleSchema,
  cycleApprovalSchema,
);
export type ApprovalsFile = z.infer<typeof approvalsFileSchema>;

/** Parsed at load: a malformed stamp fails the build rather than approving anything. */
export const CYCLE_APPROVALS: Readonly<ApprovalsFile> = Object.freeze(
  approvalsFileSchema.parse(approvalsJson),
);

/** Karl's approval of a cycle, in the content schema's `{ by, date }` shape, or undefined. */
export function approvalFor(
  cycle: string,
  approvals: Readonly<ApprovalsFile> = CYCLE_APPROVALS,
): { by: "Karl"; date: string } | undefined {
  const stamp = approvals[cycle];
  return stamp ? { by: stamp.by, date: stamp.date } : undefined;
}
