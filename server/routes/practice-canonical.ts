import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import * as crypto from "node:crypto";
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

type StudentSafeOption = {
  id: string;
  text: string;
};

type StudentSafeQuestionDTO = {
  sessionItemId: string;
  stem: string;
  section: string;
  questionType: "multiple_choice";
  options: StudentSafeOption[];
  difficulty: string | number | null;
  correct_answer: null;
  explanation: null;
};

type CanonicalQuestionForServing = {
  id: string;
  canonical_id: string;
  section: string;
  stem: string;
  options: McOption[];
  difficulty: string | number | null;
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
  question_canonical_id?: string | null;
  option_order?: string[] | null;
  option_token_map?: Record<string, string> | null;
  ordinal: number;
  status: "queued" | "served" | "answered" | "skipped";
  attempt_id?: string | null;
  client_instance_id?: string | null;
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
  difficulties: Array<"easy" | "medium" | "hard">;
  target_minutes: number | null;
  target_question_count: number;
  mode: string;
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
const TARGET_SECONDS_PER_QUESTION = 90;

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
  sections: z.array(z.string().max(64)).max(20).optional().nullable(),
  domains: z.array(z.string().max(128)).max(100).optional().nullable(),
  difficulties: z.array(z.string().max(32)).max(10).optional().nullable(),
  mode: z.string().max(64).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
  target_minutes: z.number().int().positive().max(300).optional().nullable(),
  target_question_count: z.number().int().positive().max(200).optional().nullable(),
});

const AnswerBodySchema = z.object({
  sessionId: z.string().uuid(),
  sessionItemId: z.string().uuid().optional(),
  questionId: z.string().uuid().optional(),
  selectedAnswer: z.string().trim().max(32).optional().nullable(),
  selectedOptionId: z.string().trim().max(32).optional().nullable(),
  answer: z.string().trim().max(32).optional().nullable(),
  clientAttemptId: z.string().max(128).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
});

const SkipBodySchema = z.object({
  sessionItemId: z.string().uuid().optional(),
  questionId: z.string().uuid().optional(),
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

function normalizeAnswerPayload(input: z.infer<typeof AnswerBodySchema>): NormalizedAnswerPayload {
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
    typeof input.clientAttemptId === "string" && input.clientAttemptId.trim().length > 0
      ? input.clientAttemptId.trim()
      : null;

  const clientInstanceId =
    typeof input.client_instance_id === "string" && input.client_instance_id.trim().length > 0
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

function normalizeSkipPayload(sessionId: string, input: z.infer<typeof SkipBodySchema>): SkipPayload {
  const clientAttemptId =
    typeof input.clientAttemptId === "string" && input.clientAttemptId.trim().length > 0
      ? input.clientAttemptId.trim()
      : null;

  const clientInstanceId =
    typeof input.client_instance_id === "string" && input.client_instance_id.trim().length > 0
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
  return Object.prototype.hasOwnProperty.call(record, "freeResponseAnswer")
    || Object.prototype.hasOwnProperty.call(record, "free_response_answer");
}

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
    const normalized = item.trim().toLowerCase();
    if (!normalized || normalized.length > maxLen) continue;
    deduped.add(normalized);
  }
  return Array.from(deduped).sort((a, b) => a.localeCompare(b));
}

function normalizeDifficulties(raw: unknown): Array<"easy" | "medium" | "hard"> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<"easy" | "medium" | "hard">();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const s = item.trim().toLowerCase();
    if (s === "easy" || s === "1") seen.add("easy");
    else if (s === "medium" || s === "2") seen.add("medium");
    else if (s === "hard" || s === "3") seen.add("hard");
  }
  return ["easy", "medium", "hard"].filter((value) => seen.has(value as "easy" | "medium" | "hard")) as Array<"easy" | "medium" | "hard">;
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
    const normalized = normalizeAnswerKey(key);
    if (!normalized) continue;
    options.push({ key: normalized, text });
  }

  return options;
}

function parseStoredOptionOrder(raw: unknown): string[] | null {
  if (Array.isArray(raw)) {
    const values = raw
      .map((v) => (typeof v === "string" ? normalizeAnswerKey(v) : null))
      .filter((v) => !!v) as string[];
    return values.length > 0 ? values : null;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) return null;
      const values = inner.split(",").map((k) => normalizeAnswerKey(k.trim())).filter((k) => !!k) as string[];
      return values.length > 0 ? values : null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return parseStoredOptionOrder(parsed);
    } catch {
      return null;
    }
  }

  return null;
}

function parseStoredOptionTokenMap(raw: unknown): Record<string, string> | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const out: Record<string, string> = {};
  for (const [token, keyRaw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof token !== "string" || token.trim().length === 0) return null;
    const normalizedKey = normalizeAnswerKey(keyRaw);
    if (!normalizedKey) return null;
    out[token] = normalizedKey;
  }

  return Object.keys(out).length > 0 ? out : null;
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

  const optionTokenMap: Record<string, string> = {};
  const safeOptions: StudentSafeOption[] = shuffled.map((o) => {
    let token = "opt_" + crypto.randomBytes(8).toString("hex");
    while (optionTokenMap[token]) {
      token = "opt_" + crypto.randomBytes(8).toString("hex");
    }
    optionTokenMap[token] = o.key;
    return { id: token, text: o.text };
  });

  return {
    optionOrder,
    optionTokenMap,
    safeOptions,
  };
}

