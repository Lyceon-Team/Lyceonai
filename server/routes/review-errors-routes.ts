/**
 * Review Errors Routes
 * 
 * Handles review error attempt submissions with proper persistence.
 * Part of Sprint 2 Final Closeout (Gap 1).
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";

const router = Router();

// Validation schema for review error attempt
const reviewErrorAttemptSchema = z.object({
  question_id: z.string().min(1, "question_id is required"),
  selected_answer: z.string().nullable().optional(),
  is_correct: z.boolean(),
  seconds_spent: z.number().int().nonnegative().nullable().optional(),
  source_context: z.literal("review_errors"),
  client_attempt_id: z.string().optional(),
});

/**
 * POST /api/review-errors/attempt
 * 
 * Records a student's attempt on a review error question.
 * Requires authentication, CSRF protection, and student or admin role.
 * 
 * @route POST /api/review-errors/attempt
 * @auth requireSupabaseAuth, requireStudentOrAdmin, csrfProtection
 */
export async function recordReviewErrorAttempt(req: Request, res: Response) {
  try {
    // Validate request body
    const validationResult = reviewErrorAttemptSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: validationResult.error.issues,
      });
    }

    const {
      question_id,
      selected_answer,
      is_correct,
      seconds_spent,
      client_attempt_id,
    } = validationResult.data;

    // Get authenticated user ID from middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized - user ID not found" });
    }

    // Prepare insert data
    const insertData = {
      student_id: userId,
      question_id,
      context: "review_errors" as const,
      selected_answer: selected_answer || null,
      is_correct,
      seconds_spent: seconds_spent || null,
      client_attempt_id: client_attempt_id || null,
    };

    // Insert attempt with idempotency support
    // If client_attempt_id is provided and conflicts, return existing row
    const { data, error } = await supabaseServer
      .from("review_error_attempts")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      // Check if it's a unique constraint violation (idempotency)
      if (error.code === "23505" && client_attempt_id) {
        // Fetch and return the existing attempt
        const { data: existing, error: fetchError } = await supabaseServer
          .from("review_error_attempts")
          .select()
          .eq("student_id", userId)
          .eq("client_attempt_id", client_attempt_id)
          .single();

        if (fetchError) {
          console.error("[review-errors/attempt] Error fetching existing attempt:", fetchError);
          return res.status(500).json({ error: "Database error", detail: fetchError.message });
        }

        return res.status(200).json({
          ok: true,
          attempt: existing,
          idempotent: true,
        });
      }

      console.error("[review-errors/attempt] Error inserting attempt:", error);
      return res.status(500).json({ error: "Failed to record attempt", detail: error.message });
    }

    return res.status(200).json({
      ok: true,
      attempt: data,
    });
  } catch (error: any) {
    console.error("[review-errors/attempt] Unexpected error:", error);
    return res.status(500).json({ error: "Internal server error", detail: error.message });
  }
}

export default router;
