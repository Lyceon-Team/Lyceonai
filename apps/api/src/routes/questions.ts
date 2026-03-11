import { Request, Response } from 'express';
import { supabaseServer } from '../lib/supabase-server';
import { StudentQuestion, QuestionOption } from '../../../../shared/schema';
import { AuthenticatedRequest } from '../middleware/auth';

function parseOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const key = (item as any).key;
      const text = (item as any).text;
      if (!['A', 'B', 'C', 'D'].includes(key) || typeof text !== 'string' || !text.trim()) {
        return null;
      }
      return { key, text: text.trim() } as QuestionOption;
    })
    .filter((item): item is QuestionOption => !!item);

  return valid.length === 4 ? valid : [];
}

function mapDbQuestionToStudentQuestion(q: any): StudentQuestion {
  return {
    id: q.id,
    canonicalId: q.canonical_id ?? null,
    stem: q.stem,
    section: q.section,
    sectionCode: q.section_code ?? null,
    questionType: 'multiple_choice',
    options: parseOptions(q.options) as [QuestionOption, QuestionOption, QuestionOption, QuestionOption],
    explanation: null,
    tags: Array.isArray(q.tags) ? q.tags : [],
    domain: q.domain ?? null,
    skill: q.skill ?? null,
    subskill: q.subskill ?? null,
    skillCode: q.skill_code ?? null,
    difficulty: q.difficulty ?? null,
    competencies: Array.isArray(q.competencies) ? q.competencies : [],
  };
}

const SAFE_QUESTION_SELECT = [
  'id',
  'canonical_id',
  'stem',
  'section',
  'section_code',
  'question_type',
  'options',
  'domain',
  'skill',
  'subskill',
  'skill_code',
  'difficulty',
  'tags',
  'competencies',
  'created_at',
].join(',');

function applySectionFilter<T>(query: T, section?: string): T {
  if (!section) return query;
  const normalized = section.trim().toLowerCase();
  if (normalized === 'math' || normalized === 'm') {
    return (query as any).eq('section_code', 'MATH');
  }
  if (normalized === 'rw' || normalized === 'reading_writing' || normalized === 'reading-writing') {
    return (query as any).eq('section_code', 'RW');
  }
  return query;
}

// GET /api/questions
export const getQuestions = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const section = req.query.section as string | undefined;

    let query: any = supabaseServer
      .from('questions')
      .select(SAFE_QUESTION_SELECT)
      .eq('question_type', 'multiple_choice')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    query = applySectionFilter(query, section);

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch questions', detail: error.message });
    }

    return res.json((data ?? []).map(mapDbQuestionToStudentQuestion));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch questions', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// GET /api/questions/recent
export const getRecentQuestions = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 20);
    const section = req.query.section as string | undefined;

    let query: any = supabaseServer
      .from('questions')
      .select(SAFE_QUESTION_SELECT)
      .eq('question_type', 'multiple_choice')
      .order('created_at', { ascending: false })
      .limit(limit);

    query = applySectionFilter(query, section);

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch questions', detail: error.message });
    }

    return res.json((data ?? []).map(mapDbQuestionToStudentQuestion));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch questions', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// GET /api/questions/random
export const getRandomQuestions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const section = req.query.section as string | undefined;

    let countQuery: any = supabaseServer
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('question_type', 'multiple_choice');

    countQuery = applySectionFilter(countQuery, section);
    const { count, error: countError } = await countQuery;

    if (countError) {
      return res.status(500).json({ error: 'Failed to fetch questions', detail: countError.message });
    }

    const totalCount = count ?? 0;
    const maxOffset = Math.max(0, totalCount - limit);
    const randomOffset = maxOffset > 0 ? Math.floor(Math.random() * maxOffset) : 0;

    let query: any = supabaseServer
      .from('questions')
      .select(SAFE_QUESTION_SELECT)
      .eq('question_type', 'multiple_choice')
      .range(randomOffset, randomOffset + limit - 1);

    query = applySectionFilter(query, section);

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch questions', detail: error.message });
    }

    const shuffled = (data ?? []).sort(() => Math.random() - 0.5);
    return res.json(shuffled.map(mapDbQuestionToStudentQuestion));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch questions', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// GET /api/questions/count
