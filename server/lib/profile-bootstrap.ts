import type { SupabaseClient, User } from '@supabase/supabase-js';
import { logger } from '../logger.js';
import { normalizeRuntimeRole, type RuntimeRole } from './auth-role.js';

const PROFILE_SELECT = 'id, email, display_name, role, is_under_13, guardian_consent, guardian_email, student_link_code, profile_completed_at';

type ProfileRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: RuntimeRole;
  is_under_13: boolean;
  guardian_consent: boolean;
  guardian_email: string | null;
  student_link_code: string | null;
  profile_completed_at: string | null;
};

type EnsureProfileContext = {
  source: 'supabase_auth_middleware' | 'google_oauth_callback';
  requestId?: string;
};

function resolveBootstrapRoleFromMetadata(user: User): 'student' | 'guardian' {
  const metadataRole = user.user_metadata?.role;

  if (metadataRole === 'admin') {
    logger.warn('AUTH', 'admin_role_blocked', 'Blocked attempt to bootstrap admin role from user metadata', {
      userId: user.id,
      email: user.email,
    });
    return 'student';
  }

  return metadataRole === 'guardian' ? 'guardian' : 'student';
}

export async function ensureProfileForAuthUser(
  supabaseAdmin: SupabaseClient,
  user: User,
  context: EnsureProfileContext,
): Promise<ProfileRow> {
  const { data: existingProfile, error: existingProfileError } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', user.id)
    .maybeSingle();

  if (existingProfileError && existingProfileError.code !== 'PGRST116') {
    throw new Error(`Failed to load profile for auth user: ${existingProfileError.message}`);
  }

  if (existingProfile) {
    const normalizedRole = normalizeRuntimeRole(existingProfile.role);

    if (existingProfile.role !== normalizedRole) {
      const { data: updatedProfile, error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          role: normalizedRole,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
        .select(PROFILE_SELECT)
        .single();

      if (updateError || !updatedProfile) {
        throw new Error(`Failed to normalize profile role: ${updateError?.message || 'profile update returned null'}`);
      }

      logger.info('AUTH', 'profile_role_normalized', 'Normalized legacy or missing profile role', {
        userId: user.id,
        fromRole: existingProfile.role,
        toRole: normalizedRole,
        source: context.source,
        requestId: context.requestId,
      });

      return {
        ...(updatedProfile as Omit<ProfileRow, 'role'>),
        role: normalizedRole,
      };
    }

    return {
      ...(existingProfile as Omit<ProfileRow, 'role'>),
      role: normalizedRole,
    };
  }

  const bootstrapRole = resolveBootstrapRoleFromMetadata(user);

  const { data: newProfile, error: createError } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: user.id,
      email: user.email || '',
      display_name: user.user_metadata?.display_name || user.user_metadata?.full_name || null,
      role: bootstrapRole,
      is_under_13: user.user_metadata?.is_under_13 || false,
      guardian_consent: user.user_metadata?.guardian_consent || false,
      guardian_email: user.user_metadata?.guardian_email || null,
    })
    .select(PROFILE_SELECT)
    .single();

  if (createError || !newProfile) {
    throw new Error(`Failed to auto-create profile: ${createError?.message || 'profile insert returned null'}`);
  }

  logger.info('AUTH', 'profile_auto_created', 'Profile auto-created with canonical bootstrap role', {
    userId: newProfile.id,
    role: bootstrapRole,
    source: context.source,
    requestId: context.requestId,
  });

  return {
    ...(newProfile as Omit<ProfileRow, 'role'>),
    role: bootstrapRole,
  };
}

