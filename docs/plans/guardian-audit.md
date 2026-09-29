# Guardian Vertical: Spec, Repo and Production Audit

**Date:** 2026-09-27 · **Mode:** read-only audit. No code, schema or spec was changed. This file is the only write.
**Branch:** `claude/guardian-audit`, cut from `guardian` @ `9fec623`.
**Code baseline:** `origin/main` @ `d073eb3`. Every `file:line` below refers to that tree unless it says otherwise.

## 0. Before you read: pushback on the brief, and scope

1. **`guardian` is behind `main`, and `main` is what production runs.** The guardian exam-results surface (G1) exists only on `main`, merged through PRs #929–#934. It includes `STUDENT_EXAM_PATHS`, `GuardianExamResultsPage.tsx` and migration `20261010000000_exam_domain_breakdown.sql`. On `guardian`, `/api/tests/*` is `requireStudentOrAdmin` only, and no guardian exam read exists. For this reason the whole audit was run against `origin/main` @ `d073eb3`, read from a detached worktree.
   - Evidence: `git log origin/guardian..origin/main` lists 940d4f1 "Merge #932 claude/g1-guardian-exam-results".
   - Evidence: `git diff --name-only origin/guardian origin/main` shows 27 files, all G1, the SCL sweep or CI.
   - Every other guardian file is byte-identical between the two trees.
2. **"Doc 05F … file titled Doc 08" is wrong.** `docs/Spec/Lyceon_Doc_05F.md:1` is titled "Document 05F: Study Calendar & Plan Generation". Line `:8` says only that it "was drafted as 'Doc 08'", which is why its ruling ids carry the `R-08-*` prefix. The file actually titled Doc 08 is `Lyceon — Document 08_ Expansion.md`, which describes itself as "Not a contract" (`:3`).
3. **"There is no dedicated guardian spec" holds.**
   - Doc 07C specifies no guardian dashboard. It says "Guardian-facing surfaces → Doc 01 + Doc 04C (explicitly out of scope at V1)" (`07C:95`).
   - No locked doc defines a guardian dashboard payload. Doc 01 §38.3 (`:1818-1826`) is a source list only.
4. **The locked spec has no link codes.**
   - Doc 01 §36.1 (`:1678-1697`) still specifies two email-initiated paths, each with an acceptance step.
   - Code-based linking rests on SCL-080, which is **PROPOSED, not applied** (`docs/SpecAudit/SPEC_CHANGES_LOG.md:121`).
5. **No audit slash command exists.** `.claude/commands/` holds only `audit-batch.md` and `author-batch.md`, which are question-bank tools. This report uses the brief's §6 structure.
6. **Production DB was not queried.**
   - CLAUDE.md ("Is it deployed?") says: "never query or write production yourself". The Supabase connector available to this session can write, so it does not meet the brief's "read-only" condition.
   - Every production claim here is either the owner's 2026-09-27 report (brief §2) or UNKNOWN.
   - The exact read-only SQL to settle each one is in **Appendix A**. It uses `has_function_privilege`/`has_table_privilege` and no ACL string matching.
7. **Deploy state was read from Vercel.** This is not the DB.
   - The latest READY production deployment is `dpl_3uiwcfeTJsSgJSZ1fELwyiKA2bPv`, built from `main` @ `d073eb3` ("Merge pull request #934 from Lyceon-Team/exam").
   - Source: Vercel `list_deployments` (project `prj_Q7cVFOLY753OTXPiZAKfiLczGIIo`, target=production) on 2026-09-27.
   - Not verified: whether the production alias points at this deployment and not a rollback.
8. **No `packages/ui` exists.** `packages/` contains only `shared`. See §7.

**Files covered.**
- Server
  - `server/routes/guardian-routes.ts`, `server/routes/student-resources.ts`
  - `server/middleware/{guardian-role,subject-resolver,supabase-auth,guardian-link-rate-limit}.ts`
  - `server/services/{guardian-subject,subject-access-audit,entitlement-service,kpi-access,canonical-runtime-views,exam-report-service,exam-runtime-service}.ts`
  - `server/services/calendar/read-service.ts`
  - `server/lib/{account,student-link-code}.ts`, `server/routes/{profile,billing,exam-report,tutor-runtime}-routes.ts`
  - Mounts in `server/index.ts`
- DB-access helpers
  - `apps/api/src/services/{mastery-view,mastery-read,kpi-rollup-read,projection-read}.ts`
- Shared schemas (`packages/shared/src/`)
  - `guardian-subject.ts`, `guardian-link-schema.ts`, `student-link-code-schema.ts`, `student-resources.ts`
  - `exam-guardian-report-schema.ts`, `exam-report-schema.ts`
  - `calendar/{api,read-model,plan}.ts`
- Client
  - `client/src/App.tsx`, `pages/guardian-dashboard.tsx`, `pages/guardian-student-calendar.tsx`
  - `features/exam/pages/GuardianExamResultsPage.tsx`, `features/calendar/**` (guardian mode)
  - `components/guardian/*`, `components/layout/{GuardianShell,app-shell,HeaderUserMenu}.tsx`
  - `components/auth/RequireRole.tsx`, `contexts/SupabaseAuthContext.tsx`, `lib/queryClient.ts`, `hooks/useGuardianStudents.ts`
- DB
  - Every migration defining guardian functions, policies, link/consent tables, calendar and exam RLS, and tutor RLS
  - `scripts/ci/*guardian*`, `scripts/ci/*.mutations.sh`
- Tests
  - Every test file matching `guardian` or `subject-resolver`, and the anti-leak and mutation-ownership suites

---

## 1. Summary

**Findings: 0 CRITICAL · 4 HIGH · 11 MEDIUM · 18 LOW** (§6).

**Active-harm stop conditions, checked in order:**

| Stop condition | Result | Layer |
|---|---|---|
| Cross-guardian / cross-student exposure via the server | **Not found.** Every guardian read goes through `resolveSubject`, which calls `guardian_view_decision` and fails closed. Exam sessions are ownership-checked in SQL against the path student. | code + schema (repo) |
| Cross-guardian exposure via the client cache | **Possible, unconfirmed: G-AUD-01.** Sign-out invalidates the React Query cache and does not clear it. On a shared tab, the next guardian who signs in can briefly be shown the previous guardian's cached roster, and any cached per-student panels, until the refetch lands. Found by reading the code; not reproduced at runtime because `node_modules` is not installed. I reported it mid-audit and did not stop, because it is client-only, bounded to a single refetch, and does not change the shape of the audit. | client |
| Guardian write path to student learning state | **Not found.** Every learning-state mount is `requireStudentOrAdmin` or `requireStudentOnly`. Every write under `/api/students/:id/*` refuses `via !== 'self'` before writing. | code |
| Guardian access to LISA | **Not found in code.** `/api/tutor` is `requireStudentOnly` (`server/index.ts:390-397`; `supabase-auth.ts:837`). *Production-dependent residual:* the tutor INSERT/UPDATE RLS policies have no `TO` clause (G-AUD-12). This is harmless unless production grants `authenticated` write privileges on the tutor tables. Appendix A.4 settles it. | code + schema |
| Forgeable link or consent | **Link: not forgeable.** The student id comes only from the row a live code matches. **Consent: not forgeable, because the flow is dead** (G-AUD-03), and a student can skip it entirely by rewriting their date of birth (G-AUD-02). | code + schema |

**What the guardian sees today in production:** see §4.
- **Dashboard.** A linked-student list, plus per student three KPI tiles: day streak, questions in the last 7 days, and accuracy over the last 7 days. It also shows domain mastery levels.
- **Calendar page.** Days, blocks and completion; the facts strip; minute estimates; the streak; the target score and test date; and the projected score band.
- **Exam page.** Total and section scores, attempt facts, the disclosure, and per-domain correct-of-total counts.
- **Where this conflicts with the §3 rulings.** The streak (3 places), the target score, and raw accuracy and counts. The locked spec *allows* each of these, so they are SCL candidates (§8), not defects.

---

## 2. Spec extraction (§4.1)

This section lists 120 guardian requirements extracted from the corpus. The table keeps the ones that bind the audited surfaces. **Status** is checked against the code at `d073eb3`.

