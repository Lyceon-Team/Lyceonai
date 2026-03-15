import { sql } from "drizzle-orm";
<<<<<<< HEAD
import { pgTable, text, varchar, integer, jsonb, timestamp, boolean, uuid } from "drizzle-orm/pg-core";

/**
 * Shared schema/types trimmed to active runtime and active script imports.
 *
 * Canonical content truth:
 * - runtime question identity is questions.canonical_id
 * - canonical lifecycle is draft -> qa -> published
 * - question_versions uses question_canonical_id (canonical key)
 *
 * Non-runtime note:
 * - `users` remains only for legacy migration scripts.
 * - auth/profile runtime truth is Supabase auth.users + profiles.
 */
=======
import {
  pgTable,
  text,
  varchar,
  uuid,
  integer,
  jsonb,
  timestamp,
  boolean,
  real,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// SHARED RUNTIME QUESTION TYPES
// ============================================================================
>>>>>>> 05efd891af89c9efaa3e08ef672fa417439f93ac

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
<<<<<<< HEAD
  sectionCode?: "M" | "RW" | "MATH" | null;
  section_code?: "M" | "RW" | "MATH" | null;
=======
  sectionCode?: "MATH" | "RW" | null;
  section_code?: "MATH" | "RW" | null;
>>>>>>> 05efd891af89c9efaa3e08ef672fa417439f93ac
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

export type StudentFrQuestion = StudentQuestion & {
  questionType: "free_response";
  question_type?: "free_response" | null;
  type?: "fr";
};

<<<<<<< HEAD
// Legacy migration source table (non-runtime).
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

// Canonical question-bank table used by runtime Supabase flows.
export const questions = pgTable("questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  canonicalId: text("canonical_id").unique(),
  status: text("status").notNull().default("draft"),
  section: text("section").notNull(),
  sectionCode: text("section_code"),
  sourceType: integer("source_type"),
  questionType: text("question_type").notNull().default("multiple_choice"),
  stem: text("stem").notNull(),
  options: jsonb("options").$type<Array<{ key: string; text: string }> | null>(),
  correctAnswer: text("correct_answer"),
  answerText: text("answer_text"),
  explanation: text("explanation"),
  optionMetadata: jsonb("option_metadata"),
=======
// ============================================================================
// IDENTITY / AUTH
// ============================================================================

/**
 * Canonical runtime identity/profile table.
 * This is the source of truth for authenticated users in active runtime.
 */
export const profiles = pgTable("profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  email: text("email"),
  displayName: text("display_name"),
  role: text("role").notNull().default("student"), // 'student' | 'guardian' | 'admin'
  isUnder13: boolean("is_under_13").default(false).notNull(),
  guardianConsent: boolean("guardian_consent").default(false).notNull(),
  guardianEmail: text("guardian_email"),
  studentLinkCode: text("student_link_code"),
  profileCompletedAt: timestamp("profile_completed_at"),

  // Extended profile fields used by runtime profile completion
  firstName: text("first_name"),
  lastName: text("last_name"),
  phoneNumber: text("phone_number"),
  dateOfBirth: timestamp("date_of_birth"),
  address: jsonb("address"), // { street, city, state, zipCode, country }
  timeZone: text("time_zone"),
  preferredLanguage: text("preferred_language").default("en"),
  marketingOptIn: boolean("marketing_opt_in").default(false),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Legacy compatibility table.
 *
 * Runtime auth has moved to `profiles`, but this table is retained because
 * historical schema surface and some legacy compatibility paths still reference it.
 *
 * It is not the canonical runtime user/profile source of truth.
 */
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  username: text("username").unique(),
  password: text("password"),

  googleId: text("google_id").unique(),
  email: text("email").unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),

  isAdmin: boolean("is_admin").default(false).notNull(),
  adminPermissions: jsonb("admin_permissions"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),

  firstName: text("first_name"),
  lastName: text("last_name"),
  phoneNumber: text("phone_number"),
  dateOfBirth: timestamp("date_of_birth"),
  address: jsonb("address"),
  timeZone: text("time_zone"),
  profileCompletedAt: timestamp("profile_completed_at"),
  preferredLanguage: text("preferred_language").default("en"),
  marketingOptIn: boolean("marketing_opt_in").default(false),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  privacyPolicyAcceptedAt: timestamp("privacy_policy_accepted_at"),
  emailVerified: boolean("email_verified").default(false),
  emailVerificationToken: text("email_verification_token"),
  passwordResetToken: text("password_reset_token"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorSecret: text("two_factor_secret"),
  recoveryCodesUsed: jsonb("recovery_codes_used"),
  loginAttempts: integer("login_attempts").default(0).notNull(),
  lockedUntil: timestamp("locked_until"),
});

// ============================================================================
// CONTENT / DOCUMENTS / QUESTIONS
// ============================================================================

export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  storagePath: text("storage_path").notNull(),
  size: integer("size").notNull(),
  pageCount: integer("page_count"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
  status: text("status").notNull().default("processing"), // processing | completed | failed
  totalQuestions: integer("total_questions").default(0),
  extractionMethod: text("extraction_method"),
  extractionConfidence: integer("extraction_confidence"),
});

