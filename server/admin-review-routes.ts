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
    .select('id, canonical_id, needs_review, reviewed_at, version')
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

  const isPublished = row.needs_review === false && !!row.reviewed_at;
  if (isPublished) {
    return {
      ok: false,
      status: 409,
      body: {
        success: false,
        error: 'published_content_immutable',
        message: 'Published questions are immutable. Create a new version and re-run QA.',
        canonicalId: row.canonical_id ?? null,
        version: row.version ?? null,
      },
    };
  }

  return { ok: true };
}
/**
 * GET /api/admin/questions/needs-review
 * Get all questions that need admin review (confidence < 0.8 or needsReview = true)
 */
export async function getNeedsReview(req: Request, res: Response) {
  try {
    const limitParam = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    
    // Get questions that need review with pagination
    // Include: (needs_review=true OR confidence<0.8) AND reviewed_at IS NULL
    const { data: reviewQuestions, error, count } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact' })
      .or('needs_review.eq.true,confidence.lt.0.8')
      .is('reviewed_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitParam - 1);
    
    if (error) {
      console.error('[ADMIN_REVIEW] Error fetching questions for review:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch questions for review',
        detail: error.message
      });
    }
    
    const total = count || 0;
    console.log(`📋 Retrieved ${reviewQuestions?.length || 0} questions needing review (total: ${total})`);
    
    res.json({
      success: true,
      questions: reviewQuestions || [],
      pagination: {
        total,
        limit: limitParam,
        offset,
        hasMore: offset + (reviewQuestions?.length || 0) < total
      }
    });
    
  } catch (error) {
    console.error('Error fetching questions for review:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch questions for review'
    });
  }
}

/**
 * POST /api/admin/questions/:id/approve
 * Approve a question - sets needsReview to false, records reviewer and timestamp
 */
export async function approveQuestion(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id; // From auth middleware
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }
    
    const mutability = await assertQuestionMutable(id);
    if (!mutability.ok) {
      return res.status(mutability.status || 500).json(mutability.body);
    }

    // Update question to approve it
    const { data: updated, error } = await supabaseServer
      .from('questions')
      .update({
        needs_review: false,
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Question not found'
        });
      }
      console.error('[ADMIN_REVIEW] Error approving question:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to approve question',
        detail: error.message
      });
    }
    
    console.log(`✅ Question ${id} approved by user ${userId}`);
    
    res.json({
      success: true,
      message: 'Question approved successfully',
      question: updated
    });
    
  } catch (error) {
    console.error('Error approving question:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to approve question'
    });
  }
}

/**
 * POST /api/admin/questions/:id/reject
 * Reject a question - deletes it from the database
 */
export async function rejectQuestion(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id; // From auth middleware
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }
    
    const mutability = await assertQuestionMutable(id);
    if (!mutability.ok) {
      return res.status(mutability.status || 500).json(mutability.body);
    }

    // Delete the question
    const { data: deleted, error } = await supabaseServer
      .from('questions')
      .delete()
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Question not found'
        });
      }
      console.error('[ADMIN_REVIEW] Error rejecting question:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to reject question',
        detail: error.message
      });
    }
    
    console.log(`🗑️ Question ${id} rejected and deleted by user ${userId}`);
    
    res.json({
      success: true,
      message: 'Question rejected and deleted successfully',
      questionId: id
    });
    
  } catch (error) {
    console.error('Error rejecting question:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reject question'
    });
  }
}

/**
 * GET /api/admin/questions/statistics
 * Get parsing quality statistics
 */
export async function getParsingStatistics(req: Request, res: Response) {
  try {
    // Get total count
    const { count: total, error: countError } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      throw countError;
    }
    
    // Get needs_review count
    const { count: needsReview } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('needs_review', true);
    
    // Get reviewed count
    const { count: reviewed } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .not('reviewed_at', 'is', null);
    
    // Get pending count (needs_review OR low confidence, not reviewed)
    const { count: pending } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .or('needs_review.eq.true,confidence.lt.0.8')
      .is('reviewed_at', null);
    
    // Get confidence distribution
    const { count: lowConfidence } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .lt('confidence', 0.6);
    
    const { count: mediumConfidence } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .gte('confidence', 0.6)
      .lt('confidence', 0.8);
    
    const { count: highConfidence } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .gte('confidence', 0.8);
    
    // Calculate average confidence
    const { data: allConfidences } = await supabaseServer
      .from('questions')
      .select('confidence')
      .not('confidence', 'is', null);
    
    let avgConfidence = 0;
    if (allConfidences && allConfidences.length > 0) {
      const sum = allConfidences.reduce((acc, q) => acc + (q.confidence || 0), 0);
      avgConfidence = sum / allConfidences.length;
    }
    
    console.log(`📊 Parsing statistics: ${total} total questions, ${pending} pending review`);
    
    res.json({
      success: true,
      statistics: {
        total: total || 0,
        averageConfidence: Number(avgConfidence.toFixed(3)),
        needsReview: needsReview || 0,
        reviewed: reviewed || 0,
        pending: pending || 0,
        confidenceDistribution: {
          low: lowConfidence || 0,
          medium: mediumConfidence || 0,
          high: highConfidence || 0
        }
      }
    });
    
  } catch (error) {
    console.error('Error fetching parsing statistics:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch parsing statistics'
    });
  }
}

/**
 * POST /api/admin/questions/:id/update
 * Update question fields (stem, options, answer, etc.) after review
 */
export async function updateQuestion(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;
    const { stem, options, answer, explanation, confidence } = req.body;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }
    
    const mutability = await assertQuestionMutable(id);
    if (!mutability.ok) {
      return res.status(mutability.status || 500).json(mutability.body);
    }

    // Build update object with only provided fields
    const updateData: any = {
      needs_review: false,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId
    };
    
    if (stem !== undefined) updateData.stem = stem;
    if (options !== undefined) updateData.options = options;
    if (answer !== undefined) updateData.answer = answer;
    if (explanation !== undefined) updateData.explanation = explanation;
    if (confidence !== undefined) updateData.confidence = confidence;
    
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
          error: 'Question not found'
        });
      }
      console.error('[ADMIN_REVIEW] Error updating question:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update question',
        detail: error.message
      });
    }
    
    console.log(`📝 Question ${id} updated by user ${userId}`);
    
    res.json({
      success: true,
      message: 'Question updated successfully',
      question: updated
    });
    
  } catch (error) {
    console.error('Error updating question:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update question'
    });
  }
}
