/**
 * The birthday a person types as three fields — month, day, year — and the one set of rules
 * that judges it.
 *
 * @spec [owner brief "birthday input" (Karl, 2026-11-04): three labeled fields, a plain-language
 *       confirmation line, inline validation, a 5-year plausibility floor on the server; live bug
 *       2026-11-04 (four profiles saved the CURRENT year); Doc-01_V8 §9 / §37.1 (under-13 gating
 *       derives from the date of birth, unchanged)] | @implemented [2026-11-04]
 *
 * plain English: `<input type="date">` is a browser widget, and on iOS Safari it is a wheel that
 * starts on TODAY. A person who span the month and day but never touched the year wheel saved the
 * current year — age 0 — and every check we had passed it, because a birthday in the current year
 * is a PAST date. Karl reproduced it on an iPhone 17 Pro. So the widget goes: the person now types
 * a month, a day and a four-digit year, and nothing is pre-filled or inferred from the clock.
 *
 * This module is the single judge of those three strings. The client calls it to show inline
 * errors and the confirmation line; the server calls it on the submitted date. One implementation,
 * so the two can never disagree about what is a valid birthday — the failure mode that let the
 * original bug through was exactly a client and a server with different ideas of "plausible".
 *
 * trade-offs:
 *  - `today` is a parameter, never read from the clock here, so every rule is deterministic and
 *    testable (CLAUDE.md determinism). Callers pass `new Date()`.
 *  - The month is a dropdown of names, not a number: "04" vs "4" is the other half of this bug
 *    class, and a name cannot be mistyped into a different month.
 *  - Errors are returned per field, in field order, so the client can place each one under the box
 *    it belongs to rather than showing one summary line.
 *
 * edge cases: a year of fewer than four digits is refused rather than widened (no "06" → 2006
 * guessing, which is how a 2-digit year becomes the wrong century); February 29 is accepted only
 * in a leap year, through the canonical `isValidLocalDate`; a date in the future, under the age
 * floor, or over the age ceiling is refused with a message naming the year, because the year is
 * the field that is wrong in every case we have seen.
 */
import { isValidLocalDate } from "./calendar/time";
import {
  ageInYears,
  MAX_PLAUSIBLE_AGE_YEARS,
  MIN_PLAUSIBLE_AGE_YEARS,
} from "./profile-role-choice-schema";

/** The twelve months, as the dropdown shows them. `value` is the 1-based month number. */
export const BIRTH_MONTHS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

/** How far back the Year placeholder sits. A hint only — never a value, never submitted. */
export const BIRTH_YEAR_PLACEHOLDER_AGE = 13;

/** The three raw strings, exactly as the three inputs hold them. */
export type BirthdayParts = {
  readonly month: string;
  readonly day: string;
  readonly year: string;
};

export const EMPTY_BIRTHDAY: BirthdayParts = { month: "", day: "", year: "" };

/** Which box an error belongs under. `form` is for a problem no single box owns. */
export type BirthdayField = "month" | "day" | "year" | "form";

export type BirthdayError = {
  readonly field: BirthdayField;
  readonly message: string;
};

export type BirthdayResolution =
  | {
      readonly ok: true;
      /** `YYYY-MM-DD`, the value `profiles.date_of_birth` stores. */
      readonly iso: string;
      readonly month: number;
      readonly day: number;
      readonly year: number;
    }
  | { readonly ok: false; readonly errors: ReadonlyArray<BirthdayError> };

const DIGITS_ONLY = /^\d+$/;

/** Only digits, so a pasted "04 " or "2006." cannot become a silent 4 or 2006. */
function parseDigits(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || !DIGITS_ONLY.test(trimmed)) return null;
  return Number(trimmed);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The three strings judged together. Returns the ISO date, or every error with the field it
 * belongs to. Pure: `today` decides "future" and the age bounds, and is never read from the clock.
 */
