# Mismatches and Delete Candidates

## Server endpoints with no client callers found (rg search in client)

### Admin diagnostics and proof endpoints
- **Endpoints:** `/api/admin/health`, `/api/admin/db-health`, `/api/admin/supabase-debug`, `/api/admin/questions/*`, `/api/admin/proof/*`
- **Server evidence:**
  - `/api/admin/health` mounted with `requireSupabaseAdmin`. 【server/index.ts:L326-L327】【server/routes/admin-health-routes.ts:L56-L209】
  - `/api/admin/db-health` and `/api/admin/supabase-debug` in `server/index.ts`. 【server/index.ts:L338-L358】【server/index.ts:L426-L454】
  - `/api/admin/questions/needs-review|statistics|:id/approve|:id/reject` in `server/index.ts`. 【server/index.ts:L421-L424】
  - `/api/admin/proof/*` routes in `server/routes/admin-proof-routes.ts`. 【server/routes/admin-proof-routes.ts:L25-L181】
- **Client search evidence (no matches):**
  - `rg -n "/api/admin/health" client/src` → *(no output)*
  - `rg -n "/api/admin/db-health" client/src` → *(no output)*
  - `rg -n "/api/admin/supabase-debug" client/src` → *(no output)*
  - `rg -n "/api/admin/questions" client/src` → *(no output)*
- **Recommended action:** defer (confirm external tooling usage) 
- **Risk if left as-is:** unused endpoints increase maintenance surface area.

### Billing debug / products endpoints
- **Endpoints:** `/api/billing/debug/*`, `/api/billing/publishable-key`, `/api/billing/products`, `/api/billing/products/:productId/prices`, `/api/billing/prices/authenticated`
- **Server evidence:** `server/routes/billing-routes.ts` routes at lines 406-717.【server/routes/billing-routes.ts:L406-L717】
- **Client search evidence (no matches):**
  - `rg -n "/api/billing/(debug|publishable-key|products)" client/src` → *(no output)*
- **Recommended action:** defer
- **Risk if left as-is:** unused endpoints increase maintenance surface area.

### Health and debug endpoints
- **Endpoints:** `/api/health/practice`, `/api/_whoami`
- **Server evidence:** `server/routes/health-routes.ts` lines 38-120 and `server/index.ts` lines 489-497.【server/routes/health-routes.ts:L38-L120】【server/index.ts:L489-L497】
- **Client search evidence (no matches):**
  - `rg -n "/api/health" client/src` → *(no output)*
- **Recommended action:** defer
- **Risk if left as-is:** unused endpoints increase maintenance surface area.

### Questions endpoints unused by client
- **Endpoints:** `/api/questions/search`, `/api/questions/count`, `/api/questions/feed`
- **Server evidence:** `server/index.ts` lines 396-401.【server/index.ts:L396-L401】
- **Client search evidence (no matches):**
  - `rg -n "/api/questions/search" client/src` → *(no output)*
  - `rg -n "/api/questions/(count|feed)" client/src` → *(no output)*
- **Recommended action:** defer
- **Risk if left as-is:** unused endpoints increase maintenance surface area.

### Profile endpoint unused by client
- **Endpoint:** `/api/profile`
- **Server evidence:** `server/index.ts` lines 284-305.【server/index.ts:L284-L305】
- **Client search evidence:** client uses `/api/auth/user` for user profile. Evidence: `client/src/pages/UserProfile.tsx` lines 67-71.【client/src/pages/UserProfile.tsx:L67-L71】
- **Recommended action:** defer
- **Risk if left as-is:** unused endpoint increases maintenance surface area.

### Document upload endpoint unused by client
- **Endpoint:** `/api/documents/upload`
- **Server evidence:** `server/index.ts` lines 476-478.【server/index.ts:L476-L478】
- **Client search evidence (no matches):**
  - `rg -n "/api/documents/upload" client/src` → *(no output)*
- **Recommended action:** defer
- **Risk if left as-is:** unused endpoint increases maintenance surface area.

## Client calls to endpoints not mounted in server/index.ts (404 risk)

### Progress and activity endpoints
- **Client callers:**
  - `/api/progress` used in `client/src/pages/lyceon-dashboard.tsx` lines 62-69 and `client/src/pages/dashboard.tsx` lines 49-57.【client/src/pages/lyceon-dashboard.tsx:L62-L69】【client/src/pages/dashboard.tsx:L49-L57】
  - `/api/recent-activity` used in `client/src/pages/lyceon-dashboard.tsx` lines 67-69.【client/src/pages/lyceon-dashboard.tsx:L67-L69】
  - `/api/progress/detailed` used in `client/src/pages/UserProfile.tsx` lines 73-77.【client/src/pages/UserProfile.tsx:L73-L77】
