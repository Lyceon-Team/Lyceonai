/**
 * @spec [Doc-03A_V3.0 §5 (Context Resolution), Doc-03A §8.3, Doc-03B_V2 §6.5 steps 9-10]
 * @implemented 2026-08-09
 *
 * plain English: Resolves the full context envelope for a tutor turn. This is
 * the gateway that assembles all the data the orchestrator needs: scope resolution,
 * learning context (mastery snapshot + recent friction + KPI state), memory
 * summaries, structured memory fields, and policy assignment.
 *
 * expected outcome: `resolveFullEnvelope(params)` returns a complete
 * OrchestrateRequest that has been validated against the wire protocol schema.
 * Every subsection fails gracefully (null) so that a DB error in one leg does
 * not block the entire tutor turn — except scope resolution, which fails closed
 * because the orchestrator cannot function without knowing what the student is
 * looking at.
 *
 * trade-offs / edge cases:
 *  - Scope resolution fails closed on DB error (throws). All other subsections
 *    degrade to null and log a warning.
 *  - Policy assignment is inlined as a deterministic default. A dedicated policy
 *    service will be extracted in a later WS.
 *  - Memory summaries and structured fields delegate to tutor-memory.ts, which
 *    is now available.
 *  - Final envelope is validated with Zod safeParse — if validation fails
 *    (should never happen), we throw so the turn is not dispatched with a
 *    malformed payload.
 *  - recent_friction.self_deprecating_language_detected is derived from the
 *    most recent student messages — a simple keyword scan (V1); Model Armor
 *    provides the model-backed depth layer.
 *  - recent_friction.long_pause_detected is derived from the gap between the
 *    last two student messages vs. friction_long_pause_seconds config threshold.
 */
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import {
  resolvedScopeSchema,
  recentMessageSchema,
  studentLearningContextSchema,
  masterySnapshotSchema,
  recentFrictionSchema,
  kpiStateSchema,
  policyAssignmentSchema,
  orchestrateRequestSchema,
  memorySummarySchema,
  retrievedCurriculumItemSchema,
} from "../../apps/workers/tutor-orchestrator/src/lib/_tutor-orchestrator-wire.generated";
import type {
  OrchestrateRequest,
  StudentLearningContext,
  RecentFriction,
  MasterySnapshot,
  KpiState,
  MemoryStructuredFields,
  QuestionContent,
} from "../../apps/workers/tutor-orchestrator/src/lib/_tutor-orchestrator-wire.generated";
import { getMemorySummaries, getStructuredFields } from "./tutor-memory";
import { retrieveCurriculum } from "./tutor-retrieval";
import { TutorConfig } from "./tutor-config";

// ── Types ──────────────────────────────────────────────────────────────

type ResolvedScope = z.infer<typeof resolvedScopeSchema>;

type EnvelopeParams = {
  conversationId: string;
  studentId: string;
  entryMode: "scoped_question" | "scoped_session" | "general";
  sourceSurface: "practice" | "review" | "test_review" | "dashboard";
  sourceSessionId: string | null;
  sourceSessionItemId: string | null;
  sourceQuestionRowId: string | null;
  recentMessages: z.infer<typeof recentMessageSchema>[];
  runtimeLimits: { maxOutputTokens: number; timeoutMs: number };
  // Anti-leak field (LISA-FULL-001): resolved BFF-side, passed to worker.
  // @spec [INV-03-04, Doc-03B_V4.1 §6.5 step 15]
  correctAnswer: string | null;
  // Server-derived post-submit flag (Doc 03D §6.3). The BFF resolves this
  // from practice_session_items.status; the envelope uses it to gate both
  // explanation release and the correct_answer wire value. correct_answer
  // stays BFF-local for the output scan when isPostSubmit is false.
  // @spec [Doc-03D_V1.2 §6.3, INV-03-04]
  isPostSubmit: boolean;
};

// ── Self-deprecation keywords (V1 simple scan) ─────────────────────────

