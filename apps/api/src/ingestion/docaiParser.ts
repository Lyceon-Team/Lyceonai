/**
 * Lyceon Ingestion v3 - DocAI Parser
 * 
 * Parses DocAI output into QuestionDocDraft[] using the OutsideSchema.
 * Uses layout heuristics to detect question boundaries and options.
 */

import type { OutsideSchema, QuestionDocDraft, QuestionOption } from './types';
import type { DocAIProcessResult, DocAIPage } from './docaiClient';
import * as crypto from 'crypto';

export interface ParseResult {
  drafts: QuestionDocDraft[];
  parseErrors: string[];
  stats: {
    totalParagraphs: number;
    questionsDetected: number;
    optionsDetected: number;
  };
}

export function parseDocAIOutput(
  docResult: DocAIProcessResult,
  schema: OutsideSchema,
  pdfPath: string
): ParseResult {
  const drafts: QuestionDocDraft[] = [];
  const parseErrors: string[] = [];
  let totalParagraphs = 0;
  let optionsDetected = 0;

  const questionPattern = schema.layoutHeuristics?.questionNumberPattern 
    ? new RegExp(schema.layoutHeuristics.questionNumberPattern, 'm')
    : /^\d+\.?\s/m;
  
  const optionPattern = schema.layoutHeuristics?.optionPrefixPattern
    ? new RegExp(schema.layoutHeuristics.optionPrefixPattern, 'm')
    : /^[A-D][\).]\s?/m;

  console.log(`🔍 [Parser] Parsing ${docResult.pages.length} pages with schema: ${schema.documentType}`);
  console.log(`   Question pattern: ${questionPattern.source}`);
  console.log(`   Option pattern: ${optionPattern.source}`);

  // First pass: identify which ID markers are real questions vs answer sections
  // Real questions have A. B. C. D. options following the ID
  const allParagraphs: { text: string; pageNumber: number }[] = [];
  for (const page of docResult.pages) {
    for (const para of page.paragraphs) {
      allParagraphs.push({ text: para.text.trim(), pageNumber: page.pageNumber });
    }
  }

  // Build a set of indices that start real questions
  const realQuestionStarts = new Set<number>();
  for (let i = 0; i < allParagraphs.length; i++) {
    const text = allParagraphs[i].text;
    if (!text) continue;
    
    const questionMatch = text.match(questionPattern);
    if (questionMatch && (questionMatch.index === 0 || questionMatch.index! < 5)) {
      // Look ahead for option markers (A. B. C. D.)
      let hasOptions = false;
      for (let j = i + 1; j < Math.min(i + 15, allParagraphs.length); j++) {
        const nextText = allParagraphs[j].text;
        if (/^[A-D][\).:\s]/.test(nextText)) {
          hasOptions = true;
          break;
        }
        // Stop looking if we hit another ID or answer marker
        if (questionPattern.test(nextText) || /^(?:Correct\s*Answer|Rationale)/i.test(nextText)) {
          break;
        }
      }
      if (hasOptions) {
        realQuestionStarts.add(i);
      }
    }
  }

  console.log(`   Found ${realQuestionStarts.size} real question starts at indices: ${[...realQuestionStarts].slice(0, 10).join(', ')}...`);
  console.log(`   Total paragraphs to process: ${allParagraphs.length}`);

  let currentDraft: Partial<QuestionDocDraft> | null = null;
  let currentOptions: QuestionOption[] = [];
  let currentBlocks: string[] = [];
  let questionNumber = 0;
  let inAnswerSection = false;

  for (let i = 0; i < allParagraphs.length; i++) {
    const { text, pageNumber } = allParagraphs[i];
    totalParagraphs++;
    if (!text) continue;

    // Check if this is a real question start
    if (realQuestionStarts.has(i)) {
      console.log(`   📝 Creating draft #${questionNumber + 1} at paragraph ${i}: "${text.slice(0, 50)}..."`);
      
      // Finalize previous draft
      if (currentDraft) {
        currentDraft.options = currentOptions.length > 0 ? currentOptions : null;
        drafts.push(finalizeDraft(currentDraft, currentBlocks, pdfPath));
        console.log(`   ✓ Finalized draft with stem=${currentDraft.stem?.length || 0} chars, ${currentOptions.length} options`);
      }

      questionNumber++;
      inAnswerSection = false;
      
      const questionMatch = text.match(questionPattern);
      const stemText = questionMatch 
        ? text.slice((questionMatch.index || 0) + questionMatch[0].length).trim()
        : text;
      
      currentDraft = {
        draftId: generateDraftId(pdfPath, questionNumber),
        stem: stemText || '',  // Use empty string, not null - will accumulate
        sourcePages: [pageNumber],
        backendSource: 'docai',
      };
      currentOptions = [];
      currentBlocks = [text];
      continue;
    }

    // Detect answer/rationale section markers
    const isAnswerSectionStart = /^(?:Correct\s*Answer|Rationale)/i.test(text);
    if (isAnswerSectionStart) {
      inAnswerSection = true;
      // Extract answer if present
      const answerMatch = text.match(/(?:Correct\s*Answer|Answer)[:\s]*([A-D])/i);
      if (answerMatch && currentDraft) {
        currentDraft.answer = answerMatch[1].toUpperCase() as "A" | "B" | "C" | "D";
      }
      currentBlocks.push(text);
      continue;
    }

    // Skip content in answer section
    if (inAnswerSection) {
      currentBlocks.push(text);
      continue;
    }

    const optionMatch = text.match(/^([A-D])[\).:\s]+(.+)/);
    if (optionMatch && currentDraft) {
      const key = optionMatch[1] as "A" | "B" | "C" | "D";
      const optionText = optionMatch[2].trim();
      
      const existingIndex = currentOptions.findIndex(o => o.key === key);
      if (existingIndex >= 0) {
        currentOptions[existingIndex].text += ' ' + optionText;
      } else {
        currentOptions.push({ key, text: optionText });
        optionsDetected++;
      }
      currentBlocks.push(text);
      continue;
    }

    // Accumulate stem (before options found)
    if (currentDraft && currentDraft.stem !== null && currentOptions.length === 0) {
      currentDraft.stem += '\n' + text;
      currentBlocks.push(text);
      
      if (!currentDraft.sourcePages?.includes(pageNumber)) {
        currentDraft.sourcePages?.push(pageNumber);
      }
    } else if (currentDraft) {
      currentBlocks.push(text);
      if (!currentDraft.sourcePages?.includes(pageNumber)) {
        currentDraft.sourcePages?.push(pageNumber);
      }
    }
  }

  if (currentDraft) {
    currentDraft.options = currentOptions.length > 0 ? currentOptions : null;
    drafts.push(finalizeDraft(currentDraft, currentBlocks, pdfPath));
    console.log(`   ✓ Finalized final draft with stem=${currentDraft.stem?.length || 0} chars, ${currentOptions.length} options`);
  }

  // If no drafts found with schema pattern, try fallback patterns
  if (drafts.length === 0 && totalParagraphs > 10) {
    console.log(`⚠️ [Parser] No drafts with schema pattern, trying fallback patterns...`);
    
    const fallbackPatterns = [
      /ID:\s*[a-z0-9]+/im,        // SAT Question Bank format
      /^\d+\.?\s/m,               // Numbered questions
      /^Question\s*\d+/im,        // "Question N" format
    ];
    
    for (const fallbackPattern of fallbackPatterns) {
      const fallbackResult = parseWithPattern(docResult, fallbackPattern, optionPattern, pdfPath);
      if (fallbackResult.drafts.length > 0) {
        console.log(`✅ [Parser] Fallback pattern matched: ${fallbackPattern.source} → ${fallbackResult.drafts.length} drafts`);
        return fallbackResult;
      }
    }
  }

  console.log(`✅ [Parser] Extracted ${drafts.length} question drafts from ${totalParagraphs} paragraphs`);

  return {
    drafts,
    parseErrors,
    stats: {
      totalParagraphs,
      questionsDetected: drafts.length,
      optionsDetected,
    },
  };
}

