import { getSupabaseAdmin } from "../middleware/supabase-auth";
import { getUncachableStripeClient } from "./stripeClient";
import { logger } from "../logger";

// @spec [Doc-01 §40.5 Hard delete at T+7, Doc-05E §8 step 5 + §9] account-deletion execution —
// the cron-driven grace-expiry driver that wires deidentify + anonymize-disposition cascade.
// Kept OUT of the route module (account-deletion-routes.ts) so the cron router can consume
// executeDueDeletions WITHOUT transitively loading auth/CSRF/email route wiring (layering rule:
// routes stay thin; domain logic is pure + importable). The irreversible path is reachable only from
// the cron-secret + flag gated GET /api/internal/execute-deletions.

type DeletionAdminClient = ReturnType<typeof getSupabaseAdmin>;

const DELETION_BAN_DURATION = "876000h"; // 100 years

export function buildDeletedEmail(userId: string): string {
  return `deleted_${userId}@deleted.lyceon.ai`;
}

// @spec [Doc-01 §40.2.1 / §40.3 / §40.4] V2 lifecycle gate. The soft-delete-lock + token-recovery
// path (and the destructive executor below) go live ONLY when the owner has applied the staged
// migration and set this flag. Flag OFF (default) keeps the V2 routes + the executor inert/dormant.
export function isDeletionLifecycleV2Enabled(): boolean {
  return process.env.ACCOUNT_DELETION_LIFECYCLE_V2 === "true";
}

// @spec [Doc-05E §8 step 5 + §9] HARDENING: the ONLY way the driver invokes the cascade.
// The mode is hardcoded to 'anonymize' — there is no parameter, no default, no way to pass
// 'hard_delete'. This makes the DEFAULT trap (p_privacy_mode DEFAULT 'hard_delete') impossible
// by construction. Exported for testing only — the driver calls this, never the RPC directly.
export async function anonymizeAccount(
  admin: DeletionAdminClient,
  profileId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc("execute_account_deletion_cascade", {
    p_profile_id: profileId,
    p_privacy_mode: "anonymize",
  });
  if (error) {
    throw new Error(
      `anonymize cascade failed for ${profileId}: ${error.message}`,
    );
  }
  return (data ?? {}) as Record<string, unknown>;
}

// @spec [Doc-01 §40.5 / Q-PR4a-4(b)] Pause Stripe billing collection so the user is not charged
// post-deletion. Full cancellation is PR-4b; this prevents interim billing. No-op if no subscription.
async function pauseStripeBilling(
  admin: DeletionAdminClient,
  profileId: string,
  requestId?: string,
): Promise<void> {
  const { data: entitlement, error } = await admin
    .from("entitlements")
    .select("stripe_subscription_id")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to look up entitlement for Stripe pause: ${error.message}`,
    );
  }

  const subId = entitlement?.stripe_subscription_id as string | null;
  if (!subId) {
    logger.info(
      "DELETION",
      "stripe_pause_skip",
      "No Stripe subscription to pause",
      { userId: profileId, requestId },
    );
    return;
  }

  const stripe = await getUncachableStripeClient();
  await stripe.subscriptions.update(subId, {
    pause_collection: { behavior: "void" },
  });
  logger.info(
    "DELETION",
    "stripe_paused",
    "Stripe subscription paused (void) for deletion",
    { userId: profileId, requestId },
  );
}

// @spec [Q-PR4a-2(c)] Fail-fast: if Supabase Storage objects exist for this user, the driver
// MUST NOT proceed — storage purge logic must be added first. Today zero buckets/uploads exist;
// this assertion catches a future addition that forgets to update the driver.
async function assertNoStorageObjects(
  admin: DeletionAdminClient,
  profileId: string,
): Promise<void> {
  const { data: buckets, error: bucketsError } =
    await admin.storage.listBuckets();
  if (bucketsError) {
    throw new Error(
      `Storage bucket listing failed (cannot verify purge safety): ${bucketsError.message}`,
    );
  }
  if (!buckets || buckets.length === 0) return;

  for (const bucket of buckets) {
    const { data: objects, error: listError } = await admin.storage
      .from(bucket.name)
      .list(profileId, { limit: 1 });
    if (listError) {
      throw new Error(
        `Storage object listing failed for bucket ${bucket.name}: ${listError.message}`,
      );
    }
    if (objects && objects.length > 0) {
      throw new Error(
        `STORAGE_OBJECTS_EXIST: profile ${profileId} has objects in bucket "${bucket.name}" — ` +
          `add storage purge logic to the driver before proceeding with cascade`,
      );
    }
  }
}

// @spec [Doc-01 §40.5, Doc-05E §8 step 5 + §9] The grace-expiry driver. Per-request execution
// sequence (Q-PR4a-6 ruling):
//   1. Stripe pause (prevent post-deletion billing)
//   2. Storage purge assertion (fail-fast if objects exist)
//   3. deidentify_user (scrub profile PII)
//   4+5. complete_and_anonymize_account — atomic mark-completed + cascade('anonymize') in one SQL
//        transaction. Cascade RAISE → status rolls back to 'pending' → retried next cron.
//   6. Auth ban (100yr defense-in-depth)
// Failure at any step: log, skip to next request (stays 'pending', retries next cron run).
export async function executeDueDeletions(
  admin: DeletionAdminClient,
  requestId?: string,
): Promise<{ executedCount: number; failedCount: number }> {
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

  for (const pending of pendingRequests) {
    try {
      // Step 1: Stripe pause — prevent post-deletion billing (Q-PR4a-4b)
      await pauseStripeBilling(admin, pending.profile_id, requestId);

      // Step 2: Storage assertion — fail-fast if objects exist (Q-PR4a-2c)
      await assertNoStorageObjects(admin, pending.profile_id);

      // Step 3: deidentify_user — scrub profile PII
      const deletionEmail = buildDeletedEmail(pending.profile_id);
      const { error: rpcError } = await admin.rpc("deidentify_user", {
        target_user_id: pending.profile_id,
        deleted_email: deletionEmail,
      });
      if (rpcError) {
        throw new Error(`deidentify_user failed: ${rpcError.message}`);
      }

      // Steps 4+5 (atomic): mark-completed + cascade('anonymize') in one SQL transaction.
      // If cascade RAISEs, the status update rolls back → row stays 'pending' → retried next cron.
      const { error: atomicError } = await admin.rpc(
        "complete_and_anonymize_account",
        {
          p_request_id: pending.id,
          p_profile_id: pending.profile_id,
        },
      );
      if (atomicError) {
        throw new Error(
          `atomic complete+anonymize failed: ${atomicError.message}`,
        );
      }

      // Step 6: Auth ban — defense-in-depth (Q-PR4a-1: keep)
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
        throw new Error(`auth ban failed: ${authError.message}`);
      }

      successCount++;
    } catch (err) {
      logger.error(
        "DELETION",
        "execution_step_failed",
        "Deletion execution failed for profile — stays pending, retries next cron",
        {
          userId: pending.profile_id,
          error: err instanceof Error ? err.message : String(err),
          requestId,
        },
      );
      failureCount++;
    }
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
