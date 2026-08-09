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
} from "../../apps/workers/tutor-orchestrator/src/lib/_tutor-orchestrator-wire.generated";
import type {
  OrchestrateRequest,
  StudentLearningContext,
  RecentFriction,
  MasterySnapshot,
  KpiState,
  MemoryStructuredFields,
} from "../../apps/workers/tutor-orchestrator/src/lib/_tutor-orchestrator-wire.generated";
import { getMemorySummaries, getStructuredFields } from "./tutor-memory";
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
};

// ── Self-deprecation keywords (V1 simple scan) ─────────────────────────

const SELF_DEPRECATING_PATTERNS: ReadonlyArray<RegExp> = [
  /i['']?m\s+(?:so\s+)?(?:stupid|dumb|bad\s+at\s+this|terrible|hopeless)/i,
  /i\s+(?:can['']?t|cannot)\s+do\s+(?:this|anything|math)/i,
  /i['']?ll\s+never\s+(?:get|understand|learn)\s+this/i,
  /i\s+(?:hate|suck\s+at)\s+(?:this|math|reading)/i,
  /i\s+give\s+up/i,
  /what['']?s\s+the\s+point/i,
  /too\s+(?:stupid|dumb)\s+for/i,
];

// ── Scope Resolution ───────────────────────────────────────────────────

/**
 * @spec [Doc-03A_V3.0 §5.2]
 * @implemented 2026-08-09
 * plain English: Resolves the source scope for the current tutor turn.
 * If sessionItemId is provided, queries practice_session_items for the
 * question FK and canonical ID. If questionRowId is provided, uses it
 * directly. Both paths resolve the canonical question ID from the
 * questions table.
 *
 * expected outcome: a ResolvedScope with all four fields populated
 * (nullable where no source context exists).
 *
 * trade-offs: fails closed on DB error — the orchestrator cannot function
 * without scope context, so a failed resolution must block the turn.
 *
 * edge cases: if sessionItemId points to a non-existent row, throws.
 * If questionRowId is provided but the question does not exist, throws.
 */
export async function resolveScope(
  sessionId: string | null,
  sessionItemId: string | null,
  questionRowId: string | null,
): Promise<ResolvedScope> {
  // ── No scoping context: general mode ──────────────────────────────
  if (!sessionItemId && !questionRowId) {
    const scope: ResolvedScope = {
      source_session_id: sessionId,
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

  // ── Resolve question_id from session item if needed ────────────────
  let resolvedQuestionRowId: string | null = questionRowId;

  if (sessionItemId) {
    const { data: itemData, error: itemError } = await supabaseServer
      .from("practice_session_items")
      .select("question_id, session_id")
      .eq("id", sessionItemId)
      .single();

    if (itemError) {
      logger.error(
        "TUTOR_CONTEXT",
        "scope_item_query_failed",
        "practice_session_items query failed during scope resolution; failing closed",
        { message: itemError.message, code: itemError.code },
        { sessionItemId },
      );
      throw new Error(
        `resolveScope: practice_session_items query failed: ${itemError.message}`,
      );
    }

    if (!itemData) {
      logger.error(
        "TUTOR_CONTEXT",
        "scope_item_not_found",
        "practice_session_items row not found; failing closed",
        { sessionItemId },
      );
      throw new Error(
        `resolveScope: practice_session_items row not found for id ${sessionItemId}`,
      );
    }

    resolvedQuestionRowId = itemData.question_id as string;
  }

  // ── Resolve canonical ID from question row ─────────────────────────
  let canonicalId: string | null = null;

  if (resolvedQuestionRowId) {
    const { data: questionData, error: questionError } = await supabaseServer
      .from("questions")
      .select("id")
      .eq("id", resolvedQuestionRowId)
      .single();

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
      logger.error(
        "TUTOR_CONTEXT",
        "scope_question_not_found",
        "Question row not found; failing closed",
        { questionRowId: resolvedQuestionRowId },
      );
      throw new Error(
        `resolveScope: question not found for id ${resolvedQuestionRowId}`,
      );
    }

    // The canonical ID is the question ID itself (format: SAT[M|RW][1|2][A-Z0-9]{6})
    canonicalId = questionData.id as string;
  }

  const scope: ResolvedScope = {
    source_session_id: sessionId,
    source_session_item_id: sessionItemId,
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
    let consecutiveFailsSession = 0;
    if (scope.source_session_id) {
      const { data: sessionItems, error: sessionError } = await supabaseServer
        .from("practice_session_items")
        .select("is_correct")
        .eq("session_id", scope.source_session_id)
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
          for (const pattern of SELF_DEPRECATING_PATTERNS) {
            if (pattern.test(text)) {
              selfDeprecating = true;
              break;
            }
          }
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
    policy_family: "base_v1",
    policy_variant: "standard",
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

// ── Full Envelope Resolution ───────────────────────────────────────────

/**
 * @spec [Doc-03B_V2 §6.5 steps 9-10]
 * @implemented 2026-08-09
 * plain English: The main entry point for context resolution. Orchestrates
 * all resolution steps (scope, learning context, memory summaries,
 * structured fields, policy) into a complete OrchestrateRequest, then
 * validates it against the wire schema before returning.
 *
 * expected outcome: a fully assembled and Zod-validated OrchestrateRequest
 * ready for dispatch to the tutor orchestrator worker.
 *
 * trade-offs: scope resolution fails closed (blocks the turn). All other
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
  const resolvedScope = await resolveScope(
    params.sourceSessionId,
    params.sourceSessionItemId,
    params.sourceQuestionRowId,
  );

  // ── Step 2: Parallel resolution of remaining subsections ───────────
  const [learningContext, memorySummaries, structuredFields] =
    await Promise.all([
      resolveLearningContext(params.studentId, resolvedScope),
      resolveMemorySummariesSafe(params.studentId),
      resolveStructuredFieldsSafe(params.studentId),
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
    // Anti-leak field (LISA-FULL-001): BFF resolves; worker scans when non-null.
    // @spec [INV-03-04, Doc-03B_V4.1 §6.5 step 15]
    correct_answer: params.correctAnswer,
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
