import { Request, Response, Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { getSupabaseAdmin, requireSupabaseAuth } from '../middleware/supabase-auth';
import { doubleCsrfProtection } from '../middleware/csrf-double-submit';
import { sendEmail } from '../lib/email';
import { logger } from '../logger';
import { isDeletionLifecycleV2Enabled } from '../lib/account-deletion-execute';
// buildDeletedEmail is domain logic in the lib (so the cron router can use the executor without
// loading this route module); re-exported here for existing importers (deletion-lifecycle.test.ts).
export { buildDeletedEmail } from '../lib/account-deletion-execute';

const router = Router();
// @spec [Doc-01 §40 Account deletion lifecycle] | @implemented 2026-06-20
// plain English: account deletion follows the locked 7-day soft-delete → hard-delete window
// (§40 "Account deletion follows a 7-day soft-delete → hard-delete pattern"; §40.2 schedules
// scheduled_hard_delete_at = now() + 7 days; §40.5 the cron hard-deletes WHERE
// scheduled_hard_delete_at <= now()). The prior deployed code used a 24h grace that both
// contradicted the spec window AND never inserted (it omitted the NOT-NULL schedule/actor columns,
// so the right-to-erasure path never worked in prod — GAP-HY-13).
export const DELETION_GRACE_DAYS = 7;
const DELETION_GRACE_MS = DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;

export function isGraceWindowExpired(requestedAt: string, now: Date = new Date()): boolean {
    const requestedAtMs = new Date(requestedAt).getTime();
    if (Number.isNaN(requestedAtMs)) {
        return true;
    }
    return now.getTime() > requestedAtMs + DELETION_GRACE_MS;
}

// @spec [Doc-01 §40.2 / §40.2.1 + §5] self-serve deletion-request row. actor_profile_id = the
// requesting user (§5: actor "may be the profile itself for self-service"); scheduled_hard_delete_at
// = requested_at + 7 days (§40.2); stripe_cancellation_status starts 'pending' (§40.2.1). The two
// NOT-NULL columns (scheduled_hard_delete_at, actor_profile_id) the old insert omitted are required.
export function scheduledHardDeleteAt(requestedAt: Date = new Date()): string {
    return new Date(requestedAt.getTime() + DELETION_GRACE_MS).toISOString();
}

export function buildDeletionRequestInsert(profileId: string, now: Date = new Date()) {
    return {
        profile_id: profileId,
        actor_profile_id: profileId,
        scheduled_hard_delete_at: scheduledHardDeleteAt(now),
        status: 'pending' as const,
        stripe_cancellation_status: 'pending' as const,
    };
}

// @spec [Doc-01 §40.4] recovery token: a 256-bit URL-safe secret mailed to the user; only its
// sha256 hash is persisted (a leaked DB row cannot reconstruct a working link).
export function hashRecoveryToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
}

export function generateRecoveryToken(): { rawToken: string; tokenHash: string } {
    const rawToken = randomBytes(32).toString('base64url');
    return { rawToken, tokenHash: hashRecoveryToken(rawToken) };
}

export const recoverDeletionSchema = z.object({
    token: z.string().min(1),
});

type DeletionAdminClient = ReturnType<typeof getSupabaseAdmin>;

type RecoveryResult =
    | { ok: true; profileId: string }
    | { ok: false; code: 'INVALID_OR_EXPIRED' | 'EMAIL_RECLAIMED' | 'ERROR'; message: string };

// @spec [Doc-01 §40.4] restore-by-token. STRAND-SAFE: takes NO authenticated session — the token IS
// the capability — so a soft-deleted, login-locked (§40.3) user can still recover. Maps the RPC's
// NULL (unknown/expired/already-resolved) to a 404-class result and a unique_violation (the freed
// email was re-registered during grace) to a distinct 409-class result.
export async function performRecovery(admin: DeletionAdminClient, rawToken: string): Promise<RecoveryResult> {
    const tokenHash = hashRecoveryToken(rawToken);
    const { data, error } = await admin.rpc('restore_account_deletion', { p_recovery_token_hash: tokenHash });
    if (error) {
        if (error.code === '23505') {
            return { ok: false, code: 'EMAIL_RECLAIMED', message: 'Email is no longer available for restoration' };
        }
        return { ok: false, code: 'ERROR', message: error.message };
    }
    const profileId = data as string | null;
    if (!profileId) {
        return { ok: false, code: 'INVALID_OR_EXPIRED', message: 'Recovery link is invalid or has expired' };
    }
    return { ok: true, profileId };
}

