import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  fromMock,
  applyMasteryUpdateMock,
  getQuestionMetadataForAttemptMock,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  applyMasteryUpdateMock: vi.fn(),
  getQuestionMetadataForAttemptMock: vi.fn(),
}));

vi.mock('../apps/api/src/lib/supabase-server', () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

vi.mock('../apps/api/src/services/studentMastery', () => ({
  applyMasteryUpdate: applyMasteryUpdateMock,
  getQuestionMetadataForAttempt: getQuestionMetadataForAttemptMock,
}));

import { recordReviewErrorAttempt } from '../server/routes/review-errors-routes';
import { MasteryEventType } from '../apps/api/src/services/mastery-constants';

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

function setupSupabase(options: {
  hasTutorContext: boolean;
  eligibleReviewSource: boolean;
  eligibleFromFullTest?: boolean;
  insertError?: { code?: string; message?: string } | null;
  existingAttemptQuestionId?: string;
}) {
  const attemptTimestamp = '2026-03-10T10:00:00.000Z';

  fromMock.mockImplementation((table: string) => {
    if (table === 'answer_attempts') {
      const chain: any = {
        eq: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          data: options.eligibleReviewSource
            ? { id: 'source-1', attempted_at: attemptTimestamp, outcome: 'incorrect', is_correct: false }
            : null,
          error: null,
        }),
      };

      return {
        select: () => chain,
      };
    }

    if (table === 'full_length_exam_responses') {
      const chain: any = {
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          data: options.eligibleFromFullTest
            ? { id: 'flr-1', answered_at: '2026-03-10T10:10:00.000Z', is_correct: false }
            : null,
          error: null,
        }),
      };

      return {
        select: () => chain,
      };
    }

    if (table === 'questions') {
      const chain: any = {
        eq: () => chain,
        single: async () => ({
          data: {
            id: 'q-1',
            canonical_id: 'SATM1ABC123',
            status: 'published',
            question_type: 'multiple_choice',
            correct_answer: 'A',
            answer_text: null,
            explanation: 'Because A is correct.',
            options: [
              { key: 'A', text: 'A' },
              { key: 'B', text: 'B' },
              { key: 'C', text: 'C' },
              { key: 'D', text: 'D' },
            ],
          },
          error: null,
        }),
      };

      return {
        select: () => chain,
      };
    }

    if (table === 'review_error_attempts') {
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: options.insertError ? null : { id: 'retry-1', question_id: 'q-1', is_correct: true },
              error: options.insertError ?? null,
            }),
          }),
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'retry-1',
                  question_id: options.existingAttemptQuestionId ?? 'q-1',
                  is_correct: true,
                },
                error: null,
              }),
            }),
          }),
        }),
      };
    }

    if (table === 'tutor_interactions') {
      const chain: any = {
        eq: () => chain,
        contains: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          data: options.hasTutorContext ? { id: 'ti-1', created_at: '2026-03-10T10:05:00.000Z' } : null,
          error: null,
        }),
      };

      return {
        select: () => chain,
      };
    }

    throw new Error(`Unexpected table mock request: ${table}`);
  });
}

