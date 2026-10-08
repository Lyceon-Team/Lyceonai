# Pass 3: reachability (re-run on `d8d8a3c1`)

Paths are relative to `client/src/` unless they start with `server/`, `packages/`, `docs/` or `vercel.json`.

## 1. Entry roots and navigation

**Entry roots:**
- `/`, the public landing;
- `/login` (`components/layout/PublicNavBar.tsx:53,59`; `components/marketing/HomeNav.tsx:68,74`);
- the post-auth student home `/dashboard`: `pages/login.tsx:73-80` → `postAuthDestination` → `packages/shared/src/return-path.ts:195` (`role === "guardian" ? "/guardian" : "/dashboard"`).

**Student navigation in the App shell** (`components/layout/app-shell.tsx`):
- **Rail** (`RAIL_ITEMS`, `:147-190`): Home `/dashboard` (`:151`), Practice `/practice` (`:158`), Review `/review` (`:165`), Full-Length `/tests` (`:172`), Calendar `/calendar` (`:179`) and LISA `/chat` (`:186`). Then the bell (`:512`), Help `HELP_PATH` = `/help` (`:528`; `components/layout/LegalFooter.tsx:16`) and the avatar menu.
- **Phone tab bar** (`TAB_BAR_KEYS`, `:198-204`): Home, Review, Practice, Calendar, LISA.
- **Avatar menu** (`components/layout/HeaderUserMenu.tsx`): Settings → `/profile` (`:188`), Help (`app-shell.tsx:455-460`), Sign out; Crisis review for admins (`:205`).
- **Footer** (`LegalFooter.tsx:25`): "Help and FAQs" → `/help`.

## 2. Pages

The search for inbound references was a scratch script. For each target path, it listed every non-test, non-comment line under `client/src` that names the path as a string literal, excluding `App.tsx` and `lib/route-shells.ts`. The relevant output lines are cited below.

