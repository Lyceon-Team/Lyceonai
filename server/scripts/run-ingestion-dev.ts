import { IngestionWorker, memoryJobs } from '../services/ingestionWorker';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🧪 [DEV-INGEST] Starting dev ingestion test...\n');
  
  const pdfPath = path.resolve(__dirname, '../../attached_assets/SAT Suite Question Bank - math17_1758972100863.pdf');
  
  const altPaths = [
    path.resolve(__dirname, '../../uploads/sat-math-200.pdf'),
    path.resolve(__dirname, '../../attached_assets/SAT Suite Question Bank - math30_1759007471774.pdf'),
  ];
  
  let selectedPath = pdfPath;
  if (!fs.existsSync(pdfPath)) {
    console.log(`⚠️ Primary PDF not found: ${pdfPath}`);
    for (const alt of altPaths) {
      if (fs.existsSync(alt)) {
        selectedPath = alt;
        console.log(`✅ Using alternative PDF: ${alt}`);
        break;
      }
    }
  }
  
  if (!fs.existsSync(selectedPath)) {
    console.error('❌ No test PDF found. Please ensure a PDF exists in attached_assets/ or uploads/');
    process.exit(1);
  }
  
  console.log(`📄 PDF selected: ${selectedPath}\n`);
  
  const worker = new IngestionWorker({
    maxConcurrentJobs: 1,
    enableOCR: true,
    enableQA: true,
    enableRAG: true,
    retryAttempts: 1,
  });
  
  const job = worker.createJob({ 
    pdfPath: selectedPath, 
    filename: path.basename(selectedPath),
  });
  
  console.log(`📋 Created job: ${job.id}`);
  console.log(`   Filename: ${job.filename}`);
  console.log(`   Status: ${job.status}\n`);
  
  console.log('🚀 Starting ingestion...\n');
  const startTime = Date.now();
  
  await worker.startJob(job.id);
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  const finalJob = memoryJobs.get(job.id);
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 INGESTION RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (finalJob) {
    console.log(`   Job ID: ${finalJob.id}`);
    console.log(`   Status: ${finalJob.status}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   Total Pages: ${finalJob.totalPages || 'N/A'}`);
    console.log(`   Questions Found: ${finalJob.questionsFound || 'N/A'}`);
    console.log(`   Questions Imported: ${finalJob.questionsImported || 'N/A'}`);
    
    if (finalJob.ocrStats) {
      console.log('\n📈 OCR Stats:');
      console.log(`   Provider: ${finalJob.ocrStats.providerUsed}`);
      console.log(`   DocAI pages: ${finalJob.ocrStats.byEngine.docai.pages}`);
      console.log(`   Nougat pages: ${finalJob.ocrStats.byEngine.nougat.pages}`);
      if (finalJob.ocrStats.errors.length > 0) {
        console.log(`   Errors: ${finalJob.ocrStats.errors.length}`);
      }
    }
    
    if (finalJob.error) {
      console.log(`\n❌ Error: ${finalJob.error}`);
    }
  } else {
    console.log('❌ Job not found in memory after completion');
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (finalJob?.status === 'DONE') {
    console.log('✅ Ingestion completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Query Supabase to verify questions in sat_questions table');
    console.log('   2. Check question_embeddings table for RAG embeddings');
    console.log('   3. Test /api/rag/v2 endpoint with a sample query');
    console.log('   4. Test /api/tutor/v2 endpoint for AI tutoring');
  } else if (finalJob?.status === 'FAILED') {
    console.log('❌ Ingestion failed. Check logs above for details.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
