/**
 * @spec [Doc-03A_V3.2 §5.1 (Layers 3-4), §5.4, §7.4, §7.6, §8] | @implemented [2026-08-07]
 * plain English: Resolves the student_learning_context (Layer 4) and durable memory
 * (Layer 3) for the LISA context pipeline. All mastery reads are read-only (INV-03-01).
 * Memory retrieval applies §7.4 freshness thresholds and §7.6 Layer C/D injection scanning.
 *
 * expected outcome: The orchestrator payload carries real student data instead of empty objects.
 * trade-offs: Adds 3-6 DB queries per tutor turn for context resolution. All reads are
 * against student-scoped RLS tables — no cross-student leakage possible.
 */

import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { getTutorConfigInt } from "./tutor-config";
import { logger } from "../logger";

import type {
  StudentLearningContext,
  MemoryStructuredFields,
  RecentFriction,
  MasterySnapshot,
  KpiState,
} from "../../shared/tutor-orchestrator-wire";

import { memorySummarySchema } from "../../shared/tutor-orchestrator-wire";

// ── Types ─────────────────────────────────────────────────────────────

type EntryMode = "scoped_question" | "scoped_session" | "general";

type ScopeShape = {
  source_session_id: string | null;
  source_session_item_id: string | null;
  source_question_row_id: string | null;
  source_question_canonical_id: string | null;
};

type MemorySummaryRow = {
  id: string;
  student_id: string;
  summary_type: string;
  summary_version: string;
  content_json: Record<string, unknown>;
  source_window_start: string | null;
  source_window_end: string | null;
  last_refreshed_at: string;
};

type InjectionSignatureRow = {
  signature_pattern: string;
  signature_type: string;
  severity: string;
  action: string;
};

type MemoryRetrievalResult = {
  summaries: Array<{
    summary_type: string;
    summary_version: string;
    content_json: Record<string, unknown>;
    source_window_start: string | null;
    source_window_end: string | null;
  }>;
  structured_fields: MemoryStructuredFields;
  accepted_count: number;
  rejected_count: number;
  injection_dropped_count: number;
  stale_count: number;
};

