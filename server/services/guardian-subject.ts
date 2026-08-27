/**
 * @spec [Doc 01 V8 §35/§38.1; Doc 05B §10.1 absence-of-policy denial, §10.3
 *   path-layer authorization; owner ruling 2026-08-26 R6 — "the resolver CALLS
 *   `guardian_can_view_student`, it does not reimplement it"]
 * | @implemented [2026-08-27]
 *
 * plain English: the ONE application entry point to the guardian-visibility
 * derivation. It calls `public.guardian_view_decision(guardian, student)` and
 * returns what the database said. It contains no rule of its own.
 *
 * WHY THIS FILE IS THIN ON PURPOSE.
 *   The gate already existed in the database, correct, as
 *   `guardian_can_view_student(uuid)` — and had ZERO application callers, because
 *   it reads `auth.uid()` and the application connects with the service role,
 *   where `auth.uid()` is NULL. So the rule was reimplemented in TypeScript
 *   against `guardian_links.student_user_id` and `linked_at`, columns that exist
 *   in no spec, no genesis schema, and no production table. The result was not a
 *   subtly wrong gate — it was an unrunnable one: `createGuardianLink` failed on
 *   its first SELECT, which is why `guardian_links` has never held a row.
 *
 *   The migration 20260827000000 moved the body into
 *   `guardian_view_decision(guardian, student)` and left the RLS-facing one-arg
 *   form as a delegation, so the application can pass the principal explicitly.
 *   Anything this file decided for itself would be a second derivation.
 *
 * FAIL-CLOSED, TWICE OVER. An RPC error returns `not_linked`, and a value the
 * shared enum does not recognise also returns `not_linked`. A gate that cannot
 * establish permission has not granted it.
 */
import {
  guardianViewDecisionSchema,
  type GuardianViewDecision,
} from "../../packages/shared/src/guardian-subject";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";

export async function resolveGuardianViewDecision(
  guardianProfileId: string,
  studentProfileId: string,
  requestId?: string,
): Promise<GuardianViewDecision> {
  if (!guardianProfileId || !studentProfileId) {
    return "not_linked";
  }

  const { data, error } = await supabaseServer.rpc("guardian_view_decision", {
    p_guardian_id: guardianProfileId,
    p_student_id: studentProfileId,
  });

  if (error) {
    logger.error(
      "GUARDIAN_SUBJECT",
      "decision_rpc_failed",
      "guardian_view_decision RPC failed; failing closed",
      {
        guardianProfileId,
        studentProfileId,
        error: error.message,
        code: error.code,
        requestId,
      },
    );
    return "not_linked";
  }

  const parsed = guardianViewDecisionSchema.safeParse(data);
  if (!parsed.success) {
    // The database returned something this build does not know how to act on.
    // Treating it as a denial is the safe direction, but it must be LOUD: a new
    // CASE arm in the SQL that nobody wired here would otherwise present as a
    // silent, permanent denial for whichever situation it describes.
    logger.error(
      "GUARDIAN_SUBJECT",
      "decision_unrecognised",
      "guardian_view_decision returned a value this build does not recognise; failing closed",
      { guardianProfileId, studentProfileId, received: data, requestId },
    );
    return "not_linked";
  }

  return parsed.data;
}
