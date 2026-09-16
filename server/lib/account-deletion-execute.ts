import { getSupabaseAdmin } from "../middleware/supabase-auth";
import { getStripeClient } from "./stripe/client";
import { logger } from "../logger";
import { sendAccountDeletionCompletedEmail } from "./notifications/direct-sends";

// @spec [Doc-01 §40.5 Hard delete at T+7, Doc-05E §8 step 5 + §9; SCL-085/086/088 PROPOSED;
// owner brief 2026-09-16 "Deletion Vertical" Parts B + C; plan v4 §3.4] account-deletion
// execution — the cron-driven grace-expiry driver that wires Stripe cancellation, deidentify
// and the anonymize-disposition cascade, and writes the EVIDENCE BUNDLE beside them.
// Kept OUT of the route module (account-deletion-routes.ts) so the cron router can consume
// executeDueDeletions WITHOUT transitively loading auth/CSRF/email route wiring (layering rule:
// routes stay thin; domain logic is pure + importable). The irreversible path is reachable only from
// the cron-secret + flag gated GET /api/internal/execute-deletions.
//
// THE THREE-TRANSACTION SHAPE (plan v4 §1 rule 3; SCL-088). Two universes: the pseudonymous
// history under actor_id and the evidence bundle under log_id. Postgres stamps every row with
// the transaction id (xmin) that wrote it, so any row written in the cascade's transaction is
// joinable to the anonymized_actors row from that transaction; and xmin is monotonic, so even
// distinct transactions join by RANK if both sides preserve execution order. Hence:
//   T1   mark_deletion_log_executing  — evidence side, ONE call for the whole run
//   T1.5 preclear_account_deletion_links — identity side, the rows of OTHER (live) identities
//   T2   deidentify_user + complete_and_anonymize_account — identity side (existing)
//   T3   complete_deletion_log        — evidence side, ONE call for the whole run
//   then reconcile_deletion_log (crash recovery) and rewrite_anonymized_actors (order strip).
// Profiles are processed ORDER BY profile_id: a v4 uuid unrelated to request time and destroyed
// with the profile, so the deletion order on the actor_id side reproduces nothing retained.

type DeletionAdminClient = ReturnType<typeof getSupabaseAdmin>;

type DueRequest = {
  id: string;
  profile_id: string;
  log_id: string | null;
};

/** What T3 writes for one completed deletion (mirrors complete_deletion_log's jsonb element). */
type LogCompletion = {
  log_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  final_status: BillingFinalStatus | null;
};

type BillingFinalStatus =
  | "cancelled"
  | "item_removed"
  | "none_active"
  | "failed_manual";

type BillingOutcome = {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  finalStatus: BillingFinalStatus | null;
};

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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Advance account_deletion_requests.stripe_cancellation_status (Doc-01 §40.2.1 states). The
 * request row dies at cascade PS-5, so this is the transient, in-flight state; the durable
 * outcome is deletion_billing_record.final_status written at T3. Best-effort: a failure to
 * write the transient state is logged and never stops the deletion.
 */
async function setStripeCancellationStatus(
  admin: DeletionAdminClient,
  requestRowId: string,
  status: "in_progress" | "completed" | "failed_manual",
  requestId?: string,
): Promise<void> {
  try {
    const { error } = await admin
      .from("account_deletion_requests")
      .update({ stripe_cancellation_status: status })
      .eq("id", requestRowId);
    if (error) {
      logger.warn(
        "DELETION",
        "stripe_status_write_failed",
        "Could not record stripe_cancellation_status on the request row; continuing",
        { requestRowId, status, error: error.message, requestId },
      );
    }
  } catch (err) {
    logger.warn(
      "DELETION",
      "stripe_status_write_failed",
      "Could not record stripe_cancellation_status on the request row; continuing",
      { requestRowId, status, error: errorMessage(err), requestId },
    );
  }
}

