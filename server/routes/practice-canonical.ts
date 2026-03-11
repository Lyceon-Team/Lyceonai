import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import crypto from "crypto";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { checkPracticeLimit } from "../middleware/usage-limits";
import { csrfGuard } from "../middleware/csrf";
<<<<<<< HEAD
import { requireSupabaseAuth } from "../middleware/supabase-auth.js";
import { applyMasteryUpdate, getQuestionMetadataForAttempt } from "../../apps/api/src/services/studentMastery";
=======
import { z } from "zod";
import { requireSupabaseAuth } from '../middleware/supabase-auth.js';
// Intentional runtime delegation: practice route ownership stays in server/** while mastery writes stay in apps/api services.
import { getQuestionMetadataForAttempt, applyMasteryUpdate } from "../../apps/api/src/services/studentMastery";
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
import { MasteryEventType } from "../../apps/api/src/services/mastery-constants";
import { isValidCanonicalId } from "../../apps/api/src/lib/canonicalId";

const router = Router();
const csrfProtection = csrfGuard();

const practiceAnswerRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "rate_limited", message: "Too many practice submissions. Please slow down." });
  },
});

type Option = { key: "A" | "B" | "C" | "D"; text: string };

type SafeQuestionDTO = {
  id: string;
  canonical_id: string | null;
  section: string;
  section_code: "MATH" | "RW";
  question_type: "multiple_choice";
  stem: string;
<<<<<<< HEAD
  options: [Option, Option, Option, Option];
  difficulty: 1 | 2 | 3;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  skill_code: string | null;
  tags: unknown | null;
  competencies: unknown | null;
};

function normalizeSectionParam(section?: string | null): "MATH" | "RW" | "RANDOM" {
  const s = String(section || "random").trim().toLowerCase();
  if (s === "math" || s === "m") return "MATH";
  if (s === "rw" || s === "reading-writing" || s === "reading" || s === "writing") return "RW";
  return "RANDOM";
}

function normalizeChoice(value: unknown): "A" | "B" | "C" | "D" | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["A", "B", "C", "D"].includes(normalized)) return normalized as "A" | "B" | "C" | "D";
  return null;
=======
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
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
}

function normalizeOptions(options: unknown): [Option, Option, Option, Option] | null {
  if (!Array.isArray(options) || options.length !== 4) return null;
  const parsed = options.map((opt: any) => ({ key: normalizeChoice(opt?.key), text: opt?.text }));
  if (parsed.some((opt) => !opt.key || typeof opt.text !== "string" || opt.text.length === 0)) return null;
  return parsed as [Option, Option, Option, Option];
}

function toSafeQuestion(row: any): SafeQuestionDTO | null {
  const options = normalizeOptions(row.options);
  const difficulty = Number(row.difficulty);
  if (!options) return null;
  if (difficulty !== 1 && difficulty !== 2 && difficulty !== 3) return null;

  return {
    id: row.id,
    canonical_id: row.canonical_id ?? null,
    section: row.section,
    section_code: row.section_code,
    question_type: "multiple_choice",
    stem: row.stem,
    options,
    difficulty,
    domain: row.domain ?? null,
    skill: row.skill ?? null,
    subskill: row.subskill ?? null,
    skill_code: row.skill_code ?? null,
    tags: row.tags ?? null,
    competencies: row.competencies ?? null,
  };
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
  for (const attempt of attempts) {
    if (attempt.outcome === "skipped") continue;
    if (attempt.is_correct) streak++;
    else break;
  }

  return { correct, total, streak };
}

<<<<<<< HEAD
async function pickRandomQuestion(args: { section: "MATH" | "RW" | "RANDOM"; sessionId?: string | null }) {
  let query = supabaseServer
    .from("questions")
    .select("id, canonical_id, section, section_code, question_type, stem, options, correct_answer, difficulty, domain, skill, subskill, skill_code, tags, competencies")
    .eq("status", "published")
    .eq("question_type", "multiple_choice")
    .order("created_at", { ascending: false })
    .limit(400);

  if (args.section === "MATH") query = query.eq("section_code", "MATH");
  if (args.section === "RW") query = query.eq("section_code", "RW");
=======
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
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57

  const { data: pool, error } = await query;
  if (error) return { error: `questions_query_failed: ${error.message}` };

  let attemptedIds = new Set<string>();
  if (args.sessionId) {
    const { data: attempts } = await supabaseServer
      .from("answer_attempts")
      .select("question_id")
      .eq("session_id", args.sessionId);
    attemptedIds = new Set((attempts || []).map((a: any) => a.question_id));
  }

<<<<<<< HEAD
  const candidates = (pool || []).map(toSafeQuestion).filter((q): q is SafeQuestionDTO => !!q);
  if (!candidates.length) return { error: "no_valid_questions_available" };
=======
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
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57

  const unattempted = candidates.filter((q) => !attemptedIds.has(q.id));
  const source = unattempted.length ? unattempted : candidates;
  const picked = source[Math.floor(Math.random() * source.length)];
  return { question: picked };
}

