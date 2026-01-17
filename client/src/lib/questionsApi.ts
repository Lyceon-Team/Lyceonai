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

/**
 * @deprecated Use useAdaptivePractice hook instead for practice pages.
 * This function is kept for backward compatibility but practice pages
 * should use the adaptive selection endpoint.
 */
export async function fetchPracticeQuestions(params: FetchQuestionsParams = {}): Promise<QuestionsResponse> {
  const { section = 'all', limit = 10, offset = 0, difficulty } = params;
  
  let endpoint = '/api/questions/recent';
  
  if (section === 'math') {
    endpoint = '/api/questions/recent?section=math';
  } else if (section === 'reading-writing') {
    endpoint = '/api/questions/recent?section=rw';
  }
  
  const queryParams = new URLSearchParams();
  if (limit) queryParams.set('limit', String(limit));
  if (offset) queryParams.set('offset', String(offset));
  if (difficulty) queryParams.set('difficulty', difficulty);
  
  const url = queryParams.toString() ? `${endpoint}?${queryParams}` : endpoint;
  
  const response = await apiRequest(url);
  const data = await response.json();
  
  const questions = Array.isArray(data) ? data : (data.questions || []);
  
  return {
    questions: questions.map(toQuestionVM),
    total: data.total,
    hasMore: data.hasMore,
  };
}

/**
 * @deprecated Use useAdaptivePractice hook instead.
 * This function is kept for backward compatibility only.
 */
export async function fetchRandomQuestion(): Promise<QuestionVM | null> {
  const response = await apiRequest('/api/questions/recent?limit=1');
  const data = await response.json();
  
  if (!data || !data.id) {
    return null;
  }
  
  return toQuestionVM(data);
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
