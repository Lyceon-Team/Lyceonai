import { DateTime } from "luxon";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { KPI_CALENDAR_COUNTED_EVENTS } from "../../apps/api/src/services/mastery-constants";
import type { CompleteExamResult } from "../../apps/api/src/services/fullLengthExam";
import { buildScoreEstimateFromCanonical, buildStudentKpiViewFromCanonical } from "./canonical-runtime-views";
import { calculateScore, type DomainMastery, type ScoreProjection } from "./score-projection";

type KpiSection = "math" | "rw";
type KpiSourceFamily = "practice" | "review" | "full_length" | "flowcard";

export const KPI_SOURCE_VERSION = "kpi_truth_v1";

export const KPI_DOMAIN_DEFINITIONS = [
  {
    section: "math" as const,
    domain: "algebra",
    skills: [
      "linear_equations",
      "linear_inequalities",
      "linear_functions",
      "systems_of_equations",
      "absolute_value",
    ],
  },
  {
    section: "math" as const,
    domain: "advanced_math",
    skills: [
      "quadratics",
      "polynomials",
      "exponential_functions",
      "radical_expressions",
      "rational_expressions",
    ],
  },
  {
    section: "math" as const,
    domain: "problem_solving",
    skills: [
      "ratios_rates_proportions",
      "percentages",
      "unit_conversions",
      "linear_growth",
      "data_interpretation",
      "probability",
      "statistics",
    ],
  },
  {
    section: "math" as const,
    domain: "geometry",
    skills: [
      "area_volume",
      "lines_angles",
      "triangles",
      "circles",
      "trigonometry",
      "coordinate_geometry",
    ],
  },
  {
    section: "rw" as const,
    domain: "craft_structure",
    skills: [
      "words_in_context",
      "text_structure",
      "cross_text_connections",
      "purpose",
    ],
  },
  {
    section: "rw" as const,
    domain: "information_ideas",
    skills: [
      "central_ideas",
      "command_of_evidence_textual",
      "command_of_evidence_quantitative",
      "inferences",
    ],
  },
  {
    section: "rw" as const,
    domain: "standard_english",
    skills: [
      "boundaries",
      "form_structure_sense",
      "punctuation",
      "verb_tense",
      "pronoun_agreement",
    ],
  },
  {
    section: "rw" as const,
    domain: "expression_ideas",
    skills: [
      "rhetorical_synthesis",
      "transitions",
      "sentence_placement",
    ],
  },
] as const;

const KPI_SOURCE_FAMILY_BY_EVENT_TYPE: Record<string, KpiSourceFamily> = {
  practice_pass: "practice",
  practice_fail: "practice",
  review_pass: "review",
  review_fail: "review",
  test_pass: "full_length",
  test_fail: "full_length",
  tutor_helped: "flowcard",
  tutor_fail: "flowcard",
};

const KPI_DOMAIN_LOOKUP = new Map<string, { section: KpiSection; domain: string; skills: readonly string[] }>(
  KPI_DOMAIN_DEFINITIONS.map((definition) => [
    `${definition.section}:${definition.domain}`,
    definition as { section: KpiSection; domain: string; skills: readonly string[] },
  ])
);

const KPI_DOMAIN_COLUMN_PREFIX: Record<string, string> = {
  "math:algebra": "m_alg",
  "math:advanced_math": "m_advm",
  "math:problem_solving": "m_prob",
  "math:geometry": "m_geo",
  "rw:craft_structure": "rw_craft",
  "rw:information_ideas": "rw_info",
  "rw:standard_english": "rw_stdeng",
  "rw:expression_ideas": "rw_expr",
};

const KPI_SKILL_COLUMN_SUFFIX: Record<string, string> = {
  linear_equations: "leq",
  linear_inequalities: "linq",
  linear_functions: "lfn",
  systems_of_equations: "syseq",
  absolute_value: "absv",
  quadratics: "quad",
  polynomials: "poly",
  exponential_functions: "expfn",
  radical_expressions: "radexp",
  rational_expressions: "ratexp",
  ratios_rates_proportions: "rrp",
  percentages: "pct",
  unit_conversions: "unitc",
  linear_growth: "lg",
  data_interpretation: "dint",
  probability: "prob",
  statistics: "stat",
  area_volume: "arvol",
  lines_angles: "lang",
  triangles: "tri",
  circles: "circ",
  trigonometry: "trig",
  coordinate_geometry: "cgeo",
  words_in_context: "wic",
  text_structure: "txts",
  cross_text_connections: "ctxt",
  purpose: "purp",
  central_ideas: "cidea",
  command_of_evidence_textual: "coet",
  command_of_evidence_quantitative: "coeq",
  inferences: "inf",
  boundaries: "bnd",
  form_structure_sense: "fss",
  punctuation: "punc",
  verb_tense: "vten",
  pronoun_agreement: "prag",
  rhetorical_synthesis: "rsy",
  transitions: "tran",
  sentence_placement: "spla",
};

function getKpiDomainCounterPrefix(section: KpiSection, domain: string): string | null {
  const key = `${section}:${domain}`;
  return KPI_DOMAIN_COLUMN_PREFIX[key] ?? null;
}