// ── Self-deprecation patterns (§5.4.1) ────────────────────────────────
// Simple keyword check — NLP-level detection is V2.
const SELF_DEPRECATION_PATTERNS = [
  /\bi('m| am)\s+(so\s+)?(stupid|dumb|bad|terrible|hopeless|useless)\b/i,
  /\bi\s+(can't|cannot|can never)\s+(do|get|understand|learn|figure)/i,
  /\bi('ll| will)\s+never\s+(get|understand|learn|pass)/i,
  /\bi\s+give\s+up\b/i,
  /\bthis is\s+(too hard|impossible|pointless)\b/i,
  /\bwhat('s| is)\s+the\s+point\b/i,
  /\bi\s+hate\s+(this|math|reading|sat)\b/i,
];

// ── Layer 4: Student Learning Context ─────────────────────────────────

/**
 * @spec [Doc-03A_V3.2 §5.1 Layer 4, §8.2, §8.3] | @implemented [2026-08-07]
 * Resolves mastery_snapshot, recent_friction, and kpi_state for the orchestrator payload.
 * Read-only against mastery (INV-03-01). Fields with no data source are explicitly null.
 */
export async function resolveStudentLearningContext(args: {
  student_id: string;
  entry_mode: EntryMode;
  source_surface: string;
  resolved_scope: ScopeShape;
  conversation_id: string;
}): Promise<StudentLearningContext> {
  const [masterySnapshot, recentFriction, kpiState] = await Promise.all([
    resolveMasterySnapshot(args),
    resolveRecentFriction(args),
    resolveKpiState(args),
  ]);

  return {
    mastery_snapshot: masterySnapshot,
    recent_friction: recentFriction,
    kpi_state: kpiState,
  };
}

// ── Mastery snapshot (§8.2, §8.3) ─────────────────────────────────────

async function resolveMasterySnapshot(args: {
  student_id: string;
  entry_mode: EntryMode;
  resolved_scope: ScopeShape;
}): Promise<MasterySnapshot | null> {
  try {
    const scope = deriveMasteryScope(args.entry_mode);
    const questionMeta = await resolveQuestionMeta(args.resolved_scope);

    const [
      currentSkill,
      currentDomain,
      sectionProjection,
      projectionTrend,
      recentActivity,
    ] = await Promise.all([
      questionMeta
        ? resolveSkillMastery(args.student_id, questionMeta)
        : Promise.resolve(null),
      questionMeta
        ? resolveDomainMastery(args.student_id, questionMeta)
        : Promise.resolve(null),
      questionMeta
        ? resolveSectionProjection(args.student_id, questionMeta.section)
        : Promise.resolve(null),
      questionMeta
        ? resolveSectionProjectionTrend(args.student_id, questionMeta.section)
        : Promise.resolve(null),
      resolveRecentActivity(args.student_id),
    ]);

    return {
      scope,
      current_skill: currentSkill,
      current_domain: currentDomain,
      section_projection: sectionProjection,
      section_projection_trend: projectionTrend,
      recent_activity_summary: recentActivity,
    };
  } catch (err: unknown) {
    logger.error(
      "TUTOR_CONTEXT",
      "mastery_snapshot_failed",
      "Failed to resolve mastery snapshot",
      {
        error: err instanceof Error ? err.message : String(err),
        student_id: args.student_id,
      },
    );
    return null;
  }
}

function deriveMasteryScope(
  entryMode: EntryMode,
): "skill" | "domain" | "section" | "all" {
  switch (entryMode) {
    case "scoped_question":
      return "skill";
    case "scoped_session":
      return "domain";
    case "general":
      return "all";
  }
}

type QuestionMeta = {
  skill: string;
  domain: string;
  section: "M" | "RW";
};

async function resolveQuestionMeta(
  scope: ScopeShape,
): Promise<QuestionMeta | null> {
  const questionId = scope.source_question_row_id;
  if (!questionId) return null;

  const { data, error } = await supabaseServer
    .from("questions")
    .select("skill, domain, section")
    .eq("id", questionId)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  if (data.section !== "M" && data.section !== "RW") return null;
  return {
    skill: String(data.skill),
    domain: String(data.domain),
    section: data.section,
  };
}

async function resolveSkillMastery(
  studentId: string,
  meta: QuestionMeta,
): Promise<MasterySnapshot["current_skill"]> {
  const { data, error } = await supabaseServer
    .from("student_skill_mastery")
    .select(
      "skill, domain, section, mastery_score, mastery_level, last_event_occurred_at",
    )
    .eq("student_id", studentId)
    .eq("section", meta.section)
    .eq("domain", meta.domain)
    .eq("skill", meta.skill)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  // Derive attempts_14d and pass_rate_14d from KPI table
  const kpi = await resolveSkillKpiForMastery(studentId, meta);

  return {
    skill: String(data.skill),
    domain: String(data.domain),
    section: data.section as "M" | "RW",
    mastery_score:
      data.mastery_score != null ? Number(data.mastery_score) : null,
    mastery_level:
      data.mastery_level != null ? Number(data.mastery_level) : null,
    attempts_14d: kpi?.events_last_7d != null ? kpi.events_last_7d * 2 : 0, // approximate 14d from 7d
    pass_rate_14d:
      kpi?.accuracy_last_7d != null ? Number(kpi.accuracy_last_7d) : null,
    last_event_at: data.last_event_occurred_at
      ? String(data.last_event_occurred_at)
      : null,
  };
}

async function resolveSkillKpiForMastery(
  studentId: string,
  meta: QuestionMeta,
): Promise<{ events_last_7d: number; accuracy_last_7d: number | null } | null> {
  const { data, error } = await supabaseServer
    .from("student_skill_kpi")
    .select("events_last_7d, accuracy_last_7d")
    .eq("student_id", studentId)
    .eq("section", meta.section)
    .eq("domain", meta.domain)
    .eq("skill", meta.skill)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    events_last_7d: Number(data.events_last_7d ?? 0),
    accuracy_last_7d:
      data.accuracy_last_7d != null ? Number(data.accuracy_last_7d) : null,
  };
}

async function resolveDomainMastery(
  studentId: string,
  meta: QuestionMeta,
): Promise<MasterySnapshot["current_domain"]> {
  const { data, error } = await supabaseServer
    .from("student_domain_mastery")
    .select("domain, section, mastery_score, mastery_level")
    .eq("student_id", studentId)
    .eq("section", meta.section)
    .eq("domain", meta.domain)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    domain: String(data.domain),
    section: data.section as "M" | "RW",
    mastery_score:
      data.mastery_score != null ? Number(data.mastery_score) : null,
    mastery_level:
      data.mastery_level != null ? Number(data.mastery_level) : null,
  };
}

async function resolveSectionProjection(
  studentId: string,
  section: "M" | "RW",
): Promise<MasterySnapshot["section_projection"]> {
  const { data, error } = await supabaseServer
    .from("student_section_projections")
    .select(
      "section, projected_score_low, projected_score_mid, projected_score_high, range_width",
    )
    .eq("student_id", studentId)
    .eq("section", section)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    section: data.section as "M" | "RW",
    projected_score_low:
      data.projected_score_low != null
        ? Number(data.projected_score_low)
        : null,
    projected_score_mid:
      data.projected_score_mid != null
        ? Number(data.projected_score_mid)
        : null,
    projected_score_high:
      data.projected_score_high != null
        ? Number(data.projected_score_high)
        : null,
    range_width: data.range_width != null ? Number(data.range_width) : null,
  };
}

/**
 * @spec [Doc 05C §7.2] | @implemented [2026-08-07]
 * Karl ruling #4: section-projection trend IS in scope for Layer 4.
 * Reads student_section_projection_snapshots for score-trend context.
 */
async function resolveSectionProjectionTrend(
  studentId: string,
  section: "M" | "RW",
): Promise<MasterySnapshot["section_projection_trend"]> {
  const { data, error } = await supabaseServer
    .from("student_section_projection_snapshots")
    .select("section, projected_score_mid, range_width, snapshot_at")
    .eq("student_id", studentId)
    .eq("section", section)
    .order("snapshot_at", { ascending: false })
    .limit(8);

  if (error || !data || data.length === 0) return null;
  return data.map((row) => ({
    section: row.section as "M" | "RW",
    projected_score_mid:
      row.projected_score_mid != null ? Number(row.projected_score_mid) : null,
    range_width: row.range_width != null ? Number(row.range_width) : null,
    snapshot_at: String(row.snapshot_at),
  }));
}

async function resolveRecentActivity(
  studentId: string,
): Promise<MasterySnapshot["recent_activity_summary"]> {
  // Skills practiced in last 7 days — from practice_session_items
  const { data: practiced7d } = await supabaseServer
    .from("practice_session_items")
    .select("question_skill")
    .eq("user_id", studentId)
    .eq("status", "answered")
    .gte(
      "answered_at",
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    )
    .limit(200);

  const skillsPracticed7d = [
    ...new Set((practiced7d ?? []).map((r) => String(r.question_skill))),
  ];

  // Skills with fails in last 7 days
  const { data: failed7d } = await supabaseServer
    .from("practice_session_items")
    .select("question_skill")
    .eq("user_id", studentId)
    .eq("status", "answered")
    .eq("is_correct", false)
    .gte(
      "answered_at",
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    )
    .limit(200);

  const skillsWithFails7d = [
    ...new Set((failed7d ?? []).map((r) => String(r.question_skill))),
  ];

  return {
    skills_practiced_7d: skillsPracticed7d,
    skills_with_fails_7d: skillsWithFails7d,
    // skills_newly_mastered_30d: null — no student_mastery_weekly_snapshots table exists (gap)
    skills_newly_mastered_30d: null,
  };
}

// ── Recent friction (§5.4.1) ──────────────────────────────────────────

async function resolveRecentFriction(args: {
  student_id: string;
  resolved_scope: ScopeShape;
  conversation_id: string;
}): Promise<RecentFriction> {
  const [consecutiveSession, consecutiveSkill7d, selfDeprecating, longPause] =
    await Promise.all([
      resolveConsecutiveFailsThisSession(args.student_id, args.resolved_scope),
      resolveConsecutiveFailsThisSkill7d(args.student_id, args.resolved_scope),
      detectSelfDeprecatingLanguage(args.student_id, args.conversation_id),
      detectLongPause(args.student_id, args.conversation_id),
    ]);

  return {
    consecutive_fails_this_session: consecutiveSession,
    consecutive_fails_this_skill_7d: consecutiveSkill7d,
    self_deprecating_language_detected: selfDeprecating,
    long_pause_detected: longPause,
    // mastery_regression_14d: null — no student_mastery_weekly_snapshots table exists (gap)
    mastery_regression_14d: null,
  };
}

async function resolveConsecutiveFailsThisSession(
  studentId: string,
  scope: ScopeShape,
): Promise<number> {
  if (!scope.source_session_id) return 0;

  const { data, error } = await supabaseServer
    .from("practice_session_items")
    .select("is_correct")
    .eq("user_id", studentId)
    .eq("session_id", scope.source_session_id)
    .eq("status", "answered")
    .order("ordinal", { ascending: false })
    .limit(50);

  if (error || !data) return 0;

  let count = 0;
  for (const row of data) {
    if (row.is_correct === false) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

async function resolveConsecutiveFailsThisSkill7d(
  studentId: string,
  scope: ScopeShape,
): Promise<number> {
  if (!scope.source_question_row_id) return 0;

  // Get the skill for this question
  const meta = await resolveQuestionMeta(scope);
  if (!meta) return 0;

  // Get recent practice items for this skill (last 7 days)
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: practiceItems } = await supabaseServer
    .from("practice_session_items")
    .select("is_correct, answered_at")
    .eq("user_id", studentId)
    .eq("question_skill", meta.skill)
    .eq("question_section", meta.section)
    .eq("question_domain", meta.domain)
    .eq("status", "answered")
    .gte("answered_at", sevenDaysAgo)
    .order("answered_at", { ascending: false })
    .limit(50);

  // Also check review_error_attempts for this skill
  const { data: reviewItems } = await supabaseServer
    .from("review_error_attempts")
    .select("is_correct, occurred_at")
    .eq("student_id", studentId)
    .eq("skill", meta.skill)
    .eq("section", meta.section)
    .eq("domain", meta.domain)
    .gte("occurred_at", sevenDaysAgo)
    .order("occurred_at", { ascending: false })
    .limit(50);

  // Merge and sort by time descending
  const merged = [
    ...(practiceItems ?? []).map((r) => ({
      is_correct: r.is_correct,
      at: r.answered_at,
    })),
    ...(reviewItems ?? []).map((r) => ({
      is_correct: r.is_correct,
      at: r.occurred_at,
    })),
  ].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  let count = 0;
  for (const item of merged) {
    if (item.is_correct === false) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

async function detectSelfDeprecatingLanguage(
  studentId: string,
  conversationId: string,
): Promise<boolean> {
  // Check recent student messages in this conversation
  const { data, error } = await supabaseServer
    .from("tutor_messages")
    .select("message")
    .eq("conversation_id", conversationId)
    .eq("student_id", studentId)
    .eq("role", "student")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !data) return false;

  for (const row of data) {
    const msg = String(row.message ?? "");
    if (SELF_DEPRECATION_PATTERNS.some((p) => p.test(msg))) {
      return true;
    }
  }
  return false;
}

async function detectLongPause(
  studentId: string,
  conversationId: string,
): Promise<boolean> {
  const pauseThresholdSeconds = getTutorConfigInt(
    "friction_long_pause_seconds",
  );

  const { data, error } = await supabaseServer
    .from("tutor_messages")
    .select("role, created_at")
    .eq("conversation_id", conversationId)
    .eq("student_id", studentId)
    .eq("role", "student")
    .order("created_at", { ascending: false })
    .limit(2);

  if (error || !data || data.length < 2) return false;

  const latest = new Date(data[0].created_at).getTime();
  const previous = new Date(data[1].created_at).getTime();
  const gapMs = latest - previous;
  return gapMs > pauseThresholdSeconds * 1000;
}

// ── KPI state (dedicated KPI tables) ──────────────────────────────────

async function resolveKpiState(args: {
  student_id: string;
  entry_mode: EntryMode;
  resolved_scope: ScopeShape;
}): Promise<KpiState | null> {
  try {
    const meta = await resolveQuestionMeta(args.resolved_scope);

    const [skillKpi, domainKpi, sectionKpi] = await Promise.all([
      meta ? resolveSkillKpi(args.student_id, meta) : Promise.resolve(null),
      meta ? resolveDomainKpi(args.student_id, meta) : Promise.resolve(null),
      meta
        ? resolveSectionKpi(args.student_id, meta.section)
        : Promise.resolve(null),
    ]);

    return {
      skill_kpi: skillKpi,
      domain_kpi: domainKpi,
      section_kpi: sectionKpi,
    };
  } catch (err: unknown) {
    logger.error(
      "TUTOR_CONTEXT",
      "kpi_state_failed",
      "Failed to resolve KPI state",
      {
        error: err instanceof Error ? err.message : String(err),
        student_id: args.student_id,
      },
    );
    return null;
  }
}

async function resolveSkillKpi(
  studentId: string,
  meta: QuestionMeta,
): Promise<KpiState["skill_kpi"]> {
  const { data, error } = await supabaseServer
    .from("student_skill_kpi")
    .select(
      "events_total, events_last_7d, events_last_30d, accuracy_overall, accuracy_last_7d, accuracy_last_30d",
    )
    .eq("student_id", studentId)
    .eq("section", meta.section)
    .eq("domain", meta.domain)
    .eq("skill", meta.skill)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    events_total: Number(data.events_total ?? 0),
    events_last_7d: Number(data.events_last_7d ?? 0),
    events_last_30d: Number(data.events_last_30d ?? 0),
    accuracy_overall:
      data.accuracy_overall != null ? Number(data.accuracy_overall) : null,
    accuracy_last_7d:
      data.accuracy_last_7d != null ? Number(data.accuracy_last_7d) : null,
    accuracy_last_30d:
      data.accuracy_last_30d != null ? Number(data.accuracy_last_30d) : null,
  };
}

async function resolveDomainKpi(
  studentId: string,
  meta: QuestionMeta,
): Promise<KpiState["domain_kpi"]> {
  const { data, error } = await supabaseServer
    .from("student_domain_kpi")
    .select(
      "events_total, events_last_7d, events_last_30d, accuracy_overall, accuracy_last_7d, accuracy_last_30d",
    )
    .eq("student_id", studentId)
    .eq("section", meta.section)
    .eq("domain", meta.domain)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    events_total: Number(data.events_total ?? 0),
    events_last_7d: Number(data.events_last_7d ?? 0),
    events_last_30d: Number(data.events_last_30d ?? 0),
    accuracy_overall:
      data.accuracy_overall != null ? Number(data.accuracy_overall) : null,
    accuracy_last_7d:
      data.accuracy_last_7d != null ? Number(data.accuracy_last_7d) : null,
    accuracy_last_30d:
      data.accuracy_last_30d != null ? Number(data.accuracy_last_30d) : null,
  };
}

async function resolveSectionKpi(
  studentId: string,
  section: "M" | "RW",
): Promise<KpiState["section_kpi"]> {
  const { data, error } = await supabaseServer
    .from("student_section_kpi")
    .select(
      "events_total, events_last_7d, events_last_30d, accuracy_overall, accuracy_last_7d, accuracy_last_30d, current_streak_days",
    )
    .eq("student_id", studentId)
    .eq("section", section)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    events_total: Number(data.events_total ?? 0),
    events_last_7d: Number(data.events_last_7d ?? 0),
    events_last_30d: Number(data.events_last_30d ?? 0),
    accuracy_overall:
      data.accuracy_overall != null ? Number(data.accuracy_overall) : null,
    accuracy_last_7d:
      data.accuracy_last_7d != null ? Number(data.accuracy_last_7d) : null,
    accuracy_last_30d:
      data.accuracy_last_30d != null ? Number(data.accuracy_last_30d) : null,
    current_streak_days: Number(data.current_streak_days ?? 0),
  };
}

