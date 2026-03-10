import { Request, Response, Router } from 'express';
import { requireSupabaseAuth } from '../middleware/supabase-auth';
import { requireGuardianEntitlement } from '../middleware/guardian-entitlement';
import { supabaseServer } from '../../apps/api/src/lib/supabase-server';
import { logger } from '../logger';
import { createDurableRateLimiter } from '../lib/durable-rate-limiter';
import { DateTime } from 'luxon';
import { csrfGuard } from '../middleware/csrf';
import { createGuardianLink, revokeGuardianLink, isGuardianLinkedToStudent, getAllGuardianStudentLinks } from '../lib/account';
import * as fullLengthExamService from "../../apps/api/src/services/fullLengthExam";
import { getDerivedWeaknessSignals } from '../../apps/api/src/services/mastery-derived';
import { buildCanonicalPracticeKpiSnapshot, buildGuardianSummaryKpiView, buildFullTestKpis, fullTestMeasurementModel, type ExplainedKpiMetric } from '../services/kpi-truth-layer';

const router = Router();
const csrfProtection = csrfGuard();

const durableRateLimiter = createDurableRateLimiter(10, 15 * 60 * 1000);

function requireGuardianRole(req: Request, res: Response, next: Function) {
  const requestId = req.requestId;
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required', requestId });
  }
  if (req.user.role !== 'guardian' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Guardian role required', requestId });
  }
  next();
}

async function auditLog(
  guardianId: string,
  action: 'link_attempt' | 'link_success' | 'unlink_success',
  outcome: 'success' | 'failure' | 'rate_limited',
  studentId?: string,
  reason?: string,
  codePrefix?: string,
  requestId?: string
) {
  try {
    const { error } = await supabaseServer.from('guardian_link_audit').insert({
      guardian_profile_id: guardianId,
      student_profile_id: studentId || null,
      action,
      outcome,
      student_code_prefix: codePrefix || null,
      request_id: requestId || null,
      metadata: reason ? { reason } : null,
    });
    if (error) {
      logger.error('GUARDIAN', 'audit_log', 'Failed to write audit log', { error, requestId });
    }
  } catch (err) {
    logger.error('GUARDIAN', 'audit_log', 'Failed to write audit log', { err, requestId });
  }
}

router.get('/students', requireSupabaseAuth, requireGuardianRole, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;

    // CANONICAL: Read from guardian_links, join profiles for display info
    const links = await getAllGuardianStudentLinks(guardianId);
    if (links.length === 0) {
      return res.json({ students: [], requestId });
    }

    const studentIds = links.map(l => l.student_user_id);
    const { data: students, error } = await supabaseServer
      .from('profiles')
      .select('id, email, display_name, created_at')
      .in('id', studentIds)
      .eq('role', 'student');

    if (error) {
      logger.error('GUARDIAN', 'list_students', 'Failed to fetch linked students', { error, requestId });
      return res.status(500).json({ error: 'Failed to fetch students', requestId });
    }

    res.json({ students: students || [], requestId });
  } catch (err) {
    logger.error('GUARDIAN', 'list_students', 'Error', { err, requestId });
    res.status(500).json({ error: 'Internal server error', requestId });
  }
});

