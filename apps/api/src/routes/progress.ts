import { Response, Request as ExpressRequest } from 'express';
import { supabaseServer } from '../lib/supabase-server';

import { calculateScore, DomainMastery, ScoreProjection } from '../../../../server/services/score-projection';
import { DateTime } from 'luxon';

// ============================================================================
// COMPETENCY SCORING WEIGHTS (LOCKED)
// Positive = weakness signal, Negative = recovery/mastery signal
// ============================================================================
export function getCompetencyDelta(source: 'practice' | 'review', eventType: 'correct' | 'incorrect' | 'skipped'): number {
  if (eventType === 'skipped') {
    return 0.5;
  }
  if (source === 'practice') {
    return eventType === 'incorrect' ? 1.0 : -1.0;
  }
  return eventType === 'incorrect' ? 1.5 : -0.75;
}

// ============================================================================
// COMPETENCY MAPPING: Question -> Competency Tags
// ============================================================================
export function getCompetencyTags(question: { 
  competencies?: string[] | null; 
  tags?: string[] | string | null; 
  unit_tag?: string | null;
  section?: string | null;
}): string[] {
  if (question.competencies && Array.isArray(question.competencies) && question.competencies.length > 0) {
    return question.competencies;
  }
  if (question.tags) {
    const tagArray = Array.isArray(question.tags) 
      ? question.tags 
      : typeof question.tags === 'string' 
        ? question.tags.split(',').map(t => t.trim()).filter(Boolean)
        : [];
    if (tagArray.length > 0) {
      return tagArray;
    }
  }
  if (question.unit_tag) {
    return [question.unit_tag];
  }
  const section = question.section?.toLowerCase().replace(/\s+/g, '_') || 'unknown';
  return [`${section}.general`];
}

// ============================================================================
// RECORD COMPETENCY EVENT
// ============================================================================
export async function recordCompetencyEvent(
  userId: string,
  questionId: string,
  sessionId: string | null,
  source: 'practice' | 'review',
  eventType: 'correct' | 'incorrect' | 'skipped',
  question: { section?: string | null; unit_tag?: string | null; competencies?: string[] | null; tags?: string[] | string | null }
): Promise<void> {
  try {
    const delta = getCompetencyDelta(source, eventType);
    const competencyTags = getCompetencyTags(question);
    const now = new Date().toISOString();

    const { error: eventError } = await supabaseServer
      .from('competency_events')
      .insert({
        user_id: userId,
        question_id: questionId,
        session_id: sessionId,
        event_source: source,
        event_type: eventType,
        delta,
        occurred_at: now,
        section: question.section || null,
        competency_tags: competencyTags,
        unit_tag: question.unit_tag || null,
      });

    if (eventError) {
      console.warn('Failed to insert competency event:', eventError.message);
    }

    for (const competencyKey of competencyTags) {
      const { data: existing } = await supabaseServer
        .from('user_competencies')
        .select('*')
        .eq('user_id', userId)
        .eq('competency_key', competencyKey)
        .single();

      if (existing) {
        const updates: Record<string, any> = {
          score: (existing.score || 0) + delta,
          last_event_at: now,
          attempt_count: (existing.attempt_count || 0) + 1,
          updated_at: now,
        };
        if (eventType === 'incorrect') {
          updates.incorrect_count = (existing.incorrect_count || 0) + 1;
          if (source === 'review') {
            updates.review_incorrect_count = (existing.review_incorrect_count || 0) + 1;
          }
        } else if (eventType === 'skipped') {
          updates.skipped_count = (existing.skipped_count || 0) + 1;
        }

        await supabaseServer
          .from('user_competencies')
          .update(updates)
          .eq('user_id', userId)
          .eq('competency_key', competencyKey);
      } else {
        await supabaseServer
          .from('user_competencies')
          .insert({
            user_id: userId,
            competency_key: competencyKey,
            section: question.section || null,
            score: delta,
            last_event_at: now,
            attempt_count: 1,
            incorrect_count: eventType === 'incorrect' ? 1 : 0,
            review_incorrect_count: eventType === 'incorrect' && source === 'review' ? 1 : 0,
            skipped_count: eventType === 'skipped' ? 1 : 0,
            updated_at: now,
          });
      }
    }
  } catch (error) {
    console.error('Error recording competency event:', error);
  }
}