const SELF_DEPRECATING_PATTERNS: ReadonlyArray<RegExp> = [
  /i'?m\s+(?:so\s+)?(?:stupid|dumb|bad\s+at\s+this|terrible|hopeless)/i,
  /i\s+(?:can'?t|cannot)\s+do\s+(?:this|anything|math)/i,
  /i[']?ll\s+never\s+(?:get|understand|learn)\s+this/i,
  /i\s+(?:hate|suck\s+at)\s+(?:this|math|reading)/i,
  /i\s+give\s+up/i,
  /what'?s\s+the\s+point/i,
  /too\s+(?:stupid|dumb)\s+for/i,
];

export function detectsSelfDeprecatingLanguage(text: string): boolean {
  return SELF_DEPRECATING_PATTERNS.some((pattern) => pattern.test(text));
}

// ── Scope Resolution ───────────────────────────────────────────────────

/**
 * @spec [Doc-03A_V3.0 §5.2, Doc-03B_V2 §5.4 rule 5, §11.1-11.2, INV-03-14]
 * @implemented 2026-08-12
 * plain English: Resolves the source scope for the current tutor turn with
 * student-ownership predicates on every student-scoped query. Client-
 * supplied references that are unowned, non-existent, or whose relationship
 * chain is broken (item ∉ session, session ∉ student) degrade scope rather
 * than resolving cross-student data.
 *
 * expected outcome: a ResolvedScope where every non-null field is proven
 * to belong to studentId via a WHERE-clause predicate — never a post-fetch
 * comparison.
 *
 * trade-offs: DB errors still fail closed (throw). Ownership / existence
 * failures degrade scope per Doc 03A §5.3 — the turn proceeds with less
 * context rather than blocking, because blocking on an attacker-supplied
 * reference is a DoS vector.
 *
 * edge cases:
 *  - sessionItemId exists but belongs to another student → degraded to null.
 *  - sessionItemId belongs to student but references a different session
 *    than sessionId → item degraded (relationship mismatch).
 *  - sessionId exists but belongs to another student → degraded to null.
 *  - questionRowId points to non-existent question → degraded to null.
 */
export async function resolveScope(
  studentId: string,
  sessionId: string | null,
  sessionItemId: string | null,
  questionRowId: string | null,
): Promise<ResolvedScope> {
  let validSessionId = sessionId;
  let validItemId = sessionItemId;
  let resolvedQuestionRowId = questionRowId;
  let canonicalId: string | null = null;

  // ── Validate session ownership (INV-03-14) ────────────────────────
  // @spec [Doc-03B_V2 §5.4 rule 5, §11.1]: source_session_id must
  // resolve to an existing row owned by the authenticated student.
  if (validSessionId) {
    const { data: sessionData, error: sessionError } = await supabaseServer
      .from("practice_sessions")
      .select("id")
      .eq("id", validSessionId)
      .eq("user_id", studentId)
      .maybeSingle();

    if (sessionError) {
      logger.error(
        "TUTOR_CONTEXT",
        "scope_session_query_failed",
        "practice_sessions ownership query failed; failing closed",
        { message: sessionError.message, code: sessionError.code },
      );
      throw new Error(
        `resolveScope: practice_sessions query failed: ${sessionError.message}`,
      );
    }

    if (!sessionData) {
      logger.warn(
        "TUTOR_CONTEXT",
        "scope_session_unowned",
        "practice_sessions row not found or not owned by student; degrading session scope",
        { sessionId: validSessionId },
      );
      validSessionId = null;
    }
  }

  // ── Validate session item ownership + relationship ────────────────
  // @spec [Doc-03B_V2 §5.4 rule 5, §11.2, INV-03-14]: session_item_id
  // must belong to an existing row owned by the authenticated student,
  // AND its session_id must match the claimed session (relationship
  // validation — a student cannot borrow their own session id with
  // someone else's item id).
  if (validItemId) {
    const { data: itemData, error: itemError } = await supabaseServer
      .from("practice_session_items")
      .select("question_id, session_id")
      .eq("id", validItemId)
      .eq("user_id", studentId)
      .maybeSingle();

    if (itemError) {
      logger.error(
        "TUTOR_CONTEXT",
        "scope_item_query_failed",
        "practice_session_items ownership query failed; failing closed",
        { message: itemError.message, code: itemError.code },
      );
      throw new Error(
        `resolveScope: practice_session_items query failed: ${itemError.message}`,
      );
    }

    if (!itemData) {
      // Not found or not owned — degrade per §5.3
      logger.warn(
        "TUTOR_CONTEXT",
        "scope_item_unowned",
        "practice_session_items row not found or not owned by student; degrading item scope",
        { sessionItemId: validItemId },
      );
      validItemId = null;
    } else {
      // Relationship validation: item's session must match the claimed session
      const itemSessionId = itemData.session_id as string;
      if (validSessionId && itemSessionId !== validSessionId) {
        logger.warn(
          "TUTOR_CONTEXT",
          "scope_item_session_mismatch",
          "session_item belongs to a different session than claimed; degrading item scope",
          { sessionItemId: validItemId, expectedSession: validSessionId },
        );
        validItemId = null;
      } else {
        resolvedQuestionRowId = itemData.question_id as string;
        // Anchor session to the item's session if no session was claimed
        if (!validSessionId) {
          validSessionId = itemSessionId;
        }
      }
    }
  }

  // ── No scoping context remaining: general mode ────────────────────
  if (!validItemId && !resolvedQuestionRowId) {
    const scope: ResolvedScope = {
      source_session_id: validSessionId,
      source_session_item_id: null,
      source_question_row_id: null,
      source_question_canonical_id: null,
    };
    const parsed = resolvedScopeSchema.safeParse(scope);
    if (!parsed.success) {
      logger.error(
        "TUTOR_CONTEXT",
        "scope_validation_failed",
        "General scope failed schema validation; failing closed",
        { errors: parsed.error.flatten() },
      );
      throw new Error("resolveScope: general scope failed validation");
    }
    return parsed.data;
  }

  // ── Resolve canonical ID from question row ────────────────────────
  // Questions are shared canonical content, not student-owned — existence
  // check only. The question_id was derived from the ownership-validated
  // session item above.
  if (resolvedQuestionRowId) {
    const { data: questionData, error: questionError } = await supabaseServer
      .from("questions")
      .select("id")
      .eq("id", resolvedQuestionRowId)
      .maybeSingle();

    if (questionError) {
      logger.error(
        "TUTOR_CONTEXT",
        "scope_question_query_failed",
        "questions query failed during scope resolution; failing closed",
        { message: questionError.message, code: questionError.code },
        { questionRowId: resolvedQuestionRowId },
      );
      throw new Error(
        `resolveScope: questions query failed: ${questionError.message}`,
      );
    }

    if (!questionData) {
      logger.warn(
        "TUTOR_CONTEXT",
        "scope_question_not_found",
        "Question row not found; degrading question scope",
        { questionRowId: resolvedQuestionRowId },
      );
      resolvedQuestionRowId = null;
    } else {
      // The canonical ID is the question ID itself (format: SAT[M|RW][1|2][A-Z0-9]{6})
      canonicalId = questionData.id as string;
    }
  }

  const scope: ResolvedScope = {
    source_session_id: validSessionId,
    source_session_item_id: validItemId,
    source_question_row_id: resolvedQuestionRowId,
    source_question_canonical_id: canonicalId,
  };

  const parsed = resolvedScopeSchema.safeParse(scope);
  if (!parsed.success) {
    logger.error(
      "TUTOR_CONTEXT",
      "scope_validation_failed",
      "Resolved scope failed schema validation; failing closed",
      { errors: parsed.error.flatten() },
    );
    throw new Error("resolveScope: resolved scope failed validation");
  }

  return parsed.data;
}

// ── Question Content Resolution ───────────────────────────────────────

/**
 * @spec [Doc-03A_V3 §5.4, Doc-03C_V3 §4.4, INV-03-04]
 * @implemented 2026-08-18
 *
 * plain English: Resolves question content from the practice_session_items
 * table. The table denormalizes question content alongside the student's
 * selected answer, so a single query provides everything. Ownership is
 * guaranteed by the user_id predicate (tutor-context.ts already queries
 * this table with ownership predicates — we do not weaken them).
 *
 * Anti-leak: explanation is set to null when isPostSubmit is false
 * (pre-submit). Gating keys on the server-derived boolean, never on
 * correctAnswer presence (Doc 03D §6.3). The correct_answer column is
 * NEVER included in the select — it does not appear on the wire.
 *
 * expected outcome: QuestionContent | null. Degrades to null on DB error
 * or missing session item (general mode).
 */
async function resolveQuestionContent(
  studentId: string,
  scope: z.infer<typeof resolvedScopeSchema>,
  isPostSubmit: boolean,
): Promise<QuestionContent | null> {
  // No session item → no question context (general mode)
  if (!scope.source_session_item_id) return null;

  try {
    const { data, error } = await supabaseServer
      .from("practice_session_items")
      .select(
        "question_stem, question_passage, question_options, question_item_type, " +
          "question_explanation, selected_answer, ordinal",
      )
      .eq("id", scope.source_session_item_id)
      .eq("user_id", studentId)
      .maybeSingle();

    if (error) {
      logger.warn(
        "TUTOR_CONTEXT",
        "question_content_query_failed",
        "Could not fetch question content; degrading to null",
        { message: error.message, code: error.code },
      );
      return null;
    }

    if (!data) {
      logger.warn(
        "TUTOR_CONTEXT",
        "question_content_not_found",
        "practice_session_items row not found for question content; degrading to null",
        { sessionItemId: scope.source_session_item_id },
      );
      return null;
    }

    // Parse options from JSONB — expected format: [{key: "A", text: "..."}, ...]
    const rawOptions = data.question_options as unknown;
    const options: Array<{ key: string; text: string }> = Array.isArray(
      rawOptions,
    )
      ? (rawOptions as Array<Record<string, unknown>>)
          .filter(
            (o): o is Record<string, unknown> & { key: string; text: string } =>
              typeof o === "object" &&
              o !== null &&
              typeof o["key"] === "string" &&
              typeof o["text"] === "string",
          )
          .map((o) => ({ key: o.key, text: o.text }))
      : [];

    const itemType =
      (data.question_item_type as string) === "grid_in"
        ? ("grid_in" as const)
        : ("mcq" as const);

    // Anti-leak gate (INV-03-04, Doc 03D §6.3): explanation is null
    // pre-submit. Gated on the server-derived isPostSubmit boolean,
    // never on correctAnswer presence — a caller-supplied field gating
    // a safety decision is a field an attacker sets (§6.3).
    const explanation = isPostSubmit
      ? ((data.question_explanation as string) ?? null)
      : null;

    return {
      stem: data.question_stem as string,
      passage: (data.question_passage as string) ?? null,
      options,
      item_type: itemType,
      explanation,
      student_answer: (data.selected_answer as string) ?? null,
      attempt_number: (data.ordinal as number) ?? 0,
    };
  } catch (err) {
    logger.warn(
      "TUTOR_CONTEXT",
      "question_content_unexpected_error",
      "Unexpected error resolving question content; degrading to null",
      { error: String(err) },
    );
    return null;
  }
}

// ── Learning Context Resolution ────────────────────────────────────────

/**
 * @spec [Doc-03A_V3.0 §5.4, §8.3]
 * @implemented 2026-08-09
 * plain English: Assembles the student learning context for a tutor turn:
 * mastery snapshot, recent friction signals, and KPI state. Each subsection
 * degrades gracefully to null on DB error so that one failing leg does not
 * block the entire envelope.
 *
 * expected outcome: a StudentLearningContext matching the wire schema.
 *
 * trade-offs: subsection DB errors are logged as warnings and return null
 * for that subsection. This is deliberate — the orchestrator can still
 * generate a useful response with partial context. Only a total failure
 * of all subsections would produce a fully-null learning context, which
 * the orchestrator handles as a cold-start scenario.
 *
 * edge cases: if scope has no question context (general mode), mastery
 * and KPI queries cannot filter by skill/domain. In that case, the
 * mastery snapshot scope is "all" and returns null for skill/domain
 * specifics.
 */
export async function resolveLearningContext(
  studentId: string,
  scope: ResolvedScope,
): Promise<StudentLearningContext> {
  const [masterySnapshot, recentFriction, kpiState] = await Promise.all([
    resolveMasterySnapshot(studentId, scope),
    resolveRecentFriction(studentId, scope),
    resolveKpiState(studentId, scope),
  ]);

  const context: StudentLearningContext = {
    mastery_snapshot: masterySnapshot,
    recent_friction: recentFriction,
    kpi_state: kpiState,
  };

  const parsed = studentLearningContextSchema.safeParse(context);
  if (!parsed.success) {
    logger.warn(
      "TUTOR_CONTEXT",
      "learning_context_validation_failed",
      "Assembled learning context failed validation; returning safe defaults",
      { studentId, errors: parsed.error.flatten() },
    );
    return {
      mastery_snapshot: null,
      recent_friction: {
        consecutive_fails_this_session: 0,
        consecutive_fails_this_skill_7d: 0,
        self_deprecating_language_detected: false,
        long_pause_detected: false,
        mastery_regression_14d: null,
      },
      kpi_state: null,
    };
  }

  return parsed.data;
}

// ── Mastery Snapshot ────────────────────────────────────────────────────

/**
 * @spec [Doc-03A_V3.0 §5.4 mastery_snapshot]
 * Queries student_skill_mastery and student_domain_mastery for the
 * skill/domain derived from scope's question. Returns null on DB error.
 */
async function resolveMasterySnapshot(
  studentId: string,
  scope: ResolvedScope,
): Promise<MasterySnapshot | null> {
  try {
    // If no question context, return a minimal "all" scope snapshot
    if (!scope.source_question_row_id) {
      return buildAllScopeSnapshot();
    }

    // Fetch question metadata to know skill/domain/section
    const { data: questionMeta, error: questionError } = await supabaseServer
      .from("questions")
      .select("section, domain, skill_codes")
      .eq("id", scope.source_question_row_id)
      .single();

    if (questionError || !questionMeta) {
      logger.warn(
        "TUTOR_CONTEXT",
        "mastery_question_meta_failed",
        "Could not fetch question metadata for mastery snapshot; degrading to null",
        { questionRowId: scope.source_question_row_id },
      );
      return null;
    }

    const section = questionMeta.section as "M" | "RW";
    const domain = questionMeta.domain as string;
    const skillCodes = questionMeta.skill_codes as string[];
    const primarySkill = skillCodes.length > 0 ? skillCodes[0] : null;

    // Fetch skill mastery
    let currentSkill: MasterySnapshot["current_skill"] = null;
    if (primarySkill) {
      const { data: skillMastery, error: skillError } = await supabaseServer
        .from("student_skill_mastery")
        .select(
          "skill, domain, section, mastery_score, mastery_level, event_count_total, last_event_occurred_at",
        )
        .eq("student_id", studentId)
        .eq("skill", primarySkill)
        .eq("domain", domain)
        .eq("section", section)
        .maybeSingle();

      if (skillError) {
        logger.warn(
          "TUTOR_CONTEXT",
          "mastery_skill_query_failed",
          "student_skill_mastery query failed; degrading skill to null",
          { message: skillError.message, studentId, skill: primarySkill },
        );
      } else if (skillMastery) {
        // Fetch recent 14-day activity for pass rate and attempt count
        const recentActivity = await fetchRecentSkillActivity(
          studentId,
          primarySkill,
          domain,
          section,
        );
        currentSkill = {
          skill: skillMastery.skill as string,
          domain: skillMastery.domain as string,
          section: skillMastery.section as "M" | "RW",
          mastery_score:
            skillMastery.mastery_score !== null
              ? Number(skillMastery.mastery_score)
              : null,
          mastery_level:
            skillMastery.mastery_level !== null
              ? Number(skillMastery.mastery_level)
              : null,
          attempts_14d: recentActivity.attempts,
          pass_rate_14d: recentActivity.passRate,
          last_event_at:
            (skillMastery.last_event_occurred_at as string) ?? null,
        };
      }
    }

    // Fetch domain mastery
    let currentDomain: MasterySnapshot["current_domain"] = null;
    const { data: domainMastery, error: domainError } = await supabaseServer
      .from("student_domain_mastery")
      .select("domain, section, mastery_score, mastery_level")
      .eq("student_id", studentId)
      .eq("domain", domain)
      .eq("section", section)
      .maybeSingle();

    if (domainError) {
      logger.warn(
        "TUTOR_CONTEXT",
        "mastery_domain_query_failed",
        "student_domain_mastery query failed; degrading domain to null",
        { message: domainError.message, studentId, domain },
      );
    } else if (domainMastery) {
      currentDomain = {
        domain: domainMastery.domain as string,
        section: domainMastery.section as "M" | "RW",
        mastery_score:
          domainMastery.mastery_score !== null
            ? Number(domainMastery.mastery_score)
            : null,
        mastery_level:
          domainMastery.mastery_level !== null
            ? Number(domainMastery.mastery_level)
            : null,
      };
    }

    // Fetch recent activity summary (7d/30d)
    const recentActivitySummary = await fetchRecentActivitySummary(studentId);

    const snapshot: MasterySnapshot = {
      scope: primarySkill ? "skill" : "domain",
      current_skill: currentSkill,
      current_domain: currentDomain,
      section_projection: null, // Populated by the projection service, not context resolver
      section_projection_trend: null,
      recent_activity_summary: recentActivitySummary,
    };

    const parsed = masterySnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      logger.warn(
        "TUTOR_CONTEXT",
        "mastery_snapshot_validation_failed",
        "Mastery snapshot failed validation; degrading to null",
        { studentId, errors: parsed.error.flatten() },
      );
      return null;
    }

    return parsed.data;
  } catch (err) {
    logger.warn(
      "TUTOR_CONTEXT",
      "mastery_snapshot_error",
      "Unexpected error building mastery snapshot; degrading to null",
      { studentId, error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}

/**
 * Returns a minimal mastery snapshot with "all" scope and null specifics.
 * Used when no question context is available (general entry mode).
 */
function buildAllScopeSnapshot(): MasterySnapshot {
  return {
    scope: "all",
    current_skill: null,
    current_domain: null,
    section_projection: null,
    section_projection_trend: null,
    recent_activity_summary: null,
  };
}

/**
 * Fetches 14-day attempt count and pass rate for a specific skill.
 */
async function fetchRecentSkillActivity(
  studentId: string,
  skill: string,
  domain: string,
  section: string,
): Promise<{ attempts: number; passRate: number | null }> {
  try {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data, error } = await supabaseServer
      .from("practice_session_items")
      .select("is_correct")
      .eq("user_id", studentId)
      .eq("question_skill", skill)
      .eq("question_domain", domain)
      .eq("question_section", section)
      .eq("status", "answered")
      .gte("occurred_at", fourteenDaysAgo.toISOString());

    if (error || !data) {
      return { attempts: 0, passRate: null };
    }

    const attempts = data.length;
    if (attempts === 0) {
      return { attempts: 0, passRate: null };
    }

    const correct = data.filter(
      (row) => (row as { is_correct: boolean }).is_correct === true,
    ).length;
    const passRate = correct / attempts;

    return { attempts, passRate };
  } catch {
    return { attempts: 0, passRate: null };
  }
}

/**
 * Fetches recent activity summary (skills practiced in 7d, skills with fails in 7d,
 * skills newly mastered in 30d).
 */
async function fetchRecentActivitySummary(
  studentId: string,
): Promise<MasterySnapshot["recent_activity_summary"]> {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentItems, error } = await supabaseServer
      .from("practice_session_items")
      .select("question_skill, is_correct")
      .eq("user_id", studentId)
      .eq("status", "answered")
      .gte("occurred_at", sevenDaysAgo.toISOString());

    if (error || !recentItems) {
      return null;
    }

    const skillsPracticed = new Set<string>();
    const skillsWithFails = new Set<string>();

    for (const item of recentItems) {
      const row = item as { question_skill: string; is_correct: boolean };
      skillsPracticed.add(row.question_skill);
      if (row.is_correct === false) {
        skillsWithFails.add(row.question_skill);
      }
    }

    return {
      skills_practiced_7d: Array.from(skillsPracticed),
      skills_with_fails_7d: Array.from(skillsWithFails),
      skills_newly_mastered_30d: null, // Requires comparing mastery snapshots over time; deferred
    };
  } catch {
    return null;
  }
}

// ── Recent Friction ────────────────────────────────────────────────────

/**
 * @spec [Doc-03A_V3.0 §5.4 recent_friction]
 * Computes friction signals from recent practice activity and tutor
 * interaction patterns. Returns safe defaults on error.
 */
async function resolveRecentFriction(
  studentId: string,
  scope: ResolvedScope,
): Promise<RecentFriction> {
  const safeFriction: RecentFriction = {
    consecutive_fails_this_session: 0,
    consecutive_fails_this_skill_7d: 0,
    self_deprecating_language_detected: false,
    long_pause_detected: false,
    mastery_regression_14d: null,
  };

  try {
    // ── Consecutive fails this session ──────────────────────────────
    // @spec [INV-03-14]: ownership predicate prevents cross-student
    // session data from entering friction signals.
    let consecutiveFailsSession = 0;
    if (scope.source_session_id) {
      const { data: sessionItems, error: sessionError } = await supabaseServer
        .from("practice_session_items")
        .select("is_correct")
        .eq("session_id", scope.source_session_id)
        .eq("user_id", studentId)
        .eq("status", "answered")
        .order("ordinal", { ascending: false });

      if (!sessionError && sessionItems) {
        for (const item of sessionItems) {
          if ((item as { is_correct: boolean }).is_correct === false) {
            consecutiveFailsSession++;
          } else {
            break;
          }
        }
      }
    }

    // ── Consecutive fails this skill (7d) ───────────────────────────
    let consecutiveFailsSkill7d = 0;
    if (scope.source_question_row_id) {
      const { data: questionMeta } = await supabaseServer
        .from("questions")
        .select("skill_codes, domain, section")
        .eq("id", scope.source_question_row_id)
        .single();

      if (questionMeta) {
        const skillCodes = questionMeta.skill_codes as string[];
        const primarySkill = skillCodes.length > 0 ? skillCodes[0] : null;

        if (primarySkill) {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

          const { data: skillItems, error: skillError } = await supabaseServer
            .from("practice_session_items")
            .select("is_correct")
            .eq("user_id", studentId)
            .eq("question_skill", primarySkill)
            .eq("status", "answered")
            .gte("occurred_at", sevenDaysAgo.toISOString())
            .order("occurred_at", { ascending: false });

          if (!skillError && skillItems) {
            for (const item of skillItems) {
              if ((item as { is_correct: boolean }).is_correct === false) {
                consecutiveFailsSkill7d++;
              } else {
                break;
              }
            }
          }
        }
      }
    }

    // ── Self-deprecating language detection ──────────────────────────
    // Scan recent tutor_messages for self-deprecation patterns
    let selfDeprecating = false;
    if (scope.source_session_id) {
      const { data: recentStudentMessages, error: msgError } =
        await supabaseServer
          .from("tutor_messages")
          .select("message")
          .eq("conversation_id", scope.source_session_id)
          .eq("role", "student")
          .order("created_at", { ascending: false })
          .limit(5);

      if (!msgError && recentStudentMessages) {
        for (const msg of recentStudentMessages) {
          const text = (msg as { message: string }).message;
          selfDeprecating = detectsSelfDeprecatingLanguage(text);
          if (selfDeprecating) break;
        }
      }
    }

    // ── Long pause detection ─────────────────────────────────────────
    let longPause = false;
    if (scope.source_session_id) {
      const longPauseThresholdSeconds = TutorConfig.get(
        "friction_long_pause_seconds",
      );

      const { data: lastTwoStudentMessages, error: pauseError } =
        await supabaseServer
          .from("tutor_messages")
          .select("created_at")
          .eq("conversation_id", scope.source_session_id)
          .eq("role", "student")
          .order("created_at", { ascending: false })
          .limit(2);

      if (
        !pauseError &&
        lastTwoStudentMessages &&
        lastTwoStudentMessages.length === 2
      ) {
        const recent = new Date(
          (lastTwoStudentMessages[0] as { created_at: string }).created_at,
        );
        const previous = new Date(
          (lastTwoStudentMessages[1] as { created_at: string }).created_at,
        );
        const gapSeconds = (recent.getTime() - previous.getTime()) / 1000;
        if (gapSeconds >= longPauseThresholdSeconds) {
          longPause = true;
        }
      }
    }

    // ── Mastery regression (14d) ────────────────────────────────────
    // Check if mastery for the scoped skill has decreased over 14d
    let masteryRegression: boolean | null = null;
    if (scope.source_question_row_id) {
      const { data: questionMeta } = await supabaseServer
        .from("questions")
        .select("skill_codes, domain, section")
        .eq("id", scope.source_question_row_id)
        .single();

      if (questionMeta) {
        const skillCodes = questionMeta.skill_codes as string[];
        const primarySkill = skillCodes.length > 0 ? skillCodes[0] : null;

        if (primarySkill) {
          const { data: currentMastery } = await supabaseServer
            .from("student_skill_mastery")
            .select("mastery_score, computed_at")
            .eq("student_id", studentId)
            .eq("skill", primarySkill)
            .eq("domain", questionMeta.domain as string)
            .eq("section", questionMeta.section as string)
            .maybeSingle();

          if (currentMastery && currentMastery.mastery_score !== null) {
            const fourteenDaysAgo = new Date();
            fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
            const computedAt = new Date(currentMastery.computed_at as string);

            // If the mastery row was computed within 14d, check for regression
            // by comparing event_count changes. Simple heuristic: if mastery
            // score < 0.5 and there are recent fails, flag regression.
            // A full regression detector would compare historical snapshots.
            if (computedAt >= fourteenDaysAgo) {
              const recentActivity = await fetchRecentSkillActivity(
                studentId,
                primarySkill,
                questionMeta.domain as string,
                questionMeta.section as string,
              );
              if (
                recentActivity.passRate !== null &&
                recentActivity.passRate < 0.5 &&
                recentActivity.attempts >= 3
              ) {
                masteryRegression = true;
              } else {
                masteryRegression = false;
              }
            }
          }
        }
      }
    }

    const friction: RecentFriction = {
      consecutive_fails_this_session: consecutiveFailsSession,
      consecutive_fails_this_skill_7d: consecutiveFailsSkill7d,
      self_deprecating_language_detected: selfDeprecating,
      long_pause_detected: longPause,
      mastery_regression_14d: masteryRegression,
    };

    const parsed = recentFrictionSchema.safeParse(friction);
    if (!parsed.success) {
      logger.warn(
        "TUTOR_CONTEXT",
        "friction_validation_failed",
        "Recent friction failed validation; returning safe defaults",
        { studentId, errors: parsed.error.flatten() },
      );
      return safeFriction;
    }

    return parsed.data;
  } catch (err) {
    logger.warn(
      "TUTOR_CONTEXT",
      "friction_resolution_error",
      "Unexpected error resolving friction; returning safe defaults",
      { studentId, error: err instanceof Error ? err.message : String(err) },
    );
    return safeFriction;
  }
}

// ── KPI State ──────────────────────────────────────────────────────────

/**
 * @spec [Doc-03A_V3.0 §5.4 kpi_state]
 * Queries student_kpi_rollups_current for skill, domain, and section KPI
 * snapshots. Returns null on DB error.
 */
async function resolveKpiState(
  studentId: string,
  scope: ResolvedScope,
): Promise<KpiState | null> {
  try {
    if (!scope.source_question_row_id) {
      return null;
    }

    // Fetch question metadata for scope keys
    const { data: questionMeta, error: questionError } = await supabaseServer
      .from("questions")
      .select("section, domain, skill_codes")
      .eq("id", scope.source_question_row_id)
      .single();

    if (questionError || !questionMeta) {
      logger.warn(
        "TUTOR_CONTEXT",
        "kpi_question_meta_failed",
        "Could not fetch question metadata for KPI state; degrading to null",
        { questionRowId: scope.source_question_row_id },
      );
      return null;
    }

    const section = questionMeta.section as string;
    const domain = questionMeta.domain as string;
    const skillCodes = questionMeta.skill_codes as string[];
    const primarySkill = skillCodes.length > 0 ? skillCodes[0] : null;

    // Fetch all KPI rollups for this student in one query
    const { data: rollups, error: rollupError } = await supabaseServer
      .from("student_kpi_rollups_current")
      .select("scope, scope_key, payload")
      .eq("student_id", studentId);

    if (rollupError) {
      logger.warn(
        "TUTOR_CONTEXT",
        "kpi_rollup_query_failed",
        "student_kpi_rollups_current query failed; degrading to null",
        { message: rollupError.message, studentId },
      );
      return null;
    }

    if (!rollups || rollups.length === 0) {
      return null;
    }

    // Extract matching rollups by scope
    let skillKpi: KpiState["skill_kpi"] = null;
    let domainKpi: KpiState["domain_kpi"] = null;
    let sectionKpi: KpiState["section_kpi"] = null;

    for (const rollup of rollups) {
      const r = rollup as {
        scope: string;
        scope_key: string;
        payload: Record<string, unknown>;
      };

      if (r.scope === "skill" && primarySkill && r.scope_key === primarySkill) {
        skillKpi = extractKpiPayload(r.payload);
      } else if (r.scope === "domain" && r.scope_key === domain) {
        domainKpi = extractKpiPayload(r.payload);
      } else if (r.scope === "section" && r.scope_key === section) {
        const sectionPayload = extractKpiPayload(r.payload);
        if (sectionPayload) {
          sectionKpi = {
            ...sectionPayload,
            current_streak_days:
              typeof r.payload.current_streak_days === "number"
                ? r.payload.current_streak_days
                : 0,
          };
        }
      }
    }

    const kpiState: KpiState = {
      skill_kpi: skillKpi,
      domain_kpi: domainKpi,
      section_kpi: sectionKpi,
    };

    const parsed = kpiStateSchema.safeParse(kpiState);
    if (!parsed.success) {
      logger.warn(
        "TUTOR_CONTEXT",
        "kpi_state_validation_failed",
        "KPI state failed validation; degrading to null",
        { studentId, errors: parsed.error.flatten() },
      );
      return null;
    }

    return parsed.data;
  } catch (err) {
    logger.warn(
      "TUTOR_CONTEXT",
      "kpi_state_error",
      "Unexpected error resolving KPI state; degrading to null",
      { studentId, error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}

/**
 * Extracts standardised KPI fields from a rollup payload.
 */
function extractKpiPayload(payload: Record<string, unknown>): {
  events_total: number;
  events_last_7d: number;
  events_last_30d: number;
  accuracy_overall: number | null;
  accuracy_last_7d: number | null;
  accuracy_last_30d: number | null;
} | null {
  if (!payload) return null;

  return {
    events_total:
      typeof payload.events_total === "number" ? payload.events_total : 0,
    events_last_7d:
      typeof payload.events_last_7d === "number" ? payload.events_last_7d : 0,
    events_last_30d:
      typeof payload.events_last_30d === "number" ? payload.events_last_30d : 0,
    accuracy_overall:
      typeof payload.accuracy_overall === "number"
        ? payload.accuracy_overall
        : null,
    accuracy_last_7d:
      typeof payload.accuracy_last_7d === "number"
        ? payload.accuracy_last_7d
        : null,
    accuracy_last_30d:
      typeof payload.accuracy_last_30d === "number"
        ? payload.accuracy_last_30d
        : null,
  };
}

// ── Policy Assignment ──────────────────────────────────────────────────

/**
 * @spec [Doc-03A_V3.0 §5 policy_assignment]
 * Returns a deterministic default policy assignment. A dedicated policy
 * service will be extracted in a later workstream; for now the assignment
 * is hardcoded to the base policy family.
 *
 * expected outcome: a valid PolicyAssignment for the orchestrator.
 */
function resolveDefaultPolicy(
  studentId: string,
  entryMode: string,
): z.infer<typeof policyAssignmentSchema> {
  return {
    policy_family: "instructional_tutor",
    policy_variant: "scaffolded",
    policy_version: "1.0.0",
    prompt_version: null,
    assignment_mode: "deterministic" as const,
    assignment_key: `${studentId}:${entryMode}`,
    reason_snapshot: {
      reason: "default_deterministic_assignment",
      entry_mode: entryMode,
    },
  };
}

// ── Curriculum Retrieval Resolution ────────────────────────────────────

/**
 * @spec [Doc-03D_V1.2 §6.6, §6.8, SCL-043]
 * @implemented 2026-08-28
 *
 * plain English: Resolves retrieved curriculum items (question explanations
 * and future RAG content) for the tutor prompt. Degrades gracefully to an
 * empty array on any error — retrieval is additive context, not a turn
 * blocker. The retrieval path applies the SCL-043 scope filter: active
 * question's explanation INCLUDED pre-submit, unseen same-skill EXCLUDED.
 *
 * Anti-leak: explanation travels on the separate `retrieved_curriculum`
 * field, NOT on `question_content.explanation` (which remains null
 * pre-submit per INV-03-04). The output serializer (INV-03-04) is the
 * sole defense against the model echoing retrieval content to the student.
 *
 * expected outcome: RetrievedCurriculumItem[] for the envelope, empty on
 * degradation.
 *
 * trade-offs: queries the questions table for skill_codes — a second query
 * when resolveLearningContext already queries it. Acceptable at V1; a shared
 * scope-enrichment step can deduplicate later.
 */
async function resolveCurriculumSafe(
  studentId: string,
  scope: ResolvedScope,
  isPostSubmit: boolean,
  sourceSurface: "practice" | "review" | "test_review" | "dashboard",
): Promise<z.infer<typeof retrievedCurriculumItemSchema>[]> {
  // Retrieval requires a question context — general mode has nothing to retrieve
  if (!scope.source_question_row_id) return [];

  try {
    // Fetch skill codes for the active question
    const { data: questionMeta, error: questionError } = await supabaseServer
      .from("questions")
      .select("skill_codes")
      .eq("id", scope.source_question_row_id)
      .single();

    if (questionError || !questionMeta) {
      logger.warn(
        "TUTOR_CONTEXT",
        "curriculum_skill_codes_query_failed",
        "Could not fetch skill_codes for curriculum retrieval; degrading to empty",
        {
          error: questionError?.message ?? "no data",
          questionRowId: scope.source_question_row_id,
        },
      );
      return [];
    }

    const skillCodes = questionMeta.skill_codes as string[];
    if (!skillCodes || skillCodes.length === 0) return [];

    // Map source_surface to retrieval surface (dashboard has no question context)
    const retrievalSurface: "practice" | "review" | "test_review" =
      sourceSurface === "dashboard" ? "practice" : sourceSurface;

    const response = await retrieveCurriculum({
      active_skill_codes: skillCodes,
      is_pre_submit: !isPostSubmit,
      active_question_canonical_id:
        scope.source_question_canonical_id ?? null,
      student_id: studentId,
      max_items: 5,
      surface: retrievalSurface,
    });

    // Map RetrievedItem[] to RetrievedCurriculumItem[] (identical shape)
    return response.items.map((item) => ({
      content: item.content,
      skill_codes: item.skill_codes,
      provenance: item.provenance,
      surface_gate: item.surface_gate,
      content_type: item.content_type,
    }));
  } catch (err: unknown) {
    logger.warn(
      "TUTOR_CONTEXT",
      "curriculum_retrieval_unexpected_error",
      "Unexpected error resolving curriculum retrieval; degrading to empty",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return [];
  }
}

// ── Full Envelope Resolution ───────────────────────────────────────────

/**
 * @spec [Doc-03B_V2 §6.5 steps 9-10, §5.4 rule 5, INV-03-14]
 * @implemented 2026-08-12
 * plain English: The main entry point for context resolution. Orchestrates
 * all resolution steps (scope, learning context, memory summaries,
 * structured fields, policy) into a complete OrchestrateRequest, then
 * validates it against the wire schema before returning. Scope resolution
 * carries student-ownership predicates (INV-03-14) to prevent cross-student
 * data from entering the envelope.
 *
 * expected outcome: a fully assembled and Zod-validated OrchestrateRequest
 * ready for dispatch to the tutor orchestrator worker. Every student-
 * scoped field in resolved_scope is proven to belong to params.studentId.
 *
 * trade-offs: scope resolution fails closed on DB errors (blocks the turn)
 * and degrades on unowned/missing references (per §5.3). All other
 * subsections degrade gracefully (null/empty). Memory summaries and
 * structured fields use tutor-memory.ts; if that service throws, the
 * subsection degrades to empty/null rather than blocking the turn.
 *
 * edge cases: final Zod validation should never fail because each
 * subsection is individually validated. If it does, we throw to prevent
 * dispatching a malformed payload — belt-and-suspenders.
 */
export async function resolveFullEnvelope(
  params: EnvelopeParams,
): Promise<OrchestrateRequest> {
  // ── Step 1: Scope resolution (fails closed) ────────────────────────
  // @spec [Doc-03B_V2 §5.4 rule 5, INV-03-14]: studentId is passed to
  // resolveScope so every student-scoped query carries an ownership
  // predicate in its WHERE clause.
  const resolvedScope = await resolveScope(
    params.studentId,
    params.sourceSessionId,
    params.sourceSessionItemId,
    params.sourceQuestionRowId,
  );

  // ── Step 2: Parallel resolution of remaining subsections ───────────
  const [
    learningContext,
    memorySummaries,
    structuredFields,
    questionContent,
    retrievedCurriculum,
  ] = await Promise.all([
    resolveLearningContext(params.studentId, resolvedScope),
    resolveMemorySummariesSafe(params.studentId),
    resolveStructuredFieldsSafe(params.studentId),
    resolveQuestionContent(
      params.studentId,
      resolvedScope,
      params.isPostSubmit,
    ),
    resolveCurriculumSafe(
      params.studentId,
      resolvedScope,
      params.isPostSubmit,
      params.sourceSurface,
    ),
  ]);

  // ── Step 3: Policy assignment (deterministic default) ──────────────
  const policyAssignment = resolveDefaultPolicy(
    params.studentId,
    params.entryMode,
  );

  // ── Step 4: Assemble the envelope ──────────────────────────────────
  const envelope: OrchestrateRequest = {
    conversation_id: params.conversationId,
    student_id: params.studentId,
    entry_mode: params.entryMode,
    source_surface: params.sourceSurface,
    resolved_scope: resolvedScope,
    recent_messages: params.recentMessages,
    memory_summaries: memorySummaries,
    student_learning_context: learningContext,
    memory_structured_fields: structuredFields,
    policy_assignment: policyAssignment,
    runtime_limits: {
      max_output_tokens: params.runtimeLimits.maxOutputTokens,
      timeout_ms: params.runtimeLimits.timeoutMs,
    },
    // Question content (Doc 03A §5.4, Doc 03C §4.4): CONTENT, never canonical ID.
    // Anti-leak: explanation already gated null pre-submit in resolveQuestionContent.
    question_content: questionContent,
    // Retrieved curriculum items (Doc 03D §6.6, §6.8, SCL-043).
    // Travels on a SEPARATE field — question_content.explanation remains null
    // pre-submit (INV-03-04). The retrieval path applies the SCL-043 scope
    // filter. INV-03-04 (output serializer) is sole defense against echo.
    retrieved_curriculum: retrievedCurriculum,
    // Server-derived post-submit flag (Doc 03D §6.3): resolved from
    // practice_session_items.status by isPreSubmitForSurface. The worker
    // reads this to gate answer/explanation in the prompt — never derives
    // post-submit state from correct_answer presence.
    // @spec [Doc-03D_V1.2 §6.3, INV-03-04]
    is_post_submit: params.isPostSubmit,
    // Anti-leak (INV-03-04, Doc 03D §6.3): correct_answer is null on the
    // wire pre-submit. The BFF keeps the real value BFF-local for the
    // output scan (Doc 03B §6.5 step 15) but never forwards it to the
    // worker pre-submit. Post-submit: the real value for model explanation.
    correct_answer: params.isPostSubmit ? params.correctAnswer : null,
    // Model Armor template IDs (Karl ruling: BFF passes, worker stays stateless).
    // @spec [Doc-03B_V4.1 §12B.8, ADR-001]
    model_armor_input_template_id:
      TutorConfig.get("model_armor_input_template_id") || null,
    model_armor_output_template_id:
      TutorConfig.get("model_armor_output_template_id") || null,
  };

  // ── Step 5: Belt-and-suspenders final validation ───────────────────
  const parsed = orchestrateRequestSchema.safeParse(envelope);
  if (!parsed.success) {
    logger.error(
      "TUTOR_CONTEXT",
      "envelope_validation_failed",
      "Assembled OrchestrateRequest failed final validation; failing closed",
      {
        studentId: params.studentId,
        conversationId: params.conversationId,
        errors: parsed.error.flatten(),
      },
    );
    throw new Error(
      `resolveFullEnvelope: final envelope validation failed: ${parsed.error.message}`,
    );
  }

  logger.info(
    "TUTOR_CONTEXT",
    "envelope_resolved",
    "Full context envelope resolved and validated",
    {
      conversationId: params.conversationId,
      entryMode: params.entryMode,
      hasMastery: learningContext.mastery_snapshot !== null,
      hasKpi: learningContext.kpi_state !== null,
      memorySummaryCount: memorySummaries.length,
      hasStructuredFields:
        structuredFields.last_struggled_skill !== null ||
        structuredFields.last_mastered_skill !== null,
      hasQuestionContent: questionContent !== null,
    },
  );

  return parsed.data;
}

// ── Safe wrappers for memory service ───────────────────────────────────

/**
 * Wraps getMemorySummaries with graceful degradation — returns empty
 * array on error so memory failures do not block the envelope.
 */
async function resolveMemorySummariesSafe(
  studentId: string,
): Promise<z.infer<typeof memorySummarySchema>[]> {
  try {
    return await getMemorySummaries(studentId);
  } catch (err) {
    logger.warn(
      "TUTOR_CONTEXT",
      "memory_summaries_degraded",
      "Memory summaries fetch failed; degrading to empty array",
      { studentId, error: err instanceof Error ? err.message : String(err) },
    );
    return [];
  }
}

/**
 * Wraps getStructuredFields with graceful degradation — returns all-null
 * fields on error so memory failures do not block the envelope.
 */
async function resolveStructuredFieldsSafe(
  studentId: string,
): Promise<MemoryStructuredFields> {
  try {
    return await getStructuredFields(studentId);
  } catch (err) {
    logger.warn(
      "TUTOR_CONTEXT",
      "structured_fields_degraded",
      "Structured fields fetch failed; degrading to null fields",
      { studentId, error: err instanceof Error ? err.message : String(err) },
    );
    return {
      last_struggled_skill: null,
      last_mastered_skill: null,
      preferred_explanation_style: null,
      style_confidence: null,
    };
  }
}

// ── Re-export for backward compatibility ───────────────────────────────

/**
 * Anti-leak scanner lives in tutor-antileak.ts, NOT here — this module
 * re-exports it for backward compat with ws2-antileak.ci.test.ts.
 */
export { hasAnswerLeak } from "./tutor-antileak";

// ── Exported types ────────────────────────────────────────────────────

export type { ResolvedScope, EnvelopeParams };
