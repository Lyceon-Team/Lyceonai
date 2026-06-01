import { getSupabaseAdmin } from "../apps/api/src/lib/supabase-admin";

async function main() {
  const supabase = getSupabaseAdmin();
  const devUserId = process.env.DEV_USER_ID;

  if (!devUserId) {
    console.error("DEV_USER_ID environment variable is required");
    process.exit(1);
  }

  console.log("Looking for an existing question...");
  const { data: question, error: qError } = await supabase
    .from("questions")
    .select("id, canonical_id, section_code, domain, skill, difficulty")
    .not("canonical_id", "is", null)
    .limit(1)
    .single();

  if (qError || !question) {
    console.error("No question found with canonical_id:", qError?.message);
    process.exit(1);
  }

  console.log("Found question:", question.canonical_id);

  const attemptId = crypto.randomUUID();
  const { error: insertError } = await supabase
    .from("student_question_attempts")
    .insert({
      id: attemptId,
      user_id: devUserId,
      question_canonical_id: question.canonical_id,
      is_correct: true,
      selected_choice: "A",
      exam: "SAT",
      section_code: question.section_code,
      domain: question.domain,
      skill: question.skill,
      difficulty_bucket: question.difficulty,
    });

  if (insertError) {
    console.error("Failed to insert attempt:", insertError.message);
    process.exit(1);
  }

  console.log("Inserted attempt:", attemptId);

  const { data: attempts, error: countError } = await supabase
    .from("student_question_attempts")
    .select("id")
    .eq("user_id", devUserId);

  if (countError) {
    console.error("Failed to count attempts:", countError.message);
    process.exit(1);
  }

  console.log(`User ${devUserId} now has ${attempts?.length || 0} attempts`);

  const { error: deleteError } = await supabase
    .from("student_question_attempts")
    .delete()
    .eq("id", attemptId);

  if (deleteError) {
    console.error("Failed to cleanup attempt:", deleteError.message);
  } else {
    console.log("Cleaned up test attempt");
  }

  console.log("✅ dev-seed-attempt complete");
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});

