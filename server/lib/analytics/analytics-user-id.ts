/**
 * `analytics_user_id` — the opaque, HMAC-derived identifier every server analytics event carries.
 *
 * @spec [Doc 07A V1.0 §7.1 (RB-07A-V1-05 deterministic algorithm), §3 threat 3 (an unsalted hash
 *       is a re-identification vector)] | @implemented [2026-10-05]
 *
 * plain English: HMAC-SHA256(key = ANALYTICS_SALT, message = the profile id's bytes), first 16
 * bytes, version nibble set to 4 and variant bits to RFC 4122, formatted as a lowercase UUID.
 * Same id + same salt always gives the same value; a different salt (another environment) gives an
 * unrelated one, so PostHog and the database share no identifier without the salt.
 *
 * edge cases: "the profile id's bytes" is the UTF-8 of its canonical lowercase string form, the
 * value Supabase hands us. The result is UUIDv4-SHAPED for the registry's `format: uuid`; it is
 * not random (§7.1 says so).
 */
import { createHmac } from "node:crypto";

export function deriveAnalyticsUserId(profileId: string, salt: string): string {
  const digest = createHmac("sha256", salt)
    .update(profileId.toLowerCase(), "utf8")
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  // Bits [48:52] = 0100 (version 4): the high nibble of byte 6.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  // Bits [64:66] = 10 (RFC 4122 variant): the top two bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