function buildSafeOptionsFromStoredMap(options: McOption[], optionOrderRaw: unknown, optionTokenMapRaw: unknown): StudentSafeOption[] | null {
  const optionOrder = parseStoredOptionOrder(optionOrderRaw);
  const optionTokenMap = parseStoredOptionTokenMap(optionTokenMapRaw);
  if (!optionOrder || !optionTokenMap) return null;

  if (optionOrder.length !== options.length) return null;

  const optionByKey = new Map<string, string>();
  for (const opt of options) {
    const normalized = normalizeAnswerKey(opt.key);
    if (!normalized) return null;
    optionByKey.set(normalized, opt.text);
  }

  const canonicalKeys = new Set(optionByKey.keys());
  if (canonicalKeys.size !== options.length) return null;

  const orderKeySet = new Set(optionOrder);
  if (orderKeySet.size !== optionOrder.length) return null;
  if (!Array.from(orderKeySet).every((key) => canonicalKeys.has(key))) return null;

  const entries = Object.entries(optionTokenMap);
  if (entries.length !== options.length) return null;

  const tokenSet = new Set<string>();
  const mappedKeySet = new Set<string>();
  const tokenByKey = new Map<string, string>();

  for (const [token, key] of entries) {
    if (!token || !key) return null;
    if (tokenSet.has(token)) return null;
    tokenSet.add(token);

    if (!canonicalKeys.has(key)) return null;
    if (mappedKeySet.has(key)) return null;
    mappedKeySet.add(key);
    tokenByKey.set(key, token);
  }

  const safeOptions: StudentSafeOption[] = [];
  for (const key of optionOrder) {
    const token = tokenByKey.get(key);
    const textValue = optionByKey.get(key);
    if (!token || !textValue) return null;
    safeOptions.push({ id: token, text: textValue });
  }

  return safeOptions;
}

function toCanonicalQuestionForServing(q: any): CanonicalQuestionForServing {
  return {
    id: String(q.id),
    canonical_id: String(q.canonical_id),
    section: String(q.section ?? q.section_code ?? ""),
    stem: String(q.stem ?? ""),
    options: safeParseOptions(q.options),
    difficulty: q.difficulty ?? null,
  };
}

