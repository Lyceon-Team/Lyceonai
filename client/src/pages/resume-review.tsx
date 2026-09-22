/**
 * Review session shell — `/review/session/:sessionId`.
 *
 * @spec [Doc-02B_V4 §16; ruled plan §2, ruling 17; brief R4 §2.2]
 * @implemented [2026-09-22]
 *
 * plain English: mirrors `resume-practice.tsx`. The session id comes from the URL, the
 * state is fetched with the shared `getClientInstanceId()`, and then the SAME question
 * loop practice uses is rendered, pointed at review's endpoints. Expected outcome:
 * refresh, back and a new tab all resume the same review session on the same item,
 * because the id lives in the URL rather than in component state.
 *
 * WHY `section="random"`. A review session's pool is the mistake queue, which spans
 * both sections, so the server reports `section: null`. The loop's `section` prop is
 * consumed only by the CREATE body (`engine-config.ts`), and by the time this page
 * renders the session already exists. `"random"` is the member of `PracticeSectionParam`
 * that means "no section filter" — the honest value, not a placeholder. This mirrors
 * the diagnostic branch in `resume-practice.tsx:114-125`, which passes `"M"` for the
 * same structural reason.
 *
 * THE READ-ONLY GUARD IS THE POINT, NOT A DETAIL (ruling 17, brief R4 §2.5).
 * `GET /api/review/sessions/:id/state` applies NO status predicate — it checks
 * ownership and nothing else (`review-canonical.ts:1567-1573`) — and returns
 * `readOnly: state === "completed" || state === "abandoned"`
 * (`review-canonical.ts:1597`). A stale bookmark or a back button therefore lands here
 * with an abandoned session in hand. Rendering the loop for it would offer a "Continue"
 * into a session the server will refuse at `/next`, which is exactly the abandoned-
 * session exposure ruling 17 forbids. So this page reads `readOnly` and stops.
 *
 * trade-offs: one extra render branch on every resume, in exchange for the guarantee
 * that no abandoned session is ever playable. edge cases: a `completed` session takes
 * the same branch with different copy — it is not an error either, it is finished.
 */
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import CanonicalPracticePage from "@/components/practice/CanonicalPracticePage";
import { getClientInstanceId } from "@/lib/client-instance";
import { isApiError } from "@/lib/api-error";
import { REVIEW_ENGINE_CONFIG } from "@/lib/engine-config";

/** The subset of `GET /api/review/sessions/:id/state` this shell reads. */
type ReviewSessionState = {
  sessionId: string;
  section: string | null;
  mode: string | null;
  state: string;
  currentOrdinal: number;
  answeredCount: number;
  targetQuestionCount: number;
  readOnly: boolean;
};

export default function ResumeReviewPage() {
  const [, params] = useRoute("/review/session/:sessionId");
  const sessionId = params?.sessionId;
  const clientInstanceId = getClientInstanceId();

  const {
    data: session,
    isLoading,
    error,
  } = useQuery<ReviewSessionState>({
    queryKey: [
      `/api/review/sessions/${sessionId}/state?client_instance_id=${clientInstanceId}`,
    ],
    enabled: !!sessionId,
  });

  if (isLoading) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        data-testid="review-session-loading"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-lg">Loading your review session...</span>
      </div>
    );
  }

  if (error || !session) {
    const is404 = isApiError(error) && error.status === 404;
    const errorTitle = is404 ? "Session Not Found" : "Session Error";
    const errorMessage = is404
      ? "This review session no longer exists or has been removed."
      : "Something went wrong loading this session. Please try again.";

    return (
      <div
        className="flex h-screen flex-col items-center justify-center p-4"
        data-testid="review-session-error"
      >
        <h1 className="text-2xl font-bold text-red-600 mb-4">{errorTitle}</h1>
        <p className="text-muted-foreground mb-6">{errorMessage}</p>
        <div className="flex gap-3">
          {!is404 && (
            <button
              onClick={() => window.location.reload()}
              className="border border-border text-foreground px-6 py-2 rounded-md font-medium"
            >
              Retry
            </button>
          )}
          <button
            onClick={() => window.location.assign("/review")}
            className="bg-primary text-primary-foreground px-6 py-2 rounded-md font-medium"
          >
            Back to Review
          </button>
        </div>
      </div>
    );
  }

  // Ruling 17: a closed session is never playable, however the student got here.
  if (session.readOnly) {
    const wasAbandoned = session.state === "abandoned";
    return (
      <div
        className="flex h-screen flex-col items-center justify-center p-4 text-center"
        data-testid="review-session-closed"
      >
        <h1 className="text-2xl font-semibold mb-3">
          {wasAbandoned ? "This session has ended" : "Session complete"}
        </h1>
        <p className="text-muted-foreground mb-6 max-w-md">
          {wasAbandoned
            ? "This review session was ended or timed out. Your questions are still in the queue — start a new session to keep going."
            : "You finished this review session. Anything you missed is back in the queue."}
        </p>
        <button
          onClick={() => window.location.assign("/review")}
          className="bg-primary text-primary-foreground px-6 py-2 rounded-md font-medium"
        >
          Back to Review
        </button>
      </div>
    );
  }

  return (
    <CanonicalPracticePage
      title="Review Session"
      badgeLabel="Review"
      section="random"
      sessionId={sessionId}
      engine={REVIEW_ENGINE_CONFIG}
      completionHref="/review"
    />
  );
}
