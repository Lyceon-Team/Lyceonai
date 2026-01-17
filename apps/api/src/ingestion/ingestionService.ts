/**
 * Lyceon Ingestion v3 - Ingestion Service
 * 
 * Orchestrates the full ingestion pipeline:
 * 1. Generate OutsideSchema via LLM
 * 2. Process PDF with DocAI
 * 3. Parse into QuestionDocDraft[]
 * 4. QA Pass 1 (DocAI only)
 * 5. Vision Fallback for failed drafts
 * 6. QA Pass 2 (Reconciliation)
 * 7. Upsert to Supabase (ONLY) + Vector
 * 
 * CRITICAL: All writes go to Supabase via service role.
 * Zero tolerance for Neon/DATABASE_URL - Supabase only.
 */

import * as fs from 'fs';
import type { 
  IngestionJob, 
  IngestionJobMetrics, 
  OutsideSchema, 
  QuestionDoc, 
  QuestionDocDraft 
} from './types';
import { generateOutsideSchema, getDefaultSchema } from './outsideSchemaGenerator';
import { processDocumentInChunks, DOCAI_MAX_PAGES_PER_CHUNK, getPdfPageCount } from './docaiClient';
import { parseDocAIOutput } from './docaiParser';
import { qaDocAiPass, qaReconcilePass, draftToQuestionDoc } from './qaService';
import { batchExtractWithVision } from './visionFallback';
import { supabaseServer } from '../lib/supabase-server';
import type { SupabaseQuestionRow, SupabaseIngestionRunRow } from './types/supabase-schema';
import { validateQuestionRows, SUPABASE_QUESTIONS_COLUMNS } from './types/supabaseQuestionsRow';
import { generateCanonicalId, type TestCode, type SectionCode } from '../lib/canonicalId';

function generateCanonicalIdForIngestion(testCode: string, sectionCode: string): string {
  const test = (['SAT', 'ACT', 'AP', 'MCAT', 'LSAT'].includes(testCode) ? testCode : 'SAT') as TestCode;
  const section = (['M', 'R', 'W', 'S'].includes(sectionCode) ? sectionCode : 'M') as SectionCode;
  return generateCanonicalId(test, section, '1');
}

function getSupabaseProjectRef(): string {
  const url = process.env.SUPABASE_URL || '';
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match ? match[1] : 'unknown';
}

export interface IngestionConfig {
  maxQuestions?: number;
  skipSchemaGeneration?: boolean;
  skipVisionFallback?: boolean;
  testCode?: string;
  sectionCode?: string;
}

export interface IngestionResult {
  jobId: string;
  status: 'completed' | 'failed';
  metrics: IngestionJobMetrics;
  questions: QuestionDoc[];
  errors: string[];
}

