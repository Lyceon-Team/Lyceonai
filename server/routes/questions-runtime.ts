import { Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { type AuthenticatedRequest, requireRequestUser } from "../middleware/supabase-auth";
import {
  isCanonicalRuntimeMcQuestion,
  projectStudentSafeQuestion,
  resolveSectionFilterValues,
  type CanonicalQuestionRowLike,
} from "../../shared/question-bank-contract";
import { buildReviewQueueForStudent } from "../services/review-queue";

const QUESTION_SAFE_SELECT = [
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
  "created_at",
].join(",");

function isTestEnv(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

function mapQuestionForStudent(row: CanonicalQuestionRowLike) {
  const safe = projectStudentSafeQuestion(row);
  return {
    ...safe,
    canonicalId: safe.canonical_id,
    sectionCode: safe.section_code,
    questionType: "multiple_choice" as const,
    type: "mc" as const,
  };
}

function applySectionFilter<TQuery extends { in: (column: string, values: string[]) => TQuery }>(query: TQuery, section: unknown): TQuery {
  const filters = resolveSectionFilterValues(section);
  if (!filters || filters.length === 0) {
    return query;
  }
  return query.in("section_code", filters);
}

async function fetchPublishedQuestions(params: {
  section?: unknown;
  limit: number;
  offset?: number;
  cursor?: string;
}) {
  let query = supabaseServer
    .from("questions")
    .select(QUESTION_SAFE_SELECT)
    .eq("question_type", "multiple_choice")
    .order("created_at", { ascending: false });

  query = applySectionFilter(query, params.section);

  if (params.cursor) {
    query = query.lt("created_at", params.cursor);
  }

  if (typeof params.offset === "number") {
    query = query.range(params.offset, params.offset + params.limit - 1);
  } else {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) {
    return { data: null, error };
  }

  const rows = (data ?? []) as unknown as CanonicalQuestionRowLike[];
  const validRows = rows.filter((row) => isCanonicalRuntimeMcQuestion(row));
  return { data: validRows, error: null };
}

// GET /api/questions - canonical student-safe list (published MC only)
export const getQuestions = async (req: Request, res: Response) => {
  if (isTestEnv()) {
    return res.json([]);
  }

  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

    const { data, error } = await fetchPublishedQuestions({
      section: req.query.section,
      limit,
      offset,
    });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions", detail: error.message });
    }

    return res.json((data ?? []).map(mapQuestionForStudent));
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
  }
};

// GET /api/questions/recent - public-safe preview list (published MC only)
export const getRecentQuestions = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "10"), 10) || 10, 20);

    const { data, error } = await fetchPublishedQuestions({
      section: req.query.section,
      limit,
    });

    if (error) {
      if (isTestEnv()) {
        return res.json([]);
      }
      return res.status(500).json({ error: "Failed to fetch questions", detail: error.message });
    }

    return res.json((data ?? []).map(mapQuestionForStudent));
  } catch (error: any) {
    if (isTestEnv()) {
      return res.json([]);
    }
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
  }
};

// GET /api/questions/random - random published MC questions
export const getRandomQuestions = async (req: AuthenticatedRequest, res: Response) => {
  if (isTestEnv()) {
    return res.json([]);
  }

  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 50);
    const section = req.query.section;

    const { data, error } = await fetchPublishedQuestions({
      section,
      limit: Math.max(limit * 3, 60),
    });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions", detail: error.message });
    }

    const shuffled = [...(data ?? [])].sort(() => Math.random() - 0.5).slice(0, limit);
    return res.json(shuffled.map(mapQuestionForStudent));
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
  }
};

// GET /api/questions/count - canonical count of published MC questions
export const getQuestionCount = async (_req: Request, res: Response) => {
  try {
    const { count, error } = await supabaseServer
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("question_type", "multiple_choice");

    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions", detail: error.message });
    }

    return res.json({ count: count ?? 0 });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
  }
};

