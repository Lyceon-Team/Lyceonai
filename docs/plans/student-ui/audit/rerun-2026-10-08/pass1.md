# Pass 1: page inventory (re-run on `d8d8a3c1`)

Paths are relative to the repository root. `App.tsx` means `client/src/App.tsx`. `RS` means `client/src/lib/route-shells.ts`.

## 1. The route table

`pnpm run route:validate` (exit 0):

```
=== Route Registry Validation ===
Found 75 routes in App.tsx
Found 75 rows in infra/route-surface-classification.yaml
Found 75 ACTIVE routes in docs/route-registry.md
✅ All routes are properly documented!
```

The 75 routes are made up as follows:

| Group | Count | Where |
|---|---|---|
| Student routes, keyed in `STUDENT_ROUTE_SHELLS` | 23 | `RS:120-170` |
| Non-student literal routes, each with a reason in `SHELL_EXCLUDED_ROUTES` | 24 | `RS:194-229`, plus the 404 key `*` (`RS:228`) |
| Content pages, mounted from `CONTENT_PAGE_PATHS` | 22 | `App.tsx:264-266` (public marketing, SEO) |
| Guardian routes, mounted from `GUARDIAN_ROUTES` | 6 | `App.tsx:524-534` → `client/src/features/guardian/routes.tsx:29-35` (each in `GuardianShell`) |
| The 404 catch-all | no path | `App.tsx:537` → `NotFoundRoute` (`App.tsx:142-147`, a `BareCard`) |

**Shell test.** `pnpm exec vitest run client/src/lib/route-shells.test.tsx`:

```
 Test Files  1 passed (1)
      Tests  61 passed (61)
```

Per the test's own header (`RS:8-13`), it parses App.tsx and renders the real `Router`. It proves that every declared route is either in the table or in `SHELL_EXCLUDED_ROUTES` (never both), and that each student route renders inside exactly the shell named for it.

**The frame.** Every student route is wrapped like this:

```
RequireRole (lazy, App.tsx:42-46) > StudentRouteFrame (lazy, App.tsx:55-59;
client/src/components/layout/StudentRouteFrame.tsx:36) > page
```

There are two exceptions. `/login` and `/account/recover` have no `RequireRole`: each is wrapped in `StudentRouteFrame` at module scope (`App.tsx:118-131`). The 404 is framed by `NotFoundRoute` (`App.tsx:142-147`). `StudentRouteFrame` leaves a **guardian** viewer unwrapped on the shared routes `/profile` and `/notifications` (`StudentRouteFrame.tsx:47`); those pages draw `GuardianShell` themselves (`client/src/pages/UserProfile.tsx:106`, `client/src/pages/notifications.tsx:66-73`).

**Endpoints the frame calls on every student route.** These are not repeated in the per-page rows below.
- `GET /api/profile`: `RequireRole.tsx:59` → `client/src/hooks/useProfileQuery.ts:99`.
- `POST /api/legal/reaccept`: `client/src/components/legal/ReconsentModal.tsx:110`, when re-consent is due.
- On `app`-shell routes only, the notification bell (`client/src/components/layout/app-shell.tsx:512` → `client/src/components/notifications/NotificationBell.tsx:164-191`) calls `GET /api/notifications/unread-count`, `GET /api/notifications`, `POST /api/notifications/mark-all-seen` and `PATCH /api/notifications/:id` (`client/src/lib/notificationsApi.ts:64,80,86,109`).
- `GET /api/csrf-token` (`client/src/lib/csrf.ts:10`) runs before each write.

## 2. Student routes (23 keyed, plus 3 direct Bare surfaces)

"Body chrome" means a header, rail, sidebar, back link, page-level card shell or `<main>` that the page body draws in addition to its shell. I searched each page file for `<header|<aside|<nav|<footer|<main|PageCard|page-card|min-h-screen|h-screen|Back to|history.back|←|@/components/ui/card|ExamHeader|LeftRail|TopBar` and read each hit. The command is in §4.

