import { useState, useMemo, useEffect, useCallback } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChevronLeft, ChevronRight, Loader2, Plus, Play, Flame, AlertCircle, RefreshCw, Settings } from "lucide-react";
import { TripleProgressRing } from "@/components/progress/TripleProgressRing";
import { useLocation } from "wouter";
import { PremiumUpgradePrompt } from "@/components/billing/PremiumUpgradePrompt";
import { AppNotice } from "@/components/feedback/AppNotice";
import { RecoveryNotice } from "@/components/feedback/RecoveryNotice";
import { SessionNotice } from "@/components/feedback/SessionNotice";
import { getPremiumDenialReason, isSessionError, isTransportError, toUserFacingMessage } from "@/lib/api-error";
import {
  getCalendarProfile,
  saveCalendarProfile,
  getCalendarMonth,
  refreshCalendarPlan,
  regenerateCalendarPlan,
  updateCalendarDay,
  regenerateCalendarDay,
  resetCalendarDayToAuto,
  updateCalendarTaskStatus,
  type StudyProfile,
  type StudyPlanDay,
  type CalendarTask,
} from "@/lib/calendarApi";

type DayStatus = "planned" | "missed" | "in_progress" | "complete";

interface CalendarDay {
  dateKey: string;
  day: number;
  isCurrentMonth: boolean;
  plannedMin: number;
  completedMin: number;
  status: DayStatus;
  pct: number;
  mathPct: number;
  rwPct: number;
  focus: Array<{ section: string; weight: number; competencies?: string[] }> | null;
  tasks: CalendarTask[] | null;
  isUserOverride: boolean;
  replacesOverride: boolean;
  replacedOverrideDayId: string | null;
  replacementSource: string | null;
  replacementAt: string | null;
}