function getKpiSkillCounterPrefix(section: KpiSection, domain: string, skill: string): string | null {
  const domainPrefix = getKpiDomainCounterPrefix(section, domain);
  if (!domainPrefix) return null;
  const skillSuffix = KPI_SKILL_COLUMN_SUFFIX[skill];
  if (!skillSuffix) return null;
  return `${domainPrefix}_${skillSuffix}`;
}

function normalizeKpiToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+/g, "_");
  return normalized.replace(/^_|_$/g, "") || null;
}

export function normalizeKpiSection(value: unknown): KpiSection | null {
  const normalized = normalizeKpiToken(value);
  if (normalized === "math" || normalized === "rw") {
    return normalized;
  }
  return null;
}

export function normalizeKpiDomain(value: unknown): string | null {
  return normalizeKpiToken(value);
}

export function normalizeKpiSkill(value: unknown): string | null {
  return normalizeKpiToken(value);
}

export function isKnownKpiTaxonomyPath(section: unknown, domain: unknown, skill: unknown): boolean {
  const normalizedSection = normalizeKpiSection(section);
  const normalizedDomain = normalizeKpiDomain(domain);
  const normalizedSkill = normalizeKpiSkill(skill);

  if (!normalizedSection || !normalizedDomain || !normalizedSkill) {
    return false;
  }

  const definition = KPI_DOMAIN_LOOKUP.get(`${normalizedSection}:${normalizedDomain}`);
  return definition?.skills.includes(normalizedSkill) ?? false;
}

export function getKpiSourceFamily(eventType: string | null | undefined): KpiSourceFamily | null {
  if (!eventType) return null;
  return KPI_SOURCE_FAMILY_BY_EVENT_TYPE[eventType] ?? null;
}

function getCounterValue(row: Record<string, unknown> | null | undefined, columnName: string): number {
  if (!row) return 0;
  const value = row[columnName];
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

function getStringValue(row: Record<string, unknown> | null | undefined, columnName: string): string | null {
  if (!row) return null;
  const value = row[columnName];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getTimestampValue(row: Record<string, unknown> | null | undefined, columnName: string): string | null {
  const value = getStringValue(row, columnName);
  return value;
}

function buildDomainMasteryFromCounterRow(row: Record<string, unknown> | null | undefined): DomainMastery[] {
  const mastery: DomainMastery[] = [];

  for (const definition of KPI_DOMAIN_DEFINITIONS) {
    const prefix = getKpiDomainCounterPrefix(definition.section, definition.domain);
    if (!prefix) continue;
    const attempts = getCounterValue(row, `${prefix}_answered_count`);
    const correct = getCounterValue(row, `${prefix}_correct_count`);
    mastery.push({
      section: definition.section,
      domain: definition.domain,
      mastery_score: attempts > 0 ? Math.round((correct / attempts) * 100) : 0,
      attempts,
      last_activity: getTimestampValue(row, "updated_at") || getTimestampValue(row, "last_recalculated_at"),
    });
  }

  return mastery;
}

interface PersistedKpiCountersCurrentRow extends Record<string, unknown> {
  user_id: string;
  total_answered_count?: number;
  total_correct_count?: number;
  total_wrong_count?: number;
  overall_score_projection?: number | null;
  math_score_projection?: number | null;
  rw_score_projection?: number | null;
  readiness_metric?: number | null;
  confidence_metric?: number | null;
  consistency_metric?: number | null;
  last_recalculated_at?: string | null;
  last_event_type?: string | null;
  last_event_id?: string | null;
  source_version?: string | null;
  updated_at?: string | null;
}

interface PersistedKpiSnapshotRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  snapshot_at?: string | null;
  source_version?: string | null;
  trigger_event_type?: string | null;
  trigger_event_id?: string | null;
  current_week_practice_sessions?: number | null;
  current_week_practice_minutes?: number | null;
  current_week_questions_solved?: number | null;
  current_week_accuracy_percent?: number | null;
  current_week_avg_seconds_per_question?: number | null;
  previous_week_practice_sessions?: number | null;
  previous_week_practice_minutes?: number | null;
  previous_week_questions_solved?: number | null;
  previous_week_accuracy_percent?: number | null;
  previous_week_avg_seconds_per_question?: number | null;
  recency_200_total_attempts?: number | null;
  recency_200_accuracy_percent?: number | null;
  recency_200_avg_seconds_per_question?: number | null;
}

export interface PersistedScoreProjectionResult {
  totalQuestions: number;
  projection: ScoreProjection;
  lastUpdated: string;
  masteryData: DomainMastery[];
}

function buildScoreProjectionFromCounterRow(row: PersistedKpiCountersCurrentRow | null | undefined): PersistedScoreProjectionResult {
  const masteryData = buildDomainMasteryFromCounterRow(row);
  const totalQuestions = getCounterValue(row, "total_answered_count");
  const projection = calculateScore(masteryData, totalQuestions);
  return {
    totalQuestions,
    projection,
    lastUpdated: getTimestampValue(row, "updated_at") || new Date().toISOString(),
    masteryData,
  };
}

async function fetchPersistedKpiCountersCurrent(userId: string): Promise<PersistedKpiCountersCurrentRow | null> {
  const { data, error } = await supabaseServer
    .from("student_kpi_counters_current")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch persisted KPI counters: ${error.message}`);
  }

  return (data || null) as PersistedKpiCountersCurrentRow | null;
}

async function fetchPersistedKpiSnapshots(userId: string, limit = 2): Promise<PersistedKpiSnapshotRow[]> {
  const { data, error } = await supabaseServer
    .from("student_kpi_snapshots")
    .select("*")
    .eq("user_id", userId)
    .order("snapshot_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch persisted KPI snapshots: ${error.message}`);
  }

  return ((data || []) as PersistedKpiSnapshotRow[]).filter(Boolean);
}

