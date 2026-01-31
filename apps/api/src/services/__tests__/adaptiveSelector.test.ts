import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

const mockMathQuestions = [
  {
    id: 'q1',
    canonical_id: 'SATM2ABC001',
    stem: 'What is 2+2?',
    options: [{ key: 'A', text: '3' }, { key: 'B', text: '4' }],
    section: 'Math',
    section_code: 'M',
    domain: 'Algebra',
    skill: 'Linear equations',
    difficulty_bucket: 'easy',
    structure_cluster_id: 'cluster-1',
    type: 'mc',
    needs_review: false,
  },
  {
    id: 'q2',
    canonical_id: 'SATM2ABC002',
    stem: 'What is 3+3?',
    options: [{ key: 'A', text: '5' }, { key: 'B', text: '6' }],
    section: 'Math',
    section_code: 'M',
    domain: 'Geometry',
    skill: 'Circles',
    difficulty_bucket: 'medium',
    structure_cluster_id: 'cluster-2',
    type: 'mc',
    needs_review: false,
  },
];

const mockRWQuestions = [
  {
    id: 'q3',
    canonical_id: 'SATR2ABC003',
    stem: 'Read the passage and answer...',
    options: [{ key: 'A', text: 'Option A' }, { key: 'B', text: 'Option B' }],
    section: 'Reading',
    section_code: 'R',
    domain: 'Reading Comprehension',
    skill: 'Main Idea',
    difficulty_bucket: 'medium',
    structure_cluster_id: 'cluster-3',
    type: 'mc',
    needs_review: false,
  },
];

const mockQuestions = [...mockMathQuestions, ...mockRWQuestions];

function createChainableMock(returnData: any[] = []) {
  const mock: any = {};
  const methods = ['select', 'eq', 'neq', 'in', 'ilike', 'or', 'gte', 'gt', 'lt', 'lte', 'order', 'limit', 'not'];

  methods.forEach(method => {
    mock[method] = vi.fn(() => mock);
  });

  mock.limit = vi.fn(() => Promise.resolve({ data: returnData, error: null }));

  return mock;
}

vi.mock('../studentMastery', () => ({
  getWeakestSkills: vi.fn(),
  getWeakestClusters: vi.fn(),
}));

vi.mock('../../lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'student_question_attempts') {
        return createChainableMock([]);
      }
      return createChainableMock(mockQuestions);
    }),
  })),
}));

import { selectNextQuestionForStudent } from '../adaptiveSelector';
import { getWeakestSkills, getWeakestClusters } from '../studentMastery';

describe('adaptiveSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getWeakestSkills as Mock).mockResolvedValue([]);
    (getWeakestClusters as Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return a question for math section', async () => {
    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'math',
      sessionId: 'session-123',
    });

    expect(result).toBeDefined();
    expect(result.question).toBeDefined();
    expect(result.question.id).toBeDefined();
    expect(result.rationale).toBeDefined();
    expect(result.rationale.mode).toBe('balanced');
  });

  it('should use cluster mode when specified', async () => {
    (getWeakestClusters as Mock).mockResolvedValue([
      { structure_cluster_id: 'cluster-1', accuracy: 0.3, attempts: 10, correct: 3, mastery_score: 0.3 },
    ]);

    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'math',
      sessionId: 'session-123',
      target: { mode: 'cluster' },
    });

    expect(result.rationale.mode).toBe('cluster');
    expect(getWeakestClusters).toHaveBeenCalled();
  });

  it('should use skill mode when specified', async () => {
    (getWeakestSkills as Mock).mockResolvedValue([
      { section: 'math', domain: 'Algebra', skill: 'Linear equations', accuracy: 0.4, attempts: 10, correct: 4, mastery_score: 0.4 },
    ]);

    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'math',
      sessionId: 'session-123',
      target: { mode: 'skill' },
    });

    expect(result.rationale.mode).toBe('skill');
    expect(getWeakestSkills).toHaveBeenCalled();
  });

  it('should respect fixed difficulty policy', async () => {
    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'math',
      sessionId: 'session-123',
      difficultyPolicy: 'hard',
    });

    expect(result.rationale.filterPath).toBeDefined();
    expect(result.rationale.filterPath).toContain('fixed-difficulty=hard');
  });

  it('should include rationale with filter path', async () => {
    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'math',
      sessionId: 'session-123',
    });

    expect(result.rationale.filterPath).toBeDefined();
    expect(Array.isArray(result.rationale.filterPath)).toBe(true);
  });

  it('should handle rw section correctly', async () => {
    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'rw',
      sessionId: 'session-123',
    });

    expect(result).toBeDefined();
    expect(result.question).toBeDefined();
  });

  it('should map question to student format correctly', async () => {
    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'math',
      sessionId: 'session-123',
    });

    const q = result.question;
    expect(q.id).toBeDefined();
    expect(q.canonicalId).toBeDefined();
    expect(q.stem).toBeDefined();
    expect(q.section).toBeDefined();
    expect(q.type).toBe('mc');
    expect(Array.isArray(q.options)).toBe(true);
  });

  it('balanced mode picks from cluster shortlist deterministically', async () => {
    const mockClusters = [
      { structure_cluster_id: 'cluster-1', accuracy: 0.2, attempts: 10, correct: 2, mastery_score: 0.2 },
      { structure_cluster_id: 'cluster-2', accuracy: 0.4, attempts: 10, correct: 4, mastery_score: 0.4 },
      { structure_cluster_id: 'cluster-3', accuracy: 0.5, attempts: 10, correct: 5, mastery_score: 0.5 },
    ];
    (getWeakestClusters as Mock).mockResolvedValue(mockClusters);

    const params = {
      userId: 'user-deterministic-test',
      section: 'math' as const,
      sessionId: 'session-deterministic',
      attemptIndex: 5,
      target: { mode: 'balanced' as const },
    };

    const result1 = await selectNextQuestionForStudent(params);
    const result2 = await selectNextQuestionForStudent(params);

    expect(result1.question.canonicalId).toBe(result2.question.canonicalId);
    expect(result1.rationale.weaknessKey).toBe(result2.rationale.weaknessKey);
  });

  it('difficulty randomness is deterministic per seed', async () => {
    const params = {
      userId: 'user-difficulty-test',
      section: 'math' as const,
      sessionId: 'session-difficulty',
      attemptIndex: 3,
    };

    const result1 = await selectNextQuestionForStudent(params);
    const result2 = await selectNextQuestionForStudent(params);

    expect(result1.rationale.difficultyPicked).toBe(result2.rationale.difficultyPicked);
    
    const paramsWithDifferentIndex = { ...params, attemptIndex: 4 };
    const result3 = await selectNextQuestionForStudent(params);
    const result4 = await selectNextQuestionForStudent(paramsWithDifferentIndex);
    
    expect(result3.rationale.difficultyPicked).toBe(result1.rationale.difficultyPicked);
  });
});
