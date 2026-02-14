import { Router, Request, Response } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "../lib/supabase-server";
import { decode } from "jsonwebtoken";
import { getWeakestSkills, getMasterySummary } from "../services/studentMastery";
import { z } from "zod";
import { generateJson, isV4GeminiEnabled } from "../ingestion_v4/services/gemini";
import { DateTime } from "luxon";

interface SupabaseUser {
  id: string;
  email: string;
  display_name: string | null;
  role: 'student' | 'admin' | 'guardian';
  isAdmin: boolean;
  isGuardian?: boolean;
}

interface AuthenticatedRequest extends Request {
  supabase?: SupabaseClient;
  user?: SupabaseUser;
}

export const calendarRouter = Router();

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const StudyBlockSchema = z.object({
  type: z.enum(["practice", "review", "flashcards", "full_test"]),
  minutes: z.number().int().min(5).max(180),
  skills: z.array(z.string()),
  instructions: z.string(),
});

const StudyDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  planned_minutes: z.number().int().min(0).max(600),
  focus_skills: z.array(z.string()),
  blocks: z.array(StudyBlockSchema),
});

const LLMStudyPlanSchema = z.object({
  plan_version: z.string(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.array(StudyDaySchema),
});

type LLMStudyPlan = z.infer<typeof LLMStudyPlanSchema>;

function getLocalDayBounds(timezone: string, localDate: string): { utcStart: string; utcEnd: string } {
  try {
    const startOfDay = DateTime.fromISO(localDate, { zone: timezone }).startOf('day');
    const endOfDay = startOfDay.endOf('day');
    
    if (!startOfDay.isValid || !endOfDay.isValid) {
      throw new Error('Invalid date or timezone');
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

export async function syncCalendarDayFromSessions(userId: string, dayDate: string, timezone: string = "America/Chicago"): Promise<void> {
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
      .select("user_id, baseline_score, target_score, exam_date, daily_minutes, timezone, created_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: "Failed to load study profile", details: error.message });
    }

    return res.json({ profile: data ?? null });
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

    const payload = {
      user_id: userId,
      baseline_score: baseline_score ?? null,
      target_score: target_score ?? null,
      exam_date: exam_date ?? null,
      daily_minutes: daily_minutes ?? undefined,
      timezone: timezone ?? undefined,
    };

    const { data, error } = await supabase
      .from("student_study_profile")
      .upsert(payload, { onConflict: "user_id" })
      .select("user_id, baseline_score, target_score, exam_date, daily_minutes, timezone, created_at, updated_at")
      .single();

    if (error) {
      return res.status(500).json({ error: "Failed to save study profile", details: error.message });
    }

    return res.json({ profile: data });
  } catch (err: any) {
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

async function calculateStreak(userId: string, timezone: string = "America/Chicago"): Promise<{ current: number; longest: number }> {
  // Compute "today" in user timezone using Luxon
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

  // Only status === "complete" counts (canonical status)
  const isComplete = (day: any) => day.status === "complete";

  const completeDaysSet = new Set(
    completedDays.filter(isComplete).map(d => d.day_date)
  );

  // Step backwards by local days using Luxon
  let currentStreak = 0;
  let checkDate = DateTime.fromISO(todayLocal, { zone: timezone });
  
  while (completeDaysSet.has(checkDate.toISODate()!)) {
    currentStreak++;
    checkDate = checkDate.minus({ days: 1 });
  }

  // Calculate longest streak
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

    // Fetch user timezone
    const { data: profile } = await (supabase || supabaseServer)
      .from("student_study_profile")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();
    
    const timezone = profile?.timezone || "America/Chicago";

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

    // Fetch user timezone
    const { data: profile } = await supabase
      .from("student_study_profile")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();
    
    const timezone = profile?.timezone || "America/Chicago";

    // Compute UTC bounds for start and end local days using Luxon
    const startUtc = DateTime.fromISO(start, { zone: timezone }).startOf("day").toUTC().toISO()!;
    const endUtc = DateTime.fromISO(end, { zone: timezone }).endOf("day").toUTC().toISO()!;

    const [planDaysResult, attemptsResult, streakResult] = await Promise.all([
      supabase
        .from("student_study_plan_days")
        .select("day_date, planned_minutes, completed_minutes, status, focus, tasks, plan_version, generated_at, created_at, updated_at")
        .eq("user_id", userId)
        .gte("day_date", start)
        .lte("day_date", end)
        .order("day_date", { ascending: true }),
      
      supabase
        .from("student_question_attempts")
        .select("attempted_at, is_correct, time_spent_ms, section, domain")
        .eq("user_id", userId)
        .gte("attempted_at", startUtc)
        .lte("attempted_at", endUtc),
      
      calculateStreak(userId, timezone),
    ]);

    if (planDaysResult.error) {
      return res.status(500).json({ error: "Failed to load calendar data", details: planDaysResult.error.message });
    }

    // Bucket attempts by local date using Luxon
    const attemptsByDay = new Map<string, {
      attempts: number;
      correct: number;
      totalTimeMs: number;
    }>();

    for (const attempt of attemptsResult.data || []) {
      if (!attempt.attempted_at) continue;
      
      // Convert attempted_at to user timezone and get local date
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

    const enrichedDays = (planDaysResult.data ?? []).map(day => {
      const dayStats = attemptsByDay.get(day.day_date);
      
      return {
        ...day,
        attempt_count: dayStats?.attempts ?? 0,
        accuracy: dayStats && dayStats.attempts > 0 
          ? Math.round((dayStats.correct / dayStats.attempts) * 100) 
          : null,
        avg_seconds_per_question: dayStats && dayStats.attempts > 0
          ? Math.round(dayStats.totalTimeMs / dayStats.attempts / 1000)
          : null,
      };
    });

    return res.json({ 
      days: enrichedDays,
      streak: streakResult,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});

calendarRouter.patch("/day/complete", async (_req: AuthenticatedRequest, res: Response) => {
  return res.status(410).json({ 
    error: "Completion is session-derived. Start a study session to count progress.",
    message: "Manual completion override has been removed. Completion minutes are now computed from practice_sessions automatically."
  });
});

calendarRouter.post("/generate", async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Auth is enforced by server/index.ts:
    // app.use("/api/calendar", requireSupabaseAuth, requireStudentOrAdmin, calendarRouter);
    // Therefore, we must rely on req.user for determinism (no JWT decode checks).
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { start_date, days, user_id } = req.body ?? {};

    // Default: generate for the logged-in student.
    // Admins may optionally generate for a specific user_id.
    const userId =
      req.user.role === "admin" && typeof user_id === "string"
        ? user_id
        : req.user.id;

    if (!start_date || !isIsoDate(start_date)) {
      return res.status(400).json({ error: "start_date must be YYYY-MM-DD" });
    }
    if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 30) {
      return res.status(400).json({ error: "days must be an integer between 1 and 30" });
    }

    const { data: profile, error: profileError } = await supabaseServer
      .from("student_study_profile")
      .select("daily_minutes, baseline_score, target_score, exam_date, timezone")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ error: "Failed to load study profile", details: profileError.message });
    }
    if (!profile) {
      return res.status(400).json({ error: "Study profile not found. Please create a profile first." });
    }

    const dailyMinutes = profile.daily_minutes ?? 30;
    const baselineScore = profile.baseline_score ?? 1000;
    const targetScore = profile.target_score ?? 1400;
    const timezone = profile.timezone ?? "America/Chicago";

    const masterySummary = await getMasterySummary(userId);
    const weaknesses = await getWeakestSkills({ userId, limit: 10, minAttempts: 2 });

    const startDt = DateTime.fromISO(start_date);
    const endDt = startDt.plus({ days: days - 1 });
    const endDateStr = endDt.toISODate()!;

    let llmPlan: LLMStudyPlan | null = null;
    const useLLM = isV4GeminiEnabled();

    if (useLLM) {
      try {
        const masteryVector = masterySummary.map(s => ({
          section: s.section,
          accuracy: Math.round(s.overallAccuracy * 100),
          domains: s.domainBreakdown.map(d => ({
            name: d.domain,
            accuracy: Math.round(d.accuracy * 100),
            attempts: d.attempts,
          })),
        }));

        const weakSkillsList = weaknesses.slice(0, 8).map(w => ({
          skill: w.skill,
          section: w.section,
          domain: w.domain,
          accuracy: Math.round(w.accuracy * 100),
        }));

        const llmPrompt = `You are an SAT study plan generator. Create a structured study plan.

INPUTS:
- Exam: Digital SAT
- Current Score: ${baselineScore}
- Target Score: ${targetScore}
- Daily Available Minutes: ${dailyMinutes}
- Plan Start Date: ${start_date}
- Plan End Date: ${endDateStr}
- Number of Days: ${days}
- Cadence: 6 study days per week, 1 rest day (Sunday)

MASTERY DATA:
${JSON.stringify(masteryVector, null, 2)}

WEAKEST SKILLS (prioritize these):
${JSON.stringify(weakSkillsList, null, 2)}

RULES:
1. Each day must have focus_skills based on weak areas
2. Block types: "practice" (new questions), "review" (missed questions), "flashcards" (concepts), "full_test" (timed section)
3. Rest days (Sundays) should have 0 planned_minutes and empty blocks
4. Distribute practice across both Math and Reading & Writing sections
5. Prioritize skills with lowest accuracy
6. Each block's minutes must sum to planned_minutes for that day

OUTPUT FORMAT (strict JSON only, no markdown):
{
  "plan_version": "llm-v1-${new Date().toISOString().split('T')[0]}",
  "start_date": "${start_date}",
  "end_date": "${endDateStr}",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "planned_minutes": number,
      "focus_skills": ["skill1", "skill2"],
      "blocks": [
        {
          "type": "practice",
          "minutes": number,
          "skills": ["skill1"],
          "instructions": "Brief instruction"
        }
      ]
    }
  ]
}`;

        llmPlan = await generateJson(llmPrompt, LLMStudyPlanSchema, "gemini-2.0-flash");
        console.log("[calendar] LLM generated study plan:", JSON.stringify({ days: llmPlan.days.length }, null, 2));
      } catch (llmError: any) {
        console.warn("[calendar] LLM plan generation failed, falling back to heuristic:", llmError?.message);
      }
    }

    const { data: existingDays } = await supabaseServer
      .from("student_study_plan_days")
      .select("day_date, plan_version")
      .eq("user_id", userId)
      .gte("day_date", start_date)
      .lte("day_date", endDateStr);

    const existingVersionMap = new Map<string, number>();
    if (existingDays) {
      for (const row of existingDays) {
        existingVersionMap.set(row.day_date, row.plan_version ?? 0);
      }
    }

    const now = new Date().toISOString();
    const planDays: Array<{
      user_id: string;
      day_date: string;
      planned_minutes: number;
      focus: any;
      tasks: any;
      plan_version: number;
      generated_at: string;
    }> = [];

    if (llmPlan && llmPlan.days.length > 0) {
      for (const llmDay of llmPlan.days) {
        const existingVersion = existingVersionMap.get(llmDay.date) ?? 0;
        const newVersion = existingVersion + 1;

        const mathSkills = llmDay.focus_skills.filter(s => 
          s.toLowerCase().includes('algebra') || 
          s.toLowerCase().includes('geometry') || 
          s.toLowerCase().includes('math') ||
          s.toLowerCase().includes('problem_solving') ||
          s.toLowerCase().includes('advanced_math')
        );
        const rwSkills = llmDay.focus_skills.filter(s => !mathSkills.includes(s));

        const totalSkills = llmDay.focus_skills.length || 1;
        const mathWeight = mathSkills.length / totalSkills;
        const rwWeight = rwSkills.length / totalSkills;

        const focus: Array<{ section: string; competencies: string[]; weight: number }> = [];
        if (mathSkills.length > 0) {
          focus.push({ section: "Math", competencies: mathSkills, weight: mathWeight || 0.5 });
        }
        if (rwSkills.length > 0) {
          focus.push({ section: "Reading & Writing", competencies: rwSkills, weight: rwWeight || 0.5 });
        }
        if (focus.length === 0) {
          focus.push({ section: "Math", competencies: [], weight: 0.6 });
          focus.push({ section: "Reading & Writing", competencies: [], weight: 0.4 });
        }

        const tasks = llmDay.blocks.map(block => {
          const blockMathSkills = block.skills.filter(s => 
            s.toLowerCase().includes('algebra') || 
            s.toLowerCase().includes('geometry') || 
            s.toLowerCase().includes('math') ||
            s.toLowerCase().includes('problem_solving') ||
            s.toLowerCase().includes('advanced_math')
          );
          const isMath = blockMathSkills.length > block.skills.length / 2;
          
          return {
            type: block.type,
            section: isMath ? 'Math' : 'Reading & Writing',
            mode: block.type === 'review' ? 'review' : (block.type === 'flashcards' ? 'concept' : 'weakness'),
            minutes: block.minutes,
            instructions: block.instructions,
            skills: block.skills,
          };
        });

        planDays.push({
          user_id: userId,
          day_date: llmDay.date,
          planned_minutes: llmDay.planned_minutes,
          focus,
          tasks,
          plan_version: newVersion,
          generated_at: now,
        });
      }
    } else {
      let focus: Array<{ section: string; competencies?: string[]; weight: number }> = [];
      let tasks: Array<{ type: string; section: string; mode: string; minutes: number }> = [];

      if (weaknesses.length > 0) {
        const mathWeaknesses = weaknesses.filter(w => 
          w.section?.toLowerCase() === 'math' || w.skill?.startsWith('math.')
        );
        const rwWeaknesses = weaknesses.filter(w => 
          w.section?.toLowerCase().includes('reading') || 
          w.section?.toLowerCase() === 'rw' ||
          w.skill?.startsWith('rw.')
        );

        const mathCompetencies = mathWeaknesses.slice(0, 3).map(w => w.skill);
        const rwCompetencies = rwWeaknesses.slice(0, 3).map(w => w.skill);

        const hasMathWeakness = mathCompetencies.length > 0;
        const hasRwWeakness = rwCompetencies.length > 0;

        const mathWeight = hasMathWeakness && hasRwWeakness ? 0.6 : (hasMathWeakness ? 1.0 : 0);
        const rwWeight = hasMathWeakness && hasRwWeakness ? 0.4 : (hasRwWeakness ? 1.0 : 0);

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

      for (let i = 0; i < days; i++) {
        const dayDateStr = startDt.plus({ days: i }).toISODate()!;

        const existingVersion = existingVersionMap.get(dayDateStr) ?? 0;
        const newVersion = existingVersion + 1;

        planDays.push({
          user_id: userId,
          day_date: dayDateStr,
          planned_minutes: dailyMinutes,
          focus,
          tasks,
          plan_version: newVersion,
          generated_at: now,
        });
      }
    }

    const { error: upsertError } = await supabaseServer
      .from("student_study_plan_days")
      .upsert(planDays, { onConflict: "user_id,day_date" });

    if (upsertError) {
      return res.status(500).json({ error: "Failed to save study plan", details: upsertError.message });
    }

    console.log("[calendar] Generated plan:", { 
      userId: userId.slice(0, 8) + "...",
      start_date, 
      end_date: endDateStr, 
      days: planDays.length,
      usedLLM: !!llmPlan,
    });

    return res.json({
      generated: {
        start_date,
        end_date: endDateStr,
        days: planDays.length,
        used_llm: !!llmPlan,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Unexpected error", details: err?.message || String(err) });
  }
});
