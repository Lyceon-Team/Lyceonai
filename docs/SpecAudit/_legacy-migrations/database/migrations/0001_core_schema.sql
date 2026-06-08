-- Migration 0001: Core Schema
-- Creates all tables with proper FKs, indexes, and extensions
-- Compatible with Supabase PostgreSQL with RLS support

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- CORE USER & ORGANIZATION TABLES
-- ============================================================================

-- Users table (maps to Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  password TEXT, -- For local auth (optional, Supabase handles OAuth)
  google_id TEXT UNIQUE,
  name TEXT,
  avatar_url TEXT,
  is_admin BOOLEAN DEFAULT FALSE NOT NULL,
  admin_permissions JSONB,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Profile fields
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT,
  date_of_birth TIMESTAMPTZ,
  address JSONB, -- {street, city, state, zipCode, country}
  time_zone TEXT,
  profile_completed_at TIMESTAMPTZ,
  preferred_language TEXT DEFAULT 'en',
  marketing_opt_in BOOLEAN DEFAULT FALSE,
  terms_accepted_at TIMESTAMPTZ,
  privacy_policy_accepted_at TIMESTAMPTZ,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verification_token TEXT,
  password_reset_token TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret TEXT,
  recovery_codes_used JSONB,
  login_attempts INTEGER DEFAULT 0 NOT NULL,
  locked_until TIMESTAMPTZ
);

-- Organizations table
CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  settings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Memberships table (user-org relationships)
CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(org_id, user_id)
);

-- ============================================================================
-- COURSE & CONTENT TABLES
-- ============================================================================

-- Courses table
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  source_type TEXT, -- 'sat_official', 'custom', 'ai_generated'
  source_ref TEXT,
  visibility TEXT CHECK (visibility IN ('private', 'org', 'public')) DEFAULT 'org',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Course sections
CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Section items (videos, notes, quizzes, flashcards)
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('video', 'note', 'quiz', 'flashcards')),
  source_ref TEXT,
  position INTEGER NOT NULL,
  meta_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- DOCUMENT PROCESSING TABLES
-- ============================================================================

-- Documents table (uploaded PDFs)
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  page_count INTEGER,
  uploaded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  total_questions INTEGER DEFAULT 0,
  extraction_method TEXT,
  extraction_confidence INTEGER
);

-- Transcripts (for video/audio content)
CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  source_ref TEXT NOT NULL,
  text TEXT NOT NULL,
  language TEXT DEFAULT 'en',
  timing_json JSONB, -- Timestamped segments
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Content chunks (for RAG)
CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  source_ref TEXT,
  content TEXT NOT NULL,
  type TEXT, -- 'stem', 'explanation', 'passage', 'window'
  page_number INTEGER,
  source_question_id UUID, -- Will FK after questions table created
  meta_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Embeddings (vector storage)
CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID REFERENCES chunks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'openai', 'gemini'
  model TEXT NOT NULL, -- 'text-embedding-3-small', 'text-embedding-004'
  dim INTEGER NOT NULL, -- 1536, 768
  vec VECTOR, -- pgvector type
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- QUESTION & ASSESSMENT TABLES
-- ============================================================================

-- Questions table (canonical normalized schema)
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  published_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id),

  section TEXT NOT NULL,
  section_code TEXT NOT NULL CHECK (section_code IN ('MATH', 'RW')),
  question_type TEXT NOT NULL DEFAULT 'multiple_choice' CHECK (question_type = 'multiple_choice'),
  stem TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_answer TEXT NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
  answer_text TEXT NOT NULL,
  explanation TEXT NOT NULL,
  option_metadata JSONB NOT NULL,

  domain TEXT NOT NULL,
  skill TEXT NOT NULL,
  subskill TEXT NOT NULL,
  skill_code TEXT NOT NULL,
  difficulty INTEGER NOT NULL CHECK (difficulty IN (1, 2, 3)),

  source_type INTEGER NOT NULL DEFAULT 0 CHECK (source_type IN (0, 1, 2, 3)),
  test_code TEXT,
  exam TEXT,
  ai_generated BOOLEAN,

  diagram_present BOOLEAN,
  tags JSONB,
  competencies JSONB,
  provenance_chunk_ids JSONB
);

-- Add FK from chunks to questions
ALTER TABLE chunks 
ADD CONSTRAINT fk_chunks_question 
FOREIGN KEY (source_question_id) REFERENCES questions(id) ON DELETE CASCADE;

-- ============================================================================
-- USER PROGRESS & PRACTICE TABLES
-- ============================================================================

-- User progress on individual questions
CREATE TABLE IF NOT EXISTS progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
  pct NUMERIC CHECK (pct BETWEEN 0 AND 100),
  last_item_id UUID,
  is_correct BOOLEAN,
  attempted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, course_id, question_id)
);

-- Practice sessions
CREATE TABLE IF NOT EXISTS practice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL, -- 'flow', 'structured'
  section TEXT, -- 'math', 'reading', 'writing', 'mixed'
  difficulty TEXT, -- 'easy', 'medium', 'hard', 'adaptive'
  target_duration_ms INTEGER,
  actual_duration_ms INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  question_ids JSONB, -- Array of question IDs
  completed BOOLEAN DEFAULT FALSE NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Exam attempts
