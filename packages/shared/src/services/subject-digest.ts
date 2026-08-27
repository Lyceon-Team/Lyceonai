/**
 * Non-reversible subject digest — the shared construction.
 *
 * @spec [Doc-01_V8, §36.2 Rate limiting and abuse controls | Doc-01A_V1.0, §41 Postgres
 *        ledger implementation | docs/Spec/lyceon-coding-standards.md §12.1 (privacy)]
 *       | @implemented [2026-08-26]
 *
 * plain English: turn an identifier we must not retain in the clear — an email address, a
 * bearer capability — into a short, stable, non-reversible token we can safely put in a
 * database key or a log line. What it does: sha256, hex, truncated. Expected outcome: the
 * same input always yields the same digest, and the digest yields nothing back.
 * Trade-off: truncation trades collision resistance for readability. At 8 hex characters
 * (32 bits) that is fine for log correlation, where a collision costs a confusing grep;
 * it is NOT fine for a rate-limit bucket key, where a collision silently merges two
 * subjects' quotas — hence `DIGEST_LEN_BUCKET_KEY` at 16 hex characters (64 bits).
 * Edge case: `normaliseEmail` lowercases and trims BEFORE hashing, because
 * `Student@Example.com ` and `student@example.com` are the same mailbox and must not land
 * in two different buckets.
 *
 * WHY THIS FILE EXISTS. Two independent copies of the sha256-truncate construction already
 * existed — `server/routes/guardian-consent-routes.ts:18` (`digest8`) and
 * `server/lib/stripe/redact.ts:27` — with no shared helper. Writing a third for WS-GL's
 * per-email bucket would be the divergence CLAUDE.md forbids by name, so this is the
 * extraction. Following the `tests/helpers/pg-supabase.ts` precedent, the two existing
 * copies are REPORTED as consolidation candidates rather than edited here: `redact.ts` is
 * the Stripe surface (out of WS-GL's edit scope, Charter §0) and `guardian-consent-routes`
 * is Phase D's surface, not Phase B's.
 */

import { createHash } from "node:crypto";

/** Log/forensic correlation. 32 bits — enough to grep by, not enough to key on. */
export const DIGEST_LEN_LOG = 8;

/**
 * Rate-limit bucket keys. 64 bits. A collision here merges two subjects' quotas, which is
 * a silent correctness failure rather than a cosmetic one, so it gets the longer digest.
 */
export const DIGEST_LEN_BUCKET_KEY = 16;

/**
 * Hex sha256 of `value`, truncated to `length` characters.
 * `length` is the number of HEX characters, not bytes — 16 hex = 8 bytes = 64 bits.
 */
export function subjectDigest(value: string, length: number): string {
  if (!Number.isInteger(length) || length < 1 || length > 64) {
    throw new RangeError(
      `subjectDigest length must be an integer in [1, 64] hex characters, got ${length}`,
    );
  }
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

/**
 * Canonical form of an email address for hashing purposes: trimmed and lowercased.
 *
 * Deliberately NOT doing more than that. Provider-specific normalisation (stripping `+tag`,
 * collapsing dots in the Gmail local part) would make two addresses the spec treats as
 * distinct share a bucket, and no spec section authorises it. Trim and case-fold are the
 * two transforms that are safe because the local part is case-insensitive in every mail
 * system Lyceon sends to and leading/trailing whitespace is never part of an address.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * @spec [Doc-01_V8, §36.2] | @implemented [2026-08-26]
 * plain English: the `bucket_key` for "how many times has this guardian tried to link to
 * this email address today". Expected outcome: a stable key per (guardian, email) pair that
 * carries no raw address into a retained ledger row.
 *
 * The discriminator-in-`bucket_key` pattern: §41's ledger is keyed
 * `PRIMARY KEY (profile_id, bucket_key, window_start)` and `profile_id` is `NOT NULL
 * REFERENCES profiles(id)`, so a subject with no Lyceon profile — exactly the case §36.2's
 * per-email control exists to protect — cannot be the ledger's subject. Putting the email's
 * digest inside `bucket_key` and keying `profile_id` on the GUARDIAN expresses
 * "this guardian, against this email, today" without requiring the email to have a profile.
 *
 * RESIDUAL GAP, NAMED: this closes the per-guardian reading of §36.2 only. N distinct
 * guardians could each reach the limit against the same address, so a global per-email cap
 * is NOT enforced. §36.2's text ("Per-student-email: max 3 link attempts per day (prevents
 * spam linking to an email)") is genuinely ambiguous between per-guardian and global scope.
 * A global cap needs a subject abstraction §41's `profile_id` cannot express — that is DDL,
 * therefore V1.1, and it is surfaced as an SCL candidate rather than assumed.
 */
export function guardianLinkEmailBucketKey(email: string): string {
  return `guardian_link_email_attempts:${subjectDigest(
    normaliseEmail(email),
    DIGEST_LEN_BUCKET_KEY,
  )}`;
}