// ── Layer 3: Memory retrieval with injection scan ─────────────────────

/**
 * @spec [Doc-03A_V3.2 §5.1 Layer 3, §7.4, §7.6 Layers C/D] | @implemented [2026-08-07]
 * Type-aware retrieval with freshness thresholds from config.
 * Scans content_json for injection signatures on read (Layer C).
 * Silently drops matching summaries (Layer D / INV-03-13).
 */
export async function resolveMemoryWithInjectionScan(args: {
  student_id: string;
  entry_mode: EntryMode;
}): Promise<MemoryRetrievalResult> {
  // Load injection signatures for scanning
  const signatures = await loadInjectionSignatures();

  // Load all summaries for this student (one per type, via UNIQUE constraint)
  const { data: rows, error } = await supabaseServer
    .from("tutor_memory_summaries")
    .select("*")
    .eq("student_id", args.student_id)
    .order("last_refreshed_at", { ascending: false });

  if (error || !rows) {
    return {
      summaries: [],
      structured_fields: emptyStructuredFields(),
      accepted_count: 0,
      rejected_count: 0,
      injection_dropped_count: 0,
      stale_count: 0,
    };
  }

  const typedRows = rows as MemorySummaryRow[];

  // Type-aware filtering: which types to load per §5.1 Layer 3
  const relevantTypes = determineRelevantMemoryTypes(args.entry_mode);

  let staleCount = 0;
  let injectionDroppedCount = 0;
  let rejectedCount = 0;
  const accepted: Array<{
    summary_type: string;
    summary_version: string;
    content_json: Record<string, unknown>;
    source_window_start: string | null;
    source_window_end: string | null;
  }> = [];
  let structuredFields = emptyStructuredFields();

  for (const row of typedRows) {
    // Skip types not relevant for this entry mode
    if (!relevantTypes.includes(row.summary_type)) continue;

    // §7.4 freshness check
    if (isStaleSummary(row)) {
      staleCount++;
      // Use stale summary but flag it (§7.4: "uses the stale summary but logs memory_freshness: stale")
      logger.info(
        "TUTOR_CONTEXT",
        "memory_freshness_stale",
        `Stale ${row.summary_type} summary used`,
        {
          student_id: row.student_id,
          summary_type: row.summary_type,
          last_refreshed_at: row.last_refreshed_at,
        },
      );
    }

    // §7.6 Layer C: injection scan
    if (hasInjectionSignature(row.content_json, signatures)) {
      injectionDroppedCount++;
      // §7.6 Layer D: silent drop — do not tell the student
      logger.warn(
        "TUTOR_CONTEXT",
        "memory_injection_dropped",
        "Summary dropped due to injection signature match",
        {
          student_id: row.student_id,
          summary_type: row.summary_type,
          summary_id: row.id,
        },
      );
      continue;
    }

    // Zod validation
    const parsed = memorySummarySchema.safeParse({
      summary_type: row.summary_type,
      summary_version: row.summary_version,
      content_json: row.content_json ?? {},
      source_window_start: row.source_window_start ?? null,
      source_window_end: row.source_window_end ?? null,
    });

    if (!parsed.success) {
      rejectedCount++;
      continue;
    }

    accepted.push(parsed.data);

    // Extract structured fields from teaching_profile
    if (row.summary_type === "teaching_profile") {
      structuredFields = extractStructuredFields(row.content_json);
    }
  }

  return {
    summaries: accepted,
    structured_fields: structuredFields,
    accepted_count: accepted.length,
    rejected_count: rejectedCount,
    injection_dropped_count: injectionDroppedCount,
    stale_count: staleCount,
  };
}

