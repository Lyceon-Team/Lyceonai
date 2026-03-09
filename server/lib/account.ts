/**
 * Get guardian link for a specific studentId
 * Returns { account_id, student_user_id } if linked, else null
 */
export async function getGuardianLinkForStudent(guardianProfileId: string, studentId: string): Promise<{ account_id: string, student_user_id: string } | null> {
  const { data, error } = await supabaseServer
    .from('guardian_links')
    .select('account_id, student_user_id')
    .eq('guardian_profile_id', guardianProfileId)
    .eq('student_user_id', studentId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('[Account] Failed to get guardian link for student:', error);
    throw new Error(`Failed to get guardian link: ${error.message}`);
  }
  return data || null;
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
 * Get ALL accounts for a user (for guardians with multiple students)
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

/**
 * Get selected account for guardian from guardian_preferences
 */
export async function getGuardianSelectedAccount(userId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from('guardian_preferences')
    .select('selected_account_id')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[Account] Failed to get guardian preferences:', error);
  }

  return data?.selected_account_id || null;
}

/**
 * Set selected account for guardian
 */
export async function setGuardianSelectedAccount(userId: string, accountId: string): Promise<void> {
  const { error } = await supabaseServer
    .from('guardian_preferences')
    .upsert(
      { user_id: userId, selected_account_id: accountId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

  if (error) {
    throw new Error(`Failed to set guardian selected account: ${error.message}`);
  }
}

interface Entitlement {
  account_id: string;
  plan: 'free' | 'paid';
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
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
  type: 'practice' | 'ai_chat'
): Promise<{ allowed: boolean; current: number; limit: number; resetAt: string }> {
  const entitlement = await getEntitlement(accountId);
  const isPaid = entitlement?.plan === 'paid' &&
    (entitlement.status === 'active' || entitlement.status === 'trialing');

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
 * Guardians link to students via profiles.guardian_profile_id field.
 * Returns the first linked student's user_id.
 */
export async function getPrimaryGuardianLink(guardianUserId: string): Promise<{ student_user_id: string } | null> {
  // Find the student who points to this guardian
  const { data, error } = await supabaseServer
    .from('profiles')
    .select('id')
    .eq('role', 'student')
    .eq('guardian_profile_id', guardianUserId)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  if (!data?.id) return null;

  return { student_user_id: data.id };
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
