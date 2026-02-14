/**
 * Lyceon Ingestion v3 - Outside Schema Generator
 * 
 * Uses a light LLM (Gemini Flash) to generate a per-PDF OutsideSchema
 * that describes how to parse questions from DocAI output.
 */

import { GoogleGenAI } from "@google/genai";
import type { OutsideSchema, DocAiEntityDefinition } from './types';

let _geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (_geminiClient) return _geminiClient;
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }
  _geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _geminiClient;
}

const SCHEMA_GENERATOR_PROMPT = `You are a document layout and schema designer for an exam ingestion pipeline.
You receive sample text from a PDF containing standardized test questions (SAT, ACT, AP, etc.).
Your job is to design a per-document "outside schema" that describes how to detect questions, stems, answer options, and answer keys from OCR'd text and layout.

The schema is used by a separate parser reading Google Document AI output. You do NOT run OCR. You only design the schema.

## Output Format

You must output valid JSON matching this TypeScript interface:

\`\`\`typescript
interface OutsideSchema {
  documentType: string;  // e.g. "SAT_MATH_SECTION", "SAT_RW_SECTION"
  entities: {
    name: string;
    displayName: string;
    valueType: "string" | "number";
    occurrence: "REQUIRED" | "OPTIONAL" | "REPEATED";
    children?: any[];
    hints?: string[];
  }[];
  layoutHeuristics: {
    questionNumberPattern?: string;   // Regex to detect question numbers, e.g. "^\\d+\\."
    optionPrefixPattern?: string;     // Regex to detect options, e.g. "^[A-D][\\).]"
    answerKeyPattern?: string;        // Regex for answer key section
    multiPageThresholdLines?: number; // Lines threshold for multi-page questions
  };
}
\`\`\`

## Requirements

1. questionNumberPattern and optionPrefixPattern MUST be non-empty regex patterns
2. entities MUST include at least: question, question_stem, option
3. Assume multiple questions per page
4. Be robust to multi-page questions

## Examples

### SAT Math Section
\`\`\`json
{
  "documentType": "SAT_MATH_SECTION",
  "entities": [
    {"name": "question", "displayName": "Question", "valueType": "string", "occurrence": "REPEATED", "children": [
      {"name": "question_number", "displayName": "Question Number", "valueType": "number", "occurrence": "REQUIRED"},
      {"name": "question_stem", "displayName": "Question Stem", "valueType": "string", "occurrence": "REQUIRED"},
      {"name": "option", "displayName": "Answer Option", "valueType": "string", "occurrence": "REPEATED", "hints": ["A)", "B)", "C)", "D)"]}
    ]}
  ],
  "layoutHeuristics": {
    "questionNumberPattern": "^\\\\d+\\\\.?\\\\s",
    "optionPrefixPattern": "^[A-D][\\\\).:]\\\\s?",
    "answerKeyPattern": "Answer[s]?:?\\\\s*[A-D]",
    "multiPageThresholdLines": 30
  }
}
\`\`\`

### SAT Reading & Writing Section
\`\`\`json
{
  "documentType": "SAT_RW_SECTION",
  "entities": [
    {"name": "passage", "displayName": "Reading Passage", "valueType": "string", "occurrence": "OPTIONAL"},
    {"name": "question", "displayName": "Question", "valueType": "string", "occurrence": "REPEATED", "children": [
      {"name": "question_number", "displayName": "Question Number", "valueType": "number", "occurrence": "REQUIRED"},
      {"name": "question_stem", "displayName": "Question Stem", "valueType": "string", "occurrence": "REQUIRED"},
      {"name": "option", "displayName": "Answer Option", "valueType": "string", "occurrence": "REPEATED"}
    ]}
  ],
  "layoutHeuristics": {
    "questionNumberPattern": "^\\\\d+\\\\.?\\\\s",
    "optionPrefixPattern": "^\\\\(?[A-D]\\\\)?[\\\\).:]?\\\\s?",
    "answerKeyPattern": null,
    "multiPageThresholdLines": 50
  }
}
\`\`\`

Return JSON only, no explanation or markdown code blocks.`;

export async function generateOutsideSchema(
  sampleText: string,
  documentDescription: string,
  testCode: string = 'SAT',
  sectionCode: string = 'M'
): Promise<OutsideSchema> {
  const client = getGeminiClient();
  
  const userPrompt = `Document description: ${documentDescription}
Test type: ${testCode}
Section: ${sectionCode === 'M' ? 'Math' : 'Reading and Writing'}

Sample text from PDF (first 3000 chars):
---
${sampleText.slice(0, 3000)}
---

Based on this sample, generate an OutsideSchema JSON that describes how to detect and parse questions from this document.

Return JSON only.`;

  console.log(`🧠 [Schema] Generating OutsideSchema for ${testCode} ${sectionCode}...`);
  
  const response = await client.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      { role: "user", parts: [{ text: SCHEMA_GENERATOR_PROMPT }] },
      { role: "model", parts: [{ text: "I understand. I'll analyze the sample text and generate a valid OutsideSchema JSON." }] },
      { role: "user", parts: [{ text: userPrompt }] },
    ],
  });
  
  const responseText = response.text || '';
  
  let jsonText = responseText.trim();
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7);
  }
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3);
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3);
  }
  jsonText = jsonText.trim();
  
  try {
    const schema = JSON.parse(jsonText) as OutsideSchema;
    
    if (!schema.layoutHeuristics?.questionNumberPattern) {
      schema.layoutHeuristics = schema.layoutHeuristics || {};
      schema.layoutHeuristics.questionNumberPattern = "^\\d+\\.?\\s";
    }
    if (!schema.layoutHeuristics?.optionPrefixPattern) {
      schema.layoutHeuristics.optionPrefixPattern = "^[A-D][\\).]\\s?";
    }
    
    console.log(`✅ [Schema] Generated schema for ${schema.documentType}`);
    return schema;
    
  } catch (error: any) {
    console.error(`❌ [Schema] Failed to parse LLM response:`, responseText.slice(0, 500));
    throw new Error(`Failed to parse OutsideSchema: ${error.message}`);
  }
}

export function getDefaultSchema(testCode: string, sectionCode: string): OutsideSchema {
  const isMath = sectionCode === 'M' || sectionCode.toLowerCase().includes('math');
  
  return {
    documentType: isMath ? 'SAT_MATH_SECTION' : 'SAT_RW_SECTION',
    entities: [
      {
        name: 'question',
        displayName: 'Question',
        valueType: 'string',
        occurrence: 'REPEATED',
        children: [
          { name: 'question_number', displayName: 'Question Number', valueType: 'number', occurrence: 'REQUIRED' },
          { name: 'question_stem', displayName: 'Question Stem', valueType: 'string', occurrence: 'REQUIRED' },
          { name: 'option', displayName: 'Answer Option', valueType: 'string', occurrence: 'REPEATED', hints: ['A)', 'B)', 'C)', 'D)'] },
        ],
      },
    ],
    layoutHeuristics: {
      questionNumberPattern: '^\\d+\\.?\\s',
      optionPrefixPattern: '^[A-D][\\).]\\s?',
      answerKeyPattern: 'Answer[s]?:?\\s*[A-D]',
      multiPageThresholdLines: isMath ? 30 : 50,
    },
  };
}
