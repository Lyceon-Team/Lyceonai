import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import type { CompleteExamResult } from "../../apps/api/src/services/fullLengthExam";
import { logger } from "../logger";
import {
  diagnosticStateSchema,
  type DiagnosticState,
} from "../../packages/shared/src/diagnostic-state";

export const CANONICAL_RUNTIME_VIEW_VERSION = "kpi_truth_v1";

export interface KpiExplanation {
  ruleId: string;
  whatThisMeans: string;
  whyThisChanged: string;
  whatToDoNext: string;
}

export interface ExplainedKpiMetric {
  id: string;
  label: string;
  kind: "official" | "weighted" | "diagnostic";
  unit: "count" | "percent" | "minutes" | "seconds" | "score";
  value: number | null;
  explanation: KpiExplanation;
}

export interface StudentKpiView {
  modelVersion: string;
  timezone: string;
  week: {
    questionsSolved: number; // events_last_7d (a scored event == an answered question)
    accuracy: number | null; // round(accuracy_last_7d * 100); null when no events
    explanations: Record<string, KpiExplanation>;
  };
  recency: {
    window: number; // 30-day trend window
    totalAttempts: number; // events_last_30d
    accuracy: number | null; // round(accuracy_last_30d * 100); null when no events
    explanations: Record<string, KpiExplanation>;
  } | null;
  metrics: ExplainedKpiMetric[];
  gating: {
    historicalTrends: {
      allowed: boolean;
      requiredPlan: "paid";
      reason: string;
    };
  };
  measurementModel: {
    official: string[];
    weighted: string[];
    diagnostic: string[];
  };
}

function guidanceForMetric(metricId: string, value: number | null): string {
  if (value === null) {
    return "No scored evidence in this window yet — complete a few questions to populate it.";
  }
  if (metricId === "week_accuracy" || metricId === "recency_accuracy") {
    if (value >= 80)
      return "Keep difficulty steady and add one mixed timed set to protect accuracy under pressure.";
    if (value >= 65)
      return "Review misses before the next session and target one weak skill block today.";
    return "Slow pace slightly, review every miss, and run one short untimed corrective set before speed work.";
  }
  if (metricId === "week_questions") {
    if (value >= 80)
      return "Hold volume and focus next set on error categories, not just throughput.";
    if (value >= 30)
      return "Increase one session by 10-15 questions while keeping review time fixed.";
    return "Start with one 20-question block and immediate review to rebuild momentum.";
  }
  if (metricId === "current_streak") {
    if (value >= 5)
      return "Strong consistency — keep the daily cadence and shift one block toward weakest skills.";
    if (value >= 1)
      return "Protect the streak with at least one short scored block today.";
    return "Start a streak today: one short scored practice block counts.";
  }
  return "Continue consistent practice and prioritize highest-impact weak areas.";
}

function windowNote(unit: "count" | "percent", windowDays: number): string {
  return unit === "percent"
    ? `Correct fraction across scored events in the last ${windowDays} days.`
    : `Scored events recorded in the last ${windowDays} days.`;
}

function buildExplanation(input: {
  metricId: string;
  whatThisMeans: string;
  whyThisChanged: string;
  value: number | null;
}): KpiExplanation {
  return {
    ruleId: `RULE_${input.metricId.toUpperCase()}`,
    whatThisMeans: input.whatThisMeans,
    whyThisChanged: input.whyThisChanged,
    whatToDoNext: guidanceForMetric(input.metricId, input.value),
  };
}

function metricListToExplanationMap(
  metrics: ExplainedKpiMetric[],
): Record<string, KpiExplanation> {
  const out: Record<string, KpiExplanation> = {};
  for (const metric of metrics) {
    out[metric.id] = metric.explanation;
  }
  return out;
}

