import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { csrfGuard } from "../middleware/csrf";
import { getSupabaseAdmin, requireSupabaseAuth } from "../middleware/supabase-auth.js";
import {
  applyMasteryUpdate,
  getQuestionMetadataForAttempt,
} from "../../apps/api/src/services/studentMastery";
import { MasteryEventType } from "../../apps/api/src/services/mastery-constants";
import {
  hasCanonicalOptionSet,
  hasSingleCanonicalCorrectAnswer,
  isCanonicalPublishedMcQuestion,
  isValidCanonicalId,
  normalizeAnswerKey,
  resolveSectionFilterValues,
} from "../../shared/question-bank-contract";
import {
  checkUsageLimit,
  ensureAccountForUser,
  getAccountIdForUser,
  incrementUsage,
  resolveLinkedPairPremiumAccessForStudent,
} from "../lib/account";

type PracticeLifecycleState = "created" | "active" | "completed" | "abandoned";

type McOption = {
  key: string;
  text: string;
};

type SafeQuestionDTO = {
  id: string;
  section: string;
  stem: string;
  questionType: "multiple_choice";
  options: McOption[];
  difficulty: string | number | null;
  correct_answer: null;
  explanation: null;
};

type SessionRow = {
  id: string;
  user_id: string;
  section: string;
  mode: string;
  status: string;
  completed?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

type SessionItemRow = {
  id: string;
  session_id: string;
  user_id: string;
  question_id: string;
  ordinal: number;
  status: "served" | "answered" | "skipped";
  attempt_id?: string | null;
  client_instance_id?: string | null;
};

type SessionMetadata = {
  client_instance_id?: string;
  lifecycle_state?: PracticeLifecycleState;
  active_session_item_id?: string | null;
  target_question_count?: number;
  session_start_idempotency_key?: string | null;
  last_served_ordinal?: number;
};

type PracticeAccess = {
  allowed: boolean;
  premiumOverride: boolean;
  accountId: string | null;
  current: number;
  limit: number;
  resetAt: string;
  reason?: string;
};

const router = Router();
const csrfProtection = csrfGuard();

const ACTIVE_DB_STATUSES = ["in_progress", "active", "created"] as const;
const TERMINAL_DB_STATUSES = ["completed", "abandoned"] as const;
const DEFAULT_TARGET_QUESTION_COUNT = 20;

const practiceAnswerRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: "rate_limited",
      message: "Too many practice submissions. Please slow down.",
    });
  },
});

const StartSessionBodySchema = z.object({
  section: z.string().optional().nullable(),
  mode: z.string().max(64).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
  target_question_count: z.number().int().positive().max(200).optional().nullable(),
});

const AnswerBodySchema = z.object({
  sessionId: z.string().uuid(),
  sessionItemId: z.string().uuid().optional().nullable(),
  questionId: z.string().uuid(),
  selectedAnswer: z.string().optional().nullable(),
  freeResponseAnswer: z.string().optional().nullable(),
  skipped: z.boolean().optional(),
  elapsedMs: z.number().optional().nullable(),
  idempotencyKey: z.string().max(128).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
});

function asSessionMetadata(metadata: unknown): SessionMetadata {
  if (!metadata || typeof metadata !== "object") return {};
  return metadata as SessionMetadata;
}

function normalizeSessionState(status: string, metadata: SessionMetadata): PracticeLifecycleState {
  const lifecycle = metadata.lifecycle_state;
  if (lifecycle === "created" || lifecycle === "active" || lifecycle === "completed" || lifecycle === "abandoned") {
    return lifecycle;
  }
  if (status === "completed") return "completed";
  if (status === "abandoned") return "abandoned";
  if (status === "created") return "created";
  return "active";
}

function normalizeSectionParam(section?: string | null): "Math" | "RW" | "Random" {
  if (!section) return "Random";
  const s = section.trim().toLowerCase();
  if (s === "math") return "Math";
  if (s === "rw" || s === "reading_writing" || s === "reading" || s === "writing") return "RW";
  if (s === "random") return "Random";
  return "Random";
}

function safeParseOptions(raw: unknown): McOption[] {
  let value: unknown = raw;

  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) return [];

  const options: McOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const key = typeof (item as any).key === "string" ? (item as any).key.trim() : "";
    const text = typeof (item as any).text === "string" ? (item as any).text : "";
    if (!key || !text) continue;
    options.push({ key, text });
  }

  return options;
}

function isValidMcQuestion(row: any): boolean {
  const options = safeParseOptions(row?.options);
  if (!hasCanonicalOptionSet(options)) return false;
  return hasSingleCanonicalCorrectAnswer(row?.correct_answer, options);
}

function toSafeQuestionDTO(q: any): SafeQuestionDTO {
  return {
    id: q.id,
    section: q.section,
    stem: q.stem,
    questionType: "multiple_choice",
    options: safeParseOptions(q.options),
    difficulty: q.difficulty ?? null,
    correct_answer: null,
    explanation: null,
  };
}

function simpleHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash);
}

function coerceQuestionDifficulty(raw: unknown): 1 | 2 | 3 {
  if (typeof raw === "number") {
    if (raw <= 1) return 1;
    if (raw >= 3) return 3;
    return 2;
  }
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "easy" || s === "1") return 1;
    if (s === "hard" || s === "3") return 3;
  }
  return 2;
}

function coerceTargetQuestionCount(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const rounded = Math.floor(raw);
    if (rounded > 0) return Math.min(200, rounded);
  }
  return DEFAULT_TARGET_QUESTION_COUNT;
}

function getClientInstanceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isDuplicateConflict(message: string | undefined): boolean {
  return /duplicate|unique/i.test(String(message || ""));
}

