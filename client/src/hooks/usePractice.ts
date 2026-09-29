import { useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { getClientInstanceId } from "@/lib/client-instance";
import { type HttpApiError } from "@/lib/api-error";

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

export type PracticeSessionFilters = {
  sections?: string[];
  domains?: string[];
  skills?: string[];
  difficulties?: string[];
  targetQuestionCount?: number;
  targetMinutes?: number;
  mode?: string;
};

const inflightEnsureSession = new Map<string, Promise<string>>();

function readSessionId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const id = record.sessionId ?? record.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function usePractice(): {
  startSession: (filters?: PracticeSessionFilters) => Promise<string | null>;
  quotaExhausted: boolean;
  error: string | null;
} {
  const [clientInstanceId] = useState(() => getClientInstanceId());
  const [error, setError] = useState<string | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);

  // -------------------------------------------------------------------
  // startSession — creates a new practice session on the server
  // -------------------------------------------------------------------
  const startSession = useCallback(
    async (f?: PracticeSessionFilters): Promise<string | null> => {
      const lockKey = `start-${JSON.stringify(f)}`;

      const inflight = inflightEnsureSession.get(lockKey);
      if (inflight) {
        return inflight;
      }

      const promise = (async () => {
        const payload: Record<string, unknown> = {
          client_instance_id: clientInstanceId,
          idempotency_key: crypto.randomUUID(),
        };

        if (Array.isArray(f?.sections) && f.sections.length > 0)
          payload.sections = f.sections;
        if (Array.isArray(f?.domains) && f.domains.length > 0)
          payload.domains = f.domains;
        if (Array.isArray(f?.skills) && f.skills.length > 0)
          payload.skills = f.skills;
        if (Array.isArray(f?.difficulties) && f.difficulties.length > 0)
          payload.difficulties = f.difficulties;
        if (typeof f?.targetQuestionCount === "number")
          payload.target_question_count = f.targetQuestionCount;
        if (typeof f?.targetMinutes === "number")
          payload.target_minutes = f.targetMinutes;
        if (typeof f?.mode === "string") payload.mode = f.mode;

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

      inflightEnsureSession.set(lockKey, promise);
      try {
        return await promise;
      } catch (err) {
        const apiErr = err as HttpApiError | Error;
        if ("status" in apiErr && apiErr.status === 402) {
          setQuotaExhausted(true);
        }
        if (
          "status" in apiErr &&
          apiErr.status === 403 &&
          "code" in apiErr &&
          apiErr.code === "SESSION_LIMIT_EXCEEDED"
        ) {
          setError("Session limit exceeded. Close an existing session first.");
        } else {
          setError(
            apiErr instanceof Error
              ? apiErr.message
              : "Failed to start session",
          );
        }
        return null;
      } finally {
        setTimeout(() => inflightEnsureSession.delete(lockKey), 100);
      }
    },
    [clientInstanceId],
  );

  return {
    startSession,
    quotaExhausted,
    error,
  };
}
