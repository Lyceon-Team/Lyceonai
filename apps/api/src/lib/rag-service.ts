/**
 * RAG v2 Service
 * Implements the RAG Retrieval v2 system
 * per PRP — RAG Retrieval v2 specifications
 */

import { generateEmbedding } from './embeddings';
import { matchSimilar, MatchResult } from './vector';
import { supabaseServer } from './supabase-server';
import { buildCompetencyMapFromMasteryRows, MasterySkillRow } from '../services/mastery-derived';
import {
  RagMode,
  RagContext,
  RagQueryRequest,
  RagQueryResponse,
  StudentProfile,
  QuestionContext,
  CompetencyContext,
  Competency,
} from './rag-types';

// Re-export MatchResult for tests
export type { MatchResult } from './vector';

/**
 * Scored vector match with combined weighted score
 */
export interface ScoredMatch extends MatchResult {
  combinedScore: number;
  scoreBreakdown: {
    semanticSim: number;
    competencyMatch: number;
    difficultyMatch: number;
    weaknessBoost: number;
    recencyScore: number;
    qualityBonus?: number; // STEP 3: Bonus for questions with richer metadata
  };
}

/**
 * Target context for scoring matches
 */
export interface ScoringContext {
  targetCompetencies: string[];
  targetDifficulty: string | null;
  studentWeakAreas: string[];
}

/**
 * Vector client interface for dependency injection (testing)
 */
export interface VectorClient {
  matchSimilar(
    queryEmbedding: number[],
    topK: number,
    section?: "Reading" | "Writing" | "Math",
    exam?: string
  ): Promise<MatchResult[]>;
}

/**
 * Embedding client interface for dependency injection (testing)
 */
export interface EmbeddingClient {
  generateEmbedding(text: string): Promise<number[]>;
}

/**
 * Question repository interface for dependency injection (testing)
 */
export interface QuestionRepository {
  loadById(questionId: string): Promise<QuestionContext | null>;
  loadByCanonicalId(canonicalId: string): Promise<QuestionContext | null>;
}

/**
 * Profile loader interface for dependency injection (testing)
 */
export interface ProfileLoader {
  loadProfile(userId: string): Promise<StudentProfile | null>;
}

/**
 * RagService dependencies (for injection)
 */
export interface RagServiceDependencies {
  vectorClient?: VectorClient;
  embeddingClient?: EmbeddingClient;
  questionRepo?: QuestionRepository;
  profileLoader?: ProfileLoader;
}

export class RagService {
  private defaultTopK = 5;
  
  // Injected dependencies (or use defaults)
  private vectorClient: VectorClient;
  private embeddingClient: EmbeddingClient;
  private questionRepo: QuestionRepository | null;
  private profileLoader: ProfileLoader | null;

  /**
   * PRP Scoring Weights:
   * - 40% semantic similarity
   * - 30% competency match
   * - 10% difficulty match
   * - 10% recency score
   * - 10% weakness boost
   */
  public readonly SCORING_WEIGHTS = {
    semanticSim: 0.4,
    competencyMatch: 0.3,
    difficultyMatch: 0.1,
    recencyScore: 0.1,
    weaknessBoost: 0.1,
  };

  constructor(deps?: RagServiceDependencies) {
    // Use injected dependencies or fall back to real implementations
    this.vectorClient = deps?.vectorClient || {
      matchSimilar: matchSimilar,
    };
    this.embeddingClient = deps?.embeddingClient || {
      generateEmbedding: generateEmbedding,
    };
    this.questionRepo = deps?.questionRepo || null;
    this.profileLoader = deps?.profileLoader || null;
    
    console.log('🔍 [RAG-V2] RagService initialized');
  }

