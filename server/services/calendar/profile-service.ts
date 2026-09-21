/**
 * CalendarProfileService — the study profile, read and written.
 *
 * @spec [Doc-05F_V1.0 §7.1 `student_study_profile`, §8.1 (setup fields and bounds),
 *        §8.2 (local dates), §12.1 (`profile_change`), §15 PUT `/api/calendar/profile`,
 *        R-08-04 (setup captures the profile); Doc_05F_formula_sheet.md §8 item 19
 *        (timezone fails open to America/Chicago); lyceon-coding-standards §7.1, §8.1]
 * | @implemented [2026-09-21]
 *
 * plain English: reads what the student told us about how they study, and writes changes
 * to it. A change that the auto planner owns then regenerates the future half of the
 * plan, because a study profile nobody replans against is a form, not a setting.
 *
 * WHY THE ZOD PARSE IS HERE AND NOT IN THE HANDLER. Coding Standards §8.1 puts the parse
 * third in the handler, and the calendar cannot: §8.1's bounds live in
 * `calendar_runtime_config` and the exam-date window is relative to the student's own
 * local today, so the schema is a FACTORY over two values that take database reads to
 * obtain. Doing those reads in the handler would put IO and workflow in the handler,
 * which the brief forbids outright. The body therefore arrives here as `unknown` and is
 * `safeParse`'d at this boundary — which is what §7.1 actually requires ("parsed before
 * entering business logic") — and an invalid body comes back as a `Result` the route
 * renders as 400 with the Zod flatten. The handler stays auth → entitlement → delegate.
 *
 * WHY A BAD TIMEZONE IS NOT A 400. Sheet §8 item 19: the timezone FAILS OPEN to
 * `America/Chicago` when the device zone is undetectable or invalid. A student whose
 * browser reports a zone this Postgres does not know gets a working calendar in Chicago
 * time, not a rejected settings save. That is why the zone is normalised here rather
 * than constrained in the schema — a schema that rejected it would make item 19
 * unreachable.
 *
 * expected outcome: `PUT /api/calendar/profile` with `timezone: "Mars/Olympus"` returns
 * 200 and stores `America/Chicago`.
 *
 * trade-offs: the zone is checked against `pg_timezone_names`, one extra round trip per
 * upsert that names a timezone. `Intl` would be free, but the column is read by PL/pgSQL
 * that does `AT TIME ZONE` on it — the database's own list is the authority, and a zone
 * `Intl` accepts and Postgres does not would fail at plan generation instead of here.
 *
 * edge cases: the first upsert INSERTs, and `timezone`, `study_days_mask` and
 * `daily_minutes` are NOT NULL with no default, so a create that omits either of the
 * latter two is refused (`incomplete`). No default is invented for them: R-08-03 has the
 * student state their study days and their time, and a guessed 30 minutes is an answer
 * they never gave. `setup_completed_at` is stamped by the write that first gives the row
 * a `target_score`, which is exactly the condition `setup_requires_target_score` encodes.
 */
import {
  err,
  makeStudyProfileUpsertSchema,
  studyProfileSchema,
  type Result,
  type StudyProfile,
  type StudyProfileUpsert,
  ok,
} from "@lyceon/shared";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";
import { classifyError } from "../../lib/redact";
import { localTodayIn } from "./adapters/local-day";
import { loadCalendarConfig } from "./config";
import { regeneratePlan } from "./plan-service";

/**
 * Sheet §8 item 19. The ONE fallback zone, named once. It is a product decision recorded
 * in the change record, not a default this module chose.
 */
export const FALLBACK_TIMEZONE = "America/Chicago";

/** The columns this service reads. Never `*`: `last_acknowledged_nonstudent_version_no`
 *  is the read service's business and the timestamps are nobody's. */
const PROFILE_COLUMNS =
  "timezone, target_exam_date, target_score, study_days_mask, daily_minutes, full_length_weekday, planner_mode, setup_completed_at";

export type ProfileFailure =
  | { kind: "invalid"; details: unknown }
  /** A create that did not carry the NOT NULL student inputs. */
  | { kind: "incomplete"; missing: readonly string[] }
  | { kind: "write_failed"; detail: string };

export type ProfileUpsertOutcome = {
  profile: StudyProfile;
  /** Present only when the edit regenerated the plan (§12.1 `profile_change`). */
  version_no?: number;
};

// ── Read ────────────────────────────────────────────────────────────────────

/**
 * The profile, or `null` when the student has never completed setup far enough for a row
 * to exist. `null` is a real answer — R-08-04's pre-setup state — and the route renders
 * it as "open setup", never as an error.
 */
export async function readStudyProfile(
  studentId: string,
  requestId?: string,
): Promise<StudyProfile | null> {
  const { data, error } = await supabaseServer
    .from("student_study_profile")
    .select(PROFILE_COLUMNS)
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    logger.error(
      "CALENDAR_PROFILE",
      "read_failed",
      "student_study_profile read failed",
      { ...classifyError(error), requestId },
    );
    throw new Error(`study_profile_read_failed: ${error.message}`);
  }
  if (data === null) return null;
  return parseProfileRow(data, requestId);
}

