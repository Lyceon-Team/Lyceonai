import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import * as fullLengthExamService from '../fullLengthExam';

interface MockSupabaseClient {
  from: Mock;
}

vi.mock('../../lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

describe('Full-Length Exam Contract Closure', () => {
  it('calculateScaledScore is deterministic and SAT-bounded', () => {
    const first = fullLengthExamService.calculateScaledScore(37, 54);
    const second = fullLengthExamService.calculateScaledScore(37, 54);

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(200);
    expect(first).toBeLessThanOrEqual(800);

    expect(fullLengthExamService.calculateScaledScore(0, 54)).toBe(200);
    expect(fullLengthExamService.calculateScaledScore(54, 54)).toBe(800);
  });

  it('completeExam emits internally consistent raw/scaled/domain/skill outputs', async () => {
    const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

    const session = {
      id: 'session-contract-1',
      user_id: 'student-1',
      status: 'in_progress',
      current_section: 'math',
      current_module: 2,
    };

    const completedAtIso = new Date('2026-01-10T10:00:00.000Z').toISOString();

    const mathModule2 = {
      id: 'module-math-2',
      session_id: 'session-contract-1',
      section: 'math',
      module_index: 2,
      status: 'submitted',
    };

    const modules = [
      { id: 'module-rw-1', section: 'rw', module_index: 1 },
      { id: 'module-rw-2', section: 'rw', module_index: 2 },
      { id: 'module-math-1', section: 'math', module_index: 1 },
      { id: 'module-math-2', section: 'math', module_index: 2 },
    ];

    const responsesByModule: Record<string, Array<{ question_id: string; is_correct: boolean }>> = {
      'module-rw-1': [
        { question_id: 'q-rw-1', is_correct: true },
        { question_id: 'q-rw-2', is_correct: false },
      ],
      'module-rw-2': [
        { question_id: 'q-rw-3', is_correct: false },
      ],
      'module-math-1': [
        { question_id: 'q-math-1', is_correct: true },
        { question_id: 'q-math-2', is_correct: true },
      ],
      'module-math-2': [
        { question_id: 'q-math-3', is_correct: false },
        { question_id: 'q-math-4', is_correct: true },
      ],
    };

    const moduleQuestionsByModule: Record<string, Array<{ id: string }>> = {
      'module-rw-1': Array.from({ length: 27 }, (_, idx) => ({ id: `mq-rw-1-${idx + 1}` })),
      'module-rw-2': Array.from({ length: 27 }, (_, idx) => ({ id: `mq-rw-2-${idx + 1}` })),
      'module-math-1': Array.from({ length: 22 }, (_, idx) => ({ id: `mq-math-1-${idx + 1}` })),
      'module-math-2': Array.from({ length: 22 }, (_, idx) => ({ id: `mq-math-2-${idx + 1}` })),
    };

    const moduleQuestionsFlat = [
      ...Array.from({ length: 27 }, (_, idx) => ({
        module_id: 'module-rw-1',
        question_id: idx === 0 ? 'q-rw-1' : idx === 1 ? 'q-rw-2' : `q-rw-1-extra-${idx + 1}`,
      })),
      ...Array.from({ length: 27 }, (_, idx) => ({
        module_id: 'module-rw-2',
        question_id: idx === 0 ? 'q-rw-3' : idx === 1 ? 'q-rw-4' : `q-rw-2-extra-${idx + 1}`,
      })),
      ...Array.from({ length: 22 }, (_, idx) => ({
        module_id: 'module-math-1',
        question_id: idx === 0 ? 'q-math-1' : idx === 1 ? 'q-math-2' : `q-math-1-extra-${idx + 1}`,
      })),
      ...Array.from({ length: 22 }, (_, idx) => ({
        module_id: 'module-math-2',
        question_id: idx === 0 ? 'q-math-3' : idx === 1 ? 'q-math-4' : `q-math-2-extra-${idx + 1}`,
      })),
    ];

    const responsesBySession = Object.entries(responsesByModule).flatMap(([moduleId, rows]) =>
      rows.map((row) => ({ module_id: moduleId, question_id: row.question_id, is_correct: row.is_correct }))
    );

    const questionMetadata = [
      { id: 'q-rw-1', classification: { topic: 'Information and Ideas', subtopic: 'Central Ideas' }, unit_tag: 'Info', tags: null, competencies: null },
      { id: 'q-rw-2', classification: { topic: 'Information and Ideas', subtopic: 'Command of Evidence' }, unit_tag: 'Info', tags: null, competencies: null },
      { id: 'q-rw-3', classification: { topic: 'Craft and Structure', subtopic: 'Words in Context' }, unit_tag: 'Craft', tags: null, competencies: null },
      { id: 'q-rw-4', classification: { topic: 'Craft and Structure', subtopic: 'Text Structure' }, unit_tag: 'Craft', tags: null, competencies: null },
      { id: 'q-math-1', classification: { topic: 'Algebra', subtopic: 'Linear Equations' }, unit_tag: 'Algebra', tags: null, competencies: null },
      { id: 'q-math-2', classification: { topic: 'Algebra', subtopic: 'Linear Functions' }, unit_tag: 'Algebra', tags: null, competencies: null },
      { id: 'q-math-3', classification: { topic: 'Advanced Math', subtopic: 'Polynomials' }, unit_tag: 'Advanced Math', tags: null, competencies: null },
      { id: 'q-math-4', classification: { topic: 'Advanced Math', subtopic: 'Exponential Models' }, unit_tag: 'Advanced Math', tags: null, competencies: null },
    ];

    const mockSupabase: MockSupabaseClient = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: session,
                    error: null,
                  })),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  neq: vi.fn(() => ({
                    select: vi.fn(async () => ({
                      data: [{ ...session, status: 'completed', completed_at: completedAtIso }],
                      error: null,
                    })),
                  })),
                })),
              })),
            })),
          };
        }

        if (table === 'full_length_exam_modules') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((field: string, value: string) => {
                if (field === 'session_id') {
                  return {
                    eq: vi.fn((field2: string, value2: string) => {
                      if (field2 === 'section' && value2 === 'math') {
                        return {
                          eq: vi.fn(() => ({
                            single: vi.fn(async () => ({
                              data: mathModule2,
                              error: null,
                            })),
                          })),
                        };
                      }

                      return {
                        eq: vi.fn(() => ({
                          single: vi.fn(async () => ({ data: null, error: { message: 'not found' } })),
                        })),
                      };
                    }),
                    order: vi.fn(() => ({
                      order: vi.fn(async () => ({ data: modules, error: null })),
                    })),
                  };
                }

                return {
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      single: vi.fn(async () => ({ data: null, error: { message: 'not found' } })),
                    })),
                  })),
                };
              }),
            })),
          };
        }

        if (table === 'full_length_exam_responses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((field: string, value: string) => {
                if (field === 'module_id') {
                  return Promise.resolve({
                    data: responsesByModule[value] || [],
                    error: null,
                  });
                }

                if (field === 'session_id') {
                  return Promise.resolve({
                    data: responsesBySession,
                    error: null,
                  });
                }

                return Promise.resolve({ data: [], error: null });
              }),
            })),
          };
        }

        if (table === 'full_length_exam_questions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((field: string, value: string) => {
                if (field === 'module_id') {
                  return Promise.resolve({
                    data: moduleQuestionsByModule[value] || [],
                    error: null,
                  });
                }
                return Promise.resolve({ data: [], error: null });
              }),
              in: vi.fn(async () => ({
                data: moduleQuestionsFlat,
                error: null,
              })),
            })),
          };
        }

        if (table === 'questions') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async (_field: string, ids: string[]) => ({
                data: questionMetadata.filter((q) => ids.includes(q.id)),
                error: null,
              })),
            })),
          };
        }

        if (table === 'full_length_exam_score_rollups') {
          return {
            upsert: vi.fn(async () => ({ error: null })),
          };
        }

        return { select: vi.fn() };
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

    const result = await fullLengthExamService.completeExam({
      sessionId: 'session-contract-1',
      userId: 'student-1',
    });

    const sumRwDomains = result.domainBreakdown.rw.reduce((sum, d) => sum + d.total, 0);
    const sumMathDomains = result.domainBreakdown.math.reduce((sum, d) => sum + d.total, 0);
    const sumRwSkills = result.skillDiagnostics.rw.reduce((sum, d) => sum + d.total, 0);
    const sumMathSkills = result.skillDiagnostics.math.reduce((sum, d) => sum + d.total, 0);

    expect(result.rawScore.rw.correct).toBe(result.rwScore.totalCorrect);
    expect(result.rawScore.math.correct).toBe(result.mathScore.totalCorrect);
    expect(result.rawScore.total.correct).toBe(result.overallScore.totalCorrect);

    expect(result.rawScore.rw.total).toBe(54);
    expect(result.rawScore.math.total).toBe(44);
    expect(result.rawScore.total.total).toBe(98);

    expect(result.scaledScore.rw).toBe(fullLengthExamService.calculateScaledScore(result.rawScore.rw.correct, result.rawScore.rw.total));
    expect(result.scaledScore.math).toBe(fullLengthExamService.calculateScaledScore(result.rawScore.math.correct, result.rawScore.math.total));
    expect(result.scaledScore.total).toBe(result.scaledScore.rw + result.scaledScore.math);
    expect(result.overallScore.scaledTotal).toBe(result.scaledScore.total);

    expect(sumRwDomains).toBe(result.rawScore.rw.total);
    expect(sumMathDomains).toBe(result.rawScore.math.total);
    expect(sumRwSkills).toBe(result.rawScore.rw.total);
    expect(sumMathSkills).toBe(result.rawScore.math.total);
  });

  it('duplicate same-answer submission is idempotent (first write wins)', async () => {
    const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

    let responseLookupCount = 0;
    let insertCount = 0;

    const mockSupabase: MockSupabaseClient = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: {
                      id: 'session-idempotent-1',
                      status: 'in_progress',
                      current_section: 'rw',
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
                        id: 'module-rw-1',
                        status: 'in_progress',
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
                  single: vi.fn(async () => ({
                    data: {
                      id: 'mq-1',
                      question_id: '11111111-1111-4111-8111-111111111111',
                      question_type: 'multiple_choice',
                      question_correct_answer: 'A',
                    },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }

        if (table === 'full_length_exam_responses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => {
                      responseLookupCount += 1;
                      if (responseLookupCount === 1) {
                        return { data: null, error: null };
                      }
                      return { data: { id: 'existing-response', selected_answer: 'A' }, error: null };
                    }),
                  })),
                })),
              })),
            })),
            insert: vi.fn(async () => {
              insertCount += 1;
              return { error: null };
            }),
          };
        }

        if (table === 'questions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: {
                    id: 'q-1',
                    question_type: 'multiple_choice',
                    correct_answer: 'A',
                  },
                  error: null,
                })),
              })),
            })),
          };
        }

        return { select: vi.fn() };
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

    await fullLengthExamService.submitAnswer({
      sessionId: 'session-idempotent-1',
      userId: 'student-1',
      questionId: '11111111-1111-4111-8111-111111111111',
      selectedAnswer: 'A',
    });

    await fullLengthExamService.submitAnswer({
      sessionId: 'session-idempotent-1',
      userId: 'student-1',
      questionId: '11111111-1111-4111-8111-111111111111',
      selectedAnswer: 'A',
    });

    expect(responseLookupCount).toBe(2);
    expect(insertCount).toBe(1);
  });

  it('fails closed when duplicate submission replays with a different answer', async () => {
    const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

    let responseLookupCount = 0;
    let insertCount = 0;

    const mockSupabase: MockSupabaseClient = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: {
                      id: 'session-idempotent-2',
                      status: 'in_progress',
                      current_section: 'rw',
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
                        id: 'module-rw-1',
                        status: 'in_progress',
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
                  single: vi.fn(async () => ({
                    data: {
                      id: 'mq-1',
                      question_id: '11111111-1111-4111-8111-111111111111',
                      question_type: 'multiple_choice',
                      question_correct_answer: 'A',
                    },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }

        if (table === 'full_length_exam_responses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => {
                      responseLookupCount += 1;
                      if (responseLookupCount === 1) {
                        return { data: null, error: null };
                      }
                      return { data: { id: 'existing-response', selected_answer: 'A' }, error: null };
                    }),
                  })),
                })),
              })),
            })),
            insert: vi.fn(async () => {
              insertCount += 1;
              return { error: null };
            }),
          };
        }

        if (table === 'questions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: {
                    id: 'q-1',
                    question_type: 'multiple_choice',
                    correct_answer: 'A',
                  },
                  error: null,
                })),
              })),
            })),
          };
        }

        return { select: vi.fn() };
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

    await fullLengthExamService.submitAnswer({
      sessionId: 'session-idempotent-2',
      userId: 'student-1',
      questionId: '11111111-1111-4111-8111-111111111111',
      selectedAnswer: 'A',
    });

    await expect(
      fullLengthExamService.submitAnswer({
        sessionId: 'session-idempotent-2',
        userId: 'student-1',
        questionId: '11111111-1111-4111-8111-111111111111',
        selectedAnswer: 'B',
      })
    ).rejects.toThrow('Answer already submitted with different selection');

    expect(responseLookupCount).toBe(2);
    expect(insertCount).toBe(1);
  });

  it('review remains locked until completion', async () => {
    const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

    const mockSupabase: MockSupabaseClient = {
      from: vi.fn((table: string) => {
        if (table === 'full_length_exam_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: { id: 'session-locked', status: 'in_progress' },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }

        return { select: vi.fn() };
      }),
    };

    (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

    await expect(
      fullLengthExamService.getExamReviewAfterCompletion({
        sessionId: 'session-locked',
        userId: 'student-1',
      })
    ).rejects.toThrow('Review locked until completion');
  });
});

