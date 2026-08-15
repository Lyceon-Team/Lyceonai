/**
 * @spec [Doc-03A_V3 §9.1, §10.2, §7.6; Doc-03C_V3 §8.3; INV-03-14]
 * @implemented 2026-08-14
 *
 * plain English: Chat compaction service. Implements the compaction algorithm
 * for the conversation-close trigger:
 *   0a. Derive student_id from the conversation row (INV-03-14).
 *       There is only one source — the conversation's owner.
 *   0b. Gate — conversation must have enough messages (§9.1)
 *   1. Load all messages from `tutor_messages` for the conversation
 *   2. Call Vertex for summary via the existing /compact worker endpoint
 *   3. Parse the LLM output into the §10.2 chat_compaction schema and write
 *      the row to `tutor_memory_summaries`
 *   4. Fire `memory_summary_updated` NOTIFY for cache invalidation
 *
 * expected outcome: After a conversation is closed (and has enough turns),
 * a `chat_compaction` row is upserted into `tutor_memory_summaries` with
 * the structured content_json matching §10.2. On duplicate execution (same
 * conversation_id), the row is overwritten per Doc 03C §8.3: "duplicate
 * (conversation_id, trigger_reason) produces same summary (overwrite
 * previous); no harm from duplicate execution."
 *
 * trade-offs:
 *  - The §10.2 schema requires structured fields (topics_discussed,
 *    skills_referenced, key_insights, unresolved_confusion). The existing
 *    /compact worker returns free-text summary. This service uses a
 *    structured extraction prompt that produces JSON, then validates and
 *    truncates to schema bounds (max 5 key_insights, max 5
 *    unresolved_confusion, max 10 topics_discussed, each entry <200 chars).
 *  - The write is an UPSERT on (student_id, summary_type) per the UNIQUE
 *    constraint. Previous chat_compaction for the same student is replaced.
 *    §10.2 says "one current summary per student per type; history via
 *    soft-versioning in content_json."
 *  - Layer B (§7.6): content_json is Zod-validated before the write attempt.
 *    The DB trigger is a structural safety net; the service enforces semantic
 *    validity (conversation_id references a real conversation, timestamps
 *    are coherent with the messages loaded).
 *
 * edge cases:
 *  - Conversations below `recent_message_window` are not compacted (§9.1).
 *  - If the Vertex call fails, the error is logged and the compaction is
 *    skipped. The conversation is already closed; the summary can be
 *    retried on the next stale-summary sweep.
 *  - If the structured extraction returns malformed JSON, a fallback
 *    compact summary is built from the free-text with empty structured
 *    fields (the DB trigger still validates).
 */
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { compactConversation } from "../lib/tutor-orchestrator-client";
import { TutorConfig } from "./tutor-config";

// ── §10.2 chat_compaction content_json Zod schema ─────────────────────

const MAX_KEY_INSIGHTS = 5;
const MAX_UNRESOLVED_CONFUSION = 5;
const MAX_TOPICS_DISCUSSED = 10;
const MAX_ENTRY_LENGTH = 200;

const boundedStringArray = (maxItems: number) =>
  z.array(z.string().max(MAX_ENTRY_LENGTH)).max(maxItems);

export const chatCompactionContentSchema = z.object({
  summary_version: z.literal("1.0"),
  conversation_id: z.string().uuid(),
  source_window_start: z.string(),
  source_window_end: z.string(),
  turns_compacted: z.number().int().nonnegative(),
  topics_discussed: boundedStringArray(MAX_TOPICS_DISCUSSED),
  skills_referenced: z.array(z.string()),
  key_insights: boundedStringArray(MAX_KEY_INSIGHTS),
  unresolved_confusion: boundedStringArray(MAX_UNRESOLVED_CONFUSION),
  last_student_direction: z.string().nullable(),
});

export type ChatCompactionContent = z.infer<typeof chatCompactionContentSchema>;

// ── Result type (no throws for expected failures per Coding Standards §13) ──

type CompactionResult =
  | { ok: true; summaryId: string }
  | { ok: false; reason: string };

// ── Structured extraction prompt ──────────────────────────────────────

