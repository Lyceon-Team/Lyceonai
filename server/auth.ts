// Simplified authentication for hardened SQLite server
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Validation schemas
export const emailSchema = z.string()
  .email("Please enter a valid email address")
  .max(254, "Email address is too long")
  .toLowerCase()
  .trim();

export const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be less than 128 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

export const usernameSchema = z.string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be less than 30 characters")
  .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, hyphens, and underscores")
  .toLowerCase()
  .trim();

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required")
});

export const signupSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema
});

// Password utilities
export async function hashPassword(password: string): Promise<string> {
  try {
    passwordSchema.parse(password);
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(error.errors[0].message);
    }
    throw new Error('Failed to hash password');
  }
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(Math.ceil(length * 3 / 4))
    .toString('base64')
    .slice(0, length)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Simplified user interface for hardened SQLite setup
export interface SimpleUser {
  id: string;
  email: string;
  username: string;
  password: string;
  name?: string;
  isAdmin?: boolean;
  createdAt: string;
  updatedAt: string;
  loginAttempts?: number;
  lockedUntil?: Date | null;
  lastLoginAt?: Date | null;
}

// Initialize admin user from environment variables
async function initializeAdminUser(): Promise<SimpleUser> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  
  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD environment variables must be set');
  }
  
  const hashedPassword = await hashPassword(adminPassword);
  
  return {
    id: '1',
    email: adminEmail,
    username: 'admin',
    password: hashedPassword,
    name: 'Admin User',
    isAdmin: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    loginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null
  };
}

// Simple in-memory user storage for demo purposes
// In production, this would be replaced with actual database storage
let users: SimpleUser[] = [];
let adminInitialized = false;

// Ensure admin user is initialized
async function ensureAdminInitialized(): Promise<void> {
  if (!adminInitialized) {
    const adminUser = await initializeAdminUser();
    users.push(adminUser);
    adminInitialized = true;
  }
}

// User storage functions
export async function getUserByEmail(email: string): Promise<SimpleUser | null> {
  await ensureAdminInitialized();
  return users.find(user => user.email.toLowerCase() === email.toLowerCase()) || null;
}

export async function getUserByUsername(username: string): Promise<SimpleUser | null> {
  await ensureAdminInitialized();
  return users.find(user => user.username.toLowerCase() === username.toLowerCase()) || null;
}

export async function getUserById(id: string): Promise<SimpleUser | null> {
  await ensureAdminInitialized();
  return users.find(user => user.id === id) || null;
}

export async function createUser(userData: {
  email: string;
  username: string;
  password: string;
}): Promise<SimpleUser> {
  await ensureAdminInitialized();
  const newUser: SimpleUser = {
    id: (users.length + 1).toString(),
    email: userData.email,
    username: userData.username,
    password: userData.password,
    isAdmin: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    loginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null
  };
  
  users.push(newUser);
  return newUser;
}

export async function updateUser(id: string, updates: Partial<SimpleUser>): Promise<SimpleUser | null> {
  await ensureAdminInitialized();
  const userIndex = users.findIndex(user => user.id === id);
  if (userIndex === -1) return null;
  
  users[userIndex] = {
    ...users[userIndex],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  
  return users[userIndex];
}

export function isAccountLocked(loginAttempts: number, lockedUntil: Date | null): boolean {
  if (!lockedUntil) return false;
  return new Date() < new Date(lockedUntil);
}

export function calculateLockDuration(attempts: number): number {
  // Progressive lock duration: 5 attempts = 15 min, 6 = 30 min, etc.
  return Math.min(15 * Math.pow(2, attempts - 5), 1440); // Max 24 hours
}

// Simple admin auth middleware for protecting ingest routes

export interface AdminAuthenticatedRequest extends Request {
  adminUser?: { id: string; username: string; isAdmin: boolean };
}

export function requireAdminAuth(req: AdminAuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    // For development/demo, we'll use a simple API key approach
    // In production, this should use proper session-based auth
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Authentication required'
      });
      return;
    }

    const token = authHeader.substring(7);
    const adminToken = process.env.ADMIN_TOKEN;
    
    if (!adminToken) {
      res.status(500).json({
        error: 'Server configuration error'
      });
      return;
    }
    
    // Use timing-safe comparison to prevent timing attacks
    const tokenBuffer = Buffer.from(token, 'utf8');
    const adminTokenBuffer = Buffer.from(adminToken, 'utf8');
    
    // Ensure buffers are the same length for comparison
    const isValidLength = tokenBuffer.length === adminTokenBuffer.length;
    const isValidToken = isValidLength && crypto.timingSafeEqual(tokenBuffer, adminTokenBuffer);
    
    if (!isValidToken) {
      res.status(403).json({
        error: 'Access denied'
      });
      return;
    }

    // Add admin user to request for logging
    req.adminUser = {
      id: 'admin',
      username: 'admin',
      isAdmin: true
    };

    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({
      error: 'Authentication system error'
    });
  }
}