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

## 2026-10-05: 'full-length test' wording

Owner ruling (Karl, 2026-10-05) on OQ-62 (b), verbatim: "'full-length test' wording, with grep
proof."

Reading applied: one sitting is a **"full-length test"** wherever a student sees it (plural
"full-length tests"; "Full-length test" at the start of a label or sentence). It replaces
"practice test", a bare "test" / "exam" naming one of these sittings, "full test", a bare
"full-length" used as a noun, and "full-length practice test(s)". The section/page label stays
"Full-Length" (the earlier ruling, above). Generic words stay: test date, test day, "SAT test
day", "like test day", "test-ready", "Test-day timing" (the timing mode), "the SAT". Routes
(`/tests`), identifiers, DB values (form names such as "Practice Test 1") and API fields are
unchanged. Guardian-only copy is unchanged (out of scope; listed below).

Branch `claude/nav-fulllength-wording`. Every command was run from the repository root on the
branch's tree; output pasted verbatim. Test files are excluded: they assert copy, they do not
show it.

### What changed (old → new)

| Where (file:line) | Old | New |
|---|---|---|
| `client/src/features/exam/pages/TestsHomePage.tsx:252` (list H2) | Your tests | Your full-length tests |
| `TestsHomePage.tsx:259` (list load error) | We couldn't load the tests. | We couldn't load the full-length tests. |
| `TestsHomePage.tsx:266` (empty state) | No full-length tests are available yet. | unchanged (already compliant) |
| `TestsHomePage.tsx:538` (Start failure) | We couldn't start the test. … | We couldn't start the full-length test. … |
| `client/src/components/billing/upgrade-modal.ts:89` (Full-Length modal title; also the Full-Length home's age-locked card) | Full-length practice tests | Full-length tests |
| `upgrade-modal.ts:90` (modal body; also the free Full-Length home card) | Timed tests with two modules … | Timed full-length tests with two modules … |
| `client/src/lib/plan-copy.ts:27` (Help FAQ, Billing, `/upgrade`) | … full-length practice tests and LISA … | … full-length tests and LISA … |
| `client/src/components/home/home-model.ts:113` (Home plan row) | Full-length practice test | Full-length test |
| `client/src/features/exam/components/ExamStatus.tsx:18` | Loading your test… | Loading your full-length test… |
| `ExamStatus.tsx:43` | This test isn't available to your account. | This full-length test isn't available to your account. |
| `ExamStatus.tsx:45` | We couldn't find this test. | We couldn't find this full-length test. |
| `ExamStatus.tsx:46` | We couldn't load your test. … | We couldn't load your full-length test. … |
| `client/src/features/exam/pages/ExamReportPage.tsx:235` | … content domains on this test. | … content domains on this full-length test. |
| `ExamReportPage.tsx:360` | Scoring your test | Scoring your full-length test |
| `ExamReportPage.tsx:384` | This test isn't finished | This full-length test isn't finished |
| `ExamReportPage.tsx:405` (button) | Resume test | Resume full-length test |
| `client/src/features/exam/components/DomainSegments.tsx:48` | … because this test had no questions … | … because this full-length test had no questions … |
| `client/src/features/calendar/components/StudentChrome.tsx:485` (Show legend) | Practice test | Full-length test |
| `client/src/features/calendar/lib/blocks.ts:81` (tone label) | Practice test | Full-length test |
| `blocks.ts:93` (block title) | Full-length practice test | Full-length test |
| `client/src/features/calendar/components/MonthGrid.tsx:29` (month chip) | Practice test | Full-length test |
| `client/src/features/calendar/components/SetupPopup.tsx:496` / `:526` | Practice test day / Practice test frequency | Full-length test day / Full-length test frequency |
| `client/src/features/calendar/components/SettingsSheet.tsx:364` / `:388` | Practice test day / Practice test frequency | Full-length test day / Full-length test frequency |
| `client/src/features/calendar/copy/exam-cadence.ts:89` | no automatic practice tests | no automatic full-length tests |
| `exam-cadence.ts:103` | a practice test every N weeks, … | a full-length test every N weeks, … |
| `exam-cadence.ts:105` | about N practice test(s) before … | about N full-length test(s) before … |
| `client/src/features/calendar/copy/explanations.ts:48` | … on your last practice test. | … on your last full-length test. |
| `explanations.ts:50` | A full-length every two weeks keeps you test-ready. | A full-length test every two weeks keeps you test-ready. |
| `explanations.ts:55` | … on your last full-length. | … on your last full-length test. |
| `explanations.ts` (domain `post_exam`) | Your last test pointed here. | Your last full-length test pointed here. |
| `client/src/features/calendar/copy/banner.ts:27` | Your plan was updated after your practice test. | Your plan was updated after your full-length test. |
| `client/src/features/calendar/components/Chrome.tsx:584` (suppression, student) | We couldn't fit your practice test — … | We couldn't fit your full-length test — … |
| `client/src/features/calendar/components/FullLengthFields.tsx:69` | Which test? | Which full-length test? |
| `FullLengthFields.tsx:80` | Next unused test | Next unused full-length test |
| `FullLengthFields.tsx:88` | A test that is no longer offered | A full-length test that is no longer offered |
| `client/src/features/calendar/components/CreateBlockSheet.tsx:61` | A timed test, start to finish. | A timed full-length test, start to finish. |
| `client/src/lib/review-session-picker.ts:94` (review source label) | Practice test | Full-length test |
| `client/src/lib/tutor-error-classifier.ts:108` / `:110` (LISA during a live sitting) | LISA is paused during your exam / … finish your current exam. | LISA is paused during your full-length test / … finish your full-length test. |
| `server/lib/notifications/templates/full-length.ts:90,130` (week notice: in-app title, email subject) | You have a practice test this week | You have a full-length test this week |
| `full-length.ts:101,159` (tomorrow notice: in-app title, email subject) | Your practice test is tomorrow | Your full-length test is tomorrow |
| `full-length.ts:91,134,143` | A full test takes about three hours … | A full-length test takes about three hours … |
| `full-length.ts:132,142` (email text/html) | You have a full-length practice test this week, … | You have a full-length test this week, … |
| `full-length.ts:161,171` (email text/html) | Your full-length practice test is tomorrow, … | Your full-length test is tomorrow, … |

The upgrade modal's Full-Length title and body are OQ-44 approved prototype copy (`LYC_COPY.full`);
this ruling changes them. `UpgradeModal.test.tsx` still reads the prototype and now applies
exactly the two ruled changes to it (asserting the old phrases are in the prototype), so any other
drift still fails. Same for the Help FAQ's first answer. The prototype files are unchanged.

`contracts/notifications.contract.md` pins channels and payloads, not copy (its two "practice
test" mentions, lines 91 and 233, are prose), so it is unchanged; the rendered notice copy is now
pinned by `tests/ci/notifications.full-length-copy.test.ts`.

### Query A: "practice test(s)", case-insensitive, everywhere in app code, comments included

```
$ grep -rniE "practice tests?" client/src server packages/shared/src apps/api/src --include=*.ts --include=*.tsx \
  | grep -vE "\.test\.tsx?:"
client/src/components/billing/upgrade-modal.ts:84: * practice tests" became "Full-length tests" and the body's "Timed tests" became "Timed
client/src/components/practice/CanonicalPracticePage.tsx:87: * re-exported here, where the practice tests import them. ── */
client/src/features/exam/test-fixtures/report-fixtures.ts:35:  test_form_name: "Practice Test 2",
client/src/features/exam/test-fixtures/report-fixtures.ts:188:      name: "Practice Test 2",
client/src/features/exam/test-fixtures/report-fixtures.ts:203:      name: "Practice Test 3",
client/src/features/exam/pages/GuardianExamResultsPage.tsx:76: * longer draws its own header or its "Practice tests" link. `exam-root` scopes the exam
client/src/features/exam/pages/GuardianExamResultsPage.tsx:184:      <Title name="Practice test results" line="Full-length practice tests" />
client/src/features/exam/pages/GuardianExamResultsPage.tsx:401:          <Title name={report.test_form_name} line="Practice test" />
client/src/features/exam/pages/GuardianExamResultsPage.tsx:420:          <Title name={report.test_form_name} line="Practice test" />
client/src/features/exam/pages/ExamReportPage.tsx:23: * (FocusBarContext) names the report ("Practice Test 1 report") and its date. A scored report is
client/src/features/guardian/GuardianStates.tsx:240:      title={`${name} hasn't finished a full-length practice test yet`}
client/src/features/calendar/components/Chrome.tsx:63:  { tone: "exam", label: "Practice test", varName: "--exam" },
client/src/features/calendar/components/Chrome.tsx:550:// ── Suppressed practice test (Brief 14 Step 4) ──────────────────────────────
client/src/features/calendar/components/Chrome.tsx:553: * The sentence a plan says when the generator could NOT place a practice test.
client/src/features/calendar/components/Chrome.tsx:586:    "A practice test couldn't be scheduled — the days chosen are blocked.",
client/src/features/calendar/components/Chrome.tsx:658:        <b>{facts.full_lengths_completed}</b> practice test
client/src/features/calendar/CalendarView.tsx:202:   * generator refused to place a practice test on because both the chosen weekday occurrence
client/src/features/calendar/CalendarView.tsx:514:      {/* The suppressed practice test, on both surfaces. The handler is passed for a
client/src/features/calendar/lib/dates.ts:203: * ("about 5 practice tests before 5 December").
client/src/features/calendar/lib/blocks.ts:86: * sitting — §17.1's example reads "Full-length practice test"; owner ruling OQ-62 (b) (Karl,
client/src/features/calendar/copy/exam-cadence.ts:13: * before either shipped: one said "no automatic practice tests" and the other "no practice
client/src/features/calendar/copy/exam-cadence.ts:75: *   (wording: owner ruling OQ-62 (b), Karl, 2026-10-05 — "full-length test", was "practice test")
client/src/features/calendar/copy/explanations.ts:29: * sentence below that names one sitting says "full-length test" — the [P] "practice test" /
client/src/lib/review-session-picker.ts:87: * came from (wording: owner ruling OQ-62 (b), Karl, 2026-10-05, was "Practice test").
client/src/lib/review-session-picker.ts:125: * test — the form's name, "Practice Test 1" ("Full-length test" when the server sent
server/services/review-pool.ts:661: * form's name, so the picker can say "Practice Test 1". Nothing else from the exam
server/services/exam-score-renewal/job.ts:31: * `full_length` blocks are PRACTICE tests inside a study plan; this job is about the real sitting,
server/services/exam-score-renewal/job.ts:34: * student finished a practice test says nothing about whether they sat the SAT.
server/services/calendar/config.ts:76:   * target date — and now served to the client too, because §8.1's "about N practice tests"
server/services/calendar/exam-notify-job.ts:10: * plain English: a student with a practice test in their plan is told twice — on the Monday of
server/lib/notifications/templates/full-length.ts:11: * the recipient of these two events (contract §2.3): a practice test is the work, and Doc 01
server/routes/practice-canonical.ts:240:  // so existing practice tests keep passing. Doc 05P §10.1: 8 × 5 = 40.
server/routes/internal-cron-routes.ts:526: * practice test the replan then moves. Delivery does not depend on the dispatch sweep at `30 4`
packages/shared/src/notifications-schema.ts:106: * to say a practice test is coming. `.strict()` refuses it, and every other addition, at
packages/shared/src/calendar/api.ts:213: * The one formula constant a client needs to state a TRUTHFUL number of practice tests.
packages/shared/src/calendar/api.ts:215: * §8.1's frequency readout says "about 5 practice tests before 5 December". That count
packages/shared/src/calendar/api.ts:277:     * Dates where the student's own day edits displaced a practice test TWICE, so none was
packages/shared/src/calendar/api.ts:609:     * Dates where a practice test could not be placed because the days the student chose are
packages/shared/src/calendar/api.ts:615:     * practice test should know the reason is "the days your child picked are blocked" rather
packages/shared/src/calendar/profile.ts:65: * between full-length practice tests, as the student chose them.
packages/shared/src/calendar/profile.ts:325: * plain English: the number behind "about 5 practice tests before 5 December". Expected
packages/shared/src/calendar/profile.ts:342: * The caller renders "a practice test every 2 weeks" instead, because inventing a horizon
```

### Query B: whole-token "test" / "tests" in student copy (non-comment lines)

```
$ grep -rniw "tests\?" client/src server/lib/notifications packages/shared/src --include=*.ts --include=*.tsx \
  | grep -vE "\.test\.tsx?:|__tests__|test-fixtures|test-support|test-harness" \
  | grep -vE "^\S+:[0-9]+:\s*(\*|//|/\*|\{/\*)" \
  | grep -vE "data-testid|testId|/tests|\.test\(|data-test-day|\"tests-|\[\"tests\"\]|\btests:|\"tests\"|const tests|of tests|\(tests\)|\{ tests \}|response_schema_version|nodeEnvSchema|readonly test:|  test: \(" \
  | grep -vE "^client/src/pages/(digital-sat|home\.tsx|blog|sat-)"
client/src/components/layout/GuardianShell.tsx:151:              identically, and the shells test exists because they have drifted before. */}
client/src/components/settings/LinkSection.tsx:25:  "A guardian can see your progress: mastery, test scores, your study plan and your projected score. They never see your answers or your conversations with LISA.";
client/src/components/settings/AppearanceSection.tsx:93:        like test day.
client/src/components/settings/ProfileSection.tsx:188:              Test date
client/src/components/settings/ProfileSection.tsx:219:            Your study calendar uses the same test date and target, so changing
client/src/components/billing/upgrade-modal.ts:89:  title: "Full-length tests",
client/src/components/billing/upgrade-modal.ts:90:  body: "Timed full-length tests with two modules per section that adapt to how you do, like the real SAT. You get a scored report after each one.",
client/src/components/home/home-model.ts:113:    return { ...base, title: "Full-length test", detail: null };
client/src/components/home/FreeHome.tsx:75:    body: "A study calendar, mastery for every domain and skill, full-length tests and LISA, your tutor.",
client/src/features/exam/components/DomainSegments.tsx:48:  return `${domains.join(", ")} ${domains.length === 1 ? "isn't" : "aren't"} shown because this full-length test had no questions from ${domains.length === 1 ? "it" : "them"}.`;
client/src/features/exam/components/ExamStatus.tsx:18:  label = "Loading your full-length test…",
client/src/features/exam/components/ExamStatus.tsx:43:      ? "This full-length test isn't available to your account."
client/src/features/exam/components/ExamStatus.tsx:45:        ? "We couldn't find this full-length test."
client/src/features/exam/components/ExamStatus.tsx:46:        : "We couldn't load your full-length test. Check your connection and try again.";
client/src/features/exam/api/exam-api.ts:226:  ).tests;
client/src/features/exam/lib/phone-notice.ts:19:  "Full-length tests are built for a laptop or tablet, like test day.";
client/src/features/exam/lib/labels.ts:51:  strict: "Test-day timing",
client/src/features/exam/lib/labels.ts:56:  strict: "Test-day",
client/src/features/exam/pages/TestsHomePage.tsx:134:  "The calculator and reference sheet are built in, as on test day.",
client/src/features/exam/pages/TestsHomePage.tsx:224:        description="Timed like test day: two modules per section, a break between sections, and a scored report at the end."
client/src/features/exam/pages/TestsHomePage.tsx:252:                  Your full-length tests
client/src/features/exam/pages/TestsHomePage.tsx:259:                    title="We couldn't load the full-length tests."
client/src/features/exam/pages/TestsHomePage.tsx:266:                    No full-length tests are available yet.
client/src/features/exam/pages/TestsHomePage.tsx:538:        "We couldn't start the full-length test. Check your connection and try again.",
client/src/features/exam/pages/TestsHomePage.tsx:627:            "Test-day timing",
client/src/features/exam/pages/GuardianExamResultsPage.tsx:172:        what="test results"
client/src/features/exam/pages/GuardianExamResultsPage.tsx:184:      <Title name="Practice test results" line="Full-length practice tests" />
client/src/features/exam/pages/GuardianExamResultsPage.tsx:240:        what="test result"
client/src/features/exam/pages/GuardianExamResultsPage.tsx:374:          <Title name={report.test_form_name} line="Test submitted" />
client/src/features/exam/pages/GuardianExamResultsPage.tsx:377:              This test has been submitted and is being scored. Scores usually
client/src/features/exam/pages/GuardianExamResultsPage.tsx:386:          <Title name={report.test_form_name} line="Test submitted" />
client/src/features/exam/pages/GuardianExamResultsPage.tsx:401:          <Title name={report.test_form_name} line="Practice test" />
client/src/features/exam/pages/GuardianExamResultsPage.tsx:420:          <Title name={report.test_form_name} line="Practice test" />
client/src/features/exam/pages/ExamReportPage.tsx:235:          How you did across the eight content domains on this full-length test.
client/src/features/exam/pages/ExamReportPage.tsx:360:        <StatePanel title="Scoring your full-length test">
client/src/features/exam/pages/ExamReportPage.tsx:384:              ? "This full-length test isn't finished"
client/src/features/exam/pages/ExamReportPage.tsx:405:                Resume full-length test
client/src/features/exam/pages/ExamReportPage.tsx:441:          ? "Full-length test reports are part of an active subscription. Your results are kept, and you can see them again when your subscription is active."
client/src/features/exam/pages/ExamSessionPage.tsx:230:              ? "Math begins when the break ends. You may start early. Under test-day timing the break ends on its own and Math Module 1 starts."
client/src/features/exam/pages/ExamSessionPage.tsx:241:              Leave this tab open. Closing it under test-day timing does not
client/src/features/guardian/GuardianDashboardTab.tsx:217:    return <GuardianLoadingState what={`${possessive(name)} test results`} />;
client/src/features/guardian/GuardianDashboardTab.tsx:225:        what={`${possessive(name)} test results`}
client/src/features/guardian/GuardianStates.tsx:240:      title={`${name} hasn't finished a full-length practice test yet`}
client/src/features/guardian/GuardianTemplatePreview.tsx:39:  "Test date",
client/src/features/guardian/GuardianTemplatePreview.tsx:106:        <h2 className="m-0 text-lg font-semibold">Latest full-length test</h2>
client/src/features/guardian/GuardianTemplatePreview.tsx:107:        <Locked label="Latest full-length test" />
client/src/features/guardian/GuardianHome.tsx:42:        calendar and test results here.
client/src/features/calendar/components/Chrome.tsx:63:  { tone: "exam", label: "Practice test", varName: "--exam" },
client/src/features/calendar/components/Chrome.tsx:204:    testDate: "Add your test date",
client/src/features/calendar/components/Chrome.tsx:209:    testDate: "No test date",
client/src/features/calendar/components/Chrome.tsx:289:          <b>{daysToTest}</b> days to test
client/src/features/calendar/components/Chrome.tsx:584:    "We couldn't fit your full-length test — the days you picked are blocked.",
client/src/features/calendar/components/Chrome.tsx:586:    "A practice test couldn't be scheduled — the days chosen are blocked.",
client/src/features/calendar/components/Chrome.tsx:658:        <b>{facts.full_lengths_completed}</b> practice test
client/src/features/calendar/components/StudentChrome.tsx:304:              title={isTest ? "SAT test day" : undefined}
client/src/features/calendar/components/StudentChrome.tsx:315:              title={isTest ? "SAT test day" : undefined}
client/src/features/calendar/components/StudentChrome.tsx:316:              aria-label={isTest ? `${date}, SAT test day` : date}
client/src/features/calendar/components/StudentChrome.tsx:485:  { tone: "exam", label: "Full-length test", swatch: "bg-lyc-cat-test-bd" },
client/src/features/calendar/components/FullLengthFields.tsx:69:          Which full-length test?
client/src/features/calendar/components/FullLengthFields.tsx:80:          <option value={NEXT_TEST}>Next unused full-length test</option>
client/src/features/calendar/components/FullLengthFields.tsx:88:              A full-length test that is no longer offered
client/src/features/calendar/components/WeekGrid.tsx:115:              aria-label="Test day"
client/src/features/calendar/components/WeekGrid.tsx:142:            <b>★ SAT test day</b>
client/src/features/calendar/components/FreeCalendar.tsx:188:            Test date
client/src/features/calendar/components/FreeCalendar.tsx:253:          label="Test date"
client/src/features/calendar/components/FreeCalendar.tsx:335:        A week-by-week schedule of practice, review and full-length tests, built
client/src/features/calendar/components/FreeCalendar.tsx:336:        around your test date and what you need most. It updates itself every
client/src/features/calendar/components/CreateBlockSheet.tsx:55:  full_length: "Full-length test",
client/src/features/calendar/components/CreateBlockSheet.tsx:61:  full_length: "A timed full-length test, start to finish.",
client/src/features/calendar/components/SetupPopup.tsx:496:                <label>Full-length test day</label>
client/src/features/calendar/components/SetupPopup.tsx:526:                <label>Full-length test frequency</label>
client/src/features/calendar/components/SettingsSheet.tsx:364:            label="Full-length test day"
client/src/features/calendar/components/SettingsSheet.tsx:388:            label="Full-length test frequency"
client/src/features/calendar/components/MonthGrid.tsx:29:  if (block.tone === "exam") return "Full-length test";
client/src/features/calendar/components/MonthGrid.tsx:129:              aria-label="Test day"
client/src/features/calendar/components/MonthGrid.tsx:135:          <span className="mtest">SAT test day</span>
client/src/features/calendar/CalendarView.tsx:780:                ? "No test date set"
client/src/features/calendar/lib/blocks.ts:81:  exam: "Full-length test",
client/src/features/calendar/lib/blocks.ts:93:  if (block.block_type === "full_length") return "Full-length test";
client/src/features/calendar/copy/exam-cadence.ts:89:    return "no automatic full-length tests";
client/src/features/calendar/copy/exam-cadence.ts:103:    return `a full-length test ${rate}, ${onDay}`;
client/src/features/calendar/copy/exam-cadence.ts:105:  const noun = count === 1 ? "full-length test" : "full-length tests";
client/src/features/calendar/copy/exam-cadence.ts:108:      ? "your test"
client/src/features/calendar/copy/explanations.ts:48:    "Going over what you missed on your last full-length test.",
client/src/features/calendar/copy/explanations.ts:50:    "A full-length test every two weeks keeps you test-ready.",
client/src/features/calendar/copy/explanations.ts:55:    "Going over what you missed on your last full-length test.",
client/src/features/calendar/copy/banner.ts:27:  post_exam: "Your plan was updated after your full-length test.",
client/src/lib/tutor-error-classifier.ts:108:        title: "LISA is paused during your full-length test",
client/src/lib/tutor-error-classifier.ts:110:          "You can use LISA again after you finish your full-length test.",
client/src/lib/review-session-picker.ts:94:  if (engine === "full_length") return "Full-length test";
client/src/lib/review-session-picker.ts:148:  if (engine === "full_length") return "Full-length test";
client/src/lib/plan-copy.ts:27:  "Paid plans add your study calendar, mastery for every domain and skill, full-length tests and LISA, your tutor.";
client/src/pages/guardian-required.tsx:89:            test (consent-never-blocks) reads from this source. */}
server/lib/notifications/templates/full-length.ts:90:    title: "You have a full-length test this week",
server/lib/notifications/templates/full-length.ts:91:    body: `It's on ${renderNoticeDate(payload.local_date)}. A full-length test takes about three hours, so it helps to know now.`,
server/lib/notifications/templates/full-length.ts:101:    title: "Your full-length test is tomorrow",
server/lib/notifications/templates/full-length.ts:130:    subject: "You have a full-length test this week",
server/lib/notifications/templates/full-length.ts:132:      `You have a full-length test this week, on ${when}.`,
server/lib/notifications/templates/full-length.ts:134:      "A full-length test takes about three hours, so it helps to know now.",
server/lib/notifications/templates/full-length.ts:142:      `<p>You have a full-length test this week, on <strong>${safeWhen}</strong>.</p>`,
server/lib/notifications/templates/full-length.ts:143:      "<p>A full-length test takes about three hours, so it helps to know now.</p>",
server/lib/notifications/templates/full-length.ts:159:    subject: "Your full-length test is tomorrow",
server/lib/notifications/templates/full-length.ts:161:      `Your full-length test is tomorrow, ${when}.`,
server/lib/notifications/templates/full-length.ts:171:      `<p>Your full-length test is tomorrow, <strong>${safeWhen}</strong>.</p>`,
packages/shared/src/exam-report-schema.ts:335:  "Your test score isn't available yet because of a technical issue on our end. Our team has been notified and is investigating. We'll email you when your score is ready. (Reference: {ref})";
packages/shared/src/__fixtures__/linked-student.ts:53:    email: overrides.email ?? `${id.slice(0, 8)}@test.invalid`,
packages/shared/src/__fixtures__/linked-student.ts:56:        ? "Test Student"
```

### Query C: "full-length practice", case-insensitive, app code and the notifications contract

```
$ grep -rniE "full-length practice" client/src server packages/shared/src apps/api/src contracts \
  --include=*.ts --include=*.tsx --include=*.md | grep -vE "\.test\.tsx?:"