| Req | Doc § (file:line) | Requirement | Impl? | Evidence |
|---|---|---|---|---|
| GR-01 | Doc 00 :133; CS §6.2 | Visibility requires an active link **and** an active student entitlement. View-only. | Y | `guardian_view_decision` (`supabase/migrations/20260827000000_guardian_view_decision.sql:91-108`), called from `server/services/guardian-subject.ts:46`, used by `server/middleware/subject-resolver.ts:115` |
| GR-05 | Doc 01 §31.3 :1368 | Any one premium linked student grants the guardian premium derivation. | PARTIAL | Used only for billing and CTA (`resolveLinkedPairPremiumAccessForGuardian`). Reads are gated per student (conflict DIS-01). |
| GR-12 | Doc 05B §10.3 :1620 | An unrelated caller gets 404, not 403. | Y | `subject-resolver.ts:75-80,142` |
| GR-13 | Doc 05B §10.4 :1631 | A guardian calling the skill resource gets 200 `[]`. | Y | `student-resources.ts` `/mastery/skills` branch, `via === "guardian"` → `skills: []` |
| GR-14 | Doc 05B §10.3 :1608 (RB-05B-V1-05) | One route per resource. The only role branch is path-layer authz. | Y | `student-resources.ts` header; CI `scripts/ci/subject-resolver-chokepoint-gate.mjs` |
| GR-15 | Doc 04C §12.1 :893-907, §16.6 | Exam, no link: 403 with no body. Exam, lapsed: 200 `unavailable`. | N (by proposed change) | Implemented as 404/402 per **SCL-181 (PROPOSED)**. `student-resources.ts` G1 block; `subject-resolver.ts:131-143` |
| GR-16 | Doc 05F §15 :740 | Calendar: 404 for no link or a revoked link; 402 for an unentitled student. | Y | `subject-resolver.ts:131-143` + `entitlementGate` (`student-resources.ts`) |
| GR-18 | Doc 01 §36.1 :1678-1697 | Email-initiated linking with an acceptance step. | N (replaced) | Code links, per SCL-080 (PROPOSED): `guardian-routes.ts:285-437` |
| GR-19 | Doc 01 §36.2 :1701-1706 | Rate limits: 10 per guardian per day and 3 per student email per day. | PARTIAL | Re-keyed per SCL-080: `guardian_link_code_entry` 10/day (`20260901000000_scl_080_guardian_link_code.sql:133-149`) |
| GR-21 | Doc 01 §37 :1736-1796 | Under-13 consent via an emailed token. | N | Flow is dead: G-AUD-03 |
| GR-25 | Doc 00 :265 | One primary guardian per minor. | N | No such constraint. `unique_active_guardian_link` is per pair only (genesis:259-261). |
| GR-28/30 | Doc 00 :133; Doc 05 §16 :781 | Guardians never write learning state. | Y | §5 row 1 |
| GR-34/35 | Doc 05 §15.2 :747-749; AC#19 :822 | No per-skill mastery, no raw KPI rollups, **no KPI counters**. | PARTIAL | Skills are withheld. KPI counters **are** served (`kpi-rollup-read.ts:68,98`: `events_total, accuracy_overall, current_streak_days`). Conflict DIS-04 / SCL-074. |
| GR-36 | Doc 05 AC#20 :823 | Mastery returns only `mastery_level`. | Y | `apps/api/src/services/mastery-read.ts:104` selects `section, domain, mastery_level` |
| GR-38 | Doc 05A :73 | No guardian skill-mastery rows. | Y | No guardian policy on `student_skill_mastery` (`20260610010000_ws3_mastery_formula.sql:308`). Route returns `[]`. |
| GR-48/49 | Doc 05B §2.4, §6.5 :651-655 | Guardian may read section, domain and overall KPI, including streak and accuracy. | Y | `resource(kpiSections|kpiDomains|kpiOverall)` in `student-resources.ts` |
| GR-57/59 | Doc 05C §10.1 :1233-1240; RB-05C-V1-08 | Guardian sees the same projection rows and snapshot history. | Y (server only) | `projection-read.ts:49-51,80-82`. **No guardian UI calls these routes.** |
| GR-62 | Doc 04 Q9 :88 | Exam headline only. **No domain breakdown.** | N (by proposed change) | Domain breakdown shipped per **SCL-180 (PROPOSED)**. `exam-guardian-report-schema.ts:87,109` |
| GR-64 | Doc 04C inv #7 :122 | Guardian exam payload is a strict subset of the student payload. | Y | `toGuardianExamReport` builds from named fields and uses `.strict()` (`exam-guardian-report-schema.ts:155-225`) |
| GR-69 | Doc 04C §12.3 :944 | Guardian has no review access. | Y | `/api/tests/*` is `requireStudentOrAdmin` (`server/index.ts:683-702`) |
| GR-74 | Doc 05F §16 :762 | Guardian **receives**: days, blocks, facts, estimates, streak, target score, test date, projection. | Y | `packages/shared/src/calendar/api.ts:486-525` |
| GR-75 | Doc 05F §16 :764 | Guardian receives **no timezone**, study-day mask, daily minutes or planner mode. | **PARTIAL** | `guardianCalendarDaySchema` carries a per-day `timezone` (`packages/shared/src/calendar/read-model.ts:353,373`). G-AUD-24 |
| GR-85 | Doc 03 INV-03-05 :2150 | Zero guardian LISA access. | Y (code) / UNKNOWN (prod grants) | `server/index.ts:390-397`; G-AUD-12 |
| GR-89 | Doc 03B §1.3 :133-135 | A guardian JWT gets 403 `role_not_permitted` on tutor endpoints. | Y, **untested** | `supabase-auth.ts:837`. No test (G-AUD-16). |
| GR-102 | Doc 01 §36.3 :1710-1716 | Either party can revoke. Revocation is immediate. | Y | `guardian-routes.ts:457-578`; `student-resources.ts` DELETE `/links/:linkId` |
| GR-103 | Doc 01 §36.4 | On unlink, ask "keep or cancel the subscription?" | N | Deferred by comment (`guardian-routes.ts:452-455`). Billing, out of scope. |
| GR-104 | Doc 01 §36.5 | NOTIFY `entitlement_invalidate` on status change. | N | Deferred (`guardian-routes.ts:453-455`) |
| GR-108 | Doc 01 §40.7 | Guardian sees "Pending deletion" for the student. | UNKNOWN | No guardian-side rendering found |
| GR-109 | Doc 00 :265, :399 | 30-day data export on revocation. | N | Not present |
| GR-113 | Doc 01 §35 :1674 | `guardian_link_audit` records every status change. | Y (as a function) | `guardian_link_audit()` writes `audit_logs` (`20260828000000_guardian_link_audited_transitions.sql:48-63`) |
| GR-115 | Doc 04D :755-756 | `guardian_exam_report_requested/_returned` events. | N | No 04D emitter. Access is audited generically by `recordSubjectAccess` (`subject-access-audit.ts:113-150`). |
| GR-120 | Doc 01 §38.3 :1824 | Dashboard shows the student's entitlement tier and renewal date. | PARTIAL | Only `has_active_entitlement` / `entitlement_lapsed` flags (`guardian-routes.ts:241-248`) |

**Doc disagreements.** Line cites and both sides are quoted in the working notes; this is the summary.

- **DIS-01: which students grant premium.** Doc 01 §31.3 grants it if *any* linked student is premium. The 05B, 04C and 05F gates check each student.
- **DIS-02: skill-level mastery.** Doc 01 §38.1:1805, §38.3:1821, the Privacy Policy §6.2:362 and Doc 03D §11 (draft) all say "Skill-level mastery (yes)". Doc 05 §15.2, AC#19, 05A and 05B forbid it.
- **DIS-03: "Overall mastery score".** Doc 01 :1804 shows it to guardians. Doc 05 AC#20 and Doc 02C :180 allow only the level.
- **DIS-04: KPI counters and streaks.** Doc 05 AC#19 :822 forbids "KPI counters". Doc 05B §10 grants section, domain and overall KPIs, including streaks. SCL-074 is PROPOSED.
- **DIS-05: target score, a conflict inside Doc 05F.** Lines :86 and R-08-08 :104 say "no target score". R-08-22 :118, §16 :762 and SCL-173 say "do see". The first pair was never updated.
- **DIS-06: exam domain breakdown.** Doc 04 Q9 :88 excludes it. SCL-180 (PROPOSED) narrows Q9.
- **DIS-07: denial codes.**
  - Doc 04C: 403 for no link, 200 `unavailable` for a lapsed entitlement.
  - Doc 05B: 404 for no link.
  - Doc 05F: 404 for no link, 402 for lapsed.
  - Doc 04 §11.4 says entitlement failures "block".
- **DIS-08: gate table and predicate names.** Doc 01 uses `guardian_links`. Docs 05B/05C use `guardian_student_links` and `student_entitlements`. Doc 04C names two different predicate sets.
- **DIS-09: under-13.** Doc 01 §37 has a consent flow. Doc 00 :267 and the Privacy Policy :28 block under-13 at V1. SCL-051 records a third position.
- **DIS-10: number of guardians per minor.** Doc 00 requires one primary guardian per minor. Doc 01's unique key allows many.
- **DIS-11: revocation data export.** Doc 00 requires a 30-day export on revocation. Doc 01 does not.
- **DIS-12: who initiates a link.** Doc 01 §16 :792 gives the student no initiate right, yet §36.1 has a student-initiated path.
- **DIS-13: INV-03-05 exceptions.** INV-03-05 is absolute. Doc 03B §15.10.5 :2242 implies guardians see tutor-usage aggregates. Doc 03 :1828 is a stale line. Doc 00 W-00-01 carves out safety excerpts.
- **DIS-15: `timing_condition` vs `mode`.** Doc 04 Q9 names `timing_condition`; Doc 04C uses `mode`.
- **DIS-18: stale SCL references in Doc 05F.** :957-958 cite SCL-167/168, which the register renumbered to SCL-171/172.

---

## 3. Repo inventory (§4.2)

### 3.1 API endpoints a guardian can call

Chain notation: AUTH = `requireSupabaseAuth`, CSRF = `doubleCsrfProtection`, GR = `requireGuardianRole` (admits **guardian and admin**, `server/middleware/guardian-role.ts:20`), RS = `resolveSubject`, EG = `entitlementGate`.

| Method + path | Chain | Handler file:line | DB call (key) |
|---|---|---|---|
| GET `/api/guardian/students` | AUTH, CSRF (`index.ts:610-615`), AUTH, GR | `guardian-routes.ts:98-254` | `getAllGuardianStudentLinks` + `profiles` select `id,email,display_name,created_at` (service role), then per-student `EntitlementService.isEntitlementActiveForProfile` + `getEntitlementForProfile` |
| POST `/api/guardian/link/redeem` | AUTH, CSRF, AUTH, GR, `guardianLinkCodeEntryRateLimit` | `guardian-routes.ts:285-437` | `redeemStudentLinkCode` (conditional UPDATE, `student-link-code.ts:135-144`) → `recordLegalAcceptances` → RPC `create_active_guardian_link_audited` (`account.ts:245`) |
| DELETE `/api/guardian/link/:studentId` | AUTH, CSRF, AUTH, GR | `guardian-routes.ts:457-578` | `getAnyGuardianLinkForPair` → RPC `revoke_guardian_link_audited` (`account.ts:270`) |
| GET `/api/students/:studentId/mastery/domains` | AUTH, CSRF (`index.ts:448-453`), RS, EG(`mastery_detail`) | `student-resources.ts` | `mastery-read.ts:103-104` `student_domain_mastery` (service role) |
| GET `/api/students/:studentId/mastery/skills` | RS, EG(`mastery_detail`) | `student-resources.ts` | none for a guardian (`[]`) |
| GET `/api/students/:studentId/kpi/sections` | RS | `student-resources.ts` `resource()` | `kpi-rollup-read.ts:67-68` (`getSupabaseAdmin`) |
| GET `/api/students/:studentId/kpi/domains` | RS | same | `kpi-rollup-read.ts:97-98` |
| GET `/api/students/:studentId/kpi/overall` | RS | same | `canonical-runtime-views.ts:252-254` `student_overall_kpi` |
| GET `/api/students/:studentId/projections/sections` | RS | same | `projection-read.ts:49-51` |
| GET `/api/students/:studentId/projections/snapshots` | RS | same | `projection-read.ts:80-82` |
| GET `/api/students/:studentId/calendar` | RS, EG(`calendar_access`) | `student-resources.ts` | `readGuardianCalendar` (`server/services/calendar/read-service.ts:749-835`) |
| GET `/api/students/:studentId/tests` | RS, EG(`exam_full_length`) | `student-resources.ts` (G1) | RPC `exam_list_forms` (service role) → `toGuardianExamList` |
| GET `/api/students/:studentId/tests/:sessionId/report` | RS, EG, then Zod parse of `sessionId` | `student-resources.ts` (G1) | RPC `exam_report_source` + `exam_domain_breakdown` (`exam-report-service.ts:377,406`) → `toGuardianExamReport` |
| GET/PATCH `/api/profile`; notifications; `/api/billing/*`; `/api/account/*`; `/api/legal/*` | AUTH, CSRF | various | caller's own rows only |

