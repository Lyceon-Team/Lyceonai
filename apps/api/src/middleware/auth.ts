import type { AuthenticatedRequest } from '../../../../server/middleware/supabase-auth';
import { requireSupabaseAdmin, requireSupabaseAuth } from '../../../../server/middleware/supabase-auth';

// Deprecated compatibility shim. Active runtime auth is canonicalized in
// server/middleware/supabase-auth.ts and this file exists only for older imports.
export type { AuthenticatedRequest };
export const requireAuth = requireSupabaseAuth;
export const requireAdmin = requireSupabaseAdmin;
