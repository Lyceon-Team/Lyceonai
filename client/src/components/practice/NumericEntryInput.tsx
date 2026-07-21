import React, { useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import MathRenderer from "@/components/MathRenderer";

export type NumericEntryInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  showResult?: boolean;
  isCorrect?: boolean | null;
  correctAnswer?: string | null;
  explanation?: string | null;
};

const ALLOWED_CHARS = /^[0-9./\-]*$/;
const GRID_IN_PATTERN = /^-?(\d+(\.\d*)?|\d*\.\d+|\d+\/\d+)$/;

export function isValidGridInFormat(value: string): boolean {
  return GRID_IN_PATTERN.test(value.trim());
}

export function NumericEntryInput({
  value,
  onChange,
  disabled = false,
  showResult = false,
  isCorrect,
  correctAnswer,
  explanation,
}: NumericEntryInputProps): React.ReactElement {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      if (next === "" || ALLOWED_CHARS.test(next)) {
        onChange(next);
      }
    },
    [onChange],
  );

  const trimmed = value.trim();
  const showFormatHint = trimmed.length > 0 && !isValidGridInFormat(trimmed);

  const inputBorder = useMemo(() => {
    if (!showResult) return "";
    return isCorrect
      ? "border-emerald-500 bg-emerald-50"
      : "border-rose-500 bg-rose-50";
  }, [showResult, isCorrect]);

  return (
    <div className="space-y-3">
      <label
        htmlFor="grid-in-answer"
        className="text-sm font-medium text-slate-700"
      >
        Enter your answer:
      </label>
      <Input
        id="grid-in-answer"
        aria-label="Enter your answer"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="e.g. 0.2, 1/5, -4"
        value={value}
        onChange={handleChange}
        disabled={disabled || showResult}
        className={inputBorder}
      />
      {showFormatHint && !showResult && (
        <p className="text-xs text-amber-600">
          Enter a number, decimal, or fraction (e.g. 42, 0.2, 1/5, -4).
        </p>
      )}

      {showResult && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="font-semibold text-slate-900">
            {isCorrect ? "Correct" : "Incorrect"}
          </div>

          <div className="mt-2 text-slate-800">
            <span className="font-medium">Your answer:</span>{" "}
            <MathRenderer content={trimmed || "(empty)"} />
          </div>

          {!isCorrect && correctAnswer && (
            <div className="mt-2 text-slate-800">
              <span className="font-medium">Correct answer:</span>{" "}
              <MathRenderer content={correctAnswer} />
            </div>
          )}

          {explanation && (
            <div className="mt-3 text-slate-700">
              <div className="font-medium text-slate-900 mb-1">Explanation</div>
              <div className="whitespace-pre-wrap leading-relaxed">
                {explanation}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
