/**
 * @spec [Doc-03B_V2 §4 Endpoint Catalog, §5, §6, §7, §8, §9]
 * @implemented 2026-08-09
 *
 * plain English: The LISA tutor runtime router. Mounted at `/api/tutor` behind
 * `ragLimiter -> requireSupabaseAuth -> requireStudentOnly -> doubleCsrfProtection`
 * (server/index.ts), so every handler in this file already has an authenticated,
 * student-role `req.user`. This file implements:
 *   - POST   /conversations                         (§5 create conversation)
 *   - POST   /messages                              (§6 append turn — the 19-step pipeline)
 *   - GET    /conversations/:conversationId         (§7 replay)
 *   - GET    /conversations                         (§8 list)
 *   - POST   /conversations/:conversationId/end     (end session)
 *   - POST   /conversations/:conversationId/resume  (resume from crisis pause)
 *
 * expected outcome: every route follows auth -> entitlement -> parse -> domain -> serialize
 * (Coding Standards §8.1). The append-turn pipeline (§6.5) is the anti-leak chokepoint:
 * orchestrator output is cleaned, scanned for answer leakage relative to server-resolved
 * pre-submit state, and silently substituted (never a blocking error) before persistence
 * and before it is ever returned to the client. The replay endpoint re-applies the same
 * scan (defense-in-depth) so a message that was safe at write-time but whose surface
 * state has since changed (e.g., a race) is never served with a leak on read either.
 *
 * trade-offs / edge cases:
 *  - Orchestration is wired to the real worker via `orchestrateTurn()` from
 *    server/lib/tutor-orchestrator-client.ts (LISA-FULL-001 item 1). The anti-leak
 *    chokepoint lives inside that call — worker-side scan + BFF-side scanAndSubstitute.
 *    The route-layer scan in step 15 is defense-in-depth only.
 *  - Per-request rate limiting beyond `ragLimiter` (daily/weekly/monthly quotas, Doc 03
 *    Main §13) is a separate quota service not yet built; deferred, noted at step 7.
 *  - `isPreSubmitForSurface` and `TUTOR_ANTI_LEAK_SUBSTITUTION` are imported from their
 *    canonical source in tutor-antileak.ts — no local declarations (the WS-2 CI gate was
 *    rewritten to behavior assertions per LISA-FULL-001 item 6).
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { EntitlementService } from "../services/entitlement-service";
// resolveFullEnvelope: context resolver lives in tutor-context.ts.
// hasAnswerLeak was previously imported here but is now internal to the
// output serializer — the static gate test (LISA-FULL-007) enforces that
// this file never bypasses the serializer by using raw scan functions.
import {
  resolveFullEnvelope,
  sessionTablesFor,
} from "../services/tutor-context";
// isPreSubmitForSurface: still needed to resolve pre-submit state before
// calling the serializer. TUTOR_ANTI_LEAK_SUBSTITUTION no longer imported
// here — it lives inside the serializer.
import { isPreSubmitForSurface } from "../services/tutor-antileak";
// LISA-FULL-007: single mandatory output serializer for all student-facing
// tutor content. Every response path passes through serializeTutorOutput.
import {
  serializeTutorOutput,
  type OutputScanContext,
} from "../services/tutor-output-serializer";
import { orchestrateTurn } from "../lib/tutor-orchestrator-client";
import {
  MODEL_ARMOR_SUBSTITUTION,
  scanWithModelArmor,
} from "../services/tutor-model-armor";
import { getRecentMessages } from "../services/tutor-memory";
import { sendTutorError } from "../services/tutor-error-codes";
import { enqueueCloudTask } from "../services/cloud-tasks-enqueue";
import {
  runCrisisClassifier,
  getCrisisResponse,
  flagConversationForReview,
  notifyCrisisEvent,
  evaluateNotificationPolicy,
} from "../services/tutor-crisis";
import type { FlagForReviewResult } from "../services/tutor-crisis";
// W3-3: the pure resolver, imported from its own module so the route always
// runs the real one.
import { resolveCrisisCountry } from "../services/crisis-resources";
import {
  sanitizeInput,
  scanForInjectionPatterns,
  checkSignatureTable,
  logInjectionAttempt,
} from "../services/tutor-injection-defense";
import {
  logContextResolution,
  logTurnMetrics,
} from "../services/tutor-policy-logger";
import { persistInstructionAssignment } from "../services/tutor-runtime-writer";
import { orchestrateRequestSchema } from "../../apps/workers/tutor-orchestrator/src/lib/_tutor-orchestrator-wire.generated";
import {
  listConversationsQuerySchema,
  type ConversationDetail,
} from "../../packages/shared/src/tutor-lifecycle-schema";

const router = Router();

// LISA-FULL-007: TUTOR_ANTI_LEAK_SUBSTITUTION, hasAnswerLeak, and
// removeInternalMetadataMentions are now internal to the output serializer
// (server/services/tutor-output-serializer.ts). This file calls
// serializeTutorOutput() — never the raw scan functions. The static gate
// test enforces this property.

// ── Local surfaces enum (reused from the canonical wire schema — single
// source of truth for the entry_mode / source_surface literal unions) ──────
const entryModeSchema = orchestrateRequestSchema.shape.entry_mode;
const sourceSurfaceSchema = orchestrateRequestSchema.shape.source_surface;
const contentKindSchema = z.enum([
  "message",
  "suggestion",
  "consent_prompt",
  "system_note",
]);

type EntryMode = z.infer<typeof entryModeSchema>;
type SourceSurface = z.infer<typeof sourceSurfaceSchema>;

// ── Request schemas (Coding Standards §7: Zod first, types inferred) ──────

const createConversationSchema = z.object({
  entry_mode: entryModeSchema,
  source_surface: sourceSurfaceSchema,
  source_session_id: z.string().uuid().nullable().optional(),
  source_session_item_id: z.string().uuid().nullable().optional(),
  source_question_row_id: z.string().min(1).nullable().optional(),
  source_question_canonical_id: z.string().min(1).nullable().optional(),
  idempotency_key: z.string().uuid().optional(),
});

const clientScopeSchema = z.object({
  source_session_id: z.string().uuid().nullable().optional(),
  source_session_item_id: z.string().uuid().nullable().optional(),
  source_question_row_id: z.string().min(1).nullable().optional(),
  source_question_canonical_id: z.string().min(1).nullable().optional(),
});

const appendTurnSchema = z.object({
  conversation_id: z.string().uuid(),
  message: z.string().min(1).max(4000),
  content_kind: contentKindSchema.optional(),
  client_turn_id: z.string().uuid(),
  client_scope: clientScopeSchema.optional(),
});

const endConversationSchema = z.object({
  idempotency_key: z.string().uuid().optional(),
});

const resumeConversationSchema = z.object({
  idempotency_key: z.string().uuid().optional(),
});

const fetchConversationQuerySchema = z.object({
  message_limit: z.coerce.number().int().positive().max(200).optional(),
  before_message_id: z.string().uuid().optional(),
});

// ── Domain types ─────────────────────────────────────────────────────────

type ResolvedScopeRow = {
  source_session_id: string | null;
  source_session_item_id: string | null;
  source_question_row_id: string | null;
  source_question_canonical_id: string | null;
};

type TutorConversationRow = {
  id: string;
  student_id: string;
  entry_mode: EntryMode;
  source_surface: SourceSurface;
  source_session_id: string | null;
  source_session_item_id: string | null;
  source_question_row_id: string | null;
  source_question_canonical_id: string | null;
  status: "active" | "closed" | "abandoned" | "ended";
  crisis_flagged: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  title: string | null;
  surface: "standalone" | "practice" | "review" | null;
  crisis_paused_at: string | null;
  ended_at: string | null;
};

// isPreSubmitForSurface is now imported directly from ../services/tutor-antileak
// (canonical algorithm, single source of truth). The former local wrapper was
// removed per LISA-FULL-001 item 6 — the WS-2 CI gate was rewritten from
// structural assertions to behavior assertions, so no local declaration is
// required.

// LISA-FULL-007: INTERNAL_METADATA_PATTERNS and removeInternalMetadataMentions
// moved to shared/tutor-safety-constants.ts (single source of truth for both
// BFF and worker). Now consumed only through serializeTutorOutput.

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * @spec [Doc-03B_V2 §17, Coding Standards §6.1]
 * plain English: server-authoritative entitlement gate — every tutor route
 * re-checks entitlement per request (INV-03-18); never trusts client state.
 * Returns true and sends the 403 response if entitlement is NOT active.
 */
async function denyIfNotEntitled(
  studentId: string,
  res: Response,
): Promise<boolean> {
  const active =
    await EntitlementService.isEntitlementActiveForProfile(studentId);
  if (!active) {
    sendTutorError(res, "entitlement_required");
    return true;
  }
  return false;
}

/**
 * Extracts student-role message texts from a conversation for the echo
 * exemption. When the student already stated the correct-answer value,
 * LISA repeating it is reflection, not disclosure.
 *
 * Fail-closed: on DB error returns [] — the scanner treats missing
 * studentMessages as no echo exemption (pre-exemption behavior).
 */
async function loadStudentMessagesForConversation(
  conversationId: string,
): Promise<readonly string[]> {
  const { data, error } = await supabaseServer
    .from("tutor_messages")
    .select("message")
    .eq("conversation_id", conversationId)
    .eq("role", "student")
    .order("created_at", { ascending: true });

  if (error) {
    logger.warn(
      "TUTOR_RUNTIME",
      "student_messages_load_failed",
      "failed to load student messages for echo exemption; failing closed (no exemption)",
      { conversationId, error: error.message },
    );
    return [];
  }
  return (data ?? []).map((r) => r.message as string);
}

type ReplayMessageRow = {
  id: string;
  role: "student" | "tutor" | "system";
  content_kind: string;
  message: string;
  source_session_item_id: string | null;
  created_at: string;
  client_turn_id: string | null;
};

/**
 * @spec [Doc-03B_V2 §7.3-7.4] loads a page of tutor_messages for replay,
 * oldest-first, applying the optional `before_message_id` cursor (§7.3).
 * Returns null on a DB error so the caller can send `canonical_write_failed`.
 * Kept out-of-line so the replay route handler stays short between the
 * route path literal and the anti-leak re-scan — see WS-2 CI gate note in
 * the module header.
 */