// @spec [Doc-01 §40.2.1 `stripe.subscriptions.cancel(…, { prorate: false })`; §40.3 as amended by
// SCL-086 (PROPOSED): cancel at T+7, not pause; SCL-045 one guardian subscription, one item per
// student] | @implemented [2026-09-16]
// plain English: stops every billing relationship Stripe holds with the person being deleted.
//   (a) Subscriptions the person PAYS for — every non-cancelled subscription on their Stripe
//       customer — are cancelled outright, no proration, no final invoice. This covers a
//       self-paying student and a guardian who pays for others (their students' entitlements
//       are then removed by the customer.subscription.deleted webhook, as for any cancellation).
//   (b) A subscription someone ELSE pays for that carries this student as an item (guardian-paid):
//       only this student's item is removed; if it is the subscription's last item, Stripe cannot
//       delete it, so the subscription is cancelled instead. Nothing else on the guardian's plan
//       is touched.
// Never throws: the deletion is the legally meaningful act, so a Stripe failure records
// `failed_manual` (on the request row now, in deletion_billing_record at T3) and the deletion
// proceeds. Returns the ids to write into the billing record. `getStripeClient()` is only
// constructed when there is something to act on — a person with no customer and no subscription
// never touches Stripe.
async function cancelStripeBilling(
  admin: DeletionAdminClient,
  profileId: string,
  requestRowId: string,
  stripeCustomerId: string | null,
  requestId?: string,
): Promise<BillingOutcome> {
  let entitlementSubId: string | null;
  let entitlementItemId: string | null;
  try {
    const { data: entitlement, error } = await admin
      .from("entitlements")
      .select("stripe_subscription_id, stripe_subscription_item_id")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `Failed to look up entitlement for Stripe cancellation: ${error.message}`,
      );
    }
    const row = entitlement as {
      stripe_subscription_id?: string | null;
      stripe_subscription_item_id?: string | null;
    } | null;
    entitlementSubId =
      typeof row?.stripe_subscription_id === "string"
        ? row.stripe_subscription_id
        : null;
    entitlementItemId =
      typeof row?.stripe_subscription_item_id === "string"
        ? row.stripe_subscription_item_id
        : null;
  } catch (err) {
    logger.error(
      "DELETION",
      "stripe_entitlement_lookup_failed",
      "Entitlement lookup failed before Stripe cancellation; recording failed_manual and continuing",
      { userId: profileId, error: errorMessage(err), requestId },
    );
    await setStripeCancellationStatus(
      admin,
      requestRowId,
      "failed_manual",
      requestId,
    );
    return {
      stripeCustomerId,
      stripeSubscriptionId: null,
      finalStatus: "failed_manual",
    };
  }

  if (!stripeCustomerId && !entitlementSubId) {
    logger.info(
      "DELETION",
      "stripe_cancel_skip",
      "No Stripe customer and no subscription — nothing to cancel",
      { userId: profileId, requestId },
    );
    return {
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      finalStatus: null,
    };
  }

  await setStripeCancellationStatus(
    admin,
    requestRowId,
    "in_progress",
    requestId,
  );

  try {
    const stripe = getStripeClient();
    const cancelledIds = new Set<string>();

    // (a) everything this person pays for
    if (stripeCustomerId) {
      const owned = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: "all",
        limit: 100,
      });
      for (const sub of owned.data) {
        if (sub.status === "canceled" || sub.status === "incomplete_expired") {
          continue;
        }
        await stripe.subscriptions.cancel(sub.id, { prorate: false });
        cancelledIds.add(sub.id);
      }
    }

    // (b) a subscription someone else pays for that carries this student
    let finalStatus: BillingFinalStatus = cancelledIds.size > 0
      ? "cancelled"
      : "none_active";
    if (entitlementSubId && !cancelledIds.has(entitlementSubId)) {
      const sub = await stripe.subscriptions.retrieve(entitlementSubId);
      if (sub.status === "canceled" || sub.status === "incomplete_expired") {
        // already gone on Stripe's side; nothing to do
      } else if (sub.items.data.length <= 1) {
        await stripe.subscriptions.cancel(sub.id, { prorate: false });
        cancelledIds.add(sub.id);
        finalStatus = "cancelled";
      } else {
        const itemId =
          entitlementItemId ??
          sub.items.data.find(
            (it) => it.metadata?.student_profile_id === profileId,
          )?.id ??
          null;
        if (!itemId) {
          throw new Error(
            `guardian-paid subscription ${sub.id} carries several items and none is keyed to this student — remove the item by hand`,
          );
        }
        await stripe.subscriptionItems.del(itemId, {
          proration_behavior: "none",
        });
        finalStatus = "item_removed";
      }
    }

    await setStripeCancellationStatus(
      admin,
      requestRowId,
      "completed",
      requestId,
    );
    logger.info(
      "DELETION",
      "stripe_cancelled",
      "Stripe billing stopped for deletion",
      {
        userId: profileId,
        finalStatus,
        cancelledSubscriptions: cancelledIds.size,
        requestId,
      },
    );
    return {
      stripeCustomerId,
      stripeSubscriptionId: entitlementSubId,
      finalStatus,
    };
  } catch (err) {
    logger.error(
      "DELETION",
      "stripe_cancel_failed",
      "Stripe cancellation failed; recording failed_manual and continuing with the deletion",
      { userId: profileId, error: errorMessage(err), requestId },
    );
    await setStripeCancellationStatus(
      admin,
      requestRowId,
      "failed_manual",
      requestId,
    );
    return {
      stripeCustomerId,
      stripeSubscriptionId: entitlementSubId,
      finalStatus: "failed_manual",
    };
  }
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

