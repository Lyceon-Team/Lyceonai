import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import type { CompleteExamResult } from "../../apps/api/src/services/fullLengthExam";

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

type PracticeWindowStats = {
  practiceSessions: number;
  practiceMinutes: number;
  questionsSolved: number;
  accuracyPercent: number;
  avgSecondsPerQuestion: number;
};

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

function metricListToExplanationMap(metrics: ExplainedKpiMetric[]): Record<string, KpiExplanation> {
  const out: Record<string, KpiExplanation> = {};
  for (const metric of metrics) {
    out[metric.id] = metric.explanation;
  }
  return out;
}

async function resolveTimezone(userId: string): Promise<string> {
  const { data } = await supabaseServer
    .from("student_study_profile")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();

  return data?.timezone || "America/Chicago";
}

function buildStudentMetrics(input: {
  currentWeek: PracticeWindowStats;
  previousWeek: PracticeWindowStats;
  recency200: { totalAttempts: number; accuracyPercent: number; avgSecondsPerQuestion: number };
  includeHistoricalTrends: boolean;
}): ExplainedKpiMetric[] {
  const metrics: ExplainedKpiMetric[] = [
    {
      id: "week_sessions",
      label: "Practice Sessions (7d)",
      kind: "diagnostic",
      unit: "count",
      value: input.currentWeek.practiceSessions,
      explanation: buildExplanation({
        metricId: "week_sessions",
        whatThisMeans: "Number of completed practice sessions in the current 7-day local window.",
        current: input.currentWeek.practiceSessions,
        previous: input.previousWeek.practiceSessions,
        unit: "count",
      }),
    },
    {
      id: "week_questions",
      label: "Questions Solved (7d)",
      kind: "diagnostic",
      unit: "count",
      value: input.currentWeek.questionsSolved,
      explanation: buildExplanation({
        metricId: "week_questions",
        whatThisMeans: "Number of practice attempts recorded in the current 7-day local window.",
        current: input.currentWeek.questionsSolved,
        previous: input.previousWeek.questionsSolved,
        unit: "count",
      }),
    },
    {
      id: "week_accuracy",
      label: "Accuracy (7d)",
      kind: "diagnostic",
      unit: "percent",
      value: input.currentWeek.accuracyPercent,
      explanation: buildExplanation({
        metricId: "week_accuracy",
        whatThisMeans: "Percent of attempted questions answered correctly in the current 7-day window.",
        current: input.currentWeek.accuracyPercent,
        previous: input.previousWeek.accuracyPercent,
        unit: "percent",
      }),
    },
    {
      id: "week_minutes",
      label: "Practice Minutes (7d)",
      kind: "diagnostic",
      unit: "minutes",
      value: input.currentWeek.practiceMinutes,
      explanation: buildExplanation({
        metricId: "week_minutes",
        whatThisMeans: "Total active study minutes across completed sessions in the current 7-day window.",
        current: input.currentWeek.practiceMinutes,
        previous: input.previousWeek.practiceMinutes,
        unit: "minutes",
      }),
    },
  ];

  if (input.includeHistoricalTrends) {
    metrics.push({
      id: "recency_accuracy",
      label: "Accuracy (last 200 attempts)",
      kind: "diagnostic",
      unit: "percent",
      value: input.recency200.accuracyPercent,
      explanation: buildExplanation({
        metricId: "recency_accuracy",
        whatThisMeans: "Rolling accuracy across the last 200 attempts.",
        current: input.recency200.accuracyPercent,
        previous: input.previousWeek.accuracyPercent,
        unit: "percent",
      }),
    });
    metrics.push({
      id: "recency_pace",
      label: "Average Seconds/Question (last 200 attempts)",
      kind: "diagnostic",
      unit: "seconds",
      value: input.recency200.avgSecondsPerQuestion,
      explanation: buildExplanation({
        metricId: "recency_pace",
        whatThisMeans: "Rolling average response time across the last 200 attempts.",
        current: input.recency200.avgSecondsPerQuestion,
        previous: input.previousWeek.avgSecondsPerQuestion,
        unit: "seconds",
      }),
    });
  }

  return metrics;
}

