/**
 * @spec [Doc-03B_V2 §4.1] | @implemented 2026-08-05
 * plain English: Single-source-of-truth Zod schemas for the tutor-orchestrator
 * wire protocol (request + response). Both the BFF server and the orchestrator
 * worker import from here — no inline duplicates.
 *
 * expected outcome: one canonical schema set, consumed by server/lib/tutor-orchestrator-client.ts
 * and apps/workers/tutor-orchestrator/src/lib/schema.ts.
 * trade-offs: worker tsconfig broadened to allow imports from shared/.
 *
 * @updated 2026-08-07 — replaced untyped z.record(z.string(), z.unknown()) fields
 * with fully typed schemas per Karl's standing rule. student_context split into
 * student_learning_context + memory_structured_fields. All z.record uses removed.
 */

import { z } from "zod";
import { CANONICAL_ID_PATTERN } from "./canonical-id.js";

// ── Request sub-schemas ──────────────────────────────────────────────

export const resolvedScopeSchema = z.object({
  source_session_id: z.string().uuid().nullable(),
  source_session_item_id: z.string().uuid().nullable(),
  source_question_row_id: z.string().regex(CANONICAL_ID_PATTERN).nullable(),
  source_question_canonical_id: z.string().nullable(),
});

export const recentMessageSchema = z.object({
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

export const memorySummarySchema = z.object({
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
});

export const policyAssignmentSchema = z.object({
  policy_family: z.string(),
  policy_variant: z.string(),
  policy_version: z.string(),
  prompt_version: z.string().nullable(),
  assignment_mode: z.enum(["deterministic", "explore", "manual_override"]),
  assignment_key: z.string(),
  reason_snapshot: z.object({}).passthrough(),
});

// ── Student learning context (Doc 03A §5.4, §8.3) ─────────────────────

export const masterySnapshotSchema = z.object({
  scope: z.enum(["skill", "domain", "section", "all"]),
  current_skill: z
    .object({
      skill: z.string(),
      domain: z.string(),
      section: z.enum(["M", "RW"]),
      mastery_score: z.number().nullable(),
      mastery_level: z.number().int().min(0).max(4).nullable(),
      attempts_14d: z.number().int().nonnegative(),
      pass_rate_14d: z.number().nullable(),
      last_event_at: z.string().nullable(),
    })
    .nullable(),
  current_domain: z
    .object({
      domain: z.string(),
      section: z.enum(["M", "RW"]),
      mastery_score: z.number().nullable(),
      mastery_level: z.number().int().min(0).max(4).nullable(),
    })
    .nullable(),
  section_projection: z
    .object({
      section: z.enum(["M", "RW"]),
      projected_score_low: z.number().int().nullable(),
      projected_score_mid: z.number().int().nullable(),
      projected_score_high: z.number().int().nullable(),
      range_width: z.number().int().nullable(),
    })
    .nullable(),
  section_projection_trend: z
    .array(
      z.object({
        section: z.enum(["M", "RW"]),
        projected_score_mid: z.number().int().nullable(),
        range_width: z.number().int().nullable(),
        snapshot_at: z.string(),
      }),
    )
    .nullable(),
  recent_activity_summary: z
    .object({
      skills_practiced_7d: z.array(z.string()),
      skills_with_fails_7d: z.array(z.string()),
      skills_newly_mastered_30d: z.array(z.string()).nullable(),
    })
    .nullable(),
  // ── Student-wide domain bands (closure plan W3-4b, 2026-09-25) ───────
  // Every domain the student has an observed mastery level for, from
  // student_domain_mastery — present in general mode too, where there is no
  // "current" skill or domain. OPTIONAL so either side can deploy first: an
  // older worker strips the unknown key; a newer worker tolerates its absence.
  // @spec [Doc-03A_V3.0 §5.4 mastery_snapshot; closure plan W3-4b]
  domain_mastery: z
    .array(
      z.object({
        domain: z.string(),
        section: z.enum(["M", "RW"]),
        mastery_level: z.number().int().min(0).max(4),
      }),
    )
    .optional(),
});

export const recentFrictionSchema = z.object({
  consecutive_fails_this_session: z.number().int().nonnegative(),
  consecutive_fails_this_skill_7d: z.number().int().nonnegative(),
  self_deprecating_language_detected: z.boolean(),
  long_pause_detected: z.boolean(),
  mastery_regression_14d: z.boolean().nullable(),
});

export const kpiStateSchema = z.object({
  skill_kpi: z
    .object({
      events_total: z.number().int().nonnegative(),
      events_last_7d: z.number().int().nonnegative(),
      events_last_30d: z.number().int().nonnegative(),
      accuracy_overall: z.number().nullable(),
      accuracy_last_7d: z.number().nullable(),
      accuracy_last_30d: z.number().nullable(),
    })
    .nullable(),
  domain_kpi: z
    .object({
      events_total: z.number().int().nonnegative(),
      events_last_7d: z.number().int().nonnegative(),
      events_last_30d: z.number().int().nonnegative(),
      accuracy_overall: z.number().nullable(),
      accuracy_last_7d: z.number().nullable(),
      accuracy_last_30d: z.number().nullable(),
    })
    .nullable(),
  section_kpi: z
    .object({
      events_total: z.number().int().nonnegative(),
      events_last_7d: z.number().int().nonnegative(),
      events_last_30d: z.number().int().nonnegative(),
      accuracy_overall: z.number().nullable(),
      accuracy_last_7d: z.number().nullable(),
      accuracy_last_30d: z.number().nullable(),
      current_streak_days: z.number().int().nonnegative(),
    })
    .nullable(),
});

export const studentLearningContextSchema = z.object({
  mastery_snapshot: masterySnapshotSchema.nullable(),
  recent_friction: recentFrictionSchema,
  kpi_state: kpiStateSchema.nullable(),
});

// ── Memory structured fields (Doc 03A §7.3, §10.3) ────────────────────

export const explanationFormEnum = z.enum([
  "step_by_step",
  "conceptual",
  "example_driven",
  "visual",
]);

export const memoryStructuredFieldsSchema = z.object({
  last_struggled_skill: z
    .object({
      skill: z.string(),
      domain: z.string(),
      section: z.enum(["M", "RW"]),
      last_fail_at: z.string().nullable(),
      fail_count_7d: z.number().int().nonnegative(),
      mastery_at_time_of_fail: z.number().nullable(),
    })
    .nullable(),
  last_mastered_skill: z
    .object({
      skill: z.string(),
      domain: z.string(),
      section: z.enum(["M", "RW"]),
      crossed_to_strong_at: z.string().nullable(),
      prior_mastery: z.number().nullable(),
      current_mastery: z.number().nullable(),
    })
    .nullable(),
  preferred_explanation_style: explanationFormEnum.nullable(),
  style_confidence: z.enum(["low", "medium", "high"]).nullable(),
});

// ── Question content (Doc 03A §5.4, Doc 03C §4.4, SCL-144) ─────────
// @spec [Doc-03A_V3 §5.4, Doc-03C_V3 §4.4, SCL-144]: pass question
// CONTENT to the worker, never canonical ID. `explanation` is null
// pre-submit (SCL-144 PROPOSED, reversing SCL-060: possession is the
// control, not a prompt instruction). student_answer is null if no
// submission yet.

export const questionOptionSchema = z.object({
  key: z.string(),
  text: z.string(),
});

export const questionContentSchema = z.object({
  stem: z.string(),
  passage: z.string().nullable(),
  options: z.array(questionOptionSchema),
  item_type: z.enum(["mcq", "grid_in"]),
  explanation: z.string().nullable(),
  student_answer: z.string().nullable(),
  attempt_number: z.number().int().nonnegative(),
});

// ── Offered videos (video library, CC brief 2026-10-15 §6/§7) ─────────
// @spec [CC Brief "Video Library (ships now)" §7]: the model never emits a video
// identifier. The BFF retrieves up to three approved videos for the item's skills at
// Step 13d, keeps their ids BFF-local, and sends the worker only a 1-based index and the
// facts LISA may say aloud. The model offers one by index; the BFF attaches the id.
// Strict: an offered video carries no identifier, and a request that tries to send one (a
// video_id, a URL) is refused at the worker's parse rather than stripped silently (CC Brief
// "Video Library" §7: the model never sees a video identifier).
//
// @spec [Doc-03D_V1.2 §6.8 as amended by the video retrieval-contract SCL; owner brief "Video
// retrieval: method tags", Karl 2026-10-27 (Step 0 ruling: tell the worker each video's methods
// and format)] | @implemented [2026-10-27]: `methods` (how the video solves) and `format` (its
// shape) so LISA can tell which offered video is the Desmos one without relying on a title.
// Optional, so the worker is deployed FIRST (it accepts both with or without them) and the BFF
// second; the object stays strict, so an older worker would refuse them — never deploy the BFF
// first. The value lists are THE vocabulary (packages/shared/src/video-methods.ts), inlined
// because the worker builds from this file alone; a contract test keeps them equal.
export const OFFERED_VIDEO_METHODS = [
  "desmos",
  "algebraic",
  "backsolve",
] as const;
export const OFFERED_VIDEO_FORMATS = [
  "worked_example",
  "formula",
  "lesson",
  "strategy",
] as const;
export const offeredVideoSchema = z
  .object({
    index: z.number().int().min(1).max(3),
    title: z.string(),
    channel_name: z.string(),
    duration_seconds: z.number().int().positive(),
    methods: z.array(z.enum(OFFERED_VIDEO_METHODS)).max(3).optional(),
    format: z.enum(OFFERED_VIDEO_FORMATS).nullable().optional(),
  })
  .strict();
export type OfferedVideo = z.infer<typeof offeredVideoSchema>;

// ── Request schema ───────────────────────────────────────────────────

export const orchestrateRequestSchema = z.object({
  conversation_id: z.string().uuid(),
  student_id: z.string().uuid(),
  entry_mode: z.enum(["scoped_question", "scoped_session", "general"]),
  source_surface: z.enum(["practice", "review", "test_review", "dashboard"]),
  resolved_scope: resolvedScopeSchema,
  recent_messages: z.array(recentMessageSchema),
  memory_summaries: z.array(memorySummarySchema),
  student_learning_context: studentLearningContextSchema,
  memory_structured_fields: memoryStructuredFieldsSchema,
  policy_assignment: policyAssignmentSchema,
  runtime_limits: z.object({
    max_output_tokens: z.number().int().positive(),
    timeout_ms: z.number().int().positive(),
  }),
  // ── Question content (Doc 03A §5.4, Doc 03C §4.4, SCL-144) ─────────
  // @spec [Doc-03A_V3 §5.4, Doc-03C_V3 §4.4, SCL-144]: question CONTENT,
  // never canonical ID. `explanation` is null pre-submit (SCL-144 PROPOSED,
  // reversing SCL-060).
  question_content: questionContentSchema.nullable(),
  // ── Server-derived post-submit flag (Doc 03D §6.3) ─────────────────
  // @spec [Doc-03D_V1.2 §6.3, INV-03-04]: "Pre-submit gating is derived
  // server-side from the item's submission state. It is never supplied by
  // the caller." The BFF resolves this from practice_session_items.status;
  // the worker reads it as-is. correct_answer is null pre-submit.
  is_post_submit: z.boolean(),
  // ── Anti-leak field (LISA-FULL-001): null pre-submit, real value post-submit ──
  // @spec [INV-03-04, Doc-03B_V4.1 §6.5 step 15, Doc-03D_V1.2 §6.3]
  // Pre-submit: always null on the wire. The BFF keeps the real value
  // BFF-local for the output scan (step 15) but never forwards it to the
  // worker. Post-submit: the real correct_answer for model explanation.
  correct_answer: z.string().nullable(),
  // ── Model Armor template IDs (Karl ruling: BFF passes, worker stays stateless) ──
  // @spec [Doc-03B_V4.1 §12B.8, ADR-001]
  // Unused by the worker since W3-1 (2026-09-24): Model Armor runs in the BFF
  // (server/services/tutor-model-armor.ts). Still required here because the
  // deployed worker's copy of this schema requires them; removing them is a
  // two-step change (worker schema first, then the BFF) — closure plan W3-4.
  model_armor_input_template_id: z.string().nullable(),
  model_armor_output_template_id: z.string().nullable(),
  // ── Video library (CC brief 2026-10-15) ────────────────────────────
  // Optional so either side can deploy first: an older worker ignores it, and an
  // older BFF never sends it.
  offered_videos: z.array(offeredVideoSchema).max(3).optional(),
});

// ── Response sub-schemas ─────────────────────────────────────────────

export const questionLinkSchema = z.object({
  source_question_row_id: z.string().regex(CANONICAL_ID_PATTERN).nullable(),
  source_question_canonical_id: z.string(),
  related_question_row_id: z.string().regex(CANONICAL_ID_PATTERN).nullable(),
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
  link_snapshot: z.object({}).passthrough(),
});

export const instructionExposureSchema = z.object({
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

// ── Learner observation (Doc 03A §7.3, SCL-026) ───────────────────────

export const learnerObservationSchema = z.object({
  explanation_form: explanationFormEnum.nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});

// ── Response schema ──────────────────────────────────────────────────

/**
 * @spec [owner brief "P2 Revised: Cut the Wait Without Streaming" (Karl, 2026-10-23) §2 H1
 *        ("every model call ... No message content in logs")] | @implemented [2026-10-23]
 *
 * plain English: the worker's own timings for one turn, so the BFF's single `route_timing` line
 * can show where the model hop's time went: `worker_ms` is the worker handler from parse to reply,
 * and each Vertex attempt (retries and the pro→flash fallback included) carries its start offset
 * within the worker and its duration. Numbers only, by construction (`.strict()`), so no prompt,
 * reply or identifier can travel in it. Optional so the BFF and the worker can deploy in either
 * order.
 */
export const orchestrationTimingSchema = z
  .object({
    worker_ms: z.number().nonnegative(),
    vertex_attempts: z
      .array(
        z
          .object({
            at_ms: z.number().nonnegative(),
            ms: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
export type OrchestrationTiming = z.infer<typeof orchestrationTimingSchema>;

/**
 * @spec [owner brief "Per-turn attribution: tokens, thinking, cache and prompt version" (Karl,
 *        2026-10-27) and rulings; Doc 03C V3 `orchestration_meta` (`input_tokens`,
 *        `output_tokens`); SCL-246 (`thinking_tokens`, `cached_tokens`, `thinking_budget`, which no
 *        spec names); Doc 03 §24 (per-student cost); Doc 03D §8.1 (prompt_version)]
 *        | @implemented [2026-10-27]
 *
 * plain English: what one tutor turn cost and which configuration produced it. Token counts are
 * the SUM over every billed Vertex attempt in the turn (owner ruling 2026-10-27, reversing
 * "reply attempt only"): the reply, retries, the pro→flash fallback, and responses rejected as
 * safety-blocked or truncated, which are billed too. An attempt that returned no usage (a 429, a
 * 5xx, a timeout) adds nothing. A count is `null` when no attempt reported it: unknown, never 0.
 * `thinking_budget` is the budget the call was made with (the hard-coded value; recorded, not
 * configured). Numbers only, by construction.
 *
 * trade-offs: every field is optional on the wire so the BFF can deploy before the worker; a
 * turn answered by an older worker records null counts.
 */
const tokenCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(10_000_000)
  .nullable();

export const turnUsageSchema = z
  .object({
    input_tokens: tokenCountSchema,
    output_tokens: tokenCountSchema,
    thinking_tokens: tokenCountSchema,
    cached_tokens: tokenCountSchema,
    thinking_budget: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();
export type TurnUsage = z.infer<typeof turnUsageSchema>;

/** The BFF's view of one turn's attribution: usage summed over its worker calls, and the
 * prompt version the worker resolved (null when no worker answered with one). The budget is
 * nullable here because a worker deployed before SCL-246 reports a prompt version but no budget. */
export const turnAttributionSchema = turnUsageSchema
  .extend({
    thinking_budget: turnUsageSchema.shape.thinking_budget.nullable(),
    prompt_version: z.string().max(200).nullable(),
  })
  .strict();
export type TurnAttribution = z.infer<typeof turnAttributionSchema>;

/**
 * A worker error response (non-2xx). A safety block or a truncation is billed, so its body
 * carries the turn's usage and prompt version; other errors may carry neither.
 */
export const orchestrateErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
  }),
  prompt_version: z.string().max(200).optional(),
  ...turnUsageSchema.partial().shape,
});
export type OrchestrateErrorResponse = z.infer<
  typeof orchestrateErrorResponseSchema
>;

/** Sum of two token counts where null means "not reported": null only if both are null. */
export function addTokenCounts(
  a: number | null,
  b: number | null,
): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

export const orchestrateResponseSchema = z.object({
  response: z.object({
    content: z.string(),
    content_kind: z.literal("message"),
    suggested_action: z.object({
      // start_practice (closure plan W3-2, 2026-09-25): LISA's handoff to
      // practice in general mode — it offers a question that counts instead of
      // inventing one. DEPLOY ORDER: the BFF parses worker responses with this
      // schema, so the BFF (Vercel) must carry this value before the worker
      // (Cloud Build) can emit it.
      type: z.enum([
        "none",
        "offer_similar_question",
        "offer_broader_coaching",
        "offer_stay_focused",
        "start_practice",
        // recommend_video (video library, CC brief 2026-10-15 §7): LISA offers one of
        // the turn's offered_videos by index. Same DEPLOY ORDER as start_practice: the
        // BFF must carry this value before the worker emits it.
        "recommend_video",
      ]),
      label: z.string().nullable(),
      // 1-based index into the request's offered_videos; present only with
      // recommend_video. Never a video identifier.
      video_index: z.number().int().min(1).max(3).optional(),
    }),
    ui_hints: z.object({
      show_accept_decline: z.boolean(),
      allow_freeform_reply: z.boolean(),
      suggested_chip: z.string().nullable(),
    }),
  }),
  question_links: z.array(questionLinkSchema),
  instruction_exposures: z.array(instructionExposureSchema),
  orchestration_meta: z.object({
    model_name: z.string(),
    prompt_version: z.string(),
    cache_used: z.boolean(),
    compaction_recommended: z.boolean(),
    timing: orchestrationTimingSchema.optional(),
    // Per-turn attribution (SCL-246): optional so either side can deploy first.
    ...turnUsageSchema.partial().shape,
  }),
  learner_observation: learnerObservationSchema.nullable(),
});

// ── Compact schemas ──────────────────────────────────────────────────

/**
 * @updated 2026-08-09 — additive fields for worker-side conversation
 * compaction (Doc 03C V3 §8.3 step 1-2: load conversation content, invoke
 * Vertex flash_class to summarize). `recent_messages` reuses the canonical
 * `recentMessageSchema` already defined above for orchestrateRequestSchema —
 * no duplicate shape. Both new fields are optional/nullable so the existing
 * caller (server/lib/tutor-orchestrator-client.ts, which posts only
 * {conversation_id, student_id} and reads only `.ok`) keeps working
 * unchanged; this is purely additive, non-breaking. Persisting the returned
 * `summary` to `tutor_memory_summaries` (Doc 03A V3 §7, chat_compaction type)
 * and the invalidate-then-delete cache NOTIFY (Doc 03B V4.1 §12B.5.1) are
 * NOT implemented by this schema change — see apps/workers/tutor-orchestrator/
 * src/routes/compact.ts header for the exact scope boundary.
 */
export const compactRequestSchema = z.object({
  conversation_id: z.string().uuid(),
  student_id: z.string().uuid(),
  recent_messages: z.array(recentMessageSchema).optional(),
});

export const compactResponseSchema = z.object({
  ok: z.boolean(),
  summary: z.string().nullable().optional(),
});

// ── Inferred types ───────────────────────────────────────────────────

export type OrchestrateRequest = z.infer<typeof orchestrateRequestSchema>;
export type OrchestrateResponse = z.infer<typeof orchestrateResponseSchema>;
export type CompactRequest = z.infer<typeof compactRequestSchema>;
export type CompactResponse = z.infer<typeof compactResponseSchema>;
export type StudentLearningContext = z.infer<
  typeof studentLearningContextSchema
>;
export type MemoryStructuredFields = z.infer<
  typeof memoryStructuredFieldsSchema
>;
export type LearnerObservation = z.infer<typeof learnerObservationSchema>;
export type RecentFriction = z.infer<typeof recentFrictionSchema>;
export type MasterySnapshot = z.infer<typeof masterySnapshotSchema>;
export type KpiState = z.infer<typeof kpiStateSchema>;
export type ExplanationForm = z.infer<typeof explanationFormEnum>;
export type QuestionContent = z.infer<typeof questionContentSchema>;
