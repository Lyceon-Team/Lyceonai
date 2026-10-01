# Pass 1-A — Student page inventory (origin/main @ d2902eec)

Snapshot root: `scratchpad/main`. All paths below are relative to `client/src/` unless prefixed.
Read-only audit; nothing in the repo was modified.

## 0. Shared scaffolding (applies to every page below)

### Global wrapper chain (App.tsx:422-447)
`ErrorBoundary` (App.tsx:363-403) > `HelmetProvider` (425) > `QueryClientProvider` (426) > `SupabaseAuthProvider` (427) > `UIProvider` (428; mounts `<Toaster/>`, components/providers/ui-provider.tsx:14) > `DeletionGate` (413-420; swaps in `PendingDeletionScreen` when `user.pendingDeletion`) > `Router` > `Suspense fallback={<PageLoader/>}` (113; PageLoader App.tsx:98-107) > `Switch` > `Route` > `RequireRole allow={["student","admin"]}` > page. `<Analytics beforeSend={analyticsBeforeSend}/>` sits beside the tree (App.tsx:444).

All nine routes use an **inline arrow** `component={() => (<RequireRole>…)}`. App.tsx:30-31 says wrappers should be module-scope so a Switch re-render never remounts; only the exam routes (App.tsx:36-63) follow that. Inline arrows on all 9 student routes (136, 156, 164, 172, 180, 197, 260, 277, 285).

### RequireRole (components/auth/RequireRole.tsx)
- Loading: full-screen spinner `min-h-screen … border-primary` (68-76) while `authLoading || profileLoading`. It fetches `GET /api/profile` via `csrfFetch` (47-63).
- No user: `<Redirect to={loginPathWithReturn(intended)}>` (79-89).
- Wrong role: guardian goes to `/guardian`; any other role goes to `/dashboard` (101-108).
- Onboarding: redirects to `/profile/complete` when `guardianConsentRequired || requiredProfileComplete===false || !profileCompletedAt` (126-133).
- Renders `children` plus an optional `ReconsentModal` (164-177).
- Uses `[key: string]: any` (RequireRole.tsx:27).

### Shells
| Shell | File | Nav/header | Container |
|---|---|---|---|
| `AppShell` | components/layout/app-shell.tsx:57-79 | `AppHeader` (81-240): sticky header; desktop `<nav>` from `navItems` (41-50: Dashboard, Calendar, Practice, Tests, Review, Lisa→/chat); `NotificationBell`; mobile `Sheet`; `HeaderUserMenu`. Optional `Footer`. | header inner `container mx-auto px-4 sm:px-6 lg:px-8` (153); `<main id="main" className="flex-1 …">` |
| `PracticeShell` | components/layout/PracticeShell.tsx | Own sticky header (49-107): back `Button` doing `window.location.assign(backLink)` (58), eyebrow `text-[10px] … tracking-[0.2em]` (63), `h1 text-lg sm:text-xl font-bold` (66), accuracy/streak/progress pills, `Progress`. **No global nav.** | `container mx-auto px-4 py-4 max-w-7xl` or `max-w-[1600px]` when `wide` (41, 50, 109) |
| `primitives.tsx` (`PageShell/Container/Section/Card/Hero/Breadcrumb`) | components/layout/primitives.tsx | none | Used only by public pages (home, blog, digital-sat*). **None of the 9 student pages use it.** |

`AppShell` nav marks active with `location.startsWith(href)` (app-shell.tsx:112-113), so `/practice/topics` and `/practice/session/*` would highlight "Practice", but session pages do not render AppShell at all.

### Default query function
`useQuery({queryKey:[url]})` with no `queryFn` uses `getQueryFn({on401:"throw"})` (lib/queryClient.ts:95-128). It joins the queryKey with `/` and calls `fetchWithSessionRefresh(url)`.

---

## 1. `/dashboard` — pages/lyceon-dashboard.tsx

