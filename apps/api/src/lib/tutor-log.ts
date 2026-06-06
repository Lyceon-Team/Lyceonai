import { supabaseServer } from "./supabase-server";

/**
 * @spec [Privacy_Policy_V1.0, §3.4] [Coding_Standards, §12.2]
 * @implemented [2026-06-06]
 *
 * Verbatim tutor message/answer persistence is being eliminated per
 * Privacy Policy V1.0 §3.4 (tutor conversations are ephemeral and
 * non-verbatim).
 *
 * STATE: Stop-the-bleed feature flag in place. Defaults to `false` in
 * production. The `tutor-runtime` Wave 2 unit owns the proper replacement
 * (non-verbatim summarization + structured metadata + Doc 03 §14.2
 * retention).
 *
 * DO NOT flip TUTOR_VERBATIM_PERSIST=true in any environment without
 * Founder + CTO sign-off. This flag exists ONLY to support the transition
 * to the tutor-runtime unit's design; it is not a configuration toggle.
 *
 * Tracked: docs/alignment/KNOWN-GAPS.md → TUTOR-VERBATIM-PERSIST
 * Owner: tutor-runtime unit (Wave 2 P0)
 * Blocks: Privacy Policy V1.0 bundle publication (RP-LC-04)
 */
const TUTOR_VERBATIM_PERSIST = process.env.TUTOR_VERBATIM_PERSIST === 'true';

export async function logTutorInteraction(params: {
  userId: string;
  mode: string;
  canonicalIdsUsed: string[];
  primaryStyle?: string | null;
  secondaryStyle?: string | null;
  explanationLevel?: number | null;
  message: string;
  answer: string;
}): Promise<boolean> {
  const { error } = await supabaseServer
    .from("tutor_interactions")
    .insert({
      user_id: params.userId,
      mode: params.mode,
      canonical_ids_used: params.canonicalIdsUsed,
      primary_style: params.primaryStyle,
      secondary_style: params.secondaryStyle,
      explanation_level: params.explanationLevel,
      // Privacy Policy V1.0 §3.4 + Coding Standards §12.2: ephemeral, non-verbatim.
      // Verbatim persistence is gated until tutor-runtime unit ships the
      // replacement. See KNOWN-GAPS.md → TUTOR-VERBATIM-PERSIST.
      message: TUTOR_VERBATIM_PERSIST ? params.message : null,
      answer: TUTOR_VERBATIM_PERSIST ? params.answer : null,
    });

  if (error) {
    console.error("[tutor_interactions] insert error", { userId: params.userId, mode: params.mode, error });
    return false;
  }

  console.log("[tutor_interactions] logged", {
    userId: params.userId,
    mode: params.mode,
    canonicalIdsUsed: params.canonicalIdsUsed,
  });
  return true;
}
