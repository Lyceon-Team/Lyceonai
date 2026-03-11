<<<<<<< HEAD
import { Request, Response } from "express";
import { supabaseServer } from "../lib/supabase-server";
import { AuthenticatedRequest } from "../middleware/auth";
=======
import { Request, Response } from 'express';
import { supabaseServer } from '../lib/supabase-server';
import { StudentQuestion, StudentMcQuestion, StudentFrQuestion, QuestionOption } from '../../../../shared/schema';
import { type AuthenticatedRequest, requireRequestUser } from '../../../../server/middleware/supabase-auth';
import { getDerivedWeaknessSignals } from '../services/mastery-derived';
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57

const SAFE_QUESTION_SELECT = [
  "id",
  "canonical_id",
  "section",
  "section_code",
  "question_type",
  "stem",
  "options",
  "difficulty",
  "domain",
  "skill",
  "subskill",
  "skill_code",
  "tags",
  "competencies",
  "diagram_present",
].join(",");

function normalizeSectionFilter(section: string | undefined): string | null {
  if (!section) return null;
  const value = section.trim().toLowerCase();
  if (value === "math" || value === "m") return "math";
  if (value === "rw" || value === "reading-writing" || value === "reading" || value === "writing") return "rw";
  return null;
}

<<<<<<< HEAD
function toStudentSafeQuestion(row: any) {
=======
// ============================================================================
// SHARED MAPPER HELPER: Converts DB row to canonical StudentQuestion type
// ============================================================================
export function mapDbQuestionToStudentQuestion(q: any): StudentQuestion {
  const type = q.type ?? (q.options ? 'mc' : 'fr');

  const base = {
    id: q.id,
    stem: q.stem,
    section: q.section,
    explanation: null,
    source: {
      mapping: q.source_mapping ?? q.sourceMapping ?? null,
      page: q.page_number ?? q.pageNumber ?? null,
    },
    tags: Array.isArray(q.tags)
      ? q.tags
      : typeof q.tags === 'string'
        ? q.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
        : [],
    type,
  };

  if (type === 'fr') {
    return {
      ...base,
      type: 'fr',
    } as StudentFrQuestion;
  }

  let options: QuestionOption[] = [];

  if (Array.isArray(q.options)) {
    options = q.options as QuestionOption[];
  } else if (typeof q.options === 'string') {
    try {
      options = JSON.parse(q.options) as QuestionOption[];
    } catch {
      console.warn('[QUESTIONS] Failed to parse options JSON for question', q.id);
      options = [];
    }
  }
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  return {
    id: row.id,
    canonical_id: row.canonical_id,
    section: row.section,
    section_code: row.section_code,
    question_type: "multiple_choice" as const,
    stem: row.stem,
    options: Array.isArray(row.options) ? row.options : [],
    difficulty: row.difficulty,
    domain: row.domain,
    skill: row.skill,
    subskill: row.subskill,
    skill_code: row.skill_code,
    tags: row.tags ?? null,
    competencies: row.competencies ?? null,
    diagram_present: row.diagram_present ?? null,
    explanation: null,
  };
}

function parseDifficulty(value: string | undefined): 1 | 2 | 3 | null {
  if (!value) return null;
  const numeric = Number(value);
  if (numeric === 1 || numeric === 2 || numeric === 3) return numeric;
  return null;
}

async function fetchQuestionRows(params: {
  limit: number;
  offset?: number;
  section?: string | null;
  difficulty?: 1 | 2 | 3 | null;
}) {
  let query = supabaseServer
    .from("questions")
    .select(SAFE_QUESTION_SELECT)
    .eq("question_type", "multiple_choice")
    .order("created_at", { ascending: false })
    .limit(params.limit);

  if (typeof params.offset === "number") {
    query = query.range(params.offset, params.offset + params.limit - 1);
  }

  if (params.section === "math") {
    query = query.eq("section_code", "MATH");
  } else if (params.section === "rw") {
    query = query.eq("section_code", "RW");
  }

  if (params.difficulty) {
    query = query.eq("difficulty", params.difficulty);
  }

  return query;
}

export const getQuestions = async (req: Request, res: Response) => {
  const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  if (isTestEnv) return res.json([]);

  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
    const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
    const section = normalizeSectionFilter(req.query.section as string | undefined);
    const difficulty = parseDifficulty(req.query.difficulty as string | undefined);

    const { data, error } = await fetchQuestionRows({ limit, offset, section, difficulty });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions", detail: error.message });
    }

<<<<<<< HEAD
    return res.json((data ?? []).map(toStudentSafeQuestion));
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
=======
    const formatted: StudentQuestion[] = (data ?? []).map(mapDbQuestionToStudentQuestion);

    if (DEBUG_QUESTIONS) {
      console.log('[DEBUG_QUESTIONS] GET /api/questions returned', formatted.length, 'questions');
    }

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching questions:', error);

    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

    res.status(500).json({
      error: 'Failed to fetch questions',
      detail: message,
    });
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  }
};

