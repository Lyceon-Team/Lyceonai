/**
 * `guardian_links` row contract — Zod first, types inferred.
 *
 * @spec [Doc-01_V8, §35 Guardian-student linkage; §36.1 Initiation; §36.3 Revocation
 *        | supabase/migrations/00000000000000_genesis.sql, CREATE TABLE public.guardian_links]
 *       | @implemented [2026-08-26]
 *
 * plain English: the single source of truth for what a guardian-link row looks like. What it
 * does: describes the columns and the two CHECK domains the table actually enforces, and
 * parses rows coming back from the database before they enter domain logic. Expected outcome:
 * a column that is renamed or dropped in the schema fails a parse at the boundary with a
 * named field, instead of surfacing as `undefined` three call frames later — which is exactly
 * how `student_user_id` survived undetected across this whole surface
 * (`WS-GL_Stage1_Audit.md` §1). Trade-off: one parse per row read, which is nothing against a
 * network round trip. Edge case: `initiated_by` admits `'admin'` because the CHECK does, even
 * though no §36 flow writes it.
 *
 * Per `lyceon-coding-standards.md` §7.2 the schema is defined here and the TypeScript type is
 * inferred from it; there is no separately-declared `type GuardianLink` to drift from it.
 */

import { z } from "zod";

/**
 * genesis.sql:
 *   CHECK (status IN ('active','revoked'))
 *
 * SCL-080 narrowed both the column and this enum. The two pending statuses are gone: the
 * acceptance step they waited on no longer exists, so no code path produces them and the
 * database refuses them. A schema wider than its column is a parse that can never fail
 * where the write already would have.
 */
export const guardianLinkStatusSchema = z.enum(["active", "revoked"]);
export type GuardianLinkStatus = z.infer<typeof guardianLinkStatusSchema>;

/**
 * genesis.sql: CHECK (initiated_by IN ('guardian','student','admin'))
 *
 * §36.1 specifies two initiation paths, guardian and student. `'admin'` is in the domain but
 * no §36 flow produces it, so `guardianLinkInitiatorSchema` — what the application is allowed
 * to WRITE — is narrower than what the column will accept on READ.
 */
export const guardianLinkStoredInitiatorSchema = z.enum([
  "guardian",
  "student",
  "admin",
]);

/**
 * @spec [Doc-01_V8 §36.3 Revocation — `revocation_reason` is recorded; Coding Standards §7.1]
 *   | @implemented [2026-08-27]
 *
 * plain English: the optional body of a revocation. A reason is not required — §36.3 records
 * one when given and null otherwise — but when supplied it is bounded here rather than
 * truncated at the call site, so the cap is part of the contract instead of a `.slice(0, 200)`
 * each route remembers separately. `.strict()` for the same reason as the request schema.
 */
export const guardianLinkRevokeSchema = z
  .object({ reason: z.string().trim().min(1).max(200).optional() })
  .strict();

/**
 * A `timestamptz` as it arrives from whichever transport read it.
 *
 * PostgREST (supabase-js) hands these over as ISO strings; `node-postgres`, used by the
 * PG-backed test harness and by any direct SQL path, parses them into JS `Date` objects.
 * Both are the same instant, so the schema accepts either and normalises to an ISO string —
 * one representation for the rest of the codebase. Rejecting `Date` here would have made the
 * schema pass under the transport that hides the difference and fail under the one that
 * exposes it, which is the wrong way round.
 */
export const timestampSchema = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v.toISOString() : v));

/**
 * An id column. Deliberately `string`, not `string().uuid()`.
 *
 * These columns are `UUID` in Postgres, so the database itself guarantees the format and a
 * non-uuid can never come back from a read. This schema's job is to catch a column being
 * RENAMED OR DROPPED — the drift that let `student_user_id` survive across this whole
 * surface — and format-checking a value the database already types adds nothing to that
 * while breaking every fixture that uses a readable id. Writes are a different matter, but
 * writes are not parsed here.
 */
export const idSchema = z.string().min(1);