### 3.2 Middleware, authz and DB helpers

| Helper | file:line | Callers |
|---|---|---|
| `requireGuardianRole` | `server/middleware/guardian-role.ts:13-30` | `guardian-routes.ts:45` (3 routes) |
| `resolveSubject`, `sendNotFound` | `server/middleware/subject-resolver.ts:83-163`, `:75` | every `/api/students/:id/*` route; `guardian-routes.ts:482` |
| `resolveGuardianViewDecision` | `server/services/guardian-subject.ts:37-83` | `subject-resolver.ts:115` |
| `recordSubjectAccess` | `server/services/subject-access-audit.ts:113-150` | `subject-resolver.ts:123` |
| `requireStudentOrAdmin` (blocks guardians) | `supabase-auth.ts:889-896` | all learning-state mounts |
| `requireStudentOnly` | `supabase-auth.ts:828-837` | `/api/tutor` (`index.ts:394`) |
| rate limiters | `server/middleware/guardian-link-rate-limit.ts:60,66,102` | redeem, regenerate, invite |
| `createActiveGuardianLink` / `revokeGuardianLink` / `getAllGuardianStudentLinks` / `getAnyGuardianLinkForPair` | `server/lib/account.ts:240-288` and nearby | guardian-routes, student-resources |
| **Never called:** `requireRequestAuthContext` (`supabase-auth.ts:247`), `getSupabaseAnon` (`:950`) | | 0 callers |

### 3.3 RPCs and SQL objects

- **Gate:** `guardian_view_decision`. Only the server calls it.
- **RLS wrapper:** `guardian_can_view_student` (`auth.uid()`). It has no application caller, because the app reads with the service role.
- **Link writers:** `create_active_guardian_link_audited` and `revoke_guardian_link_audited`, which call `guardian_link_audit`.
- **Exam:** `exam_list_forms`, `exam_report_source` and `exam_domain_breakdown` (main only).
- **Entitlement:** `entitlement_active`.

### 3.4 Zod schemas (`packages/shared/src`)

- **Gate and linking:**
  - `guardian-subject.ts` (`guardianViewDecisionSchema`, `subjectSchema`, `studentIdParamSchema`)
  - `guardian-link-schema.ts`
  - `student-link-code-schema.ts` (`redeemLinkCodeRequestSchema`, `inviteGuardianRequestSchema`)
- **Paths:** `student-resources.ts` (`STUDENT_RESOURCE_PATHS`, `STUDENT_EXAM_PATHS`, `STUDENT_LINK_PATHS`)
- **Exam:** `exam-guardian-report-schema.ts` (six `.strict()` states, list and envelopes)
- **Calendar:** `calendar/api.ts:442-550` (guardian calendar) and `calendar/read-model.ts:338-392`, `calendar/plan.ts:129-180` (guardian day and block)
- **Guardian students:** `guardianStudentsResponseSchema`, used by `client/src/hooks/useGuardianStudents.ts:60`
- **Missing:** no shared schema exists for the `kpi/overall` response or for `/api/billing/status` (G-AUD-09, G-AUD-26).

### 3.5 Client

| Item | file:line |
|---|---|
| Route `/guardian` | `client/src/App.tsx:347-354` (`RequireRole ["guardian","admin"]`) |
| Route `/students/:studentId/calendar` | `App.tsx:224-230` |
| Routes `/students/:studentId/tests[/:sessionId]` | `App.tsx:237-252` |
| Shared routes `/profile`, `/profile/complete`, `/update-password`, `/notifications` | `App.tsx:293-325` |
| Guardian redirect from every student route | `RequireRole.tsx:100-108` |
| Unknown role counts as `student` (fail-open) | `RequireRole.tsx:91-95` |
| Pages | `pages/guardian-dashboard.tsx`, `pages/guardian-student-calendar.tsx`, `features/exam/pages/GuardianExamResultsPage.tsx` |
| Guardian components | `components/guardian/{CheckoutReturnPoller,GuardianPurchaseCard,ManageSubscriptionButton,GuardianTemplatePreview,GuardianMetricTile}.tsx`; `components/layout/GuardianShell.tsx` |
| Hooks and keys | `useGuardianStudents` `["guardian-students"]`; summary `["guardian-student-summary", id]` (`guardian-dashboard.tsx:147`); mastery `[<url with id>]` (`:192`); `["guardian-billing-status"]` (`:211`); calendar `["calendar","guardian",id,from,to]`; exam `["exam","guardian",id,...]` |
| Role branches in shared components | `components/navigation.tsx:59,77-84,160-165` (**no importer found; dead**); `pages/notifications.tsx:56-61` (shell by role); `UserProfile.tsx:167,733-771` |

### 3.6 Tests

Real-Postgres suites that can fail:
- `tests/ci/guardian-link-code.pg.ci.test.ts`
- `guardian-unlinked.pg.ci.test.ts`
- `guardian-invite.pg.ci.test.ts`
- `guardian-exam-results.handler-pg.ci.test.ts` (main only; pins no write routes at :385-411)
- `guardian-premium-fold.contract.test.ts`
- `client/src/pages/guardian-dashboard.calendar-link.pg.ci.test.tsx` (partially)

Mock-based suites: `subject-resolver.contract`, `student-resources.contract`, `guardian-reporting.contract`, `guardian.anti-leak.ci`, `mutation-ownership.contract`, `GuardianExamResultsPage.test`, `guardian-readonly.tree.test`, `useGuardianStudents.test`, `GuardianPurchaseCard.test`, `GuardianCta.test`.

Weak or unfailable tests: G-AUD-15.

---

## 4. Derivation traces (§4.3)

**The same gate applies to every trace.** It fires at `subject-resolver.ts:115-144`: `resolveGuardianViewDecision(user.id, studentId)` calls the RPC `guardian_view_decision`. The SQL body quoted below comes from `20260827000000_guardian_view_decision.sql:91-108`:

```sql
WHEN NOT EXISTS (SELECT 1 FROM public.guardian_links gl WHERE gl.guardian_profile_id = p_guardian_id
      AND gl.student_profile_id = p_student_id AND gl.status = 'active') THEN 'not_linked'
WHEN NOT public.entitlement_active(p_student_id) THEN 'student_unentitled'
ELSE 'allow'
```

- **Q1 (gate location).** The gate is enforced **in the DB function, invoked by the server**. RLS does not enforce it on these paths, for two reasons:
  - Every read below uses the **service role**: `supabaseServer`/`getSupabaseAdmin`, which bypasses RLS.
  - The six guardian RLS policies (§2 of the brief) exist but sit on no guardian code path. They are defence-in-depth for a future `authenticated` client (see the comment at `student-resources.ts`, `/mastery/skills` block).
- **Fails closed** on an RPC error or an unrecognised value (`guardian-subject.ts:51-80`), and on a failed audit write (`subject-resolver.ts:152-159`).
- **`entitlement_active` is status-only** (`20260616120000_entitlement_active_include_trialing.sql:12-18`: `status IN ('active','past_due','trialing')`). It never checks the period end. This is out of scope (Stripe); noted only.
- **Q2 (key).** Every read uses `service_role`. The server check that stands in for RLS is `resolveSubject` plus `entitlementGate`.

### 4.1 Mastery (domain) and KPIs

**Path.**
1. `guardian-dashboard.tsx:186-195` calls `fetchMasteryDomains` (`lib/masteryApi.ts:73-80`).
2. That calls GET `/api/students/:id/mastery/domains`.
3. The request passes RS, then EG(`mastery_detail`, via `EntitlementService.canAccessFeature`).
4. `readDomainMasteryView` reads `student_domain_mastery` (`mastery-read.ts:103-104`).

**KPIs.**
1. `guardian-dashboard.tsx:146-173` calls GET `/api/students/:id/kpi/overall`.
2. The request passes RS only. It needs no feature key (`requiresEntitlement` is `null`).
3. `buildStudentKpiViewFromCanonical` reads `student_overall_kpi` (`canonical-runtime-views.ts:246-330`).
4. The routes `kpi/sections` and `kpi/domains` are also reachable. No guardian UI calls them.

**Q3: fields that leave the server, compared with the rulings.**

