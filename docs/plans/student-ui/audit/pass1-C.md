# Pass 1-C — Shells, entry/root, public pages, flags, orphans, nav-target map

Snapshot: `origin/main` @ d2902eec, extracted at `.../scratchpad/main`. All paths below are relative to that root.
READ-ONLY: nothing under the repo was modified. Evidence = file:line. "unverified" is stated where the code alone cannot settle a claim.

Grep exit-code convention used below: `exit 0` = matches found, `exit 1` = ran fine, **zero matches (empty)**, `exit 2` = grep error (none occurred).

---

## 1. SHELLS

### 1.1 Shell/nav component inventory

| Component | Renders | Nav config (label -> href, file:line) | Container / width / padding | Imported by (non-test) |
|---|---|---|---|---|
| `AppShell` (`client/src/components/layout/app-shell.tsx`) | sticky `<header>` (AppHeader, 147-238) with SkipLink, wordmark, desktop `<nav>` (169-173), NotificationBell (178, only if `user`), mobile Sheet (181-227: nav + Settings -> `/profile` 205 + Sign Out), `HeaderUserMenu` (230-234). `<main id="main">` (71). Optional `<Footer/>` when `showFooter` (74). `hideNav` prop drops the header (70). **No sidebar.** | exported `navItems` 39-50: Dashboard->/dashboard (44), Calendar->/calendar (45), Practice->/practice (46), Tests->/tests (47), Review->/review (48), Lisa->/chat (49). Logo -> /dashboard (158-166). Active rule: exact or `startsWith(href)` except /dashboard (112-113). | header inner: `container mx-auto px-4 sm:px-6 lg:px-8`, h-16 (150-151). `<main>` has NO max-width (71) — each page sets its own. | `features/exam/pages/TestsHomePage.tsx:23`, `pages/browse-topics.tsx:3`, `pages/UserProfile.tsx:3`, `pages/admin/CrisisReviewList.tsx:19`, `pages/admin/CrisisReviewDetail.tsx:20`, `pages/lyceon-dashboard.tsx:5`, `pages/upgrade.tsx:4`, `pages/practice.tsx:1`, `pages/mastery.tsx:1`, `pages/review.tsx:51`, `pages/notifications.tsx:35` |
| `PracticeShell` (`layout/PracticeShell.tsx`) | sticky `<header>` (50-104): Back button (54-61, `window.location.assign(backLink)` = full reload, 57), eyebrow+title (62-69), accuracy/streak/`i / N` pills (72-95), progress bar (98-102). `<main>` (106). No global nav, no footer, no bell, no user menu. | defaults `backLink="/practice"`, `backLabel="Back to Practice"` (34-35); callers pass `engine.backHref` (`CanonicalPracticePage.tsx:812`) = `/practice` (`lib/engine-config.ts:192`) or `/review` (`engine-config.ts:249`) | `container mx-auto px-4 py-4` + `max-w-7xl`, or `max-w-[1600px]` when `wide` (41, 51); main `container mx-auto px-4 py-6` + same width (106). `wide={tutorVisible}` (`CanonicalPracticePage.tsx:823`). | `components/practice/CanonicalPracticePage.tsx:24` (itself imported by `pages/resume-practice.tsx:37`, `pages/resume-review.tsx:37`) |
| `PublicLayout` (`layout/PublicLayout.tsx`) | `PageShell` > `PublicNavBar` + `<main>` + `Footer` (12-18) | none itself | none (no max-width on `<main>`, 14); pages use `Container` | `pages/home.tsx:22`, `pages/blog.tsx:4`, `pages/blog-post.tsx:4`, `pages/digital-sat.tsx:11`, `pages/digital-sat-math.tsx:9`, `pages/digital-sat-reading-writing.tsx:3` |
| `PublicNavBar` (`layout/PublicNavBar.tsx`) | sticky `<nav>` (16): logo -> `/` (18-24), links (27-41), auth CTA (43-65) | `navLinks` 9-13: Home->/ (10), Digital SAT->/digital-sat (11), Blog->/blog (12). Authenticated: Dashboard->/dashboard (45). Unauth: Sign In->/login (53), Get Started->/login (59). | `max-w-6xl mx-auto px-6 h-14` (17) | only `layout/PublicLayout.tsx:3` |
| `GuardianShell` (`layout/GuardianShell.tsx`) | sticky `<header>` (48-80): SkipLink, logo "Lyceon Guardian" -> `/guardian` (59-70), NotificationBell (74), HeaderUserMenu (75). `<main id="main">` (36). No nav links, no footer, no mobile sheet. | logo -> /guardian (60) only | header `container mx-auto px-4 sm:px-6 lg:px-8`, h-16 (53-54); main no max-width | `pages/guardian-dashboard.tsx:52`, `pages/notifications.tsx:36` |
| `HeaderUserMenu` + `useHeaderSignOut` (`layout/HeaderUserMenu.tsx`) | Dropdown: name/email (90-108), Settings -> /profile (112-118), admin-only "Crisis review" -> /admin/crisis-review (126-134, gated `isAdmin`), Sign Out (136-143). Returns `null` if no user (69). Sign-out success -> `navigate("/login")` (48). | Settings->/profile (113); Crisis review->/admin/crisis-review (128); sign-out->/login (48) | n/a (w-56 dropdown, 88) | `layout/app-shell.tsx:24`, `layout/GuardianShell.tsx:24` |
| `Footer` (`layout/Footer.tsx`) | `<footer>` (23) 4-column grid | logo->/ (28); product: Digital SAT Prep->/digital-sat (9), SAT Math->/digital-sat/math (10), SAT Reading & Writing->/digital-sat/reading-writing (11); resources: Blog->/blog (13); legal: Trust & Safety->/trust (15), Legal Hub->/legal (16), Privacy Policy->/legal/privacy-policy (17), Terms of Use->/legal/student-terms (18) | `max-w-6xl mx-auto px-6 py-12` (24) | `layout/PublicLayout.tsx:4`, `layout/app-shell.tsx:23`, `pages/legal.tsx:27`, `pages/trust.tsx:23`, `pages/trust-evidence.tsx:18`, `pages/legal-doc.tsx:58` |
| `primitives.tsx` | `PageShell` (9-15, `min-h-screen bg-background`), `Container` (23-36), `Section` (46-62, `py-12`), `Prose` (69-87), `Breadcrumb` (99-116, **raw `<a href>` = full page reload**, 106), `Card` (125-135), `Hero` (144-158) | Breadcrumb items are caller-supplied | `Container`: narrow `max-w-3xl`, default `max-w-4xl`, wide `max-w-6xl`, full `max-w-7xl` (24-29) + `mx-auto px-6 lg:px-8` (32) | `PublicLayout.tsx:2` (PageShell); `home.tsx:23` (Container, Card, Section); `blog.tsx:11`, `digital-sat.tsx:18` (Container, Hero, Card, Breadcrumb, Section); `blog-post.tsx:10`, `digital-sat-math.tsx:15`, `digital-sat-reading-writing.tsx:9` (Container, Breadcrumb, Card, Section). `Prose` has no non-test consumer. |
| `NavBar` (`components/NavBar.tsx`) | fixed `<nav>` (39-125): title, tabs, avatar dropdown | `navTabs` 32-36: Practice->/practice (33), Review->/review (34), Progress->/dashboard (35); menu Profile->/profile (88), Settings->/profile (96), sign-out -> `/` (23), Sign In->/login (116) | `px-6 h-14`, full width, no max-width (40) | **NONE** |
| `Navigation` (`components/navigation.tsx`) | sticky `<nav>` with role-aware links + dropdown | home: `/guardian` if guardian else `/dashboard` (59, 67); guardian: Guardian Dashboard->/guardian (79); else Dashboard->/dashboard (89), Practice->/practice (96), Review->/review (103), Lisa->/chat (110); Profile & Settings->/profile (171); logout->/login (28); Login->/login (191) | `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` (44, 63) | **NONE** |
| `ProgressSidebar` (`components/progress-sidebar.tsx`) | 3 cards: progress (query **disabled**, `enabled: false`, 22), quick actions, **hard-coded fake "Recent Activity"** (25-47) | Start Practice Test->/practice (136), Review Queue->/review (147), Random Questions->/practice/random (159); "View Analytics" button has no handler (167-174) | `space-y-6`, no width (63) | **NONE** |

