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
 * menu. Choosing "Not sure yet" clears the dates; choosing a date clears "Not sure yet". The
 * value cannot tell an untouched picker from an explicit "Not sure yet" (both are no dates), so
 * `onNotSureChosen` reports each explicit choice: Karl, 2026-10-13 on #1230, "record it only when
 * the student explicitly selects it, not on a save where the field was untouched". Choosing
 * keeps the menu open so several dates can be picked in one visit. Controlled; saves nothing.
 *
 * @spec [owner rulings 2026-10-11 (Karl, on #1204): 1 "Keep the 14-date picker without
 *       type-to-filter" (DESIGN.md §5: ordered lists → scrollable dropdown without filter);
 *       2 "the calendar profile read returns the furthest accepted test date, and every SAT-date
 *       picker … uses that one bound"] | @implemented [2026-10-11]
 *
 * @spec [owner ruling 2026-10-12 (Karl, on #1211): "Serve the test-date bound from a
 *       role-agnostic read: any signed-in account (including one whose role isn't saved yet)
 *       can read latest_test_date"; the error row is not accepted for a guardian-intent account
 *       that switches to Student] | @implemented [2026-10-12]
 * plain English: the picker reads that bound itself (`latest_test_date` from
 * `GET /api/sat-dates/bound`, through the shared `useSatDateBound` query), so no surface can
 * pass a different one or forget it. The read is role-agnostic, so every signed-in account gets
 * the dates, including a guardian-intent account switching to Student at onboarding. Fail
 * closed: until the bound has loaded, and if it cannot load (a network or server fault), no
 * date is offered: the menu says so ("Loading test dates…", or "We couldn't load the test
 * dates" with Try again). "Not sure yet" is always available, so an answer is never blocked.
 * The bound is requested when the menu first opens, so merely rendering the picker sends
 * nothing.
 *
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P1: "SAT date picker: keep
 *       multi-select; add 'Pick every date you might take' and a Done button that's always
 *       visible"] | @implemented [2026-10-13]
 * plain English: under the question, the helper line "Pick every date you might take" says the
 * picker takes several dates (it describes the trigger, so a screen reader hears it too). Done is
 * always on screen while the menu is open: the menu itself no longer scrolls (it is a column the
 * height Radix says is available), only the date list does, between the pinned "Not sure yet" and
 * Done. Before, on a short screen (a phone in landscape) the whole menu scrolled and Done went
 * under the fold with the last dates.
 */
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSatDateBound } from "@/features/calendar/api/queries";
import { cn } from "@/lib/utils";
import {
  chicagoToday,
  formatSatTestDate,
  satDateOptions,
} from "@shared/sat-test-dates";

/** The helper line under the question (first-run activation brief, 2026-10-13). */
export const SAT_DATE_HELPER = "Pick every date you might take";

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
  onNotSureChosen,
  legend = "When's your SAT?",
  today = chicagoToday(),
  "data-testid": testId = "sat-date-picker",
}: {
  value: SatDateChoice;
  onChange: (next: SatDateChoice) => void;
  /** Called on every explicit "Not sure yet" choice, even when no date was chosen before. */
  onNotSureChosen?: () => void;
  legend?: string;
  today?: string;
  "data-testid"?: string;
}): JSX.Element {
  const labelId = useId();
  // The one bound (owner rulings 2026-10-11 and 2026-10-12): served role-agnostically by
  // GET /api/sat-dates/bound, never passed in. Requested when the menu first opens, not on
  // mount: onboarding renders this picker under its default (student) answers before a guardian
  // has chosen their role, and a guardian who never opens it should cause no request at all
  // (G-NEW-03). Every picker shares one cached answer.
  const [opened, setOpened] = useState(false);
  const bound = useSatDateBound({ enabled: opened });
  const latest = bound.data?.latest_test_date;
  const options =
    latest === undefined
      ? []
      : satDateOptions(today, value.dates).filter((o) => o.date <= latest);
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
      <span
        id={`${labelId}-help`}
        className="text-lyc-meta-lg text-lyc-muted"
        data-testid={`${testId}-help`}
      >
        {SAT_DATE_HELPER}
      </span>
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (open) setOpened(true);
        }}
      >
        <DropdownMenuTrigger
          // Named by the question AND the current answer: "When's your SAT? Sat, Dec 5, 2026".
          aria-labelledby={`${labelId} ${labelId}-value`}
          aria-describedby={`${labelId}-help`}
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
          // P1 (2026-10-13): the menu is a column that never scrolls itself; the list inside does.
          className="lyc flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-y-hidden rounded-lg border-lyc-rule-strong bg-lyc-sheet p-1.5 text-lyc-ink shadow-none"
          data-testid={`${testId}-menu`}
        >
          {/* Pinned: outside the scrolling list, so it is always the first choice in view. */}
          <DropdownMenuCheckboxItem
            variant="lyc-box"
            checked={notSure}
            onCheckedChange={(checked) => {
              if (checked) onChange({ dates: [] });
            }}
            // Keep the menu open: choosing is not leaving. `onSelect` fires on every choice,
            // including one that leaves the item checked, so it is where "explicit" is read.
            onSelect={(event) => {
              event.preventDefault();
              onNotSureChosen?.();
            }}
            className={ITEM}
            data-testid={`${testId}-not-sure`}
          >
            Not sure yet
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator className="bg-lyc-rule" />
          <div
            className="max-h-[min(280px,45vh)] min-h-0 flex-1 overflow-y-auto"
            data-testid={`${testId}-dates`}
          >
            {latest === undefined ? (
              bound.isError ? (
                <div
                  className="flex items-center justify-between gap-3 px-3 py-2.5 text-lyc-body text-lyc-ink"
                  role="status"
                  data-testid={`${testId}-dates-error`}
                >
                  We couldn't load the test dates.
                  <button
                    type="button"
                    className="font-semibold text-lyc-ink-strong underline underline-offset-2"
                    onClick={() => void bound.refetch()}
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div
                  className="px-3 py-2.5 text-lyc-body text-lyc-ink"
                  role="status"
                  data-testid={`${testId}-dates-loading`}
                >
                  Loading test dates…
                </div>
              )
            ) : null}
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
            className="shrink-0 justify-end rounded-md px-3 py-2.5 text-lyc-body font-semibold text-lyc-ink-strong focus:bg-lyc-hover focus:text-lyc-ink-strong"
            data-testid={`${testId}-done`}
          >
            Done
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
