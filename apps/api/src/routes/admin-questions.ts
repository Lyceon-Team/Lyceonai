/**
 * Admin Question Review API Routes
 * Canonical questions schema only (public.questions).
 */

import { Request, Response } from 'express';
import { supabaseServer } from '../lib/supabase-server';

/**
 * GET /api/admin/questions/needs-review
 * Get draft questions that need manual review.
 */
export const getQuestionsNeedingReview = async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const severity = req.query.severity as string;

    const { data: draftQuestions, error } = await supabaseServer
      .from('questions')
      .select('*')
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error fetching draft questions:', error);
      return res.status(500).json({ error: 'Failed to get questions needing review' });
    }

    const questionIds = (draftQuestions || []).map(q => q.id);

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

    const issuesByQuestionId = issues.reduce((acc, issue) => {
      if (!acc[issue.question_id]) {
        acc[issue.question_id] = [];
      }
      acc[issue.question_id].push(issue);
      return acc;
    }, {} as Record<string, any[]>);

    const response = (draftQuestions || []).map(question => ({
      ...question,
      validationIssues: issuesByQuestionId[question.id] || [],
    }));

    res.json({
      questions: response,
      total: draftQuestions?.length || 0,
      hasMore: (draftQuestions?.length || 0) === limit,
    });
  } catch (error: any) {
    console.error('Error getting questions needing review:', error);
    res.status(500).json({ error: 'Failed to get questions needing review' });
  }
};

/**
 * GET /api/admin/questions/duplicates
 * Detect duplicate canonical IDs (should normally be zero).
 */
export const getDuplicateQuestions = async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    const { data: allQuestions, error } = await supabaseServer
      .from('questions')
      .select('id, canonical_id, created_at')
      .not('canonical_id', 'is', null);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error fetching questions for duplicates:', error);
      return res.status(500).json({ error: 'Failed to get duplicate questions' });
    }

    const canonicalGroups: Record<string, any[]> = {};
    (allQuestions || []).forEach(q => {
      if (q.canonical_id) {
        if (!canonicalGroups[q.canonical_id]) {
          canonicalGroups[q.canonical_id] = [];
        }
        canonicalGroups[q.canonical_id].push(q);
      }
    });

    const duplicateCanonicalIds = Object.entries(canonicalGroups)
      .filter(([_, questions]) => questions.length > 1)
      .slice(0, limit)
      .map(([canonicalId]) => canonicalId);

    if (duplicateCanonicalIds.length === 0) {
      return res.json({
        duplicateGroups: [],
        total: 0,
      });
    }

    const { data: duplicateQuestions } = await supabaseServer
      .from('questions')
      .select('*')
      .in('canonical_id', duplicateCanonicalIds)
      .order('canonical_id')
      .order('created_at', { ascending: false });

    const grouped = duplicateCanonicalIds.map((canonicalId) => ({
      canonicalId,
      count: (duplicateQuestions || []).filter(q => q.canonical_id === canonicalId).length,
      questions: (duplicateQuestions || []).filter(q => q.canonical_id === canonicalId),
    }));

    res.json({
      duplicateGroups: grouped,
      total: duplicateCanonicalIds.length,
    });
  } catch (error: any) {
    console.error('Error getting duplicate questions:', error);
    res.status(500).json({ error: 'Failed to get duplicate questions' });
  }
};

/**
 * GET /api/admin/questions/statistics
 * Canonical question review statistics.
 */
export const getQuestionStatistics = async (_req: Request, res: Response) => {
  try {
    const { count: total } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true });

    const { count: draft } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'draft');

    const { count: reviewed } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'reviewed');

    const { count: multipleChoice } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('question_type', 'multiple_choice');

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
        needsReview: draft || 0,
        approved: reviewed || 0,
        multipleChoice: multipleChoice || 0,
        freeResponse: 0,
      },
      bySection,
      byDifficulty,
      validationIssues: {
        bySeverity: issueStats,
      },
    });
  } catch (error: any) {
    console.error('Error getting question statistics:', error);
    res.status(500).json({ error: 'Failed to get question statistics' });
  }
};

