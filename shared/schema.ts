// @spec [Lyceon_Coding_Standards, §2] [Gap-Registry_V1.1, GAP-OP-05] | @implemented [2026-06-08]
// plain English: shared data-shape types for client + API surfaces — pure TypeScript
// types only, no ORM runtime. WS-1/D1 severed the Drizzle wiring: the `users` and
// `questions` pgTable objects (verified zero importers repo-wide) and the drizzle-orm
// imports were removed so the canonical schema source of truth is supabase/migrations,
// not a second ORM-defined schema. Edge case: all six importers consume only
// `import type` interfaces, so removal is type-safe and build-neutral.

export interface QuestionOption {
  key: "A" | "B" | "C" | "D";
  text: string;
}

export interface StudentQuestion {
  id: string;
  canonical_id: string | null;
  stem: string;
  section_code: "M" | "RW" | "MATH" | null;
  question_type: "multiple_choice" | "free_response";
  options: QuestionOption[];
  explanation: string | null;
  tags: string[];
  domain?: string | null;
  skill?: string | null;
  subskill?: string | null;
  skill_code?: string | null;
  difficulty?: number | null;
}

export type NotificationType =
  | "system_update"
  | "study_reminder"
  | "progress_alert"
  | "achievement"
  | "ai_tutor_suggestion";

export type NotificationCategory =
  | "study_progress"
  | "learning_analytics"
  | "question_updates"
  | "motivation"
  | "ai_tutor"
  | "technical"
  | "milestones";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  ctaUrl: string | null;
  ctaText?: string | null;
  channelOrigin: string | null;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  updatedAt?: string | null;
  message?: string;
  actionUrl?: string | null;
  actionText?: string | null;
}

export type NotificationDigestFrequency = "never" | "daily" | "weekly";

export interface UserNotificationPreferences {
  userId: string;
  emailEnabled: boolean;
  studyRemindersEnabled: boolean;
  streakEnabled: boolean;
  planUpdatesEnabled: boolean;
  guardianUpdatesEnabled: boolean;
  marketingEnabled: boolean;
  digestFrequency: NotificationDigestFrequency;
  quietHours: Record<string, unknown> | null;
  updatedAt: string | null;
}

// Full-length exam runtime types (service-owned supabase rows).
export interface FullLengthExamSession {
  id: string;
  user_id?: string;
  status: string;
  current_section?: string | null;
  current_module?: number | null;
  break_started_at?: string | null;
  test_form_id?: string | null;
  client_instance_id?: string | null;
  seed?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface FullLengthExamModule {
  id: string;
  session_id?: string;
  section?: string;
  module_index?: number;
  difficulty_bucket?: string | null;
  module1_correct_count?: number | null;
  adaptive_config_id?: string | null;
  materialized_at?: string | null;
  target_duration_ms?: number;
  started_at?: string | null;
  ends_at?: string | null;
  submitted_at?: string | null;
  submitted_late?: boolean;
  status?: string;
  created_at?: string | null;
  startedAt?: string | null;
  endsAt?: string | null;
  submittedAt?: string | null;
  [key: string]: unknown;
}

export interface FullLengthExamQuestion {
  id: string;
  module_id?: string;
  question_id?: string;
  order_index?: number;
  presented_at?: string | null;
  [key: string]: unknown;
}

export interface FullLengthExamResponse {
  id: string;
  session_id?: string;
  module_id?: string;
  question_id?: string;
  selected_answer?: string | null;
  free_response_answer?: string | null;
  is_correct?: boolean | null;
  answered_at?: string | null;
  submitted_at?: string | null;
  [key: string]: unknown;
}

export interface ProgressStats {
  mathProgress: number;
  readingProgress: number;
  totalQuestions: number;
  correctAnswers?: number;
  recentStreak?: number;
  averageAccuracy?: number;
}
