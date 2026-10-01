# Pass 1-B — Student page inventory (exam, calendar, account surfaces)

Snapshot: `origin/main` @ `d2902eec`, extracted at `scratchpad/main`. All paths below are relative to `client/src/` unless stated. READ-ONLY audit; nothing in the repo was modified.

---

## 0. Global wrapper chain (applies to every route below)

`App.tsx:424-430`, outermost first:

1. `ErrorBoundary` (class, `App.tsx:363`) — fallback UI at `App.tsx:383` uses `bg-gradient-to-b from-[#EAF0FF] to-white`, raw `<button>` with `bg-[#3C6DF0]`.
2. `HelmetProvider` (`App.tsx:425`)
3. `QueryClientProvider` (`App.tsx:426`)
4. `SupabaseAuthProvider` (`App.tsx:427`)
5. `UIProvider` (`App.tsx:428`, `components/providers/ui-provider.tsx` — mounts `ui/toaster` once, line 14)
6. `DeletionGate` (`App.tsx:413-420`) — if `user.pendingDeletion` and path ≠ `/account/recover`, renders `PendingDeletionScreen` **instead of** `<Router/>`.
7. `Router` → `Suspense fallback={<PageLoader/>}` (`App.tsx:113`; `PageLoader` at `App.tsx:100-109`) → `Switch`.
8. Per-route `RequireRole` (`components/auth/RequireRole.tsx`) where declared. It renders its own spinner while auth/profile load (`RequireRole.tsx:69-76`), redirects unauthenticated users to login (`:79-89`), wrong-role users to `/guardian` or `/dashboard` (`:100-107`), and non-admin incomplete profiles to `/profile/complete` (`:127-133`). It fetches `GET /api/profile` via `csrfFetch` (`:46-61`, queryKey `["/api/profile"]`) and may overlay `ReconsentModal` (`:160-170`).

`main.tsx` imports `./index.css` (Poppins+Inter via `@import`, index.css:1; `--font-sans` Poppins first, index.css:51) and App imports `@/styles/tokens.css` + `accessibility.css` (`App.tsx:15-16`).

---

## 1. `/tests` — TestsHomePage

- **Route:** `App.tsx:205` → `TestsHomeRoute` (`App.tsx:36-42`) → lazy `features/exam/pages/TestsHomePage.tsx` (`App.tsx:32`).
- **Layout chain:** globals → `RequireRole allow={["student","admin"]}` → `AppShell` (`TestsHomePage.tsx:62`) → `div.exam-root -mx-4 min-h-full px-4 py-8 md:px-10` (`:63`).
- **Nav/shell:** `AppShell` → `AppHeader` (`components/layout/app-shell.tsx:70`, header at `:148`) with `navItems` (`app-shell.tsx:39-50`), `NotificationBell` (`:178`), mobile `Sheet` (`:181`), `HeaderUserMenu` (`:230`). No footer (`showFooter` default false).
- **Container:** `mx-auto flex max-w-6xl flex-col gap-6` (`:64`); grid `grid-cols-1 gap-4 md:grid-cols-3` (`:83`). `-mx-4 px-4 ... md:px-10` inside a `<main>` that has no container (`app-shell.tsx:71`).
- **Typography:** h1 `font-serif text-[32px] font-semibold` (`:66`); card h2 `font-serif text-[22px]` (`:118`); eyebrow `text-[11px] uppercase tracking-[0.09em]` (`:117`); panel h2 `text-[15px]` (`:199`). `font-serif` resolves to `var(--font-serif)` = Georgia (tailwind.config.ts:86, tokens.css:33).
- **Components:** none from `components/ui`. Local: `primaryButton`/`secondaryButton` class-string constants (`:52-55`), `FormCard` `<article>` (`:103-144`), `StartPanel` `<section>` (`:146-234`), raw `<input type="radio">` (`:180-188`) rather than `ui/radio-group`, raw `<button>` (`:75`, `:136`, `:217-225`).
- **States:**
  - loading: `<p role="status">Loading tests…</p>` (`:71`)
  - error: `<p role="alert">… Try again</p>` (`:72-79`) — generic; no status branching.
  - empty: `<p>No full-length tests are available yet.</p>` (`:80`)
  - entitlement-locked: **not handled distinctly.** `GET /api/tests/forms` is behind `authorizeExamCaller` which returns 403 when `canAccessFeature(…,'exam_full_length')` fails (`server/routes/exam-runtime-routes.ts:129-141`, `:351-353`); the page renders the generic error at `:72-79` with no upgrade path.
  - start error: `setError(...)` → `<p role="alert">` (`:168`, `:211-215`); 409 `existing_active_session` redirects (`:162-165`).
- **Hardcoded styling:** arbitrary tailwind 47, hex 1, inline style 0. Examples: `bg-[#EAE7E0]` (`:121`), `min-h-[44px]` (`:53`), `bg-[var(--exam-accent)]` (`:53`), `text-[32px]` (`:66`), `rounded-[14px] border-[1.5px]` (`:112`), `text-[11px] tracking-[0.09em]` (`:117`), `text-[22px]` (`:118`), `text-[13px]` (`:119`), `rounded-[10px]` (`:176`), `h-[18px] w-[18px] accent-[var(--exam-accent)]` (`:187`), `text-[12.5px]` (`:191`), `min-h-[52px]` (`:222`).
- **Data fetching:** `useQuery({queryKey: examKeys.forms(), queryFn: fetchExamForms})` (`:58`) → `apiRequest("/api/tests/forms")` (`features/exam/api/exam-api.ts:101-104`). Imperative writes (not `useMutation`): `createExamSession` → `POST /api/tests/sessions` (`exam-api.ts:168-177`), `startExamModule` → `POST /api/tests/sessions/:id/sections/RW/modules/1/start` (`exam-api.ts:179-188`), then `invalidateQueries` (`:159`).
- **Outbound:** `Link href={sessionPath(id)}` → `/tests/:id` (`:126`); `Link href={reportPath(id)}` → `/tests/:id/report` (`:132`); `navigate(modulePath(id,"RW","1"))` → `/tests/:id/RW/1` (`:160`); `navigate(sessionPath(existing))` (`:164`). Plus AppShell nav.
- **Inbound:** `components/layout/app-shell.tsx:47` (nav item); `features/exam/components/ExamStatus.tsx:34` (Back to tests). Route defs `App.tsx:205-208`.

## 2. `/tests/:sessionId` — ExamSessionPage