  /**
   * Score a single vector match using PRP weighted formula
   * 
   * Formula: combinedScore = 
   *   0.4 * semanticSim +
   *   0.3 * competencyMatch +
   *   0.1 * difficultyMatch +
   *   0.1 * recencyScore +
   *   0.1 * weaknessBoost
   * 
   * Returns a score between 0 and 1.
   * 
   * Note: recencyScore is currently a stub (= 0) until timestamp metadata
   * is available in the vector store. TODO: Integrate recency when available.
   */
  private scoreMatch(
    match: MatchResult,
    context: ScoringContext
  ): ScoredMatch {
    // Semantic similarity: use the similarity score from vector search (already 0-1)
    // If no similarity score, assume 1 as placeholder
    const semanticSim = match.similarity ?? 1.0;

    // Competency match: fraction of target competencies covered by this match
    const matchCompetencies = this.extractCompetencyCodes(match);
    const competencyMatch = this.computeCompetencyMatch(
      context.targetCompetencies,
      matchCompetencies
    );

    // Difficulty match: 1 if equal, 0.5 if adjacent, 0 otherwise
    const matchDifficulty = this.extractDifficulty(match);
    const difficultyMatch = this.computeDifficultyMatch(
      context.targetDifficulty,
      matchDifficulty
    );

    // Weakness boost: 1 if any match competency is in student weak areas, 0 otherwise
    const weaknessBoost = this.computeWeaknessBoost(
      context.studentWeakAreas,
      matchCompetencies
    );

    // Recency score: stub for now (= 0) until timestamp metadata is available
    // TODO: Implement recency scoring when question timestamps are in vector metadata
    const recencyScore = 0;

    // STEP 3: Quality bonus - prefer questions with richer metadata
    // Small bonus to prefer high-quality questions when similarity is equal
    const qualityBonus = this.computeQualityBonus(match);

    // Compute combined weighted score
    const combinedScore =
      this.SCORING_WEIGHTS.semanticSim * semanticSim +
      this.SCORING_WEIGHTS.competencyMatch * competencyMatch +
      this.SCORING_WEIGHTS.difficultyMatch * difficultyMatch +
      this.SCORING_WEIGHTS.recencyScore * recencyScore +
      this.SCORING_WEIGHTS.weaknessBoost * weaknessBoost +
      qualityBonus;

    return {
      ...match,
      combinedScore,
      scoreBreakdown: {
        semanticSim,
        competencyMatch,
        difficultyMatch,
        weaknessBoost,
        recencyScore,
        qualityBonus,
      },
    };
  }

  /**
   * STEP 3: Compute quality bonus based on metadata completeness
   * Small bonus to prefer questions with richer metadata when similarity is equal
   * Max bonus: 0.15 (keeps similarity dominant)
   */
  private computeQualityBonus(match: MatchResult): number {
    let bonus = 0;
    
    // Bonus for having canonical ID (indicates complete metadata)
    if (match.metadata?.canonicalId) {
      bonus += 0.05;
    }
    
    // Bonus for having competencies (richer metadata)
    if (match.metadata?.competencyCodes && Array.isArray(match.metadata.competencyCodes) && match.metadata.competencyCodes.length > 0) {
      bonus += 0.05;
    }
    
    // Bonus for having difficulty (helps with personalization)
    if (match.metadata?.difficulty) {
      bonus += 0.05;
    }
    
    return bonus;
  }

  /**
   * Extract competency codes from match metadata
   */
  private extractCompetencyCodes(match: MatchResult): string[] {
    if (!match.metadata) return [];
    
    // Check for competencyCodes array in metadata
    if (Array.isArray(match.metadata.competencyCodes)) {
      return match.metadata.competencyCodes;
    }
    
    // Check for competencies array with code property
    if (Array.isArray(match.metadata.competencies)) {
      return match.metadata.competencies
        .filter((c: any) => c && typeof c.code === 'string')
        .map((c: any) => c.code);
    }
    
    return [];
  }

  /**
   * Extract difficulty from match metadata or section info
   */
  private extractDifficulty(match: MatchResult): string | null {
    if (match.metadata?.difficulty) {
      return String(match.metadata.difficulty).toLowerCase();
    }
    return null;
  }

  /**
   * Compute competency match score
   * Returns 0 if no target competencies or no overlap
   * Otherwise returns overlapCount / targetCount
   */
  private computeCompetencyMatch(
    targetCompetencies: string[],
    matchCompetencies: string[]
  ): number {
    if (targetCompetencies.length === 0) return 0;
    if (matchCompetencies.length === 0) return 0;

    const targetSet = new Set(targetCompetencies.map(c => c.toLowerCase()));
    const matchSet = new Set(matchCompetencies.map(c => c.toLowerCase()));

    let overlapCount = 0;
    for (const code of matchSet) {
      if (targetSet.has(code)) {
        overlapCount++;
      }
    }

    return overlapCount / targetCompetencies.length;
  }