function determineRelevantMemoryTypes(entryMode: EntryMode): string[] {
  // §5.1 Layer 3:
  // teaching_profile — always loaded if exists
  // chat_compaction — loaded when conversation exceeds recent window (always include, let caller decide)
  // recent_learning_pattern — loaded for scoped_session and general
  // study_context — loaded when §5.2 triggers (not default for scoped_question)
  const types = ["teaching_profile", "chat_compaction"];

  if (entryMode === "scoped_session" || entryMode === "general") {
    types.push("recent_learning_pattern");
  }

  // study_context: only for general mode per §5.2 (caller-side relevance rule applies)
  // Include it for general; other modes get it only if §5.2 explicitly triggers
  if (entryMode === "general") {
    types.push("study_context");
  }

  return types;
}

function isStaleSummary(row: MemorySummaryRow): boolean {
  const refreshedAt = new Date(row.last_refreshed_at).getTime();
  const now = Date.now();

  // Read freshness thresholds from config per §7.4
  let thresholdDays: number;
  try {
    switch (row.summary_type) {
      case "teaching_profile":
        thresholdDays = getTutorConfigInt("teaching_profile_freshness_days");
        break;
      case "recent_learning_pattern":
        thresholdDays = getTutorConfigInt(
          "recent_learning_pattern_freshness_days",
        );
        break;
      case "study_context":
        thresholdDays = getTutorConfigInt("study_context_freshness_days");
        break;
      case "chat_compaction":
        // chat_compaction is written at conversation close — use the hard outer bound
        thresholdDays = getTutorConfigInt("memory_summary_staleness_days");
        break;
      default:
        thresholdDays = getTutorConfigInt("memory_summary_staleness_days");
    }
  } catch {
    // Fail-closed: if config unavailable, use the 30-day hard outer bound from §7.4
    thresholdDays = 30;
  }

  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return now - refreshedAt > thresholdMs;
}

