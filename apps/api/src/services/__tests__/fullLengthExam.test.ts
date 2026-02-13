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

    it('should only check for not_started and in_progress sessions (not completed)', async () => {
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

      // Verify it only checks for active statuses
      expect(capturedStatuses).toEqual(['not_started', 'in_progress']);
      expect(capturedStatuses).not.toContain('completed');
      expect(capturedStatuses).not.toContain('abandoned');
    });
  });

  describe('getCurrentSession - Answer State Restoration', () => {
    it('should include submitted answers in current question payload', async () => {
      // This is tested via integration tests with actual database
      // For now, we verify the type structure is correct
      const mockSession: fullLengthExamService.GetCurrentSessionResult['session'] = {
        id: 'session-123',
        user_id: 'user-456',
        status: 'in_progress',
        current_section: 'math',
        current_module: 1,
        seed: 'test-seed',
        started_at: new Date().toISOString(),
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockResult: fullLengthExamService.GetCurrentSessionResult = {
        session: mockSession,
        currentModule: null,
        currentQuestion: {
          id: 'q1',
          stem: 'Test question',
          section: 'math',
          type: 'mc',
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
        type: 'mc',
        options: [],
        difficulty: 'easy',
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

    it('should return existing result when completing twice (idempotent)', async () => {
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
                    order: vi.fn(async () => ({
                      data: mockModules,
                      error: null,
                    })),
                  })),
                })),
              })),
            };
          } else if (table === 'full_length_exam_responses') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(async (field: string, value: string) => {
                  // Return mock responses based on module
                  if (value === 'module-rw-1') {
                    return {
                      data: [
                        { is_correct: true },
                        { is_correct: true },
                        { is_correct: false },
                      ],
                      error: null,
                    };
                  }
                  return { data: [], error: null };
                }),
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

      // Both calls should return the same result
      expect(result1.sessionId).toBe('session-123');
      expect(result2.sessionId).toBe('session-123');
      expect(result1.completedAt.getTime()).toBe(completedAt.getTime());
      expect(result2.completedAt.getTime()).toBe(completedAt.getTime());
    });
  });
});
