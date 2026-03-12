import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function diagnose() {
  const args = process.argv.slice(2);
  const sectionArg = args.find((a) => a.startsWith("--section="));
  const section = sectionArg?.split("=")[1] || "math";
  const sectionCode = section.toLowerCase() === "math" ? "MATH" : "RW";

  console.log(`=== Diagnostic: Next Question Selection (section_code=${sectionCode}) ===\n`);

  const { data, error } = await supabase
    .from("questions")
    .select("id, stem, options, section, section_code, difficulty, question_type, status")
    .eq("question_type", "multiple_choice")
    .eq("status", "published")
    .eq("section_code", sectionCode)
    .limit(5);

  if (error) {
    console.log("[ERROR] Query failed:", error.message);
    return;
  }

  console.log(`[${sectionCode}] Candidate count from sample query:`, data?.length || 0);

  if (data && data.length > 0) {
    const q = data[0];
    const stemLen = q.stem?.length || 0;
    const optionsCount = Array.isArray(q.options) ? q.options.length : 0;

    console.log(`\n[SELECTED QUESTION]`);
    console.log(`  id:           ${q.id}`);
    console.log(`  section:      ${q.section} (${q.section_code})`);
    console.log(`  difficulty:   ${q.difficulty}`);
    console.log(`  questionType: ${q.question_type}`);
    console.log(`  status:       ${q.status}`);
    console.log(`  stemLen:      ${stemLen} ${stemLen > 0 ? "✅" : "❌"}`);
    console.log(`  optionsCount: ${optionsCount} ${optionsCount === 4 ? "✅" : "⚠️"}`);
    console.log(`  stemPreview:  ${q.stem?.slice(0, 80)}...`);

    console.log(`\n[RESULT] ${stemLen > 0 ? "SUCCESS" : "FAIL"}: Question ${stemLen > 0 ? "has" : "missing"} stem`);
  } else {
    console.log(`\n[RESULT] FAIL: No questions returned for section_code=${sectionCode}`);
  }
}

diagnose().catch(console.error);