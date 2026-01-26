import { Request, Response, NextFunction } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger.js';
import { ensureAccountForUser } from '../lib/account.js';

/**
 * Token resolution result with diagnostics
 */
export interface TokenResolutionResult {
  token: string | null;
  tokenSource: 'bearer' | `cookie:${string}` | null;
  tokenLength: number | null;
  bearerParsed: boolean;
  authHeaderPresent: boolean;
  cookieKeys: string[];
}

/**
 * ALLOWED AUTH COOKIES - Only these exact cookie names are accepted for auth
 * All other cookies with auth-like names are treated as legacy and ignored
 */
const ALLOWED_AUTH_COOKIES = ['sb-access-token', 'sb-refresh-token'] as const;

/**
 * SHARED AUTH HELPER: Extract access token from request
 * Used by practice endpoints, auth debug, and health check
 *
 * SECURITY: Only accepts exact cookie names to prevent stale/legacy cookies from breaking auth
 *
 * ENFORCED: For user-facing auth, tokens MUST come from httpOnly cookies only.
 * Any Authorization: Bearer header is rejected for user-facing routes.
 * Internal bearer usage must NOT use this function.
 */
export function resolveTokenFromRequest(req: Request): TokenResolutionResult {
  const result: TokenResolutionResult = {
    token: null,
    tokenSource: null,
    tokenLength: null,
    bearerParsed: false,
    authHeaderPresent: false,
    cookieKeys: [],
  };

  // Get all cookie keys for diagnostics
  const cookies = req.cookies || {};
  result.cookieKeys = Object.keys(cookies);

  // Reject Authorization: Bearer for user-facing auth
  const authHeader = req.headers.authorization || req.headers['Authorization'] as string || req.get('authorization');
  result.authHeaderPresent = !!authHeader;
  if (authHeader && typeof authHeader === 'string') {
    const lowerHeader = authHeader.toLowerCase();
    if (lowerHeader.startsWith('bearer ')) {
      // Explicitly reject Bearer tokens for user-facing auth
      result.bearerParsed = true;
      result.tokenSource = 'bearer';
      result.token = null;
      result.tokenLength = 0;
      return result;
    }
  }

  // STRICT: Only accept exactly 'sb-access-token' cookie
  const accessToken = cookies['sb-access-token'];
  if (typeof accessToken === 'string' && accessToken.length >= 20) {
    result.token = accessToken;
    result.tokenSource = 'cookie:sb-access-token';
    result.tokenLength = accessToken.length;
    return result;
  }

  return result;
}

/**
 * SHARED AUTH HELPER: Resolve user ID from token
 * Returns userId or null if token is invalid/missing
 */
export async function resolveUserIdFromToken(token: string | null): Promise<string | null> {
  if (!token) return null;
  
  try {
    const supabaseAnon = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );
    const { data: { user }, error } = await supabaseAnon.auth.getUser(token);
    if (error || !user) return null;
    return user.id;
  } catch {
    return null;
  }
}

export interface SupabaseUser {
  id: string;
  email: string;
  display_name: string | null;
  role: 'student' | 'admin' | 'guardian';
  isAdmin: boolean;
  isGuardian: boolean;
  is_under_13?: boolean;
  guardian_consent?: boolean;
  jwt?: string;
  username?: string;
  name?: string;
}

declare global {
  namespace Express {
    interface Request {
      supabase?: SupabaseClient;
      user?: SupabaseUser;
    }
  }
}

// Supabase client with service role (bypasses RLS for admin operations)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Supabase client with anon key (enforces RLS)
const supabaseAnon = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

/**
 * Middleware to extract and validate Supabase Auth JWT
 * Attaches user profile from Supabase to req.user
 */
