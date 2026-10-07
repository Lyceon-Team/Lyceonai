/**
 * The one sentence for a study day with nothing planned.
 *
 * @spec [owner QA list (Karl, 2026-10-07) item 15: "one empty-day message (find every 'nothing
 *        planned'-style empty-day string across Home/calendar/plan and make them one shared
 *        constant)"; Doc 05F §17 (the calendar's day states)] | @implemented [2026-10-07]
 *
 * plain English: the calendar's week grid already says "No study planned" in an empty study day's
 * body (WeekGrid.tsx), and Home's Today's plan said "Rest day" for the same empty day. The
 * calendar's sentence is the one kept: it is true of every empty day, a rest day outside the
 * student's study days and a day they cleared alike, where "Rest day" is untrue of a day off.
 * Every surface that says a day has nothing planned imports it from here.
 *
 * The calendar's week grid imports it too (QA 2026-10-07).
 *
 * edge cases: the calendar's day HEADER labels ("Rest day", "Day off") are a different fact (which
 * kind of empty day it is) and stay the calendar's own.
 */
export const EMPTY_DAY_MESSAGE = "No study planned";
