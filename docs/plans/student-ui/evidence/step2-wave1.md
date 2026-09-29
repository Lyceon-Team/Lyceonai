# Step 2 — Wave 1 (UI-01..UI-10) re-verification at current head

Head: `c015500` (claude/student-ui-docs = origin/cleanup `8c6738f` + docs commit). Read-only; nothing in the repo was modified.
Register: `docs/plans/student-ui/student-ui-vertical.md:143-152`.

---

## 0. BLOCKERS — register rows that contradict LOCKED spec (CLAUDE.md: code follows spec; stop and surface to Karl)

| Row | Register says | Locked spec says | Evidence |
|---|---|---|---|
| UI-01 (exam) | exam entitlement denial -> 402 `entitlement_required` | Doc 04A V2.2 §16.1 step 2: "Fail -> `403 forbidden`"; §16.2 table `forbidden | 403 | Authenticated, but no entitlement or not the session owner` | `docs/Spec/Doc 04A — Exam Runtime & Session State.md:1380,1392` |
| UI-01 (tutor) | LISA denial -> 402 | Doc 03B §5.9: `403` + `entitlement_required`; **CR-03B-21 explicitly moved V1's 402 to 403** ("402 has inconsistent handling across HTTP proxies, CDNs, browser fetch, and client SDKs") | `docs/Spec/Doc 03B — LISA API and Runtime Flow.md:281-282,416,487,498,642,1964,2645,3168` |
| UI-01 (calendar shape) | calendar adopts nested `{error:{message,code,details}}` | Doc 05F §15: 402 is "shared CTA payload, **flat platform shape** so the existing upgrade component recognises it"; and "a policy denial ... settles at 402 or 403" | `docs/Spec/Lyceon_Doc_05F.md:740`; `server/lib/http-errors.ts:13-17` records owner ruling 2026-09-17 that the flat shape IS the contract |
| UI-02 | gate `PUT /api/calendar/profile` with calendar entitlement | Doc 05F §15 "**Setup renders before the entitlement gate.** A free student receives `setup_required` rather than 402 ... their test date and target score are stored either way. The 402 applies to the plan payload, not to setup"; §17.5 "with their answers already saved either way"; SCL-130 (APPLIED) build artifact lists "`PUT /profile` ungated" | `docs/Spec/Lyceon_Doc_05F.md:734,799,974`; `docs/SpecAudit/SPEC_CHANGES_LOG.md:3617-3627`; code `server/routes/calendar-routes.ts:546-572`; test `tests/ci/calendar.routes.contract.test.ts:735-760` asserts 200 for a free student |

UI-00d (denial contract vs Doc 01/01A) is exactly where these belong: Doc 01 / 01A have **no** mention of 402 / `entitlement_required` / `PAYMENT_REQUIRED` (grep empty), so the per-surface docs above are the only authorities, and they disagree with UI-01. UI-01 and UI-02 cannot proceed as written without an SCL change (owner question).

Also Doc 04C: a lapsed entitlement on an OWNED report is a 200 `unavailable`; missing/foreign is a bare 403 (anti-enumeration) — `docs/Spec/Doc 04C ...md:321-362`. OQ-5 already open; note that moving it to 402 would also be a spec change.

---

## UI-01 — entitlement denial contract

### Current denial sites (file:line, status, body)

