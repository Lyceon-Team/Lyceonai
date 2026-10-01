/**
 * The activity streak as of TODAY — Guardian_Closure_Plan G-NEW-16.
 *
 * @spec [Doc-05F §14 (the streak, read from Doc 05B's `student_overall_kpi`); owner ruling
 *        2026-09-30 on G-NEW-16] | @implemented [2026-09-30]
 *
 * plain English: `student_overall_kpi.current_streak_days` is recomputed only when an answer is
 * written, so a student who stops practising kept their old streak on every surface until
 * their next answer. The owner's ruling: at READ time, the current streak is 0 when the last
 * active day is before yesterday in the student's local date. Yesterday still counts — the
 * student can keep the streak alive today. The stored column is not changed.
 *
 * Pure and zone-free: the caller converts both instants to the student's local dates. One
 * function, so the calendar's `streak.current` and `kpi/overall` cannot disagree.
 *
 * edge cases: no last-active date with a positive stored streak cannot be trusted, so it is 0;
 * a last-active date in the future (clock skew) is treated as today.
 */
import { daysBetweenLocalDates, type LocalDate } from "./calendar/time.js";

export function streakAsOfToday(input: {
  stored: number;
  lastActiveLocalDate: LocalDate | null;
  todayLocalDate: LocalDate;
}): number {
  if (input.stored <= 0) return 0;
  if (input.lastActiveLocalDate === null) return 0;
  const daysSince = daysBetweenLocalDates(
    input.lastActiveLocalDate,
    input.todayLocalDate,
  );
  return daysSince > 1 ? 0 : input.stored;
}