| Field | Leaves server | Rendered to guardian | Ruling / spec |
|---|---|---|---|
| `domains[].section, domain, levelKey, level, displayName` | yes (`mastery-read.ts:168-173`) | yes (`guardian-dashboard.tsx:1005-1027`) | ruling (a) OK; Doc 05 AC#20 OK |
| skills | `[]` for guardian | no | OK |
| `metrics[current_streak]` / `current_streak_days` | yes (`canonical-runtime-views.ts:272,279-285`; `kpi-rollup-read.ts:68`) | **yes, "Day Streak" tile** (`guardian-dashboard.tsx:889-893`) | **ruling (c) no streaks: conflicts.** Spec (05B §6.5) allows it, so this is an SCL candidate. |
| `week.questionsSolved`, `metrics[week_questions]` | yes | yes, tile (`:894-898`) | raw count. The brief lists "event counts" as overexposure. Spec 05B allows it and Doc 05 AC#19 forbids it (DIS-04 / SCL-074). |
| `week.accuracy`, `metrics[week_accuracy]` | yes | yes, tile (`:899-907`) | raw accuracy, same as above |
| `recency{totalAttempts, accuracy}` (30d, paid only) | yes | no | same |
| `events_total, accuracy_overall, last_active_at` (kpi/sections, kpi/domains) | yes | not called by UI | same |

**Q4 (client vs server drift).**
- **Unparsed response with a phantom type (G-AUD-09).** The client casts the response to an inline `StudentSummary` (`guardian-dashboard.tsx:64-84`) that requires `student` and `progress`. The server never sends either. The UI reads only `metrics`, so nothing crashes today. The response is never parsed.
- **Label mismatch.** The tile says "Questions Attempted (7d)" (`:895`); the server's label is "Questions Solved (7d)" (`canonical-runtime-views.ts:175-181`). Both render on screen.

**Q5 (code vs schema).**
- The code references `student_domain_mastery.mastery_level` and `student_overall_kpi.events_last_7d/accuracy_last_7d/current_streak_days`.
- The columns exist in `20260613010000_05b_domain_mastery_kpi.sql`, according to the repo.
- Production is UNKNOWN; Appendix A.6 checks it.

### 4.2 Projections

- **Server.** GET `/api/students/:id/projections/sections|snapshots` passes RS, then reads `projection-read.ts:49-51,80-82`. Fields: `section, projectedScoreMid/Low/High, relevantQuestionCount, computedAt | snapshotAt, snapshotKind`.
- **Where it renders.** **Only on the guardian calendar header** (`guardian-student-calendar.tsx:116`), carried as `projection` inside the calendar payload (`calendar/api.ts:511`, read in `read-service.ts:787-814`). No guardian dashboard component calls the projections routes (client inventory §2.1). The routes are still reachable by a guardian with a token.
- **Q3.** `relevantQuestionCount` is a count. The band matches ruling (f) "in the calendar context". The standalone routes and snapshot history are served outside it (SCL candidate SC-6).

### 4.3 Calendar

**Path.**
1. `guardian-student-calendar.tsx` calls `useGuardianCalendar` (`features/calendar/api/queries.ts:168-182`, key `["calendar","guardian",id,from,to]`).
2. That calls GET `/api/students/:id/calendar?from&to` (`features/calendar/api/client.ts:189-203`).
3. The request passes RS, then EG(`calendar_access`).
4. `readGuardianCalendar` (`read-service.ts:749-835`) reads the calendar tables with the service role.
5. The response is parsed through `guardianCalendarResponseSchema` (`.strict()`).

The calendar tables have no guardian RLS policy, which is intended (`20260917130000_calendar_v1.sql:541-544`; CI gate S-06). This matches the owner's production observation in brief §2.

**Q3: fields that leave the server** (`calendar/api.ts:486-525`, `read-model.ts:350-392`, `plan.ts:147-180`).

| Field | Rendered | Ruling / spec |
|---|---|---|
| `days[]{local_date, **timezone**, is_study_day, status, blocks[{block{block_id,block_type,section,scope{domain,count},target_count,...},actual,progress,status}], extra_work, planned/actual/extra_count}` | yes | Spec 05F §16 :764 says "no timezone": **G-AUD-24**. Domain-level scope OK. |
| `facts{blocks_*, questions_completed, full_lengths_completed, extra_questions}` | yes | Spec 05F §14 OK. The closest thing to "sessions completed" (ruling d) is `blocks_completed` / `full_lengths_completed`. |
| `estimates{practice_seconds_per_unit, review_seconds_per_unit}` | yes ("~N min") | ruling (c) "no study time": **ambiguous**. These are planned minutes, not measured ones. |
| `streak{current, longest, history_complete}` | yes (`guardian-student-calendar.tsx:117`) | **ruling (c) conflict**; spec 05F §16 allows it |
| `target_score`, `target_exam_date` | yes (`:111-112`) | **ruling (e) conflict**; spec 05F §16 / SCL-173 (owner ruling 2026-09-26) allows it |
| `projection[]` | yes (`:116`) | ruling (f) OK |

**Q4 (drift).** Stale comment: `queries.ts:163-165` says "no target score". The client consumes the shared strict schema, so there is no shape drift.

**Q5.** The calendar tables are in `20260917130000_calendar_v1.sql`. Production is UNKNOWN; Appendix A.6 checks it.

### 4.4 Full-length exam results (main only, G1)

**Path.**
1. `GuardianExamResultsPage.tsx:149-153 / :217-221` calls `fetchGuardianExamList` / `fetchGuardianExamReport` (`features/exam/api/exam-api.ts:154-164`, hand-built URLs rather than `STUDENT_EXAM_PATHS`).
2. That calls GET `/api/students/:id/tests[/:sessionId/report]`.
3. The request passes RS, then EG(`exam_full_length`), then a Zod parse of `sessionId`. *The entitlement check runs before the Zod parse. That matches the order in coding standards §8.1, but it answers 402 before 400: G-AUD-31.*
4. `readExamReport(studentId, sessionId, …)` calls RPC `exam_report_source(p_student_id, p_session_id)`, whose ownership check is `test_sessions.student_id = p_student_id` (`20260930090000_exam_shell_server.sql:467-471`). On success it also calls `exam_domain_breakdown` with the same check (`20261010000000_exam_domain_breakdown.sql:55-59`).
5. A 403 from the RPC becomes the resolver's 404 (`sendNotFound`).
6. The payload passes through `toGuardianExamReport` (`.strict()`).

**Cross-student check.** Guardian A, linked to student S1, who passes S1 in the path and a session id belonging to S2, gets `exam_report_source(S1, sid_S2)`. That returns 403, which the route turns into a 404. This is covered by `guardian-exam-results.handler-pg.ci.test.ts` (per the server-trace notes). There is **no DB-level guardian check**: the RPCs trust the path student id the server passes (by design, `20261010:37-39`).

**Q3: fields** (`exam-guardian-report-schema.ts:42-138`).
- **Scored state:** `session_id, test_form_id, test_form_name, mode, completed_at, attempt_number_for_form, is_first_seen_form_attempt, score{total_scaled, rw_scaled, math_scaled}, domain_breakdown[{section, domain, correct, total}], disclosure`.
- **Partial state:** adds `completed_sections, incomplete_sections, partial_disclosure`.
- **Absent by construction:** answers, explanations, skills, modules, routing, `score_run_id`, review flags.
- **Ruling (b).** Headline plus per-domain is met. **Open question:** per-domain `correct`/`total` are raw counts per domain. Whether "per-domain breakdown" includes raw counts is Q-3 for Karl. The page comment `GuardianExamResultsPage.tsx:17-18` says "raw-count" is absent, which is ambiguous.

**Q4.** The client parses with the shared envelope schemas. Voided sessions: the list labels `voided: "Unavailable"` (`:62`), but the report union has no voided member. What the server returns for one is UNKNOWN; in the student serializer, `serializeStudentReport` throws `ReportIntegrityError` for `voided` (`exam-report-service.ts`, "voided is MVP-reserved"), which would give a 500.

**Q5.** The `exam_domain_breakdown` function is live, per the Vercel deploy of `d073eb3`. Whether its **migration** is applied in the production DB is UNKNOWN; Appendix A.1 and A.7 check it.

### 4.5 Linked-student list and switcher

**Path.**
1. `useGuardianStudents` (`["guardian-students"]`) calls GET `/api/guardian/students`.
2. The request passes AUTH and GR.
3. `getAllGuardianStudentLinks(guardianId)` reads active links (service role), then `profiles` rows `.in("id", ids).eq("role","student")` (`guardian-routes.ts:108-124`).
4. Each student is checked for entitlement (`:177-233`).

- **Fields out:** `id, email, display_name, created_at, has_active_entitlement, entitlement_lapsed`.
- **The gate here is the link only.** The entitlement is only reported, not required, which is correct: the roster must list lapsed students so the guardian can pay.
- **Switcher.** `selectedStudentId` lives in `useState(null)` (`guardian-dashboard.tsx:125`). Per-student query keys include the id. There is no `placeholderData`.
- **Risks** (G-AUD-01, G-AUD-19):
  - Sign-out keeps the cache.
  - The roster is never refetched on 404 or after a purchase.
  - After an unlink, the removed student's panels may stay on screen (depends on Radix behaviour; unverified).

---

## 5. Invariant table (§4.4)

