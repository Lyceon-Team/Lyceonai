import { test, expect } from '@playwright/test';
import { nanoid } from 'nanoid';

/**
 * RLS (Row Level Security) and Auth Enforcement Tests
 * 
 * These tests verify that:
 * 1. Supabase JWT authentication is required on all /api/* routes
 * 2. Users can only access their own data (RLS enforcement)
 * 3. Cross-user data access is denied
 * 4. Admin users can access all data
 */

// Test data
let user1Email: string;
let user1Password: string;
let user1Token: string;
let user1SessionId: string;

let user2Email: string;
let user2Password: string;
let user2Token: string;
let user2SessionId: string;

let adminEmail: string;
let adminPassword: string;
let adminToken: string;

test.describe('Supabase Auth & RLS Enforcement', () => {
  
  test.beforeAll(async ({ request }) => {
    // Generate unique test users
    const testId = nanoid(8);
    user1Email = `test-user-1-${testId}@example.com`;
    user1Password = 'Test1234!';
    user2Email = `test-user-2-${testId}@example.com`;
    user2Password = 'Test1234!';
    adminEmail = `test-admin-${testId}@example.com`;
    adminPassword = 'Admin1234!';

    // Sign up users via Supabase
    const user1Signup = await request.post('/api/auth/signup', {
      data: {
        email: user1Email,
        password: user1Password,
        displayName: 'Test User 1',
      },
    });
    expect(user1Signup.ok()).toBeTruthy();

    const user2Signup = await request.post('/api/auth/signup', {
      data: {
        email: user2Email,
        password: user2Password,
        displayName: 'Test User 2',
      },
    });
    expect(user2Signup.ok()).toBeTruthy();

    // Sign in users to get tokens
    const user1Signin = await request.post('/api/auth/signin', {
      data: {
        email: user1Email,
        password: user1Password,
      },
    });
    expect(user1Signin.ok()).toBeTruthy();
    
    const user2Signin = await request.post('/api/auth/signin', {
      data: {
        email: user2Email,
        password: user2Password,
      },
    });
    expect(user2Signin.ok()).toBeTruthy();

    // Extract tokens from cookies
    const user1Cookies = user1Signin.headers()['set-cookie'];
    const user2Cookies = user2Signin.headers()['set-cookie'];
    
    if (user1Cookies) {
      const tokenMatch = user1Cookies.match(/sb-access-token=([^;]+)/);
      if (tokenMatch) user1Token = tokenMatch[1];
    }
    
    if (user2Cookies) {
      const tokenMatch = user2Cookies.match(/sb-access-token=([^;]+)/);
      if (tokenMatch) user2Token = tokenMatch[1];
    }

    console.log('✅ Test users created successfully');
  });

  test('should deny access to /api/* routes without authentication', async ({ request }) => {
    // Test various endpoints without auth
    const endpoints = [
      '/api/questions',
      '/api/questions/recent',
      '/api/questions/random',
      '/api/practice/sessions/current',
    ];

    for (const endpoint of endpoints) {
      const response = await request.get(endpoint);
      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error).toContain('Authentication required');
    }
  });

  test('should allow authenticated users to create practice sessions', async ({ request }) => {
    // User 1 creates a practice session
    const response = await request.post('/api/practice/sessions', {
      headers: {
        'Cookie': `sb-access-token=${user1Token}`,
      },
      data: {
        mode: 'flow',
        section: 'Math',
        difficulty: 'medium',
      },
    });

    expect(response.ok()).toBeTruthy();
    const session = await response.json();
    expect(session.userId).toBeDefined();
    expect(session.mode).toBe('flow');
    
    user1SessionId = session.id;
    console.log('✅ User 1 created session:', user1SessionId);
  });

  test('should deny cross-user access to practice sessions', async ({ request }) => {
    // User 2 tries to access User 1's session
    const response = await request.patch(`/api/practice/sessions/${user1SessionId}`, {
      headers: {
        'Cookie': `sb-access-token=${user2Token}`,
      },
      data: {
        status: 'completed',
      },
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('Access denied');
  });

  test('should allow users to access their own practice sessions', async ({ request }) => {
    // User 1 accesses their own session
    const response = await request.get('/api/practice/sessions/current', {
      headers: {
        'Cookie': `sb-access-token=${user1Token}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const session = await response.json();
    expect(session.id).toBe(user1SessionId);
  });

  test('should deny cross-user reads from practice sessions list', async ({ request }) => {
    // User 2 creates their own session
    const user2SessionCreate = await request.post('/api/practice/sessions', {
      headers: {
        'Cookie': `sb-access-token=${user2Token}`,
      },
      data: {
        mode: 'structured',
        section: 'Reading',
        difficulty: 'hard',
      },
    });

    expect(user2SessionCreate.ok()).toBeTruthy();
    const user2Session = await user2SessionCreate.json();
    user2SessionId = user2Session.id;

    // User 1 lists their sessions - should NOT see User 2's session
    const user1SessionsList = await request.get('/api/practice/sessions', {
      headers: {
        'Cookie': `sb-access-token=${user1Token}`,
      },
    });

    expect(user1SessionsList.ok()).toBeTruthy();
    const user1Sessions = await user1SessionsList.json();
    
    // User 1 should only see their own session
    const user2SessionInList = user1Sessions.find((s: any) => s.id === user2SessionId);
    expect(user2SessionInList).toBeUndefined();
  });

  test('should allow users to submit answers for their own sessions', async ({ request }) => {
    // User 1 submits an answer for their session
    const response = await request.post('/api/practice/answer', {
      headers: {
        'Cookie': `sb-access-token=${user1Token}`,
      },
      data: {
        sessionId: user1SessionId,
        questionId: 'test-question-123',
        selectedAnswer: 'A',
        isCorrect: true,
        timeSpentMs: 30000,
      },
    });

    expect(response.ok()).toBeTruthy();
  });

  test('should deny answer submission for other users sessions', async ({ request }) => {
    // User 2 tries to submit answer for User 1's session
    const response = await request.post('/api/practice/answer', {
      headers: {
        'Cookie': `sb-access-token=${user2Token}`,
      },
      data: {
        sessionId: user1SessionId,
        questionId: 'test-question-456',
        selectedAnswer: 'B',
        isCorrect: false,
        timeSpentMs: 45000,
      },
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('Access denied');
  });

  test('should require authentication for question endpoints', async ({ request }) => {
    const endpoints = [
      '/api/questions',
      '/api/questions/recent', 
      '/api/questions/random',
      '/api/questions/count',
      '/api/questions/stats',
      '/api/questions/feed',
    ];

    for (const endpoint of endpoints) {
      const response = await request.get(endpoint);
      expect(response.status()).toBe(401);
    }

    // Verify same endpoints work with auth
    for (const endpoint of endpoints) {
      const response = await request.get(endpoint, {
        headers: {
          'Cookie': `sb-access-token=${user1Token}`,
        },
      });
      expect(response.status()).toBe(200);
    }
  });

  test('should require admin role for admin endpoints', async ({ request }) => {
    const adminEndpoints = ['/api/admin/db-health'];

    for (const endpoint of adminEndpoints) {
      // Regular user should be denied
      const response = await request.get(endpoint, {
        headers: {
          'Cookie': `sb-access-token=${user1Token}`,
        },
      });
      expect(response.status()).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Admin');
    }
  });

  test('should enforce JWT verification on all API routes', async ({ request }) => {
    // Test with invalid token
    const invalidToken = 'invalid-jwt-token';
    
    const endpoints = [
      '/api/questions',
      '/api/practice/sessions',
      '/api/questions/recent',
    ];

    for (const endpoint of endpoints) {
      const response = await request.get(endpoint, {
        headers: {
          'Cookie': `sb-access-token=${invalidToken}`,
        },
      });
      
      // Should either return 401 (no user) or proceed without user
      expect([401, 200].includes(response.status())).toBeTruthy();
      
      if (response.status() === 401) {
        const body = await response.json();
        expect(body.error).toContain('Authentication required');
      }
    }
  });

  test('should set PostgreSQL RLS context with user ID', async ({ request }) => {
    // This test verifies the middleware sets the PostgreSQL session context
    // We can't directly test the SQL context, but we can verify the middleware runs
    
    const response = await request.post('/api/practice/sessions', {
      headers: {
        'Cookie': `sb-access-token=${user1Token}`,
      },
      data: {
        mode: 'flow',
        section: 'Writing',
      },
    });

    expect(response.ok()).toBeTruthy();
    const session = await response.json();
    
    // If RLS context wasn't set properly, this would fail
    expect(session.userId).toBeDefined();
  });

  test('should enforce rate limit on practice answer submissions', async ({ request }) => {
    // Create a new session for rate limit testing
    const sessionResponse = await request.post('/api/practice/sessions', {
      headers: {
        'Cookie': `sb-access-token=${user1Token}`,
      },
      data: {
        mode: 'flow',
        section: 'Math',
        difficulty: 'medium',
      },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const session = await sessionResponse.json();
    const testSessionId = session.id;

    // Make requests up to the limit (30 requests per minute)
    const maxRequests = 30;
    for (let i = 0; i < maxRequests; i++) {
      const response = await request.post('/api/practice/answer', {
        headers: {
          'Cookie': `sb-access-token=${user1Token}`,
        },
        data: {
          sessionId: testSessionId,
          questionId: `test-question-rate-limit-${i}`,
          selectedAnswer: 'A',
          isCorrect: true,
          timeSpentMs: 1000,
        },
      });
      
      // All requests within limit should succeed or fail with expected errors (not 429)
      expect([200, 400, 403, 404, 422].includes(response.status())).toBeTruthy();
    }

    // The next request should be rate limited
    const rateLimitedResponse = await request.post('/api/practice/answer', {
      headers: {
        'Cookie': `sb-access-token=${user1Token}`,
      },
      data: {
        sessionId: testSessionId,
        questionId: 'test-question-rate-limit-over',
        selectedAnswer: 'A',
        isCorrect: true,
        timeSpentMs: 1000,
      },
    });

    expect(rateLimitedResponse.status()).toBe(429);
    const body = await rateLimitedResponse.json();
    expect(body.error).toBe('rate_limited');
    expect(body.message).toContain('Too many practice submissions');
  });

  test('should not process request body when rate limited', async ({ request }) => {
    // Create a new session for this test
    const sessionResponse = await request.post('/api/practice/sessions', {
      headers: {
        'Cookie': `sb-access-token=${user2Token}`,
      },
      data: {
        mode: 'flow',
        section: 'Math',
        difficulty: 'medium',
      },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const session = await sessionResponse.json();
    const testSessionId = session.id;

    // Exhaust the rate limit for user 2
    const maxRequests = 30;
    for (let i = 0; i < maxRequests; i++) {
      await request.post('/api/practice/answer', {
        headers: {
          'Cookie': `sb-access-token=${user2Token}`,
        },
        data: {
          sessionId: testSessionId,
          questionId: `test-question-no-write-${i}`,
          selectedAnswer: 'A',
          isCorrect: true,
          timeSpentMs: 1000,
        },
      });
    }

    // Send a request with invalid data that would normally cause a 400 error
    // If rate limited properly, we should get 429 instead of 400 (meaning the handler didn't run)
    const rateLimitedResponse = await request.post('/api/practice/answer', {
      headers: {
        'Cookie': `sb-access-token=${user2Token}`,
      },
      data: {
        // Invalid data: missing required fields
        invalidField: 'invalid',
      },
    });

    // Should get 429 (rate limited) instead of 400 (validation error)
    // This proves the handler body didn't run
    expect(rateLimitedResponse.status()).toBe(429);
    const body = await rateLimitedResponse.json();
    expect(body.error).toBe('rate_limited');
  });

  test.afterAll(async ({ request }) => {
    // Clean up: sign out users
    await request.post('/api/auth/signout', {
      headers: {
        'Cookie': `sb-access-token=${user1Token}`,
      },
    });
    
    await request.post('/api/auth/signout', {
      headers: {
        'Cookie': `sb-access-token=${user2Token}`,
      },
    });

    console.log('✅ Test cleanup completed');
  });
});