CREATE TABLE IF NOT EXISTS exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_type TEXT NOT NULL DEFAULT 'practice' CHECK (exam_type IN ('practice', 'diagnostic')),
  started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  submitted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'failed', 'abandoned')),
  violations INTEGER DEFAULT 0,
  raw_score_math INTEGER,
  raw_score_rw INTEGER,
  scaled_score_math INTEGER,
  scaled_score_rw INTEGER,
  total_score INTEGER,
  metadata JSONB
);

-- Answer attempts (for practice and exams)
CREATE TABLE IF NOT EXISTS attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES practice_sessions(id) ON DELETE CASCADE,
  exam_attempt_id UUID REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_answer TEXT,
  free_response_answer TEXT,
  chosen TEXT,
  correct BOOLEAN NOT NULL,
  is_correct BOOLEAN NOT NULL,
  time_spent_ms INTEGER,
  elapsed_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Exam sections
CREATE TABLE IF NOT EXISTS exam_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_attempt_id UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  section TEXT NOT NULL, -- 'RW1', 'RW2', 'M1', 'M2'
  section_name TEXT NOT NULL,
  target_duration_ms INTEGER NOT NULL,
  actual_duration_ms INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'timed_out'))
);

-- ============================================================================
-- NOTIFICATION & COMMUNICATION TABLES
-- ============================================================================

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  is_read BOOLEAN DEFAULT FALSE NOT NULL,
  action_url TEXT,
  action_text TEXT,
  metadata JSONB,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Chat messages (AI tutor conversations)
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  response TEXT NOT NULL,
  sources JSONB, -- Question IDs used as context
  timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- BATCH PROCESSING & JOBS
-- ============================================================================

-- Batch jobs for bulk operations
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'bulk_ingestion',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input_json JSONB,
  output_json JSONB,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  next_run_at TIMESTAMPTZ,
  total_files INTEGER,
  completed_files INTEGER DEFAULT 0,
  failed_files INTEGER DEFAULT 0,
  total_questions INTEGER DEFAULT 0,
  imported_questions INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  configuration JSONB,
  error_summary TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Batch file progress
CREATE TABLE IF NOT EXISTS batch_file_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  extraction_method TEXT,
  questions_found INTEGER,
  questions_imported INTEGER,
  processing_time_ms INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- AUDIT & LOGGING TABLES
-- ============================================================================

-- Admin audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  admin_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  resource TEXT NOT NULL,
  method TEXT,
  payload_json JSONB,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL,
  error TEXT,
  execution_time_ms INTEGER,
  at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- System event logs
CREATE TABLE IF NOT EXISTS system_event_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warning', 'error', 'critical')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  document_id UUID REFERENCES documents(id),
  user_id UUID REFERENCES users(id),
  session_id TEXT,
  duration INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Membership indexes
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id);

-- Course indexes
CREATE INDEX IF NOT EXISTS idx_courses_org ON courses(org_id);
CREATE INDEX IF NOT EXISTS idx_courses_created_by ON courses(created_by);
CREATE INDEX IF NOT EXISTS idx_courses_visibility ON courses(visibility);

-- Section indexes
CREATE INDEX IF NOT EXISTS idx_sections_course ON sections(course_id);

-- Item indexes
CREATE INDEX IF NOT EXISTS idx_items_section ON items(section_id);

-- Document indexes
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);

-- Chunk indexes
CREATE INDEX IF NOT EXISTS idx_chunks_course ON chunks(course_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);

-- Embedding indexes
CREATE INDEX IF NOT EXISTS idx_embeddings_chunk ON embeddings(chunk_id);

-- Question indexes
CREATE INDEX IF NOT EXISTS idx_questions_section ON questions(section_code);

-- Progress indexes
CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_user_course ON progress(user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_progress_question ON progress(question_id);

-- Practice session indexes
CREATE INDEX IF NOT EXISTS idx_practice_sessions_user ON practice_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_status ON practice_sessions(status);

-- Exam attempt indexes
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user ON exam_attempts(user_id);

-- Attempt indexes
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_attempts_question ON attempts(question_id);

-- Notification indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;

-- Chat message indexes
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);

-- Job indexes
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- Audit log indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_user ON audit_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- System event log indexes
CREATE INDEX IF NOT EXISTS idx_system_event_logs_user ON system_event_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_system_event_logs_level ON system_event_logs(level);
CREATE INDEX IF NOT EXISTS idx_system_event_logs_created_at ON system_event_logs(created_at);

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orgs_updated_at BEFORE UPDATE ON orgs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sections_updated_at BEFORE UPDATE ON sections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_items_updated_at BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transcripts_updated_at BEFORE UPDATE ON transcripts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_chunks_updated_at BEFORE UPDATE ON chunks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_questions_updated_at BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_progress_updated_at BEFORE UPDATE ON progress FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_practice_sessions_updated_at BEFORE UPDATE ON practice_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON SCHEMA public IS 'SAT Learning Copilot - Core Schema v1';

CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
CREATE INDEX IF NOT EXISTS idx_questions_question_type ON questions(question_type);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);