function sendPracticeLimitDenied(res: Response, access: PracticeAccess, requestId: string | undefined) {
  return res.status(402).json({
    error: "Usage limit reached",
    code: "LIMIT_REACHED",
    limitType: "practice",
    current: access.current,
    limit: access.limit,
    resetAt: access.resetAt,
    message: "You've reached your daily practice question limit. Upgrade to unlock unlimited access.",
    requestId,
  });
}

function sendClientConflict(res: Response, requestId: string | undefined, clientInstanceId: string, message?: string) {
  return res.status(409).json({
    error: "conflict",
    message: message ?? "Session is owned by another active client instance.",
    client_instance_id: clientInstanceId,
    requestId,
  });
}

async function resolvePracticeAccess(userId: string, role: string | undefined): Promise<PracticeAccess> {
  if (role === "admin") {
    return {
      allowed: true,
      premiumOverride: true,
      accountId: null,
      current: 0,
      limit: Number.POSITIVE_INFINITY,
      resetAt: "",
    };
  }

  if (role !== "student") {
    return {
      allowed: false,
      premiumOverride: false,
      accountId: null,
      current: 0,
      limit: 0,
      resetAt: "",
      reason: "role_not_allowed",
    };
  }

  const supabaseAdmin = getSupabaseAdmin();
  let accountId = await getAccountIdForUser(userId);
  if (!accountId) {
    accountId = await ensureAccountForUser(supabaseAdmin, userId, "student");
  }

  if (!accountId) {
    return {
      allowed: false,
      premiumOverride: false,
      accountId: null,
      current: 0,
      limit: 0,
      resetAt: "",
      reason: "missing_account",
    };
  }

  const premiumAccess = await resolveLinkedPairPremiumAccessForStudent(userId);
  const premiumOverride = premiumAccess.hasPremiumAccess;
  const usage = await checkUsageLimit(accountId, "practice", { premiumOverride });

  return {
    allowed: usage.allowed,
    premiumOverride,
    accountId,
    current: Number.isFinite(usage.current) ? usage.current : 0,
    limit: Number.isFinite(usage.limit) ? usage.limit : Number.POSITIVE_INFINITY,
    resetAt: usage.resetAt,
  };
}

async function getSessionStats(sessionId: string, userId: string): Promise<{
  correct: number;
  incorrect: number;
  skipped: number;
  total: number;
  streak: number;
}> {
  const { data, error } = await supabaseServer
    .from("answer_attempts")
    .select("is_correct, outcome, attempted_at")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("attempted_at", { ascending: false });

  if (error) {
    return { correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0 };
  }

  const attempts = data ?? [];
  const correct = attempts.filter((a: any) => a.is_correct === true).length;
  const skipped = attempts.filter((a: any) => a.outcome === "skipped").length;
  const total = attempts.length;
  const incorrect = Math.max(0, total - correct - skipped);

  let streak = 0;
  for (const a of attempts) {
    if ((a as any).outcome === "skipped") continue;
    if ((a as any).is_correct) {
      streak++;
      continue;
    }
    break;
  }

  return { correct, incorrect, skipped, total, streak };
}

async function fetchQuestionForServing(questionId: string): Promise<SafeQuestionDTO | null> {
  const { data, error } = await supabaseServer
    .from("questions")
    .select("id, canonical_id, status, section, section_code, stem, question_type, options, difficulty, correct_answer")
    .eq("id", questionId)
    .eq("status", "published")
    .eq("question_type", "multiple_choice")
    .single();

  if (error || !data) return null;
  if (!isCanonicalPublishedMcQuestion(data as any)) return null;

  return toSafeQuestionDTO(data);
}

async function getCurrentUnansweredItem(sessionId: string): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("id, session_id, user_id, question_id, ordinal, status, attempt_id, client_instance_id")
    .eq("session_id", sessionId)
    .eq("status", "served")
    .order("ordinal", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`practice_session_items_unanswered_failed: ${error.message}`);
  }

  return (data as SessionItemRow | null) ?? null;
}

async function getLatestSessionItem(sessionId: string): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("id, session_id, user_id, question_id, ordinal, status, attempt_id, client_instance_id")
    .eq("session_id", sessionId)
    .order("ordinal", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`practice_session_items_latest_failed: ${error.message}`);
  }

  return (data as SessionItemRow | null) ?? null;
}

async function listSessionQuestionIds(sessionId: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("question_id")
    .eq("session_id", sessionId);

  if (error) {
    throw new Error(`practice_session_items_list_failed: ${error.message}`);
  }

  return (data ?? [])
    .map((row: any) => row.question_id)
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
}

async function countResolvedSessionItems(sessionId: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from("practice_session_items")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .in("status", ["answered", "skipped"]);

  if (error) {
    throw new Error(`practice_session_items_count_failed: ${error.message}`);
  }

  return Number.isFinite(count as number) ? Number(count) : 0;
}

