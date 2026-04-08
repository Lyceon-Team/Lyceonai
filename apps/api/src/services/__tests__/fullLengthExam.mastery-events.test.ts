import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../mastery-write', () => ({
  applyLearningEventToMastery: vi.fn().mockResolvedValue({
    ok: true,
    error: undefined,
  }),
}));

import { getSupabaseAdmin } from '../../lib/supabase-admin';
import { applyLearningEventToMastery } from '../mastery-write';
import { submitModule } from '../fullLengthExam';

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
              eq: (k1: string, _v1: string) => {
                if (k1 === 'session_id') {
                  return {
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
                    then: (onfulfilled: (value: { data: Array<{ id: string }>; error: null }) => unknown) =>
                      Promise.resolve({ data: [{ id: 'module-1' }], error: null }).then(onfulfilled),
                  };
                }
                throw new Error(`Unexpected module select eq key: ${k1}`);
              },
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
              in: (_k1: string, _v1: any[]) => ({
                in: async (_k2: string, _v2: any[]) => ({
                  data: [{
                    question_id: 'q-1',
                    question_canonical_id: 'cq-1',
                    question_exam: 'SAT',
                    question_section: 'Math',
                    question_domain: 'algebra',
                    question_skill: 'linear_equations',
                    question_subskill: null,
                    question_difficulty: 'medium',
                    question_structure_cluster_id: null,
                  }],
                  error: null,
                }),
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

    const masteryCalls = (applyLearningEventToMastery as unknown as Mock).mock.calls;
    expect(masteryCalls.length).toBe(1);
    expect(masteryCalls[0][0]).toMatchObject({
      studentId: 'user-1',
      section: 'Math',
      domain: 'algebra',
      skill: 'linear_equations',
      difficulty: 2,
      sourceFamily: 'test',
      correct: true,
    });
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
              eq: (k1: string, _v1: string) => {
                if (k1 === 'session_id') {
                  const moduleRow = {
                    id: 'module-2',
                    status: 'submitted',
                    section: 'math',
                    module_index: 2,
                    ends_at: new Date(Date.now() + 60_000).toISOString(),
                  };
                  return {
                    eq: (_k2: string, _v2: string) => ({
                      eq: (_k3: string, _v3: number) => ({
                        single: async () => ({
                          data: moduleRow,
                          error: null,
                        }),
                      }),
                    }),
                    then: (onfulfilled: (value: { data: Array<{ id: string }>; error: null }) => unknown) =>
                      Promise.resolve({ data: [{ id: 'module-2' }], error: null }).then(onfulfilled),
                  };
                }
                throw new Error(`Unexpected module select eq key: ${k1}`);
              },
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
              in: (_k1: string, _v1: any[]) => ({
                in: async (_k2: string, _v2: any[]) => ({
                  data: [{
                    question_id: 'q-2',
                    question_canonical_id: 'cq-2',
                    question_exam: 'SAT',
                    question_section: 'Math',
                    question_domain: 'algebra',
                    question_skill: 'linear_equations',
                    question_subskill: null,
                    question_difficulty: 'medium',
                    question_structure_cluster_id: null,
                  }],
                  error: null,
                }),
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
    expect((applyLearningEventToMastery as unknown as Mock).mock.calls.length).toBe(0);
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
                    then: (onfulfilled: (value: { data: Array<{ id: string }>; error: null }) => unknown) =>
                      Promise.resolve({ data: [{ id: 'module-3' }], error: null }).then(onfulfilled),
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
              in: (_k1: string, _v1: any[]) => ({
                in: async (_k2: string, _v2: any[]) => ({
                  data: [{
                    question_id: 'q-3',
                    question_canonical_id: 'cq-3',
                    question_exam: 'SAT',
                    question_section: 'Math',
                    question_domain: 'algebra',
                    question_skill: 'linear_equations',
                    question_subskill: null,
                    question_difficulty: 'medium',
                    question_structure_cluster_id: null,
                  }],
                  error: null,
                }),
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
    expect((applyLearningEventToMastery as unknown as Mock).mock.calls.length).toBe(0);
  });

  it('skips mastery emission when difficulty bucket cannot be resolved', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: () => ({
              eq: (_k1: string, _v1: string) => ({
                eq: (_k2: string, _v2: string) => ({
                  single: async () => ({
                    data: {
                      id: 'session-4',
                      user_id: 'user-4',
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
                            id: 'module-4',
                            status: 'in_progress',
                            section: 'math',
                            module_index: 2,
                            ends_at: new Date(Date.now() + 60_000).toISOString(),
                          },
                          error: null,
                        }),
                      }),
                    }),
                    then: (onfulfilled: (value: { data: Array<{ id: string }>; error: null }) => unknown) =>
                      Promise.resolve({ data: [{ id: 'module-4' }], error: null }).then(onfulfilled),
                  };
                }
                throw new Error(`Unexpected module select eq key: ${k1}`);
              },
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: async () => ({
                    data: [{ id: 'module-4', status: 'submitted' }],
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
                  { question_id: 'q-4', is_correct: true },
                ],
                error: null,
              }),
            }),
          };
        }

        if (table === 'full_length_exam_questions') {
          return {
            select: () => ({
              in: (_k1: string, _v1: any[]) => ({
                in: async (_k2: string, _v2: any[]) => ({
                  data: [{
                    question_id: 'q-4',
                    question_canonical_id: 'cq-4',
                    question_exam: 'SAT',
                    question_section: 'Math',
                    question_domain: 'algebra',
                    question_skill: 'linear_equations',
                    question_subskill: null,
                    question_difficulty: 'unknown',
                    question_structure_cluster_id: null,
                  }],
                  error: null,
                }),
              }),
            }),
          };
        }

        throw new Error('Unexpected table: ' + table);
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase as any);

    const result = await submitModule({
      sessionId: 'session-4',
      userId: 'user-4',
    });

    expect(result.moduleId).toBe('module-4');
    expect(result.nextModule).toBeNull();
    expect((applyLearningEventToMastery as unknown as Mock).mock.calls.length).toBe(0);
  });
});
