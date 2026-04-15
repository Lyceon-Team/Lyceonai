import { NextFunction, Response, Router } from "express";
import {
  RateLimitUnavailableError,
  checkAndReserveTutorBudget,
  estimateTokenCount,
  estimateTutorCostMicros,
  finalizeTutorUsage,
} from "../../apps/api/src/lib/rate-limit-ledger";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  TutorAppendMessageRequestSchema,
  TutorCloseConversationRequestSchema,
  TutorListConversationsQuerySchema,
  TutorSuggestedActionSchema,
  TutorStartConversationRequestSchema,
  TutorUiHintsSchema,
} from "../../shared/tutor-contract";
import {
  type AuthenticatedRequest,
  requireRequestUser,
  sendForbidden,
} from "../middleware/supabase-auth";
import { callTutorOrchestrator } from "../lib/tutor-orchestrator-client";
import { resolvePaidKpiAccessForUser } from "../services/kpi-access";
import { z } from "zod";

const router = Router();

const ACTIVE_FULL_TEST_STATUSES = ["not_started", "in_progress", "break"] as const;
const STUDENT_THROTTLE_WINDOW_MS = 60_000;
const STUDENT_THROTTLE_LIMIT = 24;
const IP_THROTTLE_WINDOW_MS = 60_000;
const IP_THROTTLE_LIMIT = 120;
const hardThrottleBuckets = new Map<string, number[]>();

const DEFAULT_POLICY_FAMILY = "tutor_v1";
const DEFAULT_POLICY_VARIANT = "default";
const DEFAULT_POLICY_VERSION = "1";
const DEFAULT_PROMPT_VERSION = "1";
const DEFAULT_ASSIGNMENT_MODE = "deterministic";
const DEFAULT_ASSIGNMENT_KEY = "default";

type ScopeShape = {
  source_session_id: string | null;
  source_session_item_id: string | null;
  source_question_row_id: string | null;
  source_question_canonical_id: string | null;
};

type ConversationRow = {
  id: string;
  student_id: string;
  entry_mode: "scoped_question" | "scoped_session" | "general";
  source_surface: "practice" | "review" | "test_review" | "dashboard";
  source_session_id: string | null;
  source_session_item_id: string | null;
  source_question_row_id: string | null;
  source_question_canonical_id: string | null;
  policy_family: string;
  policy_variant: string;
  policy_version: string;
  prompt_version: string | null;
  assignment_mode: string;
  assignment_key: string;
  status: "active" | "closed" | "abandoned";
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  student_id: string;
  role: "student" | "tutor" | "system";
  content_kind: "message" | "suggestion" | "consent_prompt" | "system_note";
  message: string;
  content_json: Record<string, unknown>;
  client_turn_id: string | null;
  source_session_id: string | null;
  source_session_item_id: string | null;
  source_question_row_id: string | null;
  source_question_canonical_id: string | null;
  created_at: string;
};

type ScopeResolution = {
  resolved_scope: ScopeShape;
  fallback_reason: string | null;
  conflict_fields: string[];
};

const INTERNAL_QUESTION_LINKS_SNAPSHOT_KEY = "__internal_question_links_snapshot";
const INTERNAL_INSTRUCTION_EXPOSURES_SNAPSHOT_KEY = "__internal_instruction_exposures_snapshot";

const orchestrationMetaSchema = z.object({
  model_name: z.string(),
  cache_used: z.boolean(),
  compaction_recommended: z.boolean(),
});

const questionLinkSnapshotSchema = z.object({
  source_question_row_id: z.string().uuid().nullable(),
  source_question_canonical_id: z.string(),
  related_question_row_id: z.string().uuid().nullable(),
  related_question_canonical_id: z.string(),
  relationship_type: z.enum([
    "current",
    "similar_retry",
    "simpler_variant",
    "harder_variant",
    "concept_extension",
  ]),
  difficulty_delta: z.number().int().nullable(),
  reason_code: z.string(),
  link_snapshot: z.record(z.string(), z.unknown()),
});

const instructionExposureSnapshotSchema = z.object({
  exposure_type: z.enum([
    "hint",
    "explanation",
    "strategy",
    "similar_question_offer",
    "broader_coaching_offer",
    "consent_prompt",
  ]),
  content_variant_key: z.string().nullable(),
  content_version: z.string().nullable(),
  rendered_difficulty: z.number().int().nullable(),
  hint_depth: z.number().int().nullable(),
  tone_style: z.string().nullable(),
  sequence_ordinal: z.number().int().nonnegative(),
});

const tutorReplayContentSchema = z.object({
  suggested_action: TutorSuggestedActionSchema,
  ui_hints: TutorUiHintsSchema,
  orchestration_meta: orchestrationMetaSchema.optional(),
  [INTERNAL_QUESTION_LINKS_SNAPSHOT_KEY]: z.array(questionLinkSnapshotSchema).optional(),
  [INTERNAL_INSTRUCTION_EXPOSURES_SNAPSHOT_KEY]: z.array(instructionExposureSnapshotSchema).optional(),
});

type QuestionLinkSnapshot = z.infer<typeof questionLinkSnapshotSchema>;
type InstructionExposureSnapshot = z.infer<typeof instructionExposureSnapshotSchema>;
type TutorReplayContent = z.infer<typeof tutorReplayContentSchema>;

function emptyScope(): ScopeShape {
  return {
    source_session_id: null,
    source_session_item_id: null,
    source_question_row_id: null,
    source_question_canonical_id: null,
  };
}

function normalizeScope(source: Record<string, unknown> | null | undefined): ScopeShape {
  const safe = source ?? {};
  const toText = (v: unknown) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
  return {
    source_session_id: toText(safe.source_session_id),
    source_session_item_id: toText(safe.source_session_item_id),
    source_question_row_id: toText(safe.source_question_row_id),
    source_question_canonical_id: toText(safe.source_question_canonical_id),
  };
}

