/**
 * Review landing — `/review`.
 *
 * @spec [Doc-02B_V4 §16; ruled plan §2/§3, rulings 15-17 and 20; brief R4 §2.3]
 * @implemented [2026-09-22]
 *
 * plain English: one page, three ways into a review session — continue the whole queue,
 * pick a past session to redo, or pick a topic — plus a list of review sessions already
 * open. Every count on the page comes from one read, `GET /api/review/pool?tz=…`.
 * Expected outcome: a student can always see how much is waiting and get into it in one
 * click, and a student with nothing waiting is told so kindly rather than shown an error.
 *
 * WHY THE TOPIC PICKER READS TWO ENDPOINTS. The pool summary's facets are FLAT —
 * `bySection`, `byDomain` and `bySkill` are independent `{key, count}` lists
 * (`review-pool.ts:481-492`), with no section→domain→skill nesting. The hierarchy comes
 * from `GET /api/practice/topics`, which is a reference route mounted outside the
 * practice router (`server/index.ts:600-605`) and is engine-neutral — it is the same
 * taxonomy practice's own landing uses (`practice.tsx:153-162`). Structure from the
 * taxonomy, counts joined by name from the facets. No server change was needed for this,
 * which is why R4 stayed client-only.
 *
 * AN EMPTY QUEUE IS NOT AN ERROR (brief R4 §2.3). Both `total === 0` and a
 * `REVIEW_POOL_EMPTY` 422 on create render the same friendly empty state, with no error
 * styling — it is a decision, not a failure. Only a pool summary that fails to LOAD gets
 * practice's landing error treatment.
 *
 * ABANDONED SESSIONS NEVER APPEAR (ruling 17). The open list is filtered server-side
 * (`review-canonical.ts:1443`) and again in `useActiveReviewSessions`.
 *
 * trade-offs: the topic picker holds its own selection state rather than writing it to
 * the URL, matching practice's landing (`practice.tsx:119-131`), so the two pages behave
 * the same. edge cases: a browser that will not report a timezone sends no `tz`, R3
 * falls back to UTC and says so via `timezoneFallback`, and the page says so too rather
 * than silently grouping a student's evening into the wrong day.
 */

import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  BookOpen,
  Calculator,
  ChevronRight,
  Layers,
  PlayCircle,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageCard } from "@/components/common/page-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  browserTimeZone,
  useActiveReviewSessions,
  useCreateReviewSession,
  useReviewPool,
  type ReviewStartFailure,
  type ReviewStartSpec,
} from "@/hooks/useReview";
import {
  groupByLocalDay,
  localDateKey,
  sourceFiltersLine,
  sourceHeadline,
} from "@/lib/review-session-picker";
import {
  normalizePracticeTopicDomains,
  type RawPracticeTopicDomain,
} from "@/lib/practice-topic-taxonomy";
import {
  isMathSection,
  SECTION_LABEL_MATH,
  SECTION_LABEL_RW,
} from "@shared/section-display";
import type { CanonicalSectionCode } from "@shared/question-bank-contract";

type TopicsResponse = {
  sections?: Array<{ section?: string; domains?: RawPracticeTopicDomain[] }>;
};

/** Turn the flat facet list into a lookup so a domain row can show its own count. */
function facetMap(
  facets: ReadonlyArray<{ key: string; count: number }> | undefined,
): Map<string, number> {
  return new Map((facets ?? []).map((f) => [f.key, f.count]));
}

