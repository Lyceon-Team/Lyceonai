import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import * as crypto from "node:crypto";
import { logger } from "../logger";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
} from "../middleware/supabase-auth.js";
import { applyMasteryEvent } from "../../apps/api/src/services/mastery-write";
import {
  checkAndReservePracticeQuota,
  RateLimitUnavailableError,
} from "../../apps/api/src/lib/rate-limit-ledger";
import {
  hasCanonicalOptionSet,
  buildStudentSafeOptionTokens,
  buildStudentSafeOptionsFromStoredMap,
  type CanonicalMcOption,
  type CanonicalItemType,
  type CanonicalQuestionRowLike,
  isCanonicalRuntimeQuestion,
  isValidCanonicalId,
  mapGenesisQuestionRow,
  normalizeClientInstanceId,
  normalizeAnswerKey,
  normalizeItemType,
  parseCorrectVariants,
  parseStudentSafeOptionTokenMap,
  projectStudentSafeQuestion,
  resolveCanonicalDomain,
  resolveClientInstanceBinding,
  resolveSectionFilterValues,
  type StudentSafeOption,
} from "../../shared/question-bank-contract";
import type { PracticeSessionItemRow } from "../../packages/shared/src/practice-schema";

/**
 * Runtime idempotency contract (practice/review/full-length):
 * - Session start replays return the same canonical session state.
 * - Duplicate answer submissions return the same canonical result.
 * - Review retry/attempt replays return the same canonical result.
 * Storage differs (idempotency keys vs uniqueness checks), but behavior is consistent.
 */

type PracticeLifecycleState = "created" | "active" | "completed" | "abandoned";

type McOption = CanonicalMcOption;

// @spec [Doc 02B §14/§20 Serving Questions; grid-in-extension.sql; Doc 02 Preamble §12 INV-02-08]
// Pre-submit student DTO. The only reveal-keyed fields are correct_answer/explanation, both
// hard-typed `null`; correct_variants is answer-bearing and is intentionally ABSENT from this
// type — it can never be assigned here. For grid_in, options is [] and inputMode signals a
// numeric-entry surface (the student produces the answer; no A–D choices exist).
type StudentSafeQuestionDTO = {
  sessionItemId: string;
  stem: string;
  passage: string | null;
  assets: unknown | null;
  section: string;
  questionType: "multiple_choice" | "grid_in";
  itemType: CanonicalItemType;
  inputMode: "choice" | "numeric_entry";
  options: StudentSafeOption[];
  difficulty: string | number | null;
  correct_answer: null;
  explanation: null;
};

// Server-side serving record. correct_answer / explanation / correct_variants live here for
// grading ONLY and are never projected to the student DTO. For grid_in, options is [] and the
// accepted-answer set rides in correct_variants; for mcq, correct_variants is null.
export type CanonicalQuestionForServing = {
  id: string;
  canonical_id: string;
  section_code: string;
  item_type: CanonicalItemType;
  stem: string;
  passage: string | null;
  options: McOption[];
  difficulty: string | number | null;
  domain?: string | null;
  skill?: string | null;
  subskill?: string | null;
  exam?: string | null;
  structure_cluster_id?: string | null;
  correct_answer: string | null;
  explanation: string | null;
  correct_variants: string[] | null;
  assets: unknown | null;
  option_metadata: unknown | null;
  estimated_time_seconds: number | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  mode: string;
  filters: Record<string, unknown>;
  target_count: number;
  platform: string;
  client_instance_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  completed_at?: string | null;
  actor_id: string;
};

type SessionItemRow = Omit<PracticeSessionItemRow, "question_difficulty"> & {
  question_difficulty: string | number | null;
};

type SessionMetadata = {
  client_instance_id?: string | null;
  lifecycle_state?: PracticeLifecycleState;
  active_session_item_id?: string | null;
  calculator_state?: unknown | null;
  target_question_count?: number;
  session_spec?: CanonicalSessionSpec;
  prebuilt?: boolean;
  requested_count?: number;
  source_pool_count?: number;
  selection_mode?: "exact" | "exact_reuse";
  session_start_idempotency_key?: string | null;
  last_served_ordinal?: number;
};

type CanonicalSessionSpec = {
  sections: Array<"Math" | "RW">;
  domains: string[];
  skills: string[];
  difficulties: Array<"easy" | "medium" | "hard">;
  target_minutes: number | null;
  target_question_count: number;
  mode: string;
};

const router = Router();

// @spec [Doc-02B_V4 §41; INV-02B-15 Config Doctrine] | @implemented [2026-06-27]
// All runtime constants read from practice_runtime_config — no hardcoded literals.
export type PracticeConfig = {
  maxConcurrentSessions: number;
  defaultSessionCountWeb: number;
  maxSessionCountPremium: number;
  targetSecondsPerQuestion: number;
  answerRateLimitWindowMs: number;
  answerRateLimitMax: number;
  diagnosticTotalQuestions: number;
  diagnosticPerDomain: number;
};

let _configCache: { config: PracticeConfig; ts: number } | null = null;
let _configInflight: Promise<PracticeConfig> | null = null;
const CONFIG_TTL_MS = 30_000;

export async function loadPracticeConfig(): Promise<PracticeConfig> {
  if (_configCache && Date.now() - _configCache.ts < CONFIG_TTL_MS) {
    return _configCache.config;
  }
  if (_configInflight) return _configInflight;
  _configInflight = loadPracticeConfigFromDb().finally(() => {
    _configInflight = null;
  });
  return _configInflight;
}

async function loadPracticeConfigFromDb(): Promise<PracticeConfig> {
  const { data, error } = await supabaseServer
    .from("practice_runtime_config")
    .select("key, value")
    .in("key", [
      "max_concurrent_sessions",
      "default_session_count_web",
      "max_session_count_premium",
      "target_seconds_per_question",
      "answer_rate_limit_window_ms",
      "answer_rate_limit_max",
      "diagnostic_total_questions",
      "diagnostic_per_domain",
    ]);

  if (error) {
    throw new Error(`practice_runtime_config read failed: ${error.message}`);
  }

  const configMap = new Map(
    (data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]),
  );

  const readIntRequired = (key: string): number => {
    const raw = configMap.get(key);
    const parsed =
      typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `practice_runtime_config: missing or invalid key '${key}'`,
      );
    }
    return parsed;
  };

  // Diagnostic keys may be absent when the diagnostic migration has not been
  // applied yet (Karl applies at step 7). Fall back to the locked spec values
  // so existing practice tests keep passing. Doc 05P §10.1: 8 × 5 = 40.
  const readIntOptional = (key: string, fallback: number): number => {
    if (!configMap.has(key)) return fallback;
    const raw = configMap.get(key);
    const parsed =
      typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  };

  const config: PracticeConfig = {
    maxConcurrentSessions: readIntRequired("max_concurrent_sessions"),
    defaultSessionCountWeb: readIntRequired("default_session_count_web"),
    maxSessionCountPremium: readIntRequired("max_session_count_premium"),
    targetSecondsPerQuestion: readIntRequired("target_seconds_per_question"),
    answerRateLimitWindowMs: readIntRequired("answer_rate_limit_window_ms"),
    answerRateLimitMax: readIntRequired("answer_rate_limit_max"),
    diagnosticTotalQuestions: readIntOptional("diagnostic_total_questions", 40),
    diagnosticPerDomain: readIntOptional("diagnostic_per_domain", 5),
  };
  _configCache = { config, ts: Date.now() };
  return config;
}

const ACTIVE_DB_STATUSES = ["active", "created"] as const;
const TERMINAL_DB_STATUSES = ["completed", "abandoned"] as const;
const SESSION_ITEM_SELECT =
  "id, session_id, user_id, question_id, question_section, question_stem, question_passage, question_options, question_correct_answer, question_explanation, question_option_metadata, question_domain, question_skill, question_difficulty, question_item_type, question_correct_variants, option_order, option_token_map, ordinal, status, client_instance_id, selected_answer, is_correct, outcome, answered_at, served_at, occurred_at, time_spent_ms, client_attempt_id, actor_id";

let _cachedRateLimiter: ReturnType<typeof rateLimit> | null = null;
let _cachedRateLimiterConfig: { windowMs: number; max: number } | null = null;

function getPracticeAnswerRateLimiter(config: PracticeConfig) {
  if (
    _cachedRateLimiter &&
    _cachedRateLimiterConfig?.windowMs === config.answerRateLimitWindowMs &&
    _cachedRateLimiterConfig?.max === config.answerRateLimitMax
  ) {
    return _cachedRateLimiter;
  }
  _cachedRateLimiterConfig = {
    windowMs: config.answerRateLimitWindowMs,
    max: config.answerRateLimitMax,
  };
  _cachedRateLimiter = rateLimit({
    windowMs: config.answerRateLimitWindowMs,
    max: config.answerRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: "rate_limited",
        message: "Too many practice submissions. Please slow down.",
      });
    },
  });
  return _cachedRateLimiter;
}

// No FALLBACK_PRACTICE_CONFIG — config doctrine requires all values from practice_runtime_config.
// If the DB read fails, loadPracticeConfigFromDb throws (fail-fast).

async function practiceAnswerRateLimiter(
  req: Request,
  res: Response,
  next: () => void,
) {
  let config: PracticeConfig;
  try {
    config = await loadPracticeConfig();
  } catch {
    logger.warn(
      "Rate limiter config unavailable; rejecting request (fail-closed)",
    );
    res.status(503).json({
      error: {
        message: "Service temporarily unavailable",
        code: "CONFIG_UNAVAILABLE",
      },
    });
    return;
  }
  const limiter = getPracticeAnswerRateLimiter(config);
  limiter(req, res, next);
}

const StartSessionBodySchema = z.object({
  section: z.string().optional().nullable(),
  sections: z.array(z.string().max(64)).max(20).optional().nullable(),
  domains: z.array(z.string().max(128)).max(100).optional().nullable(),
  skills: z.array(z.string().max(128)).max(100).optional().nullable(),
  difficulties: z.array(z.string().max(32)).max(10).optional().nullable(),
  mode: z.string().max(64).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
  target_minutes: z.number().int().positive().max(300).optional().nullable(),
  target_question_count: z.number().int().positive().optional().nullable(),
});

const AnswerBodySchema = z.object({
  sessionId: z.string().uuid(),
  sessionItemId: z.string().uuid().optional(),
  questionId: z.string().min(1).max(32).optional(),
  selectedAnswer: z.string().trim().max(32).optional().nullable(),
  selectedOptionId: z.string().trim().max(32).optional().nullable(),
  answer: z.string().trim().max(32).optional().nullable(),
  clientAttemptId: z.string().max(128).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
});

const SkipBodySchema = z.object({
  sessionItemId: z.string().uuid().optional(),
  questionId: z.string().min(1).max(32).optional(),
  clientAttemptId: z.string().max(128).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
});

const CalculatorStateBodySchema = z.object({
  calculator_state: z.unknown().optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
});

type NormalizedAnswerPayload = {
  sessionId: string;
  sessionItemId?: string;
  questionId?: string;
  selectedAnswer: string | null;
  clientAttemptId: string | null;
  clientInstanceId: string | null;
};

function normalizeAnswerPayload(
  input: z.infer<typeof AnswerBodySchema>,
): NormalizedAnswerPayload {
  const selectedAnswerRaw =
    typeof input.selectedAnswer === "string"
      ? input.selectedAnswer
      : typeof input.selectedOptionId === "string"
        ? input.selectedOptionId
        : typeof input.answer === "string"
          ? input.answer
          : null;

  const selectedAnswer =
    selectedAnswerRaw && selectedAnswerRaw.trim().length > 0
      ? selectedAnswerRaw.trim()
      : null;

  const clientAttemptId =
    typeof input.clientAttemptId === "string" &&
    input.clientAttemptId.trim().length > 0
      ? input.clientAttemptId.trim()
      : null;

  const clientInstanceId =
    typeof input.client_instance_id === "string" &&
    input.client_instance_id.trim().length > 0
      ? input.client_instance_id.trim()
      : null;

  return {
    sessionId: input.sessionId,
    sessionItemId: input.sessionItemId,
    questionId: input.questionId,
    selectedAnswer,
    clientAttemptId,
    clientInstanceId,
  };
}

type SkipPayload = {
  sessionId: string;
  sessionItemId?: string;
  questionId?: string;
  clientAttemptId: string | null;
  clientInstanceId: string | null;
};

function normalizeSkipPayload(
  sessionId: string,
  input: z.infer<typeof SkipBodySchema>,
): SkipPayload {
  const clientAttemptId =
    typeof input.clientAttemptId === "string" &&
    input.clientAttemptId.trim().length > 0
      ? input.clientAttemptId.trim()
      : null;

  const clientInstanceId =
    typeof input.client_instance_id === "string" &&
    input.client_instance_id.trim().length > 0
      ? input.client_instance_id.trim()
      : null;

  return {
    sessionId,
    sessionItemId: input.sessionItemId,
    questionId: input.questionId,
    clientAttemptId,
    clientInstanceId,
  };
}

function hasLegacyFreeResponseKeys(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(record, "freeResponseAnswer") ||
    Object.prototype.hasOwnProperty.call(record, "free_response_answer")
  );
}

function asSessionMetadata(metadata: unknown): SessionMetadata {
  if (!metadata || typeof metadata !== "object") return {};
  return metadata as SessionMetadata;
}

// @spec [Doc-02B_V4 §14] | @implemented [2026-06-27]
// Single lifecycle source: practice_sessions.status column. metadata.lifecycle_state retired.
function normalizeSessionState(status: string): PracticeLifecycleState {
  if (status === "completed") return "completed";
  if (status === "abandoned") return "abandoned";
  if (status === "created") return "created";
  return "active";
}