function getClientIp(req: AuthenticatedRequest): string {
  if (typeof req.ip === "string" && req.ip.length > 0) return req.ip;
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded) && forwarded.length > 0) return String(forwarded[0]);
  return "unknown";
}

function touchRateBucket(key: string, windowMs: number): number {
  const now = Date.now();
  const cutoff = now - windowMs;
  const existing = hardThrottleBuckets.get(key) ?? [];
  const fresh = existing.filter((ts) => ts >= cutoff);
  fresh.push(now);
  hardThrottleBuckets.set(key, fresh);
  return fresh.length;
}

function sendTutorError(
  res: Response,
  status: number,
  code: string,
  message: string,
  requestId?: string,
  retryable?: boolean,
) {
  return res.status(status).json({
    error: { code, message, ...(typeof retryable === "boolean" ? { retryable } : {}) },
    ...(requestId ? { requestId } : {}),
  });
}

function sendRecoverableRetry(res: Response, requestId?: string) {
  return res.status(409).json({
    error: {
      code: "TUTOR_RECOVERABLE_RETRY_REQUIRED",
      message: "The tutor turn could not be completed safely. Please retry.",
      retryable: true,
    },
    ...(requestId ? { requestId } : {}),
  });
}

function isGuardianUser(req: AuthenticatedRequest): boolean {
  return Boolean(req.user?.isGuardian || req.user?.role === "guardian");
}

function isAdminUser(req: AuthenticatedRequest): boolean {
  return Boolean(req.user?.isAdmin || req.user?.role === "admin");
}

function tutorHardThrottle(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = req.user?.id;
  if (!userId) return next();

  const studentCount = touchRateBucket(`tutor:student:${userId}`, STUDENT_THROTTLE_WINDOW_MS);
  const ipCount = touchRateBucket(`tutor:ip:${getClientIp(req)}`, IP_THROTTLE_WINDOW_MS);
  if (studentCount > STUDENT_THROTTLE_LIMIT || ipCount > IP_THROTTLE_LIMIT) {
    return res.status(429).json({
      error: {
        code: "TUTOR_ABUSE_THROTTLED",
        message: "Tutor request rate is temporarily limited. Please retry shortly.",
        retryable: true,
      },
      limitType: "tutor",
      current: studentCount,
      limit: STUDENT_THROTTLE_LIMIT,
      remaining: Math.max(0, STUDENT_THROTTLE_LIMIT - studentCount),
      resetAt: new Date(Date.now() + STUDENT_THROTTLE_WINDOW_MS).toISOString(),
      cooldownUntil: null,
      requestId: req.requestId,
    });
  }
  return next();
}

router.use(tutorHardThrottle);

async function ensureTutorEntitlement(req: AuthenticatedRequest, res: Response, userId: string): Promise<boolean> {
  const role = (req.user?.role ?? "student") as "student" | "guardian" | "admin";
  const access = await resolvePaidKpiAccessForUser(userId, role);
  if (access.hasPaidAccess) return true;
  sendTutorError(
    res,
    402,
    "PREMIUM_REQUIRED",
    "Upgrade to an active paid plan to unlock tutor.",
    req.requestId,
  );
  return false;
}

async function loadConversationOrDeny(
  req: AuthenticatedRequest,
  res: Response,
  conversationId: string,
): Promise<ConversationRow | null> {
  const user = requireRequestUser(req, res);
  if (!user) return null;

  const { data, error } = await supabaseServer
    .from("tutor_conversations")
    .select("*")
    .eq("id", conversationId)
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    sendTutorError(res, 404, "TUTOR_CONVERSATION_NOT_FOUND", "Tutor conversation not found.", req.requestId);
    return null;
  }

  if (String((data as ConversationRow).student_id) !== String(user.id) && !isAdminUser(req)) {
    sendForbidden(res, {
      error: "Forbidden",
      message: "You do not own this tutor conversation.",
      requestId: req.requestId,
    });
    return null;
  }

  return data as ConversationRow;
}

async function hasActiveFullLengthExam(userId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("full_length_exam_sessions")
    .select("id")
    .eq("user_id", userId)
    .in("status", [...ACTIVE_FULL_TEST_STATUSES])
    .limit(1)
    .maybeSingle();
  if (error) return true;
  return Boolean(data);
}

async function isFullLengthReviewUnlocked(userId: string, sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false;
  const { data, error } = await supabaseServer
    .from("full_length_exam_sessions")
    .select("status")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;
  return String((data as { status: string }).status) === "completed";
}

async function questionExistsByRowId(questionRowId: string | null): Promise<boolean> {
  if (!questionRowId) return false;
  const { data, error } = await supabaseServer
    .from("questions")
    .select("id")
    .eq("id", questionRowId)
    .limit(1)
    .maybeSingle();
  return !error && Boolean(data);
}

async function questionExistsByCanonicalId(canonicalId: string | null): Promise<boolean> {
  if (!canonicalId) return false;
  const { data, error } = await supabaseServer
    .from("questions")
    .select("canonical_id")
    .eq("canonical_id", canonicalId)
    .limit(1)
    .maybeSingle();
  return !error && Boolean(data);
}

async function canonicalIdForQuestionRow(rowId: string | null): Promise<string | null> {
  if (!rowId) return null;
  const { data, error } = await supabaseServer
    .from("questions")
    .select("canonical_id")
    .eq("id", rowId)
    .limit(1)
    .maybeSingle();
  if (error || !data?.canonical_id) return null;
  return String(data.canonical_id);
}

