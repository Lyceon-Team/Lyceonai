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

/**
 * UI-53 (2026-10-03): drawn on the student tokens (the practice and review runners follow the
 * device theme; the timed exam module, the other user, is light only, where the tokens are the
 * light set). The runner shows its own feedback panel and passes no `showResult`; the result
 * block below remains for callers that do.
 *
 * The grid-in answer box's id. The shared keyboard hook (hooks/useKeyboardShortcuts) lets
 * Enter through from this one text field — student-UI register §2 Keyboard: "for grid-in,
 * Enter submits the typed answer". | @implemented [2026-10-03]
 */
export const GRID_IN_INPUT_ID = "grid-in-answer";

const ALLOWED_CHARS = /^[0-9./-]*$/;
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
      ? "border-2 border-lyc-lv4-fill bg-lyc-lv4-bg"
      : "border-2 border-lyc-danger bg-lyc-danger-bg";
  }, [showResult, isCorrect]);

  return (
    <div className="space-y-3">
      <label
        htmlFor={GRID_IN_INPUT_ID}
        className="text-lyc-meta-lg font-semibold text-lyc-ink"
      >
        Enter your answer:
      </label>
      <Input
        id={GRID_IN_INPUT_ID}
        aria-label="Enter your answer"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="e.g. 0.2, 1/5, -4"
        value={value}
        onChange={handleChange}
        disabled={disabled || showResult}
        className={`h-12 max-w-xs border-lyc-input-bd bg-lyc-sheet text-[19px] text-lyc-ink placeholder:text-lyc-muted ${inputBorder}`}
      />
      {showFormatHint && !showResult && (
        <p className="text-lyc-meta text-lyc-danger">
          Enter a number, decimal, or fraction (e.g. 42, 0.2, 1/5, -4).
        </p>
      )}

      {showResult && (
        <div className="rounded-md border border-lyc-rule bg-lyc-sheet p-4 text-lyc-ink">
          <div className="font-semibold text-lyc-ink-strong">
            {isCorrect ? "Correct" : "Incorrect"}
          </div>

          <div className="mt-2">
            <span className="font-semibold">Your answer:</span>{" "}
            <MathRenderer content={trimmed || "(empty)"} />
          </div>

          {!isCorrect && correctAnswer && (
            <div className="mt-2">
              <span className="font-semibold">Correct answer:</span>{" "}
              <MathRenderer content={correctAnswer} />
            </div>
          )}

          {explanation && (
            <div className="mt-3">
              <div className="mb-1 font-semibold text-lyc-ink-strong">
                Explanation
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">
                <MathRenderer content={explanation} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