export const guardianLinkSchema = z.object({
  id: idSchema,
  guardian_profile_id: idSchema,
  student_profile_id: idSchema,
  status: guardianLinkStatusSchema,
  initiated_by: guardianLinkStoredInitiatorSchema,
  initiated_at: timestampSchema,
  accepted_at: timestampSchema.nullable(),
  accepted_by_profile_id: idSchema.nullable(),
  revoked_at: timestampSchema.nullable(),
  revoked_by_profile_id: idSchema.nullable(),
  revocation_reason: z.string().nullable(),
  created_at: timestampSchema,
});
export type GuardianLink = z.infer<typeof guardianLinkSchema>;

/** The column list to SELECT, derived from the schema so the two cannot drift apart. */
export const GUARDIAN_LINK_COLUMNS = Object.keys(guardianLinkSchema.shape).join(
  ", ",
);

/**
 * Parse one row returned by the database. Throws with the offending field named — the
 * failure mode this schema exists to convert a silent `undefined` into.
 */
export function parseGuardianLink(row: unknown): GuardianLink {
  return guardianLinkSchema.parse(row);
}

export function parseGuardianLinks(rows: unknown): GuardianLink[] {
  return z.array(guardianLinkSchema).parse(rows);
}

/**
 * Error codes the guardian-link data layer publishes. Callers branch on `code`, never on
 * message text or on the identity of a class.
 *
 * These live HERE, in the contract module, and not beside the functions that throw them.
 * That is deliberate: a route importing its error mapping from the same module it imports
 * its functions from has its mapping blanked out the moment anything replaces that module —
 * a test double, a bundler duplicate — and the symptom is a 500 where a 409 was specified.
 * The contract is a separate thing from the implementation and is imported separately.
 */
/**
 * @spec [migration 20260828000000 — the audited transition functions] | @implemented [2026-08-28]
 *
 * plain English: the SQLSTATE each transition function raises, mapped to this module's error
 * codes. PostgREST surfaces a raised SQLSTATE as `error.code`, so the caller matches a CODE
 * rather than a message string — a message is prose and drifts; a SQLSTATE is a contract.
 *
 * ONE definition, consumed by `account.ts`. The functions and this map are edited together or
 * the mapping silently degrades into "unknown error -> 500", which is how a specified 409
 * becomes an opaque failure.
 */
export const GUARDIAN_LINK_ERROR = {
  /** An active or pending link already exists for this exact pair. */
  ALREADY_EXISTS: "GUARDIAN_LINK_ALREADY_EXISTS",
  /**
   * No active link to revoke. Deliberately keeps the pre-existing `LINK_NOT_ACTIVE`
   * string: the condition is unchanged and callers already branch on it, so a namespaced
   * twin would only have meant the wire contract and the internal constant saying two
   * different things about one condition.
   */
  NOT_ACTIVE: "LINK_NOT_ACTIVE",
} as const;

/**
 * @spec [migration 20260828000000 — the audited transition functions] | @implemented [2026-08-28]
 *
 * plain English: the SQLSTATE each transition function raises, mapped to the codes above.
 * PostgREST surfaces a raised SQLSTATE as `error.code`, so the caller matches a CODE rather
 * than a message string — a message is prose and drifts; a SQLSTATE is a contract.
 *
 * ONE definition, consumed by `account.ts`. The migration and this map are edited together or
 * the mapping degrades silently into "unknown error -> 500", which is how a specified 409
 * becomes an opaque failure.
 */
export const GUARDIAN_LINK_SQLSTATE: Readonly<Record<string, string>> = {
  // LY001 (not pending) and LY002 (wrong acceptor) are gone with SCL-080: both were raised
  // only by accept_guardian_link_audited, which migration 20260901000000 drops. LY003 and
  // LY004 are raised by the two functions that survive.
  LY003: GUARDIAN_LINK_ERROR.NOT_ACTIVE,
  LY004: GUARDIAN_LINK_ERROR.ALREADY_EXISTS,
};

export class GuardianLinkError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GuardianLinkError";
    this.code = code;
  }
}
