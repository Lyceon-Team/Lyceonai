# Full-Length naming: grep proof

Owner ruling (Karl, 2026-10-05), verbatim: "Naming: every student-facing \"Tests\" label becomes
\"Full-Length\": page titles, headings, buttons, menu items, notification copy. The /tests route
stays. Grep proof that no student-facing \"Tests\" label remains."

Branch `claude/fu-mobile-fulllength`. Every command below was run from the repository root on the
branch's final tree; the output is pasted verbatim. Test files (`*.test.ts(x)`) are excluded from
every query: they assert copy, they do not show it.

## What changed

| Where | Before | After |
|---|---|---|
| `client/src/features/exam/pages/TestsHomePage.tsx` (page title, H1) | "Full-length practice tests" | "Full-Length" |
| `client/src/features/exam/components/ExamStatus.tsx` (exam load error's way out, a button) | "Back to tests" | "Back to Full-Length" |
| `client/src/features/exam/pages/ExamReportPage.tsx` (unscored attempt's report line) | "You can start a new attempt from Tests." | "You can start a new attempt from Full-Length." |
| Mobile avatar menu (`app-shell.tsx`, the rail item's own label) | Full-Length was a tab | "Full-Length" menu item |

Already "Full-Length" before this change and unchanged: the rail item and its accessible names
(`app-shell.tsx` `RAIL_ITEMS`), the Focus shell section name on every exam route
(`route-shells.ts`: `/tests/:sessionId`, the timed module, the report, `/score-report`). There
are no per-page document titles (`<title>` is the one in `client/index.html`, "Lyceon – Digital
SAT prep with tutor guidance").

Notification copy: no student notification uses "Tests" as a label (query 4). The two practice-test
notices say "a practice test" / "Your practice test", which names one sitting, not the section, so
they and `contracts/notifications.contract.md` (which pins channels and payloads, not copy) are
unchanged.

## Query 1: the word "Tests" (capitalised), everywhere, comments included

```
$ grep -rnw "Tests" client/src server packages/shared/src apps/api/src --include=*.ts --include=*.tsx \
  | grep -vE "\.test\.tsx?:"
client/src/features/exam/components/ExamStatus.tsx:10: * "Full-Length" (owner naming ruling, Karl, 2026-10-05: every student-facing "Tests" label
client/src/features/exam/pages/TestsHomePage.tsx:24: * 2026-10-05: every student-facing "Tests" label becomes "Full-Length"), like Practice and Review.
client/src/pages/digital-sat-reading-writing.tsx:119:                    What It Tests
client/src/test-support/runner.harness.tsx:8: * name and the Calculator / Reference buttons would not render at all. Tests render through this
server/middleware/security-headers.ts:85: * The policy as one header value, in helmet's serialization (`name value;name value`). Tests use
server/services/calendar/adapters/full-length.ts:255: * or the Module 2 hand-off — the same place the Tests page's "Resume" goes.
server/lib/password-credentials.ts:72:/** Tests substitute the transport (a GoTrue stand-in), never this module's logic. */
server/lib/password-credentials.ts:295:/** Tests shorten the floor; they never remove it. */
server/routes/supabase-auth-routes.ts:644: * CI hardening: Tests must verify this endpoint returns 404 (not 400/401/403/500).
```

| Hit | Class |
|---|---|
| `ExamStatus.tsx:10`, `TestsHomePage.tsx:24` | code comment quoting the ruling |
| `digital-sat-reading-writing.tsx:119` "What It Tests" | public marketing page, generic verb (what the SAT section tests), not the feature |
| `runner.harness.tsx:8`, `security-headers.ts:85`, `password-credentials.ts:72,295`, `supabase-auth-routes.ts:644` | code comments about automated tests |
| `calendar/adapters/full-length.ts:255` "the Tests page's \"Resume\"" | server code comment (not rendered) |

No student-facing "Tests" label remains.

## Query 2: "Test" (capitalised, singular) in non-comment code

```
$ grep -rnw "Test" client/src server packages/shared/src apps/api/src --include=*.ts --include=*.tsx \
  | grep -vE "\.test\.tsx?:" \
  | grep -vE "^\S+:[0-9]+:\s*(\*|//|/\*|\{/\*)"
client/src/components/settings/ProfileSection.tsx:188:              Test date
client/src/features/exam/test-fixtures/report-fixtures.ts:35:  test_form_name: "Practice Test 2",
client/src/features/exam/test-fixtures/report-fixtures.ts:188:      name: "Practice Test 2",
client/src/features/exam/test-fixtures/report-fixtures.ts:203:      name: "Practice Test 3",
client/src/features/exam/lib/labels.ts:51:  strict: "Test-day timing",
client/src/features/exam/lib/labels.ts:56:  strict: "Test-day",
client/src/features/exam/pages/TestsHomePage.tsx:627:            "Test-day timing",
client/src/features/exam/pages/GuardianExamResultsPage.tsx:374:          <Title name={report.test_form_name} line="Test submitted" />
client/src/features/exam/pages/GuardianExamResultsPage.tsx:386:          <Title name={report.test_form_name} line="Test submitted" />
client/src/features/guardian/GuardianTemplatePreview.tsx:39:  "Test date",
client/src/features/calendar/components/WeekGrid.tsx:115:              aria-label="Test day"
client/src/features/calendar/components/FreeCalendar.tsx:188:            Test date
client/src/features/calendar/components/FreeCalendar.tsx:253:          label="Test date"
client/src/features/calendar/components/MonthGrid.tsx:129:              aria-label="Test day"
server/scripts/cleanup-question-stems.ts:85:    .or("stem.ilike.%Question ID%,stem.ilike.%Assessment%,stem.ilike.%Test Domain%,stem.ilike.%Skill%,stem.ilike.%thexy-plane%,stem.ilike.%inches?4 9%,stem.ilike.%defined byof%,stem.ilike.%value oft%,stem.ilike.%linep%,stem.ilike.%at circle?%")
packages/shared/src/__fixtures__/linked-student.ts:56:        ? "Test Student"
apps/api/src/lib/supabase-server.ts:31:      console.log('[SUPABASE-HTTP] Test mode: using placeholder client');
apps/api/src/lib/supabase.ts:16:        console.log('[SUPABASE] Test mode: using placeholder client');
```

| Hit | Class |
|---|---|
| `ProfileSection.tsx:188`, `FreeCalendar.tsx:188,253` "Test date"; `WeekGrid.tsx:115`, `MonthGrid.tsx:129` "Test day" | generic: the student's SAT date |
| `labels.ts:51,56`, `TestsHomePage.tsx:627` "Test-day timing" / "Test-day" | generic: the timing mode named after the real test day |
| `report-fixtures.ts:35,188,203` "Practice Test 2/3" | test fixture data (a form's name; form names come from the database) |
| `GuardianExamResultsPage.tsx:374,386` "Test submitted"; `GuardianTemplatePreview.tsx:39` "Test date" | guardian-only |
| `cleanup-question-stems.ts:85`, `__fixtures__/linked-student.ts:56`, `supabase-server.ts:31`, `supabase.ts:16` | server script / fixture / log line, not student UI |

## Query 3: "tests" (lower case) in student copy

Route paths (`/tests`), test ids, element ids and identifiers (`GuardianExamList["tests"]`, the
`tests:` schema key, `STUDENT_EXAM_PATHS.tests`) are filtered out by the last `grep -vE`; every
line it removes is a path or an identifier.

```
$ grep -rnw "tests" client/src server/lib/notifications packages/shared/src --include=*.ts --include=*.tsx \
  | grep -vE "\.test\.tsx?:|__tests__" \
  | grep -vE "^\S+:[0-9]+:\s*(\*|//|/\*|\{/\*)" \
  | grep -vE "/tests|data-testid|\"tests-|tests-h|tests-mastery-h|tests-upgrade-h|tests-hist-h|\[\"tests\"\]|\.tests\b|\btests:|\"tests\"|const tests|of tests|\(tests\)"
client/src/components/settings/BillingSection.tsx:141:        full-length tests and LISA.
client/src/components/billing/upgrade-modal.ts:86:  title: "Full-length practice tests",
client/src/components/billing/upgrade-modal.ts:87:  body: "Timed tests with two modules per section that adapt to how you do, like the real SAT. You get a scored report after each one.",
client/src/components/home/FreeHome.tsx:75:    body: "A study calendar, mastery for every domain and skill, full-length tests and LISA, your tutor.",
client/src/features/exam/lib/phone-notice.ts:19:  "Full-length tests are built for a laptop or tablet, like test day.";
client/src/features/exam/pages/TestsHomePage.tsx:252:                  Your tests
client/src/features/exam/pages/TestsHomePage.tsx:259:                    title="We couldn't load the tests."
client/src/features/exam/pages/TestsHomePage.tsx:266:                    No full-length tests are available yet.
client/src/features/exam/pages/GuardianExamResultsPage.tsx:184:      <Title name="Practice test results" line="Full-length practice tests" />
client/src/features/calendar/components/FreeCalendar.tsx:335:        A week-by-week schedule of practice, review and full-length tests, built
client/src/features/calendar/copy/exam-cadence.ts:87:  if (day === undefined || weeks === null) return "no automatic practice tests";
client/src/features/calendar/copy/exam-cadence.ts:103:  const noun = count === 1 ? "practice test" : "practice tests";
client/src/lib/plan-copy.ts:26:  "Paid plans add your study calendar, mastery for every domain and skill, full-length practice tests and LISA, your tutor.";
client/src/pages/home.tsx:173:                    Build consistency with adaptive practice, full-length tests,
client/src/pages/digital-sat-math.tsx:107:          The Digital SAT Math section tests algebra, advanced math, data
packages/shared/src/exam-guardian-report-schema.ts:324:  return guardianExamListSchema.parse({ tests });
```

| Hit | Class |
|---|---|
| `phone-notice.ts:19` | the 2026-10-05 ruling's own sentence, verbatim |
| `TestsHomePage.tsx` "Your tests", "We couldn't load the tests.", "No full-length tests are available yet." | the test forms (instances) on the Full-Length page, not the section's name. **Listed for Karl**, see below |
| `upgrade-modal.ts:86` title "Full-length practice tests", `:87` body | the upgrade modal's approved copy (OQ-44; equal to the prototype's `LYC_COPY.full`, asserted by its test). A descriptive title, not the section label. **Listed for Karl** |
| `BillingSection.tsx:141`, `FreeHome.tsx:75`, `plan-copy.ts:26`, `FreeCalendar.tsx:335` "full-length (practice) tests" | descriptive prose naming what a plan includes, lower case. **Listed for Karl** |
| `exam-cadence.ts:87,103` "practice test(s)" | calendar cadence sentence: counts sittings |
| `GuardianExamResultsPage.tsx:184` | guardian-only |
| `home.tsx:173`, `digital-sat-math.tsx:107` | public marketing pages (SEO vertical), generic |
| `exam-guardian-report-schema.ts:324` | identifier |

## Query 4: notification templates

```
$ grep -rniE "\btests?\b" server/lib/notifications/templates \
  | grep -vE "^\S+:[0-9]+:\s*(\*|//|/\*)"
server/lib/notifications/templates/full-length.ts:90:    title: "You have a practice test this week",
server/lib/notifications/templates/full-length.ts:91:    body: `It's on ${renderNoticeDate(payload.local_date)}. A full test takes about three hours, so it helps to know now.`,
server/lib/notifications/templates/full-length.ts:101:    title: "Your practice test is tomorrow",
server/lib/notifications/templates/full-length.ts:130:    subject: "You have a practice test this week",
server/lib/notifications/templates/full-length.ts:132:      `You have a full-length practice test this week, on ${when}.`,
server/lib/notifications/templates/full-length.ts:134:      "A full test takes about three hours, so it helps to know now.",
server/lib/notifications/templates/full-length.ts:142:      `<p>You have a full-length practice test this week, on <strong>${safeWhen}</strong>.</p>`,
server/lib/notifications/templates/full-length.ts:143:      "<p>A full test takes about three hours, so it helps to know now.</p>",
server/lib/notifications/templates/full-length.ts:159:    subject: "Your practice test is tomorrow",
server/lib/notifications/templates/full-length.ts:161:      `Your full-length practice test is tomorrow, ${when}.`,
server/lib/notifications/templates/full-length.ts:171:      `<p>Your full-length practice test is tomorrow, <strong>${safeWhen}</strong>.</p>`,
```

Every hit is "practice test" / "full test" naming one scheduled sitting; none
is a "Tests" label.

## Left for Karl (ambiguous; not changed)

1. **"Your tests"** (the H2 over the list of forms on the Full-Length home, prototype copy) and the
   list's states "We couldn't load the tests." / "No full-length tests are available yet." They
   name the test forms, not the section. Change to e.g. "Your Full-Length tests"?
2. **The upgrade modal's Full-Length title "Full-length practice tests"** (approved OQ-44, equal to
   the prototype). The other modal titles are descriptive too ("Mastery by domain and skill"), so
   it was read as a description, not the section label.
3. **Plan prose** "full-length tests" / "full-length practice tests" (Free home, Billing, the plans
   copy, the free calendar). Lower-case description of what a plan includes.
4. **Single-sitting labels** "Practice test" (calendar legend and block kind, review-session
   source), "Full-length test" / "Full-length practice test" (calendar block, review picker), and
   the notifications "You have a practice test this week" / "Your practice test is tomorrow".
   Read as naming one sitting, which the brief allows.