/**
 * A stored row becomes a `StudyProfile` by NAMING its eight fields, never by handing the row
 * object to the parser.
 *
 * `studyProfileSchema` is `.strict()` — it is the WIRE shape, and this value is served as
 * `response.profile` — so passing the row through would make the read fail the moment the
 * table gains a column, and `last_acknowledged_nonstudent_version_no` is already one the
 * SELECT does not name. Naming the fields is the same discipline `projection-read.ts` uses
 * and the same chokepoint rule as `toGuardianPlanBlock`: a column that is never read cannot
 * be spread into a response by a later edit, and a column added to the table cannot break
 * the read.
 */
function parseProfileRow(row: unknown, requestId: string | undefined): StudyProfile {
  const source = (row ?? {}) as Record<string, unknown>;
  const data = {
    timezone: source.timezone,
    target_exam_date: source.target_exam_date,
    target_score: source.target_score,
    study_days_mask: source.study_days_mask,
    daily_minutes: source.daily_minutes,
    full_length_weekday: source.full_length_weekday,
    planner_mode: source.planner_mode,
    setup_completed_at: source.setup_completed_at,
  };

  const parsed = studyProfileSchema.safeParse(data);
  if (!parsed.success) {
    // The row violates a CHECK this build believes the column has. That is a schema
    // divergence, not a student condition, and serving half a profile would hide it.
    logger.error(
      "CALENDAR_PROFILE",
      "row_shape_unexpected",
      "student_study_profile row does not match the shape this build expects",
      { requestId, issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
    );
    throw new Error("study_profile_row_shape_unexpected");
  }
  return parsed.data;
}

/**
 * The student's local today (§8.2), falling open to Chicago for a student with no
 * profile. Sheet item 19 names that fallback for exactly this case.
 */
export function localTodayForProfile(profile: StudyProfile | null, now?: Date): string {
  return localTodayIn(profile?.timezone ?? FALLBACK_TIMEZONE, now);
}

// ── Timezone normalisation (sheet §8 item 19) ───────────────────────────────

/**
 * `timezone` as it will be stored: the supplied zone if `pg_timezone_names` knows it,
 * `America/Chicago` otherwise.
 *
 * The lookup goes through `calendar_is_known_timezone`, not a list in this file, because
 * the database is what will use the value: `calendar_build_plan_input` does `AT TIME ZONE`
 * on it, and a zone `Intl` accepts and Postgres does not would fail at plan generation
 * instead of here. It is an RPC rather than a `from("pg_timezone_names")` because that
 * view lives in `pg_catalog`, which PostgREST does not expose.
 *
 * A read failure also falls open to Chicago: the alternative is refusing a settings save
 * over an infrastructure blip, and item 19 makes the fallback the defined behaviour for
 * "undetectable", which a failed lookup is. `data !== true` rather than `data === false`
 * for the same reason — anything that is not an explicit yes is a fall-open.
 */
export async function resolveStoredTimezone(
  candidate: string,
  requestId?: string,
): Promise<{ timezone: string; fellBack: boolean }> {
  const { data, error } = await supabaseServer.rpc("calendar_is_known_timezone", {
    p_timezone: candidate,
  });

  if (error) {
    logger.warn(
      "CALENDAR_PROFILE",
      "timezone_lookup_failed",
      "pg_timezone_names could not be read; the profile falls open to the default zone",
      { ...classifyError(error), requestId },
    );
    return { timezone: FALLBACK_TIMEZONE, fellBack: true };
  }
  if (data !== true) {
    // Deliberately INFO, not warn: an unknown zone is a defined outcome (item 19), not a
    // fault. The candidate is logged because a zone is not personal data and knowing
    // which zone a device reported is how a real IANA gap gets found.
    logger.info(
      "CALENDAR_PROFILE",
      "timezone_fell_back",
      "an unrecognised timezone fell open to the default zone",
      { candidate, fallback: FALLBACK_TIMEZONE, requestId },
    );
    return { timezone: FALLBACK_TIMEZONE, fellBack: true };
  }
  return { timezone: candidate, fellBack: false };
}

// ── Write ───────────────────────────────────────────────────────────────────

type UpsertRow = Record<string, string | number | null>;

/**
 * The §8.1 fields a row cannot be created without. `timezone` is absent because item 19
 * supplies it; these two have no honest fallback (R-08-03).
 */
const REQUIRED_ON_CREATE = ["study_days_mask", "daily_minutes"] as const;

export async function upsertStudyProfile(
  studentId: string,
  body: unknown,
  requestId?: string,
  now?: Date,
): Promise<Result<ProfileUpsertOutcome, ProfileFailure>> {
  const config = await loadCalendarConfig();
  const existing = await readStudyProfile(studentId, requestId);
  const localToday = localTodayForProfile(existing, now);

  const parsed = makeStudyProfileUpsertSchema({
    bounds: config.bounds,
    localToday,
  }).safeParse(body);
  if (!parsed.success) {
    return err({ kind: "invalid", details: parsed.error.flatten() });
  }
  const update: StudyProfileUpsert = parsed.data;

  if (existing === null) {
    const missing = REQUIRED_ON_CREATE.filter((field) => update[field] === undefined);
    if (missing.length > 0) return err({ kind: "incomplete", missing });
  }

  // Only the keys the body actually carried. An absent key means "leave it alone"
  // (§8.1) and an explicit null means "clear it", which is why this tests `undefined`
  // rather than truthiness — `target_score: null` and `full_length_weekday: 0` both
  // have to survive.
  const row: UpsertRow = { student_id: studentId };
  if (update.target_exam_date !== undefined) row.target_exam_date = update.target_exam_date;
  if (update.target_score !== undefined) row.target_score = update.target_score;
  if (update.study_days_mask !== undefined) row.study_days_mask = update.study_days_mask;
  if (update.daily_minutes !== undefined) row.daily_minutes = update.daily_minutes;
  if (update.full_length_weekday !== undefined) {
    row.full_length_weekday = update.full_length_weekday;
  }
  if (update.planner_mode !== undefined) row.planner_mode = update.planner_mode;

  let timezoneChanged = false;
  if (update.timezone !== undefined) {
    const resolved = await resolveStoredTimezone(update.timezone, requestId);
    row.timezone = resolved.timezone;
    timezoneChanged = resolved.timezone !== existing?.timezone;
  } else if (existing === null) {
    // A create with no zone at all. Item 19 covers "undetectable" as well as "invalid".
    row.timezone = FALLBACK_TIMEZONE;
  }

  // `setup_completed_at` is derived, never sent by a client. It is stamped by the write
  // that first gives the row a target score — the precise condition the
  // `setup_requires_target_score` CHECK encodes, so the derivation and the constraint
  // cannot disagree.
  const targetScoreAfter =
    update.target_score !== undefined ? update.target_score : (existing?.target_score ?? null);
  const completesSetup = existing?.setup_completed_at == null && targetScoreAfter !== null;
  if (completesSetup) row.setup_completed_at = new Date().toISOString();

  const { data, error } = await supabaseServer
    .from("student_study_profile")
    .upsert(row, { onConflict: "student_id" })
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    logger.error(
      "CALENDAR_PROFILE",
      "upsert_failed",
      "student_study_profile upsert failed",
      { ...classifyError(error), requestId },
    );
    return err({ kind: "write_failed", detail: error.message });
  }

  let after: StudyProfile;
  try {
    after = parseProfileRow(data, requestId);
  } catch {
    // `parseProfileRow` has already logged which fields disagreed. The upsert COMMITTED, so
    // this is a serialization failure and not a write failure — but the caller has nothing
    // to serve, so it is reported as one rather than as a success with no profile.
    return err({ kind: "write_failed", detail: "row_shape_unexpected" });
  }

  if (timezoneChanged) {
    // §18 event `calendar.timezone_changed`. The zone itself is NOT logged here: §18's
    // "never logged" list names it. The event is that it changed.
    logger.info(
      "CALENDAR_PROFILE",
      "timezone_changed",
      "the student changed their calendar timezone",
      { requestId },
    );
  }

  const versionNo = await regenerateAfterProfileChange({
    studentId,
    profile: after,
    idempotencyKey: update.idempotency_key,
    generatorVersion: config.generatorVersion,
    requestId,
  });

  return ok(versionNo === null ? { profile: after } : { profile: after, version_no: versionNo });
}

