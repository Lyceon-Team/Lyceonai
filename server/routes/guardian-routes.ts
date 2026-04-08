import { Request, Response, Router } from 'express';
import { getSupabaseAdmin, requireSupabaseAuth } from '../middleware/supabase-auth';
import { requireGuardianEntitlement } from '../middleware/guardian-entitlement';
import { requireGuardianRole } from '../middleware/guardian-role';
import { supabaseServer } from '../../apps/api/src/lib/supabase-server';
import { logger } from '../logger';
import { createDurableRateLimiter } from '../lib/durable-rate-limiter';
import { createGuardianLink, revokeGuardianLink, isGuardianLinkedToStudent, getAllGuardianStudentLinks, ensureAccountForUser } from '../lib/account';
// Intentional cross-boundary imports: guardian runtime routes reuse canonical apps/api services for shared exam/mastery reads.
import * as fullLengthExamService from "../../apps/api/src/services/fullLengthExam";
import { buildWeaknessSkillsView } from '../../apps/api/src/services/weakness-view';
import { mapMasteryStatusFromLevel } from '../../apps/api/src/services/mastery-read';
import { buildStudentKpiViewFromCanonical, buildStudentFullLengthReportView, projectGuardianFullLengthReportView } from '../services/canonical-runtime-views';
import { buildCalendarMonthView } from '../../apps/api/src/services/calendar-month-view';

const router = Router();

const durableRateLimiter = createDurableRateLimiter(10, 15 * 60 * 1000);
const requireGuardianAccess = requireGuardianRole({
  message: 'You do not have permission to access guardian resources',
});

type GuardianAccessEventType =
  | 'guardian_dashboard_viewed'
  | 'guardian_calendar_viewed'
  | 'guardian_report_viewed'
  | 'guardian_access_denied';

async function emitGuardianAccessEvent(args: {
  eventType: GuardianAccessEventType;
  guardianId: string;
  studentId?: string;
  requestId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseServer.from('system_event_logs').insert({
      event_type: args.eventType,
      level: 'info',
      source: 'guardian_routes',
      message: args.eventType,
      user_id: args.guardianId,
      session_id: args.studentId ?? null,
      details: {
        request_id: args.requestId ?? null,
        student_id: args.studentId ?? null,
        ...(args.details ?? {}),
      },
    });
  } catch {
    // Best effort only.
  }
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

router.get('/students', requireSupabaseAuth, requireGuardianAccess, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;

    // CANONICAL: Read from guardian_links, join profiles for display info
    const links = await getAllGuardianStudentLinks(guardianId);
    if (links.length === 0) {
      await emitGuardianAccessEvent({
        eventType: 'guardian_dashboard_viewed',
        guardianId,
        requestId,
        details: { linked_student_count: 0 },
      });
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

    await emitGuardianAccessEvent({
      eventType: 'guardian_dashboard_viewed',
      guardianId,
      requestId,
      details: { linked_student_count: (students || []).length },
    });
    res.json({ students: students || [], requestId });
  } catch (err) {
    logger.error('GUARDIAN', 'list_students', 'Error', { err, requestId });
    res.status(500).json({ error: 'Internal server error', requestId });
  }
});

