/*
 * DEPRECATED: Being replaced by MVP ingest endpoint
 * Commenting out to avoid import errors during transition
 */

import { Request, Response, Router } from 'express';
// import fs from 'fs';
// import path from 'path';
// import crypto from 'crypto';
// import { env } from '../env';
// import { QAItem, QAItemMC, QAItemFR, Choice } from '../../../../packages/shared/src/types';
// import { runIngest, startIngest } from './ingest';

// Stub export to prevent import errors
export const router = Router();
export default router;

/* Original code commented out for MVP transition

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '../env';
import { QAItem, QAItemMC, QAItemFR, Choice } from '../../../../packages/shared/src/types';

const INGEST_TIMEOUT_MS = parseInt(process.env.INGEST_TIMEOUT_MS || '180000');

interface OCRResult {
  text: string;
  provider: string;
  elapsedMs: number;
  charCount: number;
}

interface ParseResult {
  questions: QAItem[];
  elapsedMs: number;
  mcCount: number;
  frCount: number;
  duplicatesCount: number;
  validationSkipped: number;
}

interface ProcessingMetrics {
  attemptedCount: number;
  mcInserted: number;
  frInserted: number;
  duplicatesCount: number;
  freeResponseSkipped: number;
  validationSkipped: number;
  insertedCount: number;
  totalProcessed: number;
  ocrMs: number;
  parseMs: number;
  qaMs: number;
  persistMs: number;
}

// OCR with fallback chain: mathpix -> tesseract
export async function performOCRWithFallbacks(pdfPath: string, timeout: number): Promise<OCRResult> {
  const startTime = Date.now();
  const providers = getOCRFallbackChain();
  
  for (const provider of providers) {
    try {
      console.log(`🔧 [OCR] Trying provider: ${provider}`);
      const result = await performOCR(pdfPath, provider, timeout - (Date.now() - startTime));
      
      // Validate result has sufficient content
      if (result.text.length < 1000 && fs.statSync(pdfPath).size > 100000) {
        console.warn(`⚠️ [OCR] ${provider} returned insufficient text (${result.text.length} chars) for large PDF`);
        continue;
      }
      
      console.log(`✅ [OCR] Success with ${provider}: ${result.charCount} chars in ${result.elapsedMs}ms`);
      return result;
    } catch (error: any) {
      console.warn(`⚠️ [OCR] ${provider} failed: ${error.message}`);
    }
    
    // Check timeout
    if (Date.now() - startTime > timeout) {
      throw new Error(`timeout at ocr stage after ${Date.now() - startTime}ms`);
    }
  }
  
  throw new Error('All OCR providers failed');
}

export function getOCRFallbackChain(): string[] {
  // Build fallback chain based on available credentials
  const chain: string[] = [];
  
  if (env.OCR_PROVIDER === 'auto') {
    // Auto resolver: prefer Mathpix if available, then tesseract
    if (process.env.MATHPIX_API_ID && process.env.MATHPIX_API_KEY_ONLY) {
      chain.push('mathpix');
    }
    chain.push('tesseract');
  } else {
    chain.push(env.OCR_PROVIDER);
    // Add tesseract as fallback
    if (env.OCR_PROVIDER !== 'tesseract') {
      chain.push('tesseract');
    }
  }
  
  return chain;
}

async function performOCR(pdfPath: string, provider: string, timeoutMs: number): Promise<OCRResult> {
  const startTime = Date.now();
  
  switch (provider) {
    case 'mathpix':
      return await performMathpixOCR(pdfPath, startTime);
    case 'tesseract':
      return await performTesseractOCR(pdfPath, startTime);
    default:
      throw new Error(`Unknown OCR provider: ${provider}`);
  }
}

async function performMathpixOCR(pdfPath: string, startTime: number): Promise<OCRResult> {
  // Implement Mathpix OCR using available API credentials
  if (!process.env.MATHPIX_API_ID || !process.env.MATHPIX_API_KEY_ONLY) {
    throw new Error('Mathpix credentials not available');
  }
  
  const fs = require('fs');
  const FormData = require('form-data');
  const fetch = require('node-fetch');
  
  const form = new FormData();
  form.append('file', fs.createReadStream(pdfPath));
  form.append('options_json', JSON.stringify({
    math_inline_delimiters: ['$', '$'],
    rm_spaces: true
  }));
  
  const response = await fetch('https://api.mathpix.com/v3/pdf', {
    method: 'POST',
    headers: {
      app_id: process.env.MATHPIX_API_ID,
      app_key: process.env.MATHPIX_API_KEY_ONLY,
      ...form.getHeaders()
    },
    body: form
  });
  
  if (!response.ok) {
    throw new Error(`Mathpix API error: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  const text = result.text || '';
  const elapsedMs = Date.now() - startTime;
  
  return {
    text,
    provider: 'mathpix',
    elapsedMs,
    charCount: text.length
  };
}

async function performTesseractOCR(pdfPath: string, startTime: number): Promise<OCRResult> {
  const { createWorker } = require('tesseract.js');
  const pdf2pic = require('pdf2pic');
  
  // Convert PDF to images
  const convert = pdf2pic.fromPath(pdfPath, {
    density: 200,
    saveFilename: 'page',
    savePath: '/tmp/',
    format: 'png',
    width: 2000,
    height: 2000
  });
  
  const pages = await convert.bulk(-1, true);
  
  let fullText = '';
  const worker = await createWorker();
  
  try {
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    
    for (const page of pages) {
      const { data: { text } } = await worker.recognize(page.path);
      fullText += text + '\n';
    }
  } finally {
    await worker.terminate();
  }
  
  const elapsedMs = Date.now() - startTime;
  
  return {
    text: fullText,
    provider: 'tesseract',
    elapsedMs,
    charCount: fullText.length
  };
}

// Parse SAT questions from OCR text
async function parseSATQuestions(text: string, sourcePath: string): Promise<ParseResult> {
  const startTime = Date.now();
  const questions: QAItem[] = [];
  let mcCount = 0;
  let frCount = 0;
  let duplicatesCount = 0;
  let validationSkipped = 0;
  
  // Split text into question blocks
  const questionBlocks = text.split(/Question ID\s+([a-f0-9]+)/i).slice(1);
  const seenIds = new Set<string>();
  
  for (let i = 0; i < questionBlocks.length; i += 2) {
    const questionId = questionBlocks[i]?.trim();
    const questionContent = questionBlocks[i + 1];
    
    if (!questionId || !questionContent) continue;
    
    // Check for duplicates
    if (seenIds.has(questionId)) {
      duplicatesCount++;
      console.log(`🔄 [PARSE] Duplicate question ID: ${questionId}`);
      continue;
    }
    seenIds.add(questionId);
    
    try {
      const question = await parseQuestionBlock(questionId, questionContent, sourcePath);
      if (question) {
        questions.push(question);
        if (question.type === 'mc') mcCount++;
        else if (question.type === 'fr') frCount++;
      } else {
        validationSkipped++;
      }
    } catch (error: any) {
      console.warn(`⚠️ [PARSE] Failed to parse question ${questionId}: ${error.message}`);
      validationSkipped++;
    }
  }
  
  console.log(`📊 [PARSE] Extracted ${questions.length} questions (${mcCount} MC, ${frCount} FR) from ${sourcePath}`);
  
  return {
    questions,
    elapsedMs: Date.now() - startTime,
    mcCount,
    frCount,
    duplicatesCount,
    validationSkipped
  };
}

async function parseQuestionBlock(id: string, content: string, sourcePath: string): Promise<QAItem | null> {
  // Clean up the content
  const cleanContent = content.replace(/\s+/g, ' ').trim();
  
  // Extract basic metadata
  const assessmentMatch = cleanContent.match(/Assessment\s+Test\s+Domain\s+Skill\s+Difficulty\s+SAT\s+(.+?)\s+(.+?)\s+(.+?)\s+(.+?)(?:\s|ID:)/);
  const test = assessmentMatch?.[1] || 'SAT';
  const domain = assessmentMatch?.[2] || 'Unknown';
  const skill = assessmentMatch?.[3] || 'Unknown';
  const difficulty = assessmentMatch?.[4] || 'Medium';
  
  // Extract question stem (text between ID and options/choices)  
  const questionMatch = cleanContent.match(/ID:\s*[a-f0-9]+\s+([\s\S]+?)(?:Which choice|What is|A\.|Correct Answer:|Answer)/);
  const questionText = questionMatch?.[1]?.trim();
  
  if (!questionText) {
    throw new Error('Could not extract question text');
  }
  
  // Determine question type based on presence of options
  const hasOptions = /\s+A\.\s+.+?\s+B\.\s+.+?\s+C\.\s+.+?\s+D\.\s+/.test(cleanContent);
  
  if (hasOptions) {
    // Multiple Choice Question
    const optionsMatch = cleanContent.match(/A\.\s+(.+?)\s+B\.\s+(.+?)\s+C\.\s+(.+?)\s+D\.\s+(.+?)(?:\s+ID:|Correct Answer:|$)/);
    if (!optionsMatch) {
      throw new Error('Could not extract MC options');
    }
    
    const rawOptions = [
      optionsMatch[1]?.trim(),
      optionsMatch[2]?.trim(), 
      optionsMatch[3]?.trim(),
      optionsMatch[4]?.trim()
    ].filter(Boolean);
    
    if (rawOptions.length !== 4) {
      throw new Error('MC question must have exactly 4 options');
    }
    
    // Format options as Choice[] for shared types
    const options: Choice[] = rawOptions.map((text, index) => ({
      key: ['A', 'B', 'C', 'D'][index] as 'A' | 'B' | 'C' | 'D',
      text: text
    }));
    
    // Extract correct answer
    const answerMatch = cleanContent.match(/Correct Answer:\s*([A-D])/i);
    const answerChoice = answerMatch?.[1]?.toUpperCase() as 'A' | 'B' | 'C' | 'D';
    
    if (!answerChoice || !['A', 'B', 'C', 'D'].includes(answerChoice)) {
      throw new Error('Could not extract valid MC answer choice');
    }
    
    // Extract explanation
    const explanationMatch = cleanContent.match(/Rationale\s+([\s\S]+?)(?:Question Difficulty:|Choice [A-D] is incorrect|$)/);
    const explanation = explanationMatch?.[1]?.trim();
    
    const mcQuestion: QAItemMC = {
      id: `sat_${id}`,
      type: 'mc',
      stem: questionText,
      options: options,
      answer_choice: answerChoice,
      section: domain === 'Math' ? 'Math' : domain.includes('Reading') ? 'Reading' : 'Writing',
      explanation: explanation || null,
      source: { path: sourcePath, page: 1 },
      tags: [test, domain, skill],
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    return mcQuestion;
  } else {
    // Free Response Question - extract answer from rationale section
    const answerMatch = cleanContent.match(/The correct answer is\s+(.+?)\.?\s+/i) || 
                       cleanContent.match(/Correct Answer:\s*(.+?)(?:\n|Rationale|$)/);
    
    if (!answerMatch) {
      throw new Error('Could not extract FR answer text');
    }
    
    let answerText = answerMatch[1]?.trim();
    // Clean up answer text (remove extra formatting)
    answerText = answerText.replace(/[^\w\s\.\-,]/g, '').trim();
    
    if (!answerText) {
      throw new Error('FR answer text is empty after cleaning');
    }
    
    // Extract explanation
    const explanationMatch = cleanContent.match(/Rationale\s+([\s\S]+?)(?:Question Difficulty:|$)/);
    const explanation = explanationMatch?.[1]?.trim();
    
    const frQuestion: QAItemFR = {
      id: `sat_${id}`,
      type: 'fr',
      stem: questionText,
      answer_text: answerText,
      section: domain === 'Math' ? 'Math' : domain.includes('Reading') ? 'Reading' : 'Writing',
      explanation: explanation || null,
      source: { path: sourcePath, page: 1 },
      tags: [test, domain, skill],
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    return frQuestion;
  }
}

// Student visibility verification
async function verifyStudentVisibility(insertedCount: number): Promise<boolean> {
  if (insertedCount === 0) return true; // No questions inserted, nothing to verify
  
  try {
    const fetch = require('node-fetch');
    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
    
    // Test student endpoints
    const endpoints = [
      `${baseUrl}/api/questions?type=all&limit=1`,
      `${baseUrl}/api/questions/count?type=mc`,
      `${baseUrl}/api/questions/count?type=fr`
    ];
    
    for (const endpoint of endpoints) {
      const response = await fetch(endpoint);
      if (!response.ok) {
        console.error(`❌ [VERIFY] Student endpoint failed: ${endpoint} - ${response.status}`);
        return false;
      }
      
      const data = await response.json();
      console.log(`✅ [VERIFY] Student endpoint working: ${endpoint}`, data);
    }
    
    return true;
  } catch (error: any) {
    console.error(`❌ [VERIFY] Student visibility check failed: ${error.message}`);
    return false;
  }
}

// Main process-and-ingest endpoint
export const processAndIngest = async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { path: pdfPath, jobId } = req.body;
  
  if (!pdfPath || !jobId) {
    return res.status(400).json({ 
      error: 'Missing required fields: path and jobId' 
    });
  }
  
  const fullPdfPath = path.resolve(pdfPath);
  
  // Validate PDF exists
  if (!fs.existsSync(fullPdfPath)) {
    return res.status(400).json({ 
      error: `PDF file not found: ${pdfPath}`,
      stage: 'validation'
    });
  }
  
  const metrics: ProcessingMetrics = {
    attemptedCount: 0,
    mcInserted: 0,
    frInserted: 0,
    duplicatesCount: 0,
    freeResponseSkipped: 0,
    validationSkipped: 0,
    insertedCount: 0,
    totalProcessed: 0,
    ocrMs: 0,
    parseMs: 0,
    qaMs: 0,
    persistMs: 0
  };
  
  try {
    console.log(`📄 [PROCESS] Starting PDF processing: ${pdfPath} [${jobId}]`);
    
    // Stage 1: OCR with fallbacks and backoff
    const ocrResult = await performOCRWithFallbacks(fullPdfPath, INGEST_TIMEOUT_MS * 0.6);
    metrics.ocrMs = ocrResult.elapsedMs;
    
    if (ocrResult.text.length < 500) {
      throw new Error(`OCR returned insufficient text: ${ocrResult.text.length} chars`);
    }
    
    console.log(`🔤 [PROCESS] OCR completed with ${ocrResult.provider}: ${ocrResult.charCount} chars in ${ocrResult.elapsedMs}ms`);
    
    // Stage 2: Parse questions
    const parseResult = await parseSATQuestions(ocrResult.text, pdfPath);
    metrics.parseMs = parseResult.elapsedMs;
    metrics.attemptedCount = parseResult.questions.length + parseResult.duplicatesCount + parseResult.validationSkipped;
    
    if (parseResult.questions.length === 0) {
      return res.status(400).json({
        status: 'failed',
        stage: 'parse',
        error: 'No questions extracted from PDF',
        preview: ocrResult.text.substring(0, 500),
        metrics
      });
    }
    
    // Stage 3: Persist via existing ingestion system
    const persistStart = Date.now();
    
    const mockReq: any = {
      body: {
        items: parseResult.questions,
        jobId
      }
    };
    
    let ingestResult: any;
    const mockRes: any = {
      json: (data: any) => { ingestResult = data; }
    };
    
    await runIngest(mockReq, mockRes);
    metrics.persistMs = Date.now() - persistStart;
    
    if (!ingestResult || !ingestResult.success) {
      throw new Error(`Ingestion failed: ${ingestResult?.error || 'Unknown error'}`);
    }
    
    // Update metrics from ingestion result
    metrics.insertedCount = ingestResult.insertedCount || 0;
    metrics.duplicatesCount = ingestResult.duplicatesCount || 0;
    metrics.totalProcessed = ingestResult.totalProcessed || 0;
    metrics.mcInserted = ingestResult.multipleChoiceCount || 0;
    metrics.frInserted = ingestResult.freeResponseCount || 0;
    
    // Stage 4: Verify student visibility
    const visibilityOk = await verifyStudentVisibility(metrics.insertedCount);
    if (!visibilityOk) {
      throw new Error('Student visibility verification failed');
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`🎉 [PROCESS] PDF processing completed successfully in ${totalTime}ms`);
    console.log(`📊 [PROCESS] Final metrics:`, metrics);
    
    return res.json({
      status: 'done',
      jobId,
      ...metrics,
      totalDurationMs: totalTime,
      provider: ocrResult.provider
    });
    
  } catch (error: any) {
    const errorTime = Date.now() - startTime;
    console.error(`❌ [PROCESS] PDF processing failed after ${errorTime}ms:`, error.message);
    
    // Determine failure stage
    let stage = 'unknown';
    if (error.message.includes('timeout at ocr')) stage = 'ocr';
    else if (error.message.includes('OCR') || error.message.includes('provider')) stage = 'ocr';
    else if (error.message.includes('parse') || error.message.includes('extract')) stage = 'parse';
    else if (error.message.includes('ingestion') || error.message.includes('persist')) stage = 'persist';
    else if (error.message.includes('visibility')) stage = 'visibility';
    
    return res.status(500).json({
      status: 'failed',
      stage,
      error: error.message,
      jobId,
      ...metrics,
      totalDurationMs: errorTime
    });
  }
};*/