export default function ReviewPage() {
  const [, setLocation] = useLocation();
  const {
    pool,
    isLoading: poolLoading,
    isError: poolError,
    refetch: refetchPool,
  } = useReviewPool();
  const {
    sessions: openSessions,
    isLoading: openLoading,
    maxConcurrentSessions,
    terminateSession,
  } = useActiveReviewSessions();
  const { startSession, isStarting } = useCreateReviewSession();

  const [startFailure, setStartFailure] = useState<ReviewStartFailure | null>(
    null,
  );
  const [focusSection, setFocusSection] = useState<CanonicalSectionCode | "">(
    "M",
  );
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  const { data: topicsData } = useQuery<TopicsResponse>({
    queryKey: ["/api/practice/topics"],
  });

  // "Today" in the SAME zone R3 used to compute each row's local_date.
  const todayKey = useMemo(
    () => localDateKey(new Date(), browserTimeZone()),
    [],
  );

  const total = pool?.total ?? 0;
  const bySection = useMemo(() => facetMap(pool?.bySection), [pool?.bySection]);
  const byDomain = useMemo(() => facetMap(pool?.byDomain), [pool?.byDomain]);
  const bySkill = useMemo(() => facetMap(pool?.bySkill), [pool?.bySkill]);

  const dayGroups = useMemo(
    () => groupByLocalDay(pool?.sessions ?? [], todayKey),
    [pool?.sessions, todayKey],
  );

  const visibleDomains = useMemo(() => {
    const raw = topicsData?.sections?.find(
      (s) => s.section === (focusSection === "" ? "M" : focusSection),
    )?.domains;
    return normalizePracticeTopicDomains(raw);
  }, [topicsData, focusSection]);

  const atSessionLimit =
    maxConcurrentSessions !== null &&
    openSessions.length >= maxConcurrentSessions;

  async function start(spec: ReviewStartSpec): Promise<void> {
    setStartFailure(null);
    const result = await startSession(spec);
    if (result.ok) {
      // The id goes in the URL, so refresh / back / new tab all resume (§2.2).
      setLocation(`/review/session/${result.sessionId}`);
      return;
    }
    setStartFailure(result.failure);
  }

  const emptyState = (
    <div
      className="rounded-xl border border-border/50 bg-muted/30 p-8 text-center"
      data-testid="review-empty-state"
    >
      <Sparkles className="h-8 w-8 text-muted-foreground mx-auto mb-4" />
      <h3 className="text-lg font-semibold mb-2">Nothing to review yet</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
        Questions you miss or skip in practice show up here.
      </p>
      <Button asChild>
        <Link href="/practice" data-testid="link-review-empty-practice">
          Go to Practice
        </Link>
      </Button>
    </div>
  );

  return (
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
            Review Queue
          </p>
          <h1
            className="text-3xl sm:text-4xl font-semibold tracking-tight mb-3"
            data-testid="page-title"
          >
            Review Your Mistakes
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Every question you miss or skip comes back here until you get it
            right. Nothing is chosen at random.
          </p>
        </header>

        {poolError ? (
          <PageCard
            title="Couldn't load your review queue"
            className="border-red-200 bg-red-50"
          >
            <div
              className="flex items-start gap-3"
              data-testid="review-pool-error"
            >
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-red-700 mb-4">
                  Something went wrong fetching your queue. Your questions are
                  safe — this is a display problem.
                </p>
                <Button variant="outline" onClick={() => refetchPool()}>
                  Try again
                </Button>
              </div>
            </div>
          </PageCard>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 space-y-6">
              {/* ── Open review sessions (ruling 17: never abandoned) ───────── */}
              {openSessions.length > 0 && (
                <PageCard
                  title="Open Review Sessions"
                  description={`You have ${openSessions.length} review session${openSessions.length === 1 ? "" : "s"} in progress.`}
                  className="bg-primary/5 border-primary/20"
                >
                  <div
                    className="grid gap-3"
                    data-testid="review-open-sessions"
                  >
                    {openSessions.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between p-4 rounded-xl bg-card border border-border/50 hover:border-primary/30 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            {isMathSection(s.section) ? (
                              <Calculator className="h-5 w-5" />
                            ) : (
                              <RotateCcw className="h-5 w-5" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">Review</span>
                              <Badge variant="secondary" className="text-xs">
                                {s.mode}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Progress: {s.answered_items} / {s.total_items}{" "}
                              questions
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label="End this review session"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  End this review session?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Your questions stay in the queue — ending a
                                  session never removes them.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => terminateSession(s.id)}
                                >
                                  End session
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          <Button
                            size="sm"
                            onClick={() =>
                              setLocation(`/review/session/${s.id}`)
                            }
                          >
                            <PlayCircle className="h-4 w-4 mr-2" />
                            Continue
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </PageCard>
              )}

              {startFailure !== null && (
                <div data-testid="review-start-failure">
                  {startFailure.kind === "pool_empty" ? (
                    emptyState
                  ) : (
                    <PageCard
                      title={
                        startFailure.kind === "session_limit"
                          ? "Too many open sessions"
                          : "Couldn't start that session"
                      }
                      className="border-amber-200 bg-amber-50"
                    >
                      <p className="text-sm text-amber-800">
                        {startFailure.message}
                      </p>
                    </PageCard>
                  )}
                </div>
              )}

              {/* ── 1. Continue your queue ──────────────────────────────────── */}
              <PageCard
                title="Continue your queue"
                description="Everything waiting, oldest first."
              >
                {poolLoading ? (
                  <Skeleton className="h-16 w-full rounded-xl" />
                ) : total === 0 ? (
                  emptyState
                ) : (
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p
                        className="text-2xl font-semibold"
                        data-testid="review-queue-total"
                      >
                        {total} question{total === 1 ? "" : "s"} to review
                      </p>
                      {pool?.timezoneFallback === true && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Times are shown in UTC — your browser didn't report a
                          timezone.
                        </p>
                      )}
                    </div>
                    <Button
                      size="lg"
                      disabled={isStarting || atSessionLimit}
                      onClick={() => start({ mode: "queue" })}
                      data-testid="button-start-queue"
                    >
                      <PlayCircle className="h-4 w-4 mr-2" />
                      Start reviewing
                    </Button>
                  </div>
                )}
                {atSessionLimit && (
                  <p className="text-xs text-amber-700 mt-4 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    You have {openSessions.length} open review sessions. Finish
                    or end one first.
                  </p>
                )}
              </PageCard>

              {/* ── 2. Review by topic ────────────────────────────────────── */}
              {total > 0 && (
                <PageCard
                  title="Review by topic"
                  description="Counts come from what's actually in your queue."
                >
                  <div className="space-y-5" data-testid="review-topic-picker">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs uppercase tracking-widest text-muted-foreground">
                        Section
                      </span>
                      <Select
                        value={focusSection === "" ? "M" : focusSection}
                        onValueChange={(v) => {
                          setFocusSection(v as CanonicalSectionCode);
                          setSelectedDomain(null);
                        }}
                      >
                        <SelectTrigger className="h-7 w-44 text-xs bg-background">
                          <SelectValue placeholder="All sections" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="M">
                            {SECTION_LABEL_MATH} ({bySection.get("M") ?? 0})
                          </SelectItem>
                          <SelectItem value="RW">
                            {SECTION_LABEL_RW} ({bySection.get("RW") ?? 0})
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <span className="text-xs uppercase tracking-widest text-muted-foreground">
                        Domain
                      </span>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {visibleDomains.map((d) => {
                          const count = byDomain.get(d.domain) ?? 0;
                          const active = selectedDomain === d.domain;
                          return (
                            <button
                              key={d.domain}
                              type="button"
                              disabled={count === 0}
                              onClick={() =>
                                setSelectedDomain(active ? null : d.domain)
                              }
                              className={`text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40 ${
                                active
                                  ? "border-primary bg-primary/10 text-primary ring-2 ring-offset-1 ring-primary/50"
                                  : "border-border bg-background hover:border-primary/40"
                              }`}
                            >
                              {d.domain} ({count})
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {selectedDomain !== null && (
                      <div>
                        <span className="text-xs uppercase tracking-widest text-muted-foreground">
                          Skill
                        </span>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {(
                            visibleDomains.find(
                              (d) => d.domain === selectedDomain,
                            )?.skills ?? []
                          ).map((skill) => {
                            const count = bySkill.get(skill) ?? 0;
                            return (
                              <button
                                key={skill}
                                type="button"
                                disabled={
                                  count === 0 || isStarting || atSessionLimit
                                }
                                onClick={() =>
                                  start({
                                    mode: "filter",
                                    filters: { skills: [skill] },
                                  })
                                }
                                className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:border-primary/40 transition-colors disabled:opacity-40"
                              >
                                {skill} ({count})
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isStarting || atSessionLimit}
                      onClick={() =>
                        start({
                          mode: "filter",
                          filters:
                            selectedDomain === null
                              ? {
                                  sections: [
                                    focusSection === "" ? "M" : focusSection,
                                  ],
                                }
                              : { domains: [selectedDomain] },
                        })
                      }
                      data-testid="button-start-topic"
                    >
                      <Layers className="h-4 w-4 mr-2" />
                      Review{" "}
                      {selectedDomain === null
                        ? focusSection === "RW"
                          ? SECTION_LABEL_RW
                          : SECTION_LABEL_MATH
                        : selectedDomain}
                    </Button>
                  </div>
                </PageCard>
              )}

              {/* ── 3. Review a past session ──────────────────────────────── */}
              {total > 0 && (
                <PageCard
                  title="Review a past session"
                  description="Redo what you missed in one sitting."
                >
                  {poolLoading ? (
                    <Skeleton className="h-24 w-full rounded-xl" />
                  ) : dayGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No past sessions with open questions.
                    </p>
                  ) : (
                    <div
                      className="space-y-6"
                      data-testid="review-session-picker"
                    >
                      {dayGroups.map((group) => (
                        <div key={group.key}>
                          <h4 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                            {group.label}
                          </h4>
                          <div className="grid gap-2">
                            {group.rows.map((row) => (
                              <button
                                key={`${row.source_engine}:${row.source_session_id}`}
                                type="button"
                                disabled={isStarting || atSessionLimit}
                                onClick={() =>
                                  start({
                                    mode: "session",
                                    filters: {
                                      source_engine: row.source_engine,
                                      source_session_id: row.source_session_id,
                                    },
                                  })
                                }
                                className="flex items-center justify-between w-full text-left p-4 rounded-xl border border-border/50 bg-card hover:border-primary/30 transition-colors disabled:opacity-50"
                              >
                                <div>
                                  <p className="font-medium text-sm">
                                    {sourceHeadline(
                                      row.source_engine,
                                      row.local_time,
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {sourceFiltersLine(row.mode, row.filters)}
                                  </p>
                                </div>
                                <div className="flex items-center gap-3">
                                  <Badge variant="secondary">
                                    {row.open_count} to review
                                  </Badge>
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </PageCard>
              )}
            </div>

            {/* ── Aside: what's waiting, by section ──────────────────────────── */}
            <aside className="lg:col-span-4 space-y-6">
              <PageCard title="What's waiting">
                {poolLoading || openLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm flex items-center gap-2">
                        <Calculator className="h-4 w-4 text-muted-foreground" />
                        {SECTION_LABEL_MATH}
                      </span>
                      <span className="font-semibold">
                        {bySection.get("M") ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-muted-foreground" />
                        {SECTION_LABEL_RW}
                      </span>
                      <span className="font-semibold">
                        {bySection.get("RW") ?? 0}
                      </span>
                    </div>
                    <div className="border-t border-border/50 pt-3 flex items-center justify-between">
                      <span className="text-sm font-medium">Total</span>
                      <span className="font-semibold">{total}</span>
                    </div>
                  </div>
                )}
              </PageCard>

              <PageCard title="How review works">
                <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-4">
                  <li>Miss or skip a question and it joins this queue.</li>
                  <li>Get it right once and it leaves your queue.</li>
                  <li>
                    Miss or skip it again and it goes to the back of the line.
                  </li>
                  <li>Review is free and unlimited.</li>
                </ul>
              </PageCard>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}
