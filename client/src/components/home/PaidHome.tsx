/**
 * Home for a student with the paid features (DESIGN.md §4 Home, "Paid").
 *
 * @spec [DESIGN.md §4 Home; prototype Main.dc.html (plan = paid); evidence/wiring-table.md §3
 *        Home; Doc 05F §15 (GET /api/calendar, POST /api/calendar/blocks/:id/launch), §15.1
 *        (launch); register §2 (mastery_level only; one primary action; no bank counts, no raw
 *        accuracy), OQ-22 (criteria), OQ-23 (recent sessions from /api/review/pool)]
 *        | @implemented [2026-10-03]
 *
 * plain English: the main column is the greeting and date line, today's plan from the calendar
 * with "Start today's plan" as the ONE primary action (it launches the first block of the day
 * that is not done; each row has its own outline Start), the "Start a full-length test" card
 * (owner ruling, Karl, 2026-10-05; FullLengthCard.tsx), Mastery as wide rows, and "Pick up
 * where you left off" (open practice, review and full-length sessions; the diagnostic is
 * dropped, wiring table §3). The right panel is the projected score with the target, this week's
 * seven days, and recent sessions.
 *
 * READS. One calendar read covers Monday to Sunday of the current week: today's row and the
 * week strip are the same payload, so they cannot disagree. Every read here is one the paid
 * plan is entitled to; this component is only rendered when the feature-access map says so
 * (`lyceon-dashboard.tsx`), so a free student never calls a gated route from Home.
 *
 * REVIEW CAP (owner re-test, Karl, 2026-10-08, item A) | @implemented [2026-10-08]: a "Recent
 * sessions" row whose review start the server refuses for the concurrent-session cap draws the
 * shared `ReviewCapNotice` directly under that row (scrolled into view), with "Continue your open
 * session" and "End a session", the same as Review. It used to be a red line under the whole
 * list, below the fold at 1440 and 1024. Today's plan rows launch through the calendar, whose
 * route answers every engine refusal as `CALENDAR_ENGINE_ERROR` without the engine's code, so the
 * client cannot tell the cap there (handed to the calendar vertical).
 *
 * edge cases: a calendar with no setup shows "Set up your study calendar" (DESIGN.md §4
 * Settings wording) as the primary, linking to /calendar; a day with no blocks says the one
 * empty-day sentence, "No study planned" (`EMPTY_DAY_MESSAGE`, owner QA list 2026-10-07 item 15;
 * it said "Rest day", untrue of a day the student cleared); a day with every block done offers no primary; empty "Pick up" and
 * failed reads render nothing invented (the page shows one recovery notice).
 *
 * PHONE NOTICE (owner ruling, Karl, 2026-10-05, OQ-63: "show it for every full-length start on a
 * phone, including calendar-launched starts. One shared pre-start check"). A Today's plan start
 * whose block is a full-length one, and the "Pick up" row of a full-length sitting in progress,
 * go through `useFullLengthPhonePrecheck` BEFORE the launch request: on a phone the notice asks
 * first, and a cancelled start launches nothing. Practice and review starts never ask.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import type { CalendarReadyResponse } from "@lyceon/shared/calendar";
import type { ReviewPoolSourceSession } from "@lyceon/shared/review-schema";
import { displayFormName } from "@lyceon/shared/exam-form-display";
import { studentResourceUrl } from "@lyceon/shared/student-resources";
import { AppShellPanel } from "@/components/layout/app-shell";
import { MasteryRow } from "@/components/mastery/MasteryRow";
import {
  canonicalDomainNodes,
  masteryDomainHref,
} from "@/components/mastery/domain-nodes";
import { ReviewCapNotice } from "@/components/review/ReviewCapNotice";
import { Notice, PageHeader } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { EMPTY_DAY_MESSAGE } from "@/lib/empty-day";
import { STARTING_LABEL } from "@/lib/pending-copy";
import { useCalendar, useLaunchBlock } from "@/features/calendar/api";
import { primaryActionLabel } from "@/features/calendar/lib/blocks";
import { addDays, startOfWeek } from "@/features/calendar/lib/dates";
import { fetchExamForms } from "@/features/exam/api/exam-api";
import { examKeys } from "@/features/exam/api/keys";
import { isExamInProgress } from "@/features/exam/lib/tests-home-model";
import {
  useFullLengthPhonePrecheck,
  type FullLengthPhonePrecheck,
} from "@/features/exam/lib/useFullLengthPhonePrecheck";
import { useActiveSessions } from "@/hooks/useActiveSessions";
import { useHomeProjection } from "@/hooks/useHomeProjection";
import {
  reviewSessionHref,
  useActiveReviewSessions,
  useCreateReviewSession,
  useReviewPool,
  type ReviewStartFailure,
} from "@/hooks/useReview";
import { fetchMasteryDomains } from "@/lib/masteryApi";
import { sectionDisplayLabel } from "@shared/section-display";
import { FullLengthCard } from "./FullLengthCard";
import {
  ProjectionSection,
  RecentSessionsSection,
  WeekSection,
  recentRowKey,
} from "./HomePanel";
import {
  answeredLine,
  dateLine,
  firstOpenBlock,
  greetingLine,
  planRowView,
  planTotal,
  sessionTitle,
} from "./home-model";

const SECTION_H2 =
  "m-0 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong";
const TEXT_LINK =
  "text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline";

type PaidHomeProps = {
  studentId: string;
  name: string | null;
  today: string;
  hour: number;
  /** Full-Length is its own feature: its rows are read only when it is granted. */
  examGranted: boolean;
};

