/**
 * §17.5 — first-visit setup, as a popup over a blurred plan.
 *
 * @spec [Doc 05F §17.5, §8.1; owner rulings 2026-09-24 (Brief 10 Step 2 and Step 3);
 *        SCL-130 — R-08-17 reversed] | @implemented [2026-09-24]
 *
 * plain English: two questions, then three, then — for a student who cannot yet see a plan
 * — a panel showing what they would get. Expected outcome: a saved profile and a generated
 * plan, from a student who answered nothing at all if that is what they chose to do.
 *
 * NOTHING IS REQUIRED AND NOTHING BLOCKS. This is the whole point of the change, so it is
 * worth being exact about what it means here:
 *
 *   · Every step has a Skip that advances without reading the inputs.
 *   · The popup is dismissible — Escape, the backdrop, and the × — and dismissing it saves
 *     nothing rather than saving a half-answer the student did not mean.
 *   · `Continue` is never disabled, no field is `required`, and there is no validation that
 *     can refuse a step.
 *   · Pressing straight through writes a REAL profile: the schedule fields open on
 *     selections (minute presets and bounds from `defaults`, which the server read out of
 *     `calendar_runtime_config`), so what gets saved is what the student saw, not a shape
 *     invented at submit time.
 *
 * The evidence for all of it: production on 2026-09-24 had 104 students and ONE study
 * profile, because the only surface collecting a test date or a target score was behind
 * `calendar_access` and had a required field in it.
 *
 * TIMEZONE IS NOT A FIELD. It is read from the browser and sent with the profile — asking a
 * 16-year-old to pick an IANA zone is asking them to do the computer's job. `defaults`
 * carries the server's suggestion for when the browser cannot say, and the server applies
 * the Chicago fall-open (item 19) when what arrives is undetectable or invalid.
 *
 * THE THIRD PANEL IS FOR A FREE STUDENT ONLY. An entitled student's last press builds the
 * plan and the popup closes; a free student's last press shows them what they would get and
 * the upgrade CTA. Either way the answers are already saved — `PUT /api/calendar/profile`
 * runs before the entitlement gate — which is why the panel can say so truthfully.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CalendarSetupDefaults } from "@lyceon/shared/calendar";
import { addDays, daysBetween } from "../lib/dates";
import {
  DEFAULT_EXAM_WEEKDAY,
  EXAM_FREQUENCIES,
  examCadenceNote,
  WEEKDAYS,
} from "../copy/exam-cadence";

/**
 * The cadence and weekday tables from `copy/exam-cadence` — the SAME two the settings sheet's
 * controls are built from, so the two surfaces cannot offer different choices for one setting.
 * Sunday-is-0, the Postgres DOW convention `study_days_mask` uses (sheet §6).
 */
const SETUP_FREQUENCIES = EXAM_FREQUENCIES;
const DAY_CHIPS = WEEKDAYS;

/**
 * Mon–Fri: the opening POSITION, not a stored value and not a recommendation.
 * `calendar_runtime_config` holds no default day-mask — it bounds minutes and the exam
 * horizon — so this one is the prototype's, and it exists so that a student who presses
 * straight through saves a week that makes sense rather than an empty one.
 *
 * THE FULL-LENGTH DAY OPENS UNSET, and that is deliberate. R-08-27 (Doc 05F §122, §8.1
 * `:448`) makes the test weekday OPTIONAL and independent of study days, and a full-length
 * consumes the whole of its day's budget — no practice and no review are placed on it. So
 * a pre-selected chip is not a harmless default: it spends a day of study time on a
 * decision the student never made. It used to open on Saturday, which meant a student who
 * pressed straight through had an exam booked every Saturday without ever seeing the row.
 *
 * This is the rule the exam-date field two panels up already follows, in its own words:
 * "the opening position is a control's resting state, not a claim". The resting state of
 * an OPTIONAL field is unanswered. Null stores as "no automatic exams" (the column is
 * nullable for exactly that), and the student can pick a day here or later in the settings
 * sheet, which offers the same chips including None.
 *
 * Owner ruling 2026-09-26, option (a): the pre-selection goes, the weekday itself is
 * untouched. Saturday remains available and remains the spec's own worked example (§928),
 * because the real SAT is sat on a Saturday morning — rehearsing on that weekday is the
 * point, when the student chooses it.
 */
