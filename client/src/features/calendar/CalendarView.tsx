/**
 * @spec [Doc_05F_Study_Calendar, §17.1 layout, §17.5 states, §17.7 interaction rules,
 *        §12.2, §12.4, §12.6, §16 guardian read]
 * @implemented [2026-09-23]
 *
 * plain English: the calendar screen. Expected outcome: the approved prototype, backed by
 * the live API, for a student who can change their plan and for a guardian who can only
 * look at it.
 *
 * ONE COMPONENT, TWO SURFACES, AND THE DIFFERENCE IS DATA. The guardian page renders this
 * with `mutations: undefined`. Everything that writes — the Refresh control, the day menu,
 * the add affordance, drag-and-drop, the sheet's footer — is conditioned on that ONE value
 * being present, and the view model it is given has `controls: { kind: "read_only" }`,
 * `plan: null` on every block and `explanations: []`. So there is no Start button to hide:
 * there is no handler to build one from and no key to look copy up with.
 *
 * NO BUSINESS LOGIC LIVES HERE (Coding Standards §11.1). Dates come from `lib/dates`,
 * descriptions from `lib/blocks`, member lists from `lib/members`, copy from `copy/`, and
 * every server interaction from `api/`. This file decides what is on screen and nothing else.
 *
 * trade-offs: view (week/month) and cursor are `useState`, not URL state. §17.7 puts local
 * UI state in `useState` and keeps the query layer for server state; a student paging through
 * weeks is not navigating.
 *
 * TWO CHROMES (UI-55, 2026-10-03; student-UI register §2, DESIGN.md §4 Calendar). The grid,
 * the banners, the facts strip and the sheets are one tree for both surfaces. The FRAME
 * differs by `viewer`: the student calendar sits in the App shell, with a Canvas-style header
 * (Week/Month, Today, arrows; the range centred; Edit schedule and Regenerate plan) and the
 * mini month, goal card, schedule summary and Show filters in the shell's right panel
 * (`StudentChrome.tsx`); the guardian keeps `LeftRail` and `TopBar` inside `GuardianShell`,
 * unchanged. `viewer` already selects the absence copy; the frame is the same fact (whose
 * calendar, seen by whom), and every write control is still conditioned on `mutations`.
 * The student's test day is starred in the week, month and mini month (`testDate`).
 *
 * edge cases: switching Week↔Month inside the same month does NOT refetch — the month query
 * covers the week, TanStack serves the wider range from cache, and the grid slices it. That
 * is why `rangeForView` exists and why the query key carries the range.
 */
import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type {
  CalendarSetupDefaults,
  ExamPlanning,
  PlanBlock,
  PlanTrigger,
  PlanningEstimates,
  StreakSummary,
  StudyProfile,
  StudyProfileBounds,
} from "@lyceon/shared/calendar";
import type { SectionProjectionDto } from "@lyceon/shared";
import {
  daysBetween,
  monthGridDates,
  numericRangeLabel,
  rangeLabel,
  shiftDays,
  shiftMonths,
  shortDate,
  startOfMonth,
  startOfWeek,
  weekDates,
} from "./lib/dates";
import { isDraggable } from "./lib/blocks";
import {
  isValidMix,
  membersWithEdit,
  membersWithNewBlock,
  membersWithout,
} from "./lib/members";
import {
  blockAt,
  dayAt,
  type CalendarViewModel,
  type ViewBlock,
  type ViewDay,
} from "./lib/view-model";
import {
  ALL_TONES_VISIBLE,
  FactsStrip,
  FullLengthSuppressionNotice,
  LeftRail,
  PlanUpdatedBanner,
  TopBar,
  type ToneFilter,
} from "./components/Chrome";
import { WeekGrid } from "./components/WeekGrid";
import { MonthGrid } from "./components/MonthGrid";
import { BlockSheet, type BlockSheetActions } from "./components/BlockSheet";
import { CreateBlockSheet } from "./components/CreateBlockSheet";
import { DayStrip } from "./components/DayStrip";
import { useIsMobile } from "@/hooks/use-mobile";
import { AppShellPanel } from "@/components/layout/app-shell";
import {
  CalendarPanelColumn,
  GoalCard,
  MiniMonth,
  ScheduleSummary,
  ShowFilters,
  StudentCalendarHeader,
} from "./components/StudentChrome";
import type { DayActions } from "./components/DayMenu";
import { SetupPopup, type SetupAnswers } from "./components/SetupPopup";
import {
  SettingsSheet,
  scheduleSummary,
  type SettingsDraft,
} from "./components/SettingsSheet";