export const getRecentQuestions = async (req: Request, res: Response) => {
  const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  if (isTestEnv) return res.json([]);

  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "10"), 10) || 10, 50);
    const section = normalizeSectionFilter(req.query.section as string | undefined);

    const { data, error } = await fetchQuestionRows({ limit, section });
    if (error) return res.status(500).json({ error: "Failed to fetch recent questions", detail: error.message });

<<<<<<< HEAD
    return res.json((data ?? []).map(toStudentSafeQuestion));
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch recent questions", detail: error?.message ?? "Unknown error" });
=======
    if (section && ['Math', 'Reading', 'Writing'].includes(section)) {
      query = query.eq('section', section);
    }

    const { data, error } = await query;

    if (error) {
      if (!isTestEnv) {
        console.error('Error fetching recent questions (Supabase HTTP):', error);
      }

      // In test mode, return empty array instead of error
      if (isTestEnv) {
        return res.json([]);
      }

      return res.status(500).json({
        error: 'Failed to fetch questions',
        detail: error.message,
      });
    }

    const formatted: StudentQuestion[] = (data ?? []).map(mapDbQuestionToStudentQuestion);
    res.json(formatted);
  } catch (error) {
    const isTestEnv = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
    if (!isTestEnv) {
      console.error('Error fetching questions:', error);
    }

    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

    // In test mode, return empty array instead of error
    if (isTestEnv) {
      return res.json([]);
    }

    res.status(500).json({
      error: 'Failed to fetch questions',
      detail: message,
    });
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  }
};

export const getRandomQuestions = async (req: AuthenticatedRequest, res: Response) => {
  const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  if (isTestEnv) return res.json([]);

  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "10"), 10) || 10, 50);
    const section = normalizeSectionFilter(req.query.section as string | undefined);
    const difficulty = parseDifficulty(req.query.difficulty as string | undefined);

<<<<<<< HEAD
    const { data, error } = await fetchQuestionRows({ limit: Math.max(limit * 3, 30), section, difficulty });
    if (error) return res.status(500).json({ error: "Failed to fetch random questions", detail: error.message });

    const rows = data ?? [];
    const shuffled = rows.slice().sort(() => Math.random() - 0.5).slice(0, limit);
    return res.json(shuffled.map(toStudentSafeQuestion));
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch random questions", detail: error?.message ?? "Unknown error" });
  }
};

