import { createClient } from "@supabase/supabase-js";

function cleanStem(raw: string): string {
  if (!raw) return raw;

  let text = raw;

  text = text.replace(/\s+/g, " ").trim();

  text = text.replace(/Question ID\s+\S+/gi, "");
  text = text.replace(/\bAssessment\b/gi, "");
  text = text.replace(/\bSAT\b/gi, "");
  text = text.replace(/\bID:\s*\S+/gi, "");
  text = text.replace(/\bTest\b/gi, "");
  text = text.replace(/\bDomain\b/gi, "");
  text = text.replace(/\bSkill\b/gi, "");
  text = text.replace(/\bDifficulty\b/gi, "");
  text = text.replace(/\bMath\b/gi, "");
  text = text.replace(/\bAlgebra\b/gi, "");
  text = text.replace(/\bGeometry\b/gi, "");
  text = text.replace(/\bTrigonometry\b/gi, "");
  text = text.replace(/\bLinear functions?\b/gi, "");
  text = text.replace(/\bLines,?\s*angles,?\s*and\s*triangles\b/gi, "");
  text = text.replace(/\bArea and volume\b/gi, "");
  text = text.replace(/\band Trigonometry\b/gi, "");

  text = text.replace(/\s+/g, " ").trim();

  text = text.replace(/\bthexy-plane\b/gi, "the xy-plane");
  text = text.replace(/\bIn thexy-plane\b/gi, "In the xy-plane");
  text = text.replace(/\bin thexy-plane\b/gi, "in the xy-plane");
  text = text.replace(/\bA circle in the\b/gi, "A circle in the");
  
  text = text.replace(
    /with a length of inches and a width of inches\?4 9/gi,
    "with a length of 4 inches and a width of 9 inches?"
  );
  text = text.replace(
    /with a length of inches and a width of inches\?\s*4\s*9/gi,
    "with a length of 4 inches and a width of 9 inches?"
  );
  
  text = text.replace(/\bdefined byof\b/gi, "defined by");
  text = text.replace(/\bvalue oft\s*\?\s*,\s*q\b/gi, "value of t?");
  text = text.replace(/\blinep\b/gi, "line p");
  text = text.replace(/\bat circle\?\b/gi, "at (h, k). What is the radius of the circle?");

  text = text.replace(/\s+/g, " ").trim();

  const openerRegex =
    /\b(What|Which|When|Where|In the|If|A cargo|A circle|A rectangle|A function|The graph|The function|How many|Find the|Solve|Calculate|Determine|Given that|Consider|Let|Suppose|An)\b/i;

  const match = text.match(openerRegex);
  if (match && typeof match.index === "number" && match.index > 0) {
    text = text.slice(match.index).trim();
  }

  text = text.replace(/\s+/g, " ").trim();

  if (text.length < 20) {
    return raw.replace(/\s+/g, " ").trim();
  }

  return text;
}

async function main() {
  console.log("🧹 [CLEANUP] Starting question stem cleanup...\n");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  console.log("📥 Fetching dirty questions from Supabase...");

  const { data, error } = await supabase
    .from("questions")
    .select("id, stem")
    .or("stem.ilike.%Question ID%,stem.ilike.%Assessment%,stem.ilike.%Test Domain%,stem.ilike.%Skill%,stem.ilike.%thexy-plane%,stem.ilike.%inches?4 9%,stem.ilike.%defined byof%,stem.ilike.%value oft%,stem.ilike.%linep%,stem.ilike.%at circle?%")
    .limit(5000);

  if (error) {
    console.error("❌ Failed to fetch questions:", error.message);
    process.exit(1);
  }

  console.log(`📊 Found ${data?.length || 0} questions with potentially dirty stems\n`);

  if (!data || data.length === 0) {
    console.log("✅ No dirty stems found. Nothing to clean.");
    process.exit(0);
  }

  const updates: { id: string; stem: string }[] = [];

  for (const row of data) {
    const cleaned = cleanStem(row.stem);
    if (cleaned !== row.stem && cleaned.length > 0) {
      updates.push({ id: row.id, stem: cleaned });
    }
  }

  console.log(`🔄 ${updates.length} questions need stem updates\n`);

  if (updates.length === 0) {
    console.log("✅ All stems are already clean. Nothing to update.");
    process.exit(0);
  }

  console.log("📤 Updating stems in Supabase...");

  let successCount = 0;
  let errorCount = 0;

  for (const update of updates) {
    const { error: updateError } = await supabase
      .from("questions")
      .update({ stem: update.stem })
      .eq("id", update.id);

    if (updateError) {
      console.error(`❌ Failed to update ${update.id}:`, updateError.message);
      errorCount++;
    } else {
      successCount++;
    }
  }

  console.log(`\n✅ Successfully cleaned ${successCount} question stems!`);
  if (errorCount > 0) {
    console.log(`⚠️ ${errorCount} updates failed.`);
  }
  
  console.log("\n📝 Sample cleaned stems:");
  updates.slice(0, 3).forEach((u, i) => {
    console.log(`  ${i + 1}. ${u.stem.slice(0, 100)}...`);
  });
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
