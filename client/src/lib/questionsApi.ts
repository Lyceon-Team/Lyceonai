/**
 * Questions API - Unified query layer for fetching questions from Supabase
 * 
 * All practice experiences should use these functions to ensure
 * consistent data fetching from the canonical Supabase source.
 */

import { apiRequest } from './queryClient';
import { QuestionVM, toQuestionVM } from '@/types/question';

export interface FetchQuestionsParams {
  section?: 'math' | 'reading-writing' | 'all';
  limit?: number;
  offset?: number;
  difficulty?: string;
}

export interface QuestionsResponse {
  questions: QuestionVM[];
  total?: number;
  hasMore?: boolean;
}

export async function fetchQuestionById(id: string): Promise<QuestionVM | null> {
  const response = await apiRequest(`/api/questions/${id}`);
  const data = await response.json();
  
  if (!data || !data.id) {
    return null;
  }
  
  return toQuestionVM(data);
}

export async function validateAnswer(
  questionId: string,
  answer: string,
  sessionId?: string
): Promise<{ isCorrect: boolean; correctAnswerKey?: string; feedback?: string; mode?: 'mc' | 'fr' }> {
  const response = await apiRequest('/api/questions/validate', {
    method: 'POST',
    body: JSON.stringify({
      questionId,
      answer,
      practiceSessionId: sessionId,
    }),
  });
  
  return response.json();
}

export async function fetchQuestionsStats(): Promise<{
  total: number;
  bySection: Record<string, number>;
  byDifficulty: Record<string, number>;
}> {
  const response = await apiRequest('/api/questions/stats');
  return response.json();
}

export async function submitQuestionFeedback(
  questionId: string,
  rating: 'up' | 'down',
  timeToAnswerSeconds?: number,
  sessionId?: string
): Promise<void> {
  await apiRequest('/api/questions/feedback', {
    method: 'POST',
    body: JSON.stringify({
      questionId,
      rating,
      timeToAnswerSeconds,
      practiceSessionId: sessionId,
    }),
  });
}
