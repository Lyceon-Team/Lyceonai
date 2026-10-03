/**
 * @spec [Doc_05F_Study_Calendar, §15 API surface, §17 UI contract, §16 entitlement;
 *        student-UI register UI-55, §2 Free versus paid (Step 2 ruling 3; SCL-130; calendar
 *        denials stay 402 flat; SCL-185), OQ-25, OQ-29, OQ-37, OQ-49; DESIGN.md §4 Calendar]
 * @implemented [2026-09-23; UI-55 2026-10-03]
 *
 * plain English: the student's `/calendar` route. Expected outcome: it wires the data layer
 * to `CalendarView` (paid) or `FreeCalendar` (free) and owns nothing else — no formatting, no
 * plan logic, no fetching of its own.
 *
 * WHAT THIS FILE IS RESPONSIBLE FOR. Deciding free or paid, choosing the visible range,
 * branching on the §17.5 states (loading, error, pre-setup, ready), and turning the view's
 * callbacks into mutations with one fresh idempotency key per intent. That is all — §17.7
 * keeps business logic out of components and this is a component.
 *
 * FREE OR PAID (UI-55). The feature-access map on `GET /api/profile` (OQ-29) says which, as it
 * does for the rail's lock. A free student's page reads the study profile through the UNGATED
 * `GET /api/calendar/profile` (OQ-25) and never asks for the plan: once a profile exists the
 * plan read can only answer 402. Before the first save it reads `GET /api/calendar` once for
 * the server's setup `defaults` (served before the entitlement gate, SCL-130; it carries no
 * plan), because the profile route refuses a first write without study days and minutes. The
 * server still decides: a paid read that comes back as the calendar's 402 (a map that went
 * stale, a lapse) renders the free page too, and a setup answer marked `entitled: false`
 * does the same.
 *
 * THE UPGRADE MODAL NEVER OPENS HERE BY ITSELF. Every calendar read and write carries
 * `ENTITLEMENT_DENIAL_INLINE_META` (UI-44, ruling 3), so a 402 renders this page's own upsell.
 *
 * edge cases: while `GET /api/profile` is still loading, nothing is read: guessing paid would
 * spend a gated request on a free student. A profile read that fails leaves no map, and the
 * page reads the plan and lets the server answer (a 402 still lands on the free page).
 */
import { useCallback, useMemo, useState } from "react";
import type { ProfileUpsertResponse } from "@lyceon/shared";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useProfileQuery } from "@/hooks/useProfileQuery";
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
  useStudyProfile,
  useStudyProfileMutation,
  type StudyProfileFields,
} from "@/features/calendar/api";
import { CalendarView, type EditHint } from "@/features/calendar/CalendarView";
import {
  CalendarError,
  StudentCalendarSkeleton,
  isEntitlementDenial,
} from "@/features/calendar/components/CalendarStates";
import {
  FreeCalendar,
  type FreeGoal,
} from "@/features/calendar/components/FreeCalendar";
import {
  addDays,
  browserLocalToday,
  rangeForView,
  startOfWeek,
} from "@/features/calendar/lib/dates";
import { membersCleared } from "@/features/calendar/lib/members";
import { openingSchedule } from "@/features/calendar/lib/setup";
import { studentViewModel } from "@/features/calendar/lib/view-model";
import { toUserFacingMessage } from "@/lib/api-error";
import "@/features/calendar/calendar.css";
import "@/features/calendar/calendar-student.css";

