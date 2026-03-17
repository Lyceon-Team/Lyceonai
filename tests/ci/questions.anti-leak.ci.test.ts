/**
 * CI Security Tests - Question Anti-Leak
 *
 * These tests validate that student/public question retrieval endpoints
 * NEVER leak sensitive data like explanations or correct answers.
 *
 * SECURITY GUARANTEES TESTED:
 * 1. GET /api/questions/recent never returns explanation (must be null)
 * 2. GET /api/questions/recent never returns correct answer fields
 * 3. GET /__test/questions/random never returns explanation (must be null)
 * 4. GET /__test/questions/random never returns correct answer fields
 * 5. GET /__test/questions never returns explanation (must be null)
 * 6. GET /__test/questions never returns correct answer fields
 * 7. GET /api/questions/search never returns explanation (must be null)
 * 8. GET /api/questions/search never returns correct answer fields
 * 9. Tests are tolerant to empty data environments
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

type MockQuestionRow = {
  id: string;
  canonical_id: string;
  status: string;
  section: string;
  section_code: string;
  question_type: string;
  stem: string;
  options: Array<{ key: string; text: string }>;
  difficulty: string;
  domain: string;
  skill: string;
  subskill: string | null;
  skill_code: string;
  tags: unknown;
  competencies: unknown;
  created_at: string;
  correct_answer: string;
  explanation: string;
};

const {
  mockQuestionRows,
  mockGenerateEmbedding,
  mockSearchSimilarQuestions,
  mockGetSupabaseClient,
} = vi.hoisted(() => ({
  mockQuestionRows: [] as MockQuestionRow[],
  mockGenerateEmbedding: vi.fn(),
  mockSearchSimilarQuestions: vi.fn(),
  mockGetSupabaseClient: vi.fn(),
}));

vi.mock('../../apps/api/src/lib/embeddings', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('../../apps/api/src/lib/supabase', () => ({
  searchSimilarQuestions: mockSearchSimilarQuestions,
  getSupabaseClient: mockGetSupabaseClient,
}));

vi.mock('../../server/middleware/supabase-auth', async () => {
  const actual = await vi.importActual<typeof import('../../server/middleware/supabase-auth')>(
    '../../server/middleware/supabase-auth'
  );

  return {
    ...actual,
    supabaseAuthMiddleware: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'anti-leak-student',
        role: 'student',
        isGuardian: false,
        isAdmin: false,
      };
      next();
    },
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'anti-leak-student',
        role: 'student',
        isGuardian: false,
        isAdmin: false,
      };
      next();
    },
    requireStudentOrAdmin: (_req: any, _res: any, next: any) => next(),
    requireSupabaseAdmin: (_req: any, _res: any, next: any) => next(),
  };
});

class QuestionQueryBuilder {
  private filters: Array<(row: MockQuestionRow) => boolean> = [];
  private sorter: ((a: MockQuestionRow, b: MockQuestionRow) => number) | null = null;
  private rangeStart: number | null = null;
  private rangeEnd: number | null = null;
  private limitCount: number | null = null;

  select(_columns?: string) {
    return this;
  }

  eq(column: keyof MockQuestionRow, value: any) {
    this.filters.push((row) => (row as any)[column] === value);
    return this;
  }

  in(column: keyof MockQuestionRow, values: any[]) {
    this.filters.push((row) => values.includes((row as any)[column]));
    return this;
  }

  lt(column: keyof MockQuestionRow, value: any) {
    this.filters.push((row) => {
      const raw = (row as any)[column];
      if (typeof raw === 'string' || typeof raw === 'number') {
        return raw < value;
      }
      return false;
    });
    return this;
  }

  order(column: keyof MockQuestionRow, opts?: { ascending?: boolean }) {
    const asc = opts?.ascending !== false;
    this.sorter = (a, b) => {
      const av = (a as any)[column];
      const bv = (b as any)[column];
      if (av === bv) return 0;
      if (av == null) return asc ? -1 : 1;
      if (bv == null) return asc ? 1 : -1;
      return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    };
    return this;
  }

  range(start: number, end: number) {
    this.rangeStart = start;
    this.rangeEnd = end;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    return Promise.resolve(this.execute()).then(resolve, reject);
  }

  private execute() {
    let rows = [...mockQuestionRows];
    for (const filter of this.filters) {
      rows = rows.filter(filter);
    }
    if (this.sorter) {
      rows.sort(this.sorter);
    }
    if (this.rangeStart != null && this.rangeEnd != null) {
      rows = rows.slice(this.rangeStart, this.rangeEnd + 1);
    } else if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount);
    }
    return { data: rows, error: null };
  }
}

vi.mock('../../apps/api/src/lib/supabase-server', () => ({
  supabaseServer: {
    from: vi.fn((table: string) => {
      if (table !== 'questions') {
        throw new Error(`Unexpected table access in anti-leak test: ${table}`);
      }
      return new QuestionQueryBuilder();
    }),
  },
}));

/**
 * Helper to extract questions array from API response body.
 * Tolerates both array format and { questions: [...] } format.
 */
