/**
 * Full-length exam runtime API — request and response contracts.
 *
 * @spec [Doc-04A_V2.2, §7.3 (create), §10.2 (pre-completion payload), §11.2
 *        (answer), §12 (module submit), §15.1 (state), §16 (surface), §16.2
 *        (error codes); Coding Standards §5.2 (pre-submit correct_answer /
 *        explanation are null), §7.2 (Zod first, types inferred)]
 *       [E6 rulings: Module 2 is addressed as '2' (SCL-132); options are practice's
 *        opaque tokens (SCL-133)]
 *       [E7a: item workspace (SCL-145), heartbeat resume position (SCL-146), forms
 *        list (SCL-147)]
 * @implemented [2026-09-24] | @updated [2026-09-25]
 *
 * plain English: the single definition of every exam request body, path parameter
 * and response the server returns. The question payload schema is `.strict()` and
 * pins correct_answer / explanation to null, so the serializer's output is parsed
 * against it before it leaves the server: an extra key (domain, difficulty,
 * skill_code, correct_variants, ...) fails the parse instead of reaching a student.
 *
 * trade-offs: 04A §10.2 lists `options: [{label, text}]`; the exam serves practice's
 * `[{id, text}]` tokens instead (SCL-133) and adds `passage` (the bank stores the
 * passage as text, 04A models it as an asset URL). Both recorded in the PR log.
 */
import { z } from "zod";

// ── Primitives ──────────────────────────────────────────────────────────────

export const examSectionSchema = z.enum(["RW", "M"]);
export type ExamSection = z.infer<typeof examSectionSchema>;

/** SCL-132: the client names Module 2 as '2'; the server resolves the locked 2A/2B. */
export const examModuleSchema = z.enum(["1", "2"]);
export type ExamModule = z.infer<typeof examModuleSchema>;

export const examModeSchema = z.enum(["strict", "lenient"]);
export type ExamMode = z.infer<typeof examModeSchema>;

export const examSessionStateSchema = z.enum([
  "created",
  "active",
  "section_break",
  "completed",
  "abandoned_final",
  "partial_scored_abandoned",
]);

export const examSectionStateSchema = z.enum([
  "not_started",
  "module1_active",
  "module1_submitted",
  "module2_active",
  "submitted",
]);

// ── Requests ────────────────────────────────────────────────────────────────

/** §7.3. mode defaults to lenient (§8.6 "Accepts mode = 'lenient' (default)"). */
export const examCreateSessionRequestSchema = z
  .object({
    test_form_id: z.string().uuid(),
    mode: examModeSchema.default("lenient"),
  })
  .strict();
export type ExamCreateSessionRequest = z.infer<
  typeof examCreateSessionRequestSchema
>;

export const examSessionParamsSchema = z.object({
  session_id: z.string().uuid(),
});

export const examSectionParamsSchema = z.object({
  session_id: z.string().uuid(),
  section: examSectionSchema,
});

export const examModuleParamsSchema = z.object({
  session_id: z.string().uuid(),
  section: examSectionSchema,
  module: examModuleSchema,
});

/**
 * §8.3 heartbeat body, as amended by SCL-146: an optional resume position — the
 * ordinal of the item on screen in the section's ACTIVE module. An empty body is
 * the E6 heartbeat unchanged.
 */
export const examHeartbeatRequestSchema = z
  .object({ ordinal: z.number().int().min(0).max(200).optional() })
  .strict();
export type ExamHeartbeatRequest = z.infer<typeof examHeartbeatRequestSchema>;

/**
 * SCL-145 — a passage highlight: a [start, end) range in Unicode CODE POINTS
 * (what Postgres char_length counts), not UTF-16 units. Offsets only: no text.
 */
export const examHighlightSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((h) => h.start < h.end, { message: "start must be before end" });
export type ExamHighlight = z.infer<typeof examHighlightSchema>;

/** Upper bounds, mirrored by the table's CHECKs (20260930090000). */
export const EXAM_WORKSPACE_MAX_ELIMINATED = 8;
export const EXAM_WORKSPACE_MAX_HIGHLIGHTS = 64;

/**
 * SCL-145 — one item's workspace. Eliminations are the item's SERVED option
 * tokens (the ids in `options`), never letters; the server refuses anything else.
 * There is no notes field: free text is out of scope (Doc 05E INV-05E-04).
 */
export const examWorkspaceItemSchema = z
  .object({
    ordinal: z.number().int().min(0).max(200),
    marked_for_review: z.boolean(),
    eliminated_option_ids: z
      .array(z.string().min(1).max(64))
      .max(EXAM_WORKSPACE_MAX_ELIMINATED),
    highlights: z.array(examHighlightSchema).max(EXAM_WORKSPACE_MAX_HIGHLIGHTS),
  })
  .strict();
export type ExamWorkspaceItem = z.infer<typeof examWorkspaceItemSchema>;

/** PUT body: the item's whole workspace (a replay is a no-op). */
export const examWorkspaceSaveRequestSchema = examWorkspaceItemSchema;

/** §15.3 per-request audit metadata; accepted and logged, never trusted. */
export const examAuditMetaSchema = z
  .object({
    client_instance_id: z.string().uuid().optional(),
    user_agent_hash: z.string().max(128).optional(),
  })
  .strict();

