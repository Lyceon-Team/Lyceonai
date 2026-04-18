import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Google auth start path contract', () => {
  it('keeps direct Google sign-in initiation on /api/auth/google/start', () => {
    const contextPath = path.join(process.cwd(), 'client/src/contexts/SupabaseAuthContext.tsx');
    const source = fs.readFileSync(contextPath, 'utf8');

    expect(source).toContain("window.location.href = '/api/auth/google/start'");
    expect(source).not.toContain('signInWithOAuth');
  });
});