The endpoint lists name what each page calls through its own hooks. The hook call site in the page is given first, then the request line in the caller module. The frame's calls above are left out.

| Route (App.tsx) | Guard | Shell (`RS`) | Page file | Body chrome | Endpoints (call site → request) |
|---|---|---|---|---|---|
| `/dashboard` (296-305) | student, admin | app, panel 360, footer, unlocked (`RS:124`) | `pages/lyceon-dashboard.tsx` → `components/home/FreeHome.tsx` / `PaidHome.tsx` | **None.** `AppShellPanel` (FreeHome:275, PaidHome:337) is the shell's right-panel slot, not chrome of its own | Free: `useHomeProjection` (FreeHome:100) → `GET /api/progress/projection` (`lib/projectionApi.ts:149`) + `GET /api/students/:id/projections/sections` (`projectionApi.ts:141`); `useActiveSessions` (:101) → `GET /api/practice/sessions/open`, `POST …/:id/terminate` (`hooks/useActiveSessions.ts:36,45`); `usePracticeQuota` (:102) → `GET /api/practice/quota` (`hooks/usePracticeQuota.ts:29`); `useDiagnosticStart` (:103) → `POST /api/practice/diagnostic/sessions` (`hooks/useDiagnosticStart.ts:54`). Paid: `useCalendar` (PaidHome:123) → `GET /api/calendar` (`features/calendar/api/client.ts:162`); `fetchMasteryDomains` (:126) → `GET /api/students/:id/mastery/domains` (`lib/masteryApi.ts:77`); `fetchExamForms` (:133) → `GET /api/tests/forms` (`features/exam/api/exam-api.ts:119`); `useActiveSessions` (:129); `useActiveReviewSessions` (:130) → `GET /api/review/sessions/open` (`hooks/useReview.ts:254`); `useReviewPool` (:136) → `GET /api/review/pool` (`useReview.ts:86`); `useHomeProjection` (:137); `useLaunchBlock` (:138) → `POST /api/calendar/blocks/:id/launch` (`client.ts:342`); `useCreateReviewSession` (:143) → `POST /api/review/sessions` (`useReview.ts:340`) |
| `/practice` (316-325) | student, admin | app, 360, footer, unlocked (`RS:126`) | `pages/practice.tsx` | **None of its own.** At quota it renders the shipped `PremiumUpgradePrompt` (`practice.tsx:430`), whose shadcn card shell is **held by UI-65** (open) | `usePracticeTopics` (:122) → `GET /api/practice/topics` (`hooks/usePracticeTopics.ts:25`); `usePracticeQuota` (:123); `useActiveSessions` (:124); `useReviewPool` (:125); `fetchMasteryDomains` (:128); `usePractice().startSession` (:131,155) → `POST /api/practice/sessions` (`hooks/usePractice.ts:120`); `PremiumUpgradePrompt` → `GET /api/billing/status` (`PremiumUpgradePrompt.tsx:144` → `hooks/useBillingStatusQuery.ts:49`) |
| `/practice/topics` (326-335) | student, admin | app, no panel, no footer, **light lock** (`RS:127`) | `pages/browse-topics.tsx` | **Yes: the old page body.** "Back to Practice" ghost link (`:124-128`); `PageCard` ×5 (`:4,139,266,274,282,297`); shadcn `Card` (`:8`); `container mx-auto px-4 py-8 max-w-6xl` (`:121`); `text-xs` (`:325`). **Held by OQ-3** (open) | `GET /api/practice/topics` (`:57`); `GET /api/practice/reference/questions` (`:79-89`) |
| `/practice/session/:sessionId` (345-354) | student, admin | focus "Practice" → `/practice`, unlocked (`RS:156`) | `pages/resume-practice.tsx` → `components/practice/CanonicalPracticePage.tsx` | **None.** The error and closed states are `RunnerStateCard` inside the shell (`resume-practice.tsx:84-124`). The runner's `<footer>` (`CanonicalPracticePage.tsx:677`) is its answer bar | `GET /api/practice/sessions/:id/state` (`resume-practice.tsx:70`). The runner, through `useCanonicalPractice` (`CanonicalPracticePage.tsx:268`) and `lib/engine-config.ts:155-162`: `POST /api/practice/sessions`, `POST …/:id/resume`, `GET …/:id/next`, `POST /api/practice/answer`, `POST …/:id/skip`, `POST …/:id/calculator-state` |
| `/review` (416-425) | student, admin | app, 360, footer, unlocked (`RS:129`) | `pages/review.tsx` | **None** | `useReviewPool` (:147); `useActiveReviewSessions` (:148) → open + `POST …/:id/terminate` (`useReview.ts:263`); `useCreateReviewSession` (:149); `usePracticeTopics` (:150); `fetchMasteryDomains` (:153) |
| `/review/session/:sessionId` (426-435) | student, admin | focus "Review" → `/review`, unlocked (`RS:157`) | `pages/resume-review.tsx` → `CanonicalPracticePage` | **None** (`RunnerStateCard` states, `resume-review.tsx:84-124`) | `GET /api/review/sessions/:id/state` (`resume-review.tsx:64`); runner via `engine-config.ts:204-211` (create, resume, next, answer, skip, calculator-state); the LISA panel → `/api/tutor/*` (`hooks/tutor-client.ts:166`) |
| `/tests` (356 → `TestsHomeRoute` 80-88) | student, admin | app, 360, footer, unlocked (`RS:131`) | `features/exam/pages/TestsHomePage.tsx` | **None** (`AppShellPanel` at `:273` is the panel slot) | `GET /api/tests/forms` (`:155-156`); `GET /api/tests/sessions?state=scored` (`:161-162` → `exam-api.ts:196`); `GET /api/tests/sessions/:id/state` (`:172-173` → `exam-api.ts:126`); `fetchMasteryDomains` (`:178-179`); `createExamSession` (`:548`) → `POST /api/tests/sessions` (`exam-api.ts:247`) |
| `/tests/:sessionId` (362 → 89-97) | student, admin | focus "Full-Length" → `/tests`, unlocked (`RS:160`) | `features/exam/pages/ExamSessionPage.tsx` | **None.** No `<header>` or `<main>` in the page; the original's local `Shell` is gone | `fetchExamSession` (`:49`) → state; `fetchExamForms` (`:194`) → `GET /api/tests/forms`; `startExamModule` (`:121`) → `POST …/sections/:s/modules/:m/start` (`exam-api.ts:259`) |
| `/tests/:sessionId/:section/:module` (358-361 → 98-106) | student, admin | focus "Full-Length", **no back arrow, light for good** (`RS:161`; DESIGN.md §2:57) | `features/exam/pages/ExamModulePage.tsx` | **Sanctioned Bluebook layout** (DESIGN.md §2:57): `ExamHeader` (section, module, timer, tools; `:580`, `features/exam/components/ExamHeader.tsx:27`) and a footer bar (`:693`). **It also draws a `<main>` (`:595`) inside the Focus shell's `<main>` (`components/layout/FocusShell.tsx:137`): finding F-3** | `fetchExamSession` (`:128`); `fetchModuleItems` (`:177`) → `…/items` (`exam-api.ts:136`); `fetchModuleWorkspace` (`:182`) → `GET …/workspace` (`:147`); `startExamModule` (`:305`); `sendExamHeartbeat` (`:333`) → `…/heartbeat` (`:308`); `submitExamAnswer` (`:388`) → `POST /api/tests/answer` (`:284`); `saveItemWorkspace` (`:429`) → `PUT …/workspace` (`:295`); `submitExamModule` (`:528`) → `…/submit` (`:273`) |
| `/tests/:sessionId/report` (357 → 107-115) | student, admin | focus "Full-Length", unlocked (`RS:162`) | `features/exam/pages/ExamReportPage.tsx` | **None.** The original's local header is gone | `fetchExamReport` (`:83`) → `GET …/report` (`exam-api.ts:163`); `fetchExamReportStatus` (`:92`) → `GET …/report/status` (`:176`) |
| `/score-report` (368-377) | student, admin | focus "Full-Length" → `/tests`, **light lock** (focus default, `RS:163` and `RS:100-113`) | `pages/score-report.tsx` | **Yes: three `<main>` containers of its own** inside the Focus shell's `<main>`: `<main className="p-6">Loading…</main>` (`:120`), `<main className="mx-auto max-w-xl p-6">` (`:128`) and `<main className="mx-auto max-w-xl space-y-8 p-6">` (`:158`), plus a page `<header>` (`:159`). Not on student tokens (`text-muted-foreground`, `:166`). **Finding F-2** (no register row rebuilds it) | `GET /api/score-report` (`:53,74`, default fetcher); `POST /api/score-report` (`:83`); `POST /api/score-report/renewal` (`:105`) |
| `/calendar` (379-388) | student, admin | app, panel 340, full width, unlocked (`RS:135`) | `pages/calendar.tsx` → `features/calendar/CalendarView.tsx` / `components/FreeCalendar.tsx` | **None for the student.** The student path draws `StudentCalendarHeader`, a page header inside the full-width content (`features/calendar/components/StudentChrome.tsx:74,99`), as `RS:55-58` allows for `full` pages. `LeftRail`/`TopBar` (`CalendarView.tsx:774,799`) are the **guardian** surface only (`CalendarView.tsx:769`) | `useStudyProfile` (`:122`) → `GET /api/calendar/profile` (`client.ts:175`); `useCalendar` (`:126`) → `GET /api/calendar`; `useEditDay` (`:151`) → `PUT /days/:date` (`:239`); `useMoveBlock` (`:152`) → `POST /blocks/:id/move` (`:258`); `useRegeneratePlan` (`:153`) → `/plan/regenerate` (`:273`); `useRegenerateDay` (`:154`) → `/days/:date/regenerate` (`:289`); `useResetDay` (`:155`) → `/days/:date/reset` (`:305`); `useDoItNow` (`:156`) → `/blocks/:id/do-it-now` (`:321`); `useAcknowledge` (`:157`) → `/acknowledge` (`:357`); `useStudyProfileMutation` (`:158`) → `PUT /profile` (`:222`); `useLaunchBlock` (`:159`) → `/blocks/:id/launch` (`:342`); `FullLengthFields` → `GET /api/tests/forms` (`features/calendar/components/FullLengthFields.tsx:57`) |
| `/chat` (306-315) | student, admin | app, panel 320, full width, unlocked (`RS:138`) | `pages/chat.tsx` | **None.** `<header>` at `:448` is the LISA page's title row inside the full-width content (`RS:55-58`); no sidebar, rail or back link. The original's `<aside>` and Sheet are gone | `useConversation` (`:234`) → `GET /api/tutor/conversations/:id` (`tutor-client.ts:248`); `useConversations` (`:242`) → `GET …/conversations` (`:280`); `useCreateConversation` (`:243`) → `POST …/conversations` (`:205`); `useEndConversation` (`:244`) → `POST …/:id/end` (`:343`); `useTutorTurn` (`:285`) → `POST /api/tutor/messages` (`:226`), `POST …/:id/resume` (`hooks/useTutorTurn.ts:278` → `tutor-client.ts:403`) |
| `/mastery` (395-404) | student, admin | app, no panel, no footer, unlocked (`RS:141`) | `pages/mastery.tsx` | **None.** The original's "Back" button (`window.history.back()`) is gone (search output in §4: no hit) | `fetchMasteryDomains` (`:107-108`); `fetchMasterySkills` (`:114-115`) → `GET /api/students/:id/mastery/skills` (`masteryApi.ts:95`) |
| `/upgrade` (405-414) | student, admin | app, no panel, no footer, unlocked (`RS:145`) | `pages/upgrade.tsx` | **None** | `GET /api/billing/plans` (`:98-99` → `lib/billing-client.ts:115`); `startSubscriptionCheckout` (`:136`) → `POST /api/billing/checkout` (`billing-client.ts:157`) |
| `/profile` (437-446) | student, guardian, admin | app, no panel, footer, unlocked (`RS:146`). A guardian gets `UserProfile` in `GuardianShell` (`App.tsx:189-192`) | `pages/settings.tsx` (student, admin) | **None.** `<nav aria-label="Settings sections">` (`settings.tsx:84`) is the in-page section list | Billing: `useBillingStatusQuery` (`components/settings/BillingSection.tsx:65`), `useBillingPortal` (`:92`) → `POST /api/billing/portal` (`billing-client.ts:180`). Account: `changePassword` (`AccountSection.tsx:110` → `lib/settings-api.ts:72`, `POST /api/auth/change-password`); `EmailNotificationsCard` → `GET /api/account/email-suppression` (`components/account/EmailNotificationsCard.tsx:33`), `POST …/clear` (`:67`); `DeleteAccountBox` → `POST /api/account/delete` (`components/account-deletion/DeleteAccountCard.tsx:53`); `MarketingEmailCard` → `PUT /api/profile/marketing-consent` (`lib/product-feedback-api.ts:91`); `FeedbackSettingsRow` → `/api/feedback/*`. Profile: `useStudyProfile` and `useStudyProfileMutation` (`ProfileSection.tsx:55,105`) → `GET`/`PUT /api/calendar/profile`; name → `PATCH /api/profile/name` (`settings-api.ts:56`). Link: `StudentLinkCodePanel` → `GET …/link-code`, `POST …/regenerate`, `POST …/invite` (`components/student/StudentLinkCodePanel.tsx:63,85,115`); `StudentGuardiansPanel` → `GET …/links`, `DELETE …/links/:id` (`StudentGuardiansPanel.tsx:44,87`) |
| `/help` (450-459) | student, admin | app, no panel, footer, unlocked (`RS:147`) | `pages/help.tsx` | **None** | `FeedbackButton` (`help.tsx:31`, from `components/product-feedback/FeedbackDialog.tsx`) → `POST /api/feedback/feedback` (`product-feedback-api.ts:158`) |
| `/notifications` (493-502) | student, guardian, admin | app, no panel, no footer, unlocked (`RS:148`). A guardian gets `GuardianShell` (`notifications.tsx:66`) | `pages/notifications.tsx` | **None** | `fetchNotificationsPage` (`:87`) → `GET /api/notifications`; `mark-all-read` and `PATCH /:id` (`notificationsApi.ts:96,109`) |
| `/login` (240 → `LoginRoute` 118-124) | none | bare, unlocked (`RS:165`, `RS:118`) | `pages/login.tsx` | **None** | `SupabaseAuthContext.tsx:372,439,543`: `POST /api/auth/signup`, `/signin`, `/reset-password`; Google OAuth via `supabase.auth.signInWithOAuth` |
| `/profile/complete` (471-480) | student, guardian, admin | bare (`RS:166`) | `pages/profile-complete.tsx` | **None** | `GET /api/profile` (`:120`); `PATCH /api/profile` (`:164`) |
| `/update-password` (481-490) | student, guardian, admin | bare (`RS:167`) | `pages/update-password.tsx` | **None** | `updatePassword` (`:67`) → `POST /api/auth/update-password` (`SupabaseAuthContext.tsx:566`) |
| `/account/recover` (492 → 125-131) | none (token) | bare (`RS:168`) | `pages/account-recover.tsx` | **None** | `POST /api/account/recover-deletion` (`:38`) |
| `/guardian-required` (461-470) | student | bare (`RS:169`) | `pages/guardian-required.tsx` | **None** | link-code panel and guardian list (as on `/profile`); `signOut` (`:98`) → `POST /api/auth/signout` (`SupabaseAuthContext.tsx:518`) |
| 404 (537) | none | bare, framed by `NotFoundRoute` (`App.tsx:142-147`) | `pages/not-found.tsx` | **None** | none |
| error screen | — | bare (`App.tsx:568-588`) | `App.tsx` `ErrorBoundary` | **None** | none |
| pending deletion | — | bare (`App.tsx:610-616`) | `components/account-deletion/PendingDeletionScreen.tsx` | **None** | `POST /api/account/cancel-deletion` (`:40`) |