async function pickDeterministicQuestion(args: {
  section: "Math" | "RW" | "Random";
  userId: string;
  sessionId: string;
  nextOrdinal: number;
  excludedQuestionIds: string[];
}): Promise<{ question: SafeQuestionDTO } | { error: string }> {
    let query = supabaseServer
    .from("questions")
    .select("id, canonical_id, status, section, section_code, stem, question_type, options, difficulty, correct_answer, domain, skill")
    .eq("status", "published")
    .eq("question_type", "multiple_choice")
    .limit(500);

  if (args.section === "Math") {
    query = query.in("section_code", resolveSectionFilterValues("math") ?? ["M", "MATH"]);
  } else if (args.section === "RW") {
    query = query.in("section_code", resolveSectionFilterValues("rw") ?? ["RW"]);
  }

  const { data: pool, error } = await query;
  if (error) {
    return { error: `questions_query_failed: ${error.message}` };
  }

  const validPool = (pool ?? []).filter((row: any) => isCanonicalPublishedMcQuestion(row as any));

  if (validPool.length === 0) {
    return { error: "no_valid_questions_available" };
  }

  const excluded = new Set(args.excludedQuestionIds);
  const candidatePool = validPool.filter((row: any) => !excluded.has(row.id));
  const usablePool = candidatePool.length > 0 ? candidatePool : validPool;

  const { data: recentAttempts, error: recentError } = await supabaseServer
    .from("answer_attempts")
    .select("question_id")
    .eq("user_id", args.userId)
    .order("attempted_at", { ascending: false })
    .limit(200);

  if (recentError) {
    return { error: `recent_attempts_query_failed: ${recentError.message}` };
  }

  const recentSet = new Set(
    (recentAttempts ?? [])
      .map((row: any) => row.question_id)
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
  );

  const nonRecentPool = usablePool.filter((row: any) => !recentSet.has(row.id));
  const recencyPool = nonRecentPool.length > 0 ? nonRecentPool : usablePool;

  const { data: masteryRows, error: masteryError } = await supabaseServer
    .from("student_skill_mastery")
    .select("section, domain, skill, mastery_score, attempts")
    .eq("user_id", args.userId)
    .limit(500);

  if (masteryError) {
    return { error: `mastery_query_failed: ${masteryError.message}` };
  }

  const masteryMap = new Map<string, number>();
  const sectionTarget = args.section === "Math" ? "math" : "rw";

  for (const row of masteryRows ?? []) {
    const attempts = Number((row as any).attempts ?? 0);
    if (!(attempts > 0)) continue;

    const sectionRaw = String((row as any).section ?? "").toLowerCase();
    const sectionMatches = sectionTarget === "math"
      ? sectionRaw.includes("math")
      : sectionRaw.includes("rw") || sectionRaw.includes("read") || sectionRaw.includes("write");

    if (!sectionMatches) continue;

    const domain = String((row as any).domain ?? "").trim();
    const skill = String((row as any).skill ?? "").trim();
    if (!domain || !skill) continue;

    const masteryScoreRaw = Number((row as any).mastery_score ?? 0.5);
    const masteryScore = Number.isFinite(masteryScoreRaw) ? Math.max(0, Math.min(1, masteryScoreRaw)) : 0.5;
    masteryMap.set(`${domain.toLowerCase()}|${skill.toLowerCase()}`, masteryScore);
  }

  const hasMastery = masteryMap.size > 0;

  let targetDifficulty: 1 | 2 | 3;
  if (hasMastery) {
    const scores = [...masteryMap.values()];
    const avgMastery = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    if (avgMastery < 0.45) targetDifficulty = 1;
    else if (avgMastery > 0.75) targetDifficulty = 3;
    else targetDifficulty = 2;
  } else {
    targetDifficulty = ((simpleHash(`${args.sessionId}:${args.nextOrdinal}`) % 3) + 1) as 1 | 2 | 3;
  }

  const ranked = recencyPool.map((row: any) => {
    const domain = String(row.domain ?? "").trim().toLowerCase();
    const skill = String(row.skill ?? "").trim().toLowerCase();
    const masteryScore = masteryMap.get(`${domain}|${skill}`);
    const difficulty = coerceQuestionDifficulty(row.difficulty);

    return {
      row,
      masteryScore: typeof masteryScore === "number" ? masteryScore : 0.5,
      difficultyPenalty: Math.abs(difficulty - targetDifficulty),
      tieBreaker: simpleHash(`${args.sessionId}:${args.nextOrdinal}:${row.canonical_id || row.id}`),
      canonicalId: String(row.canonical_id || row.id),
    };
  });

  ranked.sort((a, b) => {
    if (hasMastery && a.masteryScore !== b.masteryScore) {
      return a.masteryScore - b.masteryScore;
    }
    if (a.difficultyPenalty !== b.difficultyPenalty) {
      return a.difficultyPenalty - b.difficultyPenalty;
    }
    if (!hasMastery && a.tieBreaker !== b.tieBreaker) {
      return a.tieBreaker - b.tieBreaker;
    }
    if (a.canonicalId !== b.canonicalId) {
      return a.canonicalId.localeCompare(b.canonicalId);
    }
    return String(a.row.id).localeCompare(String(b.row.id));
  });

  const chosen = ranked[0]?.row;
  if (!chosen) {
    return { error: "no_questions_available_after_ranking" };
  }

  return { question: toSafeQuestionDTO(chosen) };
}

async function updateSessionLifecycle(sessionId: string, metadata: SessionMetadata, patch?: Record<string, unknown>) {
  const nextUpdate: Record<string, unknown> = {
    metadata,
    updated_at: new Date().toISOString(),
    ...(patch ?? {}),
  };

  const { error } = await supabaseServer
    .from("practice_sessions")
    .update(nextUpdate)
    .eq("id", sessionId);

  if (error) {
    throw new Error(`practice_sessions_update_failed: ${error.message}`);
  }
}

async function startOrReplaySession(args: {
  userId: string;
  role: string | undefined;
  section: "Math" | "RW" | "Random";
  mode: string;
  clientInstanceId: string;
  idempotencyKey: string | null;
  targetQuestionCount: number;
}): Promise<
  | {
    ok: true;
    session: SessionRow;
    metadata: SessionMetadata;
    replayed: boolean;
  }
  | {
    ok: false;
    status: number;
    body: Record<string, unknown>;
  }