### 1.2 Shell/nav components imported by nothing (non-test)

Command (run from `client/src`):
```
for p in "layout/app-shell" "layout/PracticeShell" "layout/PublicLayout" "layout/PublicNavBar" "layout/GuardianShell" "layout/HeaderUserMenu" "layout/Footer" "layout/primitives" "components/NavBar" "components/navigation" "progress-sidebar" '\./Footer' '\./HeaderUserMenu' '\./primitives' '\./PublicNavBar'; do
  echo "=== $p"; grep -rnE "from ['\"][^'\"]*$p['\"]" . --include=*.ts --include=*.tsx | grep -vE '\.test\.tsx?:'; echo "(exit ${PIPESTATUS[0]})"; done
```
Relevant output:
```
=== components/NavBar
(exit 1)
=== components/navigation
(exit 1)
=== progress-sidebar
(exit 1)
```
(`layout/PublicNavBar` and `layout/HeaderUserMenu` also `exit 1` for the `@/` alias, but both are imported relatively: `PublicLayout.tsx:3`, `app-shell.tsx:24`, `GuardianShell.tsx:24`.)

Repo-wide confirmation (client, apps, packages, tests):
```
grep -rnE "NavBar|/navigation['\"]|ProgressSidebar|progress-sidebar" client apps packages tests --include=*.ts --include=*.tsx
client/src/components/layout/PublicNavBar.tsx:5:export default function PublicNavBar() {
client/src/components/layout/PublicLayout.tsx:3:import PublicNavBar from "./PublicNavBar";
client/src/components/layout/PublicLayout.tsx:13:      <PublicNavBar />
client/src/components/progress-sidebar.tsx:18:export default function ProgressSidebar() {
client/src/components/NavBar.tsx:14:export default function NavBar() {
client/src/review-entry-points.test.ts:75:      "client/src/components/NavBar.tsx",
client/src/review-entry-points.test.ts:77:      "client/src/components/progress-sidebar.tsx",
```
**Dead shells: `components/NavBar.tsx`, `components/navigation.tsx`, `components/progress-sidebar.tsx`** — referenced only as path strings inside a test (`review-entry-points.test.ts:75,77`). `Prose` in primitives is also unconsumed.

### 1.3 Which authenticated pages have NO global nav (derived from per-page survey)
- `/calendar` (`pages/calendar.tsx`): no layout import (imports 18-49); only chrome is `Chrome.tsx:315-321` "← Dashboard" link (`backHref="/dashboard"`, `calendar.tsx:146,196`).
- `/chat` (`pages/chat.tsx`): own `<aside>`/`<header>` (≈463-512); the only navigation targets in the file are `/chat?conversationId=…` (334) and `/chat` (387). **No link to any other page** (dead end except browser back).
- `/tutor` (`pages/tutor.tsx`): `mx-auto flex h-screen max-w-2xl` (75); redirects to `/chat?conversationId=…` (50).
- `/practice/session/:id`, `/review/session/:id`: PracticeShell only (back button).
- `/tests/:id`, `/tests/:id/:section/:module`, `/tests/:id/report`: own local `Shell`/header (`ExamSessionPage.tsx:68-71`, `ExamReportPage.tsx:78-82`, ExamModulePage has none of the matched patterns). Report page has "Dashboard" link (`ExamReportPage.tsx:92`); `ExamStatus.tsx:34` links `/tests`.
- `/profile/complete`, `/update-password`, `/account/recover`, `/login`, 404: centered card, no header/footer.
- Public but not PublicLayout: `/trust`, `/trust/evidence`, `/legal` render **Footer only, no header/nav** (`trust.tsx:34-36`, `trust-evidence.tsx:22-24`, `legal.tsx:67-70`); `/legal/:slug` has own sticky header with only "Back to Legal Hub" (`legal-doc.tsx:130-137`) + Footer (166).

### 1.4 App.tsx global wrappers
Provider order (`App.tsx:422-447`): `ErrorBoundary` > `HelmetProvider` > `QueryClientProvider` > `SupabaseAuthProvider` > `UIProvider` > `DeletionGate` > `Router`; `<Analytics beforeSend={analyticsBeforeSend}/>` sits inside ErrorBoundary but outside providers (444).