export const getQuestionCount = async (_req: Request, res: Response) => {
=======
    // ========================================================================
    // ADAPTIVE MODE: focus=weak biases toward user's weak competencies
    // ========================================================================
    if (focus === 'weak' && userId) {
      try {
        // Canonical weakness source: student_skill_mastery-derived signals.
        const weakSignals = await getDerivedWeaknessSignals(userId, {
          minAttempts: 3,
          limit: 30,
        });

        const weakKeys = Array.from(
          new Set(
            weakSignals
              .filter((s) => s.masteryScore100 < 70)
              .flatMap((s) => s.aliases)
          )
        );

        if (weakKeys.length > 0) {
          // Query questions that match weak competencies via tags overlap
          let adaptiveQuery = supabaseServer
            .from('questions')
            .select(`
              id,
              stem,
              options,
              section,
              source_mapping,
              page_number,
              tags,
              type
            `)
            .limit(limit * 3);

          // Apply section/type filters
          if (section && ['Math', 'Reading', 'Writing'].includes(section)) {
            adaptiveQuery = adaptiveQuery.eq('section', section);
          }
          if (type && ['mc', 'fr'].includes(type)) {
            adaptiveQuery = adaptiveQuery.eq('type', type);
          }

          // Filter by weak competencies via tags overlap
          // Use .overlaps for array containment check, fallback to .contains
          try {
            adaptiveQuery = adaptiveQuery.overlaps('tags', weakKeys);
          } catch {
            // Fallback: filter by first weak key if overlaps not available
            adaptiveQuery = adaptiveQuery.contains('tags', [weakKeys[0]]);
          }

          const { data: adaptiveData, error: adaptiveError } = await adaptiveQuery;

          if (!adaptiveError && adaptiveData && adaptiveData.length > 0) {
            // Shuffle candidates and take up to limit
            const shuffled = fisherYatesShuffle(adaptiveData);
            const selected = shuffled.slice(0, limit);
            const formatted: StudentQuestion[] = selected.map(mapDbQuestionToStudentQuestion);
            return res.json(formatted);
          }
        }
        // If adaptive query fails or returns nothing, fall through to random
      } catch (adaptiveErr) {
        console.warn('[ADAPTIVE] Error in weak-focus query, falling back to random:', adaptiveErr);
        // Fall through to existing random logic
      }
    }

    // ========================================================================
    // STANDARD RANDOM MODE (fallback)
    // ========================================================================

    // First, get the count for random offset calculation
    let countQuery = supabaseServer
      .from('questions')
      .select('id', { count: 'exact', head: true });

    if (section && ['Math', 'Reading', 'Writing'].includes(section)) {
      countQuery = countQuery.eq('section', section);
    }

    if (type && ['mc', 'fr'].includes(type)) {
      countQuery = countQuery.eq('type', type);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error('Error counting questions (Supabase HTTP):', countError);
      return res.status(500).json({
        error: 'Failed to fetch questions',
        detail: countError.message,
      });
    }

    const totalCount = count ?? 0;

    // If we need fewer questions than available, use random offset
    // Otherwise just get all available
    const maxOffset = Math.max(0, totalCount - limit);
    const randomOffset = maxOffset > 0 ? Math.floor(Math.random() * maxOffset) : 0;

    let query = supabaseServer
      .from('questions')
      .select(`
        id,
        stem,
        options,
        section,
        source_mapping,
        page_number,
        tags,
        type
      `)
      .range(randomOffset, randomOffset + limit - 1);

    if (section && ['Math', 'Reading', 'Writing'].includes(section)) {
      query = query.eq('section', section);
    }

    if (type && ['mc', 'fr'].includes(type)) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching random questions (Supabase HTTP):', error);
      return res.status(500).json({
        error: 'Failed to fetch questions',
        detail: error.message,
      });
    }

    // Shuffle the results for better randomness
    const shuffled = (data ?? []).sort(() => Math.random() - 0.5);

    const formatted: StudentQuestion[] = shuffled.map(mapDbQuestionToStudentQuestion);
    res.json(formatted);
  } catch (error) {
    console.error('Error fetching questions:', error);

    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

    res.status(500).json({
      error: 'Failed to fetch questions',
      detail: message,
    });
  }
};
// GET /api/questions/count - Quick question count for visibility verification
export const getQuestionCount = async (req: Request, res: Response) => {
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  try {
    const { count, error } = await supabaseServer
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("question_type", "multiple_choice");

    if (error) return res.status(500).json({ error: "Failed to count questions", detail: error.message });
    return res.json({ count: Number(count ?? 0) });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to count questions", detail: error?.message ?? "Unknown error" });
  }
};

