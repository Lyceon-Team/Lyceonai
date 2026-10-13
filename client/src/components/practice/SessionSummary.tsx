/**
 * The end-of-session summary, after the last question of a practice or review session.
 *
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 3: "Practice session
 *        summary screen after the last question: score, streak kept, items sent to review, mastery
 *        change if any; actions 'Review misses' and 'Another 5'. Same pattern for review
 *        sessions."; DESIGN.md §2 (Focus shell), §5 (one filled primary; ≥14px; tokens only;
 *        ClampedLabel for long labels; empty, loading and error states); Coding Standards §10
 *        (mastery from observed events only), §11.1 (components render, hooks fetch)]
 *        | @implemented [2026-10-13]
 *
 * plain English: the runner's page shows this, inside the Focus shell, once the server says the
 * session is completed (resume-practice.tsx / resume-review.tsx, so a refresh shows it again). Every
 * figure is the server's (`useSessionSummary`):
 *   - Score: "4 of 5 correct", and the skips when there were any.
 *   - Streak: "🔥 N-day streak, kept today" when today counts; nothing when the streak is unknown.
 *   - Sent to review: how many queue entries the session created.
 *   - Mastery: only the skills whose level the mastery engine recorded changing, before → after, as
 *     the level pills draw them. No line at all when nothing changed or the plan has no mastery
 *     detail (`mastery_changes` empty or null): the client never estimates a change.
 * Actions: "Review misses" starts a review of this session's queued questions through the existing
 * review start (`mode: "session"`, this session as the source, as Home's "Review this session");
 * "Another 5" starts a 5-question session the way this one was started (practice: its criteria,
 * through `usePractice`; review: its pool, with `target_count` 5). One filled primary: "Review
 * misses" when there are misses, else "Another 5"; the other is outline. Each start's refusal is
 * shown under the actions: the review cap with the shared ReviewCapNotice, an empty pool or a used
 * quota as a notice, in the student's words.
 *
 * Anti-leak: the summary holds no question content; nothing here can show an answer.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { ANOTHER_SESSION_SIZE } from "@lyceon/shared/session-summary-schema";
import type { SessionSummary as Summary } from "@lyceon/shared/session-summary-schema";
import { LevelPill } from "@/components/mastery/LevelPill";
import { ReviewCapNotice } from "@/components/review/ReviewCapNotice";
import { ClampedLabel, Notice } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePractice } from "@/hooks/usePractice";
import {
  reviewSessionHref,
  useActiveReviewSessions,
  useCreateReviewSession,
  type ReviewStartFailure,
  type ReviewStartSpec,
} from "@/hooks/useReview";
import {
  useSessionSummary,
  type SummaryEngine,
} from "@/hooks/useSessionSummary";
import { STARTING_LABEL } from "@/lib/pending-copy";

const ANOTHER_LABEL = `Another ${ANOTHER_SESSION_SIZE}`;
const REVIEW_MISSES_LABEL = "Review misses";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "4 of 5 correct · 1 skipped" (pure; the tests read it). */
function scoreLine(
  s: Pick<Summary, "answered" | "correct" | "skipped">,
): string {
  const head =
    s.answered === 0
      ? "No questions answered"
      : `${s.correct} of ${s.answered} correct`;
  return s.skipped > 0 ? `${head} · ${s.skipped} skipped` : head;
}

function sentToReviewLine(engine: SummaryEngine, n: number): string {
  if (engine === "review")
    return n === 0
      ? "Nothing went back to your review queue"
      : `${plural(n, "question", "questions")} back in your review queue`;
  return n === 0
    ? "Nothing sent to review"
    : `${plural(n, "question", "questions")} sent to review`;
}

type Pending = "misses" | "another" | null;

export function SessionSummary({
  engine,
  sessionId,
  title,
}: {
  engine: SummaryEngine;
  sessionId: string;
  /** The session's name (the runner's title). */
  title: string;
}): JSX.Element {
  const summary = useSessionSummary(engine, sessionId);
  return (
    <div
      className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 pb-12 pt-8 lg:pt-14"
      data-testid="session-summary"
      data-engine={engine}
    >
      <header className="flex flex-col gap-2">
        <h1 className="m-0 font-lyc-serif text-lyc-section font-semibold text-lyc-ink-strong sm:text-lyc-title">
          Session complete
        </h1>
        <p className="m-0 text-lyc-body-lg text-lyc-muted">{title}</p>
      </header>
      {summary.isLoading ? (
        <div
          role="status"
          aria-label="Loading your summary"
          className="flex flex-col gap-4"
          data-testid="session-summary-loading"
        >
          <Skeleton variant="lyc" className="h-[180px] w-full" />
          <Skeleton variant="lyc" className="h-[52px] w-[260px]" />
        </div>
      ) : summary.isError || summary.data === undefined ? (
        <Notice
          tone="danger"
          title="We couldn’t load your summary."
          message="Your answers are saved. Try again in a moment."
          actionLabel="Try again"
          onAction={() => void summary.refetch()}
          data-testid="session-summary-error"
        />
      ) : (
        <SummaryBody data={summary.data} />
      )}
    </div>
  );
}