<<<<<<< HEAD
router.get("/next", requireSupabaseAuth, checkPracticeLimit({ increment: true }), async (req, res) => {
=======
/**
 * GET /api/practice/next?section=math&mode=balanced
 * - creates/continues practice session
 * - returns next question
 */
router.get("/next", requireSupabaseAuth, checkPracticeLimit({ increment: true, incrementStrategy: "on_success" }), async (req, res) => {
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  const requestId = (req as any).requestId;
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: "Authentication required", requestId });

  const section = normalizeSectionParam(String(req.query.section ?? "random"));

<<<<<<< HEAD
  const { data: existingSession } = await supabaseServer
    .from("practice_sessions")
    .select("id")
=======
  const sectionParam = normalizeSectionParam(String(req.query.section ?? "random"));
  const section: "Math" | "RW" | "Random" =
    sectionParam === "Math" ? "Math" : sectionParam === "RW" ? "RW" : "Random";
  const mode = String(req.query.mode ?? "balanced");

  const clientInstanceId = String(req.query.client_instance_id || "fallback-client");

  // Find existing in_progress session for this user+section+mode (best effort)
  const { data: existingSession } = await supabaseServer
    .from("practice_sessions")
    .select("id, status, metadata")
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
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
    const { data: newSession, error: sessionErr } = await supabaseServer
      .from("practice_sessions")
<<<<<<< HEAD
      .insert({ user_id: userId, section, status: "in_progress", started_at: new Date().toISOString() })
=======
      .insert({
        user_id: userId, // must match users(id) FK in your DB
        section,
        mode,
        status: "in_progress",
        started_at: new Date().toISOString(),
        metadata: { client_instance_id: clientInstanceId },
        updated_at: new Date().toISOString(),
      })
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
      .select("id")
      .single();

    if (sessionErr || !newSession?.id) {
      return res.status(500).json({ error: "session_create_failed", detail: sessionErr?.message, requestId });
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

  const picked = await pickRandomQuestion({ section, sessionId });
  if ("error" in picked) {
    return res.status(500).json({ error: "question_pick_failed", detail: picked.error, requestId });
  }

<<<<<<< HEAD
  await supabaseServer.from("practice_events").insert({
    user_id: userId,
    session_id: sessionId,
    question_id: picked.question.id,
    event_type: "served",
    created_at: new Date().toISOString(),
=======
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
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  });

  const stats = await getSessionStats(sessionId, userId);
  return res.json({ sessionId, question: picked.question, stats });
});

const AnswerBodySchema = z.object({
  sessionId: z.string().uuid(),
  questionId: z.string().uuid(),
  selectedAnswer: z.string().optional().nullable(),
  skipped: z.boolean().optional(),
  elapsedMs: z.number().optional().nullable(),
  idempotencyKey: z.string().max(128).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
});

router.post("/answer", requireSupabaseAuth, practiceAnswerRateLimiter, csrfProtection, async (req, res) => {
  const requestId = (req as any).requestId;
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: "Authentication required", requestId });

  const parsed = AnswerBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues, requestId });

<<<<<<< HEAD
  const { sessionId, questionId, selectedAnswer, skipped, elapsedMs, idempotencyKey } = parsed.data;

  const { data: sessionRow, error: sessionErr } = await supabaseServer.from("practice_sessions").select("id, user_id").eq("id", sessionId).single();
  if (sessionErr || !sessionRow) return res.status(404).json({ error: "session_not_found", requestId });
  if (sessionRow.user_id !== userId) return res.status(403).json({ error: "forbidden", requestId });
=======
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
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57

  const { data: question, error: qErr } = await supabaseServer
    .from("questions")
<<<<<<< HEAD
    .select("id, canonical_id, question_type, correct_answer, explanation")
=======
    .select("id, canonical_id, type, answer_choice, explanation, options")
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
    .eq("id", questionId)
    .single();

  if (qErr || !question) return res.status(404).json({ error: "question_not_found", requestId });
  if (question.question_type !== "multiple_choice") return res.status(422).json({ error: "invalid_question_data", requestId });

<<<<<<< HEAD
  const correctAnswer = normalizeChoice(question.correct_answer);
  if (!correctAnswer) return res.status(422).json({ error: "invalid_question_data", requestId });

  const chosen = skipped ? null : normalizeChoice(selectedAnswer);
  const isCorrect = !!chosen && chosen === correctAnswer;
