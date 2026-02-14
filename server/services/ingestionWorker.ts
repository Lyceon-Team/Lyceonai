/**
 * Ingestion Job Worker for PDF Ingestion v2
 * Orchestrates the complete ingestion pipeline with state machine:
 * PENDING → OCR → PARSE → QA → EMBED → DONE
 * 
 * Features:
 * - Concurrency control (max parallel jobs)
 * - State persistence to ingestion_runs table
 * - Error handling and retry logic
 * - Progress tracking
 */

import { OcrOrchestrator } from './ocrOrchestrator';
import { SatParser, toQuestionDocs, questionDocsToParsedQuestions } from './satParser';
import { QAValidator } from './qaValidator';
import { RAGPipeline } from './ragPipeline';
import { extractQuestionsFromPages, isVisionPipelineEnabled, getVisionConfig } from './visionSchemaExtractor';
import type { QuestionDoc } from './questionTypes';
import { supabaseServer } from '../../apps/api/src/lib/supabase-server';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { JobPersistence } from './jobPersistenceSupabase';
import type { OcrStats } from './ocrOrchestrator';

export type IngestionStatus = 
  | 'PENDING' 
  | 'OCR_IN_PROGRESS' 
  | 'PARSE_IN_PROGRESS' 
  | 'QA_IN_PROGRESS' 
  | 'EMBED_IN_PROGRESS' 
  | 'DONE' 
  | 'FAILED';

export interface IngestionJob {
  id: string;
  pdfPath: string;
  filename: string;
  uploadedBy: string;
  status: IngestionStatus;
  progress: number; // 0-100
  totalPages?: number;
  pagesProcessed?: number;
  questionsFound?: number;
  questionsImported?: number;
  questionsApproved?: number;
  questionsRejected?: number;
  questionsNeedsReview?: number;
  ocrStats?: OcrStats; // Option C stats
  error?: string;
  failedStage?: string; // Stage where the job failed (OCR, PARSE, QA, INGEST)
  startedAt?: Date;
  completedAt?: Date;
}

interface WorkerConfig {
  maxConcurrentJobs: number;
  enableOCR: boolean;
  enableQA: boolean;
  enableRAG: boolean;
  retryAttempts: number;
}

// In-memory job storage for immediate access (Supabase is primary persistence)
export const memoryJobs = new Map<string, IngestionJob>();

export class IngestionWorker {
  private config: WorkerConfig;
  private activeJobs: Set<string> = new Set();
  private pendingQueue: string[] = []; // Queue for jobs waiting for capacity
  private persistence?: JobPersistence; // Optional persistence layer
  
  private ocrOrchestrator: OcrOrchestrator;
  private satParser: SatParser;
  private qaValidator: QAValidator;
  private ragPipeline: RAGPipeline;

  constructor(config?: Partial<WorkerConfig>) {
    // Read max concurrency from env with fallback to config or default
    const maxConcurrentFromEnv = process.env.INGEST_MAX_CONCURRENT_JOBS 
      ? parseInt(process.env.INGEST_MAX_CONCURRENT_JOBS, 10)
      : undefined;
    
    this.config = {
      maxConcurrentJobs: maxConcurrentFromEnv ?? config?.maxConcurrentJobs ?? 2,
      enableOCR: config?.enableOCR ?? true,
      enableQA: config?.enableQA ?? true,
      enableRAG: config?.enableRAG ?? true,
      retryAttempts: config?.retryAttempts ?? 2,
    };

    // Initialize pipeline services
    this.ocrOrchestrator = new OcrOrchestrator({
      ocrConfidenceThreshold: 0.85,
      mathpixPatchThreshold: 0.6,
      enableMathpix: false, // Disabled for Phase 1
      enableNougat: true,
      detectMathRegions: true,
      nougatMinTokenGain: 20,
    });

    this.satParser = new SatParser({
      minConfidenceThreshold: 0.6,
      strictMode: false,
      enableLogging: true,
    });

    this.qaValidator = new QAValidator({
      enableLLMValidation: this.config.enableQA,
      enableDuplicateDetection: true,
    });

    this.ragPipeline = new RAGPipeline({
      embeddingModel: 'gemini',
    });

    console.log(`🚀 [WORKER] Ingestion worker initialized (max concurrent: ${this.config.maxConcurrentJobs})`);
    
    // Log Vision pipeline status
    const visionConfig = getVisionConfig();
    if (visionConfig.enabled) {
      console.log(`🔭 [WORKER] Vision pipeline enabled (model: ${visionConfig.modelName})`);
    } else {
      console.log(`⏭️ [WORKER] Vision pipeline disabled (GEMINI_API_KEY missing or ENABLE_VISION_INGESTION=false)`);
    }
  }

