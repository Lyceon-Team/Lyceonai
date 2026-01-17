/**
 * Admin Question Review API Routes
 * 
 * Handles:
 * - Question review queue (needs_review filter)
 * - Approve/reject actions
 * - Question editing and updates
 * - Duplicate management
 * - Validation issue tracking
 */

import { Request, Response } from 'express';
import { supabaseServer } from '../lib/supabase-server';

/**
 * GET /api/admin/questions/needs-review
 * Get questions that need manual review
 */
export const getQuestionsNeedingReview = async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const severity = req.query.severity as string; // 'error' | 'warning' | 'info'

    // Get questions with needs_review = true
    const { data: questionsNeedingReview, error } = await supabaseServer
      .from('questions')
      .select('*')
      .eq('needs_review', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error fetching questions:', error);
      return res.status(500).json({ error: 'Failed to get questions needing review' });
    }

    // Get validation issues for each question
    const questionIds = (questionsNeedingReview || []).map(q => q.id);
    
    let issues: any[] = [];
    if (questionIds.length > 0) {
      let issuesQuery = supabaseServer
        .from('validation_issues')
        .select('*')
        .in('question_id', questionIds);
      
      if (severity) {
        issuesQuery = issuesQuery.eq('severity', severity);
      }
      
      const { data: issuesData } = await issuesQuery;
      issues = issuesData || [];
    }

    // Map issues to questions
    const issuesByQuestionId = issues.reduce((acc, issue) => {
      if (!acc[issue.question_id]) {
        acc[issue.question_id] = [];
      }
      acc[issue.question_id].push(issue);
      return acc;
    }, {} as Record<string, any[]>);

    // Combine questions with their issues
    const response = (questionsNeedingReview || []).map(question => ({
      ...question,
      validationIssues: issuesByQuestionId[question.id] || [],
    }));

    res.json({
      questions: response,
      total: questionsNeedingReview?.length || 0,
      hasMore: (questionsNeedingReview?.length || 0) === limit,
    });

  } catch (error: any) {
    console.error('❌ [REVIEW] Error getting questions:', error);
    res.status(500).json({ error: 'Failed to get questions needing review' });
  }
};

/**
 * GET /api/admin/questions/duplicates
 * Get potential duplicate questions
 */
export const getDuplicateQuestions = async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    
    // Get all questions with question_hash
    const { data: allQuestions, error } = await supabaseServer
      .from('questions')
      .select('id, question_hash, created_at')
      .not('question_hash', 'is', null);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error fetching questions for duplicates:', error);
      return res.status(500).json({ error: 'Failed to get duplicate questions' });
    }

    // Group by question_hash and find duplicates
    const hashCounts: Record<string, any[]> = {};
    (allQuestions || []).forEach(q => {
      if (q.question_hash) {
        if (!hashCounts[q.question_hash]) {
          hashCounts[q.question_hash] = [];
        }
        hashCounts[q.question_hash].push(q);
      }
    });

    // Filter to only duplicates (count > 1)
    const duplicateHashes = Object.entries(hashCounts)
      .filter(([_, questions]) => questions.length > 1)
      .slice(0, limit);

    // Get full question data for duplicates
    const questionHashes = duplicateHashes.map(([hash]) => hash);
    
    if (questionHashes.length === 0) {
      return res.json({
        duplicateGroups: [],
        total: 0,
      });
    }

    const { data: duplicateQuestions } = await supabaseServer
      .from('questions')
      .select('*')
      .in('question_hash', questionHashes)
      .order('question_hash')
      .order('created_at', { ascending: false });

    // Group by question_hash
    const grouped = duplicateHashes.map(([hash, items]) => ({
      questionHash: hash,
      count: items.length,
      questions: (duplicateQuestions || []).filter(q => q.question_hash === hash),
    }));

    res.json({
      duplicateGroups: grouped,
      total: duplicateHashes.length,
    });

  } catch (error: any) {
    console.error('❌ [DUPLICATES] Error:', error);
    res.status(500).json({ error: 'Failed to get duplicate questions' });
  }
};

/**
 * GET /api/admin/questions/statistics
 * Get question review statistics
 */
export const getQuestionStatistics = async (req: Request, res: Response) => {
  try {
    // Get overall counts
    const { count: total } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true });

    const { count: needsReview } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('needs_review', true);

    const { count: approved } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('needs_review', false);

    const { count: multipleChoice } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('question_type', 'multiple_choice');

    const { count: freeResponse } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('question_type', 'free_response');

    // Get questions by section
    const { data: allQuestions } = await supabaseServer
      .from('questions')
      .select('section, difficulty');

    const bySection: Record<string, number> = {};
    const byDifficulty: Record<string, number> = {};
    
    (allQuestions || []).forEach(q => {
      if (q.section) {
        bySection[q.section] = (bySection[q.section] || 0) + 1;
      }
      if (q.difficulty) {
        byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
      }
    });

    // Get validation issues summary
    const { data: validationData } = await supabaseServer
      .from('validation_issues')
      .select('severity, issue_type');

    const issueStats: Record<string, Record<string, number>> = {};
    (validationData || []).forEach(issue => {
      if (!issueStats[issue.severity]) {
        issueStats[issue.severity] = {};
      }
      issueStats[issue.severity][issue.issue_type] = 
        (issueStats[issue.severity][issue.issue_type] || 0) + 1;
    });

    res.json({
      counts: {
        total: total || 0,
        needsReview: needsReview || 0,
        approved: approved || 0,
        multipleChoice: multipleChoice || 0,
        freeResponse: freeResponse || 0,
      },
      bySection,
      byDifficulty,
      validationIssues: {
        bySeverity: issueStats,
      },
    });

  } catch (error: any) {
    console.error('❌ [STATS] Error:', error);
    res.status(500).json({ error: 'Failed to get question statistics' });
  }
};