- **ErrorBoundary** (`App.tsx:363-404`): class component; on error renders full-screen card "Something went wrong" + **raw `this.state.error?.message`** (389) + "Reload Page" button (`window.location.reload()`, 392). `componentDidCatch(error, errorInfo: any)` uses **`any`** (376) and `console.error` (377). No route-level boundary; one boundary for the whole app.
- **PageLoader** (`App.tsx:100-109`): spinner + "Loading..."; used as `<Suspense fallback>` for all lazy routes (113).
- **DeletionGate** (`App.tsx:413-420`): if `user?.pendingDeletion` and location ≠ `/account/recover`, renders `PendingDeletionScreen` for **every** route, public ones included (416-417). `pendingDeletion` comes from `/api/profile` (`SupabaseAuthContext.tsx:126`). PendingDeletionScreen restore -> `window.location.assign("/dashboard")` (`PendingDeletionScreen.tsx:49,55`).
- **RequireRole** (`components/auth/RequireRole.tsx`):
  - Fetches `/api/profile` (query key `["/api/profile"]`, 44-62) when a user exists.
  - Loading (`authLoading || (user && profileLoading)`, 64): full-screen spinner + "Loading..." (65-73).
  - Unauthenticated (75-89): `<Redirect to={loginPathWithReturn(pathname+search)} replace/>` → `/login?next=<encoded>` only if the path is on `RETURN_PATH_ALLOWLIST`, else bare `/login` (`packages/shared/src/return-path.ts:94-98`).
  - Role derivation (91-95): admin > guardian > student (anything not admin/guardian is treated as student).
  - Wrong role (100-108): guardian → `/guardian`; admin → `/dashboard`; student → `/dashboard` (all `replace`).
  - Onboarding (110-133): non-admin not on `/profile/complete` with `guardianConsentRequired === true || requiredProfileComplete === false || !profileCompletedAt` → `<Redirect to="/profile/complete" replace/>`.
  - Re-consent (135-176): renders children always; overlays `ReconsentModal` when outstanding legal docs exist and not dismissed.
  - Type `AuthUserResponse.user` has `[key: string]: any` (**`any`**, line 30).
- **NotFound** (`pages/not-found.tsx`): catch-all `<Route component={NotFound}/>` (`App.tsx:357`); also rendered by `legal-doc.tsx:197` for unknown slugs. Renders "404 Page Not Found" + developer copy **"Did you forget to add the page to the router?"** (15-16); **no link home, no shell**; hard-coded `bg-gray-50`/`text-gray-900` (6, 11) rather than tokens.

Also: most `RequireRole` routes use inline `component={() => (...)}` arrows (e.g. `App.tsx:137, 157, 165 …`); only the four exam routes use module-scope wrappers (36-63), with the comment at 30-31 stating inline arrows remount on Switch re-render.

---

## 2. ENTRY-ROOT pages

### `/` — `pages/home.tsx` (`App.tsx:116`, eager import 18)
- Shell: `PublicLayout` (130/844); Containers `full`/`wide`/default/`narrow`.
- Data: `useQuery(["/api/public/pricing"], getPublicMonthlyPrice, retry:1)` (70-74); auth from context (77).
- Does NOT redirect authenticated users; shows "Go to dashboard" + "Sign out" instead (205-224, 811-828).
- A/B hero variant via `Math.random()` persisted in localStorage (`landing_hero_variant`, 102-115); `console.debug` CTA tracking (126).
- CTAs: `/practice` (189, 805; signed-out → RequireRole → `/login?next=%2Fpractice`), `/dashboard` (207, 814), `/login` (226, 633, 833), `/signup` (709).
- Stale comment: "`/signup` redirects to `/login` (`App.tsx:71`)" — actual line is `App.tsx:120`.

### `/login` — `pages/login.tsx` (`App.tsx:117`)
- No shell; `max-w-md` card (84-95). **No link back to `/`** (neither `login.tsx` nor `SupabaseAuthForm.tsx` contain one — nav grep §7 shows only legal links at `SupabaseAuthForm.tsx:400,407,489,496`).
- `?error=<code>` → `humanAuthError` alert (19-22, 86-91).
- **Signup flow**: `SupabaseAuthForm` tabs `signin|signup` (254-460), initial `mode="signin"` (39) — no query param selects the signup tab, so `/signup` (→ `/login`) and every "Get Started"/`/signup` CTA lands on **Sign In**. Signup posts `/api/auth/signup` with consent (`SupabaseAuthContext.tsx:228-242`); no role field. Server sets `role: "student"` as "Safe temporary backend role until profile-complete finalization" (`server/routes/supabase-auth-routes.ts:149-150`) and returns `nextPath: "/profile/complete"` (289); client stores `nextPath` (`SupabaseAuthContext.tsx:275`) but **nothing reads it** (only occurrences: `SupabaseAuthContext.tsx:26,275`). If `outcome === "verification_required"` the form shows a verify message and stays (`SupabaseAuthForm.tsx:123-135`); email link lands at `/auth/callback` (`supabase-auth-routes.ts:138`).
- **Post-auth redirect (email/password)** — `login.tsx:24-61` effect once `isAuthenticated && user`:
  1. default `user.role === "guardian" ? "/guardian" : "/dashboard"` (42);
  2. `returnPathFromSearch(location.search)` (allowlisted `next`) overrides (48-52);
  3. non-admin with `guardianConsentRequired === true || requiredProfileComplete === false || !profile_completed_at` → `/profile/complete` (37-40, 55-57);
  4. `navigate(destination)` (59).
  → **A completed student with no `next` lands on `/dashboard`.** New signups land on `/profile/complete`.
- `RETURN_PATH_ALLOWLIST` (`packages/shared/src/return-path.ts:24-47`): `/guardian, /dashboard, /profile, /practice, /review, /chat, /mastery, /upgrade, /update-password, /notifications, /admin/crisis-review`. **Absent: `/calendar`, `/tests`, `/tutor`, `/students`.** A signed-out deep link to `/calendar` or `/tests/...` collapses to bare `/login` and ends on `/dashboard`. Note server notification emails link `${siteUrl}/calendar` (`server/lib/notifications/templates/full-length.ts:83,145,174`).
- Google: `signInWithOAuth({redirectTo: origin + "/auth/callback?consentSource=…&next=…"})` (`SupabaseAuthContext.tsx:337-349`).

