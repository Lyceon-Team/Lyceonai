/**
 * Study profile — the student's stated inputs, read and written.
 *
 * @spec [Doc_05F §7.1 `student_study_profile`, §8.1 (setup fields and bounds), §8.2,
 *        §12.1 (planner mode), §15 PUT /api/calendar/profile;
 *        lyceon-coding-standards §7.2, §7.3]
 * | @implemented [2026-09-17]
 *
 * plain English: what the student told us about how they study. The read shape mirrors the
 * `student_study_profile` CHECK constraints exactly. The write shape mirrors §8.1's bounds,
 * which are RUNTIME CONFIG, not constants — so the upsert schema is produced by a factory
 * that takes the bounds and the student's local today. Nothing here reads a clock or a
 * config table; both arrive as arguments.
 *
 * expected outcome: a profile edit is rejected at the boundary with the same answer the
 * database would give, and a bounds change in `calendar_runtime_config` changes the
 * validation without a deploy.
 *
 * FINDING for the owner (does not block this layer): §8.1 names four bounds —
 * `daily_minutes_min`, `daily_minutes_max`, `daily_minutes_presets` and
 * `target_exam_date_max_days` — and the merged `calendar_runtime_config` seed in
 * `20260917130000_calendar_v1.sql` does NOT contain them. Twenty-one rows were seeded and
 * these four are not among them. `StudyProfileBounds` is therefore a parameter with no
 * canonical source yet; whoever wires the route in Brief 3 needs those rows added, or the
 * bounds have nowhere to come from but a literal, which §17 forbids.
 *
 * trade-offs: `timezone` is validated here only as a non-empty string. The real check is
 * `pg_timezone_names`, which is a database fact and cannot be a pure function — Doc 05F
 * §7.1's own comment puts that check at the route, and duplicating a stale IANA list in
 * TypeScript would be the second source of truth §7.2 exists to prevent.
 *
 * edge cases: `target_exam_date: null` is "not yet", a real answer and not a missing one.
 * An absent key means "leave it alone"; an explicit `null` means "clear it".
 */
import { z } from "zod";
import { addDaysToLocalDate, localDateSchema, type LocalDate } from "./time.js";

// ── Weekday mask (§7.1: bit i = Postgres DOW i, Sunday = 0) ─────────────────

export const STUDY_DAYS_MASK_MIN = 1;
export const STUDY_DAYS_MASK_MAX = 127;

/** `study_days_mask smallint NOT NULL CHECK (BETWEEN 1 AND 127)` — at least one study day. */
export const studyDaysMaskSchema = z
  .number()
  .int()
  .min(STUDY_DAYS_MASK_MIN)
  .max(STUDY_DAYS_MASK_MAX);
export type StudyDaysMask = z.infer<typeof studyDaysMaskSchema>;

/** `full_length_weekday smallint CHECK (BETWEEN 0 AND 6)`, same Sunday-is-0 convention. */
export const postgresDowSchema = z.number().int().min(0).max(6);

export function isStudyDay(mask: StudyDaysMask, postgresDow: number): boolean {
  if (postgresDow < 0 || postgresDow > 6) return false;
  return ((mask >> postgresDow) & 1) === 1;
}

/** The set bits, ascending — Sunday first, matching the mask's own bit order. */
export function studyDowsOfMask(mask: StudyDaysMask): number[] {
  const dows: number[] = [];
  for (let dow = 0; dow <= 6; dow += 1) {
    if (isStudyDay(mask, dow)) dows.push(dow);
  }
  return dows;
}

export function maskOfStudyDows(dows: readonly number[]): number {
  let mask = 0;
  for (const dow of dows) {
    if (dow >= 0 && dow <= 6) mask |= 1 << dow;
  }
  return mask;
}

// ── Read shape ──────────────────────────────────────────────────────────────

/** `target_score integer CHECK (BETWEEN 400 AND 1600 AND target_score % 10 = 0)`. */
export const targetScoreSchema = z
  .number()
  .int()
  .min(400)
  .max(1600)
  .refine((value) => value % 10 === 0, {
    message: "target score moves in steps of 10",
  });

/** `daily_minutes integer NOT NULL CHECK (BETWEEN 5 AND 600)` — the hard column bound. */
export const dailyMinutesSchema = z.number().int().min(5).max(600);

export const PLANNER_MODES = ["auto", "custom"] as const;
export const plannerModeSchema = z.enum(PLANNER_MODES);
export type PlannerMode = z.infer<typeof plannerModeSchema>;

/**
 * The profile as the calendar serves it. `last_acknowledged_nonstudent_version_no` is
 * deliberately absent — the client's business is
 * `latest_unacknowledged_nonstudent_change` (§12.7), which is the answer rather than the
 * arithmetic. `created_at`/`updated_at` are absent because nothing renders them.
 */
