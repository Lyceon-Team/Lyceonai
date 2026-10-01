/**
 * @spec [Doc_05F_Study_Calendar, §16 guardian read (R-08-22 REVERSED — SCL-173),
 *        §17.5 states]
 *       [Doc_05F_formula_sheet.md §8 item 14 — the route is /api/students/:studentId/calendar]
 * @implemented [2026-09-23]
 *
 * plain English: a guardian looking at a linked student's plan. Expected outcome: the same
 * screen the student sees, with nothing on it that writes.
 *
 * HOW READ-ONLY IS GUARANTEED HERE. This page renders `CalendarView` with NO `mutations`
 * prop and NO `setup` prop, and it feeds the view a `guardianViewModel`, whose blocks carry
 * `plan: null` and `explanations: []` and whose `controls` is `{ kind: "read_only" }`. So
 * there is no Start, Resume, Do-it-now, Remove, Move, edit field, Refresh, Regenerate or
 * drag handle to hide — the handlers those controls would need do not exist on this page,
 * and the explanation copy has no key to be looked up from. `guardian-readonly.tree.test.tsx`
 * walks the rendered tree and asserts exactly that.
 *
 * THE TARGET, THE TEST DATE AND THE BAND ARE SERVED — and this paragraph used to say the
 * exact opposite. Until 2026-09-26 it read "NO TARGET SCORE ANYWHERE … the guardian payload
 * has no profile at all", which was true when written and false the moment the fields landed
 * a few lines below. It is corrected rather than deleted because the reversal is the thing a
 * reader of this file most needs to know.
 *
 * §16 as amended (SCL-173) withholds "no controls, no explanation copy, and no profile beyond
 * `target_score` and `target_exam_date`". TWO clauses had to move, not one: R-08-22 named the
 * target score, and the separate "no profile" clause independently caught the exam date,
 * since that is a `student_study_profile` column (Doc 05F §7.1) named inside §10.1's plan
 * input `profile` object. The owner's reason covers both — a stated goal and a stated date
 * are facts about the goal, not controls.
 *
 * What is still withheld, and what this page therefore cannot pass on even by accident: the
 * timezone, the study-day mask, the daily minutes, the exam weekday and the planner mode.
 * They are not on the payload, so there is nothing here to forward.
 *
 * edge cases: §17.5's guardian pre-setup state says, naming the student, that they have not
 * set up a plan yet — a guardian cannot run setup, so offering the sheet would be offering a
 * control that cannot work. Every non-plan state is the guardian surface's shared one
 * (G4-06, `features/guardian/GuardianStates.tsx`).
 */
import { useCallback, useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { calendarKeys, useGuardianCalendar } from "@/features/calendar/api";
import { CalendarView } from "@/features/calendar/CalendarView";
import { CalendarSkeleton } from "@/features/calendar/components/CalendarStates";
import {
  GuardianNotSetUpState,
  GuardianReadFailureState,
  possessive,
  useCurrentStudentName,
  useGuardianReadFailure,
} from "@/features/guardian/GuardianStates";
import {
  browserLocalToday,
  rangeForView,
  startOfWeek,
} from "@/features/calendar/lib/dates";
import { guardianViewModel } from "@/features/calendar/lib/view-model";
import "@/features/calendar/calendar.css";

export default function GuardianStudentCalendarPage(): JSX.Element {
  const today = browserLocalToday();
  // G4-01: the student comes from whichever route mounts this page
  // (`/guardian/:studentId/calendar`); the retired `/students/:id/calendar` redirects there.
  const { studentId = "" } = useParams<{ studentId?: string }>();
  const queryClient = useQueryClient();

  const [range, setRange] = useState(() =>
    rangeForView("week", startOfWeek(today)),
  );
  const calendar = useGuardianCalendar(studentId, range.from, range.to);

  /**
   * G3-04 / G4-06: a 404 here means the link is gone — the student's cached reads are dropped
   * and the roster refetched, once per student, inside `useGuardianReadFailure`; the layout
   * then shows the revoked state. A 402 is the lapsed state, named, with the guardian's own
   * call to action (never the student-facing upgrade card this page used to show).
   */
  const name = useCurrentStudentName();
  const failure = useGuardianReadFailure(studentId, calendar.error);

  const onRangeChange = useCallback(
    (view: "week" | "month", cursor: string) => {
      setRange(rangeForView(view, cursor));
    },
    [],
  );

  if (calendar.isLoading) return <CalendarSkeleton hideBrand />;
  if (failure !== null || calendar.data === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <GuardianReadFailureState
          failure={failure ?? "error"}
          name={name}
          studentId={studentId}
          what={`${possessive(name)} calendar`}
          onRetry={() =>
            void queryClient.invalidateQueries({
              queryKey: calendarKeys.guardianRanges(),
            })
          }
        />
      </div>
    );
  }

  if (calendar.data.status === "setup_required") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <GuardianNotSetUpState name={name} />
      </div>
    );
  }

  return (
    <CalendarView
      backHref="/guardian"
      // G4-04: the calendar is a tab inside the guardian shell; the Dashboard is its neighbour.
      hideBackLink
      model={guardianViewModel(calendar.data)}
      today={today}
      viewerName="Study plan"
      // The absence copy only. Every populated readout is identical to the student's.
      viewer="guardian"
      // §16 as amended by the owner ruling of 2026-09-26: R-08-22 is reversed and the "no
      // profile" clause is narrowed to admit exactly these two fields. The target is the
      // student's stated goal and a projection with nothing to compare against is half a
      // fact; the exam date is the other half of "N days to test". Everything else on the
      // profile — timezone, day mask, daily minutes, exam weekday, planner mode — is still
      // withheld, and the payload does not carry it, so this page cannot pass it on.
      targetExamDate={calendar.data.target_exam_date}
      targetScore={calendar.data.target_score}
      // Doc 05C's rows, as served. `projectedRange` sums them and contains no arithmetic
      // but `+` (enforced by scripts/ci/calendar-projection-gate.mjs), so the band a parent
      // reads is the band the student reads.
      projection={calendar.data.projection}
      streak={calendar.data.streak}
      // Owner ruling 2026-09-26: "Guardians see the suppression. It's a fact about the plan,
      // not a control and not a profile field — the same category as the projection and the
      // test date... withholding it would rebuild the defect on the guardian side." The COPY
      // differs (a statement, no CTA) and `CalendarView` selects it off `viewer`; this page
      // passes the dates and nothing else.
      fullLengthSuppressions={calendar.data.full_length_suppressions}
      planUpdate={null}
      onRangeChange={onRangeChange}
    />
  );
}