| Page | Class | Click path (inbound file:line) |
|---|---|---|
| `/dashboard` | LIVE (post-auth home) | sign-in (`return-path.ts:195`); rail Home (`app-shell.tsx:151`) |
| `/practice` | LIVE | rail and tab bar Practice (`app-shell.tsx:158`) |
| `/practice/topics` | **NO IN-APP PATH** | none. The search output for `/practice/topics` was empty. `git grep "/practice/topics" -- client/src ':!*.test.*'` finds only `App.tsx:327,330`, `lib/route-shells.ts:127,285` and comments (`FilterBar.tsx:39`, `filter-cascade.ts:15`, `usePracticeTopics.ts:3`, `query-freshness.ts:51`, `practice.tsx:36` "`/practice/topics` itself stays routed (OQ-3 is open)"). The original's inbound link (`practice.tsx:793`, "Browse topics") was removed by UI-51. **Held by OQ-3** |
| `/practice/session/:id` | LIVE | `/practice` → Start (`pages/practice.tsx:160`) or an open-session row (`:501`); Home (free) → Start diagnostic (`components/home/FreeHome.tsx:112`); Home (paid) → open-session row (`components/home/PaidHome.tsx:235`); calendar block launch → `navigate(response.next)` (`features/calendar/api/launch.ts:143`) |
| `/review` | LIVE | rail and tab bar Review (`app-shell.tsx:165`) |
| `/review/session/:id` | LIVE | `/review` → Start (`pages/review.tsx:204`) or a row (`:510`); Home (paid) → review start (`PaidHome.tsx:161`) or a row (`:244`); the review-cap notice (`components/review/ReviewCapNotice.tsx:82`); calendar launch (`launch.ts:143`) |
| `/tests` | LIVE | rail Full-Length (`app-shell.tsx:172`); Home card (`components/home/FullLengthCard.tsx:38`); exam status link (`features/exam/components/ExamStatus.tsx:68`) |
| `/tests/:id` | LIVE | `/tests` → Start or Resume (`features/exam/pages/TestsHomePage.tsx:507,550,554`); Home (paid) → in-progress test (`PaidHome.tsx:255`); report → "Resume full-length test" (`ExamReportPage.tsx:420`); calendar launch (`launch.ts:143`) |
| `/tests/:id/:section/:module` | LIVE | `/tests/:id` → Start module (`ExamSessionPage.tsx:125`); module 1 → module 2 (`ExamModulePage.tsx:309`) |
| `/tests/:id/report` | LIVE | `/tests` → View report (`TestsHomePage.tsx:467,750`); after the last module (`ExamModulePage.tsx:320`) |
| `/score-report` | SERVER LINK ONLY (depends on state) | No client literal. Reached from the post-exam notification's `href` (`server/lib/notifications/templates/post-exam.ts:42,68,126`), which the bell and `/notifications` follow (`components/notifications/NotificationBell.tsx:215`, `pages/notifications.tsx:144`: `if (item.href) navigate(item.href)`), and from the email link (`post-exam.ts:99,164`) |
| `/calendar` | LIVE | rail and tab bar Calendar (`app-shell.tsx:179`); Home (paid) → set up plan (`PaidHome.tsx:411`); Settings → Profile (`components/settings/ProfileSection.tsx:52`) |
| `/chat` | LIVE | rail and tab bar LISA (`app-shell.tsx:186`); `/tutor` redirects here (`App.tsx:283`) |
| `/mastery` | LIVE (not in the rail; lights Home, `app-shell.tsx:232`) | Home (paid) "See every skill" (`PaidHome.tsx:304`); `/practice` (`practice.tsx:304`); `/review` (`review.tsx:417`); `/tests` (`TestsHomePage.tsx:308`); domain rows (`components/mastery/domain-nodes.ts:58`) |
| `/upgrade` | LIVE (free student) | avatar → Settings → Billing → "See plans" (`components/settings/BillingSection.tsx:149` → `lib/billing-cta.ts:41`); `/practice` at quota → `PremiumUpgradePrompt` "View plans" (`billing-cta.ts:106`; rendered at `practice.tsx:430`) |
| `/profile` | LIVE | avatar menu Settings (`HeaderUserMenu.tsx:188`); `/settings` redirects here (`App.tsx:158-167`) |
| `/help` | LIVE | rail Help (`app-shell.tsx:528`); avatar menu Help (`app-shell.tsx:455-460`); footer (`LegalFooter.tsx:25`) |
| `/notifications` | LIVE | bell → "View all" (`NotificationBell.tsx:331`) |
| `/login` | LIVE (entry) | `PublicNavBar.tsx:53`; `HomeNav.tsx:68`; sign-out (`HeaderUserMenu.tsx:97`); `RequireRole` redirect |
| `/profile/complete` | REDIRECT ONLY | `RequireRole` (`components/auth/RequireRole.tsx:116`); `lib/api-error.ts:167`; login onboarding (`pages/login.tsx:73-80`) |
| `/guardian-required` | REDIRECT ONLY | `RequireRole.tsx:162`; `pages/login.tsx:75`; `pages/profile-complete.tsx:92`; `lib/api-error.ts:175` |
| `/update-password` | EMAIL ONLY | password-recovery link `RECOVERY_NEXT = "/update-password"` (`server/routes/oauth-callback-routes.ts:77`). Unchanged from the original |
| `/account/recover` | EMAIL ONLY | `server/lib/notifications/direct-sends.ts:106`. Unchanged from the original |
| 404, error screen, pending deletion | catch-all / state | `App.tsx:537`; `App.tsx:568-588`; `App.tsx:605-616` |

**Dead pages: none.** Every non-test file in `pages/`, `pages/admin/` and `features/*/pages/` is imported by at least one other module. A per-file `grep -rlE "pages/<name>"` returned at least 1 importer for each, and knip's unused-files list (§4) names no page.

**Flag-gated pages: none.** No route in `App.tsx` reads a feature flag.

## 3. Endpoints with no client caller

These are taken from pass2 §3 and §5.

