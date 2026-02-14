/**
 * Lyceon Ingestion v3 - QA Service
 * 
 * Two-pass QA validation:
 * - Pass 1: Evaluate DocAI drafts → GOOD | NEEDS_VISION_FALLBACK | REJECT_HARD
 * - Pass 2: Reconcile DocAI + Vision drafts → final QuestionDoc
 */

import { GoogleGenAI } from "@google/genai";
import type { 
  OutsideSchema, 
  QuestionDocDraft, 
  QuestionDoc,
  QuestionOption,
  QAPassResult,
  QAReconcileResult,
  QAStatus,
  QuestionCompetency
} from './types';

let _geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (_geminiClient) return _geminiClient;
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }
  _geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _geminiClient;
}

const QA_DOCAI_PROMPT = `You are the QA and validation layer for an exam ingestion pipeline.
You receive a list of draft questions extracted from OCR and a per-PDF schema.

Your job is to:
1. Evaluate question stem and answer options for completeness.
2. Decide whether each draft is GOOD, NEEDS_VISION_FALLBACK, or REJECT_HARD.
3. For GOOD drafts, optionally fill relaxed metadata fields (difficulty, competencies, etc.).

## Strict Fields:
- stem: Should be a question or instruction. Math expressions, formulas, and equations are expected and valid.
- options: Should have at least 2-4 choices. Missing option text is okay if option keys exist.

## Relaxed Fields (can be inferred):
- difficulty: easy, medium, hard
- competencies: topic codes like "ALG", "GEOM", etc.

## Status Rules - BE LENIENT, PREFER NEEDS_VISION_FALLBACK:
- GOOD: Stem exists (5+ chars) and at least 2 options with text.
- NEEDS_VISION_FALLBACK: Stem exists but options are incomplete, OR stem has OCR artifacts that vision could fix.
- REJECT_HARD: ONLY if the draft is completely empty (no stem AND no options) or contains only garbage characters.

## IMPORTANT FOR MATH QUESTIONS:
- Math expressions like "x^2 + 5", "sqrt(16)", fractions, and equations are VALID stems.
- Numeric answers like "4", "3/5", "2.5" are VALID options.
- Short stems (even 5-10 chars) with math expressions are VALID.
- Do NOT reject math questions for having "incomplete" expressions - mark as NEEDS_VISION_FALLBACK instead.

For each draft, output an object:
{
  "draftId": string,
  "status": "GOOD" | "NEEDS_VISION_FALLBACK" | "REJECT_HARD",
  "repairedStem": string | null,
  "repairedOptions": { "key": "A" | "B" | "C" | "D", "text": string }[] | null,
  "filledMetadata": {
    "difficulty"?: string | null,
    "competencies"?: { "code": string; "raw": string | null; }[]
  },
  "rejectionReason"?: string
}

Return JSON only: { "results": [...] }`;

const QA_RECONCILE_PROMPT = `You are the final QA decision maker for exam ingestion.
For each question, you receive:
- A draft from DocAI extraction.
- A draft from a vision model extraction.
- The per-PDF schema.

Your job:
- Choose the best stem and options from either draft.
- Fill relaxed metadata if possible.
- BE LENIENT: Accept if either draft has a usable stem (5+ chars) and at least 2 options.

## IMPORTANT - PREFER ACCEPTANCE:
- Math expressions, formulas, and equations are VALID question stems.
- Numeric answers like "4", "3/5", "2.5" are VALID options.
- Short stems with math content are VALID.
- Missing option D is acceptable - just include what's available.
- ONLY reject if BOTH drafts are completely empty or pure garbage.

Using the rules:
- Prefer the draft whose stem and options more faithfully reflect the question.
- You may edit minor OCR artifacts for readability.
- Do not change the meaning of the question or options.

Output:
{
  "status": "ACCEPTED" | "REJECTED",
  "finalQuestion"?: {
    "stem": string,
    "options": { "key": "A"|"B"|"C"|"D"; "text": string }[],
    "answer": "A"|"B"|"C"|"D" | null,
    "difficulty": string | null,
    "competencies": { "code": string; "raw": string | null }[]
  },
  "rejectionReason"?: string
}

Return JSON only.`;

export interface QAPass1Result {
  results: QAPassResult[];
  goodDrafts: QuestionDocDraft[];
  needsVisionDrafts: QuestionDocDraft[];
  rejectedDrafts: QuestionDocDraft[];
}