  /**
   * Compute difficulty match score
   * 1 if equal, 0.5 if adjacent, 0 otherwise
   */
  private computeDifficultyMatch(
    targetDifficulty: string | null,
    matchDifficulty: string | null
  ): number {
    if (!targetDifficulty || !matchDifficulty) return 0;

    const target = targetDifficulty.toLowerCase();
    const match = matchDifficulty.toLowerCase();

    if (target === match) return 1;

    // Define adjacency: easy <-> medium <-> hard
    const difficultyOrder = ['easy', 'medium', 'hard'];
    const targetIdx = difficultyOrder.indexOf(target);
    const matchIdx = difficultyOrder.indexOf(match);

    if (targetIdx === -1 || matchIdx === -1) return 0;

    // Adjacent if difference is 1
    if (Math.abs(targetIdx - matchIdx) === 1) return 0.5;

    return 0;
  }

  /**
   * Compute weakness boost
   * Returns 1 if any match competency is in student weak areas, 0 otherwise
   */
  private computeWeaknessBoost(
    studentWeakAreas: string[],
    matchCompetencies: string[]
  ): number {
    if (studentWeakAreas.length === 0 || matchCompetencies.length === 0) {
      return 0;
    }

    const weakSet = new Set(studentWeakAreas.map(c => c.toLowerCase()));
    
    for (const code of matchCompetencies) {
      if (weakSet.has(code.toLowerCase())) {
        return 1;
      }
    }

    return 0;
  }

  /**
   * Score and sort matches using weighted PRP formula
   */
  private scoreAndSortMatches(
    matches: MatchResult[],
    context: ScoringContext
  ): ScoredMatch[] {
    const scoredMatches = matches.map(match => this.scoreMatch(match, context));
    
    // Sort by combinedScore descending
    scoredMatches.sort((a, b) => b.combinedScore - a.combinedScore);

    // Log top match scores for debugging
    if (scoredMatches.length > 0) {
      console.log(`📊 [RAG-V2] Top match score breakdown:`, {
        combinedScore: scoredMatches[0].combinedScore.toFixed(3),
        ...scoredMatches[0].scoreBreakdown,
      });
    }

    return scoredMatches;
  }

  /**
   * Build scoring context from primary question and student profile
   * Used in "question" mode when we have a primary question for context
   */
  private buildScoringContext(
    primaryQuestion: QuestionContext | null,
    studentProfile: StudentProfile | null
  ): ScoringContext {
    // Extract target competencies from primary question
    const targetCompetencies: string[] = [];
    if (primaryQuestion?.competencies) {
      for (const comp of primaryQuestion.competencies) {
        if (comp.code) {
          targetCompetencies.push(comp.code);
        }
      }
    }

    // Extract target difficulty from primary question
    const targetDifficulty = primaryQuestion?.difficulty || null;

    // Extract student weak areas from profile
    const studentWeakAreas = this.extractStudentWeakAreas(studentProfile);

    return {
      targetCompetencies,
      targetDifficulty,
      studentWeakAreas,
    };
  }

  /**
   * Build scoring context from request and student profile
   * Used in "concept" mode when we don't have a primary question
   */
  private buildScoringContextFromRequest(
    request: RagQueryRequest,
    studentProfile: StudentProfile | null
  ): ScoringContext {
    // In concept mode, target competencies can be inferred from sectionCode
    const targetCompetencies: string[] = [];
    
    // Add section-based competency hints if available
    if (request.sectionCode) {
      // Add a generic competency based on section
      targetCompetencies.push(`${request.sectionCode}_GENERAL`);
    }

    // No target difficulty in concept mode (open exploration)
    const targetDifficulty: string | null = null;

    // Extract student weak areas from profile
    const studentWeakAreas = this.extractStudentWeakAreas(studentProfile);

    return {
      targetCompetencies,
      targetDifficulty,
      studentWeakAreas,
    };
  }