router.post('/link', requireSupabaseAuth, requireGuardianAccess, durableRateLimiter, async (req: Request, res: Response) => {
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


    // CANONICAL: Create link in guardian_links with resolved student account_id
    try {
      const studentAccountId = await ensureAccountForUser(getSupabaseAdmin(), student.id, 'student');
      await createGuardianLink(guardianId, student.id, studentAccountId);
    } catch (linkError: any) {
      if (linkError?.code === 'GUARDIAN_ALREADY_LINKED') {
        await auditLog(guardianId, 'link_attempt', 'failure', student.id, 'guardian_already_linked_other', trimmedCode.substring(0, 2), requestId);
        return res.status(409).json({
          error: 'Guardian already linked to another student. Unlink before linking a new student.',
          code: 'GUARDIAN_ALREADY_LINKED',
          requestId,
        });
      }

      if (linkError?.code === 'STUDENT_ALREADY_LINKED') {
        await auditLog(guardianId, 'link_attempt', 'failure', student.id, 'already_linked_other', trimmedCode.substring(0, 2), requestId);
        return res.status(404).json({ error: 'Invalid or unavailable student code', requestId });
      }

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

router.delete('/link/:studentId', requireSupabaseAuth, requireGuardianAccess, async (req: Request, res: Response) => {
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
      if (revokeError?.code === 'LINK_NOT_ACTIVE') {
        logger.warn('GUARDIAN', 'unlink_conflict', 'Guardian link no longer active at revoke time', { guardianId, studentId, requestId });
        return res.status(409).json({ error: 'Link is no longer active', code: 'LINK_NOT_ACTIVE', requestId });
      }
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

router.get('/students/:studentId/summary', requireSupabaseAuth, requireGuardianAccess, requireGuardianEntitlement, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;
    const { studentId } = req.params;

    const linked = await isGuardianLinkedToStudent(guardianId, studentId);
    if (!linked && req.user!.role !== 'admin') {
      logger.warn('GUARDIAN', 'summary_access_denied', 'Student not found or not linked to guardian', { guardianId, studentId, requestId });
      await emitGuardianAccessEvent({
        eventType: 'guardian_access_denied',
        guardianId,
        studentId,
        requestId,
        details: { surface: 'summary', reason: 'not_linked' },
      });
      return res.status(404).json({ error: 'Student not found', requestId });
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

    const studentView = await buildStudentKpiViewFromCanonical(studentId, true);
    const guardianMetricIds = new Set(['week_minutes', 'week_sessions', 'week_questions', 'week_accuracy']);
    const guardianMetrics = studentView.metrics.filter((metric) => guardianMetricIds.has(metric.id));
    const metricById = new Map(guardianMetrics.map((metric) => [metric.id, metric]));
    const progress = {
      practiceMinutesLast7Days: Number(metricById.get('week_minutes')?.value ?? 0),
      sessionsLast7Days: Number(metricById.get('week_sessions')?.value ?? 0),
      questionsAttempted: Number(metricById.get('week_questions')?.value ?? 0),
      accuracy: metricById.get('week_accuracy')?.value == null ? null : Number(metricById.get('week_accuracy')?.value),
      explanations: Object.fromEntries(guardianMetrics.map((metric) => [metric.id, metric.explanation])),
    };
    const measurementModel = {
      official: [],
      weighted: [],
      diagnostic: guardianMetrics.map((metric) => metric.id),
    };
    await emitGuardianAccessEvent({
      eventType: 'guardian_report_viewed',
      guardianId,
      studentId,
      requestId,
      details: { surface: 'summary' },
    });

    return res.json({
      student: {
        id: student.id,
        displayName: student.display_name,
      },
      progress,
      metrics: guardianMetrics,
      measurementModel,
      modelVersion: studentView.modelVersion,
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


// ============================================================================
// GUARDIAN FULL-LENGTH EXAM REPORTING
// ============================================================================
router.get('/students/:studentId/exams/full-length/sessions', requireSupabaseAuth, requireGuardianAccess, requireGuardianEntitlement, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const { studentId } = req.params;

    if (!isAdmin) {
      const linked = await isGuardianLinkedToStudent(guardianId, studentId);
      if (!linked) {
        logger.warn('GUARDIAN', 'full_length_history_denied', 'Guardian tried to view non-linked student full-length history', {
          guardianId,
          studentId,
          requestId,
        });
        await emitGuardianAccessEvent({
          eventType: 'guardian_access_denied',
          guardianId,
          studentId,
          requestId,
          details: { surface: 'full_length_history', reason: 'not_linked' },
        });
        return res.status(403).json({ error: 'Not authorized to view this student', requestId });
      }
    }

    const rawLimit = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.trunc(rawLimit), 50)) : 20;
    const includeIncompleteRaw = String(req.query.include_incomplete ?? '').toLowerCase();
    const includeIncomplete = includeIncompleteRaw === '1' || includeIncompleteRaw === 'true';

    // Canonical projection: guardian history reuses the same student truth model.
    const sessions = await fullLengthExamService.listExamSessions({
      userId: studentId,
      limit,
      includeIncomplete,
    });

    const projected = sessions.map((session) => ({
      sessionId: session.sessionId,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      createdAt: session.createdAt,
      reportAvailable: session.status === 'completed',
      // Guardian review endpoint is not mounted; fail closed by exposing false.
      reviewAvailable: false,
    }));

    logger.info('GUARDIAN', 'full_length_history_view', 'Guardian viewed student full-length history', {
      guardianId,
      studentId,
      count: projected.length,
      requestId,
    });
    await emitGuardianAccessEvent({
      eventType: 'guardian_report_viewed',
      guardianId,
      studentId,
      requestId,
      details: { surface: 'full_length_history', count: projected.length },
    });

    return res.json({
      studentId,
      sessions: projected,
      requestId,
    });
  } catch (err) {
    logger.error('GUARDIAN', 'full_length_history', 'Error', { err, requestId });
    return res.status(500).json({ error: 'Internal server error', requestId });
  }
});

router.get('/students/:studentId/exams/full-length/:sessionId/report', requireSupabaseAuth, requireGuardianAccess, requireGuardianEntitlement, async (req: Request, res: Response) => {
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
        await emitGuardianAccessEvent({
          eventType: 'guardian_access_denied',
          guardianId,
          studentId,
          requestId,
          details: { surface: 'full_length_report', session_id: sessionId, reason: 'not_linked' },
        });
        return res.status(403).json({ error: 'Not authorized to view this student', requestId });
      }
    }

    const report = await fullLengthExamService.getExamReport({
      sessionId,
      userId: studentId,
    });
    const studentView = buildStudentFullLengthReportView(report);

    logger.info('GUARDIAN', 'full_length_report_view', 'Guardian viewed full-length exam report', {
      guardianId,
      studentId,
      sessionId,
      requestId,
    });
    await emitGuardianAccessEvent({
      eventType: 'guardian_report_viewed',
      guardianId,
      studentId,
      requestId,
      details: { surface: 'full_length_report', session_id: sessionId },
    });

    return res.json({
      studentId,
      sessionId,
      report: projectGuardianFullLengthReportView(studentView),
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
// Guardian calendar endpoint is read-only by contract.
router.get('/students/:studentId/calendar/month', requireSupabaseAuth, requireGuardianAccess, requireGuardianEntitlement, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const { studentId } = req.params;
    const start = req.query.start as string | undefined;
    const end = req.query.end as string | undefined;

    if (!isAdmin) {
      // CANONICAL: Verify link via guardian_links
      const linked = await isGuardianLinkedToStudent(guardianId, studentId);
      if (!linked) {
        logger.warn('GUARDIAN', 'calendar_access_denied', 'Student not found or not linked', { guardianId, studentId, requestId });
        await emitGuardianAccessEvent({
          eventType: 'guardian_access_denied',
          guardianId,
          studentId,
          requestId,
          details: { surface: 'calendar', reason: 'not_linked' },
        });
        return res.status(404).json({ error: 'Student not found', requestId });
      }
    }

    if (!start || !isIsoDate(start)) {
      return res.status(400).json({ error: 'start query param must be YYYY-MM-DD', requestId });
    }
    if (!end || !isIsoDate(end)) {
      return res.status(400).json({ error: 'end query param must be YYYY-MM-DD', requestId });
    }

    const { data: profile, error: profileError } = await supabaseServer
      .from('student_study_profile')
      .select('timezone')
      .eq('user_id', studentId)
      .maybeSingle();

    if (profileError) {
      logger.error('GUARDIAN', 'calendar_profile_fetch_failed', 'Failed to load student timezone for calendar', {
        error: profileError,
        requestId,
      });
      return res.status(500).json({ error: 'Failed to load calendar data', requestId });
    }

    const timezone = profile?.timezone || 'America/Chicago';
    const payload = await buildCalendarMonthView(studentId, start, end, timezone);
    const projectedDays = payload.days.map((day: any) => ({
      day_date: day.day_date,
      planned_minutes: day.planned_minutes,
      completed_minutes: day.completed_minutes,
      status: day.status,
      attempt_count: day.attempt_count,
      accuracy: day.accuracy,
      avg_seconds_per_question: day.avg_seconds_per_question,
    }));

    logger.info('GUARDIAN', 'calendar_view', 'Guardian viewed student calendar', { guardianId, studentId, start, end, requestId });
    await emitGuardianAccessEvent({
      eventType: 'guardian_calendar_viewed',
      guardianId,
      studentId,
      requestId,
      details: { surface: 'calendar', start, end, day_count: projectedDays.length },
    });

    return res.json({
      days: projectedDays,
      streak: payload.streak,
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
router.get('/weaknesses/:studentId', requireSupabaseAuth, requireGuardianAccess, requireGuardianEntitlement, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const guardianId = req.user!.id;
    const { studentId } = req.params;
    const section = typeof req.query.section === 'string' ? req.query.section : undefined;
    const limit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const minAttempts = Number.parseInt(String(req.query.minAttempts ?? ''), 10);

    // CANONICAL: Verify guardian-student link via guardian_links
    const linked = await isGuardianLinkedToStudent(guardianId, studentId);
    if (!linked && req.user!.role !== 'admin') {
      logger.warn('GUARDIAN', 'weaknesses_denied', 'Guardian tried to view non-linked student', { guardianId, studentId, requestId });
      await emitGuardianAccessEvent({
        eventType: 'guardian_access_denied',
        guardianId,
        studentId,
        requestId,
        details: { surface: 'weaknesses', reason: 'not_linked' },
      });
      return res.status(403).json({ error: 'Not authorized to view this student', requestId });
    }

    const view = await buildWeaknessSkillsView({
      userId: studentId,
      section,
      limit: Number.isFinite(limit) ? limit : undefined,
      minAttempts: Number.isFinite(minAttempts) ? minAttempts : undefined,
    });
    const safeSkills = view.skills.map((skill) => ({
      section: skill.section,
      domain: skill.domain,
      skill: skill.skill,
      attempts: skill.attempts,
      correct: skill.correct,
      accuracyPercent: Math.round((skill.accuracy ?? 0) * 100),
      status: mapMasteryStatusFromLevel(skill.mastery_level, skill.attempts, skill.mastery_score),
    }));
    logger.info('GUARDIAN', 'weaknesses_view', 'Guardian viewed student weaknesses', { guardianId, studentId, count: view.count, requestId });
    await emitGuardianAccessEvent({
      eventType: 'guardian_report_viewed',
      guardianId,
      studentId,
      requestId,
      details: { surface: 'weaknesses', count: view.count },
    });

    return res.json({
      ok: view.ok,
      count: safeSkills.length,
      skills: safeSkills,
      requestId,
    });
  } catch (err) {
    logger.error('GUARDIAN', 'weaknesses', 'Error', { err, requestId });
    res.status(500).json({ error: 'Internal server error', requestId });
  }
});

export default router;

