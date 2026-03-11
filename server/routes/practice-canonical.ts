// server/routes/practice-canonical.ts
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { checkPracticeLimit } from "../middleware/usage-limits";
import { csrfGuard } from "../middleware/csrf";
import { z } from "zod";
import { requireSupabaseAuth } from '../middleware/supabase-auth.js';
// Intentional runtime delegation: practice route ownership stays in server/** while mastery writes stay in apps/api services.
import { getQuestionMetadataForAttempt, applyMasteryUpdate } from "../../apps/api/src/services/studentMastery";
import { MasteryEventType } from "../../apps/api/src/services/mastery-constants";
import { isValidCanonicalId } from "../../apps/api/src/lib/canonicalId";



const router = Router();
const csrfProtection = csrfGuard();

// Rate limiter for practice answer submissions
const practiceAnswerRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute window
  max: 30, // max 30 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "rate_limited",
      message: "Too many practice submissions. Please slow down."
    });
  },
});

/**
 * DB truth (from your questions_rows (6).csv):
 * questions has: id, section, stem, type, options, difficulty, classification, answer_choice, answer_text, explanation
 *
 * practice_sessions FK: user_id -> users(id)  (NOT auth.users)
 * answer_attempts FK: user_id -> auth.users(id)
 *
 * IMPORTANT:
 * - We must only serve MC questions if answer_choice exists.
 * - options is stored as JSON string in DB, must be parsed to array.
 * - correctness must be normalized to avoid whitespace/case mismatches.
 */

type McOption = { key: string; text: string };

type SafeQuestionDTO = {
  id: string;
  section: string;
  stem: string;
  type: "mc";
  options: McOption[];
  difficulty: string | null;
  classification: any;
  correct_answer: null;
  explanation: null;
};

function toSafeQuestionDTO(q: any): SafeQuestionDTO {
  return {
    id: q.id,
    section: q.section,
    stem: q.stem,
    type: "mc",
    options: Array.isArray(q.options) ? q.options : [],
    difficulty: q.difficulty ?? null,
    classification: q.classification ?? null,
    correct_answer: null,
    explanation: null,
  };
}

function normalizeKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.toUpperCase();
}

function safeParseOptions(raw: unknown): McOption[] {
  let v: any = raw;

  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(v)) return [];
  const out: McOption[] = [];

  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const key = typeof (item as any).key === "string" ? (item as any).key.trim() : "";
    const text = typeof (item as any).text === "string" ? (item as any).text : "";
    if (!key || !text) continue;
    out.push({ key, text });
  }

  return out;
}

function isValidMcQuestion(row: any): boolean {
  // Must have a letter key in answer_choice and >= 2 options
  const correctKey = normalizeKey(row?.answer_choice);
  const options = safeParseOptions(row?.options);
  if (!correctKey) return false;
  if (options.length < 2) return false;

  // Must contain that key in options
  const hasKey = options.some((o) => normalizeKey(o.key) === correctKey);
  if (!hasKey) return false;

  return true;
}

function normalizeSectionParam(section?: string | null): string | null {
  if (!section) return "Random";
  const s = section.trim().toLowerCase();

  // Math variations
  if (s === "math") return "Math";

  // Reading & Writing variations
  if (s === "rw" || s === "reading_writing" || s === "reading" || s === "writing") return "RW";

  if (s === "random") return "Random";
  return "Random"; // Default to Random instead of null to avoid type issues
}

async function getSessionStats(sessionId: string, userId: string): Promise<{ correct: number; total: number; streak: number }> {
  const { data, error } = await supabaseServer
    .from("answer_attempts")
    .select("is_correct, outcome, attempted_at")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("attempted_at", { ascending: false });

  if (error) return { correct: 0, total: 0, streak: 0 };

  const attempts = data ?? [];
  const correct = attempts.filter((a: any) => a.is_correct === true).length;
  const total = attempts.length;

  let streak = 0;
  for (const a of attempts) {
    if ((a as any).outcome === "skipped") continue;
    if ((a as any).is_correct) streak++;
    else break;
  }

  return { correct, total, streak };
}

async function pickRandomQuestion(args: {
  section: "Math" | "RW" | "Random";
  userId: string;
  sessionId?: string | null;
}): Promise<
  | {
    question: SafeQuestionDTO;
  }
  | { error: string }
