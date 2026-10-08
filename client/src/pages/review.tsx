/**
 * Review (`/review`): how much is waiting, and the ways into a review session.
 *
 * @spec [student-UI register UI-52, §8 F-52; DESIGN.md §1 (tokens only, 14px floor, one primary
 *        action), §2 (App shell: right panel, slim legal footer), §3 (Domain chips: counts from
 *        the student's own queue; Mastery row compact; Locked mastery card), §4 Review;
 *        prototype Review.dc.html (paid and free); evidence/wiring-table.md §6 Review (the
 *        endpoint behind each element); register §2 (free = unlimited review, SCL-110;
 *        mastery_level only; no raw accuracy; no bank counts), OQ-22 (sessions named by their
 *        criteria), OQ-24 ruling (no count: "Past sessions" with Load more), UI-16 (the picker's
 *        cursor), OQ-29 (the feature-access map decides what is locked), OQ-49 (this route
 *        comes off the light lock: route-shells.ts), OQ-51 ("Reading & Writing")]
 *        | @implemented [2026-10-03]
 *
 * plain English: the main column is the queue card ("N questions to review", Start reviewing,
 * the ONE primary action), the review sessions still open (named by their criteria, End and
 * Continue), "Review by topic" (a Section switch and domain chips counted from the student's own
 * queue; several domains may be chosen), and "Redo a past session", a collapsed list grouped by
 * day that shows five rows and then Load more (the server pages by cursor, 20 at a time). The
 * right panel is "What's waiting" by section and Mastery (compact rows on a paid plan, the
 * locked card on a free one).
 *
 * FREE PLAN = FULL REVIEW (SCL-110, register §2). Nothing on this page is gated except the
 * Mastery panel; every review read and every start is the same on both plans. Mastery is read
 * only when the feature-access map grants `mastery_detail`; otherwise the locked card opens the
 * upgrade modal in place with no request.
 *
 * Every count on the page comes from `GET /api/review/pool?tz=…` (the student's own queue and
 * their past sessions; no bank count). An empty queue is not an error (brief R4 §2.3): it shows
 * the shipped friendly empty state; only a pool that fails to load shows the error notice.
 * Abandoned sessions never appear (ruling 17; filtered server-side and in
 * `useActiveReviewSessions`).
 *
 * Replaces the pre-redesign page: the "Review Queue" eyebrow and "Review Your Mistakes" title,
 * the PageCard layout, the section Select with counts, the single-select domain and skill chips,
 * the "Review a past session" card with its "Show more sessions" button, the open-sessions card
 * with the Trash icon and mode badge, and the aside's "Total" row and "How review works" card.
 *
 * THE REVIEW CAP (owner re-test, Karl, 2026-10-08, item A) | @implemented [2026-10-08]: a start
 * the server refuses for the concurrent-session cap (`SESSION_LIMIT_EXCEEDED`, recognised by code
 * in `useCreateReviewSession`) is answered by `ReviewCapNotice` directly under the control that
 * was pressed (Start reviewing, the topic picker's start, or that past session's Redo), scrolled
 * into view, with "Continue your open session" and "End a session" (this page's own open
 * sessions, scrolled to and focused). It replaces the page-level limit notice and the starts
 * disabled at the limit: Karl asked for the refusal at the button the student pressed, which a
 * disabled button cannot be, and the server, not the client's copy of the open list, decides the
 * cap. `/review?focus=open-sessions` (`REVIEW_OPEN_SESSIONS_HREF`, Home's "End a session") opens
 * the page with the open sessions in view and focused.
 */
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { studentResourceUrl } from "@lyceon/shared/student-resources";
import type { PracticeTopicsResponse } from "@lyceon/shared/practice-reference-schema";
import type { ReviewPoolSourceSession } from "@lyceon/shared/review-schema";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { EmptyState } from "@/components/common/empty-state";
import {
  answeredLine,
  sessionTitle,
  toReviewLine,
} from "@/components/home/home-model";
import { AppShellPanel } from "@/components/layout/app-shell";
import { LockedMasteryCard } from "@/components/mastery/LockedMasteryCard";
import { MasteryRow } from "@/components/mastery/MasteryRow";
import {
  canonicalDomainNodes,
  masteryDomainHref,
} from "@/components/mastery/domain-nodes";
import {
  PAST_SESSIONS_STEP,
  domainChipLabel,
  hasMorePast,
  needsNextPage,
  queueHeadline,
  topicCount,
  topicCta,
  topicSummary,
  visiblePastGroups,
} from "@/components/review/review-landing-model";
import { ReviewCapNotice } from "@/components/review/ReviewCapNotice";
import { Modal, Notice, PageHeader } from "@/components/student-ui";
import {
  domainOptions,
  sectionOptions,
} from "@/components/student-ui/filter-bar/filter-cascade";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { usePracticeTopics } from "@/hooks/usePracticeTopics";
import {
  REVIEW_OPEN_SESSIONS_FOCUS,
  browserTimeZone,
  reviewSessionHref,
  useActiveReviewSessions,
  useCreateReviewSession,
  useReviewPool,
  type ReviewOpenSession,
  type ReviewStartFailure,
  type ReviewStartSpec,
} from "@/hooks/useReview";
import { fetchMasteryDomains, type MasterySection } from "@/lib/masteryApi";
import { STARTING_LABEL } from "@/lib/pending-copy";
import {
  localDateKey,
  sourceFiltersLine,
  sourceHeadline,
} from "@/lib/review-session-picker";
import { cn } from "@/lib/utils";
import { sectionDisplayLabel } from "@shared/section-display";

