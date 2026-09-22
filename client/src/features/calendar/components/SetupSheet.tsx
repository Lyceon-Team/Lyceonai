/**
 * @spec [Doc_05F_Study_Calendar, §17.5 pre-setup, §17.3 settings sheet, §8.1 bounds]
 *       [addendum item 26 — pre-setup is a 200 carrying `defaults`]
 * @implemented [2026-09-23]
 *
 * plain English: the sheet a student fills in before they have a calendar. Expected outcome:
 * a saved profile, which is what R-08-04 makes the first plan generate on.
 *
 * EVERY BOUND COMES FROM THE RESPONSE, NOT FROM THIS FILE. The minute presets, the min and
 * max, the furthest exam date and the suggested timezone are all fields of
 * `defaults` on the 200 (addendum item 26). That is the point of serving them: the chips the
 * student is offered and the validation the server will apply are then the same numbers, and
 * a bound changed in `calendar_runtime_config` changes both at once. A preset array typed in
 * here would be a second source of truth, and the first thing to drift.
 *
 * trade-offs: the sheet opens OVER a greyed sample week rather than replacing the page.
 * §17.5 asks for exactly that — a student deciding whether to set up should be able to see
 * what they are setting up.
 *
 * edge cases: a target score is REQUIRED to complete setup —
 * `setup_requires_target_score` makes a completed profile without one impossible in the
 * database, and `studyProfileSchema` refuses to construct one. So the field is required here
 * rather than letting the student submit and receive a 400 they cannot interpret.
 */
import { useState, type FormEvent } from "react";
import type { CalendarSetupDefaults } from "@lyceon/shared/calendar";
import { addDays } from "../lib/dates";

/** Sunday-is-0, the Postgres DOW convention `study_days_mask` and `full_length_weekday` use. */
const DAYS: readonly { dow: number; label: string }[] = [
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
];

/** Mon–Fri: bits 1..5. A sensible opening position, not a stored value. */
const DEFAULT_MASK = 0b0111110;

export type SetupSheetProps = {
  defaults: CalendarSetupDefaults;
  today: string;
  onSubmit: (profile: Record<string, unknown>) => void;
  pending: boolean;
  error: string | null;
};

export function SetupSheet({
  defaults,
  today,
  onSubmit,
  pending,
  error,
}: SetupSheetProps): JSX.Element {
  const [timezone, setTimezone] = useState(defaults.timezone);
  const [mask, setMask] = useState(DEFAULT_MASK);
  const [minutes, setMinutes] = useState(
    // The middle preset, so the opening position is neither the lightest nor the heaviest.
    defaults.daily_minutes_presets[
      Math.floor(defaults.daily_minutes_presets.length / 2)
    ] ??
      defaults.daily_minutes_presets[0] ??
      defaults.daily_minutes_min,
  );
  const [examDate, setExamDate] = useState("");
  const [targetScore, setTargetScore] = useState(1400);
  const [fullLengthDay, setFullLengthDay] = useState<number | null>(6);

  const latestExamDate = addDays(today, defaults.target_exam_date_max_days);

  function submit(event: FormEvent): void {
    event.preventDefault();
    onSubmit({
      timezone,
      study_days_mask: mask,
      daily_minutes: minutes,
      target_score: targetScore,
      full_length_weekday: fullLengthDay,
      planner_mode: "auto",
      ...(examDate === "" ? {} : { target_exam_date: examDate }),
      idempotency_key: crypto.randomUUID(),
    });
  }

  return (
    <>
      <div className="scrim on" aria-hidden="true" />
      <aside
        className="sheet on"
        aria-label="Set up your calendar"
        data-testid="calendar-setup-sheet"
      >
        <header>
          <span className="kind kind-math">Preview</span>
          <h3>Set up your study calendar</h3>
          <div className="when">
            We&apos;ll build your plan as soon as you save this.
          </div>
        </header>

        <form className="body" onSubmit={submit}>
          <div className="field">
            <label htmlFor="setup-timezone">Timezone</label>
            <input
              id="setup-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="setup-exam-date">Test date</label>
            <input
              id="setup-exam-date"
              type="date"
              min={today}
              max={latestExamDate}
              value={examDate}
              onChange={(event) => setExamDate(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="setup-target-score">Target score</label>
            <input
              id="setup-target-score"
              type="number"
              min={400}
              max={1600}
              step={10}
              value={targetScore}
              onChange={(event) => setTargetScore(Number(event.target.value))}
              required
            />
          </div>

          <div className="field">
            <label>Study days</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DAYS.map((day) => {
                const on = ((mask >> day.dow) & 1) === 1;
                return (
                  <button
                    key={day.dow}
                    type="button"
                    className="btn"
                    aria-pressed={on}
                    style={
                      on
                        ? {
                            background: "var(--math-t)",
                            borderColor: "var(--math)",
                          }
                        : undefined
                    }
                    onClick={() =>
                      setMask(
                        on ? mask & ~(1 << day.dow) : mask | (1 << day.dow),
                      )
                    }
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field">
            <label htmlFor="setup-minutes">Time per day</label>
            <select
              id="setup-minutes"
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            >
              {/* Presets from the payload — see the module note. */}
              {defaults.daily_minutes_presets.map((preset) => (
                <option key={preset} value={preset}>
                  {preset} minutes
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="setup-full-length">Practice test day</label>
            <select
              id="setup-full-length"
              value={fullLengthDay === null ? "" : String(fullLengthDay)}
              onChange={(event) =>
                setFullLengthDay(
                  event.target.value === "" ? null : Number(event.target.value),
                )
              }
            >
              <option value="">No fixed day</option>
              {DAYS.map((day) => (
                <option key={day.dow} value={day.dow}>
                  {day.label}
                </option>
              ))}
            </select>
          </div>

          {error === null ? null : (
            <div className="why" role="alert">
              <b>That didn&apos;t save</b>
              {error}
            </div>
          )}

          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Building your plan…" : "Build my plan"}
          </button>
        </form>
      </aside>
    </>
  );
}