| Field | Finding |
|---|---|
| Route | `/dashboard`, App.tsx:155-162 (path at 156); lazy import App.tsx:27 |
| Layout chain | Global chain > `RequireRole[student,admin]` > `AppShell showFooter` (lyceon-dashboard.tsx:188) > content div |
| Nav/shell | `AppShell` → `AppHeader` (app-shell.tsx:81) + `Footer` (app-shell.tsx:77) |
| Container | `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl` (189). Grids: `grid grid-cols-1 lg:grid-cols-12 gap-6 mb-10` (224), `lg:col-span-8` (225) / `lg:col-span-4` (270); `grid sm:grid-cols-2 gap-8` (234); `grid grid-cols-1 md:grid-cols-2 gap-4 mb-10` (391); `grid grid-cols-1 lg:grid-cols-12 gap-6` (423), `lg:col-span-7` (424) / `lg:col-span-5` (482) |
| Typography | H1 `text-3xl md:text-4xl font-semibold tracking-tight` (191-196); eyebrows `text-xs uppercase tracking-[0.18em] … font-semibold` (229, 236, 251, 273); KPI numerals `text-5xl font-semibold leading-none` (242, 257, 342, 359); H2 `text-2xl font-semibold tracking-tight` (399, 414); H2 `text-3xl font-semibold tracking-tight` (428, 485). All raw classes; no shared heading component |
| Components (ui) | `Button` (7), `Card`/`CardContent` (8), `Skeleton` (9) |
| Components (other) | `PremiumUpgradePrompt` (components/billing/PremiumUpgradePrompt.tsx), `RecoveryNotice` → `AppNotice` (components/feedback/), `DiagnosticPromptModal` (ui `Dialog`), `DiagnosticCTAGate` → `DiagnosticCTACard` |
| Local components | `ScoreSnapshotRow` (65-102): local progress bar (`h-2 rounded-full bg-muted/60` + inline width). It duplicates ui `Progress`, which PracticeShell uses. Two action tiles are hand-built `Link` cards `rounded-xl border border-border/40 bg-card … p-6 min-h-[190px]` (392-420) instead of `Card`. Local "Alpha" pill span (488) |
| Loading | `Skeleton` for KPI (239-240, 254-255), estimate (281-285, 448-453) |
| Empty | "No data" row in `ScoreSnapshotRow` (74-83); "-" accuracy when 0 questions (258); fallback "Start practicing to unlock a score estimate" (376-386) |
| Error | `kpiError` → `RecoveryNotice` with `window.location.reload()` retry (203-210). `estimateError` is destructured (121) and **never read**: a projection failure falls through to the generic "Start practicing" fallback (376-386). Diagnostic start error shown inline `role="alert"` (315-322) |
| Entitlement | `estimateStatus==="baseline_only"` → frozen baseline + "View Plans" button → `resolveCtaDestination` (339-355, 183-185); `PremiumUpgradePrompt featureBenefit="your detailed score breakdown"` (454-459). No 402/403 path (comment 129-131: server returns 200 with a discriminator) |
| Hardcoded styling | 0 hex in page. 10 arbitrary/inline: `style={{width}}` 97; `tracking-[0.18em]` 229, 236, 251, 273, 488; `min-h-[190px]` 394, 409; `text-[10px]` 488; `tracking-[0.16em]` 512. Children: DiagnosticCTACard.tsx hex `#0F2E48`/`#FFFAEF` ×9 occurrences (45, 49, 50, 56, 64, 83); DiagnosticPromptModal.tsx 94, 96, 122; AppNotice.tsx 34-35. `tailwind.config.ts:17-19` already defines `brand-cream #FFFAEF` / `brand-navy #0F2E48` |
| Data fetching | `useQuery ["/api/progress/kpis"]` default fetcher, `refetchInterval 60000` (112-116); `useQuery ["/api/progress/projection"]` with `fetchScoreEstimate` → `apiRequest("/api/progress/projection")` (122-127; lib/projectionApi.ts:122); `useDiagnosticStart` → `csrfFetch("/api/practice/diagnostic/sessions")` POST (hooks/useDiagnosticStart.ts:54); `PremiumUpgradePrompt` → `csrfFetch("/api/billing/status")` (PremiumUpgradePrompt.tsx:155) |
| Other | `interface KpiResponse`/`KpiMetric` declared locally (26-63). practice.tsx:87-98 re-declares a narrower `KpiResponse`, so the same wire shape is typed twice with no shared Zod schema |

**Outbound nav**
- `setLocation('/practice/session/${id}')` 148 (diagnostic start)
- `setLocation(resolveCtaDestination(...))` 184 → `/upgrade` (lib/billing-cta.ts:41)
- `window.location.reload()` 208
- `<Link href="/practice">` 383, 393
- `<Link href="/review">` 408
- `<Link href="/mastery">` 436
- `<Link href="/chat">` 519
- Via children: DiagnosticPromptModal.tsx:76 and DiagnosticCTACard.tsx:39 → `/practice/session/:id`; PremiumUpgradePrompt `navigate(copy.action.to)` (190) → `/upgrade`, or opens the billing portal

**Inbound references to `/dashboard`**
- AppShell nav app-shell.tsx:44; logo app-shell.tsx:159
- RequireRole.tsx:105, 107 (wrong-role redirect)
- PublicNavBar.tsx:45
- PendingDeletionScreen.tsx:49, 55 (`window.location.assign`)
- ExamReportPage.tsx:92
- home.tsx:207, 814
- update-password.tsx:74; login.tsx:42; profile-complete.tsx:80, 220; guardian-dashboard.tsx:340; upgrade.tsx:117
- calendar.tsx:146, 196 (`backHref`)
- resume-practice.tsx:160 (diagnostic `completionHref`)
- Orphaned (no importer): components/navigation.tsx:59, 89; components/NavBar.tsx:35

---

## 2. `/chat` — pages/chat.tsx

