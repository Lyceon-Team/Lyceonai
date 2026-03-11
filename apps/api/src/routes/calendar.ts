import { Router, Request, Response } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "../lib/supabase-server";
import { getWeakestSkills } from "../services/studentMastery";
import { DateTime } from "luxon";
import type { SupabaseUser } from "../../../../server/middleware/supabase-auth";
import { resolvePaidKpiAccessForUser } from "../../../../server/services/kpi-access";
import { KPI_CALENDAR_COUNTED_EVENTS } from "../services/mastery-constants";

interface AuthenticatedRequest extends Request {
  supabase?: SupabaseClient;
  user?: SupabaseUser;
}

export const calendarRouter = Router();

const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_DAILY_MINUTES = 30;
const DEFAULT_AUTO_REFRESH_DAYS = 7;
const MIN_GENERATION_DAYS = 1;
const MAX_GENERATION_DAYS = 30;
const CALENDAR_COUNTED_EVENT_TYPES = new Set<string>(KPI_CALENDAR_COUNTED_EVENTS);

export function isCalendarCountedEventType(eventType: string | null | undefined): boolean {
  if (!eventType) return true; // Legacy rows before event_type migration
  return CALENDAR_COUNTED_EVENT_TYPES.has(eventType);
}

type PlannerMode = "auto" | "custom";

type HeuristicFocus = { section: string; competencies?: string[]; weight: number };
type HeuristicTask = { type: string; section: string; mode: string; minutes: number };

interface StudyProfileRow {
  user_id: string;
  baseline_score: number | null;
  target_score: number | null;
  exam_date: string | null;
  daily_minutes: number | null;
  timezone: string | null;
  planner_mode?: PlannerMode | null;
  created_at?: string;
  updated_at?: string;
}

interface ExistingPlanDayRow {
  day_date: string;
  plan_version: number | null;
  is_user_override?: boolean | null;
}