type InAppCancelResult =
    | { ok: true; profileId: string }
    | { ok: false; code: 'NO_PENDING' | 'EMAIL_RECLAIMED' | 'ERROR'; message: string };

// @spec [Doc-01 §40.4] in-app cancel — the AUTHENTICATED symmetric twin of performRecovery. Calls the
// atomic cancel_account_deletion RPC (clears profiles.deleted_at AND cancels the request in ONE
// transaction) keyed by the signed-in profile_id. Maps the RPC NULL (no pending request) to a
// 404-class result and a unique_violation (email reclaimed during grace — the RPC rolled BOTH writes
// back, so the request stays pending) to a 409-class result, so the route can never report a strand.
export async function performInAppCancel(admin: DeletionAdminClient, profileId: string): Promise<InAppCancelResult> {
    const { data, error } = await admin.rpc('cancel_account_deletion', { p_profile_id: profileId });
    if (error) {
        if (error.code === '23505') {
            return { ok: false, code: 'EMAIL_RECLAIMED', message: 'Email is no longer available; account is still scheduled for deletion' };
        }
        return { ok: false, code: 'ERROR', message: error.message };
    }
    const restoredId = data as string | null;
    if (!restoredId) {
        return { ok: false, code: 'NO_PENDING', message: 'No pending deletion request found' };
    }
    return { ok: true, profileId: restoredId };
}

// @spec [Doc-01 §40.2.1 Phase 1] atomic soft-delete + request insert via RPC; returns the schedule
// plus the raw recovery token (mailed once, never stored raw). Idempotency is enforced inside the RPC.
export async function performDeletionRequestV2(
    admin: DeletionAdminClient,
    profileId: string,
): Promise<{ requestedAt: string; scheduledHardDeleteAt: string; rawToken: string } | { error: string }> {
    const { rawToken, tokenHash } = generateRecoveryToken();
    const { data, error } = await admin.rpc('request_account_deletion', {
        p_profile_id: profileId,
        p_actor_id: profileId, // self-serve: actor = the requesting user (§5)
        p_recovery_token_hash: tokenHash,
        p_grace_days: DELETION_GRACE_DAYS,
    });
    if (error) {
        return { error: error.message };
    }
    const row = (Array.isArray(data) ? data[0] : data) as
        | { requested_at?: string; scheduled_hard_delete_at?: string }
        | null;
    if (!row?.requested_at || !row.scheduled_hard_delete_at) {
        return { error: 'Deletion request did not return a schedule' };
    }
    return { requestedAt: row.requested_at, scheduledHardDeleteAt: row.scheduled_hard_delete_at, rawToken };
}

function deletionRecoveryBaseUrl(): string {
    return (
        process.env.APP_BASE_URL ??
        (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : 'https://lyceon.ai')
    );
}

