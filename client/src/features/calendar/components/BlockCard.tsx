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
import { compactBlockLabel, domainChipLabel } from "../lib/blocks";

const TONE_CLASS: Readonly<Record<ViewBlock["tone"], string>> = {
  math: "math",
  rw: "rw",
  review: "rev",
  exam: "exam",
};

type BlockCardProps = {
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
  const compact = compactBlockLabel(block);

  /*
   * "Full sitting" belongs to a FULL-LENGTH block and nothing else.
   *
   * `minutes` now has exactly ONE reason to be null: a full-length block has no
   * per-question figure to derive minutes from. The second reason is gone — the guardian
   * payload carries `estimates` too (owner ruling 2026-09-22), so there is no longer a
   * surface on which a practice block has no estimate. Keyed off the tone, which is the
   * fact that decides it, rather than off the absence of a number, which used to have two
   * meanings and silently conflated them.
   */
  const progressText =
    block.actual > 0 && !complete
      ? `${block.actual} of ${block.target} done`
      : null;
  const durationText =
    block.minutes ?? (block.tone === "exam" ? "Full sitting" : null);
  const subtitle =
    [durationText, progressText].filter((part) => part !== null).join(" · ") ||
    null;
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
      // screen-reader user is not told only "Math" and left to guess the rest. It is always the
      // FULL wording: the full title, never the compact one a narrow column draws, and each
      // domain by its canonical name, never the chip's short or truncated one (QA2-C).
      aria-label={`${block.title}${block.minutes === null ? "" : `, ${block.minutes}`}${
        block.started && !complete ? ", started" : ""
      }${block.actual > 0 && !complete ? `, ${block.actual} of ${block.target} done` : ""}${block.mix
        .map((entry) => `, ${entry.domain} ${entry.count}`)
        .join("")}`}
      {...attributes}
      {...listeners}
    >
      <i className="bar" aria-hidden="true" />
      <div className="ttl">
        {/*
          QA2-C (Karl, 2026-10-08): both wordings are drawn and the stylesheet shows one. The
          compact one ("Rev 15", `compactBlockLabel`) shows only where the column is too narrow
          for the full one (a seven-day week under 910px, `calendar-student.css`); the
          guardian's stylesheet never shows it. Hidden from assistive technology: the card's
          name already carries the full title. Where the two are the same words (a full-length
          test, OQ-62 (b)) one span is drawn at every width.
        */}
        {compact === block.title ? (
          <span className="ttl-only">{block.title}</span>
        ) : (
          <>
            <span className="ttl-full">{block.title}</span>
            <span className="ttl-short" aria-hidden="true">
              {compact}
            </span>
          </>
        )}
        {block.started && !complete ? (
          <span className="lock" aria-hidden="true">
            🔒 started
          </span>
        ) : null}
      </div>
      {subtitle === null ? null : <div className="sub">{subtitle}</div>}
      {block.mix.length > 0 ? (
        <div className="dom">
          {block.mix.map((entry) => (
            // QA2-C: the name and the count are separate boxes, so a narrow column can cut the
            // NAME with an ellipsis on one line while the count stays whole. The full canonical
            // name is the chip's title and is in the card's accessible name.
            <span key={entry.domain} title={entry.domain}>
              <span className="dname">{domainChipLabel(entry.domain)}</span>{" "}
              <span className="dcount">{entry.count}</span>
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
