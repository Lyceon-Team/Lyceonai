/**
 * The module review page — CB-standard, after the last question.
 *
 * @spec [E7b brief: "a full screen after the last question of a module listing
 *        every question with answered / unanswered / marked state, clickable to jump
 *        back, submitting from there"] | @implemented [2026-09-25]
 *
 * plain English: the same cells and the same counts as the navigator (one summary
 * function), a jump back to any question, and the submit button. Nothing on it
 * says whether any answer is right.
 */
import type { ExamModule, ExamSection } from "@lyceon/shared/exam-runtime-schema";
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
import type { ModuleSummary } from "../lib/module-summary";
import { QuestionCell, StateLegend } from "./QuestionCell";

type Props = {
  section: ExamSection;
  module: ExamModule;
  summary: ModuleSummary;
  onGoTo: (ordinal: number) => void;
  onSubmit: () => void;
};

export function ModuleReview({ section, module, summary, onGoTo, onSubmit }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 md:px-10" data-testid="exam-review-page">
      <div className="flex flex-col gap-2">
        <h2 className="m-0 font-serif text-[26px] font-semibold">Check your work</h2>
        <p className="m-0 text-[15px] text-[var(--exam-muted)]">
          {EXAM_SECTION_LABEL[section]} · Module {module}. Choose any question to go back to it. When you're ready, submit
          the module.
        </p>
      </div>
      <dl className="m-0 grid grid-cols-3 gap-3" data-testid="exam-review-counts">
        {(
          [
            ["Answered", summary.answered],
            ["Unanswered", summary.unanswered],
            ["Marked for review", summary.marked],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg bg-[var(--exam-surface)] px-4 py-3">
            <dt className="text-[13px] text-[var(--exam-muted)]">{label}</dt>
            <dd className="m-0 text-xl font-semibold" data-count={label}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="rounded-xl border border-[var(--exam-line)] bg-[var(--exam-surface)] p-5">
        <div className="mb-4">
          <StateLegend />
        </div>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-2.5 p-0">
          {summary.cells.map((cell) => (
            <li key={cell.ordinal}>
              <QuestionCell cell={cell} current={false} onClick={() => onGoTo(cell.ordinal)} />
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSubmit}
          data-testid="exam-review-submit"
          className="min-h-[48px] rounded-full bg-[var(--exam-accent)] px-7 text-[15px] font-semibold text-white hover:bg-[var(--exam-accent-hover)]"
        >
          Submit module
        </button>
      </div>
    </div>
  );
}
