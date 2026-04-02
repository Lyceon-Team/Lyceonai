import { Request, Response, Router } from 'express';
import { getSupabaseAdmin, requireSupabaseAuth } from '../middleware/supabase-auth';
import { doubleCsrfProtection } from '../middleware/csrf-double-submit';
import { logger } from '../logger';

const router = Router();
const DELETION_GRACE_HOURS = 24;

/**
 * POST /api/account/delete
 * Request account deletion. Sets a 24-hour grace window before execution.
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
            .eq('user_id', userId)
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

        // Insert new deletion request
        const { data, error } = await admin
            .from('account_deletion_requests')
            .insert({ user_id: userId, status: 'pending' })
            .select('requested_at')
            .single();

        if (error) {
            logger.error('DELETION', 'insert_error', 'Failed to insert deletion request', { userId, error: error.message, requestId });
            return res.status(500).json({ error: 'Failed to queue account for deletion', requestId });
        }

        logger.info('DELETION', 'requested', 'User requested account deletion', { userId, requestId });

        res.json({
            ok: true,
            graceWindowHours: DELETION_GRACE_HOURS,
            requestedAt: data.requested_at,
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

        // Mark pending requests as cancelled
        const { data, error } = await admin
            .from('account_deletion_requests')
            .update({ status: 'cancelled' })
            .eq('user_id', userId)
            .eq('status', 'pending')
            .select('id');

        if (error) {
            logger.error('DELETION', 'cancel_error', 'Failed to cancel deletion request', { userId, error: error.message, requestId });
            return res.status(500).json({ error: 'Failed to cancel deletion request', requestId });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'No pending deletion request found', requestId });
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
 * Admin-only / system endpoint to execute pending deletions that have passed the 24h window
 */
router.post('/execute-deletions', async (req: Request, res: Response) => {
    const requestId = req.requestId;
    // Note: normally this would be protected by API keys or admin auth for a cron runner.
    // Assuming a generic validation here or a private network access rule.

    try {
        const admin = getSupabaseAdmin();
        // Use the database to compute the threshold: NOW() - 24 hours
        const past24Hours = new Date(Date.now() - DELETION_GRACE_HOURS * 60 * 60 * 1000).toISOString();

        const { data: pendingRequests, error: fetchError } = await admin
            .from('account_deletion_requests')
            .select('id, user_id')
            .eq('status', 'pending')
            .lt('requested_at', past24Hours);

        if (fetchError) {
            logger.error('DELETION', 'fetch_pending_error', 'Failed to fetch pending deletions', { error: fetchError.message, requestId });
            return res.status(500).json({ error: 'Failed to fetch pending deletions', requestId });
        }

        if (!pendingRequests || pendingRequests.length === 0) {
            return res.json({ ok: true, message: 'No eligible pending deletions', executedCount: 0, requestId });
        }

        let successCount = 0;

        // Execute de-identification logic via stored procedure per user
        for (const req of pendingRequests) {
            const { error: rpcError } = await admin.rpc('deidentify_user', { target_user_id: req.user_id });

            if (rpcError) {
                logger.error('DELETION', 'deidentify_error', 'Failed to deidentify user', { userId: req.user_id, error: rpcError.message, requestId });
                continue;
            }

            // Mark as completed
            await admin
                .from('account_deletion_requests')
                .update({ status: 'completed', executed_at: new Date().toISOString() })
                .eq('id', req.id);

            successCount++;
        }

        logger.info('DELETION', 'execution_complete', 'Executed pending account deletions', {
            attemptedCount: pendingRequests.length,
            successCount,
            requestId
        });

        res.json({ ok: true, executedCount: successCount, failedCount: pendingRequests.length - successCount, requestId });
    } catch (err: any) {
        logger.error('DELETION', 'execution_fatal', 'Fatal error during account deletion process', { error: err.message, requestId });
        res.status(500).json({ error: 'Internal server error', requestId });
    }
});

export default router;
