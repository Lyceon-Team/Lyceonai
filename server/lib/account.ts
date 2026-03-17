/**
 * Get guardian link for a specific studentId from canonical guardian_links table.
 * Only returns ACTIVE links.
 * Returns { account_id, student_user_id } if linked, else null.
 */
export async function getGuardianLinkForStudent(guardianProfileId: string, studentId: string): Promise<{ account_id: string | null, student_user_id: string } | null> {
  const { data, error } = await supabaseServer
    .from('guardian_links')
    .select('account_id, student_user_id')
    .eq('guardian_profile_id', guardianProfileId)
    .eq('student_user_id', studentId)
    .eq('status', 'active')
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('[Account] Failed to get guardian link for student:', error);
    throw new Error(`Failed to get guardian link: ${error.message}`);
  }
  return data || null;
}

/**
 * Check if a guardian is actively linked to a specific student.
 * Canonical check: guardian_links WHERE status = 'active'.
 */
export async function isGuardianLinkedToStudent(guardianProfileId: string, studentId: string): Promise<boolean> {
  const link = await getGuardianLinkForStudent(guardianProfileId, studentId);
  return link !== null;
}

/**
 * Create a new guardian↔student link in the canonical guardian_links table.
 */
export async function createGuardianLink(
  guardianProfileId: string,
  studentId: string,
  accountId?: string
): Promise<{ id: string; guardian_profile_id: string; student_user_id: string }> {
  const { data: guardianActiveLinks, error: guardianLinksError } = await supabaseServer
    .from('guardian_links')
    .select('student_user_id')
    .eq('guardian_profile_id', guardianProfileId)
    .eq('status', 'active')
    .order('linked_at', { ascending: true })
    .limit(2);

  if (guardianLinksError) {
    throw new Error(`Failed to validate guardian active links: ${guardianLinksError.message}`);
  }

  if ((guardianActiveLinks || []).some((row: any) => row.student_user_id !== studentId)) {
    const conflictErr = new Error('Guardian already has an active linked student');
    (conflictErr as any).code = 'GUARDIAN_ALREADY_LINKED';
    throw conflictErr;
  }

  const { data: studentActiveLinks, error: studentLinksError } = await supabaseServer
    .from('guardian_links')
    .select('guardian_profile_id')
    .eq('student_user_id', studentId)
    .eq('status', 'active')
    .order('linked_at', { ascending: true })
    .limit(2);

  if (studentLinksError) {
    throw new Error(`Failed to validate student active links: ${studentLinksError.message}`);
  }

  if ((studentActiveLinks || []).some((row: any) => row.guardian_profile_id !== guardianProfileId)) {
    const conflictErr = new Error('Student is already linked to another guardian');
    (conflictErr as any).code = 'STUDENT_ALREADY_LINKED';
    throw conflictErr;
  }

  const { data, error } = await supabaseServer
    .from('guardian_links')
    .upsert(
      {
        guardian_profile_id: guardianProfileId,
        student_user_id: studentId,
        account_id: accountId || null,
        status: 'active',
        linked_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: 'guardian_profile_id,student_user_id' }
    )
    .select('id, guardian_profile_id, student_user_id')
    .single();

  if (error) {
    console.error('[Account] Failed to create guardian link:', error);
    throw new Error(`Failed to create guardian link: ${error.message}`);
  }

  return data;
}

/**
 * Revoke a guardian↔student link. Sets status='revoked' in guardian_links.
 * Immediately revokes guardian visibility without affecting student data.
 */
export async function revokeGuardianLink(
  guardianProfileId: string,
  studentId: string
): Promise<void> {
  // Revoke in canonical table
  const { data, error } = await supabaseServer
    .from('guardian_links')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('guardian_profile_id', guardianProfileId)
    .eq('student_user_id', studentId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[Account] Failed to revoke guardian link:', error);
    throw new Error(`Failed to revoke guardian link: ${error.message}`);
  }

  if (!data?.id) {
    const conflictErr = new Error('Guardian link is not active');
    (conflictErr as any).code = 'LINK_NOT_ACTIVE';
    throw conflictErr;
  }

}
import { supabaseServer } from '../../apps/api/src/lib/supabase-server';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Ensures a user has an associated lyceon_account and membership.
 * Calls the RPC ensure_account_for_user(p_user_id, p_role) to create or fetch account.
 * Returns the account_id.
 */
export async function ensureAccountForUser(
  supabase: SupabaseClient,
  userId: string,
  role: 'student' | 'guardian' | 'admin'
): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_account_for_user', {
    p_user_id: userId,
    p_role: role,
  });

  if (error) {
    console.error('[Account] RPC ensure_account_for_user failed:', error);
    throw new Error(
      `RPC ensure_account_for_user failed: code=${error.code} message=${error.message} details=${error.details ?? ''} hint=${error.hint ?? ''}`
    );
  }

  if (!data) {
    throw new Error('RPC ensure_account_for_user returned no accountId');
  }

  return data as string;
}

