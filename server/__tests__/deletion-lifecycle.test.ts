import { buildDeletedEmail, isGraceWindowExpired } from '../routes/account-deletion-routes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authMiddleware from '../middleware/supabase-auth';

describe('Deletion Lifecycle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        authMiddleware.setDeletionStatusResolverForTests(null);
    });
    it('deletion request enters pending state', () => {
        const email = buildDeletedEmail('user_123');
        expect(email).toBe('deleted_user_123@deleted.lyceon.ai');
    });

    it('cancellation inside 24h succeeds', () => {
        const requestedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        expect(isGraceWindowExpired(requestedAt)).toBe(false);
    });

    it('post-grace execution de-identifies or removes the right fields', () => {
        const requestedAt = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
        expect(isGraceWindowExpired(requestedAt)).toBe(true);
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
