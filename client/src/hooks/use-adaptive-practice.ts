import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { StudentQuestion } from '@shared/schema';

export type SectionType = 'math' | 'rw';
export type SelectionMode = 'balanced' | 'skill' | 'cluster' | 'flow' | 'structured' | 'practice';

interface AdaptivePracticeOptions {
  section: SectionType;
  mode?: SelectionMode;
  enabled?: boolean;
  calendarDayId?: string;
}

interface SelectionRationale {
  mode: string;
  section: string;
  sessionId: string;
  cursor: number;
  attemptedCount: number;
  remainingCount: number;
  exhausted?: boolean;
  idx?: number;
  seed?: number;
}

interface NextQuestionResponse {
  sessionId: string;
  sessionItemId?: string;
  question: StudentQuestion | null;
  rationale?: SelectionRationale;
  state?: 'created' | 'active' | 'completed' | 'abandoned';
  stats?: Partial<ScoreState>;
  requestId?: string;
}

interface AnswerResponse {
  ok: boolean;
  isCorrect: boolean;
  outcome: 'correct' | 'incorrect' | 'skipped';
  correctAnswerKey: string | null;
  explanation: string | null;
  sessionId: string;
  questionId: string;
  deduped?: boolean;
  state?: 'created' | 'active' | 'completed' | 'abandoned';
  requestId?: string;
}

interface ValidationResult {
  isCorrect: boolean;
  outcome: 'correct' | 'incorrect' | 'skipped';
  correctAnswerKey: string | null;
  explanation: string | null;
}

interface ScoreState {
  correct: number;
  incorrect: number;
  skipped: number;
  total: number;
  streak: number;
  bestStreak: number;
}