export async function buildStudentKpiViewFromCanonical(userId: string, includeHistoricalTrends: boolean): Promise<StudentKpiView> {
  const timezone = await resolveTimezone(userId);

  const { data: rollupRows, error: rollupError } = await supabaseServer
    .from("student_kpi_rollups_current")
    .select("source_family, total_questions, correct_questions, incorrect_questions, accuracy_pct, avg_latency_ms")
    .eq("student_id", userId);

  if (rollupError) {
    throw new Error(`Failed to fetch KPI rollups: ${rollupError.message}`);
  }

  const toNumber = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  };
  const rows = (rollupRows ?? []) as Array<{
    source_family: string | null;
    total_questions: number | string | null;
    correct_questions: number | string | null;
    incorrect_questions: number | string | null;
    accuracy_pct: number | string | null;
    avg_latency_ms: number | string | null;
  }>;

  type Totals = {
    questions: number;
    correct: number;
    latencyWeightedMs: number;
    latencyWeightQuestions: number;
  };
  const aggregateBySource = new Map<string, Totals>();
  const allTotals: Totals = {
    questions: 0,
    correct: 0,
    latencyWeightedMs: 0,
    latencyWeightQuestions: 0,
  };
  for (const row of rows) {
    const source = typeof row.source_family === "string" ? row.source_family.trim().toLowerCase() : "unknown";
    const questions = Math.max(0, Math.round(toNumber(row.total_questions)));
    const correct = Math.max(0, Math.round(toNumber(row.correct_questions)));
    const avgLatencyMs = Math.max(0, toNumber(row.avg_latency_ms));

    const bucket = aggregateBySource.get(source) ?? {
      questions: 0,
      correct: 0,
      latencyWeightedMs: 0,
      latencyWeightQuestions: 0,
    };
    bucket.questions += questions;
    bucket.correct += correct;
    bucket.latencyWeightedMs += avgLatencyMs * questions;
    bucket.latencyWeightQuestions += questions;
    aggregateBySource.set(source, bucket);

    allTotals.questions += questions;
    allTotals.correct += correct;
    allTotals.latencyWeightedMs += avgLatencyMs * questions;
    allTotals.latencyWeightQuestions += questions;

  }

  const practiceTotals = aggregateBySource.get("practice") ?? allTotals;
  const practiceAccuracy = practiceTotals.questions > 0
    ? Math.round((practiceTotals.correct / practiceTotals.questions) * 100)
    : 0;
  const practicePaceSeconds = practiceTotals.latencyWeightQuestions > 0
    ? Math.round((practiceTotals.latencyWeightedMs / practiceTotals.latencyWeightQuestions) / 1000)
    : 0;
  const allAccuracy = allTotals.questions > 0
    ? Math.round((allTotals.correct / allTotals.questions) * 100)
    : 0;
  const allPaceSeconds = allTotals.latencyWeightQuestions > 0
    ? Math.round((allTotals.latencyWeightedMs / allTotals.latencyWeightQuestions) / 1000)
    : 0;

  const currentWeek = {
    practiceSessions: 0,
    practiceMinutes: 0,
    questionsSolved: practiceTotals.questions,
    accuracyPercent: practiceAccuracy,
    avgSecondsPerQuestion: practicePaceSeconds,
  };

  const previousWeek = {
    practiceSessions: currentWeek.practiceSessions,
    practiceMinutes: currentWeek.practiceMinutes,
    questionsSolved: currentWeek.questionsSolved,
    accuracyPercent: currentWeek.accuracyPercent,
    avgSecondsPerQuestion: currentWeek.avgSecondsPerQuestion,
  };

  const recency = {
    totalAttempts: allTotals.questions,
    accuracyPercent: allAccuracy,
    avgSecondsPerQuestion: allPaceSeconds,
  };

  const metrics = buildStudentMetrics({
    currentWeek,
    previousWeek,
    recency200: recency,
    includeHistoricalTrends,
  });
  const weekMetrics = metrics.filter((m) => m.id.startsWith("week_"));
  const recencyMetrics = metrics.filter((m) => m.id.startsWith("recency_"));

  return {
    modelVersion: CANONICAL_RUNTIME_VIEW_VERSION,
    timezone,
    week: {
      practiceSessions: currentWeek.practiceSessions,
      questionsSolved: currentWeek.questionsSolved,
      accuracy: currentWeek.accuracyPercent,
      explanations: metricListToExplanationMap(weekMetrics),
    },
    recency: includeHistoricalTrends
      ? {
          window: 200,
          totalAttempts: recency.totalAttempts,
          accuracy: recency.accuracyPercent,
          avgSecondsPerQuestion: recency.avgSecondsPerQuestion,
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

export interface DomainBreakdown {
  domain: string;
  weight: number;
  rawMastery: number;
  decayedMastery: number;
  contribution: number;
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
  breakdown: {
    math: DomainBreakdown[];
    rw: DomainBreakdown[];
  };
}

type SectionProjectionRow = {
  section: string | null;
  projected_score_mid: number | null;
  projected_score_low: number | null;
  projected_score_high: number | null;
  relevant_question_count: number | null;
};

type DomainMasteryRow = {
  section: string | null;
  domain: string | null;
  mastery_pct: number | null;
  questions_total: number | null;
};

function normalizeSectionKey(value: unknown): "math" | "rw" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "math" || normalized === "m" || normalized === "mth") return "math";
  if (normalized === "rw" || normalized === "reading_writing" || normalized === "reading and writing") return "rw";
  return null;
}

