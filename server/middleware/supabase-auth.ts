import { Request, Response, NextFunction } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger.js';
import { ensureAccountForUser } from '../lib/account.js';
import { ensureProfileForAuthUser } from '../lib/profile-bootstrap.js';

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
  profile_completed_at?: string | null;
  jwt?: string;
  username?: string;
  name?: string;
  student_link_code?: string | null;
}

export interface AuthenticatedRequest extends Request {
  supabase?: SupabaseClient;
  user?: SupabaseUser;
}

export type DeletionStatusState = 'active' | 'deleted' | 'unavailable';

export type DeletionStatusResult = {
  status: DeletionStatusState;
  executedAt: string | null;
};

export type DeletionStatusResolver = (args: {
  userId: string;
  requestId?: string;
}) => Promise<DeletionStatusResult>;

type DenialResponseOptions = {
  error: string;
  message: string;
  requestId?: string;
  extra?: Record<string, unknown>;
};

declare global {
  namespace Express {
    interface Request {
      supabase?: SupabaseClient;
      user?: SupabaseUser;
    }
  }
}

/**
 * Detect if running in test environment
 * In test mode, placeholder clients are allowed
 * In production/dev, missing env vars must throw on first use
 */
function sendDenial(
  res: Response,
  status: number,
  options: DenialResponseOptions
) {
  return res.status(status).json({
    error: options.error,
    message: options.message,
    requestId: options.requestId,
    ...(options.extra ?? {}),
  });
}

export function sendUnauthenticated(
  res: Response,
  requestId?: string
) {
  return sendDenial(res, 401, {
    error: 'Authentication required',
    message: 'You must be signed in to access this resource',
    requestId,
  });
}

export function sendForbidden(
  res: Response,
  options: Omit<DenialResponseOptions, 'requestId'> & { requestId?: string }
) {
  return sendDenial(res, 403, options);
}

export function requireRequestUser(
  req: AuthenticatedRequest,
  res: Response
): SupabaseUser | null {
  if (!req.user?.id) {
    sendUnauthenticated(res, req.requestId);
    return null;
  }

  return req.user;
}

export function requireRequestAuthContext(
  req: AuthenticatedRequest,
  res: Response
): { user: SupabaseUser; supabase: SupabaseClient } | null {
  const user = requireRequestUser(req, res);
  if (!user) {
    return null;
  }

  if (!req.supabase) {
    sendUnauthenticated(res, req.requestId);
    return null;
  }

  return {
    user,
    supabase: req.supabase,
  };
}

function isTestEnvironment(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

let deletionStatusResolverOverride: DeletionStatusResolver | null = null;

export function setDeletionStatusResolverForTests(resolver: DeletionStatusResolver | null) {
  deletionStatusResolverOverride = resolver;
}

async function testDefaultDeletionResolver(): Promise<DeletionStatusResult> {
  return { status: 'active', executedAt: null };
}

async function defaultSupabaseDeletionResolver(args: {
  userId: string;
  requestId?: string;
}): Promise<DeletionStatusResult> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('account_deletion_requests')
      .select('status, executed_at')
      .eq('user_id', args.userId)
      .eq('status', 'completed')
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      logger.error('DELETION', 'auth_check_failed', 'Failed to verify deletion status', {
        userId: args.userId,
        error: error.message,
        requestId: args.requestId,
      });
      return { status: 'unavailable', executedAt: null };
    }

    if (data?.status === 'completed') {
      return { status: 'deleted', executedAt: data.executed_at ?? null };
    }

    return { status: 'active', executedAt: null };
  } catch (err) {
    logger.error('DELETION', 'auth_check_error', 'Unhandled error while verifying deletion status', {
      userId: args.userId,
      error: err instanceof Error ? err.message : String(err),
      requestId: args.requestId,
    });
    return { status: 'unavailable', executedAt: null };
  }
}

async function resolveDeletionStatus(args: {
  userId: string;
  requestId?: string;
}): Promise<DeletionStatusResult> {
  if (deletionStatusResolverOverride) {
    return deletionStatusResolverOverride(args);
  }

  if (isTestEnvironment()) {
    return testDefaultDeletionResolver();
  }

  return defaultSupabaseDeletionResolver(args);
}

