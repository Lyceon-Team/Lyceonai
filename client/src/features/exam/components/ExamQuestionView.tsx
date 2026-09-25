/**
 * One exam question — composed from the shared leaves, not forked from practice.
 *
 * @spec [Doc-04A_V2.2 §10.2 (pre-completion payload: correct_answer/explanation
 *        null); Coding Standards §5.2, §17]
 *       [E7 owner ruling: build a new exam question view from MathRenderer,
 *        NumericEntryInput, DesmosCalculator and MathReferenceSheet; practice's
 *        QuestionRenderer stays untouched]
 * @implemented [2026-09-25]
 *
 * plain English: renders exactly what the payload carries — passage, stem, options
 * or a grid-in box — plus the student's own marks. There is no correctness prop,
 * no explanation slot and no "check" control: nothing here can reveal anything.
 * NumericEntryInput is given value/onChange only; its result props stay unset.
 */
import type {
  ExamHighlight,
  ExamQuestionPayload,
  ExamWorkspaceItem,
} from "@lyceon/shared/exam-runtime-schema";
import MathRenderer from "@/components/MathRenderer";
import { NumericEntryInput } from "@/components/practice/NumericEntryInput";
import { ChoiceList } from "./ChoiceList";
import { PassageView } from "./PassageView";

type Props = {
  item: ExamQuestionPayload;
  number: number;
  /** Selected token (mcq) or the saved grid-in answer. */
  answer: string | null;
  /** Grid-in text being typed (may be ahead of the saved answer). */
  gridDraft: string;
  workspace: ExamWorkspaceItem;
  onSelect: (token: string) => void;
  onGridChange: (text: string) => void;
  onGridCommit: () => void;
  onToggleMark: () => void;
  onToggleEliminate: (token: string) => void;
  onHighlightsChange: (next: ExamHighlight[]) => void;
};

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function ExamQuestionView(props: Props) {
  const { item, number, workspace } = props;
  const marked = workspace.marked_for_review;

  const answerArea = (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-center justify-between">
        <span className="flex h-[30px] min-w-[30px] items-center justify-center rounded-md bg-[var(--exam-ink)] px-1.5 text-[15px] font-semibold text-white">
          <span className="sr-only">Question </span>
          {number}
        </span>
        <button
          type="button"
          aria-pressed={marked}
          data-testid="exam-mark-review"
          onClick={props.onToggleMark}
          className={[
            "flex min-h-[44px] items-center gap-2 rounded-full border px-3.5 text-[13px]",
            marked
              ? "border-[var(--exam-marked)] bg-[#FBF1E6] text-[var(--exam-marked)]"
              : "border-[var(--exam-line)] bg-[var(--exam-surface)] text-[var(--exam-muted)]",
          ].join(" ")}
        >
          <BookmarkIcon filled={marked} />
          {marked ? "Marked for review" : "Mark for review"}
        </button>
      </div>
      <div className="text-base font-semibold leading-relaxed" data-testid="exam-stem">
        <MathRenderer content={item.stem} />
      </div>
      {item.question_type === "multiple_choice" ? (
        <ChoiceList
          options={item.options}
          selected={props.answer}
          eliminated={workspace.eliminated_option_ids}
          onSelect={props.onSelect}
          onToggleEliminate={props.onToggleEliminate}
        />
      ) : (
        <div className="max-w-[330px]" onBlur={props.onGridCommit}>
          <NumericEntryInput value={props.gridDraft} onChange={props.onGridChange} />
        </div>
      )}
    </div>
  );

  if (item.passage === null) {
    return <div className="mx-auto w-full max-w-[760px] px-6 py-7 md:px-10">{answerArea}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="min-h-0 flex-1 overflow-y-auto border-b border-[var(--exam-line)] px-6 py-7 md:border-b-0 md:border-r md:px-10">
        <PassageView
          passage={item.passage}
          highlights={workspace.highlights}
          onChange={props.onHighlightsChange}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7 md:px-10">{answerArea}</div>
    </div>
  );
}
