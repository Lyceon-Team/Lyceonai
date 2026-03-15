/**
 * Lyceon Ingestion v3 - Vision Fallback
 * 
 * Uses Gemini Vision to re-extract questions from page images
 * when DocAI extraction fails or is incomplete.
 */

import { GoogleGenAI } from "@google/genai";
import type { 
  OutsideSchema, 
  QuestionDocDraft, 
  QuestionVisionExtract,
  QuestionOption 
} from './types';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs';

let _geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (_geminiClient) return _geminiClient;
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }
  _geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _geminiClient;
}

const VISION_EXTRACT_PROMPT = `You are a vision-language extraction engine for exam questions.
You see an image of a page (or question region) and a per-PDF schema that describes how questions are structured.
Your job is to extract exactly one question according to the schema, with a perfect question stem and four answer options A–D.

## You MUST:
- Read the text exactly from the image.
- Use the schema's patterns and hints.
- Output JSON only in the specified format.

## You MUST NOT:
- Invent a new question.
- Change the answer choices from what appears in the image.
- Guess text that is not clearly visible.

## Output Format
\`\`\`typescript
type QuestionVisionExtract = {
  stem: string;
  options: { key: "A"|"B"|"C"|"D"; text: string }[];
  answer: "A"|"B"|"C"|"D" | null;
};
\`\`\`

Instructions:
- The stem must include all necessary text to understand the question.
- Options must be the four choices labeled A, B, C, D in the image.
- If you see an answer key on the page, set "answer" accordingly; otherwise, set "answer": null.

Return JSON only, with no extra commentary.`;

export async function extractWithVision(
  draft: QuestionDocDraft,
  schema: OutsideSchema,
  pdfBuffer: Buffer
): Promise<QuestionDocDraft> {
  console.log(`👁️ [Vision] Extracting question ${draft.draftId} from pages ${draft.sourcePages.join(',')}`);

  const client = getGeminiClient();
  
  const pageNumber = draft.sourcePages[0] || 1;
  const pageImageBase64 = await extractPageAsImage(pdfBuffer, pageNumber);

  if (!pageImageBase64) {
    console.warn(`⚠️ [Vision] Could not extract page ${pageNumber} as image, using text fallback`);
    return createVisionDraftFromText(draft);
  }

  const userPrompt = `Schema: ${JSON.stringify(schema, null, 2)}

Context from DocAI (may be incomplete/incorrect):
- Partial stem: ${draft.stem?.slice(0, 200) || 'Not detected'}
- Page: ${pageNumber}

Extract the question from the attached image. Return JSON only.`;

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: VISION_EXTRACT_PROMPT },
          ],
        },
        {
          role: "model",
          parts: [{ text: "I understand. I'll extract the question from the image according to the schema." }],
        },
        {
          role: "user",
          parts: [
            { text: userPrompt },
            {
              inlineData: {
                mimeType: "image/png",
                data: pageImageBase64,
              },
            },
          ],
        },
      ],
    });

    const responseText = response.text || '';
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7);
    if (jsonText.startsWith('```')) jsonText = jsonText.slice(3);
    if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3);

    const extracted: QuestionVisionExtract = JSON.parse(jsonText.trim());

    console.log(`✅ [Vision] Extracted: stem=${extracted.stem?.length || 0} chars, options=${extracted.options?.length || 0}`);

    return {
      draftId: draft.draftId + '-vision',
      stem: extracted.stem || null,
      options: extracted.options || null,
      answer: extracted.answer || null,
      sourcePages: draft.sourcePages,
      sourcePdfPath: draft.sourcePdfPath,
      backendSource: 'vision',
      rawBlocks: [responseText],
      notes: ['Extracted via Gemini Vision fallback'],
    };

  } catch (error: any) {
    console.error(`❌ [Vision] Extraction failed for ${draft.draftId}:`, error.message);
    return createVisionDraftFromText(draft);
  }
}

async function extractPageAsImage(pdfBuffer: Buffer, pageNumber: number): Promise<string | null> {
  try {
    console.log(`📄 [Vision] Converting page ${pageNumber} to image...`);
    return null;
  } catch (error: any) {
    console.error(`❌ [Vision] Page image extraction failed:`, error.message);
    return null;
  }
}

function createVisionDraftFromText(originalDraft: QuestionDocDraft): QuestionDocDraft {
  return {
    draftId: originalDraft.draftId + '-vision',
    stem: originalDraft.stem,
    options: originalDraft.options,
    answer: originalDraft.answer,
    sourcePages: originalDraft.sourcePages,
    sourcePdfPath: originalDraft.sourcePdfPath,
    backendSource: 'vision',
    rawBlocks: originalDraft.rawBlocks,
    notes: ['Vision fallback failed, using original DocAI data'],
  };
}

export async function batchExtractWithVision(
  drafts: QuestionDocDraft[],
  schema: OutsideSchema,
  pdfBuffer: Buffer
): Promise<Map<string, QuestionDocDraft>> {
  const results = new Map<string, QuestionDocDraft>();

  console.log(`👁️ [Vision] Batch extracting ${drafts.length} questions...`);

  for (const draft of drafts) {
    try {
      const visionDraft = await extractWithVision(draft, schema, pdfBuffer);
      results.set(draft.draftId, visionDraft);
      
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error: any) {
      console.error(`❌ [Vision] Failed for ${draft.draftId}:`, error.message);
      results.set(draft.draftId, createVisionDraftFromText(draft));
    }
  }

  console.log(`✅ [Vision] Batch complete: ${results.size} drafts processed`);
  return results;
}
