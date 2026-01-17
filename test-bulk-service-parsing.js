#!/usr/bin/env node

/**
 * DIRECT TEST: Compare bulk service parsing vs individual parser on the same text
 * This will identify exactly where the difference is
 */

import fs from 'fs';
import path from 'path';

async function testBulkServiceParsing() {
  console.log('🔬 DIRECT BULK SERVICE PARSING TEST');
  console.log('=====================================\n');
  
  const testPDF = 'attached_assets/SAT Suite Question Bank - math17_1758172471963.pdf';
  
  if (!fs.existsSync(testPDF)) {
    console.error(`❌ Test PDF not found: ${testPDF}`);
    process.exit(1);
  }

  try {
    // Step 1: Extract text using the same pipeline
    console.log('🔄 Step 1: Extracting text...');
    const fileBuffer = fs.readFileSync(testPDF);
    const { processPDFForBulkIngestion } = await import('./server/services/pdf-processing-pipeline.ts');
    const extractionResult = await processPDFForBulkIngestion(fileBuffer, path.basename(testPDF));
    
    if (!extractionResult.success) {
      console.error('❌ Text extraction failed');
      process.exit(1);
    }
    
    const text = extractionResult.text;
    console.log(`✅ Extracted ${text.length} characters\n`);
    
    // Step 2: Test INDIVIDUAL parser (which works)
    console.log('🔄 Step 2: Testing INDIVIDUAL parser (should work)...');
    const { PDFQuestionParser } = await import('./server/pdf-parser.ts');
    const individualParser = new PDFQuestionParser();
    const individualResults = await individualParser.parseTextContent(text, path.basename(testPDF));
    console.log(`✅ Individual parser result: ${individualResults.length} questions\n`);
    
    // Step 3: Test BULK SERVICE parsing directly (which fails)
    console.log('🔄 Step 3: Testing BULK SERVICE parsing directly...');
    const { SATBulkIngestionService } = await import('./server/services/sat-bulk-ingestion.ts');
    const bulkService = new SATBulkIngestionService();
    
    // Access the private parsing method via reflection
    const bulkResults = bulkService.parseSATQuestions(text, 'Math');
    console.log(`❌ Bulk service result: ${bulkResults.length} questions\n`);
    
    // Step 4: COMPARE THE METHODS
    console.log('🔍 COMPARISON ANALYSIS:');
    console.log('=======================');
    console.log(`Individual parser: ${individualResults.length} questions parsed ✅`);
    console.log(`Bulk service parser: ${bulkResults.length} questions parsed ❌`);
    
    if (individualResults.length > 0) {
      console.log('\n📝 INDIVIDUAL PARSER SUCCESS - Sample question:');
      const sample = individualResults[0];
      console.log(`   ID: ${sample.questionId}`);
      console.log(`   Answer: ${sample.answer}`);
      console.log(`   Options: ${sample.options ? sample.options.length : 'none'}`);
      console.log(`   Stem: ${sample.stem.substring(0, 100)}...`);
    }
    
    // Step 5: DEBUG - Show exactly what bulk service is seeing
    console.log('\n🔍 BULK SERVICE DEBUG:');
    console.log('=====================');
    console.log('Let me manually call the bulk service parsing with debug output...');
    
    // Manually check question splitting
    const questionBlocks = text.split(/(?=Question ID\s+[a-f0-9]+)/gi).filter(block => block.trim().length > 0);
    console.log(`🔍 Manual question splitting found: ${questionBlocks.length} blocks`);
    
    if (questionBlocks.length > 0) {
      console.log(`🔍 First block length: ${questionBlocks[0].length} chars`);
      console.log(`🔍 First 500 chars of block:\n"${questionBlocks[0].substring(0, 500)}"`);
      
      // Check if my placeholder pattern detection works
      const placeholderMatch = questionBlocks[0].match(/\b([ABCD])\.\s*([ABCD])\.\s*([ABCD])\.\s*([ABCD])\.\s*(?=ID:|Answer)/);
      const inlineMatch = questionBlocks[0].match(/([ABCD])\.\s*([ABCD])\.\s*([ABCD])\.\s*([ABCD])\./);
      
      console.log(`🔍 Placeholder pattern match: ${placeholderMatch ? 'FOUND' : 'NOT FOUND'}`);
      console.log(`🔍 Inline pattern match: ${inlineMatch ? 'FOUND' : 'NOT FOUND'}`);
      
      if (placeholderMatch) {
        console.log(`🎯 Placeholder pattern: "${placeholderMatch[0]}"`);
      }
      if (inlineMatch) {
        console.log(`🎯 Inline pattern: "${inlineMatch[0]}"`);
      }
      
      // Check question ID extraction
      const questionIdMatch = questionBlocks[0].match(/Question ID\s+([a-f0-9]+)/i);
      console.log(`🔍 Question ID match: ${questionIdMatch ? questionIdMatch[1] : 'NOT FOUND'}`);
      
      // Check answer extraction
      const answerMatch = questionBlocks[0].match(/(Correct Answer|Answer):\s*([A-D]|\d+|.+?)(?=\n|Rationale|Question ID|$)/i);
      console.log(`🔍 Answer match: ${answerMatch ? answerMatch[2] : 'NOT FOUND'}`);
    }
    
    console.log('\n💡 CONCLUSION:');
    console.log('===============');
    if (individualResults.length > 0 && bulkResults.length === 0) {
      console.log('❌ BULK SERVICE HAS A BUG - Individual parser works, bulk service fails');
      console.log('🔧 Need to fix the bulk service parsing logic');
    } else {
      console.log('🤔 Both parsers failing - need to investigate text format');
    }
    
  } catch (error) {
    console.error('❌ Error during direct test:', error);
    process.exit(1);
  }
}

// Run the direct test
testBulkServiceParsing().catch(console.error);