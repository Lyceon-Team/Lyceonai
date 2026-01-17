/**
 * Robust SAT Question Parser with Confidence Scoring
 * Implements multi-anchor pattern matching, validation, and admin review capabilities
 */

export interface ParserConfig {
  minConfidenceThreshold: number;  // Default: 0.6
  strictMode: boolean;              // Default: false (allows partial parses)
  enableLogging: boolean;           // Default: true in dev, false in prod
}

export interface ParsedQuestion {
  questionId: string;
  stem: string;
  options: Array<{ key: string; text: string }>;
  answer: string;
  explanation?: string;
  section?: string;
  difficulty?: string;
  confidence: number;              // 0.0 - 1.0
  needsReview: boolean;            // true if confidence < 0.8
  parsingMetadata: {
    anchorsDetected: string[];
    patternMatches: Record<string, boolean>;
    warnings: string[];
    originalText?: string;
  };
}

export class RobustSATParser {
  private config: ParserConfig;
  
  // Multiple anchor patterns for question ID detection
  private readonly ID_PATTERNS = [
    /Question\s+ID\s+([a-fA-F0-9]+)/i,
    /ID:\s*([a-fA-F0-9]+)/i,
    /Question\s*:\s*([a-fA-F0-9]+)/i,
    /^\s*([a-fA-F0-9]{8,})\s*$/m, // Standalone hex ID
  ];

