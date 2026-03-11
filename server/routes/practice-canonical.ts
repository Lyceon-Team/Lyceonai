import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import crypto from "crypto";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { checkPracticeLimit } from "../middleware/usage-limits";
import { csrfGuard } from "../middleware/csrf";
import { requireSupabaseAuth } from "../middleware/supabase-auth.js";
import { applyMasteryUpdate, getQuestionMetadataForAttempt } from "../../apps/api/src/services/studentMastery";
import { MasteryEventType } from "../../apps/api/src/services/mastery-constants";

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

  const candidates = (pool || []).map(toSafeQuestion).filter((q): q is SafeQuestionDTO => !!q);
  if (!candidates.length) return { error: "no_valid_questions_available" };

  const unattempted = candidates.filter((q) => !attemptedIds.has(q.id));
  const source = unattempted.length ? unattempted : candidates;
  const picked = source[Math.floor(Math.random() * source.length)];
  return { question: picked };
}

router.get("/next", requireSupabaseAuth, checkPracticeLimit({ increment: true }), async (req, res) => {
  const requestId = (req as any).requestId;
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: "Authentication required", requestId });

  const section = normalizeSectionParam(String(req.query.section ?? "random"));

  const { data: existingSession } = await supabaseServer
    .from("practice_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("section", section)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let sessionId = existingSession?.id ?? null;

  if (!sessionId) {
    const { data: newSession, error: sessionErr } = await supabaseServer
      .from("practice_sessions")
      .insert({ user_id: userId, section, status: "in_progress", started_at: new Date().toISOString() })
      .select("id")
      .single();

    if (sessionErr || !newSession?.id) {
      return res.status(500).json({ error: "session_create_failed", detail: sessionErr?.message, requestId });
    }

    sessionId = newSession.id;
  }

  const picked = await pickRandomQuestion({ section, sessionId });
  if ("error" in picked) {
    return res.status(500).json({ error: "question_pick_failed", detail: picked.error, requestId });
  }

  await supabaseServer.from("practice_events").insert({
    user_id: userId,
    session_id: sessionId,
    question_id: picked.question.id,
    event_type: "served",
    created_at: new Date().toISOString(),
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
});

router.post("/answer", requireSupabaseAuth, practiceAnswerRateLimiter, csrfProtection, async (req, res) => {
  const requestId = (req as any).requestId;
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: "Authentication required", requestId });

  const parsed = AnswerBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues, requestId });

  const { sessionId, questionId, selectedAnswer, skipped, elapsedMs, idempotencyKey } = parsed.data;

  const { data: sessionRow, error: sessionErr } = await supabaseServer.from("practice_sessions").select("id, user_id").eq("id", sessionId).single();
  if (sessionErr || !sessionRow) return res.status(404).json({ error: "session_not_found", requestId });
  if (sessionRow.user_id !== userId) return res.status(403).json({ error: "forbidden", requestId });

  const { data: question, error: qErr } = await supabaseServer
    .from("questions")
    .select("id, canonical_id, question_type, correct_answer, explanation")
    .eq("id", questionId)
    .single();

  if (qErr || !question) return res.status(404).json({ error: "question_not_found", requestId });
  if (question.question_type !== "multiple_choice") return res.status(422).json({ error: "invalid_question_data", requestId });

  const correctAnswer = normalizeChoice(question.correct_answer);
  if (!correctAnswer) return res.status(422).json({ error: "invalid_question_data", requestId });

  const chosen = skipped ? null : normalizeChoice(selectedAnswer);
  const isCorrect = !!chosen && chosen === correctAnswer;
  const outcome = skipped ? "skipped" : isCorrect ? "correct" : "incorrect";

  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: insErr } = await supabaseServer.from("answer_attempts").insert({
    id: attemptId,
    user_id: userId,
    session_id: sessionId,
    question_id: questionId,
    selected_answer: chosen,
    is_correct: isCorrect,
    outcome,
    time_spent_ms: typeof elapsedMs === "number" ? Math.min(Math.max(0, elapsedMs), 30 * 60 * 1000) : null,
    attempted_at: now,
    client_attempt_id: idempotencyKey ?? null,
  });

  if (insErr && !String(insErr.message || "").toLowerCase().includes("duplicate")) {
    return res.status(500).json({ error: "attempt_insert_failed", detail: insErr.message, requestId });
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
        selectedChoice: chosen,
        timeSpentMs: typeof elapsedMs === "number" ? elapsedMs : null,
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


