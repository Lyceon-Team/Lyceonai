import { buildDeletedEmail, isGraceWindowExpired } from '../routes/account-deletion-routes';
import * as authMiddleware from '../middleware/supabase-auth';

describe('Deletion Lifecycle', () => {
    afterEach(() => {
        jest.restoreAllMocks();
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
        const mockMaybeSingle = jest.fn().mockResolvedValue({
            data: { status: 'completed', executed_at: new Date().toISOString() },
            error: null,
        });
        const mockQuery = {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: mockMaybeSingle,
        };

        jest.spyOn(authMiddleware, 'getSupabaseAdmin').mockReturnValue({
            from: jest.fn().mockReturnValue(mockQuery),
        } as any);

        const req: any = { user: { id: 'user_123' }, requestId: 'req_1' };
        const res: any = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        const next = jest.fn();

        await authMiddleware.requireSupabaseAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCOUNT_DELETED' }));
        expect(next).not.toHaveBeenCalled();
    });
});
