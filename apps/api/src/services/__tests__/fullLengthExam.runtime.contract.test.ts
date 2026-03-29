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
} from '../fullLengthExam';

function buildQueryResult<T>(data: T, error: unknown = null) {
  const chain: any = {};
  chain.returns = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: T; error: unknown }) => void, reject: (reason: unknown) => void) =>
    Promise.resolve({ data, error }).then(resolve, reject);
  return chain;
}

function buildPublishedFormFixture(formId: string) {
  const formItems: Array<{
    section: 'rw' | 'math';
    module_index: 1 | 2;
    ordinal: number;
    question_id: string;
  }> = [];

  const questionRows: Array<{
    id: string;
    canonical_id: string;
    status: string;
    question_type: string;
    section_code: string;
    section: string;
    stem: string;
    options: Array<{ key: string; text: string }>;
    difficulty: number;
    domain: string;
    skill: string;
    subskill: string;
    source_type: number;
    diagram_present: boolean;
    tags: string[];
    competencies: any[];
    answer_choice: string;
    answer: string;
    answer_text: string;
    explanation: string;
    exam: string;
    structure_cluster_id: null;
  }> = [];

  const addModule = (section: 'rw' | 'math', moduleIndex: 1 | 2, count: number) => {
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      const canonicalId = `${section.toUpperCase()}_${moduleIndex}_${String(ordinal).padStart(2, '0')}`;
      formItems.push({
        section,
        module_index: moduleIndex,
        ordinal,
        question_id: canonicalId,
      });
      questionRows.push({
        id: `q_${canonicalId}`,
        canonical_id: canonicalId,
        status: 'published',
        question_type: 'multiple_choice',
        section_code: section === 'rw' ? 'RW' : 'MATH',
        section: section === 'rw' ? 'RW' : 'Math',
        stem: `Q${canonicalId}`,
        options: [
          { key: 'A', text: 'A' },
          { key: 'B', text: 'B' },
          { key: 'C', text: 'C' },
          { key: 'D', text: 'D' },
        ],
        difficulty: 2,
        domain: 'Domain',
        skill: 'Skill',
        subskill: 'Subskill',
        source_type: 0,
        diagram_present: false,
        tags: [],
        competencies: [],
        answer_choice: 'A',
        answer: 'A',
        answer_text: 'Answer',
        explanation: 'Because',
        exam: 'SAT',
        structure_cluster_id: null,
      });
    }
  };

  addModule('rw', 1, 27);
  addModule('rw', 2, 27);
  addModule('math', 1, 22);
  addModule('math', 2, 22);

  return {
    form: {
      id: formId,
      status: 'published',
      published_at: '2026-03-14T00:00:00.000Z',
      created_at: '2026-03-14T00:00:00.000Z',
    },
    formItems,
    questionRows,
  };
}

