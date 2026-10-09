/**
 * "When's your SAT?" — the one SAT-date picker, used by onboarding, Settings and the Home card.
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09) Part A2 and "Onboarding
 *       order": '"Not sure yet" at top, then future official dates, multi-select'; SCL-223;
 *       DESIGN.md §1 (student tokens, 14px floor)] | @implemented [2026-10-09]
 *
 * plain English: a group of checkboxes. "Not sure yet" sits first; under it, every official SAT
 * date after today (shared/sat-test-dates.ts), plus any future date the student already saved
 * that is not on the list, so a save never drops it. Ticking "Not sure yet" clears the dates;
 * ticking a date clears "Not sure yet". The value is controlled by the caller; this component
 * saves nothing.
 */
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  chicagoToday,
  formatSatTestDate,
  satDateOptions,
} from "@shared/sat-test-dates";

export type SatDateChoice = { notSure: boolean; dates: string[] };

export function SatDatePicker({
  value,
  onChange,
  legend = "When's your SAT?",
  today = chicagoToday(),
  "data-testid": testId = "sat-date-picker",
}: {
  value: SatDateChoice;
  onChange: (next: SatDateChoice) => void;
  legend?: string;
  today?: string;
  "data-testid"?: string;
}): JSX.Element {
  const idBase = useId();
  const options = satDateOptions(today, value.dates);

  function toggleDate(date: string, checked: boolean): void {
    const dates = checked
      ? [...value.dates.filter((d) => d !== date), date].sort()
      : value.dates.filter((d) => d !== date);
    onChange({ notSure: false, dates });
  }

  return (
    <fieldset
      className="m-0 flex flex-col gap-3 border-0 p-0"
      data-testid={testId}
    >
      <legend className="mb-2 p-0 text-[17px] font-semibold text-lyc-ink">
        {legend}
      </legend>
      <div className="flex items-center gap-3">
        <Checkbox
          id={`${idBase}-unsure`}
          variant="lyc"
          checked={value.notSure}
          onCheckedChange={(checked) =>
            onChange({ notSure: Boolean(checked), dates: [] })
          }
          data-testid={`${testId}-not-sure`}
        />
        <Label
          htmlFor={`${idBase}-unsure`}
          className="text-lyc-body font-normal text-lyc-ink"
        >
          Not sure yet
        </Label>
      </div>
      {options.map((o) => {
        const id = `${idBase}-${o.date}`;
        return (
          <div key={o.date} className="flex items-center gap-3">
            <Checkbox
              id={id}
              variant="lyc"
              checked={value.dates.includes(o.date)}
              onCheckedChange={(checked) =>
                toggleDate(o.date, Boolean(checked))
              }
              data-testid={`${testId}-date-${o.date}`}
            />
            <Label
              htmlFor={id}
              className="text-lyc-body font-normal text-lyc-ink"
            >
              {formatSatTestDate(o.date)}
            </Label>
          </div>
        );
      })}
    </fieldset>
  );
}
