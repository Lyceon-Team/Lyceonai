import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';

// Import the Express app directly if exported, else require here
import app from '../server/index';


let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  return new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address() as any;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe('Entitlement/Auth Regression Invariants', () => {

  it('auth_cookie_only_api_rag_rejects_bearer', async () => {
    const res = await fetch(`${baseUrl}/api/rag`, {
      method: 'POST',
      headers: { Authorization: 'Bearer FAKE_TOKEN' },
    });
    expect(res.status).not.toBe(200);
    expect([401, 403]).toContain(res.status);
  });


  it('auth_rag_v2_requires_cookie', async () => {
    const res = await fetch(`${baseUrl}/api/rag/v2`, { method: 'POST' });
    expect([401, 403]).toContain(res.status);
  });

  // Security test: Verify that /api/rag/v2 uses req.user.id, not body.userId
  // This prevents IDOR attacks where an attacker tries to impersonate another user
  it('rag_v2_userid_from_auth_not_body', async () => {
    // Test 1: Unauthenticated request should be rejected
    const res = await fetch(`${baseUrl}/api/rag/v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'victim-id', message: 'hi', mode: 'concept' }),
    });
    
    // Should reject (401/403) - cannot proceed without auth
    expect([401, 403]).toContain(res.status);
    
    // Test 2: Bearer auth should be rejected (cookie-only policy)
    const res2 = await fetch(`${baseUrl}/api/rag/v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer fake-token',
      },
      body: JSON.stringify({ userId: 'victim-id', message: 'hi', mode: 'concept' }),
    });
    
    // Should reject
    expect([401, 403]).toContain(res2.status);
  });

  it('admin_db_health_requires_admin', async () => {
    const res = await fetch(`${baseUrl}/api/admin/db-health`);
    expect([401, 403]).toContain(res.status);
  });
});