  /**
   * Detect section code from filename
   * Returns 'M' for Math, 'RW' for Reading & Writing
   */
  private inferSectionCode(filename: string): 'M' | 'RW' {
    const lower = filename.toLowerCase();
    if (lower.includes('math') || lower.includes('calc') || lower.includes('no-calculator')) {
      return 'M';
    }
    if (lower.includes('r&w') || lower.includes('rw') || lower.includes('reading') || lower.includes('writing')) {
      return 'RW';
    }
    // Default to Math if can't detect
    return 'M';
  }

  /**
   * Check if Vision pipeline should be used for this document
   * Currently: Vision for Math, OCR+Parser for RW
   */
  private shouldUseVisionPipeline(filename: string): boolean {
    if (!isVisionPipelineEnabled()) {
      return false;
    }
    // Use Vision for Math documents (where mathematical notation is critical)
    const sectionCode = this.inferSectionCode(filename);
    return sectionCode === 'M';
  }

  /**
   * Run Vision-based extraction pipeline (Option B)
   */
  private async runVisionExtraction(job: IngestionJob): Promise<{ questions: QuestionDoc[]; pageCount: number }> {
    console.log(`🔭 [VISION] Starting Vision-based extraction for: ${job.filename}`);
    
    const buffer = fs.readFileSync(job.pdfPath);
    const sectionCode = this.inferSectionCode(job.filename);
    
    // Extract page images
    const pageImages = await this.ocrOrchestrator.extractPageImages(buffer);
    
    if (pageImages.length === 0) {
      throw new Error('Vision extraction failed: Could not extract any page images');
    }
    
    console.log(`[VISION] Processing ${pageImages.length} pages with Vision LLM`);
    
    // Run Vision extraction on all pages
    const questions = await extractQuestionsFromPages(pageImages, {
      exam: 'SAT',
      sectionCode,
      testCode: null,
      sourcePdf: job.filename,
      concurrencyLimit: 2,
    });
    
    console.log(`✅ [VISION] Extracted ${questions.length} questions from ${pageImages.length} pages`);
    
    return { questions, pageCount: pageImages.length };
  }

  /**
   * Set optional persistence layer
   * If set, worker will call persistence hooks on job create/update
   * Errors in persistence layer are logged but don't break in-memory behavior
   */
  setPersistence(persistence: JobPersistence): void {
    this.persistence = persistence;
    console.log(`📋 [WORKER] Persistence layer configured`);
  }

  /**
   * Persist job if persistence layer is configured
   */
  private async persistJob(job: IngestionJob, operation: 'save' | 'update'): Promise<void> {
    if (!this.persistence) {
      return; // No persistence configured, skip silently
    }

    try {
      if (operation === 'save') {
        await this.persistence.save(job);
      } else {
        await this.persistence.update(job);
      }
    } catch (error: any) {
      // Log persistence errors but don't throw - in-memory is source of truth
      console.warn(`⚠️ [WORKER] Persistence ${operation} failed for job ${job.id}:`, error.message);
    }
  }

  /**
   * Create a new ingestion job and add to memory
   */
  createJob(params: { pdfPath: string; filename?: string; exam?: string | null }): IngestionJob {
    const jobId = crypto.randomUUID();
    const filename = params.filename || params.pdfPath.split('/').pop() || 'unknown.pdf';

    const job: IngestionJob = {
      id: jobId,
      pdfPath: params.pdfPath,
      filename,
      uploadedBy: 'admin',
      status: 'PENDING',
      progress: 0,
      startedAt: new Date(),
    };

    // Add to in-memory storage IMMEDIATELY
    memoryJobs.set(jobId, job);
    console.log(`✅ [WORKER] Job created in memory: ${jobId} for ${filename}`);

    // Persist if configured (non-blocking)
    void this.persistJob(job, 'save').catch(() => {});

    return job;
  }

