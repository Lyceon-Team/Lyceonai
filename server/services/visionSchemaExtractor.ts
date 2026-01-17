/**
 * Vision Schema Extractor for PDF Ingestion v2
 * 
 * Uses Gemini Vision (or OpenAI GPT-4V) to extract SAT questions from page images.
 * This implements Option B: Vision-LLM-driven schema extraction.
 * 
 * Pipeline: Upload → Vision LLM schema writer → QA validator → Supabase ingest → RAG/Tutor
 */

import { GoogleGenAI } from "@google/genai";
import * as fs from 'fs';
import type { QuestionDoc, QuestionOption, Competency } from './questionTypes';
import { generateCanonicalId, sectionToCode, normalizeAnswerChoice } from './questionTypes';

const VISION_MODEL_NAME = process.env.VISION_MODEL_NAME || 'gemini-2.0-flash';

const VISION_SYSTEM_PROMPT = `
You are an expert SAT content parser.

You are given an image of a single page from an official SAT practice PDF.
Your job is to extract ALL SAT questions visible on this page and return a
clean, student-ready JSON representation of each question.

You MUST:
- Read BOTH the text and math on the page (including equations, exponents, fractions, radicals, subscripts, graphs, and tables).
- Preserve the full mathematical meaning in plain-text form. You may use:
  - "^" for exponents (e.g., x^2, 3x^3)
  - "sqrt(...)" for square roots
  - "/" for fractions (e.g., (3x+1)/(2x-5))
  - "≤, ≥, ≠" for inequalities when visible
- Include diagrams or graph references in the stem as needed (e.g., "In the xy-plane, the graph shown has ...").
- Return ONLY JSON. NO explanations, NO markdown, NO extra text.

You MUST output an array of questions. For each question, use this schema:

{
  "questionId": string | null,
  "canonicalId": string | null,
  "exam": "SAT",
  "testCode": string | null,
  "sectionCode": "M" | "RW",
  "stem": string,
  "options": [
    { "key": "A", "text": string },
    { "key": "B", "text": string },
    { "key": "C", "text": string },
    { "key": "D", "text": string }
  ],
  "answer": "A" | "B" | "C" | "D" | null,
  "difficulty": "EASY" | "MEDIUM" | "HARD" | null,
  "competencies": [
    { "raw": string, "code": string | null }
  ],
  "metadata": {
    "pageNumber": number,
    "hasDiagram": boolean,
    "sourceRegion": string | null
  }
}

STRICT RULES:
- If the correct answer is NOT clearly indicated on the page, set "answer": null.
- NEVER hallucinate math that is not clearly visible.
- If part of an expression is unreadable, include a placeholder with a note, e.g. "f(x) = [unreadable expression]".
- Always return a JSON array: [] if there are no questions on the page.
- Do NOT wrap the JSON in backticks or any other formatting.
`.trim();

interface VisionExtractionInput {
  pageImage: Buffer | Uint8Array | string;
  pageNumber: number;
  exam: "SAT";
  sectionCode: "M" | "RW";
  testCode?: string | null;
  sourcePdf?: string | null;
}

interface RawVisionQuestion {
  questionId?: string | null;
  canonicalId?: string | null;
  exam?: string;
  testCode?: string | null;
  sectionCode?: "M" | "RW";
  stem: string;
  options?: Array<{ key: string; text: string }>;
  answer?: "A" | "B" | "C" | "D" | null;
  difficulty?: "EASY" | "MEDIUM" | "HARD" | null;
  competencies?: Array<{ raw?: string; code?: string | null }>;
  metadata?: {
    pageNumber?: number;
    hasDiagram?: boolean;
    sourceRegion?: string | null;
  };
}

let _geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (_geminiClient) return _geminiClient;
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("[VISION] Missing GEMINI_API_KEY - required for Vision extraction");
  }
  _geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _geminiClient;
}

function buildUserPrompt(pageNumber: number, sectionCode: "M" | "RW", testCode?: string | null): string {
  const sectionName = sectionCode === "M" ? "Math" : "Reading and Writing";
  return `
You are parsing page ${pageNumber} of a SAT ${sectionName} section.

Context:
- exam: "SAT"
- testCode: ${testCode ? `"${testCode}"` : "null"}
- sectionCode: "${sectionCode}"

Use the attached page image to extract every COMPLETE SAT question on this page.
Output ONLY the JSON array described in the system prompt.
`.trim();
}

function repairJson(rawText: string): string {
  let cleaned = rawText.trim();
  
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  
  cleaned = cleaned.trim();
  
  const arrayStart = cleaned.indexOf('[');
  const arrayEnd = cleaned.lastIndexOf(']');
  
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    cleaned = cleaned.slice(arrayStart, arrayEnd + 1);
  }
  
  return cleaned;
}

