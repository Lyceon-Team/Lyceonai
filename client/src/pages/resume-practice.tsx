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
 * (`DiagnosticCTACard.tsx:37-39`) landed a student on a "Continue" that the server
 * refuses later at `/next` (`practice-canonical.ts:1897-1907`). The server already
 * ships the answer at `practice-canonical.ts:2703`; this page now reads it.
 *
 * trade-offs: mode detection is a simple string check ("diagnostic") —
 * no enum import needed since the server already validates. The "section"
 * prop passed to CanonicalPracticePage for diagnostic is "math" (unused
 * during resume — only matters for new session creation).
 */
import { useRoute } from "wouter";
import CanonicalPracticePage from "@/components/practice/CanonicalPracticePage";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getClientInstanceId } from "@/lib/client-instance";
import { isApiError } from "@/lib/api-error";
import {
  sectionCodeForDisplay,
  sectionDisplayLabel,
} from "@shared/section-display";

interface SessionState {
  sessionId: string;
  section: string | null;
  mode: string | null;
  state: string;
  currentOrdinal: number;
  answeredCount: number;
  targetQuestionCount: number;
  readOnly: boolean;
}

export default function ResumePracticePage() {
  const [, params] = useRoute("/practice/session/:sessionId");
  const sessionId = params?.sessionId;
  const clientInstanceId = getClientInstanceId();

  // We fetch the session details first to know the section/mode
  const {
    data: session,
    isLoading,
    error,
  } = useQuery<SessionState>({
    queryKey: [
      `/api/practice/sessions/${sessionId}/state?client_instance_id=${clientInstanceId}`,
    ],
    enabled: !!sessionId,
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-lg">Initializing session...</span>
      </div>
    );
  }

  if (error || !session) {
    const is404 = isApiError(error) && error.status === 404;
    const errorTitle = is404 ? "Session Not Found" : "Session Error";
    const errorMessage = is404
      ? "This practice session no longer exists or has been removed."
      : "Something went wrong loading this session. Please try again.";

    return (
      <div className="flex h-screen flex-col items-center justify-center p-4">
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
            onClick={() => window.location.assign("/practice")}
            className="bg-primary text-primary-foreground px-6 py-2 rounded-md font-medium"
          >
            Back to Practice
          </button>
        </div>
      </div>
    );
  }

  // Ruling 17: a closed session is never playable, however the student got here.
  // This is checked BEFORE the diagnostic branch, because an abandoned diagnostic is
  // just as unplayable as an abandoned single-section session.
  if (session.readOnly) {
    const wasAbandoned = session.state === "abandoned";
    return (
      <div
        className="flex h-screen flex-col items-center justify-center p-4 text-center"
        data-testid="practice-session-closed"
      >
        <h1 className="text-2xl font-semibold mb-3">
          {wasAbandoned ? "This session has ended" : "Session complete"}
        </h1>
        <p className="text-muted-foreground mb-6 max-w-md">
          {wasAbandoned
            ? "This practice session was ended or timed out. Start a new one to keep going."
            : "You finished this practice session."}
        </p>
        <button
          onClick={() => window.location.assign("/practice")}
          className="bg-primary text-primary-foreground px-6 py-2 rounded-md font-medium"
        >
          Back to Practice
        </button>
      </div>
    );
  }

  const isDiagnostic = session.mode === "diagnostic";

  // ── Diagnostic sessions span BOTH sections (8 domains across Math + R&W).
  // They have no single section — the answer loop (GET /sessions/:id/next)
  // is mode-agnostic and serves items regardless of section, and the
  // calculator display reads question?.section from the current item, not
  // the prop.  Skip single-section resolution for diagnostic; the "section"
  // prop value is unused during resume (only matters for new session
  // creation), so "math" is a safe placeholder that satisfies the type.
  if (isDiagnostic) {
    return (
      <CanonicalPracticePage
        title="Diagnostic Assessment"
        badgeLabel="Diagnostic"
        section="M"
        sessionId={sessionId}
        isDiagnostic
        completionHref="/dashboard"
      />
    );
  }

  // ── Regular (single-section) sessions: resolve and guard ──
  // The API now returns the canonical code, so this is a validation of a value the
  // page already holds rather than a translation into a third spelling.
  const resolvedSection = sectionCodeForDisplay(session.section);

  if (!resolvedSection) {
    return (
      <div className="flex h-screen flex-col items-center justify-center p-4">
        <h1 className="text-2xl font-bold text-red-600 mb-4">
          Unknown Section
        </h1>
        <p className="text-muted-foreground mb-6">
          This session has an unrecognised section and cannot be resumed safely.
        </p>
        <button
          onClick={() => window.location.assign("/practice")}
          className="bg-primary text-primary-foreground px-6 py-2 rounded-md font-medium"
        >
          Back to Practice
        </button>
      </div>
    );
  }

  return (
    <CanonicalPracticePage
      title={`Resuming ${sectionDisplayLabel(session.section) ?? "Practice"} Session`}
      badgeLabel={sectionDisplayLabel(session.section) ?? "Practice"}
      section={resolvedSection}
      sessionId={sessionId}
      completionHref="/practice"
    />
  );
}