- **Route:** `App.tsx:208` → `ExamSessionRoute` (`App.tsx:43-49`) → `features/exam/pages/ExamSessionPage.tsx` (`App.tsx:33`). Note: registered after `/tests/:sessionId/report` and `/:section/:module` (`App.tsx:206-207`).
- **Layout chain:** globals → `RequireRole` → page. For loading/error: `ExamLoading`/`ExamLoadError` (`ExamSessionPage.tsx:51-52`). For StartModule / BreakScreen: local `Shell` (`:68-78`) = `div.exam-root flex min-h-screen flex-col` > `<header h-[60px]>` > `<main flex-1 items-center justify-center px-4 py-10>`. **No AppShell.**
- **Nav/shell:** local `Shell` header (`:71-74`): serif "Lyceon" wordmark (plain `<span>`, not a link, `:72`) + mode label (`:73`). No nav links, no bell, no user menu.
- **Container:** StartModule card `max-w-lg … rounded-2xl p-8` (`:114`); Break `max-w-xl` (`:158`).
- **Typography:** h1 `font-serif text-[28px]` (`:115`), Break h1 `font-serif text-[40px]` (`:162`), timer `font-mono text-[56px]` (break timer, `:166` approx — `role="timer"` block following `:162`).
- **Components:** none from `components/ui`; raw `<button>` with `min-h-[52px] rounded-[10px] bg-[var(--exam-accent)]` (`:132`, `:196`).
- **States:** loading `ExamLoading` (`:51`); error `ExamLoadError` (`:52`, maps 403/404/other in `components/ExamStatus.tsx:16-41`); start error `<p role="alert">` (`:124`, `:187`); entitlement: 403 → "This test isn't available to your account." + Back to tests, no retry (`ExamStatus.tsx:19-20`, `:29`); no upgrade link. Empty: n/a.
- **Hardcoded styling:** arbitrary 24, hex 0, inline 0 (e.g. `h-[60px]` `:71`, `text-[13px]` `:73`, `text-[28px]` `:115`, `text-[15px]`, `min-h-[52px]` `:132`, `text-[40px]` `:162`, `text-[56px]`).
- **Data fetching:** `useQuery(examKeys.session)` → `GET /api/tests/sessions/:id/state` (`:43-50`; `exam-api.ts:106-109`); Break: `useQuery(examKeys.forms)` → `GET /api/tests/forms` (`:144`); `startExamModule` → `POST …/sections/:s/modules/:m/start` (`useStart`, `:80-99`).
- **Outbound:** `<Redirect to={pathForPosition(...)}>` → `/tests/:id/:s/:m` or `/tests/:id/report` (`:58`); `navigate(modulePath(...), {replace:true})` (`:91`).
- **Inbound:** `TestsHomePage.tsx:126`, `:164`; `ExamModulePage.tsx:230` (`goToServerPosition`); `ExamReportPage.tsx:334` (Resume test); `exam-position.ts:51,76` (`sessionPath`/`pathForPosition`); calendar launch: server `services/calendar/adapters/full-length.ts:253` builds `/tests/${sessionId}` which the client follows via `features/calendar/api/launch.ts:166` `navigate(response.next)`.

## 3. `/tests/:sessionId/:section/:module` — ExamModulePage

- **Route:** `App.tsx:207` → `ExamModuleRoute` (`App.tsx:50-56`) → `features/exam/pages/ExamModulePage.tsx`.
- **Layout chain:** globals → `RequireRole` → `ExamModulePage` → `ModuleLoader` (`:121-164`) → `ModuleRunner` root `div.exam-root flex h-screen flex-col` (`:455`). **No AppShell.**
- **Nav/shell:** `ExamHeader` (`components/ExamHeader.tsx:22-35`, used `ExamModulePage.tsx:457`) — section h1, "Module N of 2", `ExamTimer`, Math tools (Calculator/Reference buttons `:426-451`). Footer bar (`:535-575`): display name, question navigator button, Back/Next. No wordmark, no bell, no user menu, no exit link.
- **Container:** full-viewport `h-screen`; `<main className="flex min-h-0 flex-1">` (`:464`); question column `overflow-y-auto` (`:486`). Review view: `ModuleReview` `mx-auto max-w-4xl px-6 py-8 md:px-10` (`components/ModuleReview.tsx:27`).
- **Typography:** header h1 `text-base font-semibold` (`ExamHeader.tsx:26`); timer `font-mono text-[30px]` (`ExamTimer.tsx:46`); review h2 `font-serif text-[26px]` (`ModuleReview.tsx:29`); submit dialog title `font-serif text-[26px]` (`SubmitModuleDialog.tsx:53`).
- **Components from `components/ui`:** `Dialog/DialogContent/DialogTitle/DialogDescription` in `NavigatorDialog.tsx:13-18,38-83`; `AlertDialog*` in `SubmitModuleDialog.tsx:14-22,47-82` (both re-skinned with `className="exam-root …"`). Shared non-ui: `DesmosCalculator`, `FloatingPanel`, `MathReferenceSheet` (`:33-36`), `NumericEntryInput` + `MathRenderer` (`ExamQuestionView.tsx:21-22`). Local: `ExamHeader`, `ExamTimer`, `ExamQuestionView`, `ChoiceList`, `PassageView`, `QuestionCell`/`StateLegend`, `ModuleReview`; raw buttons throughout (`:537-573`).
- **States:** loading `ExamLoading` (`:109`, `:142`); error `ExamLoadError` (`:110`, `:143-144`); save failure banner `div role="alert" bg-[#FBF1E6]` (`:459-463`, message set at approx `:288`); URL/position mismatch → `<Redirect>` (`:115-117`); entitlement 403 → ExamLoadError copy (see §2). Empty: `current===undefined` renders `null` (`:530` region).
- **Hardcoded styling:** arbitrary 26 in page + children (ChoiceList 23, ExamQuestionView 16, QuestionCell 16, SubmitModuleDialog 13, ModuleReview 13, PassageView 11, NavigatorDialog 8, ExamHeader 5, ExamTimer 4); hex: `bg-[#FBF1E6]` (`ExamModulePage.tsx:460`, `ExamQuestionView.tsx:69`); inline style: 0 in page. Inline `<svg>` chevron (`:547-549`).
- **Data fetching:** `useQuery` session state (`:100-107`), items `GET …/modules/:m/items` (`:132-136`; `exam-api.ts:111-117`), workspace `GET …/workspace` (`:137-141`). Writes via `useWriteQueue`/imperative: `POST /api/tests/answer` (`exam-api.ts:201-204`), `PUT …/workspace` (`exam-api.ts:206-217`), `POST …/submit` (`exam-api.ts:190-199`), `POST …/start` for Module 2 (`:240`), heartbeat `POST /api/tests/sessions/:id/sections/:s/heartbeat` (`exam-api.ts:220-230`, via `useHeartbeat`).
- **Outbound:** `navigate(sessionPath)` (`:230`), `navigate(modulePath(...,"2"))` (`:242`), `navigate(reportPath)` (`:251`), `<Redirect to={pathForPosition}>` (`:116`). All `replace:true`.
- **Inbound:** `TestsHomePage.tsx:160`; `ExamSessionPage.tsx:58`, `:91`; `ExamModulePage.tsx:116`, `:242`; `exam-position.ts:59,70`.

