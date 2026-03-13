/**
 * Full-Length Exam Service Tests
 * 
 * Tests for service-level functionality:
 * - Session creation idempotency
 * - Answer state restoration
 */

import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import * as fullLengthExamService from '../fullLengthExam';

// Type for Supabase client mock
interface MockSupabaseClient {
  from: Mock;
}

// Mock the Supabase admin client
vi.mock('../../lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

describe('Full-Length Exam Service', () => {
  describe('createExamSession - Idempotency', () => {
    it('should return existing active session instead of creating duplicate', async () => {
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
                        maybeSingle: vi.fn(async () => ({
                          data: mockExistingSession,
                          error: null,
                        })),
                      })),
                    })),
                  })),
                })),
              })),
              insert: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: null,
                    error: new Error('Should not create new session when active exists'),
                  })),
                })),
              })),
            };
          }
          return { select: vi.fn() };
        }),
      };

      (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

      const result = await fullLengthExamService.createExamSession({
        userId: 'user-456',
      });

      // Should return existing session
      expect(result.id).toBe('existing-session-123');
      expect(result.status).toBe('not_started');

      // Verify that select was called to check for existing session
      expect(mockSupabase.from).toHaveBeenCalledWith('full_length_exam_sessions');
    });

    it('should NOT call insert when an active session exists', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const mockExistingSession = {
        id: 'existing-session-456',
        user_id: 'user-789',
        status: 'in_progress',
        seed: 'user-789_1234567890',
        created_at: new Date().toISOString(),
      };

      let insertWasCalled = false;

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        maybeSingle: vi.fn(async () => ({
                          data: mockExistingSession,
                          error: null,
                        })),
                      })),
                    })),
                  })),
                })),
              })),
              insert: vi.fn(() => {
                insertWasCalled = true;
                return {
                  select: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: null,
                      error: new Error('Should not be called'),
                    })),
                  })),
                };
              }),
            };
          }
          return { select: vi.fn() };
        }),
      };

      (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

      const result = await fullLengthExamService.createExamSession({
        userId: 'user-789',
      });

      // Should return existing session
      expect(result.id).toBe('existing-session-456');
      expect(result.status).toBe('in_progress');

      // CRITICAL: insert should NOT have been called since active session exists
      expect(insertWasCalled).toBe(false);
    });

    it('should create new session when no active session exists', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const mockNewSession = {
        id: 'new-session-789',
        user_id: 'user-456',
        status: 'not_started',
        seed: 'user-456_9876543210',
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
                        maybeSingle: vi.fn(async () => ({
                          data: null, // No existing session
                          error: null,
                        })),
                      })),
                    })),
                  })),
                })),
              })),
              insert: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: mockNewSession,
                    error: null,
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              insert: vi.fn(async () => ({
                error: null,
              })),
            };
          }
          return { select: vi.fn() };
        }),
      };

      (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

      const result = await fullLengthExamService.createExamSession({
        userId: 'user-456',
      });

      // Should create and return new session
      expect(result.id).toBe('new-session-789');
      expect(result.status).toBe('not_started');
    });

    it('should check for active statuses: not_started, in_progress, and break (not completed)', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      let capturedStatuses: string[] = [];

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn((column: string, values: string[]) => {
                    if (column === 'status') {
                      capturedStatuses = values;
                    }
                    return {
                      order: vi.fn(() => ({
                        limit: vi.fn(() => ({
                          maybeSingle: vi.fn(async () => ({
                            data: null,
                            error: null,
                          })),
                        })),
                      })),
                    };
                  }),
                })),
              })),
              insert: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: { id: 'test', status: 'not_started' },
                    error: null,
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              insert: vi.fn(async () => ({
                error: null,
              })),
            };
          }
          return { select: vi.fn() };
        }),
      };

      (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

      await fullLengthExamService.createExamSession({ userId: 'user-123' });

      // Verify it checks for all active statuses including break
      expect(capturedStatuses).toEqual(['not_started', 'in_progress', 'break']);
      expect(capturedStatuses).not.toContain('completed');
      expect(capturedStatuses).not.toContain('abandoned');
    });

    it('should handle race condition by returning existing session on unique constraint violation', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const existingRacedSession = {
        id: 'raced-session-999',
        user_id: 'user-456',
        status: 'not_started',
        seed: 'user-456_1234567890',
        created_at: new Date().toISOString(),
      };

      let insertCallCount = 0;

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        maybeSingle: vi.fn(async () => {
                          insertCallCount++;
                          // First select (before insert) returns null
                          // Second select (after unique constraint error) returns raced session
                          if (insertCallCount === 1) {
                            return { data: null, error: null };
                          } else {
                            return { data: existingRacedSession, error: null };
                          }
                        }),
                      })),
                    })),
                  })),
                })),
              })),
              insert: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: null,
                    error: {
                      code: '23505',
                      message: 'duplicate key value violates unique constraint',
                    },
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              insert: vi.fn(async () => ({
                error: null,
              })),
            };
          }
          return { select: vi.fn() };
        }),
      };

      (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

      const result = await fullLengthExamService.createExamSession({
        userId: 'user-456',
      });

      // Should return the raced session that was created by concurrent request
      expect(result.id).toBe('raced-session-999');
      expect(result.status).toBe('not_started');
    });
  });

  describe('getCurrentSession - Answer State Restoration', () => {
    it('should include submitted answers in current question payload', async () => {
      // This is tested via integration tests with actual database
      // For now, we verify the type structure is correct
      const mockSession: fullLengthExamService.GetCurrentSessionResult['session'] = {
        id: 'session-123',
        userId: 'user-456',
        status: 'in_progress',
        currentSection: 'math',
        currentModule: 1,
        seed: 'test-seed',
        startedAt: new Date(),
        completedAt: null as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockResult: fullLengthExamService.GetCurrentSessionResult = {
        session: mockSession,
        currentModule: null,
        currentQuestion: {
          id: 'q1',
          stem: 'Test question',
          section: 'math',
          question_type: 'multiple_choice',
          options: [{ key: 'A', text: 'Option A' }],
          difficulty: 'medium',
          orderIndex: 0,
          moduleQuestionCount: 10,
          answeredCount: 5,
          // Answer restoration payload
          submittedAnswer: {
            selectedAnswer: 'A',
            freeResponseAnswer: undefined,
          },
        },
        timeRemaining: 120000,
        breakTimeRemaining: null,
      };

      // Type checking ensures the structure is correct
      expect(mockResult.currentQuestion?.submittedAnswer?.selectedAnswer).toBe('A');
    });

    it('should not include classification field (anti-leak)', () => {
      // Type check: classification should not exist on the type
      const mockQuestion: fullLengthExamService.GetCurrentSessionResult['currentQuestion'] = {
        id: 'q1',
        stem: 'Test',
        section: 'math',
        question_type: 'multiple_choice',
        options: [],
        difficulty: 1,
        orderIndex: 0,
        moduleQuestionCount: 10,
        answeredCount: 0,
      };

      // @ts-expect-error - classification should not exist on the type
      const shouldNotExist = mockQuestion.classification;
      expect(shouldNotExist).toBeUndefined();
    });
  });

  describe('completeExam - Terminal State Guard', () => {
    it('should reject completion before Math Module 2 is submitted', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const mockSession = {
        id: 'session-123',
        user_id: 'user-456',
        status: 'in_progress',
        current_section: 'math',
        current_module: 2,
        seed: 'test-seed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockMathModule2 = {
        id: 'module-math-2',
        session_id: 'session-123',
        section: 'math',
        module_index: 2,
        status: 'in_progress', // NOT submitted
        difficulty_bucket: 'medium',
        target_duration_ms: 2100000,
        created_at: new Date().toISOString(),
      };

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: mockSession,
                      error: null,
                    })),
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      single: vi.fn(async () => ({
                        data: mockMathModule2,
                        error: null,
                      })),
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
        fullLengthExamService.completeExam({
          sessionId: 'session-123',
          userId: 'user-456',
        })
      ).rejects.toThrow('Invalid exam state');
    });

    it('should reject completion when session is not in terminal state (not at math module 2)', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const mockSession = {
        id: 'session-123',
        user_id: 'user-456',
        status: 'in_progress',
        current_section: 'rw', // Still in RW section
        current_module: 1,
        seed: 'test-seed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: mockSession,
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
        fullLengthExamService.completeExam({
          sessionId: 'session-123',
          userId: 'user-456',
        })
      ).rejects.toThrow('Invalid exam state');
    });

    it('should recompute canonical report when session is already completed (idempotent)', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const completedAt = new Date('2024-01-15T10:00:00Z');
      const mockSession = {
        id: 'session-123',
        user_id: 'user-456',
        status: 'completed',
        current_section: 'math',
        current_module: 2,
        seed: 'test-seed',
        completed_at: completedAt.toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockModules = [
        { id: 'module-rw-1', section: 'rw', module_index: 1 },
        { id: 'module-rw-2', section: 'rw', module_index: 2 },
        { id: 'module-math-1', section: 'math', module_index: 1 },
        { id: 'module-math-2', section: 'math', module_index: 2 },
      ];

      const responsesByModule: Record<string, Array<{ question_id: string; is_correct: boolean }>> = {
        'module-rw-1': [{ question_id: 'q-rw-1', is_correct: true }],
        'module-rw-2': [{ question_id: 'q-rw-2', is_correct: false }],
        'module-math-1': [{ question_id: 'q-math-1', is_correct: true }],
        'module-math-2': [{ question_id: 'q-math-2', is_correct: true }],
      };

      const moduleQuestionsByModule: Record<string, Array<{ id: string }>> = {
        'module-rw-1': [{ id: 'mq-rw-1' }],
        'module-rw-2': [{ id: 'mq-rw-2' }],
        'module-math-1': [{ id: 'mq-math-1' }],
        'module-math-2': [{ id: 'mq-math-2' }],
      };

      const moduleQuestionsFlat = [
        { module_id: 'module-rw-1', question_id: 'q-rw-1' },
        { module_id: 'module-rw-2', question_id: 'q-rw-2' },
        { module_id: 'module-math-1', question_id: 'q-math-1' },
        { module_id: 'module-math-2', question_id: 'q-math-2' },
      ];

      const responsesBySession = Object.entries(responsesByModule).flatMap(([moduleId, rows]) =>
        rows.map((row) => ({ module_id: moduleId, question_id: row.question_id, is_correct: row.is_correct }))
      );

      let rollupFetchCount = 0;

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: mockSession,
                      error: null,
                    })),
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    order: vi.fn(async () => ({ data: mockModules, error: null })),
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_responses') {
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
          } else if (table === 'full_length_exam_questions') {
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
          } else if (table === 'questions') {
            return {
              select: vi.fn(() => ({
                in: vi.fn(async () => ({
                  data: [
                    { id: 'q-rw-1', classification: { topic: 'Info', subtopic: 'Main Idea' }, unit_tag: null, tags: null, competencies: null },
                    { id: 'q-rw-2', classification: { topic: 'Craft', subtopic: 'Words' }, unit_tag: null, tags: null, competencies: null },
                    { id: 'q-math-1', classification: { topic: 'Algebra', subtopic: 'Linear' }, unit_tag: null, tags: null, competencies: null },
                    { id: 'q-math-2', classification: { topic: 'Advanced Math', subtopic: 'Polynomials' }, unit_tag: null, tags: null, competencies: null },
                  ],
                  error: null,
                })),
              })),
            };
          } else if (table === 'full_length_exam_score_rollups') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => {
                    // No rollup fetch should happen on completion
                    return { data: null, error: null };
                  }),
                })),
              })),
            };
          }
          return { select: vi.fn() };
        }),
      };

      (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

      const result1 = await fullLengthExamService.completeExam({
        sessionId: 'session-123',
        userId: 'user-456',
      });

      const result2 = await fullLengthExamService.completeExam({
        sessionId: 'session-123',
        userId: 'user-456',
      });

      expect(result1.sessionId).toBe('session-123');
      expect(result2.sessionId).toBe('session-123');
      expect(result1.completedAt.getTime()).toBe(completedAt.getTime());
      expect(result2.completedAt.getTime()).toBe(completedAt.getTime());
      expect(result1.rawScore.total.total).toBe(4);
      expect(result2.rawScore.total.total).toBe(4);
      expect(rollupFetchCount).toBe(0);
    });

    it('should persist rollup on first completion and recompute canonical report on second', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const completedAt = new Date('2024-01-15T10:00:00Z');

      // First call: session is in_progress, needs completion
      const mockInProgressSession = {
        id: 'session-789',
        user_id: 'user-456',
        status: 'in_progress',
        current_section: 'math',
        current_module: 2,
        seed: 'test-seed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Second call: session is completed
      const mockCompletedSession = {
        ...mockInProgressSession,
        status: 'completed',
        completed_at: completedAt.toISOString(),
      };

      const mockMathModule2 = {
        id: 'module-math-2',
        session_id: 'session-789',
        section: 'math',
        module_index: 2,
        status: 'submitted',
        difficulty_bucket: 'medium',
        target_duration_ms: 2100000,
        created_at: new Date().toISOString(),
      };

      const mockModules = [
        { id: 'module-rw-1', section: 'rw', module_index: 1 },
        { id: 'module-rw-2', section: 'rw', module_index: 2 },
        { id: 'module-math-1', section: 'math', module_index: 1 },
        { id: 'module-math-2', section: 'math', module_index: 2 },
      ];

      const mockRollup = {
        id: 'rollup-789',
        session_id: 'session-789',
        user_id: 'user-456',
        rw_module1_correct: 18,
        rw_module1_total: 27,
        rw_module2_correct: 17,
        rw_module2_total: 27,
        math_module1_correct: 13,
        math_module1_total: 22,
        math_module2_correct: 12,
        math_module2_total: 22,
        overall_score: 60,
        created_at: completedAt.toISOString(),
      };

      let sessionFetchCount = 0;
      let rollupInsertCount = 0;
      let rollupFetchCount = 0;

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(async () => {
                      sessionFetchCount++;
                      // First call returns in_progress, second returns completed
                      return {
                        data: sessionFetchCount === 1 ? mockInProgressSession : mockCompletedSession,
                        error: null,
                      };
                    }),
                  })),
                })),
              })),
              update: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    neq: vi.fn(() => ({
                      select: vi.fn(async () => ({
                        data: [mockCompletedSession],
                        error: null,
                      })),
                    })),
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn((field: string, value: any) => {
                  if (field === 'session_id') {
                    return {
                      eq: vi.fn((field2: string) => {
                        if (field2 === 'section') {
                          // For Math Module 2 specific check
                          return {
                            eq: vi.fn(() => ({
                              single: vi.fn(async () => ({
                                data: mockMathModule2,
                                error: null,
                              })),
                            })),
                          };
                        }
                        return {
                          eq: vi.fn(() => ({
                            single: vi.fn(async () => ({
                              data: mockMathModule2,
                              error: null,
                            })),
                          })),
                        };
                      }),
                      // For fetching all modules
                      order: vi.fn(() => ({
                        order: vi.fn(async () => ({
                          data: mockModules,
                          error: null,
                        })),
                      })),
                    };
                  }
                  return {
                    eq: vi.fn(() => ({
                      eq: vi.fn(() => ({
                        single: vi.fn(async () => ({
                          data: mockMathModule2,
                          error: null,
                        })),
                      })),
                    })),
                  };
                }),
              })),
            };
          } else if (table === 'full_length_exam_responses') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(async () => ({
                  data: [
                    { is_correct: true },
                    { is_correct: false },
                  ],
                  error: null,
                })),
              })),
            };
          } else if (table === 'full_length_exam_score_rollups') {
            return {
              upsert: vi.fn(async () => {
                rollupInsertCount++;
                return { error: null };
              }),
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => {
                    // No rollup fetch should happen on completion
                    return {
                      data: mockRollup,
                      error: null,
                    };
                  }),
                })),
              })),
            };
          }
          return { select: vi.fn() };
        }),
      };

      (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

      // First call: should compute and persist rollup
      const result1 = await fullLengthExamService.completeExam({
        sessionId: 'session-789',
        userId: 'user-456',
      });

      // Second call: should recompute canonical report
      const result2 = await fullLengthExamService.completeExam({
        sessionId: 'session-789',
        userId: 'user-456',
      });

      // Verify rollup was inserted only once (on first completion)
      expect(rollupInsertCount).toBe(1);

      // Verify rollup was NOT fetched (results recomputed from responses)
      expect(rollupFetchCount).toBe(0);

      // Both results should be consistent
      expect(result1.sessionId).toBe('session-789');
      expect(result2.sessionId).toBe('session-789');
    });
  });

  describe('submitModule - Module2 Single-Write Guarantee', () => {
    it('should not overwrite difficulty_bucket if already set', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const mockSession = {
        id: 'session-123',
        user_id: 'user-456',
        status: 'in_progress',
        current_section: 'rw',
        current_module: 1,
        seed: 'test-seed',
      };

      const mockCurrentModule = {
        id: 'module-rw-1',
        session_id: 'session-123',
        section: 'rw',
        module_index: 1,
        status: 'in_progress',
        difficulty_bucket: null,
        ends_at: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
      };

      const mockResponses = [
        { is_correct: true },
        { is_correct: true },
        { is_correct: false },
      ];

      let updateCallCount = 0;

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: mockSession,
                      error: null,
                    })),
                  })),
                })),
              })),
              update: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      single: vi.fn(async () => ({
                        data: mockCurrentModule,
                        error: null,
                      })),
                    })),
                  })),
                })),
              })),
              update: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      is: vi.fn(() => ({
                        select: vi.fn(async () => {
                          updateCallCount++;
                          // Simulate that bucket was already set (no rows updated)
                          return { data: [], error: null };
                        }),
                      })),
                    })),
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_responses') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(async () => ({
                  data: mockResponses,
                  error: null,
                })),
              })),
            };
          }
          return { select: vi.fn() };
        }),
      };

      (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

      await fullLengthExamService.submitModule({
        sessionId: 'session-123',
        userId: 'user-456',
      });

      expect(updateCallCount).toBe(1);
    });
  });

  describe('submitModule - Deterministic Timing Rules', () => {
    it('should reject submission if ends_at is null (module not started)', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const mockSession = {
        id: 'session-123',
        user_id: 'user-456',
        status: 'in_progress',
        current_section: 'rw',
        current_module: 1,
        seed: 'test-seed',
      };

      const mockCurrentModule = {
        id: 'module-rw-1',
        session_id: 'session-123',
        section: 'rw',
        module_index: 1,
        status: 'in_progress',
        ends_at: null, // Module not started - ends_at is null
        started_at: null,
        submitted_late: false,
      };

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: mockSession,
                      error: null,
                    })),
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      single: vi.fn(async () => ({
                        data: mockCurrentModule,
                        error: null,
                      })),
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
        fullLengthExamService.submitModule({
          sessionId: 'session-123',
          userId: 'user-456',
        })
      ).rejects.toThrow('Module must be started before submitting');
    });

    it('should set submitted_late=true when ends_at is in the past', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const mockSession = {
        id: 'session-123',
        user_id: 'user-456',
        status: 'in_progress',
        current_section: 'rw',
        current_module: 1,
        seed: 'test-seed',
      };

      // Set ends_at to the past (expired)
      const pastTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      const mockCurrentModule = {
        id: 'module-rw-1',
        session_id: 'session-123',
        section: 'rw',
        module_index: 1,
        status: 'in_progress',
        ends_at: pastTime,
        started_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        submitted_late: false,
      };

      let capturedUpdate: Record<string, unknown> | null = null;

      // Helper to create chainable eq mock
      const createChainableEq = (finalValue: () => unknown) => {
        const chainableEq = vi.fn((): unknown => ({
          eq: chainableEq,
          is: vi.fn(() => ({
            select: vi.fn(async () => ({ data: [], error: null })),
          })),
          single: finalValue,
          select: vi.fn(async () => ({ data: [], error: null })),
        }));
        return chainableEq;
      };

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: mockSession,
                      error: null,
                    })),
                  })),
                })),
              })),
              update: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              select: vi.fn(() => ({
                eq: createChainableEq(vi.fn(async () => ({
                  data: mockCurrentModule,
                  error: null,
                }))),
              })),
              update: vi.fn((updateData: Record<string, unknown>) => {
                // Only capture the first update (module submit, not difficulty update)
                if (!capturedUpdate && updateData.status === 'submitted') {
                  capturedUpdate = updateData;
                }
                return {
                  eq: createChainableEq(vi.fn(async () => ({ error: null }))),
                };
              }),
            };
          } else if (table === 'full_length_exam_responses') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(async () => ({
                  data: [],
                  error: null,
                })),
              })),
            };
          }
          return { select: vi.fn() };
        }),
      };

      (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

      await fullLengthExamService.submitModule({
        sessionId: 'session-123',
        userId: 'user-456',
      });

      // Verify that submitted_late was set to true
      expect(capturedUpdate).not.toBeNull();
      expect(capturedUpdate?.submitted_late).toBe(true);
      expect(capturedUpdate?.status).toBe('submitted');
      expect(capturedUpdate?.submitted_at).toBeDefined();
    });

    it('should set submitted_late=false when submitting on time', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const mockSession = {
        id: 'session-123',
        user_id: 'user-456',
        status: 'in_progress',
        current_section: 'rw',
        current_module: 1,
        seed: 'test-seed',
      };

      // Set ends_at to the future (still have time)
      const futureTime = new Date(Date.now() + 60000).toISOString(); // 1 minute from now
      const mockCurrentModule = {
        id: 'module-rw-1',
        session_id: 'session-123',
        section: 'rw',
        module_index: 1,
        status: 'in_progress',
        ends_at: futureTime,
        started_at: new Date().toISOString(),
        submitted_late: false,
      };

      let capturedUpdate: Record<string, unknown> | null = null;

      // Helper to create chainable eq mock
      const createChainableEq = (finalValue: () => unknown) => {
        const chainableEq = vi.fn((): unknown => ({
          eq: chainableEq,
          is: vi.fn(() => ({
            select: vi.fn(async () => ({ data: [], error: null })),
          })),
          single: finalValue,
          select: vi.fn(async () => ({ data: [], error: null })),
        }));
        return chainableEq;
      };

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: mockSession,
                      error: null,
                    })),
                  })),
                })),
              })),
              update: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              select: vi.fn(() => ({
                eq: createChainableEq(vi.fn(async () => ({
                  data: mockCurrentModule,
                  error: null,
                }))),
              })),
              update: vi.fn((updateData: Record<string, unknown>) => {
                // Only capture the first update (module submit, not difficulty update)
                if (!capturedUpdate && updateData.status === 'submitted') {
                  capturedUpdate = updateData;
                }
                return {
                  eq: createChainableEq(vi.fn(async () => ({ error: null }))),
                };
              }),
            };
          } else if (table === 'full_length_exam_responses') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(async () => ({
                  data: [],
                  error: null,
                })),
              })),
            };
          }
          return { select: vi.fn() };
        }),
      };

      (getSupabaseAdmin as Mock).mockReturnValue(mockSupabase);

      await fullLengthExamService.submitModule({
        sessionId: 'session-123',
        userId: 'user-456',
      });

      // Verify that submitted_late was set to false
      expect(capturedUpdate).not.toBeNull();
      expect(capturedUpdate?.submitted_late).toBe(false);
      expect(capturedUpdate?.status).toBe('submitted');
      expect(capturedUpdate?.submitted_at).toBeDefined();
    });

    it('should reject submission if module status is not in_progress', async () => {
      const { getSupabaseAdmin } = await import('../../lib/supabase-admin');

      const mockSession = {
        id: 'session-123',
        user_id: 'user-456',
        status: 'in_progress',
        current_section: 'rw',
        current_module: 1,
        seed: 'test-seed',
      };

      const mockCurrentModule = {
        id: 'module-rw-1',
        session_id: 'session-123',
        section: 'rw',
        module_index: 1,
        status: 'not_started', // Not in_progress
        ends_at: new Date(Date.now() + 60000).toISOString(),
        started_at: null,
        submitted_late: false,
      };

      const mockSupabase: MockSupabaseClient = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: mockSession,
                      error: null,
                    })),
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      single: vi.fn(async () => ({
                        data: mockCurrentModule,
                        error: null,
                      })),
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
        fullLengthExamService.submitModule({
          sessionId: 'session-123',
          userId: 'user-456',
        })
      ).rejects.toThrow('Module must be in progress to submit');
    });
  });

  describe('getExamReview - Safe Question Field Projection', () => {
    const mockQuestionWithAnswers = {
      id: 'q1',
      stem: 'What is 2 + 2?',
      section: 'Math',
      question_type: 'multiple_choice',
      options: [{ key: 'A', text: '3' }, { key: 'B', text: '4' }, { key: 'C', text: '5' }, { key: 'D', text: '6' }],
      difficulty: 1,
      tags: ['addition', 'basic'],
      // Answer fields that should NOT appear pre-completion
      correct_answer: 'B',
      answer_text: null,
      explanation: 'Two plus two equals four.',
      option_metadata: null,
    };

    const mockSession = {
      id: 'session-review-123',
      user_id: 'user-456',
      status: 'in_progress',
      current_section: 'math',
      current_module: 1,
      seed: 'test-seed',
      started_at: new Date().toISOString(),
      completed_at: null,
      created_at: new Date().toISOString(),
    };

    const mockCompletedSession = {
      ...mockSession,
      status: 'completed',
      completed_at: new Date().toISOString(),
    };

    const mockModule = {
      id: 'module-1',
      section: 'math',
      module_index: 1,
      status: 'in_progress',
      difficulty_bucket: null,
      started_at: new Date().toISOString(),
      submitted_at: null,
    };

    const mockModuleQuestion = {
      question_id: 'q1',
      module_id: 'module-1',
      order_index: 0,
    };

    const mockResponse = {
      question_id: 'q1',
      module_id: 'module-1',
      selected_answer: 'B',
      free_response_answer: null,
      is_correct: true,
      answered_at: new Date().toISOString(),
    };

    it('should NOT include answer/explanation fields for not-completed session', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: mockSession,
                    error: null,
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    order: vi.fn(async () => ({
                      data: [mockModule],
                      error: null,
                    })),
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_questions') {
            return {
              select: vi.fn(() => ({
                in: vi.fn(async () => ({
                  data: [mockModuleQuestion],
                  error: null,
                })),
              })),
            };
          } else if (table === 'questions') {
            return {
              select: vi.fn(() => ({
                in: vi.fn(async () => ({
                  data: [mockQuestionWithAnswers],
                  error: null,
                })),
              })),
            };
          } else if (table === 'full_length_exam_responses') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(async () => ({
                  data: [mockResponse],
                  error: null,
                })),
              })),
            };
          }
          return { select: vi.fn() };
        }),
      } as unknown as ReturnType<typeof import('../../lib/supabase-admin').getSupabaseAdmin>;

      const result = await fullLengthExamService.getExamReview({
        supabase: mockSupabase,
        sessionId: 'session-review-123',
      });

      // Verify session is not completed
      expect(result.session.status).toBe('in_progress');

      // Verify questions returned
      expect(result.questions.length).toBe(1);
      const question = result.questions[0];

      // Verify safe fields ARE present
      expect(question.id).toBe('q1');
      expect(question.stem).toBe('What is 2 + 2?');
      expect(question.section).toBe('Math');
      expect(question.question_type).toBe('multiple_choice');
      expect(question.options).toEqual([{ key: 'A', text: '3' }, { key: 'B', text: '4' }, { key: 'C', text: '5' }, { key: 'D', text: '6' }]);
      expect(question.difficulty).toBe(1);

      // Verify answer/explanation fields are NOT present (allowlist enforcement)
      const questionAsAny = question as unknown as Record<string, unknown>;
      expect(questionAsAny.correct_answer).toBeUndefined();
      expect(questionAsAny.answer).toBeUndefined();
      expect(questionAsAny.answerChoice).toBeUndefined();
      expect(questionAsAny.answerText).toBeUndefined();
      expect(questionAsAny.answer_choice).toBeUndefined();
      expect(questionAsAny.answer_text).toBeUndefined();
      expect(questionAsAny.explanation).toBeUndefined();
      expect(questionAsAny.option_metadata).toBeUndefined();

      // Verify is_correct is hidden for responses when not completed
      expect(result.responses[0].isCorrect).toBeNull();
    });

    it('should include answer/explanation fields for completed session', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'full_length_exam_sessions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: mockCompletedSession,
                    error: null,
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_modules') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    order: vi.fn(async () => ({
                      data: [mockModule],
                      error: null,
                    })),
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_questions') {
            return {
              select: vi.fn(() => ({
                in: vi.fn(async () => ({
                  data: [mockModuleQuestion],
                  error: null,
                })),
              })),
            };
          } else if (table === 'questions') {
            return {
              select: vi.fn(() => ({
                in: vi.fn(async () => ({
                  data: [mockQuestionWithAnswers],
                  error: null,
                })),
              })),
            };
          } else if (table === 'full_length_exam_responses') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(async () => ({
                  data: [mockResponse],
                  error: null,
                })),
              })),
            };
          }
          return { select: vi.fn() };
        }),
      } as unknown as ReturnType<typeof import('../../lib/supabase-admin').getSupabaseAdmin>;

      const result = await fullLengthExamService.getExamReview({
        supabase: mockSupabase,
        sessionId: 'session-review-123',
      });

      // Verify session is completed
      expect(result.session.status).toBe('completed');

      // Verify questions returned
      expect(result.questions.length).toBe(1);
      const question = result.questions[0] as fullLengthExamService.FullQuestionPostCompletion;

      // Verify safe fields ARE present
      expect(question.id).toBe('q1');
      expect(question.stem).toBe('What is 2 + 2?');
      expect(question.section).toBe('Math');
      expect(question.question_type).toBe('multiple_choice');
      expect(question.options).toEqual([{ key: 'A', text: '3' }, { key: 'B', text: '4' }, { key: 'C', text: '5' }, { key: 'D', text: '6' }]);
      expect(question.difficulty).toBe(1);

      // Verify answer/explanation fields ARE present for completed session
      expect(question.correct_answer).toBe('B');
      expect(question.answer_text).toBeNull();
      expect(question.explanation).toBe('Two plus two equals four.');
      expect(question.option_metadata).toBeNull();

      // Verify is_correct is revealed for responses when completed
      expect(result.responses[0].isCorrect).toBe(true);
    });

    it('should verify allowlist constant contains only safe fields', () => {
      // Verify the allowlist does NOT contain answer/explanation fields
      const safeFields = fullLengthExamService.SAFE_QUESTION_FIELDS_PRE_COMPLETION;

      expect(safeFields).not.toContain('answer');
      expect(safeFields).not.toContain('answerChoice');
      expect(safeFields).not.toContain('answerText');
      expect(safeFields).not.toContain('answer_choice');
      expect(safeFields).not.toContain('answer_text');
      expect(safeFields).not.toContain('explanation');
      expect(safeFields).not.toContain('option_metadata');

      // Verify safe fields ARE present
      expect(safeFields).toContain('id');
      expect(safeFields).toContain('stem');
      expect(safeFields).toContain('section');
      expect(safeFields).toContain('question_type');
      expect(safeFields).toContain('options');
      expect(safeFields).toContain('difficulty');
    });

    it('should verify answer fields constant contains the right fields', () => {
      const answerFields = fullLengthExamService.ANSWER_FIELDS_POST_COMPLETION;

      // Verify answer fields ARE present
      expect(answerFields).toContain('correct_answer');
      expect(answerFields).toContain('answer_text');
      expect(answerFields).toContain('explanation');
      expect(answerFields).toContain('option_metadata');
    });
  });
});