export async function supabaseAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Use shared helper for robust token extraction
    const tokenResult = resolveTokenFromRequest(req);
    const token = tokenResult.token;

    if (!token) {
      // No token provided - continue without user (public routes)
      return next();
    }

    // Verify JWT and get user
    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token);

    if (authError || !user) {
      logger.warn('AUTH', 'jwt_validation', 'Invalid or expired Supabase JWT', { error: authError });
      return next(); // Continue without user
    }

    // Fetch user profile from Supabase using anon client with user's JWT (RLS enforced)
    // The JWT is automatically recognized by auth.uid() in RLS policies
    const userSupabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      }
    );
    
    const { data: fetchedProfile, error: profileError } = await userSupabase
      .from('profiles')
      .select('id, email, display_name, role, is_under_13, guardian_consent, guardian_email, student_link_code')
      .eq('id', user.id)
      .single();

    // Auto-create profile if missing (resilient profile loading)
    let profile = fetchedProfile;
    
    if (profileError || !fetchedProfile) {
      // Profile doesn't exist - auto-create with safe defaults
      logger.warn('AUTH', 'profile_missing', 'Profile not found, auto-creating', { 
        userId: user.id,
        email: user.email 
      });
      
      // Determine role from user metadata (if set during signup)
      // SECURITY: Only allow guardian role from metadata. Admin cannot be auto-assigned.
      // Admin role must be manually assigned by DB admin or existing admin user.
      const metadataRole = user.user_metadata?.role as string | undefined;
      const allowedAutoRoles = ['student', 'guardian'] as const;
      const defaultRole: 'student' | 'guardian' = 
        metadataRole === 'guardian' ? 'guardian' : 'student';
      
      // Log if someone tried to auto-create as admin (potential abuse attempt)
      if (metadataRole === 'admin') {
        logger.warn('AUTH', 'admin_role_blocked', 'Blocked attempt to auto-create admin profile', {
          userId: user.id,
          email: user.email,
          requestId: req.requestId
        });
      }
      
      const { data: newProfile, error: createError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: user.id,
          email: user.email || '',
          display_name: user.user_metadata?.display_name || user.user_metadata?.full_name || null,
          role: defaultRole,
          is_under_13: user.user_metadata?.is_under_13 || false,
          guardian_consent: user.user_metadata?.guardian_consent || false,
          guardian_email: user.user_metadata?.guardian_email || null,
        })
        .select('id, email, display_name, role, is_under_13, guardian_consent, guardian_email, student_link_code')
        .single();
      
      if (createError || !newProfile) {
        logger.error('AUTH', 'profile_create_failed', 'Failed to auto-create profile', { 
          userId: user.id, 
          error: createError 
        });
        return res.status(500).json({ error: 'Failed to load user profile' });
      }
      
      logger.info('AUTH', 'profile_auto_created', 'Profile auto-created successfully', {
        userId: newProfile.id,
        role: newProfile.role,
        requestId: req.requestId
      });
      
      profile = newProfile;
    }
    
    if (!profile) {
      logger.error('AUTH', 'profile_null', 'Profile is null after fetch/create', { userId: user.id });
      return res.status(500).json({ error: 'Failed to load user profile' });
    }

    // Attach user to request (with backward compatibility fields)
    req.user = {
      id: profile.id,
      email: profile.email,
      display_name: profile.display_name,
      role: profile.role,
      isAdmin: profile.role === 'admin',
      isGuardian: profile.role === 'guardian',
      is_under_13: profile.is_under_13,
      guardian_consent: profile.guardian_consent,
      jwt: token, // Store raw JWT for RLS database context
      // Legacy fields for backward compatibility with old auth
      username: profile.email.split('@')[0], // Use email prefix as username
      name: profile.display_name || profile.email.split('@')[0]
    };

    // Attach Supabase client with user's JWT (for RLS enforcement in Supabase tables)
    req.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      }
    );

    // NOTE: PostgreSQL RLS via session GUCs (set_current_user_id) does NOT work with Neon
    // because Neon uses stateless connection pooling that doesn't preserve session variables.
    // 
    // Data isolation is enforced at the APPLICATION LAYER via WHERE user_id = req.user.id
    // in all storage methods and API routes. This is verified by the RLS test suite.
    //
    // If you need true database-level RLS, consider:
    // 1. Using Supabase PostgreSQL (supports auth.uid() for RLS)
    // 2. Using a non-pooled Neon connection (session mode)
    // 3. Wrapping queries in transactions with session variables set in same connection

    logger.info('AUTH', 'user_authenticated', 'User authenticated successfully', {
      userId: req.user.id,
      email: req.user.email,
      role: req.user.role
    });

    // PHASE 2: Ensure public.users row exists (FK constraint for practice_sessions)
    // This prevents FK violation when inserting into tables that reference public.users(id)
    try {
      const { error: upsertError } = await supabaseAdmin
        .from('users')
        .upsert(
          { 
            id: req.user.id, 
            email: req.user.email 
          },
          { onConflict: 'id' }
        );
      
      if (upsertError) {
        // Retry with just id if email column doesn't exist or other schema issue
        const { error: retryError } = await supabaseAdmin
          .from('users')
          .upsert({ id: req.user.id }, { onConflict: 'id' });
        
        if (retryError) {
          logger.warn('AUTH', 'users_upsert_failed', 'Failed to upsert public.users', {
            userId: req.user.id,
            error: retryError.message
          });
        }
      }
    } catch (usersErr) {
      // Log but don't block - some setups may not have public.users table
      logger.warn('AUTH', 'users_upsert_exception', 'Exception during public.users upsert', {
        userId: req.user.id,
        error: usersErr instanceof Error ? usersErr.message : 'Unknown'
      });
    }

    // Ensure user has a lyceon_account and membership (student/guardian only)
    if (req.user.role === 'student' || req.user.role === 'guardian') {
      try {
        const accountId = await ensureAccountForUser(supabaseAdmin, req.user.id, req.user.role);
        logger.info('AUTH', 'account_ensured', 'Account ensured for user', {
          userId: req.user.id,
          role: req.user.role,
          accountId,
          requestId: req.requestId
        });
      } catch (accountErr) {
        logger.error('AUTH', 'account_ensure_failed', 'Failed to ensure account for user', {
          userId: req.user.id,
          role: req.user.role,
          error: accountErr instanceof Error ? accountErr.message : 'Unknown error',
          requestId: req.requestId
        });
        // Continue anyway - account creation failure should not block auth
      }
    }

    next();
  } catch (error) {
    logger.error('AUTH', 'middleware_error', 'Supabase auth middleware error', error);
    next(); // Continue without user on error
  }
}