// Supabase client with service role (bypasses RLS for admin operations)
// Lazy initialization with environment-based error handling
let _supabaseAdmin: SupabaseClient | null = null;
const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_supabaseAdmin) {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!url || !key) {
        if (isTestEnvironment()) {
          // In test environment, return placeholder client
          _supabaseAdmin = createClient('https://placeholder.supabase.co', 'placeholder-key');
        } else {
          // In production/dev, throw on first use
          throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in production/development');
        }
      } else {
        _supabaseAdmin = createClient(url, key);
      }
    }
    const value = (_supabaseAdmin as any)[prop];
    if (typeof value === 'function') {
      return value.bind(_supabaseAdmin);
    }
    return value;
  }
});

// Supabase client with anon key (enforces RLS)
// Lazy initialization with environment-based error handling
let _supabaseAnon: SupabaseClient | null = null;
const supabaseAnon = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_supabaseAnon) {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_ANON_KEY;

      if (!url || !key) {
        if (isTestEnvironment()) {
          // In test environment, return placeholder client
          _supabaseAnon = createClient('https://placeholder.supabase.co', 'placeholder-key');
        } else {
          // In production/dev, throw on first use
          throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in production/development');
        }
      } else {
        _supabaseAnon = createClient(url, key);
      }
    }
    const value = (_supabaseAnon as any)[prop];
    if (typeof value === 'function') {
      return value.bind(_supabaseAnon);
    }
    return value;
  }
});

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

    const profile = await ensureProfileForAuthUser(supabaseAdmin, user, {
      source: 'supabase_auth_middleware',
      requestId: req.requestId,
    }).catch((profileError) => {
      logger.error('AUTH', 'profile_load_failed', 'Failed to load or bootstrap profile', {
        userId: user.id,
        error: profileError instanceof Error ? profileError.message : String(profileError),
        requestId: req.requestId,
      });
      return null;
    });

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
      profile_completed_at: profile.profile_completed_at ?? null,
      jwt: token, // Store raw JWT for RLS database context
      student_link_code: profile.student_link_code,
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
export async function requireSupabaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return sendUnauthenticated(res, req.requestId);
  }

  const deletionStatus = await resolveDeletionStatus({
    userId: req.user.id,
    requestId: req.requestId,
  });

  if (deletionStatus.status === 'unavailable') {
    return res.status(503).json({
      error: 'Deletion status unavailable',
      code: 'DELETION_STATUS_UNAVAILABLE',
      requestId: req.requestId,
    });
  }

  if (deletionStatus.status === 'deleted') {
    return res.status(403).json({
      error: 'Account deleted',
      code: 'ACCOUNT_DELETED',
      message: 'This account has been deleted and can no longer access the service.',
      requestId: req.requestId,
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
    return sendUnauthenticated(res, req.requestId);
  }

  if (!req.user?.isAdmin) {
    logger.warn('AUTH', 'admin_required', 'User attempted to access admin route without permission', {
      userId: req.user?.id,
      role: (req.user as any)?.role
    });

    return sendForbidden(res, {
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
    return sendUnauthenticated(res, req.requestId);
  }

  if (req.user?.is_under_13 && !req.user?.guardian_consent) {
    return sendForbidden(res, {
      error: 'Guardian consent required',
      message: 'Users under 13 require guardian consent to use this service',
      requestId: req.requestId,
      extra: { consentRequired: true }
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
    return sendUnauthenticated(res, req.requestId);
  }

  if (req.user.isGuardian && !req.user.isAdmin) {
    logger.warn('AUTH', 'guardian_blocked', 'Guardian attempted to access student-only route', {
      userId: req.user.id,
      role: req.user.role,
      path: req.path
    });

    return sendForbidden(res, {
      error: 'Student access required',
      message: 'Guardians cannot access student practice features',
      requestId: req.requestId
    });
  }

  if (!req.user.isAdmin && req.user.is_under_13 && !req.user.guardian_consent) {
    logger.warn('AUTH', 'consent_required', 'Under-13 user blocked from student-only route without guardian consent', {
      userId: req.user.id,
      path: req.path,
      requestId: req.requestId,
    });

    return sendForbidden(res, {
      error: 'Guardian consent required',
      message: 'Users under 13 require guardian consent to use this service',
      requestId: req.requestId,
      extra: { consentRequired: true },
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