describe('Full-Length Runtime Contract Additions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed when no modeled score table exists for totalQuestions', () => {
    expect(() => calculateScaledScore(5, 12)).toThrow('Missing modeled score table');
  });

  it('accepts a published DB-backed form id and materializes fixed item order (no hardcoded single-form gate)', async () => {
    const formId = '22222222-2222-4222-8222-222222222222';
    const fixture = buildPublishedFormFixture(formId);

    const insertedSessionQuestions: Array<{ module_id: string; question_id: string; order_index: number }> = [];

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: {
                    id: 'session-form-1',
                    user_id: 'student-1',
                    status: 'not_started',
                    test_form_id: formId,
                    client_instance_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                  },
                  error: null,
                })),
              })),
            })),
          };
        }

        if (table === 'test_forms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: fixture.form, error: null })),
              })),
            })),
          };
        }

        if (table === 'test_form_items') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  order: vi.fn(() => ({
                    order: vi.fn(async () => ({ data: fixture.formItems, error: null })),
                  })),
                })),
              })),
            })),
          };
        }

        if (table === 'questions') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => buildQueryResult(fixture.questionRows)),
            })),
          };
        }

        if (table === 'full_length_exam_modules') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(async () => ({
                data: [
                  { id: 'mod-rw-1', section: 'rw', module_index: 1 },
                  { id: 'mod-rw-2', section: 'rw', module_index: 2 },
                  { id: 'mod-math-1', section: 'math', module_index: 1 },
                  { id: 'mod-math-2', section: 'math', module_index: 2 },
                ],
                error: null,
              })),
            })),
          };
        }

        if (table === 'full_length_exam_questions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((column: string, value: string) => {
                const chain: any = {
                  then: (resolve: any, reject: any) => {
                    const data = column === 'module_id'
                      ? insertedSessionQuestions
                          .filter((row) => row.module_id === value)
                          .map((row, idx) => ({ id: row.id ?? `row-${idx}` }))
                      : [];
                    return Promise.resolve({ data, error: null }).then(resolve, reject);
                  },
                };
                return chain;
              }),
            })),
            insert: vi.fn(async (rows: Array<{ module_id: string; question_id: string; order_index: number }>) => {
              insertedSessionQuestions.push(...rows);
              return { error: null };
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase as any);

    const result = await createExamSession({
      userId: 'student-1',
      testFormId: formId,
      clientInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    expect(result.test_form_id).toBe(formId);
    expect(insertedSessionQuestions.length).toBe(49);

    const rw1 = insertedSessionQuestions.filter((row) => row.module_id === 'mod-rw-1');
    expect(rw1.length).toBe(27);
    expect(rw1[0].order_index).toBe(0);
    expect(rw1[1].order_index).toBe(1);
    expect(rw1[0].question_id).toBe('q_RW_1_01');
    expect(rw1[26].question_id).toBe('q_RW_1_27');

    const math2 = insertedSessionQuestions.filter((row) => row.module_id === 'mod-math-2');
    expect(math2.length).toBe(0);
  });
  it('replays an active session without re-materializing questions (no reshuffle on resume/replay)', async () => {
    const formId = '66666666-6666-4666-8666-666666666666';
    let questionInsertCalled = false;

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
                          id: 'session-replay-1',
                          user_id: 'student-replay-1',
                          status: 'in_progress',
                          test_form_id: formId,
                          client_instance_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                        },
                        error: null,
                      })),
                    })),
                  })),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(async () => ({ error: null })),
                })),
              })),
            })),
          };
        }

        if (table === 'full_length_exam_questions') {
          return {
            insert: vi.fn(async () => {
              questionInsertCalled = true;
              return { error: null };
            }),
          };
        }

        throw new Error('Unexpected table ' + table);
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase as any);

    const result = await createExamSession({
      userId: 'student-replay-1',
      testFormId: formId,
      clientInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    expect(result.id).toBe('session-replay-1');
    expect(questionInsertCalled).toBe(false);
  });

  it('rejects draft test forms on session start', async () => {
    const formId = '33333333-3333-4333-8333-333333333333';

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                    })),
                  })),
                })),
              })),
            })),
          };
        }

        if (table === 'test_forms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: formId,
                    status: 'draft',
                    published_at: null,
                    created_at: '2026-03-14T00:00:00.000Z',
                  },
                  error: null,
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
      createExamSession({ userId: 'student-draft-1', testFormId: formId })
    ).rejects.toThrow('Test form is not published');
  });

  it('rejects missing test forms on session start', async () => {
    const formId = '44444444-4444-4444-8444-444444444444';

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                    })),
                  })),
                })),
              })),
            })),
          };
        }

        if (table === 'test_forms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase as any);

    await expect(
      createExamSession({ userId: 'student-missing-form-1', testFormId: formId })
    ).rejects.toThrow('Test form not found');
  });

  it('denies active-session replay from a different client_instance_id', async () => {
    const formId = '55555555-5555-4555-8555-555555555555';

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
                          test_form_id: formId,
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
        testFormId: formId,
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

