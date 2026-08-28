/**
 * @spec [Charter §6 "No secrets, card data, or raw payer PII in logs";
 *        Doc 01A §14 (verified heading "## **§14 PII redaction rules (extends V8 §5.1)**")]
 * @implemented [2026-08-20] | @revised [2026-08-28 — promoted out of lib/stripe]
 *
 * plain English: the two primitives that make a log line safe — turn an
 * identifier into a non-reversible short digest, and turn a vendor/database
 * error into an allow-listed classification. Expected outcome: logs stay
 * correlatable without carrying identifiers or vendor prose. Trade-offs: a
 * digest is stable across processes, so someone who already holds a candidate
 * id can confirm a guess — acceptable, because the property protected is "the
 * log does not disclose who", not "the log resists a confirmation oracle".
 * Edge cases: null/empty in, null out; an unrecognised error code classifies
 * as `unknown` rather than falling back to the raw message.
 *
 * WHY THIS MOVED (2026-08-28). It previously lived at
 * `server/lib/stripe/redact.ts`. The logger is the structural chokepoint that
 * now consumes it (`server/logger.ts`), and the core logger must not import
 * from the Stripe vertical. The old path re-exports from here, so there is
 * exactly ONE implementation and existing importers are untouched.
 */
import { createHash } from "node:crypto";

/**
 * Non-reversible short digest of an identifier: first 8 hex of SHA-256.
 *
 * Same construction the consent routes have used since 2026-08-20
 * (`server/routes/guardian-consent-routes.ts`). Enough to correlate two lines
 * in one incident, not enough to reverse.
 */
export function digestId(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/**
 * Allow-listed error classifications.
 *
 * Codex HIGH-6: raw database and vendor error messages were reaching logs.
 * A message is free text written by a third party — it can quote a row, a
 * constraint containing an identifier, or a connection string. A CLASS is a
 * closed vocabulary we control, so a new failure mode cannot smuggle content
 * into a log line by appearing in prose.
 */
export type ErrorClass =
  | "not_found"
  | "unique_violation"
  | "foreign_key_violation"
  | "check_violation"
  | "not_null_violation"
  | "permission_denied"
  | "connection_failure"
  | "timeout"
  | "invalid_input"
  | "unknown";

/**
 * SQLSTATE and PostgREST codes we recognise. Anything else is `unknown` —
 * deliberately NOT a fallback to the message.
 */
const ERROR_CODE_CLASS: Record<string, ErrorClass> = {
  // PostgreSQL SQLSTATE
  "23505": "unique_violation",
  "23503": "foreign_key_violation",
  "23514": "check_violation",
  "23502": "not_null_violation",
  "42501": "permission_denied",
  "42P01": "invalid_input",
  "22P02": "invalid_input",
  "08000": "connection_failure",
  "08003": "connection_failure",
  "08006": "connection_failure",
  "57014": "timeout",
  // PostgREST
  PGRST116: "not_found",
  PGRST301: "permission_denied",
};

/**
 * Classify an unknown thrown value or Supabase error into a loggable shape.
 *
 * Returns the CODE (a closed vocabulary — SQLSTATE is not free text) and a
 * CLASS. Never returns the message. Takes `unknown` because a catch binding is
 * `unknown` under the coding standards.
 */
export function classifyError(error: unknown): {
  errorClass: ErrorClass;
  errorCode: string | null;
} {
  if (error === null || error === undefined) {
    return { errorClass: "unknown", errorCode: null };
  }

  if (typeof error === "object" && "code" in error) {
    const raw = (error as { code: unknown }).code;
    const code = typeof raw === "string" ? raw : null;
    if (code !== null) {
      return {
        errorClass: ERROR_CODE_CLASS[code] ?? "unknown",
        errorCode: code,
      };
    }
  }

  return { errorClass: "unknown", errorCode: null };
}
