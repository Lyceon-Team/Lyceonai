import fs from 'fs';
import { extractTextFromPDF } from './server/services/pdfjs-extractor.js';

async function debugSATFormat() {
  try {
    // Use a smaller SAT file for debugging
    const filePath = 'attached_assets/SAT Suite Question Bank - math17_1757908640839.pdf';
    console.log(`📄 Reading PDF: ${filePath}`);
    
    const buffer = fs.readFileSync(filePath);
    console.log(`📄 File size: ${buffer.length} bytes`);
    
    // Extract text using PDF.js
    console.log(`🔍 Extracting text using PDF.js...`);
    const result = await extractTextFromPDF(buffer);
    
    console.log(`📄 Extracted ${result.text.length} characters from ${result.pageCount} pages`);
    
    // Show first 2000 characters to understand format
    console.log(`\n🔍 FIRST 2000 CHARACTERS:`);
    console.log(`"${result.text.substring(0, 2000)}"`);
    
    // Check for key patterns
    console.log(`\n🔍 PATTERN ANALYSIS:`);
    console.log(`Text contains 'Question ID': ${result.text.includes('Question ID')}`);
    console.log(`Text contains 'ID:': ${result.text.includes('ID:')}`);
    console.log(`Text contains 'Assessment': ${result.text.includes('Assessment')}`);
    console.log(`Text contains 'Test': ${result.text.includes('Test')}`);
    console.log(`Text contains 'Domain': ${result.text.includes('Domain')}`);
    console.log(`Text contains 'Skill': ${result.text.includes('Skill')}`);
    
    // Count patterns
    const questionIdMatches = (result.text.match(/Question ID\s+[a-f0-9]+/gi) || []);
    const idColonMatches = (result.text.match(/ID:\s*[a-f0-9]+/gi) || []);
    const assessmentMatches = (result.text.match(/Assessment\s+SAT/gi) || []);
    
    console.log(`\n🔍 PATTERN COUNTS:`);
    console.log(`Question ID patterns: ${questionIdMatches.length}`);
    if (questionIdMatches.length > 0) {
      console.log(`First few: ${questionIdMatches.slice(0, 3).join(', ')}`);
    }
    console.log(`ID: patterns: ${idColonMatches.length}`);
    if (idColonMatches.length > 0) {
      console.log(`First few: ${idColonMatches.slice(0, 3).join(', ')}`);
    }
    console.log(`Assessment patterns: ${assessmentMatches.length}`);
    
    // Try the same splitting logic used in the legacy bulk parser
    console.log(`\n🔍 TESTING SPLITTING LOGIC:`);
    const questionBlocks = result.text.split(/(?=Question ID\s+[a-f0-9]+)/gi).filter(block => block.trim().length > 0);
    console.log(`Split into ${questionBlocks.length} blocks using Question ID pattern`);
    
    if (questionBlocks.length > 0) {
      console.log(`\n🔍 FIRST BLOCK (${questionBlocks[0].length} chars):`);
      console.log(`"${questionBlocks[0].substring(0, 1000)}"`);
      
      if (questionBlocks.length > 1) {
        console.log(`\n🔍 SECOND BLOCK (${questionBlocks[1].length} chars):`);
        console.log(`"${questionBlocks[1].substring(0, 1000)}"`);
      }
    }
    
    // Try alternative splitting patterns
    const idColonBlocks = result.text.split(/(?=ID:\s*[a-f0-9]+(?!\s+Answer))/gi).filter(block => block.trim().length > 0);
    console.log(`\n🔍 Split into ${idColonBlocks.length} blocks using ID: pattern`);
    
    // Look for option patterns
    const optionMatches = (result.text.match(/^\s+[ABCD]\./gm) || []);
    console.log(`\n🔍 OPTION PATTERNS:`);
    console.log(`SAT format options (leading space): ${optionMatches.length}`);
    if (optionMatches.length > 0) {
      console.log(`First few: ${optionMatches.slice(0, 5).join(', ')}`);
    }
    
    const standardOptionMatches = (result.text.match(/^[ABCD]\./gm) || []);
    console.log(`Standard format options: ${standardOptionMatches.length}`);
    
    console.log(`\n🎯 DEBUG COMPLETE!`);
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

debugSATFormat().catch(console.error);