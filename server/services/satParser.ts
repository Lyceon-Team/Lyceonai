/**
 * SAT Question Parser for Ingestion v2
 * Parses OCR results into structured questions with bbox tracking and questionHash
 */

import crypto from 'crypto';
import type { OcrResult, OcrBlock } from './ocrOrchestrator';
import { 
  QuestionDoc, 
  generateCanonicalId, 
  sectionToCode, 
  normalizeAnswerChoice 
} from './questionTypes';

export interface ParsedQuestion {
  questionId: string; // Temporary ID for this parse session
  questionHash: string; // Normalized hash for deduplication
  stem: string;
  options: Array<{ key: string; text: string; bbox?: number[] }>;
  answer: string;
  explanation?: string;
  explanationPresent: boolean; // Explicit flag for explanation availability
  section?: string;
  difficulty?: 'easy' | 'medium' | 'hard'; // Detected difficulty level
  confidence: number; // 0.0 - 1.0
  needsReview: boolean; // true if confidence < 0.8
  pageNumber: number;
  bbox?: number[]; // Bounding box of entire question
  exam?: string; // STEP 1: Added for QA validation - exam identifier (e.g., "SAT")
  testCode?: string; // STEP 1: Added for QA validation - test code (e.g., "SAT")
  sectionCode?: string; // STEP 1: Added for QA validation - section code (e.g., "M", "RW")
  parsingMetadata: {
    anchorsDetected: string[];
    patternMatches: Record<string, boolean>;
    warnings: string[];
    originalText?: string;
    ocrEngine: string;
    ocrConfidence: number;
    mathPatterns?: string[]; // SAT math-specific patterns detected
    difficultyIndicators?: string[]; // Patterns that influenced difficulty
  };
}

interface ParserConfig {
  minConfidenceThreshold: number;
  strictMode: boolean;
  enableLogging: boolean;
}

export class SatParser {
  private config: ParserConfig;

  // Question ID patterns
  private readonly ID_PATTERNS = [
    /Question\s+ID\s*[:\-]?\s*([a-fA-F0-9]+)/i,
    /ID\s*[:\-]?\s*([a-fA-F0-9]+)/i,
    /^\s*([a-fA-F0-9]{8,})\s*$/m, // Standalone hex ID
  ];

  // Question number patterns - enhanced for SAT format
  private readonly QUESTION_NUMBER_PATTERNS = [
    /^\s*(\d+)\.\s+/m, // "1. " (most common)
    /^Question\s+(\d+)/mi, // "Question 1"
    /^Q(\d+)/mi, // "Q1"
    /^\s*(\d+)\s*$/m, // Standalone question number on a line
    /^\s*\[(\d+)\]/m, // "[1]"
    /^#(\d+)/m, // "#1"
    /^Module\s+\d+[,:]\s*Question\s+(\d+)/mi, // "Module 2, Question 1"
  ];