=======
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
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  const outcome = skipped ? "skipped" : isCorrect ? "correct" : "incorrect";

  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: insErr } = await supabaseServer.from("answer_attempts").insert({
    id: attemptId,
    user_id: userId,
    session_id: sessionId,
    question_id: questionId,
<<<<<<< HEAD
    selected_answer: chosen,
=======
    selected_answer: selectedAnswer ?? null,
    free_response_answer: null,
    chosen: chosenRaw ?? null,
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
    is_correct: isCorrect,
    outcome,
    time_spent_ms: typeof elapsedMs === "number" ? Math.min(Math.max(0, elapsedMs), 30 * 60 * 1000) : null,
    attempted_at: now,
    client_attempt_id: idempotencyKey ?? null,
  });

<<<<<<< HEAD
  if (insErr && !String(insErr.message || "").toLowerCase().includes("duplicate")) {
    return res.status(500).json({ error: "attempt_insert_failed", detail: insErr.message, requestId });
=======
  // If unique(user_id, client_attempt_id) or unique(session_id, question_id) is hit,
  // treat this as an idempotent retry and return the previously stored outcome.
  if (insErr) {
    const duplicateConflict = /duplicate|unique/i.test(String(insErr.message || ""));

    if (duplicateConflict) {
      let existing: { is_correct: boolean | null; outcome: string | null } | null = null;

      if (idempotencyKey) {
        const { data: existingByIdempotency, error: existingByIdempotencyError } = await supabaseServer
          .from("answer_attempts")
          .select("is_correct, outcome")
          .eq("user_id", userId)
          .eq("client_attempt_id", idempotencyKey)
          .maybeSingle();

        if (existingByIdempotencyError) {
          console.warn("[practice] failed to load idempotent retry by key", {
            requestId,
            message: existingByIdempotencyError.message,
            idempotencyKey,
          });
        } else if (existingByIdempotency) {
          existing = existingByIdempotency as { is_correct: boolean | null; outcome: string | null };
        }
      }

      if (!existing) {
        const { data: existingBySessionQuestion, error: existingBySessionQuestionError } = await supabaseServer
          .from("answer_attempts")
          .select("is_correct, outcome")
          .eq("user_id", userId)
          .eq("session_id", sessionId)
          .eq("question_id", questionId)
          .maybeSingle();

        if (existingBySessionQuestionError) {
          console.warn("[practice] failed to load existing attempt after duplicate conflict", {
            requestId,
            message: existingBySessionQuestionError.message,
            sessionId,
            questionId,
          });
        } else if (existingBySessionQuestion) {
          existing = existingBySessionQuestion as { is_correct: boolean | null; outcome: string | null };
        }
      }

      if (!existing) {
        return res.status(409).json({
          error: "duplicate_submission",
          message: "Answer already submitted for this question.",
          requestId,
        });
      }

      return res.json({
        isCorrect: !!existing.is_correct,
        mode: qType,
        correctAnswerKey: correctAnswerKey ?? null,
        explanation,
        feedback: existing.is_correct ? "Correct" : existing.outcome === "skipped" ? "Skipped" : "Incorrect",
        stats: await getSessionStats(sessionId, userId),
        idempotentRetried: true,
      });
    }

    console.error("[practice] answer_attempts insert failed", { requestId, message: insErr.message });
    return res.status(500).json({
      error: "answer_submit_failed",
      message: "Unable to record answer attempt",
      requestId,
    });
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  }

  await supabaseServer.from("practice_events").insert({
    user_id: userId,
    session_id: sessionId,
    question_id: questionId,
    event_type: "answered",
    created_at: now,
    payload: { outcome, isCorrect },
  });

  try {
    const metadata = await getQuestionMetadataForAttempt(questionId);
    if (metadata.canonicalId) {
      await applyMasteryUpdate({
        userId,
        questionCanonicalId: metadata.canonicalId,
        sessionId,
        isCorrect,
<<<<<<< HEAD
        selectedChoice: chosen,
        timeSpentMs: typeof elapsedMs === "number" ? elapsedMs : null,
=======
        selectedChoice: selectedAnswer ?? null,
        timeSpentMs: clampedTimeSpentMs,
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
        eventType: MasteryEventType.PRACTICE_SUBMIT,
        metadata: {
          exam: metadata.exam,
          section: metadata.section,
          domain: metadata.domain,
          skill: metadata.skill,
          subskill: metadata.subskill,
          difficulty: metadata.difficulty,
          skill_code: metadata.skill_code,
          structure_cluster_id: metadata.structure_cluster_id,
        },
      });
    }
  } catch (error: any) {
    console.warn("[practice] mastery logging failed", error?.message);
  }

  const stats = await getSessionStats(sessionId, userId);

  return res.json({
    isCorrect,
    question_type: "multiple_choice",
    correctAnswerKey: correctAnswer,
    explanation: question.explanation || null,
    feedback: isCorrect ? "Correct" : skipped ? "Skipped" : "Incorrect",
    stats,
  });
});

export default router;

<<<<<<< HEAD

=======
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