function getStatusBadge(status: DayStatus, completedMin: number, plannedMin: number): { label: string; className: string } {
  switch (status) {
    case "planned":
      return { label: "Planned", className: "bg-muted text-muted-foreground" };
    case "missed":
      return { label: "Missed", className: "bg-amber-100 text-amber-800" };
    case "in_progress":
      return { label: "In Progress", className: "bg-teal-100 text-teal-700" };
    case "complete":
      if (completedMin > plannedMin) {
        return { label: "Exceeded", className: "bg-green-600 text-white" };
      }
      return { label: "Complete", className: "bg-teal-500 text-white" };
    default:
      return { label: "Unknown", className: "bg-muted text-muted-foreground" };
  }
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDateKeyInTimeZone(timeZone: string | null | undefined, date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function isDateBeforeToday(dateKey: string, todayDateKey: string): boolean {
  return dateKey < todayDateKey;
}

function buildMonthGrid(year: number, month: number): Array<{ dateKey: string; day: number; isCurrentMonth: boolean }> {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const grid: Array<{ dateKey: string; day: number; isCurrentMonth: boolean }> = [];

  for (let i = 0; i < startWeekday; i++) {
    const prevDate = new Date(year, month, -startWeekday + i + 1);
    grid.push({
      dateKey: formatDateKey(prevDate),
      day: prevDate.getDate(),
      isCurrentMonth: false,
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    grid.push({
      dateKey: formatDateKey(new Date(year, month, d)),
      day: d,
      isCurrentMonth: true,
    });
  }

  const remaining = 42 - grid.length;
  for (let i = 1; i <= remaining; i++) {
    const nextDate = new Date(year, month + 1, i);
    grid.push({
      dateKey: formatDateKey(nextDate),
      day: nextDate.getDate(),
      isCurrentMonth: false,
    });
  }

  return grid;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const [profile, setProfile] = useState<StudyProfile | null | undefined>(undefined);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<unknown>(null);
  const [monthData, setMonthData] = useState<StudyPlanDay[]>([]);
  const [streak, setStreak] = useState<{ current: number; longest: number }>({ current: 0, longest: 0 });
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [monthErrorObj, setMonthErrorObj] = useState<unknown>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const monthGrid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const todayDateKey = useMemo(() => getDateKeyInTimeZone(profile?.timezone), [profile?.timezone]);

  const gridStartDate = monthGrid[0]?.dateKey ?? formatDateKey(new Date(year, month, 1));
  const gridEndDate = monthGrid[monthGrid.length - 1]?.dateKey ?? formatDateKey(new Date(year, month + 1, 0));

  useEffect(() => {
    setProfileLoading(true);
    getCalendarProfile()
      .then((p) => {
        setProfileLoadError(null);
        setProfile(p);
      })
      .catch((error) => {
        setProfileLoadError(error);
        setProfile(null);
      })
      .finally(() => setProfileLoading(false));
  }, []);

  const loadMonthData = useCallback(async () => {
    if (!profile) return;
    setMonthLoading(true);
    setMonthError(null);
    setMonthErrorObj(null);
    try {
      const response = await getCalendarMonth(gridStartDate, gridEndDate);
      setMonthData(response.days);
      setStreak(response.streak);
    } catch (err: any) {
      setMonthErrorObj(err);
      setMonthError(err?.message || "Failed to load calendar data");
      setMonthData([]);
      setStreak({ current: 0, longest: 0 });
    } finally {
      setMonthLoading(false);
    }
  }, [profile, gridStartDate, gridEndDate]);

  useEffect(() => {
    if (profile) {
      loadMonthData();
    }
  }, [profile, loadMonthData]);

  const monthDataMap = useMemo(() => {
    const map = new Map<string, StudyPlanDay>();
    for (const d of monthData) {
      map.set(d.day_date, d);
    }
    return map;
  }, [monthData]);

  const calendarDays: CalendarDay[] = useMemo(() => {
    return monthGrid.map((cell) => {
      const plan = monthDataMap.get(cell.dateKey);
      const plannedMin = plan?.planned_minutes ?? 0;
      const completedMin = plan?.completed_minutes ?? 0;
      let status: DayStatus = "planned";
      if (plan?.status) {
        status = plan.status as DayStatus;
      } else if (plannedMin > 0) {
        if (completedMin === 0) status = "missed";
        else if (completedMin < plannedMin) status = "in_progress";
        else status = "complete";
      }
      const pct = plannedMin <= 0 ? 0 : Math.min(100, Math.round((completedMin / plannedMin) * 100));

      const tasks = plan?.tasks ?? [];
      const mathTask = tasks.find((t) => t.section === "Math");
      const rwTask = tasks.find((t) => t.section === "Reading & Writing");
      const mathPlanned = mathTask?.minutes ?? 0;
      const rwPlanned = rwTask?.minutes ?? 0;
      const mathCompleted = Math.round(completedMin * (mathPlanned / (plannedMin || 1)));
      const rwCompleted = Math.round(completedMin * (rwPlanned / (plannedMin || 1)));
      const mathPct = mathPlanned > 0 ? Math.min(100, Math.round((mathCompleted / mathPlanned) * 100)) : 0;
      const rwPct = rwPlanned > 0 ? Math.min(100, Math.round((rwCompleted / rwPlanned) * 100)) : 0;

      return {
        dateKey: cell.dateKey,
        day: cell.day,
        isCurrentMonth: cell.isCurrentMonth,
        plannedMin,
        completedMin,
        status,
        pct,
        mathPct,
        rwPct,
        focus: plan?.focus ?? null,
        tasks: plan?.tasks ?? null,
        isUserOverride: Boolean(plan?.is_user_override),
        replacesOverride: Boolean(plan?.replaces_override),
        replacedOverrideDayId: plan?.replaced_override_day_id ?? null,
        replacementSource: plan?.replacement_source ?? null,
        replacementAt: plan?.replacement_at ?? null,
      };
    });
  }, [monthGrid, monthDataMap]);

  const selectedDay = selectedDateKey ? calendarDays.find((d) => d.dateKey === selectedDateKey) ?? null : null;

  const monthLabel = currentMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    setSelectedDateKey(null);
    setMonthError(null);
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    setSelectedDateKey(null);
    setMonthError(null);
  };

  const handleRefreshPlan = async () => {
    if (!profile) return;
    setActionLoading(true);
    setMonthError(null);
    setMonthErrorObj(null);
    try {
      await refreshCalendarPlan(gridStartDate, 28);
      await loadMonthData();
    } catch (err: any) {
      setMonthErrorObj(err);
      setMonthError(err?.message || "Failed to refresh plan");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegeneratePlan = async () => {
    if (!profile) return;
    const confirmed = window.confirm("Regenerate will rebuild future plan days, including user overrides. Continue?");
    if (!confirmed) return;
    setActionLoading(true);
    setMonthError(null);
    setMonthErrorObj(null);
    try {
      await regenerateCalendarPlan(gridStartDate, 28);
      await loadMonthData();
    } catch (err: any) {
      setMonthErrorObj(err);
      setMonthError(err?.message || "Failed to regenerate plan");
    } finally {
      setActionLoading(false);
    }
  };

  const handleQuickEditSettings = async () => {
    if (!profile) return;
    const dailyMinutesInput = window.prompt("Daily study minutes", String(profile.daily_minutes ?? 30));
    if (dailyMinutesInput == null) return;
    const parsedMinutes = Math.max(10, Math.min(240, parseInt(dailyMinutesInput, 10) || 30));
    const examDateInput = window.prompt("Exam date (YYYY-MM-DD, optional)", profile.exam_date ?? "");
    if (examDateInput == null) return;

    setActionLoading(true);
    setMonthError(null);
    setMonthErrorObj(null);
    try {
      const updated = await saveCalendarProfile({
        daily_minutes: parsedMinutes,
        exam_date: examDateInput.trim() ? examDateInput.trim() : null,
      });
      setProfile(updated);
      await loadMonthData();
    } catch (err: any) {
      setMonthErrorObj(err);
      setMonthError(err?.message || "Failed to update settings");
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditDay = async (day: CalendarDay) => {
    if (isDateBeforeToday(day.dateKey, todayDateKey)) {
      setMonthError("Past days are immutable.");
      return;
    }
    const nextMinutesInput = window.prompt("Planned minutes for this day", String(day.plannedMin || 30));
    if (nextMinutesInput == null) return;
    const nextMinutes = Math.max(0, parseInt(nextMinutesInput, 10) || 0);
    const currentTask = day.tasks?.[0];
    const currentKind =
      currentTask?.task_type === "full_length"
        ? "full_length"
        : currentTask?.task_type === "review_practice" || currentTask?.task_type === "review_full_length"
          ? "review"
          : "practice";
    const taskKindInput = window.prompt("Override task type (practice/review/full_length)", currentKind);
    if (taskKindInput == null) return;
    const taskKindNormalized = taskKindInput.trim().toLowerCase();
    const taskKind: "practice" | "review" | "full_length" =
      taskKindNormalized === "full_length" || taskKindNormalized === "full-length"
        ? "full_length"
        : taskKindNormalized === "review"
          ? "review"
          : "practice";

    let section = currentTask?.section ?? "Math";
    let taskType: "practice" | "review_practice" | "full_length";
    let mode: string;
    const target: {
      section: string | null;
      domain: string | null;
      skill_code: string | null;
      subskill: string | null;
      target_type: "practice_target" | "review_session" | "scheduled_full_length";
      review_session_id: string | null;
      exam_id: string | null;
    } = {
      section: null,
      domain: null,
      skill_code: null,
      subskill: null,
      target_type: "practice_target",
      review_session_id: null,
      exam_id: null,
    };

    if (taskKind === "practice") {
      const sectionInput = window.prompt("Practice section (Math/RW)", section);
      if (sectionInput == null) return;
      section = sectionInput.toLowerCase().includes("rw") ? "Reading & Writing" : "Math";
      target.section = section === "Math" ? "MATH" : "RW";
      taskType = "practice";
      mode = "focused";
      const domainInput = window.prompt("Practice target domain (required)", currentTask?.target?.domain ?? "");
      if (domainInput == null) return;
      const skillInput = window.prompt("Practice target skill code (required)", currentTask?.target?.skill_code ?? "");
      if (skillInput == null) return;
      target.domain = domainInput.trim() || null;
      target.skill_code = skillInput.trim() || null;
      target.target_type = "practice_target";
      if (!target.domain && !target.skill_code) {
        setMonthError("Practice overrides require a domain or skill target.");
        return;
      }
    } else if (taskKind === "review") {
      taskType = "review_practice";
      section = "";
      mode = "review";
      target.target_type = "review_session";
      const reviewSessionId = window.prompt("Review session ID (required)", currentTask?.target?.review_session_id ?? "");
      if (reviewSessionId == null) return;
      target.review_session_id = reviewSessionId.trim() || null;
      if (!target.review_session_id) {
        setMonthError("Review overrides require an exact review session ID.");
        return;
      }
    } else {
      taskType = "full_length";
      section = "";
      mode = "full-length";
      target.target_type = "scheduled_full_length";
      const examId = window.prompt("Full-length exam ID (required)", currentTask?.target?.exam_id ?? "");
      if (examId == null) return;
      target.exam_id = examId.trim() || null;
      if (!target.exam_id) {
        setMonthError("Full-length overrides require a scheduled exam ID.");
        return;
      }
    }

    const tasks = [
      {
        type: taskType,
        task_type: taskType,
        section,
        mode,
        minutes: nextMinutes,
        status: currentTask?.status ?? "planned",
        target,
        override_target_type: target.target_type,
        override_target_domain: target.domain,
        override_target_skill: target.skill_code,
        override_target_session_id: target.review_session_id,
        override_target_exam_id: target.exam_id,
      },
    ];

    setActionLoading(true);
    setMonthError(null);
    setMonthErrorObj(null);
    try {
      await updateCalendarDay(day.dateKey, {
        planned_minutes: nextMinutes,
        focus: day.focus ?? [],
        tasks,
      });
      await loadMonthData();
    } catch (err: any) {
      setMonthErrorObj(err);
      setMonthError(err?.message || "Failed to update day");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegenerateDay = async (day: CalendarDay) => {
    if (isDateBeforeToday(day.dateKey, todayDateKey)) {
      setMonthError("Past days are immutable.");
      return;
    }
    setActionLoading(true);
    setMonthError(null);
    setMonthErrorObj(null);
    try {
      await regenerateCalendarDay(day.dateKey);
      await loadMonthData();
    } catch (err: any) {
      setMonthErrorObj(err);
      setMonthError(err?.message || "Failed to regenerate day");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetDayToAuto = async (day: CalendarDay) => {
    if (isDateBeforeToday(day.dateKey, todayDateKey)) {
      setMonthError("Past days are immutable.");
      return;
    }
    setActionLoading(true);
    setMonthError(null);
    setMonthErrorObj(null);
    try {
      await resetCalendarDayToAuto(day.dateKey);
      await loadMonthData();
    } catch (err: any) {
      setMonthErrorObj(err);
      setMonthError(err?.message || "Failed to reset day");
    } finally {
      setActionLoading(false);
    }
  };

  const handleTaskStatusChange = async (
    day: CalendarDay,
    taskId: string,
    nextStatus: "planned" | "in_progress" | "completed" | "skipped" | "missed",
  ) => {
    if (isDateBeforeToday(day.dateKey, todayDateKey)) {
      setMonthError("Past days are immutable.");
      return;
    }
    setActionLoading(true);
    setMonthError(null);
    setMonthErrorObj(null);
    try {
      await updateCalendarTaskStatus(day.dateKey, taskId, nextStatus);
      await loadMonthData();
    } catch (err: any) {
      setMonthErrorObj(err);
      setMonthError(err?.message || "Failed to update task status");
    } finally {
      setActionLoading(false);
    }
  };

  if (profileLoading) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 py-6 flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  const profilePremiumReason = getPremiumDenialReason(profileLoadError);
  if (profilePremiumReason) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <PremiumUpgradePrompt reason={profilePremiumReason} mode="inline" />
        </div>
      </AppShell>
    );
  }

  if (profileLoadError && !profilePremiumReason) {
    const profileErrorMessage =
      profileLoadError instanceof Error ? profileLoadError.message : "Failed to load calendar profile.";
    const profileNoticeMessage = isTransportError(profileLoadError)
      ? profileErrorMessage
      : toUserFacingMessage(profileLoadError).message;
    return (
      <AppShell>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {isSessionError(profileLoadError) ? (
            <SessionNotice
              message={profileNoticeMessage}
              onRefreshSession={() => window.location.reload()}
            />
          ) : (
            <RecoveryNotice
              message={profileNoticeMessage}
              onRetry={() => window.location.reload()}
              retryLabel="Retry"
            />
          )}
        </div>
      </AppShell>
    );
  }

  if (profile === null) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <ProfileSetupPanel onSave={(p) => setProfile(p)} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2">Study Plan</p>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Academic Projection</h1>
            <p className="text-sm text-muted-foreground mt-1">Live calendar generated from your profile, progress, and plan services.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button variant="outline" size="sm" onClick={handleQuickEditSettings} disabled={actionLoading}>
              <Settings className="h-4 w-4 mr-2" />
              Edit Settings
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefreshPlan} disabled={actionLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${actionLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleRegeneratePlan} disabled={actionLoading}>
              Regenerate
            </Button>
            <Button variant="outline" size="icon" onClick={handlePrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[140px] text-center">{monthLabel}</span>
            <Button variant="outline" size="icon" onClick={handleNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {monthLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {(() => {
          const monthPremiumReason = getPremiumDenialReason(monthErrorObj);
          if (monthPremiumReason && !monthLoading) {
            return (
              <div className="mb-6">
                <PremiumUpgradePrompt reason={monthPremiumReason} mode="inline" />
              </div>
            );
          }

          if (monthError && !monthLoading) {
            const monthNoticeMessage = isTransportError(monthErrorObj)
              ? monthError
              : toUserFacingMessage(monthErrorObj).message;
            return (
              isSessionError(monthErrorObj) ? (
                <SessionNotice
                  className="mb-6"
                  message={monthNoticeMessage}
                  onRefreshSession={() => window.location.reload()}
                />
              ) : (
                <RecoveryNotice
                  className="mb-6"
                  message={monthNoticeMessage}
                  onRetry={loadMonthData}
                  retryLabel="Retry"
                />
              )
            );
          }

          return null;
        })()}

        {/* Streak Display */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-orange-100 text-orange-700 px-3 py-2 rounded-lg border border-orange-200/70">
            <Flame className="h-5 w-5" />
            <span className="text-sm font-semibold">{streak.current} day streak</span>
          </div>
          <div className="text-sm text-muted-foreground bg-secondary/50 px-3 py-2 rounded-lg">
            Longest: {streak.longest} days
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <MonthGrid
              days={calendarDays}
              selectedDateKey={selectedDateKey}
              onSelectDay={setSelectedDateKey}
              todayDateKey={todayDateKey}
            />
          </div>
          <aside className="lg:col-span-5">
            <DayDetailPanel
              day={selectedDay}
              onEditDay={handleEditDay}
              onRegenerateDay={handleRegenerateDay}
              onResetDayToAuto={handleResetDayToAuto}
              onTaskStatusChange={handleTaskStatusChange}
              actionLoading={actionLoading}
              todayDateKey={todayDateKey}
            />
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function ProfileSetupPanel({ onSave }: { onSave: (profile: StudyProfile) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dailyMinutes, setDailyMinutes] = useState(30);
  const [baselineScore, setBaselineScore] = useState<string>("");
  const [targetScore, setTargetScore] = useState<string>("");
  const [examDate, setExamDate] = useState<string>("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
      const profile = await saveCalendarProfile({
        daily_minutes: dailyMinutes,
        baseline_score: baselineScore ? parseInt(baselineScore, 10) : null,
        target_score: targetScore ? parseInt(targetScore, 10) : null,
        exam_date: examDate || null,
        timezone,
      });
      onSave(profile);
    } catch (err: any) {
      setError(err?.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-card rounded-xl border border-border/60 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2">Initial Setup</p>
        <h2 className="text-xl font-semibold text-foreground mb-4">Set Up Your Study Plan</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Tell us about your goals so we can create a personalized study calendar.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="dailyMinutes">Daily Study Minutes</Label>
            <Input
              id="dailyMinutes"
              type="number"
              min={5}
              max={600}
              value={dailyMinutes}
              onChange={(e) => setDailyMinutes(parseInt(e.target.value, 10) || 30)}
            />
          </div>

          <div>
            <Label htmlFor="baselineScore">Current SAT Score (optional)</Label>
            <Input
              id="baselineScore"
              type="number"
              min={400}
              max={1600}
              placeholder="e.g., 1200"
              value={baselineScore}
              onChange={(e) => setBaselineScore(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="targetScore">Target SAT Score (optional)</Label>
            <Input
              id="targetScore"
              type="number"
              min={400}
              max={1600}
              placeholder="e.g., 1500"
              value={targetScore}
              onChange={(e) => setTargetScore(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="examDate">Exam Date (optional)</Label>
            <Input
              id="examDate"
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
            />
          </div>

          {error ? (
            <AppNotice
              variant="warning"
              mode="compact"
              title="Unable to save setup"
              message={error}
            />
          ) : null}

          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save & Continue
          </Button>
        </form>
      </div>
    </div>
  );
}

function MonthGrid({
  days,
  selectedDateKey,
  onSelectDay,
  todayDateKey,
}: {
  days: CalendarDay[];
  selectedDateKey: string | null;
  onSelectDay: (dateKey: string) => void;
  todayDateKey: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border/60 p-4">
      <div className="grid grid-cols-7 gap-1 mb-2">
        {WEEKDAYS.map((wd) => (
          <div
            key={wd}
            className="text-center text-xs font-medium text-muted-foreground py-2"
          >
            {wd}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const isSelected = selectedDateKey === d.dateKey;
          const isToday = d.dateKey === todayDateKey;

          return (
            <button
              key={d.dateKey}
              onClick={() => d.isCurrentMonth && onSelectDay(d.dateKey)}
              disabled={!d.isCurrentMonth}
              aria-label={`Open day ${d.dateKey}`}
              className={`
                relative aspect-square p-1.5 rounded-md text-left transition-colors
                ${d.isCurrentMonth ? "hover:bg-secondary/70 cursor-pointer" : "cursor-default opacity-40"}
                ${isSelected && d.isCurrentMonth ? "ring-2 ring-foreground" : ""}
                ${isToday ? "bg-primary/10" : ""}
              `}
            >
              <span className={`text-xs font-medium ${d.isCurrentMonth ? "text-foreground" : "text-muted-foreground"}`}>
                {d.day}
              </span>
              {d.isCurrentMonth && (
                <>
                  <div className="absolute top-1 right-1">
                    {d.status === "planned" && d.plannedMin === 0 ? (
                      <Plus className="h-3 w-3 text-muted-foreground/50" />
                    ) : (
                      <TripleProgressRing
                        totalPct={d.pct}
                        mathPct={d.mathPct}
                        rwPct={d.rwPct}
                        status={d.status}
                        size={18}
                        strokeWidth={2}
                      />
                    )}
                  </div>
                  {d.plannedMin > 0 && (
                    <div className="absolute bottom-1 left-1 text-[10px] text-muted-foreground">
                      {d.plannedMin}m
                    </div>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayDetailPanel({
  day,
  onEditDay,
  onRegenerateDay,
  onResetDayToAuto,
  onTaskStatusChange,
  actionLoading,
  todayDateKey,
}: {
  day: CalendarDay | null;
  onEditDay: (day: CalendarDay) => void;
  onRegenerateDay: (day: CalendarDay) => void;
  onResetDayToAuto: (day: CalendarDay) => void;
  onTaskStatusChange: (
    day: CalendarDay,
    taskId: string,
    status: "planned" | "in_progress" | "completed" | "skipped" | "missed",
  ) => void;
  actionLoading: boolean;
  todayDateKey: string;
}) {
  const [, navigate] = useLocation();

  const handleStartPractice = () => {
    if (!day || !day.focus || day.focus.length === 0) return;
    const primarySection = day.focus[0].section;
    const route = primarySection === "Math" ? "/math-practice" : "/reading-writing-practice";
    navigate(`${route}?calendarDayId=${day.dateKey}`);
  };

  if (!day || !day.isCurrentMonth) {
    return (
      <div className="bg-card rounded-xl border border-border/60 p-6">
        <p className="text-muted-foreground text-sm">Select a day to view details</p>
      </div>
    );
  }

  const badge = getStatusBadge(day.status, day.completedMin, day.plannedMin);
  const dateObj = new Date(day.dateKey + "T00:00:00");
  const dateLabel = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const studiedSections =
    day.tasks?.filter((t) => t.minutes > 0 && Boolean(t.section)).map((t) => t.section as string) ?? [];
  const hasPlan = day.plannedMin > 0;
  const hasTasks = (day.tasks?.length ?? 0) > 0;
  const isPastDay = isDateBeforeToday(day.dateKey, todayDateKey);
  const canMutate = !isPastDay && !actionLoading;
  const canResetToAuto = canMutate && day.isUserOverride;

  return (
    <div className="bg-card rounded-xl border border-border/60 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{dateLabel}</h2>
        <span className={`px-2 py-1 rounded text-xs font-medium ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-secondary/50 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Planned</p>
          <p className="text-lg font-semibold text-foreground">{day.plannedMin} min</p>
        </div>
        <div className="bg-secondary/50 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Completed</p>
          <p className="text-lg font-semibold text-foreground">{day.completedMin} min</p>
        </div>
      </div>

      {day.replacesOverride && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This day replaced a prior override-owned plan row
            {day.replacementSource ? ` via ${day.replacementSource}` : ""}.
          </AlertDescription>
        </Alert>
      )}

      {studiedSections.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">Focus Areas</p>
          <div className="flex flex-wrap gap-2">
            {studiedSections.map((section) => (
              <span
                key={section}
                className="px-2 py-1 bg-teal-100 text-teal-700 rounded text-xs font-medium"
              >
                {section}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-muted/50 rounded-lg p-3 border border-border">
        <p className="text-xs text-muted-foreground">
          {day.status === "complete" && day.completedMin > day.plannedMin
            ? "Great job! You exceeded your daily goal."
            : day.status === "complete"
              ? "You met your goal for this day."
              : day.status === "in_progress"
                ? "You made progress but didn't complete your full goal."
                : day.status === "missed"
                  ? "This day was missed. Consider adjusting your schedule."
                  : "No study plan was set for this day."}
        </p>
        <p className="text-xs text-muted-foreground mt-2 italic">
          Minutes count automatically when you study.
        </p>
      </div>

      {hasTasks && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Tasks</p>
          <div className="space-y-2">
            {(day.tasks ?? []).map((task, index) => {
              const isCompleted = task.status === "completed";
              const statusLabel = task.status ?? "planned";
              const taskId = task.id;
              return (
                <div key={taskId || `${task.type}-${index}`} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {task.section || task.type}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {task.minutes} min - {statusLabel}
                    </p>
                    {task.target && (
                      <p className="text-xs text-muted-foreground">
                        Target: {task.target.target_type ?? "practice_target"}
                        {task.target.domain ? ` | ${task.target.domain}` : ""}
                        {task.target.skill_code ? ` | ${task.target.skill_code}` : ""}
                        {task.target.review_session_id ? ` | session ${task.target.review_session_id}` : ""}
                        {task.target.exam_id ? ` | exam ${task.target.exam_id}` : ""}
                      </p>
                    )}
                    {task.replaces_override && (
                      <p className="text-xs text-orange-600">
                        Replaced override task
                        {task.replacement_source ? ` via ${task.replacement_source}` : ""}.
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!taskId || !canMutate}
                    onClick={() => taskId && onTaskStatusChange(day, taskId, isCompleted ? "planned" : "completed")}
                  >
                    {isCompleted ? "Mark Planned" : "Mark Complete"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hasPlan && (
        <div className="space-y-2">
          <Button variant="outline" className="w-full" onClick={() => onEditDay(day)} disabled={!canMutate}>
            Edit This Day
          </Button>
          <Button variant="outline" className="w-full" onClick={() => onRegenerateDay(day)} disabled={!canMutate}>
            Regenerate Day
          </Button>
          <Button variant="outline" className="w-full" onClick={() => onResetDayToAuto(day)} disabled={!canResetToAuto}>
            {day.isUserOverride ? "Reset to Auto" : "Reset to Auto (already auto)"}
          </Button>
        </div>
      )}

      {hasPlan && day.status !== "complete" && (
        <Button
          className="w-full"
          onClick={handleStartPractice}
          disabled={!day.focus || day.focus.length === 0 || actionLoading}
        >
          <Play className="h-4 w-4 mr-2" />
          Start Practice
        </Button>
      )}

      {isPastDay && (
        <p className="text-xs text-muted-foreground">
          Past days are immutable.
        </p>
      )}

      {!hasPlan && (
        <p className="text-sm text-muted-foreground">
          No plan is set for this day. Plans are generated by your study schedule.
        </p>
      )}
    </div>
  );
}