function parseWithPattern(
  docResult: DocAIProcessResult,
  questionPattern: RegExp,
  optionPattern: RegExp,
  pdfPath: string
): ParseResult {
  const drafts: QuestionDocDraft[] = [];
  const parseErrors: string[] = [];
  let totalParagraphs = 0;
  let optionsDetected = 0;

  let currentDraft: Partial<QuestionDocDraft> | null = null;
  let currentOptions: QuestionOption[] = [];
  let currentBlocks: string[] = [];
  let questionNumber = 0;
  let inAnswerSection = false;

  for (const page of docResult.pages) {
    totalParagraphs += page.paragraphs.length;
    
    for (const para of page.paragraphs) {
      const text = para.text.trim();
      if (!text) continue;

      // Detect answer/rationale section markers
      const isAnswerSectionStart = /^(?:Correct\s*Answer|Answer\s*Explanation|Rationale|Difficulty)/i.test(text);
      if (isAnswerSectionStart) {
        inAnswerSection = true;
        const answerMatch = text.match(/(?:Correct\s*Answer|Answer)[:\s]*([A-D])/i);
        if (answerMatch && currentDraft) {
          currentDraft.answer = answerMatch[1].toUpperCase() as "A" | "B" | "C" | "D";
        }
        currentBlocks.push(text);
        continue;
      }

      const questionMatch = text.match(questionPattern);
      if (questionMatch && (questionMatch.index === 0 || questionMatch.index! < 5)) {
        const textAfterID = text.slice((questionMatch.index || 0) + questionMatch[0].length).trim();
        const looksLikeAnswerSection = inAnswerSection || 
          /^(?:Correct|Answer|Choice\s+[A-D]|Rationale|Explanation|The\s+correct)/i.test(textAfterID);
        
        if (looksLikeAnswerSection) {
          currentBlocks.push(text);
          continue;
        }

        if (currentDraft && currentDraft.stem) {
          currentDraft.options = currentOptions.length > 0 ? currentOptions : null;
          drafts.push(finalizeDraft(currentDraft, currentBlocks, pdfPath));
        }

        questionNumber++;
        inAnswerSection = false;
        
        currentDraft = {
          draftId: generateDraftId(pdfPath, questionNumber),
          stem: textAfterID || null,
          sourcePages: [page.pageNumber],
          backendSource: 'docai',
        };
        currentOptions = [];
        currentBlocks = [text];
        continue;
      }

      const optionMatch = text.match(/^([A-D])[\).:\s]+(.+)/);
      if (optionMatch && currentDraft && !inAnswerSection) {
        const key = optionMatch[1] as "A" | "B" | "C" | "D";
        const optionText = optionMatch[2].trim();
        
        const existingIndex = currentOptions.findIndex(o => o.key === key);
        if (existingIndex >= 0) {
          currentOptions[existingIndex].text += ' ' + optionText;
        } else {
          currentOptions.push({ key, text: optionText });
          optionsDetected++;
        }
        currentBlocks.push(text);
        continue;
      }

      // Skip accumulating stem when in answer section
      if (inAnswerSection) {
        currentBlocks.push(text);
        continue;
      }

      if (currentDraft && currentDraft.stem && currentOptions.length === 0) {
        currentDraft.stem += '\n' + text;
        currentBlocks.push(text);
        if (!currentDraft.sourcePages?.includes(page.pageNumber)) {
          currentDraft.sourcePages?.push(page.pageNumber);
        }
      } else if (currentDraft) {
        currentBlocks.push(text);
        if (!currentDraft.sourcePages?.includes(page.pageNumber)) {
          currentDraft.sourcePages?.push(page.pageNumber);
        }
      }
    }
  }

  if (currentDraft && currentDraft.stem) {
    currentDraft.options = currentOptions.length > 0 ? currentOptions : null;
    drafts.push(finalizeDraft(currentDraft, currentBlocks, pdfPath));
  }

  return {
    drafts,
    parseErrors,
    stats: {
      totalParagraphs,
      questionsDetected: drafts.length,
      optionsDetected,
    },
  };
}

