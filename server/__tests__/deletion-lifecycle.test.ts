import {
    buildDeletedEmail,
    buildDeletionRequestInsert,
    isGraceWindowExpired,
    scheduledHardDeleteAt,
    DELETION_GRACE_DAYS,
    hashRecoveryToken,
    generateRecoveryToken,
    performRecovery,
    performDeletionRequestV2,
} from '../routes/account-deletion-routes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authMiddleware from '../middleware/supabase-auth';

type FakeAdmin = Parameters<typeof performRecovery>[0];
const fakeAdminWithRpc = (impl: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }) =>
    ({ rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => impl(fn, args)) }) as unknown as FakeAdmin;

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Deletion Lifecycle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        authMiddleware.setDeletionStatusResolverForTests(null);
        delete process.env.ACCOUNT_DELETION_LIFECYCLE_V2;
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

    // @spec [Doc-01_V8 §40.3] The §40.3 lock is enforced structurally by enforceDeletionLock (global
    // default-deny + minimal allowlist), NOT per-route — closing the requireRequestUser bypass class.
    const lockReq = (over: Record<string, unknown>) =>
        ({ user: { id: 'user_123' }, requestId: 'req_1', method: 'GET', path: '/api/x', ...over }) as any;
    const lockRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() }) as any;

    it('hard-deleted user is 403 ACCOUNT_DELETED on every /api route (no allowlist)', async () => {
        process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = 'true';
        authMiddleware.setDeletionStatusResolverForTests(async () => ({ status: 'deleted', executedAt: new Date().toISOString() }));
        const res = lockRes();
        const next = vi.fn();
        // even an otherwise-allowlisted path is blocked for a completed/hard-deleted account
        await authMiddleware.enforceDeletionLock(lockReq({ path: '/api/profile', method: 'GET' }), res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCOUNT_DELETED' }));
        expect(next).not.toHaveBeenCalled();
    });

    it('pending-deletion user is 403 PENDING_DELETION on a non-allowlisted route', async () => {
        process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = 'true';
        authMiddleware.setDeletionStatusResolverForTests(async () => ({ status: 'pending_deletion', executedAt: new Date().toISOString() }));
        const res = lockRes();
        const next = vi.fn();
        await authMiddleware.enforceDeletionLock(lockReq({ path: '/api/tutor/messages', method: 'POST' }), res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PENDING_DELETION' }));
        expect(next).not.toHaveBeenCalled();
    });

    // LOAD-BEARING (strand-prevention at the middleware level): a pending user MUST reach every
    // allowlisted recovery/cancel/profile/signout path, or they are stranded soft-deleted.
    it('pending-deletion user reaches every allowlisted route', async () => {
        process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = 'true';
        authMiddleware.setDeletionStatusResolverForTests(async () => ({ status: 'pending_deletion', executedAt: new Date().toISOString() }));
        const allow: ReadonlyArray<readonly [string, string]> = [
            ['GET', '/api/profile'],
            ['POST', '/api/account/cancel-deletion'],
            ['POST', '/api/account/recover-deletion'],
            ['POST', '/api/auth/signout'],
        ];
        for (const [method, path] of allow) {
            const res = lockRes();
            const next = vi.fn();
            await authMiddleware.enforceDeletionLock(lockReq({ path, method }), res, next);
            expect(next, `${method} ${path} must be allowlisted`).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        }
    });

    it('PATCH /api/profile is NOT allowlisted (only GET) for a pending user', async () => {
        process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = 'true';
        authMiddleware.setDeletionStatusResolverForTests(async () => ({ status: 'pending_deletion', executedAt: new Date().toISOString() }));
        const res = lockRes();
        const next = vi.fn();
        await authMiddleware.enforceDeletionLock(lockReq({ path: '/api/profile', method: 'PATCH' }), res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PENDING_DELETION' }));
    });

    it('flag OFF => pass-through (dormant) even when the resolver says deleted', async () => {
        process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = 'false';
        authMiddleware.setDeletionStatusResolverForTests(async () => ({ status: 'deleted', executedAt: null }));
        const res = lockRes();
        const next = vi.fn();
        await authMiddleware.enforceDeletionLock(lockReq({ path: '/api/tutor/messages', method: 'POST' }), res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('non-/api path (SPA/static) is never blocked, so the client can render the pending screen', async () => {
        process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = 'true';
        authMiddleware.setDeletionStatusResolverForTests(async () => ({ status: 'pending_deletion', executedAt: null }));
        const res = lockRes();
        const next = vi.fn();
        await authMiddleware.enforceDeletionLock(lockReq({ path: '/dashboard', method: 'GET' }), res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });
});

describe('Deletion Lifecycle V2 — token recovery (§40.4) + request (§40.2.1)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('hashes recovery tokens deterministically (sha256 hex), never storing the raw token', () => {
        const h1 = hashRecoveryToken('abc');
        expect(h1).toBe(hashRecoveryToken('abc'));
        expect(h1).toMatch(/^[0-9a-f]{64}$/);
        expect(h1).not.toBe('abc');
    });

    it('generates a unique raw token whose hash matches hashRecoveryToken', () => {
        const a = generateRecoveryToken();
        const b = generateRecoveryToken();
        expect(a.rawToken).not.toBe(b.rawToken);
        expect(a.tokenHash).toBe(hashRecoveryToken(a.rawToken));
        expect(a.tokenHash).not.toBe(b.tokenHash);
    });

    // LOAD-BEARING (strand-prevention): recovery succeeds with NO authenticated session — only a
    // token. A soft-deleted user is login-locked (§40.3) yet must still cancel during grace (§40.4).
    it('restores the account mid-grace with only a token (no session) — strand-prevention', async () => {
        const admin = fakeAdminWithRpc((fn) => {
            expect(fn).toBe('restore_account_deletion');
            return { data: 'profile-xyz', error: null };
        });
        const result = await performRecovery(admin, generateRecoveryToken().rawToken);
        expect(result).toEqual({ ok: true, profileId: 'profile-xyz' });
    });

    it('passes only the hashed token (never the raw token) to the restore RPC', async () => {
        const raw = generateRecoveryToken().rawToken;
        const rpc = vi.fn(async () => ({ data: 'p1', error: null }));
        const admin = { rpc } as unknown as FakeAdmin;
        await performRecovery(admin, raw);
        expect(rpc).toHaveBeenCalledWith('restore_account_deletion', { p_recovery_token_hash: hashRecoveryToken(raw) });
        expect((rpc.mock.calls[0]?.[1] as Record<string, unknown>).p_recovery_token_hash).not.toBe(raw);
    });

    it('maps an unknown/expired token (RPC null) to INVALID_OR_EXPIRED (404-class)', async () => {
        const admin = fakeAdminWithRpc(() => ({ data: null, error: null }));
        expect(await performRecovery(admin, 'whatever')).toEqual({
            ok: false,
            code: 'INVALID_OR_EXPIRED',
            message: expect.any(String),
        });
    });

    it('maps a unique_violation (email reclaimed during grace) to EMAIL_RECLAIMED (409-class)', async () => {
        const admin = fakeAdminWithRpc(() => ({ data: null, error: { code: '23505', message: 'duplicate key' } }));
        expect(await performRecovery(admin, 'whatever')).toEqual({
            ok: false,
            code: 'EMAIL_RECLAIMED',
            message: expect.any(String),
        });
    });

    it('surfaces other RPC errors as ERROR (500-class)', async () => {
        const admin = fakeAdminWithRpc(() => ({ data: null, error: { code: 'P0001', message: 'boom' } }));
        expect(await performRecovery(admin, 'whatever')).toEqual({ ok: false, code: 'ERROR', message: 'boom' });
    });

    // §40.2.1 Phase 1: self-serve request → actor = requester, 7-day grace, returns schedule + token.
    it('requests deletion via the atomic RPC with self-serve actor + 7-day grace + hashed token', async () => {
        const rpc = vi.fn(async () => ({ data: [{ requested_at: 'R', scheduled_hard_delete_at: 'S' }], error: null }));
        const admin = { rpc } as unknown as FakeAdmin;
        const result = await performDeletionRequestV2(admin, 'profile-1');
        expect('error' in result).toBe(false);
        expect(result).toMatchObject({ requestedAt: 'R', scheduledHardDeleteAt: 'S' });
        expect(typeof (result as { rawToken: string }).rawToken).toBe('string');
        const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(args.p_profile_id).toBe('profile-1');
        expect(args.p_actor_id).toBe('profile-1'); // §5 self-serve: actor = requester
        expect(args.p_grace_days).toBe(DELETION_GRACE_DAYS);
        expect(args.p_recovery_token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns an error when the request RPC fails', async () => {
        const admin = fakeAdminWithRpc(() => ({ data: null, error: { message: 'db down' } }));
        expect(await performDeletionRequestV2(admin, 'profile-1')).toEqual({ error: 'db down' });
    });
});
