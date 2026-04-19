import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

const mockMathQuestions = [
  {
    id: 'q1',
    canonical_id: 'SATMATH1ABC001',
    stem: 'What is 2+2?',
    options: [
      { key: 'A', text: '3' },
      { key: 'B', text: '4' },
      { key: 'C', text: '5' },
      { key: 'D', text: '6' },
    ],
    section: 'Math',
    section_code: 'MATH',
    domain: 'Algebra',
    skill: 'Linear equations',
    skill_code: 'MATH.ALG.LINEAR',
    difficulty: 1,
    question_type: 'multiple_choice',
    status: 'published',
  },
  {
    id: 'q2',
    canonical_id: 'SATMATH1ABC002',
    stem: 'What is 3+3?',
    options: [
      { key: 'A', text: '5' },
      { key: 'B', text: '6' },
      { key: 'C', text: '7' },
      { key: 'D', text: '8' },
    ],
    section: 'Math',
    section_code: 'MATH',
    domain: 'Geometry',
    skill: 'Circles',
    skill_code: 'MATH.GEO.CIRCLES',
    difficulty: 2,
    question_type: 'multiple_choice',
    status: 'published',
  },
];

const mockRWQuestions = [
  {
    id: 'q3',
    canonical_id: 'SATRW1ABC003',
    stem: 'Read the passage and answer...',
    options: [
      { key: 'A', text: 'Option A' },
      { key: 'B', text: 'Option B' },
      { key: 'C', text: 'Option C' },
      { key: 'D', text: 'Option D' },
    ],
    section: 'Reading and Writing',
    section_code: 'RW',
    domain: 'Information and Ideas',
    skill: 'Main Idea',
    skill_code: 'RW.INFO.MAIN_IDEA',
    difficulty: 2,
    question_type: 'multiple_choice',
    status: 'published',
  },
];

const mockQuestions = [...mockMathQuestions, ...mockRWQuestions];

function createChainableMock(returnData: any[] = []) {
  const mock: any = {};
  const methods = ['select', 'eq', 'neq', 'in', 'ilike', 'or', 'gte', 'gt', 'lt', 'lte', 'order', 'limit', 'not'];

  methods.forEach((method) => {
    mock[method] = vi.fn(() => mock);
  });

  mock.then = (resolve: (value: { data: any[]; error: null }) => any, reject?: (reason: any) => any) =>
    Promise.resolve({ data: returnData, error: null }).then(resolve, reject);

  return mock;
}

vi.mock('../mastery-read', () => ({
  fetchWeakestSkills: vi.fn(),
  fetchWeakestClusters: vi.fn(),
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
import { fetchWeakestSkills, fetchWeakestClusters } from '../mastery-read';

describe('adaptiveSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchWeakestSkills as Mock).mockResolvedValue([]);
    (fetchWeakestClusters as Mock).mockResolvedValue([]);
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
    (fetchWeakestClusters as Mock).mockResolvedValue([
      { structure_cluster_id: 'cluster-1', accuracy: 0.3, attempts: 10, correct: 3, mastery_score: 0.3 },
    ]);

    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'math',
      sessionId: 'session-123',
      target: { mode: 'cluster' },
    });

    expect(result.rationale.mode).toBe('cluster');
  });

  it('should use skill mode when specified', async () => {
    (fetchWeakestSkills as Mock).mockResolvedValue([
      { section: 'math', domain: 'Algebra', skill: 'Linear equations', accuracy: 0.4, attempts: 10, correct: 4, mastery_score: 0.4 },
    ]);

    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'math',
      sessionId: 'session-123',
      target: { mode: 'skill' },
    });

    expect(result.rationale.mode).toBe('skill');
  });

  it('marks bounded degraded fallback when weak-skill source fails', async () => {
    (fetchWeakestSkills as Mock).mockRejectedValueOnce(new Error('weakest_skills_query_failed'));

    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'math',
      sessionId: 'session-123',
      target: { mode: 'skill' },
    });

    expect(result.question).toBeDefined();
    expect(result.rationale.mode).toBe('skill');
    expect(result.rationale.pickedFrom).toBe('fallback');
    expect(result.rationale.weaknessKey).toBeUndefined();
    expect(result.rationale.sourceWarnings).toEqual(['weak_skills_source_failed']);
    expect(result.rationale.filterPath).toContain('weakest-skills-source-failed');
  });

  it('does not emit source warning when weak-skill source is healthy', async () => {
    (fetchWeakestSkills as Mock).mockResolvedValueOnce([
      { section: 'math', domain: 'Algebra', skill: 'Linear equations', accuracy: 0.4, attempts: 10, correct: 4, mastery_score: 0.4 },
    ]);

    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'math',
      sessionId: 'session-123',
      target: { mode: 'skill' },
    });

    expect(result.rationale.pickedFrom).toBe('skill');
    expect(result.rationale.sourceWarnings).toBeUndefined();
    expect(result.rationale.filterPath?.includes('weakest-skills-source-failed')).toBe(false);
  });

  it('should respect fixed difficulty policy', async () => {
    const result = await selectNextQuestionForStudent({
      userId: 'user-123',
      section: 'math',
      sessionId: 'session-123',
      difficultyPolicy: 3,
    });

    expect(result.rationale.filterPath).toBeDefined();
    expect(result.rationale.filterPath).toContain('fixed-difficulty=3');
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
    expect(q.questionType).toBe('multiple_choice');
    expect(Array.isArray(q.options)).toBe(true);
    expect([1, 2, 3]).toContain(q.difficulty);
  });

  it('balanced mode picks deterministically', async () => {
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
    expect(result4.rationale.difficultyPicked).toBeDefined();
  });
});