function finalizeDraft(
  partial: Partial<QuestionDocDraft>,
  rawBlocks: string[],
  pdfPath: string
): QuestionDocDraft {
  return {
    draftId: partial.draftId || generateDraftId(pdfPath, Date.now()),
    stem: partial.stem || null,
    options: partial.options || null,
    answer: detectAnswer(rawBlocks) || null,
    sourcePages: partial.sourcePages || [],
    sourcePdfPath: pdfPath,
    backendSource: 'docai',
    rawBlocks,
    notes: [],
  };
}

function detectAnswer(blocks: string[]): "A" | "B" | "C" | "D" | null {
  const fullText = blocks.join('\n');
  
  const answerPatterns = [
    /(?:Answer|Correct|Solution)[:\s]*([A-D])/i,
    /\*\s*([A-D])\s*\*/,
    /\[([A-D])\]/,
  ];
  
  for (const pattern of answerPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      return match[1].toUpperCase() as "A" | "B" | "C" | "D";
    }
  }
  
  return null;
}

function generateDraftId(pdfPath: string, index: number): string {
  const hash = crypto.createHash('md5')
    .update(`${pdfPath}-${index}-${Date.now()}`)
    .digest('hex')
    .slice(0, 8);
  return `draft-${hash}`;
}

export function extractQuestionFromText(
  text: string,
  pageNumber: number,
  pdfPath: string,
  schema: OutsideSchema
): QuestionDocDraft | null {
  const optionPattern = schema.layoutHeuristics?.optionPrefixPattern
    ? new RegExp(schema.layoutHeuristics.optionPrefixPattern, 'gm')
    : /^[A-D][\).]\s?/gm;

  const lines = text.split('\n');
  let stem = '';
  const options: QuestionOption[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    const optionMatch = trimmed.match(/^([A-D])[\).:\s]+(.+)/);
    
    if (optionMatch) {
      options.push({
        key: optionMatch[1] as "A" | "B" | "C" | "D",
        text: optionMatch[2].trim(),
      });
    } else if (options.length === 0) {
      stem += (stem ? '\n' : '') + trimmed;
    }
  }

  if (!stem && options.length === 0) {
    return null;
  }

  return {
    draftId: generateDraftId(pdfPath, pageNumber * 1000 + Math.random() * 1000),
    stem: stem || null,
    options: options.length > 0 ? options : null,
    answer: null,
    sourcePages: [pageNumber],
    sourcePdfPath: pdfPath,
    backendSource: 'docai',
    rawBlocks: [text],
  };
}
