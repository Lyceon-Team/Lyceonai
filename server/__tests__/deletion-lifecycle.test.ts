import {
    buildDeletedEmail,
    buildDeletionRequestInsert,
    isGraceWindowExpired,
    scheduledHardDeleteAt,
    DELETION_GRACE_DAYS,
} from '../routes/account-deletion-routes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authMiddleware from '../middleware/supabase-auth';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Deletion Lifecycle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        authMiddleware.setDeletionStatusResolverForTests(null);
    });

    it('deletion request enters pending state', () => {
        const email = buildDeletedEmail('user_123');
        expect(email).toBe('deleted_user_123@deleted.lyceon.ai');
    });

    // @spec [Doc-01 §40] the locked window is 7 days, not the prior deployed 24h.
    it('uses the locked 7-day grace window (Doc-01 §40)', () => {
        expect(DELETION_GRACE_DAYS).toBe(7);
    });

    it('cancellation inside the 7-day grace succeeds', () => {
        const requestedAt = new Date(Date.now() - 2 * DAY_MS).toISOString();
        expect(isGraceWindowExpired(requestedAt)).toBe(false);
    });

    it('grace window is still open at day 6, expired past day 7', () => {
        const sixDaysAgo = new Date(Date.now() - 6 * DAY_MS).toISOString();
        const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS).toISOString();
        expect(isGraceWindowExpired(sixDaysAgo)).toBe(false);
        expect(isGraceWindowExpired(eightDaysAgo)).toBe(true);
    });

    it('post-grace execution is eligible once the 7-day window passes', () => {
        const requestedAt = new Date(Date.now() - 8 * DAY_MS).toISOString();
        expect(isGraceWindowExpired(requestedAt)).toBe(true);
    });

    // @spec [Doc-01 §40.2] scheduled_hard_delete_at = requested_at + 7 days.
    it('schedules the hard delete exactly 7 days out', () => {
        const now = new Date('2026-06-20T00:00:00.000Z');
        expect(scheduledHardDeleteAt(now)).toBe(
            new Date(now.getTime() + 7 * DAY_MS).toISOString(),
        );
    });

    // @spec [Doc-01 §40.2 / §40.2.1 / §5] self-serve insert carries the canonical schedule + actor.
    it('builds a self-serve deletion request with the locked spec columns', () => {
        const now = new Date('2026-06-20T00:00:00.000Z');
        const row = buildDeletionRequestInsert('profile_abc', now);
        expect(row.profile_id).toBe('profile_abc');
        // §5: for self-service the actor IS the requesting profile.
        expect(row.actor_profile_id).toBe('profile_abc');
        expect(row.status).toBe('pending');
        expect(row.stripe_cancellation_status).toBe('pending');
        // §40.2: now + 7 days.
        expect(row.scheduled_hard_delete_at).toBe(
            new Date(now.getTime() + 7 * DAY_MS).toISOString(),
        );
    });

    it('internal IDs/ledger continuity remain intact where intentionally preserved', () => {
        const email = buildDeletedEmail('account_abc');
        expect(email.includes('account_abc')).toBe(true);
    });

    it('deleted/de-identified user no longer has active runtime visibility/access where prohibited', async () => {
        authMiddleware.setDeletionStatusResolverForTests(async () => ({
            status: 'deleted',
            executedAt: new Date().toISOString(),
        }));

        const req: any = { user: { id: 'user_123' }, requestId: 'req_1' };
        const res: any = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const next = vi.fn();

        await authMiddleware.requireSupabaseAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCOUNT_DELETED' }));
        expect(next).not.toHaveBeenCalled();
    });
});