| Field | Finding |
|---|---|
| Route | `/chat`, App.tsx:163-170 (path 164); lazy App.tsx:28 |
| Layout chain | Global chain > `RequireRole` > page root `div.flex.h-screen` (461 / 503). **No AppShell and no global nav** |
| Nav/shell | Page-local: desktop `<aside className="hidden md:flex w-72 …">` (463, 505) holding `SessionsListContent` (149-224); mobile `Sheet` drawer (470-484, 515-529); page-local `<header>` (469, 512). **No link back to /dashboard or any other app page**: outbound nav is limited to `/chat?…` and the conditional `SuggestedActionLink`. The user leaves via the browser back button |
| Container | Full-bleed `flex h-screen` (461, 503); sidebar `w-72`; message area `flex-1 overflow-y-auto p-4 space-y-4` (560); empty `flex-1 … items-center justify-center gap-6 p-8` (487, 493). No max-width |
| Typography | Sidebar brand `text-lg font-semibold` (169, 485); H2 `text-2xl font-semibold` (239); H2 `text-xl font-semibold` (430); H1 `text-base font-semibold truncate` (532) |
| Components (ui) | `Button`, `Dialog*` (EndSessionModal 101-143), `Sheet`/`SheetContent`/`SheetTrigger`; via TutorThreadParts: `Button`, `Textarea` (TutorThreadParts.tsx:28-29) |
| Components (other) | TutorThreadParts: `Composer`, `CrisisSupportCard`, `FailedTurnNotice`, `LisaAvatar`, `MessageBubble`, `PausedBar`, `SuggestedActionLink`, `ThinkingIndicator`. `LisaUpgradeCard` → `PremiumUpgradePrompt` |
| Local duplicates | Raw `<button>`s styled as buttons instead of ui `Button`: "New session" 172-185, session rows 195-213, Math / R&W chips 247-260. Also raw buttons in TutorThreadParts (FailedTurnNotice 195) |
| Loading | Conversation: `Loader2` `role="status"` (567-576). Session list: no loading state (renders "No sessions yet" 216-220 while loading) |
| Empty | No conversation: welcome + "New session" (424-455); new conversation → `NewSessionView` (230-264, 401-407, 579-583); "No sessions yet" (216-220) |
| Error | Create failure (non-entitlement): inline `role="alert"` text (449-453). Turn failure: `FailedTurnNotice` retry (609-611). **Non-entitlement `conversationError` / `conversationsError` are not rendered**: a 500 on the list or detail shows as an empty list or blank thread |
| Entitlement | `denied` = `isLisaEntitlementDenial(...)` on list, detail, create, or `premiumReason` (315-319) → `LisaUpgradeCard` replaces the empty state (424-425) and the composer (632-633); the sidebar is `locked` (175) |
| Crisis | `CrisisSupportCard` (613-619); `PausedBar` replaces composer (625-631) |
| Hardcoded styling | 0 hex, 0 `style`. 12 arbitrary: `min-h-[44px]` 127, 134, 176, 199, 250, 257, 440, 476, 520, 550; `min-w-[44px]` 476, 520. Children (TutorThreadParts.tsx): `max-w-[75%]` 139; `[animation-delay:*]` 170-172; `min-h/min-w-[44px]` 195, 245, 259, 327, 336, 393, 401, 449; palette colors emerald/purple 220-221 |
| Data fetching | hooks/tutor-client.ts (`apiRequest` base `/api/tutor`, 178-184): `useConversation` GET `/api/tutor/conversations/:id`; `useConversations` GET `/api/tutor/conversations?surface=standalone&status=active`; `useCreateConversation` POST `/api/tutor/conversations` (with `idempotency_key: crypto.randomUUID()` chat.tsx:354); `useEndConversation` POST `/api/tutor/conversations/:id/end`; `useTutorTurn` → `useSendMessage` POST `/api/tutor/messages`, `useResumeConversation` POST `/api/tutor/conversations/:id/resume` |

**Outbound nav**
- `setLocation('/chat?conversationId=…')` 334
- `setLocation("/chat")` 387
- `SuggestedActionLink` raw `<a href="/practice">` (TutorThreadParts.tsx:447-448, `PRACTICE_HANDOFF_HREF` 432): full page load, not wouter
- `PremiumUpgradePrompt` → `/upgrade` or billing portal

**Inbound references to `/chat`**
- AppShell nav app-shell.tsx:49 (label "Lisa")
- lyceon-dashboard.tsx:519
- tutor.tsx:50
- Orphaned: navigation.tsx:110; test-options.tsx:79

---

## 3. `/tutor` — pages/tutor.tsx

| Field | Finding |
|---|---|
| Route | `/tutor`, App.tsx:135-142 (path 136); lazy App.tsx:91 |
| Layout chain | Global chain > `RequireRole` > `div.mx-auto.flex.h-screen.max-w-2xl.flex-col.p-4` (75). **No AppShell, no nav, no back link** |
| Nav/shell | None |
| Container | `mx-auto flex h-screen max-w-2xl flex-col p-4` (75) |
| Typography | H1 `text-2xl font-bold` (77); rows `text-sm font-medium` / `text-xs text-muted-foreground` (119-125) |
| Components (ui) | `Button` (22), `Card` (23), `useToast` (24) |
| Loading | `Loader2` (92-96) |
| Empty | `Card` "No conversations yet…" (104-108) |
| Error | List error: `Card` `text-destructive` generic copy (98-102). Create error: destructive toast via `classifyTutorError` / `toUserFacingMessage` (60-71) |
| Entitlement | **Not handled as a gate.** A tutor-entitlement 403 on the list shows the generic "Could not load your conversations" card (98-102). No `LisaUpgradeCard`, unlike chat.tsx and ScopedTutorPanel. The New Conversation button stays enabled |
| Hardcoded styling | none (0 hex, 0 arbitrary, 0 style). grep count 0 |
| Data fetching | `useConversations` GET `/api/tutor/conversations?surface=standalone&status=active`; `useCreateConversation` POST `/api/tutor/conversations` called **without** `idempotency_key` (55-58). chat.tsx:354 sends one; the schema marks it optional (packages/shared/src/tutor-lifecycle-schema.ts:40) |
| Other | Conversation rows are clickable `Card`s with `onClick` (113-128): not a link or button, so there is no keyboard or focus semantics. `CreateConversationInput` is a hand-written type (hooks/tutor-client.ts:59-66) alongside a Zod schema in packages/shared (tutor-lifecycle-schema.ts:40-58). Overlaps functionally with chat.tsx's sidebar (same list endpoint) |

**Outbound nav**
- `setLocation('/chat?conversationId=…')` 50

**Inbound references to `/tutor`**
- Only public pages: trust.tsx:159; trust-evidence.tsx:170 (`href="/tutor"`)
- **Not in `navItems`**; no in-app student link
- lib/analytics-surface.ts:46-50 documents that `/tutor` is also a server-rendered public "Tutor Transparency" page, so two pages live at one URL

---

## 4. `/practice` — pages/practice.tsx