| Surface | Site | Predicate | Status | Body |
|---|---|---|---|---|
| Exam runtime `/api/tests/*` | `server/routes/exam-runtime-routes.ts:116-151` (`authorizeExamCaller`; 403 at `:139-148`) | `canAccessFeature(user.id, EXAM_FEATURE_KEY)` `:129` (key `"exam_full_length"`, `server/services/exam-runtime-service.ts:81`) | 403 | `sendFailure` `:68-84` -> `{ error: { code: "forbidden", message: "Full-length exams need an active subscription." }, requestId }` (nested, §8.2 + requestId) |
| Exam report `/api/tests/:id/report` | `server/routes/exam-report-routes.ts:84-90` | `canAccessFeature(user.id, EXAM_FEATURE_KEY)` | 403 `forbidden` "Report not available." when `read.kind==="forbidden"`; lapsed owned = 200 `unavailable` per 04C | `sendError` shape (nested + `meta`) |
| Calendar `/api/calendar/*` | helper `entitled()` `server/routes/calendar-routes.ts:179-197`; call sites `:527,580,629,692,780,836,933,986` | `canAccessFeature(studentId, CALENDAR_FEATURE_KEY)` `:185` (key `"calendar_access"`, `:84`) | 402 | `sendPaymentRequired` `server/lib/http-errors.ts:23-30` -> FLAT `{ error: "Subscription required", code: "PAYMENT_REQUIRED", message: "An active subscription is required to see this.", requestId }` |
| Calendar GET with no profile | `calendar-routes.ts:500-523` | returns 200 `setup_required` + `entitled: canAccessFeature(...)` `:513-521` | 200 | — |
| Calendar full-length launch | `server/services/calendar/adapters/full-length.ts:98-111` | `canAccessFeature(ctx.student_id, EXAM_FEATURE_KEY)` | returns `engine_error` status 403 -> route maps `engine_error` to **502 `CALENDAR_ENGINE_ERROR` "Try again"** (`calendar-routes.ts:442-450`) | register miss: an entitlement denial rendered as a retryable 502 |
| student-resources (`/api/students/:id/*`) | `entitlementGate` `server/routes/student-resources.ts:199-213` (`requiresEntitlement[path]` table) | `canAccessFeature(studentId, featureKey)` `:208` (mastery_detail etc.) | 402 | same flat `sendPaymentRequired` `:211` |
| resolveSubject (guardian) | `server/middleware/subject-resolver.ts:131-141` | `resolveGuardianViewDecision` -> `student_unentitled` | 402 | inline FLAT `{ error: "Subscription required", code: "PAYMENT_REQUIRED", message: "This student's subscription is not active...", requestId }` (a third copy of the payload, not via http-errors.ts) |
| Tutor `/api/tutor/*` | `denyIfNotEntitled` `server/routes/tutor-runtime.ts:205-216`; call sites `:575,822,2054,2204,2357,2462` | `EntitlementService.isEntitlementActiveForProfile(studentId)` `:210` | 403 | `sendTutorError(res,"entitlement_required")` `server/services/tutor-error-codes.ts:288-302`; entry `TUTOR_ENTITLEMENT_REQUIRED` `:53-57` -> `{ error: { message: "An active entitlement is required to use the tutor.", code: "entitlement_required" } }` (no requestId) |
| Practice quota | `server/routes/practice-canonical.ts:1098-1160` (reserve per answer, `:1111`) and `:1465-1500` (dry-run at session create, `:1472`) | `check_and_reserve_practice_quota` RPC (`supabase/migrations/20260630000000_practice_quota_rpc.sql:131`, only definition) via `apps/api/src/lib/rate-limit-ledger.ts:146-176` | 402 | FLAT `{ error: "Usage limit reached", code: <"PRACTICE_FREE_DAILY_QUOTA_EXCEEDED" | "PRACTICE_SESSION_LIMIT_REACHED">, limitType:"practice", current, limit, remaining, resetAt, message, requestId }`. Note: the **paid** per-session cap (`PRACTICE_SESSION_LIMIT_REACHED`, SQL `:236-249`) is also sent as 402. No code named `practice_quota_exhausted` exists anywhere. Admin bypass `:1106-1108`, `:1470`. Quota value = `practice_runtime_config.daily_quota_free` (seed 40, `20260610000000_ws2_config_constants.sql:82`). |
| Practice concurrent-session cap | `practice-canonical.ts:1376-1387`, review `review-canonical.ts:513-524` | config cap | 403 `SESSION_LIMIT_EXCEEDED` | not an entitlement denial but shares 403 |

### EntitlementService (`server/services/entitlement-service.ts`)
- `isEntitlementActiveForProfile(profileId)` `:51-61` — canonical predicate via `evaluateEntitlementActive` `:82-107` -> RPC `entitlement_active` (status in active/past_due/trialing). Fails closed. Not feature-aware.
- `canAccessFeature(profileId, featureKey)` `:131-184` — reads `entitlement_features(required_tier, enabled)`; unknown/disabled -> false; `free` -> true; `premium` -> delegates to `isEntitlementActiveForProfile`. **No admin bypass** ("Admin bypass is the caller's responsibility", `:124-125`). **Does not read `blocked_during_live_exam`.**
- Feature keys (only seed; `supabase/migrations/00000000000000_genesis.sql:221-229`, no later insert/update found): `practice_daily_free` (free), `practice_unlimited` (premium), **`tutor_access` (premium, blocked_during_live_exam=TRUE)**, `review_full` (premium), `exam_full_length`, `calendar_access`, `mastery_detail`, `historical_trends` (all premium).
- Tutor key = `tutor_access`; it is referenced by **no code** today (grep empty). Switching LISA to `canAccessFeature(studentId,"tutor_access")` is behaviour-equivalent for students (premium -> same predicate) except it adds the `enabled` switch; `blocked_during_live_exam` would remain unenforced either way.
- Admin handling per surface: exam and calendar have no bypass (admin must hold entitlement); tutor mount is `requireStudentOnly` (`server/index.ts:391-396`) so admin never reaches it; practice quota has explicit admin bypass; `legacy/progress.ts:104-106` has an admin bypass for mastery_detail.
- Other `canAccessFeature` callers: `server/services/kpi-access.ts:36` (historical_trends, degrade-not-deny), `server/routes/legacy/progress.ts:108` (mastery_detail, degrade), `student-resources.ts:593`.
- Other `isEntitlementActiveForProfile` callers (unaffected): `server/lib/account.ts:902,1002,1101`, `server/routes/guardian-routes.ts:196`.
- `tests/ci/entitlement.single-evaluator.contract.test.ts:117-140` only requires `server/lib/account.ts` among callers — removing the tutor call is safe for this gate.

### Shared error schema today (packages/shared)
- `apiErrorSchema` / `ApiError` — `packages/shared/src/calendar/api.ts:50-61`: `{ error: { message, code?, details? } }` `.strict()`, comment says "deliberately NOT calendar-named ... any other vertical should import this". This is the canonical one to extend/move (do not fork). Tested at `packages/shared/src/__tests__/calendar-api.test.ts:611-624`.
- `GUARDIAN_VIEW_DECISIONS` incl. `student_unentitled` — `packages/shared/src/guardian-subject.ts:29-35`.
- No shared schema for `entitlement_required`, `payment_required`, a feature enum, or the 402 body (grep empty). `TutorErrorResponse` is server-local (`tutor-error-codes.ts:259`). `ExamFailure` is server-local.
- Note: `details.feature` does not fit `resolveSubject`'s 402 — that denial is a guardian-view decision (`student_unentitled`), not a feature key.