async function sessionExistsForScope(
  studentId: string,
  sourceSurface: ConversationRow["source_surface"],
  sessionId: string | null,
): Promise<boolean> {
  if (!sessionId) return false;
  if (sourceSurface === "practice") {
    const { data, error } = await supabaseServer
      .from("practice_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", studentId)
      .limit(1)
      .maybeSingle();
    return !error && Boolean(data);
  }
  if (sourceSurface === "review") {
    const { data, error } = await supabaseServer
      .from("review_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("student_id", studentId)
      .limit(1)
      .maybeSingle();
    return !error && Boolean(data);
  }
  if (sourceSurface === "test_review") {
    return isFullLengthReviewUnlocked(studentId, sessionId);
  }
  return false;
}

async function sessionItemExistsForScope(
  studentId: string,
  sourceSurface: ConversationRow["source_surface"],
  itemId: string | null,
): Promise<boolean> {
  if (!itemId) return false;
  if (sourceSurface === "practice") {
    const { data, error } = await supabaseServer
      .from("practice_session_items")
      .select("id")
      .eq("id", itemId)
      .eq("user_id", studentId)
      .limit(1)
      .maybeSingle();
    return !error && Boolean(data);
  }
  if (sourceSurface === "review") {
    const { data, error } = await supabaseServer
      .from("review_session_items")
      .select("id")
      .eq("id", itemId)
      .eq("student_id", studentId)
      .limit(1)
      .maybeSingle();
    return !error && Boolean(data);
  }
  if (sourceSurface === "test_review") {
    const { data, error } = await supabaseServer
      .from("full_length_exam_questions")
      .select("id")
      .eq("id", itemId)
      .limit(1)
      .maybeSingle();
    return !error && Boolean(data);
  }
  return false;
}

async function loadRecentValidScope(conversationId: string): Promise<ScopeShape | null> {
  const { data, error } = await supabaseServer
    .from("tutor_messages")
    .select("source_session_id,source_session_item_id,source_question_row_id,source_question_canonical_id,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error || !Array.isArray(data)) return null;

  for (const row of data) {
    const scope = normalizeScope(row as Record<string, unknown>);
    const hasQuestion = (await questionExistsByRowId(scope.source_question_row_id)) || (await questionExistsByCanonicalId(scope.source_question_canonical_id));
    if (hasQuestion) return scope;
  }

  return null;
}

async function resolveScope(args: {
  conversation: ConversationRow;
  client_scope?: Record<string, unknown> | null;
  student_id: string;
}): Promise<ScopeResolution> {
  const stored = normalizeScope(args.conversation as unknown as Record<string, unknown>);
  const supplied = normalizeScope(args.client_scope);
  const resolved = { ...stored };
  const conflictFields: string[] = [];

  for (const key of Object.keys(stored) as Array<keyof ScopeShape>) {
    if (!resolved[key] && supplied[key]) {
      resolved[key] = supplied[key];
    } else if (resolved[key] && supplied[key] && resolved[key] !== supplied[key]) {
      conflictFields.push(String(key));
    }
  }

  if (resolved.source_question_row_id && !resolved.source_question_canonical_id) {
    resolved.source_question_canonical_id = await canonicalIdForQuestionRow(resolved.source_question_row_id);
  }

  let fallbackReason: string | null = null;
  const questionValid =
    (await questionExistsByRowId(resolved.source_question_row_id))
    || (await questionExistsByCanonicalId(resolved.source_question_canonical_id));

  if (!questionValid && (resolved.source_question_row_id || resolved.source_question_canonical_id)) {
    const recent = await loadRecentValidScope(args.conversation.id);
    if (recent) {
      resolved.source_question_row_id = recent.source_question_row_id;
      resolved.source_question_canonical_id = recent.source_question_canonical_id;
      resolved.source_session_id = recent.source_session_id ?? resolved.source_session_id;
      resolved.source_session_item_id = recent.source_session_item_id ?? resolved.source_session_item_id;
      fallbackReason = "reused_recent_conversation_scope";
    } else if (
      await sessionExistsForScope(args.student_id, args.conversation.source_surface, resolved.source_session_id)
    ) {
      resolved.source_question_row_id = null;
      resolved.source_question_canonical_id = null;
      fallbackReason = "degraded_to_scoped_session";
    } else {
      Object.assign(resolved, emptyScope());
      fallbackReason = "degraded_to_general";
    }
  }

  const sessionValid = await sessionExistsForScope(args.student_id, args.conversation.source_surface, resolved.source_session_id);
  const itemValid = await sessionItemExistsForScope(args.student_id, args.conversation.source_surface, resolved.source_session_item_id);
  if (!sessionValid || (resolved.source_session_item_id && !itemValid)) {
    Object.assign(resolved, emptyScope());
    fallbackReason = fallbackReason ?? "degraded_to_general";
  }

  if (conflictFields.length > 0) {
    console.warn("[tutor-runtime] conflicting client scope ignored", {
      conversationId: args.conversation.id,
      conflictFields,
    });
  }

  return { resolved_scope: resolved, fallback_reason: fallbackReason, conflict_fields: conflictFields };
}

function removeInternalMetadataMentions(text: string): string {
  return text
    .replace(/\b(canonical id|canonical_id|internal metadata|distractor taxonomy|policy flags|reason codes)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hasDirectAnswerLeak(text: string): boolean {
  const patterns = [
    /\bthe correct answer is\b/i,
    /\bchoose option [A-D]\b/i,
    /\banswer:\s*[A-D]\b/i,
    /\bdefinitely option [A-D]\b/i,
  ];
  return patterns.some((p) => p.test(text));
}

async function getPracticeItemStatus(studentId: string, itemId: string | null): Promise<string | null> {
  if (!itemId) return null;
  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("status")
    .eq("id", itemId)
    .eq("user_id", studentId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return typeof data.status === "string" ? data.status : null;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function publicTutorMessageContentJson(value: unknown): Record<string, unknown> {
  const contentJson = { ...asJsonObject(value) };
  delete contentJson[INTERNAL_QUESTION_LINKS_SNAPSHOT_KEY];
  delete contentJson[INTERNAL_INSTRUCTION_EXPOSURES_SNAPSHOT_KEY];
  return contentJson;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = canonicalizeJsonValue(record[key]);
    }
    return out;
  }
  return value;
}

function canonicalizeJsonString(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function isDuplicateKeyError(error: { code?: string | null } | null | undefined): boolean {
  return String(error?.code ?? "") === "23505";
}

function questionLinkMatchesSnapshot(
  row: Record<string, unknown>,
  snapshot: QuestionLinkSnapshot,
): boolean {
  return (
    normalizeNullableString(row.source_question_row_id) === snapshot.source_question_row_id
    && normalizeNullableString(row.source_question_canonical_id) === snapshot.source_question_canonical_id
    && normalizeNullableString(row.related_question_row_id) === snapshot.related_question_row_id
    && normalizeNullableString(row.related_question_canonical_id) === snapshot.related_question_canonical_id
    && normalizeNullableString(row.relationship_type) === snapshot.relationship_type
    && normalizeNullableInt(row.difficulty_delta) === snapshot.difficulty_delta
    && normalizeNullableString(row.reason_code) === snapshot.reason_code
    && canonicalizeJsonString(asJsonObject(row.link_snapshot)) === canonicalizeJsonString(snapshot.link_snapshot)
  );
}

function exposureMatchesSnapshot(
  row: Record<string, unknown>,
  snapshot: InstructionExposureSnapshot,
): boolean {
  return (
    normalizeNullableString(row.exposure_type) === snapshot.exposure_type
    && normalizeNullableString(row.content_variant_key) === snapshot.content_variant_key
    && normalizeNullableString(row.content_version) === snapshot.content_version
    && normalizeNullableInt(row.rendered_difficulty) === snapshot.rendered_difficulty
    && normalizeNullableInt(row.hint_depth) === snapshot.hint_depth
    && normalizeNullableString(row.tone_style) === snapshot.tone_style
    && normalizeNullableInt(row.sequence_ordinal) === snapshot.sequence_ordinal
  );
}

async function ensureQuestionLinksPersisted(args: {
  conversationId: string;
  studentId: string;
  links: QuestionLinkSnapshot[];
}): Promise<boolean> {
  if (!Array.isArray(args.links) || args.links.length === 0) return true;

  const { data: existingRows, error: existingError } = await supabaseServer
    .from("tutor_question_links")
    .select("*")
    .eq("conversation_id", args.conversationId)
    .eq("student_id", args.studentId);

  if (existingError || !Array.isArray(existingRows)) return false;
  const knownRows = [...existingRows] as Record<string, unknown>[];

  for (const link of args.links) {
    if (knownRows.some((row) => questionLinkMatchesSnapshot(row, link))) continue;

    const { data: inserted, error: insertError } = await supabaseServer
      .from("tutor_question_links")
      .insert({
        conversation_id: args.conversationId,
        student_id: args.studentId,
        source_question_row_id: link.source_question_row_id,
        source_question_canonical_id: link.source_question_canonical_id,
        related_question_row_id: link.related_question_row_id,
        related_question_canonical_id: link.related_question_canonical_id,
        relationship_type: link.relationship_type,
        difficulty_delta: link.difficulty_delta,
        reason_code: link.reason_code,
        link_snapshot: link.link_snapshot,
      })
      .select("*")
      .single();

    if (insertError && !isDuplicateKeyError(insertError)) {
      return false;
    }
    if (inserted) {
      knownRows.push(inserted as Record<string, unknown>);
    }
  }

  return true;
}

async function ensureInstructionExposuresPersisted(args: {
  assignmentId: string;
  conversationId: string;
  studentId: string;
  exposures: InstructionExposureSnapshot[];
}): Promise<boolean> {
  if (!Array.isArray(args.exposures) || args.exposures.length === 0) return true;

  const { data: existingRows, error: existingError } = await supabaseServer
    .from("tutor_instruction_exposures")
    .select("*")
    .eq("assignment_id", args.assignmentId)
    .eq("conversation_id", args.conversationId)
    .eq("student_id", args.studentId);

  if (existingError || !Array.isArray(existingRows)) return false;
  const knownRows = [...existingRows] as Record<string, unknown>[];

  for (const exposure of args.exposures) {
    if (knownRows.some((row) => exposureMatchesSnapshot(row, exposure))) continue;

    const { data: inserted, error: insertError } = await supabaseServer
      .from("tutor_instruction_exposures")
      .insert({
        assignment_id: args.assignmentId,
        conversation_id: args.conversationId,
        student_id: args.studentId,
        exposure_type: exposure.exposure_type,
        content_variant_key: exposure.content_variant_key,
        content_version: exposure.content_version,
        rendered_difficulty: exposure.rendered_difficulty,
        hint_depth: exposure.hint_depth,
        tone_style: exposure.tone_style,
        sequence_ordinal: exposure.sequence_ordinal,
        shown_at: new Date().toISOString(),
        consumed_ms: null,
      })
      .select("*")
      .single();

    if (insertError && !isDuplicateKeyError(insertError)) {
      return false;
    }
    if (inserted) {
      knownRows.push(inserted as Record<string, unknown>);
    }
  }

  return true;
}

async function ensureCanonicalArtifactsPersisted(args: {
  assignmentId: string;
  conversationId: string;
  studentId: string;
  questionLinks: QuestionLinkSnapshot[];
  instructionExposures: InstructionExposureSnapshot[];
}): Promise<boolean> {
  const linksOk = await ensureQuestionLinksPersisted({
    conversationId: args.conversationId,
    studentId: args.studentId,
    links: args.questionLinks,
  });
  if (!linksOk) return false;

  return ensureInstructionExposuresPersisted({
    assignmentId: args.assignmentId,
    conversationId: args.conversationId,
    studentId: args.studentId,
    exposures: args.instructionExposures,
  });
}

function parseReplayTutorContent(value: unknown): TutorReplayContent | null {
  const parsed = tutorReplayContentSchema.safeParse(asJsonObject(value));
  return parsed.success ? parsed.data : null;
}

router.post("/conversations", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) return;
    if (isGuardianUser(req) && !isAdminUser(req)) {
      sendForbidden(res, { error: "Student access required", message: "Guardians cannot access tutor.", requestId: req.requestId });
      return;
    }
    if (!(await ensureTutorEntitlement(req, res, user.id))) return;

    const parsed = TutorStartConversationRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendTutorError(res, 400, "TUTOR_INVALID_REQUEST", "Invalid tutor conversation request.", req.requestId);
      return;
    }
    const body = parsed.data;
    const resolved = normalizeScope(body as unknown as Record<string, unknown>);
    const defaults = {
      policy_family: DEFAULT_POLICY_FAMILY,
      policy_variant: DEFAULT_POLICY_VARIANT,
      policy_version: DEFAULT_POLICY_VERSION,
      prompt_version: DEFAULT_PROMPT_VERSION,
      assignment_mode: DEFAULT_ASSIGNMENT_MODE,
      assignment_key: DEFAULT_ASSIGNMENT_KEY,
      initialization_snapshot: {},
      status: "active",
    };

    const { data: existing, error: existingError } = await supabaseServer
      .from("tutor_conversations")
      .select("*")
      .eq("student_id", user.id)
      .eq("status", "active")
      .eq("entry_mode", body.entry_mode)
      .eq("source_surface", body.source_surface)
      .eq("source_session_id", resolved.source_session_id)
      .eq("source_session_item_id", resolved.source_session_item_id)
      .eq("source_question_row_id", resolved.source_question_row_id)
      .eq("source_question_canonical_id", resolved.source_question_canonical_id)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (!existingError && Array.isArray(existing) && existing.length > 0) {
      const row = existing[0] as ConversationRow;
      return res.json({
        data: {
          conversation_id: row.id,
          entry_mode: row.entry_mode,
          source_surface: row.source_surface,
          status: row.status,
          resolved_scope: normalizeScope(row as unknown as Record<string, unknown>),
        },
      });
    }

    const { data: inserted, error: insertError } = await supabaseServer
      .from("tutor_conversations")
      .insert({
        student_id: user.id,
        entry_mode: body.entry_mode,
        source_surface: body.source_surface,
        source_session_id: resolved.source_session_id,
        source_session_item_id: resolved.source_session_item_id,
        source_question_row_id: resolved.source_question_row_id,
        source_question_canonical_id: resolved.source_question_canonical_id,
        ...defaults,
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      sendTutorError(res, 500, "TUTOR_CONVERSATION_CREATE_FAILED", "Failed to create tutor conversation.", req.requestId);
      return;
    }

    return res.json({
      data: {
        conversation_id: inserted.id,
        entry_mode: inserted.entry_mode,
        source_surface: inserted.source_surface,
        status: inserted.status,
        resolved_scope: normalizeScope(inserted as unknown as Record<string, unknown>),
      },
    });
  } catch (error: any) {
    sendTutorError(res, 500, "TUTOR_CONVERSATION_CREATE_FAILED", error?.message || "Failed to create tutor conversation.", req.requestId);
  }
});

router.get("/conversations/:conversationId", async (req: AuthenticatedRequest, res: Response) => {
  const user = requireRequestUser(req, res);
  if (!user) return;
  if (isGuardianUser(req) && !isAdminUser(req)) {
    sendForbidden(res, { error: "Student access required", message: "Guardians cannot access tutor.", requestId: req.requestId });
    return;
  }
  if (!(await ensureTutorEntitlement(req, res, user.id))) return;

  const conversation = await loadConversationOrDeny(req, res, req.params.conversationId);
  if (!conversation) return;

  const { data: messages, error: msgError } = await supabaseServer
    .from("tutor_messages")
    .select("*")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });
  if (msgError) {
    sendTutorError(res, 500, "TUTOR_MESSAGES_READ_FAILED", "Failed to read tutor messages.", req.requestId);
    return;
  }

  return res.json({
    data: {
      conversation: {
        conversation_id: conversation.id,
        entry_mode: conversation.entry_mode,
        source_surface: conversation.source_surface,
        status: conversation.status,
        resolved_scope: normalizeScope(conversation as unknown as Record<string, unknown>),
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
      },
      messages: (messages ?? []).map((row: any) => ({
        id: row.id,
        role: row.role,
        content_kind: row.content_kind,
        message: row.message,
        content_json: publicTutorMessageContentJson(row.content_json),
        client_turn_id: row.client_turn_id ?? null,
        created_at: row.created_at,
      })),
    },
  });
});

