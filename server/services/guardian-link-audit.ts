/**
 * @spec [Doc-01_V8, §35 Guardian-student linkage — "Additional audit table … captures every
 *        status change for traceability"; owner ruling 2026-08-26 R7 (audit destination is
 *        `audit_logs`)] | @implemented [2026-08-26, extracted 2026-08-27]
 *
 * SCOPE NARROWED 2026-08-28 (adoption plan step 4). This writer now records DENIALS ONLY —
 * `guardian_link_denied`. The three STATE TRANSITIONS moved into the database
 * (migration 20260828000000), where each writes its own audit row inside the same transaction
 * as the status change, because PostgREST gives every request its own transaction and the two
 * writes could never be atomic from here. A denial has no state change to be atomic with, so
 * it stays, and best-effort remains the right posture for it: refusing to answer a caller
 * because the record of their refusal would not write helps nobody.
 *
 * plain English: record a guardian-link event in `audit_logs`. What it does: writes
 * one row naming who acted, who it was about, what happened, and the before/after status.
 * Expected outcome: a durable trail of every link transition, queryable by actor or target.
 * Trade-off: this is best-effort — a failed audit write is logged and does not fail the
 * request, because refusing a successful link because its audit row would not write is the
 * worse outcome. Edge case: `changes` carries only status values and never an email, a code,
 * or any student content (§12.1).
 *
 * REPLACES the `guardian_link_audit` writer `guardian-routes.ts` used to hold. That table does
 * not exist in production (`WS-GL_Stage1_Audit.md` §0), so every one of those inserts failed
 * silently inside its own try/catch. `audit_logs` does exist, is empty, and had no writer at
 * all — owner ruling 2026-08-24 chose it over creating the missing table, since
 * `rate_limit_ledger` already covers the rate-limiting half of what `guardian_link_audit` was
 * doing.
 *
 * WHY THIS IS A MODULE AND NOT A PRIVATE FUNCTION IN `guardian-routes.ts`.
 *   It was private there until the student-side link routes arrived, which need the same
 *   writer. Copying it would have forked the one record of who could see a minor's data —
 *   the duplication CLAUDE.md forbids — and would have made the pending fail-closed change
 *   (adoption plan step 4, owner ruling 2026-08-27 Q5) a two-site edit that could half-land.
 *   Extracted with its behaviour and its trade-off note UNCHANGED, so this move is a pure
 *   relocation and step 4 is the only commit that changes what it does.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";

/**
 * SCL-080 removed "guardian_link_accepted": it was written only by
 * accept_guardian_link_audited, which migration 20260901000000 drops. A one-step link
 * records its consent as "guardian_link_initiated" at creation, so nothing produces the
 * accepted action, and an action no writer emits is a value the reader can only mishandle.
 */
export type GuardianLinkAuditAction =
  | "guardian_link_initiated"
  | "guardian_link_revoked"
  | "guardian_link_denied";

export async function auditGuardianLink(args: {
  action: GuardianLinkAuditAction;
  actorProfileId: string;
  targetProfileId?: string | null;
  changes?: Record<string, unknown>;
  context?: Record<string, unknown>;
  requestId?: string;
}): Promise<void> {
  try {
    const { error } = await supabaseServer.from("audit_logs").insert({
      actor_profile_id: args.actorProfileId,
      target_profile_id: args.targetProfileId ?? null,
      action: args.action,
      changes: args.changes ?? null,
      context: { request_id: args.requestId ?? null, ...(args.context ?? {}) },
    });
    if (error) {
      logger.error("GUARDIAN", "audit_log", "Failed to write audit_logs row", {
        requestId: args.requestId,
        action: args.action,
        reason: error.message,
      });
    }
  } catch (err: unknown) {
    logger.error("GUARDIAN", "audit_log", "Failed to write audit_logs row", {
      requestId: args.requestId,
      action: args.action,
      reason: err instanceof Error ? err.message : "unknown",
    });
  }
}
