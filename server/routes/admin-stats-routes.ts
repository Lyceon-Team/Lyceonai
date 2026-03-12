import { Router, Request, Response } from 'express';
import { supabaseServer } from '../../apps/api/src/lib/supabase-server';
import { logger } from '../logger.js';
import { requireSupabaseAdmin } from '../middleware/supabase-auth.js';
import { buildCanonicalPracticeKpiSnapshot, buildStudentKpiView } from '../services/kpi-truth-layer';

const router = Router();

/**
 * GET /api/admin/stats
 * Get admin dashboard statistics (Supabase only)
 */
router.get('/stats', requireSupabaseAdmin, async (req: Request, res: Response) => {
  try {
    const [
      questionsResult,
      needsReviewResult,
      recentSessionsResult
    ] = await Promise.all([
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
      supabaseServer.from('practice_sessions').select('id', { count: 'exact', head: true })
        .gte('started_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    ]);

    res.json({
      questions: {
        total: Number(questionsResult.count ?? 0),
        needsReview: Number(needsReviewResult.count ?? 0)
      },
      practice: {
        recentSessions: Number(recentSessionsResult.count ?? 0)
      }
    });
  } catch (error) {
    logger.error('ADMIN', 'stats_error', 'Failed to fetch admin stats', error);
    res.status(500).json({ error: 'Failed to fetch admin statistics' });
  }
});

/**
 * GET /api/admin/kpis
 * Get detailed KPIs - shows Supabase question counts
 */
router.get('/kpis', requireSupabaseAdmin, async (req: Request, res: Response) => {
  try {
    // Get question counts by section
    const [
      totalQuestionsResult,
      mathQuestionsResult,
      rwQuestionsResult,
      needsReviewResult,
      latestQuestionResult,
    ] = await Promise.all([
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).eq('section', 'Math'),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).eq('section', 'Reading and Writing'),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
      supabaseServer.from('questions').select('created_at, source_pdf').order('created_at', { ascending: false }).limit(1),
    ]);

    // Get question type breakdown
    const [mcCountResult] = await Promise.all([
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).eq('question_type', 'multiple_choice'),
    ]);

    const latestQuestion = latestQuestionResult.data?.[0];
    
    res.json({
      supabaseConnected: true,
      questions: {
        total: Number(totalQuestionsResult.count ?? 0),
        math: Number(mathQuestionsResult.count ?? 0),
        readingWriting: Number(rwQuestionsResult.count ?? 0),
        needsReview: Number(needsReviewResult.count ?? 0),
        multipleChoice: Number(mcCountResult.count ?? 0),
        freeResponse: 0,
      },
      latestQuestion: {
        createdAt: latestQuestion?.created_at ?? null,
        sourcePdf: latestQuestion?.source_pdf ?? null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('ADMIN', 'kpis_error', 'Failed to fetch KPIs', error);
    res.status(500).json({ 
      supabaseConnected: false,
      error: 'Failed to fetch KPIs',
      detail: error?.message 
    });
  }
});

/**
 * GET /api/admin/kpis/student/:studentId
 * Internal KPI snapshot from canonical truth-layer rules.
 */
router.get('/kpis/student/:studentId', requireSupabaseAdmin, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params;
    if (!studentId) {
      return res.status(400).json({ error: 'studentId required' });
    }

    const snapshot = await buildCanonicalPracticeKpiSnapshot(studentId);
    const view = buildStudentKpiView(snapshot, true);

    return res.json({
      studentId,
      modelVersion: view.modelVersion,
      view,
      internal: {
        audience: 'internal',
        includesHistoricalTrends: true,
        note: 'Admin snapshot uses canonical student KPI rules with paid gating bypass.',
      },
    });
  } catch (error: any) {
    logger.error('ADMIN', 'student_kpis_error', 'Failed to fetch canonical student KPI snapshot', error);
    return res.status(500).json({ error: 'Failed to fetch student KPI snapshot', detail: error?.message });
  }
});
/**
 * GET /api/admin/database/schema
 * Get database schema information (minimal - just table/column names)
 */
router.get('/database/schema', requireSupabaseAdmin, async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      message: 'Schema is managed via Supabase. Please use Supabase dashboard for schema inspection.',
      tables: [
        'questions',
        'practice_sessions',
        'answer_attempts',
        'notifications',
        'notification_reads',
        'admin_audit_logs',
        'profiles'
      ]
    });
  } catch (error) {
    logger.error('ADMIN', 'schema_error', 'Failed to fetch database schema', error);
    res.status(500).json({ error: 'Failed to fetch database schema' });
  }
});

/**
 * GET /api/admin/questions-proof
 * Phase 6: Proof endpoint showing questions data from Supabase
 */
router.get('/questions-proof', requireSupabaseAdmin, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const [totalResult, latestResult, recentResult, sampleResult] = await Promise.all([
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }),
      supabaseServer.from('questions').select('created_at').order('created_at', { ascending: false }).limit(1),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).gte('created_at', oneHourAgo),
      supabaseServer.from('questions').select('id, question_hash, created_at').order('created_at', { ascending: false }).limit(5),
    ]);

    res.json({
      totalQuestions: Number(totalResult.count ?? 0),
      latestCreatedAt: latestResult.data?.[0]?.created_at ?? null,
      addedLastHour: Number(recentResult.count ?? 0),
      recentSample: sampleResult.data?.map((q: any) => ({
        id: q.id,
        question_hash: q.question_hash,
        created_at: q.created_at,
      })) ?? [],
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    logger.error('ADMIN', 'questions_proof_error', 'Failed to fetch questions proof', error);
    res.status(500).json({ 
      error: 'Failed to fetch questions proof',
      detail: error?.message 
    });
  }
});

export default router;