| Field | Finding |
|---|---|
| Route | `/practice`, App.tsx:171-178 (path 172); lazy App.tsx:29. Also the redirect target of `/practice/math`, `/practice/reading-writing`, `/practice/random` (App.tsx:187-195) and two legacy paths (App.tsx:253-258) |
| Layout chain | Global chain > `RequireRole` > `AppShell showFooter` (313) > content |
| Nav/shell | `AppShell` header + Footer |
| Container | `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl` (314); `grid grid-cols-1 lg:grid-cols-12 gap-6` (332); main `lg:col-span-8 space-y-6` (333); aside `lg:col-span-4 space-y-6` (804); `grid sm:grid-cols-2 gap-4` (639); `grid sm:grid-cols-2 gap-3` (721) |
| Typography | Eyebrow `text-xs font-semibold uppercase tracking-[0.2em]` (316); H1 `text-4xl font-bold tracking-tight` (319-324); section labels `text-xs font-semibold uppercase tracking-widest` (461, 491, 550, 740, 766); card titles via `PageCard` → ui `CardTitle` |
| Components (ui) | `Button`, `Badge`, `Select*`, `Skeleton`, `AlertDialog*` (374-406) |
| Components (other) | `PageCard` (components/common/page-card.tsx, a thin wrapper over ui `Card`); `RecoveryNotice`; `PremiumUpgradePrompt`; `DiagnosticCTAGate` |
| Local duplicates | Filter chips are raw `<button>`s repeated 3× with near-identical class strings (468-479, 526-537, 557-568). Badge-remove raw `<button>`s (591-596, 606-611, 621-626), "Clear all" raw button (629-634). Local amber alert box (674-678) instead of `AppNotice variant="warning"`. Stat rows `rounded-lg bg-secondary/60 px-4 py-3` repeated (833, 852, 868) |
| Loading | Skeleton chips (515-520), Skeleton grid (720-726), "--"/"—" placeholders (280, 288, 858-864, 874-881, 898) |
| Empty | "No math domains published yet." (743-746); "No reading & writing domains…" (769-772); "No weekly KPI activity recorded yet." (884-888); "No questions available yet" (901-903) |
| Error | `RecoveryNotice` for `practiceHook.error` (693-698), stats (700-711), topics (727-736), KPIs (810-822). Messages are the raw `(err as Error).message` (704, 731, 814). Active-sessions error from `useActiveSessions` is not surfaced |
| Entitlement | `practiceHook.quotaExhausted` → `PremiumUpgradePrompt featureBenefit="unlimited daily practice"` (689-691) |
| Session limit | `activeSessions.length >= 5` is hardcoded (641, 662, 673-678), although `maxConcurrentSessions` from the server is shown in copy at 430 (`?? 5`) |
| Hardcoded styling | 0 hex, 0 `style`. 12 arbitrary: `tracking-[0.2em]` 316, 894; `text-[10px]` 361, 588, 603, 618, 631; `text-[11px]` 483, 542, 572; `max-w-[140px]` 603, 618. Palette literals `emerald/amber/red-*` 108-119, 674. **`bg-primary-container` (892) is not a defined color**: tailwind.config.ts:15-60 has no `primary-container`, and grep finds it nowhere else, so the class emits no CSS and the "Question Bank" card keeps ui `Card`'s default background while its text is `text-primary-foreground` (contrast unverified visually) |
| TS escape hatches | `any` at 196, 199, 749, 775 (`(s: any)`, `(domain: any)`) — Coding Standards §3.2 violation |
| Data fetching | `useQuery ["/api/questions/stats"]` (144-147); `["/api/practice/topics"]` (164-167); `["/api/progress/kpis"]` (175-178); `["/api/progress/projection"]` via `fetchScoreEstimate` (186-191); `useStreak` → GET `/api/me/streak` (features/calendar/api/client.ts:45); `useActiveSessions` → GET `/api/practice/sessions/open`, POST `/api/practice/sessions/:id/terminate` via `csrfFetch` (hooks/useActiveSessions.ts:42-49); `usePractice().startSession` → `apiRequest("/api/practice/sessions")` POST (hooks/usePractice.ts:255); `PremiumUpgradePrompt` → `/api/billing/status` |

**Outbound nav**
- `setLocation('/practice/session/${newId}')` 246
- `setLocation('/practice/session/${s.id}')` 410
- `<Link href="/practice/topics">` 793
- `<Link href="/review">` and `<Link href="/mastery">` via `secondaryActions` 297-310 → 920
- DiagnosticCTACard.tsx:39 → `/practice/session/:id`
- PremiumUpgradePrompt → `/upgrade`

**Inbound references to `/practice`**
- AppShell nav app-shell.tsx:46; PracticeShell.tsx:34 default back
- engine-config.ts:191-192
- lyceon-dashboard.tsx:383, 393; review.tsx:187; mastery.tsx:148, 297
- browse-topics.tsx:124
- resume-practice.tsx:105, 134, 180, 195
- TutorThreadParts.tsx:432
- home.tsx:189, 805; blog-post.tsx:139
- Orphaned: navigation.tsx:96; NavBar.tsx:33; progress-sidebar.tsx:136; test-options.tsx:44

---

## 5. `/practice/topics` — pages/browse-topics.tsx

