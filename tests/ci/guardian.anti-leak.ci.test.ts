import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { requireGuardianEntitlement } from '../../server/middleware/guardian-entitlement';
import * as accountLib from '../../server/lib/account';

vi.mock('../../server/lib/account', () => ({
  resolveLinkedPairPremiumAccessForGuardian: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }
}));

type GuardianAccessMock = {
  role: 'guardian';
  hasPremiumAccess: boolean;
  hasActiveLink: boolean;
  premiumSource: 'student' | 'guardian' | 'both' | 'none';
  reason: string;
  studentUserId: string | null;
  guardianUserId: string | null;
  studentAccountId: string | null;
  guardianAccountId: string | null;
  studentEntitlementStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive' | 'missing';
  guardianEntitlementStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive' | 'missing';
  studentEntitlementExpired: boolean;
  guardianEntitlementExpired: boolean;
};

function buildAccess(overrides: Partial<GuardianAccessMock> = {}): GuardianAccessMock {
  return {
    role: 'guardian',
    hasPremiumAccess: false,
    hasActiveLink: true,
    premiumSource: 'none',
    reason: 'No active paid entitlement on linked student-guardian pair.',
    studentUserId: 'student-456',
    guardianUserId: 'guardian-123',
    studentAccountId: 'acc-789',
    guardianAccountId: 'acc-guardian-123',
    studentEntitlementStatus: 'inactive',
    guardianEntitlementStatus: 'inactive',
    studentEntitlementExpired: false,
    guardianEntitlementExpired: false,
    ...overrides,
  };
}

describe('Guardian Entitlement Anti-Leak Tests', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: vi.Mock;
  let statusMock: vi.Mock;
  let jsonMock: vi.Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    req = {
      requestId: 'req-123',
      user: {
        id: 'guardian-123',
        role: 'guardian',
        email: 'guardian@test.com'
      } as any,
      params: {
        studentId: 'student-456'
      }
    };

    res = {
      status: statusMock,
      json: jsonMock
    };

    next = vi.fn();
  });

  it('DENIAL: Unlinked guardian (isGuardianLinkedToStudent = false)', async () => {
    vi.mocked(accountLib.resolveLinkedPairPremiumAccessForGuardian).mockResolvedValue(
      buildAccess({ hasActiveLink: false, studentUserId: null, studentAccountId: null })
    );

    await requireGuardianEntitlement(req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Guardian not linked to requested student',
      code: 'NO_LINKED_STUDENT',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('DENIAL: Revoked link (guardian was linked, but status is now revoked)', async () => {
    vi.mocked(accountLib.resolveLinkedPairPremiumAccessForGuardian).mockResolvedValue(
      buildAccess({ hasActiveLink: false, studentUserId: null, studentAccountId: null })
    );

    await requireGuardianEntitlement(req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Guardian not linked to requested student',
      code: 'NO_LINKED_STUDENT',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('DENIAL: Linked guardian + Inactive student entitlement', async () => {
    vi.mocked(accountLib.resolveLinkedPairPremiumAccessForGuardian).mockResolvedValue(
      buildAccess({
        studentEntitlementStatus: 'canceled',
        guardianEntitlementStatus: 'inactive',
      })
    );

    await requireGuardianEntitlement(req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(402);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'subscription_canceled',
      error: 'Subscription required'
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('DENIAL: Guardian loses visibility when student entitlement expires', async () => {
    vi.mocked(accountLib.resolveLinkedPairPremiumAccessForGuardian).mockResolvedValue(
      buildAccess({
        studentEntitlementStatus: 'active',
        studentEntitlementExpired: true,
      })
    );

    await requireGuardianEntitlement(req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(402);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'subscription_expired',
      error: 'Subscription required'
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('DENIAL: Guardian loses visibility immediately after unlink', async () => {
    vi.mocked(accountLib.resolveLinkedPairPremiumAccessForGuardian).mockResolvedValueOnce(
      buildAccess({
        hasPremiumAccess: true,
        premiumSource: 'student',
        studentEntitlementStatus: 'active',
      })
    );

    await requireGuardianEntitlement(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    const secondJsonMock = vi.fn();
    const secondStatusMock = vi.fn().mockReturnValue({ json: secondJsonMock });
    const secondRes = { status: secondStatusMock, json: secondJsonMock } as unknown as Response;
    const secondNext = vi.fn();

    vi.mocked(accountLib.resolveLinkedPairPremiumAccessForGuardian).mockResolvedValueOnce(
      buildAccess({ hasActiveLink: false, studentUserId: null, studentAccountId: null })
    );

    await requireGuardianEntitlement(req as Request, secondRes, secondNext);

    expect(secondStatusMock).toHaveBeenCalledWith(403);
    expect(secondJsonMock).toHaveBeenCalledWith(expect.objectContaining({
      code: 'NO_LINKED_STUDENT',
    }));
    expect(secondNext).not.toHaveBeenCalled();
  });
});