export const studyProfileSchema = z
  .object({
    timezone: z.string().min(1),
    target_exam_date: localDateSchema.nullable(),
    target_score: targetScoreSchema.nullable(),
    study_days_mask: studyDaysMaskSchema,
    daily_minutes: dailyMinutesSchema,
    full_length_weekday: postgresDowSchema.nullable(),
    planner_mode: plannerModeSchema,
    setup_completed_at: z.string().nullable(),
  })
  .strict();
// NO CROSS-FIELD REFINEMENT. This schema used to restate `setup_requires_target_score` --
// "a completed setup must carry a target score" -- so that a profile the database forbade
// was also unconstructible here. That CHECK is dropped by 20261002000000 (SCL-130,
// R-08-17 reversed): nothing in setup is required, so a completed setup with both target
// fields null is now the ordinary case rather than an impossible one. The refinement goes
// with the constraint deliberately; leaving it would have kept the field required in the
// one layer every client parses through, which is where a student would actually have met
// it. `targetScoreSchema` still bounds a value that IS supplied -- optional is about
// existence, never about which values are legal.
export type StudyProfile = z.infer<typeof studyProfileSchema>;

// ── Bounds (§8.1, from `calendar_runtime_config` — passed in, never inlined) ─

export const studyProfileBoundsSchema = z
  .object({
    daily_minutes_min: z.number().int().positive(),
    daily_minutes_max: z.number().int().positive(),
    daily_minutes_presets: z.array(z.number().int().positive()).min(1),
    target_exam_date_max_days: z.number().int().positive(),
  })
  .strict()
  .superRefine((bounds, ctx) => {
    if (bounds.daily_minutes_min > bounds.daily_minutes_max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["daily_minutes_max"],
        message: "daily_minutes_max must not be below daily_minutes_min",
      });
    }
    for (const [index, preset] of bounds.daily_minutes_presets.entries()) {
      if (preset < bounds.daily_minutes_min || preset > bounds.daily_minutes_max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["daily_minutes_presets", index],
          message: `preset ${preset} is outside daily_minutes_min…max`,
        });
      }
    }
  });
export type StudyProfileBounds = z.infer<typeof studyProfileBoundsSchema>;

// ── Write shape ─────────────────────────────────────────────────────────────

export type StudyProfileUpsertContext = {
  bounds: StudyProfileBounds;
  /** Today in the student's own timezone. A parameter, never a clock read (§8.2). */
  localToday: LocalDate;
};

const studyProfileUpsertBaseSchema = z
  .object({
    timezone: z.string().min(1).optional(),
    target_exam_date: localDateSchema.nullable().optional(),
    target_score: targetScoreSchema.nullable().optional(),
    study_days_mask: studyDaysMaskSchema.optional(),
    daily_minutes: dailyMinutesSchema.optional(),
    full_length_weekday: postgresDowSchema.nullable().optional(),
    planner_mode: plannerModeSchema.optional(),
    idempotency_key: z.string().uuid(),
  })
  .strict();

/**
 * The PUT `/api/calendar/profile` body, bound to one student's configuration and local day.
 *
 * Every editable field is optional and at least one must be present: the settings sheet
 * sends what changed, and setup sends everything. `idempotency_key` is not optional —
 * §4.2 makes it part of being a mutation, not a nicety.
 */
export function makeStudyProfileUpsertSchema(
  context: StudyProfileUpsertContext,
): z.ZodType<z.infer<typeof studyProfileUpsertBaseSchema>> {
  const latestExamDate = addDaysToLocalDate(
    context.localToday,
    context.bounds.target_exam_date_max_days,
  );
  return studyProfileUpsertBaseSchema.superRefine((body, ctx) => {
    const { idempotency_key: _key, ...fields } = body;
    if (Object.values(fields).every((value) => value === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "a profile update must change at least one field",
      });
    }

    if (body.daily_minutes !== undefined) {
      if (
        body.daily_minutes < context.bounds.daily_minutes_min ||
        body.daily_minutes > context.bounds.daily_minutes_max
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["daily_minutes"],
          message: `daily_minutes must be between ${context.bounds.daily_minutes_min} and ${context.bounds.daily_minutes_max}`,
        });
      } else if (!context.bounds.daily_minutes_presets.includes(body.daily_minutes)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["daily_minutes"],
          message: `daily_minutes must be one of the offered presets: ${context.bounds.daily_minutes_presets.join(", ")}`,
        });
      }
    }

    const examDate = body.target_exam_date;
    if (examDate !== undefined && examDate !== null) {
      if (examDate < context.localToday) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["target_exam_date"],
          message: "the target exam date cannot be in the past",
        });
      } else if (examDate > latestExamDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["target_exam_date"],
          message: `the target exam date cannot be more than ${context.bounds.target_exam_date_max_days} days away`,
        });
      }
    }
  });
}
export type StudyProfileUpsert = z.infer<typeof studyProfileUpsertBaseSchema>;
