import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type RuntimeContractDisabledState,
  parseRuntimeContractDisabledFromPayload,
} from "@/lib/runtime-contract-disable";

export type PracticeSectionParam = "math" | "reading_writing" | "random";

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

export type PracticeNextResponse = {
  sessionId?: string;
  sessionItemId?: string;
  ordinal?: number;
  calculatorState?: unknown | null;
  question: PracticeQuestion | null;
  totalQuestions?: number;
  currentIndex?: number;
  state?: "created" | "active" | "completed" | "abandoned";
  stats?: {
    correct?: number;
    incorrect?: number;
    skipped?: number;
    total?: number;
    streak?: number;
  };
};

export type PracticeAnswerResponse = {
  isCorrect: boolean;
  correctOptionId?: string | null;
  explanation?: string | null;
  state?: "active" | "completed" | "abandoned";
  stats?: {
    correct?: number;
    incorrect?: number;
    skipped?: number;
    total?: number;
    streak?: number;
  };
};

export type PracticeSkipResponse = {
  skipped: true;
  feedback: "Skipped";
  state?: "active" | "completed" | "abandoned";
  stats?: {
    correct?: number;
    incorrect?: number;
    skipped?: number;
    total?: number;
    streak?: number;
  };
};

export type PracticeSessionSpecInput = {
  sections?: string[];
  domains?: string[];
  difficulties?: string[];
  targetMinutes?: number;
  targetQuestionCount?: number;
  mode?: string;
};

function mergeStats(
  prev: { correct: number; incorrect: number; skipped: number; total: number; streak: number },
  next?: PracticeNextResponse["stats"] | PracticeAnswerResponse["stats"]
) {
  if (!next) return prev;
  return {
    correct: typeof next.correct === "number" ? next.correct : prev.correct,
    incorrect: typeof next.incorrect === "number" ? next.incorrect : prev.incorrect,
    skipped: typeof next.skipped === "number" ? next.skipped : prev.skipped,
    total: typeof next.total === "number" ? next.total : prev.total,
    streak: typeof next.streak === "number" ? next.streak : prev.streak,
  };
}

function isMultipleChoice(question: PracticeQuestion | null): boolean {
  return !!question && question.questionType === "multiple_choice";
}

function normalizeQuestion(raw: PracticeQuestion | null): PracticeQuestion | null {
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
    sessionItemId: typeof raw.sessionItemId === "string" ? raw.sessionItemId : undefined,
    questionType: "multiple_choice",
    stem,
    section,
    options,
  };
}

