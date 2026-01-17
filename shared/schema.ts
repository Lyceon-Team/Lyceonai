import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, jsonb, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// CANONICAL QUESTION TYPES - Shared between backend and frontend
// ============================================================================

export interface SourceMapping {
  page?: number;
  mapping?: Record<string, any>;
}

export interface QuestionOption {
  key: string;
  text: string;
}

export interface Competency {
  code: string;
  raw?: string | null;
}

export interface StudentQuestionBase {
  id: string;
  stem: string;
  section: string;
  explanation: string | null;
  source?: {
    mapping?: Record<string, any> | null;
    page?: number | null;
  };
  tags: string[];
  type: 'mc' | 'fr';
  canonicalId?: string;
  testCode?: string;
  sectionCode?: string;
  sourceType?: 1 | 2;
  competencies?: Competency[];
}

export interface StudentMcQuestion extends StudentQuestionBase {
  type: 'mc';
  options: QuestionOption[];
}

export interface StudentFrQuestion extends StudentQuestionBase {
  type: 'fr';
}

export type StudentQuestion = StudentMcQuestion | StudentFrQuestion;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").unique(), // Made optional for Google OAuth users
  password: text("password"), // Made optional for Google OAuth users
  googleId: text("google_id").unique(), // Google OAuth user ID
  email: text("email").unique(), // User email from Google OAuth
  name: text("name"), // Display name from Google OAuth
  avatarUrl: text("avatar_url"), // Profile picture URL from Google
  isAdmin: boolean("is_admin").default(false).notNull(), // Admin access flag
  adminPermissions: jsonb("admin_permissions"), // Granular admin permissions
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  
  // Comprehensive profile fields for industry-standard user profiles
  firstName: text("first_name"),
  lastName: text("last_name"),
  phoneNumber: text("phone_number"),
  dateOfBirth: timestamp("date_of_birth"), // For age calculation and personalization
  address: jsonb("address"), // {street, city, state, zipCode, country}
  timeZone: text("time_zone"), // User's timezone for scheduling
  profileCompletedAt: timestamp("profile_completed_at"), // When profile was completed
  preferredLanguage: text("preferred_language").default("en"), // For i18n
  marketingOptIn: boolean("marketing_opt_in").default(false), // GDPR compliance
  termsAcceptedAt: timestamp("terms_accepted_at"), // Legal compliance
  privacyPolicyAcceptedAt: timestamp("privacy_policy_accepted_at"), // GDPR compliance
  emailVerified: boolean("email_verified").default(false), // Email verification status
  emailVerificationToken: text("email_verification_token"), // For verification
  passwordResetToken: text("password_reset_token"), // For password reset
  passwordResetExpiresAt: timestamp("password_reset_expires_at"), // Token expiration
  twoFactorEnabled: boolean("two_factor_enabled").default(false), // 2FA support
  twoFactorSecret: text("two_factor_secret"), // TOTP secret
  recoveryCodesUsed: jsonb("recovery_codes_used"), // Used backup codes
  loginAttempts: integer("login_attempts").default(0).notNull(), // Rate limiting
  lockedUntil: timestamp("locked_until"), // Account lockout
});

export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  storagePath: text("storage_path").notNull(), // Cloud storage path
  size: integer("size").notNull(), // File size in bytes
  pageCount: integer("page_count"), // Number of pages in PDF
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
  status: text("status").notNull().default("processing"), // processing, completed, failed
  totalQuestions: integer("total_questions").default(0),
  extractionMethod: text("extraction_method"), // mathpix, document-ai, pdf-js, tesseract
  extractionConfidence: integer("extraction_confidence"), // 0-100 confidence score
});

