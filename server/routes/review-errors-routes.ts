/**
 * Review Errors Routes
 *
 * Handles review error attempt submissions with canonical review/tutor event semantics.
 */

import { Request, Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { applyMasteryUpdate, getQuestionMetadataForAttempt } from "../../apps/api/src/services/studentMastery";
import { MasteryEventType } from "../../apps/api/src/services/mastery-constants";

type ReviewOutcome = "review_pass" | "review_fail";
type TutorOutcome = "tutor_helped" | "tutor_fail";

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

function gradeReviewAnswer(
  question: {
    type: string | null;
    answer_choice: string | null;
    answer_text: string | null;
  },
  selectedAnswer: string | null | undefined,
  freeResponseAnswer: string | null | undefined
): boolean {
  const type = (question.type || "mc").toLowerCase();

  if (type === "fr") {
    return normalizeAnswer(freeResponseAnswer) !== "" && normalizeAnswer(freeResponseAnswer) === normalizeAnswer(question.answer_text);
  }

  return normalizeAnswer(selectedAnswer) !== "" && normalizeAnswer(selectedAnswer) === normalizeAnswer(question.answer_choice);
}

function resolveReviewOutcome(isCorrect: boolean): ReviewOutcome {
  return isCorrect ? "review_pass" : "review_fail";
}

function resolveReviewEventType(isCorrect: boolean): MasteryEventType {
  return isCorrect ? MasteryEventType.REVIEW_PASS : MasteryEventType.REVIEW_FAIL;
}

function resolveTutorOutcome(isCorrect: boolean): TutorOutcome {
  return isCorrect ? "tutor_helped" : "tutor_fail";
}

function resolveTutorEventType(isCorrect: boolean): MasteryEventType {
  return isCorrect ? MasteryEventType.TUTOR_HELPED : MasteryEventType.TUTOR_FAIL;
}

/**
 * POST /api/review-errors/attempt
 *
 * Records a student's review attempt and emits canonical mastery events.
 * - Always emits one canonical review outcome event: REVIEW_PASS or REVIEW_FAIL.
 * - Emits tutor auxiliary effects only on verified retries: TUTOR_HELPED or TUTOR_FAIL.
 * - Rejects mastery emission when no prior failed/skipped practice source attempt exists.
 */
export async function recordReviewErrorAttempt(req: Request, res: Response) {
  const requestId = req.requestId;

  try {
    const validationResult = reviewErrorAttemptSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: "Invalid request body",
        code: "INVALID_REVIEW_ATTEMPT_PAYLOAD",
        details: validationResult.error.issues,
        requestId,
      });
    }

    const {
      question_id,
      selected_answer,
      free_response_answer,
      seconds_spent,
      client_attempt_id,
    } = validationResult.data;

    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized - user ID not found", code: "AUTH_REQUIRED", requestId });
    }

    // Canonical anti-shortcut guard: question must come from a prior failed/skipped practice attempt.
    const { data: reviewSourceAttempt, error: reviewSourceError } = await supabaseServer
      .from("answer_attempts")
      .select("id, attempted_at, outcome, is_correct")
      .eq("user_id", userId)
      .eq("question_id", question_id)
      .or("outcome.eq.incorrect,outcome.eq.skipped,is_correct.eq.false")
      .order("attempted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reviewSourceError) {
      return res.status(500).json({
        error: "Failed to verify review eligibility",
        code: "REVIEW_ELIGIBILITY_CHECK_FAILED",
        detail: reviewSourceError.message,
        requestId,
      });
    }

    if (!reviewSourceAttempt) {
      return res.status(403).json({
        error: "Question is not eligible for review mastery updates",
        code: "REVIEW_NOT_ELIGIBLE",
        requestId,
      });
    }

    const { data: question, error: questionError } = await supabaseServer
      .from("questions")
      .select("id, canonical_id, type, answer_choice, answer_text, explanation")
      .eq("id", question_id)
      .single();

    if (questionError || !question) {
      return res.status(404).json({ error: "Question not found", detail: questionError?.message, requestId });
    }

    const verifiedIsCorrect = gradeReviewAnswer(question, selected_answer, free_response_answer);
    const reviewOutcome = resolveReviewOutcome(verifiedIsCorrect);
    const reviewEventType = resolveReviewEventType(verifiedIsCorrect);

    const mode: "mc" | "fr" = (question.type || "mc").toLowerCase() === "fr" ? "fr" : "mc";
    const correctAnswerKey = mode === "mc"
      ? ((question.answer_choice || "").trim().toUpperCase() || null)
      : null;
    const explanation = typeof (question as any).explanation === "string" && (question as any).explanation.trim()
      ? (question as any).explanation
      : null;

    const insertData = {
      student_id: userId,
      question_id,
      context: "review_errors" as const,
      selected_answer: selected_answer || free_response_answer || null,
      is_correct: verifiedIsCorrect,
      seconds_spent: seconds_spent || null,
      client_attempt_id: client_attempt_id || null,
    };

    const { data, error } = await supabaseServer
      .from("review_error_attempts")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      if (error.code === "23505" && client_attempt_id) {
        const { data: existing, error: fetchError } = await supabaseServer
          .from("review_error_attempts")
          .select()
          .eq("student_id", userId)
          .eq("client_attempt_id", client_attempt_id)
          .single();

        if (fetchError) {
          console.error("[review-errors/attempt] Error fetching existing attempt:", fetchError);
          return res.status(500).json({ error: "Database error", detail: fetchError.message, requestId });
        }

        const existingIsCorrect = Boolean(existing?.is_correct);
        return res.status(200).json({
          ok: true,
          attempt: existing,
          idempotent: true,
          verified_is_correct: existing?.is_correct ?? verifiedIsCorrect,
          reviewOutcome: resolveReviewOutcome(existingIsCorrect),
          tutorVerifiedRetry: false,
          tutorOutcome: null,
          masteryApplied: false,
          masteryEvents: [],
          masteryErrors: [],
          mode,
          correctAnswerKey,
          explanation,
        });
      }

      console.error("[review-errors/attempt] Error inserting attempt:", error);
      return res.status(500).json({ error: "Failed to record attempt", detail: error.message, requestId });
    }

    const metadata = await getQuestionMetadataForAttempt(question_id);
    const masteryEvents: MasteryEventType[] = [];
    const masteryErrors: string[] = [];

    const emitMasteryEvent = async (eventType: MasteryEventType): Promise<void> => {
      if (!metadata.canonicalId) {
        masteryErrors.push("Missing canonical ID for mastery emission");
        return;
      }

      const masteryResult = await applyMasteryUpdate({
        userId,
        questionCanonicalId: metadata.canonicalId,
        sessionId: null,
        isCorrect: verifiedIsCorrect,
        selectedChoice: selected_answer || null,
        timeSpentMs: typeof seconds_spent === "number" ? seconds_spent * 1000 : null,
        eventType,
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

      masteryEvents.push(eventType);
      if (masteryResult.error) {
        masteryErrors.push(masteryResult.error);
      }
    };

    // Canonical review outcome event is always emitted for eligible review attempts.
    await emitMasteryEvent(reviewEventType);

    // Tutor verification is separate from review semantics and only contributes on verified retry.
    let tutorVerifiedRetry = false;
    let tutorOutcome: TutorOutcome | null = null;

    if (question.canonical_id) {
      const { data: tutorContext, error: tutorContextError } = await supabaseServer
        .from("tutor_interactions")
        .select("id, created_at")
        .eq("user_id", userId)
        .contains("canonical_ids_used", [question.canonical_id])
        .gte("created_at", reviewSourceAttempt.attempted_at)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (tutorContextError) {
        console.warn("[review-errors/attempt] Tutor context check failed:", tutorContextError.message);
      }

      if (tutorContext) {
        tutorVerifiedRetry = true;
        tutorOutcome = resolveTutorOutcome(verifiedIsCorrect);
        await emitMasteryEvent(resolveTutorEventType(verifiedIsCorrect));
      }
    }

    return res.status(200).json({
      ok: true,
      attempt: data,
      verified_is_correct: verifiedIsCorrect,
      reviewOutcome,
      tutorVerifiedRetry,
      tutorOutcome,
      masteryApplied: masteryEvents.length > 0 && masteryErrors.length === 0,
      masteryEvents,
      masteryErrors,
      mode,
      correctAnswerKey,
      explanation,
    });
  } catch (error: any) {
    console.error("[review-errors/attempt] Unexpected error:", error);
    return res.status(500).json({ error: "Internal server error", detail: error.message, requestId });
  }
}
