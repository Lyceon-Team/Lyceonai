/**
 * @spec [Doc_05F_Study_Calendar, §15 API surface, §17 UI contract, §16 entitlement]
 * @implemented [2026-09-23]
 *
 * plain English: the student's `/calendar` route. Expected outcome: it wires the data layer
 * to `CalendarView` and owns nothing else — no formatting, no plan logic, no fetching of
 * its own.
 *
 * WHAT THIS FILE IS RESPONSIBLE FOR. Choosing the visible range, branching on the four
 * §17.5 states (loading, 402, error, ready-or-pre-setup), and turning the view's callbacks
 * into mutations with one fresh idempotency key per intent. That is all — §17.7 keeps
 * business logic out of components and this is a component.
 *
 * edge cases: the 402 is checked BEFORE the error state. §16 makes the calendar premium for
 * the subject, so a free student's read fails by design; rendering the generic error card
 * with a Try-again button for an entitlement denial gives them a button that can never work.
 */
import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  calendarKeys,
  newIntent,
  useAcknowledge,
  useCalendar,
  useDoItNow,
  useEditDay,
  useLaunchBlock,
  useMoveBlock,
  useRegenerateDay,
  useRegeneratePlan,
  useResetDay,
  useStreak,
  useStudyProfileMutation,
} from "@/features/calendar/api";
import { CalendarView, type EditHint } from "@/features/calendar/CalendarView";
import {
  CalendarError,
  CalendarPremiumGate,
  CalendarSkeleton,
  isEntitlementDenial,
} from "@/features/calendar/components/CalendarStates";
import { rangeForView, startOfWeek } from "@/features/calendar/lib/dates";
import { studentViewModel } from "@/features/calendar/lib/view-model";
import { toUserFacingMessage } from "@/lib/api-error";
import "@/features/calendar/calendar.css";

/**
 * The student's local today. Derived from the device clock because the page has to choose a
 * range BEFORE the first response arrives — every rule that matters (what may be edited,
 * what may be moved, what may be launched) is enforced server-side against the profile
 * timezone, so a device clock one day out costs a re-render and never a wrong write.
 */
function localToday(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function CalendarPage(): JSX.Element {
  const today = localToday();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useSupabaseAuth();

  const [range, setRange] = useState(() =>
    rangeForView("week", startOfWeek(today)),
  );

  const calendar = useCalendar(range.from, range.to);
  const streak = useStreak();

  const editDay = useEditDay();
  const moveBlock = useMoveBlock();
  const regeneratePlan = useRegeneratePlan();
  const regenerateDay = useRegenerateDay();
  const resetDay = useResetDay();
  const doItNow = useDoItNow();
  const acknowledge = useAcknowledge();
  const profile = useStudyProfileMutation();
  const { launch, isPending: launchPending } = useLaunchBlock(navigate);

  const onRangeChange = useCallback(
    (view: "week" | "month", cursor: string) => {
      setRange(rangeForView(view, cursor));
    },
    [],
  );

  if (calendar.isLoading) return <CalendarSkeleton />;
  if (isEntitlementDenial(calendar.error)) return <CalendarPremiumGate />;
  if (calendar.isError || calendar.data === undefined) {
    return (
      <CalendarError
        error={calendar.error}
        onRetry={() =>
          void queryClient.invalidateQueries({
            queryKey: calendarKeys.ranges(),
          })
        }
      />
    );
  }

  const response = calendar.data;

  // Addendum item 26: pre-setup is a 200 carrying `defaults`, not a 404. The setup sheet
  // opens over a greyed sample week (§17.5), which is why the view still renders with a null
  // model rather than being replaced.
  if (response.status === "setup_required") {
    return (
      <CalendarView
        model={null}
        setup={{
          defaults: response.defaults,
          onSubmit: (body) => profile.mutate(body),
          pending: profile.isPending,
          // `toUserFacingMessage` returns { title, message }; the sheet shows the sentence.
          error:
            profile.error === null
              ? null
              : toUserFacingMessage(profile.error).message,
        }}
        today={today}
        viewerName={user?.display_name ?? "Your plan"}
        targetExamDate={null}
        streak={streak.data}
        planUpdate={null}
        onRangeChange={onRangeChange}
      />
    );
  }

  const model = studentViewModel(response);
  const change = response.latest_unacknowledged_nonstudent_change;

  return (
    <CalendarView
      model={model}
      today={today}
      viewerName={user?.display_name ?? "Your plan"}
      targetExamDate={response.profile.target_exam_date}
      streak={streak.data ?? response.streak}
      planUpdate={
        change === null
          ? null
          : { versionNo: change.version_no, trigger: change.trigger }
      }
      onRangeChange={onRangeChange}
      mutations={{
        // One fresh key per user intent; `newIntent` is the only minter, and TanStack reuses
        // the same variables object on retry, which is what makes a retry idempotent (§7.8).
        editDay: (date, members, hint: EditHint) =>
          editDay.mutate(
            newIntent({
              date,
              members,
              ...("removeBlockId" in hint && hint.removeBlockId === ""
                ? {}
                : {
                    optimisticBlocks:
                      "removeBlockId" in hint
                        ? { removeBlockId: hint.removeBlockId }
                        : { blockId: hint.blockId, edited: hint.edited },
                  }),
            }),
          ),
        moveBlock: (blockId, toDate) =>
          moveBlock.mutate(newIntent({ blockId, toDate })),
        regeneratePlan: () => regeneratePlan.mutate(newIntent({})),
        regenerateDay: (date) => regenerateDay.mutate(newIntent({ date })),
        resetDay: (date) => resetDay.mutate(newIntent({ date })),
        doItNow: (blockId) => doItNow.mutate(newIntent({ blockId, today })),
        launch: (blockId) => void launch(blockId),
        // §12.7 is monotonic, so this route takes no idempotency key.
        acknowledge: (versionNo) =>
          acknowledge.mutate({ version_no: versionNo }),
        refreshPending: regeneratePlan.isPending,
        launchPending,
      }}
    />
  );
}
