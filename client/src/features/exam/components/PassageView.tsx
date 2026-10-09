/**
 * The RW passage with highlights.
 *
 * @spec [SCL-145 (code-point highlights on the passage); E7b owner ruling 5]
 * @implemented [2026-09-25]
 *
 * plain English: renders the passage as segments (lib/passage.ts), each tagged with
 * its code-point range. "Highlight" turns the current text selection inside the
 * passage into a range — snapped so a formula is never cut — and hands the new list
 * up; "Remove highlight" drops every highlight the selection touches; "Clear all"
 * empties the list. The toolbar buttons keep the selection alive (mousedown does
 * not steal it), and each is a real button reachable by keyboard.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExamHighlight } from "@lyceon/shared/exam-runtime-schema";
import MathRenderer from "@/components/MathRenderer";
import {
  addHighlight,
  buildPassageSegments,
  removeHighlights,
} from "../lib/passage";
import { selectionToPassageRange } from "../lib/passage-dom";

type Props = {
  passage: string;
  highlights: ReadonlyArray<ExamHighlight>;
  onChange: (next: ExamHighlight[]) => void;
};

const toolButton =
  "min-h-[44px] rounded-full border border-[var(--exam-line)] bg-[var(--exam-surface)] px-4 text-sm font-medium text-[var(--exam-ink)] hover:bg-[var(--exam-bg)] disabled:cursor-not-allowed disabled:opacity-50";

export function PassageView({ passage, highlights, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const segments = useMemo(
    () => buildPassageSegments(passage, highlights),
    [passage, highlights],
  );

  // Subscribes to the browser's selection so the buttons enable only when there is
  // something inside the passage to act on (an external event, not derived state).
  useEffect(() => {
    const onSelection = () => {
      const root = rootRef.current;
      setHasSelection(
        root !== null && selectionToPassageRange(document.getSelection(), root) !== null,
      );
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  const currentRange = () => {
    const root = rootRef.current;
    return root === null ? null : selectionToPassageRange(document.getSelection(), root);
  };

  const onHighlight = () => {
    const range = currentRange();
    if (range === null) return;
    const edit = addHighlight(passage, highlights, range.start, range.end);
    if (!edit.ok) {
      setNotice(
        edit.reason === "limit"
          ? "You've reached the highlight limit for this question. Remove one to add another."
          : null,
      );
      return;
    }
    setNotice(null);
    onChange(edit.highlights);
    document.getSelection()?.removeAllRanges();
  };

  const onRemove = () => {
    const range = currentRange();
    if (range === null) return;
    onChange(removeHighlights(highlights, range.start, range.end));
    document.getSelection()?.removeAllRanges();
  };

  const keepSelection = (e: React.MouseEvent) => e.preventDefault();

  return (
    <section aria-label="Passage" className="flex flex-col gap-4">
      <div role="toolbar" aria-label="Highlighting" className="flex flex-wrap gap-2">
        <button type="button" className={toolButton} onMouseDown={keepSelection} onClick={onHighlight} disabled={!hasSelection}>
          Highlight
        </button>
        <button type="button" className={toolButton} onMouseDown={keepSelection} onClick={onRemove} disabled={!hasSelection || highlights.length === 0}>
          Remove highlight
        </button>
        <button type="button" className={toolButton} onClick={() => onChange([])} disabled={highlights.length === 0}>
          Clear all
        </button>
      </div>
      {notice !== null && (
        <p role="status" className="text-sm text-[var(--exam-muted)]">
          {notice}
        </p>
      )}
      <div
        ref={rootRef}
        data-testid="exam-passage"
        className="exam-inline-math max-w-[62ch] whitespace-pre-wrap text-[17px] leading-[1.75]"
      >
        {segments.map((seg) =>
          seg.kind === "math" ? (
            <span
              key={`m${seg.start}`}
              data-seg-kind="math"
              data-seg-start={seg.start}
              data-seg-end={seg.end}
              className={seg.highlighted ? "rounded-sm bg-[var(--exam-highlight)]" : undefined}
            >
              <MathRenderer content={seg.source} />
            </span>
          ) : seg.highlighted ? (
            <mark
              key={`t${seg.start}`}
              data-seg-kind={seg.kind}
              data-seg-start={seg.start}
              data-seg-end={seg.end}
              className="rounded-sm bg-[var(--exam-highlight)] text-inherit"
            >
              {seg.text}
            </mark>
          ) : (
            <span
              key={`t${seg.start}`}
              data-seg-kind={seg.kind}
              data-seg-start={seg.start}
              data-seg-end={seg.end}
            >
              {seg.text}
            </span>
          ),
        )}
      </div>
    </section>
  );
}
