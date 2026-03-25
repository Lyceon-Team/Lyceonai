export interface StudyProfile {
  user_id: string;
  baseline_score: number | null;
  target_score: number | null;
  exam_date: string | null;
  daily_minutes: number | null;
  timezone: string | null;
  planner_mode?: "auto" | "custom" | null;
  full_test_cadence?: "weekly" | "biweekly" | "none" | null;
  preferred_study_days?: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface StudyPlanDay {
  day_date: string;
  planned_minutes: number;
  completed_minutes: number | null;
  status: string | null;
  focus: Array<{ section: string; weight: number }> | null;
  tasks: CalendarTask[] | null;
  plan_version: number;
  generated_at: string;
  created_at: string;
  updated_at: string;
  is_user_override?: boolean;
  is_exam_day?: boolean;
  is_taper_day?: boolean;
  is_full_test_day?: boolean;
  status_canonical?: string | null;
}

export interface CalendarTask {
  id: string;
  type: string;
  section: string | null;
  mode: string;
  minutes: number;
  task_type?: string;
  status?: "planned" | "in_progress" | "completed" | "skipped" | "missed";
  ordinal?: number;
  is_user_override?: boolean;
  planner_owned?: boolean;
}

export async function getCalendarProfile(): Promise<StudyProfile | null> {
  const response = await fetch('/api/calendar/profile', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch calendar profile');
  }
  const data = await response.json();
  return data.profile ?? null;
}

export async function saveCalendarProfile(profile: {
  baseline_score?: number | null;
  target_score?: number | null;
  exam_date?: string | null;
  daily_minutes?: number | null;
  timezone?: string | null;
}): Promise<StudyProfile> {
  const response = await fetch('/api/calendar/profile', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save calendar profile');
  }
  const data = await response.json();
  return data.profile;
}

export interface CalendarMonthResponse {
  days: StudyPlanDay[];
  streak: { current: number; longest: number };
}

export async function getCalendarMonth(start: string, end: string): Promise<CalendarMonthResponse> {
  const response = await fetch(`/api/calendar/month?start=${start}&end=${end}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch calendar month');
  }
  const data = await response.json();
  return {
    days: data.days ?? [],
    streak: data.streak ?? { current: 0, longest: 0 },
  };
}

export async function generateCalendarPlan(startDate: string, days = 28): Promise<any> {
  const response = await fetch('/api/calendar/generate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: startDate, days }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Failed to generate plan');
  }
  return data;
}

export async function refreshCalendarPlan(startDate: string, days = 28): Promise<any> {
  const response = await fetch('/api/calendar/refresh/auto', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: startDate, days }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Failed to refresh plan');
  }
  return data;
}

export async function regenerateCalendarPlan(startDate: string, days = 28): Promise<any> {
  const response = await fetch('/api/calendar/regenerate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: startDate, days }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Failed to regenerate plan');
  }
  return data;
}

export async function updateCalendarDay(
  dayDate: string,
  payload: {
    planned_minutes: number;
    focus?: Array<{ section: string; weight: number; competencies?: string[] }>;
    tasks: Array<{ type: string; section: string; mode: string; minutes: number; status?: string }>;
  },
): Promise<any> {
  const response = await fetch(`/api/calendar/day/${dayDate}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Failed to update day');
  }
  return data;
}

export async function regenerateCalendarDay(dayDate: string): Promise<any> {
  const response = await fetch(`/api/calendar/day/${dayDate}/regenerate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to regenerate day");
  }
  return data;
}

export async function resetCalendarDayToAuto(dayDate: string): Promise<any> {
  const response = await fetch(`/api/calendar/day/${dayDate}/reset-to-auto`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to reset day to auto");
  }
  return data;
}

export async function updateCalendarTaskStatus(
  dayDate: string,
  taskId: string,
  status: "planned" | "in_progress" | "completed" | "skipped" | "missed",
): Promise<any> {
  const response = await fetch(`/api/calendar/day/${dayDate}/tasks/${taskId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to update task status");
  }
  return data;
}
