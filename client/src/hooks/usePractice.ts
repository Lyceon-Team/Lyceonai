import { useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { getClientInstanceId } from "@/lib/client-instance";
import { type HttpApiError } from "@/lib/api-error";
import type { SessionCriteria } from "@lyceon/shared/session-criteria";

/**
 * @spec [Doc-02B_V4 §16; Coding Standards §9; register UI-06] | @implemented [2026-09-29]
 * plain English: the practice LANDING page's session starter. It creates a practice
 * session (`POST /api/practice/sessions`) and reports two things the landing renders:
 * the daily-quota state (402) and every other start error. The question loop itself —
 * next / answer / skip / terminate / calculator-state — lives in `useCanonicalPractice`
 * and `CanonicalPracticePage`.
 *
 * trade-offs: this hook used to carry its own copy of that loop, which nothing reached
 * (`pages/practice.tsx` is the only importer and reads `startSession`, `quotaExhausted`
 * and `error` only). UI-06 deleted the unreached methods and the state only they used,
 * including a runtime-contract disable branch that could never fire: `apiRequest`
 * throws on every non-2xx, so a 503 body never reached the parser, and no server
 * route emits a runtime-contract disable code.
 *
 * edge cases: concurrent or strict-mode double calls with the same filters share one
 * in-flight request (`inflightEnsureSession`), so a double click creates one session.
 */

/**
 * @spec [register §6 UI-43 / UI-51 (one criteria shape), §9 OQ-22; wiring table §4 Practice
 *        "Start"] | @implemented [2026-10-03] | plain English: what the Practice page starts a
 * session with: the student's chosen `criteria` (the shared `SessionCriteria`, the same shape
 * the filter bar holds and the server names the session by) and the questions per session. An
 * empty criterion is not sent, which the route reads as "no constraint" (OQ-22).
 */
export type PracticeSessionStart = {
  criteria: SessionCriteria;
  targetQuestionCount: number;
};

const inflightEnsureSession = new Map<string, Promise<string>>();

function readSessionId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const id = record.sessionId ?? record.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function usePractice(): {
  startSession: (start: PracticeSessionStart) => Promise<string | null>;
  quotaExhausted: boolean;
  poolEmpty: boolean;
  error: string | null;
} {
  const [clientInstanceId] = useState(() => getClientInstanceId());
  const [error, setError] = useState<string | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  // UI-07: the chosen filters select no questions (server 422 PRACTICE_POOL_EMPTY).
  const [poolEmpty, setPoolEmpty] = useState(false);

  /** Turns a refused start into the page's states. Each refusal names no count. */
  const report = useCallback((err: unknown): void => {
    const apiErr = err as HttpApiError | Error;
    if ("status" in apiErr && apiErr.status === 402) {
      setQuotaExhausted(true);
    }
    // @spec [Doc-02B_V4 §14; owner ruling UI-07 2026-09-29] | @implemented [2026-09-29]
    // plain English: practice-canonical.ts answers 422 `PRACTICE_POOL_EMPTY` when the
    // filters select no questions. Surface it as its own state so the page can say
    // "No questions match these filters" (no count) instead of a generic failure.
    if (
      "status" in apiErr &&
      apiErr.status === 422 &&
      "code" in apiErr &&
      apiErr.code === "PRACTICE_POOL_EMPTY"
    ) {
      setPoolEmpty(true);
      setError("No questions match these filters");
    } else if (
      "status" in apiErr &&
      apiErr.status === 403 &&
      "code" in apiErr &&
      apiErr.code === "SESSION_LIMIT_EXCEEDED"
    ) {
      setError("Session limit exceeded. Close an existing session first.");
    } else {
      setError(
        apiErr instanceof Error ? apiErr.message : "Failed to start session",
      );
    }
  }, []);

  // -------------------------------------------------------------------
  // startSession — creates a new practice session on the server
  // -------------------------------------------------------------------
  // UI-51 (2026-10-03): a second call that joins an in-flight start goes through the same
  // try/catch as the first (it used to return the raw promise, so a refused start reached the
  // caller as an unhandled rejection), and a refused start leaves the in-flight map at once, so
  // the next click asks the server again instead of replaying the refusal for 100 ms.
  const startSession = useCallback(
    async (start: PracticeSessionStart): Promise<string | null> => {
      const lockKey = `start-${JSON.stringify(start)}`;
      setPoolEmpty(false);
      setError(null);
      const inflight = inflightEnsureSession.get(lockKey);
      const promise =
        inflight ??
        (async () => {
          const { criteria } = start;
          const payload: Record<string, unknown> = {
            client_instance_id: clientInstanceId,
            idempotency_key: crypto.randomUUID(),
            target_question_count: start.targetQuestionCount,
          };
          if (criteria.sections.length > 0)
            payload.sections = criteria.sections;
          if (criteria.domains.length > 0) payload.domains = criteria.domains;
          if (criteria.skills.length > 0) payload.skills = criteria.skills;
          if (criteria.difficulties.length > 0)
            payload.difficulties = criteria.difficulties;

          const res = await apiRequest("/api/practice/sessions", {
            method: "POST",
            body: JSON.stringify(payload),
          });

          const body: unknown = await res.json();
          const newId = readSessionId(body);
          if (!newId) {
            throw new Error("Server did not return a sessionId");
          }
          return newId;
        })();

      if (inflight === undefined) {
        inflightEnsureSession.set(lockKey, promise);
      }
      try {
        const sessionId = await promise;
        if (inflight === undefined) {
          setTimeout(() => inflightEnsureSession.delete(lockKey), 100);
        }
        return sessionId;
      } catch (err) {
        if (inflightEnsureSession.get(lockKey) === promise) {
          inflightEnsureSession.delete(lockKey);
        }
        report(err);
        return null;
      }
    },
    [clientInstanceId, report],
  );

  return {
    poolEmpty,
    startSession,
    quotaExhausted,
    error,
  };
}