| Invariant | Enforcing code / policy | Proof (expected or run) | Status |
|---|---|---|---|
| **Read-only:** no guardian path writes student learning state | `requireStudentOrAdmin` on `/api/practice*`, `/api/review`, `/api/tests*`, `/api/calendar`, `/api/me`, `/api/progress/*`, `/api/questions/*` (`server/index.ts:460-702`; check `supabase-auth.ts:896`). `requireStudentOnly` on `/api/tutor` (`:390-397`). Every write under `/api/students/:id/*` refuses `via !== 'self'` (`student-resources.ts` link-code/regenerate/invite/revoke). No SQL function or policy grants guardians write access (repo scan, Appendix A.3/A.4). | Existing: `auth-surface.contract.test.ts:148`; `runtime-law-lockdown.ci.test.ts:82,100` (practice and diagnostic only); `guardian-exam-results.handler-pg` :385-411 (no write routes). **Missing:** a route-table sweep asserting 403 for a guardian on every mutating mount (G-AUD-16). | HOLDS (code). Not fully tested. |
| Guardian-reachable mutations (full list) | redeem and revoke own link; own profile PATCH; own notifications (`mark-all-seen`, `mark-all-read`, PATCH `:id`); billing checkout (only for linked students, `billing-routes.ts:254`) and portal; legal acceptance; own account deletion; sign-out. Harmless write: GET or regenerate `/api/students/<own id>/link-code` writes a code onto the guardian's own profile (it cannot be redeemed, because the redeem filter is `role='student'`). | as listed | OK |
| **Revoked link means no data** | `guardian_view_decision` requires `status='active'` (applies to mastery, KPI, projections, calendar and exam). The roster reads active links only. | `guardian-unlinked.pg.ci.test.ts`; `guardian-exam-results.handler-pg` ("revoked → 404"); `subject-resolver.contract.test.ts` (`not_linked` → 404). Expected: after DELETE, the five traces answer 404. | HOLDS (code + schema). **UI:** a revoked student shows a generic retry error on the dashboard and calendar (G-AUD-06). |
| **Lapsed entitlement means no data** | `guardian_view_decision` returns `student_unentitled`, which becomes 402 (`subject-resolver.ts:132-141`). EG applies feature keys. The roster still lists the student (by design). | `subject-resolver.contract.test.ts`; `guardian-exam-results.handler-pg` (402). **UI:** dashboard shows a named prompt "\<Name\>'s subscription ended" (`guardian-dashboard.tsx:832-871`). Calendar shows a generic prompt addressed to the student ("your study calendar", G-AUD-20). Exam page shows "Subscription needed" with no call to action. | HOLDS. UI inconsistent. |
| **Cross-guardian isolation** (including a direct student id) | The gate is keyed on `(auth user id, path studentId)`. The user id comes from the server session (`supabase-auth.ts:486-571`). An unrelated caller gets an identical 404. Exam sessions are bound to the path student in SQL. | `subject-resolver.contract.test.ts` (non-enumerable); PG suites. Expected: guardian B calling `/api/students/<A's student>/*` gets 404 for every resource. | HOLDS on the server. **Client:** G-AUD-01 (a cache flash after sign-out on a shared tab). |
| **Zero LISA access** | `/api/tutor` uses `requireStudentOnly` (`index.ts:390-397`). No guardian UI imports tutor code. INV-03-05. | **No test asserts a guardian gets 403 on `/api/tutor/*`** (G-AUD-16). Prod: Appendix A.4 (tutor table grants, given the policies with no `TO` clause, G-AUD-12). | HOLDS (code). UNTESTED. Prod UNKNOWN. |
| **Consent and link cannot be forged** | Link: 6-character code from `crypto.randomInt` (31^6 ≈ 8.9e8). A single conditional UPDATE spends and rotates the code, filtered `role='student'` and within the TTL (`student-link-code.ts:135-144`). The student id comes from the matched row. One refusal code for every failure. 10 attempts per day per guardian profile. The RPC is service-role only (`20261001000000_security_definer_revoke_public.sql:59-62`). **Admin caveat:** admins pass GR, and neither the RPC nor the gate checks the role (G-AUD-05). Consent (under-13): dead (G-AUD-03) and bypassable (G-AUD-02). | `guardian-link-code.pg.ci.test.ts` (spent code, race, own code, 409). Residual: the rate limit is per profile, not per IP. | Link: HOLDS (with the admin caveat). Consent: **BROKEN.** |
| Past exposure of the link writer | `create_active_guardian_link_audited` was PUBLIC-executable in production until a manual REVOKE on 2026-09-23 (`20261001000000…:25-37`). | Appendix A.5: forensic query over links created before 2026-09-24. | UNKNOWN (owner-run) |
| **Multi-student: no bleed between students** | Per-student keys include the id. No `placeholderData`. The server gates each id separately. | Missing: a client test that switches students (G-AUD-17). | HOLDS for switching. Sign-out and unlink residuals: G-AUD-01, G-AUD-19. |

---

## 6. Findings

Layer codes: **C** = code, **S** = schema (repo migrations), **P** = production DB, **D** = deploy, **UI** = client.

