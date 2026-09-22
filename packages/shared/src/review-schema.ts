/**
 * Review engine request/response schemas.
 *
 * @spec [Doc-02B_V4 §16; ruled plan §2/§3; brief R3 §2.1] | @implemented [2026-09-21]
 *
 * plain English: every value crossing the review API boundary is parsed here first.
 * Practice keeps its four schemas inline in the route file and leaves five of its nine
 * routes with no schema at all; review does not, and that is the plan's one deliberate
 * improvement over copying practice exactly. expected outcome: an unparsed field cannot
 * reach a review handler, and the request shape has one home instead of being spread
 * across a 4000-line route file. trade-offs: review's schemas live one import away from
 * their handlers, which is the standing repo convention (Coding Standards §7.2), not a
 * new one. edge cases: every optional field is `.optional().nullable()` because the
 * client sends explicit nulls for "unset", exactly as it does to practice.
 *
 * RESPONSE shapes deliberately re-use practice's contract from practice-response-schema.ts
 * rather than restating it. Review may ADD fields, never rename or drop one — R4 runs
 * practice's loop component against these endpoints, so a drift forces a UI fork
 * (owner ruling 2026-09-21). The A14 test is what holds that line.
 */

import { z } from "zod";
import {
  engineAnswerResponseSchema,
  engineCreateSessionResponseSchema,
  engineNextItemResponseSchema,
  engineSessionStateResponseSchema,
  engineSkipResponseSchema,
} from "./practice-response-schema.js";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * ruled plan §2 row 2. `review_sessions_mode_check` enforces the same three values
 * (20260921000000_review_queue_runtime.sql:200-201); this is the wire-side copy.
 */
export const REVIEW_SESSION_MODES = ["queue", "session", "filter"] as const;
export const reviewSessionModeSchema = z.enum(REVIEW_SESSION_MODES);
export type ReviewSessionMode = z.infer<typeof reviewSessionModeSchema>;

/**
 * Which engine put a question in the queue. `full_length` is accepted now and returns
 * an empty pool until the exam vertical writes misses — ruling 6, no stub code.
 */
export const REVIEW_SOURCE_ENGINES = [
  "practice",
  "review",
  "full_length",
] as const;
export const reviewSourceEngineSchema = z.enum(REVIEW_SOURCE_ENGINES);
export type ReviewSourceEngine = z.infer<typeof reviewSourceEngineSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * `filter` mode's pool narrowing. The keys and the bounds are copied from practice's
 * StartSessionBodySchema (practice-canonical.ts:313-330) so the two pickers speak the
 * same language; `mode`, `section` and the two target_* keys are not copied, because
 * review's mode vocabulary and sizing rule are different (plan §2 rows 2 and 4).
 */
export const reviewFilterSpecSchema = z.object({
  sections: z.array(z.string().max(64)).max(20).optional().nullable(),
  domains: z.array(z.string().max(128)).max(100).optional().nullable(),
  skills: z.array(z.string().max(128)).max(100).optional().nullable(),
  difficulties: z.array(z.string().max(32)).max(10).optional().nullable(),
});
export type ReviewFilterSpec = z.infer<typeof reviewFilterSpecSchema>;

/** `session` mode's pool narrowing: one past session, named by engine + id. */
export const reviewSessionSourceSchema = z.object({
  source_engine: reviewSourceEngineSchema,
  source_session_id: z.string().uuid(),
});
export type ReviewSessionSource = z.infer<typeof reviewSessionSourceSchema>;

/**
 * POST /api/review/sessions.
 *
 * `idempotency_key` mirrors practice exactly (owner ruling, R2 check 8): stored in
 * `filters.session_start_idempotency_key` and replayed against OPEN sessions only.
 * It is optional here because it is optional in practice (practice-canonical.ts:339
 * and :322) — brief R3 §2.2's "required" is a difference plan §2 does not list, and
 * the plan's principle makes an unlisted difference a defect (owner ruling 2026-09-21).
 *
 * `filters` is validated per mode in `parseReviewSessionCreate` below rather than with
 * a discriminated union on `mode`, because the wire shape is `{ mode, filters }` and a
 * union over a nested object produces error paths the client cannot act on.
 */
