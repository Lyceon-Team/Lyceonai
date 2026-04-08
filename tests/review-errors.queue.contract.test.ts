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
  practiceSessionItemRows: any[];
  fullLengthRows: any[];
  fullLengthQuestionRows?: any[];
  reviewRows?: any[];
}) {
  const {
    practiceSessionItemRows,
    fullLengthRows,
    fullLengthQuestionRows = [],
    reviewRows = [],
  } = args;

  fromMock.mockImplementation((table: string) => {
    if (table === 'full_length_exam_responses') {
      const filters: Array<[string, any]> = [];
      const chain: any = {
        eq: (column: string, value: any) => {
          filters.push([column, value]);
          return chain;
        },
        order: () => chain,
        limit: async () => ({
          data: fullLengthRows.filter((row) =>
            filters.every(([column, value]) => {
              if (column.includes(".")) return true;
              if (!(column in row)) return true;
              return row[column] === value;
            })
          ),
          error: null,
        }),
      };
      return { select: () => chain };
    }

    if (table === 'full_length_exam_questions') {
      const chain: any = {
        in: (_column: string, values: any[]) => ({
          data: fullLengthQuestionRows.filter((row) => values.includes(row.module_id)),
          error: null,
        }),
      };
      return { select: () => chain };
    }

    if (table === 'practice_session_items') {
      const filters: Array<{ type: 'eq' | 'in'; column: string; value: any }> = [];
      let orderBy: { column: string; ascending: boolean } | null = null;
      let limitValue: number | null = null;
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: any) => {
          filters.push({ type: 'eq', column, value });
          return chain;
        },
        in: (column: string, values: any[]) => {
          filters.push({ type: 'in', column, value: values });
          return chain;
        },
        order: (column: string, opts?: { ascending?: boolean }) => {
          orderBy = { column, ascending: opts?.ascending !== false };
          return chain;
        },
        limit: (value: number) => {
          limitValue = value;
          return chain;
        },
        then: (resolve: any, reject: any) => {
          let filtered = practiceSessionItemRows;
          for (const filter of filters) {
            if (filter.type === 'eq') {
              filtered = filtered.filter((row) => row[filter.column] === filter.value);
            } else if (filter.type === 'in') {
              const values = filter.value as any[];
              filtered = filtered.filter((row) => values.includes(row[filter.column]));
            }
          }
          if (orderBy) {
            const { column, ascending } = orderBy;
            filtered = [...filtered].sort((a, b) => {
              const av = a[column];
              const bv = b[column];
              if (av === bv) return 0;
              if (av == null) return ascending ? -1 : 1;
              if (bv == null) return ascending ? 1 : -1;
              return ascending ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
            });
          }
          if (limitValue != null) {
            filtered = filtered.slice(0, limitValue);
          }
          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
        },
      };
      return chain;
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
      practiceSessionItemRows: [
        {
          id: 'p1-latest',
          question_id: 'q1',
          question_canonical_id: 'SATM1ABC123',
          question_stem: 'Q1 stem',
          question_section: 'Math',
          question_difficulty: 'medium',
          question_domain: 'alg',
          question_skill: 's1',
          question_subskill: 'ss1',
          question_options: [{ key: 'A', text: '1' }],
          question_correct_answer: 'A',
          outcome: 'incorrect',
          is_correct: false,
          answered_at: '2026-03-12T09:00:00.000Z',
          status: 'answered',
          user_id: 'student-1',
        },
        {
          id: 'p1-older',
          question_id: 'q1',
          question_canonical_id: 'SATM1ABC123',
          question_stem: 'Q1 stem old',
          question_section: 'Math',
          question_difficulty: 'medium',
          question_domain: 'alg',
          question_skill: 's1',
          question_subskill: 'ss1',
          question_options: [{ key: 'A', text: '1' }],
          question_correct_answer: 'A',
          outcome: 'incorrect',
          is_correct: false,
          answered_at: '2026-03-11T09:00:00.000Z',
          status: 'answered',
          user_id: 'student-1',
        },
        {
          id: 'p2-skip',
          question_id: 'q2',
          question_canonical_id: 'SATRW2ABC123',
          question_stem: 'Q2 stem',
          question_section: 'RW',
          question_difficulty: 'easy',
          question_domain: 'rw',
          question_skill: 's2',
          question_subskill: 'ss2',
          question_options: [{ key: 'A', text: '1' }],
          question_correct_answer: 'A',
          outcome: 'skipped',
          is_correct: false,
          answered_at: '2026-03-12T10:00:00.000Z',
          status: 'skipped',
          user_id: 'student-1',
        },
        {
          id: 'p3-correct',
          question_id: 'q3',
          question_canonical_id: 'SATM1ABC999',
          question_stem: 'Q3 stem',
          question_section: 'Math',
          question_difficulty: 'hard',
          question_domain: 'geo',
          question_skill: 's3',
          question_subskill: 'ss3',
          question_options: [{ key: 'A', text: '1' }],
          question_correct_answer: 'A',
          outcome: 'correct',
          is_correct: true,
          answered_at: '2026-03-12T11:00:00.000Z',
          status: 'answered',
          user_id: 'student-1',
        },
      ],
      fullLengthRows: [
        { id: 'f4', module_id: 'module-a', question_id: 'q4', is_correct: false, answered_at: '2026-03-12T12:00:00.000Z' },
        { id: 'f5', module_id: 'module-b', question_id: 'q5', is_correct: false, answered_at: '2026-03-10T08:00:00.000Z' },
      ],
      fullLengthQuestionRows: [
        { module_id: 'module-a', question_id: 'q4', question_canonical_id: 'SATM1GHI789', question_stem: 'Q4 stem', question_section: 'Math', question_difficulty: 'hard', question_domain: 'adv', question_skill: 's4', question_subskill: 'ss4' },
        { module_id: 'module-b', question_id: 'q5', question_canonical_id: 'SATRW2JKL012', question_stem: 'Q5 stem', question_section: 'RW', question_difficulty: 'medium', question_domain: 'info', question_skill: 's5', question_subskill: 'ss5' },
      ],
      reviewRows: [
        { question_id: 'q2', is_correct: true, created_at: '2026-03-13T10:00:00.000Z' },
        { question_id: 'q5', is_correct: false, created_at: '2026-03-13T09:00:00.000Z' },
      ],
    });

    const { res, getStatus, getBody } = makeRes();
    const req: any = { user: { id: 'student-1' }, query: { mode: 'all_past_mistakes' } };

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
      practiceSessionItemRows: [],
      fullLengthRows: [{ id: 'f1', module_id: 'module-10', question_id: 'q10', is_correct: false, answered_at: '2026-03-12T12:00:00.000Z' }],
      fullLengthQuestionRows: [{ module_id: 'module-10', question_id: 'q10', question_canonical_id: 'SATRW2XYZ999', question_stem: 'Q10 stem', question_section: 'RW', question_difficulty: 'medium', question_domain: 'rw', question_skill: 's10', question_subskill: 'ss10' }],
      reviewRows: [],
    });

    const { res, getStatus, getBody } = makeRes();
    const req: any = { user: { id: 'student-1' }, query: { mode: 'all_past_mistakes' } };

    await getReviewErrors(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().reviewQueue).toHaveLength(1);
    expect(getBody().reviewQueue[0].questionId).toBe('q10');
    expect(getBody().reviewQueue[0].source).toBe('full_test');
  });

  it('denies unauthenticated access', async () => {
    setupSupabase({
      practiceSessionItemRows: [],
      fullLengthRows: [],
      reviewRows: [],
    });

    const { res, getStatus, getBody } = makeRes();
    const req: any = {};

    await getReviewErrors(req, res);

    expect(getStatus()).toBe(401);
    expect(getBody().error).toContain('Authentication required');
  });

  it('requires explicit review mode', async () => {
    setupSupabase({
      practiceSessionItemRows: [],
      fullLengthRows: [],
      reviewRows: [],
    });

    const { res, getStatus, getBody } = makeRes();
    const req: any = { user: { id: 'student-1' }, query: {} };

    await getReviewErrors(req, res);

    expect(getStatus()).toBe(400);
    expect(getBody()).toMatchObject({ code: 'REVIEW_MODE_REQUIRED' });
  });

  it('does not derive canonical identity from canonical-shaped question_id when canonical_id is missing', async () => {
    setupSupabase({
      practiceSessionItemRows: [
        {
          id: 'p-canonical-shaped-id',
          question_id: 'SATM1ABC123',
          question_canonical_id: null,
          question_stem: 'Q stem',
          question_section: 'Math',
          question_difficulty: 'medium',
          question_domain: 'alg',
          question_skill: 's1',
          question_subskill: 'ss1',
          question_options: [{ key: 'A', text: '1' }],
          question_correct_answer: 'A',
          outcome: 'incorrect',
          is_correct: false,
          answered_at: '2026-03-12T12:00:00.000Z',
          status: 'answered',
          user_id: 'student-1',
        },
      ],
      fullLengthRows: [],
      reviewRows: [],
    });

    const { res, getStatus, getBody } = makeRes();
    const req: any = { user: { id: 'student-1' }, query: { mode: 'all_past_mistakes' } };

    await getReviewErrors(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().reviewQueue).toHaveLength(1);
    expect(getBody().reviewQueue[0].questionId).toBe('SATM1ABC123');
    expect(getBody().reviewQueue[0].questionCanonicalId).toBeNull();
  });

  it('filters queue to a single practice session when mode=by_practice_session', async () => {
    setupSupabase({
      practiceSessionItemRows: [
        {
          id: 'item-a',
          session_id: 'session-a',
          question_id: 'q1',
          question_canonical_id: 'SATM1ABC123',
          question_stem: 'Q1',
          question_section: 'Math',
          question_difficulty: 'medium',
          question_domain: 'alg',
          question_skill: 's1',
          question_subskill: 'ss1',
          question_options: [{ key: 'A', text: '1' }],
          question_correct_answer: 'A',
          outcome: 'incorrect',
          is_correct: false,
          answered_at: '2026-03-12T09:00:00.000Z',
          status: 'answered',
          user_id: 'student-1',
        },
        {
          id: 'item-b',
          session_id: 'session-b',
          question_id: 'q2',
          question_canonical_id: 'SATM1DEF456',
          question_stem: 'Q2',
          question_section: 'Math',
          question_difficulty: 'medium',
          question_domain: 'alg',
          question_skill: 's1',
          question_subskill: 'ss1',
          question_options: [{ key: 'A', text: '1' }],
          question_correct_answer: 'A',
          outcome: 'incorrect',
          is_correct: false,
          answered_at: '2026-03-12T10:00:00.000Z',
          status: 'answered',
          user_id: 'student-1',
        },
      ],
      fullLengthRows: [],
      reviewRows: [],
    });

    const { res, getStatus, getBody } = makeRes();
    const req: any = { user: { id: 'student-1' }, query: { mode: 'by_practice_session', practice_session_id: 'session-a' } };

    await getReviewErrors(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().reviewQueue.map((item: any) => item.questionId)).toEqual(['q1']);
  });

  it('filters queue to a single full-length session when mode=by_full_length_session', async () => {
    setupSupabase({
      practiceSessionItemRows: [],
      fullLengthRows: [
        {
          id: 'f1',
          session_id: 'full-a',
          module_id: 'module-a',
          question_id: 'q10',
          is_correct: false,
          answered_at: '2026-03-12T12:00:00.000Z',
        },
        {
          id: 'f2',
          session_id: 'full-b',
          module_id: 'module-b',
          question_id: 'q11',
          is_correct: false,
          answered_at: '2026-03-12T13:00:00.000Z',
        },
      ],
      fullLengthQuestionRows: [
        {
          module_id: 'module-a',
          question_id: 'q10',
          question_canonical_id: 'SATM1GHI789',
          question_stem: 'Q10',
          question_section: 'Math',
          question_options: [{ key: 'A', text: '1' }],
          question_correct_answer: 'A',
        },
        {
          module_id: 'module-b',
          question_id: 'q11',
          question_canonical_id: 'SATM1JKL012',
          question_stem: 'Q11',
          question_section: 'RW',
          question_options: [{ key: 'A', text: '1' }],
          question_correct_answer: 'A',
        },
      ],
      reviewRows: [],
    });

    const { res, getStatus, getBody } = makeRes();
    const req: any = { user: { id: 'student-1' }, query: { mode: 'by_full_length_session', full_length_session_id: 'full-a' } };

    await getReviewErrors(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().reviewQueue.map((item: any) => item.questionId)).toEqual(['q10']);
  });
});
