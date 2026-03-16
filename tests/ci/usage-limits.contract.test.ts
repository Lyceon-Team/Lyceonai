import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const accountMocks = vi.hoisted(() => ({
  checkUsageLimit: vi.fn(),
  incrementUsage: vi.fn(),
  getAccountIdForUser: vi.fn(),
  ensureAccountForUser: vi.fn(),
  resolveLinkedPairPremiumAccessForStudent: vi.fn(),
  resolveLinkedPairPremiumAccessForGuardian: vi.fn(),
}));

vi.mock('../../server/lib/account', () => ({
  checkUsageLimit: accountMocks.checkUsageLimit,
  incrementUsage: accountMocks.incrementUsage,
  getAccountIdForUser: accountMocks.getAccountIdForUser,
  ensureAccountForUser: accountMocks.ensureAccountForUser,
  resolveLinkedPairPremiumAccessForStudent: accountMocks.resolveLinkedPairPremiumAccessForStudent,
  resolveLinkedPairPremiumAccessForGuardian: accountMocks.resolveLinkedPairPremiumAccessForGuardian,
  FREE_TIER_LIMITS: {
    practice: 10,
    ai_chat: 5,
  },
}));

vi.mock('../../server/middleware/supabase-auth', () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));

const { createUsageLimitMiddleware } = await import('../../server/middleware/usage-limits');

function createResMock(statusCode = 200) {
  const finishHandlers: Array<() => void> = [];
  const res: any = {
    statusCode,
    body: undefined,
    once: vi.fn((event: string, cb: () => void) => {
      if (event === 'finish') {
        finishHandlers.push(cb);
      }
      return res;
    }),
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
    triggerFinish: () => {
      for (const cb of finishHandlers) {
        cb();
      }
    },
  };

  return res as Response & { triggerFinish: () => void; body?: unknown };
}

describe('Usage Limit Middleware Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountMocks.getAccountIdForUser.mockResolvedValue('acc-test');
    accountMocks.resolveLinkedPairPremiumAccessForStudent.mockResolvedValue({
      hasPremiumAccess: false,
    });
    accountMocks.resolveLinkedPairPremiumAccessForGuardian.mockResolvedValue({
      hasPremiumAccess: false,
    });
    accountMocks.checkUsageLimit.mockResolvedValue({
      allowed: true,
      current: 0,
      limit: 5,
      resetAt: 'tomorrow',
    });
    accountMocks.incrementUsage.mockResolvedValue({
      practice_questions_used: 1,
      ai_messages_used: 0,
    });
  });

  it('increments usage on success only when using on_success strategy', async () => {
    const middleware = createUsageLimitMiddleware('ai_chat', { incrementStrategy: 'on_success' });
    const req = {
      requestId: 'req-usage-1',
      user: {
        id: 'student-1',
        role: 'student',
      },
    } as unknown as Request;
    const res = createResMock(200);
    const next = vi.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(accountMocks.incrementUsage).not.toHaveBeenCalled();

    res.statusCode = 200;
    res.triggerFinish();
    await Promise.resolve();

    expect(accountMocks.incrementUsage).toHaveBeenCalledTimes(1);
    expect(accountMocks.incrementUsage).toHaveBeenCalledWith('acc-test', 'ai_chat');
  });

  it('does not increment usage when downstream response is denied', async () => {
    const middleware = createUsageLimitMiddleware('ai_chat', { incrementStrategy: 'on_success' });
    const req = {
      requestId: 'req-usage-2',
      user: {
        id: 'student-1',
        role: 'student',
      },
    } as unknown as Request;
    const res = createResMock(403);
    const next = vi.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    res.statusCode = 403;
    res.triggerFinish();
    await Promise.resolve();

    expect(accountMocks.incrementUsage).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when usage checks throw', async () => {
    accountMocks.checkUsageLimit.mockRejectedValue(new Error('db unavailable'));

    const middleware = createUsageLimitMiddleware('practice');
    const req = {
      requestId: 'req-usage-3',
      user: {
        id: 'student-1',
        role: 'student',
      },
    } as unknown as Request;
    const res = createResMock(200);
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Usage check unavailable',
      code: 'USAGE_CHECK_UNAVAILABLE',
      message: 'Unable to verify usage limits at this time. Please retry shortly.',
      requestId: 'req-usage-3',
    });
  });
});