/**
 * CANONICAL QUESTIONS TABLE
 *
 * This table stores all SAT practice questions with support for both multiple-choice and free-response formats.
 *
 * CORE FIELDS (Central to the app's functionality):
 *  - id: Unique identifier
 *  - stem: Question text/prompt
 *  - section: Question category (Math | Reading | Writing | Reading and Writing)
 *  - type: Discriminated union field ('mc' | 'fr') - CANONICAL for identifying question type
 *  - options: For MC questions, array of {key, text} choices (stored as JSONB)
 *  - answerChoice: For MC questions, correct answer key (A|B|C|D)
 *  - answerText: For FR questions, correct answer text
 *  - explanation: Learning explanation/rationale
 *  - difficulty / difficultyLevel: Difficulty classification
 *  - tags/unitTag: Topic/unit tags for organization
 *
 * ADVANCED FIELDS (Ingestion/AI/Analytics):
 *  - classification: AI categorization metadata
 *  - sourceMapping: PDF structure/position metadata
 *  - pageNumber, position: Document location
 *  - embedding: Vector embeddings for RAG
 *  - parsingMetadata: OCR/parsing details
 *  - confidence, needsReview: Quality assurance flags
 *  - questionHash, engineUsed, engineConfidence: OCR pipeline metadata
 *  - provenanceChunkIds: RAG source tracking
 *
 * LEGACY FIELDS (For backward compatibility):
 *  - questionType: DEPRECATED - use 'type' instead (enum values map: "multiple_choice" -> "mc", "free_response" -> "fr")
 *  - answer: DEPRECATED - use answerChoice (MC) or answerText (FR) instead
 *
 * SECURITY NOTE: API routes MUST NOT leak answer, answerChoice, or answerText to students.
 * These fields are server-side only and should never be included in StudentQuestion responses.
 */
export const questions = pgTable("questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => documents.id), // Made optional for internal AI-generated questions
  questionNumber: integer("question_number"), // Optional for internal AI-generated questions
  internalId: text("internal_id").unique(), // Internal question ID for AI-generated questions
  section: text("section").notNull(), // Math, Reading, Writing, Reading and Writing
  stem: text("stem").notNull(),
  
  // DEPRECATED: use 'type' field instead
  questionType: text("question_type").notNull().default("multiple_choice"), // multiple_choice, free_response
  
  options: jsonb("options"), // Array of {key: string, text: string} - null for free response
  
  // DEPRECATED: use answerChoice (MC) or answerText (FR) instead
  answer: text("answer").notNull(),
  
  explanation: text("explanation"),
  difficulty: text("difficulty"), // Easy, Medium, Hard (legacy text field)
  difficultyLevel: integer("difficulty_level"), // 1-5 numeric difficulty rating
  unitTag: text("unit_tag"), // Topic/unit tag (e.g., "Algebra", "Geometry", "Reading Comprehension")
  tags: jsonb("tags"), // Array of strings (stored as JSONB array)
  classification: jsonb("classification"), // Structured AI categorization JSON
  sourceMapping: jsonb("source_mapping"), // PDF structure metadata
  pageNumber: integer("page_number"),
  position: jsonb("position"), // {x, y, width, height} for bounding box
  embedding: jsonb("embedding"), // Vector embedding for similarity search
  aiGenerated: boolean("ai_generated").default(false).notNull(), // Whether question was AI-generated
  provenanceChunkIds: jsonb("provenance_chunk_ids"), // Array of chunk IDs used as source
  createdAt: timestamp("created_at").defaultNow().notNull(),
  
  // CANONICAL DISCRIMINATED UNION FIELDS (new architecture):
  type: text("type"), // "mc" | "fr" - CANONICAL type field (use this, not questionType)
  answerChoice: text("answer_choice"), // for MC: "A" | "B" | "C" | "D" (use this instead of answer for MC)
  answerText: text("answer_text"), // for FR: free response text answer (use this instead of answer for FR)
  
  // Quality assurance fields
  confidence: real("confidence").default(1.0), // Parsing confidence 0.0-1.0
  needsReview: boolean("needs_review").default(false).notNull(), // True if confidence < 0.8
  parsingMetadata: jsonb("parsing_metadata").$type<{
    anchorsDetected?: string[];
    patternMatches?: Record<string, boolean>;
    warnings?: string[];
    originalText?: string;
  }>(), // Detailed parsing metadata for review
  reviewedAt: timestamp("reviewed_at"), // When question was reviewed
  reviewedBy: varchar("reviewed_by").references(() => users.id), // Admin who reviewed
  
  // Ingestion v2 fields for OCR tracking and deduplication
  questionHash: text("question_hash").unique(), // Normalized hash for deduplication
  engineUsed: text("engine_used"), // 'docai' | 'mathpix' | 'nougat' - primary OCR engine
  engineConfidence: real("engine_confidence"), // Average confidence from OCR engine (0.0-1.0)
  sourcePdf: text("source_pdf"), // GCS path to source PDF
  ingestionRunId: varchar("ingestion_run_id"), // References ingestion_runs.id (soft reference for now)
  
  // Ingestion v2 canonical question fields (PRP alignment)
  canonicalId: text("canonical_id").unique(), // Stable canonical ID like SATM1****** or ACTR1******
  testCode: text("test_code"), // e.g. "SAT", "ACT", "AP"
  sectionCode: text("section_code"), // e.g. "M", "RW"
  sourceType: integer("source_type"), // 1 = parsed PDF, 2 = AI generated
  competencies: jsonb("competencies").$type<Array<{ code: string; raw?: string | null }>>(), // Array of {code, raw}
  version: integer("version").default(1), // Schema version
});

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(), // User who sent the message
  message: text("message").notNull(),
  response: text("response").notNull(),
  sources: jsonb("sources"), // Array of question IDs that were used as context
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

