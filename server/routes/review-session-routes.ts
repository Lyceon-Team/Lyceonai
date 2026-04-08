import { Request, Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { type AuthenticatedRequest, requireRequestUser } from "../middleware/supabase-auth";
import { buildReviewQueueForStudent } from "../services/review-queue";
import { getReviewRuntimeAvailability, sendReviewRuntimeUnavailable } from "../lib/review-runtime-gate";
import {
  buildStudentSafeOptionTokens,
  buildStudentSafeOptionsFromStoredMap,
  type CanonicalMcOption,
  hasCanonicalOptionSet,
  hasSingleCanonicalCorrectAnswer,
  isCanonicalRuntimeMcQuestion,
  normalizeClientInstanceId,
  normalizeAnswerKey,
  parseStudentSafeOptionTokenMap,
  projectStudentSafeQuestion,
  resolveClientInstanceBinding,
} from "../../shared/question-bank-contract";
import { applyLearningEventToMastery } from "../../apps/api/src/services/studentMastery";

type SessionStatus = "created" | "active" | "completed" | "abandoned";
type ItemStatus = "queued" | "served" | "answered" | "skipped";
type TutorOutcome = "tutor_helped" | "tutor_fail";
type ReviewSessionMode = "all_past_mistakes" | "by_practice_session" | "by_full_length_session";

type SessionRow = {
  id: string;
  student_id: string;
  status: SessionStatus;
  started_at: string | null;
  completed_at: string | null;
  abandoned_at: string | null;
  client_instance_id: string | null;
};

type ItemRow = {
  id: string;
  review_session_id: string;
  student_id: string;
  ordinal: number;
  question_canonical_id: string;
  source_question_id: string | null;
  source_question_canonical_id: string | null;
  source_origin: "practice" | "full_test";
  retry_mode: "same_question" | "similar_question";
  status: ItemStatus;
  attempt_id: string | null;
  tutor_opened_at: string | null;
  source_attempted_at: string | null;
  option_order: string[] | null;
  option_token_map: Record<string, string> | null;
  question_section: string | null;
  question_stem: string | null;
  question_options: McOption[];
  question_difficulty: string | number | null;
  question_difficulty_bucket: number | null;
  question_domain: string | null;
  question_skill: string | null;
  question_subskill: string | null;
  question_exam: string | null;
  question_structure_cluster_id: string | null;
  question_correct_answer: string | null;
  question_explanation: string | null;
};

type McOption = CanonicalMcOption;

type CanonicalQuestion = {
  canonical_id: string;
  section: string;
  stem: string;
  options: McOption[];
  difficulty: string | number | null;
  correct_answer: string;
  explanation: string | null;
};

const REVIEW_ITEM_SELECT = "id, review_session_id, student_id, ordinal, question_canonical_id, source_question_id, source_question_canonical_id, source_origin, retry_mode, status, attempt_id, tutor_opened_at, source_attempted_at, option_order, option_token_map, question_section, question_stem, question_options, question_difficulty, question_difficulty_bucket, question_domain, question_skill, question_subskill, question_exam, question_structure_cluster_id, question_correct_answer, question_explanation";

const startSchema = z.object({
  mode: z.enum(["all_past_mistakes", "by_practice_session", "by_full_length_session"]),
  practice_session_id: z.string().uuid().optional().nullable(),
  full_length_session_id: z.string().uuid().optional().nullable(),
  filter: z.enum(["all", "incorrect", "skipped"]).optional().default("all"),
  client_instance_id: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
});

const submitSchema = z.object({
  session_id: z.string().uuid(),
  review_session_item_id: z.string().uuid(),
  selected_option_id: z.string().trim().max(128).optional().nullable(),
  action: z.enum(["answer", "skip"]).optional(),
  source_context: z.literal("review_errors").optional(),
  seconds_spent: z.number().int().nonnegative().nullable().optional(),
  client_attempt_id: z.string().max(128).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
});

function hasLegacyFreeResponseKeys(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, "freeResponseAnswer")
    || Object.prototype.hasOwnProperty.call(record, "free_response_answer");
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sendClientInstanceConflict(res: Response, requestId: string | undefined, clientInstanceId: string | null) {
  return res.status(409).json({
    error: "client_instance_conflict",
    code: "CLIENT_INSTANCE_CONFLICT",
    message: "Session client instance conflict",
    client_instance_id: clientInstanceId ?? null,
    requestId,
  });
}

function mapSession(row: any): SessionRow {
  return {
    id: String(row.id),
    student_id: String(row.student_id),
    status: row.status === "completed" ? "completed" : row.status === "abandoned" ? "abandoned" : row.status === "created" ? "created" : "active",
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    abandoned_at: row.abandoned_at ?? null,
    client_instance_id: optionalString(row.client_instance_id),
  };
}

function mapItem(row: any): ItemRow {
  const bucketFromColumn = typeof row.question_difficulty_bucket === "number" ? row.question_difficulty_bucket : null;
  const fallbackBucket = row.question_difficulty_bucket === undefined
    ? resolveDifficultyBucketStrict(row.question_difficulty ?? null)
    : null;
  return {
    id: String(row.id),
    review_session_id: String(row.review_session_id),
    student_id: String(row.student_id),
    ordinal: Number(row.ordinal),
    question_canonical_id: String(row.question_canonical_id),
    source_question_id: optionalString(row.source_question_id),
    source_question_canonical_id: optionalString(row.source_question_canonical_id),
    source_origin: row.source_origin === "full_test" ? "full_test" : "practice",
    retry_mode: row.retry_mode === "similar_question" ? "similar_question" : "same_question",
    status: row.status === "served" ? "served" : row.status === "answered" ? "answered" : row.status === "skipped" ? "skipped" : "queued",
    attempt_id: optionalString(row.attempt_id),
    tutor_opened_at: row.tutor_opened_at ?? null,
    source_attempted_at: row.source_attempted_at ?? null,
    option_order: Array.isArray(row.option_order) ? row.option_order : null,
    option_token_map: row.option_token_map && typeof row.option_token_map === "object" ? row.option_token_map : null,
    question_section: optionalString(row.question_section),
    question_stem: optionalString(row.question_stem),
    question_options: parseOptions(row.question_options),
    question_difficulty: row.question_difficulty ?? null,
    question_difficulty_bucket: bucketFromColumn ?? fallbackBucket,
    question_domain: optionalString(row.question_domain),
    question_skill: optionalString(row.question_skill),
    question_subskill: optionalString(row.question_subskill),
    question_exam: optionalString(row.question_exam),
    question_structure_cluster_id: optionalString(row.question_structure_cluster_id),
    question_correct_answer: optionalString(row.question_correct_answer),
    question_explanation: optionalString(row.question_explanation),
  };
}

function parseOptions(raw: unknown): McOption[] {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: McOption[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const key = normalizeAnswerKey((entry as any).key);
    const text = typeof (entry as any).text === "string" ? (entry as any).text : "";
    if (!key || !text) continue;
    out.push({ key, text });
  }
  return out;
}

function resolveDifficultyBucketStrict(value: unknown): 1 | 2 | 3 | null {
  if (value === 1 || value === 2 || value === 3) return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "easy" || normalized === "1") return 1;
    if (normalized === "medium" || normalized === "2") return 2;
    if (normalized === "hard" || normalized === "3") return 3;
    const parsed = Number.parseInt(normalized, 10);
    if (parsed === 1 || parsed === 2 || parsed === 3) return parsed as 1 | 2 | 3;
  }
  return null;
}