function clampScore(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toDomainBreakdown(rows: DomainMasteryRow[], section: "math" | "rw"): DomainBreakdown[] {
  const filtered = rows.filter((row) => normalizeSectionKey(row.section) === section && typeof row.domain === "string" && row.domain.trim().length > 0);
  const totalWeight = filtered.reduce((sum, row) => sum + (typeof row.questions_total === "number" && row.questions_total > 0 ? row.questions_total : 0), 0);
  return filtered.map((row) => {
    const masteryPct = typeof row.mastery_pct === "number" ? clampScore(row.mastery_pct, 0, 100) : 0;
    const weightBase = typeof row.questions_total === "number" && row.questions_total > 0 ? row.questions_total : 0;
    const weight = totalWeight > 0 ? weightBase / totalWeight : 0;
    const decayedMastery = masteryPct / 100;
    return {
      domain: row.domain as string,
      weight,
      rawMastery: decayedMastery,
      decayedMastery,
      contribution: Number((weight * decayedMastery).toFixed(4)),
    };
  });
}

export async function buildScoreEstimateFromCanonical(userId: string): Promise<{
  estimate: ScoreEstimate;
  totalQuestionsAttempted: number;
  lastUpdated: string;
}> {
  const [{ data: projections, error: projectionError }, { data: domains, error: domainError }, { data: rollups, error: rollupError }] = await Promise.all([
    supabaseServer
      .from("student_section_projections")
      .select("section, projected_score_mid, projected_score_low, projected_score_high, relevant_question_count")
      .eq("student_id", userId),
    supabaseServer
      .from("student_domain_mastery")
      .select("section, domain, mastery_pct, questions_total")
      .eq("student_id", userId),
    supabaseServer
      .from("student_kpi_rollups_current")
      .select("total_questions")
      .eq("student_id", userId),
  ]);

  if (projectionError) {
    throw new Error(`Failed to fetch section projections: ${projectionError.message}`);
  }
  if (domainError) {
    throw new Error(`Failed to fetch domain mastery: ${domainError.message}`);
  }
  if (rollupError) {
    throw new Error(`Failed to fetch KPI rollups: ${rollupError.message}`);
  }

  const projectionRows = (projections ?? []) as SectionProjectionRow[];
  const domainRows = (domains ?? []) as DomainMasteryRow[];
  const totalQuestionsAttempted = (rollups ?? []).reduce((sum, row: any) => {
    const total = typeof row.total_questions === "number" ? row.total_questions : Number(row.total_questions ?? 0) || 0;
    return sum + Math.max(0, total);
  }, 0);

  const sectionMap = new Map<"math" | "rw", SectionProjectionRow>();
  for (const row of projectionRows) {
    const key = normalizeSectionKey(row.section);
    if (!key) continue;
    sectionMap.set(key, row);
  }

  const math = sectionMap.get("math");
  const rw = sectionMap.get("rw");
  const mathMid = typeof math?.projected_score_mid === "number" ? math.projected_score_mid : 200;
  const rwMid = typeof rw?.projected_score_mid === "number" ? rw.projected_score_mid : 200;
  const mathLow = typeof math?.projected_score_low === "number" ? math.projected_score_low : 200;
  const rwLow = typeof rw?.projected_score_low === "number" ? rw.projected_score_low : 200;
  const mathHigh = typeof math?.projected_score_high === "number" ? math.projected_score_high : 200;
  const rwHigh = typeof rw?.projected_score_high === "number" ? rw.projected_score_high : 200;
  const relevantCount = (math?.relevant_question_count ?? 0) + (rw?.relevant_question_count ?? 0);

  const estimate: ScoreEstimate = {
    composite: clampScore(Math.round(mathMid + rwMid), 400, 1600),
    math: clampScore(Math.round(mathMid), 200, 800),
    rw: clampScore(Math.round(rwMid), 200, 800),
    range: {
      low: clampScore(Math.round(mathLow + rwLow), 400, 1600),
      high: clampScore(Math.round(mathHigh + rwHigh), 400, 1600),
    },
    confidence: Math.max(0, Math.min(1, relevantCount / 120)),
    breakdown: {
      math: toDomainBreakdown(domainRows, "math"),
      rw: toDomainBreakdown(domainRows, "rw"),
    },
  };

  return {
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
