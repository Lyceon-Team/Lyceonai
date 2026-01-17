/**
 * Import Synthetic SAT R&W Questions into Supabase
 * 
 * This script reads the generated JSON file containing 200 synthetic
 * SAT Reading & Writing questions and imports them into the Supabase
 * questions table using canonical IDs (CQID).
 * 
 * Features:
 * - Uses Canonical Question IDs (CQID) as the durable identifier
 * - Idempotent: checks for existing questions before import
 * - Collision-safe: retries on CQID conflicts
 * 
 * Usage: npx tsx scripts/import-synthetic-rw-questions.ts
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID, randomBytes } from "crypto";
import { supabaseServer } from "../apps/api/src/lib/supabase-server";
import {
  validateQuestionRows,
} from "../apps/api/src/ingestion/types/supabaseQuestionsRow";

interface SyntheticRwQuestion {
  section: string;
  domain: string;
  skill: string;
  unit_tag: string;
  competency_keys: string[];
  difficulty: "Easy" | "Medium" | "Hard";
  type: "mc" | "fr";
  stem: string;
  passage: string | null;
  options: string[];
  correct_option: "A" | "B" | "C" | "D" | null;
  answer_text: string;
  explanation: string;
  tags: string[];
  classification: {
    answer_format: string;
    calculator_allowed: boolean | null;
    uses_graph_or_table: boolean;
    content_area: string;
  };
  source_mapping: {
    generator: string;
    reference_family: string;
    notes: string;
  };
}

const SYNTH_SOURCE_TAG = "sat_rw_200_v1";
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_RETRIES = 5;

function generateUniqueToken(length: number = 6): string {
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CHARSET[bytes[i] % CHARSET.length];
  }
  return result;
}

function generateCanonicalId(test: string, section: string, source: "1" | "2"): string {
  const unique = generateUniqueToken();
  return `${test}${section}${source}${unique}`;
}

function mapDifficultyToLevel(difficulty: string): number {
  switch (difficulty) {
    case "Easy":
      return 1;
    case "Medium":
      return 2;
    case "Hard":
      return 3;
    default:
      return 2;
  }
}

function mapSectionToCode(section: string): string {
  const normalized = section.toLowerCase();
  if (normalized.includes("reading")) return "R";
  if (normalized.includes("writing")) return "W";
  return "R";
}

async function checkExistingQuestions(): Promise<number> {
  const { data, error } = await supabaseServer
    .from("questions")
    .select("id", { count: "exact" })
    .eq("source_mapping->>syntheticSource", SYNTH_SOURCE_TAG);
  
  if (error) {
    console.error("Error checking existing questions:", error);
    return 0;
  }
  
  return data?.length || 0;
}

async function insertWithRetry(
  row: Record<string, any>,
  test: string,
  section: string
): Promise<{ success: boolean; canonicalId?: string; error?: string }> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const canonicalId = generateCanonicalId(test, section, "2");
    
    const rowWithCqid = {
      ...row,
      canonical_id: canonicalId,
    };
    
    const { error } = await supabaseServer
      .from("questions")
      .insert(rowWithCqid);
    
    if (!error) {
      return { success: true, canonicalId };
    }
    
    const isDuplicateError = 
      error.code === "23505" ||
      error.message?.includes("duplicate key") ||
      error.message?.includes("unique constraint") ||
      error.message?.includes("canonical_id");
    
    if (isDuplicateError) {
      console.warn(`   ⚠️ CQID collision on attempt ${attempt + 1}, retrying...`);
      continue;
    }
    
    return { success: false, error: error.message };
  }
  
  return { success: false, error: `Failed after ${MAX_RETRIES} retries` };
}

async function main(): Promise<void> {
  console.log("🚀 Starting synthetic R&W question import...\n");

  const existingCount = await checkExistingQuestions();
  if (existingCount >= 200) {
    console.log(`✅ Already imported: ${existingCount} synthetic R&W questions found.`);
    console.log("   Skipping import (idempotent).\n");
    return;
  }
  
  if (existingCount > 0) {
    console.log(`⚠️ Partial import detected: ${existingCount} questions already exist.`);
    console.log("   Will import only missing questions.\n");
  }

  const jsonPath = path.join(
    process.cwd(),
    "generated_questions/sat_rw_200_questions.json"
  );

  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ JSON file not found: ${jsonPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, "utf-8");
  const items: SyntheticRwQuestion[] = JSON.parse(raw);

  console.log(`📄 Loaded ${items.length} questions from JSON file\n`);

  const choiceKeys = ["A", "B", "C", "D"];

  const syntheticRows: Record<string, any>[] = items.map((item, index) => {
    const sectionCode = mapSectionToCode(item.section);
    
    const options = item.options.map((text, idx) => ({
      key: choiceKeys[idx],
      text,
    }));

    const row: Record<string, any> = {
      id: randomUUID(),
      document_id: null,
      question_number: null,
      section: "Reading",
      stem: item.stem,
      question_type: "multiple_choice",
      type: "mc",
      options,
      answer: item.correct_option ?? null,
      answer_choice: item.correct_option ?? null,
      answer_text: item.answer_text,
      explanation: item.explanation,
      difficulty: item.difficulty,
      difficulty_level: mapDifficultyToLevel(item.difficulty),
      unit_tag: item.unit_tag,
      tags: item.tags,
      classification: item.classification,
      source_mapping: {
        ...(item.source_mapping || {}),
        syntheticSource: SYNTH_SOURCE_TAG,
        exam: "SAT",
        section_code: sectionCode,
        source_type: "synthetic_llm",
        competencies: item.competency_keys,
      },
      page_number: null,
      position: null,
      embedding: null,
      ai_generated: true,
      provenance_chunk_ids: null,
      confidence: 0.95,
      needs_review: false,
      parsing_metadata: {
        generator: "llm-synthetic-v1",
        original_section: item.section,
        original_domain: item.domain,
        original_skill: item.skill,
      },
      reviewed_at: null,
      reviewed_by: null,
      exam: "SAT",
      source_type: "synthetic_llm",
      _sectionCode: sectionCode,
    };

    return row;
  });

  console.log(`🔍 Validating ${syntheticRows.length} question rows...\n`);

  const { validRows, invalidCount, allDroppedKeys } = validateQuestionRows(
    syntheticRows as unknown as Record<string, any>[]
  );

  console.log(`\n📊 Validation Summary:`);
  console.log(`   - Total input items: ${items.length}`);
  console.log(`   - Valid rows: ${validRows.length}`);
  console.log(`   - Invalid rows: ${invalidCount}`);
  if (allDroppedKeys.size > 0) {
    console.log(`   - Dropped keys: ${Array.from(allDroppedKeys).join(", ")}`);
  }

  if (invalidCount > 0) {
    console.error(`\n❌ ${invalidCount} rows failed validation. Aborting import.`);
    process.exit(1);
  }

  console.log(`\n✅ All rows passed validation. Starting Supabase insert with CQID...\n`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let i = 0; i < validRows.length; i++) {
    const row = validRows[i];
    const sectionCode = (syntheticRows[i] as any)._sectionCode || "R";
    
    const stemHash = row.stem?.substring(0, 50);
    const { data: existing } = await supabaseServer
      .from("questions")
      .select("id")
      .eq("source_mapping->>syntheticSource", SYNTH_SOURCE_TAG)
      .ilike("stem", `${stemHash}%`)
      .limit(1);
    
    if (existing && existing.length > 0) {
      totalSkipped++;
      continue;
    }
    
    const result = await insertWithRetry(row, "SAT", sectionCode);
    
    if (result.success) {
      totalInserted++;
      if (totalInserted % 20 === 0 || totalInserted === 1) {
        console.log(`   ✅ Inserted ${totalInserted} questions (latest CQID: ${result.canonicalId})`);
      }
    } else {
      totalFailed++;
      console.error(`   ❌ Failed to insert question ${i + 1}: ${result.error}`);
    }
  }

  console.log(`\n📊 Import Summary:`);
  console.log(`   - Inserted: ${totalInserted}`);
  console.log(`   - Skipped (already exist): ${totalSkipped}`);
  console.log(`   - Failed: ${totalFailed}`);
  
  if (totalFailed === 0) {
    console.log(`\n🎉 Successfully imported ${totalInserted} synthetic R&W questions into Supabase.questions`);
  } else {
    console.log(`\n⚠️ Import completed with ${totalFailed} failures.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error during synthetic question import:", err);
  process.exit(1);
});