function normalizeSectionParam(
  section?: string | null,
): "Math" | "RW" | "Random" {
  if (!section) return "Random";
  const s = section.trim().toLowerCase();
  if (s === "math") return "Math";
  if (
    s === "rw" ||
    s === "reading_writing" ||
    s === "reading" ||
    s === "writing"
  )
    return "RW";
  if (s === "random") return "Random";
  return "Random";
}

function normalizeSectionToken(raw: unknown): "Math" | "RW" | null {
  if (typeof raw !== "string") return null;
  const normalized = normalizeSectionParam(raw);
  return normalized === "Random" ? null : normalized;
}

function normalizeSectionList(raw: unknown): Array<"Math" | "RW"> {
  if (!Array.isArray(raw)) return [];
  const values: Array<"Math" | "RW"> = [];
  for (const item of raw) {
    const token = normalizeSectionToken(item);
    if (!token || values.includes(token)) continue;
    values.push(token);
  }
  return values;
}

function normalizeStringList(raw: unknown, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  const deduped = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized || normalized.length > maxLen) continue;
    deduped.add(normalized);
  }
  return Array.from(deduped).sort((a, b) => a.localeCompare(b));
}

function normalizeDomainList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const deduped = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 128) continue;
    deduped.add(resolveCanonicalDomain(trimmed));
  }
  return Array.from(deduped).sort((a, b) => a.localeCompare(b));
}

function normalizeDifficulties(
  raw: unknown,
): Array<"easy" | "medium" | "hard"> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<"easy" | "medium" | "hard">();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const s = item.trim().toLowerCase();
    if (s === "easy" || s === "1") seen.add("easy");
    else if (s === "medium" || s === "2") seen.add("medium");
    else if (s === "hard" || s === "3") seen.add("hard");
  }
  return ["easy", "medium", "hard"].filter((value) =>
    seen.has(value as "easy" | "medium" | "hard"),
  ) as Array<"easy" | "medium" | "hard">;
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
    const key =
      typeof (item as any).key === "string" ? (item as any).key.trim() : "";
    const text =
      typeof (item as any).text === "string" ? (item as any).text : "";
    if (!key || !text) continue;
    const normalized = normalizeAnswerKey(key);
    if (!normalized) continue;
    options.push({ key: normalized, text });
  }

  return options;
}

function fisherYates<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildServedOptions(options: McOption[]): {
  optionOrder: string[];
  optionTokenMap: Record<string, string>;
  safeOptions: StudentSafeOption[];
} {
  const shuffled = fisherYates(options);
  const optionOrder = shuffled.map((o) => o.key);
  const { optionTokenMap, safeOptions } = buildStudentSafeOptionTokens(
    shuffled,
    optionOrder,
  );

  return { optionOrder, optionTokenMap, safeOptions };
}

// @spec [genesis questions DDL; grid-in-extension.sql] | @implemented 2026-06-14
// Builds the server-side serving record from a genesis-reconciled `questions` row.
// item_type drives the answer shape: mcq → A–D key in correct_answer, options present,
// no variant set; grid_in → student-produced value in correct_answer, no options, the
// accepted-answer set in correct_variants. All three answer-bearing fields stay server-side.
export function toCanonicalQuestionForServing(
  q: CanonicalQuestionRowLike,
): CanonicalQuestionForServing {
  const itemType: CanonicalItemType =
    normalizeItemType(q.item_type ?? q.question_type ?? null) ?? "mcq";
  const isGridIn = itemType === "grid_in";
  const correctVariants = isGridIn
    ? parseCorrectVariants(q.correct_variants)
    : null;
  // For mcq the correct answer is an A–D key; for grid_in it is the canonical value string.
  const correctAnswer = isGridIn
    ? typeof q.correct_answer === "string" && q.correct_answer.trim().length > 0
      ? q.correct_answer.trim()
      : null
    : (normalizeAnswerKey(q.correct_answer) ?? null);
  return {
    id: String(q.id),
    canonical_id: String(q.canonical_id ?? q.id ?? ""),
    section_code: String(q.section_code ?? q.section ?? ""),
    item_type: itemType,
    stem: String(q.stem ?? ""),
    passage:
      typeof q.passage === "string" && q.passage.trim().length > 0
        ? q.passage
        : null,
    options: isGridIn ? [] : safeParseOptions(q.options),
    difficulty: q.difficulty ?? null,
    domain: typeof q.domain === "string" ? q.domain : null,
    skill: typeof q.skill === "string" ? q.skill : null,
    subskill: typeof q.subskill === "string" ? q.subskill : null,
    exam: typeof q.exam === "string" ? q.exam : null,
    structure_cluster_id:
      typeof q.structure_cluster_id === "string"
        ? q.structure_cluster_id
        : null,
    correct_answer: correctAnswer,
    explanation:
      typeof q.explanation === "string" && q.explanation.trim().length > 0
        ? q.explanation
        : null,
    correct_variants:
      correctVariants && correctVariants.length > 0 ? correctVariants : null,
    assets: q.assets ?? null,
    option_metadata: q.option_metadata ?? null,
    estimated_time_seconds:
      typeof q.estimated_time_seconds === "number"
        ? q.estimated_time_seconds
        : null,
  };
}

// @spec [Doc 02B §14 Session Items Prefill; Doc-02B_V4 §14 grid-in extension] | @implemented 2026-07-09
// Reconstructs the server-side serving record from a persisted practice_session_items
// snapshot. Branches on question_item_type: MCQ requires 4-option canonical set + A–D key;
// grid-in requires empty options + raw correct_answer + correct_variants array.
function toCanonicalQuestionFromSessionItem(
  item: SessionItemRow,
): CanonicalQuestionForServing | null {
  const canonicalId = String(item.question_id ?? "").trim();
  const stem = String(item.question_stem ?? "").trim();
  const section = String(item.question_section ?? "").trim();

  if (!isValidCanonicalId(canonicalId)) return null;
  if (!stem || !section) return null;

  const itemType: CanonicalItemType =
    normalizeItemType(item.question_item_type ?? null) ?? "mcq";
  const isGridIn = itemType === "grid_in";

  const options = safeParseOptions(item.question_options);

  if (isGridIn) {
    if (options.length !== 0) return null;
  } else {
    if (!hasCanonicalOptionSet(options)) return null;
  }

  const correctAnswer = isGridIn
    ? typeof item.question_correct_answer === "string" &&
      item.question_correct_answer.trim().length > 0
      ? item.question_correct_answer.trim()
      : null
    : (normalizeAnswerKey(item.question_correct_answer) ?? null);

  const correctVariants = isGridIn
    ? parseCorrectVariants(item.question_correct_variants)
    : null;

  return {
    id: canonicalId,
    canonical_id: canonicalId,
    section_code: section,
    item_type: itemType,
    stem,
    passage:
      typeof item.question_passage === "string" &&
      item.question_passage.trim().length > 0
        ? item.question_passage
        : null,
    options,
    difficulty: item.question_difficulty ?? null,
    domain: item.question_domain ?? null,
    skill: item.question_skill ?? null,
    subskill: null,
    exam: null,
    structure_cluster_id: null,
    correct_answer: correctAnswer,
    explanation:
      typeof item.question_explanation === "string" &&
      item.question_explanation.trim().length > 0
        ? item.question_explanation
        : null,
    correct_variants:
      correctVariants && correctVariants.length > 0 ? correctVariants : null,
    assets: item.question_assets ?? null,
    option_metadata: item.question_option_metadata ?? null,
    estimated_time_seconds:
      typeof item.question_estimated_time_seconds === "number"
        ? item.question_estimated_time_seconds
        : null,
  };
}

// Grid-in has no options to tokenize — short-circuit to [].
function buildSafeOptionsForItem(
  q: CanonicalQuestionForServing,
  optionOrder: string[] | null,
  optionTokenMap: Record<string, string> | null,
): StudentSafeOption[] | null {
  if (q.item_type === "grid_in") return [];
  return buildStudentSafeOptionsFromStoredMap(
    q.options,
    optionOrder,
    optionTokenMap,
  );
}

function normalizeSafeDifficulty(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

const PRE_SUBMIT_ASSET_ROLES = new Set(["stimulus", "option"]);
const KNOWN_ASSET_KINDS = new Set(["svg", "table", "image"]);

// @spec [Doc-02A_V6 §16; Doc-02B_V4 §14/§20] | @implemented [2026-07-24]
// Fail-closed: only v:1 structured payloads with a valid items array are
// understood. Unknown versions, missing structure, legacy flat formats, or
// any unrecognized shape → null (exclude). Items with missing/unknown role
// or kind are dropped individually; if nothing survives, return null.
export function filterAssetsPreSubmit(assets: unknown | null): unknown | null {
  if (assets == null) return null;
  if (typeof assets !== "object") return null;

  const obj = assets as Record<string, unknown>;
  if (obj.v !== 1 || !Array.isArray(obj.items)) {
    return null;
  }

  const filtered = (obj.items as Array<Record<string, unknown>>).filter(
    (item) =>
      typeof item.role === "string" &&
      PRE_SUBMIT_ASSET_ROLES.has(item.role) &&
      typeof item.kind === "string" &&
      KNOWN_ASSET_KINDS.has(item.kind),
  );

  if (filtered.length === 0) return null;
  return { v: 1, items: filtered };
}

// @spec [Doc 02B §14/§20 Serving Questions; Doc 02 Preamble §12 INV-02-08] | @implemented 2026-06-14
// Single canonical serializer — no second inline question shape. We pass item_type through
// so projectStudentSafeQuestion produces the correct grid-in vs MCQ surface, and we NEVER
// hand it correct_variants (it has no such field; the answer set stays server-side). The
// serializer null-strips correct_answer/explanation; for grid_in it emits options [] +
// inputMode 'numeric_entry'. So this DTO carries no answer, no explanation, no variants.
export function toStudentSafeQuestionDTO(args: {
  sessionItemId: string;
  question: CanonicalQuestionForServing;
  safeOptions: StudentSafeOption[];
}): StudentSafeQuestionDTO {
  const isGridIn = args.question.item_type === "grid_in";
  const safe = projectStudentSafeQuestion({
    id: args.question.id,
    canonical_id: args.question.canonical_id,
    section_code: args.question.section_code ?? null,
    item_type: args.question.item_type,
    stem: args.question.stem,
    passage: args.question.passage ?? null,
    options: args.question.options,
    difficulty: args.question.difficulty ?? null,
    domain: args.question.domain ?? null,
    skill: args.question.skill ?? null,
    subskill: args.question.subskill ?? null,
    skill_code: null,
    tags: null,
    correct_answer: args.question.correct_answer ?? null,
    explanation: args.question.explanation ?? null,
  });

  return {
    sessionItemId: args.sessionItemId,
    section: safe.section_code ?? args.question.section_code,
    stem: safe.stem,
    passage: safe.passage,
    assets: filterAssetsPreSubmit(args.question.assets),
    questionType: safe.question_type,
    itemType: safe.item_type,
    inputMode: safe.inputMode,
    // Grid-ins have no choices: emit []. MCQs carry the per-session tokenized options.
    options: isGridIn ? [] : args.safeOptions,
    difficulty: normalizeSafeDifficulty(safe.difficulty),
    correct_answer: null,
    explanation: null,
  };
}

export type SessionItemInsertContext = {
  sessionId: string;
  userId: string;
  actorId: string;
  clientInstanceId: string;
  now: string;
};

export function buildSessionItemInsertRows(
  selected: CanonicalQuestionForServing[],
  ctx: SessionItemInsertContext,
): Record<string, unknown>[] {
  return selected.map((question, index) => ({
    session_id: ctx.sessionId,
    user_id: ctx.userId,
    actor_id: ctx.actorId,
    question_id: question.id,
    question_section: question.section_code,
    question_stem: question.stem,
    question_passage: question.passage ?? null,
    question_options: question.options,
    question_correct_answer: question.correct_answer ?? null,
    question_explanation: question.explanation ?? null,
    question_domain: question.domain ?? null,
    question_skill: question.skill ?? null,
    question_difficulty: question.difficulty ?? null,
    question_item_type: question.item_type,
    question_correct_variants: question.correct_variants ?? null,
    question_assets: question.assets ?? null,
    question_option_metadata: question.option_metadata ?? null,
    question_estimated_time_seconds: question.estimated_time_seconds ?? null,
    ordinal: index + 1,
    status: index === 0 ? "served" : "pending",
    client_instance_id: index === 0 ? ctx.clientInstanceId : null,
    served_at: index === 0 ? ctx.now : null,
    selected_answer: null,
    is_correct: null,
    outcome: null,
    time_spent_ms: null,
    client_attempt_id: null,
    answered_at: null,
    option_order: null,
    option_token_map: null,
  }));
}

function simpleHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash |= 0;
  }
  return Math.abs(hash);
}

// coerceQuestionDifficulty REMOVED — difficulty filtering moved to
// select_practice_pool_random RPC (DB-side CASE expression).

function resolveDifficultyBucketStrict(raw: unknown): 1 | 2 | 3 | null {
  if (raw === 1 || raw === 2 || raw === 3) return raw;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "easy" || normalized === "1") return 1;
    if (normalized === "medium" || normalized === "2") return 2;
    if (normalized === "hard" || normalized === "3") return 3;
    const parsed = Number.parseInt(normalized, 10);
    if (parsed === 1 || parsed === 2 || parsed === 3)
      return parsed as 1 | 2 | 3;
  }
  return null;
}

function coerceTargetQuestionCount(
  raw: unknown,
  maxCap: number,
  defaultCount: number,
): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const rounded = Math.floor(raw);
    if (rounded > 0) return Math.min(maxCap, rounded);
  }
  return defaultCount;
}

function deriveTargetQuestionCountFromMinutes(
  targetMinutes: number,
  secondsPerQuestion: number,
  maxCap: number,
  defaultCount: number,
): number {
  const derived = Math.round((targetMinutes * 60) / secondsPerQuestion);
  return coerceTargetQuestionCount(derived, maxCap, defaultCount);
}