export async function runIngestionJob(
  jobId: string,
  pdfPath: string,
  config: IngestionConfig = {}
): Promise<IngestionResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const metrics: IngestionJobMetrics = {
    totalDocAiDrafts: 0,
    docAiGoodCount: 0,
    needsVisionFallbackCount: 0,
    visionUsedCount: 0,
    finalAcceptedCount: 0,
    finalRejectedCount: 0,
    timings: {},
  };

  const testCode = config.testCode || inferTestCode(pdfPath);
  const sectionCode = config.sectionCode || inferSectionCode(pdfPath);
  const context = { testCode, sectionCode, pdfPath };

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🚀 [Ingestion] Starting job ${jobId}`);
  console.log(`   PDF: ${pdfPath}`);
  console.log(`   Test: ${testCode}, Section: ${sectionCode}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  try {
    await updateJobStatus(jobId, 'processing');

    const pdfBuffer = fs.readFileSync(pdfPath);

    let schema: OutsideSchema;
    const schemaStart = Date.now();
    
    if (config.skipSchemaGeneration) {
      schema = getDefaultSchema(testCode, sectionCode);
      console.log(`⏭️ [Schema] Using default schema`);
    } else {
      try {
        const sampleText = await getSampleText(pdfBuffer);
        schema = await generateOutsideSchema(
          sampleText,
          `${testCode} ${sectionCode === 'M' ? 'Math' : 'Reading & Writing'} section`,
          testCode,
          sectionCode
        );
      } catch (error: any) {
        console.warn(`⚠️ [Schema] Generation failed, using default:`, error.message);
        schema = getDefaultSchema(testCode, sectionCode);
      }
    }
    metrics.timings.schemaGenerationMs = Date.now() - schemaStart;

    await storeSchema(jobId, schema);

    const docaiStart = Date.now();
    const docResult = await processDocumentInChunks(pdfBuffer, {
      maxPagesPerChunk: DOCAI_MAX_PAGES_PER_CHUNK,
    });
    metrics.timings.docaiMs = Date.now() - docaiStart;
    
    if (docResult.chunkCount > 1) {
      console.log(`🔪 [DocAI] Processed ${docResult.chunkCount} chunks (${docResult.totalPages} pages total)`);
    }

    const parseStart = Date.now();
    const parseResult = parseDocAIOutput(docResult, schema, pdfPath);
    metrics.timings.parseMs = Date.now() - parseStart;
    
    let drafts = parseResult.drafts;
    metrics.totalDocAiDrafts = drafts.length;

    if (config.maxQuestions && drafts.length > config.maxQuestions) {
      console.log(`⚠️ [Ingestion] Limiting to ${config.maxQuestions} questions (of ${drafts.length})`);
      drafts = drafts.slice(0, config.maxQuestions);
    }

    console.log(`📝 [Parse] Extracted ${drafts.length} drafts from DocAI`);

    const qa1Start = Date.now();
    const qa1Result = await qaDocAiPass(drafts, schema, jobId);
    metrics.timings.qa1Ms = Date.now() - qa1Start;
    
    metrics.docAiGoodCount = qa1Result.goodDrafts.length;
    metrics.needsVisionFallbackCount = qa1Result.needsVisionDrafts.length;

    console.log(`🔍 [QA1] Good: ${qa1Result.goodDrafts.length}, Needs Vision: ${qa1Result.needsVisionDrafts.length}, Rejected: ${qa1Result.rejectedDrafts.length}`);

    const finalQuestions: QuestionDoc[] = [];

    for (let i = 0; i < qa1Result.goodDrafts.length; i++) {
      const good = qa1Result.goodDrafts[i];
      const qaResult = qa1Result.results.find(r => r.draftId === good.draftId);
      if (!qaResult) continue;
      
      try {
        const doc = draftToQuestionDoc(good, qaResult, context);
        if (doc) {
          finalQuestions.push(doc);
        }
      } catch (error: any) {
        console.error(`❌ [Convert] Failed for ${good.draftId}:`, error.message);
        errors.push(`Conversion failed for ${good.draftId}: ${error.message}`);
      }
    }

    if (qa1Result.needsVisionDrafts.length > 0 && !config.skipVisionFallback) {
      console.log(`👁️ [Vision] Processing ${qa1Result.needsVisionDrafts.length} drafts...`);
      
      const visionStart = Date.now();
      const visionDraftsMap = await batchExtractWithVision(
        qa1Result.needsVisionDrafts,
        schema,
        pdfBuffer
      );
      metrics.timings.visionMs = Date.now() - visionStart;
      metrics.visionUsedCount = visionDraftsMap.size;

      console.log(`✅ [Vision] Extracted ${visionDraftsMap.size} drafts`);

      const qa2Start = Date.now();
      for (const [draftId, visionDraft] of visionDraftsMap) {
        try {
          const originalDraft = qa1Result.needsVisionDrafts.find(
            d => d.draftId === draftId
          );
          const reconcileResult = await qaReconcilePass(
            originalDraft || visionDraft,
            visionDraft,
            schema,
            context
          );
          if (reconcileResult.status === 'ACCEPTED' && reconcileResult.finalQuestion) {
            finalQuestions.push(reconcileResult.finalQuestion);
          } else {
            metrics.finalRejectedCount++;
          }
        } catch (error: any) {
          console.error(`❌ [Reconcile] Failed for ${draftId}:`, error.message);
          errors.push(`Reconciliation failed for ${draftId}: ${error.message}`);
        }
      }
      
      metrics.timings.qa2Ms = Date.now() - qa2Start;
    }

    metrics.finalRejectedCount += qa1Result.rejectedDrafts.length;
    metrics.finalAcceptedCount = finalQuestions.length;
    metrics.timings.totalMs = Date.now() - startTime;

    if (finalQuestions.length > 0) {
      await upsertQuestionsToSupabase(finalQuestions, jobId, testCode, sectionCode);
    }

    await updateJobStatus(jobId, 'completed', metrics);

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ [Ingestion] Job ${jobId} completed`);
    console.log(`   Total drafts: ${metrics.totalDocAiDrafts}`);
    console.log(`   DocAI good: ${metrics.docAiGoodCount}`);
    console.log(`   Vision fallback: ${metrics.visionUsedCount}`);
    console.log(`   Final accepted: ${metrics.finalAcceptedCount}`);
    console.log(`   Final rejected: ${metrics.finalRejectedCount}`);
    console.log(`   Total time: ${metrics.timings.totalMs}ms`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    return {
      jobId,
      status: 'completed',
      metrics,
      questions: finalQuestions,
      errors,
    };

  } catch (error: any) {
    console.error(`\n❌ [Ingestion] Job ${jobId} failed:`, error.message);
    metrics.timings.totalMs = Date.now() - startTime;
    
    await updateJobStatus(jobId, 'failed', metrics, error.message);
    
    return {
      jobId,
      status: 'failed',
      metrics,
      questions: [],
      errors: [...errors, error.message],
    };
  }
}

async function getSampleText(pdfBuffer: Buffer): Promise<string> {
  try {
    const pageCount = await getPdfPageCount(pdfBuffer);
    const docResult = await processDocumentInChunks(pdfBuffer, {
      maxPagesPerChunk: Math.min(pageCount, 5),
    });
    return docResult.text.slice(0, 5000);
  } catch {
    return '';
  }
}

function inferTestCode(pdfPath: string): string {
  const filename = pdfPath.toLowerCase();
  if (filename.includes('act')) return 'ACT';
  if (filename.includes('ap')) return 'AP';
  return 'SAT';
}

function inferSectionCode(pdfPath: string): string {
  const filename = pdfPath.toLowerCase();
  if (filename.includes('math') || filename.includes('calc')) return 'M';
  if (filename.includes('read') || filename.includes('writ') || filename.includes('rw')) return 'RW';
  return 'M';
}

async function updateJobStatus(
  jobId: string,
  status: 'processing' | 'completed' | 'failed',
  metrics?: IngestionJobMetrics,
  error?: string
): Promise<void> {
  try {
    const now = new Date().toISOString();
    
    const notesJson = metrics ? {
      ...metrics,
      error: error || null,
    } : null;
    
    const totalQuestions = metrics?.totalDocAiDrafts || 0;
    const succeeded = metrics?.finalAcceptedCount || 0;
    const failed = metrics?.finalRejectedCount || 0;
    
    const updateData: Record<string, any> = { status };
    
    if (status === 'completed' || status === 'failed') {
      updateData.finished_at = now;
      updateData.total_questions = totalQuestions;
      updateData.succeeded = succeeded;
      updateData.failed = failed;
      updateData.notes_json = notesJson;
    }
    
    const { error: updateError } = await supabaseServer
      .from('ingestion_runs')
      .update(updateData)
      .eq('id', jobId);
    
    if (updateError) {
      if (updateError.message.includes('schema cache')) {
        console.warn(`⚠️ [Ingestion] Supabase schema cache issue, skipping job status update for ${jobId}`);
        console.log(`📊 [Ingestion] Job ${jobId} status: ${status} (local-only)`);
        return;
      }
      console.error(`❌ [Ingestion] Supabase update error for job ${jobId}:`, updateError.message);
    } else {
      console.log(`✅ [Ingestion] Updated job ${jobId} status to ${status} [SUPABASE]`);
    }
  } catch (err: any) {
    if (err.message?.includes('schema cache')) {
      console.warn(`⚠️ [Ingestion] Supabase schema cache issue, skipping job status update for ${jobId}`);
      return;
    }
    console.error(`❌ [Ingestion] DB update exception for job ${jobId}:`, err.message);
  }
}

async function storeSchema(jobId: string, schema: OutsideSchema): Promise<void> {
  try {
    const { data: existingRow, error: fetchError } = await supabaseServer
      .from('ingestion_runs')
      .select('configuration')
      .eq('id', jobId)
      .single();
    
    if (fetchError) {
      if (fetchError.message.includes('schema cache')) {
        console.warn(`⚠️ [Ingestion] Supabase schema cache issue, storing schema locally only`);
        return;
      }
      console.warn(`⚠️ [Ingestion] Failed to fetch existing config:`, fetchError.message);
      return;
    }
    
    const existingConfig = existingRow?.configuration || {};
    const newConfig = { ...existingConfig, outsideSchema: schema };
    
    const { error: updateError } = await supabaseServer
      .from('ingestion_runs')
      .update({ configuration: newConfig })
      .eq('id', jobId);
    
    if (updateError) {
      if (updateError.message.includes('schema cache')) {
        console.warn(`⚠️ [Ingestion] Supabase schema cache issue, storing schema locally only`);
        return;
      }
      console.warn(`⚠️ [Ingestion] Failed to store schema:`, updateError.message);
    }
  } catch (err: any) {
    console.warn(`⚠️ [Ingestion] Failed to store schema in DB:`, err.message);
  }
}

/**
 * Upsert questions to Supabase using service role (bypasses RLS).
 * Uses canonical_id as the conflict target per the canonical schema.
 * 
 * Uses validateQuestionRows() to ensure only valid CSV columns are written.
 * Options are stored as JSON array: [{key: "A", text: "..."}, ...]
 */
async function upsertQuestionsToSupabase(
  questions: QuestionDoc[], 
  jobId: string,
  testCode: string,
  sectionCode: string
): Promise<void> {
  const supabaseProjectRef = getSupabaseProjectRef();
  console.log(`💾 [Ingestion] Upserting ${questions.length} questions via Supabase service role...`);
  console.log(`   Supabase project: ${supabaseProjectRef}`);

  let section = 'Math';
  if (sectionCode === 'RW' || sectionCode === 'R' || sectionCode === 'W') {
    section = 'Reading and Writing';
  } else if (sectionCode === 'M') {
    section = 'Math';
  }

  const rawRows = questions.map((question, idx) => {
    const canonicalId = question.canonicalId || generateCanonicalIdForIngestion(testCode, sectionCode);
    
    const optionsArray = question.options && question.options.length > 0
      ? question.options.map(opt => ({ key: opt.key, text: opt.text }))
      : null;

    return {
      canonical_id: canonicalId,
      section: section,
      stem: question.stem,
      question_type: 'multiple_choice',
      type: 'mc',
      options: optionsArray,
      answer: question.answer || null,
      answer_choice: question.answer || null,
      explanation: question.explanation || null,
      difficulty: question.difficulty || null,
      ai_generated: false,
      needs_review: !question.answer,
      exam: testCode || 'SAT',
      test_code: testCode || 'SAT',
      section_code: sectionCode || 'M',
      confidence: 1.0,
      version: 1,
    };
  });

  const { validRows, invalidCount, allDroppedKeys } = validateQuestionRows(rawRows);
  
  if (allDroppedKeys.size > 0) {
    console.log(`[SUPABASE][QUESTIONS_WRITE] Dropped keys: ${[...allDroppedKeys].join(', ')}`);
  }
  
  if (invalidCount > 0) {
    console.warn(`[SUPABASE][QUESTIONS_WRITE] ${invalidCount} rows failed validation`);
  }

  if (validRows.length === 0) {
    console.error('[SUPABASE][QUESTIONS_WRITE] No valid rows to insert!');
    console.log('[SUPABASE][QUESTIONS_WRITE]', {
      supabaseProjectRef,
      attemptedCount: questions.length,
      insertedCount: 0,
      latestCreatedAtFromProofEndpoint: null,
    });
    return;
  }

  let successCount = 0;
  let skippedCount = 0;
  let maxCreatedAt: string | null = null;

  for (const row of validRows) {
    try {
      const { data, error } = await supabaseServer
        .from('questions')
        .upsert(row, { 
          onConflict: 'canonical_id',
          ignoreDuplicates: false 
        })
        .select('id, created_at');
      
      if (error) {
        console.error(`❌ [Upsert] Failed for ${row.canonical_id}:`, {
          code: error.code,
          message: error.message,
          details: error.details,
          attemptedColumns: Object.keys(row),
          schemaColumns: SUPABASE_QUESTIONS_COLUMNS.slice(0, 10).join(', ') + '...',
        });
        skippedCount++;
      } else {
        successCount++;
        if (data && data[0]?.created_at) {
          if (!maxCreatedAt || data[0].created_at > maxCreatedAt) {
            maxCreatedAt = data[0].created_at;
          }
        }
      }
    } catch (err: any) {
      console.error(`❌ [Upsert] Exception for question:`, err.message);
      skippedCount++;
    }
  }

  console.log(`✅ [Ingestion] Upsert complete: ${successCount} success, ${skippedCount} skipped`);
  
  console.log('[SUPABASE][QUESTIONS_WRITE]', {
    supabaseProjectRef,
    attemptedCount: questions.length,
    insertedCount: successCount,
    latestCreatedAtFromProofEndpoint: maxCreatedAt,
  });
}

export async function createIngestionJob(pdfPath: string, testCode?: string, sectionCode?: string): Promise<string> {
  const jobId = `ing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const config = { testCode, sectionCode, pdfPath };
  
  try {
    const { error } = await supabaseServer
      .from('ingestion_runs')
      .insert({
        id: jobId,
        status: 'pending',
        configuration: config,
        started_at: now,
        created_at: now,
      });
    
    if (error) {
      if (error.message.includes('schema cache')) {
        console.warn(`⚠️ [Ingestion] Supabase schema cache issue, using local-only job ID: ${jobId}`);
        console.log(`📝 [Ingestion] Created job (local-only): ${jobId} [LOCAL]`);
        return jobId;
      }
      throw new Error(error.message);
    }
    
    console.log(`📝 [Ingestion] Created job in Supabase: ${jobId} [SUPABASE]`);
    return jobId;
  } catch (err: any) {
    if (err.message.includes('schema cache')) {
      console.warn(`⚠️ [Ingestion] Supabase schema cache issue, using local-only job ID: ${jobId}`);
      console.log(`📝 [Ingestion] Created job (local-only): ${jobId} [LOCAL]`);
      return jobId;
    }
    console.error(`❌ [Ingestion] Failed to create job in Supabase:`, err.message);
    throw new Error(`Failed to create ingestion job: ${err.message}`);
  }
}

export async function getJobFromDB(jobId: string): Promise<any | null> {
  try {
    const { data, error } = await supabaseServer
      .from('ingestion_runs')
      .select('*')
      .eq('id', jobId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error(`❌ [Ingestion] Failed to fetch job from Supabase:`, error.message);
      return null;
    }
    
    return data;
  } catch (err: any) {
    console.error(`❌ [Ingestion] Failed to fetch job from Supabase:`, err.message);
    return null;
  }
}

export async function getJobsFromDB(limit: number = 50): Promise<any[]> {
  try {
    const { data, error } = await supabaseServer
      .from('ingestion_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error(`❌ [Ingestion] Failed to fetch jobs from Supabase:`, error.message);
      return [];
    }
    
    return data || [];
  } catch (err: any) {
    console.error(`❌ [Ingestion] Failed to fetch jobs from Supabase:`, err.message);
    return [];
  }
}