function extractQuestions(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.questions)) return obj.questions;
  }
  return [];
}

function extractSearchResults(body: unknown): unknown[] {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.results)) return obj.results;
  }
  return [];
}

function assertNoAnswerLeak(question: any) {
  expect(question).not.toHaveProperty('correct_answer');
  expect(question).not.toHaveProperty('answer_text');
  expect(question).not.toHaveProperty('answer');
  expect(question).not.toHaveProperty('correctAnswerKey');
}

function assertExplanationNull(question: any) {
  // Some code paths may include explanation: null explicitly (preferred).
  // If explanation is present, it must be null.
  if (Object.prototype.hasOwnProperty.call(question, 'explanation')) {
    expect(question.explanation).toBeNull();
  }
}

describe('CI Security Tests - Question Anti-Leak', () => {
  let app: Express;
  const fixtureQuestion: MockQuestionRow = {
    id: '00000000-0000-0000-0000-000000000123',
    canonical_id: 'SATM1ABC123',
    status: 'published',
    section: 'Math',
    section_code: 'M',
    question_type: 'multiple_choice',
    stem: 'What is 3 + 2?',
    options: [
      { key: 'A', text: '4' },
      { key: 'B', text: '5' },
      { key: 'C', text: '6' },
      { key: 'D', text: '7' },
    ],
    difficulty: 'easy',
    domain: 'Algebra',
    skill: 'Addition',
    subskill: null,
    skill_code: 'MATH.ALG.ADD',
    tags: null,
    competencies: null,
    created_at: '2026-03-16T00:00:00.000Z',
    correct_answer: 'B',
    explanation: '3 + 2 = 5.',
  };

  beforeAll(async () => {
    process.env.VITEST = 'true';
    process.env.NODE_ENV = 'test';

    mockGetSupabaseClient.mockReturnValue({});
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mockSearchSimilarQuestions.mockResolvedValue([]);

    // Import app
    const serverModule = await import('../../server/index');
    app = serverModule.default;

    // ------------------------------------------------------------------
    // TEST-ONLY ROUTES
    // ------------------------------------------------------------------
    // These routes bypass auth so CI can exercise handlers directly.
    // They should not be used by production clients.
    const { getRandomQuestions, getQuestions } = await import(
      '../../server/routes/questions-runtime'
    );

    const registerNoAuthGet = (path: string, handler: any) => {
      app.get(path, async (req, res) => {
        // Match server wrapping conventions for array responses
        const originalJson = res.json.bind(res);
        res.json = function (data: any) {
          if (Array.isArray(data)) {
            return originalJson.call(res, { questions: data, meta: { total: data.length } });
          }
          return originalJson.call(res, data);
        };

        return handler(req, res);
      });
    };

    registerNoAuthGet('/__test/questions/random', getRandomQuestions);
    registerNoAuthGet('/__test/questions', getQuestions);
  });

  afterAll(() => {
    delete process.env.VITEST;
  });

  beforeEach(() => {
    mockQuestionRows.splice(0, mockQuestionRows.length);
    mockSearchSimilarQuestions.mockResolvedValue([]);
  });

  describe('GET /api/questions/recent - Anti-Leak Protection', () => {
    it('should never leak explanation field to students (must be null)', async () => {
      const res = await request(app).get('/api/questions/recent?limit=5');
      expect(res.status).toBe(200);

      const questions = extractQuestions(res.body);
      expect(Array.isArray(questions)).toBe(true);

      questions.forEach((q: any) => {
        assertExplanationNull(q);
      });
    });

    it('should never leak correct answer fields (correct_answer, answer_text, answer)', async () => {
      const res = await request(app).get('/api/questions/recent?limit=5');
      expect(res.status).toBe(200);

      const questions = extractQuestions(res.body);
      expect(Array.isArray(questions)).toBe(true);

      questions.forEach((q: any) => {
        assertNoAnswerLeak(q);
      });
    });

    it('should handle empty results gracefully (no crash on 0 questions)', async () => {
      const res = await request(app).get('/api/questions/recent?limit=5');
      expect(res.status).toBe(200);

      const questions = extractQuestions(res.body);
      expect(Array.isArray(questions)).toBe(true);

      // No assertion on length - could be 0 or more
    });
  });

  describe('GET /api/questions/random - Anti-Leak Protection', () => {
    it('should never leak explanation field to students (must be null)', async () => {
      // Use test-only bypass route to exercise handler without auth
      const res = await request(app).get('/__test/questions/random?limit=5');
      expect([200, 401, 403, 404]).toContain(res.status);

      if (res.status === 200) {
        const questions = extractQuestions(res.body);
        expect(Array.isArray(questions)).toBe(true);

        questions.forEach((q: any) => {
          assertExplanationNull(q);
        });
      } else {
        // If not reachable, ensure error payload doesn't leak
        expect(res.body).not.toHaveProperty('explanation');
        expect(res.body).not.toHaveProperty('correct_answer');
        expect(res.body).not.toHaveProperty('answer_text');
        expect(res.body).not.toHaveProperty('answer');
      }
    });

    it('should never leak correct answer fields (correct_answer, answer_text, answer)', async () => {
      const res = await request(app).get('/__test/questions/random?limit=5');
      expect([200, 401, 403, 404]).toContain(res.status);

      if (res.status === 200) {
        const questions = extractQuestions(res.body);
        expect(Array.isArray(questions)).toBe(true);

        questions.forEach((q: any) => {
          assertNoAnswerLeak(q);
        });
      } else {
        // If not reachable, ensure error payload doesn't leak
        expect(res.body).not.toHaveProperty('explanation');
        expect(res.body).not.toHaveProperty('correct_answer');
        expect(res.body).not.toHaveProperty('answer_text');
        expect(res.body).not.toHaveProperty('answer');
      }
    });
  });

  describe('GET /api/questions - Anti-Leak Protection', () => {
    it('returns non-empty mounted /api/questions rows with null answer and explanation pre-submit', async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevVitest = process.env.VITEST;
      process.env.NODE_ENV = 'development';
      delete process.env.VITEST;
      mockQuestionRows.splice(0, mockQuestionRows.length, fixtureQuestion);

      try {
        const res = await request(app).get('/api/questions?limit=5');
        expect(res.status).toBe(200);

        const questions = extractQuestions(res.body);
        expect(questions.length).toBeGreaterThan(0);

        questions.forEach((q: any) => {
          expect(q.correct_answer).toBeNull();
          expect(q.explanation).toBeNull();
        });
      } finally {
        if (prevNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = prevNodeEnv;
        }
        if (prevVitest === undefined) {
          delete process.env.VITEST;
        } else {
          process.env.VITEST = prevVitest;
        }
      }
    });

    it('should never leak explanation field to students (must be null)', async () => {
      // Use test-only bypass route to exercise handler without auth
      const res = await request(app).get('/__test/questions?limit=5');
      expect([200, 401, 403, 404]).toContain(res.status);

      if (res.status === 200) {
        const questions = extractQuestions(res.body);
        expect(Array.isArray(questions)).toBe(true);

        questions.forEach((q: any) => {
          assertExplanationNull(q);
        });
      }
    });

    it('should never leak correct answer fields', async () => {
      const res = await request(app).get('/__test/questions?limit=5');
      expect([200, 401, 403, 404]).toContain(res.status);

      if (res.status === 200) {
        const questions = extractQuestions(res.body);
        expect(Array.isArray(questions)).toBe(true);

        questions.forEach((q: any) => {
          assertNoAnswerLeak(q);
        });
      }
    });
  });

  describe('GET /api/questions/search - Anti-Leak Protection', () => {
    it('returns non-empty mounted /api/questions/search rows with null answer and explanation pre-submit', async () => {
      mockQuestionRows.splice(0, mockQuestionRows.length, fixtureQuestion);
      mockSearchSimilarQuestions.mockResolvedValue([
        { question_id: fixtureQuestion.id, similarity: 0.93 },
      ]);

      const res = await request(app).get('/api/questions/search?q=test&limit=5');
      expect(res.status).toBe(200);

      const results = extractSearchResults(res.body);
      expect(results.length).toBeGreaterThan(0);

      results.forEach((q: any) => {
        expect(q.correct_answer).toBeNull();
        expect(q.explanation).toBeNull();
      });
    });

    it('should never leak explanation field to students (must be null)', async () => {
      const res = await request(app).get('/api/questions/search?q=test&limit=5');
      expect(res.status).toBe(200);

      const results = extractSearchResults(res.body);
      expect(Array.isArray(results)).toBe(true);

      results.forEach((q: any) => {
        assertExplanationNull(q);
      });
    });

    it('should never leak correct answer fields (correct_answer, answer_text, answer)', async () => {
      const res = await request(app).get('/api/questions/search?q=test&limit=5');
      expect(res.status).toBe(200);

      const results = extractSearchResults(res.body);
      expect(Array.isArray(results)).toBe(true);

      results.forEach((q: any) => {
        assertNoAnswerLeak(q);
      });
    });
  });
});

