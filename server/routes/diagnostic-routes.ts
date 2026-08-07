/**
 * Diagnostic session routes — Vertical B, Slice 1.
 *
 * @spec [Doc-05A_V1.0 §11 (diagnostic seeding contract); Doc-05C §6.2
 *        (evidence gate); Doc-02B_V4 §14 (session lifecycle)]
 * @implemented [2026-08-06]
 *
 * The 40-question diagnostic seeds initial mastery state (8 domains × 5 questions)
 * and unlocks the Q4 score projection. Diagnostic sessions are practice session
 * variants (mode='diagnostic') that reuse the practice session lifecycle for
 * serve/answer/resume — only creation and post-completion reads are diagnostic-specific.
 *
 * plain English: creates a balanced per-domain diagnostic session and exposes a
 * weakest-skills read after completion. The answer path is the standard practice
 * answer handler with a mode-based branch for event_source_kind.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import * as crypto from "node:crypto";
import { logger } from "../logger";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  mapGenesisQuestionRow,
  isCanonicalRuntimeQuestion,
  normalizeClientInstanceId,
  type CanonicalQuestionRowLike,
} from "../../shared/question-bank-contract";
import {
  toCanonicalQuestionForServing,
  buildSessionItemInsertRows,
  hydrateSessionItemOptionTokens,
  cleanupFailedSessionMaterialization,
  loadPracticeConfig,
  type CanonicalQuestionForServing,
  type SessionItemInsertContext,
} from "./practice-canonical";

const router = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CANONICAL_DOMAIN_COUNT = 8;

// ---------------------------------------------------------------------------
// Zod schemas (inline, per existing practice pattern — Coding Standards §7.2)
// ---------------------------------------------------------------------------
const StartDiagnosticBodySchema = z.object({
  platform: z.enum(["web", "mobile"]).default("web"),
  client_instance_id: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
});

// ---------------------------------------------------------------------------
// POST /sessions — Create a diagnostic session
// ---------------------------------------------------------------------------
// @spec [Doc-05A §11; Doc-02B §14 session lifecycle] | @implemented [2026-08-06]
// plain English: selects 8 domains × 5 questions (balanced across difficulties),
// materializes them into practice_session_items with mode='diagnostic', and returns
// the session with the first served item. Reuses the practice session ownership
// model (client_instance_id, status machine, resumability).
router.post("/sessions", async (req: Request, res: Response) => {
  const requestId = (req as Record<string, unknown>).requestId as
    | string
    | undefined;
  const user = (req as Record<string, unknown>).user as
    | { id: string; role?: string }
    | undefined;
  const userId = user?.id;

  // 1. Auth
  if (!userId) {
    return res.status(401).json({
      error: "authentication_required",
      message: "Authentication required",
      requestId,
    });
  }

  // 2. Zod parse
  const parsed = StartDiagnosticBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_request",
      message: "Invalid diagnostic session request",
      details: parsed.error.flatten(),
      requestId,
    });
  }

  const { platform, client_instance_id, idempotency_key } = parsed.data;
  const clientInstanceId = normalizeClientInstanceId(
    client_instance_id ?? null,
  );

  // 3. Load config
  const config = await loadPracticeConfig();
  const totalQuestions = config.diagnosticTotalQuestions;
  const perDomain = config.diagnosticPerDomain;

  // 4. Idempotency: check for existing diagnostic session with same key
  if (idempotency_key) {
    const { data: existingSessions } = await supabaseServer
      .from("practice_sessions")
      .select(
        "id, status, mode, filters, target_count, platform, client_instance_id, created_at, updated_at, last_activity_at, completed_at, actor_id, user_id",
      )
      .eq("user_id", userId)
      .eq("mode", "diagnostic")
      .in("status", ["created", "active"])
      .order("created_at", { ascending: false });

    const replay = (existingSessions ?? []).find(
      (s: Record<string, unknown>) => {
        const filters = s.filters as Record<string, unknown> | null;
        return filters?.session_start_idempotency_key === idempotency_key;
      },
    );

    if (replay) {
      // Replay: return existing diagnostic session
      const { data: firstItem } = await supabaseServer
        .from("practice_session_items")
        .select(
          "id, question_id, question_stem, question_passage, question_options, question_section, question_item_type, question_difficulty, question_assets, option_order, option_token_map, ordinal, status",
        )
        .eq("session_id", replay.id as string)
        .in("status", ["served", "pending"])
        .order("ordinal", { ascending: true })
        .limit(1)
        .maybeSingle();

      return res.json({
        sessionId: replay.id,
        mode: "diagnostic",
        status: replay.status,
        totalQuestions,
        replayed: true,
        currentItem: firstItem ? sanitizeDiagnosticItem(firstItem) : null,
      });
    }
  }

  // 5. Check no active diagnostic session exists
  const { data: activeDiagnostics, error: activeErr } = await supabaseServer
    .from("practice_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("mode", "diagnostic")
    .in("status", ["created", "active"])
    .limit(1);

  if (activeErr) {
    return res.status(500).json({
      error: "session_lookup_failed",
      message: activeErr.message,
      requestId,
    });
  }

  if (activeDiagnostics && activeDiagnostics.length > 0) {
    return res.status(409).json({
      error: "diagnostic_session_active",
      message:
        "An active diagnostic session already exists. Resume or complete it before starting a new one.",
      existingSessionId: (activeDiagnostics[0] as Record<string, unknown>).id,
      requestId,
    });
  }

  // 6. Select diagnostic pool — 8 domains × perDomain, balanced across difficulties
  const { data: poolRows, error: poolErr } = await supabaseServer.rpc(
    "select_diagnostic_pool",
    {
      p_per_domain: perDomain,
      p_exclude_ids: null,
    },
  );

  if (poolErr) {
    return res.status(500).json({
      error: "diagnostic_pool_selection_failed",
      message: poolErr.message,
      requestId,
    });
  }

  const rawPool = (poolRows ?? []) as CanonicalQuestionRowLike[];

  // 7. Map and validate
  const selected: CanonicalQuestionForServing[] = [];
  for (const raw of rawPool) {
    const mapped = mapGenesisQuestionRow(raw);
    if (!isCanonicalRuntimeQuestion(mapped)) {
      logger.warn("[diagnostic] skipping invalid question from pool", {
        requestId,
        questionId: String(raw.id ?? ""),
      });
      continue;
    }
    selected.push(toCanonicalQuestionForServing(mapped));
  }

  // 8. Validate per-domain coverage — surfaced error, not silent short-count
  // @spec [Doc-05A §11.2: per-domain coverage ≥ 5]
  const domainCounts = new Map<string, number>();
  for (const q of selected) {
    const d = q.domain ?? "unknown";
    domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  }

  if (domainCounts.size < CANONICAL_DOMAIN_COUNT) {
    const missingCount = CANONICAL_DOMAIN_COUNT - domainCounts.size;
    logger.error("[diagnostic] insufficient domain coverage", {
      requestId,
      domainCounts: Object.fromEntries(domainCounts),
      expectedDomains: CANONICAL_DOMAIN_COUNT,
      actualDomains: domainCounts.size,
    });
    return res.status(503).json({
      error: "diagnostic_insufficient_coverage",
      message: `${missingCount} domain(s) lack servable questions for the diagnostic. All 8 canonical domains must have ≥${perDomain} servable questions.`,
      domainCounts: Object.fromEntries(domainCounts),
      requestId,
    });
  }

  for (const [domain, count] of domainCounts) {
    if (count < perDomain) {
      logger.error("[diagnostic] domain has insufficient questions", {
        requestId,
        domain,
        count,
        required: perDomain,
      });
      return res.status(503).json({
        error: "diagnostic_insufficient_coverage",
        message: `Domain "${domain}" has ${count} servable questions but the diagnostic requires ${perDomain}.`,
        domainCounts: Object.fromEntries(domainCounts),
        requestId,
      });
    }
  }

  if (selected.length < totalQuestions) {
    logger.error("[diagnostic] total pool size below requirement", {
      requestId,
      selectedCount: selected.length,
      requiredCount: totalQuestions,
    });
    return res.status(503).json({
      error: "diagnostic_insufficient_coverage",
      message: `Selected ${selected.length} questions but the diagnostic requires ${totalQuestions}.`,
      requestId,
    });
  }

  // Trim to exact totalQuestions (in case any domain returned extras after filtering)
  const diagnosticQuestions = selected.slice(0, totalQuestions);

  // 9. Create session
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const actorId = userId;

  const sessionMetadata: Record<string, unknown> = {
    session_start_idempotency_key: idempotency_key ?? null,
    target_question_count: totalQuestions,
    prebuilt: true,
    source_pool_count: rawPool.length,
    selection_mode: "exact",
    diagnostic_per_domain: perDomain,
  };

  const { error: sessionInsertErr } = await supabaseServer
    .from("practice_sessions")
    .insert({
      id: sessionId,
      user_id: userId,
      actor_id: actorId,
      mode: "diagnostic",
      filters: sessionMetadata,
      target_count: totalQuestions,
      platform,
      client_instance_id: clientInstanceId,
      status: "active",
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });

  if (sessionInsertErr) {
    return res.status(500).json({
      error: "session_creation_failed",
      message: sessionInsertErr.message,
      requestId,
    });
  }

  // 10. Materialize items
  const ctx: SessionItemInsertContext = {
    sessionId,
    userId,
    actorId,
    clientInstanceId,
    now,
  };

  const insertRows = buildSessionItemInsertRows(diagnosticQuestions, ctx);

  const { error: itemInsertErr } = await supabaseServer
    .from("practice_session_items")
    .insert(insertRows);

  if (itemInsertErr) {
    await cleanupFailedSessionMaterialization(sessionId);
    return res.status(500).json({
      error: "session_materialization_failed",
      message: itemInsertErr.message,
      requestId,
    });
  }

  // 11. Hydrate option tokens (Fisher-Yates shuffle for anti-leak)
  try {
    await hydrateSessionItemOptionTokens(sessionId);
  } catch (hydrateErr: unknown) {
    await cleanupFailedSessionMaterialization(sessionId);
    const msg =
      hydrateErr instanceof Error ? hydrateErr.message : String(hydrateErr);
    return res.status(500).json({
      error: "session_materialization_failed",
      message: msg,
      requestId,
    });
  }

  // 12. Load the first served item for the response
  const { data: firstItem } = await supabaseServer
    .from("practice_session_items")
    .select(
      "id, question_id, question_stem, question_passage, question_options, question_section, question_item_type, question_difficulty, question_assets, option_order, option_token_map, ordinal, status",
    )
    .eq("session_id", sessionId)
    .eq("status", "served")
    .order("ordinal", { ascending: true })
    .limit(1)
    .maybeSingle();

  logger.info("[diagnostic] session created", {
    requestId,
    sessionId,
    totalQuestions,
    perDomain,
    domainCount: domainCounts.size,
  });

  return res.status(201).json({
    sessionId,
    mode: "diagnostic",
    status: "active",
    totalQuestions,
    replayed: false,
    currentItem: firstItem ? sanitizeDiagnosticItem(firstItem) : null,
  });
});

// ---------------------------------------------------------------------------
// GET /sessions/:sessionId/weakest-skills — Post-completion weakest skills
// ---------------------------------------------------------------------------
// @spec [Doc-05A §11; mastery read] | @implemented [2026-08-06]
// plain English: after diagnostic completion, ranks student_skill_mastery by
// mastery_score ASC where event_count_total >= mastery_min_events (=5), to
// preset a practice focus on the weakest skills.
router.get(
  "/sessions/:sessionId/weakest-skills",
  async (req: Request, res: Response) => {
    const requestId = (req as Record<string, unknown>).requestId as
      | string
      | undefined;
    const user = (req as Record<string, unknown>).user as
      | { id: string }
      | undefined;
    const userId = user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "authentication_required",
        message: "Authentication required",
        requestId,
      });
    }

    const sessionId = String(req.params.sessionId || "").trim();
    if (!sessionId) {
      return res.status(400).json({
        error: "invalid_session_id",
        message: "sessionId is required",
        requestId,
      });
    }

    // Verify session ownership, mode, and completion
    const { data: session, error: sessionErr } = await supabaseServer
      .from("practice_sessions")
      .select("id, user_id, mode, status")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (sessionErr) {
      return res.status(500).json({
        error: "session_lookup_failed",
        message: sessionErr.message,
        requestId,
      });
    }

    if (!session) {
      return res.status(404).json({
        error: "session_not_found",
        message: "Diagnostic session not found",
        requestId,
      });
    }

    const sessionRecord = session as Record<string, unknown>;
    if (sessionRecord.mode !== "diagnostic") {
      return res.status(400).json({
        error: "not_diagnostic_session",
        message: "This endpoint is only available for diagnostic sessions",
        requestId,
      });
    }

    if (sessionRecord.status !== "completed") {
      return res.status(409).json({
        error: "diagnostic_not_completed",
        message:
          "Weakest skills are available only after diagnostic completion",
        requestId,
      });
    }

    // Read mastery: skills with sufficient evidence, ranked weakest-first
    const { data: skills, error: skillsErr } = await supabaseServer
      .from("student_skill_mastery")
      .select(
        "section, domain, skill, mastery_score, mastery_level, event_count_total",
      )
      .eq("student_id", userId)
      .gte("event_count_total", 5)
      .order("mastery_score", { ascending: true });

    if (skillsErr) {
      return res.status(500).json({
        error: "mastery_read_failed",
        message: skillsErr.message,
        requestId,
      });
    }

    return res.json({
      sessionId,
      skills: (skills ?? []).map((s: Record<string, unknown>) => ({
        section: s.section,
        domain: s.domain,
        skill: s.skill,
        masteryScore: s.mastery_score,
        masteryLevel: s.mastery_level,
        eventCount: s.event_count_total,
      })),
    });
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a diagnostic item for the client response.
 * Anti-leak: never include correct_answer, explanation, or option_metadata.
 */
function sanitizeDiagnosticItem(
  item: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sessionItemId: item.id,
    ordinal: item.ordinal,
    stem: item.question_stem,
    passage: item.question_passage ?? null,
    section: item.question_section,
    itemType: item.question_item_type ?? "mcq",
    difficulty: item.question_difficulty,
    assets: item.question_assets ?? null,
    correct_answer: null,
    explanation: null,
    status: item.status,
  };
}

export default router;