> {
  const { data: openSessions, error: openErr } = await supabaseServer
    .from("practice_sessions")
    .select("id, user_id, section, mode, status, completed, metadata")
    .eq("user_id", args.userId)
    .eq("section", args.section)
    .eq("mode", args.mode)
    .in("status", [...ACTIVE_DB_STATUSES])
    .order("started_at", { ascending: false })
    .limit(5);

  if (openErr) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_lookup_failed",
        message: openErr.message,
      },
    };
  }

  const sessions = (openSessions ?? []) as SessionRow[];
  let replay: SessionRow | null = null;

  if (args.idempotencyKey) {
    replay = sessions.find((candidate) => {
      const metadata = asSessionMetadata(candidate.metadata);
      return metadata.session_start_idempotency_key === args.idempotencyKey;
    }) ?? null;
  }

  if (!replay && sessions.length > 0) {
    replay = sessions[0];
  }

  if (replay) {
    const replayMeta = asSessionMetadata(replay.metadata);
    const boundClient = getClientInstanceId(replayMeta.client_instance_id);

    if (boundClient && boundClient !== args.clientInstanceId) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "conflict",
          message: "Session is already bound to another client instance.",
          client_instance_id: args.clientInstanceId,
        },
      };
    }

    replayMeta.client_instance_id = args.clientInstanceId;
    replayMeta.target_question_count = coerceTargetQuestionCount(replayMeta.target_question_count ?? args.targetQuestionCount);

    if (args.idempotencyKey) {
      replayMeta.session_start_idempotency_key = args.idempotencyKey;
    }

    await updateSessionLifecycle(replay.id, replayMeta, {
      status: replay.status === "created" ? "in_progress" : replay.status,
    });

    return {
      ok: true,
      session: {
        ...replay,
        metadata: replayMeta,
      },
      metadata: replayMeta,
      replayed: true,
    };
  }

  const access = await resolvePracticeAccess(args.userId, args.role);
  if (!access.allowed) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "Usage limit reached",
        code: "LIMIT_REACHED",
        limitType: "practice",
        current: access.current,
        limit: access.limit,
        resetAt: access.resetAt,
        message: "You've reached your daily practice question limit. Upgrade to unlock unlimited access.",
      },
    };
  }

  const sessionMetadata: SessionMetadata = {
    client_instance_id: args.clientInstanceId,
    lifecycle_state: "created",
    active_session_item_id: null,
    target_question_count: coerceTargetQuestionCount(args.targetQuestionCount),
    session_start_idempotency_key: args.idempotencyKey,
  };

  const { data: newSession, error: createErr } = await supabaseServer
    .from("practice_sessions")
    .insert({
      user_id: args.userId,
      section: args.section,
      mode: args.mode,
      status: "in_progress",
      completed: false,
      started_at: new Date().toISOString(),
      metadata: sessionMetadata,
      updated_at: new Date().toISOString(),
    })
    .select("id, user_id, section, mode, status, completed, metadata")
    .single();

  if (createErr || !newSession) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_create_failed",
        message: createErr?.message ?? "Unable to create practice session",
      },
    };
  }

  return {
    ok: true,
    session: newSession as SessionRow,
    metadata: asSessionMetadata(newSession.metadata),
    replayed: false,
  };
}

async function loadOwnedSession(sessionId: string, userId: string): Promise<SessionRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_sessions")
    .select("id, user_id, section, mode, status, completed, metadata")
    .eq("id", sessionId)
    .single();

  if (error || !data) return null;
  if ((data as any).user_id !== userId) return null;
  return data as SessionRow;
}

async function findSessionItemById(sessionId: string, sessionItemId: string): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("id, session_id, user_id, question_id, ordinal, status, attempt_id, client_instance_id")
    .eq("session_id", sessionId)
    .eq("id", sessionItemId)
    .maybeSingle();

  if (error) {
    throw new Error(`practice_session_item_lookup_failed: ${error.message}`);
  }

  return (data as SessionItemRow | null) ?? null;
}

async function findLatestSessionItemByQuestion(sessionId: string, questionId: string): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("id, session_id, user_id, question_id, ordinal, status, attempt_id, client_instance_id")
    .eq("session_id", sessionId)
    .eq("question_id", questionId)
    .order("ordinal", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`practice_session_item_by_question_failed: ${error.message}`);
  }

  return (data as SessionItemRow | null) ?? null;
}

async function findAttemptBySessionItemId(sessionItemId: string): Promise<any | null> {
  const { data, error } = await supabaseServer
    .from("answer_attempts")
    .select("id, session_id, question_id, session_item_id, is_correct, outcome")
    .eq("session_item_id", sessionItemId)
    .maybeSingle();

  if (error) {
    if (/session_item_id/i.test(String(error.message || ""))) return null;
    throw new Error(`attempt_lookup_by_session_item_failed: ${error.message}`);
  }

  return data ?? null;
}

async function findExistingAttempt(args: {
  userId: string;
  sessionId: string;
  questionId: string;
  sessionItemId: string | null;
  idempotencyKey: string | null;
}): Promise<any | null> {
  if (args.idempotencyKey) {
    const { data, error } = await supabaseServer
      .from("answer_attempts")
      .select("id, session_id, question_id, session_item_id, is_correct, outcome")
      .eq("user_id", args.userId)
      .eq("client_attempt_id", args.idempotencyKey)
      .maybeSingle();

    if (!error && data) return data;
  }

  if (args.sessionItemId) {
    const bySessionItem = await findAttemptBySessionItemId(args.sessionItemId);
    if (bySessionItem) return bySessionItem;
  }

  const { data, error } = await supabaseServer
    .from("answer_attempts")
    .select("id, session_id, question_id, session_item_id, is_correct, outcome")
    .eq("user_id", args.userId)
    .eq("session_id", args.sessionId)
    .eq("question_id", args.questionId)
    .maybeSingle();

  if (error) {
    throw new Error(`attempt_lookup_by_session_question_failed: ${error.message}`);
  }

  return data ?? null;
}