export async function qaDocAiPass(
  drafts: QuestionDocDraft[],
  schema: OutsideSchema,
  jobId: string
): Promise<QAPass1Result> {
  console.log(`🔍 [QA-Pass1] Evaluating ${drafts.length} DocAI drafts...`);
  
  if (drafts.length === 0) {
    return { results: [], goodDrafts: [], needsVisionDrafts: [], rejectedDrafts: [] };
  }

  const client = getGeminiClient();
  
  const draftsJson = drafts.map(d => ({
    draftId: d.draftId,
    stem: d.stem,
    options: d.options,
    answer: d.answer,
    sourcePages: d.sourcePages,
  }));

  const userPrompt = `Schema: ${JSON.stringify(schema, null, 2)}

Drafts to evaluate:
${JSON.stringify(draftsJson, null, 2)}

Evaluate each draft and return JSON only.`;

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        { role: "user", parts: [{ text: QA_DOCAI_PROMPT }] },
        { role: "model", parts: [{ text: "I understand. I'll evaluate each draft according to the strict/relaxed field rules." }] },
        { role: "user", parts: [{ text: userPrompt }] },
      ],
    });

    const responseText = response.text || '';
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7);
    if (jsonText.startsWith('```')) jsonText = jsonText.slice(3);
    if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3);
    jsonText = jsonText.trim();

    const parsed = JSON.parse(jsonText);
    const results: QAPassResult[] = parsed.results || [];

    const goodDrafts: QuestionDocDraft[] = [];
    const needsVisionDrafts: QuestionDocDraft[] = [];
    const rejectedDrafts: QuestionDocDraft[] = [];

    for (const result of results) {
      const draft = drafts.find(d => d.draftId === result.draftId);
      if (!draft) continue;

      if (result.repairedStem) draft.stem = result.repairedStem;
      if (result.repairedOptions) draft.options = result.repairedOptions;

      switch (result.status) {
        case 'GOOD':
          goodDrafts.push(draft);
          break;
        case 'NEEDS_VISION_FALLBACK':
          needsVisionDrafts.push(draft);
          break;
        case 'REJECT_HARD':
          rejectedDrafts.push(draft);
          break;
      }
    }

    console.log(`✅ [QA-Pass1] Results: ${goodDrafts.length} GOOD, ${needsVisionDrafts.length} NEEDS_VISION, ${rejectedDrafts.length} REJECTED`);
    
    // Log rejection reasons for debugging
    for (const result of results) {
      if (result.status === 'REJECT_HARD') {
        console.log(`   ❌ [Rejected] ${result.draftId}: ${result.rejectionReason || 'No reason given'}`);
      } else if (result.status === 'NEEDS_VISION_FALLBACK') {
        console.log(`   ⚠️ [NeedsVision] ${result.draftId}`);
      }
    }

    return { results, goodDrafts, needsVisionDrafts, rejectedDrafts };

  } catch (error: any) {
    console.error(`❌ [QA-Pass1] LLM call failed:`, error.message);
    
    const results: QAPassResult[] = drafts.map(d => ({
      draftId: d.draftId,
      status: evaluateDraftLocally(d),
      repairedStem: null,
      repairedOptions: null,
      filledMetadata: {},
    }));

    return categorizeResults(drafts, results);
  }
}

function evaluateDraftLocally(draft: QuestionDocDraft): QAStatus {
  // Very lenient: only REJECT_HARD if completely empty
  if (!draft.stem && (!draft.options || draft.options.length === 0)) {
    console.log(`   [LocalQA] ${draft.draftId}: REJECT_HARD - no stem AND no options`);
    return 'REJECT_HARD';
  }
  
  // If stem exists (even short) and has at least 2 options, mark as GOOD
  if (draft.stem && draft.stem.length >= 5 && draft.options && draft.options.length >= 2) {
    const optionsWithText = draft.options.filter(o => o.text && o.text.length > 0);
    if (optionsWithText.length >= 2) {
      console.log(`   [LocalQA] ${draft.draftId}: GOOD - stem + ${optionsWithText.length} options`);
      return 'GOOD';
    }
  }
  
  // Everything else gets vision fallback
  console.log(`   [LocalQA] ${draft.draftId}: NEEDS_VISION_FALLBACK - stem: ${draft.stem?.length || 0} chars, options: ${draft.options?.length || 0}`);
  return 'NEEDS_VISION_FALLBACK';
}

function categorizeResults(drafts: QuestionDocDraft[], results: QAPassResult[]): QAPass1Result {
  const goodDrafts: QuestionDocDraft[] = [];
  const needsVisionDrafts: QuestionDocDraft[] = [];
  const rejectedDrafts: QuestionDocDraft[] = [];

  for (const result of results) {
    const draft = drafts.find(d => d.draftId === result.draftId);
    if (!draft) continue;

    switch (result.status) {
      case 'GOOD': goodDrafts.push(draft); break;
      case 'NEEDS_VISION_FALLBACK': needsVisionDrafts.push(draft); break;
      case 'REJECT_HARD': rejectedDrafts.push(draft); break;
    }
  }

  return { results, goodDrafts, needsVisionDrafts, rejectedDrafts };
}

