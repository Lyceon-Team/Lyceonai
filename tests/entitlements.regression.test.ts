import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server/index';

describe('Entitlement/Auth Regression Invariants', () => {

  it('admin_db_health_requires_admin', async () => {
    const res = await request(app).get('/api/admin/db-health');
    expect([401, 403]).toContain(res.status);
  });
});
