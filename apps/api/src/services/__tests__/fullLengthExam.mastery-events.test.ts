import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../mastery-write', () => ({
  applyMasteryUpdate: vi.fn().mockResolvedValue({
    attemptId: 'm-1',
    rollupUpdated: true,
    error: undefined,
  }),
}));

import { getSupabaseAdmin } from '../../lib/supabase-admin';
import { applyMasteryUpdate } from '../mastery-write';
import { submitModule } from '../fullLengthExam';
import { MasteryEventType } from '../mastery-constants';

describe('Full-Length -> Canonical Mastery Event Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits test_pass event on module submission for correct answers', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: () => ({
              eq: (_k1: string, _v1: string) => ({
                eq: (_k2: string, _v2: string) => ({
                  single: async () => ({
                    data: {
                      id: 'session-1',
                      user_id: 'user-1',
                      status: 'in_progress',
                      current_section: 'math',
                      current_module: 2,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'full_length_exam_modules') {
          return {
            select: () => ({
              eq: (_k1: string, _v1: string) => ({
                eq: (_k2: string, _v2: string) => ({
                  eq: (_k3: string, _v3: number) => ({
                    single: async () => ({
                      data: {
                        id: 'module-1',
                        status: 'in_progress',
                        section: 'math',
                        module_index: 2,
                        ends_at: future,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: async () => ({
                    data: [{ id: 'module-1', status: 'submitted' }],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'full_length_exam_responses') {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  { question_id: 'q-1', is_correct: true },
                ],
                error: null,
              }),
            }),
          };
        }

        if (table === 'full_length_exam_questions') {
          return {
            select: () => ({
              eq: async () => ({
                data: [{ id: 'mq-1' }],
                error: null,
              }),
            }),
          };
        }

        if (table === 'questions') {
          return {
            select: () => ({
              in: async () => ({
                data: [{
                  id: 'q-1',
                  canonical_id: 'cq-1',
                  exam: 'SAT',
                  section: 'Math',
                  domain: 'algebra',
                  skill: 'linear_equations',
                  subskill: null,
                  difficulty_bucket: 'medium',
                  structure_cluster_id: null,
                }],
                error: null,
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase as any);

    const result = await submitModule({
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(result.moduleId).toBe('module-1');
    expect(result.nextModule).toBeNull();

    const masteryCalls = (applyMasteryUpdate as unknown as Mock).mock.calls;
    expect(masteryCalls.length).toBe(1);
    expect(masteryCalls[0][0].eventType).toBe(MasteryEventType.TEST_PASS);
    expect(masteryCalls[0][0].questionCanonicalId).toBe('cq-1');
  });

  it('does not emit duplicate mastery events when module submission is replayed', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: () => ({
              eq: (_k1: string, _v1: string) => ({
                eq: (_k2: string, _v2: string) => ({
                  single: async () => ({
                    data: {
                      id: 'session-2',
                      user_id: 'user-2',
                      status: 'in_progress',
                      current_section: 'math',
                      current_module: 2,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'full_length_exam_modules') {
          return {
            select: () => ({
              eq: (_k1: string, _v1: string) => ({
                eq: (_k2: string, _v2: string) => ({
                  eq: (_k3: string, _v3: number) => ({
                    single: async () => ({
                      data: {
                        id: 'module-2',
                        status: 'submitted',
                        section: 'math',
                        module_index: 2,
                        ends_at: new Date(Date.now() + 60_000).toISOString(),
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'full_length_exam_responses') {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  { question_id: 'q-2', is_correct: true },
                ],
                error: null,
              }),
            }),
          };
        }

        if (table === 'full_length_exam_questions') {
          return {
            select: () => ({
              eq: async () => ({
                data: [{ id: 'mq-2' }],
                error: null,
              }),
            }),
          };
        }

        throw new Error('Unexpected table: ' + table);
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase as any);

    const result = await submitModule({
      sessionId: 'session-2',
      userId: 'user-2',
    });

    expect(result.moduleId).toBe('module-2');
    expect(result.nextModule).toBeNull();
    expect((applyMasteryUpdate as unknown as Mock).mock.calls.length).toBe(0);
  });

  it('does not emit duplicate mastery events when submit loses status race', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: () => ({
              eq: (_k1: string, _v1: string) => ({
                eq: (_k2: string, _v2: string) => ({
                  single: async () => ({
                    data: {
                      id: 'session-3',
                      user_id: 'user-3',
                      status: 'in_progress',
                      current_section: 'math',
                      current_module: 2,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'full_length_exam_modules') {
          return {
            select: () => ({
              eq: (k1: string, _v1: string) => {
                if (k1 === 'session_id') {
                  return {
                    eq: (_k2: string, _v2: string) => ({
                      eq: (_k3: string, _v3: number) => ({
                        single: async () => ({
                          data: {
                            id: 'module-3',
                            status: 'in_progress',
                            section: 'math',
                            module_index: 2,
                            ends_at: new Date(Date.now() + 60_000).toISOString(),
                          },
                          error: null,
                        }),
                      }),
                    }),
                  };
                }

                if (k1 === 'id') {
                  return {
                    single: async () => ({
                      data: {
                        id: 'module-3',
                        status: 'submitted',
                        section: 'math',
                        module_index: 2,
                        ends_at: new Date(Date.now() + 60_000).toISOString(),
                      },
                      error: null,
                    }),
                  };
                }

                throw new Error(`Unexpected module select eq key: ${k1}`);
              },
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: async () => ({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'full_length_exam_responses') {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  { question_id: 'q-3', is_correct: true },
                ],
                error: null,
              }),
            }),
          };
        }

        if (table === 'full_length_exam_questions') {
          return {
            select: () => ({
              eq: async () => ({
                data: [{ id: 'mq-3' }],
                error: null,
              }),
            }),
          };
        }

        if (table === 'questions') {
          return {
            select: () => ({
              in: async () => ({
                data: [{
                  id: 'q-3',
                  canonical_id: 'cq-3',
                  exam: 'SAT',
                  section: 'Math',
                  domain: 'algebra',
                  skill: 'linear_equations',
                  subskill: null,
                  difficulty_bucket: 'medium',
                  structure_cluster_id: null,
                }],
                error: null,
              }),
            }),
          };
        }

        throw new Error('Unexpected table: ' + table);
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase as any);

    const result = await submitModule({
      sessionId: 'session-3',
      userId: 'user-3',
    });

    expect(result.moduleId).toBe('module-3');
    expect(result.nextModule).toBeNull();
    expect((applyMasteryUpdate as unknown as Mock).mock.calls.length).toBe(0);
  });
});
