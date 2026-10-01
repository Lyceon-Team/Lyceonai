/**
 * The platform activity streak — Doc 05F §14, §15 `GET /api/me/streak`.
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
 * "Streak is **not calendar-owned**". §14 names this path and this function, and §15
 * serves the streak WITHOUT a `calendar_access` check (INV-08-20), which is only
 * coherent if the streak has no calendar dependency at all. The calendar embeds it; it
 * does not own it. A copy under `services/calendar/` would make the practice page's
 * streak and the calendar's two different numbers.
 *
 * WHY THERE IS NO `computeActivityStreak`. §14 also names pure math in
 * `packages/shared/src/streak.ts`, and sheet item 11 supersedes that: until SCL-08-E
 * gives 05B a student-local day boundary and the rest-day skip, the route returns 05B's
 * value. Writing the math here would be a second streak — one stored, one derived —
 * disagreeing the day they diverge. When SCL-08-E lands, the skip rule belongs in 05B's
 * refresh, not here.
 *
 * expected outcome: the same number appears in the calendar header and on the practice
 * page, because both come from this function and this function reads one row.
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
import { streakSummarySchema, type StreakSummary } from "@lyceon/shared";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { classifyError } from "../lib/redact";

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
 * §15: `{ current, longest, history_complete }` for one student.
 *
 * Fails OPEN, to `null`s. A streak is a decoration on every surface that renders it —
 * the calendar, the practice page — and none of them should 500 because a KPI read
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
    .select("current_streak_days, longest_streak_days")
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

  // No row: the KPI refresh has not run for this student. Not an error, and not a zero.
  if (data === null) return UNKNOWN;

  const parsed = streakSummarySchema.safeParse({
    current: data.current_streak_days,
    longest: data.longest_streak_days,
    history_complete: HISTORY_COMPLETE,
  });
  if (!parsed.success) {
    // The columns are `integer NOT NULL CHECK (>= 0)`, so this is a schema divergence
    // rather than a data condition. Loud, and still not a 500 on a decoration.
    logger.warn(
      "ACTIVITY_STREAK",
      "kpi_shape_unexpected",
      "student_overall_kpi streak columns are not the non-negative integers this build expects",
      { requestId, issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
    );
    return UNKNOWN;
  }

  return parsed.data;
}
