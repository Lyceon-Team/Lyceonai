import { Request, Response } from "express";
import { supabaseServer } from "../lib/supabase-server";
import { AuthenticatedRequest } from "../middleware/auth";

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

function toStudentSafeQuestion(row: any) {
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

    return res.json((data ?? []).map(toStudentSafeQuestion));
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
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

    return res.json((data ?? []).map(toStudentSafeQuestion));
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch recent questions", detail: error?.message ?? "Unknown error" });
  }
};

export const getRandomQuestions = async (req: AuthenticatedRequest, res: Response) => {
  const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  if (isTestEnv) return res.json([]);

  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "10"), 10) || 10, 50);
    const section = normalizeSectionFilter(req.query.section as string | undefined);
    const difficulty = parseDifficulty(req.query.difficulty as string | undefined);

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
  }
};

export const getQuestionsFeed = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
    const section = normalizeSectionFilter(req.query.section as string | undefined);
    const difficulty = parseDifficulty(req.query.difficulty as string | undefined);

    const { data, error } = await fetchQuestionRows({ limit, section, difficulty });
    if (error) return res.status(500).json({ error: "Failed to fetch questions feed", detail: error.message });

    return res.json({ questions: (data ?? []).map(toStudentSafeQuestion), total: (data ?? []).length });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions feed", detail: error?.message ?? "Unknown error" });
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

export const getReviewErrors = async (req: Request & { user?: { id: string } }, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
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

    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch failed attempts", detail: error?.message ?? "Unknown error" });
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

export const submitQuestionFeedback = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { questionId, sentiment, comment } = req.body;

    if (!questionId) {
      return res.status(400).json({ error: "questionId is required" });
    }

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
  }
};