/**
 * POST /api/admin/questions/:id/approve
 * Approve a question (clear needsReview flag)
 */
export const approveQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseServer
      .from('questions')
      .update({
        needs_review: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error approving question:', error);
      return res.status(500).json({ error: 'Failed to approve question' });
    }

    console.log(`✅ [APPROVE] Question ${id} approved`);

    res.json({
      id,
      status: 'approved',
      message: 'Question approved successfully',
    });

  } catch (error: any) {
    console.error('❌ [APPROVE] Error:', error);
    res.status(500).json({ error: 'Failed to approve question' });
  }
};

/**
 * POST /api/admin/questions/:id/reject
 * Reject a question (mark for deletion or hide)
 */
export const rejectQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Soft delete (recommended)
    const { error } = await supabaseServer
      .from('questions')
      .update({
        needs_review: true, // Keep flagged
        explanation: reason ? `REJECTED: ${reason}` : 'REJECTED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error rejecting question:', error);
      return res.status(500).json({ error: 'Failed to reject question' });
    }

    console.log(`🚫 [REJECT] Question ${id} rejected${reason ? `: ${reason}` : ''}`);

    res.json({
      id,
      status: 'rejected',
      message: 'Question rejected successfully',
    });

  } catch (error: any) {
    console.error('❌ [REJECT] Error:', error);
    res.status(500).json({ error: 'Failed to reject question' });
  }
};

/**
 * PATCH /api/admin/questions/:id
 * Update question fields
 */
export const updateQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Whitelist allowed fields (map to snake_case for DB)
    const fieldMapping: Record<string, string> = {
      stem: 'stem',
      options: 'options',
      answer: 'answer',
      explanation: 'explanation',
      section: 'section',
      difficulty: 'difficulty',
      needsReview: 'needs_review',
    };

    const filteredUpdates: any = {};
    for (const [field, dbField] of Object.entries(fieldMapping)) {
      if (field in updates) {
        filteredUpdates[dbField] = updates[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    filteredUpdates.updated_at = new Date().toISOString();

    const { error } = await supabaseServer
      .from('questions')
      .update(filteredUpdates)
      .eq('id', id);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error updating question:', error);
      return res.status(500).json({ error: 'Failed to update question' });
    }

    console.log(`✏️ [UPDATE] Question ${id} updated:`, Object.keys(filteredUpdates));

    res.json({
      id,
      status: 'updated',
      updatedFields: Object.keys(filteredUpdates),
      message: 'Question updated successfully',
    });

  } catch (error: any) {
    console.error('❌ [UPDATE] Error:', error);
    res.status(500).json({ error: 'Failed to update question' });
  }
};

/**
 * DELETE /api/admin/questions/:id
 * Permanently delete a question
 */
export const deleteQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Delete associated validation issues first
    await supabaseServer
      .from('validation_issues')
      .delete()
      .eq('question_id', id);

    // Delete the question
    const { error } = await supabaseServer
      .from('questions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error deleting question:', error);
      return res.status(500).json({ error: 'Failed to delete question' });
    }

    console.log(`🗑️ [DELETE] Question ${id} permanently deleted`);

    res.json({
      id,
      status: 'deleted',
      message: 'Question deleted successfully',
    });

  } catch (error: any) {
    console.error('❌ [DELETE] Error:', error);
    res.status(500).json({ error: 'Failed to delete question' });
  }
};

/**
 * POST /api/admin/questions/bulk-approve
 * Approve multiple questions at once
 */
export const bulkApproveQuestions = async (req: Request, res: Response) => {
  try {
    const { questionIds } = req.body;

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ error: 'questionIds must be a non-empty array' });
    }

    const { error } = await supabaseServer
      .from('questions')
      .update({
        needs_review: false,
        updated_at: new Date().toISOString(),
      })
      .in('id', questionIds);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error bulk approving questions:', error);
      return res.status(500).json({ error: 'Failed to bulk approve questions' });
    }

    console.log(`✅ [BULK-APPROVE] Approved ${questionIds.length} questions`);

    res.json({
      count: questionIds.length,
      status: 'approved',
      message: `${questionIds.length} questions approved successfully`,
    });

  } catch (error: any) {
    console.error('❌ [BULK-APPROVE] Error:', error);
    res.status(500).json({ error: 'Failed to bulk approve questions' });
  }
};