  /**
   * Extract student weak areas from competency map
   * Weak areas are competencies where incorrect > correct
   */
  private extractStudentWeakAreas(studentProfile: StudentProfile | null): string[] {
    const weakAreas: string[] = [];
    
    if (!studentProfile?.competencyMap) {
      return weakAreas;
    }

    for (const [code, progress] of Object.entries(studentProfile.competencyMap)) {
      const correct = progress.correct ?? 0;
      const incorrect = progress.incorrect ?? 0;
      const total = progress.total ?? (correct + incorrect);
      
      // Only consider competencies with at least 3 attempts
      if (total >= 3 && incorrect > correct) {
        weakAreas.push(code);
      }
    }

    return weakAreas;
  }

  /**
   * Extract student strong areas from competency map
   * Strong areas are competencies where correct > incorrect
   */
  private extractStudentStrongAreas(studentProfile: StudentProfile | null): string[] {
    const strongAreas: string[] = [];
    
    if (!studentProfile?.competencyMap) {
      return strongAreas;
    }

    for (const [code, progress] of Object.entries(studentProfile.competencyMap)) {
      const correct = progress.correct ?? 0;
      const incorrect = progress.incorrect ?? 0;
      const total = progress.total ?? (correct + incorrect);
      
      // Only consider competencies with at least 3 attempts
      if (total >= 3 && correct > incorrect) {
        strongAreas.push(code);
      }
    }

    return strongAreas;
  }

  /**
   * Load student profile from Supabase profiles table (HTTP client)
   * Also derives competency map from canonical student_skill_mastery
   */
  async loadStudentProfile(userId: string): Promise<StudentProfile | null> {
    try {
      // Query profiles table for learning preferences using Supabase HTTP client
      const { data: profileRow, error: profileError } = await supabaseServer
        .from('profiles')
        .select('overall_level, primary_style, secondary_style, explanation_level, competency_map, persona_tags, learning_prefs')
        .eq('id', userId)
        .single();

      if (profileError) {
        // PGRST116 = "No rows found" - that's okay, we'll use defaults
        if (profileError.code !== 'PGRST116') {
          console.warn(`⚠️ [RAG-V2] Profile query error for ${userId}: ${profileError.message} (code: ${profileError.code})`);
        } else {
          console.log(`[RAG-V2] No profile found for ${userId}, using defaults`);
        }
      } else if (profileRow) {
        console.log(`[RAG-V2] Found profile for ${userId}:`, {
          primary_style: profileRow.primary_style,
          overall_level: profileRow.overall_level,
          competency_map: profileRow.competency_map ? 'set' : 'null',
        });
      }

      // Canonical competency map source: student_skill_mastery (derived reader).
      let competencyMap: Record<string, { correct: number; incorrect: number; total: number }> = {};

      try {
        const { data: masteryRows, error: masteryError } = await supabaseServer
          .from('student_skill_mastery')
          .select('section, domain, skill, attempts, correct, mastery_score, updated_at')
          .eq('user_id', userId)
          .gte('attempts', 1);

        if (!masteryError && masteryRows) {
          competencyMap = buildCompetencyMapFromMasteryRows(masteryRows as MasterySkillRow[]);
        }
      } catch (masteryReadError: any) {
        console.warn(`⚠️ [RAG-V2] Failed to load canonical mastery rows for ${userId}: ${masteryReadError.message}`);
        // Continue with empty competency map
      }
      // Merge DB competency_map with calculated one (DB takes precedence if exists)
      if (profileRow?.competency_map && typeof profileRow.competency_map === 'object') {
        competencyMap = { ...competencyMap, ...(profileRow.competency_map as Record<string, any>) };
      }

      const profile: StudentProfile = {
        userId,
        overallLevel: profileRow?.overall_level ?? 3,
        primaryStyle: profileRow?.primary_style ?? 'step-by-step',
        secondaryStyle: profileRow?.secondary_style ?? undefined,
        explanationLevel: profileRow?.explanation_level ?? 2,
        competencyMap,
        recentQuestions: [], // TODO: Load from recent student_question_attempts entries
        personaTags: Array.isArray(profileRow?.persona_tags) ? profileRow.persona_tags : [],
      };

      // Temporary logging (remove after verification)
      console.log('[RAG-V2] Loaded student profile:', {
        userId,
        overallLevel: profile.overallLevel,
        primaryStyle: profile.primaryStyle,
        secondaryStyle: profile.secondaryStyle,
        competencyCount: Object.keys(competencyMap).length,
      });

      return profile;
    } catch (error: any) {
      console.warn(`⚠️ [RAG-V2] Failed to load student profile for ${userId}: ${error.message}`);
      // Return a default profile on error (graceful failure)
      return {
        userId,
        primaryStyle: 'step-by-step',
        explanationLevel: 2,
        overallLevel: 3,
        competencyMap: {},
        recentQuestions: [],
        personaTags: [],
      };
    }
  }

