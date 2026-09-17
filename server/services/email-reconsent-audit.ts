/**
 * @spec [Doc 01 V8 §14 Layer 3 audit logging, §12.1 access-metadata only, Appendix B.7
 *   `audit_logs`; owner ruling 2026-08-26 R7 (audit events fold into `audit_logs`; no new
 *   table); SCL-090 PROPOSED as ruled 2026-09-17 ("log the clearing as affirmative
 *   re-consent"); contracts/notifications.contract.md §11A.6] | @implemented [2026-09-17]
 *
 * plain English: writes the one `audit_logs` row that records a subject lifting their own
 * do-not-contact request. A do-not-contact request is a stated wish about a person's personal
 * data; withdrawing it is a second stated wish, and the only durable evidence that the
 * withdrawal came from the subject rather than from an operator or a script is this row.
 *
 * WHY A MODULE AND NOT FOUR LINES IN THE ROUTE. Because `audit_logs` already has exactly this
 * shape twice — `auditGuardianLink` and `recordSubjectAccess` — and Coding Standards §8.1 keeps
 * business logic out of handlers while §2 keeps DB access in centralized utilities. A third,
 * inlined writer would be the start of divergence in how this table gets written.
 *
 * WHY actor AND target ARE BOTH THE SUBJECT. Unlike a guardian-boundary access, this is somebody
 * acting on their own account: they are both who did it and whose data it concerns.
 *
 * PRIVACY. Metadata only (Coding Standards §12.1): that it happened, where from, and what kind of
 * suppression it lifted. Never the address — the subject's own live profile already holds it, and
 * an append-only audit table that cannot be corrected is the wrong place to copy it to.
 *
 * Returns `false` rather than throwing so the caller decides the posture. The clear route keeps
 * its 200: the suppression IS lifted by then, and reporting failure would invite a second click
 * on an action that already succeeded. It pages instead.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import type { SuppressionOrigin } from "../lib/notifications/transport";

export const EMAIL_RECONSENT_ACTION = "email_suppression_cleared" as const;

export async function recordEmailReconsent(args: {
  profileId: string;
  previousOrigin: SuppressionOrigin;
  requestId?: string;
}): Promise<boolean> {
  const { error } = await supabaseServer.from("audit_logs").insert({
    actor_profile_id: args.profileId,
    target_profile_id: args.profileId,
    action: EMAIL_RECONSENT_ACTION,
    context: {
      source: "account_settings",
      previous_origin: args.previousOrigin,
      request_id: args.requestId ?? null,
    },
  });

  if (error) {
    logger.error(
      "ACCOUNT",
      "email_reconsent_audit_failed",
      "Suppression cleared but the re-consent audit row did not write",
      undefined,
      {
        userId: args.profileId,
        code: error.code,
        message: error.message,
        requestId: args.requestId,
      },
    );
    return false;
  }

  logger.info(
    "ACCOUNT",
    "email_reconsent_recorded",
    "Subject lifted their own do-not-contact request",
    { userId: args.profileId, requestId: args.requestId },
  );
  return true;
}
