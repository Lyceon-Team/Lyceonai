# Testing Strategy - CI vs Integration Tests

## Overview

This document explains the testing strategy for Lyceon AI, specifically the separation between CI tests and integration tests.

## Guiding Principles

1. **CI Determinism**: Required CI tests must run identically on forks, fresh clones, local dev, and CI
2. **No Secret Requirements**: CI tests MUST NOT require Supabase or any external service credentials
3. **No Test Gaming**: No conditional skipping, no weakening of security assertions
4. **Explicit Separation**: Clear boundary between what requires secrets and what doesn't

## Test Structure

```
tests/
├── ci/                           # Deterministic CI tests (NO secrets required)
│   ├── auth.ci.test.ts          # Cookie-only auth, Bearer rejection
│   ├── security.ci.test.ts      # CSRF protection validation
│   └── routes.ci.test.ts        # Public/protected route validation
│
├── integration/                  # Real Supabase tests (secrets required)
│   ├── auth.integration.test.ts
│   └── protected-routes.integration.test.ts
│
└── utils/                        # Test utilities
    ├── mock-supabase.ts         # Mock Supabase client factory
    ├── auth-helpers.ts          # Cookie builders, token generators
    └── request-helpers.ts       # HTTP request utilities
```

## CI Tests (`tests/ci/`)

### What They Validate

CI tests validate **HTTP boundary behavior** without requiring real external services:

1. **Authentication Behavior**
   - Cookie-only auth (no Bearer tokens accepted)
   - Missing auth cookies → 401
   - Invalid cookies → 401
   - Public endpoints accessible without auth
   - Protected endpoints require auth

2. **CSRF Protection**
   - POST without Origin/Referer → 403
   - Invalid Origin → 403
   - Valid Origin → allowed
   - Prefix attacks blocked (e.g., `localhost:5000.evil.com`)
   - Subdomain impersonation blocked

3. **Route Access Control**
   - Public routes: `/api/health`, `/api/questions/recent`, `/api/questions/search`
   - Protected routes: `/api/profile`, `/api/rag`, `/api/tutor/v2`, `/api/practice/sessions`
   - Admin routes require admin auth
   - User identity from `req.user.id` (not request body)

### How They Work

CI tests use **mock Supabase clients** that simulate authenticated/unauthenticated states:

- Mock clients return predictable user data
- No network calls to real Supabase
- No environment variables required
- Deterministic test execution

### Running CI Tests

```bash
# Run CI tests (no secrets required)
pnpm test:ci

# These tests run in GitHub Actions CI for all PRs
# They MUST pass on forks and fresh clones
```

## Integration Tests (`tests/integration/`)

### What They Validate

Integration tests validate **real end-to-end flows** with actual Supabase:

1. Real authentication with Supabase Auth
2. Real database operations
3. Real session management
4. Real RLS (Row Level Security) enforcement
5. Real user profile creation

### Prerequisites

Integration tests require:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Running Integration Tests

```bash
# Run integration tests (requires real Supabase)
pnpm test:integration

# These tests are OPTIONAL and NOT required for CI
# They only run on main branch or when secrets are available
```

### Behavior When Secrets Missing

Integration tests use `describe.skipIf(!hasSupabaseEnv())` to:

1. **Explicitly skip** when secrets are missing (not silently fail)
2. **Print clear message** explaining what's required
3. **Never run in required CI** (only in optional integration job)

## Security Guarantees

### What CI Tests Assert

CI tests assert **security behavior at the HTTP boundary**:

- ✅ Cookie-only auth is enforced
- ✅ Bearer tokens are rejected
- ✅ CSRF protection is active
- ✅ Missing auth returns 401
- ✅ Invalid origins return 403
- ✅ Protected routes require auth

### What CI Tests Do NOT Do

CI tests **do NOT**:

- ❌ Skip tests silently
- ❌ Change expectations to "make tests pass"
- ❌ Stub out security logic
- ❌ Add fake auth bypasses
- ❌ Weaken CSRF enforcement
- ❌ Accept Bearer tokens
- ❌ Use conditional test execution based on env vars

## Mock Supabase Clients

### Design Philosophy

Mock Supabase clients simulate what real Supabase would return:

```typescript
// Mock authenticated client
const mockClient = createMockAuthenticatedClient(
  mockUsers.student(),
  mockProfiles.student()
);

// Returns user data without hitting real Supabase
await mockClient.auth.getUser(token);
// → { data: { user: { id: 'mock-student-id-123', ... } }, error: null }
```

### Security Notes