  // Option patterns (A-D or A-E) - enhanced for various formats
  private readonly OPTION_PATTERNS = [
    // Standard formats
    /^([A-E])[\.\)]\s+([\s\S]+?)(?=^\s*[A-E][\.\)]|\n\n|$)/m,
    /^\(([A-E])\)\s+([\s\S]+?)(?=^\s*\([A-E]\)|\n\n|$)/m,
    /^Choice\s+([A-E]):\s+([\s\S]+?)(?=^Choice\s+[A-E]:|\n\n|$)/mi,
    // SAT-specific with circled letters
    /^([A-E])\s+([\s\S]+?)(?=^\s*[A-E]\s|\n\n|$)/m,
    // Math options often have equations - capture full expressions
    /^([A-E])[:\.\)]\s*([-+]?\d*\.?\d*\s*[xyzn][\s\S]*?)(?=^\s*[A-E][:\.\)]|\n\n|$)/m,
    // Options that start with math expressions
    /^([A-E])[:\.\)]\s*([√πθ∞±×÷=<>≤≥≠][\s\S]*?)(?=^\s*[A-E][:\.\)]|\n\n|$)/m,
  ];

  // Answer patterns
  private readonly ANSWER_PATTERNS = [
    /Correct\s+Answer:\s*([A-E])/i,
    /Answer:\s*([A-E])/i,
    /Key:\s*([A-E])/i,
    /^\s*([A-E])\s*$/m, // Standalone letter
  ];

  // Explanation patterns - enhanced for SAT format
  private readonly EXPLANATION_PATTERNS = [
    /Rationale:\s*([\s\S]+?)(?=Question\s+(?:ID|Number|\d+)|$)/i,
    /Explanation:\s*([\s\S]+?)(?=Question\s+(?:ID|Number|\d+)|$)/i,
    /Reasoning:\s*([\s\S]+?)(?=Question\s+(?:ID|Number|\d+)|$)/i,
    /Solution:\s*([\s\S]+?)(?=Question\s+(?:ID|Number|\d+)|$)/i,
    /Why\s+(?:this|the)\s+answer[:\s]*([\s\S]+?)(?=Question\s+(?:ID|Number|\d+)|$)/i,
    /Choice\s+[A-E]\s+is\s+correct\s+because\s*([\s\S]+?)(?=Question\s+(?:ID|Number|\d+)|$)/i,
    /The\s+correct\s+answer\s+is\s+[A-E]\.\s*([\s\S]+?)(?=Question\s+(?:ID|Number|\d+)|$)/i,
    /Answer\s+Explanation:\s*([\s\S]+?)(?=Question\s+(?:ID|Number|\d+)|$)/i,
  ];

  // SAT math-specific patterns for detecting difficulty
  private readonly MATH_DIFFICULTY_PATTERNS = {
    easy: [
      /basic|simple|straightforward/i,
      /add|subtract|multiply|divide/i,
      /^[^a-z]*\d+\s*[+\-×÷]\s*\d+/i, // Simple arithmetic
    ],
    medium: [
      /equation|solve\s+for/i,
      /linear|quadratic/i,
      /ratio|proportion|percent/i,
    ],
    hard: [
      /complex|advanced/i,
      /system\s+of\s+equations/i,
      /exponential|logarithm/i,
      /trigonometr/i,
      /polynomial.*degree\s*[3-9]/i,
    ],
  };

  constructor(config?: Partial<ParserConfig>) {
    this.config = {
      minConfidenceThreshold: config?.minConfidenceThreshold ?? 0.6,
      strictMode: config?.strictMode ?? false,
      enableLogging: config?.enableLogging ?? (process.env.NODE_ENV === 'development'),
    };
  }

  /**
   * Generate questionHash for deduplication
   * Normalizes question text and creates SHA-256 hash
   */
  private generateQuestionHash(stem: string, options: Array<{ key: string; text: string }>): string {
    // Normalize text: lowercase, trim, remove extra whitespace, remove punctuation
    const normalizeStem = stem
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.,;:!?'"()]/g, '')
      .replace(/\u2019/g, "'"); // Normalize curly quotes

    const normalizeOptions = options
      .map(opt => opt.text.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,;:!?'"()]/g, ''))
      .sort() // Sort for consistency
      .join('|');

    const combined = `${normalizeStem}||${normalizeOptions}`;
    return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
  }

  /**
   * Split text into question blocks
   */
  private splitIntoQuestionBlocks(text: string): string[] {
    // Try splitting by question numbers first
    const questionBlocks: string[] = [];
    const lines = text.split('\n');
    let currentBlock = '';
    let inQuestion = false;

    for (const line of lines) {
      // Check if line starts a new question
      const isQuestionStart = this.QUESTION_NUMBER_PATTERNS.some(pattern => pattern.test(line));

      if (isQuestionStart && currentBlock.length > 50) {
        // Save previous block
        questionBlocks.push(currentBlock.trim());
        currentBlock = line;
        inQuestion = true;
      } else {
        currentBlock += '\n' + line;
      }
    }

    // Add last block
    if (currentBlock.trim().length > 50) {
      questionBlocks.push(currentBlock.trim());
    }

    return questionBlocks.length > 0 ? questionBlocks : [text];
  }

  /**
   * Extract options from question text with bbox tracking
   */
  private extractOptions(text: string, blocks: OcrBlock[]): Array<{ key: string; text: string; bbox?: number[] }> {
    const options: Array<{ key: string; text: string; bbox?: number[] }> = [];

    for (const pattern of this.OPTION_PATTERNS) {
      const regex = new RegExp(pattern.source, 'gm');
      let match;

      while ((match = regex.exec(text)) !== null) {
        const key = match[1];
        const optionText = match[2].trim();

        // Try to find bbox from OCR blocks
        const optionBlock = blocks.find(b => b.text.includes(optionText.substring(0, 30)));

        options.push({
          key,
          text: optionText,
          bbox: optionBlock?.bbox,
        });
      }
    }

    // Sort by key (A, B, C, D, E)
    return options.sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Extract answer key
   */
  private extractAnswer(text: string): string | null {
    for (const pattern of this.ANSWER_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return match[1].toUpperCase();
      }
    }
    return null;
  }

  /**
   * Extract explanation
   */
  private extractExplanation(text: string): string | null {
    for (const pattern of this.EXPLANATION_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    return null;
  }

  /**
   * Detect question section (Math vs Reading) based on content
   */
  private detectSection(fullText: string, stem: string): string {
    const combinedText = `${fullText} ${stem}`.toLowerCase();
    
    // Math indicators
    const mathPatterns = [
      /\d+\s*[+\-×÷=<>]/,  // Math operators with numbers
      /\bequation\b/i,
      /\bfunction\b/i,
      /\bgraph\b/i,
      /\bsolve\b/i,
      /\bcalculate\b/i,
      /\bperimeter\b/i,
      /\barea\b/i,
      /\bvolume\b/i,
      /\bangle\b/i,
      /\bslope\b/i,
      /\bvariable\b/i,
      /\bx\s*=\s*\d/,  // Variable equations
      /\b[xy]\^?\d/,  // Variables with powers
      /fraction|denominator|numerator/i,
    ];
    
    const mathScore = mathPatterns.filter(pattern => pattern.test(combinedText)).length;
    
    // If we detect 2+ math indicators, it's likely a Math question
    return mathScore >= 2 ? 'Math' : 'Reading';
  }

  /**
   * Detect difficulty level based on SAT math patterns
   */
  private detectDifficulty(text: string, section: string): { difficulty: 'easy' | 'medium' | 'hard'; indicators: string[] } {
    const lowerText = text.toLowerCase();
    const indicators: string[] = [];

    // Count matches for each difficulty level
    let easyScore = 0;
    let mediumScore = 0;
    let hardScore = 0;

    for (const pattern of this.MATH_DIFFICULTY_PATTERNS.easy) {
      if (pattern.test(lowerText)) {
        easyScore++;
        indicators.push(`easy:${pattern.source.substring(0, 20)}`);
      }
    }

    for (const pattern of this.MATH_DIFFICULTY_PATTERNS.medium) {
      if (pattern.test(lowerText)) {
        mediumScore++;
        indicators.push(`medium:${pattern.source.substring(0, 20)}`);
      }
    }

    for (const pattern of this.MATH_DIFFICULTY_PATTERNS.hard) {
      if (pattern.test(lowerText)) {
        hardScore++;
        indicators.push(`hard:${pattern.source.substring(0, 20)}`);
      }
    }

    // Additional heuristics for SAT
    // Longer stems with complex vocabulary often indicate harder questions
    const wordCount = text.split(/\s+/).length;
    if (wordCount > 100) {
      hardScore++;
      indicators.push('word_count>100');
    } else if (wordCount < 40) {
      easyScore++;
      indicators.push('word_count<40');
    }

    // Multiple equations or expressions indicate harder questions
    const equationCount = (text.match(/[=<>≤≥]/g) || []).length;
    if (equationCount >= 3) {
      hardScore++;
      indicators.push(`equations:${equationCount}`);
    }

    // Reading comprehension length indicators
    if (section === 'Reading') {
      if (wordCount > 150) {
        hardScore++;
        indicators.push('reading_length>150');
      } else if (wordCount < 80) {
        easyScore++;
        indicators.push('reading_length<80');
      }
    }

    // Determine final difficulty
    if (hardScore > mediumScore && hardScore >= easyScore) {
      return { difficulty: 'hard', indicators };
    } else if (mediumScore >= easyScore) {
      return { difficulty: 'medium', indicators };
    } else {
      return { difficulty: 'easy', indicators };
    }
  }

  /**
   * Calculate confidence score based on parsing quality
   */
  private calculateConfidence(question: Partial<ParsedQuestion>, ocrConfidence: number): number {
    let confidence = ocrConfidence;

    // Deduct for missing components
    if (!question.stem || question.stem.length < 10) confidence -= 0.3;
    if (!question.options || question.options.length < 3) confidence -= 0.2;
    if (!question.answer) confidence -= 0.2;
    if (!question.explanation) confidence -= 0.1;

    // Deduct for inconsistencies
    if (question.answer && question.options) {
      const hasMatchingOption = question.options.some(opt => opt.key === question.answer);
      if (!hasMatchingOption) confidence -= 0.3;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Parse a single question block
   */
  private parseQuestionBlock(
    text: string,
    blocks: OcrBlock[],
    ocrEngine: string,
    ocrConfidence: number,
    pageNumber: number
  ): ParsedQuestion | null {
    const warnings: string[] = [];
    const anchorsDetected: string[] = [];
    const patternMatches: Record<string, boolean> = {};

    // Extract question ID or number
    let questionId = '';
    for (const pattern of this.ID_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        questionId = match[1];
        anchorsDetected.push('id');
        break;
      }
    }

    for (const pattern of this.QUESTION_NUMBER_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        questionId = questionId || `q${match[1]}`;
        anchorsDetected.push('number');
        break;
      }
    }

    if (!questionId) {
      questionId = `q${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      warnings.push('No question ID/number found, generated temporary ID');
    }

    // Extract stem (text before first option)
    const firstOptionMatch = text.match(/^([A-E])[\.\)]/m);
    const stemEndIndex = firstOptionMatch ? text.indexOf(firstOptionMatch[0]) : text.length / 2;
    const stem = text.substring(0, stemEndIndex).trim();

    if (stem.length < 10) {
      warnings.push('Stem too short');
      return null; // Skip invalid questions
    }

    // Extract options
    const options = this.extractOptions(text, blocks);
    patternMatches['hasOptions'] = options.length >= 3;

    if (options.length < 3) {
      warnings.push(`Only ${options.length} options found (need at least 3)`);
      return null;
    }

    // Extract answer
    const answer = this.extractAnswer(text);
    patternMatches['hasAnswer'] = !!answer;

    if (!answer) {
      warnings.push('No answer key found');
    }

    // Extract explanation
    const explanation = this.extractExplanation(text);
    const explanationPresent = !!explanation;
    patternMatches['hasExplanation'] = explanationPresent;

    // Generate questionHash
    const questionHash = this.generateQuestionHash(stem, options);

    // Find overall bbox (combine all blocks)
    const questionBlocks = blocks.filter(b => text.includes(b.text.substring(0, 20)));
    let bbox: number[] | undefined;
    if (questionBlocks.length > 0) {
      const minX = Math.min(...questionBlocks.map(b => b.bbox[0]));
      const minY = Math.min(...questionBlocks.map(b => b.bbox[1]));
      const maxX = Math.max(...questionBlocks.map(b => b.bbox[0] + b.bbox[2]));
      const maxY = Math.max(...questionBlocks.map(b => b.bbox[1] + b.bbox[3]));
      bbox = [minX, minY, maxX - minX, maxY - minY];
    }

    // Detect section (Math vs Reading) based on content
    const section = this.detectSection(text, stem);

    // Detect difficulty level
    const { difficulty, indicators: difficultyIndicators } = this.detectDifficulty(text, section);

    // Calculate confidence
    const tempQuestion: Partial<ParsedQuestion> = { stem, options, answer: answer || '', explanation: explanation || undefined };
    const confidence = this.calculateConfidence(tempQuestion, ocrConfidence);

    return {
      questionId,
      questionHash,
      stem,
      options,
      answer: answer || '',
      explanation: explanation || undefined,
      explanationPresent,
      section,
      difficulty,
      confidence,
      needsReview: confidence < 0.8,
      pageNumber,
      bbox,
      parsingMetadata: {
        anchorsDetected,
        patternMatches,
        warnings,
        originalText: text.substring(0, 500),
        ocrEngine,
        ocrConfidence,
        difficultyIndicators,
      },
    };
  }

  /**
   * Main parse method
   */
  parse(ocrResults: OcrResult[]): ParsedQuestion[] {
    console.log(`📝 [PARSE] Starting SAT question parsing for ${ocrResults.length} pages`);

    const allQuestions: ParsedQuestion[] = [];

    for (const ocrPage of ocrResults) {
      const questionBlocks = this.splitIntoQuestionBlocks(ocrPage.text);
      this.log(`[PARSE] Page ${ocrPage.page}: Found ${questionBlocks.length} potential questions`);

      for (const block of questionBlocks) {
        const question = this.parseQuestionBlock(
          block,
          ocrPage.blocks,
          ocrPage.engine,
          ocrPage.confidence,
          ocrPage.page
        );

        if (question) {
          allQuestions.push(question);
        }
      }
    }

    console.log(`✅ [PARSE] Parsed ${allQuestions.length} questions, ${allQuestions.filter(q => q.needsReview).length} need review`);
    return allQuestions;
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(message);
    }
  }
}

/**
 * Convert ParsedQuestion to QuestionDoc
 * Maps legacy parsed questions to PRP-compliant QuestionDoc format
 */
export function toQuestionDoc(
  parsed: ParsedQuestion,
  options?: {
    testCode?: string;
    sourcePdf?: string;
    ingestionRunId?: string;
  }
): QuestionDoc {
  const testCode = options?.testCode || 'SAT';
  const sectionCode = sectionToCode(parsed.section);
  const sourceType = 1 as const; // PDF source
  
  // Use questionHash as unique suffix to ensure stable canonical IDs
  const uniqueSuffix = parsed.questionHash ? parsed.questionHash.substring(0, 6).toUpperCase() : undefined;
  
  const canonicalId = generateCanonicalId({
    testCode,
    sectionCode,
    sourceType,
    uniqueSuffix,
  });
  
  // Extract tags from parsing metadata if available
  const tags: string[] = [];
  if (parsed.difficulty) tags.push(`difficulty:${parsed.difficulty}`);
  if (parsed.section) tags.push(`section:${parsed.section}`);
  if (parsed.parsingMetadata.mathPatterns) {
    parsed.parsingMetadata.mathPatterns.forEach(p => tags.push(`math:${p}`));
  }
  
  // Map difficulty indicators to competency codes (placeholder for future AI classification)
  const competencies: Array<{ code: string; raw?: string | null }> = [];
  if (parsed.parsingMetadata.difficultyIndicators) {
    parsed.parsingMetadata.difficultyIndicators.forEach(indicator => {
      // Parse difficulty indicator format like "medium:equation|solve\\s+for"
      const [level, pattern] = indicator.split(':');
      if (pattern) {
        competencies.push({ code: `${sectionCode}_${level.toUpperCase()}`, raw: pattern });
      }
    });
  }
  
  return {
    canonicalId,
    testCode,
    sectionCode,
    sourceType,
    stem: parsed.stem,
    options: parsed.options.map(o => ({ key: o.key, text: o.text })),
    answerChoice: normalizeAnswerChoice(parsed.answer),
    explanation: parsed.explanation || null,
    competencies,
    difficulty: parsed.difficulty || null,
    tags,
    sourcePdf: options?.sourcePdf || null,
    pageNumber: parsed.pageNumber,
    ingestionRunId: options?.ingestionRunId || null,
    questionHash: parsed.questionHash,
    engineUsed: parsed.parsingMetadata.ocrEngine,
    engineConfidence: parsed.parsingMetadata.ocrConfidence,
    version: 1,
    section: parsed.section, // Keep legacy section for backward compatibility
  };
}

/**
 * Batch convert ParsedQuestions to QuestionDocs
 */
export function toQuestionDocs(
  parsedQuestions: ParsedQuestion[],
  options?: {
    testCode?: string;
    sourcePdf?: string;
    ingestionRunId?: string;
  }
): QuestionDoc[] {
  return parsedQuestions.map(q => toQuestionDoc(q, options));
}

/**
 * Convert QuestionDoc to ParsedQuestion
 * Maps Vision-extracted QuestionDocs to ParsedQuestion format for QA validation
 */
export function questionDocToParsedQuestion(doc: QuestionDoc): ParsedQuestion {
  const section = doc.sectionCode === 'M' ? 'Math' : 'Reading and Writing';
  
  return {
    questionId: doc.canonicalId,
    stem: doc.stem,
    options: doc.options.map(o => ({
      key: o.key,
      text: o.text,
      bbox: [],
    })),
    answer: doc.answerChoice || '',
    explanation: doc.explanation || undefined,
    explanationPresent: !!doc.explanation,
    pageNumber: doc.pageNumber || 1,
    questionHash: doc.questionHash || doc.canonicalId,
    section,
    sectionCode: doc.sectionCode,
    exam: doc.testCode,
    testCode: doc.testCode,
    difficulty: doc.difficulty as 'easy' | 'medium' | 'hard' | undefined,
    confidence: doc.engineConfidence || 0.85,
    needsReview: false,
    parsingMetadata: {
      originalText: doc.stem,
      ocrEngine: doc.engineUsed || 'vision',
      ocrConfidence: doc.engineConfidence || 0.85,
      mathPatterns: [],
      difficultyIndicators: doc.difficulty ? [`${doc.difficulty}:vision-extracted`] : [],
      anchorsDetected: [],
      patternMatches: {},
      warnings: [],
    },
  };
}

/**
 * Batch convert QuestionDocs to ParsedQuestions
 */
export function questionDocsToParsedQuestions(docs: QuestionDoc[]): ParsedQuestion[] {
  return docs.map(doc => questionDocToParsedQuestion(doc));
}

// Export singleton
let parserInstance: SatParser | null = null;

export function getSatParser(config?: Partial<ParserConfig>): SatParser {
  if (!parserInstance) {
    parserInstance = new SatParser(config);
  }
  return parserInstance;
}
