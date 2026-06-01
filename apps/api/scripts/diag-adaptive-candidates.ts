import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function diagnose() {
  console.log("=== Adaptive Selector Candidate Diagnostic ===\n");

  const { data: mathCandidates, error: mathErr } = await supabase
    .from("questions")
    .select("id, section_code, stem, difficulty")
    .eq("question_type", "multiple_choice")
    .eq("status", "published")
    .eq("section_code", "MATH")
    .limit(120);

  if (mathErr) {
    console.log("[MATH] Query error:", mathErr.message);
  } else {
    console.log("[MATH] Candidate count:", mathCandidates?.length || 0);
    if (mathCandidates?.[0]) {
      const sample = mathCandidates[0];
      console.log("[MATH] Sample:", {
        id: sample.id,
        section_code: sample.section_code,
        difficulty: sample.difficulty,
        stemPopulated: !!sample.stem && sample.stem.length > 0,
        stemPreview: sample.stem?.slice(0, 60) + "...",
      });
    }
  }

  console.log("");

  const { data: rwCandidates, error: rwErr } = await supabase
    .from("questions")
    .select("id, section_code, stem, difficulty")
    .eq("question_type", "multiple_choice")
    .eq("status", "published")
    .eq("section_code", "RW")
    .limit(200);

  if (rwErr) {
    console.log("[RW] Query error:", rwErr.message);
  } else {
    console.log("[RW] Candidate count:", rwCandidates?.length || 0);
    if (rwCandidates?.[0]) {
      const sample = rwCandidates[0];
      console.log("[RW] Sample:", {
        id: sample.id,
        section_code: sample.section_code,
        difficulty: sample.difficulty,
        stemPopulated: !!sample.stem && sample.stem.length > 0,
        stemPreview: sample.stem?.slice(0, 60) + "...",
      });
    }
  }

  console.log("\n=== Summary ===");
  console.log("Math candidates:", mathCandidates?.length || 0);
  console.log("RW candidates:", rwCandidates?.length || 0);
  console.log(
    "Both have populated stems:",
    (mathCandidates?.[0]?.stem?.length || 0) > 0 && (rwCandidates?.[0]?.stem?.length || 0) > 0 ? "YES" : "NO"
  );
}

diagnose().catch(console.error);