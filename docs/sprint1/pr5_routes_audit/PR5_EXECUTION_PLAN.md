# PR5 Execution Plan (Next PRs)

## PR5B: Entitlement gating enforcement (server-first)

### Goals
- Ensure server enforcement is the source of truth for paid-only guardian features and usage-limited student features.
- Align client paywalls with server responses (no UI-only gating for paid access).

### Candidate changes (based on audit)
- **Guardian routes lacking entitlement checks:** `/api/guardian/students` and `/api/guardian/link` currently only check auth + guardian role (no entitlement gate). Evidence: `server/routes/guardian-routes.ts` lines 51-133.【server/routes/guardian-routes.ts:L51-L133】
  - If these routes should be paid-only, add `requireGuardianEntitlement` to the middleware chain.
- **Usage limits source-of-truth:** `checkPracticeLimit` and `checkAiChatLimit` already enforce paid vs free. Evidence: `server/middleware/usage-limits.ts` lines 6-75.【server/middleware/usage-limits.ts:L6-L75】
  - Keep usage limits server-first; ensure error responses are consistent and consumed by client.

### Files to touch (expected)
- `server/routes/guardian-routes.ts` (middleware chain adjustments).【server/routes/guardian-routes.ts:L51-L133】
- `server/middleware/guardian-entitlement.ts` (if behavior or responses need adjustments).【server/middleware/guardian-entitlement.ts:L6-L150】
- `server/middleware/usage-limits.ts` (if response shape needs standardization).【server/middleware/usage-limits.ts:L6-L75】
- `client/src/components/guardian/SubscriptionPaywall.tsx` (align UI states with server error responses, if needed).【client/src/components/guardian/SubscriptionPaywall.tsx:L50-L219】

### Acceptance tests / checks
- `pnpm test` (or project-specific test runner if available).
- Manual API checks for guardian entitlement enforcement:
  - anon blocked
  - guardian without entitlement blocked
  - guardian with entitlement allowed
  - student/admin unaffected

### No-regression guardrails
- No changes to auth token resolution or cookie policy.
- No bypasses for `requireSupabaseAuth` or `requireStudentOrAdmin`.
- Deterministic tests around entitlement gating only.

## PR5C: UI nav polish (back button + consistent shell)

### Goals
- Standardize back affordances and header shells across practice and detail pages.
- Reduce custom headers where a shared shell exists.

### Candidate changes (based on audit)
- **Practice pages not using `PracticeShell`:**
  - `/flow-cards` and `/structured-practice` use custom headers; update to use `PracticeShell` for consistency. Evidence: `client/src/pages/flow-cards.tsx` lines 270-293; `client/src/pages/structured-practice.tsx` lines 220-246; `PracticeShell` definition lines 31-89.【client/src/pages/flow-cards.tsx:L270-L293】【client/src/pages/structured-practice.tsx:L220-L246】【client/src/components/layout/PracticeShell.tsx:L31-L89】
- **Non-nav detail pages missing back affordance:**
  - `/mastery` and `/profile` have page headers without back controls; add consistent back button if required. Evidence: `client/src/pages/mastery.tsx` lines 7-17 and `client/src/pages/UserProfile.tsx` lines 169-179.【client/src/pages/mastery.tsx:L7-L17】【client/src/pages/UserProfile.tsx:L169-L179】

### Files to touch (expected)
- `client/src/pages/flow-cards.tsx`
- `client/src/pages/structured-practice.tsx`
- `client/src/pages/mastery.tsx`
- `client/src/pages/UserProfile.tsx`
- `client/src/components/layout/PracticeShell.tsx` (only if needed for new variants)

### Acceptance tests / checks
- `pnpm lint` (if available)
- Manual UI smoke checklist:
  - Back button visible and consistent on practice flows.
  - Back button behavior matches navigation expectations (safe fallback).
  - Headers/padding match AppShell/PracticeShell patterns.

### No-regression guardrails
- No changes to route guards or auth state handling.
- No changes to API calls or entitlement enforcement in PR5C.