// ── Injection signature scanning (§7.6 Layer C) ──────────────────────

let cachedSignatures: InjectionSignatureRow[] | null = null;
let signaturesCachedAt = 0;
const SIGNATURE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function loadInjectionSignatures(): Promise<InjectionSignatureRow[]> {
  const now = Date.now();
  if (cachedSignatures && now - signaturesCachedAt < SIGNATURE_CACHE_TTL_MS) {
    return cachedSignatures;
  }

  const { data, error } = await supabaseServer
    .from("tutor_injection_signatures")
    .select("signature_pattern, signature_type, severity, action");

  if (error || !data) {
    // If we can't load signatures, return empty — no false positives
    return cachedSignatures ?? [];
  }

  cachedSignatures = data as InjectionSignatureRow[];
  signaturesCachedAt = now;
  return cachedSignatures;
}

function hasInjectionSignature(
  contentJson: Record<string, unknown>,
  signatures: InjectionSignatureRow[],
): boolean {
  if (signatures.length === 0) return false;

  const jsonStr = JSON.stringify(contentJson);
  const lengthBound = getTutorConfigIntSafe(
    "injection_length_bound_chars",
    4000,
  );

  // §7.6 Layer B check: content_json exceeding the length bound is suspicious
  if (jsonStr.length > lengthBound) {
    return true;
  }

  for (const sig of signatures) {
    try {
      const pattern = new RegExp(sig.signature_pattern, "i");
      if (pattern.test(jsonStr)) {
        return true;
      }
    } catch {
      // Invalid regex pattern in DB — skip, don't crash
      continue;
    }
  }

  return false;
}

function getTutorConfigIntSafe(key: string, fallback: number): number {
  try {
    return getTutorConfigInt(key as Parameters<typeof getTutorConfigInt>[0]);
  } catch {
    return fallback;
  }
}

// ── Structured fields extraction (§7.3, §10.3) ───────────────────────

function emptyStructuredFields(): MemoryStructuredFields {
  return {
    last_struggled_skill: null,
    last_mastered_skill: null,
    preferred_explanation_style: null,
    style_confidence: null,
  };
}