async function loadMessagesForReplay(
  conversationId: string,
  messageLimit: number,
  beforeMessageId: string | undefined,
): Promise<ReplayMessageRow[] | null> {
  let query = supabaseServer
    .from("tutor_messages")
    .select(
      "id, role, content_kind, message, source_session_item_id, created_at, client_turn_id",
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(messageLimit);

  if (beforeMessageId) {
    const { data: cursorRow } = await supabaseServer
      .from("tutor_messages")
      .select("created_at")
      .eq("id", beforeMessageId)
      .maybeSingle();
    if (cursorRow) {
      query = query.lt("created_at", cursorRow.created_at as string);
    }
  }

  const { data, error } = await query;
  if (error) {
    logger.error(
      "TUTOR_RUNTIME",
      "replay_messages_failed",
      "Failed to load tutor_messages for replay",
      { message: error.message, code: error.code },
      { conversationId },
    );
    return null;
  }

  return ((data ?? []) as ReplayMessageRow[]).slice().reverse();
}

/**
 * @spec [Doc-03B_V2 §3.3] ownership check — loads a tutor_conversations row
 * scoped to the authenticated student. Returns null (and does not respond)
 * if not found or not owned or soft-deleted, so callers can send the
 * canonical `conversation_not_found` (404) response.
 */
async function loadOwnedConversation(
  conversationId: string,
  studentId: string,
): Promise<TutorConversationRow | null> {
  const { data, error } = await supabaseServer
    .from("tutor_conversations")
    .select(
      "id, student_id, entry_mode, source_surface, source_session_id, source_session_item_id, source_question_row_id, source_question_canonical_id, status, crisis_flagged, deleted_at, created_at, updated_at, closed_at, title, surface, crisis_paused_at, ended_at",
    )
    .eq("id", conversationId)
    .eq("student_id", studentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    logger.error(
      "TUTOR_RUNTIME",
      "conversation_lookup_failed",
      "tutor_conversations query failed",
      { message: error.message, code: error.code },
      { conversationId },
    );
    return null;
  }

  return (data as TutorConversationRow | null) ?? null;
}

/**
 * @spec [Doc-03B_V2 §5.5 step 6] resolves a trusted scope from client-supplied
 * references at conversation-creation time. Unlike tutor-context's
 * `resolveScope` (which fails closed for the already-scoped append-turn
 * path), this degrades gracefully: a stale or unresolvable reference is
 * cleared (falls back to the broader scope) rather than blocking creation.
 */
async function resolveTrustedScopeForCreate(
  studentId: string,
  sourceSessionId: string | null,
  sourceSessionItemId: string | null,
  sourceQuestionRowId: string | null,
  sourceQuestionCanonicalId: string | null,
  sourceSurface: string,
): Promise<ResolvedScopeRow> {
  // Review items live in review tables (W4-1); every other surface keeps the
  // practice tables it always used.
  const tables = sessionTablesFor(sourceSurface);
  let sessionId = sourceSessionId;
  let sessionItemId = sourceSessionItemId;
  let questionRowId = sourceQuestionRowId;
  let canonicalId = sourceQuestionCanonicalId;

  if (sessionId) {
    const { data, error } = await supabaseServer
      .from(tables.sessions)
      .select("id")
      .eq("id", sessionId)
      .eq(tables.owner, studentId)
      .maybeSingle();
    if (error || !data) {
      sessionId = null;
    }
  }

  if (sessionItemId) {
    const { data, error } = await supabaseServer
      .from(tables.items)
      .select("id, question_id, session_id")
      .eq("id", sessionItemId)
      .eq(tables.owner, studentId)
      .maybeSingle();
    if (error || !data) {
      sessionItemId = null;
    } else {
      // An owned item's question is authoritative — it overrides a
      // client-supplied question id rather than yielding to it, so a scoped
      // conversation cannot pair one item with another question (W4-1).
      questionRowId = (data.question_id as string) ?? null;
      // Anchor the session to the item's own session.
      if (!sessionId || sessionId !== (data.session_id as string)) {
        sessionId = (data.session_id as string) ?? null;
      }
    }
  }

  if (questionRowId) {
    const { data, error } = await supabaseServer
      .from("questions")
      .select("id")
      .eq("id", questionRowId)
      .maybeSingle();
    if (error || !data) {
      questionRowId = null;
      canonicalId = null;
    } else {
      canonicalId = data.id as string;
    }
  }

  return {
    source_session_id: sessionId,
    source_session_item_id: sessionItemId,
    source_question_row_id: questionRowId,
    source_question_canonical_id: canonicalId,
  };
}

/**
 * @spec [Doc-03_V3 §17, INV-03-04, LISA-FULL-007]
 *
 * Fetches the canonical correct answer for a scoped question row, for use
 * as the anti-leak comparison key. Returns a result that distinguishes
 * "no question context" (value=null, failed=false) from "resolution failed"
 * (value=null, failed=true). The serializer uses this distinction for the
 * correct-answer blocking gate: pre-submit + failed = block.
 */
type CorrectAnswerResult = {
  value: string | null;
  failed: boolean;
};

async function getCorrectAnswerForScope(
  questionRowId: string | null,
): Promise<CorrectAnswerResult> {
  if (!questionRowId) return { value: null, failed: false };

  const { data, error } = await supabaseServer
    .from("questions")
    .select("correct_answer")
    .eq("id", questionRowId)
    .maybeSingle();

  if (error || !data) {
    logger.warn(
      "TUTOR_RUNTIME",
      "correct_answer_lookup_failed",
      "Could not resolve correct_answer for anti-leak scan; signaling resolution failure (LISA-FULL-007)",
      { questionRowId },
    );
    return { value: null, failed: true };
  }

  return {
    value: (data.correct_answer as string | null) ?? null,
    failed: false,
  };
}

// ── Turn-level idempotency (Doc-03B_V4.1 §14.3, §14.4) ─────────────────

type ExistingStudentTurnRow = {
  id: string;
  message: string;
  status: "pending" | "completed" | "failed";
  created_at: string;
};

/**
 * 01A `in_progress_timeout_seconds` default (300s): a turn still 'pending'
 * after this is treated as crashed and may be re-owned by a retry.
 * @spec [Doc-03B_V4.1 §14.3 "Worker crash mid-flow"; Doc-01A in_progress_timeout_seconds]
 */
const TURN_IN_PROGRESS_TIMEOUT_MS = 300_000;

/**
 * @spec [Doc-03B_V4.1 §13.7, §14.3; CC Brief "Close the LISA Vertical" PR 1.2]
 * @implemented 2026-09-23
 *
 * plain English: a retry found this turn's student row but no tutor reply.
 * Decide whether the retry may take the turn over. A row that is 'pending'
 * and younger than the in-progress timeout belongs to an attempt that is
 * still running → "in_progress". Otherwise ('failed', a 'pending' row past
 * the timeout, or a legacy 'completed' row with no reply — the status column
 * defaulted existing rows to 'completed') the retry claims it with a
 * compare-and-set back to 'pending'. Zero rows updated means another retry
 * claimed it first → "in_progress" (§13.7's `rowCount === 0` guard).
 *
 * trade-offs: this is §13.7's guard applied to `tutor_messages.status`; the
 * spec's `idempotency_records` table and advisory lock do not exist in this
 * codebase. The unique index remains the hard backstop (§14.4). Edge case:
 * a re-claimed row keeps its original created_at, so a retry that itself
 * runs past the timeout can be re-owned by a third attempt; the index then
 * rejects the loser's reply with 409 idempotency_conflict.
 */
async function claimStudentTurnForRetry(
  row: ExistingStudentTurnRow,
): Promise<"claimed" | "in_progress" | "error"> {
  const ageMs = Date.now() - Date.parse(row.created_at);
  if (row.status === "pending" && ageMs < TURN_IN_PROGRESS_TIMEOUT_MS) {
    return "in_progress";
  }

  let claim = supabaseServer
    .from("tutor_messages")
    .update({ status: "pending" })
    .eq("id", row.id)
    .eq("status", row.status);
  if (row.status === "pending") {
    claim = claim.lt(
      "created_at",
      new Date(Date.now() - TURN_IN_PROGRESS_TIMEOUT_MS).toISOString(),
    );
  }
  const { data, error } = await claim.select("id").maybeSingle();
  if (error) {
    logger.error(
      "TUTOR_RUNTIME",
      "turn_claim_failed",
      "could not re-claim student turn for retry; failing closed",
      { code: error.code },
    );
    return "error";
  }
  return data ? "claimed" : "in_progress";
}

/** The idempotency index named in supabase/migrations/20260812010000. */
const CLIENT_TURN_UNIQUE_INDEX = "idx_tutor_messages_client_turn_idempotency";

function isClientTurnUniqueViolation(
  err: { code?: string; message?: string } | null,
): boolean {
  return (
    err?.code === "23505" &&
    (err.message ?? "").includes(CLIENT_TURN_UNIQUE_INDEX)
  );
}

/**
 * @spec [Doc-03B_V4.1 §14.4 "Constraint violation handling"]
 * The unique index caught a duplicate client_turn_id that the step-8 check
 * did not (a concurrent request). The spec treats this as a bug signal:
 * high-severity log, 409 idempotency_conflict. Never a silent replay.
 */
function sendClientTurnUniqueViolation(
  res: Response,
  conversationId: string,
  role: "student" | "tutor",
): void {
  logger.error(
    "TUTOR_RUNTIME",
    "idempotency_unique_constraint_violation",
    "duplicate client_turn_id rejected by the unique index; step-8 idempotency did not catch it",
    undefined,
    { conversationId, role },
  );
  sendTutorError(res, "idempotency_conflict");
}

// ============================================================================
// POST /conversations — §5 Start / reuse a conversation
// ============================================================================

router.post(
  "/conversations",
  async (req: Request, res: Response): Promise<void> => {
    // ── auth ── already enforced at mount (requireSupabaseAuth + requireStudentOnly)
    if (!req.user) {
      sendTutorError(res, "unauthenticated");
      return;
    }
    const studentId = req.user.id;

    // ── entitlement ──
    if (await denyIfNotEntitled(studentId, res)) return;

    // ── parse ──
    const parsed = createConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      sendTutorError(res, "invalid_input", parsed.error.flatten());
      return;
    }
    const input = parsed.data;

    try {
      // ── domain: resolve trusted scope, degrading stale refs (§5.5 step 6) ──
      const resolvedScope = await resolveTrustedScopeForCreate(
        studentId,
        input.source_session_id ?? null,
        input.source_session_item_id ?? null,
        input.source_question_row_id ?? null,
        input.source_question_canonical_id ?? null,
        input.source_surface,
      );

      // ── domain: derive surface from source_surface ──
      const surface: "standalone" | "practice" | "review" =
        input.source_surface === "dashboard"
          ? "standalone"
          : input.source_surface === "test_review"
            ? "review"
            : (input.source_surface as "practice" | "review");

      // ── domain: reuse rule ──
      // CC Brief §5.2: general/dashboard ("standalone") conversations ALWAYS
      // create a new row. Idempotency is handled by idempotency_key, not by
      // conversation-level reuse. Scoped conversations (practice/review) still
      // reuse — there IS only one conversation per practice/review session.
      let reusedRow: TutorConversationRow | null = null;

      if (input.entry_mode !== "general") {
        const freshnessCutoff = new Date();
        freshnessCutoff.setDate(freshnessCutoff.getDate() - 7);

        let reuseQuery = supabaseServer
          .from("tutor_conversations")
          .select(
            "id, student_id, entry_mode, source_surface, source_session_id, source_session_item_id, source_question_row_id, source_question_canonical_id, status, crisis_flagged, deleted_at, created_at, updated_at, closed_at, title, surface, crisis_paused_at, ended_at",
          )
          .eq("student_id", studentId)
          .eq("source_surface", input.source_surface)
          .eq("entry_mode", input.entry_mode)
          .eq("status", "active")
          .is("deleted_at", null)
          .gte("updated_at", freshnessCutoff.toISOString())
          .order("updated_at", { ascending: false })
          .limit(1);

        reuseQuery = resolvedScope.source_session_id
          ? reuseQuery.eq("source_session_id", resolvedScope.source_session_id)
          : reuseQuery.is("source_session_id", null);
        reuseQuery = resolvedScope.source_session_item_id
          ? reuseQuery.eq(
              "source_session_item_id",
              resolvedScope.source_session_item_id,
            )
          : reuseQuery.is("source_session_item_id", null);
        reuseQuery = resolvedScope.source_question_row_id
          ? reuseQuery.eq(
              "source_question_row_id",
              resolvedScope.source_question_row_id,
            )
          : reuseQuery.is("source_question_row_id", null);

        const { data: reusable, error: reuseError } =
          await reuseQuery.maybeSingle();

        if (reuseError) {
          logger.error(
            "TUTOR_RUNTIME",
            "reuse_lookup_failed",
            "Conversation reuse lookup failed",
            { message: reuseError.message, code: reuseError.code },
          );
        }

        if (reusable) {
          reusedRow = reusable as TutorConversationRow;
        }
      }

      if (reusedRow) {
        res.status(200).json({
          data: {
            conversation_id: reusedRow.id,
            reused: true,
            entry_mode: reusedRow.entry_mode,
            source_surface: reusedRow.source_surface,
            surface: reusedRow.surface,
            status: reusedRow.status,
            title: reusedRow.title,
            crisis_flagged: reusedRow.crisis_flagged,
            crisis_paused_at: reusedRow.crisis_paused_at,
            resolved_scope: {
              source_session_id: reusedRow.source_session_id,
              source_session_item_id: reusedRow.source_session_item_id,
              source_question_row_id: reusedRow.source_question_row_id,
              source_question_canonical_id:
                reusedRow.source_question_canonical_id,
            },
            created_at: reusedRow.created_at,
            updated_at: reusedRow.updated_at,
          },
        });
        return;
      }

      // ── domain: idempotency check on idempotency_key ──
      // Prevents double-click creating duplicate conversations.
      // Skipped when key is absent — real enforcement (column + unique index)
      // lands in PR B; until then the key is optional so the deployed client
      // (which sends no key) is not broken.
      if (input.idempotency_key) {
        const { data: existingByKey, error: idempotencyError } =
          await supabaseServer
            .from("tutor_conversations")
            .select(
              "id, student_id, entry_mode, source_surface, source_session_id, source_session_item_id, source_question_row_id, source_question_canonical_id, status, crisis_flagged, deleted_at, created_at, updated_at, closed_at, title, surface, crisis_paused_at, ended_at",
            )
            .eq("student_id", studentId)
            .eq("assignment_key", input.idempotency_key)
            .maybeSingle();

        if (idempotencyError) {
          logger.error(
            "TUTOR_RUNTIME",
            "idempotency_lookup_failed",
            "Idempotency key lookup failed",
            { message: idempotencyError.message, code: idempotencyError.code },
          );
          sendTutorError(res, "idempotency_lookup_failed");
          return;
        }

        if (existingByKey) {
          const row = existingByKey as TutorConversationRow;
          res.status(200).json({
            data: {
              conversation_id: row.id,
              reused: true,
              entry_mode: row.entry_mode,
              source_surface: row.source_surface,
              surface: row.surface,
              status: row.status,
              title: row.title,
              crisis_flagged: row.crisis_flagged,
              crisis_paused_at: row.crisis_paused_at,
              resolved_scope: {
                source_session_id: row.source_session_id,
                source_session_item_id: row.source_session_item_id,
                source_question_row_id: row.source_question_row_id,
                source_question_canonical_id: row.source_question_canonical_id,
              },
              created_at: row.created_at,
              updated_at: row.updated_at,
            },
          });
          return;
        }
      }

      // ── domain: create new conversation ──
      const { data: created, error: insertError } = await supabaseServer
        .from("tutor_conversations")
        .insert({
          student_id: studentId,
          entry_mode: input.entry_mode,
          source_surface: input.source_surface,
          surface,
          source_session_id: resolvedScope.source_session_id,
          source_session_item_id: resolvedScope.source_session_item_id,
          source_question_row_id: resolvedScope.source_question_row_id,
          source_question_canonical_id:
            resolvedScope.source_question_canonical_id,
          ...(input.idempotency_key
            ? { assignment_key: input.idempotency_key }
            : {}),
        })
        .select(
          "id, student_id, entry_mode, source_surface, source_session_id, source_session_item_id, source_question_row_id, source_question_canonical_id, status, crisis_flagged, deleted_at, created_at, updated_at, closed_at, title, surface, crisis_paused_at, ended_at",
        )
        .single();

      if (insertError || !created) {
        logger.error(
          "TUTOR_RUNTIME",
          "conversation_create_failed",
          "Failed to insert tutor_conversations row",
          { message: insertError?.message, code: insertError?.code },
        );
        sendTutorError(res, "canonical_write_failed");
        return;
      }

      const row = created as TutorConversationRow;
      res.status(201).json({
        data: {
          conversation_id: row.id,
          reused: false,
          entry_mode: row.entry_mode,
          source_surface: row.source_surface,
          surface: row.surface,
          status: row.status,
          title: row.title,
          crisis_flagged: row.crisis_flagged,
          crisis_paused_at: row.crisis_paused_at,
          resolved_scope: {
            source_session_id: row.source_session_id,
            source_session_item_id: row.source_session_item_id,
            source_question_row_id: row.source_question_row_id,
            source_question_canonical_id: row.source_question_canonical_id,
          },
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      });
    } catch (err) {
      logger.error(
        "TUTOR_RUNTIME",
        "create_conversation_error",
        "Unexpected error in POST /conversations",
        err instanceof Error ? err : undefined,
      );
      sendTutorError(res, "canonical_write_failed");
    }
  },
);

// ============================================================================
// POST /messages — §6 Append Turn (19-step pipeline, §6.5)
// ============================================================================

router.post("/messages", async (req: Request, res: Response): Promise<void> => {
  // Step 1: Validate JWT and role — already enforced at mount.
  if (!req.user) {
    sendTutorError(res, "unauthenticated");
    return;
  }
  const studentId = req.user.id;

  // Step 2: Check entitlement (per-boundary, INV-03-18).
  if (await denyIfNotEntitled(studentId, res)) return;

  // Step 3: Age gate (INV-03-07, Doc-03B_V4.1 §3.2).
  // Enforced by the `requireStudentOnly` middleware mounted at /api/tutor
  // (server/index.ts). That middleware checks `role === "student"` AND
  // `is_under_13 !== false` (fail-closed). No additional check needed here —
  // any request reaching this handler has already passed the age gate.

  // Step 4: Live exam block (INV-03-02, Doc-03B_V4.1 §3.4) — REMOVED.
  // @spec [Doc-03B_V4.1 §3.4; Doc 01 §27.3 step 6] | @implemented [2026-09-23]
  // plain English: E1 exam deletion ruling, 2026-09-23 — the pre-baseline
  // full-length runtime was removed pending the Doc 04 rebuild. The former gate
  // queried `full_length_exam_sessions`, a table no migration creates, so it
  // failed open (SCL-079) on every call and blocked nothing. There is no live
  // exam to detect until Doc 04 lands; the rebuild must restore this step
  // against its own session table. The `tutor_unavailable_during_live_exam`
  // error code stays in the Doc-03B §5.9 taxonomy for that reinstatement.
  // TRACKED: G-EX-06 — restored in E9 against Doc 04A `test_sessions`
  // (student_id, state = 'active'); the exam vertical does not close until it
  // is. SCL-126 (originally SCL-119) records the interim and restates SCL-079's table/column.

  // Step 6: Validate request payload (§6.4). Run before ownership so a
  // malformed body never triggers a DB lookup.
  const parsed = appendTurnSchema.safeParse(req.body);
  if (!parsed.success) {
    sendTutorError(res, "invalid_input", parsed.error.flatten());
    return;
  }
  const input = parsed.data;
  const contentKind = input.content_kind ?? "message";
  // Set once step 11 has persisted (or re-claimed) the student row, so the
  // catch-all can release the turn for retry instead of leaving it 'pending'.
  let persistedStudentMessageId: string | null = null;

  try {
    // Step 5: Verify conversation ownership (§3.3).
    const conversation = await loadOwnedConversation(
      input.conversation_id,
      studentId,
    );
    if (!conversation) {
      sendTutorError(res, "conversation_not_found");
      return;
    }
    if (conversation.status === "ended") {
      sendTutorError(res, "conversation_already_ended");
      return;
    }
    if (conversation.status !== "active") {
      sendTutorError(res, "conversation_closed");
      return;
    }
    if (conversation.crisis_paused_at) {
      sendTutorError(res, "conversation_crisis_paused");
      return;
    }

    // Step 7: Rate/quota limits — `ragLimiter` (mounted at /api/tutor) covers
    // request-rate; daily/weekly/monthly quota accounting (Doc 03 Main §13)
    // is a separate quota service, not yet built. Deferred.

    // Step 8: Idempotency check — same client_turn_id already persisted?
    const { data: existingTurn, error: existingTurnError } =
      await supabaseServer
        .from("tutor_messages")
        .select("id, role, message, status, created_at")
        .eq("conversation_id", conversation.id)
        .eq("client_turn_id", input.client_turn_id)
        .order("created_at", { ascending: true });

    if (existingTurnError) {
      logger.error(
        "TUTOR_RUNTIME",
        "idempotency_lookup_failed",
        "tutor_messages idempotency lookup failed; failing closed",
        { message: existingTurnError.message, code: existingTurnError.code },
      );
      // LISA-GCP-007: log metrics for idempotency lookup failure.
      // Pre-pipeline error — no model invocation, no injection/crisis scan.
      await logTurnMetrics({
        conversationId: conversation.id,
        turnOrdinal: 0,
        orchestrationDurationMs: 0,
        modelName: "idempotency_lookup_error",
        tokensIn: 0,
        tokensOut: 0,
        cacheHit: false,
        compactionRecommended: false,
        antiLeakTriggered: false,
        injectionDetected: false,
        crisisTriggered: false,
        crisisClassifierOutcome: null,
      });
      sendTutorError(res, "idempotency_lookup_failed");
      return;
    }

    let resumableStudentRow: { id: string } | null = null;
    if (existingTurn && existingTurn.length > 0) {
      const existingStudentMsg = existingTurn.find(
        (m) => (m as { role: string }).role === "student",
      ) as ExistingStudentTurnRow | undefined;
      const existingTutorMsg = existingTurn.find(
        (m) => (m as { role: string }).role === "tutor",
      ) as { id: string; message: string } | undefined;

      // The stored student text is the SANITIZED form (step 11 persists
      // `sanitized`, HTML-escaped), so a retry must be compared in that same
      // form — comparing raw input made every retry of "x < 5" a false 409.
      // @spec [Doc-03B_V4.1 §6.5 step 8, §14.3; CC Brief "Close the LISA Vertical" PR 1.2]
      if (
        existingStudentMsg &&
        existingStudentMsg.message !== sanitizeInput(input.message).sanitized
      ) {
        // LISA-GCP-007: log metrics for idempotency conflict.
        // Pre-pipeline error — message mismatch on same client_turn_id.
        await logTurnMetrics({
          conversationId: conversation.id,
          turnOrdinal: 0,
          orchestrationDurationMs: 0,
          modelName: "idempotency_conflict",
          tokensIn: 0,
          tokensOut: 0,
          cacheHit: false,
          compactionRecommended: false,
          antiLeakTriggered: false,
          injectionDetected: false,
          crisisTriggered: false,
          crisisClassifierOutcome: null,
        });
        sendTutorError(res, "idempotency_conflict");
        return;
      }

      if (existingStudentMsg && existingTutorMsg) {
        // LISA-FULL-007: idempotency replay — the submission state may have
        // changed since the original turn. Run ALL scan classes through the
        // mandatory output serializer, not just answer-leak.
        const replayPreSubmit = await isPreSubmitForSurface(
          conversation.source_surface,
          conversation.source_session_item_id,
          supabaseServer,
        );
        const replayCorrectAnswer = replayPreSubmit
          ? await getCorrectAnswerForScope(conversation.source_question_row_id)
          : ({ value: null, failed: false } as CorrectAnswerResult);
        const replayStudentMessages = await loadStudentMessagesForConversation(
          conversation.id,
        );
        const replayScanContext: OutputScanContext = {
          conversationId: conversation.id,
          studentId,
          isPreSubmit: replayPreSubmit,
          correctAnswer: replayCorrectAnswer.value,
          correctAnswerResolutionFailed: replayCorrectAnswer.failed,
          questionCanonicalId: conversation.source_question_canonical_id,
          studentMessages: replayStudentMessages,
        };
        const replaySerialized = await serializeTutorOutput(
          existingTutorMsg.message,
          replayScanContext,
        );

        // LISA-GCP-007: idempotency replay — cached response, not a new
        // inference. modelName="idempotency_replay" is a distinct marker so
        // rate metrics built on turn_metrics don't count replays as model
        // invocations. Tokens are zero (no model call). crisisClassifierOutcome
        // is null — the classifier ran on the original turn, not this replay.
        await logTurnMetrics({
          conversationId: conversation.id,
          turnOrdinal: 0,
          orchestrationDurationMs: 0,
          modelName: "idempotency_replay",
          tokensIn: 0,
          tokensOut: 0,
          cacheHit: true,
          compactionRecommended: false,
          antiLeakTriggered: replaySerialized.blocked,
          injectionDetected: false,
          crisisTriggered: false,
          crisisClassifierOutcome: null,
        });

        res.status(200).json({
          data: {
            conversation_id: conversation.id,
            message_id: existingTutorMsg.id,
            client_turn_id: input.client_turn_id,
            response: {
              content: replaySerialized.content,
              content_kind: "message",
              suggested_action: { type: "none", label: null },
              ui_hints: {
                show_accept_decline: false,
                allow_freeform_reply: true,
                suggested_chip: null,
              },
            },
            conversation_updated_at: conversation.updated_at,
          },
        });
        return;
      }
      // Student message persisted but no tutor reply: the first attempt
      // failed after step 11, crashed, or is still running. Per §14.3:
      //   - still running        → 409 idempotency_in_progress (retry, same id)
      //   - failed / stuck       → this attempt RE-OWNS the turn and resumes it
      // Resuming reuses the persisted student row (step 11 does not insert
      // again): the unique index on (student_id, conversation_id,
      // client_turn_id, role) rejects a second student row, which is what
      // made every "Try again" a 500 canonical_write_failed.
      // @spec [Doc-03B_V4.1 §6.5 step 8, §14.3; CC Brief "Close the LISA Vertical" PR 1.2]
      if (existingStudentMsg && !existingTutorMsg) {
        const claim = await claimStudentTurnForRetry(existingStudentMsg);
        if (claim === "error") {
          sendTutorError(res, "idempotency_lookup_failed");
          return;
        }
        if (claim === "in_progress") {
          sendTutorError(res, "idempotency_in_progress", {
            retry_after_ms: 2000,
          });
          return;
        }
        resumableStudentRow = { id: existingStudentMsg.id };
      }
    }

    // Step 9: Re-resolve scope — stored conversation scope is authoritative;
    // client_scope only supplements missing fields (§6.6).
    const clientScope = input.client_scope;
    const effectiveScope: ResolvedScopeRow = {
      source_session_id:
        conversation.source_session_id ??
        clientScope?.source_session_id ??
        null,
      source_session_item_id:
        conversation.source_session_item_id ??
        clientScope?.source_session_item_id ??
        null,
      source_question_row_id:
        conversation.source_question_row_id ??
        clientScope?.source_question_row_id ??
        null,
      source_question_canonical_id:
        conversation.source_question_canonical_id ??
        clientScope?.source_question_canonical_id ??
        null,
    };

    // Step 10: Input sanitization — length bound, escaping, injection scan.
    // Boundary markers (Doc 03A §12.3 Layer 3) are applied worker-side in
    // buildConversationMessages at prompt assembly time, covering ALL student
    // messages in the conversation — not just the current turn.
    const { sanitized } = sanitizeInput(input.message);
    const patternScan = scanForInjectionPatterns(sanitized);
    const signatureScan = await checkSignatureTable(sanitized);
    const injectionDetected = patternScan.detected || signatureScan.matched;
    // A resumed turn was already scanned and logged on its first attempt;
    // logging again would double-count a severity-5 abuse incident.
    if (injectionDetected && !resumableStudentRow) {
      // INV-03-13: logged, never acknowledged to the student.
      await logInjectionAttempt(
        studentId,
        conversation.id,
        patternScan.patterns,
        signatureScan.signatureId,
      );
    }

    // Crisis classifier runs on every student turn, no exceptions (INV-03-16).
    // Runs BEFORE orchestration — if crisis is detected, bypass model generation
    // entirely and return regional crisis resources (Doc-03_V3 §21).
    //
    // B1.5: runCrisisClassifier now returns crisis=true when Layer 2 fails AND
    // Layer 1 has zero crisis signatures (classifier_degraded_no_floor). This
    // routes into the §4.6 crisis-safe response rather than normal tutoring.
    // The catch block below handles unexpected infrastructure failure the same
    // way — fail closed with crisis-safe response.
    let crisisResult: Awaited<ReturnType<typeof runCrisisClassifier>>;
    try {
      crisisResult = await runCrisisClassifier(sanitized);
    } catch (crisisErr: unknown) {
      // B1.5: Unexpected infrastructure failure in the entire classifier
      // pipeline. We cannot determine Layer 1 state, so fail closed — return
      // crisis-safe response rather than proceeding to normal generation.
      // The student receives regional crisis resources; the review case is
      // created. This is strictly safer than the previous behavior (proceed
      // to normal generation + review case after the fact).
      // @spec [CR-03C-V3-01 §3.4, Doc-03_V3 §21.2, B1.5]
      logger.error(
        "TUTOR_RUNTIME",
        "crisis_classifier_infrastructure_error",
        "crisis classifier infrastructure error; failing closed with crisis-safe response",
        {
          message:
            crisisErr instanceof Error ? crisisErr.message : String(crisisErr),
          conversationId: conversation.id,
        },
      );
      crisisResult = {
        crisis: true,
        source: "infrastructure_failure",
        category: "crisis",
        signatureId: null,
        modelConfidence: null,
        forceReview: true,
      };
    }

    // Step 11: Persist student message — or, on a resumed turn, reuse the row
    // step 8 already re-claimed (set back to 'pending').
    const { data: studentMessageRow, error: studentMessageError } =
      resumableStudentRow
        ? { data: resumableStudentRow, error: null }
        : await supabaseServer
            .from("tutor_messages")
            .insert({
              conversation_id: conversation.id,
              student_id: studentId,
              role: "student",
              content_kind: contentKind,
              message: sanitized,
              source_session_id: effectiveScope.source_session_id,
              source_session_item_id: effectiveScope.source_session_item_id,
              source_question_row_id: effectiveScope.source_question_row_id,
              source_question_canonical_id:
                effectiveScope.source_question_canonical_id,
              client_turn_id: input.client_turn_id,
              injection_flag: injectionDetected,
              injection_signature_matched: signatureScan.signatureId,
              status: "pending",
            })
            .select("id, created_at")
            .single();

    if (isClientTurnUniqueViolation(studentMessageError)) {
      sendClientTurnUniqueViolation(res, conversation.id, "student");
      return;
    }
    if (studentMessageError || !studentMessageRow) {
      logger.error(
        "TUTOR_RUNTIME",
        "student_message_write_failed",
        "Failed to persist student tutor_messages row",
        {
          message: studentMessageError?.message,
          code: studentMessageError?.code,
        },
      );
      // LISA-GCP-007: log metrics for student message write failure.
      await logTurnMetrics({
        conversationId: conversation.id,
        turnOrdinal: 0,
        orchestrationDurationMs: 0,
        modelName: "error:student_message_write_failed",
        tokensIn: 0,
        tokensOut: 0,
        cacheHit: false,
        compactionRecommended: false,
        antiLeakTriggered: false,
        injectionDetected,
        crisisTriggered: crisisResult.crisis,
        crisisClassifierOutcome: crisisResult.crisis
          ? crisisResult.source
          : null,
      });
      sendTutorError(res, "canonical_write_failed");
      return;
    }

    persistedStudentMessageId = studentMessageRow.id as string;

    // Set title on first student message (§4.2: first student message becomes
    // the title, truncated to 60 chars, immutable after initial set).
    if (conversation.title === "New session" || conversation.title === null) {
      const titleText = input.message.slice(0, 60);
      await supabaseServer
        .from("tutor_conversations")
        .update({ title: titleText })
        .eq("id", conversation.id);
    }

    // Crisis path: bypass model generation entirely; respond with the
    // regional crisis resource and flag for the safety review queue.
    if (crisisResult.crisis) {
      const flagResult: FlagForReviewResult = await flagConversationForReview(
        conversation.id,
        studentId,
        crisisResult.source,
        crisisResult.signatureId,
        crisisResult.modelConfidence,
        crisisResult.category,
      );

      // Set crisis_paused_at — conversation is now paused for tutoring.
      // The student must explicitly resume before sending more messages.
      //
      // @spec [CC Brief "LISA Session Lifecycle" §5.4; owner ruling 2026-09-24]
      // | @implemented [2026-09-24] | plain English: the response reports
      // the pause the database actually holds. This write's result was never
      // checked, so a failed write still answered `crisis_paused: true` and
      // the client rendered a pause the server did not have — /resume then
      // 409s `conversation_not_paused`. The row is read back, because
      // PostgREST reports no error when a filtered UPDATE matches zero rows.
      // A failed pause does NOT fail the turn: the review case is already
      // persisted and the student still receives the crisis resources below;
      // what they lose is the pause, and they are told the truth about it.
      // Logged at ERROR — a silent miss on a safety-path write is how this
      // class of defect hides.
      const { data: pausedRow, error: pauseError } = await supabaseServer
        .from("tutor_conversations")
        .update({ crisis_paused_at: new Date().toISOString() })
        .eq("id", conversation.id)
        .select("crisis_paused_at")
        .maybeSingle();
      const crisisPausedAt: string | null =
        !pauseError &&
        pausedRow &&
        typeof pausedRow.crisis_paused_at === "string"
          ? pausedRow.crisis_paused_at
          : null;
      if (crisisPausedAt === null) {
        logger.error(
          "TUTOR_RUNTIME",
          "crisis_pause_write_failed",
          "crisis turn could not pause the conversation; responding unpaused",
          {
            conversationId: conversation.id,
            caseId: flagResult.caseId,
            message: pauseError?.message,
            code: pauseError?.code,
            rowReturned: pausedRow !== null,
          },
        );
      }

      // ── PagerDuty-style notification policy ──
      // @spec [CC Brief "LISA Session Lifecycle" §1]
      const THROTTLE_WINDOW_MS = 2 * 60 * 1000;

      const { data: priorEvents } = flagResult.isNewCase
        ? { data: [] as Array<{ category: string; created_at: string }> }
        : await supabaseServer
            .from("crisis_review_events")
            .select("category, created_at")
            .eq("case_id", flagResult.caseId)
            .eq("event_type", "signal_received");

      const { shouldNotify, suppressionReason } = evaluateNotificationPolicy({
        isNewCase: flagResult.isNewCase,
        caseStatus: flagResult.caseStatus,
        currentCategory: crisisResult.category,
        priorEvents: (priorEvents ?? []) as Array<{
          category: string;
          created_at: string;
        }>,
        nowMs: Date.now(),
        throttleWindowMs: THROTTLE_WINDOW_MS,
      });

      // Insert crisis_review_event for this signal.
      await supabaseServer.from("crisis_review_events").insert({
        case_id: flagResult.caseId,
        conversation_id: conversation.id,
        student_id: studentId,
        event_type: "signal_received",
        message_id: studentMessageRow.id,
        source: crisisResult.source,
        signature_id: crisisResult.signatureId,
        model_confidence: crisisResult.modelConfidence,
        category: crisisResult.category,
        notification_suppressed: !shouldNotify,
        suppression_reason: suppressionReason,
      });

      // Every notification decision must leave a trace — a safety
      // notification that produces no log cannot be verified.
      if (shouldNotify) {
        logger.warn(
          "TUTOR_RUNTIME",
          "crisis_notification_dispatching",
          "notification policy: dispatching ops alert",
          {
            caseId: flagResult.caseId,
            conversationId: conversation.id,
            source: crisisResult.source,
            isNewCase: flagResult.isNewCase,
          },
        );
        await notifyCrisisEvent({
          caseId: flagResult.caseId,
          conversationId: conversation.id,
          source: crisisResult.source,
          slaDeadline: flagResult.slaDeadline,
          timestamp: new Date().toISOString(),
        });
      } else {
        logger.warn(
          "TUTOR_RUNTIME",
          "crisis_notification_suppressed",
          "notification policy: alert suppressed",
          {
            caseId: flagResult.caseId,
            conversationId: conversation.id,
            suppressionReason,
          },
        );
      }

      // Mark student message as completed — crisis detection is a valid response.
      await supabaseServer
        .from("tutor_messages")
        .update({ status: "completed" })
        .eq("id", studentMessageRow.id);

      const { data: profileRow } = await supabaseServer
        .from("profiles")
        .select("country_code")
        .eq("id", studentId)
        .maybeSingle();
      // W3-3: resources follow the student's billing country (Doc 03 §4.6).
      // Unknown still resolves to the named default — and that is the one
      // case worth an alert: a student in crisis may have been given numbers
      // that do not work where they are. The student id is logged (digested
      // by the logger); the crisis content never is.
      const crisisCountry = resolveCrisisCountry(
        profileRow?.country_code as string | null | undefined,
      );
      if (crisisCountry.defaulted) {
        logger.warn(
          "TUTOR_RUNTIME",
          "crisis_country_defaulted",
          "Crisis resources resolved to the default country: this student's country is unknown or unsupported",
          {
            studentId,
            conversationId: conversation.id,
            category: crisisResult.category,
            reason: crisisCountry.reason,
            defaultCountry: crisisCountry.country,
          },
        );
      }
      const crisisContent = getCrisisResponse(
        crisisCountry.country,
        crisisResult.category,
      );

      const { data: crisisMessageRow, error: crisisMessageError } =
        await supabaseServer
          .from("tutor_messages")
          .insert({
            conversation_id: conversation.id,
            student_id: studentId,
            role: "tutor",
            content_kind: "message",
            message: crisisContent,
            source_session_id: effectiveScope.source_session_id,
            source_session_item_id: effectiveScope.source_session_item_id,
            source_question_row_id: effectiveScope.source_question_row_id,
            source_question_canonical_id:
              effectiveScope.source_question_canonical_id,
            client_turn_id: input.client_turn_id,
          })
          .select("id")
          .single();

      if (crisisMessageError || !crisisMessageRow) {
        logger.error(
          "TUTOR_RUNTIME",
          "crisis_message_write_failed",
          "Failed to persist crisis-path tutor message",
          {
            message: crisisMessageError?.message,
            code: crisisMessageError?.code,
          },
        );
        // LISA-GCP-007: log metrics for crisis message write failure.
        await logTurnMetrics({
          conversationId: conversation.id,
          turnOrdinal: 0,
          orchestrationDurationMs: 0,
          modelName: "error:crisis_message_write_failed",
          tokensIn: 0,
          tokensOut: 0,
          cacheHit: false,
          compactionRecommended: false,
          antiLeakTriggered: false,
          injectionDetected,
          crisisTriggered: true,
          crisisClassifierOutcome: crisisResult.source,
        });
        sendTutorError(res, "canonical_write_failed");
        return;
      }

      // LISA-FULL-007: crisis response passes through the serializer for
      // static-gate compliance. isServerAuthored=true skips model-safety
      // scans — crisis resources are server-authored and safe by construction.
      const crisisScanContext: OutputScanContext = {
        conversationId: conversation.id,
        studentId,
        isPreSubmit: false,
        correctAnswer: null,
        correctAnswerResolutionFailed: false,
        questionCanonicalId: conversation.source_question_canonical_id,
        isServerAuthored: true,
      };
      const crisisSerialized = await serializeTutorOutput(
        crisisContent,
        crisisScanContext,
      );

      // Log turn metrics for the crisis path — previously skipped, creating
      // an observability gap where crisis turns had no metrics row.
      // orchestrationDurationMs=0 because no LLM orchestration occurs on crisis.
      // modelName: "crisis_bypass" — no model was invoked (crisis-safe response
      // is server-authored, not model-generated).
      // @spec [CR-03C-V3-01 §3.4, Doc-03A_V1 §11.5]
      await logTurnMetrics({
        conversationId: conversation.id,
        turnOrdinal: 0,
        orchestrationDurationMs: 0,
        modelName: "crisis_bypass",
        tokensIn: 0,
        tokensOut: 0,
        cacheHit: false,
        compactionRecommended: false,
        antiLeakTriggered: false,
        injectionDetected,
        crisisTriggered: true,
        crisisClassifierOutcome: crisisResult.source,
      });

      res.status(200).json({
        data: {
          conversation_id: conversation.id,
          message_id: crisisMessageRow.id,
          client_turn_id: input.client_turn_id,
          response: {
            content: crisisSerialized.content,
            content_kind: "message",
            crisis_category: crisisResult.category,
            suggested_action: { type: "none", label: null },
            ui_hints: {
              show_accept_decline: false,
              allow_freeform_reply: false,
              suggested_chip: null,
            },
          },
          crisis_paused: crisisPausedAt !== null,
          crisis_paused_at: crisisPausedAt,
          conversation_updated_at: new Date().toISOString(),
        },
      });
      return;
    }

    // CR-03C-V3-01 §3.4 condition 3: Layer 2 failed, turn proceeds but
    // force-enqueued to the §21.3 review queue with classifier_degraded.
    if (!crisisResult.crisis && crisisResult.forceReview) {
      const degradedResult = await flagConversationForReview(
        conversation.id,
        studentId,
        "classifier_degraded",
        null,
        null,
      );
      // Degraded path always notifies — it's a force-review enqueue.
      await notifyCrisisEvent({
        caseId: degradedResult.caseId,
        conversationId: conversation.id,
        source: "classifier_degraded",
        slaDeadline: degradedResult.slaDeadline,
        timestamp: new Date().toISOString(),
      });
    }

    // Step 12: Persist instructional assignment — §6.5 step 12, §1.4 blocking.
    // Policy-assignment persistence is blocking per §1.4. If this write fails,
    // the turn is not treated as successful.
    // Values match Doc 03A §18.4 CHECK constraints: policy_variant ∈
    // {concise,scaffolded,socratic,strategy_first}, emotional_register ∈
    // {default,elite,recovery,sprint,calm}. V1 default per §11.4 is
    // scaffolded/default — mode transitions are not yet implemented.
    // @spec [Doc-03B_V4.1 §6.5 step 12, Doc-03A_V1 §11, Doc-03B_V4.1 §1.4]
    const instructionAssignmentResult = await persistInstructionAssignment({
      conversationId: conversation.id,
      studentId,
      relatedMessageId: studentMessageRow.id,
      sourceSessionId: effectiveScope.source_session_id,
      sourceSessionItemId: effectiveScope.source_session_item_id,
      sourceQuestionRowId: effectiveScope.source_question_row_id,
      policyFamily: "instructional_tutor",
      policyVariant: "scaffolded",
      policyVersion: "1.0",
      promptVersion: null,
      assignmentMode: "deterministic",
      assignmentKey: `${studentId}:${conversation.entry_mode}`,
      // emotional_register: omitted → DB DEFAULT 'default' applies (§18.4)
      reasonSnapshot: { reason: "default_deterministic_assignment" },
    });
    if (!instructionAssignmentResult.ok) {
      // LISA-GCP-007: log metrics for instruction assignment failure.
      await logTurnMetrics({
        conversationId: conversation.id,
        turnOrdinal: 0,
        orchestrationDurationMs: 0,
        modelName: "error:instruction_assignment_failed",
        tokensIn: 0,
        tokensOut: 0,
        cacheHit: false,
        compactionRecommended: false,
        antiLeakTriggered: false,
        injectionDetected,
        crisisTriggered: false,
        crisisClassifierOutcome: crisisResult.forceReview
          ? "classifier_degraded"
          : "no_crisis",
      });
      await supabaseServer
        .from("tutor_messages")
        .update({ status: "failed" })
        .eq("id", studentMessageRow.id);

      sendTutorError(res, "canonical_write_failed");
      return;
    }
    const assignmentId = instructionAssignmentResult.assignmentId;

    // Step 13: Resolve pre-submit state and correct answer BEFORE building the
    // envelope. Two consumers, two scopes:
    //   - BFF output scan (step 15): needs the real correct_answer to detect
    //     leaks in the model response. Stays BFF-local, never crosses the wire
    //     pre-submit.
    //   - Worker prompt (step 14): receives is_post_submit (server-derived
    //     boolean) and correct_answer (null pre-submit, real post-submit).
    // @spec [INV-03-04, Doc-03B_V4.1 §6.5 step 13-15, Doc-03D_V1.2 §6.3,
    //        LISA-FULL-007]
    const preSubmit = await isPreSubmitForSurface(
      conversation.source_surface,
      effectiveScope.source_session_item_id,
      supabaseServer,
    );
    const isPostSubmit = !preSubmit;

    // Fetch correct_answer unconditionally when a question row exists.
    // Pre-submit: needed BFF-local for answer-aware leak detection (step 15).
    // Post-submit: forwarded on the wire so the worker prompt can explain it.
    // The envelope gate (tutor-context.ts) decides what reaches the wire:
    //   correct_answer: isPostSubmit ? correctAnswer : null
    // @spec [Doc-03B_V4.1 §6.5 step 13-15, Doc-03D_V1.2 §6.3]
    const correctAnswerResult = effectiveScope.source_question_row_id
      ? await getCorrectAnswerForScope(effectiveScope.source_question_row_id)
      : ({ value: null, failed: false } as CorrectAnswerResult);

    // Build context envelope (Doc 03A §5.4). Anti-leak: correct_answer is
    // null on the wire pre-submit (Doc 03D §6.3). The real value stays
    // BFF-local for the output scan; the envelope carries is_post_submit
    // so the worker gates on a server-derived boolean, not on field presence.
    const recentMessages = await getRecentMessages(conversation.id);
    const envelope = await resolveFullEnvelope({
      conversationId: conversation.id,
      studentId,
      entryMode: conversation.entry_mode,
      sourceSurface: conversation.source_surface,
      sourceSessionId: effectiveScope.source_session_id,
      sourceSessionItemId: effectiveScope.source_session_item_id,
      sourceQuestionRowId: effectiveScope.source_question_row_id,
      recentMessages,
      runtimeLimits: { maxOutputTokens: 2048, timeoutMs: 30_000 },
      correctAnswer: correctAnswerResult.value,
      isPostSubmit,
    });

    await logContextResolution({
      conversationId: conversation.id,
      turnOrdinal: 0,
      contextVersion: "1.0",
      memorySummariesCount: envelope.memory_summaries.length,
      recentMessagesCount: envelope.recent_messages.length,
      masterySnapshotPresent:
        envelope.student_learning_context.mastery_snapshot !== null,
      frictionSignalsPresent: true,
      scopeType: envelope.resolved_scope.source_question_row_id
        ? "question"
        : envelope.resolved_scope.source_session_id
          ? "session"
          : "general",
    });

    // The clock starts before the Model Armor input scan so that
    // turn_metrics.orchestration_duration_ms includes both scans — that is
    // the before/after latency measurement for W3-1.
    const turnStartedAt = Date.now();

    // Step 13b: Model Armor input scan (closure plan W3-1 — an additional
    // layer, not in docs/Spec; see the tutor-model-armor.ts header). Runs on
    // the student's message as typed, immediately before the worker call. The crisis path returned above and never reaches this
    // line — Model Armor cannot suppress a crisis response. Fail open: a
    // skipped scan (logged at ERROR) lets the turn proceed. A block skips the
    // model entirely and answers with the neutral substitution.
    // @spec [closure plan W3-1; owner ruling 2026-09-24] | @implemented 2026-09-24
    const armorInput = await scanWithModelArmor(
      "input",
      input.message,
      conversation.id,
    );

    // Step 13c (closure plan W3-5, owner ruling 2026-09-24): an input block on
    // Model Armor's `dangerous` filter may be a crisis the Layer 1/Layer 2
    // classifier missed. Open a review case and alert so a human sees it
    // within SLA — but the student still gets the neutral block copy, not the
    // crisis template: the filter is broad and not clinical, and firing crisis
    // resources on it would undercut the deterministic classifier design.
    // Alerts only on a NEW case; an open case was already alerted. A failed
    // flag is logged at ERROR and the block copy is still delivered — a 500
    // here would leave the student with an error AND no review case.
    // @spec [closure plan W3-5; SCL-142 (PROPOSED)] | @implemented 2026-09-24
    if (
      armorInput.kind === "blocked" &&
      armorInput.matchedFilters.includes("rai:dangerous")
    ) {
      try {
        const armorFlag = await flagConversationForReview(
          conversation.id,
          studentId,
          "model_armor_dangerous",
          null,
          null,
        );
        if (armorFlag.isNewCase) {
          await notifyCrisisEvent({
            caseId: armorFlag.caseId,
            conversationId: conversation.id,
            source: "model_armor_dangerous",
            slaDeadline: armorFlag.slaDeadline,
            timestamp: new Date().toISOString(),
          });
        } else {
          logger.warn(
            "TUTOR_RUNTIME",
            "model_armor_crisis_case_exists",
            "dangerous input block on a conversation with an active review case; no new alert",
            {
              caseId: armorFlag.caseId,
              caseStatus: armorFlag.caseStatus,
              conversationId: conversation.id,
            },
          );
        }
      } catch (err: unknown) {
        logger.error(
          "TUTOR_RUNTIME",
          "model_armor_crisis_flag_failed",
          "dangerous input block could not open a review case; the block copy is still delivered",
          err instanceof Error ? err : undefined,
          { conversationId: conversation.id },
        );
      }
    }

    // Step 14: Invoke orchestration via the real worker boundary
    // (LISA-FULL-001 item 1). orchestrateTurn posts to the worker, applies
    // the BFF-side scanAndSubstitute (the anti-leak chokepoint per INV-03-04),
    // and returns a TutorResult — never throws. Not called when the input
    // scan blocked: the reply is the server-authored substitution instead.
    const orchestrationResult =
      armorInput.kind === "blocked"
        ? ({
            ok: true,
            value: {
              response: {
                content: MODEL_ARMOR_SUBSTITUTION,
                content_kind: "message",
                suggested_action: { type: "none", label: null },
                ui_hints: {
                  show_accept_decline: false,
                  allow_freeform_reply: true,
                  suggested_chip: null,
                },
              },
              question_links: [],
              instruction_exposures: [],
              orchestration_meta: {
                model_name: "model_armor_input_blocked",
                prompt_version: "none",
                cache_used: false,
                compaction_recommended: false,
              },
              learner_observation: null,
            },
          } as const)
        : await orchestrateTurn(envelope, preSubmit, correctAnswerResult.value);

    if (!orchestrationResult.ok) {
      logger.error(
        "TUTOR_RUNTIME",
        "orchestration_failed",
        "orchestrateTurn returned failure; turn is recoverable via retry",
        {
          errorCode: orchestrationResult.errorCode,
          conversationId: conversation.id,
        },
      );
      // LISA-GCP-007: log metrics for orchestration failure.
      await logTurnMetrics({
        conversationId: conversation.id,
        turnOrdinal: 0,
        orchestrationDurationMs: Date.now() - turnStartedAt,
        modelName: "error:orchestration_failed",
        tokensIn: 0,
        tokensOut: 0,
        cacheHit: false,
        compactionRecommended: false,
        antiLeakTriggered: false,
        injectionDetected,
        crisisTriggered: false,
        crisisClassifierOutcome: crisisResult.forceReview
          ? "classifier_degraded"
          : "no_crisis",
      });
      // Mark student message as failed — orchestration did not produce a reply.
      await supabaseServer
        .from("tutor_messages")
        .update({ status: "failed" })
        .eq("id", studentMessageRow.id);

      sendTutorError(res, orchestrationResult.errorCode, {
        retry_after_ms: 2000,
        failure_layer: "orchestrator",
      });
      return;
    }

    const orchestration = orchestrationResult.value;
    const tutorResponse = orchestration.response.content;

    // Step 14b: Model Armor output scan (closure plan W3-1) on LISA's reply,
    // before the serializer. Additional to the INV-03-12 scans in
    // serializeTutorOutput, which still run on every reply and fail closed. The verdict is carried
    // into serializeTutorOutput as `armorOutputBlocked`, which substitutes.
    // Not run when the input scan blocked — the reply is then server copy,
    // not model output. Fail open, as for the input scan.
    // @spec [closure plan W3-1; owner ruling 2026-09-24] | @implemented 2026-09-24
    const armorOutput =
      armorInput.kind === "blocked"
        ? null
        : await scanWithModelArmor("output", tutorResponse, conversation.id);
    const armorOutputBlocked = armorOutput?.kind === "blocked";

    // Step 15: LISA-FULL-007 — mandatory output serializer (belt-and-suspenders).
    // The primary anti-leak chokepoint is orchestrateTurn's scanAndSubstitute
    // (BFF boundary) + the worker's own hasAnswerLeak scan. This route-layer
    // serializer runs ALL 5 scan classes (Doc 03B §16.3) as defense-in-depth,
    // including the 3 NEW scan classes (canonical ID, system-prompt, persona).
    // @spec [Doc-03B_V2 §16.3-16.5, INV-03-04, INV-03-09, INV-03-10, INV-03-12,
    //        INV-03-13, INV-03-17]
    const appendScanContext: OutputScanContext = {
      conversationId: conversation.id,
      studentId,
      isPreSubmit: preSubmit,
      correctAnswer: correctAnswerResult.value,
      correctAnswerResolutionFailed: correctAnswerResult.failed,
      questionCanonicalId: effectiveScope.source_question_canonical_id,
      studentMessages: envelope.recent_messages
        .filter((m) => m.role === "student")
        .map((m) => m.message),
      armorOutputBlocked,
      // An input-blocked reply is the server-authored substitution.
      isServerAuthored: armorInput.kind === "blocked",
    };
    const serialized = await serializeTutorOutput(
      tutorResponse,
      appendScanContext,
    );
    const safeContent = serialized.content;
    // Anti-leak scan classes only: a Model Armor block is logged by the
    // scanner (model_armor_scan_blocked), not counted as an anti-leak hit.
    const scans = serialized.scanResults;
    const antiLeakTriggered =
      scans.answerLeakDetected ||
      scans.canonicalIdLeakDetected ||
      scans.systemPromptLeakDetected ||
      scans.personaViolationDetected ||
      scans.correctAnswerGateBlocked;

    // Step 16: Persist tutor message.
    const { data: tutorMessageRow, error: tutorMessageError } =
      await supabaseServer
        .from("tutor_messages")
        .insert({
          conversation_id: conversation.id,
          student_id: studentId,
          role: "tutor",
          content_kind: orchestration.response.content_kind,
          message: safeContent,
          source_session_id: effectiveScope.source_session_id,
          source_session_item_id: effectiveScope.source_session_item_id,
          source_question_row_id: effectiveScope.source_question_row_id,
          source_question_canonical_id:
            effectiveScope.source_question_canonical_id,
          client_turn_id: input.client_turn_id,
        })
        .select("id")
        .single();

    if (isClientTurnUniqueViolation(tutorMessageError)) {
      sendClientTurnUniqueViolation(res, conversation.id, "tutor");
      return;
    }

    if (tutorMessageError || !tutorMessageRow) {
      logger.error(
        "TUTOR_RUNTIME",
        "tutor_message_write_failed",
        "Failed to persist tutor tutor_messages row",
        {
          message: tutorMessageError?.message,
          code: tutorMessageError?.code,
        },
      );
      // LISA-GCP-007: log metrics for tutor message write failure.
      await logTurnMetrics({
        conversationId: conversation.id,
        turnOrdinal: 0,
        orchestrationDurationMs: Date.now() - turnStartedAt,
        modelName: "error:tutor_message_write_failed",
        tokensIn: 0,
        tokensOut: 0,
        cacheHit: false,
        compactionRecommended: false,
        antiLeakTriggered,
        injectionDetected,
        crisisTriggered: false,
        crisisClassifierOutcome: crisisResult.forceReview
          ? "classifier_degraded"
          : "no_crisis",
      });
      // Tutor reply failed to persist — mark student message as failed.
      await supabaseServer
        .from("tutor_messages")
        .update({ status: "failed" })
        .eq("id", studentMessageRow.id);

      sendTutorError(res, "canonical_write_failed");
      return;
    }

    // Mark student message as completed — orchestration succeeded and tutor
    // reply persisted.
    await supabaseServer
      .from("tutor_messages")
      .update({ status: "completed" })
      .eq("id", studentMessageRow.id);

    // Step 17: Persist question links, if any.
    if (orchestration.question_links.length > 0) {
      const { error: linksError } = await supabaseServer
        .from("tutor_question_links")
        .insert(
          orchestration.question_links.map((link) => ({
            conversation_id: conversation.id,
            related_message_id: tutorMessageRow.id,
            source_question_row_id: link.source_question_row_id,
            source_question_canonical_id: link.source_question_canonical_id,
            related_question_row_id: link.related_question_row_id,
            related_question_canonical_id: link.related_question_canonical_id,
            relationship_type: link.relationship_type,
            difficulty_delta: link.difficulty_delta,
            reason_code: link.reason_code,
            link_snapshot: link.link_snapshot,
          })),
        );
      if (linksError) {
        logger.warn(
          "TUTOR_RUNTIME",
          "question_links_write_failed",
          "Failed to persist tutor_question_links; turn proceeds",
          { message: linksError.message, code: linksError.code },
        );
      }
    }

    // Step 18: Persist instruction exposures, if any.
    if (orchestration.instruction_exposures.length > 0) {
      const { error: exposuresError } = await supabaseServer
        .from("tutor_instruction_exposures")
        .insert(
          orchestration.instruction_exposures.map((exposure) => ({
            conversation_id: conversation.id,
            related_message_id: tutorMessageRow.id,
            exposure_type: exposure.exposure_type,
            content_variant_key: exposure.content_variant_key,
            content_version: exposure.content_version,
            rendered_difficulty: exposure.rendered_difficulty,
            hint_depth: exposure.hint_depth,
            tone_style: exposure.tone_style,
            sequence_ordinal: exposure.sequence_ordinal,
          })),
        );
      if (exposuresError) {
        logger.warn(
          "TUTOR_RUNTIME",
          "instruction_exposures_write_failed",
          "Failed to persist tutor_instruction_exposures; turn proceeds",
          { message: exposuresError.message, code: exposuresError.code },
        );
      }
    }

    // Compute classifier outcome for normal (non-crisis) path.
    // crisisResult.crisis is false here (crisis path returned earlier).
    // If forceReview is true, Layer 2 failed but Layer 1 had signatures —
    // the turn proceeded but was force-enqueued (classifier_degraded).
    // @spec [CR-03C-V3-01 §3.4]
    const normalPathOutcome: string = crisisResult.forceReview
      ? "classifier_degraded"
      : "no_crisis";

    await logTurnMetrics({
      conversationId: conversation.id,
      turnOrdinal: 0,
      orchestrationDurationMs: Date.now() - turnStartedAt,
      modelName: orchestration.orchestration_meta.model_name,
      tokensIn: 0,
      tokensOut: 0,
      cacheHit: orchestration.orchestration_meta.cache_used,
      compactionRecommended:
        orchestration.orchestration_meta.compaction_recommended,
      antiLeakTriggered,
      injectionDetected,
      crisisTriggered: false,
      crisisClassifierOutcome: normalPathOutcome,
    });

    await supabaseServer
      .from("tutor_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversation.id);

    // Step 19: Return success response (§6.7).
    res.status(200).json({
      data: {
        conversation_id: conversation.id,
        message_id: tutorMessageRow.id,
        client_turn_id: input.client_turn_id,
        response: {
          content: safeContent,
          content_kind: orchestration.response.content_kind,
          suggested_action: orchestration.response.suggested_action,
          ui_hints: orchestration.response.ui_hints,
        },
        conversation_updated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error(
      "TUTOR_RUNTIME",
      "append_turn_error",
      "Unexpected error in POST /messages",
      err instanceof Error ? err : undefined,
    );
    // LISA-GCP-007: best-effort metrics for catch-all error.
    // Variables from the pipeline (conversation, injectionDetected, etc.)
    // may not exist depending on where the throw occurred. The logTurnMetrics
    // call itself is fire-and-forget, so a secondary failure is swallowed.
    try {
      const catchConvoId =
        typeof input?.conversation_id === "string"
          ? input.conversation_id
          : "unknown";
      await logTurnMetrics({
        conversationId: catchConvoId,
        turnOrdinal: 0,
        orchestrationDurationMs: 0,
        modelName: "error:unexpected",
        tokensIn: 0,
        tokensOut: 0,
        cacheHit: false,
        compactionRecommended: false,
        antiLeakTriggered: false,
        injectionDetected: false,
        crisisTriggered: false,
        crisisClassifierOutcome: null,
      });
    } catch (metricsErr: unknown) {
      // Metrics logging itself failed — swallow so the error response sends.
      logger.warn(
        "TUTOR_RUNTIME",
        "catch_all_metrics_failed",
        "Failed to log turn metrics in catch-all error handler",
        {
          error:
            metricsErr instanceof Error
              ? metricsErr.message
              : String(metricsErr),
        },
      );
    }
    // Release the turn: a student row left 'pending' would make every retry
    // wait out the in-progress timeout (§14.3) before it could resume.
    // @spec [Doc-03B_V4.1 §14.3 "Retry after failed handler"]
    if (persistedStudentMessageId) {
      const { error: releaseError } = await supabaseServer
        .from("tutor_messages")
        .update({ status: "failed" })
        .eq("id", persistedStudentMessageId);
      if (releaseError) {
        logger.warn(
          "TUTOR_RUNTIME",
          "turn_release_failed",
          "could not mark student message failed after an unexpected error; retry waits for the in-progress timeout",
          { code: releaseError.code },
        );
      }
    }
    sendTutorError(res, "orchestration_failed");
  }
});

// ============================================================================
// GET /conversations/:conversationId — §7 Replay
// ============================================================================

router.get(
  "/conversations/:conversationId",
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      sendTutorError(res, "unauthenticated");
      return;
    }
    const studentId = req.user.id;
    if (await denyIfNotEntitled(studentId, res)) return;

    const parsedQuery = fetchConversationQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      sendTutorError(res, "invalid_input", parsedQuery.error.flatten());
      return;
    }
    const messageLimit = parsedQuery.data.message_limit ?? 50;

    try {
      const conversation = await loadOwnedConversation(
        req.params.conversationId,
        studentId,
      );
      if (!conversation) {
        sendTutorError(res, "conversation_not_found");
        return;
      }

      const ordered = await loadMessagesForReplay(
        conversation.id,
        messageLimit,
        parsedQuery.data.before_message_id,
      );
      if (ordered === null) {
        sendTutorError(res, "canonical_write_failed");
        return;
      }

      // LISA-FULL-007: Defense-in-depth (§16 Layer 4 mirror) — re-apply ALL
      // 5 scan classes via the mandatory output serializer on read. The per-item
      // submission state may have changed since write time. Tutor-authored
      // messages only; student turns pass through.
      let replayCorrectAnswerResult: CorrectAnswerResult | null = null;
      const safeMessages = [];
      // Collect student messages as we iterate for the echo exemption.
      // Each tutor row sees only student messages that precede it.
      const priorStudentMessages: string[] = [];

      for (const row of ordered) {
        if (row.role !== "tutor") {
          if (row.role === "student") {
            priorStudentMessages.push(row.message);
          }
          safeMessages.push({
            message_id: row.id,
            role: row.role,
            content_kind: row.content_kind,
            message: row.message,
            created_at: row.created_at,
            client_turn_id: row.client_turn_id,
          });
          continue;
        }

        const rowPreSubmit = await isPreSubmitForSurface(
          conversation.source_surface,
          row.source_session_item_id ?? conversation.source_session_item_id,
          supabaseServer,
        );
        if (replayCorrectAnswerResult === null) {
          replayCorrectAnswerResult = await getCorrectAnswerForScope(
            conversation.source_question_row_id,
          );
        }
        const rowScanContext: OutputScanContext = {
          conversationId: conversation.id,
          studentId,
          isPreSubmit: rowPreSubmit,
          correctAnswer: replayCorrectAnswerResult.value,
          correctAnswerResolutionFailed: replayCorrectAnswerResult.failed,
          questionCanonicalId: conversation.source_question_canonical_id,
          studentMessages: priorStudentMessages,
        };
        const rowSerialized = await serializeTutorOutput(
          row.message,
          rowScanContext,
        );

        safeMessages.push({
          message_id: row.id,
          role: row.role,
          content_kind: row.content_kind,
          message: rowSerialized.content,
          created_at: row.created_at,
          client_turn_id: row.client_turn_id,
        });
      }

      // @spec [Doc-03B_V4.1 §7.5 + fields beyond it: title, crisis_paused_at, surface come from CC Brief "LISA Session Lifecycle" and CC Brief "Close the LISA Vertical" PR 1.1 — not in §7.5; spec gap reported to owner]
      // Typed against the shared `conversationDetailSchema`: the chat page
      // derives its paused state from `crisis_paused_at` and its header from
      // `title`, so omitting either rendered a paused conversation as live
      // after every reload. Legacy `closed`/`abandoned` rows (DB CHECK admits
      // them; no code writes them) are reported as `ended` — both refuse new
      // turns (409), and the client's contract has no third terminal state.
      const detail: ConversationDetail = {
        conversation: {
          conversation_id: conversation.id,
          entry_mode: conversation.entry_mode,
          source_surface: conversation.source_surface,
          surface: conversation.surface,
          status: conversation.status === "active" ? "active" : "ended",
          title: conversation.title,
          crisis_paused_at: conversation.crisis_paused_at,
          resolved_scope: {
            source_session_id: conversation.source_session_id,
            source_session_item_id: conversation.source_session_item_id,
            source_question_row_id: conversation.source_question_row_id,
            source_question_canonical_id:
              conversation.source_question_canonical_id,
          },
          created_at: conversation.created_at,
          updated_at: conversation.updated_at,
          closed_at: conversation.closed_at,
        },
        messages: safeMessages,
        pagination: {
          has_more: ordered.length === messageLimit,
          // `ordered` is oldest-first; the pagination cursor for "older
          // messages" is the earliest (first) row in this page.
          next_cursor: ordered.length > 0 ? ordered[0].id : null,
        },
      };
      res.status(200).json({ data: detail });
    } catch (err) {
      logger.error(
        "TUTOR_RUNTIME",
        "replay_error",
        "Unexpected error in GET /conversations/:conversationId",
        err instanceof Error ? err : undefined,
      );
      sendTutorError(res, "canonical_write_failed");
    }
  },
);

// ============================================================================
// GET /conversations — §8 List
// ============================================================================

router.get(
  "/conversations",
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      sendTutorError(res, "unauthenticated");
      return;
    }
    const studentId = req.user.id;

    if (await denyIfNotEntitled(studentId, res)) return;

    const parsedQuery = listConversationsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      sendTutorError(res, "invalid_input", parsedQuery.error.flatten());
      return;
    }
    const limit = parsedQuery.data.limit ?? 20;

    try {
      let query = supabaseServer
        .from("tutor_conversations")
        .select(
          "id, entry_mode, source_surface, source_session_id, source_session_item_id, source_question_row_id, source_question_canonical_id, status, crisis_flagged, created_at, updated_at, title, surface, crisis_paused_at",
        )
        .eq("student_id", studentId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (parsedQuery.data.surface) {
        query = query.eq("surface", parsedQuery.data.surface);
      }
      if (parsedQuery.data.source_surface) {
        query = query.eq("source_surface", parsedQuery.data.source_surface);
      }
      if (parsedQuery.data.source_session_item_id) {
        query = query.eq(
          "source_session_item_id",
          parsedQuery.data.source_session_item_id,
        );
      }
      query = parsedQuery.data.status
        ? query.eq("status", parsedQuery.data.status)
        : query.in("status", ["active", "ended"]);

      const { data: rows, error } = await query;

      if (error) {
        logger.error(
          "TUTOR_RUNTIME",
          "list_conversations_failed",
          "Failed to list tutor_conversations",
          { message: error.message, code: error.code },
        );
        sendTutorError(res, "canonical_write_failed");
        return;
      }

      const conversations = await Promise.all(
        (rows ?? []).map(async (row) => {
          const conv = row as TutorConversationRow;
          const { data: lastMessage } = await supabaseServer
            .from("tutor_messages")
            .select("message, role")
            .eq("conversation_id", conv.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const { count } = await supabaseServer
            .from("tutor_messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", conv.id);

          const rawPreview =
            (lastMessage?.message as string | undefined) ?? null;
          const lastRole = (lastMessage?.role as string | undefined) ?? null;

          // LISA-FULL-007: scan list previews for defense-in-depth.
          // Only tutor-role messages need scanning. Student messages
          // and null previews pass through. The preview is truncated
          // AFTER scanning so a leak at position 90 is still caught.
          let safePreview: string | null = null;
          if (rawPreview !== null && lastRole === "tutor") {
            const listScanContext: OutputScanContext = {
              conversationId: conv.id,
              studentId,
              isPreSubmit: false, // list is a summary surface; not pre-submit
              correctAnswer: null,
              correctAnswerResolutionFailed: false,
              questionCanonicalId: conv.source_question_canonical_id,
            };
            const listSerialized = await serializeTutorOutput(
              rawPreview,
              listScanContext,
            );
            safePreview = listSerialized.content.slice(0, 100);
          } else {
            safePreview = rawPreview ? rawPreview.slice(0, 100) : null;
          }

          return {
            conversation_id: conv.id,
            entry_mode: conv.entry_mode,
            source_surface: conv.source_surface,
            surface: conv.surface,
            status: conv.status,
            title: conv.title,
            crisis_flagged: conv.crisis_flagged,
            crisis_paused_at: conv.crisis_paused_at,
            resolved_scope: {
              source_session_id: conv.source_session_id,
              source_session_item_id: conv.source_session_item_id,
              source_question_row_id: conv.source_question_row_id,
              source_question_canonical_id: conv.source_question_canonical_id,
            },
            last_message_preview: safePreview,
            message_count: count ?? 0,
            created_at: conv.created_at,
            updated_at: conv.updated_at,
          };
        }),
      );

      res.status(200).json({
        data: {
          conversations,
          pagination: {
            has_more: conversations.length === limit,
            next_cursor:
              conversations.length > 0
                ? conversations[conversations.length - 1].conversation_id
                : null,
          },
        },
      });
    } catch (err) {
      logger.error(
        "TUTOR_RUNTIME",
        "list_error",
        "Unexpected error in GET /conversations",
        err instanceof Error ? err : undefined,
      );
      sendTutorError(res, "canonical_write_failed");
    }
  },
);

// ============================================================================
// POST /conversations/:conversationId/end — End a session
// @spec [CC Brief "LISA Session Lifecycle" §5.1]
// Replaces the broken /close endpoint. No body required. Sets status='ended'.
// ============================================================================

router.post(
  "/conversations/:conversationId/end",
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      sendTutorError(res, "unauthenticated");
      return;
    }
    const studentId = req.user.id;

    if (await denyIfNotEntitled(studentId, res)) return;

    const conversationId = req.params.conversationId;
    const parsed = endConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      sendTutorError(res, "invalid_input", parsed.error.flatten());
      return;
    }

    try {
      const conversation = await loadOwnedConversation(
        conversationId,
        studentId,
      );
      if (!conversation) {
        sendTutorError(res, "conversation_not_found");
        return;
      }
      if (conversation.status === "ended") {
        sendTutorError(res, "conversation_already_ended");
        return;
      }
      if (conversation.status !== "active") {
        sendTutorError(res, "conversation_already_closed");
        return;
      }

      const endedAt = new Date().toISOString();
      const { error } = await supabaseServer
        .from("tutor_conversations")
        .update({ status: "ended", ended_at: endedAt, closed_at: endedAt })
        .eq("id", conversation.id);

      if (error) {
        logger.error(
          "TUTOR_RUNTIME",
          "end_conversation_failed",
          "Failed to update tutor_conversations status to ended",
          { message: error.message, code: error.code },
        );
        sendTutorError(res, "canonical_write_failed");
        return;
      }

      // Async memory compaction (Doc 03A V3 §9.1, Doc 03C V3 §8.3).
      // @spec [Doc-03C_V3 §8.3 task payload; CC Brief "Close the LISA Vertical" PR 3.2]
      // - trigger_reason is "close": §8.3 fixes the enum as close | threshold |
      //   stale, and this endpoint IS the spec's conversation-close trigger.
      //   It used to send "end", which the writeback handler (correctly, per
      //   the spec) rejects with 400 — so no summary was ever written.
      // - AWAITED: on Vercel the function may be frozen once the response is
      //   sent, so a `void` enqueue could be dropped before the Cloud Tasks
      //   call left the process. enqueueCloudTask never throws and times out
      //   at 5s, so awaiting adds at most that to /end.
      const compactionRequestId = crypto.randomUUID();
      const compactionTargetUrl = `${(process.env.PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/internal/memory/compact-writeback`;

      await enqueueCloudTask("lisa-compaction", compactionTargetUrl, {
        job_type: "compaction",
        conversation_id: conversation.id,
        trigger_reason: "close",
        request_id: compactionRequestId,
      });

      logger.info(
        "TUTOR_RUNTIME",
        "conversation_ended",
        "Session ended; compaction task enqueued to Cloud Tasks",
        { conversationId: conversation.id, requestId: compactionRequestId },
      );

      res.status(200).json({
        data: {
          conversation_id: conversation.id,
          status: "ended",
          ended_at: endedAt,
        },
      });
    } catch (err) {
      logger.error(
        "TUTOR_RUNTIME",
        "end_error",
        "Unexpected error in POST /conversations/:conversationId/end",
        err instanceof Error ? err : undefined,
      );
      sendTutorError(res, "canonical_write_failed");
    }
  },
);