describe('Review Error -> Canonical Mastery Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyMasteryUpdateMock.mockResolvedValue({
      attemptId: 'm-1',
      rollupUpdated: true,
      error: undefined,
    });
    getQuestionMetadataForAttemptMock.mockResolvedValue({
      canonicalId: 'SATM1ABC123',
      exam: 'SAT',
      section: 'Math',
      domain: 'algebra',
      skill: 'linear_equations',
      subskill: null,
      skill_code: 'ALG-1',
      difficulty: 2,
      structure_cluster_id: null,
    });
  });

  it('emits REVIEW_PASS when retry is correct without tutor context', async () => {
    setupSupabase({ hasTutorContext: false, eligibleReviewSource: true });
    const { res, getStatus, getBody } = makeRes();

    const req: any = {
      user: { id: 'student-1' },
      body: {
        question_id: 'q-1',
        selected_answer: 'A',
        source_context: 'review_errors',
      },
    };

    await recordReviewErrorAttempt(req, res);

    expect(getStatus()).toBe(200);
    expect(applyMasteryUpdateMock).toHaveBeenCalledTimes(1);
    expect(applyMasteryUpdateMock.mock.calls[0][0].eventType).toBe(MasteryEventType.REVIEW_PASS);

    const response = getBody();
    expect(response.reviewOutcome).toBe('review_pass');
    expect(response.tutorVerifiedRetry).toBe(false);
    expect(response.tutorOutcome).toBeNull();
    expect(response.masteryEvents).toEqual([MasteryEventType.REVIEW_PASS]);
  });

  it('emits REVIEW_FAIL when retry is incorrect without tutor context', async () => {
    setupSupabase({ hasTutorContext: false, eligibleReviewSource: true });
    const { res, getStatus, getBody } = makeRes();

    const req: any = {
      user: { id: 'student-1' },
      body: {
        question_id: 'q-1',
        selected_answer: 'B',
        source_context: 'review_errors',
      },
    };

    await recordReviewErrorAttempt(req, res);

    expect(getStatus()).toBe(200);
    expect(applyMasteryUpdateMock).toHaveBeenCalledTimes(1);
    expect(applyMasteryUpdateMock.mock.calls[0][0].eventType).toBe(MasteryEventType.REVIEW_FAIL);

    const response = getBody();
    expect(response.reviewOutcome).toBe('review_fail');
    expect(response.masteryEvents).toEqual([MasteryEventType.REVIEW_FAIL]);
  });

  it('emits paired REVIEW_PASS + TUTOR_HELPED events on verified tutor retry success', async () => {
    setupSupabase({ hasTutorContext: true, eligibleReviewSource: true });
    const { res, getStatus, getBody } = makeRes();

    const req: any = {
      user: { id: 'student-1' },
      body: {
        question_id: 'q-1',
        selected_answer: 'A',
        source_context: 'review_errors',
      },
    };

    await recordReviewErrorAttempt(req, res);

    expect(getStatus()).toBe(200);
    expect(applyMasteryUpdateMock).toHaveBeenCalledTimes(2);
    expect(applyMasteryUpdateMock.mock.calls[0][0].eventType).toBe(MasteryEventType.REVIEW_PASS);
    expect(applyMasteryUpdateMock.mock.calls[1][0].eventType).toBe(MasteryEventType.TUTOR_HELPED);

    const response = getBody();
    expect(response.reviewOutcome).toBe('review_pass');
    expect(response.tutorVerifiedRetry).toBe(true);
    expect(response.tutorOutcome).toBe('tutor_helped');
    expect(response.masteryEvents).toEqual([MasteryEventType.REVIEW_PASS, MasteryEventType.TUTOR_HELPED]);
  });

  it('emits paired REVIEW_FAIL + TUTOR_FAIL events on verified tutor retry failure', async () => {
    setupSupabase({ hasTutorContext: true, eligibleReviewSource: true });
    const { res, getStatus, getBody } = makeRes();

    const req: any = {
      user: { id: 'student-1' },
      body: {
        question_id: 'q-1',
        selected_answer: 'D',
        source_context: 'review_errors',
      },
    };

    await recordReviewErrorAttempt(req, res);

    expect(getStatus()).toBe(200);
    expect(applyMasteryUpdateMock).toHaveBeenCalledTimes(2);
    expect(applyMasteryUpdateMock.mock.calls[0][0].eventType).toBe(MasteryEventType.REVIEW_FAIL);
    expect(applyMasteryUpdateMock.mock.calls[1][0].eventType).toBe(MasteryEventType.TUTOR_FAIL);

    const response = getBody();
    expect(response.reviewOutcome).toBe('review_fail');
    expect(response.tutorVerifiedRetry).toBe(true);
    expect(response.tutorOutcome).toBe('tutor_fail');
    expect(response.masteryEvents).toEqual([MasteryEventType.REVIEW_FAIL, MasteryEventType.TUTOR_FAIL]);
  });

  it('accepts completed full-test misses as review eligibility source', async () => {
    setupSupabase({ hasTutorContext: false, eligibleReviewSource: false, eligibleFromFullTest: true });
    const { res, getStatus, getBody } = makeRes();

    const req: any = {
      user: { id: 'student-1' },
      body: {
        question_id: 'q-1',
        selected_answer: 'A',
        source_context: 'review_errors',
      },
    };

    await recordReviewErrorAttempt(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().reviewOutcome).toBe('review_pass');
    expect(applyMasteryUpdateMock).toHaveBeenCalledTimes(1);
    expect(applyMasteryUpdateMock.mock.calls[0][0].eventType).toBe(MasteryEventType.REVIEW_PASS);
  });

  it('rejects mastery emission when question is not review-eligible (anti-inflation guard)', async () => {
    setupSupabase({ hasTutorContext: true, eligibleReviewSource: false, eligibleFromFullTest: false });
    const { res, getStatus, getBody } = makeRes();

    const req: any = {
      user: { id: 'student-1' },
      body: {
        question_id: 'q-1',
        selected_answer: 'A',
        source_context: 'review_errors',
      },
    };

    await recordReviewErrorAttempt(req, res);

    expect(getStatus()).toBe(403);
    expect(applyMasteryUpdateMock).not.toHaveBeenCalled();

    const response = getBody();
    expect(response.error).toContain('not eligible');
  });

  it('returns prior authoritative result on idempotent duplicate submit', async () => {
    setupSupabase({
      hasTutorContext: false,
      eligibleReviewSource: true,
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
      existingAttemptQuestionId: 'q-1',
    });
    const { res, getStatus, getBody } = makeRes();

    const req: any = {
      user: { id: 'student-1' },
      body: {
        question_id: 'q-1',
        selected_answer: 'A',
        source_context: 'review_errors',
        client_attempt_id: 'dup-key-1',
      },
    };

    await recordReviewErrorAttempt(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().idempotent).toBe(true);
    expect(applyMasteryUpdateMock).not.toHaveBeenCalled();
  });

  it('fails closed when idempotency key is replayed for a different question', async () => {
    setupSupabase({
      hasTutorContext: false,
      eligibleReviewSource: true,
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
      existingAttemptQuestionId: 'q-other',
    });
    const { res, getStatus, getBody } = makeRes();

    const req: any = {
      user: { id: 'student-1' },
      body: {
        question_id: 'q-1',
        selected_answer: 'A',
        source_context: 'review_errors',
        client_attempt_id: 'dup-key-1',
      },
    };

    await recordReviewErrorAttempt(req, res);

    expect(getStatus()).toBe(409);
    expect(getBody().code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(applyMasteryUpdateMock).not.toHaveBeenCalled();
  });
});