export async function buildPersistedScoreProjection(userId: string): Promise<PersistedScoreProjectionResult> {
  const canonical = await buildScoreEstimateFromCanonical(userId);
  const masteryData: DomainMastery[] = [
    ...canonical.estimate.breakdown.math.map((row) => ({
      section: "math" as const,
      domain: row.domain,
      mastery_score: Math.round((row.decayedMastery ?? 0) * 100),
      attempts: canonical.totalQuestionsAttempted,
      last_activity: canonical.lastUpdated,
    })),
    ...canonical.estimate.breakdown.rw.map((row) => ({
      section: "rw" as const,
      domain: row.domain,
      mastery_score: Math.round((row.decayedMastery ?? 0) * 100),
      attempts: canonical.totalQuestionsAttempted,
      last_activity: canonical.lastUpdated,
    })),
  ];

  return {
    totalQuestions: canonical.totalQuestionsAttempted,
    projection: canonical.estimate as ScoreProjection,
    lastUpdated: canonical.lastUpdated,
    masteryData,
  };
}

export async function upsertStudentKpiCountersCurrent(input: {
  userId: string;
  eventType: string;
  isCorrect: boolean;
  section: string;
  domain: string;
  skill: string;
  timeSpentMs?: number | null;
  eventId?: string | null;
  sourceVersion?: string;
}): Promise<PersistedKpiCountersCurrentRow> {
  const normalizedSection = normalizeKpiSection(input.section);
  const normalizedDomain = normalizeKpiDomain(input.domain);
  const normalizedSkill = normalizeKpiSkill(input.skill);

  if (!normalizedSection || !normalizedDomain || !normalizedSkill) {
    throw new Error("Missing canonical KPI taxonomy path");
  }

  if (!isKnownKpiTaxonomyPath(normalizedSection, normalizedDomain, normalizedSkill)) {
    throw new Error(`Unknown canonical KPI taxonomy path: ${normalizedSection}:${normalizedDomain}:${normalizedSkill}`);
  }

  const domainPrefix = getKpiDomainCounterPrefix(normalizedSection, normalizedDomain);
  const skillPrefix = getKpiSkillCounterPrefix(normalizedSection, normalizedDomain, normalizedSkill);
  if (!domainPrefix || !skillPrefix) {
    throw new Error(`Missing KPI DB column mapping for taxonomy path: ${normalizedSection}:${normalizedDomain}:${normalizedSkill}`);
  }

  const { data, error } = await supabaseServer.rpc("upsert_student_kpi_counters_current", {
    p_user_id: input.userId,
    p_event_type: input.eventType,
    p_is_correct: input.isCorrect,
    p_section: normalizedSection,
    p_domain: normalizedDomain,
    p_skill: normalizedSkill,
    p_domain_prefix: domainPrefix,
    p_skill_prefix: skillPrefix,
    p_time_spent_ms: input.timeSpentMs ?? null,
    p_event_id: input.eventId ?? null,
    p_source_version: input.sourceVersion || KPI_SOURCE_VERSION,
  });

  if (error) {
    throw new Error(`Failed to persist KPI counters: ${error.message}`);
  }

  return (data || null) as PersistedKpiCountersCurrentRow;
}

function readPracticeWindowStats(row: PersistedKpiSnapshotRow | null | undefined, prefix: "current_week" | "previous_week"): PracticeWindowStats {
  if (!row) {
    return {
      practiceSessions: 0,
      practiceMinutes: 0,
      questionsSolved: 0,
      accuracyPercent: 0,
      avgSecondsPerQuestion: 0,
    };
  }

  return {
    practiceSessions: Math.round(getCounterValue(row, `${prefix}_practice_sessions`)),
    practiceMinutes: Math.round(getCounterValue(row, `${prefix}_practice_minutes`)),
    questionsSolved: Math.round(getCounterValue(row, `${prefix}_questions_solved`)),
    accuracyPercent: Math.round(getCounterValue(row, `${prefix}_accuracy_percent`)),
    avgSecondsPerQuestion: Math.round(getCounterValue(row, `${prefix}_avg_seconds_per_question`) * 10) / 10,
  };
}

function readRecencyStats(row: PersistedKpiSnapshotRow | null | undefined): CanonicalPracticeKpiSnapshot["recency200"] {
  if (!row) {
    return {
      totalAttempts: 0,
      accuracyPercent: 0,
      avgSecondsPerQuestion: 0,
    };
  }

  return {
    totalAttempts: Math.round(getCounterValue(row, "recency_200_total_attempts")),
    accuracyPercent: Math.round(getCounterValue(row, "recency_200_accuracy_percent")),
    avgSecondsPerQuestion: Math.round(getCounterValue(row, "recency_200_avg_seconds_per_question") * 10) / 10,
  };
}

