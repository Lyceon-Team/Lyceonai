/**
 * Student background (Settings → Profile) and the college / high-school reference search.
 *
 * @spec [SCL-195 (PROPOSED); Brief 8 rulings 1 and 3 (owner, 2026-10-01); Doc 00 §6 (minimize
 *        data collection on student surfaces); Coding Standards §7.1–§7.2 (Zod at the boundary,
 *        types inferred from it)] | @implemented [2026-10-01]
 *
 * plain English: the shape of the background a student may give — graduation year, a GPA band,
 * their high school and up to three ordered dream colleges — and of the two searches that find
 * the school and the colleges. Every field is optional and clearable. Expected outcome: the
 * route parses with these, the client renders with these, and the SQL writer
 * (`save_student_background`) carries CHECKs that agree, so a bad value is a 400 here and an
 * unrepresentable row there.
 *
 * Trade-offs and edge cases:
 *   - The graduation-year window moves with the calendar, so the update schema is built per
 *     request from the server's current year (`makeStudentBackgroundUpdateSchema`). UTC year: on
 *     31 December a US evening is already next year in UTC, which narrows the window by one year
 *     for a few hours and never widens it.
 *   - A PARTIAL update, like `PUT /api/calendar/profile`: an absent key leaves the stored value,
 *     `null` clears it, `dream_school_ids` replaces the ordered list (`[]` clears it). Settings
 *     sends what changed; the calendar's dream-school picker sends only `dream_school_ids`. One
 *     write path for both, so they cannot drift.
 *   - A well-formed reference id that is not in the reference table is refused by the writer
 *     (`unknown_high_school` / `unknown_college`), not here: only the database knows the list.
 *   - "My school isn't listed" stores nothing. There is no free-text field anywhere below.
 */
import { z } from "zod";

/** Ruling 1: the seven GPA bands, unweighted-scale labels, lowest to highest. */
export const GPA_RANGES = [
  "lt_2_0",
  "2_0_2_49",
  "2_5_2_99",
  "3_0_3_49",
  "3_5_3_79",
  "3_8_4_0",
  "gt_4_0",
] as const;
export const gpaRangeSchema = z.enum(GPA_RANGES);
export type GpaRange = z.infer<typeof gpaRangeSchema>;

/** Ruling 1: graduation year runs from this year to this year + 6. */
export const GRADUATION_YEAR_SPAN = 6;
/** Ruling 1: up to three dream schools. */
export const MAX_DREAM_SCHOOLS = 3;

/** IPEDS UNITID (College Scorecard), six digits. Agrees with `ref_colleges.id`'s CHECK. */
export const collegeIdSchema = z
  .string()
  .regex(/^[0-9]{6}$/, "expected a college id (6 digits)");
/** `nces:<NCESSCH>` (public) or `pss:<PPIN>` (private). Agrees with `ref_high_schools.id`. */
export const highSchoolIdSchema = z
  .string()
  .regex(
    /^(nces:[0-9]{12}|pss:[A-Z0-9]{8})$/,
    "expected a high school id (nces:… or pss:…)",
  );

/**
 * The `PUT /api/profile/background` body before the year window is applied. The type is inferred
 * from this; the request is parsed with `makeStudentBackgroundUpdateSchema`, never with this alone.
 *
 * `.strict()`: an unknown key is a 400, so a client cannot smuggle a free-text school name or any
 * other field past the boundary.
 */
const studentBackgroundUpdateBaseSchema = z
  .object({
    graduation_year: z.number().int().nullable().optional(),
    gpa_range: gpaRangeSchema.nullable().optional(),
    high_school_id: highSchoolIdSchema.nullable().optional(),
    dream_school_ids: z
      .array(collegeIdSchema)
      .max(MAX_DREAM_SCHOOLS, `at most ${MAX_DREAM_SCHOOLS} dream schools`)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "each dream school may appear once",
      })
      .optional(),
  })
  .strict();
export type StudentBackgroundUpdate = z.infer<
  typeof studentBackgroundUpdateBaseSchema
>;

/** The `PUT /api/profile/background` body, bound to the request's year (ruling 1). */
export function makeStudentBackgroundUpdateSchema(
  currentYear: number,
): z.ZodType<StudentBackgroundUpdate> {
  const latest = currentYear + GRADUATION_YEAR_SPAN;
  return studentBackgroundUpdateBaseSchema.superRefine((body, ctx) => {
    if (Object.values(body).every((value) => value === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "a background update must name at least one field",
      });
    }
    const year = body.graduation_year;
    if (
      year !== undefined &&
      year !== null &&
      (year < currentYear || year > latest)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["graduation_year"],
        message: `graduation_year must be between ${currentYear} and ${latest}`,
      });
    }
  });
}

/** One reference row as served: enough to show and disambiguate, nothing else. */
export const referenceSchoolSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    city: z.string(),
    state: z.string().regex(/^[A-Z]{2}$/),
  })
  .strict();
export type ReferenceSchool = z.infer<typeof referenceSchoolSchema>;

/** The `GET /api/profile/background` payload (without the route's `requestId`). */
export const studentBackgroundSchema = z
  .object({
    graduation_year: z.number().int().nullable(),
    gpa_range: gpaRangeSchema.nullable(),
    high_school: referenceSchoolSchema.nullable(),
    dream_schools: z
      .array(
        referenceSchoolSchema.extend({
          position: z.number().int().min(1).max(MAX_DREAM_SCHOOLS),
        }),
      )
      .max(MAX_DREAM_SCHOOLS),
  })
  .strict();
export type StudentBackground = z.infer<typeof studentBackgroundSchema>;

/** Ruling 3: the search floor and cap. Enforced here and again inside the SQL search functions. */
export const REFERENCE_SEARCH_MIN_CHARS = 2;
export const REFERENCE_SEARCH_MAX_RESULTS = 20;

/** `GET /api/reference/colleges?q=` and `GET /api/reference/high-schools?q=`. */
export const referenceSearchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(
        REFERENCE_SEARCH_MIN_CHARS,
        `search needs at least ${REFERENCE_SEARCH_MIN_CHARS} characters`,
      )
      .max(100),
  })
  .strict();
export type ReferenceSearchQuery = z.infer<typeof referenceSearchQuerySchema>;

export const referenceSearchResponseSchema = z
  .object({
    results: z.array(referenceSchoolSchema).max(REFERENCE_SEARCH_MAX_RESULTS),
  })
  .strict();
export type ReferenceSearchResponse = z.infer<
  typeof referenceSearchResponseSchema
>;

/** The writer's expected refusals, and the code each is served under. */
export const STUDENT_BACKGROUND_ERROR_CODES = [
  "UNKNOWN_HIGH_SCHOOL",
  "UNKNOWN_COLLEGE",
  "TOO_MANY_DREAM_SCHOOLS",
  "DUPLICATE_DREAM_SCHOOL",
] as const;
export type StudentBackgroundErrorCode =
  (typeof STUDENT_BACKGROUND_ERROR_CODES)[number];