router.post('/link', requireSupabaseAuth, requireGuardianRole, csrfProtection, durableRateLimiter, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Student link code is required', requestId });
    }

    const trimmedCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (trimmedCode.length !== 8) {
      await auditLog(guardianId, 'link_attempt', 'failure', undefined, 'invalid_format', trimmedCode.substring(0, 2), requestId);
      return res.status(400).json({ error: 'Invalid code format', requestId });
    }

    const { data: student, error: lookupError } = await supabaseServer
      .from('profiles')
      .select('id, email, display_name')
      .eq('student_link_code', trimmedCode)
      .eq('role', 'student')
      .single();

    if (lookupError || !student) {
      await auditLog(guardianId, 'link_attempt', 'failure', undefined, 'code_not_found', trimmedCode.substring(0, 2), requestId);
      logger.warn('GUARDIAN', 'link_attempt_failed', 'Invalid code attempt', { guardianId, requestId });
      return res.status(404).json({ error: 'Invalid or unavailable student code', requestId });
    }

    // CANONICAL: Check guardian_links for existing link
    const alreadyLinked = await isGuardianLinkedToStudent(guardianId, student.id);
    if (alreadyLinked) {
      await auditLog(guardianId, 'link_attempt', 'success', student.id, 'already_linked', undefined, requestId);
      return res.json({ ok: true, message: 'Already linked', student: { id: student.id, display_name: student.display_name }, requestId });
    }

    // Check if student is linked to another guardian via guardian_links
    const { data: existingLinks } = await supabaseServer
      .from('guardian_links')
      .select('guardian_profile_id')
      .eq('student_user_id', student.id)
      .eq('status', 'active')
      .limit(1);

    if (existingLinks && existingLinks.length > 0) {
      await auditLog(guardianId, 'link_attempt', 'failure', undefined, 'already_linked_other', trimmedCode.substring(0, 2), requestId);
      logger.warn('GUARDIAN', 'link_attempt_blocked', 'Student already linked to another guardian', { guardianId, requestId });
      return res.status(404).json({ error: 'Invalid or unavailable student code', requestId });
    }

    // CANONICAL: Create link in guardian_links
    try {
      await createGuardianLink(guardianId, student.id);
    } catch (linkError: any) {
      await auditLog(guardianId, 'link_attempt', 'failure', student.id, 'update_failed', undefined, requestId);
      logger.error('GUARDIAN', 'link_student', 'Failed to link student', { error: linkError.message, requestId });
      return res.status(500).json({ error: 'Failed to link student', requestId });
    }

    await auditLog(guardianId, 'link_success', 'success', student.id, undefined, undefined, requestId);
    logger.info('GUARDIAN', 'link_student', 'Student linked successfully', { guardianId, studentId: student.id, requestId });

    res.json({ ok: true, student: { id: student.id, display_name: student.display_name }, requestId });
  } catch (err) {
    logger.error('GUARDIAN', 'link_student', 'Error', { err, requestId });
    res.status(500).json({ error: 'Internal server error', requestId });
  }
});

router.delete('/link/:studentId', requireSupabaseAuth, requireGuardianRole, csrfProtection, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;
    const { studentId } = req.params;

    // CANONICAL: Verify link exists in guardian_links
    const linked = await isGuardianLinkedToStudent(guardianId, studentId);

    if (!linked) {
      logger.warn('GUARDIAN', 'unlink_denied', 'Guardian tried to unlink non-linked student', { guardianId, studentId, requestId });
      return res.status(403).json({ error: 'Not authorized to unlink this student', requestId });
    }

    // CANONICAL: Revoke link in guardian_links
    try {
      await revokeGuardianLink(guardianId, studentId);
    } catch (revokeError: any) {
      logger.error('GUARDIAN', 'unlink_student', 'Failed to unlink student', { error: revokeError.message, requestId });
      return res.status(500).json({ error: 'Failed to unlink student', requestId });
    }

    await auditLog(guardianId, 'unlink_success', 'success', studentId, undefined, undefined, requestId);
    logger.info('GUARDIAN', 'unlink_student', 'Student unlinked successfully', { guardianId, studentId, requestId });

    // Return updated student list from canonical source
    const links = await getAllGuardianStudentLinks(guardianId);
    const studentIds = links.map(l => l.student_user_id);
    let students: any[] = [];
    if (studentIds.length > 0) {
      const { data } = await supabaseServer
        .from('profiles')
        .select('id, email, display_name, created_at')
        .in('id', studentIds)
        .eq('role', 'student');
      students = data || [];
    }

    res.json({ ok: true, students, requestId });
  } catch (err) {
    logger.error('GUARDIAN', 'unlink_student', 'Error', { err, requestId });
    res.status(500).json({ error: 'Internal server error', requestId });
  }
});

