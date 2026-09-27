/**
 * One question square, shared by the navigator and the review page so both draw
 * — and label — a question's state the same way.
 *
 * @spec [E7b brief: answered / unanswered / marked] | @implemented [2026-09-25]
 */
import type { ModuleCell } from "../lib/module-summary";

export function cellLabel(cell: ModuleCell, current: boolean): string {
  return [
    `Question ${cell.number}`,
    cell.answered ? "answered" : "unanswered",
    cell.marked ? "marked for review" : null,
    current ? "current question" : null,
  ]
    .filter((p): p is string => p !== null)
    .join(", ");
}

export function MarkedIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="var(--exam-marked)" stroke="var(--exam-marked)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function QuestionCell({
  cell,
  current,
  onClick,
}: {
  cell: ModuleCell;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={cellLabel(cell, current)}
      aria-current={current ? "step" : undefined}
      data-testid="exam-question-cell"
      data-answered={cell.answered}
      data-marked={cell.marked}
      className={[
        "relative flex h-11 w-full items-center justify-center rounded-lg text-sm",
        current
          ? "border-2 border-[var(--exam-ink)] bg-[var(--exam-surface)] font-semibold text-[var(--exam-ink)]"
          : cell.answered
            ? "border border-[var(--exam-accent)] bg-[var(--exam-accent)] font-medium text-white"
            : "border border-dashed border-[var(--exam-line-strong)] bg-[var(--exam-surface)] text-[var(--exam-muted)]",
      ].join(" ")}
    >
      {cell.number}
      {cell.marked && (
        <span className="absolute -right-1.5 -top-1.5">
          <MarkedIcon />
        </span>
      )}
    </button>
  );
}

export function StateLegend() {
  return (
    <div className="flex flex-wrap items-center gap-5 text-[13px] text-[var(--exam-muted)]" aria-hidden="true">
      <span className="flex items-center gap-2">
        <span className="inline-block h-[15px] w-[15px] rounded bg-[var(--exam-accent)]" />
        Answered
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-block h-[15px] w-[15px] rounded border border-dashed border-[var(--exam-line-strong)]" />
        Unanswered
      </span>
      <span className="flex items-center gap-2">
        <MarkedIcon />
        Marked for review
      </span>
    </div>
  );
}