/**
 * Evidence-side housekeeping that runs at the end of EVERY pass, whether or not anything was
 * due: the reconciler resolves log rows a crashed earlier pass left 'executing', and the ledger
 * rewrite strips insertion order from anonymized_actors. Each is its own transaction and
 * touches one universe only. Failures are logged, never thrown: the deletions of this pass are
 * already committed.
 */
async function runEvidenceHousekeeping(
  admin: DeletionAdminClient,
  requestId?: string,
): Promise<void> {
  const { data: reconciled, error: reconcileError } = await admin.rpc(
    "reconcile_deletion_log",
    {},
  );
  if (reconcileError) {
    logger.error(
      "DELETION",
      "log_reconcile_failed",
      "reconcile_deletion_log failed; executing rows stay until the next pass",
      { error: reconcileError.message, requestId },
    );
  } else {
    logger.info(
      "DELETION",
      "log_reconciled",
      "Deletion request log reconciled",
      { result: reconciled ?? null, requestId },
    );
  }

  const { data: rewritten, error: rewriteError } = await admin.rpc(
    "rewrite_anonymized_actors",
    {},
  );
  if (rewriteError) {
    logger.error(
      "DELETION",
      "ledger_rewrite_failed",
      "rewrite_anonymized_actors failed; insertion order persists until the next pass",
      { error: rewriteError.message, requestId },
    );
  } else {
    logger.info(
      "DELETION",
      "ledger_rewritten",
      "anonymized_actors rewritten (order stripped)",
      { rows: rewritten ?? null, requestId },
    );
  }
}

