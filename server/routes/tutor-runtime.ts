/**
 * @spec [Doc-03B_V2 §4 Endpoint Catalog, §5, §6, §7, §8, §9]
 * @implemented 2026-08-09
 *
 * plain English: The LISA tutor runtime router. Mounted at `/api/tutor` behind
 * `ragLimiter -> requireSupabaseAuth -> requireStudentOnly -> doubleCsrfProtection`
 * (server/index.ts), so every handler in this file already has an authenticated,
 * student-role `req.user`. This file implements:
 *   - POST   /conversations                        (§5 start/reuse conversation)
 *   - POST   /messages                              (§6 append turn — the 19-step pipeline)
 *   - GET    /conversations/:conversationId         (§7 replay)
 *   - GET    /conversations                         (§8 list)
 *   - POST   /conversations/:conversationId/close   (§9 close)
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
// hasAnswerLeak + resolveFullEnvelope: canonical anti-leak scanner and context
// resolver both live behind tutor-context.ts (which re-exports the scanner
// from tutor-antileak.ts for backward compatibility — see that file's
// "Re-export for backward compatibility" section).
import { hasAnswerLeak, resolveFullEnvelope } from "../services/tutor-context";
// Canonical anti-leak exports used directly (no local wrappers — the WS-2 CI
// gate was rewritten to behavior assertions per LISA-FULL-001 item 6).
import {
  isPreSubmitForSurface,
  TUTOR_ANTI_LEAK_SUBSTITUTION,
} from "../services/tutor-antileak";
import { orchestrateTurn } from "../lib/tutor-orchestrator-client";
import { getRecentMessages } from "../services/tutor-memory";
import { sendTutorError } from "../services/tutor-error-codes";
import {
  runCrisisClassifier,
  getCrisisResponse,
  flagConversationForReview,
} from "../services/tutor-crisis";
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

const router = Router();

// TUTOR_ANTI_LEAK_SUBSTITUTION is now imported from ../services/tutor-antileak
// (canonical single source of truth). The former local copy was removed per
// LISA-FULL-001 item 6 — the WS-2 CI gate was rewritten from structural
// assertions to behavior assertions, so no local declaration is required.

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

const closeConversationSchema = z.object({
  status: z.enum(["closed", "abandoned"]),
});

const listConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).optional(),
  source_surface: sourceSurfaceSchema.optional(),
  status: z.enum(["active", "closed", "abandoned"]).optional(),
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
  status: "active" | "closed" | "abandoned";
  crisis_flagged: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

// isPreSubmitForSurface is now imported directly from ../services/tutor-antileak
// (canonical algorithm, single source of truth). The former local wrapper was
// removed per LISA-FULL-001 item 6 — the WS-2 CI gate was rewritten from
// structural assertions to behavior assertions, so no local declaration is
// required.

// ── removeInternalMetadataMentions ─────────────────────────────────────
/**
 * @spec [Doc-03_V3 §17, INV-03-12] | @implemented 2026-08-09
 * plain English: strips accidental mentions of internal-only metadata
 * (policy/config identifiers, table names, model aliases) that the model
 * must never surface verbatim to the student. This runs BEFORE the
 * answer-leak scan so leak detection operates on already-cleaned text.
 * expected outcome: internal identifiers are removed and whitespace is
 * collapsed; pedagogical content is left untouched.
 * trade-offs: a fixed denylist of internal tokens — a heuristic layer, not
 * a substitute for prompting the model to never mention these things.
 * edge cases: case-insensitive match; removing a token never leaves a
 * dangling double space.
 */
const INTERNAL_METADATA_PATTERNS: ReadonlyArray<RegExp> = [
  /\bpolicy_family\b\s*[:=]?\s*[\w.-]*/gi,
  /\bpolicy_variant\b\s*[:=]?\s*[\w.-]*/gi,
  /\bpolicy_version\b\s*[:=]?\s*[\w.-]*/gi,
  /\bassignment_key\b\s*[:=]?\s*[\w.:-]*/gi,
  /\breason_snapshot\b/gi,
  /\borchestration_meta\b/gi,
  /\btutor_context_runtime_config\b/gi,
  /\btutor_instruction_assignments\b/gi,
  /\btutor_messages\b/gi,
  /\bclassifier_class\b/gi,
  /\bmodel_armor(_\w+)?\b/gi,
  /\bgemini-[\w.-]+\b/gi,
  /\bvertex\s*ai\b/gi,
];

