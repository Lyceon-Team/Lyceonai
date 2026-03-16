import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const authState = vi.hoisted(() => ({
  currentUser: {
    id: 'guardian-1',
    role: 'guardian',
    email: 'guardian@test.com',
    isGuardian: true,
    isAdmin: false,
  } as any,
}));

const accountMocks = vi.hoisted(() => ({
  getPrimaryGuardianLink: vi.fn(),
  ensureAccountForUser: vi.fn(),
  getOrCreateEntitlement: vi.fn(),
  resolveLinkedPairPremiumAccessForGuardian: vi.fn(),
  resolveLinkedPairPremiumAccessForStudent: vi.fn(),
  mapStripeStatusToEntitlement: vi.fn(),
  upsertEntitlement: vi.fn(),
}));

vi.mock('../../server/middleware/csrf', () => ({
  csrfGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/middleware/supabase-auth', () => ({
  requireSupabaseAuth: (req: any, res: any, next: any) => {
    if (!authState.currentUser) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'You must be signed in to access this resource',
        requestId: req.requestId,
      });
    }

    req.user = authState.currentUser;
    req.requestId ??= 'req-identity-entitlement';
    return next();
  },
  requireRequestUser: (req: any, res: any) => {
    if (!req.user?.id) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'You must be signed in to access this resource',
        requestId: req.requestId,
      });
      return null;
    }

    return req.user;
  },
  getSupabaseAdmin: vi.fn(() => ({})),
  sendUnauthenticated: (res: any, requestId?: string) =>
    res.status(401).json({
      error: 'Authentication required',
      message: 'You must be signed in to access this resource',
      requestId,
    }),
}));

vi.mock('../../server/lib/account', () => ({
  getPrimaryGuardianLink: accountMocks.getPrimaryGuardianLink,
  ensureAccountForUser: accountMocks.ensureAccountForUser,
  getOrCreateEntitlement: accountMocks.getOrCreateEntitlement,
  resolveLinkedPairPremiumAccessForGuardian: accountMocks.resolveLinkedPairPremiumAccessForGuardian,
  resolveLinkedPairPremiumAccessForStudent: accountMocks.resolveLinkedPairPremiumAccessForStudent,
  mapStripeStatusToEntitlement: accountMocks.mapStripeStatusToEntitlement,
  upsertEntitlement: accountMocks.upsertEntitlement,
}));

vi.mock('../../server/lib/stripeClient', () => ({
  getUncachableStripeClient: vi.fn(async () => ({
    prices: {
      retrieve: vi.fn(async () => ({ id: 'price_monthly' })),
    },
    customers: {
      create: vi.fn(async () => ({ id: 'cus_test' })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({ id: 'cs_test', url: 'https://checkout.test/session' })),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async () => ({ url: 'https://billing.test/session' })),
      },
    },
    subscriptions: {
      list: vi.fn(async () => ({ data: [] })),
    },
  })),
  getStripePublishableKeySafe: vi.fn(() => 'pk_test_123'),
}));

vi.mock('../../server/lib/billingStorage', () => ({
  billingStorage: {
    listProducts: vi.fn(async () => []),
    getProduct: vi.fn(async () => null),
    getPricesForProduct: vi.fn(async () => []),
  },
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.requestId ??= 'req-identity-entitlement';
    next();
  });

  return app;
}

