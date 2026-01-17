import { supabaseServer } from "./supabase-server";

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
      message: params.message,
      answer: params.answer,
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
