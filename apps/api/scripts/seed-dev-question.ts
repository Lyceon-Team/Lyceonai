/**
 * DEVELOPMENT ONLY: Seed a synthetic SAT question for RAG v2 testing
 */

import { generateEmbedding } from '../src/lib/embeddings';
import { supabase } from '../src/lib/vector';

const CANONICAL_ID = "SATM1DEV001";

const devQuestion = {
  canonical_id: CANONICAL_ID,
  status: 'draft' as const,
  test_code: "SAT",
  section_code: "MATH",
  source_type: 'synthetic' as const,
  section: "Math",
  question_type: 'multiple_choice' as const,
  stem: "If 2x + 5 = 15, what is the value of x?",
  options: [
    { key: "A", text: "3" },
    { key: "B", text: "4" },
    { key: "C", text: "5" },
    { key: "D", text: "10" },
  ],
  correct_answer: "C",
  answer_text: "5",
  explanation: "Subtract 5 from both sides to get 2x = 10, then divide by 2 to get x = 5.",
  option_metadata: [
    { key: "A", text: "3", is_correct: false },
    { key: "B", text: "4", is_correct: false },
    { key: "C", text: "5", is_correct: true },
    { key: "D", text: "10", is_correct: false },
  ],
  domain: 'algebra',
  skill: 'Linear equations in one variable',
  subskill: 'Solve one-step linear equations',
  skill_code: 'MATH.ALG.LINEAR.1',
  competencies: [{ code: "M.LIN.1", raw: "solve linear equations" }],
  difficulty: "easy",
  tags: ["dev-seed", "linear-equations"],
  exam: 'SAT',
  ai_generated: true,
  diagram_present: false,
  provenance_chunk_ids: [],
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
          status: devQuestion.status,
          stem: devQuestion.stem,
          section: devQuestion.section,
          section_code: devQuestion.section_code,
          question_type: devQuestion.question_type,
          options: devQuestion.options,
          correct_answer: devQuestion.correct_answer,
          answer_text: devQuestion.answer_text,
          explanation: devQuestion.explanation,
          option_metadata: devQuestion.option_metadata,
          domain: devQuestion.domain,
          skill: devQuestion.skill,
          subskill: devQuestion.subskill,
          skill_code: devQuestion.skill_code,
          competencies: devQuestion.competencies,
          difficulty: devQuestion.difficulty,
          tags: devQuestion.tags,
          test_code: devQuestion.test_code,
          source_type: devQuestion.source_type,
          exam: devQuestion.exam,
          ai_generated: devQuestion.ai_generated,
          diagram_present: devQuestion.diagram_present,
          provenance_chunk_ids: devQuestion.provenance_chunk_ids,
        })
        .eq('canonical_id', CANONICAL_ID);

      if (updateError) throw updateError;
      console.log("[SEED] Updated existing question:", { canonicalId: CANONICAL_ID, id: questionId });
    } else {
      console.log("[SEED] Inserting new question...");

      const { data: newQ, error: insertError } = await supabase
        .from('questions')
        .insert(devQuestion)
        .select('id')
        .single();

      if (insertError) throw insertError;

      questionId = newQ!.id;
      console.log("[SEED] Inserted new question:", { canonicalId: CANONICAL_ID, id: questionId });
    }

    console.log("\n[SEED] ✅ Question seeded successfully!");

    try {
      const optionsText = devQuestion.options
        .map(opt => `${opt.key}. ${opt.text}`)
        .join("\n");
      const content = `${devQuestion.stem}\n${optionsText}`;

      const embedding = await generateEmbedding(content);

      const embeddingMetadata = {
        difficulty: devQuestion.difficulty,
        canonicalId: CANONICAL_ID,
        testCode: devQuestion.test_code,
        sectionCode: devQuestion.section_code,
        competencyCodes: devQuestion.competencies.map(c => c.code),
      };

      await supabase
        .from('question_embeddings')
        .upsert({
          question_id: questionId,
          stem: devQuestion.stem,
          section: devQuestion.section,
          embedding,
          exam: devQuestion.test_code,
          metadata: embeddingMetadata,
        }, { onConflict: 'question_id' });
    } catch {
      // non-blocking for dev seed
    }

  } catch (error: any) {
    console.error("[SEED] ❌ Seeding failed:", error.message);
    process.exit(1);
  }

  process.exit(0);
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('seed-dev-question')) {
  main();
}

export { main as seedDevQuestion };
