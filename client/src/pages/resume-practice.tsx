/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic client wiring]
 * @implemented 2026-08-14
 *
 * plain English: resumes a practice or diagnostic session by ID. Fetches
 * session state (including `mode`), detects diagnostic sessions, and passes
 * diagnostic-specific props (isDiagnostic, completionHref="/dashboard",
 * title/badge) to CanonicalPracticePage so the shared practice loop runs
 * with skip/abandon hidden and correct completion navigation.
 *
 * Diagnostic sessions span BOTH sections (8 domains × 5 items). They have
 * no single section — the answer loop (GET /sessions/:id/next) is mode-
 * agnostic. Diagnostic mode is detected BEFORE the single-section resolver
 * so it enters the answer loop without requiring a section value.
 *
 * expected outcome: navigating to /practice/session/:id for a diagnostic
 * session shows "Diagnostic Assessment" title, hides skip/end-session,
 * and redirects to /dashboard on completion — even when the state API
 * returns section: null (which it always does for diagnostic sessions).
 *
 * READ-ONLY GUARD (added R4, ruling 17 / brief R4 §2.5). This endpoint applies no
 * status predicate — `loadOwnedSession` checks ownership and nothing else
 * (`practice-canonical.ts:2653-2662`) — and the stale-session sweeper flips idle
 * sessions to `abandoned` (`stale-session-sweep.ts:70-71`). The page therefore used to
 * render the full loop for an abandoned session: it declared `state` and `readOnly` on
 * its DTO and read neither. A bookmark, a back button, or a diagnostic CTA
 * (the former `DiagnosticCTACard`, removed in UI-51) landed a student on a "Continue" that the server
 * refuses later at `/next` (`practice-canonical.ts:1897-1907`). The server already
 * ships the answer at `practice-canonical.ts:2703`; this page now reads it.
 *
 * UI-53 (2026-10-03, DESIGN.md §4, register OQ-22, OQ-35): the state is parsed with the shared
 * `practiceSessionStateResponseSchema` (Zod at the boundary; a malformed body is a load error).
 * The runner is named by the session's criteria (`sessionTitle`, the one used by Home, Practice
 * and Review rows), and `shortened` passes OQ-35's "this session is shorter" to the runner. The
 * loading, error and closed states draw on the student tokens and navigate client-side.
 *
 * trade-offs: mode detection is a simple string check ("diagnostic") —
 * no enum import needed since the server already validates. The "section"
 * prop passed to CanonicalPracticePage for diagnostic is "math" (unused
 * during resume — only matters for new session creation).
 */
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  practiceSessionStateResponseSchema,
  type PracticeSessionStateResponse,
} from "@lyceon/shared/practice-response-schema";
import CanonicalPracticePage from "@/components/practice/CanonicalPracticePage";
import { RunnerStateCard } from "@/components/practice/RunnerStateCard";
import { sessionTitle } from "@/components/home/home-model";
import { FullPageLoader } from "@/components/student-ui";
import { getClientInstanceId } from "@/lib/client-instance";
import { isApiError } from "@/lib/api-error";
import { sectionCodeForDisplay } from "@shared/section-display";

export default function ResumePracticePage(): JSX.Element {
  const [, params] = useRoute("/practice/session/:sessionId");
  const [, navigate] = useLocation();
  const sessionId = params?.sessionId;
  const clientInstanceId = getClientInstanceId();

  // We fetch the session details first to know the section/mode
  const {
    data: session,
    isLoading,
    error,
    refetch,
  } = useQuery<unknown, Error, PracticeSessionStateResponse>({
    queryKey: [
      `/api/practice/sessions/${sessionId}/state?client_instance_id=${clientInstanceId}`,
    ],
    select: (raw) => practiceSessionStateResponseSchema.parse(raw),
    enabled: !!sessionId,
  });

  if (isLoading) {
    // @spec [student-UI register UI-46; audit §6.2 "Full-page spinner"] | @implemented [2026-10-03]
    // UI-53: the practice runner is off the light lock, so the loader follows the device theme.
    return <FullPageLoader label="Initializing session..." />;
  }

  if (error || !session) {
    const is404 = isApiError(error) && error.status === 404;
    return (
      <RunnerStateCard
        tone="danger"
        title={is404 ? "Session Not Found" : "Session Error"}
        message={
          is404
            ? "This practice session no longer exists or has been removed."
            : "Something went wrong loading this session. Please try again."
        }
        primary={{
          label: "Back to Practice",
          onClick: () => navigate("/practice"),
        }}
        secondary={
          is404 ? null : { label: "Retry", onClick: () => void refetch() }
        }
      />
    );
  }

  // Ruling 17: a closed session is never playable, however the student got here.
  // This is checked BEFORE the diagnostic branch, because an abandoned diagnostic is
  // just as unplayable as an abandoned single-section session.
  if (session.readOnly) {
    const wasAbandoned = session.state === "abandoned";
    return (
      <RunnerStateCard
        tone="neutral"
        data-testid="practice-session-closed"
        title={wasAbandoned ? "This session has ended" : "Session complete"}
        message={
          wasAbandoned
            ? "This practice session was ended or timed out. Start a new one to keep going."
            : "You finished this practice session."
        }
        primary={{
          label: "Back to Practice",
          onClick: () => navigate("/practice"),
        }}
        secondary={null}
      />
    );
  }

  const isDiagnostic = session.mode === "diagnostic";

  // ── Diagnostic sessions span BOTH sections (8 domains across Math + R&W).
  // They have no single section — the answer loop (GET /sessions/:id/next)
  // is mode-agnostic and serves items regardless of section, and the
  // calculator display reads question?.section from the current item, not
  // the prop.  Skip single-section resolution for diagnostic; the "section"
  // prop value is unused during resume (only matters for new session
  // creation), so "M" is a safe placeholder that satisfies the type.
  if (isDiagnostic) {
    return (
      <CanonicalPracticePage
        title="Diagnostic Assessment"
        section="M"
        sessionId={sessionId}
        isDiagnostic
        completionHref="/dashboard"
      />
    );
  }

  // ── Regular (single-section) sessions: resolve and guard ──
  // The API returns the canonical code, so this validates a value the page already holds.
  const resolvedSection = sectionCodeForDisplay(session.section);

  if (!resolvedSection) {
    return (
      <RunnerStateCard
        tone="danger"
        title="Unknown Section"
        message="This session has an unrecognised section and cannot be resumed safely."
        primary={{
          label: "Back to Practice",
          onClick: () => navigate("/practice"),
        }}
        secondary={null}
      />
    );
  }

  return (
    <CanonicalPracticePage
      title={sessionTitle("practice", session.criteria, session.section)}
      section={resolvedSection}
      sessionId={sessionId}
      shortened={session.shortened}
      completionHref="/practice"
    />
  );
}