export function useAdaptivePractice({ section, mode = 'balanced', enabled = true, calendarDayId }: AdaptivePracticeOptions) {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionItemId, setSessionItemId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<StudentQuestion | null>(null);
  const [rationale, setRationale] = useState<SelectionRationale | null>(null);
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [score, setScore] = useState<ScoreState>({ correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0, bestStreak: 0 });
  const [exhausted, setExhausted] = useState(false);
  const [clientInstanceId] = useState(() =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `adaptive-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  
  const excludeCanonicalIdsRef = useRef<string[]>([]);
  const MAX_EXCLUSIONS = 20;

  const applyServerStats = useCallback((stats?: Partial<ScoreState>) => {
    if (!stats) return;
    setScore((prev) => ({
      ...prev,
      correct: typeof stats.correct === 'number' ? stats.correct : prev.correct,
      incorrect: typeof stats.incorrect === 'number' ? stats.incorrect : prev.incorrect,
      skipped: typeof stats.skipped === 'number' ? stats.skipped : prev.skipped,
      total: typeof stats.total === 'number' ? stats.total : prev.total,
      streak: typeof stats.streak === 'number' ? stats.streak : prev.streak,
      bestStreak:
        typeof stats.streak === 'number'
          ? Math.max(prev.bestStreak, stats.streak)
          : prev.bestStreak,
    }));
  }, []);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionId) return sessionId;

    const response = await apiRequest('/api/practice/sessions', {
      method: 'POST',
      body: JSON.stringify({
        section,
        mode,
        client_instance_id: clientInstanceId,
      }),
    });
    const data = await response.json();
    const nextSessionId = data?.sessionId || data?.id || null;
    if (!nextSessionId) {
      throw new Error('Failed to start practice session');
    }
    setSessionId(nextSessionId);
    return nextSessionId;
  }, [clientInstanceId, mode, section, sessionId]);

  const fetchNextQuestion = useCallback(async (sessId?: string) => {
    setIsLoadingNext(true);
    setError(null);
    setValidationResult(null);

    try {
      const activeSessionId = sessId || (await ensureSession());
      if (!activeSessionId) {
        throw new Error('Unable to resolve practice session');
      }

      const url =
        `/api/practice/sessions/${encodeURIComponent(activeSessionId)}/next` +
        `?client_instance_id=${encodeURIComponent(clientInstanceId)}`;
      
      const response = await apiRequest(url, { method: 'GET' });

      const data: NextQuestionResponse = await response.json();
      
      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId);
      }

      const nextSessionItemId = data.sessionItemId || (data.question as any)?.sessionItemId || null;
      setSessionItemId(nextSessionItemId);
      setCurrentQuestion(data.question);
      applyServerStats(data.stats);

      const sessionState = String(data.state || '').toLowerCase();
      const terminal = sessionState === 'completed' || sessionState === 'abandoned';
      setExhausted(!data.question && terminal);
      
      setRationale(data.rationale || null);
      setAttemptIndex((prev) => prev + 1);
      
      if (data.question?.canonical_id) {
        excludeCanonicalIdsRef.current = [
          data.question.canonical_id,
          ...excludeCanonicalIdsRef.current,
        ].slice(0, MAX_EXCLUSIONS);
      }
      
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[AdaptivePractice] Error fetching next question:', err);
      return null;
    } finally {
      setIsLoadingNext(false);
    }
  }, [applyServerStats, clientInstanceId, ensureSession, sessionId]);

  const submitAnswer = useCallback(async (
    selectedAnswer?: string,
    freeResponseAnswer?: string,
    elapsedMs?: number,
    skipped: boolean = false
  ) => {
    if (!currentQuestion || !sessionId) {
      console.error('[AdaptivePractice] Cannot submit: no question or session');
      return null;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (!sessionItemId) {
        throw new Error('No active practice item. Please load another question.');
      }

      const clientAttemptId = `${clientInstanceId}:${sessionId}:${sessionItemId}:${Date.now()}`;
      const endpoint = skipped
        ? `/api/practice/sessions/${encodeURIComponent(sessionId)}/skip`
        : '/api/practice/answer';

      const payload = skipped
        ? {
            sessionItemId,
            questionId: currentQuestion.id,
            clientAttemptId,
            client_instance_id: clientInstanceId,
          }
        : {
            sessionId,
            sessionItemId,
            questionId: currentQuestion.id,
            selectedOptionId: selectedAnswer || null,
            clientAttemptId,
            client_instance_id: clientInstanceId,
          };

      const response = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const data: AnswerResponse & { stats?: Partial<ScoreState>; correctOptionId?: string | null; skipped?: boolean } = await response.json();
      if (data.stats) {
        applyServerStats(data.stats);
      }
      setSessionItemId(null);
      setExhausted(data.state === 'completed' || data.state === 'abandoned');

      if (!skipped) {
        const inferredOutcome =
          data.outcome ||
          (typeof data.isCorrect === 'boolean' ? (data.isCorrect ? 'correct' : 'incorrect') : 'incorrect');

        setValidationResult({
          isCorrect: Boolean(data.isCorrect),
          outcome: inferredOutcome,
          correctAnswerKey: data.correctAnswerKey ?? data.correctOptionId ?? null,
          explanation: data.explanation ?? null,
        });
      } else {
        setValidationResult({
          isCorrect: false,
          outcome: 'skipped',
          correctAnswerKey: null,
          explanation: null,
        });
      }

      if (!data.stats) {
        setScore(prev => {
          const newScore = { ...prev };
          const outcome =
            data.outcome ||
            (data.skipped ? 'skipped' : data.isCorrect ? 'correct' : 'incorrect');
          if (outcome === 'correct') {
            newScore.correct++;
            newScore.streak++;
          } else if (outcome === 'incorrect') {
            newScore.incorrect++;
            newScore.streak = 0;
          } else if (outcome === 'skipped') {
            newScore.skipped++;
          }
          newScore.total++;
          newScore.bestStreak = Math.max(newScore.bestStreak, newScore.streak);
          return newScore;
        });
      }

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[AdaptivePractice] Error submitting answer:', err);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [applyServerStats, clientInstanceId, currentQuestion, sessionId, sessionItemId]);

  const skipQuestion = useCallback(async (elapsedMs?: number) => {
    return submitAnswer(undefined, undefined, elapsedMs, true);
  }, [submitAnswer]);

  const nextQuestion = useCallback(async () => {
    return fetchNextQuestion(sessionId || undefined);
  }, [fetchNextQuestion, sessionId]);

  const startSession = useCallback(async () => {
    excludeCanonicalIdsRef.current = [];
    setAttemptIndex(0);
    setSessionItemId(null);
    setScore({ correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0, bestStreak: 0 });
    setExhausted(false);
    setValidationResult(null);
    setError(null);
    const createdSessionId = await ensureSession();
    return fetchNextQuestion(createdSessionId || undefined);
  }, [ensureSession, fetchNextQuestion]);

  const resetSession = useCallback(() => {
    excludeCanonicalIdsRef.current = [];
    setSessionId(null);
    setSessionItemId(null);
    setAttemptIndex(0);
    setCurrentQuestion(null);
    setRationale(null);
    setError(null);
    setValidationResult(null);
    setScore({ correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0, bestStreak: 0 });
    setExhausted(false);
    queryClient.invalidateQueries({ queryKey: ['practice-session', section] });
  }, [queryClient, section]);

  const endSession = useCallback(async () => {
    if (!sessionId) return null;

    try {
      const response = await apiRequest(`/api/practice/sessions/${encodeURIComponent(sessionId)}/terminate`, {
        method: 'POST',
        body: JSON.stringify({ client_instance_id: clientInstanceId }),
      });
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ['practice-session', section] });
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to end session';
      setError(message);
      console.error('[AdaptivePractice] Error ending session:', err);
      return null;
    }
  }, [clientInstanceId, sessionId, queryClient, section]);

  return {
    sessionId,
    currentQuestion,
    rationale,
    attemptIndex,
    isLoading: isLoadingNext,
    isLoadingNext,
    isSubmitting,
    error,
    validationResult,
    score,
    exhausted,
    fetchNextQuestion,
    submitAnswer,
    skipQuestion,
    nextQuestion,
    startSession,
    resetSession,
    endSession,
    excludedCount: excludeCanonicalIdsRef.current.length,
  };
}