### `/profile/complete` — `pages/profile-complete.tsx` (`App.tsx:301-308`, RequireRole student/guardian/admin)
- Reached by RequireRole onboarding redirect, login effect, or OAuth callback.
- Fetches `/api/profile` (101-110). Guards: unauth → `/login` (215-217); admin → `/dashboard` (219-221); `requiredProfileComplete && profileCompletedAt` → role default (223-225).
- User **selects role student|guardian** here (88, 330-340); student requires DOB; under-13 requires guardian email (202-210).
- Success: if `guardianConsentRequired` → toast and **stay** (164-171); else `navigate(resolvePostCompletionPath(role))` = `/guardian` or `/dashboard` (79-81, 177). **The `next` return path is not carried through onboarding** — a deep-linked destination is lost for first-time users.
- Server writes `profile_completed_at = null` when guardian consent is required (`server/routes/profile-routes.ts:419-421`); `requiredProfileComplete = !!profile_completed_at` and `guardianConsentRequired = is_under_13 && !guardian_consent` (`profile-routes.ts:176-179`).

### `/auth/callback` — server
- `vercel.json:45-48` rewrites `^/auth/callback$` → `/api/index` (`api/index.ts` = `dist/vercel-api.cjs`, built from `server/index.ts` by `package.json:19`).
- Express mount: `app.use("/auth", googleOAuthCallbackLimiter, oauthCallbackRoutes)` (`server/index.ts:403`) → `router.get("/callback", nativeOAuthCallbackHandler)` (`server/routes/oauth-callback-routes.ts:422`); alias `app.get("/api/auth/callback", …)` (`server/index.ts:405-409`).
- Handler `nativeOAuthCallbackHandler` (`oauth-callback-routes.ts:142`): `safeNext = sanitizeReturnPath(req.query.next)` (71-73, 159). Failures → `/login?error=<code>` (168, 189, 221, 336, 381, 402, 418). Success decision (342-356): `!profile.profile_completed_at || (is_under_13 && !guardian_consent)` → `/profile/complete`; else `safeNext`; else guardian → `/guardian`; else `/dashboard`. Redirect `${siteUrl}${redirectPath}` (410).
- Note the server's onboarding predicate (342-344) and the client's (`login.tsx:37-40`, `RequireRole.tsx:127-130`) are phrased differently; both reduce to the same condition given `profile-routes.ts:176-179`, **assuming** `/api/profile` is the only source of those flags (verified for the client: `SupabaseAuthContext.tsx:120-122`).

---

## 3. PUBLIC pages (one row each)

| Route (App.tsx line) | File | Shell | Data fetching | Inbound links (non-test, file:line) |
|---|---|---|---|---|
| `/digital-sat` (123) | `pages/digital-sat.tsx` | PublicLayout (55) | none (static) | PublicNavBar.tsx:11; Footer.tsx:9; blog.tsx:92; blog-post.tsx:191; breadcrumbs digital-sat-math.tsx:91, digital-sat-reading-writing.tsx:89 |
| `/digital-sat/math` (124) | `pages/digital-sat-math.tsx` | PublicLayout (86) | none | Footer.tsx:10; digital-sat.tsx:69; digital-sat-reading-writing.tsx:243; blog-post.tsx:197 |
| `/digital-sat/reading-writing` (125-128) | `pages/digital-sat-reading-writing.tsx` | PublicLayout (84) | none | Footer.tsx:11; digital-sat.tsx:82; digital-sat-math.tsx:237; blog-post.tsx:203 |
| `/blog` (129) | `pages/blog.tsx` | PublicLayout (18) | static `BLOG_POSTS` via `@/lib/blog` (2) ← `shared/content/blog.ts` | PublicNavBar.tsx:12; Footer.tsx:13; blog-post.tsx:59, 82, 94 |
| `/blog/:slug` (130) | `pages/blog-post.tsx` | PublicLayout (56, 77) | `useRoute("/blog/:slug")` + `getPostBySlug` (50-52); unknown slug → in-layout "Post not found" + link `/blog` (54-63), **not** the NotFound page | blog.tsx:53, 72; blog-post.tsx:164; digital-sat-math.tsx:182 (`/blog/common-sat-math-algebra-mistakes`, exists at `shared/content/blog.ts:165`) |
| `/trust` (133) | `pages/trust.tsx` | **no header**; Footer only (407); `max-w-5xl` (36) | none | Footer.tsx:15; trust-evidence.tsx:127 |
| `/trust/evidence` (134) | `pages/trust-evidence.tsx` | **no header**; Footer only (183); `max-w-5xl` (24) | none | trust.tsx:131 |
| `/legal` (143) | `pages/legal.tsx` | **no header**; Footer (247); `max-w-5xl` (70) | `useQuery(["legal-index"])` → `loadLegalSlugs` + `loadLegalIndex` fetching static `/legal/index.json` and manifests (50-54; `lib/legal-content.ts:83, 271-286`) | Footer.tsx:16; trust.tsx:183; trust-evidence.tsx:149; legal-doc.tsx:134 |
| `/legal/:slug` (144) | `pages/legal-doc.tsx` | own sticky header (130-160) + Footer (166); `max-w-7xl` | `useQuery(["legal-document", slug])` → `loadLegalDocument` (78-83); not-found → `<NotFound/>` (197) | Footer.tsx:17-18; trust.tsx:212-330; legal.tsx:152, 208; SupabaseAuthForm.tsx:400-496; GuardianConnectRequired.tsx:82; ReconsentModal.tsx:183; guardian-dashboard.tsx:579. Slugs present under `legal/`: billing-terms, community-guidelines, honor-code, parent-guardian-terms, privacy-policy, refund-policy, student-terms, subscription-auto-renewal-notice, trust-and-safety (all have a `current` version). |
| `/signup` (120) | redirect → `/login` (replace) | — | — | home.tsx:709; digital-sat.tsx:186; digital-sat-math.tsx:258; digital-sat-reading-writing.tsx:263 |
| `/privacy` (147-149) | redirect → `/legal/privacy-policy` | — | — | none in client (grep §7) |
| `/terms` (150-152) | redirect → `/legal/student-terms` | — | — | none in client |
| `/practice/math` (187-189) | redirect → `/practice` | — | — | browse-topics.tsx:336 |
| `/practice/reading-writing` (190-192) | redirect → `/practice` | — | — | none in client |
| `/practice/random` (193-195) | redirect → `/practice` | — | — | browse-topics.tsx:337; progress-sidebar.tsx:159 (dead file) |
| `/math-practice` (253-255) | redirect → `/practice` | — | — | none in client |
| `/reading-writing-practice` (256-258) | redirect → `/practice` | — | — | none in client |

