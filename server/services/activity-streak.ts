/**
 * The platform activity streak — Doc 05F §14. (§15's standalone streak route is retired:
 * SCL-212, owner ruling 2026-10-05, OQ-61 (a). The streak is served inside the calendar
 * payloads and `kpi/overall`, both read through here.)
 *
 * @spec [Doc-05F_V1.0 §14 (streak, R-08-25 B, INV-08-20), §15 (no
 *        `calendar_access` check); Doc_05F_formula_sheet.md §8 items 11 and 19;
 *        Doc-05B §4 `student_overall_kpi`]
 * | @implemented [2026-09-21]
 *
 * plain English: how many days in a row this student has done something. It reads two
 * columns Doc 05B already maintains and returns them. That is the whole service.
 *
 * WHY THIS FILE IS NOT UNDER `services/calendar/`. Sheet §8 item 11 is explicit —
 * "Streak is **not calendar-owned**". §14 names this path and this function, and
 * INV-08-20 keeps the streak independent of `calendar_access`, which is only coherent if
 * the streak has no calendar dependency at all. The calendar embeds it; it does not own
 * it. A copy under `services/calendar/` would make `kpi/overall`'s streak and the
 * calendar's two different numbers.
 *
 * WHY THERE IS NO `computeActivityStreak`. §14 also names pure math in
 * `packages/shared/src/streak.ts`, and sheet item 11 supersedes that: until SCL-08-E
 * gives 05B a student-local day boundary and the rest-day skip, this returns 05B's
 * value. Writing the math here would be a second streak — one stored, one derived —
 * disagreeing the day they diverge. When SCL-08-E lands, the skip rule belongs in 05B's
 * refresh, not here.
 *
 * expected outcome: the same number appears in the calendar payloads (which the guardian
 * calendar and the guardian dashboard header render) and in `kpi/overall`, because all of
 * them come from this file and it reads one row.
 *
 * trade-offs: `history_complete` is `false` on every path. That is not a placeholder —
 * it is the honest statement that the stored value uses 05B's UTC day boundary and
 * applies no rest-day skip, so it is not yet the streak §14 defines. It flips to `true`
 * when SCL-08-E lands and 05B's refresh implements both. Shipping `true` today would
 * claim a completeness nothing has produced.
 *
 * edge cases: a student with no `student_overall_kpi` row has not been through the KPI
 * refresh, so both numbers are `null` — "unknown", not "zero". Zero would assert that
 * they have studied on no day, which nothing here has established.
 */
import { z } from "zod";
import { streakSummarySchema, type StreakSummary } from "@lyceon/shared";
import type { Streak } from "../../packages/shared/src/home-qotd-schema";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { classifyError } from "../lib/redact";
import { getQuotaResetTimezone } from "../lib/account";
import { isKnownTimeZone } from "./calendar/adapters/local-day";

/**
 * The student's own zone: their study profile's `timezone` (Doc 05F §7.1), else the platform
 * zone (`quota_reset_timezone`, Doc 02B §41) for a student who has not set up a calendar.
 * A failed read throws; the caller decides whether that is fail-open or a 500.
 */
export async function resolveStudentTimeZone(
  studentId: string,
): Promise<string> {
  const { data, error } = await supabaseServer
    .from("student_study_profile")
    .select("timezone")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `student_study_profile timezone read failed: ${error.message}`,
    );
  }
  const zone: unknown = (data as { timezone?: unknown } | null)?.timezone;
  if (typeof zone === "string" && isKnownTimeZone(zone)) return zone;
  return getQuotaResetTimezone();
}

/**
 * THE daily streak (owner brief "Question of the Day on Home", Karl 2026-10-08/09; SCL-226):
 * consecutive America/Chicago days with at least one answered question from any source —
 * practice (the Question of the Day and the diagnostic included), review, full-length —
 * ending today or yesterday. Computed at read time by `public.student_streak`; nothing stored.
 * `broken` is true when the run is 0 but the student has answered before ("Start a new
 * streak today").
 *
 * Every surface reads it through here (Home, the calendar payloads, `kpi/overall`), so no two
 * can disagree. Throws on a failed read; `currentStreakAsOfToday` is the fail-open wrapper.
 */
