/**
 * DIAGNOSTIC ROUTES - Mastery v1.0
 */

import { Response, Router } from 'express';
import type { AuthenticatedRequest } from '../../../../server/middleware/supabase-auth';
import {
  startDiagnosticSession,
  getCurrentDiagnosticQuestion,
  recordDiagnosticAnswer,
} from '../services/diagnostic-service';
import { applyMasteryUpdate } from '../services/mastery-write';
import { MasteryEventType } from '../services/mastery-constants';
import { getSupabaseAdmin } from '../lib/supabase-admin';

const router = Router();

router.post('/start', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const result = await startDiagnosticSession(req.user.id);
    if (result.error) return res.status(500).json({ error: result.error });

    return res.json({
      sessionId: result.sessionId,
      totalQuestions: result.questionIds.length,
      currentIndex: result.currentIndex,
    });
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to start diagnostic session' });
  }
});

router.get('/next', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const sessionId = req.query.sessionId as string;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const supabase = getSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from('diagnostic_sessions')
      .select('student_id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) return res.status(404).json({ error: 'Session not found' });
    if (session.student_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const result = await getCurrentDiagnosticQuestion(sessionId);
    if (result.error) return res.status(500).json({ error: result.error });

    if (result.isComplete) {
      return res.json({
        isComplete: true,
        questionIndex: result.questionIndex,
        totalQuestions: result.totalQuestions,
      });
    }

    const { data: question, error: questionError } = await supabase
      .from('questions')
      .select(`
        id,
        canonical_id,
        stem,
        options,
        section,
        section_code,
        question_type,
        domain,
        skill,
        subskill,
        skill_code,
        difficulty
      `)
      .eq('canonical_id', result.questionId)
      .eq('question_type', 'multiple_choice')
      .single();

    if (questionError || !question) {
      return res.status(500).json({ error: 'Failed to load question' });
    }

    return res.json({
      question,
      questionIndex: result.questionIndex,
      totalQuestions: result.totalQuestions,
      isComplete: false,
    });
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to get next question' });
  }
});

router.post('/answer', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const { sessionId, questionCanonicalId, selectedChoice, timeSpentMs } = req.body;

    if (!sessionId || !questionCanonicalId) {
      return res.status(400).json({ error: 'sessionId and questionCanonicalId are required' });
    }

    const supabase = getSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from('diagnostic_sessions')
      .select('student_id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) return res.status(404).json({ error: 'Session not found' });
    if (session.student_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const { data: question, error: questionError } = await supabase
      .from('questions')
      .select(`
        canonical_id,
        question_type,
        correct_answer,
        answer_text,
        explanation,
        section,
        domain,
        skill,
        subskill,
        skill_code,
        difficulty,
        structure_cluster_id,
        exam
      `)
      .eq('canonical_id', questionCanonicalId)
      .eq('question_type', 'multiple_choice')
      .single();

    if (questionError || !question) return res.status(404).json({ error: 'Question not found' });

    const normalizedSelected = String(selectedChoice ?? '').trim().toUpperCase();
    const normalizedCorrect = String(question.correct_answer ?? '').trim().toUpperCase();
    const isCorrect = normalizedSelected.length > 0 && normalizedSelected === normalizedCorrect;

    const recordResult = await recordDiagnosticAnswer(
      sessionId,
      questionCanonicalId,
      isCorrect,
      selectedChoice || null,
      timeSpentMs || null
    );

    if (!recordResult.success) return res.status(500).json({ error: recordResult.error });

    await applyMasteryUpdate({
      userId: req.user.id,
      questionCanonicalId,
      sessionId,
      isCorrect,
      selectedChoice: selectedChoice || null,
      timeSpentMs: timeSpentMs || null,
      eventType: isCorrect ? MasteryEventType.PRACTICE_PASS : MasteryEventType.PRACTICE_FAIL,
      metadata: {
        exam: question.exam || null,
        section: question.section || null,
        domain: question.domain || null,
        skill: question.skill || null,
        subskill: question.subskill || null,
        skill_code: question.skill_code || null,
        difficulty: question.difficulty || null,
            structure_cluster_id: question.structure_cluster_id || null,
      },
    });

    return res.json({
      isCorrect,
      isComplete: recordResult.isComplete,
      nextQuestionId: recordResult.nextQuestionId,
      explanation: isCorrect ? null : (question.explanation || null),
      answerText: isCorrect ? null : (question.answer_text || null),
    });
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to submit answer' });
  }
});

export const diagnosticRouter = router;