Also public: `/account/recover` (318, `pages/account-recover.tsx`, token from query 21, POST `/api/account/recover-deletion` 29; inbound only from the deletion email `server/lib/notifications/templates/deletion-scheduled.ts:43`). `/tutor` (135-142) is RequireRole student/admin in the SPA but is linked from public pages `trust.tsx:159` and `trust-evidence.tsx:170` → a signed-out visitor is bounced to bare `/login` (`/tutor` is not allow-listed).

Deployment observation: `server/seo-content.ts:35` `PUBLIC_SSR_ROUTES` (incl. `/tutor` at 796) is registered in Express (`server/index.ts:781-785`), but on Vercel only `/api/*` and `/auth/callback` reach the function (`vercel.json:40-56`); everything else is `filesystem` then `/index.html`. Whether SSR metadata is served in production: **unverified** (depends on the deployment target; `build:vercel` does no prerender, `package.json:19`).

---

## 4. OUT OF SCOPE (guardian/admin) — list only

| Path | App.tsx lines | Guard | Page file |
|---|---|---|---|
| `/students/:studentId/calendar` | 224-231 | guardian, admin | `pages/guardian-student-calendar.tsx` |
| `/students/:studentId/tests` | 237-244 | guardian, admin | `features/exam/pages/GuardianExamResultsPage.tsx` |
| `/students/:studentId/tests/:sessionId` | 245-252 | guardian, admin | `features/exam/pages/GuardianExamResultsPage.tsx` |
| `/admin/crisis-review/:id` | 329-336 | admin | `pages/admin/CrisisReviewDetail.tsx` |
| `/admin/crisis-review` | 337-344 | admin | `pages/admin/CrisisReviewList.tsx` |
| `/guardian` | 347-354 | guardian, admin | `pages/guardian-dashboard.tsx` |

(`/notifications`, `/profile`, `/profile/complete`, `/update-password` are shared by all roles; `notifications.tsx:55-61` picks GuardianShell vs AppShell.)

---

## 5. FEATURE FLAGS

Command (from `client/src`):
```
grep -rnE "import\.meta\.env|VITE_|FEATURE_|isEnabled|useFeature|featureFlag|feature_flag|RuntimeContractDisabledCard|FeatureFlag|flags?\b" --include=*.ts --include=*.tsx . | grep -vE "\.test\.tsx?:" | grep -vE "^\./components/ui/"
```
`import.meta.env` appears only for `VITE_DESMOS_API_KEY` and `VITE_SUPABASE_URL/ANON_KEY`. No `useFeature`, `isEnabled`, `FEATURE_` identifiers exist in client/src (all remaining hits are comments). **No flag gates any route in `App.tsx` or any nav link.** Mechanisms that gate UI:

| Flag | Defined | Default | Gates | Evidence |
|---|---|---|---|---|
| `ACCOUNT_DELETION_LIFECYCLE_V2` (server env) → `/api/profile` `featureFlags.accountDeletionLifecycleV2` → `user.accountDeletionLifecycleV2` | `server/lib/account-deletion-execute.ts:162-164` (`=== "true"`); emitted `server/routes/profile-routes.ts:187, 206-208`; mapped `client/src/contexts/SupabaseAuthContext.tsx:124-125` (`?? false`) | **off** (unset ≠ "true") | Delete-account controls in `/profile` (`DeleteAccountCard.tsx:66-76` shows "controls are intentionally withheld" when off; mounted `UserProfile.tsx:671`). Indirectly `pendingDeletion`/DeletionGate (`profile-routes.ts:189`) and server middleware (`server/middleware/supabase-auth.ts:324, 662`). | as cited |
| Runtime-contract disable (`PRACTICE_/FULL_LENGTH_/REVIEW_RUNTIME_DISABLED_BY_CONTRACT`, 503) → `RuntimeContractDisabledCard` | `client/src/lib/runtime-contract-disable.ts:3-7, 39-53`; card `components/RuntimeContractDisabledCard.tsx`; rendered `CanonicalPracticePage.tsx:451-455` | n/a | Replaces the practice/review session body with "Temporarily Disabled". **No emitter exists**: `grep -rln "DISABLED_BY_CONTRACT" --include=*.ts --include=*.tsx --include=*.sql .` → only `tests/ci/forbidden-routes.ci.test.ts`, `client/src/hooks/useCanonicalPractice.contract-disabled.test.tsx`, `client/src/lib/runtime-contract-disable.ts` (exit 0). Client branch is unreachable against current server code. | as cited |
| Engine `features` (static config) | `client/src/lib/engine-config.ts:119-128`; practice `{diagnostic:true, calculator:true, tutor:false}` (194); review `{diagnostic:false, calculator:true, tutor:true}` (251) | fixed at build | LISA toggle in session (`CanonicalPracticePage.tsx:376, 433-447`), diagnostic mode (166), calculator | as cited |
| `enabled_block_types` (server calendar response) | `client/src/features/calendar/lib/view-model.ts:205`; spec note `features/calendar/api/launch.ts:3` (`["practice"]`) | server-provided | Which block types CreateBlockSheet offers (`CreateBlockSheet.tsx:156`) | as cited |
| `VITE_DESMOS_API_KEY` | `client/src/components/math/DesmosCalculator.tsx:67` | build env | Calculator panel shows "unavailable" when missing (71, 277) | as cited |
| Admin-only menu item | `HeaderUserMenu.tsx:126-134` (`isAdmin`) | role | "Crisis review" link | not a flag, role gate |

Other server env toggles not gating UI routes: `ERROR_MONITOR_ENABLED` (`server/logger.ts:679`), `ADMIN_PROVISION_ENABLE` (`server/routes/supabase-auth-routes.ts:332`).

---

## 6. ORPHAN PAGES / COMPONENTS

