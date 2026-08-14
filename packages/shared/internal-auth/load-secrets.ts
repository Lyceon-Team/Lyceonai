/**
 * @spec [Doc-01A_V1 Part VII §64, §65; Appendix C §C.4]
 * @implemented 2026-08-14
 *
 * plain English: Loads active HMAC secrets for a caller→callee service pair
 * from the `service_auth_secrets` table. Two functions: `loadActiveSecret`
 * (signing — returns the newest active secret) and `loadServiceSecrets`
 * (verification — returns ALL active secrets for rotation overlap).
 *
 * expected outcome: Callers get the newest non-revoked, non-expired secret
 * to sign with. Receivers get every active secret so an in-flight request
 * signed with the old (pre-rotation) secret still verifies during the 14-day
 * overlap window (§65.2).
 *
 * trade-offs:
 *  - Reads from Supabase HTTP client (service_role). The table is admin-mutable
 *    (§64 governance: single-writer — only ops writes). Runtime services read.
 *  - No caching — each sign/verify re-fetches. The table is tiny (≤12 rows at
 *    any time: 6 pairs × ≤2 overlapping secrets). If latency becomes visible,
 *    a TTL cache with LISTEN/NOTIFY invalidation per Part III can be added.
 *  - `loadActiveSecret` throws on missing secret — fail closed. A caller with
 *    no provisioned secret cannot sign and must not send an unsigned request.
 *
 * edge cases:
 *  - Zero rows: no secret provisioned for this pair → throw (signing) or
 *    return [] (verification — caller will fail with "Unknown service pair").
 *  - Multiple rows: rotation overlap. Signing picks newest; verification
 *    tries all.
 *  - `active_until` in the past: row has expired → excluded by the gt filter.
 *  - `revoked_at` set: explicitly revoked → excluded by the isNull filter.
 */

import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";

// ── Types ─────────────────────────────────────────────────────────────

type SecretRow = {
  secret_material: string;
  active_until: string;
};

// ── loadActiveSecret (signing) ─────────────────────────────────────

/**
 * Load the newest active secret for signing.
 *
 * @spec [Doc-01A Part VII §64, Appendix C §C.4]
 *
 * Used by callers: picks the single newest non-revoked, non-expired secret
 * so the caller signs with the freshest material.
 *
 * @param caller  Caller service identifier (e.g. "compaction-worker")
 * @param callee  Callee service identifier (e.g. "main-api")
 * @returns The base64-encoded secret material
 * @throws If no active secret exists for this pair (fail closed)
 */
export async function loadActiveSecret(
  caller: string,
  callee: string,
): Promise<string> {
  const { data, error } = await supabaseServer
    .from("service_auth_secrets")
    .select("secret_material, active_until")
    .eq("caller_service", caller)
    .eq("callee_service", callee)
    .is("revoked_at", null)
    .gt("active_until", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(
      `No active secret for ${caller} → ${callee}` +
        (error ? `: ${error.message}` : ""),
    );
  }

  return (data as SecretRow).secret_material;
}

// ── loadServiceSecrets (verification) ──────────────────────────────

/**
 * Load ALL active secrets for verification (supports rotation overlap).
 *
 * @spec [Doc-01A Part VII §63, §65.2, Appendix C §C.4]
 *
 * Used by receivers: returns every non-revoked, non-expired secret for the
 * caller→callee pair. During the 14-day rotation overlap (§65.1 steps 3-4),
 * both the old and new secrets are active. Verification tries each in turn.
 *
 * @param caller  Caller service identifier
 * @param callee  Callee service identifier
 * @returns Array of base64-encoded secret materials (empty if none active)
 */
export async function loadServiceSecrets(
  caller: string,
  callee: string,
): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from("service_auth_secrets")
    .select("secret_material")
    .eq("caller_service", caller)
    .eq("callee_service", callee)
    .is("revoked_at", null)
    .gt("active_until", new Date().toISOString());

  if (error) {
    // Fail closed — no secrets means verification will reject
    return [];
  }

  return (
    (data as Array<{ secret_material: string }> | null)?.map(
      (r) => r.secret_material,
    ) ?? []
  );
}