// ============================================================================
// GET /api/recent-activity - Last 20 items for authenticated user
// ============================================================================
export const getRecentActivity = async (req: Request, res: Response) => {
  try {

    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { data: events, error } = await supabaseServer
      .from('competency_events')
      .select(`
        id,
        question_id,
        event_source,
        event_type,
        section,
        occurred_at
      `)
      .eq('user_id', user.id)
      .order('occurred_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Error fetching competency events:', error);
      const { data: attempts, error: attemptsError } = await supabaseServer
        .from('answer_attempts')
        .select(`
          id,
          question_id,
          is_correct,
          outcome,
          attempted_at,
          practice_sessions!inner (
            user_id
          ),
          questions (
            id,
            stem,
            section
          )
        `)
        .order('attempted_at', { ascending: false })
        .limit(50);

      if (attemptsError) {
        return res.status(500).json({ error: 'Failed to fetch recent activity' });
      }

      const userAttempts = (attempts ?? []).filter((a: any) => a.practice_sessions?.user_id === req.user?.id).slice(0, 20);
      const fallbackData = userAttempts.map((a: any) => ({
        id: a.id,
        questionId: a.question_id,
        stemSnippet: a.questions?.stem?.slice(0, 150) || 'Question',
        section: a.questions?.section || 'Unknown',
        result: a.outcome || (a.is_correct ? 'correct' : 'incorrect'),
        source: 'practice',
        occurredAt: a.attempted_at,
      }));

      return res.json(fallbackData);
    }

    if (!events || events.length === 0) {
      const { data: attempts } = await supabaseServer
        .from('answer_attempts')
        .select(`
          id,
          question_id,
          is_correct,
          outcome,
          attempted_at,
          session_id,
          practice_sessions!inner (
            user_id
          ),
          questions (
            id,
            stem,
            section
          )
        `)
        .order('attempted_at', { ascending: false })
        .limit(20);

      const userAttempts = (attempts ?? []).filter((a: any) => a.practice_sessions?.user_id === (req as ExpressRequest).user?.id);
      
      const fallbackData = userAttempts.map((a: any) => ({
        id: a.id,
        questionId: a.question_id,
        stemSnippet: a.questions?.stem?.slice(0, 150) || 'Question',
        section: a.questions?.section || 'Unknown',
        result: a.outcome || (a.is_correct ? 'correct' : 'incorrect'),
        source: 'practice',
        occurredAt: a.attempted_at,
      }));

      return res.json(fallbackData);
    }

    const questionIds = [...new Set(events.map(e => e.question_id))];
    const { data: questions } = await supabaseServer
      .from('questions')
      .select('id, stem, section')
      .in('id', questionIds);

    const questionMap = new Map((questions ?? []).map(q => [q.id, q]));

    const activityData = events.map(e => {
      const q = questionMap.get(e.question_id);
      return {
        id: e.id,
        questionId: e.question_id,
        stemSnippet: q?.stem?.slice(0, 150) || 'Question',
        section: q?.section || e.section || 'Unknown',
        result: e.event_type,
        source: e.event_source,
        occurredAt: e.occurred_at,
      };
    });

    res.json(activityData);
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
};

// ============================================================================
// GET /api/progress - Dashboard aggregates
// ============================================================================
export const getProgress = async (req: Request, res: Response) => {
  try {

    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: events, error: eventsError } = await supabaseServer
      .from('competency_events')
      .select('event_type, section, delta')
      .eq('user_id', user.id)
      .gte('occurred_at', sevenDaysAgo.toISOString());

    let totals = { correct: 0, incorrect: 0, skipped: 0 };
    let bySection: Record<string, { correct: number; incorrect: number; skipped: number }> = {};

    if (!eventsError && events && events.length > 0) {
      for (const e of events) {
        if (e.event_type === 'correct') totals.correct++;
        else if (e.event_type === 'incorrect') totals.incorrect++;
        else if (e.event_type === 'skipped') totals.skipped++;

        const section = e.section || 'Unknown';
        if (!bySection[section]) {
          bySection[section] = { correct: 0, incorrect: 0, skipped: 0 };
        }
        if (e.event_type === 'correct') bySection[section].correct++;
        else if (e.event_type === 'incorrect') bySection[section].incorrect++;
        else if (e.event_type === 'skipped') bySection[section].skipped++;
      }
    } else {
      const { data: attempts } = await supabaseServer
        .from('answer_attempts')
        .select(`
          is_correct,
          outcome,
          attempted_at,
          session_id,
          practice_sessions!inner (
            user_id,
            section
          )
        `)
        .gte('attempted_at', sevenDaysAgo.toISOString());

      const userAttempts = (attempts ?? []).filter((a: any) => a.practice_sessions?.user_id === req.user?.id);

      for (const a of userAttempts) {
        const outcome = a.outcome || (a.is_correct ? 'correct' : 'incorrect');
        if (outcome === 'correct') totals.correct++;
        else if (outcome === 'incorrect') totals.incorrect++;
        else if (outcome === 'skipped') totals.skipped++;

        const section = (a as any).practice_sessions?.section || 'Unknown';
        if (!bySection[section]) {
          bySection[section] = { correct: 0, incorrect: 0, skipped: 0 };
        }
        if (outcome === 'correct') bySection[section].correct++;
        else if (outcome === 'incorrect') bySection[section].incorrect++;
        else if (outcome === 'skipped') bySection[section].skipped++;
      }
    }

    const { data: weakest } = await supabaseServer
      .from('user_competencies')
      .select('competency_key, section, score, incorrect_count')
      .eq('user_id', (req as ExpressRequest).user.id)
      .order('score', { ascending: false })
      .limit(5);

    const { data: improving } = await supabaseServer
      .from('user_competencies')
      .select('competency_key, section, score')
      .eq('user_id', (req as ExpressRequest).user.id)
      .order('score', { ascending: true })
      .limit(5);

    const accuracy = totals.correct + totals.incorrect > 0
      ? Math.round((totals.correct / (totals.correct + totals.incorrect)) * 100)
      : 0;

    const currentScore = 1200 + Math.floor(accuracy * 2);

    res.json({
      totals,
      bySection,
      weakestCompetencies: (weakest ?? []).map(c => ({
        key: c.competency_key,
        section: c.section,
        score: c.score,
        incorrectCount: c.incorrect_count,
      })),
      improvingCompetencies: (improving ?? []).filter(c => c.score < 0).map(c => ({
        key: c.competency_key,
        section: c.section,
        score: c.score,
      })),
      accuracy,
      currentScore,
      totalAttempts: totals.correct + totals.incorrect + totals.skipped,
    });
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
};