router.get('/students/:studentId/summary', requireSupabaseAuth, requireGuardianRole, requireGuardianEntitlement, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;
    const { studentId } = req.params;

    const linked = await isGuardianLinkedToStudent(guardianId, studentId);
    if (!linked && req.user!.role !== 'admin') {
      logger.warn('GUARDIAN', 'summary_access_denied', 'Student not found or not linked to guardian', { guardianId, studentId, requestId });
      return res.status(404).json({ error: 'Student not found', requestId });
    }

    const { data: student, error: studentError } = await supabaseServer
      .from('profiles')
      .select('id, email, display_name, created_at')
      .eq('id', studentId)
      .eq('role', 'student')
      .single();

    if (studentError || !student) {
      return res.status(404).json({ error: 'Student not found', requestId });
    }

    const snapshot = await buildCanonicalPracticeKpiSnapshot(studentId);
    const guardianView = buildGuardianSummaryKpiView(snapshot);

    return res.json({
      student: {
        id: student.id,
        displayName: student.display_name,
        email: student.email,
      },
      progress: guardianView.progress,
      metrics: guardianView.metrics,
      measurementModel: guardianView.measurementModel,
      modelVersion: snapshot.modelVersion,
      requestId,
    });
  } catch (err) {
    logger.error('GUARDIAN', 'student_summary', 'Error', { err, requestId });
    return res.status(500).json({ error: 'Internal server error', requestId });
  }
});
function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function calculateStreakForStudent(userId: string, timezone: string): Promise<{ current: number; longest: number }> {
  const todayLocal = DateTime.now().setZone(timezone).toISODate();
  if (!todayLocal) return { current: 0, longest: 0 };

  const { data: completedDays, error } = await supabaseServer
    .from('student_study_plan_days')
    .select('day_date, status')
    .eq('user_id', userId)
    .order('day_date', { ascending: false })
    .limit(365);

  if (error || !completedDays || completedDays.length === 0) {
    return { current: 0, longest: 0 };
  }

  const isComplete = (day: any) => day.status === 'complete';
  const completeDaysSet = new Set(completedDays.filter(isComplete).map(d => d.day_date));

  let currentStreak = 0;
  let checkDate = DateTime.fromISO(todayLocal, { zone: timezone });

  while (completeDaysSet.has(checkDate.toISODate()!)) {
    currentStreak++;
    checkDate = checkDate.minus({ days: 1 });
  }

  let longestStreak = 0;
  let tempStreak = 0;
  let prevDate: DateTime | null = null;

  const sortedDays = completedDays.filter(isComplete).sort((a, b) => a.day_date.localeCompare(b.day_date));

  for (const day of sortedDays) {
    const dayDate = DateTime.fromISO(day.day_date, { zone: timezone });
    if (prevDate === null) {
      tempStreak = 1;
    } else {
      const expectedNext = prevDate.plus({ days: 1 });
      if (dayDate.toISODate() === expectedNext.toISODate()) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }
    prevDate = dayDate;
  }

  longestStreak = Math.max(longestStreak, tempStreak);
  return { current: currentStreak, longest: longestStreak };
}


type GuardianSafeExamReport = {
  sessionId: string;
  estimatedScore: {
    rw: number;
    math: number;
    total: number;
  };
  completedAt: Date;
  kpis: ExplainedKpiMetric[];
  measurementModel: ReturnType<typeof fullTestMeasurementModel>;
};

function toGuardianSafeExamReport(report: fullLengthExamService.CompleteExamResult): GuardianSafeExamReport {
  return {
    sessionId: report.sessionId,
    estimatedScore: {
      rw: report.scaledScore.rw,
      math: report.scaledScore.math,
      total: report.scaledScore.total,
    },
    completedAt: report.completedAt,
    kpis: buildFullTestKpis({
      scaledTotal: report.scaledScore.total,
      scaledRw: report.scaledScore.rw,
      scaledMath: report.scaledScore.math,
      totalCorrect: report.rawScore.total.correct,
      totalQuestions: report.rawScore.total.total,
    }),
    measurementModel: fullTestMeasurementModel(),
  };
}