/**
 * §12.1 `profile_change`: student-initiated, future non-overridden dates, "auto (custom:
 * offered)". `offered` is a UI affordance — the settings sheet's `Refresh plan` button,
 * which is `student_refresh` — so a `custom` student is NOT regenerated here. Silently
 * replanning a student who turned the auto planner off would be the planner ignoring the
 * one setting that says not to.
 *
 * Returns `null` when nothing was regenerated, which is not a failure: the profile write
 * already succeeded and committed. A regeneration that fails is logged and swallowed for
 * the same reason — the student's setting IS saved, and telling them it was not would be
 * false. The stale plan is corrected by the next weekly run.
 */
async function regenerateAfterProfileChange(args: {
  studentId: string;
  profile: StudyProfile;
  idempotencyKey: string;
  generatorVersion: string;
  requestId?: string;
}): Promise<number | null> {
  if (args.profile.planner_mode !== "auto") return null;
  if (args.profile.setup_completed_at === null) return null;

  const result = await regeneratePlan(
    {
      student_id: args.studentId,
      trigger: "profile_change",
      initiated_by: "student",
      idempotency_key: args.idempotencyKey,
      generator_version: args.generatorVersion,
    },
    args.requestId,
  );

  if (!result.ok) {
    logger.error(
      "CALENDAR_PROFILE",
      "profile_change_regenerate_failed",
      "the profile was saved but the plan could not be regenerated; the prior plan stands",
      { requestId: args.requestId, reason: result.error.kind },
    );
    return null;
  }
  return result.value.version_no;
}