async function insertAnswerAttempt(insertPayload: Record<string, unknown>): Promise<{ error: any }> {
  const { error } = await supabaseServer.from("answer_attempts").insert(insertPayload);
  if (!error) return { error: null };

  if (/session_item_id/i.test(String(error.message || ""))) {
    const fallbackPayload = { ...insertPayload };
    delete (fallbackPayload as any).session_item_id;
    const retry = await supabaseServer.from("answer_attempts").insert(fallbackPayload);
    return { error: retry.error };
  }

  return { error };
}

async function serveNextForSession(args: {
  req: Request;
  res: Response;
  userId: string;
  role: string | undefined;
  sessionId: string;
  clientInstanceId: string;
}): Promise<Response> {
  const requestId = (args.req as any).requestId;

  const session = await loadOwnedSession(args.sessionId, args.userId);
  if (!session) {
    return args.res.status(404).json({
      error: "session_not_found",
      message: "Practice session not found",
      requestId,
    });
  }

  const metadata = asSessionMetadata(session.metadata);
  const sessionState = normalizeSessionState(session.status, metadata);

  if (sessionState === "completed" || sessionState === "abandoned" || TERMINAL_DB_STATUSES.includes(session.status as any)) {
    return args.res.status(409).json({
      error: "session_closed",
      message: "Practice session is read-only",
      requestId,
    });
  }

  const boundClient = getClientInstanceId(metadata.client_instance_id);
  if (boundClient && boundClient !== args.clientInstanceId) {
    return sendClientConflict(args.res, requestId, args.clientInstanceId);
  }

  metadata.client_instance_id = args.clientInstanceId;

  const unresolved = await getCurrentUnansweredItem(args.sessionId);
  if (unresolved) {
    const safeQuestion = await fetchQuestionForServing(unresolved.question_id);
    if (!safeQuestion) {
      return args.res.status(422).json({
        error: "invalid_question_data",
        message: "Unable to resume the current question due to invalid canonical data.",
        requestId,
      });
    }

    metadata.lifecycle_state = "active";
    metadata.active_session_item_id = unresolved.id;
    metadata.last_served_ordinal = unresolved.ordinal;

    await updateSessionLifecycle(args.sessionId, metadata, {
      status: "in_progress",
    });

    return args.res.json({
      sessionId: session.id,
      sessionItemId: unresolved.id,
      ordinal: unresolved.ordinal,
      state: "active",
      question: safeQuestion,
      stats: await getSessionStats(args.sessionId, args.userId),
    });
  }

  const access = await resolvePracticeAccess(args.userId, args.role);
  if (!access.allowed) {
    return sendPracticeLimitDenied(args.res, access, requestId);
  }

  const latestItem = await getLatestSessionItem(args.sessionId);
  const nextOrdinal = (latestItem?.ordinal ?? 0) + 1;
  const excludedQuestionIds = await listSessionQuestionIds(args.sessionId);

  const picked = await pickDeterministicQuestion({
    section: normalizeSectionParam(session.section),
    userId: args.userId,
    sessionId: args.sessionId,
    nextOrdinal,
    excludedQuestionIds,
  });

  if ("error" in picked) {
    return args.res.status(500).json({
      error: "question_pick_failed",
      message: picked.error,
      requestId,
    });
  }

  const now = new Date().toISOString();
  const newSessionItemId = crypto.randomUUID();

  const { data: insertedItem, error: insertErr } = await supabaseServer
    .from("practice_session_items")
    .insert({
      id: newSessionItemId,
      session_id: args.sessionId,
      user_id: args.userId,
      question_id: picked.question.id,
      ordinal: nextOrdinal,
      status: "served",
      attempt_id: null,
      client_instance_id: args.clientInstanceId,
      created_at: now,
      updated_at: now,
    })
    .select("id, session_id, user_id, question_id, ordinal, status, attempt_id, client_instance_id")
    .single();

  if (insertErr || !insertedItem) {
    if (isDuplicateConflict(insertErr?.message)) {
      const deduped = await getCurrentUnansweredItem(args.sessionId);
      if (deduped) {
        const question = await fetchQuestionForServing(deduped.question_id);
        if (!question) {
          return args.res.status(422).json({
            error: "invalid_question_data",
            message: "Unable to load deduplicated unanswered item.",
            requestId,
          });
        }

        return args.res.json({
          sessionId: session.id,
          sessionItemId: deduped.id,
          ordinal: deduped.ordinal,
          state: "active",
          question,
          stats: await getSessionStats(args.sessionId, args.userId),
          deduplicated: true,
        });
      }
    }

    return args.res.status(500).json({
      error: "session_item_create_failed",
      message: insertErr?.message ?? "Unable to create canonical session item",
      requestId,
    });
  }

  metadata.lifecycle_state = "active";
  metadata.active_session_item_id = insertedItem.id;
  metadata.last_served_ordinal = insertedItem.ordinal;

  await updateSessionLifecycle(args.sessionId, metadata, {
    status: "in_progress",
  });

  try {
    await supabaseServer
      .from("practice_events")
      .insert({
        user_id: args.userId,
        session_id: args.sessionId,
        question_id: picked.question.id,
        event_type: "served",
        created_at: now,
        payload: {
          session_item_id: insertedItem.id,
          ordinal: insertedItem.ordinal,
        },
      });
  } catch {
    // non-blocking
  }

  if (access.accountId && !access.premiumOverride) {
    try {
      await incrementUsage(access.accountId, "practice");
    } catch (usageErr: any) {
      console.warn("[practice] usage increment failed", {
        requestId,
        message: usageErr?.message,
        accountId: access.accountId,
      });
    }
  }

  return args.res.json({
    sessionId: session.id,
    sessionItemId: insertedItem.id,
    ordinal: insertedItem.ordinal,
    state: "active",
    question: picked.question,
    stats: await getSessionStats(args.sessionId, args.userId),
  });
}

