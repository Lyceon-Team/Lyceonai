-- =====================================================================
-- SUPABASE AUTH MIGRATION - AUTH & PROFILES ONLY
-- =====================================================================
-- Creates authentication tables in Supabase
-- Questions table stays in local PostgreSQL database
-- =====================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- 1. PROFILES TABLE (Extends Supabase auth.users)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  display_name text,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  
  -- Under-13 consent tracking (FERPA requirement)
  is_under_13 boolean DEFAULT false,
  guardian_consent boolean DEFAULT false,
  guardian_email text,
  consent_given_at timestamp with time zone,
  
  created_at timestamp with time zone DEFAULT NOW() NOT NULL,
  updated_at timestamp with time zone DEFAULT NOW() NOT NULL,
  last_login_at timestamp with time zone
);

-- =====================================================================
-- 2. PRACTICE SESSIONS TABLE
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.practice_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  
  started_at timestamp with time zone DEFAULT NOW() NOT NULL,
  completed_at timestamp with time zone,
  total_questions integer DEFAULT 0,
  correct_answers integer DEFAULT 0,
  section text,
  difficulty_level integer,
  average_time_per_question interval,
  topics_covered text[],
  
  created_at timestamp with time zone DEFAULT NOW() NOT NULL
);

-- =====================================================================
-- 3. ANSWER ATTEMPTS TABLE  
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.answer_attempts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id uuid REFERENCES public.practice_sessions(id) ON DELETE CASCADE NOT NULL,
  student_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  question_id varchar, -- No FK constraint - questions are in different database
  
  user_answer text,
  is_correct boolean NOT NULL,
  time_spent interval,
  attempted_at timestamp with time zone DEFAULT NOW() NOT NULL
);

-- =====================================================================
-- 4. ADMIN AUDIT LOGS TABLE
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_id uuid,
  target_type text,
  details jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamp with time zone DEFAULT NOW() NOT NULL
);

-- =====================================================================
-- ENABLE RLS ON ALL TABLES
-- =====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- RLS POLICIES - PROFILES
-- =====================================================================

CREATE POLICY "Students can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Students can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id AND
    role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Admins have full access to profiles"
  ON public.profiles FOR ALL
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- =====================================================================
-- RLS POLICIES - PRACTICE SESSIONS
-- =====================================================================

CREATE POLICY "Students can manage own sessions"
  ON public.practice_sessions FOR ALL
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Admins have full access to sessions"
  ON public.practice_sessions FOR ALL
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- =====================================================================
-- RLS POLICIES - ANSWER ATTEMPTS
-- =====================================================================

CREATE POLICY "Students can manage own attempts"
  ON public.answer_attempts FOR ALL
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Admins have full access to attempts"
  ON public.answer_attempts FOR ALL
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- =====================================================================
-- RLS POLICIES - ADMIN AUDIT LOGS
-- =====================================================================

CREATE POLICY "Only admins can read audit logs"
  ON public.admin_audit_logs FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    'student'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- =====================================================================
-- INDEXES
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_student ON public.practice_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_answer_attempts_session ON public.answer_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_answer_attempts_student ON public.answer_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.admin_audit_logs(actor_id);

-- =====================================================================
-- PERMISSIONS
-- =====================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.answer_attempts TO authenticated;
GRANT SELECT ON public.admin_audit_logs TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- =====================================================================
-- COMPLETE ✅
-- =====================================================================
-- Supabase auth tables created:
-- ✅ profiles (student/admin roles, under-13 consent)
-- ✅ practice_sessions
-- ✅ answer_attempts  
-- ✅ admin_audit_logs
-- ✅ RLS policies (students see own data, admins see all)
-- ✅ Auto-profile creation trigger
--
-- Note: Questions table stays in local PostgreSQL database
-- =====================================================================
