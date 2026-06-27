import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getClientInstanceId } from "@/lib/client-instance";
import {
  type RuntimeContractDisabledState,
  parseRuntimeContractDisabledFromPayload,
} from "@/lib/runtime-contract-disable";
import { type HttpApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PracticeOption = {
  id: string;
  text: string;
};

export type PracticeQuestion = {
  sessionItemId?: string;
  questionType?: "multiple_choice" | null;
  stem: string;
  section?: string | null;
  options?: PracticeOption[] | null;
};

export type PracticeSessionFilters = {
  sections?: string[];
  domains?: string[];
  skills?: string[];
  difficulties?: string[];
  targetQuestionCount?: number;
  targetMinutes?: number;
  mode?: string;
};

export type PracticeStats = {
  correct: number;
  incorrect: number;
  skipped: number;
  total: number;
  streak: number;
};

export type PracticeSessionState =
  | "created"
  | "active"
  | "completed"
  | "abandoned";

type NextResponse = {
  sessionId?: string;
  sessionItemId?: string;
  ordinal?: number;
  question: PracticeQuestion | null;
  totalQuestions?: number;
  currentIndex?: number;
  state?: PracticeSessionState;
  stats?: Partial<PracticeStats>;
  calculatorState?: unknown;
};

type AnswerResponse = {
  isCorrect: boolean;
  correctOptionId?: string | null;
  explanation?: string | null;
  state?: PracticeSessionState;
  stats?: Partial<PracticeStats>;
};

type SkipResponse = {
  skipped: true;
  feedback: string;
  state?: PracticeSessionState;
  stats?: Partial<PracticeStats>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inflightEnsureSession = new Map<string, Promise<string>>();

function mergeStats(
  prev: PracticeStats,
  next?: Partial<PracticeStats>,
): PracticeStats {
  if (!next) return prev;
  return {
    correct: typeof next.correct === "number" ? next.correct : prev.correct,
    incorrect:
      typeof next.incorrect === "number" ? next.incorrect : prev.incorrect,
    skipped: typeof next.skipped === "number" ? next.skipped : prev.skipped,
    total: typeof next.total === "number" ? next.total : prev.total,
    streak: typeof next.streak === "number" ? next.streak : prev.streak,
  };
}

function normalizeQuestion(
  raw: PracticeQuestion | null,
): PracticeQuestion | null {
  if (!raw) return null;

  const stem = typeof raw.stem === "string" ? raw.stem : "";
  const section = typeof raw.section === "string" ? raw.section : null;
  const options = Array.isArray(raw.options)
    ? raw.options
        .map((opt) => {
          const id = typeof opt?.id === "string" ? opt.id.trim() : "";
          const text = typeof opt?.text === "string" ? opt.text : "";
          if (!id || !text) return null;
          return { id, text };
        })
        .filter((opt): opt is PracticeOption => !!opt)
    : [];

  if (!stem || options.length === 0) return null;

  return {
    sessionItemId:
      typeof raw.sessionItemId === "string" ? raw.sessionItemId : undefined,
    questionType: "multiple_choice",
    stem,
    section,
    options,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePractice(
  filters?: PracticeSessionFilters,
  initialSessionId?: string | null,
) {
  const queryClient = useQueryClient();
  const [clientInstanceId] = useState(() => getClientInstanceId());

  // Session state
  const [sessionId, setSessionId] = useState<string | null>(
    initialSessionId ?? null,
  );
  const [sessionItemId, setSessionItemId] = useState<string | null>(null);
  const [sessionState, setSessionState] =
    useState<PracticeSessionState>("created");
  const [clientAttemptId, setClientAttemptId] = useState(() =>
    crypto.randomUUID(),
  );

  // Question state
  const [question, setQuestion] = useState<PracticeQuestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);

  // Answer selection state
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Result state
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [correctOptionId, setCorrectOptionId] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);

  // Progress state
  const [stats, setStats] = useState<PracticeStats>({
    correct: 0,
    incorrect: 0,
    skipped: 0,
    total: 0,
    streak: 0,
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState<number | undefined>(
    undefined,
  );

  // Runtime contract
  const [runtimeDisabled, setRuntimeDisabled] =
    useState<RuntimeContractDisabledState | null>(null);

  // Calculator state
  const [calculatorState, setCalculatorState] = useState<unknown>(null);

  // Derived: can the user submit?
  const canSubmit = useMemo(() => {
    if (!question) return false;
    return !!selectedAnswer;
  }, [question, selectedAnswer]);

  // Derived: is session terminal?
  const isSessionComplete = useMemo(
    () => sessionState === "completed" || sessionState === "abandoned",
    [sessionState],
  );

  const resetPerQuestionState = useCallback(() => {
    setSelectedAnswer(null);
    setShowResult(false);
    setIsCorrect(null);
    setCorrectOptionId(null);
    setExplanation(null);
    setClientAttemptId(crypto.randomUUID());
  }, []);

  // -------------------------------------------------------------------
  // startSession — creates a new practice session on the server
  // -------------------------------------------------------------------
  const startSession = useCallback(
    async (
      overrideFilters?: PracticeSessionFilters,
    ): Promise<string | null> => {
      if (runtimeDisabled) {
        setError(`${runtimeDisabled.code}: ${runtimeDisabled.message}`);
        return null;
      }

      const f = overrideFilters ?? filters;

      const lockKey = initialSessionId
        ? `resume-${initialSessionId}`
        : `start-${JSON.stringify(f)}`;

      if (inflightEnsureSession.has(lockKey)) {
        const id = await inflightEnsureSession.get(lockKey)!;
        setSessionId(id);
        return id;
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

        const body = await res.json();

        const disabled = parseRuntimeContractDisabledFromPayload(
          "practice",
          res.status,
          body,
        );
        if (disabled) {
          setRuntimeDisabled(disabled);
          throw new Error(`${disabled.code}: ${disabled.message}`);
        }

        const newId = body?.sessionId ?? body?.id;
        if (!newId) {
          throw new Error("Server did not return a sessionId");
        }

        setSessionId(newId);
        setSessionState("active");
        if (Object.prototype.hasOwnProperty.call(body, "calculatorState")) {
          setCalculatorState(body.calculatorState ?? null);
        }

        return newId as string;
      })();

      inflightEnsureSession.set(lockKey, promise);
      try {
        const id = await promise;
        return id;
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
    [clientInstanceId, filters, initialSessionId, runtimeDisabled],
  );

  // -------------------------------------------------------------------
  // fetchNextQuestion
  // -------------------------------------------------------------------
  const fetchNextQuestion = useCallback(
    async (sessId?: string): Promise<NextResponse | null> => {
      if (runtimeDisabled) return null;

      setIsLoading(true);
      setError(null);

      try {
        const effectiveSessionId = sessId ?? sessionId;
        if (!effectiveSessionId) {
          throw new Error("No active session. Call startSession first.");
        }

        const url =
          `/api/practice/sessions/${encodeURIComponent(effectiveSessionId)}/next` +
          `?client_instance_id=${encodeURIComponent(clientInstanceId)}`;

        const res = await apiRequest(url, { method: "GET" });
        const body = await res.json();

        const disabled = parseRuntimeContractDisabledFromPayload(
          "practice",
          res.status,
          body,
        );
        if (disabled) {
          setRuntimeDisabled(disabled);
          setError(`${disabled.code}: ${disabled.message}`);
          setQuestion(null);
          setSessionItemId(null);
          return null;
        }

        const data = (body ?? {}) as NextResponse;

        if (data.sessionId) setSessionId(data.sessionId);
        setSessionItemId(data.sessionItemId ?? null);
        setQuestion(normalizeQuestion(data.question ?? null));
        if (data.state) setSessionState(data.state);
        if (Object.prototype.hasOwnProperty.call(data, "calculatorState")) {
          setCalculatorState(data.calculatorState ?? null);
        }
        if (typeof data.totalQuestions === "number")
          setTotalQuestions(data.totalQuestions);
        if (typeof data.currentIndex === "number")
          setCurrentIndex(data.currentIndex);
        if (typeof data.ordinal === "number")
          setCurrentIndex(Math.max(0, data.ordinal - 1));
        if (data.stats) setStats((prev) => mergeStats(prev, data.stats));

        resetPerQuestionState();
        return data;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load question";
        setError(message);
        setQuestion(null);
        setSessionItemId(null);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [clientInstanceId, resetPerQuestionState, runtimeDisabled, sessionId],
  );

  // -------------------------------------------------------------------
  // submitAnswer
  // -------------------------------------------------------------------
  const submitAnswer = useCallback(
    async (answer?: string): Promise<AnswerResponse | null> => {
      if (runtimeDisabled) return null;
      if (!question) return null;

      const effectiveAnswer = answer ?? selectedAnswer;
      if (!effectiveAnswer) return null;

      setIsSubmitting(true);
      setError(null);

      try {
        if (!sessionId) throw new Error("No active session.");
        if (!sessionItemId)
          throw new Error("No active session item. Load the next question.");

        const payload = {
          sessionId,
          sessionItemId,
          selectedAnswer: effectiveAnswer,
          clientAttemptId,
        };

        const res = await apiRequest("/api/practice/answer", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        const body = await res.json();
        const disabled = parseRuntimeContractDisabledFromPayload(
          "practice",
          res.status,
          body,
        );
        if (disabled) {
          setRuntimeDisabled(disabled);
          setError(`${disabled.code}: ${disabled.message}`);
          return null;
        }

        const data = (body ?? {}) as AnswerResponse;
        if (data.state) setSessionState(data.state);

        if (data.stats) {
          setStats((prev) => mergeStats(prev, data.stats));
        } else {
          setStats((prev) => {
            const next = { ...prev };
            next.total = prev.total + 1;
            if (data.isCorrect) {
              next.correct = prev.correct + 1;
              next.streak = prev.streak + 1;
            } else {
              next.incorrect = prev.incorrect + 1;
              next.streak = 0;
            }
            return next;
          });
        }

        setIsCorrect(!!data.isCorrect);
        setCorrectOptionId(data.correctOptionId ?? null);
        setExplanation(data.explanation ?? null);
        setShowResult(true);

        return data;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to submit answer";
        setError(message);
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      clientAttemptId,
      question,
      runtimeDisabled,
      selectedAnswer,
      sessionId,
      sessionItemId,
    ],
  );

  // -------------------------------------------------------------------
  // skipQuestion
  // -------------------------------------------------------------------
  const skipQuestion = useCallback(async (): Promise<boolean> => {
    if (runtimeDisabled) return false;
    if (!question) return false;

    setIsSubmitting(true);
    setError(null);

    try {
      if (!sessionId) throw new Error("No active session.");
      if (!sessionItemId)
        throw new Error("No active session item. Load the next question.");

      const payload = {
        sessionItemId,
        clientAttemptId,
      };

      const res = await apiRequest(
        `/api/practice/sessions/${encodeURIComponent(sessionId)}/skip`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );

      const body = await res.json();
      const disabled = parseRuntimeContractDisabledFromPayload(
        "practice",
        res.status,
        body,
      );
      if (disabled) {
        setRuntimeDisabled(disabled);
        setError(`${disabled.code}: ${disabled.message}`);
        return false;
      }

      const data = (body ?? {}) as SkipResponse;
      if (data.state) setSessionState(data.state);

      if (data.stats) {
        setStats((prev) => mergeStats(prev, data.stats));
      } else {
        setStats((prev) => ({
          ...prev,
          skipped: prev.skipped + 1,
          total: prev.total + 1,
          streak: 0,
        }));
      }

      // Auto-advance to next question after skip
      await fetchNextQuestion();
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to skip question";
      setError(message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [
    clientAttemptId,
    fetchNextQuestion,
    question,
    runtimeDisabled,
    sessionId,
    sessionItemId,
  ]);

  // -------------------------------------------------------------------
  // terminateSession
  // -------------------------------------------------------------------
  const terminateSession = useCallback(async (): Promise<boolean> => {
    if (runtimeDisabled) return false;
    if (!sessionId) return false;
    if (isSessionComplete) return true;

    try {
      const res = await apiRequest(
        `/api/practice/sessions/${encodeURIComponent(sessionId)}/terminate`,
        {
          method: "POST",
          body: JSON.stringify({ client_instance_id: clientInstanceId }),
        },
      );

      const body = await res.json();
      const disabled = parseRuntimeContractDisabledFromPayload(
        "practice",
        res.status,
        body,
      );
      if (disabled) {
        setRuntimeDisabled(disabled);
        throw new Error(`${disabled.code}: ${disabled.message}`);
      }

      setSessionState("abandoned");
      setSessionItemId(null);
      setQuestion(null);
      setCalculatorState(null);

      queryClient.invalidateQueries({
        queryKey: ["/api/practice/sessions/open"],
      });

      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to terminate session";
      setError(message);
      return false;
    }
  }, [
    clientInstanceId,
    isSessionComplete,
    queryClient,
    runtimeDisabled,
    sessionId,
  ]);

  // -------------------------------------------------------------------
  // nextQuestion — advances to the next question after viewing a result
  // -------------------------------------------------------------------
  const nextQuestion = useCallback(async () => {
    await fetchNextQuestion();
  }, [fetchNextQuestion]);

  // -------------------------------------------------------------------
  // persistCalculatorState
  // -------------------------------------------------------------------
  const persistCalculatorState = useCallback(
    async (nextCalcState: unknown): Promise<unknown> => {
      if (runtimeDisabled) return null;
      if (!sessionId) return null;
      if (isSessionComplete) return null;

      const res = await apiRequest(
        `/api/practice/sessions/${encodeURIComponent(sessionId)}/calculator-state`,
        {
          method: "POST",
          body: JSON.stringify({
            client_instance_id: clientInstanceId,
            calculator_state: nextCalcState,
          }),
        },
      );

      const body = await res.json();
      const disabled = parseRuntimeContractDisabledFromPayload(
        "practice",
        res.status,
        body,
      );
      if (disabled) {
        setRuntimeDisabled(disabled);
        throw new Error(`${disabled.code}: ${disabled.message}`);
      }

      const value = Object.prototype.hasOwnProperty.call(
        body,
        "calculatorState",
      )
        ? (body.calculatorState ?? null)
        : (nextCalcState ?? null);

      setCalculatorState(value);
      return value;
    },
    [clientInstanceId, isSessionComplete, runtimeDisabled, sessionId],
  );

  return {
    // Session
    sessionId,
    sessionState,
    isSessionComplete,

    // Question
    question,
    isLoading,
    error,
    quotaExhausted,

    // Answer selection
    selectedAnswer,
    setSelectedAnswer,
    canSubmit,

    // Submission
    isSubmitting,

    // Result
    showResult,
    isCorrect,
    correctOptionId,
    explanation,

    // Progress
    stats,
    currentIndex,
    totalQuestions,

    // Calculator
    calculatorState,
    persistCalculatorState,

    // Runtime contract
    runtimeDisabled,

    // Actions
    startSession,
    fetchNextQuestion,
    submitAnswer,
    skipQuestion,
    nextQuestion,
    terminateSession,
  };
}
