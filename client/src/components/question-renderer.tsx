/**
 * The question runner's body: passage, stem, the lettered choices (or the grid-in box), and the
 * feedback panel after submitting.
 *
 * @spec [DESIGN.md §4 Question runner (choices lettered A–D by on-screen position, ruled
 *        2026-10-02; the feedback panel shows the correct answer and the student's pick, the
 *        explanation, and the review-queue note on a miss); design/prototype/Runner.dc.html;
 *        student-UI register §2 (Keyboard: ↑/↓ choose, Enter submits), UI-53; wiring table §1,
 *        §5; Coding Standards §5.2 (no reveal before submit)] | @implemented [2026-10-03]
 *
 * plain English: draws on the student tokens only, so it is right in light and dark.
 *   - Choices are a radio group. Each choice's letter is its POSITION on screen (A is the first
 *     choice shown, B the second), never a stored option letter: the served payload carries
 *     opaque `opt_…` ids in the served order and no letters at all, so there is nothing else
 *     to letter by. LISA is told the same letters by the server (tutor-context.ts, Step 0b).
 *   - Before submit, nothing here can know which choice is correct: the props that say so
 *     (`correctOptionId`, `correctAnswer`, `explanation`, `isCorrect`) are only set by the
 *     answer response, and the panel and the tags render only when `showResult` is true.
 *   - After submit: "Correct answer" tags the right choice and "Your answer" the student's
 *     wrong pick (a right pick is tagged "Correct answer"); the panel is titled "Correct" or
 *     "Not quite", shows the explanation, and on a miss (when `missNote`) says the question
 *     has gone to the review queue. A grid-in states "Your answer:" and "Correct answer:" in the
 *     panel (the shipped grid-in wording).
 * trade-offs: copy is the prototype's or already shipped ("Explanation is not available for this
 * question yet." when a row has none). edge cases: a choice list with no usable text reports
 * itself through `onMissingMcChoices` (the loop skips the item), as before.
 */
import { useEffect, useMemo } from "react";
import MathRenderer from "@/components/MathRenderer";
import { NumericEntryInput } from "@/components/practice/NumericEntryInput";
import { LYC_FOCUS } from "@/components/ui/button";
import { RUNNER_OPTION_ATTR } from "@/hooks/useKeyboardShortcuts";
import { cn } from "@/lib/utils";

type QuestionOption = {
  id?: string | null;
  text?: string | null;
};

type Question = {
  questionType?: "multiple_choice" | "grid_in" | null;
  itemType?: "mcq" | "grid_in" | null;
  inputMode?: "choice" | "numeric_entry" | null;
  stem: string;
  passage?: string | null;
  options?: QuestionOption[] | null;
};

/** Display letters by on-screen position (ruled 2026-10-02). */
export const DISPLAY_LETTERS = ["A", "B", "C", "D"] as const;

/** Runner.dc.html's sentence on a miss. */
export const MISS_NOTE = "This question has gone to your review queue.";
const NO_EXPLANATION = "Explanation is not available for this question yet.";

type NormalizedOption = { id: string; text: string };

export type QuestionRendererProps = {
  question: Question;
  selectedAnswer: string | null;
  onSelectAnswer: (optionId: string) => void;
  freeResponseAnswer?: string;
  onFreeResponseAnswerChange?: (val: string) => void;
  showResult: boolean;
  isCorrect?: boolean | null;
  correctOptionId?: string | null;
  correctAnswer?: string | null;
  explanation?: string | null;
  /** Show the review-queue note on a miss (practice; engine-config `features.missNote`). */
  missNote?: boolean;
  disabled?: boolean;
  onMissingMcChoices?: () => void;
};

function choiceTone(state: "idle" | "picked" | "correct" | "wrong"): string {
  switch (state) {
    case "picked":
      return "border-2 border-lyc-ink-strong bg-lyc-chip";
    case "correct":
      return "border-2 border-lyc-lv4-fill bg-lyc-lv4-bg";
    case "wrong":
      return "border-2 border-lyc-danger bg-lyc-danger-bg";
    default:
      return "border border-lyc-rule bg-lyc-sheet hover:bg-lyc-margin";
  }
}