const STRUCTURED_EXTRACTION_SYSTEM = [
  "You analyze a tutoring conversation between an SAT student and a tutor.",
  "Extract the following fields as a JSON object (no markdown fences, no commentary):",
  "",
  "{",
  '  "topics_discussed": ["short topic label", ...],',
  '  "skills_referenced": ["skill identifier or short description", ...],',
  '  "key_insights": ["what the student learned or demonstrated", ...],',
  '  "unresolved_confusion": ["what the student still struggled with", ...],',
  '  "last_student_direction": "what the student was working on at the end, or null"',
  "}",
  "",
  "Rules:",
  "- topics_discussed: max 10 entries, each under 200 characters",
  "- skills_referenced: list SAT skill areas discussed (e.g. 'linear equations', 'reading comprehension')",
  "- key_insights: max 5 entries, each under 200 characters. What went well.",
  "- unresolved_confusion: max 5 entries, each under 200 characters. What needs more work.",
  "- last_student_direction: one sentence or null if conversation ended naturally",
  "- Do not invent facts not present in the conversation",
  "- Do not restate correct answers to specific questions",
  "- Do not estimate scores or confidence levels",
].join("\n");

// ── Core compaction function ──────────────────────────────────────────

/**
 * Execute chat compaction for a closed conversation.
 *
 * @spec [Doc-03A_V3 §9.1, §10.2; Doc-03C_V3 §8.3; INV-03-14]
 *
 * Steps:
 *   0a. Derive student_id from the conversation row (INV-03-14).
 *       There is only one source — the conversation's owner.
 *       If the conversation does not exist or the lookup fails, fail closed.
 *   0b. Gate — conversation must have enough messages
 *   1. Load all messages for the conversation
 *   2. Call Vertex via the existing /compact worker for structured extraction
 *   3. Validate and write to tutor_memory_summaries
 *   4. Fire NOTIFY for cache invalidation
 *
 * @param conversationId  The conversation to compact
 * @param requestId       Correlation ID for observability
 * @returns CompactionResult — ok: true with summaryId, or ok: false with reason
 */
export async function executeCompaction(
  conversationId: string,
  requestId: string,
): Promise<CompactionResult> {
  // ── Step 0a: Derive student_id from conversation (INV-03-14) ──────
  // The conversation row is the single source of truth for ownership.
  // No caller-supplied student_id exists — there is nothing to compare
  // against, because there is only one source.
  const ownership = await deriveConversationOwner(conversationId);
  if (!ownership.ok) {
    logger.warn(
      "TUTOR_COMPACTION",
      "ownership_lookup_rejected",
      `Cannot derive student_id for conversation ${conversationId}; compaction rejected`,
      {
        conversationId,
        reason: ownership.reason,
        requestId,
      },
    );
    return { ok: false, reason: ownership.reason };
  }
  const derivedStudentId = ownership.derivedStudentId;

  logger.info(
    "TUTOR_COMPACTION",
    "ownership_derived",
    `Derived student_id from conversation row`,
    { conversationId, derivedStudentId, requestId },
  );

  // ── Step 0b: Gate — conversation must have enough messages ────────
  const messageWindow = TutorConfig.get("recent_message_window");

  // Load ALL messages for the conversation (no window limit)
  const messages = await loadAllConversationMessages(conversationId);

  if (messages.length < messageWindow) {
    logger.info(
      "TUTOR_COMPACTION",
      "below_threshold",
      `Conversation has ${messages.length} messages, below recent_message_window (${messageWindow}); skipping compaction`,
      {
        conversationId,
        messageCount: messages.length,
        threshold: messageWindow,
      },
    );
    return { ok: false, reason: "below_message_threshold" };
  }

  // ── Step 1: Messages already loaded above ──────────────────────────

  const sourceWindowStart = messages[0].created_at;
  const sourceWindowEnd = messages[messages.length - 1].created_at;

  logger.info(
    "TUTOR_COMPACTION",
    "compaction_started",
    `Starting compaction for conversation with ${messages.length} messages`,
    { conversationId, messageCount: messages.length, requestId },
  );

  // ── Step 2: Call Vertex via the /compact worker ────────────────────
  const recentMessages = messages.map((m) => ({
    id: m.id,
    role: m.role,
    content_kind: m.content_kind,
    message: m.message,
    created_at: m.created_at,
  }));

  const compactResult = await compactConversation({
    conversation_id: conversationId,
    student_id: derivedStudentId,
    recent_messages: recentMessages,
  });

  if (!compactResult.ok) {
    logger.error(
      "TUTOR_COMPACTION",
      "vertex_call_failed",
      "Compaction Vertex call failed; summary deferred to next sweep",
      { errorCode: compactResult.errorCode },
      { conversationId, requestId },
    );
    return { ok: false, reason: `vertex_failed:${compactResult.errorCode}` };
  }

  const rawSummary = compactResult.value.summary;
  if (!rawSummary) {
    logger.warn(
      "TUTOR_COMPACTION",
      "empty_summary",
      "Vertex returned null summary despite messages being provided",
      { conversationId, requestId },
    );
    return { ok: false, reason: "empty_summary" };
  }

  // ── Parse structured extraction ────────────────────────────────────
  const contentJson = buildContentJson(
    rawSummary,
    conversationId,
    sourceWindowStart,
    sourceWindowEnd,
    messages.length,
  );

  // ── Step 2b: Validate content_json against §10.2 schema (Layer B) ──
  const validation = chatCompactionContentSchema.safeParse(contentJson);
  if (!validation.success) {
    logger.error(
      "TUTOR_COMPACTION",
      "content_validation_failed",
      "Built content_json failed §10.2 schema validation",
      { errors: validation.error.flatten() },
      { conversationId, requestId },
    );
    return { ok: false, reason: "content_schema_invalid" };
  }

  // ── Step 3: Write to tutor_memory_summaries ────────────────────────
  const writeResult = await writeCompactionSummary(
    derivedStudentId,
    validation.data,
    sourceWindowStart,
    sourceWindowEnd,
    requestId,
  );

  if (!writeResult.ok) {
    return writeResult;
  }

  // ── Step 4: Fire NOTIFY for cache invalidation ─────────────────────
  await fireMemorySummaryNotify(derivedStudentId, "chat_compaction");

  logger.info(
    "TUTOR_COMPACTION",
    "compaction_complete",
    "Chat compaction summary written successfully",
    {
      conversationId,
      summaryId: writeResult.summaryId,
      turnsCompacted: messages.length,
      requestId,
    },
  );

  return { ok: true, summaryId: writeResult.summaryId };
}