function resolveSectionForSession(
  specSections: Array<"Math" | "RW">,
  legacySection: "Math" | "RW" | "Random",
): "Math" | "RW" | "Random" {
  if (specSections.length === 1) return specSections[0];
  if (specSections.length > 1) return "Random";
  return legacySection;
}

function normalizeSessionSpec(
  input: z.infer<typeof StartSessionBodySchema>,
  config: PracticeConfig,
): {
  section: "Math" | "RW" | "Random";
  targetQuestionCount: number;
  sessionSpec: CanonicalSessionSpec;
} {
  const legacySection = normalizeSectionParam(input.section);
  const sectionValues = normalizeSectionList(input.sections);

  if (sectionValues.length === 0) {
    const legacyToken = normalizeSectionToken(input.section);
    if (legacyToken) sectionValues.push(legacyToken);
  }

  sectionValues.sort((a, b) => a.localeCompare(b));

  const mode = String(input.mode ?? "balanced").trim() || "balanced";
  const targetMinutes =
    typeof input.target_minutes === "number"
      ? Math.floor(input.target_minutes)
      : null;
  const explicitTargetCount = coerceTargetQuestionCount(
    input.target_question_count,
    config.maxSessionCountPremium,
    config.defaultSessionCountWeb,
  );
  const hasExplicitTargetCount =
    typeof input.target_question_count === "number" &&
    Number.isFinite(input.target_question_count);
  const effectiveTargetCount =
    targetMinutes && !hasExplicitTargetCount
      ? deriveTargetQuestionCountFromMinutes(
          targetMinutes,
          config.targetSecondsPerQuestion,
          config.maxSessionCountPremium,
          config.defaultSessionCountWeb,
        )
      : explicitTargetCount;

  return {
    section: resolveSectionForSession(sectionValues, legacySection),
    targetQuestionCount: effectiveTargetCount,
    sessionSpec: {
      sections: sectionValues,
      domains: normalizeDomainList(input.domains),
      skills: normalizeStringList(input.skills, 128),
      difficulties: normalizeDifficulties(input.difficulties),
      target_minutes: targetMinutes,
      target_question_count: effectiveTargetCount,
      mode,
    },
  };
}

function resolveAllowedSectionCodes(sections: Array<"Math" | "RW">): string[] {
  const codes = new Set<string>();
  for (const section of sections) {
    const sectionKey = section === "Math" ? "math" : "rw";
    const sectionCodes = resolveSectionFilterValues(sectionKey) ?? [];
    for (const code of sectionCodes) {
      if (typeof code === "string" && code.trim().length > 0) {
        codes.add(code.trim());
      }
    }
  }
  return Array.from(codes);
}

// listExactFilteredQuestionPool and filterPoolBySessionSpec REMOVED —
// replaced by DB-side select_practice_pool_random RPC (ORDER BY random()).
// See migration 20260627030000_practice_select_pool_random.sql.

async function countSessionItems(sessionId: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from("practice_session_items")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);

  if (error) {
    throw new Error(
      `practice_session_items_count_all_failed: ${error.message}`,
    );
  }

  return Number.isFinite(count as number) ? Number(count) : 0;
}

export async function hydrateSessionItemOptionTokens(
  sessionId: string,
): Promise<void> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("id, question_options, option_order, option_token_map")
    .eq("session_id", sessionId)
    .order("ordinal", { ascending: true });

  if (error) {
    throw new Error(
      `practice_session_items_option_fetch_failed: ${error.message}`,
    );
  }

  for (const row of (data ?? []) as any[]) {
    if (row.option_order && row.option_token_map) continue;
    const options = safeParseOptions(row.question_options);
    if (!hasCanonicalOptionSet(options)) continue;
    const served = buildServedOptions(options);
    const { error: updateError } = await supabaseServer
      .from("practice_session_items")
      .update({
        option_order: served.optionOrder,
        option_token_map: served.optionTokenMap,
      })
      .eq("id", row.id);

    if (updateError) {
      throw new Error(
        `practice_session_items_option_update_failed: ${updateError.message}`,
      );
    }
  }
}

export async function cleanupFailedSessionMaterialization(
  sessionId: string,
): Promise<void> {
  try {
    await supabaseServer
      .from("practice_session_items")
      .delete()
      .eq("session_id", sessionId);
  } catch {
    // best effort cleanup
  }

  try {
    await supabaseServer.from("practice_sessions").delete().eq("id", sessionId);
  } catch {
    // best effort cleanup
  }
}

function isDuplicateConflict(message: string | undefined): boolean {
  return /duplicate|unique/i.test(String(message || ""));
}

function sendClientConflict(
  res: Response,
  requestId: string | undefined,
  clientInstanceId: string | null,
) {
  return res.status(409).json({
    error: "client_instance_conflict",
    code: "CLIENT_INSTANCE_CONFLICT",
    message: "Session client instance conflict",
    client_instance_id: clientInstanceId ?? null,
    requestId,
  });
}

async function reservePracticeQuestionQuota(args: {
  userId: string;
  role: string | undefined;
  sessionId: string;
  sessionItemId: string;
  requestId?: string;
}): Promise<
  { ok: true } | { ok: false; status: 402 | 503; body: Record<string, unknown> }
> {
  if (args.role === "admin") {
    return { ok: true };
  }

  try {
    const decision = await checkAndReservePracticeQuota({
      studentUserId: args.userId,
      role: args.role,
      sessionId: args.sessionId,
      sessionItemId: args.sessionItemId,
      dryRun: false,
      requestId: args.requestId ?? null,
    });

    if (decision.allowed) {
      return { ok: true };
    }

    return {
      ok: false,
      status: 402,
      body: {
        error: "Usage limit reached",
        code: decision.code || "PRACTICE_FREE_DAILY_QUOTA_EXCEEDED",
        limitType: "practice",
        current: decision.current,
        limit: decision.limit,
        remaining: decision.remaining,
        resetAt: decision.resetAt,
        message:
          decision.message ||
          "You've reached your daily practice question limit. Upgrade to unlock unlimited access.",
        requestId: args.requestId,
      },
    };
  } catch (error: unknown) {
    const code = (error as any)?.code;
    if (
      error instanceof RateLimitUnavailableError ||
      code === "RATE_LIMIT_DB_UNAVAILABLE"
    ) {
      return {
        ok: false,
        status: 503,
        body: {
          error: "Usage check unavailable",
          code: "RATE_LIMIT_DB_UNAVAILABLE",
          message:
            "Unable to verify practice quota at this time. Please retry shortly.",
          requestId: args.requestId,
        },
      };
    }
    throw error;
  }
}

async function getSessionStats(
  sessionId: string,
  userId: string,
): Promise<{
  correct: number;
  incorrect: number;
  skipped: number;
  total: number;
  streak: number;
}> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("is_correct, outcome, answered_at, status")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .in("status", ["answered", "skipped"])
    .order("answered_at", { ascending: false });

  if (error) {
    return { correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0 };
  }

  const attempts = data ?? [];
  const correct = attempts.filter(
    (a: any) => a.is_correct === true && a.outcome !== "skipped",
  ).length;
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

async function getCurrentUnansweredItem(
  sessionId: string,
): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select(SESSION_ITEM_SELECT)
    .eq("session_id", sessionId)
    .eq("status", "served")
    .order("ordinal", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `practice_session_items_unanswered_failed: ${error.message}`,
    );
  }

  return (data as SessionItemRow | null) ?? null;
}

async function getLatestSessionItem(
  sessionId: string,
): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select(SESSION_ITEM_SELECT)
    .eq("session_id", sessionId)
    .order("ordinal", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`practice_session_items_latest_failed: ${error.message}`);
  }

  return (data as SessionItemRow | null) ?? null;
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

async function getSessionProgressCounts(sessionId: string): Promise<{
  answeredCount: number;
  skippedCount: number;
  completedCount: number;
}> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("outcome, status")
    .eq("session_id", sessionId)
    .in("status", ["answered", "skipped"]);

  if (error) {
    throw new Error(`practice_session_progress_count_failed: ${error.message}`);
  }

  const attempts = data ?? [];
  const completedCount = attempts.length;
  const skippedCount = attempts.filter(
    (row: any) => row?.outcome === "skipped",
  ).length;
  const answeredCount = Math.max(0, completedCount - skippedCount);

  return {
    answeredCount,
    skippedCount,
    completedCount,
  };
}