describe('Identity + Entitlement Runtime Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = {
      id: 'guardian-1',
      role: 'guardian',
      email: 'guardian@test.com',
      isGuardian: true,
      isAdmin: false,
    } as any;

    accountMocks.getPrimaryGuardianLink.mockResolvedValue(null);
    accountMocks.ensureAccountForUser.mockResolvedValue('acc-student-1');
    accountMocks.getOrCreateEntitlement.mockResolvedValue({
      account_id: 'acc-student-1',
      plan: 'free',
      status: 'inactive',
      current_period_end: null,
      stripe_subscription_id: null,
      stripe_customer_id: null,
    });
    accountMocks.resolveLinkedPairPremiumAccessForGuardian.mockResolvedValue({
      role: 'guardian',
      hasPremiumAccess: false,
      hasActiveLink: false,
      premiumSource: 'none',
      reason: 'Guardian has no linked student.',
      studentUserId: null,
      guardianUserId: 'guardian-1',
      studentAccountId: null,
      guardianAccountId: 'acc-guardian-1',
      studentEntitlementStatus: 'missing',
      guardianEntitlementStatus: 'inactive',
      studentEntitlementExpired: false,
      guardianEntitlementExpired: false,
    });
    accountMocks.resolveLinkedPairPremiumAccessForStudent.mockResolvedValue({
      role: 'student',
      hasPremiumAccess: false,
      hasActiveLink: false,
      premiumSource: 'none',
      reason: 'Student account does not have an active premium entitlement.',
      studentUserId: 'student-1',
      guardianUserId: null,
      studentAccountId: 'acc-student-1',
      guardianAccountId: null,
      studentEntitlementStatus: 'inactive',
      guardianEntitlementStatus: 'missing',
      studentEntitlementExpired: false,
      guardianEntitlementExpired: false,
    });
  });

  it('blocks direct role mutation through PATCH /api/profile and points to support', async () => {
    const app = buildApp();
    const profileRoutes = (await import('../../server/routes/profile-routes')).default;
    const { requireSupabaseAuth } = await import('../../server/middleware/supabase-auth');

    app.use('/api/profile', requireSupabaseAuth as any, profileRoutes);

    const res = await request(app)
      .patch('/api/profile')
      .send({ role: 'student' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Role changes are support-mediated only',
      message: 'Email support@lyceon.ai to request a role review.',
      supportEmail: 'support@lyceon.ai',
    });
  });

  it('returns an explicit guardian placeholder state when no linked student exists', async () => {
    const app = buildApp();
    const billingRoutes = (await import('../../server/routes/billing-routes')).default;
    app.use('/api/billing', billingRoutes);

    const res = await request(app).get('/api/billing/status');

    expect(res.status).toBe(200);
    expect(res.body.linkRequiredForPremium).toBe(true);
    expect(res.body.lockedReason).toBe('link_required');
    expect(res.body.effectiveAccess).toBe(false);
    expect(res.body.billingOwnerRole).toBe('student');
  });

  it('denies guardian checkout until a student link exists', async () => {
    process.env.STRIPE_PRICE_PARENT_MONTHLY = 'price_monthly';
    process.env.STRIPE_PRICE_PARENT_QUARTERLY = 'price_quarterly';
    process.env.STRIPE_PRICE_PARENT_YEARLY = 'price_yearly';

    const app = buildApp();
    const billingRoutes = (await import('../../server/routes/billing-routes')).default;
    app.use('/api/billing', billingRoutes);

    const res = await request(app)
      .post('/api/billing/checkout')
      .set('Origin', 'http://localhost:5000')
      .send({ plan: 'monthly' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({
      error: 'Link a student before starting guardian checkout',
      code: 'LINKED_STUDENT_REQUIRED',
    }));
  });

  it('uses linked student entitlement state for guardian billing status', async () => {
    const app = buildApp();
    const billingRoutes = (await import('../../server/routes/billing-routes')).default;
    app.use('/api/billing', billingRoutes);

    accountMocks.getPrimaryGuardianLink.mockResolvedValue({
      student_user_id: 'student-1',
      account_id: 'acc-student-1',
    });
    accountMocks.resolveLinkedPairPremiumAccessForGuardian.mockResolvedValue({
      role: 'guardian',
      hasPremiumAccess: false,
      hasActiveLink: true,
      premiumSource: 'none',
      reason: 'Linked student account does not have an active premium entitlement.',
      studentUserId: 'student-1',
      guardianUserId: 'guardian-1',
      studentAccountId: 'acc-student-1',
      guardianAccountId: 'acc-guardian-1',
      studentEntitlementStatus: 'inactive',
      guardianEntitlementStatus: 'active',
      studentEntitlementExpired: false,
      guardianEntitlementExpired: false,
    });

    const res = await request(app).get('/api/billing/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      accountId: 'acc-student-1',
      effectiveAccess: false,
      requiresStudentSubscription: true,
      lockedReason: 'student_subscription_required',
      billingOwnerRole: 'student',
      premiumSource: 'none',
    }));
  });
});