export const getQuestionCount = async (_req: Request, res: Response) => {
  try {
    const { count, error } = await supabaseServer
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('question_type', 'multiple_choice');

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch questions', detail: error.message });
    }

    return res.json({ count: count ?? 0 });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch questions', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// GET /api/questions/stats
export const getQuestionStats = async (_req: Request, res: Response) => {
  try {
    const [total, math, rw, easy, medium, hard] = await Promise.all([
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).eq('question_type', 'multiple_choice'),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).eq('section_code', 'MATH').eq('question_type', 'multiple_choice'),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).eq('section_code', 'RW').eq('question_type', 'multiple_choice'),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).ilike('difficulty', 'easy').eq('question_type', 'multiple_choice'),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).ilike('difficulty', 'medium').eq('question_type', 'multiple_choice'),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).ilike('difficulty', 'hard').eq('question_type', 'multiple_choice'),
    ]);

    return res.json({
      total: Number(total.count ?? 0),
      math: Number(math.count ?? 0),
      readingWriting: Number(rw.count ?? 0),
      byDifficulty: {
        easy: Number(easy.count ?? 0),
        medium: Number(medium.count ?? 0),
        hard: Number(hard.count ?? 0),
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch questions', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// GET /api/questions/feed
export const getQuestionsFeed = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const section = req.query.section as string | undefined;
    const difficulty = req.query.difficulty as string | undefined;
    const cursor = req.query.cursor as string | undefined;

    let query: any = supabaseServer
      .from('questions')
      .select(SAFE_QUESTION_SELECT)
      .eq('question_type', 'multiple_choice')
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    query = applySectionFilter(query, section);

    if (difficulty) {
      query = query.ilike('difficulty', difficulty);
    }

    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch questions', detail: error.message });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, -1) : rows;
    const nextCursor = hasMore ? rows[rows.length - 2]?.created_at ?? null : null;

    return res.json({
      questions: items.map(mapDbQuestionToStudentQuestion),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch questions', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// POST /api/questions/validate
export const validateAnswer = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser || (req as any).user;
    const userId = authUser?.id;
    const isAdmin = !!authUser?.isAdmin;
    const role = authUser?.role || (isAdmin ? 'admin' : 'student');
    const isGuardian = authUser?.isGuardian || role === 'guardian';

    if (isGuardian) {
      return res.status(403).json({ error: 'Guardians are not permitted to validate answers.' });
    }

    const { questionId, studentAnswer } = req.body;
    if (!questionId || studentAnswer === undefined || studentAnswer === null) {
      return res.status(400).json({ error: 'Missing required fields: questionId and studentAnswer' });
    }

    const { data: question, error } = await supabaseServer
      .from('questions')
      .select('id, question_type, correct_answer, answer_text, explanation')
      .eq('id', questionId)
      .eq('question_type', 'multiple_choice')
      .single();

    if (error || !question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const normalizedStudent = String(studentAnswer).trim().toUpperCase();
    const normalizedCorrect = String(question.correct_answer || '').trim().toUpperCase();
    const isCorrect = normalizedStudent === normalizedCorrect;

    let canSeeAnswer = isAdmin;
    let canSeeExplanation = isAdmin;

    if (!isAdmin && userId) {
      const { data: attempt } = await supabaseServer
        .from('answer_attempts')
        .select('id')
        .eq('user_id', userId)
        .eq('question_id', questionId)
        .limit(1)
        .maybeSingle();

      if (attempt) {
        canSeeAnswer = true;
        canSeeExplanation = true;
      }
    }

    return res.json({
      questionId,
      mode: 'multiple_choice',
      isCorrect,
      correctAnswerKey: canSeeAnswer ? normalizedCorrect : null,
      answerText: canSeeAnswer ? (question.answer_text ?? null) : null,
      feedback: isCorrect ? 'Correct!' : 'Incorrect.',
      explanation: canSeeExplanation ? (question.explanation ?? null) : null,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to validate answer', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// GET /api/questions/:id
export const getQuestionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Question ID is required' });

    const { data, error } = await supabaseServer
      .from('questions')
      .select(SAFE_QUESTION_SELECT)
      .eq('id', id)
      .eq('question_type', 'multiple_choice')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Question not found' });
    }

    return res.json(mapDbQuestionToStudentQuestion(data));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch question', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// GET /api/review-errors
export const getReviewErrors = async (req: Request & { user?: { id: string } }, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const { data: recentSession, error: sessionError } = await supabaseServer
      .from('practice_sessions')
      .select('id, started_at, mode, section')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionError) {
      return res.status(500).json({ error: 'Failed to fetch recent session', detail: sessionError.message });
    }

    if (!recentSession) {
      return res.json({
        attempts: [],
        incorrectAttempts: [],
        skippedAttempts: [],
        reviewQueue: [],
        summary: {
          sessionId: null,
          sessionStartedAt: null,
          correctCount: 0,
          incorrectCount: 0,
          skippedCount: 0,
          totalCount: 0,
        },
        message: 'No practice sessions found. Start practicing to see your mistakes here!',
      });
    }

    const { data: attempts, error: attemptsError } = await supabaseServer
      .from('answer_attempts')
      .select(`
        id,
        question_id,
        is_correct,
        outcome,
        attempted_at,
        questions (
          id,
          stem,
          section,
          difficulty
        )
      `)
      .eq('session_id', recentSession.id)
      .order('attempted_at', { ascending: false });

    if (attemptsError) {
      return res.status(500).json({ error: 'Failed to fetch attempts', detail: attemptsError.message });
    }

    const rows = attempts ?? [];
    const correctCount = rows.filter((a) => a.outcome === 'correct' || (a.is_correct && !a.outcome)).length;
    const skippedCount = rows.filter((a) => a.outcome === 'skipped').length;
    const incorrectCount = rows.filter((a) => a.outcome === 'incorrect' || (!a.is_correct && a.outcome !== 'skipped')).length;

    const incorrectRaw = rows.filter((a) => a.outcome === 'incorrect' || (!a.is_correct && a.outcome !== 'skipped'));
    const skippedRaw = rows.filter((a) => a.outcome === 'skipped');

    const formatAttempt = (attempt: any) => {
      const question = attempt.questions as { id: string; stem: string; section: string; difficulty: string } | null;
      return {
        id: attempt.id,
        questionId: attempt.question_id,
        questionText: question?.stem?.slice(0, 200) || 'Question text unavailable',
        section: question?.section || 'Unknown',
        difficulty: question?.difficulty || '',
        isCorrect: attempt.is_correct,
        outcome: attempt.outcome,
        attemptedAt: attempt.attempted_at,
        documentName: 'SAT Practice',
      };
    };

    const reviewQueue = [...incorrectRaw, ...skippedRaw]
      .sort((a, b) => new Date(b.attempted_at).getTime() - new Date(a.attempted_at).getTime())
      .map((attempt) => ({
        questionId: attempt.question_id,
        outcome: attempt.outcome || (attempt.is_correct ? 'correct' : 'incorrect'),
        attemptId: attempt.id,
      }));

    return res.json({
      attempts: incorrectRaw.map(formatAttempt),
      incorrectAttempts: incorrectRaw.map(formatAttempt),
      skippedAttempts: skippedRaw.map(formatAttempt),
      reviewQueue,
      summary: {
        sessionId: recentSession.id,
        sessionStartedAt: recentSession.started_at,
        sessionMode: recentSession.mode,
        sessionSection: recentSession.section,
        correctCount,
        incorrectCount,
        skippedCount,
        totalCount: rows.length,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch failed attempts', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// GET /api/questions/by-topic
export const getQuestionsByTopic = async (req: Request, res: Response) => {
  try {
    const skillCode = (req.query.skillCode as string | undefined) ?? (req.query.unitTag as string | undefined);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!skillCode) {
      return res.status(400).json({ error: 'skillCode query parameter is required' });
    }

    const { data, error } = await supabaseServer
      .from('questions')
      .select(SAFE_QUESTION_SELECT)
      .eq('question_type', 'multiple_choice')
      .eq('skill_code', skillCode)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch questions', detail: error.message });
    }

    const questions = (data ?? []).map(mapDbQuestionToStudentQuestion);
    return res.json({ questions, total: questions.length, skillCode });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch questions', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// GET /api/questions/by-difficulty
export const getQuestionsByDifficulty = async (req: Request, res: Response) => {
  try {
    const difficulty = (req.query.difficulty as string | undefined)?.trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!difficulty) {
      return res.status(400).json({ error: 'difficulty query parameter is required' });
    }

    const { data, error } = await supabaseServer
      .from('questions')
      .select(SAFE_QUESTION_SELECT)
      .eq('question_type', 'multiple_choice')
      .ilike('difficulty', difficulty)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch questions', detail: error.message });
    }

    const questions = (data ?? []).map(mapDbQuestionToStudentQuestion);
    return res.json({ questions, total: questions.length, difficulty });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch questions', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

export const submitQuestionFeedback = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { questionId, sentiment, comment } = req.body;

    if (!questionId) {
      return res.status(400).json({ error: 'questionId is required' });
    }

    if (!sentiment || !['up', 'down'].includes(sentiment)) {
      return res.status(400).json({ error: 'sentiment must be "up" or "down"' });
    }

    const { data: question, error: questionError } = await supabaseServer
      .from('questions')
      .select('id')
      .eq('id', questionId)
      .single();

    if (questionError || !question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const { error: insertError } = await supabaseServer
      .from('question_feedback')
      .upsert(
        {
          question_id: questionId,
          user_id: userId,
          sentiment,
          comment: comment || null,
          created_at: new Date().toISOString(),
        },
        {
          onConflict: 'question_id,user_id',
        }
      );

    if (insertError) {
      return res.status(500).json({ error: 'Failed to save feedback' });
    }

    return res.json({ success: true, message: 'Feedback submitted' });
  } catch (_error) {
    return res.status(500).json({ error: 'Failed to submit feedback' });
  }
};

export { mapDbQuestionToStudentQuestion };
