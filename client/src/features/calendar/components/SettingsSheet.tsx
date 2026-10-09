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
  type ExamPlanning,
  type PlanningEstimates,
  type CompletedStudyProfile,
  type StudyProfileBounds,
} from "@lyceon/shared/calendar";
import { addDays } from "../lib/dates";
import {
  EXAM_FREQUENCIES,
  examCadenceNote,
  WEEKDAYS,
} from "../copy/exam-cadence";

/**
 * §8.1's four cadences and the weekday table, from `copy/exam-cadence` — the SAME tables the
 * setup form's controls are built from. `-1` stands for None in both chip rows: a chip needs a
 * number to key on and the wire value is null.
 */
const FREQUENCIES = EXAM_FREQUENCIES;

const DAYS = WEEKDAYS;

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

type SettingsSheetProps = {
  profile: CompletedStudyProfile;
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

/**
 * HALF A PAIR IS UNSAVEABLE, and Save says so rather than the server saying it.
 *
 * `full_length_pair` refuses (weekday, null) and (null, cadence); Step 2's Zod refinement
 * returns a clean 400 for either. But a 400 a student could have been walked around is a
 * design failure, not a validation success.
 *
 * NO CHIP CAN REACH THIS ANY MORE — both rows move both halves, so the draft is always whole.
 * It stays as the guard behind that. The draft opens from the `profile` prop, so a test
 * reaches a half pair the interaction cannot build by rendering the sheet over one: an
 * unreachable guard that nothing asserts is an unreachable guard that quietly stops working.
 */
function examPairIncomplete(
  draft: Pick<
    SettingsDraft,
    "full_length_weekday" | "full_length_interval_weeks"
  >,
): boolean {
  return (
    (draft.full_length_interval_weeks === null) !==
    (draft.full_length_weekday === null)
  );
}

/** §17.3's live readout. Derived, never stored — Coding Standards §11.4. */
function scheduleSummary(
  draft: Pick<
    SettingsDraft,
    | "study_days_mask"
    | "daily_minutes"
    | "full_length_weekday"
    | "full_length_interval_weeks"
  >,
  estimates: PlanningEstimates,
  /**
   * The count needs the target date and the lead window, and NOTHING else.
   *
   * It used to take the whole `ExamPlanning` object, which made the prefill
   * (`default_full_length_interval_weeks`) a dependency of a readout that never reads it — so
   * one call site spread the object and the other passed the one field it knew was used, and
   * only `tsc -p tsconfig.ci.json` could tell them apart. `pnpm -s run build` cannot: vite
   * strips types without checking them, so the client is typechecked by that config alone.
   * Naming the field is what makes the two call sites agree.
   */
  cadence: {
    targetExamDate: string | null;
    today: string;
    finalExamLeadDays: number;
  },
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
  return `${dayPart} · ${workPart} · ${examCadenceNote({
    weekday: draft.full_length_weekday,
    intervalWeeks: draft.full_length_interval_weeks,
    targetExamDate: cadence.targetExamDate,
    today: cadence.today,
    finalExamLeadDays: cadence.finalExamLeadDays,
  })}`;
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

  const pairIncomplete = examPairIncomplete(draft);
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
            label="Full-length test day"
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
            label="Full-length test frequency"
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
                // None clears both. A cadence with no day yet adopts Saturday, the same way
                // the setup form does and for the same reason — half a pair is refused by
                // `full_length_pair`, and a student who has just said they want practice
                // tests should not meet a dead Save button they have to decode. The day is
                // one chip away if Saturday is wrong.
                full_length_weekday:
                  value < 0
                    ? null
                    : (draft.full_length_weekday ??
                      examPlanning.default_full_length_weekday),
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
              finalExamLeadDays: examPlanning.final_exam_lead_days,
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
            disabled={pending || pairIncomplete}
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
