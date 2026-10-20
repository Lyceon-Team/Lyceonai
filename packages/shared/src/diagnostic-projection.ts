/**
 * @spec [SCL-236 (Doc 05C §12A: the stored diagnostic projection), SCL-235 (Doc 02B §12: free
 *        students see only the diagnostic projection; the live projection is Premium-only);
 *        owner rulings 2026-10-16 and 2026-10-17 (D1 = (a), D3 = reuse mastery_detail)]
 *        | @implemented [2026-10-17]
 *
 * plain English: the TypeScript half of the diagnostic projection contract.
 *  - The two statuses a stored diagnostic projection can carry. `insufficient_evidence` is a
 *    stored RESULT (a skipped question left a domain under the Doc 05C evidence gate), not a
 *    missing one: it is the student's diagnostic outcome and it never changes.
 *  - What `complete_diagnostic_session` (the one SQL function that completes a diagnostic)
 *    returns, parsed at the server boundary.
 *  - The ONE feature key that decides who sees the live projection. Every server read that
 *    chooses between the live and the diagnostic projection asks about this key; there is no
 *    second spelling of the rule.
 *
 * edge cases: `projection: "failed"` means the session completed but the stored projection could
 * not be computed in that transaction; diagnostic_projection_repair retries it. `null` is
 * returned with a state other than `completed` (abandoned, or another diagnostic already
 * completed).
 */
import { z } from "zod";
import type { EntitlementFeatureKey } from "./entitlement-denial.js";

export const DIAGNOSTIC_PROJECTION_STATUSES = [
  "computed",
  "insufficient_evidence",
] as const;
export const diagnosticProjectionStatusSchema = z.enum(
  DIAGNOSTIC_PROJECTION_STATUSES,
);
export type DiagnosticProjectionStatus = z.infer<
  typeof diagnosticProjectionStatusSchema
>;

/** `public.complete_diagnostic_session(...)` — its jsonb, exactly. */
export const diagnosticCompletionResultSchema = z.object({
  state: z.enum(["completed", "abandoned", "conflict_other_completed"]),
  completed_now: z.boolean(),
  projection: z
    .enum(["computed", "insufficient_evidence", "failed"])
    .nullable(),
  rows_stored: z.number().int().min(0).optional(),
});
export type DiagnosticCompletionResult = z.infer<
  typeof diagnosticCompletionResultSchema
>;

/**
 * SCL-235 / D3: the live (ongoing) projection is Premium-only, decided by `mastery_detail` — the
 * key `/api/progress/projection` already used for "live progression". A subject who can access
 * it sees the live projection and never the diagnostic number; one who cannot sees the stored
 * diagnostic projection only.
 */
export const LIVE_PROJECTION_FEATURE_KEY =
  "mastery_detail" as const satisfies EntitlementFeatureKey;

/** `public.diagnostic_projection_repair(limit)` — its jsonb, exactly. */
export const diagnosticProjectionRepairResultSchema = z.object({
  examined: z.number().int().min(0),
  rows_stored: z.number().int().min(0),
  failed: z.number().int().min(0),
});
export type DiagnosticProjectionRepairResult = z.infer<
  typeof diagnosticProjectionRepairResultSchema
>;
