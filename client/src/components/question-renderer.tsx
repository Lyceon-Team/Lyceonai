import React, { useEffect, useMemo } from "react";
import MathRenderer from "@/components/MathRenderer";

type QuestionOption = {
  key?: string | null;
  text?: string | null;
  value?: string | null;
};

type Question = {
  id: string;
  type: "mc" | "fr";
  stem: string;
  section?: string | null;
  options?: QuestionOption[] | null;
  answerKey?: string | null;
  explanation?: string | null;
};

function normalizeChoiceKey(raw: string | null | undefined): string {
  if (!raw) return "";
  // Normalize "(A)" / "A." / "a" -> "A"
  const s = String(raw).trim();
  const m = s.match(/[A-D]/i);
  return m ? m[0].toUpperCase() : s.toUpperCase();
}

function getOptionText(opt: QuestionOption): string {
  const t = (opt.text ?? opt.value ?? "").toString();
  return t.trim();
}

export interface QuestionRendererProps {
  question: Question;

  // controlled inputs
  selectedAnswer: string | null;
  onSelectAnswer: (key: string) => void;

  freeResponseAnswer: string;
  onFreeResponseAnswerChange: (val: string) => void;

  // result (optional)
  showResult: boolean;
  isCorrect?: boolean | null;
  correctAnswerKey?: string | null;
  explanation?: string | null;

  // UI control
  disabled?: boolean;

  /**
   * If this question is MC but has no usable choices, we should NOT show it.
   * We call this once so the parent can auto-skip deterministically.
   */
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
  explanation,
  disabled = false,
  onMissingMcChoices,
}: QuestionRendererProps) {
  const type = question.type;

  const normalizedCorrect = useMemo(
    () => normalizeChoiceKey(correctAnswerKey ?? question.answerKey ?? ""),
    [correctAnswerKey, question.answerKey]
  );

  const options = useMemo(() => {
    const raw = question.options ?? [];
    // Keep only options with a recognizable A-D key (or any non-empty key) and any text/value (or allow blank text if you truly have letter-only banks).
    return raw
      .map((o) => ({
        key: normalizeChoiceKey(o.key ?? ""),
        text: getOptionText(o),
      }))
      .filter((o) => o.key.length > 0);
  }, [question.options]);

  const hasUsableMcChoices = useMemo(() => {
    if (type !== "mc") return true;
    if (!options.length) return false;

    // If all option texts are empty, treat as unusable for students.
    // (This matches your requirement: missing choices => do not show.)
    const anyText = options.some((o) => (o.text ?? "").trim().length > 0);
    return anyText;
  }, [type, options]);

  // Deterministic: never show broken MC questions; parent should auto-skip.
  useEffect(() => {
    if (type === "mc" && !hasUsableMcChoices) {
      onMissingMcChoices?.();
    }
    // only trigger when detection flips
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, hasUsableMcChoices]);

  if (type === "mc" && !hasUsableMcChoices) {
    // Intentionally render nothing; parent will advance.
    return null;
  }

  const selectedNorm = normalizeChoiceKey(selectedAnswer ?? "");

  return (
    <div className="space-y-5">
      {/* Stem */}
      <div className="text-xl font-semibold text-slate-900">
        <MathRenderer content={question.stem} />
      </div>

      {/* Multiple choice */}
      {type === "mc" ? (
        <div className="space-y-3">
          {options.map((opt) => {
            const isSelected = selectedNorm && opt.key === selectedNorm;
            const isCorrectChoice = normalizedCorrect && opt.key === normalizedCorrect;

            // Post-submit highlighting
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
      ) : (
        /* Free response */
        <div className="space-y-3">
          <textarea
            value={freeResponseAnswer}
            onChange={(e) => onFreeResponseAnswerChange(e.target.value)}
            disabled={disabled || showResult}
            className="w-full rounded-xl border border-slate-200 p-3 text-slate-900"
            rows={4}
            placeholder="Type your answer..."
          />
        </div>
      )}

      {/* Result block */}
      {showResult ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="font-semibold text-slate-900">
            {isCorrect ? "Correct" : "Incorrect"}
          </div>

          {/* Always show correct key for MC after submit */}
          {type === "mc" && normalizedCorrect ? (
            <div className="mt-2 text-slate-800">
              <span className="font-medium">Correct answer:</span> {normalizedCorrect}
            </div>
          ) : null}

          {/* Explanation: always show when wrong; can show even when correct if provided */}
          {!isCorrect ? (
            <div className="mt-3 text-slate-700">
              <div className="font-medium text-slate-900 mb-1">Explanation</div>
              <div className="whitespace-pre-wrap">
                {(explanation ?? "").trim().length > 0
                  ? explanation
                  : "Explanation is not available for this question yet."}
              </div>
            </div>
          ) : (explanation) ? (
            <div className="mt-3 text-slate-700">
              <div className="font-medium text-slate-900 mb-1">Explanation</div>
              <div className="whitespace-pre-wrap">{explanation}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { QuestionRenderer };
