/**
 * "What score are you aiming for?" — the target score, with "Not sure yet" first.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §1; rulings 2026-10-13: 2 "the full 400–1600 list, with
 *       'Not sure yet' first", 1 "Settings → Profile shows the target score field, with 'Not sure
 *       yet', to every student"] | @implemented [2026-10-13]
 *
 * plain English: a native select (it opens the platform's own list on a phone) offering "Not
 * sure yet", then 1600 down to 400 in steps of 10 — exactly what the study-profile write accepts
 * (`TARGET_SCORE_BOUNDS`, the same numbers the database CHECK uses). The value is a number or
 * `null` for "Not sure yet"; the caller saves it through the one study-profile write and, for
 * `null`, records "Not sure yet" for the Getting started checklist.
 */
import { useId } from "react";
import { TARGET_SCORE_BOUNDS } from "@lyceon/shared/calendar/profile";
import { LYC_INPUT } from "@/components/ui/input";

export const TARGET_SCORE_NOT_SURE = "Not sure yet";

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

export function TargetScorePicker({
  value,
  onChange,
  legend = "What score are you aiming for?",
  help,
  "data-testid": testId = "target-score-picker",
}: {
  value: number | null;
  onChange: (next: number | null) => void;
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
        value={value === null ? "" : String(value)}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
        className={`${LYC_INPUT} max-w-[420px]`}
        data-testid={`${testId}-select`}
      >
        <option value="">{TARGET_SCORE_NOT_SURE}</option>
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
