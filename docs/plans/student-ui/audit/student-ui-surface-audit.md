# Student UI Surface & Reachability Audit (read-only)

Paths are relative to `client/src/` unless they start with `server/`, `packages/`, `apps/`, `infra/`, `vercel.json` or `App.tsx`. `App.tsx` means `client/src/App.tsx`.
Supporting evidence (full per-page tables, grep commands and outputs): `pass1-A.md`, `pass1-B.md`, `pass1-C.md`, `pass2-A.md` and `pass2-B.md`, in the same folder as this report.

## Corrections to the brief's assumed structure

| Brief assumed | Actual | Evidence |
|---|---|---|
| Next.js `app/**/page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `pages/` router | Vite + React SPA using `wouter`. Every route is registered in one `<Switch>`. None of those Next.js files exist. | `App.tsx:2`, `App.tsx:114-358` |
| `middleware.ts` redirects and rewrites | There is no `middleware.ts`. Redirects are `<Redirect>` routes (`App.tsx:120,147-152,187-195,253-258`), client guards (`RequireRole`, `DeletionGate`) and `vercel.json` rewrites. | `vercel.json:40-56` |
| Layout / loading / error files | `ErrorBoundary` (`App.tsx:363-404`), `Suspense` → `PageLoader` (`App.tsx:100-113`), `DeletionGate` (`App.tsx:413-420`), `RequireRole` (`components/auth/RequireRole.tsx`), shells in `components/layout/` | as cited |
| `packages/ui` | Does not exist. The shared kit is shadcn at `client/src/components/ui/` (47 files). | `ls packages` → `shared` only |
| `app/api/**/route.ts` | Express: `server/index.ts` plus `server/routes/*.ts`, deployed as one Vercel function (`api/index.ts:1` → `dist/vercel-api.cjs`, `package.json:19`). `apps/api` mounts no routes. | pass2-A §C |
| Supabase RPCs from the client | There are none. The only direct client Supabase call is `supabase.auth.signInWithOAuth` (`contexts/SupabaseAuthContext.tsx:346`). | pass2-B, "Client-direct Supabase calls" |

---

## 1. Commit audited

`origin/main` @ **`d2902eec185eeff9d3a821f69cb0317e141e6069`**. That is "Merge pull request #941 from Lyceon-Team/claude/exam-frequency", 2026-09-28 19:05:26 -0500.

It was extracted with `git archive origin/main` into a scratch folder. The session's working branch `review` (0ed3eb1) was not audited and was not modified.

---

## 2. Out of scope (guardian / admin), listed only

| Path | App.tsx line | Client guard | Page file |
|---|---|---|---|
| `/guardian` | 347-354 | guardian, admin | `pages/guardian-dashboard.tsx` |
| `/students/:studentId/calendar` | 224-231 | guardian, admin | `pages/guardian-student-calendar.tsx` |
| `/students/:studentId/tests` | 237-244 | guardian, admin | `features/exam/pages/GuardianExamResultsPage.tsx` |
| `/students/:studentId/tests/:sessionId` | 245-252 | guardian, admin | `features/exam/pages/GuardianExamResultsPage.tsx` |
| `/admin/crisis-review` | 337-344 | admin | `pages/admin/CrisisReviewList.tsx` |
| `/admin/crisis-review/:id` | 329-336 | admin | `pages/admin/CrisisReviewDetail.tsx` |

Four routes are open to every role and **are** inventoried below: `/profile`, `/profile/complete`, `/update-password` and `/notifications`. `/notifications` switches to `GuardianShell` for guardians (`notifications.tsx:55-63`). `/profile` does not switch (`UserProfile.tsx:230,248,271,287`).

---

## 3. Page inventory (Pass 1)

**Global wrapper chain.** Every route below is wrapped in this chain, outermost first (`App.tsx:422-447`):
`ErrorBoundary` > `HelmetProvider` > `QueryClientProvider` > `SupabaseAuthProvider` > `UIProvider` (Toaster, `components/providers/ui-provider.tsx:14`) > `DeletionGate` > `Suspense(PageLoader)` > `Switch` > `Route`.

The table's "Layout chain" column lists only what comes **after** that chain. RG = `RequireRole allow=[student,admin]` (`components/auth/RequireRole.tsx`). RG* = `RequireRole allow=[student,guardian,admin]`.

**What `RequireRole` does:**
- While auth or profile is loading, it shows a spinner (`RequireRole.tsx:64-73`).
- An unauthenticated user is redirected to `/login?next=` (`:75-89`).
- A user with the wrong role is redirected to `/guardian` or `/dashboard` (`:100-108`).
- An incomplete profile is redirected to `/profile/complete` (`:110-133`).
- Otherwise it renders the page, with `ReconsentModal` overlaid when needed (`:135-176`).

**"ui:"** means imported from `components/ui` (shadcn). **"local"** means defined in the file or feature, not in `components/ui`.

### 3a. Authenticated student pages

| Route (App.tsx) | Page file | Layout chain | Nav / shell | Container | Typography | Components | States: loading / empty / error / entitlement-locked | Hardcoded styling | Data fetching (endpoints) |
|---|---|---|---|---|---|---|---|---|---|
| `/dashboard` (155-162) | `pages/lyceon-dashboard.tsx` | RG > `AppShell showFooter` (:188) | AppShell header (`components/layout/app-shell.tsx:81-240`) + Footer | `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl` (:189); `grid-cols-1 lg:grid-cols-12 gap-6` (:224,423) | H1 `text-3xl md:text-4xl font-semibold tracking-tight` (:191-196); H2 `text-2xl`/`text-3xl font-semibold` (:399,428); eyebrow `text-xs uppercase tracking-[0.18em]` (:229) | ui: Button, Card, Skeleton. Local: `ScoreSnapshotRow` with its own progress bar (:65-102); hand-built Link tiles (:392-420). Shared non-ui: PremiumUpgradePrompt, RecoveryNotice→AppNotice, DiagnosticCTAGate, DiagnosticPromptModal | Loading: Skeleton (:239-285). Empty: "No data" row (:74-83) and "Start practicing" fallback (:376-386). Error: kpis → RecoveryNotice (:203-210); `estimateError` is destructured at :121 and never read. Entitlement: `baseline_only` → "View Plans" (:339-355); PremiumUpgradePrompt (:454-459) | 0 hex in page; 10 arbitrary (`tracking-[0.18em]` ×5, `min-h-[190px]` :394,409, `text-[10px]` :488); inline `style` :97. Children hardcode `#0F2E48`/`#FFFAEF`: DiagnosticCTACard.tsx:45-83, DiagnosticPromptModal.tsx:94-122, AppNotice.tsx:34-35 | TanStack Query: `/api/progress/kpis` (:112-116, default queryFn); `/api/progress/projection` (:122-127 → lib/projectionApi.ts:122). `csrfFetch` POST `/api/practice/diagnostic/sessions` (hooks/useDiagnosticStart.ts:54). `/api/billing/status` (PremiumUpgradePrompt.tsx:155) |
| `/chat` (163-170) | `pages/chat.tsx` | RG > page root `div.flex.h-screen` (:461,503) | **No AppShell.** Page-local `<aside>` sidebar (:463,505), mobile Sheet (:470-484), local `<header>` (:469,512). No link to any other app page | full-bleed; sidebar `w-72`; messages `flex-1 p-4` (:560) | brand `text-lg font-semibold` (:169); H2 `text-2xl`/`text-xl font-semibold` (:239,430); H1 `text-base font-semibold` (:532) | ui: Button, Dialog, Sheet, Textarea (via TutorThreadParts). Local: raw `<button>`s (:172,195,247,254); TutorThreadParts parts; LisaUpgradeCard → PremiumUpgradePrompt | Loading: Loader2 on the conversation (:567-576); the session list has no loading state (shows "No sessions yet" :216-220). Empty: welcome (:424-455), NewSessionView (:230-264). Error: create → inline alert (:449-453); turn → FailedTurnNotice (:609-611); list and detail errors that are not entitlement errors are **not rendered**. Entitlement: `isLisaEntitlementDenial` → LisaUpgradeCard (:315-319,424,632) | 0 hex; 0 inline; 12 arbitrary (`min-h-[44px]`, `min-w-[44px]`, e.g. :127,176,476). Children: TutorThreadParts.tsx `max-w-[75%]` :139 | hooks/tutor-client.ts: GET `/api/tutor/conversations?surface=standalone&status=active`; GET `/api/tutor/conversations/:id`; POST `/api/tutor/conversations` (idempotency_key :354); POST `/api/tutor/conversations/:id/end`; POST `/api/tutor/messages`; POST `/api/tutor/conversations/:id/resume` |
| `/tutor` (135-142) | `pages/tutor.tsx` | RG > `div.mx-auto.flex.h-screen.max-w-2xl.flex-col.p-4` (:75) | **None** (no shell, no back link) | `max-w-2xl p-4` (:75) | H1 `text-2xl font-bold` (:77) | ui: Button, Card, useToast. Local: clickable Card rows with `onClick` (:113-128) | Loading: Loader2 (:92-96). Empty: Card "No conversations yet" (:104-108). Error: generic Card (:98-102); toast on create (:60-71). Entitlement: **not handled separately**; a tutor-entitlement denial shows the generic error card (:98-102) | none (0 hex, 0 arbitrary, 0 inline) | GET `/api/tutor/conversations?surface=standalone&status=active`; POST `/api/tutor/conversations` (no idempotency_key, :55-58) |
| `/practice` (171-178) | `pages/practice.tsx` | RG > `AppShell showFooter` (:313) | AppShell + Footer | `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl` (:314); `lg:grid-cols-12` (:332) | eyebrow `text-xs font-semibold uppercase tracking-[0.2em]` (:316); H1 `text-4xl font-bold tracking-tight` (:319-324) | ui: Button, Badge, Select, Skeleton, AlertDialog. Shared: PageCard (`components/common/page-card.tsx`), RecoveryNotice, PremiumUpgradePrompt, DiagnosticCTAGate. Local: raw chip `<button>` ×3 (:468,526,557); amber box (:674-678) | Loading: Skeletons (:515-520,720-726). Empty: per-section copy (:743,769,884,901). Error: RecoveryNotice ×4 showing raw `err.message` (:693-736,810-822); errors from `useActiveSessions` are not surfaced. Entitlement: `quotaExhausted` → PremiumUpgradePrompt (:689-691) | 0 hex; 0 inline; 12 arbitrary (`text-[10px]`, `text-[11px]`, `tracking-[0.2em]`, `max-w-[140px]`); `bg-primary-container` (:892) is not defined in `tailwind.config.ts:15-60` | `/api/questions/stats` (:144); `/api/practice/topics` (:164); `/api/progress/kpis` (:175); `/api/progress/projection` (:186); GET `/api/me/streak` (features/calendar/api/client.ts:45); GET `/api/practice/sessions/open` + POST `…/:id/terminate` (hooks/useActiveSessions.ts:42-49); POST `/api/practice/sessions` (hooks/usePractice.ts:255) |
| `/practice/topics` (179-186) | `pages/browse-topics.tsx` | RG > `AppShell` (no footer, :119) | AppShell; local "Back to Practice" button (:123-128) | `container mx-auto px-4 py-8 max-w-6xl` (:120) | H1 `text-3xl font-bold` (:130); raw `<label>` ×4 (:155,177,202,224); H3 `text-xl font-semibold` (:284) | ui: Button, Select, Skeleton, Card, Badge. Shared: PageCard, RecoveryNotice, MathRenderer | Loading: Skeletons (:139-144,264-271). Empty: PageCard "No Questions Found" (:280-292). Error: RecoveryNotice (:145-150,272-279). Entitlement: not handled | none | `/api/practice/topics` (:57-59); `/api/practice/reference/questions?…` (:72-93) |
| `/practice/session/:sessionId` (196-203) | `pages/resume-practice.tsx` → `components/practice/CanonicalPracticePage.tsx` | RG > the loading, error and closed branches are bare `div.flex.h-screen` with **no shell** (:77,92,121,172). The runner is wrapped in `PracticeShell` (CanonicalPracticePage.tsx:809-830) | `PracticeShell` header only (`components/layout/PracticeShell.tsx:49-107`); its back button does a full page reload (:58) | PracticeShell `container mx-auto px-4 py-6 max-w-7xl` (:109) or `max-w-[1600px]` (:41); runner `lg:grid-cols-12` (Canonical :672) | PracticeShell H1 `text-lg sm:text-xl font-bold` (:66); error H1 `text-2xl font-bold text-red-600` (:93,173) | ui: Card, Button, Badge, Resizable, Progress. Shared: QuestionRenderer, DesmosCalculator, MathReferenceSheet, RuntimeContractDisabledCard, RecoveryNotice, ScopedTutorPanel. Local: raw `<button>`s (:97,104,133,179); amber and red panels (Canonical :462-493) | Loading: Loader2 (:75-82; Canonical :456-460). Empty: "No questions available" (Canonical :501-512). Error: 404 / closed / unknown section (:84-187); CLIENT_INSTANCE_CONFLICT and SESSION_LIMIT (Canonical :461-493); generic RecoveryNotice (:494-500). Entitlement: **no 402 branch**; a failed `/next` becomes a raw status string (hooks/useCanonicalPractice.ts:489-490) | Page: 0. Canonical: `text-[10px]` ×4, `min-h-[600px]`, 5× inline `style` (:646,662,738,754,772). PracticeShell: `max-w-[1600px]`, `text-[10px]`, `text-[11px]` | `/api/practice/sessions/:id/state` (:68-73). Runner via `lib/engine-config.ts:147-156`: POST `/api/practice/sessions`, `…/:id/resume`; GET `…/:id/next`; POST `/api/practice/answer`, `…/:id/skip`, `…/:id/terminate`, `…/:id/calculator-state` |
| `/review` (276-283) | `pages/review.tsx` | RG > `AppShell showFooter` (:195) | AppShell + Footer | `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl` (:196); `lg:grid-cols-12` (:235) | eyebrow `text-xs uppercase tracking-widest` (:198); H1 `text-3xl sm:text-4xl font-semibold tracking-tight` (:201-206) | ui: Button, Badge, Skeleton, AlertDialog, Select. Shared: PageCard. Local: empty state (:176-192); raw chip and row `<button>`s (:428,461,538) | Loading: Skeletons (:347,520,584). Empty: "Nothing to review yet" (:176-192), "No past sessions…" (:522-525). Error: red PageCard + retry (:213-233); amber start-failure card (:326-337); errors from the open-sessions and topics queries are not surfaced. Entitlement: none (copy says "Review is free and unlimited", :621) | 0 hex / arbitrary / inline; palette literals red/amber (:216-379) | hooks/useReview.ts: GET `/api/review/pool?tz=` (:56); GET `/api/review/sessions/open` (:150); POST `/api/review/sessions/:id/terminate` (:159); POST `/api/review/sessions` (:237). `/api/practice/topics` (:134-136) |
| `/review/session/:sessionId` (284-291) | `pages/resume-review.tsx` → CanonicalPracticePage | RG > bare `div.flex.h-screen` for loading, error and closed (:72,90,120). The runner is wrapped in `PracticeShell` | PracticeShell (eyebrow "Review Runner", back → `/review`; lib/engine-config.ts:233,248-250) | same as the practice runner; `max-w-[1600px]` when LISA is visible (PracticeShell.tsx:41) | same as the practice runner; error H1 `text-2xl font-bold text-red-600` (:94) | Same as the practice runner, plus ScopedTutorPanel → LisaUpgradeCard (ScopedTutorPanel.tsx:159-160,210,303,396). Raw `<button>`s (:98,105,132) | Loading: Loader2 (:70-80). Error: (:82-140). Entitlement: the runner has none; the LISA panel shows LisaUpgradeCard | Page: `text-red-600` :94; ScopedTutorPanel `min-h-[480px]` :175 | `/api/review/sessions/:id/state` (:63-68). Runner via `engine-config.ts:208-217`: POST `/api/review/sessions`, `…/:id/resume`; GET `…/:id/next`; POST `/api/review/answer`, `…/:id/skip`, `…/:id/terminate`, `…/:id/calculator-state`. LISA: `/api/tutor/*` |
| `/mastery` (259-266) | `pages/mastery.tsx` | RG > `AppShell showFooter` (:190) | AppShell + Footer; local "Back" button → `window.history.back()` (:194-202) | `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl` (:191); `sm:grid-cols-2` (:217,254) | eyebrow `tracking-[0.2em]` (:203); H1 `text-4xl font-bold tracking-tight` (:207); H2 `text-xl font-semibold` (:94) | ui: Button, Card, Skeleton. Shared: LevelPill, PremiumUpgradePrompt, RecoveryNotice. Local: SkillPanel (:55-156) | Loading: Skeletons (:97-103,216-223). Empty: catalog-empty (:113-125), "Start practising" (:292-300). Error: RecoveryNotice (:105-111,232-236). Entitlement: domains query → PremiumUpgradePrompt (:225-230); a skills-query denial falls to the generic RecoveryNotice (:105-111) | 1 arbitrary (`tracking-[0.2em]` :203) | GET `/api/students/:id/mastery/domains` (:169-174 → lib/masteryApi.ts:73-76); GET `/api/students/:id/mastery/skills` (:176-181 → masteryApi.ts:91-94) |
| `/tests` (205) | `features/exam/pages/TestsHomePage.tsx` (wrapper `TestsHomeRoute` App.tsx:36-42) | RG > `AppShell` (:62) > `div.exam-root` (:63) | AppShell, no footer | `-mx-4 px-4 py-8 md:px-10` (:63); `mx-auto max-w-6xl` (:64); `md:grid-cols-3` (:83) | H1 `font-serif text-[32px] font-semibold` (:66); card H2 `font-serif text-[22px]` (:118); `font-serif` = Georgia (tokens.css:33) | **None from ui.** Local: `primaryButton` / `secondaryButton` class constants (:52-55), FormCard (:103-144), StartPanel (:146-234), raw radio `<input>` (:180-188) | Loading: `<p role=status>` (:71). Empty: "No full-length tests…" (:80). Error: generic `<p role=alert>` + Try again (:72-79). Entitlement: **not handled separately**; the server returns 403 (server/routes/exam-runtime-routes.ts:129-146) and the page shows the generic error | 47 arbitrary; 1 hex (`bg-[#EAE7E0]` :121); 0 inline | GET `/api/tests/forms` (:58 → features/exam/api/exam-api.ts:101-104); POST `/api/tests/sessions` (exam-api.ts:168-177); POST `…/sections/RW/modules/1/start` (exam-api.ts:179-188) |
| `/tests/:sessionId` (208) | `features/exam/pages/ExamSessionPage.tsx` | RG > local `Shell` (:68-78) | **No AppShell.** Local header with a non-link serif "Lyceon" and a mode label (:71-74) | card `max-w-lg p-8` (:114); break screen `max-w-xl` (:158) | H1 `font-serif text-[28px]` (:115); break H1 `text-[40px]` (:162); timer `font-mono text-[56px]` | None from ui; raw `<button>` (:132,196) | Loading: ExamLoading (:51). Error: ExamLoadError (:52; components/ExamStatus.tsx:16-41). Entitlement: 403 → "This test isn't available to your account." (ExamStatus.tsx:19-20); no upgrade link | 24 arbitrary; 0 hex; 0 inline | GET `/api/tests/sessions/:id/state` (:43-50); `/api/tests/forms` (:144); POST `…/modules/:m/start` (:80-99) |
| `/tests/:sessionId/:section/:module` (207) | `features/exam/pages/ExamModulePage.tsx` | RG > ModuleLoader (:121-164) > ModuleRunner `div.exam-root h-screen` (:455) | **No AppShell.** `ExamHeader` (components/ExamHeader.tsx:22-35) with timer and tools; footer bar (:535-575). No exit link | `h-screen`; review `max-w-4xl px-6 py-8` (ModuleReview.tsx:27) | header H1 `text-base font-semibold` (ExamHeader.tsx:26); timer `font-mono text-[30px]` (ExamTimer.tsx:46); review H2 `font-serif text-[26px]` (ModuleReview.tsx:29) | ui: Dialog (NavigatorDialog.tsx:13-18) and AlertDialog (SubmitModuleDialog.tsx:14-22), re-skinned with `exam-root`. Local: ExamHeader, ExamTimer, ExamQuestionView, ChoiceList, PassageView, QuestionCell, ModuleReview, raw buttons | Loading: ExamLoading (:109,142). Error: ExamLoadError (:110,143-144); save-failure banner (:459-463). Entitlement: 403 → ExamLoadError copy. Empty: `current===undefined` renders `null` | 26 arbitrary in the page (+ children, e.g. ChoiceList 23); hex `bg-[#FBF1E6]` (:460; ExamQuestionView.tsx:69) | GET state (:100-107), `…/items` (:132-136), `…/workspace` (:137-141); POST `/api/tests/answer`; PUT `…/workspace`; POST `…/submit`; POST `…/start`; POST `…/sections/:s/heartbeat` (exam-api.ts:190-230) |
| `/tests/:sessionId/report` (206) | `features/exam/pages/ExamReportPage.tsx` | RG > `ReportLayout` `div.exam-root min-h-screen` (:77) | **No AppShell.** Local header (:78-81) that duplicates ExamSessionPage.tsx:71-74; "Back to dashboard" (:92) | `mx-auto max-w-4xl gap-7 px-4 py-8 md:px-10` (:82) | Title `font-serif text-[30px]` (:118); total `text-[64px]` (:233); Panel H2 `text-[24px]` (:217) | None from ui. Local: Title, Fact, ScoreTabs (a hand-built tablist, :142-196), SectionCard, Panel, DisclosedScore, DomainBreakdown | Loading: ExamLoading (:69). Error: ExamLoadError (:70). Report states scored / partial / pending (polls every 4 s, :55-67) / failed / unavailable / not_completed (:223-343). Entitlement: server `unavailable` + `entitlement_lapsed` copy (:310-312); no upgrade link | 46 arbitrary; hex `bg-[#EAE7E0]` (:170; DomainBreakdown.tsx:51) | GET `/api/tests/sessions/:id/report` (:47-53); GET `…/report/status` (:55-67) |
| `/calendar` (210-217) | `pages/calendar.tsx` → `features/calendar/CalendarView.tsx` | RG > CalendarPage (:63) > one of CalendarSkeleton, CalendarPremiumGate, CalendarError, or CalendarView `div.lyceon-calendar > div.app` (CalendarView.tsx:449-450) | **No AppShell.** LeftRail (features/calendar/components/Chrome.tsx:96-99) + TopBar with a "← Dashboard" link (Chrome.tsx:307-321) | CSS grid `.app {grid-template-columns:248px 1fr; height:100vh}` (features/calendar/calendar.css:88-93); breakpoints :918,:1352,:1561 | Inter 14px (calendar.css:66-73); headings "Bricolage Grotesque" (19 declarations, e.g. :107), **which is not loaded** by `client/index.html:41` or `index.css:1` | **None from ui** (grep of `features/calendar` for `@/components/ui` → no non-test hits). Local: `.btn` family, BlockSheet, CreateBlockSheet, SettingsSheet, SetupPopup, DayMenu, DayOffCard. Shared: PremiumUpgradePrompt | Loading: CalendarSkeleton (CalendarStates.tsx:26-58). Error: CalendarError (:65-97). Entitlement: `status===402` → CalendarPremiumGate (:22-24,100-108). Pre-setup: SetupPopup (calendar.tsx:143-189). The three state screens render with no `.lyceon-calendar` ancestor (CalendarStates.tsx:28,77,102), so the scoped CSS does not match them (proven by grep, not rendered) | calendar.css: 1,636 lines, 113 hex. TSX: 21 inline `style` (e.g. CalendarStates.tsx:33-128, Chrome.tsx:178). 0 Tailwind | GET `/api/calendar?from&to&device_timezone` (api/client.ts:174); GET `/api/me/streak` (:180); PUT `/api/calendar/profile` (:211); PUT `/days/:date` (:227); POST `/blocks/:id/move` (:248), `/plan/regenerate` (:263), `/days/:date/regenerate` (:279), `/days/:date/reset` (:295), `/blocks/:id/do-it-now` (:311), `/blocks/:id/launch` (:332), `/acknowledge` (:347). `/api/tests/forms` (FullLengthFields.tsx:56); `/api/billing/status` |
| `/upgrade` (267-274) | `pages/upgrade.tsx` | RG > `AppShell showFooter` (:113) | AppShell + Footer | `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl` (:114); `md:grid-cols-3` (:142) | eyebrow `tracking-[0.2em]` (:122); H1 `text-3xl md:text-4xl font-semibold` (:123) | ui: Card, Button, Badge, Alert, useToast. Local pill (:180) | Loading: spinner row while hardcoded `fallbackPlans` render (:18-49,217-222). Error: Alert "Fallback pricing is shown" (:131-140); checkout-error toast (:101-109). The `item_added` checkout outcome (lib/billing-client.ts:143-148) has no UI | 1 arbitrary; hardcoded prices (:22,32,42) | GET `/api/billing/plans` (:79-83 → billing-client.ts:94); POST `/api/billing/checkout` (billing-client.ts:129) |
| `/profile` (293-300) | `pages/UserProfile.tsx` | RG* > `AppShell` in every branch (:230,248,271,287) | AppShell, no footer. Guardians also get the student AppShell nav | `container mx-auto py-8 px-4 sm:px-6 lg:px-8 max-w-6xl` (:288); `TabsList grid-cols-4` (:368) | eyebrow `tracking-[0.2em]` (:291); H1 `text-3xl font-bold` (:294-296); H2 `text-2xl font-bold` (:323) | ui: Tabs, Card, Button, Input, Textarea, Select, Label, Badge, Alert, Avatar. Shared: PageCard, **EmptyState** (`components/common/empty-state.tsx`, its only consumer), RecoveryNotice, SessionNotice, StudentLinkCodePanel, StudentGuardiansPanel, DeleteAccountCard, EmailNotificationsCard | Loading: local spinner (:228-239). Error: SessionNotice / RecoveryNotice (:246-265). Empty: EmptyState (:268-283; "Coming Soon" :637). Entitlement: billing tab status + "View Plans" / "Manage" (:737-775) | 5 arbitrary; palette `text-green-500`, `text-yellow-500`, `text-blue-500` (:444,571,591,611) | `/api/profile` (:130-133); `/api/billing/status` (:141-144); POST `/api/billing/portal` (billing-client.ts:152). Children: `/api/account/email-suppression` (+`/clear`), POST `/api/account/delete`, `/api/students/:id/link-code` (+`/regenerate`, `/invite`), `/api/students/:id/links` (+ DELETE) |
| `/profile/complete` (301-308) | `pages/profile-complete.tsx` | RG* (skips its own onboarding redirect on this path, RequireRole.tsx:112,131) > `div.min-h-screen flex items-center justify-center` (:272) | **None** | `Card max-w-lg` (:273) | ui CardTitle (:275-278); error title `text-[#0F2E48]` (:248) | ui: Alert, Button, Card, Checkbox, Input, Label, Select. Shared: GuardianConnectRequired | Loading: Loader2 (:227-238). Error: Card with Retry (:240-268). Validation: amber Alert (:303-311) | 1 hex (:248); amber palette (:249,305-309) | `/api/profile` GET (:100-110), PATCH (:144-150) |
| `/update-password` (309-316) | `pages/update-password.tsx` | RG* > centered `div.min-h-screen` (:81) | **None** | `Card max-w-md` (:82) | `CardTitle text-2xl` (:84) | ui: Card, Button, Alert. Shared: PasswordField | Error: amber Alert (:116-123). Pending label (:134). No loading, empty or entitlement states | amber palette (:117-119) | POST `/api/auth/update-password` (contexts/SupabaseAuthContext.tsx:415) |
| `/notifications` (319-326) | `pages/notifications.tsx` | RG* > `GuardianShell` if guardian, else `AppShell` (:55-63) | AppShell or GuardianShell | `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-3xl` (:137) | H1 `text-2xl font-bold` (:151-158) | ui: Button, Tabs. Local: NotificationRow (:257-362), inline empty state (:210-222) | Loading: `<p>Loading…</p>` (:189-195). Error: text + Try again (:196-208). Empty: dashed box (:209-222) | none | GET `/api/notifications`, `/unread-count`; POST `/mark-all-seen`, `/mark-all-read`; PATCH `/:messageId` (lib/notificationsApi.ts:29-108) |
| `/account/recover` (318) | `pages/account-recover.tsx` | **No RG** (public); exempt from DeletionGate (App.tsx:416) > `div.min-h-screen bg-gradient-to-b from-[#EAF0FF]` (:48) | **None** | `max-w-md bg-white rounded-2xl shadow-lg p-8` (:49) | H1 `text-2xl font-semibold text-neutral-800` (:52-53) | ui: Button | State machine loading / success / invalid / reclaimed / error (:15,50-133); fetch runs in `useEffect` (:20-45) | hex `#EAF0FF` (:48); 13 raw palette classes | POST `/api/account/recover-deletion` (:29-32) |
| *(all routes)* PendingDeletionScreen | `components/account-deletion/PendingDeletionScreen.tsx` | Replaces `<Router/>` when `user.pendingDeletion` (App.tsx:416-418) | **None** | `max-w-md bg-white rounded-2xl shadow-lg p-8` (:64) | H1 `text-2xl font-semibold text-neutral-800` (:66) | ui: Button, Alert | Pending "Restoring…" (:108-110); error toast (:58) | hex `#EAF0FF` (:63) | POST `/api/account/cancel-deletion` (:35-41) |

### 3b. Entry roots, public pages and system pages

| Route (App.tsx) | File | Shell | Container | Data fetching | Notes |
|---|---|---|---|---|---|
| `/` (116) | `pages/home.tsx` | PublicLayout (`components/layout/PublicLayout.tsx`: PublicNavBar + Footer) | `primitives.tsx` Container (`max-w-3xl`, `4xl`, `6xl` or `7xl`) | GET `/api/public/pricing` (:70-74) | A/B hero variant via `Math.random()` (:102-115). Signed-in users see "Go to dashboard" (:205-224) |
| `/login` (117) | `pages/login.tsx` + `components/auth/SupabaseAuthForm.tsx` | **None**; `max-w-md` card (:84-95); no link to `/` | — | POST `/api/auth/signin`, `/signup`, `/reset-password`; `supabase.auth.signInWithOAuth` | Post-auth destination: role default `/dashboard` or `/guardian` (:42) → allow-listed `?next=` (:48-52) → `/profile/complete` if incomplete (:37-40,55-57). The signup tab is never pre-selected (SupabaseAuthForm.tsx:39) |
| `/digital-sat`, `/digital-sat/math`, `/digital-sat/reading-writing` (123-128) | `pages/digital-sat*.tsx` | PublicLayout | primitives Container | none | static |
| `/blog`, `/blog/:slug` (129-130) | `pages/blog.tsx`, `pages/blog-post.tsx` | PublicLayout | primitives | static `@/lib/blog` | unknown slug → in-layout "Post not found" (blog-post.tsx:54-63) |
| `/trust`, `/trust/evidence` (133-134) | `pages/trust.tsx`, `pages/trust-evidence.tsx` | **Footer only, no header** (trust.tsx:407; trust-evidence.tsx:183) | `max-w-5xl` | none | both link to `/tutor` (trust.tsx:159, trust-evidence.tsx:170) |
| `/legal`, `/legal/:slug` (143-144) | `pages/legal.tsx`, `pages/legal-doc.tsx` | legal: Footer only (:247). legal-doc: own sticky header (:130-160) + Footer | `max-w-5xl` / `max-w-7xl` | static `/legal/*.json` (lib/legal-content.ts) | unknown slug → NotFound (legal-doc.tsx:197) |
| 404 catch-all (357) | `pages/not-found.tsx` | **None** | — | none | Developer copy "Did you forget to add the page to the router?" (:15-16); no link home; `bg-gray-50` (:6) |
| Redirect routes | `/signup`→`/login` (120); `/privacy`→`/legal/privacy-policy` (147); `/terms`→`/legal/student-terms` (150); `/practice/math`, `/practice/reading-writing`, `/practice/random`, `/math-practice`, `/reading-writing-practice` → `/practice` (187-195, 253-258) | — | — | — | — |

---

## 4. API inventory (Pass 2)

**Middleware that runs on every request** (`server/index.ts`), in order: `requestId` (:102) → `securityHeaders` (:103) → `corsAllowlist` (:106) → `cookieParser` (:116) → [Stripe webhook :121 and Resend webhook :171 are registered here] → `express.json` (:177) → `globalRateLimiter` (:194-200) → [`/api/csrf-token` :204] → `supabaseAuthMiddleware` (non-blocking, :210) → `enforceDeletionLock` (:216).

**Abbreviations.** Middleware definitions are in `server/middleware/supabase-auth.ts` unless noted.

| Abbreviation | Middleware | Where defined |
|---|---|---|
| RSA | `requireSupabaseAuth` | :615 |
| RSOA | `requireStudentOrAdmin` | :889 (blocks guardians) |
| RSO | `requireStudentOnly` | :828 |
| ADM | `requireSupabaseAdmin` | :719 |
| CSRF | `doubleCsrfProtection` | `server/middleware/csrf-double-submit.ts:149`; ignores GET |
| PC+CC | `requireProfileComplete` + `requireConsentCompliance` | :780, :753 |
| OIDC | `oidcAuthMiddlewareWithConfigGuard` | `packages/shared/internal-auth/verify-oidc-middleware.ts:191` |
| CRON | `cronAuthorized` (Bearer `CRON_SECRET`) | `server/routes/internal-cron-routes.ts:39-49` |
| RS | `resolveSubject` | `server/middleware/subject-resolver.ts:83` (self, or a linked guardian; returns 402 `student_unentitled` or 404) |
| EG | `entitlementGate` → `EntitlementService.canAccessFeature` | `server/routes/student-resources.ts:199` |
| TE | `denyIfNotEntitled` → `isEntitlementActiveForProfile` | `server/routes/tutor-runtime.ts:205-210` |
| CAL-ENT | calendar `entitled()` → 402 | `server/routes/calendar-routes.ts:179-197` |
| EXAM-ENT | `authorizeExamCaller` → `canAccessFeature(exam_full_length)` → **403** | `server/routes/exam-runtime-routes.ts:129-146` |
| QUOTA | practice usage quota `check_and_reserve_practice_quota` → 402 | `apps/api/src/lib/rate-limit-ledger.ts:146` |

### 4a. Mounts (server/index.ts)

| Mount | Line | Mount-level chain | Router file |
|---|---|---|---|
| `/api/legal` | 219 | RSA, CSRF | `server/routes/legal-routes.ts` |
| `/api/tutor` | 390-398 | tutorLimiter, RSA, RSO, CSRF, awaitTutorConfig | `server/routes/tutor-runtime.ts` |
| `/auth` | 403 | googleOAuthCallbackLimiter | `server/routes/oauth-callback-routes.ts` |
| `/api/auth` | 412 | none (per-route) | `server/routes/supabase-auth-routes.ts` |
| `/api/internal` | 415 / 417 / 419 | none / awaitTutorConfig / none | `server/routes/internal-cron-routes.ts`, `internal-memory-routes.ts`, `internal-retention-routes.ts` |
| `/api/profile` | 426-431 | RSA, CSRF | `server/routes/profile-routes.ts` |
| `/api/notifications` | 435-440 | RSA, CSRF | `server/routes/notifications.ts` |
| `/api/students` | 448-453 | RSA, CSRF (no role gate by design) | `server/routes/student-resources.ts` |
| `/api/calendar` | 460-466 | RSA, CSRF, RSOA | `server/routes/calendar-routes.ts` (`calendarRouter`) |
| `/api/me` | 472 | RSA, RSOA | `server/routes/calendar-routes.ts:81` (`streakRouter`) |
| `/api/admin/crisis-review` | 510-514 | CSRF (the router adds RSA + ADM) | `server/routes/admin-crisis-review.ts` |
| `/api/guardian` | 610-615 | RSA, CSRF | `server/routes/guardian-routes.ts` |
| `/api/public` | 630 | none | `server/routes/public-pricing-routes.ts` |
| `/api/billing` | 633 | none (per-route) | `server/routes/billing-routes.ts` |
| `/api/account` | 636, 637 | none (per-route) | `server/routes/account-routes.ts`, `account-deletion-routes.ts` |
| `/api/health` | 640 | none | `server/routes/health-routes.ts` |
| `/api/practice/diagnostic` | 659-665 | RSA, RSOA, CSRF | `server/routes/diagnostic-routes.ts` |
| `/api/practice` | 670-676 | RSA, RSOA, CSRF (routes add RSA, PC, CC) | `server/routes/practice-canonical.ts` |
| `/api/tests` | 683-689 and 696-702 | RSA, RSOA, CSRF (both mounts, so report routes run the chain twice) | `server/routes/exam-runtime-routes.ts`, `exam-report-routes.ts` |
| `/api/review` | 711-717 | RSA, RSOA, CSRF (routes add RSA, PC, CC) | `server/routes/review-canonical.ts` |

`apps/api/src/routes/healthz.ts:5` (`registerHealthz`) is **not mounted**: it is referenced only at its own definition, and `apps/api/src/index.ts` does not exist (pass2-A §C).

### 4b. Endpoints (each method on its own row)

File:line is the handler. Auth is the effective chain: mount + route. The Class column is the Pass 3 classification (§5b).

| # | Path | Method | File:line | Auth guard | Entitlement | Class |
|---|---|---|---|---|---|---|
| 1 | /api/billing/webhook | POST | server/index.ts:121 | Stripe signature (server/lib/stripe/webhook-handler.ts:2763) | none | SYSTEM |
| 2 | /api/webhooks/resend | POST | server/index.ts:171 → server/routes/resend-webhook.ts:221 | Svix signature (resend-webhook.ts:94) | none | SYSTEM |
| 3 | /api/csrf-token | GET | server/index.ts:204 | none | none | SHARED |
| 4 | /privacy, /terms | ALL | server/index.ts:349-350 | none | none | UNREFERENCED (see Q9) |
| 5 | /healthz | GET | server/index.ts:353 | none | none | UNREFERENCED |
| 6 | /api/health | GET | server/index.ts:354 | none | none | UNREFERENCED |
| 7 | /auth/callback | GET | server/routes/oauth-callback-routes.ts:422 → :142 | OAuth limiter; PKCE | none | SYSTEM |
| 8 | /api/auth/callback | GET | server/index.ts:405 | OAuth limiter | none | SYSTEM (alias; see Q8) |
| 9 | /api/auth/signup | POST | server/routes/supabase-auth-routes.ts:83 | authRateLimiter, CSRF | none | UI-LIVE |
| 10 | /api/auth/admin-provision | POST | supabase-auth-routes.ts:316 | authRateLimiter, CSRF; env-gated (:334,:348) | none | UNREFERENCED |
| 11 | /api/auth/signin | POST | supabase-auth-routes.ts:497 | authRateLimiter, CSRF | none | UI-LIVE |
| 12 | /api/auth/signout | POST | supabase-auth-routes.ts:568 | CSRF | none | SHARED |
| 13 | /api/auth/debug | GET | supabase-auth-routes.ts:615 | 404 in production | none | UNREFERENCED |
| 14 | /api/auth/reset-password | POST | supabase-auth-routes.ts:732 | authRateLimiter, CSRF | none | UI-LIVE |
| 15 | /api/auth/update-password | POST | supabase-auth-routes.ts:797 | RSA, CSRF | none | SHARED (caller page is URL-ONLY) |
| 16 | /api/legal/accept | POST | server/routes/legal-routes.ts:26 | RSA, CSRF | none (always 404) | UNREFERENCED |
| 17 | /api/legal/reaccept | POST | legal-routes.ts:55 | RSA, CSRF | none | SHARED |
| 18 | /api/legal/acceptances | GET | legal-routes.ts:173 | RSA, CSRF | none | UNREFERENCED |
| 19 | /api/profile | GET | server/routes/profile-routes.ts:115 | RSA, CSRF | none | SHARED |
| 20 | /api/profile | PATCH | profile-routes.ts:246 | RSA, CSRF | none | SHARED |
| 21 | /api/notifications | GET | server/routes/notifications.ts:101 | RSA, CSRF | none | SHARED |
| 22 | /api/notifications/unread-count | GET | notifications.ts:196 | RSA, CSRF | none | SHARED |
| 23 | /api/notifications/mark-all-seen | POST | notifications.ts:225 | RSA, CSRF | none | SHARED |
| 24 | /api/notifications/mark-all-read | POST | notifications.ts:258 | RSA, CSRF | none | SHARED |
| 25 | /api/notifications/:message_id | PATCH | notifications.ts:287 | RSA, CSRF | none | SHARED |
| 26 | /api/public/pricing | GET | server/routes/public-pricing-routes.ts:155 | none | none | UI-LIVE |
| 27 | /api/billing/checkout | POST | server/routes/billing-routes.ts:123 | RSA, CSRF; admin → 403 (:134) | purchase eligibility (:174,:291,:371) | SHARED |
| 28 | /api/billing/status | GET | billing-routes.ts:706 | RSA; admin → 403 (:715) | reads entitlement (:737,:826-827) | SHARED |
| 29 | /api/billing/portal | POST | billing-routes.ts:897 | RSA, CSRF; admin → 403 | none | SHARED |
| 30 | /api/billing/plans | GET | billing-routes.ts:998 | RSA | none | SHARED |
| 31 | /api/billing/publishable-key | GET | billing-routes.ts:1050 | **none** | none | UNREFERENCED |
| 32 | /api/account/status | GET | server/routes/account-routes.ts:15 | RSA | reads entitlement (:41) | UNREFERENCED |
| 33 | /api/account/select | POST | account-routes.ts:90 | RSA, CSRF (always 409) | none | UNREFERENCED |
| 34 | /api/account/email-suppression | GET | account-routes.ts:138 | RSA | none | SHARED |
| 35 | /api/account/email-suppression/clear | POST | account-routes.ts:178 | RSA, CSRF | none | SHARED |
| 36 | /api/account/delete | POST | server/routes/account-deletion-routes.ts:238 | RSA, CSRF | none | SHARED |
| 37 | /api/account/cancel-deletion | POST | account-deletion-routes.ts:403 | RSA, CSRF | none | SHARED |
| 38 | /api/account/recover-deletion | POST | account-deletion-routes.ts:542 | none (token capability; 404 when the flag is off) | none | UI-ORPHAN |
| 39 | /api/health/practice | GET | server/routes/health-routes.ts:37 | 404 in production | none | UNREFERENCED |
| 40 | /api/_whoami | GET | server/index.ts:720 | 404 in production | none | UNREFERENCED |
| 41 | /api/progress/projection | GET | server/index.ts:474 → server/routes/legacy/progress.ts:61 | RSA, RSOA | payload degrades (progress.ts:68,108); no 402 | UI-LIVE |
| 42 | /api/progress/kpis | GET | server/index.ts:482 → progress.ts:384 | RSA, RSOA | payload degrades (:391,:397) | UI-LIVE |
| 43 | /api/questions | GET | server/index.ts:518 → server/routes/questions-runtime.ts:107 | RSA, RSOA | none | UNREFERENCED |
| 44 | /api/questions/recent | GET | server/index.ts:537 → questions-runtime.ts:146 | **none** (anonymous) | none | UNREFERENCED |
| 45 | /api/questions/random | GET | server/index.ts:552 → :182 | RSA, RSOA | none | UNREFERENCED |
| 46 | /api/questions/count | GET | server/index.ts:571 → :223 | RSA, RSOA | none | UNREFERENCED |
| 47 | /api/questions/stats | GET | server/index.ts:577 → :248 | RSA, RSOA | none | UI-LIVE |
| 48 | /api/questions/feed | GET | server/index.ts:583 → :308 | RSA, RSOA | none | UNREFERENCED |
| 49 | /api/questions/:id | GET | server/index.ts:591 → :352 | RSA, RSOA | none | UNREFERENCED |
| 50 | /api/questions/feedback | POST | server/index.ts:601 → :492 | RSA, RSOA, CSRF | none | UNREFERENCED |
| 51 | /api/practice/topics | GET | server/index.ts:643 → server/routes/practice-topics-routes.ts:44 | RSA, RSOA | none | UI-LIVE |
| 52 | /api/practice/reference/questions | GET | server/index.ts:649 → practice-topics-routes.ts:94 | RSA, RSOA | none | UI-LIVE |
| 53 | /api/practice/diagnostic/sessions | POST | server/routes/diagnostic-routes.ts:67 | RSA, RSOA, CSRF | none | UI-LIVE |
| 54 | /api/practice/diagnostic/sessions/:id/weakest-skills | GET | diagnostic-routes.ts:451 | RSA, RSOA | none | UNREFERENCED |
| 55 | /api/practice/sessions/open | GET | server/routes/practice-canonical.ts:2139 | RSA, RSOA, CSRF, PC, CC | none | UI-LIVE |
| 56 | /api/practice/sessions | POST | practice-canonical.ts:2325 | same | QUOTA (:1472,:1736) | UI-LIVE |
| 57 | /api/practice/sessions/:id/resume | POST | practice-canonical.ts:2213 | same | none | UI-LIVE |
| 58 | /api/practice/sessions/:id/terminate | POST | practice-canonical.ts:2400 | same | none | UI-LIVE |
| 59 | /api/practice/sessions/:id/calculator-state | POST | practice-canonical.ts:2475 | same | none | UI-LIVE |
| 60 | /api/practice/sessions/:id/next | GET | practice-canonical.ts:2562 | same | QUOTA (:2079) | UI-LIVE |
| 61 | /api/practice/sessions/:id/state | GET | practice-canonical.ts:2612 | same | none | UI-LIVE |
| 62 | /api/practice/answer | POST | practice-canonical.ts:3985 | same + practiceAnswerRateLimiter | none | UI-LIVE |
| 63 | /api/practice/sessions/:id/skip | POST | practice-canonical.ts:3993 | same + practiceAnswerRateLimiter | none | UI-LIVE |
| 64 | /api/review/pool | GET | server/routes/review-canonical.ts:1411 | RSA, RSOA, CSRF, PC, CC | none (by design, :19) | UI-LIVE |
| 65 | /api/review/sessions/open | GET | review-canonical.ts:1447 | same | none | UI-LIVE |
| 66 | /api/review/sessions | POST | review-canonical.ts:1502 | same | none | UI-LIVE |
| 67 | /api/review/sessions/:id/state | GET | review-canonical.ts:1590 | same | none | UI-LIVE |
| 68 | /api/review/sessions/:id/next | GET | review-canonical.ts:1646 | same | none | UI-LIVE |
| 69 | /api/review/sessions/:id/resume | POST | review-canonical.ts:1684 | same | none | UI-LIVE |
| 70 | /api/review/sessions/:id/terminate | POST | review-canonical.ts:1751 | same | none | UI-LIVE |
| 71 | /api/review/sessions/:id/calculator-state | POST | review-canonical.ts:1797 | same | none | UI-LIVE |
| 72 | /api/review/answer | POST | review-canonical.ts:1844 | same + practiceAnswerRateLimiter | none | UI-LIVE |
| 73 | /api/review/sessions/:id/skip | POST | review-canonical.ts:1853 | same + practiceAnswerRateLimiter | none | UI-LIVE |
| 74 | /api/tests/sessions | POST | server/routes/exam-runtime-routes.ts:181 | RSA, RSOA, CSRF, PC, CC | EXAM-ENT (403) | UI-LIVE |
| 75 | /api/tests/sessions/:id/state | GET | exam-runtime-routes.ts:201 | same | EXAM-ENT | UI-LIVE |
| 76 | /api/tests/sessions/:id/sections/:s/modules/:m/start | POST | exam-runtime-routes.ts:221 | same | EXAM-ENT | UI-LIVE |
| 77 | …/modules/:m/items | GET | exam-runtime-routes.ts:246 | same | EXAM-ENT | UI-LIVE |
| 78 | /api/tests/answer | POST | exam-runtime-routes.ts:271 | same | EXAM-ENT | UI-LIVE |
| 79 | …/modules/:m/submit | POST | exam-runtime-routes.ts:291 | same | EXAM-ENT | UI-LIVE |
| 80 | …/sections/:s/heartbeat | POST | exam-runtime-routes.ts:316 | same | EXAM-ENT | UI-LIVE |
| 81 | /api/tests/forms | GET | exam-runtime-routes.ts:351 | same | EXAM-ENT | UI-LIVE |
| 82 | …/modules/:m/workspace | GET | exam-runtime-routes.ts:361 | same | EXAM-ENT | UI-LIVE |
| 83 | …/modules/:m/workspace | PUT | exam-runtime-routes.ts:386 | same | EXAM-ENT | UI-LIVE |
| 84 | /api/tests/sessions/:id/report | GET | server/routes/exam-report-routes.ts:135 | RSA, RSOA, CSRF (twice), PC, CC | `canAccessFeature(exam_full_length)` → 200 `unavailable` (:85-87) | UI-LIVE |
| 85 | /api/tests/sessions/:id/report/status | GET | exam-report-routes.ts:145 | same | same | UI-LIVE |
| 86 | /api/calendar | GET | server/routes/calendar-routes.ts:478 | RSA, CSRF, RSOA | `canAccessFeature(calendar_access)` (:513) / CAL-ENT (:527) | UI-LIVE |
| 87 | /api/calendar/profile | PUT | calendar-routes.ts:555 | same | **none** (:555-572) | UI-LIVE |
| 88 | /api/calendar/plan/regenerate | POST | calendar-routes.ts:574 | same | CAL-ENT (:580) | UI-LIVE |
| 89 | /api/calendar/days/:date/regenerate | POST | calendar-routes.ts:676 | same | CAL-ENT (:629) | UI-LIVE |
| 90 | /api/calendar/days/:date/reset | POST | calendar-routes.ts:681 | same | CAL-ENT (:629) | UI-LIVE |
| 91 | /api/calendar/days/:date | PUT | calendar-routes.ts:689 | same | CAL-ENT (:692) | UI-LIVE |
| 92 | /api/calendar/blocks/:id/launch | POST | calendar-routes.ts:775 | same | CAL-ENT (:780) | UI-LIVE |
| 93 | /api/calendar/blocks/:id/do-it-now | POST | calendar-routes.ts:831 | same | CAL-ENT (:836) | UI-LIVE |
| 94 | /api/calendar/blocks/:id/move | POST | calendar-routes.ts:927 | same | CAL-ENT (:933) | UI-LIVE |
| 95 | /api/calendar/acknowledge | POST | calendar-routes.ts:983 | same | CAL-ENT (:986) | UI-LIVE |
| 96 | /api/me/streak | GET | calendar-routes.ts:1022 | RSA, RSOA | none (deliberate, index.ts:468-471) | UI-LIVE |
| 97 | /api/students/:id/mastery/domains | GET | server/routes/student-resources.ts:270 | RSA, CSRF, RS | EG `mastery_detail` (:287) | SHARED |
| 98 | /api/students/:id/mastery/skills | GET | student-resources.ts:336 | RSA, CSRF, RS | EG `mastery_detail` (:345) | UI-LIVE |
| 99 | /api/students/:id/kpi/sections | GET | student-resources.ts:385 | RSA, CSRF, RS | none | UNREFERENCED |
| 100 | /api/students/:id/kpi/domains | GET | student-resources.ts:389 | RSA, CSRF, RS | none | UNREFERENCED |
| 101 | /api/students/:id/kpi/overall | GET | student-resources.ts:398 | RSA, CSRF, RS | none | guardian-only (out of scope) |
| 102 | /api/students/:id/projections/sections | GET | student-resources.ts:410 | RSA, CSRF, RS | none | UNREFERENCED |
| 103 | /api/students/:id/projections/snapshots | GET | student-resources.ts:414 | RSA, CSRF, RS | none | UNREFERENCED |
| 104 | /api/students/:id/calendar | GET | student-resources.ts:438 | RSA, CSRF, RS | EG `calendar_access` (:447) | guardian-only (out of scope) |
| 105 | /api/students/:id/tests | GET | student-resources.ts:521 | RSA, CSRF, RS | EG exam (:530) | guardian-only (out of scope) |
| 106 | /api/students/:id/tests/:sid/report | GET | student-resources.ts:564 | RSA, CSRF, RS | EG exam (:573) | guardian-only (out of scope) |
| 107 | /api/students/:id/link-code | GET | student-resources.ts:648 | RSA, CSRF, RS; self only (:655) | none | UI-LIVE |
| 108 | /api/students/:id/link-code/regenerate | POST | student-resources.ts:728 | same + rate limit | none | UI-LIVE |
| 109 | /api/students/:id/links | GET | student-resources.ts:786 | same; self only (:793) | none | UI-LIVE |
| 110 | /api/students/:id/link-code/invite | POST | student-resources.ts:871 | same + invite rate limit (:904) | none | UI-LIVE |
| 111 | /api/students/:id/links/:linkId | DELETE | student-resources.ts:1022 | same; self only (:1030) | none | UI-LIVE |
| 112 | /api/tutor/conversations | POST | server/routes/tutor-runtime.ts:564 | tutorLimiter, RSA, RSO, CSRF | TE (:575) | UI-LIVE |
| 113 | /api/tutor/messages | POST | tutor-runtime.ts:813 | same | TE (:822) | UI-LIVE |
| 114 | /api/tutor/conversations/:id | GET | tutor-runtime.ts:2046 | same | TE (:2054) | UI-LIVE |
| 115 | /api/tutor/conversations | GET | tutor-runtime.ts:2195 | same | TE (:2204) | UI-LIVE |
| 116 | /api/tutor/conversations/:id/end | POST | tutor-runtime.ts:2348 | same | TE (:2357) | UI-LIVE |
| 117 | /api/tutor/conversations/:id/resume | POST | tutor-runtime.ts:2453 | same | TE (:2462) | UI-LIVE |
| 118-125 | /api/internal/{legal-acceptance-drain, execute-deletions, stale-session-sweep, baseline-pending-sweep, notification-dispatch-sweep, notification-retention-sweep, calendar-weekly-regen, calendar-exam-notify} | GET | server/routes/internal-cron-routes.ts:54, 93, 242, 308, 373, 438, 481, 532 | CRON | none | SYSTEM |
| 126 | /api/internal/crisis-sla-sweep | POST | internal-cron-routes.ts:167 | OIDC | none | SYSTEM |
| 127 | /api/internal/memory/compact-writeback | POST | server/routes/internal-memory-routes.ts:91 | awaitTutorConfig, OIDC | none | SYSTEM |
| 128 | /api/internal/async/memory-refresh | POST | internal-memory-routes.ts:186 | awaitTutorConfig, OIDC | none | UNREFERENCED (see Q10) |
| 129 | /api/internal/async/pending-reconciliation | POST | internal-memory-routes.ts:287 | awaitTutorConfig, OIDC | none | UNREFERENCED (see Q10) |
| 130 | /api/internal/retention/sweep | POST | server/routes/internal-retention-routes.ts:110 | OIDC | none | SYSTEM |
| 131 | /api/guardian/students | GET | server/routes/guardian-routes.ts:98 | RSA, CSRF, requireGuardianRole | display only (:196,:199) | guardian-only (out of scope) |
| 132 | /api/guardian/link/redeem | POST | guardian-routes.ts:285 | same + link rate limit | none | guardian-only (out of scope) |
| 133 | /api/guardian/link/:studentId | DELETE | guardian-routes.ts:457 | same | none | guardian-only (out of scope) |
| 134 | /api/admin/crisis-review/cases | GET | server/routes/admin-crisis-review.ts:74 | CSRF, RSA, ADM | none | admin-only (out of scope) |
| 135 | /api/admin/crisis-review/cases/:id | GET | admin-crisis-review.ts:128 | same | none | admin-only (out of scope) |
| 136 | /api/admin/crisis-review/cases/:id/claim | POST | admin-crisis-review.ts:187 | same | none | admin-only (out of scope) |
| 137 | /api/admin/crisis-review/cases/:id/disposition | POST | admin-crisis-review.ts:239 | same | none | admin-only (out of scope) |
| 138 | /api/admin/crisis-review/sla-breaches | GET | admin-crisis-review.ts:305 | same | none | UNREFERENCED |
| 139 | /api/admin/db-health | GET | server/index.ts:489 | RSA, ADM | none | UNREFERENCED |
| 140 | PUBLIC_SSR_ROUTES (16 paths, server/seo-content.ts:35) and /legal/:slug | GET | server/index.ts:781-789 | none | none | UNREFERENCED on Vercel (see Q9) |
| 141 | `*` SPA fallback | GET | server/index.ts:844 | none | none | infrastructure |
| — | apps/api `/healthz` | GET | apps/api/src/routes/healthz.ts:6 | — | — | not mounted |

**Direct Supabase calls from the client:** only `supabase.auth.signInWithOAuth` (`contexts/SupabaseAuthContext.tsx:346`, from `/login`). There are no `.rpc(`, `.from(`, `.storage` or `.channel(` calls. The grep and its output are in pass2-B.

---

## 5. Reachability (Pass 3)

**Entry roots:** `/` (public landing), `/login` (PublicNavBar.tsx:53,59), and the post-auth student home, `/dashboard` (login.tsx:42; oauth-callback-routes.ts:342-356).

**Main student nav:** AppShell `navItems` (app-shell.tsx:44-49) holds Dashboard, Calendar, Practice, Tests, Review and Lisa→/chat. User menu: HeaderUserMenu.tsx:113 → `/profile`.

### 5a. Pages

| Page | Class | Click path (inbound link file:line) |
|---|---|---|
| `/` | LIVE (entry root) | — ; also PublicNavBar.tsx:10,19 and Footer.tsx:28 |
| `/login` | LIVE (entry root) | `/` → "Sign In" (PublicNavBar.tsx:53) |
| `/signup` → `/login` | LIVE (redirect) | `/` → CTA (home.tsx:709) |
| `/dashboard` | LIVE (post-auth home) | `/login` → role default (login.tsx:42); nav (app-shell.tsx:44) |
| `/calendar` | LIVE | nav "Calendar" (app-shell.tsx:45) |
| `/practice` | LIVE | nav "Practice" (app-shell.tsx:46) |
| `/practice/topics` | LIVE | `/practice` → Browse topics (practice.tsx:793) |
| `/practice/session/:id` | LIVE | `/practice` → start or resume (practice.tsx:246,410); `/dashboard` → diagnostic (lyceon-dashboard.tsx:148); calendar launch (features/calendar/api/launch.ts:166) |
| `/review` | LIVE | nav "Review" (app-shell.tsx:48) |
| `/review/session/:id` | LIVE | `/review` → start or resume (review.tsx:170,308) |
| `/mastery` | LIVE (not in nav) | `/dashboard` → (lyceon-dashboard.tsx:436); `/practice` secondary action (practice.tsx:305→920) |
| `/chat` | LIVE | nav "Lisa" (app-shell.tsx:49); lyceon-dashboard.tsx:519 |
| `/tutor` | LIVE (only via the public trust pages) | `/` → Footer "Trust & Safety" (Footer.tsx:15) → `/trust` → "Open Tutor Page" (trust.tsx:159); trust-evidence.tsx:170. No link inside the authenticated app |
| `/tests` | LIVE | nav "Tests" (app-shell.tsx:47) |
| `/tests/:id` | LIVE | `/tests` → FormCard (TestsHomePage.tsx:126,164); calendar launch (launch.ts:166) |
| `/tests/:id/:section/:module` | LIVE | `/tests` → Start (TestsHomePage.tsx:160); ExamSessionPage.tsx:91 |
| `/tests/:id/report` | LIVE | TestsHomePage.tsx:132; after submit (ExamModulePage.tsx:251) |
| `/upgrade` | LIVE (depends on state) | `/dashboard` "View Plans" when `baseline_only` (lyceon-dashboard.tsx:184 → lib/billing-cta.ts:41); PremiumUpgradePrompt (PremiumUpgradePrompt.tsx:190); `/calendar` SetupPopup (calendar.tsx:165); `/profile` billing tab (UserProfile.tsx:766) |
| `/profile` | LIVE | user menu "Settings" (HeaderUserMenu.tsx:113); mobile sheet (app-shell.tsx:205) |
| `/profile/complete` | LIVE (redirect only, depends on state) | incomplete profile → RequireRole.tsx:132 / login.tsx:56 / OAuth callback (oauth-callback-routes.ts:342-356). No clickable link |
| `/notifications` | LIVE | bell → "View all" (components/notifications/NotificationBell.tsx:193) |
| `/update-password` | URL-ONLY | No in-app link. Reached only from the password-reset email: `redirectTo …/auth/callback?next=/update-password` (server/routes/supabase-auth-routes.ts:762; oauth-callback-routes.ts:70) |
| `/account/recover` | URL-ONLY | No in-app link. Reached only from the deletion email (server/lib/notifications/direct-sends.ts:171; templates/deletion-scheduled.ts:43) |
| PendingDeletionScreen | state-substituted (not a route) | Rendered whenever `user.pendingDeletion` (App.tsx:416) |
| `/digital-sat`, `/digital-sat/math`, `/digital-sat/reading-writing` | LIVE | PublicNavBar.tsx:11; Footer.tsx:9-11 |
| `/blog`, `/blog/:slug` | LIVE | PublicNavBar.tsx:12; blog.tsx:53,72 |
| `/trust`, `/trust/evidence` | LIVE | Footer.tsx:15; trust.tsx:131 |
| `/legal`, `/legal/:slug` | LIVE | Footer.tsx:16-18; legal.tsx:208 |
| `/practice/math`, `/practice/random` → `/practice` | LIVE (redirect) | browse-topics.tsx:336,337 |
| `/practice/reading-writing`, `/math-practice`, `/reading-writing-practice`, `/privacy`, `/terms` | URL-ONLY (redirects) | no client link (pass1-C §3, §7 nav map) |
| 404 | catch-all | `App.tsx:357`; legal-doc.tsx:197 |

- **FLAG-GATED: none.** No flag gates any route or nav link. The only UI-affecting flag, `ACCOUNT_DELETION_LIFECYCLE_V2` (default off, server/lib/account-deletion-execute.ts:162-164), gates controls inside `/profile`, not a route (pass1-C §5).
- **DEAD pages: none.** Every file in `pages/` and `features/*/pages/` is imported by `App.tsx`, and every internal navigation target resolves to a registered route (pass1-C §6.1, §7).

**Dead components.** These carry navigation but have no non-test importer: `components/NavBar.tsx`, `components/navigation.tsx`, `components/progress-sidebar.tsx`, `components/test-options.tsx`, `components/progress/ScoreProjectionCard.tsx`. Evidence command and output: `grep -rnE "NavBar|/navigation['\"]|ProgressSidebar|progress-sidebar" client apps packages tests --include=*.ts --include=*.tsx` → only self-definitions, `PublicNavBar` and `review-entry-points.test.ts:75,77` (pass1-C §1.2).

Full orphan list (about 20 modules plus 21 unused `components/ui` primitives): pass1-C §6.2.

### 5b. Endpoints

The class of each endpoint is the last column of §4b. Grouped:

- **UI-LIVE (student).** Rows 9, 11, 14, 26, 41-42, 47, 51-53, 55-96, 98, 107-117.
  - Caller file:line for each is in pass2-A §B and pass2-B.
  - Examples: `/api/tests/forms` ← TestsHomePage.tsx:58; `/api/calendar` ← features/calendar/api/client.ts:174 ← pages/calendar.tsx:79; `/api/practice/sessions/:id/next` ← lib/engine-config.ts:149-150 via hooks/useCanonicalPractice.ts:467.
  - Row 60 has an extra, unreached caller path in `hooks/usePractice.ts:334-337`. The same applies to rows 58, 59, 62 and 63 (`usePractice.ts:412,494,557,616`): `practice.tsx` uses only `startSession` (pass2-B ambiguity 5).
- **SHARED (student and guardian/admin).**
  - `csrf-token` (3), signout (12), update-password (15).
  - Legal reaccept (17): ReconsentModal inside every RequireRole.
  - Profile GET/PATCH (19-20) and notifications ×5 (21-25): the bell is in both AppShell and GuardianShell.
  - Billing checkout, status, portal and plans (27-30): upgrade.tsx and PremiumUpgradePrompt for students; GuardianPurchaseCard, CheckoutReturnPoller and ManageSubscriptionButton for guardians.
  - Account email-suppression ×2, delete and cancel-deletion (34-37): `/profile` and PendingDeletionScreen for any role.
  - `mastery/domains` (97): mastery.tsx:170 and guardian-dashboard.tsx:192-193.
- **UI-ORPHAN.** Row 38 `/api/account/recover-deletion`, whose only caller is the URL-ONLY `/account/recover` (account-recover.tsx:29). Row 15 is also called only from a URL-ONLY page, but it is classed SHARED.
- **SYSTEM.**
  - Stripe webhook (1) and Resend webhook (2).
  - OAuth `/auth/callback` (7) and alias (8).
  - Vercel crons (118-125): `vercel.json:8-36`.
  - Cloud Scheduler: crisis-sla-sweep (126, infra/terraform/cloud-scheduler-crisis.tf:34) and retention/sweep (130, infra/terraform/cloud-scheduler.tf:69,156,202).
  - Cloud Tasks: compact-writeback (127), enqueued at tutor-runtime.ts:2412-2414.
- **Guardian- or admin-only.** Out of scope: rows 101, 104-106, 131-137.
- **UNREFERENCED.** Rows 4-6, 10, 13, 16, 18, 31-33, 39-40, 43-46, 48-50, 54, 99-100, 102-103, 128-129, 138-140, and apps/api healthz. The search commands and outputs are below.

**Evidence for "no caller".** All searches were run from the snapshot root. "exit 1" means grep ran and found nothing; no search errored.

```
grep -rn "publishable-key" client/src --include=*.ts --include=*.tsx | grep -vE '\.test\.|__tests__'      → (empty, exit 1)
grep -rn "account/status" client/src … ; "account/select" ; "db-health" ; "sla-breaches" ; "weakest-skills" ; "_whoami" ; "api/health" ; "healthz"   → each (empty, exit 1)
grep -rnE 'api/questions' client/src --include=*.ts --include=*.tsx | grep -vE '\.test\.|__tests__'
  client/src/lib/queryClient.ts:113:      url.includes("/api/questions") &&      (response unwrapping, not a call)
  client/src/pages/practice.tsx:145:    queryKey: ["/api/questions/stats"],   (only /stats is called)
