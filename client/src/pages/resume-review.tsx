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
 * UI-53 (2026-10-03, DESIGN.md §4, register OQ-22): the state is parsed with the shared
 * `reviewSessionStateResponseSchema`; the runner is named by the session's criteria
 * (`sessionTitle`, "Review session" when none were chosen); the states draw on the student
 * tokens (this route stays on the light lock, route-shells.ts) and navigate client-side.
 *
 * trade-offs: one extra render branch on every resume, in exchange for the guarantee
 * that no abandoned session is ever playable. edge cases: a `completed` session takes
 * the same branch with different copy — it is not an error either, it is finished.
 */
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { reviewSessionStateResponseSchema } from "@lyceon/shared/review-schema";
import type { EngineSessionStateResponse } from "@lyceon/shared/practice-response-schema";
import { FullPageLoader } from "@/components/student-ui";
import CanonicalPracticePage from "@/components/practice/CanonicalPracticePage";
import { RunnerStateCard } from "@/components/practice/RunnerStateCard";
import { sessionTitle } from "@/components/home/home-model";
import { getClientInstanceId } from "@/lib/client-instance";
import { isApiError } from "@/lib/api-error";
import { REVIEW_ENGINE_CONFIG } from "@/lib/engine-config";

export default function ResumeReviewPage(): JSX.Element {
  const [, params] = useRoute("/review/session/:sessionId");
  const [, navigate] = useLocation();
  const sessionId = params?.sessionId;
  const clientInstanceId = getClientInstanceId();

  const {
    data: session,
    isLoading,
    error,
    refetch,
  } = useQuery<unknown, Error, EngineSessionStateResponse>({
    queryKey: [
      `/api/review/sessions/${sessionId}/state?client_instance_id=${clientInstanceId}`,
    ],
    select: (raw) => reviewSessionStateResponseSchema.parse(raw),
    enabled: !!sessionId,
  });

  if (isLoading) {
    // @spec [student-UI register UI-46; audit §6.2 "Full-page spinner"] | @implemented [2026-10-03]
    // The shared FullPageLoader (role="status", named by its label). Light-locked with the
    // review runner route (route-shells.ts, UI-53).
    return (
      <FullPageLoader
        themeLock="light"
        label="Loading your review session..."
        data-testid="review-session-loading"
      />
    );
  }

  if (error || !session) {
    const is404 = isApiError(error) && error.status === 404;
    return (
      <RunnerStateCard
        tone="danger"
        data-testid="review-session-error"
        title={is404 ? "Session Not Found" : "Session Error"}
        message={
          is404
            ? "This review session no longer exists or has been removed."
            : "Something went wrong loading this session. Please try again."
        }
        primary={{
          label: "Back to Review",
          onClick: () => navigate("/review"),
        }}
        secondary={
          is404 ? null : { label: "Retry", onClick: () => void refetch() }
        }
      />
    );
  }

  // Ruling 17: a closed session is never playable, however the student got here.
  if (session.readOnly) {
    const wasAbandoned = session.state === "abandoned";
    return (
      <RunnerStateCard
        tone="neutral"
        data-testid="review-session-closed"
        title={wasAbandoned ? "This session has ended" : "Session complete"}
        message={
          wasAbandoned
            ? "This review session was ended or timed out. Your questions are still in the queue — start a new session to keep going."
            : "You finished this review session. Anything you missed is back in the queue."
        }
        primary={{
          label: "Back to Review",
          onClick: () => navigate("/review"),
        }}
        secondary={null}
      />
    );
  }

  return (
    <CanonicalPracticePage
      title={sessionTitle("review", session.criteria, null)}
      section="random"
      sessionId={sessionId}
      engine={REVIEW_ENGINE_CONFIG}
      completionHref="/review"
    />
  );
}