### Existing tests asserting current denial bodies (would need updating)
Exam 403:
- `tests/ci/exam-runtime.handler-pg.ci.test.ts:252-263` (`r403.status 403`, `error.code "forbidden"`; header `:26`)
- `tests/ci/exam-shell-server.handler-pg.ci.test.ts:280,304-326` (report 403 for missing/foreign — ownership, 04C; not entitlement)
Calendar 402 / PAYMENT_REQUIRED (flat `res.body.code`):
- `tests/ci/calendar.routes.contract.test.ts:205-224, 722-731` (and `:735-760` asserting PUT /profile 200 for free — UI-02 conflict)
- `client/src/features/calendar/api/client.test.ts:404-419`; `client/src/components/layout/app-shell.calendar-nav.test.tsx:125`; `client/src/pages/guardian-dashboard.calendar-link.pg.ci.test.tsx:203-206`
student-resources / resolveSubject 402:
- `tests/ci/student-resources.contract.test.ts:402-406, 505-510`
- `tests/ci/subject-resolver.contract.test.ts:119-126`
- `tests/ci/guardian-exam-results.handler-pg.ci.test.ts:418-444`
- `tests/ci/guardian-reporting.contract.test.ts:161-162` (mock returns flat body); `tests/ci/guardian-unlinked.pg.ci.test.ts:524-529`; `client/src/features/exam/pages/GuardianExamResultsPage.test.tsx:205`
- `student_unentitled`: `client/src/components/guardian/GuardianCta.test.tsx`, `client/src/lib/billing-cta.pitch.test.ts`, the two tests above.
Tutor 403 `entitlement_required`:
- `client/src/components/tutor/ScopedTutorPanel.contract.test.tsx:641-644`
- `client/src/lib/tutor-error-classifier.test.ts:171-173`; `client/src/pages/tutor.anti-leak.contract.test.tsx:193-197`
- `client/src/pages/chat.upgrade.contract.test.tsx:252,266-272,373`
- Mocks of `isEntitlementActiveForProfile` only (would all start DENYING if tutor switches to `canAccessFeature` unless the mock adds it): `tests/ci/compaction-enqueue.contract.test.ts:67`, `tutor-review-scope.contract.test.ts:37`, `tutor-model-armor.contract.test.ts:47`, `crisis-pause-resume.contract.test.ts:46`, `tutor-presubmit-gate.contract.test.ts:40`, `crisis-country-resources.contract.test.ts:34`, `tutor-runtime.retry-and-detail.contract.test.ts:44`, `client/src/components/tutor/ScopedTutorPanel.contract.test.tsx`, `client/src/pages/chat.{cold-load,resume,upgrade,optimistic-send}.contract.test.tsx`.
- `tests/ci/homepage-pricing.contract.test.ts:120` (prose referencing entitlement_required)
Practice quota 402: no test found asserting the quota body (grep for PRACTICE_FREE_DAILY_QUOTA_EXCEEDED in tests empty).

### Client code branching on 402/403
- `client/src/lib/api-error.ts:119-150` `getPremiumDenialReason` (402 OR 403; codes PREMIUM_REQUIRED/PAYMENT_REQUIRED/SUBSCRIPTION_REQUIRED/ENTITLEMENT_REQUIRED, case-normalised; `PAYMENT_REQUIRED` -> `payment_required`, others -> `premium_required`), `isEntitlementDenialError` `:148`, `mapTutorErrorToPremiumReason` `:161`, `isSessionError` `:177-182`. Code extraction reads nested `error.code` then top-level `code` (`:41,70-72`) — so a nested `entitlement_required` would already classify as premium_required.
- `client/src/features/calendar/components/CalendarStates.tsx:22-24` `isEntitlementDenial` = status 402 only; used `pages/calendar.tsx:124`, `pages/guardian-student-calendar.tsx:81`.
- `client/src/components/tutor/LisaUpgradeCard.tsx:44-48` `isLisaEntitlementDenial`; used `components/tutor/ScopedTutorPanel.tsx:159-160,303`, `pages/chat.tsx:316-322`.
- `client/src/lib/tutor-error-classifier.ts:150` case `entitlement_required`.
- `client/src/features/exam/components/ExamStatus.tsx:19,28` (403 -> "This test isn't available to your account."; hides retry).
- `client/src/features/exam/pages/GuardianExamResultsPage.tsx:103,109` (402 -> "Subscription needed").
- `client/src/pages/mastery.tsx:226` `isEntitlementDenialError`.
- `client/src/hooks/usePractice.ts:292-294` any 402 -> `setQuotaExhausted(true)`; `:297-299` 403 SESSION_LIMIT_EXCEEDED; `client/src/hooks/useCanonicalPractice.ts:393-394`; `client/src/hooks/useReview.ts:260,269`.
- 401/403 as session loss: `RequireRole.tsx:55`, `SupabaseAuthContext.tsx:93`, `profile-complete.tsx:108`.

---

