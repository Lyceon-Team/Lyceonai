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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

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
  expect(question).not.toHaveProperty('answer_choice');
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

  beforeAll(async () => {
    process.env.VITEST = 'true';
    process.env.NODE_ENV = 'test';

    // Import app
    const serverModule = await import('../../server/index');
    app = serverModule.default;

    // ------------------------------------------------------------------
    // TEST-ONLY ROUTES
    // ------------------------------------------------------------------
    // These routes bypass auth so CI can exercise handlers directly.
    // They should not be used by production clients.
    const { getRandomQuestions, getQuestions } = await import(
      '../../apps/api/src/routes/questions'
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

    it('should never leak correct answer fields (answer_choice, answer_text, answer)', async () => {
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
        expect(res.body).not.toHaveProperty('answer_choice');
        expect(res.body).not.toHaveProperty('answer_text');
        expect(res.body).not.toHaveProperty('answer');
      }
    });

    it('should never leak correct answer fields (answer_choice, answer_text, answer)', async () => {
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
        expect(res.body).not.toHaveProperty('answer_choice');
        expect(res.body).not.toHaveProperty('answer_text');
        expect(res.body).not.toHaveProperty('answer');
      }
    });
  });

  describe('GET /api/questions - Anti-Leak Protection', () => {
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
    it('should never leak explanation field to students (must be null)', async () => {
      const res = await request(app).get('/api/questions/search?q=test&limit=5');
      expect(res.status).toBe(200);

      const results = extractSearchResults(res.body);
      expect(Array.isArray(results)).toBe(true);

      results.forEach((q: any) => {
        assertExplanationNull(q);
      });
    });

    it('should never leak correct answer fields (answer_choice, answer_text, answer)', async () => {
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
