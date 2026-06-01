import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const accountMocks = {
  createGuardianLink: vi.fn(),
  revokeGuardianLink: vi.fn(),
  isGuardianLinkedToStudent: vi.fn(),
  getAllGuardianStudentLinks: vi.fn(),
  ensureAccountForUser: vi.fn(),
};

const supabaseFromMock = vi.fn();

vi.mock('../../server/middleware/supabase-auth', async () => {
  const actual = await vi.importActual<typeof import('../../server/middleware/supabase-auth')>(
    '../../server/middleware/supabase-auth'
  );

  return {
    ...actual,
    getSupabaseAdmin: vi.fn(() => ({})),
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'guardian-1',
        role: 'guardian',
        email: 'guardian@test.com',
      };
      req.requestId ??= 'req-guardian-link-contract';
      next();
    },
  };
});

vi.mock('../../server/middleware/guardian-role', () => ({
  requireGuardianRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/middleware/csrf', () => ({
  csrfGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/middleware/csrf-double-submit', () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => 'test-csrf-token',
}));

vi.mock('../../server/lib/durable-rate-limiter', () => ({
  createDurableRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../apps/api/src/lib/supabase-server', () => ({
  supabaseServer: {
    from: supabaseFromMock,
  },
}));

vi.mock('../../server/lib/account', () => accountMocks);
vi.mock('../../server/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function mockSupabaseForLinkLookup() {
  supabaseFromMock.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: {
                  id: 'student-1',
                  email: 'student@test.com',
                  display_name: 'Student One',
                },
                error: null,
              })),
            })),
          })),
        })),
      };
    }

    if (table === 'guardian_link_audit') {
      return {
        insert: vi.fn(async () => ({ error: null })),
      };
    }

    throw new Error(`Unexpected table mock request: ${table}`);
  });
}

describe('Guardian Linking 1:1 Enforcement Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseForLinkLookup();
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(false);
    accountMocks.ensureAccountForUser.mockResolvedValue('acc-student-1');
  });

  it('returns 409 when guardian already has a different active linked student', async () => {
    const conflict = new Error('Guardian already has an active linked student') as Error & { code?: string };
    conflict.code = 'GUARDIAN_ALREADY_LINKED';
    accountMocks.createGuardianLink.mockRejectedValue(conflict);

    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/guardian', router);

    const res = await request(app)
      .post('/api/guardian/link')
      .send({ code: 'ABC12345' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GUARDIAN_ALREADY_LINKED');
    expect(res.body.error).toContain('Guardian already linked to another student');
  }, 15000);

  it('returns anti-enumeration 404 when student already linked to another guardian', async () => {
    const conflict = new Error('Student is already linked to another guardian') as Error & { code?: string };
    conflict.code = 'STUDENT_ALREADY_LINKED';
    accountMocks.createGuardianLink.mockRejectedValue(conflict);

    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/guardian', router);

    const res = await request(app)
      .post('/api/guardian/link')
      .send({ code: 'ABC12345' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Invalid or unavailable student code');
  }, 15000);
});

