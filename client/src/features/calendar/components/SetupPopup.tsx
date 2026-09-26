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

/** Sunday-is-0 — the Postgres DOW convention `study_days_mask` uses (sheet §6). */
const DAY_CHIPS: readonly { dow: number; label: string }[] = [
  { dow: 0, label: "Sun" },
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
];

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

export type SetupAnswers = {
  target_exam_date: string | null;
  target_score: number | null;
  study_days_mask: number;
  daily_minutes: number;
  full_length_weekday: number | null;
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
              <div className="field">
                <label>Practice test day</label>
                <div className="chips" data-testid="calendar-setup-fl">
                  <Chip
                    active={flWeekday === null}
                    onClick={() => setFlWeekday(null)}
                  >
                    None
                  </Chip>
                  {DAY_CHIPS.map((d) => (
                    <Chip
                      key={d.dow}
                      active={flWeekday === d.dow}
                      onClick={() => setFlWeekday(d.dow)}
                    >
                      {d.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <p className="note" data-testid="calendar-setup-note">
                {days.length} day{days.length === 1 ? "" : "s"} a week ·{" "}
                {minutesLabel(minutes)} a day
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
