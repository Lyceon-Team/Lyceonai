/**
 * DEVELOPMENT ONLY: Seed a synthetic SAT question for RAG v2 testing
 * 
 * This script inserts a test question into the database for testing RAG v2.
 * Do NOT use in production.
 * 
 * KNOWN ISSUE: Embedding insertion fails due to dimension mismatch:
 * - Gemini text-embedding-004 produces 768D vectors
 * - Supabase question_embeddings table is configured for 1536D (OpenAI)
 * - Workaround: Test question mode (uses DB lookup by canonical_id)
 * - TODO: Update Supabase pgvector column to vector(768) for Gemini compatibility
 * 
 * Usage: cd apps/api && npm run seed:dev-question
 */

import { generateEmbedding } from '../src/lib/embeddings';
import { supabase } from '../src/lib/vector';

const CANONICAL_ID = "SATM1DEV001";

const devQuestion = {
  canonical_id: CANONICAL_ID,
  test_code: "SAT",
  section_code: "M",
  source_type: 1,
  section: "Math",
  stem: "If 2x + 5 = 15, what is the value of x?",
  options: [
    { key: "A", text: "3" },
    { key: "B", text: "4" },
    { key: "C", text: "5" },
    { key: "D", text: "10" },
  ],
  answer: "C",
  answer_choice: "C",
  explanation: "Subtract 5 from both sides to get 2x = 10, then divide by 2 to get x = 5.",
  competencies: [{ code: "M.LIN.1", raw: "solve linear equations" }],
  difficulty: "easy",
  tags: ["dev-seed", "linear-equations"],
  version: 1,
  type: "mc",
  question_type: "multiple_choice",
};

async function main() {
  console.log("[SEED] Starting dev question seeding...");
  console.log("[SEED] Target canonicalId:", CANONICAL_ID);

  try {
    const { data: existingQ, error: checkError } = await supabase
      .from('questions')
      .select('id, canonical_id')
      .eq('canonical_id', CANONICAL_ID)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error("[SEED] Error checking existing question:", checkError);
    }

    let questionId: string;

    if (existingQ) {
      console.log("[SEED] Question already exists, updating...");
      questionId = existingQ.id;
      
      const { error: updateError } = await supabase
        .from('questions')
        .update({
          stem: devQuestion.stem,
          section: devQuestion.section,
          options: devQuestion.options,
          answer: devQuestion.answer,
          answer_choice: devQuestion.answer_choice,
          explanation: devQuestion.explanation,
          competencies: devQuestion.competencies,
          difficulty: devQuestion.difficulty,
          tags: devQuestion.tags,
          test_code: devQuestion.test_code,
          section_code: devQuestion.section_code,
          source_type: devQuestion.source_type,
          version: devQuestion.version,
          type: devQuestion.type,
          question_type: devQuestion.question_type,
        })
        .eq('canonical_id', CANONICAL_ID);

      if (updateError) {
        console.error("[SEED] Error updating question:", updateError);
        throw updateError;
      }
      
      console.log("[SEED] Updated existing question:", { canonicalId: CANONICAL_ID, id: questionId });
    } else {
      console.log("[SEED] Inserting new question...");
      
      const { data: newQ, error: insertError } = await supabase
        .from('questions')
        .insert({
          stem: devQuestion.stem,
          section: devQuestion.section,
          options: devQuestion.options,
          answer: devQuestion.answer,
          answer_choice: devQuestion.answer_choice,
          explanation: devQuestion.explanation,
          competencies: devQuestion.competencies,
          difficulty: devQuestion.difficulty,
          tags: devQuestion.tags,
          canonical_id: devQuestion.canonical_id,
          test_code: devQuestion.test_code,
          section_code: devQuestion.section_code,
          source_type: devQuestion.source_type,
          version: devQuestion.version,
          type: devQuestion.type,
          question_type: devQuestion.question_type,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error("[SEED] Error inserting question:", insertError);
        throw insertError;
      }
      
      questionId = newQ!.id;
      console.log("[SEED] Inserted new question:", { canonicalId: CANONICAL_ID, id: questionId });
    }

    console.log("\n[SEED] ✅ Question seeded successfully!");
    console.log("[SEED] Question details:");
    console.log("  - Canonical ID:", CANONICAL_ID);
    console.log("  - Question ID:", questionId);
    console.log("  - Section:", devQuestion.section);
    console.log("  - Difficulty:", devQuestion.difficulty);
    console.log("  - Competencies:", devQuestion.competencies.map(c => c.code).join(", "));

    console.log("\n[SEED] Attempting to generate embedding (may fail due to dimension mismatch)...");
    
    try {
      const optionsText = devQuestion.options
        .map(opt => `${opt.key}. ${opt.text}`)
        .join("\n");
      const content = `${devQuestion.stem}\n${optionsText}`;
      
      const embedding = await generateEmbedding(content);
      console.log("[SEED] Generated embedding with", embedding.length, "dimensions");

      const embeddingMetadata = {
        difficulty: devQuestion.difficulty,
        canonicalId: CANONICAL_ID,
        testCode: devQuestion.test_code,
        sectionCode: devQuestion.section_code,
        competencyCodes: devQuestion.competencies.map(c => c.code),
      };

      const { error: insertError } = await supabase
        .from('question_embeddings')
        .upsert({
          question_id: questionId,
          stem: devQuestion.stem,
          section: devQuestion.section,
          embedding: embedding,
          exam: devQuestion.test_code,
          metadata: embeddingMetadata,
        }, { onConflict: 'question_id' });

      if (insertError) {
        console.warn("[SEED] ⚠️ Embedding insert failed (expected - dimension mismatch):", insertError.message);
        console.warn("[SEED]    Supabase expects 1536D (OpenAI), but Gemini produces 768D");
        console.warn("[SEED]    To fix: Update Supabase question_embeddings.embedding to vector(768)");
      } else {
        console.log("[SEED] ✅ Embedding inserted successfully!");
      }
    } catch (embeddingError: any) {
      console.warn("[SEED] ⚠️ Embedding generation/storage failed:", embeddingError.message);
      console.warn("[SEED]    Question was seeded but without embedding.");
    }

    console.log("\n[SEED] You can now test RAG v2 with canonicalQuestionId:", CANONICAL_ID);
    console.log("[SEED]   - Question mode: Uses DB lookup (works without embedding)");
    console.log("[SEED]   - Concept mode: Requires embeddings for vector search");
    console.log("[SEED]   - Strategy mode: No DB/vector calls needed");

  } catch (error: any) {
    console.error("[SEED] ❌ Seeding failed:", error.message);
    console.error(error);
    process.exit(1);
  }

  process.exit(0);
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('seed-dev-question')) {
  main();
}

export { main as seedDevQuestion };
