/**
 * Supabase Server Client (HTTP-based)
 * 
 * Uses @supabase/supabase-js for HTTP access to Supabase instead of
 * direct Postgres connections (which are flaky from Replit).
 * 
 * This client is SERVER-SIDE ONLY and uses the service role key
 * to bypass RLS when needed for admin operations.
 * 
 * LAZY INITIALIZATION: Client is created on first access to prevent
 * deployment failures when env vars are temporarily unavailable.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabaseServer: SupabaseClient | null = null;

function getSupabaseServer(): SupabaseClient {
  if (_supabaseServer) {
    return _supabaseServer;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // In test mode, return placeholder client if env vars missing
  const isTestEnv = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    if (isTestEnv) {
      console.log('[SUPABASE-HTTP] Test mode: using placeholder client');
      _supabaseServer = createClient('https://placeholder.supabase.co', 'placeholder-key', {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      return _supabaseServer;
    }
    
    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL environment variable is not set');
    }
    
    if (!supabaseServiceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not set');
    }
  }

  _supabaseServer = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log('[SUPABASE-HTTP] Client initialized');
  return _supabaseServer;
}

/**
 * Server-side Supabase client with service role key.
 * Bypasses RLS for admin operations.
 * 
 * SECURITY: Never expose this client or its key to the frontend.
 * 
 * Note: This is a proxy that lazily initializes the client on first access.
 */
export const supabaseServer: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseServer();
    const value = (client as any)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  }
});

/**
 * Test Supabase HTTP connection by performing a simple query.
 * Returns true if connection is successful, false otherwise.
 */
export async function testSupabaseHttpConnection(): Promise<boolean> {
  try {
    const client = getSupabaseServer();
    const { error } = await client
      .from('questions')
      .select('id', { head: true, count: 'exact' });

    if (error) {
      console.error('[SUPABASE-HTTP] Health check failed:', error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[SUPABASE-HTTP] Health check exception:', err);
    return false;
  }
}