## 4. `/tests/:sessionId/report` — ExamReportPage

- **Route:** `App.tsx:206` → `ExamReportRoute` (`App.tsx:57-63`) → `features/exam/pages/ExamReportPage.tsx`.
- **Layout chain:** globals → `RequireRole` → `ReportLayout` `div.exam-root min-h-screen` (`:77`) > `<header h-[60px]>` (`:78-81`) > `<main max-w-4xl …>` (`:82`). **No AppShell.** Header markup duplicates ExamSessionPage `Shell` header (`ExamSessionPage.tsx:71-74`), right side shows `user.display_name` (`:80`) instead of mode.
- **Nav/shell:** local header only; "Lyceon" `<span>` not a link (`:79`). Only way back is `Actions` "Back to dashboard" (`:92`).
- **Container:** `mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 py-8 md:px-10` (`:82`); section cards `flex-col gap-3 sm:flex-row` (`:246`).
- **Typography:** Title h1 `font-serif text-[30px]` (`:118`); total `font-serif text-[64px]` (`:233`); section score `font-serif text-[34px]` (`:206`); Panel h2 `font-serif text-[24px]` (`:217`); Fact dt `text-[12px] uppercase tracking-[0.08em]` (`:126`).
- **Components:** none from `components/ui`. Local exported: `Title` (`:114`), `Fact` (`:123`), `ScoreTabs` (hand-built WAI-ARIA tablist, `:142-196`, not `ui/tabs`), `SectionCard` (`:198`), `Panel` (`:214`), `ReportBody` (`:223`); `DisclosedScore`/`DisclosureNote`, `DomainBreakdown` (children).
- **States:** loading `ExamLoading label="Loading your report…"` (`:69`); error `ExamLoadError` (`:70`); report states `scored`/`partial_scored`/`scoring_pending` (polls `/report/status` every 4 s, `:55-67`)/`failed_requires_review`/`unavailable`/`not_completed` (`:223-343`); entitlement-locked: server state `unavailable` + `entitlement_lapsed` copy (`:310-312`) — no upgrade link. "Review your answers" is a disabled button (`:96-104`).
- **Hardcoded styling:** arbitrary 46, hex 1 (`bg-[#EAE7E0]` `:170`), inline 0. Examples `h-[60px]` `:78`, `min-h-[48px]` `:92`, `text-[15px]` `:92`, `text-[30px]` `:118`, `text-[12px] tracking-[0.08em]` `:126`, `rounded-[10px]` `:170`, `text-[34px]` `:206`, `text-[24px]` `:217`, `text-[64px]` `:233`. `DomainBreakdown.tsx` has 1 inline style and `bg-[#EAE7E0]` (`:51`).
- **Data fetching:** `useQuery(examKeys.report)` → `GET /api/tests/sessions/:id/report` (`:47-53`; `exam-api.ts:132-135`); `useQuery(examKeys.reportStatus)` → `GET …/report/status` (`:55-67`; `exam-api.ts:142-145`).
- **Outbound:** `Link href="/dashboard"` (`:92`); `<a href={payload.resume_action.url}>` server-supplied URL (`:315`); `Link href={sessionPath(id)}` (`:334`).
- **Inbound:** `TestsHomePage.tsx:132`; `ExamModulePage.tsx:251`; `exam-position.ts:63,72` (via `ExamSessionPage.tsx:58`/`ExamModulePage.tsx:116` redirects).

### exam.css (applies to §1-§4)
`features/exam/exam.css` (34 lines), imported by each exam page (`TestsHomePage.tsx:33`, `ExamSessionPage.tsx:39`, `ExamModulePage.tsx:71`, `ExamReportPage.tsx:31`). Defines 11 custom properties scoped to `.exam-root` (`exam.css:6-20`): `--exam-bg #f7f6f3`, `--exam-surface #fff`, `--exam-ink #191815`, `--exam-muted #5f5b53`, `--exam-line #ddd9d1`, `--exam-line-strong`, `--exam-accent #1b4b8f`, `--exam-accent-hover`, `--exam-accent-soft`, `--exam-marked #a65a0b`, `--exam-highlight #fde68a`; sets `background`/`color` on `.exam-root`. Focus ring rule (`:22-28`) and inline-math override (`:31-34`). No dark-mode variant; no font declarations (fonts come from Tailwind `font-serif`/`font-mono`). Consumed from Tailwind via `bg-[var(--exam-…)]` arbitrary values.

---

## 5. `/calendar` — pages/calendar.tsx → features/calendar/CalendarView.tsx

