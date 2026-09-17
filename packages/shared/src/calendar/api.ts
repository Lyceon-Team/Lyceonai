/**
 * Calendar API contract — request and response shapes for the §15 surface.
 *
 * @spec [Doc_05F §15 (API surface), §15.1 (launch), §12.7 (acknowledgement), §14 (facts,
 *        streak), §17.3 (timezone mismatch), §17.4 (plan-updated banner);
 *        lyceon-coding-standards §7.1, §8.1, §8.2]
 * | @implemented [2026-09-17]
 *
 * plain English: one schema per boundary, so a handler's third step — `Zod parse` — has
 * something canonical to parse against, and the client's query layer infers its types from
 * the same file the server validates with.
 *
 * expected outcome: adding a field to a calendar response means editing one schema, and the
 * client's types follow without a second declaration (§7.2).
 *
 * trade-offs: these schemas describe the WIRE. They do not enforce entitlement, role or
 * ownership — those are the route's first two steps (§8.1) and no schema can stand in for
 * them. A client that constructs a valid body is still refused by the server if it is not
 * entitled.
 *
 * edge cases: `idempotency_key` is required on every mutation body. §4.2 is explicit that a
 * mutation without one is not finished, so it is not optional here either.
 */
import { z } from "zod";
import { diagnosticStateSchema } from "../diagnostic-state.js";
import { sectionProjectionSchema } from "../student-resources.js";
import { calendarEngineSchema } from "./scope.js";
import { planBlockSchema, planMemberSchema } from "./plan.js";
import { studyProfileSchema } from "./profile.js";
import {
  calendarDaySchema,
  calendarFactsSchema,
  guardianCalendarDaySchema,
} from "./read-model.js";
import { localDateSchema } from "./time.js";

// ── The platform error shape (Coding Standards §8.2) ────────────────────────

/**
 * `{ error: { message, code?, details? } }` — the standard's error envelope. Defined here
 * because no shared definition existed when the calendar needed one; it is deliberately NOT
 * calendar-named, and any other vertical that needs the shape should import this rather than
 * declare a second one.
 */
