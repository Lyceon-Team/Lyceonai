/**
 * The review case's Layer 2 failure reason: a separate module from tutor-crisis.ts, so the route's
 * crisis path (and every test that replaces tutor-crisis wholesale) is unchanged.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import type { Layer2Outcome } from "./tutor-crisis";

/**
 * @spec [owner brief "Crisis classifier: record the failure reason, and look at the timeout",
 *       Karl 2026-11-08; SCL-276] | @implemented [2026-11-08]
 * plain English: puts Layer 2's failure reason and attempt count on the review case the flag
 * write just returned, so the queue says why the classifier could not answer long after the logs
 * expire. Codes only.
 *  - Only a degraded case (`classifier_degraded`, `classifier_degraded_no_floor`) with no reason
 *    yet is written: the first degraded signal on a case keeps its reason, and a case opened by a
 *    signature or the model is never given one.
 *  - NOT blocking, and deliberately outside the flag transaction: the case and the flag are
 *    already committed (the fail-closed path is exactly as before). A failed write is logged at
 *    ERROR with the ids and codes; the turn proceeds unchanged.
 *  - No reason to record (Layer 2 answered, or was not measured): no write.
 */
export async function recordDegradedReason(
  caseId: string,
  layer2: Layer2Outcome | undefined,
): Promise<void> {
  if (layer2 === undefined || layer2.degradedReason === null) return;
  const error = await supabaseServer
    .from("crisis_review_cases")
    .update({
      degraded_reason: layer2.degradedReason,
      classifier_attempts: layer2.attempts,
    })
    .eq("id", caseId)
    .in("source", ["classifier_degraded", "classifier_degraded_no_floor"])
    .is("degraded_reason", null)
    .then(
      (r: { error: unknown }) => r.error,
      (thrown: unknown) => thrown,
    );
  if (error) {
    logger.error(
      "TUTOR_CRISIS",
      "crisis_degraded_reason_write_failed",
      "could not record the Layer 2 failure reason on the review case; the case stands and the turn proceeds",
      error instanceof Error ? error : undefined,
      {
        caseId,
        degradedReason: layer2.degradedReason,
        attempts: layer2.attempts,
      },
    );
  }
}
