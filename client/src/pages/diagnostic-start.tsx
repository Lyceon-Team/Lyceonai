import { useEffect, useRef } from "react";
import { Redirect, useLocation } from "wouter";
import { FullPageLoader } from "@/components/student-ui/FullPageLoader";
import { Notice } from "@/components/student-ui/Notice";
import { useDiagnosticStart } from "@/hooks/useDiagnosticStart";

/**
 * @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rule 3; Doc-05C §7.4 (the
 *       diagnostic session); evidence/wiring-table.md §3 Home (start: POST
 *       /api/practice/diagnostic/sessions)] | @implemented [2026-10-10]
 *
 * plain English: `/practice/diagnostic`, where "Start the free diagnostic" lands after sign-in,
 * or after sign-up and onboarding. It starts the diagnostic exactly as Home's card does (the one
 * `useDiagnosticStart` hook, so a diagnostic already in progress is resumed, not duplicated) and
 * replaces itself with the practice runner, so Back does not return here and start again.
 *
 * Edge cases: a diagnostic already completed (taken once, ruling Q1) goes to Home instead, where
 * there is nothing to start; any other refusal (no coverage, a server error) shows the hook's
 * curated message with a way Home. The page never shows a raw server string. The ref guard keeps
 * the start to one request per visit (the POST is safe to repeat anyway: an active session comes
 * back as a resume).
 */
export default function DiagnosticStart() {
  const [, navigate] = useLocation();
  const { startDiagnostic, error } = useDiagnosticStart();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startDiagnostic().then((sessionId) => {
      if (sessionId) {
        navigate(`/practice/session/${sessionId}`, { replace: true });
      }
    });
  }, [startDiagnostic, navigate]);

  if (error?.code === "diagnostic_already_completed") {
    return <Redirect to="/dashboard" replace />;
  }

  if (error) {
    return (
      <Notice
        tone="danger"
        title={error.message}
        actionLabel="Go to Home"
        onAction={() => navigate("/dashboard")}
        data-testid="diagnostic-start-error"
      />
    );
  }

  return (
    <FullPageLoader
      fill="region"
      label="Starting your diagnostic..."
      data-testid="diagnostic-start-loading"
    />
  );
}
