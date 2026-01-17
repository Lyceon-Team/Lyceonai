#!/usr/bin/env node

/**
 * Test script to analyze SAT PDF format using the new diagnostic endpoint
 * This helps identify why parsing is failing despite successful text extraction
 */

import fs from 'fs';
import path from 'path';

async function testPDFFormat() {
  console.log('🔍 Testing SAT PDF format analysis...\n');
  
  // Use one of the SAT PDFs for testing
  const testPDF = 'attached_assets/SAT Suite Question Bank - math17_1758172471963.pdf';
  
  if (!fs.existsSync(testPDF)) {
    console.error(`❌ Test PDF not found: ${testPDF}`);
    process.exit(1);
  }

  console.log(`📄 Analyzing: ${testPDF}`);
  
  try {
    // Read the PDF file
    const fileBuffer = fs.readFileSync(testPDF);
    console.log(`📦 File size: ${fileBuffer.length} bytes`);

    // Use the diagnostic pipeline directly
    const { processPDFForBulkIngestion } = await import('./server/services/pdf-processing-pipeline.ts');
    
    console.log('🔄 Extracting text...');
    const result = await processPDFForBulkIngestion(fileBuffer, path.basename(testPDF));
    
    if (!result.success) {
      console.error('❌ Text extraction failed:', result.metadata?.errors);
      process.exit(1);
    }
    
    const text = result.text;
    console.log(`✅ Extracted ${text.length} characters using ${result.extractionMethod}`);
    
    // Analyze format
    console.log('\n🔍 FORMAT ANALYSIS:');
    console.log('==================');
    
    // Show first 2000 characters
    console.log('\n📝 First 2000 characters:');
    console.log('---');
    console.log(`"${text.substring(0, 2000)}"`);
    console.log('---\n');
    
    // Pattern analysis
    const patterns = {
      questionId: (text.match(/Question ID\s+[a-f0-9]+/gi) || []).length,
      idColon: (text.match(/ID:\s*[a-f0-9]+/gi) || []).length,
      hexIds: (text.match(/\b[a-f0-9]{8}\b/gi) || []).length,
      assessments: (text.match(/Assessment\s+SAT/gi) || []).length,
      correctAnswers: (text.match(/Correct Answer:\s*[ABCD]/gi) || []).length,
      optionPatterns: {
        leadingSpace: (text.match(/^\s+[ABCD]\./gm) || []).length,
        standard: (text.match(/^[ABCD]\./gm) || []).length,
        flexible: (text.match(/\b[ABCD]\)\s*/g) || []).length
      }
    };
    
    console.log('📊 Pattern counts:');
    console.log(`   Question ID patterns: ${patterns.questionId}`);
    console.log(`   ID: patterns: ${patterns.idColon}`);
    console.log(`   8-char hex IDs: ${patterns.hexIds}`);
    console.log(`   Assessment patterns: ${patterns.assessments}`);
    console.log(`   Correct Answer patterns: ${patterns.correctAnswers}`);
    console.log('\n📋 Option patterns:');
    console.log(`   Leading space (SAT): ${patterns.optionPatterns.leadingSpace}`);
    console.log(`   Standard format: ${patterns.optionPatterns.standard}`);
    console.log(`   Flexible format: ${patterns.optionPatterns.flexible}`);
    
    // Sample patterns
    console.log('\n🔍 Sample patterns found:');
    console.log('========================');
    
    const samples = {
      questionIds: (text.match(/Question ID\s+[a-f0-9]+/gi) || []).slice(0, 5),
      idColons: (text.match(/ID:\s*[a-f0-9]+/gi) || []).slice(0, 5),
      assessments: (text.match(/Assessment\s+[^\n]+/gi) || []).slice(0, 3),
      answers: (text.match(/Correct Answer:\s*[^\n]+/gi) || []).slice(0, 5)
    };
    
    if (samples.questionIds.length > 0) {
      console.log('📌 Question ID samples:', samples.questionIds);
    }
    if (samples.idColons.length > 0) {
      console.log('📌 ID: samples:', samples.idColons);
    }
    if (samples.assessments.length > 0) {
      console.log('📌 Assessment samples:', samples.assessments);
    }
    if (samples.answers.length > 0) {
      console.log('📌 Answer samples:', samples.answers);
    }
    
    // Show line structure (first 50 lines)
    console.log('\n📄 Line structure (first 50 lines):');
    console.log('===================================');
    const lines = text.split('\n').slice(0, 50);
    lines.forEach((line, i) => {
      console.log(`${String(i + 1).padStart(2, '0')}: "${line}"`);
    });
    
    console.log('\n✅ Format analysis complete!');
    console.log('\n💡 Next steps:');
    console.log('   1. Compare patterns above with parser expectations');
    console.log('   2. Identify mismatches in regex patterns');  
    console.log('   3. Fix parsing logic based on actual format');
    
  } catch (error) {
    console.error('❌ Error during format analysis:', error);
    process.exit(1);
  }
}

// Run the test
testPDFFormat().catch(console.error);