/**
 * @spec [Doc-03A_V3.0 §7–§9, SCL-026 (learner observation)]
 * @implemented 2026-08-09
 *
 * plain English: Reads and manages tutor memory summaries from the
 * `tutor_memory_summaries` table and recent messages from `tutor_messages`.
 * Provides the data-access layer for the context pipeline's Layer 2
 * (memory retrieval) and the learner-observation accumulator (SCL-026).
 *
 * expected outcome: `getMemorySummaries(studentId)` returns validated
 * summaries matching the wire protocol schema; `accumulateObservation`
 * tallies learner style observations and derives preferred_explanation_style
 * when the threshold is met (observation_promotion_threshold, default 5).
 *
 * trade-offs / edge cases:
 *  - Fails closed on all DB errors (log + throw) — a missing memory summary
 *    must never silently degrade the tutor context.
 *  - accumulateObservation is INTERNAL ONLY — the observation tally and
 *    derived style live inside the teaching_profile's content_json and
 *    are never serialized to the client (anti-leak).
 *  - Style derivation requires single-leader plurality (one form strictly
 *    ahead) — ties leave preferred_explanation_style as null.
 *  - The teaching_profile content_json shape is validated by the DB trigger
 *    `validate_memory_summary_schema` (§10.5); this service reads and writes
 *    the `learning_style_signals` sub-object within it.
 */
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import type {
  ExplanationForm,
  MemoryStructuredFields,
} from "../../apps/workers/tutor-orchestrator/src/lib/_tutor-orchestrator-wire.generated";
import {
  memorySummarySchema,
  recentMessageSchema,
  explanationFormEnum,
  memoryStructuredFieldsSchema,
} from "../../apps/workers/tutor-orchestrator/src/lib/_tutor-orchestrator-wire.generated";
import { TutorConfig } from "./tutor-config";

// ── Internal types (never serialized to client) ─────────────────────

type MemorySummary = z.infer<typeof memorySummarySchema>;
type RecentMessage = z.infer<typeof recentMessageSchema>;

/**
 * Observation tally stored inside teaching_profile.content_json.learning_style_signals.
 * INTERNAL ONLY — never serialized to client.
 */
type StyleTally = {
  step_by_step: number;
  conceptual: number;
  example_driven: number;
  visual: number;
  total_observations: number;
};

// ── Observation input schema (enum-constrained per SCL-026) ─────────

const observationInputSchema = z.object({
  explanation_form: explanationFormEnum,
  confidence: z.enum(["low", "medium", "high"]),
});

type ObservationInput = z.infer<typeof observationInputSchema>;

// ── DB row schemas ──────────────────────────────────────────────────

const memorySummaryRowSchema = z.object({
  id: z.string().uuid(),
  student_id: z.string().uuid(),
  summary_type: z.enum([
    "teaching_profile",
    "chat_compaction",
    "recent_learning_pattern",
    "study_context",
  ]),
  summary_version: z.string(),
  content_json: z.object({}).passthrough(),
  source_window_start: z.string().nullable(),
  source_window_end: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const recentMessageRowSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["student", "tutor", "system"]),
  content_kind: z.enum([
    "message",
    "suggestion",
    "consent_prompt",
    "system_note",
  ]),
  message: z.string(),
  created_at: z.string(),
});

// ── Service ─────────────────────────────────────────────────────────

/**
 * @spec [Doc-03A_V3.0 §7–§9]
 * Fetches active memory summaries for a student from the
 * `tutor_memory_summaries` table. Returns an array matching the wire
 * protocol's `memorySummarySchema`.
 *
 * expected outcome: array of validated MemorySummary objects, one per
 * summary_type (teaching_profile, chat_compaction, recent_learning_pattern,
 * study_context). Absent summary types are omitted (not null-filled).
 *
 * trade-offs: the unique constraint (student_id, summary_type) guarantees
 * at most one row per type; the array is bounded to 4 elements.
 */
