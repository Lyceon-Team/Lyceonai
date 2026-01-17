#!/usr/bin/env node

/**
 * Test script to verify the fixed SAT question parser
 * This should now successfully parse questions from SAT PDFs
 */

import fs from 'fs';
import path from 'path';

async function testFixedParser() {
  console.log('🧪 Testing FIXED SAT question parser...\n');
  
  // Use one of the SAT PDFs for testing
  const testPDF = 'attached_assets/SAT Suite Question Bank - math17_1758172471963.pdf';
  
  if (!fs.existsSync(testPDF)) {
    console.error(`❌ Test PDF not found: ${testPDF}`);
    process.exit(1);
  }

  console.log(`📄 Testing with: ${testPDF}`);
  
  try {
    // Read the PDF file
    const fileBuffer = fs.readFileSync(testPDF);
    console.log(`📦 File size: ${fileBuffer.length} bytes\n`);

    // Extract text using the pipeline
    const { processPDFForBulkIngestion } = await import('./server/services/pdf-processing-pipeline.ts');
    
    console.log('🔄 Step 1: Extracting text...');
    const extractionResult = await processPDFForBulkIngestion(fileBuffer, path.basename(testPDF));
    
    if (!extractionResult.success) {
      console.error('❌ Text extraction failed:', extractionResult.metadata?.errors);
      process.exit(1);
    }
    
    console.log(`✅ Extracted ${extractionResult.text.length} characters using ${extractionResult.method}\n`);
    
    // Parse questions using the FIXED parser
    const { PDFQuestionParser } = await import('./server/pdf-parser.ts');
    const parser = new PDFQuestionParser();
    
    console.log('🔄 Step 2: Parsing questions with FIXED logic...');
    const parsedQuestions = await parser.parseTextContent(extractionResult.text, path.basename(testPDF));
    
    console.log(`\n🎉 PARSING RESULTS:`);
    console.log(`==================`);
    console.log(`📋 Questions parsed: ${parsedQuestions.length}`);
    
    if (parsedQuestions.length > 0) {
      console.log('\n📝 Sample questions:');
      console.log('-------------------');
      
      for (let i = 0; i < Math.min(3, parsedQuestions.length); i++) {
        const q = parsedQuestions[i];
        console.log(`\n${i + 1}. Question ID: ${q.questionId}`);
        console.log(`   Type: ${q.questionType}`);
        console.log(`   Answer: ${q.answer}`);
        console.log(`   Stem: ${q.stem.substring(0, 150)}...`);
        console.log(`   Options: ${q.options ? `${q.options.length} options` : 'none'}`);
        if (q.options) {
          q.options.forEach(opt => {
            console.log(`     ${opt.key}. ${opt.text.substring(0, 50)}...`);
          });
        }
        console.log(`   Section: ${q.section}`);
        console.log(`   Domain: ${q.domain}`);
        console.log(`   Difficulty: ${q.difficulty}`);
      }
      
      console.log(`\n✅ SUCCESS! Parser is now working correctly.`);
      console.log(`📊 Summary:`);
      console.log(`   • Multiple choice: ${parsedQuestions.filter(q => q.questionType === 'multiple_choice').length}`);
      console.log(`   • Free response: ${parsedQuestions.filter(q => q.questionType === 'free_response').length}`);
      console.log(`   • Unique domains: ${new Set(parsedQuestions.map(q => q.domain)).size}`);
      console.log(`   • Difficulties: ${new Set(parsedQuestions.map(q => q.difficulty)).size}`);
      
    } else {
      console.log(`❌ Still no questions parsed. Check the parser logic again.`);
      
      // Debug info
      console.log('\n🔍 Debug information:');
      console.log(`Text contains "Question ID": ${extractionResult.text.includes('Question ID')}`);
      console.log(`Text contains "Correct Answer": ${extractionResult.text.includes('Correct Answer')}`);
      console.log(`Text contains "A. B. C. D.": ${extractionResult.text.includes('A. B. C. D.')}`);
      
      const questionIds = (extractionResult.text.match(/Question ID\s+[a-f0-9]+/gi) || []).length;
      const answers = (extractionResult.text.match(/Correct Answer:\s*[ABCD]/gi) || []).length;
      console.log(`Question ID patterns found: ${questionIds}`);
      console.log(`Answer patterns found: ${answers}`);
    }
    
  } catch (error) {
    console.error('❌ Error during parser test:', error);
    process.exit(1);
  }
}

// Run the test
testFixedParser().catch(console.error);