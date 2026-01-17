import { db } from '../apps/api/src/db/client';
import { questions } from '../shared/schema';
import { isNull } from 'drizzle-orm';
import { generateEmbedding } from '../apps/api/src/lib/embeddings';
import { storeQuestionEmbedding } from '../apps/api/src/lib/supabase';

async function generateAndStoreEmbeddings() {
  console.log('🚀 Starting embedding generation process...\n');

  // Get questions without embeddings
  const questionsWithoutEmbeddings = await db
    .select()
    .from(questions)
    .where(isNull(questions.embedding));

  console.log(`📊 Found ${questionsWithoutEmbeddings.length} questions without embeddings\n`);

  if (questionsWithoutEmbeddings.length === 0) {
    console.log('✅ All questions already have embeddings!');
    return;
  }

  let successCount = 0;
  let failCount = 0;

  // Process questions in batches of 10
  const batchSize = 10;
  for (let i = 0; i < questionsWithoutEmbeddings.length; i += batchSize) {
    const batch = questionsWithoutEmbeddings.slice(i, i + batchSize);
    console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(questionsWithoutEmbeddings.length / batchSize)}...`);

    for (const question of batch) {
      try {
        console.log(`  ⏳ Generating embedding for question ${question.id}...`);
        
        // Generate embedding for the question stem
        const embedding = await generateEmbedding(question.stem);
        
        // Store in PostgreSQL
        await db
          .update(questions)
          .set({ embedding: embedding as any })
          .where(eq(questions.id, question.id));
        
        // Store in Supabase
        await storeQuestionEmbedding(
          question.id,
          embedding,
          question.stem,
          question.section,
          {
            unitTag: question.unitTag,
            difficultyLevel: question.difficultyLevel,
            type: question.type,
          }
        );
        
        successCount++;
        console.log(`  ✅ Successfully embedded question ${question.id}`);
      } catch (error) {
        failCount++;
        console.error(`  ❌ Failed to embed question ${question.id}:`, error);
      }
    }

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < questionsWithoutEmbeddings.length) {
      console.log('  ⏸️  Pausing 1s before next batch...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📈 Embedding Generation Complete!');
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📊 Total: ${questionsWithoutEmbeddings.length}`);
  console.log('='.repeat(50));
}

// Import eq from drizzle-orm
import { eq } from 'drizzle-orm';

// Run the script
generateAndStoreEmbeddings()
  .then(() => {
    console.log('\n✨ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
