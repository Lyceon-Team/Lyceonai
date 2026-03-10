/**
 * Review Errors Routes
 *
 * Handles review error attempt submissions with proper persistence.
 * Part of Sprint 2 Final Closeout (Gap 1).
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { applyMasteryUpdate, getQuestionMetadataForAttempt } from "../../apps/api/src/services/studentMastery";
import { MasteryEventType } from "../../apps/api/src/services/mastery-constants";

const router = Router();

// Validation schema for review error attempt
const reviewErrorAttemptSchema = z.object({
  question_id: z.string().min(1, "question_id is required"),
  selected_answer: z.string().nullable().optional(),
  free_response_answer: z.string().nullable().optional(),
  is_correct: z.boolean().optional(), // deprecated: correctness is server-verified
  seconds_spent: z.number().int().nonnegative().nullable().optional(),
  source_context: z.literal("review_errors"),
  client_attempt_id: z.string().optional(),
});

function normalizeAnswer(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function gradeReviewAnswer(question: {
  type: string | null;
  answer_choice: string | null;
  answer_text: string | null;
}, selectedAnswer: string | null | undefined, freeResponseAnswer: string | null | undefined): boolean {
  const type = (question.type || "mc").toLowerCase();

  if (type === "fr") {
    return normalizeAnswer(freeResponseAnswer) !== "" && normalizeAnswer(freeResponseAnswer) === normalizeAnswer(question.answer_text);
  }

  return normalizeAnswer(selectedAnswer) !== "" && normalizeAnswer(selectedAnswer) === normalizeAnswer(question.answer_choice);
}

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
      free_response_answer,
      seconds_spent,
      client_attempt_id,
    } = validationResult.data;

    // Get authenticated user ID from middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized - user ID not found" });
    }

    // Load canonical question details and server-verify correctness.
    const { data: question, error: questionError } = await supabaseServer
      .from("questions")
      .select("id, canonical_id, type, answer_choice, answer_text")
      .eq("id", question_id)
      .single();

    if (questionError || !question) {
      return res.status(404).json({ error: "Question not found", detail: questionError?.message });
    }

    const verifiedIsCorrect = gradeReviewAnswer(question, selected_answer, free_response_answer);

    // Prepare insert data
    const insertData = {
      student_id: userId,
      question_id,
      context: "review_errors" as const,
      selected_answer: selected_answer || free_response_answer || null,
      is_correct: verifiedIsCorrect,
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
          verified_is_correct: existing?.is_correct ?? verifiedIsCorrect,
          masteryApplied: false,
        });
      }

      console.error("[review-errors/attempt] Error inserting attempt:", error);
      return res.status(500).json({ error: "Failed to record attempt", detail: error.message });
    }

    // Tutor open alone should not change mastery.
    // Only apply canonical mastery update when retry is tutor-verified for this question.
    let masteryApplied = false;
    let masteryError: string | null = null;

    if (question.canonical_id) {
      const { data: tutorContext, error: tutorContextError } = await supabaseServer
        .from("tutor_interactions")
        .select("id")
        .eq("user_id", userId)
        .contains("canonical_ids_used", [question.canonical_id])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (tutorContextError) {
        console.warn("[review-errors/attempt] Tutor context check failed:", tutorContextError.message);
      }

      if (tutorContext) {
        const metadata = await getQuestionMetadataForAttempt(question_id);
        if (metadata.canonicalId) {
          const masteryResult = await applyMasteryUpdate({
            userId,
            questionCanonicalId: metadata.canonicalId,
            sessionId: null,
            isCorrect: verifiedIsCorrect,
            selectedChoice: selected_answer || null,
            timeSpentMs: typeof seconds_spent === "number" ? seconds_spent * 1000 : null,
            eventType: MasteryEventType.TUTOR_RETRY_SUBMIT,
            metadata: {
              exam: metadata.exam,
              section: metadata.section,
              domain: metadata.domain,
              skill: metadata.skill,
              subskill: metadata.subskill,
              difficulty_bucket: metadata.difficulty_bucket,
              structure_cluster_id: metadata.structure_cluster_id,
            },
          });

          masteryApplied = !masteryResult.error;
          masteryError = masteryResult.error || null;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      attempt: data,
      verified_is_correct: verifiedIsCorrect,
      masteryApplied,
      masteryEvent: masteryApplied ? MasteryEventType.TUTOR_RETRY_SUBMIT : null,
      masteryError,
    });
  } catch (error: any) {
    console.error("[review-errors/attempt] Unexpected error:", error);
    return res.status(500).json({ error: "Internal server error", detail: error.message });
  }
}

export default router;