export default function QuestionRenderer({
  question,
  selectedAnswer,
  onSelectAnswer,
  freeResponseAnswer,
  onFreeResponseAnswerChange,
  showResult,
  isCorrect,
  correctOptionId,
  correctAnswer,
  explanation,
  missNote = false,
  disabled = false,
  onMissingMcChoices,
}: QuestionRendererProps): JSX.Element | null {
  const isGrid =
    question.questionType === "grid_in" ||
    question.itemType === "grid_in" ||
    question.inputMode === "numeric_entry";

  const options = useMemo(
    () =>
      (question.options ?? [])
        .map((o) => ({
          id: (o.id ?? "").trim(),
          text: (o.text ?? "").toString().trim(),
        }))
        .filter(
          (o): o is NormalizedOption => o.id.length > 0 && o.text.length > 0,
        ),
    [question.options],
  );
  const hasChoices = options.length > 0;

  useEffect(() => {
    if (!hasChoices && !isGrid) onMissingMcChoices?.();
    // The loop's skip handler is not stable across renders; report once per question shape.
  }, [hasChoices, isGrid]);

  if (!hasChoices && !isGrid) return null;

  const selected = (selectedAnswer ?? "").trim();
  const correctId = showResult ? (correctOptionId ?? "").trim() : "";
  const typed = (freeResponseAnswer ?? "").trim();
  const shownExplanation = (explanation ?? "").trim();

  return (
    // SCL-204 / R32: `ph-no-capture` on the question/answer area (practice, review, QOTD) — student
    // answers are never recorded (Coding Standards §12).
    <div className="ph-no-capture flex flex-col gap-[26px]">
      {question.passage ? (
        <div
          data-testid="runner-passage"
          className="whitespace-pre-wrap border-l-2 border-lyc-rule pl-5 text-lyc-body-lg text-lyc-ink"
        >
          <MathRenderer content={question.passage} />
        </div>
      ) : null}
      <div
        data-testid="runner-stem"
        className="font-lyc-serif text-[23px] leading-[1.55] text-lyc-ink-strong"
      >
        <MathRenderer content={question.stem} />
      </div>

      {isGrid ? (
        <NumericEntryInput
          value={freeResponseAnswer ?? ""}
          onChange={(val) => onFreeResponseAnswerChange?.(val)}
          disabled={disabled || showResult}
        />
      ) : (
        <div
          role="radiogroup"
          aria-label="Answer choices"
          className="flex flex-col gap-3"
        >
          {options.map((opt, index) => {
            const letter = DISPLAY_LETTERS[index] ?? null;
            const picked = selected.length > 0 && opt.id === selected;
            const isCorrectChoice =
              correctId.length > 0 && opt.id === correctId;
            const state = showResult
              ? isCorrectChoice
                ? "correct"
                : picked
                  ? "wrong"
                  : "idle"
              : picked
                ? "picked"
                : "idle";
            const tag =
              state === "correct"
                ? "Correct answer"
                : state === "wrong"
                  ? "Your answer"
                  : "";
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={picked}
                // Enter on a focused choice submits rather than re-picking it (register §2
                // Keyboard, UI-45).
                {...{ [RUNNER_OPTION_ATTR]: "" }}
                data-testid="runner-choice"
                disabled={disabled || showResult}
                onClick={() => onSelectAnswer(opt.id)}
                className={cn(
                  LYC_FOCUS,
                  "flex w-full items-center gap-4 rounded-lg px-5 py-4 text-left text-[19px] text-lyc-ink disabled:cursor-default",
                  choiceTone(state),
                )}
              >
                {letter ? (
                  <span
                    aria-hidden="true"
                    data-testid="runner-choice-letter"
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lyc-meta-lg font-semibold",
                      picked && !showResult
                        ? "bg-lyc-ink-strong text-lyc-paper"
                        : "border-2 border-lyc-input-bd text-lyc-ink-strong",
                    )}
                  >
                    {letter}
                  </span>
                ) : null}
                <span className="sr-only">{letter ? `${letter}.` : ""}</span>
                {/* Below `sm` the tag sits under the choice text, so the text keeps the width. */}
                <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                  <span className="min-w-0 flex-1">
                    <MathRenderer content={opt.text} />
                  </span>
                  {tag ? (
                    <span className="shrink-0 text-lyc-meta-lg font-semibold">
                      {tag}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {showResult ? (
        <section
          aria-live="polite"
          data-testid="runner-feedback"
          className={cn(
            "flex flex-col gap-2 rounded-md border-l-4 px-5 py-4",
            isCorrect
              ? "border-lyc-lv4-fill bg-lyc-lv4-bg text-lyc-lv4-ink"
              : "border-lyc-danger bg-lyc-danger-bg text-lyc-danger",
          )}
        >
          {/* The app-wide base rule colours every h2; the panel's tone is set on the heading. */}
          <h2
            className={cn(
              "m-0 text-[19px] font-semibold",
              isCorrect ? "text-lyc-lv4-ink" : "text-lyc-danger",
            )}
          >
            {isCorrect ? "Correct" : "Not quite"}
          </h2>
          {isGrid ? (
            <div className="flex flex-col gap-1 text-lyc-body-lg text-lyc-ink">
              <p className="m-0">
                <span className="font-semibold">Your answer:</span>{" "}
                <MathRenderer content={typed || "(empty)"} />
              </p>
              {!isCorrect && correctAnswer ? (
                <p className="m-0">
                  <span className="font-semibold">Correct answer:</span>{" "}
                  <MathRenderer content={correctAnswer} />
                </p>
              ) : null}
            </div>
          ) : null}
          <div
            data-testid="runner-explanation"
            className="whitespace-pre-wrap text-[18px] leading-[1.6] text-lyc-ink"
          >
            {shownExplanation.length > 0 ? (
              <MathRenderer content={shownExplanation} />
            ) : (
              NO_EXPLANATION
            )}
          </div>
          {!isCorrect && missNote ? (
            <p
              data-testid="runner-miss-note"
              className="m-0 text-lyc-meta-lg text-lyc-muted"
            >
              {MISS_NOTE}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export { QuestionRenderer };
