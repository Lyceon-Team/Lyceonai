import { Router, type Response } from "express";
import { DateTime } from "luxon";
import { supabaseServer } from "../lib/supabase-server";
import {
  type AuthenticatedRequest,
  type SupabaseUser,
  requireRequestAuthContext,
  requireRequestUser,
} from "../../../../server/middleware/supabase-auth";
import { resolvePaidKpiAccessForUser } from "../../../../server/services/kpi-access";
import {
  DEFAULT_HORIZON_DAYS,
  type DayStatus,
  type FullTestCadence,
  generateDeterministicPlan,
  resolvePlannerWindow,
  type SkillSignal,
  type StudyProfileSettings,
  type TaskType,
} from "../services/calendar-planner";
import { buildCalendarMonthView, isCalendarCountedEventType } from "../services/calendar-month-view";
export { isCalendarCountedEventType };

export const calendarRouter = Router();

const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_DAILY_MINUTES = 30;

type PlannerMode = "auto" | "custom";
type TaskStatus = "planned" | "in_progress" | "completed" | "skipped" | "missed";
type CalendarEventType = "plan_generated" | "day_edited" | "plan_refreshed" | "block_completed" | "override_applied";
type GenerationSource = "auto" | "user" | "refresh" | "regenerate" | "generate";

type StudyProfileRow = {
  user_id: string;
  baseline_score: number | null;
  target_score: number | null;
  exam_date: string | null;
  daily_minutes: number | null;
  timezone: string | null;
  planner_mode: PlannerMode | null;
  full_test_cadence: FullTestCadence | null;
  preferred_study_days: number[] | null;
  created_at?: string;
  updated_at?: string;
};

type PlanDayRow = {
  id: string;
  user_id: string;
  day_date: string;
  planned_minutes: number;
  completed_minutes: number;
  focus: unknown;
  tasks: unknown;
  plan_version: number;
  generated_at: string;
  is_user_override: boolean;
  status: DayStatus;
  generation_source: GenerationSource;
  is_exam_day: boolean;
  is_taper_day: boolean;
  is_full_test_day: boolean;
  required_task_count: number;
  completed_task_count: number;
  study_minutes_target: number;
  created_at?: string;
  updated_at?: string;
};

type PlanTaskRow = {
  id: string;
  day_id: string;
  user_id: string;
  day_date: string;
  ordinal: number;
  task_type: TaskType;
  section: "MATH" | "RW" | null;
  duration_minutes: number;
  source_skill_code: string | null;
  source_domain: string | null;
  source_subskill: string | null;
  source_reason: Record<string, unknown>;
  status: TaskStatus;
  is_user_override: boolean;
  planner_owned: boolean;
  metadata: Record<string, unknown>;
  completed_at: string | null;
};

type AttemptRow = {
  attempted_at: string | null;
  is_correct: boolean | null;
  time_spent_ms: number | null;
  section: string | null;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  question_canonical_id: string | null;
  event_type: string | null;
};

type SkillMasteryRow = {
  section: string | null;
  domain: string | null;
  skill: string | null;
  mastery_score: number | null;
  accuracy: number | null;
  last_attempt_at: string | null;
};

type CalendarProfileInput = {
  baseline_score?: unknown;
  target_score?: unknown;
  exam_date?: unknown;
  daily_minutes?: unknown;
  timezone?: unknown;
  planner_mode?: unknown;
  full_test_cadence?: unknown;
  preferred_study_days?: unknown;
};

type ProfileSummary = {
  timezone: string;
  examDate: string | null;
  dailyMinutes: number;
  plannerMode: PlannerMode;
  fullTestCadence: FullTestCadence;
  preferredStudyDays: number[];
};

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function asPlannerMode(value: unknown): PlannerMode {
  return value === "custom" ? "custom" : "auto";
}

function asFullTestCadence(value: unknown): FullTestCadence {
  if (value === "weekly" || value === "none") return value;
  return "biweekly";
}

function normalizePreferredStudyDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [1, 2, 3, 4, 5, 6, 7];
  const days = Array.from(
    new Set(
      value
        .map((item) => (typeof item === "number" ? Math.trunc(item) : Number.NaN))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 7),
    ),
  );
  return days.length > 0 ? days.sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7];
}

function normalizeSection(value: string | null | undefined): "MATH" | "RW" | null {
  const normalized = (value || "").toLowerCase().trim();
  if (!normalized) return null;
  if (normalized === "math" || normalized === "m" || normalized.includes("math")) return "MATH";
  if (normalized === "rw" || normalized.includes("reading") || normalized.includes("writing")) return "RW";
  return null;
}

function parseTaskStatus(value: unknown): TaskStatus {
  if (value === "completed" || value === "in_progress" || value === "skipped" || value === "missed") return value;
  return "planned";
}

function parseTaskStatusInput(value: unknown): TaskStatus | null {
  if (value === "planned" || value === "completed" || value === "in_progress" || value === "skipped" || value === "missed") {
    return value;
  }
  return null;
}

function legacyDayStatus(status: DayStatus): "planned" | "in_progress" | "complete" | "missed" {
  if (status === "completed") return "complete";
  if (status === "partially_completed") return "in_progress";
  return status;
}

function canonicalDayStatus(value: unknown): DayStatus {
  if (value === "completed" || value === "partially_completed" || value === "missed") return value;
  if (value === "complete") return "completed";
  if (value === "in_progress") return "partially_completed";
  return "planned";
}

function computeDayStatusFromTasks(dayDate: string, todayDate: string, tasks: PlanTaskRow[]): {
  status: DayStatus;
  requiredTaskCount: number;
  completedTaskCount: number;
} {
  const requiredTasks = tasks.filter((task) => task.metadata?.required !== false);
  const requiredTaskCount = requiredTasks.length;
  const completedTaskCount = requiredTasks.filter((task) => task.status === "completed").length;
  const inProgressTaskCount = requiredTasks.filter((task) => task.status === "in_progress").length;

  if (requiredTaskCount === 0) return { status: "planned", requiredTaskCount, completedTaskCount };
  if (completedTaskCount >= requiredTaskCount) return { status: "completed", requiredTaskCount, completedTaskCount };
  if (completedTaskCount > 0 || inProgressTaskCount > 0) return { status: "partially_completed", requiredTaskCount, completedTaskCount };
  if (dayDate < todayDate) return { status: "missed", requiredTaskCount, completedTaskCount };
  return { status: "planned", requiredTaskCount, completedTaskCount };
}