function buildKpiSnapshotInsertRow(args: {
  userId: string;
  sourceVersion: string;
  triggerEventType?: string | null;
  triggerEventId?: string | null;
  currentWeek: PracticeWindowStats;
  previousWeek: PracticeWindowStats;
  recency200: CanonicalPracticeKpiSnapshot["recency200"];
  currentProjection: PersistedScoreProjectionResult;
  currentRow: PersistedKpiCountersCurrentRow;
}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: args.userId,
    snapshot_at: new Date().toISOString(),
    source_version: args.sourceVersion,
    trigger_event_type: args.triggerEventType || null,
    trigger_event_id: args.triggerEventId || null,
    current_week_practice_sessions: args.currentWeek.practiceSessions,
    current_week_practice_minutes: args.currentWeek.practiceMinutes,
    current_week_questions_solved: args.currentWeek.questionsSolved,
    current_week_accuracy_percent: args.currentWeek.accuracyPercent,
    current_week_avg_seconds_per_question: args.currentWeek.avgSecondsPerQuestion,
    previous_week_practice_sessions: args.previousWeek.practiceSessions,
    previous_week_practice_minutes: args.previousWeek.practiceMinutes,
    previous_week_questions_solved: args.previousWeek.questionsSolved,
    previous_week_accuracy_percent: args.previousWeek.accuracyPercent,
    previous_week_avg_seconds_per_question: args.previousWeek.avgSecondsPerQuestion,
    recency_200_total_attempts: args.recency200.totalAttempts,
    recency_200_accuracy_percent: args.recency200.accuracyPercent,
    recency_200_avg_seconds_per_question: args.recency200.avgSecondsPerQuestion,
    overall_score_projection: args.currentRow.overall_score_projection ?? args.currentProjection.projection.composite,
    math_score_projection: args.currentRow.math_score_projection ?? args.currentProjection.projection.math,
    rw_score_projection: args.currentRow.rw_score_projection ?? args.currentProjection.projection.rw,
    readiness_metric: args.currentRow.readiness_metric ?? null,
    confidence_metric: args.currentRow.confidence_metric ?? args.currentProjection.projection.confidence * 100,
    consistency_metric: args.currentRow.consistency_metric ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  for (const definition of KPI_DOMAIN_DEFINITIONS) {
    const domainPrefix = getKpiDomainCounterPrefix(definition.section, definition.domain);
    if (!domainPrefix) continue;
    const domainAnswered = getCounterValue(args.currentRow, `${domainPrefix}_answered_count`);
    const domainCorrect = getCounterValue(args.currentRow, `${domainPrefix}_correct_count`);
    row[`${domainPrefix}_score_projection`] = domainAnswered > 0 ? Math.round((domainCorrect / domainAnswered) * 100) : 0;

    for (const skill of definition.skills) {
      const skillPrefix = getKpiSkillCounterPrefix(definition.section, definition.domain, skill);
      if (!skillPrefix) continue;
      const skillAnswered = getCounterValue(args.currentRow, `${skillPrefix}_answered_count`);
      const skillCorrect = getCounterValue(args.currentRow, `${skillPrefix}_correct_count`);
      row[`${skillPrefix}_score_projection`] = skillAnswered > 0 ? Math.round((skillCorrect / skillAnswered) * 100) : 0;
    }
  }

  return row;
}

async function fetchCanonicalPracticeKpiSnapshotRows(userId: string): Promise<PersistedKpiSnapshotRow[]> {
  return fetchPersistedKpiSnapshots(userId, 2);
}

export const KPI_TRUTH_LAYER_VERSION = "kpi_truth_v1";

export type KpiMetricKind = "official" | "weighted" | "diagnostic";

export interface KpiExplanation {
  ruleId: string;
  whatThisMeans: string;
  whyThisChanged: string;
  whatToDoNext: string;
}

export interface ExplainedKpiMetric {
  id: string;
  label: string;
  kind: KpiMetricKind;
  unit: "count" | "percent" | "minutes" | "seconds" | "score";
  value: number | null;
  explanation: KpiExplanation;
}

export interface PracticeWindowStats {
  practiceSessions: number;
  practiceMinutes: number;
  questionsSolved: number;
  accuracyPercent: number;
  avgSecondsPerQuestion: number;
}

export interface CanonicalPracticeKpiSnapshot {
  modelVersion: string;
  timezone: string;
  generatedAt: string;
  currentWeek: PracticeWindowStats;
  previousWeek: PracticeWindowStats;
  recency200: {
    totalAttempts: number;
    accuracyPercent: number;
    avgSecondsPerQuestion: number;
  };
}

export interface StudentKpiView {
  modelVersion: string;
  timezone: string;
  week: {
    practiceSessions: number;
    questionsSolved: number;
    accuracy: number;
    explanations: Record<string, KpiExplanation>;
  };
  recency: {
    window: number;
    totalAttempts: number;
    accuracy: number;
    avgSecondsPerQuestion: number;
    explanations: Record<string, KpiExplanation>;
  } | null;
  metrics: ExplainedKpiMetric[];
  gating: {
    historicalTrends: { allowed: boolean; requiredPlan: "paid"; reason: string };
  };
  measurementModel: {
    official: string[];
    weighted: string[];
    diagnostic: string[];
  };
}