## UI-02 — PUT /api/calendar/profile
- Current: `server/routes/calendar-routes.ts:546-572` (comment block `:546-554` "SETUP IS NOT GATED (owner ruling 2026-09-24, SCL-130)"; handler `:555-572`, no `entitled` call). Register cited `:555-572` — unchanged.
- GET /api/calendar with no profile: `:478-523` returns 200 `setup_required` + `defaults` + `entitled` (computed via `canAccessFeature`, `:513-521`) **before** the gate; with a profile, `entitled()` runs first `:527`.
- Client path: `client/src/features/calendar/components/SetupPopup.tsx:262-269` `finish()` calls `onSubmit(body)` (PUT /profile) for every student, then free students go to step 3 (upgrade panel, `:268`, `:491-492`, header comment `:33-35` "Either way the answers are already saved — `PUT /api/calendar/profile`").
- Spec requires this ungated (see §0). Test `tests/ci/calendar.routes.contract.test.ts:735-760` locks it. **UI-02 as written reverses SCL-130 / Doc 05F §15 — owner question, not a code task.**

---

## UI-03 — return paths
- Allowlist: `packages/shared/src/return-path.ts:24-47` = `/guardian, /dashboard, /profile, /practice, /review, /chat, /mastery, /upgrade, /update-password, /notifications, /admin/crisis-review`. `/chat` already present. `/calendar` and `/tests` absent.
- Full-length emails: `server/lib/notifications/templates/full-length.ts:83` `const CALENDAR_HREF = "/calendar"`, used `:92,103,135,145,164,174`. Both templates link to **`/calendar` only** — no `/tests` path. (Register's `:83,145,174` are correct and all resolve to `/calendar`.)
- Other email paths: `/profile?tab=settings` and `/guardian` (guardian-linked/unlinked, allowlisted); `/guardian?code=` (direct-sends.ts:252, allowlisted); `/guardian/verify-consent?requestId=` (direct-sends.ts:103, under `/guardian` prefix); `/account/recover?token=` (direct-sends.ts:171, NOT allowlisted — public route, likely fine, unverified).
- App.tsx mounts `path="/tests"` (`client/src/App.tsx:205`) and `path="/calendar"` (`:211`) — both pass the "every entry is mounted" test.
- `/profile/complete` does NOT preserve next: `client/src/pages/profile-complete.tsx:79-81` `resolvePostCompletionPath(role)` used at `:177` (after submit) and `:224` (already complete redirect). Also the next is DROPPED upstream before reaching the page: `client/src/pages/login.tsx:55-56` overwrites destination with bare `/profile/complete`; `client/src/components/auth/RequireRole.tsx:132` redirects to bare `/profile/complete`; server `server/routes/oauth-callback-routes.ts:347` sets `redirectPath = "/profile/complete"`. All four sites need touching.
- Tests: `client/src/review-entry-points.test.ts:86-127` (U9 `/review` membership; `:120-127` every allowlist entry must appear as `path="<entry>"` in App.tsx); `packages/shared/src/__tests__/return-path.test.ts`; `packages/shared/src/__tests__/return-path.admin.test.ts:41` (no bare `/admin`). Mutation `scripts/ci/review-ui-gate.mutations.sh:208-214` (U9) anchors on the exact line `  "/review",\n` — adding entries keeps it unique.

---

## UI-04 — retire /tutor
- Route: `client/src/App.tsx:135-142` (`RequireRole allow={["student","admin"]}` -> `TutorPage`), lazy import `:91`. Only importer of `pages/tutor.tsx` is App.tsx:91 (plus its own test).
- `client/src/pages/tutor.tsx` (133 lines) + `client/src/pages/tutor.anti-leak.contract.test.tsx` (imports `./tutor` at `:89`; LISA-FE-RAW-SERVER-TEXT coverage — test must be deleted or its assertion re-homed onto chat).
- Trust links: `client/src/pages/trust.tsx:159`, `client/src/pages/trust-evidence.tsx:170` (`href="/tutor"`).
- Server: `server/seo-content.ts:796-~830` `"/tutor"` entry in `PUBLIC_SSR_ROUTES` renders a **public "Tutor Safety, Privacy, and Pedagogy" transparency page** (boundaries, privacy, pedagogy) for logged-out visitors/crawlers; the trust hub SSR body links it at `seo-content.ts:716` ("Tutor Transparency"). Meta source `shared/seo/public-meta.ts:286-289`. Registered at `server/index.ts:781-785`. Removing it deletes a public trust page — the content has no other home (owner may want it moved, e.g. into /trust).
- Sitemap: `client/public/sitemap.xml:76` `https://lyceon.ai/tutor` — `tests/seo.ssr-coverage.test.ts:18-23` requires every sitemap URL to have SSR ownership, so sitemap entry must be removed in the same change.
- Analytics: `client/src/lib/analytics-surface.ts:46-52` comment explains `/tutor` conflict; `tests/ci/analytics-student-surface.contract.test.ts:101-103` asserts `/tutor` IS in `PUBLIC_SSR_ROUTES` and `ROLE_GATED_PATHS` — must be updated.
- `/chat` is on the return allowlist, so redirect-after-login works.

---

## UI-05 — /api/questions*
Mounts in `server/index.ts` (register `:518-601` still accurate):
- `GET /api/questions` `:518-535` (auth, student/admin; `res.json` monkey-patch with `data: any` `:524`)
- `GET /api/questions/recent` `:537-550` — **anonymous**, `data: any` `:540`
- `GET /api/questions/random` `:552-569` (`any` `:558`)
- `GET /api/questions/count` `:571-576`
- `GET /api/questions/stats` `:577-582` (UI-07, not in UI-05 list)
- `GET /api/questions/feed` `:583-588`
- `GET /api/questions/:id` `:591-596`
- `POST /api/questions/feedback` `:600-606` (+CSRF)
- startup banner `console.log` lines `:1027-1030` list these routes.
Handlers: `server/routes/questions-runtime.ts` — `getQuestions :107`, `getRecentQuestions :146`, `getRandomQuestions :182`, `getQuestionCount :223`, `getQuestionStats :248`, `getQuestionsFeed :308`, `getQuestionById :352` (reads `.from("questions")` `:360`, NOT servable_questions), `getQuestionsByTopic :389` and `getQuestionsByDifficulty :439` (exported, **never mounted** — dead), `submitQuestionFeedback :492` (`.from("questions")` `:522`). Error bodies leak raw `error.message` as `detail` (`:164,174,233,241` ...).

`QUESTION_SAFE_SELECT` — `server/routes/questions-runtime.ts:20-30` verbatim:
```
const QUESTION_SAFE_SELECT = [
  "id",
  "section",
  "item_type",
  "stem",
  "options",
  "difficulty",
  "domain",
  "skill_codes",
  "created_at",
].join(",");
```
`/recent` path: `getRecentQuestions` -> `fetchPublishedQuestions` `:65-75` `.from("servable_questions").select(QUESTION_SAFE_SELECT)`, then `mapQuestionForStudent` -> `projectStudentSafeQuestion` (`:43-53`). No answer/explanation column selected (and `options` on MCQ — need to confirm options JSON carries no per-option correctness; `option_metadata`/`correct_variants` are excluded).

Tests/CI referencing these routes (update/delete with UI-05):
- `tests/ci/questions.anti-leak.ci.test.ts:8-9,315-430` (recent/random/list anti-leak) — delete or convert to 404 proofs.
- `tests/ci/servable-questions-gate.ci.test.ts:38-39` ALLOWLIST entry `server/routes/questions-runtime.ts`; `:120-126` "every allowlisted file actually exists" + `:128-135` "every allowlisted file actually has a direct questions-table access" -> entry MUST be removed with the file (or the direct `.from("questions")` removed with getQuestionById/feedback).
- `tests/auth.integration.test.ts:13,103` (`/api/questions/recent`) — in default vitest include (`vitest.config.ts:24`).
- `tests/practice.validate.regression.test.ts:13,26` (`POST /api/questions/validate` — already not mounted).
- `tests/specs/rls-auth-enforcement.spec.ts:97-99,234-239,279-281` (Playwright spec; not in vitest run).
- Client: `client/src/lib/queryClient.ts:112-120` special-cases `/api/questions` unwrap; `client/src/pages/practice.tsx:145` (stats).
- Postman: `postman/Lyceonai.postman_collection.json:391,398,405,412,424`; `postman/collections/Lyceon - APIs/❓ Questions/*.request.yaml` (5 files: List, by ID, Stats, Feed, Feedback); `.postman/resources.yaml`.
- `tests/ci/forbidden-routes.ci.test.ts` does not reference /api/questions.

---

## UI-06 — dead code deletion targets (current locations + references)

Endpoints:
| Target | Location | References outside the file |
|---|---|---|
| POST `/api/auth/admin-provision` | `server/routes/supabase-auth-routes.ts:311-~400` (`"/admin-provision"` `:317`) | postman json + `postman/collections/.../Admin Provision.request.yaml`; `Lyceonai-threat-model.md` mentions ADMIN_PROVISION |
| GET `/api/auth/debug` | `supabase-auth-routes.ts:610-~700` (`router.get("/debug"` `:615`; anon createClient `:635`) | `tests/ci/debug.production.ci.test.ts:33-39` asserts 404 `{error:"Not found"}` in prod — still passes after deletion only if the generic 404 body matches; keep test (absence proof) |
| POST `/api/legal/accept` | `server/routes/legal-routes.ts:18-28` (already returns 404) | `client/src/lib/legal.ts`, postman |
| GET `/api/legal/acceptances` | `legal-routes.ts:169-193` (`(req as any)` `:175`, `e: any` `:192`, raw error.message to client `:187,195`) | `client/src/lib/legal.ts`, postman. Source-scan tests slice `legal-routes.ts` from `legalRouter.post("/reaccept"` to EOF (`tests/ci/consent-outstanding-set.contract.test.ts:222-223,268`, `consent-never-blocks.contract.test.ts:206-213`, `legal-consent-capture.contract.test.ts:500-517`, `client/src/components/legal/ReconsentGate.test.tsx:333-345`) — /acceptances sits inside that slice; removing it shrinks the slice but none of the asserted strings live in /acceptances (resolveLegalVersion count stays 1) — low risk, re-run to confirm |
| GET `/api/billing/publishable-key` | `server/routes/billing-routes.ts:1078-~1090`; doc header `:6` | none |
| GET `/api/account/status` | `server/routes/account-routes.ts:15-~88` | cascades: `getAllAccountsForUser` stub `server/lib/account.ts:298-320` becomes dead |
| POST `/api/account/select` | `account-routes.ts:90-~135` | none (`tests/ci/deletion-phases-235.pg.ci.test.ts:192,209` mounts account-routes but only exercises `/email-suppression*`) |
| GET `/api/health/practice` | `server/routes/health-routes.ts:37` (the router's ONLY route); mount `server/index.ts:640` | `tests/ci/debug.production.ci.test.ts:33` (404 proof). Whole file + mount can go |
| GET `/api/_whoami` | `server/index.ts:720` | `tests/ci/debug.production.ci.test.ts:33` |
| `apps/api/src/routes/healthz.ts` (unmounted) | exports `registerHealthz` | `tests/ci/servable-questions-gate.ci.test.ts:44` ALLOWLIST entry — **must be removed in the same change** or "every allowlisted file actually exists" (`:120-126`) fails |
Held (not deleted): `/healthz` `server/index.ts:353`, `/api/health` `:354` — asserted by `tests/ci/debug.production.ci.test.ts:42-50`.

Client:
| Target | Lines | References |
|---|---|---|
| `components/NavBar.tsx` | 126 | `client/src/review-entry-points.test.ts:71-83` reads it (and the next two) — the test must drop these entries or it throws ENOENT |
| `components/navigation.tsx` | 202 | same test |
| `components/progress-sidebar.tsx` | 222 | same test; also has a `totalQuestions` bank-count display `:117` |
| `components/test-options.tsx` | 89 | none |
| `components/progress/ScoreProjectionCard.tsx` | 294 | `ScoreProjectionCard.test.tsx` (delete); `tests/ci/diagnostic-baseline-pending.contract.test.ts:212-213` reads the file; `tests/ci/premium-cta-wiring.contract.test.ts:30` lists it — both must be updated |
| `lib/legal.ts` (120 lines; exports ONLY `LegalAcceptance`, `recordAcceptance`, `fetchUserAcceptances`, `hasAccepted` — no importers) | whole file is dead | `tests/ci/legal-phase2.contract.test.ts:357-361` `readFileSync` at describe-time (ENOENT if deleted); `tests/ci/legal-phase3.contract.test.ts:79,105` read it — must be updated. Comments in `pages/legal.tsx:41`, `trust.tsx:30`, `legal-doc.tsx:30`, `legal-hub.contract.test.ts:166` mention it |

pass1-C §6.2 orphan list re-verified at head with the same resolver (`scratchpad/orphans.py`): IDENTICAL — `DemoDashboardPreview, FeatureHighlights, NavBar, SEO, StatCard, common/{SafeBoundary,error-boundary,loading-skeleton,section-header,tag}, dev/RouteTracer, navigation, progress-sidebar, progress/{ProgressRing,ScoreProjectionCard,TripleProgressRing}, test-options, features/exam/test-fixtures/report-fixtures.ts, hooks/use-shortcuts.ts, hooks/useLockdown.ts, lib/authLogger.ts, lib/legal.ts` + 21 ui primitives (accordion, aspect-ratio, breadcrumb, calendar, carousel, chart, collapsible, command, context-menu, drawer, form, hover-card, input-otp, menubar, navigation-menu, pagination, radio-group, sidebar, slider, switch, toggle-group) + `main.tsx` (entry, false positive).
Caveats: `features/exam/test-fixtures/report-fixtures.ts` is used by `GuardianExamResultsPage.test.tsx` and `ExamReportPage.test.tsx` — KEEP (test fixture). `hooks/use-shortcuts.ts` has `client/src/__tests__/useShortcuts.guard.test.tsx:3` — delete together. `lib/authLogger` is only named in a comment at `features/calendar/api/client.ts:52`. No other test/CI references for the rest.

- `RuntimeContractDisabledCard` branch: `client/src/components/practice/CanonicalPracticePage.tsx:451-455` (unchanged); import `:50`; component `client/src/components/RuntimeContractDisabledCard.tsx`. Server emits none of `*_RUNTIME_DISABLED_BY_CONTRACT` (server helper deleted; `tests/ci/full-length.no-legacy-fallback.contract.test.ts:36` asserts `server/lib/runtime-contract-disable.ts` stays deleted). Deleting the branch also makes `runtimeDisabled` state + `parseRuntimeContractDisabledFromPayload` calls in `hooks/useCanonicalPractice.ts:275,402,476,591,698,743` and `lib/runtime-contract-disable.ts` (+ its test) dead; `lib/engine-config.ts:45` references `domain` for it.
- `hooks/usePractice.ts`: `pages/practice.tsx` consumes only `startSession` (`:243`), `quotaExhausted`, `error` (`:689-696`). Unreached at head: `fetchNextQuestion :320`, `submitAnswer :389`, `skipQuestion :477`, `terminateSession :551`, `nextQuestion :603`, `persistCalculatorState :610` (register's `:334-337,:412,:494,:557,:616` have shifted ~+6-12 and pointed inside these bodies).
- Mutation scripts: none of `scripts/ci/*.mutations.sh` targets any UI-06 file. Touching-but-safe: `review-ui-gate.mutations.sh:31,107,115` (CanonicalPracticePage anchors `showResult={showResult}` and `eyebrow={engine.labels.shellEyebrow}` — unaffected by removing `:451-455`), `review-routes-gate.mutations.sh:35,151` (server/index.ts `/api/review` mount anchor — unaffected), `deletion-evidence-gate.mutations.sh:50,632,636` (App.tsx `<Analytics ...>` anchors — unaffected by UI-04).

---

## UI-07 — bank counts
- `/api/questions/stats`: mount `server/index.ts:577-582` (`requireSupabaseAuth, requireStudentOrAdmin`); handler `questions-runtime.ts:248-306` returns `{ total, math, reading_writing, byDifficulty:{easy,medium,hard}, recentlyAdded: 0 }` over all servable mcq/grid_in. `requireSupabaseAdmin` exists (`server/middleware/supabase-auth.ts:719`). `/api/questions/count` (`:223-246`, `{count}`) is a second bank-count leak (removed by UI-05).
- `/api/practice/topics` (`server/routes/practice-topics-routes.ts:44-92`, mount `index.ts:643-648`): `{sections:[{section,label,domains:[{domain, skills[]}]}]}` — no count/total field; skill list only (derived from the bank, so skills with zero servable items disappear — minor information signal).
- `/api/practice/reference/questions` (`practice-topics-routes.ts:94-154`, mount `index.ts:649-654`): returns `{ questions, count: safeQuestions.length, filters }` — `count` is page length (limit <= 30), not bank total, but it IS a count field the schema test would flag. Also returns up to 30 question stems (safe projection) — a bank-browsing surface.
- Client strings: `client/src/pages/practice.tsx:280` and `:288` "`N` questions in bank" (RW / Math cards), `:208` statsEmpty, `:893-904` "Question Bank" card with `stats.total` and "Total questions currently available"; Domain Library `:716` shows per-domain SKILL counts `:756-757,:782-783` (`· ${domain.skills.length}`); "Open Topic Explorer" `:795`. `client/src/pages/browse-topics.tsx:295` "Found `count` Question(s)" (route `/practice/topics`, `App.tsx:179-186`). Orphan `components/progress-sidebar.tsx:117` (deleted by UI-06).
- Empty pool at session start: server `practice-canonical.ts:1592-1601` returns **422** `{ error:"empty_pool", code:"PRACTICE_POOL_EMPTY", message:"No questions match the requested filters." }` (flat). Review equivalent `review-canonical.ts:559` `REVIEW_POOL_EMPTY` (422, handled client `useReview.ts:260`). Client practice: no `PRACTICE_POOL_EMPTY` branch anywhere in `client/src` (grep empty); `usePractice.ts` shows `apiErr.message` generically; `CanonicalPracticePage.tsx:503` has "No questions available right now." for an in-session empty state.
- `source_pool_count` is stored in session `filters` (`practice-canonical.ts:1613,1755`; diagnostic `diagnostic-routes.ts:346`) but not serialized in the session-start response (`:2382-2396`). Not verified for every GET that returns `filters`.

---

## UI-08 — FK indexes (15 pairs)
All tables/columns exist; none of the 15 has an index with the FK column(s) leading (parsed every CREATE [UNIQUE] INDEX incl. multi-line, minus DROP INDEX; script `scratchpad/idx.py`):
| (table, column) | defined | existing index touching column |
|---|---|---|
| practice_session_items(question_id) | `20260610020000_ws2_practice_review_runtime.sql` (text FK questions) | none |
| review_session_items(question_id) | same | none |
| review_session_items(queue_entry_id) | ADD COLUMN `20260921000000_review_queue_runtime.sql` (FK review_schedule ON DELETE SET NULL) | none |
| review_schedule(question_id) | ws2 runtime | UNIQUE (student_id, question_id) constraint + `uq_review_schedule_open_question` (student_id, question_id) — non-leading |
| review_error_attempts(question_id) | ws2 runtime | none |
| test_session_items(question_id) | `20260930070000_exam_runtime_api.sql` | none |
| test_form_items(question_id) | `20260930030000_exam_runtime_schema.sql` | UNIQUE (test_form_id, question_id) + `idx_test_form_items_lookup` (test_form_id, section, module, ordinal) — non-leading |
| test_sessions(test_form_id) | `20260930030000_exam_runtime_schema.sql` | `idx_test_sessions_student_form` (student_id, test_form_id) — non-leading |
| calendar_block_launches(student_id) | `20260917130000_calendar_v1.sql:348` | none |
| calendar_block_launches(block_id, student_id) | composite FK -> calendar_blocks(block_id, student_id) `:355-356` | PK (block_id, launch_sequence) covers block_id only |
| usage_rate_limit_ledger(student_user_id) | `20260630000000_practice_quota_rpc.sql` (FK auth.users) | (scope, student_user_id, created_at) — non-leading |
| notification_events(subject_profile_id) | `20260903000000_notifications_rebuild.sql` | none |
| account_deletion_requests(profile_id) | genesis (ON DELETE RESTRICT) | none |
| guardian_consent_requests(student_profile_id) | genesis (RESTRICT) | none |
| profiles(guardian_profile_id) | genesis (SET NULL) | none |
Naming: `YYYYMMDDHHMMSS_snake_name.sql`, first line `-- LYCEON-MIGRATION-REVIEWED` (121/129 files). Latest: `20261012000000_calendar_exam_notifications.sql`. Note duplicate version prefixes already exist at head (`20260827000000, 20260901000000, 20260917000000, 20260917130000, 20260921000000, 20260922000000, 20260930000000, 20261005000000, 20261010000000`) — see `scripts/prod-verify/MIGRATION-VERSION-COLLISIONS.md` for why collisions matter to `schema_migrations`; pick a fresh, unique prefix.
CONCURRENTLY: CI applies each file with `psql -v ON_ERROR_STOP=1 -q -f "$f"` (no `-1`/`--single-transaction`): `scripts/ci/genesis-fresh-apply.sh:26,42-45`, `.github/workflows/ci.yml:765-766`; so `CREATE INDEX CONCURRENTLY` works provided the file has no `BEGIN/COMMIT` around it. Precedent: `supabase/migrations/20260930000000_tutor_conversation_assignment_key_unique.sql:18` (`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS`). **Additional required edit:** `scripts/ci/genesis-fresh-apply.sh:62-65` diffs the pg_dump of the full pipeline against `scripts/ci/genesis-schema.expected.sql` — the 15 indexes must be added to that snapshot in the same change or the gate fails. Owner-applied via SQL editor: the editor may wrap a multi-statement run in a transaction — run each CONCURRENTLY statement separately (unverified from here). Production state of these tables/indexes is unverified from here (catalog `pg_indexes` query to hand to Karl).

---

## UI-09 — how the server talks to Supabase
- All data access is service-role: `apps/api/src/lib/supabase-server.ts:50` `createClient(supabaseUrl, supabaseServiceRoleKey, …)` (`supabaseServer`, the common import); `server/middleware/supabase-auth.ts:388-411` `supabaseAdmin` proxy with `SUPABASE_SERVICE_ROLE_KEY` (`:404`); `apps/api/src/lib/supabase-admin.ts:15`; `apps/api/src/lib/supabase.ts:29` (service role key).
- Anon-key clients exist but are used ONLY for `auth.*`: `supabase-auth.ts:133-140` (`auth.getUser(token)`), `supabase-auth.ts:417-446` `supabaseAnon` exported via `getSupabaseAnon()` `:950` — **no callers**; `apps/api/src/lib/supabase-admin.ts:29` `getSupabaseAnon` — no callers; `supabase-auth-routes.ts:635,760` (getUser / resetPasswordForEmail); SSR cookie client `server/lib/supabase-ssr.ts:80-84` used at `supabase-auth.ts:478`, `oauth-callback-routes.ts:197`, `supabase-auth-routes.ts:131,521,574,824` — all `auth.*` calls.
- No `global.headers.Authorization` user-JWT client anywhere in server/apps. Browser client `client/src/lib/supabase.ts:24` used only for `auth.signInWithOAuth` (`SupabaseAuthContext.tsx:346`). Worker `apps/workers/tutor-orchestrator` has no DB client.
- Conclusion: no user-scoped query path; RLS `auth.uid()` per-row cost does not apply to app traffic. UI-09 can close as "post-launch hardening only if a user-scoped path is introduced".

---

## UI-10 — coding-standard hits at head
- `any`: `client/src/components/auth/RequireRole.tsx:28` (was :30), `client/src/App.tsx:376`, `client/src/lib/runtime-contract-disable.ts:42`, `client/src/pages/practice.tsx:196,199,749,775` (same).
- silent catch: `server/routes/legacy/progress.ts:111` (same), `server/routes/guardian-routes.ts:75` (same).
- console: `App.tsx:377`, `CanonicalPracticePage.tsx:322` (was :321), `home.tsx:92,126`, `SupabaseAuthContext.tsx:99,141,146,185,199` — PLUS in the same file `:129,149,163,188,193,248,279,297,313,355,357,378,396,405,423,431` (register lists 5 of 21).
- raw `error.message` shown: `App.tsx:389` (same).
Misses in files Wave 1 touches: `server/index.ts:524,540,558` (`data: any` in the /api/questions wrappers — deleted by UI-05), `:179,185,852,853,911` (`any`); `server/routes/questions-runtime.ts` 11 `error: any` catches + raw `detail: error.message` to clients (deleted by UI-05); `server/routes/legal-routes.ts:175,192` (deleted by UI-06); `server/routes/practice-canonical.ts` ~30 `any` lines incl. `(error as any)?.code` `:1142` in the quota path UI-01 touches; `server/routes/practice-topics-routes.ts:89,151` `catch { return 500 }` without logging (UI-07 touches this file); `server/services/kpi-access.ts:42-43` `catch { return false; }` (silent); `server/middleware/supabase-auth.ts:143` `catch { return null; }`; `server/services/entitlement-service.ts:171` `catch {` (logs — acceptable).

---

## Register misses / other observations
1. Calendar full-length launch entitlement denial -> 502 "Try again" (`full-length.ts:110` -> `calendar-routes.ts:442-450`).
2. Paid per-session practice cap `PRACTICE_SESSION_LIMIT_REACHED` is served as 402 (same as the free quota) and the client maps every 402 to "quota exhausted" (`usePractice.ts:292-294`).
3. Three copies of the flat 402 payload: `http-errors.ts:23-30`, `subject-resolver.ts:133-139`, plus mocks; practice quota 402 is a fourth, different flat shape.
4. `canAccessFeature` ignores `entitlement_features.blocked_during_live_exam` (tutor_access = TRUE); nothing enforces "no tutor during a live exam" via that column.
5. `getQuestionById` (`questions-runtime.ts:360`) reads `questions`, not `servable_questions`.
6. `/api/practice/reference/questions` serves up to 30 stems at a time filterable by section/domain/skill — a bank browser; the `count` field is page size.
7. `/tutor` removal deletes the only public "Tutor Transparency" page (SSR `seo-content.ts:796`), linked from the public trust hub (`seo-content.ts:716`).
8. `/profile/complete` next-loss is at four sites, not one (login.tsx:56, RequireRole.tsx:132, oauth-callback-routes.ts:347, profile-complete.tsx:79/177/224).
9. Duplicate migration version prefixes at head (9 pairs) — pick a unique prefix for UI-08.
10. UI-08 needs `scripts/ci/genesis-schema.expected.sql` updated (snapshot gate).