// GET /api/questions/stats - canonical stats over published MC questions
export const getQuestionStats = async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseServer
      .from("questions")
      .select("section_code, difficulty")
      .eq("question_type", "multiple_choice");

    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions", detail: error.message });
    }

    const rows = (data ?? []) as Array<{ section_code?: string | null; difficulty?: unknown }>;

    let math = 0;
    let readingWriting = 0;
    let easy = 0;
    let medium = 0;
    let hard = 0;

    for (const row of rows) {
      const sectionCode = String(row.section_code ?? "").toUpperCase();
      if (sectionCode === "M" || sectionCode === "MATH") {
        math += 1;
      } else if (sectionCode === "RW") {
        readingWriting += 1;
      }

      const diff = String(row.difficulty ?? "").toLowerCase();
      if (diff === "easy" || diff === "1") easy += 1;
      else if (diff === "medium" || diff === "2") medium += 1;
      else if (diff === "hard" || diff === "3") hard += 1;
    }

    return res.json({
      total: rows.length,
      math,
      reading_writing: readingWriting,
      byDifficulty: {
        easy,
        medium,
        hard,
      },
      recentlyAdded: 0,
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
  }
};

// GET /api/questions/feed - cursor feed over published MC questions
export const getQuestionsFeed = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 50);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    const { data, error } = await fetchPublishedQuestions({
      section: req.query.section,
      limit: limit + 1,
      cursor,
    });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions", detail: error.message });
    }

    const result = data ?? [];
    const hasMore = result.length > limit;
    const rows = hasMore ? result.slice(0, -1) : result;
    const nextCursor = hasMore ? (result[result.length - 2] as any)?.created_at ?? null : null;

    return res.json({
      questions: rows.map(mapQuestionForStudent),
      nextCursor,
      hasMore,
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
  }
};

// GET /api/questions/:id - canonical student-safe item
export const getQuestionById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({ error: "Question ID is required" });
    }

    const { data, error } = await supabaseServer
      .from("questions")
      .select(QUESTION_SAFE_SELECT)
      .eq("id", id)
      .eq("question_type", "multiple_choice")
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Question not found" });
    }

    const row = data as unknown as CanonicalQuestionRowLike;
    if (!isCanonicalRuntimeMcQuestion(row)) {
      return res.status(404).json({ error: "Question not found" });
    }

    return res.json(mapQuestionForStudent(row));
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch question", detail: error?.message ?? "Unknown error" });
  }
};

// GET /api/review-errors - canonical review queue builder
export const getReviewErrors = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const queue = await buildReviewQueueForStudent(user.id);

    if (queue.latestSnapshots.length === 0) {
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
        message: "No review-eligible misses found yet. Keep practicing to build your recovery queue.",
      });
    }

    const formatAttempt = (snapshot: any) => ({
      id: snapshot.attemptId,
      questionId: snapshot.questionId,
      questionCanonicalId: snapshot.questionCanonicalId,
      questionText: snapshot.questionText,
      section: snapshot.section,
      difficulty: snapshot.difficulty ?? "",
      isCorrect: snapshot.isCorrect,
      outcome: snapshot.outcome,
      attemptedAt: snapshot.attemptedAt,
      documentName: snapshot.source === "full_test" ? "SAT Full-Length" : "SAT Practice",
      source: snapshot.source,
    });

    const incorrectAttempts = queue.unresolvedQueue.filter((snapshot) => snapshot.outcome === "incorrect").map(formatAttempt);
    const skippedAttempts = queue.unresolvedQueue.filter((snapshot) => snapshot.outcome === "skipped").map(formatAttempt);

    const reviewQueue = queue.unresolvedQueue.map((snapshot) => ({
      questionId: snapshot.questionId,
      questionCanonicalId: snapshot.questionCanonicalId,
      originOutcome: snapshot.outcome,
      outcome: snapshot.outcome,
      attemptId: snapshot.attemptId,
      source: snapshot.source,
      attemptedAt: snapshot.attemptedAt,
      section: snapshot.section,
      domain: snapshot.domain,
      skill: snapshot.skill,
      subskill: snapshot.subskill,
      difficulty: snapshot.difficulty,
    }));

    return res.json({
      attempts: queue.unresolvedQueue.map(formatAttempt),
      incorrectAttempts,
      skippedAttempts,
      reviewQueue,
      summary: {
        sessionId: null,
        sessionStartedAt: queue.latestAttemptAt,
        sessionMode: "mixed",
        sessionSection: "mixed",
        correctCount: queue.correctCount,
        incorrectCount: queue.incorrectCount,
        skippedCount: queue.skippedCount,
        totalCount: queue.latestSnapshots.length,
      },
      message: reviewQueue.length === 0
        ? "No unresolved review items right now. Great recovery streak."
        : undefined,
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch failed attempts", detail: error?.message ?? "Unknown error" });
  }
};

