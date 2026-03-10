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

function setupSupabase(hasTutorContext: boolean) {
  fromMock.mockImplementation((table: string) => {
    if (table === 'questions') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: 'q-1',
                canonical_id: 'cq-1',
                type: 'mc',
                answer_choice: 'A',
                answer_text: null,
              },
              error: null,
            }),
          }),
        }),
      };
    }

    if (table === 'review_error_attempts') {
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 'retry-1', is_correct: true },
              error: null,
            }),
          }),
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: 'retry-1', is_correct: true },
                error: null,
              }),
            }),
          }),
        }),
      };
    }

    if (table === 'tutor_interactions') {
      return {
        select: () => ({
          eq: () => ({
            contains: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: hasTutorContext ? { id: 'ti-1' } : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
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
      canonicalId: 'cq-1',
      exam: 'SAT',
      section: 'Math',
      domain: 'algebra',
      skill: 'linear_equations',
      subskill: null,
      difficulty_bucket: 'medium',
      structure_cluster_id: null,
    });
  });

  it('applies TUTOR_RETRY_SUBMIT when tutor context exists and retry is verified', async () => {
    setupSupabase(true);
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

    const call = applyMasteryUpdateMock.mock.calls[0][0];
    expect(call.eventType).toBe(MasteryEventType.TUTOR_RETRY_SUBMIT);
    expect(call.isCorrect).toBe(true);

    const response = getBody();
    expect(response.masteryApplied).toBe(true);
    expect(response.masteryEvent).toBe(MasteryEventType.TUTOR_RETRY_SUBMIT);
  });

  it('does not apply mastery update when no tutor context exists', async () => {
    setupSupabase(false);
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
    expect(applyMasteryUpdateMock).not.toHaveBeenCalled();

    const response = getBody();
    expect(response.masteryApplied).toBe(false);
    expect(response.masteryEvent).toBeNull();
  });
});