| # | Endpoint | Handler | Held by | Search (non-test `client/src`) |
|---|---|---|---|---|
| 1 | `GET /api/students/:id/kpi/sections` | `server/routes/student-resources.ts:415` | **UI-06** ("`/api/students/:id/kpi/*` and `/projections/*` (guardian vertical decides)") | `git grep -nE 'kpi/\|kpiSections\|kpiDomains\|kpiOverall\|projectionsSnapshots\|projections/snapshots' -- client/src ':!*.test.*'` → only `features/guardian/GuardianDashboardTab.tsx:8` (a comment: "no kpi/overall call"). `studentResourceUrl` is called only with `masteryDomains`, `masterySkills`, `projectionsSections` and `calendar` (`lib/masteryApi.ts:77,95`, `lib/projectionApi.ts:141`, `features/calendar/api/client.ts:194`) |
| 2 | `GET …/kpi/domains` | `:422` | UI-06 | same |
| 3 | `GET …/kpi/overall` | `:437` | UI-06 | same |
| 4 | `GET …/projections/snapshots` | `:460` | UI-06 | same |
| 5 | `GET /api/practice/diagnostic/sessions/:id/weakest-skills` | `server/routes/diagnostic-routes.ts:469` | **UI-06** ("funnel audit") | `git grep -n weakest -- client/src ':!*.test.*'` → empty |
| 6 | `GET /healthz` | `server/index.ts:239` | **UI-06** ("may be used by monitors") | infrastructure; not a client route |
| 7 | `GET /api/health` | `server/index.ts:240` | **UI-06** | same |
| 8 | `GET /api/profile/background` | `server/routes/student-background-routes.ts:77` | **UI-S8** (open: "blocks the Settings Profile UI") and **OQ-37** (dream school hidden until UI-S8 closes); OQ-42 makes this route the only dream-school read | `git grep -nE "profile/background\|/api/reference" -- client/src ':!*.test.*'` → only comments, `components/settings/ProfileSection.tsx:9,22` ("About you" hidden until UI-S8 closes) |
| 9 | `PUT /api/profile/background` | `:88` | UI-S8, OQ-37 | same |
| 10 | `GET /api/reference/colleges` | `:162` | UI-S8 (the pickers belong to the held "About you" UI) | same |
| 11 | `GET /api/reference/high-schools` | `:167` | UI-S8 | same |
| 12 | `GET /api/progress/kpis` | `server/index.ts:436` | **not held: finding F-1** | `git grep -n "progress/kpis" -- client/src ':!*.test.*'` → `hooks/useProgressKpis.ts:11` (comment), `:26` (`PROGRESS_KPIS_QUERY_KEY`), `lib/query-freshness.ts:63` (comment), `pages/profile-complete.tsx:243` (comment). `git grep -n useProgressKpis -- client/src` → only the definition (`useProgressKpis.ts:28`) and its own test. knip: `client/src/hooks/useProgressKpis.ts: PROGRESS_KPIS_QUERY_KEY, useProgressKpis` (unused exports). The remaining code only invalidates the key (`ExamModulePage.tsx:319`, `useCanonicalPractice.ts:629` → `useProgressKpis.ts:40`), so no request is ever made. The hook's own header says so: "no page reads it today" (`useProgressKpis.ts:12-13`) |
| 13 | `GET /api/admin/crisis-review/sla-breaches` | `server/routes/admin-crisis-review.ts:304` | not student (admin); also unreferenced in the original (row 138) | `grep -rn "sla-breaches" client/src` → empty. Handoff H-1 |
| 14 | `GET /api/admin/db-health` | `server/index.ts:443` | not student (admin); original row 139 | `grep -rn "db-health" client/src` → empty. Handoff H-1 |
| 15 | `GET /api/questions/stats` | `server/index.ts:472` | not student. Admin-only by UI-07 ("`/api/questions/stats` becomes admin-only", register row UI-07) | `git grep -n "questions/stats" client/src` → only `pages/practice.test.tsx:825` (asserts the page does not call it). Handoff H-1 |
| 16 | `POST /api/internal/async/memory-refresh` | `server/routes/internal-memory-routes.ts:193` | **UI-06** ("`/api/internal/async/*` (LISA backlog)") | no producer in code or terraform (original Q10) |
| 17 | `POST /api/internal/async/pending-reconciliation` | `:300` | UI-06 | same |