export async function readDailyStreak(
  studentId: string,
  now: Date = new Date(),
): Promise<Streak> {
  const { data, error } = await supabaseServer.rpc("student_streak", {
    p_student_id: studentId,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`student_streak failed: ${error.message}`);
  const row: unknown = Array.isArray(data) ? data[0] : data;
  const parsed = streakRowSchema.safeParse(row);
  if (!parsed.success)
    throw new Error("student_streak returned an unexpected row");
  return {
    current: parsed.data.current_streak,
    today_done: parsed.data.today_done,
    broken: parsed.data.broken,
  };
}

const streakRowSchema = z.object({
  current_streak: z.number().int().min(0),
  today_done: z.boolean(),
  broken: z.boolean(),
});

/**
 * @spec [Guardian_Closure_Plan G-NEW-16; owner ruling 2026-09-30; owner decision 2026-10-01
 *       (an unreadable streak is an unknown streak, never a 500); SCL-193; SCL-226 (the source is
 *       now the Chicago-day answer streak)] | @implemented [2026-09-30; source changed 2026-10-09]
 *
 * plain English: the current streak for the calendar's `streak.current` (student and guardian
 * payloads) and both audiences of `kpi/overall`. Since SCL-226 it is `readDailyStreak`'s
 * `current`, so these surfaces show the number Home shows. `stored` and `lastActiveAt` (05B's
 * KPI columns) are no longer read for the current run; they stay in the signature so the
 * callers that already pass them need no change.
 *
 * FAILS OPEN, TO `null`, IN ONE PLACE: a failed read is an unknown streak on every surface.
 */
export async function currentStreakAsOfToday(args: {
  studentId: string;
  stored: number;
  lastActiveAt: unknown;
  now?: Date;
  requestId?: string;
}): Promise<number | null> {
  try {
    const streak = await readDailyStreak(
      args.studentId,
      args.now ?? new Date(),
    );
    return streak.current;
  } catch (readError) {
    logger.warn(
      "ACTIVITY_STREAK",
      "streak_read_failed",
      "the daily streak could not be read; the streak is served as unknown",
      { ...classifyError(readError), requestId: args.requestId },
    );
    return null;
  }
}

/**
 * `false` until SCL-08-E closes. A named constant rather than an inline literal at three
 * return sites, so the day it flips is one edit and not three.
 */
const HISTORY_COMPLETE = false;

const UNKNOWN: StreakSummary = {
  current: null,
  longest: null,
  history_complete: HISTORY_COMPLETE,
};

/**
 * §14: `{ current, longest, history_complete }` for one student, embedded in the calendar
 * payloads.
 *
 * Fails OPEN, to `null`s. A streak is a decoration on every surface that renders it —
 * the student and guardian calendars — and none of them should 500 because a KPI read
 * failed. The `null` says "unknown" and the client renders no streak, which is the same
 * thing it renders for a student who has none.
 */
export async function getStudentActivityStreak(
  studentId: string,
  requestId?: string,
): Promise<StreakSummary> {
  if (!studentId) return UNKNOWN;

  const { data, error } = await supabaseServer
    .from("student_overall_kpi")
    .select("current_streak_days, longest_streak_days, last_active_at")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    logger.warn(
      "ACTIVITY_STREAK",
      "kpi_read_failed",
      "student_overall_kpi read failed; the streak is served as unknown",
      { ...classifyError(error), requestId },
    );
    return UNKNOWN;
  }

  // SCL-226: `current` is the daily answer streak, whether or not the KPI refresh has run.
  // `longest` stays 05B's stored value where there is one, and is never below `current`.
  const current = await currentStreakAsOfToday({
    studentId,
    stored: 0,
    lastActiveAt: null,
    ...(requestId === undefined ? {} : { requestId }),
  });
  if (current === null) return UNKNOWN;
  const storedLongest: unknown = data?.longest_streak_days ?? null;
  const longest =
    typeof storedLongest === "number" ? Math.max(storedLongest, current) : null;

  const parsed = streakSummarySchema.safeParse({
    current,
    longest,
    history_complete: HISTORY_COMPLETE,
  });
  if (!parsed.success) {
    // The columns are `integer NOT NULL CHECK (>= 0)`, so this is a schema divergence
    // rather than a data condition. Loud, and still not a 500 on a decoration.
    logger.warn(
      "ACTIVITY_STREAK",
      "kpi_shape_unexpected",
      "student_overall_kpi streak columns are not the non-negative integers this build expects",
      {
        requestId,
        issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      },
    );
    return UNKNOWN;
  }

  return parsed.data;
}