router.post("/sessions", requireSupabaseAuth, csrfProtection, async (req, res) => {
  const requestId = (req as any).requestId;
  const user = (req as any).user;
  const userId = user?.id;

  if (!userId) {
    return res.status(401).json({
      error: "Authentication required",
      message: "You must be signed in",
      requestId,
    });
  }

  const parsed = StartSessionBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_payload",
      issues: parsed.error.issues,
      requestId,
    });
  }

  const section = normalizeSectionParam(parsed.data.section);
  const mode = String(parsed.data.mode ?? "balanced").trim() || "balanced";
  const idempotencyKey = parsed.data.idempotency_key?.trim() || null;
  const targetQuestionCount = coerceTargetQuestionCount(parsed.data.target_question_count);
  const clientInstanceId = parsed.data.client_instance_id?.trim() || `server-${crypto.randomUUID()}`;

  const sessionResult = await startOrReplaySession({
    userId,
    role: user?.role,
    section,
    mode,
    clientInstanceId,
    idempotencyKey,
    targetQuestionCount,
  });

  if (sessionResult.ok === false) {
    return res.status(sessionResult.status).json({
      ...sessionResult.body,
      requestId,
    });
  }

  const state = normalizeSessionState(sessionResult.session.status, sessionResult.metadata);

  return res.json({
    id: sessionResult.session.id,
    sessionId: sessionResult.session.id,
    userId,
    section: sessionResult.session.section,
    mode: sessionResult.session.mode,
    state,
    replayed: sessionResult.replayed,
    clientInstanceId,
    targetQuestionCount: coerceTargetQuestionCount(sessionResult.metadata.target_question_count),
  });
});

router.get("/sessions/:sessionId/next", requireSupabaseAuth, async (req, res) => {
  const requestId = (req as any).requestId;
  const user = (req as any).user;
  const userId = user?.id;

  if (!userId) {
    return res.status(401).json({
      error: "Authentication required",
      message: "You must be signed in",
      requestId,
    });
  }

  const sessionId = String(req.params.sessionId || "").trim();
  const clientInstanceId = getClientInstanceId(req.query.client_instance_id);

  if (!sessionId) {
    return res.status(400).json({
      error: "invalid_session_id",
      message: "sessionId is required",
      requestId,
    });
  }

  if (!clientInstanceId) {
    return res.status(400).json({
      error: "missing_client_instance_id",
      message: "client_instance_id is required",
      requestId,
    });
  }

  return serveNextForSession({
    req,
    res,
    userId,
    role: user?.role,
    sessionId,
    clientInstanceId,
  });
});

router.get("/sessions/:sessionId/state", requireSupabaseAuth, async (req, res) => {
  const requestId = (req as any).requestId;
  const user = (req as any).user;
  const userId = user?.id;

  if (!userId) {
    return res.status(401).json({
      error: "Authentication required",
      message: "You must be signed in",
      requestId,
    });
  }

  const sessionId = String(req.params.sessionId || "").trim();
  if (!sessionId) {
    return res.status(400).json({
      error: "invalid_session_id",
      message: "sessionId is required",
      requestId,
    });
  }

  const session = await loadOwnedSession(sessionId, userId);
  if (!session) {
    return res.status(404).json({
      error: "session_not_found",
      message: "Practice session not found",
      requestId,
    });
  }

  const metadata = asSessionMetadata(session.metadata);
  const queryClientInstanceId = getClientInstanceId(req.query.client_instance_id);
  const boundClient = getClientInstanceId(metadata.client_instance_id);

  if (queryClientInstanceId && boundClient && queryClientInstanceId !== boundClient) {
    return sendClientConflict(res, requestId, queryClientInstanceId);
  }

  const latestItem = await getLatestSessionItem(sessionId);
  const unresolved = await getCurrentUnansweredItem(sessionId);
  const resolvedCount = await countResolvedSessionItems(sessionId);
  const targetQuestionCount = coerceTargetQuestionCount(metadata.target_question_count);
  const state = normalizeSessionState(session.status, metadata);

  return res.json({
    sessionId: session.id,
    state,
    currentOrdinal: latestItem?.ordinal ?? 0,
    answeredCount: resolvedCount,
    targetQuestionCount,
    lastServedUnansweredItem: unresolved
      ? {
          sessionItemId: unresolved.id,
          questionId: unresolved.question_id,
          ordinal: unresolved.ordinal,
        }
      : null,
    clientInstanceId: boundClient ?? null,
    readOnly: state === "completed" || state === "abandoned",
  });
});

router.get("/next", requireSupabaseAuth, async (req, res) => {
  const requestId = (req as any).requestId;
  const user = (req as any).user;
  const userId = user?.id;

  if (!userId) {
    return res.status(401).json({
      error: "Authentication required",
      message: "You must be signed in",
      requestId,
    });
  }

  const section = normalizeSectionParam(String(req.query.section ?? "random"));
  const mode = String(req.query.mode ?? "balanced").trim() || "balanced";
  const querySessionId = String(req.query.session_id ?? req.query.sessionId ?? "").trim();
  const clientInstanceId = getClientInstanceId(req.query.client_instance_id);

  if (!clientInstanceId) {
    return res.status(400).json({
      error: "missing_client_instance_id",
      message: "client_instance_id is required",
      requestId,
    });
  }

  let sessionId = querySessionId;

  if (!sessionId) {
    const started = await startOrReplaySession({
      userId,
      role: user?.role,
      section,
      mode,
      clientInstanceId,
      idempotencyKey: null,
      targetQuestionCount: DEFAULT_TARGET_QUESTION_COUNT,
    });

    if (started.ok === false) {
      return res.status(started.status).json({
        ...started.body,
        requestId,
      });
    }

    sessionId = started.session.id;
  }

  return serveNextForSession({
    req,
    res,
    userId,
    role: user?.role,
    sessionId,
    clientInstanceId,
  });
});