export async function getMemorySummaries(
  studentId: string,
): Promise<MemorySummary[]> {
  if (!studentId) {
    throw new Error("getMemorySummaries: studentId is required");
  }

  const { data, error } = await supabaseServer
    .from("tutor_memory_summaries")
    .select(
      "id, student_id, summary_type, summary_version, content_json, source_window_start, source_window_end, created_at, updated_at",
    )
    .eq("student_id", studentId);

  if (error) {
    logger.error(
      "TUTOR_MEMORY",
      "get_summaries_failed",
      "Failed to fetch tutor_memory_summaries; failing closed",
      { message: error.message, code: error.code },
      { studentId },
    );
    throw new Error(
      `getMemorySummaries failed: ${error.message} (code: ${error.code})`,
    );
  }

  if (!data) {
    return [];
  }

  const results: MemorySummary[] = [];

  for (const row of data) {
    const rowParsed = memorySummaryRowSchema.safeParse(row);
    if (!rowParsed.success) {
      logger.warn(
        "TUTOR_MEMORY",
        "row_parse_failed",
        "Memory summary row failed validation; skipping",
        { studentId, errors: rowParsed.error.flatten() },
      );
      continue;
    }

    const wireSummary: MemorySummary = {
      summary_type: rowParsed.data.summary_type,
      summary_version: rowParsed.data.summary_version,
      content_json: rowParsed.data.content_json,
      source_window_start: rowParsed.data.source_window_start,
      source_window_end: rowParsed.data.source_window_end,
    };

    const wireValidation = memorySummarySchema.safeParse(wireSummary);
    if (!wireValidation.success) {
      logger.warn(
        "TUTOR_MEMORY",
        "wire_validation_failed",
        "Memory summary failed wire schema validation; skipping",
        { studentId, summaryType: rowParsed.data.summary_type },
      );
      continue;
    }

    results.push(wireValidation.data);
  }

  return results;
}

/**
 * @spec [Doc-03A_V3.0 §7.3, §10.3]
 * Derives `MemoryStructuredFields` from the teaching_profile memory summary.
 * Reads the teaching_profile for the student and extracts the structured
 * fields (last_struggled_skill, last_mastered_skill, preferred_explanation_style,
 * style_confidence) from its content_json.
 *
 * expected outcome: a MemoryStructuredFields object matching the wire protocol
 * schema. Returns all-null fields if no teaching_profile exists.
 *
 * trade-offs: reads a single row (unique constraint on student_id + summary_type).
 * The content_json shape is enforced by the DB trigger; this function extracts
 * the wire-relevant subset.
 */
export async function getStructuredFields(
  studentId: string,
): Promise<MemoryStructuredFields> {
  if (!studentId) {
    throw new Error("getStructuredFields: studentId is required");
  }

  const nullFields: MemoryStructuredFields = {
    last_struggled_skill: null,
    last_mastered_skill: null,
    preferred_explanation_style: null,
    style_confidence: null,
  };

  const { data, error } = await supabaseServer
    .from("tutor_memory_summaries")
    .select("content_json")
    .eq("student_id", studentId)
    .eq("summary_type", "teaching_profile")
    .maybeSingle();

  if (error) {
    logger.error(
      "TUTOR_MEMORY",
      "get_structured_fields_failed",
      "Failed to fetch teaching_profile; failing closed",
      { message: error.message, code: error.code },
      { studentId },
    );
    throw new Error(
      `getStructuredFields failed: ${error.message} (code: ${error.code})`,
    );
  }

  if (!data || !data.content_json) {
    return nullFields;
  }

  const content = data.content_json as Record<string, unknown>;

  const candidate: MemoryStructuredFields = {
    last_struggled_skill:
      (content.last_struggled_skill as MemoryStructuredFields["last_struggled_skill"]) ??
      null,
    last_mastered_skill:
      (content.last_mastered_skill as MemoryStructuredFields["last_mastered_skill"]) ??
      null,
    preferred_explanation_style: extractPreferredStyle(content),
    style_confidence: extractStyleConfidence(content),
  };

  const validation = memoryStructuredFieldsSchema.safeParse(candidate);
  if (!validation.success) {
    logger.warn(
      "TUTOR_MEMORY",
      "structured_fields_validation_failed",
      "Derived structured fields failed wire validation; returning nulls",
      { studentId, errors: validation.error.flatten() },
    );
    return nullFields;
  }

  return validation.data;
}

/**
 * @spec [Doc-03A_V3.0 §7.3, SCL-026]
 * Accumulates a learner observation into the teaching_profile summary.
 * Reads the current teaching_profile, updates the style tally in
 * `learning_style_signals`, and derives `preferred_explanation_style`
 * when total observations >= observation_promotion_threshold (config,
 * default 5) and a single-leader plurality exists.
 *
 * INTERNAL ONLY — the tally and derived style live inside content_json
 * and are never serialized to the client.
 *
 * expected outcome: teaching_profile.content_json.learning_style_signals
 * is updated with the new observation count and, if threshold met,
 * the preferred style is set.
 *
 * trade-offs:
 *  - Observation is enum-constrained (step_by_step, conceptual, example_driven, visual).
 *  - Confidence weighting is not applied (V1: all observations equal).
 *  - Race condition: concurrent observations could read-then-write the same
 *    tally. Acceptable at V1 launch volume; production hardening should use
 *    a serializable transaction or atomic SQL increment.
 *  - If no teaching_profile row exists, the observation is logged and dropped
 *    (the row is created by the memory writer, not by the observation path).
 */