> {
  // Strategy:
  // - Pull a randomized slice from questions (filtered by section when needed)
  // - Filter out invalid MC rows (missing answer_choice/options/key mismatch)
  // - Prefer questions not attempted in this session (if sessionId exists)
  //   BUT DO NOT require attempts to exist (new students must still see questions).

  const baseQuery = supabaseServer
    .from("questions")
    .select("id, canonical_id, section, stem, type, options, difficulty, classification, answer_choice")
    .eq("type", "mc")
    .order("created_at", { ascending: false }) // stable-ish base order
    .limit(400); // cheap pool to sample from

  let q = baseQuery;
  if (args.section === "Math") q = q.eq("section", "Math");
  if (args.section === "RW") q = q.eq("section", "RW");
  // Random => no section filter

  const { data: pool, error } = await q;
  if (error) return { error: `questions_query_failed: ${error.message}` };
  if (!pool || pool.length === 0) return { error: "no_questions_available" };

  // Session attempts filter (soft preference)
  let attempted = new Set<string>();
  if (args.sessionId) {
    const { data: attempts, error: attemptsErr } = await supabaseServer
      .from("answer_attempts")
      .select("question_id")
      .eq("session_id", args.sessionId);

    if (!attemptsErr && attempts) {
      attempted = new Set(attempts.map((a: any) => a.question_id).filter(Boolean));
    }
  }

  // Filter invalid MC questions + build candidates (no explanation - secure DTO)
  const candidates = pool
    .map((row: any) => ({
      id: row.id,
      canonical_id: row.canonical_id,
      section: row.section,
      stem: row.stem,
      type: "mc" as const,
      options: safeParseOptions(row?.options),
      difficulty: row.difficulty ?? null,
      classification: row.classification ?? null,
      _answer_choice: row.answer_choice,
    }))
    .filter((row: any) => {
      if (!isValidCanonicalId(String(row.canonical_id || ""))) return false;
      return isValidMcQuestion({ answer_choice: row._answer_choice, options: row.options });
    });

  if (candidates.length === 0) return { error: "no_valid_questions_available" };

  // Prefer unattempted questions if possible
  const unattempted = candidates.filter((c) => !attempted.has(c.id));
  const pickFrom = unattempted.length > 0 ? unattempted : candidates;

  // Random pick (crypto-safe not required)
  const chosen = pickFrom[Math.floor(Math.random() * pickFrom.length)];

  return {
    question: toSafeQuestionDTO(chosen),
  };
}

/**
 * GET /api/practice/next?section=math&mode=balanced
 * - creates/continues practice session
 * - returns next question
 */
