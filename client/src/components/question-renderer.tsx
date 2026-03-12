import React, { useEffect, useMemo } from "react";
import MathRenderer from "@/components/MathRenderer";

type QuestionOption = {
  key?: string | null;
  text?: string | null;
};

type Question = {
  id: string;
  question_type: "multiple_choice";
  stem: string;
  section?: string | null;
  options?: QuestionOption[] | null;
  correct_answer?: string | null;
  explanation?: string | null;
};

function normalizeChoiceKey(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim();
  const m = s.match(/[A-D]/i);
  return m ? m[0].toUpperCase() : s.toUpperCase();
}

function getOptionText(opt: QuestionOption): string {
  const t = (opt.text ?? "").toString();
  return t.trim();
}

export interface QuestionRendererProps {
  question: Question;

  selectedAnswer: string | null;
  onSelectAnswer: (key: string) => void;

  // Kept for call-site compatibility; unused in canonical MC flow.
  freeResponseAnswer?: string;
  onFreeResponseAnswerChange?: (val: string) => void;

  showResult: boolean;
  isCorrect?: boolean | null;
  correctAnswerKey?: string | null;
  explanation?: string | null;

  disabled?: boolean;
  onMissingMcChoices?: () => void;
}

export default function QuestionRenderer({
  question,
  selectedAnswer,
  onSelectAnswer,
  showResult,
  isCorrect,
  correctAnswerKey,
  explanation,
  disabled = false,
  onMissingMcChoices,
}: QuestionRendererProps) {
  const normalizedCorrect = useMemo(
    () => normalizeChoiceKey(correctAnswerKey ?? question.correct_answer ?? ""),
    [correctAnswerKey, question.correct_answer]
  );

  const options = useMemo(() => {
    const raw = question.options ?? [];
    return raw
      .map((o) => ({
        key: normalizeChoiceKey(o.key ?? ""),
        text: getOptionText(o),
      }))
      .filter((o) => o.key.length > 0);
  }, [question.options]);

  const hasUsableMcChoices = useMemo(() => {
    if (!options.length) return false;
    return options.some((o) => (o.text ?? "").trim().length > 0);
  }, [options]);

  useEffect(() => {
    if (!hasUsableMcChoices) {
      onMissingMcChoices?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUsableMcChoices]);

  if (!hasUsableMcChoices) {
    return null;
  }

  const selectedNorm = normalizeChoiceKey(selectedAnswer ?? "");

  return (
    <div className="space-y-5">
      <div className="text-xl font-semibold text-slate-900">
        <MathRenderer content={question.stem} />
      </div>

      <div className="space-y-3">
        {options.map((opt) => {
          const isSelected = selectedNorm && opt.key === selectedNorm;
          const isCorrectChoice = normalizedCorrect && opt.key === normalizedCorrect;

          const showCorrect = showResult && isCorrectChoice;
          const showWrong = showResult && isSelected && !isCorrectChoice;

          const base =
            "w-full flex items-center gap-4 rounded-xl border px-4 py-4 text-left transition";
          const border =
            showCorrect
              ? "border-emerald-500 bg-emerald-50"
              : showWrong
                ? "border-rose-500 bg-rose-50"
                : "border-slate-200 bg-white hover:bg-slate-50";

          return (
            <button
              key={opt.key}
              type="button"
              className={`${base} ${border}`}
              disabled={disabled || showResult}
              onClick={() => onSelectAnswer(opt.key)}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 font-semibold">
                {opt.key}
              </div>

              <div className="text-base text-slate-900">
                <MathRenderer content={opt.text || ""} />
              </div>
            </button>
          );
        })}
      </div>

      {showResult ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="font-semibold text-slate-900">{isCorrect ? "Correct" : "Incorrect"}</div>

          {normalizedCorrect ? (
            <div className="mt-2 text-slate-800">
              <span className="font-medium">Correct answer:</span> {normalizedCorrect}
            </div>
          ) : null}

          {!isCorrect ? (
            <div className="mt-3 text-slate-700">
              <div className="font-medium text-slate-900 mb-1">Explanation</div>
              <div className="whitespace-pre-wrap">
                {(explanation ?? question.explanation ?? "").trim().length > 0
                  ? (explanation ?? question.explanation)
                  : "Explanation is not available for this question yet."}
              </div>
            </div>
          ) : (explanation ?? question.explanation) ? (
            <div className="mt-3 text-slate-700">
              <div className="font-medium text-slate-900 mb-1">Explanation</div>
              <div className="whitespace-pre-wrap">{explanation ?? question.explanation}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { QuestionRenderer };