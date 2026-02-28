// server/routes/practice-canonical.ts
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { checkPracticeLimit } from "../middleware/usage-limits";
import { csrfGuard } from "../middleware/csrf";
import { recordCompetencyEvent } from "../../apps/api/src/routes/progress";
import { z } from "zod";
import { requireSupabaseAuth } from '../middleware/supabase-auth.js';
import { getQuestionMetadataForAttempt, applyMasteryUpdate } from "../../apps/api/src/services/studentMastery";
import { MasteryEventType } from "../../apps/api/src/services/mastery-constants";



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
  type: "mc" | "fr";
  options: McOption[] | null;
  difficulty: string | null;
  classification: any;
};

function toSafeQuestionDTO(q: any): SafeQuestionDTO {
  return {
    id: q.id,
    section: q.section,
    stem: q.stem,
    type: q.type,
    options: q.type === "mc" ? (q.options ?? null) : null,
    difficulty: q.difficulty ?? null,
    classification: q.classification ?? null,
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
  if (!section) return null;
  const s = section.trim().toLowerCase();
  if (s === "math") return "Math";
  if (s === "reading" || s === "rw" || s === "reading-writing") return "Reading";
  if (s === "random") return "Random";
  return null;
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
  section: "Math" | "Reading" | "Random";
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
    .select("id, section, stem, type, options, difficulty, classification, answer_choice")
    .order("created_at", { ascending: false }) // stable-ish base order
    .limit(400); // cheap pool to sample from

  let q = baseQuery;
  if (args.section === "Math") q = q.eq("section", "Math");
  if (args.section === "Reading") q = q.eq("section", "Reading");
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
    .map((row: any) => {
      const type = row?.type === "fr" ? "fr" : "mc";
      const options = type === "mc" ? safeParseOptions(row?.options) : null;
      return {
        id: row.id,
        section: row.section,
        stem: row.stem,
        type,
        options,
        difficulty: row.difficulty ?? null,
        classification: row.classification ?? null,
        _answer_choice: row.answer_choice,
      };
    })
    .filter((row: any) => {
      if (row.type === "mc") {
        // hard reject invalid MC
        return isValidMcQuestion({ answer_choice: row._answer_choice, options: row.options });
      }
      // FR allowed even if no answer_choice
      return true;
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
  const section: "Math" | "Reading" | "Random" =
    sectionParam === "Math" ? "Math" : sectionParam === "Reading" ? "Reading" : "Random";

  // Find existing in_progress session for this user+section (best effort)
  const { data: existingSession } = await supabaseServer
    .from("practice_sessions")
    .select("id, status")
    .eq("user_id", userId)
    .eq("section", section)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let sessionId = existingSession?.id ?? null;

  if (!sessionId) {
    // Create new session
    const { data: newSession, error: sessionErr } = await supabaseServer
      .from("practice_sessions")
      .insert({
        user_id: userId, // must match users(id) FK in your DB
        section,
        status: "in_progress",
        started_at: new Date().toISOString(),
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
  }

  const picked = await pickRandomQuestion({ section, userId, sessionId });
  if ("error" in picked) {
    return res.status(500).json({ error: "question_pick_failed", detail: picked.error, requestId });
  }

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

  const { sessionId, questionId, selectedAnswer, freeResponseAnswer, skipped, elapsedMs, idempotencyKey } = parsed.data;

  // --- ENFORCE SESSION OWNERSHIP ---
  // Load session and verify user_id matches authenticated user
  const { data: sessionRow, error: sessionErr } = await supabaseServer
    .from("practice_sessions")
    .select("id, user_id")
    .eq("id", sessionId)
    .single();
  if (sessionErr || !sessionRow) {
    return res.status(404).json({ error: "session_not_found", message: "Practice session not found", requestId });
  }
  if (sessionRow.user_id !== userId) {
    return res.status(403).json({ error: "forbidden", message: "Session does not belong to this user", requestId });
  }
  // --- END SESSION OWNERSHIP CHECK ---

  // Fetch canonical answer + explanation from DB
  const { data: qRow, error: qErr } = await supabaseServer
    .from("questions")
    .select("id, type, answer_choice, answer_text, explanation, options")
    .eq("id", questionId)
    .single();

  if (qErr || !qRow) {
    return res.status(404).json({ error: "question_not_found", message: qErr?.message ?? "Not found", requestId });
  }

  const qType: "mc" | "fr" = qRow.type === "fr" ? "fr" : "mc";
  const correctAnswerKeyRaw = qType === "mc" ? qRow.answer_choice : qRow.answer_text;
  const correctAnswerKey = normalizeKey(correctAnswerKeyRaw); // IMPORTANT normalization
  const explanation: string | null = typeof qRow.explanation === "string" && qRow.explanation.trim() ? qRow.explanation : null;

  // Hard rule: do not allow MC grading if answer_choice missing.
  // Also: do not show these questions in /next, but this protects older sessions.
  if (qType === "mc" && !correctAnswerKey) {
    return res.status(422).json({
      error: "invalid_question_data",
      message: "This question is missing an answer key and cannot be graded.",
      requestId,
    });
  }

  // Determine chosen value
  const chosenRaw = skipped ? null : qType === "mc" ? selectedAnswer ?? null : freeResponseAnswer ?? null;
  const chosen = normalizeKey(chosenRaw);

  let isCorrect = false;
  if (skipped) {
    isCorrect = false;
  } else if (qType === "mc") {
    isCorrect = !!chosen && !!correctAnswerKey && chosen === correctAnswerKey;
  } else {
    // FR: simple normalized string compare (upgrade later)
    isCorrect = !!chosen && !!correctAnswerKey && chosen === correctAnswerKey;
  }

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
    selected_answer: qType === "mc" ? (selectedAnswer ?? null) : null,
    free_response_answer: qType === "fr" ? (freeResponseAnswer ?? null) : null,
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
        selectedChoice: qType === "mc" ? (selectedAnswer ?? null) : null,
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
