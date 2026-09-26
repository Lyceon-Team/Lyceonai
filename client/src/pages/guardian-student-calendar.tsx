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
 * edge cases: §17.5's guardian pre-setup state is a plain "Not set up yet" — a guardian
 * cannot run setup, so offering the sheet would be offering a control that cannot work.
 */
import { useCallback, useState } from "react";
import { useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { calendarKeys, useGuardianCalendar } from "@/features/calendar/api";
import { CalendarView } from "@/features/calendar/CalendarView";
import {
  CalendarError,
  CalendarPremiumGate,
  CalendarSkeleton,
  GuardianNotSetUp,
  isEntitlementDenial,
} from "@/features/calendar/components/CalendarStates";
import { rangeForView, startOfWeek } from "@/features/calendar/lib/dates";
import { guardianViewModel } from "@/features/calendar/lib/view-model";
import "@/features/calendar/calendar.css";

function localToday(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function GuardianStudentCalendarPage(): JSX.Element {
  const today = localToday();
  const [, params] = useRoute("/students/:studentId/calendar");
  const studentId = params?.studentId ?? "";
  const queryClient = useQueryClient();

  const [range, setRange] = useState(() =>
    rangeForView("week", startOfWeek(today)),
  );
  const calendar = useGuardianCalendar(studentId, range.from, range.to);

  const onRangeChange = useCallback(
    (view: "week" | "month", cursor: string) => {
      setRange(rangeForView(view, cursor));
    },
    [],
  );

  if (calendar.isLoading) return <CalendarSkeleton />;
  // §16: guardian visibility is derived from link AND student entitlement, so a lapsed
  // student's calendar answers 402 to their guardian too.
  if (isEntitlementDenial(calendar.error)) return <CalendarPremiumGate />;
  if (calendar.isError || calendar.data === undefined) {
    return (
      <CalendarError
        error={calendar.error}
        onRetry={() =>
          void queryClient.invalidateQueries({
            queryKey: calendarKeys.guardianRanges(),
          })
        }
      />
    );
  }

  if (calendar.data.status === "setup_required") return <GuardianNotSetUp />;

  return (
    <CalendarView
      backHref="/guardian"
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
      planUpdate={null}
      onRangeChange={onRangeChange}
    />
  );
}
