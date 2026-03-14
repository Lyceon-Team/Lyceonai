import { useCallback, useEffect, useMemo, useState } from "react";

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

export function useCanonicalPractice(section: PracticeSectionParam) {
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
    if (sessionId) return sessionId;

    const startRes = await fetch("/api/practice/sessions", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        section,
        mode: "balanced",
        client_instance_id: clientInstanceId,
      }),
    });

    if (!startRes.ok) {
      throw new Error(`Failed to start practice session (${startRes.status})`);
    }

    const started = (await startRes.json()) as { sessionId?: string };
    if (!started.sessionId) {
      throw new Error("Server did not return a sessionId");
    }

    setSessionId(started.sessionId);
    return started.sessionId;
  }, [clientInstanceId, section, sessionId]);

  const fetchNextQuestion = useCallback(async () => {
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

      if (!nextRes.ok) {
        throw new Error(`Failed to load next question (${nextRes.status})`);
      }

      const data = (await nextRes.json()) as PracticeNextResponse;

      if (data.sessionId) setSessionId(data.sessionId);
      setSessionItemId(data.sessionItemId ?? null);
      setQuestion(normalizeQuestion(data.question ?? null));

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
  }, [clientInstanceId, ensureSession, resetPerQuestionState]);

  const submitAnswer = useCallback(
    async (opts: { skipped: boolean }) => {
      if (!question) return;

      setIsSubmitting(true);
      setError(null);

      try {
        const effectiveSessionId = await ensureSession();
        const effectiveSessionItemId = sessionItemId;

        if (!effectiveSessionItemId) {
          throw new Error("No active session item. Please load the next question.");
        }

        const payload = {
          sessionId: effectiveSessionId,
          sessionItemId: effectiveSessionItemId,
          selectedOptionId: opts.skipped ? null : selectedAnswer,
          clientAttemptId,
        };

        const res = await fetch("/api/practice/answer", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          throw new Error(`Failed to submit answer (${res.status})`);
        }

        const data = (await res.json()) as PracticeAnswerResponse;

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

            if (data.isCorrect) {
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

        setIsCorrect(!!data.isCorrect);
        setCorrectOptionId(data.correctOptionId ?? null);
        setExplanation(data.explanation ?? null);
        setShowResult(true);
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to submit answer";
        setError(message);
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      clientAttemptId,
      ensureSession,
      fetchNextQuestion,
      question,
      selectedAnswer,
      sessionItemId,
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
  };
}
