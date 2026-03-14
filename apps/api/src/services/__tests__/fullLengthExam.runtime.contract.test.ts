import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from '../../lib/supabase-admin';
import {
  calculateScaledScore,
  createExamSession,
  startExam,
  CANONICAL_FULL_TEST_FORM_ID,
} from '../fullLengthExam';

describe('Full-Length Runtime Contract Additions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed when no modeled score table exists for totalQuestions', () => {
    expect(() => calculateScaledScore(5, 12)).toThrow('Missing modeled score table');
  });

  it('rejects unsupported test_form_id on session start', async () => {
    await expect(
      createExamSession({
        userId: 'student-form-1',
        testFormId: '11111111-1111-4111-8111-111111111111',
      })
    ).rejects.toThrow('Unsupported test form');
  });

  it('denies active-session replay from a different client_instance_id', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data: {
                          id: 'session-conflict-1',
                          user_id: 'student-conflict-1',
                          status: 'in_progress',
                          test_form_id: CANONICAL_FULL_TEST_FORM_ID,
                          client_instance_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                        },
                        error: null,
                      })),
                    })),
                  })),
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase as any);

    await expect(
      createExamSession({
        userId: 'student-conflict-1',
        testFormId: CANONICAL_FULL_TEST_FORM_ID,
        clientInstanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      })
    ).rejects.toThrow('Session client instance conflict');
  });

  it('emits test_started observability event', async () => {
    const eventInsert = vi.fn(async () => ({ error: null }));

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: {
                      id: 'session-start-1',
                      user_id: 'student-start-1',
                      status: 'not_started',
                      client_instance_id: null,
                    },
                    error: null,
                  })),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
          };
        }

        if (table === 'system_event_logs') {
          return {
            insert: eventInsert,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase as any);

    await startExam('session-start-1', 'student-start-1');

    expect(eventInsert).toHaveBeenCalledTimes(1);
    expect(eventInsert.mock.calls[0][0]).toMatchObject({
      event_type: 'test_started',
      session_id: 'session-start-1',
      user_id: 'student-start-1',
    });
  });
});
