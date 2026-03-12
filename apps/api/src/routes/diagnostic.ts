/**
<<<<<<< HEAD
 * Diagnostic routes
 */

import { Response, Router } from "express";
import { AuthenticatedRequest } from "../middleware/auth";
import { startDiagnosticSession, getCurrentDiagnosticQuestion, recordDiagnosticAnswer } from "../services/diagnostic-service";
import { applyMasteryUpdate } from "../services/mastery-write";
import { MasteryEventType } from "../services/mastery-constants";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const router = Router();

router.post("/start", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });

    const result = await startDiagnosticSession(req.user.id);
    if (result.error) return res.status(500).json({ error: result.error });
=======
 * DIAGNOSTIC ROUTES - Mastery v1.0
 */

import { Response, Router } from 'express';
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

router.post('/start', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

<<<<<<< HEAD
    const result = await startDiagnosticSession(user.id);

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
=======
    const result = await startDiagnosticSession(req.user.id);
    if (result.error) return res.status(500).json({ error: result.error });
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

    return res.json({
      sessionId: result.sessionId,
      totalQuestions: result.questionIds.length,
      currentIndex: result.currentIndex,
    });
<<<<<<< HEAD
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to start diagnostic session" });
=======
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to start diagnostic session' });
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  }
});

<<<<<<< HEAD
router.get("/next", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });

    const sessionId = req.query.sessionId as string;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
=======
router.get('/next', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const sessionId = req.query.sessionId as string;
<<<<<<< HEAD

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
=======
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

    const supabase = getSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from("diagnostic_sessions")
      .select("student_id")
      .eq("id", sessionId)
      .single();

<<<<<<< HEAD
<<<<<<< HEAD
    if (sessionError || !session) return res.status(404).json({ error: "Session not found" });
    if (session.student_id !== req.user.id) return res.status(403).json({ error: "Access denied" });

    const result = await getCurrentDiagnosticQuestion(sessionId);
    if (result.error) return res.status(500).json({ error: result.error });
=======
    if (sessionError || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.student_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await getCurrentDiagnosticQuestion(sessionId);

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
=======
    if (sessionError || !session) return res.status(404).json({ error: 'Session not found' });
    if (session.student_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const result = await getCurrentDiagnosticQuestion(sessionId);
    if (result.error) return res.status(500).json({ error: result.error });
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

    if (result.isComplete) {
      return res.json({ isComplete: true, questionIndex: result.questionIndex, totalQuestions: result.totalQuestions });
    }

    const { data: question, error: questionError } = await supabase
<<<<<<< HEAD
      .from("questions")
      .select("id, canonical_id, stem, options, section, section_code, question_type, domain, skill, subskill, skill_code, difficulty")
      .eq("canonical_id", result.questionId)
=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
      .single();

<<<<<<< HEAD
    if (questionError || !question) return res.status(500).json({ error: "Failed to load question" });

    return res.json({ question, questionIndex: result.questionIndex, totalQuestions: result.totalQuestions, isComplete: false });
=======
    if (questionError || !question) {
      return res.status(500).json({ error: 'Failed to load question' });
    }

    return res.json({
      question,
      questionIndex: result.questionIndex,
      totalQuestions: result.totalQuestions,
      isComplete: false,
    });
<<<<<<< HEAD
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to get next question" });
=======
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to get next question' });
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  }
});

<<<<<<< HEAD
router.post("/answer", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });

    const { sessionId, questionCanonicalId, selectedChoice, timeSpentMs } = req.body;

    if (!sessionId || !questionCanonicalId) {
      return res.status(400).json({ error: "sessionId and questionCanonicalId are required" });
=======
router.post('/answer', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const { sessionId, questionCanonicalId, selectedChoice, timeSpentMs } = req.body;

    if (!sessionId || !questionCanonicalId) {
<<<<<<< HEAD
      return res.status(400).json({
        error: 'sessionId and questionCanonicalId are required'
      });
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
=======
      return res.status(400).json({ error: 'sessionId and questionCanonicalId are required' });
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
    }

    const supabase = getSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from("diagnostic_sessions")
      .select("student_id")
      .eq("id", sessionId)
      .single();

<<<<<<< HEAD
<<<<<<< HEAD
    if (sessionError || !session) return res.status(404).json({ error: "Session not found" });
    if (session.student_id !== req.user.id) return res.status(403).json({ error: "Access denied" });
=======
    if (sessionError || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.student_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57

    const { data: question, error: questionError } = await supabase
      .from("questions")
      .select("canonical_id, question_type, correct_answer, explanation, section, domain, skill, subskill, skill_code, difficulty, exam")
      .eq("canonical_id", questionCanonicalId)
      .single();

<<<<<<< HEAD
    if (questionError || !question) return res.status(404).json({ error: "Question not found" });

    if (question.question_type !== "multiple_choice") {
      return res.status(400).json({ error: "Invalid question type" });
    }

    const isCorrect = String(selectedChoice ?? "").trim().toUpperCase() === String(question.correct_answer).trim().toUpperCase();
=======
    if (questionError || !question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    let isCorrect = false;
    if (question.type === 'mc' || !question.type) {
      isCorrect = selectedChoice === question.answer_choice;
    } else if (question.type === 'fr') {
      const normalizedAnswer = (answerText || '').trim().toLowerCase();
      const normalizedCorrect = (question.answer_text || '').trim().toLowerCase();
      isCorrect = normalizedAnswer === normalizedCorrect;
    }
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
=======
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
        exam
      `)
      .eq('canonical_id', questionCanonicalId)
      .eq('question_type', 'multiple_choice')
      .single();

    if (questionError || !question) return res.status(404).json({ error: 'Question not found' });

    const normalizedSelected = String(selectedChoice ?? '').trim().toUpperCase();
    const normalizedCorrect = String(question.correct_answer ?? '').trim().toUpperCase();
    const isCorrect = normalizedSelected.length > 0 && normalizedSelected === normalizedCorrect;
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

    const recordResult = await recordDiagnosticAnswer(
      sessionId,
      questionCanonicalId,
      isCorrect,
      selectedChoice || null,
      timeSpentMs || null,
    );

    if (!recordResult.success) return res.status(500).json({ error: recordResult.error });

    await applyMasteryUpdate({
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
<<<<<<< HEAD
        difficulty: question.difficulty || null,
        skill_code: question.skill_code || null,
        structure_cluster_id: null,
      },
    });

    if (masteryResult.error) {
      console.warn("[Diagnostic] Mastery update failed:", masteryResult.error);
    }

=======
        skill_code: question.skill_code || null,
        difficulty: question.difficulty || null,
      },
    });

>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
    return res.json({
      isCorrect,
      isComplete: recordResult.isComplete,
      nextQuestionId: recordResult.nextQuestionId,
<<<<<<< HEAD
      explanation: isCorrect ? null : question.explanation || null,
=======
      explanation: isCorrect ? null : (question.explanation || null),
<<<<<<< HEAD
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
    });
  } catch (_err: any) {
    return res.status(500).json({ error: "Failed to submit answer" });
=======
      answerText: isCorrect ? null : (question.answer_text || null),
    });
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to submit answer' });
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  }
});

export const diagnosticRouter = router;