- **Server evidence:** only `/api/progress/projection` and `/api/progress/kpis` are mounted in `server/index.ts`. 【server/index.ts:L317-L321】
- **Related handlers exist but are not mounted:** `getRecentActivity` and `getProgress` are defined in `apps/api/src/routes/progress.ts`.【apps/api/src/routes/progress.ts:L137-L200】【apps/api/src/routes/progress.ts:L265-L360】
- **Recommended action:** wire (mount the missing handlers) or delete client calls.
- **Risk if left as-is:** dashboard/profile API calls return 404.

### User profile/settings endpoints
- **Client callers:** `/api/user/profile` and `/api/user/notification-settings` in `client/src/pages/UserProfile.tsx` lines 85-115. 【client/src/pages/UserProfile.tsx:L85-L115】
- **Server evidence:** no `/api/user/*` routes are mounted in `server/index.ts`.【server/index.ts:L284-L487】
- **Recommended action:** wire or delete client calls.
- **Risk if left as-is:** profile update and notification settings calls return 404.

### Practice end-session endpoint
- **Client caller:** `/api/practice/end-session` in `client/src/hooks/use-adaptive-practice.ts` lines 239-246.【client/src/hooks/use-adaptive-practice.ts:L239-L246】
- **Server evidence:** `/api/practice` router defines only `/next` and `/answer`.【server/routes/practice-canonical.ts:L219-L306】
- **Recommended action:** wire or delete client call.
- **Risk if left as-is:** end-session calls return 404.

### Ingestion v4 endpoints
- **Client callers:** multiple `/api/ingestion-v4/*` endpoints in `client/src/pages/admin-v4-operations.tsx` lines 96-436 and components under `client/src/components/v4/*`.【client/src/pages/admin-v4-operations.tsx:L96-L436】【client/src/components/v4/CatalogStatus.tsx:L24-L77】
- **Server evidence:** no `/api/ingestion-v4` route definitions in `server/` or `apps/` (`rg -n "/api/ingestion-v4" server apps -g '!**/*.tsbuildinfo'` → *(no output)*).
- **Recommended action:** wire (if these endpoints are supposed to exist in this service) or delete client code.
- **Risk if left as-is:** admin v4 UI cannot load data.

### Legacy ingest endpoints
- **Client callers:** `/api/ingest/jobs`, `/api/ingest-llm/test`, `/api/ingest-llm/retry/:jobId` in `client/src/components/admin/JobDashboard.tsx` lines 98-163.【client/src/components/admin/JobDashboard.tsx:L98-L163】
- **Server evidence:** no `/api/ingest` route definitions found (`rg -n "/api/ingest" server apps -g '!**/*.tsbuildinfo'` shows only comments in `server/services/ragPipeline.ts`).【server/services/ragPipeline.ts:L171-L193】
- **Recommended action:** wire or delete client code.
- **Risk if left as-is:** Job Dashboard actions return 404.

### Analytics endpoints
- **Client callers:** `/api/analytics/detailed` and `/api/analytics/history` in `client/src/components/AnalyticsModal.tsx` lines 94-100.【client/src/components/AnalyticsModal.tsx:L94-L100】
- **Server evidence:** no `/api/analytics` route definitions (`rg -n "/api/analytics" server apps -g '!**/*.tsbuildinfo'` → *(no output)*).
- **Recommended action:** wire or delete client code.
- **Risk if left as-is:** analytics modal cannot load data.

## Dead pages/components not routed
- `client/src/pages/dashboard.tsx` exists but `/dashboard` routes to `LyceonDashboard` instead of `Dashboard`. Evidence: `client/src/pages/dashboard.tsx` lines 1-80 and `client/src/App.tsx` lines 82-84.【client/src/pages/dashboard.tsx:L1-L80】【client/src/App.tsx:L82-L84】
- **Recommended action:** delete or wire (if legacy dashboard is still needed).
- **Risk if left as-is:** duplicate/unused page increases maintenance surface area.

## Redirect routes still referenced
- Legacy admin redirects exist in routing, and `/admin-dashboard` is still referenced from `NavBar`. Evidence: `client/src/App.tsx` lines 109-117 and `client/src/components/NavBar.tsx` lines 82-86.【client/src/App.tsx:L109-L117】【client/src/components/NavBar.tsx:L82-L86】
- **Recommended action:** defer (confirm whether to update the NavBar link to `/admin`).
- **Risk if left as-is:** extra redirect hop and inconsistent canonical URL in UI.
