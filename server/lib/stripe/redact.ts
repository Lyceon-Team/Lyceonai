/**
 * @spec [Charter §6 "No secrets, card data, or raw payer PII in logs";
 *        Doc 01A §14 (verified heading "## **§14 PII redaction rules (extends V8 §5.1)**")]
 * @implemented 2026-08-20
 *
 * plain English: turn an identifier into a non-reversible short digest so logs
 * stay correlatable without carrying the identifier itself.
 *
 * Why: on the unaccompanied path the student IS the payer, so a profile id in a
 * log line is a payer identifier for a minors' product. Stripe object ids
 * (`cs_…`, `sub_…`, `cus_…`) are payer-linked for the same reason — they resolve
 * to a named person through the Stripe Dashboard.
 *
 * Same construction the consent routes already use
 * (`server/routes/guardian-consent-routes.ts:17`): first 8 hex of SHA-256.
 * Enough to correlate two lines in one incident, not enough to reverse.
 *
 * trade-offs: a digest is stable across processes, so an attacker with a
 * candidate id can confirm a guess. That is acceptable — the property being
 * protected is "the log does not disclose who", not "the log resists a targeted
 * confirmation oracle by someone who already has the id".
 */
import { createHash } from "node:crypto";

export function digestId(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
