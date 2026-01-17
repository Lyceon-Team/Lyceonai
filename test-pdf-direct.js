// Direct test of PDF processing
import fs from 'fs';
import path from 'path';

// Import the PDF processor directly
async function testPDFProcessing() {
  try {
    // Import the PDF processor service
    const { processPDFFile } = await import('./server/services/pdf-processor.ts');
    
    // Read the uploaded PDF file
    const pdfPath = 'uploads/sat-math-200.pdf';
    const pdfBuffer = fs.readFileSync(pdfPath);
    
    console.log(`PDF file size: ${pdfBuffer.length} bytes`);
    
    // Process the PDF
    console.log('Starting PDF processing...');
    const result = await processPDFFile(pdfBuffer, 'sat-math-200.pdf');
    
    console.log('Processing result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('Error testing PDF processing:', error);
  }
}

testPDFProcessing();