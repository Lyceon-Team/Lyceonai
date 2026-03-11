/**
 * Question Feedback API Routes
 *
 * Handles thumbs up/down feedback from students about question quality.
 * Requires Supabase authentication.
 */

import { Response } from 'express';
import { z } from 'zod';
import { type AuthenticatedRequest, requireRequestUser } from '../../../../server/middleware/supabase-auth';
import { supabaseServer } from '../lib/supabase-server';

const feedbackSchema = z.object({
  questionId: z.string().min(1, 'Question ID is required'),
  rating: z.enum(['up', 'down']),
  timeToAnswerSeconds: z.number().int().nonnegative().optional(),
  practiceSessionId: z.string().optional(),
});

export const submitQuestionFeedback = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
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

export const getQuestionFeedbackSummary = async (req: AuthenticatedRequest, res: Response) => {
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