// ============================================================================
// POST /conversations/:conversationId/resume — Resume from crisis pause
// @spec [CC Brief "LISA Session Lifecycle" §5.4]
// Clears crisis_paused_at so the student can continue chatting.
// ============================================================================

router.post(
  "/conversations/:conversationId/resume",
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      sendTutorError(res, "unauthenticated");
      return;
    }
    const studentId = req.user.id;

    if (await denyIfNotEntitled(studentId, res)) return;

    const conversationId = req.params.conversationId;
    const parsed = resumeConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      sendTutorError(res, "invalid_input", parsed.error.flatten());
      return;
    }

    try {
      const conversation = await loadOwnedConversation(
        conversationId,
        studentId,
      );
      if (!conversation) {
        sendTutorError(res, "conversation_not_found");
        return;
      }
      if (conversation.status !== "active") {
        sendTutorError(res, "conversation_closed");
        return;
      }
      if (!conversation.crisis_paused_at) {
        sendTutorError(res, "conversation_not_paused");
        return;
      }

      const { error } = await supabaseServer
        .from("tutor_conversations")
        .update({ crisis_paused_at: null })
        .eq("id", conversation.id);

      if (error) {
        logger.error(
          "TUTOR_RUNTIME",
          "resume_conversation_failed",
          "Failed to clear crisis_paused_at on tutor_conversations",
          { message: error.message, code: error.code },
        );
        sendTutorError(res, "canonical_write_failed");
        return;
      }

      logger.info(
        "TUTOR_RUNTIME",
        "conversation_resumed",
        "Session resumed after crisis pause",
        { conversationId: conversation.id },
      );

      res.status(200).json({
        data: {
          conversation_id: conversation.id,
          status: "active",
          crisis_paused_at: null,
        },
      });
    } catch (err) {
      logger.error(
        "TUTOR_RUNTIME",
        "resume_error",
        "Unexpected error in POST /conversations/:conversationId/resume",
        err instanceof Error ? err : undefined,
      );
      sendTutorError(res, "canonical_write_failed");
    }
  },
);

export default router;
