/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic session creation]
 * @implemented 2026-08-14
 *
 * plain English: hook for creating a diagnostic session via POST /api/practice/
 * diagnostic/sessions. Handles four server-side outcomes:
 *  - 201 (fresh creation) → returns sessionId
 *  - 409 diagnostic_session_active → returns existingSessionId (seamless resume)
 *  - 409 diagnostic_already_completed → refusal; taken once, no retake (ruling Q1)
 *  - 503 diagnostic_insufficient_coverage → curated error (never raw)
 *
 * expected outcome: the dashboard button calls startDiagnostic(), receives a
 * sessionId, and navigates to /practice/session/:sessionId where the shared
 * practice loop takes over.
 *
 * trade-offs: the hook does NOT enter the answer loop — it only creates/resumes
 * and returns a sessionId. The answer loop is 100% shared with regular practice
 * via useCanonicalPractice.
 */

import { useState, useCallback } from "react";
import { csrfFetch } from "@/lib/csrf";
import { getClientInstanceId } from "@/lib/client-instance";

export type DiagnosticStartResult = {
  sessionId: string;
};

export type DiagnosticStartError = {
  message: string;
  code?: string;
};

export function useDiagnosticStart(): {
  startDiagnostic: () => Promise<string | null>;
  isStarting: boolean;
  error: DiagnosticStartError | null;
  clearError: () => void;
} {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<DiagnosticStartError | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const startDiagnostic = useCallback(async (): Promise<string | null> => {
    if (isStarting) return null;
    setIsStarting(true);
    setError(null);

    try {
      const clientInstanceId = getClientInstanceId();
      const idempotencyKey = crypto.randomUUID();

      const res = await csrfFetch("/api/practice/diagnostic/sessions", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_instance_id: clientInstanceId,
          idempotency_key: idempotencyKey,
        }),
      });

      const body = await res.json().catch(() => null);

      // 201 — fresh diagnostic session created.
      if (res.status === 201 || (res.ok && body?.sessionId)) {
        return body.sessionId as string;
      }

      // 409 — active diagnostic session already exists. Seamless resume:
      // the student doesn't see an error, we redirect to the existing session.
      if (res.status === 409 && body?.existingSessionId) {
        return body.existingSessionId as string;
      }

      // 409 — the diagnostic is already COMPLETED (owner ruling Q1: taken once,
      // no retake). Distinct from the resume case above: there is nothing to
      // resume and nothing to start, so there is no existingSessionId.
      //
      // Reaching this means a stale client or a hand-crafted request — once the
      // diagnostic surface collapses on completion this is unreachable in normal
      // use. It is handled explicitly anyway, because the fallback below would
      // show "Something went wrong", which is not what happened. The copy states
      // the fact and offers no retake affordance.
      if (
        res.status === 409 &&
        body?.error === "diagnostic_already_completed"
      ) {
        setError({
          message:
            "You've already completed your diagnostic — it sets your baseline once.",
          code: "diagnostic_already_completed",
        });
        return null;
      }

      // 503 — diagnostic pool insufficient coverage. Curated message only;
      // never expose the raw domain-count string to the student.
      if (
        res.status === 503 &&
        body?.error === "diagnostic_insufficient_coverage"
      ) {
        setError({
          message:
            "The diagnostic isn't available right now — we're adding more questions. Please try again later.",
          code: "diagnostic_insufficient_coverage",
        });
        return null;
      }

      // Other errors — FIXED generic message. Never expose raw server
      // body.message to the student (data-leak vector: internal error
      // strings, DB timeouts, stack traces, etc.).
      setError({
        message: "Something went wrong starting the diagnostic.",
        code: body?.error ?? body?.code,
      });
      return null;
    } catch {
      setError({
        message:
          "Unable to connect right now. Please check your connection and try again.",
      });
      return null;
    } finally {
      setIsStarting(false);
    }
  }, [isStarting]);

  return { startDiagnostic, isStarting, error, clearError };
}
