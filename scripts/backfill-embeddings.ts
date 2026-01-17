#!/usr/bin/env tsx
import 'dotenv/config';
import { getDb } from '../apps/api/src/db/client';
import { generateEmbedding } from '../apps/api/src/lib/embeddings';
import { questions } from '../shared/schema';
import { eq, isNull } from 'drizzle-orm';

async function main() {
  console.log('🔄 Starting embeddings backfill...');
  
  const db = getDb();
  const BATCH_SIZE = 100;
  const model = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small';
  
  console.log(`📊 Using embeddings model: ${model}`);
  
  // Fetch all questions that don't have embeddings or need to be regenerated
  const allQuestions = await db
    .select()
    .from(questions)
    .where(isNull(questions.embedding));
  
  console.log(`📝 Found ${allQuestions.length} questions without embeddings`);
  
  if (allQuestions.length === 0) {
    console.log('✅ All questions already have embeddings!');
    return;
  }

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < allQuestions.length; i += BATCH_SIZE) {
    const batch = allQuestions.slice(i, i + BATCH_SIZE);
    
    console.log(`\n🔄 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allQuestions.length / BATCH_SIZE)}...`);
    
    for (const question of batch) {
      try {
        // Build text for embedding from question content
        const textParts = [question.stem];
        
        if (question.options && question.options.length > 0) {
          textParts.push('Options: ' + question.options.join(', '));
        }
        
        if (question.explanation) {
          textParts.push('Explanation: ' + question.explanation);
        }
        
        const textToEmbed = textParts.join('\n');
        
        // Generate embedding
        const embedding = await generateEmbedding(textToEmbed);
        
        // Update question with embedding
        await db
          .update(questions)
          .set({ 
            embedding: JSON.stringify(embedding),
            updatedAt: new Date()
          })
          .where(eq(questions.id, question.id));
        
        processed++;
        
        if (processed % 10 === 0) {
          console.log(`  ✅ Processed ${processed}/${allQuestions.length} questions`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to process question ${question.id}:`, error instanceof Error ? error.message : error);
        failed++;
      }
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < allQuestions.length) {
      console.log('  ⏳ Waiting 1 second before next batch...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\n📊 Backfill Summary:');
  console.log(`  ✅ Successfully processed: ${processed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📝 Total: ${allQuestions.length}`);
  console.log('\n✨ Backfill complete!');
}

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
