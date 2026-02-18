// Script to manually trigger SAT knowledge integration
import { integrateSATKnowledgeFromFile } from './server/services/sat-knowledge-integrator.js';

async function triggerIntegration() {
  try {
    console.log('🚀 Manually triggering SAT knowledge integration...');
    
    const result = await integrateSATKnowledgeFromFile('sat-knowledge-base.md');
    
    if (result.success) {
      console.log('✅ Integration successful!');
      console.log(`Document ID: ${result.documentId}`);
      console.log(`Chunks created: ${result.chunksCreated}`);
    } else {
      console.log('❌ Integration failed:', result.error);
    }
    
    return result.success;
  } catch (error) {
    console.error('Integration trigger failed:', error);
    return false;
  }
}

triggerIntegration().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Failed to run integration:', error);
  process.exit(1);
});