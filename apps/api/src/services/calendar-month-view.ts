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
  replaces_override: boolean;
  replaced_override_day_id: string | null;
  replacement_source: string | null;
  replacement_at: string | null;
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
  replaces_override: boolean;
  replaced_override_task_id: string | null;
  replacement_source: string | null;
  replacement_at: string | null;
  override_target_type: string | null;
  override_target_domain: string | null;
  override_target_skill: string | null;
  override_target_session_id: string | null;
  override_target_exam_id: string | null;
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

function normalizeTaskType(value: unknown, section: "MATH" | "RW" | null, mode: unknown): TaskType {
  const raw = typeof value === "string" ? value.toLowerCase().trim() : "";
  const rawMode = typeof mode === "string" ? mode.toLowerCase().trim() : "";
  if (raw === "full_length" || raw === "full_length_exam" || raw === "full_test" || raw === "full-length") return "full_length";
  if (raw === "review_full_length" || rawMode === "review_full_length" || rawMode === "full-length-review") return "review_full_length";
  if (raw === "review_practice" || raw === "review_errors" || raw === "review") return "review_practice";
  if (raw === "focused_drill" || rawMode === "compressed" || rawMode === "focused" || rawMode === "skill-focused") return "focused_drill";
  if (raw === "tutor_support" || rawMode === "support" || rawMode === "tutor") return "tutor_support";
  if (raw === "practice" || raw === "math_practice" || raw === "rw_practice") return "practice";
  if (section === "MATH" || section === "RW") return "practice";
  return "practice";
}

function taskSectionToLegacy(section: "MATH" | "RW" | null): string | null {
  if (section === "MATH") return "Math";
  if (section === "RW") return "Reading & Writing";
  return null;
}

function taskModeForDay(task: Pick<PlanTaskRow, "task_type" | "metadata">): string {
  if (task.task_type === "full_length") return "full-length";
  if (task.task_type === "review_full_length") return "review-full-length";
  if (task.task_type === "review_practice") return "review";
  if (task.task_type === "focused_drill") return task.metadata?.compressed ? "compressed" : "focused";
  if (task.task_type === "tutor_support") return "support";
  return task.metadata?.compressed ? "compressed" : "mixed";
}

