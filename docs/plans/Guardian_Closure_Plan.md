# Guardian Vertical — Closure Plan

**Location in repo:** `docs/plans/Guardian_Closure_Plan.md`, next to `docs/plans/guardian-audit.md` (PR #938).
**Branch:** `guardian`. One PR per row. Each PR points at `guardian`.

## Rules

**When a row closes.** A row closes only when its named proof has been observed in production. Merged is not done. Green CI is not done. The PR that closes a row pastes the proof into that row.

**Status values.** Every row is OPEN, IN PROGRESS or CLOSED. Rows marked NOT READY have no agreed proof yet, so nobody starts them.

**New findings.** A new finding becomes a new row. It is not patched the same day. The only exception is active harm: that goes to Wave 0 and everything else stops.

**Wave order.** Work one wave at a time. A wave starts only after every row in the previous wave is CLOSED.

**Rows that change what the guardian sees.** The PR must also carry an SCL entry. Number it from the highest SCL across all branches and open PRs, plus one.

## Karl's rulings (2026-09-27)

| # | Ruling | Effect |
|---|---|---|
| R1 | Guardian sign-up is broken. Karl's 2026-09-28 attempt: `PATCH /api/profile` with role Guardian returned 403 `Role changes are support-mediated only`, and the UI showed a generic "couldn't save". | Row G1-02 becomes a build row. |
| R2 | Guardians keep the streak. | No change. Doc 05B §6.5 and Doc 05F §16 already allow it. |
| R3 | Remove the 7-day questions and 7-day accuracy tiles completely. | Row G3-01. The server stops sending these counters to guardians. |
| R4 | Exam results: remove the per-domain x/y counts and keep the per-domain bar. | Row G3-02. Amends SCL-180. |
| R5 | Guardian routes stop admitting admins. | Row G2-01. This is SCL-078 in full. |
| R6 | A student under 13 without an active guardian link sees only the guardian-linking surface: the link code, the email invite and the guardian list. Unlinking locks the account again. A redeemed link counts as consent for now; legal sufficiency is out of scope. LISA stays blocked for under-13, which is also out of scope. | Rows G2-04 and G2-05. Needs an SCL against Doc 00 and Doc 01 §37. Privacy Policy wording goes to the counsel backlog. |
| R10 | Guardians give their date of birth at sign-up, the same as students, and must be 18 or older. | Row G1-02. The date-of-birth lock in G2-03 applies to guardians too. |
| R11 | The guardian view is a one-to-one copy of the student view with minimum change. Guardian widgets reuse the student components in a read-only mode, not guardian-only copies. The only differences are the deliberate removals: R3 tiles, R4 counts, skills, answers, LISA, and any launch or act controls. | Wave 4 rows G4-03, G4-04 and G4-05 reuse student components. A change made on the student side flows through to the guardian. |
| R12 | The minimum font size on every guardian surface is 16px. The top-left mark is the real Lyceon logo next to the word "Lyceon", replacing the mockup's graduation cap. Where the mockup conflicts with this, this ruling wins. | Rows G4-01 and G4-07. The proof includes a check for font sizes below 16px. |
| R7 | A revoked link shows "no longer linked" and the roster refetches. | Row G3-04. |
| R8 | SCL-173 stands: guardians see the target score and the test date. | No change. |
| R9 | The seven links created while the link function was exposed are legitimate. | Exposure-window question closed. |

## Wave 0 — Active harm

None found. The audit and the production check on 2026-09-27 found no cross-student exposure on the server and no guardian write path.

## Wave 1 — Sync, then fix what is broken

| ID | Audit ref | Work | Named proof | Status |
|---|---|---|---|---|
| G1-01 | G-AUD-32 | Merge `main` into `guardian`. | `git log guardian` contains `d073eb3`. `git diff main guardian -- <guardian file list>` is empty. | IN PROGRESS — branch `claude/guardian-g1-01-sync-main` @ merge `d576c30`: `git merge-base --is-ancestor d073eb3 HEAD` → true; `git diff --stat origin/main HEAD -- <audit §0 file list>` → empty (only `docs/plans/*` differ). `guardian` was a strict ancestor of `main`; no conflicts. Proof holds on `guardian` once merged. |
| G1-02 | G-AUD-04, R1, R10 | Allow a one-time role choice of student or guardian while `profile_completed_at IS NULL`. After completion the role stays locked, and `admin` can never be self-assigned. Choosing guardian captures date of birth through the same field and rules as student sign-up, and the server refuses guardian if the age is under 18. Link-code redemption also refuses a guardian who has no date of birth or is under 18. Existing links are untouched; an existing guardian without a date of birth is asked for it before redeeming a new code. The UI shows the server's error message instead of a generic one. | 1. A PG test covers six cases: choosing guardian with an adult date of birth before completion gives `role='guardian'`; choosing guardian with an under-18 date of birth gives 403; a change after completion gives 403; choosing admin gives 403; a profile with an active link or any learning state gives 403; redeem by a guardian with no date of birth or under 18 gives 403 and creates no link row. 2. In production, a new account completes as guardian with a date of birth and lands on `/guardian`. Paste the `profiles` row without PII (role, date of birth present, completed). | IN PROGRESS — branch `claude/guardian-g1-02-signup`. Proof (1): `tests/ci/guardian-signup.pg.ci.test.ts` 10/10 on real PG (was 8 failed / 1 passed before the change; case 1 reproduced Karl's 403), wired into CI with the vitest summary gate. Client: `client/src/pages/profile-complete.guardian-signup.test.tsx` (session role refreshed before navigating to `/guardian`; coded 403 shows the server's message). Proof (2) production: pending, owner-run. |
| G1-03 | G-AUD-01 | Clear the query cache on sign-out and on user change. | Two parts: (1) an RTL test that fails before the change and passes after: guardian A signs out, guardian B signs in, and A's student name never renders; (2) a manual repro on a production preview in one tab. | OPEN |
| G1-04 | G-AUD-07 | Send guardian access events to `audit_logs`. Remove the empty catch. | After one guardian dashboard view in production, a matching `audit_logs` row exists. The row ID is pasted into the PR. | OPEN |
| G1-05 | G-AUD-08 | Make redeem error handling return a response every time. Replace the `instanceof` check with a code check. | A handler test: a non-contract error returns 500 within the timeout. A foreign-instance LY004 error returns 409. | OPEN |
| G1-06 | G-AUD-13 | A failed link insert must not burn the student's link code. | A PG test with a pre-existing active link: redeem returns 409 and the code is still redeemable. | OPEN |
| G1-07 | G-AUD-10 | The revoke function must check that the revoker is a party to the link. Add explicit `REVOKE … FROM anon, authenticated`. | A PG test: a non-party revoke is refused. `has_function_privilege` in production returns f/f/f/t. | OPEN |
| G1-08 | G-AUD-11 | Pin the gate function's body with an md5 CI check. | A mutation that removes `status='active'` turns CI red. | OPEN |
| G1-09 | G-AUD-12 | Add `TO` clauses to the tutor INSERT and UPDATE policies. | Production `pg_policies.roles` for those policies no longer includes `public`. | OPEN |
| G1-10 | G-AUD-15 | Rewrite the six tests that cannot fail. Remove mocks of modules that do not exist. | Each rewritten test goes red under a mutation of its target. | OPEN |
| G1-11 | G-AUD-16 | Add denial tests. | A parametrised sweep: a guardian gets 403 on every student-only mount and on `/api/tutor/*`. | OPEN |

## Wave 2 — Account and access

| ID | Audit ref | Work | Named proof | Status |
|---|---|---|---|---|
| G2-01 | G-AUD-05 | Guardian routes admit guardians only. | A PG test: an admin redeeming a live code gets 403 and no link row is created. In production, an admin JWT on `/api/guardian/students` gets 403. | OPEN |
| G2-02 | G-AUD-23 | An unknown or missing role fails closed on the client and the server, and is never written back to the profile. | A unit test: an unknown role gets 403 and the profile row is unchanged. | OPEN |
| G2-03 | G-AUD-02, R10 | Lock date of birth after profile completion, for students and guardians. | A PG test: an under-13 student that PATCHes an adult date of birth gets 403 or 409 and `is_under_13` is unchanged; a completed guardian's date-of-birth PATCH is also refused. | OPEN |
| G2-04 | R6 | Enforce the under-13 gate on the server. It is derived live from `is_under_13` and an active link, with no stored flag. Every student learning mount returns 403 `guardian_link_required` when the gate is closed. The client routes the student to the linking surface, with the code, regenerate, email invite and guardian list all wired. | 1. A PG test covers four cases: an under-13 student with no link gets 403 on every learning mount; after a guardian redeems the code, the same calls return 200; after unlinking, 403 again; and the linking endpoints stay reachable throughout. 2. In production, an under-13 test account lands on the linking page, and gets in after the link is redeemed. | OPEN |
| G2-05 | G-AUD-03, R6 | Delete the dead consent-token flow: the `profile-routes` consent writes, the email that links to a page that doesn't exist, and the unused `guardian_consent_requests` path. Remove `guardian_consent` or derive it from the link. Close KNOWN-GAPS `CONSENT-FLOW-SCHEMA-MISMATCH`. Carry the SCL for R6. | `grep` finds no caller of the removed code. The G2-04 tests pass. The KNOWN-GAPS entry is marked closed with a link to the PR. | OPEN |

## Wave 3 — What the guardian sees

| ID | Audit ref | Work | Named proof | Status |
|---|---|---|---|---|
| G3-01 | R3, G-AUD-09 | For guardian callers, the KPI routes return the streak only. Remove the two tiles. Add a shared Zod schema for `kpi/overall`. Include the SCL against Doc 05B §10. | A wire-contract test: a guardian response contains no `events_*`, `accuracy_*` or `week_*` keys. A production request as a guardian shows the streak only. | OPEN |
| G3-02 | R4 | The exam per-domain payload sends a bar value only, with no `correct` or `total` fields. Include the SCL amending SCL-180. | A strict-schema test that fails if `correct` or `total` appear. A production guardian exam report payload pasted into the PR. | OPEN |
| G3-03 | G-AUD-24 | Remove `timezone` from the guardian calendar payload. | A wire test: no `timezone` key anywhere in the guardian payload. | OPEN |
| G3-04 | R7, G-AUD-06/19 | A 404 shows "no longer linked", refetches the roster, and clears the removed student's panels. | An RTL test for a 404 on mastery, the dashboard and the calendar. An RTL test that unlinking the selected student removes its panels. | OPEN |

## Wave 4 — Redesign

### Layout (Karl, 2026-09-28)

**Top bar, in one `GuardianShell` on every guardian page:**
- Left: the Lyceon logo.
- Centre: the selected student's name, as a dropdown for switching students.
- Right: an "Add student" button that opens link-code entry, the notification bell, and the profile menu.

**Body, as two tabs, centred under the top bar:**
- **Dashboard:** mastery by domain, KPIs including the streak, and full-length exam results.
- **Calendar:** the student's calendar, filling the full width.

**Routing.** The selected student and the tab live in the URL, not in component state. That way refresh, the back button and deep links keep the student, and switching students is a route change.

| Route | Shows |
|---|---|
| `/guardian` | Redirects to the first linked student, or shows the no-student state |
| `/guardian/:studentId` | Dashboard tab |
| `/guardian/:studentId/calendar` | Calendar tab |
| `/guardian/:studentId/exams/:sessionId` | Exam detail |

The old `/students/:id/calendar` and `/students/:id/tests*` pages redirect to these routes.

### Endpoint map

This is the binding contract. Each UI element calls exactly one route and parses the response with the listed shared schema. A proof fails if any element calls a route not listed here, or skips the parse.

| UI element | Route | Shared schema |
|---|---|---|
| Student switcher | GET `/api/guardian/students` | `guardianStudentsResponseSchema` |
| Add student (modal) | POST `/api/guardian/link/redeem` | `redeemLinkCodeRequestSchema` |
| Remove student | DELETE `/api/guardian/link/:studentId` | existing link schema |
| Mastery by domain | GET `/api/students/:id/mastery/domains` | domain mastery view schema |
| Streak | GET `/api/students/:id/kpi/overall` (streak only after G3-01) | new `kpi/overall` schema (G3-01) |
| Exam list / latest exam | GET `/api/students/:id/tests` | `exam-guardian-report-schema` list envelope |
| Exam detail | GET `/api/students/:id/tests/:sessionId/report` | `exam-guardian-report-schema` report envelope (G3-02 payload) |
| Calendar tab (and projection, target, test date) | GET `/api/students/:id/calendar` | `guardianCalendarResponseSchema` |
| Billing banner / purchase | GET `/api/billing/status`, checkout routes | single billing-status schema (G4-09) |
| Bell | notifications routes | existing |

### Rows

| ID | Audit ref | Work | Named proof | Status |
|---|---|---|---|---|
| G4-01 | G-AUD-20, 21 | Build the routes above inside one `GuardianShell`. Redirect the old routes. Add `/guardian` to the return-path allowlist. | A route-walk test: every guardian route renders inside `GuardianShell`, and each old route redirects. A return-path unit test. A production screenshot of each route. | OPEN |
| G4-02 | G-AUD-17, 19, 22 | Build the student switcher in the top bar and the Add-student modal. The modal redeems the code, asks for date of birth if it is missing (G1-02), and detects rate limiting by status code. Removing a student lives in the location decided at Q-L3. | RTL tests: switching students changes the URL, and no element from the previous student renders; a successful redeem adds the student and navigates to it; a 429 shows the rate-limit copy; removing the selected student routes away from it. | OPEN |
| G4-03 | R2, R3, R11 | Build the Dashboard tab, with contents as confirmed at Q-L1. Every widget follows the endpoint map. Mastery and exam widgets are the student components rendered read-only. Level labels come from `mastery_levels` or `LevelPill`, never hard-coded in the guardian code. **Establish before building:** list which student component backs each widget and what prop makes it read-only. If a student component can't render read-only without forking, stop and report. | An endpoint-map test: each widget's hook calls exactly its mapped route and parses the response with its schema. A production screenshot. | OPEN |
| G4-04 | G-AUD-14 | Build the Calendar tab: the existing guardian calendar at full width inside the shell, with guardian-addressed copy. | An RTL test of the calendar inside the shell, with a copy assertion for every state. A production screenshot. | OPEN |
| G4-05 | R4 | Exam placement as decided at Q-L2. The detail view shows per-domain bars only, with no x/y counts. | An RTL test: no `correct`/`total` text renders. A production screenshot. | OPEN |
| G4-06 | G-AUD-06, 14 | A state matrix on every surface, with guardian-addressed copy naming the student: no students, loading, error, lapsed (named CTA), revoked (R7), calendar not set up, no exams yet. | A parametrised RTL state-matrix test covering every surface and state. | OPEN |
| G4-07 | UI inventory §7, R12 | One token set. No computed font size below 16px on guardian surfaces. Guardian files use `tokens.css` and the `brand-*` classes, with no hex literals. Mastery levels get distinct colours rather than monochrome. | A CI grep gate: zero hex colour literals in guardian files. A visual check against the approved mockup. | OPEN |
| G4-08 | UI inventory §7 | The guardian profile and settings page renders in `GuardianShell` with guardian sections only, not the student navigation. | An RTL test: a guardian on `/profile` sees no student nav items. A production screenshot. | OPEN |
| G4-09 | G-AUD-26, 27 | A single billing-status schema and hook, used by every banner. Remove the empty catches and stop the poller after its timeout. Fix label copy. | A billing-status schema round-trip test. A poller-timeout test. | OPEN |
| G4-10 | Q-L3 | Build the "Linked students & billing" page from the profile menu. Each linked student has its own Manage subscription or Choose a plan button, and a Remove button with a confirmation step. **Establish before building:** how Stripe customers and subscriptions map to guardian and student today (one customer per guardian with several subscriptions, or one per student), and how the current Manage Subscription button picks its target. Stop and report if a guardian's single portal session would expose or act on another student's subscription. | 1. A handler test with a guardian linked to two students: each portal session is created for the right customer and scoped to that student's subscription, and a student ID the guardian isn't linked to is refused. 2. In production, with two students, each button lands on the correct student's subscription in Stripe. Screenshots, plus the portal session IDs with no PII. | OPEN |

**Answers to the open layout questions (Karl, 2026-09-28)**
- **Q-L1, Dashboard contents:** a header strip with streak, projected score band, target score and test-date countdown; then this week's sessions done out of planned; then mastery by domain grouped by section; then the latest full-length test.
- **Q-L2, exams:** the latest test sits on Dashboard, with a "See all results" link to the list and detail page.
- **Q-L3, remove and billing:** both live on the "Linked students & billing" page under the profile menu. Remove needs a confirmation step. Billing is per student (G4-10).
- **Q-L4, devices:** desktop and phone are designed side by side.
- **Q-L5, colours:** Lyceon brand colours, navy `#0F2E48` and cream `#FFFAEF`. Other neutrals are tints of these. Mastery levels use the colours of the current `LevelPill`. Level labels come from the production `mastery_levels` table, checked on 2026-09-28. Five measured levels plus unmeasured: NULL is "Not enough answers yet", 0 is Foundations, 1 is Building, 2 is Developing, 3 is Proficient, 4 is Strong. The constraint on `student_domain_mastery` allows 0–4.

**Mockup:** https://claude.ai/artifact/DiT4R9sgFjHegYJ9TUAkfY. It uses sample data. Level names match production. Colours are placeholders until they are bound to `LevelPill`.

**Gate on this wave:** the mockup is approved before G4-03 through G4-07 start.

## Findings from outside the audit (to be routed)

| ID | Found | Finding | Route |
|---|---|---|---|
| G-NEW-01 | Karl's screenshot, 2026-09-28 | The student Profile page shows "Member since Unavailable". | Student UI vertical. It is not a guardian row. |
| G-NEW-02 | G1-01 merge, 2026-09-29 | `main` moved past `d073eb3` (to `9020316`, #931/#936/#937/#941) after the audit. One guardian-visible change the audit does not describe: the guardian calendar payload gains `full_length_suppressions` (dates where a practice test could not be placed), rendered as a statement on the guardian calendar. Owner ruling 2026-09-26 per the code comment (`packages/shared/src/calendar/api.ts` guardian ready schema; `server/services/calendar/read-service.ts` `readGuardianCalendar`; `client/src/pages/guardian-student-calendar.tsx`). The new practice-test notifications are student-only (migration comment: "The student only"). | Audit addendum. No defect. Include in the Wave 4 calendar endpoint map (G4-04). |

## Backlog outside this vertical

- Counsel review: is a redeemed guardian link sufficient consent for under-13 users under COPPA? Privacy Policy wording.

## Wave 5 — Cleanup

G-AUD-18, 25, 28, 29 (note only), 30, 31.