router.get("/conversations", async (req: AuthenticatedRequest, res: Response) => {
  const user = requireRequestUser(req, res);
  if (!user) return;
  if (isGuardianUser(req) && !isAdminUser(req)) {
    sendForbidden(res, { error: "Student access required", message: "Guardians cannot access tutor.", requestId: req.requestId });
    return;
  }
  if (!(await ensureTutorEntitlement(req, res, user.id))) return;

  const parsed = TutorListConversationsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    sendTutorError(res, 400, "TUTOR_INVALID_QUERY", "Invalid tutor conversation list query.", req.requestId);
    return;
  }

  const limit = parsed.data.limit ?? 20;
  let query = supabaseServer
    .from("tutor_conversations")
    .select("*")
    .eq("student_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(limit + 1);

  if (parsed.data.status) query = query.eq("status", parsed.data.status);
  if (parsed.data.source_surface) query = query.eq("source_surface", parsed.data.source_surface);
  if (parsed.data.cursor) query = query.lt("updated_at", parsed.data.cursor);

  const { data, error } = await query;
  if (error) {
    sendTutorError(res, 500, "TUTOR_CONVERSATION_LIST_FAILED", "Failed to list tutor conversations.", req.requestId);
    return;
  }

  const rows = (data ?? []) as ConversationRow[];
  const selected = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? String(selected[selected.length - 1].updated_at) : null;
  return res.json({
    data: {
      conversations: selected.map((row) => ({
        conversation_id: row.id,
        entry_mode: row.entry_mode,
        source_surface: row.source_surface,
        status: row.status,
        resolved_scope: normalizeScope(row as unknown as Record<string, unknown>),
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      next_cursor: nextCursor,
    },
  });
});

router.post("/conversations/:conversationId/close", async (req: AuthenticatedRequest, res: Response) => {
  const user = requireRequestUser(req, res);
  if (!user) return;
  if (isGuardianUser(req) && !isAdminUser(req)) {
    sendForbidden(res, { error: "Student access required", message: "Guardians cannot access tutor.", requestId: req.requestId });
    return;
  }
  if (!(await ensureTutorEntitlement(req, res, user.id))) return;

  const parsed = TutorCloseConversationRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendTutorError(res, 400, "TUTOR_INVALID_REQUEST", "Invalid close conversation request.", req.requestId);
    return;
  }

  const conversation = await loadConversationOrDeny(req, res, req.params.conversationId);
  if (!conversation) return;

  const { data, error } = await supabaseServer
    .from("tutor_conversations")
    .update({
      status: parsed.data.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation.id)
    .select("id,status")
    .single();
  if (error || !data) {
    sendTutorError(res, 500, "TUTOR_CONVERSATION_CLOSE_FAILED", "Failed to close tutor conversation.", req.requestId);
    return;
  }

  return res.json({
    data: {
      conversation_id: data.id,
      status: data.status,
    },
  });
});

router.post("/messages", async (req: AuthenticatedRequest, res: Response) => {
  const user = requireRequestUser(req, res);
  if (!user) return;
  if (isGuardianUser(req) && !isAdminUser(req)) {
    sendForbidden(res, { error: "Student access required", message: "Guardians cannot access tutor.", requestId: req.requestId });
    return;
  }
  if (!(await ensureTutorEntitlement(req, res, user.id))) return;

  const parsed = TutorAppendMessageRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendTutorError(res, 400, "TUTOR_INVALID_REQUEST", "Invalid tutor append request.", req.requestId);
    return;
  }
  const body = parsed.data;

  const conversation = await loadConversationOrDeny(req, res, body.conversation_id);
  if (!conversation) return;
  if (conversation.status !== "active") {
    sendTutorError(res, 409, "TUTOR_CONVERSATION_NOT_ACTIVE", "Tutor conversation is not active.", req.requestId);
    return;
  }

  let tutorReservationId: string | null = null;
  let finalizedReservation = false;
  let finalizedWithSuccess = false;

  try {
    const reservation = await checkAndReserveTutorBudget({
      studentUserId: user.id,
      role: req.user?.role ?? null,
      sessionKey: conversation.id,
      reservedInputTokens: Math.max(1200, estimateTokenCount(body.message) + 900),
      reservedOutputTokens: 1200,
      requestId: req.requestId ?? null,
    });

    if (!reservation.allowed) {
      const isThrottle = reservation.code === "TUTOR_COOLDOWN_ACTIVE" || reservation.code === "TUTOR_DENSITY_LIMIT_EXCEEDED";
      return res.status(isThrottle ? 429 : 402).json({
        error: {
          code: reservation.code,
          message: reservation.message,
          retryable: isThrottle,
        },
        limitType: reservation.limitType,
        current: reservation.current,
        limit: reservation.limit,
        remaining: reservation.remaining,
        resetAt: reservation.resetAt,
        cooldownUntil: reservation.cooldownUntil,
        requestId: req.requestId,
      });
    }

    tutorReservationId = reservation.reservationId;

    const liveFullLength = await hasActiveFullLengthExam(user.id);
    if (liveFullLength) {
      sendTutorError(
        res,
        409,
        "TUTOR_UNAVAILABLE_LIVE_FULL_LENGTH",
        "Tutor is unavailable while a full-length test is live.",
        req.requestId,
      );
      return;
    }

    const scopeResolution = await resolveScope({
      conversation,
      client_scope: body.client_scope as Record<string, unknown> | undefined,
      student_id: user.id,
    });
    const resolvedScope = scopeResolution.resolved_scope;

    if (conversation.source_surface === "test_review") {
      const unlocked = await isFullLengthReviewUnlocked(user.id, resolvedScope.source_session_id);
      if (!unlocked) {
        sendTutorError(
          res,
          409,
          "TUTOR_REVIEW_LOCKED",
          "Tutor explanations for full-length tests are available only after completion.",
          req.requestId,
        );
        return;
      }
    }

    let studentMessage: MessageRow | null = null;
    let policyAssignmentId: string | null = null;

    const { data: existingStudentMessage, error: existingStudentError } = await supabaseServer
      .from("tutor_messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .eq("student_id", user.id)
      .eq("role", "student")
      .eq("client_turn_id", body.client_turn_id)
      .limit(1)
      .maybeSingle();

    if (existingStudentError) {
      sendRecoverableRetry(res, req.requestId);
      return;
    }

    if (existingStudentMessage) {
      studentMessage = existingStudentMessage as MessageRow;
    } else {
      const { data: insertedStudentMessage, error: insertStudentError } = await supabaseServer
        .from("tutor_messages")
        .insert({
          conversation_id: conversation.id,
          student_id: user.id,
          role: "student",
          content_kind: body.content_kind,
          message: body.message,
          content_json: {},
          client_turn_id: body.client_turn_id,
          explanation_level: null,
          source_session_id: resolvedScope.source_session_id,
          source_session_item_id: resolvedScope.source_session_item_id,
          source_question_row_id: resolvedScope.source_question_row_id,
          source_question_canonical_id: resolvedScope.source_question_canonical_id,
        })
        .select("*")
        .single();

      if (insertStudentError || !insertedStudentMessage) {
        sendRecoverableRetry(res, req.requestId);
        return;
      }
      studentMessage = insertedStudentMessage as MessageRow;
    }

    const { data: existingAssignment, error: existingAssignmentError } = await supabaseServer
      .from("tutor_instruction_assignments")
      .select("id")
      .eq("conversation_id", conversation.id)
      .eq("student_id", user.id)
      .eq("related_message_id", studentMessage.id)
      .limit(1)
      .maybeSingle();
    if (existingAssignmentError) {
      sendRecoverableRetry(res, req.requestId);
      return;
    }

    if (existingAssignment?.id) {
      policyAssignmentId = String(existingAssignment.id);
    } else {
      const { data: insertedAssignment, error: insertAssignmentError } = await supabaseServer
        .from("tutor_instruction_assignments")
        .insert({
          conversation_id: conversation.id,
          student_id: user.id,
          related_message_id: studentMessage.id,
          source_session_id: resolvedScope.source_session_id,
          source_session_item_id: resolvedScope.source_session_item_id,
          source_question_row_id: resolvedScope.source_question_row_id,
          source_question_canonical_id: resolvedScope.source_question_canonical_id,
          policy_family: conversation.policy_family,
          policy_variant: conversation.policy_variant,
          policy_version: conversation.policy_version,
          prompt_version: conversation.prompt_version,
          assignment_mode: conversation.assignment_mode,
          assignment_key: conversation.assignment_key,
          reason_snapshot: {
            trigger_type: "student_turn",
            source_surface: conversation.source_surface,
            entry_mode: conversation.entry_mode,
            scoped_anchor: resolvedScope.source_question_canonical_id ?? resolvedScope.source_question_row_id ?? null,
            policy_inputs: {
              content_kind: body.content_kind,
            },
            fallback_used: scopeResolution.fallback_reason,
            ignored_conflicts: scopeResolution.conflict_fields,
          },
        })
        .select("id")
        .single();
      if (insertAssignmentError || !insertedAssignment?.id) {
        sendRecoverableRetry(res, req.requestId);
        return;
      }
      policyAssignmentId = String(insertedAssignment.id);
    }

    const { data: existingTutorResponse } = await supabaseServer
      .from("tutor_messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .eq("student_id", user.id)
      .eq("role", "tutor")
      .gte("created_at", studentMessage.created_at)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existingTutorResponse) {
      const replayContent = parseReplayTutorContent((existingTutorResponse as MessageRow).content_json);
      if (!replayContent || !policyAssignmentId) {
        sendRecoverableRetry(res, req.requestId);
        return;
      }

      const replayQuestionLinks = replayContent[INTERNAL_QUESTION_LINKS_SNAPSHOT_KEY];
      const replayExposures = replayContent[INTERNAL_INSTRUCTION_EXPOSURES_SNAPSHOT_KEY];
      if (!Array.isArray(replayQuestionLinks) || !Array.isArray(replayExposures)) {
        sendRecoverableRetry(res, req.requestId);
        return;
      }

      const artifactsReady = await ensureCanonicalArtifactsPersisted({
        assignmentId: policyAssignmentId,
        conversationId: conversation.id,
        studentId: user.id,
        questionLinks: replayQuestionLinks,
        instructionExposures: replayExposures,
      });
      if (!artifactsReady) {
        sendRecoverableRetry(res, req.requestId);
        return;
      }

      finalizedWithSuccess = true;
      if (tutorReservationId) {
        finalizedReservation = true;
        await finalizeTutorUsage({
          reservationId: tutorReservationId,
          success: true,
          finalInputTokens: estimateTokenCount(body.message),
          finalOutputTokens: estimateTokenCount(String((existingTutorResponse as MessageRow).message ?? "")),
          finalCostMicros: estimateTutorCostMicros(
            estimateTokenCount(body.message),
            estimateTokenCount(String((existingTutorResponse as MessageRow).message ?? "")),
          ),
        });
      }
      return res.json({
        data: {
          conversation_id: conversation.id,
          message_id: (existingTutorResponse as MessageRow).id,
          response: {
            content: String((existingTutorResponse as MessageRow).message ?? ""),
            content_kind: (existingTutorResponse as MessageRow).content_kind,
            suggested_action: replayContent.suggested_action,
            ui_hints: replayContent.ui_hints,
          },
        },
      });
    }

    const { data: historyRows } = await supabaseServer
      .from("tutor_messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(12);

    const { data: memoryRows } = await supabaseServer
      .from("tutor_memory_summaries")
      .select("summary_type, summary_version, content_json, source_window_start, source_window_end")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(3);

    const orchestratorPayload = {
      conversation_id: conversation.id,
      student_id: user.id,
      entry_mode: conversation.entry_mode,
      source_surface: conversation.source_surface,
      resolved_scope: {
        source_session_id: resolvedScope.source_session_id,
        source_session_item_id: resolvedScope.source_session_item_id,
        source_question_row_id: resolvedScope.source_question_row_id,
        source_question_canonical_id: resolvedScope.source_question_canonical_id,
      },
      recent_messages: ((historyRows ?? []) as MessageRow[])
        .reverse()
        .map((row) => ({
          id: String(row.id),
          role: row.role,
          content_kind: row.content_kind,
          message: String(row.message ?? ""),
          created_at: String(row.created_at),
        })),
      memory_summaries: (memoryRows ?? []).map((row: any) => ({
        summary_type: row.summary_type,
        summary_version: row.summary_version,
        content_json: row.content_json ?? {},
        source_window_start: row.source_window_start ?? null,
        source_window_end: row.source_window_end ?? null,
      })),
      student_context: {
        recent_practice: {},
        recent_review: {},
        recent_full_length: {},
        kpi_state: {},
        mastery_state: {},
        study_plan_context: {},
      },
      policy_assignment: {
        policy_family: conversation.policy_family,
        policy_variant: conversation.policy_variant,
        policy_version: conversation.policy_version,
        prompt_version: conversation.prompt_version,
        assignment_mode: conversation.assignment_mode,
        assignment_key: conversation.assignment_key,
        reason_snapshot: {
          trigger_type: "student_turn",
          source_surface: conversation.source_surface,
          entry_mode: conversation.entry_mode,
          scoped_anchor:
            resolvedScope.source_question_canonical_id
            ?? resolvedScope.source_question_row_id
            ?? null,
          policy_inputs: {
            content_kind: body.content_kind,
          },
          fallback_used: scopeResolution.fallback_reason,
          ignored_conflicts: scopeResolution.conflict_fields,
        },
      },
      runtime_limits: {
        max_output_tokens: 600,
        timeout_ms: 8000,
      },
    };

    const orchestratorResult = await callTutorOrchestrator(orchestratorPayload);

    let cleaned = removeInternalMetadataMentions(
      String(orchestratorResult.response.content ?? "").trim(),
    );
    if (!cleaned) {
      sendRecoverableRetry(res, req.requestId);
      return;
    }

    if (conversation.source_surface === "practice") {
      const itemStatus = await getPracticeItemStatus(user.id, resolvedScope.source_session_item_id);
      const isPreSubmit = itemStatus !== "answered" && itemStatus !== "skipped";
      if (isPreSubmit && hasDirectAnswerLeak(cleaned)) {
        sendTutorError(
          res,
          422,
          "TUTOR_ANTI_LEAK_BLOCKED",
          "Tutor response was blocked to prevent answer leakage.",
          req.requestId,
        );
        return;
      }
    }

    const suggestedAction = orchestratorResult.response.suggested_action;
    const orchestratorUiHints = orchestratorResult.response.ui_hints;
    const questionLinksSnapshot = orchestratorResult.question_links;
    const instructionExposureSnapshot = orchestratorResult.instruction_exposures;

    const { data: insertedTutorMessage, error: insertTutorError } = await supabaseServer
      .from("tutor_messages")
      .insert({
        conversation_id: conversation.id,
        student_id: user.id,
        role: "tutor",
        content_kind: "message",
        message: cleaned,
        content_json: {
          suggested_action: suggestedAction,
          ui_hints: orchestratorUiHints,
          orchestration_meta: orchestratorResult.orchestration_meta,
          [INTERNAL_QUESTION_LINKS_SNAPSHOT_KEY]: questionLinksSnapshot,
          [INTERNAL_INSTRUCTION_EXPOSURES_SNAPSHOT_KEY]: instructionExposureSnapshot,
        },
        client_turn_id: null,
        explanation_level: null,
        source_session_id: resolvedScope.source_session_id,
        source_session_item_id: resolvedScope.source_session_item_id,
        source_question_row_id: resolvedScope.source_question_row_id,
        source_question_canonical_id: resolvedScope.source_question_canonical_id,
      })
      .select("*")
      .single();

    if (insertTutorError || !insertedTutorMessage) {
      sendRecoverableRetry(res, req.requestId);
      return;
    }

    if (!policyAssignmentId) {
      sendRecoverableRetry(res, req.requestId);
      return;
    }
    const canonicalWritesComplete = await ensureCanonicalArtifactsPersisted({
      assignmentId: policyAssignmentId,
      conversationId: conversation.id,
      studentId: user.id,
      questionLinks: questionLinksSnapshot,
      instructionExposures: instructionExposureSnapshot,
    });
    if (!canonicalWritesComplete) {
      sendRecoverableRetry(res, req.requestId);
      return;
    }

    await supabaseServer
      .from("tutor_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversation.id);

    finalizedWithSuccess = true;
    if (tutorReservationId) {
      finalizedReservation = true;
      await finalizeTutorUsage({
        reservationId: tutorReservationId,
        success: true,
        finalInputTokens: estimateTokenCount(body.message),
        finalOutputTokens: estimateTokenCount(cleaned),
        finalCostMicros: estimateTutorCostMicros(estimateTokenCount(body.message), estimateTokenCount(cleaned)),
      });
    }

    return res.json({
      data: {
        conversation_id: conversation.id,
        message_id: insertedTutorMessage.id,
        response: {
          content: cleaned,
          content_kind: "message",
          suggested_action: suggestedAction,
          ui_hints: orchestratorUiHints,
        },
      },
    });
  } catch (error: any) {
    console.warn("[tutor-runtime] append-turn failed", {
      message: error?.message ?? String(error),
      name: error?.name ?? "Error",
      requestId: req.requestId,
    });
    if (error instanceof RateLimitUnavailableError) {
      sendTutorError(res, 503, error.code, error.message, req.requestId, true);
      return;
    }
    sendRecoverableRetry(res, req.requestId);
  } finally {
    if (tutorReservationId && !finalizedReservation) {
      try {
        await finalizeTutorUsage({
          reservationId: tutorReservationId,
          success: finalizedWithSuccess,
          failureCode: finalizedWithSuccess ? null : "TUTOR_RUNTIME_ERROR",
          finalInputTokens: finalizedWithSuccess ? undefined : 0,
          finalOutputTokens: finalizedWithSuccess ? undefined : 0,
          finalCostMicros: finalizedWithSuccess ? undefined : 0,
        });
      } catch (finalizeError: any) {
        console.warn("[tutor-runtime] finalize_tutor_usage failure-mark degraded", {
          message: finalizeError?.message ?? String(finalizeError),
          requestId: req.requestId,
        });
      }
    }
  }
});

export default router;