  // Option format patterns
  private readonly OPTION_PATTERNS = [
    /^([A-D])[\.\)]\s+([\s\S]+?)(?=^\s*[A-D][\.\)]|\n\n|$)/m,    // A) or A. (multi-line)
    /^\(([A-D])\)\s+([\s\S]+?)(?=^\s*\([A-D]\)|\n\n|$)/m,       // (A) (multi-line)
    /^Choice\s+([A-D]):\s+([\s\S]+?)(?=^Choice\s+[A-D]:|\n\n|$)/mi, // Choice A: (multi-line)
  ];

  // Answer patterns
  private readonly ANSWER_PATTERNS = [
    /Correct\s+Answer:\s*([A-D])/i,
    /Answer:\s*([A-D])/i,
    /Key:\s*([A-D])/i,
    /^\s*([A-D])\s*$/m, // Standalone letter
  ];

  // Explanation patterns
  private readonly EXPLANATION_PATTERNS = [
    /Rationale:\s*([\s\S]+?)(?=Question\s+ID|ID:|$)/i,
    /Explanation:\s*([\s\S]+?)(?=Question\s+ID|ID:|$)/i,
    /Reasoning:\s*([\s\S]+?)(?=Question\s+ID|ID:|$)/i,
  ];

  constructor(config?: Partial<ParserConfig>) {
    this.config = {
      minConfidenceThreshold: config?.minConfidenceThreshold ?? 0.6,
      strictMode: config?.strictMode ?? false,
      enableLogging: config?.enableLogging ?? (process.env.NODE_ENV === 'development'),
    };
  }

  /**
   * Main parsing entry point - never throws, always returns results
   */
  parse(text: string): ParsedQuestion[] {
    try {
      this.log('Starting robust SAT question parsing');
      
      if (!text || text.trim().length === 0) {
        this.log('Empty text provided');
        return [];
      }

      // Split text into question blocks using multi-anchor approach
      const questionBlocks = this.splitIntoQuestionBlocks(text);
      this.log(`Found ${questionBlocks.length} potential question blocks`);

      const results: ParsedQuestion[] = [];

      for (const block of questionBlocks) {
        try {
          const parsed = this.parseQuestionBlock(block);
          if (parsed) {
            // Filter by confidence threshold
            if (parsed.confidence >= this.config.minConfidenceThreshold) {
              results.push(parsed);
            } else {
              this.log(`Rejected question ${parsed.questionId} - confidence ${parsed.confidence} below threshold ${this.config.minConfidenceThreshold}`);
            }
          }
        } catch (error) {
          this.log(`Error parsing question block: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Continue processing other blocks
        }
      }

      this.log(`Successfully parsed ${results.length} questions`);
      return results;

    } catch (error) {
      this.log(`Fatal parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return []; // Never throw, return empty array
    }
  }

  /**
   * Split text into question blocks using multi-anchor detection
   */
  private splitIntoQuestionBlocks(text: string): Array<{ id: string; content: string; originalText: string }> {
    const blocks: Array<{ id: string; content: string; originalText: string }> = [];

    // Try each ID pattern
    for (const pattern of this.ID_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'));
      
      const matchArray = Array.from(matches);
      if (matchArray.length > 0) {
        this.log(`Using ID pattern: ${pattern.source} - found ${matchArray.length} matches`);
        
        // Split by this pattern
        const parts = text.split(pattern);
        
        // Parts array structure: [prelude, id1, content1, id2, content2, ...]
        for (let i = 1; i < parts.length; i += 2) {
          if (i + 1 < parts.length) {
            const id = parts[i].trim();
            const content = parts[i + 1];
            
            blocks.push({
              id,
              content,
              originalText: `${pattern.source.includes('Question') ? 'Question ID ' : 'ID: '}${id}${content.substring(0, 500)}`
            });
          }
        }
        
        // If we found blocks with this pattern, use them
        if (blocks.length > 0) {
          return blocks;
        }
      }
    }

    this.log('No question ID patterns matched');
    return blocks;
  }

  /**
   * Parse a single question block with confidence scoring
   */
  private parseQuestionBlock(block: { id: string; content: string; originalText: string }): ParsedQuestion | null {
    const metadata: ParsedQuestion['parsingMetadata'] = {
      anchorsDetected: [],
      patternMatches: {},
      warnings: [],
      originalText: block.originalText,
    };

    let confidenceScore = 0;
    const confidenceFactors: Record<string, number> = {
      hasId: 0.2,
      hasStem: 0.2,
      hasOptions: 0.2,
      hasAnswer: 0.2,
      hasExplanation: 0.1,
      hasMetadata: 0.1,
    };

    // Extract Question ID
    const questionId = block.id;
    if (questionId && questionId.length >= 6) {
      confidenceScore += confidenceFactors.hasId;
      metadata.anchorsDetected.push('questionId');
      metadata.patternMatches['questionId'] = true;
    } else {
      metadata.warnings.push('Question ID missing or invalid');
      return null; // Reject without ID
    }

    // Extract stem
    const stem = this.extractStem(block.content);
    if (stem && stem.length >= 10) {
      confidenceScore += confidenceFactors.hasStem;
      metadata.patternMatches['stem'] = true;
    } else {
      metadata.warnings.push('Stem missing or too short');
    }

    // Extract options
    const options = this.extractOptions(block.content);
    if (options.length >= 2) {
      confidenceScore += confidenceFactors.hasOptions;
      metadata.patternMatches['options'] = true;
      metadata.anchorsDetected.push('options');
    } else {
      metadata.warnings.push('Insufficient options found');
    }

    // Extract answer
    const answer = this.extractAnswer(block.content);
    if (answer) {
      confidenceScore += confidenceFactors.hasAnswer;
      metadata.patternMatches['answer'] = true;
      metadata.anchorsDetected.push('answer');
    } else {
      metadata.warnings.push('Answer not found');
    }

    // Extract explanation (optional)
    const explanation = this.extractExplanation(block.content);
    if (explanation) {
      confidenceScore += confidenceFactors.hasExplanation;
      metadata.patternMatches['explanation'] = true;
    }

    // Extract metadata (section, difficulty)
    const { section, difficulty } = this.extractMetadata(block.content);
    if (section || difficulty) {
      confidenceScore += confidenceFactors.hasMetadata;
      metadata.patternMatches['metadata'] = true;
    }

    // Validate minimum required fields
    if (!stem || !questionId) {
      this.log(`Question ${questionId} rejected - missing required fields`);
      return null;
    }

    // In strict mode, require options and answer
    if (this.config.strictMode && (options.length === 0 || !answer)) {
      this.log(`Question ${questionId} rejected in strict mode - missing options or answer`);
      return null;
    }

    const needsReview = confidenceScore < 0.8;

    return {
      questionId,
      stem,
      options,
      answer: answer || '',
      explanation,
      section,
      difficulty,
      confidence: confidenceScore,
      needsReview,
      parsingMetadata: metadata,
    };
  }

  /**
   * Extract question stem
   */
  private extractStem(content: string): string {
    // Normalize content
    const normalized = content
      .replace(/\r/g, '')
      .replace(/[\t ]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim();

    // Remove metadata headers
    const cleaned = normalized
      .replace(/^(?:Assessment|Test|Domain|Skill).*$/gmi, '')
      .replace(/^Standard\s+ID.*$/gmi, '')
      .replace(/^Difficulty.*$/gmi, '')
      .trim();

    // Extract stem up to first option or boundary marker
    const stemMatch = cleaned.match(/^[\s\S]*?(?=\s*(?:[A-D][\.\)]\s|Correct\s*Answer|Answer:|Rationale:|Explanation:|Choice\s+[A-D]|$))/i);
    
    if (stemMatch) {
      return stemMatch[0]
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^ID:\s*[a-f0-9]+\s*/i, ''); // Remove any lingering ID prefix
    }

    return '';
  }

  /**
   * Extract options using multiple patterns
   */
  private extractOptions(content: string): Array<{ key: string; text: string }> {
    const options: Array<{ key: string; text: string }> = [];
    const seenKeys = new Set<string>();

    // Try each option pattern
    for (const pattern of this.OPTION_PATTERNS) {
      try {
        // Create global version of pattern for matchAll
        const globalPattern = pattern.flags.includes('g') 
          ? pattern 
          : new RegExp(pattern.source, pattern.flags + 'g');
        
        const matches = Array.from(content.matchAll(globalPattern));
        
        for (const match of matches) {
          const key = match[1].toUpperCase();
          const text = match[2]?.trim();
          
          if (text && text.length > 0 && !seenKeys.has(key)) {
            options.push({ key, text });
            seenKeys.add(key);
          }
        }

        // If we found options with this pattern, use them
        if (options.length >= 2) {
          return options.sort((a, b) => a.key.localeCompare(b.key));
        }
      } catch (error) {
        this.log(`Error with option pattern: ${error instanceof Error ? error.message : 'Unknown error'}`);
        continue;
      }
    }

    return options.sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Extract correct answer
   */
  private extractAnswer(content: string): string | null {
    for (const pattern of this.ANSWER_PATTERNS) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1].toUpperCase();
      }
    }
    return null;
  }

  /**
   * Extract explanation/rationale
   */
  private extractExplanation(content: string): string | undefined {
    for (const pattern of this.EXPLANATION_PATTERNS) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1].trim().replace(/\s+/g, ' ').substring(0, 2000); // Limit length
      }
    }
    return undefined;
  }

  /**
   * Extract metadata (section, difficulty)
   */
  private extractMetadata(content: string): { section?: string; difficulty?: string } {
    const metadata: { section?: string; difficulty?: string } = {};

    // Extract section
    const sectionMatch = content.match(/(?:Test|Section):\s*(Math|Reading|Writing|Reading\s+and\s+Writing)/i);
    if (sectionMatch) {
      metadata.section = sectionMatch[1];
    }

    // Extract difficulty
    const difficultyMatch = content.match(/Difficulty.*?:\s*(Easy|Medium|Hard)/i);
    if (difficultyMatch) {
      metadata.difficulty = difficultyMatch[1];
    }

    return metadata;
  }

  /**
   * Conditional logging based on config
   */
  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[RobustSATParser] ${message}`);
    }
  }
}