export async function accumulateObservation(
  studentId: string,
  observation: ObservationInput,
): Promise<void> {
  if (!studentId) {
    throw new Error("accumulateObservation: studentId is required");
  }

  const parsed = observationInputSchema.safeParse(observation);
  if (!parsed.success) {
    logger.warn(
      "TUTOR_MEMORY",
      "observation_invalid",
      "Learner observation failed validation; dropping",
      { studentId, errors: parsed.error.flatten() },
    );
    throw new Error(
      `accumulateObservation: invalid observation — ${parsed.error.message}`,
    );
  }

  const { explanation_form } = parsed.data;

  // Read current teaching_profile
  const { data: existing, error: readError } = await supabaseServer
    .from("tutor_memory_summaries")
    .select("id, content_json")
    .eq("student_id", studentId)
    .eq("summary_type", "teaching_profile")
    .maybeSingle();

  if (readError) {
    logger.error(
      "TUTOR_MEMORY",
      "observation_read_failed",
      "Failed to read teaching_profile for observation accumulation; failing closed",
      { message: readError.message, code: readError.code },
      { studentId },
    );
    throw new Error(
      `accumulateObservation read failed: ${readError.message} (code: ${readError.code})`,
    );
  }

  if (!existing) {
    logger.info(
      "TUTOR_MEMORY",
      "observation_no_profile",
      "No teaching_profile exists for student; dropping observation",
      { studentId },
    );
    return;
  }

  const content = (existing.content_json ?? {}) as Record<string, unknown>;
  const signals = (content.learning_style_signals ?? {}) as Record<
    string,
    unknown
  >;
  const currentTally: StyleTally = {
    step_by_step:
      typeof signals.step_by_step === "number" ? signals.step_by_step : 0,
    conceptual: typeof signals.conceptual === "number" ? signals.conceptual : 0,
    example_driven:
      typeof signals.example_driven === "number" ? signals.example_driven : 0,
    visual: typeof signals.visual === "number" ? signals.visual : 0,
    total_observations:
      typeof signals.total_observations === "number"
        ? signals.total_observations
        : 0,
  };

  // Increment the observed form
  currentTally[explanation_form] += 1;
  currentTally.total_observations += 1;

  // Derive preferred style if threshold met
  const threshold = TutorConfig.get("observation_promotion_threshold");
  let preferredStyle: ExplanationForm | null = null;
  let styleConfidence: "low" | "medium" | "high" | null = null;

  if (currentTally.total_observations >= threshold) {
    const derived = derivePreferredStyle(currentTally);
    preferredStyle = derived.style;
    styleConfidence = derived.confidence;
  }

  // Build updated content_json
  const updatedContent = {
    ...content,
    learning_style_signals: {
      ...signals,
      ...currentTally,
      preferred_explanation_style: preferredStyle,
      style_confidence: styleConfidence,
    },
  };

  const { error: writeError } = await supabaseServer
    .from("tutor_memory_summaries")
    .update({ content_json: updatedContent })
    .eq("id", existing.id);

  if (writeError) {
    logger.error(
      "TUTOR_MEMORY",
      "observation_write_failed",
      "Failed to write observation to teaching_profile; failing closed",
      { message: writeError.message, code: writeError.code },
      { studentId },
    );
    throw new Error(
      `accumulateObservation write failed: ${writeError.message} (code: ${writeError.code})`,
    );
  }

  logger.info(
    "TUTOR_MEMORY",
    "observation_accumulated",
    `Observation accumulated: ${explanation_form} (total: ${currentTally.total_observations})`,
    {
      studentId,
      form: explanation_form,
      total: currentTally.total_observations,
      preferredStyle,
    },
  );
}

