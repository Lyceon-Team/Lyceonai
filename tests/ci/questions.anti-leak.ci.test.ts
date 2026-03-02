/**
 * CI Security Tests - Question Anti-Leak
 * 
 * These tests validate that student/public question retrieval endpoints
 * NEVER leak sensitive data like explanations or correct answers.
 * 
 * SECURITY GUARANTEES TESTED:
 * 1. GET /api/questions/recent never returns explanation (must be null)
 * 2. GET /api/questions/recent never returns correct answer fields
 * 3. GET /api/questions/random never returns explanation (must be null)
 * 4. GET /api/questions/random never returns correct answer fields
 * 5. Tests are tolerant to empty data environments
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

describe('CI Security Tests - Question Anti-Leak', () => {
  let app: Express;

  beforeAll(async () => {
    // Set test environment
    process.env.VITEST = 'true';
    process.env.NODE_ENV = 'test';
    
    // Import app
    const serverModule = await import('../../server/index');
    app = serverModule.default;

    // ------------------------------------------------------------------
    // TEST-ONLY ROUTES
    // ------------------------------------------------------------------
    // Create new endpoints that bypass the authentication middleware so the
    // anti-leak tests can exercise the question handlers directly. These
    // routes are only used by the tests and do not exist in production.
    const { getRandomQuestions, getQuestions } = await import(
      '../../apps/api/src/routes/questions'
    );

    function registerNoAuthPath(path: string, handler: any) {
      app.get(path, async (req, res) => {
        // Wrap array responses the same way the real server does
        const originalJson = res.json.bind(res);
        res.json = function (data: any) {
          if (Array.isArray(data)) {
            return originalJson.call(res, { questions: data, meta: { total: data.length } });
          }
          return originalJson.call(res, data);
        };
        return handler(req, res);
      });
    }

    registerNoAuthPath('/__test/questions/random', getRandomQuestions);
    registerNoAuthPath('/__test/questions', getQuestions);
  });

  afterAll(() => {
    delete process.env.VITEST;
  });

  describe('GET /api/questions/recent - Anti-Leak Protection', () => {
    it('should never leak explanation field to students (must be null)', async () => {
      const res = await request(app)
        .get('/api/questions/recent?limit=5');
      
      // Should succeed
      expect(res.status).toBe(200);
      
      // Extract questions array (tolerant to both array and {questions:[...]} formats)
      const questions = extractQuestions(res.body);
      expect(Array.isArray(questions)).toBe(true);
      
      // If there are questions returned, verify they don't leak explanation
      if (questions.length > 0) {
        questions.forEach((question: any) => {
          // Explanation must be null (not undefined, not a string)
          expect(question).toHaveProperty('explanation');
          expect(question.explanation).toBeNull();
        });
      }
    });

    it('should never leak correct answer fields (answer_choice, answer_text, answer)', async () => {
      const res = await request(app)
        .get('/api/questions/recent?limit=5');
      
      expect(res.status).toBe(200);
      
      // Extract questions array (tolerant to both array and {questions:[...]} formats)
      const questions = extractQuestions(res.body);
      expect(Array.isArray(questions)).toBe(true);
      
      // If there are questions returned, verify they don't leak answers
      if (questions.length > 0) {
        questions.forEach((question: any) => {
          // None of these answer fields should be present
          expect(question).not.toHaveProperty('answer_choice');
          expect(question).not.toHaveProperty('answer_text');
          expect(question).not.toHaveProperty('answer');
          expect(question).not.toHaveProperty('correctAnswerKey');
        });
      }
    });

    it('should handle empty results gracefully (no crash on 0 questions)', async () => {
      const res = await request(app)
        .get('/api/questions/recent?limit=5');
      
      // Should succeed even if empty
      expect(res.status).toBe(200);
      
      // Extract questions array (tolerant to both array and {questions:[...]} formats)
      const questions = extractQuestions(res.body);
      expect(Array.isArray(questions)).toBe(true);
      // No assertion on length - could be 0 or more
    });
  });

  describe('GET /api/questions/random - Anti-Leak Protection', () => {
    it('should never leak explanation field to students (must be null)', async () => {
      // Note: This endpoint requires authentication; use the test-only
      // bypass route to exercise the handler.
      const res = await request(app)
        .get('/__test/questions/random?limit=5');
      
      // May return 401 if auth is required
      if (res.status === 200) {
        // Extract questions array (tolerant to both array and {questions:[...]} formats)
        const questions = extractQuestions(res.body);
        expect(Array.isArray(questions)).toBe(true);
        
        // If there are questions returned, verify they don't leak explanation
        if (questions.length > 0) {
          questions.forEach((question: any) => {
            // Explanation must be null (not undefined, not a string)
            expect(question).toHaveProperty('explanation');
            expect(question.explanation).toBeNull();
          });
        }
      } else {
        // If auth is required (401), that's fine - we can't test without auth
        // But we can verify error response doesn't leak data
        expect([401, 403]).toContain(res.status);
        expect(res.body).not.toHaveProperty('explanation');
        expect(res.body).not.toHaveProperty('answer_choice');
      }
    });

    it('should never leak correct answer fields (answer_choice, answer_text, answer)', async () => {
      const res = await request(app)
        .get('/__test/questions/random?limit=5');
      
      // Only test anti-leak if we get a successful response
      if (res.status === 200) {
        // Extract questions array (tolerant to both array and {questions:[...]} formats)
        const questions = extractQuestions(res.body);
        expect(Array.isArray(questions)).toBe(true);
        
        // If there are questions returned, verify they don't leak answers
        if (questions.length > 0) {
          questions.forEach((question: any) => {
            // None of these answer fields should be present
            expect(question).not.toHaveProperty('answer_choice');
            expect(question).not.toHaveProperty('answer_text');
            expect(question).not.toHaveProperty('answer');
            expect(question).not.toHaveProperty('correctAnswerKey');
          });
        }
      } else {
        // If auth is required, verify error response doesn't leak
        expect([401, 403]).toContain(res.status);
        expect(res.body).not.toHaveProperty('explanation');
        expect(res.body).not.toHaveProperty('answer_choice');
      }
    });
  });

  describe('GET /api/questions - Anti-Leak Protection', () => {
    it('should never leak explanation field to students (must be null)', async () => {
      // This endpoint requires authentication; use the test-only bypass
      // route so we can hit it in CI
      const res = await request(app)
        .get('/__test/questions?limit=5');
      
      // Expect auth requirement
      if (res.status === 200) {
        // Extract questions array (tolerant to both array and {questions:[...]} formats)
        const questions = extractQuestions(res.body);
        expect(Array.isArray(questions)).toBe(true);
        
        // If there are questions returned, verify they don't leak explanation
        if (questions.length > 0) {
          questions.forEach((question: any) => {
            // Explanation must be null (not undefined, not a string)
            expect(question).toHaveProperty('explanation');
            expect(question.explanation).toBeNull();
          });
        }
      } else {
        // Auth required - verify error response doesn't leak
        expect([401, 403]).toContain(res.status);
      }
    });

    it('should never leak correct answer fields', async () => {
      const res = await request(app)
        .get('/__test/questions?limit=5');
      
      if (res.status === 200) {
        // Extract questions array (tolerant to both array and {questions:[...]} formats)
        const questions = extractQuestions(res.body);
        expect(Array.isArray(questions)).toBe(true);
        
        // If there are questions returned, verify they don't leak answers
        if (questions.length > 0) {
          questions.forEach((question: any) => {
            expect(question).not.toHaveProperty('answer_choice');
            expect(question).not.toHaveProperty('answer_text');
            expect(question).not.toHaveProperty('answer');
          });
        }
      } else {
        // Auth required
        expect([401, 403]).toContain(res.status);
      }
    });
  });
});