export function resolveBirthday(
  parts: BirthdayParts,
  today: Date,
): BirthdayResolution {
  const errors: BirthdayError[] = [];

  // 1. Required. All three start empty and a placeholder is never a value, so this is the
  //    first thing a bare submit hits — the iOS wheel's "I touched nothing" case.
  const month = parseDigits(parts.month);
  const day = parseDigits(parts.day);
  const yearRaw = parts.year.trim();
  const year = parseDigits(yearRaw);

  if (month === null) {
    errors.push({ field: "month", message: "Choose your birth month." });
  } else if (month < 1 || month > 12) {
    errors.push({ field: "month", message: "Choose your birth month." });
  }

  if (day === null) {
    errors.push({ field: "day", message: "Enter your birth day." });
  } else if (day < 1 || day > 31) {
    errors.push({ field: "day", message: "Enter a day from 1 to 31." });
  }

  if (year === null) {
    errors.push({ field: "year", message: "Enter your birth year." });
  } else if (yearRaw.length !== 4) {
    // No widening of a 2-digit year: "06" is not 2006 here, it is a mistake to correct.
    errors.push({
      field: "year",
      message: "Enter the full 4-digit year, like 2006.",
    });
  }

  if (errors.length > 0 || month === null || day === null || year === null) {
    return { ok: false, errors };
  }

  const iso = `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;

  // 2. A real calendar date, through the canonical checker — no February 30.
  if (!isValidLocalDate(iso)) {
    return {
      ok: false,
      errors: [
        {
          field: "day",
          message: `That day doesn't exist in ${BIRTH_MONTHS[month - 1]!.label}.`,
        },
      ],
    };
  }

  // 3. Not in the future, and plausible. `ageInYears` is the canonical age, so the floor and
  //    ceiling here are the same arithmetic the under-13 gate and the guardian rule use.
  const age = ageInYears(iso, today);
  if (age === null) {
    return {
      ok: false,
      errors: [{ field: "form", message: "Enter a real date of birth." }],
    };
  }
  if (age < 0) {
    return {
      ok: false,
      errors: [
        {
          field: "year",
          message: "Your date of birth can't be in the future.",
        },
      ],
    };
  }
  if (age < MIN_PLAUSIBLE_AGE_YEARS) {
    // The live bug's signature: the current year, which reads as age 0.
    return {
      ok: false,
      errors: [
        {
          field: "year",
          message: "Check the year — that's less than 5 years ago.",
        },
      ],
    };
  }
  if (age > MAX_PLAUSIBLE_AGE_YEARS) {
    return {
      ok: false,
      errors: [{ field: "year", message: "Check the year." }],
    };
  }

  return { ok: true, iso, month, day, year };
}

/**
 * "Born April 4, 2006." — the line under the fields, so the person reads back what they entered
 * before they submit it. Built from the parts, never through `toLocaleDateString`, which would
 * reintroduce a timezone shift on the very value this whole change exists to keep exact.
 */
export function formatBirthdayConfirmation(
  month: number,
  day: number,
  year: number,
): string {
  const label = BIRTH_MONTHS[month - 1]?.label ?? "";
  return `Born ${label} ${day}, ${year}.`;
}

/** The Year box's placeholder: a plausible year, as a hint. Never submitted. */
export function birthYearPlaceholder(today: Date): string {
  return String(today.getUTCFullYear() - BIRTH_YEAR_PLACEHOLDER_AGE);
}

/** The three fields that an existing `YYYY-MM-DD` fills, for a surface that edits a stored date. */
export function birthdayPartsFromIso(iso: string | null): BirthdayParts {
  if (iso === null || !isValidLocalDate(iso)) return EMPTY_BIRTHDAY;
  const [y, m, d] = iso.split("-") as [string, string, string];
  return { month: String(Number(m)), day: String(Number(d)), year: y };
}

/** The first error for one field, or null. The client places these under their own boxes. */
export function errorFor(
  errors: ReadonlyArray<BirthdayError>,
  field: BirthdayField,
): string | null {
  return errors.find((e) => e.field === field)?.message ?? null;
}