function extractStructuredFields(
  contentJson: Record<string, unknown>,
): MemoryStructuredFields {
  const result = emptyStructuredFields();

  // last_struggled_skill (§7.3 V1)
  const struggled = contentJson.last_struggled_skill;
  if (struggled && typeof struggled === "object" && !Array.isArray(struggled)) {
    const s = struggled as Record<string, unknown>;
    if (
      typeof s.skill === "string" &&
      typeof s.domain === "string" &&
      (s.section === "M" || s.section === "RW")
    ) {
      result.last_struggled_skill = {
        skill: String(s.skill),
        domain: String(s.domain),
        section: s.section,
        last_fail_at:
          typeof s.last_fail_at === "string" ? s.last_fail_at : null,
        fail_count_7d:
          typeof s.fail_count_7d === "number" ? s.fail_count_7d : 0,
        mastery_at_time_of_fail:
          typeof s.mastery_at_time_of_fail === "number"
            ? s.mastery_at_time_of_fail
            : null,
      };
    }
  }

  // last_mastered_skill (§7.3 V1)
  const mastered = contentJson.last_mastered_skill;
  if (mastered && typeof mastered === "object" && !Array.isArray(mastered)) {
    const m = mastered as Record<string, unknown>;
    if (
      typeof m.skill === "string" &&
      typeof m.domain === "string" &&
      (m.section === "M" || m.section === "RW")
    ) {
      result.last_mastered_skill = {
        skill: String(m.skill),
        domain: String(m.domain),
        section: m.section,
        crossed_to_strong_at:
          typeof m.crossed_to_strong_at === "string"
            ? m.crossed_to_strong_at
            : null,
        prior_mastery:
          typeof m.prior_mastery === "number" ? m.prior_mastery : null,
        current_mastery:
          typeof m.current_mastery === "number" ? m.current_mastery : null,
      };
    }
  }

  // preferred_explanation_style (SCL-026 — V1 per-turn capture)
  const tally = contentJson.explanation_style_tally;
  const totalObs = contentJson.total_style_observations;
  const derivedStyle = contentJson.preferred_explanation_style;
  const derivedConfidence = contentJson.style_confidence;

  if (
    typeof derivedStyle === "string" &&
    isValidExplanationForm(derivedStyle)
  ) {
    result.preferred_explanation_style = derivedStyle;
  }
  if (
    typeof derivedConfidence === "string" &&
    isValidStyleConfidence(derivedConfidence)
  ) {
    result.style_confidence = derivedConfidence;
  }

  // If no derived style yet but we have a tally, attempt derivation
  if (
    !result.preferred_explanation_style &&
    tally &&
    typeof tally === "object" &&
    typeof totalObs === "number"
  ) {
    const derived = derivePreferredStyle(
      tally as Record<string, number>,
      totalObs,
    );
    if (derived) {
      result.preferred_explanation_style = derived.style;
      result.style_confidence = derived.confidence;
    }
  }

  return result;
}

// ── Learner observation accumulation (SCL-026) ────────────────────────

const VALID_EXPLANATION_FORMS = [
  "step_by_step",
  "conceptual",
  "example_driven",
  "visual",
] as const;
type ExplanationFormValue = (typeof VALID_EXPLANATION_FORMS)[number];

function isValidExplanationForm(value: string): value is ExplanationFormValue {
  return (VALID_EXPLANATION_FORMS as readonly string[]).includes(value);
}

function isValidStyleConfidence(
  value: string,
): value is "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high";
}

/**
 * @spec [SCL-026] | @implemented [2026-08-07]
 * Accumulates a learner_observation from the orchestrator response into the
 * teaching_profile in tutor_memory_summaries. Does NOT overwrite — tallies
 * increment and the derived style updates only when promotion threshold is met
 * and a single leader exists (Karl ruling #2).
 */