- Mocks are ONLY for testing HTTP boundary behavior
- They do NOT bypass auth logic
- They simulate what Supabase would return
- Server still enforces all auth checks
- Tests still validate 401/403 responses

## CI Workflow Integration

### Required CI Job

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - name: Run Tests (Deterministic CI Suite)
        run: pnpm test:ci  # No secrets, must pass on forks
```

### Optional Integration Job

```yaml
jobs:
  integration:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'  # Only on main branch
    steps:
      - name: Run Integration Tests
        run: pnpm test:integration
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          # ... other secrets
```

## Why This Separation?

### Problems Solved

1. **Fork CI Failures**: Forks don't have access to secrets, so tests requiring secrets would always fail
2. **Flaky Tests**: Network-dependent tests are slower and more prone to failure
3. **Secret Leakage Risk**: Less exposure of credentials in CI logs
4. **Local Development**: Developers can run CI tests without setting up Supabase
5. **Security Validation**: CI tests can still validate security behavior deterministically

### Why Not Just Use describe.skipIf Everywhere?

**Explicitly disallowed** because:

1. Silent skipping hides test coverage gaps
2. Developers don't know which tests ran
3. "CI gaming" - making CI green without real validation
4. Tests become conditional instead of deterministic

Instead, we:

1. **Separate** tests into CI and integration
2. **Run different suites** in different contexts
3. **Explicitly document** what each suite validates
4. **Fail loudly** when integration tests are missing secrets (not silently skip)

## Verification Commands

### Fresh Clone Test (Must Pass)

```bash
git clone https://github.com/Lyceon-Team/Lyceonai.git
cd Lyceonai
pnpm install --frozen-lockfile
pnpm test:ci  # Must pass without secrets
pnpm run build  # Must pass
```

### Fork Test (Must Pass)

On a forked repository:

```bash
# No secrets available in fork
pnpm test:ci  # Must pass
```

### Integration Test (Requires Secrets)

```bash
# Set environment variables
export SUPABASE_URL=...
export SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...

pnpm test:integration  # Runs with real Supabase
```

## Migration Guide

### Old Auth Test (`tests/auth.integration.test.ts`)

The existing `tests/auth.integration.test.ts` has been preserved but excluded from default test runs. It contains useful test patterns that can be referenced.

### New Test Organization

- **HTTP boundary tests** → `tests/ci/`
- **Real Supabase tests** → `tests/integration/`
- **Test utilities** → `tests/utils/`

## Common Patterns

### Testing Protected Routes (CI)

```typescript
it('should return 401 for protected route without auth', async () => {
  const res = await request(app).get('/api/profile');
  expect(res.status).toBe(401);
  expect(res.body).toHaveProperty('error');
});
```

### Testing CSRF (CI)

```typescript
it('should block POST without Origin/Referer', async () => {
  const res = await request(app).post('/api/auth/signout');
  expect(res.status).toBe(403);
  expect(res.body).toHaveProperty('error', 'csrf_blocked');
});
```

### Testing Real Auth (Integration)

```typescript
describe.skipIf(!hasSupabaseEnv())('Real Auth', () => {
  it('should authenticate with real Supabase', async () => {
    // Create real test user
    // Get real session
    // Make authenticated request
  });
});
```

## Frequently Asked Questions

### Q: Can I add conditional skipping to CI tests?

**No.** CI tests must be deterministic. If a test cannot run without secrets, move it to `tests/integration/`.

### Q: Can I weaken security assertions to make tests pass?

**No.** Security behavior must be asserted, not bypassed. Fix the code, not the test.

### Q: Can I use real Supabase in CI tests?

**No.** CI tests must not require secrets. Use mock Supabase clients instead.

### Q: How do I test a new protected route?

1. Add HTTP boundary test to `tests/ci/routes.ci.test.ts`
2. Add real auth test to `tests/integration/protected-routes.integration.test.ts` (optional)

### Q: What if my test is flaky?

1. If it requires network/secrets, move to `tests/integration/`
2. If it's a CI test, make it deterministic (use mocks, avoid timing dependencies)

## Summary

- **CI Tests**: Deterministic, no secrets, validate HTTP boundaries
- **Integration Tests**: Real Supabase, optional, validate end-to-end flows
- **No Conditional Skipping**: Tests are explicitly separated, not conditionally skipped
- **Security First**: Assert security behavior, never bypass it
- **Explicit > Implicit**: Clear documentation, loud failures, no silent skipping

This separation ensures CI remains fast, deterministic, and secure while still allowing comprehensive integration testing when secrets are available.