## 3. Shell treatments compared with the original §6.1

| Original treatment (§6.1, on student surfaces) | Status at `d8d8a3c1` |
|---|---|
| 1. AppShell + Footer | Replaced by `app` with `footer: true` (`RS:124,126,129,131,146,147`) |
| 2. AppShell, no Footer | Replaced by `app` with `footer: false` (`RS:127,135,138,141,145,148`) |
| 3. PracticeShell | Gone. Runners are `focus` (`RS:156-157`). `grep -rn PracticeShell client/src` finds only a comment (`CanonicalPracticePage.tsx:21`) |
| 4. Exam local shells (`Shell`, `ReportLayout`, `ExamHeader`) | `Shell` and `ReportLayout` are gone (no `<header>` or `<main>` in `ExamSessionPage.tsx` or `ExamReportPage.tsx`). `ExamHeader` stays inside `focus` as the Bluebook bar (DESIGN.md §2:57) |
| 5. Calendar chrome (LeftRail + TopBar) | Guardian only (`CalendarView.tsx:769-799`). The student calendar is `app` (`RS:135`) |
| 6. Chat local sidebar and header | Gone. `/chat` is `app` with a 320 panel (`RS:138`); one title row (`chat.tsx:448`) |
| 7. No shell (bare centered layouts) | Replaced by `bare` (`RS:118,165-169`; `App.tsx:142-147,568-588,610-616`) |

