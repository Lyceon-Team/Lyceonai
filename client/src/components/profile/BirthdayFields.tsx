/**
 * The birthday input: a Month dropdown, a Day box and a four-digit Year box.
 *
 * @spec [owner brief "birthday input" (Karl, 2026-11-04): three labeled fields, nothing
 *       pre-filled, placeholders only, `inputmode="numeric"` on Day and Year,
 *       `autocomplete="bday-month|bday-day|bday-year"`, a plain-language confirmation line,
 *       inline validation; docs/plans/student-ui/design/DESIGN.md §5 (4+ options → dropdown);
 *       live bug 2026-11-04] | @implemented [2026-11-04]
 *
 * plain English: this replaces `<input type="date">` on the shared profile step. That input is a
 * browser widget, and on iOS Safari it is a wheel that opens on TODAY — a person who span the
 * month and day but never touched the year wheel submitted the current year, and four profiles
 * stored one. Karl reproduced it on an iPhone 17 Pro. Three separate fields have no such hidden
 * state: every digit saved is a digit someone typed, and the confirmation line reads it back in
 * words before they submit.
 *
 * Nothing is pre-filled. All three fields start empty and all three are required; the Year box's
 * placeholder is a plausible year (today − 13) as a HINT ONLY — a placeholder is not a value and
 * is never submitted, which is the whole point after a default that was (the old field defaulted
 * to today − 13 years until #1233).
 *
 * Validation is `resolveBirthday` from `@lyceon/shared/birthday` — the SAME function the server
 * runs on the submitted date. One judge, so the browser and the server cannot disagree about what
 * a valid birthday is; that disagreement is what let age 0 through before.
 *
 * trade-offs:
 *  - Month is a NATIVE `<select>` styled with `LYC_INPUT`, the pattern `TargetScorePicker` and
 *    `FullLengthFields` already use — not the Radix `Select`. Radix renders a button and portals
 *    its listbox, so `autocomplete="bday-month"` would be inert on it; the brief asks for that
 *    token to work, and only a real `<select>` carries it. Still a dropdown, so §5 holds.
 *  - Day and Year are text inputs with `inputMode="numeric"`, not `type="number"`: a number input
 *    brings its own spinner and scroll-to-change behaviour on touch, which is the class of hidden
 *    widget state this change exists to remove.
 *  - Errors show after a field is touched or after a submit is attempted, never while someone is
 *    part-way through typing a year.
 *
 * edge cases: a submit with nothing touched shows all three required errors and submits nothing
 * (the iOS "I touched the wheel and it looked filled" case); February 29 is accepted only in a
 * leap year; a 2-digit year is refused rather than widened to a century.
 */
import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { LYC_INPUT } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BIRTH_MONTHS,
  birthYearPlaceholder,
  type BirthdayParts,
  errorFor,
  formatBirthdayConfirmation,
  resolveBirthday,
} from "@lyceon/shared/birthday";

export type BirthdayFieldsProps = {
  readonly value: BirthdayParts;
  readonly onChange: (next: BirthdayParts) => void;
  /** True once the person has tried to submit, so every error shows even on untouched fields. */
  readonly showAllErrors: boolean;
  /** Injected in tests; `new Date()` in the app. Keeps the rules deterministic. */
  readonly today?: Date;
  readonly disabled?: boolean;
};

/** Digits only, capped, so a paste cannot carry letters or a separator into the field. */
function digitsOnly(raw: string, maxLength: number): string {
  return raw.replace(/\D/g, "").slice(0, maxLength);
}

const ERROR_TEXT = "m-0 text-lyc-meta-lg text-lyc-danger";

