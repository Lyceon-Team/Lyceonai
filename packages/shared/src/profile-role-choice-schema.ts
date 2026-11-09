/**
 * Profile completion: the one-time role choice and the guardian age rule.
 *
 * @spec [Guardian_Closure_Plan G1-02; owner rulings R1 and R10 (2026-09-27/28);
 *        Doc 01 V8 §17A (role switch), §16 (guardian is an adult party);
 *        contracts/auth-standard-flow.contract.md AS-3 (no raw server string on the
 *        onboarding surface)] | @implemented [2026-09-29]
 *
 * plain English: the codes the server attaches to every refusal a person can see while
 * finishing their profile or linking a student, plus the pure age function both the
 * server and the client use. Expected outcome: the client renders the server's own
 * message for these codes, verbatim, and never a generic "couldn't save" for a refusal
 * the server has already explained. Trade-off: a refusal WITHOUT one of these codes still
 * falls back to generic copy, because AS-3 forbids rendering an uncurated server string.
 * Edge cases: an unparseable date yields `null` (never NaN), so an invalid date can never
 * pass an age threshold by accident.
 */
import { z } from "zod";
import { isValidLocalDate } from "./calendar/time.js";

/** R10: a guardian account belongs to an adult. */
export const GUARDIAN_MIN_AGE = 18;

/**
 * The plausible age bounds for a date of birth, in whole years.
 *
 * @spec [F-41 (Brief 8 ruling 6, 2026-10-01) owns the 120-year ceiling; the 5-year floor is the
 *       owner's ruling of 2026-11-04 on the live bug below] | @implemented [2026-11-04]
 *
 * plain English: the ceiling has always been here; the FLOOR is new. Four profiles saved a
 * birthday in the CURRENT year, which is age 0 — and age 0 passed every check we had, because a
 * birthday earlier this year is a past date and the only lower bound was `age < 0`. The floor
 * closes that: nobody signing up for SAT prep was born in the last five years.
 *
 * They live here, beside `GUARDIAN_MIN_AGE` and `dateOfBirthSchema`, because both the browser
 * (`packages/shared/src/birthday.ts`) and the server (`server/lib/role-choice.ts`) judge against
 * them, and a second copy on either side is how the two drift apart.
 *
 * trade-off: the floor is deliberately well below the under-13 threshold, so it refuses only the
 * impossible and never pre-empts the under-13 gate, which still accepts a young student and holds
 * them at the guardian link (Doc-01 §37.1, unchanged).
 */
export const MIN_PLAUSIBLE_AGE_YEARS = 5;
export const MAX_PLAUSIBLE_AGE_YEARS = 120;

/**
 * `YYYY-MM-DD`, the value an `<input type="date">` produces, AND a real calendar date.
 *
 * F-41 (Brief 8 ruling 6, 2026-10-01): the pattern alone let `2010-02-31` through, and the
 * onboarding PATCH did not use even the pattern. The calendar check is the canonical
 * `isValidLocalDate` (packages/shared/src/calendar/time.ts), consumed rather than re-derived.
 * Whether the date is in the past and plausible is the server's question (`dateOfBirthRefusal`),
 * because it needs today's date.
 */
export const dateOfBirthSchema = z
  .string()
  // The 4-digit year is part of the shape (owner brief 2026-11-04): a 2-digit year is refused,
  // never widened to a century. `\d{4}` has always said so; the client now enforces the same
  // rule on the Year box, so the two agree.
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD")
  .refine(isValidLocalDate, { message: "Date of birth must be a real date" });
// DELIBERATELY NOT HERE: "not in the future", and the age floor and ceiling. All three need
// today's date, and this schema must stay pure — `ageInYears` parses through it, so a clock read
// in here would make that pure, `today`-taking function secretly depend on the real clock and
// would turn a future date's age from a negative number into `null` for every caller. Those three
// rules live in `dateOfBirthRefusal` (server) and `resolveBirthday` (client), which both take
// `today` as a parameter. (Owner brief 2026-11-04 asked for them "in the existing Zod schema";
// they are applied on the same request, one layer in, for this reason.)

/**
 * Every coded refusal on the profile-completion and link-redeem surfaces. The server owns
 * the MESSAGE for each; the client shows it as sent. A code outside this list is not
 * shown verbatim.
 */
export const ROLE_CHOICE_ERROR_CODES = [
  /** The role was already fixed at profile completion. */
  "ROLE_LOCKED",
  /** A role other than student or guardian was requested (admin can never be self-assigned). */
  "ROLE_NOT_SELF_ASSIGNABLE",
  /** The account already holds a guardian link or learning state. */
  "ROLE_CHANGE_BLOCKED",
  /** No date of birth, or not a real date. */
  "DATE_OF_BIRTH_REQUIRED",
  /** The date of birth says under 18, and a guardian must be an adult. */
  "GUARDIAN_UNDER_18",
  /** A guardian tried to redeem a code with no date of birth on file. */
  "GUARDIAN_DATE_OF_BIRTH_REQUIRED",
  /** The one-time date-of-birth fill was attempted on an account that already has one. */
  "DATE_OF_BIRTH_ALREADY_SET",
  /** G2-03: the profile is complete, so its date of birth can no longer be changed. */
  "DATE_OF_BIRTH_LOCKED",
] as const;

export const roleChoiceErrorCodeSchema = z.enum(ROLE_CHOICE_ERROR_CODES);
export type RoleChoiceErrorCode = z.infer<typeof roleChoiceErrorCodeSchema>;

/** Body of `POST /api/profile/date-of-birth` — the one-time fill for a guardian with none. */
export const setDateOfBirthRequestSchema = z
  .object({ dateOfBirth: dateOfBirthSchema })
  .strict();

/**
 * Whole years between `dateOfBirth` and `today`, or `null` when the input is not a real
 * calendar date. Pure: `today` is passed in, never read from the clock here.
 */
export function ageInYears(dateOfBirth: string, today: Date): number | null {
  const parsed = dateOfBirthSchema.safeParse(dateOfBirth);
  if (!parsed.success) return null;
  const [y, m, d] = parsed.data.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const birth = new Date(Date.UTC(y, m - 1, d));
  // Reject rollovers such as 2010-02-31 → 2010-03-03.
  if (
    birth.getUTCFullYear() !== y ||
    birth.getUTCMonth() !== m - 1 ||
    birth.getUTCDate() !== d
  ) {
    return null;
  }
  let age = today.getUTCFullYear() - y;
  const monthDiff = today.getUTCMonth() - (m - 1);
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < d)) age -= 1;
  return age;
}