**Result: 3 shell treatments on student surfaces** (`RS:36`: `"app" | "focus" | "bare"`), down from 7.

## 4. Search commands

```bash
# body chrome, one search per page file (output summarised in §2)
grep -nE '<header|<aside|<nav\b|<footer|PageCard|page-card|min-h-screen|h-screen|Back to|history\.back|"← |←|@/components/ui/card|>Lyceon<|ExamHeader|LeftRail|TopBar|StudentChrome' <page>
# nested <main> in student pages
git grep -nE '<main' -- 'client/src/pages/**' 'client/src/features/**' 'client/src/components/**' ':!*.test.*'
#   client/src/features/exam/pages/ExamModulePage.tsx:595:      <main className="flex min-h-0 flex-1">
#   client/src/pages/score-report.tsx:120:    return <main className="p-6">Loading…</main>;
#   client/src/pages/score-report.tsx:128:      <main className="mx-auto max-w-xl p-6">
#   client/src/pages/score-report.tsx:158:    <main className="mx-auto max-w-xl space-y-8 p-6">
#   (plus the shells: app-shell.tsx:555,569; FocusShell.tsx:137; BareCardShell.tsx:53; GuardianShell.tsx:68;
#    PublicLayout.tsx:26; and the public pages legal-doc.tsx:159, legal.tsx:64, trust.tsx:33)
# shadcn card shells left in student-rendered files
grep -rlnE "@/components/ui/card|common/page-card|PageCard" client/src --include=*.tsx | grep -v "\.test\."
#   student-rendered: pages/browse-topics.tsx (OQ-3), components/billing/PremiumUpgradePrompt.tsx (UI-65);
#   review.tsx matches only a comment (:35); the rest are guardian, admin, legal or trust pages
```
