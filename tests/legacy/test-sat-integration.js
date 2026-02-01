// Test script to verify SAT knowledge base integration
import { storage } from './server/storage.js';
import { vectorStore } from './server/services/vector-store.js';

async function testSATIntegration() {
  try {
    console.log('🧪 Testing SAT Knowledge Base Integration...\n');
    
    // 1. Check if SAT knowledge document exists
    console.log('1️⃣ Checking for SAT knowledge document...');
    const documents = await storage.getDocuments();
    const satDoc = documents.find(doc => 
      doc.filename === 'sat-knowledge-base.md' || 
      doc.originalName.includes('SAT Knowledge Base')
    );
    
    if (satDoc) {
      console.log(`✅ Found SAT knowledge document: ${satDoc.id}`);
      console.log(`   Status: ${satDoc.status}`);
      console.log(`   Size: ${satDoc.size} bytes`);
      console.log(`   Extraction method: ${satDoc.extractionMethod || 'N/A'}`);
      console.log(`   Confidence: ${satDoc.extractionConfidence || 'N/A'}%`);
    } else {
      console.log('❌ SAT knowledge document not found');
      return false;
    }
    
    // 2. Check chunks created from the document
    console.log('\n2️⃣ Checking document chunks...');
    const chunks = await storage.getChunksByDocument(satDoc.id);
    console.log(`✅ Found ${chunks.length} chunks`);
    
    if (chunks.length > 0) {
      // Analyze chunk types
      const chunkTypes = {};
      chunks.forEach(chunk => {
        chunkTypes[chunk.type] = (chunkTypes[chunk.type] || 0) + 1;
      });
      
      console.log('   Chunk breakdown:');
      Object.entries(chunkTypes).forEach(([type, count]) => {
        console.log(`   - ${type}: ${count} chunks`);
      });
      
      // Show sample chunk
      const sampleChunk = chunks[0];
      console.log(`   Sample chunk (${sampleChunk.type}): "${sampleChunk.content.slice(0, 100)}..."`);
      console.log(`   Has embedding: ${sampleChunk.embedding ? 'Yes' : 'No'}`);
      if (sampleChunk.embedding) {
        console.log(`   Embedding dimensions: ${sampleChunk.embedding.length}`);
      }
    }
    
    // 3. Test vector search functionality
    console.log('\n3️⃣ Testing vector search...');
    try {
      const searchResults = await vectorStore.unifiedSearch('What are the SAT testing rules?', {
        limit: 5,
        includeQuestions: false,
        includeChunks: true
      });
      
      console.log(`✅ Search returned ${searchResults.chunks.length} relevant chunks`);
      if (searchResults.chunks.length > 0) {
        console.log('   Top result preview:');
        console.log(`   "${searchResults.chunks[0].content.slice(0, 150)}..."`);
      }
      
      // Test another search
      const structureSearch = await vectorStore.unifiedSearch('digital SAT structure and timing', {
        limit: 3,
        includeQuestions: false,
        includeChunks: true
      });
      
      console.log(`✅ Structure search returned ${structureSearch.chunks.length} chunks`);
      
    } catch (searchError) {
      console.log(`❌ Search test failed: ${searchError.message}`);
    }
    
    // 4. Test concept-specific searches
    console.log('\n4️⃣ Testing concept-specific searches...');
    const testQueries = [
      'adaptive testing system',
      'scoring benchmarks',
      'accommodations and accessibility',
      'prohibited items and violations',
      'Bluebook app requirements'
    ];
    
    for (const query of testQueries) {
      try {
        const results = await vectorStore.unifiedSearch(query, {
          limit: 2,
          includeQuestions: false,
          includeChunks: true
        });
        console.log(`   "${query}": ${results.chunks.length} results`);
      } catch (error) {
        console.log(`   "${query}": Search failed`);
      }
    }
    
    console.log('\n✅ SAT Knowledge Base Integration Test Complete!');
    console.log(`📊 Summary: ${chunks.length} chunks created from SAT knowledge document`);
    return true;
    
  } catch (error) {
    console.error('❌ Integration test failed:', error);
    return false;
  }
}

// Run the test
testSATIntegration().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});