/**
 * Get account_id for a user by looking up lyceon_account_members
 */
export async function getAccountIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from('lyceon_account_members')
    .select('account_id')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[Account] Failed to get account for user:', error);
    throw new Error(`Failed to get account: ${error.message}`);
  }

  return data?.account_id || null;
}

/**
 * Get all account memberships for a user
 */
export async function getAllAccountsForUser(userId: string): Promise<Array<{ accountId: string; role: string; createdAt: string }>> {
  const { data, error } = await supabaseServer
    .from('lyceon_account_members')
    .select('account_id, role, lyceon_accounts(created_at)')
    .eq('user_id', userId)
    .order('created_at', { foreignTable: 'lyceon_accounts', ascending: false });

  if (error) {
    console.error('[Account] Failed to get accounts for user:', error);
    throw new Error(`Failed to get accounts: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    accountId: row.account_id,
    role: row.role,
    createdAt: row.lyceon_accounts?.created_at || new Date().toISOString(),
  }));
}

interface Entitlement {
  account_id: string;
  plan: 'free' | 'paid';
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
}

export type PairPremiumSource = 'student' | 'guardian' | 'both' | 'none';

export interface LinkedPairPremiumAccess {
  role: 'student' | 'guardian';
  hasPremiumAccess: boolean;
  hasActiveLink: boolean;
  premiumSource: PairPremiumSource;
  reason: string;
  studentUserId: string | null;
  guardianUserId: string | null;
  studentAccountId: string | null;
  guardianAccountId: string | null;
  studentEntitlementStatus: Entitlement['status'] | 'missing';
  guardianEntitlementStatus: Entitlement['status'] | 'missing';
  studentEntitlementExpired: boolean;
  guardianEntitlementExpired: boolean;
}

export function isEntitlementActive(entitlement: Entitlement | null): boolean {
  if (!entitlement) return false;
  if (entitlement.plan !== 'paid') return false;
  if (entitlement.status !== 'active' && entitlement.status !== 'trialing') return false;
  if (!entitlement.current_period_end) return true;
  return new Date(entitlement.current_period_end) > new Date();
}

function isEntitlementExpired(entitlement: Entitlement | null): boolean {
  if (!entitlement?.current_period_end) return false;
  return new Date(entitlement.current_period_end) <= new Date();
}
interface UsageDaily {
  practice_questions_used: number;
  ai_messages_used: number;
}

const FREE_TIER_LIMITS = {
  practice: 10,
  ai_chat: 5,
};

/**
 * Get or create entitlement by account_id
 */
export async function getOrCreateEntitlement(accountId: string): Promise<Entitlement> {
  const { data: existing, error: fetchErr } = await supabaseServer
    .from('entitlements')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (existing) {
    return existing as Entitlement;
  }

  if (fetchErr && fetchErr.code !== 'PGRST116') {
    throw new Error(`Failed to fetch entitlement: ${fetchErr.message}`);
  }

  const { data: created, error: createErr } = await supabaseServer
    .from('entitlements')
    .insert({ account_id: accountId, plan: 'free', status: 'inactive' })
    .select()
    .single();

  if (createErr) {
    throw new Error(`Failed to create entitlement: ${createErr.message}`);
  }

  return created as Entitlement;
}

/**
 * Get entitlement by account_id
 */
export async function getEntitlement(accountId: string): Promise<Entitlement | null> {
  const { data, error } = await supabaseServer
    .from('entitlements')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch entitlement: ${error.message}`);
  }

  return data as Entitlement | null;
}

/**
 * Upsert entitlement by account_id (UNIQUE constraint)
 */
export async function upsertEntitlement(
  accountId: string,
  updates: Partial<Omit<Entitlement, 'account_id'>>
): Promise<Entitlement> {
  const { data, error } = await supabaseServer
    .from('entitlements')
    .upsert(
      { account_id: accountId, ...updates },
      { onConflict: 'account_id' }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upsert entitlement: ${error.message}`);
  }

  return data as Entitlement;
}

/**
 * Get entitlement by Stripe customer ID
 */
export async function getEntitlementByStripeCustomer(customerId: string): Promise<Entitlement | null> {
  const { data, error } = await supabaseServer
    .from('entitlements')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch entitlement by customer: ${error.message}`);
  }

  return data as Entitlement | null;
}

/**
 * Get daily usage by account_id + day (UTC date)
 */