interface AttemptRow {
  is_correct: boolean | null;
  time_spent_ms: number | null;
}

interface SessionRow {
  actual_duration_ms: number | null;
  started_at: string | null;
  finished_at: string | null;
}

const KPI_COUNTED_EVENT_SET = new Set<string>(KPI_CALENDAR_COUNTED_EVENTS);

export function isCanonicalKpiAttemptEventType(eventType: string | null | undefined): boolean {
  if (!eventType) return true; // Legacy rows before event_type migration
  return KPI_COUNTED_EVENT_SET.has(eventType);
}

function toPercent(correct: number, attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.round((correct / attempts) * 100);
}

function toSeconds(totalMs: number, attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.round((totalMs / attempts / 1000) * 10) / 10;
}

function computePracticeMinutes(sessions: SessionRow[]): number {
  let total = 0;
  for (const session of sessions) {
    if (typeof session.actual_duration_ms === "number" && session.actual_duration_ms >= 0) {
      total += Math.round(session.actual_duration_ms / 60000);
      continue;
    }
    if (session.started_at && session.finished_at) {
      const started = new Date(session.started_at).getTime();
      const finished = new Date(session.finished_at).getTime();
      if (Number.isFinite(started) && Number.isFinite(finished) && finished > started) {
        total += Math.round((finished - started) / 60000);
      }
    }
  }
  return total;
}

function buildWindowStats(attempts: AttemptRow[], sessions: SessionRow[]): PracticeWindowStats {
  const solved = attempts.length;
  const correct = attempts.filter((a) => !!a.is_correct).length;
  const totalTimeMs = attempts.reduce((sum, a) => sum + (a.time_spent_ms || 0), 0);

  return {
    practiceSessions: sessions.length,
    practiceMinutes: computePracticeMinutes(sessions),
    questionsSolved: solved,
    accuracyPercent: toPercent(correct, solved),
    avgSecondsPerQuestion: toSeconds(totalTimeMs, solved),
  };
}

function baselineReason(current: number, previous: number, unit: "count" | "percent" | "minutes" | "seconds"): string {
  if (previous === 0 && current === 0) {
    return "No activity in either the current or previous 7-day window.";
  }
  if (previous === 0 && current > 0) {
    return "Activity started this week after a quiet prior week.";
  }

  const delta = current - previous;
  if (delta === 0) {
    return "No change versus the previous 7-day window.";
  }

  const direction = delta > 0 ? "increased" : "decreased";
  const magnitude = unit === "percent" ? `${Math.abs(delta)} pts` : `${Math.abs(delta)}`;
  return `${direction} by ${magnitude} versus the previous 7-day window.`;
}

function guidanceForMetric(metricId: string, value: number): string {
  if (metricId === "week_accuracy") {
    if (value >= 80) return "Keep difficulty steady and add one mixed timed set to protect accuracy under pressure.";
    if (value >= 65) return "Review misses before the next session and target one weak skill block today.";
    return "Slow pace slightly, review every miss, and run one short untimed corrective set before speed work.";
  }
  if (metricId === "week_sessions") {
    if (value >= 5) return "Maintain session frequency and shift one session toward weakest skills.";
    if (value >= 3) return "Add one extra short session this week to stabilize consistency.";
    return "Schedule at least three short sessions this week before increasing question volume.";
  }
  if (metricId === "week_questions") {
    if (value >= 80) return "Hold volume and focus next set on error categories, not just throughput.";
    if (value >= 30) return "Increase one session by 10-15 questions while keeping review time fixed.";
    return "Start with one 20-question block and immediate review to rebuild momentum.";
  }
  if (metricId === "week_minutes") {
    if (value >= 180) return "Protect current study time and use post-session error logs to improve conversion.";
    if (value >= 90) return "Add one 20-minute block this week and keep it focused on one section.";
    return "Add short daily blocks (15-20 minutes) before trying longer sessions.";
  }
  if (metricId === "recency_accuracy") {
    if (value >= 80) return "Increase timed pressure gradually while keeping current review depth.";
    if (value >= 65) return "Run targeted drills on top two error tags before the next mixed set.";
    return "Pause broad drills and run focused remediation on the highest-miss skill cluster.";
  }
  if (metricId === "recency_pace") {
    if (value <= 75) return "Speed is strong; keep quality checks to avoid careless misses.";
    if (value <= 110) return "Maintain pace and add one timed section this week.";
    return "Use two-pass timing (easy first, then returns) to lower average seconds per question.";
  }
  return "Continue consistent practice and prioritize highest-impact weak areas.";
}

function buildExplanation(input: {
  metricId: string;
  whatThisMeans: string;
  current: number;
  previous: number;
  unit: "count" | "percent" | "minutes" | "seconds" | "score";
}): KpiExplanation {
  const reasonUnit = input.unit === "score" ? "count" : input.unit;
  return {
    ruleId: `RULE_${input.metricId.toUpperCase()}`,
    whatThisMeans: input.whatThisMeans,
    whyThisChanged: baselineReason(input.current, input.previous, reasonUnit),
    whatToDoNext: guidanceForMetric(input.metricId, input.current),
  };
}

