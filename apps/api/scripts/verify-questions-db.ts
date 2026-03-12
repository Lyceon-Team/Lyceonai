import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

console.log("[Verify] SUPABASE_URL:", SUPABASE_URL);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function hasCanonicalOptionMetadata(value: any): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    value.A &&
    value.B &&
    value.C &&
    value.D
  );
}

async function main() {
  const { data: headRows, error: headErr } = await supabase
    .from("questions")
    .select("id, canonical_id, section_code, question_type, difficulty, source_type")
    .limit(5);

  if (headErr) throw headErr;

  console.log("[Verify] first 5 ids:", headRows?.map((r) => r.id));

  const { data: all, error: allErr } = await supabase
    .from("questions")
    .select("id, section_code, question_type, difficulty, source_type, options, option_metadata, tags, competencies, provenance_chunk_ids");

  if (allErr) throw allErr;

  let invalidSectionCode = 0;
  let invalidQuestionType = 0;
  let invalidDifficulty = 0;
  let invalidSourceType = 0;
  let invalidOptions = 0;
  let invalidOptionMetadata = 0;
  let invalidJsonMetadata = 0;

  for (const row of all ?? []) {
    if (row.section_code !== "MATH" && row.section_code !== "RW") invalidSectionCode++;
    if (row.question_type !== "multiple_choice") invalidQuestionType++;
    if (![1, 2, 3].includes(row.difficulty)) invalidDifficulty++;
    if (![0, 1, 2, 3].includes(row.source_type)) invalidSourceType++;
    if (!Array.isArray(row.options) || row.options.length !== 4) invalidOptions++;
    if (!hasCanonicalOptionMetadata(row.option_metadata)) invalidOptionMetadata++;

    const jsonFields = [row.tags, row.competencies, row.provenance_chunk_ids];
    if (jsonFields.some((field) => typeof field === "string")) invalidJsonMetadata++;
  }

  console.log("[Verify] total:", all?.length ?? 0);
  console.log("[Verify] invalid section_code:", invalidSectionCode);
  console.log("[Verify] invalid question_type:", invalidQuestionType);
  console.log("[Verify] invalid difficulty:", invalidDifficulty);
  console.log("[Verify] invalid source_type:", invalidSourceType);
  console.log("[Verify] invalid options shape:", invalidOptions);
  console.log("[Verify] invalid option_metadata shape:", invalidOptionMetadata);
  console.log("[Verify] json fields stored as strings:", invalidJsonMetadata);
}

main().catch((e) => {
  console.error("[Verify] Failed:", e?.message || e);
  process.exit(1);
});