/**
 * Everything this screen can do to the server. A guardian caller passes `undefined`, which
 * is what removes every control — see the module note.
 */
export type CalendarMutations = {
  editDay: (
    date: string,
    members: ReturnType<typeof membersWithout>,
    hint: EditHint,
  ) => void;
  moveBlock: (blockId: string, toDate: string) => void;
  regeneratePlan: () => void;
  regenerateDay: (date: string) => void;
  resetDay: (date: string) => void;
  /** §12.4. A block-out is an edit to an EMPTY member list, not a status of its own. */
  blockOutDay: (date: string) => void;
  doItNow: (blockId: string) => void;
  /** The block type travels with it: the prefetch key differs per engine (§15.1). */
  launch: (blockId: string, blockType: PlanBlock["block_type"]) => void;
  acknowledge: (versionNo: number) => void;
  refreshPending: boolean;
  /** True once a plan regenerate has returned: the button says "Plan regenerated". */
  regenerated: boolean;
  launchPending: boolean;
};

export type EditHint =
  | { blockId: string; edited: NonNullable<ViewBlock["plan"]> }
  | { removeBlockId: string };

export type CalendarViewProps = {
  model: CalendarViewModel | null;
  /** Present only when the student has not set up. Never passed on the guardian surface. */
  setup?: {
    defaults: CalendarSetupDefaults;
    /**
     * `SetupAnswers` — the popup's OWN type, not `Record<string, unknown>`.
     *
     * The open record here is how the missing `idempotency_key` reached production. A
     * handler taking a wider parameter satisfies a narrower slot, so `SetupPopup`'s
     * `(answers: SetupAnswers) => void` passed straight into this prop and the shape was
     * erased on the way up: the page received "some object" and forwarded it to a mutation
     * that also took "some object". Three layers, each willing to carry anything, and
     * nothing between the student's answers and the wire that knew what the endpoint
     * requires. Naming the real type is what puts the compiler back in that gap.
     */
    onSubmit: (answers: SetupAnswers) => void;
    /** Dismiss saves nothing. It reopens next visit, because no profile exists yet. */
    onDismiss: () => void;
    pending: boolean;
    error: string | null;
  };
  today: string;
  /**
   * Passed straight to `TopBar`, where it selects the ABSENCE copy and nothing else. Required
   * for the reason given there: a defaulted viewer is forgettable, and forgetting it shows a
   * guardian actions they cannot take.
   */
  viewer: "student" | "guardian";
  viewerName: string;
  /** The student's exam date, for the countdown. Null when they have not set one. */
  targetExamDate: string | null;
  /**
   * §17.1's R1 slot. Null when the student has not set one — optional since SCL-130, so
   * null is the ordinary case rather than an edge one, and the header says "Set a target".
   */
  targetScore: number | null;
  /**
   * Doc 05C's section rows, PASSED THROUGH UNTOUCHED from `GET /api/calendar`. The header
   * sums them (`lib/projection`); nothing on this path re-derives a projection.
   */
  projection?: readonly SectionProjectionDto[];
  streak: StreakSummary | undefined;
  /**
   * Brief 14 Step 4 — `full_length_suppressions`, straight off the payload. Dates the
   * generator refused to place a practice test on because both the chosen weekday occurrence
   * and the +7-day alternative were blocked out.
   *
   * REQUIRED, not optional, and served on BOTH payloads (owner ruling 2026-09-26: the
   * guardian sees the suppression). An empty array is the ordinary case and renders nothing;
   * making it optional would let a page forget it and re-create the silence this brief ends.
   */
  fullLengthSuppressions: readonly string[];
  /** §17.4. Null when there is nothing unacknowledged. */
  planUpdate: { versionNo: number; trigger: PlanTrigger } | null;
  /** Called when the visible range changes, so the page can re-query. */
  onRangeChange: (view: "week" | "month", cursor: string) => void;
  /**
   * §17.3's settings sheet. Present only for a student, which is what keeps the schedule
   * card and the Edit schedule button off the guardian surface — §16 gives a guardian no
   * write path, and this is a write.
   */
  schedule?: {
    profile: StudyProfile;
    bounds: StudyProfileBounds;
    estimates: PlanningEstimates;
    /** §8.1's frequency readout: the lead window and the prefill cadence, both server-owned. */
    examPlanning: ExamPlanning;
    onSave: (draft: SettingsDraft) => void;
    pending: boolean;
    error: string | null;
    /** True once a save in `custom` mode has landed and planned nothing. */
    offerReplan: boolean;
    onConfirmReplan: () => void;
    onDismissReplan: () => void;
  };
  /**
   * Where the back control goes: `/dashboard` for a student, `/guardian` for a guardian.
   *
   * A PROP, NOT A BRANCH ON `readOnly`. This file's own rule — "the guardian difference is
   * in the props, not in a flag" — and it is load-bearing here rather than stylistic: the
   * two surfaces have genuinely different homes, so a flag would have to encode a route
   * mapping inside a view component that otherwise knows nothing about routing. Each page
   * names its own.
   */
  backHref: string;
  /** G4-04: the guardian Calendar tab hides "← Dashboard" (the Dashboard is the tab beside it). */
  hideBackLink?: boolean;
  mutations?: CalendarMutations;
};