client/src/features/exam/pages/GuardianExamResultsPage.tsx:184:      <Title name="Practice test results" line="Full-length practice tests" />
client/src/features/guardian/GuardianStates.tsx:240:      title={`${name} hasn't finished a full-length practice test yet`}
client/src/features/calendar/lib/blocks.ts:86: * sitting — §17.1's example reads "Full-length practice test"; owner ruling OQ-62 (b) (Karl,
packages/shared/src/review-schema.ts:45: * Which engine put a question in the queue. `full_length` = a full-length practice
packages/shared/src/calendar/profile.ts:65: * between full-length practice tests, as the student chose them.
```

### Query D: notification templates ("test(s)" or "exam", non-comment)

```
$ grep -rniE "\btests?\b|\bexam\b" server/lib/notifications/templates | grep -vE "^\S+:[0-9]+:\s*(\*|//|/\*)"
server/lib/notifications/templates/index.ts:37:} from "./post-exam";
server/lib/notifications/templates/full-length.ts:90:    title: "You have a full-length test this week",
server/lib/notifications/templates/full-length.ts:91:    body: `It's on ${renderNoticeDate(payload.local_date)}. A full-length test takes about three hours, so it helps to know now.`,
server/lib/notifications/templates/full-length.ts:101:    title: "Your full-length test is tomorrow",
server/lib/notifications/templates/full-length.ts:130:    subject: "You have a full-length test this week",
server/lib/notifications/templates/full-length.ts:132:      `You have a full-length test this week, on ${when}.`,
server/lib/notifications/templates/full-length.ts:134:      "A full-length test takes about three hours, so it helps to know now.",
server/lib/notifications/templates/full-length.ts:142:      `<p>You have a full-length test this week, on <strong>${safeWhen}</strong>.</p>`,
server/lib/notifications/templates/full-length.ts:143:      "<p>A full-length test takes about three hours, so it helps to know now.</p>",
server/lib/notifications/templates/full-length.ts:159:    subject: "Your full-length test is tomorrow",
server/lib/notifications/templates/full-length.ts:161:      `Your full-length test is tomorrow, ${when}.`,
server/lib/notifications/templates/full-length.ts:171:      `<p>Your full-length test is tomorrow, <strong>${safeWhen}</strong>.</p>`,
server/lib/notifications/templates/post-exam.ts:124:        ? `The exam on ${when} has passed. Let us know whether to keep the subscription going — if we don't hear back, it ends at the end of the period you've paid for.`
```

### Query E: "exam(s)" inside client string literals (non-comment, identifiers filtered)

```
$ grep -rnE "[\"'\`>][^\"'\`<]*\b[Ee]xams?\b" client/src --include=*.ts --include=*.tsx \
  | grep -vE "\.test\.tsx?:|__tests__|test-fixtures" | grep -vE "^\S+:[0-9]+:\s*(\*|//|/\*|\{/\*)" \
  | grep -vE "import |from \"|@/features/exam|testid|testId|exam-|\"exam\"|queryKey|className|tone|/exam|\[\"exam\"|exam:|examKeys"
