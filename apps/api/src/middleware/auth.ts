import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * System A: Lookup admin status from public.profiles.role
 * Returns true if profile.role === 'admin', false otherwise
 */
async function lookupProfileRole(userId: string): Promise<boolean> {
  if (!supabaseUrl || !supabaseServiceKey) return false;
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return profile?.role === 'admin';
}

export interface ApiAuthenticatedRequest extends Request {
  authUser?: {
    id: string;
    email?: string | null;
    name?: string | null;
    username?: string;
    isAdmin?: boolean;
  };
}

export type AuthenticatedRequest = ApiAuthenticatedRequest;

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Enforce cookie-only authentication: ignore Authorization header
    const token = req.cookies?.['sb-access-token'];
    if (!token) {
      res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please log in to access this resource (cookie required)'
      });
      return;
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      res.status(500).json({ error: 'Auth not configured' });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Invalid or expired session'
      });
      return;
    }

    const isAdmin = await lookupProfileRole(user.id);
    (req as any).authUser = {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || null,
      isAdmin
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ 
      error: 'Authentication failed',
      message: 'Invalid or expired session'
    });
  }
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Enforce cookie-only authentication: ignore Authorization header
    const token = req.cookies?.['sb-access-token'];
    if (!token) {
      res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please log in to access this resource (cookie required)'
      });
      return;
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      res.status(500).json({ error: 'Auth not configured' });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Invalid or expired session'
      });
      return;
    }

    const isAdmin = await lookupProfileRole(user.id);
    const authUser = {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || null,
      isAdmin
    };
    (req as any).authUser = authUser;

    if (!authUser.isAdmin) {
      res.status(403).json({ 
        error: 'Admin privileges required',
        message: 'You do not have permission to access this resource'
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(401).json({ 
      error: 'Authentication failed',
      message: 'Invalid or expired session'
    });
  }
}
