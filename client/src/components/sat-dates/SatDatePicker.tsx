/**
 * "When's your SAT?" — the one SAT-date picker: onboarding, Settings, the Home card and the
 * calendar (setup, the free plan's goal, the schedule sheet).
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09) Part A2 and "Onboarding
 *       order": '"Not sure yet" at top, then future official dates, multi-select'; SCL-223;
 *       DESIGN.md §1 (student tokens, 14px floor)] | @implemented [2026-10-09]
 *
 * @spec [owner brief "SAT date picker and UI control standards" (Karl, 2026-10-11) §1; DESIGN.md
 *       "UI standards" (4+ options → dropdown; multi-select → dropdown with checkboxes; never a
 *       long option list inline)] | @implemented [2026-10-11]
 * plain English: a dropdown multi-select on the canonical Radix DropdownMenu (checkbox items:
 * arrow keys move, Enter/Space toggle, Esc closes, the trigger and each item carry their ARIA
 * roles and checked state). Closed, the trigger reads "Not sure yet", one date ("Sat, Dec 5,
 * 2026"), or the first date "+ N more". Open: "Not sure yet" pinned at the top, then every
 * official SAT date after today (shared/sat-test-dates.ts) plus any future date the student
 * already saved that is not on the list, so a save never drops it; the dates scroll inside the
 * menu. Choosing "Not sure yet" clears the dates; choosing a date clears "Not sure yet" (an empty
 * choice IS "Not sure yet", the onboarding rule: no answer is the same as not sure). Choosing
 * keeps the menu open so several dates can be picked in one visit. Controlled; saves nothing.
 */
import { useId } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  chicagoToday,
  formatSatTestDate,
  satDateOptions,
} from "@shared/sat-test-dates";

/** The chosen SAT dates, ascending. Empty means "Not sure yet". */
export type SatDateChoice = { dates: string[] };

/** What the closed trigger reads (the brief's three closed states). */
export function satDateSummary(dates: readonly string[]): string {
  const sorted = [...dates].sort();
  const first = sorted[0];
  if (first === undefined) return "Not sure yet";
  const rest = sorted.length - 1;
  return rest === 0
    ? formatSatTestDate(first)
    : `${formatSatTestDate(first)} + ${rest} more`;
}

const ITEM =
  "rounded-md py-2.5 pl-10 pr-3 text-lyc-body leading-snug text-lyc-ink focus:bg-lyc-hover focus:text-lyc-ink-strong";

export function SatDatePicker({
  value,
  onChange,
  legend = "When's your SAT?",
  today = chicagoToday(),
  latest,
  "data-testid": testId = "sat-date-picker",
}: {
  value: SatDateChoice;
  onChange: (next: SatDateChoice) => void;
  legend?: string;
  today?: string;
  /**
   * The last date the server will store (the calendar's served `target_exam_date_max_days`
   * horizon, as a date). Official dates after it are not offered, as the old date input's `max`
   * did not allow them: the profile write refuses them. Omitted where the caller has no horizon.
   */
  latest?: string;
  "data-testid"?: string;
}): JSX.Element {
  const labelId = useId();
  const options = satDateOptions(today, value.dates).filter(
    (o) => latest === undefined || o.date <= latest,
  );
  const notSure = value.dates.length === 0;

  function toggleDate(date: string, checked: boolean): void {
    const dates = checked
      ? [...value.dates.filter((d) => d !== date), date].sort()
      : value.dates.filter((d) => d !== date);
    onChange({ dates });
  }

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <span id={labelId} className="text-[17px] font-semibold text-lyc-ink">
        {legend}
      </span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          // Named by the question AND the current answer: "When's your SAT? Sat, Dec 5, 2026".
          aria-labelledby={`${labelId} ${labelId}-value`}
          className={cn(
            "inline-flex h-11 w-full max-w-[420px] items-center justify-between gap-3 rounded-md border border-lyc-input-bd bg-lyc-sheet px-4 text-left text-lyc-body text-lyc-ink",
            "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-lyc-focus",
          )}
          data-testid={`${testId}-trigger`}
        >
          <span
            id={`${labelId}-value`}
            className="min-w-0 truncate"
            data-testid={`${testId}-summary`}
          >
            {satDateSummary(value.dates)}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="lyc w-[min(420px,calc(100vw-2rem))] rounded-lg border-lyc-rule-strong bg-lyc-sheet p-1.5 text-lyc-ink shadow-none"
          data-testid={`${testId}-menu`}
        >
          {/* Pinned: outside the scrolling list, so it is always the first choice in view. */}
          <DropdownMenuCheckboxItem
            variant="lyc-box"
            checked={notSure}
            onCheckedChange={(checked) => {
              if (checked) onChange({ dates: [] });
            }}
            // Keep the menu open: choosing is not leaving.
            onSelect={(event) => event.preventDefault()}
            className={ITEM}
            data-testid={`${testId}-not-sure`}
          >
            Not sure yet
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator className="bg-lyc-rule" />
          <div
            className="max-h-[min(280px,45vh)] overflow-y-auto"
            data-testid={`${testId}-dates`}
          >
            {options.map((o) => (
              <DropdownMenuCheckboxItem
                variant="lyc-box"
                key={o.date}
                checked={value.dates.includes(o.date)}
                onCheckedChange={(checked) =>
                  toggleDate(o.date, checked === true)
                }
                onSelect={(event) => event.preventDefault()}
                className={ITEM}
                data-testid={`${testId}-date-${o.date}`}
              >
                {formatSatTestDate(o.date)}
              </DropdownMenuCheckboxItem>
            ))}
          </div>
          <DropdownMenuSeparator className="bg-lyc-rule" />
          <DropdownMenuItem
            className="justify-end rounded-md px-3 py-2.5 text-lyc-body font-semibold text-lyc-ink-strong focus:bg-lyc-hover focus:text-lyc-ink-strong"
            data-testid={`${testId}-done`}
          >
            Done
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
