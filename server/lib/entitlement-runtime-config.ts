/**
 * Reader for `entitlement_runtime_config` — the one owner of that config read.
 *
 * @spec [Doc 01 V6 §1705 "All identity/access constants live in DB per
 *        cross-cutting constants doctrine (INV-02B-15 extended to Doc 01
 *        scope)... `entitlement_runtime_config`"; INV-03-08 Tier 1 country
 *        gating; SCL-046] | @implemented [2026-08-28]
 *
 * plain English: reads operator-tunable entitlement constants out of the
 * database instead of hard-coding them. Expected outcome: the Tier-1 country
 * list is an operator action, not a deploy. Trade-off: a database read on the
 * checkout-completion path, which is a webhook and not a user request, so the
 * latency is Stripe's retry budget rather than a student's page load — and a
 * read failure must therefore be handled, not assumed away. Edge cases: an
 * absent row, a row whose JSON is not an array of strings, and a read error all
 * return `null`, which `evaluateCountryEligibility` turns into `unknown` and
 * `deniesEntitlement` turns into a denial. That chain is the fail-closed
 * default the owner ruled on 2026-08-27 and is deliberately NOT short-circuited
 * here.
 *
 * WHY NO CACHE. Doc 01 specifies `entitlement_hard_staleness_seconds` for the
 * entitlement decision itself; nothing specifies a TTL for this list, and
 * inventing one would be a second unreviewed constant. The call site is a
 * webhook, not a hot path.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { classifyError } from "./redact";
import { TIER1_CONFIG_KEY } from "./stripe/country-eligibility";

/**
 * The Tier-1 country list, or `null` when it cannot be read as a list of
 * strings.
 *
 * `null` and `[]` are deliberately NOT distinguished by the caller: both mean
 * "the configuration has not been made", and `evaluateCountryEligibility`
 * already treats an absent-or-empty list as `unknown`. Returning `null` rather
 * than throwing keeps the fail-closed decision in the eligibility rule, which
 * is the one place it is written down.
 */
export async function getTier1Countries(): Promise<readonly string[] | null> {
  const { data, error } = await supabaseServer
    .from("entitlement_runtime_config")
    .select("value")
    .eq("key", TIER1_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    logger.error(
      "ENTITLEMENT",
      "tier1_config_read_failed",
      `${TIER1_CONFIG_KEY} read failed; the country gate will DENY until this is resolved`,
      classifyError(error),
    );
    return null;
  }

  const value: unknown = data?.value;
  if (!Array.isArray(value)) {
    // Covers the unseeded case (no row) and a malformed row. Both are
    // configuration that has not been made correctly, and neither is a fact
    // about any user.
    return null;
  }

  const codes = value.filter((v): v is string => typeof v === "string");
  if (codes.length !== value.length) {
    logger.warn(
      "ENTITLEMENT",
      "tier1_config_malformed",
      `${TIER1_CONFIG_KEY} contains non-string entries; ignoring them`,
      { total: value.length, usable: codes.length },
    );
  }

  return codes;
}
