import { supabaseServer } from "./supabase-server";

export async function updateStudentStyle(
  userId: string,
  updates: { secondaryStyle?: string; explanationLevel?: number }
): Promise<boolean> {
  const patch: Record<string, any> = {};

  if (typeof updates.secondaryStyle === "string" && updates.secondaryStyle.trim()) {
    patch.secondary_style = updates.secondaryStyle.trim();
  }

  if (
    typeof updates.explanationLevel === "number" &&
    updates.explanationLevel >= 1 &&
    updates.explanationLevel <= 3
  ) {
    patch.explanation_level = updates.explanationLevel;
  }

  if (Object.keys(patch).length === 0) {
    console.log("[profiles] updateStudentStyle skipped - no changes to apply", { userId });
    return false;
  }

  const { error } = await supabaseServer
    .from("profiles")
    .update(patch)
    .eq("id", userId);

  if (error) {
    console.error("[profiles] updateStudentStyle error", { userId, patch, error });
    return false;
  }

  console.log("[profiles] updateStudentStyle applied", { userId, patch });
  return true;
}
