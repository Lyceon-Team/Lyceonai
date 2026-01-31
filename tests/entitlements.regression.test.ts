import { it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';

// Import the Express app directly if exported, else require here
import app from '../server/index';
import { describeIfSupabaseEnv } from './helpers/supabaseEnv';

let server: http.Server;
let baseUrl: string;

const describeWithSupabase = describeIfSupabaseEnv();

describeWithSupabase('Entitlement/Auth Regression Invariants', () => {
  beforeAll((done) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address() as any;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

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

  it('rag_v2_userid_ignored_from_body', async () => {
    vi.resetModules();
    const handleRagQueryMock = vi.fn(async (args) => ({ ok: true, args }));
    vi.mock('../lib/rag-service', () => ({
      getRagService: () => ({ handleRagQuery: handleRagQueryMock }),
    }));
    const ragV2Router = (await import('../apps/api/src/routes/rag-v2')).default;
    const req: any = {
      user: { id: 'real-user' },
      body: { userId: 'victim-id', message: 'hi', mode: 'concept' },
    };
    let statusCode = 0;
    const res: any = {
      status(code: number) { statusCode = code; return this; },
      json(obj: any) { this.body = obj; return this; },
    };
    const next = () => {};
    const postHandler = ragV2Router.stack.find(
      (r: any) => r.route && r.route.path === '/' && r.route.methods.post
    ).route.stack[0].handle;
    await postHandler(req, res, next);
    expect(handleRagQueryMock).toHaveBeenCalledTimes(1);
    const calledWith = handleRagQueryMock.mock.calls[0][0];
    expect(calledWith.userId).toBe('real-user');
    expect(calledWith.userId).not.toBe('victim-id');
    expect(statusCode).toBeGreaterThanOrEqual(200);
    expect(statusCode).toBeLessThan(300);
  });

  it('admin_db_health_requires_admin', async () => {
    const res = await fetch(`${baseUrl}/api/admin/db-health`);
    expect([401, 403]).toContain(res.status);
  });
});
