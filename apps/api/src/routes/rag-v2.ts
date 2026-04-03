/**
 * RAG v2 HTTP Route
 * POST /api/rag/v2
 * Returns structured RagContext instead of raw LLM answer
 */

import { Response, Router } from 'express';
import { type AuthenticatedRequest, requireRequestUser } from '../../../../server/middleware/supabase-auth';
import { RagQueryRequestSchema, type RagQueryResponse } from '../lib/rag-types';
import { getRagService } from '../lib/rag-service';

const router = Router();

type RagQuestion = RagQueryResponse['context']['supportingQuestions'][number];

function sanitizeQuestionForStudent(question: RagQuestion): RagQuestion {
  const sanitized = {
    ...(question as unknown as Record<string, unknown>),
    correctAnswer: null,
    explanation: null,
  } as RagQuestion & Record<string, unknown>;
  const sensitiveKeys = ['correctAnswer', 'correct_answer', 'answer', 'explanation'] as const;

  for (const key of sensitiveKeys) {
    if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
      sanitized[key] = null;
    }
  }

  return sanitized;
}

function sanitizeRagResponseForStudent(response: RagQueryResponse): RagQueryResponse {
  const context = response.context;
  if (!context || typeof context !== 'object') {
    return response;
  }

  const sanitizedCompetencyContext = {
    studentWeakAreas: [],
    studentStrongAreas: [],
    competencyLabels: [],
  };

  const primaryQuestion = context.primaryQuestion
    ? sanitizeQuestionForStudent(context.primaryQuestion)
    : null;
  const supportingQuestions = context.supportingQuestions.map((question) =>
    sanitizeQuestionForStudent(question)
  );

  return {
    ...response,
    context: {
      ...context,
      primaryQuestion,
      supportingQuestions,
      competencyContext: sanitizedCompetencyContext,
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
