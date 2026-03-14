import { supabaseServer } from "../apps/api/src/lib/supabase-server";
import { generateCanonicalId } from "../apps/api/src/lib/canonicalId";

(async () => {
  const canonical_id = generateCanonicalId("SAT", "RW", "1");

  const row: any = {
    canonical_id,
    status: "draft",
    section: "Reading and Writing",
    section_code: "RW",
    question_type: "multiple_choice",
    stem: "CANARY: does canonical insert work via supabaseServer?",
    options: [
      { key: "A", text: "A" },
      { key: "B", text: "B" },
      { key: "C", text: "C" },
      { key: "D", text: "D" },
    ],
    correct_answer: "A",
    answer_text: "A",
    explanation: "canary",
    option_metadata: {
      A: { role: "correct", error_taxonomy: null },
      B: { role: "distractor", error_taxonomy: null },
      C: { role: "distractor", error_taxonomy: null },
      D: { role: "distractor", error_taxonomy: null },
    },
    domain: "Information and Ideas",
    skill: "Central Ideas and Details",
    subskill: "Determine central idea",
    skill_code: "RW.INFO.CENTRAL_IDEA",
    difficulty: 2,
    source_type: 1,
    test_code: "SAT",
    exam: "SAT",
    ai_generated: true,
    tags: ["canary"],
    competencies: [{ code: "RW.INFO.CENTRAL_IDEA", raw: "determine central idea" }],
    diagram_present: false,
    provenance_chunk_ids: null,
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
  console.log("Canary complete.");
})();
