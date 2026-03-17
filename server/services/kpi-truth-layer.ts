import { DateTime } from "luxon";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { KPI_CALENDAR_COUNTED_EVENTS } from "../../apps/api/src/services/mastery-constants";

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
  event_type: string | null;
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
    .select("is_correct, time_spent_ms, event_type")
    .eq("user_id", userId)
    .gte("attempted_at", startUtc)
    .lte("attempted_at", endUtc);

  if (error) {
    throw new Error(`Failed to fetch attempts: ${error.message}`);
  }
  return ((data || []) as AttemptRow[]).filter((row) => isCanonicalKpiAttemptEventType(row.event_type));
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
    .select("is_correct, time_spent_ms, event_type")
    .eq("user_id", userId)
    .order("attempted_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Failed to fetch recency attempts: ${error.message}`);
  }
  return ((data || []) as AttemptRow[]).filter((row) => isCanonicalKpiAttemptEventType(row.event_type));
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
  const timezone = await resolveTimezone(userId);

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
    fetchAttemptRows(userId, currentWeekStartLocal.toUTC().toISO()!, currentWeekEndLocal.toUTC().toISO()!),
    fetchSessionRows(userId, currentWeekStartLocal.toUTC().toISO()!, currentWeekEndLocal.toUTC().toISO()!),
    fetchAttemptRows(userId, previousWeekStartLocal.toUTC().toISO()!, previousWeekEndLocal.toUTC().toISO()!),
    fetchSessionRows(userId, previousWeekStartLocal.toUTC().toISO()!, previousWeekEndLocal.toUTC().toISO()!),
    fetchRecencyRows(userId),
  ]);

  const recencySolved = recencyAttempts.length;
  const recencyCorrect = recencyAttempts.filter((a) => !!a.is_correct).length;
  const recencyTimeMs = recencyAttempts.reduce((sum, a) => sum + (a.time_spent_ms || 0), 0);

  return {
    modelVersion: KPI_TRUTH_LAYER_VERSION,
    timezone,
    generatedAt: new Date().toISOString(),
    currentWeek: buildWindowStats(currentWeekAttempts, currentWeekSessions),
    previousWeek: buildWindowStats(previousWeekAttempts, previousWeekSessions),
    recency200: {
      totalAttempts: recencySolved,
      accuracyPercent: toPercent(recencyCorrect, recencySolved),
      avgSecondsPerQuestion: toSeconds(recencyTimeMs, recencySolved),
    },
  };
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