export const reviewCreateSessionBodySchema = z.object({
  mode: reviewSessionModeSchema,
  filters: z.unknown().optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
  target_count: z.number().int().positive().max(1000).optional().nullable(),
});
export type ReviewCreateSessionBody = z.infer<
  typeof reviewCreateSessionBodySchema
>;

/** POST /api/review/answer — field-for-field practice's AnswerBodySchema (:332-341). */
export const reviewAnswerBodySchema = z.object({
  sessionId: z.string().uuid(),
  sessionItemId: z.string().uuid().optional(),
  questionId: z.string().min(1).max(32).optional(),
  selectedAnswer: z.string().trim().max(32).optional().nullable(),
  selectedOptionId: z.string().trim().max(32).optional().nullable(),
  answer: z.string().trim().max(32).optional().nullable(),
  clientAttemptId: z.string().max(128).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
});
export type ReviewAnswerBody = z.infer<typeof reviewAnswerBodySchema>;

/** POST /api/review/sessions/:sessionId/skip — practice's SkipBodySchema (:343-348). */
export const reviewSkipBodySchema = z.object({
  sessionItemId: z.string().uuid().optional(),
  questionId: z.string().min(1).max(32).optional(),
  clientAttemptId: z.string().max(128).optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
});
export type ReviewSkipBody = z.infer<typeof reviewSkipBodySchema>;

/**
 * POST /api/review/sessions/:sessionId/resume. Practice parses this with a bare
 * destructure (practice-canonical.ts:2193) and no schema; review parses it.
 */
export const reviewResumeBodySchema = z.object({
  client_instance_id: z.string().max(128).optional().nullable(),
  force_takeover: z.boolean().optional().nullable(),
});
export type ReviewResumeBody = z.infer<typeof reviewResumeBodySchema>;

/** POST /api/review/sessions/:sessionId/calculator-state — practice's (:350-353). */
export const reviewCalculatorStateBodySchema = z.object({
  calculator_state: z.unknown().optional().nullable(),
  client_instance_id: z.string().max(128).optional().nullable(),
});
export type ReviewCalculatorStateBody = z.infer<
  typeof reviewCalculatorStateBodySchema
>;

/** GET /api/review/sessions/:sessionId/next?client_instance_id=… */
export const reviewNextQuerySchema = z.object({
  client_instance_id: z.string().min(1).max(128),
});
export type ReviewNextQuery = z.infer<typeof reviewNextQuerySchema>;

/**
 * GET /api/review/pool?tz=…
 *
 * `tz` is optional and unconstrained here on purpose: an unknown zone is NOT a 400.
 * Brief R3 §2.4 requires a UTC fallback with a log and never a 500, so validity is
 * decided in the handler by `resolveTimeZone`, not by rejecting the request.
 */
export const reviewPoolQuerySchema = z.object({
  tz: z.string().max(64).optional().nullable(),
});
export type ReviewPoolQuery = z.infer<typeof reviewPoolQuerySchema>;

// ---------------------------------------------------------------------------
// Mode-aware create parsing
// ---------------------------------------------------------------------------

export type ReviewPoolSpec =
  | { mode: "queue" }
  | { mode: "session"; source: ReviewSessionSource }
  | { mode: "filter"; filter: ReviewFilterSpec };

export type ReviewCreateSpec = {
  poolSpec: ReviewPoolSpec;
  clientInstanceId: string | null;
  idempotencyKey: string | null;
  targetCount: number | null;
};

/**
 * @spec [ruled plan §2 row 2; brief R3 §2.3] | @implemented [2026-09-21]
 * plain English: turn a parsed create body into the pool spec the service layer uses,
 * rejecting a `filters` payload that does not match its `mode`. expected outcome: a
 * `session` create without a source session id is a 400 from here, not a confusing
 * empty pool later. trade-offs: returns a Result rather than throwing, because an
 * invalid payload is an expected failure (Coding Standards §3.6). edge cases: `queue`
 * mode ignores `filters` entirely rather than rejecting a stray object — the client
 * sends `{}` and an over-strict check would break a harmless request.
 */