  /**
   * Start a new ingestion job (with queueing support)
   */
  async startJob(jobId: string): Promise<void> {
    const job = memoryJobs.get(jobId);
    if (!job) {
      console.warn(`⚠️ [WORKER] startJob called with unknown jobId=${jobId}`);
      return;
    }

    if (job.status !== 'PENDING') {
      console.warn(`⚠️ [WORKER] Job ${jobId} in status ${job.status}, not PENDING; skipping start`);
      return;
    }

    // Check concurrency limit
    if (this.activeJobs.size >= this.config.maxConcurrentJobs) {
      // Add to queue instead of throwing
      if (!this.pendingQueue.includes(jobId)) {
        this.pendingQueue.push(jobId);
        console.log(`⏳ [WORKER] At capacity (${this.activeJobs.size}/${this.config.maxConcurrentJobs}), queued job ${jobId} (queue length: ${this.pendingQueue.length})`);
      }
      return;
    }

    console.log(`🚀 [WORKER] Starting job ${jobId} (active: ${this.activeJobs.size}/${this.config.maxConcurrentJobs})`);
    job.status = 'OCR_IN_PROGRESS';
    job.progress = 5;
    memoryJobs.set(jobId, job);
    void this.persistJob(job, 'update').catch(() => {});

    this.activeJobs.add(jobId);

    try {
      await this.processJob(jobId);
      
      // Mark as done
      const finalJob = memoryJobs.get(jobId);
      if (finalJob) {
        finalJob.status = 'DONE';
        finalJob.progress = 100;
        finalJob.completedAt = new Date();
        memoryJobs.set(jobId, finalJob);
        void this.persistJob(finalJob, 'update').catch(() => {});
        console.log(`✅ [WORKER] Job ${jobId} completed successfully`);
      }
    } catch (err: any) {
      console.error(`❌ [WORKER] Job ${jobId} failed:`, err);
      const failedJob = memoryJobs.get(jobId);
      if (failedJob) {
        failedJob.status = 'FAILED';
        failedJob.error = err?.message ?? 'Unknown error';
        failedJob.completedAt = new Date();
        memoryJobs.set(jobId, failedJob);
        void this.persistJob(failedJob, 'update').catch(() => {});
      }
    } finally {
      this.activeJobs.delete(jobId);
      
      // Try to pick up next queued job
      this.processQueue();
    }
  }

  /**
   * Process the next queued job if capacity is available
   */
  private processQueue(): void {
    if (this.pendingQueue.length === 0) {
      return;
    }

    if (this.activeJobs.size >= this.config.maxConcurrentJobs) {
      return; // Still at capacity
    }

    const nextJobId = this.pendingQueue.shift();
    if (nextJobId) {
      console.log(`📥 [WORKER] Picked up queued job ${nextJobId} (queue remaining: ${this.pendingQueue.length})`);
      // Start the job asynchronously (don't await)
      void this.startJob(nextJobId).catch((error) => {
        console.error(`❌ [WORKER] Queued job ${nextJobId} failed:`, error);
      });
    }
  }