function toStudentSafeQuestionDTO(args: {
  sessionItemId: string;
  question: CanonicalQuestionForServing;
  safeOptions: StudentSafeOption[];
}): StudentSafeQuestionDTO {
  return {
    sessionItemId: args.sessionItemId,
    section: args.question.section,
    stem: args.question.stem,
    questionType: "multiple_choice",
    options: args.safeOptions,
    difficulty: args.question.difficulty ?? null,
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

function deriveTargetQuestionCountFromMinutes(targetMinutes: number): number {
  const derived = Math.round((targetMinutes * 60) / TARGET_SECONDS_PER_QUESTION);
  return coerceTargetQuestionCount(derived);
}

function resolveSectionForSession(specSections: Array<"Math" | "RW">, legacySection: "Math" | "RW" | "Random"): "Math" | "RW" | "Random" {
  if (specSections.length === 1) return specSections[0];
  if (specSections.length > 1) return "Random";
  return legacySection;
}

function normalizeSessionSpec(input: z.infer<typeof StartSessionBodySchema>): {
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
  const targetMinutes = typeof input.target_minutes === "number" ? Math.floor(input.target_minutes) : null;
  const explicitTargetCount = coerceTargetQuestionCount(input.target_question_count);
  const hasExplicitTargetCount = typeof input.target_question_count === "number" && Number.isFinite(input.target_question_count);
  const effectiveTargetCount = targetMinutes && !hasExplicitTargetCount
    ? deriveTargetQuestionCountFromMinutes(targetMinutes)
    : explicitTargetCount;

  return {
    section: resolveSectionForSession(sectionValues, legacySection),
    targetQuestionCount: effectiveTargetCount,
    sessionSpec: {
      sections: sectionValues,
      domains: normalizeStringList(input.domains, 128),
      difficulties: normalizeDifficulties(input.difficulties),
      target_minutes: targetMinutes,
      target_question_count: effectiveTargetCount,
      mode,
    },
  };
}

function normalizeStoredSessionSpec(raw: unknown): Partial<CanonicalSessionSpec> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const sections = normalizeSectionList(record.sections);
  const domains = normalizeStringList(record.domains, 128);
  const difficulties = normalizeDifficulties(record.difficulties);
  const mode = typeof record.mode === "string" && record.mode.trim().length > 0
    ? record.mode.trim()
    : undefined;

  const targetMinutes = typeof record.target_minutes === "number" && Number.isFinite(record.target_minutes)
    ? Math.floor(record.target_minutes)
    : null;

  const targetQuestionCount = coerceTargetQuestionCount(record.target_question_count);

  return {
    sections,
    domains,
    difficulties,
    target_minutes: targetMinutes,
    target_question_count: targetQuestionCount,
    mode,
  };
}

function resolveSessionSpecForSelection(args: {
  session: SessionRow;
  metadata: SessionMetadata;
}): {
  sections: Array<"Math" | "RW">;
  domains: string[];
  difficulties: Array<"easy" | "medium" | "hard">;
} {
  const stored = normalizeStoredSessionSpec(args.metadata.session_spec);
  const sections = stored?.sections ?? [];
  const domains = stored?.domains ?? [];
  const difficulties = stored?.difficulties ?? [];

  if (sections.length > 0) {
    return { sections, domains, difficulties };
  }

  const fallbackSection = normalizeSectionToken(args.session.section);
  return {
    sections: fallbackSection ? [fallbackSection] : [],
    domains,
    difficulties,
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

function filterPoolBySessionSpec(
  pool: any[],
  spec: {
    domains: string[];
    difficulties: Array<"easy" | "medium" | "hard">;
  },
): any[] {
  let filtered = pool;

  if (spec.domains.length > 0) {
    const allowedDomains = new Set(spec.domains.map((v) => v.toLowerCase()));
    filtered = filtered.filter((row) => {
      const domain = String((row as any).domain ?? "").trim().toLowerCase();
      return domain.length > 0 && allowedDomains.has(domain);
    });
  }

  if (spec.difficulties.length > 0) {
    const allowedDifficultyCodes = new Set<number>();
    for (const difficulty of spec.difficulties) {
      if (difficulty === "easy") allowedDifficultyCodes.add(1);
      if (difficulty === "medium") allowedDifficultyCodes.add(2);
      if (difficulty === "hard") allowedDifficultyCodes.add(3);
    }
    filtered = filtered.filter((row) => allowedDifficultyCodes.has(coerceQuestionDifficulty((row as any).difficulty)));
  }

  return filtered;
}

async function listExactFilteredQuestionPool(spec: {
  sections: Array<"Math" | "RW">;
  domains: string[];
  difficulties: Array<"easy" | "medium" | "hard">;
}): Promise<{ pool: CanonicalQuestionForServing[] } | { error: string }> {
  let query = supabaseServer
    .from("questions")
    .select("id, canonical_id, status, section, section_code, stem, question_type, options, difficulty, correct_answer, domain, skill")
    .eq("status", "published")
    .eq("question_type", "multiple_choice")
    .limit(1000);

  const allowedSectionCodes = resolveAllowedSectionCodes(spec.sections);
  if (allowedSectionCodes.length > 0) {
    query = query.in("section_code", allowedSectionCodes);
  }

  const { data, error } = await query;
  if (error) {
    return { error: `questions_query_failed: ${error.message}` };
  }

  const validPool = (data ?? []).filter((row: any) => isCanonicalPublishedMcQuestion(row as any));
  const exactPool = filterPoolBySessionSpec(validPool, {
    domains: spec.domains,
    difficulties: spec.difficulties,
  });

  const ordered = exactPool
    .map((row: any) => toCanonicalQuestionForServing(row))
    .sort((a, b) => {
      if (a.canonical_id !== b.canonical_id) return a.canonical_id.localeCompare(b.canonical_id);
      return a.id.localeCompare(b.id);
    });

  return { pool: ordered };
}

function buildDeterministicPrebuiltSet(pool: CanonicalQuestionForServing[], targetCount: number): {
  selected: CanonicalQuestionForServing[];
  selectionMode: "exact" | "exact_reuse";
  sourcePoolCount: number;
} {
  const sourcePoolCount = pool.length;
  if (sourcePoolCount === 0) {
    return {
      selected: [],
      selectionMode: "exact",
      sourcePoolCount: 0,
    };
  }

  const selected: CanonicalQuestionForServing[] = [];
  for (let i = 0; i < targetCount; i += 1) {
    selected.push(pool[i % sourcePoolCount]);
  }

  return {
    selected,
    selectionMode: sourcePoolCount < targetCount ? "exact_reuse" : "exact",
    sourcePoolCount,
  };
}

async function countSessionItems(sessionId: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from("practice_session_items")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);

  if (error) {
    throw new Error(`practice_session_items_count_all_failed: ${error.message}`);
  }

  return Number.isFinite(count as number) ? Number(count) : 0;
}

async function prebuildSessionItems(args: {
  sessionId: string;
  userId: string;
  clientInstanceId: string;
  targetCount: number;
  sessionSpec: CanonicalSessionSpec;
}): Promise<{ ok: true; requestedCount: number; sourcePoolCount: number; selectionMode: "exact" | "exact_reuse" } | { ok: false; status: number; body: Record<string, unknown> }> {
  const existingCount = await countSessionItems(args.sessionId);
  if (existingCount > 0) {
    return {
      ok: true,
      requestedCount: args.targetCount,
      sourcePoolCount: existingCount,
      selectionMode: "exact",
    };
  }

  const poolResult = await listExactFilteredQuestionPool({
    sections: args.sessionSpec.sections,
    domains: args.sessionSpec.domains,
    difficulties: args.sessionSpec.difficulties,
  });

  if ("error" in poolResult) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_prebuild_failed",
        message: poolResult.error,
      },
    };
  }

  if (poolResult.pool.length === 0) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "empty_exact_pool",
        code: "PRACTICE_EXACT_POOL_EMPTY",
        message: "No published multiple-choice questions match the requested session filters.",
      },
    };
  }

  const prebuilt = buildDeterministicPrebuiltSet(poolResult.pool, args.targetCount);

  const rows = prebuilt.selected.map((question, idx) => ({
    session_id: args.sessionId,
    user_id: args.userId,
    question_id: question.id,
    question_canonical_id: question.canonical_id,
    ordinal: idx + 1,
    status: idx === 0 ? "served" : "queued",
    attempt_id: null,
    client_instance_id: idx === 0 ? args.clientInstanceId : null,
    option_order: null,
    option_token_map: null,
    answered_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseServer
    .from("practice_session_items")
    .insert(rows);

  if (error) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "session_prebuild_failed",
        message: error.message,
      },
    };
  }

  return {
    ok: true,
    requestedCount: args.targetCount,
    sourcePoolCount: prebuilt.sourcePoolCount,
    selectionMode: prebuilt.selectionMode,
  };
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

async function fetchQuestionForServing(questionId: string): Promise<CanonicalQuestionForServing | null> {
  const { data, error } = await supabaseServer
    .from("questions")
    .select("id, canonical_id, status, section, section_code, stem, question_type, options, difficulty, correct_answer")
    .eq("id", questionId)
    .eq("status", "published")
    .eq("question_type", "multiple_choice")
    .single();

  if (error || !data) return null;
  if (!isCanonicalPublishedMcQuestion(data as any)) return null;

  return toCanonicalQuestionForServing(data);
}

async function getCurrentUnansweredItem(sessionId: string): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("id, session_id, user_id, question_id, question_canonical_id, option_order, option_token_map, ordinal, status, attempt_id, client_instance_id")
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
    .select("id, session_id, user_id, question_id, question_canonical_id, option_order, option_token_map, ordinal, status, attempt_id, client_instance_id")
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
    .from("answer_attempts")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);

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
    .from("answer_attempts")
    .select("outcome")
    .eq("session_id", sessionId);

  if (error) {
    throw new Error(`practice_session_progress_count_failed: ${error.message}`);
  }

  const attempts = data ?? [];
  const completedCount = attempts.length;
  const skippedCount = attempts.filter((row: any) => row?.outcome === "skipped").length;
  const answeredCount = Math.max(0, completedCount - skippedCount);

  return {
    answeredCount,
    skippedCount,
    completedCount,
  };
}