grep -rnE 'questions/recent|questions/random|questions/count|questions/feed|questions/feedback' client/src … → (empty, exit 1)
grep -rnE 'recordAcceptance|fetchUserAcceptances' client/src … → only definitions client/src/lib/legal.ts:55,81 (module has no importer)
grep -rnE 'admin-provision' client/src … → (empty, exit 1)
grep -rnE 'api/auth/debug|auth/debug' client/src … → (empty, exit 1)
grep -rnE 'kpiSections|kpiDomains|projectionsSections|projectionsSnapshots|kpi/sections|kpi/domains|projections/' client/src … → (empty, exit 1)
grep -rn "enqueueCloudTask(" server apps packages --include=*.ts | grep -v .test. → only tutor-runtime.ts:2414 (lisa-compaction) + definition cloud-tasks-enqueue.ts:139
grep -rn "registerHealthz" . --exclude-dir=node_modules → only apps/api/src/routes/healthz.ts:5
```

---

## 6. Consistency summary (Pass 1 only; descriptive)

### 6.1 Shells actually used

| # | Shell | Pages |
|---|---|---|
| 1 | **AppShell + Footer** (`components/layout/app-shell.tsx`, `showFooter`) | `/dashboard`, `/practice`, `/review`, `/mastery`, `/upgrade` |
| 2 | **AppShell, no Footer** | `/practice/topics`, `/tests`, `/profile`, `/notifications` (student/admin) |
| 3 | **PracticeShell** (`components/layout/PracticeShell.tsx`) | `/practice/session/:id`, `/review/session/:id` (runner branch only) |
| 4 | **Exam local shells**: `Shell` (ExamSessionPage.tsx:68-78), `ReportLayout` (ExamReportPage.tsx:74-87), `ExamHeader` + footer bar (ExamModulePage.tsx:455-575) | `/tests/:id`, `/tests/:id/:s/:m`, `/tests/:id/report` |
| 5 | **Calendar chrome**: LeftRail + TopBar (features/calendar/components/Chrome.tsx) | `/calendar` |
| 6 | **Chat local sidebar and header** (chat.tsx:461-532) | `/chat` |
| 7 | **No shell**: bare centered layout or full-height column | `/tutor`, `/profile/complete`, `/update-password`, `/account/recover`, PendingDeletionScreen, `/login`, 404, and the loading/error/closed branches of both session pages |
| 8 | **PublicLayout** (PublicNavBar + Footer) | `/`, `/digital-sat*`, `/blog*` |
| 9 | **Footer only** / **own header + Footer** | `/trust`, `/trust/evidence`, `/legal` / `/legal/:slug` |

That is **9 distinct shell treatments** across in-scope pages. Seven of them (1-7) appear on authenticated or account student surfaces. `GuardianShell` (a 10th) appears in scope only on `/notifications` for guardians.

Three navigation components are dead (`NavBar.tsx`, `navigation.tsx`, `progress-sidebar.tsx`); each defines a different nav config.

**Container widths on AppShell pages:**

| Width | Pages |
|---|---|
| `max-w-7xl` | dashboard, practice, review |
| `max-w-6xl` | practice/topics, upgrade, profile, tests |
| `max-w-5xl` | mastery |
| `max-w-3xl` | notifications |

Horizontal padding is `px-4 sm:px-6 lg:px-8` everywhere except `/practice/topics` (`px-4`) and `/tests` (`-mx-4 px-4 md:px-10`). `AppShell`'s `<main>` sets no width (app-shell.tsx:71).

### 6.2 UI elements implemented more than once

| Element | Variants (file:line) |
|---|---|
| **Button** (ui `Button` exists) | Hand-rolled `<button>`: chat.tsx:172,195,247,254; practice.tsx:468,526,557,591,606,621,629; review.tsx:428,461,538; resume-practice.tsx:97,104,133,179; resume-review.tsx:98,105,132; TutorThreadParts.tsx:195; App.tsx:392. Exam accent-button class string retyped: TestsHomePage.tsx:52-55,222; ExamSessionPage.tsx:132,196; ExamModulePage.tsx:563; ExamReportPage.tsx:100,334; ExamStatus.tsx:30; ModuleReview.tsx:68; NavigatorDialog.tsx:77; SubmitModuleDialog.tsx:76. Calendar `.btn` family (calendar.css; Chrome.tsx:332-409) |
| **Card** | ui `card.tsx`; `layout/primitives.tsx:125` Card; `common/page-card.tsx` PageCard; dashboard Link tiles (lyceon-dashboard.tsx:392-420); exam FormCard (TestsHomePage.tsx:103), SectionCard and Panel (ExamReportPage.tsx:198,214) |
| **Page header** (eyebrow + H1) | dashboard :190-201; practice :315-330; review :197-211; mastery :192-214; browse-topics :122-135; tutor :77; upgrade :122-128; UserProfile :290-300; notifications :151-158; TestsHomePage :66; PracticeShell.tsx:63-66. There is no shared component; `primitives.tsx` `Hero` is used only on public pages |
| **Empty state** | Shared `common/empty-state.tsx`, used only by UserProfile.tsx:273,637. Local: review.tsx:176-192; browse-topics.tsx:281-292; chat.tsx:216-220,424-455; tutor.tsx:104-108; CanonicalPracticePage.tsx:501-512; notifications.tsx:210-222; TestsHomePage.tsx:80; CalendarStates.tsx:115-135 |
| **Alert / notice** (AppNotice exists) | practice.tsx:674-678; review.tsx:213-233,326-337; CanonicalPracticePage.tsx:462-518; update-password.tsx:117-119; profile-complete.tsx:305-309; exam `<p role=alert>` TestsHomePage.tsx:73,212, ExamSessionPage.tsx:124,187 |
| **Full-page spinner** | App.tsx:101-108 (PageLoader); RequireRole.tsx:65-73; UserProfile.tsx:230-238; profile-complete.tsx:227-238; resume-practice.tsx:75-82; resume-review.tsx:70-80; ExamStatus.tsx:8-14 (text only) |
| **Centered card on a gradient** | App.tsx:383-384; account-recover.tsx:48-49; PendingDeletionScreen.tsx:63-64 (same `from-[#EAF0FF] to-white` + `bg-white rounded-2xl shadow-lg p-8`) |
| **Session error / closed screens** | resume-practice.tsx:84-141 vs resume-review.tsx:82-140 |
| **Open-session row** | practice.tsx:341-418 vs review.tsx:248-316 |
| **Filter chip** | practice.tsx:472-476,530-534,561-565; review.tsx:435-439,473 (ui `toggle-group.tsx` exists and is unused) |
| **Progress bar** | local at lyceon-dashboard.tsx:81-99 vs ui `Progress` in PracticeShell.tsx:103 |
| **Tabs** | ui `tabs` (UserProfile.tsx:8, notifications.tsx:38) vs hand-built `ScoreTabs` (ExamReportPage.tsx:142-196) |
| **Modal / sheet** | ui `dialog`, `sheet`, `alert-dialog` vs calendar SettingsSheet.tsx:270, SetupPopup.tsx:273, BlockSheet.tsx:116, CreateBlockSheet.tsx:137 |
| **Skeleton** | ui `skeleton` vs CalendarSkeleton (CalendarStates.tsx:26) |
| **Radio** | ui `radio-group` (unused) vs raw radio in TestsHomePage.tsx:180 |
| **Tutor conversation list** | chat.tsx sidebar (:149-224) vs tutor.tsx list (:113-128); both call GET `/api/tutor/conversations?surface=standalone&status=active` |
| **`/api/profile` query** | the same key `["/api/profile"]` has three `queryFn` definitions: RequireRole.tsx:44-62; profile-complete.tsx:100-110; UserProfile.tsx:130-133 (default) |
| **`/api/billing/status` query** | two keys: `["/api/billing/status"]` (UserProfile.tsx:142) and `["billing-status"]` (PremiumUpgradePrompt.tsx:153) |
| **Brand colors as raw hex** | `#0F2E48` / `#FFFAEF` in DiagnosticCTACard.tsx, DiagnosticPromptModal.tsx, AppNotice.tsx:34-35 and profile-complete.tsx:248, while tokens `brand-navy` / `brand-cream` exist (tailwind.config.ts:17-19). `#EAF0FF` / `#3C6DF0` (App.tsx:383,393) match no token |
| **Local wire types without a shared Zod schema** | `KpiResponse` (lyceon-dashboard.tsx:42-63, practice.tsx:87-98); `PracticeTopics` (practice.tsx:79-85, browse-topics.tsx:17-23); `SessionState` / `ReviewSessionState` (resume-practice.tsx:47-56, resume-review.tsx:43-52) |

### 6.3 Exam and calendar compared with the majority shell (intentional; described, not judged)

| Aspect | Majority (AppShell pages) | Exam runtime (`/tests/:id…`) | Calendar (`/calendar`) |
|---|---|---|---|
| Shell | AppShell: sticky `h-16` header, logo → `/dashboard`, 6 nav links, bell, user menu (app-shell.tsx:148-238) | Local header per page: non-link serif wordmark + mode or name (session, report), or section/timer/tools bar (module). No nav, bell, user menu or exit link in the module | Dark 248px left rail with brand (Chrome.tsx:96-99; hidden ≤900px, calendar.css:918-925) + top bar with "← Dashboard" (Chrome.tsx:315-321). No bell or user menu |
| Styling system | Tailwind + shadcn tokens (index.css, styles/tokens.css) | Tailwind utilities + `--exam-*` variables scoped to `.exam-root` (features/exam/exam.css:6-20), consumed as `bg-[var(--exam-…)]` | Plain CSS, 1,636 lines, scoped to `.lyceon-calendar` (calendar.css); no Tailwind in calendar TSX. The header comment (:1-24) says it derives from `docs/design/calendar-prototype.html` |
| Palette | shadcn `--primary` etc. | Warm greys; accent `#1b4b8f` | `--ink`, `--rail`, `--math`, `--rw`, `--rev` (calendar.css:27-57); block colors also in tokens.css:85-88 |
| Type | Poppins / Inter (index.css:1,51) | Headings `font-serif` = Georgia (tokens.css:33); timers `font-mono` | Inter 14px; headings request "Bricolage Grotesque" (not loaded) |
| Components | `components/ui` | Raw `<button>`/`<input>`; only ui `dialog` and `alert-dialog`, re-skinned | No `components/ui`; `.btn`, `.sheet`, `.scrim`, `.modal` |
| Height model | `min-h-screen`, page scroll | module `h-screen` fixed; session and report `min-h-screen` | `.app {height:100vh; overflow:hidden}` with internal scroll |
| Focus ring | shadcn `ring` | 3px `--exam-accent` outline (exam.css:22-28) | 2px `--math` outline (calendar.css:82-87) |
| Dark mode | `.dark` (index.css:69) | none | none |
| Entitlement denial | varies (see §3a) | 403 → generic "not available" (ExamStatus.tsx:19-20) | 402 → CalendarPremiumGate (CalendarStates.tsx:22-24) |

`/tests` (TestsHomePage) is a hybrid: AppShell on the outside, `.exam-root` tokens and serif type inside (TestsHomePage.tsx:62-63).

---

## 7. Open questions

1. **Branch.** The brief says `main`; this session's designated branch is `review`. `main` @ d2902eec was audited. Should `review` (0ed3eb1) be audited too?
2. **Is `/tutor` a student surface?** It is RG-gated in the SPA (App.tsx:135-142), has no in-app link, and is reached only from the public `/trust` pages. `server/seo-content.ts:796` also registers `/tutor` as a server-rendered public page (lib/analytics-surface.ts:46-50). Which of the two is the intended page at that URL?
3. **Email-only pages.** `/update-password` and `/account/recover` are reached only from server-sent email links. The brief's classes count them as URL-ONLY. Should server-built links (emails, notification `href`s, calendar-launch `next`) count as inbound references?
4. **Return-path allowlist.** `RETURN_PATH_ALLOWLIST` (packages/shared/src/return-path.ts:24-47) omits `/calendar`, `/tests` and `/tutor`. So a signed-out deep link to those, including the notification-email links to `/calendar` (server/lib/notifications/templates/full-length.ts:83,145,174), lands on `/dashboard`. `/profile/complete` also drops `?next=` (profile-complete.tsx:177). Is either intended?
5. **Entitlement status codes differ by surface.**

   | Surface | Denial behavior |
   |---|---|
   | Exam | 403 (exam-runtime-routes.ts:138-146) |
   | Calendar | 402 (calendar-routes.ts:179-197) |
   | Practice | 402 usage quota |
   | Tutor | its own predicate, `isEntitlementActiveForProfile` (tutor-runtime.ts:210), rather than `canAccessFeature` |
   | `/api/progress/*` | 200 with a degraded payload |

   Which of these are specified in `docs/Spec`? This audit did not cross-check them against the spec.
6. **`PUT /api/calendar/profile`** (calendar-routes.ts:555-572) has no calendar entitlement check. Is that intentional?
7. **Admins on `/tests`.** The client allows admins (App.tsx:36-63). Whether an admin passes `canAccessFeature(exam_full_length)` was not traced into `EntitlementService`. Unverified.
8. **`/api/auth/callback`** (server/index.ts:405) is labeled a "Vercel alias". Whether Express receives `/auth/callback` or `/api/auth/callback` after the `vercel.json:45-48` rewrite is not pinned anywhere in the repo. Unverified.
9. **Server routes on Vercel.** `vercel.json:40-56` sends only `/api/*` and `/auth/callback` to the function. So the server-rendered public routes, `/legal/:slug`, `/privacy`, `/terms` and `/healthz` (server/index.ts:349-353,781-789) are served only when running `app.listen`. Is the production target Vercel only? Unverified from the repo.
10. **Internal endpoints with no producer.** `/api/internal/async/memory-refresh` and `/async/pending-reconciliation` have handlers and OIDC guards, but no enqueuer in code or terraform; their queues appear only as comments in infra/terraform/cloud-tasks.tf:10-11. Should they count as SYSTEM (planned) or UNREFERENCED?
11. **Rendering not verified in a browser.** Two effects are proven by grep only:
    - `bg-primary-container` (practice.tsx:892) is not a defined token.
    - The calendar loading, error and premium states render outside `.lyceon-calendar`, and headings request an unloaded font.

    Should a rendered screenshot pass be part of this step?
12. **Invariant and coding-standard hits seen in passing.** Should they be filed separately? This audit is read-only, and they are recorded here only.

    | Issue | Where |
    |---|---|
    | `any` | RequireRole.tsx:30; App.tsx:376; lib/runtime-contract-disable.ts:42; practice.tsx:196,199,749,775; server/routes/legal-routes.ts:175; server/routes/supabase-auth-routes.ts:89 |
    | Silent `catch {}` | server/routes/legacy/progress.ts:111 (sets false, no log); server/routes/guardian-routes.ts:75; billing-routes.ts `/publishable-key` |
    | `console.*` in production code | App.tsx:377; CanonicalPracticePage.tsx:321; home.tsx:92,126; SupabaseAuthContext.tsx:99,141,146,185,199 |
    | Raw `error.message` shown to the user | App.tsx:389 |
    | `/api/questions/recent` is anonymous | server/index.ts:537. It selects `QUESTION_SAFE_SELECT`, which excludes answer columns per pass2-A; this pass did not re-read that selector |
    | `/api/billing/publishable-key` is unauthenticated | billing-routes.ts:1050 |

13. **`RuntimeContractDisabledCard`** (CanonicalPracticePage.tsx:451-455) branches on `*_DISABLED_BY_CONTRACT` codes that no server code emits (pass1-C §5 grep). Is that branch retained on purpose?