const OPENING_DAYS = [1, 2, 3, 4, 5];
const OPENING_FULL_LENGTH_WEEKDAY: number | null = null;

/** §8.1: 400..1600 in steps of 10. The slider cannot express anything else. */
const SCORE_MIN = 400;
const SCORE_MAX = 1600;
const SCORE_STEP = 10;
const OPENING_SCORE = 1400;

/**
 * What the form collects. Deliberately NOT `Required<Pick<StudyProfileUpsert, …>>`, and the
 * reason is worth stating because CLAUDE.md's "never re-declare a shape a canonical type
 * already describes" points the other way at first glance.
 *
 * The canonical write shape makes every editable field OPTIONAL — the settings sheet sends
 * what changed — and Zod infers `.optional()` as `{ x?: T | undefined }`. `Required<>`
 * strips the `?` and leaves the `| undefined`, so deriving this would turn
 * `daily_minutes: number` into `number | undefined` and let the form submit a hole. That is
 * a WEAKER type, not a deduplicated one.
 *
 * What the rule is actually about is a hand-rolled shape that silently DROPS fields, so the
 * author reaches for the nearest one that compiles. Nothing is dropped by accident here:
 * `planner_mode` is absent because setup does not choose one, and `idempotency_key` because
 * a popup has no business knowing what one is — both deliberate, both stated. Drift is
 * caught at compile time where it matters: `saveProfile(answers)` in `pages/calendar.tsx`
 * passes this straight into `StudyProfileFields`, so a field this type names that the
 * schema does not have (or names with a different type) fails the build there.
 */
export type SetupAnswers = {
  target_exam_date: string | null;
  target_score: number | null;
  study_days_mask: number;
  daily_minutes: number;
  full_length_weekday: number | null;
  full_length_interval_weeks: number | null;
  timezone: string;
};

function maskOf(days: readonly number[]): number {
  let mask = 0;
  for (const d of days) mask |= 1 << d;
  return mask;
}

/** What the browser thinks the student's zone is. Undetectable is an answer, not a crash. */
function browserTimeZone(fallback: string): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
  } catch {
    return fallback;
  }
}

function minutesLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} hr`;
  if (minutes > 60) return `${minutes / 60} hr`;
  return `${minutes} min`;
}

function Chip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      {children}
    </button>
  );
}

function Dots({ step }: { step: 1 | 2 | 3 }): JSX.Element {
  return (
    <div className="dots" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= step ? "on" : ""} />
      ))}
    </div>
  );
}

export function SetupPopup({
  defaults,
  today,
  entitled,
  onSubmit,
  onDismiss,
  onUpgrade,
  pending,
  error,
}: {
  defaults: CalendarSetupDefaults;
  /** The student's local today, for the live "N days to go" readout. */
  today: string;
  /** False for a free student: the last press shows the third panel instead of closing. */
  entitled: boolean;
  onSubmit: (answers: SetupAnswers) => void;
  onDismiss: () => void;
  onUpgrade: () => void;
  pending: boolean;
  error: string | null;
}): JSX.Element {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // Opens on a date roughly a term away, so the control has a sensible position. It is
  // only STORED if the student leaves "I haven't picked a date yet" unchecked.
  const [examDate, setExamDate] = useState<string>(() => addDays(today, 60));
  const [noDate, setNoDate] = useState(false);
  const [score, setScore] = useState<number>(OPENING_SCORE);
  const [days, setDays] = useState<readonly number[]>(OPENING_DAYS);
  const [minutes, setMinutes] = useState<number>(
    () => defaults.daily_minutes_presets[3] ?? defaults.daily_minutes_min,
  );
  const [flWeekday, setFlWeekday] = useState<number | null>(
    OPENING_FULL_LENGTH_WEEKDAY,
  );

  /**
   * §8.1's cadence. THE CHIP THAT LOOKS PRESSED AND THE VALUE THAT IS SENT ARE TWO THINGS,
   * and this is the state that keeps them apart.
   *
   * Both requirements are real and they pull in opposite directions:
   *
   *   - The control OPENS ON THE SERVED DEFAULT. `default_full_length_interval_weeks` is a
   *     prefill exactly like `timezone`, and a frequency row resting on "None" while the
   *     server says 2 shows the student a setting nobody chose.
   *   - PRESSING STRAIGHT THROUGH STILL SENDS BOTH HALVES NULL. The weekday row opens
   *     unanswered (R-08-27), and `full_length_pair` refuses a cadence without a day. A
   *     cadence seeded into the SUBMITTED value made the pair half set at rest, so the
   *     answer-nothing path — the path this form exists to protect, and the one 103 of 104
   *     production students take — submitted `{weekday: null, interval: 2}` and met a 400.
   *
   * A `number | null` cannot hold both, because it cannot tell "the student chose None" from
   * "the student has not chosen". So it does not try: this is a discriminated union (§3.5),
   * and the two questions are asked of it separately. `submittedWeeks()` is what goes on the
   * wire; `pressedWeeks()` is what the chips render. A prefill is a value you adopt by
   * answering, never a value you are credited with for staying silent — and now it can be
   * shown without being credited.
   */
  type ExamCadence =
    | { answered: false }
    | { answered: true; weeks: number | null };
  const [cadence, setCadence] = useState<ExamCadence>({ answered: false });

  /** What the chips paint: the student's answer, or the served default while unanswered. */
  function pressedWeeks(): number | null {
    return cadence.answered
      ? cadence.weeks
      : defaults.default_full_length_interval_weeks;
  }

  /** What is SENT. Silence is null, whatever the row is showing. */
  function submittedWeeks(): number | null {
    return cadence.answered ? cadence.weeks : null;
  }

  /**
   * Picking a DAY answers the cadence too, and it can never answer it with null.
   *
   * "Picking a day adopts the default" is the whole reason the default is shown: the
   * student sees what they are about to agree to before they agree. But `pressedWeeks()`
   * returns null once the student has pressed None on EITHER row, and adopting that gave
   * `{weekday: 6, interval: null}` — half a pair, refused by the Step 2 refinement and by
   * `full_length_pair`. Every other case in this form presses None last, so nothing caught
   * it: it needs a student who says "no tests", changes their mind, and picks a day.
   *
   * SCL-183 item (1) is the rule: "the UI supplies the other half whenever the student
   * answers one." Answering the day IS answering one, so the other half is supplied — the
   * cadence on screen when there is one, the served default when the screen says None.
   * There is no sequence of taps through this form that can emit half a pair.
   */
  function adoptShownCadence(): void {
    setCadence({
      answered: true,
      weeks: pressedWeeks() ?? defaults.default_full_length_interval_weeks,
    });
  }

  /**
   * The exam half of step 2's note, from the SHARED readout — the settings sheet prints the
   * same sentence from the same function. Which of its three shapes appears is decided there
   * and not here: with the step-1 date still in hand it is a count, and after the "haven't
   * picked a date yet" opt-out it falls back to the rate.
   */
  function setupExamNote(): string {
    return examCadenceNote({
      weekday: flWeekday,
      // The SUBMITTED value, not the painted one: the sentence describes what will
      // actually be scheduled, and while the pair is unanswered that is nothing.
      intervalWeeks: submittedWeeks(),
      targetExamDate: noDate ? null : examDate,
      today,
      finalExamLeadDays: defaults.final_exam_lead_days,
    });
  }

  const timezone = useMemo(
    () => browserTimeZone(defaults.timezone),
    [defaults.timezone],
  );

  /** The live readout. Null when there is no date to count to — copy, never a 0. */
  const daysToGo = noDate ? null : Math.max(0, daysBetween(today, examDate));

  // Escape dismisses. A popup that traps a student who does not want it is a blocker
  // wearing a different shape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  function answers(): SetupAnswers {
    return {
      // The opt-out is the reason this is null rather than the date sitting in the input:
      // a student who says they have not picked one has said something, and storing the
      // placeholder would be the form answering on their behalf.
      target_exam_date: noDate ? null : examDate,
      target_score: score,
      study_days_mask: maskOf(days),
      daily_minutes: minutes,
      full_length_weekday: flWeekday,
      full_length_interval_weeks: submittedWeeks(),
      timezone,
    };
  }

  /** Skip means "no answer from me", so the field is sent as null rather than as its
   *  opening position — the opening position is a control's resting state, not a claim. */
  function skipToSchedule(): void {
    setNoDate(true);
    setScoreSkipped(true);
    setStep(2);
  }
  const [scoreSkipped, setScoreSkipped] = useState(false);

  function finish(): void {
    const body = answers();
    if (scoreSkipped) body.target_score = null;
    onSubmit(body);
    // A free student stays to see the third panel. Their answers are already on the way —
    // the write is not gated — so the panel's "saved either way" is a fact, not a promise.
    if (!entitled) setStep(3);
  }

  return (
    <div
      className="modal on"
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-setup-title"
      data-testid="calendar-setup-popup"
      onClick={(e) => {
        // The backdrop dismisses; the card does not.
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="card">
        <header>
          <button
            type="button"
            className="skip"
            style={{ float: "right" }}
            onClick={onDismiss}
            aria-label="Close setup"
            data-testid="calendar-setup-dismiss"
          >
            ✕
          </button>
          <h2 id="calendar-setup-title">
            {step === 1
              ? "Let's set up your plan"
              : step === 2
                ? "When do you study?"
                : "Your plan is ready"}
          </h2>
          <div className="lede">
            {step === 1
              ? "Two quick questions. You can change any of this later."
              : step === 2
                ? "This is what we plan around."
                : ""}
          </div>
        </header>

        <div className="body">
          {step === 1 ? (
            <>
              <div className="field">
                <label htmlFor="setup-exam">When is your SAT?</label>
                <input
                  id="setup-exam"
                  type="date"
                  value={examDate}
                  disabled={noDate}
                  max={addDays(today, defaults.target_exam_date_max_days)}
                  onChange={(e) => setExamDate(e.target.value)}
                  data-testid="calendar-setup-exam-date"
                />
              </div>
              <label className="optout">
                <input
                  type="checkbox"
                  checked={noDate}
                  onChange={(e) => setNoDate(e.target.checked)}
                  data-testid="calendar-setup-no-date"
                />{" "}
                I haven't picked a date yet
              </label>
              <div className="field">
                <label htmlFor="setup-score">
                  What score are you aiming for?
                </label>
                <div className="scoreline">
                  <b data-testid="calendar-setup-score-out">{score}</b>
                  <span data-testid="calendar-setup-score-note">
                    {daysToGo === null
                      ? "out of 1600"
                      : `out of 1600 · ${daysToGo} days to go`}
                  </span>
                </div>
                <input
                  id="setup-score"
                  type="range"
                  min={SCORE_MIN}
                  max={SCORE_MAX}
                  step={SCORE_STEP}
                  value={score}
                  onChange={(e) => {
                    setScore(Number(e.target.value));
                    setScoreSkipped(false);
                  }}
                  data-testid="calendar-setup-score"
                />
              </div>
            </>
          ) : step === 2 ? (
            <>
              <div className="field">
                <label>Study days</label>
                <div className="chips" data-testid="calendar-setup-days">
                  {DAY_CHIPS.map((d) => (
                    <Chip
                      key={d.dow}
                      active={days.includes(d.dow)}
                      onClick={() =>
                        setDays((prev) =>
                          prev.includes(d.dow)
                            ? // Never to zero: a plan with no study day is not a plan, and
                              // the mask's own CHECK refuses it. Silently, because this is
                              // the control declining to do something meaningless rather
                              // than the form correcting the student.
                              prev.length === 1
                              ? prev
                              : prev.filter((x) => x !== d.dow)
                            : [...prev, d.dow],
                        )
                      }
                    >
                      {d.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Time per day</label>
                <div className="chips" data-testid="calendar-setup-minutes">
                  {defaults.daily_minutes_presets.map((m) => (
                    <Chip
                      key={m}
                      active={m === minutes}
                      onClick={() => setMinutes(m)}
                    >
                      {minutesLabel(m)}
                    </Chip>
                  ))}
                </div>
              </div>
              {/*
                THE PAIR, ENFORCED THE SAME WAY AS IN THE SETTINGS SHEET. Both controls move
                both halves, so no sequence of taps builds a weekday without a cadence or a
                cadence without a weekday — `full_length_pair` refuses either, and a student
                should never meet a refusal they could have been walked around. Setup has no
                Save to disable, so BOTH halves always hold a value or both are null: picking
                a day adopts the served default, and None on either clears both.
              */}
              <div className="field">
                <label>Practice test day</label>
                <div className="chips" data-testid="calendar-setup-fl">
                  <Chip
                    active={flWeekday === null}
                    onClick={() => {
                      setFlWeekday(null);
                      // An explicit None on the day is an explicit None on the pair. The
                      // cadence becomes ANSWERED-as-null rather than returning to unanswered,
                      // so the frequency row stops showing a default the student just refused.
                      setCadence({ answered: true, weeks: null });
                    }}
                  >
                    None
                  </Chip>
                  {DAY_CHIPS.map((d) => (
                    <Chip
                      key={d.dow}
                      active={flWeekday === d.dow}
                      onClick={() => {
                        setFlWeekday(d.dow);
                        adoptShownCadence();
                      }}
                    >
                      {d.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Practice test frequency</label>
                <div
                  className="chips"
                  data-testid="calendar-setup-fl-frequency"
                >
                  <Chip
                    active={pressedWeeks() === null}
                    onClick={() => {
                      setCadence({ answered: true, weeks: null });
                      setFlWeekday(null);
                    }}
                  >
                    None
                  </Chip>
                  {SETUP_FREQUENCIES.map((f) => (
                    <Chip
                      key={f.value}
                      active={pressedWeeks() === f.value}
                      onClick={() => {
                        setCadence({ answered: true, weeks: f.value });
                        // Completes the pair. Setup has no Save to disable, so a cadence with
                        // no day would submit half a pair and meet a 400 — see
                        // DEFAULT_EXAM_WEEKDAY for why the day is Saturday.
                        setFlWeekday(flWeekday ?? DEFAULT_EXAM_WEEKDAY);
                      }}
                    >
                      {f.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <p className="note" data-testid="calendar-setup-note">
                {days.length} day{days.length === 1 ? "" : "s"} a week ·{" "}
                {minutesLabel(minutes)} a day · {setupExamNote()}
              </p>
            </>
          ) : (
            <>
              <div className="cta">
                <b>
                  {daysToGo === null
                    ? "A plan built around your week"
                    : `${daysToGo} days to your SAT`}
                </b>
                A {days.length}-day-a-week plan
                {scoreSkipped ? "" : ` aiming at ${score}`} — practice, review
                and full-length tests, rebuilt every week as you improve.
                <button
                  type="button"
                  onClick={onUpgrade}
                  data-testid="calendar-setup-upgrade"
                >
                  Unlock my study plan
                </button>
              </div>
              <p className="note">
                Your test date and target score are saved either way.
              </p>
            </>
          )}

          {error === null ? null : (
            <p className="note" role="alert" data-testid="calendar-setup-error">
              {error}
            </p>
          )}
        </div>

        <footer>
          <Dots step={step} />
          {step === 1 ? (
            <>
              <button
                type="button"
                className="skip"
                onClick={skipToSchedule}
                data-testid="calendar-setup-skip-1"
              >
                Skip
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => setStep(2)}
                data-testid="calendar-setup-continue"
              >
                Continue
              </button>
            </>
          ) : step === 2 ? (
            <>
              <button
                type="button"
                className="skip"
                onClick={() => setStep(1)}
                data-testid="calendar-setup-back"
              >
                Back
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={finish}
                disabled={pending}
                data-testid="calendar-setup-done"
              >
                {pending
                  ? "Saving…"
                  : entitled
                    ? "Build my plan"
                    : "See what I'd get"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="skip"
              onClick={onDismiss}
              data-testid="calendar-setup-later"
            >
              Maybe later
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
