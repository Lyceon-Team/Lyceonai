import { Request, Response } from "express";
import { supabaseServer } from "../apps/api/src/lib/supabase-server";

const REVIEW_STATUSES = ["in_review", "pending_review"];

<<<<<<< HEAD
=======


type QuestionMutabilityCheck = {
  ok: boolean;
  status?: number;
  body?: Record<string, unknown>;
};

async function assertQuestionMutable(questionId: string): Promise<QuestionMutabilityCheck> {
  const { data: row, error } = await supabaseServer
    .from('questions')
    .select('id, canonical_id, needs_review, reviewed_at, version')
    .eq('id', questionId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      body: {
        success: false,
        error: 'Failed to load question state',
        detail: error.message,
      },
    };
  }

  if (!row) {
    return {
      ok: false,
      status: 404,
      body: {
        success: false,
        error: 'Question not found',
      },
    };
  }

  const isPublished = row.needs_review === false && !!row.reviewed_at;
  if (isPublished) {
    return {
      ok: false,
      status: 409,
      body: {
        success: false,
        error: 'published_content_immutable',
        message: 'Published questions are immutable. Create a new version and re-run QA.',
        canonicalId: row.canonical_id ?? null,
        version: row.version ?? null,
      },
    };
  }

  return { ok: true };
}
/**
 * GET /api/admin/questions/needs-review
 * Get all questions that need admin review (confidence < 0.8 or needsReview = true)
 */
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
export async function getNeedsReview(req: Request, res: Response) {
  try {
    const limitParam = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;

    const { data: reviewQuestions, error, count } = await supabaseServer
      .from("questions")
      .select("*", { count: "exact" })
      .in("status", REVIEW_STATUSES)
      .is("reviewed_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limitParam - 1);

    if (error) {
      return res.status(500).json({ success: false, error: "Failed to fetch questions for review", detail: error.message });
    }

    const total = count || 0;
    return res.json({
      success: true,
      questions: reviewQuestions || [],
      pagination: {
        total,
        limit: limitParam,
        offset,
        hasMore: offset + (reviewQuestions?.length || 0) < total,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to fetch questions for review" });
  }
}

export async function approveQuestion(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: "User not authenticated" });
    }
<<<<<<< HEAD

    const now = new Date().toISOString();
=======
    
    const mutability = await assertQuestionMutable(id);
    if (!mutability.ok) {
      return res.status(mutability.status || 500).json(mutability.body);
    }

    // Update question to approve it
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
    const { data: updated, error } = await supabaseServer
      .from("questions")
      .update({
        status: "published",
        reviewed_at: now,
        reviewed_by: userId,
        published_at: now,
        updated_at: now,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ success: false, error: "Question not found" });
      }
      return res.status(500).json({ success: false, error: "Failed to approve question", detail: error.message });
    }

    return res.json({ success: true, message: "Question approved successfully", question: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to approve question" });
  }
}

export async function rejectQuestion(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: "User not authenticated" });
    }
<<<<<<< HEAD

    const now = new Date().toISOString();
    const { data: updated, error } = await supabaseServer
      .from("questions")
      .update({
        status: "rejected",
        reviewed_at: now,
        reviewed_by: userId,
        updated_at: now,
      })
      .eq("id", id)
=======
    
    const mutability = await assertQuestionMutable(id);
    if (!mutability.ok) {
      return res.status(mutability.status || 500).json(mutability.body);
    }

    // Delete the question
    const { data: deleted, error } = await supabaseServer
      .from('questions')
      .delete()
      .eq('id', id)
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ success: false, error: "Question not found" });
      }
      return res.status(500).json({ success: false, error: "Failed to reject question", detail: error.message });
    }

    return res.json({ success: true, message: "Question rejected", question: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to reject question" });
  }
}

export async function getParsingStatistics(_req: Request, res: Response) {
  try {
    const [{ count: total }, { count: pending }, { count: published }] = await Promise.all([
      supabaseServer.from("questions").select("id", { count: "exact", head: true }),
      supabaseServer.from("questions").select("id", { count: "exact", head: true }).in("status", REVIEW_STATUSES),
      supabaseServer.from("questions").select("id", { count: "exact", head: true }).eq("status", "published"),
    ]);

    return res.json({
      success: true,
      statistics: {
        total: total || 0,
        pending: pending || 0,
        published: published || 0,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to fetch parsing statistics" });
  }
}

export async function updateQuestion(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;
    const { stem, options, correct_answer, explanation } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: "User not authenticated" });
    }
<<<<<<< HEAD

=======
    
    const mutability = await assertQuestionMutable(id);
    if (!mutability.ok) {
      return res.status(mutability.status || 500).json(mutability.body);
    }

    // Build update object with only provided fields
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
    const updateData: any = {
      status: "published",
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
      updated_at: new Date().toISOString(),
    };

    if (stem !== undefined) updateData.stem = stem;
    if (options !== undefined) updateData.options = options;
    if (correct_answer !== undefined) updateData.correct_answer = correct_answer;
    if (explanation !== undefined) updateData.explanation = explanation;

    const { data: updated, error } = await supabaseServer.from("questions").update(updateData).eq("id", id).select().single();

    if (error) {
      if (error.code === "PGRST116") return res.status(404).json({ success: false, error: "Question not found" });
      return res.status(500).json({ success: false, error: "Failed to update question", detail: error.message });
    }

    return res.json({ success: true, message: "Question updated successfully", question: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to update question" });
  }
}