function convertToQuestionDoc(raw: RawVisionQuestion, input: VisionExtractionInput): QuestionDoc {
  const sectionCode = sectionToCode(raw.sectionCode || input.sectionCode);
  const testCode = raw.testCode || input.testCode || "SAT";
  
  const canonicalId = raw.canonicalId || generateCanonicalId({
    testCode,
    sectionCode,
    sourceType: 1,
  });
  
  const options: QuestionOption[] = (raw.options || []).map(opt => ({
    key: opt.key?.toUpperCase() || '',
    text: opt.text || '',
  }));
  
  while (options.length < 4) {
    const missingKeys = ['A', 'B', 'C', 'D'].filter(k => !options.find(o => o.key === k));
    if (missingKeys.length > 0) {
      options.push({ key: missingKeys[0], text: '' });
    } else {
      break;
    }
  }
  
  options.sort((a, b) => a.key.localeCompare(b.key));
  
  const competencies: Competency[] = (raw.competencies || []).map(c => ({
    code: c.code || '',
    raw: c.raw || null,
  }));
  
  return {
    canonicalId,
    testCode,
    sectionCode,
    sourceType: 1,
    stem: raw.stem || '',
    options,
    answerChoice: normalizeAnswerChoice(raw.answer),
    explanation: null,
    competencies,
    difficulty: raw.difficulty || null,
    tags: [],
    sourcePdf: input.sourcePdf || null,
    pageNumber: raw.metadata?.pageNumber || input.pageNumber,
    version: 1,
    engineUsed: 'vision',
    engineConfidence: 0.85,
  };
}

export async function extractQuestionsFromPage(input: VisionExtractionInput): Promise<QuestionDoc[]> {
  const { pageImage, pageNumber, sectionCode, testCode, sourcePdf } = input;
  
  console.log(`[VISION] Page ${pageNumber}: Starting extraction (section=${sectionCode})`);
  
  try {
    const client = getGeminiClient();
    
    let imageData: { inlineData: { mimeType: string; data: string } };
    
    if (typeof pageImage === 'string') {
      if (pageImage.startsWith('/') || pageImage.includes('\\')) {
        const fileBuffer = fs.readFileSync(pageImage);
        imageData = {
          inlineData: {
            mimeType: 'image/png',
            data: fileBuffer.toString('base64'),
          },
        };
      } else {
        imageData = {
          inlineData: {
            mimeType: 'image/png',
            data: pageImage,
          },
        };
      }
    } else {
      const buffer = Buffer.isBuffer(pageImage) ? pageImage : Buffer.from(pageImage);
      imageData = {
        inlineData: {
          mimeType: 'application/pdf',
          data: buffer.toString('base64'),
        },
      };
    }
    
    const userPrompt = buildUserPrompt(pageNumber, sectionCode, testCode);
    
    const response = await client.models.generateContent({
      model: VISION_MODEL_NAME,
      config: {
        systemInstruction: VISION_SYSTEM_PROMPT,
      },
      contents: [
        {
          role: 'user',
          parts: [
            imageData,
            { text: userPrompt },
          ],
        },
      ],
    });
    
    const rawText = response.text || '';
    
    if (!rawText.trim()) {
      console.log(`[VISION] Page ${pageNumber}: Empty response from model`);
      return [];
    }
    
    let parsed: RawVisionQuestion[];
    try {
      parsed = JSON.parse(rawText);
    } catch (e1) {
      console.log(`[VISION] Page ${pageNumber}: Direct JSON parse failed, attempting repair...`);
      try {
        const repaired = repairJson(rawText);
        parsed = JSON.parse(repaired);
      } catch (e2) {
        console.error(`[VISION] Page ${pageNumber}: JSON parse failed after repair`, e2);
        console.log(`[VISION] Page ${pageNumber}: Raw response (first 500 chars):`, rawText.slice(0, 500));
        return [];
      }
    }
    
    if (!Array.isArray(parsed)) {
      console.log(`[VISION] Page ${pageNumber}: Response was not an array, wrapping...`);
      parsed = [parsed as RawVisionQuestion];
    }
    
    const validQuestions = parsed.filter(q => q && typeof q.stem === 'string' && q.stem.trim().length > 0);
    
    const questionDocs = validQuestions.map(raw => convertToQuestionDoc(raw, {
      ...input,
      sourcePdf,
    }));
    
    console.log(`[VISION] Page ${pageNumber}: Extracted ${questionDocs.length} questions`);
    
    return questionDocs;
    
  } catch (error: any) {
    console.error(`[VISION] Page ${pageNumber}: Extraction failed -`, error.message);
    return [];
  }
}

export async function extractQuestionsFromPages(
  pages: Array<{ image: Buffer | string; pageNumber: number }>,
  options: {
    exam: "SAT";
    sectionCode: "M" | "RW";
    testCode?: string | null;
    sourcePdf?: string | null;
    concurrencyLimit?: number;
  }
): Promise<QuestionDoc[]> {
  const { exam, sectionCode, testCode, sourcePdf, concurrencyLimit = 2 } = options;
  
  console.log(`[VISION] Starting batch extraction: ${pages.length} pages, section=${sectionCode}`);
  
  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(concurrencyLimit);
  
  const extractionPromises = pages.map(page =>
    limit(() => extractQuestionsFromPage({
      pageImage: page.image,
      pageNumber: page.pageNumber,
      exam,
      sectionCode,
      testCode,
      sourcePdf,
    }))
  );
  
  const results = await Promise.all(extractionPromises);
  
  const allQuestions = results.flat();
  
  console.log(`[VISION] Batch extraction complete: ${allQuestions.length} total questions from ${pages.length} pages`);
  
  return allQuestions;
}

export function isVisionPipelineEnabled(): boolean {
  const enabled = !!process.env.GEMINI_API_KEY && process.env.ENABLE_VISION_INGESTION !== 'false';
  return enabled;
}

export function getVisionConfig(): { enabled: boolean; modelName: string } {
  return {
    enabled: isVisionPipelineEnabled(),
    modelName: VISION_MODEL_NAME,
  };
}
