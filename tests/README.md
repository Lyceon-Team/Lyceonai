# Test Suite Organization

This directory contains the complete test suite for Lyceon AI, organized into deterministic CI tests and real integration tests.

## Directory Structure

```
tests/
├── ci/                           # Deterministic CI tests (NO secrets required)
│   ├── auth.ci.test.ts          # Auth behavior validation
│   ├── security.ci.test.ts      # CSRF protection validation
│   └── routes.ci.test.ts        # Route access control validation
│
├── integration/                  # Real Supabase tests (secrets required)
│   ├── auth.integration.test.ts
│   └── protected-routes.integration.test.ts
│
└── utils/                        # Test utilities
    ├── mock-supabase.ts         # Mock Supabase client factory
    └── auth-helpers.ts          # Auth test helpers

# Legacy test files (preserved for reference)
├── auth.integration.test.ts     # Original integration test (excluded from runs)
├── *.regression.test.ts         # Regression tests
└── specs/                       # Additional test specs
```

## Running Tests

### CI Tests (Required for PR Merge)

```bash
# Run deterministic CI tests (no secrets required)
pnpm test:ci
```

**Requirements:**
- ✅ No environment variables required
- ✅ Runs on forks
- ✅ Runs on fresh clones
- ✅ Deterministic execution

**What's Tested:**
- Cookie-only authentication
- Bearer token rejection
- CSRF protection
- Public vs protected routes
- User identity derivation

### Integration Tests (Optional)

```bash
# Run integration tests (requires real Supabase)
pnpm test:integration
```

**Requirements:**
- ❗ Requires `SUPABASE_URL`
- ❗ Requires `SUPABASE_ANON_KEY`
- ❗ Requires `SUPABASE_SERVICE_ROLE_KEY`

**What's Tested:**
- Real authentication flows
- Real database operations
- Real session management
- End-to-end user flows

### All Tests

```bash
# Run all tests (CI + integration + regression + etc.)
pnpm test:all
```

## Test Philosophy

### CI Tests

**Purpose:** Validate HTTP boundary behavior without external dependencies

**Approach:**
- Use mock Supabase clients that simulate auth states
- Test security assertions (401, 403 responses)
- Validate request/response patterns
- No network calls to external services

**Example:**
```typescript
it('should reject Bearer token without cookie', async () => {
  const res = await request(app)
    .get('/api/profile')
    .set('Authorization', 'Bearer fake-token');
  
  expect(res.status).toBe(401);
});
```

### Integration Tests

**Purpose:** Validate real end-to-end flows with actual Supabase

**Approach:**
- Use real Supabase clients
- Create real test users
- Validate database state
- Test complete user journeys

**Example:**
```typescript
describe.skipIf(!hasSupabaseEnv())('Real Auth', () => {
  it('should authenticate with real token', async () => {
    // Create real test user
    // Get real session
    // Test authenticated flow
  });
});
```

## Security Testing

### What CI Tests Assert

✅ **Cookie-only auth:**
- Bearer tokens are rejected
- Only `sb-access-token` cookie is accepted
- Missing cookie → 401

✅ **CSRF protection:**
- POST without Origin/Referer → 403
- Invalid Origin → 403
- Prefix attacks blocked
- Subdomain impersonation blocked

✅ **Access control:**
- Public routes accessible
- Protected routes require auth
- Admin routes require admin role
- User identity from `req.user.id` (not request body)

### What CI Tests Do NOT Do

❌ Skip tests silently  
❌ Weaken security assertions  
❌ Stub out auth logic  
❌ Accept Bearer tokens  
❌ Use conditional execution based on env vars  

## Adding New Tests

### For a New Protected Route

1. **Add CI test** in `tests/ci/routes.ci.test.ts`:
   ```typescript
   it('should require auth for new route', async () => {
     const res = await request(app)
       .post('/api/new-route')
       .set('Origin', 'http://localhost:5000');
     expect(res.status).toBe(401);
   });
   ```

2. **Add integration test** (optional) in `tests/integration/`:
   ```typescript
   it('should access route with real auth', async () => {
     // Test with real authentication
   });
   ```

### For a New Security Feature

Add test in `tests/ci/security.ci.test.ts`:
```typescript
describe('New Security Feature', () => {
  it('should enforce security rule', async () => {
    // Test security behavior
  });
});
```

## Troubleshooting

### CI Tests Failing Locally

```bash
# Ensure you're in test mode
NODE_ENV=test pnpm test:ci
```

### Integration Tests Skipping

```bash
# Check environment variables
echo $SUPABASE_URL
echo $SUPABASE_ANON_KEY
echo $SUPABASE_SERVICE_ROLE_KEY

# If missing, integration tests will skip with message
```

### CSRF Tests Failing

- Ensure test mode is set (`NODE_ENV=test`)
- Check that allowed origins include localhost:5000
- Verify CSRF middleware is active (not in dev mode)

## Documentation

For comprehensive documentation, see:
- [docs/sprint1/TESTING.md](../docs/sprint1/TESTING.md) - Full testing strategy
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) - CI configuration

## Verification Commands

```bash
# Fresh clone test
git clone https://github.com/Lyceon-Team/Lyceonai.git
cd Lyceonai
pnpm install --frozen-lockfile
pnpm test:ci  # Must pass without secrets
pnpm run build  # Must pass

# Fork test
# Fork the repo on GitHub
# Run CI tests - must pass without secrets

# Integration test
export SUPABASE_URL=...
export SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...
pnpm test:integration
```

## Summary

- **CI Tests:** Fast, deterministic, no secrets
- **Integration Tests:** Comprehensive, real services, secrets required
- **No Conditional Skipping:** CI tests always run
- **Security First:** Assert behavior, never bypass
- **Explicit Separation:** Clear boundaries between test types

This ensures CI remains fast and reliable while still allowing thorough integration testing when needed.
