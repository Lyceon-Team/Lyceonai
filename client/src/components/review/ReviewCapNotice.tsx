/**
 * The review cap's refusal, drawn at the start the student pressed. Home and Review both use this.
 *
 * @spec [owner re-test of production, Karl, 2026-10-08, item A: "Review cap (5 open sessions):
 *        show the error at the clicked button (inline or toast), never below the fold, with
 *        'Continue your open session' and 'End a session' actions. Same on Home and Review.";
 *        DESIGN.md §1 (student tokens, 14px floor, one filled primary per surface, sentence case,
 *        light and dark); Doc-02B_V4 §16 (review sessions); review-canonical.ts
 *        `startOrReplayReviewSession` (the cap, `SESSION_LIMIT_EXCEEDED`)]
 *        | @implemented [2026-10-08]
 *
 * plain English: when `POST /api/review/sessions` refuses because the student already has as many
 * open review sessions as the server allows, the page renders this directly under the control that
 * was pressed and scrolls it into view (`block: "nearest"`, so a message already on screen does not
 * move the page). It is the shared student notice (warning tone, a polite status) with two actions:
 * "Continue your open session" opens the most recently started open review session
 * (`latestOpenReviewSession` over the page's own open-sessions read, `useActiveReviewSessions`),
 * and "End a session" goes where the student can end one (Review's open sessions, each with End).
 *
 * WHY ONE COMPONENT. Home and Review must say the same thing and offer the same two ways out; two
 * hand-built copies would drift, as the two pages' old failure lines already had (a red line under
 * Home's recent sessions, a warning notice above Review's open sessions).
 *
 * trade-offs: neither action is a filled button: each page already has its one primary action
 * (DESIGN.md §1), so Continue is the outline action and End a session the quiet one, as the shared
 * notice draws them. The server's message is shown as it sends it (it names the count); the title
 * is ours.
 *
 * edge cases: with no open session known (the read has not answered yet, or failed), only "End a
 * session" is offered, rather than a Continue that goes nowhere. The scroll is skipped where the
 * browser has no `scrollIntoView` (jsdom).
 */
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Notice } from "@/components/student-ui";
import {
  REVIEW_OPEN_SESSIONS_HREF,
  latestOpenReviewSession,
  reviewSessionHref,
  type ReviewOpenSession,
} from "@/hooks/useReview";

const REVIEW_CAP_TITLE = "Too many open review sessions";
const REVIEW_CAP_CONTINUE = "Continue your open session";
const REVIEW_CAP_END = "End a session";

export function ReviewCapNotice({
  message,
  sessions,
  onEndSession,
}: {
  /** The server's own words for the refusal. */
  message: string;
  /** The page's open review sessions (`useActiveReviewSessions().sessions`). */
  sessions: readonly ReviewOpenSession[];
  /**
   * Where "End a session" goes. Review passes its own open-sessions list (in view and focused);
   * left out, it is Review's list from another page (`REVIEW_OPEN_SESSIONS_HREF`).
   */
  onEndSession?: () => void;
}): JSX.Element {
  const [, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const latest = latestOpenReviewSession(sessions);

  // Never below the fold: the message is brought into view when it appears.
  useEffect(() => {
    const el = ref.current;
    if (el !== null && typeof el.scrollIntoView === "function")
      el.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <div ref={ref} className="scroll-mt-20 scroll-mb-24">
      <Notice
        tone="warning"
        title={REVIEW_CAP_TITLE}
        message={message}
        {...(latest !== null
          ? {
              actionLabel: REVIEW_CAP_CONTINUE,
              onAction: () => navigate(reviewSessionHref(latest.id)),
            }
          : {})}
        secondaryActionLabel={REVIEW_CAP_END}
        onSecondaryAction={
          onEndSession ?? (() => navigate(REVIEW_OPEN_SESSIONS_HREF))
        }
        data-testid="review-cap"
      />
    </div>
  );
}
