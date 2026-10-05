# Wave 5 deletion proofs (UI-41 to UI-46, UI-50 to UI-59)

Owner ruling (Karl, standing): the old UI is deleted in the same commit that replaces it, with
grep and knip proof. This file holds that proof for every page group on
`claude/student-ui-wave4` (combined draft PR #1073), plus the three leftovers that knip found
orphaned and that were deleted on `claude/ui-deletion-proofs`.

- **Base:** `claude/student-ui-wave4` at `f2c709e7`.
- **Comparison point for "orphaned by Wave 4/5":** `origin/cleanup` at `af256961`, the merge
  base. Nothing from #1073 is on it yet.
- **Recorded:** 2026-10-05.

## How to read the greps

Each check matches a **whole token** (`grep -w`, fixed string), so a sibling such as
`skill-row-header` cannot satisfy a check for `skill-row`. `G` is:

```bash
G() { grep -rnwF --exclude='*.test.ts' --exclude='*.test.tsx' --exclude-dir='__snapshots__' -- "$1" client/src packages/shared/src; }
```

- **Tests are excluded from `G`.** The rebuilt pages' tests name the removed items on purpose,
  in absence assertions such as `not.toContain("Domain Library")`. Where a test file names an
  item, the output says how many test files do.
- **A file-scoped check** (`grep -nwF -- TOKEN FILE`) is used where the item still exists
  legitimately elsewhere. For example, `DomainGrid` is the guardian Dashboard's, so the proof is
  that the student page no longer uses it.
- **A file check** is `test -e PATH; echo $?`, where `1` means the file is gone.
- **Comment-only hits:** a hit inside a `/** ... */` block is the rebuilt page's own
  `@spec … Replaces …` annotation naming what it replaced. Those hits are listed as such.

---

## UI-41: App shell, Focus shell, Bare card

**Commits**
- `f44e1ea0` UI-41: App shell (rail with lock states), Focus shell, Bare card, route table
- `4f6ce019` ci(review-ui-gate): re-point U8 to the UI-41 rail; register UI-41

**Removed**
- The old top-bar `AppHeader` and its mobile Sheet menu: `button-mobile-menu`,
  `button-profile-mobile` and `button-signout-mobile`.
- The two tests that pinned the old nav: `app-shell.calendar-nav.test.tsx` and
  `app-shell.nav-anchors.test.tsx`.

**Proof:**

```text
$ G 'AppHeader'
(empty)
$ G 'button-mobile-menu'
(empty)
$ G 'button-profile-mobile'
(empty)
$ G 'button-signout-mobile'
(empty)
$ test -e client/src/components/layout/app-shell.calendar-nav.test.tsx; echo $?
1
$ test -e client/src/components/layout/app-shell.nav-anchors.test.tsx; echo $?
1
```

**Still present:** nothing.

## UI-42: Mastery row component

**Commits**
- `6ea89d41` feat(student-ui): UI-42 mastery row and locked mastery card on the level-ramp tokens
- `ba0c854a` fix(student-ui): keep MasteryMeter helpers module-private (guardian dead-code gate)

**Removed:** nothing. The row adds `MasteryRow`, `LockedMasteryCard` and `MasteryMeter`. The
pages adopted them in UI-50, UI-51, UI-52, UI-54 and UI-57, and the old page-level mastery
rendering went in those rows (see UI-57 for `DomainGrid`, `SkillPanel` and `LevelPill` on
`/mastery`).

## UI-43: Filter bar component

**Commits**
- `debe6879` feat(student-ui): shared filter bar with pure cascade rules (UI-43)
- `bc27ec8e` (UI-51), which brought `FilterBarValue` onto `SessionCriteria`

**Removed:** the separate `FilterBarValue` shape. It is now an alias of the canonical
`SessionCriteria` (OQ-22), so only one shape exists:

```text
$ grep -nwF -- 'export type FilterBarValue' client/src/components/student-ui/filter-bar/filter-cascade.ts
55:export type FilterBarValue = SessionCriteria;
```

The old practice and review chip rows went in UI-51 and UI-52.

## UI-44: Upgrade modal

**Commit:** `eb8cf52a` feat(student-ui): upgrade modal keyed by feature, opened on any
entitlement denial (UI-44)

**Removed:** nothing. The per-page premium prompts that the modal superseded went with their
pages: `CalendarPremiumGate` in UI-55, `PremiumUpgradePrompt` and `RecoveryNotice` on
`/mastery` in UI-57, and the dashboard's `PremiumUpgradePrompt` in UI-50.

## UI-45: Shared keyboard hook

**Commit:** `2ab0f10e` feat(ui-45): one shared keyboard hook for runner, exam module, LISA and
overlays

**Removed:** the two hand-rolled `window.addEventListener("keydown", …)` listeners, in
`ReconsentModal.tsx` and `SetupPopup.tsx`. The only `addEventListener("keydown"` left in
non-test `client/src` is the hook's own (`client/src/hooks/useKeyboardShortcuts.ts:231`).

```text
$ grep -nwF -- 'addEventListener' client/src/components/legal/ReconsentModal.tsx
(empty)
$ grep -nwF -- 'addEventListener' client/src/features/calendar/components/SetupPopup.tsx
(empty)
```

## UI-46: Shared primitives

**Commits**
- `3d43f805` feat(student-ui): shared primitives for the student UI (UI-46)
- `3be69626` refactor(student-ui): one full-page loader replaces six duplicates (UI-46)

**Removed:** the six duplicate full-page spinners listed in audit §6.2 ("Full-page spinner"):

- `App.tsx` `PageLoader`
- `RequireRole.tsx`
- `UserProfile.tsx`
- `profile-complete.tsx`
- `resume-practice.tsx`
- `resume-review.tsx`

Each now renders `FullPageLoader`.

```text
$ G 'PageLoader'
(empty)
# test files naming it (absence assertions / fixtures): 1
$ grep -nwF -- 'Loader2' client/src/App.tsx
(empty)
$ grep -nwF -- 'Loader2' client/src/components/auth/RequireRole.tsx
(empty)
$ grep -nwF -- 'Loader2' client/src/pages/UserProfile.tsx
(empty)
$ grep -nwF -- 'Loader2' client/src/pages/profile-complete.tsx
(empty)
$ grep -nwF -- 'Loader2' client/src/pages/resume-practice.tsx
(empty)
$ grep -nwF -- 'Loader2' client/src/pages/resume-review.tsx
(empty)
```

**Still present:** the rest of audit §6.2 (button, card, page header and the others) is not a
UI-46 removal. Those duplicates go with the page rows below, and the pages they lived on have
been rebuilt.

---

## UI-50: Home (`/dashboard`)

**Commit:** `54e1caa6` feat(student-ui): UI-50 Home on the new shell; F-65 modal theme lock
(register `b47ac6f2`)

**Removed** (PR #1078):
- the weekly summary;
- the "Score Estimate" card;
- the Practice and Review tiles;
- "Score Trend Analysis" with `ScoreSnapshotRow`;
- the "Alpha" recommendations card with "Ask Lisa";
- `DiagnosticPromptModal`;
- the page's KPI read;
- its `PremiumUpgradePrompt` and `RecoveryNotice`;
- the two old-page tests.

```text
$ G 'DiagnosticPromptModal'
(empty)
$ G 'ScoreSnapshotRow'
(empty)
$ G 'button-dashboard-ask-lisa'
(empty)
$ G 'Weekly Progress Summary'
(empty)
$ G 'Questions Solved (7d)'
(empty)
$ G 'Current Streak (days)'
(empty)
$ G 'Score Estimate'
client/src/pages/lyceon-dashboard.tsx:18: * Replaces the pre-redesign dashboard (weekly summary card, "Score Estimate" card, Practice and
$ G 'Score Trend Analysis'
client/src/pages/lyceon-dashboard.tsx:19: * Review tiles, "Score Trend Analysis", the "Alpha" recommendations card, the diagnostic prompt
$ G 'View Full Breakdown'
(empty)
$ G 'Personalized Recommendations'
(empty)
$ G 'Recommendation model wiring in progress'
(empty)
$ G 'Rebuilding from live data'
(empty)
$ G 'Start a focused SAT block'
(empty)
$ test -e client/src/components/diagnostic/DiagnosticPromptModal.tsx; echo $?
1
$ test -e client/src/pages/lyceon-dashboard.no-confidence.test.tsx; echo $?
1
$ test -e client/src/pages/lyceon-dashboard.no-raw-accuracy.test.tsx; echo $?
1
$ grep -nwF -- 'useProgressKpis' client/src/pages/lyceon-dashboard.tsx
(empty)
$ grep -nwF -- 'PremiumUpgradePrompt' client/src/pages/lyceon-dashboard.tsx
(empty)
$ grep -nwF -- 'RecoveryNotice' client/src/pages/lyceon-dashboard.tsx
(empty)
```

**Still present:** "Score Estimate" and "Score Trend Analysis" appear only in the
`lyceon-dashboard.tsx` header comment that records what the page replaced.

**Leftover deleted on this branch:** `client/src/test-support/student-kpi.harness.ts`, in
`3f8e1b5c` (see UI-51). Its first consumer was `lyceon-dashboard.no-raw-accuracy.test.tsx`,
deleted here.

## UI-51: Practice (`/practice`)

**Commit:** `bc27ec8e` feat(student-ui): UI-51 Practice on the new shell; Domain Library
retired (register `fe37f68d`)

**Removed** (PR #1079):
- the Domain Library card and its "Open Topic Explorer" link;
- `DiagnosticCTAGate` and `DiagnosticCTACard`;
- the "Weekly Activity" block (day streak, questions in 7 days);
- "Quick Actions";
- the "Practice Center" eyebrow and "Deliberate SAT Practice" title;
- "Session Setup" with its question-count Select;
- `fetchScoreEstimate`;
- the page's KPI read;
- two old-page tests.

```text
$ G 'DiagnosticCTAGate'
(empty)
$ G 'DiagnosticCTACard'
client/src/pages/resume-practice.tsx:27: * (the former `DiagnosticCTACard`, removed in UI-51) landed a student on a "Continue" that the server
$ G 'fetchScoreEstimate'
(empty)
$ G 'Domain Library'
client/src/pages/practice.tsx:33: * Reading/Math start buttons), the Domain Library card and its "Open Topic Explorer" link, the
# test files naming it (absence assertions / fixtures): 1
$ G 'Weekly Activity'
client/src/pages/practice.tsx:34: * "Weekly Activity" card (day streak, questions in 7 days), "Quick Actions", and the diagnostic
$ G 'Open Topic Explorer'
client/src/pages/practice.tsx:33: * Reading/Math start buttons), the Domain Library card and its "Open Topic Explorer" link, the
$ G 'Practice Center'
(empty)
$ G 'Deliberate SAT Practice'
(empty)
$ G 'Session Setup'
client/src/pages/practice.tsx:32: * Replaces the pre-redesign page: "Session Setup" (difficulty pills, domain and skill chips, the
$ G 'Quick Actions'
client/src/pages/practice.tsx:34: * "Weekly Activity" card (day streak, questions in 7 days), "Quick Actions", and the diagnostic
# test files naming it (absence assertions / fixtures): 1
$ G 'Math Domains'
(empty)
$ G 'practice-day-streak'
(empty)
$ G 'select-question-count'
(empty)
$ test -e client/src/components/diagnostic/DiagnosticCTAGate.tsx; echo $?
1
$ test -e client/src/components/diagnostic/DiagnosticCTACard.tsx; echo $?
1
$ test -e client/src/pages/practice.bank-counts.test.tsx; echo $?
1
$ test -e client/src/pages/practice.no-raw-accuracy.test.tsx; echo $?
1
$ test -e client/src/test-support/student-kpi.harness.ts; echo $?
1
$ grep -nwF -- 'useProgressKpis' client/src/pages/practice.tsx
(empty)
$ grep -nwF -- '/practice/topics' client/src/pages/practice.tsx
36: * `/practice/topics` itself stays routed (OQ-3 is open).
```

**Still present:**
- "Domain Library", "Weekly Activity", "Open Topic Explorer", "Session Setup" and "Quick
  Actions" appear only in `practice.tsx`'s header comment (lines 32-34).
- `DiagnosticCTACard` appears only in a `resume-practice.tsx` comment (line 27) about the
  former card.
- The `/practice/topics` hit is that comment's note that the route stays while OQ-3 is open.
  The link to it is gone.

**Leftover deleted on this branch:** `3f8e1b5c` UI-51: delete student-kpi.harness (old
Home/Practice KPI test scenario, orphaned by UI-50 and UI-51).
- **What it was:** `client/src/test-support/student-kpi.harness.ts`, the shared
  `/api/progress/kpis` scenario for the SCL-186 no-raw-accuracy render tests of the old Home and
  Practice pages.
- **Why it was orphaned:** its last consumer, `practice.no-raw-accuracy.test.tsx`, was deleted
  in `bc27ec8e`. knip listed the file under "Unused files", and
  `grep -rn 'student-kpi' client tests scripts docs` is empty.

## UI-52: Review (`/review`)

**Commits**
- `4b59c193` feat(student-ui): UI-52 Review on the new shell
- `55df35b4` fix(review): F-52 pool rows carry the four session criteria only
- `473d98a1` (register)

**Removed** (PR #1080):
- the "Review Queue" eyebrow and "Review Your Mistakes" title;
- "Open Review Sessions";
- "Continue your queue";
- the empty state's practice link;
- the `PageCard` layout;
- the inline taxonomy normalisation, which now comes from the shared `usePracticeTopics`.

```text
$ G 'Review Your Mistakes'
client/src/pages/review.tsx:34: * Replaces the pre-redesign page: the "Review Queue" eyebrow and "Review Your Mistakes" title,
$ G 'Open Review Sessions'
(empty)
$ G 'Continue your queue'
(empty)
$ G 'link-review-empty-practice'
(empty)
$ grep -nwF -- 'PageCard' client/src/pages/review.tsx
35: * the PageCard layout, the section Select with counts, the single-select domain and skill chips,
$ grep -nwF -- 'normalizePracticeTopicDomains' client/src/pages/review.tsx
(empty)
```

**Still present**
- "Review Your Mistakes" and `PageCard` appear only in `review.tsx`'s header comment.
- **Kept on purpose:** the error copy "Couldn't load your review queue" (`review.tsx:189`).
  It is shipped copy, now rendered through the student `Notice` primitive, and the rebuilt
  page's tests assert it.

## UI-53: Practice and review runners

**Commits**
- `353a5b09` feat(student-ui): UI-53 practice and review runners on the Focus shell; F-64
  fixed; OQ-35 note
- `728b7865` (register)

**Removed** (PR #1081):
- `PracticeShell` (eyebrow, stat chips, progress pill);
- the difficulty and domain badges;
- the "Session Guidance" card;
- End Session inside the runner;
- three old-runner tests.

```text
$ G 'PracticeShell'
client/src/components/practice/CanonicalPracticePage.tsx:21: * practice runner" header with its answered/streak chips and progress pill (the PracticeShell),
# test files naming it (absence assertions / fixtures): 1
$ G 'Session Guidance'
(empty)
# test files naming it (absence assertions / fixtures): 2
$ G 'End Session'
client/src/components/practice/CanonicalPracticePage.tsx:22: * the difficulty and domain badges, the "Session guidance" side card, and "End Session" (the
# test files naming it (absence assertions / fixtures): 2
$ test -e client/src/components/layout/PracticeShell.tsx; echo $?
1
$ test -e client/src/components/layout/PracticeShell.no-raw-accuracy.test.tsx; echo $?
1
$ test -e client/src/components/practice/CanonicalPracticePage.guidance.test.tsx; echo $?
1
$ test -e client/src/components/ui/progress.tsx; echo $?
1
$ grep -nwF -- 'Badge' client/src/components/practice/CanonicalPracticePage.tsx
(empty)
```

**Still present:** `PracticeShell` and "End Session" appear only in
`CanonicalPracticePage.tsx`'s header comment (lines 21-22).

**Leftover deleted on this branch:** `7786da75` UI-53: delete ui/progress (old runner UI,
orphaned by the UI-53 rebuild).
- **What it was:** `client/src/components/ui/progress.tsx`, whose only importer was
  `PracticeShell.tsx` (line 2 at `353a5b09^`).
- **Why it was orphaned:** knip listed it under "Unused files" in both default and
  `--production` mode.
- **Consequence:** `@radix-ui/react-progress` has had no live importer since `353a5b09`. It is
  a candidate for Karl, since dependency changes need approval.

## UI-54: Full-Length home, exam session and report

**Commits**
- `94226c59` feat(student-ui): UI-54 Full-Length home, exam session and report on the new
  shells
- `0b04236d` (register)

**Removed** (PR #1082):
- the old Tests home cards (`FormCard`) and start panel (`StartPanel`, `exam-start-panel`,
  `exam-forms`);
- from the report: its own header, the tabs (`ScoreTabs`), the disabled Review button ("Answer
  review is coming soon.") and "Attempt N";
- the session page's own "Lyceon" header;
- the duplicate in-progress set in `PaidHome` (`EXAM_IN_PROGRESS`, now `isExamInProgress`
  from `tests-home-model.ts`).

```text
$ G 'StartPanel'
(empty)
$ G 'FormCard'
(empty)
$ G 'exam-forms'
(empty)
$ G 'exam-start-panel'
(empty)
$ G 'Answer review is coming soon.'
(empty)
$ grep -nwF -- 'ScoreTabs' client/src/features/exam/pages/ExamReportPage.tsx
(empty)
$ grep -nwF -- 'attempt_number_for_form' client/src/features/exam/pages/ExamReportPage.tsx
(empty)
$ grep -nwF -- 'Lyceon' client/src/features/exam/pages/ExamSessionPage.tsx
85: * runs under goes in its context slot. Replaces the page's own "Lyceon" header bar.
$ grep -nwF -- 'EXAM_IN_PROGRESS' client/src/components/home/PaidHome.tsx
(empty)
$ grep -nwF -- 'IN_PROGRESS' client/src/features/exam/pages/TestsHomePage.tsx
(empty)
```

**Still present, moved and not removed:** `ScoreTabs` and `SectionCard` now live in
`features/exam/components/ExamReportParts.tsx`, because `GuardianExamResultsPage.tsx` (guardian)
still renders them. Out of scope: guardian code is not deleted here.

## UI-55: Calendar (`/calendar`)

**Commits**
- `d6ec0829` feat(student-ui): UI-55 calendar on the App shell, student tokens, free inline
  setup
- `ce04f6bc` (plants)
- `f33db5f8` (drops two unused imports)
- `46b949b0` (register)

**Removed** (PR #1083):
- the student's own rail and wordmark (`rail-schedule-card`, `rail-schedule-summary`);
- `TopBar`'s Edit schedule and Refresh plan slots;
- `CalendarPremiumGate`;
- the popup's free third panel (`calendar-setup-later`, `calendar-setup-upgrade`);
- dead CSS.

```text
$ G 'CalendarPremiumGate'
client/src/features/calendar/components/FreeCalendar.tsx:21: * Replaces the old free path, the setup popup's third panel and `CalendarPremiumGate`. The
$ G 'calendar-premium-gate'
(empty)
# test files naming it (absence assertions / fixtures): 1
$ G 'calendar-setup-later'
(empty)
$ G 'calendar-setup-upgrade'
(empty)
$ G 'rail-schedule-card'
(empty)
# test files naming it (absence assertions / fixtures): 1
$ G 'rail-schedule-summary'
(empty)
$ G 'Refresh plan'
client/src/features/calendar/components/Chrome.tsx:15: * schedule and Refresh plan controls (now the student header's). The guardian render is
client/src/features/calendar/components/Chrome.tsx:366: * L2 held the student's Edit schedule and Refresh plan until UI-55 moved the student calendar
client/src/features/calendar/components/Chrome.tsx:508:      {/* Kept, empty, so the header grid does not reflow: Edit schedule and Refresh plan were
client/src/features/calendar/api/mutations.ts:244:/** §12.1 `student_refresh` — the student's own `Refresh plan`. */
client/src/features/calendar/api/client.ts:291:/** §15 POST /api/calendar/plan/regenerate — the student's own `Refresh plan`. */
# test files naming it (absence assertions / fixtures): 3
```

**Still present**
- "Refresh plan" appears only in comments. Three are in `Chrome.tsx`, recording the move. The
  others are in `mutations.ts` and `client.ts` and name the server's `student_refresh` action,
  which Regenerate still calls.
- `CalendarPremiumGate` appears only in `FreeCalendar.tsx`'s header comment.
- `topbar-edit-schedule` was not removed. It is on the new student header
  (`StudentChrome.tsx:161`), which is where Edit schedule lives now.

**CSS check (calendar and student styles):** every class selector in `calendar.css`,
`calendar-student.css`, `student-tokens.css`, `index.css` and `exam.css` was checked for a
whole-token reference in non-test `.ts`/`.tsx`.
- `.kind-exam`, `.kind-math`, `.kind-review` and `.kind-rw` have no literal reference. They are
  built dynamically (`BlockSheet.tsx:131` `kind-${block.tone}`).
- The others are pre-existing: they were already unreferenced at `origin/cleanup`.
  - `calendar.css`: `.topdiv`
  - `index.css`: `.bg-brand-surface`, `.btn-base`, `.chat-scroll`, `.focus-ring`,
    `.progress-ring`, `.question-stem`
  - `exam.css`: `.exam-focus`

  They are listed under "pre-existing" below and not acted on.

## UI-56: LISA (`/chat`)

**Commits**
- `92096751` feat(student-ui): UI-56 LISA on the App shell, student tokens, free and under-13
  states
- `c8402518` (register)

**Removed** (PR #1085):
- the old left sidebar (`SessionsListContent`);
- the mobile sessions drawer (Sheet trigger);
- "Welcome to LISA" (`NewSessionView`);
- the subject shortcuts ("What are we working on?");
- the header subject and time;
- "Load more sessions".

```text
$ G 'NewSessionView'
(empty)
$ G 'SessionsListContent'
(empty)
$ G 'button-load-more-sessions'
(empty)
$ G 'Welcome to LISA'
client/src/pages/chat.tsx:44: * "Sessions", the mobile sessions drawer, the "Welcome to LISA" empty state, the "What are we
# test files naming it (absence assertions / fixtures): 1
$ G 'What are we working on?'
(empty)
$ G 'Pick a section to start, or just ask a question below.'
(empty)
$ G 'Load more sessions'
client/src/pages/chat.tsx:45: * working on?" subject shortcuts, the header's subject and start time, and "Load more sessions".
$ grep -nwF -- 'SheetTrigger' client/src/pages/chat.tsx
(empty)
```

**Still present**
- "Welcome to LISA" and "Load more sessions" appear only in `chat.tsx`'s header comment.
- **Kept on purpose:** `EndSessionModal`. The end-session confirm stays, with corrected text
  (OQ-57 (b)).

## UI-57: Mastery (`/mastery`)

**Commits**
- `09a6f5b6` feat(student-ui): UI-57 Mastery on the App shell, student tokens, free locked
  card
- `4696f9c7` (e2e)
- `facf4526` (register)

**Removed** (PR #1086):
- the in-body Back button (`panel-back`, `ArrowLeft`);
- the "Mastery" eyebrow;
- the `DomainGrid` cards on this page;
- the separate skills screen (`SkillPanel`, `skill-panel`, `skill-row`, "All domains");
- `PremiumUpgradePrompt` and `RecoveryNotice` on this page;
- `mastery.identity.test.tsx` and its snapshot.

```text
$ G 'SkillPanel'
(empty)
$ G 'panel-back'
(empty)
$ G 'skill-panel'
(empty)
$ G 'skill-row'
(empty)
$ G 'All domains'
client/src/pages/mastery.tsx:34: * (`DomainGrid`, still the guardian Dashboard's), the separate skill screen with its "All domains"
# test files naming it (absence assertions / fixtures): 1
$ grep -nwF -- 'DomainGrid' client/src/pages/mastery.tsx
34: * (`DomainGrid`, still the guardian Dashboard's), the separate skill screen with its "All domains"
$ grep -nwF -- 'PremiumUpgradePrompt' client/src/pages/mastery.tsx
35: * button, `PremiumUpgradePrompt` and `RecoveryNotice`.
$ grep -nwF -- 'RecoveryNotice' client/src/pages/mastery.tsx
35: * button, `PremiumUpgradePrompt` and `RecoveryNotice`.
$ grep -nwF -- 'ArrowLeft' client/src/pages/mastery.tsx
(empty)
$ G 'isEntitlementDenialError'
client/src/lib/api-error.ts:208:function isEntitlementDenialError(error: unknown): boolean {
client/src/lib/api-error.ts:254:  if (isEntitlementDenialError(error)) return false;
$ test -e client/src/pages/mastery.identity.test.tsx; echo $?
1
$ test -e client/src/pages/__snapshots__/mastery.identity.test.tsx.snap; echo $?
1
```

**Still present**
- `DomainGrid`, `PremiumUpgradePrompt`, `RecoveryNotice` and "All domains" appear in
  `mastery.tsx` only in its header comment (lines 34-35).
- `DomainGrid` itself stays, because the guardian Dashboard renders it
  (`GuardianDashboardTab.tsx`, `GuardianTemplatePreview.tsx`).
- `PremiumUpgradePrompt` stays, because `practice.tsx` (daily-limit card, OQ-52 (c)) and
  `LisaUpgradeCard.tsx` render it.
- `RecoveryNotice` stays, because `browse-topics.tsx` (`/practice/topics`, kept while OQ-3 is
  open) and the guardian `UserProfile.tsx` render it.

**Leftover deleted on this branch:** `c8e543d8` UI-57: un-export isEntitlementDenialError (old
mastery page's denial check, orphaned by the UI-57 rebuild).
- **Why it was orphaned:** the old `/mastery` page was the only importer outside
  `api-error.ts` (`origin/cleanup:client/src/pages/mastery.tsx:8`, `:226`).
- **Why only the export went:** the function itself is still called by `isSessionError`
  (`api-error.ts:254`), so only the `export` keyword was removed. The two remaining hits above
  are that definition and that call.

## UI-58: Upgrade, profile, notifications (and Help)

**Commits**
- `5ff5a1f7` feat(student-ui): UI-58 Settings, Help, Notifications and the plans page on the
  App shell
- `ea354b15` (test)
- `5747e261` (register)

**Removed** (PR #1087):
- the student branch of the old `UserProfile.tsx`: the progress tab and its stats
  (`tab-progress`, `text-overall-score`, `text-questions-total`, `text-study-time`) and the
  subscription buttons (`button-manage-subscription`, `button-upgrade-subscription`);
- `/upgrade`'s in-body back link, its spinners and the legacy Card/Badge.

```text
$ G 'button-manage-subscription'
(empty)
$ G 'button-upgrade-subscription'
(empty)
$ G 'tab-progress'
(empty)
# test files naming it (absence assertions / fixtures): 1
$ G 'text-overall-score'
(empty)
$ G 'text-questions-total'
(empty)
$ G 'text-study-time'
(empty)
$ G 'student-guardian-'
client/src/components/student/StudentGuardiansPanel.tsx:183:              data-testid={`student-guardian-${link.link_id}`}
$ grep -nwF -- 'ArrowLeft' client/src/pages/upgrade.tsx
(empty)
$ grep -nwF -- 'Loader2' client/src/pages/upgrade.tsx
(empty)
$ grep -nwF -- 'Badge' client/src/pages/upgrade.tsx
(empty)
$ grep -nwF -- 'CardContent' client/src/pages/upgrade.tsx
(empty)
```

**Still present, moved and not removed**
- The `student-guardian-${link_id}` testids are in `StudentGuardiansPanel.tsx`. Settings →
  Guardian (`LinkSection.tsx`) and `/guardian-required` render that panel.
- `UserProfile.tsx` itself stays as the **guardian** `/profile`. App.tsx's `ProfileRoute`
  sends guardians to it and everyone else to `SettingsPage`.
- `EmailNotificationsCard` and `DeleteAccountCard` stay, because `AccountSection.tsx` and the
  guardian `UserProfile.tsx` use them.

## UI-59: Bare card pages

**Commits**
- `693fae40` feat(student-ui): UI-59 bare-card pages on the student tokens, off the light lock
- `36d06439` (register)

**Removed** (register row and #1073):
- the 404's developer line ("Did you forget to add the page to the router?") and its amber
  icon;
- `login.tsx`'s legacy `CardHeader` / `CardContent` card, replaced by the shared
  `BareCardHeader`.

The `lyc` input, label, checkbox and select variants were added in place, with no forked
components. The shared "centered card on a gradient" (`from-[#EAF0FF]`, audit §6.2) had
already gone in UI-41 (`f44e1ea0`); `grep -rnF 'EAF0FF' client/src` is empty.

```text
$ G 'Did you forget to add the page to the router?'
(empty)
$ grep -nwF -- 'AlertCircle' client/src/pages/not-found.tsx
(empty)
$ grep -nwF -- 'text-gray-900' client/src/pages/not-found.tsx
(empty)
$ grep -nwF -- 'CardHeader' client/src/pages/login.tsx
(empty)
$ grep -nwF -- 'CardContent' client/src/pages/login.tsx
(empty)
```

---

## knip

**Command** (run from the repo root; the config lives outside the repo, so package.json is
untouched):

```bash
pnpm dlx knip@5 --config <scratch>/knip.json --no-progress --reporter compact
pnpm dlx knip@5 --config <scratch>/knip.json --no-progress --reporter compact --production --include files,exports,types
```

**Version:** knip 5.88.1 (`pnpm dlx knip@5 --version`), Node v22.22.2.

**Config:** this is all of it.

```json
{
  "workspaces": {
    ".": {
      "entry": [
        "client/src/main.tsx!",
        "server/index.ts!",
        "api/**/*.{ts,js,mjs}!",
        "scripts/**/*.{ts,mjs,js}",
        "tests/**/*.{ts,tsx}",
        "client/src/**/*.test.{ts,tsx}"
      ],
      "project": [
        "client/src/**/*.{ts,tsx}!",
        "server/**/*.ts!",
        "shared/**/*.ts!",
        "api/**/*.{ts,js,mjs}!",
        "scripts/**/*.{ts,mjs,js}",
        "tests/**/*.{ts,tsx}"
      ]
    },
    "packages/shared": {
      "entry": ["src/index.ts!", "src/**/*.test.ts"],
      "project": ["src/**/*.ts!"]
    },
    "apps/api": { "ignore": ["**"] }
  }
}
```

- `apps/api` is ignored. It is a separate service with its own `package.json`, outside the
  student UI.
- **Default mode** counts tests and scripts as entries, so it answers "is anything importing
  this?"
- **`--production`** drops tests (the `!` patterns only), so it answers "does shipped code use
  this?" That mode found `ui/progress.tsx`, which only `PracticeShell` had imported.

### Summary counts, symbols rather than lines

| Category | Default, before | Default, after | `--production`, before | `--production`, after |
|---|---|---|---|---|
| Unused files | 10 (client/src 3, packages/shared 0) | 8 (client/src 1, packages/shared 0) | 22 (client/src 9, packages/shared 2) | 20 (client/src 7, packages/shared 2) |
| Unused exports | 295 (client/src 120, packages/shared 10) | 294 (client/src 119, packages/shared 10) | 431 (client/src 180, packages/shared 14) | 430 (client/src 179, packages/shared 14) |
| Unused exported types | 306 (client/src 124, packages/shared 12) | 306 (client/src 124, packages/shared 12) | 310 (client/src 139, packages/shared 12) | 310 (client/src 139, packages/shared 12) |
| Duplicate exports | 20 (client/src 10, packages/shared 8) | 20 (client/src 10, packages/shared 8) | not run | not run |
| Unused dependencies | 23 (client/src 0, packages/shared 0) | 23 (client/src 0, packages/shared 0) | not run | not run |
| Unused devDependencies | 15 (client/src 0, packages/shared 0) | 15 (client/src 0, packages/shared 0) | not run | not run |
| Unlisted dependencies | 188 (client/src 157, packages/shared 0) | 188 (client/src 157, packages/shared 0) | not run | not run |
| Unresolved imports | 1 (client/src 0, packages/shared 0) | 1 (client/src 0, packages/shared 0) | not run | not run |

"Unlisted dependencies" is knip flagging `@lyceon/shared` imports: it is a workspace package that the root `package.json` does not list. It resolves through tsconfig `paths`, and this is pre-existing configuration, not dead code.

The deltas are exactly the three leftovers:
- `ui/progress.tsx`: 1 file;
- `student-kpi.harness.ts`: 1 file;
- `isEntitlementDenialError`: 1 export.

### Unused files remaining in `client/src` and `packages/shared`

| File | Mode | Classification |
|---|---|---|
| `client/src/test/setupTests.ts` | both | **Pre-existing, non-UI.** Unchanged since 2026-09-02 (`2febbc4e`). Vitest uses the root `vitest.setup.ts`. |
| `client/src/lib/tutor-error-classifier.ts` | production | **Pre-existing.** Register finding F-25 (Open): "no production caller; only its test imports it". Not a Wave 5 orphan. |
| `client/src/components/student-ui/filter-bar/topics.fixture.ts`, `client/src/features/calendar/calendar-week.fixture.ts`, `client/src/features/exam/test-fixtures/report-fixtures.ts`, `client/src/features/guardian/test-harness.tsx`, `client/src/test-support/runner.harness.tsx` | production | **Still used by tests** (fixtures and harnesses). |
| `packages/shared/src/__fixtures__/linked-student.ts`, `packages/shared/src/column-disposition.ts` | production | **Pre-existing, non-UI.** Used by tests and by `scripts/ci/section-vocabulary-gate.mjs`. |

Non-UI files outside scope, listed and not acted on:
- `server/lib/build.ts`
- `server/sat-pdf-processor.ts`
- `server/scripts/backfill-question-metadata.ts`
- `server/scripts/cleanup-question-stems.ts`
- `server/services/question-publish.ts`
- `server/services/questionTypes.ts`
- `shared/schema.ts`

### Unused exports remaining in `client/src` and `packages/shared`

Each was classified by whether the symbol existed in that file at `origin/cleanup` and whether
any other file referenced it there (`git grep -w`, non-test).

- **Orphaned by Wave 4/5, acted on:** `isEntitlementDenialError`, un-exported in `c8e543d8`.
- **Orphaned by Wave 4/5, not acted on (candidate for Karl):** `DialogFooter` in
  `client/src/components/ui/dialog.tsx`.
  - At `origin/cleanup` it had two importers: `DiagnosticPromptModal.tsx`, deleted in UI-50,
    and the old `chat.tsx`, rebuilt in UI-56.
  - It is part of the vendored shadcn `dialog` primitive, whose siblings `DialogPortal` and
    `DialogOverlay` were already unused before Wave 4. The file is still imported, including by
    guardian code.
- **Pre-existing:** every other export with `pre` below existed in its file at
  `origin/cleanup` with no external reference then either. This includes the shadcn `ui/*`
  sub-exports, `features/calendar/api/index.ts` barrel re-exports, `blog.ts`, `legal-content.ts`
  and `exam-report-schema.ts`.
- **New Wave 4/5 code whose export is unused but whose symbol is used in its own file:**
  - `greetingFor` (`home-model.ts`)
  - `questionPosition` and `progressSegments` (`CanonicalPracticePage.tsx`)
  - `sectionLabel` (`practice-landing-model.ts`)
  - `billingView` (`BillingSection.tsx`)
  - `LISA_DISCLAIMER` (`TutorThreadParts.tsx`)
  - `EDIT_GOALS_HREF` (`StudentChrome.tsx`)
  - `EXAM_IN_PROGRESS_STATES` and `inProgressLine` (`tests-home-model.ts`)
  - `PROFILE_NAME_PATH` and `CHANGE_PASSWORD_PATH` (`settings-api.ts`)
  - `RunnerFrame` (`runner.harness.tsx`)

  These are not old UI, so they are not deleted. Dropping the `export` keyword is a candidate
  for the lead.
- **Unused exported types:** none dropped an external reference between `origin/cleanup` and
  now.
  - The `new`/`newfile` ones are prop and variant types of the Wave 4/5 components, for example
    `ModalProps`, `NoticeProps`, `FilterBarProps`, `MasteryRowVariant` and `ShellKind`. They are
    exported as each component's public API.
  - The rest are pre-existing.

`--production` adds exports that **only tests** import. One is a Wave 5 consequence:
- `useProgressKpis` (`client/src/hooks/useProgressKpis.ts`). At `origin/cleanup` the old Home
  and Practice pages called it.
- After UI-50 and UI-51 no page reads `/api/progress/kpis`.
- `invalidateProgressKpis` in the same file is still called by `useCanonicalPractice.ts` and
  `ExamModulePage.tsx`.
- The file's own `@spec` annotation keeps the hook on purpose ("a page that shows KPIs again
  reads them here").
- `tests/ci/query-freshness.contract.test.ts` pins the hook as the only place that names the
  endpoint.
- **Candidate for Karl:** retire the hook, and with it the invalidations and the contract
  clause, or keep it. It is not deleted here, because it is still imported and its retention is
  a documented decision.

`levelTone` (`LevelPill.tsx`) lost its non-test importer when UI-42's `MasteryMeter` moved to
`levelFill`. It is still used in its own file and by the guardian `level-colours.test.tsx`, so it
is kept.

The new UI-46 primitive `Sheet` / `SheetClose` (`client/src/components/student-ui/Sheet.tsx`)
has no production consumer yet. Only tests render it.
- It is new and not an old-UI orphan.
- **Candidate for Karl:** keep it for a future sheet, or drop it.

<details><summary>Raw: remaining unused exports in client/src and packages/shared (default mode, after), with classification</summary>

`pre` means the symbol was in that file at `origin/cleanup`. `new` means it was added to an
existing file by Wave 4/5. `newfile` means the file is new in Wave 4/5. `infile_lines` is the
number of lines in the file naming the symbol.

```text
pre|client/src/components/auth/RequireRole.tsx|default|infile_lines=1
newfile|client/src/components/home/home-model.ts|greetingFor|infile_lines=2
pre|client/src/components/layout/primitives.tsx|Prose|infile_lines=1
pre|client/src/components/legal/ReconsentModal.tsx|default|infile_lines=1
pre|client/src/components/math/FloatingPanel.tsx|clampPanel|infile_lines=3
pre|client/src/components/math/calculator-layout.ts|CONTAINER_AT_BREAKPOINT|infile_lines=3
pre|client/src/components/notifications/NotificationBell.tsx|default|infile_lines=1
pre|client/src/components/practice/CanonicalPracticePage.tsx|TUTOR_SIDE_BY_SIDE_BREAKPOINT|infile_lines=2
new|client/src/components/practice/CanonicalPracticePage.tsx|questionPosition|infile_lines=2
new|client/src/components/practice/CanonicalPracticePage.tsx|progressSegments|infile_lines=2
newfile|client/src/components/practice/practice-landing-model.ts|sectionLabel|infile_lines=2
pre|client/src/components/question-renderer.tsx|DISPLAY_LETTERS|infile_lines=2
pre|client/src/components/question-renderer.tsx|QuestionRenderer|infile_lines=2
newfile|client/src/components/settings/BillingSection.tsx|billingView|infile_lines=3
pre|client/src/components/student/StudentLinkCodePanel.tsx|STUDENT_LINK_CODE_QUERY_KEY|infile_lines=2
pre|client/src/components/student/StudentLinkCodePanel.tsx|studentLinkCodeQueryKey|infile_lines=3
pre|client/src/components/tutor/TutorThreadParts.tsx|TutorMessageContent|infile_lines=2
new|client/src/components/tutor/TutorThreadParts.tsx|LISA_DISCLAIMER|infile_lines=2
pre|client/src/components/tutor/TutorThreadParts.tsx|PRACTICE_HANDOFF_HREF|infile_lines=2
pre|client/src/components/ui/alert-dialog.tsx|AlertDialogPortal|infile_lines=4
pre|client/src/components/ui/alert-dialog.tsx|AlertDialogOverlay|infile_lines=4
pre|client/src/components/ui/alert.tsx|AlertTitle|infile_lines=3
pre|client/src/components/ui/avatar.tsx|AvatarImage|infile_lines=3
pre|client/src/components/ui/badge.tsx|badgeVariants|infile_lines=4
pre|client/src/components/ui/dialog.tsx|DialogPortal|infile_lines=4
pre|client/src/components/ui/dialog.tsx|DialogOverlay|infile_lines=4
pre|client/src/components/ui/dialog.tsx|DialogFooter|infile_lines=3
pre|client/src/components/ui/dropdown-menu.tsx|DropdownMenuRadioItem|infile_lines=3
pre|client/src/components/ui/dropdown-menu.tsx|DropdownMenuShortcut|infile_lines=3
pre|client/src/components/ui/dropdown-menu.tsx|DropdownMenuGroup|infile_lines=2
pre|client/src/components/ui/dropdown-menu.tsx|DropdownMenuPortal|infile_lines=2
pre|client/src/components/ui/dropdown-menu.tsx|DropdownMenuSub|infile_lines=2
pre|client/src/components/ui/dropdown-menu.tsx|DropdownMenuSubContent|infile_lines=3
pre|client/src/components/ui/dropdown-menu.tsx|DropdownMenuSubTrigger|infile_lines=3
pre|client/src/components/ui/dropdown-menu.tsx|DropdownMenuRadioGroup|infile_lines=2
pre|client/src/components/ui/scroll-area.tsx|ScrollBar|infile_lines=4
pre|client/src/components/ui/select.tsx|SelectGroup|infile_lines=2
pre|client/src/components/ui/select.tsx|SelectLabel|infile_lines=3
pre|client/src/components/ui/select.tsx|SelectSeparator|infile_lines=3
pre|client/src/components/ui/select.tsx|SelectScrollUpButton|infile_lines=4
pre|client/src/components/ui/select.tsx|SelectScrollDownButton|infile_lines=4
pre|client/src/components/ui/sheet.tsx|SheetPortal|infile_lines=4
pre|client/src/components/ui/sheet.tsx|SheetOverlay|infile_lines=4
pre|client/src/components/ui/sheet.tsx|SheetHeader|infile_lines=3
pre|client/src/components/ui/sheet.tsx|SheetFooter|infile_lines=3
pre|client/src/components/ui/table.tsx|TableFooter|infile_lines=3
pre|client/src/components/ui/table.tsx|TableCaption|infile_lines=3
pre|client/src/components/ui/toast.tsx|ToastAction|infile_lines=4
pre|client/src/components/ui/tooltip.tsx|Tooltip|infile_lines=2
pre|client/src/components/ui/tooltip.tsx|TooltipTrigger|infile_lines=2
pre|client/src/components/ui/tooltip.tsx|TooltipContent|infile_lines=3
pre|client/src/features/calendar/api/index.ts|deviceTimezone|infile_lines=1
pre|client/src/features/calendar/api/index.ts|useLaunchMutation|infile_lines=1
pre|client/src/features/calendar/api/index.ts|isLaunchable|infile_lines=1
pre|client/src/features/calendar/api/index.ts|practiceStateKey|infile_lines=1
pre|client/src/features/calendar/api/index.ts|prefetchPracticeChunk|infile_lines=1
pre|client/src/features/calendar/api/index.ts|applyAcknowledge|infile_lines=1
pre|client/src/features/calendar/api/index.ts|applyBlockEdit|infile_lines=1
pre|client/src/features/calendar/api/index.ts|applyDoItNow|infile_lines=1
pre|client/src/features/calendar/api/index.ts|applyMove|infile_lines=1
pre|client/src/features/calendar/api/index.ts|applyRemoveBlock|infile_lines=1
pre|client/src/features/calendar/api/index.ts|findBlock|infile_lines=1
pre|client/src/features/calendar/api/index.ts|isProvisional|infile_lines=1
pre|client/src/features/calendar/api/index.ts|nextProvisionalId|infile_lines=1
pre|client/src/features/calendar/api/index.ts|resetProvisionalIds|infile_lines=1
pre|client/src/features/calendar/api/index.ts|PROVISIONAL_PREFIX|infile_lines=1
pre|client/src/features/calendar/api/launch.ts|reviewStateKey|infile_lines=2
pre|client/src/features/calendar/api/launch.ts|prefetchPracticeChunk|infile_lines=1
pre|client/src/features/calendar/api/launch.ts|calendarKeys|infile_lines=2
pre|client/src/features/calendar/api/optimistic.ts|PROVISIONAL_PREFIX|infile_lines=3
pre|client/src/features/calendar/api/optimistic.ts|nextProvisionalId|infile_lines=3
pre|client/src/features/calendar/api/queries.ts|deviceTimezone|infile_lines=3
pre|client/src/features/calendar/calendar-week.fixture.ts|calendarWeekRange|infile_lines=3
pre|client/src/features/calendar/components/Chrome.tsx|TargetFact|infile_lines=3
pre|client/src/features/calendar/components/Chrome.tsx|CountdownFact|infile_lines=3
pre|client/src/features/calendar/components/Chrome.tsx|ProjectionFact|infile_lines=3
newfile|client/src/features/calendar/components/StudentChrome.tsx|EDIT_GOALS_HREF|infile_lines=2
pre|client/src/features/exam/api/exam-api.ts|EXAM_ROOT|infile_lines=10
pre|client/src/features/exam/components/QuestionCell.tsx|cellLabel|infile_lines=2
pre|client/src/features/exam/components/QuestionCell.tsx|MarkedIcon|infile_lines=3
pre|client/src/features/exam/hooks/useHeartbeat.ts|HEARTBEAT_INTERVAL_MS|infile_lines=2
pre|client/src/features/exam/lib/countdown.ts|FIVE_MINUTES_MS|infile_lines=3
pre|client/src/features/exam/lib/countdown.ts|ONE_MINUTE_MS|infile_lines=2
pre|client/src/features/exam/lib/module-summary.ts|isAnswered|infile_lines=2
newfile|client/src/features/exam/lib/tests-home-model.ts|EXAM_IN_PROGRESS_STATES|infile_lines=2
newfile|client/src/features/exam/lib/tests-home-model.ts|inProgressLine|infile_lines=2
pre|client/src/features/exam/test-fixtures/report-fixtures.ts|FIXTURE_RW_ROWS|infile_lines=3
pre|client/src/hooks/tutor-client.ts|tutorConversationQueryKey|infile_lines=6
pre|client/src/hooks/tutor-client.ts|tutorConversationsQueryKey|infile_lines=9
pre|client/src/hooks/use-toast.ts|reducer|infile_lines=2
pre|client/src/hooks/useBillingPortal.ts|portalErrorMessage|infile_lines=2
pre|client/src/hooks/useBillingStatusQuery.ts|BILLING_STATUS_PATH|infile_lines=3
pre|client/src/hooks/useBillingStatusQuery.ts|fetchBillingStatus|infile_lines=2
pre|client/src/hooks/useProfileQuery.ts|PROFILE_PATH|infile_lines=3
pre|client/src/hooks/useProfileQuery.ts|fetchProfile|infile_lines=2
pre|client/src/hooks/useReview.ts|REVIEW_POOL_QUERY_KEY|infile_lines=5
pre|client/src/hooks/useReview.ts|REVIEW_OPEN_SESSIONS_QUERY_KEY|infile_lines=4
pre|client/src/hooks/useReview.ts|reviewPoolPath|infile_lines=2
pre|client/src/hooks/useReview.ts|dropClosedSessions|infile_lines=2
pre|client/src/hooks/useTutorTurn.ts|CLIENT_TIMEOUT_MS|infile_lines=2
pre|client/src/lib/api-error.ts|getPremiumDenialReason|infile_lines=4
pre|client/src/lib/api-error.ts|isCsrfError|infile_lines=2
pre|client/src/lib/api-error.ts|isTransportError|infile_lines=1
pre|client/src/lib/blog.ts|getPostsByTag|infile_lines=1
pre|client/src/lib/blog.ts|getPostsByCategory|infile_lines=1
pre|client/src/lib/blog.ts|getAllTags|infile_lines=1
pre|client/src/lib/client-instance.ts|resetClientInstanceId|infile_lines=1
pre|client/src/lib/legal-content.ts|LegalNotFoundError|infile_lines=4
pre|client/src/lib/legal-content.ts|loadLegalManifest|infile_lines=2
pre|client/src/lib/link-code-prefill.ts|LINK_CODE_QUERY_PARAM|infile_lines=2
pre|client/src/lib/notificationsApi.ts|NOTIFICATIONS_PAGE_LIMIT|infile_lines=2
pre|client/src/lib/practice-filters.ts|parseDifficultiesFromSearch|infile_lines=1
pre|client/src/lib/practice-filters.ts|parseDomainsFromSearch|infile_lines=1
pre|client/src/lib/practice-filters.ts|appendPracticeFilters|infile_lines=1
newfile|client/src/lib/settings-api.ts|PROFILE_NAME_PATH|infile_lines=2
newfile|client/src/lib/settings-api.ts|CHANGE_PASSWORD_PATH|infile_lines=2
pre|client/src/lib/support-contact.ts|PRIVACY_EMAIL|infile_lines=1
pre|client/src/lib/theme.ts|isThemePreference|infile_lines=2
newfile|client/src/test-support/runner.harness.tsx|RunnerFrame|infile_lines=2
pre|packages/shared/src/billing-pricing.ts|monthsInInterval|infile_lines=3
pre|packages/shared/src/exam-report-schema.ts|examIncompletenessReasonSchema|infile_lines=2
pre|packages/shared/src/exam-report-schema.ts|examFormSectionSummarySchema|infile_lines=2
pre|packages/shared/src/exam-report-schema.ts|examFormLatestSessionSchema|infile_lines=2
pre|packages/shared/src/exam-report-schema.ts|examFormSummarySchema|infile_lines=2
pre|packages/shared/src/exam-student-report-schema.ts|examStudentReportPartialSchema|infile_lines=3
pre|packages/shared/src/profile-role-choice-schema.ts|ROLE_CHOICE_ERROR_CODES|infile_lines=2
pre|packages/shared/src/services/rate-limit-ledger.ts|windowFor|infile_lines=4
pre|packages/shared/src/services/rate-limit-ledger.ts|bucketFamily|infile_lines=2
pre|packages/shared/src/services/rate-limit-ledger.ts|getUsage|infile_lines=1
```

</details>

<details><summary>Raw: remaining unused exported types in client/src and packages/shared (default mode, after), with classification</summary>

```text
pre|client/src/components/MathRenderer.tsx|MathContentToken|infile_lines=2
pre|client/src/components/auth/PasswordField.tsx|PasswordFieldProps|infile_lines=2
pre|client/src/components/billing/PremiumUpgradePrompt.tsx|PremiumUpgradePromptProps|infile_lines=2
new|client/src/components/common/empty-state.tsx|EmptyStateProps|infile_lines=2
newfile|client/src/components/layout/FocusShell.tsx|FocusShellProps|infile_lines=2
pre|client/src/components/layout/HeaderUserMenu.tsx|HeaderSignOut|infile_lines=3
new|client/src/components/layout/app-shell.tsx|RailItem|infile_lines=4
new|client/src/components/layout/app-shell.tsx|AppShellProps|infile_lines=2
new|client/src/components/mastery/LevelPill.tsx|LevelPillSize|infile_lines=3
newfile|client/src/components/mastery/MasteryRow.tsx|MasteryRowVariant|infile_lines=2
pre|client/src/components/practice/NumericEntryInput.tsx|NumericEntryInputProps|infile_lines=2
newfile|client/src/components/practice/RunnerStateCard.tsx|RunnerStateCardProps|infile_lines=2
pre|client/src/components/question-renderer.tsx|QuestionRendererProps|infile_lines=2
newfile|client/src/components/settings/BillingSection.tsx|BillingView|infile_lines=2
newfile|client/src/components/student-ui/FullPageLoader.tsx|FullPageLoaderProps|infile_lines=2
newfile|client/src/components/student-ui/Modal.tsx|ModalProps|infile_lines=2
newfile|client/src/components/student-ui/Notice.tsx|NoticeTone|infile_lines=2
newfile|client/src/components/student-ui/Notice.tsx|NoticeProps|infile_lines=2
newfile|client/src/components/student-ui/PageHeader.tsx|PageHeaderProps|infile_lines=2
newfile|client/src/components/student-ui/Sheet.tsx|SheetProps|infile_lines=3
newfile|client/src/components/student-ui/filter-bar/FilterBar.tsx|FilterBarProps|infile_lines=2
newfile|client/src/components/student-ui/filter-bar/filter-cascade.ts|FilterChip|infile_lines=3
newfile|client/src/components/student-ui/filter-bar/topics.fixture.ts|CatalogRow|infile_lines=3
newfile|client/src/components/student-ui/index.ts|PageHeaderProps|infile_lines=1
newfile|client/src/components/student-ui/index.ts|FullPageLoaderProps|infile_lines=1
newfile|client/src/components/student-ui/index.ts|ModalProps|infile_lines=1
newfile|client/src/components/student-ui/index.ts|SheetProps|infile_lines=1
newfile|client/src/components/student-ui/index.ts|NoticeProps|infile_lines=1
newfile|client/src/components/student-ui/index.ts|NoticeTone|infile_lines=1
newfile|client/src/components/student-ui/index.ts|FilterBarProps|infile_lines=1
pre|client/src/components/ui/badge.tsx|BadgeProps|infile_lines=2
pre|client/src/components/ui/button.tsx|ButtonProps|infile_lines=2
new|client/src/components/ui/input.tsx|InputVariant|infile_lines=2
new|client/src/components/ui/skeleton.tsx|SkeletonProps|infile_lines=3
new|client/src/components/ui/tabs.tsx|TabsVariant|infile_lines=8
pre|client/src/contexts/SupabaseAuthContext.tsx|SignupOutcome|infile_lines=3
pre|client/src/contexts/SupabaseAuthContext.tsx|SignupResult|infile_lines=3
pre|client/src/contexts/SupabaseAuthContext.tsx|SignupLegalConsent|infile_lines=5
pre|client/src/features/calendar/CalendarView.tsx|CalendarMutations|infile_lines=2
pre|client/src/features/calendar/CalendarView.tsx|CalendarViewProps|infile_lines=2
pre|client/src/features/calendar/api/client.ts|DayMembers|infile_lines=1
pre|client/src/features/calendar/api/index.ts|DayScopedVariables|infile_lines=1
pre|client/src/features/calendar/api/index.ts|DoItNowVariables|infile_lines=1
pre|client/src/features/calendar/api/index.ts|EditDayVariables|infile_lines=1
pre|client/src/features/calendar/api/index.ts|Intent|infile_lines=1
pre|client/src/features/calendar/api/index.ts|LaunchVariables|infile_lines=1
pre|client/src/features/calendar/api/index.ts|MoveBlockVariables|infile_lines=1
pre|client/src/features/calendar/api/index.ts|RegenerateVariables|infile_lines=1
pre|client/src/features/calendar/api/index.ts|LaunchOutcome|infile_lines=1
pre|client/src/features/calendar/api/mutations.ts|Intent|infile_lines=9
pre|client/src/features/calendar/api/mutations.ts|EditDayVariables|infile_lines=3
pre|client/src/features/calendar/api/mutations.ts|MoveBlockVariables|infile_lines=3
pre|client/src/features/calendar/api/mutations.ts|RegenerateVariables|infile_lines=3
pre|client/src/features/calendar/api/mutations.ts|DayScopedVariables|infile_lines=5
pre|client/src/features/calendar/api/mutations.ts|DoItNowVariables|infile_lines=3
pre|client/src/features/calendar/api/mutations.ts|LaunchVariables|infile_lines=3
pre|client/src/features/calendar/components/BlockCard.tsx|BlockCardProps|infile_lines=2
pre|client/src/features/calendar/components/BlockSheet.tsx|BlockSheetProps|infile_lines=2
pre|client/src/features/calendar/components/CreateBlockSheet.tsx|CreateBlockSheetProps|infile_lines=2
pre|client/src/features/calendar/components/DayStrip.tsx|DayStripProps|infile_lines=2
pre|client/src/features/calendar/components/MonthGrid.tsx|MonthGridProps|infile_lines=2
pre|client/src/features/calendar/components/SettingsSheet.tsx|SettingsSheetProps|infile_lines=2
newfile|client/src/features/calendar/components/StudentChrome.tsx|RegenerateControl|infile_lines=2
pre|client/src/features/calendar/components/WeekGrid.tsx|WeekGridProps|infile_lines=2
pre|client/src/features/exam/api/exam-api.ts|ExamItemsResponse|infile_lines=2
pre|client/src/features/exam/api/exam-api.ts|ExamStartModuleResponse|infile_lines=2
pre|client/src/features/exam/api/exam-api.ts|ExamSubmitModuleResponse|infile_lines=2
pre|client/src/features/exam/components/DomainBreakdown.tsx|DomainBreakdownRow|infile_lines=3
pre|client/src/features/exam/hooks/useExamClock.ts|ExamClock|infile_lines=2
pre|client/src/features/exam/hooks/useWriteQueue.ts|WriteQueue|infile_lines=2
pre|client/src/features/exam/lib/exam-position.ts|ExamPosition|infile_lines=4
pre|client/src/features/exam/lib/exam-position.ts|ModuleRoute|infile_lines=3
pre|client/src/features/exam/lib/passage.ts|PassageSegment|infile_lines=3
pre|client/src/features/exam/lib/passage.ts|HighlightEdit|infile_lines=2
pre|client/src/hooks/tutor-client.ts|TutorEntryMode|infile_lines=3
pre|client/src/hooks/tutor-client.ts|TutorConversationStatus|infile_lines=2
pre|client/src/hooks/tutor-client.ts|TutorConversationSurface|infile_lines=2
pre|client/src/hooks/tutor-client.ts|TutorMessageRole|infile_lines=1
pre|client/src/hooks/tutor-client.ts|TutorResolvedScope|infile_lines=2
pre|client/src/hooks/tutor-client.ts|CreateConversationInput|infile_lines=3
pre|client/src/hooks/tutor-client.ts|TutorConversation|infile_lines=3
pre|client/src/hooks/tutor-client.ts|SendMessageInput|infile_lines=3
pre|client/src/hooks/tutor-client.ts|TutorConversationsList|infile_lines=6
pre|client/src/hooks/tutor-client.ts|EndConversationResponse|infile_lines=3
pre|client/src/hooks/tutor-client.ts|ResumeConversationResponse|infile_lines=3
pre|client/src/hooks/useBillingPortal.ts|UseBillingPortalResult|infile_lines=2
pre|client/src/hooks/useCanonicalPractice.ts|PracticeNextResponse|infile_lines=6
pre|client/src/hooks/useCanonicalPractice.ts|PracticeAnswerResponse|infile_lines=4
pre|client/src/hooks/useCanonicalPractice.ts|PracticeSkipResponse|infile_lines=2
pre|client/src/hooks/useCanonicalPractice.ts|PracticeSessionSpecInput|infile_lines=2
pre|client/src/hooks/useDiagnosticStart.ts|DiagnosticStartResult|infile_lines=1
pre|client/src/hooks/useDiagnosticStart.ts|DiagnosticStartError|infile_lines=3
newfile|client/src/hooks/useKeyboardShortcuts.ts|ShortcutKey|infile_lines=3
newfile|client/src/hooks/useKeyboardShortcuts.ts|ExamModuleKeymapInput|infile_lines=2
newfile|client/src/hooks/useKeyboardShortcuts.ts|LisaComposerKeymapInput|infile_lines=2
newfile|client/src/hooks/useKeyboardShortcuts.ts|EscapeKeymapOptions|infile_lines=2
new|client/src/hooks/usePractice.ts|PracticeSessionStart|infile_lines=3
pre|client/src/hooks/useReview.ts|ReviewStartResult|infile_lines=4
pre|client/src/hooks/useTutorTurn.ts|TurnState|infile_lines=3
pre|client/src/hooks/useTutorTurn.ts|TutorTurn|infile_lines=2
pre|client/src/lib/account-deletion-errors.ts|DeletionErrorCopy|infile_lines=4
pre|client/src/lib/api-error.ts|PremiumDenialReason|infile_lines=3
pre|client/src/lib/api-error.ts|UserFacingErrorMessage|infile_lines=2
pre|client/src/lib/billing-client.ts|BillingCheckoutOutcome|infile_lines=3
pre|client/src/lib/billing-cta.ts|BillingCtaDestination|infile_lines=3
pre|client/src/lib/billing-cta.ts|BillingCtaAction|infile_lines=2
pre|client/src/lib/billing-cta.ts|BillingCtaCopy|infile_lines=2
pre|client/src/lib/blog.ts|BlogPost|infile_lines=7
pre|client/src/lib/cta-click.ts|CtaClickHandlers|infile_lines=2
pre|client/src/lib/legal-content.ts|LegalManifest|infile_lines=3
pre|client/src/lib/legal-content.ts|LegalSection|infile_lines=5
pre|client/src/lib/legal-content.ts|LegalDocumentContent|infile_lines=2
pre|client/src/lib/masteryApi.ts|MasteryLevelKey|infile_lines=2
pre|client/src/lib/masteryApi.ts|MasteryDomainsResponse|infile_lines=3
pre|client/src/lib/masteryApi.ts|MasterySkillsResponse|infile_lines=3
pre|client/src/lib/practice-filters.ts|PracticeFilters|infile_lines=2
pre|client/src/lib/practice-topic-taxonomy.ts|PracticeTopicDomain|infile_lines=4
pre|client/src/lib/projectionApi.ts|ConfidenceBand|infile_lines=3
pre|client/src/lib/projectionApi.ts|EstimateStatus|infile_lines=2
pre|client/src/lib/query-freshness.ts|QueryFreshnessKind|infile_lines=1
newfile|client/src/lib/route-shells.ts|ShellKind|infile_lines=1
newfile|client/src/lib/route-shells.ts|ShellExclusionReason|infile_lines=2
pre|client/src/lib/theme.ts|ResolvedTheme|infile_lines=3
pre|client/src/lib/theme.ts|SaveResult|infile_lines=2
pre|packages/shared/src/__fixtures__/linked-student.ts|LinkedStudentOverrides|infile_lines=2
pre|packages/shared/src/billing-pricing.ts|BillingPlanPricing|infile_lines=2
pre|packages/shared/src/exam-domain-segments.ts|StudentDomainSegments|infile_lines=3
pre|packages/shared/src/exam-report-schema.ts|ReportStateInputs|infile_lines=2
newfile|packages/shared/src/exam-scored-sessions-schema.ts|ExamScoredSessionsQuery|infile_lines=1
pre|packages/shared/src/practice-schema.ts|QuestionsRow|infile_lines=1
pre|packages/shared/src/practice-schema.ts|PracticeSessionRow|infile_lines=1
newfile|packages/shared/src/profile-name-schema.ts|ProfileNameUpdateRequest|infile_lines=1
pre|packages/shared/src/retention-schema.ts|RetentionSweepRow|infile_lines=1
pre|packages/shared/src/review-table-schema.ts|ReviewSessionRow|infile_lines=1
pre|packages/shared/src/review-table-schema.ts|ReviewScheduleRow|infile_lines=1
pre|packages/shared/src/services/rate-limit-ledger.ts|BucketDefinition|infile_lines=3
```

</details>

---

## Candidates for Karl

1. **`@radix-ui/react-progress`** (package.json dependency).
   - It has had no live importer since UI-53 (`353a5b09`) removed `PracticeShell`, the only
     user of `ui/progress.tsx`. That file is now deleted (`7786da75`).
   - knip listed the dependency as unused both before and after this branch, because an unused
     file's imports do not count.
   - Not removed, because dependency changes need approval.
   - knip also lists 22 other unused dependencies and 15 devDependencies. All are pre-existing
     and non-UI.
2. **`useProgressKpis`.** It has had no reader since UI-50 and UI-51; see above. Retire the
   hook, the two invalidations and the contract clause, or keep it?
3. **`DialogFooter`** in the vendored `ui/dialog.tsx`. It was orphaned by UI-50 and UI-56;
   delete it, or leave the shadcn file whole?
4. **`student-ui/Sheet`.** The new primitive has no production consumer.
5. **The 12 new Wave 4/5 exports** with only in-file use: un-export them? This is cosmetic.
6. **CSS classes unreferenced since before Wave 4:**
   - `calendar.css`: `.topdiv`
   - `index.css`: `.bg-brand-surface`, `.btn-base`, `.chat-scroll`, `.focus-ring`,
     `.progress-ring`, `.question-stem`
   - `exam.css`: `.exam-focus`

   Not Wave 5 orphans; listed only.