// ============================================================================
// POST /api/review-errors/attempt - Record review attempt competency event
// ============================================================================
export const recordReviewAttempt = async (req: Request, res: Response) => {
  try {
    const user = (req as ExpressRequest).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { questionId, eventType, sessionId } = req.body;

    if (!questionId || !eventType) {
      return res.status(400).json({ error: 'Missing required fields: questionId, eventType' });
    }

    if (!['correct', 'incorrect', 'skipped'].includes(eventType)) {
      return res.status(400).json({ error: 'eventType must be correct, incorrect, or skipped' });
    }

    // ENFORCEMENT: If sessionId is provided, validate session ownership
    if (sessionId) {
      const { data: session, error: sessionError } = await supabaseServer
        .from('practice_sessions')
        .select('id, user_id')
        .eq('id', sessionId)
        .single();
      if (sessionError || !session || session.user_id !== user.id) {
        return res.status(403).json({ error: 'Forbidden: session does not belong to user' });
      }
    }

    const { data: question, error: qError } = await supabaseServer
      .from('questions')
      .select('id, section, unit_tag, competencies, tags')
      .eq('id', questionId)
      .single();

    if (qError || !question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    await recordCompetencyEvent(
      user.id,
      questionId,
      sessionId || null,
      'review',
      eventType as 'correct' | 'incorrect' | 'skipped',
      question
    );

    res.json({ 
      success: true,
      delta: getCompetencyDelta('review', eventType as 'correct' | 'incorrect' | 'skipped'),
    });
  } catch (error) {
    console.error('Error recording review attempt:', error);
    res.status(500).json({ error: 'Failed to record review attempt' });
  }
};

// ============================================================================
// GET /api/progress/projection - Score Projection with College Board Weights
// ============================================================================
export const getScoreProjection = async (req: Request, res: Response) => {
  try {
    const user = (req as ExpressRequest).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { data: masteryRows, error: masteryError } = await supabaseServer
      .from('student_skill_mastery')
      .select('section, domain, skill, mastery_score, attempts, updated_at')
      .eq('user_id', user.id);

    if (masteryError) {
      console.error('[Projection] Error fetching mastery:', masteryError.message);
      return res.status(500).json({ error: 'Failed to fetch mastery data' });
    }

    const domainMastery: Record<string, DomainMastery> = {};
    let totalQuestions = 0;

    for (const row of masteryRows || []) {
      const section = row.section?.toLowerCase() === 'math' ? 'math' : 'rw';
      const domain = row.domain || 'unknown';
      const key = `${section}:${domain}`;

      if (!domainMastery[key]) {
        domainMastery[key] = {
          domain,
          section: section as 'math' | 'rw',
          mastery_score: 0,
          attempts: 0,
          last_activity: null,
        };
      }

      domainMastery[key].mastery_score = Math.max(
        domainMastery[key].mastery_score,
        row.mastery_score || 0
      );
      domainMastery[key].attempts += row.attempts || 0;
      totalQuestions += row.attempts || 0;

      if (row.updated_at) {
        const rowDate = new Date(row.updated_at);
        const existingDate = domainMastery[key].last_activity 
          ? new Date(domainMastery[key].last_activity as string)
          : null;
        if (!existingDate || rowDate > existingDate) {
          domainMastery[key].last_activity = row.updated_at;
        }
      }
    }

    const masteryArray = Object.values(domainMastery);
    
    if (totalQuestions === 0) {
      return res.json({
        projection: {
          composite: 400,
          math: 200,
          rw: 200,
          range: { low: 400, high: 400 },
          confidence: 0,
          breakdown: { math: [], rw: [] },
        },
        totalQuestionsAttempted: 0,
        lastUpdated: new Date().toISOString(),
        baseline_reason: "No assessment/practice data yet. 400 is the minimum SAT score for showing up.",
        // TODO: implement assessment-based baseline scoring
      });
    }
    
    const projection: ScoreProjection = calculateScore(masteryArray, totalQuestions);

    res.json({
      projection,
      totalQuestionsAttempted: totalQuestions,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Projection] Error:', error);
    res.status(500).json({ error: 'Failed to calculate score projection' });
  }
};

// ============================================================================
// GET /api/progress/kpis - Weekly + Recency KPIs (IANA timezone-aware)
// ============================================================================
export const getRecencyKpis = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Fetch user timezone from profile
    const { data: profile } = await supabaseServer
      .from('student_study_profile')
      .select('timezone')
      .eq('user_id', user.id)
      .maybeSingle();
    
    const timezone = profile?.timezone || 'America/Chicago';
    
    // Compute week range: last 7 local days (today inclusive)
    const nowLocal = DateTime.now().setZone(timezone);
    const endLocal = nowLocal.endOf('day');
    const startLocal = endLocal.minus({ days: 6 }).startOf('day');
    
    // Convert to UTC ISO for DB queries
    const weekStartUtc = startLocal.toUTC().toISO();
    const weekEndUtc = endLocal.toUTC().toISO();

    // ---- WEEKLY KPIs ----
    // Count practice sessions in week range
    const { count: sessionCount, error: sessionsError } = await supabaseServer
      .from('practice_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('started_at', weekStartUtc)
      .lte('started_at', weekEndUtc);

    if (sessionsError) {
      console.error('[KPIs] Error fetching weekly sessions:', sessionsError.message);
    }

    // Count attempts in week range
    const { data: weekAttempts, error: weekAttemptsError } = await supabaseServer
      .from('student_question_attempts')
      .select('is_correct')
      .eq('user_id', user.id)
      .gte('attempted_at', weekStartUtc)
      .lte('attempted_at', weekEndUtc);

    if (weekAttemptsError) {
      console.error('[KPIs] Error fetching weekly attempts:', weekAttemptsError.message);
    }

    const weekQuestionsSolved = weekAttempts?.length || 0;
    const weekCorrect = weekAttempts?.filter(a => a.is_correct).length || 0;
    const weekAccuracy = weekQuestionsSolved > 0 
      ? Math.round((weekCorrect / weekQuestionsSolved) * 100)
      : 0;

    // ---- RECENCY KPIs (last 200 attempts) ----
    const { data: recencyAttempts, error: recencyError } = await supabaseServer
      .from('student_question_attempts')
      .select('is_correct, time_spent_ms, attempted_at')
      .eq('user_id', user.id)
      .order('attempted_at', { ascending: false })
      .limit(200);

    if (recencyError) {
      console.error('[KPIs] Error fetching recency attempts:', recencyError.message);
      return res.status(500).json({ error: 'Failed to fetch KPI data' });
    }

    let recency = {
      window: 200,
      totalAttempts: 0,
      accuracy: 0,
      avgSecondsPerQuestion: 0,
    };

    if (recencyAttempts && recencyAttempts.length > 0) {
      const correctCount = recencyAttempts.filter(a => a.is_correct).length;
      const totalTimeMs = recencyAttempts.reduce((sum, a) => sum + (a.time_spent_ms || 0), 0);
      
      recency = {
        window: 200,
        totalAttempts: recencyAttempts.length,
        accuracy: Math.round((correctCount / recencyAttempts.length) * 100),
        avgSecondsPerQuestion: Math.round(totalTimeMs / recencyAttempts.length / 1000 * 10) / 10,
      };
    }

    console.log('[KPIs] Weekly:', { 
      sessions: sessionCount, 
      questions: weekQuestionsSolved, 
      accuracy: weekAccuracy,
      range: `${startLocal.toISODate()} to ${endLocal.toISODate()}`
    });

    res.json({
      timezone,
      week: {
        practiceSessions: sessionCount || 0,
        questionsSolved: weekQuestionsSolved,
        accuracy: weekAccuracy,
      },
      recency,
    });
  } catch (error) {
    console.error('[KPIs] Error:', error);
    res.status(500).json({ error: 'Failed to calculate KPIs' });
  }
};