// Document chunks for enhanced RAG and content segmentation
export const docChunks = pgTable("doc_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => documents.id).notNull(),
  type: text("type").notNull(), // 'stem', 'explanation', 'passage', 'window'
  content: text("content").notNull(), // The actual text content
  pageNumber: integer("page_number"), // Page where this chunk appears
  sourceQuestionId: varchar("source_question_id").references(() => questions.id, { onDelete: 'cascade' }), // If derived from question
  embedding: jsonb("embedding"), // Vector embedding for similarity search
  metadata: jsonb("metadata"), // Additional context (position, formatting, etc.)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userProgress = pgTable("user_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  questionId: varchar("question_id").references(() => questions.id, { onDelete: 'cascade' }).notNull(),
  isCorrect: boolean("is_correct").notNull(),
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
});

// Notification enums for type safety
export const notificationTypeEnum = z.enum([
  'system_update', 
  'study_reminder', 
  'progress_alert', 
  'achievement', 
  'ai_tutor_suggestion'
]);

export const notificationCategoryEnum = z.enum([
  'study_progress',
  'learning_analytics', 
  'question_updates',
  'motivation',
  'ai_tutor',
  'technical',
  'milestones'
]);

export const notificationPriorityEnum = z.enum(['low', 'normal', 'high', 'urgent']);

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id), // Null for system-wide notifications
  type: text("type").notNull(), // Values from notificationTypeEnum
  category: text("category").notNull(), // Values from notificationCategoryEnum
  title: text("title").notNull(),
  message: text("message").notNull(),
  priority: text("priority").notNull().default("normal"), // Values from notificationPriorityEnum
  isRead: boolean("is_read").default(false).notNull(),
  actionUrl: text("action_url"), // Optional URL to navigate when clicked
  actionText: text("action_text"), // Optional action button text
  metadata: jsonb("metadata"), // Additional data (progress stats, achievement details, etc.)
  expiresAt: timestamp("expires_at"), // Optional expiration for temporary notifications
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notificationReads = pgTable("notification_reads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  notificationId: varchar("notification_id").references(() => notifications.id).notNull(),
  readAt: timestamp("read_at").defaultNow().notNull(),
}, (table) => [
  { uniqueUserNotification: sql`UNIQUE(${table.userId}, ${table.notificationId})` }
]);

