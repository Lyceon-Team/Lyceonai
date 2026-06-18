import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logger } from "../logger.js";
import type { ConsentSource } from "../../shared/legal-consent.js";

export type LegalAcceptanceRecord = {
  docKey: string;
  docVersion: string;
  actorType: "student" | "parent";
  minor: boolean;
};

type RecordLegalAcceptancesArgs = {
  userId: string;
  acceptances: LegalAcceptanceRecord[];
  consentSource: ConsentSource;
  userAgent?: string | null;
  ipAddress?: string | null;
};

export async function recordLegalAcceptances(
  supabaseAdmin: SupabaseClient,
  args: RecordLegalAcceptancesArgs,
): Promise<void> {
  if (!args.acceptances.length) {
    return;
  }

  const rows = args.acceptances.map((acceptance) => ({
    user_id: args.userId,
    doc_key: acceptance.docKey,
    doc_version: acceptance.docVersion,
    actor_type: acceptance.actorType,
    minor: acceptance.minor,
    consent_source: args.consentSource,
    user_agent: args.userAgent ?? null,
    ip_address: args.ipAddress ?? null,
    accepted_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from("legal_acceptances")
    .upsert(rows, { onConflict: "user_id,doc_key,doc_version,actor_type" });

  if (error) {
    throw new Error(`Failed to record legal acceptances: ${error.message}`);
  }
}

const OUTBOX_TABLE = "legal_acceptance_outbox";

const outboxPayloadSchema = z.object({
  acceptances: z.array(
    z.object({
      docKey: z.string(),
      docVersion: z.string(),
      actorType: z.enum(["student", "parent"]),
      minor: z.boolean(),
    }),
  ),
  consentSource: z.enum([
    "email_signup_form",
    "google_continue_pre_oauth",
    "google_continue_click",
  ]),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
});

export type LegalCaptureResult = { durable: boolean };

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1 | Doc-01_V8 §5/§9] | @implemented 2026-06-18
 * plain English: captures consent durably WITHOUT coupling an already-valid session to the recording.
 * Records directly; on failure, enqueues the intent to the durable outbox for retry. Returns
 * `{durable:true}` when the consent is safely captured (recorded OR queued) and `{durable:false}` ONLY
 * when BOTH stores failed (a rare infra outage). Never throws. Callers keep the session when durable;
 * when NOT durable they must fail closed BEFORE granting a session — consent is a precondition for a
 * valid session, and we must not silently drop it (AS1-OUTBOX-DROP-001). This is distinct from the
 * original outage, which tore down an ALREADY-valid session on the common missing-table case — the
 * outbox now absorbs that, so single-store failure keeps the session.
 */
export async function captureLegalAcceptances(
  supabaseAdmin: SupabaseClient,
  args: RecordLegalAcceptancesArgs,
): Promise<LegalCaptureResult> {
  try {
    await recordLegalAcceptances(supabaseAdmin, args);
    return { durable: true };
  } catch (directErr) {
    logger.warn(
      "AUTH",
      "legal_acceptance_deferred",
      "Direct legal-acceptance write failed; enqueuing to outbox for retry (session unaffected)",
      {
        userId: args.userId,
        error:
          directErr instanceof Error ? directErr.message : String(directErr),
      },
    );
  }

  // Durable capture via the outbox. If THIS also fails, the consent is captured nowhere — signal
  // not-durable so the caller fails closed (never throw into the auth path).
  try {
    const { error } = await supabaseAdmin.from(OUTBOX_TABLE).insert({
      user_id: args.userId,
      payload: {
        acceptances: args.acceptances,
        consentSource: args.consentSource,
        userAgent: args.userAgent ?? null,
        ipAddress: args.ipAddress ?? null,
      },
    });
    if (error) {
      throw new Error(error.message);
    }
    return { durable: true };
  } catch (enqueueErr) {
    logger.error(
      "AUTH",
      "legal_acceptance_enqueue_failed",
      "Could not record OR durably queue consent — caller must fail closed (no silent drop)",
      {
        userId: args.userId,
        error:
          enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
      },
    );
    return { durable: false };
  }
}

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1/§3] | @implemented 2026-06-18
 * plain English: best-effort drain of a user's pending legal-acceptance intents into
 * public.legal_acceptances (idempotent upsert). Called opportunistically on authenticated hydration
 * so deferred consent reaches completion without a cron. expected outcome: queued consent is
 * eventually recorded; re-draining is a no-op. edge case: never throws — a drain failure is logged
 * and retried on the next hydration.
 */
export async function drainLegalAcceptanceOutbox(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<void> {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from(OUTBOX_TABLE)
      .select("id, payload, attempts")
      .eq("user_id", userId)
      .is("processed_at", null)
      .limit(20);

    if (error || !rows || rows.length === 0) {
      return;
    }

    for (const row of rows) {
      const rowId = String(row.id);
      const parsed = outboxPayloadSchema.safeParse(row.payload);

      if (!parsed.success) {
        await supabaseAdmin
          .from(OUTBOX_TABLE)
          .update({
            last_error: "invalid_payload",
            processed_at: new Date().toISOString(),
          })
          .eq("id", rowId);
        continue;
      }

      try {
        await recordLegalAcceptances(supabaseAdmin, {
          userId,
          acceptances: parsed.data.acceptances,
          consentSource: parsed.data.consentSource,
          userAgent: parsed.data.userAgent,
          ipAddress: parsed.data.ipAddress,
        });
        await supabaseAdmin
          .from(OUTBOX_TABLE)
          .update({ processed_at: new Date().toISOString() })
          .eq("id", rowId);
      } catch (applyErr) {
        const attempts = typeof row.attempts === "number" ? row.attempts : 0;
        // Bookkeeping only — guarded so a failed attempt-increment can't abort the rest of the batch.
        try {
          await supabaseAdmin
            .from(OUTBOX_TABLE)
            .update({
              attempts: attempts + 1,
              last_error:
                applyErr instanceof Error ? applyErr.message : String(applyErr),
            })
            .eq("id", rowId);
        } catch (bookkeepErr) {
          logger.warn(
            "AUTH",
            "legal_acceptance_attempt_update_failed",
            "Could not update outbox attempt counter (row will be retried next hydration)",
            {
              rowId,
              error:
                bookkeepErr instanceof Error
                  ? bookkeepErr.message
                  : String(bookkeepErr),
            },
          );
        }
      }
    }
  } catch (drainErr) {
    logger.warn(
      "AUTH",
      "legal_acceptance_drain_failed",
      "Legal-acceptance outbox drain failed (will retry on next hydration)",
      {
        userId,
        error: drainErr instanceof Error ? drainErr.message : String(drainErr),
      },
    );
  }
}

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1/§3 | AS1-DRAIN-LIVENESS-001] | @implemented 2026-06-18
 * plain English: scheduled (service-role) drain over ALL pending legal-acceptance intents, independent
 * of user navigation — the guaranteed-eventual-recording path. The /api/profile drain is the fast
 * path; this guarantees a user who never returns still gets their queued consent recorded. Selects the
 * distinct users with unprocessed rows (capped) and reuses the idempotent per-user drain. Returns the
 * number of users drained. Never throws (a job failure is logged and retried on the next schedule).
 */
export async function drainAllPendingLegalAcceptances(
  supabaseAdmin: SupabaseClient,
  limit = 500,
): Promise<number> {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from(OUTBOX_TABLE)
      .select("user_id")
      .is("processed_at", null)
      .limit(limit);

    if (error || !rows || rows.length === 0) {
      return 0;
    }

    const userIds = [...new Set(rows.map((row) => String(row.user_id)))];
    for (const userId of userIds) {
      await drainLegalAcceptanceOutbox(supabaseAdmin, userId);
    }
    return userIds.length;
  } catch (jobErr) {
    logger.error(
      "AUTH",
      "legal_acceptance_drain_job_failed",
      "Scheduled legal-acceptance drain failed (will retry next schedule)",
      { error: jobErr instanceof Error ? jobErr.message : String(jobErr) },
    );
    return 0;
  }
}