- **Route:** `App.tsx:210-217` (inline arrow `component`) → lazy `pages/calendar.tsx` (`App.tsx:66`).
- **Layout chain:** globals → `RequireRole allow={["student","admin"]}` → `CalendarPage` (`pages/calendar.tsx:63`) → one of: `CalendarSkeleton` (`:123`), `CalendarPremiumGate` (`:124`), `CalendarError` (`:125-136`), or `CalendarView` (`:145`, `:195`) whose root is `div.lyceon-calendar` > `div.app[.blur]` (`CalendarView.tsx:449-450`). **No AppShell.**
- **Nav/shell:** own chrome from `features/calendar/components/Chrome.tsx`: `LeftRail` `<aside class="rail">` with `.brand` "Lyceon" dot mark (`Chrome.tsx:96-99`, used `CalendarView.tsx:451`) — hidden ≤900px (`calendar.css:918-925`); `TopBar` `div.top` with `Link href={backHref}` "← Dashboard" (`Chrome.tsx:307-321`, used `CalendarView.tsx:505`). No AppShell nav, no `NotificationBell`, no `HeaderUserMenu`.
- **Container:** CSS grid `.app { grid-template-columns: 248px 1fr; height: 100vh; overflow: hidden }` (`calendar.css:88-93`); ≤900px single column (`:918-921`); further breakpoints `@media (max-width:1180px)` (`:1352`), `(max-width:767px)` (`:1561`). Mobile week view renders `DayStrip` + one-column `WeekGrid` (`CalendarView.tsx:570-592`).
- **Typography:** `.lyceon-calendar { font-family: Inter, system-ui; font-size:14px; line-height:1.45 }` (`calendar.css:66-73`); headings/brand use `font-family: "Bricolage Grotesque"` (19 declarations, e.g. `calendar.css:107,143,208,264…1471`). **Bricolage Grotesque is not loaded**: absent from `client/index.html:41` Google Fonts URL and from `index.css:1` `@import` (grep: `grep -rn Bricolage client/index.html client/src/index.css` → no hits). Inter is loaded. `CalendarStates.tsx:80-84,119-123` inline `fontFamily: "'Bricolage Grotesque'", fontSize: 21`.
- **Components:** zero imports from `components/ui` in `features/calendar` (`grep -rn "@/components/ui" client/src/features/calendar` → none, non-test). Local: sheets/modals built on CSS classes — `BlockSheet` (`.scrim` `BlockSheet.tsx:116`), `CreateBlockSheet` (`CreateBlockSheet.tsx:137`), `SettingsSheet` (`.scrim on` + `aside.sheet.set` `SettingsSheet.tsx:270-275`), `SetupPopup` (`.modal on role="dialog" aria-modal` `SetupPopup.tsx:273-275`), `DayMenu`, `DayOffCard`; buttons are `button.btn` / `.btn.primary` / `.btn.icon` / `.btn.sched` (`Chrome.tsx:332,340,347,397,409`; `CalendarStates.tsx:91`). Shared (non-ui) component used: `PremiumUpgradePrompt` (`CalendarStates.tsx:18,104`), which itself uses `ui/button`. DnD via `@dnd-kit` (`CalendarView.tsx` `DndContext`, ~`:566`).
- **States:**
  - loading: `CalendarSkeleton` (`CalendarStates.tsx:26-58`)
  - entitlement-locked: `isEntitlementDenial` = `status === 402` (`CalendarStates.tsx:22-24`) → `CalendarPremiumGate` (`:100-108`), checked before error (`calendar.tsx:124`)
  - error: `CalendarError` with API message + Try again (`CalendarStates.tsx:65-97`; `calendar.tsx:125-136`)
  - pre-setup: `status === "setup_required"` → `CalendarView model={null}` + `SetupPopup` over blurred plan (`calendar.tsx:143-189`; `CalendarView.tsx:681-692`)
  - **Scoping gap:** the three state components render root `<div className="app">` with no `.lyceon-calendar` ancestor (`CalendarStates.tsx:28,77,102,117`; returned directly at `calendar.tsx:123-135`). Every selector in `calendar.css` is prefixed `.lyceon-calendar` (only usage of that class in TSX: `CalendarView.tsx:449`), so the `.app/.rail/.main/.btn` rules do not match these states. Verified by grep; rendered appearance itself unverified (no browser run).
- **Hardcoded styling:** `calendar.css` 1,636 lines, 113 hex literals (`grep -cE "#[0-9a-fA-F]{3,8}\b" features/calendar/calendar.css`); token block `calendar.css:27-57` (`--ink #10162a`, `--rail #0e1424`, `--math`→`var(--calendar-math,#2563eb)` etc.; block colours also in `styles/tokens.css:85-88`). TSX inline `style={{}}`: 21 total in non-test calendar TSX — `CalendarStates.tsx:33,34,38,47,78,80,88,103,118,120,128`, `Chrome.tsx:178`, `MixRows.tsx:100`, `BlockCard.tsx:126`, `CreateBlockSheet.tsx:161,167,183`, `SetupPopup.tsx:288`, `SettingsSheet.tsx:475`, `MonthGrid.tsx:63`, `BlockSheet.tsx:219`. Arbitrary Tailwind: 0 (no Tailwind in calendar TSX). No dark-mode variant.
- **Data fetching:** hooks from `features/calendar/api` (`calendar.tsx:22-37`): `useCalendar` → `GET /api/calendar?from&to&device_timezone` (`api/client.ts:174`, `useQuery` `api/queries.ts:61`); `usePrefetchAdjacentRange` (`queries.ts:101`); `useStreak` → `GET /api/me/streak` (`client.ts:180`, `queries.ts:150`). Mutations (`api/mutations.ts`, all `useMutation` via `apiRequest`): `PUT /api/calendar/profile` (`client.ts:211`), `PUT /api/calendar/days/:date` (`:227`), `POST /api/calendar/blocks/:id/move` (`:248`), `POST /api/calendar/plan/regenerate` (`:263`), `POST /api/calendar/days/:date/regenerate` (`:279`), `POST /api/calendar/days/:date/reset` (`:295`), `POST /api/calendar/blocks/:id/do-it-now` (`:311`), `POST /api/calendar/blocks/:id/launch` (`:332`), `POST /api/calendar/acknowledge` (`:347`). `PremiumUpgradePrompt` fetches `GET /api/billing/status` via `csrfFetch` with queryKey `["billing-status"]` (`PremiumUpgradePrompt.tsx:153-155`).
- **Outbound:** `Link href={backHref}` = `/dashboard` (`Chrome.tsx:315-321`; `calendar.tsx:146,196`); `navigate("/upgrade")` from SetupPopup (`calendar.tsx:165`); `navigate(response.next)` server-supplied launch target — practice/review/`/tests/:id` (`api/launch.ts:166`); `PremiumUpgradePrompt` → `navigate(copy.action.to)` = `/upgrade` for students (`PremiumUpgradePrompt.tsx:190`; `lib/billing-cta.ts:124`).
- **Inbound:** `components/layout/app-shell.tsx:45` (nav item). No other non-test client reference found.

### calendar.css (applies to §5)
`features/calendar/calendar.css`, imported at `pages/calendar.tsx:49`. Header comment (`:1-24`) states it is mechanically derived from `docs/design/calendar-prototype.html`, scoped under `.lyceon-calendar`, and deliberately not Tailwind because `tailwind.config.ts` limits the brand palette. Own token set (`:27-57`), own reset (`:59-81`), own focus ring (`:82-87`, 2px `--math`), own button reset (`:75-81`). The comment at `:12-13` says "this page is mounted inside an app shell"; in the code the page is not wrapped by `AppShell` (see Layout chain).