// Practice sessions for FlowCards and Structured practice
export const practiceSessions = pgTable("practice_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  mode: text("mode").notNull(), // 'flow', 'structured'
  section: text("section"), // 'math', 'reading', 'writing', 'mixed'
  difficulty: text("difficulty"), // 'easy', 'medium', 'hard', 'adaptive'
  targetDurationMs: integer("target_duration_ms"), // 20 minutes = 1200000ms for structured
  actualDurationMs: integer("actual_duration_ms"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull().default("in_progress"), // 'in_progress', 'completed', 'abandoned'
  questionIds: jsonb("question_ids"), // Array of question IDs for this session
  completed: boolean("completed").default(false).notNull(), // Explicit completion flag
  metadata: jsonb("metadata"), // Additional session data
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Full exam attempts with lockdown browser
export const examAttempts = pgTable("exam_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  examType: text("exam_type").notNull().default("practice"), // 'practice', 'diagnostic'
  startedAt: timestamp("started_at").defaultNow().notNull(),
  submittedAt: timestamp("submitted_at"),
  status: text("status").notNull().default("in_progress"), // 'in_progress', 'submitted', 'failed', 'abandoned'
  violations: integer("violations").default(0), // Number of lockdown violations
  rawScoreMath: integer("raw_score_math"), // Correct answers in math section
  rawScoreRW: integer("raw_score_rw"), // Correct answers in reading & writing
  scaledScoreMath: integer("scaled_score_math"), // 200-800 scaled score
  scaledScoreRW: integer("scaled_score_rw"), // 200-800 scaled score
  totalScore: integer("total_score"), // Combined score 400-1600
  metadata: jsonb("metadata"), // Additional exam data, section timings
});

// Answer attempts for any practice mode
export const answerAttempts = pgTable("answer_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").references(() => practiceSessions.id, { onDelete: 'cascade' }),
  examAttemptId: varchar("exam_attempt_id").references(() => examAttempts.id, { onDelete: 'cascade' }),
  questionId: varchar("question_id").references(() => questions.id, { onDelete: 'cascade' }).notNull(),
  selectedAnswer: text("selected_answer"), // For multiple choice
  freeResponseAnswer: text("free_response_answer"), // For free response
  isCorrect: boolean("is_correct").notNull(),
  outcome: text("outcome").default("correct"), // 'correct' | 'incorrect' | 'skipped'
  timeSpentMs: integer("time_spent_ms"), // Time spent on this question
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
});

// Question feedback - thumbs up/down ratings from students
export const questionFeedback = pgTable("question_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").references(() => questions.id, { onDelete: 'cascade' }).notNull(),
  userId: varchar("user_id").references(() => users.id), // Nullable for anonymous
  practiceSessionId: varchar("practice_session_id").references(() => practiceSessions.id, { onDelete: 'set null' }),
  rating: text("rating").notNull(), // 'up' | 'down'
  timeToAnswerSeconds: integer("time_to_answer_seconds"), // How long student took to answer
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Zod schema for question feedback
export const questionFeedbackRatingEnum = z.enum(['up', 'down']);

export const insertQuestionFeedbackSchema = createInsertSchema(questionFeedback).omit({
  id: true,
  createdAt: true,
});

export type InsertQuestionFeedback = z.infer<typeof insertQuestionFeedbackSchema>;
export type QuestionFeedback = typeof questionFeedback.$inferSelect;

// Exam sections for tracking per-section progress
export const examSections = pgTable("exam_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  examAttemptId: varchar("exam_attempt_id").references(() => examAttempts.id, { onDelete: 'cascade' }).notNull(),
  section: text("section").notNull(), // 'RW1', 'RW2', 'M1', 'M2'
  sectionName: text("section_name").notNull(), // 'Reading & Writing Module 1', etc.
  targetDurationMs: integer("target_duration_ms").notNull(), // Official time limit
  actualDurationMs: integer("actual_duration_ms"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default("pending"), // 'pending', 'in_progress', 'completed', 'timed_out'
});

// DEPRECATED: batch_jobs tables removed - use ingestion_runs instead
// See ingestionRuns table below for current ingestion tracking