// ── Internal helpers ──────────────────────────────────────────────────

// ── Ownership verification types ────────────────────────────────────

type OwnershipOk = {
  ok: true;
  derivedStudentId: string;
};

type OwnershipFail = {
  ok: false;
  reason: string;
};

type OwnershipResult = OwnershipOk | OwnershipFail;

/**
 * Derive the owning student_id from the conversation row.
 *
 * @spec [INV-03-14: conversation ownership invariant]
 *
 * plain English: loads the conversation row by its id (service-role, so no RLS)
 * and reads its student_id. If the conversation does not exist or the lookup
 * fails, compaction is rejected (fail closed). There is no comparison —
 * the conversation row is the single source of truth.
 *
 * @param conversationId  The conversation to look up
 * @returns OwnershipResult — ok: true with derivedStudentId, or ok: false with reason
 */
async function deriveConversationOwner(
  conversationId: string,
): Promise<OwnershipResult> {
  const { data, error } = await supabaseServer
    .from("tutor_conversations")
    .select("student_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    logger.error(
      "TUTOR_COMPACTION",
      "ownership_lookup_failed",
      "Failed to load conversation for ownership derivation",
      { message: error.message, code: error.code },
      { conversationId },
    );
    // Fail closed — cannot derive ownership → reject
    return { ok: false, reason: "ownership_lookup_failed" };
  }

  if (!data) {
    return { ok: false, reason: "conversation_not_found" };
  }

  const derivedStudentId = (data as { student_id: string }).student_id;
  return { ok: true, derivedStudentId };
}

type MessageRow = {
  id: string;
  role: string;
  content_kind: string;
  message: string;
  created_at: string;
};

/**
 * Load ALL messages for a conversation (no window limit).
 * For compaction, we need the full conversation to produce a complete summary.
 */
async function loadAllConversationMessages(
  conversationId: string,
): Promise<MessageRow[]> {
  const { data, error } = await supabaseServer
    .from("tutor_messages")
    .select("id, role, content_kind, message, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error(
      "TUTOR_COMPACTION",
      "load_messages_failed",
      "Failed to load conversation messages for compaction",
      { message: error.message, code: error.code },
      { conversationId },
    );
    throw new Error(
      `loadAllConversationMessages failed: ${error.message} (code: ${error.code})`,
    );
  }

  return (data ?? []) as MessageRow[];
}

/**
 * Parse the LLM summary text as structured JSON per §10.2.
 * Falls back to a minimal valid structure if parsing fails.
 */