export default function CalendarPage(): JSX.Element {
  /**
   * The student's local today. Derived from the device clock because the page has to choose a
   * range BEFORE the first response arrives — every rule that matters (what may be edited,
   * what may be moved, what may be launched) is enforced server-side against the profile
   * timezone, so a device clock one day out costs a re-render and never a wrong write.
   */
  const today = browserLocalToday();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useSupabaseAuth();

  // OQ-29: the map decides free or paid; nothing is read until the profile has answered.
  const profileQuery = useProfileQuery();
  const access = useFeatureAccess();
  const calendarAccess = access?.calendar_access ?? null;
  const lockedByMap = calendarAccess?.access === "locked";
  const lockReason =
    calendarAccess?.access === "locked" ? calendarAccess.reason : "plan";
  const decided = !profileQuery.isPending;

  /**
   * The VIEW and CURSOR are the state; the range is derived. It used to be the other way
   * round — `setRange(rangeForView(...))` threw the view and cursor away the moment they
   * arrived — which left nothing to name the week either side with, and so nothing to
   * prefetch. Deriving costs one `useMemo` and keeps the two in step by construction.
   */
  const [view, setView] = useState<"week" | "month">("week");
  const [cursor, setCursor] = useState(() => startOfWeek(today));
  const range = useMemo(() => rangeForView(view, cursor), [view, cursor]);

  // The free page's read (OQ-25), for a student the map locks.
  const lockedProfile = useStudyProfile({ enabled: decided && lockedByMap });

  // The plan read: for a paid student; for a free one only before the first save, for the
  // setup defaults (SCL-130: served before the gate, no plan in it).
  const calendar = useCalendar(range.from, range.to, {
    enabled:
      decided &&
      (!lockedByMap ||
        (lockedProfile.isSuccess && lockedProfile.data.profile === null)),
  });
  const denied = isEntitlementDenial(calendar.error);

  // The same read (one cache entry, one request) for a student the SERVER refused with the
  // calendar's 402 although the map did not lock them (a stale map, a lapse).
  const studyProfile = useStudyProfile({
    enabled: decided && (lockedByMap || denied),
  });

  // §17.7. Warm the neighbouring ranges once the browser is idle, so the NEXT arrow press
  // has its rows already. Only once the current range is a READY plan: a free student's
  // pre-setup answer has no neighbours worth reading.
  usePrefetchAdjacentRange(view, cursor, {
    enabled: calendar.isSuccess && calendar.data.status === "ready",
  });
  // Doc 05F §14: the streak is rendered on the calendar (INV-08-20: ungated).
  const streak = useStreak({ enabled: decided && !lockedByMap && !denied });

  const editDay = useEditDay();
  const moveBlock = useMoveBlock();
  const regeneratePlan = useRegeneratePlan();
  const regenerateDay = useRegenerateDay();
  const resetDay = useResetDay();
  const doItNow = useDoItNow();
  const acknowledge = useAcknowledge();
  const profile = useStudyProfileMutation();
  const { launch, isPending: launchPending } = useLaunchBlock(navigate);

  /**
   * THE ONE PROFILE SAVE PATH. Every surface that writes a profile goes through here — the
   * §17.5 setup popup, the §8.1 settings sheet and (UI-55) the free page's inline form —
   * because they used not to, and the difference was invisible until production showed it:
   * the sheet wrapped its draft in `newIntent`, setup called `profile.mutate(body)` with the
   * popup's answers, and a body without `idempotency_key` is refused by
   * `makeStudyProfileUpsertSchema` (§4.2). Every new student's FIRST save 400'd; every
   * existing student's edits worked. Eight consecutive 400s, zero rows in
   * `student_study_profile`, zero plan versions.
   *
   * One function, so there is one answer to "does a profile save carry a key" instead of
   * one per call site. The `newIntent` mint stays at the intent boundary — one press, one
   * key, reused across TanStack's retry of THAT press and never across two presses.
   */
  const saveProfile = useCallback(
    (
      fields: StudyProfileFields,
      options?: { onSuccess?: (result: ProfileUpsertResponse) => void },
    ): void => {
      profile.mutate(newIntent(fields), options);
    },
    [profile],
  );

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

  const profileError =
    profile.error === null ? null : toUserFacingMessage(profile.error).message;

  /**
   * The free page (DESIGN.md §4): the inline form saves through the one save path. Before the
   * first save the profile route needs the schedule half too (`REQUIRED_ON_CREATE`), so the
   * form's two answers travel with the opening schedule the setup popup would have saved
   * (`lib/setup`); once a profile exists, the two answers alone.
   */
  const renderFree = (
    freeProfile: Parameters<typeof FreeCalendar>[0]["profile"],
  ): JSX.Element => {
    const setupDefaults =
      calendar.data?.status === "setup_required"
        ? calendar.data.defaults
        : null;
    return (
      <FreeCalendar
        today={today}
        profile={freeProfile}
        reason={lockReason}
        maxTestDate={
          setupDefaults === null
            ? null
            : addDays(today, setupDefaults.target_exam_date_max_days)
        }
        onSave={(goal: FreeGoal) =>
          saveProfile(
            freeProfile === null && setupDefaults !== null
              ? { ...openingSchedule(setupDefaults), ...goal }
              : goal,
          )
        }
        pending={profile.isPending}
        error={profileError}
      />
    );
  };

  if (!decided) return <StudentCalendarSkeleton />;

  // ── Free, by the map (or by the server's 402) ────────────────────────────
  if (lockedByMap || denied) {
    if (studyProfile.isPending) return <StudentCalendarSkeleton />;
    if (studyProfile.isError) {
      return (
        <CalendarError
          error={studyProfile.error}
          onRetry={() =>
            void queryClient.invalidateQueries({
              queryKey: calendarKeys.profile(),
            })
          }
        />
      );
    }
    const freeProfile = studyProfile.data.profile;
    // Before the first save the setup defaults are needed; a free student's pre-setup read
    // answers `setup_required` (no plan). If the server says this student IS entitled, the
    // paid page below takes over.
    if (freeProfile === null && !denied) {
      if (calendar.isLoading) return <StudentCalendarSkeleton />;
      if (
        calendar.data?.status === "setup_required" &&
        calendar.data.entitled !== false
      ) {
        // fall through to the paid page's pre-setup state
      } else {
        return renderFree(freeProfile);
      }
    } else {
      return renderFree(freeProfile);
    }
  }

  // ── Paid ─────────────────────────────────────────────────────────────────
  if (calendar.isPending) return <StudentCalendarSkeleton />;
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

  // Addendum item 26: pre-setup is a 200 carrying `defaults`, not a 404. A free student's
  // pre-setup answer (`entitled: false`) gets the free page's inline form (DESIGN.md §4); a
  // paid student's gets the §17.5 popup over a greyed sample week, which is why the view still
  // renders with a null model rather than being replaced.
  if (response.status === "setup_required") {
    if (response.entitled === false) return renderFree(null);
    return (
      <CalendarView
        backHref="/dashboard"
        hideBackLink
        model={null}
        // Dismissed for this visit: the plan behind it un-blurs and nothing is saved. The
        // next mount asks the server again, gets `setup_required` again (no profile), and
        // opens again — which is the reopen rule, held by the data rather than by a flag.
        setup={
          setupDismissed
            ? undefined
            : {
                defaults: response.defaults,
                // Through the one save path, which is what mints the key. `answers()` is
                // the student's answers and nothing else — the popup does not know what an
                // idempotency key is, and should not.
                onSubmit: (answers) => saveProfile(answers),
                // Dismiss writes nothing. No profile exists, so the next visit opens it again —
                // which is §17.5's "reopens until a profile exists", not a nag.
                onDismiss: () => setSetupDismissed(true),
                pending: profile.isPending,
                error: profileError,
              }
        }
        today={today}
        viewer="student"
        viewerName={user?.display_name ?? "Your plan"}
        targetExamDate={null}
        // Pre-setup: there is no profile yet, so there is no target. The goal card says
        // "Set a target" rather than showing a slot the student cannot explain.
        targetScore={null}
        streak={streak.data}
        // Pre-setup there is no plan, so nothing can have been suppressed. Empty rather than
        // omitted: the prop is required, which is what stops a page forgetting it.
        fullLengthSuppressions={[]}
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
      hideBackLink
      model={model}
      today={today}
      viewer="student"
      viewerName={user?.display_name ?? "Your plan"}
      targetExamDate={response.profile.target_exam_date}
      targetScore={response.profile.target_score}
      // Doc 05C's rows, straight off the response. The goal card sums them; nothing here
      // touches them.
      projection={response.projection}
      streak={streak.data ?? response.streak}
      // Brief 14 Step 4 — the dates the generator refused to place a test on, straight off
      // the payload. The notice names them; nothing here re-derives which days are blocked.
      fullLengthSuppressions={response.full_length_suppressions}
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
        examPlanning: response.exam_planning,
        onSave: (draft) =>
          saveProfile(
            {
              timezone: draft.timezone,
              study_days_mask: draft.study_days_mask,
              daily_minutes: draft.daily_minutes,
              target_exam_date: draft.target_exam_date,
              target_score: draft.target_score,
              full_length_weekday: draft.full_length_weekday,
              // Both halves, always. `calendarProfileUpsertSchema` refuses a body that
              // names one and not the other (Brief 14 Step 2), so omitting this — as this
              // call site did until the pair landed — makes every schedule save that touches
              // the exam a 400 rather than a silent half-write. The sheet's own chips move
              // both halves together for the same reason.
              full_length_interval_weeks: draft.full_length_interval_weeks,
              planner_mode: draft.planner_mode,
            },
            {
              onSuccess: (result) =>
                // No version number means nothing was replanned, which in practice means a
                // `custom` student. Offer, never act.
                setReplanOffered(result.version_no === undefined),
            },
          ),
        pending: profile.isPending,
        error: profileError,
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
        // DESIGN.md §4: "Regenerate plan" (`POST /api/calendar/plan/regenerate`), one key
        // per press.
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
        regenerated: regeneratePlan.isSuccess,
        launchPending,
      }}
    />
  );
}