async function updateSessionLifecycle(
  sessionId: string,
  metadata: SessionMetadata,
  patch?: Record<string, unknown>,
) {
  const nextUpdate: Record<string, unknown> = {
    filters: metadata,
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
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
  actorId: string;
  role: string | undefined;
  section: "Math" | "RW" | "Random";
  mode: string;
  clientInstanceId: string;
  idempotencyKey: string | null;
  targetQuestionCount: number;
  sessionSpec: CanonicalSessionSpec;
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
  // 1) Fetch all open sessions for this user to check global limit and idempotency
  const { data: openSessions, error: openErr } = await supabaseServer
    .from("practice_sessions")
    .select(
      "id, user_id, mode, filters, target_count, platform, client_instance_id, status, created_at, updated_at, last_activity_at, completed_at, actor_id",
    )
    .eq("user_id", args.userId)
    .in("status", [...ACTIVE_DB_STATUSES])
    .order("created_at", { ascending: false });

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

  // 2) Idempotency check: if we have a key, we MUST return that specific session
  if (args.idempotencyKey) {
    replay =
      sessions.find((candidate) => {
        const meta = asSessionMetadata(candidate.filters);
        return meta.session_start_idempotency_key === args.idempotencyKey;
      }) ?? null;
  }

  // @spec [Doc-02B_V4 §14; INV-02B-15] | @implemented [2026-06-27]
  // Max concurrent sessions from config (CEO model = 5).
  const config = await loadPracticeConfig();
  const maxSessions = config.maxConcurrentSessions;
  if (!replay && sessions.length >= maxSessions) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "session_limit_exceeded",
        code: "SESSION_LIMIT_EXCEEDED",
        message: `You already have ${sessions.length} open sessions. Please complete or terminate some before starting a new one.`,
        limit: maxSessions,
      },
    };
  }

  if (replay) {
    const replayMeta = asSessionMetadata(replay.filters);
    const binding = resolveClientInstanceBinding({
      boundClientInstanceId: replay.client_instance_id,
      requestedClientInstanceId: args.clientInstanceId,
    });

    if (binding.action === "conflict") {
      return {
        ok: false,
        status: 409,
        body: {
          error: "client_instance_conflict",
          code: "CLIENT_INSTANCE_CONFLICT",
          message: "Session client instance conflict",
          client_instance_id: binding.boundClientInstanceId ?? null,
        },
      };
    }

    const replayPatch: Record<string, unknown> = {};
    if (binding.action === "bind") {
      replayPatch.client_instance_id = binding.requestedClientInstanceId;
    }
    replayMeta.target_question_count = coerceTargetQuestionCount(
      replayMeta.target_question_count ?? args.targetQuestionCount,
      config.maxSessionCountPremium,
      config.defaultSessionCountWeb,
    );
    replayMeta.session_spec = replayMeta.session_spec ?? args.sessionSpec;

    if (args.idempotencyKey) {
      replayMeta.session_start_idempotency_key = args.idempotencyKey;
    }

    const existingItemCount = await countSessionItems(replay.id);
    if (existingItemCount > 0) {
      replayMeta.prebuilt = true;
      replayMeta.requested_count = coerceTargetQuestionCount(
        replayMeta.target_question_count,
        config.maxSessionCountPremium,
        config.defaultSessionCountWeb,
      );
      replayMeta.source_pool_count = Number.isFinite(
        replayMeta.source_pool_count as number,
      )
        ? Number(replayMeta.source_pool_count)
        : existingItemCount;
      replayMeta.selection_mode =
        replayMeta.selection_mode === "exact_reuse" ? "exact_reuse" : "exact";
    }

    await updateSessionLifecycle(replay.id, replayMeta, {
      status: replay.status === "created" ? "active" : replay.status,
      ...replayPatch,
    });

    return {
      ok: true,
      session: {
        ...replay,
        filters: replayMeta as Record<string, unknown>,
      },
      metadata: replayMeta,
      replayed: true,
    };
  }

  // @spec [Doc-02B_V4 §14; SCL-P-ADAPTIVE] | @implemented [2026-06-27]
  // CEO model: filter-driven native random selection. All N items prepopulated at creation.
  // Determinism satisfied by storage (the rows ARE the durable record).
  let requestedCount = coerceTargetQuestionCount(
    args.targetQuestionCount,
    config.maxSessionCountPremium,
    config.defaultSessionCountWeb,
  );

  // @spec [Doc-02B_V4 §41; F2 creation-time clamp] | @implemented [2026-06-30]
  // Dry-run remaining daily quota for unpaid users and clamp requestedCount
  // so we never over-materialize sessions beyond the remaining free-tier allowance.
  if (args.role !== "admin") {
    try {
      const dryRunDecision = await checkAndReservePracticeQuota({
        studentUserId: args.userId,
        role: args.role,
        sessionId: null,
        sessionItemId: null,
        dryRun: true,
        requestId: null,
      });
      if (!dryRunDecision.allowed) {
        return {
          ok: false,
          status: 402,
          body: {
            error: "Usage limit reached",
            code: dryRunDecision.code || "PRACTICE_FREE_DAILY_QUOTA_EXCEEDED",
            limitType: "practice",
            current: dryRunDecision.current,
            limit: dryRunDecision.limit,
            remaining: dryRunDecision.remaining,
            resetAt: dryRunDecision.resetAt,
            message:
              dryRunDecision.message ||
              "You've reached your daily practice question limit.",
          },
        };
      }
      const remaining =
        typeof dryRunDecision.remaining === "number"
          ? dryRunDecision.remaining
          : requestedCount;
      if (remaining > 0 && remaining < requestedCount) {
        requestedCount = remaining;
      }
    } catch (e) {
      if (e instanceof RateLimitUnavailableError) {
        logger.warn(
          "Quota dry-run unavailable at session creation; failing closed",
        );
        return {
          ok: false,
          status: 503,
          body: {
            error: {
              message: "Quota service temporarily unavailable",
              code: "QUOTA_UNAVAILABLE",
            },
          },
        };
      }
      throw e;
    }
  }

  const sessionMetadata: SessionMetadata = {
    client_instance_id: args.clientInstanceId,
    active_session_item_id: null,
    target_question_count: requestedCount,
    session_spec: args.sessionSpec,
    prebuilt: false,
    session_start_idempotency_key: args.idempotencyKey,
  };

  // @spec [Doc-02B_V4 §14/§15; SCL-P-ADAPTIVE] | @implemented [2026-06-27]
  // DB-side ORDER BY random() via select_practice_pool_random RPC.
  // The DB returns exactly N rows; no full-pool fetch into TS.

  // 1. Gather exclude IDs (active session questions — prevents cross-session repeats)
  const { data: activeSessionItems } = await supabaseServer
    .from("practice_session_items")
    .select("question_id, practice_sessions!inner(status)")
    .eq("user_id", args.userId)
    .in("practice_sessions.status", [...ACTIVE_DB_STATUSES]);

  const excludeIds = (activeSessionItems ?? [])
    .map((item: { question_id?: string }) => item.question_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  // 2. Resolve filter params for the RPC
  const sectionCodes = resolveAllowedSectionCodes(args.sessionSpec.sections);
  const difficultyInts: number[] = args.sessionSpec.difficulties.map((d) =>
    d === "easy" ? 1 : d === "hard" ? 3 : 2,
  );

  // 3. Call DB-side random selection
  const { data: poolRows, error: poolError } = await supabaseServer.rpc(
    "select_practice_pool_random",
    {
      p_sections: sectionCodes.length > 0 ? sectionCodes : null,
      p_domains:
        args.sessionSpec.domains.length > 0 ? args.sessionSpec.domains : null,
      p_skills:
        args.sessionSpec.skills.length > 0 ? args.sessionSpec.skills : null,
      p_difficulties: difficultyInts.length > 0 ? difficultyInts : null,
      p_exclude_ids: excludeIds.length > 0 ? excludeIds : null,
      p_limit: requestedCount,
    },
  );

  if (poolError) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_create_failed",
        message: `pool_selection_failed: ${poolError.message}`,
      },
    };
  }

  // 4. Validate and convert DB rows through the canonical pipeline
  const mappedRows = ((poolRows ?? []) as unknown[]).map((row) =>
    mapGenesisQuestionRow(row as CanonicalQuestionRowLike),
  );
  const validPool = mappedRows
    .filter((row) => isCanonicalRuntimeQuestion(row))
    .map((row) => toCanonicalQuestionForServing(row));

  if (validPool.length === 0) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "empty_pool",
        code: "PRACTICE_POOL_EMPTY",
        message: "No questions match the requested filters.",
      },
    };
  }

  const selected = validPool;
  const sourcePoolCount = validPool.length;
  const selectionMode: "exact" | "exact_reuse" =
    sourcePoolCount < requestedCount ? "exact_reuse" : "exact";

  const insertFilters: SessionMetadata = {
    ...sessionMetadata,
    prebuilt: true,
    requested_count: requestedCount,
    source_pool_count: sourcePoolCount,
    selection_mode: selectionMode,
    last_served_ordinal: 1,
  };

  const { data: createdSession, error: sessionInsertError } =
    await supabaseServer
      .from("practice_sessions")
      .insert({
        user_id: args.userId,
        actor_id: args.actorId,
        mode: args.mode,
        filters: insertFilters,
        target_count: requestedCount,
        platform: "web",
        client_instance_id: args.clientInstanceId,
        status: "active",
      })
      .select(
        "id, user_id, mode, filters, target_count, platform, client_instance_id, status, created_at, updated_at, last_activity_at, completed_at, actor_id",
      )
      .single();

  if (sessionInsertError || !createdSession) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_create_failed",
        message:
          sessionInsertError?.message ?? "Unable to create practice session",
      },
    };
  }

  const sessionRow = createdSession as Record<string, unknown>;
  const sessionId = String(sessionRow.id ?? "");
  if (!sessionId) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_create_failed",
        message: "Unable to create practice session",
      },
    };
  }

  const now = new Date().toISOString();
  const insertRows = buildSessionItemInsertRows(selected, {
    sessionId,
    userId: args.userId,
    actorId: args.actorId,
    clientInstanceId: args.clientInstanceId,
    now,
  });

  const { data: insertedItems, error: itemInsertError } = await supabaseServer
    .from("practice_session_items")
    .insert(insertRows)
    .select("id, ordinal");

  if (itemInsertError) {
    await cleanupFailedSessionMaterialization(sessionId);
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_create_failed",
        message: itemInsertError.message,
      },
    };
  }

  try {
    await hydrateSessionItemOptionTokens(sessionId);
  } catch (hydrateError: any) {
    await cleanupFailedSessionMaterialization(sessionId);
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_create_failed",
        message:
          hydrateError?.message ?? "Unable to hydrate session item tokens",
      },
    };
  }

  const firstInsertedItem = Array.isArray(insertedItems)
    ? insertedItems.find((row: SessionItemRow) => Number(row.ordinal) === 1)
    : null;

  if (firstInsertedItem) {
    const quotaResult = await reservePracticeQuestionQuota({
      userId: args.userId,
      role: args.role,
      sessionId,
      sessionItemId: String(firstInsertedItem.id),
    });
    if (!quotaResult.ok) {
      await cleanupFailedSessionMaterialization(sessionId);
      return {
        ok: false,
        status: quotaResult.status,
        body: quotaResult.body,
      };
    }
  }

  const newMetadata = asSessionMetadata((createdSession as SessionRow).filters);
  newMetadata.prebuilt = true;
  newMetadata.requested_count = requestedCount;
  newMetadata.source_pool_count = sourcePoolCount;
  newMetadata.selection_mode = selectionMode;
  newMetadata.target_question_count = requestedCount;
  newMetadata.session_spec = args.sessionSpec;
  newMetadata.client_instance_id = args.clientInstanceId;
  newMetadata.active_session_item_id = firstInsertedItem
    ? String(firstInsertedItem.id)
    : null;
  newMetadata.last_served_ordinal = 1;

  await updateSessionLifecycle(sessionId, newMetadata, {
    status: "active",
  });

  return {
    ok: true,
    session: {
      ...(createdSession as SessionRow),
      filters: newMetadata,
    },
    metadata: newMetadata,
    replayed: false,
  };
}

async function loadOwnedSession(
  sessionId: string,
  userId: string,
  options?: { hideForbidden?: boolean },
): Promise<{ forbidden: boolean; session: SessionRow } | null> {
  const { data, error } = await supabaseServer
    .from("practice_sessions")
    .select(
      "id, user_id, mode, status, filters, target_count, platform, client_instance_id, created_at, updated_at, last_activity_at, completed_at, actor_id",
    )
    .eq("id", sessionId)
    .single();

  if (error || !data) return null;
  if ((data as any).user_id !== userId) {
    if (options?.hideForbidden) return null;
    return { forbidden: true, session: data as SessionRow };
  }
  return { forbidden: false, session: data as SessionRow };
}

async function getNextPrebuiltQueuedItem(
  sessionId: string,
): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select(SESSION_ITEM_SELECT)
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .order("ordinal", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `practice_session_items_next_prebuilt_failed: ${error.message}`,
    );
  }

  return (data as SessionItemRow | null) ?? null;
}

async function findSessionItemById(
  sessionId: string,
  sessionItemId: string,
): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select(SESSION_ITEM_SELECT)
    .eq("session_id", sessionId)
    .eq("id", sessionItemId)
    .maybeSingle();

  if (error) {
    throw new Error(`practice_session_item_lookup_failed: ${error.message}`);
  }

  return (data as SessionItemRow | null) ?? null;
}

async function findSessionItemByClientAttemptId(
  userId: string,
  clientAttemptId: string,
): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select(SESSION_ITEM_SELECT)
    .eq("user_id", userId)
    .eq("client_attempt_id", clientAttemptId)
    .maybeSingle();

  if (error) {
    return null;
  }

  return (data as SessionItemRow | null) ?? null;
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
  const config = await loadPracticeConfig();

  const owned = await loadOwnedSession(args.sessionId, args.userId, {
    hideForbidden: true,
  });
  if (!owned) {
    return args.res.status(404).json({
      error: "session_not_found",
      message: "Practice session not found",
      requestId,
    });
  }
  const session = owned.session;

  const metadata = asSessionMetadata(session.filters);
  const sessionState = normalizeSessionState(session.status);
  if (
    sessionState === "completed" ||
    sessionState === "abandoned" ||
    TERMINAL_DB_STATUSES.includes(session.status)
  ) {
    return args.res.status(409).json({
      error: "session_closed",
      message: "Practice session is read-only",
      requestId,
    });
  }

  const binding = resolveClientInstanceBinding({
    boundClientInstanceId: metadata.client_instance_id,
    requestedClientInstanceId: args.clientInstanceId,
  });
  if (binding.action === "conflict") {
    return sendClientConflict(
      args.res,
      requestId,
      binding.boundClientInstanceId,
    );
  }
  if (binding.action === "bind") {
    metadata.client_instance_id = binding.requestedClientInstanceId;
  }

  const unresolved = await getCurrentUnansweredItem(args.sessionId);
  if (unresolved) {
    const canonicalQuestion = toCanonicalQuestionFromSessionItem(unresolved);
    if (!canonicalQuestion) {
      return args.res.status(422).json({
        error: "invalid_question_data",
        message:
          "Unable to resume the current question due to invalid persisted session item data.",
        requestId,
      });
    }

    const safeOptions = buildSafeOptionsForItem(
      canonicalQuestion,
      unresolved.option_order,
      unresolved.option_token_map,
    );
    if (!safeOptions) {
      const rebuilt = buildServedOptions(canonicalQuestion.options);
      const rebuildPatch = {
        option_order: rebuilt.optionOrder,
        option_token_map: rebuilt.optionTokenMap,
      };

      const { error: rebuildErr } = await supabaseServer
        .from("practice_session_items")
        .update(rebuildPatch)
        .eq("id", unresolved.id)
        .eq("status", "served");

      if (rebuildErr) {
        return args.res.status(500).json({
          error: "session_item_rebuild_failed",
          message: rebuildErr.message,
          requestId,
        });
      }

      const healedOptions = buildSafeOptionsForItem(
        canonicalQuestion,
        rebuilt.optionOrder,
        rebuilt.optionTokenMap,
      );
      if (!healedOptions) {
        return args.res.status(409).json({
          error: "session_item_mapping_missing",
          message:
            "Persisted option mapping is missing for the current session item.",
          requestId,
        });
      }

      metadata.active_session_item_id = unresolved.id;
      metadata.prebuilt = true;
      metadata.target_question_count =
        metadata.target_question_count ?? config.defaultSessionCountWeb;
      await updateSessionLifecycle(args.sessionId, metadata, {
        status: "active",
      });

      return args.res.status(200).json({
        sessionId: args.sessionId,
        sessionItemId: unresolved.id,
        ordinal: unresolved.ordinal,
        question: toStudentSafeQuestionDTO({
          sessionItemId: unresolved.id,
          question: canonicalQuestion,
          safeOptions: healedOptions,
        }),
        totalQuestions: await countSessionItems(args.sessionId),
        currentIndex: Math.max(0, unresolved.ordinal - 1),
        state: "active",
        calculatorState: metadata.calculator_state ?? null,
        stats: await getSessionStats(args.sessionId, args.userId),
      });
    }

    metadata.active_session_item_id = unresolved.id;
    metadata.last_served_ordinal = unresolved.ordinal;

    await updateSessionLifecycle(args.sessionId, metadata, {
      status: "active",
    });

    return args.res.json({
      sessionId: session.id,
      sessionItemId: unresolved.id,
      ordinal: unresolved.ordinal,
      state: "active",
      calculatorState: metadata.calculator_state ?? null,
      question: toStudentSafeQuestionDTO({
        sessionItemId: unresolved.id,
        question: canonicalQuestion,
        safeOptions,
      }),
      stats: await getSessionStats(args.sessionId, args.userId),
      totalQuestions: await countSessionItems(args.sessionId),
    });
  }

  if (!metadata.prebuilt) {
    return args.res.status(409).json({
      error: "session_materialization_incomplete",
      code: "PRACTICE_SESSION_ITEMS_NOT_MATERIALIZED",
      message:
        "Practice session items were not materialized at creation. Runtime fallback generation is disabled by contract.",
      requestId,
    });
  }

  let nextPrebuilt = await getNextPrebuiltQueuedItem(args.sessionId);
  if (!nextPrebuilt) {
    const existingItemCount = await countSessionItems(args.sessionId);
    if (existingItemCount === 0) {
      return args.res.status(409).json({
        error: "session_materialization_missing",
        code: "PRACTICE_SESSION_ITEMS_MISSING",
        message:
          "Practice runtime cannot continue because persisted session items are missing. Runtime fallback generation is disabled by contract.",
        requestId,
      });
    }
  }

  if (!nextPrebuilt) {
    metadata.active_session_item_id = null;
    await updateSessionLifecycle(args.sessionId, metadata, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });

    return args.res.status(409).json({
      error: "session_closed",
      message: "Practice session is read-only",
      requestId,
    });
  }

  const canonicalQuestion = toCanonicalQuestionFromSessionItem(nextPrebuilt);
  if (!canonicalQuestion) {
    return args.res.status(422).json({
      error: "invalid_question_data",
      message:
        "Unable to load next prebuilt question due to invalid persisted session item data.",
      requestId,
    });
  }

  const now = new Date().toISOString();
  const { data: promoted, error: promoteErr } = await supabaseServer
    .from("practice_session_items")
    .update({
      status: "served",
      client_instance_id: args.clientInstanceId,
      served_at: now,
    })
    .eq("id", nextPrebuilt.id)
    .eq("status", "pending")
    .select(SESSION_ITEM_SELECT)
    .maybeSingle();

  if (promoteErr || !promoted) {
    return args.res.status(500).json({
      error: "session_item_promote_failed",
      message: promoteErr?.message ?? "Unable to promote next prebuilt item",
      requestId,
    });
  }

  const quotaReservation = await reservePracticeQuestionQuota({
    userId: args.userId,
    role: args.role,
    sessionId: args.sessionId,
    sessionItemId: promoted.id,
    requestId,
  });

  if (!quotaReservation.ok) {
    await supabaseServer
      .from("practice_session_items")
      .update({
        status: "pending",
        client_instance_id: null,
      })
      .eq("id", promoted.id)
      .eq("status", "served");

    return args.res.status(quotaReservation.status).json(quotaReservation.body);
  }

  const safeOptions = buildSafeOptionsForItem(
    canonicalQuestion,
    promoted.option_order,
    promoted.option_token_map,
  );
  if (!safeOptions) {
    return args.res.status(409).json({
      error: "session_item_mapping_missing",
      message:
        "Persisted option mapping is missing for next prebuilt session item.",
      requestId,
    });
  }

  metadata.active_session_item_id = promoted.id;
  metadata.last_served_ordinal = promoted.ordinal;
  await updateSessionLifecycle(args.sessionId, metadata, {
    status: "active",
  });

  return args.res.json({
    sessionId: session.id,
    sessionItemId: promoted.id,
    ordinal: promoted.ordinal,
    state: "active",
    calculatorState: metadata.calculator_state ?? null,
    question: toStudentSafeQuestionDTO({
      sessionItemId: promoted.id,
      question: canonicalQuestion,
      safeOptions,
    }),
    stats: await getSessionStats(args.sessionId, args.userId),
    totalQuestions: await countSessionItems(args.sessionId),
  });
}

