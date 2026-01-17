import { createClient } from '@supabase/supabase-js';

// Check if we have the service role key for admin operations
const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!hasServiceRoleKey) {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY not found - RLS tests will be skipped');
}

// Supabase admin client (for creating test users)
const supabaseAdmin = hasServiceRoleKey
  ? createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )
  : null;

// Supabase anon client (for getting user JWTs)
const supabaseAnon = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

interface TestUser {
  id: string;
  email: string;
  password: string;
}

/**
 * Create a test user in Supabase Auth
 * Requires SUPABASE_SERVICE_ROLE_KEY to be set
 */
export async function createTestUser(email: string, password: string = 'TestPassword123!'): Promise<TestUser> {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured - cannot create test users');
  }

  // Create user via admin API
  const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Auto-confirm email for testing
    user_metadata: {
      display_name: email.split('@')[0],
    }
  });

  if (error) {
    throw new Error(`Failed to create test user ${email}: ${error.message}`);
  }

  if (!user.user) {
    throw new Error(`No user returned when creating ${email}`);
  }

  // Create user profile in database
  const { error: profileError } = await supabaseAdmin
    .from('users')
    .insert({
      id: user.user.id,
      email: user.user.email!,
      display_name: email.split('@')[0],
      role: 'student',
      is_under_13: false,
      guardian_consent: true
    });

  if (profileError && !profileError.message.includes('duplicate')) {
    console.warn(`Warning: Could not create profile for ${email}:`, profileError.message);
  }

  return {
    id: user.user.id,
    email: user.user.email!,
    password
  };
}

/**
 * Get a user's JWT token by signing in
 */
export async function getUserJwt(user: TestUser): Promise<string> {
  const { data, error } = await supabaseAnon.auth.signInWithPassword({
    email: user.email,
    password: user.password
  });

  if (error) {
    throw new Error(`Failed to sign in as ${user.email}: ${error.message}`);
  }

  if (!data.session) {
    throw new Error(`No session returned for ${user.email}`);
  }

  return data.session.access_token;
}

/**
 * Delete a test user (cleanup)
 * Requires SUPABASE_SERVICE_ROLE_KEY to be set
 */
export async function deleteTestUser(userId: string): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured - cannot delete test users');
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

  if (error) {
    console.warn(`Warning: Could not delete test user ${userId}:`, error.message);
  }
}

/**
 * Clean up all test users matching a pattern
 */
export async function cleanupTestUsers(emailPattern: string = 'test-rls-'): Promise<void> {
  if (!supabaseAdmin) {
    console.warn('SUPABASE_SERVICE_ROLE_KEY not configured - cannot cleanup test users');
    return;
  }

  try {
    // Note: This is a best-effort cleanup
    // Supabase doesn't provide a good way to list users by email pattern
    console.log(`Attempting to cleanup test users with pattern: ${emailPattern}`);
  } catch (error) {
    console.warn('Error during test user cleanup:', error);
  }
}

/**
 * Check if RLS tests can run (requires service role key)
 */
export function canRunRlsTests(): boolean {
  return hasServiceRoleKey;
}