export function useCanonicalPractice(section: PracticeSectionParam, sessionSpec?: PracticeSessionSpecInput) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionItemId, setSessionItemId] = useState<string | null>(null);
  const [clientInstanceId] = useState(() => crypto.randomUUID());
  const [clientAttemptId, setClientAttemptId] = useState(() => crypto.randomUUID());

  const [question, setQuestion] = useState<PracticeQuestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [freeResponseAnswer, setFreeResponseAnswer] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [correctOptionId, setCorrectOptionId] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<"created" | "active" | "completed" | "abandoned">("created");
  const [calculatorState, setCalculatorState] = useState<unknown | null>(null);
  const [runtimeDisabled, setRuntimeDisabled] = useState<RuntimeContractDisabledState | null>(null);

  const [score, setScore] = useState({
    correct: 0,
    incorrect: 0,
    skipped: 0,
    total: 0,
    streak: 0,
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState<number | undefined>(undefined);

  const canSubmit = useMemo(() => {
    if (!question) return false;
    if (isMultipleChoice(question)) return !!selectedAnswer;
    return freeResponseAnswer.trim().length > 0;
  }, [question, selectedAnswer, freeResponseAnswer]);

  const resetPerQuestionState = useCallback(() => {
    setSelectedAnswer(null);
    setFreeResponseAnswer("");
    setShowResult(false);
    setIsCorrect(null);
    setCorrectOptionId(null);
    setExplanation(null);
    setClientAttemptId(crypto.randomUUID());
  }, []);

  const ensureSession = useCallback(async () => {
    if (runtimeDisabled) {
      throw new Error(`${runtimeDisabled.code}: ${runtimeDisabled.message}`);
    }
    if (sessionId) return sessionId;

    const startPayload: Record<string, unknown> = {
      section,
      mode: sessionSpec?.mode ?? "balanced",
      client_instance_id: clientInstanceId,
    };

    if (Array.isArray(sessionSpec?.sections)) startPayload.sections = sessionSpec.sections;
    if (Array.isArray(sessionSpec?.domains)) startPayload.domains = sessionSpec.domains;
    if (Array.isArray(sessionSpec?.difficulties)) startPayload.difficulties = sessionSpec.difficulties;
    if (typeof sessionSpec?.targetMinutes === "number") startPayload.target_minutes = sessionSpec.targetMinutes;
    if (typeof sessionSpec?.targetQuestionCount === "number") startPayload.target_question_count = sessionSpec.targetQuestionCount;

    const startRes = await fetch("/api/practice/sessions", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(startPayload),
    });

    const startPayloadBody = await startRes.json().catch(() => null);
    const disabled = parseRuntimeContractDisabledFromPayload("practice", startRes.status, startPayloadBody);
    if (disabled) {
      setRuntimeDisabled(disabled);
      throw new Error(`${disabled.code}: ${disabled.message}`);
    }

    if (!startRes.ok) {
      throw new Error(`Failed to start practice session (${startRes.status})`);
    }

    const started = (startPayloadBody ?? {}) as { sessionId?: string; calculatorState?: unknown | null };
    if (!started.sessionId) {
      throw new Error("Server did not return a sessionId");
    }

    setSessionId(started.sessionId);
    if (Object.prototype.hasOwnProperty.call(started, "calculatorState")) {
      setCalculatorState(started.calculatorState ?? null);
    }
    return started.sessionId;
  }, [clientInstanceId, runtimeDisabled, section, sessionId, sessionSpec?.difficulties, sessionSpec?.domains, sessionSpec?.mode, sessionSpec?.sections, sessionSpec?.targetMinutes, sessionSpec?.targetQuestionCount]);

  const fetchNextQuestion = useCallback(async () => {
    if (runtimeDisabled) return null;
    setIsLoading(true);
    setError(null);

    try {
      const effectiveSessionId = await ensureSession();
      const nextRes = await fetch(
        `/api/practice/sessions/${encodeURIComponent(effectiveSessionId)}/next?client_instance_id=${encodeURIComponent(clientInstanceId)}`,
        {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        }
      );

      const nextPayloadBody = await nextRes.json().catch(() => null);
      const disabled = parseRuntimeContractDisabledFromPayload("practice", nextRes.status, nextPayloadBody);
      if (disabled) {
        setRuntimeDisabled(disabled);
        setError(`${disabled.code}: ${disabled.message}`);
        setQuestion(null);
        setSessionItemId(null);
        return null;
      }

      if (!nextRes.ok) {
        throw new Error(`Failed to load next question (${nextRes.status})`);
      }

      const data = (nextPayloadBody ?? {}) as PracticeNextResponse;

      if (data.sessionId) setSessionId(data.sessionId);
      setSessionItemId(data.sessionItemId ?? null);
      setQuestion(normalizeQuestion(data.question ?? null));
      if (data.state) setSessionState(data.state);
      if (Object.prototype.hasOwnProperty.call(data, "calculatorState")) {
        setCalculatorState(data.calculatorState ?? null);
      }

      if (typeof data.totalQuestions === "number") setTotalQuestions(data.totalQuestions);
      if (typeof data.currentIndex === "number") setCurrentIndex(data.currentIndex);
      if (typeof data.ordinal === "number") setCurrentIndex(Math.max(0, data.ordinal - 1));

      if (data.stats) {
        setScore((prev) => mergeStats(prev, data.stats));
      }

      resetPerQuestionState();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load question";
      setError(message);
      setQuestion(null);
      setSessionItemId(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [clientInstanceId, ensureSession, resetPerQuestionState, runtimeDisabled]);

  const submitAnswer = useCallback(
    async (opts: { skipped: boolean }) => {
      if (runtimeDisabled) return null;
      if (!question) return;

      setIsSubmitting(true);
      setError(null);

      try {
        const effectiveSessionId = await ensureSession();
        const effectiveSessionItemId = sessionItemId;

        if (!effectiveSessionItemId) {
          throw new Error("No active session item. Please load the next question.");
        }

        const endpoint = opts.skipped
          ? `/api/practice/sessions/${encodeURIComponent(effectiveSessionId)}/skip`
          : "/api/practice/answer";

        const payload = opts.skipped
          ? {
              sessionItemId: effectiveSessionItemId,
              clientAttemptId,
              client_instance_id: clientInstanceId,
            }
          : {
              sessionId: effectiveSessionId,
              sessionItemId: effectiveSessionItemId,
              selectedOptionId: selectedAnswer,
              clientAttemptId,
            };

        const res = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const payloadBody = await res.json().catch(() => null);
        const disabled = parseRuntimeContractDisabledFromPayload("practice", res.status, payloadBody);
        if (disabled) {
          setRuntimeDisabled(disabled);
          setError(`${disabled.code}: ${disabled.message}`);
          return null;
        }

        if (!res.ok) {
          throw new Error(`Failed to submit answer (${res.status})`);
        }

        const data = (payloadBody ?? {}) as PracticeAnswerResponse | PracticeSkipResponse;
        if (data.state) setSessionState(data.state);

        if (data.stats) {
          setScore((prev) => mergeStats(prev, data.stats));
        } else {
          setScore((prev) => {
            const next = { ...prev };
            next.total = prev.total + 1;

            if (opts.skipped) {
              next.skipped = (prev.skipped ?? 0) + 1;
              next.streak = 0;
              return next;
            }

            if (!opts.skipped && "isCorrect" in data && data.isCorrect) {
              next.correct = prev.correct + 1;
              next.streak = prev.streak + 1;
            } else {
              next.incorrect = (prev.incorrect ?? 0) + 1;
              next.streak = 0;
            }
            return next;
          });
        }

        if (opts.skipped) {
          await fetchNextQuestion();
          return;
        }

        const answerData = data as PracticeAnswerResponse;
        setIsCorrect(!!answerData.isCorrect);
        setCorrectOptionId(answerData.correctOptionId ?? null);
        setExplanation(answerData.explanation ?? null);
        setShowResult(true);
        return answerData;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to submit answer";
        setError(message);
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      clientInstanceId,
      clientAttemptId,
      ensureSession,
      fetchNextQuestion,
      question,
      selectedAnswer,
      sessionItemId,
      runtimeDisabled,
    ]
  );

  const nextQuestion = useCallback(async () => {
    await fetchNextQuestion();
  }, [fetchNextQuestion]);

  const handleMissingMcChoices = useCallback(async () => {
    if (!question) return;
    if (!isMultipleChoice(question)) return;
    await submitAnswer({ skipped: true });
  }, [question, submitAnswer]);

  const terminateSession = useCallback(async () => {
    if (runtimeDisabled) return null;
    if (!sessionId) return null;
    if (sessionState === "completed" || sessionState === "abandoned") return { state: sessionState };

    const res = await fetch(`/api/practice/sessions/${encodeURIComponent(sessionId)}/terminate`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ client_instance_id: clientInstanceId }),
    });

    const payloadBody = await res.json().catch(() => null);
    const disabled = parseRuntimeContractDisabledFromPayload("practice", res.status, payloadBody);
    if (disabled) {
      setRuntimeDisabled(disabled);
      throw new Error(`${disabled.code}: ${disabled.message}`);
    }

    if (!res.ok) {
      throw new Error(`Failed to terminate session (${res.status})`);
    }

    const data = (payloadBody ?? {}) as { state?: "abandoned" };
    if (data.state === "abandoned") {
      setSessionState("abandoned");
      setSessionItemId(null);
      setQuestion(null);
      setCalculatorState(null);
    }
    return data;
  }, [clientInstanceId, runtimeDisabled, sessionId, sessionState]);

  const persistCalculatorState = useCallback(async (nextCalculatorState: unknown | null) => {
    if (runtimeDisabled) return null;
    if (!sessionId) return null;
    if (sessionState === "completed" || sessionState === "abandoned") return null;

    const res = await fetch(`/api/practice/sessions/${encodeURIComponent(sessionId)}/calculator-state`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_instance_id: clientInstanceId,
        calculator_state: nextCalculatorState,
      }),
    });

    const payloadBody = await res.json().catch(() => null);
    const disabled = parseRuntimeContractDisabledFromPayload("practice", res.status, payloadBody);
    if (disabled) {
      setRuntimeDisabled(disabled);
      throw new Error(`${disabled.code}: ${disabled.message}`);
    }

    if (!res.ok) {
      throw new Error(`Failed to persist calculator state (${res.status})`);
    }

    const data = (payloadBody ?? {}) as { calculatorState?: unknown | null };
    const value = Object.prototype.hasOwnProperty.call(data, "calculatorState")
      ? data.calculatorState ?? null
      : nextCalculatorState;

    setCalculatorState(value ?? null);
    return value ?? null;
  }, [clientInstanceId, runtimeDisabled, sessionId, sessionState]);

  useEffect(() => {
    fetchNextQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    question,
    isLoading,
    error,

    selectedAnswer,
    setSelectedAnswer,
    freeResponseAnswer,
    setFreeResponseAnswer,

    isSubmitting,

    showResult,
    isCorrect,
    correctOptionId,
    explanation,

    score,
    currentIndex,
    totalQuestions,

    canSubmit,

    fetchNextQuestion,
    submitAnswer,
    nextQuestion,
    handleMissingMcChoices,
    terminateSession,
    calculatorState,
    persistCalculatorState,
    runtimeDisabled,
  };
}