export function removeInternalMetadataMentions(text: string): string {
  let cleaned = text;
  for (const pattern of INTERNAL_METADATA_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// invokeOrchestration stub DELETED — replaced by the real orchestrateTurn()
// call from server/lib/tutor-orchestrator-client.ts (LISA-FULL-001 item 1).
// orchestrateTurn() posts to the worker, scans the response through
// scanAndSubstitute (the anti-leak chokepoint), and returns a TutorResult
// that never throws.

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

type ReplayMessageRow = {
  id: string;
  role: "student" | "tutor" | "system";
  content_kind: string;
  message: string;
  source_session_item_id: string | null;
  created_at: string;
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
      "id, role, content_kind, message, source_session_item_id, created_at",
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
      "id, student_id, entry_mode, source_surface, source_session_id, source_session_item_id, source_question_row_id, source_question_canonical_id, status, crisis_flagged, deleted_at, created_at, updated_at, closed_at",
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
): Promise<ResolvedScopeRow> {
  let sessionId = sourceSessionId;
  let sessionItemId = sourceSessionItemId;
  let questionRowId = sourceQuestionRowId;
  let canonicalId = sourceQuestionCanonicalId;

  if (sessionId) {
    const { data, error } = await supabaseServer
      .from("practice_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", studentId)
      .maybeSingle();
    if (error || !data) {
      sessionId = null;
    }
  }

  if (sessionItemId) {
    const { data, error } = await supabaseServer
      .from("practice_session_items")
      .select("id, question_id, session_id")
      .eq("id", sessionItemId)
      .eq("user_id", studentId)
      .maybeSingle();
    if (error || !data) {
      sessionItemId = null;
    } else {
      // The session item's question is authoritative if the client did not
      // separately supply one.
      if (!questionRowId) {
        questionRowId = (data.question_id as string) ?? null;
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
 * @spec [Doc-03_V3 §17, INV-03-04] Fetches the canonical correct answer for
 * a scoped question row, for use as the anti-leak comparison key. Returns
 * null (generic phrase detection fallback in hasAnswerLeak) if there is no
 * question scope or the lookup fails.
 */
async function getCorrectAnswerForScope(
  questionRowId: string | null,
): Promise<string | null> {
  if (!questionRowId) return null;

  const { data, error } = await supabaseServer
    .from("questions")
    .select("correct_answer")
    .eq("id", questionRowId)
    .maybeSingle();

  if (error || !data) {
    logger.warn(
      "TUTOR_RUNTIME",
      "correct_answer_lookup_failed",
      "Could not resolve correct_answer for anti-leak scan; falling back to generic detection",
      { questionRowId },
    );
    return null;
  }

  return (data.correct_answer as string | null) ?? null;
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
      );

      // ── domain: reuse rule (§5.6) ──
      const freshnessCutoff = new Date();
      freshnessCutoff.setDate(freshnessCutoff.getDate() - 7);

      let reuseQuery = supabaseServer
        .from("tutor_conversations")
        .select(
          "id, student_id, entry_mode, source_surface, source_session_id, source_session_item_id, source_question_row_id, source_question_canonical_id, status, crisis_flagged, deleted_at, created_at, updated_at, closed_at",
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
        const row = reusable as TutorConversationRow;
        res.status(200).json({
          data: {
            conversation_id: row.id,
            reused: true,
            entry_mode: row.entry_mode,
            source_surface: row.source_surface,
            status: row.status,
            crisis_flagged: row.crisis_flagged,
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

      // ── domain: create new conversation ──
      const { data: created, error: insertError } = await supabaseServer
        .from("tutor_conversations")
        .insert({
          student_id: studentId,
          entry_mode: input.entry_mode,
          source_surface: input.source_surface,
          source_session_id: resolvedScope.source_session_id,
          source_session_item_id: resolvedScope.source_session_item_id,
          source_question_row_id: resolvedScope.source_question_row_id,
          source_question_canonical_id:
            resolvedScope.source_question_canonical_id,
        })
        .select(
          "id, student_id, entry_mode, source_surface, source_session_id, source_session_item_id, source_question_row_id, source_question_canonical_id, status, crisis_flagged, deleted_at, created_at, updated_at, closed_at",
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
          status: row.status,
          crisis_flagged: row.crisis_flagged,
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

  // Step 4: Live exam block (INV-03-02, Doc-03B_V4.1 §3.4).
  // LISA must be unavailable while the student has an active full-length exam
  // session. Fail CLOSED — a failing live-exam check blocks tutor access.
  const liveExamInProgress =
    await EntitlementService.isLiveExamInProgress(studentId);
  if (liveExamInProgress) {
    sendTutorError(res, "tutor_unavailable_during_live_exam");
    return;
  }

  // Step 6: Validate request payload (§6.4). Run before ownership so a
  // malformed body never triggers a DB lookup.
  const parsed = appendTurnSchema.safeParse(req.body);
  if (!parsed.success) {
    sendTutorError(res, "invalid_input", parsed.error.flatten());
    return;
  }
  const input = parsed.data;
  const contentKind = input.content_kind ?? "message";

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
    if (conversation.status !== "active") {
      sendTutorError(res, "conversation_closed");
      return;
    }

    // Step 7: Rate/quota limits — `ragLimiter` (mounted at /api/tutor) covers
    // request-rate; daily/weekly/monthly quota accounting (Doc 03 Main §13)
    // is a separate quota service, not yet built. Deferred.

    // Step 8: Idempotency check — same client_turn_id already persisted?
    const { data: existingTurn, error: existingTurnError } =
      await supabaseServer
        .from("tutor_messages")
        .select("id, role, message, created_at")
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
      sendTutorError(res, "idempotency_lookup_failed");
      return;
    }

    if (existingTurn && existingTurn.length > 0) {
      const existingStudentMsg = existingTurn.find(
        (m) => (m as { role: string }).role === "student",
      ) as { id: string; message: string } | undefined;
      const existingTutorMsg = existingTurn.find(
        (m) => (m as { role: string }).role === "tutor",
      ) as { id: string; message: string } | undefined;

      if (existingStudentMsg && existingStudentMsg.message !== input.message) {
        sendTutorError(res, "idempotency_conflict");
        return;
      }

      if (existingStudentMsg && existingTutorMsg) {
        // AUDIT-003: Apply anti-leak scan to idempotency replay — the
        // submission state may have changed since the original turn.
        // Same defense-in-depth as the GET replay endpoint (§16 Layer 4).
        const replayPreSubmit = await isPreSubmitForSurface(
          conversation.source_surface,
          conversation.source_session_item_id,
          supabaseServer,
        );
        const replayCorrectAnswer = replayPreSubmit
          ? await getCorrectAnswerForScope(conversation.source_question_row_id)
          : null;
        const cleanedReplay = removeInternalMetadataMentions(
          existingTutorMsg.message,
        );
        const safeReplayContent =
          replayPreSubmit && hasAnswerLeak(cleanedReplay, replayCorrectAnswer)
            ? TUTOR_ANTI_LEAK_SUBSTITUTION
            : cleanedReplay;

        res.status(200).json({
          data: {
            conversation_id: conversation.id,
            message_id: existingTutorMsg.id,
            client_turn_id: input.client_turn_id,
            response: {
              content: safeReplayContent,
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
      // Student message persisted but tutor response was not (prior
      // request failed mid-flow) — fall through and complete the flow.
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
    if (injectionDetected) {
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
    // The classifier infrastructure may be unavailable (missing tables in test
    // environments, Vertex outage). In that case the turn proceeds with
    // forceReview so it lands in the §21.3 safety review queue.
    let crisisResult: Awaited<ReturnType<typeof runCrisisClassifier>>;
    try {
      crisisResult = await runCrisisClassifier(sanitized);
    } catch (crisisErr: unknown) {
      // Classifier infrastructure failure — treat as degraded, not blocking.
      // The turn proceeds but is force-enqueued to the review queue.
      logger.error(
        "TUTOR_RUNTIME",
        "crisis_classifier_infrastructure_error",
        "crisis classifier infrastructure error; treating as degraded",
        {
          message:
            crisisErr instanceof Error ? crisisErr.message : String(crisisErr),
          conversationId: conversation.id,
        },
      );
      crisisResult = { crisis: false, forceReview: true };
    }

    // Step 11: Persist student message.
    const { data: studentMessageRow, error: studentMessageError } =
      await supabaseServer
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
        })
        .select("id, created_at")
        .single();

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
      sendTutorError(res, "canonical_write_failed");
      return;
    }

    // Crisis path: bypass model generation entirely; respond with the
    // regional crisis resource and flag for the safety review queue.
    if (crisisResult.crisis) {
      await flagConversationForReview(conversation.id);

      const { data: profileRow } = await supabaseServer
        .from("profiles")
        .select("country_code")
        .eq("id", studentId)
        .maybeSingle();
      const crisisContent = getCrisisResponse(
        (profileRow?.country_code as string | null) ?? "US",
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
        sendTutorError(res, "canonical_write_failed");
        return;
      }

      res.status(200).json({
        data: {
          conversation_id: conversation.id,
          message_id: crisisMessageRow.id,
          client_turn_id: input.client_turn_id,
          response: {
            content: crisisContent,
            content_kind: "message",
            suggested_action: { type: "none", label: null },
            ui_hints: {
              show_accept_decline: false,
              allow_freeform_reply: true,
              suggested_chip: null,
            },
          },
          conversation_updated_at: new Date().toISOString(),
        },
      });
      return;
    }

    // CR-03C-V3-01 §3.4 condition 3: Layer 2 failed, turn proceeds but
    // force-enqueued to the §21.3 review queue with classifier_degraded.
    if (!crisisResult.crisis && crisisResult.forceReview) {
      await flagConversationForReview(conversation.id);
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
      sendTutorError(res, "canonical_write_failed");
      return;
    }
    const assignmentId = instructionAssignmentResult.assignmentId;

    // Step 13: Resolve pre-submit state and correct answer BEFORE building the
    // envelope — these flow into both the wire request (worker-side scan) and
    // the BFF-side defense-in-depth scan (step 15).
    // @spec [INV-03-04, Doc-03B_V4.1 §6.5 step 13-15]
    const preSubmit = await isPreSubmitForSurface(
      conversation.source_surface,
      effectiveScope.source_session_item_id,
      supabaseServer,
    );
    const correctAnswer = preSubmit
      ? await getCorrectAnswerForScope(effectiveScope.source_question_row_id)
      : null;

    // Build context envelope (Doc 03A §5.4). Anti-leak fields and Model Armor
    // template IDs are resolved here so the worker receives them on the wire.
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
      runtimeLimits: { maxOutputTokens: 1024, timeoutMs: 30_000 },
      correctAnswer,
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

    // Step 14: Invoke orchestration via the real worker boundary
    // (LISA-FULL-001 item 1). orchestrateTurn posts to the worker, applies
    // the BFF-side scanAndSubstitute (the anti-leak chokepoint per INV-03-04),
    // and returns a TutorResult — never throws.
    const turnStartedAt = Date.now();
    const orchestrationResult = await orchestrateTurn(
      envelope,
      preSubmit,
      correctAnswer,
    );

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
      sendTutorError(res, orchestrationResult.errorCode, {
        retry_after_ms: 2000,
        failure_layer: "orchestrator",
      });
      return;
    }

    const orchestration = orchestrationResult.value;
    const tutorResponse = orchestration.response.content;

    // Step 15: Defense-in-depth anti-leak scan (belt-and-suspenders).
    // The primary anti-leak chokepoint is orchestrateTurn's scanAndSubstitute
    // (BFF boundary) + the worker's own hasAnswerLeak scan. This route-layer
    // scan catches anything that slipped through both earlier layers —
    // metadata mentions first, then answer-leak detection.
    // @spec [Doc-03_V3 §16.4-5, INV-03-13]
    const cleaned = removeInternalMetadataMentions(tutorResponse);
    const safeContent =
      preSubmit && hasAnswerLeak(cleaned, correctAnswer)
        ? TUTOR_ANTI_LEAK_SUBSTITUTION
        : cleaned;
    const antiLeakTriggered = safeContent !== cleaned;

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
      sendTutorError(res, "canonical_write_failed");
      return;
    }

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

      // Defense-in-depth (§16 Layer 4 mirror): re-apply the anti-leak scan on
      // read — the per-item submission state may have changed since write
      // time. Tutor-authored messages only; student turns pass through.
      let correctAnswerForReplay: string | null = null;
      let correctAnswerResolved = false;
      const safeMessages = [];

      for (const row of ordered) {
        if (row.role !== "tutor") {
          safeMessages.push({
            message_id: row.id,
            role: row.role,
            content_kind: row.content_kind,
            message: row.message,
            created_at: row.created_at,
          });
          continue;
        }

        const preSubmit = await isPreSubmitForSurface(
          conversation.source_surface,
          row.source_session_item_id ?? conversation.source_session_item_id,
          supabaseServer,
        );
        if (!correctAnswerResolved) {
          correctAnswerForReplay = await getCorrectAnswerForScope(
            conversation.source_question_row_id,
          );
          correctAnswerResolved = true;
        }
        const safeContent =
          preSubmit && hasAnswerLeak(row.message, correctAnswerForReplay)
            ? TUTOR_ANTI_LEAK_SUBSTITUTION
            : row.message;

        safeMessages.push({
          message_id: row.id,
          role: row.role,
          content_kind: row.content_kind,
          message: safeContent,
          created_at: row.created_at,
        });
      }

      res.status(200).json({
        data: {
          conversation: {
            conversation_id: conversation.id,
            entry_mode: conversation.entry_mode,
            source_surface: conversation.source_surface,
            status: conversation.status,
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
        },
      });
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
          "id, entry_mode, source_surface, source_session_id, source_session_item_id, source_question_row_id, source_question_canonical_id, status, created_at, updated_at",
        )
        .eq("student_id", studentId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (parsedQuery.data.source_surface) {
        query = query.eq("source_surface", parsedQuery.data.source_surface);
      }
      query = parsedQuery.data.status
        ? query.eq("status", parsedQuery.data.status)
        : query.in("status", ["active", "closed"]);

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
            .select("message")
            .eq("conversation_id", conv.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const { count } = await supabaseServer
            .from("tutor_messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", conv.id);

          const preview = (lastMessage?.message as string | undefined) ?? null;

          return {
            conversation_id: conv.id,
            entry_mode: conv.entry_mode,
            source_surface: conv.source_surface,
            status: conv.status,
            resolved_scope: {
              source_session_id: conv.source_session_id,
              source_session_item_id: conv.source_session_item_id,
              source_question_row_id: conv.source_question_row_id,
              source_question_canonical_id: conv.source_question_canonical_id,
            },
            last_message_preview: preview ? preview.slice(0, 100) : null,
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
// POST /conversations/:conversationId/close — §9 Close
// ============================================================================

router.post(
  "/conversations/:conversationId/close",
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      sendTutorError(res, "unauthenticated");
      return;
    }
    const studentId = req.user.id;

    if (await denyIfNotEntitled(studentId, res)) return;

    const conversationId = req.params.conversationId;
    const parsed = closeConversationSchema.safeParse(req.body);
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
        sendTutorError(res, "conversation_already_closed");
        return;
      }

      const closedAt = new Date().toISOString();
      const { error } = await supabaseServer
        .from("tutor_conversations")
        .update({ status: parsed.data.status, closed_at: closedAt })
        .eq("id", conversation.id);

      if (error) {
        logger.error(
          "TUTOR_RUNTIME",
          "close_conversation_failed",
          "Failed to update tutor_conversations status",
          { message: error.message, code: error.code },
        );
        sendTutorError(res, "canonical_write_failed");
        return;
      }

      // Async memory compaction (Doc 03A V3 §9.1) is executed by the Doc 03C
      // orchestrator worker, not this request path. Enqueue is a fire-and-
      // forget log marker until the job queue transport lands.
      logger.info(
        "TUTOR_RUNTIME",
        "memory_compaction_enqueue_deferred",
        "Conversation closed; memory compaction job not yet wired to a queue",
        { conversationId: conversation.id },
      );

      res.status(200).json({
        data: {
          conversation_id: conversation.id,
          status: parsed.data.status,
          closed_at: closedAt,
        },
      });
    } catch (err) {
      logger.error(
        "TUTOR_RUNTIME",
        "close_error",
        "Unexpected error in POST /conversations/:conversationId/close",
        err instanceof Error ? err : undefined,
      );
      sendTutorError(res, "canonical_write_failed");
    }
  },
);

export default router;