  /**
   * Load a question by canonical ID from the database
   * Uses Supabase HTTP client for reliability
   */
  async loadQuestionByCanonicalId(canonicalId: string): Promise<QuestionContext | null> {
    try {
      const { data: result, error } = await supabaseServer
        .from('questions')
        .select('*')
        .eq('canonical_id', canonicalId)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn(`⚠️ [RAG-V2] Error loading by canonical_id ${canonicalId}:`, error.message);
        return null;
      }

      if (!result) {
        return null;
      }

      return this.supabaseRowToQuestionContext(result);
    } catch (error: any) {
      console.error(`❌ [RAG-V2] Failed to load question ${canonicalId}:`, error.message);
      return null;
    }
  }

  /**
   * Convert database row to QuestionContext
   */
  private dbRowToQuestionContext(row: any): QuestionContext {
    return {
      canonicalId: row.canonicalId || row.id,
      testCode: row.testCode || 'SAT',
      sectionCode: row.sectionCode || this.sectionToCode(row.section),
      sourceType: row.sourceType || 1,
      stem: row.stem,
      options: (row.options as Array<{ key: string; text: string }>) || [],
      answer: row.answerChoice || row.answer || null,
      explanation: row.explanation || null,
      competencies: (row.competencies as Competency[]) || [],
      difficulty: row.difficulty || null,
      tags: (row.tags as string[]) || [],
    };
  }

  /**
   * Map section name to section code
   */
  private sectionToCode(section: string | null): string {
    if (!section) return 'M';
    const s = section.toLowerCase();
    if (s.includes('reading') || s.includes('writing') || s === 'rw') {
      return 'RW';
    }
    return 'M';
  }

  /**
   * Build competency context from student profile and questions
   * Uses the extractStudentWeakAreas and extractStudentStrongAreas helpers
   */
  private buildCompetencyContext(
    studentProfile: StudentProfile | null,
    questions: QuestionContext[]
  ): CompetencyContext {
    const allCompetencyCodes = new Set<string>();

    // Collect all competency codes from questions
    for (const q of questions) {
      for (const comp of q.competencies) {
        allCompetencyCodes.add(comp.code);
      }
    }

    const competencyLabels = Array.from(allCompetencyCodes);
    
    // Use helper methods for consistent weak/strong area extraction
    const studentWeakAreas = this.extractStudentWeakAreas(studentProfile);
    const studentStrongAreas = this.extractStudentStrongAreas(studentProfile);

    return {
      studentWeakAreas,
      studentStrongAreas,
      competencyLabels,
    };
  }

  /**
   * Handle RAG query in "question" mode (PRP-compliant)
   * 1. Load primary question by canonical ID
   * 2. Build filters from request + primary question
   * 3. Vector search with combined query (message + stem)
   * 4. Score and sort matches
   * 5. Load deduplicated supporting questions
   * 6. Build competency context
   */
  private async handleQuestionMode(
    request: RagQueryRequest,
    studentProfile: StudentProfile | null
  ): Promise<RagContext> {
    let primaryQuestion: QuestionContext | null = null;
    const supportingQuestions: QuestionContext[] = [];
    const seenCanonicalIds = new Set<string>();

    // 1. Load primary question if canonical ID provided (graceful failure)
    if (request.canonicalQuestionId) {
      try {
        primaryQuestion = await this.loadQuestionByCanonicalId(request.canonicalQuestionId);
        if (primaryQuestion) {
          seenCanonicalIds.add(primaryQuestion.canonicalId);
        }
      } catch (error: any) {
        console.warn(`⚠️ [RAG-V2] Failed to load primary question: ${error.message}`);
        primaryQuestion = null;
      }
    }

    // 2. Build filters from request OR primary question
    const testCode = request.testCode || primaryQuestion?.testCode || 'SAT';
    const sectionCode = request.sectionCode || primaryQuestion?.sectionCode || 'M';
    const section = sectionCode === 'M' ? 'Math' : 
                    sectionCode === 'RW' ? 'Reading' : undefined;

    // Build scoring context with competencies from primary question
    const scoringContext = this.buildScoringContext(primaryQuestion, studentProfile);

    // 3. Vector search with combined query
    const topK = request.topK || this.defaultTopK;
    const searchTopK = Math.max(12, topK * 2); // At least 2x for filtering

    try {
      // Combine message + primary question stem for richer query
      const queryParts: string[] = [request.message];
      if (primaryQuestion) {
        queryParts.push(primaryQuestion.stem);
        // Include first option text for context
        if (primaryQuestion.options.length > 0) {
          queryParts.push(primaryQuestion.options[0].text);
        }
      }
      const queryText = queryParts.join(' ');

      const queryEmbedding = await this.embeddingClient.generateEmbedding(queryText);
      const rawMatches = await this.vectorClient.matchSimilar(queryEmbedding, searchTopK, section, testCode);

      // 4. Score and sort matches using PRP weighted formula
      const scoredMatches = this.scoreAndSortMatches(rawMatches, scoringContext);

      // 5. Load supporting questions with deduplication
      for (const match of scoredMatches) {
        // Skip if already seen (includes primary question)
        if (seenCanonicalIds.has(match.question_id)) {
          continue;
        }

        try {
          const questionContext = await this.loadQuestionById(match.question_id);
          
          // Skip if no valid canonical ID or load failed
          if (!questionContext || !questionContext.canonicalId) {
            continue;
          }

          // Deduplicate by canonical ID
          if (seenCanonicalIds.has(questionContext.canonicalId)) {
            continue;
          }

          seenCanonicalIds.add(questionContext.canonicalId);
          supportingQuestions.push(questionContext);

          // Stop when we have enough
          if (supportingQuestions.length >= topK) break;
        } catch (error: any) {
          // Skip failed loads gracefully
          continue;
        }
      }
    } catch (error: any) {
      console.warn(`⚠️ [RAG-V2] Question mode vector search failed: ${error.message}`);
    }

    // 6. Build competency context from all questions
    const allQuestions = primaryQuestion 
      ? [primaryQuestion, ...supportingQuestions] 
      : supportingQuestions;

    return {
      primaryQuestion,
      supportingQuestions,
      competencyContext: this.buildCompetencyContext(studentProfile, allQuestions),
      studentProfile,
    };
  }

  /**
   * Handle RAG query in "concept" mode (PRP-compliant)
   * 1. No primary question (null)
   * 2. Use request-level filters (testCode, sectionCode)
   * 3. Embed only user message
   * 4. Score and sort matches
   * 5. Load deduplicated supporting questions
   * 6. Build competency context
   */
  private async handleConceptMode(
    request: RagQueryRequest,
    studentProfile: StudentProfile | null
  ): Promise<RagContext> {
    const supportingQuestions: QuestionContext[] = [];
    const seenCanonicalIds = new Set<string>();
    const topK = request.topK || this.defaultTopK;
    const searchTopK = Math.max(12, topK * 2); // At least 10-12 for filtering

    // Build filters from request
    const testCode = request.testCode || 'SAT';
    const section = request.sectionCode === 'M' ? 'Math' : 
                    request.sectionCode === 'RW' ? 'Reading' : undefined;

    // Build scoring context from request (no primary question)
    const scoringContext = this.buildScoringContextFromRequest(request, studentProfile);

    try {
      // Embed only user message (no primary question in concept mode)
      const queryEmbedding = await this.embeddingClient.generateEmbedding(request.message);
      
      // Vector search with filters
      const rawMatches = await this.vectorClient.matchSimilar(queryEmbedding, searchTopK, section, testCode);

      // Score and sort matches using PRP weighted formula
      const scoredMatches = this.scoreAndSortMatches(rawMatches, scoringContext);

      // Load supporting questions with deduplication
      for (const match of scoredMatches) {
        // Skip if already seen
        if (seenCanonicalIds.has(match.question_id)) {
          continue;
        }

        try {
          const questionContext = await this.loadQuestionById(match.question_id);
          
          // Skip if no valid canonical ID or load failed
          if (!questionContext || !questionContext.canonicalId) {
            continue;
          }

          // Deduplicate by canonical ID
          if (seenCanonicalIds.has(questionContext.canonicalId)) {
            continue;
          }

          seenCanonicalIds.add(questionContext.canonicalId);
          supportingQuestions.push(questionContext);

          // Stop when we have enough
          if (supportingQuestions.length >= topK) break;
        } catch (error: any) {
          // Skip failed loads gracefully
          continue;
        }
      }
    } catch (error: any) {
      console.warn(`⚠️ [RAG-V2] Concept mode vector search failed: ${error.message}`);
    }

    return {
      primaryQuestion: null,
      supportingQuestions,
      competencyContext: this.buildCompetencyContext(studentProfile, supportingQuestions),
      studentProfile,
    };
  }

  /**
   * Handle RAG query in "strategy" mode (PRP-compliant)
   * - No question search (no vector lookups)
   * - primaryQuestion = null
   * - supportingQuestions = []
   * - Empty competency context
   * - Include studentProfile as loaded
   * - Returns metadata { mode: "strategy", canonicalIdsUsed: [] }
   */
  private async handleStrategyMode(
    _request: RagQueryRequest,
    studentProfile: StudentProfile | null
  ): Promise<RagContext> {
    // Strategy mode: no DB or vector lookups
    // Focus is on student profile for strategy guidance
    return {
      primaryQuestion: null,
      supportingQuestions: [],
      competencyContext: {
        studentWeakAreas: [],
        studentStrongAreas: [],
        competencyLabels: [],
      },
      studentProfile,
    };
  }

  /**
   * Load question by ID (handles both canonical ID and regular ID)
   * Uses injected questionRepo if available, otherwise falls back to Supabase HTTP client
   */
  private async loadQuestionById(questionId: string): Promise<QuestionContext | null> {
    // Use injected repository if available (for testing)
    if (this.questionRepo) {
      const result = await this.questionRepo.loadById(questionId);
      if (result) return result;
      return this.questionRepo.loadByCanonicalId(questionId);
    }

    try {
      // Try canonical ID first using Supabase HTTP client with maybeSingle()
      const canonicalQuery = await supabaseServer
        .from('questions')
        .select('*')
        .eq('canonical_id', questionId)
        .limit(1)
        .maybeSingle();

      if (canonicalQuery.error) {
        console.warn(`⚠️ [RAG-V2] Error loading by canonical_id ${questionId}:`, canonicalQuery.error.message);
      }

      // If found by canonical ID, return it
      if (canonicalQuery.data) {
        console.log(`[RAG-V2] Loaded question by canonical_id: ${canonicalQuery.data.canonical_id}`);
        return this.supabaseRowToQuestionContext(canonicalQuery.data);
      }

      // Fall back to regular ID if not found by canonical ID
      const idQuery = await supabaseServer
        .from('questions')
        .select('*')
        .eq('id', questionId)
        .limit(1)
        .maybeSingle();

      if (idQuery.error) {
        console.warn(`⚠️ [RAG-V2] Error loading by id ${questionId}:`, idQuery.error.message);
        return null;
      }

      if (!idQuery.data) {
        console.log(`[RAG-V2] Question not found: ${questionId}`);
        return null;
      }

      console.log(`[RAG-V2] Loaded question by id: ${idQuery.data.id}`);
      return this.supabaseRowToQuestionContext(idQuery.data);
    } catch (error: any) {
      console.error(`❌ [RAG-V2] Failed to load question ${questionId}:`, error.message);
      return null;
    }
  }

  /**
   * Convert Supabase row (snake_case) to QuestionContext
   */
  private supabaseRowToQuestionContext(row: any): QuestionContext {
    const competencies = (row.competencies as Competency[]) || [];

    return {
      canonicalId: row.canonical_id || row.id,
      testCode: row.test_code || 'SAT',
      sectionCode: row.section_code || this.sectionToCode(row.section),
      sourceType: row.source_type || 1,
      stem: row.stem,
      options: (row.options as Array<{ key: string; text: string }>) || [],
      answer: row.answer_choice || row.answer || null,
      explanation: row.explanation || null,
      competencies,
      difficulty: row.difficulty || null,
      tags: (row.tags as string[]) || [],
    };
  }

  // ========== TEST HELPERS ==========
  // These methods expose internal scoring logic for unit testing

  /**
   * Exposed for testing: Score matches with given context
   */
  public testScoreAndSortMatches(
    matches: MatchResult[],
    context: ScoringContext
  ): ScoredMatch[] {
    return this.scoreAndSortMatches(matches, context);
  }

  /**
   * Exposed for testing: Build competency context from profile and questions
   */
  public testBuildCompetencyContext(
    studentProfile: StudentProfile | null,
    questions: QuestionContext[]
  ): CompetencyContext {
    return this.buildCompetencyContext(studentProfile, questions);
  }

  /**
   * Exposed for testing: Extract weak areas from student profile
   */
  public testExtractStudentWeakAreas(studentProfile: StudentProfile | null): string[] {
    return this.extractStudentWeakAreas(studentProfile);
  }

  /**
   * Exposed for testing: Extract strong areas from student profile
   */
  public testExtractStudentStrongAreas(studentProfile: StudentProfile | null): string[] {
    return this.extractStudentStrongAreas(studentProfile);
  }

  /**
   * Exposed for testing: Compute difficulty match score
   */
  public testComputeDifficultyMatch(
    targetDifficulty: string | null,
    matchDifficulty: string | null
  ): number {
    return this.computeDifficultyMatch(targetDifficulty, matchDifficulty);
  }

  /**
   * Exposed for testing: Compute weakness boost
   */
  public testComputeWeaknessBoost(
    studentWeakAreas: string[],
    matchCompetencies: string[]
  ): number {
    return this.computeWeaknessBoost(studentWeakAreas, matchCompetencies);
  }

  /**
   * Exposed for testing: Handle concept mode
   */
  public async testHandleConceptMode(
    request: RagQueryRequest,
    studentProfile: StudentProfile | null
  ): Promise<RagContext> {
    return this.handleConceptMode(request, studentProfile);
  }

  /**
   * Exposed for testing: Handle strategy mode
   */
  public async testHandleStrategyMode(
    request: RagQueryRequest,
    studentProfile: StudentProfile | null
  ): Promise<RagContext> {
    return this.handleStrategyMode(request, studentProfile);
  }

  /**
   * Main RAG query handler
   * Routes to appropriate mode handler based on request
   */
  async handleRagQuery(request: RagQueryRequest): Promise<RagQueryResponse> {
    const startTime = Date.now();
    console.log(`🔍 [RAG-V2] Processing ${request.mode} mode query for user ${request.userId}`);

    // Load or use provided student profile
    const studentProfile = request.studentProfile || 
      await this.loadStudentProfile(request.userId);

    let context: RagContext;

    switch (request.mode) {
      case 'question':
        context = await this.handleQuestionMode(request, studentProfile);
        break;
      case 'concept':
        context = await this.handleConceptMode(request, studentProfile);
        break;
      case 'strategy':
        context = await this.handleStrategyMode(request, studentProfile);
        break;
      default:
        context = await this.handleConceptMode(request, studentProfile);
    }

    // Collect all canonical IDs used
    const canonicalIdsUsed: string[] = [];
    if (context.primaryQuestion) {
      canonicalIdsUsed.push(context.primaryQuestion.canonicalId);
    }
    for (const q of context.supportingQuestions) {
      canonicalIdsUsed.push(q.canonicalId);
    }

    const processingTimeMs = Date.now() - startTime;
    console.log(`✅ [RAG-V2] Query completed in ${processingTimeMs}ms, ${canonicalIdsUsed.length} questions in context`);

    return {
      context,
      metadata: {
        canonicalIdsUsed,
        mode: request.mode,
        processingTimeMs,
      },
    };
  }
}

// Export singleton instance
let ragServiceInstance: RagService | null = null;

export function getRagService(): RagService {
  if (!ragServiceInstance) {
    ragServiceInstance = new RagService();
  }
  return ragServiceInstance;
}