/**
 * Canonical questions table.
 *
 * Runtime question identity is `canonical_id`.
 * Pre-submit student responses must never include answer-bearing fields.
 *
 * Active lifecycle truth on the questions table is draft -> qa -> published.
 */
export const questions = pgTable("questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  documentId: varchar("document_id").references(() => documents.id),
  questionNumber: integer("question_number"),

  // Legacy import metadata only. Not runtime question identity.
  internalId: text("internal_id").unique(),

  section: text("section").notNull(),
  stem: text("stem").notNull(),

  // Legacy question type field retained for compatibility.
  questionType: text("question_type").notNull().default("multiple_choice"),

  options: jsonb("options"),

  // Legacy answer field retained for compatibility.
  answer: text("answer").notNull(),

  explanation: text("explanation"),
>>>>>>> 05efd891af89c9efaa3e08ef672fa417439f93ac
  difficulty: text("difficulty"),
  difficultyLevel: integer("difficulty_level"),
  unitTag: text("unit_tag"),
  tags: jsonb("tags"),
<<<<<<< HEAD
  competencies: jsonb("competencies").$type<Array<{ code: string; raw?: string | null }> | null>(),
  domain: text("domain"),
  skill: text("skill"),
  subskill: text("subskill"),
  skillCode: text("skill_code"),
  type: text("type"),
  embedding: jsonb("embedding").$type<number[] | null>(),
  version: integer("version").default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
=======
  classification: jsonb("classification"),
  sourceMapping: jsonb("source_mapping"),
  pageNumber: integer("page_number"),
  position: jsonb("position"),
  embedding: jsonb("embedding"),

  aiGenerated: boolean("ai_generated").default(false).notNull(),
  provenanceChunkIds: jsonb("provenance_chunk_ids"),
  createdAt: timestamp("created_at").defaultNow().notNull(),

  // Canonical discriminated-union fields
  type: text("type"), // 'mc' | 'fr'
  answerChoice: text("answer_choice"), // MC answer key
  answerText: text("answer_text"), // FR answer text

  confidence: real("confidence").default(1.0),
  needsReview: boolean("needs_review").default(false).notNull(),
  parsingMetadata: jsonb("parsing_metadata").$type<{
    anchorsDetected?: string[];
    patternMatches?: Record<string, boolean>;
    warnings?: string[];
    originalText?: string;
  }>(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by").references(() => profiles.id), // historical reviewer link now aligned to runtime identity

  // Historical import provenance retained for compatibility
  questionHash: text("question_hash").unique(),
  engineUsed: text("engine_used"),
  engineConfidence: real("engine_confidence"),
  sourcePdf: text("source_pdf"),
  ingestionRunId: varchar("ingestion_run_id"),

  // Canonical runtime identity
  canonicalId: text("canonical_id").unique(), // SAT{M|RW}{1|2}{A-Z0-9}{6}
  testCode: text("test_code"), // SAT
  sectionCode: text("section_code"), // M | RW
  sourceType: integer("source_type"), // 1 parsed, 2 AI generated
  competencies: jsonb("competencies").$type<Array<{ code: string; raw?: string | null }>>(),
  version: integer("version").default(1),

  // Runtime lifecycle field used by active routes
  status: text("status").default("draft"), // draft | qa | published
>>>>>>> 05efd891af89c9efaa3e08ef672fa417439f93ac
});