---

## 6. `/upgrade` — pages/upgrade.tsx

- **Route:** `App.tsx:267-274` → lazy `pages/upgrade.tsx` (`App.tsx:93`).
- **Layout chain:** globals → `RequireRole allow={["student","admin"]}` → `AppShell showFooter` (`upgrade.tsx:113`). Only page in this set with the footer (`app-shell.tsx:74`, `layout/Footer.tsx`).
- **Nav/shell:** AppShell header (`app-shell.tsx:148-238`) + Footer.
- **Container:** `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl` (`:114`); grid `grid-cols-1 md:grid-cols-3 gap-6` (`:142`).
- **Typography:** eyebrow `text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground` (`:122`); h1 `text-3xl md:text-4xl font-semibold tracking-tight` (`:123`); price `text-4xl font-semibold` (`:172`).
- **Components (ui):** `Card/CardHeader/CardTitle/CardDescription/CardContent/CardFooter` (`:5`), `Button` (`:6`), `Badge` (`:7`), `Alert/AlertDescription` (`:8`); toast via `useToast` (`:16`). Local pill `div.rounded-full bg-secondary` (`:180`).
- **States:** loading: inline spinner row below cards (`:217-222`) — cards render from `fallbackPlans` meanwhile; error: `Alert` "Fallback pricing is shown" + Retry (`:131-140`); checkout error: toast (`:101-109`); empty: n/a (fallback constants `:18-49` always rendered); entitlement: no "already subscribed" state. `startSubscriptionCheckout` returns `item_added` without redirect (`lib/billing-client.ts:143-148`); `upgrade.tsx:99-110` has no `onSuccess`, so that branch has no UI.
- **Hardcoded styling:** arbitrary 1 (`tracking-[0.2em]` `:122`), hex 0, inline 0; hardcoded prices in `fallbackPlans` (`:22,32,42`).
- **Data fetching:** `useQuery(["/api/billing/plans"], getBillingPlans)` (`:79-83`) → `csrfFetch("/api/billing/plans")` (`lib/billing-client.ts:94`); `useMutation(startSubscriptionCheckout)` (`:99`) → `POST /api/billing/checkout` (`billing-client.ts:129`) → `window.location.assign(outcome.url)` (`billing-client.ts:145`).
- **Outbound:** `Link href="/dashboard"` inside `Button asChild` (`:116-121`); Stripe Checkout via `window.location.assign` (`billing-client.ts:145`).
- **Inbound:** `pages/calendar.tsx:165`; `components/progress/ScoreProjectionCard.tsx:36`; `lib/billing-cta.ts:41` (`resolveCtaDestination`, used by `UserProfile.tsx:766`) and `:124` (used by `PremiumUpgradePrompt.tsx:190`).

## 7. `/profile` — pages/UserProfile.tsx

- **Route:** `App.tsx:293-300` → lazy `pages/UserProfile.tsx` (`App.tsx:77`). Allowed roles student, guardian, admin.
- **Layout chain:** globals → `RequireRole` → `AppShell` in every branch (`:230`, `:248`, `:271`, `:287`). A guardian viewing `/profile` therefore gets the student `AppShell` nav (Dashboard/Calendar/Practice/Tests/Review/Lisa), not `GuardianShell` — contrast `/notifications` which switches (`notifications.tsx:57-62`).
- **Nav/shell:** AppShell header; no footer.
- **Container:** `container mx-auto py-8 px-4 sm:px-6 lg:px-8 max-w-6xl` (`:288`); `TabsList grid w-full grid-cols-4` (`:368`); grids `md:grid-cols-2` (`:397`), `md:grid-cols-3` (`:567`).
- **Typography:** eyebrow `text-xs … uppercase tracking-[0.2em]` (`:291`); h1 `text-3xl font-bold` (`:294-296`); h2 `text-2xl font-bold` (`:323`).
- **Components (ui):** `Tabs*` (`:8`), `Card*` (`:9-15`), `Button`, `Input`, `Textarea`, `Select*`, `Label`, `Badge`, `Alert`, `Avatar*` (`:16-29`). Shared common: `PageCard` (`:6`, used `:307`), `EmptyState` (`:7`, used `:273`, `:637`), `RecoveryNotice`, `SessionNotice` (`:51-52`), `StudentLinkCodePanel`, `StudentGuardiansPanel` (`:4-5`), `DeleteAccountCard`, `EmailNotificationsCard` (`:53-54`).
- **States:** loading: local spinner div (`:228-239`); error: `SessionNotice` or `RecoveryNotice` (`:246-265`); empty: `EmptyState` "No Profile Data" (`:268-283`); billing loading/error: `Alert` / notices (`:683-713`); progress tab: placeholder "—" cards + `EmptyState` "Coming Soon" (`:560-640`). Entitlement: billing tab shows status + "View Plans"/"Manage Subscription" (`:737-775`).
- **Hardcoded styling:** arbitrary 5 (`min-h-[60vh]` `:231,249,272`, `tracking-[0.2em]` `:291`, `min-h-[220px]` `:512`), hex 0, inline 0, raw palette 4 (`text-green-500` `:444,611`, `text-yellow-500` `:571`, `text-blue-500` `:591`).
- **Data fetching:** `useQuery(["/api/profile"])` (`:130-133`) and `useQuery(["/api/billing/status"])` (`:141-144`) — both rely on the default `queryFn` in `lib/queryClient` (no explicit `queryFn`). `useBillingPortal()` (`:209`) → `POST /api/billing/portal` (`billing-client.ts:152`). `signOut()` (`:148`). Two `useEffect`s: tab from `?tab=` (`:172-185`), role-switch template into state (`:188-200`).
- **Outbound:** `navigate("/login")` (`:151`); `window.location.reload()` (`:254`, `:703`); `<a href={mailto:…}>` (`:530`); `navigate(resolveCtaDestination({isGuardian}))` → `/upgrade` or `/guardian` (`:766`); Stripe portal via `window.location.assign` (`billing-client.ts:162`).
- **Inbound:** `components/layout/HeaderUserMenu.tsx:113`; `components/layout/app-shell.tsx:205`; `components/account-deletion/DeleteAccountCard.tsx:57` (`window.location.assign`); server notification hrefs `/profile?tab=settings` (`server/lib/notifications/templates/guardian-linked.ts:33`, `guardian-unlinked.ts:39`). Also `components/NavBar.tsx:88,96` and `components/navigation.tsx:171`, but neither file has any importer (grep `import .*(NavBar|Navigation)\b` → none).