// Genesis accuracy_* columns are 0–1 fractions (Doc 05B §6.5). Present as an integer
// percent; null (not 0) when the window has zero events — an honest "no data" signal.
function toAccuracyPercent(fraction: unknown, events: number): number | null {
  if (events <= 0) return null;
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return null;
  return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
}

type OverallKpiRow = {
  events_total: number | null;
  events_last_7d: number | null;
  events_last_30d: number | null;
  accuracy_overall: number | null;
  accuracy_last_7d: number | null;
  accuracy_last_30d: number | null;
  current_streak_days: number | null;
  longest_streak_days: number | null;
  sections_active: number | null;
  last_active_at: string | null;
};

async function resolveTimezone(userId: string): Promise<string> {
  const { data } = await supabaseServer
    .from("student_study_profile")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();

  return data?.timezone || "America/Chicago";
}

function buildStudentMetrics(input: {
  weekEvents: number;
  weekAccuracyPct: number | null;
  recency30Events: number;
  recency30AccuracyPct: number | null;
  currentStreakDays: number;
  includeHistoricalTrends: boolean;
}): ExplainedKpiMetric[] {
  const metrics: ExplainedKpiMetric[] = [
    {
      id: "week_questions",
      label: "Questions Solved (7d)",
      kind: "diagnostic",
      unit: "count",
      value: input.weekEvents,
      explanation: buildExplanation({
        metricId: "week_questions",
        whatThisMeans: "Scored practice events recorded in the last 7 days.",
        whyThisChanged: windowNote("count", 7),
        value: input.weekEvents,
      }),
    },
    {
      id: "week_accuracy",
      label: "Accuracy (7d)",
      kind: "diagnostic",
      unit: "percent",
      value: input.weekAccuracyPct,
      explanation: buildExplanation({
        metricId: "week_accuracy",
        whatThisMeans:
          "Percent of scored events answered correctly in the last 7 days.",
        whyThisChanged: windowNote("percent", 7),
        value: input.weekAccuracyPct,
      }),
    },
    {
      id: "current_streak",
      label: "Current Streak (days)",
      kind: "diagnostic",
      unit: "count",
      value: input.currentStreakDays,
      explanation: buildExplanation({
        metricId: "current_streak",
        whatThisMeans:
          "Consecutive days with at least one scored practice event.",
        whyThisChanged: "Derived from your most recent active-day run.",
        value: input.currentStreakDays,
      }),
    },
  ];

  if (input.includeHistoricalTrends) {
    metrics.push({
      id: "recency_accuracy",
      label: "Accuracy (30d)",
      kind: "diagnostic",
      unit: "percent",
      value: input.recency30AccuracyPct,
      explanation: buildExplanation({
        metricId: "recency_accuracy",
        whatThisMeans:
          "Percent of scored events answered correctly in the last 30 days.",
        whyThisChanged: windowNote("percent", 30),
        value: input.recency30AccuracyPct,
      }),
    });
  }

  return metrics;
}

/**
 * @spec [Doc-05B_V1, §6.5/§6.7 KPI visibility + §10.5 column projection] | @implemented [2026-06-22]
 * plain English: builds the student KPI view from the genesis event-aggregated rollup
 * (`student_overall_kpi`). The retired old-gen `student_kpi_rollups_current` flat columns
 * (source_family/total_questions/avg_latency_ms) are gone — it is an unpopulated no-writer
 * shell. Exposes only student-granted columns (events/accuracy/streak); never the admin-only
 * audit columns or mastery_score/pct. Accuracy is a 0–1 fraction → integer percent, null
 * (honest "no data") when the window has zero events. Engagement metrics the event model does
 * not track (sessions/minutes/pace) are intentionally dropped (owner ruling 2026-06-22).
 */
