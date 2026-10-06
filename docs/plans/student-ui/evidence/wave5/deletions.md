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
- **Consequence:** `@radix-ui/react-progress` has had no live importer since `353a5b09`. Removal
  approved by Karl 2026-10-05; removed from `package.json` and `pnpm-lock.yaml` with
  `pnpm remove @radix-ui/react-progress` (UI-53 follow-up commit), build and tests as proof.

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

## OQ-61 (a): /api/me/streak

Owner ruling (Karl, 2026-10-05, register §9 OQ-61 (a), verbatim): "No student page using
/api/me/streak is fine. If the guardian calendar doesn't use it either, add it to the deletion
sweep with grep proof." Recorded as **SCL-212** (Doc 05F §15 names the route, and INV-08-11 /
INV-08-20 / §19 test it). Branch `claude/fu-oq61`, from `claude/student-ui-followups` at
`76371947`.

**Who called it, before the deletion.** No client code. The student client's read
(`fetchStreak` / `useStreak`) went with SCL-211 (UI-55). The only client mention was
`calendar.ui55.test.tsx`, as an absence assertion and a fetch-mock answer. The server, the two
e2e harness servers, two server tests and an owner-run smoke script mounted or called it.

**The guardian calendar does not call it.** Both guardian surfaces that render a streak get it
from the guardian calendar payload:
- `client/src/pages/guardian-student-calendar.tsx:71` `useGuardianCalendar(...)` →
  `:138` `streak={calendar.data.streak}`;
- `client/src/features/guardian/GuardianDashboardTab.tsx:105` `useGuardianCalendar(...)` →
  `:137` `streak={data.streak}` (the `HeaderFacts` / `StreakFact` line);
- `useGuardianCalendar` reads `GET /api/students/:id/calendar`
  (`client/src/features/calendar/api/client.ts:196-211`), served by
  `server/routes/student-resources.ts:503` `readGuardianCalendar`, which reads the streak
  server-side at `server/services/calendar/read-service.ts:861`
  `getStudentActivityStreak(...)`.

**Removed:**
- the handler `streakRouter.get("/streak")` and the `streakRouter` export
  (`server/routes/calendar-routes.ts`), and its mount `app.use("/api/me", …, streakRouter)`
  (`server/index.ts`);
- the two route tests ("INV-08-20 — the streak carries NO calendar_access check") and the
  `activity-streak` mock in `tests/ci/calendar.routes.contract.test.ts`;
- the `/api/me` mounts in `tests/e2e/exam-harness/server.ts` and
  `tests/e2e/student-harness/server.ts`;
- `/api/me/streak` as a learning read in `tests/ci/under-13-link-gate.pg.ci.test.ts` (the
  unlink case now uses `/api/progress/kpis`, a learning read the same file already serves);
- step 2 of `scripts/ops/calendar-route-smoke.sh` (it now checks the streak inside the step-1
  calendar payload);
- the `/calendar` row's listing in `docs/route-registry.md`;
- the fetch-mock answer in `client/src/pages/calendar.ui55.test.tsx`. Its two absence
  assertions became `streakReads()` (any GET whose path names a streak), and plant UI55-NS2
  now plants `/api/calendar/streak`, the case the retired-endpoints gate cannot see.

**Kept, still used:** `server/services/activity-streak.ts` (`getStudentActivityStreak` from
`read-service.ts:627` and `:861`; `currentStreakAsOfToday` from
`canonical-runtime-views.ts`), and `streakSummarySchema` / `StreakSummary` (the `streak` field
of both calendar payloads). **No database function** was used only by the route: it read
`student_overall_kpi` through the service, and the calendar payloads and `kpi/overall` still do.
Nothing to drop.

**No caller can come back:** `/api/me/streak` is a row in `scripts/ci/retired-endpoints-gate.mjs`.
The dated records that name it as history (this file, the register's OQ-61 question, the
student-UI audits, the Lighthouse captures, the G-NEW-16 closure row, the Doc 05F Brief 3
plant table) are exempt from **that row only** (`historicalRecords`), so they are still
scanned for every other retired path (self-test cases 6 and 7).

```text
$ grep -rnwF -- '/api/me/streak' client/src server packages apps tests scripts
scripts/ci/retired-endpoints-gate.selftest.sh:19:# A file exempt from ONE row (`/api/me/streak`'s historicalRecords) and from no other.
scripts/ci/retired-endpoints-gate.selftest.sh:180:# 6. A PER-ROW EXEMPTION IS SCOPED TO ITS ROW (OQ-61 (a), 2026-10-05). `/api/me/streak`'s
scripts/ci/retired-endpoints-gate.mjs:144:    path: "/api/me/streak",
$ grep -rnF -- 'me/streak' client/src server packages apps tests scripts
(the same three lines: the gate's own row and its self-test)
$ grep -rnwF -- 'streakRouter' client/src server packages apps tests scripts
(empty)
$ grep -rnwF -- 'fetchStreak' client/src server packages apps tests scripts
(empty)
$ grep -rnwF -- 'useStreak' client/src server packages apps tests scripts
(empty)
$ grep -rnwF -- 'streak_read' client/src server packages apps tests scripts
(empty)
$ node scripts/ci/retired-endpoints-gate.mjs
OK: retired endpoints — 3326 file(s) scanned, no caller remains for 14 retired path(s):
```

---

## OQ-61 (h): `LISA_UPGRADE_PITCH.body` and the billing resolver's `pitch` option

Owner ruling (Karl, 2026-10-05, register §9 OQ-61): "The remaining five points: your
recommendations stand." The recommendation for (h) was to delete the unapproved W4-11 body,
which no surface had rendered since OQ-57 (f), and the `pitch` option that carried it, if
nothing but its own test used them.

