import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(filePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

describe('Signup frontend contract', () => {
  it('handles verification_required as non-authenticated and blocks authenticated redirect', () => {
    const source = read('client/src/components/auth/SupabaseAuthForm.tsx');

    expect(source).toContain("signupResult.status === 'verification_required'");
    expect(source).toContain("setVerificationNotice(verificationMessage)");
    expect(source).toContain("setMode('signin')");
    expect(source).toContain('return;');
    expect(source).toContain("setLocation(await resolvePostAuthPath())");
  });

  it('requires canonical profile hydration for authenticated signup and fails closed otherwise', () => {
    const source = read('client/src/contexts/SupabaseAuthContext.tsx');

    expect(source).toContain("if (data?.status === 'verification_required')");
    expect(source).toContain("setUser(null);");
    expect(source).toContain("if (data?.status !== 'authenticated')");
    expect(source).toContain("const backendUser = await fetchUserFromBackend();");
    expect(source).toContain("throw new Error('Failed to load user profile after sign-up')");
  });

  it('clears auth state when refresh/profile hydration path fails', () => {
    const source = read('client/src/contexts/SupabaseAuthContext.tsx');

    expect(source).toContain("if (refreshResp.ok)");
    expect(source).toContain("clearAuthState();");
    expect(source).toContain("if (response.status === 401 || response.status === 403)");
  });

  it('clears cached CSRF token on auth transitions', () => {
    const source = read('client/src/contexts/SupabaseAuthContext.tsx');

    expect(source).toContain("import { clearCsrfToken, csrfFetch } from '@/lib/csrf';");
    expect(source).toContain("const clearAuthState = () => {");
    expect(source).toContain("clearCsrfToken();");
    expect(source).toContain("if (refreshResp.ok)");
    expect(source).toContain("clearCsrfToken();");
  });
});