| Field | Finding |
|---|---|
| Route | `/practice/topics`, App.tsx:179-186 (path 180); lazy App.tsx:71 |
| Layout chain | Global chain > `RequireRole` > `AppShell` (**no `showFooter`**, 119) |
| Nav/shell | `AppShell` header, no footer. Page-local "Back to Practice" ghost `Button asChild Link` (123-128) |
| Container | `container mx-auto px-4 py-8 max-w-6xl` (120). This differs from its siblings (`max-w-7xl`, `px-4 sm:px-6 lg:px-8`) |
| Typography | H1 `text-3xl font-bold` (130); raw `<label className="text-sm font-medium">` ×4 (155, 177, 202, 224), not ui `Label` (components/ui/label.tsx exists); H3 `text-xl font-semibold` (284) |
| Components (ui) | `Button`, `Select*`, `Skeleton`, `Card`/`CardContent`, `Badge`; `MathRenderer` |
| Components (other) | `PageCard`, `RecoveryNotice` |
| Loading | Skeletons (139-144, 264-271) |
| Empty | "No Questions Found" `PageCard` with icon + reset (280-292) |
| Error | Topics: `RecoveryNotice` with `window.location.reload()` (145-150). Search: `RecoveryNotice` inside `PageCard title="Error"` (272-279) |
| Entitlement | not handled (no 402/403 branch) |
| Hardcoded styling | none: 0 hex, 0 arbitrary, 0 style |
| Data fetching | `useQuery ["/api/practice/topics"]` (57-59; no `enabled: !!user` guard, unlike practice.tsx:166). `useQuery` + `apiRequest('/api/practice/reference/questions?section&domain&skill&limit')`, `enabled:false`, manual `refetch` (72-93) |
| Other | Unused import `AlertCircle` (10). Anti-leak surface: shows `stem` and option count only (316-325); the response type has no `correct_answer`/`explanation` fields (25-33), but the server payload was not verified in this pass |

**Outbound nav**
- `<Link href="/practice">` 124
- `<Link href="/practice/math">` 336 and `<Link href="/practice/random">` 337. **Both are redirect-only routes** (App.tsx:187-195 → `/practice`), so "section practice" and "mixed practice" copy links to a page that has no such modes

**Inbound references to `/practice/topics`**
- practice.tsx:793 only. Not in `navItems`

---

## 6. `/practice/session/:sessionId` — pages/resume-practice.tsx (+ components/practice/CanonicalPracticePage.tsx)

| Field | Finding |
|---|---|
| Route | `/practice/session/:sessionId`, App.tsx:196-203 (path 197); lazy App.tsx:72; `useRoute` resume-practice.tsx:59 |
| Layout chain | Global chain > `RequireRole` > loading, error, closed, or unknown-section branches as bare `div.flex.h-screen` (77, 92, 121, 172) **with no shell**. Otherwise `CanonicalPracticePage` (154-161 diagnostic, 190-196 regular) > `PracticeShell` (CanonicalPracticePage.tsx:809-830) |
| Nav/shell | `PracticeShell` header only (back `Button` → `window.location.assign(engine.backHref)`, PracticeShell.tsx:58). No AppShell nav |
| Container | PracticeShell `container mx-auto px-4 py-6 max-w-7xl` (PracticeShell.tsx:109). Inner layouts: `grid grid-cols-1 lg:grid-cols-12 gap-6 items-start` with `lg:col-span-8` card (CanonicalPracticePage.tsx:672-673); resizable split `min-h-[600px]` (641, 733); tutor column `lg:sticky lg:top-24` with inline px height and width (770-778) |
| Typography | PracticeShell H1 `text-lg sm:text-xl font-bold` (66); error H1 `text-2xl font-bold text-red-600` (93, 173); closed H1 `text-2xl font-semibold` (125); runner H3 `text-lg font-semibold text-amber-900` / `text-red-900` (CanonicalPracticePage.tsx:464, 484); eyebrows `text-xs uppercase tracking-[0.2em]` (620, 679, 712) |
| Components (ui) | via Canonical: `Card`, `Button`, `Badge`, `Resizable*`; PracticeShell: `Button`, `Progress` |
| Components (other) | `QuestionRenderer`, `DesmosCalculator`, `MathReferenceSheet`, `RuntimeContractDisabledCard`, `RecoveryNotice`, `ScopedTutorPanel` (only when `engine.features.tutor`; off for practice per CanonicalPracticePage.tsx:371-373) |
| Local duplicates | resume-practice.tsx renders raw `<button>`s with hand-rolled primary/outline classes (97-102, 104-109, 133-138, 179-184) instead of ui `Button`. The same three error / closed / unknown screens are copy-pasted in resume-review.tsx. Runner conflict and limit boxes are local amber/red panels (CanonicalPracticePage.tsx:462-493) instead of `AppNotice` |
| Loading | `Loader2` "Initializing session..." (75-82); runner `Loader2` "Loading your practice session..." (CanonicalPracticePage.tsx:456-460) |
| Empty | Runner "No questions available right now." + Check Again (CanonicalPracticePage.tsx:501-512) |
| Error | 404 vs generic (84-113); readOnly closed or abandoned (118-141); unknown section (170-187); runner: `RuntimeContractDisabledCard` (503 only, lib/runtime-contract-disable.ts:45), `CLIENT_INSTANCE_CONFLICT` takeover (461-480), `SESSION_LIMIT_EXCEEDED` (481-493), generic `RecoveryNotice message={String(error)}` (494-500), inline amber error (515-518) |
| Entitlement | **No 402/quota branch in the runner.** A non-OK `/next` becomes `Error("Failed to load next question (${status})")` (hooks/useCanonicalPractice.ts:489-490) and is shown raw via `RecoveryNotice` (CanonicalPracticePage.tsx:494-500). Whether the server returns 402 on `/next` is unverified from here |
| Hardcoded styling | Page: 0 hex, 0 arbitrary, 0 style; palette `text-red-600` 93, 173. CanonicalPracticePage.tsx: `text-[10px]` 398, 405, 414, 425; `max-w-[120px]` 425; `tracking-[0.2em]` 620, 679, 712; `min-h-[600px]` 641, 733; `style={{}}` 646, 662, 738, 754, 772; palette `slate/amber/red/emerald` 73-75, 457, 462-518. PracticeShell.tsx: `max-w-[1600px]` 41, `text-[10px]` 63, `tracking-[0.2em]` 63, `text-[11px]` 78 |
| Data fetching | `useQuery [\`/api/practice/sessions/${id}/state?client_instance_id=…\`]` default fetcher (68-73). Runner (`useCanonicalPractice` + `PRACTICE_ENGINE_CONFIG`, lib/engine-config.ts:147-156, via `csrfFetch`): POST `/api/practice/sessions`, POST `/api/practice/sessions/:id/resume`, GET `/api/practice/sessions/:id/next?client_instance_id=`, POST `/api/practice/answer`, POST `/api/practice/sessions/:id/skip`, POST `/api/practice/sessions/:id/terminate`, POST `/api/practice/sessions/:id/calculator-state` |
| Other | `console.error` in production code (CanonicalPracticePage.tsx:321-322, with an eslint-disable) — Coding Standards §16 |