export async function submitPracticeAnswer(req: Request, res: Response) {
  const requestId = (req as any).requestId;
  const user = (req as any).user;
  const userId = user?.id;

  if (!userId) {
    return res.status(401).json({
      error: "Authentication required",
      message: "You must be signed in",
      requestId,
    });
  }

  const parsed = AnswerBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_payload",
      issues: parsed.error.issues,
      requestId,
    });
  }

  const {
    sessionId,
    sessionItemId,
    questionId,
    selectedAnswer,
    skipped,
    elapsedMs,
    idempotencyKey,
    client_instance_id,
  } = parsed.data;

  const clientInstanceId = getClientInstanceId(client_instance_id);
  if (!clientInstanceId) {
    return res.status(400).json({
      error: "missing_client_instance_id",
      message: "client_instance_id is required",
      requestId,
    });
  }

  const session = await loadOwnedSession(sessionId, userId);
  if (!session) {
    return res.status(404).json({
      error: "session_not_found",
      message: "Practice session not found",
      requestId,
    });
  }

  const sessionMeta = asSessionMetadata(session.metadata);
  const sessionState = normalizeSessionState(session.status, sessionMeta);

  if (sessionState === "completed" || sessionState === "abandoned" || TERMINAL_DB_STATUSES.includes(session.status as any)) {
    return res.status(409).json({
      error: "session_closed",
      message: "Practice session is read-only",
      requestId,
    });
  }

  const boundClient = getClientInstanceId(sessionMeta.client_instance_id);
  if (boundClient && boundClient !== clientInstanceId) {
    return sendClientConflict(res, requestId, clientInstanceId, "Session was taken over by another tab.");
  }

  let servedItem: SessionItemRow | null = null;
  if (sessionItemId) {
    servedItem = await findSessionItemById(sessionId, sessionItemId);
  } else {
    servedItem = await findLatestSessionItemByQuestion(sessionId, questionId);
  }

  if (!servedItem) {
    return res.status(409).json({
      error: "session_item_not_found",
      message: "No served practice item was found for this answer submission.",
      requestId,
    });
  }

  if (servedItem.question_id !== questionId) {
    return res.status(409).json({
      error: "session_item_mismatch",
      message: "Submitted question does not match the served session item.",
      requestId,
    });
  }

  const { data: qRow, error: qErr } = await supabaseServer
    .from("questions")
    .select("id, canonical_id, status, section, section_code, question_type, stem, correct_answer, explanation, options")
    .eq("id", questionId)
    .eq("status", "published")
    .eq("question_type", "multiple_choice")
    .single();

  if (qErr || !qRow) {
    return res.status(404).json({
      error: "question_not_found",
      message: qErr?.message ?? "Not found",
      requestId,
    });
  }

  if (!isValidCanonicalId(String(qRow.canonical_id || ""))) {
    return res.status(422).json({
      error: "invalid_question_data",
      message: "Question canonical ID is invalid.",
      requestId,
    });
  }

  if (qRow.question_type !== "multiple_choice") {
    return res.status(422).json({
      error: "invalid_question_data",
      message: "Only MC questions are supported in canonical practice.",
      requestId,
    });
  }

  const parsedOptions = safeParseOptions(qRow.options);
  if (!hasCanonicalOptionSet(parsedOptions) || !hasSingleCanonicalCorrectAnswer(qRow.correct_answer, parsedOptions)) {
    return res.status(422).json({
      error: "invalid_question_data",
      message: "This question has invalid MC schema and cannot be graded.",
      requestId,
    });
  }

  const correctAnswerKey = normalizeAnswerKey(qRow.correct_answer);
  const explanation = typeof qRow.explanation === "string" && qRow.explanation.trim().length > 0
    ? qRow.explanation
    : null;

  if (!correctAnswerKey) {
    return res.status(422).json({
      error: "invalid_question_data",
      message: "This question is missing an answer key and cannot be graded.",
      requestId,
    });
  }

  const existingAttempt = await findExistingAttempt({
    userId,
    sessionId,
    questionId,
    sessionItemId: servedItem.id,
    idempotencyKey: idempotencyKey?.trim() || null,
  });

  if (existingAttempt) {
    if (existingAttempt.session_id !== sessionId || existingAttempt.question_id !== questionId) {
      return res.status(409).json({
        error: "idempotency_key_reuse",
        message: "The provided idempotency key is already bound to a different attempt.",
        requestId,
      });
    }

    return res.json({
      sessionId,
      sessionItemId: servedItem.id,
      isCorrect: !!existingAttempt.is_correct,
      mode: "multiple_choice",
      correctAnswerKey,
      explanation,
      feedback: existingAttempt.is_correct ? "Correct" : existingAttempt.outcome === "skipped" ? "Skipped" : "Incorrect",
      stats: await getSessionStats(sessionId, userId),
      idempotentRetried: true,
    });
  }

  if (servedItem.status !== "served") {
    return res.status(409).json({
      error: "session_item_not_open",
      message: "This practice item is already resolved.",
      requestId,
    });
  }

  const isSkipped = skipped === true;
  const allowedKeys = new Set(parsedOptions.map((opt) => normalizeAnswerKey(opt.key)).filter(Boolean));

  if (!isSkipped) {
    const selected = normalizeAnswerKey(selectedAnswer ?? null);
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

  const chosenRaw = isSkipped ? null : selectedAnswer ?? null;
  const chosen = normalizeAnswerKey(chosenRaw);
  const isCorrect = !isSkipped && !!chosen && chosen === correctAnswerKey;
  const outcome = isSkipped ? "skipped" : isCorrect ? "correct" : "incorrect";

  const clampedTimeSpentMs = typeof elapsedMs === "number"
    ? Math.min(Math.max(0, elapsedMs), 30 * 60 * 1000)
    : null;

  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();

  const insertPayload: Record<string, unknown> = {
    id: attemptId,
    user_id: userId,
    session_id: sessionId,
    session_item_id: servedItem.id,
    question_id: questionId,
    selected_answer: selectedAnswer ?? null,
    free_response_answer: null,
    chosen: chosenRaw ?? null,
    is_correct: isCorrect,
    outcome,
    time_spent_ms: clampedTimeSpentMs,
    attempted_at: now,
    client_attempt_id: idempotencyKey ?? null,
  };

  const insertResult = await insertAnswerAttempt(insertPayload);
  if (insertResult.error) {
    if (isDuplicateConflict(insertResult.error.message)) {
      const duplicate = await findExistingAttempt({
        userId,
        sessionId,
        questionId,
        sessionItemId: servedItem.id,
        idempotencyKey: idempotencyKey?.trim() || null,
      });

      if (!duplicate) {
        return res.status(409).json({
          error: "duplicate_submission",
          message: "Answer already submitted for this session item.",
          requestId,
        });
      }

      return res.json({
        sessionId,
        sessionItemId: servedItem.id,
        isCorrect: !!duplicate.is_correct,
        mode: "multiple_choice",
        correctAnswerKey,
        explanation,
        feedback: duplicate.is_correct ? "Correct" : duplicate.outcome === "skipped" ? "Skipped" : "Incorrect",
        stats: await getSessionStats(sessionId, userId),
        idempotentRetried: true,
      });
    }

    return res.status(500).json({
      error: "answer_submit_failed",
      message: insertResult.error.message ?? "Unable to record answer attempt",
      requestId,
    });
  }

  const { data: updatedItem, error: updateItemErr } = await supabaseServer
    .from("practice_session_items")
    .update({
      status: isSkipped ? "skipped" : "answered",
      attempt_id: attemptId,
      updated_at: now,
      answered_at: now,
    })
    .eq("id", servedItem.id)
    .eq("status", "served")
    .select("id")
    .maybeSingle();

  if (updateItemErr) {
    return res.status(500).json({
      error: "session_item_update_failed",
      message: updateItemErr.message,
      requestId,
    });
  }

  if (!updatedItem) {
    const raceDuplicate = await findExistingAttempt({
      userId,
      sessionId,
      questionId,
      sessionItemId: servedItem.id,
      idempotencyKey: idempotencyKey?.trim() || null,
    });

    if (raceDuplicate) {
      return res.json({
        sessionId,
        sessionItemId: servedItem.id,
        isCorrect: !!raceDuplicate.is_correct,
        mode: "multiple_choice",
        correctAnswerKey,
        explanation,
        feedback: raceDuplicate.is_correct ? "Correct" : raceDuplicate.outcome === "skipped" ? "Skipped" : "Incorrect",
        stats: await getSessionStats(sessionId, userId),
        idempotentRetried: true,
      });
    }

    return res.status(409).json({
      error: "session_item_not_open",
      message: "This practice item was already resolved by another request.",
      requestId,
    });
  }

  try {
    await supabaseServer
      .from("practice_events")
      .insert({
        user_id: userId,
        session_id: sessionId,
        question_id: questionId,
        event_type: "answered",
        created_at: now,
        payload: {
          session_item_id: servedItem.id,
          outcome,
          isCorrect,
        },
      });
  } catch {
    // non-blocking
  }

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
          skill_code: metadata.skill_code,
          difficulty: metadata.difficulty,
          structure_cluster_id: metadata.structure_cluster_id ?? null,
        },
      });
    }
  } catch (masteryErr: any) {
    console.warn("[practice] mastery logging failed", {
      requestId,
      message: masteryErr?.message,
    });
  }

  const refreshedMeta = asSessionMetadata(session.metadata);
  refreshedMeta.active_session_item_id = null;

  const resolvedCount = await countResolvedSessionItems(sessionId);
  const targetQuestionCount = coerceTargetQuestionCount(refreshedMeta.target_question_count);
  const shouldComplete = resolvedCount >= targetQuestionCount;

  if (shouldComplete) {
    refreshedMeta.lifecycle_state = "completed";
    await updateSessionLifecycle(sessionId, refreshedMeta, {
      status: "completed",
      completed: true,
      finished_at: now,
    });
  } else {
    refreshedMeta.lifecycle_state = "active";
    await updateSessionLifecycle(sessionId, refreshedMeta, {
      status: "in_progress",
      completed: false,
    });
  }

  return res.json({
    sessionId,
    sessionItemId: servedItem.id,
    isCorrect,
    mode: "multiple_choice",
    correctAnswerKey,
    explanation,
    feedback: isCorrect ? "Correct" : isSkipped ? "Skipped" : "Incorrect",
    stats: await getSessionStats(sessionId, userId),
    state: shouldComplete ? "completed" : "active",
  });
}

router.post("/answer", requireSupabaseAuth, practiceAnswerRateLimiter, csrfProtection, submitPracticeAnswer);

export default router;

