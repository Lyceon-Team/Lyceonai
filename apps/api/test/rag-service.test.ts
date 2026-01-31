/**
 * RAG v2 Service Unit Tests
 * Tests scoring, competency context, and mode behavior
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RagService,
  ScoringContext,
  ScoredMatch,
  MatchResult,
  VectorClient,
  EmbeddingClient,
  QuestionRepository,
} from '../src/lib/rag-service';
import {
  StudentProfile,
  QuestionContext,
  RagQueryRequest,
} from '../src/lib/rag-types';

// ========== MOCK DATA ==========

const MOCK_QUESTIONS: Record<string, QuestionContext> = {
  'q-lin-1': {
    canonicalId: 'SAT-M-P-LIN001',
    testCode: 'SAT',
    sectionCode: 'M',
    sourceType: 1,
    stem: 'Solve for x in the equation 2x + 5 = 15',
    options: [
      { key: 'A', text: '5' },
      { key: 'B', text: '10' },
      { key: 'C', text: '7.5' },
      { key: 'D', text: '20' },
    ],
    answer: 'A',
    explanation: 'Subtract 5 from both sides, then divide by 2',
    competencies: [{ code: 'M.LIN.1', raw: 'Linear Equations' }],
    difficulty: 'medium',
    tags: ['algebra', 'linear-equations'],
  },
  'q-geo-1': {
    canonicalId: 'SAT-M-P-GEO001',
    testCode: 'SAT',
    sectionCode: 'M',
    sourceType: 1,
    stem: 'Find the area of a circle with radius 5',
    options: [
      { key: 'A', text: '25π' },
      { key: 'B', text: '10π' },
      { key: 'C', text: '5π' },
      { key: 'D', text: '100π' },
    ],
    answer: 'A',
    explanation: 'Area = πr² = π(5)² = 25π',
    competencies: [{ code: 'M.GEO.2', raw: 'Geometry - Area' }],
    difficulty: 'easy',
    tags: ['geometry', 'area'],
  },
  'q-other-1': {
    canonicalId: 'SAT-M-P-ALG001',
    testCode: 'SAT',
    sectionCode: 'M',
    sourceType: 1,
    stem: 'What is the value of 2^10?',
    options: [
      { key: 'A', text: '1024' },
      { key: 'B', text: '512' },
      { key: 'C', text: '2048' },
      { key: 'D', text: '256' },
    ],
    answer: 'A',
    explanation: '2^10 = 1024',
    competencies: [{ code: 'M.EXP.3', raw: 'Exponents' }],
    difficulty: 'hard',
    tags: ['algebra', 'exponents'],
  },
};

const MOCK_MATCHES: MatchResult[] = [
  {
    question_id: 'q-lin-1',
    similarity: 0.85,
    stem: MOCK_QUESTIONS['q-lin-1'].stem,
    section: 'Math',
    metadata: {
      competencyCodes: ['M.LIN.1'],
      difficulty: 'medium',
    },
  },
  {
    question_id: 'q-geo-1',
    similarity: 0.80,
    stem: MOCK_QUESTIONS['q-geo-1'].stem,
    section: 'Math',
    metadata: {
      competencyCodes: ['M.GEO.2'],
      difficulty: 'easy',
    },
  },
  {
    question_id: 'q-other-1',
    similarity: 0.75,
    stem: MOCK_QUESTIONS['q-other-1'].stem,
    section: 'Math',
    metadata: {
      competencyCodes: ['M.EXP.3'],
      difficulty: 'hard',
    },
  },
];

// ========== MOCK FACTORIES ==========

function createMockVectorClient(): VectorClient & { matchSimilar: ReturnType<typeof vi.fn> } {
  return {
    matchSimilar: vi.fn().mockResolvedValue(MOCK_MATCHES),
  };
}

function createMockEmbeddingClient(): EmbeddingClient & { generateEmbedding: ReturnType<typeof vi.fn> } {
  return {
    generateEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
  };
}

function createMockQuestionRepo(): QuestionRepository & {
  loadById: ReturnType<typeof vi.fn>;
  loadByCanonicalId: ReturnType<typeof vi.fn>;
} {
  return {
    loadById: vi.fn().mockImplementation((id: string) => {
      return Promise.resolve(MOCK_QUESTIONS[id] || null);
    }),
    loadByCanonicalId: vi.fn().mockImplementation((canonicalId: string) => {
      const found = Object.values(MOCK_QUESTIONS).find(q => q.canonicalId === canonicalId);
      return Promise.resolve(found || null);
    }),
  };
}

function createWeaknessProfile(): StudentProfile {
  return {
    userId: 'test-user-1',
    overallLevel: 3,
    primaryStyle: 'step-by-step',
    secondaryStyle: 'conceptual',
    explanationLevel: 2,
    competencyMap: {
      'M.LIN.1': { correct: 1, incorrect: 9, total: 10 }, // WEAK (incorrect > correct)
      'M.GEO.2': { correct: 8, incorrect: 1, total: 9 },  // STRONG (correct > incorrect)
      'M.EXP.3': { correct: 2, incorrect: 2, total: 4 },  // NEUTRAL (equal)
    },
    recentQuestions: [],
    personaTags: [],
  };
}

function createEmptyProfile(): StudentProfile {
  return {
    userId: 'test-user-empty',
    overallLevel: 3,
    primaryStyle: 'step-by-step',
    competencyMap: {},
    recentQuestions: [],
    personaTags: [],
  };
}

// ========== TEST SUITES ==========

describe('RagService', () => {
  let service: RagService;
  let mockVectorClient: ReturnType<typeof createMockVectorClient>;
  let mockEmbeddingClient: ReturnType<typeof createMockEmbeddingClient>;
  let mockQuestionRepo: ReturnType<typeof createMockQuestionRepo>;

  beforeEach(() => {
    mockVectorClient = createMockVectorClient();
    mockEmbeddingClient = createMockEmbeddingClient();
    mockQuestionRepo = createMockQuestionRepo();

    service = new RagService({
      vectorClient: mockVectorClient,
      embeddingClient: mockEmbeddingClient,
      questionRepo: mockQuestionRepo,
    });
  });

  describe('Weakness Area Extraction', () => {
    it('should identify M.LIN.1 as weak area when incorrect > correct', () => {
      const profile = createWeaknessProfile();
      const weakAreas = service.testExtractStudentWeakAreas(profile);

      expect(weakAreas).toContain('M.LIN.1');
      expect(weakAreas).not.toContain('M.GEO.2');
      expect(weakAreas).not.toContain('M.EXP.3');
    });

    it('should identify M.GEO.2 as strong area when correct > incorrect', () => {
      const profile = createWeaknessProfile();
      const strongAreas = service.testExtractStudentStrongAreas(profile);

      expect(strongAreas).toContain('M.GEO.2');
      expect(strongAreas).not.toContain('M.LIN.1');
      expect(strongAreas).not.toContain('M.EXP.3');
    });

    it('should return empty arrays for profile with no competency map', () => {
      const weakAreas = service.testExtractStudentWeakAreas(null);
      const strongAreas = service.testExtractStudentStrongAreas(null);

      expect(weakAreas).toEqual([]);
      expect(strongAreas).toEqual([]);
    });

    it('should ignore competencies with fewer than 3 attempts', () => {
      const profile: StudentProfile = {
        userId: 'test',
        primaryStyle: 'step-by-step',
        competencyMap: {
          'M.TEST.1': { correct: 0, incorrect: 2, total: 2 }, // Only 2 attempts, should be ignored
        },
      };

      const weakAreas = service.testExtractStudentWeakAreas(profile);
      expect(weakAreas).toEqual([]);
    });
  });

  describe('Test A: Weakness Boosting', () => {
    it('should rank weak competency match higher due to weakness boost', () => {
      const profile = createWeaknessProfile();
      const scoringContext: ScoringContext = {
        targetCompetencies: [],
        targetDifficulty: null,
        studentWeakAreas: ['M.LIN.1'], // M.LIN.1 is a weak area
      };

      // Create two matches with similar semantic similarity
      // but one has the weak competency M.LIN.1
      const matches: MatchResult[] = [
        {
          question_id: 'q-geo-1',
          similarity: 0.85, // Slightly higher similarity
          stem: 'Geometry question',
          section: 'Math',
          metadata: {
            competencyCodes: ['M.GEO.2'], // NOT a weak area
            difficulty: 'easy',
          },
        },
        {
          question_id: 'q-lin-1',
          similarity: 0.80, // Lower similarity
          stem: 'Linear equations question',
          section: 'Math',
          metadata: {
            competencyCodes: ['M.LIN.1'], // IS a weak area
            difficulty: 'medium',
          },
        },
      ];

      const scored = service.testScoreAndSortMatches(matches, scoringContext);

      // The M.LIN.1 match should get a 10% weakness boost
      // Score for M.GEO.2: 0.4 * 0.85 + 0 (no comp match) + 0 (no difficulty) + 0 (no weakness) = 0.34
      // Score for M.LIN.1: 0.4 * 0.80 + 0 (no comp match) + 0 (no difficulty) + 0.1 * 1 (weakness boost) = 0.42

      expect(scored[0].question_id).toBe('q-lin-1');
      expect(scored[0].scoreBreakdown.weaknessBoost).toBe(1);
      expect(scored[1].question_id).toBe('q-geo-1');
      expect(scored[1].scoreBreakdown.weaknessBoost).toBe(0);
    });

    it('should compute weakness boost as 1 when match competency is in weak areas', () => {
      const boost = service.testComputeWeaknessBoost(['M.LIN.1', 'M.ALG.2'], ['M.LIN.1']);
      expect(boost).toBe(1);
    });

    it('should compute weakness boost as 0 when no overlap', () => {
      const boost = service.testComputeWeaknessBoost(['M.LIN.1'], ['M.GEO.2']);
      expect(boost).toBe(0);
    });
  });

  describe('Test B: Difficulty Match Scoring', () => {
    it('should score 1.0 for exact difficulty match', () => {
      const score = service.testComputeDifficultyMatch('medium', 'medium');
      expect(score).toBe(1);
    });

    it('should score 0.5 for adjacent difficulties (easy-medium)', () => {
      const scoreEasyMedium = service.testComputeDifficultyMatch('easy', 'medium');
      const scoreMediumEasy = service.testComputeDifficultyMatch('medium', 'easy');
      const scoreMediumHard = service.testComputeDifficultyMatch('medium', 'hard');

      expect(scoreEasyMedium).toBe(0.5);
      expect(scoreMediumEasy).toBe(0.5);
      expect(scoreMediumHard).toBe(0.5);
    });

    it('should score 0 for non-adjacent difficulties (easy-hard)', () => {
      const score = service.testComputeDifficultyMatch('easy', 'hard');
      expect(score).toBe(0);
    });

    it('should score 0 when either difficulty is null', () => {
      expect(service.testComputeDifficultyMatch(null, 'medium')).toBe(0);
      expect(service.testComputeDifficultyMatch('medium', null)).toBe(0);
      expect(service.testComputeDifficultyMatch(null, null)).toBe(0);
    });

    it('should rank medium difficulty higher than hard when target is medium', () => {
      const scoringContext: ScoringContext = {
        targetCompetencies: [],
        targetDifficulty: 'medium',
        studentWeakAreas: [],
      };

      // One match is medium (exact match), one is hard (adjacent)
      const matches: MatchResult[] = [
        {
          question_id: 'q-hard',
          similarity: 0.90, // Higher similarity
          stem: 'Hard question',
          section: 'Math',
          metadata: {
            competencyCodes: [],
            difficulty: 'hard',
          },
        },
        {
          question_id: 'q-medium',
          similarity: 0.85, // Lower similarity
          stem: 'Medium question',
          section: 'Math',
          metadata: {
            competencyCodes: [],
            difficulty: 'medium',
          },
        },
      ];

      const scored = service.testScoreAndSortMatches(matches, scoringContext);

      // Score for hard: 0.4 * 0.90 + 0 + 0.1 * 0.5 (adjacent) + 0 = 0.41
      // Score for medium: 0.4 * 0.85 + 0 + 0.1 * 1.0 (exact) + 0 = 0.44
      // Medium should rank higher despite lower semantic similarity

      expect(scored[0].question_id).toBe('q-medium');
      expect(scored[0].scoreBreakdown.difficultyMatch).toBe(1);
      expect(scored[1].question_id).toBe('q-hard');
      expect(scored[1].scoreBreakdown.difficultyMatch).toBe(0.5);
    });
  });

  describe('Test C: Strategy Mode - No Vector/DB Calls', () => {
    it('should not call vector client in strategy mode', async () => {
      const request: RagQueryRequest = {
        userId: 'test-user',
        message: 'What is the best strategy for SAT math?',
        mode: 'strategy',
        testCode: 'SAT',
        sectionCode: 'M',
      };

      const profile = createEmptyProfile();
      const result = await service.testHandleStrategyMode(request, profile);

      // Verify no vector calls were made
      expect(mockVectorClient.matchSimilar).not.toHaveBeenCalled();
      expect(mockEmbeddingClient.generateEmbedding).not.toHaveBeenCalled();
    });

    it('should not call question repository in strategy mode', async () => {
      const request: RagQueryRequest = {
        userId: 'test-user',
        message: 'What is the best strategy for SAT math?',
        mode: 'strategy',
        testCode: 'SAT',
        sectionCode: 'M',
      };

      const profile = createEmptyProfile();
      const result = await service.testHandleStrategyMode(request, profile);

      // Verify no question repo calls were made
      expect(mockQuestionRepo.loadById).not.toHaveBeenCalled();
      expect(mockQuestionRepo.loadByCanonicalId).not.toHaveBeenCalled();
    });

    it('should return empty questions in strategy mode', async () => {
      const request: RagQueryRequest = {
        userId: 'test-user',
        message: 'What is the best strategy for SAT math?',
        mode: 'strategy',
        testCode: 'SAT',
        sectionCode: 'M',
      };

      const profile = createWeaknessProfile();
      const result = await service.testHandleStrategyMode(request, profile);

      expect(result.primaryQuestion).toBeNull();
      expect(result.supportingQuestions).toEqual([]);
      expect(result.competencyContext.competencyLabels).toEqual([]);
    });

    it('should include student profile in strategy mode response', async () => {
      const request: RagQueryRequest = {
        userId: 'test-user',
        message: 'What is the best strategy?',
        mode: 'strategy',
      };

      const profile = createWeaknessProfile();
      const result = await service.testHandleStrategyMode(request, profile);

      expect(result.studentProfile).toBe(profile);
      expect(result.studentProfile?.userId).toBe('test-user-1');
    });
  });

  describe('Concept Mode with Mocks', () => {
    it('should call vector client in concept mode', async () => {
      const request: RagQueryRequest = {
        userId: 'test-user',
        message: 'help me understand linear equations',
        mode: 'concept',
        testCode: 'SAT',
        sectionCode: 'M',
      };

      const profile = createWeaknessProfile();
      await service.testHandleConceptMode(request, profile);

      // Verify vector and embedding calls were made
      expect(mockEmbeddingClient.generateEmbedding).toHaveBeenCalledWith('help me understand linear equations');
      expect(mockVectorClient.matchSimilar).toHaveBeenCalled();
    });

    it('should load questions for matches in concept mode', async () => {
      const request: RagQueryRequest = {
        userId: 'test-user',
        message: 'help me understand linear equations',
        mode: 'concept',
        testCode: 'SAT',
        sectionCode: 'M',
        topK: 3,
      };

      const profile = createWeaknessProfile();
      const result = await service.testHandleConceptMode(request, profile);

      // Verify question repo was called for loading questions
      expect(mockQuestionRepo.loadById).toHaveBeenCalled();
    });

    it('should identify weak and strong areas in competency context', async () => {
      const request: RagQueryRequest = {
        userId: 'test-user',
        message: 'help me understand math',
        mode: 'concept',
        testCode: 'SAT',
        sectionCode: 'M',
      };

      const profile = createWeaknessProfile();
      const ctx = service.testBuildCompetencyContext(profile, []);

      expect(ctx.studentWeakAreas).toContain('M.LIN.1');
      expect(ctx.studentStrongAreas).toContain('M.GEO.2');
    });
  });

  describe('PRP Scoring Weights', () => {
    it('should have correct scoring weight values', () => {
      expect(service.SCORING_WEIGHTS.semanticSim).toBe(0.4);
      expect(service.SCORING_WEIGHTS.competencyMatch).toBe(0.3);
      expect(service.SCORING_WEIGHTS.difficultyMatch).toBe(0.1);
      expect(service.SCORING_WEIGHTS.recencyScore).toBe(0.1);
      expect(service.SCORING_WEIGHTS.weaknessBoost).toBe(0.1);
    });

    it('should sum to 1.0', () => {
      const weights = service.SCORING_WEIGHTS;
      const sum = weights.semanticSim + weights.competencyMatch +
                  weights.difficultyMatch + weights.recencyScore + weights.weaknessBoost;
      expect(sum).toBeCloseTo(1.0, 10);
    });
  });

  describe('Combined Scoring', () => {
    it('should correctly combine all scoring factors', () => {
      const scoringContext: ScoringContext = {
        targetCompetencies: ['M.LIN.1'],
        targetDifficulty: 'medium',
        studentWeakAreas: ['M.LIN.1'],
      };

      const matches: MatchResult[] = [
        {
          question_id: 'q-lin-1',
          similarity: 0.90,
          stem: 'Linear equation',
          section: 'Math',
          metadata: {
            competencyCodes: ['M.LIN.1'],
            difficulty: 'medium',
          },
        },
      ];

      const scored = service.testScoreAndSortMatches(matches, scoringContext);
      const breakdown = scored[0].scoreBreakdown;

      // Semantic: 0.4 * 0.90 = 0.36
      expect(breakdown.semanticSim).toBe(0.90);
      // Competency: 0.3 * 1.0 = 0.30 (full match)
      expect(breakdown.competencyMatch).toBe(1.0);
      // Difficulty: 0.1 * 1.0 = 0.10 (exact match)
      expect(breakdown.difficultyMatch).toBe(1.0);
      // Weakness: 0.1 * 1.0 = 0.10
      expect(breakdown.weaknessBoost).toBe(1.0);
      // Recency: 0.1 * 0 = 0 (stubbed)
      expect(breakdown.recencyScore).toBe(0);
      // Quality bonus: competency + difficulty metadata = 0.10
      expect(breakdown.qualityBonus).toBeCloseTo(0.1, 2);

      // Combined: 0.36 + 0.30 + 0.10 + 0 + 0.10 + 0.10 = 0.96
      expect(scored[0].combinedScore).toBeCloseTo(0.96, 2);
    });
  });
});
