import type { SupabaseClient } from "@supabase/supabase-js";
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
