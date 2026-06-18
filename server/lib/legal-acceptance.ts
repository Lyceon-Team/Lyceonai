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

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1 | Doc-01_V8 §5/§9] | @implemented 2026-06-18
 * plain English: decouples consent recording from session survival. Records legal acceptances
 * best-effort and, on ANY failure, enqueues the intent to the durable outbox for later retry —
 * NEVER throwing into the auth path. A successful authentication keeps its session regardless of
 * whether this write succeeds. expected outcome: auth never fails because consent recording failed;
 * the intent is not lost (queued + drained). edge case: even an outbox-insert failure is swallowed
 * (logged), never thrown — auth availability must not depend on this bookkeeping.
 */
export async function captureLegalAcceptances(
  supabaseAdmin: SupabaseClient,
  args: RecordLegalAcceptancesArgs,
): Promise<void> {
  try {
    await recordLegalAcceptances(supabaseAdmin, args);
    return;
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

  // Durable capture. Even if THIS fails we must not throw into the auth path.
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
  } catch (enqueueErr) {
    logger.error(
      "AUTH",
      "legal_acceptance_enqueue_failed",
      "Failed to enqueue legal acceptance to outbox; consent not yet recorded",
      {
        userId: args.userId,
        error:
          enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
      },
    );
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
        await supabaseAdmin
          .from(OUTBOX_TABLE)
          .update({
            attempts: attempts + 1,
            last_error:
              applyErr instanceof Error ? applyErr.message : String(applyErr),
          })
          .eq("id", rowId);
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