export async function qaReconcilePass(
  docAiDraft: QuestionDocDraft,
  visionDraft: QuestionDocDraft,
  schema: OutsideSchema,
  jobContext: { testCode: string; sectionCode: string; pdfPath: string }
): Promise<QAReconcileResult> {
  console.log(`🔍 [QA-Reconcile] Comparing DocAI vs Vision for ${docAiDraft.draftId}`);

  const client = getGeminiClient();

  const userPrompt = `Schema: ${JSON.stringify(schema, null, 2)}

DocAI Draft:
${JSON.stringify({
  stem: docAiDraft.stem,
  options: docAiDraft.options,
  answer: docAiDraft.answer,
}, null, 2)}

Vision Draft:
${JSON.stringify({
  stem: visionDraft.stem,
  options: visionDraft.options,
  answer: visionDraft.answer,
}, null, 2)}

Choose the best representation and output JSON only.`;

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        { role: "user", parts: [{ text: QA_RECONCILE_PROMPT }] },
        { role: "model", parts: [{ text: "I'll compare both drafts and select the best representation." }] },
        { role: "user", parts: [{ text: userPrompt }] },
      ],
    });

    const responseText = response.text || '';
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7);
    if (jsonText.startsWith('```')) jsonText = jsonText.slice(3);
    if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3);

    const parsed = JSON.parse(jsonText.trim());

    if (parsed.status === 'ACCEPTED' && parsed.finalQuestion) {
      console.log(`   ✅ [Reconcile] ${docAiDraft.draftId}: ACCEPTED by LLM`);
      const finalDoc = buildQuestionDoc(
        parsed.finalQuestion,
        visionDraft,
        jobContext
      );
      return { status: 'ACCEPTED', finalQuestion: finalDoc };
    }

    console.log(`   ❌ [Reconcile] ${docAiDraft.draftId}: REJECTED - ${parsed.rejectionReason || 'Both drafts unusable'}`);
    return { 
      status: 'REJECTED', 
      rejectionReason: parsed.rejectionReason || 'Both drafts unusable' 
    };

  } catch (error: any) {
    console.error(`❌ [QA-Reconcile] Failed for ${docAiDraft.draftId}:`, error.message);
    
    // Lenient fallback: accept if either draft has stem + 2 options
    const bestDraft = (visionDraft.stem && visionDraft.options && visionDraft.options.length >= 2) 
      ? visionDraft 
      : (docAiDraft.stem && docAiDraft.options && docAiDraft.options.length >= 2)
        ? docAiDraft 
        : null;
    
    if (bestDraft) {
      console.log(`   ✅ [Reconcile] ${docAiDraft.draftId}: ACCEPTED via fallback (LLM error)`);
      const finalDoc = buildQuestionDoc(
        {
          stem: bestDraft.stem || '',
          options: bestDraft.options || [],
          answer: bestDraft.answer,
          difficulty: null,
          competencies: [],
        },
        bestDraft,
        jobContext
      );
      return { status: 'ACCEPTED', finalQuestion: finalDoc };
    }

    console.log(`   ❌ [Reconcile] ${docAiDraft.draftId}: REJECTED - both drafts incomplete`);
    return { status: 'REJECTED', rejectionReason: 'Reconciliation failed and both drafts incomplete' };
  }
}

function buildQuestionDoc(
  finalData: {
    stem: string;
    options: QuestionOption[];
    answer: "A" | "B" | "C" | "D" | null;
    difficulty: string | null;
    competencies: QuestionCompetency[];
  },
  draft: QuestionDocDraft,
  context: { testCode: string; sectionCode: string; pdfPath: string }
): QuestionDoc {
  const now = new Date().toISOString();
  const canonicalId = generateCanonicalId(context.testCode, context.sectionCode, draft.draftId);

  return {
    canonicalId,
    testCode: context.testCode,
    sectionCode: context.sectionCode,
    sourceType: 1,
    version: 1,
    stem: finalData.stem,
    options: finalData.options,
    answer: finalData.answer,
    explanation: '',
    difficulty: finalData.difficulty,
    competencies: finalData.competencies || [],
    satQuestionNumber: null,
    sourcePages: draft.sourcePages,
    sourcePdfPath: context.pdfPath,
    createdAt: now,
    updatedAt: now,
  };
}

function generateCanonicalId(testCode: string, sectionCode: string, draftId: string): string {
  const hash = draftId.replace('draft-', '').toUpperCase().slice(0, 8);
  return `${testCode}${sectionCode}${hash}`;
}

export function draftToQuestionDoc(
  draft: QuestionDocDraft,
  metadata: QAPassResult,
  context: { testCode: string; sectionCode: string }
): QuestionDoc | null {
  // Lenient check: only require stem and at least 2 options
  if (!draft.stem || draft.stem.length < 3) {
    console.log(`   [draftToDoc] Skipping ${draft.draftId}: no stem or too short`);
    return null;
  }
  if (!draft.options || draft.options.length < 2) {
    console.log(`   [draftToDoc] Skipping ${draft.draftId}: fewer than 2 options`);
    return null;
  }

  const now = new Date().toISOString();
  const canonicalId = generateCanonicalId(context.testCode, context.sectionCode, draft.draftId);

  return {
    canonicalId,
    testCode: context.testCode,
    sectionCode: context.sectionCode,
    sourceType: 1,
    version: 1,
    stem: metadata.repairedStem || draft.stem,
    options: metadata.repairedOptions || draft.options,
    answer: draft.answer,
    explanation: '',
    difficulty: metadata.filledMetadata?.difficulty || null,
    competencies: metadata.filledMetadata?.competencies || [],
    satQuestionNumber: null,
    sourcePages: draft.sourcePages,
    sourcePdfPath: draft.sourcePdfPath,
    createdAt: now,
    updatedAt: now,
  };
}
