# Entitlements and Gates

## Entitlement representation (server)
- Entitlements are stored as `plan` (`free`/`paid`), `status` (`active`, `trialing`, `past_due`, `canceled`, `inactive`), and `current_period_end`. Evidence: `server/lib/account.ts` lines 123-129.【server/lib/account.ts:L123-L129】
- Usage limits are tied to entitlements: paid plans with `active` or `trialing` bypass limits; free plans use `FREE_TIER_LIMITS` (`practice: 10`, `ai_chat: 5`). Evidence: `server/lib/account.ts` lines 137-140 and 298-325.【server/lib/account.ts:L137-L140】【server/lib/account.ts:L298-L325】

## Canonical gating points (server)
- Guardian subscription enforcement uses `requireGuardianEntitlement`, which checks the student account entitlement and returns `402 PAYMENT_REQUIRED` if missing or inactive. Evidence: `server/middleware/guardian-entitlement.ts` lines 65-135.【server/middleware/guardian-entitlement.ts:L65-L135】
- Practice usage limits are enforced by `checkPracticeLimit` middleware, which calls `checkUsageLimit`. Evidence: `server/middleware/usage-limits.ts` lines 6-75 and `server/routes/practice-canonical.ts` lines 219-306.【server/middleware/usage-limits.ts:L6-L75】【server/routes/practice-canonical.ts:L219-L306】
- AI chat usage limits are enforced by `checkAiChatLimit` in the `/api/tutor/v2` chain. Evidence: `server/middleware/usage-limits.ts` lines 70-75 and `server/index.ts` line 273.【server/middleware/usage-limits.ts:L70-L75】【server/index.ts:L272-L273】

## Canonical gating points (client)
- Role gates in routing are handled by `RequireRole` (redirects when user missing or role not allowed). Evidence: `client/src/components/auth/RequireRole.tsx` lines 13-57 and `client/src/App.tsx` lines 82-103.【client/src/components/auth/RequireRole.tsx:L13-L57】【client/src/App.tsx:L82-L103】
- Admin-only UI is gated by `AdminGuard` inside `AdminPortal`. Evidence: `client/src/pages/AdminPortal.tsx` lines 22-36 and `client/src/components/auth/AdminGuard.tsx` lines 6-78.【client/src/pages/AdminPortal.tsx:L22-L36】【client/src/components/auth/AdminGuard.tsx:L6-L78】
- Guardian subscription UI gating uses `SubscriptionPaywall` wrapping the guardian dashboard. Evidence: `client/src/pages/guardian-dashboard.tsx` lines 175-188 and `client/src/components/guardian/SubscriptionPaywall.tsx` lines 50-219.【client/src/pages/guardian-dashboard.tsx:L175-L188】【client/src/components/guardian/SubscriptionPaywall.tsx:L50-L219】

## Entitlement gating matrix

| Feature / Route | Intended audience | Required entitlement | Current enforcement | Evidence |
|---|---|---|---|---|
| `/guardian` page (GuardianDashboard) | Guardian/Admin | Paid guardian entitlement (UI expectation) | Client only (`SubscriptionPaywall`) | `client/src/pages/guardian-dashboard.tsx` lines 175-188; `client/src/components/guardian/SubscriptionPaywall.tsx` lines 50-219.【client/src/pages/guardian-dashboard.tsx:L175-L188】【client/src/components/guardian/SubscriptionPaywall.tsx:L50-L219】 |
| `GET /api/guardian/students/:studentId/summary` | Guardian/Admin | Paid entitlement on linked student account | Server (`requireGuardianEntitlement`) + client paywall | `server/routes/guardian-routes.ts` lines 184-265; `server/middleware/guardian-entitlement.ts` lines 65-135; `client/src/pages/guardian-dashboard.tsx` lines 175-188.【server/routes/guardian-routes.ts:L184-L265】【server/middleware/guardian-entitlement.ts:L65-L135】【client/src/pages/guardian-dashboard.tsx:L175-L188】 |
| `GET /api/guardian/students/:studentId/calendar/month` | Guardian/Admin | Paid entitlement on linked student account | Server (`requireGuardianEntitlement`) + client paywall | `server/routes/guardian-routes.ts` lines 323-430; `server/middleware/guardian-entitlement.ts` lines 65-135; `client/src/pages/guardian-dashboard.tsx` lines 175-188.【server/routes/guardian-routes.ts:L323-L430】【server/middleware/guardian-entitlement.ts:L65-L135】【client/src/pages/guardian-dashboard.tsx:L175-L188】 |
| `GET /api/guardian/weaknesses/:studentId` | Guardian/Admin | Paid entitlement on linked student account | Server (`requireGuardianEntitlement`) + client paywall | `server/routes/guardian-routes.ts` lines 435-517; `server/middleware/guardian-entitlement.ts` lines 65-135; `client/src/pages/guardian-dashboard.tsx` lines 175-188.【server/routes/guardian-routes.ts:L435-L517】【server/middleware/guardian-entitlement.ts:L65-L135】【client/src/pages/guardian-dashboard.tsx:L175-L188】 |
| `GET /api/practice/next` | Student/Admin | Paid entitlement lifts usage limits; free has daily limits | Server (`checkPracticeLimit` → `checkUsageLimit`) | `server/routes/practice-canonical.ts` lines 219-306; `server/middleware/usage-limits.ts` lines 6-75; `server/lib/account.ts` lines 298-325.【server/routes/practice-canonical.ts:L219-L306】【server/middleware/usage-limits.ts:L6-L75】【server/lib/account.ts:L298-L325】 |
| `POST /api/tutor/v2` | Student/Admin | Paid entitlement lifts usage limits; free has daily limits | Server (`checkAiChatLimit` → `checkUsageLimit`) | `server/index.ts` line 273; `server/middleware/usage-limits.ts` lines 70-75; `server/lib/account.ts` lines 298-325.【server/index.ts:L272-L273】【server/middleware/usage-limits.ts:L70-L75】【server/lib/account.ts:L298-L325】 |
| `/admin` page and `/api/admin/*` | Admin | N/A (role-based) | Server (`requireSupabaseAdmin`) + client `AdminGuard` | `server/index.ts` lines 323-339; `server/middleware/supabase-auth.ts` lines 427-469; `client/src/components/auth/AdminGuard.tsx` lines 6-78.【server/index.ts:L323-L339】【server/middleware/supabase-auth.ts:L427-L469】【client/src/components/auth/AdminGuard.tsx:L6-L78】 |

## UNKNOWNs (missing evidence)
- No entitlement enforcement is shown for `/api/guardian/students` (list) beyond role check; if it should be paid-only, evidence of a requirement is not present in code. The current route only checks guardian role and auth. Evidence: `server/routes/guardian-routes.ts` lines 51-72.【server/routes/guardian-routes.ts:L51-L72】