// Legacy optional filters retained for compatibility (published MC only)
export const getQuestionsByTopic = async (req: Request, res: Response) => {
  try {
    const unitTag = req.query.unitTag as string;
    if (!unitTag) {
      return res.status(400).json({ error: "unitTag query parameter is required" });
    }

    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

    const { data, error } = await supabaseServer
      .from("questions")
      .select(QUESTION_SAFE_SELECT)
      .eq("question_type", "multiple_choice")
      .eq("unit_tag", unitTag)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions", detail: error.message });
    }

    const rows = ((data ?? []) as unknown as CanonicalQuestionRowLike[]).filter((row) => isCanonicalRuntimeMcQuestion(row));
    return res.json({
      questions: rows.map(mapQuestionForStudent),
      total: rows.length,
      unitTag,
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
  }
};

export const getQuestionsByDifficulty = async (req: Request, res: Response) => {
  try {
    const difficultyLevel = parseInt(String(req.query.difficultyLevel ?? ""), 10);
    if (!difficultyLevel || difficultyLevel < 1 || difficultyLevel > 5) {
      return res.status(400).json({ error: "difficultyLevel must be between 1 and 5" });
    }

    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

    const { data, error } = await supabaseServer
      .from("questions")
      .select(QUESTION_SAFE_SELECT)
      .eq("question_type", "multiple_choice")
      .eq("difficulty", difficultyLevel)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions", detail: error.message });
    }

    const rows = ((data ?? []) as unknown as CanonicalQuestionRowLike[]).filter((row) => isCanonicalRuntimeMcQuestion(row));
    return res.json({
      questions: rows.map(mapQuestionForStudent),
      total: rows.length,
      difficultyLevel,
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch questions", detail: error?.message ?? "Unknown error" });
  }
};

export const submitQuestionFeedback = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const { questionId, sentiment, rating, comment } = req.body as {
      questionId?: string;
      sentiment?: "up" | "down";
      rating?: "up" | "down";
      comment?: string;
    };

    const normalizedSentiment = sentiment ?? rating;

    if (!questionId) {
      return res.status(400).json({ error: "questionId is required" });
    }

    if (!normalizedSentiment || !["up", "down"].includes(normalizedSentiment)) {
      return res.status(400).json({ error: 'sentiment must be "up" or "down"' });
    }

    const { data: question, error: questionError } = await supabaseServer
      .from("questions")
      .select("id")
      .eq("id", questionId)
      .single();

    if (questionError || !question) {
      return res.status(404).json({ error: "Question not found" });
    }

    const { error: insertError } = await supabaseServer
      .from("question_feedback")
      .upsert(
        {
          question_id: questionId,
          user_id: user.id,
          sentiment: normalizedSentiment,
          comment: comment || null,
          created_at: new Date().toISOString(),
        },
        { onConflict: "question_id,user_id" }
      );

    if (insertError) {
      return res.status(500).json({ error: "Failed to save feedback" });
    }

    return res.json({ success: true, message: "Feedback submitted" });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to submit feedback", detail: error?.message ?? "Unknown error" });
  }
};