async function pickDeterministicQuestion(args: {
  section: "Math" | "RW" | "Random";
  sections: Array<"Math" | "RW">;
  domains: string[];
  difficulties: Array<"easy" | "medium" | "hard">;
  userId: string;
  sessionId: string;
  nextOrdinal: number;
  excludedQuestionIds: string[];
}): Promise<{ question: CanonicalQuestionForServing } | { error: string }> {
    let query = supabaseServer
    .from("questions")
    .select("id, canonical_id, status, section, section_code, stem, question_type, options, difficulty, correct_answer, domain, skill")
    .eq("status", "published")
    .eq("question_type", "multiple_choice")
    .limit(500);

  const allowedSectionCodes = resolveAllowedSectionCodes(args.sections);
  if (allowedSectionCodes.length > 0) {
    query = query.in("section_code", allowedSectionCodes);
  } else if (args.section === "Math") {
    query = query.in("section_code", resolveSectionFilterValues("math") ?? ["M", "MATH"]);
  } else if (args.section === "RW") {
    query = query.in("section_code", resolveSectionFilterValues("rw") ?? ["RW"]);
  }

  const { data: pool, error } = await query;
  if (error) {
    return { error: `questions_query_failed: ${error.message}` };
  }

  const validPool = (pool ?? []).filter((row: any) => isCanonicalPublishedMcQuestion(row as any));
  const specFilteredPool = filterPoolBySessionSpec(validPool, {
    domains: args.domains,
    difficulties: args.difficulties,
  });
  const effectivePool = specFilteredPool.length > 0 ? specFilteredPool : validPool;

  if (effectivePool.length === 0) {
    return { error: "no_valid_questions_available" };
  }

  const excluded = new Set(args.excludedQuestionIds);
  const candidatePool = effectivePool.filter((row: any) => !excluded.has(row.id));
  const usablePool = candidatePool.length > 0 ? candidatePool : effectivePool;

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
    const scores = Array.from(masteryMap.values());
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
      tieBreaker: simpleHash(`${args.sessionId}:${args.nextOrdinal}:${row.canonical_id}`),
      canonicalId: String(row.canonical_id),
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

  return { question: toCanonicalQuestionForServing(chosen) };
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
    replayMeta.session_spec = replayMeta.session_spec ?? args.sessionSpec;

    if (args.idempotencyKey) {
      replayMeta.session_start_idempotency_key = args.idempotencyKey;
    }

    const existingItemCount = await countSessionItems(replay.id);
    if (existingItemCount > 0) {
      replayMeta.prebuilt = true;
      replayMeta.requested_count = coerceTargetQuestionCount(replayMeta.target_question_count);
      replayMeta.source_pool_count = Number.isFinite(replayMeta.source_pool_count as number)
        ? Number(replayMeta.source_pool_count)
        : existingItemCount;
      replayMeta.selection_mode = replayMeta.selection_mode === "exact_reuse" ? "exact_reuse" : "exact";
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
    session_spec: args.sessionSpec,
    prebuilt: false,
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

  const prebuilt = await prebuildSessionItems({
    sessionId: String((newSession as any).id),
    userId: args.userId,
    clientInstanceId: args.clientInstanceId,
    targetCount: coerceTargetQuestionCount(args.targetQuestionCount),
    sessionSpec: args.sessionSpec,
  });

  if (!prebuilt.ok) {
    return {
      ok: false,
      status: prebuilt.status,
      body: prebuilt.body,
    };
  }

  const newMetadata = asSessionMetadata((newSession as any).metadata);
  newMetadata.prebuilt = true;
  newMetadata.requested_count = prebuilt.requestedCount;
  newMetadata.source_pool_count = prebuilt.sourcePoolCount;
  newMetadata.selection_mode = prebuilt.selectionMode;
  newMetadata.target_question_count = coerceTargetQuestionCount(args.targetQuestionCount);
  newMetadata.session_spec = args.sessionSpec;

  await updateSessionLifecycle(String((newSession as any).id), newMetadata, {
    status: "in_progress",
    completed: false,
  });

  return {
    ok: true,
    session: {
      ...(newSession as SessionRow),
      metadata: newMetadata,
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
    .select("id, user_id, section, mode, status, completed, metadata")
    .eq("id", sessionId)
    .single();

  if (error || !data) return null;
  if ((data as any).user_id !== userId) {
    if (options?.hideForbidden) return null;
    return { forbidden: true, session: data as SessionRow };
  }
  return { forbidden: false, session: data as SessionRow };
}

async function getNextPrebuiltQueuedItem(sessionId: string): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("id, session_id, user_id, question_id, question_canonical_id, option_order, option_token_map, ordinal, status, attempt_id, client_instance_id")
    .eq("session_id", sessionId)
    .eq("status", "queued")
    .eq("attempt_id", null)
    .order("ordinal", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`practice_session_items_next_prebuilt_failed: ${error.message}`);
  }

  return (data as SessionItemRow | null) ?? null;
}

async function findSessionItemById(sessionId: string, sessionItemId: string): Promise<SessionItemRow | null> {
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("id, session_id, user_id, question_id, question_canonical_id, option_order, option_token_map, ordinal, status, attempt_id, client_instance_id")
    .eq("session_id", sessionId)
    .eq("id", sessionItemId)
    .maybeSingle();

  if (error) {
    throw new Error(`practice_session_item_lookup_failed: ${error.message}`);
  }

  return (data as SessionItemRow | null) ?? null;
}

async function findAttemptBySessionItemId(sessionItemId: string, userId: string): Promise<any | null> {
  const { data, error } = await supabaseServer
    .from("answer_attempts")
    .select("id, session_id, question_id, session_item_id, is_correct, outcome")
    .eq("session_item_id", sessionItemId)
    .eq("user_id", userId)
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
    const bySessionItem = await findAttemptBySessionItemId(args.sessionItemId, args.userId);
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

  const owned = await loadOwnedSession(args.sessionId, args.userId, { hideForbidden: true });
  if (!owned) {
    return args.res.status(404).json({
      error: "session_not_found",
      message: "Practice session not found",
      requestId,
    });
  }
  const session = owned.session;

  const metadata = asSessionMetadata(session.metadata);
  const sessionState = normalizeSessionState(session.status, metadata);
  const selectionSpec = resolveSessionSpecForSelection({ session, metadata });

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
    const canonicalQuestion = await fetchQuestionForServing(unresolved.question_id);
    if (!canonicalQuestion) {
      return args.res.status(422).json({
        error: "invalid_question_data",
        message: "Unable to resume the current question due to invalid canonical data.",
        requestId,
      });
    }

    let safeOptions = buildSafeOptionsFromStoredMap(canonicalQuestion.options, unresolved.option_order, unresolved.option_token_map);

    if (!safeOptions) {
      const rebuilt = buildServedOptions(canonicalQuestion.options);
      safeOptions = rebuilt.safeOptions;

      const rebuildPatch = {
        question_canonical_id: canonicalQuestion.canonical_id,
        option_order: rebuilt.optionOrder,
        option_token_map: rebuilt.optionTokenMap,
        updated_at: new Date().toISOString(),
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
      calculatorState: metadata.calculator_state ?? null,
      question: toStudentSafeQuestionDTO({
        sessionItemId: unresolved.id,
        question: canonicalQuestion,
        safeOptions,
      }),
      stats: await getSessionStats(args.sessionId, args.userId),
    });
  }

  const access = await resolvePracticeAccess(args.userId, args.role);
  if (!access.allowed) {
    return sendPracticeLimitDenied(args.res, access, requestId);
  }

  if (metadata.prebuilt) {
    const nextPrebuilt = await getNextPrebuiltQueuedItem(args.sessionId);
    if (!nextPrebuilt) {
      metadata.lifecycle_state = "completed";
      metadata.active_session_item_id = null;
      await updateSessionLifecycle(args.sessionId, metadata, {
        status: "completed",
        completed: true,
        finished_at: new Date().toISOString(),
      });

      return args.res.status(409).json({
        error: "session_closed",
        message: "Practice session is read-only",
        requestId,
      });
    }

    const canonicalQuestion = await fetchQuestionForServing(nextPrebuilt.question_id);
    if (!canonicalQuestion) {
      return args.res.status(422).json({
        error: "invalid_question_data",
        message: "Unable to load next prebuilt question due to invalid canonical data.",
        requestId,
      });
    }

    const servedOptions = buildServedOptions(canonicalQuestion.options);
    const now = new Date().toISOString();

    const { data: promoted, error: promoteErr } = await supabaseServer
      .from("practice_session_items")
      .update({
        status: "served",
        option_order: servedOptions.optionOrder,
        option_token_map: servedOptions.optionTokenMap,
        client_instance_id: args.clientInstanceId,
        updated_at: now,
      })
      .eq("id", nextPrebuilt.id)
      .eq("status", "queued")
      .eq("attempt_id", null)
      .select("id, session_id, user_id, question_id, question_canonical_id, option_order, option_token_map, ordinal, status, attempt_id, client_instance_id")
      .maybeSingle();

    if (promoteErr || !promoted) {
      return args.res.status(500).json({
        error: "session_item_promote_failed",
        message: promoteErr?.message ?? "Unable to promote next prebuilt item",
        requestId,
      });
    }

    metadata.lifecycle_state = "active";
    metadata.active_session_item_id = promoted.id;
    metadata.last_served_ordinal = promoted.ordinal;
    await updateSessionLifecycle(args.sessionId, metadata, {
      status: "in_progress",
    });

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
      sessionItemId: promoted.id,
      ordinal: promoted.ordinal,
      state: "active",
      calculatorState: metadata.calculator_state ?? null,
      question: toStudentSafeQuestionDTO({
        sessionItemId: promoted.id,
        question: canonicalQuestion,
        safeOptions: servedOptions.safeOptions,
      }),
      stats: await getSessionStats(args.sessionId, args.userId),
    });
  }

  const latestItem = await getLatestSessionItem(args.sessionId);
  const nextOrdinal = (latestItem?.ordinal ?? 0) + 1;
  const excludedQuestionIds = await listSessionQuestionIds(args.sessionId);

  const picked = await pickDeterministicQuestion({
    section: normalizeSectionParam(session.section),
    sections: selectionSpec.sections,
    domains: selectionSpec.domains,
    difficulties: selectionSpec.difficulties,
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

  const servedOptions = buildServedOptions(picked.question.options);

  const now = new Date().toISOString();
  const newSessionItemId = crypto.randomUUID();

  const { data: insertedItem, error: insertErr } = await supabaseServer
    .from("practice_session_items")
    .insert({
      id: newSessionItemId,
      session_id: args.sessionId,
      user_id: args.userId,
      question_id: picked.question.id,
      question_canonical_id: picked.question.canonical_id,
      option_order: servedOptions.optionOrder,
      option_token_map: servedOptions.optionTokenMap,
      ordinal: nextOrdinal,
      status: "served",
      attempt_id: null,
      client_instance_id: args.clientInstanceId,
      created_at: now,
      updated_at: now,
    })
    .select("id, session_id, user_id, question_id, question_canonical_id, option_order, option_token_map, ordinal, status, attempt_id, client_instance_id")
    .single();

  if (insertErr || !insertedItem) {
    if (isDuplicateConflict(insertErr?.message)) {
      const deduped = await getCurrentUnansweredItem(args.sessionId);
      if (deduped) {
        const canonicalQuestion = await fetchQuestionForServing(deduped.question_id);
        if (!canonicalQuestion) {
          return args.res.status(422).json({
            error: "invalid_question_data",
            message: "Unable to load deduplicated unanswered item.",
            requestId,
          });
        }

        const dedupedOptions = buildSafeOptionsFromStoredMap(canonicalQuestion.options, deduped.option_order, deduped.option_token_map);
        if (!dedupedOptions) {
          return args.res.status(500).json({
            error: "session_item_mapping_missing",
            message: "Unable to restore option mapping for deduplicated item.",
            requestId,
          });
        }

        return args.res.json({
          sessionId: session.id,
          sessionItemId: deduped.id,
          ordinal: deduped.ordinal,
          state: "active",
          calculatorState: metadata.calculator_state ?? null,
          question: toStudentSafeQuestionDTO({
            sessionItemId: deduped.id,
            question: canonicalQuestion,
            safeOptions: dedupedOptions,
          }),
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
    calculatorState: metadata.calculator_state ?? null,
    question: toStudentSafeQuestionDTO({
      sessionItemId: insertedItem.id,
      question: picked.question,
      safeOptions: servedOptions.safeOptions,
    }),
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

  const normalizedSpec = normalizeSessionSpec(parsed.data);
  const section = normalizedSpec.section;
  const mode = normalizedSpec.sessionSpec.mode;
  const idempotencyKey = parsed.data.idempotency_key?.trim() || null;
  const targetQuestionCount = normalizedSpec.targetQuestionCount;
  const clientInstanceId = parsed.data.client_instance_id?.trim() || `server-${crypto.randomUUID()}`;

  const sessionResult = await startOrReplaySession({
    userId,
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
    calculatorState: sessionResult.metadata.calculator_state ?? null,
  });
});

router.post("/sessions/:sessionId/terminate", requireSupabaseAuth, csrfProtection, async (req, res) => {
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

  const owned = await loadOwnedSession(sessionId, userId, { hideForbidden: true });
  if (!owned) {
    return res.status(404).json({
      error: "session_not_found",
      message: "Practice session not found",
      requestId,
    });
  }

  const metadata = asSessionMetadata(owned.session.metadata);
  metadata.lifecycle_state = "abandoned";
  metadata.active_session_item_id = null;
  metadata.client_instance_id = null;
  metadata.calculator_state = null;

  await updateSessionLifecycle(sessionId, metadata, {
    status: "abandoned",
    completed: true,
    finished_at: new Date().toISOString(),
  });

  return res.json({
    sessionId,
    state: "abandoned",
    readOnly: true,
  });
});

router.post("/sessions/:sessionId/calculator-state", requireSupabaseAuth, csrfProtection, async (req, res) => {
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

  const owned = await loadOwnedSession(sessionId, userId, { hideForbidden: true });
  if (!owned) {
    return res.status(404).json({
      error: "session_not_found",
      message: "Practice session not found",
      requestId,
    });
  }

  const metadata = asSessionMetadata(owned.session.metadata);
  const sessionState = normalizeSessionState(owned.session.status, metadata);

  if (sessionState === "completed" || sessionState === "abandoned" || TERMINAL_DB_STATUSES.includes(owned.session.status as any)) {
    return res.status(409).json({
      error: "session_closed",
      message: "Practice session is read-only",
      requestId,
    });
  }

  const queryClientInstanceId = getClientInstanceId(parsed.data.client_instance_id);
  const boundClient = getClientInstanceId(metadata.client_instance_id);
  if (queryClientInstanceId && boundClient && queryClientInstanceId !== boundClient) {
    return sendClientConflict(res, requestId, queryClientInstanceId);
  }

  if (queryClientInstanceId) {
    metadata.client_instance_id = queryClientInstanceId;
  }

  metadata.calculator_state = parsed.data.calculator_state ?? null;

  await updateSessionLifecycle(sessionId, metadata);

  return res.json({
    sessionId,
    calculatorState: metadata.calculator_state ?? null,
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

  const owned = await loadOwnedSession(sessionId, userId, { hideForbidden: true });
  if (!owned) {
    return res.status(404).json({
      error: "session_not_found",
      message: "Practice session not found",
      requestId,
    });
  }
  const session = owned.session;

  const metadata = asSessionMetadata(session.metadata);
  const queryClientInstanceId = getClientInstanceId(req.query.client_instance_id);
  const boundClient = getClientInstanceId(metadata.client_instance_id);

  if (queryClientInstanceId && boundClient && queryClientInstanceId !== boundClient) {
    return sendClientConflict(res, requestId, queryClientInstanceId);
  }

  const latestItem = await getLatestSessionItem(sessionId);
  const unresolved = await getCurrentUnansweredItem(sessionId);
  const progressCounts = await getSessionProgressCounts(sessionId);
  const targetQuestionCount = coerceTargetQuestionCount(metadata.target_question_count);
  const state = normalizeSessionState(session.status, metadata);

  return res.json({
    sessionId: session.id,
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
      sessionSpec: {
        sections: section === "Math" || section === "RW" ? [section] : [],
        domains: [],
        difficulties: [],
        target_minutes: null,
        target_question_count: DEFAULT_TARGET_QUESTION_COUNT,
        mode,
      },
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

async function findSessionItemForSubmission(
  sessionId: string,
  args: {
    sessionItemId?: string;
    questionId?: string;
  }
) {
  let query = supabaseServer
    .from("practice_session_items")
    .select("id, session_id, user_id, question_id, question_canonical_id, option_order, option_token_map, ordinal, status, attempt_id, client_instance_id")
    .eq("session_id", sessionId);

  if (args.sessionItemId) {
    query = query.eq("id", args.sessionItemId);
  } else if (args.questionId) {
    query = query.eq("question_id", args.questionId);
  } else {
    query = query.eq("status", "served").order("ordinal", { ascending: false }).limit(1);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) return null;
  return data[0];
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
      message: "free-response answers are not supported on canonical multiple-choice practice submit.",
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

  const sessionMeta = asSessionMetadata(session.metadata);
  const sessionState = normalizeSessionState(session.status, sessionMeta);

  if (sessionState === "completed" || sessionState === "abandoned" || TERMINAL_DB_STATUSES.includes(session.status as any)) {
    return res.status(409).json({
      error: "session_closed",
      message: "Practice session is read-only",
      requestId,
    });
  }
  const { data: qRow, error: qErr } = await supabaseServer
    .from("questions")
    .select("id, canonical_id, status, section, section_code, question_type, stem, correct_answer, explanation, options")
    .eq("id", sessionItem.question_id)
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

  const optionTokenMap = parseStoredOptionTokenMap(sessionItem.option_token_map);
  if (!optionTokenMap) {
    return res.status(409).json({
      error: "session_item_mapping_missing",
      message: "The served option mapping is missing for this session item.",
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

  const questionId = String(qRow.id);
  const correctOptionId = Object.entries(optionTokenMap).find((entry) => entry[1] === correctAnswerKey)?.[0] ?? null;

  if (sessionItem.status !== "served") {
    if (sessionItem.status === "answered" && payload.clientAttemptId) {
      const { data: retriedAttempt, error: retriedAttemptError } = await supabaseServer
        .from("answer_attempts")
        .select("id, session_id, question_id, session_item_id, is_correct, outcome")
        .eq("user_id", userId)
        .eq("client_attempt_id", payload.clientAttemptId)
        .maybeSingle();

      if (retriedAttemptError) {
        throw new Error(`attempt_lookup_by_client_attempt_id_failed: ${retriedAttemptError.message}`);
      }

      if (
        retriedAttempt
        && retriedAttempt.session_id === payload.sessionId
        && retriedAttempt.session_item_id === sessionItem.id
        && retriedAttempt.question_id === questionId
      ) {
        return res.json({
          sessionId: payload.sessionId,
          sessionItemId: sessionItem.id,
          isCorrect: !!retriedAttempt.is_correct,
          mode: "multiple_choice",
          correctOptionId,
          explanation,
          feedback: retriedAttempt.is_correct ? "Correct" : "Incorrect",
          stats: await getSessionStats(payload.sessionId, userId),
          idempotentRetried: true,
        });
      }
    }

    return res.status(409).json({
      error: "session_item_not_open",
      message: "This practice item is already resolved.",
      requestId,
    });
  }

  const existingAttempt = await findExistingAttempt({
    userId,
    sessionId: payload.sessionId,
    questionId,
    sessionItemId: sessionItem.id,
    idempotencyKey: payload.clientAttemptId,
  });

  if (existingAttempt) {
    if (existingAttempt.session_id !== payload.sessionId || existingAttempt.question_id !== questionId) {
      return res.status(409).json({
        error: "idempotency_key_reuse",
        message: "The provided clientAttemptId is already bound to a different attempt.",
        requestId,
      });
    }

    return res.json({
      sessionId: payload.sessionId,
      sessionItemId: sessionItem.id,
      isCorrect: !!existingAttempt.is_correct,
      mode: "multiple_choice",
      correctOptionId,
      explanation,
      feedback: existingAttempt.is_correct ? "Correct" : existingAttempt.outcome === "skipped" ? "Skipped" : "Incorrect",
      stats: await getSessionStats(payload.sessionId, userId),
      idempotentRetried: true,
    });
  }

  const selectedTokenOrKey = payload.selectedAnswer;
  const mappedKeyFromToken = selectedTokenOrKey ? optionTokenMap[selectedTokenOrKey] : null;
  const selectedCanonicalKey = mappedKeyFromToken ?? normalizeAnswerKey(selectedTokenOrKey ?? null);

  if (!selectedCanonicalKey) {
    return res.status(400).json({
      error: "invalid_answer",
      message: "selectedAnswer must match a served option token or canonical option key.",
      requestId,
    });
  }

  const chosen = selectedCanonicalKey;
  const isCorrect = chosen === correctAnswerKey;
  const outcome = isCorrect ? "correct" : "incorrect";

  const clampedTimeSpentMs = null;

  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();

  const insertPayload: Record<string, unknown> = {
    id: attemptId,
    user_id: userId,
    session_id: payload.sessionId,
    session_item_id: sessionItem.id,
    question_id: questionId,
    selected_answer: payload.selectedAnswer ?? null,
    free_response_answer: null,
    chosen: chosen ?? null,
    is_correct: isCorrect,
    outcome,
    time_spent_ms: clampedTimeSpentMs,
    attempted_at: now,
    client_attempt_id: payload.clientAttemptId ?? null,
  };

  const insertResult = await insertAnswerAttempt(insertPayload);
  if (insertResult.error) {
    if (isDuplicateConflict(insertResult.error.message)) {
      const duplicate = await findExistingAttempt({
        userId,
        sessionId: payload.sessionId,
        questionId,
        sessionItemId: sessionItem.id,
        idempotencyKey: payload.clientAttemptId,
      });

      if (!duplicate) {
        return res.status(409).json({
          error: "duplicate_submission",
          message: "Answer already submitted for this session item.",
          requestId,
        });
      }

      return res.json({
        sessionId: payload.sessionId,
        sessionItemId: sessionItem.id,
        isCorrect: !!duplicate.is_correct,
        mode: "multiple_choice",
        correctOptionId,
        explanation,
        feedback: duplicate.is_correct ? "Correct" : duplicate.outcome === "skipped" ? "Skipped" : "Incorrect",
        stats: await getSessionStats(payload.sessionId, userId),
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
      status: "answered",
      attempt_id: attemptId,
      updated_at: now,
      answered_at: now,
    })
    .eq("id", sessionItem.id)
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
      sessionId: payload.sessionId,
      questionId,
      sessionItemId: sessionItem.id,
      idempotencyKey: payload.clientAttemptId,
    });

    if (raceDuplicate) {
      return res.json({
        sessionId: payload.sessionId,
        sessionItemId: sessionItem.id,
        isCorrect: !!raceDuplicate.is_correct,
        mode: "multiple_choice",
        correctOptionId,
        explanation,
        feedback: raceDuplicate.is_correct ? "Correct" : raceDuplicate.outcome === "skipped" ? "Skipped" : "Incorrect",
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
    await supabaseServer
      .from("practice_events")
      .insert({
        user_id: userId,
        session_id: payload.sessionId,
        question_id: questionId,
        event_type: "answered",
        created_at: now,
        payload: {
          session_item_id: sessionItem.id,
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
        sessionId: payload.sessionId,
        isCorrect,
        selectedChoice: chosen ?? null,
        timeSpentMs: clampedTimeSpentMs,
        eventType: isCorrect ? MasteryEventType.PRACTICE_PASS : MasteryEventType.PRACTICE_FAIL,
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

  const resolvedCount = await countResolvedSessionItems(payload.sessionId);
  const targetQuestionCount = coerceTargetQuestionCount(refreshedMeta.target_question_count);
  const shouldComplete = resolvedCount >= targetQuestionCount;

  if (shouldComplete) {
    refreshedMeta.lifecycle_state = "completed";
    await updateSessionLifecycle(payload.sessionId, refreshedMeta, {
      status: "completed",
      completed: true,
      finished_at: now,
    });
  } else {
    refreshedMeta.lifecycle_state = "active";
    await updateSessionLifecycle(payload.sessionId, refreshedMeta, {
      status: "in_progress",
      completed: false,
    });
  }

  return res.json({
    sessionId: payload.sessionId,
    sessionItemId: sessionItem.id,
    isCorrect,
    mode: "multiple_choice",
    correctOptionId,
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
  const sessionMeta = asSessionMetadata(session.metadata);
  const sessionState = normalizeSessionState(session.status, sessionMeta);

  if (sessionState === "completed" || sessionState === "abandoned" || TERMINAL_DB_STATUSES.includes(session.status as any)) {
    return res.status(409).json({
      error: "session_closed",
      message: "Practice session is read-only",
      requestId,
    });
  }

  const requestClient = getClientInstanceId(payload.clientInstanceId);
  const boundClient = getClientInstanceId(sessionMeta.client_instance_id);
  if (requestClient && boundClient && requestClient !== boundClient) {
    return sendClientConflict(res, requestId, requestClient);
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

  const questionId = String(sessionItem.question_id);
  const existingAttempt = await findExistingAttempt({
    userId,
    sessionId,
    questionId,
    sessionItemId: sessionItem.id,
    idempotencyKey: payload.clientAttemptId,
  });

  if (existingAttempt) {
    if (existingAttempt.session_id !== sessionId || existingAttempt.question_id !== questionId) {
      return res.status(409).json({
        error: "idempotency_key_reuse",
        message: "The provided clientAttemptId is already bound to a different attempt.",
        requestId,
      });
    }

    const existingStats = await getSessionStats(sessionId, userId);
    return res.json({
      sessionId,
      sessionItemId: sessionItem.id,
      skipped: true,
      mode: "multiple_choice",
      feedback: "Skipped",
      stats: existingStats,
      state: sessionState,
      idempotentRetried: true,
    });
  }

  if (sessionItem.status !== "served") {
    return res.status(409).json({
      error: "session_item_not_open",
      message: "This practice item is already resolved.",
      requestId,
    });
  }

  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();

  const insertPayload: Record<string, unknown> = {
    id: attemptId,
    user_id: userId,
    session_id: sessionId,
    session_item_id: sessionItem.id,
    question_id: questionId,
    selected_answer: null,
    free_response_answer: null,
    chosen: null,
    is_correct: false,
    outcome: "skipped",
    time_spent_ms: null,
    attempted_at: now,
    client_attempt_id: payload.clientAttemptId ?? null,
  };

  const insertResult = await insertAnswerAttempt(insertPayload);
  if (insertResult.error) {
    if (isDuplicateConflict(insertResult.error.message)) {
      const duplicate = await findExistingAttempt({
        userId,
        sessionId,
        questionId,
        sessionItemId: sessionItem.id,
        idempotencyKey: payload.clientAttemptId,
      });

      if (!duplicate) {
        return res.status(409).json({
          error: "duplicate_submission",
          message: "Skip already submitted for this session item.",
          requestId,
        });
      }

      const dupStats = await getSessionStats(sessionId, userId);
      return res.json({
        sessionId,
        sessionItemId: sessionItem.id,
        skipped: true,
        mode: "multiple_choice",
        feedback: "Skipped",
        stats: dupStats,
        state: normalizeSessionState(session.status, asSessionMetadata(session.metadata)),
        idempotentRetried: true,
      });
    }

    return res.status(500).json({
      error: "skip_submit_failed",
      message: insertResult.error.message ?? "Unable to record skip attempt",
      requestId,
    });
  }

  const { data: updatedItem, error: updateItemErr } = await supabaseServer
    .from("practice_session_items")
    .update({
      status: "skipped",
      attempt_id: attemptId,
      updated_at: now,
      answered_at: now,
    })
    .eq("id", sessionItem.id)
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
      sessionItemId: sessionItem.id,
      idempotencyKey: payload.clientAttemptId,
    });

    if (raceDuplicate) {
      const raceStats = await getSessionStats(sessionId, userId);
      return res.json({
        sessionId,
        sessionItemId: sessionItem.id,
        skipped: true,
        mode: "multiple_choice",
        feedback: "Skipped",
        stats: raceStats,
        state: normalizeSessionState(session.status, asSessionMetadata(session.metadata)),
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
        event_type: "skipped",
        created_at: now,
        payload: {
          session_item_id: sessionItem.id,
          outcome: "skipped",
          isCorrect: false,
        },
      });
  } catch {
    // non-blocking
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
    sessionItemId: sessionItem.id,
    skipped: true,
    mode: "multiple_choice",
    feedback: "Skipped",
    stats: await getSessionStats(sessionId, userId),
    state: shouldComplete ? "completed" : "active",
  });
}
router.post("/answer", requireSupabaseAuth, practiceAnswerRateLimiter, csrfProtection, submitPracticeAnswer);
router.post("/sessions/:sessionId/skip", requireSupabaseAuth, practiceAnswerRateLimiter, csrfProtection, submitPracticeSkip);

export default router;