export function PaidHome({
  studentId,
  name,
  today,
  hour,
  examGranted,
}: PaidHomeProps): JSX.Element {
  const [, navigate] = useLocation();
  const monday = startOfWeek(today);
  const calendar = useCalendar(monday, addDays(monday, 6));
  const mastery = useQuery({
    queryKey: [studentResourceUrl(studentId, "masteryDomains")],
    queryFn: () => fetchMasteryDomains(studentId),
    enabled: studentId.length > 0,
  });
  const practice = useActiveSessions();
  const review = useActiveReviewSessions();
  const exams = useQuery({
    queryKey: examKeys.forms(),
    queryFn: fetchExamForms,
    enabled: examGranted,
  });
  const pool = useReviewPool();
  const projection = useHomeProjection(studentId);
  const { launch, pendingBlockId } = useLaunchBlock(navigate);
  const [launchFailed, setLaunchFailed] = useState(false);
  const precheck = useFullLengthPhonePrecheck();
  // QA item 14 (2026-10-07): a "Recent sessions" row reviews that session's open questions,
  // the same start as Review's "Redo a past session".
  const createReview = useCreateReviewSession();
  const [reviewing, setReviewing] = useState<string | null>(null);
  // QA2-A: the failure and the row it belongs to, so the review cap is drawn under that row.
  const [reviewFailure, setReviewFailure] = useState<{
    row: string;
    failure: ReviewStartFailure;
  } | null>(null);
  const reviewRecent = async (row: ReviewPoolSourceSession): Promise<void> => {
    setReviewing(row.source_session_id);
    setReviewFailure(null);
    const result = await createReview.startSession({
      mode: "session",
      filters: {
        source_engine: row.source_engine,
        source_session_id: row.source_session_id,
      },
    });
    if (result.ok) {
      navigate(reviewSessionHref(result.sessionId));
      return;
    }
    setReviewing(null);
    setReviewFailure({ row: recentRowKey(row), failure: result.failure });
  };
  const reviewCap =
    reviewFailure?.failure.kind === "session_limit" ? reviewFailure : null;

  const ready: CalendarReadyResponse | null =
    calendar.data?.status === "ready" ? calendar.data : null;
  const plan: PlanState | null =
    calendar.data?.status === "setup_required"
      ? { kind: "setup" }
      : ready !== null
        ? {
            kind: "ready",
            ready,
            blocks:
              ready.days.find((d) => d.local_date === today)?.blocks ?? [],
          }
        : null;

  const start = async (block: Block): Promise<void> => {
    setLaunchFailed(false);
    const outcome = await launch(block.block_id, block.block_type);
    if (outcome.kind === "failed") setLaunchFailed(true);
  };
  // OQ-63: a full-length block asks the shared phone pre-start check before the launch.
  const startChecked = (block: Block): void => {
    if (block.block_type === "full_length")
      precheck.run(() => void start(block));
    else void start(block);
  };

  const failed =
    calendar.isError ||
    mastery.isError ||
    practice.isError ||
    review.isError ||
    exams.isError ||
    pool.isError ||
    projection.isError;

  const retry = (): void => {
    void calendar.refetch();
    void mastery.refetch();
    void practice.refetch();
    review.refetch();
    void exams.refetch();
    pool.refetch();
    projection.refetch();
  };

  const resumeRows: ResumeRow[] = [
    ...practice.sessions
      .filter((s) => s.mode !== "diagnostic")
      .map(
        (s): ResumeRow => ({
          key: `practice:${s.id}`,
          title: sessionTitle("practice", s.criteria, s.section),
          progress: { answered: s.answered_items, total: s.total_items },
          href: `/practice/session/${s.id}`,
          fullLength: false,
        }),
      ),
    ...review.sessions.map(
      (s): ResumeRow => ({
        key: `review:${s.id}`,
        title: sessionTitle("review", s.criteria, s.section),
        progress: { answered: s.answered_items, total: s.total_items },
        href: reviewSessionHref(s.id),
        fullLength: false,
      }),
    ),
    ...(exams.data?.forms ?? []).flatMap((f): ResumeRow[] =>
      f.latest_session !== null && isExamInProgress(f.latest_session.state)
        ? [
            {
              key: `exam:${f.latest_session.session_id}`,
              title: displayFormName(f.name),
              progress: null,
              href: `/tests/${f.latest_session.session_id}`,
              fullLength: true,
            },
          ]
        : [],
    ),
  ];

  return (
    <div className="flex flex-col gap-12" data-testid="home" data-plan="paid">
      <PageHeader
        title={greetingLine(hour, name)}
        description={dateLine(today, ready?.profile.target_exam_date ?? null)}
      />

      {failed ? (
        <Notice
          title="We couldn’t load part of your dashboard."
          message="Try again. If this keeps happening, refresh the page."
          actionLabel="Try again"
          onAction={retry}
          data-testid="home-load-error"
        />
      ) : null}

      {plan !== null ? (
        <TodayPlan
          plan={plan}
          pendingBlockId={pendingBlockId}
          launchFailed={launchFailed}
          onStart={startChecked}
        />
      ) : null}

      {/* Owner ruling (Karl, 2026-10-05) item 4: the full-length card, after today's plan. */}
      <FullLengthCard />

      {mastery.data !== undefined ? (
        <section
          aria-labelledby="home-mastery-h"
          className="flex flex-col gap-[22px]"
          data-testid="home-mastery"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 id="home-mastery-h" className={SECTION_H2}>
              Mastery
            </h2>
            <Link href="/mastery" className={TEXT_LINK}>
              See every skill
            </Link>
          </div>
          {(["M", "RW"] as const).map((section) => (
            <div key={section} className="flex flex-col">
              <h3 className="m-0 mb-1.5 text-base font-semibold text-lyc-muted">
                {sectionDisplayLabel(section)}
              </h3>
              <div className="border-t border-lyc-rule">
                {canonicalDomainNodes(mastery.data.domains, [section]).map(
                  (node) => (
                    <MasteryRow
                      key={`${node.section}:${node.domain}`}
                      label={node.domain}
                      levelKey={node.levelKey}
                      displayName={node.displayName}
                      variant="wide"
                      href={masteryDomainHref(node)}
                    />
                  ),
                )}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {resumeRows.length > 0 ? (
        <PickUp rows={resumeRows} onFullLengthClick={precheck.onLinkClick} />
      ) : null}
      {precheck.dialog}

      <AppShellPanel>
        <div className="flex flex-col gap-10" data-testid="home-panel">
          <ProjectionSection
            range={projection.range}
            stage="after"
            targetScore={ready?.profile.target_score ?? null}
          />
          {ready !== null ? (
            <WeekSection days={ready.days} today={today} />
          ) : null}
          <RecentSessionsSection
            sessions={pool.pool?.sessions ?? []}
            todayKey={today}
            onReview={(row) => void reviewRecent(row)}
            startingId={reviewing}
            failure={
              reviewFailure !== null && reviewCap === null
                ? reviewFailure.failure.message
                : null
            }
            capFor={reviewCap?.row ?? null}
            cap={
              reviewCap !== null ? (
                <ReviewCapNotice
                  message={reviewCap.failure.message}
                  sessions={review.sessions}
                />
              ) : null
            }
          />
        </div>
      </AppShellPanel>
    </div>
  );
}

type DayBlocks = CalendarReadyResponse["days"][number]["blocks"];
type Block = DayBlocks[number]["block"];

/** Today's plan: the calendar is not set up yet, or it is, with today's blocks. */
type PlanState =
  | { kind: "setup" }
  | { kind: "ready"; ready: CalendarReadyResponse; blocks: DayBlocks };

function TodayPlan({
  plan,
  pendingBlockId,
  launchFailed,
  onStart,
}: {
  plan: PlanState;
  pendingBlockId: string | null;
  launchFailed: boolean;
  onStart: (block: Block) => void;
}): JSX.Element {
  const total =
    plan.kind === "ready" ? planTotal(plan.blocks, plan.ready.estimates) : null;
  return (
    <section
      aria-labelledby="home-plan-h"
      className="flex flex-col gap-[18px]"
      data-testid="home-plan"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="home-plan-h" className={SECTION_H2}>
          Today&apos;s plan
        </h2>
        {total !== null ? (
          <span className="text-[17px] text-lyc-muted">{total}</span>
        ) : null}
      </div>
      {plan.kind === "setup" ? (
        <div>
          <Button asChild variant="lyc-primary" size="lyc-lg">
            <Link href="/calendar" data-testid="home-plan-setup">
              Set up your study calendar
            </Link>
          </Button>
        </div>
      ) : plan.blocks.length === 0 ? (
        <p
          className="m-0 border-t border-lyc-rule pt-5 text-[17px] text-lyc-muted"
          data-testid="home-plan-empty"
        >
          {EMPTY_DAY_MESSAGE}
        </p>
      ) : (
        <ReadyPlan
          blocks={plan.blocks}
          ready={plan.ready}
          pendingBlockId={pendingBlockId}
          launchFailed={launchFailed}
          onStart={onStart}
        />
      )}
    </section>
  );
}

function ReadyPlan({
  blocks,
  ready,
  pendingBlockId,
  launchFailed,
  onStart,
}: {
  blocks: DayBlocks;
  ready: CalendarReadyResponse;
  pendingBlockId: string | null;
  launchFailed: boolean;
  onStart: (block: Block) => void;
}): JSX.Element {
  const first = firstOpenBlock(blocks);
  // Which control started the pending launch: the primary and the first row launch the same
  // block, and only the one that was pressed shows "Starting…".
  const [startedFromPrimary, setStartedFromPrimary] = useState(false);
  const primaryPending =
    first !== null && pendingBlockId === first.block_id && startedFromPrimary;
  return (
    <>
      <ol className="m-0 list-none border-t border-lyc-rule p-0">
        {blocks.map((entry) => {
          const row = planRowView(entry, ready.estimates);
          const label = primaryActionLabel(entry);
          return (
            <li
              key={row.blockId}
              className="flex flex-col gap-3 border-b border-lyc-rule py-5 sm:grid sm:grid-cols-[minmax(0,1fr)_150px_110px] sm:items-center sm:gap-6"
              data-testid="home-plan-row"
            >
              <div className="flex flex-col gap-1">
                <span className="font-lyc-serif text-[21px] font-semibold text-lyc-ink-strong">
                  {row.title}
                </span>
                {row.detail !== null ? (
                  <span className="text-[17px] leading-[1.45] text-lyc-muted">
                    {row.detail}
                  </span>
                ) : null}
              </div>
              <span className="text-[17px] text-lyc-ink">{row.time ?? ""}</span>
              {/* QA item 5 (2026-10-07): the pressed row says it is starting, from the click. */}
              <Button
                type="button"
                variant="lyc-outline"
                disabled={row.completed || pendingBlockId !== null}
                pending={pendingBlockId === row.blockId && !startedFromPrimary}
                onClick={() => {
                  setStartedFromPrimary(false);
                  onStart(entry.block);
                }}
                aria-label={`${label}: ${row.title}`}
                data-testid="home-plan-start"
              >
                {pendingBlockId === row.blockId && !startedFromPrimary
                  ? STARTING_LABEL
                  : label}
              </Button>
            </li>
          );
        })}
      </ol>
      {launchFailed ? (
        <p role="alert" className="m-0 text-base text-lyc-danger">
          We couldn’t load this right now.
        </p>
      ) : null}
      {first !== null ? (
        <div>
          <Button
            type="button"
            variant="lyc-primary"
            size="lyc-lg"
            disabled={pendingBlockId !== null}
            pending={primaryPending}
            onClick={() => {
              setStartedFromPrimary(true);
              onStart(first);
            }}
            data-testid="home-start-plan"
          >
            {primaryPending ? STARTING_LABEL : "Start today's plan"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

type ResumeRow = {
  key: string;
  title: string;
  progress: { answered: number; total: number } | null;
  href: string;
  /** A full-length sitting: its Continue goes through the phone pre-start check (OQ-63). */
  fullLength: boolean;
};

function PickUp({
  rows,
  onFullLengthClick,
}: {
  rows: readonly ResumeRow[];
  onFullLengthClick: FullLengthPhonePrecheck["onLinkClick"];
}): JSX.Element {
  return (
    <section
      aria-labelledby="home-resume-h"
      className="flex flex-col gap-3.5"
      data-testid="home-resume"
    >
      <h2 id="home-resume-h" className={SECTION_H2}>
        Pick up where you left off
      </h2>
      <ul className="m-0 list-none border-t border-lyc-rule p-0">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-center justify-between gap-6 border-b border-lyc-rule py-4"
            data-testid="home-resume-row"
          >
            <div className="flex max-w-[420px] flex-grow flex-col gap-2">
              <span className="text-lg font-semibold text-lyc-ink">
                {row.title}
              </span>
              {row.progress !== null ? (
                <>
                  <div
                    className="h-1 rounded-sm bg-lyc-rule"
                    aria-hidden="true"
                  >
                    <div
                      className="h-1 rounded-sm bg-lyc-ink-strong"
                      style={{
                        width: `${row.progress.total > 0 ? (row.progress.answered / row.progress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-base text-lyc-muted">
                    {answeredLine(row.progress.answered, row.progress.total)}
                  </span>
                </>
              ) : null}
            </div>
            <Link
              href={row.href}
              className={TEXT_LINK}
              {...(row.fullLength
                ? { onClick: onFullLengthClick(row.href) }
                : {})}
            >
              Continue
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
