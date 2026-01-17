import { supabaseServer } from "../apps/api/src/lib/supabase-server";
import { generateCanonicalId } from "../apps/api/src/lib/canonicalId";

(async () => {
  const canonical_id = generateCanonicalId("SAT", "R", "2");

  const row: any = {
    canonical_id,
    section: "Reading",
    stem: "CANARY: does insert work via supabaseServer?",
    question_type: "multiple_choice",
    type: "mc",
    options: [
      { key: "A", text: "A" },
      { key: "B", text: "B" },
      { key: "C", text: "C" },
      { key: "D", text: "D" }
    ],
    answer: "A",
    answer_choice: "A",
    answer_text: "A",
    explanation: "canary",
    difficulty: "Easy",
    difficulty_level: 1,
    tags: [],
    classification: {},
    source_mapping: { canary: true, origin: "scripts/canary-supabase-questions.ts" },
    parsing_metadata: { canary: true },
    confidence: 0.01,
    needs_review: true,
  };

  console.log("CANARY canonical_id:", canonical_id);

  const insertResp = await supabaseServer
    .from("questions")
    .insert([row])
    .select("id, canonical_id");

  console.log("INSERT:", JSON.stringify(insertResp, null, 2));

  if (insertResp.error) process.exit(1);

  const readResp = await supabaseServer
    .from("questions")
    .select("id, canonical_id")
    .eq("canonical_id", canonical_id)
    .limit(1);

  console.log("READ:", JSON.stringify(readResp, null, 2));

  if (readResp.error) process.exit(1);

  const deleteResp = await supabaseServer
    .from("questions")
    .delete()
    .eq("canonical_id", canonical_id);

  console.log("DELETE:", JSON.stringify(deleteResp, null, 2));

  console.log("✅ Canary complete.");
})();
