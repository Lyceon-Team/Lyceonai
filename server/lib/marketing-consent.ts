/**
 * The one server write path for the marketing opt-in.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R26, row Q5 ("`consent_captured` emitted");
 *       Doc 10 §9.21 (logged, revocable consent); Doc 07A §6 `consent_captured` (registered
 *       2026-10-05, owner Step 0 answer 5: `marketing_optin`, "1.0.0", on grant only)]
 *       | @implemented [2026-10-05]
 *
 * plain English: calls public.set_marketing_consent, which writes the flag and — through the
 * profiles trigger — one row in marketing_consent_log naming the source and the wording version.
 * When the call actually turned the opt-in ON, the caller emits `consent_captured` through
 * `emitMarketingConsentCaptured`; a withdrawal is recorded in the log only. The emission is a
 * separate step because ORDER matters at onboarding: `user_signed_up` must be the account's
 * first analytics event (it is the call that writes the set-once analytics_user_id, and it is
 * refused as `not_first_identity` otherwise), so the PATCH emits consent_captured after it. Both
 * the onboarding PATCH (source `signup`) and the Settings toggle (source `settings`) come
 * through here, so there is one writer and one emission site.
 *
 * Expected outcome: `{ ok: true, granted, changed }`, or `{ ok: false, reason: "age_ineligible" }`
 * when the database's own eligibility check refuses (the routes check first with the shared rule,
 * so this is the race or the bypass, not the normal path). Anything else is thrown: the caller
 * answers 500, because a consent write that might not have landed must not be reported as done.
 *
 * Privacy: logs carry the outcome and the source, never the person's id or email.
 */
import { z } from "zod";
import type { RpcClient } from "./rpc-client";
import { emitEvent } from "./analytics/emit-event";
import { logger } from "../logger";
import { MARKETING_CONSENT_VERSION } from "../../packages/shared/src/marketing-consent-schema";

export type MarketingConsentSource = "signup" | "settings";

const setResultSchema = z.discriminatedUnion("ok", [
  z
    .object({ ok: z.literal(true), changed: z.boolean(), granted: z.boolean() })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: z.enum(["age_ineligible", "profile_missing"]),
    })
    .strict(),
]);

export type MarketingConsentWrite =
  | { ok: true; granted: boolean; changed: boolean }
  | { ok: false; reason: "age_ineligible" };

export async function setMarketingConsent(
  client: RpcClient,
  profileId: string,
  granted: boolean,
  source: MarketingConsentSource,
  requestId: string | undefined,
): Promise<MarketingConsentWrite> {
  const { data, error } = await client.rpc("set_marketing_consent", {
    p_profile_id: profileId,
    p_granted: granted,
    p_source: source,
    p_consent_version: MARKETING_CONSENT_VERSION,
  });
  if (error) {
    throw new Error(`set_marketing_consent failed: ${error.message}`);
  }
  const result = setResultSchema.parse(data);
  if (!result.ok) {
    if (result.reason === "profile_missing") {
      throw new Error("set_marketing_consent: profile missing");
    }
    logger.warn(
      "MARKETING_CONSENT",
      "age_ineligible",
      "Marketing opt-in refused by the database age check",
      { source, requestId },
    );
    return { ok: false, reason: "age_ineligible" };
  }

  logger.info(
    "MARKETING_CONSENT",
    "consent_written",
    "Marketing opt-in recorded",
    { source, granted: result.granted, changed: result.changed, requestId },
  );
  return { ok: true, granted: result.granted, changed: result.changed };
}

/**
 * Doc 07A consent_captured, for a write that turned the opt-in ON (owner answer 5: grant only).
 * A no-op for anything else. The wrapper refuses under-13 and not-yet-onboarded accounts on its
 * own; neither can reach a grant anyway.
 */
export async function emitMarketingConsentCaptured(
  emit: typeof emitEvent,
  profileId: string,
  write: MarketingConsentWrite | null,
): Promise<void> {
  if (write === null || !write.ok || !write.changed || !write.granted) return;
  await emit(profileId, "consent_captured", {
    consent_type: "marketing_optin",
    consent_version: MARKETING_CONSENT_VERSION,
  });
}