  /**
   * Process a single ingestion job through all pipeline stages
   * Supports two extraction paths:
   * - Option B (Vision): For Math documents - uses Vision LLM for direct schema extraction
   * - Legacy (OCR+Parser): For RW documents - uses OCR then regex parser
   */
  private async processJob(jobId: string): Promise<void> {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🎯 [WORKER] Starting job ${jobId}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    let currentStage = 'INIT';
    let ocrResults: any[] = [];
    let parsedQuestions: any[] = [];
    let qaResults: any[] = [];
    let useVisionPipeline = false;
    let totalPages = 0;
    let ocrStats: OcrStats | undefined;

    try {
      // Load job from database
      const job = await this.loadJob(jobId);

      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      // Verify PDF exists
      if (!fs.existsSync(job.pdfPath)) {
        throw new Error(`PDF file not found: ${job.pdfPath}`);
      }

      // Decide extraction path: Vision (Option B) vs OCR+Parser (Legacy)
      useVisionPipeline = this.shouldUseVisionPipeline(job.filename);
      const sectionCode = this.inferSectionCode(job.filename);
      console.log(`📋 [WORKER] Document: ${job.filename} | Section: ${sectionCode} | Pipeline: ${useVisionPipeline ? 'Vision (Option B)' : 'OCR+Parser (Legacy)'}`);

      if (useVisionPipeline) {
        // === OPTION B: Vision-based extraction ===
        currentStage = 'VISION';
        await this.updateJobStatus(jobId, 'OCR_IN_PROGRESS', 10);
        
        const visionResult = await this.runVisionExtraction(job);
        const visionQuestionDocs = visionResult.questions;
        totalPages = visionResult.pageCount;
        
        // Convert QuestionDocs to ParsedQuestions for QA validation
        parsedQuestions = questionDocsToParsedQuestions(visionQuestionDocs);
        
        // Create mock OCR stats for Vision pipeline
        ocrStats = {
          totalPages,
          byEngine: {
            docai: { pages: 0, chunks: 0, errors: 0 },
            mathpix: { pages: 0, errors: 0 },
            nougat: { pages: 0, errors: 0 },
            tesseract: { pages: 0, errors: 0 },
          },
          errors: [],
          providerUsed: null,
          providerAttempts: ['vision' as any],
          mathpixPatchCount: 0,
          nougatMergeCount: 0,
        };
        
        await this.updateJobStatus(jobId, 'PARSE_IN_PROGRESS', 30);
        console.log(`✅ [VISION] Extracted ${parsedQuestions.length} questions from ${totalPages} pages`);
        
      } else {
        // === LEGACY: OCR + Parser extraction ===
        // Stage 1: OCR
        currentStage = 'OCR';
        await this.updateJobStatus(jobId, 'OCR_IN_PROGRESS', 10);
        const ocrResult = await this.runOCR(job);
        ocrResults = ocrResult.results;
        ocrStats = ocrResult.stats;
        totalPages = ocrResults.length;

        // Stage 2: Parse
        currentStage = 'PARSE';
        await this.updateJobStatus(jobId, 'PARSE_IN_PROGRESS', 30);
        parsedQuestions = await this.runParser(ocrResults);
      }

      // Stage 3: QA Validation (common to both paths)
      // Use 'vision-math' pipeline for softer rules when using Vision extraction
      currentStage = 'QA';
      await this.updateJobStatus(jobId, 'QA_IN_PROGRESS', 50);
      const qaPipeline = useVisionPipeline ? 'vision-math' : 'default';
      qaResults = await this.runQA(parsedQuestions, jobId, qaPipeline);

      // Track QA counts in job before saving
      const approved = qaResults.filter(r => r.status === 'APPROVED').length;
      const needsReview = qaResults.filter(r => r.status === 'NEEDS_REVIEW').length;
      const rejected = qaResults.filter(r => r.status === 'REJECTED').length;
      this.updateJobCounts(jobId, { approved, needsReview, rejected, parsed: parsedQuestions.length });

      // Stage 4: Save to database
      currentStage = 'INGEST';
      await this.updateJobStatus(jobId, 'QA_IN_PROGRESS', 70);
      const { questionDbIds, questionDocs } = await this.saveQuestions(parsedQuestions, qaResults, jobId);

      // Stage 5: Generate embeddings with Ingestion v2 canonical metadata
      currentStage = 'EMBED';
      await this.updateJobStatus(jobId, 'EMBED_IN_PROGRESS', 80);
      await this.runRAG(parsedQuestions, questionDbIds, job.filename, questionDocs);

      // Complete with provider tracing
      await this.completeJob(jobId, {
        totalPages,
        questionsFound: parsedQuestions.length,
        questionsImported: questionDbIds.size,
        ocrStats,
      });

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`✅ [WORKER] Job ${jobId} completed successfully (${useVisionPipeline ? 'Vision' : 'Legacy'} pipeline)`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    } catch (error: any) {
      console.error(`\n❌ [WORKER] Job ${jobId} failed at stage ${currentStage}:`, error.message);
      
      // Track partial counts even on failure
      if (qaResults.length > 0) {
        const approved = qaResults.filter(r => r.status === 'APPROVED').length;
        const needsReview = qaResults.filter(r => r.status === 'NEEDS_REVIEW').length;
        const rejected = qaResults.filter(r => r.status === 'REJECTED').length;
        this.updateJobCounts(jobId, { approved, needsReview, rejected, parsed: parsedQuestions.length });
      } else if (parsedQuestions.length > 0) {
        this.updateJobCounts(jobId, { parsed: parsedQuestions.length, approved: 0, needsReview: 0, rejected: 0 });
      }
      
      await this.failJob(jobId, error.message, currentStage);
      throw error;
    }
  }

  /**
   * Update job counts in memory
   */
  private updateJobCounts(jobId: string, counts: { parsed?: number; approved?: number; needsReview?: number; rejected?: number }): void {
    const job = memoryJobs.get(jobId);
    if (job) {
      if (counts.parsed !== undefined) job.questionsFound = counts.parsed;
      if (counts.approved !== undefined) job.questionsApproved = counts.approved;
      if (counts.needsReview !== undefined) job.questionsNeedsReview = counts.needsReview;
      if (counts.rejected !== undefined) job.questionsRejected = counts.rejected;
    }
  }

  /**
   * Stage 1: Run OCR pipeline with Option C stats tracking
   */
  private async runOCR(job: IngestionJob): Promise<{ results: any[]; stats: OcrStats }> {
    console.log(`📄 [OCR] Processing PDF: ${job.pdfPath}`);
    
    const buffer = fs.readFileSync(job.pdfPath);
    const { results, stats } = await this.ocrOrchestrator.run(buffer, { fileName: job.filename }); // Process all pages with SAT-aware routing

    // Store OCR stats in job for API response
    job.ocrStats = stats;

    console.log(`✅ [OCR] Extracted ${results.length} pages`, {
      providerUsed: stats.providerUsed,
      providerAttempts: stats.providerAttempts,
      docai: stats.byEngine.docai.pages,
      nougat: stats.byEngine.nougat.pages,
      errors: stats.errors.length,
    });
    
    return { results, stats };
  }

  /**
   * Stage 2: Parse questions from OCR results
   */
  private async runParser(ocrResults: any[]): Promise<any[]> {
    console.log(`🔍 [PARSE] Parsing questions from ${ocrResults.length} pages`);

    // Pass the full OCR results array to the parser (not string)
    const allQuestions = this.satParser.parse(ocrResults);

    console.log(`✅ [PARSE] Found ${allQuestions.length} questions`);
    return allQuestions;
  }

