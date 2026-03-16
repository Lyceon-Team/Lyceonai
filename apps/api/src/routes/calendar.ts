import { Router, Response } from "express";
import { DateTime } from "luxon";
import { supabaseServer } from "../lib/supabase-server";
import {
  type AuthenticatedRequest,
  type SupabaseUser,
  requireRequestAuthContext,
  requireRequestUser,
} from "../../../../server/middleware/supabase-auth";
import { resolvePaidKpiAccessForUser } from "../../../../server/services/kpi-access";
import { KPI_CALENDAR_COUNTED_EVENTS } from "../services/mastery-constants";
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

export const calendarRouter = Router();

const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_DAILY_MINUTES = 30;
const CALENDAR_COUNTED_EVENT_TYPES = new Set<string>(KPI_CALENDAR_COUNTED_EVENTS);
type PlannerMode = "auto" | "custom";
type TaskStatus = "planned" | "in_progress" | "completed" | "skipped" | "missed";
type CalendarEventType = "plan_generated" | "day_edited" | "plan_refreshed" | "block_completed" | "override_applied";

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
  generation_source: "auto" | "user" | "refresh" | "regenerate" | "generate";
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
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 7)
    )
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
    // best effort
  }
}

async function ensurePremiumAccess(user: SupabaseUser, res: Response, requestId: string | undefined, feature: string): Promise<{ plan: string; status: string; reason: string; currentPeriodEnd: string | null } | null> {
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
  return (data as PlanDayRow[] | null) ?? [];
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
  return (data as PlanTaskRow[] | null) ?? [];
}

async function loadAttemptsByRange(userId: string, startUtc: string, endUtc: string): Promise<AttemptRow[]> {
  const { data, error } = await supabaseServer
    .from("student_question_attempts")
    .select("attempted_at, is_correct, time_spent_ms, section, domain, skill, subskill, question_canonical_id, event_type")
    .eq("user_id", userId)
    .gte("attempted_at", startUtc)
    .lte("attempted_at", endUtc)
    .order("attempted_at", { ascending: false });
  if (error) return [];
  return (data as AttemptRow[] | null) ?? [];
}