export const getQuestionStats = async (_req: Request, res: Response) => {
  try {
<<<<<<< HEAD
    const [{ count: total }, { count: math }, { count: rw }] = await Promise.all([
      supabaseServer.from("questions").select("id", { count: "exact", head: true }).eq("question_type", "multiple_choice"),
      supabaseServer
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("question_type", "multiple_choice")
        .eq("section_code", "MATH"),
      supabaseServer
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("question_type", "multiple_choice")
        .eq("section_code", "RW"),
    ]);

    return res.json({ total: Number(total ?? 0), bySection: { MATH: Number(math ?? 0), RW: Number(rw ?? 0) } });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch question stats", detail: error?.message ?? "Unknown error" });
=======
    // Get total count
    const { count: totalCount, error: totalError } = await supabaseServer
      .from('questions')
      .select('id', { count: 'exact', head: true });

    if (totalError) {
      throw new Error(totalError.message);
    }

    // Get counts by section using separate queries
    const [mathResult, rwResult] = await Promise.all([
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).eq('section', 'Math'),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).eq('section', 'RW'),
    ]);

    // Get counts by difficulty
    const [easyResult, mediumResult, hardResult] = await Promise.all([
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).ilike('difficulty', 'easy'),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).ilike('difficulty', 'medium'),
      supabaseServer.from('questions').select('id', { count: 'exact', head: true }).ilike('difficulty', 'hard'),
    ]);

    // Get recently added count (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { count: recentCount, error: recentError } = await supabaseServer
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo.toISOString());

    const stats = {
      total: Number(totalCount ?? 0),
      math: Number(mathResult.count ?? 0),
      reading_writing: Number(rwResult.count ?? 0),
      byDifficulty: {
        easy: Number(easyResult.count ?? 0),
        medium: Number(mediumResult.count ?? 0),
        hard: Number(hardResult.count ?? 0),
      },
      recentlyAdded: Number(recentCount ?? 0),
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching question stats:', error);

    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

    res.status(500).json({
      error: 'Failed to fetch questions',
      detail: message,
    });
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  }
};

export const getQuestionsFeed = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
    const section = normalizeSectionFilter(req.query.section as string | undefined);
    const difficulty = parseDifficulty(req.query.difficulty as string | undefined);

    const { data, error } = await fetchQuestionRows({ limit, section, difficulty });
    if (error) return res.status(500).json({ error: "Failed to fetch questions feed", detail: error.message });

<<<<<<< HEAD
    return res.json({ questions: (data ?? []).map(toStudentSafeQuestion), total: (data ?? []).length });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions feed", detail: error?.message ?? "Unknown error" });
=======
    if (section && ['Math', 'RW'].includes(section)) {
      query = query.eq('section', section);
    }

    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching questions feed (Supabase HTTP):', error);
      return res.status(500).json({
        error: 'Failed to fetch questions',
        detail: error.message,
      });
    }

    const results = data ?? [];
    const hasMore = results.length > limit;
    const questionsToReturn = hasMore ? results.slice(0, -1) : results;
    const nextCursor = hasMore ? results[results.length - 2]?.created_at : null;

    // NOTE: Do NOT shuffle here - pagination cursor depends on stable ordering
    // Frontend handles answer option shuffling via seeded Fisher-Yates in QuestionRenderer
    const formatted: StudentQuestion[] = questionsToReturn.map(mapDbQuestionToStudentQuestion);
    res.json({
      questions: formatted,
      nextCursor,
      hasMore
    });
  } catch (error) {
    console.error('Error fetching questions:', error);

    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

    res.status(500).json({
      error: 'Failed to fetch questions',
      detail: message,
    });
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  }
};