/**
 * Middleware to require authentication
 * Returns 401 if user is not authenticated
 */
export function requireSupabaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'You must be signed in to access this resource',
      requestId: req.requestId
    });
  }
  return next();
}


/**
 * Middleware to require admin role
 * Returns 403 if user is not an admin
 */
export function requireSupabaseAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'You must be signed in to access this resource',
      requestId: req.requestId
    });
  }

  if (!req.user?.isAdmin) {
    logger.warn('AUTH', 'admin_required', 'User attempted to access admin route without permission', {
      userId: req.user?.id,
      role: (req.user as any)?.role
    });

    return res.status(403).json({
      error: 'Admin access required',
      message: 'You do not have permission to access this resource',
      requestId: req.requestId
    });
  }

  return next();
}


/**
 * Middleware to check under-13 consent (FERPA compliance)
 * Returns 403 if user is under 13 without guardian consent
 */
export function requireConsentCompliance(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'You must be signed in to access this resource'
    });
  }

  if (req.user?.is_under_13 && !req.user?.guardian_consent) {
    return res.status(403).json({
      error: 'Guardian consent required',
      message: 'Users under 13 require guardian consent to use this service',
      consentRequired: true
    });
  }

  return next();
}


/**
 * Middleware to require student or admin role (blocks guardians)
 * Returns 403 if user is a guardian
 */
export function requireStudentOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'You must be signed in to access this resource',
      requestId: req.requestId
    });
  }

  if (req.user.isGuardian && !req.user.isAdmin) {
    logger.warn('AUTH', 'guardian_blocked', 'Guardian attempted to access student-only route', {
      userId: req.user.id,
      role: req.user.role,
      path: req.path
    });

    return res.status(403).json({
      error: 'Student access required',
      message: 'Guardians cannot access student practice features',
      requestId: req.requestId
    });
  }

  return next();
}

/**
 * Get Supabase admin client (bypasses RLS - use carefully!)
 */
export function getSupabaseAdmin() {
  return supabaseAdmin;
}

/**
 * Get Supabase anon client (enforces RLS)
 */
export function getSupabaseAnon() {
  return supabaseAnon;
}