// Canonical immutable version ledger keyed by canonical question ID.
export const questionVersions = pgTable("question_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionCanonicalId: text("question_canonical_id").notNull(),
  versionNumber: integer("version_number").notNull(),
<<<<<<< HEAD
  lifecycleStatus: text("lifecycle_status").notNull(),
=======
  lifecycleStatus: text("lifecycle_status").notNull(), // qa | published
>>>>>>> 05efd891af89c9efaa3e08ef672fa417439f93ac
  snapshot: jsonb("snapshot").notNull(),
  createdBy: varchar("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  publishedAt: timestamp("published_at"),
});

<<<<<<< HEAD
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
=======
export const docChunks = pgTable("doc_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => documents.id).notNull(),
  type: text("type").notNull(), // stem | explanation | passage | window
  content: text("content").notNull(),
  pageNumber: integer("page_number"),
  sourceQuestionId: varchar("source_question_id").references(() => questions.id, {
    onDelete: "cascade",
  }),
  embedding: jsonb("embedding"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const choices = pgTable("choices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").references(() => questions.id, {
    onDelete: "cascade",
  }).notNull(),
  choiceKey: text("choice_key").notNull(),
  choiceText: text("choice_text").notNull(),
  bbox: jsonb("bbox").$type<number[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================================
// CHAT / TUTOR / QUESTION CONTEXT
// ============================================================================

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => profiles.id).notNull(),
  message: text("message").notNull(),
  response: text("response").notNull(),
  sources: jsonb("sources"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

// ============================================================================
// PROGRESS / NOTIFICATIONS
// ============================================================================

export const userProgress = pgTable("user_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => profiles.id).notNull(),
  questionId: varchar("question_id").references(() => questions.id, {
    onDelete: "cascade",
  }).notNull(),
  isCorrect: boolean("is_correct").notNull(),
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
});

export const notificationTypeEnum = z.enum([
  "system_update",
  "study_reminder",
  "progress_alert",
  "achievement",
  "ai_tutor_suggestion",
]);

export const notificationCategoryEnum = z.enum([
  "study_progress",
  "learning_analytics",
  "question_updates",
  "motivation",
  "ai_tutor",
  "technical",
  "milestones",
]);

export const notificationPriorityEnum = z.enum(["low", "normal", "high", "urgent"]);

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => profiles.id),
  type: text("type").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  priority: text("priority").notNull().default("normal"),
  isRead: boolean("is_read").default(false).notNull(),
  actionUrl: text("action_url"),
  actionText: text("action_text"),
  metadata: jsonb("metadata"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notificationReads = pgTable(
  "notification_reads",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => profiles.id).notNull(),
    notificationId: varchar("notification_id").references(() => notifications.id).notNull(),
    readAt: timestamp("read_at").defaultNow().notNull(),
  },
  (table) => [
    { uniqueUserNotification: sql`UNIQUE(${table.userId}, ${table.notificationId})` },
  ],
);

// ============================================================================
// PRACTICE / EXAMS
// ============================================================================