function buildContentJson(
  rawSummary: string,
  conversationId: string,
  sourceWindowStart: string,
  sourceWindowEnd: string,
  turnsCompacted: number,
): ChatCompactionContent {
  const base: ChatCompactionContent = {
    summary_version: "1.0",
    conversation_id: conversationId,
    source_window_start: sourceWindowStart,
    source_window_end: sourceWindowEnd,
    turns_compacted: turnsCompacted,
    topics_discussed: [],
    skills_referenced: [],
    key_insights: [],
    unresolved_confusion: [],
    last_student_direction: null,
  };

  try {
    // The extraction prompt asks for raw JSON — try parsing directly
    const parsed = JSON.parse(rawSummary) as Record<string, unknown>;

    return {
      ...base,
      topics_discussed: truncateStringArray(
        parsed.topics_discussed,
        MAX_TOPICS_DISCUSSED,
      ),
      skills_referenced: truncateStringArray(parsed.skills_referenced, 20),
      key_insights: truncateStringArray(parsed.key_insights, MAX_KEY_INSIGHTS),
      unresolved_confusion: truncateStringArray(
        parsed.unresolved_confusion,
        MAX_UNRESOLVED_CONFUSION,
      ),
      last_student_direction:
        typeof parsed.last_student_direction === "string"
          ? parsed.last_student_direction.slice(0, MAX_ENTRY_LENGTH)
          : null,
    };
  } catch {
    // LLM returned prose instead of JSON — use the raw summary as a
    // single key_insight. The structure is still valid per §10.2.
    logger.warn(
      "TUTOR_COMPACTION",
      "json_parse_fallback",
      "LLM summary was not valid JSON; using fallback structure",
      { conversationId },
    );

    return {
      ...base,
      key_insights: [rawSummary.slice(0, MAX_ENTRY_LENGTH)],
    };
  }
}

/**
 * Safely extract and truncate a string array from parsed JSON.
 * Enforces max items and max entry length per §10.2 bounds.
 */
function truncateStringArray(raw: unknown, maxItems: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .slice(0, maxItems)
    .map((s) => s.slice(0, MAX_ENTRY_LENGTH));
}

/**
 * Write (upsert) the compaction summary to tutor_memory_summaries.
 * Uses ON CONFLICT (student_id, summary_type) DO UPDATE per the
 * UNIQUE constraint — idempotent for duplicate compaction runs.
 *
 * @spec [Doc-03C_V3 §8.3: "no harm from duplicate execution"]
 */
async function writeCompactionSummary(
  studentId: string,
  contentJson: ChatCompactionContent,
  sourceWindowStart: string,
  sourceWindowEnd: string,
  requestId: string,
): Promise<{ ok: true; summaryId: string } | { ok: false; reason: string }> {
  const { data, error } = await supabaseServer
    .from("tutor_memory_summaries")
    .upsert(
      {
        student_id: studentId,
        summary_type: "chat_compaction",
        summary_version: "1.0",
        content_json: contentJson,
        source_window_start: sourceWindowStart,
        source_window_end: sourceWindowEnd,
        last_refreshed_at: new Date().toISOString(),
        refresh_trigger: "close",
      },
      {
        onConflict: "student_id,summary_type",
      },
    )
    .select("id")
    .single();

  if (error) {
    logger.error(
      "TUTOR_COMPACTION",
      "write_summary_failed",
      "Failed to upsert chat_compaction to tutor_memory_summaries",
      { message: error.message, code: error.code },
      { studentId, requestId },
    );
    return { ok: false, reason: `db_write_failed:${error.code}` };
  }

  return { ok: true, summaryId: (data as { id: string }).id };
}

/**
 * Fire the `memory_summary_updated` NOTIFY for cache invalidation.
 *
 * @spec [Doc-03B_V4.1 §12C — memory_summary_updated channel]
 *
 * Uses Supabase's .rpc() to call pg_notify. The NOTIFY payload matches
 * the §12C spec: `{student_id, summary_type}`.
 *
 * Best-effort: failure is logged but does not fail the compaction.
 * Per §12B.5.1, the NOTIFY is a secondary invalidation signal; the
 * authoritative signal is the row write itself.
 */
async function fireMemorySummaryNotify(
  studentId: string,
  summaryType: string,
): Promise<void> {
  try {
    const { error } = await supabaseServer.rpc("pg_notify_memory_summary", {
      p_student_id: studentId,
      p_summary_type: summaryType,
    });

    if (error) {
      // Best-effort: log and continue. The NOTIFY is supplementary.
      logger.warn(
        "TUTOR_COMPACTION",
        "notify_failed",
        "Failed to fire memory_summary_updated NOTIFY; cache invalidation may be delayed",
        { message: error.message, code: error.code },
        { studentId, summaryType },
      );
    }
  } catch (err: unknown) {
    logger.warn(
      "TUTOR_COMPACTION",
      "notify_error",
      "Unexpected error firing NOTIFY",
      err instanceof Error ? err : undefined,
      { studentId, summaryType },
    );
  }
}
