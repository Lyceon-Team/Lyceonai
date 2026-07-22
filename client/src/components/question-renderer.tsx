import React, { useEffect, useMemo } from "react";
import MathRenderer from "@/components/MathRenderer";
import { Textarea } from "@/components/ui/textarea";
import { NumericEntryInput } from "@/components/practice/NumericEntryInput";

type QuestionOption = {
  id?: string | null;
  key?: string | null;
  text?: string | null;
};

type Question = {
  id?: string;
  question_type?: "multiple_choice" | "free_response" | "grid_in" | null;
  questionType?: "multiple_choice" | "grid_in" | null;
  itemType?: "mcq" | "grid_in" | null;
  inputMode?: "choice" | "numeric_entry" | null;
  stem: string;
  passage?: string | null;
  options?: QuestionOption[] | null;
  correct_answer?: string | null;
  explanation?: string | null;
};

type NormalizedOption = {
  id: string;
  text: string;
  canonicalKey: string | null;
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

function normalizeOptionId(opt: QuestionOption): string {
  if (typeof opt.id === "string" && opt.id.trim().length > 0) {
    return opt.id.trim();
  }
  const key = normalizeChoiceKey(opt.key ?? "");
  return key;
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
  correctOptionId?: string | null;
  correctAnswer?: string | null;
  explanation?: string | null;

  disabled?: boolean;
  onMissingMcChoices?: () => void;
}

export default function QuestionRenderer({
  question,
  selectedAnswer,
  onSelectAnswer,
  freeResponseAnswer,
  onFreeResponseAnswerChange,
  showResult,
  isCorrect,
  correctAnswerKey,
  correctOptionId,
  correctAnswer,
  explanation,
  disabled = false,
  onMissingMcChoices,
}: QuestionRendererProps) {
  const isGrid =
    question.questionType === "grid_in" ||
    question.itemType === "grid_in" ||
    question.inputMode === "numeric_entry";
  const options = useMemo(() => {
    const raw = question.options ?? [];
    return raw
      .map((o) => ({
        id: normalizeOptionId(o),
        text: getOptionText(o),
        canonicalKey: normalizeChoiceKey(o.key ?? "") || null,
      }))
      .filter(
        (o): o is NormalizedOption => o.id.length > 0 && o.text.length > 0,
      );
  }, [question.options]);

  const hasUsableMcChoices = useMemo(() => {
    if (!options.length) return false;
    return options.some((o) => o.text.trim().length > 0);
  }, [options]);

  useEffect(() => {
    if (!hasUsableMcChoices && !isGrid) {
      onMissingMcChoices?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUsableMcChoices, isGrid]);

  const selectedNorm = (selectedAnswer ?? "").trim();
  const normalizedCorrectKey = normalizeChoiceKey(
    correctAnswerKey ?? question.correct_answer ?? "",
  );

  const resolvedCorrectOptionId = useMemo(() => {
    if (
      typeof correctOptionId === "string" &&
      correctOptionId.trim().length > 0
    ) {
      return correctOptionId.trim();
    }

    if (!normalizedCorrectKey) return null;

    const byKey = options.find(
      (opt) => opt.canonicalKey === normalizedCorrectKey,
    );
    return byKey?.id ?? null;
  }, [correctOptionId, normalizedCorrectKey, options]);

  const resolvedCorrectText = useMemo(() => {
    if (!resolvedCorrectOptionId) return null;
    return (
      options.find((opt) => opt.id === resolvedCorrectOptionId)?.text ?? null
    );
  }, [options, resolvedCorrectOptionId]);

  const showCanonicalChoiceLabels = options.every((opt) => !!opt.canonicalKey);

  if (!hasUsableMcChoices) {
    if (isGrid) {
      return (
        <div className="space-y-5">
          {question.passage ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-base text-slate-800 whitespace-pre-wrap">
              <MathRenderer content={question.passage} />
            </div>
          ) : null}
          <div className="text-xl font-semibold text-slate-900">
            <MathRenderer content={question.stem} />
          </div>
          <NumericEntryInput
            value={freeResponseAnswer ?? ""}
            onChange={(val) => onFreeResponseAnswerChange?.(val)}
            disabled={disabled}
            showResult={showResult}
            isCorrect={isCorrect}
            correctAnswer={correctAnswer ?? null}
            explanation={explanation ?? question.explanation ?? null}
          />
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-5">
      {question.passage ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-base text-slate-800 whitespace-pre-wrap">
          <MathRenderer content={question.passage} />
        </div>
      ) : null}
      <div className="text-xl font-semibold text-slate-900">
        <MathRenderer content={question.stem} />
      </div>

      <div className="space-y-3">
        {options.map((opt) => {
          const isSelected = selectedNorm.length > 0 && opt.id === selectedNorm;
          const isCorrectChoice =
            !!resolvedCorrectOptionId && opt.id === resolvedCorrectOptionId;

          const showCorrect = showResult && isCorrectChoice;
          const showWrong = showResult && isSelected && !isCorrectChoice;

          const base =
            "w-full flex items-center gap-4 rounded-xl border px-4 py-4 text-left transition";
          const border = showCorrect
            ? "border-emerald-500 bg-emerald-50"
            : showWrong
              ? "border-rose-500 bg-rose-50"
              : isSelected
                ? "border-brand-navy bg-brand-navy/5 ring-1 ring-brand-navy shadow-sm"
                : "border-slate-200 bg-white hover:bg-slate-50";

          return (
            <button
              key={opt.id}
              type="button"
              className={`${base} ${border}`}
              disabled={disabled || showResult}
              onClick={() => onSelectAnswer(opt.id)}
            >
              {showCanonicalChoiceLabels ? (
                <div
                  className={`
                  flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-semibold transition
                  ${
                    isSelected && !showResult
                      ? "bg-brand-navy text-white"
                      : "bg-slate-100 text-slate-700"
                  }
                `}
                >
                  {opt.canonicalKey}
                </div>
              ) : null}

              <div className="text-base text-slate-900">
                <MathRenderer content={opt.text} />
              </div>
            </button>
          );
        })}
      </div>

      {showResult ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="font-semibold text-slate-900">
            {isCorrect ? "Correct" : "Incorrect"}
          </div>

          {resolvedCorrectText ? (
            <div className="mt-2 text-slate-800">
              <span className="font-medium">Correct answer:</span>{" "}
              <MathRenderer content={resolvedCorrectText} />
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
              <div className="whitespace-pre-wrap">
                {explanation ?? question.explanation}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { QuestionRenderer };
