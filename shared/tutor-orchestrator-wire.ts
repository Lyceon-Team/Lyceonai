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

// ── Question content (Doc 03A §5.4, Doc 03C §4.4) ───────────────────
// @spec [Doc-03A_V3 §5.4, Doc-03C_V3 §4.4]: pass question CONTENT to
// the worker, never canonical ID. Anti-leak: explanation is null
// pre-submit (gated by is_post_submit, Doc 03D §6.3). student_answer is
// null if no submission yet.

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

// ── Retrieved curriculum item (Doc 03D §6.8) ────────────────────────
// Mirrors packages/shared/tutor-rag-types.ts — kept in sync manually
// because the worker tsconfig only includes src/.

export const retrievedCurriculumItemSchema = z.object({
  /** The retrieved content text (explanation, textbook excerpt, etc.) */
  content: z.string(),
  /** Skill codes this content is associated with */
  skill_codes: z.array(z.string()),
  /** Provenance tag — never echoed to student (§6.5, SCL-030) */
  provenance: z.string(),
  /** Surface gating classification per §6.3 */
  surface_gate: z.enum(["pre_and_post", "post_only", "review_only"]),
  /** Content type classification */
  content_type: z.enum([
    "explanation",
    "textbook",
    "video_transcript",
    "strategy",
    "worked_example",
  ]),
});

export type RetrievedCurriculumItem = z.infer<
  typeof retrievedCurriculumItemSchema
>;

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
  // ── Question content (Doc 03A §5.4, Doc 03C §4.4) ──────────────────
  // @spec [Doc-03A_V3 §5.4, Doc-03C_V3 §4.4]: question CONTENT, never
  // canonical ID. Anti-leak: explanation null pre-submit.
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
  // ── Retrieved curriculum items (Doc 03D §6.6, §6.8) ──────────────────
  // @spec [Doc-03D_V1.2 §6.6, §6.8, SCL-043]
  // Explanations and curriculum content retrieved by tutor-retrieval.ts.
  // Travels on a SEPARATE field from question_content — the anti-leak null
  // gate on question_content.explanation (INV-03-04) is preserved. The
  // retrieval path applies its own scope filter (SCL-043: active question's
  // explanation INCLUDED pre-submit, unseen same-skill EXCLUDED).
  // INV-03-04 (output serializer) is sole defense against model echo.
  retrieved_curriculum: z.array(retrievedCurriculumItemSchema).default([]),
  // ── Model Armor template IDs (Karl ruling: BFF passes, worker stays stateless) ──
  // @spec [Doc-03B_V4.1 §12B.8, ADR-001]
  model_armor_input_template_id: z.string().nullable(),
  model_armor_output_template_id: z.string().nullable(),
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

export const orchestrateResponseSchema = z.object({
  response: z.object({
    content: z.string(),
    content_kind: z.literal("message"),
    suggested_action: z.object({
      type: z.enum([
        "none",
        "offer_similar_question",
        "offer_broader_coaching",
        "offer_stay_focused",
      ]),
      label: z.string().nullable(),
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