**Outbound nav**
- `window.location.reload()` 98
- `window.location.assign("/practice")` 105, 134, 180
- Runner: `window.location.assign(completionDest)` (CanonicalPracticePage.tsx:307, 311); completion `/practice` or `/dashboard` for a diagnostic (resume-practice.tsx:160, 195)
- `window.location.assign(engine.backHref)` (474, 490)
- PracticeShell back (58)
- All are full page loads, not wouter navigation

**Inbound references to `/practice/session`**
- practice.tsx:246, 410; lyceon-dashboard.tsx:148; DiagnosticCTACard.tsx:39; DiagnosticPromptModal.tsx:76

---

## 7. `/review` — pages/review.tsx

| Field | Finding |
|---|---|
| Route | `/review`, App.tsx:276-283 (path 277); lazy App.tsx:73 |
| Layout chain | Global chain > `RequireRole` > `AppShell showFooter` (195) |
| Nav/shell | `AppShell` header + Footer |
| Container | `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl` (196); `grid grid-cols-1 lg:grid-cols-12 gap-6` (235); `lg:col-span-8` (236) / `lg:col-span-4` aside (582) |
| Typography | Eyebrow `text-xs uppercase tracking-widest` (198); H1 `text-3xl sm:text-4xl font-semibold tracking-tight` (201-206); H3 `text-lg font-semibold` (182); H4 `text-xs uppercase tracking-widest` (533). The practice eyebrow uses `font-semibold tracking-[0.2em]`, so the two eyebrows differ |
| Components (ui) | `Button`, `Badge`, `Skeleton`, `AlertDialog*`, `Select*` |
| Components (other) | `PageCard` |
| Local duplicates | Local empty state (176-192). Open-session row markup (248-316) is a near-copy of practice.tsx:341-418. Raw `<button>` chips (428-442, 461-476) and session-row buttons (538-570) |
| Loading | Skeletons (347-348, 520-521, 584-585) |
| Empty | `emptyState` "Nothing to review yet" (176-192, 349-350, 323-324 on `pool_empty`); "No past sessions with open questions." (522-525) |
| Error | Pool error: red `PageCard` with local red classes + retry (213-233); start failure amber `PageCard` (326-337). Open-sessions and topics query errors are not surfaced (topics `useQuery` 134-136 reads only `data`) |
| Entitlement | none. Copy states "Review is free and unlimited." (621) |
| Hardcoded styling | 0 hex, 0 arbitrary, 0 style. Palette literals: `border-red-200 bg-red-50` 216, `text-red-600` 222, `text-red-700` 224, `border-amber-200 bg-amber-50` 332, `text-amber-800` 334, `text-amber-700` 379 |
| Data fetching | hooks/useReview.ts via `csrfFetch`: `useReviewPool` GET `/api/review/pool?tz=…` (56, 78-97); `useActiveReviewSessions` GET `/api/review/sessions/open` (57, 150), POST `/api/review/sessions/:id/terminate` (158-159); `useCreateReviewSession` POST `/api/review/sessions` (237). Plus `useQuery ["/api/practice/topics"]` default fetcher (134-136) |

**Outbound nav**
- `setLocation('/review/session/${id}')` 170, 308
- `<Link href="/practice">` 187

**Inbound references to `/review`**
- AppShell nav app-shell.tsx:48
- lyceon-dashboard.tsx:408; practice.tsx:299
- engine-config.ts:248-249
- resume-review.tsx:106, 133, 149
- Orphaned: navigation.tsx:103; NavBar.tsx:34; progress-sidebar.tsx:147

---

## 8. `/review/session/:sessionId` — pages/resume-review.tsx