function resolveReviewQuestionId(item: ItemRow): string {
  return item.source_question_id ?? item.source_question_canonical_id ?? item.question_canonical_id;
}

function fisherYates<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildServedOptions(options: McOption[]) {
  const shuffled = fisherYates(options);
  const optionOrder = shuffled.map((o) => o.key);
  return buildStudentSafeOptionTokens(shuffled, optionOrder);
}

async function logEvent(sessionId: string, studentId: string, eventType: string, itemId?: string | null, payload?: Record<string, unknown>) {
  const { error } = await supabaseServer.from("review_session_events").insert({
    review_session_id: sessionId,
    review_session_item_id: itemId ?? null,
    student_id: studentId,
    event_type: eventType,
    event_payload: payload ?? null,
  });
  if (error) throw new Error(`review_event_failed:${error.message}`);
}
async function getSession(sessionId: string, studentId: string): Promise<SessionRow | null> {
  const { data, error } = await supabaseServer
    .from("review_sessions")
    .select("id, student_id, status, started_at, completed_at, abandoned_at, client_instance_id")
    .eq("id", sessionId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw new Error(`review_session_lookup_failed:${error.message}`);
  return data ? mapSession(data) : null;
}

async function getItems(sessionId: string, studentId: string): Promise<ItemRow[]> {
  const { data, error } = await supabaseServer
    .from("review_session_items")
    .select(REVIEW_ITEM_SELECT)
    .eq("review_session_id", sessionId)
    .eq("student_id", studentId)
    .order("ordinal", { ascending: true });
  if (error) throw new Error(`review_items_lookup_failed:${error.message}`);
  return (data ?? []).map(mapItem);
}

async function loadQuestionFromItem(item: ItemRow): Promise<CanonicalQuestion | null> {
  const embeddedOptions = item.question_options;
  const embeddedCorrect = normalizeAnswerKey(item.question_correct_answer);
  if (embeddedCorrect && hasCanonicalOptionSet(embeddedOptions) && hasSingleCanonicalCorrectAnswer(embeddedCorrect, embeddedOptions)) {
    return {
      canonical_id: String(item.question_canonical_id),
      section: String(item.question_section ?? ""),
      stem: String(item.question_stem ?? ""),
      options: embeddedOptions,
      difficulty: item.question_difficulty ?? null,
      correct_answer: embeddedCorrect,
      explanation: item.question_explanation ?? null,
    };
  }
  return null;
}

async function ensureServedItem(session: SessionRow, studentId: string, clientInstanceId: string | null): Promise<ItemRow | null> {
  const items = await getItems(session.id, studentId);
  const served = items.find((item) => item.status === "served") ?? null;
  if (served) return served;

  const queued = items.find((item) => item.status === "queued") ?? null;
  if (!queued) return null;

  const { data, error } = await supabaseServer
    .from("review_session_items")
    .update({ status: "served", client_instance_id: clientInstanceId ?? session.client_instance_id ?? null, updated_at: new Date().toISOString() })
    .eq("id", queued.id)
    .eq("review_session_id", session.id)
    .eq("student_id", studentId)
    .select(REVIEW_ITEM_SELECT)
    .single();

  if (error || !data) throw new Error(`review_promote_served_failed:${error?.message ?? "unknown"}`);
  const promoted = mapItem(data);

  await logEvent(session.id, studentId, "review_item_served", promoted.id, {
    ordinal: promoted.ordinal,
    question_canonical_id: promoted.question_canonical_id,
  });

  return promoted;
}

async function buildState(session: SessionRow, studentId: string, clientInstanceId: string | null) {
  const served = await ensureServedItem(session, studentId, clientInstanceId);
  const items = await getItems(session.id, studentId);
  const resolvedCount = items.filter((item) => item.status === "answered" || item.status === "skipped").length;
  const totalCount = items.length;

  if (!served) {
    return {
      session: {
        id: session.id,
        status: session.status,
        startedAt: session.started_at,
        completedAt: session.completed_at,
        abandonedAt: session.abandoned_at,
        currentOrdinal: null,
        resolvedCount,
        totalCount,
      },
      currentItem: null,
    };
  }

  const question = await loadQuestionFromItem(served);
  if (!question) throw new Error("review_question_unavailable");

  let safeOptions = buildStudentSafeOptionsFromStoredMap(question.options, served.option_order, served.option_token_map);
  if (!safeOptions) {
    const built = buildServedOptions(question.options);
    const { error: mapUpdateError } = await supabaseServer
      .from("review_session_items")
      .update({ option_order: built.optionOrder, option_token_map: built.optionTokenMap, updated_at: new Date().toISOString() })
      .eq("id", served.id)
      .eq("review_session_id", session.id)
      .eq("student_id", studentId);
    if (mapUpdateError) throw new Error(`review_option_map_update_failed:${mapUpdateError.message}`);

    safeOptions = buildStudentSafeOptionsFromStoredMap(question.options, built.optionOrder, built.optionTokenMap);
    if (!safeOptions) {
      throw new Error("review_option_map_invalid");
    }
  }

  const safeBase = projectStudentSafeQuestion({
    id: question.canonical_id,
    canonical_id: question.canonical_id,
    section: question.section,
    section_code: question.section,
    question_type: "multiple_choice",
    stem: question.stem,
    options: question.options,
    difficulty: question.difficulty,
    domain: null,
    skill: null,
    subskill: null,
    skill_code: null,
    tags: null,
    competencies: null,
    correct_answer: question.correct_answer,
    explanation: question.explanation,
  });

  return {
    session: {
      id: session.id,
      status: session.status,
      startedAt: session.started_at,
      completedAt: session.completed_at,
      abandonedAt: session.abandoned_at,
      currentOrdinal: served.ordinal,
      resolvedCount,
      totalCount,
    },
    currentItem: {
      id: served.id,
      ordinal: served.ordinal,
      sourceOrigin: served.source_origin,
      retryMode: served.retry_mode,
      question: {
        sessionItemId: served.id,
        stem: safeBase.stem,
        section: safeBase.section ?? question.section,
        questionType: "multiple_choice",
        options: safeOptions,
        difficulty: safeBase.difficulty,
        correct_answer: null,
        explanation: null,
      },
    },
  };
}

export async function startReviewErrorSession(req: AuthenticatedRequest, res: Response) {
  const requestId = req.requestId;
  try {
    const availability = await getReviewRuntimeAvailability();
    if (!availability.available) {
      return sendReviewRuntimeUnavailable(res, requestId, availability.missingTable);
    }

    const user = requireRequestUser(req, res);
    if (!user) return;

    const parsed = startSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const missingMode = parsed.error.issues.some((issue) => issue.path[0] === "mode");
      return res.status(400).json({
        error: missingMode ? "mode is required" : "Invalid request body",
        code: missingMode ? "REVIEW_MODE_REQUIRED" : "INVALID_REVIEW_SESSION_START_PAYLOAD",
        details: parsed.error.issues,
        requestId,
      });
    }

    const clientInstanceId = optionalString(parsed.data.client_instance_id);
    const idempotencyKey = optionalString(parsed.data.idempotency_key);
    const mode: ReviewSessionMode = parsed.data.mode;
    const practiceSessionId = optionalString(parsed.data.practice_session_id);
    const fullLengthSessionId = optionalString(parsed.data.full_length_session_id);

    if (mode === "by_practice_session" && !practiceSessionId) {
      return res.status(400).json({
        error: "practice_session_id is required for by_practice_session review mode",
        code: "REVIEW_MODE_MISSING_PRACTICE_SESSION_ID",
        requestId,
      });
    }

    if (mode === "by_full_length_session" && !fullLengthSessionId) {
      return res.status(400).json({
        error: "full_length_session_id is required for by_full_length_session review mode",
        code: "REVIEW_MODE_MISSING_FULL_LENGTH_SESSION_ID",
        requestId,
      });
    }

    if (mode === "all_past_mistakes" && (practiceSessionId || fullLengthSessionId)) {
      return res.status(400).json({
        error: "session-specific filters require by_practice_session or by_full_length_session mode",
        code: "REVIEW_MODE_CONFLICT",
        requestId,
      });
    }

    if (idempotencyKey) {
      const { data: replayRows, error: replayError } = await supabaseServer
        .from("review_sessions")
        .select("id, student_id, status, started_at, completed_at, abandoned_at, client_instance_id")
        .eq("student_id", user.id)
        .eq("idempotency_key", idempotencyKey)
        .order("created_at", { ascending: false })
        .limit(2);

      if (replayError) {
        return res.status(500).json({ error: "Failed to replay review session", code: "REVIEW_SESSION_REPLAY_LOOKUP_FAILED", detail: replayError.message, requestId });
      }

      const replaySessions = (replayRows ?? []).map(mapSession);
      if (replaySessions.length > 1) {
        return res.status(409).json({ error: "Ambiguous idempotent review session state", code: "AMBIGUOUS_IDEMPOTENT_REVIEW_SESSION", requestId });
      }

      if (replaySessions.length === 1) {
        const existing = replaySessions[0];
        const binding = resolveClientInstanceBinding({
          boundClientInstanceId: existing.client_instance_id,
          requestedClientInstanceId: clientInstanceId,
        });
        if (binding.action === "conflict") {
          return sendClientInstanceConflict(res, requestId, binding.boundClientInstanceId);
        }
        if (binding.action === "bind") {
          await supabaseServer
            .from("review_sessions")
            .update({ client_instance_id: binding.requestedClientInstanceId, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
            .eq("student_id", user.id);
          existing.client_instance_id = binding.requestedClientInstanceId;
        }
        const state = await buildState(existing, user.id, clientInstanceId);
        return res.status(200).json({ replayed: true, session: existing, state });
      }
    }

    const queue = await buildReviewQueueForStudent(user.id, {
      mode,
      practiceSessionId,
      fullLengthSessionId,
    });
    const unresolved = queue.unresolvedQueue.filter((snapshot) => parsed.data.filter === "all" || snapshot.outcome === parsed.data.filter);

    if (unresolved.length === 0) {
      return res.status(200).json({
        empty: true,
        message: "No unresolved review items right now. Great recovery streak.",
        session: null,
        state: { session: { id: null, status: "completed", startedAt: null, completedAt: null, abandonedAt: null, currentOrdinal: null, resolvedCount: 0, totalCount: 0 }, currentItem: null },
      });
    }

    const missingCanonical = unresolved.filter((row) => !row.questionCanonicalId);
    if (missingCanonical.length > 0) {
      return res.status(422).json({ error: "Review session cannot start due to missing canonical question identity", code: "REVIEW_QUEUE_MISSING_CANONICAL_ID", missingCount: missingCanonical.length, requestId });
    }

    const { data: activeRows, error: activeError } = await supabaseServer
      .from("review_sessions")
      .select("id, student_id, status, started_at, completed_at, abandoned_at, client_instance_id")
      .eq("student_id", user.id)
      .in("status", ["created", "active"])
      .order("created_at", { ascending: false })
      .limit(2);

    if (activeError) {
      return res.status(500).json({ error: "Failed to load active review sessions", code: "REVIEW_SESSION_LOOKUP_FAILED", detail: activeError.message, requestId });
    }

    const activeSessions = (activeRows ?? []).map(mapSession);
    if (activeSessions.length > 1) {
      return res.status(409).json({ error: "Ambiguous active review session state", code: "AMBIGUOUS_ACTIVE_REVIEW_SESSION", requestId });
    }

    if (activeSessions.length === 1) {
      const existing = activeSessions[0];
      const binding = resolveClientInstanceBinding({
        boundClientInstanceId: existing.client_instance_id,
        requestedClientInstanceId: clientInstanceId,
      });
      if (binding.action === "conflict") {
        return sendClientInstanceConflict(res, requestId, binding.boundClientInstanceId);
      }
      if (binding.action === "bind") {
        await supabaseServer
          .from("review_sessions")
          .update({ client_instance_id: binding.requestedClientInstanceId, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .eq("student_id", user.id);
        existing.client_instance_id = binding.requestedClientInstanceId;
      }
      const state = await buildState(existing, user.id, clientInstanceId);
      return res.status(200).json({ replayed: true, session: existing, state });
    }

    const nowIso = new Date().toISOString();
    const { data: createdSessionRow, error: createSessionError } = await supabaseServer
      .from("review_sessions")
      .insert({
        student_id: user.id,
        status: "active",
        source_context: "review_errors",
        started_at: nowIso,
        client_instance_id: clientInstanceId,
        idempotency_key: idempotencyKey,
      })
      .select("id, student_id, status, started_at, completed_at, abandoned_at, client_instance_id")
      .single();

    if (createSessionError || !createdSessionRow) {
      if (createSessionError?.code === "23505" && idempotencyKey) {
        const { data: existingByKey } = await supabaseServer
          .from("review_sessions")
          .select("id, student_id, status, started_at, completed_at, abandoned_at, client_instance_id")
          .eq("student_id", user.id)
          .eq("idempotency_key", idempotencyKey)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingByKey) {
          const existing = mapSession(existingByKey);
          const binding = resolveClientInstanceBinding({
            boundClientInstanceId: existing.client_instance_id,
            requestedClientInstanceId: clientInstanceId,
          });
          if (binding.action === "conflict") {
            return sendClientInstanceConflict(res, requestId, binding.boundClientInstanceId);
          }
          if (binding.action === "bind") {
            await supabaseServer
              .from("review_sessions")
              .update({ client_instance_id: binding.requestedClientInstanceId, updated_at: new Date().toISOString() })
              .eq("id", existing.id)
              .eq("student_id", user.id);
            existing.client_instance_id = binding.requestedClientInstanceId;
          }
          const state = await buildState(existing, user.id, clientInstanceId);
          return res.status(200).json({ replayed: true, session: existing, state });
        }
      }
      return res.status(500).json({ error: "Failed to create review session", code: "REVIEW_SESSION_CREATE_FAILED", detail: createSessionError?.message, requestId });
    }

    const session = mapSession(createdSessionRow);

    const materializedRows = unresolved.map((snapshot, index) => {
      const canonicalId = String(snapshot.questionCanonicalId);
      const runtimeSnapshotCandidate = {
        canonical_id: canonicalId,
        section: snapshot.section,
        section_code: snapshot.section,
        question_type: "multiple_choice",
        stem: snapshot.questionText,
        options: snapshot.questionOptions,
        difficulty: snapshot.difficulty,
        answer_choice: snapshot.questionCorrectAnswer,
        answer: snapshot.questionCorrectAnswer,
        explanation: snapshot.questionExplanation,
      };
      if (!isCanonicalRuntimeMcQuestion(runtimeSnapshotCandidate as any)) {
        throw new Error(`review_question_snapshot_invalid:${canonicalId}`);
      }

      const options = parseOptions(snapshot.questionOptions);
      const correctAnswer = normalizeAnswerKey(snapshot.questionCorrectAnswer);
      if (!correctAnswer || !hasCanonicalOptionSet(options) || !hasSingleCanonicalCorrectAnswer(correctAnswer, options)) {
        throw new Error(`review_question_snapshot_invalid:${canonicalId}`);
      }

      const served = buildServedOptions(options);
      return {
        review_session_id: session.id,
        student_id: user.id,
        ordinal: index + 1,
        question_canonical_id: canonicalId,
        source_question_id: snapshot.questionId,
        source_question_canonical_id: snapshot.questionCanonicalId,
        source_origin: snapshot.source,
        retry_mode: "same_question",
        status: index === 0 ? "served" : "queued",
        source_attempted_at: snapshot.attemptedAt,
        client_instance_id: clientInstanceId,
        option_order: served.optionOrder,
        option_token_map: served.optionTokenMap,
        question_section: String(snapshot.section ?? ""),
        question_stem: String(snapshot.questionText ?? ""),
        question_options: options,
        question_difficulty: snapshot.difficulty ?? null,
        question_difficulty_bucket: resolveDifficultyBucketStrict(snapshot.difficulty ?? null),
        question_domain: snapshot.domain ?? null,
        question_skill: snapshot.skill ?? null,
        question_subskill: snapshot.subskill ?? null,
        question_exam: snapshot.questionExam ?? null,
        question_structure_cluster_id: snapshot.questionStructureClusterId ?? null,
        question_correct_answer: correctAnswer,
        question_explanation: typeof snapshot.questionExplanation === "string" && snapshot.questionExplanation.trim().length > 0
          ? snapshot.questionExplanation
          : null,
      };
    });

    const { data: insertedItems, error: insertItemsError } = await supabaseServer
      .from("review_session_items")
      .insert(materializedRows)
      .select("id, ordinal, question_canonical_id");

    if (insertItemsError) {
      return res.status(500).json({ error: "Failed to materialize review session items", code: "REVIEW_SESSION_ITEM_MATERIALIZE_FAILED", detail: insertItemsError.message, requestId });
    }

    await logEvent(session.id, user.id, "review_session_opened", null, { total_items: materializedRows.length });
    const first = (insertedItems ?? []).find((row: any) => Number((row as any).ordinal) === 1);
    if (first) {
      await logEvent(session.id, user.id, "review_item_served", String((first as any).id), {
        ordinal: Number((first as any).ordinal),
        question_canonical_id: String((first as any).question_canonical_id),
      });
    }

    const state = await buildState(session, user.id, clientInstanceId);
    return res.status(201).json({ replayed: false, session, state });
  } catch (error: any) {
    return res.status(500).json({ error: "Internal server error", detail: error?.message ?? "unknown", requestId });
  }
}

export async function getReviewErrorSessionState(req: AuthenticatedRequest, res: Response) {
  const requestId = req.requestId;
  try {
    const availability = await getReviewRuntimeAvailability();
    if (!availability.available) {
      return sendReviewRuntimeUnavailable(res, requestId, availability.missingTable);
    }

    const user = requireRequestUser(req, res);
    if (!user) return;

    const sessionId = optionalString(req.params.sessionId);
    if (!sessionId) return res.status(400).json({ error: "sessionId is required", code: "MISSING_REVIEW_SESSION_ID", requestId });

    const clientInstanceId = normalizeClientInstanceId(req.query.client_instance_id);
    const session = await getSession(sessionId, user.id);
    if (!session) return res.status(404).json({ error: "Review session not found", code: "REVIEW_SESSION_NOT_FOUND", requestId });

    const binding = resolveClientInstanceBinding({
      boundClientInstanceId: session.client_instance_id,
      requestedClientInstanceId: clientInstanceId,
    });
    if (binding.action === "conflict") {
      return sendClientInstanceConflict(res, requestId, binding.boundClientInstanceId);
    }
    if (binding.action === "bind") {
      await supabaseServer
        .from("review_sessions")
        .update({ client_instance_id: binding.requestedClientInstanceId, updated_at: new Date().toISOString() })
        .eq("id", session.id)
        .eq("student_id", user.id);
      session.client_instance_id = binding.requestedClientInstanceId;
    }

    const state = await buildState(session, user.id, clientInstanceId);
    return res.status(200).json(state);
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to fetch review session state", code: "REVIEW_SESSION_STATE_FAILED", detail: error?.message ?? "unknown", requestId });
  }
}

export async function submitReviewSessionAnswer(req: Request, res: Response) {
  const requestId = req.requestId;
  try {
    const availability = await getReviewRuntimeAvailability();
    if (!availability.available) {
      return sendReviewRuntimeUnavailable(res, requestId, availability.missingTable);
    }

    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED", requestId });

    if (hasLegacyFreeResponseKeys(req.body)) {
      return res.status(400).json({
        error: "free-response answers are not supported on canonical multiple-choice review submit",
        code: "REVIEW_MC_OPTION_REQUIRED",
        requestId,
      });
    }

    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body", code: "INVALID_REVIEW_ATTEMPT_PAYLOAD", details: parsed.error.issues, requestId });

    const session = await getSession(parsed.data.session_id, userId);
    if (!session) return res.status(404).json({ error: "Review session not found", code: "REVIEW_SESSION_NOT_FOUND", requestId });

    const clientInstanceId = normalizeClientInstanceId(parsed.data.client_instance_id);
    const binding = resolveClientInstanceBinding({
      boundClientInstanceId: session.client_instance_id,
      requestedClientInstanceId: clientInstanceId,
    });
    if (binding.action === "conflict") {
      return sendClientInstanceConflict(res, requestId, binding.boundClientInstanceId);
    }
    if (binding.action === "bind") {
      await supabaseServer
        .from("review_sessions")
        .update({ client_instance_id: binding.requestedClientInstanceId, updated_at: new Date().toISOString() })
        .eq("id", session.id)
        .eq("student_id", userId)
        .in("status", ["created", "active"]);
      session.client_instance_id = binding.requestedClientInstanceId;
    }

    const { data: itemRow, error: itemError } = await supabaseServer
      .from("review_session_items")
      .select(REVIEW_ITEM_SELECT)
      .eq("id", parsed.data.review_session_item_id)
      .eq("review_session_id", parsed.data.session_id)
      .eq("student_id", userId)
      .single();

    if (itemError || !itemRow) return res.status(404).json({ error: "Review session item not found", code: "REVIEW_SESSION_ITEM_NOT_FOUND", requestId });

    const item = mapItem(itemRow);
    const resolvedQuestionId = resolveReviewQuestionId(item);
    if (item.status !== "served") {
      if (item.attempt_id) {
        const { data: existing } = await supabaseServer
          .from("review_error_attempts")
          .select("id, question_id, is_correct")
          .eq("id", item.attempt_id)
          .eq("student_id", userId)
          .maybeSingle();
        if (existing) {
          if (String((existing as any).question_id ?? "") !== resolvedQuestionId) {
            return res.status(409).json({ error: "Review session item is already resolved", code: "REVIEW_SESSION_ITEM_LOCKED", requestId });
          }
          const isCorrect = Boolean((existing as any).is_correct);
          return res.status(200).json({ ok: true, idempotent: true, sessionId: session.id, reviewSessionItemId: item.id, verified_is_correct: isCorrect, reviewOutcome: isCorrect ? "review_pass" : "review_fail", tutorVerifiedRetry: false, tutorOutcome: null, masteryApplied: false, masteryEvents: [], masteryErrors: [] });
        }
      }

      if (parsed.data.client_attempt_id) {
        const { data: existingByKey } = await supabaseServer
          .from("review_error_attempts")
          .select("id, question_id, is_correct")
          .eq("student_id", userId)
          .eq("client_attempt_id", parsed.data.client_attempt_id)
          .maybeSingle();

        if (existingByKey) {
          if (String((existingByKey as any).question_id ?? "") !== resolvedQuestionId) {
            return res.status(409).json({ error: "client_attempt_id is already bound to a different question", code: "IDEMPOTENCY_KEY_REUSED", requestId });
          }
          const isCorrect = Boolean((existingByKey as any).is_correct);
          return res.status(200).json({ ok: true, idempotent: true, sessionId: session.id, reviewSessionItemId: item.id, verified_is_correct: isCorrect, reviewOutcome: isCorrect ? "review_pass" : "review_fail", tutorVerifiedRetry: false, tutorOutcome: null, masteryApplied: false, masteryEvents: [], masteryErrors: [] });
        }
      }

      return res.status(409).json({ error: "Review session item is already resolved", code: "REVIEW_SESSION_ITEM_LOCKED", requestId });
    }

    if (session.status !== "active" && session.status !== "created") {
      return res.status(409).json({ error: "Review session is not active", code: "REVIEW_SESSION_NOT_ACTIVE", requestId });
    }

    if (parsed.data.action === "skip") {
      await supabaseServer.from("review_session_items").update({ status: "skipped", answered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", item.id).eq("review_session_id", session.id).eq("student_id", userId).eq("status", "served");
      await logEvent(session.id, userId, "review_answer_submitted", item.id, { action: "skip" });
      return res.status(200).json({ ok: true, skipped: true, sessionId: session.id, reviewSessionItemId: item.id });
    }

    const question = await loadQuestionFromItem(item);
    if (!question) return res.status(422).json({ error: "Question could not be loaded for review submission", code: "INVALID_QUESTION_DATA", requestId });

    const optionMap = parseStudentSafeOptionTokenMap(item.option_token_map);
    const selectedAnswerKey = parsed.data.selected_option_id && optionMap
      ? optionMap[parsed.data.selected_option_id] ?? null
      : null;
    if (!selectedAnswerKey) return res.status(400).json({ error: "selected_option_id is required", code: "REVIEW_SELECTED_OPTION_REQUIRED", requestId });

    const correctAnswerKey = normalizeAnswerKey(question.correct_answer);
    const verifiedIsCorrect = Boolean(selectedAnswerKey && correctAnswerKey && selectedAnswerKey === correctAnswerKey);

    const { data: insertedAttempt, error: insertError } = await supabaseServer.from("review_error_attempts").insert({
      student_id: userId,
      question_id: resolvedQuestionId,
      context: "review_errors",
      selected_answer: selectedAnswerKey,
      is_correct: verifiedIsCorrect,
      seconds_spent: parsed.data.seconds_spent || null,
      client_attempt_id: parsed.data.client_attempt_id || null,
    }).select().single();

    if (insertError) {
      if (insertError.code === "23505" && parsed.data.client_attempt_id) {
        const { data: existing } = await supabaseServer.from("review_error_attempts").select("id, question_id, is_correct").eq("student_id", userId).eq("client_attempt_id", parsed.data.client_attempt_id).single();
        if (existing && String((existing as any).question_id) !== resolvedQuestionId) {
          return res.status(409).json({ error: "client_attempt_id is already bound to a different question", code: "IDEMPOTENCY_KEY_REUSED", requestId });
        }
        const existingIsCorrect = Boolean((existing as any)?.is_correct);
        return res.status(200).json({ ok: true, idempotent: true, sessionId: session.id, reviewSessionItemId: item.id, verified_is_correct: existingIsCorrect, reviewOutcome: existingIsCorrect ? "review_pass" : "review_fail", tutorVerifiedRetry: false, tutorOutcome: null, masteryApplied: false, masteryEvents: [], masteryErrors: [] });
      }
      return res.status(500).json({ error: "Failed to record attempt", detail: insertError.message, requestId });
    }

    await supabaseServer.from("review_session_items").update({ status: "answered", attempt_id: String((insertedAttempt as any).id), answered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", item.id).eq("review_session_id", session.id).eq("student_id", userId).eq("status", "served");

    const masteryEvents: string[] = [];
    const masteryErrors: string[] = [];
    const emit = async () => {
      if (!item.question_canonical_id) {
        masteryErrors.push("Missing canonical ID for mastery emission");
        return;
      }
      const section = item.question_section?.trim() ?? "";
      const domain = item.question_domain?.trim() ?? "";
      const skill = item.question_skill?.trim() ?? "";
      const difficultyBucket = resolveDifficultyBucketStrict(item.question_difficulty_bucket);
      if (!difficultyBucket) {
        masteryErrors.push("Invalid difficulty bucket for mastery emission");
        console.warn("[review] mastery emission skipped (invalid difficulty bucket)", {
          sessionId: session.id,
          questionCanonicalId: item.question_canonical_id,
          sourceFamily: "review",
          rawDifficulty: item.question_difficulty_bucket ?? null,
        });
        return;
      }
      if (!section || !domain || !skill) {
        masteryErrors.push("Missing section/domain/skill metadata for mastery emission");
        console.warn("[review] mastery emission skipped (missing metadata)", {
          sessionId: session.id,
          questionCanonicalId: item.question_canonical_id,
          sourceFamily: "review",
          section: section || null,
          domain: domain || null,
          skill: skill || null,
        });
        return;
      }
      const result = await applyLearningEventToMastery({
        studentId: userId,
        section,
        domain,
        skill,
        difficulty: difficultyBucket,
        sourceFamily: "review",
        correct: verifiedIsCorrect,
        latencyMs: typeof parsed.data.seconds_spent === "number" ? parsed.data.seconds_spent * 1000 : null,
        occurredAt: (insertedAttempt as any)?.created_at ?? new Date().toISOString(),
      });
      masteryEvents.push(verifiedIsCorrect ? "review_pass" : "review_fail");
      if (!result.ok && result.error) masteryErrors.push(result.error);
    };

    await emit();

    let tutorVerifiedRetry = false;
    let tutorOutcome: TutorOutcome | null = null;
    const { data: tutorContext } = await supabaseServer.from("tutor_interactions").select("id, created_at").eq("user_id", userId).contains("canonical_ids_used", [item.question_canonical_id]).gte("created_at", item.source_attempted_at || "1970-01-01T00:00:00.000Z").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (tutorContext) {
      tutorVerifiedRetry = true;
      tutorOutcome = verifiedIsCorrect ? "tutor_helped" : "tutor_fail";
      await logEvent(session.id, userId, "tutor_opened", item.id);
      await logEvent(session.id, userId, "tutor_response_served", item.id);
    }

    await logEvent(session.id, userId, "review_answer_submitted", item.id, { is_correct: verifiedIsCorrect });
    await logEvent(session.id, userId, "mastery_event_emitted", item.id, { mastery_events: masteryEvents, mastery_errors: masteryErrors });

    const { data: nextQueued } = await supabaseServer.from("review_session_items").select("id, ordinal, question_canonical_id").eq("review_session_id", session.id).eq("student_id", userId).eq("status", "queued").gt("ordinal", item.ordinal).order("ordinal", { ascending: true }).limit(1).maybeSingle();
    if (nextQueued) {
      await supabaseServer.from("review_session_items").update({ status: "served", updated_at: new Date().toISOString(), client_instance_id: parsed.data.client_instance_id || session.client_instance_id || null }).eq("id", String((nextQueued as any).id)).eq("review_session_id", session.id).eq("student_id", userId);
      await logEvent(session.id, userId, "review_item_served", String((nextQueued as any).id), { ordinal: Number((nextQueued as any).ordinal), question_canonical_id: String((nextQueued as any).question_canonical_id) });
    } else {
      await supabaseServer.from("review_sessions").update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", session.id).eq("student_id", userId).in("status", ["created", "active"]);
      await logEvent(session.id, userId, "review_session_completed");
    }

    const correctOptionId = optionMap && correctAnswerKey ? Object.entries(optionMap).find((entry) => entry[1] === correctAnswerKey)?.[0] ?? null : null;

    return res.status(200).json({
      ok: true,
      attempt: insertedAttempt,
      sessionId: session.id,
      reviewSessionItemId: item.id,
      verified_is_correct: verifiedIsCorrect,
      reviewOutcome: verifiedIsCorrect ? "review_pass" : "review_fail",
      tutorVerifiedRetry,
      tutorOutcome,
      masteryApplied: masteryEvents.length > 0 && masteryErrors.length === 0,
      masteryEvents,
      masteryErrors,
      mode: "multiple_choice",
      correctOptionId,
      correctAnswerText: question.options.find((o) => normalizeAnswerKey(o.key) === correctAnswerKey)?.text ?? null,
      explanation: question.explanation,
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Internal server error", detail: error?.message ?? "unknown", requestId: req.requestId });
  }
}