/**
 * §11.2 request body. `answer` is what the student selected: an option token for a
 * multiple-choice item, the entered string for a grid-in, or null (explicit omit).
 */
export const examAnswerRequestSchema = z
  .object({
    test_session_id: z.string().uuid(),
    section: examSectionSchema,
    module: examModuleSchema,
    question_id: z.string().min(1).max(64),
    ordinal: z.number().int().min(0).max(200),
    answer: z.string().max(64).nullable(),
    client_latency_ms: z
      .number()
      .int()
      .min(0)
      .max(86_400_000)
      .nullable()
      .optional(),
    idempotency_key: z.string().min(1).max(128),
    audit_meta: examAuditMetaSchema.optional(),
  })
  .strict();
export type ExamAnswerRequest = z.infer<typeof examAnswerRequestSchema>;

// ── Responses ───────────────────────────────────────────────────────────────

export const examSectionStateResponseSchema = z
  .object({
    section: examSectionSchema,
    state: examSectionStateSchema,
    remaining_ms: z.number().int().nonnegative().nullable(),
  })
  .strict();

/** §7.3 / §15.1 session read model. The routed path is never present (§9.3). */
export const examSessionResponseSchema = z
  .object({
    session_id: z.string().uuid(),
    test_form_id: z.string().uuid(),
    state: examSessionStateSchema,
    mode: examModeSchema,
    active_section: examSectionSchema.nullable(),
    grace_expires_at: z.string(),
    attempt_number_for_form: z.number().int().positive(),
    is_first_seen_form_attempt: z.boolean(),
    break_remaining_ms: z.number().int().nonnegative().nullable(),
    sections: z.array(
      z
        .object({
          section: examSectionSchema,
          state: examSectionStateSchema,
          remaining_ms: z.number().int().nonnegative().nullable(),
          module2_path_locked: z.boolean(),
          /** SCL-146: the last reported position in the ACTIVE module, if any. */
          current_ordinal: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type ExamSessionResponse = z.infer<typeof examSessionResponseSchema>;

export const examOptionSchema = z
  .object({ id: z.string().min(1), text: z.string() })
  .strict();

/**
 * §10.2 pre-completion payload, strict. correct_answer and explanation are pinned to
 * null (Coding Standards §5.2); every other answer-bearing or metadata field is
 * absent by construction and rejected by `.strict()`.
 */
export const examQuestionPayloadSchema = z
  .object({
    question_id: z.string(),
    ordinal: z.number().int().nonnegative(),
    question_type: z.enum(["multiple_choice", "student_produced_response"]),
    stem: z.string(),
    passage: z.string().nullable(),
    options: z.array(examOptionSchema),
    assets: z.unknown().nullable(),
    current_answer: z.string().nullable(),
    correct_answer: z.null(),
    explanation: z.null(),
  })
  .strict();
export type ExamQuestionPayload = z.infer<typeof examQuestionPayloadSchema>;

export const examItemsResponseSchema = z
  .object({
    section_state: examSectionStateResponseSchema,
    items: z.array(examQuestionPayloadSchema),
  })
  .strict();

export const examStartModuleResponseSchema = z
  .object({
    section_state: examSectionStateResponseSchema,
    first_item: examQuestionPayloadSchema.nullable(),
  })
  .strict();

export const examSubmitModuleResponseSchema = z
  .object({
    section_state: examSectionStateResponseSchema,
    session_state: examSessionStateSchema,
  })
  .strict();

export const examHeartbeatResponseSchema = z
  .object({ section_state: examSectionStateResponseSchema })
  .strict();

/** §11.2 response; `stored.answer` echoes what the client sent (a token for mcq). */
export const examAnswerResponseSchema = z
  .object({
    response_schema_version: z.literal("tests-answer-v1"),
    stored: z
      .object({
        question_id: z.string(),
        ordinal: z.number().int().nonnegative(),
        answer: z.string().nullable(),
        submitted_at: z.string(),
      })
      .strict(),
    section_state: examSectionStateResponseSchema,
    idempotent_replay: z.boolean(),
  })
  .strict();
export type ExamAnswerResponse = z.infer<typeof examAnswerResponseSchema>;

export const examWorkspaceResponseSchema = z
  .object({
    section_state: examSectionStateResponseSchema,
    items: z.array(examWorkspaceItemSchema),
  })
  .strict();
export type ExamWorkspaceResponse = z.infer<typeof examWorkspaceResponseSchema>;

export const examWorkspaceSaveResponseSchema = z
  .object({
    section_state: examSectionStateResponseSchema,
    item: examWorkspaceItemSchema,
  })
  .strict();
export type ExamWorkspaceSaveResponse = z.infer<
  typeof examWorkspaceSaveResponseSchema
>;

/** §16.2 plus E6's module_not_started / module_not_startable (PR log). */
export const EXAM_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "invalid_request",
  "form_not_published",
  "form_not_available",
  "existing_active_session",
  "session_not_found",
  "session_terminal",
  "session_grace_expired",
  "module_submitted",
  "module_not_started",
  "module_not_startable",
  "invalid_question_for_form",
  "invalid_answer",
  "session_item_mapping_missing",
  "invalid_workspace",
] as const;
export const examErrorCodeSchema = z.enum(EXAM_ERROR_CODES);
export type ExamErrorCode = z.infer<typeof examErrorCodeSchema>;