export async function getDailyUsage(accountId: string): Promise<UsageDaily> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabaseServer
    .from('usage_daily')
    .select('practice_questions_used, ai_messages_used')
    .eq('account_id', accountId)
    .eq('day', today)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch daily usage: ${error.message}`);
  }

  return data || { practice_questions_used: 0, ai_messages_used: 0 };
}

/**
 * Increment usage by account_id + day
 */
export async function incrementUsage(accountId: string, type: 'practice' | 'ai_chat'): Promise<UsageDaily> {
  const today = new Date().toISOString().split('T')[0];
  const column = type === 'practice' ? 'practice_questions_used' : 'ai_messages_used';

  const { data: existing } = await supabaseServer
    .from('usage_daily')
    .select('*')
    .eq('account_id', accountId)
    .eq('day', today)
    .single();

  if (existing) {
    const { data, error } = await supabaseServer
      .from('usage_daily')
      .update({
        [column]: (existing[column] || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('day', today)
      .select('practice_questions_used, ai_messages_used')
      .single();

    if (error) throw new Error(`Failed to increment usage: ${error.message}`);
    return data as UsageDaily;
  }

  const { data, error } = await supabaseServer
    .from('usage_daily')
    .insert({
      account_id: accountId,
      day: today,
      practice_questions_used: type === 'practice' ? 1 : 0,
      ai_messages_used: type === 'ai_chat' ? 1 : 0,
      updated_at: new Date().toISOString(),
    })
    .select('practice_questions_used, ai_messages_used')
    .single();

  if (error) throw new Error(`Failed to create usage record: ${error.message}`);
  return data as UsageDaily;
}

/**
 * Check usage limit by account_id
 * Free limits: practice 10/day, ai_chat 5/day
 */
export async function checkUsageLimit(
  accountId: string,
  type: 'practice' | 'ai_chat',
  options?: { premiumOverride?: boolean }
): Promise<{ allowed: boolean; current: number; limit: number; resetAt: string }> {
  if (options?.premiumOverride) {
    return { allowed: true, current: 0, limit: Infinity, resetAt: '' };
  }

  const entitlement = await getEntitlement(accountId);
  const isPaid = isEntitlementActive(entitlement);

  if (isPaid) {
    return { allowed: true, current: 0, limit: Infinity, resetAt: '' };
  }

  const usage = await getDailyUsage(accountId);
  const current = type === 'practice' ? usage.practice_questions_used : usage.ai_messages_used;
  const limit = FREE_TIER_LIMITS[type];

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const resetAt = tomorrow.toISOString();

  return {
    allowed: current < limit,
    current,
    limit,
    resetAt,
  };
}

/**
 * Get the primary linked student for a guardian.
 * CANONICAL: Reads from guardian_links WHERE status='active'.
 * Returns the first linked student's user_id.
 */
export async function getPrimaryGuardianLink(guardianUserId: string): Promise<{ student_user_id: string; account_id: string | null } | null> {
  const { data, error } = await supabaseServer
    .from('guardian_links')
    .select('student_user_id, account_id, linked_at')
    .eq('guardian_profile_id', guardianUserId)
    .eq('status', 'active')
    .order('linked_at', { ascending: true })
    .limit(2);

  if (error) {
    console.error('[Account] Failed to get primary guardian link:', error);
    throw new Error(`Failed to get primary guardian link: ${error.message}`);
  }

  if ((data || []).length > 1) {
    throw new Error('Guardian has multiple active student links; 1:1 invariant violated');
  }

  const link = data?.[0];
  if (!link?.student_user_id) {
    return null;
  }

  return {
    student_user_id: link.student_user_id,
    account_id: link.account_id ?? null,
  };
}


/**
 * Get ALL active student links for a guardian.
 * CANONICAL: Reads from guardian_links WHERE status='active'.
 */
export async function getAllGuardianStudentLinks(guardianUserId: string): Promise<Array<{ student_user_id: string; linked_at: string }>> {
  const { data, error } = await supabaseServer
    .from('guardian_links')
    .select('student_user_id, linked_at')
    .eq('guardian_profile_id', guardianUserId)
    .eq('status', 'active')
    .order('linked_at', { ascending: true })
    .limit(2);

  if (error) {
    console.error('[Account] Failed to get guardian student links:', error);
    throw new Error(`Failed to get guardian student links: ${error.message}`);
  }

  if ((data || []).length > 1) {
    throw new Error('Guardian has multiple active student links; 1:1 invariant violated');
  }

  return data || [];
}

export async function getLinkedGuardianForStudent(studentUserId: string): Promise<{ guardian_profile_id: string; account_id: string | null } | null> {
  const { data, error } = await supabaseServer
    .from('guardian_links')
    .select('guardian_profile_id, account_id, linked_at')
    .eq('student_user_id', studentUserId)
    .eq('status', 'active')
    .order('linked_at', { ascending: true })
    .limit(2);

  if (error) {
    throw new Error(`Failed to get linked guardian: ${error.message}`);
  }

  if ((data || []).length > 1) {
    throw new Error('Student has multiple active guardian links; 1:1 invariant violated');
  }

  const link = data?.[0];
  if (!link?.guardian_profile_id) {
    return null;
  }

  return {
    guardian_profile_id: link.guardian_profile_id,
    account_id: link.account_id ?? null,
  };
}

function resolvePremiumSource(studentActive: boolean, guardianActive: boolean): PairPremiumSource {
  if (studentActive && guardianActive) return 'both';
  if (studentActive) return 'student';
  if (guardianActive) return 'guardian';
  return 'none';
}

export async function resolveLinkedPairPremiumAccessForStudent(studentUserId: string): Promise<LinkedPairPremiumAccess> {
  const studentAccountId = await ensureAccountForUser(supabaseServer, studentUserId, 'student');
  const studentEntitlement = studentAccountId ? await getEntitlement(studentAccountId) : null;

  const guardianLink = await getLinkedGuardianForStudent(studentUserId);
  const guardianUserId = guardianLink?.guardian_profile_id ?? null;
  const guardianAccountId = guardianUserId ? await getAccountIdForUser(guardianUserId) : null;
  const guardianEntitlement = guardianAccountId ? await getEntitlement(guardianAccountId) : null;

  const studentActive = isEntitlementActive(studentEntitlement);
  const hasActiveLink = !!guardianLink;
  const hasPremiumAccess = studentActive;

  return {
    role: 'student',
    hasPremiumAccess,
    hasActiveLink,
    premiumSource: studentActive ? 'student' : 'none',
    reason: hasPremiumAccess
      ? 'Student has active premium entitlement.'
      : hasActiveLink
        ? 'Linked student account does not have an active premium entitlement.'
        : 'Student account does not have an active premium entitlement.',
    studentUserId,
    guardianUserId,
    studentAccountId,
    guardianAccountId,
    studentEntitlementStatus: studentEntitlement?.status ?? 'missing',
    guardianEntitlementStatus: guardianEntitlement?.status ?? 'missing',
    studentEntitlementExpired: isEntitlementExpired(studentEntitlement),
    guardianEntitlementExpired: isEntitlementExpired(guardianEntitlement),
  };
}

export async function resolveLinkedPairPremiumAccessForGuardian(
  guardianUserId: string,
  requestedStudentId?: string
): Promise<LinkedPairPremiumAccess> {
  const guardianAccountId = await getAccountIdForUser(guardianUserId);
  const guardianEntitlement = guardianAccountId ? await getEntitlement(guardianAccountId) : null;

  const link = requestedStudentId
    ? await getGuardianLinkForStudent(guardianUserId, requestedStudentId)
    : await getPrimaryGuardianLink(guardianUserId);

  if (!link?.student_user_id) {
    return {
      role: 'guardian',
      hasPremiumAccess: false,
      hasActiveLink: false,
      premiumSource: 'none',
      reason: 'Guardian has no linked student.',
      studentUserId: null,
      guardianUserId,
      studentAccountId: null,
      guardianAccountId,
      studentEntitlementStatus: 'missing',
      guardianEntitlementStatus: guardianEntitlement?.status ?? 'missing',
      studentEntitlementExpired: false,
      guardianEntitlementExpired: isEntitlementExpired(guardianEntitlement),
    };
  }

  const studentAccountId = link.account_id ?? await ensureAccountForUser(supabaseServer, link.student_user_id, 'student');
  const studentEntitlement = studentAccountId ? await getEntitlement(studentAccountId) : null;

  const studentActive = isEntitlementActive(studentEntitlement);
  const hasPremiumAccess = studentActive;

  return {
    role: 'guardian',
    hasPremiumAccess,
    hasActiveLink: true,
    premiumSource: studentActive ? 'student' : 'none',
    reason: hasPremiumAccess
      ? 'Linked student has active premium entitlement.'
      : 'Linked student account does not have an active premium entitlement.',
    studentUserId: link.student_user_id,
    guardianUserId,
    studentAccountId,
    guardianAccountId,
    studentEntitlementStatus: studentEntitlement?.status ?? 'missing',
    guardianEntitlementStatus: guardianEntitlement?.status ?? 'missing',
    studentEntitlementExpired: isEntitlementExpired(studentEntitlement),
    guardianEntitlementExpired: isEntitlementExpired(guardianEntitlement),
  };
}

export function mapStripeStatusToEntitlement(stripeStatus: string): {
  plan: 'free' | 'paid';
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive';
} {
  switch (stripeStatus) {
    case 'active':
      return { plan: 'paid', status: 'active' };
    case 'trialing':
      return { plan: 'paid', status: 'trialing' };
    case 'past_due':
      return { plan: 'paid', status: 'past_due' };
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return { plan: 'free', status: 'canceled' };
    default:
      return { plan: 'free', status: 'inactive' };
  }
}

export { FREE_TIER_LIMITS };



