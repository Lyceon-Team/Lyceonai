/**
 * @spec [Doc_05F_Study_Calendar, §17.1 layout, §14 day.status]
 * @implemented [2026-09-23]
 *
 * plain English: the six-by-seven month grid, one chip per block. Expected outcome: a month
 * of plan at a glance, with the same drag-to-move the week view has.
 *
 * SIX ROWS ALWAYS. `monthGridDates` returns 42 dates whatever the month, so paging forward
 * never makes the page jump by a row. Days outside the month are dimmed rather than blank —
 * a plan does not stop at a month boundary, and the last week of September is where the
 * first week of October's work is decided.
 */
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { dayOfMonth, isSameMonth, WEEKDAY_HEADERS } from "../lib/dates";
import type { ViewBlock, ViewDay } from "../lib/view-model";
import { DayMenu, type DayActions } from "./DayMenu";
import { canControlDay, isBlockedOut } from "../lib/day-state";

const TONE_CLASS: Readonly<Record<ViewBlock["tone"], string>> = {
  math: "math",
  rw: "rw",
  review: "rev",
  exam: "exam",
};

/** The chip's words are shorter than the card's, but the domain names are never abbreviated. */
function chipLabel(block: ViewBlock): string {
  if (block.tone === "exam") return "Practice test";
  if (block.tone === "review") return `Review ${block.target}`;
  return `${block.tone === "math" ? "Math" : "R&W"} ${block.target}`;
}

function MonthChip({
  block,
  date,
  draggable,
  onOpen,
}: {
  block: ViewBlock;
  date: string;
  draggable: boolean;
  onOpen: (blockId: string) => void;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: block.blockId,
    disabled: !draggable,
    data: { fromDate: date },
  });

  return (
    <button
      type="button"
      ref={setNodeRef}
      className={`mchip ${TONE_CLASS[block.tone]}${isDragging ? " dragging" : ""}`}
      onClick={() => onOpen(block.blockId)}
      data-testid={`calendar-month-chip-${block.blockId}`}
      data-draggable={draggable ? "true" : "false"}
      aria-label={`${block.title}`}
      {...attributes}
      {...listeners}
    >
      <i style={{ background: "currentColor" }} aria-hidden="true" />
      <span>{chipLabel(block)}</span>
    </button>
  );
}

function MonthCell({
  date,
  day,
  today,
  cursor,
  visible,
  canDrag,
  onOpen,
  dayActions,
  isTestDay,
}: {
  date: string;
  day: ViewDay | null;
  today: string;
  cursor: string;
  visible: (block: ViewBlock) => boolean;
  canDrag: (day: ViewDay, block: ViewBlock) => boolean;
  onOpen: (blockId: string) => void;
  dayActions?: DayActions;
  isTestDay: boolean;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${date}`,
    data: { date },
  });
  const blocks = day?.blocks ?? [];
  const shown = blocks.filter(visible);
  // Same distinction the week view draws, from the same helper: a day the STUDENT
  // cleared is not a rest day the mask produced.
  const blockedOut = isBlockedOut(day);
  const isRest = day !== null && blocks.length === 0 && !blockedOut;

  const className = [
    "mcell",
    isSameMonth(date, cursor) ? "" : "out",
    isRest ? "rest" : "",
    blockedOut ? "off" : "",
    date === today ? "today" : "",
    isTestDay ? "testday" : "",
    isOver ? "drop" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={setNodeRef}
      className={className}
      data-date={date}
      data-testid={`calendar-month-cell-${date}`}
      data-test-day={isTestDay ? "true" : undefined}
    >
      {isTestDay ? (
        <>
          {/* The star sits beside the number (prototype), so the two share a row. */}
          <span className="mrow">
            <span className="mnum">{dayOfMonth(date)}</span>
            <span
              className="star"
              role="img"
              aria-label="Test day"
              data-testid={`calendar-test-star-${date}`}
            >
              ★
            </span>
          </span>
          <span className="mtest">SAT test day</span>
        </>
      ) : (
        <span className="mnum">{dayOfMonth(date)}</span>
      )}
      {canControlDay(date, today) ? (
        <DayMenu
          date={date}
          blockedOut={blockedOut}
          isOverride={day?.isOverride === true}
          {...(dayActions === undefined ? {} : { actions: dayActions })}
        />
      ) : null}
      {blockedOut ? <span className="moff">Day off</span> : null}
      {shown.map((block) => (
        <MonthChip
          key={block.blockId}
          block={block}
          date={date}
          draggable={day !== null && canDrag(day, block)}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

export type MonthGridProps = {
  dates: readonly string[];
  cursor: string;
  dayFor: (date: string) => ViewDay | null;
  today: string;
  visible: (block: ViewBlock) => boolean;
  canDrag: (day: ViewDay, block: ViewBlock) => boolean;
  onOpen: (blockId: string) => void;
  /** §17.2's day controls, the SAME menu the week view renders. Absent for a guardian. */
  dayActions?: DayActions;
  /** UI-55: the student's SAT date, starred (see `WeekGridProps.testDate`). */
  testDate?: string | null;
};

export function MonthGrid({
  dates,
  cursor,
  dayFor,
  today,
  visible,
  canDrag,
  onOpen,
  dayActions,
  testDate = null,
}: MonthGridProps): JSX.Element {
  return (
    <div data-testid="calendar-month-grid">
      <div className="mhead">
        {WEEKDAY_HEADERS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="month">
        {dates.map((date) => (
          <MonthCell
            key={date}
            date={date}
            day={dayFor(date)}
            today={today}
            cursor={cursor}
            visible={visible}
            canDrag={canDrag}
            onOpen={onOpen}
            {...(dayActions === undefined ? {} : { dayActions })}
            isTestDay={testDate !== null && date === testDate}
          />
        ))}
      </div>
    </div>
  );
}