async function emitCalendarEvent(args: { eventType: CalendarEventType; userId: string; details?: Record<string, unknown> }): Promise<void> {
  try {
    await supabaseServer.from("system_event_logs").insert({
      event_type: args.eventType,
      level: "info",
      source: "calendar_planner",
      message: args.eventType,
      user_id: args.userId,
      details: args.details ?? null,
    });
  } catch {
    // best effort only
  }
}

async function ensurePremiumAccess(
  user: SupabaseUser,
  res: Response,
  requestId: string | undefined,
  feature: string,
): Promise<{ plan: string; status: string; reason: string; currentPeriodEnd: string | null } | null> {
  const access = await resolvePaidKpiAccessForUser(user.id, user.role);
  if (!access.hasPaidAccess) {
    res.status(402).json({
      error: "Calendar planner requires active entitlement",
      code: "CALENDAR_PREMIUM_REQUIRED",
      feature,
      reason: access.reason,
      entitlement: {
        plan: access.plan,
        status: access.status,
        currentPeriodEnd: access.currentPeriodEnd,
      },
      requestId,
    });
    return null;
  }

  return {
    plan: access.plan,
    status: access.status,
    reason: access.reason,
    currentPeriodEnd: access.currentPeriodEnd,
  };
}

async function loadProfile(userId: string): Promise<StudyProfileRow | null> {
  const { data, error } = await supabaseServer
    .from("student_study_profile")
    .select("user_id, baseline_score, target_score, exam_date, daily_minutes, timezone, planner_mode, full_test_cadence, preferred_study_days, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load study profile: ${error.message}`);
  return (data as StudyProfileRow | null) ?? null;
}

async function loadDaysByRange(userId: string, start: string, end: string): Promise<PlanDayRow[]> {
  const { data, error } = await supabaseServer
    .from("student_study_plan_days")
    .select("id, user_id, day_date, planned_minutes, completed_minutes, focus, tasks, plan_version, generated_at, is_user_override, status, generation_source, is_exam_day, is_taper_day, is_full_test_day, required_task_count, completed_task_count, study_minutes_target, created_at, updated_at")
    .eq("user_id", userId)
    .gte("day_date", start)
    .lte("day_date", end)
    .order("day_date", { ascending: true });
  if (error) throw new Error(`Failed to load plan days: ${error.message}`);
  return ((data as PlanDayRow[] | null) ?? []).map((row) => ({
    ...row,
    status: canonicalDayStatus(row.status),
  }));
}

async function loadTasksByRange(userId: string, start: string, end: string): Promise<PlanTaskRow[]> {
  const { data, error } = await supabaseServer
    .from("student_study_plan_tasks")
    .select("id, day_id, user_id, day_date, ordinal, task_type, section, duration_minutes, source_skill_code, source_domain, source_subskill, source_reason, status, is_user_override, planner_owned, metadata, completed_at")
    .eq("user_id", userId)
    .gte("day_date", start)
    .lte("day_date", end)
    .order("day_date", { ascending: true })
    .order("ordinal", { ascending: true });
  if (error) throw new Error(`Failed to load plan tasks: ${error.message}`);
  return ((data as PlanTaskRow[] | null) ?? []).map((row) => ({
    ...row,
    status: parseTaskStatus(row.status),
    source_reason: typeof row.source_reason === "object" && row.source_reason ? row.source_reason : {},
    metadata: typeof row.metadata === "object" && row.metadata ? row.metadata : {},
  }));
}

async function loadAttemptsByRange(userId: string, startUtc: string, endUtc: string): Promise<AttemptRow[]> {
  const { data, error } = await supabaseServer
    .from("student_question_attempts")
    .select("attempted_at, is_correct, time_spent_ms, section, domain, skill, subskill, question_canonical_id, event_type")
    .eq("user_id", userId)
    .gte("attempted_at", startUtc)
    .lte("attempted_at", endUtc)
    .order("attempted_at", { ascending: false });
  if (error) throw new Error(`Failed to load attempts: ${error.message}`);
  return (data as AttemptRow[] | null) ?? [];
}

async function loadSkillSignals(userId: string): Promise<SkillSignal[]> {
  const { data, error } = await supabaseServer
    .from("skill_mastery")
    .select("section, domain, skill, mastery_score, accuracy, last_attempt_at")
    .eq("student_id", userId)
    .order("updated_at", { ascending: false })
    .limit(400);

  if (error || !data) return [];

  const skillSignals: SkillSignal[] = [];
  for (const row of data as SkillMasteryRow[]) {
    const section = normalizeSection(row.section);
    if (!section || !row.skill) continue;
    skillSignals.push({
      section,
      skillCode: row.skill,
      domain: row.domain ?? "general",
      subskill: null,
      masteryScore: typeof row.mastery_score === "number" ? row.mastery_score : 0.5,
      accuracy: typeof row.accuracy === "number" ? row.accuracy : 0.5,
      lastAttemptDate: row.last_attempt_at ? DateTime.fromISO(row.last_attempt_at).toISODate() : null,
    });
  }

  return skillSignals;
}

function profileSummaryFromRow(userId: string, row: StudyProfileRow | null): ProfileSummary & { userId: string } {
  return {
    userId,
    timezone: row?.timezone || DEFAULT_TIMEZONE,
    examDate: row?.exam_date || null,
    dailyMinutes: Math.max(10, Math.min(240, row?.daily_minutes ?? DEFAULT_DAILY_MINUTES)),
    plannerMode: asPlannerMode(row?.planner_mode),
    fullTestCadence: asFullTestCadence(row?.full_test_cadence),
    preferredStudyDays: normalizePreferredStudyDays(row?.preferred_study_days),
  };
}

function ensureIsoDateInput(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (!isIsoDate(value)) return null;
  return value;
}

function taskTypeToLegacy(taskType: TaskType): string {
  if (taskType === "math_practice") return "practice";
  if (taskType === "rw_practice") return "practice";
  if (taskType === "review_errors") return "review";
  return "full_test";
}

function taskSectionToLegacy(section: "MATH" | "RW" | null): string | null {
  if (section === "MATH") return "Math";
  if (section === "RW") return "Reading & Writing";
  return null;
}

function taskModeForDay(task: PlanTaskRow): string {
  if (task.task_type === "full_length_exam") return "full-length";
  if (task.task_type === "review_errors") return "review";
  return task.metadata?.compressed ? "compressed" : "mixed";
}

function planTaskToLegacy(task: PlanTaskRow): Record<string, unknown> {
  return {
    id: task.id,
    type: taskTypeToLegacy(task.task_type),
    section: taskSectionToLegacy(task.section),
    mode: taskModeForDay(task),
    minutes: task.duration_minutes,
    task_type: task.task_type,
    status: task.status,
    ordinal: task.ordinal,
    is_user_override: task.is_user_override,
    planner_owned: task.planner_owned,
  };
}

async function calculateStreak(userId: string, timezone: string): Promise<{ current: number; longest: number }> {
  const today = DateTime.now().setZone(timezone).toISODate();
  if (!today) return { current: 0, longest: 0 };

  const { data, error } = await supabaseServer
    .from("student_study_plan_days")
    .select("day_date, status")
    .eq("user_id", userId)
    .order("day_date", { ascending: true })
    .limit(365);
  if (error || !data) return { current: 0, longest: 0 };

  const completedDates = (data as Array<{ day_date: string; status: unknown }>)
    .filter((row) => canonicalDayStatus(row.status) === "completed")
    .map((row) => row.day_date);
  if (completedDates.length === 0) return { current: 0, longest: 0 };

  const completedSet = new Set(completedDates);
  let current = 0;
  let cursor = DateTime.fromISO(today, { zone: timezone });
  while (completedSet.has(cursor.toISODate()!)) {
    current += 1;
    cursor = cursor.minus({ days: 1 });
  }

  let longest = 0;
  let run = 0;
  let previous: DateTime | null = null;
  for (const dayDate of completedDates) {
    const day = DateTime.fromISO(dayDate, { zone: timezone });
    if (!previous) {
      run = 1;
    } else if (day.toISODate() === previous.plus({ days: 1 }).toISODate()) {
      run += 1;
    } else {
      longest = Math.max(longest, run);
      run = 1;
    }
    previous = day;
  }
  longest = Math.max(longest, run);
  return { current, longest };
}

function parseProfilePayload(payload: CalendarProfileInput): {
  baseline_score?: number | null;
  target_score?: number | null;
  exam_date?: string | null;
  daily_minutes?: number;
  timezone?: string;
  planner_mode?: PlannerMode;
  full_test_cadence?: FullTestCadence;
  preferred_study_days?: number[];
} {
  const normalized: Record<string, unknown> = {};

  if (payload.baseline_score !== undefined) {
    normalized.baseline_score = payload.baseline_score == null ? null : Number(payload.baseline_score);
  }
  if (payload.target_score !== undefined) {
    normalized.target_score = payload.target_score == null ? null : Number(payload.target_score);
  }
  if (payload.exam_date !== undefined) {
    normalized.exam_date = payload.exam_date == null || payload.exam_date === "" ? null : ensureIsoDateInput(payload.exam_date);
  }
  if (payload.daily_minutes !== undefined) {
    const value = Number(payload.daily_minutes);
    if (Number.isFinite(value)) normalized.daily_minutes = Math.max(10, Math.min(240, Math.round(value)));
  }
  if (payload.timezone !== undefined && typeof payload.timezone === "string" && payload.timezone.trim()) {
    normalized.timezone = payload.timezone.trim();
  }
  if (payload.planner_mode !== undefined) {
    normalized.planner_mode = asPlannerMode(payload.planner_mode);
  }
  if (payload.full_test_cadence !== undefined) {
    normalized.full_test_cadence = asFullTestCadence(payload.full_test_cadence);
  }
  if (payload.preferred_study_days !== undefined) {
    normalized.preferred_study_days = normalizePreferredStudyDays(payload.preferred_study_days);
  }

  return normalized as {
    baseline_score?: number | null;
    target_score?: number | null;
    exam_date?: string | null;
    daily_minutes?: number;
    timezone?: string;
    planner_mode?: PlannerMode;
    full_test_cadence?: FullTestCadence;
    preferred_study_days?: number[];
  };
}

async function persistGeneratedDays(params: {
  userId: string;
  timezone: string;
  todayDate: string;
  existingDays: PlanDayRow[];
  generatedDays: ReturnType<typeof generateDeterministicPlan>["plannedDays"];
  source: GenerationSource;
  skipOverrides: boolean;
}): Promise<{ upsertedDays: number; upsertedTasks: number; skippedOverrideDays: string[] }> {
  const existingByDate = new Map(params.existingDays.map((day) => [day.day_date, day]));
  const skippedOverrideDays: string[] = [];
  let upsertedDays = 0;
  let upsertedTasks = 0;

  for (const day of params.generatedDays) {
    if (day.dayDate < params.todayDate) continue;
    const existing = existingByDate.get(day.dayDate);
    if (params.skipOverrides && existing?.is_user_override) {
      skippedOverrideDays.push(day.dayDate);
      continue;
    }

    const generatedTaskRows = day.tasks.map((task, index) => {
      const metadata: Record<string, unknown> = {
        ...(task.metadata ?? {}),
        required: task.required,
      };
      return {
        day_id: existing?.id ?? "",
        user_id: params.userId,
        day_date: day.dayDate,
        ordinal: index + 1,
        task_type: task.taskType,
        section: task.section,
        duration_minutes: task.durationMinutes,
        source_skill_code: task.sourceSkillCode,
        source_domain: task.sourceDomain,
        source_subskill: task.sourceSubskill,
        source_reason: task.sourceReason,
        status: "planned" as const,
        is_user_override: false,
        planner_owned: true,
        metadata,
        completed_at: null,
      };
    });

    const dayRowPayload = {
      user_id: params.userId,
      day_date: day.dayDate,
      planned_minutes: day.plannedMinutes,
      completed_minutes: existing?.completed_minutes ?? 0,
      focus: day.focus.map((focus) => ({
        section: focus.section === "MATH" ? "Math" : "Reading & Writing",
        weight: focus.weight,
        competencies: focus.skill_codes,
      })),
      tasks: generatedTaskRows.map((task) => ({
        type: taskTypeToLegacy(task.task_type),
        section: taskSectionToLegacy(task.section),
        mode: Boolean((task.metadata as Record<string, unknown>).compressed) ? "compressed" : task.task_type === "review_errors" ? "review" : "mixed",
        minutes: task.duration_minutes,
      })),
      plan_version: (existing?.plan_version ?? 0) + 1,
      generated_at: DateTime.now().toUTC().toISO(),
      is_user_override: false,
      status: "planned" as DayStatus,
      generation_source: params.source,
      is_exam_day: day.isExamDay,
      is_taper_day: day.isTaperDay,
      is_full_test_day: day.isFullTestDay,
      required_task_count: generatedTaskRows.filter((task) => task.metadata.required !== false).length,
      completed_task_count: 0,
      study_minutes_target: day.studyMinutesTarget,
    };

    const { data: upsertedDay, error: upsertDayError } = await supabaseServer
      .from("student_study_plan_days")
      .upsert(dayRowPayload, { onConflict: "user_id,day_date" })
      .select("id")
      .single();

    if (upsertDayError || !upsertedDay?.id) {
      throw new Error(`Failed to persist study day ${day.dayDate}: ${upsertDayError?.message ?? "missing id"}`);
    }
    upsertedDays += 1;

    const { error: deleteError } = await supabaseServer
      .from("student_study_plan_tasks")
      .delete()
      .eq("user_id", params.userId)
      .eq("day_date", day.dayDate);
    if (deleteError) {
      throw new Error(`Failed to clear tasks for ${day.dayDate}: ${deleteError.message}`);
    }

    if (generatedTaskRows.length > 0) {
      const { error: insertTaskError } = await supabaseServer.from("student_study_plan_tasks").insert(
        generatedTaskRows.map((task) => ({
          ...task,
          day_id: upsertedDay.id,
        })),
      );
      if (insertTaskError) {
        throw new Error(`Failed to persist tasks for ${day.dayDate}: ${insertTaskError.message}`);
      }
      upsertedTasks += generatedTaskRows.length;
    }
  }

  return { upsertedDays, upsertedTasks, skippedOverrideDays };
}

function plannerSettingsFromProfile(userId: string, profile: StudyProfileRow | null): StudyProfileSettings {
  const settings = profileSummaryFromRow(userId, profile);
  return {
    userId,
    timezone: settings.timezone,
    dailyMinutes: settings.dailyMinutes,
    examDate: settings.examDate,
    fullTestCadence: settings.fullTestCadence,
    preferredStudyDays: settings.preferredStudyDays,
  };
}

async function generatePlanForWindow(params: {
  userId: string;
  profile: StudyProfileRow | null;
  todayDate: string;
  startDate: string;
  endDate: string;
  skipOverrideDays: boolean;
}) {
  const settings = plannerSettingsFromProfile(params.userId, params.profile);
  const startUtc = DateTime.fromISO(params.startDate, { zone: settings.timezone }).startOf("day").minus({ days: 40 }).toUTC().toISO()!;
  const endUtc = DateTime.fromISO(params.endDate, { zone: settings.timezone }).endOf("day").toUTC().toISO()!;
  const [existingDays, existingTasks, attempts, skillSignals, recentCompletedTests] = await Promise.all([
    loadDaysByRange(params.userId, params.startDate, params.endDate),
    loadTasksByRange(params.userId, DateTime.fromISO(params.startDate).minus({ days: 6 }).toISODate()!, params.endDate),
    loadAttemptsByRange(params.userId, startUtc, endUtc),
    loadSkillSignals(params.userId),
    supabaseServer
      .from("student_study_plan_tasks")
      .select("day_date")
      .eq("user_id", params.userId)
      .eq("task_type", "full_length_exam")
      .eq("status", "completed")
      .gte("day_date", DateTime.fromISO(params.startDate).minus({ days: 30 }).toISODate()!)
      .order("day_date", { ascending: false })
      .limit(20),
  ]);

  const recentCompletedTestDays = ((recentCompletedTests.data as Array<{ day_date: string }> | null) ?? []).map((row) => row.day_date);

  const plan = generateDeterministicPlan({
    profile: settings,
    todayDate: params.todayDate,
    startDate: params.startDate,
    endDate: params.endDate,
    attempts: attempts.map((attempt) => ({
      attemptedAt: attempt.attempted_at || DateTime.fromISO(params.todayDate).toUTC().toISO()!,
      section: normalizeSection(attempt.section),
      skillCode: attempt.skill || null,
      questionCanonicalId: attempt.question_canonical_id || null,
      isCorrect: Boolean(attempt.is_correct),
      eventType: attempt.event_type || null,
      timeSpentMs: Math.max(0, attempt.time_spent_ms || 0),
    })),
    skillSignals,
    existingDays: existingDays.map((day) => ({
      dayDate: day.day_date,
      isUserOverride: day.is_user_override,
      status: day.status,
      isFullTestDay: day.is_full_test_day,
    })),
    existingTasks: existingTasks.map((task) => ({
      dayDate: task.day_date,
      taskType: task.task_type,
      section: task.section,
      durationMinutes: task.duration_minutes,
      sourceSkillCode: task.source_skill_code,
    })),
    recentCompletedTestDays,
    skipOverrideDays: params.skipOverrideDays,
  });

  return { settings, plan, existingDays };
}

function parseDateWindow(req: AuthenticatedRequest, timezone: string): { startDate: string; requestedDays: number } | null {
  const todayDate = DateTime.now().setZone(timezone).toISODate();
  if (!todayDate) return null;

  const startInput = typeof req.body?.start_date === "string" ? req.body.start_date : typeof req.query.start === "string" ? req.query.start : todayDate;
  const requestedDaysRaw = Number(req.body?.days ?? req.query.days ?? DEFAULT_HORIZON_DAYS);
  const requestedDays = Number.isFinite(requestedDaysRaw) ? Math.max(1, Math.min(DEFAULT_HORIZON_DAYS, Math.round(requestedDaysRaw))) : DEFAULT_HORIZON_DAYS;

  if (!isIsoDate(startInput)) return null;
  return { startDate: startInput, requestedDays };
}

export const getMonthPayload = buildCalendarMonthView;

calendarRouter.get("/profile", async (req: AuthenticatedRequest, res: Response) => {
  const auth = requireRequestAuthContext(req, res);
  if (!auth) return;

  const user = auth.user;
  const premium = await ensurePremiumAccess(user, res, req.requestId, "profile_read");
  if (!premium) return;

  try {
    const profile = await loadProfile(user.id);
    return res.json({
      profile,
      entitlement: premium,
      requestId: req.requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load profile";
    return res.status(500).json({ error: message, requestId: req.requestId });
  }
});

calendarRouter.put("/profile", async (req: AuthenticatedRequest, res: Response) => {
  const auth = requireRequestAuthContext(req, res);
  if (!auth) return;
  const user = auth.user;
  const premium = await ensurePremiumAccess(user, res, req.requestId, "profile_write");
  if (!premium) return;

  try {
    const payload = parseProfilePayload((req.body ?? {}) as CalendarProfileInput);
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "No profile fields provided", requestId: req.requestId });
    }

    const upsertPayload = {
      user_id: user.id,
      ...payload,
      updated_at: DateTime.now().toUTC().toISO(),
    };

    const { data, error } = await supabaseServer
      .from("student_study_profile")
      .upsert(upsertPayload, { onConflict: "user_id" })
      .select("user_id, baseline_score, target_score, exam_date, daily_minutes, timezone, planner_mode, full_test_cadence, preferred_study_days, created_at, updated_at")
      .single();

    if (error) {
      return res.status(500).json({ error: `Failed to save profile: ${error.message}`, requestId: req.requestId });
    }

    return res.json({
      profile: data,
      entitlement: premium,
      requestId: req.requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save profile";
    return res.status(500).json({ error: message, requestId: req.requestId });
  }
});

calendarRouter.get("/month", async (req: AuthenticatedRequest, res: Response) => {
  const auth = requireRequestAuthContext(req, res);
  if (!auth) return;

  const user = auth.user;
  const premium = await ensurePremiumAccess(user, res, req.requestId, "month_read");
  if (!premium) return;

  const start = req.query.start as string | undefined;
  const end = req.query.end as string | undefined;
  if (!start || !isIsoDate(start)) {
    return res.status(400).json({ error: "start query param must be YYYY-MM-DD", requestId: req.requestId });
  }
  if (!end || !isIsoDate(end)) {
    return res.status(400).json({ error: "end query param must be YYYY-MM-DD", requestId: req.requestId });
  }

  try {
    const profile = await loadProfile(user.id);
    const settings = profileSummaryFromRow(user.id, profile);
    const payload = await getMonthPayload(user.id, start, end, settings.timezone);
    return res.json({
      ...payload,
      profile: {
        exam_date: settings.examDate,
        timezone: settings.timezone,
        planner_mode: settings.plannerMode,
        full_test_cadence: settings.fullTestCadence,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load month";
    return res.status(500).json({ error: message, requestId: req.requestId });
  }
});

calendarRouter.post("/generate", async (req: AuthenticatedRequest, res: Response) => {
  const auth = requireRequestAuthContext(req, res);
  if (!auth) return;
  const user = auth.user;
  const premium = await ensurePremiumAccess(user, res, req.requestId, "generate");
  if (!premium) return;

  try {
    const profile = await loadProfile(user.id);
    const settings = profileSummaryFromRow(user.id, profile);
    const windowInput = parseDateWindow(req, settings.timezone);
    if (!windowInput) {
      return res.status(400).json({ error: "Invalid date window", requestId: req.requestId });
    }

    const todayDate = DateTime.now().setZone(settings.timezone).toISODate()!;
    const window = resolvePlannerWindow({
      startDate: windowInput.startDate,
      todayDate,
      examDate: settings.examDate,
      requestedDays: windowInput.requestedDays,
    });

    const generated = await generatePlanForWindow({
      userId: user.id,
      profile,
      todayDate,
      startDate: window.startDate,
      endDate: window.endDate,
      skipOverrideDays: true,
    });

    const persisted = await persistGeneratedDays({
      userId: user.id,
      timezone: settings.timezone,
      todayDate,
      existingDays: generated.existingDays,
      generatedDays: generated.plan.plannedDays,
      source: "generate",
      skipOverrides: true,
    });
    const skippedOverrideDays = Array.from(new Set([...generated.plan.skippedOverrideDays, ...persisted.skippedOverrideDays]));

    await emitCalendarEvent({
      eventType: "plan_generated",
      userId: user.id,
      details: {
        start_date: window.startDate,
        end_date: window.endDate,
        horizon_days: window.horizonDays,
        upserted_days: persisted.upsertedDays,
        skipped_override_days: skippedOverrideDays,
      },
    });

    return res.json({
      generated: {
        start_date: window.startDate,
        end_date: window.endDate,
        horizon_days: window.horizonDays,
        upserted_days: persisted.upsertedDays,
        upserted_tasks: persisted.upsertedTasks,
        skipped_override_days: skippedOverrideDays,
      },
      entitlement: premium,
      requestId: req.requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate plan";
    return res.status(500).json({ error: message, requestId: req.requestId });
  }
});

calendarRouter.post("/refresh/auto", async (req: AuthenticatedRequest, res: Response) => {
  const auth = requireRequestAuthContext(req, res);
  if (!auth) return;
  const user = auth.user;
  const premium = await ensurePremiumAccess(user, res, req.requestId, "refresh");
  if (!premium) return;

  try {
    const profile = await loadProfile(user.id);
    const settings = profileSummaryFromRow(user.id, profile);
    const windowInput = parseDateWindow(req, settings.timezone);
    if (!windowInput) {
      return res.status(400).json({ error: "Invalid date window", requestId: req.requestId });
    }

    if (settings.plannerMode === "custom") {
      await emitCalendarEvent({
        eventType: "plan_refreshed",
        userId: user.id,
        details: {
          applied: false,
          planner_mode: "custom",
          reason: "custom_mode",
        },
      });

      return res.json({
        applied: false,
        planner_mode: "custom",
        suggestions: [
          {
            type: "catch_up_block",
            message: "Custom mode is active. Use regenerate or reset a day to apply new recommendations.",
          },
        ],
        requestId: req.requestId,
      });
    }

    const todayDate = DateTime.now().setZone(settings.timezone).toISODate()!;
    const window = resolvePlannerWindow({
      startDate: windowInput.startDate,
      todayDate,
      examDate: settings.examDate,
      requestedDays: windowInput.requestedDays,
    });

    const generated = await generatePlanForWindow({
      userId: user.id,
      profile,
      todayDate,
      startDate: window.startDate,
      endDate: window.endDate,
      skipOverrideDays: true,
    });

    const persisted = await persistGeneratedDays({
      userId: user.id,
      timezone: settings.timezone,
      todayDate,
      existingDays: generated.existingDays,
      generatedDays: generated.plan.plannedDays,
      source: "refresh",
      skipOverrides: true,
    });
    const skippedOverrideDays = Array.from(new Set([...generated.plan.skippedOverrideDays, ...persisted.skippedOverrideDays]));

    await emitCalendarEvent({
      eventType: "plan_refreshed",
      userId: user.id,
      details: {
        applied: true,
        planner_mode: "auto",
        start_date: window.startDate,
        end_date: window.endDate,
        refreshed_days: persisted.upsertedDays,
        skipped_override_days: skippedOverrideDays,
      },
    });

    return res.json({
      applied: true,
      planner_mode: "auto",
      refreshed: {
        start_date: window.startDate,
        end_date: window.endDate,
        upserted_days: persisted.upsertedDays,
        upserted_tasks: persisted.upsertedTasks,
        skipped_override_days: skippedOverrideDays,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh plan";
    return res.status(500).json({ error: message, requestId: req.requestId });
  }
});

calendarRouter.post("/regenerate", async (req: AuthenticatedRequest, res: Response) => {
  const auth = requireRequestAuthContext(req, res);
  if (!auth) return;
  const user = auth.user;
  const premium = await ensurePremiumAccess(user, res, req.requestId, "regenerate");
  if (!premium) return;

  try {
    const profile = await loadProfile(user.id);
    const settings = profileSummaryFromRow(user.id, profile);
    const windowInput = parseDateWindow(req, settings.timezone);
    if (!windowInput) {
      return res.status(400).json({ error: "Invalid date window", requestId: req.requestId });
    }

    const todayDate = DateTime.now().setZone(settings.timezone).toISODate()!;
    const window = resolvePlannerWindow({
      startDate: windowInput.startDate,
      todayDate,
      examDate: settings.examDate,
      requestedDays: windowInput.requestedDays,
    });

    const generated = await generatePlanForWindow({
      userId: user.id,
      profile,
      todayDate,
      startDate: window.startDate,
      endDate: window.endDate,
      skipOverrideDays: false,
    });

    const persisted = await persistGeneratedDays({
      userId: user.id,
      timezone: settings.timezone,
      todayDate,
      existingDays: generated.existingDays,
      generatedDays: generated.plan.plannedDays,
      source: "regenerate",
      skipOverrides: false,
    });

    await emitCalendarEvent({
      eventType: "plan_generated",
      userId: user.id,
      details: {
        mode: "regenerate",
        start_date: window.startDate,
        end_date: window.endDate,
        upserted_days: persisted.upsertedDays,
      },
    });

    return res.json({
      regenerated: {
        start_date: window.startDate,
        end_date: window.endDate,
        upserted_days: persisted.upsertedDays,
        upserted_tasks: persisted.upsertedTasks,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to regenerate plan";
    return res.status(500).json({ error: message, requestId: req.requestId });
  }
});

calendarRouter.post("/day/:dayDate/regenerate", async (req: AuthenticatedRequest, res: Response) => {
  const auth = requireRequestAuthContext(req, res);
  if (!auth) return;
  const user = auth.user;
  const premium = await ensurePremiumAccess(user, res, req.requestId, "day_regenerate");
  if (!premium) return;

  const { dayDate } = req.params;
  if (!isIsoDate(dayDate)) {
    return res.status(400).json({ error: "dayDate must be YYYY-MM-DD", requestId: req.requestId });
  }

  try {
    const profile = await loadProfile(user.id);
    const settings = profileSummaryFromRow(user.id, profile);
    const todayDate = DateTime.now().setZone(settings.timezone).toISODate()!;
    if (dayDate < todayDate) {
      return res.status(409).json({ error: "Past days are immutable", code: "PAST_DAY_IMMUTABLE", requestId: req.requestId });
    }

    const generated = await generatePlanForWindow({
      userId: user.id,
      profile,
      todayDate,
      startDate: dayDate,
      endDate: dayDate,
      skipOverrideDays: false,
    });

    const persisted = await persistGeneratedDays({
      userId: user.id,
      timezone: settings.timezone,
      todayDate,
      existingDays: generated.existingDays,
      generatedDays: generated.plan.plannedDays,
      source: "regenerate",
      skipOverrides: false,
    });

    const payload = await getMonthPayload(user.id, dayDate, dayDate, settings.timezone);
    return res.json({
      day: payload.days[0] ?? null,
      regenerated: {
        upserted_days: persisted.upsertedDays,
        upserted_tasks: persisted.upsertedTasks,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to regenerate day";
    return res.status(500).json({ error: message, requestId: req.requestId });
  }
});

calendarRouter.post("/day/:dayDate/reset-to-auto", async (req: AuthenticatedRequest, res: Response) => {
  const auth = requireRequestAuthContext(req, res);
  if (!auth) return;
  const user = auth.user;
  const premium = await ensurePremiumAccess(user, res, req.requestId, "day_reset_auto");
  if (!premium) return;

  const { dayDate } = req.params;
  if (!isIsoDate(dayDate)) {
    return res.status(400).json({ error: "dayDate must be YYYY-MM-DD", requestId: req.requestId });
  }

  try {
    const profile = await loadProfile(user.id);
    const settings = profileSummaryFromRow(user.id, profile);
    const todayDate = DateTime.now().setZone(settings.timezone).toISODate()!;
    if (dayDate < todayDate) {
      return res.status(409).json({ error: "Past days are immutable", code: "PAST_DAY_IMMUTABLE", requestId: req.requestId });
    }

    const existing = (await loadDaysByRange(user.id, dayDate, dayDate))[0] ?? null;
    if (!existing) {
      return res.status(404).json({ error: "Day not found", code: "DAY_NOT_FOUND", requestId: req.requestId });
    }
    if (!existing.is_user_override) {
      return res.status(409).json({ error: "Day is not user override", code: "DAY_NOT_OVERRIDDEN", requestId: req.requestId });
    }

    const generated = await generatePlanForWindow({
      userId: user.id,
      profile,
      todayDate,
      startDate: dayDate,
      endDate: dayDate,
      skipOverrideDays: false,
    });

    const persisted = await persistGeneratedDays({
      userId: user.id,
      timezone: settings.timezone,
      todayDate,
      existingDays: generated.existingDays,
      generatedDays: generated.plan.plannedDays,
      source: "refresh",
      skipOverrides: false,
    });

    const payload = await getMonthPayload(user.id, dayDate, dayDate, settings.timezone);
    return res.json({
      day: payload.days[0] ?? null,
      reset: {
        upserted_days: persisted.upsertedDays,
        upserted_tasks: persisted.upsertedTasks,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset day";
    return res.status(500).json({ error: message, requestId: req.requestId });
  }
});

calendarRouter.put("/day/:dayDate", async (req: AuthenticatedRequest, res: Response) => {
  const user = requireRequestUser(req, res);
  if (!user) return;
  const premium = await ensurePremiumAccess(user, res, req.requestId, "day_edit");
  if (!premium) return;

  const { dayDate } = req.params;
  if (!isIsoDate(dayDate)) {
    return res.status(400).json({ error: "dayDate must be YYYY-MM-DD", requestId: req.requestId });
  }

  try {
    const profile = await loadProfile(user.id);
    const settings = profileSummaryFromRow(user.id, profile);
    const todayDate = DateTime.now().setZone(settings.timezone).toISODate()!;
    if (dayDate < todayDate) {
      return res.status(409).json({ error: "Past days are immutable", code: "PAST_DAY_IMMUTABLE", requestId: req.requestId });
    }

    const existing = (await loadDaysByRange(user.id, dayDate, dayDate))[0] ?? null;
    const incomingTasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    const incomingFocus = Array.isArray(req.body?.focus) ? req.body.focus : [];
    const plannedMinutesInput = Number(req.body?.planned_minutes);
    const plannedMinutes = Number.isFinite(plannedMinutesInput)
      ? Math.max(0, Math.round(plannedMinutesInput))
      : incomingTasks.reduce((sum: number, task: any) => sum + Math.max(0, Number(task?.minutes ?? 0)), 0);

    const dayPayload = {
      user_id: user.id,
      day_date: dayDate,
      planned_minutes: plannedMinutes,
      completed_minutes: existing?.completed_minutes ?? 0,
      focus: incomingFocus,
      tasks: incomingTasks,
      plan_version: (existing?.plan_version ?? 0) + 1,
      generated_at: DateTime.now().toUTC().toISO(),
      is_user_override: true,
      status: canonicalDayStatus(existing?.status),
      generation_source: "user" as GenerationSource,
      is_exam_day: Boolean(existing?.is_exam_day),
      is_taper_day: Boolean(existing?.is_taper_day),
      is_full_test_day: Boolean(existing?.is_full_test_day),
      required_task_count: incomingTasks.length,
      completed_task_count: incomingTasks.filter((task: any) => task?.status === "completed").length,
      study_minutes_target: plannedMinutes,
    };

    const { data: dayRow, error: dayError } = await supabaseServer
      .from("student_study_plan_days")
      .upsert(dayPayload, { onConflict: "user_id,day_date" })
      .select("id")
      .single();
    if (dayError || !dayRow?.id) {
      return res.status(500).json({ error: `Failed to save day: ${dayError?.message ?? "missing day id"}`, requestId: req.requestId });
    }

    const { error: deleteError } = await supabaseServer
      .from("student_study_plan_tasks")
      .delete()
      .eq("user_id", user.id)
      .eq("day_date", dayDate);
    if (deleteError) {
      return res.status(500).json({ error: `Failed to replace day tasks: ${deleteError.message}`, requestId: req.requestId });
    }

    if (incomingTasks.length > 0) {
      const rows = incomingTasks.map((task: any, index: number) => {
        const section = normalizeSection(task?.section);
        const minutes = Math.max(0, Math.round(Number(task?.minutes ?? task?.duration_minutes ?? 0)));
        const normalizedTaskType: TaskType =
          task?.task_type === "full_length_exam" || task?.type === "full_test"
            ? "full_length_exam"
            : task?.task_type === "review_errors" || task?.type === "review"
              ? "review_errors"
              : section === "RW"
                ? "rw_practice"
                : "math_practice";
        return {
          day_id: dayRow.id,
          user_id: user.id,
          day_date: dayDate,
          ordinal: index + 1,
          task_type: normalizedTaskType,
          section,
          duration_minutes: minutes,
          source_skill_code: null,
          source_domain: null,
          source_subskill: null,
          source_reason: { mode: "manual_edit" },
          status: parseTaskStatus(task?.status),
          is_user_override: true,
          planner_owned: false,
          metadata: {
            required: true,
            notes: typeof task?.notes === "string" ? task.notes : null,
          },
          completed_at: task?.status === "completed" ? DateTime.now().toUTC().toISO() : null,
        };
      });
      const { error: insertError } = await supabaseServer.from("student_study_plan_tasks").insert(rows);
      if (insertError) {
        return res.status(500).json({ error: `Failed to save day tasks: ${insertError.message}`, requestId: req.requestId });
      }
    }

    await emitCalendarEvent({
      eventType: "day_edited",
      userId: user.id,
      details: { day_date: dayDate, task_count: incomingTasks.length },
    });
    await emitCalendarEvent({
      eventType: "override_applied",
      userId: user.id,
      details: { day_date: dayDate, source: "manual" },
    });

    const payload = await getMonthPayload(user.id, dayDate, dayDate, settings.timezone);
    return res.json({
      day: payload.days[0] ?? null,
      entitlement: premium,
      requestId: req.requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to edit day";
    return res.status(500).json({ error: message, requestId: req.requestId });
  }
});

calendarRouter.patch("/day/:dayDate/tasks/:taskId", async (req: AuthenticatedRequest, res: Response) => {
  const user = requireRequestUser(req, res);
  if (!user) return;
  const premium = await ensurePremiumAccess(user, res, req.requestId, "task_edit");
  if (!premium) return;

  const { dayDate, taskId } = req.params;
  if (!isIsoDate(dayDate)) {
    return res.status(400).json({ error: "dayDate must be YYYY-MM-DD", requestId: req.requestId });
  }
  const status = parseTaskStatusInput(req.body?.status);
  if (!status) {
    return res.status(400).json({ error: "Invalid task status", code: "INVALID_TASK_STATUS", requestId: req.requestId });
  }
  try {
    const { data: existingTask, error: taskError } = await supabaseServer
      .from("student_study_plan_tasks")
      .select("id, user_id, day_id, day_date, status")
      .eq("id", taskId)
      .eq("user_id", user.id)
      .eq("day_date", dayDate)
      .maybeSingle();
    if (taskError || !existingTask) {
      return res.status(404).json({ error: "Task not found", requestId: req.requestId });
    }
    const previousStatus = parseTaskStatus(existingTask.status);
    if (previousStatus === status) {
      const profile = await loadProfile(user.id);
      const settings = profileSummaryFromRow(user.id, profile);
      const payload = await getMonthPayload(user.id, dayDate, dayDate, settings.timezone);
      return res.json({
        day: payload.days[0] ?? null,
        requestId: req.requestId,
      });
    }

    const { error: updateTaskError } = await supabaseServer
      .from("student_study_plan_tasks")
      .update({
        status,
        completed_at: status === "completed" ? DateTime.now().toUTC().toISO() : null,
        updated_at: DateTime.now().toUTC().toISO(),
      })
      .eq("id", taskId)
      .eq("user_id", user.id);
    if (updateTaskError) {
      return res.status(500).json({ error: `Failed to update task: ${updateTaskError.message}`, requestId: req.requestId });
    }

    const dayRows = await loadDaysByRange(user.id, dayDate, dayDate);
    const day = dayRows[0];
    if (!day) return res.status(404).json({ error: "Day not found", requestId: req.requestId });
    const dayTasks = await loadTasksByRange(user.id, dayDate, dayDate);
    const derived = computeDayStatusFromTasks(dayDate, DateTime.now().toISODate()!, dayTasks);

    const { error: dayUpdateError } = await supabaseServer
      .from("student_study_plan_days")
      .update({
        status: derived.status,
        required_task_count: derived.requiredTaskCount,
        completed_task_count: derived.completedTaskCount,
        updated_at: DateTime.now().toUTC().toISO(),
      })
      .eq("id", day.id)
      .eq("user_id", user.id);
    if (dayUpdateError) {
      return res.status(500).json({ error: `Failed to update day status: ${dayUpdateError.message}`, requestId: req.requestId });
    }

    if (status === "completed" && previousStatus !== "completed") {
      await emitCalendarEvent({
        eventType: "block_completed",
        userId: user.id,
        details: { day_date: dayDate, task_id: taskId },
      });
    }

    const profile = await loadProfile(user.id);
    const settings = profileSummaryFromRow(user.id, profile);
    const payload = await getMonthPayload(user.id, dayDate, dayDate, settings.timezone);
    return res.json({
      day: payload.days[0] ?? null,
      requestId: req.requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update task";
    return res.status(500).json({ error: message, requestId: req.requestId });
  }
});

export async function syncCalendarDayFromSessions(userId: string, dayDate: string, timezone = DEFAULT_TIMEZONE): Promise<void> {
  const startUtc = DateTime.fromISO(dayDate, { zone: timezone }).startOf("day").toUTC().toISO();
  const endUtc = DateTime.fromISO(dayDate, { zone: timezone }).endOf("day").toUTC().toISO();
  if (!startUtc || !endUtc) return;

  const [dayResult, sessionsResult] = await Promise.all([
    supabaseServer
      .from("student_study_plan_days")
      .select("id, user_id, day_date, planned_minutes, completed_minutes")
      .eq("user_id", userId)
      .eq("day_date", dayDate)
      .maybeSingle(),
    supabaseServer
      .from("practice_sessions")
      .select("started_at, finished_at, actual_duration_ms")
      .eq("user_id", userId)
      .gte("started_at", startUtc)
      .lte("started_at", endUtc),
  ]);

  if (dayResult.error || !dayResult.data) return;

  const sessions = (sessionsResult.data as Array<{ started_at: string | null; finished_at: string | null; actual_duration_ms: number | null }> | null) ?? [];
  let totalMinutes = 0;
  for (const session of sessions) {
    if (typeof session.actual_duration_ms === "number" && session.actual_duration_ms > 0) {
      totalMinutes += Math.round(session.actual_duration_ms / 60000);
      continue;
    }
    if (!session.started_at || !session.finished_at) continue;
    const duration = DateTime.fromISO(session.finished_at).diff(DateTime.fromISO(session.started_at), "minutes").minutes;
    totalMinutes += Math.max(0, Math.round(duration));
  }

  const previousCompleted = Math.max(0, Number(dayResult.data.completed_minutes ?? 0));
  if (previousCompleted === totalMinutes) return;

  await supabaseServer
    .from("student_study_plan_days")
    .update({
      completed_minutes: totalMinutes,
      updated_at: DateTime.now().toUTC().toISO(),
    })
    .eq("id", dayResult.data.id)
    .eq("user_id", userId);

  const plannedMinutes = Math.max(0, Number(dayResult.data.planned_minutes ?? 0));
  if (plannedMinutes > 0 && previousCompleted < plannedMinutes && totalMinutes >= plannedMinutes) {
    await emitCalendarEvent({
      eventType: "block_completed",
      userId,
      details: { day_date: dayDate, source: "session_sync" },
    });
  }
}