export function CalendarView({
  model,
  setup,
  today,
  targetScore,
  projection,
  viewer,
  viewerName,
  targetExamDate,
  streak,
  fullLengthSuppressions,
  planUpdate,
  onRangeChange,
  schedule,
  backHref,
  hideBackLink = false,
  mutations,
}: CalendarViewProps): JSX.Element {
  const [view, setView] = useState<"week" | "month">("week");
  const [cursor, setCursor] = useState(() => startOfWeek(today));
  const [miniMonth, setMiniMonth] = useState(() => startOfMonth(today));
  const [filters, setFilters] = useState<ToneFilter>(ALL_TONES_VISIBLE);
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The date whose "+ Add block" is open, or null. §17.2: opening writes nothing. */
  const [addOnDate, setAddOnDate] = useState<string | null>(null);

  /**
   * §17.7 phone layout. Below `useIsMobile`'s breakpoint the week is ONE day plus a strip,
   * not seven columns behind a sideways swipe — see `DayStrip`'s note for the measurement.
   * Month stays a grid at every width: a month IS a grid, and collapsing it would leave
   * nothing to navigate with.
   */
  const isMobile = useIsMobile();
  const [agendaDate, setAgendaDate] = useState<string | null>(null);

  const readOnly = mutations === undefined;

  // §17.7 forbids `useEffect` for derived state, so the range is derived inline and the
  // parent is told about a change by the handlers that cause one.
  const dates = useMemo(
    () => (view === "week" ? weekDates(cursor) : monthGridDates(cursor)),
    [view, cursor],
  );

  /**
   * The open day: whatever the student last tapped, as long as the week still holds it.
   * Stepping the week resets to today when today is in view and to the first day
   * otherwise, so the agenda never shows a date the strip above it cannot reach.
   */
  const agendaDay =
    agendaDate !== null && dates.includes(agendaDate)
      ? agendaDate
      : dates.includes(today)
        ? today
        : (dates[0] ?? today);

  const move = useCallback(
    (nextView: "week" | "month", nextCursor: string) => {
      setView(nextView);
      setCursor(nextCursor);
      setMiniMonth(startOfMonth(nextCursor));
      onRangeChange(nextView, nextCursor);
    },
    [onRangeChange],
  );

  const dayFor = useCallback(
    (date: string): ViewDay | null =>
      model === null ? null : dayAt(model, date),
    [model],
  );

  const visible = useCallback(
    (block: ViewBlock) => filters[block.tone],
    [filters],
  );

  /**
   * Mirrors `calendar_move_block`'s refusals (§12.2) so an illegal drag never leaves the
   * pointer. The server still decides — the two clocks can disagree about "today" — which is
   * why the drop handler also handles a refusal coming back.
   */
  const canDrag = useCallback(
    (day: ViewDay, block: ViewBlock): boolean =>
      // The rule itself lives in `lib/blocks`, where it is unit-tested and where the sheet
      // and the grids all read it. A second copy here would be a second rule to keep in
      // step with `calendar_move_block`'s refusals.
      isDraggable({
        status: block.status,
        actual: block.actual,
        date: day.date,
        today,
        readOnly,
      }),
    [readOnly, today],
  );

  /**
   * §17.2's four day controls, built ONCE and handed to both grids. Two copies would be
   * two chances for Week and Month to offer different things on the same date.
   *
   * Undo is `resetDay`, not a second route: §12.1's day_reset is exactly "this date is the
   * generator's again", which is what undoing a day off means.
   */
  const dayActions: DayActions | undefined =
    mutations === undefined
      ? undefined
      : {
          onBlockOut: mutations.blockOutDay,
          onUndoBlockOut: mutations.resetDay,
          onRegenerateDay: mutations.regenerateDay,
          onResetDay: mutations.resetDay,
        };

  const sensors = useSensors(
    // A small activation distance so a tap that opens the sheet is not read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (mutations === undefined) return;
      const over = event.over;
      if (over === null) return;
      const toDate = (over.data.current as { date?: string } | undefined)?.date;
      const blockId = String(event.active.id);
      if (toDate === undefined) return;
      const found = model === null ? null : blockAt(model, blockId);
      if (found === null || found.day.date === toDate) return;
      if (toDate < today) return;
      mutations.moveBlock(blockId, toDate);
    },
    [model, mutations, today],
  );

  const opened = useMemo(
    () =>
      model === null || openBlockId === null
        ? null
        : blockAt(model, openBlockId),
    [model, openBlockId],
  );

  const sheetActions: BlockSheetActions | undefined = useMemo(() => {
    if (mutations === undefined || opened === null) return undefined;
    const { block, day } = opened;
    return {
      onEditMix: (mix) => {
        if (
          !isValidMix(mix) ||
          block.plan === null ||
          block.plan.block_type !== "practice"
        )
          return;
        const target = mix.reduce((sum, entry) => sum + entry.count, 0);
        const edited = {
          ...block.plan,
          target_count: target,
          scope: {
            level: "domain" as const,
            mix: mix.map((entry) => ({
              domain: entry.domain,
              count: entry.count,
              // The existing per-domain reason is kept where the domain is unchanged, so a
              // student adjusting a count does not erase the generator's explanation.
              explanation_key:
                block.plan?.block_type === "practice" &&
                block.plan.scope.level === "domain"
                  ? (block.plan.scope.mix.find(
                      (old) => old.domain === entry.domain,
                    )?.explanation_key ?? "student_choice")
                  : "student_choice",
            })),
          },
        };
        mutations.editDay(
          day.date,
          membersWithEdit(day, block.blockId, {
            scope: edited.scope,
            targetCount: target,
          }),
          { blockId: block.blockId, edited },
        );
      },
      onEditReviewCount: (count) => {
        // Narrowed rather than spread: `PlanBlock` is a discriminated union in which a
        // full_length block's `target_count` is the literal 1, so spreading the union and
        // overriding the count produces a shape that is not a `PlanBlock` at all.
        if (block.plan === null || block.plan.block_type !== "review") return;
        const edited = { ...block.plan, target_count: count };
        mutations.editDay(
          day.date,
          membersWithEdit(day, block.blockId, { targetCount: count }),
          { blockId: block.blockId, edited },
        );
      },
      onEditFullLength: (scope) => {
        // Same narrowing as the review arm: a full_length block's `target_count` is the
        // literal 1, so only this arm of the union may be spread.
        if (block.plan === null || block.plan.block_type !== "full_length")
          return;
        const edited = { ...block.plan, scope };
        mutations.editDay(
          day.date,
          membersWithEdit(day, block.blockId, { scope }),
          { blockId: block.blockId, edited },
        );
      },
      onRemove: () => {
        mutations.editDay(day.date, membersWithout(day, block.blockId), {
          removeBlockId: block.blockId,
        });
        setOpenBlockId(null);
      },
      onLaunch: () => {
        // `plan` is null only on the guardian surface, which has no onLaunch at all.
        if (block.plan === null) return;
        mutations.launch(block.blockId, block.plan.block_type);
      },
      onDoItNow: () => {
        mutations.doItNow(block.blockId);
        setOpenBlockId(null);
      },
      onMove: (toDate) => {
        mutations.moveBlock(block.blockId, toDate);
        setOpenBlockId(null);
      },
      launchPending: mutations.launchPending,
    };
  }, [mutations, opened]);

  const daysToTest =
    targetExamDate === null
      ? null
      : Math.max(0, daysBetween(today, targetExamDate));

  /** The student's test day, starred in the grids (UI-55). The guardian grid is unchanged. */
  const starredTestDate = viewer === "student" ? targetExamDate : null;

  const step = (delta: number): void => {
    if (view === "week") {
      move("week", startOfWeek(shiftDays(cursor, delta * 7)));
    } else {
      move("month", shiftMonths(cursor, delta));
    }
  };

  /**
   * The grid area — banners, the week or month grid, the facts strip — the SAME tree on both
   * surfaces. Only the chrome around it differs (below).
   */
  const gridArea = (
    <>
      {planUpdate !== null && mutations !== undefined ? (
        <PlanUpdatedBanner
          trigger={planUpdate.trigger}
          onDismiss={() => mutations.acknowledge(planUpdate.versionNo)}
        />
      ) : null}

      {/* The suppressed practice test, on both surfaces. The handler is passed for a
          STUDENT only — the component takes `viewer` as well, so the "statement, never an
          action" rule for a guardian holds even if a future caller passes a handler by
          mistake. Two locks, because the copy rule and the control rule are both the
          owner's 2026-09-26 ruling and neither is a style choice. */}
      <FullLengthSuppressionNotice
        viewer={viewer}
        dates={fullLengthSuppressions}
        {...(viewer === "student"
          ? {
              onGoToWeek: (date: string) => {
                move("week", startOfWeek(date));
                setAgendaDate(date);
              },
            }
          : {})}
      />

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="scroll">
          {view === "week" && isMobile ? (
            <>
              <DayStrip
                dates={dates}
                selected={agendaDay}
                today={today}
                hasWork={(date) => (dayFor(date)?.blocks.length ?? 0) > 0}
                onSelect={setAgendaDate}
              />
              {/* The SAME WeekGrid, given one date. Every affordance a column carries —
                  the droppable, the day menu, the block cards, "+ Add block" — comes
                  with it, so the phone layout cannot drift from the desktop one. */}
              <WeekGrid
                dates={[agendaDay]}
                dayFor={dayFor}
                today={today}
                visible={visible}
                canDrag={canDrag}
                onOpen={setOpenBlockId}
                {...(dayActions === undefined ? {} : { dayActions })}
                {...(mutations === undefined
                  ? {}
                  : { onAddBlock: (date: string) => setAddOnDate(date) })}
                {...(starredTestDate === null
                  ? {}
                  : { testDate: starredTestDate })}
              />
            </>
          ) : view === "week" ? (
            <WeekGrid
              dates={dates}
              dayFor={dayFor}
              today={today}
              visible={visible}
              canDrag={canDrag}
              onOpen={setOpenBlockId}
              {...(dayActions === undefined ? {} : { dayActions })}
              {...(mutations === undefined
                ? {}
                : {
                    // §17.2: Add OPENS the create sheet. It writes nothing — the
                    // write happens on confirm, in `onCreate` below.
                    onAddBlock: (date: string) => setAddOnDate(date),
                  })}
              {...(starredTestDate === null
                ? {}
                : { testDate: starredTestDate })}
            />
          ) : (
            <MonthGrid
              dates={dates}
              cursor={cursor}
              dayFor={dayFor}
              today={today}
              visible={visible}
              canDrag={canDrag}
              onOpen={setOpenBlockId}
              {...(dayActions === undefined ? {} : { dayActions })}
              {...(starredTestDate === null
                ? {}
                : { testDate: starredTestDate })}
            />
          )}
        </div>
      </DndContext>

      {model === null ? null : <FactsStrip facts={model.facts} />}
    </>
  );

  /** Sheets and the setup popup: fixed-position, so they sit outside the blurred body. */
  const overlays = (
    <>
      {opened === null ? null : (
        <BlockSheet
          block={opened.block}
          day={opened.day}
          today={today}
          open
          onClose={() => setOpenBlockId(null)}
          {...(sheetActions === undefined ? {} : { actions: sheetActions })}
        />
      )}

      {addOnDate === null ||
      mutations === undefined ||
      model === null ||
      model.controls.kind !== "editable" ? null : (
        <CreateBlockSheet
          open
          date={addOnDate}
          enabledBlockTypes={model.controls.enabledBlockTypes}
          pending={false}
          onClose={() => setAddOnDate(null)}
          onCreate={(draft) => {
            const day = dayFor(addOnDate);
            if (day === null) return;
            mutations.editDay(
              addOnDate,
              membersWithNewBlock(day, draft),
              // No optimistic hint: a created block has no id to predict, and the
              // settle-invalidate brings back the server's version.
              { removeBlockId: "" },
            );
            setAddOnDate(null);
          }}
        />
      )}

      {schedule === undefined || !settingsOpen ? null : (
        <SettingsSheet
          profile={schedule.profile}
          bounds={schedule.bounds}
          estimates={schedule.estimates}
          examPlanning={schedule.examPlanning}
          today={today}
          onSave={schedule.onSave}
          onClose={() => setSettingsOpen(false)}
          pending={schedule.pending}
          error={schedule.error}
          replanOffer={
            schedule.offerReplan
              ? {
                  onConfirm: schedule.onConfirmReplan,
                  onDismiss: schedule.onDismissReplan,
                }
              : null
          }
        />
      )}

      {/* §17.5 — the popup renders OVER the plan (blurred), never instead of it: a
          student deciding whether to set up should be able to see what they are setting
          up. It is dismissible and nothing behind it is disabled. */}
      {setup === undefined ? null : (
        <SetupPopup
          defaults={setup.defaults}
          today={today}
          onSubmit={setup.onSubmit}
          onDismiss={setup.onDismiss}
          pending={setup.pending}
          error={setup.error}
        />
      )}
    </>
  );

  if (viewer === "student") {
    // UI-55: the App shell is the chrome. The header is a sibling of the `.lyceon-calendar`
    // grid root, not inside it, because that stylesheet resets every `button` inside its
    // root, which would strip the shared `Button`'s student variants.
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-testid="calendar-student"
      >
        <div
          className={`flex min-h-0 flex-1 flex-col${
            setup === undefined
              ? ""
              : " pointer-events-none select-none blur-[3px]"
          }`}
          data-testid="calendar-student-body"
        >
          <StudentCalendarHeader
            view={view}
            title={numericRangeLabel(view, cursor)}
            onView={(next) => move(next, cursor)}
            onToday={() => move("week", startOfWeek(today))}
            onStep={step}
            streak={streak}
            {...(schedule === undefined
              ? {}
              : { onEditSchedule: () => setSettingsOpen(true) })}
            {...(mutations === undefined
              ? {}
              : {
                  regenerate: {
                    onClick: mutations.regeneratePlan,
                    pending: mutations.refreshPending,
                    done: mutations.regenerated,
                  },
                })}
          />
          <div className="lyceon-calendar lyc-cal flex min-h-0 flex-1 flex-col">
            {gridArea}
          </div>
        </div>
        <div className="lyceon-calendar lyc-cal contents">{overlays}</div>
        <AppShellPanel>
          <CalendarPanelColumn>
            <MiniMonth
              month={miniMonth}
              onMonthStep={(delta) =>
                setMiniMonth(shiftMonths(miniMonth, delta))
              }
              today={today}
              weekStart={view === "week" ? startOfWeek(cursor) : null}
              testDate={targetExamDate}
              onPickDate={(date) => move("week", startOfWeek(date))}
            />
            <GoalCard
              today={today}
              testDate={targetExamDate}
              targetScore={targetScore}
              projection={projection ?? []}
            />
            {schedule === undefined ? null : (
              <ScheduleSummary
                // Derived from the profile and the served estimates, never stored — the
                // same function the sheet's live readout uses, so the panel and the sheet
                // cannot describe the same schedule differently.
                summary={scheduleSummary(schedule.profile, schedule.estimates, {
                  targetExamDate: schedule.profile.target_exam_date,
                  today,
                  // The one field the readout reads, named rather than spread: the
                  // prefill beside it on `examPlanning` is for the frequency control,
                  // not for this sentence.
                  finalExamLeadDays: schedule.examPlanning.final_exam_lead_days,
                })}
              />
            )}
            <ShowFilters
              filters={filters}
              onToggle={(tone, next) =>
                setFilters((prev) => ({ ...prev, [tone]: next }))
              }
            />
          </CalendarPanelColumn>
        </AppShellPanel>
      </div>
    );
  }

  // The guardian surface: its own rail and three-zone header inside `GuardianShell`,
  // unchanged by UI-55.
  return (
    <div className="lyceon-calendar">
      <div className="app">
        <LeftRail
          name={viewerName}
          subtitle={
            readOnly
              ? "Viewing only"
              : targetExamDate === null
                ? "No test date set"
                : `SAT · ${shortDate(targetExamDate)}`
          }
          miniMonth={miniMonth}
          cursor={cursor}
          today={today}
          hasWork={(date) => (dayFor(date)?.blocks.length ?? 0) > 0}
          filters={filters}
          onToggleFilter={(tone, next) =>
            setFilters((prev) => ({ ...prev, [tone]: next }))
          }
          onPickDate={(date) => move("week", startOfWeek(date))}
          onMonthStep={(delta) => setMiniMonth(shiftMonths(miniMonth, delta))}
          footer={
            readOnly ? "Read-only view" : "Your plan updates itself each week"
          }
        />

        <div className="main">
          <TopBar
            backHref={backHref}
            hideBackLink={hideBackLink}
            viewer={viewer}
            targetScore={targetScore}
            projection={projection}
            rangeLabelText={rangeLabel(view, cursor)}
            view={view}
            onView={(next) => move(next, cursor)}
            onStep={step}
            onToday={() => move("week", startOfWeek(today))}
            streak={streak}
            daysToTest={daysToTest}
          />
          {gridArea}
        </div>
      </div>
      {overlays}
    </div>
  );
}