export const validateAnswer = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser || req.user;
    const userId = authUser?.id;
    const isAdmin = !!authUser?.isAdmin;
    const role = authUser?.role || (isAdmin ? "admin" : "student");

    if (role === "guardian") {
      return res.status(403).json({ error: "Guardians are not permitted to validate answers." });
    }

    const { questionId, studentAnswer } = req.body;
    if (!questionId || studentAnswer === undefined || studentAnswer === null) {
      return res.status(400).json({ error: "Missing required fields: questionId and studentAnswer" });
    }

    const { data: question, error } = await supabaseServer
      .from("questions")
      .select("id, question_type, correct_answer, explanation")
      .eq("id", questionId)
      .single();

    if (error || !question) {
      return res.status(404).json({ error: "Question not found" });
    }

    if (question.question_type !== "multiple_choice") {
      return res.status(400).json({ error: "Invalid question type" });
    }

    const normalizedStudent = String(studentAnswer).trim().toUpperCase();
    const normalizedCorrect = String(question.correct_answer).trim().toUpperCase();
    const isCorrect = normalizedStudent === normalizedCorrect;

    let canSeeAnswer = false;
    if (isAdmin) {
      canSeeAnswer = true;
    } else if (userId) {
      const { data: attempt } = await supabaseServer
        .from("answer_attempts")
        .select("id")
        .eq("user_id", userId)
        .eq("question_id", questionId)
        .limit(1)
        .single();
      canSeeAnswer = !!attempt;
    }

    return res.json({
      questionId,
      question_type: "multiple_choice",
      isCorrect,
      correctAnswerKey: canSeeAnswer ? normalizedCorrect : null,
      feedback: isCorrect ? "Correct!" : "Incorrect.",
      explanation: canSeeAnswer ? (question.explanation ?? null) : null,
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to validate answer", detail: error?.message ?? "Unknown error" });
  }
};

export const getQuestionById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "Question ID is required" });

    const { data, error } = await supabaseServer.from("questions").select(SAFE_QUESTION_SELECT).eq("id", id).single();

    if (error || !data) return res.status(404).json({ error: "Question not found" });

    return res.json(toStudentSafeQuestion(data));
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch question", detail: error?.message ?? "Unknown error" });
  }
};

<<<<<<< HEAD
export const getReviewErrors = async (req: Request & { user?: { id: string } }, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
=======
// GET /api/review-errors - Get user's failed question attempts from most recent session
export const getReviewErrors = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
    }

    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);

    const { data, error } = await supabaseServer
      .from("answer_attempts")
      .select("id, question_id, is_correct, attempted_at, questions(id, canonical_id, section, section_code, question_type, stem, options, difficulty, domain, skill, subskill, skill_code, tags, competencies, diagram_present)")
      .eq("user_id", userId)
      .eq("is_correct", false)
      .order("attempted_at", { ascending: false })
      .limit(limit);

    if (error) {
      return res.status(500).json({ error: "Failed to fetch failed attempts", detail: error.message });
    }

    const mapped = (data ?? []).map((attempt: any) => ({
      id: attempt.id,
      attempted_at: attempt.attempted_at,
      question: attempt.questions ? toStudentSafeQuestion(attempt.questions) : null,
    }));

