/**
 * @spec [Doc_05F_Study_Calendar, §17.3 settings sheet, §8.1 bounds, §12.1 `profile_change`,
 *        §7.1 mask convention, §16 entitlement]
 *       [formula sheet §8 item 19 — timezone falls open to America/Chicago]
 * @implemented [2026-09-22]
 *
 * plain English: the sheet that lets a student change their schedule AFTER setup. Until this
 * existed, `PUT /api/calendar/profile` had no caller once setup was done: a student who
 * picked five days and an hour in their first week was stuck with it.
 *
 * EVERY BOUND COMES FROM THE RESPONSE (§8.1). The minute chips, the furthest exam date and
 * the min/max are fields of `bounds` on the ready payload — the SAME object
 * `makeStudyProfileUpsertSchema` validates the save against. So the chips a student is
 * offered and the rule their save is judged by are one value, read once. A preset array
 * typed into this file would be a second source of truth and would drift from
 * `calendar_runtime_config` the moment a bound changed.
 *
 * THE PRACTICE-TEST DAY IS INDEPENDENT OF THE STUDY DAYS. Dropping Saturday as a study day
 * does not remove a Saturday test; only choosing "None" does. They are separate columns
 * (`study_days_mask`, `full_length_weekday`) and §7.1 treats them separately, so the sheet
 * does too. Coupling them would silently cancel a student's test when they took a day off.
 *
 * CUSTOM MODE ASKS FIRST. In `auto` the save regenerates future non-overridden dates as
 * `profile_change` and the student expects that. In `custom` the server deliberately does
 * NOT regenerate (`regenerateAfterProfileChange` returns null unless the mode is auto) —
 * silently replanning a student who turned the planner off would be the planner ignoring
 * them. So the sheet offers "Re-plan my open days?" and writes NOTHING until it is
 * confirmed; confirming calls the student-initiated refresh, which is `student_refresh`.
 *
 * trade-offs: the draft is local state and only reaches the server on Save, so Cancel is
 * free and a half-made change never writes. That costs a copy of the profile in state,
 * which is the right price.
 *
 * edge cases: a student cannot remove their last study day — `study_days_mask` is
 * CHECKed 1..127 in the database, so a zero mask is a 400 the student could not act on.
 * The last chip refuses instead, which is the same rule stated where they can see it.
 */
import { useState } from "react";
import {
  fullLengthsBeforeTarget,
  type ExamPlanning,
  type PlanningEstimates,
  type StudyProfile,
  type StudyProfileBounds,
} from "@lyceon/shared/calendar";
import { addDays } from "../lib/dates";

/**
 * §8.1's four cadences. The VALUE is weeks — 1|2|3|4 — and the label is this table's only
 * business: renaming "Monthly" never migrates data, because the column stores 4.
 * `-1` stands for None, the same way the day picker uses it: a chip needs a number to key on
 * and the wire value is null.
 */
const FREQUENCIES = [
  { value: 1, label: "Weekly" },
  { value: 2, label: "Every 2 weeks" },
  { value: 3, label: "Every 3 weeks" },
  { value: 4, label: "Monthly" },
] as const;

/** Sunday-is-0 — the Postgres DOW convention `study_days_mask` and `full_length_weekday` use. */
const DAYS: readonly { dow: number; label: string; full: string }[] = [
  { dow: 0, label: "Sun", full: "Sunday" },
  { dow: 1, label: "Mon", full: "Monday" },
  { dow: 2, label: "Tue", full: "Tuesday" },
  { dow: 3, label: "Wed", full: "Wednesday" },
  { dow: 4, label: "Thu", full: "Thursday" },
  { dow: 5, label: "Fri", full: "Friday" },
  { dow: 6, label: "Sat", full: "Saturday" },
];

/**
 * The zones offered in the picker. A list, not a bound, because there is no server-served
 * list of zones — the server validates with `calendar_is_known_timezone` against
 * `pg_timezone_names`, which is thousands of entries and not a picker.
 *
 * The student's STORED zone is always included even if it is not one of these, so opening
 * the sheet can never silently reassign someone who set an unusual zone.
 */
