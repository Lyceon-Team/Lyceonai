// Types for Supabase auth
export interface SupabaseProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: 'student' | 'admin' | 'guardian';
  is_under_13: boolean;
  guardian_consent: boolean;
  guardian_email: string | null;
  student_link_code: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  // Onboarding and status flags
  profile_completed_at?: string | null;
  requiredConsentsComplete?: boolean;
  requiredProfileComplete?: boolean;
  guardianConsentRequired?: boolean;
}