**Endpoints whose only caller is unreachable or reached only by server links:**

| Endpoint | Only caller | Page class | Held by |
|---|---|---|---|
| `GET /api/practice/reference/questions` (`server/index.ts:529`) | `pages/browse-topics.tsx:88` | NO IN-APP PATH | OQ-3 (and register F-11: the route always returns an empty list) |
| `POST /api/account/recover-deletion` (`account-deletion-routes.ts:574`) | `pages/account-recover.tsx:38` | EMAIL ONLY | by design (Doc 01 §40.4); the original classed it UI-ORPHAN |
| `POST /api/auth/update-password` (`supabase-auth-routes.ts:557`) | `contexts/SupabaseAuthContext.tsx:566` ← `pages/update-password.tsx:67` | EMAIL ONLY | by design (recovery grant) |
| `GET`/`POST /api/score-report`, `POST /renewal` (`score-report-routes.ts:146,167,189`) | `pages/score-report.tsx:74,83,105` | SERVER LINK ONLY | by design (SCL-191: the prompt the server sent authorises the answer) |

**Count.** 17 mounted endpoints have no client caller:
- **student-callable: 12** (rows 1-12). 7 are held in UI-06, 4 are held by UI-S8 and OQ-37, and 1 is not held (F-1);
- **admin: 3** (rows 13-15);
- **internal: 2** (rows 16-17, held in UI-06).

The original found 30 (original §5b).

## 4. Client-side orphans (`pnpm run deadcode:production`)

knip printed `Unused files (31)`, `Unused exports (165)` and `Unused exported types (139)`, then exited 1. The 13 unused files under `client/src` are classified below. The server, shared and script files are outside this vertical; the guardian and SEO ones are listed for handoff.

| File | Importers outside tests (`grep -rln <name> client scripts tests`) | Class |
|---|---|---|
| `client/src/lib/tutor-error-classifier.ts` | only `client/src/lib/tutor-error-classifier.test.ts`. The last production importer was `pages/tutor.tsx`, deleted by `7343efd6` (UI-04) | **Student UI orphan: finding F-4** |
| `client/src/components/ui/tooltip.tsx` | none (the search output was empty) | **Shared-kit orphan: finding F-4** |
| `client/src/components/qotd/QotdSocialCard.tsx` | `scripts/qotd-social/generate.ts`, a build script that production mode does not count | not an orphan (SEO) |
| `client/src/prerender/entry-server.tsx`, `client/src/prerender/qotd-archive-source.ts` | `package.json` `build:prerender` (`vite build --ssr src/prerender/entry-server.tsx`), `scripts/build/prerender.mjs` | not an orphan. The knip entry list (`knip.json`) omits the prerender entry (SEO) |
| `client/src/styles/wcag-contrast.ts` | the three `*.contrast.test.ts` files in `client/src/styles/` | test support |
| `*.fixture.ts` (3), `features/exam/test-fixtures/report-fixtures.ts`, `features/guardian/test-harness.tsx`, `test-support/runner.harness.tsx`, `test/setupTests.ts` | tests only | test support (`report-fixtures.ts` is kept by UI-06's ruling) |

`pnpm run deadcode:student` (the student-UI scope, `scripts/ci/deadcode-student.scope.json`): `DEADCODE:STUDENT: PASS — 0 unused files, exports, types or duplicate exports in the student-UI scope`. Neither F-4 file is in that scope. `lib/` and `components/ui/` are not in its `include` list, and neither are `pages/score-report.tsx`, `pages/browse-topics.tsx` or `pages/guardian-required.tsx`.
