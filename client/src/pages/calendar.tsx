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
import { useCallback, useMemo, useState } from "react";
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
  usePrefetchAdjacentRange,
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
import { membersCleared } from "@/features/calendar/lib/members";
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

  /**
   * The VIEW and CURSOR are the state; the range is derived. It used to be the other way
   * round — `setRange(rangeForView(...))` threw the view and cursor away the moment they
   * arrived — which left nothing to name the week either side with, and so nothing to
   * prefetch. Deriving costs one `useMemo` and keeps the two in step by construction.
   */
  const [view, setView] = useState<"week" | "month">("week");
  const [cursor, setCursor] = useState(() => startOfWeek(today));
  const range = useMemo(() => rangeForView(view, cursor), [view, cursor]);

  const calendar = useCalendar(range.from, range.to);

  // §17.7. Warm the neighbouring ranges once the browser is idle, so the NEXT arrow press
  // has its rows already. Held back while this range is still resolving or has failed —
  // see the hook's note.
  usePrefetchAdjacentRange(view, cursor, {
    enabled: calendar.isSuccess,
  });
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
    (nextView: "week" | "month", nextCursor: string) => {
      setView(nextView);
      setCursor(nextCursor);
    },
    [],
  );

  /**
   * §12.1 `profile_change` regenerates future non-overridden dates in `auto` mode ONLY --
   * `regenerateAfterProfileChange` returns null for a `custom` student, deliberately, because
   * silently replanning someone who turned the planner off would be the planner ignoring
   * them. The response says which happened: it carries a version number when it regenerated
   * and does not when it did not.
   *
   * So the offer is driven by the RESPONSE, not by re-deriving the mode on the client. A
   * client that decided "custom, therefore it planned nothing" would be a second copy of the
   * server's rule, and would be wrong the moment the rule changed.
   */
  const [replanOffered, setReplanOffered] = useState(false);
  // §17.5: dismissing closes it for THIS visit only. It reopens next visit because no
  // profile exists — the reopen condition is the profile, never a stored "seen" flag.
  const [setupDismissed, setSetupDismissed] = useState(false);

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
        backHref="/dashboard"
        model={null}
        // Dismissed for this visit: the plan behind it un-blurs and nothing is saved. The
        // next mount asks the server again, gets `setup_required` again (no profile), and
        // opens again — which is the reopen rule, held by the data rather than by a flag.
        setup={
          setupDismissed
            ? undefined
            : {
                defaults: response.defaults,
                onSubmit: (body) => profile.mutate(body),
                // A free student reaches setup since SCL-130, and the last press shows them the
                // third panel instead of a plan. `setup_required` is served before the
                // entitlement gate, so reaching here says nothing about entitlement — the
                // premium denial the query already knows about does.
                entitled: response.entitled !== false,
                // Dismiss writes nothing. No profile exists, so the next visit opens it again —
                // which is §17.5's "reopens until a profile exists", not a nag.
                onDismiss: () => setSetupDismissed(true),
                onUpgrade: () => navigate("/upgrade"),
                pending: profile.isPending,
                // `toUserFacingMessage` returns { title, message }; the sheet shows the sentence.
                error:
                  profile.error === null
                    ? null
                    : toUserFacingMessage(profile.error).message,
              }
        }
        today={today}
        viewer="student"
        viewerName={user?.display_name ?? "Your plan"}
        targetExamDate={null}
        // Pre-setup: there is no profile yet, so there is no target. The header says
        // "Set a target" rather than showing a slot the student cannot explain.
        targetScore={null}
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
      backHref="/dashboard"
      model={model}
      today={today}
      viewer="student"
      viewerName={user?.display_name ?? "Your plan"}
      targetExamDate={response.profile.target_exam_date}
      targetScore={response.profile.target_score}
      // Doc 05C's rows, straight off the response. The header sums them; nothing here
      // touches them.
      projection={response.projection}
      streak={streak.data ?? response.streak}
      planUpdate={
        change === null
          ? null
          : { versionNo: change.version_no, trigger: change.trigger }
      }
      onRangeChange={onRangeChange}
      schedule={{
        profile: response.profile,
        // §8.1's bounds, straight off the payload -- the SAME object the server validates
        // the save against. Never a literal preset list in the client.
        bounds: response.bounds,
        estimates: response.estimates,
        onSave: (draft) =>
          profile.mutate(
            newIntent({
              timezone: draft.timezone,
              study_days_mask: draft.study_days_mask,
              daily_minutes: draft.daily_minutes,
              target_exam_date: draft.target_exam_date,
              target_score: draft.target_score,
              full_length_weekday: draft.full_length_weekday,
              planner_mode: draft.planner_mode,
            }),
            {
              onSuccess: (result) =>
                // No version number means nothing was replanned, which in practice means a
                // `custom` student. Offer, never act.
                setReplanOffered(result.version_no === undefined),
            },
          ),
        pending: profile.isPending,
        error:
          profile.error === null
            ? null
            : toUserFacingMessage(profile.error).message,
        offerReplan: replanOffered,
        onConfirmReplan: () => {
          regeneratePlan.mutate(newIntent({}));
          setReplanOffered(false);
        },
        onDismissReplan: () => setReplanOffered(false),
      }}
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
        // §12.4: blocking out a day is an edit to an empty member list, not a status of
        // its own. No optimistic hint -- the prediction would have to guess which blocks
        // the server carries (V-12), and guessing wrong would flash the wrong day at the
        // student. The settle-invalidate brings back what actually happened.
        blockOutDay: (date) =>
          editDay.mutate(newIntent({ date, members: membersCleared() })),
        doItNow: (blockId) => doItNow.mutate(newIntent({ blockId, today })),
        launch: (blockId, blockType) => void launch(blockId, blockType),
        // §12.7 is monotonic, so this route takes no idempotency key.
        acknowledge: (versionNo) =>
          acknowledge.mutate({ version_no: versionNo }),
        refreshPending: regeneratePlan.isPending,
        launchPending,
      }}
    />
  );
}
