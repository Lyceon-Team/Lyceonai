/**
 * @spec [Doc_05F_Study_Calendar, §17.1 week strip + day list, §14 day.status, §12.2]
 * @implemented [2026-09-23]
 *
 * plain English: the seven-column agenda. Expected outcome: one column per local day, each
 * a drop target, each headed by the date and what is planned against what is done.
 *
 * AGENDA COLUMNS, NOT AN HOUR GRID. The plan has no times of day — §7.4 gives a block a
 * `scheduled_date` and nothing finer, and the student chooses when within the day. Drawing
 * an hour grid would invent a precision the data does not have.
 *
 * edge cases: a rest day is hatched and says so. A day with blocks that are all filtered out
 * says "Nothing to show" rather than "No study planned" — the two are different facts, and
 * telling a student they have nothing planned because they unticked a filter is a lie.
 */
import { useDroppable } from "@dnd-kit/core";
import { dayOfMonth, shortWeekday } from "../lib/dates";
import type { ViewBlock, ViewDay } from "../lib/view-model";
import { BlockCard } from "./BlockCard";

export type WeekGridProps = {
  dates: readonly string[];
  dayFor: (date: string) => ViewDay | null;
  today: string;
  visible: (block: ViewBlock) => boolean;
  canDrag: (day: ViewDay, block: ViewBlock) => boolean;
  onOpen: (blockId: string) => void;
  /** Absent on the guardian surface, so no column renders an add affordance. */
  onAddBlock?: (date: string) => void;
  /** §17.2's day footer, as a header menu. Absent on the guardian surface. */
  onRegenerateDay?: (date: string) => void;
  onResetDay?: (date: string) => void;
};

function DayColumn({
  date,
  day,
  today,
  visible,
  canDrag,
  onOpen,
  onAddBlock,
  onRegenerateDay,
  onResetDay,
}: {
  date: string;
  day: ViewDay | null;
  today: string;
  visible: (block: ViewBlock) => boolean;
  canDrag: (day: ViewDay, block: ViewBlock) => boolean;
  onOpen: (blockId: string) => void;
  onAddBlock?: (date: string) => void;
  onRegenerateDay?: (date: string) => void;
  onResetDay?: (date: string) => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${date}`,
    data: { date },
  });

  const blocks = day?.blocks ?? [];
  const shown = blocks.filter(visible);
  const isRest = day !== null && blocks.length === 0;
  const planned = day?.plannedCount ?? 0;
  const done = day?.actualCount ?? 0;

  const meta = isRest
    ? "Rest day"
    : done >= planned && planned > 0
      ? `Done · ${planned} done`
      : done > 0
        ? `${done} of ${planned}`
        : `${planned} planned`;

  const className = [
    "col",
    isRest ? "rest" : "",
    date === today ? "today" : "",
    isOver ? "drop" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={setNodeRef}
      className={className}
      data-date={date}
      data-testid={`calendar-day-${date}`}
    >
      <div className="dayhead">
        <div className="dow">{shortWeekday(date)}</div>
        <div className="dnum">
          {dayOfMonth(date)}
          {date === today ? <em>Today</em> : null}
        </div>
        <div className="dmeta">
          {meta}
          {day?.isOverride === true ? " · edited" : ""}
        </div>
        {/*
          §17.2's day footer, sited in the header because the agenda column has no footer.
          Only on a present-or-future day: §12.2 never replans a past date, so offering it
          there would be offering a control the server refuses with a 409.
        */}
        {onRegenerateDay !== undefined && date >= today ? (
          <div className="daymenu">
            <button type="button" onClick={() => onRegenerateDay(date)}>
              Regenerate day
            </button>
            {onResetDay !== undefined && day?.isOverride === true ? (
              <button type="button" onClick={() => onResetDay(date)}>
                Reset to auto
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="stack">
        {shown.length === 0 ? (
          <div className="empty">
            {isRest ? "No study planned" : "Nothing to show"}
          </div>
        ) : (
          shown.map((block) => (
            <BlockCard
              key={block.blockId}
              block={block}
              date={date}
              draggable={day !== null && canDrag(day, block)}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
      {onAddBlock !== undefined && date >= today ? (
        <button type="button" className="add" onClick={() => onAddBlock(date)}>
          + Add block
        </button>
      ) : null}
    </div>
  );
}

export function WeekGrid({
  dates,
  dayFor,
  today,
  visible,
  canDrag,
  onOpen,
  onAddBlock,
  onRegenerateDay,
  onResetDay,
}: WeekGridProps): JSX.Element {
  return (
    <div className="week" data-testid="calendar-week-grid">
      {dates.map((date) => (
        <DayColumn
          key={date}
          date={date}
          day={dayFor(date)}
          today={today}
          visible={visible}
          canDrag={canDrag}
          onOpen={onOpen}
          {...(onAddBlock === undefined ? {} : { onAddBlock })}
          {...(onRegenerateDay === undefined ? {} : { onRegenerateDay })}
          {...(onResetDay === undefined ? {} : { onResetDay })}
        />
      ))}
    </div>
  );
}