async function fetchAttemptRows(userId: string, startUtc: string, endUtc: string): Promise<AttemptRow[]> {
  const { data, error } = await supabaseServer
    .from("student_question_attempts")
    .select("is_correct, time_spent_ms")
    .eq("user_id", userId)
    .gte("occurred_at", startUtc)
    .lte("occurred_at", endUtc);

  if (error) {
    throw new Error(`Failed to fetch attempts: ${error.message}`);
  }
  return (data || []) as AttemptRow[];
}

async function fetchSessionRows(userId: string, startUtc: string, endUtc: string): Promise<SessionRow[]> {
  const { data, error } = await supabaseServer
    .from("practice_sessions")
    .select("actual_duration_ms, started_at, finished_at")
    .eq("user_id", userId)
    .gte("started_at", startUtc)
    .lte("started_at", endUtc);

  if (error) {
    throw new Error(`Failed to fetch sessions: ${error.message}`);
  }
  return (data || []) as SessionRow[];
}

async function fetchRecencyRows(userId: string): Promise<AttemptRow[]> {
  const { data, error } = await supabaseServer
    .from("student_question_attempts")
    .select("is_correct, time_spent_ms")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Failed to fetch recency attempts: ${error.message}`);
  }
  return (data || []) as AttemptRow[];
}

async function resolveTimezone(userId: string): Promise<string> {
  const { data } = await supabaseServer
    .from("student_study_profile")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();

  return data?.timezone || "America/Chicago";
}

export async function buildCanonicalPracticeKpiSnapshot(userId: string): Promise<CanonicalPracticeKpiSnapshot> {
  const view = await buildStudentKpiViewFromCanonical(userId, true);
  const metricValue = (id: string): number => {
    const metric = view.metrics.find((candidate) => candidate.id === id);
    return typeof metric?.value === "number" && Number.isFinite(metric.value) ? metric.value : 0;
  };

  const currentWeek: PracticeWindowStats = {
    practiceSessions: view.week.practiceSessions,
    practiceMinutes: Math.round(metricValue("week_minutes")),
    questionsSolved: view.week.questionsSolved,
    accuracyPercent: view.week.accuracy,
    avgSecondsPerQuestion: Math.round(metricValue("recency_pace") * 10) / 10,
  };

  const recencyFromView = view.recency;
  const recency200 = {
    totalAttempts: recencyFromView?.totalAttempts ?? Math.round(metricValue("week_questions")),
    accuracyPercent: recencyFromView?.accuracy ?? Math.round(metricValue("recency_accuracy")),
    avgSecondsPerQuestion: recencyFromView?.avgSecondsPerQuestion ?? Math.round(metricValue("recency_pace") * 10) / 10,
  };

  return {
    modelVersion: view.modelVersion || KPI_TRUTH_LAYER_VERSION,
    timezone: view.timezone,
    generatedAt: new Date().toISOString(),
    currentWeek,
    previousWeek: { ...currentWeek },
    recency200,
  };
}

export async function persistCanonicalPracticeKpiSnapshot(args: {
  userId: string;
  triggerEventType?: string | null;
  triggerEventId?: string | null;
  sourceVersion?: string;
  currentRow?: PersistedKpiCountersCurrentRow | null;
}): Promise<void> {
  const currentRow = args.currentRow || (await fetchPersistedKpiCountersCurrent(args.userId));
  if (!currentRow) {
    return;
  }

  const timezone = await resolveTimezone(args.userId);
  const nowLocal = DateTime.now().setZone(timezone);
  const currentWeekEndLocal = nowLocal.endOf("day");
  const currentWeekStartLocal = currentWeekEndLocal.minus({ days: 6 }).startOf("day");
  const previousWeekEndLocal = currentWeekStartLocal.minus({ days: 1 }).endOf("day");
  const previousWeekStartLocal = previousWeekEndLocal.minus({ days: 6 }).startOf("day");

  const [
    currentWeekAttempts,
    currentWeekSessions,
    previousWeekAttempts,
    previousWeekSessions,
    recencyAttempts,
  ] = await Promise.all([
    fetchAttemptRows(args.userId, currentWeekStartLocal.toUTC().toISO()!, currentWeekEndLocal.toUTC().toISO()!),
    fetchSessionRows(args.userId, currentWeekStartLocal.toUTC().toISO()!, currentWeekEndLocal.toUTC().toISO()!),
    fetchAttemptRows(args.userId, previousWeekStartLocal.toUTC().toISO()!, previousWeekEndLocal.toUTC().toISO()!),
    fetchSessionRows(args.userId, previousWeekStartLocal.toUTC().toISO()!, previousWeekEndLocal.toUTC().toISO()!),
    fetchRecencyRows(args.userId),
  ]);

  const currentWeek = buildWindowStats(currentWeekAttempts, currentWeekSessions);
  const previousWeek = buildWindowStats(previousWeekAttempts, previousWeekSessions);
  const recencySolved = recencyAttempts.length;
  const recencyCorrect = recencyAttempts.filter((attempt) => !!attempt.is_correct).length;
  const recencyTimeMs = recencyAttempts.reduce((sum, attempt) => sum + (attempt.time_spent_ms || 0), 0);
  const currentProjection = buildScoreProjectionFromCounterRow(currentRow);
  const snapshotRow = buildKpiSnapshotInsertRow({
    userId: args.userId,
    sourceVersion: args.sourceVersion || KPI_SOURCE_VERSION,
    triggerEventType: args.triggerEventType,
    triggerEventId: args.triggerEventId,
    currentWeek,
    previousWeek,
    recency200: {
      totalAttempts: recencySolved,
      accuracyPercent: toPercent(recencyCorrect, recencySolved),
      avgSecondsPerQuestion: toSeconds(recencyTimeMs, recencySolved),
    },
    currentProjection,
    currentRow,
  });

  const { error } = await supabaseServer.from("student_kpi_snapshots").insert(snapshotRow);
  if (error && error.code !== "23505") {
    throw new Error(`Failed to persist KPI snapshot: ${error.message}`);
  }
}

function buildStudentMetrics(snapshot: CanonicalPracticeKpiSnapshot, includeHistoricalTrends: boolean): ExplainedKpiMetric[] {
  const metrics: ExplainedKpiMetric[] = [
    {
      id: "week_sessions",
      label: "Practice Sessions (7d)",
      kind: "diagnostic",
      unit: "count",
      value: snapshot.currentWeek.practiceSessions,
      explanation: buildExplanation({
        metricId: "week_sessions",
        whatThisMeans: "Number of completed practice sessions in the current 7-day local window.",
        current: snapshot.currentWeek.practiceSessions,
        previous: snapshot.previousWeek.practiceSessions,
        unit: "count",
      }),
    },
    {
      id: "week_questions",
      label: "Questions Solved (7d)",
      kind: "diagnostic",
      unit: "count",
      value: snapshot.currentWeek.questionsSolved,
      explanation: buildExplanation({
        metricId: "week_questions",
        whatThisMeans: "Number of practice attempts recorded in the current 7-day local window.",
        current: snapshot.currentWeek.questionsSolved,
        previous: snapshot.previousWeek.questionsSolved,
        unit: "count",
      }),
    },
    {
      id: "week_accuracy",
      label: "Accuracy (7d)",
      kind: "diagnostic",
      unit: "percent",
      value: snapshot.currentWeek.accuracyPercent,
      explanation: buildExplanation({
        metricId: "week_accuracy",
        whatThisMeans: "Percent of attempted questions answered correctly in the current 7-day window.",
        current: snapshot.currentWeek.accuracyPercent,
        previous: snapshot.previousWeek.accuracyPercent,
        unit: "percent",
      }),
    },
    {
      id: "week_minutes",
      label: "Practice Minutes (7d)",
      kind: "diagnostic",
      unit: "minutes",
      value: snapshot.currentWeek.practiceMinutes,
      explanation: buildExplanation({
        metricId: "week_minutes",
        whatThisMeans: "Total active study minutes across completed sessions in the current 7-day window.",
        current: snapshot.currentWeek.practiceMinutes,
        previous: snapshot.previousWeek.practiceMinutes,
        unit: "minutes",
      }),
    },
  ];

  if (includeHistoricalTrends) {
    metrics.push(
      {
        id: "recency_accuracy",
        label: "Accuracy (last 200 attempts)",
        kind: "diagnostic",
        unit: "percent",
        value: snapshot.recency200.accuracyPercent,
        explanation: buildExplanation({
          metricId: "recency_accuracy",
          whatThisMeans: "Rolling accuracy across the last 200 attempts.",
          current: snapshot.recency200.accuracyPercent,
          previous: snapshot.previousWeek.accuracyPercent,
          unit: "percent",
        }),
      },
      {
        id: "recency_pace",
        label: "Average Seconds/Question (last 200 attempts)",
        kind: "diagnostic",
        unit: "seconds",
        value: snapshot.recency200.avgSecondsPerQuestion,
        explanation: buildExplanation({
          metricId: "recency_pace",
          whatThisMeans: "Rolling average response time across the last 200 attempts.",
          current: Math.round(snapshot.recency200.avgSecondsPerQuestion),
          previous: Math.round(snapshot.previousWeek.avgSecondsPerQuestion),
          unit: "seconds",
        }),
      }
    );
  }

  return metrics;
}

function metricListToExplanationMap(metrics: ExplainedKpiMetric[]): Record<string, KpiExplanation> {
  const out: Record<string, KpiExplanation> = {};
  for (const metric of metrics) {
    out[metric.id] = metric.explanation;
  }
  return out;
}

export function buildStudentKpiView(
  snapshot: CanonicalPracticeKpiSnapshot,
  includeHistoricalTrends: boolean
): StudentKpiView {
  const metrics = buildStudentMetrics(snapshot, includeHistoricalTrends);
  const historicalAllowed = includeHistoricalTrends;

  const weekMetrics = metrics.filter((m) => m.id.startsWith("week_"));
  const recencyMetrics = metrics.filter((m) => m.id.startsWith("recency_"));

  return {
    modelVersion: snapshot.modelVersion,
    timezone: snapshot.timezone,
    week: {
      practiceSessions: snapshot.currentWeek.practiceSessions,
      questionsSolved: snapshot.currentWeek.questionsSolved,
      accuracy: snapshot.currentWeek.accuracyPercent,
      explanations: metricListToExplanationMap(weekMetrics),
    },
    recency: historicalAllowed
      ? {
          window: 200,
          totalAttempts: snapshot.recency200.totalAttempts,
          accuracy: snapshot.recency200.accuracyPercent,
          avgSecondsPerQuestion: snapshot.recency200.avgSecondsPerQuestion,
          explanations: metricListToExplanationMap(recencyMetrics),
        }
      : null,
    metrics,
    gating: {
      historicalTrends: {
        allowed: historicalAllowed,
        requiredPlan: "paid",
        reason: historicalAllowed
          ? "Student has active paid entitlement."
          : "Historical trend KPIs require an active paid entitlement.",
      },
    },
    measurementModel: {
      official: [],
      weighted: [],
      diagnostic: metrics.map((m) => m.id),
    },
  };
}

export interface FullTestKpiInput {
  scaledTotal: number;
  scaledRw: number;
  scaledMath: number;
  totalCorrect: number;
  totalQuestions: number;
}

export function buildFullTestKpis(input: FullTestKpiInput): ExplainedKpiMetric[] {
  const accuracyPercent = input.totalQuestions > 0 ? Math.round((input.totalCorrect / input.totalQuestions) * 100) : 0;

  return [
    {
      id: "official_sat_score",
      label: "Official SAT Score",
      kind: "official",
      unit: "score",
      value: null,
      explanation: {
        ruleId: "RULE_OFFICIAL_SCORE_UNAVAILABLE",
        whatThisMeans: "Official SAT scores come only from College Board reports.",
        whyThisChanged: "Lyceon practice tests produce diagnostic estimates, not official scores.",
        whatToDoNext: "Use this result for study planning, then validate on the next official or proctored benchmark.",
      },
    },
    {
      id: "estimated_scaled_total",
      label: "Estimated Scaled Total",
      kind: "weighted",
      unit: "score",
      value: input.scaledTotal,
      explanation: {
        ruleId: "RULE_ESTIMATED_SCALED_TOTAL",
        whatThisMeans: "Weighted estimate mapped from this test's raw performance only.",
        whyThisChanged: "Value reflects this completed test's section performance, not an average across tests.",
        whatToDoNext: "Compare this estimate to your prior test and focus next sessions on the lower section score.",
      },
    },
    {
      id: "estimated_scaled_rw",
      label: "Estimated Scaled RW",
      kind: "weighted",
      unit: "score",
      value: input.scaledRw,
      explanation: {
        ruleId: "RULE_ESTIMATED_RW",
        whatThisMeans: "Weighted section estimate for Reading & Writing from this test.",
        whyThisChanged: "Computed from RW module outcomes in this session only.",
        whatToDoNext: "If RW is lower than Math, assign your next two sessions to RW weak domains.",
      },
    },
    {
      id: "estimated_scaled_math",
      label: "Estimated Scaled Math",
      kind: "weighted",
      unit: "score",
      value: input.scaledMath,
      explanation: {
        ruleId: "RULE_ESTIMATED_MATH",
        whatThisMeans: "Weighted section estimate for Math from this test.",
        whyThisChanged: "Computed from Math module outcomes in this session only.",
        whatToDoNext: "If Math is lower than RW, prioritize medium-to-hard math sets with post-set error review.",
      },
    },
    {
      id: "diagnostic_accuracy",
      label: "Diagnostic Accuracy",
      kind: "diagnostic",
      unit: "percent",
      value: accuracyPercent,
      explanation: {
        ruleId: "RULE_DIAGNOSTIC_ACCURACY",
        whatThisMeans: "Raw percent correct on this completed test session.",
        whyThisChanged: "Reflects this test only; previous tests are not averaged into this value.",
        whatToDoNext: "Use missed-question patterns to build your next targeted practice block.",
      },
    },
  ];
}

export function fullTestMeasurementModel() {
  return {
    official: ["official_sat_score"],
    weighted: ["estimated_scaled_total", "estimated_scaled_rw", "estimated_scaled_math"],
    diagnostic: ["diagnostic_accuracy"],
  };
}

export type StudentFullLengthReportView = CompleteExamResult & {
  kpis: ExplainedKpiMetric[];
  measurementModel: ReturnType<typeof fullTestMeasurementModel>;
};

export function buildStudentFullLengthReportView(report: CompleteExamResult): StudentFullLengthReportView {
  return {
    ...report,
    kpis: buildFullTestKpis({
      scaledTotal: report.scaledScore.total,
      scaledRw: report.scaledScore.rw,
      scaledMath: report.scaledScore.math,
      totalCorrect: report.rawScore.total.correct,
      totalQuestions: report.rawScore.total.total,
    }),
    measurementModel: fullTestMeasurementModel(),
  };
}

export function projectGuardianFullLengthReportView(view: StudentFullLengthReportView) {
  return {
    sessionId: view.sessionId,
    estimatedScore: {
      rw: view.scaledScore.rw,
      math: view.scaledScore.math,
      total: view.scaledScore.total,
    },
    completedAt: view.completedAt,
    kpis: view.kpis,
    measurementModel: view.measurementModel,
  };
}
