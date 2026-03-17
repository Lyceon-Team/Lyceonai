import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock('../apps/api/src/lib/supabase-server', () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

import { getReviewErrors } from '../server/routes/questions-runtime';

function makeRes() {
  let statusCode = 200;
  let body: any = null;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  };

  return { res, getStatus: () => statusCode, getBody: () => body };
}

function setupSupabase(args: {
  practiceRows: any[];
  fullLengthRows: any[];
  fullLengthQuestionRows?: any[];
  reviewRows?: any[];
}) {
  const {
    practiceRows,
    fullLengthRows,
    fullLengthQuestionRows = [],
    reviewRows = [],
  } = args;

  fromMock.mockImplementation((table: string) => {
    if (table === 'answer_attempts') {
      const chain: any = {
        eq: () => chain,
        order: () => chain,
        limit: async () => ({ data: practiceRows, error: null }),
      };
      return { select: () => chain };
    }

    if (table === 'full_length_exam_responses') {
      const chain: any = {
        eq: () => chain,
        order: () => chain,
        limit: async () => ({ data: fullLengthRows, error: null }),
      };
      return { select: () => chain };
    }

    if (table === 'questions') {
      const chain: any = {
        in: async () => ({ data: fullLengthQuestionRows, error: null }),
      };
      return { select: () => chain };
    }

    if (table === 'review_error_attempts') {
      const chain: any = {
        eq: () => chain,
        in: () => chain,
        order: async () => ({ data: reviewRows, error: null }),
      };
      return { select: () => chain };
    }

    throw new Error(`Unexpected table mock: ${table}`);
  });
}

describe('Review queue runtime contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds deterministic unresolved queue from canonical misses and dedupes by question', async () => {
    setupSupabase({
      practiceRows: [
        {
          id: 'p1-latest',
          question_id: 'q1',
          is_correct: false,
          outcome: 'incorrect',
          attempted_at: '2026-03-12T09:00:00.000Z',
          questions: { id: 'q1', stem: 'Q1 stem', section: 'Math', difficulty: 'medium', domain: 'alg', skill: 's1', subskill: 'ss1' },
        },
        {
          id: 'p1-older',
          question_id: 'q1',
          is_correct: false,
          outcome: 'incorrect',
          attempted_at: '2026-03-11T09:00:00.000Z',
          questions: { id: 'q1', stem: 'Q1 stem old', section: 'Math', difficulty: 'medium', domain: 'alg', skill: 's1', subskill: 'ss1' },
        },
        {
          id: 'p2-skip',
          question_id: 'q2',
          is_correct: false,
          outcome: 'skipped',
          attempted_at: '2026-03-12T10:00:00.000Z',
          questions: { id: 'q2', stem: 'Q2 stem', section: 'RW', difficulty: 'easy', domain: 'rw', skill: 's2', subskill: 'ss2' },
        },
        {
          id: 'p3-correct',
          question_id: 'q3',
          is_correct: true,
          outcome: 'correct',
          attempted_at: '2026-03-12T11:00:00.000Z',
          questions: { id: 'q3', stem: 'Q3 stem', section: 'Math', difficulty: 'hard', domain: 'geo', skill: 's3', subskill: 'ss3' },
        },
      ],
      fullLengthRows: [
        { id: 'f4', question_id: 'q4', is_correct: false, answered_at: '2026-03-12T12:00:00.000Z' },
        { id: 'f5', question_id: 'q5', is_correct: false, answered_at: '2026-03-10T08:00:00.000Z' },
      ],
      fullLengthQuestionRows: [
        { id: 'q4', stem: 'Q4 stem', section: 'Math', difficulty: 'hard', domain: 'adv', skill: 's4', subskill: 'ss4' },
        { id: 'q5', stem: 'Q5 stem', section: 'RW', difficulty: 'medium', domain: 'info', skill: 's5', subskill: 'ss5' },
      ],
      reviewRows: [
        { question_id: 'q2', is_correct: true, created_at: '2026-03-13T10:00:00.000Z' },
        { question_id: 'q5', is_correct: false, created_at: '2026-03-13T09:00:00.000Z' },
      ],
    });

    const { res, getStatus, getBody } = makeRes();
    const req: any = { user: { id: 'student-1' } };

    await getReviewErrors(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody();

    expect(body.reviewQueue.map((item: any) => item.questionId)).toEqual(['q4', 'q1', 'q5']);
    expect(body.reviewQueue.every((item: any) => item.outcome !== 'correct')).toBe(true);
    expect(body.reviewQueue.filter((item: any) => item.questionId === 'q1')).toHaveLength(1);
    expect(body.reviewQueue.find((item: any) => item.questionId === 'q2')).toBeUndefined();
    expect(body.reviewQueue.every((item: any) => item.correct_answer === undefined)).toBe(true);
    expect(body.reviewQueue.every((item: any) => item.explanation === undefined)).toBe(true);
    expect(body.reviewQueue.every((item: any) => item.option_token_map === undefined)).toBe(true);
    expect(body.reviewQueue.every((item: any) => item.options === undefined)).toBe(true);

    expect(body.summary.correctCount).toBe(1);
    expect(body.summary.incorrectCount).toBe(3);
    expect(body.summary.skippedCount).toBe(1);
    expect(body.summary.totalCount).toBe(5);
  });

  it('includes full-test misses when no practice miss exists', async () => {
    setupSupabase({
      practiceRows: [],
      fullLengthRows: [{ id: 'f1', question_id: 'q10', is_correct: false, answered_at: '2026-03-12T12:00:00.000Z' }],
      fullLengthQuestionRows: [{ id: 'q10', stem: 'Q10 stem', section: 'RW', difficulty: 'medium', domain: 'rw', skill: 's10', subskill: 'ss10' }],
      reviewRows: [],
    });

    const { res, getStatus, getBody } = makeRes();
    const req: any = { user: { id: 'student-1' } };

    await getReviewErrors(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().reviewQueue).toHaveLength(1);
    expect(getBody().reviewQueue[0].questionId).toBe('q10');
    expect(getBody().reviewQueue[0].source).toBe('full_test');
  });

  it('denies unauthenticated access', async () => {
    setupSupabase({
      practiceRows: [],
      fullLengthRows: [],
      reviewRows: [],
    });

    const { res, getStatus, getBody } = makeRes();
    const req: any = {};

    await getReviewErrors(req, res);

    expect(getStatus()).toBe(401);
    expect(getBody().error).toContain('Authentication required');
  });

  it('does not derive canonical identity from canonical-shaped question_id when canonical_id is missing', async () => {
    setupSupabase({
      practiceRows: [
        {
          id: 'p-canonical-shaped-id',
          question_id: 'SATM1ABC123',
          is_correct: false,
          outcome: 'incorrect',
          attempted_at: '2026-03-12T12:00:00.000Z',
          questions: {
            id: 'SATM1ABC123',
            canonical_id: null,
            stem: 'Q stem',
            section: 'Math',
            difficulty: 'medium',
            domain: 'alg',
            skill: 's1',
            subskill: 'ss1',
          },
        },
      ],
      fullLengthRows: [],
      reviewRows: [],
    });

    const { res, getStatus, getBody } = makeRes();
    const req: any = { user: { id: 'student-1' } };

    await getReviewErrors(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().reviewQueue).toHaveLength(1);
    expect(getBody().reviewQueue[0].questionId).toBe('SATM1ABC123');
    expect(getBody().reviewQueue[0].questionCanonicalId).toBeNull();
  });
});
