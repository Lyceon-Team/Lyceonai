import { supabaseServer } from "./supabase-server";
import { logger } from "../../../../server/logger";

type StudentStylePatch = {
  secondary_style?: string;
  explanation_level?: number;
};

export async function updateStudentStyle(
  userId: string,
  updates: { secondaryStyle?: string; explanationLevel?: number }
): Promise<boolean> {
  const patch: StudentStylePatch = {};

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

  // Field NAMES only in logs; the values are student preferences.
  const fields = Object.keys(patch);

  if (fields.length === 0) {
    logger.info(
      "PROFILES",
      "update_student_style",
      "updateStudentStyle skipped - no changes to apply",
      undefined,
      { userId },
    );
    return false;
  }

  const { error } = await supabaseServer
    .from("profiles")
    .update(patch)
    .eq("id", userId);

  if (error) {
    logger.error(
      "PROFILES",
      "update_student_style",
      "updateStudentStyle error",
      error,
      { fields },
      { userId },
    );
    return false;
  }

  logger.info(
    "PROFILES",
    "update_student_style",
    "updateStudentStyle applied",
    { fields },
    { userId },
  );
  return true;
}