/**
 * Returns a list of uncompleted practice sessions for the current user.
 */
router.get(
  "/sessions/open",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
    const requestId = (req as any).requestId;
    const user = (req as any).user;
    const userId = user?.id;

    const openConfig = await loadPracticeConfig();
    const { data: sessions, error } = await supabaseServer
      .from("practice_sessions")
      .select(
        "id, mode, status, filters, target_count, platform, client_instance_id, created_at, updated_at, last_activity_at, completed_at, actor_id",
      )
      .eq("user_id", userId)
      .in("status", [...ACTIVE_DB_STATUSES])
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: "failed_to_fetch_open_sessions",
        message: error.message,
        requestId,
      });
    }

    const enhancedSessions = await Promise.all(
      (sessions || []).map(async (s: SessionRow) => {
        const { count } = await supabaseServer
          .from("practice_session_items")
          .select("*", { count: "exact", head: true })
          .eq("session_id", s.id);

        const { count: answered } = await supabaseServer
          .from("practice_session_items")
          .select("*", { count: "exact", head: true })
          .eq("session_id", s.id)
          .in("status", ["answered", "skipped"]);

        const metadata = asSessionMetadata(s.filters);
        const specSections = metadata.session_spec?.sections ?? [];
        const section =
          specSections.length === 1
            ? specSections[0] === "Math"
              ? "math"
              : "reading_writing"
            : s.mode === "math"
              ? "math"
              : null;
        return {
          id: s.id,
          section,
          mode: s.mode,
          status: s.status,
          created_at: s.created_at,
          target_question_count: metadata.target_question_count || 0,
          total_items: count || 0,
          answered_items: answered || 0,
        };
      }),
    );

    return res.json({
      sessions: enhancedSessions,
      maxConcurrentSessions: openConfig.maxConcurrentSessions,
      requestId,
    });
  },
);

/**
 * Explicitly resumes an existing session, handling client instance binding and force takeover.
 */
router.post(
  "/sessions/:sessionId/resume",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
    const requestId = (req as any).requestId;
    const user = (req as any).user;
    const userId = user?.id;
    const sessionId = req.params.sessionId;
    const { client_instance_id, force_takeover } = req.body || {};

    const owned = await loadOwnedSession(sessionId, userId, {
      hideForbidden: true,
    });
    if (!owned) {
      return res.status(404).json({
        error: "session_not_found",
        message: "Practice session not found",
        requestId,
      });
    }

    const { session } = owned;
    const metadata = asSessionMetadata(session.filters);

    // Check for client instance conflict
    const binding = resolveClientInstanceBinding({
      boundClientInstanceId: metadata.client_instance_id,
      requestedClientInstanceId: client_instance_id,
    });

    if (binding.action === "conflict" && !force_takeover) {
      return res.status(409).json({
        error: "client_instance_conflict",
        code: "CLIENT_INSTANCE_CONFLICT",
        message: "Session client instance conflict",
        client_instance_id: binding.boundClientInstanceId ?? null,
        requestId,
      });
    }

    // Update binding if it's a bind action or a forced takeover
    if (
      binding.action === "bind" ||
      (binding.action === "conflict" && force_takeover)
    ) {
      metadata.client_instance_id = client_instance_id;
      await updateSessionLifecycle(sessionId, metadata, {
        updated_at: new Date().toISOString(),
      });
    }

    const state = await getCurrentUnansweredItem(sessionId);
    if (!state) {
      // If no active or queued items, the session is likely complete
      return res.json({
        sessionId: session.id,
        state: normalizeSessionState(session.status),
        stats: await getSessionStats(sessionId, userId),
        requestId,
      });
    }

    const canonicalQuestion = toCanonicalQuestionFromSessionItem(state);
    if (!canonicalQuestion) {
      return res.status(500).json({
        error: "question_load_failed",
        message: "Failed to load question content from session snapshot",
        requestId,
      });
    }

    let safeOptions = buildSafeOptionsForItem(
      canonicalQuestion,
      state.option_order,
      state.option_token_map,
    );
    if (!safeOptions) {
      const rebuilt = buildServedOptions(canonicalQuestion.options);
      await supabaseServer
        .from("practice_session_items")
        .update({
          option_order: rebuilt.optionOrder,
          option_token_map: rebuilt.optionTokenMap,
          updated_at: new Date().toISOString(),
        })
        .eq("id", state.id);
      safeOptions = buildSafeOptionsForItem(
        canonicalQuestion,
        rebuilt.optionOrder,
        rebuilt.optionTokenMap,
      );
    }

    return res.json({
      sessionId: session.id,
      sessionItemId: state.id,
      ordinal: state.ordinal,
      state: normalizeSessionState(session.status),
      calculatorState: metadata.calculator_state ?? null,
      question: toStudentSafeQuestionDTO({
        sessionItemId: state.id,
        question: canonicalQuestion,
        safeOptions: safeOptions!,
      }),
      stats: await getSessionStats(sessionId, userId),
      requestId,
    });
  },
);

router.post(
  "/sessions",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
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

    const config = await loadPracticeConfig();
    const normalizedSpec = normalizeSessionSpec(parsed.data, config);
    const section = normalizedSpec.section;
    const mode = normalizedSpec.sessionSpec.mode;
    const idempotencyKey = parsed.data.idempotency_key?.trim() || null;
    const targetQuestionCount = normalizedSpec.targetQuestionCount;
    const clientInstanceId =
      parsed.data.client_instance_id?.trim() || `server-${crypto.randomUUID()}`;

    const sessionResult = await startOrReplaySession({
      userId,
      actorId: user.actor_id,
      role: user?.role,
      section,
      mode,
      clientInstanceId,
      idempotencyKey,
      targetQuestionCount,
      sessionSpec: normalizedSpec.sessionSpec,
    });

    if (sessionResult.ok === false) {
      return res.status(sessionResult.status).json({
        ...sessionResult.body,
        requestId,
      });
    }

    const state = normalizeSessionState(sessionResult.session.status);

    return res.json({
      id: sessionResult.session.id,
      sessionId: sessionResult.session.id,
      userId,
      mode: sessionResult.session.mode,
      state,
      replayed: sessionResult.replayed,
      clientInstanceId,
      targetQuestionCount: coerceTargetQuestionCount(
        sessionResult.metadata.target_question_count,
        config.maxSessionCountPremium,
        config.defaultSessionCountWeb,
      ),
      calculatorState: sessionResult.metadata.calculator_state ?? null,
    });
  },
);

router.post(
  "/sessions/:sessionId/terminate",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
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

    const owned = await loadOwnedSession(sessionId, userId, {
      hideForbidden: true,
    });
    if (!owned) {
      return res.status(404).json({
        error: "session_not_found",
        message: "Practice session not found",
        requestId,
      });
    }

    const metadata = asSessionMetadata(owned.session.filters);
    metadata.active_session_item_id = null;
    metadata.client_instance_id = null;
    metadata.calculator_state = null;

    await updateSessionLifecycle(sessionId, metadata, {
      status: "abandoned",
      completed_at: new Date().toISOString(),
    });

    return res.json({
      sessionId,
      state: "abandoned",
      readOnly: true,
    });
  },
);

router.post(
  "/sessions/:sessionId/calculator-state",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
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

    const parsed = CalculatorStateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        issues: parsed.error.issues,
        requestId,
      });
    }

    const owned = await loadOwnedSession(sessionId, userId, {
      hideForbidden: true,
    });
    if (!owned) {
      return res.status(404).json({
        error: "session_not_found",
        message: "Practice session not found",
        requestId,
      });
    }

    const metadata = asSessionMetadata(owned.session.filters);
    const sessionState = normalizeSessionState(owned.session.status);

    if (
      sessionState === "completed" ||
      sessionState === "abandoned" ||
      TERMINAL_DB_STATUSES.includes(owned.session.status)
    ) {
      return res.status(409).json({
        error: "session_closed",
        message: "Practice session is read-only",
        requestId,
      });
    }

    const queryClientInstanceId = normalizeClientInstanceId(
      parsed.data.client_instance_id,
    );
    const binding = resolveClientInstanceBinding({
      boundClientInstanceId: metadata.client_instance_id,
      requestedClientInstanceId: queryClientInstanceId,
    });
    if (binding.action === "conflict") {
      return sendClientConflict(res, requestId, binding.boundClientInstanceId);
    }
    if (binding.action === "bind") {
      metadata.client_instance_id = binding.requestedClientInstanceId;
    }

    metadata.calculator_state = parsed.data.calculator_state ?? null;

    await updateSessionLifecycle(sessionId, metadata);

    return res.json({
      sessionId,
      calculatorState: metadata.calculator_state ?? null,
    });
  },
);

router.get(
  "/sessions/:sessionId/next",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
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
    const clientInstanceId = normalizeClientInstanceId(
      req.query.client_instance_id,
    );

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
  },
);

router.get(
  "/sessions/:sessionId/state",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  async (req, res) => {
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

    const owned = await loadOwnedSession(sessionId, userId, {
      hideForbidden: true,
    });
    if (!owned) {
      return res.status(404).json({
        error: "session_not_found",
        message: "Practice session not found",
        requestId,
      });
    }
    const session = owned.session;

    const metadata = asSessionMetadata(session.filters);
    const boundClient = normalizeClientInstanceId(metadata.client_instance_id);

    const config = await loadPracticeConfig();
    const latestItem = await getLatestSessionItem(sessionId);
    const unresolved = await getCurrentUnansweredItem(sessionId);
    const progressCounts = await getSessionProgressCounts(sessionId);
    const targetQuestionCount = coerceTargetQuestionCount(
      metadata.target_question_count,
      config.maxSessionCountPremium,
      config.defaultSessionCountWeb,
    );
    const state = normalizeSessionState(session.status);
    const specSections = metadata.session_spec?.sections ?? [];
    const section =
      specSections.length === 1
        ? specSections[0] === "Math"
          ? "math"
          : "reading_writing"
        : session.mode === "math"
          ? "math"
          : null;

    return res.json({
      sessionId: session.id,
      section,
      mode: session.mode ?? null,
      state,
      currentOrdinal: unresolved?.ordinal ?? latestItem?.ordinal ?? 0,
      answeredCount: progressCounts.answeredCount,
      skippedCount: progressCounts.skippedCount,
      completedCount: progressCounts.completedCount,
      targetQuestionCount,
      calculatorState: metadata.calculator_state ?? null,
      lastServedUnansweredItem: unresolved
        ? {
            sessionItemId: unresolved.id,
            ordinal: unresolved.ordinal,
          }
        : null,
      clientInstanceId: boundClient ?? null,
      readOnly: state === "completed" || state === "abandoned",
    });
  },
);

async function findSessionItemForSubmission(
  sessionId: string,
  args: {
    sessionItemId?: string;
    questionId?: string;
  },
) {
  let query = supabaseServer
    .from("practice_session_items")
    .select(SESSION_ITEM_SELECT)
    .eq("session_id", sessionId);

  if (args.sessionItemId) {
    query = query.eq("id", args.sessionItemId);
  } else if (args.questionId) {
    query = query.eq("question_id", args.questionId);
  } else {
    query = query
      .eq("status", "served")
      .order("ordinal", { ascending: false })
      .limit(1);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) return null;
  return data[0];
}
// @spec [Doc-02B_V4 §14; TIGHTENING-1 correct_variants grading] | @implemented 2026-07-09
// Unified grader — MCQ key-match vs grid-in correct_variants array membership.
// Grid-in grades against the snapshot correct_variants, NOT parseGridInValue.
// Fail closed on malformed data — no fallback grading path.
type GradeResult =
  | {
      ok: true;
      isCorrect: boolean;
      outcome: "correct" | "incorrect";
      selectedCanonicalKey: string;
      correctOptionId: string | null;
    }
  | { ok: false; status: number; error: string; message: string };

