import { Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";

// POST /api/questions/validate - Secure server-side answer validation (CRITICAL for practice)
export const validateAnswer = async (req: Request, res: Response) => {
  try {
    // Defensive: Only allow via requireSupabaseAuth, requireStudentOrAdmin, but double-check user/role
    const authUser = (req as any).authUser || req.user;
    const userId = authUser?.id;
    const isAdmin = !!authUser?.isAdmin;
    const role = authUser?.role || (isAdmin ? 'admin' : 'student');
    const isGuardian = authUser?.isGuardian || role === 'guardian';

    // Defensive: guardians never get answers
    if (isGuardian) {
      return res.status(403).json({ error: 'Guardians are not permitted to validate answers.' });
    }

    // Validate input
    const { questionId, studentAnswer } = req.body;
    if (!questionId || studentAnswer === undefined || studentAnswer === null) {
      return res.status(400).json({ error: 'Missing required fields: questionId and studentAnswer' });
    }

    // Fetch the question
    const { data, error } = await supabaseServer
      .from('questions')
      .select(`id, question_type, type, answer_choice, answer_text, answer, explanation`)
      .eq('id', questionId)
      .limit(1)
      .single();
    if (error || !data) {
      console.error('Error fetching question for validation:', error);
      return res.status(404).json({ error: 'Question not found' });
    }
    const question = data;
    let isCorrect: boolean | null = null;
    let feedback = '';
    let correctAnswerKey: string | null = null;
    let mode: 'mc' | 'fr' = 'mc';

    // Determine mode
    if (question.question_type === 'free_response' || question.type === 'fr') {
      mode = 'fr';
    }

    // Validate answer
    if (mode === 'mc') {
      isCorrect = String(studentAnswer).trim().toUpperCase() === String(question.answer_choice).trim().toUpperCase();
      correctAnswerKey = isAdmin ? question.answer_choice : null;
      feedback = isCorrect ? 'Correct!' : 'Incorrect.';
    } else {
      // Free response: simple string match (could be improved)
      isCorrect = String(studentAnswer).trim().toLowerCase() === String(question.answer_text).trim().toLowerCase();
      correctAnswerKey = isAdmin ? question.answer_text : null;
      feedback = isCorrect ? 'Correct!' : 'Incorrect.';
    }

    // Only admins get explanation/correct answer
    const response: any = {
      isCorrect,
      feedback,
    };
    if (isAdmin) {
      response.correctAnswerKey = correctAnswerKey;
      response.explanation = question.explanation;
    }
    return res.json(response);
  } catch (err) {
    console.error('Error in validateAnswer:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