<<<<<<< HEAD
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch failed attempts", detail: error?.message ?? "Unknown error" });
=======
    // Step 2: Get all attempts from this session
    const { data: allAttempts, error: attemptsError } = await supabaseServer
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
      console.error('Error fetching attempts:', attemptsError);
      return res.status(500).json({
        error: 'Failed to fetch attempts',
        detail: attemptsError.message,
      });
    }

    const attempts = allAttempts ?? [];

    // Calculate summary counts
    const correctCount = attempts.filter(a => a.outcome === 'correct' || (a.is_correct && !a.outcome)).length;
    const skippedCount = attempts.filter(a => a.outcome === 'skipped').length;
    const incorrectCount = attempts.filter(a => a.outcome === 'incorrect' || (!a.is_correct && a.outcome !== 'skipped')).length;

    // Filter to incorrect attempts (exclude skipped)
    const incorrectRaw = attempts.filter(a =>
      a.outcome === 'incorrect' || (!a.is_correct && a.outcome !== 'skipped')
    );

    // Filter to skipped attempts only
    const skippedRaw = attempts.filter(a => a.outcome === 'skipped');

    // Helper to format attempt for frontend
    const formatAttempt = (attempt: typeof attempts[0]) => {
      const question = attempt.questions as unknown as { id: string; stem: string; section: string; difficulty: string } | null;
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

    // Format both lists
    const incorrectAttempts = incorrectRaw.map(formatAttempt);
    const skippedAttempts = skippedRaw.map(formatAttempt);

    // Build reviewQueue from prior practice misses/skips (origin context only; not review outcome taxonomy)
    // Ordered by attempted_at desc (already sorted from DB query)
    const reviewQueue = [...incorrectRaw, ...skippedRaw]
      .sort((a, b) => new Date(b.attempted_at).getTime() - new Date(a.attempted_at).getTime())
      .map(attempt => ({
        questionId: attempt.question_id,
        originOutcome: attempt.outcome || (attempt.is_correct ? 'correct' : 'incorrect'),
        // Backward-compatible alias for existing client reads.
        outcome: attempt.outcome || (attempt.is_correct ? 'correct' : 'incorrect'),
        attemptId: attempt.id,
      }));

    res.json({
      attempts: incorrectAttempts,
      incorrectAttempts,
      skippedAttempts,
      reviewQueue,
      summary: {
        sessionId: recentSession.id,
        sessionStartedAt: recentSession.started_at,
        sessionMode: recentSession.mode,
        sessionSection: recentSession.section,
        correctCount,
        incorrectCount,
        skippedCount,
        totalCount: attempts.length,
      },
    });
  } catch (error) {
    console.error('Error fetching review errors:', error);

    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

    res.status(500).json({
      error: 'Failed to fetch failed attempts',
      detail: message,
    });
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  }
};

export const getQuestionsByTopic = async (req: Request, res: Response) => {
  try {
    const skillCode = req.query.skillCode as string;
    if (!skillCode) {
      return res.status(400).json({ error: "skillCode query parameter is required" });
    }

    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
    const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

    const { data, error } = await supabaseServer
      .from("questions")
      .select(SAFE_QUESTION_SELECT)
      .eq("question_type", "multiple_choice")
      .eq("skill_code", skillCode)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions", detail: error.message });
    }

    return res.json({ questions: (data ?? []).map(toStudentSafeQuestion), total: (data ?? []).length, skillCode });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
  }
};

export const getQuestionsByDifficulty = async (req: Request, res: Response) => {
  try {
    const difficulty = parseDifficulty(req.query.difficulty as string | undefined);
    if (!difficulty) {
      return res.status(400).json({ error: "difficulty must be one of: 1, 2, 3" });
    }

    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
    const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

    const { data, error } = await supabaseServer
      .from("questions")
      .select(SAFE_QUESTION_SELECT)
      .eq("question_type", "multiple_choice")
      .eq("difficulty", difficulty)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions", detail: error.message });
    }

    return res.json({ questions: (data ?? []).map(toStudentSafeQuestion), total: (data ?? []).length, difficulty });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
  }
};

export const submitQuestionFeedback = async (req: AuthenticatedRequest, res: Response) => {
  try {
<<<<<<< HEAD
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

=======
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const userId = user.id;

>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
    const { questionId, sentiment, comment } = req.body;

    if (!questionId) {
      return res.status(400).json({ error: "questionId is required" });
    }

<<<<<<< HEAD
    if (!sentiment || !["up", "down"].includes(sentiment)) {
      return res.status(400).json({ error: "sentiment must be 'up' or 'down'" });
    }

    const { error } = await supabaseServer.from("question_feedback").insert({
      user_id: userId,
      question_id: questionId,
      sentiment,
      comment: typeof comment === "string" ? comment : null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      return res.status(500).json({ error: "Failed to submit feedback", detail: error.message });
    }

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to submit feedback", detail: error?.message ?? "Unknown error" });
=======
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
      .upsert({
        question_id: questionId,
        user_id: userId,
        sentiment,
        comment: comment || null,
        created_at: new Date().toISOString(),
      }, {
        onConflict: 'question_id,user_id',
      });

    if (insertError) {
      console.error('[FEEDBACK] Insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save feedback' });
    }

    res.json({ success: true, message: 'Feedback submitted' });
  } catch (error) {
    console.error('[FEEDBACK] Error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  }
};
