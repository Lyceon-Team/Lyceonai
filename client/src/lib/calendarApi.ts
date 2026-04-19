import { csrfFetch } from "./csrf";
import { parseApiErrorFromResponse } from "./api-error";

export type CalendarTaskType =
  | "practice"
  | "focused_drill"
  | "review_practice"
  | "review_full_length"
  | "full_length"
  | "tutor_support";

export interface BlockedWindow {
  date?: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  reason?: string;
}

export interface StudyProfile {
  user_id: string;
  baseline_score: number | null;
  target_score: number | null;
  exam_date: string | null;
  daily_minutes: number | null;
  timezone: string | null;
  planner_mode?: "auto" | "custom" | null;
  full_test_cadence?: "weekly" | "biweekly" | "none" | null;
  study_days_of_week?: number[] | null;
  preferred_study_days?: number[] | null;
  blocked_weekdays?: number[] | null;
  blocked_dates?: string[] | null;
  blocked_windows?: BlockedWindow[] | null;
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
  replaces_override?: boolean;
  replaced_override_day_id?: string | null;
  replacement_source?: string | null;
  replacement_at?: string | null;
}

export interface CalendarTaskTarget {
  section: string | null;
  skill_code: string | null;
  domain: string | null;
  subskill: string | null;
  target_type?: "practice_target" | "review_session" | "scheduled_full_length" | null;
  review_session_id?: string | null;
  exam_id?: string | null;
}

export interface CalendarTask {
  id: string;
  type: CalendarTaskType;
  section: string | null;
  mode: string;
  minutes: number;
  task_type?: CalendarTaskType;
  target?: CalendarTaskTarget;
  source_skill_code?: string | null;
  source_domain?: string | null;
  source_subskill?: string | null;
  source_reason?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  status?: "planned" | "in_progress" | "completed" | "skipped" | "missed";
  ordinal?: number;
  is_user_override?: boolean;
  planner_owned?: boolean;
  replaces_override?: boolean;
  replaced_override_task_id?: string | null;
  replacement_source?: string | null;
  replacement_at?: string | null;
  override_target_type?: "practice_target" | "review_session" | "scheduled_full_length" | null;
  override_target_domain?: string | null;
  override_target_skill?: string | null;
  override_target_session_id?: string | null;
  override_target_exam_id?: string | null;
}

export async function getCalendarProfile(): Promise<StudyProfile | null> {
  const response = await csrfFetch('/api/calendar/profile', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, 'Failed to fetch calendar profile');
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
  study_days_of_week?: number[] | null;
  preferred_study_days?: number[] | null;
  blocked_weekdays?: number[] | null;
  blocked_dates?: string[] | null;
  blocked_windows?: BlockedWindow[] | null;
}): Promise<StudyProfile> {
  const response = await csrfFetch('/api/calendar/profile', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, 'Failed to save calendar profile');
  }
  const data = await response.json();
  return data.profile;
}

export interface CalendarMonthResponse {
  days: StudyPlanDay[];
  streak: { current: number; longest: number };
}

export async function getCalendarMonth(start: string, end: string): Promise<CalendarMonthResponse> {
  const response = await csrfFetch(`/api/calendar/month?start=${start}&end=${end}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, 'Failed to fetch calendar month');
  }
  const data = await response.json();
  return {
    days: data.days ?? [],
    streak: data.streak ?? { current: 0, longest: 0 },
  };
}

export async function generateCalendarPlan(startDate: string, days = 28): Promise<any> {
  const response = await csrfFetch('/api/calendar/generate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: startDate, days }),
  });
  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, 'Failed to generate plan');
  }
  const data = await response.json().catch(() => ({}));
  return data;
}

export async function refreshCalendarPlan(startDate: string, days = 28): Promise<any> {
  const response = await csrfFetch('/api/calendar/refresh/auto', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: startDate, days }),
  });
  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, 'Failed to refresh plan');
  }
  const data = await response.json().catch(() => ({}));
  return data;
}

export async function regenerateCalendarPlan(startDate: string, days = 28): Promise<any> {
  const response = await csrfFetch('/api/calendar/regenerate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: startDate, days }),
  });
  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, 'Failed to regenerate plan');
  }
  const data = await response.json().catch(() => ({}));
  return data;
}

export async function updateCalendarDay(
  dayDate: string,
  payload: {
    planned_minutes: number;
    focus?: Array<{ section: string; weight: number; competencies?: string[] }>;
    tasks: Array<{
      type?: string;
      task_type?: string;
      section: string;
      mode: string;
      minutes: number;
      status?: string;
      target?: CalendarTaskTarget;
      override_target_type?: "practice_target" | "review_session" | "scheduled_full_length" | null;
      override_target_domain?: string | null;
      override_target_skill?: string | null;
      override_target_session_id?: string | null;
      override_target_exam_id?: string | null;
      source_skill_code?: string | null;
      source_domain?: string | null;
      source_subskill?: string | null;
      source_reason?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      replaces_override?: boolean;
      replaced_override_task_id?: string | null;
      replacement_source?: string | null;
      replacement_at?: string | null;
    }>;
  },
): Promise<any> {
  const response = await csrfFetch(`/api/calendar/day/${dayDate}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, 'Failed to update day');
  }
  const data = await response.json().catch(() => ({}));
  return data;
}

export async function regenerateCalendarDay(dayDate: string): Promise<any> {
  const response = await csrfFetch(`/api/calendar/day/${dayDate}/regenerate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, "Failed to regenerate day");
  }
  const data = await response.json().catch(() => ({}));
  return data;
}

export async function resetCalendarDayToAuto(dayDate: string): Promise<any> {
  const response = await csrfFetch(`/api/calendar/day/${dayDate}/reset-to-auto`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, "Failed to reset day to auto");
  }
  const data = await response.json().catch(() => ({}));
  return data;
}

export async function updateCalendarTaskStatus(
  dayDate: string,
  taskId: string,
  status: "planned" | "in_progress" | "completed" | "skipped" | "missed",
): Promise<any> {
  const response = await csrfFetch(`/api/calendar/day/${dayDate}/tasks/${taskId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, "Failed to update task status");
  }
  const data = await response.json().catch(() => ({}));
  return data;
}