## 8. `/profile/complete` — pages/profile-complete.tsx

- **Route:** `App.tsx:301-308` → lazy `pages/profile-complete.tsx` (`App.tsx:78`).
- **Layout chain:** globals → `RequireRole` (which skips its onboarding redirect on this path, `RequireRole.tsx:112,131`) → page root `div.min-h-screen flex items-center justify-center bg-background p-4` (`:272`). **No shell** (no header, nav, bell, sign-out).
- **Container:** `Card w-full max-w-lg` (`:273`); error `Card max-w-md` (`:246`).
- **Typography:** `CardTitle` (ui) (`:275-278`); error title `text-[#0F2E48]` (`:248`).
- **Components (ui):** `Alert`, `Button`, `Card*`, `Checkbox`, `Input`, `Label`, `Select*` (`:11-30`); `GuardianConnectRequired` (`:12`, used `:292-300`; itself uses ui `Button/Input/Label/Alert`).
- **States:** loading `Loader2` centered (`:227-238`); error Card with Retry + Back To Login (`:240-268`); form validation error `Alert` amber (`:303-311`); redirects for unauthenticated/admin/already-complete (`:215-225`). Empty/entitlement: n/a.
- **Hardcoded styling:** arbitrary 1 / hex 1 (`text-[#0F2E48]` `:248`); raw palette 5 (`text-amber-700` `:249,308`, `border-amber-200 bg-amber-50` `:305`, `text-amber-800` `:309`).
- **Data fetching:** `useQuery(["/api/profile"])` with `csrfFetch("/api/profile")` (`:100-110`) — same key as `RequireRole` and `UserProfile`, three separate `queryFn` definitions; `useMutation` → `apiRequest("/api/profile", …)` (`:144-150`), then `invalidateQueries(["/api/profile"])` (`:162`).
- **Outbound:** `<Redirect to="/login">` (`:216`), `<Redirect to="/dashboard">` (`:220`), `<Redirect to={resolvePostCompletionPath(role)}>` → `/guardian` | `/dashboard` (`:224`), `navigate(resolvePostCompletionPath(...))` (`:177`), `navigate("/login")` (`:261`).
- **Inbound:** `components/auth/RequireRole.tsx:132`; `pages/login.tsx:56`.

## 9. `/update-password` — pages/update-password.tsx

- **Route:** `App.tsx:309-316`, eagerly imported (`App.tsx:22`).
- **Layout chain:** globals → `RequireRole allow={["student","guardian","admin"]}` → `div.min-h-screen flex items-center justify-center bg-background p-4` (`:81`). **No shell.** Because it sits under `RequireRole`, a non-admin user with an incomplete profile is redirected to `/profile/complete` first (`RequireRole.tsx:127-133`).
- **Container:** `Card w-full max-w-md mx-auto` (`:82`).
- **Typography:** `CardTitle className="text-2xl …"` (`:84`).
- **Components (ui):** `Card*`, `Button`, `Alert` (`:8-16`); `PasswordField` (`components/auth/PasswordField`, `:20`, used `:94-114`).
- **States:** submit-disabled reason text (`:136-145`); error `Alert` amber (`:116-123`); pending label "Updating..." (`:134`). No loading/empty/entitlement states.
- **Hardcoded styling:** arbitrary 0, hex 0, inline 0; raw palette 4 (`border-amber-200 bg-amber-50` `:117`, `text-amber-700` `:118`, `text-amber-800` `:119`).
- **Data fetching:** `updatePassword` from `SupabaseAuthContext` → `csrfFetch("/api/auth/update-password")` (`contexts/SupabaseAuthContext.tsx:415`). No TanStack Query.
- **Outbound:** `setLocation(isGuardian ? "/guardian" : "/dashboard")` (`:74`).
- **Inbound:** no client-side link. Reached from server: `server/routes/supabase-auth-routes.ts:762` (recovery `redirectTo …/auth/callback?next=/update-password`) and `server/routes/oauth-callback-routes.ts:70` (`RECOVERY_NEXT`).

## 10. `/notifications` — pages/notifications.tsx

- **Route:** `App.tsx:319-326`, eagerly imported (`App.tsx:23`).
- **Layout chain:** globals → `RequireRole` → `GuardianShell` if `isGuardian` else `AppShell` (`:55-63`) → `NotificationsFeed` root `div.container …` (`:136-139`).
- **Nav/shell:** `AppShell` header (student/admin) or `GuardianShell` header (`layout/GuardianShell.tsx:43-80`).
- **Container:** `container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-3xl` (`:137`).
- **Typography:** h1 `text-2xl font-bold` (`:151-158`); row h2 `text-base font-semibold|font-medium` (`:281-283`).
- **Components (ui):** `Button` (`:37`), `Tabs/TabsList/TabsTrigger` (`:38`). Local: `NotificationRow` (`:257-362`), inline empty state (`:210-222`).
- **States:** loading `<p>Loading…</p>` (`:189-195`); error text + Try again (`:196-208`); empty dashed-border box (`:209-222`); load-more (`:241-252`). Entitlement: n/a.
- **Hardcoded styling:** arbitrary 0, hex 0, inline 0.
- **Data fetching:** `useInfiniteQuery` (`:72-79`, `fetchNotificationsPage`) and `useQuery` unread (`:81-84`) → `GET /api/notifications…` (`lib/notificationsApi.ts:29,63,78`); `useMutation`s → `POST /api/notifications/mark-all-seen` (`notificationsApi.ts:85`), `POST …/mark-all-read` (`:95`), `PATCH`/write `…/:messageId` (`:108`). Auto `markAllSeen` in mount `useEffect` (`:117-123`).
- **Outbound:** `navigate(item.href)` — server-supplied (`:132`).
- **Inbound:** `components/notifications/NotificationBell.tsx:193` (`Link href="/notifications"`).

## 11. `/account/recover` — pages/account-recover.tsx

