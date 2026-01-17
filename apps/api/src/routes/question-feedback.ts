/**
 * Question Feedback API Routes
 * 
 * Handles thumbs up/down feedback from students about question quality.
 * Requires Supabase authentication.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { supabaseServer } from '../lib/supabase-server';

interface SupabaseUser {
  id: string;
  email: string;
  display_name: string | null;
  role: 'student' | 'admin' | 'guardian';
  isAdmin: boolean;
  isGuardian?: boolean;
}

const feedbackSchema = z.object({
  questionId: z.string().min(1, 'Question ID is required'),
  rating: z.enum(['up', 'down']),
  timeToAnswerSeconds: z.number().int().nonnegative().optional(),
  practiceSessionId: z.string().optional(),
});

/**
 * POST /api/questions/feedback
 * Submit feedback (thumbs up/down) for a question
 */
export const submitQuestionFeedback = async (req: Request, res: Response) => {
  try {
    const user = req.user as SupabaseUser | undefined;
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    const parseResult = feedbackSchema.safeParse(req.body);
    if (!parseResult.success) {
      console.error('[FEEDBACK] Validation error:', parseResult.error.errors);
      return res.status(400).json({
        ok: false,
        error: 'Invalid request body',
        details: parseResult.error.errors,
      });
    }

    const { questionId, rating, timeToAnswerSeconds, practiceSessionId } = parseResult.data;

    console.log(`[FEEDBACK] User ${user.id} submitted ${rating} for question ${questionId}`);

    const { data, error } = await supabaseServer
      .from('question_feedback')
      .insert({
        question_id: questionId,
        user_id: user.id,
        rating,
        time_to_answer_seconds: timeToAnswerSeconds ?? null,
        practice_session_id: practiceSessionId ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[FEEDBACK] Error inserting feedback:', error);
      return res.status(500).json({ ok: false, error: 'Failed to save feedback', detail: error.message });
    }

    console.log(`[FEEDBACK] Saved feedback ${data.id}`);

    res.json({ ok: true, feedbackId: data.id });
  } catch (error: any) {
    console.error('[FEEDBACK] Unexpected error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: error.message });
  }
};

/**
 * GET /api/questions/:questionId/feedback-summary
 * Get feedback summary for a question (admin only)
 */
export const getQuestionFeedbackSummary = async (req: Request, res: Response) => {
  try {
    const { questionId } = req.params;

    const { data: feedbackData, error } = await supabaseServer
      .from('question_feedback')
      .select('rating')
      .eq('question_id', questionId);

    if (error) {
      console.error('[FEEDBACK] Error fetching summary:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get feedback summary' });
    }

    const upCount = feedbackData?.filter(f => f.rating === 'up').length || 0;
    const downCount = feedbackData?.filter(f => f.rating === 'down').length || 0;
    const total = upCount + downCount;

    res.json({
      ok: true,
      questionId,
      summary: {
        up: upCount,
        down: downCount,
        total,
        positiveRatio: total > 0 ? upCount / total : null,
      },
    });
  } catch (error: any) {
    console.error('[FEEDBACK] Unexpected error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