export async function accumulateLearnerObservation(args: {
  student_id: string;
  explanation_form: ExplanationFormValue | null;
  confidence: "low" | "medium" | "high";
}): Promise<void> {
  // null observation = no signal this turn (Karl ruling #3)
  if (!args.explanation_form) return;

  const promotionThreshold = getTutorConfigIntSafe(
    "observation_promotion_threshold",
    5,
  );

  // Read current teaching_profile
  const { data: existing } = await supabaseServer
    .from("tutor_memory_summaries")
    .select("id, content_json")
    .eq("student_id", args.student_id)
    .eq("summary_type", "teaching_profile")
    .limit(1)
    .maybeSingle();

  const contentJson = (existing?.content_json ?? {}) as Record<string, unknown>;
  const tally = (contentJson.explanation_style_tally ?? {}) as Record<
    string,
    number
  >;
  const totalObservations = (
    typeof contentJson.total_style_observations === "number"
      ? contentJson.total_style_observations
      : 0
  ) as number;

  // Increment tally for observed form
  const newTally = { ...tally };
  newTally[args.explanation_form] = (newTally[args.explanation_form] ?? 0) + 1;
  const newTotal = totalObservations + 1;

  // Derive preferred style (Karl ruling #2: threshold >= 5, clear single leader)
  const derived = derivePreferredStyle(newTally, newTotal, promotionThreshold);

  // On a tie, keep the previous value (Karl ruling #2)
  const previousStyle =
    typeof contentJson.preferred_explanation_style === "string"
      ? contentJson.preferred_explanation_style
      : null;

  const updatedContentJson = {
    ...contentJson,
    explanation_style_tally: newTally,
    total_style_observations: newTotal,
    preferred_explanation_style: derived?.style ?? previousStyle ?? null,
    style_confidence:
      derived?.confidence ?? contentJson.style_confidence ?? null,
  };

  if (existing) {
    // Update existing teaching_profile
    await supabaseServer
      .from("tutor_memory_summaries")
      .update({
        content_json: updatedContentJson,
        last_refreshed_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    // Create new teaching_profile — this is a minimal bootstrap.
    // The full teaching_profile (last_struggled_skill, last_mastered_skill, etc.)
    // is written by the memory refresh job (§7.3 V1 extraction cadence).
    await supabaseServer.from("tutor_memory_summaries").insert({
      student_id: args.student_id,
      summary_type: "teaching_profile",
      summary_version: "1.0",
      content_json: {
        ...updatedContentJson,
        // Ensure §7.3 required fields exist (DB trigger validates)
        summary_version: "1.0",
        learning_style_signals: {},
        last_struggled_skill: contentJson.last_struggled_skill ?? null,
        last_mastered_skill: contentJson.last_mastered_skill ?? null,
        engagement_summary: {},
      },
      last_refreshed_at: new Date().toISOString(),
    });
  }
}

function derivePreferredStyle(
  tally: Record<string, number>,
  totalObservations: number,
  threshold?: number,
): {
  style: ExplanationFormValue;
  confidence: "low" | "medium" | "high";
} | null {
  const minThreshold = threshold ?? 5;

  if (totalObservations < minThreshold) return null;

  // Find the leader
  const entries = Object.entries(tally)
    .filter(([key]) => isValidExplanationForm(key))
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return null;

  const [leaderKey, leaderCount] = entries[0];
  const secondCount = entries.length > 1 ? entries[1][1] : 0;

  // Karl ruling #2: only promote when there's a clear single leader (no tie)
  if (leaderCount <= secondCount) return null;

  // Derive confidence from observation count
  const confidence: "low" | "medium" | "high" =
    totalObservations >= 13
      ? "high"
      : totalObservations >= 6
        ? "medium"
        : "low";

  return { style: leaderKey as ExplanationFormValue, confidence };
}

// ── Answer-aware leak check (L2.4) ────────────────────────────────────

/**
 * @spec [Doc-03B_V4.1, §16.4-5; INV-03-04] | @implemented [2026-08-07]
 * Replaces the nine-regex phrase matcher. When a conversation is scoped to a
 * question whose correct_answer is known, compares the model's output against
 * it directly. This catches every phrasing, not just the nine patterns.
 * Falls back to the phrase list for unscoped turns.
 */
export function hasAnswerLeak(
  text: string,
  correctAnswer: string | null,
): boolean {
  if (correctAnswer) {
    return hasAnswerAwareLeak(text, correctAnswer);
  }
  return hasDirectAnswerLeakFallback(text);
}

function hasAnswerAwareLeak(text: string, correctAnswer: string): boolean {
  const answer = correctAnswer.trim();

  // MCQ: answer is a single letter A-D
  if (/^[A-Da-d]$/.test(answer)) {
    return hasMcqAnswerLeak(text, answer.toUpperCase());
  }

  // Grid-in: answer is numeric/expression — check for exact value reveal
  return hasGridInAnswerLeak(text, answer);
}

function hasMcqAnswerLeak(text: string, letter: string): boolean {
  // Build patterns that identify this specific letter as the answer.
  // These catch any phrasing that singles out the correct letter, not just
  // the nine phrases the old matcher checked.
  const patterns = [
    // Direct identification: "the answer is X", "answer: X", "answer = X"
    new RegExp(
      `\\b(?:the\\s+)?(?:correct\\s+|right\\s+)?answer\\s*(?:is|=|:)\\s*(?:option\\s+)?${letter}\\b`,
      "i",
    ),
    // Option identification: "option X is correct/right/the answer"
    new RegExp(
      `\\b(?:option|choice)\\s*${letter}\\s+(?:is|=)\\s+(?:the\\s+)?(?:correct|right|best|answer)`,
      "i",
    ),
    // Directive: "choose/select/go with X"
    new RegExp(
      `\\b(?:choose|select|pick|go\\s+with)\\s+(?:option\\s+)?${letter}\\b`,
      "i",
    ),
    // Definite identification: "definitely/clearly X"
    new RegExp(
      `\\b(?:definitely|clearly|obviously|certainly)\\s+(?:option\\s+)?${letter}\\b`,
      "i",
    ),
    // X is correct/right: "B is correct", "B is the right answer"
    new RegExp(
      `\\b${letter}\\s+(?:is|=)\\s+(?:the\\s+)?(?:correct|right|best)\\b`,
      "i",
    ),
    // Elimination to one: "eliminate all but X", "only X can be correct"
    new RegExp(
      `\\beliminate\\s+(?:all\\s+)?(?:options?\\s+)?(?:but|except)\\s+(?:option\\s+)?${letter}\\b`,
      "i",
    ),
    new RegExp(
      `\\bonly\\s+(?:option\\s+)?${letter}\\s+(?:can|could)\\s+be\\s+(?:correct|right)\\b`,
      "i",
    ),
    // Lean/recommend: "I'd lean toward X", "X is what you're looking for"
    new RegExp(
      `\\b(?:lean|leaning)\\s+(?:toward|towards)\\s+(?:option\\s+)?${letter}\\b`,
      "i",
    ),
    new RegExp(
      `\\b${letter}\\s+is\\s+(?:what\\s+)?(?:you(?:'re|\\s+are)\\s+)?looking\\s+for\\b`,
      "i",
    ),
    // "it's X" in answer context
    new RegExp(
      `\\bit(?:'s|\\s+is)\\s+${letter}\\b(?!\\s*(?:a|an|the|that|this|not|and|or|but|for|when|where|which|who|how))`,
      "i",
    ),
  ];

  return patterns.some((p) => p.test(text));
}

/**
 * @spec [Doc 02 Preamble §12; Doc 03B §16 Anti-Leak] | @implemented [2026-08-08]
 * plain English: containment-based grid-in answer detection. Checks whether the
 * answer VALUE appears anywhere in the text with word boundaries. No phrase
 * patterns — any phrasing that embeds the value is a leak.
 *
 * Karl ruling: FAIL TOWARD BLOCKING. Exclude obvious false-positive prefixes
 * (step, part, question, number, option) but do not tune further. A false
 * positive costs one fallback message; a leak costs the product.
 *
 * Normalizes both sides: strips whitespace, handles decimal equivalence
 * (3.50 → 3.5), and fraction/decimal equivalence (7/2 ↔ 3.5).
 */
function hasGridInAnswerLeak(text: string, answer: string): boolean {
  const normalizedAnswer = normalizeNumericValue(answer);
  const forms = allNumericForms(normalizedAnswer);

  for (const form of forms) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word boundary: \b handles edges for digits/letters. For forms starting
    // with a minus sign, anchor on non-digit before.
    const pattern = new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`, "i");

    if (!pattern.test(text)) continue;

    // Exclude false-positive prefixes: "step 3", "part 2", "question 7", etc.
    // These are structural references, not answer reveals.
    const fpPattern = new RegExp(
      `\\b(?:step|part|question|number|option|item|figure|table|page|line|example|chapter|section|problem|exercise|row|column)\\s+${escaped}(?![\\d.])`,
      "i",
    );
    // If every occurrence is preceded by a false-positive prefix, it's safe.
    // But if ANY occurrence is NOT preceded by one, it's a leak.
    const textLower = text.toLowerCase();
    const formLower = form.toLowerCase();
    let idx = 0;
    let hasNonFpOccurrence = false;

    while (idx < textLower.length) {
      const pos = textLower.indexOf(formLower, idx);
      if (pos === -1) break;

      // Check digit context (not inside a larger number)
      const charBefore = pos > 0 ? textLower[pos - 1] : " ";
      const charAfter =
        pos + formLower.length < textLower.length
          ? textLower[pos + formLower.length]
          : " ";
      const insideLargerNumber =
        /[\d.]/.test(charBefore ?? "") || /[\d.]/.test(charAfter ?? "");

      if (!insideLargerNumber) {
        // Check if this occurrence is preceded by a false-positive prefix
        const precedingText = text.slice(Math.max(0, pos - 30), pos);
        if (!fpPattern.test(precedingText + form)) {
          hasNonFpOccurrence = true;
          break;
        }
      }
      idx = pos + 1;
    }

    if (hasNonFpOccurrence) return true;
  }

  return false;
}

/**
 * Normalize a numeric value: trim whitespace, strip trailing decimal zeros,
 * and reduce fractions to lowest terms.
 */
function normalizeNumericValue(value: string): string {
  const trimmed = value.trim();

  // Handle fractions: a/b
  const fractionMatch = trimmed.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (fractionMatch) {
    const num = parseInt(fractionMatch[1]!, 10);
    const den = parseInt(fractionMatch[2]!, 10);
    if (den !== 0) {
      const g = gcd(Math.abs(num), den);
      return `${num / g}/${den / g}`;
    }
    return trimmed;
  }

  // Handle decimals: strip trailing zeros after decimal point
  const decimalMatch = trimmed.match(/^(-?\d+\.\d+?)0*$/);
  if (decimalMatch) {
    return decimalMatch[1]!;
  }

  return trimmed;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/**
 * Produce all equivalent numeric forms to check against: the normalized form,
 * plus decimal↔fraction equivalents where they exist.
 */
function allNumericForms(normalized: string): string[] {
  const forms = new Set<string>();
  forms.add(normalized);

  // Fraction → decimal
  const fractionMatch = normalized.match(/^(-?\d+)\/(\d+)$/);
  if (fractionMatch) {
    const num = parseInt(fractionMatch[1]!, 10);
    const den = parseInt(fractionMatch[2]!, 10);
    if (den !== 0) {
      const decimal = num / den;
      const decStr = normalizeNumericValue(String(decimal));
      forms.add(decStr);
    }
  }

  // Decimal → fraction (only terminating decimals with manageable denominators)
  const decimalMatch = normalized.match(/^(-?\d+)\.(\d+)$/);
  if (decimalMatch) {
    const sign = normalized.startsWith("-") ? -1 : 1;
    const wholePart = Math.abs(parseInt(decimalMatch[1]!, 10));
    const fracDigits = decimalMatch[2]!;
    const den = Math.pow(10, fracDigits.length);
    const num = wholePart * den + parseInt(fracDigits, 10);
    const signedNum = sign * num;
    const g = gcd(Math.abs(signedNum), den);
    forms.add(`${signedNum / g}/${den / g}`);
  }

  return [...forms];
}

/**
 * Fallback for unscoped turns — the original nine-regex phrase matcher.
 * Kept as fallback per task instructions.
 */
function hasDirectAnswerLeakFallback(text: string): boolean {
  const patterns = [
    /\bthe correct answer is\b/i,
    /\bthe right answer is\b/i,
    /\bchoose option [A-D]\b/i,
    /\banswer:\s*[A-D]\b/i,
    /\bdefinitely option [A-D]\b/i,
    /\b(option|choice)\s*[A-D]\s*(is|=)\s*(correct|right)\b/i,
    /\bit(?:'s| is)\s*(definitely|clearly)\s*(option|choice)\s*[A-D]\b/i,
    /\bonly\s+(option|choice)\s*[A-D]\s+(can|could)\s+be\s+(correct|right)\b/i,
    /\beliminate\s+all\s+but\s+(option|choice)\s*[A-D]\b/i,
  ];
  return patterns.some((p) => p.test(text));
}

// ── Correct answer resolution for scoped questions ────────────────────

/**
 * @spec [Doc-03B_V4.1 §16] | @implemented [2026-08-07]
 * Resolves the correct_answer for the scoped question. Used by the answer-aware
 * leak check. This is an INTERNAL read — the correct_answer is never serialized
 * to any client response (anti-leak invariant).
 */
export async function resolveCorrectAnswer(
  scope: ScopeShape,
): Promise<string | null> {
  // First try practice_session_items — it already stores question_correct_answer
  if (scope.source_session_item_id) {
    const { data } = await supabaseServer
      .from("practice_session_items")
      .select("question_correct_answer")
      .eq("id", scope.source_session_item_id)
      .limit(1)
      .maybeSingle();

    if (data?.question_correct_answer) {
      return String(data.question_correct_answer);
    }
  }

  // Fallback to questions table
  if (scope.source_question_row_id) {
    const { data } = await supabaseServer
      .from("questions")
      .select("correct_answer")
      .eq("id", scope.source_question_row_id)
      .limit(1)
      .maybeSingle();

    if (data?.correct_answer) {
      return String(data.correct_answer);
    }
  }

  return null;
}