- **Route:** `App.tsx:318`, lazy (`App.tsx:25`). **Public** (no `RequireRole`); exempt from `DeletionGate` (`App.tsx:416`).
- **Layout chain:** globals (minus RequireRole) → `div.min-h-screen … bg-gradient-to-b from-[#EAF0FF] to-white p-6` (`:48`) > `div.max-w-md bg-white rounded-2xl shadow-lg p-8` (`:49`). **No shell.**
- **Typography:** h1 `text-2xl font-semibold text-neutral-800` (`:52-53`, repeated per state); body `text-sm text-neutral-600`.
- **Components (ui):** `Button` only (`:3`, used inside `Link` `:70-74`).
- **States:** `loading|success|invalid|reclaimed|error` state machine (`:15`, `:50-133`). No TanStack Query; fetch in `useEffect` (`:20-45`).
- **Hardcoded styling:** arbitrary 1 / hex 1 (`from-[#EAF0FF]` `:48`); `bg-white` (`:49`); raw palette 13 (`text-neutral-800` ×5, `text-neutral-600` ×5, `text-blue-600` ×3 at `:87,106,125`).
- **Data fetching:** `apiRequestRaw("/api/account/recover-deletion", {method:"POST"})` (`:29-32`).
- **Outbound:** `Link href="/login"` (`:70`); `<a href="mailto:…">` (`:86-91`, `:105-110`, `:124-129`).
- **Inbound:** no client link. Server email: `server/lib/notifications/direct-sends.ts:171` (`${siteUrl}/account/recover?token=…`). Referenced by `App.tsx:416` (gate exemption).

## 12. PendingDeletionScreen (substituted for every route by DeletionGate)

- **Where:** `components/account-deletion/PendingDeletionScreen.tsx`; rendered at `App.tsx:416-418` when `user.pendingDeletion` (except `/account/recover`). Replaces `<Router/>` entirely, so it is outside `Suspense`/`RequireRole`/any shell.
- **Layout:** `div.min-h-screen … bg-gradient-to-b from-[#EAF0FF] to-white p-6` (`:63`) > `div.max-w-md bg-white rounded-2xl shadow-lg p-8 space-y-5` (`:64`).
- **Typography:** h1 `text-2xl font-semibold text-neutral-800` (`:66`); `text-sm text-neutral-600` (`:69`).
- **Components (ui):** `Button` ×2 (`:102-120`), `Alert` (`:93-99`); toast.
- **States:** pending label "Restoring…" (`:108-110`); errors via toast `cancelDeletionErrorCopy` (`:58`); 404 → reload to `/dashboard` (`:54-56`).
- **Hardcoded styling:** hex 1 (`from-[#EAF0FF]` `:63`), `bg-white` `:64`, raw palette 3 (`text-neutral-800` `:66,74`, `text-neutral-600` `:69`).
- **Data fetching:** `useMutation` → `apiRequestRaw("/api/account/cancel-deletion", {method:"POST"})` (`:35-41`). Reads `user.pendingDeletion.scheduledHardDeleteAt` from auth context (`:33`).
- **Outbound:** `window.location.assign("/dashboard")` (`:49`, `:55`); `signOut()` (`:115`).
- **Inbound:** `App.tsx:10` import, `App.tsx:417` render.

---

## 13. How the exam and calendar surfaces differ from AppShell (descriptive)

| Aspect | AppShell pages (`/upgrade`, `/profile`, `/notifications`, `/tests` home) | Exam runtime (`/tests/:id…`) | Calendar (`/calendar`) |
|---|---|---|---|
| Shell component | `AppShell` (`layout/app-shell.tsx:57-77`) | Per-page local: `Shell` (`ExamSessionPage.tsx:68-78`), `ReportLayout` (`ExamReportPage.tsx:74-87`), `ExamHeader`+footer (`ExamModulePage.tsx:455-575`) | `CalendarView` own grid: `LeftRail` + `TopBar` (`CalendarView.tsx:449-626`) |
| Header | sticky `h-16` bar, GraduationCap + "Lyceon" link to `/dashboard`, 6 nav links, bell, user menu (`app-shell.tsx:148-238`) | `h-[60px]` bar with non-link serif "Lyceon" + mode/name (session/report); `min-h-[74px]` section/timer/tools header in module (`ExamHeader.tsx:24`) | dark 248px left rail with dot-mark "Lyceon" (`Chrome.tsx:96-99`, `calendar.css:94-117`), hidden ≤900px; top bar with "← Dashboard" link (`Chrome.tsx:315-321`) |
| Primary nav / bell / user menu | yes / yes / yes | none / none / none | none / none / none |
| Stylesheet | Tailwind + shadcn tokens (`index.css`, `styles/tokens.css`) | Tailwind utilities + `exam.css` scoped vars on `.exam-root` (`exam.css:6-20`) | Plain CSS `calendar.css` (1,636 lines) scoped to `.lyceon-calendar`; no Tailwind utilities in calendar TSX |
| Colour tokens | shadcn `--background/--foreground/--primary…` | `--exam-*` (warm greys, accent `#1b4b8f`) | `--ink/--muted/--rail/--math/--rw/--rev/--exam…` (`calendar.css:27-57`), block colours shared with `tokens.css:85-88` |
| Fonts | body `font-sans` → Poppins/Inter (`index.css:51`) | body Poppins inherited; headings `font-serif` → Georgia (`tokens.css:33`); timers `font-mono` | Inter set on scope root (`calendar.css:68`); headings "Bricolage Grotesque" (not loaded) |
| Components | `components/ui` (shadcn) | raw `<button>`/`<input>`; only `ui/dialog` + `ui/alert-dialog` re-skinned with `exam-root` | no `components/ui`; CSS-class `.btn`, `.sheet`, `.scrim`, `.modal` |
| Height model | `min-h-screen flex-col`, page scrolls | session/report `min-h-screen`; module `h-screen` fixed | `.app` `height:100vh; overflow:hidden` with internal `.scroll` |
| Focus ring | shadcn `ring` utilities | `outline: 3px solid var(--exam-accent)` (`exam.css:22-28`) | `outline: 2px solid var(--math)` (`calendar.css:82-87`) |
| Dark mode | `.dark` in `index.css:69` | no dark variants in `exam.css` | no dark variants in `calendar.css` |

`/tests` (TestsHomePage) is the hybrid: `AppShell` outside, `.exam-root` tokens and serif type inside (`TestsHomePage.tsx:62-63`).

---

## 14. Duplicated UI element implementations

