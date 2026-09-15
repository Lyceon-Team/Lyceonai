import { getSupabaseAdmin } from "../middleware/supabase-auth";
import { getStripeClient } from "./stripe/client";
import { logger } from "../logger";
import { sendAccountDeletionCompletedEmail } from "./notifications/direct-sends";

// @spec [Doc-01 §40.5 Hard delete at T+7, Doc-05E §8 step 5 + §9] account-deletion execution —
// the cron-driven grace-expiry driver that wires deidentify + anonymize-disposition cascade.
// Kept OUT of the route module (account-deletion-routes.ts) so the cron router can consume
// executeDueDeletions WITHOUT transitively loading auth/CSRF/email route wiring (layering rule:
// routes stay thin; domain logic is pure + importable). The irreversible path is reachable only from
// the cron-secret + flag gated GET /api/internal/execute-deletions.

type DeletionAdminClient = ReturnType<typeof getSupabaseAdmin>;

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

  const stripe = getStripeClient();
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
// sequence (Q-PR4a-6 ruling, revised PR-4a.1):
//   1. Stripe pause (prevent post-deletion billing)
//   2. Storage purge assertion (fail-fast if objects exist)
//   3. deidentify_user (scrub profile PII)
//   4+5. complete_and_anonymize_account — atomic mark-completed + cascade('anonymize') in one SQL
//        transaction. Cascade RAISE → status rolls back to 'pending' → retried next cron.
//        RPC returns {status:'no_op'} if request not pending (ROW_COUNT guard) → skippedCount.
// Failure at any step: log, skip to next request (stays 'pending', retries next cron run).
export async function executeDueDeletions(
  admin: DeletionAdminClient,
  requestId?: string,
): Promise<{
  executedCount: number;
  skippedCount: number;
  failedCount: number;
}> {
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
    return { executedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  let successCount = 0;
  let skipCount = 0;
  let failureCount = 0;

  for (const pending of pendingRequests) {
    // @spec [SCL-083 PROPOSED; owner brief 2026-09-15 Part A1] | @implemented [2026-09-15]
    // Step 0: read the recipient address BEFORE any mutation. Step 3 (deidentify_user) replaces
    // profiles.email with the deleted_<id> placeholder and steps 4+5 delete the row, so this is
    // the only moment the real address exists. It lives in this local for ONE iteration, is
    // never persisted, and is only ever logged through redactEmail. Read outside the RPC's
    // transaction by construction: PostgREST runs each call in its own transaction, and this
    // SELECT is a separate call that completes before the RPCs begin.
    let recipientEmail: string | null = null;
    try {
      const { data: profileRow, error: profileError } = await admin
        .from("profiles")
        .select("email")
        .eq("id", pending.profile_id)
        .maybeSingle();
      if (profileError) {
        logger.warn(
          "DELETION",
          "completion_notice_address_read_failed",
          "Could not read the address for the completion notice; deletion proceeds, no notice",
          {
            userId: pending.profile_id,
            error: profileError.message,
            requestId,
          },
        );
      } else {
        const candidate = (profileRow as { email?: string | null } | null)
          ?.email;
        recipientEmail =
          typeof candidate === "string" && candidate.length > 0
            ? candidate
            : null;
      }
    } catch (readErr) {
      logger.warn(
        "DELETION",
        "completion_notice_address_read_failed",
        "Could not read the address for the completion notice; deletion proceeds, no notice",
        {
          userId: pending.profile_id,
          error: readErr instanceof Error ? readErr.message : String(readErr),
          requestId,
        },
      );
    }

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
      // ROW_COUNT guard: RPC returns {status:'no_op'} when request not pending (already processed).
      const { data: atomicResult, error: atomicError } = await admin.rpc(
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

      const rpcStatus = (atomicResult as Record<string, unknown> | null)
        ?.status as string | undefined;
      if (rpcStatus === "no_op") {
        logger.info(
          "DELETION",
          "execution_skipped",
          "Deletion request not pending (already processed) — skipped",
          { userId: pending.profile_id, requestId },
        );
        skipCount++;
        continue;
      }
      if (rpcStatus !== "completed") {
        throw new Error(
          `atomic RPC returned unexpected status "${String(rpcStatus)}" — treating as failure`,
        );
      }

      successCount++;

      // Step 6 (after commit): the completion notice. The atomic RPC has returned 'completed',
      // so the deletion is durable; a rolled-back deletion never reaches this line. Best-effort
      // and independently guarded: a mail failure never fails the deletion (already committed)
      // and never aborts the batch. No retry — see sendAccountDeletionCompletedEmail.
      if (recipientEmail !== null) {
        const completedAt =
          typeof (atomicResult as Record<string, unknown> | null)
            ?.completion_at === "string"
            ? String((atomicResult as Record<string, unknown>).completion_at)
            : new Date().toISOString();
        try {
          await sendAccountDeletionCompletedEmail({
            deletionRequestId: pending.id,
            email: recipientEmail,
            completedAt,
            requestId,
          });
        } catch (mailErr) {
          logger.warn(
            "DELETION",
            "completion_notice_failed",
            "Deletion-completed notice threw; deletion is committed, continuing",
            {
              userId: pending.profile_id,
              error:
                mailErr instanceof Error ? mailErr.message : String(mailErr),
              requestId,
            },
          );
        }
      } else {
        logger.info(
          "DELETION",
          "completion_notice_skipped",
          "No address available for the completion notice",
          { userId: pending.profile_id, requestId },
        );
      }
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
      skippedCount: skipCount,
      failedCount: failureCount,
      requestId,
    },
  );

  return {
    executedCount: successCount,
    skippedCount: skipCount,
    failedCount: failureCount,
  };
}
