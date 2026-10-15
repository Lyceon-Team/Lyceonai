/**
 * "What score are you aiming for?" — the target score, with "Not sure yet" first.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §1; rulings 2026-10-13: 2 "the full 400–1600 list, with
 *       'Not sure yet' first", 1 "Settings → Profile shows the target score field, with 'Not sure
 *       yet', to every student"; Karl, 2026-10-13 on #1230, item 4: "record it only when the
 *       student explicitly selects it, not on a save where the field was untouched"]
 * | @implemented [2026-10-13]
 *
 * plain English: a native select (it opens the platform's own list on a phone) offering "Not
 * sure yet", then 1600 down to 400 in steps of 10 — exactly what the study-profile write accepts
 * (`TARGET_SCORE_BOUNDS`, the same numbers the database CHECK uses). The value says which of
 * three things is true, so an untouched field is never mistaken for an answer:
 *   - `unset`: nothing chosen yet. The closed select reads "Choose a score" (a hidden, disabled
 *     placeholder, so the open list still starts with "Not sure yet");
 *   - `not_sure`: the student chose "Not sure yet";
 *   - `score`: the student chose a number (or one is saved).
 * The caller saves a score through the one study-profile write and records "Not sure yet" for the
 * Getting started checklist only for `not_sure`.
 */
import { useId } from "react";
import { TARGET_SCORE_BOUNDS } from "@lyceon/shared/calendar/profile";
import { LYC_INPUT } from "@/components/ui/input";

export const TARGET_SCORE_NOT_SURE = "Not sure yet";

const PLACEHOLDER = "Choose a score";
const NOT_SURE_VALUE = "not_sure";

export type TargetScoreChoice =
  | { kind: "unset" }
  | { kind: "not_sure" }
  | { kind: "score"; score: number };

/** The choice a stored score starts from: the score, or nothing chosen yet. */
export function targetScoreChoiceFrom(saved: number | null): TargetScoreChoice {
  return saved === null ? { kind: "unset" } : { kind: "score", score: saved };
}

/** The number to save, or null (no score) for "Not sure yet" and for nothing chosen. */
export function targetScoreOf(choice: TargetScoreChoice): number | null {
  return choice.kind === "score" ? choice.score : null;
}

/** 1600, 1590, … 400: highest first, the order students scan for. */
export const TARGET_SCORE_OPTIONS: readonly number[] = Array.from(
  {
    length:
      (TARGET_SCORE_BOUNDS.max - TARGET_SCORE_BOUNDS.min) /
        TARGET_SCORE_BOUNDS.step +
      1,
  },
  (_unused, i) => TARGET_SCORE_BOUNDS.max - i * TARGET_SCORE_BOUNDS.step,
);

function selectValue(choice: TargetScoreChoice): string {
  if (choice.kind === "unset") return "";
  if (choice.kind === "not_sure") return NOT_SURE_VALUE;
  return String(choice.score);
}

export function TargetScorePicker({
  value,
  onChange,
  legend = "What score are you aiming for?",
  help,
  "data-testid": testId = "target-score-picker",
}: {
  value: TargetScoreChoice;
  onChange: (next: TargetScoreChoice) => void;
  legend?: string;
  help?: string;
  "data-testid"?: string;
}): JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <label htmlFor={id} className="text-[17px] font-semibold text-lyc-ink">
        {legend}
      </label>
      <select
        id={id}
        value={selectValue(value)}
        onChange={(event) =>
          onChange(
            event.target.value === NOT_SURE_VALUE
              ? { kind: "not_sure" }
              : { kind: "score", score: Number(event.target.value) },
          )
        }
        className={`${LYC_INPUT} max-w-[420px]`}
        data-testid={`${testId}-select`}
      >
        <option value="" disabled hidden>
          {PLACEHOLDER}
        </option>
        <option value={NOT_SURE_VALUE}>{TARGET_SCORE_NOT_SURE}</option>
        {TARGET_SCORE_OPTIONS.map((score) => (
          <option key={score} value={String(score)}>
            {score}
          </option>
        ))}
      </select>
      {help ? (
        <p className="m-0 text-lyc-meta-lg text-lyc-muted">{help}</p>
      ) : null}
    </div>
  );
}
