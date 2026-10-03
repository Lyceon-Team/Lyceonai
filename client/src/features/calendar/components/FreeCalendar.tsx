/**
 * The free plan's calendar page: the inline setup form, the plan upsell card, and the right
 * panel (mini month and the Target-only goal card).
 *
 * @spec [student-UI register UI-55; §2 Free versus paid (Step 2 ruling 3: the calendar page
 *        does its own upsell; setup renders before the entitlement gate, SCL-130); OQ-25 (free
 *        students read their study profile through the ungated `GET /api/calendar/profile`,
 *        see their test date and target in the right panel; the plan grids stay premium);
 *        OQ-39(e) ("See plans" → Settings → Billing); OQ-29 (lock reason `age`); DESIGN.md §4
 *        Calendar ("Free plan: setup form (test date and target) plus the plan upsell card");
 *        prototype Calendar.dc.html plan = free; Doc 05F §15, §16, §17.5] | @implemented
 *        [2026-10-03]
 *
 * plain English: a free student states a test date and a target score and saves them through
 * `PUT /api/calendar/profile` (the page mints the idempotency key, as every profile save does).
 * The form shows what is saved: it opens on the profile the ungated read returned, so after a
 * save the student sees their own answers instead of an empty form (wiring table §9, the
 * PARTIAL row OQ-25 closed). Beside it, the upsell says what the paid plan is and links to
 * plans. No plan is read for this page: the grids are premium (OQ-25).
 *
 * Replaces the old free path, the setup popup's third panel and `CalendarPremiumGate`. The
 * UI-41 audit found the popup ran off the right edge at 390px with Skip and Continue out of
 * view; an inline form has no such edge.
 *
 * edge cases: nothing is required (SCL-130). An empty date or score saves as null. The score
 * input carries the §8.1 bounds (400 to 1600 in steps of 10) as hints; the server's schema is
 * the authority, and a refusal shows its message under the form. An under-13 student (lock
 * reason `age`) gets no "See plans", as the upgrade modal gives them none.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import type { StudyProfile } from "@lyceon/shared/calendar";
import { AppShellPanel } from "@/components/layout/app-shell";
import { Button, LYC_FOCUS } from "@/components/ui/button";
import {
  UPGRADE_MODAL_AGE_BODY,
  UPGRADE_MODAL_SHARED_COPY,
  UPGRADE_PLANS_DESTINATION,
} from "@/components/billing/upgrade-modal";
import { shiftMonths, startOfMonth, startOfWeek } from "../lib/dates";
import { CalendarPanelColumn, GoalCard, MiniMonth } from "./StudentChrome";

/** §8.1: 400..1600 in steps of 10, the setup popup's own bounds. */
const SCORE_MIN = 400;
const SCORE_MAX = 1600;
const SCORE_STEP = 10;

export type FreeGoal = {
  target_exam_date: string | null;
  target_score: number | null;
};

export function FreeCalendar({
  today,
  profile,
  reason,
  maxTestDate,
  onSave,
  pending,
  error,
}: {
  today: string;
  /** The ungated read's profile; null before the first save. */
  profile: StudyProfile | null;
  /** The feature-access lock reason (OQ-29); `plan` when the page learned it from a 402. */
  reason: "plan" | "age";
  /** The served `target_exam_date_max_days` horizon as a date, when the page has it. */
  maxTestDate: string | null;
  onSave: (goal: FreeGoal) => void;
  pending: boolean;
  error: string | null;
}): JSX.Element {
  const [miniMonth, setMiniMonth] = useState(() => startOfMonth(today));
  const testDate = profile?.target_exam_date ?? null;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col lg:overflow-y-auto"
      data-testid="calendar-free"
    >
      <div className="flex max-w-[720px] flex-col gap-7 px-4 py-6 lg:px-14 lg:py-12">
        <SetupForm
          // A new profile (a save landed, or Settings changed it) re-opens the form on it.
          key={`${testDate ?? ""}|${profile?.target_score ?? ""}`}
          profile={profile}
          maxTestDate={maxTestDate}
          onSave={onSave}
          pending={pending}
          error={error}
        />
        <PlanUpsellCard reason={reason} />
      </div>
      <AppShellPanel>
        <CalendarPanelColumn>
          <MiniMonth
            month={miniMonth}
            onMonthStep={(delta) => setMiniMonth(shiftMonths(miniMonth, delta))}
            today={today}
            weekStart={startOfWeek(today)}
            testDate={testDate}
          />
          <GoalCard
            today={today}
            testDate={testDate}
            targetScore={profile?.target_score ?? null}
            projection={null}
          />
        </CalendarPanelColumn>
      </AppShellPanel>
    </div>
  );
}