export const practiceSessions = pgTable("practice_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => profiles.id),
  mode: text("mode").notNull(), // flow | structured
  section: text("section"), // math | reading | writing | mixed
  difficulty: text("difficulty"), // easy | medium | hard | adaptive
  targetDurationMs: integer("target_duration_ms"),
  actualDurationMs: integer("actual_duration_ms"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull().default("in_progress"), // in_progress | completed | abandoned
  questionIds: jsonb("question_ids"),
  completed: boolean("completed").default(false).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const answerAttempts = pgTable("answer_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").references(() => practiceSessions.id, {
    onDelete: "cascade",
  }),
  examAttemptId: varchar("exam_attempt_id").references(() => examAttempts.id, {
    onDelete: "cascade",
  }),
  questionId: varchar("question_id").references(() => questions.id, {
    onDelete: "cascade",
  }).notNull(),
  selectedAnswer: text("selected_answer"),
  freeResponseAnswer: text("free_response_answer"),
  isCorrect: boolean("is_correct").notNull(),
  outcome: text("outcome").default("correct"), // correct | incorrect | skipped
  timeSpentMs: integer("time_spent_ms"),
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
});

export const examAttempts = pgTable("exam_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => profiles.id),
  examType: text("exam_type").notNull().default("practice"), // practice | diagnostic
  startedAt: timestamp("started_at").defaultNow().notNull(),
  submittedAt: timestamp("submitted_at"),
  status: text("status").notNull().default("in_progress"), // in_progress | submitted | failed | abandoned
  violations: integer("violations").default(0),
  rawScoreMath: integer("raw_score_math"),
  rawScoreRW: integer("raw_score_rw"),
  scaledScoreMath: integer("scaled_score_math"),
  scaledScoreRW: integer("scaled_score_rw"),
  totalScore: integer("total_score"),
  metadata: jsonb("metadata"),
});

export const examSections = pgTable("exam_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  examAttemptId: varchar("exam_attempt_id").references(() => examAttempts.id, {
    onDelete: "cascade",
  }).notNull(),
  section: text("section").notNull(), // RW1 | RW2 | M1 | M2
  sectionName: text("section_name").notNull(),
  targetDurationMs: integer("target_duration_ms").notNull(),
  actualDurationMs: integer("actual_duration_ms"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default("pending"), // pending | in_progress | completed | timed_out
});

<<<<<<< HEAD
export const questionFeedback = pgTable("question_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").references(() => questions.id, {
    onDelete: "cascade",
  }).notNull(),
  userId: varchar("user_id").references(() => profiles.id),
  practiceSessionId: varchar("practice_session_id").references(() => practiceSessions.id, {
    onDelete: "set null",
  }),
  rating: text("rating").notNull(), // up | down
  timeToAnswerSeconds: integer("time_to_answer_seconds"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const questionFeedbackRatingEnum = z.enum(["up", "down"]);

/**
 * Full-length SAT exam runtime tables.
 * These support server-authoritative timing and deterministic module/question ownership.
 */
export const fullLengthExamSessions = pgTable("full_length_exam_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => profiles.id, {
    onDelete: "cascade",
  }).notNull(),

  status: text("status").notNull().default("not_started"), // not_started | in_progress | completed | abandoned
  currentSection: text("current_section"), // rw | math | break | null
  currentModule: integer("current_module"), // 1 | 2 | null
  breakStartedAt: timestamp("break_started_at"),

  testFormId: text("test_form_id").notNull().default("00000000-0000-4000-8000-000000000001"),
  clientInstanceId: text("client_instance_id"),

  seed: text("seed").notNull(),

  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const fullLengthExamModules = pgTable("full_length_exam_modules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: uuid("session_id").references(() => fullLengthExamSessions.id, {
    onDelete: "cascade",
  }).notNull(),

  section: text("section").notNull(), // rw | math
  moduleIndex: integer("module_index").notNull(), // 1 | 2
  difficultyBucket: text("difficulty_bucket"), // easy | medium | hard | null

  targetDurationMs: integer("target_duration_ms").notNull(),
  startedAt: timestamp("started_at"),
  endsAt: timestamp("ends_at"),
  submittedAt: timestamp("submitted_at"),
  submittedLate: boolean("submitted_late").notNull().default(false),

  status: text("status").notNull().default("not_started"), // not_started | in_progress | submitted | expired
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const fullLengthExamQuestions = pgTable("full_length_exam_questions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  moduleId: uuid("module_id").references(() => fullLengthExamModules.id, {
    onDelete: "cascade",
  }).notNull(),
  questionId: varchar("question_id").references(() => questions.id, {
    onDelete: "cascade",
  }).notNull(),
  orderIndex: integer("order_index").notNull(),
  presentedAt: timestamp("presented_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const fullLengthExamResponses = pgTable(
  "full_length_exam_responses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id").references(() => fullLengthExamSessions.id, {
      onDelete: "cascade",
    }).notNull(),
    moduleId: uuid("module_id").references(() => fullLengthExamModules.id, {
      onDelete: "cascade",
    }).notNull(),
    questionId: varchar("question_id").references(() => questions.id, {
      onDelete: "cascade",
    }).notNull(),

    selectedAnswer: text("selected_answer"),
    freeResponseAnswer: text("free_response_answer"),
    isCorrect: boolean("is_correct"),

    answeredAt: timestamp("answered_at"),
    submittedAt: timestamp("submitted_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    {
      uniqueSessionModuleQuestion: sql`UNIQUE(${table.sessionId}, ${table.moduleId}, ${table.questionId})`,
    },
  ],
);