const COMMON_TIMEZONES: readonly string[] = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export type SettingsDraft = {
  timezone: string;
  study_days_mask: number;
  daily_minutes: number;
  target_exam_date: string | null;
  target_score: number | null;
  full_length_weekday: number | null;
  full_length_interval_weeks: number | null;
  planner_mode: "auto" | "custom";
};

export type SettingsSheetProps = {
  profile: StudyProfile;
  bounds: StudyProfileBounds;
  estimates: PlanningEstimates;
  /** §8.1's readout needs `final_exam_lead_days`; §17 forbids a literal for it. */
  examPlanning: ExamPlanning;
  today: string;
  onSave: (draft: SettingsDraft) => void;
  onClose: () => void;
  pending: boolean;
  error: string | null;
  /**
   * Shown after a save in `custom` mode, where the server planned nothing. Confirming runs
   * the student-initiated refresh; dismissing leaves the plan exactly as it was.
   */
  replanOffer: { onConfirm: () => void; onDismiss: () => void } | null;
};

/** §17.3's live readout. Derived, never stored — Coding Standards §11.4. */
export function scheduleSummary(
  draft: Pick<
    SettingsDraft,
    | "study_days_mask"
    | "daily_minutes"
    | "full_length_weekday"
    | "full_length_interval_weeks"
  >,
  estimates: PlanningEstimates,
  /** The count needs the target date and the lead window; both are server-owned. */
  cadence: { targetExamDate: string | null; today: string } & ExamPlanning,
): string {
  const days = DAYS.filter(
    (day) => ((draft.study_days_mask >> day.dow) & 1) === 1,
  );
  const dayPart = `${days.length} study day${days.length === 1 ? "" : "s"} a week`;
  // Rounded DOWN to the five-question granule the allocator works in, so the number a
  // student reads is a number the plan can actually contain.
  const questions =
    Math.floor(
      (draft.daily_minutes * 60) / estimates.practice_seconds_per_unit / 5,
    ) * 5;
  const workPart = `about ${questions} question${questions === 1 ? "" : "s"} a day`;
  return `${dayPart} · ${workPart} · ${examPart(draft, cadence)}`;
}

/**
 * The exam half of the readout. THREE shapes, and which one appears is the point:
 *
 *   None chosen              "no automatic practice tests"
 *   cadence, no target date  "a practice test every 2 weeks, on Saturdays"
 *   cadence and a target     "about 5 practice tests before 5 December, on Saturdays"
 *
 * The COUNT only appears when there is something to count toward. With no target date a
 * number would have to be invented against some arbitrary window, so the rate is stated
 * instead — it is the honest answer to "what did I just choose", and it is what
 * `fullLengthsBeforeTarget` returns null for.
 */
function examPart(
  draft: Pick<
    SettingsDraft,
    "full_length_weekday" | "full_length_interval_weeks"
  >,
  cadence: { targetExamDate: string | null; today: string } & ExamPlanning,
): string {
  const day = DAYS.find((d) => d.dow === draft.full_length_weekday);
  const weeks = draft.full_length_interval_weeks;
  if (day === undefined || weeks === null) return "no automatic practice tests";

  const onDay = `on ${day.full}s`;
  // THE SHARED FUNCTION, not a local estimate. It takes the generator's own steps, so the
  // number promised here is the number the plan will hold (§8.1).
  const count = fullLengthsBeforeTarget({
    today: cadence.today,
    intervalWeeks: weeks,
    preferredWeekday: draft.full_length_weekday,
    targetExamDate: cadence.targetExamDate,
    finalExamLeadDays: cadence.final_exam_lead_days,
  });
  if (count === null) {
    const rate = weeks === 1 ? "every week" : `every ${weeks} weeks`;
    return `a practice test ${rate}, ${onDay}`;
  }
  const noun = count === 1 ? "practice test" : "practice tests";
  return `about ${count} ${noun} before ${friendlyDate(cadence.targetExamDate)}, ${onDay}`;
}

/** "2026-12-05" -> "5 December". The readout reads as a sentence, not a form field. */
function friendlyDate(iso: string | null): string {
  if (iso === null) return "your test";
  const [, month, day] = iso.split("-");
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const name = MONTHS[Number(month) - 1];
  return name === undefined ? iso : `${Number(day)} ${name}`;
}

