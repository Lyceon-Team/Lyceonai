import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PracticeSectionParam = "math" | "reading-writing" | "random";

export type PracticeQuestion = {
  id: string;
  type: "mc" | "fr";
  stem: string;
  section?: string | null;
  options?: { key?: string | null; text?: string | null; value?: string | null }[] | null;
};

export type PracticeNextResponse = {
  sessionId?: string;
  question: PracticeQuestion | null;
  totalQuestions?: number;
  currentIndex?: number;
  // If your backend now returns stats, keep this optional to avoid breaking.
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
  correctAnswerKey?: string | null;
  explanation?: string | null;
  // If your backend returns stats here too, keep optional.
  stats?: {
    correct?: number;
    incorrect?: number;
    skipped?: number;
    total?: number;
    streak?: number;
  };
};

function nowMs() {
  return Date.now();
}

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

export function useCanonicalPractice(section: PracticeSectionParam) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clientInstanceId] = useState(() => crypto.randomUUID());
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const [question, setQuestion] = useState<PracticeQuestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [freeResponseAnswer, setFreeResponseAnswer] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [correctAnswerKey, setCorrectAnswerKey] = useState<string | null>(null);
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

  const questionStartMs = useRef<number>(nowMs());

  const canSubmit = useMemo(() => {
    if (!question) return false;
    if (question.type === "mc") return !!selectedAnswer;
    return freeResponseAnswer.trim().length > 0;
  }, [question, selectedAnswer, freeResponseAnswer]);

  const resetPerQuestionState = useCallback(() => {
    setSelectedAnswer(null);
    setFreeResponseAnswer("");
    setShowResult(false);
    setIsCorrect(null);
    setCorrectAnswerKey(null);
    setExplanation(null);
    setIdempotencyKey(crypto.randomUUID());
    questionStartMs.current = nowMs();
  }, []);

  const fetchNextQuestion = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/practice/next?section=${encodeURIComponent(section)}&client_instance_id=${encodeURIComponent(clientInstanceId)}`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) throw new Error(`Failed to load next question (${res.status})`);

      const data = (await res.json()) as PracticeNextResponse;

      if (data.sessionId) setSessionId(data.sessionId);
      setQuestion(data.question ?? null);
      if (typeof data.totalQuestions === "number") setTotalQuestions(data.totalQuestions);
      if (typeof data.currentIndex === "number") setCurrentIndex(data.currentIndex);

      // If backend returns stats (rehydration), adopt it.
      if (data.stats) {
        setScore((prev) => mergeStats(prev, data.stats));
      }

      resetPerQuestionState();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load question";
      setError(message);
      setQuestion(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [resetPerQuestionState, section]);

  const submitAnswer = useCallback(
    async (opts: { skipped: boolean }) => {
      if (!question) return;

      setIsSubmitting(true);
      setError(null);
      try {
        const elapsedMs = Math.max(0, nowMs() - questionStartMs.current);

        const payload = {
          sessionId,
          questionId: question.id,
          selectedAnswer: question.type === "mc" ? (opts.skipped ? null : selectedAnswer) : null,
          freeResponseAnswer: question.type === "fr" ? (opts.skipped ? "" : freeResponseAnswer) : "",
          elapsedMs,
          skipped: opts.skipped,
          client_instance_id: clientInstanceId,
          idempotencyKey,
        };

        const res = await fetch("/api/practice/answer", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error(`Failed to submit answer (${res.status})`);

        const data = (await res.json()) as PracticeAnswerResponse;

        // Prefer server stats if available (deterministic session rehydration).
        if (data.stats) {
          setScore((prev) => mergeStats(prev, data.stats));
        } else {
          // Fallback: client increments if server doesn’t provide stats.
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

        // Skip immediately advances.
        if (opts.skipped) {
          await fetchNextQuestion();
          return;
        }

        setIsCorrect(!!data.isCorrect);
        setCorrectAnswerKey(data.correctAnswerKey ?? null);
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
    [fetchNextQuestion, freeResponseAnswer, question, selectedAnswer]
  );

  const nextQuestion = useCallback(async () => {
    await fetchNextQuestion();
  }, [fetchNextQuestion]);

  const handleMissingMcChoices = useCallback(async () => {
    if (!question) return;
    if (question.type !== "mc") return;
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
    correctAnswerKey,
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
