/**
 * The email send gate, as every server-side sender calls it.
 *
 * @spec [owner brief "Email send gate" (Karl, 2026-10-30): "emailGate(recipient, category, kind)
 *       → allow | deny(reason). Every governed sender must call it"; owner rulings 2026-11-02;
 *       contracts/notifications.contract.md C15] | @implemented [2026-11-02]
 *
 * plain English: one function, `emailGate`, asks `public.email_gate_decide` whether a recipient
 * may be sent an email of a kind right now. The SQL owns the decision (state, thresholds, the
 * cooling cap, the QOTD exemption, milestones); this module only parses its answer. Always and
 * notice kinds are answered here without a round trip, because nothing can block them.
 *
 * trade-offs: a read failure is an error the caller must handle, never an "allow": a sender that
 * cannot ask the gate defers or releases, so a database blip cannot turn into an email to a
 * student who asked for silence.
 */
import { err, ok, type Result } from "../../../packages/shared/src/result";
import {
  emailCategoryOf,
  emailGateDecisionSchema,
  isGatedEmailKind,
  type EmailGateDecision,
  type EmailKind,
} from "../../../packages/shared/src/email-gate";
import type { RpcClient } from "../rpc-client";

export async function emailGate(
  db: RpcClient,
  recipientProfileId: string,
  kind: EmailKind,
  now: Date,
): Promise<Result<EmailGateDecision, string>> {
  if (!isGatedEmailKind(kind)) {
    return ok({ allow: true, reason: emailCategoryOf(kind), state: null });
  }
  const { data, error } = await db.rpc("email_gate_decide", {
    p_profile_id: recipientProfileId,
    p_kind: kind,
    p_now: now.toISOString(),
  });
  if (error) {
    return err(`email_gate_decide failed: ${error.message}`);
  }
  const parsed = emailGateDecisionSchema.safeParse(data);
  if (!parsed.success) {
    return err("email_gate_decide returned a malformed decision");
  }
  return ok(parsed.data);
}
