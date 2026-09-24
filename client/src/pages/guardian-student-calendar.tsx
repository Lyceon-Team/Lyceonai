/**
 * @spec [Doc_05F_Study_Calendar, §16 guardian read (R-08-22), §17.5 states]
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
 * and the explanation copy has no key to be looked up from. `guardian-calendar.tree.test.tsx`
 * walks the rendered tree and asserts exactly that.
 *
 * NO TARGET SCORE ANYWHERE. R-08-22 and §16: the guardian payload has no profile at all, so
 * there is no exam date for the countdown either. `targetExamDate` is null, and the top bar
 * renders no countdown rather than a zero.
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
      targetExamDate={null}
      // §16 withholds the target score from a guardian, as it withholds the controls and
      // the explanation copy. No projection either: the guardian payload does not carry
      // Doc 05C's rows, so the header renders its absence copy rather than a stale band.
      targetScore={null}
      streak={calendar.data.streak}
      planUpdate={null}
      onRangeChange={onRangeChange}
    />
  );
}