export function BirthdayFields({
  value,
  onChange,
  showAllErrors,
  today,
  disabled = false,
}: BirthdayFieldsProps): JSX.Element {
  const baseId = useId();
  const monthId = `${baseId}-month`;
  const dayId = `${baseId}-day`;
  const yearId = `${baseId}-year`;

  const [touched, setTouched] = useState<{
    month: boolean;
    day: boolean;
    year: boolean;
  }>({ month: false, day: false, year: false });

  // One clock read per render, passed down, so every rule below is deterministic.
  const now = useMemo(() => today ?? new Date(), [today]);
  const resolution = useMemo(() => resolveBirthday(value, now), [value, now]);

  const errors = resolution.ok ? [] : resolution.errors;
  const show = (field: "month" | "day" | "year"): string | null => {
    if (!showAllErrors && !touched[field]) return null;
    return errorFor(errors, field);
  };
  const monthError = show("month");
  const dayError = show("day");
  const yearError = show("year");
  const anyTouched = touched.month || touched.day || touched.year;
  const formError =
    showAllErrors || anyTouched ? errorFor(errors, "form") : null;

  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-[17px] font-semibold text-lyc-ink">
        Date Of Birth
      </legend>

      {/*
       * One row on desktop; on a phone Month takes its own row and Day and Year share the next,
       * because three full-width boxes read as three separate questions and "September" clips in
       * a third of 327px. The breakpoint is the viewport, not the card, which is fine here: this
       * component only ever renders inside the 480px onboarding card.
       */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-[8rem] basis-full flex-col gap-1 sm:flex-1 sm:basis-auto">
          <Label variant="lyc" htmlFor={monthId} className="text-lyc-meta-lg">
            Month
          </Label>
          <select
            id={monthId}
            className={LYC_INPUT}
            data-testid="select-birth-month"
            autoComplete="bday-month"
            disabled={disabled}
            aria-invalid={monthError !== null}
            aria-describedby={monthError ? `${monthId}-error` : undefined}
            value={value.month}
            onBlur={() => setTouched((t) => ({ ...t, month: true }))}
            onChange={(event) => {
              setTouched((t) => ({ ...t, month: true }));
              onChange({ ...value, month: event.target.value });
            }}
          >
            {/* Empty and not selectable once away from it: a placeholder, never a value. */}
            <option value="" disabled>
              Month
            </option>
            {BIRTH_MONTHS.map((m) => (
              <option key={m.value} value={String(m.value)}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-[4.5rem] flex-1 flex-col gap-1 sm:max-w-[6rem] sm:flex-none">
          <Label variant="lyc" htmlFor={dayId} className="text-lyc-meta-lg">
            Day
          </Label>
          <Input
            id={dayId}
            variant="lyc"
            data-testid="input-birth-day"
            type="text"
            inputMode="numeric"
            autoComplete="bday-day"
            placeholder="Day"
            maxLength={2}
            disabled={disabled}
            aria-invalid={dayError !== null}
            aria-describedby={dayError ? `${dayId}-error` : undefined}
            value={value.day}
            onBlur={() => setTouched((t) => ({ ...t, day: true }))}
            onChange={(event) =>
              onChange({ ...value, day: digitsOnly(event.target.value, 2) })
            }
          />
        </div>

        <div className="flex min-w-[6rem] flex-1 flex-col gap-1 sm:max-w-[7.5rem] sm:flex-none">
          <Label variant="lyc" htmlFor={yearId} className="text-lyc-meta-lg">
            Year
          </Label>
          <Input
            id={yearId}
            variant="lyc"
            data-testid="input-birth-year"
            type="text"
            inputMode="numeric"
            autoComplete="bday-year"
            // A HINT, not a value: today − 13. Never submitted.
            placeholder={birthYearPlaceholder(now)}
            maxLength={4}
            disabled={disabled}
            aria-invalid={yearError !== null}
            aria-describedby={yearError ? `${yearId}-error` : undefined}
            value={value.year}
            onBlur={() => setTouched((t) => ({ ...t, year: true }))}
            onChange={(event) =>
              onChange({ ...value, year: digitsOnly(event.target.value, 4) })
            }
          />
        </div>
      </div>

      {/*
       * The messages sit in ONE full-width block under the row, in field order, rather than
       * under each box. A composite date input's sub-fields are far too narrow to hold a
       * sentence — under a 72px Day column "Enter your birth day." wraps to three ragged lines
       * and leaves the three columns different heights. Each message keeps the id its field's
       * `aria-describedby` points at, so a screen reader still reads the right message for the
       * right field; only the placement moved.
       */}
      {(monthError ?? dayError ?? yearError ?? formError) !== null && (
        <div className="flex flex-col gap-1">
          {monthError && (
            <p
              id={`${monthId}-error`}
              className={ERROR_TEXT}
              data-testid="error-birth-month"
            >
              {monthError}
            </p>
          )}
          {dayError && (
            <p
              id={`${dayId}-error`}
              className={ERROR_TEXT}
              data-testid="error-birth-day"
            >
              {dayError}
            </p>
          )}
          {yearError && (
            <p
              id={`${yearId}-error`}
              className={ERROR_TEXT}
              data-testid="error-birth-year"
            >
              {yearError}
            </p>
          )}
          {formError && (
            <p className={ERROR_TEXT} data-testid="error-birth-form">
              {formError}
            </p>
          )}
        </div>
      )}

      {/* Read back in words, so a wrong year is visible before it is submitted. */}
      {resolution.ok && (
        <p
          className="m-0 text-lyc-meta-lg text-lyc-muted"
          data-testid="text-birthday-confirmation"
        >
          {formatBirthdayConfirmation(
            resolution.month,
            resolution.day,
            resolution.year,
          )}
        </p>
      )}
    </fieldset>
  );
}
