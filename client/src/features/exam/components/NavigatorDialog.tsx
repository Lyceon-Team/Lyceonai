/**
 * The question navigator — the shortcut to any question and to the review page.
 *
 * @spec [E7b brief: navigator popup; counts from the one summary (module-summary.ts)]
 * @implemented [2026-09-25]
 *
 * plain English: a modal (focus trapped, Escape closes) with one real button per
 * question, labelled with its number and its state in words ("Question 10,
 * unanswered, marked for review"), so the grid works by keyboard and by ear.
 */
import type { ExamModule, ExamSection } from "@lyceon/shared/exam-runtime-schema";
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ModuleSummary } from "../lib/module-summary";
import { useReturnFocus } from "../hooks/useReturnFocus";
import { QuestionCell, StateLegend } from "./QuestionCell";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: ExamSection;
  module: ExamModule;
  summary: ModuleSummary;
  currentOrdinal: number | null;
  onGoTo: (ordinal: number) => void;
  onGoToReview: () => void;
};

export function NavigatorDialog(props: Props) {
  const { summary } = props;
  const focus = useReturnFocus();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="exam-root max-w-4xl gap-5 bg-[var(--exam-surface)] p-6 md:p-8"
        onOpenAutoFocus={focus.onOpenAutoFocus}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pr-8">
          <DialogTitle className="text-base font-semibold">
            {EXAM_SECTION_LABEL[props.section]} · Module {props.module}
          </DialogTitle>
          <StateLegend />
        </div>
        <DialogDescription className="sr-only">
          {summary.answered} of {summary.total} answered, {summary.marked} marked for review. Choose a question to go to it.
        </DialogDescription>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-2.5 p-0" data-testid="exam-navigator-grid">
          {summary.cells.map((cell) => (
            <li key={cell.ordinal}>
              <QuestionCell
                cell={cell}
                current={cell.ordinal === props.currentOrdinal}
                onClick={() => props.onGoTo(cell.ordinal)}
              />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-3">
          {summary.firstUnanswered !== null && (
            <button
              type="button"
              onClick={() => props.onGoTo(summary.firstUnanswered!)}
              className="min-h-[44px] rounded-full border border-[var(--exam-line)] bg-[var(--exam-surface)] px-5 text-sm font-medium"
            >
              Go to first unanswered
            </button>
          )}
          <button
            type="button"
            onClick={props.onGoToReview}
            className="min-h-[44px] rounded-full bg-[var(--exam-accent)] px-6 text-sm font-medium text-white hover:bg-[var(--exam-accent-hover)]"
          >
            Go to review page
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
