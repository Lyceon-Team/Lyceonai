/**
 * Admin Proof Routes - "No More Lying" Layer
 *
 * These endpoints verify Supabase is actually receiving data.
 * All queries use the service role key to bypass RLS.
 */

import { Router, Request, Response } from 'express';
import { csrfGuard } from '../middleware/csrf';
import { supabaseServer } from '../../apps/api/src/lib/supabase-server';
import { SUPABASE_QUESTIONS_COLUMNS, validateQuestionRow } from '../../apps/api/src/lib/question-validation';
import { generateCanonicalId } from '../../apps/api/src/lib/canonicalId';

const router = Router();

function getSupabaseProjectRef(): string {
  const url = process.env.SUPABASE_URL || '';
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match ? match[1] : 'unknown';
}

// All routes are now protected by requireSupabaseAdmin upstream. No bearer or isAuthorized logic remains.
const csrfProtection = csrfGuard();

/**
 * GET /api/admin/proof/questions
 * Returns proof that questions exist in Supabase
 */
router.get('/questions', async (_req: Request, res: Response) => {
  try {
    const { count, error: countError } = await supabaseServer
      .from('questions')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      return res.status(500).json({
        error: 'Supabase query failed',
        code: countError.code,
        message: countError.message,
        details: countError.details,
      });
    }

    const { data: latestRows, error: latestError } = await supabaseServer
      .from('questions')
      .select('id, canonical_id, section, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    if (latestError) {
      return res.status(500).json({
        error: 'Supabase query failed',
        code: latestError.code,
        message: latestError.message,
        details: latestError.details,
      });
    }

    const latestCreatedAt = latestRows?.[0]?.created_at || null;

    return res.json({
      supabaseProjectRef: getSupabaseProjectRef(),
      total: count || 0,
      latestCreatedAt,
      latestRows: latestRows || [],
      queriedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Server error',
      message: err.message,
    });
  }
});

/**
 * POST /api/admin/proof/insert-smoke
 * Insert ONE smoke test row to verify write path works
 */
router.post('/insert-smoke', csrfProtection, async (_req: Request, res: Response) => {
  try {
    const canonicalId = generateCanonicalId('SAT', 'M', '2');

    const smokeRow = {
      canonical_id: canonicalId,
      status: 'draft',
      section: 'Math',
      section_code: 'MATH',
      stem: `Smoke test question inserted at ${new Date().toISOString()}`,
      question_type: 'multiple_choice',
      options: [
        { key: 'A', text: 'Smoke option A' },
        { key: 'B', text: 'Smoke option B' },
        { key: 'C', text: 'Smoke option C' },
        { key: 'D', text: 'Smoke option D' },
      ],
      correct_answer: 'A',
      answer_text: 'Smoke option A',
      explanation: 'Smoke explanation',
      option_metadata: [
        { key: 'A', text: 'Smoke option A', is_correct: true },
        { key: 'B', text: 'Smoke option B', is_correct: false },
        { key: 'C', text: 'Smoke option C', is_correct: false },
        { key: 'D', text: 'Smoke option D', is_correct: false },
      ],
      domain: 'smoke',
      skill: 'smoke skill',
      subskill: 'smoke subskill',
      skill_code: 'SMOKE.SKILL',
      difficulty: 'easy',
      source_type: 'unknown',
      test_code: 'SAT',
      exam: 'SAT',
      ai_generated: true,
      diagram_present: false,
      tags: [],
      competencies: [],
      provenance_chunk_ids: [],
    };

    const validation = validateQuestionRow(smokeRow);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        errors: validation.errors,
        droppedKeys: validation.droppedKeys,
      });
    }

    const { data, error } = await supabaseServer
      .from('questions')
      .insert([validation.cleanedRow])
      .select('id, canonical_id, created_at')
      .single();

    if (error) {
      return res.status(500).json({
        error: 'Supabase insert failed',
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        attemptedColumns: Object.keys(validation.cleanedRow || {}),
        schemaColumns: SUPABASE_QUESTIONS_COLUMNS,
      });
    }

    return res.json({
      success: true,
      supabaseProjectRef: getSupabaseProjectRef(),
      insertedRow: data,
      message: 'Smoke test row inserted successfully',
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Server error',
      message: err.message,
    });
  }
});

/**
 * DELETE /api/admin/proof/cleanup-smoke
 * Delete smoke test rows (optional cleanup)
 */
router.delete('/cleanup-smoke', csrfProtection, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseServer
      .from('questions')
      .delete()
      .eq('skill_code', 'SMOKE.SKILL')
      .select('id');

    if (error) {
      return res.status(500).json({
        error: 'Supabase delete failed',
        code: error.code,
        message: error.message,
      });
    }

    return res.json({
      success: true,
      deletedCount: data?.length || 0,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Server error',
      message: err.message,
    });
  }
});

export default router;


