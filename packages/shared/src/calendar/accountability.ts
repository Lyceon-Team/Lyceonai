/**
 * The missed-day rule's input: which planned days the student did work on and which they missed.
 *
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Missed days and back on
 *        track": "A planned day is missed if it had blocks and none were completed … Rest days
 *        and days with no plan don't count. Days are evaluated in the student's calendar
 *        timezone once they've ended"; Doc-05F_V1.0 §14 `day.status` (`missed` = past, has
 *        blocks, no progress) and owner ruling B5 ("partial is never missed")]
 *        | @implemented [2026-10-13]
 *
 * plain English: a pure function over the days `buildCalendarRange` already derives — the same
 * statuses the student's and the guardian's calendars show, so the alert can never disagree with
 * the grid. For each day in the window that has blocks:
 *   - `complete` or `partial` → did_work (work done is final, so today counts as soon as it has
 *     any; this is what makes "back on track" arrive the day the student studies);
 *   - `missed` → missed (§14 gives that status only to a PAST day with blocks and no progress,
 *     so a day is never called missed before it has ended in its own timezone).
 * Every other status is not an outcome: `rest` (no blocks), `today` (no progress yet — not
 * ended), `upcoming`. The SQL rule (`accountability_record_day_outcomes`) owns the run, the
 * alert and the back-on-track transitions; this only says what each day was.
 *
 * WHERE THIS DIFFERS FROM THE BRIEF'S WORDING, AND WHY. The brief says "missed if … none were
 * COMPLETED". §14 and owner ruling B5 say a day with partial progress is `partial`, never
 * `missed` ("a student who did 12 of 20 did not miss the day"), and the calendar both parties
 * look at renders exactly that. Using §14 keeps the alert true to the grid; the difference is a
 * partial-only day, which this counts as work. Raised for Karl in the PR (open question 2).
 *
 * `completion` is the digest day's plan as the digest states it ("completed 1 of 2 planned
 * sessions"): blocks on that date, and blocks whose §13 status is `completed`.
 */
import { z } from "zod";
import { localDateSchema, type LocalDate } from "./time.js";
import type { CalendarDay } from "./read-model.js";

export const ACCOUNTABILITY_DAY_OUTCOMES = ["did_work", "missed"] as const;
export const accountabilityDayOutcomeSchema = z
  .object({
    date: localDateSchema,
    outcome: z.enum(ACCOUNTABILITY_DAY_OUTCOMES),
  })
  .strict();
export type AccountabilityDayOutcome = z.infer<
  typeof accountabilityDayOutcomeSchema
>;

export type AccountabilityEvaluation = {
  /** Planned days on or after `from`, ascending, each with what happened. */
  days: AccountabilityDayOutcome[];
  /** The digest day's plan: blocks planned and completed (0/0 when nothing is planned). */
  completion: { planned: number; completed: number };
};

export function evaluateAccountabilityDays(input: {
  days: readonly CalendarDay[];
  /** The first date not yet evaluated (inclusive). */
  from: LocalDate;
  /** The student's own today, in their calendar timezone. */
  today: LocalDate;
  /** The Chicago day of the digest; its plan is the completion line. */
  digestDate: LocalDate;
}): AccountabilityEvaluation {
  const days: AccountabilityDayOutcome[] = [];
  for (const day of [...input.days].sort((a, b) =>
    a.local_date < b.local_date ? -1 : a.local_date > b.local_date ? 1 : 0,
  )) {
    if (day.local_date < input.from || day.local_date > input.today) continue;
    if (day.blocks.length === 0) continue;
    if (day.status === "complete" || day.status === "partial") {
      days.push({ date: day.local_date, outcome: "did_work" });
    } else if (day.status === "missed") {
      days.push({ date: day.local_date, outcome: "missed" });
    }
  }

  const digestDay = input.days.find((d) => d.local_date === input.digestDate);
  const completion =
    digestDay === undefined
      ? { planned: 0, completed: 0 }
      : {
          planned: digestDay.blocks.length,
          completed: digestDay.blocks.filter((b) => b.status === "completed")
            .length,
        };
  return { days, completion };
}
