/**
 * DEVELOPMENT ONLY: Seed a synthetic SAT question for RAG v2 testing.
 */

import { generateEmbedding } from '../src/lib/embeddings';
import { supabase } from '../src/lib/vector';

const CANONICAL_ID = 'SATMATH1DEV001';

const devQuestion = {
  canonical_id: CANONICAL_ID,
  status: 'published',
  section: 'Math',
  section_code: 'MATH',
  question_type: 'multiple_choice',
  stem: 'If 2x + 5 = 15, what is the value of x?',
  options: [
    { key: 'A', text: '3' },
    { key: 'B', text: '4' },
    { key: 'C', text: '5' },
    { key: 'D', text: '10' },
  ],
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
          section: devQuestion.section,
          section_code: devQuestion.section_code,
          question_type: devQuestion.question_type,
          stem: devQuestion.stem,
          options: devQuestion.options,
          correct_answer: devQuestion.correct_answer,
          answer_text: devQuestion.answer_text,
          explanation: devQuestion.explanation,
          option_metadata: devQuestion.option_metadata,
          domain: devQuestion.domain,
          skill: devQuestion.skill,
          subskill: devQuestion.subskill,
          skill_code: devQuestion.skill_code,
          difficulty: devQuestion.difficulty,
          source_type: devQuestion.source_type,
          test_code: devQuestion.test_code,
          exam: devQuestion.exam,
          ai_generated: devQuestion.ai_generated,
          tags: devQuestion.tags,
          competencies: devQuestion.competencies,
          diagram_present: devQuestion.diagram_present,
          provenance_chunk_ids: devQuestion.provenance_chunk_ids,
        })
        .eq('canonical_id', CANONICAL_ID);

      if (updateError) {
        console.error('[SEED] Error updating question:', updateError);
        throw updateError;
      }

      console.log('[SEED] Updated existing question:', { canonicalId: CANONICAL_ID, id: questionId });
    } else {
      console.log('[SEED] Inserting new question...');

      const { data: newQ, error: insertError } = await supabase
        .from('questions')
        .insert(devQuestion)
        .select('id')
        .single();

      if (insertError) {
        console.error('[SEED] Error inserting question:', insertError);
        throw insertError;
      }

      questionId = newQ!.id;
      console.log('[SEED] Inserted new question:', { canonicalId: CANONICAL_ID, id: questionId });
    }

    console.log('\n[SEED] ✅ Question seeded successfully!');

    console.log('\n[SEED] Attempting to generate embedding (may fail if vector schema mismatches)...');

    try {
      const optionsText = devQuestion.options.map((opt) => `${opt.key}. ${opt.text}`).join('\n');
      const content = `${devQuestion.stem}\n${optionsText}`;

      const embedding = await generateEmbedding(content);
      console.log('[SEED] Generated embedding with', embedding.length, 'dimensions');

      const embeddingMetadata = {
        difficulty: devQuestion.difficulty,
        canonicalId: CANONICAL_ID,
        testCode: devQuestion.test_code,
        sectionCode: devQuestion.section_code,
        competencyCodes: devQuestion.competencies.map((c) => c.code),
      };

      const { error: insertError } = await supabase
        .from('question_embeddings')
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
    process.exit(1);
  }

  process.exit(0);
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('seed-dev-question')) {
  main();
}

export { main as seedDevQuestion };