export const apiErrorSchema = z
  .object({
    error: z
      .object({
        message: z.string(),
        code: z.string().optional(),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export type ApiError = z.infer<typeof apiErrorSchema>;

// ── Shared pieces ───────────────────────────────────────────────────────────

const idempotencyKeySchema = z.string().uuid();

/** `calendar_plan_versions.trigger`, the CHECK verbatim. §17.4 maps it to banner copy. */
export const PLAN_TRIGGERS = [
  "setup",
  "profile_change",
  "weekly",
  "student_refresh",
  "post_exam",
  "day_edit",
  "day_regenerate",
  "day_reset",
  "do_it_now",
  "rollback",
] as const;
export const planTriggerSchema = z.enum(PLAN_TRIGGERS);
export type PlanTrigger = z.infer<typeof planTriggerSchema>;

/**
 * §12.7: the highest accepted version with `initiated_by <> 'student'` above the student's
 * acknowledged watermark, or null. `trigger` is here because §17.4's banner copy is keyed by
 * it; `version_no` is what POST `/acknowledge` sends back.
 */
export const unacknowledgedChangeSchema = z
  .object({
    version_no: z.number().int().positive(),
    trigger: planTriggerSchema,
    created_at: z.string(),
  })
  .strict();
export type UnacknowledgedChange = z.infer<typeof unacknowledgedChangeSchema>;

/**
 * §15 GET `/api/me/streak`, embedded in the calendar payload. The calendar does NOT compute
 * this — §14 puts `computeActivityStreak` in `packages/shared/src/streak.ts` and the IO in
 * `server/services/activity-streak.ts`, and the streak is served without a
 * `calendar_access` check (INV-08-20). This schema is the embed shape only; when that module
 * lands it should import this rather than declare a second one.
 *
 * `longest` stays null until G-08-11 clears and `current` until G-08-12 clears;
 * `history_complete` is false while either gate is open.
 */
export const streakSummarySchema = z
  .object({
    current: z.number().int().min(0).nullable(),
    longest: z.number().int().min(0).nullable(),
    history_complete: z.boolean(),
  })
  .strict();
export type StreakSummary = z.infer<typeof streakSummarySchema>;

/**
 * §17.3. The server cannot know what zone the student's device is on unless the client says
 * so, which is why the GET query carries an optional `device_timezone`: without it this
 * response field can never be populated. Both zones travel so the prompt can name them, and
 * the student decides — the calendar never changes a timezone silently.
 */
export const deviceTimezoneMismatchSchema = z
  .object({
    profile_timezone: z.string().min(1),
    device_timezone: z.string().min(1),
  })
  .strict();
export type DeviceTimezoneMismatch = z.infer<typeof deviceTimezoneMismatchSchema>;

// ── GET /api/calendar ───────────────────────────────────────────────────────

/** `?from&to`, both local dates; the route defaults them to today … +13 (§15). */
export const calendarQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    device_timezone: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (query) => query.from === undefined || query.to === undefined || query.from <= query.to,
    { message: "`from` must not be after `to`", path: ["from"] },
  );
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const calendarResponseSchema = z
  .object({
    profile: studyProfileSchema,
    days: z.array(calendarDaySchema),
    facts: calendarFactsSchema,
    streak: streakSummarySchema,
    latest_unacknowledged_nonstudent_change: unacknowledgedChangeSchema.nullable(),
    diagnostic_state: diagnosticStateSchema,
    /** Doc 05C's band, when one exists. Consumed, never computed here. */
    projection: z.array(sectionProjectionSchema).optional(),
    device_timezone_mismatch: deviceTimezoneMismatchSchema.optional(),
  })
  .strict();
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

// ── PUT /api/calendar/profile ───────────────────────────────────────────────

/**
 * The body schema is a FACTORY, not a constant: §8.1's bounds live in
 * `calendar_runtime_config` and the exam-date window is relative to the student's local
 * today. See `makeStudyProfileUpsertSchema` in `profile.js`.
 */
export const profileUpsertResponseSchema = z
  .object({
    profile: studyProfileSchema,
    /** Present when the edit triggered a regeneration (§12.1 `profile_change`). */
    version_no: z.number().int().positive().optional(),
  })
  .strict();
export type ProfileUpsertResponse = z.infer<typeof profileUpsertResponseSchema>;

// ── POST /plan/regenerate, /days/:date/regenerate, /days/:date/reset ────────

export const idempotentMutationBodySchema = z
  .object({ idempotency_key: idempotencyKeySchema })
  .strict();
export type IdempotentMutationBody = z.infer<typeof idempotentMutationBodySchema>;

/** `:date` for every day-scoped route. */
export const dayParamsSchema = z.object({ date: localDateSchema }).strict();
export type DayParams = z.infer<typeof dayParamsSchema>;

export const versionResponseSchema = z
  .object({ version_no: z.number().int().positive() })
  .strict();
export type VersionResponse = z.infer<typeof versionResponseSchema>;

// ── PUT /api/calendar/days/:date ────────────────────────────────────────────

/**
 * §12.4: the client sends the FULL desired member list for the date. An empty list is a
 * cleared day, not a no-op. The server injects any started block the client omitted (V-12),
 * so this schema describes what may be sent, not what will be stored.
 */
export const dayEditBodySchema = z
  .object({
    members: z.array(planMemberSchema),
    idempotency_key: idempotencyKeySchema,
  })
  .strict();
export type DayEditBody = z.infer<typeof dayEditBodySchema>;

export const dayEditResponseSchema = z
  .object({
    version_no: z.number().int().positive(),
    day: calendarDaySchema,
  })
  .strict();
export type DayEditResponse = z.infer<typeof dayEditResponseSchema>;

// ── POST /api/calendar/blocks/:id/launch ────────────────────────────────────

export const blockParamsSchema = z.object({ id: z.string().uuid() }).strict();
export type BlockParams = z.infer<typeof blockParamsSchema>;

/**
 * §15.1: no `idempotency_key` in the body. `CalendarLaunchService` is the sole owner of the
 * engine key and derives it as `calendar:block:<block_id>:<seq>`, which is what makes two
 * concurrent first launches one engine session (INV-08-18). A client-supplied key would
 * break that.
 *
 * `platform` is the `practice_sessions.platform` CHECK — `web` or `mobile`.
 */
export const launchBodySchema = z
  .object({
    client_instance_id: z.string().min(1),
    platform: z.enum(["web", "mobile"]),
  })
  .strict();
export type LaunchBody = z.infer<typeof launchBodySchema>;

export const launchResponseSchema = z
  .object({
    engine: calendarEngineSchema,
    session_id: z.string().uuid(),
    /** Where the client goes next, as the engine's own create contract returned it. */
    next: z.string().min(1),
    /** True when an already-active session was handed back rather than a new one created. */
    resumed: z.boolean(),
  })
  .strict();
export type LaunchResponse = z.infer<typeof launchResponseSchema>;

// ── POST /api/calendar/blocks/:id/do-it-now ─────────────────────────────────

export const doItNowResponseSchema = z
  .object({
    version_no: z.number().int().positive(),
    block: planBlockSchema,
  })
  .strict();
export type DoItNowResponse = z.infer<typeof doItNowResponseSchema>;

// ── POST /api/calendar/acknowledge ──────────────────────────────────────────

/**
 * §12.7, monotonic: acknowledging a version never lowers the watermark, so the same body
 * twice is the same outcome and no `idempotency_key` is needed.
 */
export const acknowledgeBodySchema = z
  .object({ version_no: z.number().int().positive() })
  .strict();
export type AcknowledgeBody = z.infer<typeof acknowledgeBodySchema>;

export const acknowledgeResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type AcknowledgeResponse = z.infer<typeof acknowledgeResponseSchema>;

// ── GET /api/guardian/students/:id/calendar ─────────────────────────────────

export const guardianCalendarQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  })
  .strict()
  .refine(
    (query) => query.from === undefined || query.to === undefined || query.from <= query.to,
    { message: "`from` must not be after `to`", path: ["from"] },
  );
export type GuardianCalendarQuery = z.infer<typeof guardianCalendarQuerySchema>;

/**
 * §16 and R-08-22: no profile, no target score, no controls, no explanation copy. The
 * guardian gets the same FACTS and nothing that would let a client infer a write path. The
 * shape is narrower than the student's by construction rather than by sanitising a wider one
 * on the way out — a `.strict()` object that never had the keys cannot leak them.
 */
export const guardianCalendarResponseSchema = z
  .object({
    days: z.array(guardianCalendarDaySchema),
    facts: calendarFactsSchema,
    streak: streakSummarySchema,
  })
  .strict();
export type GuardianCalendarResponse = z.infer<typeof guardianCalendarResponseSchema>;