const SECTION_H2 =
  "m-0 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong";
const PANEL_H2 =
  "m-0 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong";
const TEXT_LINK =
  "text-[17px] font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline";
const ROW_LABEL = "w-[90px] shrink-0 text-[17px] font-semibold text-lyc-ink";

const MASTERY_SECTIONS: readonly MasterySection[] = ["M", "RW"];

/** Turn the flat facet list into a lookup so a chip or a panel row can show its own count. */
function facetMap(
  facets: ReadonlyArray<{ key: string; count: number }> | undefined,
): Map<string, number> {
  return new Map((facets ?? []).map((f) => [f.key, f.count]));
}

export default function ReviewPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const studentId = user?.id ?? "";
  const [, navigate] = useLocation();
  const access = useFeatureAccess();
  const upgrade = useUpgradeModal();
  const masteryAccess = access?.mastery_detail ?? null;
  const masteryGranted = masteryAccess?.access === "granted";

  const pool = useReviewPool();
  const open = useActiveReviewSessions();
  const create = useCreateReviewSession();
  const topics = usePracticeTopics();
  const mastery = useQuery({
    queryKey: [studentResourceUrl(studentId, "masteryDomains")],
    queryFn: () => fetchMasteryDomains(studentId),
    enabled: masteryGranted && studentId.length > 0,
  });

  const [startFailure, setStartFailure] = useState<ReviewStartFailure | null>(
    null,
  );
  // QA item 5 (2026-10-07): which start is in flight, so only the pressed control says
  // "Starting…" (every start is disabled meanwhile through `canStart`).
  const [starting, setStarting] = useState<string | null>(null);

  // "Today" in the SAME zone the server used to compute each row's local_date.
  const todayKey = useMemo(
    () => localDateKey(new Date(), browserTimeZone()),
    [],
  );

  const total = pool.pool?.total ?? 0;
  const bySection = useMemo(
    () => facetMap(pool.pool?.bySection),
    [pool.pool?.bySection],
  );
  const byDomain = useMemo(
    () => facetMap(pool.pool?.byDomain),
    [pool.pool?.byDomain],
  );

  // QA2-A: which start the last failure belongs to, so the cap is drawn at THAT control.
  const [failedKey, setFailedKey] = useState<string | null>(null);

  // QA2-A: "End a session" brings this page's open sessions (each with End) into view, focused.
  const openHeadingRef = useRef<HTMLHeadingElement>(null);
  const showOpenSessions = (): void => revealHeading(openHeadingRef.current);
  // `/review?focus=open-sessions` (Home's "End a session"): once, when the rows are drawn.
  const search = useSearch();
  const focusOpen =
    new URLSearchParams(search).get("focus") === REVIEW_OPEN_SESSIONS_FOCUS;
  const focusedOpen = useRef(false);
  const openRowsDrawn = open.sessions.length > 0;
  useEffect(() => {
    if (!focusOpen || !openRowsDrawn || focusedOpen.current) return;
    focusedOpen.current = true;
    revealHeading(openHeadingRef.current);
  }, [focusOpen, openRowsDrawn]);

  async function start(spec: ReviewStartSpec): Promise<void> {
    setStarting(reviewStartKey(spec));
    setStartFailure(null);
    const result = await create.startSession(spec);
    if (result.ok) {
      // The id goes in the URL, so refresh / back / new tab all resume (brief R4 §2.2).
      navigate(reviewSessionHref(result.sessionId));
      return;
    }
    setStarting(null);
    setFailedKey(reviewStartKey(spec));
    setStartFailure(result.failure);
  }

  // The server decides the cap (QA2-A): no start is disabled for it here.
  const canStart = !create.isStarting && starting === null;
  // QA2-A: the cap's refusal, and the start it is drawn under.
  const capKey = startFailure?.kind === "session_limit" ? failedKey : null;
  const cap =
    startFailure?.kind === "session_limit" ? (
      <ReviewCapNotice
        message={startFailure.message}
        sessions={open.sessions}
        onEndSession={showOpenSessions}
      />
    ) : null;
  const emptyQueue = (
    <EmptyState
      variant="lyc"
      headingLevel={3}
      title="Nothing to review yet"
      description="Questions you miss or skip in practice show up here."
      action={{ label: "Go to Practice", onClick: () => navigate("/practice") }}
      data-testid="review-empty-state"
    />
  );

  return (
    <div className="flex flex-col gap-10" data-testid="review">
      <PageHeader
        title="Review"
        description="Every question you miss or skip comes back here until you get it right."
      />

      {pool.isError ? (
        <Notice
          tone="danger"
          title="Couldn't load your review queue"
          message="Something went wrong fetching your queue. Your questions are safe — this is a display problem."
          actionLabel="Try again"
          onAction={() => pool.refetch()}
          data-testid="review-pool-error"
        />
      ) : (
        <>
          <section aria-labelledby="review-queue-h" data-testid="review-queue">
            {pool.isLoading ? (
              <Skeleton variant="lyc" className="h-[124px] w-full" />
            ) : total === 0 ? (
              emptyQueue
            ) : (
              <div className="flex flex-col gap-6 rounded-lg border border-lyc-rule bg-lyc-sheet px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-9 sm:py-8">
                <div className="flex flex-col gap-1.5">
                  <h2
                    id="review-queue-h"
                    className="m-0 font-lyc-serif text-[30px] font-semibold leading-tight text-lyc-ink-strong"
                    data-testid="review-queue-total"
                  >
                    {queueHeadline(total)}
                  </h2>
                  <p className="m-0 text-[17px] text-lyc-muted">
                    Oldest first, across both sections.
                  </p>
                  {pool.pool?.timezoneFallback === true ? (
                    <p
                      className="m-0 text-[15px] text-lyc-muted"
                      data-testid="review-tz-fallback"
                    >
                      Times are shown in UTC — your browser didn't report a
                      timezone.
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="lyc-primary"
                  size="lyc-lg"
                  className="shrink-0"
                  disabled={!canStart}
                  pending={starting === "queue"}
                  onClick={() => void start({ mode: "queue" })}
                  data-testid="button-start-queue"
                >
                  {starting === "queue" ? STARTING_LABEL : "Start reviewing"}
                </Button>
              </div>
            )}
            {capKey === "queue" ? <div className="mt-3">{cap}</div> : null}
          </section>

          {startFailure !== null && startFailure.kind !== "session_limit" ? (
            <div data-testid="review-start-failure">
              {startFailure.kind === "pool_empty" ? (
                emptyQueue
              ) : (
                <Notice
                  tone="warning"
                  title="Couldn't start that session"
                  message={startFailure.message}
                />
              )}
            </div>
          ) : null}

          {open.sessions.length > 0 ? (
            <OpenSessions
              rows={open.sessions}
              ending={open.isTerminating}
              headingRef={openHeadingRef}
              onEnd={(id) => {
                // QA2-A: ending one lifts the cap, so its message goes with it.
                if (startFailure?.kind === "session_limit")
                  setStartFailure(null);
                open.terminateSession(id);
              }}
            />
          ) : null}

          {total > 0 && topics.data !== undefined ? (
            <ReviewByTopic
              taxonomy={topics.data}
              bySection={bySection}
              byDomain={byDomain}
              canStart={canStart}
              starting={starting === "filter"}
              onStart={(spec) => void start(spec)}
              cap={capKey === "filter" ? cap : null}
            />
          ) : null}

          {total > 0 ? (
            <PastSessions
              rows={pool.pool?.sessions ?? []}
              todayKey={todayKey}
              serverHasMore={pool.hasMoreSessions}
              loadingMore={pool.isLoadingMoreSessions}
              onNextPage={pool.loadMoreSessions}
              canStart={canStart}
              startingKey={starting}
              capKey={capKey}
              cap={cap}
              onRedo={(row) =>
                void start({
                  mode: "session",
                  filters: {
                    source_engine: row.source_engine,
                    source_session_id: row.source_session_id,
                  },
                })
              }
            />
          ) : null}
        </>
      )}

      <AppShellPanel>
        <div className="flex flex-col gap-9" data-testid="review-panel">
          <section
            aria-labelledby="review-wait-h"
            className="flex flex-col gap-2.5"
            data-testid="review-waiting"
          >
            <h2 id="review-wait-h" className={PANEL_H2}>
              What's waiting
            </h2>
            {MASTERY_SECTIONS.map((s) => (
              <div
                key={s}
                className="flex justify-between border-b border-lyc-rule-soft py-2 text-[17px] leading-normal text-lyc-ink"
                data-testid="review-waiting-row"
              >
                <span>{sectionDisplayLabel(s)}</span>
                <span className="font-semibold">{bySection.get(s) ?? 0}</span>
              </div>
            ))}
            <p className="m-0 text-base leading-normal text-lyc-muted">
              Get a question right once and it leaves your queue. Miss it again
              and it goes to the back of the line.
            </p>
          </section>
          <section
            aria-labelledby="review-mastery-h"
            className="flex flex-col gap-4"
            data-testid="review-mastery"
          >
            <h2 id="review-mastery-h" className={PANEL_H2}>
              Mastery
            </h2>
            {masteryGranted && mastery.data !== undefined ? (
              <>
                {MASTERY_SECTIONS.map((s) => (
                  <div key={s} className="flex flex-col">
                    <h3 className="m-0 mb-1 text-[15px] font-semibold text-lyc-muted">
                      {sectionDisplayLabel(s)}
                    </h3>
                    {canonicalDomainNodes(mastery.data.domains, [s]).map(
                      (node) => (
                        <MasteryRow
                          key={`${node.section}:${node.domain}`}
                          label={node.domain}
                          levelKey={node.levelKey}
                          displayName={node.displayName}
                          variant="compact"
                          href={masteryDomainHref(node)}
                        />
                      ),
                    )}
                  </div>
                ))}
                <Link href="/mastery" className={TEXT_LINK}>
                  See every skill
                </Link>
              </>
            ) : masteryAccess?.access === "locked" ? (
              <LockedMasteryCard
                headingLevel={3}
                onSeeWhatsIncluded={() =>
                  upgrade.open("mastery_detail", masteryAccess.reason)
                }
              />
            ) : null}
          </section>
        </div>
      </AppShellPanel>
    </div>
  );
}

/**
 * QA2-A | @implemented [2026-10-08]: scrolls a section heading to the top of the view and moves
 * focus to it (the heading carries `tabIndex={-1}`), so "End a session" lands the student, and a
 * screen reader, on the open sessions. Skips the scroll where the browser has no `scrollIntoView`.
 */
function revealHeading(heading: HTMLElement | null): void {
  if (heading === null) return;
  if (typeof heading.scrollIntoView === "function")
    heading.scrollIntoView({ block: "start" });
  heading.focus({ preventScroll: true });
}

function OpenSessions({
  rows,
  ending,
  headingRef,
  onEnd,
}: {
  rows: readonly ReviewOpenSession[];
  ending: boolean;
  /** QA2-A: the heading "End a session" scrolls to and focuses. */
  headingRef: RefObject<HTMLHeadingElement>;
  onEnd: (sessionId: string) => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState<ReviewOpenSession | null>(null);
  return (
    <section
      aria-labelledby="review-open-h"
      className="flex flex-col gap-3.5"
      data-testid="review-open-sessions"
    >
      <h2
        id="review-open-h"
        ref={headingRef}
        tabIndex={-1}
        className={cn(SECTION_H2, "scroll-mt-20 outline-none")}
      >
        Pick up where you left off
      </h2>
      <ul className="m-0 list-none border-t border-lyc-rule p-0">
        {rows.map((s) => {
          const title = sessionTitle("review", s.criteria, s.section);
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-lyc-rule py-4"
              data-testid="review-open-row"
            >
              <div className="flex min-w-0 max-w-[460px] flex-grow flex-col gap-2">
                <span className="text-lg font-semibold text-lyc-ink">
                  {title}
                </span>
                <div className="h-1 rounded-sm bg-lyc-rule" aria-hidden="true">
                  <div
                    className="h-1 rounded-sm bg-lyc-ink-strong"
                    style={{
                      width: `${s.total_items > 0 ? (s.answered_items / s.total_items) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="text-base text-lyc-muted">
                  {answeredLine(s.answered_items, s.total_items)}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <Button
                  type="button"
                  variant="lyc-quiet"
                  disabled={ending}
                  aria-label={`End ${title}`}
                  onClick={() => setConfirming(s)}
                >
                  End
                </Button>
                <Link href={reviewSessionHref(s.id)} className={TEXT_LINK}>
                  Continue
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      <Modal
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title="End this review session?"
        description="Your questions stay in the queue — ending a session never removes them."
        data-testid="review-end-modal"
        footer={
          <>
            <Button
              type="button"
              variant="lyc-primary"
              size="lyc-lg"
              onClick={() => {
                if (confirming !== null) onEnd(confirming.id);
                setConfirming(null);
              }}
            >
              End session
            </Button>
            <Button
              type="button"
              variant="lyc-quiet"
              size="lyc-lg"
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </>
        }
      />
    </section>
  );
}

function ReviewByTopic({
  taxonomy,
  bySection,
  byDomain,
  canStart,
  starting,
  onStart,
  cap,
}: {
  taxonomy: PracticeTopicsResponse;
  bySection: ReadonlyMap<string, number>;
  byDomain: ReadonlyMap<string, number>;
  canStart: boolean;
  /** This picker's start is in flight (QA item 5). */
  starting: boolean;
  onStart: (spec: ReviewStartSpec) => void;
  /** QA2-A: the review cap's refusal of this picker's start, drawn under it; else null. */
  cap: ReactNode;
}): JSX.Element {
  const sections = sectionOptions(taxonomy);
  // The prototype opens on Math (`section: 'M'`).
  const [section, setSection] = useState<string>("M");
  const [chosen, setChosen] = useState<string[]>([]);
  const sectionName =
    sections.find((s) => s.value === section)?.label ?? section;
  const domains = domainOptions(taxonomy, [section]);
  const count = topicCount(chosen, byDomain, bySection.get(section) ?? 0);

  return (
    <section
      aria-labelledby="review-topic-h"
      className="flex flex-col gap-4"
      data-testid="review-topic-picker"
    >
      <div className="flex flex-col gap-1">
        <h2 id="review-topic-h" className={SECTION_H2}>
          Review by topic
        </h2>
        <p className="m-0 text-[17px] text-lyc-muted">
          Counts are what's waiting in your own queue.
        </p>
      </div>
      <div className="flex flex-col gap-5 rounded-lg border border-lyc-rule bg-lyc-sheet px-5 py-6 sm:px-7">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className={ROW_LABEL} id="review-topic-section-label">
            Section
          </span>
          <div
            role="group"
            aria-labelledby="review-topic-section-label"
            className="flex overflow-hidden rounded-md border border-lyc-ink-strong"
          >
            {sections.map((s) => {
              const pressed = s.value === section;
              return (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => {
                    if (pressed) return;
                    setSection(s.value);
                    setChosen([]);
                  }}
                  className={cn(
                    "h-11 px-5 text-[17px] font-semibold focus-visible:outline focus-visible:outline-[3px] focus-visible:-outline-offset-[3px] focus-visible:outline-lyc-focus",
                    pressed
                      ? "bg-lyc-primary-bg text-lyc-primary-ink"
                      : "bg-lyc-sheet text-lyc-ink-strong hover:bg-lyc-hover",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-x-5 gap-y-2 sm:flex-row sm:items-start">
          <span
            className={cn(ROW_LABEL, "pt-2.5")}
            id="review-topic-domain-label"
          >
            Domain
          </span>
          <div
            role="group"
            aria-labelledby="review-topic-domain-label"
            className="flex min-w-0 flex-1 flex-wrap gap-2.5"
          >
            {domains.map((d) => {
              const own = byDomain.get(d.value) ?? 0;
              const pressed = chosen.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  aria-pressed={pressed}
                  disabled={own === 0}
                  onClick={() =>
                    setChosen((prev) =>
                      pressed
                        ? prev.filter((x) => x !== d.value)
                        : [...prev, d.value],
                    )
                  }
                  className={cn(
                    "min-h-11 rounded-full border px-4 py-2 text-left text-base focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-lyc-focus disabled:cursor-not-allowed disabled:opacity-50",
                    pressed
                      ? "border-lyc-primary-bg bg-lyc-primary-bg text-lyc-primary-ink"
                      : "border-lyc-input-bd bg-lyc-sheet text-lyc-ink hover:bg-lyc-hover",
                  )}
                  data-testid="review-domain-chip"
                >
                  {domainChipLabel(d.label, own)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-lyc-rule-soft pt-4">
          <span
            className="text-[17px] text-lyc-ink"
            data-testid="review-topic-summary"
          >
            {topicSummary(count, chosen, sectionName)}
          </span>
          <Button
            type="button"
            variant="lyc-outline"
            disabled={!canStart || count === 0}
            pending={starting}
            onClick={() =>
              onStart({
                mode: "filter",
                filters:
                  chosen.length > 0
                    ? { sections: [section], domains: chosen }
                    : { sections: [section] },
              })
            }
            data-testid="button-start-topic"
          >
            {starting ? STARTING_LABEL : topicCta(count)}
          </Button>
        </div>
        {cap}
      </div>
    </section>
  );
}

function PastSessions({
  rows,
  todayKey,
  serverHasMore,
  loadingMore,
  onNextPage,
  canStart,
  startingKey,
  capKey,
  cap,
  onRedo,
}: {
  rows: readonly ReviewPoolSourceSession[];
  todayKey: string;
  serverHasMore: boolean;
  loadingMore: boolean;
  onNextPage: () => void;
  canStart: boolean;
  /** The start in flight (`reviewStartKey`), so the pressed Redo says "Starting…". */
  startingKey: string | null;
  /** QA2-A: the start the review cap refused (`reviewStartKey`); its row draws `cap`. */
  capKey: string | null;
  cap: ReactNode;
  onRedo: (row: ReviewPoolSourceSession) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [shown, setShown] = useState(PAST_SESSIONS_STEP);
  const groups = visiblePastGroups(rows, shown, todayKey);

  return (
    <section
      aria-labelledby="review-past-h"
      className="flex flex-col gap-3"
      data-testid="review-session-picker"
    >
      <h2 id="review-past-h" className={SECTION_H2}>
        Redo a past session
      </h2>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="review-past-list"
        onClick={() => setExpanded((v) => !v)}
        className="flex h-14 items-center justify-between rounded-lg border border-lyc-rule bg-lyc-sheet px-5 text-lg font-semibold text-lyc-ink hover:bg-lyc-hover focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-lyc-focus"
        data-testid="review-past-toggle"
      >
        <span>Past sessions</span>
        <ChevronDown
          className={cn("h-[18px] w-[18px]", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <div
          id="review-past-list"
          className="flex flex-col gap-4 px-1 pt-1"
          data-testid="review-past-list"
        >
          {groups.length === 0 ? (
            <p className="m-0 text-base text-lyc-muted">
              No past sessions with open questions.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="flex flex-col">
                <h3
                  className="m-0 mb-1.5 text-[15px] font-semibold text-lyc-muted"
                  data-testid="review-past-day"
                >
                  {group.label}
                </h3>
                <ul className="m-0 list-none border-t border-lyc-rule-soft p-0">
                  {group.rows.map((row) => (
                    <li
                      key={`${row.source_engine}:${row.source_session_id}`}
                      className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-b border-lyc-rule-soft py-3"
                      data-testid="review-past-row"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[17px] font-semibold text-lyc-ink">
                          {sourceHeadline(row.source_engine, row.local_time)}
                        </span>
                        <span className="text-[15px] text-lyc-muted">
                          {sourceFiltersLine(
                            row.mode,
                            row.filters,
                            row.source_engine,
                          )}
                        </span>
                      </span>
                      <span className="flex items-center gap-4">
                        <span className="text-[15px] text-lyc-ink">
                          {toReviewLine(row.open_count)}
                        </span>
                        <Button
                          type="button"
                          variant="lyc-link"
                          disabled={!canStart}
                          pending={startingKey === redoStartKey(row)}
                          onClick={() => onRedo(row)}
                          data-testid="review-past-redo"
                        >
                          {startingKey === redoStartKey(row)
                            ? STARTING_LABEL
                            : "Redo"}
                        </Button>
                      </span>
                      {capKey === redoStartKey(row) ? (
                        <div className="basis-full">{cap}</div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {hasMorePast(rows.length, shown, serverHasMore) ? (
            <Button
              type="button"
              variant="lyc-outline"
              className="self-start"
              disabled={loadingMore}
              onClick={() => {
                const next = shown + PAST_SESSIONS_STEP;
                if (needsNextPage(rows.length, next, serverHasMore))
                  onNextPage();
                setShown(next);
              }}
              data-testid="button-review-more-sessions"
            >
              Load more
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * QA item 5 (2026-10-07) | @implemented [2026-10-07]: a key naming one start on this page, so the
 * pressed control (and only it) draws "Starting…": the queue, the topic picker, or one past
 * session's Redo.
 */
function reviewStartKey(spec: ReviewStartSpec): string {
  if (spec.mode === "session")
    return sessionStartKey(
      spec.filters.source_engine,
      spec.filters.source_session_id,
    );
  return spec.mode;
}

function sessionStartKey(engine: string, sessionId: string): string {
  return `session:${engine}:${sessionId}`;
}

function redoStartKey(row: ReviewPoolSourceSession): string {
  return sessionStartKey(row.source_engine, row.source_session_id);
}