// @spec [Doc-01 §40.2.1 Phase 4] confirmation email carrying the 7-day recovery link. Best-effort:
// the deletion is already committed, so a mail failure is logged, not surfaced. PRIVACY: never logs
// the address, token, or body — only userId + requestId + outcome (Coding Standards §12.1).
async function sendDeletionScheduledEmail(
    admin: DeletionAdminClient,
    userId: string,
    rawToken: string,
    scheduledHardDeleteAt: string,
    requestId?: string,
): Promise<void> {
    try {
        const { data, error } = await admin.auth.admin.getUserById(userId);
        const email = data?.user?.email;
        if (error || !email) {
            logger.warn('DELETION', 'recovery_email_skipped', 'No address to send deletion-scheduled email', { userId, requestId });
            return;
        }
        const recoverUrl = `${deletionRecoveryBaseUrl()}/account/recover?token=${encodeURIComponent(rawToken)}`;
        const when = new Date(scheduledHardDeleteAt).toUTCString();
        await sendEmail({
            to: email,
            subject: 'Your Lyceon account is scheduled for deletion',
            html:
                `<p>Your Lyceon account is scheduled for permanent deletion on <strong>${when}</strong>.</p>` +
                `<p>If you did not request this, or you change your mind, you can restore your account any time before then:</p>` +
                `<p><a href="${recoverUrl}">Restore my account</a></p>` +
                `<p>This link stops working once the deletion completes.</p>`,
        });
        logger.info('DELETION', 'recovery_email_sent', 'Deletion-scheduled email sent', { userId, requestId });
    } catch (err) {
        logger.warn('DELETION', 'recovery_email_failed', 'Failed to send deletion-scheduled email', {
            userId,
            requestId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * POST /api/account/delete
 * Request account deletion. Schedules the hard delete 7 days out per Doc-01 §40.
 */
router.post('/delete', requireSupabaseAuth, doubleCsrfProtection, async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const userId = req.user!.id;

    try {
        const admin = getSupabaseAdmin();

        // §40.2.1/§40.3/§40.4 V2 path (flag-gated; live only once the staged migration is applied).
        if (isDeletionLifecycleV2Enabled()) {
            const result = await performDeletionRequestV2(admin, userId);
            if ('error' in result) {
                logger.error('DELETION', 'request_v2_error', 'Failed to process deletion request (v2)', { userId, error: result.error, requestId });
                return res.status(500).json({ error: 'Failed to queue account for deletion', requestId });
            }
            // §40.2.1 Phase 4: confirmation email with the 7-day recovery link (best-effort).
            await sendDeletionScheduledEmail(admin, userId, result.rawToken, result.scheduledHardDeleteAt, requestId);
            logger.info('DELETION', 'requested', 'User requested account deletion (v2 soft-delete)', { userId, requestId });
            return res.json({
                ok: true,
                graceWindowDays: DELETION_GRACE_DAYS,
                requestedAt: result.requestedAt,
                scheduledHardDeleteAt: result.scheduledHardDeleteAt,
                requestId,
            });
        }

        // Check if there's already a pending deletion
        const { data: existing, error: findError } = await admin
            .from('account_deletion_requests')
            .select('id, requested_at, status')
            .eq('profile_id', userId)
            .eq('status', 'pending')
            .maybeSingle();

        if (findError) {
            logger.error('DELETION', 'fetch', 'Failed to check existing deletion requests', { userId, error: findError.message, requestId });
            return res.status(500).json({ error: 'Failed to process deletion request', requestId });
        }

        if (existing) {
            return res.json({
                ok: true,
                message: 'Deletion already pending',
                requestedAt: existing.requested_at
            });
        }

        // Insert new deletion request with the canonical schedule + actor (Doc-01 §40.2):
        // scheduled_hard_delete_at = now() + 7 days, actor_profile_id = the requesting user.
        const { data, error } = await admin
            .from('account_deletion_requests')
            .insert(buildDeletionRequestInsert(userId))
            .select('requested_at, scheduled_hard_delete_at')
            .single();

        if (error) {
            logger.error('DELETION', 'insert_error', 'Failed to insert deletion request', { userId, error: error.message, requestId });
            return res.status(500).json({ error: 'Failed to queue account for deletion', requestId });
        }

        logger.info('DELETION', 'requested', 'User requested account deletion', { userId, requestId });

        res.json({
            ok: true,
            graceWindowDays: DELETION_GRACE_DAYS,
            requestedAt: data.requested_at,
            scheduledHardDeleteAt: data.scheduled_hard_delete_at,
            requestId
        });

    } catch (err: any) {
        logger.error('DELETION', 'unhandled_error', 'Failed to process deletion request', { userId, error: err.message, requestId });
        res.status(500).json({ error: 'Internal server error', requestId });
    }
});

/**
 * POST /api/account/cancel-deletion
 * Cancel a pending account deletion request
 */
router.post('/cancel-deletion', requireSupabaseAuth, doubleCsrfProtection, async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const userId = req.user!.id;

    try {
        const admin = getSupabaseAdmin();

        const { data: pending, error: pendingError } = await admin
            .from('account_deletion_requests')
            .select('id, requested_at')
            .eq('profile_id', userId)
            .eq('status', 'pending')
            .maybeSingle();

        if (pendingError) {
            logger.error('DELETION', 'cancel_fetch_error', 'Failed to load deletion request for cancellation', { userId, error: pendingError.message, requestId });
            return res.status(500).json({ error: 'Failed to cancel deletion request', requestId });
        }

        if (!pending?.id) {
            return res.status(404).json({ error: 'No pending deletion request found', requestId });
        }

        if (isGraceWindowExpired(pending.requested_at)) {
            return res.status(409).json({
                error: 'Deletion grace window has expired',
                code: 'GRACE_WINDOW_EXPIRED',
                requestedAt: pending.requested_at,
                graceWindowDays: DELETION_GRACE_DAYS,
                requestId
            });
        }

        if (isDeletionLifecycleV2Enabled()) {
            // @spec [Doc-01 §40.4] atomic in-app cancel (symmetric twin of token recovery): one RPC
            // clears deleted_at + cancels the request in a single transaction, so a failure can never
            // strand the user cancelled-but-locked. Atomicity proven by scripts/ci/deletion-cancel-atomicity.*.
            const result = await performInAppCancel(admin, userId);
            if (!result.ok) {
                if (result.code === 'EMAIL_RECLAIMED') {
                    logger.warn('DELETION', 'cancel_email_reclaimed', 'In-app cancel rolled back: email reclaimed during grace (request still pending)', { userId, requestId });
                    return res.status(409).json({
                        error: 'Your email address is no longer available, so we could not restore your account. It is still scheduled for deletion — please contact support to recover it.',
                        code: 'EMAIL_RECLAIMED',
                        requestId,
                    });
                }
                if (result.code === 'NO_PENDING') {
                    // Raced: the pending request was resolved between the fetch above and the RPC.
                    return res.status(404).json({ error: 'No pending deletion request found', requestId });
                }
                logger.error('DELETION', 'cancel_rpc_error', 'Failed to cancel deletion request', { userId, error: result.message, requestId });
                return res.status(500).json({ error: 'Failed to cancel deletion request', requestId });
            }
        } else {
            const { error } = await admin
                .from('account_deletion_requests')
                .update({ status: 'cancelled' })
                .eq('id', pending.id)
                .select('id');

            if (error) {
                logger.error('DELETION', 'cancel_error', 'Failed to cancel deletion request', { userId, error: error.message, requestId });
                return res.status(500).json({ error: 'Failed to cancel deletion request', requestId });
            }
        }

        logger.info('DELETION', 'cancelled', 'User cancelled deletion request', { userId, requestId });
        res.json({ ok: true, message: 'Account deletion cancelled successfully', requestId });

    } catch (err: any) {
        logger.error('DELETION', 'unhandled_error', 'Failed to cancel deletion request', { userId, error: err.message, requestId });
        res.status(500).json({ error: 'Internal server error', requestId });
    }
});

/**
 * POST /api/account/recover-deletion
 * §40.4 recovery during the grace window. Token-gated by the recovery link from the deletion email —
 * takes NO authenticated session, so a soft-deleted, login-locked (§40.3) user can still restore.
 */
// CSRF_EXEMPT_REASON: unauthenticated, capability-gated by a single-use recovery token — no cookie/session auth to protect.
router.post('/recover-deletion', async (req: Request, res: Response) => {
    const requestId = req.requestId;

    if (!isDeletionLifecycleV2Enabled()) {
        return res.status(404).json({ error: 'Not found', requestId });
    }

    const parsed = recoverDeletionSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid input', requestId });
    }

    try {
        const admin = getSupabaseAdmin();
        const result = await performRecovery(admin, parsed.data.token);

        if (!result.ok) {
            if (result.code === 'ERROR') {
                logger.error('DELETION', 'recover_error', 'Failed to restore account', { error: result.message, requestId });
                return res.status(500).json({ error: 'Failed to restore account', requestId });
            }
            const status = result.code === 'EMAIL_RECLAIMED' ? 409 : 404;
            return res.status(status).json({ error: result.message, code: result.code, requestId });
        }

        logger.info('DELETION', 'recovered', 'Account restored via recovery link', { userId: result.profileId, requestId });
        return res.json({ ok: true, message: 'Account restored successfully', requestId });
    } catch (err) {
        logger.error('DELETION', 'recover_unhandled', 'Unhandled error restoring account', {
            error: err instanceof Error ? err.message : String(err),
            requestId,
        });
        return res.status(500).json({ error: 'Internal server error', requestId });
    }
});

export default router;
