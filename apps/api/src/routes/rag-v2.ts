/**
 * RAG v2 HTTP Route
 * POST /api/rag/v2
 * Returns structured RagContext instead of raw LLM answer
 */

import { Request, Response, Router } from 'express';
import { RagQueryRequestSchema } from '../lib/rag-types.ts';
import { getRagService } from '../lib/rag-service.ts';

const router = Router();

/**
 * POST /api/rag/v2
 * RAG v2 endpoint - returns structured context for AI Tutor
 *
 * Body: RagQueryRequest
 * - userId: string
 * - message: string
 * - mode: 'question' | 'concept' | 'strategy'
 * - canonicalQuestionId?: string (for question mode)
 * - testCode?: string (e.g. 'SAT')
 * - sectionCode?: string (e.g. 'M', 'RW')
 * - studentProfile?: StudentProfile
 * - topK?: number
 *
 * Response: RagQueryResponse
 * - context: RagContext
 * - metadata: { canonicalIdsUsed, mode, processingTimeMs }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const validation = RagQueryRequestSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: validation.error.flatten(),
      });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const ragService = getRagService();
    const response = await ragService.handleRagQuery({
      userId,
      message: validation.data.message || '',
      mode: validation.data.mode || 'concept',
      canonicalQuestionId: validation.data.canonicalQuestionId,
      testCode: validation.data.testCode,
      sectionCode: validation.data.sectionCode,
      studentProfile: validation.data.studentProfile
        ? {
            userId,
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

    return res.json(response);
  } catch (error: any) {
    console.error('❌ [RAG-V2] Request failed:', error);
    return res.status(500).json({
      error: 'RAG v2 request failed',
      message: error.message || String(error),
    });
  }
});

export default router;
