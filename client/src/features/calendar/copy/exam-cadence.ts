/**
 * @spec [Doc_05F_Study_Calendar, §8.1 full-length placement, §17.3 live readout;
 *        owner ruling 2026-09-26 (Brief 14, option A)]
 * @implemented [2026-09-27]
 *
 * plain English: the one sentence that says what a chosen practice-test cadence MEANS, plus
 * the two tables the controls that choose it are built from. Expected outcome: the setup form
 * and the settings sheet say the same thing about the same choice, because they call the same
 * function rather than each formatting the same fact.
 *
 * WHY THIS FILE EXISTS. The readout and the chip tables were written twice — once in
 * `SettingsSheet.tsx` and once in `SetupPopup.tsx` — and the two copies had already drifted
 * before either shipped: one said "no automatic practice tests" and the other "no practice
 * tests", one named the day as "Saturdays" and the other as "Sat". Two surfaces describing
 * one setting in two voices is the divergence the working rules call a defect even when no
 * two edits touch the same line.
 *
 * trade-offs: the count needs `final_exam_lead_days` and the target date, both server-owned,
 * so they are PARAMETERS rather than reads — this module holds copy and no policy, and the
 * number it prints comes from `fullLengthsBeforeTarget` in `packages/shared`, the same
 * function the generator's own steps are derived from.
 *
 * edge cases: a cadence with no target date states the RATE instead of a count, because a
 * count would have to invent a window; `fullLengthsBeforeTarget` returns null for exactly
 * that case and this is where that null becomes a sentence.
 */
import { fullLengthsBeforeTarget } from "@lyceon/shared/calendar";
import { dayAndMonth } from "../lib/dates";

/**
 * §8.1's four cadences. The VALUE is weeks and the label is copy, so renaming "Monthly"
 * never migrates data — `full_length_interval_weeks` stores 4 either way.
 */
export const EXAM_FREQUENCIES: readonly { value: number; label: string }[] = [
  { value: 1, label: "Weekly" },
  { value: 2, label: "Every 2 weeks" },
  { value: 3, label: "Every 3 weeks" },
  { value: 4, label: "Monthly" },
];

/** Sunday-is-0 — the Postgres DOW convention `study_days_mask` and `full_length_weekday` use. */
export const WEEKDAYS: readonly {
  dow: number;
  label: string;
  full: string;
}[] = [
  { dow: 0, label: "Sun", full: "Sunday" },
  { dow: 1, label: "Mon", full: "Monday" },
  { dow: 2, label: "Tue", full: "Tuesday" },
  { dow: 3, label: "Wed", full: "Wednesday" },
  { dow: 4, label: "Thu", full: "Thursday" },
  { dow: 5, label: "Fri", full: "Friday" },
  { dow: 6, label: "Sat", full: "Saturday" },
];

/**
 * The day a cadence adopts when a student names a frequency without naming a day.
 *
 * Saturday because the real SAT is sat on a Saturday morning and #928's worked example is a
 * Saturday exam. It is NOT a pre-selection: the weekday row still opens unanswered (R-08-27),
 * so this is only ever reached by a student who has said they want practice tests. The
 * alternative — leaving the weekday null — builds half a pair, and `full_length_pair` refuses
 * it, which would put a 400 in front of someone who answered the question correctly.
 */
export const DEFAULT_EXAM_WEEKDAY = 6;

/**
 * The exam half of the readout. THREE shapes, and which one appears is the point:
 *
 *   nothing chosen           "no automatic practice tests"
 *   cadence, no target date  "a practice test every 2 weeks, on Saturdays"
 *   cadence and a target     "about 5 practice tests before 5 December, on Saturdays"
 *
 * The COUNT only appears when there is something to count toward.
 */
export function examCadenceNote(input: {
  weekday: number | null;
  intervalWeeks: number | null;
  targetExamDate: string | null;
  today: string;
  finalExamLeadDays: number;
}): string {
  const day = WEEKDAYS.find((d) => d.dow === input.weekday);
  const weeks = input.intervalWeeks;
  if (day === undefined || weeks === null) return "no automatic practice tests";

  const onDay = `on ${day.full}s`;
  // THE SHARED FUNCTION, not a local estimate. It walks the generator's own steps, so the
  // number promised here is the number the plan will hold (§8.1).
  const count = fullLengthsBeforeTarget({
    today: input.today,
    intervalWeeks: weeks,
    preferredWeekday: input.weekday,
    targetExamDate: input.targetExamDate,
    finalExamLeadDays: input.finalExamLeadDays,
  });
  if (count === null) {
    const rate = weeks === 1 ? "every week" : `every ${weeks} weeks`;
    return `a practice test ${rate}, ${onDay}`;
  }
  const noun = count === 1 ? "practice test" : "practice tests";
  const when =
    input.targetExamDate === null
      ? "your test"
      : dayAndMonth(input.targetExamDate);
  return `about ${count} ${noun} before ${when}, ${onDay}`;
}