// ============================================================================
// GUARDIAN FULL-LENGTH EXAM REPORTING
// ============================================================================
router.get('/students/:studentId/exams/full-length/:sessionId/report', requireSupabaseAuth, requireGuardianRole, requireGuardianEntitlement, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const { studentId, sessionId } = req.params;

    if (!isAdmin) {
      const linked = await isGuardianLinkedToStudent(guardianId, studentId);
      if (!linked) {
        logger.warn('GUARDIAN', 'full_length_report_denied', 'Guardian tried to view non-linked student full-length report', {
          guardianId,
          studentId,
          sessionId,
          requestId,
        });
        return res.status(403).json({ error: 'Not authorized to view this student', requestId });
      }
    }

    const report = await fullLengthExamService.getExamReport({
      sessionId,
      userId: studentId,
    });

    logger.info('GUARDIAN', 'full_length_report_view', 'Guardian viewed full-length exam report', {
      guardianId,
      studentId,
      sessionId,
      requestId,
    });

    return res.json({
      studentId,
      sessionId,
      report: toGuardianSafeExamReport(report),
      requestId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';

    if (message.includes('not found') || message.includes('access denied')) {
      return res.status(404).json({ error: 'Session not found', requestId });
    }

    if (message.includes('Results locked until completion')) {
      return res.status(423).json({ error: 'Results locked until completion', requestId });
    }

    logger.error('GUARDIAN', 'full_length_report', 'Error', { err, requestId });
    return res.status(500).json({ error: 'Internal server error', requestId });
  }
});
router.get('/students/:studentId/calendar/month', requireSupabaseAuth, requireGuardianRole, requireGuardianEntitlement, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const { studentId } = req.params;
    const start = req.query.start as string | undefined;
    const end = req.query.end as string | undefined;

    if (!start || !isIsoDate(start)) {
      return res.status(400).json({ error: 'start query param must be YYYY-MM-DD', requestId });
    }
    if (!end || !isIsoDate(end)) {
      return res.status(400).json({ error: 'end query param must be YYYY-MM-DD', requestId });
    }

    if (!isAdmin) {
      // CANONICAL: Verify link via guardian_links
      const linked = await isGuardianLinkedToStudent(guardianId, studentId);
      if (!linked) {
        logger.warn('GUARDIAN', 'calendar_access_denied', 'Student not found or not linked', { guardianId, studentId, requestId });
        return res.status(404).json({ error: 'Student not found', requestId });
      }
    }

    const { data: profile } = await supabaseServer
      .from('student_study_profile')
      .select('timezone')
      .eq('user_id', studentId)
      .maybeSingle();

    const timezone = profile?.timezone || 'America/Chicago';

    const startUtc = DateTime.fromISO(start, { zone: timezone }).startOf('day').toUTC().toISO()!;
    const endUtc = DateTime.fromISO(end, { zone: timezone }).endOf('day').toUTC().toISO()!;

    const [planDaysResult, attemptsResult, streakResult] = await Promise.all([
      supabaseServer
        .from('student_study_plan_days')
        .select('day_date, planned_minutes, completed_minutes, status, focus, plan_version, created_at, updated_at')
        .eq('user_id', studentId)
        .gte('day_date', start)
        .lte('day_date', end)
        .order('day_date', { ascending: true }),

      supabaseServer
        .from('student_question_attempts')
        .select('attempted_at, is_correct, time_spent_ms')
        .eq('user_id', studentId)
        .gte('attempted_at', startUtc)
        .lte('attempted_at', endUtc),

      calculateStreakForStudent(studentId, timezone),
    ]);

    if (planDaysResult.error) {
      logger.error('GUARDIAN', 'calendar_fetch_failed', 'Failed to load calendar', { error: planDaysResult.error, requestId });
      return res.status(500).json({ error: 'Failed to load calendar data', requestId });
    }

    const attemptsByDay = new Map<string, { attempts: number; correct: number; totalTimeMs: number }>();

    for (const attempt of attemptsResult.data || []) {
      if (!attempt.attempted_at) continue;
      const localDate = DateTime.fromISO(attempt.attempted_at).setZone(timezone).toISODate();
      if (!localDate) continue;

      if (!attemptsByDay.has(localDate)) {
        attemptsByDay.set(localDate, { attempts: 0, correct: 0, totalTimeMs: 0 });
      }
      const dayStats = attemptsByDay.get(localDate)!;
      dayStats.attempts++;
      if (attempt.is_correct) dayStats.correct++;
      dayStats.totalTimeMs += attempt.time_spent_ms || 0;
    }

    const enrichedDays = (planDaysResult.data ?? []).map(day => {
      const dayStats = attemptsByDay.get(day.day_date);
      return {
        ...day,
        attempt_count: dayStats?.attempts ?? 0,
        accuracy: dayStats && dayStats.attempts > 0
          ? Math.round((dayStats.correct / dayStats.attempts) * 100)
          : null,
        avg_seconds_per_question: dayStats && dayStats.attempts > 0
          ? Math.round(dayStats.totalTimeMs / dayStats.attempts / 1000)
          : null,
      };
    });

    logger.info('GUARDIAN', 'calendar_view', 'Guardian viewed student calendar', { guardianId, studentId, start, end, requestId });

    return res.json({
      days: enrichedDays,
      streak: streakResult,
      requestId,
    });
  } catch (err) {
    logger.error('GUARDIAN', 'calendar_month', 'Error', { err, requestId });
    res.status(500).json({ error: 'Internal server error', requestId });
  }
});