function SummaryBody({ data }: { data: Summary }): JSX.Element {
  const [, navigate] = useLocation();
  const practice = usePractice();
  const createReview = useCreateReviewSession();
  const openReviews = useActiveReviewSessions();
  const [pending, setPending] = useState<Pending>(null);
  const [reviewFailure, setReviewFailure] = useState<ReviewStartFailure | null>(
    null,
  );
  const [practiceFailed, setPracticeFailed] = useState(false);

  const startReview = async (
    spec: ReviewStartSpec,
    which: Exclude<Pending, null>,
  ): Promise<void> => {
    setPending(which);
    setReviewFailure(null);
    setPracticeFailed(false);
    const result = await createReview.startSession(spec);
    if (result.ok) {
      navigate(reviewSessionHref(result.sessionId));
      return;
    }
    setPending(null);
    setReviewFailure(result.failure);
  };

  const reviewMisses = (): void =>
    void startReview(
      {
        mode: "session",
        filters: {
          source_engine: data.engine,
          source_session_id: data.sessionId,
        },
      },
      "misses",
    );

  const another = async (): Promise<void> => {
    if (data.engine === "review") {
      await startReview(
        { ...data.again, targetCount: ANOTHER_SESSION_SIZE },
        "another",
      );
      return;
    }
    setPending("another");
    setReviewFailure(null);
    setPracticeFailed(false);
    const id = await practice.startSession({
      criteria: data.again.criteria,
      targetQuestionCount: ANOTHER_SESSION_SIZE,
    });
    if (id) {
      navigate(`/practice/session/${id}`);
      return;
    }
    setPending(null);
    setPracticeFailed(true);
  };

  const hasMisses = data.sent_to_review > 0;
  const changes = data.mastery_changes ?? [];
  const streak = data.streak;

  return (
    <>
      <dl
        className="m-0 grid grid-cols-1 gap-x-8 border-t border-lyc-rule sm:grid-cols-[180px_minmax(0,1fr)]"
        data-testid="session-summary-facts"
      >
        <dt className="pt-5 text-lyc-body font-semibold text-lyc-muted sm:border-b sm:border-lyc-rule sm:pb-5">
          Score
        </dt>
        <dd
          className="m-0 border-b border-lyc-rule pb-5 pt-1 font-lyc-serif text-[24px] font-semibold text-lyc-ink-strong sm:pt-5"
          data-testid="session-summary-score"
        >
          {scoreLine(data)}
        </dd>
        {streak !== null && streak.today_done ? (
          <>
            <dt className="pt-5 text-lyc-body font-semibold text-lyc-muted sm:border-b sm:border-lyc-rule sm:pb-5">
              Streak
            </dt>
            <dd
              className="m-0 border-b border-lyc-rule pb-5 pt-1 text-lyc-body-lg text-lyc-ink sm:pt-5"
              data-testid="session-summary-streak"
            >
              🔥 {streak.current}-day streak, kept today
            </dd>
          </>
        ) : null}
        <dt className="pt-5 text-lyc-body font-semibold text-lyc-muted sm:border-b sm:border-lyc-rule sm:pb-5">
          Review
        </dt>
        <dd
          className="m-0 border-b border-lyc-rule pb-5 pt-1 text-lyc-body-lg text-lyc-ink sm:pt-5"
          data-testid="session-summary-review"
        >
          {sentToReviewLine(data.engine, data.sent_to_review)}
        </dd>
        {changes.length > 0 ? (
          <>
            <dt className="pt-5 text-lyc-body font-semibold text-lyc-muted sm:border-b sm:border-lyc-rule sm:pb-5">
              Mastery
            </dt>
            <dd
              className="m-0 border-b border-lyc-rule pb-5 pt-1 sm:pt-5"
              data-testid="session-summary-mastery"
            >
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {changes.map((c) => (
                  <li
                    key={`${c.section}:${c.domain}:${c.skill}`}
                    className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    aria-label={`${c.skill}: ${c.before.displayName} to ${c.after.displayName}`}
                    data-testid="session-summary-mastery-row"
                  >
                    <ClampedLabel
                      text={c.skill}
                      className="text-lyc-body font-semibold text-lyc-ink"
                    />
                    <span
                      className="flex shrink-0 items-center gap-2"
                      aria-hidden="true"
                    >
                      <LevelPill
                        levelKey={c.before.levelKey}
                        displayName={c.before.displayName}
                      />
                      <span className="text-lyc-body text-lyc-muted">→</span>
                      <LevelPill
                        levelKey={c.after.levelKey}
                        displayName={c.after.displayName}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
      </dl>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {hasMisses ? (
            <Button
              type="button"
              variant="lyc-primary"
              size="lyc-lg"
              disabled={pending !== null}
              pending={pending === "misses"}
              onClick={reviewMisses}
              data-testid="session-summary-review-misses"
            >
              {pending === "misses" ? STARTING_LABEL : REVIEW_MISSES_LABEL}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={hasMisses ? "lyc-outline" : "lyc-primary"}
            size="lyc-lg"
            disabled={pending !== null}
            pending={pending === "another"}
            onClick={() => void another()}
            data-testid="session-summary-another"
          >
            {pending === "another" ? STARTING_LABEL : ANOTHER_LABEL}
          </Button>
        </div>
        {reviewFailure?.kind === "session_limit" ? (
          <ReviewCapNotice
            message={reviewFailure.message}
            sessions={openReviews.sessions}
          />
        ) : reviewFailure !== null ? (
          <Notice
            tone={reviewFailure.kind === "pool_empty" ? "neutral" : "danger"}
            title={
              reviewFailure.kind === "pool_empty"
                ? "Nothing left to review here."
                : "We couldn’t start that."
            }
            message={reviewFailure.message}
            data-testid="session-summary-start-error"
          />
        ) : practiceFailed ? (
          <Notice
            tone={
              practice.quotaExhausted || practice.poolEmpty
                ? "neutral"
                : "danger"
            }
            title={
              practice.quotaExhausted
                ? "You’ve used today’s free questions."
                : practice.poolEmpty
                  ? "No more questions match these filters."
                  : "We couldn’t start that."
            }
            message={
              practice.quotaExhausted
                ? "Come back tomorrow, or see plans for unlimited practice."
                : "Try again, or choose different filters on Practice."
            }
            data-testid="session-summary-start-error"
          />
        ) : null}
      </div>
    </>
  );
}