/**
 * POST /api/admin/questions/:id/approve
 * Approve a draft question.
 */
export const approveQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const reviewerId = (req as any).user?.id || null;

    const { error } = await supabaseServer
      .from('questions')
      .update({
        status: 'reviewed',
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error approving question:', error);
      return res.status(500).json({ error: 'Failed to approve question' });
    }

    res.json({
      id,
      status: 'reviewed',
      message: 'Question approved successfully',
    });
  } catch (error: any) {
    console.error('Error approving question:', error);
    res.status(500).json({ error: 'Failed to approve question' });
  }
};

/**
 * POST /api/admin/questions/:id/reject
 * Reject a draft question by deleting it.
 */
export const rejectQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseServer
      .from('questions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error rejecting question:', error);
      return res.status(500).json({ error: 'Failed to reject question' });
    }

    res.json({
      id,
      status: 'rejected',
      message: 'Question rejected successfully',
    });
  } catch (error: any) {
    console.error('Error rejecting question:', error);
    res.status(500).json({ error: 'Failed to reject question' });
  }
};

/**
 * PATCH /api/admin/questions/:id
 * Update canonical question fields.
 */
export const updateQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const fieldMapping: Record<string, string> = {
      stem: 'stem',
      options: 'options',
      optionMetadata: 'option_metadata',
      correctAnswer: 'correct_answer',
      answerText: 'answer_text',
      explanation: 'explanation',
      section: 'section',
      sectionCode: 'section_code',
      questionType: 'question_type',
      difficulty: 'difficulty',
      domain: 'domain',
      skill: 'skill',
      subskill: 'subskill',
      skillCode: 'skill_code',
      sourceType: 'source_type',
      status: 'status',
      tags: 'tags',
      competencies: 'competencies',
      provenanceChunkIds: 'provenance_chunk_ids',
      diagramPresent: 'diagram_present',
      testCode: 'test_code',
      exam: 'exam',
      aiGenerated: 'ai_generated',
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

    res.json({
      id,
      status: 'updated',
      updatedFields: Object.keys(filteredUpdates),
      message: 'Question updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating question:', error);
    res.status(500).json({ error: 'Failed to update question' });
  }
};

/**
 * DELETE /api/admin/questions/:id
 * Permanently delete a question.
 */
export const deleteQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await supabaseServer
      .from('validation_issues')
      .delete()
      .eq('question_id', id);

    const { error } = await supabaseServer
      .from('questions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error deleting question:', error);
      return res.status(500).json({ error: 'Failed to delete question' });
    }

    res.json({
      id,
      status: 'deleted',
      message: 'Question deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting question:', error);
    res.status(500).json({ error: 'Failed to delete question' });
  }
};

/**
 * POST /api/admin/questions/bulk-approve
 * Approve multiple questions at once.
 */
export const bulkApproveQuestions = async (req: Request, res: Response) => {
  try {
    const { questionIds } = req.body;

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ error: 'questionIds must be a non-empty array' });
    }

    const reviewerId = (req as any).user?.id || null;

    const { error } = await supabaseServer
      .from('questions')
      .update({
        status: 'reviewed',
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerId,
        updated_at: new Date().toISOString(),
      })
      .in('id', questionIds);

    if (error) {
      console.error('[ADMIN_QUESTIONS] Error bulk approving questions:', error);
      return res.status(500).json({ error: 'Failed to bulk approve questions' });
    }

    res.json({
      count: questionIds.length,
      status: 'reviewed',
      message: `${questionIds.length} questions approved successfully`,
    });
  } catch (error: any) {
    console.error('Error bulk approving questions:', error);
    res.status(500).json({ error: 'Failed to bulk approve questions' });
  }
};