// ============================================================================
// GUARDIAN WEAKNESS ROLLUPS - Shows student's weakest competency areas
// ============================================================================
router.get('/weaknesses/:studentId', requireSupabaseAuth, requireGuardianRole, requireGuardianEntitlement, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;
    const { studentId } = req.params;

    // CANONICAL: Verify guardian-student link via guardian_links
    const linked = await isGuardianLinkedToStudent(guardianId, studentId);
    if (!linked && req.user!.role !== 'admin') {
      logger.warn('GUARDIAN', 'weaknesses_denied', 'Guardian tried to view non-linked student', { guardianId, studentId, requestId });
      return res.status(403).json({ error: 'Not authorized to view this student', requestId });
    }

    const { data: student, error: studentError } = await supabaseServer
      .from('profiles')
      .select('id, display_name')
      .eq('id', studentId)
      .eq('role', 'student')
      .single();

    if (studentError || !student) {
      return res.status(404).json({ error: 'Student not found', requestId });
    }

    const derivedWeakness = await getDerivedWeaknessSignals(studentId, {
      minAttempts: 1,
      limit: 20,
    });

    // Transform canonical mastery-derived signals to guardian weakness payload.
    const weakestAreas = derivedWeakness.map((s) => ({
      competency_key: s.competencyKey,
      section: s.section,
      attempts: s.attempts,
      correct: s.correct,
      incorrect: s.incorrect,
      skipped: s.skipped,
      weakness_score: s.weaknessScore,
      updated_at: s.updatedAt,
    }));
    logger.info('GUARDIAN', 'weaknesses_view', 'Guardian viewed student weaknesses', { guardianId, studentId, count: weakestAreas.length, requestId });

    return res.json({
      studentId,
      studentName: student.display_name,
      weakestAreas,
      requestId,
    });
  } catch (err) {
    logger.error('GUARDIAN', 'weaknesses', 'Error', { err, requestId });
    res.status(500).json({ error: 'Internal server error', requestId });
  }
});

export default router;