function gradeAnswer(
  canonicalQuestion: CanonicalQuestionForServing,
  selectedAnswer: string,
  optionTokenMap: Record<string, string> | null,
): GradeResult {
  const isGridIn = canonicalQuestion.item_type === "grid_in";

  if (isGridIn) {
    const variants = canonicalQuestion.correct_variants;
    if (!variants || variants.length === 0) {
      return {
        ok: false,
        status: 422,
        error: "invalid_question_data",
        message:
          "Grid-in question is missing correct_variants and cannot be graded.",
      };
    }
    const trimmed = selectedAnswer.trim();
    if (!trimmed) {
      return {
        ok: false,
        status: 400,
        error: "invalid_answer",
        message: "selectedAnswer must be a non-empty string for grid-in.",
      };
    }
    const isCorrect = variants.includes(trimmed);
    return {
      ok: true,
      isCorrect,
      outcome: isCorrect ? "correct" : "incorrect",
      selectedCanonicalKey: trimmed,
      correctOptionId: null,
    };
  }

  // MCQ path
  if (!optionTokenMap) {
    return {
      ok: false,
      status: 409,
      error: "session_item_mapping_missing",
      message: "The served option mapping is missing for this session item.",
    };
  }

  const correctAnswerKey = normalizeAnswerKey(canonicalQuestion.correct_answer);
  if (!correctAnswerKey) {
    return {
      ok: false,
      status: 422,
      error: "invalid_question_data",
      message: "This question is missing an answer key and cannot be graded.",
    };
  }

  const mappedKeyFromToken = selectedAnswer
    ? optionTokenMap[selectedAnswer]
    : null;
  const selectedCanonicalKey =
    mappedKeyFromToken ?? normalizeAnswerKey(selectedAnswer ?? null);

  if (!selectedCanonicalKey) {
    return {
      ok: false,
      status: 400,
      error: "invalid_answer",
      message:
        "selectedAnswer must match a served option token or canonical option key.",
    };
  }

  const correctOptionId =
    Object.entries(optionTokenMap).find(
      (entry) => entry[1] === correctAnswerKey,
    )?.[0] ?? null;

  const isCorrect = selectedCanonicalKey === correctAnswerKey;
  return {
    ok: true,
    isCorrect,
    outcome: isCorrect ? "correct" : "incorrect",
    selectedCanonicalKey,
    correctOptionId,
  };
}

// @spec [Doc-05A §11, Codex audit Fix 2] On idempotent replay of a diagnostic
// answer, re-attempt mastery emission. The answer was already recorded (status →
// "answered") on the first attempt, but mastery emission may have failed (500
// returned to client). On retry, the idempotent branch returns 200 without re-
// trying mastery — leaving the diagnostic without its required audit trail.
// applyMasteryEvent is idempotent on event_id: if the prior attempt succeeded,
// this is a no-op; if it failed, this repairs the gap.
// @implemented [2026-08-08] Re-emit mastery for diagnostic idempotent replays
async function reEmitDiagnosticMasteryIfNeeded(opts: {
  sessionItem: SessionItemRow;
  userId: string;
  requestId: string;
  sessionId: string;
  isCorrect: boolean;
  occurredAt: string;
}): Promise<
  { ok: true } | { ok: false; status: number; body: Record<string, unknown> }
> {
  const canonicalId =
    typeof opts.sessionItem.question_id === "string"
      ? opts.sessionItem.question_id
      : null;
  const section =
    typeof opts.sessionItem.question_section === "string"
      ? opts.sessionItem.question_section.trim()
      : "";
  const domain =
    typeof opts.sessionItem.question_domain === "string"
      ? opts.sessionItem.question_domain.trim()
      : "";
  const skill =
    typeof opts.sessionItem.question_skill === "string"
      ? opts.sessionItem.question_skill.trim()
      : "";
  const difficultyBucket = resolveDifficultyBucketStrict(
    opts.sessionItem.question_difficulty ?? null,
  );

  if (!canonicalId || !difficultyBucket || !section || !domain || !skill) {
    // Missing metadata — log and fail-closed for diagnostic.
    logger.error(
      "[diagnostic] mastery re-emission impossible (missing metadata) — fail-closed",
      {
        requestId: opts.requestId,
        sessionId: opts.sessionId,
        questionCanonicalId: canonicalId,
        section: section || null,
        domain: domain || null,
        skill: skill || null,
      },
    );
    return {
      ok: false,
      status: 500,
      body: {
        error: "diagnostic_mastery_emission_failed",
        message:
          "Diagnostic item lacks required metadata for mastery re-emission on replay. This is a data integrity defect.",
        requestId: opts.requestId,
      },
    };
  }

  try {
    const masteryResult = await applyMasteryEvent({
      studentId: opts.userId,
      section,
      domain,
      skill,
      difficulty: difficultyBucket,
      sourceFamily: "practice",
      eventSourceKind: "diagnostic_attempt",
      correct: opts.isCorrect,
      occurredAt: opts.occurredAt,
      eventId: opts.sessionItem.id,
      questionId: canonicalId,
    });
    if (!masteryResult.ok) {
      logger.error(
        "[diagnostic] mastery re-emission failed on replay — fail-closed",
        {
          requestId: opts.requestId,
          sessionId: opts.sessionId,
          questionCanonicalId: canonicalId,
          masteryError: masteryResult.error ?? "unknown",
        },
      );
      return {
        ok: false,
        status: 500,
        body: {
          error: "diagnostic_mastery_emission_failed",
          message:
            "Diagnostic mastery event could not be durably written on replay. Retry the submission.",
          requestId: opts.requestId,
        },
      };
    }
  } catch (masteryErr: unknown) {
    const errMsg =
      masteryErr instanceof Error ? masteryErr.message : String(masteryErr);
    logger.error(
      "[diagnostic] mastery re-emission threw on replay — fail-closed",
      {
        requestId: opts.requestId,
        sessionId: opts.sessionId,
        message: errMsg,
      },
    );
    return {
      ok: false,
      status: 500,
      body: {
        error: "diagnostic_mastery_emission_failed",
        message:
          "Diagnostic mastery event threw an unexpected error on replay. Retry the submission.",
        requestId: opts.requestId,
      },
    };
  }

  return { ok: true };
}

/**
 * @spec [Doc-05A §11, Codex audit Fix A] After a successful diagnostic mastery
 * re-emission on a replay path, run the same completion reconciliation the normal
 * answer path uses: recount resolved items, update session lifecycle to completed
 * if target is met. Without this, a fail-mastery → retry → mastery-succeeds
 * sequence leaves the diagnostic ACTIVE forever because the replay path returned
 * immediately without checking completion.
 *
 * For non-final answers (resolvedCount < target), this is a no-op (no lifecycle
 * change). For the final answer, this completes the diagnostic.
 * We only UPGRADE to completed — never downgrade — because a concurrent request
 * may have already completed the session.
 */
async function reconcileDiagnosticCompletionOnReplay(opts: {
  sessionId: string;
  session: { filters: unknown };
  now: string;
}): Promise<{ shouldComplete: boolean }> {
  const config = await loadPracticeConfig();
  const meta = asSessionMetadata(opts.session.filters);
  meta.active_session_item_id = null;

  const resolvedCount = await countResolvedSessionItems(opts.sessionId);
  const targetQuestionCount = coerceTargetQuestionCount(
    meta.target_question_count,
    config.maxSessionCountPremium,
    config.defaultSessionCountWeb,
  );
  const shouldComplete = resolvedCount >= targetQuestionCount;

  if (shouldComplete) {
    // Idempotent — if already completed by the winning request, this rewrites
    // the same status + completed_at. We never downgrade a completed session.
    await updateSessionLifecycle(opts.sessionId, meta, {
      status: "completed",
      completed_at: opts.now,
    });
  }

  return { shouldComplete };
}

/**
 * @spec [Doc-05C §7.4, Vertical-B Slice 2] @implemented 2026-08-12
 *
 * plain English: capture the current live section projections as frozen
 * diagnostic_baseline snapshots. Called exactly once at diagnostic completion,
 * after compute_section_projection already ran (the throttle fired on the
 * 40th mastery event). Reads the live projection and writes a deliberate
 * snapshot — decoupled from the projection engine.
 *
 * expected outcome: two rows inserted into student_section_projection_snapshots
 * (one for M, one for RW) with snapshot_kind='diagnostic_baseline'. The partial
 * unique index enforces once-only — a second call is a harmless no-op.
 *
 * trade-offs: if the evidence gate hasn't cleared yet (projections are NULL),
 * this is a no-op with a warning. This is defensive — the diagnostic's 8×5=40
 * events should always clear the evidence gate.
 */
export async function captureDiagnosticBaseline(
  userId: string,
  requestId: string,
): Promise<void> {
  // Read both section projections (M + RW) from the already-computed live table.
  const { data: projections, error: readError } = await supabaseServer
    .from("student_section_projections")
    .select(
      "student_id, section, projected_score_mid, projected_score_low, projected_score_high, range_width, relevant_question_count, mastery_term, fl1_score, fl2_score, fl_count_used, blend_denominator, projection_constants_hash, mastery_model_version, refreshed_at_t_now",
    )
    .eq("student_id", userId);

  if (readError) {
    logger.warn("[diagnostic] baseline read failed", {
      requestId,
      userId,
      error: readError.message,
    });
    return;
  }

  const rows = (projections ?? []) as Array<{
    student_id: string;
    section: string;
    projected_score_mid: number | null;
    projected_score_low: number | null;
    projected_score_high: number | null;
    range_width: number | null;
    relevant_question_count: number | null;
    mastery_term: number | null;
    fl1_score: number | null;
    fl2_score: number | null;
    fl_count_used: number;
    blend_denominator: number;
    projection_constants_hash: string | null;
    mastery_model_version: string;
    refreshed_at_t_now: string;
  }>;

  // Both M and RW must have non-NULL projections (evidence gate passed).
  const nonNull = rows.filter((r) => typeof r.projected_score_mid === "number");
  if (nonNull.length < 2) {
    logger.warn(
      "[diagnostic] baseline skipped — projection evidence gate not yet cleared",
      {
        requestId,
        userId,
        sectionCount: nonNull.length,
        totalRows: rows.length,
      },
    );
    return;
  }

  // Insert baseline snapshots — plain INSERT; on unique-violation (23505) from the partial
  // index, treat as idempotent no-op (original baseline preserved). ON CONFLICT cannot
  // reference a partial unique index in PostgreSQL, so we catch 23505 instead.
  const baselineRows = nonNull.map((row) => ({
    student_id: row.student_id,
    section: row.section,
    projected_score_mid: row.projected_score_mid,
    projected_score_low: row.projected_score_low,
    projected_score_high: row.projected_score_high,
    range_width: row.range_width,
    relevant_question_count: row.relevant_question_count,
    mastery_term: row.mastery_term,
    fl1_score: row.fl1_score,
    fl2_score: row.fl2_score,
    fl_count_used: row.fl_count_used,
    blend_denominator: row.blend_denominator,
    projection_constants_hash: row.projection_constants_hash,
    mastery_model_version: row.mastery_model_version,
    refreshed_at_t_now: row.refreshed_at_t_now,
    snapshot_kind: "diagnostic_baseline" as const,
  }));

  // Once-only enforcement: the partial unique index
  // idx_baseline_once_per_student_section (student_id, section WHERE
  // snapshot_kind='diagnostic_baseline') rejects duplicate diagnostic baselines.
  // Because it's a PARTIAL unique index, Supabase's onConflict parameter can't
  // reference it — PostgreSQL requires a non-partial constraint for ON CONFLICT.
  // Instead we do a plain INSERT and treat the unique-violation error (23505)
  // as success: the original baseline is preserved, exactly the DO NOTHING
  // semantics we want.
  const { error: insertError } = await supabaseServer
    .from("student_section_projection_snapshots")
    .insert(baselineRows)
    .select("snapshot_id");

  if (insertError) {
    // 23505 = unique_violation from the partial unique index → baseline already
    // captured. This is the expected idempotent path for a second diagnostic.
    if (insertError.code === "23505") {
      logger.info("[diagnostic] baseline already captured (idempotent no-op)", {
        requestId,
        userId,
      });
      return;
    }
    // Any other error is logged but non-fatal — baseline capture must not block
    // the answer response.
    logger.info("[diagnostic] baseline insert failed (non-fatal)", {
      requestId,
      userId,
      error: insertError.message,
      code: insertError.code,
    });
    return;
  }

  logger.info("[diagnostic] baseline captured", {
    requestId,
    userId,
    sections: nonNull.map((r) => r.section),
  });
}