// @spec [Doc-01 §40.5, Doc-05E §8 step 5 + §9; plan v4 §3.4] The grace-expiry driver. Per pass:
//   select due requests ORDER BY profile_id  → T1 mark_deletion_log_executing (all due log ids)
//   per request:
//     0. read email + stripe_customer_id BEFORE any mutation (the only moment they exist)
//     1. Stripe cancellation (never fails the deletion; SCL-086)
//     2. storage purge assertion (fail-fast if objects exist)
//     2.5 T1.5 preclear_account_deletion_links (other identities' rows, own transaction)
//     3. deidentify_user (scrub profile PII)
//     4+5. T2 complete_and_anonymize_account — atomic mark-completed + cascade('anonymize');
//          cascade RAISE → status rolls back to 'pending' → retried next pass; the log row stays
//          'executing' and the reconciler reverts it to 'pending'.
//     6. completion notice (after commit, best-effort)
//   T3 complete_deletion_log (all successes, with the billing record fields)
//   reconcile_deletion_log + rewrite_anonymized_actors.
// Failure at any per-request step: log, skip to next request (stays 'pending', retries next pass).
export async function executeDueDeletions(
  admin: DeletionAdminClient,
  requestId?: string,
): Promise<{
  executedCount: number;
  skippedCount: number;
  failedCount: number;
}> {
  const nowIso = new Date().toISOString();

  const { data: pendingRows, error: fetchError } = await admin
    .from("account_deletion_requests")
    .select("id, profile_id, log_id")
    .eq("status", "pending")
    .lte("scheduled_hard_delete_at", nowIso)
    // Plan v4 §1 rule 3: execution order must reproduce nothing retained. profile_id is a v4
    // uuid unrelated to request time and is destroyed with the profile. Without this the
    // scan runs in heap order, which is request order, which the evidence side also knows.
    .order("profile_id", { ascending: true });

  if (fetchError) {
    logger.error(
      "DELETION",
      "fetch_pending_error",
      "Failed to fetch pending deletions",
      { error: fetchError.message, requestId },
    );
    throw new Error(fetchError.message);
  }

  const pendingRequests: DueRequest[] = (
    (pendingRows ?? []) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: String(r.id),
    profile_id: String(r.profile_id),
    log_id: typeof r.log_id === "string" ? r.log_id : null,
  }));

  if (pendingRequests.length === 0) {
    await runEvidenceHousekeeping(admin, requestId);
    return { executedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  // T1 — evidence side, one call. A request row created before migration 20260917000000 has
  // no log row (log_id NULL) and is simply not marked. If T1 itself fails, nothing is deleted
  // this pass: a deletion without its evidence mark is the defect this executor exists to close.
  const dueLogIds = pendingRequests
    .map((r) => r.log_id)
    .filter((id): id is string => typeof id === "string");
  if (dueLogIds.length > 0) {
    const { error: markError } = await admin.rpc(
      "mark_deletion_log_executing",
      { p_log_ids: dueLogIds },
    );
    if (markError) {
      logger.error(
        "DELETION",
        "log_mark_executing_failed",
        "mark_deletion_log_executing failed; no deletion runs this pass",
        { error: markError.message, dueCount: dueLogIds.length, requestId },
      );
      throw new Error(markError.message);
    }
  }

  let successCount = 0;
  let skipCount = 0;
  let failureCount = 0;
  const completions: LogCompletion[] = [];

  for (const pending of pendingRequests) {
    // @spec [SCL-083 PROPOSED; owner brief 2026-09-15 Part A1] | @implemented [2026-09-15]
    // Step 0: read the recipient address (and the Stripe customer id, for step 1 and the billing
    // record) BEFORE any mutation. Step 3 (deidentify_user) replaces profiles.email with the
    // deleted_<id> placeholder and NULLs stripe_customer_id, and steps 4+5 delete the row, so this
    // is the only moment they exist. They live in these locals for ONE iteration and are never
    // persisted or logged by this module (the billing record is written by SQL at T3; the
    // address goes only to sendAccountDeletionCompletedEmail, which redacts it before logging).
    let recipientEmail: string | null = null;
    let stripeCustomerId: string | null = null;
    try {
      const { data: profileRow, error: profileError } = await admin
        .from("profiles")
        .select("email, stripe_customer_id")
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
        const row = profileRow as {
          email?: string | null;
          stripe_customer_id?: string | null;
        } | null;
        recipientEmail =
          typeof row?.email === "string" && row.email.length > 0
            ? row.email
            : null;
        stripeCustomerId =
          typeof row?.stripe_customer_id === "string" &&
          row.stripe_customer_id.length > 0
            ? row.stripe_customer_id
            : null;
      }
    } catch (readErr) {
      logger.warn(
        "DELETION",
        "completion_notice_address_read_failed",
        "Could not read the address for the completion notice; deletion proceeds, no notice",
        {
          userId: pending.profile_id,
          error: errorMessage(readErr),
          requestId,
        },
      );
    }

    try {
      // Step 1: Stripe cancellation — never fails the deletion (SCL-086)
      const billing = await cancelStripeBilling(
        admin,
        pending.profile_id,
        pending.id,
        stripeCustomerId,
        requestId,
      );

      // Step 2: Storage assertion — fail-fast if objects exist (Q-PR4a-2c)
      await assertNoStorageObjects(admin, pending.profile_id);

      // Step 2.5 (T1.5): the rows of OTHER identities, in their own transaction. The cascade in
      // anonymize mode verifies this ran and fails closed if it did not.
      const { error: preclearError } = await admin.rpc(
        "preclear_account_deletion_links",
        { p_profile_id: pending.profile_id },
      );
      if (preclearError) {
        throw new Error(
          `preclear_account_deletion_links failed: ${preclearError.message}`,
        );
      }

      // Step 3: deidentify_user — scrub profile PII
      const deletionEmail = buildDeletedEmail(pending.profile_id);
      const { error: rpcError } = await admin.rpc("deidentify_user", {
        target_user_id: pending.profile_id,
        deleted_email: deletionEmail,
      });
      if (rpcError) {
        throw new Error(`deidentify_user failed: ${rpcError.message}`);
      }

      // Steps 4+5 (T2, atomic): mark-completed + cascade('anonymize') in one SQL transaction.
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
      if (pending.log_id) {
        completions.push({
          log_id: pending.log_id,
          stripe_customer_id: billing.stripeCustomerId,
          stripe_subscription_id: billing.stripeSubscriptionId,
          final_status: billing.finalStatus,
        });
      }

      // Step 6 (after commit): the completion notice. The atomic RPC has returned 'completed',
      // so the deletion is durable; a rolled-back deletion never reaches this line. Best-effort
      // and independently guarded: a mail failure never fails the deletion (already committed)
      // and never aborts the batch. No retry — see sendAccountDeletionCompletedEmail.
      if (recipientEmail !== null) {
        // The date in the notice is the executor's own clock, taken the moment the atomic RPC
        // reported 'completed'. The row's completion_at is set inside that same transaction but
        // is not returned by the RPC (it returns the cascade summary) and cannot be read back:
        // the cascade deletes the request row before the transaction commits.
        const completedAt = new Date().toISOString();
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
              error: errorMessage(mailErr),
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
          error: errorMessage(err),
          requestId,
        },
      );
      failureCount++;
    }
  }

  // T3 — evidence side, one call for every deletion that committed this pass. A failure here
  // leaves the rows 'executing'; the reconciler below (and every later pass) completes them
  // from the fact that their request rows are gone.
  if (completions.length > 0) {
    // JSON as text: supabase-js and the pg-backed test transport then pass it identically,
    // and the function parses it. (A jsonb parameter would receive a JS array as a Postgres
    // array literal from one transport and as JSON from the other.)
    const { error: completeError } = await admin.rpc("complete_deletion_log", {
      p_completions: JSON.stringify(completions),
    });
    if (completeError) {
      logger.error(
        "DELETION",
        "log_complete_failed",
        "complete_deletion_log failed; the reconciler completes these rows",
        {
          error: completeError.message,
          completions: completions.length,
          requestId,
        },
      );
    }
  }

  await runEvidenceHousekeeping(admin, requestId);

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
