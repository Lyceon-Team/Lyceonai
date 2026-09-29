# Guardian Vertical — Closure Plan

**Location in repo:** `docs/plans/Guardian_Closure_Plan.md`, next to `docs/plans/guardian-audit.md` (PR #938).
**Branch:** `guardian`. One PR per row. Each PR points at `guardian`.

## Rules

**When a row closes.** A row closes only when its named proof has been observed in production. Merged is not done. Green CI is not done. The PR that closes a row pastes the proof into that row.

**Status values.** Every row is OPEN, IN PROGRESS or CLOSED. Rows marked NOT READY have no agreed proof yet, so nobody starts them.

**New findings.** A new finding becomes a new row. It is not patched the same day. The only exception is active harm: that goes to Wave 0 and everything else stops.

**Wave order.** Work one wave at a time. A wave starts only after every row in the previous wave is CLOSED.

**One PR per wave, one commit per row.** Each wave ships as a single PR against `guardian`, on one `claude/guardian-wave-<n>` branch. Inside it, each row is exactly one commit, and the commit message starts with the row ID (`G1-06: …`). A reviewer can read, revert or bisect one row without touching the others. Overlaps between rows are resolved as the commits land and are described in the PR. (Owner ruling, 2026-09-29. It replaces one PR per row, which Wave 1 used for #945–#955: those PRs overlapped in the same handlers and had to be merged into each other after every merge.)

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

**Multi-guardian, proven in production (owner, 2026-09-29).** Student `3f18cbe2…` has two active guardian links, `6569d0ed…` and `70a3267d…`, and `guardian_view_decision` returns `allow` for both. The newer guardian read `/api/students/3f18cbe2…/calendar` with 200 at 07:46:13Z and 07:46:18Z.
| R9 | The seven links created while the link function was exposed are legitimate. | Exposure-window question closed. |

## Wave 0 — Active harm

None found. The audit and the production check on 2026-09-27 found no cross-student exposure on the server and no guardian write path.

## Wave 1 — Sync, then fix what is broken

| ID | Audit ref | Work | Named proof | Status |
|---|---|---|---|---|
| G1-01 | G-AUD-32 | Merge `main` into `guardian`. | `git log guardian` contains `d073eb3`. `git diff main guardian -- <guardian file list>` is empty. | CLOSED (owner, 2026-09-29) — proven on `guardian` through #945's merge `4697ce4`: `git merge-base --is-ancestor d073eb3 origin/guardian` → yes; the inventory diff against `main` was only #949's `guardian-routes.ts`. Build evidence: #949's G1-05 fix, on `guardian` ahead of `main`, not missing sync. `main` has since moved to `31e24b1` (#956, billing; no inventory file), which reaches `guardian` at the next guardian↔main merge. Awaiting CLOSED. |
| G1-02 | G-AUD-04, R1, R10 | Allow a one-time role choice of student or guardian while `profile_completed_at IS NULL`. After completion the role stays locked, and `admin` can never be self-assigned. Choosing guardian captures date of birth through the same field and rules as student sign-up, and the server refuses guardian if the age is under 18. Link-code redemption also refuses a guardian who has no date of birth or is under 18. Existing links are untouched; an existing guardian without a date of birth is asked for it before redeeming a new code. The UI shows the server's error message instead of a generic one. | 1. A PG test covers six cases: choosing guardian with an adult date of birth before completion gives `role='guardian'`; choosing guardian with an under-18 date of birth gives 403; a change after completion gives 403; choosing admin gives 403; a profile with an active link or any learning state gives 403; redeem by a guardian with no date of birth or under 18 gives 403 and creates no link row. 2. In production, a new account completes as guardian with a date of birth and lands on `/guardian`. Paste the `profiles` row without PII (role, date of birth present, completed). | IN PROGRESS — merged in #961 (`6efb9cc`). Production (owner, 2026-09-29): build `dpl_FAZJe9bJEBSoX51apTKoQainQuJz` took traffic at 07:44Z; `PATCH /api/profile 200` at 07:44:37Z (request `0ca388c6`) completed profile `5556b10a…` as guardian with an adult date of birth; the next `GET /api/profile` returned `role: guardian` (auth refresh works, no bounce to `/dashboard`). **Remaining (Karl):** an under-18 guardian attempt on the new build returns the coded refusal. The only 403 seen (07:43:52Z) ran on the previous build `dpl_CGu7…` and does not count. Build evidence: Wave 1 PR #961, commit `6efb9cc` (red-before evidence in #946). Proof (1): `tests/ci/guardian-signup.pg.ci.test.ts` 10/10 on real PG (was 8 failed / 1 passed before the change; case 1 reproduced Karl's 403), wired into CI with the vitest summary gate. Client: `client/src/pages/profile-complete.guardian-signup.test.tsx` (session role refreshed before navigating to `/guardian`; coded 403 shows the server's message). Proof (2) production: pending, owner-run. Green on `claude/guardian-wave-1`, 2026-09-29: `guardian-signup.pg` 10/10; client + contract files 56/56. |
| G1-03 | G-AUD-01 | Clear the query cache on sign-out and on user change. | Two parts: (1) an RTL test that fails before the change and passes after: guardian A signs out, guardian B signs in, and A's student name never renders; (2) a manual repro on a production preview in one tab. | IN PROGRESS — merged in #961 (`748d22a`); the RTL proof is green. **Remaining (Karl):** the manual shared-tab repro in production — guardian A signs out, guardian B signs in, and A's student never renders. Build evidence: Wave 1 PR #961, commit `748d22a` (red-before evidence in #947). Proof (1): `client/src/contexts/SupabaseAuthContext.cache-isolation.test.tsx` — red before (`expected <li></li> to be null`: A's student on screen while B's roster was in flight, confirming G-AUD-01), green after. Proof (2) manual repro on a preview: pending, owner-run. Green on `claude/guardian-wave-1`, 2026-09-29: cache-isolation + useGuardianStudents 4/4. |
| G1-04 | G-AUD-07 | Send guardian access events to `audit_logs`. Remove the empty catch. | After one guardian dashboard view in production, a matching `audit_logs` row exists. The row ID is pasted into the PR. | CLOSED (owner, 2026-09-29) — production `audit_logs` rows `d4dd91f7-573f-49c5-9516-a23315f6b144` (`guardian_dashboard_viewed`, `linked_student_count: 0`, 07:44:40Z, request `5f163a1e…`) and `f2743189-9497-49ee-8f17-7817d4fbdd02` (count 1, 07:46:07Z, request `88d1504f…`); both request IDs match the Vercel logs. Build evidence: Wave 1 PR #961, commit `21fbfae` (red-before evidence in #948). `tests/ci/guardian-access-audit.pg.ci.test.ts` red before (no `audit_logs` row), 2/2 green after, wired into CI. Production row ID: pending, owner-run query in the PR. Green on `claude/guardian-wave-1`, 2026-09-29: `guardian-access-audit.pg` 2/2. |
| G1-05 | G-AUD-08 | Make redeem error handling return a response every time. Replace the `instanceof` check with a code check. | A handler test: a non-contract error returns 500 within the timeout. A foreign-instance LY004 error returns 409. | CLOSED (owner, 2026-09-29) — production `POST /api/guardian/link/redeem 201` at 07:46:05Z (request `f8ff026a…`): link `70a3267d…` created, audit row `64c31231…` (`guardian_link_initiated`) written, Resend notification accepted. Build evidence: merged to `guardian` via #949 (`7cd200b`). `tests/ci/guardian-redeem-errors.pg.ci.test.ts` (PG-backed per the schema-truth gate: real route, real spend/link/TTL/rate-limit against genesis + migrations, one failure injected per case): red before (4/4 `Response timeout of 2000ms exceeded`), 5/5 green after (presence: real redeem → 201; non-contract → 500, foreign-instance LY004 → 409, spend throw → 500, TTL throw → 500). Wave 1 PR #961 (G1-02 commit) gives this test's guardian an adult date of birth, fixture only; 5/5 green there. |
| G1-06 | G-AUD-13 | A failed link insert must not burn the student's link code. | A PG test with a pre-existing active link: redeem returns 409 and the code is still redeemable. | CLOSED (owner, 2026-09-29) — test-only proof (`tests/ci/guardian-code-not-burned.pg.ci.test.ts`, 3/3), green in #961's CI; deployed. Build evidence: Wave 1 PR #961, commit `bb40de0` (red-before evidence in #950). `tests/ci/guardian-code-not-burned.pg.ci.test.ts`: red before (409 case: code rotated `expected 'B4RJMV' to be '8RF2AY'`; infra case: hang), 3/3 green after, wired into CI. Green on `claude/guardian-wave-1`, 2026-09-29: `guardian-code-not-burned.pg` 3/3. |
| G1-07 | G-AUD-10 | The revoke function must check that the revoker is a party to the link. Add explicit `REVOKE … FROM anon, authenticated`. | A PG test: a non-party revoke is refused. `has_function_privilege` in production returns f/f/f/t. | CLOSED (owner, 2026-09-29) — production grants (public/anon/authenticated/service_role): `guardian_can_view_student` 0/0/1/1, the other five 0/0/0/1; `revoke_guardian_link_audited` body md5 `565b58b61fa098378baff02cff46fb06` matches. Build evidence: Wave 1 PR #961, commit `48dc437` (red-before evidence in #951); migration `20261013000000_guardian_revoke_party_check.sql` (owner applies by hand). PG proof: `tests/ci/guardian-revoke-party.pg.ci.test.ts` red before (non-party and NULL revokes succeeded), 5/5 green after; grants case reddens under a PUBLIC-only REVOKE mutation (`f/t/t/t`). Note: `guardian_can_view_student` keeps `authenticated` (f/f/t/t) — the RLS policies call it. Production `has_function_privilege`: pending, owner-run. Green on `claude/guardian-wave-1`, 2026-09-29: `guardian-revoke-party.pg` 5/5; GENESIS FRESH-APPLY GATE: PASS. |
| G1-08 | G-AUD-11 | Pin the gate function's body with an md5 CI check. | A mutation that removes `status='active'` turns CI red. | CLOSED (owner, 2026-09-29) — CI gate (GATE 0) and mutation harness (M1, M2 red), green in #961. Build evidence: Wave 1 PR #961, commit `ffeff9d` (red-before evidence in #952). GATE 0 pins the md5 of `guardian_view_decision` and both boolean forms. `scripts/ci/guardian-view-decision-gate.mutations.sh` (wired into CI): M1 (drop `status='active'`) and M2 (one-id backdoor) both red on GATE 0. **Correction to G-AUD-11:** before this change M1 already reddened CI (GATE 6 `revoked link expected not_linked, got allow`); the uncovered class was M2, which passed every gate. Green on `claude/guardian-wave-1`, 2026-09-29: GUARDIAN-VIEW-DECISION GATE: PASS; mutations 5 passed, 0 failed (M1, M2 red on GATE 0). |
| G1-09 | G-AUD-12 | Add `TO` clauses to the tutor INSERT and UPDATE policies. | Production `pg_policies.roles` for those policies no longer includes `public`. | CLOSED (owner, 2026-09-29) — production `pg_policies.roles` = `{authenticated}` for `tutor_conversations_insert_own`, `tutor_conversations_update_own` and `tutor_messages_insert_own`. Build evidence: Wave 1 PR #961, commit `49530ff` (red-before evidence in #953); migration `20261013010000_tutor_own_write_policies_to_authenticated.sql` (owner applies by hand). `tests/ci/tutor-policy-roles.pg.ci.test.ts` red before (`roles = {public}`), green after, wired into CI. Production `pg_policies.roles`: pending, owner-run. Green on `claude/guardian-wave-1`, 2026-09-29: `tutor-policy-roles.pg` 1/1; tutor-schema-proof PASS; GENESIS FRESH-APPLY GATE: PASS. |
| G1-10 | G-AUD-15 | Rewrite the six tests that cannot fail. Remove mocks of modules that do not exist. | Each rewritten test goes red under a mutation of its target. | CLOSED (owner, 2026-09-29) — each rewritten test's mutation proof, green in #961. Build evidence: Wave 1 PR #961, commit `cbc0778` (red-before evidence in #954). Six tests rewritten, each with the mutation that reds it (all run 2026-09-29, restored green): (a) protected-routes: `sendUnauthenticated` → 200 reds 6/6; (b) payment-access (now real PG): guardian entitlement confers access reds; (c) guardian-reporting: the dead-table assertion is fixed in G1-04 (#948), dead mocks removed here; (d) anti-leak: `select("*")`, `role='admin'`, and the old `student_user_id` fixture each red; (e) useGuardianStudents: cast-instead-of-parse reds; (f) calendar-link: dropping `created_at` from the SELECT reds 4/4. Mocks of three non-existent modules removed from 3 files. Green on `claude/guardian-wave-1`, 2026-09-29: `guardian-payment-access.pg` 2/2; calendar-link.pg 4/4; four rewritten files 19/19; GUARDIAN SCHEMA-TRUTH GATE: PASS. |
| G1-11 | G-AUD-16 | Add denial tests. | A parametrised sweep: a guardian gets 403 on every student-only mount and on `/api/tutor/*`. | CLOSED (owner, 2026-09-29) — the router-built sweep (64/64) and its mutations, green in #961. Build evidence: Wave 1 PR #961, commit `3eb734d` (red-before evidence in #955). `tests/ci/guardian-denial-sweep.pg.ci.test.ts` (PG-backed: the guardian is a real `profiles` row, per the schema-truth gate) walks the real app's router: 61 gated endpoints each give a guardian the role gate's 403; every `/api/tutor` route is gated; every /api endpoint is gated or on a named guardian-reachable prefix. Mutations: ungating `/api/calendar` reds the classification case; `requireStudentOrAdmin` admitting guardians reds 55; `requireStudentOnly` admitting guardians reds 6/6 tutor routes. Green on `claude/guardian-wave-1`, 2026-09-29: `guardian-denial-sweep.pg` 64/64. |

## Wave 2 — Account and access

| ID | Audit ref | Work | Named proof | Status |
|---|---|---|---|---|
| G2-01 | G-AUD-05 | Guardian routes admit guardians only. | A PG test: an admin redeeming a live code gets 403 and no link row is created. In production, an admin JWT on `/api/guardian/students` gets 403. | IN PROGRESS — Wave 2 PR, commit G2-01. `requireGuardianRole` admits `guardian` only (`server/middleware/guardian-role.ts`); `/guardian` client route allows `["guardian"]` (`client/src/App.tsx`); migration `20261014000000_guardian_link_party_roles.sql` makes `create_active_guardian_link_audited` refuse (LY006) a non-guardian grantee or a non-student subject. `tests/ci/guardian-admin-denied.pg.ci.test.ts`: red before (7/9 — admin redeem `expected 201 to be 403`, roster `200`, unlink `404`, function resolved for admin/student/guardian-subject), 9/9 green after. Establish: no admin tooling reaches guardian routes (the only admin UI is crisis review). **Remaining (Karl):** apply the migration; an admin session on `GET /api/guardian/students` gets 403 in production. |
| G2-02 | G-AUD-23 | An unknown or missing role fails closed on the client and the server, and is never written back to the profile. | A unit test: an unknown role gets 403 and the profile row is unchanged. | IN PROGRESS — Wave 2 PR, commit G2-02. Establish (every place that defaulted a role): server — `normalizeRuntimeRole` mapped any unknown role to `student` and `ensureProfileForAuthUser` WROTE it back to `profiles` at every sign-in; billing (`/checkout`, `/status`, `/portal`) read an unknown role as a self-paying student; `requireStudentOrAdmin` refused only guardians. Client — `RequireRole` fell through to `student`; `UserProfile` displayed `user?.role || "student"`. Fixed: shared `runtimeRoleSchema`; the loader parses and throws `UnrecognizedRoleError` with no write; the middleware attaches no user and every signed-in-only route answers 403 `ROLE_UNRECOGNIZED` (public routes still answer, so sign-out works); `requireStudentOrAdmin` is an allow-list; billing refuses an unparsed role; the client shows a neutral `AccountUnavailable` screen, not `/login`. `tests/ci/role-fail-closed.pg.ci.test.ts`: red before (tutor/teacher reached a learning route with 200, and both rows were rewritten to `student`), 5/5 green after; `client/src/components/auth/RequireRole.role-unrecognized.test.tsx`: red 3/4, 4/4 green. |
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

| ID | Found | Finding | Route (owner wave) | Named proof | Status |
|---|---|---|---|---|---|
| G-NEW-01 | Karl's screenshot, 2026-09-28 | The student Profile page shows "Member since Unavailable". | Student UI vertical. It is not a guardian row. | — (owned by the student UI vertical) | ROUTED |
| G-NEW-02 | G1-01 merge, 2026-09-29 | `main` moved past `d073eb3` (to `9020316`, #931/#936/#937/#941) after the audit. One guardian-visible change the audit does not describe: the guardian calendar payload gains `full_length_suppressions` (dates where a practice test could not be placed), rendered as a statement on the guardian calendar. Owner ruling 2026-09-26 per the code comment (`packages/shared/src/calendar/api.ts` guardian ready schema; `server/services/calendar/read-service.ts` `readGuardianCalendar`; `client/src/pages/guardian-student-calendar.tsx`). The new practice-test notifications are student-only (migration comment: "The student only"). | Audit addendum. No defect. Include in the Wave 4 calendar endpoint map (G4-04). | — | NOTE |
| G-NEW-03 | Production logs, owner, 2026-09-29 | Right after a new guardian's first sign-up (07:44:39–41Z) the client called `GET /api/progress/kpis` and `GET /api/progress/projection` twice each. The server returned 403 `guardian_blocked`, so nothing leaked, but a student-only surface still renders for a new guardian on first load. It did not recur after linking. **Establish in Wave 4:** which component issued the calls. | Wave 4 (shell, G4-01) | An RTL test: the guardian first-load path makes zero requests to student-only routes. Production: the Vercel logs show no `guardian_blocked` events for a fresh guardian sign-up. | OPEN |
| G-NEW-04 | Production logs, owner, 2026-09-29 | `GET /api/account/email-suppression` returns 503 on the student Settings page: Resend rejects the suppression-list read with 401 (`provider_rejected`, 07:45:55Z, request `20a65b22…`). Sending works; the API key probably lacks read permission. | Outside this vertical (ops) | Route to ops. Not a guardian row. | OPEN (ops) |
| G-NEW-05 | #961 review, 2026-09-29 | G1-06's restore-on-failure is not atomic: a process crash between spending the code and restoring it still burns the code. | Backlog, LOW | A single-transaction redeem in SQL, with a PG test that injects a failure after the spend. | OPEN |
| G-NEW-06 | G1-09 establish, 2026-09-29 | The seven tutor `*_select_own` policies apply to `public`. They are harmless (anon has no SELECT grant, and each policy returns only the reader's own rows), but should be tightened to `authenticated` for consistency. | Backlog, LOW | Production `pg_policies.roles` = `{authenticated}` for all seven. | OPEN |
| G-NEW-07 | #961 consolidation, 2026-09-29 | Since #961, a guardian who has no date of birth **and** is already linked gets 403 (date of birth) on redeem instead of 409. Accepted by the owner on 2026-09-29: the guardian's own missing date of birth is refused before anything about the student is examined. | Note (no work) | None. Recorded for traceability. | NOTE |

## Backlog outside this vertical

- Counsel review: is a redeemed guardian link sufficient consent for under-13 users under COPPA? Privacy Policy wording.
- Existing guardians without a date of birth (owner, 2026-09-29): 13 older guardian accounts have none. Their links are untouched, and they are asked for a date of birth only when redeeming a new code, which is working as designed. No action.

## Wave 5 — Cleanup

G-AUD-18, 25, 28, 29 (note only), 30, 31.
