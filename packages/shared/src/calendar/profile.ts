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
import {
  addDaysToLocalDate,
  daysBetweenLocalDates,
  localDateSchema,
  postgresDowOfLocalDate,
  type LocalDate,
} from "./time.js";

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

export const FULL_LENGTH_INTERVAL_WEEKS_MIN = 1;
export const FULL_LENGTH_INTERVAL_WEEKS_MAX = 4;

/**
 * `full_length_interval_weeks smallint CHECK (... IN (1,2,3,4))` (20261010000000) — WEEKS
 * between full-length practice tests, as the student chose them.
 *
 * Weeks, not a label. Weekly / Every 2 weeks / Every 3 weeks / Monthly is the UI's rendering
 * of 1/2/3/4, so changing that copy never migrates data and never touches this schema.
 *
 * NOT read from config. `default_full_length_interval_weeks` is the value the setup form
 * OPENS on and its bounds match these; this range is the closed set of cadences §8.1 offers,
 * which is a domain, not a tunable. An operator widening a config row must not make a fifth
 * cadence storable — the column CHECK would refuse it anyway, and refusing it here means the
 * student gets a 400 instead of a write failure.
 */
export const fullLengthIntervalWeeksSchema = z
  .number()
  .int()
  .min(FULL_LENGTH_INTERVAL_WEEKS_MIN)
  .max(FULL_LENGTH_INTERVAL_WEEKS_MAX);

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
    // NULLABLE BUT REQUIRED, like its weekday. Present-and-null is how the client learns
    // "this student has no automatic full-lengths"; absent would make it indistinguishable
    // from "the server did not send it", and a surface cannot render a distinction it
    // cannot see. The two travel together because they ARE one decision (`full_length_pair`,
    // 20261010000000).
    full_length_interval_weeks: fullLengthIntervalWeeksSchema.nullable(),
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
    full_length_interval_weeks: fullLengthIntervalWeeksSchema
      .nullable()
      .optional(),
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

    // ── THE EXAM SCHEDULE IS ONE DECISION, SO IT IS EDITED AS ONE ──────────
    //
    // `full_length_pair` (20261010000000) requires the weekday and the interval to be null
    // together or set together. This body is a PARTIAL update — the settings sheet sends
    // only what changed — so a request naming just one half would merge into a row the
    // database refuses, and the refusal would arrive as a raw 23514 that the service reports
    // as `{kind:"write_failed"}`: a decision served as a fault, and a 500-shaped answer to
    // what is really a 400.
    //
    // Requiring BOTH whenever EITHER appears is what makes that unreachable, and it needs no
    // knowledge of the stored row to do it: a body that names neither leaves a pair that was
    // already valid, and a body that names both fully determines the new one. Checking the
    // post-merge state instead would mean reading the current profile into this schema, which
    // would make a pure validator depend on database state to say what is well-formed.
    const namesDay = body.full_length_weekday !== undefined;
    const namesWeeks = body.full_length_interval_weeks !== undefined;
    if (namesDay !== namesWeeks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [namesDay ? "full_length_interval_weeks" : "full_length_weekday"],
        message:
          "full_length_weekday and full_length_interval_weeks are one setting: send both or neither",
      });
    } else if (namesDay && namesWeeks) {
      // Both named, so both must agree about whether there are exams at all. "Saturdays, at
      // no frequency" and "every 2 weeks, on no day" are the two halves of the same defect.
      const dayOff = body.full_length_weekday === null;
      const weeksOff = body.full_length_interval_weeks === null;
      if (dayOff !== weeksOff) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [dayOff ? "full_length_weekday" : "full_length_interval_weeks"],
          message:
            "to turn full-lengths off, send both full_length_weekday and full_length_interval_weeks as null",
        });
      }
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

// ── The frequency readout (§8.1) ─────────────────────────────────────────────

/**
 * How many full-lengths a student's chosen cadence yields before their target date.
 *
 * @spec [Doc 05F formula sheet §2 Step 2; Doc 05F §8.1] | @implemented [2026-09-27]
 *
 * plain English: the number behind "about 5 practice tests before 5 December". Expected
 * outcome: the figure the setup form promises is the figure the generator delivers.
 *
 * THIS IS THE SAME ARITHMETIC AS THE GENERATOR, and it is here rather than in a component
 * for exactly that reason. A count computed in the UI from "weeks until the target divided
 * by the interval" would be close, and would drift the moment the preferred weekday, the
 * lead window or the target moved — promising a student six tests and planning five. The
 * steps below are the ones `calendar_place_full_lengths` takes: add `interval_weeks x 7`,
 * snap FORWARD to the preferred weekday, stop at the lead window, and count the final
 * rehearsal that walks BACK from the target.
 *
 * It is deliberately NOT horizon-limited. The generator plans fourteen days at a time; this
 * answers "over the whole run-up", which is the question the student is asking when they
 * pick a frequency. A monthly student inside a fortnight sees no exam in their calendar and
 * still has four ahead of them, and both statements are true.
 *
 * `null` means the count is unanswerable — no cadence, or no target date to count toward.
 * The caller renders "a practice test every 2 weeks" instead, because inventing a horizon
 * to count against would be inventing the answer.
 */
export function fullLengthsBeforeTarget(input: {
  today: LocalDate;
  /** Weeks between sittings, 1..4. `null` means no automatic full-lengths. */
  intervalWeeks: number | null;
  /** Postgres DOW, Sunday = 0. `null` means no automatic full-lengths. */
  preferredWeekday: number | null;
  targetExamDate: LocalDate | null;
  /** `final_exam_lead_days` from config — never a literal (§17). */
  finalExamLeadDays: number;
}): number | null {
  const {
    today,
    intervalWeeks,
    preferredWeekday,
    targetExamDate,
    finalExamLeadDays,
  } = input;
  if (intervalWeeks === null || preferredWeekday === null) return null;
  if (targetExamDate === null) return null;

  const snapForward = (from: LocalDate): LocalDate => {
    let d = from;
    // At most six steps: a weekday recurs every seven days.
    for (let i = 0; i < 7; i += 1) {
      if (postgresDowOfLocalDate(d) === preferredWeekday) return d;
      d = addDaysToLocalDate(d, 1);
    }
    return d;
  };

  // Nothing sits on or after the target, nor inside its lead window.
  const admits = (d: LocalDate): boolean =>
    daysBetweenLocalDates(d, targetExamDate) >= finalExamLeadDays;

  const dates = new Set<LocalDate>();

  // The final rehearsal, walking BACK from `target - lead` — the one fixed point.
  let probe = addDaysToLocalDate(targetExamDate, -finalExamLeadDays);
  for (let i = 0; i < 7; i += 1) {
    if (postgresDowOfLocalDate(probe) === preferredWeekday) break;
    probe = addDaysToLocalDate(probe, -1);
  }
  if (daysBetweenLocalDates(today, probe) >= 0) dates.add(probe);

  // The series. Bounded by the target rather than by a trip count, and the loop is
  // additionally capped so a caller who passes a target decades out cannot hang a render.
  let cursor = today;
  for (let i = 0; i < 520; i += 1) {
    const next = snapForward(addDaysToLocalDate(cursor, intervalWeeks * 7));
    if (!admits(next)) break;
    dates.add(next);
    cursor = next;
  }
  return dates.size;
}
