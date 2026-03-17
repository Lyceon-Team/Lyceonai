/**
 * RAG v2 HTTP Route
 * POST /api/rag/v2
 * Returns structured RagContext instead of raw LLM answer
 */

import { Response, Router } from 'express';
import { type AuthenticatedRequest, requireRequestUser } from '../../../../server/middleware/supabase-auth';
import { RagQueryRequestSchema } from '../lib/rag-types';
import { getRagService } from '../lib/rag-service';

const router = Router();

function sanitizeQuestionForStudent<T extends Record<string, unknown> | null>(question: T): T {
  if (!question || typeof question !== 'object') {
    return question;
  }

  const sanitized: Record<string, unknown> = { ...question };
  const sensitiveKeys = ['correctAnswer', 'correct_answer', 'answer', 'explanation'] as const;

  for (const key of sensitiveKeys) {
    if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
      sanitized[key] = null;
    }
  }

  return sanitized as T;
}

function sanitizeRagResponseForStudent<T extends { context?: Record<string, unknown> }>(response: T): T {
  const context = response?.context;
  if (!context || typeof context !== 'object') {
    return response;
  }

  const primaryQuestion = sanitizeQuestionForStudent(
    (context.primaryQuestion as Record<string, unknown> | null) ?? null
  );
  const supportingQuestionsRaw = Array.isArray(context.supportingQuestions) ? context.supportingQuestions : [];
  const supportingQuestions = supportingQuestionsRaw.map((question) =>
    sanitizeQuestionForStudent((question as Record<string, unknown> | null) ?? null)
  );

  return {
    ...response,
    context: {
      ...context,
      primaryQuestion,
      supportingQuestions,
    },
  };
}

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = RagQueryRequestSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: validation.error.flatten(),
      });
    }

    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const ragService = getRagService();
    const response = await ragService.handleRagQuery({
      userId: user.id,
      message: validation.data.message || '',
      mode: validation.data.mode || 'concept',
      canonicalQuestionId: validation.data.canonicalQuestionId,
      testCode: validation.data.testCode,
      sectionCode: validation.data.sectionCode,
      studentProfile: validation.data.studentProfile
        ? {
            userId: user.id,
            overallLevel: validation.data.studentProfile.overallLevel,
            competencyMap: validation.data.studentProfile.competencyMap as Record<
              string,
              { correct?: number; incorrect?: number; total?: number; masteryLevel?: number }
            >,
            recentQuestions: validation.data.studentProfile.recentQuestions?.map((q) => ({
              canonicalId: q.canonicalId,
              correct: q.correct,
              timestamp: q.timestamp,
            })),
            primaryStyle: validation.data.studentProfile.primaryStyle,
            secondaryStyle: validation.data.studentProfile.secondaryStyle,
            explanationLevel: validation.data.studentProfile.explanationLevel,
            personaTags: validation.data.studentProfile.personaTags,
          }
        : undefined,
      topK: validation.data.topK,
    });

    const sanitizedResponse = sanitizeRagResponseForStudent(response);
    return res.json(sanitizedResponse);
  } catch (error: any) {
    console.error('[RAG-V2] Request failed:', error);
    return res.status(500).json({
      error: 'RAG v2 request failed',
      message: error.message || String(error),
    });
  }
});

export default router;
