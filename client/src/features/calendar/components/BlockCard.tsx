/**
 * @spec [Doc_05F_Study_Calendar, §17.1 rows, §12.2 protected state, §17.7 components]
 * @implemented [2026-09-23]
 *
 * plain English: one block in the week grid. Expected outcome: the student can see what the
 * block is, how far through it they are, and can pick it up and drop it on another day —
 * unless it is started, in the past, or they are a guardian.
 *
 * DRAGGABILITY IS DECIDED BY THE DATA, NOT BY A PROP. `useDraggable` is called with
 * `disabled`, so a block that must not move never receives drag listeners at all. That
 * mirrors `calendar_move_block`'s refusals client-side (§12.2), which is what stops an
 * illegal drag from ever leaving the pointer — the server still decides, because the two
 * clocks can disagree about "today".
 *
 * trade-offs: the card is a `<button>`, not a `<div>` with a click handler. It is the thing
 * that opens the side sheet, so it must be reachable and operable from the keyboard; the
 * prototype's `<article>` was not.
 *
 * edge cases: a started block shows a lock glyph and keeps its progress bar. §12.2 protects
 * it, and telling the student WHY it will not move is the difference between a locked
 * control and a broken one.
 */
import { useDraggable } from "@dnd-kit/core";
import type { ViewBlock } from "../lib/view-model";

const TONE_CLASS: Readonly<Record<ViewBlock["tone"], string>> = {
  math: "math",
  rw: "rw",
  review: "rev",
  exam: "exam",
};

export type BlockCardProps = {
  block: ViewBlock;
  date: string;
  /** False when the block is started, the day is past, or the viewer is a guardian. */
  draggable: boolean;
  onOpen: (blockId: string) => void;
};

export function BlockCard({
  block,
  date,
  draggable,
  onOpen,
}: BlockCardProps): JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: block.blockId,
    disabled: !draggable,
    data: { fromDate: date },
  });

  const complete = block.target > 0 && block.actual >= block.target;
  const percent =
    block.target > 0 ? Math.min(100, Math.round(block.progress * 100)) : 0;

  const className = [
    "block",
    TONE_CLASS[block.tone],
    complete ? "done" : "",
    draggable ? "" : "locked",
    isDragging ? "dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      ref={setNodeRef}
      className={className}
      onClick={() => onOpen(block.blockId)}
      data-testid={`calendar-block-${block.blockId}`}
      data-draggable={draggable ? "true" : "false"}
      // The accessible name carries everything the visual card carries, in order, so a
      // screen-reader user is not told only "Math" and left to guess the rest.
      aria-label={`${block.title}${block.minutes === null ? "" : `, ${block.minutes}`}${
        block.started && !complete ? ", started" : ""
      }${block.actual > 0 && !complete ? `, ${block.actual} of ${block.target} done` : ""}`}
      {...attributes}
      {...listeners}
    >
      <i className="bar" aria-hidden="true" />
      <div className="ttl">
        {block.title}
        {block.started && !complete ? (
          <span className="lock" aria-hidden="true">
            🔒 started
          </span>
        ) : null}
      </div>
      <div className="sub">
        {block.minutes ?? "Full sitting"}
        {block.actual > 0 && !complete
          ? ` · ${block.actual} of ${block.target} done`
          : ""}
      </div>
      {block.mix.length > 0 ? (
        <div className="dom">
          {block.mix.map((entry) => (
            <span key={entry.domain}>
              {entry.domain} {entry.count}
            </span>
          ))}
        </div>
      ) : null}
      {block.actual > 0 ? (
        <div className="progress" aria-hidden="true">
          <i
            style={{
              width: `${percent}%`,
              background: "currentColor",
              opacity: 0.45,
            }}
          />
        </div>
      ) : null}
    </button>
  );
}
