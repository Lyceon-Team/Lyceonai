import { db } from '../apps/api/src/db/client';
import { questions } from '../shared/schema';
import { isNotNull } from 'drizzle-orm';
import { storeQuestionEmbedding, initializeVectorTable } from '../apps/api/src/lib/supabase';

async function syncEmbeddingsToSupabase() {
  console.log('🚀 Starting Supabase sync process...\n');

  // Check if Supabase is properly configured
  console.log('🔍 Checking Supabase vector table setup...');
  await initializeVectorTable();
  console.log('');

  // Get all questions with embeddings
  const questionsWithEmbeddings = await db
    .select()
    .from(questions)
    .where(isNotNull(questions.embedding));

  console.log(`📊 Found ${questionsWithEmbeddings.length} questions with embeddings to sync\n`);

  if (questionsWithEmbeddings.length === 0) {
    console.log('⚠️  No questions with embeddings found!');
    console.log('💡 Run the embedding generation script first.');
    return;
  }

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  // Process questions in batches of 10
  const batchSize = 10;
  for (let i = 0; i < questionsWithEmbeddings.length; i += batchSize) {
    const batch = questionsWithEmbeddings.slice(i, i + batchSize);
    console.log(`\n📦 Syncing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(questionsWithEmbeddings.length / batchSize)}...`);

    for (const question of batch) {
      try {
        // Check if embedding exists
        if (!question.embedding || !Array.isArray(question.embedding)) {
          console.log(`  ⏭️  Skipping question ${question.id} (no valid embedding)`);
          skippedCount++;
          continue;
        }

        console.log(`  ⏳ Syncing question ${question.id} to Supabase...`);
        
        // Store in Supabase
        await storeQuestionEmbedding(
          question.id,
          question.embedding as number[],
          question.stem,
          question.section,
          {
            unitTag: question.unitTag,
            difficultyLevel: question.difficultyLevel,
            type: question.type,
          }
        );
        
        successCount++;
        console.log(`  ✅ Successfully synced question ${question.id}`);
      } catch (error: any) {
        failCount++;
        if (error.message?.includes('question_embeddings')) {
          console.error(`  ❌ Supabase table not set up! Please run database/supabase-vector-setup.sql on your Supabase instance.`);
          console.error(`  💡 Then run this script again.`);
          process.exit(1);
        } else {
          console.error(`  ❌ Failed to sync question ${question.id}:`, error.message);
        }
      }
    }

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < questionsWithEmbeddings.length) {
      console.log('  ⏸️  Pausing 1s before next batch...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📈 Supabase Sync Complete!');
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`⏭️  Skipped: ${skippedCount}`);
  console.log(`📊 Total: ${questionsWithEmbeddings.length}`);
  console.log('='.repeat(50));
}

// Run the script
syncEmbeddingsToSupabase()
  .then(() => {
    console.log('\n✨ Sync script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Sync script failed:', error);
    process.exit(1);
  });