  /**
   * Stage 3: Run QA validation
   * @param pipeline - 'default' or 'vision-math' to control QA strictness
   */
  private async runQA(parsedQuestions: any[], jobId: string, pipeline: 'default' | 'vision-math' = 'default'): Promise<any[]> {
    if (!this.config.enableQA) {
      console.log(`⏭️ [QA] QA validation disabled, skipping`);
      return [];
    }

    console.log(`🔍 [QA] Validating ${parsedQuestions.length} questions (pipeline: ${pipeline})`);
    
    const qaResults = await this.qaValidator.validateBatch(parsedQuestions, jobId, pipeline);

    const approved = qaResults.filter(r => r.status === 'APPROVED').length;
    const needsReview = qaResults.filter(r => r.status === 'NEEDS_REVIEW').length;
    const rejected = qaResults.filter(r => r.status === 'REJECTED').length;

    console.log(`✅ [QA] Validation complete: ${approved} approved, ${needsReview} needs review, ${rejected} rejected`);
    
    return qaResults;
  }

  /**
   * Stage 4: Save questions to database
   * MVP: Push to Supabase via /api/ingest instead of Neon
   * Ingestion v2: Use QuestionDoc format with canonical IDs
   */
  private async saveQuestions(
    parsedQuestions: any[],
    qaResults: any[],
    jobId: string
  ): Promise<{ questionDbIds: Map<string, string>; questionDocs: QuestionDoc[] }> {
    const approved = qaResults.filter(r => r.status === 'APPROVED' || r.status === 'NEEDS_REVIEW');
    const rejected = qaResults.filter(r => r.status === 'REJECTED');
    
    console.log(`💾 [INGEST-V2] Filtering: ${approved.length} approved/needs_review, ${rejected.length} rejected`);
    
    const approvedQuestions = parsedQuestions.filter((_, i) => 
      qaResults[i]?.status !== 'REJECTED'
    );
    
    console.log(`💾 [INGEST-V2] Preparing ${approvedQuestions.length} questions for Supabase ingestion (filtered from ${parsedQuestions.length})`);

    const questionDbIds = new Map<string, string>();
    const ingestItems: any[] = [];

    // Convert approved questions to QuestionDoc format
    const questionDocs = toQuestionDocs(approvedQuestions, {
      testCode: 'SAT',
      ingestionRunId: jobId,
    });

    for (let i = 0; i < questionDocs.length; i++) {
      const questionDoc = questionDocs[i];
      const qaResult = qaResults.find(r => r.questionId === approvedQuestions[i]?.questionId);
      const originalParsed = approvedQuestions[i];

      // Generate UUID for question
      const questionUuid = crypto.randomUUID();
      
      // Build ingest-ready item for /api/ingest with Ingestion v2 fields
      ingestItems.push({
        id: questionUuid,
        exam: questionDoc.testCode,
        section: questionDoc.section || null,
        stem: questionDoc.stem,
        options: questionDoc.options,
        answer: questionDoc.answerChoice ?? null,
        explanation: questionDoc.explanation ?? null,
        tags: questionDoc.tags,
        canonicalId: questionDoc.canonicalId,
        testCode: questionDoc.testCode,
        sectionCode: questionDoc.sectionCode,
        sourceType: questionDoc.sourceType,
        competencies: questionDoc.competencies,
        version: questionDoc.version,
      });

      questionDbIds.set(originalParsed.questionId, questionUuid);

      // Save to Supabase with upsert using canonical_id as conflict target
      try {
        const row = {
          canonical_id: questionDoc.canonicalId,
          stem: questionDoc.stem,
          options: questionDoc.options,
          answer: questionDoc.answerChoice || 'A',
          answer_choice: questionDoc.answerChoice || null,
          explanation: questionDoc.explanation || null,
          section: questionDoc.section || 'Math',
          difficulty: questionDoc.difficulty || null,
          question_type: questionDoc.options.length > 0 ? 'multiple_choice' : 'free_response',
          question_hash: questionDoc.questionHash || null,
          source_pdf: jobId,
          ingestion_run_id: jobId,
          needs_review: qaResult?.status === 'NEEDS_REVIEW' || originalParsed.needsReview,
          engine_used: questionDoc.engineUsed || null,
          engine_confidence: questionDoc.engineConfidence || null,
          page_number: questionDoc.pageNumber || null,
          tags: questionDoc.tags,
        };

        const { error: upsertError } = await supabaseServer
          .from('questions')
          .upsert(row, { 
            onConflict: 'canonical_id',
            ignoreDuplicates: false 
          });
        
        if (upsertError) {
          console.warn(`⚠️ [INGEST-V2] Supabase upsert failed (non-fatal): ${upsertError.message}`);
        } else {
          console.log(`📝 [INGEST-V2][SUPABASE] Upserted question:`, JSON.stringify({
            canonical_id: questionDoc.canonicalId,
            stem: questionDoc.stem.substring(0, 50) + '...',
          }, null, 2));
        }
      } catch (error: any) {
        console.warn(`⚠️ [INGEST-V2] Supabase insert failed (non-fatal): ${error.message}`);
      }
    }

    // Push all questions to Supabase via /api/ingest (canonical store)
    await this.pushToSupabaseIngest(ingestItems);

    console.log(`✅ [INGEST-V2] Prepared ${questionDbIds.size} questions for Supabase`);
    return { questionDbIds, questionDocs };
  }