const FIELD_LABEL =
  "flex flex-col gap-2 text-[17px] font-semibold text-lyc-ink";
const FIELD_INPUT = `${LYC_FOCUS} h-[46px] rounded-md border border-lyc-input-bd bg-lyc-sheet px-3.5 text-[17px] font-normal text-lyc-ink`;

function SetupForm({
  profile,
  maxTestDate,
  onSave,
  pending,
  error,
}: {
  profile: StudyProfile | null;
  maxTestDate: string | null;
  onSave: (goal: FreeGoal) => void;
  pending: boolean;
  error: string | null;
}): JSX.Element {
  const [date, setDate] = useState(profile?.target_exam_date ?? "");
  const [score, setScore] = useState(
    profile?.target_score === null || profile?.target_score === undefined
      ? ""
      : String(profile.target_score),
  );
  return (
    <section
      aria-labelledby="calendar-setup-h"
      className="flex flex-col gap-5 rounded-lg border border-lyc-rule bg-lyc-sheet px-5 py-7 sm:px-9 sm:py-8"
      data-testid="calendar-free-setup"
    >
      <h1
        id="calendar-setup-h"
        className="m-0 font-lyc-serif text-[30px] font-semibold leading-tight text-lyc-ink-strong"
      >
        Set up your study plan
      </h1>
      <p className="m-0 text-[18px] leading-relaxed text-lyc-ink">
        Tell us when you&apos;re testing and what you&apos;re aiming for. Your
        plan is built around both.
      </p>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            target_exam_date: date === "" ? null : date,
            target_score: score === "" ? null : Number(score),
          });
        }}
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <label className={FIELD_LABEL}>
            Test date
            <input
              type="date"
              value={date}
              {...(maxTestDate === null ? {} : { max: maxTestDate })}
              onChange={(event) => setDate(event.target.value)}
              className={FIELD_INPUT}
              data-testid="calendar-free-test-date"
            />
          </label>
          <label className={FIELD_LABEL}>
            Target score
            <input
              type="number"
              inputMode="numeric"
              min={SCORE_MIN}
              max={SCORE_MAX}
              step={SCORE_STEP}
              value={score}
              onChange={(event) => setScore(event.target.value)}
              className={FIELD_INPUT}
              data-testid="calendar-free-target"
            />
          </label>
        </div>
        {error === null ? null : (
          <p
            className="m-0 text-lyc-body text-lyc-danger"
            role="alert"
            data-testid="calendar-free-error"
          >
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="lyc-primary"
          size="lyc-lg"
          className="self-start"
          disabled={pending}
          data-testid="calendar-free-save"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
    </section>
  );
}

function PlanUpsellCard({ reason }: { reason: "plan" | "age" }): JSX.Element {
  const [, navigate] = useLocation();
  return (
    <section
      aria-labelledby="calendar-upsell-h"
      className="flex flex-col gap-3.5 rounded-lg border border-lyc-rule px-5 py-7 sm:px-8"
      data-testid="calendar-plan-upsell"
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
        className="text-lyc-ink-strong"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v10H5z" />
      </svg>
      <h2
        id="calendar-upsell-h"
        className="m-0 font-lyc-serif text-[24px] font-semibold text-lyc-ink-strong"
      >
        Your day-by-day plan
      </h2>
      <p className="m-0 text-[17px] leading-relaxed text-lyc-ink">
        A week-by-week schedule of practice, review and full-length tests, built
        around your test date and what you need most. It updates itself every
        week.
      </p>
      {reason === "plan" ? (
        <Button
          type="button"
          variant="lyc-outline"
          className="self-start"
          onClick={() => navigate(UPGRADE_PLANS_DESTINATION)}
          data-testid="calendar-see-plans"
        >
          {UPGRADE_MODAL_SHARED_COPY.primaryLabel}
        </Button>
      ) : (
        <p
          className="m-0 text-lyc-body text-lyc-muted"
          data-testid="calendar-upsell-age"
        >
          {UPGRADE_MODAL_AGE_BODY}
        </p>
      )}
    </section>
  );
}