| ID | Sev | Layer | Where | Evidence | Proposed closure-plan row: named proof |
|---|---|---|---|---|---|
| G-AUD-01 | HIGH | UI | `client/src/contexts/SupabaseAuthContext.tsx:363-384` (`queryClient.invalidateQueries()`); `lib/queryClient.ts:125-135` (`staleTime: Infinity`); `components/layout/HeaderUserMenu.tsx:43-58` (in-app `navigate("/login")`); `login.tsx:59` | Sign-out keeps cached data. `["guardian-students"]` and the billing keys are not scoped per user. After an in-app sign-in, the dashboard mounts against the previous account's cached roster (and any cached per-student panel the new user clicks) until the refetch lands. `queryClient.clear()` runs only in `UserProfile.tsx:150`. **Not reproduced at runtime.** | Clear the cache on sign-out and on user change. **Proof:** an RTL test where guardian A signs in and loads the roster, signs out, guardian B signs in, and the test asserts no element with A's student name renders before B's fetch resolves. |
| G-AUD-02 | HIGH | C | `server/routes/profile-routes.ts:259-303` (only role changes are locked), `:320-323` (recomputes `isUnder13`), `:407-424` (writes `date_of_birth`, `is_under_13`, `profile_completed_at`) | A student can PATCH an adult date of birth at any time. That flips `is_under_13` (trigger `profiles_set_age`), which skips guardian consent and passes the LISA age gate (`supabase-auth.ts:861`). *Adjacent to the guardian vertical: it defeats the guardian-consent control.* Not in `KNOWN-GAPS.md`. | Lock the date of birth after completion. **Proof:** a PG test where an under-13 profile PATCHes an adult DOB, expects 403 or 409, and asserts `is_under_13` is unchanged. |
| G-AUD-03 | HIGH | C+S | `profile-routes.ts:341-348,369-376` vs genesis `guardian_consent_requests` (`00000000000000_genesis.sql:267-278`); `server/lib/notifications/direct-sends.ts:103`; `server/index.ts:421` (comment with no mount) | The under-13 consent flow is dead. The code writes `child_id`/`expires_at`, but the table has `student_profile_id`/`consent_token`/`consent_token_expires_at`. There is no verify route, and the email links to a page that exists nowhere. `guardian_consent` can never become true. Already recorded as P0 `CONSENT-FLOW-SCHEMA-MISMATCH` in `docs/alignment/KNOWN-GAPS.md:684`. The spec position is itself disputed (DIS-09). | Needs Karl's ruling on DIS-09 first. **Proof:** a PG round-trip (request, then verify, then `guardian_consent=true`, then an active link), or removal of the dead path. |
| G-AUD-04 | HIGH | C+UI | `client/src/pages/profile-complete.tsx:330-344` offers "Guardian"; `profile-routes.ts:259-265` returns 403 on any role change; `server/routes/supabase-auth-routes.ts:150` hardcodes `role: "student"`; OAuth creates students (`handle_new_user` trigger `20260619000000_handle_new_user_trigger.sql:74`) | **No product path creates a guardian.** Every account the BFF or OAuth creates is a student, and choosing "Guardian" at profile-complete is refused. Guardians exist in production (per the brief; SCL-080 cites 14), so they were provisioned some other way (UNKNOWN: direct `auth.signUp` with metadata, or owner SQL). | Q-5. **Proof:** an e2e sign-up-as-guardian test that reaches `/guardian`. |
| G-AUD-05 | MEDIUM | C+S | `server/middleware/guardian-role.ts:20` admits `admin`; `guardian-routes.ts:285-289`; `create_active_guardian_link_audited` (`20260903000000_notifications_rebuild.sql:578-638`) has no role check; `guardian_view_decision` has no viewer-role term | An admin holding a student's code can redeem it, become linked, and read that student through `/api/students/:id/*`. This contradicts `subject-resolver.ts:37-46` ("NO ADMIN BYPASS") and SCL-078. It still requires the student's own code. | Q-6. **Proof:** a PG test where an admin redeems a live code and gets 403, with no link row created. |
| G-AUD-06 | MEDIUM | UI | `guardian-dashboard.tsx:872-879,984-991`; `features/calendar` `CalendarError` (`CalendarStates.tsx:65-97`) | For a revoked or unlinked student, the server correctly returns 404. The dashboard and calendar have no 404 branch: they show "We couldn't load…" with a retry that cannot succeed, and the roster is not refetched (the revoked student stays listed). The exam page handles 404 correctly (`GuardianExamResultsPage.tsx:105-106`). | **Proof:** an RTL test for a 404 on summary, mastery and calendar that shows "no longer linked" copy, shows no retry, and invalidates `["guardian-students"]`. |
| G-AUD-07 | MEDIUM | C+S | `server/routes/guardian-routes.ts:54-78` | Silent failure. `emitGuardianAccessEvent` inserts into `system_event_logs`, which no migration or the genesis snapshot creates (`grep` finds none). The `{error}` result is never read, and `catch { // Best effort only. }` is empty. `guardian_report_viewed` and `guardian_access_denied` are declared but never emitted. Violates the no-silent-catch hard stop. | Remove it or point it at `audit_logs`. **Proof:** a test asserting the dashboard-view audit row exists in real PG. Also fix the test in G-AUD-15c. |
| G-AUD-08 | MEDIUM | C | `guardian-routes.ts:419-435` (`throw err` in an async Express 4 handler; `express ^4.22.1`); `:422-424` `err instanceof GuardianLinkError` | Any non-LY004 error from `createActiveGuardianLink` becomes an unhandled rejection, and **no response is sent**, so the request hangs. The `instanceof` check contradicts the same file's `errorCode()` rationale (`:80-96`): under module duplication a 409 turns into a hang. `:308,:319` are also unguarded. | **Proof:** a handler test where the RPC throws a non-contract error and the response is 500 within the timeout, plus a test where the error mock is a different class instance with `code: LY004` and the response is 409. |
| G-AUD-09 | MEDIUM | UI | `guardian-dashboard.tsx:64-84,170` | Client vs server drift. The `kpi/overall` response is cast without parsing to an inline `StudentSummary` that requires `student` and `progress`. The producer (`canonical-runtime-views.ts:246-330`) sends neither. There is no shared schema for this response (CLAUDE.md "never re-declare inline"). | Shared Zod schema for `kpi/overall`. **Proof:** a round-trip test that sends the real `buildStudentKpiViewFromCanonical` output through the client parser. |
| G-AUD-10 | MEDIUM | S | `revoke_guardian_link_audited` (`20260915000000_guardian_unlinked_event.sql:54-127`); grants `20260828000000…:231-239`, `20260827000000…:154-158` | The revoke function does not check that `p_revoked_by` is a party to the link. The two-argument functions, `guardian_link_audit` and `revoke_…` revoke EXECUTE only `FROM PUBLIC`, so they are safe only while production default ACLs give nothing to anon or authenticated. That exact gap exposed `create_active_…` until 2026-09-23. | Explicit `REVOKE … FROM anon, authenticated`. **Proof:** Appendix A.2 returns f/f/f/t, and a `secdef-exposure.sql` gate runs against production. |
| G-AUD-11 | MEDIUM | S | `scripts/ci/guardian-view-decision-gate.sql:123-144` (GATE 10/11) | No CI pin on the gate's body. Dropping `AND gl.status = 'active'` from `guardian_view_decision` would pass CI. **Correction (2026-09-29, G1-08):** that specific mutation does NOT pass CI: GATE 6 (a revoked link must be `not_linked`) reddens it. The real gap is a body change the fixtures never exercise, such as a one-id backdoor, which passed every gate until the GATE 0 pin. | Add an md5 body gate modelled on calendar B-01/B-02. **Proof:** a mutation that deletes the status predicate and turns the gate red. |
| G-AUD-12 | MEDIUM | S/P | `20260805000000_ws_l0_3_tutor_runtime_schema.sql:119,122,191` | The tutor INSERT/UPDATE policies have no `TO` clause (so they apply to PUBLIC) and only check `student_id = auth.uid()`. They are inert in the repo because no grant exists. If production grants `authenticated` write privileges on the tutor tables, a guardian could write a self-keyed tutor row (INV-03-05). | **Proof:** Appendix A.4 shows `tutor_*` ins/upd = false for authenticated. Add `TO` clauses. |
| G-AUD-13 | MEDIUM | S | `create_active_guardian_link_audited`; `student-link-code.ts:135-144` vs `guardian-routes.ts:401` | Spending the code and inserting the link run in separate transactions, so a failed insert (for example LY004) still burns the code. The SQL checks no roles or deleted status on either party. | **Proof:** a PG test with a pre-existing active link: redeem returns 409 and the code is not consumed (or document the burn as intended). |
| G-AUD-14 | MEDIUM | UI | `features/calendar` gate (`CalendarStates.tsx:100-108`, copy in `lib/billing-cta.ts:140-146`) | A guardian on a lapsed student's calendar sees "Your guardian view of your study calendar…", which is addressed to the wrong person and doesn't name the student. The exam 402 screen has no call to action. The dashboard uses the named, guardian-specific state. | Part of the redesign. **Proof:** RTL copy assertions for the 402 state on all three guardian pages. |
| G-AUD-15 | MEDIUM | C (tests) | (a) `tests/integration/protected-routes.integration.test.ts:82-114`; (b) `server/__tests__/guardian-payment-access.test.ts:14-18`; (c) `tests/ci/guardian-reporting.contract.test.ts:448-474`; (d) `tests/ci/guardian.anti-leak.ci.test.ts:147,353,363-369`; (e) `client/src/hooks/useGuardianStudents.test.ts:40-47`; (f) `client/src/pages/guardian-dashboard.calendar-link.pg.ci.test.tsx:79-93,151` | These tests cannot fail, or pass for the wrong reason: (a) 5 bodies are `expect(true).toBe(true)`, including "should enforce guardian consent"; (b) the mock returns the asserted verdict; (c) it asserts an insert into a table that doesn't exist; (d) its fixture uses a nonexistent column `student_user_id` and has no presence check before the absence walk; (e) it asserts the value the mock returned; (f) the rows skip the schema and lack the required `created_at`. Also, `vi.mock` targets modules that don't exist: `server/middleware/guardian-entitlement`, `server/lib/durable-rate-limiter`, `isGuardianLinkedToStudent`. | **Proof:** each rewritten test goes red under a mutation of its target. Fixtures are derived from real output (CLAUDE.md "test layer"). |
| G-AUD-16 | LOW | C (tests) | none | Missing denial tests: guardian → 403 on `/api/tutor/*` (INV-03-05); a route-table sweep of guardian 403 on every `requireStudentOrAdmin` mount (only practice and diagnostic are regex-pinned); DOB rewrite; admin redeem. | A parametrised mount sweep plus a tutor test. |
| G-AUD-17 | LOW | UI (tests) | client | Not tested: dashboard KPI and mastery panels, dashboard 402 prompt, 404 handling, student switching, unlink, poller timeout, the admin redirect at `/guardian`, and the pages without a shell. | Named RTL tests per state (§7). |
| G-AUD-18 | LOW | C | `guardian-routes.ts:562-570` | After a revoke, the roster re-read ignores `{error}`, so it can return 200 with an empty list. | **Proof:** a unit test where a profiles error produces a 500. |
| G-AUD-19 | LOW | UI | `guardian-dashboard.tsx:285-287,1036,1051` | After an unlink, the removed student's panels may stay rendered if the dialog clears `unlinkStudentId` before `onSuccess` runs. Depends on Radix; **unverified.** | **Proof:** an RTL test where unlinking the selected student removes its panels. |
| G-AUD-20 | LOW | UI | `guardian-student-calendar.tsx`; `GuardianExamResultsPage.tsx:65-97` | The calendar and exam pages have no `GuardianShell` (no bell, no user menu, no sign-out). The calendar's gate, error and not-set-up screens have no link back to `/guardian`. | Redesign input. |
| G-AUD-21 | LOW | UI | `packages/shared/src/return-path.ts:24-45` | `/students` is missing from the return-path allowlist, so a signed-out guardian following a calendar or tests link lands on `/guardian`. | **Proof:** a return-path unit test. |
| G-AUD-22 | LOW | UI | `guardian-dashboard.tsx:257-259` | Substring match on a structured value: rate limiting is detected with `err.message.includes("Too many")`, because the redeem mutation throws a bare `Error` (`:239-242`) and loses the 429 status and code. | **Proof:** a test where a 429 from redeem shows the rate-limit copy. |
| G-AUD-23 | LOW | C+UI | `client/src/components/auth/RequireRole.tsx:91-95`; `server/lib/auth-role.ts:14` + `profile-bootstrap.ts:84-93` | An unknown or missing role becomes `student`. On the server that value is **written back** to the profile. Latent today, because nothing assigns `tutor` or `teacher`. | Fail closed. **Proof:** a unit test where an unknown role gets a 403. |
| G-AUD-24 | LOW | C | `packages/shared/src/calendar/read-model.ts:353,373` vs Doc 05F §16 :764 ("no timezone") and the comment `calendar/api.ts:473` | The guardian day view model carries `timezone`. The spec withholds it, and the adjacent comment claims it is withheld. | **Proof:** the wire-contract test asserts no `timezone` key anywhere in the guardian payload. |
| G-AUD-25 | LOW | C | `guardian-routes.ts:465` (no Zod parse of `:studentId`); `:510-515` and `student-resources.ts` revoke (no `requestId` passed) | A malformed id gives 500 instead of 400. The revoke audit row has a NULL `request_id`. | Unit tests. |
| G-AUD-26 | LOW | UI | `guardian-dashboard.tsx:210-221`; `CheckoutReturnPoller.tsx:75-121`; `PremiumUpgradePrompt.tsx:100-168`; `UserProfile.tsx:69-76,141-144`; `GuardianPurchaseCard.tsx:120-125,237-243`; `lib/billing-client.ts:90,105-107` | `/api/billing/status` is cached under 3 keys with 4 inline types and no shared schema. A failed billing-status fetch hides every banner silently. A failed plans fetch shows as "plans unavailable". There are empty `.catch(() => ({}))` handlers. The poller keeps polling every 2 seconds after its timeout. *The billing logic is out of scope; logged for the UI inventory.* | Redesign input. Shared schema. |
| G-AUD-27 | LOW | UI | `guardian-dashboard.tsx:895` vs `canonical-runtime-views.ts:175-181` | The tile label "Questions Attempted (7d)" and the server label "Questions Solved (7d)" are both on screen. | Copy fix during the redesign. |
| G-AUD-28 | LOW | C | `server/services/subject-access-audit.ts:94-98` | A stale comment says `guardian_link_audit` "does not exist" and cites `guardian-routes.ts:131`. It exists as a function (`20260828000000…:48-63`, owner-confirmed in production). Other stale comments: `features/calendar/api/queries.ts:163-165` ("no target score"); `calendar/api.ts:440` names `/api/guardian/students/:id/calendar`; `guardian-link-rate-limit.ts:8` names a retired route. | Comment sweep. |
| G-AUD-29 | LOW | C | `server/lib/notifications/direct-sends.ts:252` | The invite email carries the link code in a URL query string, so it can reach browser history and Referer headers. The TTL and single use bound the risk. | Note only. |
| G-AUD-30 | LOW | C | `components/navigation.tsx` (guardian branches, no importer); `supabase-auth.ts:247,950` | Configured but never called: `navigation.tsx`, `requireRequestAuthContext`, `getSupabaseAnon`. | Delete. |
| G-AUD-31 | LOW | C | `student-resources.ts` G1 report handler | The entitlement check runs before the Zod parse of `sessionId`. Coding standards §8.1 order is auth → entitlement → parse, so this complies, but it answers 402 before 400 for a malformed id. Cosmetic. | none |
| G-AUD-32 | LOW | D | branches | `guardian` is 6 merges behind `main` (#929–#934, G1 included). Production runs `main` @ `d073eb3`. No guardian code on `main` is undeployed. | Merge `main` into `guardian` before the redesign branches from it. |
| G-AUD-33 | LOW | P | brief §2 | Every production statement rests on the owner's 2026-09-27 report. Nothing was re-verified this session (see §0.6). | Run Appendix A. |

Out-of-scope observation, not scored: `entitlement_active` is status-only and ignores `current_period_end`/`grace_period_ends_at` (`20260616120000…:12-18`). Stripe webhook correctness therefore decides guardian visibility (brief §7: Stripe out of scope).

---

## 7. UI inventory (§4.7)

**Design system.**
- **No `packages/ui`.** Guardian UI uses the shadcn components in `client/src/components/ui/*` (47 files).
- **Tokens.**
  - `client/src/styles/tokens.css`, 97 lines: `--brand`, semantic colours, radii, type scale, `--calendar-*`.
  - `client/src/index.css`: the shadcn variables.
  - `tailwind.config.ts:16-19`: `brand-cream #FFFAEF`, `brand-surface #F9F3E7`, `brand-navy #0F2E48`.
- **The guardian dashboard ignores those tokens.** It hard-codes `#0F2E48`/`#FFFAEF` on 41 lines and makes 0 uses of `brand-*`.
- **Three separate visual systems:**
  - The dashboard uses shadcn, Tailwind and hex literals.
  - The calendar uses `calendar.css` (`.lyceon-calendar`, its own `--ink/--muted/--line`).
  - Exam results use `exam.css` (`.exam-root`, `--exam-*`).

**Shells.**
- `GuardianShell.tsx:26-81` has a logo linking to `/guardian` with a "Guardian" label, the notification bell and `HeaderUserMenu`. It has **no nav items.**
- `AppShell` (`app-shell.tsx:39-51`) has nav: Dashboard, Calendar, Practice, Tests, Review, Lisa.
- `/profile` always uses AppShell (`UserProfile.tsx:230-287`), so a guardian sees student nav whose every item bounces back to `/guardian`.
- `/students/:id/calendar` and `/students/:id/tests*` use **no shell.**

### Screens and states

| Route | Shows | Data source (§4 trace) | Loading | Empty | Error | No linked student | Revoked (404) | Lapsed (402) |
|---|---|---|---|---|---|---|---|---|
| `/guardian` | Link-code form + Parent Terms checkbox; roster with per-student badges and calendar, tests and unlink buttons; KPI tiles (Day Streak, Questions Attempted 7d, Accuracy); metric explainer cards; domain mastery list (`LevelPill`); billing banners; purchase card; template preview | §4.5, §4.1 | "Loading…", "Loading students…" (`:327-333,683-686`) | "No students linked yet" + template preview (`:700-710,645-647`). Mastery empty: "No domain mastery is available…" (`:992-995`) | RecoveryNotice "We couldn't load students." (`:687-700`); "We couldn't load progress data." (`:872-879`) | as Empty | **Not handled:** generic error with retry (G-AUD-06) | Named `PremiumUpgradePrompt` + "Progress unlocks once…" (`:832-871,979-983`) |
| `/guardian?checkout=success` | "Processing your payment…", then after 60s "Payment Processing" | billing (out of scope) | spinner | — | copy cites a "Manage Subscription" button that isn't on the card (`CheckoutReturnPoller.tsx:183-184`) | — | — | — |
| `/students/:id/calendar` | Header: target score / "No target set", test date and countdown, projected band / "Not enough practice yet", streak. Grid: days, blocks, completion. Facts strip. "~N min". No controls. | §4.3 | "Loading your plan…" (second person) | "Not set up yet" (`GuardianNotSetUp`) | "We couldn't load your calendar" + retry | reached from the roster only | Generic error + retry (G-AUD-06) | Generic prompt, wrong addressee (G-AUD-14) |
| `/students/:id/tests` | List of forms sat: name, mode, attempt #, state | §4.4 | "Loading results…" | "No practice tests yet…" (`:170-176`) | "We couldn't load these results…" + retry | — | "Not available… may no longer be linked" (`:105-106`) | "Subscription needed…" with no CTA (`:103-104`) |
| `/students/:id/tests/:sessionId` | Total; RW and Math; completed date; mode, attempt, first-seen; disclosure; per-domain correct/total (tab) | §4.4 | "Loading result…" | — | same as above | — | same | same |
| `/notifications` | Feed (GuardianShell for a guardian) | notifications (out of scope) | | | | | | |
| `/profile` | Student-shaped profile in AppShell; guardian billing copy | — | | | | | | |

---

## 8. SCL candidates (the §3 rulings vs the locked spec)

No SCL numbers are allocated here. The register's current maximum across all remote branches is **SCL-182** (per the CLAUDE.md procedure, 2026-09-27), and allocation happens when an entry is drafted.

| # | Ruling | Locked spec says | What the code does | Existing SCL |
|---|---|---|---|---|
| SC-1 | (a) Mastery domain-only, no skills | Doc 01 §38.1 :1805 "Skill-level mastery (yes)"; §38.3 :1821; Privacy Policy §6.2 :362; Doc 03D §11 (draft) | Domain-only (compliant with the ruling and with Doc 05/05A/05B) | SCL-033 (OPEN, the opposite direction) |
| SC-2 | (b) Exam headline plus per-domain breakdown | Doc 04 Q9 :88 "Guardian does NOT see: domain breakdowns"; Doc 04C §8.1 has no domain field | Serves per-domain `correct`/`total` | **SCL-180 (PROPOSED)**; route and denials: **SCL-181 (PROPOSED)** |
| SC-3 | (c) No streaks | Doc 05B §6.5 :653-654, §10 :1600; Doc 05F §16 :762 "the streak" | **Streak served and rendered** in 3 places: dashboard tile (`guardian-dashboard.tsx:889-893`), calendar header (`guardian-student-calendar.tsx:117`), `kpi/sections` `current_streak_days` (`kpi-rollup-read.ts:68`) | SCL-074 (PROPOSED, argues guardian = student) |
| SC-4 | (c) No study time | No spec shows *measured* time. Doc 05F §15 :738 sends `estimates` ("~N min" planned) to guardians. | Serves `estimates` | none (ambiguous) |
| SC-5 | (d) Sessions completed possibly in | Supported by Doc 01 §38.3 :1822 and Privacy Policy :361. Blocked only by Doc 05 AC#19's literal "KPI counters". | Calendar `facts` (`blocks_completed`, `full_lengths_completed`); dashboard `week_questions` | SCL-074 |
| SC-6 | (e) No target score | Doc 05F §16 :762, R-08-22 :118 and **SCL-173 (RULING 2026-09-26)** give guardians the target score and date. Doc 05F :86 and R-08-08 :104 still say "no target score" (internal conflict). | **Serves and renders `target_score` and `target_exam_date`** (`calendar/api.ts:494-505`; `read-service.ts:800-810`) | SCL-173 is the reverse. Needs a new ruling (Q-1). |
| SC-7 | (f) Projection in the calendar context | Doc 05C §10, RB-05C-V1-08 and Doc 05 §15.1 :736 also give guardians the standalone projection and snapshot history | Calendar only in the UI; standalone routes reachable | none |
| SC-8 | "No raw accuracy / event counts" (brief §4.3 Q3) | Doc 05B §10 grants them; Doc 05 AC#19 forbids "KPI counters" | Dashboard renders 7-day question count and accuracy | SCL-074 |
| SC-9 | Code-based linking | Doc 01 §36.1/§36.2 are email-based; Doc 01 not amended | Code-based | **SCL-080 (PROPOSED)** |
| SC-10 | No admin bypass | Doc 01 §16 Admin ✓ | Admin bypass removed on reads (but see G-AUD-05) | **SCL-078 (PROPOSED)** |

---

## 9. Questions for Karl

These are decisions the evidence cannot settle on its own.

- **Q-1. Target score.** Which ruling stands for the guardian calendar?
  - The code follows your ruling of 2026-09-26 (SCL-173, reversing R-08-22): guardians see the target score and test date.
  - This brief says "No target score for guardians".
  - If the brief supersedes, it needs a new SCL against Doc 05F §16.
- **Q-2. Streak.** Remove it from all three guardian surfaces (dashboard tile, calendar header, KPI endpoints)? That contradicts Doc 05B §6.5 and Doc 05F §16 and needs an SCL.
- **Q-3. Exam per-domain breakdown.** Is `correct of total` per domain within "per-domain breakdown", or should guardians see a level or percentage instead of raw counts?
- **Q-4. Dashboard KPI tiles.** Do "questions in the last 7 days" and "accuracy in the last 7 days" stay?
  - They are raw counts and accuracy, which Doc 05 AC#19 forbids and Doc 05B allows (SCL-074 is open).
  - Should "sessions completed" come from the calendar's `blocks_completed`, or from something else?
- **Q-5. Guardian account creation.** How are guardian accounts created today?
  - Every product sign-up path creates a student.
  - Choosing "Guardian" at profile completion is refused (G-AUD-04).
- **Q-6. Admin gate.** Should `requireGuardianRole` stop admitting `admin`, closing the admin-redeems-a-code path (G-AUD-05)?
- **Q-7. Revoked-link UI.** The server answers a revoked link with the same 404 as "no such student", deliberately. Should the guardian UI still say "no longer linked" in that case (as the exam page does), given that the guardian is the one who may have unlinked?
- **Q-8. Production SQL.** Please run Appendix A and send back the output. G-AUD-10, G-AUD-12 and G-AUD-33 stay open until then.

---

## Appendix A. Owner-run, read-only production SQL

Run these as `postgres` against production. Nothing here writes. Expected body hashes were computed from the final migration definitions as `md5(replace(prosrc, chr(13), ''))` and cross-checked in a throwaway local PG16. A body applied by hand through a client that rewrites whitespace will mismatch; diff `prosrc` before calling it drift.

### A.1 Function existence, attributes, body md5

```sql
WITH expected(sig, md5_expected, secdef_expected) AS (VALUES
  ('public.guardian_view_decision(uuid,uuid)',                      'c54e5697c856f817b6071d195bd37188', true),
  ('public.guardian_can_view_student_as(uuid,uuid)',                'a53abec69aee50e6ae28fcc0de02c397', true),
  ('public.guardian_can_view_student(uuid)',                        '2be995b41b47148518bf84305658b5e0', true),
  ('public.guardian_link_audit(text,uuid,uuid,jsonb,uuid,text)',    'c17daebf9143ba20618ffc4c5c3adad7', true),
  ('public.create_active_guardian_link_audited(uuid,uuid,text)',    'c7b3ec9741f144d16a562af9f48cd8b1', true),
  ('public.revoke_guardian_link_audited(uuid,uuid,uuid,text,text)', 'bbb418a438a56ebb9fe8493f6591ee37', true),
  ('public.entitlement_active(uuid)',                               '55e8ffd001fd0c89bdfa9db54b2bfacd', true),
  ('public.exam_report_source(uuid,uuid)',                          '63c0ae75152827f9434bee9274ede60d', false),
  ('public.exam_domain_breakdown(uuid,uuid)',                       '15df87a3260c5fd49ffa21880aa38ba3', false)
)
SELECT e.sig, p.oid IS NOT NULL AS exists, p.prosecdef AS secdef,
       p.prosecdef = e.secdef_expected AS secdef_ok, p.provolatile, p.proconfig,
       md5(replace(p.prosrc, chr(13), '')) AS md5_live,
       md5(replace(p.prosrc, chr(13), '')) = e.md5_expected AS body_matches
FROM expected e LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
ORDER BY e.sig;

-- Removed by SCL-080; both must be NULL.
SELECT to_regprocedure('public.create_guardian_link_audited(uuid,uuid,text,text)') AS create_pending_fn,
       to_regprocedure('public.accept_guardian_link_audited(uuid,uuid,text)')      AS accept_fn;

-- One derivation: expect exactly one row (guardian_view_decision).
SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosrc LIKE '%guardian_links%' AND p.prosrc LIKE '%entitlement_active%';
```

### A.2 EXECUTE per role

Expected results:
- `guardian_can_view_student` and `calendar_viewer_is_admin`: f,f,t,t.
- Every other function: f,f,f,t.

```sql
WITH f(sig) AS (VALUES
  ('public.guardian_view_decision(uuid,uuid)'), ('public.guardian_can_view_student_as(uuid,uuid)'),
  ('public.guardian_can_view_student(uuid)'), ('public.guardian_link_audit(text,uuid,uuid,jsonb,uuid,text)'),
  ('public.create_active_guardian_link_audited(uuid,uuid,text)'),
  ('public.revoke_guardian_link_audited(uuid,uuid,uuid,text,text)'), ('public.entitlement_active(uuid)'),
  ('public.exam_report_source(uuid,uuid)'), ('public.exam_domain_breakdown(uuid,uuid)'),
  ('public.calendar_viewer_is_admin()'))
SELECT f.sig,
  has_function_privilege('public',        to_regprocedure(f.sig), 'EXECUTE') AS public_x,
  has_function_privilege('anon',          to_regprocedure(f.sig), 'EXECUTE') AS anon_x,
  has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE') AS authenticated_x,
  has_function_privilege('service_role',  to_regprocedure(f.sig), 'EXECUTE') AS service_role_x
FROM f WHERE to_regprocedure(f.sig) IS NOT NULL ORDER BY 1;
```

### A.3 Policies

Expected results:
- First query: exactly 6 guardian rows, each `SELECT`, `{authenticated}`, `guardian_can_view_student(student_id)`.
- Second query: only `notification_messages_update_self`, the `tutor_*_insert_own/update_own` policies, and `USING(false)` denials.

```sql
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check FROM pg_policies
WHERE policyname ILIKE '%guardian%' OR coalesce(qual,'') ILIKE '%guardian%'
   OR coalesce(with_check,'') ILIKE '%guardian%'
   OR tablename IN ('guardian_links','guardian_consent_requests')
ORDER BY tablename, policyname;

SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies
WHERE schemaname = 'public' AND cmd <> 'SELECT'
  AND roles && ARRAY['public','anon','authenticated']::name[]
ORDER BY tablename, policyname;
```

### A.4 Table privileges

Expected results:
- **All false for anon and authenticated:** `guardian_links`, `guardian_consent_requests`, `entitlements`, `audit_logs`, `tutor_*`.
- **`profiles`:** authenticated has SELECT only.
- **Mirror and calendar tables:** authenticated `sel_any_col = true` and no writes.

```sql
WITH t(tbl) AS (VALUES
  ('public.guardian_links'), ('public.guardian_consent_requests'), ('public.entitlements'),
  ('public.profiles'), ('public.audit_logs'), ('public.student_domain_mastery'), ('public.student_section_kpi'),
  ('public.student_domain_kpi'), ('public.student_overall_kpi'), ('public.student_section_projections'),
  ('public.student_section_projection_snapshots'), ('public.student_skill_kpi'),
  ('public.tutor_conversations'), ('public.tutor_messages'), ('public.calendar_blocks'),
  ('public.calendar_plan_dates'), ('public.student_study_profile'), ('public.test_sessions'),
  ('public.score_runs'), ('public.test_session_answers')),
r(role) AS (VALUES ('anon'), ('authenticated'))
SELECT t.tbl, r.role,
  has_table_privilege(r.role, to_regclass(t.tbl), 'SELECT')      AS sel_table,
  has_any_column_privilege(r.role, to_regclass(t.tbl), 'SELECT') AS sel_any_col,
  has_table_privilege(r.role, to_regclass(t.tbl), 'INSERT')      AS ins,
  has_table_privilege(r.role, to_regclass(t.tbl), 'UPDATE')      AS upd,
  has_any_column_privilege(r.role, to_regclass(t.tbl), 'UPDATE') AS upd_any_col,
  has_table_privilege(r.role, to_regclass(t.tbl), 'DELETE')      AS del
FROM t CROSS JOIN r WHERE to_regclass(t.tbl) IS NOT NULL ORDER BY 1, 2;
```

### A.5 Guardian data state (aggregates only, no PII)

```sql
SELECT status, count(*) FROM public.guardian_links GROUP BY status ORDER BY 1;

SELECT
  (SELECT count(*) FROM (SELECT guardian_profile_id, student_profile_id FROM public.guardian_links
     WHERE status='active' GROUP BY 1,2 HAVING count(*) > 1) d) AS dup_active_pairs,
  (SELECT count(*) FROM public.guardian_links gl
     JOIN public.profiles g ON g.id = gl.guardian_profile_id
     JOIN public.profiles s ON s.id = gl.student_profile_id
    WHERE gl.status='active' AND (g.role <> 'guardian' OR s.role <> 'student'
          OR g.deleted_at IS NOT NULL OR s.deleted_at IS NOT NULL)) AS active_links_bad_party;

SELECT public.guardian_view_decision(guardian_profile_id, student_profile_id) AS decision, count(*)
FROM public.guardian_links WHERE status='active' GROUP BY 1;

-- Exposure window: create_active_guardian_link_audited was PUBLIC-executable until 2026-09-23.
SELECT count(*) AS links_created_before_hotfix, min(created_at), max(created_at)
FROM public.guardian_links WHERE created_at < '2026-09-24';
SELECT count(*) AS link_audit_rows,
       count(*) FILTER (WHERE context->>'request_id' IS NULL) AS without_request_id
FROM public.audit_logs WHERE action IN ('guardian_link_initiated','guardian_link_revoked');

SELECT status, count(*),
       count(*) FILTER (WHERE status='pending' AND consent_token_expires_at < now()) AS pending_but_expired
FROM public.guardian_consent_requests GROUP BY status ORDER BY 1;

-- G-AUD-07: does system_event_logs exist at all?
SELECT to_regclass('public.system_event_logs') AS system_event_logs;
```

### A.6 RLS state and code-referenced columns

The query reports whether RLS is enabled per table, plus the total and guardian policy counts. Expected result: RLS enabled on every table, and exactly one guardian policy on each of the six mirror tables.

```sql
SELECT c.oid::regclass AS rel, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname) AS n_policies,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname
     AND (p.policyname ILIKE '%guardian%' OR coalesce(p.qual,'') ILIKE '%guardian%')) AS n_guardian_policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','v','p')
  AND (c.relname LIKE 'calendar\_%' OR c.relname = 'student_study_profile' OR c.relname LIKE 'test\_%'
       OR c.relname LIKE 'score\_%' OR c.relname LIKE 'exam\_%'
       OR c.relname IN ('guardian_links','guardian_consent_requests','profiles','entitlements',
          'student_domain_mastery','student_section_kpi','student_domain_kpi','student_overall_kpi',
          'student_skill_kpi','student_section_projections','student_section_projection_snapshots'))
ORDER BY 1;

-- Columns the guardian read paths select (every row must come back).
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND (table_name, column_name) IN (
  ('student_domain_mastery','mastery_level'), ('student_section_kpi','events_total'),
  ('student_section_kpi','accuracy_overall'), ('student_section_kpi','current_streak_days'),
  ('student_domain_kpi','events_total'), ('student_overall_kpi','events_last_7d'),
  ('student_overall_kpi','accuracy_last_7d'), ('student_overall_kpi','current_streak_days'),
  ('student_section_projections','projected_score_mid'), ('student_section_projections','relevant_question_count'),
  ('student_section_projection_snapshots','snapshot_kind'), ('student_study_profile','target_score'),
  ('student_study_profile','target_exam_date'), ('profiles','student_link_code'),
  ('profiles','student_link_code_issued_at'))
ORDER BY 1, 2;
```

### A.7 `exam_domain_breakdown` dependencies (G1)

```sql
SELECT to_regprocedure('public.exam_domain_breakdown(uuid,uuid)') AS fn,
       to_regprocedure('public.is_answer_correct(text,text)')     AS dep_is_answer_correct;
SELECT t, has_table_privilege('service_role', t, 'SELECT') AS sr_select
FROM unnest(ARRAY['public.test_sessions','public.score_runs','public.test_session_sections',
                  'public.test_form_items','public.questions','public.test_session_answers']::regclass[]) AS t;
```