- **Accent button class string** re-typed per file (no shared exam Button): `TestsHomePage.tsx:52-55` (consts), `:222`; `ExamSessionPage.tsx:132`, `:196`; `ExamModulePage.tsx:563`; `ExamReportPage.tsx:100`, `:334`; `ExamStatus.tsx:30`; `ModuleReview.tsx:68`; `NavigatorDialog.tsx:77`; `SubmitModuleDialog.tsx:76`; `GuardianExamResultsPage.tsx:122`. Variants differ in `min-h` (44/48/52), radius (`rounded-lg`/`rounded-[10px]`/`rounded-full`), weight.
- **Exam top header** duplicated: `ExamSessionPage.tsx:71-74` vs `ExamReportPage.tsx:78-81` (same classes, different right-hand content).
- **Calendar buttons** `.btn` family in `calendar.css`, parallel to `ui/button`.
- **Calendar modal/sheet** local implementations (`SettingsSheet.tsx:270`, `SetupPopup.tsx:273`, `BlockSheet.tsx:116`, `CreateBlockSheet.tsx:137`) parallel to `ui/sheet`/`ui/dialog`.
- **Skeleton**: `CalendarSkeleton` (`CalendarStates.tsx:26`) vs `ui/skeleton.tsx` (unused here).
- **Tabs**: `ScoreTabs` hand-built (`ExamReportPage.tsx:142-196`) vs `ui/tabs` used in `UserProfile.tsx:8`, `notifications.tsx:38`.
- **Radio**: raw radio in `TestsHomePage.tsx:180` vs `ui/radio-group.tsx`.
- **Centered-card-on-gradient screen** ×3: `App.tsx:383-384` (ErrorBoundary), `account-recover.tsx:48-49`, `PendingDeletionScreen.tsx:63-64` — identical `from-[#EAF0FF] to-white` + `bg-white rounded-2xl shadow-lg p-8`.
- **Full-page spinner** ×4 distinct markups: `App.tsx:101-108` (PageLoader, w-8 border-2), `RequireRole.tsx:69-76` (h-12 border-4 border-primary), `UserProfile.tsx:230-238` (h-8 border-2), `profile-complete.tsx:227-238` (`Loader2`). Plus `ExamLoading` text-only (`ExamStatus.tsx:8-14`).
- **Eyebrow + h1 page header** (no shared component): `upgrade.tsx:122-128`, `UserProfile.tsx:290-300`, same `text-xs … tracking-[0.2em]` eyebrow; `GuardianShell.tsx:67`, `PracticeShell.tsx:63` (`text-[10px]`). `layout/primitives.tsx` exports `Hero`/`Section`/`Container`/`Card` (`primitives.tsx:23-158`) — none used by these pages.
- **Empty states**: shared `components/common/empty-state.tsx` used only by `UserProfile.tsx:273,637`; local ones at `notifications.tsx:210-222`, `TestsHomePage.tsx:80`, `GuardianNotSetUp` (`CalendarStates.tsx:115-135`).
- **Error/alert blocks**: amber `Alert` override duplicated `update-password.tsx:117-119` and `profile-complete.tsx:305-309`; exam `role="alert"` `<p>`s at `TestsHomePage.tsx:73,212`, `ExamSessionPage.tsx:124,187`; calendar `CalendarError` inline-styled.
- **Card**: `ui/card` Card, `layout/primitives.tsx:125` `Card` (different, `rounded-2xl p-6`), `common/page-card.tsx` `PageCard`; exam `Panel`/`SectionCard`/`FormCard` (`ExamReportPage.tsx:198,214`, `TestsHomePage.tsx:103`).
- **`/api/profile` query** defined 3 ways under one key `["/api/profile"]`: `RequireRole.tsx:44-62` (csrfFetch, 401/403 → `{authenticated:false}`), `profile-complete.tsx:100-110` (csrfFetch), `UserProfile.tsx:130-133` (default queryFn).
- **`/api/billing/status`** under two keys: `["/api/billing/status"]` (`UserProfile.tsx:142`) and `["billing-status"]` (`PremiumUpgradePrompt.tsx:153`).

---

## 15. Grep commands used (run from `scratchpad/main/client/src`)

```bash
grep -nE "Route|lazy\(|import " App.tsx
for p in '/tests' '/calendar' '/upgrade' '/profile' '/update-password' '/notifications' '/account/recover'; do
  grep -rnE "[\"'\`]${p}([\"'\`/?#$]|\\$)" --include=*.ts --include=*.tsx . | grep -vE "\.test\.|__tests__|/api/|test-fixtures"; done
grep -rn "update-password\|account/recover\|profile?tab\|/profile?" client/src server --include=*.ts --include=*.tsx | grep -vE "\.test\."
grep -rnE "sessionPath\(|reportPath\(|modulePath\(" . --include=*.tsx --include=*.ts | grep -v "\.test\."
grep -nE "href|navigate\(|setLocation|window\.location|<Link|<a " -r features/calendar | grep -v "\.test\."
grep -n "@/components/ui" -r features/calendar | grep -v test
# per-file hardcoded counts:
grep -oE "[a-z:-]+-\[[^]]+\]" FILE | wc -l      # arbitrary tailwind
grep -oE "#[0-9A-Fa-f]{6}\b" FILE | wc -l        # hex in TSX
grep -c "style={{" FILE                          # inline style
grep -oE "\b(text|bg|border)-(red|blue|green|yellow|amber|neutral|gray|slate)-[0-9]+" FILE | wc -l
grep -cE "#[0-9a-fA-F]{3,8}\b" features/calendar/calendar.css   # 113
grep -nE "style=\{\{" -r features/calendar --include=*.tsx | grep -v test   # 21
grep -nE "^[^ /*@}][^{]*\{" features/calendar/calendar.css | grep -v lyceon-calendar   # none
grep -rn "lyceon-calendar" --include=*.tsx . | grep -v test    # CalendarView.tsx:449 only
grep -rn "Bricolage\|fonts.googleapis" client/index.html client/src/index.css
grep -rnE "import .*(NavBar|Navigation)\b.* from" --include=*.tsx . | grep -v "PublicNavBar\|navigation-menu\|test"   # none
grep -n "authorizeExamCaller" -A25 server/routes/exam-runtime-routes.ts
```

## 16. Unverified items

- Rendered appearance of `CalendarSkeleton`/`CalendarError`/`CalendarPremiumGate` without `.lyceon-calendar` scope — code-proven that selectors do not match; not visually confirmed (no browser run).
- Whether an admin (allowed on `/tests`) passes `canAccessFeature('exam_full_length')` — not traced into `EntitlementService`.
- Exact `onWriteError` line in `ExamModulePage.tsx` (~`:282-289`, save-error copy) — located by relative grep offset, not re-read verbatim.