interface BuildPlanRowsResult {
  endDateStr: string;
  planDays: Array<{
    user_id: string;
    day_date: string;
    planned_minutes: number;
    focus: HeuristicFocus[];
    tasks: HeuristicTask[];
    plan_version: number;
    generated_at: string;
    is_user_override: boolean;
  }>;
  skippedOverrideDays: string[];
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function asPlannerMode(value: unknown): PlannerMode {
  return value === "custom" ? "custom" : "auto";
}

function parseGenerationDays(rawDays: unknown, fallback: number): number | null {
  const value = rawDays == null ? fallback : rawDays;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  if (value < MIN_GENERATION_DAYS || value > MAX_GENERATION_DAYS) {
    return null;
  }
  return value;
}

function getLocalDayBounds(timezone: string, localDate: string): { utcStart: string; utcEnd: string } {
  try {
    const startOfDay = DateTime.fromISO(localDate, { zone: timezone }).startOf("day");
    const endOfDay = startOfDay.endOf("day");

    if (!startOfDay.isValid || !endOfDay.isValid) {
      throw new Error("Invalid date or timezone");
    }

    return {
      utcStart: startOfDay.toUTC().toISO()!,
      utcEnd: endOfDay.toUTC().toISO()!,
    };
  } catch {
    return {
      utcStart: `${localDate}T00:00:00.000Z`,
      utcEnd: `${localDate}T23:59:59.999Z`,
    };
  }
}

function computeStatus(plannedMinutes: number, completedMinutes: number): string {
  if (plannedMinutes <= 0) return "planned";
  if (completedMinutes === 0) return "missed";
  if (completedMinutes < plannedMinutes) return "in_progress";
  return "complete";
}

function buildHeuristicFocusAndTasks(
  dailyMinutes: number,
  weaknesses: Array<{ section?: string | null; skill?: string | null }>
): { focus: HeuristicFocus[]; tasks: HeuristicTask[] } {
  let focus: HeuristicFocus[] = [];
  let tasks: HeuristicTask[] = [];

  if (weaknesses.length > 0) {
    const mathWeaknesses = weaknesses.filter(
      (w) =>
        w.section?.toLowerCase() === "math" ||
        (typeof w.skill === "string" && w.skill.startsWith("math."))
    );
    const rwWeaknesses = weaknesses.filter(
      (w) =>
        w.section?.toLowerCase().includes("reading") ||
        w.section?.toLowerCase() === "rw" ||
        (typeof w.skill === "string" && w.skill.startsWith("rw."))
    );

    const mathCompetencies = mathWeaknesses
      .map((w) => w.skill)
      .filter((value): value is string => typeof value === "string")
      .slice(0, 3);
    const rwCompetencies = rwWeaknesses
      .map((w) => w.skill)
      .filter((value): value is string => typeof value === "string")
      .slice(0, 3);

    const hasMathWeakness = mathCompetencies.length > 0;
    const hasRwWeakness = rwCompetencies.length > 0;

    const mathWeight = hasMathWeakness && hasRwWeakness ? 0.6 : hasMathWeakness ? 1 : 0;
    const rwWeight = hasMathWeakness && hasRwWeakness ? 0.4 : hasRwWeakness ? 1 : 0;

    if (hasMathWeakness) {
      focus.push({ section: "Math", competencies: mathCompetencies, weight: mathWeight });
    }
    if (hasRwWeakness) {
      focus.push({ section: "Reading & Writing", competencies: rwCompetencies, weight: rwWeight });
    }

    const mathMinutes = Math.round(dailyMinutes * mathWeight);
    const rwMinutes = dailyMinutes - mathMinutes;

    if (mathMinutes > 0) {
      tasks.push({ type: "practice", section: "Math", mode: "weakness", minutes: mathMinutes });
    }
    if (rwMinutes > 0) {
      tasks.push({ type: "practice", section: "Reading & Writing", mode: "weakness", minutes: rwMinutes });
    }
  }

  if (focus.length === 0) {
    const mathMinutes = Math.round(dailyMinutes * 0.6);
    const rwMinutes = dailyMinutes - mathMinutes;

    focus = [
      { section: "Math", weight: 0.6 },
      { section: "Reading & Writing", weight: 0.4 },
    ];

    tasks = [
      { type: "practice", section: "Math", mode: "mixed", minutes: mathMinutes },
      { type: "practice", section: "Reading & Writing", mode: "mixed", minutes: rwMinutes },
    ];
  }

  return { focus, tasks };
}

async function loadStudyProfile(userId: string): Promise<StudyProfileRow | null> {
  const { data, error } = await supabaseServer
    .from("student_study_profile")
    .select("user_id, baseline_score, target_score, exam_date, daily_minutes, timezone, planner_mode, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load study profile: ${error.message}`);
  }

  return (data as StudyProfileRow | null) ?? null;
}

async function buildPlanRowsForRange(params: {
  userId: string;
  startDate: string;
  days: number;
  forceRegenerateDays?: Set<string>;
}): Promise<BuildPlanRowsResult> {
  const { userId, startDate, days, forceRegenerateDays = new Set<string>() } = params;
  const profile = await loadStudyProfile(userId);
  if (!profile) {
    throw new Error("Study profile not found. Please create a profile first.");
  }

  const dailyMinutes = profile.daily_minutes ?? DEFAULT_DAILY_MINUTES;
  const startDt = DateTime.fromISO(startDate);
  const endDt = startDt.plus({ days: days - 1 });
  const endDateStr = endDt.toISODate()!;

  const { data: existingDays, error: existingDaysError } = await supabaseServer
    .from("student_study_plan_days")
    .select("day_date, plan_version, is_user_override")
    .eq("user_id", userId)
    .gte("day_date", startDate)
    .lte("day_date", endDateStr);

  if (existingDaysError) {
    throw new Error(`Failed to load existing plan days: ${existingDaysError.message}`);
  }

  const existingByDate = new Map<string, ExistingPlanDayRow>();
  for (const row of (existingDays as ExistingPlanDayRow[] | null) ?? []) {
    existingByDate.set(row.day_date, row);
  }

  const weaknesses = await getWeakestSkills({ userId, limit: 10, minAttempts: 2 });
  const { focus, tasks } = buildHeuristicFocusAndTasks(
    dailyMinutes,
    (weaknesses as Array<{ section?: string | null; skill?: string | null }>) ?? []
  );

  const now = new Date().toISOString();
  const skippedOverrideDays: string[] = [];
  const planDays: BuildPlanRowsResult["planDays"] = [];

  for (let i = 0; i < days; i++) {
    const dayDateStr = startDt.plus({ days: i }).toISODate()!;
    const existing = existingByDate.get(dayDateStr);
    const isForcedDay = forceRegenerateDays.has(dayDateStr);
    const isUserOverride = existing?.is_user_override === true;

    if (isUserOverride && !isForcedDay) {
      skippedOverrideDays.push(dayDateStr);
      continue;
    }

    const existingVersion = existing?.plan_version ?? 0;
    planDays.push({
      user_id: userId,
      day_date: dayDateStr,
      planned_minutes: dailyMinutes,
      focus,
      tasks,
      plan_version: existingVersion + 1,
      generated_at: now,
      is_user_override: false,
    });
  }

  return {
    endDateStr,
    planDays,
    skippedOverrideDays,
  };
}

async function ensurePlannerWriteAccess(user: SupabaseUser): Promise<{
  hasPaidAccess: boolean;
  reason: string;
  plan: "free" | "paid";
  status: "active" | "trialing" | "past_due" | "canceled" | "inactive";
  currentPeriodEnd: string | null;
}> {
  const access = await resolvePaidKpiAccessForUser(user.id, user.role);
  return {
    hasPaidAccess: access.hasPaidAccess,
    reason: access.reason,
    plan: access.plan,
    status: access.status,
    currentPeriodEnd: access.currentPeriodEnd,
  };
}

async function buildCatchUpSuggestions(params: {
  userId: string;
  dayDate: string;
  dailyMinutes: number;
}): Promise<Array<{
  type: "catch_up_block";
  day_date: string;
  planned_minutes: number;
  focus: HeuristicFocus[];
  tasks: HeuristicTask[];
  reason: string;
}>> {
  const weaknesses = await getWeakestSkills({ userId: params.userId, limit: 10, minAttempts: 2 });
  const { focus, tasks } = buildHeuristicFocusAndTasks(
    params.dailyMinutes,
    (weaknesses as Array<{ section?: string | null; skill?: string | null }>) ?? []
  );

  return [
    {
      type: "catch_up_block",
      day_date: params.dayDate,
      planned_minutes: params.dailyMinutes,
      focus,
      tasks,
      reason: "Custom mode keeps ownership with the student, so this remains a suggestion.",
    },
  ];
}

export async function syncCalendarDayFromSessions(
  userId: string,
  dayDate: string,
  timezone: string = DEFAULT_TIMEZONE
): Promise<void> {
  try {
    const { data: planDay, error: planError } = await supabaseServer
      .from("student_study_plan_days")
      .select("planned_minutes")
      .eq("user_id", userId)
      .eq("day_date", dayDate)
      .maybeSingle();

    if (planError || !planDay) {
      return;
    }

    const { utcStart, utcEnd } = getLocalDayBounds(timezone, dayDate);

    const { data: sessions, error: sessionsError } = await supabaseServer
      .from("practice_sessions")
      .select("duration_minutes, started_at, finished_at")
      .eq("user_id", userId)
      .gte("started_at", utcStart)
      .lte("started_at", utcEnd);

    if (sessionsError) {
      console.warn("[calendar] syncCalendarDayFromSessions: failed to fetch sessions", sessionsError.message);
      return;
    }

    let totalMinutes = 0;
    for (const session of sessions ?? []) {
      if (session.duration_minutes != null) {
        totalMinutes += session.duration_minutes;
      } else if (session.started_at && session.finished_at) {
        const startTime = new Date(session.started_at).getTime();
        const endTime = new Date(session.finished_at).getTime();
        totalMinutes += Math.round((endTime - startTime) / 60000);
      }
    }

    const completedMinutes = Math.min(600, Math.max(0, totalMinutes));
    const plannedMinutes = planDay.planned_minutes ?? 0;
    const status = computeStatus(plannedMinutes, completedMinutes);

    const { error: updateError } = await supabaseServer
      .from("student_study_plan_days")
      .update({ completed_minutes: completedMinutes, status })
      .eq("user_id", userId)
      .eq("day_date", dayDate);

    if (updateError) {
      console.warn("[calendar] syncCalendarDayFromSessions: failed to update", updateError.message);
    }
  } catch (err: any) {
    console.warn("[calendar] syncCalendarDayFromSessions: unexpected error", err?.message || String(err));
  }
}

calendarRouter.get("/profile", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase = req.supabase;

    if (!userId || !supabase) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { data, error } = await supabase
      .from("student_study_profile")
      .select("user_id, baseline_score, target_score, exam_date, daily_minutes, timezone, planner_mode, created_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: "Failed to load study profile", details: error.message });
    }

    return res.json({
      profile: data
        ? {
            ...data,
            planner_mode: asPlannerMode((data as StudyProfileRow).planner_mode),
          }
        : null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

calendarRouter.put("/profile", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase = req.supabase;

    if (!userId || !supabase) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const {
      baseline_score,
      target_score,
      exam_date,
      daily_minutes,
      timezone,
      planner_mode,
    } = req.body ?? {};

    if (baseline_score != null && typeof baseline_score !== "number") {
      return res.status(400).json({ error: "baseline_score must be a number" });
    }
    if (target_score != null && typeof target_score !== "number") {
      return res.status(400).json({ error: "target_score must be a number" });
    }
    if (exam_date != null && !isIsoDate(exam_date)) {
      return res.status(400).json({ error: "exam_date must be YYYY-MM-DD" });
    }
    if (daily_minutes != null && (typeof daily_minutes !== "number" || daily_minutes < 0 || daily_minutes > 600)) {
      return res.status(400).json({ error: "daily_minutes must be a number between 0 and 600" });
    }
    if (timezone != null && typeof timezone !== "string") {
      return res.status(400).json({ error: "timezone must be a string" });
    }
    if (planner_mode != null && planner_mode !== "auto" && planner_mode !== "custom") {
      return res.status(400).json({ error: "planner_mode must be 'auto' or 'custom'" });
    }

    const payload = {
      user_id: userId,
      baseline_score: baseline_score ?? null,
      target_score: target_score ?? null,
      exam_date: exam_date ?? null,
      daily_minutes: daily_minutes ?? undefined,
      timezone: timezone ?? undefined,
      planner_mode: planner_mode ?? undefined,
    };

    const { data, error } = await supabase
      .from("student_study_profile")
      .upsert(payload, { onConflict: "user_id" })
      .select("user_id, baseline_score, target_score, exam_date, daily_minutes, timezone, planner_mode, created_at, updated_at")
      .single();

    if (error) {
      return res.status(500).json({ error: "Failed to save study profile", details: error.message });
    }

    return res.json({
      profile: {
        ...data,
        planner_mode: asPlannerMode((data as StudyProfileRow).planner_mode),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

calendarRouter.get("/mode", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const profile = await loadStudyProfile(userId);
    return res.json({
      planner_mode: asPlannerMode(profile?.planner_mode),
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

calendarRouter.put("/mode", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const plannerMode = req.body?.planner_mode;
    if (plannerMode !== "auto" && plannerMode !== "custom") {
      return res.status(400).json({ error: "planner_mode must be 'auto' or 'custom'" });
    }

    const { data, error } = await supabaseServer
      .from("student_study_profile")
      .upsert(
        {
          user_id: userId,
          planner_mode: plannerMode,
        },
        { onConflict: "user_id" }
      )
      .select("planner_mode")
      .single();

    if (error) {
      return res.status(500).json({ error: "Failed to save planner mode", details: error.message });
    }

    return res.json({
      planner_mode: asPlannerMode((data as StudyProfileRow).planner_mode),
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

async function calculateStreak(userId: string, timezone: string = DEFAULT_TIMEZONE): Promise<{ current: number; longest: number }> {
  const todayLocal = DateTime.now().setZone(timezone).toISODate();
  if (!todayLocal) {
    return { current: 0, longest: 0 };
  }

  const { data: completedDays, error } = await supabaseServer
    .from("student_study_plan_days")
    .select("day_date, status, completed_minutes, planned_minutes")
    .eq("user_id", userId)
    .lte("day_date", todayLocal)
    .order("day_date", { ascending: false })
    .limit(365);

  if (error || !completedDays) {
    return { current: 0, longest: 0 };
  }

  const isComplete = (day: any) => day.status === "complete";

  const completeDaysSet = new Set(completedDays.filter(isComplete).map((d) => d.day_date));

  let currentStreak = 0;
  let checkDate = DateTime.fromISO(todayLocal, { zone: timezone });

  while (completeDaysSet.has(checkDate.toISODate()!)) {
    currentStreak++;
    checkDate = checkDate.minus({ days: 1 });
  }

  let longestStreak = 0;
  let tempStreak = 0;
  let prevDate: DateTime | null = null;

  const sortedDays = completedDays
    .filter(isComplete)
    .sort((a, b) => a.day_date.localeCompare(b.day_date));

  for (const day of sortedDays) {
    const dayDate = DateTime.fromISO(day.day_date, { zone: timezone });

    if (prevDate === null) {
      tempStreak = 1;
    } else {
      const expectedNext = prevDate.plus({ days: 1 });

      if (dayDate.toISODate() === expectedNext.toISODate()) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }

    prevDate = dayDate;
  }

  longestStreak = Math.max(longestStreak, tempStreak);

  return { current: currentStreak, longest: longestStreak };
}

calendarRouter.get("/streak", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase = req.supabase;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { data: profile } = await (supabase || supabaseServer)
      .from("student_study_profile")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();

    const timezone = profile?.timezone || DEFAULT_TIMEZONE;

    const streak = await calculateStreak(userId, timezone);
    return res.json({ streak });
  } catch (err: any) {
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

calendarRouter.get("/month", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const supabase = req.supabase;

    if (!userId || !supabase) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const start = req.query.start as string | undefined;
    const end = req.query.end as string | undefined;

    if (!start || !isIsoDate(start)) {
      return res.status(400).json({ error: "start query param must be YYYY-MM-DD" });
    }
    if (!end || !isIsoDate(end)) {
      return res.status(400).json({ error: "end query param must be YYYY-MM-DD" });
    }

    const { data: profile } = await supabase
      .from("student_study_profile")
      .select("timezone, planner_mode")
      .eq("user_id", userId)
      .maybeSingle();

    const timezone = profile?.timezone || DEFAULT_TIMEZONE;
    const plannerMode = asPlannerMode((profile as StudyProfileRow | null)?.planner_mode);

    const startUtc = DateTime.fromISO(start, { zone: timezone }).startOf("day").toUTC().toISO()!;
    const endUtc = DateTime.fromISO(end, { zone: timezone }).endOf("day").toUTC().toISO()!;

    const [planDaysResult, attemptsResult, streakResult] = await Promise.all([
      supabase
        .from("student_study_plan_days")
        .select("day_date, planned_minutes, completed_minutes, status, focus, tasks, plan_version, generated_at, created_at, updated_at, is_user_override")
        .eq("user_id", userId)
        .gte("day_date", start)
        .lte("day_date", end)
        .order("day_date", { ascending: true }),

      supabase
        .from("student_question_attempts")
        .select("attempted_at, is_correct, time_spent_ms, section, domain, event_type")
        .eq("user_id", userId)
        .gte("attempted_at", startUtc)
        .lte("attempted_at", endUtc),

      calculateStreak(userId, timezone),
    ]);

    if (planDaysResult.error) {
      return res.status(500).json({ error: "Failed to load calendar data", details: planDaysResult.error.message });
    }

    const attemptsByDay = new Map<
      string,
      {
        attempts: number;
        correct: number;
        totalTimeMs: number;
      }
    >();

    for (const attempt of attemptsResult.data || []) {
      if (!isCalendarCountedEventType((attempt as any).event_type)) continue;
      if (!attempt.attempted_at) continue;

      const localDate = DateTime.fromISO(attempt.attempted_at).setZone(timezone).toISODate();
      if (!localDate) continue;

      if (!attemptsByDay.has(localDate)) {
        attemptsByDay.set(localDate, { attempts: 0, correct: 0, totalTimeMs: 0 });
      }

      const dayStats = attemptsByDay.get(localDate)!;
      dayStats.attempts++;
      if (attempt.is_correct) dayStats.correct++;
      dayStats.totalTimeMs += attempt.time_spent_ms || 0;
    }

    const enrichedDays = (planDaysResult.data ?? []).map((day) => {
      const dayStats = attemptsByDay.get(day.day_date);

      return {
        ...day,
        attempt_count: dayStats?.attempts ?? 0,
        accuracy: dayStats && dayStats.attempts > 0 ? Math.round((dayStats.correct / dayStats.attempts) * 100) : null,
        avg_seconds_per_question:
          dayStats && dayStats.attempts > 0 ? Math.round(dayStats.totalTimeMs / dayStats.attempts / 1000) : null,
      };
    });

    return res.json({
      days: enrichedDays,
      streak: streakResult,
      planner_mode: plannerMode,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

calendarRouter.patch("/day/complete", async (_req: AuthenticatedRequest, res: Response) => {
  return res.status(410).json({
    error: "Completion is session-derived. Start a study session to count progress.",
    message: "Manual completion override has been removed. Completion minutes are now computed from practice_sessions automatically.",
  });
});

calendarRouter.post("/generate", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { start_date, days } = req.body ?? {};
    const userId = req.user.id;

    if (!start_date || !isIsoDate(start_date)) {
      return res.status(400).json({ error: "start_date must be YYYY-MM-DD" });
    }

    const parsedDays = parseGenerationDays(days, 14);
    if (parsedDays == null) {
      return res.status(400).json({ error: "days must be an integer between 1 and 30" });
    }

    const startDt = DateTime.fromISO(start_date);
    const endDt = startDt.plus({ days: parsedDays - 1 });
    const endDateStr = endDt.toISODate()!;

    const { data: existingDays, error: existingDaysError } = await supabaseServer
      .from("student_study_plan_days")
      .select("day_date")
      .eq("user_id", userId)
      .gte("day_date", start_date)
      .lte("day_date", endDateStr);

    if (existingDaysError) {
      return res.status(500).json({ error: "Failed to inspect existing study plan", details: existingDaysError.message });
    }

    const isRegeneration = (existingDays ?? []).length > 0;
    if (isRegeneration) {
      const access = await ensurePlannerWriteAccess(req.user);
      if (!access.hasPaidAccess) {
        return res.status(402).json({
          error: "Planner regeneration requires active entitlement",
          code: "PLANNER_REGEN_LOCKED",
          feature: "calendar_regeneration",
          reason: access.reason,
          entitlement: {
            plan: access.plan,
            status: access.status,
            currentPeriodEnd: access.currentPeriodEnd,
          },
          requestId: (req as any).requestId,
        });
      }
    }

    const profile = await loadStudyProfile(userId);
    if (!profile) {
      return res.status(400).json({ error: "Study profile not found. Please create a profile first." });
    }

    const generated = await buildPlanRowsForRange({
      userId,
      startDate: start_date,
      days: parsedDays,
    });

    if (generated.planDays.length > 0) {
      const { error: upsertError } = await supabaseServer
        .from("student_study_plan_days")
        .upsert(generated.planDays, { onConflict: "user_id,day_date" });

      if (upsertError) {
        return res.status(500).json({ error: "Failed to save study plan", details: upsertError.message });
      }
    }

    return res.json({
      generated: {
        start_date,
        end_date: generated.endDateStr,
        days: generated.planDays.length,
        used_llm: false,
        planner_mode: asPlannerMode(profile.planner_mode),
        skipped_override_days: generated.skippedOverrideDays,
        skipped_override_count: generated.skippedOverrideDays.length,
      },
    });
  } catch (err: any) {
    if (typeof err?.message === "string" && err.message.includes("Study profile not found")) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

calendarRouter.post("/refresh/auto", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const userId = req.user.id;
    const profile = await loadStudyProfile(userId);
    if (!profile) {
      return res.status(400).json({ error: "Study profile not found. Please create a profile first." });
    }

    const plannerMode = asPlannerMode(profile.planner_mode);
    const rawStartDate = req.body?.start_date;
    const startDate =
      typeof rawStartDate === "string" && isIsoDate(rawStartDate)
        ? rawStartDate
        : DateTime.now().setZone(profile.timezone || DEFAULT_TIMEZONE).toISODate();

    if (!startDate || !isIsoDate(startDate)) {
      return res.status(400).json({ error: "start_date must be YYYY-MM-DD" });
    }

    const parsedDays = parseGenerationDays(req.body?.days, DEFAULT_AUTO_REFRESH_DAYS);
    if (parsedDays == null) {
      return res.status(400).json({ error: "days must be an integer between 1 and 30" });
    }

    if (plannerMode === "custom") {
      const suggestions = await buildCatchUpSuggestions({
        userId,
        dayDate: startDate,
        dailyMinutes: profile.daily_minutes ?? DEFAULT_DAILY_MINUTES,
      });

      return res.json({
        applied: false,
        planner_mode: "custom",
        reason: "Auto refresh is disabled in custom mode.",
        suggestions,
      });
    }

    const access = await ensurePlannerWriteAccess(req.user);
    if (!access.hasPaidAccess) {
      return res.status(402).json({
        error: "Planner auto refresh requires active entitlement",
        code: "PLANNER_AUTO_REFRESH_LOCKED",
        feature: "calendar_auto_refresh",
        reason: access.reason,
        entitlement: {
          plan: access.plan,
          status: access.status,
          currentPeriodEnd: access.currentPeriodEnd,
        },
        requestId: (req as any).requestId,
      });
    }

    const generated = await buildPlanRowsForRange({
      userId,
      startDate,
      days: parsedDays,
    });

    if (generated.planDays.length > 0) {
      const { error: upsertError } = await supabaseServer
        .from("student_study_plan_days")
        .upsert(generated.planDays, { onConflict: "user_id,day_date" });
      if (upsertError) {
        return res.status(500).json({ error: "Failed to save auto-refreshed study plan", details: upsertError.message });
      }
    }

    return res.json({
      applied: true,
      planner_mode: "auto",
      refreshed: {
        start_date: startDate,
        end_date: generated.endDateStr,
        days: generated.planDays.length,
        skipped_override_days: generated.skippedOverrideDays,
        skipped_override_count: generated.skippedOverrideDays.length,
      },
    });
  } catch (err: any) {
    if (typeof err?.message === "string" && err.message.includes("Study profile not found")) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

calendarRouter.put("/day/:dayDate", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const dayDate = req.params.dayDate;
    if (!isIsoDate(dayDate)) {
      return res.status(400).json({ error: "dayDate path param must be YYYY-MM-DD" });
    }

    const plannedMinutes = req.body?.planned_minutes;
    const focus = req.body?.focus;
    const tasks = req.body?.tasks;

    if (plannedMinutes != null && (typeof plannedMinutes !== "number" || plannedMinutes < 0 || plannedMinutes > 600)) {
      return res.status(400).json({ error: "planned_minutes must be a number between 0 and 600" });
    }
    if (focus != null && !Array.isArray(focus)) {
      return res.status(400).json({ error: "focus must be an array when provided" });
    }
    if (tasks != null && !Array.isArray(tasks)) {
      return res.status(400).json({ error: "tasks must be an array when provided" });
    }
    if (plannedMinutes == null && focus == null && tasks == null) {
      return res.status(400).json({ error: "At least one of planned_minutes, focus, or tasks is required" });
    }

    const { data: existingDay, error: existingDayError } = await supabaseServer
      .from("student_study_plan_days")
      .select("planned_minutes, focus, tasks, plan_version")
      .eq("user_id", userId)
      .eq("day_date", dayDate)
      .maybeSingle();

    if (existingDayError) {
      return res.status(500).json({ error: "Failed to load existing day", details: existingDayError.message });
    }

    const profile = await loadStudyProfile(userId);

    const payload = {
      user_id: userId,
      day_date: dayDate,
      planned_minutes:
        plannedMinutes ??
        (existingDay?.planned_minutes ?? profile?.daily_minutes ?? DEFAULT_DAILY_MINUTES),
      focus: focus ?? existingDay?.focus ?? [],
      tasks: tasks ?? existingDay?.tasks ?? [],
      plan_version: (existingDay?.plan_version ?? 0) + 1,
      generated_at: new Date().toISOString(),
      is_user_override: true,
    };

    const { data: updatedDay, error: upsertError } = await supabaseServer
      .from("student_study_plan_days")
      .upsert(payload, { onConflict: "user_id,day_date" })
      .select("day_date, planned_minutes, completed_minutes, status, focus, tasks, plan_version, generated_at, created_at, updated_at, is_user_override")
      .single();

    if (upsertError) {
      return res.status(500).json({ error: "Failed to save manual day edit", details: upsertError.message });
    }

    return res.json({
      updated: true,
      day: updatedDay,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

async function regenerateSingleDay(req: AuthenticatedRequest, res: Response): Promise<Response> {
  const userId = req.user?.id;
  if (!userId || !req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const dayDate = req.params.dayDate;
  if (!isIsoDate(dayDate)) {
    return res.status(400).json({ error: "dayDate path param must be YYYY-MM-DD" });
  }

  const access = await ensurePlannerWriteAccess(req.user);
  if (!access.hasPaidAccess) {
    return res.status(402).json({
      error: "Single-day regeneration requires active entitlement",
      code: "PLANNER_DAY_REGEN_LOCKED",
      feature: "calendar_day_regeneration",
      reason: access.reason,
      entitlement: {
        plan: access.plan,
        status: access.status,
        currentPeriodEnd: access.currentPeriodEnd,
      },
      requestId: (req as any).requestId,
    });
  }

  const generated = await buildPlanRowsForRange({
    userId,
    startDate: dayDate,
    days: 1,
    forceRegenerateDays: new Set([dayDate]),
  });

  if (generated.planDays.length !== 1) {
    return res.status(500).json({ error: "Failed to build single-day regeneration payload" });
  }

  const { data: regeneratedDay, error: upsertError } = await supabaseServer
    .from("student_study_plan_days")
    .upsert(generated.planDays[0], { onConflict: "user_id,day_date" })
    .select("day_date, planned_minutes, completed_minutes, status, focus, tasks, plan_version, generated_at, created_at, updated_at, is_user_override")
    .single();

  if (upsertError) {
    return res.status(500).json({ error: "Failed to regenerate day", details: upsertError.message });
  }

  return res.json({
    regenerated: true,
    day: regeneratedDay,
  });
}

calendarRouter.post("/day/:dayDate/regenerate", async (req: AuthenticatedRequest, res: Response) => {
  try {
    return await regenerateSingleDay(req, res);
  } catch (err: any) {
    if (typeof err?.message === "string" && err.message.includes("Study profile not found")) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

calendarRouter.post("/day/:dayDate/reset", async (req: AuthenticatedRequest, res: Response) => {
  try {
    return await regenerateSingleDay(req, res);
  } catch (err: any) {
    if (typeof err?.message === "string" && err.message.includes("Study profile not found")) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});
