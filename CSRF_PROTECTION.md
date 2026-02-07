# CSRF Protection Implementation

## Overview

This document describes the CSRF (Cross-Site Request Forgery) protection implementation for all mutating HTTP endpoints in the Lyceon API.

## CSRF Protection Strategy

All mutating HTTP endpoints (POST, PUT, PATCH, DELETE) that use cookie-based authentication are protected by CSRF middleware. This prevents cross-site request forgery attacks where an attacker tricks a user's browser into making unauthorized requests.

### Three Ways to Apply CSRF Protection

CSRF protection can be applied in three ways:

**A) Inline Protection** - Apply `csrfProtection` directly to the route handler:
```typescript
import { csrfGuard } from '../middleware/csrf';
const csrfProtection = csrfGuard();

router.post('/endpoint', csrfProtection, async (req, res) => {
  // Handler code
});
```

**B) Router-Level Protection** - Apply `csrfProtection` to all routes in a router:
```typescript
import { csrfGuard } from '../middleware/csrf';
const csrfProtection = csrfGuard();

// Apply to all routes below this line
router.use(csrfProtection);

router.post('/endpoint1', async (req, res) => { /* ... */ });
router.post('/endpoint2', async (req, res) => { /* ... */ });
```

**C) Server Mount Protection** - Apply when mounting the router in `server/index.ts`:
```typescript
import someRouter from './routes/some-routes';
import { csrfGuard } from './middleware/csrf';

const csrfProtection = csrfGuard();

app.use('/api/some', csrfProtection, someRouter);
```

### CSRF Exempt Routes

Some endpoints are intentionally exempt from CSRF protection because they use alternative security mechanisms:

1. **POST /api/auth/exchange-session** - Programmatic token exchange for mobile/API clients
2. **POST /api/billing/webhook** - Stripe webhook endpoint (uses signature verification)

When an endpoint must be exempt, it MUST include a `CSRF_EXEMPT_REASON` comment:

```typescript
/**
 * POST /api/endpoint
 * CSRF_EXEMPT_REASON: Detailed reason why this endpoint is exempt
 */
router.post('/endpoint', async (req, res) => {
  // Handler code
});
```

## Protected Endpoints

All of the following mutating endpoints are protected by CSRF:

### Authentication Routes (supabase-auth-routes.ts)
- POST /api/auth/signup
- POST /api/auth/signin
- POST /api/auth/signout
- POST /api/auth/consent
- POST /api/auth/refresh

### Notification Routes (notification-routes.ts)
- PATCH /api/notifications/:id/read
- PATCH /api/notifications/mark-all-read

### Profile Routes (profile-routes.ts)
- PATCH /api/profile

### Admin Routes (admin-proof-routes.ts)
- POST /api/admin/proof/insert-smoke
- DELETE /api/admin/proof/cleanup-smoke

### Admin Review Routes (server/index.ts)
- POST /api/admin/questions/:id/approve
- POST /api/admin/questions/:id/reject

### Guardian Routes (guardian-routes.ts)
- POST /api/guardian/link
- DELETE /api/guardian/link/:studentId

### Legal Routes (legal-routes.ts)
- POST /api/legal/accept

### Account Routes (account-routes.ts)
- POST /api/account/select

### Billing Routes (billing-routes.ts)
- POST /api/billing/checkout
- POST /api/billing/portal

### Practice Routes (practice-canonical.ts)
- POST /api/practice/answer

### Question Routes (server/index.ts)
- POST /api/questions/validate
- POST /api/questions/feedback
- POST /api/review-errors/attempt

### Tutor Routes (tutor-v2.ts)
- POST /api/tutor/v2

## Verification Script

A deterministic verification script ensures all mutating endpoints are properly protected:

```bash
npm run verify:csrf
```

This script:
1. Scans all route files for mutating HTTP methods (POST, PUT, PATCH, DELETE)
2. Verifies each route has CSRF protection via one of the three methods above
3. Identifies any exempt routes and validates they have proper `CSRF_EXEMPT_REASON` comments
4. Fails if any unprotected routes are found

### Running the Script

```bash
# Via npm script (recommended)
npm run verify:csrf

# Direct execution
npx tsx scripts/verify-csrf-protection.ts
```

### Script Output

The script provides detailed output:
- Total number of mutating routes found
- Number of protected routes
- Number of exempt routes (with reasons)
- List of any unprotected routes (causes failure)

## CSRF Middleware Implementation

The CSRF protection is implemented in `server/middleware/csrf.ts` using origin/referer validation:

1. In development mode, CSRF checks are bypassed for easier testing
2. GET, HEAD, and OPTIONS requests are always allowed
3. For mutating requests, validates the `Origin` or `Referer` header matches allowed origins
4. Returns 403 Forbidden if validation fails

Allowed origins are configured via environment variables:
- `CORS_ORIGINS` - Comma-separated list of allowed origins
- `CSRF_ALLOWED_ORIGINS` - Additional CSRF-specific origins (optional)

## Adding New Endpoints

When adding a new mutating endpoint:

1. **Always add CSRF protection** using one of the three methods above
2. If the endpoint must be exempt, add a `CSRF_EXEMPT_REASON` comment explaining why
3. Run `npm run verify:csrf` to ensure the endpoint is properly protected
4. Add the endpoint to this README documentation

## Security Notes

- CSRF protection is critical for preventing unauthorized state changes
- Never bypass CSRF protection without a documented security justification
- Cookie-based authentication requires CSRF protection
- Token-based authentication (Bearer tokens) does not require CSRF protection
- Webhooks should use signature verification instead of CSRF protection

## References

- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Express CSRF Protection: https://expressjs.com/en/resources/middleware/csurf.html
