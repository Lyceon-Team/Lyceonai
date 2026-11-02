/**
 * What the email send gate's two pause emails need at send time: the recipient's signed Keep me
 * posted link, and a re-check that the pause still stands.
 *
 * @spec [owner brief "Email send gate" (Karl, 2026-10-30): the sunset note "once per episode",
 *       the parent email "once per episode"; the review ask's send-context pattern
 *       (review-ask-send-context.ts)] | @implemented [2026-11-02]
 *
 * plain English: a pause email is emitted the moment the pause begins and may wait out quiet
 * hours. If the student studied (or someone tapped Keep me posted) in between, "we're pausing"
 * would be false, so the email is withdrawn (failed at once, never retried). The link is built
 * here, from the shared signing primitive, and never stored.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { err, ok, type Result } from "../../../packages/shared/src/result";
import {
  emailGateGuardianPausedPayloadSchema,
  emailGatePausedNoticePayloadSchema,
} from "../../../packages/shared/src/notifications-schema";
import { emailKeepPostedUrl } from "../../services/qotd/qotd-email-links";
import type { RenderContext } from "./templates";

const stateRowSchema = z.array(
  z.object({ state: z.string(), pause_episode: z.number().int() }),
);
const pauseRowSchema = z.array(z.object({ resumed_at: z.string().nullable() }));

export async function emailGateSendContext(
  eventType: "email_gate_paused_notice" | "email_gate_guardian_paused",
  payload: unknown,
  subjectProfileId: string,
  recipientProfileId: string,
  siteUrl: string,
): Promise<
  Result<
    NonNullable<RenderContext["emailGate"]>,
    { reason: string; final: boolean }
  >
> {
  try {
    if (eventType === "email_gate_paused_notice") {
      const p = emailGatePausedNoticePayloadSchema.parse(payload);
      const { data, error } = await supabaseServer
        .from("email_gate_state")
        .select("state, pause_episode")
        .eq("profile_id", recipientProfileId)
        .limit(1);
      if (error)
        throw new Error(`email_gate_state read failed: ${error.message}`);
      const row = stateRowSchema.parse(data)[0];
      if (!row || row.state !== "paused" || row.pause_episode !== p.episode) {
        return err({
          reason:
            "email_gate: the pause ended before the note was sent (withdrawn, not sent)",
          final: true,
        });
      }
    } else {
      const p = emailGateGuardianPausedPayloadSchema.parse(payload);
      const { data, error } = await supabaseServer
        .from("email_gate_guardian_pauses")
        .select("resumed_at")
        .eq("guardian_id", recipientProfileId)
        .eq("student_id", subjectProfileId)
        .eq("episode", p.episode)
        .limit(1);
      if (error)
        throw new Error(
          `email_gate_guardian_pauses read failed: ${error.message}`,
        );
      const row = pauseRowSchema.parse(data)[0];
      if (!row || row.resumed_at !== null) {
        return err({
          reason:
            "email_gate: the digest pause ended before the email was sent (withdrawn, not sent)",
          final: true,
        });
      }
    }
    return ok({
      keepPostedUrl: emailKeepPostedUrl(siteUrl, recipientProfileId),
    });
  } catch (error) {
    return err({
      reason: `email_gate send context failed: ${error instanceof Error ? error.message : "unknown"}`,
      final: false,
    });
  }
}
