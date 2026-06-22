import { getSupabaseAdmin } from "../middleware/supabase-auth";
import { logger } from "../logger";

// @spec [Doc-01 §40.5 Hard delete at T+7] account-deletion hard-delete execution — domain logic.
// Kept OUT of the route module (account-deletion-routes.ts) so the cron router can consume
// executeDueDeletions WITHOUT transitively loading auth/CSRF/email route wiring (layering rule:
// routes stay thin; domain logic is pure + importable). The irreversible path is reachable only from
// the cron-secret + flag gated POST /api/internal/execute-deletions.

type DeletionAdminClient = ReturnType<typeof getSupabaseAdmin>;

const DELETION_BAN_DURATION = "876000h"; // 100 years

export function buildDeletedEmail(userId: string): string {
  return `deleted_${userId}@deleted.lyceon.ai`;
}

// @spec [Doc-01 §40.2.1 / §40.3 / §40.4] V2 lifecycle gate. The soft-delete-lock + token-recovery
// path (and the destructive executor below) go live ONLY when the owner has applied the staged
// migration (supabase/migrations-pending/20260621000000_account_deletion_lifecycle.sql) and set this
// flag. Flag OFF (default) keeps the V2 routes + the hard-delete executor inert/dormant.
export function isDeletionLifecycleV2Enabled(): boolean {
  return process.env.ACCOUNT_DELETION_LIFECYCLE_V2 === "true";
}

// @spec [Doc-01 §40.5 Hard delete at T+7] the irreversible de-identify pass. Per-row idempotent:
// deidentify_user is a no-op over an already-anonymized row, and once a request flips to
// status='completed' it leaves the pending selection — both proven by the deletion-deidentify
// rehearsal gate (scripts/ci/deletion-deidentify-rehearsal.*).
export async function executeDueDeletions(
  admin: DeletionAdminClient,
  requestId?: string,
): Promise<{ executedCount: number; failedCount: number }> {
  // Doc-01 §40.5: select every pending request whose scheduled hard-delete time has arrived.
  const nowIso = new Date().toISOString();

  const { data: pendingRequests, error: fetchError } = await admin
    .from("account_deletion_requests")
    .select("id, profile_id")
    .eq("status", "pending")
    .lte("scheduled_hard_delete_at", nowIso);

  if (fetchError) {
    logger.error(
      "DELETION",
      "fetch_pending_error",
      "Failed to fetch pending deletions",
      { error: fetchError.message, requestId },
    );
    throw new Error(fetchError.message);
  }

  if (!pendingRequests || pendingRequests.length === 0) {
    return { executedCount: 0, failedCount: 0 };
  }

  let successCount = 0;
  let failureCount = 0;

  // Execute de-identification logic via stored procedure per user
  for (const pending of pendingRequests) {
    const deletionEmail = buildDeletedEmail(pending.profile_id);

    const { error: rpcError } = await admin.rpc("deidentify_user", {
      target_user_id: pending.profile_id,
      deleted_email: deletionEmail,
    });

    if (rpcError) {
      logger.error(
        "DELETION",
        "deidentify_error",
        "Failed to deidentify user",
        {
          userId: pending.profile_id,
          error: rpcError.message,
          requestId,
        },
      );
      failureCount++;
      continue;
    }

    const { error: authError } = await admin.auth.admin.updateUserById(
      pending.profile_id,
      {
        email: deletionEmail,
        ban_duration: DELETION_BAN_DURATION,
        user_metadata: {
          deletion_status: "completed",
          deleted_at: new Date().toISOString(),
        },
      },
    );

    if (authError) {
      logger.error(
        "DELETION",
        "auth_disable_failed",
        "Failed to disable auth user after deidentification",
        { userId: pending.profile_id, error: authError.message, requestId },
      );
      failureCount++;
      continue;
    }

    // Mark as completed
    await admin
      .from("account_deletion_requests")
      .update({ status: "completed", completion_at: new Date().toISOString() })
      .eq("id", pending.id);

    successCount++;
  }

  logger.info(
    "DELETION",
    "execution_complete",
    "Executed pending account deletions",
    {
      attemptedCount: pendingRequests.length,
      successCount,
      failedCount: failureCount,
      requestId,
    },
  );

  return { executedCount: successCount, failedCount: failureCount };
}
