import { Request, Response, Router } from 'express';
import { getSupabaseAdmin, requireSupabaseAdmin, requireSupabaseAuth } from '../middleware/supabase-auth';
import { doubleCsrfProtection } from '../middleware/csrf-double-submit';
import { logger } from '../logger';

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
const DELETION_BAN_DURATION = '876000h'; // 100 years

export function buildDeletedEmail(userId: string): string {
    return `deleted_${userId}@deleted.lyceon.ai`;
}

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

/**
 * POST /api/account/delete
 * Request account deletion. Schedules the hard delete 7 days out per Doc-01 §40.
 */
router.post('/delete', requireSupabaseAuth, doubleCsrfProtection, async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const userId = req.user!.id;

    try {
        const admin = getSupabaseAdmin();

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

        const { error } = await admin
            .from('account_deletion_requests')
            .update({ status: 'cancelled' })
            .eq('id', pending.id)
            .select('id');

        if (error) {
            logger.error('DELETION', 'cancel_error', 'Failed to cancel deletion request', { userId, error: error.message, requestId });
            return res.status(500).json({ error: 'Failed to cancel deletion request', requestId });
        }

        logger.info('DELETION', 'cancelled', 'User cancelled deletion request', { userId, requestId });
        res.json({ ok: true, message: 'Account deletion cancelled successfully', requestId });

    } catch (err: any) {
        logger.error('DELETION', 'unhandled_error', 'Failed to cancel deletion request', { userId, error: err.message, requestId });
        res.status(500).json({ error: 'Internal server error', requestId });
    }
});

/**
 * POST /api/account/execute-deletions
 * Admin-only / system endpoint to hard-delete pending requests whose scheduled 7-day
 * hard-delete time has arrived (Doc-01 §40.5).
 */
// CSRF_EXEMPT_REASON: Non-browser admin/system operation with server-side auth gating.
router.post('/execute-deletions', requireSupabaseAuth, requireSupabaseAdmin, async (req: Request, res: Response) => {
    const requestId = req.requestId;

    try {
        const admin = getSupabaseAdmin();
        // Doc-01 §40.5: select every pending request whose scheduled hard-delete time has arrived.
        const nowIso = new Date().toISOString();

        const { data: pendingRequests, error: fetchError } = await admin
            .from('account_deletion_requests')
            .select('id, profile_id')
            .eq('status', 'pending')
            .lte('scheduled_hard_delete_at', nowIso);

        if (fetchError) {
            logger.error('DELETION', 'fetch_pending_error', 'Failed to fetch pending deletions', { error: fetchError.message, requestId });
            return res.status(500).json({ error: 'Failed to fetch pending deletions', requestId });
        }

        if (!pendingRequests || pendingRequests.length === 0) {
            return res.json({ ok: true, message: 'No eligible pending deletions', executedCount: 0, requestId });
        }

        let successCount = 0;
        let failureCount = 0;

        // Execute de-identification logic via stored procedure per user
        for (const pending of pendingRequests) {
            const deletionEmail = buildDeletedEmail(pending.profile_id);

            const { error: rpcError } = await admin.rpc('deidentify_user', { target_user_id: pending.profile_id, deleted_email: deletionEmail });

            if (rpcError) {
                logger.error('DELETION', 'deidentify_error', 'Failed to deidentify user', { userId: pending.profile_id, error: rpcError.message, requestId });
                failureCount++;
                continue;
            }

            const { error: authError } = await admin.auth.admin.updateUserById(pending.profile_id, {
                email: deletionEmail,
                ban_duration: DELETION_BAN_DURATION,
                user_metadata: {
                    deletion_status: 'completed',
                    deleted_at: new Date().toISOString(),
                },
            });

            if (authError) {
                logger.error('DELETION', 'auth_disable_failed', 'Failed to disable auth user after deidentification', {
                    userId: pending.profile_id,
                    error: authError.message,
                    requestId,
                });
                failureCount++;
                continue;
            }

            // Mark as completed
            await admin
                .from('account_deletion_requests')
                .update({ status: 'completed', completion_at: new Date().toISOString() })
                .eq('id', pending.id);

            successCount++;
        }

        logger.info('DELETION', 'execution_complete', 'Executed pending account deletions', {
            attemptedCount: pendingRequests.length,
            successCount,
            failedCount: failureCount,
            requestId
        });

        res.json({ ok: true, executedCount: successCount, failedCount: failureCount, requestId });
    } catch (err: any) {
        logger.error('DELETION', 'execution_fatal', 'Fatal error during account deletion process', { error: err.message, requestId });
        res.status(500).json({ error: 'Internal server error', requestId });
    }
});

export default router;
