/**
 * @spec [Doc 01 V8 §14 Layer 3 audit logging, §12.1 access-metadata only,
 *   Appendix B.7 `audit_logs`; owner rulings 2026-08-26 R7 (link auditing folds
 *   into `audit_logs`; no new table) and 2026-08-27 OQ5 (audit `via='guardian'`
 *   only — self-reads emit nothing)] | @implemented [2026-08-27]
 *
 * plain English: writes one `audit_logs` row per guardian-boundary access
 * decision. Granted or denied — a refused attempt to read a child's data is
 * exactly what an access log exists to reconstruct.
 *
 * WHY NOT `guardian_link_audit`. Because it does not exist. It is named in
 * Doc 01 §35 and listed in §45 for verification, and two code paths write to it
 * (`guardian-routes.ts:131`, `durable-rate-limiter.ts:20,60`), but it is absent
 * from the genesis schema and from production. `audit_logs` is present in both
 * and carries every field this needs.
 *
 * PRIVACY. Access METADATA only (Coding Standards §12.1): who, whose, what
 * surface, what decision. Never student answers, never content, never tokens.
 * `changes` is left NULL — nothing changed; this is a read.
 *
 * Returns `false` rather than throwing so the caller decides the posture. The
 * resolver fails the request closed on `false`; see its comment for why.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import type { GuardianViewDecision } from "../../packages/shared/src/guardian-subject";
import { logger } from "../logger";

export const SUBJECT_ACCESS_ACTION = "guardian_subject_access" as const;

export async function recordSubjectAccess(args: {
  principalId: string;
  studentId: string;
  decision: GuardianViewDecision;
  resource: string;
  requestId?: string;
}): Promise<boolean> {
  const { error } = await supabaseServer.from("audit_logs").insert({
    actor_profile_id: args.principalId,
    target_profile_id: args.studentId,
    action: SUBJECT_ACCESS_ACTION,
    context: {
      decision: args.decision,
      resource: args.resource,
      via: "guardian",
      request_id: args.requestId ?? null,
    },
  });

  if (error) {
    logger.error(
      "GUARDIAN_SUBJECT",
      "access_audit_write_failed",
      "audit_logs insert failed; the caller must fail closed rather than serve an unrecorded access",
      {
        principalId: args.principalId,
        studentId: args.studentId,
        decision: args.decision,
        error: error.message,
        code: error.code,
        requestId: args.requestId,
      },
    );
    return false;
  }

  return true;
}