client/src/features/calendar/components/SetupPopup.tsx:398:                <label htmlFor="setup-exam">When is your SAT?</label>
client/src/features/calendar/components/SetupPopup.tsx:400:                  id="setup-exam"
client/src/pages/home.tsx:613:                - "Full-length SAT exam mode" did the same:
client/src/pages/digital-sat.tsx:32:    question: "Does Lyceon include full-length exams?",
client/src/pages/digital-sat.tsx:34:      "Yes. Lyceon includes full-length timed SAT exam sessions alongside daily adaptive practice and review.",
```

### Every remaining hit, classified

**Query A ("practice test(s)").** No student-facing string naming a sitting remains.

| Hit | Class |
|---|---|
| `upgrade-modal.ts:84`, `blocks.ts:86`, `exam-cadence.ts:13,75`, `explanations.ts:29`, `review-session-picker.ts:87,125`, `CanonicalPracticePage.tsx:87`, `ExamReportPage.tsx:23`, `GuardianExamResultsPage.tsx:76`, `Chrome.tsx:550,553`, `CalendarView.tsx:202,514`, `dates.ts:203`, `review-pool.ts:661`, `exam-score-renewal/job.ts:31,34`, `calendar/config.ts:76`, `exam-notify-job.ts:10`, `templates/full-length.ts:11`, `practice-canonical.ts:240`, `internal-cron-routes.ts:526`, `notifications-schema.ts:106`, `calendar/api.ts:213,215,277,609,615`, `calendar/profile.ts:65,325,342` | code comment (several record this ruling and the old wording) |
| `report-fixtures.ts:35,188,203` "Practice Test 2/3" | test fixture (a form name) |
| `GuardianExamResultsPage.tsx:184,401,420`, `GuardianStates.tsx:240` | guardian-only |
| `Chrome.tsx:63` (`FILTER_ROWS`, the `LeftRail` filters), `Chrome.tsx:658` (`FactsStrip`) | guardian-only: `CalendarView.tsx` renders `LeftRail` only on the guardian branch (UI-55 gave the student `StudentChrome`) and `FactsStrip` only when `viewer === "guardian"` |
| `Chrome.tsx:586` "A practice test couldn't be scheduled — …" | guardian-only (the `guardian` half of `SUPPRESSION_COPY`; the student half, `:584`, changed) |

**Query B (whole-token "test(s)" in student copy).** Every remaining student-facing "test(s)" is
"full-length test(s)" or a generic word.

| Hit | Class |
|---|---|
| every `full-length test(s)` / `Full-length test(s)` line | the ruled wording |
| `AppearanceSection.tsx:93`, `TestsHomePage.tsx:134,224` "like test day" / "as on test day"; `labels.ts:51,56`, `TestsHomePage.tsx:627` "Test-day timing" / "Test-day"; `ExamSessionPage.tsx:230,241` "test-day timing"; `ProfileSection.tsx:188,219`, `FreeCalendar.tsx:188,253,336`, `Chrome.tsx:204,209`, `CalendarView.tsx:780` "test date"; `Chrome.tsx:289` "days to test"; `StudentChrome.tsx:304,315,316`, `WeekGrid.tsx:115,142`, `MonthGrid.tsx:129,135` "(SAT) test day"; `exam-cadence.ts:108` "your test" (the student's SAT date, in "before your test"); `explanations.ts:50` "test-ready" | generic: the real SAT |
| `LinkSection.tsx:25` "mastery, test scores, …" | owner-ruled sentence (OQ-38, 2026-10-02), generic "test scores"; **listed for Karl** |
| `exam-report-schema.ts:335` "Your test score isn't available yet …" | Doc 04C §10.4 canonical example 1, verbatim spec copy; **listed for Karl** |
| `GuardianExamResultsPage.tsx:172,240,374,377,386,401,420`, `GuardianDashboardTab.tsx:217,225`, `GuardianStates.tsx:240`, `GuardianTemplatePreview.tsx:39`, `GuardianHome.tsx:42`, `Chrome.tsx:63,586,658` | guardian-only |
| `exam-api.ts:226` | identifier |
| `GuardianShell.tsx:151`, `guardian-required.tsx:89` | code comment |
| `__fixtures__/linked-student.ts:53,56` | fixture |

**Query C ("full-length practice").** `GuardianExamResultsPage.tsx:184`, `GuardianStates.tsx:240`:
guardian-only. `blocks.ts:86`, `review-schema.ts:45`, `calendar/profile.ts:65`: code comments.
None student-facing.

**Query D (notification templates).** Every `full-length.ts` hit is the ruled wording.
`post-exam.ts:124` "The exam on {date} has passed" is the real SAT (exam-score renewal), generic;
`index.ts:37` is an import path.

**Query E ("exam(s)" in client strings).** `SetupPopup.tsx:398,400`: an element id. `home.tsx:613`:
code comment. `digital-sat.tsx:32,34` "full-length exams" / "full-length timed SAT exam sessions":
public marketing page (SEO vertical, not student UI); **listed for Karl**.

No student-facing "practice test" naming a full-length sitting remains.

### Tests and plants

New or changed assertions, each observed RED with the string reverted at the exact line (plant
runner applies the old text on that one line, runs the named test files, restores):

| Plant | Site | Test that reddens |
|---|---|---|
| W01–W03 | `TestsHomePage.tsx:252,259,266` | `TestsHomePage.test.tsx` "OQ-62 (b): the list names its sittings…" (3 cases) |
| W04 | `TestsHomePage.tsx:538` | `TestsHomePage.test.tsx` "Start's failure line says 'the full-length test'" |
| W05, W06 | `upgrade-modal.ts:89,90` | `UpgradeModal.test.tsx` OQ-44 source cases + "OQ-62 (b): the Full-Length modal never says…"; `TestsHomePage.test.tsx` free card |
| W07 | `home-model.ts:113` | `home-model.test.ts` "names each block the prototype's way" |
| W08 | `plan-copy.ts:27` | `help.test.tsx` FAQ copy + "OQ-62 (b): the plans answer…" |
| W09–W12 | `ExamStatus.tsx:18,43,45,46` | `ExamReportPage.test.tsx` "OQ-62 (b): a 403/404/500 load error…", "…default loading line…" |
| W13–W17 | `ExamReportPage.tsx:235,360,384,405`, `DomainSegments.tsx:48` | `ExamReportPage.test.tsx` (domains lead, pending/unfinished states, Resume link, omitted-domain reason) |
| W18–W21, W23 | `FullLengthFields.tsx:69,80,88`, `CreateBlockSheet.tsx:61`, `MonthGrid.tsx:29` | new `FullLengthFields.wording.test.tsx` |
| W22 | `StudentChrome.tsx:485` | `calendar.ui55.test.tsx` Show filters (legend list + page-wide no "practice test") |
| W24, W25 | `blocks.ts:81,93` | `blocks.test.ts` |
| W26–W29 | `SetupPopup.tsx:496,526`, `SettingsSheet.tsx:364,388` | `SetupPopup.test.tsx` / `SettingsSheet.test.tsx` "OQ-62 (b): the two exam rows…" |
| W30–W32 | `exam-cadence.ts:89,103,105` | `SettingsSheet.test.tsx`, `SetupPopup.test.tsx` readouts |
| W33–W35 | `explanations.ts:48,50,55` | `explanations.test.ts` "OQ-62 (b): the three full-length sentences…" |
| W36 | `banner.ts:27` | `banner.test.ts` |
| W37 | `Chrome.tsx:584` | `guardian-readonly.tree.test.tsx` suppression (student) |
| W38 | `review-session-picker.ts:94` | `review-session-picker.test.ts`, `review.test.tsx` past sessions (+ no "Practice test" label) |
| W39, W40 | `tutor-error-classifier.ts:108,110` | `tutor-error-classifier.test.ts` |
| W41–W51 | `templates/full-length.ts:90,91,101,130,132,134,142,143,159,161,171` | new `tests/ci/notifications.full-length-copy.test.ts` (titles, bodies, email subject/text/html; no "practice test", "full test" or bare "test") |

No existing plant in `scripts/ci/review-ui-gate.mutations.sh` anchors on a changed string (its
anchors were grepped for every old string; FU-T1's *replacement* text is the old modal title,
which is a mutation, not an anchor).

### Left for Karl

1. **Form names are database values and still say "Practice Test 1/2/3"**, so a student sees
   "Practice Test 2" as a row title on the Full-Length home, the review picker and the report's
   top bar. Not renamed here (DB values are out of scope). Rename the forms?
2. **`EXAM_REPORT_FAILED_MESSAGE`** ("Your test score isn't available yet …") is Doc 04C §10.4's
   canonical example, verbatim. Left as spec copy.
3. **Doc 05F §17.1 / §17.4 examples** read "Full-length practice test" and "…after your exam"; the
   code now says "Full-length test" / "after your full-length test" on this ruling (annotated at
   `blocks.ts:85` and `banner.ts`). The spec is not edited.
4. **The guardian copy** still says "practice test" (calendar filters and facts strip, the
   suppression sentence, the guardian exam results page titles, the no-exams state). Out of
   scope for a student ruling; same wording for guardians?
5. **"test scores"** in the owner-ruled guardian-visibility sentence (OQ-38), shown to students in
   Settings and Help: read as generic and left.
6. **Public marketing page** `digital-sat.tsx` says "full-length exams" (SEO vertical).

### Screenshots

Re-captured `UI-55` (calendar: "Show" legend reads "Full-length test", the schedule line reads "no
automatic full-length tests") and `UI-58` (Help's first answer, Billing's paid line and `/upgrade`
read "full-length tests"); every shot 0px horizontal overflow. UI-41, UI-50 and UI-54 are
re-captured by the lead after the parallel navigation change merges. UI-52 and UI-53 have no
full-length source or label in their seeded data and were not re-captured.
