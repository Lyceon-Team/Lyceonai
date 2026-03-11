import { Request, Response } from 'express';
import { supabaseServer } from '../apps/api/src/lib/supabase-server';

type QuestionMutabilityCheck = {
  ok: boolean;
  status?: number;
  body?: Record<string, unknown>;
};

async function assertQuestionMutable(questionId: string): Promise<QuestionMutabilityCheck> {
  const { data: row, error } = await supabaseServer
    .from('questions')
    .select('id, canonical_id, status, reviewed_at')
    .eq('id', questionId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      body: {
        success: false,
        error: 'Failed to load question state',
        detail: error.message,
      },
    };
  }

  if (!row) {
    return {
      ok: false,
      status: 404,
      body: {
        success: false,
        error: 'Question not found',
      },
    };
  }

  const isPublished = row.status === 'reviewed' && !!row.reviewed_at;
  if (isPublished) {
    return {
      ok: false,
      status: 409,
      body: {
        success: false,
        error: 'published_content_immutable',
        message: 'Reviewed questions are immutable. Create a new draft row for edits.',
        canonicalId: row.canonical_id ?? null,
      },
    };
  }

  return { ok: true };
}

/**
 * GET /api/admin/questions/needs-review
 * Get all draft questions that need admin review.
 */
export async function getNeedsReview(req: Request, res: Response) {
  try {
    const limitParam = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;

    const { data: reviewQuestions, error, count } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact' })
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .range(offset, offset + limitParam - 1);

    if (error) {
      console.error('[ADMIN_REVIEW] Error fetching questions for review:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch questions for review',
        detail: error.message,
      });
    }

    const total = count || 0;

    res.json({
      success: true,
      questions: reviewQuestions || [],
      pagination: {
        total,
        limit: limitParam,
        offset,
        hasMore: offset + (reviewQuestions?.length || 0) < total,
      },
    });
  } catch (error) {
    console.error('Error fetching questions for review:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch questions for review',
    });
  }
}

/**
 * POST /api/admin/questions/:id/approve
 * Approve a draft question by setting status=reviewed and stamping reviewer metadata.
 */
export async function approveQuestion(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated',
      });
    }

    const mutability = await assertQuestionMutable(id);
    if (!mutability.ok) {
      return res.status(mutability.status || 500).json(mutability.body);
    }

    const { data: updated, error } = await supabaseServer
      .from('questions')
      .update({
        status: 'reviewed',
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Question not found',
        });
      }
      console.error('[ADMIN_REVIEW] Error approving question:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to approve question',
        detail: error.message,
      });
    }

    res.json({
      success: true,
      message: 'Question approved successfully',
      question: updated,
    });
  } catch (error) {
    console.error('Error approving question:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to approve question',
    });
  }
}

/**
 * POST /api/admin/questions/:id/reject
 * Reject a draft question by deleting it.
 */
export async function rejectQuestion(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated',
      });
    }

    const mutability = await assertQuestionMutable(id);
    if (!mutability.ok) {
      return res.status(mutability.status || 500).json(mutability.body);
    }

    const { error } = await supabaseServer
      .from('questions')
      .delete()
      .eq('id', id);

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Question not found',
        });
      }
      console.error('[ADMIN_REVIEW] Error rejecting question:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to reject question',
        detail: error.message,
      });
    }

    res.json({
      success: true,
      message: 'Question rejected and deleted successfully',
      questionId: id,
    });
  } catch (error) {
    console.error('Error rejecting question:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reject question',
    });
  }
}

/**
 * GET /api/admin/questions/statistics
 * Get canonical review statistics.
 */
export async function getParsingStatistics(_req: Request, res: Response) {
  try {
    const { count: total, error: countError } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      throw countError;
    }

    const { count: draft } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'draft');

    const { count: reviewed } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'reviewed');

    res.json({
      success: true,
      statistics: {
        total: total || 0,
        needsReview: draft || 0,
        reviewed: reviewed || 0,
        pending: draft || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching parsing statistics:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch parsing statistics',
    });
  }
}

/**
 * POST /api/admin/questions/:id/update
 * Update canonical question fields on draft records.
 */
export async function updateQuestion(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;
    const {
      stem,
      options,
      optionMetadata,
      correctAnswer,
      answerText,
      explanation,
      section,
      sectionCode,
      difficulty,
      domain,
      skill,
      subskill,
      skillCode,
      sourceType,
      status,
    } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated',
      });
    }

    const mutability = await assertQuestionMutable(id);
    if (!mutability.ok) {
      return res.status(mutability.status || 500).json(mutability.body);
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (stem !== undefined) updateData.stem = stem;
    if (options !== undefined) updateData.options = options;
    if (optionMetadata !== undefined) updateData.option_metadata = optionMetadata;
    if (correctAnswer !== undefined) updateData.correct_answer = correctAnswer;
    if (answerText !== undefined) updateData.answer_text = answerText;
    if (explanation !== undefined) updateData.explanation = explanation;
    if (section !== undefined) updateData.section = section;
    if (sectionCode !== undefined) updateData.section_code = sectionCode;
    if (difficulty !== undefined) updateData.difficulty = difficulty;
    if (domain !== undefined) updateData.domain = domain;
    if (skill !== undefined) updateData.skill = skill;
    if (subskill !== undefined) updateData.subskill = subskill;
    if (skillCode !== undefined) updateData.skill_code = skillCode;
    if (sourceType !== undefined) updateData.source_type = sourceType;
    if (status !== undefined) updateData.status = status;

    const { data: updated, error } = await supabaseServer
      .from('questions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Question not found',
        });
      }
      console.error('[ADMIN_REVIEW] Error updating question:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update question',
        detail: error.message,
      });
    }

    res.json({
      success: true,
      message: 'Question updated successfully',
      question: updated,
    });
  } catch (error) {
    console.error('Error updating question:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update question',
    });
  }
}
