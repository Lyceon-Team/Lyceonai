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
import { DayMenu, DayOffCard, type DayActions } from "./DayMenu";
import { canControlDay, isBlockedOut } from "../lib/day-state";

export type WeekGridProps = {
  dates: readonly string[];
  dayFor: (date: string) => ViewDay | null;
  today: string;
  visible: (block: ViewBlock) => boolean;
  canDrag: (day: ViewDay, block: ViewBlock) => boolean;
  onOpen: (blockId: string) => void;
  /** Absent on the guardian surface, so no column renders an add affordance. */
  onAddBlock?: (date: string) => void;
  /** §17.2's day controls, as a ⋯ menu. Absent on the guardian surface. */
  dayActions?: DayActions;
};

function DayColumn({
  date,
  day,
  today,
  visible,
  canDrag,
  onOpen,
  onAddBlock,
  dayActions,
}: {
  date: string;
  day: ViewDay | null;
  today: string;
  visible: (block: ViewBlock) => boolean;
  canDrag: (day: ViewDay, block: ViewBlock) => boolean;
  onOpen: (blockId: string) => void;
  onAddBlock?: (date: string) => void;
  dayActions?: DayActions;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${date}`,
    data: { date },
  });

  const blocks = day?.blocks ?? [];
  const shown = blocks.filter(visible);
  // A cleared day the STUDENT owns, told apart from a rest day the mask produced — see
  // lib/day-state. They look alike and mean opposite things.
  const blockedOut = isBlockedOut(day);
  const isRest = day !== null && blocks.length === 0 && !blockedOut;
  const planned = day?.plannedCount ?? 0;
  const done = day?.actualCount ?? 0;

  const meta = blockedOut
    ? "Day off"
    : isRest
      ? "Rest day"
      : done >= planned && planned > 0
        ? `Done · ${planned} done`
        : done > 0
          ? `${done} of ${planned}`
          : `${planned} planned`;

  const className = [
    "col",
    isRest ? "rest" : "",
    blockedOut ? "off" : "",
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
          {day?.isOverride === true && !blockedOut ? " · edited" : ""}
        </div>
        {/*
          §17.2's day controls. Only on a present-or-future day: §12.2 never owns a past
          date, so offering them there would be offering a control the server refuses.
        */}
        {canControlDay(date, today) ? (
          <DayMenu
            date={date}
            blockedOut={blockedOut}
            isOverride={day?.isOverride === true}
            {...(dayActions === undefined ? {} : { actions: dayActions })}
          />
        ) : null}
      </div>
      <div className="stack">
        {blockedOut ? (
          <DayOffCard
            date={date}
            {...(dayActions === undefined
              ? {}
              : { onUndo: dayActions.onUndoBlockOut })}
          />
        ) : shown.length === 0 ? (
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
  dayActions,
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
          {...(dayActions === undefined ? {} : { dayActions })}
        />
      ))}
    </div>
  );
}
