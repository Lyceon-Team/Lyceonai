import { supabaseServer } from "../apps/api/src/lib/supabase-server";
import { generateCanonicalId } from "../apps/api/src/lib/canonicalId";

(async () => {
  const canonical_id = generateCanonicalId("SAT", "RW", 1);

  const row: any = {
    canonical_id,
    status: "draft",
<<<<<<< HEAD
    section: "Reading and Writing",
    section_code: "RW",
    question_type: "multiple_choice",
    stem: "CANARY: does canonical insert work via supabaseServer?",
=======
    section: "Reading & Writing",
    section_code: "RW",
    question_type: "multiple_choice",
    stem: "CANARY: does insert work via supabaseServer?",
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
    options: [
      { key: "A", text: "A" },
      { key: "B", text: "B" },
      { key: "C", text: "C" },
      { key: "D", text: "D" },
    ],
    correct_answer: "A",
    answer_text: "A",
    explanation: "canary",
<<<<<<< HEAD
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
=======
    option_metadata: [
      { key: "A", text: "A", is_correct: true },
      { key: "B", text: "B", is_correct: false },
      { key: "C", text: "C", is_correct: false },
      { key: "D", text: "D", is_correct: false },
    ],
    domain: "canary",
    skill: "canary skill",
    subskill: "canary subskill",
    skill_code: "CANARY.SKILL",
    difficulty: "easy",
    source_type: "unknown",
    test_code: "SAT",
    exam: "SAT",
    ai_generated: true,
    diagram_present: false,
    tags: [],
    competencies: [],
    provenance_chunk_ids: [],
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
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