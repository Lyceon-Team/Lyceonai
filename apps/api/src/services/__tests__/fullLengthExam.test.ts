/**
 * Full-Length Exam Service Tests (canonical questions contract)
 */

import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import * as fullLengthExamService from '../fullLengthExam';

interface MockSupabaseClient {
  from: Mock;
}

vi.mock('../../lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

describe('Full-Length Exam Service', () => {
  it('createExamSession returns existing active session instead of creating duplicate', async () => {
    const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

    const mockExistingSession = {
      id: 'existing-session-123',
      user_id: 'user-456',
      status: 'not_started',
      seed: 'user-456_1234567890',
      created_at: new Date().toISOString(),
    };

    const mockSupabase: MockSupabaseClient = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({ data: mockExistingSession, error: null })),
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: null, error: new Error('should not insert') })),
              })),
            })),
          };
        }

        return { select: vi.fn() };
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

    const result = await fullLengthExamService.createExamSession({ userId: 'user-456' });

    expect(result.id).toBe('existing-session-123');
    expect(result.status).toBe('not_started');
  });

  it('submitAnswer grades against correct_answer for multiple_choice only', async () => {
    const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

    const upsertSpy = vi.fn(async () => ({ error: null }));

    const mockSupabase: MockSupabaseClient = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: {
                      id: 'session-1',
                      status: 'in_progress',
                      current_section: 'math',
                      current_module: 1,
                    },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }

        if (table === 'full_length_exam_modules') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: {
                        id: 'module-1',
                        status: 'in_progress',
                        started_at: new Date(Date.now() - 1000).toISOString(),
                        target_duration_ms: 1000 * 60,
                      },
                      error: null,
                    })),
                  })),
                })),
              })),
            })),
          };
        }

        if (table === 'full_length_exam_questions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: { id: 'mq-1' }, error: null })),
                })),
              })),
            })),
          };
        }

        if (table === 'questions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: 'q-1', question_type: 'multiple_choice', correct_answer: 'B' },
                  error: null,
                })),
              })),
            })),
          };
        }

        if (table === 'full_length_exam_responses') {
          return { upsert: upsertSpy };
        }

        return { select: vi.fn() };
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

    await fullLengthExamService.submitAnswer({
      sessionId: 'session-1',
      userId: 'user-1',
      questionId: 'q-1',
      selectedAnswer: 'B',
    });

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const payload = upsertSpy.mock.calls[0][0];
    expect(payload.selected_answer).toBe('B');
    expect(payload.is_correct).toBe(true);
  });

  it('review field allowlists use canonical question keys', () => {
    expect(fullLengthExamService.SAFE_QUESTION_FIELDS_PRE_COMPLETION).toContain('question_type');
    expect(fullLengthExamService.SAFE_QUESTION_FIELDS_PRE_COMPLETION).toContain('skill_code');
    expect(fullLengthExamService.SAFE_QUESTION_FIELDS_PRE_COMPLETION).not.toContain('type');

    expect(fullLengthExamService.ANSWER_FIELDS_POST_COMPLETION).toContain('correct_answer');
    expect(fullLengthExamService.ANSWER_FIELDS_POST_COMPLETION).not.toContain('answer');
  });
});