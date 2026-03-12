/**
<<<<<<< HEAD
 * DEVELOPMENT ONLY: Seed a synthetic SAT question for RAG v2 testing.
=======
 * DEVELOPMENT ONLY: Seed a synthetic SAT question for RAG v2 testing
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
 */

import { generateEmbedding } from '../src/lib/embeddings';
import { supabase } from '../src/lib/vector';

const CANONICAL_ID = 'SATMATH1DEV001';

const devQuestion = {
  canonical_id: CANONICAL_ID,
<<<<<<< HEAD
  status: 'published',
  section: 'Math',
  section_code: 'MATH',
  question_type: 'multiple_choice',
  stem: 'If 2x + 5 = 15, what is the value of x?',
=======
  status: 'draft' as const,
  test_code: "SAT",
  section_code: "MATH",
  source_type: 'synthetic' as const,
  section: "Math",
  question_type: 'multiple_choice' as const,
  stem: "If 2x + 5 = 15, what is the value of x?",
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  options: [
    { key: 'A', text: '3' },
    { key: 'B', text: '4' },
    { key: 'C', text: '5' },
    { key: 'D', text: '10' },
  ],
<<<<<<< HEAD
  correct_answer: 'C',
  answer_text: '5',
  explanation: 'Subtract 5 from both sides to get 2x = 10, then divide by 2 to get x = 5.',
  option_metadata: {
    A: { role: 'distractor', error_taxonomy: null },
    B: { role: 'distractor', error_taxonomy: null },
    C: { role: 'correct', error_taxonomy: null },
    D: { role: 'distractor', error_taxonomy: null },
  },
  domain: 'Algebra',
  skill: 'Linear equations',
  subskill: 'One-variable linear equations',
  skill_code: 'MATH.ALG.LINEAR_1V',
  difficulty: 1,
  source_type: 1,
  test_code: 'SAT',
  exam: 'SAT',
  ai_generated: true,
  tags: ['dev-seed', 'linear-equations'],
  competencies: [{ code: 'MATH.ALG.LINEAR_1V', raw: 'solve linear equations' }],
  diagram_present: false,
  provenance_chunk_ids: null,
=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
};

async function main() {
  console.log('[SEED] Starting dev question seeding...');
  console.log('[SEED] Target canonicalId:', CANONICAL_ID);

  try {
    const { data: existingQ, error: checkError } = await supabase
      .from('questions')
      .select('id, canonical_id')
      .eq('canonical_id', CANONICAL_ID)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('[SEED] Error checking existing question:', checkError);
    }

    let questionId: string;

    if (existingQ) {
      console.log('[SEED] Question already exists, updating...');
      questionId = existingQ.id;

      const { error: updateError } = await supabase
        .from('questions')
        .update({
          status: devQuestion.status,
<<<<<<< HEAD
          section: devQuestion.section,
          section_code: devQuestion.section_code,
          question_type: devQuestion.question_type,
          stem: devQuestion.stem,
=======
          stem: devQuestion.stem,
          section: devQuestion.section,
          section_code: devQuestion.section_code,
          question_type: devQuestion.question_type,
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
          options: devQuestion.options,
          correct_answer: devQuestion.correct_answer,
          answer_text: devQuestion.answer_text,
          explanation: devQuestion.explanation,
          option_metadata: devQuestion.option_metadata,
          domain: devQuestion.domain,
          skill: devQuestion.skill,
          subskill: devQuestion.subskill,
          skill_code: devQuestion.skill_code,
<<<<<<< HEAD
          difficulty: devQuestion.difficulty,
          source_type: devQuestion.source_type,
          test_code: devQuestion.test_code,
          exam: devQuestion.exam,
          ai_generated: devQuestion.ai_generated,
          tags: devQuestion.tags,
          competencies: devQuestion.competencies,
=======
          competencies: devQuestion.competencies,
          difficulty: devQuestion.difficulty,
          tags: devQuestion.tags,
          test_code: devQuestion.test_code,
          source_type: devQuestion.source_type,
          exam: devQuestion.exam,
          ai_generated: devQuestion.ai_generated,
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
          diagram_present: devQuestion.diagram_present,
          provenance_chunk_ids: devQuestion.provenance_chunk_ids,
        })
        .eq('canonical_id', CANONICAL_ID);

<<<<<<< HEAD
      if (updateError) {
        console.error('[SEED] Error updating question:', updateError);
        throw updateError;
      }

      console.log('[SEED] Updated existing question:', { canonicalId: CANONICAL_ID, id: questionId });
    } else {
      console.log('[SEED] Inserting new question...');
=======
      if (updateError) throw updateError;
      console.log("[SEED] Updated existing question:", { canonicalId: CANONICAL_ID, id: questionId });
    } else {
      console.log("[SEED] Inserting new question...");
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

      const { data: newQ, error: insertError } = await supabase
        .from('questions')
        .insert(devQuestion)
        .select('id')
        .single();

<<<<<<< HEAD
      if (insertError) {
        console.error('[SEED] Error inserting question:', insertError);
        throw insertError;
      }
=======
      if (insertError) throw insertError;
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

      questionId = newQ!.id;
      console.log('[SEED] Inserted new question:', { canonicalId: CANONICAL_ID, id: questionId });
    }

<<<<<<< HEAD
    console.log('\n[SEED] ✅ Question seeded successfully!');

    console.log('\n[SEED] Attempting to generate embedding (may fail if vector schema mismatches)...');
=======
    console.log("\n[SEED] ✅ Question seeded successfully!");
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

    try {
      const optionsText = devQuestion.options.map((opt) => `${opt.key}. ${opt.text}`).join('\n');
      const content = `${devQuestion.stem}\n${optionsText}`;

      const embedding = await generateEmbedding(content);
<<<<<<< HEAD
      console.log('[SEED] Generated embedding with', embedding.length, 'dimensions');
=======
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

      const embeddingMetadata = {
        difficulty: devQuestion.difficulty,
        canonicalId: CANONICAL_ID,
        testCode: devQuestion.test_code,
        sectionCode: devQuestion.section_code,
        competencyCodes: devQuestion.competencies.map((c) => c.code),
      };

      await supabase
        .from('question_embeddings')
<<<<<<< HEAD
        .upsert(
          {
            question_id: questionId,
            stem: devQuestion.stem,
            section: devQuestion.section,
            embedding,
            exam: devQuestion.test_code,
            metadata: embeddingMetadata,
          },
          { onConflict: 'question_id' }
        );

      if (insertError) {
        console.warn('[SEED] ⚠️ Embedding insert failed:', insertError.message);
      } else {
        console.log('[SEED] ✅ Embedding inserted successfully!');
      }
    } catch (embeddingError: any) {
      console.warn('[SEED] ⚠️ Embedding generation/storage failed:', embeddingError.message);
    }
  } catch (error: any) {
    console.error('[SEED] ❌ Seeding failed:', error.message);
    console.error(error);
=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
    process.exit(1);
  }

  process.exit(0);
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('seed-dev-question')) {
  main();
}

export { main as seedDevQuestion };