  /**
   * Push parsed questions to Supabase via /api/ingest
   * Goal A: Implements idempotency by deduping against existing canonical IDs
   */
  private async pushToSupabaseIngest(items: any[]): Promise<void> {
    if (!items.length) {
      console.log('ℹ️ [INGEST-V2] No parsed questions to ingest');
      return;
    }

    const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:5000';
    const token = process.env.INGEST_ADMIN_TOKEN || 'changeme';

    // Goal A: Dedupe against existing canonical IDs in Supabase
    let filteredItems = items;
    try {
      filteredItems = await this.dedupeByCanonicalId(items);
      
      if (filteredItems.length === 0) {
        console.log('ℹ️ [INGEST-V2] All items already exist (canonical ID dedupe) - skipping ingest');
        return;
      }
    } catch (error: any) {
      console.warn(`⚠️ [INGEST-V2] Canonical ID dedupe failed (proceeding with full batch): ${error.message}`);
      filteredItems = items;
    }

    console.log(`📤 [INGEST-V2] Pushing ${filteredItems.length} questions to ${baseUrl}/api/ingest`);

    try {
      const res = await fetch(`${baseUrl}/api/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(filteredItems),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`❌ [INGEST-V2] /api/ingest call failed: ${res.status} ${text}`);
        throw new Error(`Supabase ingest failed with status ${res.status}`);
      }

      const data = await res.json().catch(() => ({}));
      console.log(`✅ [INGEST-V2] Supabase ingest successful:`, data);
    } catch (error: any) {
      console.error(`❌ [INGEST-V2] Failed to push to /api/ingest:`, error.message);
      throw error;
    }
  }

  /**
   * Goal A: Dedupe items by checking if canonical IDs already exist in Supabase
   * Returns filtered array with only new items (not yet in database)
   * Uses case-insensitive matching to handle uppercase/lowercase variations
   */
  private async dedupeByCanonicalId(items: any[]): Promise<any[]> {
    // Collect non-null canonical IDs (normalized to uppercase for consistency)
    const canonicalIds = items
      .map(item => item.canonicalId)
      .filter((id): id is string => !!id && typeof id === 'string')
      .map(id => id.toUpperCase()); // Normalize to uppercase
    
    if (canonicalIds.length === 0) {
      console.log('ℹ️ [INGEST-V2] No canonical IDs in batch - skipping dedupe');
      return items;
    }

    console.log(`🔍 [INGEST-V2] Checking ${canonicalIds.length} canonical IDs for duplicates`);

    // Query Supabase to find existing canonical IDs
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️ [INGEST-V2] Supabase credentials not configured - skipping dedupe');
      return items;
    }

    // Query in batches of 50 to avoid URL length limits
    // Use case-insensitive matching with ilike for robust comparison
    const existingIds = new Set<string>();
    const batchSize = 50;
    
    for (let i = 0; i < canonicalIds.length; i += batchSize) {
      const batch = canonicalIds.slice(i, i + batchSize);
      // Use ilike for case-insensitive matching
      const queryFilter = batch.map(id => `canonical_id.ilike.${id}`).join(',');
      
      const url = `${supabaseUrl}/rest/v1/questions?select=canonical_id&or=(${queryFilter})`;
      
      const response = await fetch(url, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Supabase query failed: ${response.status}`);
      }

      const rows: Array<{ canonical_id: string }> = await response.json();
      rows.forEach(row => {
        if (row.canonical_id) {
          // Store uppercase version for consistent comparison
          existingIds.add(row.canonical_id.toUpperCase());
        }
      });
    }

    if (existingIds.size === 0) {
      console.log('✅ [INGEST-V2] No duplicates found - proceeding with full batch');
      return items;
    }

    // Filter out items with existing canonical IDs (case-insensitive)
    const filteredItems = items.filter(item => {
      if (!item.canonicalId) return true; // Keep items without canonical ID
      return !existingIds.has(item.canonicalId.toUpperCase());
    });

    const skippedCount = items.length - filteredItems.length;
    console.log(`🔄 [INGEST-V2] Skipping ${skippedCount} items with existing canonical_id: ${Array.from(existingIds).join(', ')}`);