// ============================================================================
// ADMIN / AUDIT / SYSTEM LOGS
// ============================================================================
=======
// DEPRECATED: batch_jobs tables removed - use ingestion_runs instead
// See ingestionRuns table below for current ingestion tracking
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminUserId: varchar("admin_user_id").references(() => profiles.id).notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  method: text("method"),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  success: boolean("success").notNull(),
  error: text("error"),
  executionTimeMs: integer("execution_time_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const systemEventLogs = pgTable("system_event_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: text("event_type").notNull(),
  level: text("level").notNull().default("info"),
  source: text("source").notNull(),
  message: text("message").notNull(),
  details: jsonb("details"),
  documentId: varchar("document_id").references(() => documents.id),
  userId: varchar("user_id").references(() => profiles.id),
  sessionId: text("session_id"),
  duration: integer("duration"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================================
// LEGACY IMPORT / OCR / INGESTION SURFACES (NON-RUNTIME)
// ============================================================================

/**
 * Historical import-run records retained for audit/backfill compatibility only.
 * There is no active ingestion runtime in this repository.
 */
export const ingestionRuns = pgTable("ingestion_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status").notNull().default("queued"),
  sourcePdfs: jsonb("source_pdfs").$type<string[]>(),
  totalPages: integer("total_pages").default(0),
  processedPages: integer("processed_pages").default(0),
  totalQuestions: integer("total_questions").default(0),
  insertedQuestions: integer("inserted_questions").default(0),
  duplicateQuestions: integer("duplicate_questions").default(0),
  failedQuestions: integer("failed_questions").default(0),
  needsReviewCount: integer("needs_review_count").default(0),

  queuedAt: timestamp("queued_at").defaultNow().notNull(),
  ocrStartedAt: timestamp("ocr_started_at"),
  ocrCompletedAt: timestamp("ocr_completed_at"),
  parseStartedAt: timestamp("parse_started_at"),
  parseCompletedAt: timestamp("parse_completed_at"),
  qaStartedAt: timestamp("qa_started_at"),
  qaCompletedAt: timestamp("qa_completed_at"),
  embedStartedAt: timestamp("embed_started_at"),
  embedCompletedAt: timestamp("embed_completed_at"),
  completedAt: timestamp("completed_at"),

  errorMessage: text("error_message"),
  errorStage: text("error_stage"),

  providerUsed: text("provider_used"),
  providerAttempts: jsonb("provider_attempts").$type<string[]>(),
  ocrStats: jsonb("ocr_stats").$type<{
    totalPages: number;
    byEngine: Record<string, { pages: number; errors: number }>;
    errors: Array<{ engine: string; message: string }>;
    providerChain?: string[];
    mathpixPatchCount?: number;
    nougatMergeCount?: number;
  }>(),
  config: jsonb("config").$type<{
    ocrConfidenceThreshold?: number;
    maxConcurrency?: number;
    skipMathpix?: boolean;
    skipNougat?: boolean;
  }>(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const documentPages = pgTable("document_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ingestionRunId: varchar("ingestion_run_id").references(() => ingestionRuns.id, {
    onDelete: "cascade",
  }).notNull(),
  sourcePdf: text("source_pdf").notNull(),
  pageNumber: integer("page_number").notNull(),
  rawText: text("raw_text").notNull(),

  primaryEngine: text("primary_engine").notNull(),
  patchedByMathpix: boolean("patched_by_mathpix").default(false),
  mergedFromNougat: boolean("merged_from_nougat").default(false),
  engineConfidence: real("engine_confidence"),

  blocks: jsonb("blocks").$type<
    Array<{
      text: string;
      bbox: number[];
      confidence: number;
      type?: "text" | "math";
      engine: "docai" | "mathpix" | "nougat";
    }>
  >(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Legacy import-only media extraction metadata.
 * This is not a runtime question-bank feature in the current repository.
 */
export const media = pgTable("media", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").references(() => questions.id, {
    onDelete: "cascade",
  }),
  documentPageId: varchar("document_page_id").references(() => documentPages.id, {
    onDelete: "cascade",
  }),
  mediaType: text("media_type").notNull(), // figure | table | diagram | equation
  storagePath: text("storage_path"),
  bbox: jsonb("bbox").$type<number[]>(),
  caption: text("caption"),
  altText: text("alt_text"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const validationIssues = pgTable("validation_issues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").references(() => questions.id, {
    onDelete: "cascade",
  }),
  ingestionRunId: varchar("ingestion_run_id").references(() => ingestionRuns.id, {
    onDelete: "cascade",
  }),
  issueType: text("issue_type").notNull(),
  severity: text("severity").notNull(), // error | warning | info
  message: text("message").notNull(),
  details: jsonb("details"),
  resolved: boolean("resolved").default(false),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const questionEmbeddings = pgTable("question_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").references(() => questions.id, {
    onDelete: "cascade",
  }).notNull(),
  chunkType: text("chunk_type").notNull(), // Q | E
  content: text("content").notNull(),
  embedding: jsonb("embedding").notNull(),

  sourcePdf: text("source_pdf"),
  pageNumber: integer("page_number"),
  bbox: jsonb("bbox").$type<number[]>(),
  engineUsed: text("engine_used"),

  metadata: jsonb("metadata").$type<{
    section?: string;
    difficulty?: string;
    questionNumber?: number;
    canonicalId?: string;
    testCode?: string;
    sectionCode?: string;
    competencyCodes?: string[];
  }>(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================================
// INSERT SCHEMAS
// ============================================================================

export const insertProfileSchema = createInsertSchema(profiles).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  uploadedAt: true,
  processedAt: true,
});

export const insertQuestionSchema = createInsertSchema(questions).omit({
  id: true,
  createdAt: true,
});

export const insertQuestionVersionSchema = createInsertSchema(questionVersions).omit({
  id: true,
  createdAt: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  timestamp: true,
});

export const insertDocChunkSchema = createInsertSchema(docChunks).omit({
  id: true,
  createdAt: true,
});

export const insertUserProgressSchema = createInsertSchema(userProgress).omit({
  id: true,
  attemptedAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    type: notificationTypeEnum,
    category: notificationCategoryEnum,
    priority: notificationPriorityEnum.optional(),
  });

export const insertPracticeSessionSchema = createInsertSchema(practiceSessions).omit({
  id: true,
  startedAt: true,
});

export const insertAnswerAttemptSchema = createInsertSchema(answerAttempts).omit({
  id: true,
  attemptedAt: true,
});

export const insertExamAttemptSchema = createInsertSchema(examAttempts).omit({
  id: true,
  startedAt: true,
});

export const insertExamSectionSchema = createInsertSchema(examSections).omit({
  id: true,
});

<<<<<<< HEAD
export const insertQuestionFeedbackSchema = createInsertSchema(questionFeedback).omit({
=======
export const insertQuestionSchema = createInsertSchema(questions).omit({
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
  id: true,
  createdAt: true,
});

<<<<<<< HEAD
export const insertFullLengthExamSessionSchema = createInsertSchema(
  fullLengthExamSessions,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFullLengthExamModuleSchema = createInsertSchema(
  fullLengthExamModules,
).omit({
=======
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  timestamp: true,
});

export const insertDocChunkSchema = createInsertSchema(docChunks).omit({
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
  id: true,
  createdAt: true,
});

<<<<<<< HEAD
export const insertFullLengthExamQuestionSchema = createInsertSchema(
  fullLengthExamQuestions,
).omit({
=======
export const insertUserProgressSchema = createInsertSchema(userProgress).omit({
  id: true,
  attemptedAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
}).extend({
  type: notificationTypeEnum,
  category: notificationCategoryEnum, 
  priority: notificationPriorityEnum.optional()
});

export const insertUserSchema = createInsertSchema(users).omit({
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
  id: true,
  createdAt: true,
});

<<<<<<< HEAD
export const insertFullLengthExamResponseSchema = createInsertSchema(
  fullLengthExamResponses,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
=======
// DEPRECATED: batch job schemas removed - use ingestion_runs instead
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b

export const insertAdminAuditLogSchema = createInsertSchema(adminAuditLogs).omit({
  id: true,
  createdAt: true,
});

export const insertSystemEventLogSchema = createInsertSchema(systemEventLogs).omit({
  id: true,
  createdAt: true,
});

export const insertIngestionRunSchema = createInsertSchema(ingestionRuns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDocumentPageSchema = createInsertSchema(documentPages).omit({
  id: true,
  createdAt: true,
});

export const insertChoiceSchema = createInsertSchema(choices).omit({
  id: true,
  createdAt: true,
});

export const insertValidationIssueSchema = createInsertSchema(validationIssues).omit({
  id: true,
  createdAt: true,
});

export const insertQuestionEmbeddingSchema = createInsertSchema(
  questionEmbeddings,
).omit({
  id: true,
  createdAt: true,
});

// ============================================================================
// ROW TYPES
// ============================================================================

export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profiles.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questions.$inferSelect;

export type InsertQuestionVersion = z.infer<typeof insertQuestionVersionSchema>;
export type QuestionVersion = typeof questionVersions.$inferSelect;

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

export type InsertDocChunk = z.infer<typeof insertDocChunkSchema>;
export type DocChunk = typeof docChunks.$inferSelect;

export type InsertUserProgress = z.infer<typeof insertUserProgressSchema>;
export type UserProgress = typeof userProgress.$inferSelect;

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export type NotificationType = z.infer<typeof notificationTypeEnum>;
export type NotificationCategory = z.infer<typeof notificationCategoryEnum>;
export type NotificationPriority = z.infer<typeof notificationPriorityEnum>;

export type InsertPracticeSession = z.infer<typeof insertPracticeSessionSchema>;
export type PracticeSession = typeof practiceSessions.$inferSelect;

export type InsertAnswerAttempt = z.infer<typeof insertAnswerAttemptSchema>;
export type AnswerAttempt = typeof answerAttempts.$inferSelect;

export type InsertExamAttempt = z.infer<typeof insertExamAttemptSchema>;
export type ExamAttempt = typeof examAttempts.$inferSelect;

export type InsertExamSection = z.infer<typeof insertExamSectionSchema>;
export type ExamSection = typeof examSections.$inferSelect;

<<<<<<< HEAD
export type InsertQuestionFeedback = z.infer<typeof insertQuestionFeedbackSchema>;
export type QuestionFeedback = typeof questionFeedback.$inferSelect;

export type InsertFullLengthExamSession = z.infer<
  typeof insertFullLengthExamSessionSchema
>;
export type FullLengthExamSession = typeof fullLengthExamSessions.$inferSelect;

export type InsertFullLengthExamModule = z.infer<
  typeof insertFullLengthExamModuleSchema
>;
export type FullLengthExamModule = typeof fullLengthExamModules.$inferSelect;

export type InsertFullLengthExamQuestion = z.infer<
  typeof insertFullLengthExamQuestionSchema
>;
export type FullLengthExamQuestion = typeof fullLengthExamQuestions.$inferSelect;

export type InsertFullLengthExamResponse = z.infer<
  typeof insertFullLengthExamResponseSchema
>;
export type FullLengthExamResponse = typeof fullLengthExamResponses.$inferSelect;
=======
// DEPRECATED: BatchJob and BatchFileProgress types removed - use IngestionRun instead
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b

export type InsertAdminAuditLog = z.infer<typeof insertAdminAuditLogSchema>;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;

export type InsertSystemEventLog = z.infer<typeof insertSystemEventLogSchema>;
export type SystemEventLog = typeof systemEventLogs.$inferSelect;

export type InsertIngestionRun = z.infer<typeof insertIngestionRunSchema>;
export type IngestionRun = typeof ingestionRuns.$inferSelect;

export type InsertDocumentPage = z.infer<typeof insertDocumentPageSchema>;
export type DocumentPage = typeof documentPages.$inferSelect;

export type InsertChoice = z.infer<typeof insertChoiceSchema>;
export type Choice = typeof choices.$inferSelect;

export type InsertValidationIssue = z.infer<typeof insertValidationIssueSchema>;
export type ValidationIssue = typeof validationIssues.$inferSelect;

export type InsertQuestionEmbedding = z.infer<typeof insertQuestionEmbeddingSchema>;
export type QuestionEmbedding = typeof questionEmbeddings.$inferSelect;

// ============================================================================
// API / RESPONSE TYPES
// ============================================================================

export interface ApiQuestionOption {
  key: string;
  text: string;
}

export interface QuestionClassification {
  topic: string;
  subtopic: string;
  skills: string[];
  questionType: string;
  calculatorAllowed: boolean;
  cognitiveLevel: string;
  difficultyText: string;
  difficultyNumeric: number;
  standardIds: string[];
}

export interface SourceMapping {
  docType: "practice" | "qbank" | "answers" | "generic";
  profile: string;
  hasColumns: boolean;
  optionStyle: string;
  numberingStyle: string;
  answerKeyPresent: boolean;
  explanationMarkers: string[];
}

export interface SourceInfo {
  type: "question" | "chunk";
  id: string;
  documentName: string;
  pageNumber?: number;
  questionNumber?: number;
  chunkType?: "stem" | "explanation" | "passage" | "window";
  snippet: string;
>>>>>>> 05efd891af89c9efaa3e08ef672fa417439f93ac
}

// Full-length exam types are imported by runtime service code.
// Keep these as interfaces (service-owned runtime uses Supabase directly).
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

<<<<<<< HEAD
=======
export interface DetailedProgressStats {
  totalAttempts: number;
  correctAnswers: number;
  accuracyRate: number;
  mathStats: SectionStats;
  readingStats: SectionStats;
  writingStats: SectionStats;
  recentActivity: AttemptHistory[];
  performanceTrends: PerformanceTrend[];
  strengthsWeaknesses: StrengthsWeaknesses;
}

export interface SectionStats {
  section: string;
  totalAttempts: number;
  correctAnswers: number;
  accuracyRate: number;
  easyQuestions: DifficultyStats;
  mediumQuestions: DifficultyStats;
  hardQuestions: DifficultyStats;
}

export interface DifficultyStats {
  difficulty: string;
  totalAttempts: number;
  correctAnswers: number;
  accuracyRate: number;
}

export interface AttemptHistory {
  id: string;
  questionId: string;
  questionText: string;
  section: string;
  difficulty: string;
  isCorrect: boolean;
  attemptedAt: Date;
  documentName: string;
}

export interface PerformanceTrend {
  date: string;
  totalAttempts: number;
  correctAnswers: number;
  accuracyRate: number;
  mathAccuracy: number;
  readingAccuracy: number;
  writingAccuracy: number;
}

export interface StrengthsWeaknesses {
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}
>>>>>>> 05efd891af89c9efaa3e08ef672fa417439f93ac
