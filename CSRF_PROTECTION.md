# CSRF Protection Implementation

## Overview

This document describes the CSRF (Cross-Site Request Forgery) protection implementation for all mutating HTTP endpoints in the Lyceon API.

## CSRF Protection Strategy

All mutating HTTP endpoints (POST, PUT, PATCH, DELETE) that use cookie-based authentication are protected by CSRF middleware. Lyceon uses a **signed double-submit cookie** pattern (`csrf-csrf`) so the CSRF token is issued via a dedicated endpoint and validated on each state-changing request.

### Three Ways to Apply CSRF Protection

CSRF protection can be applied in three ways:

**A) Inline Protection** - Apply `doubleCsrfProtection` directly to the route handler:
```typescript
import { doubleCsrfProtection } from '../middleware/csrf-double-submit';

router.post('/endpoint', doubleCsrfProtection, async (req, res) => {
  // Handler code
});
```

**B) Router-Level Protection** - Apply `doubleCsrfProtection` to all routes in a router:
```typescript
import { doubleCsrfProtection } from '../middleware/csrf-double-submit';

// Apply to all routes below this line
router.use(doubleCsrfProtection);

router.post('/endpoint1', async (req, res) => { /* ... */ });
router.post('/endpoint2', async (req, res) => { /* ... */ });
```

**C) Server Mount Protection** - Apply when mounting the router in `server/index.ts`:
```typescript
import someRouter from './routes/some-routes';
import { doubleCsrfProtection } from './middleware/csrf-double-submit';

app.use('/api/some', doubleCsrfProtection, someRouter);
```

### CSRF Exempt Routes

Some endpoints are intentionally exempt from CSRF protection because they use alternative security mechanisms or are read-only:

1. **POST /api/billing/webhook** - Stripe webhook endpoint (uses signature verification)
2. **GET /healthz**, **GET /api/health** - Health checks
3. **GET /auth/google/callback**, **GET /api/auth/google/callback** - OAuth provider redirects
4. **GET/HEAD/OPTIONS** - read-only/public/SSR surfaces

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

### Tutor Routes (tutor-runtime.ts)
- POST /api/tutor/messages
- POST /api/tutor/conversations
- POST /api/tutor/conversations/:conversationId/close

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

The CSRF protection is implemented in `server/middleware/csrf-double-submit.ts` using `csrf-csrf` (signed double-submit cookie):

1. The client fetches `GET /api/csrf-token` to receive a signed token and CSRF cookie
2. The client includes the token in `x-csrf-token` for mutating requests
3. The server validates the token and cookie match for every POST/PUT/PATCH/DELETE

Configuration:
- `CSRF_SECRET` (required in production)
- `CSRF_COOKIE_NAME` (optional override)

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
- csrf-csrf: https://www.npmjs.com/package/csrf-csrf