export function parseReviewSessionCreate(
  body: ReviewCreateSessionBody,
):
  | { ok: true; value: ReviewCreateSpec }
  | { ok: false; error: string; details?: unknown } {
  const clientInstanceId = body.client_instance_id?.trim() || null;
  const idempotencyKey = body.idempotency_key?.trim() || null;
  const targetCount = body.target_count ?? null;

  if (body.mode === "queue") {
    return {
      ok: true,
      value: {
        poolSpec: { mode: "queue" },
        clientInstanceId,
        idempotencyKey,
        targetCount,
      },
    };
  }

  if (body.mode === "session") {
    const parsed = reviewSessionSourceSchema.safeParse(body.filters ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        error:
          "mode 'session' requires filters { source_engine, source_session_id }",
        details: parsed.error.flatten(),
      };
    }
    return {
      ok: true,
      value: {
        poolSpec: { mode: "session", source: parsed.data },
        clientInstanceId,
        idempotencyKey,
        targetCount,
      },
    };
  }

  const parsed = reviewFilterSpecSchema.safeParse(body.filters ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error:
        "mode 'filter' requires filters { sections?, domains?, skills?, difficulties? }",
      details: parsed.error.flatten(),
    };
  }
  return {
    ok: true,
    value: {
      poolSpec: { mode: "filter", filter: parsed.data },
      clientInstanceId,
      idempotencyKey,
      targetCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
//
// The five loop responses are practice's, unextended. Review adds nothing to them
// today; the schemas are re-exported under review names so a future addition has an
// obvious place to go and the A14 comparison still has two named ends.

export const reviewCreateSessionResponseSchema =
  engineCreateSessionResponseSchema;
export const reviewSessionStateResponseSchema =
  engineSessionStateResponseSchema;
export const reviewNextItemResponseSchema = engineNextItemResponseSchema;
export const reviewAnswerResponseSchema = engineAnswerResponseSchema;
export const reviewSkipResponseSchema = engineSkipResponseSchema;

/** GET /api/review/sessions/open — practice's shape (:2166), review's statuses. */
export const reviewOpenSessionsResponseSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string(),
      section: z.string().nullable(),
      mode: z.string(),
      status: z.enum(["created", "active"]),
      created_at: z.string(),
      target_question_count: z.number(),
      total_items: z.number(),
      answered_items: z.number(),
    }),
  ),
  maxConcurrentSessions: z.number(),
  requestId: z.string().optional(),
});
export type ReviewOpenSessionsResponse = z.infer<
  typeof reviewOpenSessionsResponseSchema
>;

/** POST /api/review/sessions/:sessionId/terminate — practice's shape (:2431). */
export const reviewTerminateResponseSchema = z.object({
  sessionId: z.string(),
  state: z.literal("abandoned"),
  readOnly: z.literal(true),
});

/**
 * One past session that still has open queue entries, for R4's session picker.
 *
 * Ruling 20: no stored labels. The row carries facts — the source session's local date
 * and time in the caller's zone, its mode and filters, and how many of its questions
 * are still open — and R4 formats "Thu, Sep 17 → Practice · 2:40 PM · Math · Algebra ·
 * 4 to review" from them.
 */
export const reviewPoolSourceSessionSchema = z.object({
  source_engine: reviewSourceEngineSchema,
  source_session_id: z.string(),
  created_at: z.string().nullable(),
  local_date: z.string().nullable(),
  local_time: z.string().nullable(),
  mode: z.string().nullable(),
  filters: z.unknown().nullable(),
  open_count: z.number(),
});
export type ReviewPoolSourceSession = z.infer<
  typeof reviewPoolSourceSessionSchema
>;

export const reviewPoolFacetSchema = z.object({
  key: z.string(),
  count: z.number(),
});

/** GET /api/review/pool — one read for both pickers (brief R3 §2.4). */
export const reviewPoolSummaryResponseSchema = z.object({
  total: z.number(),
  timezone: z.string(),
  timezoneFallback: z.boolean(),
  bySection: z.array(reviewPoolFacetSchema),
  byDomain: z.array(reviewPoolFacetSchema),
  bySkill: z.array(reviewPoolFacetSchema),
  sessions: z.array(reviewPoolSourceSessionSchema),
});
export type ReviewPoolSummaryResponse = z.infer<
  typeof reviewPoolSummaryResponseSchema
>;