**Who used them, before the deletion.** `LISA_UPGRADE_PITCH.body`:
`client/src/lib/billing-cta.pitch.test.ts` (the resolver's pitch test) and two absence
assertions in `ScopedTutorPanel.contract.test.tsx`; plant OQ54-C1 drew it. No production
reader. `resolveCtaCopy`'s `pitch` option and the `BillingCtaPitch` type: the same pitch test,
plus `PremiumUpgradePrompt`'s `pitch` prop, which only forwarded it and which no caller set
(`grep -rn 'pitch=' client/src` matched nothing but a comment).

**Removed:**
- `body` from `LISA_UPGRADE_PITCH` (`client/src/components/tutor/lisa-upgrade-pitch.ts`), now
  an `as const` object with `title` and `actionLabel`;
- `BillingCtaPitch` and the `pitch` option of `resolveCtaCopy` (`client/src/lib/billing-cta.ts`);
  `student_unentitled` reads its fixed words;
- `PremiumUpgradePrompt`'s `pitch` prop;
- `client/src/lib/billing-cta.pitch.test.ts`. Its last case ("LISA's headline is Karl's,
  verbatim") is already asserted in `client/src/pages/chat.ui56.test.tsx` ("free plan: the
  shipped headline …", `toBe("A Tutor That Knows The SAT And Knows You")`);
- the two `not.toContain(LISA_UPGRADE_PITCH.body)` assertions in
  `ScopedTutorPanel.contract.test.tsx`. The cases still require the approved body, and the
  second requires the card's exact text. Plant OQ54-C1 now draws a different unapproved body
  (the resolver's own "Choose a plan to unlock LISA.") and both cases redden.

**Kept, approved and used:** `LISA_UPGRADE_PITCH.title` (OQ-44's shipped headline: the upgrade
modal's `tutor_access` title, the /chat locked card and the review runner's LISA card) and
`.actionLabel` ("Unlock LISA", both LISA locked cards).

```text
$ grep -rnF -- 'LISA_UPGRADE_PITCH.body' client/src packages server tests scripts
(empty)
$ grep -rnF -- 'BillingCtaPitch' client/src packages server tests scripts
(empty)
$ grep -rnF -- 'billing-cta.pitch' client/src packages server tests scripts
(empty)
$ grep -rnF -- 'options.pitch' client/src packages server tests scripts
(empty)
$ grep -rnF -- 'LISA knows which skills' client/src packages server tests scripts
(empty)
$ grep -rnw -- 'pitch' client/src/lib/billing-cta.ts client/src/components/billing/PremiumUpgradePrompt.tsx
client/src/lib/billing-cta.ts:93:   * The feature's OWN benefit, not a generic pitch. A lock on the calendar and
client/src/components/billing/PremiumUpgradePrompt.tsx:85:   * tutor", "your full mastery breakdown". Not a generic pitch: a lock on the
$ grep -rnwF -- 'LISA_UPGRADE_PITCH' client/src --exclude='*.test.ts' --exclude='*.test.tsx'
client/src/components/billing/upgrade-modal.ts:14: *   - LISA headline: the shipped `LISA_UPGRADE_PITCH.title` ("A Tutor That Knows The SAT And Knows
client/src/components/billing/upgrade-modal.ts:42:import { LISA_UPGRADE_PITCH } from "@/components/tutor/lisa-upgrade-pitch";
client/src/components/billing/upgrade-modal.ts:91: * Title source: shipped `LISA_UPGRADE_PITCH.title` (imported). Body source: prototype
client/src/components/billing/upgrade-modal.ts:95:  title: LISA_UPGRADE_PITCH.title,
client/src/components/tutor/LisaUpgradeCard.tsx:37:import { LISA_UPGRADE_PITCH } from "@/components/tutor/lisa-upgrade-pitch";
client/src/components/tutor/LisaUpgradeCard.tsx:39:export { LISA_UPGRADE_PITCH };
client/src/components/tutor/LisaUpgradeCard.tsx:79:          {LISA_UPGRADE_PITCH.actionLabel}
client/src/components/tutor/lisa-upgrade-pitch.ts:23:export const LISA_UPGRADE_PITCH = {
client/src/pages/chat.tsx:10: *        `LISA_UPGRADE_PITCH.title`; no new wording), OQ-49 (this route comes off the light
client/src/pages/chat.tsx:78:  LISA_UPGRADE_PITCH,
client/src/pages/chat.tsx:180:            {LISA_UPGRADE_PITCH.actionLabel}
```

The two remaining `pitch` hits are comments about the feature-benefit phrase, not the option.
Every remaining `LISA_UPGRADE_PITCH` reads `.title` or `.actionLabel`. Older records that name
the body (the register's OQ-44 / OQ-57 / OQ-61 rows, `owner-questions-OQ51-60.md`,
`evidence/step2-wave1.md`) are history and are not edited.

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

1. **`@radix-ui/react-progress`** (package.json dependency). **Removed** — approved by Karl 2026-10-05 (UI-53 follow-up commit).
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

---

## knip, committed (Codex audit finding 4, 2026-10-05)

Codex's audit of #1073 + #1108 + #1113 (finding 4, LOW, accepted by Karl) asked for the knip run
above to be reproducible from the repo. The config above is now committed as `knip.json` (same
content, plus a `$schema` line), and two scripts run it through a pinned `pnpm dlx` (no dependency
added, lockfile untouched):

```bash
pnpm run deadcode              # pnpm dlx knip@5.88.1 --config knip.json --no-progress --reporter compact
pnpm run deadcode:production   # … --production --include files,exports,types
```

**Run on:** branch `claude/student-ui-audit-fixes`, code as of `71a57e3c` (cut from `cleanup` @ `a6a737ff`,
with the four audit fixes). knip 5.88.1, Node v22.22.2. Both commands exit 1, which is knip's exit
code whenever it lists anything; the scripts are a report, not a CI gate.

| Category | `deadcode` | `deadcode:production` |
|---|---|---|
| Unused files | 6 | 25 |
| Unused exports | 140 | 183 |
| Unused exported types | 169 | 164 |
| Duplicate exports | 10 | not run |
| Unused dependencies | 1 | not run |
| Unused devDependencies | 1 | not run |
| Unlisted dependencies | 196 | not run |
| Unresolved imports | 1 | not run |

These counts are not comparable with the before/after table above: that table was measured on
`claude/student-ui-wave4` before #1073 merged, and `cleanup` has moved since (other verticals' work
included). This is the baseline for the committed config.

Reading the production-mode file list: `client/src` entries that are test fixtures or harnesses
(`*.fixture.ts`, `test-fixtures/`, `test-harness.tsx`, `test-support/`, `test/setupTests.ts`) are
imported only by tests, which production mode does not count. The rest belong to other verticals
(LISA `tutor-error-classifier.ts`, SEO `prerender/` and `shared/seo/`, billing `server/lib/stripe/`,
the question pipeline) and are not deleted here.

The student UI's own shared components appear in the production-mode exports list:
`student-ui/Sheet.tsx` (`Sheet`, `SheetClose`, re-exported from `student-ui/index.ts`),
`RulerProgress.tsx` (`RULER_TICKS`) and `filter-bar/filter-cascade.ts` (`removeDomain`,
`removeSkill`), plus several exported prop types. No shipped code imports them. The audit asked for
the script and its output, not for deletions, so this report does not delete them; they are recorded
as register F-76 for the next student-UI round.

<details><summary><code>pnpm run deadcode</code>, full output</summary>

```
Unused files (6)
client/src/test/setupTests.ts
server/lib/build.ts
server/sat-pdf-processor.ts
server/services/question-publish.ts
server/services/questionTypes.ts
shared/schema.ts
Unused dependencies (1)
package.json: @dnd-kit/utilities, @google-cloud/documentai, @napi-rs/canvas, @types/luxon, @types/uuid, bcryptjs, express-session, express-slow-down, express-validator, hpp, luxon, minimatch, multer, p-limit, pdf-lib, pdf-parse, pdf-parse-debugging-disabled, pdfjs-dist, react-icons, ws, zod-validation-error
Unused devDependencies (1)
package.json: @replit/vite-plugin-cartographer, @replit/vite-plugin-runtime-error-modal, @types/bcryptjs, @types/express-rate-limit, @types/express-session, @types/express-slow-down, @types/hpp, @types/katex, @types/multer, @types/pdf-parse, @types/ws, esbuild-wasm, jest, tw-animate-css
Unlisted dependencies (196)
client/src/components/auth/PasswordField.policy.test.tsx: @lyceon/shared
client/src/components/auth/PasswordField.test.tsx: @lyceon/shared
client/src/components/auth/PasswordField.tsx: @lyceon/shared
client/src/components/auth/RequireRole.tsx: @lyceon/shared
client/src/components/auth/SupabaseAuthForm.tsx: @lyceon/shared
client/src/components/billing/UpgradeModal.test.tsx: @lyceon/shared
client/src/components/billing/UpgradeModal.tsx: @lyceon/shared
client/src/components/billing/upgrade-modal.ts: @lyceon/shared
client/src/components/guardian/CheckoutReturnPoller.test.tsx: @lyceon/shared
client/src/components/guardian/GuardianCta.test.tsx: @lyceon/shared
client/src/components/home/FreeHome.tsx: @lyceon/shared
client/src/components/home/HomePanel.tsx: @lyceon/shared
client/src/components/home/PaidHome.tsx: @lyceon/shared
client/src/components/home/home-model.test.ts: @lyceon/shared
client/src/components/home/home-model.ts: @lyceon/shared
client/src/components/layout/app-shell.rail.test.tsx: @lyceon/shared
client/src/components/layout/app-shell.tsx: @lyceon/shared
client/src/components/mastery/LevelPill.tsx: @lyceon/shared
client/src/components/mastery/LockedMasteryCard.test.tsx: @lyceon/shared
client/src/components/mastery/MasteryMeter.tsx: @lyceon/shared
client/src/components/mastery/MasteryRow.test.tsx: @lyceon/shared
client/src/components/mastery/MasteryRow.tsx: @lyceon/shared
client/src/components/mastery/domain-nodes.ts: @lyceon/shared
client/src/components/notifications/NotificationBell.tsx: @lyceon/shared
client/src/components/practice/CanonicalPracticePage.runner.test.tsx: @lyceon/shared
client/src/components/practice/practice-landing-model.test.ts: @lyceon/shared
client/src/components/practice/practice-landing-model.ts: @lyceon/shared
client/src/components/review/review-landing-model.ts: @lyceon/shared
client/src/components/settings/AccountSection.tsx: @lyceon/shared
client/src/components/settings/BillingSection.tsx: @lyceon/shared
client/src/components/settings/ProfileSection.tsx: @lyceon/shared
client/src/components/student-ui/filter-bar/FilterBar.test.tsx: @lyceon/shared
client/src/components/student-ui/filter-bar/FilterBar.tsx: @lyceon/shared
client/src/components/student-ui/filter-bar/filter-cascade.test.ts: @lyceon/shared
client/src/components/student-ui/filter-bar/filter-cascade.ts: @lyceon/shared
client/src/components/student-ui/filter-bar/topics.fixture.ts: @lyceon/shared
client/src/contexts/SupabaseAuthContext.tsx: @lyceon/shared
client/src/features/calendar/CalendarView.tsx: @lyceon/shared
client/src/features/calendar/api/client.test.ts: @lyceon/shared
client/src/features/calendar/api/client.ts: @lyceon/shared
client/src/features/calendar/api/launch.ts: @lyceon/shared
client/src/features/calendar/api/mutations.test.tsx: @lyceon/shared
client/src/features/calendar/api/mutations.ts: @lyceon/shared
client/src/features/calendar/api/optimistic.test.ts: @lyceon/shared
client/src/features/calendar/api/optimistic.ts: @lyceon/shared
client/src/features/calendar/api/queries.keep-previous.test.tsx: @lyceon/shared
client/src/features/calendar/api/queries.ts: @lyceon/shared
client/src/features/calendar/calendar-week.fixture.ts: @lyceon/shared
client/src/features/calendar/components/BlockSheet.tsx: @lyceon/shared
client/src/features/calendar/components/Chrome.header.test.tsx: @lyceon/shared
client/src/features/calendar/components/Chrome.identity.test.tsx: @lyceon/shared
client/src/features/calendar/components/Chrome.tsx: @lyceon/shared
client/src/features/calendar/components/CreateBlockSheet.test.tsx: @lyceon/shared
client/src/features/calendar/components/CreateBlockSheet.tsx: @lyceon/shared
client/src/features/calendar/components/FreeCalendar.tsx: @lyceon/shared
client/src/features/calendar/components/FullLengthFields.tsx: @lyceon/shared
client/src/features/calendar/components/MixRows.tsx: @lyceon/shared
client/src/features/calendar/components/SettingsSheet.test.tsx: @lyceon/shared
client/src/features/calendar/components/SettingsSheet.tsx: @lyceon/shared
client/src/features/calendar/components/SetupPopup.test.tsx: @lyceon/shared
client/src/features/calendar/components/SetupPopup.tsx: @lyceon/shared
client/src/features/calendar/components/StudentChrome.tsx: @lyceon/shared
client/src/features/calendar/copy/banner.test.ts: @lyceon/shared
client/src/features/calendar/copy/banner.ts: @lyceon/shared
client/src/features/calendar/copy/exam-cadence.ts: @lyceon/shared
client/src/features/calendar/copy/explanations.test.ts: @lyceon/shared
client/src/features/calendar/guardian-readonly.tree.test.tsx: @lyceon/shared
client/src/features/calendar/lib/blocks.test.ts: @lyceon/shared
client/src/features/calendar/lib/blocks.ts: @lyceon/shared
client/src/features/calendar/lib/members.ts: @lyceon/shared
client/src/features/calendar/lib/projection.test.ts: @lyceon/shared
client/src/features/calendar/lib/projection.ts: @lyceon/shared
client/src/features/calendar/lib/setup.ts: @lyceon/shared
client/src/features/calendar/lib/view-model.ts: @lyceon/shared
client/src/features/calendar/mobile-390.test.tsx: @lyceon/shared
client/src/features/calendar/rail-brand.test.tsx: @lyceon/shared
client/src/features/exam/api/exam-api.ts: @lyceon/shared
client/src/features/exam/api/keys.ts: @lyceon/shared
client/src/features/exam/components/ChoiceList.tsx: @lyceon/shared
client/src/features/exam/components/DisclosedScore.tsx: @lyceon/shared
client/src/features/exam/components/DomainSegments.tsx: @lyceon/shared
client/src/features/exam/components/ExamHeader.tsx: @lyceon/shared
client/src/features/exam/components/ExamQuestionView.tsx: @lyceon/shared
client/src/features/exam/components/ModuleReview.tsx: @lyceon/shared
client/src/features/exam/components/NavigatorDialog.tsx: @lyceon/shared
client/src/features/exam/components/PassageView.tsx: @lyceon/shared
client/src/features/exam/components/SubmitModuleDialog.tsx: @lyceon/shared
client/src/features/exam/guardian-domain-bars.test.ts: @lyceon/shared
client/src/features/exam/hooks/useHeartbeat.ts: @lyceon/shared
client/src/features/exam/lib/domain-weights.ts: @lyceon/shared
client/src/features/exam/lib/exam-position.test.ts: @lyceon/shared
client/src/features/exam/lib/exam-position.ts: @lyceon/shared
client/src/features/exam/lib/labels.ts: @lyceon/shared
client/src/features/exam/lib/module-summary.ts: @lyceon/shared
client/src/features/exam/lib/passage.ts: @lyceon/shared
client/src/features/exam/lib/tests-home-model.ts: @lyceon/shared
client/src/features/exam/pages/ExamModulePage.calculator.test.tsx: @lyceon/shared
client/src/features/exam/pages/ExamModulePage.test.tsx: @lyceon/shared
client/src/features/exam/pages/ExamModulePage.tsx: @lyceon/shared
client/src/features/exam/pages/ExamReportPage.test.tsx: @lyceon/shared
client/src/features/exam/pages/ExamReportPage.tsx: @lyceon/shared
client/src/features/exam/pages/ExamSessionPage.tsx: @lyceon/shared
client/src/features/exam/pages/GuardianExamResultsPage.test.tsx: @lyceon/shared
client/src/features/exam/pages/GuardianExamResultsPage.tsx: @lyceon/shared
client/src/features/exam/pages/TestsHomePage.test.tsx: @lyceon/shared
client/src/features/exam/pages/TestsHomePage.tsx: @lyceon/shared
client/src/features/exam/pages/breakdown-parity.test.tsx: @lyceon/shared
client/src/features/exam/test-fixtures/report-fixtures.ts: @lyceon/shared
client/src/features/guardian/AddStudentDialog.tsx: @lyceon/shared
client/src/features/guardian/GuardianDashboardTab.tsx: @lyceon/shared
client/src/features/guardian/GuardianLatestTestCard.tsx: @lyceon/shared
client/src/features/guardian/GuardianMasteryCard.tsx: @lyceon/shared
client/src/features/guardian/GuardianScoreStrip.tsx: @lyceon/shared
client/src/features/guardian/GuardianTemplatePreview.tsx: @lyceon/shared
client/src/features/guardian/dashboard.endpoint-map.test.tsx: @lyceon/shared
client/src/features/guardian/latest-test.test.tsx: @lyceon/shared
client/src/features/guardian/level-colours.test.tsx: @lyceon/shared
client/src/features/guardian/paths.test.ts: @lyceon/shared
client/src/features/guardian/test-harness.tsx: @lyceon/shared
client/src/hooks/tutor-client.ts: @lyceon/shared
client/src/hooks/useActiveSessions.ts: @lyceon/shared
client/src/hooks/useBillingStatusQuery.ts: @lyceon/shared
client/src/hooks/useFeatureAccess.ts: @lyceon/shared
client/src/hooks/useHomeProjection.ts: @lyceon/shared
client/src/hooks/usePractice.ts: @lyceon/shared
client/src/hooks/usePracticeQuota.ts: @lyceon/shared
client/src/hooks/usePracticeTopics.ts: @lyceon/shared
client/src/hooks/useReview.ts: @lyceon/shared
client/src/lib/analytics/consent.ts: @lyceon/shared
client/src/lib/analytics/first-touch.ts: @lyceon/shared
client/src/lib/api-error.ts: @lyceon/shared
client/src/lib/csrf.ts: @lyceon/shared
client/src/lib/engine-config.ts: @lyceon/shared
client/src/lib/guardian-link-redirect.test.tsx: @lyceon/shared
client/src/lib/masteryApi.ts: @lyceon/shared
client/src/lib/notificationsApi.ts: @lyceon/shared
client/src/lib/projectionApi.ts: @lyceon/shared
client/src/lib/review-session-picker.ts: @lyceon/shared
client/src/lib/settings-api.ts: @lyceon/shared
client/src/pages/calendar.setup-wire-contract.test.tsx: @lyceon/shared
client/src/pages/calendar.tsx: @lyceon/shared
client/src/pages/calendar.ui55.test.tsx: @lyceon/shared
client/src/pages/chat.tsx: @lyceon/shared
client/src/pages/chat.ui56.test.tsx: @lyceon/shared
client/src/pages/login.tsx: @lyceon/shared
client/src/pages/lyceon-dashboard.test.tsx: @lyceon/shared
client/src/pages/lyceon-dashboard.tsx: @lyceon/shared
client/src/pages/mastery.test.tsx: @lyceon/shared
client/src/pages/mastery.tsx: @lyceon/shared
client/src/pages/notifications.test.tsx: @lyceon/shared
client/src/pages/notifications.tsx: @lyceon/shared
client/src/pages/practice.test.tsx: @lyceon/shared
client/src/pages/practice.tsx: @lyceon/shared
client/src/pages/profile-complete.tsx: @lyceon/shared
client/src/pages/resume-practice.readonly.test.tsx: @lyceon/shared
client/src/pages/resume-practice.test.tsx: @lyceon/shared
client/src/pages/resume-practice.tsx: @lyceon/shared
client/src/pages/resume-review.test.tsx: @lyceon/shared
client/src/pages/resume-review.tsx: @lyceon/shared
client/src/pages/review.test.tsx: @lyceon/shared
client/src/pages/review.tsx: @lyceon/shared
client/src/pages/settings.test.tsx: @lyceon/shared
client/src/pages/update-password.test.tsx: @lyceon/shared
client/src/pages/update-password.tsx: @lyceon/shared
client/src/review-entry-points.test.ts: @lyceon/shared
scripts/generate-assets.js: sharp
scripts/provisioning/rag-corpus-create.ts: @google-cloud/aiplatform
server/routes/calendar-routes.ts: @lyceon/shared
server/routes/review-canonical.ts: @lyceon/shared
server/routes/student-background-routes.ts: @lyceon/shared
server/services/activity-streak.ts: @lyceon/shared
server/services/calendar/adapters/full-length.ts: @lyceon/shared
server/services/calendar/adapters/index.ts: @lyceon/shared
server/services/calendar/adapters/practice.ts: @lyceon/shared
server/services/calendar/adapters/review.ts: @lyceon/shared
server/services/calendar/adapters/types.ts: @lyceon/shared
server/services/calendar/config.ts: @lyceon/shared
server/services/calendar/launch-deps.ts: @lyceon/shared
server/services/calendar/launch-service.ts: @lyceon/shared
server/services/calendar/plan-service.ts: @lyceon/shared
server/services/calendar/profile-service.ts: @lyceon/shared
server/services/calendar/read-service.ts: @lyceon/shared
server/services/review-pool.ts: @lyceon/shared
server/services/student-background.ts: @lyceon/shared
tests/ci/calendar.launch-contract.full_length.test.ts: @lyceon/shared
tests/ci/calendar.launch-contract.practice.ci.test.ts: @lyceon/shared
tests/ci/calendar.launch-contract.review.test.ts: @lyceon/shared
tests/ci/calendar.launch-crash-retry.postgrest.ci.test.ts: @lyceon/shared
tests/ci/calendar.launch-service.test.ts: @lyceon/shared
tests/ci/guardian-checkout.contract.test.ts: @lyceon/shared
tests/ci/review-pool.sessions-page.test.ts: @lyceon/shared
tests/ci/signup-frontend.contract.test.ts: @lyceon/shared
tests/ci/tutor-route-retired.contract.test.ts: @lyceon/shared
tests/helpers/launch-landing.ts: @lyceon/shared
tests/rls/rls.spec.ts: nanoid
tests/specs/rls-auth-enforcement.spec.ts: nanoid
Unresolved imports (1)
scripts/canary-supabase-questions.ts: ../apps/api/src/lib/canonicalId
Unused exports (140)
client/src/components/auth/RequireRole.tsx: default
client/src/components/consent/CookieConsentRoot.tsx: COOKIE_POLICY_HREF
client/src/components/home/home-model.ts: greetingFor
client/src/components/layout/app-shell.tsx: TAB_BAR_KEYS, TAB_BAR_ITEMS
client/src/components/layout/primitives.tsx: Prose
client/src/components/legal/ReconsentModal.tsx: default
client/src/components/math/FloatingPanel.tsx: clampPanel
client/src/components/math/calculator-layout.ts: CONTAINER_AT_BREAKPOINT
client/src/components/notifications/NotificationBell.tsx: default
client/src/components/practice/CanonicalPracticePage.tsx: TUTOR_SIDE_BY_SIDE_BREAKPOINT, questionPosition, progressSegments
client/src/components/practice/practice-landing-model.ts: sectionLabel
client/src/components/qotd/turnstile.tsx: TURNSTILE_TEST_SITE_KEY, turnstileSiteKey
client/src/components/question-renderer.tsx: DISPLAY_LETTERS, QuestionRenderer
client/src/components/settings/BillingSection.tsx: billingView
client/src/components/student/StudentLinkCodePanel.tsx: STUDENT_LINK_CODE_QUERY_KEY, studentLinkCodeQueryKey
client/src/components/tutor/TutorThreadParts.tsx: TutorMessageContent, LISA_DISCLAIMER, PRACTICE_HANDOFF_HREF
client/src/components/ui/alert-dialog.tsx: AlertDialogPortal, AlertDialogOverlay
client/src/components/ui/alert.tsx: AlertTitle
client/src/components/ui/avatar.tsx: AvatarImage
client/src/components/ui/badge.tsx: badgeVariants
client/src/components/ui/dialog.tsx: DialogPortal, DialogOverlay
client/src/components/ui/dropdown-menu.tsx: DropdownMenuRadioItem, DropdownMenuShortcut, DropdownMenuGroup, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuRadioGroup
client/src/components/ui/scroll-area.tsx: ScrollBar
client/src/components/ui/select.tsx: SelectGroup, SelectLabel, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton
client/src/components/ui/sheet.tsx: SheetPortal, SheetOverlay, SheetHeader, SheetFooter
client/src/components/ui/table.tsx: TableFooter, TableCaption
client/src/components/ui/toast.tsx: ToastAction
client/src/components/ui/tooltip.tsx: Tooltip, TooltipTrigger, TooltipContent
client/src/features/calendar/api/index.ts: deviceTimezone, useLaunchMutation, isLaunchable, practiceStateKey, prefetchPracticeChunk, applyAcknowledge, applyBlockEdit, applyDoItNow, applyMove, applyRemoveBlock, findBlock, isProvisional, nextProvisionalId, resetProvisionalIds, PROVISIONAL_PREFIX
client/src/features/calendar/api/launch.ts: reviewStateKey, prefetchPracticeChunk, calendarKeys
client/src/features/calendar/api/optimistic.ts: PROVISIONAL_PREFIX, nextProvisionalId
client/src/features/calendar/api/queries.ts: deviceTimezone
client/src/features/calendar/calendar-week.fixture.ts: calendarWeekRange
client/src/features/calendar/components/Chrome.tsx: TargetFact, StreakFact, CountdownFact, ProjectionFact
client/src/features/exam/api/exam-api.ts: EXAM_ROOT
client/src/features/exam/components/QuestionCell.tsx: cellLabel, MarkedIcon
client/src/features/exam/hooks/useHeartbeat.ts: HEARTBEAT_INTERVAL_MS
client/src/features/exam/lib/countdown.ts: FIVE_MINUTES_MS, ONE_MINUTE_MS
client/src/features/exam/lib/module-summary.ts: isAnswered
client/src/features/exam/lib/tests-home-model.ts: EXAM_IN_PROGRESS_STATES, inProgressLine
client/src/features/exam/test-fixtures/report-fixtures.ts: FIXTURE_RW_ROWS
client/src/features/guardian/test-harness.tsx: listFactsOf
client/src/hooks/tutor-client.ts: tutorConversationQueryKey, tutorConversationsQueryKey
client/src/hooks/use-toast.ts: reducer
client/src/hooks/useBillingPortal.ts: portalErrorMessage
client/src/hooks/useBillingStatusQuery.ts: BILLING_STATUS_PATH, fetchBillingStatus
client/src/hooks/useProfileQuery.ts: PROFILE_PATH, fetchProfile
client/src/hooks/useReview.ts: REVIEW_POOL_QUERY_KEY, REVIEW_OPEN_SESSIONS_QUERY_KEY, reviewPoolPath, dropClosedSessions
client/src/hooks/useTutorTurn.ts: CLIENT_TIMEOUT_MS
client/src/lib/analytics/consent.ts: browserSendsGpc
client/src/lib/analytics/posthog-client.ts: analyticsConfigured
client/src/lib/analytics/url-scrub.ts: scrubString
client/src/lib/api-error.ts: getPremiumDenialReason, isCsrfError, isTransportError
client/src/lib/blog.ts: getPostsByTag, getPostsByCategory, getAllTags
client/src/lib/client-instance.ts: resetClientInstanceId
client/src/lib/legal-content.ts: LegalNotFoundError, loadLegalManifest
client/src/lib/link-code-prefill.ts: LINK_CODE_QUERY_PARAM
client/src/lib/notificationsApi.ts: NOTIFICATIONS_PAGE_LIMIT
client/src/lib/practice-filters.ts: parseDifficultiesFromSearch, parseDomainsFromSearch, appendPracticeFilters
client/src/lib/qotd.ts: QOTD_API, fetchQotdToday, fetchQotdArchiveDay, fetchQotdArchiveIndex
client/src/lib/settings-api.ts: PROFILE_NAME_PATH, CHANGE_PASSWORD_PATH
client/src/lib/support-contact.ts: PRIVACY_EMAIL
client/src/lib/theme.ts: isThemePreference
client/src/prerender/entry-server.tsx: NOT_FOUND_RENDER_PATH, outputFileFor, renderAppHtml
client/src/test-support/runner.harness.tsx: RunnerFrame
packages/shared/src/billing-pricing.ts: monthsInInterval
packages/shared/src/event-registry-schema.ts: eventRedactionMethodSchema, canonicalEventClassSchema, registryPersonPropertySchema
packages/shared/src/exam-report-schema.ts: examIncompletenessReasonSchema, examFormSectionSummarySchema, examFormLatestSessionSchema, examFormSummarySchema
packages/shared/src/exam-student-report-schema.ts: examStudentReportPartialSchema
packages/shared/src/profile-role-choice-schema.ts: ROLE_CHOICE_ERROR_CODES
packages/shared/src/qotd-schema.ts: QOTD_MIN_ATTEMPTS_FOR_STAT, qotdOptionKeySchema, qotdOptionTokenSchema, qotdServedOptionSchema, qotdPreSubmitQuestionSchema, qotdArchiveQuestionSchema
packages/shared/src/services/rate-limit-ledger.ts: windowFor, bucketFamily, getUsage
server/lib/account-deletion-runtime-config.ts: DELETION_GRACE_DAYS_KEY
server/lib/account.ts: getGuardianLinkForStudent, getPracticeDailyFreeQuota, getDailyUsage, incrementUsage, checkUsageLimit, getLinkedGuardianForStudent, FREE_TIER_LIMITS
server/lib/auth-runtime-config.ts: STUDENT_LINK_CODE_TTL_KEY
server/lib/client-ip.ts: PUBLIC_API_PREFIX, isPublicApiRequest
server/lib/entitlement-runtime-config.ts: EXAM_RENEWAL_CONFIG_KEYS, EXAM_RENEWAL_CONFIG_DEFAULTS
server/lib/notifications/transport.ts: RESEND_API_BASE_URL, resendSuppressionSchema, normaliseAddress
server/lib/password-credentials.ts: RECOVERY_GRANT_TTL_SECONDS, PASSWORD_RESET_BUCKET, PASSWORD_RESET_RESPONSE_FLOOR_MS
server/lib/practice-quota.ts: UNLIMITED_PRACTICE_DECISION_CODES
server/lib/role-choice.ts: LEARNING_STATE_ROOTS, MAX_PLAUSIBLE_AGE_YEARS
server/lib/startup-guards.ts: __resetGcpStartupReportForTests
server/lib/stripe/country-backfill.ts: BLANK_COUNTRY_SQL
server/lib/stripe/country-denial-remediation.ts: TERMINAL_SUBSCRIPTION_STATUSES
server/lib/stripe/dispute.ts: disputeStatusSchema, CLOSED_DISPOSITION
server/lib/stripe/guardian-subscriptions.ts: GUARDIAN_SUBSCRIPTION_PAGE_SIZE, GUARDIAN_SUBSCRIPTION_MAX_PAGES, FUNDING_SUBSCRIPTION_STATUSES
server/lib/stripe/purchase-idempotency.ts: PURCHASE_IDEMPOTENCY_WINDOW_MS
server/lib/stripe/redact.ts: classifyError
server/lib/stripe/refund.ts: REVOKING_REFUND_STATUS
server/lib/stripe/webhook-handler.ts: StripePayloadShapeError, UnresolvableSubjectError
server/lib/student-link-code.ts: generateStudentLinkCode
server/lib/support-contact.ts: PRIVACY_EMAIL
server/logger.ts: containsSecretContent, createLoggingContext
server/middleware/api-cache-control.ts: API_CACHE_CONTROL_DEFAULT
server/middleware/csrf-double-submit.ts: csrfCookieName
server/middleware/final-error-handler.ts: isCsrfError, CSRF_BLOCKED
server/middleware/supabase-auth.ts: sendUnauthenticated (authMiddleware)
server/routes/account-deletion-routes.ts: recoverDeletionSchema, revokeSessionsAtDeletionRequest
server/routes/calendar-routes.ts: CALENDAR_PLAN_REGENERATE_BUCKET, CALENDAR_DAY_REGENERATE_BUCKET
server/routes/notifications.ts: encodeFeedCursor, decodeFeedCursor
server/routes/oauth-callback-routes.ts: classifyProviderError, classifyNoCredential, classifyOtpFailure
server/routes/practice-topics-routes.ts: default
server/routes/public-pricing-routes.ts: __resetPublicPricingMemoForTests
server/routes/resend-webhook.ts: processResendWebhook
server/routes/review-canonical.ts: submitReviewAnswer, submitReviewSkip, reviewCanonicalRouter, REVIEW_COMPONENT
server/routes/score-report-routes.ts: default
server/routes/student-background-routes.ts: REFERENCE_SEARCH_BUCKET
server/services/activity-streak.ts: resolveStudentTimeZone
server/services/calendar/adapters/index.ts: adapterForBlock, ADAPTERS, localDayWindowUtc, isKnownTimeZone, localTodayIn
server/services/calendar/adapters/types.ts: ENGINE_FAILURE_REASONS
server/services/calendar/launch-deps.ts: engineOfBlock
server/services/calendar/profile-service.ts: localTodayForProfile
server/services/calendar/read-service.ts: FALLBACK_TIMEZONE
server/services/canonical-runtime-views.ts: CANONICAL_RUNTIME_VIEW_VERSION
server/services/cloud-tasks-enqueue.ts: CLOUD_TASKS_LOCATION
server/services/email-reconsent-audit.ts: EMAIL_RECONSENT_ACTION
server/services/exam-score-renewal/job.ts: EXAM_SCORE_RENEWAL_JOB, EXAM_SCORE_RENEWAL_OUTCOMES
server/services/kpi-access.ts: resolvePaidKpiAccessForStudent
server/services/qotd/qotd-service.ts: QOTD_TIME_ZONE, qotdTokenMapFor, qotdCorrectOptionId
server/services/qotd/schedule-job.ts: QOTD_ROTATION_EPOCH
server/services/retention-sweep.ts: sweep90d, sweep180d, SWEEP_COMPLETED_ACTION
server/services/review-pool.ts: resolveTimeZone, encodeSourceSessionsCursor
server/services/student-background.ts: StudentBackgroundReadError
server/services/subject-access-audit.ts: SUBJECT_ACCESS_ACTION
server/services/tutor-antileak.ts: hasAnswerLeak
server/services/tutor-context.ts: hasAnswerLeak
server/services/tutor-crisis.ts: UNKNOWN_COUNTRY_CRISIS_RESPONSE, UNKNOWN_COUNTRY_SAFEGUARDING_RESPONSE, resolveCrisisCountry
server/services/tutor-display-letters.ts: DISPLAY_LETTERS
server/services/tutor-error-codes.ts: TUTOR_UNAUTHENTICATED, TUTOR_TOKEN_EXPIRED, TUTOR_ROLE_NOT_PERMITTED, TUTOR_ENTITLEMENT_REQUIRED, TUTOR_AGE_RESTRICTED, TUTOR_REGION_NOT_SUPPORTED, TUTOR_UNAVAILABLE_DURING_LIVE_EXAM, TUTOR_ACCOUNT_UNDER_REVIEW, TUTOR_INVALID_INPUT, TUTOR_PII_IN_ENVELOPE, TUTOR_RATE_LIMITED, TUTOR_QUOTA_EXCEEDED, TUTOR_CONVERSATION_NOT_FOUND, TUTOR_CONVERSATION_CLOSED, TUTOR_CONVERSATION_ALREADY_CLOSED, TUTOR_CONVERSATION_ALREADY_ENDED, TUTOR_CONVERSATION_CRISIS_PAUSED, TUTOR_CONVERSATION_NOT_PAUSED, TUTOR_IDEMPOTENCY_CONFLICT, TUTOR_IDEMPOTENCY_IN_PROGRESS, TUTOR_IDEMPOTENCY_LOOKUP_FAILED, TUTOR_CANONICAL_WRITE_FAILED, TUTOR_ORCHESTRATION_AUTH_FAILED, TUTOR_ORCHESTRATION_FAILED, TUTOR_ORCHESTRATION_FAILED_RECOVERABLE, TUTOR_ENTITLEMENT_CHECK_UNAVAILABLE, sendTutorResultError
server/services/tutor-injection-defense.ts: wrapWithBoundaryMarkers
server/services/tutor-memory.ts: accumulateObservation
server/services/tutor-model-armor.ts: MODEL_ARMOR_LOCATION, sanitizeResponseSchema, evaluateSanitization, modelArmorSanitizeUrl
shared/qotd/projection.ts: qotdServedOptions
shared/question-bank-contract.ts: CANONICAL_ID_PATTERN, QUESTION_LIFECYCLE, LEGACY_QUESTION_LIFECYCLE, CANONICAL_DOMAINS, DOMAIN_LOOKUP, normalizeLifecycleStatus, isPublishedLifecycleStatus, hasSingleCanonicalCorrectAnswer, isCanonicalRuntimeMcQuestion, hasCanonicalGridInVariantSet, isCanonicalRuntimeGridInQuestion, CANONICAL_ID_SUFFIX_LENGTH, generateCanonicalIdSuffix, normalizeSourceType, validateQuestionForPublish
shared/question-ingestion-qa.ts: fingerprintCandidate
shared/seo/head.ts: escapeHtml
shared/seo/public-meta.ts: qotdArchiveMeta
shared/seo/route-registry.ts: preservedVercelRoutes
shared/tutor-orchestrator-wire.ts: resolvedScopeSchema, recentMessageSchema, memorySummarySchema, policyAssignmentSchema, masterySnapshotSchema, recentFrictionSchema, kpiStateSchema, studentLearningContextSchema, explanationFormEnum, memoryStructuredFieldsSchema, questionOptionSchema, questionContentSchema, questionLinkSchema, instructionExposureSchema, learnerObservationSchema, compactRequestSchema, compactResponseSchema
shared/tutor-safety-constants.ts: STRUCTURAL_PREFIXES, ASSERTION_PATTERNS, POST_VALUE_ASSERTION_PATTERNS, GENERIC_LEAK_PATTERNS, fractionToDecimal, buildMcqPatterns, positionalReferenceSource, buildMcqPositionalPatterns, answerValueAppearsIn, CANONICAL_ID_SCAN_PATTERN, SYSTEM_PROMPT_LEAK_PATTERNS, PERSONA_VIOLATION_PATTERNS, INTERNAL_METADATA_PATTERNS
Unused exported types (169)
client/src/components/MathRenderer.tsx: MathContentToken
client/src/components/auth/PasswordField.tsx: PasswordFieldProps
client/src/components/billing/PremiumUpgradePrompt.tsx: PremiumUpgradePromptProps
client/src/components/common/empty-state.tsx: EmptyStateProps
client/src/components/layout/FocusShell.tsx: FocusShellProps
client/src/components/layout/HeaderUserMenu.tsx: HeaderSignOut, HeaderMenuTone
client/src/components/layout/app-shell.tsx: RailItem, AppShellProps
client/src/components/mastery/LevelPill.tsx: LevelPillSize
client/src/components/mastery/MasteryRow.tsx: MasteryRowVariant
client/src/components/practice/NumericEntryInput.tsx: NumericEntryInputProps
client/src/components/practice/RunnerStateCard.tsx: RunnerStateCardProps
client/src/components/question-renderer.tsx: QuestionRendererProps
client/src/components/settings/BillingSection.tsx: BillingView
client/src/components/student-ui/FullPageLoader.tsx: FullPageLoaderProps
client/src/components/student-ui/Modal.tsx: ModalProps
client/src/components/student-ui/Notice.tsx: NoticeTone, NoticeProps
client/src/components/student-ui/PageHeader.tsx: PageHeaderProps
client/src/components/student-ui/Sheet.tsx: SheetProps
client/src/components/student-ui/filter-bar/FilterBar.tsx: FilterBarProps
client/src/components/student-ui/filter-bar/filter-cascade.ts: FilterChip
client/src/components/student-ui/filter-bar/topics.fixture.ts: CatalogRow
client/src/components/student-ui/index.ts: PageHeaderProps, FullPageLoaderProps, ModalProps, SheetProps, NoticeProps, NoticeTone, FilterBarProps
client/src/components/tutor/TutorThreadParts.tsx: ThreadInset
client/src/components/ui/badge.tsx: BadgeProps
client/src/components/ui/button.tsx: ButtonProps
client/src/components/ui/input.tsx: InputVariant
client/src/components/ui/skeleton.tsx: SkeletonProps
client/src/components/ui/tabs.tsx: TabsVariant
client/src/contexts/SupabaseAuthContext.tsx: SignupOutcome, SignupResult, SignupLegalConsent
client/src/features/calendar/CalendarView.tsx: CalendarMutations, CalendarViewProps
client/src/features/calendar/api/client.ts: DayMembers
client/src/features/calendar/api/index.ts: DayScopedVariables, DoItNowVariables, EditDayVariables, Intent, LaunchVariables, MoveBlockVariables, RegenerateVariables, LaunchOutcome
client/src/features/calendar/api/mutations.ts: Intent, EditDayVariables, MoveBlockVariables, RegenerateVariables, DayScopedVariables, DoItNowVariables, LaunchVariables
client/src/features/calendar/components/BlockCard.tsx: BlockCardProps
client/src/features/calendar/components/BlockSheet.tsx: BlockSheetProps
client/src/features/calendar/components/CreateBlockSheet.tsx: CreateBlockSheetProps
client/src/features/calendar/components/DayStrip.tsx: DayStripProps
client/src/features/calendar/components/MonthGrid.tsx: MonthGridProps
client/src/features/calendar/components/SettingsSheet.tsx: SettingsSheetProps
client/src/features/calendar/components/StudentChrome.tsx: RegenerateControl
client/src/features/calendar/components/WeekGrid.tsx: WeekGridProps
client/src/features/exam/api/exam-api.ts: ExamItemsResponse, ExamStartModuleResponse, ExamSubmitModuleResponse
client/src/features/exam/hooks/useExamClock.ts: ExamClock
client/src/features/exam/hooks/useWriteQueue.ts: WriteQueue
client/src/features/exam/lib/exam-position.ts: ExamPosition, ModuleRoute
client/src/features/exam/lib/passage.ts: PassageSegment, HighlightEdit
client/src/hooks/tutor-client.ts: TutorEntryMode, TutorConversationStatus, TutorConversationSurface, TutorMessageRole, TutorResolvedScope, CreateConversationInput, TutorConversation, SendMessageInput, TutorConversationsList, EndConversationResponse, ResumeConversationResponse
client/src/hooks/useBillingPortal.ts: UseBillingPortalResult
client/src/hooks/useCanonicalPractice.ts: PracticeNextResponse, PracticeAnswerResponse, PracticeSkipResponse, PracticeSessionSpecInput
client/src/hooks/useDiagnosticStart.ts: DiagnosticStartResult, DiagnosticStartError
client/src/hooks/useKeyboardShortcuts.ts: ShortcutKey, ExamModuleKeymapInput, LisaComposerKeymapInput, EscapeKeymapOptions
client/src/hooks/usePractice.ts: PracticeSessionStart
client/src/hooks/useReview.ts: ReviewStartResult
client/src/hooks/useTutorTurn.ts: TurnState, TutorTurn
client/src/lib/account-deletion-errors.ts: DeletionErrorCopy
client/src/lib/analytics/consent.ts: ConsentState
client/src/lib/api-error.ts: PremiumDenialReason, UserFacingErrorMessage
client/src/lib/billing-client.ts: BillingCheckoutOutcome
client/src/lib/billing-cta.ts: BillingCtaDestination, BillingCtaAction, BillingCtaCopy
client/src/lib/blog.ts: BlogPost
client/src/lib/cta-click.ts: CtaClickHandlers
client/src/lib/legal-content.ts: LegalManifest, LegalSection, LegalDocumentContent
client/src/lib/masteryApi.ts: MasteryLevelKey, MasteryDomainsResponse, MasterySkillsResponse
client/src/lib/practice-filters.ts: PracticeFilters
client/src/lib/practice-topic-taxonomy.ts: PracticeTopicDomain
client/src/lib/projectionApi.ts: ConfidenceBand, EstimateStatus
client/src/lib/query-freshness.ts: QueryFreshnessKind
client/src/lib/route-shells.ts: ShellKind, ShellExclusionReason
client/src/lib/theme.ts: ResolvedTheme, SaveResult
packages/shared/src/__fixtures__/linked-student.ts: LinkedStudentOverrides
packages/shared/src/analytics-consent-schema.ts: CookieConsentRecord
packages/shared/src/billing-pricing.ts: BillingPlanPricing
packages/shared/src/csrf-token-schema.ts: CsrfTokenResponse
packages/shared/src/event-registry-schema.ts: EventRedactionMethod
packages/shared/src/exam-domain-segments.ts: StudentDomainSegments
packages/shared/src/exam-report-schema.ts: ReportStateInputs
packages/shared/src/exam-scored-sessions-schema.ts: ExamScoredSessionsQuery
packages/shared/src/practice-schema.ts: QuestionsRow, PracticeSessionRow
packages/shared/src/profile-name-schema.ts: ProfileNameUpdateRequest
packages/shared/src/qotd-schema.ts: QotdServedOption, QotdPreSubmitQuestion, QotdArchiveQuestion
packages/shared/src/retention-schema.ts: RetentionSweepRow
packages/shared/src/review-table-schema.ts: ReviewSessionRow, ReviewScheduleRow
packages/shared/src/services/rate-limit-ledger.ts: BucketDefinition, LedgerSubject
server/lib/account.ts: GuardianLink, PairPremiumSource, LinkedPairPremiumAccess
server/lib/analytics/emit-event.ts: EmitRefusal, EmitResult, EmitOptions
server/lib/baseline-pending.ts: BaselinePendingReport
server/lib/entitlement-display.ts: EntitlementDisplay, EntitlementDisplayInput
server/lib/entitlement-runtime-config.ts: ExamRenewalConfig
server/lib/gcp-credentials.ts: GcpServiceAccount, GcpAccessTokenResult
server/lib/legal-acceptance.ts: LegalAcceptanceRecord, LegalCaptureResult
server/lib/legal-registry.ts: ResolvedLegalVersion
server/lib/notifications/direct-sends.ts: DirectSendResult
server/lib/notifications/dispatch.ts: DispatchSummary, DispatchOptions
server/lib/notifications/retention.ts: NotificationRetentionSweepSummary
server/lib/notifications/svix.ts: SvixFailure, SvixVerification
server/lib/notifications/templates/index.ts: EmailRender, InAppRender
server/lib/notifications/transport.ts: SuppressionFailure, SuppressionLogContext, SuppressionTransport
server/lib/password-credentials.ts: PasswordChangeFailure, PasswordResetDecision
server/lib/redact.ts: ErrorClass
server/lib/retention/sweeps.ts: RetentionSweepSummary
server/lib/review-stale-session-sweep.ts: ReviewSessionSweepResult
server/lib/role-choice.ts: SelfAssignableRole, RoleChoiceDecision
server/lib/session-revoke.ts: SessionRevokeAdmin, SessionRevokeLog
server/lib/stale-session-sweep.ts: StaleSessionSweepResult
server/lib/startup-guards.ts: SiteUrlVerdict
server/lib/stripe/client.ts: StripeMode
server/lib/stripe/country-backfill.ts: CountryBackfillPlan
server/lib/stripe/country-denial-remediation.ts: RemediationPlan, CancellationStep, RefundStep
server/lib/stripe/country-eligibility.ts: CountryEligibility
server/lib/stripe/dispute.ts: DisputeStatus, ClosedDisposition, DisputeEvent
server/lib/stripe/entitlement-paths.ts: PathTrigger, EntitlementDirection
server/lib/stripe/event-surface.ts: EventDisposition
server/lib/stripe/guardian-checkout.ts: GuardianPurchaseSubject, GuardianPurchaseRefusal
server/lib/stripe/guardian-subscriptions.ts: GuardianSubscriptionScan
server/lib/stripe/purchase-eligibility.ts: PurchaseEligibility
server/lib/stripe/redact.ts: ErrorClass
server/lib/stripe/refund.ts: RefundEvent, RefundDecision
server/lib/stripe/renewal-cancellation.ts: RenewalCancellationOutcome
server/lib/stripe/subscription-item.ts: ResolvedEntitlementItem
server/lib/stripe/webhook-handler.ts: WebhookOutcome
server/lib/student-link-code.ts: RedeemOutcome, LiveCodeOwner
server/lib/turnstile.ts: TurnstileResult
server/lib/tutor-orchestrator-client.ts: OrchestrateResult, CompactResult
server/lib/validation-log.ts: RejectedRequestContext
server/logger.ts: LogEntry, PerformanceMetrics, LogContext
server/middleware/supabase-auth.ts: TokenResolutionResult, DeletionStatusState, DeletionStatusResult, DeletionStatusResolver (authMiddleware)
server/routes/oauth-callback-routes.ts: CallbackFailureCode
server/routes/practice-canonical.ts: GradeResult, SessionItemRow, PracticeConfig, QuestionSnapshotRow
server/routes/resend-webhook.ts: ResendWebhookOutcome
server/services/calendar/adapters/local-day.ts: LocalDayWindow
server/services/calendar/adapters/types.ts: EngineFailureReason
server/services/calendar/config.ts: CalendarConfigKey
server/services/calendar/exam-notify-job.ts: ExamNotifyOutcome, ExamNotifySummary
server/services/calendar/launch-service.ts: LaunchRequest
server/services/calendar/plan-service.ts: PlanInitiator, HorizonTrigger, RegenerateRequest, DayRegenerateRequest, DayEditRequest, DoItNowRequest, MoveBlockRequest
server/services/calendar/profile-service.ts: ProfileUpsertOutcome
server/services/calendar/read-service.ts: CalendarReadResult, GuardianReadResult, CalendarReadRequest
server/services/calendar/weekly-job.ts: JobOutcome, WeeklyJobSummary
server/services/canonical-runtime-views.ts: KpiExplanation, ExplainedKpiMetric, StudentKpiView, ScoreEstimate, CanonicalScoreEstimate, BaselineEstimate
server/services/cloud-tasks-enqueue.ts: CloudTasksAccess, CloudTaskPayload
server/services/crisis-notification.ts: CrisisNotificationPayload, BreachedCaseSummary
server/services/crisis-resources.ts: CrisisCountryResolution
server/services/crisis-review-queue.ts: CrisisSource, CrisisCategory, CaseStatus, CaseDisposition, AuditAction, UpdateDispositionParams, AuditLogParams
server/services/entitlement-service.ts: EntitlementActiveResult
server/services/exam-report-service.ts: ExamReportRead, ExamScoredSessionsRead
server/services/exam-score-renewal/job.ts: ExamScoreRenewalOutcome, ExamScoreRenewalSummary
server/services/kpi-access.ts: KpiEntitlementAccess
server/services/qotd/qotd-service.ts: QotdRow
server/services/qotd/schedule-job.ts: QotdDayOutcome, QotdScheduleSummary
server/services/retention-sweep.ts: SweepTableCount, SweepResult, SweepOpts, TierHandler
server/services/review-pool.ts: ReviewPoolResult
server/services/student-background.ts: StudentBackgroundFailure
server/services/tutor-compaction.ts: ChatCompactionContent
server/services/tutor-context.ts: SessionTables, ResolvedScope, EnvelopeParams
server/services/tutor-crisis.ts: NotificationPolicyResult, CrisisResult, CrisisCountryResolution
server/services/tutor-display-letters.ts: DisplayOption, DisplayOrder
server/services/tutor-memory-refresh.ts: MemoryRefreshParams, MemoryRefreshResult
server/services/tutor-model-armor.ts: ModelArmorScanPoint, ModelArmorSkipReason, ModelArmorVerdict, SanitizationEvaluation
server/services/tutor-output-serializer.ts: SerializedOutput
server/services/tutor-pending-reconciliation.ts: PendingReconciliationResult
server/services/tutor-policy-logger.ts: ContextResolutionLog, TurnMetricsLog
server/services/tutor-runtime-writer.ts: InstructionAssignmentParams
shared/legal-consent.ts: LegalDocRef
shared/question-bank-contract.ts: CanonicalSourceType, QuestionLifecycle, StudentSafeQuestionProjection, ClientInstanceResolutionAction, ClientInstanceResolution, PublishValidationResult
shared/question-ingestion-qa.ts: QaReasonCode, QaReason, IngestionQaResult, Rational, GridInKey
shared/section-display.ts: SectionDisplayLabel
shared/seo/banned-phrases.ts: BannedPhrase
shared/seo/public-meta.ts: LegalMeta
shared/tutor-orchestrator-wire.ts: OrchestrateResponse, CompactRequest, CompactResponse, StudentLearningContext, MemoryStructuredFields, LearnerObservation, RecentFriction, MasterySnapshot, KpiState, ExplanationForm, QuestionContent
Duplicate exports (10)
client/src/components/MathRenderer.tsx: MathRenderer, default
client/src/components/auth/RequireRole.tsx: RequireRole, default
client/src/components/legal/ReconsentModal.tsx: ReconsentModal, default
client/src/components/math/calculator-layout.ts: CALC_MIN_PCT, CALC_DEFAULT_PCT
client/src/components/notifications/NotificationBell.tsx: NotificationBell, default
packages/shared/src/calendar/api.ts: versionResponseSchema, moveBlockResponseSchema
packages/shared/src/calendar/scope.ts: calendarBlockTypeSchema, calendarEngineSchema
packages/shared/src/calendar/scope.ts: CALENDAR_BLOCK_TYPES, CALENDAR_ENGINES
packages/shared/src/exam-runtime-schema.ts: examWorkspaceItemSchema, examWorkspaceSaveRequestSchema
server/routes/score-report-routes.ts: scoreReportRouter, default
```

</details>

<details><summary><code>pnpm run deadcode:production</code>, full output</summary>

```
Unused files (25)
client/src/components/student-ui/filter-bar/topics.fixture.ts
client/src/features/calendar/calendar-week.fixture.ts
client/src/features/exam/test-fixtures/report-fixtures.ts
client/src/features/guardian/test-harness.tsx
client/src/lib/tutor-error-classifier.ts
client/src/prerender/entry-server.tsx
client/src/prerender/qotd-archive-source.ts
client/src/styles/wcag-contrast.ts
client/src/test-support/runner.harness.tsx
client/src/test/setupTests.ts
packages/shared/src/__fixtures__/linked-student.ts
packages/shared/src/column-disposition.ts
server/lib/build.ts
server/lib/stripe/country-backfill.ts
server/lib/stripe/entitlement-paths.ts
server/sat-pdf-processor.ts
server/scripts/backfill-question-metadata.ts
server/scripts/cleanup-question-stems.ts
server/services/question-publish.ts
server/services/questionTypes.ts
shared/question-ingestion-qa.ts
shared/schema.ts
shared/seo/head.ts
shared/seo/route-registry.ts
shared/tutor-orchestrator-wire.ts
Unused exports (183)
client/src/App.tsx: Router, ErrorBoundary, DeletionGate
client/src/components/auth/RequireRole.tsx: default
client/src/components/consent/CookieConsentRoot.tsx: COOKIE_POLICY_HREF
client/src/components/guardian/CheckoutReturnPoller.tsx: POLLING_TIMEOUT_MS
client/src/components/home/FullLengthCard.tsx: FULL_LENGTH_CARD_LINE, FULL_LENGTH_CARD_ACTION
client/src/components/home/home-model.ts: greetingFor, aboutMinutes
client/src/components/layout/BareCardShell.tsx: BARE_CARD_PROSE_LEADING
client/src/components/layout/app-shell.tsx: RAIL_ITEMS, TAB_BAR_KEYS, TAB_BAR_ITEMS
client/src/components/layout/primitives.tsx: Prose
client/src/components/legal/ReconsentModal.tsx: default
client/src/components/math/FloatingPanel.tsx: clampPanel
client/src/components/math/calculator-layout.ts: DESMOS_HOST_MIN_PX, CALC_PANEL_PAD_PX, CONTAINER_AT_BREAKPOINT
client/src/components/notifications/NotificationBell.tsx: default
client/src/components/practice/CanonicalPracticePage.tsx: CALC_MIN_PX, CALC_PANEL_PAD_PX, DESMOS_HOST_MIN_PX, QUESTION_MIN_PX, SPLIT_BREAKPOINT, TUTOR_PANEL_PX, THREE_PANEL_BREAKPOINT, TUTOR_SIDE_BY_SIDE_BREAKPOINT, SHORTER_SESSION_NOTE, questionPosition, progressSegments
client/src/components/practice/practice-landing-model.ts: sectionLabel
client/src/components/qotd/turnstile.tsx: TURNSTILE_TEST_SITE_KEY, turnstileSiteKey
client/src/components/question-renderer.tsx: DISPLAY_LETTERS, MISS_NOTE, QuestionRenderer
client/src/components/settings/BillingSection.tsx: billingView
client/src/components/student-ui/RulerProgress.tsx: RULER_TICKS
client/src/components/student-ui/Sheet.tsx: Sheet, SheetClose
client/src/components/student-ui/filter-bar/filter-cascade.ts: removeDomain, removeSkill
client/src/components/student-ui/index.ts: Sheet, SheetClose
client/src/components/student/StudentLinkCodePanel.tsx: STUDENT_LINK_CODE_QUERY_KEY, studentLinkCodeQueryKey
client/src/components/tutor/ScopedTutorPanel.tsx: OPENER_TITLE, OPENER_BODY
client/src/components/tutor/TutorThreadParts.tsx: TutorMessageContent, LISA_DISCLAIMER, PRACTICE_HANDOFF_HREF
client/src/components/ui/alert-dialog.tsx: AlertDialogPortal, AlertDialogOverlay
client/src/components/ui/alert.tsx: AlertTitle
client/src/components/ui/avatar.tsx: AvatarImage
client/src/components/ui/badge.tsx: badgeVariants
client/src/components/ui/dialog.tsx: DialogPortal, DialogOverlay
client/src/components/ui/dropdown-menu.tsx: DropdownMenuRadioItem, DropdownMenuShortcut, DropdownMenuGroup, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuRadioGroup
client/src/components/ui/scroll-area.tsx: ScrollBar
client/src/components/ui/select.tsx: SelectGroup, SelectLabel, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton
client/src/components/ui/sheet.tsx: SheetPortal, SheetOverlay, SheetHeader, SheetFooter
client/src/components/ui/table.tsx: TableFooter, TableCaption
client/src/components/ui/toast.tsx: ToastAction
client/src/components/ui/tooltip.tsx: Tooltip, TooltipTrigger, TooltipContent
client/src/features/calendar/api/client.ts: CALENDAR_ROOT
client/src/features/calendar/api/index.ts: deviceTimezone, useLaunchMutation, isLaunchable, practiceStateKey, prefetchPracticeChunk, applyAcknowledge, applyBlockEdit, applyDoItNow, applyMove, applyRemoveBlock, findBlock, isProvisional, nextProvisionalId, resetProvisionalIds, PROVISIONAL_PREFIX
client/src/features/calendar/api/launch.ts: practiceStateKey, reviewStateKey, stateKeyForEngine, isLaunchable, prefetchPracticeChunk, calendarKeys
client/src/features/calendar/api/optimistic.ts: PROVISIONAL_PREFIX, isProvisional, nextProvisionalId, resetProvisionalIds, findBlock
client/src/features/calendar/api/queries.ts: deviceTimezone
client/src/features/calendar/components/Chrome.tsx: TargetFact, StreakFact, CountdownFact, ProjectionFact, SUPPRESSION_COPY_TABLE
client/src/features/calendar/components/SettingsSheet.tsx: examPairIncomplete
client/src/features/calendar/copy/banner.ts: BANNER_COPY_TABLE
client/src/features/calendar/copy/explanations.ts: blockExplanation, domainExplanation, EXPLANATION_COPY_TABLES
client/src/features/calendar/lib/blocks.ts: mixOf, isPastDate
client/src/features/calendar/lib/dates.ts: dayOfWeek, addMonths, WEEK_LENGTH, MONTH_GRID_LENGTH
client/src/features/exam/api/exam-api.ts: EXAM_ROOT
client/src/features/exam/components/QuestionCell.tsx: cellLabel, MarkedIcon
client/src/features/exam/hooks/useHeartbeat.ts: HEARTBEAT_INTERVAL_MS
client/src/features/exam/lib/countdown.ts: FIVE_MINUTES_MS, ONE_MINUTE_MS
client/src/features/exam/lib/module-summary.ts: isAnswered
client/src/features/exam/lib/passage.ts: normalizeHighlights, snapRange
client/src/features/exam/lib/tests-home-model.ts: EXAM_IN_PROGRESS_STATES, inProgressLine
client/src/features/exam/pages/GuardianExamResultsPage.tsx: GuardianReportBody
client/src/hooks/tutor-client.ts: tutorConversationQueryKey, tutorConversationsQueryKey
client/src/hooks/use-toast.ts: reducer
client/src/hooks/useBillingPortal.ts: portalErrorMessage
client/src/hooks/useBillingStatusQuery.ts: BILLING_STATUS_PATH, BILLING_STATUS_QUERY_KEY, fetchBillingStatus, billingStatusQuery
client/src/hooks/useCanonicalPractice.ts: normalizeAssetItem, normalizeAssets
client/src/hooks/useProfileQuery.ts: PROFILE_PATH, fetchProfile
client/src/hooks/useProgressKpis.ts: PROGRESS_KPIS_QUERY_KEY, useProgressKpis
client/src/hooks/useReview.ts: REVIEW_POOL_QUERY_KEY, REVIEW_OPEN_SESSIONS_QUERY_KEY, reviewPoolPath, dropClosedSessions
client/src/hooks/useTutorTurn.ts: CLIENT_TIMEOUT_MS
client/src/lib/analytics/consent.ts: browserSendsGpc
client/src/lib/analytics/posthog-client.ts: analyticsConfigured
client/src/lib/analytics/url-scrub.ts: REDACTED, scrubString, scrubUrl
client/src/lib/api-error.ts: getPremiumDenialReason, isCsrfError, isTransportError
client/src/lib/blog.ts: getPostsByTag, getPostsByCategory, getAllTags
client/src/lib/client-instance.ts: resetClientInstanceId
client/src/lib/legal-content.ts: LegalNotFoundError, parseSections, loadLegalManifest, loadLegalDocument, loadLegalSlugs, loadLegalIndex
client/src/lib/link-code-prefill.ts: LINK_CODE_QUERY_PARAM
client/src/lib/notificationsApi.ts: NOTIFICATIONS_PAGE_LIMIT
client/src/lib/practice-filters.ts: parseDifficultiesFromSearch, parseDomainsFromSearch, appendPracticeFilters
client/src/lib/qotd.ts: QOTD_API, fetchQotdToday, fetchQotdArchiveDay, fetchQotdArchiveIndex
client/src/lib/queryClient.ts: getQueryFn, navigation, redirectForOnboarding
client/src/lib/route-shells.ts: NOT_FOUND_ROUTE, SHELL_EXCLUDED_ROUTES
client/src/lib/settings-api.ts: PROFILE_NAME_PATH, CHANGE_PASSWORD_PATH
client/src/lib/support-contact.ts: PRIVACY_EMAIL
client/src/lib/theme.ts: THEME_STORAGE_KEY, isThemePreference
packages/shared/src/billing-pricing.ts: monthsInInterval
packages/shared/src/event-registry-schema.ts: EVENT_REDACTION_METHODS, eventRedactionMethodSchema, canonicalEventClassSchema, registryPersonPropertySchema, jsonSchemaPropertyKeys
packages/shared/src/exam-domain-segments.ts: segmentsFilled
packages/shared/src/exam-guardian-report-schema.ts: guardianExamListItemSchema
packages/shared/src/exam-report-schema.ts: examIncompletenessReasonSchema, examFormSectionSummarySchema, examFormLatestSessionSchema, examFormSummarySchema
packages/shared/src/exam-student-report-schema.ts: examStudentReportScoredSchema, examStudentReportPartialSchema
packages/shared/src/profile-role-choice-schema.ts: ROLE_CHOICE_ERROR_CODES
packages/shared/src/qotd-schema.ts: QOTD_MIN_ATTEMPTS_FOR_STAT, qotdOptionKeySchema, qotdOptionTokenSchema, qotdServedOptionSchema, qotdPreSubmitQuestionSchema, qotdArchiveQuestionSchema
packages/shared/src/services/rate-limit-ledger.ts: softWarningThresholdPct, windowFor, bucketFamily, getUsage
packages/shared/src/support-contact.ts: PRIVACY_EMAIL
server/lib/account-deletion-execute.ts: buildDeletedEmail, anonymizeAccount
server/lib/account-deletion-runtime-config.ts: DELETION_GRACE_DAYS_KEY
server/lib/account.ts: getGuardianLinkForStudent, getPracticeDailyFreeQuota, getDailyUsage, incrementUsage, checkUsageLimit, getLinkedGuardianForStudent, FREE_TIER_LIMITS
server/lib/analytics/emit-event.ts: EVENT_REGISTRY, emitEventWith
server/lib/auth-runtime-config.ts: STUDENT_LINK_CODE_TTL_KEY
server/lib/baseline-pending.ts: BASELINE_PENDING_STALE_SECONDS, selectStaleBaselinePending
server/lib/client-ip.ts: PUBLIC_API_PREFIX, isPublicApiRequest
server/lib/entitlement-runtime-config.ts: EXAM_RENEWAL_CONFIG_KEYS, EXAM_RENEWAL_CONFIG_DEFAULTS
server/lib/legal-registry.ts: __resetLegalRegistryForTests
server/lib/notifications/direct-sends.ts: ACCOUNT_DELETION_SCHEDULED_IDEMPOTENCY_PREFIX, GUARDIAN_LINK_INVITE_IDEMPOTENCY_PREFIX, ACCOUNT_DELETION_COMPLETED_IDEMPOTENCY_PREFIX, guardianLinkInviteIdempotencyKey
server/lib/notifications/transport.ts: RESEND_API_BASE_URL, createResendTransport, resendSuppressionSchema, normaliseAddress, createResendSuppressionTransport
server/lib/password-credentials.ts: RECOVERY_GRANT_TTL_SECONDS, setPasswordAuthClientsForTests, PASSWORD_RESET_BUCKET, PASSWORD_RESET_RESPONSE_FLOOR_MS, setPasswordResetResponseFloorForTests
server/lib/practice-quota.ts: UNLIMITED_PRACTICE_DECISION_CODES
server/lib/role-choice.ts: LEARNING_STATE_ROOTS, MAX_PLAUSIBLE_AGE_YEARS
server/lib/startup-guards.ts: __resetGcpStartupReportForTests
server/lib/stripe/client.ts: getStripeMode
server/lib/stripe/country-denial-remediation.ts: TERMINAL_SUBSCRIPTION_STATUSES
server/lib/stripe/dispute.ts: disputeStatusSchema, CLOSED_DISPOSITION
server/lib/stripe/event-surface.ts: SUBSCRIBED_EVENTS, EVENT_DISPOSITION
server/lib/stripe/guardian-subscriptions.ts: GUARDIAN_SUBSCRIPTION_PAGE_SIZE, GUARDIAN_SUBSCRIPTION_MAX_PAGES, FUNDING_SUBSCRIPTION_STATUSES
server/lib/stripe/purchase-idempotency.ts: PURCHASE_IDEMPOTENCY_WINDOW_MS
server/lib/stripe/redact.ts: classifyError
server/lib/stripe/refund.ts: REVOKING_REFUND_STATUS
server/lib/stripe/webhook-handler.ts: StripePayloadShapeError, UnresolvableSubjectError
server/lib/student-link-code.ts: generateStudentLinkCode
server/lib/supabase-ssr.ts: cookieDomainForHost
server/lib/support-contact.ts: PRIVACY_EMAIL
server/lib/turnstile.ts: TURNSTILE_SITEVERIFY_URL, TURNSTILE_TEST_SECRET_ALWAYS_PASSES
server/lib/tutor-orchestrator-client.ts: _resetOidcClientCache
server/logger.ts: containsSecretContent, redactSensitive, createLoggingContext
server/middleware/api-cache-control.ts: API_CACHE_CONTROL_DEFAULT, API_CACHEABLE_ROUTES
server/middleware/csrf-double-submit.ts: csrfCookieName
server/middleware/final-error-handler.ts: isCsrfError, CSRF_BLOCKED
server/middleware/origin-utils.ts: resolveOriginEnvironment
server/middleware/security-headers.ts: THEME_BOOT_SCRIPT_HASH, buildCspDirectives, serializeCsp
server/middleware/supabase-auth.ts: sendUnauthenticated, setDeletionStatusResolverForTests
server/routes/account-deletion-routes.ts: buildDeletedEmail, DELETION_GRACE_DAYS, isGraceWindowExpired, scheduledHardDeleteAt, buildDeletionRequestInsert, hashRecoveryToken, generateRecoveryToken, recoverDeletionSchema, revokeSessionsAtDeletionRequest, performRecovery, performInAppCancel, performDeletionRequestV2
server/routes/calendar-routes.ts: CALENDAR_FEATURE_KEY, CALENDAR_PLAN_REGENERATE_BUCKET, CALENDAR_DAY_REGENERATE_BUCKET
server/routes/internal-memory-routes.ts: compactionTaskSchema
server/routes/notifications.ts: encodeFeedCursor, decodeFeedCursor
server/routes/oauth-callback-routes.ts: classifyProviderError, classifyNoCredential, classifyOtpFailure
server/routes/practice-canonical.ts: filterAssetsPreSubmit, captureDiagnosticBaseline, submitPracticeAnswer
server/routes/practice-topics-routes.ts: default
server/routes/public-pricing-routes.ts: __resetPublicPricingMemoForTests
server/routes/resend-webhook.ts: processResendWebhook
server/routes/review-canonical.ts: submitReviewAnswer, submitReviewSkip, reviewCanonicalRouter, REVIEW_COMPONENT
server/routes/score-report-routes.ts: default
server/routes/student-background-routes.ts: REFERENCE_SEARCH_BUCKET
server/routes/student-resources.ts: requiresEntitlement
server/services/activity-streak.ts: resolveStudentTimeZone
server/services/calendar/adapters/index.ts: adapterForBlock, ADAPTERS, localDayWindowUtc, isKnownTimeZone, localTodayIn
server/services/calendar/adapters/types.ts: ENGINE_FAILURE_REASONS
server/services/calendar/config.ts: CALENDAR_CONFIG_KEYS, CalendarConfigError
server/services/calendar/exam-notify-job.ts: EXAM_NOTIFY_JOB, EXAM_NOTIFY_OUTCOMES
server/services/calendar/launch-deps.ts: engineOfBlock
server/services/calendar/launch-service.ts: launchIdempotencyKey
server/services/calendar/profile-service.ts: localTodayForProfile
server/services/calendar/read-service.ts: FALLBACK_TIMEZONE
server/services/calendar/weekly-job.ts: WEEKLY_JOB, JOB_OUTCOMES, weeklyIdempotencyKey
server/services/canonical-runtime-views.ts: CANONICAL_RUNTIME_VIEW_VERSION
server/services/cloud-tasks-enqueue.ts: CLOUD_TASKS_LOCATION
server/services/crisis-resources.ts: UNKNOWN_COUNTRY_CRISIS_RESPONSE, UNKNOWN_COUNTRY_SAFEGUARDING_RESPONSE
server/services/email-reconsent-audit.ts: EMAIL_RECONSENT_ACTION
server/services/exam-report-service.ts: reportStateOf, resumeActionFor, serializeStudentReport
server/services/exam-runtime-service.ts: toExamQuestionPayload
server/services/exam-score-renewal/job.ts: EXAM_SCORE_RENEWAL_JOB, EXAM_SCORE_RENEWAL_OUTCOMES, noticesFor
server/services/kpi-access.ts: resolvePaidKpiAccessForStudent
server/services/qotd/qotd-service.ts: QOTD_TIME_ZONE, qotdTokenMapFor, qotdCorrectOptionId
server/services/qotd/schedule-job.ts: QOTD_ROTATION_EPOCH, QOTD_DAYS_AHEAD, rotationFor
server/services/retention-sweep.ts: retentionCutoff, sweep7d, sweep90d, sweep180d, sweep365d, SWEEP_COMPLETED_ACTION
server/services/review-pool.ts: resolveTimeZone, localParts, compareSourceSessions, encodeSourceSessionsCursor, pageSourceSessions
server/services/student-background.ts: StudentBackgroundReadError
server/services/subject-access-audit.ts: SUBJECT_ACCESS_ACTION
server/services/tutor-antileak.ts: TUTOR_ANTI_LEAK_SUBSTITUTION, hasAnswerLeak
server/services/tutor-compaction.ts: chatCompactionContentSchema
server/services/tutor-context.ts: detectsSelfDeprecatingLanguage, resolveScope, resolveQuestionContent, resolveLearningContext, snapshotCarriesMastery, hasAnswerLeak
server/services/tutor-crisis.ts: UNKNOWN_COUNTRY_CRISIS_RESPONSE, UNKNOWN_COUNTRY_SAFEGUARDING_RESPONSE, resolveCrisisCountry, normalizeCrisisText, checkCrisisSignatures, classifyCrisis
server/services/tutor-display-letters.ts: DISPLAY_LETTERS
server/services/tutor-error-codes.ts: TUTOR_UNAUTHENTICATED, TUTOR_TOKEN_EXPIRED, TUTOR_ROLE_NOT_PERMITTED, TUTOR_ENTITLEMENT_REQUIRED, TUTOR_AGE_RESTRICTED, TUTOR_REGION_NOT_SUPPORTED, TUTOR_UNAVAILABLE_DURING_LIVE_EXAM, TUTOR_ACCOUNT_UNDER_REVIEW, TUTOR_INVALID_INPUT, TUTOR_PII_IN_ENVELOPE, TUTOR_RATE_LIMITED, TUTOR_QUOTA_EXCEEDED, TUTOR_CONVERSATION_NOT_FOUND, TUTOR_CONVERSATION_CLOSED, TUTOR_CONVERSATION_ALREADY_CLOSED, TUTOR_CONVERSATION_ALREADY_ENDED, TUTOR_CONVERSATION_CRISIS_PAUSED, TUTOR_CONVERSATION_NOT_PAUSED, TUTOR_IDEMPOTENCY_CONFLICT, TUTOR_IDEMPOTENCY_IN_PROGRESS, TUTOR_IDEMPOTENCY_LOOKUP_FAILED, TUTOR_CANONICAL_WRITE_FAILED, TUTOR_ORCHESTRATION_AUTH_FAILED, TUTOR_ORCHESTRATION_FAILED, TUTOR_ORCHESTRATION_FAILED_RECOVERABLE, TUTOR_ENTITLEMENT_CHECK_UNAVAILABLE, TUTOR_ERROR_CODES, sendTutorResultError
server/services/tutor-injection-defense.ts: wrapWithBoundaryMarkers
server/services/tutor-memory.ts: accumulateObservation
server/services/tutor-model-armor.ts: MODEL_ARMOR_LOCATION, MODEL_ARMOR_ENDPOINT, MODEL_ARMOR_TIMEOUT_MS, sanitizeResponseSchema, evaluateSanitization, modelArmorSanitizeUrl
server/services/tutor-output-serializer.ts: TUTOR_ANTI_LEAK_SUBSTITUTION
shared/legal-consent.ts: REQUIRED_SIGNUP_LEGAL_DOCS, CONSENT_SOURCES
shared/practice/letter-reference.ts: EXPLANATION_LETTER_REFERENCE
shared/qotd/projection.ts: qotdServedOptions
shared/question-bank-contract.ts: CANONICAL_ID_PATTERN, MC_OPTION_KEYS, QUESTION_LIFECYCLE, LEGACY_QUESTION_LIFECYCLE, CANONICAL_DOMAINS, DOMAIN_LOOKUP, normalizeLifecycleStatus, isPublishedLifecycleStatus, hasSingleCanonicalCorrectAnswer, isCanonicalRuntimeMcQuestion, hasCanonicalGridInVariantSet, isCanonicalRuntimeGridInQuestion, buildStudentSafeOptionTokens, CANONICAL_ID_SUFFIX_LENGTH, generateCanonicalIdSuffix, buildCanonicalId, normalizeSourceType, validateQuestionForPublish
shared/section-display.ts: SECTION_LABEL_MATH, SECTION_LABEL_RW, isRwSection, sectionCodeFromLabel, sectionDisplayLabelOr
shared/seo/banned-phrases.ts: BANNED
shared/seo/public-meta.ts: NOT_FOUND_META, LEGAL_META, PUBLIC_META, qotdArchiveMeta, resolvePublicMeta, getPublicMeta
shared/seo/structured-data.ts: LOGO_URL
shared/tutor-safety-constants.ts: STRUCTURAL_PREFIXES, ASSERTION_PATTERNS, POST_VALUE_ASSERTION_PATTERNS, GENERIC_LEAK_PATTERNS, fractionToDecimal, buildMcqPatterns, positionalReferenceSource, buildMcqPositionalPatterns, hasGridInValueInText, answerValueAppearsIn, CANONICAL_ID_SCAN_PATTERN, SYSTEM_PROMPT_LEAK_PATTERNS, PERSONA_VIOLATION_PATTERNS, INTERNAL_METADATA_PATTERNS
Unused exported types (164)
client/src/components/MathRenderer.tsx: MathContentToken
client/src/components/auth/PasswordField.tsx: PasswordFieldProps
client/src/components/billing/PremiumUpgradePrompt.tsx: PremiumUpgradePromptProps
client/src/components/common/empty-state.tsx: EmptyStateProps
client/src/components/layout/FocusShell.tsx: FocusShellProps
client/src/components/layout/HeaderUserMenu.tsx: HeaderSignOut, HeaderMenuTone
client/src/components/layout/app-shell.tsx: RailItem, AppShellProps
client/src/components/mastery/LevelPill.tsx: LevelPillSize
client/src/components/mastery/MasteryRow.tsx: MasteryRowVariant
client/src/components/practice/NumericEntryInput.tsx: NumericEntryInputProps
client/src/components/practice/RunnerStateCard.tsx: RunnerStateCardProps
client/src/components/question-renderer.tsx: QuestionRendererProps
client/src/components/settings/BillingSection.tsx: BillingView
client/src/components/student-ui/FullPageLoader.tsx: FullPageLoaderProps
client/src/components/student-ui/Modal.tsx: ModalProps
client/src/components/student-ui/Notice.tsx: NoticeTone, NoticeProps
client/src/components/student-ui/PageHeader.tsx: PageHeaderProps
client/src/components/student-ui/Sheet.tsx: SheetProps
client/src/components/student-ui/filter-bar/FilterBar.tsx: FilterBarProps
client/src/components/student-ui/filter-bar/filter-cascade.ts: FilterChip
client/src/components/student-ui/index.ts: PageHeaderProps, FullPageLoaderProps, ModalProps, SheetProps, NoticeProps, NoticeTone, FilterBarProps
client/src/components/tutor/TutorThreadParts.tsx: ThreadInset
client/src/components/ui/badge.tsx: BadgeProps
client/src/components/ui/button.tsx: ButtonProps
client/src/components/ui/input.tsx: InputVariant
client/src/components/ui/skeleton.tsx: SkeletonProps
client/src/components/ui/tabs.tsx: TabsVariant
client/src/contexts/SupabaseAuthContext.tsx: SignupOutcome, SignupResult, SignupLegalConsent
client/src/features/calendar/CalendarView.tsx: CalendarMutations, CalendarViewProps
client/src/features/calendar/api/client.ts: DayMembers
client/src/features/calendar/api/index.ts: DayScopedVariables, DoItNowVariables, EditDayVariables, Intent, LaunchVariables, MoveBlockVariables, RegenerateVariables, LaunchOutcome
client/src/features/calendar/api/launch.ts: LaunchOutcome
client/src/features/calendar/api/mutations.ts: Intent, EditDayVariables, MoveBlockVariables, RegenerateVariables, DayScopedVariables, DoItNowVariables, LaunchVariables
client/src/features/calendar/components/BlockCard.tsx: BlockCardProps
client/src/features/calendar/components/BlockSheet.tsx: BlockSheetProps
client/src/features/calendar/components/CreateBlockSheet.tsx: CreateBlockSheetProps
client/src/features/calendar/components/DayStrip.tsx: DayStripProps
client/src/features/calendar/components/MonthGrid.tsx: MonthGridProps
client/src/features/calendar/components/SettingsSheet.tsx: SettingsSheetProps
client/src/features/calendar/components/StudentChrome.tsx: RegenerateControl
client/src/features/calendar/components/WeekGrid.tsx: WeekGridProps
client/src/features/exam/api/exam-api.ts: ExamItemsResponse, ExamStartModuleResponse, ExamSubmitModuleResponse
client/src/features/exam/hooks/useExamClock.ts: ExamClock
client/src/features/exam/hooks/useWriteQueue.ts: WriteQueue
client/src/features/exam/lib/exam-position.ts: ExamPosition, ModuleRoute
client/src/features/exam/lib/passage.ts: PassageSegment, HighlightEdit
client/src/hooks/tutor-client.ts: TutorEntryMode, TutorConversationStatus, TutorConversationSurface, TutorMessageRole, TutorResolvedScope, CreateConversationInput, TutorConversation, SendMessageInput, TutorConversationsList, EndConversationResponse, ResumeConversationResponse
client/src/hooks/useBillingPortal.ts: UseBillingPortalResult
client/src/hooks/useCanonicalPractice.ts: PracticeOption, PreSubmitAssetRole, PracticeAssetSvg, PracticeAssetTable, PracticeAssetItem, PracticeAssets, PracticeQuestion, PracticeNextResponse, PracticeAnswerResponse, PracticeSkipResponse, PracticeSessionSpecInput
client/src/hooks/useDiagnosticStart.ts: DiagnosticStartResult, DiagnosticStartError
client/src/hooks/useKeyboardShortcuts.ts: ShortcutKey, KeyBinding, Keymap, KeyboardShortcutOptions, RunnerKeymapInput, ExamModuleKeymapInput, LisaComposerKeymapInput, EscapeKeymapOptions
client/src/hooks/usePractice.ts: PracticeSessionStart
client/src/hooks/useReview.ts: ReviewStartResult
client/src/hooks/useTutorTurn.ts: TurnState, TutorTurn
client/src/lib/account-deletion-errors.ts: DeletionErrorCopy
client/src/lib/analytics/consent.ts: ConsentState
client/src/lib/api-error.ts: ApiError, PremiumDenialReason, UserFacingErrorMessage
client/src/lib/billing-client.ts: BillingCheckoutOutcome
client/src/lib/billing-cta.ts: BillingCtaDestination, BillingCtaAction, BillingCtaCopy
client/src/lib/blog.ts: BlogPost
client/src/lib/cta-click.ts: CtaClickHandlers
client/src/lib/legal-content.ts: LegalManifest, LegalSection, LegalDocumentContent
client/src/lib/masteryApi.ts: MasteryLevelKey, MasteryDomainsResponse, MasterySkillsResponse
client/src/lib/practice-filters.ts: PracticeFilters
client/src/lib/practice-topic-taxonomy.ts: PracticeTopicDomain
client/src/lib/projectionApi.ts: ConfidenceBand, ScoreEstimate, BaselineEstimate, EstimateStatus, EstimateResponse
client/src/lib/query-freshness.ts: QueryFreshnessKind
client/src/lib/route-shells.ts: ShellKind, ShellExclusionReason
client/src/lib/theme.ts: ResolvedTheme, SaveResult
packages/shared/src/analytics-consent-schema.ts: CookieConsentRecord
packages/shared/src/billing-pricing.ts: BillingPlanPricing
packages/shared/src/csrf-token-schema.ts: CsrfTokenResponse
packages/shared/src/event-registry-schema.ts: EventRedactionMethod
packages/shared/src/exam-domain-segments.ts: DomainCountRow, StudentDomainSegments
packages/shared/src/exam-report-schema.ts: ReportStateInputs
packages/shared/src/exam-scored-sessions-schema.ts: ExamScoredSessionsQuery
packages/shared/src/practice-schema.ts: QuestionsRow, PracticeSessionRow
packages/shared/src/profile-name-schema.ts: ProfileNameUpdateRequest
packages/shared/src/qotd-schema.ts: QotdServedOption, QotdPreSubmitQuestion, QotdArchiveQuestion
packages/shared/src/retention-schema.ts: RetentionSweepRow
packages/shared/src/review-table-schema.ts: ReviewSessionRow, ReviewScheduleRow
packages/shared/src/services/rate-limit-ledger.ts: BucketDefinition, LedgerSubject
server/lib/account.ts: GuardianLink, PairPremiumSource, LinkedPairPremiumAccess
server/lib/analytics/emit-event.ts: EmitRefusal, EmitResult, EmitDeps, EmitOptions
server/lib/baseline-pending.ts: BaselinePendingRow, BaselinePendingReport
server/lib/entitlement-display.ts: EntitlementDisplay, EntitlementDisplayInput
server/lib/entitlement-runtime-config.ts: ExamRenewalConfig
server/lib/gcp-credentials.ts: GcpServiceAccount, GcpAccessTokenResult
server/lib/legal-acceptance.ts: LegalAcceptanceRecord, LegalCaptureResult
server/lib/legal-registry.ts: ResolvedLegalVersion
server/lib/notifications/direct-sends.ts: DirectSendResult
server/lib/notifications/dispatch.ts: DispatchSummary, DispatchOptions
server/lib/notifications/retention.ts: NotificationRetentionSweepSummary
server/lib/notifications/svix.ts: SvixFailure, SvixVerification
server/lib/notifications/templates/index.ts: EmailRender, InAppRender, RenderContext
server/lib/notifications/transport.ts: SuppressionFailure, SuppressionLogContext, SuppressionTransport
server/lib/password-credentials.ts: PasswordAuthClients, PasswordChangeFailure, PasswordResetDecision
server/lib/redact.ts: ErrorClass
server/lib/retention/sweeps.ts: RetentionSweepSummary
server/lib/review-stale-session-sweep.ts: ReviewSessionSweepResult
server/lib/role-choice.ts: SelfAssignableRole, RoleChoiceDecision
server/lib/session-revoke.ts: SessionRevokeAdmin, SessionRevokeLog
server/lib/stale-session-sweep.ts: StaleSessionSweepResult
server/lib/startup-guards.ts: SiteUrlVerdict
server/lib/stripe/client.ts: StripeMode
server/lib/stripe/country-denial-remediation.ts: RemediationPlan, CancellationStep, RefundStep
server/lib/stripe/country-eligibility.ts: CountryEligibility
server/lib/stripe/dispute.ts: DisputeStatus, ClosedDisposition, DisputeEvent
server/lib/stripe/event-surface.ts: SubscribedEvent, EventDisposition
server/lib/stripe/guardian-checkout.ts: GuardianPurchaseSubject, GuardianPurchaseRefusal
server/lib/stripe/guardian-subscriptions.ts: GuardianSubscriptionScan
server/lib/stripe/purchase-eligibility.ts: PurchaseEligibility
server/lib/stripe/redact.ts: ErrorClass
server/lib/stripe/refund.ts: RefundEvent, RefundDecision
server/lib/stripe/renewal-cancellation.ts: RenewalCancellationOutcome
server/lib/stripe/subscription-item.ts: ResolvedEntitlementItem
server/lib/stripe/webhook-handler.ts: WebhookOutcome
server/lib/student-link-code.ts: RedeemOutcome, LiveCodeOwner
server/lib/turnstile.ts: TurnstileResult
server/lib/tutor-orchestrator-client.ts: OrchestrateResult, CompactResult
server/lib/validation-log.ts: RejectedRequestContext
server/logger.ts: LogEntry, PerformanceMetrics, LogContext
server/middleware/supabase-auth.ts: TokenResolutionResult, DeletionStatusState, DeletionStatusResult, DeletionStatusResolver
server/routes/oauth-callback-routes.ts: CallbackFailureCode
server/routes/practice-canonical.ts: GradeResult, SessionItemRow, PracticeConfig, QuestionSnapshotRow
server/routes/resend-webhook.ts: ResendWebhookOutcome
server/services/calendar/adapters/local-day.ts: LocalDayWindow
server/services/calendar/adapters/types.ts: EngineFailureReason
server/services/calendar/config.ts: CalendarConfigKey
server/services/calendar/exam-notify-job.ts: ExamNotifyOutcome, ExamNotifySummary
server/services/calendar/launch-service.ts: LaunchRequest, LaunchSuccess, LaunchResult
server/services/calendar/plan-service.ts: PlanInitiator, HorizonTrigger, RegenerateRequest, DayRegenerateRequest, DayEditRequest, DoItNowRequest, MoveBlockRequest
server/services/calendar/profile-service.ts: ProfileUpsertOutcome
server/services/calendar/read-service.ts: CalendarReadResult, GuardianReadResult, CalendarReadRequest
server/services/calendar/weekly-job.ts: JobOutcome, WeeklyJobSummary
server/services/canonical-runtime-views.ts: KpiExplanation, ExplainedKpiMetric, StudentKpiView, ScoreEstimate, CanonicalScoreEstimate, BaselineEstimate
server/services/cloud-tasks-enqueue.ts: CloudTasksAccess, CloudTaskPayload
server/services/crisis-notification.ts: CrisisNotificationPayload, BreachedCaseSummary
server/services/crisis-resources.ts: CrisisCountryResolution
server/services/crisis-review-queue.ts: CrisisSource, CrisisCategory, CaseStatus, CaseDisposition, AuditAction, UpdateDispositionParams, AuditLogParams
server/services/entitlement-service.ts: EntitlementActiveResult
server/services/exam-report-service.ts: ExamReportSource, ExamReportRead, ExamScoredSessionsRead
server/services/exam-score-renewal/job.ts: ExamScoreRenewalOutcome, ExamScoreRenewalSummary
server/services/kpi-access.ts: KpiEntitlementAccess
server/services/qotd/qotd-service.ts: QotdRow
server/services/qotd/schedule-job.ts: QotdDayOutcome, QotdScheduleSummary
server/services/retention-sweep.ts: SweepTableCount, SweepResult, SweepOpts, TierHandler
server/services/review-pool.ts: ReviewPoolResult
server/services/student-background.ts: StudentBackgroundFailure
server/services/tutor-compaction.ts: ChatCompactionContent
server/services/tutor-context.ts: SessionTables, ResolvedScope, EnvelopeParams
server/services/tutor-crisis.ts: NotificationPolicyInput, NotificationPolicyResult, CrisisResult, CrisisCategory, CrisisCountryResolution
server/services/tutor-display-letters.ts: DisplayOption, DisplayOrder
server/services/tutor-memory-refresh.ts: MemoryRefreshParams, MemoryRefreshResult
server/services/tutor-model-armor.ts: ModelArmorScanPoint, ModelArmorSkipReason, ModelArmorVerdict, SanitizationEvaluation
server/services/tutor-output-serializer.ts: SerializedOutput
server/services/tutor-pending-reconciliation.ts: PendingReconciliationResult
server/services/tutor-policy-logger.ts: ContextResolutionLog, TurnMetricsLog
server/services/tutor-runtime-writer.ts: InstructionAssignmentParams
shared/legal-consent.ts: LegalDocRef
shared/question-bank-contract.ts: CanonicalSourceType, QuestionLifecycle, StudentSafeQuestionProjection, ClientInstanceResolutionAction, ClientInstanceResolution, PublishValidationResult
shared/section-display.ts: SectionDisplayLabel
shared/seo/banned-phrases.ts: BannedPhrase
shared/seo/public-meta.ts: PublicMeta, LegalMeta, FaqItem
```

</details>