    return filteredItems;
  }

  /**
   * Stage 5: Generate and store RAG embeddings with Ingestion v2 canonical metadata
   */
  private async runRAG(
    parsedQuestions: any[],
    questionDbIds: Map<string, string>,
    sourcePdf: string,
    questionDocs?: QuestionDoc[]
  ): Promise<void> {
    if (!this.config.enableRAG) {
      console.log(`⏭️ [RAG] RAG pipeline disabled, skipping`);
      return;
    }

    console.log(`🔗 [RAG] Generating embeddings for ${questionDbIds.size} questions`);
    
    // Pass questionDocs for Ingestion v2 canonical metadata
    await this.ragPipeline.processBatch(parsedQuestions, questionDbIds, sourcePdf, questionDocs);

    console.log(`✅ [RAG] Embeddings generated successfully`);
  }

  /**
   * Load job from database (with in-memory fallback)
   */
  private async loadJob(jobId: string): Promise<IngestionJob | null> {
    try {
      const { data: result, error } = await supabaseServer
        .from('ingestion_runs')
        .select('*')
        .eq('id', jobId)
        .limit(1);

      if (error || !result || result.length === 0) {
        return memoryJobs.get(jobId) || null;
      }

      const row = result[0];
      
      const config = row.configuration as any || {};
      const pdfPath = config.pdfPath || '';
      const filename = pdfPath.split('/').pop() || 'unknown.pdf';
      
      return {
        id: row.id,
        pdfPath,
        filename,
        uploadedBy: 'admin',
        status: this.mapDbStatusToIngestionStatus(row.status),
        progress: this.calculateProgress(row.status),
        totalPages: row.total_questions || undefined,
        questionsFound: row.total_questions || undefined,
        questionsImported: row.succeeded || undefined,
        error: row.notes_json?.error || undefined,
        startedAt: row.started_at ? new Date(row.started_at) : undefined,
        completedAt: row.finished_at ? new Date(row.finished_at) : undefined,
      };
    } catch (error: any) {
      console.warn('⚠️ [INGEST-V2] Supabase unavailable; using in-memory job tracking');
      return memoryJobs.get(jobId) || null;
    }
  }

  /**
   * Map database status to ingestion status
   */
  private mapDbStatusToIngestionStatus(dbStatus: string): IngestionStatus {
    const statusMap: Record<string, IngestionStatus> = {
      'queued': 'PENDING',
      'ocr_docai': 'OCR_IN_PROGRESS',
      'ocr_mathpix_patch': 'OCR_IN_PROGRESS',
      'ocr_nougat_fallback': 'OCR_IN_PROGRESS',
      'parsing': 'PARSE_IN_PROGRESS',
      'qa': 'QA_IN_PROGRESS',
      'embed': 'EMBED_IN_PROGRESS',
      'done': 'DONE',
      'failed': 'FAILED',
    };
    return statusMap[dbStatus] || 'PENDING';
  }

  /**
   * Calculate progress percentage from status
   */
  private calculateProgress(status: string): number {
    const progressMap: Record<string, number> = {
      'queued': 0,
      'ocr_docai': 10,
      'ocr_mathpix_patch': 20,
      'parsing': 30,
      'qa': 50,
      'embed': 80,
      'done': 100,
      'failed': 0,
    };
    return progressMap[status] || 0;
  }

  /**
   * Update job status in database (with in-memory fallback)
   */
  private async updateJobStatus(
    jobId: string,
    status: IngestionStatus,
    progress: number
  ): Promise<void> {
    // Update in-memory job
    const memJob = memoryJobs.get(jobId);
    if (memJob) {
      memJob.status = status;
      memJob.progress = progress;
      void this.persistJob(memJob, 'update').catch(() => {});
    }

    // Try to update database via Supabase
    try {
      const dbStatus = this.mapIngestionStatusToDbStatus(status);
      const updates: Record<string, any> = { status: dbStatus };

      const { error: updateError } = await supabaseServer
        .from('ingestion_runs')
        .update(updates)
        .eq('id', jobId);
      
      if (updateError) {
        console.warn(`⚠️ [INGEST-V2] Supabase update failed (non-fatal): ${updateError.message}`);
      }
    } catch (error: any) {
      console.warn(`⚠️ [INGEST-V2] Supabase update failed (non-fatal): ${error.message}`);
    }

    console.log(`📊 [WORKER] Job ${jobId}: ${status} (${progress}%)`);
  }

  /**
   * Map ingestion status to database status
   */
  private mapIngestionStatusToDbStatus(status: IngestionStatus): string {
    const statusMap: Record<IngestionStatus, string> = {
      'PENDING': 'queued',
      'OCR_IN_PROGRESS': 'ocr_docai',
      'PARSE_IN_PROGRESS': 'parsing',
      'QA_IN_PROGRESS': 'qa',
      'EMBED_IN_PROGRESS': 'embed',
      'DONE': 'done',
      'FAILED': 'failed',
    };
    return statusMap[status] || 'queued';
  }

  /**
   * Mark job as complete (with in-memory fallback)
   */
  private async completeJob(
    jobId: string,
    stats: {
      totalPages: number;
      questionsFound: number;
      questionsImported: number;
      ocrStats?: OcrStats;
    }
  ): Promise<void> {
    // Update in-memory job
    const memJob = memoryJobs.get(jobId);
    if (memJob) {
      memJob.status = 'DONE';
      memJob.progress = 100;
      memJob.totalPages = stats.totalPages;
      memJob.questionsFound = stats.questionsFound;
      memJob.questionsImported = stats.questionsImported;
      memJob.completedAt = new Date();
    }

    // Try to update database with provider tracing via Supabase
    try {
      const ocrStats = stats.ocrStats;
      const updates: Record<string, any> = {
        status: 'done',
        finished_at: new Date().toISOString(),
        total_questions: stats.questionsFound,
        succeeded: stats.questionsImported,
        notes_json: ocrStats ? {
          totalPages: ocrStats.totalPages,
          byEngine: ocrStats.byEngine,
          errors: ocrStats.errors,
          providerChain: ocrStats.providerAttempts,
          providerUsed: ocrStats.providerUsed,
        } : null,
      };

      const { error: updateError } = await supabaseServer
        .from('ingestion_runs')
        .update(updates)
        .eq('id', jobId);
      
      if (updateError) {
        console.warn(`⚠️ [INGEST-V2] Supabase complete update failed (non-fatal): ${updateError.message}`);
      }
      
      // Log provider tracing summary
      if (ocrStats) {
        console.log(`📊 [WORKER] Job ${jobId} OCR trace: provider=${ocrStats.providerUsed}, attempts=[${ocrStats.providerAttempts.join(', ')}]`);
      }
    } catch (error: any) {
      console.warn(`⚠️ [INGEST-V2] Supabase complete update failed (non-fatal): ${error.message}`);
    }
  }

  /**
   * Mark job as failed (with in-memory fallback)
   */
  private async failJob(jobId: string, error: string, stage?: string): Promise<void> {
    // Update in-memory job
    const memJob = memoryJobs.get(jobId);
    if (memJob) {
      memJob.status = 'FAILED';
      memJob.error = error.substring(0, 500);
      memJob.failedStage = stage;
      memJob.completedAt = new Date();
    }

    // Try to update database via Supabase
    try {
      const { error: updateError } = await supabaseServer
        .from('ingestion_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          notes_json: { error: error.substring(0, 500), stage },
        })
        .eq('id', jobId);
      
      if (updateError) {
        console.warn(`⚠️ [INGEST-V2] Supabase fail update failed (non-fatal): ${updateError.message}`);
      }
    } catch (err: any) {
      console.warn(`⚠️ [INGEST-V2] Supabase fail update failed (non-fatal): ${err.message}`);
    }
  }

  /**
   * Get job by ID (public method for routes)
   */
  async getJob(jobId: string): Promise<IngestionJob | null> {
    return this.loadJob(jobId);
  }

  /**
   * Get all jobs (public method for routes)
   */
  async getAllJobs(): Promise<IngestionJob[]> {
    try {
      const { data: result, error } = await supabaseServer
        .from('ingestion_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error || !result) {
        console.warn('⚠️ [INGEST-V2] Supabase unavailable; using in-memory job list');
        return Array.from(memoryJobs.values());
      }

      return result.map((row: any) => {
        const config = row.configuration || {};
        const pdfPath = config.pdfPath || '';
        const filename = pdfPath.split('/').pop() || 'unknown.pdf';
        
        return {
          id: row.id,
          pdfPath,
          filename,
          uploadedBy: 'admin',
          status: this.mapDbStatusToIngestionStatus(row.status),
          progress: this.calculateProgress(row.status),
          totalPages: row.total_questions || undefined,
          questionsFound: row.total_questions || undefined,
          questionsImported: row.succeeded || undefined,
          error: row.notes_json?.error || undefined,
          startedAt: row.started_at ? new Date(row.started_at) : undefined,
          completedAt: row.finished_at ? new Date(row.finished_at) : undefined,
        };
      });
    } catch (error: any) {
      console.warn('⚠️ [INGEST-V2] Supabase unavailable; using in-memory job list');
      return Array.from(memoryJobs.values());
    }
  }

  /**
   * Get worker status
   */
  getStatus(): { activeJobs: number; maxConcurrent: number } {
    return {
      activeJobs: this.activeJobs.size,
      maxConcurrent: this.config.maxConcurrentJobs,
    };
  }
}