### 6.1 Pages
Command (from `client/src`):
```
for f in $(ls pages/*.tsx pages/admin/*.tsx features/*/pages/*.tsx | grep -v '\.test\.'); do m=${f%.tsx}; base=$(basename $m);
  hits=$(grep -rnE "(import\(|from )['\"](@/$m|\.{1,2}/([^'\"]*/)?$base)['\"]" . --include=*.ts --include=*.tsx | grep -vE '\.test\.tsx?:');
  echo "$f -> ${hits:-NONE}"; done
```
Output: **every** page file has an importer — 0 × `NONE`. All are imported by `App.tsx` (lines 18-98). Extra importers: `ExamReportPage` also by `GuardianExamResultsPage.tsx:49`; `ExamSessionPage`, `resume-practice`, `resume-review` also prefetched by `features/calendar/api/launch.ts:100-104`; `not-found` also by `legal-doc.tsx:59`.
**No orphan pages.** Every route-registered page file exists; no page file renders an unregistered route (the only internal `useRoute` is `blog-post.tsx:50` `"/blog/:slug"`, registered at `App.tsx:130`).

### 6.2 Components/modules with no non-test importer
Method: Python resolver over all non-test `.ts/.tsx` in `client/src`, resolving `@/…` and relative specifiers (static, `import()` and side-effect imports) — script at `scratchpad/orphans.py`. Output (excluding `components/ui/*`):
```
components/DemoDashboardPreview.tsx
components/FeatureHighlights.tsx
components/NavBar.tsx
components/SEO.tsx
components/StatCard.tsx
components/common/SafeBoundary.tsx
components/common/error-boundary.tsx
components/common/loading-skeleton.tsx
components/common/section-header.tsx
components/common/tag.tsx
components/dev/RouteTracer.tsx
components/navigation.tsx
components/progress-sidebar.tsx
components/progress/ProgressRing.tsx
components/progress/ScoreProjectionCard.tsx
components/progress/TripleProgressRing.tsx
components/test-options.tsx
features/exam/test-fixtures/report-fixtures.ts
hooks/use-shortcuts.ts
hooks/useLockdown.ts
lib/authLogger.ts
lib/legal.ts
main.tsx            <- false positive: entry point, client/index.html:45
test/setupTests.ts  <- test infra
```
Plus 21 unused `components/ui/*` shadcn primitives (accordion, aspect-ratio, breadcrumb, calendar, carousel, chart, collapsible, command, context-menu, drawer, form, hover-card, input-otp, menubar, navigation-menu, pagination, radio-group, sidebar, slider, switch, toggle-group).
Spot-check grep for several: `grep -rnE "components/SEO|/SEO['\"]|test-options|RouteTracer|DemoDashboardPreview|FeatureHighlights|ScoreProjectionCard|useLockdown|SafeBoundary|common/error-boundary" client apps packages --include=*.ts --include=*.tsx --include=*.html` → only self-definitions and `ScoreProjectionCard.test.tsx` (exit 0). Navigation-bearing orphans: `test-options.tsx` (`/practice` 44, `/chat` 79), `ScoreProjectionCard.tsx` (`/upgrade` 36), plus NavBar/navigation/progress-sidebar. Note `trust.tsx:26-28` comment says content lives in `client/src/lib/legal.ts`, which is itself an orphan.

---

## 7. NAVIGATION TARGET MAP (client/src, non-test, excl. components/ui)

Command (from `client/src`), output saved to `scratchpad/navgrep.txt` (268 lines, exit 0):
```
grep -rnE "href=|\bto=|setLocation\(|navigate\(|window\.location|location\.(assign|replace|href)|Redirect |href:|path: ['\"]/|Href: ['\"]|Href=|backLink|completionHref|backHref" --include=*.ts --include=*.tsx . | grep -vE "\.test\.tsx?:|^\./components/ui/|test-fixtures"
```
Dynamic targets resolved with:
```
grep -rnE "PRACTICE_HANDOFF_HREF\s*=|function resolveCtaDestination|roleDestination\s*=|href: \"/" --include=*.ts --include=*.tsx .
grep -rnE 'function (sessionPath|modulePath|reportPath|pathForPosition)' --include=*.ts --include=*.tsx .
grep -rn "function resumeHref" -A3 server --include=*.ts
grep -rnE "href: ['\"\`A-Z]|_HREF\s*=" server/lib/notifications/templates/*.ts
```
Resolved helpers: `sessionPath`=`/tests/:id`, `modulePath`=`/tests/:id/:section/:module`, `reportPath`=`/tests/:id/report` (`features/exam/lib/exam-position.ts:50-65`); `resolveCtaDestination` = guardian ? `/guardian` : `/upgrade` (`lib/billing-cta.ts:38-42`); `PRACTICE_HANDOFF_HREF`=`/practice` (`components/tutor/TutorThreadParts.tsx:432`); calendar launch `response.next` = `/practice/session/:id` | `/review/session/:id` | `/tests/:id` (`server/services/calendar/adapters/practice.ts:226-227`, `review.ts:250-251`, `full-length.ts:252-253`); notification `item.href` = `/calendar` (`full-length.ts:83`), `/profile?tab=settings`, `/guardian` (`guardian-linked.ts:33,39`, `guardian-unlinked.ts:39,46`); `resume_action.url` is always `null` today (`server/services/exam-report-service.ts:328`).

`[dead]` = file has no importer (§6.2).

