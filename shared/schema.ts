import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

export interface QuestionOption {
  key: "A" | "B" | "C" | "D";
  text: string;
}

export interface Competency {
  code: string;
  raw?: string | null;
}

export interface StudentQuestion {
  id: string;
  canonicalId?: string | null;
  canonical_id?: string | null;
  stem: string;
  section: string;
  sectionCode?: "M" | "RW" | "MATH" | null;
  section_code?: "M" | "RW" | "MATH" | null;
  questionType: "multiple_choice" | "free_response";
  question_type?: "multiple_choice" | "free_response" | null;
  type?: "mc" | "fr";
  options: QuestionOption[];
  explanation: string | null;
  tags: string[];
  domain?: string | null;
  skill?: string | null;
  subskill?: string | null;
  skillCode?: string | null;
  difficulty?: string | number | null;
  competencies?: Competency[];
}

export type StudentMcQuestion = StudentQuestion & {
  questionType: "multiple_choice";
  question_type?: "multiple_choice" | null;
  type?: "mc";
};

// Legacy migration source table kept for active script usage.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username"),
  password: text("password"),
  googleId: text("google_id"),
  email: text("email"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  isAdmin: boolean("is_admin").default(false).notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phoneNumber: text("phone_number"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Canonical question-bank table used by active scripts.
export const questions = pgTable("questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  canonicalId: text("canonical_id").unique(),
  status: text("status").notNull().default("draft"),
  section: text("section").notNull(),
  sectionCode: text("section_code"),
  sourceType: integer("source_type"),
  questionType: text("question_type").notNull().default("multiple_choice"),
  stem: text("stem").notNull(),
  options: jsonb("options").$type<Array<{ key: string; text: string }> | string[] | null>(),
  correctAnswer: text("correct_answer"),
  answerText: text("answer_text"),
  explanation: text("explanation"),
  optionMetadata: jsonb("option_metadata"),
  difficulty: text("difficulty"),
  difficultyLevel: integer("difficulty_level"),
  unitTag: text("unit_tag"),
  tags: jsonb("tags"),
  competencies: jsonb("competencies").$type<Array<{ code: string; raw?: string | null }> | null>(),
  domain: text("domain"),
  skill: text("skill"),
  subskill: text("subskill"),
  skillCode: text("skill_code"),
  type: text("type"),
  embedding: jsonb("embedding").$type<number[] | null>(),
  version: integer("version").default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
});

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
  userId: string | null;
  type: NotificationType;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  message: string;
  actionUrl: string | null;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
  expiresAt: Date | null;
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
