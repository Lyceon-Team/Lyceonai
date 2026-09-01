/**
 * Student link code contract — the alphabet, the shape, and the normalisation rule.
 *
 * @spec [SCL-080 — Doc 01 V8 §36.1's two email paths replaced by a student-issued code;
 *        Doc 01 V8 §35 Guardian-student linkage] | @implemented [2026-09-01]
 *
 * plain English: one definition of what a student link code looks like, shared by the code
 * generator, the route that redeems it, and the client that renders and submits it. Expected
 * outcome: the client cannot submit a shape the server would reject for a different reason,
 * and a change to the alphabet cannot land in one place and not the other.
 *
 * WHY THESE CHARACTERS. The code is read aloud and typed by hand, so `0/O` and `1/I/L` are
 * excluded — the pairs a person cannot distinguish in most fonts, and the ones that turn a
 * correct code into an "invalid code" response the user cannot debug. The remaining alphabet
 * is 31 characters; at length 6 that is 31^6 ≈ 8.9e8 codes. Collision is handled by the
 * database's partial unique index (`profiles_student_link_code_key`), not by that number.
 *
 * WHY UPPERCASE AND NORMALISED. Canvas's equivalent is case-sensitive, which makes a code
 * read over the phone fail for a reason the reader cannot see. Codes are STORED uppercase and
 * entry is trimmed and upper-cased before comparison, so the mechanism is case-insensitive to
 * the user without the storage being ambiguous.
 *
 * Per `lyceon-coding-standards.md` §7.2 the schema is defined here and types are inferred.
 * Generation is NOT here: it needs a CSPRNG and belongs server-side
 * (`server/lib/student-link-code.ts`).
 */

import { z } from "zod";

/**
 * The 31 unambiguous characters. Excludes `0 O 1 I L` per the owner ruling.
 * Digits first, then letters, so the exclusions are visible by inspection.
 */
export const STUDENT_LINK_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Owner ruling: six characters. */
export const STUDENT_LINK_CODE_LENGTH = 6;

/**
 * A stored code. Anchored, exact length, alphabet-restricted — so a row carrying a code from
 * an older format fails the parse here rather than being redeemed.
 */
export const studentLinkCodeSchema = z
  .string()
  .length(STUDENT_LINK_CODE_LENGTH)
  .regex(
    new RegExp(
      `^[${STUDENT_LINK_CODE_ALPHABET}]{${STUDENT_LINK_CODE_LENGTH}}$`,
    ),
    "code must use the unambiguous alphabet (no 0, O, 1, I or L)",
  );
export type StudentLinkCode = z.infer<typeof studentLinkCodeSchema>;

/**
 * What a guardian typed, before it is a code.
 *
 * Normalisation is part of the CONTRACT, not a convenience the route adds: trim, strip inner
 * whitespace (people read codes in pairs and type them with spaces), then upper-case. A code
 * that is valid after normalisation is valid, which is the whole point of storing uppercase.
 */
export const studentLinkCodeEntrySchema = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/\s+/g, "").toUpperCase())
  .pipe(studentLinkCodeSchema);

/** The redeem request body. */
export const redeemLinkCodeRequestSchema = z.object({
  code: studentLinkCodeEntrySchema,
});
export type RedeemLinkCodeRequest = z.infer<typeof redeemLinkCodeRequestSchema>;

/**
 * What the student's own code panel is told.
 *
 * `code` is null when none has been issued yet; `expiresAt` is null in exactly the same case,
 * so the two cannot disagree. The server computes `expiresAt` from the issue time and the
 * configured TTL — the client never holds the TTL, so it cannot render a different expiry
 * from the one the server will enforce.
 */
export const studentLinkCodeViewSchema = z.object({
  code: studentLinkCodeSchema.nullable(),
  expiresAt: z.string().datetime().nullable(),
});
export type StudentLinkCodeView = z.infer<typeof studentLinkCodeViewSchema>;

/**
 * Is a code still live?
 *
 * Pure and total: no clock of its own, no config read. Both are passed in, so the same
 * function answers for the display path and the redemption path and cannot drift between
 * them. A missing issue time is EXPIRED, not valid-forever — the fail-closed direction.
 */
export function isLinkCodeLive(
  issuedAt: Date | null,
  now: Date,
  ttlSeconds: number,
): boolean {
  if (issuedAt === null) return false;
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return false;
  return now.getTime() < issuedAt.getTime() + ttlSeconds * 1000;
}
