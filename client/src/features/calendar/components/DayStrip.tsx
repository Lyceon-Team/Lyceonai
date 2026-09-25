/**
 * §17.1 on a phone — the week as a row of seven days, one of which is open.
 *
 * @spec [Doc_05F_V1.0 §17.1, §17.7; Brief 11 Step 5] | @implemented [2026-09-24]
 *
 * plain English: seven buttons, Monday to Sunday. Tapping one opens that day's agenda
 * below. A dot means the day has work on it.
 *
 * WHY THIS EXISTS. At 390px the week grid is 7 × 132px = 924px inside a 390px scroller:
 * measured in Chromium against this stylesheet, `scrollWidth` 924 against `clientWidth`
 * 390. It did not break — the page itself never overflowed — but three days were visible
 * and Sunday was 534px away behind a sideways swipe, with no indication the other four
 * existed. A calendar with no hour grid has nothing to gain from a 7-column layout on a
 * phone; the day strip is the standard answer because it shows all seven at once and
 * spends the width on ONE day's content.
 *
 * trade-offs: the strip is navigation, not a second calendar. It carries the weekday, the
 * date and a has-work dot, and nothing else — no counts, no block titles. Anything more
 * and it competes with the agenda it is there to steer.
 *
 * edge cases: today is marked even when it is not the selected day, so the student can
 * always find their way back to it. `hasWork` is asked per date rather than derived from a
 * day object, because a date outside the loaded range has no day and must still render.
 */
import { dayOfMonth, shortWeekday } from "../lib/dates";

export type DayStripProps = {
  dates: readonly string[];
  selected: string;
  today: string;
  hasWork: (date: string) => boolean;
  onSelect: (date: string) => void;
};

export function DayStrip({
  dates,
  selected,
  today,
  hasWork,
  onSelect,
}: DayStripProps): JSX.Element {
  return (
    <div
      className="daystrip"
      role="tablist"
      aria-label="Days this week"
      data-testid="calendar-day-strip"
    >
      {dates.map((date) => {
        const isSelected = date === selected;
        const classes = [
          "daychip",
          isSelected ? "on" : "",
          date === today ? "is-today" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={date}
            type="button"
            role="tab"
            className={classes}
            aria-selected={isSelected}
            data-testid={`calendar-day-chip-${date}`}
            onClick={() => onSelect(date)}
          >
            <span className="dow">{shortWeekday(date)}</span>
            <span className="dnum">{dayOfMonth(date)}</span>
            {hasWork(date) ? (
              <i className="dot" aria-hidden="true" />
            ) : (
              <i className="dot off" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