export async function submitPracticeAnswer(req: Request, res: Response) {
  const requestId = (req as any).requestId;
  const user = (req as any).user;
  const userId = user?.id;

  if (!userId) {
    return res.status(401).json({
      error: "authentication_required",
      message: "Authentication required",
      requestId,
    });
  }

  if (hasLegacyFreeResponseKeys(req.body)) {
    return res.status(400).json({
      error: "invalid_request",
      code: "MC_OPTION_REQUIRED",
      message:
        "free-response answers are not supported on canonical multiple-choice practice submit.",
      requestId,
    });
  }

  const parsed = AnswerBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_request",
      message: "Invalid answer payload",
      requestId,
    });
  }

  const payload = normalizeAnswerPayload(parsed.data);

  if (!payload.selectedAnswer) {
    return res.status(400).json({
      error: "invalid_request",
      message: "An answer is required",
      requestId,
    });
  }

  const ownedSessionResult = await loadOwnedSession(payload.sessionId, userId);

  if (!ownedSessionResult) {
    return res.status(404).json({
      error: "session_not_found",
      message: "Practice session not found",
      requestId,
    });
  }

  if (ownedSessionResult.forbidden) {
    return res.status(403).json({
      error: "forbidden",
      message: "You do not have access to this practice session",
      requestId,
    });
  }

  const session = ownedSessionResult.session;

  const sessionItem = await findSessionItemForSubmission(payload.sessionId, {
    sessionItemId: payload.sessionItemId,
    questionId: payload.questionId,
  });

  if (!sessionItem) {
    return res.status(404).json({
      error: "question_not_served",
      message: "No served practice item found for this session",
      requestId,
    });
  }

  if (sessionItem.user_id !== userId) {
    return res.status(403).json({
      error: "forbidden",
      message: "You do not have access to this practice session item",
      requestId,
    });
  }

  const _sessionMeta = asSessionMetadata(session.filters);
  const sessionState = normalizeSessionState(session.status);

  if (
    sessionState === "completed" ||
    sessionState === "abandoned" ||
    TERMINAL_DB_STATUSES.includes(session.status)
  ) {
    return res.status(409).json({
      error: "session_closed",
      message: "Practice session is read-only",
      requestId,
    });
  }
  const canonicalQuestion = toCanonicalQuestionFromSessionItem(sessionItem);
  if (!canonicalQuestion) {
    return res.status(422).json({
      error: "invalid_question_data",
      message:
        "Persisted session item question snapshot is invalid for grading.",
      requestId,
    });
  }

  const isGridIn = canonicalQuestion.item_type === "grid_in";
  const responseMode = isGridIn ? "grid_in" : "multiple_choice";
  const optionTokenMap = isGridIn
    ? null
    : parseStudentSafeOptionTokenMap(sessionItem.option_token_map);
  const explanation = canonicalQuestion.explanation ?? null;

  // For idempotent replays we need correctOptionId even before gradeAnswer —
  // but only for MCQ. Grid-in has no option tokens.
  const replayCorrectOptionId =
    !isGridIn && optionTokenMap
      ? (Object.entries(optionTokenMap).find(
          (entry) =>
            entry[1] === normalizeAnswerKey(canonicalQuestion.correct_answer),
        )?.[0] ?? null)
      : null;

  if (sessionItem.status !== "served") {
    const resolvedAttemptKey =
      typeof sessionItem.client_attempt_id === "string"
        ? sessionItem.client_attempt_id.trim()
        : "";
    const replayAttemptKey = payload.clientAttemptId?.trim() ?? "";
    if (
      sessionItem.outcome &&
      resolvedAttemptKey &&
      replayAttemptKey === resolvedAttemptKey
    ) {
      // @spec [Doc-05A §11, Codex audit Fix 2] For diagnostic sessions, re-attempt
      // mastery emission on idempotent replay. A prior attempt may have recorded
      // the answer but failed mastery emission (fail-closed 500). applyMasteryEvent
      // is idempotent on event_id — safe to re-emit.
      // @spec [Doc-05A §11, Codex re-audit Fix A] After successful re-emission,
      // run completion reconciliation — the first attempt returned 500 before
      // reaching the completion path, so the session may still be ACTIVE.
      if (session.mode === "diagnostic") {
        const replayNow = sessionItem.answered_at ?? new Date().toISOString();
        const reEmitResult = await reEmitDiagnosticMasteryIfNeeded({
          sessionItem,
          userId,
          requestId,
          sessionId: payload.sessionId,
          isCorrect: !!sessionItem.is_correct,
          occurredAt: replayNow,
        });
        if (!reEmitResult.ok) {
          return res.status(reEmitResult.status).json(reEmitResult.body);
        }
        const { shouldComplete } = await reconcileDiagnosticCompletionOnReplay({
          sessionId: payload.sessionId,
          session,
          now: replayNow,
        });
        return res.json({
          sessionId: payload.sessionId,
          sessionItemId: sessionItem.id,
          isCorrect: !!sessionItem.is_correct,
          mode: responseMode,
          ...(isGridIn
            ? { correctAnswer: canonicalQuestion.correct_answer }
            : { correctOptionId: replayCorrectOptionId }),
          explanation,
          feedback: sessionItem.is_correct
            ? "Correct"
            : sessionItem.outcome === "skipped"
              ? "Skipped"
              : "Incorrect",
          stats: await getSessionStats(payload.sessionId, userId),
          state: shouldComplete ? "completed" : "active",
          idempotentRetried: true,
        });
      }
      return res.json({
        sessionId: payload.sessionId,
        sessionItemId: sessionItem.id,
        isCorrect: !!sessionItem.is_correct,
        mode: responseMode,
        ...(isGridIn
          ? { correctAnswer: canonicalQuestion.correct_answer }
          : { correctOptionId: replayCorrectOptionId }),
        explanation,
        feedback: sessionItem.is_correct
          ? "Correct"
          : sessionItem.outcome === "skipped"
            ? "Skipped"
            : "Incorrect",
        stats: await getSessionStats(payload.sessionId, userId),
        idempotentRetried: true,
      });
    }

    return res.status(409).json({
      error: "session_item_not_open",
      message: "This practice item is already resolved.",
      requestId,
    });
  }

  const gradeResult = gradeAnswer(
    canonicalQuestion,
    payload.selectedAnswer,
    optionTokenMap,
  );
  if (!gradeResult.ok) {
    return res.status(gradeResult.status).json({
      error: gradeResult.error,
      message: gradeResult.message,
      requestId,
    });
  }

  const { isCorrect, outcome, selectedCanonicalKey, correctOptionId } =
    gradeResult;
  const chosen = selectedCanonicalKey;

  const clampedTimeSpentMs = null;
  const now = new Date().toISOString();

  if (payload.clientAttemptId) {
    const existingByKey = await findSessionItemByClientAttemptId(
      userId,
      payload.clientAttemptId,
    );
    if (existingByKey) {
      if (existingByKey.id !== sessionItem.id) {
        return res.status(409).json({
          error: "idempotency_key_reuse",
          message:
            "The provided clientAttemptId is already bound to a different session item.",
          requestId,
        });
      }

      // @spec [Doc-05A §11, Codex audit Fix 2] Diagnostic mastery re-emission
      // on idempotent replay via clientAttemptId lookup — same rationale as the
      // status-check replay path above.
      // @spec [Doc-05A §11, Codex re-audit Fix A] Completion reconciliation after
      // successful re-emission.
      if (session.mode === "diagnostic") {
        const replayNow = existingByKey.answered_at ?? now;
        const reEmitResult = await reEmitDiagnosticMasteryIfNeeded({
          sessionItem: existingByKey,
          userId,
          requestId,
          sessionId: payload.sessionId,
          isCorrect: !!existingByKey.is_correct,
          occurredAt: replayNow,
        });
        if (!reEmitResult.ok) {
          return res.status(reEmitResult.status).json(reEmitResult.body);
        }
        const { shouldComplete } = await reconcileDiagnosticCompletionOnReplay({
          sessionId: payload.sessionId,
          session,
          now: replayNow,
        });
        return res.json({
          sessionId: payload.sessionId,
          sessionItemId: sessionItem.id,
          isCorrect: !!existingByKey.is_correct,
          mode: responseMode,
          ...(isGridIn
            ? { correctAnswer: canonicalQuestion.correct_answer }
            : { correctOptionId }),
          explanation,
          feedback: existingByKey.is_correct
            ? "Correct"
            : existingByKey.outcome === "skipped"
              ? "Skipped"
              : "Incorrect",
          stats: await getSessionStats(payload.sessionId, userId),
          state: shouldComplete ? "completed" : "active",
          idempotentRetried: true,
        });
      }
      return res.json({
        sessionId: payload.sessionId,
        sessionItemId: sessionItem.id,
        isCorrect: !!existingByKey.is_correct,
        mode: responseMode,
        ...(isGridIn
          ? { correctAnswer: canonicalQuestion.correct_answer }
          : { correctOptionId }),
        explanation,
        feedback: existingByKey.is_correct
          ? "Correct"
          : existingByKey.outcome === "skipped"
            ? "Skipped"
            : "Incorrect",
        stats: await getSessionStats(payload.sessionId, userId),
        idempotentRetried: true,
      });
    }
  }

  if (sessionItem.status !== "served") {
    const resolvedAttemptKey =
      typeof sessionItem.client_attempt_id === "string"
        ? sessionItem.client_attempt_id.trim()
        : "";
    const replayAttemptKey = payload.clientAttemptId?.trim() ?? "";
    if (
      sessionItem.outcome &&
      resolvedAttemptKey &&
      replayAttemptKey === resolvedAttemptKey
    ) {
      // @spec [Doc-05A §11, Codex audit Fix 2] Defensive path: diagnostic
      // mastery re-emission — same rationale as the primary replay path above.
      // @spec [Doc-05A §11, Codex re-audit Fix A] Completion reconciliation.
      if (session.mode === "diagnostic") {
        const replayNow = sessionItem.answered_at ?? now;
        const reEmitResult = await reEmitDiagnosticMasteryIfNeeded({
          sessionItem,
          userId,
          requestId,
          sessionId: payload.sessionId,
          isCorrect: !!sessionItem.is_correct,
          occurredAt: replayNow,
        });
        if (!reEmitResult.ok) {
          return res.status(reEmitResult.status).json(reEmitResult.body);
        }
        const { shouldComplete } = await reconcileDiagnosticCompletionOnReplay({
          sessionId: payload.sessionId,
          session,
          now: replayNow,
        });
        return res.json({
          sessionId: payload.sessionId,
          sessionItemId: sessionItem.id,
          isCorrect: !!sessionItem.is_correct,
          mode: responseMode,
          ...(isGridIn
            ? { correctAnswer: canonicalQuestion.correct_answer }
            : { correctOptionId }),
          explanation,
          feedback: sessionItem.is_correct
            ? "Correct"
            : sessionItem.outcome === "skipped"
              ? "Skipped"
              : "Incorrect",
          stats: await getSessionStats(payload.sessionId, userId),
          state: shouldComplete ? "completed" : "active",
          idempotentRetried: true,
        });
      }
      return res.json({
        sessionId: payload.sessionId,
        sessionItemId: sessionItem.id,
        isCorrect: !!sessionItem.is_correct,
        mode: responseMode,
        ...(isGridIn
          ? { correctAnswer: canonicalQuestion.correct_answer }
          : { correctOptionId }),
        explanation,
        feedback: sessionItem.is_correct
          ? "Correct"
          : sessionItem.outcome === "skipped"
            ? "Skipped"
            : "Incorrect",
        stats: await getSessionStats(payload.sessionId, userId),
        idempotentRetried: true,
      });
    }

    return res.status(409).json({
      error: "session_item_not_open",
      message: "This practice item was already resolved by another request.",
      requestId,
    });
  }

  const { data: updatedItem, error: updateItemErr } = await supabaseServer
    .from("practice_session_items")
    .update({
      status: "answered",
      selected_answer: chosen,
      is_correct: isCorrect,
      outcome,
      time_spent_ms: clampedTimeSpentMs,
      answered_at: now,
      occurred_at: now,
      client_attempt_id: payload.clientAttemptId ?? null,
    })
    .eq("id", sessionItem.id)
    .eq("status", "served")
    .select(SESSION_ITEM_SELECT)
    .maybeSingle();

  if (updateItemErr) {
    if (isDuplicateConflict(updateItemErr.message)) {
      return res.status(409).json({
        error: "idempotency_key_reuse",
        message:
          "The provided clientAttemptId is already bound to a different session item.",
        requestId,
      });
    }
    return res.status(500).json({
      error: "session_item_update_failed",
      message: updateItemErr.message,
      requestId,
    });
  }

  if (!updatedItem) {
    const raced = await findSessionItemById(payload.sessionId, sessionItem.id);
    if (raced?.outcome) {
      // @spec [Doc-05A §11, Codex re-audit Fix B] The optimistic-race replay path
      // must guarantee diagnostic mastery emitted (or fail closed) AND complete
      // the session if this was the final answer. Same contract as every other
      // idempotent replay path — source-count parity is not sufficient.
      if (session.mode === "diagnostic") {
        const raceNow = raced.answered_at ?? now;
        const reEmitResult = await reEmitDiagnosticMasteryIfNeeded({
          sessionItem: raced,
          userId,
          requestId,
          sessionId: payload.sessionId,
          isCorrect: !!raced.is_correct,
          occurredAt: raceNow,
        });
        if (!reEmitResult.ok) {
          return res.status(reEmitResult.status).json(reEmitResult.body);
        }
        const { shouldComplete } = await reconcileDiagnosticCompletionOnReplay({
          sessionId: payload.sessionId,
          session,
          now: raceNow,
        });
        return res.json({
          sessionId: payload.sessionId,
          sessionItemId: sessionItem.id,
          isCorrect: !!raced.is_correct,
          mode: responseMode,
          ...(isGridIn
            ? { correctAnswer: canonicalQuestion.correct_answer }
            : { correctOptionId }),
          explanation,
          feedback: raced.is_correct
            ? "Correct"
            : raced.outcome === "skipped"
              ? "Skipped"
              : "Incorrect",
          stats: await getSessionStats(payload.sessionId, userId),
          state: shouldComplete ? "completed" : "active",
          idempotentRetried: true,
        });
      }
      return res.json({
        sessionId: payload.sessionId,
        sessionItemId: sessionItem.id,
        isCorrect: !!raced.is_correct,
        mode: responseMode,
        ...(isGridIn
          ? { correctAnswer: canonicalQuestion.correct_answer }
          : { correctOptionId }),
        explanation,
        feedback: raced.is_correct
          ? "Correct"
          : raced.outcome === "skipped"
            ? "Skipped"
            : "Incorrect",
        stats: await getSessionStats(payload.sessionId, userId),
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
    const canonicalId =
      typeof sessionItem.question_id === "string"
        ? sessionItem.question_id
        : null;
    const section =
      typeof sessionItem.question_section === "string"
        ? sessionItem.question_section.trim()
        : "";
    const domain =
      typeof sessionItem.question_domain === "string"
        ? sessionItem.question_domain.trim()
        : "";
    const skill =
      typeof sessionItem.question_skill === "string"
        ? sessionItem.question_skill.trim()
        : "";
    const difficultyBucket = resolveDifficultyBucketStrict(
      sessionItem.question_difficulty ?? null,
    );
    // @spec [Doc-05A §11.4] Diagnostic items emit event_source_kind='diagnostic_attempt'
    // with source_family='practice' (diagnostics are regular practice events).
    const eventSourceKind: "practice_attempt" | "diagnostic_attempt" =
      session.mode === "diagnostic" ? "diagnostic_attempt" : "practice_attempt";
    if (canonicalId && difficultyBucket && section && domain && skill) {
      // @spec [Doc-05A §11, Codex audit Fix 1] Diagnostic mastery emission is
      // FAIL-CLOSED: applyMasteryEvent returns { ok, error } and does NOT throw
      // on RPC failure. For diagnostic mode, a failed mastery write must not be
      // silently swallowed — the diagnostic must not be presented as completed
      // without its required 40 audit events.
      const masteryResult = await applyMasteryEvent({
        studentId: userId,
        section,
        domain,
        skill,
        difficulty: difficultyBucket,
        sourceFamily: "practice",
        eventSourceKind,
        correct: isCorrect,
        occurredAt: now,
        eventId: sessionItem.id,
        questionId: canonicalId,
      });
      if (!masteryResult.ok && session.mode === "diagnostic") {
        logger.error("[diagnostic] mastery emission failed — fail-closed", {
          requestId,
          sessionId: payload.sessionId,
          questionCanonicalId: canonicalId,
          masteryError: masteryResult.error ?? "unknown",
        });
        return res.status(500).json({
          error: "diagnostic_mastery_emission_failed",
          message:
            "Diagnostic mastery event could not be durably written. The answer was recorded but the diagnostic cannot proceed without its mastery audit trail. Retry the submission.",
          requestId,
        });
      } else if (!masteryResult.ok) {
        // Non-diagnostic: existing warn-and-continue posture (practice sessions
        // do not have the 40-event completeness invariant).
        logger.warn("[practice] mastery emission returned error", {
          requestId,
          sessionId: payload.sessionId,
          questionCanonicalId: canonicalId,
          masteryError: masteryResult.error ?? "unknown",
        });
      }
    } else if (
      canonicalId &&
      difficultyBucket &&
      (!section || !domain || !skill)
    ) {
      // Diagnostic sessions must never skip mastery emission — all 40 items
      // must have complete metadata. Missing metadata is a data integrity defect.
      if (session.mode === "diagnostic") {
        logger.error(
          "[diagnostic] mastery emission impossible (missing metadata) — fail-closed",
          {
            requestId,
            sessionId: payload.sessionId,
            questionCanonicalId: canonicalId,
            section: section || null,
            domain: domain || null,
            skill: skill || null,
          },
        );
        return res.status(500).json({
          error: "diagnostic_mastery_emission_failed",
          message:
            "Diagnostic item lacks required metadata for mastery emission. This is a data integrity defect.",
          requestId,
        });
      }
      logger.warn("[practice] mastery emission skipped (missing metadata)", {
        requestId,
        sessionId: payload.sessionId,
        questionCanonicalId: canonicalId,
        sourceFamily: "practice",
        eventSourceKind,
        section: section || null,
        domain: domain || null,
        skill: skill || null,
      });
    } else if (canonicalId && !difficultyBucket) {
      if (session.mode === "diagnostic") {
        logger.error(
          "[diagnostic] mastery emission impossible (invalid difficulty) — fail-closed",
          {
            requestId,
            sessionId: payload.sessionId,
            questionCanonicalId: canonicalId,
            rawDifficulty: sessionItem.question_difficulty ?? null,
          },
        );
        return res.status(500).json({
          error: "diagnostic_mastery_emission_failed",
          message:
            "Diagnostic item has an invalid difficulty bucket for mastery emission. This is a data integrity defect.",
          requestId,
        });
      }
      logger.warn(
        "[practice] mastery emission skipped (invalid difficulty bucket)",
        {
          requestId,
          sessionId: payload.sessionId,
          questionCanonicalId: canonicalId,
          sourceFamily: "practice",
          eventSourceKind,
          rawDifficulty: sessionItem.question_difficulty ?? null,
        },
      );
    }
  } catch (masteryErr: unknown) {
    const errMsg =
      masteryErr instanceof Error ? masteryErr.message : String(masteryErr);
    // Diagnostic: fail-closed — re-throw so the request does not succeed.
    if (session.mode === "diagnostic") {
      logger.error("[diagnostic] mastery emission threw — fail-closed", {
        requestId,
        sessionId: payload.sessionId,
        message: errMsg,
      });
      return res.status(500).json({
        error: "diagnostic_mastery_emission_failed",
        message:
          "Diagnostic mastery event threw an unexpected error. The answer was recorded but the diagnostic cannot proceed without its mastery audit trail. Retry the submission.",
        requestId,
      });
    }
    logger.warn("[practice] mastery logging failed", {
      requestId,
      message: errMsg,
    });
  }

  const answerConfig = await loadPracticeConfig();
  const refreshedMeta = asSessionMetadata(session.filters);
  refreshedMeta.active_session_item_id = null;

  const resolvedCount = await countResolvedSessionItems(payload.sessionId);
  const targetQuestionCount = coerceTargetQuestionCount(
    refreshedMeta.target_question_count,
    answerConfig.maxSessionCountPremium,
    answerConfig.defaultSessionCountWeb,
  );
  const shouldComplete = resolvedCount >= targetQuestionCount;

  if (shouldComplete) {
    await updateSessionLifecycle(payload.sessionId, refreshedMeta, {
      status: "completed",
      completed_at: now,
    });

    // @spec [Doc-05C §7.4, Vertical-B Slice 2] @implemented 2026-08-12
    // plain English: on diagnostic completion, capture the current section
    // projections as a frozen diagnostic_baseline snapshot — a deliberate,
    // once-only artifact independent of the throttle-driven periodic snapshots.
    //
    // Placement: AFTER updateSessionLifecycle (the session is durably completed)
    // and AFTER compute_section_projection already ran (step 2–5 above fired
    // the throttle on the 40th mastery event). We READ the already-computed
    // live projection and INSERT a snapshot with snapshot_kind='diagnostic_baseline'.
    //
    // Immutability: the partial unique index idx_baseline_once_per_student_section
    // (student_id, section) WHERE snapshot_kind='diagnostic_baseline' enforces once-only.
    // A second insert hits unique-violation (23505), caught as an idempotent no-op
    // inside captureDiagnosticBaseline — the original baseline is preserved. ON CONFLICT
    // cannot reference a partial index, so we catch 23505 instead. Best-effort — a
    // failure here must not block the answer response.
    if (session.mode === "diagnostic") {
      try {
        await captureDiagnosticBaseline(userId, requestId);
      } catch (baselineErr: unknown) {
        const baselineMsg =
          baselineErr instanceof Error
            ? baselineErr.message
            : String(baselineErr);
        logger.warn("[diagnostic] baseline capture failed (non-fatal)", {
          requestId,
          sessionId: payload.sessionId,
          message: baselineMsg,
        });
      }
    }
  } else {
    await updateSessionLifecycle(payload.sessionId, refreshedMeta, {
      status: "active",
    });
  }

  return res.json({
    sessionId: payload.sessionId,
    sessionItemId: sessionItem.id,
    isCorrect,
    mode: responseMode,
    ...(isGridIn
      ? { correctAnswer: canonicalQuestion.correct_answer }
      : { correctOptionId }),
    explanation,
    feedback: isCorrect ? "Correct" : "Incorrect",
    stats: await getSessionStats(payload.sessionId, userId),
    state: shouldComplete ? "completed" : "active",
  });
}

async function submitPracticeSkip(req: Request, res: Response) {
  const requestId = (req as any).requestId;
  const user = (req as any).user;
  const userId = user?.id;

  if (!userId) {
    return res.status(401).json({
      error: "authentication_required",
      message: "Authentication required",
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

  const parsed = SkipBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_request",
      message: "Invalid skip payload",
      requestId,
    });
  }

  const payload = normalizeSkipPayload(sessionId, parsed.data);
  const ownedSessionResult = await loadOwnedSession(sessionId, userId);

  if (!ownedSessionResult) {
    return res.status(404).json({
      error: "session_not_found",
      message: "Practice session not found",
      requestId,
    });
  }

  if (ownedSessionResult.forbidden) {
    return res.status(403).json({
      error: "forbidden",
      message: "You do not have access to this practice session",
      requestId,
    });
  }

  const session = ownedSessionResult.session;
  const sessionMeta = asSessionMetadata(session.filters);
  const sessionState = normalizeSessionState(session.status);

  if (
    sessionState === "completed" ||
    sessionState === "abandoned" ||
    TERMINAL_DB_STATUSES.includes(session.status)
  ) {
    return res.status(409).json({
      error: "session_closed",
      message: "Practice session is read-only",
      requestId,
    });
  }

  const requestClient = normalizeClientInstanceId(payload.clientInstanceId);
  const binding = resolveClientInstanceBinding({
    boundClientInstanceId: sessionMeta.client_instance_id,
    requestedClientInstanceId: requestClient,
  });
  if (requestClient && binding.action === "conflict") {
    return sendClientConflict(res, requestId, binding.boundClientInstanceId);
  }

  const sessionItem = await findSessionItemForSubmission(sessionId, {
    sessionItemId: payload.sessionItemId,
    questionId: payload.questionId,
  });

  if (!sessionItem) {
    return res.status(404).json({
      error: "question_not_served",
      message: "No served practice item found for this session",
      requestId,
    });
  }

  if (sessionItem.user_id !== userId) {
    return res.status(403).json({
      error: "forbidden",
      message: "You do not have access to this practice session item",
      requestId,
    });
  }

  const _questionId = String(sessionItem.question_id);
  const skipItemType =
    normalizeItemType(sessionItem.question_item_type ?? null) ?? "mcq";
  const skipResponseMode =
    skipItemType === "grid_in" ? "grid_in" : "multiple_choice";

  if (payload.clientAttemptId) {
    const existingByKey = await findSessionItemByClientAttemptId(
      userId,
      payload.clientAttemptId,
    );
    if (existingByKey) {
      if (existingByKey.id !== sessionItem.id) {
        return res.status(409).json({
          error: "idempotency_key_reuse",
          message:
            "The provided clientAttemptId is already bound to a different session item.",
          requestId,
        });
      }

      const existingStats = await getSessionStats(sessionId, userId);
      return res.json({
        sessionId,
        sessionItemId: sessionItem.id,
        skipped: true,
        mode: skipResponseMode,
        feedback: "Skipped",
        stats: existingStats,
        state: sessionState,
        idempotentRetried: true,
      });
    }
  }

  if (sessionItem.status !== "served") {
    if (sessionItem.outcome) {
      const existingStats = await getSessionStats(sessionId, userId);
      return res.json({
        sessionId,
        sessionItemId: sessionItem.id,
        skipped: sessionItem.outcome === "skipped",
        mode: skipResponseMode,
        feedback: sessionItem.outcome === "skipped" ? "Skipped" : "Resolved",
        stats: existingStats,
        state: sessionState,
        idempotentRetried: true,
      });
    }
    return res.status(409).json({
      error: "session_item_not_open",
      message: "This practice item is already resolved.",
      requestId,
    });
  }

  const now = new Date().toISOString();

  const { data: updatedItem, error: updateItemErr } = await supabaseServer
    .from("practice_session_items")
    .update({
      status: "skipped",
      selected_answer: null,
      is_correct: false,
      outcome: "skipped",
      time_spent_ms: null,
      answered_at: now,
      occurred_at: now,
      client_attempt_id: payload.clientAttemptId ?? null,
    })
    .eq("id", sessionItem.id)
    .eq("status", "served")
    .select(SESSION_ITEM_SELECT)
    .maybeSingle();

  if (updateItemErr) {
    if (isDuplicateConflict(updateItemErr.message)) {
      return res.status(409).json({
        error: "idempotency_key_reuse",
        message:
          "The provided clientAttemptId is already bound to a different session item.",
        requestId,
      });
    }
    return res.status(500).json({
      error: "session_item_update_failed",
      message: updateItemErr.message,
      requestId,
    });
  }

  if (!updatedItem) {
    const raced = await findSessionItemById(sessionId, sessionItem.id);
    if (raced?.outcome) {
      const raceStats = await getSessionStats(sessionId, userId);
      return res.json({
        sessionId,
        sessionItemId: sessionItem.id,
        skipped: raced.outcome === "skipped",
        mode: skipResponseMode,
        feedback: raced.outcome === "skipped" ? "Skipped" : "Resolved",
        stats: raceStats,
        state: normalizeSessionState(session.status),
        idempotentRetried: true,
      });
    }

    return res.status(409).json({
      error: "session_item_not_open",
      message: "This practice item was already resolved by another request.",
      requestId,
    });
  }

  const skipConfig = await loadPracticeConfig();
  const refreshedMeta = asSessionMetadata(session.filters);
  refreshedMeta.active_session_item_id = null;

  const resolvedCount = await countResolvedSessionItems(sessionId);
  const targetQuestionCount = coerceTargetQuestionCount(
    refreshedMeta.target_question_count,
    skipConfig.maxSessionCountPremium,
    skipConfig.defaultSessionCountWeb,
  );
  const shouldComplete = resolvedCount >= targetQuestionCount;

  if (shouldComplete) {
    await updateSessionLifecycle(sessionId, refreshedMeta, {
      status: "completed",
      completed_at: now,
    });
  } else {
    await updateSessionLifecycle(sessionId, refreshedMeta, {
      status: "active",
    });
  }

  return res.json({
    sessionId,
    sessionItemId: sessionItem.id,
    skipped: true,
    mode: skipResponseMode,
    feedback: "Skipped",
    stats: await getSessionStats(sessionId, userId),
    state: shouldComplete ? "completed" : "active",
  });
}
router.post(
  "/answer",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  practiceAnswerRateLimiter,
  submitPracticeAnswer,
);
router.post(
  "/sessions/:sessionId/skip",
  requireSupabaseAuth,
  requireProfileComplete,
  requireConsentCompliance,
  practiceAnswerRateLimiter,
  submitPracticeSkip,
);

export default router;
