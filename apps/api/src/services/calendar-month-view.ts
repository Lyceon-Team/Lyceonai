import { DateTime } from "luxon";
import { supabaseServer } from "../lib/supabase-server";
import { KPI_CALENDAR_COUNTED_EVENTS } from "./mastery-constants";
import type { DayStatus, TaskType } from "./calendar-planner";

type TaskStatus = "planned" | "in_progress" | "completed" | "skipped" | "missed";

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
  generation_source: string;
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
  event_type: string | null;
};

const CALENDAR_COUNTED_EVENT_TYPES = new Set<string>(KPI_CALENDAR_COUNTED_EVENTS);

function canonicalDayStatus(value: unknown): DayStatus {
  if (value === "completed" || value === "partially_completed" || value === "missed") return value;
  if (value === "complete") return "completed";
  if (value === "in_progress") return "partially_completed";
  return "planned";
}

function legacyDayStatus(status: DayStatus): "planned" | "in_progress" | "complete" | "missed" {
  if (status === "completed") return "complete";
  if (status === "partially_completed") return "in_progress";
  return status;
}

function parseTaskStatus(value: unknown): TaskStatus {
  if (value === "completed" || value === "in_progress" || value === "skipped" || value === "missed") return value;
  return "planned";
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

export function isCalendarCountedEventType(eventType: string | null | undefined): boolean {
  if (!eventType) return true;
  return CALENDAR_COUNTED_EVENT_TYPES.has(eventType);
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
    .select("attempted_at, is_correct, time_spent_ms, event_type")
    .eq("user_id", userId)
    .gte("attempted_at", startUtc)
    .lte("attempted_at", endUtc)
    .order("attempted_at", { ascending: false });
  if (error) throw new Error(`Failed to load attempts: ${error.message}`);
  return (data as AttemptRow[] | null) ?? [];
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

export async function buildCalendarMonthView(userId: string, start: string, end: string, timezone: string) {
  const startUtc = DateTime.fromISO(start, { zone: timezone }).startOf("day").toUTC().toISO()!;
  const endUtc = DateTime.fromISO(end, { zone: timezone }).endOf("day").toUTC().toISO()!;

  const [days, tasks, attempts, streak] = await Promise.all([
    loadDaysByRange(userId, start, end),
    loadTasksByRange(userId, start, end),
    loadAttemptsByRange(userId, startUtc, endUtc),
    calculateStreak(userId, timezone),
  ]);

  const taskByDay = new Map<string, PlanTaskRow[]>();
  for (const task of tasks) {
    const group = taskByDay.get(task.day_date) ?? [];
    group.push(task);
    taskByDay.set(task.day_date, group);
  }

  const attemptByDay = new Map<string, { attempts: number; correct: number; timeSpentMs: number }>();
  for (const attempt of attempts) {
    if (!isCalendarCountedEventType(attempt.event_type)) continue;
    if (!attempt.attempted_at) continue;
    const localDate = DateTime.fromISO(attempt.attempted_at).setZone(timezone).toISODate();
    if (!localDate) continue;
    const current = attemptByDay.get(localDate) ?? { attempts: 0, correct: 0, timeSpentMs: 0 };
    current.attempts += 1;
    if (attempt.is_correct) current.correct += 1;
    current.timeSpentMs += Math.max(0, attempt.time_spent_ms || 0);
    attemptByDay.set(localDate, current);
  }

  const serializedDays = days.map((day) => {
    const dayTasks = (taskByDay.get(day.day_date) ?? []).sort((a, b) => a.ordinal - b.ordinal);
    const stats = attemptByDay.get(day.day_date);
    const derived = computeDayStatusFromTasks(day.day_date, DateTime.now().setZone(timezone).toISODate()!, dayTasks);

    return {
      ...day,
      status_canonical: day.status,
      status: legacyDayStatus(day.status),
      required_task_count: day.required_task_count || derived.requiredTaskCount,
      completed_task_count: day.completed_task_count || derived.completedTaskCount,
      focus: day.focus ?? [],
      tasks: dayTasks.length > 0 ? dayTasks.map(planTaskToLegacy) : Array.isArray(day.tasks) ? day.tasks : [],
      task_items: dayTasks,
      is_exam_day: day.is_exam_day,
      is_taper_day: day.is_taper_day,
      is_full_test_day: day.is_full_test_day,
      attempt_count: stats?.attempts ?? 0,
      accuracy: stats && stats.attempts > 0 ? Math.round((stats.correct / stats.attempts) * 100) : null,
      avg_seconds_per_question: stats && stats.attempts > 0 ? Math.round(stats.timeSpentMs / stats.attempts / 1000) : null,
    };
  });

  return { days: serializedDays, streak };
}