// Admin audit logs for tracking administrative actions
export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminUserId: varchar("admin_user_id").references(() => users.id).notNull(),
  action: text("action").notNull(), // 'database_query', 'file_view', 'file_edit', 'system_command', 'user_management'
  resource: text("resource").notNull(), // Table name, file path, or resource identifier
  method: text("method"), // HTTP method or operation type
  details: jsonb("details"), // Operation details, queries executed, etc.
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  success: boolean("success").notNull(),
  error: text("error"), // Error message if operation failed
  executionTimeMs: integer("execution_time_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// System event logs for monitoring PDF processing and application events
export const systemEventLogs = pgTable("system_event_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: text("event_type").notNull(), // 'pdf_processing', 'extraction', 'qa_validation', 'system_error', 'performance'
  level: text("level").notNull().default("info"), // 'debug', 'info', 'warning', 'error', 'critical'
  source: text("source").notNull(), // 'nougat_extractor', 'qa_validation', 'pdf_pipeline', etc.
  message: text("message").notNull(),
  details: jsonb("details"), // Structured event data
  documentId: varchar("document_id").references(() => documents.id), // Related document if applicable
  userId: varchar("user_id").references(() => users.id), // Related user if applicable
  sessionId: text("session_id"), // For tracking related events
  duration: integer("duration"), // Duration in milliseconds if applicable
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================================
// INGESTION V2 PIPELINE TABLES
// ============================================================================

// Ingestion runs - tracks each batch ingestion job with detailed metrics
export const ingestionRuns = pgTable("ingestion_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status").notNull().default("queued"), // 'queued', 'ocr_docai', 'ocr_mathpix_patch', 'ocr_nougat_fallback', 'parsing', 'qa', 'upsert_db', 'embed', 'done', 'failed'
  sourcePdfs: jsonb("source_pdfs").$type<string[]>(), // Array of GCS paths
  totalPages: integer("total_pages").default(0),
  processedPages: integer("processed_pages").default(0),
  totalQuestions: integer("total_questions").default(0),
  insertedQuestions: integer("inserted_questions").default(0),
  duplicateQuestions: integer("duplicate_questions").default(0),
  failedQuestions: integer("failed_questions").default(0),
  needsReviewCount: integer("needs_review_count").default(0),
  // Stage timestamps for observability
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
  // Error tracking
  errorMessage: text("error_message"),
  errorStage: text("error_stage"), // Which stage failed
  // OCR Provider tracing (added for fallback observability)
  providerUsed: text("provider_used"), // Primary OCR provider that succeeded: 'docai' | 'nougat' | 'mathpix' | 'docling' | 'docupipe'
  providerAttempts: jsonb("provider_attempts").$type<string[]>(), // Array of providers attempted in order
  ocrStats: jsonb("ocr_stats").$type<{
    totalPages: number;
    byEngine: Record<string, { pages: number; errors: number }>;
    errors: Array<{ engine: string; message: string }>;
    providerChain?: string[];
    mathpixPatchCount?: number;
    nougatMergeCount?: number;
  }>(),
  // Configuration
  config: jsonb("config").$type<{
    ocrConfidenceThreshold?: number;
    maxConcurrency?: number;
    skipMathpix?: boolean;
    skipNougat?: boolean;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Document pages - stores OCR results per page with provenance
export const documentPages = pgTable("document_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ingestionRunId: varchar("ingestion_run_id").references(() => ingestionRuns.id, { onDelete: 'cascade' }).notNull(),
  sourcePdf: text("source_pdf").notNull(), // GCS path
  pageNumber: integer("page_number").notNull(),
  rawText: text("raw_text").notNull(), // Full OCR text for this page
  // OCR engine metadata
  primaryEngine: text("primary_engine").notNull(), // 'docai' | 'mathpix' | 'nougat'
  patchedByMathpix: boolean("patched_by_mathpix").default(false), // Whether Mathpix patched math regions
  mergedFromNougat: boolean("merged_from_nougat").default(false), // Whether Nougat results were merged
  engineConfidence: real("engine_confidence"), // Average confidence (0.0-1.0)
  // Structured OCR blocks for bbox tracking
  blocks: jsonb("blocks").$type<Array<{
    text: string;
    bbox: number[]; // [x, y, width, height]
    confidence: number;
    type?: 'text' | 'math';
    engine: 'docai' | 'mathpix' | 'nougat';
  }>>(),
  metadata: jsonb("metadata"), // Additional OCR metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Normalized choices table for MC questions
export const choices = pgTable("choices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").references(() => questions.id, { onDelete: 'cascade' }).notNull(),
  choiceKey: text("choice_key").notNull(), // 'A', 'B', 'C', 'D'
  choiceText: text("choice_text").notNull(),
  bbox: jsonb("bbox").$type<number[]>(), // Bounding box [x, y, width, height]
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Media assets (figures, tables, diagrams)
export const media = pgTable("media", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").references(() => questions.id, { onDelete: 'cascade' }),
  documentPageId: varchar("document_page_id").references(() => documentPages.id, { onDelete: 'cascade' }),
  mediaType: text("media_type").notNull(), // 'figure', 'table', 'diagram', 'equation'
  storagePath: text("storage_path"), // GCS path to extracted image
  bbox: jsonb("bbox").$type<number[]>(), // Bounding box in source PDF
  caption: text("caption"), // Extracted or generated caption
  altText: text("alt_text"), // Accessibility description
  metadata: jsonb("metadata"), // Additional media metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Validation issues - tracks QA problems for review
export const validationIssues = pgTable("validation_issues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").references(() => questions.id, { onDelete: 'cascade' }),
  ingestionRunId: varchar("ingestion_run_id").references(() => ingestionRuns.id, { onDelete: 'cascade' }),
  issueType: text("issue_type").notNull(), // 'structure', 'consistency', 'duplicate', 'math_solver_failed', 'missing_explanation', 'low_confidence'
  severity: text("severity").notNull(), // 'error', 'warning', 'info'
  message: text("message").notNull(),
  details: jsonb("details"), // Structured details about the issue
  resolved: boolean("resolved").default(false),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Question embeddings - vector embeddings for RAG with metadata
export const questionEmbeddings = pgTable("question_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").references(() => questions.id, { onDelete: 'cascade' }).notNull(),
  chunkType: text("chunk_type").notNull(), // 'Q' (question+options) | 'E' (explanation)
  content: text("content").notNull(), // The text that was embedded
  embedding: jsonb("embedding").notNull(), // Vector embedding array
  // Provenance metadata for citations
  sourcePdf: text("source_pdf"),
  pageNumber: integer("page_number"),
  bbox: jsonb("bbox").$type<number[]>(),
  engineUsed: text("engine_used"), // OCR engine that extracted this content
  // Supabase vector search metadata (extended for Ingestion v2)
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

// Insert schemas
export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  uploadedAt: true,
  processedAt: true,
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

export const insertQuestionSchema = createInsertSchema(questions).omit({
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

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
}).extend({
  type: notificationTypeEnum,
  category: notificationCategoryEnum, 
  priority: notificationPriorityEnum.optional()
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

// DEPRECATED: batch job schemas removed - use ingestion_runs instead

export const insertAdminAuditLogSchema = createInsertSchema(adminAuditLogs).omit({
  id: true,
  createdAt: true,
});

export const insertSystemEventLogSchema = createInsertSchema(systemEventLogs).omit({
  id: true,
  createdAt: true,
});

// Ingestion v2 insert schemas
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

export const insertMediaSchema = createInsertSchema(media).omit({
  id: true,
  createdAt: true,
});

export const insertValidationIssueSchema = createInsertSchema(validationIssues).omit({
  id: true,
  createdAt: true,
});

export const insertQuestionEmbeddingSchema = createInsertSchema(questionEmbeddings).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questions.$inferSelect;

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

export type InsertDocChunk = z.infer<typeof insertDocChunkSchema>;
export type DocChunk = typeof docChunks.$inferSelect;

export type InsertUserProgress = z.infer<typeof insertUserProgressSchema>;
export type UserProgress = typeof userProgress.$inferSelect;

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// Export notification enums for frontend use
export type NotificationType = z.infer<typeof notificationTypeEnum>;
export type NotificationCategory = z.infer<typeof notificationCategoryEnum>;
export type NotificationPriority = z.infer<typeof notificationPriorityEnum>;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// New practice session types
export type InsertPracticeSession = z.infer<typeof insertPracticeSessionSchema>;
export type PracticeSession = typeof practiceSessions.$inferSelect;

export type InsertAnswerAttempt = z.infer<typeof insertAnswerAttemptSchema>;
export type AnswerAttempt = typeof answerAttempts.$inferSelect;

export type InsertExamAttempt = z.infer<typeof insertExamAttemptSchema>;
export type ExamAttempt = typeof examAttempts.$inferSelect;

export type InsertExamSection = z.infer<typeof insertExamSectionSchema>;
export type ExamSection = typeof examSections.$inferSelect;

// DEPRECATED: BatchJob and BatchFileProgress types removed - use IngestionRun instead

export type InsertAdminAuditLog = z.infer<typeof insertAdminAuditLogSchema>;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;

export type InsertSystemEventLog = z.infer<typeof insertSystemEventLogSchema>;
export type SystemEventLog = typeof systemEventLogs.$inferSelect;

// Ingestion v2 types
export type InsertIngestionRun = z.infer<typeof insertIngestionRunSchema>;
export type IngestionRun = typeof ingestionRuns.$inferSelect;

export type InsertDocumentPage = z.infer<typeof insertDocumentPageSchema>;
export type DocumentPage = typeof documentPages.$inferSelect;

export type InsertChoice = z.infer<typeof insertChoiceSchema>;
export type Choice = typeof choices.$inferSelect;

export type InsertMedia = z.infer<typeof insertMediaSchema>;
export type Media = typeof media.$inferSelect;

export type InsertValidationIssue = z.infer<typeof insertValidationIssueSchema>;
export type ValidationIssue = typeof validationIssues.$inferSelect;

export type InsertQuestionEmbedding = z.infer<typeof insertQuestionEmbeddingSchema>;
export type QuestionEmbedding = typeof questionEmbeddings.$inferSelect;

// Additional types for API responses
export interface QuestionOption {
  key: string;
  text: string;
}

// Structured AI classification data
export interface QuestionClassification {
  topic: string; // Main domain/topic (e.g., "Algebra", "Reading Comprehension")
  subtopic: string; // Specific skill area (e.g., "Linear inequalities in one or two variables")
  skills: string[]; // Array of specific skills
  questionType: string; // "Multiple Choice", "Grid-In", etc.
  calculatorAllowed: boolean;
  cognitiveLevel: string; // "Knowledge", "Application", "Analysis"
  difficultyText: string; // "Easy", "Medium", "Hard"
  difficultyNumeric: number; // 1, 2, 3
  standardIds: string[]; // Array of standard IDs if available
}

// PDF source structure metadata
export interface SourceMapping {
  docType: 'practice' | 'qbank' | 'answers' | 'generic';
  profile: string; // "practice-test-math", "answer-explanations", etc.
  hasColumns: boolean;
  optionStyle: string; // "A.", "(A)", "A)"
  numberingStyle: string; // "1.", "Question 1", etc.
  answerKeyPresent: boolean;
  explanationMarkers: string[]; // ["Explanation:", "Rationale:", etc.]
}

// Enhanced source information for RAG responses
export interface SourceInfo {
  type: 'question' | 'chunk';
  id: string;
  documentName: string;
  pageNumber?: number;
  questionNumber?: number;
  chunkType?: 'stem' | 'explanation' | 'passage' | 'window';
  snippet: string;
}

export interface ChatResponse {
  response: string;
  sources: Array<SourceInfo>;
  confidence: number;
}

export interface ProgressStats {
  totalQuestions: number;
  mathProgress: number;
  readingProgress: number;
  writingProgress: number;
}

// Detailed analytics types for user progress tracking
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