/**
 * @spec [Doc-03A_V3.0 §7, §9]
 * Fetches the last N messages from the `tutor_messages` table for a
 * given conversation. Returns an array matching the wire protocol's
 * `recentMessageSchema`.
 *
 * expected outcome: up to `window` most recent messages, ordered by
 * created_at ascending (oldest first, matching conversation flow).
 *
 * trade-offs: uses the `recent_message_window` config default if
 * `window` is not provided. Bounded by the config value to prevent
 * unbounded reads.
 */
export async function getRecentMessages(
  conversationId: string,
  window?: number,
): Promise<RecentMessage[]> {
  if (!conversationId) {
    throw new Error("getRecentMessages: conversationId is required");
  }

  const messageWindow = window ?? TutorConfig.get("recent_message_window");

  const { data, error } = await supabaseServer
    .from("tutor_messages")
    .select("id, role, content_kind, message, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(messageWindow);

  if (error) {
    logger.error(
      "TUTOR_MEMORY",
      "get_recent_messages_failed",
      "Failed to fetch recent tutor messages; failing closed",
      { message: error.message, code: error.code },
      { conversationId },
    );
    throw new Error(
      `getRecentMessages failed: ${error.message} (code: ${error.code})`,
    );
  }

  if (!data) {
    return [];
  }

  // Reverse to ascending order (oldest first) for conversation flow
  const ordered = data.reverse();

  const results: RecentMessage[] = [];

  for (const row of ordered) {
    const validation = recentMessageRowSchema.safeParse(row);
    if (!validation.success) {
      logger.warn(
        "TUTOR_MEMORY",
        "message_row_parse_failed",
        "Message row failed validation; skipping",
        { conversationId, errors: validation.error.flatten() },
      );
      continue;
    }

    const wireMessage: RecentMessage = {
      id: validation.data.id,
      role: validation.data.role,
      content_kind: validation.data.content_kind,
      message: validation.data.message,
      created_at: validation.data.created_at,
    };

    const wireValidation = recentMessageSchema.safeParse(wireMessage);
    if (!wireValidation.success) {
      logger.warn(
        "TUTOR_MEMORY",
        "message_wire_validation_failed",
        "Message failed wire schema validation; skipping",
        { conversationId },
      );
      continue;
    }

    results.push(wireValidation.data);
  }

  return results;
}

// ── Internal helpers ────────────────────────────────────────────────

/**
 * Extracts preferred_explanation_style from teaching_profile content_json.
 * Looks in learning_style_signals.preferred_explanation_style.
 */
function extractPreferredStyle(
  content: Record<string, unknown>,
): ExplanationForm | null {
  const signals = content.learning_style_signals as
    | Record<string, unknown>
    | undefined;
  if (!signals) return null;

  const raw = signals.preferred_explanation_style;
  if (!raw) return null;

  const parsed = explanationFormEnum.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Extracts style_confidence from teaching_profile content_json.
 * Looks in learning_style_signals.style_confidence.
 */
function extractStyleConfidence(
  content: Record<string, unknown>,
): "low" | "medium" | "high" | null {
  const signals = content.learning_style_signals as
    | Record<string, unknown>
    | undefined;
  if (!signals) return null;

  const raw = signals.style_confidence;
  if (!raw) return null;

  const confidenceSchema = z.enum(["low", "medium", "high"]);
  const parsed = confidenceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * @spec [SCL-026]
 * Derives the preferred explanation style from accumulated observation tallies.
 * Requires single-leader plurality — one form must be strictly ahead of all others.
 * Ties leave the style as null.
 *
 * Confidence is derived from the leader's share of total observations:
 *  - >= 60%: high
 *  - >= 40%: medium
 *  - < 40%: low
 */
function derivePreferredStyle(tally: StyleTally): {
  style: ExplanationForm | null;
  confidence: "low" | "medium" | "high" | null;
} {
  const forms: ExplanationForm[] = [
    "step_by_step",
    "conceptual",
    "example_driven",
    "visual",
  ];

  let maxCount = 0;
  let leader: ExplanationForm | null = null;
  let tied = false;

  for (const form of forms) {
    const count = tally[form];
    if (count > maxCount) {
      maxCount = count;
      leader = form;
      tied = false;
    } else if (count === maxCount && count > 0) {
      tied = true;
    }
  }

  // Single-leader plurality required — ties leave style null
  if (tied || leader === null || maxCount === 0) {
    return { style: null, confidence: null };
  }

  const share = maxCount / tally.total_observations;
  let confidence: "low" | "medium" | "high";
  if (share >= 0.6) {
    confidence = "high";
  } else if (share >= 0.4) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return { style: leader, confidence };
}