| Target | Source file:line | Component |
|---|---|---|
| `/` | components/layout/PublicNavBar.tsx:10, 19 | PublicNavBar |
| `/` | components/layout/Footer.tsx:28 | Footer |
| `/` | pages/blog.tsx:21; digital-sat.tsx:58; digital-sat-math.tsx:90; digital-sat-reading-writing.tsx:88; blog-post.tsx:81 | Breadcrumb items (raw `<a>`) |
| `/` | components/NavBar.tsx:23 (sign-out) | NavBar [dead] |
| `/login` | components/layout/PublicNavBar.tsx:53, 59 | PublicNavBar |
| `/login` | components/layout/HeaderUserMenu.tsx:48 (post sign-out) | useHeaderSignOut |
| `/login` or `/login?next=…` | components/auth/RequireRole.tsx:88 | RequireRole (unauth) |
| `/login` | pages/home.tsx:90 (post sign-out), 226, 633, 833 | HomePage |
| `/login` | pages/UserProfile.tsx:151 | UserProfile |
| `/login` | pages/account-recover.tsx:70 | AccountRecover |
| `/login` | pages/profile-complete.tsx:216, 261 | ProfileComplete |
| `/login` | pages/guardian-dashboard.tsx:336 | GuardianDashboard |
| `/login` | App.tsx:120 (from /signup) | Router |
| `/login` | components/navigation.tsx:28, 191; components/NavBar.tsx:116 | Navigation/NavBar [dead] |
| `/signup` | pages/home.tsx:709; digital-sat.tsx:186; digital-sat-math.tsx:258; digital-sat-reading-writing.tsx:263 | public pages |
| `/dashboard` | components/layout/app-shell.tsx:44, 159 | AppShell navItems / logo |
| `/dashboard` | components/layout/PublicNavBar.tsx:45 | PublicNavBar (authed) |
| `/dashboard` | components/auth/RequireRole.tsx:105, 107 | RequireRole (wrong role) |
| `/dashboard` | pages/login.tsx:42 (role default) | Login |
| `/dashboard` | pages/home.tsx:207, 814 | HomePage |
| `/dashboard` | pages/calendar.tsx:146, 196 → features/calendar/components/Chrome.tsx:316 | Calendar back link |
| `/dashboard` | pages/upgrade.tsx:117 | UpgradePage |
| `/dashboard` | pages/update-password.tsx:74 (non-guardian) | UpdatePassword |
| `/dashboard` | pages/profile-complete.tsx:80, 220 | ProfileComplete |
| `/dashboard` | pages/guardian-dashboard.tsx:340 | GuardianDashboard (non-guardian) |
| `/dashboard` | pages/resume-practice.tsx:160 (diagnostic completionHref) | ResumePractice |
| `/dashboard` | features/exam/pages/ExamReportPage.tsx:92 | ExamReportPage |
| `/dashboard` | components/account-deletion/PendingDeletionScreen.tsx:49, 55 | PendingDeletionScreen |
| `/dashboard` | components/navigation.tsx:59, 89; components/NavBar.tsx:35 | [dead] |
| `/calendar` | components/layout/app-shell.tsx:45 | AppShell navItems |
| `/calendar` | (server) notifications full-length.ts:83 → NotificationBell.tsx:98 / notifications.tsx:132 | notification item |
| `/practice` | components/layout/app-shell.tsx:46 | AppShell navItems |
| `/practice` | pages/home.tsx:189, 805 | HomePage CTAs |
| `/practice` | pages/lyceon-dashboard.tsx:383, 393 | LyceonDashboard |
| `/practice` | pages/browse-topics.tsx:124 | BrowseTopics |
| `/practice` | pages/mastery.tsx:148, 297 | MasteryPage |
| `/practice` | pages/review.tsx:187 | ReviewPage (empty) |
| `/practice` | pages/blog-post.tsx:139 | BlogPost CTA |
| `/practice` | pages/resume-practice.tsx:105, 134, 180, 195 | ResumePractice |
| `/practice` | components/layout/PracticeShell.tsx:34 default; lib/engine-config.ts:191-192 | PracticeShell / CanonicalPracticePage (practice engine) |
| `/practice` | components/tutor/TutorThreadParts.tsx:432→448 | tutor practice hand-off |
| `/practice` | App.tsx:188, 191, 194, 254, 257 | legacy redirects |
| `/practice` | components/navigation.tsx:96; NavBar.tsx:33; progress-sidebar.tsx:136; test-options.tsx:44 | [dead] |
| `/practice/topics` | pages/practice.tsx:793 | Practice |
| `/practice/math` | pages/browse-topics.tsx:336 | BrowseTopics (redirects to /practice) |
| `/practice/random` | pages/browse-topics.tsx:337; progress-sidebar.tsx:159 [dead] | redirects to /practice |
| `/practice/session/:id` | pages/practice.tsx:246, 410 | Practice |
| `/practice/session/:id` | pages/lyceon-dashboard.tsx:148 | LyceonDashboard |
| `/practice/session/:id` | components/diagnostic/DiagnosticCTACard.tsx:39; DiagnosticPromptModal.tsx:76 | diagnostic CTA |
| `/practice/session/:id` | features/calendar/api/launch.ts:166 (server `next`) | calendar launch |
| `/tests` | components/layout/app-shell.tsx:47 | AppShell navItems |
| `/tests` | features/exam/components/ExamStatus.tsx:34 | ExamStatus |
| `/tests/:id` | features/exam/pages/TestsHomePage.tsx:126, 164 | TestsHomePage |
| `/tests/:id` | features/exam/pages/ExamReportPage.tsx:334 | ExamReportPage |
| `/tests/:id` | features/exam/pages/ExamModulePage.tsx:230 | ExamModulePage |
| `/tests/:id` (or module/report per position) | ExamSessionPage.tsx:58; ExamModulePage.tsx:116 (`pathForPosition`) | exam redirects |
| `/tests/:id/:section/:module` | TestsHomePage.tsx:160; ExamSessionPage.tsx:91; ExamModulePage.tsx:242 | exam flow |
| `/tests/:id/report` | TestsHomePage.tsx:132; ExamModulePage.tsx:251 | exam flow |
| `/tests/:id` | features/calendar/api/launch.ts:166 (server `next`) | calendar launch |
| `/review` | components/layout/app-shell.tsx:48 | AppShell navItems |
| `/review` | pages/lyceon-dashboard.tsx:408 | LyceonDashboard |
| `/review` | pages/practice.tsx:299 (secondaryActions) → 920 | Practice |
| `/review` | pages/resume-review.tsx:106, 133, 149; lib/engine-config.ts:248-249 | ResumeReview / review engine |
| `/review` | components/navigation.tsx:103; NavBar.tsx:34; progress-sidebar.tsx:147 | [dead] |
| `/review/session/:id` | pages/review.tsx:170, 308 | ReviewPage |
| `/review/session/:id` | features/calendar/api/launch.ts:166 | calendar launch |
| `/chat` | components/layout/app-shell.tsx:49 | AppShell navItems ("Lisa") |
| `/chat` | pages/lyceon-dashboard.tsx:519 | LyceonDashboard |
| `/chat`, `/chat?conversationId=` | pages/chat.tsx:334, 387; pages/tutor.tsx:50 | Chat / Tutor |
| `/chat` | components/navigation.tsx:110; test-options.tsx:79 | [dead] |
| `/tutor` | pages/trust.tsx:159; pages/trust-evidence.tsx:170 | public Trust pages |
| `/mastery` | pages/lyceon-dashboard.tsx:436; pages/practice.tsx:305→920 | Dashboard / Practice |
| `/upgrade` | lib/billing-cta.ts:41, 124 → PremiumUpgradePrompt.tsx:190; lyceon-dashboard.tsx:184; UserProfile.tsx:766 | billing CTA (student) |
| `/upgrade` | pages/calendar.tsx:165 | Calendar 402 branch |
| `/upgrade` | components/progress/ScoreProjectionCard.tsx:36 | [dead] |
| `/profile` | components/layout/HeaderUserMenu.tsx:113; app-shell.tsx:205 | user menu / mobile sheet |
| `/profile` | components/account-deletion/DeleteAccountCard.tsx:57 | DeleteAccountCard |
| `/profile` | navigation.tsx:171; NavBar.tsx:88, 96 | [dead] |
| `/profile?tab=settings` | server notification templates guardian-linked.ts:33, guardian-unlinked.ts:39 (tab read at UserProfile.tsx:177-185) | notification item |
| `/profile/complete` | RequireRole.tsx:132; login.tsx:56 | onboarding gate |
| `/notifications` | components/notifications/NotificationBell.tsx:193 | NotificationBell |
| `/guardian` | components/layout/GuardianShell.tsx:60 | GuardianShell logo |
| `/guardian` | RequireRole.tsx:102; login.tsx:42; update-password.tsx:74; profile-complete.tsx:80; billing-cta.ts:41,138,145,152; GuardianExamResultsPage.tsx:89; guardian-student-calendar.tsx:99; server notif guardian-linked.ts:39 | various |
| `/students/:id/calendar`, `/students/:id/tests[/:sid]` | guardian-dashboard.tsx:775, 792; GuardianExamResultsPage.tsx:77, 185 | guardian (out of scope) |
| `/admin/crisis-review[/:id]` | HeaderUserMenu.tsx:128; CrisisReviewList.tsx:263; CrisisReviewDetail.tsx:196 | admin (out of scope) |
| `/digital-sat` | PublicNavBar.tsx:11; Footer.tsx:9; blog.tsx:92; blog-post.tsx:191; digital-sat-math.tsx:91; digital-sat-reading-writing.tsx:89 | public |
| `/digital-sat/math` | Footer.tsx:10; digital-sat.tsx:69; digital-sat-reading-writing.tsx:243; blog-post.tsx:197 | public |
| `/digital-sat/reading-writing` | Footer.tsx:11; digital-sat.tsx:82; digital-sat-math.tsx:237; blog-post.tsx:203 | public |
| `/blog` | PublicNavBar.tsx:12; Footer.tsx:13; blog-post.tsx:59, 82, 94 | public |
| `/blog/:slug` | blog.tsx:53, 72; blog-post.tsx:164; digital-sat-math.tsx:182 | public |
| `/trust` | Footer.tsx:15; trust-evidence.tsx:127 | public |
| `/trust/evidence` | trust.tsx:131 | public |
| `/legal` | Footer.tsx:16; trust.tsx:183; trust-evidence.tsx:149; legal-doc.tsx:134 | public |
| `/legal/privacy-policy` | Footer.tsx:17; trust.tsx:238; SupabaseAuthForm.tsx:407, 496; App.tsx:148 | public / auth form |
| `/legal/student-terms` | Footer.tsx:18; trust.tsx:266; SupabaseAuthForm.tsx:400, 489; GuardianConnectRequired.tsx:82; App.tsx:151 | public / auth form |
| `/legal/trust-and-safety` | legal.tsx:152; trust.tsx:212 | public |
| `/legal/honor-code` | trust.tsx:302 | public |
| `/legal/community-guidelines` | trust.tsx:330 | public |
| `/legal/parent-guardian-terms` | guardian-dashboard.tsx:579 | guardian |
| `/legal/:slug` (dynamic) | legal.tsx:208; ReconsentModal.tsx:183 | Legal hub / reconsent |
| `/auth/callback?…` | contexts/SupabaseAuthContext.tsx:343 | Google OAuth redirectTo |
| `#main` | components/common/skip-link.tsx:4 | SkipLink |
| external (Stripe checkout/portal) | lib/billing-client.ts:145, 162 | billing |
| `mailto:` / `tel:` / `sms:` | trust.tsx:364, 394; legal.tsx:235; account-recover.tsx:88,107,126; UserProfile.tsx:530; TutorThreadParts.tsx:244, 258 | contact links |
| reload | App.tsx:392; browse-topics.tsx:149; UserProfile.tsx:254,703; lyceon-dashboard.tsx:208; resume-practice.tsx:98; resume-review.tsx:99 | retry buttons |
| `payload.resume_action.url` | ExamReportPage.tsx:315 | always null server-side (`exam-report-service.ts:328`) |

Every internal target above resolves to a route registered in `App.tsx` (exact, parametrised, or a redirect route). No target points at an unregistered path.

Full-reload navigations (bypass the SPA router): `PracticeShell.tsx:57`, `CanonicalPracticePage.tsx:307, 311, 474, 490`, `resume-practice.tsx:105,134,180`, `resume-review.tsx:106,133`, `DeleteAccountCard.tsx:57`, `PendingDeletionScreen.tsx:49,55`, and every `Breadcrumb` item (`primitives.tsx:106`).

---

## Invariant/standards observations surfaced in passing (not fixed — read-only)
- `any`: `RequireRole.tsx:30` (`[key: string]: any`), `App.tsx:376` (`errorInfo: any`), `lib/runtime-contract-disable.ts:42` (`payload: any`), `server/routes/supabase-auth-routes.ts:89` (`(req.body as any)`). Coding Standards §3.2 / CLAUDE.md "No escape hatches".
- `console.*` in production code: `App.tsx:377`, `home.tsx:92, 126`, `SupabaseAuthContext.tsx` (e.g. 99, 141, 146, 185, 199). §16.
- ErrorBoundary renders raw `error.message` to the user (`App.tsx:389`).