| Field | Finding |
|---|---|
| Route | `/review/session/:sessionId`, App.tsx:284-291 (path 285); lazy App.tsx:74; `useRoute` 55 |
| Layout chain | Global chain > `RequireRole` > bare `div.flex.h-screen` for loading, error, or closed (72, 90, 120) **with no shell**. Otherwise `CanonicalPracticePage engine={REVIEW_ENGINE_CONFIG}` (143-150) > `PracticeShell` (eyebrow "Review Runner", back `/review`; engine-config.ts:233, 248-250). `wide` is set when LISA is visible (CanonicalPracticePage.tsx:822) |
| Nav/shell | PracticeShell header only |
| Container | Same as §6; `max-w-[1600px]` when the tutor is visible (PracticeShell.tsx:41) |
| Typography | Same as §6; error H1 `text-2xl font-bold text-red-600` (94); closed H1 `text-2xl font-semibold` (124) |
| Components | Same as §6, plus `ScopedTutorPanel` (review has `features.tutor`) → `LisaUpgradeCard` on denial (ScopedTutorPanel.tsx:159-160, 210, 303, 396) |
| Local duplicates | Raw `<button>`s 98-103, 105-110, 132-137. The whole file mirrors resume-practice.tsx structure line-for-line (its header comment at 7 says so) |
| Loading | `Loader2` "Loading your review session..." (70-80) |
| Empty | Runner empty (as §6) |
| Error | 404 / generic (82-114); readOnly (117-140); runner branches as §6 |
| Entitlement | Runner: none for review. LISA panel: `LisaUpgradeCard` on tutor entitlement denial |
| Hardcoded styling | Page: 0 hex, 0 arbitrary, 0 style; `text-red-600` 94. Children as §6; ScopedTutorPanel.tsx `min-h-[480px]` 175, `min-h/min-w-[44px]` 196 |
| Data fetching | `useQuery [\`/api/review/sessions/${id}/state?client_instance_id=…\`]` (63-68). Runner via `REVIEW_ENGINE_CONFIG` (engine-config.ts:208-217): POST `/api/review/sessions`, POST `/api/review/sessions/:id/resume`, GET `/api/review/sessions/:id/next?client_instance_id=`, POST `/api/review/answer`, POST `/api/review/sessions/:id/skip`, POST `/api/review/sessions/:id/terminate`, POST `/api/review/sessions/:id/calculator-state`. LISA panel: tutor-client `useItemConversation` GET `/api/tutor/conversations?…`, `useCreateConversation`, `useConversation`, `useEndConversation`, send/resume |

**Outbound nav**
- `window.location.reload()` 99
- `window.location.assign("/review")` 106, 133
- Runner completion / back `/review` (149; engine-config.ts:248-249)

**Inbound references to `/review/session`**
- review.tsx:170, 308 only

---

## 9. `/mastery` — pages/mastery.tsx

| Field | Finding |
|---|---|
| Route | `/mastery`, App.tsx:259-266 (path 260); lazy App.tsx:92 |
| Layout chain | Global chain > `RequireRole` > `AppShell showFooter` (190) |
| Nav/shell | `AppShell` header + Footer. **Not in `navItems`** (app-shell.tsx:43-50). Page adds a "Back" button calling `window.history.back()` (194-202), which on a cold deep link leaves the app or does nothing useful |
| Container | `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl` (191). The other AppShell pages use `max-w-7xl`/`6xl`. Grid `grid grid-cols-1 sm:grid-cols-2 gap-4` (217, 254) |
| Typography | Eyebrow `text-xs uppercase tracking-[0.2em]` (203); H1 `text-4xl font-bold tracking-tight` (207); H2 `text-xl font-semibold tracking-tight` (94); card title `CardTitle text-base font-semibold` (263) |
| Components (ui) | `Button`, `Card`/`CardContent`/`CardHeader`/`CardTitle`, `Skeleton` |
| Components (other) | `LevelPill` (components/mastery/LevelPill.tsx:45), `PremiumUpgradePrompt`, `RecoveryNotice` |
| Local components | `SkillPanel` (55-156) |
| Loading | Skeleton grid (216-223); skill skeletons (97-103) |
| Empty | `catalog-empty` copy (113-125); single CTA "Start practising" when all unmeasured (292-300); panel CTA (145-151) |
| Error | Domains: `RecoveryNotice` (232-236); skills: `RecoveryNotice` (105-111) |
| Entitlement | `isEntitlementDenialError(error)` → `PremiumUpgradePrompt featureBenefit="your full mastery breakdown"` (225-230). Only for the domains query; a skills-query entitlement denial falls to the generic `RecoveryNotice` (105-111) |
| Hardcoded styling | 0 hex, 0 style; 1 arbitrary: `tracking-[0.2em]` 203 |
| Data fetching | `useQuery [studentResourceUrl(id,"masteryDomains")]` → `fetchMasteryDomains` → `apiRequest("/api/students/:id/mastery/domains")` (169-174; lib/masteryApi.ts:73-76; packages/shared/src/student-resources.ts:29, 32). `useQuery [… "masterySkills"]` → `apiRequest("/api/students/:id/mastery/skills")` (176-181; masteryApi.ts:91-94; student-resources.ts:33) |

**Outbound nav**
- `window.history.back()` 197
- `<Link href="/practice">` 148, 297
- PremiumUpgradePrompt → `/upgrade`

**Inbound references to `/mastery`**
- lyceon-dashboard.tsx:436; practice.tsx:305 only

---

## 10. Cross-page duplication and consistency findings

1. **Hand-rolled buttons instead of ui `Button`:**
   - chat.tsx:172, 195, 247, 254
   - practice.tsx:468, 526, 557, 591, 606, 621, 629
   - review.tsx:428, 461, 538
   - resume-practice.tsx:97, 104, 133, 179
   - resume-review.tsx:98, 105, 132
   - TutorThreadParts.tsx:195
   - App.tsx:392 (ErrorBoundary)