export async function buildStudentKpiViewFromCanonical(
  userId: string,
  includeHistoricalTrends: boolean,
): Promise<StudentKpiView> {
  const timezone = await resolveTimezone(userId);

  const { data: overall, error: overallError } = await supabaseServer
    .from("student_overall_kpi")
    .select(
      "events_total, events_last_7d, events_last_30d, accuracy_overall, accuracy_last_7d, accuracy_last_30d, current_streak_days, longest_streak_days, sections_active, last_active_at",
    )
    .eq("student_id", userId)
    .maybeSingle();

  if (overallError) {
    throw new Error(`Failed to fetch overall KPI: ${overallError.message}`);
  }

  const row = (overall ?? null) as OverallKpiRow | null;
  const toInt = (value: number | null | undefined): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.round(value))
      : 0;

  const weekEvents = toInt(row?.events_last_7d);
  const recency30Events = toInt(row?.events_last_30d);
  const currentStreakDays = toInt(row?.current_streak_days);
  const weekAccuracyPct = toAccuracyPercent(row?.accuracy_last_7d, weekEvents);
  const recency30AccuracyPct = toAccuracyPercent(
    row?.accuracy_last_30d,
    recency30Events,
  );

  const metrics = buildStudentMetrics({
    weekEvents,
    weekAccuracyPct,
    recency30Events,
    recency30AccuracyPct,
    currentStreakDays,
    includeHistoricalTrends,
  });
  const weekMetrics = metrics.filter(
    (m) => m.id.startsWith("week_") || m.id === "current_streak",
  );
  const recencyMetrics = metrics.filter((m) => m.id.startsWith("recency_"));

  return {
    modelVersion: CANONICAL_RUNTIME_VIEW_VERSION,
    timezone,
    week: {
      questionsSolved: weekEvents,
      accuracy: weekAccuracyPct,
      explanations: metricListToExplanationMap(weekMetrics),
    },
    recency: includeHistoricalTrends
      ? {
          window: 30,
          totalAttempts: recency30Events,
          accuracy: recency30AccuracyPct,
          explanations: metricListToExplanationMap(recencyMetrics),
        }
      : null,
    metrics,
    gating: {
      historicalTrends: {
        allowed: includeHistoricalTrends,
        requiredPlan: "paid",
        reason: includeHistoricalTrends
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

export interface ScoreEstimate {
  composite: number;
  math: number;
  rw: number;
  range: {
    low: number;
    high: number;
  };
  confidence: number;
}

type SectionProjectionRow = {
  section: string | null;
  projected_score_mid: number | null;
  projected_score_low: number | null;
  projected_score_high: number | null;
  relevant_question_count: number | null;
};

function normalizeSectionKey(value: unknown): "math" | "rw" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "math" || normalized === "m" || normalized === "mth")
    return "math";
  if (
    normalized === "rw" ||
    normalized === "reading_writing" ||
    normalized === "reading and writing"
  )
    return "rw";
  return null;
}

function clampScore(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Honest-signal contract (LC-AM3-001 / mastery-from-observed-events-only):
 * the weighted score estimate is derived from 05C section projections. While those rollups are
 * deferred (Lane C AM-3) — or simply not yet computed for a student — the estimate MUST read as
 * UNCOMPUTED, never as a fabricated baseline (200/400). A `computed` result only exists when BOTH
 * section projections (math AND rw) are present; otherwise the composite would be invented.
 */
export type CanonicalScoreEstimate =
  | {
      status: "uncomputed";
      estimate: null;
      totalQuestionsAttempted: number;
      lastUpdated: string;
    }
  | {
      status: "computed";
      estimate: ScoreEstimate;
      totalQuestionsAttempted: number;
      lastUpdated: string;
    };

/**
 * @spec [Vertical-B Slice 2] @implemented 2026-08-12
 *
 * plain English: the frozen diagnostic baseline score estimate, captured once at
 * diagnostic completion and never updated. Same shape as ScoreEstimate plus the
 * timestamp it was captured at.
 */
export type BaselineEstimate = {
  composite: number;
  math: number;
  rw: number;
  range: { low: number; high: number };
  confidence: number;
  capturedAt: string;
};

/**
 * @spec [Vertical-B Slice 2] @implemented 2026-08-12
 *
 * plain English: read the diagnostic_baseline snapshots for a student.
 * Returns a BaselineEstimate if both M and RW baseline snapshots exist and have
 * non-NULL projected_score_mid, or null if no baseline has been captured yet.
 */
export async function readDiagnosticBaseline(
  userId: string,
): Promise<BaselineEstimate | null> {
  const { data: snapshots, error } = await supabaseServer
    .from("student_section_projection_snapshots")
    .select(
      "section, projected_score_mid, projected_score_low, projected_score_high, relevant_question_count, snapshot_at",
    )
    .eq("student_id", userId)
    .eq("snapshot_kind", "diagnostic_baseline");

  if (error || !snapshots) {
    return null;
  }

  const rows = snapshots as Array<{
    section: string | null;
    projected_score_mid: number | null;
    projected_score_low: number | null;
    projected_score_high: number | null;
    relevant_question_count: number | null;
    snapshot_at: string | null;
  }>;

  const sectionMap = new Map<"math" | "rw", (typeof rows)[0]>();
  for (const row of rows) {
    const key = normalizeSectionKey(row.section);
    if (!key) continue;
    sectionMap.set(key, row);
  }

  const math = sectionMap.get("math");
  const rw = sectionMap.get("rw");
  const mathMid = math?.projected_score_mid;
  const rwMid = rw?.projected_score_mid;

  // Both sections must have non-NULL projections for a valid baseline.
  if (typeof mathMid !== "number" || typeof rwMid !== "number") {
    return null;
  }

  const mathLow =
    typeof math?.projected_score_low === "number"
      ? math.projected_score_low
      : mathMid;
  const rwLow =
    typeof rw?.projected_score_low === "number"
      ? rw.projected_score_low
      : rwMid;
  const mathHigh =
    typeof math?.projected_score_high === "number"
      ? math.projected_score_high
      : mathMid;
  const rwHigh =
    typeof rw?.projected_score_high === "number"
      ? rw.projected_score_high
      : rwMid;
  const relevantCount =
    (math?.relevant_question_count ?? 0) + (rw?.relevant_question_count ?? 0);

  // Use the earlier snapshot_at as the baseline timestamp (both should be identical).
  const capturedAt = math?.snapshot_at ?? rw?.snapshot_at ?? "";

  return {
    composite: clampScore(Math.round(mathMid + rwMid), 400, 1600),
    math: clampScore(Math.round(mathMid), 200, 800),
    rw: clampScore(Math.round(rwMid), 200, 800),
    range: {
      low: clampScore(Math.round(mathLow + rwLow), 400, 1600),
      high: clampScore(Math.round(mathHigh + rwHigh), 400, 1600),
    },
    confidence: Math.max(0, Math.min(1, relevantCount / 120)),
    capturedAt,
  };
}

export async function buildScoreEstimateFromCanonical(
  userId: string,
): Promise<CanonicalScoreEstimate> {
  // Genesis read surface (Doc 05C): the score estimate is the section-projection blend.
  // The evidence count comes from the canonical event rollup (events_total); the
  // per-domain breakdown is intentionally NOT served — it derived from admin-only
  // mastery_pct, which Doc 05B §10.5 keeps off student/guardian read surfaces.
  const [
    { data: projections, error: projectionError },
    { data: overall, error: overallError },
  ] = await Promise.all([
    supabaseServer
      .from("student_section_projections")
      .select(
        "section, projected_score_mid, projected_score_low, projected_score_high, relevant_question_count",
      )
      .eq("student_id", userId),
    supabaseServer
      .from("student_overall_kpi")
      .select("events_total")
      .eq("student_id", userId)
      .maybeSingle(),
  ]);

  if (projectionError) {
    throw new Error(
      `Failed to fetch section projections: ${projectionError.message}`,
    );
  }
  if (overallError) {
    throw new Error(`Failed to fetch overall KPI: ${overallError.message}`);
  }

  const projectionRows = (projections ?? []) as SectionProjectionRow[];
  const overallRow = (overall ?? null) as {
    events_total: number | null;
  } | null;
  const totalQuestionsAttempted =
    typeof overallRow?.events_total === "number" &&
    Number.isFinite(overallRow.events_total)
      ? Math.max(0, Math.round(overallRow.events_total))
      : 0;

  const sectionMap = new Map<"math" | "rw", SectionProjectionRow>();
  for (const row of projectionRows) {
    const key = normalizeSectionKey(row.section);
    if (!key) continue;
    sectionMap.set(key, row);
  }

  const math = sectionMap.get("math");
  const rw = sectionMap.get("rw");

  // LC-AM3-001 honest-signal: a composite needs BOTH section projections to be real. While 05C
  // projections are deferred (AM-3) or not yet computed, one or both rows are absent — return
  // UNCOMPUTED (no fabricated baseline). The route/UI labels "not yet available".
  const mathMid = math?.projected_score_mid;
  const rwMid = rw?.projected_score_mid;
  if (typeof mathMid !== "number" || typeof rwMid !== "number") {
    return {
      status: "uncomputed",
      estimate: null,
      totalQuestionsAttempted,
      lastUpdated: new Date().toISOString(),
    };
  }

  // Both projections present: compute from REAL values only (no defaults). Missing low/high
  // bound falls back to the present mid (a real value), never to a 200 floor.
  const mathLow =
    typeof math?.projected_score_low === "number"
      ? math.projected_score_low
      : mathMid;
  const rwLow =
    typeof rw?.projected_score_low === "number"
      ? rw.projected_score_low
      : rwMid;
  const mathHigh =
    typeof math?.projected_score_high === "number"
      ? math.projected_score_high
      : mathMid;
  const rwHigh =
    typeof rw?.projected_score_high === "number"
      ? rw.projected_score_high
      : rwMid;
  const relevantCount =
    (math?.relevant_question_count ?? 0) + (rw?.relevant_question_count ?? 0);

  const estimate: ScoreEstimate = {
    composite: clampScore(Math.round(mathMid + rwMid), 400, 1600),
    math: clampScore(Math.round(mathMid), 200, 800),
    rw: clampScore(Math.round(rwMid), 200, 800),
    range: {
      low: clampScore(Math.round(mathLow + rwLow), 400, 1600),
      high: clampScore(Math.round(mathHigh + rwHigh), 400, 1600),
    },
    confidence: Math.max(0, Math.min(1, relevantCount / 120)),
  };

  return {
    status: "computed",
    estimate,
    totalQuestionsAttempted,
    lastUpdated: new Date().toISOString(),
  };
}

export interface FullTestKpiInput {
  scaledTotal: number;
  scaledRw: number;
  scaledMath: number;
  totalCorrect: number;
  totalQuestions: number;
}

export function buildFullTestKpis(
  input: FullTestKpiInput,
): ExplainedKpiMetric[] {
  const accuracyPercent =
    input.totalQuestions > 0
      ? Math.round((input.totalCorrect / input.totalQuestions) * 100)
      : 0;

  return [
    {
      id: "official_sat_score",
      label: "Official SAT Score",
      kind: "official",
      unit: "score",
      value: null,
      explanation: {
        ruleId: "RULE_OFFICIAL_SCORE_UNAVAILABLE",
        whatThisMeans:
          "Official SAT scores come only from College Board reports.",
        whyThisChanged:
          "Lyceon practice tests produce diagnostic estimates, not official scores.",
        whatToDoNext:
          "Use this result for study planning, then validate on the next official or proctored benchmark.",
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
        whatThisMeans:
          "Weighted estimate mapped from this test's raw performance only.",
        whyThisChanged:
          "Value reflects this completed test's section performance, not an average across tests.",
        whatToDoNext:
          "Compare this estimate to your prior test and focus next sessions on the lower section score.",
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
        whatThisMeans:
          "Weighted section estimate for Reading & Writing from this test.",
        whyThisChanged:
          "Computed from RW module outcomes in this session only.",
        whatToDoNext:
          "If RW is lower than Math, assign your next two sessions to RW weak domains.",
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
        whyThisChanged:
          "Computed from Math module outcomes in this session only.",
        whatToDoNext:
          "If Math is lower than RW, prioritize medium-to-hard math sets with post-set error review.",
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
        whyThisChanged:
          "Reflects this test only; previous tests are not averaged into this value.",
        whatToDoNext:
          "Use missed-question patterns to build your next targeted practice block.",
      },
    },
  ];
}

export function fullTestMeasurementModel() {
  return {
    official: ["official_sat_score"],
    weighted: [
      "estimated_scaled_total",
      "estimated_scaled_rw",
      "estimated_scaled_math",
    ],
    diagnostic: ["diagnostic_accuracy"],
  };
}

export type StudentFullLengthReportView = CompleteExamResult & {
  kpis: ExplainedKpiMetric[];
  measurementModel: ReturnType<typeof fullTestMeasurementModel>;
};

export function buildStudentFullLengthReportView(
  report: CompleteExamResult,
): StudentFullLengthReportView {
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

/**
 * @spec [Doc-05C_V1.0 §7.4; owner rulings Q1 + Q2, 2026-08-17] @implemented 2026-08-17
 *
 * plain English: read the ONE canonical diagnostic-lifecycle state for a student
 * from public.student_diagnostic_state() (migration 20260817010000). The
 * derivation is deliberately not restated here — this function is transport plus
 * a Zod narrow at the boundary, nothing else.
 *
 * expected outcome: one of the four DiagnosticState literals, or null when the
 * state could not be read.
 *
 * WHY null RATHER THAN A DEFAULT. Every default is a lie in some direction:
 * 'not_taken' re-tells a student who finished the diagnostic to take one (the
 * defect this workstream exists to remove), and 'baseline_pending' hides the CTA
 * from a student who genuinely has not started, leaving them no way in. null
 * means "unknown", and the caller degrades to the pre-existing
 * baseline-presence derivation — the behaviour shipped today, which is wrong only
 * for students already in the broken state and wrong in no new way.
 *
 * trade-offs: one extra RPC on the projection endpoint. It replaces no read, so
 * the endpoint issues one more round trip than before; the function is STABLE and
 * touches two small grouped reads.
 */
export async function readDiagnosticState(
  userId: string,
): Promise<DiagnosticState | null> {
  const { data, error } = await supabaseServer.rpc("student_diagnostic_state", {
    p_student_id: userId,
  });

  if (error) {
    logger.warn(
      "DIAGNOSTIC_STATE",
      "diagnostic_state_read_failed",
      "diagnostic lifecycle state read failed; falling back to baseline presence",
      { userId, dbError: error.message },
    );
    return null;
  }

  // unknown at the boundary, narrowed with Zod (Coding Standards §7.1). A value
  // outside the enum means the migration and this module have diverged, which the
  // drift gate should have caught — log it rather than coercing it into a state.
  const parsed = diagnosticStateSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn(
      "DIAGNOSTIC_STATE",
      "diagnostic_state_unrecognized",
      "student_diagnostic_state() returned a value outside the known state set",
      { userId },
    );
    return null;
  }

  return parsed.data;
}

/**
 * @spec [Doc-05C_V1.0 §7.4; Doc-01_V8 product pillar: honest progress signals;
 *        owner ruling 2026-08-17 "report the true count in EVERY branch"]
 * @implemented 2026-08-17
 *
 * plain English: how many questions this student has actually answered. Counted
 * from the durable answer rows, not from a rollup.
 *
 * WHY NOT student_overall_kpi.events_total — WHICH IS WHAT THE PROJECTION USES
 *   events_total is a mastery rollup. Every rollup in this system was EMPTY for
 *   every student for seven weeks while apply_mastery_event was failing, and a
 *   student with forty answered questions would have read as events_total = 0 —
 *   the same false zero this change exists to remove, arriving by a different
 *   route. practice_session_items rows are written by the answer handler itself
 *   and do not depend on the mastery pipeline being healthy.
 *
 * WHY null AND NOT 0 ON FAILURE
 *   0 is a legitimate answer — a student who has answered nothing. A failed read
 *   is not that answer. Collapsing the two is the failure class that produced
 *   BUG-1 (a skipped baseline capture indistinguishable from no diagnostic) and
 *   the outage's invisibility, and this function must not add a third instance of
 *   it. The caller serves null and the surface omits the line: absent beats wrong.
 *
 * expected outcome: N for a student with N answered items, 0 for a student with
 * none, null when the count could not be established.
 */
export async function readAnsweredQuestionCount(
  userId: string,
): Promise<number | null> {
  const { count, error } = await supabaseServer
    .from("practice_session_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "answered");

  if (error) {
    logger.warn(
      "PROGRESS",
      "answered_question_count_read_failed",
      "answered-question count read failed; the surface will omit the figure rather than report zero",
      { userId, dbError: error.message },
    );
    return null;
  }

  // A null count with no error should not happen with head+exact, but "the
  // database did not tell us" is not "the student answered nothing".
  return typeof count === "number" ? count : null;
}

/**
 * @spec [owner standing rule 2026-08-21 — the guardian path is the student read plus a
 *   gate, with the scope narrowing applied as a PROJECTION of the one path; Doc 05B §6.5
 *   guardian-granted event vocabulary (events / accuracy / streak); owner ruling
 *   2026-08-17 — an unestablished count is null and is omitted, never rendered as zero]
 * | @implemented [2026-08-21]
 *
 * plain English: narrows the student KPI view to the three metrics a guardian may see, and
 * passes their values through UNCHANGED. It computes nothing.
 *
 * WHAT THIS REPLACES, AND WHY IT MATTERED.
 *   The guardian route used to pull those metric values out and coerce them with `?? 0`.
 *   That turned "we could not establish this figure" into a confident zero on a parent's
 *   screen — the same NULL-to-zero fail-open that told students their least-practised
 *   skills were their worst. The student surface deliberately carries `null` and omits the
 *   figure; the guardian surface was contradicting it. `null` now survives to the client,
 *   which must omit rather than render it.
 *
 * It sits beside projectGuardianFullLengthReportView because that function is the pattern:
 * ONE builder, then a pure projection for the narrower audience.
 */
export function projectGuardianKpiView(view: StudentKpiView) {
  const GUARDIAN_METRIC_IDS = new Set([
    "week_questions",
    "week_accuracy",
    "current_streak",
  ]);

  const metrics = view.metrics.filter((metric) =>
    GUARDIAN_METRIC_IDS.has(metric.id),
  );
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));

  // `?? null`, never `?? 0`. A metric the builder could not establish stays absent.
  const numericOrNull = (id: string): number | null => {
    const value = byId.get(id)?.value;
    return value === null || value === undefined ? null : Number(value);
  };

  return {
    progress: {
      questionsAttempted: numericOrNull("week_questions"),
      accuracy: numericOrNull("week_accuracy"),
      currentStreakDays: numericOrNull("current_streak"),
      explanations: Object.fromEntries(
        metrics.map((metric) => [metric.id, metric.explanation]),
      ),
    },
    metrics,
    measurementModel: {
      official: [],
      weighted: [],
      diagnostic: metrics.map((metric) => metric.id),
    },
    modelVersion: view.modelVersion,
  };
}

export function projectGuardianFullLengthReportView(
  view: StudentFullLengthReportView,
) {
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