router.get("/next", requireSupabaseAuth, checkPracticeLimit({ increment: true }), async (req, res) => {
  const requestId = (req as any).requestId;
  const user = (req as any).user;
  const userId = user?.id;

  if (!userId) {
    return res.status(401).json({ error: "Authentication required", message: "You must be signed in", requestId });
  }

  const sectionParam = normalizeSectionParam(String(req.query.section ?? "random"));
  const section: "Math" | "RW" | "Random" =
    sectionParam === "Math" ? "Math" : sectionParam === "RW" ? "RW" : "Random";
  const mode = String(req.query.mode ?? "balanced");

  const clientInstanceId = String(req.query.client_instance_id || "fallback-client");

  // Find existing in_progress session for this user+section+mode (best effort)
  const { data: existingSession } = await supabaseServer
    .from("practice_sessions")
    .select("id, status, metadata")
    .eq("user_id", userId)
    .eq("section", section)
    .eq("mode", mode)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let sessionId = existingSession?.id ?? null;
  let sessionMeta = (existingSession?.metadata as any) || {};

  if (!sessionId) {
    // Create new session
    const { data: newSession, error: sessionErr } = await supabaseServer
      .from("practice_sessions")
      .insert({
        user_id: userId, // must match users(id) FK in your DB
        section,
        mode,
        status: "in_progress",
        started_at: new Date().toISOString(),
        metadata: { client_instance_id: clientInstanceId },
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (sessionErr || !newSession?.id) {
      return res.status(500).json({
        error: "session_create_failed",
        message: sessionErr?.message ?? "Unable to create practice session",
        requestId,
      });
    }

    sessionId = newSession.id;
    sessionMeta = { client_instance_id: clientInstanceId };
  }

  // REFRESH / RESUME logic: if there is an active question, return it
  if (sessionMeta.active_question_id) {
    const { data: attempt } = await supabaseServer
      .from("answer_attempts")
      .select("id")
      .eq("session_id", sessionId)
      .eq("question_id", sessionMeta.active_question_id)
      .maybeSingle();

    if (!attempt) {
      // It has not been answered yet! Resume it safely without picking a new one.

      // Multi-tab takeover updates identity
      if (sessionMeta.client_instance_id !== clientInstanceId) {
        sessionMeta.client_instance_id = clientInstanceId;
        await supabaseServer.from("practice_sessions").update({ metadata: sessionMeta }).eq("id", sessionId);
      }

      const { data: resumeQ } = await supabaseServer
        .from("questions")
        .select("id, canonical_id, section, stem, type, options, difficulty, classification, answer_choice")
        .eq("type", "mc")
        .eq("id", sessionMeta.active_question_id)
        .single();

      if (
        resumeQ &&
        resumeQ.type === "mc" &&
        isValidCanonicalId(String(resumeQ.canonical_id || "")) &&
        isValidMcQuestion({ answer_choice: resumeQ.answer_choice, options: resumeQ.options })
      ) {
        return res.json({
          sessionId,
          question: toSafeQuestionDTO({
            ...resumeQ,
            options: safeParseOptions(resumeQ.options),
          }),
          stats: await getSessionStats(sessionId, userId),
        });
      }
    }
  }

  const picked = await pickRandomQuestion({ section, userId, sessionId });
  if ("error" in picked) {
    return res.status(500).json({ error: "question_pick_failed", detail: picked.error, requestId });
  }

  sessionMeta.active_question_id = picked.question.id;
  sessionMeta.client_instance_id = clientInstanceId;

  // Persist the assigned question and client_instance_id
  await supabaseServer.from("practice_sessions").update({ metadata: sessionMeta }).eq("id", sessionId);

  // Log practice_event (non-blocking)
  try {
    await supabaseServer.from("practice_events").insert({
      user_id: userId,
      session_id: sessionId,
      question_id: picked.question.id,
      event_type: "served",
      created_at: new Date().toISOString(),
    });
  } catch {
    // ignore
  }

  // Get session stats for rehydration
  const stats = await getSessionStats(sessionId, userId);

  return res.json({
    sessionId,
    question: picked.question,
    stats,
  });
});

const AnswerBodySchema = z.object({
  sessionId: z.string().uuid(),
  questionId: z.string().uuid(),
  selectedAnswer: z.string().optional().nullable(),
  freeResponseAnswer: z.string().optional().nullable(),
  skipped: z.boolean().optional(),
  elapsedMs: z.number().optional().nullable(),
  idempotencyKey: z.string().max(128).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
});

router.post("/answer", requireSupabaseAuth, practiceAnswerRateLimiter, csrfProtection, async (req, res) => {
  const requestId = (req as any).requestId;
  const user = (req as any).user;
  const userId = user?.id;

  if (!userId) {
    return res.status(401).json({ error: "Authentication required", message: "You must be signed in", requestId });
  }

  const parsed = AnswerBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues, requestId });
  }

  const { sessionId, questionId, selectedAnswer, skipped, elapsedMs, idempotencyKey, client_instance_id } = parsed.data;

  // --- ENFORCE SESSION OWNERSHIP ---
  // Load session and verify user_id matches authenticated user
  const { data: sessionRow, error: sessionErr } = await supabaseServer
    .from("practice_sessions")
    .select("id, user_id, metadata")
    .eq("id", sessionId)
    .single();
  if (sessionErr || !sessionRow) {
    return res.status(404).json({ error: "session_not_found", message: "Practice session not found", requestId });
  }
  if (sessionRow.user_id !== userId) {
    return res.status(403).json({ error: "forbidden", message: "Session does not belong to this user", requestId });
  }

  // Enforce Multi-Tab Safety: If another tab took over the session, reject this answer submission
  const sessionMeta = (sessionRow.metadata as any) || {};
  if (client_instance_id && sessionMeta.client_instance_id && sessionMeta.client_instance_id !== client_instance_id) {
    // If idempotency key matches an existing successful attempt, we still allow it so retry succeeds gracefully
    const { data: existing } = await supabaseServer
      .from("answer_attempts")
      .select("id")
      .eq("user_id", userId)
      .eq("client_attempt_id", idempotencyKey || "NO_MATCH")
      .maybeSingle();

    if (!existing) {
      return res.status(409).json({
        error: "conflict",
        message: "Session was taken over by another tab.",
        client_instance_id,
        requestId
      });
    }
  }
  // --- END SESSION OWNERSHIP CHECK ---

  // Fetch canonical answer + explanation from DB
  const { data: qRow, error: qErr } = await supabaseServer
    .from("questions")
    .select("id, canonical_id, type, answer_choice, explanation, options")
    .eq("id", questionId)
    .single();

  if (qErr || !qRow) {
    return res.status(404).json({ error: "question_not_found", message: qErr?.message ?? "Not found", requestId });
  }

  if (!isValidCanonicalId(String(qRow.canonical_id || ""))) {
    return res.status(422).json({
      error: "invalid_question_data",
      message: "Question canonical ID is invalid.",
      requestId,
    });
  }

  if (qRow.type !== "mc") {
    return res.status(422).json({
      error: "invalid_question_data",
      message: "Only MC questions are supported in canonical practice.",
      requestId,
    });
  }

  const parsedOptions = safeParseOptions(qRow.options);
  if (!isValidMcQuestion({ answer_choice: qRow.answer_choice, options: parsedOptions })) {
    return res.status(422).json({
      error: "invalid_question_data",
      message: "This question has invalid MC schema and cannot be graded.",
      requestId,
    });
  }

  const qType: "mc" = "mc";
  const correctAnswerKey = normalizeKey(qRow.answer_choice);
  const explanation: string | null = typeof qRow.explanation === "string" && qRow.explanation.trim() ? qRow.explanation : null;

  if (!correctAnswerKey) {
    return res.status(422).json({
      error: "invalid_question_data",
      message: "This question is missing an answer key and cannot be graded.",
      requestId,
    });
  }

  const allowedKeys = new Set(parsedOptions.map((opt) => normalizeKey(opt.key)).filter(Boolean));
  if (!skipped) {
    const selected = normalizeKey(selectedAnswer ?? null);
    if (!selected) {
      return res.status(400).json({
        error: "invalid_answer",
        message: "selectedAnswer is required for non-skipped MC submissions.",
        requestId,
      });
    }

    if (!allowedKeys.has(selected)) {
      return res.status(400).json({
        error: "invalid_answer",
        message: "selectedAnswer must be one of the configured option keys.",
        requestId,
      });
    }
  }

  // Determine chosen value
  const chosenRaw = skipped ? null : selectedAnswer ?? null;
  const chosen = normalizeKey(chosenRaw);

  const isCorrect = !!chosen && chosen === correctAnswerKey;
  const outcome = skipped ? "skipped" : isCorrect ? "correct" : "incorrect";

  // Clamp time_spent_ms to 0-30 minutes for data integrity
  const clampedTimeSpentMs = typeof elapsedMs === "number"
    ? Math.min(Math.max(0, elapsedMs), 30 * 60 * 1000)
    : null;

  // Insert answer attempt (MUST include user_id for RLS + FK auth.users)
  // Note: user_id FK is auth.users(id). We assume req.user.id is auth uid.
  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: insErr } = await supabaseServer.from("answer_attempts").insert({
    id: attemptId,
    user_id: userId,
    session_id: sessionId,
    question_id: questionId,
    selected_answer: selectedAnswer ?? null,
    free_response_answer: null,
    chosen: chosenRaw ?? null,
    is_correct: isCorrect,
    outcome,
    time_spent_ms: clampedTimeSpentMs,
    attempted_at: now,
    client_attempt_id: idempotencyKey ?? null,
  });

  // If unique(user_id, client_attempt_id) or unique(session_id, question_id) hits because user answered twice, 
  // we still return grade. But we want deterministic behavior, so we won't fail the UI.
  if (insErr && String(insErr.message || "").toLowerCase().includes("duplicate")) {
    if (idempotencyKey) {
      // It's a true idempotent retry. Fetch the previous outcome and return exactly that.
      const { data: existing } = await supabaseServer
        .from("answer_attempts")
        .select("is_correct, outcome")
        .eq("user_id", userId)
        .eq("client_attempt_id", idempotencyKey)
        .single();

      if (existing) {
        return res.json({
          isCorrect: existing.is_correct,
          mode: qType,
          correctAnswerKey: correctAnswerKey ?? null,
          explanation,
          feedback: existing.is_correct ? "Correct" : existing.outcome === "skipped" ? "Skipped" : "Incorrect",
          stats: await getSessionStats(sessionId, userId),
          idempotentRetried: true,
        });
      }
    }
  } else if (insErr) {
    // non-blocking insert failure
    console.error("[practice] answer_attempts insert failed", { requestId, message: insErr.message });
  }

  // practice_events (non-blocking)
  try {
    await supabaseServer.from("practice_events").insert({
      user_id: userId,
      session_id: sessionId,
      question_id: questionId,
      event_type: "answered",
      created_at: now,
      payload: {
        outcome,
        isCorrect,
      },
    });
  } catch {
    // ignore
  }

  // Log to student_question_attempts + update mastery rollups
  // MASTERY V1.0: Use PRACTICE_SUBMIT event type for proper weighting
  try {
    const metadata = await getQuestionMetadataForAttempt(questionId);
    if (metadata.canonicalId) {
      await applyMasteryUpdate({
        userId,
        questionCanonicalId: metadata.canonicalId,
        sessionId,
        isCorrect,
        selectedChoice: selectedAnswer ?? null,
        timeSpentMs: clampedTimeSpentMs,
        eventType: MasteryEventType.PRACTICE_SUBMIT,
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
    }
  } catch (masteryErr: any) {
    console.warn("[practice] mastery logging failed", { requestId, message: masteryErr?.message });
  }

  // Get updated session stats
  const stats = await getSessionStats(sessionId, userId);

  return res.json({
    isCorrect,
    mode: qType,
    correctAnswerKey: correctAnswerKey ?? null,
    explanation,
    feedback: isCorrect ? "Correct" : skipped ? "Skipped" : "Incorrect",
    stats,
  });
});

export default router;
