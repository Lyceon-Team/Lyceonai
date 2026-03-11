<<<<<<< HEAD
import { Request, Response } from "express";
import { supabaseServer } from "../lib/supabase-server";
import { AuthenticatedRequest } from "../middleware/auth";
=======
import { Request, Response } from 'express';
import { supabaseServer } from '../lib/supabase-server';
<<<<<<< HEAD
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
=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
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
<<<<<<< HEAD

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
=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  }
  if (normalized === 'rw' || normalized === 'reading_writing' || normalized === 'reading-writing') {
    return (query as any).eq('section_code', 'RW');
  }
  return query;
}

<<<<<<< HEAD
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

=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
export const getRecentQuestions = async (req: Request, res: Response) => {
  const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  if (isTestEnv) return res.json([]);

  try {
<<<<<<< HEAD
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
=======
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 20);
    const section = req.query.section as string | undefined;

    let query: any = supabaseServer
      .from('questions')
      .select(SAFE_QUESTION_SELECT)
      .eq('question_type', 'multiple_choice')
      .order('created_at', { ascending: false })
      .limit(limit);

    query = applySectionFilter(query, section);
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch questions', detail: error.message });
    }

    return res.json((data ?? []).map(mapDbQuestionToStudentQuestion));
  } catch (error) {
<<<<<<< HEAD
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
=======
    return res.status(500).json({ error: 'Failed to fetch questions', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// GET /api/questions/random
export const getRandomQuestions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const section = req.query.section as string | undefined;

    let countQuery: any = supabaseServer
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
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
<<<<<<< HEAD
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
=======

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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
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
<<<<<<< HEAD
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
=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
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
<<<<<<< HEAD
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
=======
    return res.status(500).json({ error: 'Failed to fetch questions', detail: error instanceof Error ? error.message : 'Unknown error' });
  }
};

// POST /api/questions/validate
export const validateAnswer = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser || (req as any).user;
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
    const userId = authUser?.id;
    const isAdmin = !!authUser?.isAdmin;
    const role = authUser?.role || (isAdmin ? "admin" : "student");

<<<<<<< HEAD
    if (role === "guardian") {
      return res.status(403).json({ error: "Guardians are not permitted to validate answers." });
=======
    if (isGuardian) {
      return res.status(403).json({ error: 'Guardians are not permitted to validate answers.' });
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
    }

    const { questionId, studentAnswer } = req.body;
    if (!questionId || studentAnswer === undefined || studentAnswer === null) {
      return res.status(400).json({ error: "Missing required fields: questionId and studentAnswer" });
    }

    const { data: question, error } = await supabaseServer
<<<<<<< HEAD
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
=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
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
<<<<<<< HEAD
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
=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
    }

    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
    const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

    const { data, error } = await supabaseServer
<<<<<<< HEAD
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
=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
    }

    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
    const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

    const { data, error } = await supabaseServer
<<<<<<< HEAD
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
=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  }
};

export const submitQuestionFeedback = async (req: Request, res: Response) => {
  try {
<<<<<<< HEAD
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
=======
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

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

<<<<<<< HEAD
    res.json({ success: true, message: 'Feedback submitted' });
  } catch (error) {
    console.error('[FEEDBACK] Error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
=======
    return res.json({ success: true, message: 'Feedback submitted' });
  } catch (_error) {
    return res.status(500).json({ error: 'Failed to submit feedback' });
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  }
};

export { mapDbQuestionToStudentQuestion };