function Chips({
  label,
  options,
  isOn,
  onPick,
  testId,
}: {
  label: string;
  options: readonly { value: number; label: string }[];
  isOn: (value: number) => boolean;
  onPick: (value: number) => void;
  testId: string;
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <div
        className="chips"
        role="group"
        aria-label={label}
        data-testid={testId}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={isOn(option.value)}
            onClick={() => onPick(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsSheet({
  profile,
  bounds,
  estimates,
  examPlanning,
  today,
  onSave,
  onClose,
  pending,
  error,
  replanOffer,
}: SettingsSheetProps): JSX.Element {
  const [draft, setDraft] = useState<SettingsDraft>(() => ({
    timezone: profile.timezone,
    study_days_mask: profile.study_days_mask,
    daily_minutes: profile.daily_minutes,
    target_exam_date: profile.target_exam_date,
    target_score: profile.target_score,
    full_length_weekday: profile.full_length_weekday,
    full_length_interval_weeks: profile.full_length_interval_weeks,
    planner_mode: profile.planner_mode,
  }));
  const [lastDayRefused, setLastDayRefused] = useState(false);

  const latestExamDate = addDays(today, bounds.target_exam_date_max_days);

  /**
   * The cadence a day-pick adopts when the student has not chosen one. From the server
   * (§17: no client literal), and the SAME value the setup form opens on, so "pick a day"
   * means the same thing in both places.
   */
  const defaultIntervalWeeks = examPlanning.default_full_length_interval_weeks;

  /**
   * HALF A PAIR IS UNSAVEABLE, and Save says so rather than the server saying it.
   *
   * `full_length_pair` refuses (weekday, null) and (null, cadence); Step 2's refinement
   * returns a clean 400 for either. But a 400 a student could have been walked around is a
   * design failure, not a validation success — so the one reachable half-set state (a
   * frequency chosen with no day yet) disables Save and says why.
   */
  const examPairIncomplete =
    (draft.full_length_interval_weeks === null) !==
    (draft.full_length_weekday === null);
  const zones = COMMON_TIMEZONES.includes(profile.timezone)
    ? COMMON_TIMEZONES
    : [profile.timezone, ...COMMON_TIMEZONES];

  function toggleDay(dow: number): void {
    const on = ((draft.study_days_mask >> dow) & 1) === 1;
    if (on && bitCount(draft.study_days_mask) === 1) {
      setLastDayRefused(true);
      return;
    }
    setLastDayRefused(false);
    setDraft({
      ...draft,
      study_days_mask: on
        ? draft.study_days_mask & ~(1 << dow)
        : draft.study_days_mask | (1 << dow),
    });
  }

  return (
    <>
      <div className="scrim on" aria-hidden="true" />
      <aside
        className="sheet set on"
        aria-label="Your schedule"
        data-testid="calendar-settings-sheet"
      >
        <header>
          <h3>Your schedule</h3>
          <div className="when">
            Changes re-plan your open days. Days you edited or blocked out stay
            as they are.
          </div>
        </header>

        <div className="body">
          <Chips
            label="Study days"
            testId="settings-study-days"
            options={DAYS.map((day) => ({ value: day.dow, label: day.label }))}
            isOn={(dow) => ((draft.study_days_mask >> dow) & 1) === 1}
            onPick={toggleDay}
          />
          {lastDayRefused ? (
            <p className="note" role="status">
              Keep at least one study day.
            </p>
          ) : null}

          <Chips
            label="Time per day"
            testId="settings-minutes"
            // From the payload. See the module note — never a literal here.
            options={bounds.daily_minutes_presets.map((preset) => ({
              value: preset,
              label: preset < 60 ? `${preset} min` : `${preset / 60} hr`,
            }))}
            isOn={(preset) => preset === draft.daily_minutes}
            onPick={(preset) => setDraft({ ...draft, daily_minutes: preset })}
          />

          <div className="row">
            <div className="field">
              <label htmlFor="settings-exam-date">SAT date</label>
              <input
                id="settings-exam-date"
                type="date"
                min={today}
                max={latestExamDate}
                value={draft.target_exam_date ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    target_exam_date:
                      event.target.value === "" ? null : event.target.value,
                  })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="settings-target-score">Target score</label>
              <input
                id="settings-target-score"
                type="number"
                min={400}
                max={1600}
                step={10}
                value={draft.target_score ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    target_score:
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                  })
                }
              />
            </div>
          </div>

          {/*
            THE PAIR IS ENFORCED HERE, NOT JUST IN THE SCHEMA. `full_length_pair` refuses a
            weekday without a cadence and vice versa, and Step 2's Zod refinement turns that
            into a 400 — but a student should never MEET either. Both handlers below move
            both halves, so no sequence of chip taps can build a half-set pair:

              None on either control  -> both null
              a day, nothing else set -> the cadence defaults to the config prefill
              a cadence, no day yet   -> the day stays null and SAVE IS DISABLED (below),
                                         because guessing a Saturday for them would be
                                         inventing a choice they did not make

            The schema is the backstop. This is the interaction.
          */}
          <Chips
            label="Practice test day"
            testId="settings-full-length"
            // -1 stands for None. The wire value is null; the chip needs a number to key on.
            options={[
              { value: -1, label: "None" },
              ...DAYS.map((day) => ({ value: day.dow, label: day.label })),
            ]}
            isOn={(value) => value === (draft.full_length_weekday ?? -1)}
            onPick={(value) =>
              setDraft({
                ...draft,
                full_length_weekday: value < 0 ? null : value,
                // Picking None clears BOTH. Picking a day adopts the prefill cadence if the
                // student has not chosen one, so the commonest path needs one tap.
                full_length_interval_weeks:
                  value < 0
                    ? null
                    : (draft.full_length_interval_weeks ??
                      defaultIntervalWeeks),
              })
            }
          />

          <Chips
            label="Practice test frequency"
            testId="settings-full-length-frequency"
            options={[
              { value: -1, label: "None" },
              ...FREQUENCIES.map((f) => ({ value: f.value, label: f.label })),
            ]}
            isOn={(value) => value === (draft.full_length_interval_weeks ?? -1)}
            onPick={(value) =>
              setDraft({
                ...draft,
                full_length_interval_weeks: value < 0 ? null : value,
                // None clears both. A frequency leaves the day alone — including null, which
                // is what disables Save until they pick one.
                full_length_weekday:
                  value < 0 ? null : draft.full_length_weekday,
              })
            }
          />

          <div className="field">
            <label htmlFor="settings-timezone">Timezone</label>
            <select
              id="settings-timezone"
              value={draft.timezone}
              onChange={(event) =>
                setDraft({ ...draft, timezone: event.target.value })
              }
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>

          <div className="toggle">
            <div>
              <b>Auto plan</b>
              <small>Refreshes your open days every week.</small>
            </div>
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={draft.planner_mode === "auto"}
              aria-label="Auto plan"
              data-testid="settings-auto-plan"
              onClick={() =>
                setDraft({
                  ...draft,
                  planner_mode:
                    draft.planner_mode === "auto" ? "custom" : "auto",
                })
              }
            />
          </div>

          <p className="note" data-testid="settings-summary">
            {scheduleSummary(draft, estimates, {
              targetExamDate: draft.target_exam_date,
              today,
              final_exam_lead_days: examPlanning.final_exam_lead_days,
            })}
          </p>

          {error === null ? null : (
            <div className="why" role="alert">
              <b>That didn&apos;t save</b>
              {error}
            </div>
          )}

          {replanOffer === null ? null : (
            <div
              className="why"
              role="status"
              data-testid="settings-replan-offer"
            >
              <b>Re-plan my open days?</b>
              Auto plan is off, so nothing has changed on your calendar yet.
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={replanOffer.onConfirm}
                >
                  Re-plan open days
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={replanOffer.onDismiss}
                >
                  Leave it
                </button>
              </div>
            </div>
          )}
        </div>

        <footer>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={pending || examPairIncomplete}
            data-testid="settings-save"
            onClick={() => onSave(draft)}
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </aside>
    </>
  );
}

function bitCount(mask: number): number {
  let count = 0;
  for (let bit = 0; bit < 7; bit += 1) {
    if (((mask >> bit) & 1) === 1) count += 1;
  }
  return count;
}