2. **Filter/topic chip pattern** is implemented at least 5 times with near-identical class strings: practice.tsx:472-476, 530-534, 561-565; review.tsx:435-439, 473. There is no shared `Chip`/`ToggleGroup` usage, although ui `toggle-group.tsx` exists.
3. **Open-session row** duplicated: practice.tsx:341-418 vs review.tsx:248-316.
4. **Session-page error / closed screens** duplicated: resume-practice.tsx:84-141 vs resume-review.tsx:82-140. Both are outside any shell and use raw buttons plus `text-red-600`.
5. **Empty states** are all local, with no shared EmptyState component:
   - review.tsx:176-192
   - browse-topics.tsx:281-292
   - chat.tsx:424-455, 216-220
   - tutor.tsx:104-108
   - CanonicalPracticePage.tsx:501-512

   PremiumUpgradePrompt.tsx:12 notes that `EmptyStateCTA` was absorbed, and grep finds only comments referencing it.
6. **Alert/notice boxes** are local where `AppNotice` exists (it has `warning`/`info` variants):
   - practice.tsx:674-678 (amber)
   - review.tsx:213-233 (red), 326-337 (amber)
   - CanonicalPracticePage.tsx:462-493, 502, 516
7. **Page header** (eyebrow + H1 + lede) is re-implemented per page with divergent classes:
   - dashboard 190-201 (no eyebrow, `text-3xl md:text-4xl font-semibold`)
   - practice 315-330 (`tracking-[0.2em] font-semibold`, `text-4xl font-bold`)
   - review 197-211 (`tracking-widest`, `text-3xl sm:text-4xl font-semibold`)
   - mastery 192-214 (`tracking-[0.2em]`, `text-4xl font-bold`)
   - browse-topics 122-135 (no eyebrow, `text-3xl font-bold`)
   - tutor 77 (`text-2xl font-bold`)

   There is no shared PageHeader. `primitives.tsx` `Hero`/`Section` is used only on public pages.
8. **Progress bar**: local in lyceon-dashboard.tsx:81-99 vs ui `Progress` in PracticeShell.tsx:103.
9. **Brand hex values** `#0F2E48` / `#FFFAEF` are hardcoded in DiagnosticCTACard.tsx, DiagnosticPromptModal.tsx and AppNotice.tsx:34-35, although tailwind tokens `brand-navy` / `brand-cream` exist (tailwind.config.ts:17-19). App.tsx ErrorBoundary uses `#EAF0FF` (383) and `#3C6DF0` (393), which match no token.
10. **Undefined token** `bg-primary-container` (practice.tsx:892).
11. **Container widths / padding**:

    | Page | Max width | Padding |
    |---|---|---|
    | dashboard, practice, review | `max-w-7xl` | `px-4 sm:px-6 lg:px-8` |
    | mastery | `max-w-5xl` | `px-4 sm:px-6 lg:px-8` |
    | browse-topics | `max-w-6xl` | `px-4` only |
    | tutor | `max-w-2xl` | `p-4` |
    | chat | full-bleed | — |
    | session pages | PracticeShell `max-w-7xl` / `1600px` | — |

12. **Shell coverage**:
    - AppShell: dashboard, practice, practice/topics (without footer), review, mastery.
    - None: chat, tutor, and the loading/error/closed branches of both session pages.
    - PracticeShell: session runners.
13. **Orphaned nav components** (zero importers; checked with `grep -rlnE "from ['\"][^'\"]*/<name>['\"]"`): components/navigation.tsx, components/NavBar.tsx, components/progress-sidebar.tsx, components/test-options.tsx. Each still hard-codes student hrefs, including progress-sidebar.tsx:159 `/practice/random`.
14. **Per-page `<title>`**: no `Helmet` or `document.title` in any of the 9 pages or CanonicalPracticePage, although `HelmetProvider` wraps the app.
15. **Local wire types without shared Zod**: `KpiResponse` (dashboard 42-63, practice 87-98), `PracticeTopics` (practice 79-85, browse-topics 17-23), `TopicsResponse` (review 99-101), `SessionState` (resume-practice 47-56) / `ReviewSessionState` (resume-review 43-52).

## 11. Grep commands used

```bash
cd scratchpad/main/client/src

# route lines
grep -n 'path="/\(tutor\|dashboard\|chat\|practice\|practice/topics\|practice/session/:sessionId\|review\|review/session/:sessionId\|mastery\)"' App.tsx

# per-file hex / arbitrary / inline-style counts
for f in <page and child files>; do
  echo "$f hex=$(grep -cE '#[0-9a-fA-F]{3,6}\b' $f) arb=$(grep -oE '[a-z:-]+-\[[^]]+\]' $f | wc -l) style=$(grep -c 'style={' $f)"
done

# per-file occurrences with line numbers
grep -noE '#[0-9a-fA-F]{3,6}\b|[a-z:-]+-\[[^]]+\]|style=\{' <file>

# palette literals
grep -n "text-slate\|text-red-\|bg-red-\|bg-amber\|text-amber\|bg-slate\|emerald\|purple\|sky-\|orange-" pages/*.tsx components/practice/CanonicalPracticePage.tsx

# inbound references (excluding tests and /api paths; App.tsx reported separately)
for p in /dashboard /chat /tutor /practice /practice/topics /practice/session /review /review/session /mastery; do
  grep -rnE "[\"'\`]${p}([\"'\`?/]|\\$)" --include=*.ts --include=*.tsx . \
    | grep -vE "\.test\.|__tests__|/api${p}" | grep -v "^\./App.tsx"
done

# orphan check
for c in navigation NavBar progress-sidebar test-options; do
  grep -rlnE "from ['\"][^'\"]*/$c['\"]" --include=*.tsx --include=*.ts .
done

# undefined token
grep -rn "primary-container" client/src
sed -n 15,60p tailwind.config.ts

# escape hatches
grep -n "any\b" pages/{...}.tsx | grep -E ": any|<any|as any"

# per-page titles
grep -ln "Helmet\|document.title" pages/{...}.tsx
```
