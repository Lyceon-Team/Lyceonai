import { Request, Response } from "express";
import { supabaseServer } from "../lib/supabase-server";

const REVIEW_STATUSES = ["in_review", "pending_review"];

export const getQuestionsNeedingReview = async (req: Request, res: Response) => {
  try {
    const limit = parseInt(String(req.query.limit ?? "50"), 10) || 50;
    const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

    const { data, error } = await supabaseServer
      .from("questions")
      .select("*")
      .in("status", REVIEW_STATUSES)
      .is("reviewed_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return res.status(500).json({ error: "Failed to get questions needing review" });

    return res.json({
      questions: data || [],
      total: data?.length || 0,
      hasMore: (data?.length || 0) === limit,
    });
  } catch {
    return res.status(500).json({ error: "Failed to get questions needing review" });
  }
};

export const getDuplicateQuestions = async (req: Request, res: Response) => {
  try {
    const limit = parseInt(String(req.query.limit ?? "50"), 10) || 50;

    const { data: allQuestions, error } = await supabaseServer
      .from("questions")
      .select("id, canonical_id, created_at")
      .not("canonical_id", "is", null);

    if (error) return res.status(500).json({ error: "Failed to get duplicate questions" });

    const buckets: Record<string, any[]> = {};
    for (const q of allQuestions || []) {
      if (!q.canonical_id) continue;
      if (!buckets[q.canonical_id]) buckets[q.canonical_id] = [];
      buckets[q.canonical_id].push(q);
    }

    const duplicates = Object.entries(buckets).filter(([, rows]) => rows.length > 1).slice(0, limit);

    if (!duplicates.length) {
      return res.json({ duplicateGroups: [], total: 0 });
    }

    return res.json({
      duplicateGroups: duplicates.map(([canonicalId, rows]) => ({
        canonicalId,
        count: rows.length,
        questions: rows,
      })),
      total: duplicates.length,
    });
  } catch {
    return res.status(500).json({ error: "Failed to get duplicate questions" });
  }
};

export const getQuestionStatistics = async (_req: Request, res: Response) => {
  try {
    const [{ count: total }, { count: inReview }, { count: published }] = await Promise.all([
      supabaseServer.from("questions").select("id", { count: "exact", head: true }),
      supabaseServer.from("questions").select("id", { count: "exact", head: true }).in("status", REVIEW_STATUSES),
      supabaseServer.from("questions").select("id", { count: "exact", head: true }).eq("status", "published"),
    ]);

    const { data: allQuestions } = await supabaseServer.from("questions").select("section_code, difficulty, source_type");

    const bySection: Record<string, number> = {};
    const byDifficulty: Record<string, number> = {};
    const bySourceType: Record<string, number> = {};

    for (const q of allQuestions || []) {
      const sectionCode = q.section_code || "UNKNOWN";
      bySection[sectionCode] = (bySection[sectionCode] || 0) + 1;

      const diff = String(q.difficulty ?? "unknown");
      byDifficulty[diff] = (byDifficulty[diff] || 0) + 1;

      const sourceType = String(q.source_type ?? "unknown");
      bySourceType[sourceType] = (bySourceType[sourceType] || 0) + 1;
    }

    return res.json({
      counts: {
        total: total || 0,
        inReview: inReview || 0,
        published: published || 0,
      },
      bySection,
      byDifficulty,
      bySourceType,
    });
  } catch {
    return res.status(500).json({ error: "Failed to get question statistics" });
  }
};

export const approveQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const reviewerId = (req as any).user?.id || null;

    const { error } = await supabaseServer
      .from("questions")
      .update({
        status: "published",
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerId,
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return res.status(500).json({ error: "Failed to approve question" });

    return res.json({ id, status: "published", message: "Question approved successfully" });
  } catch {
    return res.status(500).json({ error: "Failed to approve question" });
  }
};

export const rejectQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const reviewerId = (req as any).user?.id || null;

    const { error } = await supabaseServer
      .from("questions")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return res.status(500).json({ error: "Failed to reject question" });

    return res.json({ id, status: "rejected", message: "Question rejected successfully" });
  } catch {
    return res.status(500).json({ error: "Failed to reject question" });
  }
};

export const updateQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const fieldMapping: Record<string, string> = {
      stem: "stem",
      options: "options",
      correctAnswer: "correct_answer",
      answerText: "answer_text",
      explanation: "explanation",
      section: "section",
      sectionCode: "section_code",
      questionType: "question_type",
      domain: "domain",
      skill: "skill",
      subskill: "subskill",
      skillCode: "skill_code",
      difficulty: "difficulty",
      sourceType: "source_type",
      status: "status",
      testCode: "test_code",
      exam: "exam",
      aiGenerated: "ai_generated",
      diagramPresent: "diagram_present",
      tags: "tags",
      competencies: "competencies",
      provenanceChunkIds: "provenance_chunk_ids",
      optionMetadata: "option_metadata",
    };

    const payload: Record<string, unknown> = {};
    for (const [input, db] of Object.entries(fieldMapping)) {
      if (Object.prototype.hasOwnProperty.call(updates, input)) payload[db] = updates[input];
    }

    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    payload.updated_at = new Date().toISOString();

    const { error } = await supabaseServer.from("questions").update(payload).eq("id", id);
    if (error) return res.status(500).json({ error: "Failed to update question" });

    return res.json({ id, status: "updated", updatedFields: Object.keys(payload), message: "Question updated successfully" });
  } catch {
    return res.status(500).json({ error: "Failed to update question" });
  }
};

export const deleteQuestion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await supabaseServer.from("validation_issues").delete().eq("question_id", id);
    const { error } = await supabaseServer.from("questions").delete().eq("id", id);
    if (error) return res.status(500).json({ error: "Failed to delete question" });
    return res.json({ id, status: "deleted", message: "Question deleted successfully" });
  } catch {
    return res.status(500).json({ error: "Failed to delete question" });
  }
};

export const bulkApproveQuestions = async (req: Request, res: Response) => {
  try {
    const { questionIds } = req.body;

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ error: "questionIds must be a non-empty array" });
    }

    const now = new Date().toISOString();
    const reviewerId = (req as any).user?.id || null;

    const { error } = await supabaseServer
      .from("questions")
      .update({
        status: "published",
        reviewed_at: now,
        reviewed_by: reviewerId,
        published_at: now,
        updated_at: now,
      })
      .in("id", questionIds);

    if (error) return res.status(500).json({ error: "Failed to bulk approve questions" });

    return res.json({ count: questionIds.length, status: "published", message: `${questionIds.length} questions approved successfully` });
  } catch {
    return res.status(500).json({ error: "Failed to bulk approve questions" });
  }
};
