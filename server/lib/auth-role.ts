export type RuntimeRole = 'student' | 'guardian' | 'admin';

export function normalizeRuntimeRole(rawRole: unknown): RuntimeRole {
  if (rawRole === 'student' || rawRole === 'guardian' || rawRole === 'admin') {
    return rawRole;
  }

  // Legacy alias kept for backward compatibility with older rows.
  if (rawRole === 'parent') {
    return 'guardian';
  }

  return 'student';
}

export function normalizeSignupRole(rawRole: unknown): 'student' | 'guardian' {
  return rawRole === 'guardian' ? 'guardian' : 'student';
}

export function isAdminRoleRequest(rawRole: unknown): boolean {
  return rawRole === 'admin';
}