function planTaskToLegacy(task: PlanTaskRow): Record<string, unknown> {
  const target = {
    section: task.section,
    skill_code: task.override_target_skill ?? task.source_skill_code,
    domain: task.override_target_domain ?? task.source_domain,
    subskill: task.source_subskill,
    target_type: task.override_target_type,
    review_session_id: task.override_target_session_id,
    exam_id: task.override_target_exam_id,
  };
  return {
    id: task.id,
    type: task.task_type,
    section: taskSectionToLegacy(task.section),
    mode: taskModeForDay(task),
    minutes: task.duration_minutes,
    task_type: task.task_type,
    target,
    source_skill_code: task.source_skill_code,
    source_domain: task.source_domain,
    source_subskill: task.source_subskill,
    source_reason: task.source_reason,
    metadata: task.metadata,
    status: task.status,
    ordinal: task.ordinal,
    is_user_override: task.is_user_override,
    planner_owned: task.planner_owned,
    replaces_override: task.replaces_override,
    replaced_override_task_id: task.replaced_override_task_id,
    replacement_source: task.replacement_source,
    replacement_at: task.replacement_at,
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
    .select("id, user_id, day_date, planned_minutes, completed_minutes, focus, tasks, plan_version, generated_at, is_user_override, status, generation_source, is_exam_day, is_taper_day, is_full_test_day, required_task_count, completed_task_count, study_minutes_target, replaces_override, replaced_override_day_id, replacement_source, replacement_at, created_at, updated_at")
    .eq("user_id", userId)
    .gte("day_date", start)
    .lte("day_date", end)
    .order("day_date", { ascending: true });
  if (error) throw new Error(`Failed to load plan days: ${error.message}`);
  return ((data as PlanDayRow[] | null) ?? []).map((row) => ({
    ...row,
    replaces_override: Boolean(row.replaces_override),
    replaced_override_day_id: row.replaced_override_day_id ?? null,
    replacement_source: row.replacement_source ?? null,
    replacement_at: row.replacement_at ?? null,
    status: canonicalDayStatus(row.status),
  }));
}

async function loadTasksByRange(userId: string, start: string, end: string): Promise<PlanTaskRow[]> {
  const { data, error } = await supabaseServer
    .from("student_study_plan_tasks")
    .select("id, day_id, user_id, day_date, ordinal, task_type, section, duration_minutes, source_skill_code, source_domain, source_subskill, source_reason, status, is_user_override, planner_owned, metadata, completed_at, replaces_override, replaced_override_task_id, replacement_source, replacement_at, override_target_type, override_target_domain, override_target_skill, override_target_session_id, override_target_exam_id")
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
    replaces_override: Boolean(row.replaces_override),
    replaced_override_task_id: row.replaced_override_task_id ?? null,
    replacement_source: row.replacement_source ?? null,
    replacement_at: row.replacement_at ?? null,
    override_target_type: row.override_target_type ?? null,
    override_target_domain: row.override_target_domain ?? null,
    override_target_skill: row.override_target_skill ?? null,
    override_target_session_id: row.override_target_session_id ?? null,
    override_target_exam_id: row.override_target_exam_id ?? null,
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
    const fallbackTasks = Array.isArray(day.tasks)
      ? day.tasks.map((task: any) => {
          const section = typeof task?.section === "string" ? (task.section.includes("Math") ? "MATH" : task.section.includes("Writing") ? "RW" : null) : null;
          const canonicalType = normalizeTaskType(task?.task_type ?? task?.type, section, task?.mode);
          const target = task?.target && typeof task.target === "object" ? task.target : {
            section,
            skill_code: typeof task?.source_skill_code === "string" ? task.source_skill_code : null,
            domain: typeof task?.source_domain === "string" ? task.source_domain : null,
            subskill: typeof task?.source_subskill === "string" ? task.source_subskill : null,
            target_type: typeof task?.override_target_type === "string" ? task.override_target_type : null,
            review_session_id: typeof task?.override_target_session_id === "string" ? task.override_target_session_id : null,
            exam_id: typeof task?.override_target_exam_id === "string" ? task.override_target_exam_id : null,
          };
          return {
            ...task,
            type: canonicalType,
            task_type: canonicalType,
            target,
            source_skill_code: typeof task?.source_skill_code === "string" ? task.source_skill_code : null,
            source_domain: typeof task?.source_domain === "string" ? task.source_domain : null,
            source_subskill: typeof task?.source_subskill === "string" ? task.source_subskill : null,
            source_reason: typeof task?.source_reason === "object" && task.source_reason ? task.source_reason : {},
            metadata: typeof task?.metadata === "object" && task.metadata ? task.metadata : {},
            replaces_override: Boolean(task?.replaces_override),
            replaced_override_task_id: typeof task?.replaced_override_task_id === "string" ? task.replaced_override_task_id : null,
            replacement_source: typeof task?.replacement_source === "string" ? task.replacement_source : null,
            replacement_at: typeof task?.replacement_at === "string" ? task.replacement_at : null,
            mode:
              typeof task?.mode === "string"
                ? task.mode
                : canonicalType === "full_length"
                  ? "full-length"
                  : canonicalType === "review_full_length"
                    ? "review-full-length"
                    : canonicalType === "review_practice"
                      ? "review"
                      : canonicalType === "focused_drill"
                        ? "focused"
                        : "mixed",
          };
        })
      : [];

    return {
      ...day,
      status_canonical: day.status,
      status: legacyDayStatus(day.status),
      required_task_count: day.required_task_count || derived.requiredTaskCount,
      completed_task_count: day.completed_task_count || derived.completedTaskCount,
      focus: day.focus ?? [],
      tasks: dayTasks.length > 0 ? dayTasks.map(planTaskToLegacy) : fallbackTasks,
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
