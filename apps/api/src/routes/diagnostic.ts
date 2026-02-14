/**
 * DIAGNOSTIC ROUTES - Mastery v1.0
 * 
 * Endpoints for cold-start diagnostic assessment.
 * All endpoints require authentication and use the mastery write choke point.
 */

import { Request, Response, Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  startDiagnosticSession,
  getCurrentDiagnosticQuestion,
  recordDiagnosticAnswer,
} from '../services/diagnostic-service';
import { applyMasteryUpdate } from '../services/mastery-write';
import { MasteryEventType } from '../services/mastery-constants';
import { getSupabaseAdmin } from '../lib/supabase-admin';

const router = Router();

/**
 * POST /diagnostic/start - Start a new diagnostic session
 * 
 * Idempotent: Returns existing incomplete session if one exists
 */
router.post('/start', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const result = await startDiagnosticSession(req.user.id);
    
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    
    return res.json({
      sessionId: result.sessionId,
      totalQuestions: result.questionIds.length,
      currentIndex: result.currentIndex,
    });
  } catch (err: any) {
    console.error('[Diagnostic] Error starting session:', err);
    return res.status(500).json({ error: 'Failed to start diagnostic session' });
  }
});

/**
 * GET /diagnostic/next - Get the current question in the diagnostic
 * 
 * Idempotent: Returns the same question until it's answered
 * 
 * Query params:
 * - sessionId (required): The diagnostic session ID
 */
router.get('/next', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const sessionId = req.query.sessionId as string;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    
    // Verify session belongs to this user
    const supabase = getSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from('diagnostic_sessions')
      .select('student_id')
      .eq('id', sessionId)
      .single();
    
    if (sessionError || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    if (session.student_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const result = await getCurrentDiagnosticQuestion(sessionId);
    
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    
    if (result.isComplete) {
      return res.json({
        isComplete: true,
        questionIndex: result.questionIndex,
        totalQuestions: result.totalQuestions,
      });
    }
    
    // Fetch full question data (without answer/explanation)
    const { data: question, error: questionError } = await supabase
      .from('questions')
      .select(`
        id,
        canonical_id,
        stem,
        options,
        section,
        type,
        domain,
        skill,
        difficulty_bucket
      `)
      .eq('canonical_id', result.questionId)
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
  } catch (err: any) {
    console.error('[Diagnostic] Error getting next question:', err);
    return res.status(500).json({ error: 'Failed to get next question' });
  }
});

/**
 * POST /diagnostic/answer - Submit an answer to the current diagnostic question
 * 
 * NOT idempotent: Advances the session to the next question
 * 
 * Body:
 * - sessionId (required): The diagnostic session ID
 * - questionCanonicalId (required): The canonical ID of the question being answered
 * - selectedChoice (required for MC): The selected answer choice
 * - answerText (optional for FR): The free response answer text
 * - timeSpentMs (optional): Time spent on this question in milliseconds
 */
router.post('/answer', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const {
      sessionId,
      questionCanonicalId,
      selectedChoice,
      answerText,
      timeSpentMs,
    } = req.body;
    
    if (!sessionId || !questionCanonicalId) {
      return res.status(400).json({ 
        error: 'sessionId and questionCanonicalId are required' 
      });
    }
    
    // Verify session belongs to this user
    const supabase = getSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from('diagnostic_sessions')
      .select('student_id')
      .eq('id', sessionId)
      .single();
    
    if (sessionError || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    if (session.student_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Fetch question to get metadata and correct answer
    const { data: question, error: questionError } = await supabase
      .from('questions')
      .select(`
        canonical_id,
        answer_choice,
        answer_text,
        explanation,
        section,
        domain,
        skill,
        subskill,
        difficulty_bucket,
        structure_cluster_id,
        exam,
        type
      `)
      .eq('canonical_id', questionCanonicalId)
      .single();
    
    if (questionError || !question) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    // Grade the answer
    let isCorrect = false;
    if (question.type === 'mc' || !question.type) {
      isCorrect = selectedChoice === question.answer_choice;
    } else if (question.type === 'fr') {
      // For free response, do basic normalization
      const normalizedAnswer = (answerText || '').trim().toLowerCase();
      const normalizedCorrect = (question.answer_text || '').trim().toLowerCase();
      isCorrect = normalizedAnswer === normalizedCorrect;
    }
    
    // Record the diagnostic response and advance session
    const recordResult = await recordDiagnosticAnswer(
      sessionId,
      questionCanonicalId,
      isCorrect,
      selectedChoice || null,
      timeSpentMs || null
    );
    
    if (!recordResult.success) {
      return res.status(500).json({ error: recordResult.error });
    }
    
    // Update mastery via the canonical choke point
    // CRITICAL: Use DIAGNOSTIC_SUBMIT event type for proper weighting
    const masteryResult = await applyMasteryUpdate({
      userId: req.user.id,
      questionCanonicalId,
      sessionId,
      isCorrect,
      selectedChoice: selectedChoice || null,
      timeSpentMs: timeSpentMs || null,
      eventType: MasteryEventType.DIAGNOSTIC_SUBMIT,
      metadata: {
        exam: question.exam || null,
        section: question.section || null,
        domain: question.domain || null,
        skill: question.skill || null,
        subskill: question.subskill || null,
        difficulty_bucket: question.difficulty_bucket || null,
        structure_cluster_id: question.structure_cluster_id || null,
      },
    });
    
    if (masteryResult.error) {
      console.warn('[Diagnostic] Mastery update failed:', masteryResult.error);
    }
    
    return res.json({
      isCorrect,
      isComplete: recordResult.isComplete,
      nextQuestionId: recordResult.nextQuestionId,
      explanation: isCorrect ? null : (question.explanation || null), // Show explanation on wrong answers
    });
  } catch (err: any) {
    console.error('[Diagnostic] Error submitting answer:', err);
    return res.status(500).json({ error: 'Failed to submit answer' });
  }
});

export const diagnosticRouter = router;
