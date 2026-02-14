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
  question: StudentQuestion | null;
  rationale: SelectionRationale;
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
  const [currentQuestion, setCurrentQuestion] = useState<StudentQuestion | null>(null);
  const [rationale, setRationale] = useState<SelectionRationale | null>(null);
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [score, setScore] = useState<ScoreState>({ correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0, bestStreak: 0 });
  const [exhausted, setExhausted] = useState(false);
  
  const excludeCanonicalIdsRef = useRef<string[]>([]);
  const MAX_EXCLUSIONS = 20;

  const fetchNextQuestion = useCallback(async (sessId?: string) => {
    const activeSessionId = sessId || sessionId;

    setIsLoadingNext(true);
    setError(null);
    setValidationResult(null);

    try {
      const url = activeSessionId
        ? `/api/practice/next?section=${section}&mode=${mode}&sessionId=${activeSessionId}`
        : `/api/practice/next?section=${section}&mode=${mode}`;
      
      const response = await apiRequest(url, { method: 'GET' });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        if (response.status === 401) {
          throw new Error("You're signed out. Please sign in again.");
        }
        if (response.status === 403 && errorData.error === 'csrf_blocked') {
          throw new Error("Security check blocked this request. Please refresh the page.");
        }
        
        throw new Error(errorData.error || 'Failed to fetch next question');
      }

      const data: NextQuestionResponse = await response.json();
      
      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId);
      }

      if (data.rationale?.exhausted) {
        setExhausted(true);
        setCurrentQuestion(null);
      } else {
        setCurrentQuestion(data.question);
        setExhausted(false);
      }
      
      setRationale(data.rationale);
      setAttemptIndex((prev) => prev + 1);
      
      if (data.question?.canonicalId) {
        excludeCanonicalIdsRef.current = [
          data.question.canonicalId,
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
  }, [sessionId, section, mode]);

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
      const response = await apiRequest('/api/practice/answer', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          questionId: currentQuestion.id,
          selectedAnswer: skipped ? null : (selectedAnswer || null),
          freeResponseAnswer: skipped ? null : (freeResponseAnswer || null),
          elapsedMs: elapsedMs || 0,
          skipped,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to submit answer');
      }

      const data: AnswerResponse = await response.json();
      
      setValidationResult({
        isCorrect: data.isCorrect,
        outcome: data.outcome,
        correctAnswerKey: data.correctAnswerKey,
        explanation: data.explanation,
      });

      setScore(prev => {
        const newScore = { ...prev };
        if (data.outcome === 'correct') {
          newScore.correct++;
          newScore.streak++;
        } else if (data.outcome === 'incorrect') {
          newScore.incorrect++;
          newScore.streak = 0;
        } else if (data.outcome === 'skipped') {
          newScore.skipped++;
        }
        newScore.total++;
        newScore.bestStreak = Math.max(newScore.bestStreak, newScore.streak);
        return newScore;
      });

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[AdaptivePractice] Error submitting answer:', err);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [currentQuestion, sessionId]);

  const skipQuestion = useCallback(async (elapsedMs?: number) => {
    return submitAnswer(undefined, undefined, elapsedMs, true);
  }, [submitAnswer]);

  const nextQuestion = useCallback(async () => {
    return fetchNextQuestion(sessionId || undefined);
  }, [fetchNextQuestion, sessionId]);

  const startSession = useCallback(async () => {
    excludeCanonicalIdsRef.current = [];
    setAttemptIndex(0);
    setScore({ correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0, bestStreak: 0 });
    setExhausted(false);
    setValidationResult(null);
    return fetchNextQuestion();
  }, [fetchNextQuestion]);

  const resetSession = useCallback(() => {
    excludeCanonicalIdsRef.current = [];
    setSessionId(null);
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
      const response = await apiRequest('/api/practice/end-session', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      
      if (response.ok) {
        const data = await response.json();
        queryClient.invalidateQueries({ queryKey: ['practice-session', section] });
        return data;
      }
    } catch (err) {
      console.error('[AdaptivePractice] Error ending session:', err);
    }
    return null;
  }, [sessionId, queryClient, section]);

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
