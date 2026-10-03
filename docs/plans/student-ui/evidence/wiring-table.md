# Brief 13 Step 0: wiring table

Every element of every DESIGN.md §4 screen that shows data or performs an action, with its backing endpoint, entitlement and status. Written 2026-10-02.

**Source tree.** `cleanup` @ `a39e1c52`. Server, client and shared code is byte-identical on `claude/student-ui-design`, which adds docs only. Line numbers are from that tree.

**Status key:**
- **OK:** the server backing exists and returns what the element needs.
- **PARTIAL:** the backing exists but lacks a field, or the client builds the element wrongly. The note says which.
- **MISSING:** no backing exists. Each MISSING row has an owner question in §9 of the register, with the smallest backing change.

"Client today" means the pre-redesign client. "none" there is Wave 5 client work, not a server gap.

**Production.** Production is `dpl_Ep6hNCPrMX4iuUNV2KQtuAQLmrM6`, built from `main` @ `59997248` (the tip of `main`, read 2026-10-02 from Vercel's production deployment list). The Step 0.4 checks are in §0.

**Forbidden data.** No element below needs a bank count, a raw accuracy figure or a confidence metric. Three existing routes carry them anyway, and no new page may call them for those fields:
- `/api/progress/projection` returns `confidenceBand`, and today's dashboard renders it (§8 F-51).
- `/api/progress/kpis` and `/api/students/:id/kpi/*` carry `accuracy` / `accuracyPct` (`packages/shared/src/student-resources.ts:180-306`).
- `/api/review/pool` `sessions[].filters` passes the raw session `filters` through (§8 F-52).

---

## 0. Step 0.4: confirmed live in production

Checked read-only on 2026-10-02:
- **Deployed code:** the source of `main` @ `59997248`, the commit production was built from.
- **Database objects:** existence in the production catalog (`to_regclass`, `pg_proc`, the `rate_limit_runtime_config` row).

The migration ledger was not used.

| Feature | Deployed code (`59997248`) | Database objects in production | Result |
|---|---|---|---|
| UI-16 pagination, review | `sessions_next_cursor` at `server/services/review-pool.ts:529` | none needed | Live |
| UI-16 pagination, LISA | `next_cursor` on the conversation list, `server/routes/tutor-runtime.ts:2428` | none needed | Live |
| `segmentsFilled` (UI-19) | `segmentsFilled` in `packages/shared/src/exam-domain-segments.ts:93`, serialized by `toStudentExamReport` (`server/routes/student-resources.ts:94`, `server/routes/exam-report-routes.ts:49`) | none needed (read time, no migration) | Live |
| `managedBy` (F-40) | `server/routes/billing-routes.ts:817`, `:880` | none needed | Live |
| Brief 8 background fields | `/api/profile/background` mounted at `server/index.ts:429` | tables `student_background`, `student_dream_schools`, `ref_colleges`, `ref_high_schools` present; `ref_*` have rows; function `save_student_background` present; bucket `reference_search` present | Live |
| `POST /api/calendar/plan/regenerate` | `server/routes/calendar-routes.ts:593` | none needed | Live |

Also seen in the same query: `password_reset_subject` and the `password_reset_requests_hourly` bucket are present. This matches Karl's report that `20261018000000` is applied.

"Live" here means the code and the objects it needs are deployed. It does not close any register row: those still close on their own production proofs.

---

## 1. Runner letters (addendum; Step 0b)

| Question | Answer | Where |
|---|---|---|
| Where is the displayed order decided? | On the server, when a session's items are first served. `buildServedOptions` shuffles the canonical options (`fisherYates`, unseeded crypto) and mints opaque `opt_…` tokens. | `shared/question-bank-contract.ts:783`, `:801` |
| Where is it stored? | `option_order text[]` and `option_token_map jsonb` on `practice_session_items` and `review_session_items` (written by `hydrateSessionItemOptionTokens`), and on `test_session_items` (insert-only, `exam_record_item_options`). | `server/routes/practice-canonical.ts:1051`; called for practice (`:1745`), review (`server/routes/review-canonical.ts:695-698`) and diagnostic (`server/routes/diagnostic-routes.ts:415`) |
| What does the client get? | `options[]{id: "opt_…", text}` in served order. No canonical key and no map. | `toStudentSafeQuestionDTO`, `server/routes/practice-canonical.ts:790-829` |
| Does the client show letters? | No. `question-renderer.tsx` letters an option only when it has a `canonicalKey`, which served options never have, so no letters render. The exam's `ChoiceList.tsx` is position-only. | `client/src/components/question-renderer.tsx:144`, `:211-224` |
| Does LISA read the displayed order? | **No.** LISA reads `question_options` in canonical order with canonical keys and never reads `option_order`. Its "B" is canonical B, not the student's second option. | `server/services/tutor-context.ts:368-371` (columns, no `option_order`), options mapped `:423-436`; worker prints `${o.key}) ${o.text}` |
| Student's answer as LISA sees it | `selected_answer`. In practice that is the canonical key. In review it is the opaque token (§8 F-49). | `server/routes/practice-canonical.ts:3382`, `:3467`; `server/routes/review-canonical.ts:1037` |
| Correct answer as LISA sees it | The canonical key, after submit only. | `getCorrectAnswerForScope`, `server/routes/tutor-runtime.ts:454-479`; gate `server/services/tutor-context.ts:1371-1375` |

The owner question this would have raised was already ruled in Step 0b (Karl, 2026-10-02):
- relabel in `tutor-context.ts` to the displayed order, lettered A–D;
- extend `hasAnswerLeak` to positional phrasing;
- review stores the canonical key, with a one-time backfill.

Nothing here is built yet; Step 0b proceeds in its own PRs.

---

## 2. App shell

| Element | Backing endpoint | Field(s) | Client today | Entitlement | Status |
|---|---|---|---|---|---|
| Rail: Home, Practice, Review | client routes `/dashboard` (`client/src/App.tsx:156`), `/practice` (`:172`), `/review` (`:255`) | none | top bar, not a rail (`client/src/components/layout/app-shell.tsx:39-50`) | free | OK (client rebuild) |
| Rail: Full-Length, lock opens modal in place, no call to the gated endpoint | `GET /api/billing/status` (`server/routes/billing-routes.ts:712`) | `effectiveAccess`, `isPaid` (plan-level) | not used by the shell | `exam_full_length` enforced at `server/routes/exam-runtime-routes.ts:135-176` | PARTIAL: no per-feature flag (OQ-29) |
| Rail: LISA, lock and modal | same | same | none | `tutor_access` via `isEntitlementActiveForProfile` (`server/routes/tutor-runtime.ts:226-237`), which is a different predicate from `effectiveAccess`; under-13 gets 403 `age_restriction` first | PARTIAL (OQ-29) |
| Rail: Calendar, lock as a hint, still navigates | same | `isPaid` | no lock (`app-shell.tsx:45`) | page does its own upsell (402, `calendar-routes.ts:205-224`) | OK (client) |
| Help item | none needed (static page) | none | no `/help` route or page | free | Client only |
| Avatar → Settings; initial | `GET /api/profile` (`server/routes/profile-routes.ts:148`) | `name`, `display_name` | `/profile` (`App.tsx:272`); no `/settings` route | free | OK (client) |
| Footer: Privacy, Terms, Trust and Safety, Help and FAQs | static `/legal/:slug` (`App.tsx:144`; SSR `server/index.ts:727`) | none | marketing `Footer.tsx` only | free | OK. "Trust and Safety" target is OQ-39(a) |
| Theme (system, light, dark per device; no flash; exam light) | none needed | none | no provider; `tailwind.config.ts:4` has `darkMode: ["class"]` | free | Client only (UI-47) |
| Upgrade modal on `entitlement_required` | every gated surface's denial body; shared reader `readEntitlementDenial` (`packages/shared/src/entitlement-denial.ts:89`) | `code`, `details.feature` | helper `getEntitlementDenial` (`client/src/lib/api-error.ts:222`) is consumed by no page; no modal component | n/a | OK server; client builds the modal (Wave 4). The practice quota 402 is `PRACTICE_FREE_DAILY_QUOTA_EXCEEDED` and never opens it (F-07) |
| Modal "See plans" | `/upgrade` (`client/src/lib/billing-cta.ts:38`); prices `GET /api/billing/plans` (`billing-routes.ts:1039`) | — | `/upgrade` | n/a | OK. Destination is OQ-39(e) |
| Notification bell | `/api/notifications` (`server/index.ts:462`) | — | `app-shell.tsx:178` | free | Not in the design rail: OQ-39(b) |

## 3. Home

| Element | Backing endpoint | Field(s) | Client today | Entitlement | Status |
|---|---|---|---|---|---|
| Greeting and name (both plans) | `GET /api/profile` | `name` / `display_name` | `lyceon-dashboard.tsx:202` | free | OK |
| "N days until your SAT on …" (paid) | `GET /api/calendar` ready arm (`server/routes/calendar-routes.ts:496`) | `profile.target_exam_date`, `profile.timezone` (`packages/shared/src/calendar/api.ts:253`) | `useCalendar` (calendar page only) | `calendar_access` | OK. Omit when null; `setup_required` needs a no-countdown state |
| Today's plan rows, minutes, day total (paid) | `GET /api/calendar?from=today&to=today` | `days[0].blocks[]`: `block.id`, `block_type`, scope, `target_count`, `status`; `estimates.*_seconds_per_unit` | `useCalendar` | `calendar_access` | OK |
| Per-row Start, "Start today's plan" (paid) | `POST /api/calendar/blocks/:id/launch` (`calendar-routes.ts:793`) | `engine`, `session_id`, `next`, `resumed` | `useLaunchBlock` | `calendar_access` | OK. The primary launches the first block not `completed`; there is no day-level launch |
| Mastery, wide rows (paid) | `GET /api/students/:id/mastery/domains` (`server/routes/student-resources.ts:289`) | `domains[].{section, domain, displayName, levelKey, level}` | `client/src/lib/masteryApi.ts:77` (mastery page) | `mastery_detail` (402 for free; the free Home must not call it) | OK |
| Pick up where you left off (paid) | practice `GET /api/practice/sessions/open` (`practice-canonical.ts:2168`); review `GET /api/review/sessions/open` (`review-canonical.ts:1467`); exam `GET /api/tests/forms` (`exam-runtime-routes.ts:375`) | `sessions[].{id, mode, section, total_items, answered_items}`; exam `forms[].latest_session` | `useActiveSessions`, `useActiveReviewSessions`, `fetchExamForms` | practice/review free; exam paid | PARTIAL: no session criteria for a name (OQ-22). The client must drop `mode === "diagnostic"` |
| Right panel: projected range (both plans) | `GET /api/students/:id/projections/sections` (`student-resources.ts:456`) | `sections[].projectedScoreLow/High`, summed by `projectedRange` | dashboard uses `/api/progress/projection` instead | ungated (`student-resources.ts:153`) | OK on this route. `/api/progress/projection` must not be used: OQ-36, F-51 |
| "Your target is N" (paid) | `GET /api/calendar` | `profile.target_score` (nullable) | `useCalendar` | `calendar_access` | OK |
| This week strip, "N of 7 days done" (paid) | `GET /api/calendar?from=<Mon>&to=<Sun>` | `days[].{local_date, status, planned_count}` | `useCalendar` | `calendar_access` | OK |
| Recent sessions, "N to review", See all (paid) | nearest: `GET /api/review/pool` (`review-canonical.ts:1413`) | `sessions[].{source_engine, local_date, local_time, mode, open_count}` | review page only | free | **MISSING**: the pool lists only sessions that still have open misses. OQ-23 |
| Diagnostic card, "N of 40 answered" (free) | `GET /api/practice/sessions/open` (diagnostic rows are `mode: "diagnostic"`) | `answered_items`, `total_items` | none | free | OK |
| Start diagnostic; when to show the card (free) | `POST /api/practice/diagnostic/sessions` (`server/routes/diagnostic-routes.ts:67`); visibility from `estimateStatus` on `/api/progress/projection` | `sessionId` / `existingSessionId`; `estimateStatus` | `useDiagnosticStart`; `lyceon-dashboard.tsx:223-229` | free | OK, reading `estimateStatus` only. What the free Home shows after the diagnostic is OQ-39(c) |
| How Lyceon works, Go to practice / review (free) | static | none | none | free | OK |
| Locked mastery card (free) | static; opens the modal (`mastery`) | none | none | free | OK (needs the modal) |
| Today's quota ruler, "N of 40 left" (free) | **none**. `limit/remaining/resetAt` appear only in the 402 body (`practice-canonical.ts:1150-1166`, `:1508-1520`) | — | `usePractice.quotaExhausted` (a boolean after a 402) | free 40/day | **MISSING**: OQ-21 |
| "Review is unlimited" (free) | static (review has no quota, `server/index.ts:664-670`) | none | none | free | OK |

## 4. Practice

| Element | Backing endpoint | Field(s) | Client today | Entitlement | Status |
|---|---|---|---|---|---|
| Section switch; domain and skill dropdowns (cascade) | `GET /api/practice/topics` (`server/routes/practice-topics-routes.ts:44-92`) | `sections[].{section, label, domains[].{domain, skills[]}}`; names only, no counts | `client/src/pages/practice.tsx:138-192` | free | OK. The route scans every `servable_questions` row with no range (`:46-48`): §8 F-56. Changing domains does not prune chosen skills (client) |
| Difficulty | static; request `difficulties[]` | — | `practice.tsx:85-106` | free | OK |
| Criteria chips, Clear all, "Your session" summary | client state | none | chips at `practice.tsx:549-605`; summary absent | free | Client only |
| Questions per session (5–30, step 5) | `POST /api/practice/sessions` (`practice-canonical.ts:2356-2429`) | `target_question_count`; free clamped to the remaining quota (`:1494-1543`) | offers 5/10/20/30 (15 and 25 missing) | free and paid | OK server. A pool smaller than the request silently yields fewer items (`:1619-1623`): OQ-35 |
| Start | same | `sections, domains, skills, difficulties, target_question_count, client_instance_id, idempotency_key`; errors 402 quota, 422 `PRACTICE_POOL_EMPTY`, 403 `SESSION_LIMIT_EXCEEDED` | `usePractice.ts:88-134` | free and paid | OK |
| Free quota line | **none** | — | upgrade prompt only after a 402 | free | **MISSING**: OQ-21 |
| Suggested for you (paid: two lowest domains) | `GET /api/students/:id/mastery/domains?section=` | `domains[].level` | none on this page | `mastery_detail` | OK server; client picks the two lowest (ordering of `level: null` is a client call) |
| Recent practice ("N to review", "Review what you missed") | nearest: `GET /api/review/pool` | `sessions[].open_count` | none on this page | free | **MISSING**: same gap as Home recent sessions, OQ-23 |
| Open sessions (named by criteria; Continue / End) | `GET /api/practice/sessions/open`; `POST …/terminate` (`:2431-2504`) | `sessions[].{id, section, mode, status, created_at, target_question_count, total_items, answered_items}` | `useActiveSessions`; `practice.tsx:304-391` | free | PARTIAL: no criteria, OQ-22 |
| Right panel: compact mastery / locked card | `GET /api/students/:id/mastery/domains` | `level`, `levelKey`, `displayName` | none on this page | `mastery_detail` | OK (client) |
| "How practice counts" | static | none | none | free | Client only |

## 5. Question runner (practice and review)

| Element | Backing endpoint | Field(s) | Client today | Entitlement | Status |
|---|---|---|---|---|---|
| Back to Practice / Review (no full reload) | none | none | `window.location.assign` (`client/src/components/layout/PracticeShell.tsx:34`, `:55`) | — | Client only |
| Session name ("Math: Algebra") | practice `GET …/sessions/:id/state` (`practice-canonical.ts:2643-2721`); review `GET /api/review/sessions/:id/state` (`review-canonical.ts:1610-1665`) | only `section`, `mode` | "Resuming Math Session"; review hardcodes "Review Session" | — | **MISSING**: OQ-22 |
| Question N of M, progress strip | `GET …/next` (practice `:2023-2036`, `:2149-2162`; review `:822-835`) | `ordinal`, `totalQuestions` | `useCanonicalPractice.ts:472-477` | free (each served question costs 1 of 40 for free) | OK via `/next`. `/state` and `/resume` lack `totalQuestions`, so M must come from `/next` |
| Calculator, Reference (Math) | `POST …/calculator-state` (practice `:2506-2591`; review `:1817`) | `calculator_state` | `useCanonicalPractice.ts:667-704` | — | OK |
| Stem, passage, figures | `/next` → `toStudentSafeQuestionDTO` (`practice-canonical.ts:790-829`) | `question.{stem, passage, assets}` | `client/src/components/question-renderer.tsx:175-182` | — | PARTIAL (client): `assets` (stimulus SVGs, tables) reach the client and nothing renders them |
| Choices lettered A–D by position | same DTO | `options[]{id, text}` in served order | no letters render (§1) | — | Client: letter by index. LISA side is Step 0b |
| Submit (disabled until chosen) | `POST /api/practice/answer` (`practice-canonical.ts:4019-4026`); `POST /api/review/answer` (`review-canonical.ts:1864`) | `sessionId, sessionItemId, selectedOptionId \| selectedAnswer, clientAttemptId` | `useCanonicalPractice.ts:497-602` | free | OK |
| Feedback: "Your answer" / "Correct answer" tags, explanation | answer response (practice `:3761-3773`; review `:1095-1105`) | `isCorrect`, `correctOptionId` / `correctAnswer`, `explanation` (post-submit only) | `question-renderer.tsx:186-270` | — | OK (tags are client) |
| Review-queue note on a miss | trigger `trg_practice_item_enqueue_review` (`supabase/migrations/20260921000000_review_queue_runtime.sql:429-481`) | derivable from `isCorrect === false` | not rendered | free | OK (client copy) |
| Skip | `POST …/sessions/:id/skip` (practice `:4027-4034`; review `:1873`) | `skipped, state, stats` | `useCanonicalPractice.ts:591-592` always fetches next | — | PARTIAL: skipping the last item shows "Unable to load session" (§8 F-53) |
| Next / Done | `GET …/next` | 402 when the free quota runs out mid-session; 409 `session_closed` at the end | any non-OK becomes a generic error | free quota | PARTIAL (client): the mid-session 402 is not shown as the quota state |
| Resume, takeover | `GET …/state`, `POST …/resume` (practice `:2244-2354`; review `:1704`) | `sessionItemId, ordinal, question, calculatorState`; 409 `CLIENT_INSTANCE_CONFLICT` | `resume-practice.tsx`; `CanonicalPracticePage.tsx:346-351` | — | OK |
| Keyboard (one hook, UI-45) | none | none | none | — | Client only |
| Score strip | every response's `stats{correct, incorrect, skipped, total, streak}` | own-data counts | `PracticeShell.tsx:75-95` ("N answered", streak) | — | OK. `correct/total` must never be rendered as a ratio |

## 6. Review

| Element | Backing endpoint | Field(s) | Client today | Entitlement | Status |
|---|---|---|---|---|---|
| Queue card "N questions to review", Start | `GET /api/review/pool` (`review-canonical.ts:1413`; built `server/services/review-pool.ts:459-531`); `POST /api/review/sessions` (`review-canonical.ts:1522`) | `total`; request `{mode: "queue"}` → `sessionId` | `client/src/hooks/useReview.ts:111-160`, `:296-304` | free (`server/index.ts:664-670`, no gate, no quota) | OK |
| Open sessions (named), End, Continue | `GET /api/review/sessions/open` (`review-canonical.ts:1467-1519`); `POST …/terminate` (`:1771`) | `sessions[].{id, section, mode, status, total_items, answered_items}` | `client/src/pages/review.tsx:244-318` | free | PARTIAL: `section` is set only for a single-section session; no domains, skills or source date. OQ-22 |
| Review by topic: section switch, domain chips with own counts | `GET /api/review/pool` + `GET /api/practice/topics` | `bySection[{key, count}]`, `byDomain[{key, count}]` (own queue counts); taxonomy has no counts | `review.tsx:138-152`, `:416-447` | free | OK. Chips are single-select today; multi-select is client |
| Start topic session | `POST /api/review/sessions` | `{mode: "filter", filters: {sections\|domains\|skills}}` (`packages/shared/src/review-schema.ts:65-70`) | `review.tsx:482-497` | free | OK |
| Redo a past session, grouped by date, Load more | `GET /api/review/pool?sessions_cursor=` (`review-canonical.ts:1433-1446`; paged `review-pool.ts:612-624`) | `sessions[].{source_engine, source_session_id, local_date, local_time, mode, filters, open_count}`, `sessions_next_cursor` | `review.tsx:534-592` | free | OK. `filters` is raw (§8 F-52). Collapsed list showing 5 is client |
| "Past sessions (N)" | **none**: `sessions` is one page of at most 20 | — | — | free | **MISSING**: OQ-24 |
| Redo | `POST /api/review/sessions` | `{mode: "session", filters: {source_engine, source_session_id}}` | `review.tsx:551-560` | free | OK |
| Right panel: what's waiting by section | `GET /api/review/pool` | `bySection`, `total` | `review.tsx:600-631` | free | OK |
| Right panel: mastery / locked card | `GET /api/students/:id/mastery/domains` | `level` | none | `mastery_detail` | OK (client) |

## 7. Full-Length home

| Element | Backing endpoint | Field(s) | Client today | Entitlement | Status |
|---|---|---|---|---|---|
| Test list | `GET /api/tests/forms` (`exam-runtime-routes.ts:375-383`; service `server/services/exam-runtime-service.ts:695-760`) | `forms[].{test_form_id, name, is_selectable, question_count, sections, latest_session}` | `client/src/features/exam/pages/TestsHomePage.tsx:55` | `exam_full_length` (403 nested) | OK. `question_count` is the form's size, not a bank count |
| Status "Not started" | same | `latest_session === null` | labels.ts | paid | OK |
| Status "In progress: section, module" | `/forms` has `latest_session.state` only; `GET /api/tests/sessions/:id/state` (`exam-runtime-routes.ts:225`) has `active_section`, `sections[].state` | — | "In progress" only | paid | PARTIAL: OQ-32 |
| Status "Completed, score" | `/forms` has no score | — | "Scored" | paid | Conflict: OQ-31 |
| One primary action (Resume, else Start) | `POST /api/tests/sessions` (`:205`), `POST …/modules/:module/start` (`:245`); Resume via `/state` | — | one filled Start per never-taken form | paid | OK server (client) |
| View report | `GET /api/tests/sessions/:id/report` (`server/routes/exam-report-routes.ts:178`) | — | "View scores" | paid | OK |
| Before you start | static; timing from `/forms` `sections`, `break_duration_ms` | — | shown only after a form is chosen | — | Client only |
| Right panel: score history linking to reports | **none**: `/forms` and `GET /api/students/:id/tests` (`student-resources.ts:575`) return the latest attempt per form, no score | — | none | paid | **MISSING**: OQ-30 |
| Right panel: mastery | `GET /api/students/:id/mastery/domains` | `level` | none | `mastery_detail` | OK (client) |
| Free: in-page upgrade card | `/forms` → 403 `{error: {code: "entitlement_required", details: {feature: "exam_full_length"}}}` (`exam-runtime-routes.ts:80-100`, `:146-174`) | `code`, `details.feature` | generic "We couldn't load the tests" (`TestsHomePage.tsx:65-72`) | — | OK server; client keys on the code |

## 8. Exam report (Focus shell)

| Element | Backing endpoint | Field(s) | Client today | Entitlement | Status |
|---|---|---|---|---|---|
| Total /1600, sections /800 | `GET /api/tests/sessions/:session_id/report` (`exam-report-routes.ts:178-190`) → `readExamReport` (`server/services/exam-report-service.ts:372-394`) → `toStudentExamReport` (`packages/shared/src/exam-student-report-schema.ts:77-103`) | `score.total_scaled`, `sections[].scaled` | `ExamReportPage.tsx:254-269` | owner first (bare 403), then entitlement | OK |
| "Lyceon-modeled SAT score" disclosure | same; text from `score_disclosure_versions` | `disclosure.{disclosure_version, summary, full_text_url}` | `DisclosedScore.tsx:31` | same | OK |
| Seven segments per domain | same; `segmentsFilled` inside `toDomainSegments` (`exam-domain-segments.ts:93`, `:126`) from the `exam_domain_breakdown` RPC | `domain_segments[].{section, domain, segments_filled}`, `omitted_domains[]`; `.strict()`, so no `correct`/`total` | `DomainSegments.tsx` | same | OK |
| Domain weight lines (College Board, static) | none needed | — | no constant exists; values in prototype `Report.dc.html:128-137` | — | Client only (static constant) |
| Review your answers | flag only: `review_unlocked`. The Doc 04C §16.1 routes (`/review`, `/review/items`, `/review/items/:question_id`) do not exist | `review_unlocked` | button disabled, "Answer review is coming soon" (`ExamReportPage.tsx:91-113`) | paid | **MISSING**: OQ-33 |
| No percentiles, no correct/total | — | the strict schemas refuse them | — | — | OK |
| Lapsed student | same route → 200 `report_state: "unavailable"`, `unavailable_reason: "entitlement_lapsed"` | `resume_action` is **null** (`exam-report-service.ts:328`) | text only (`ExamReportPage.tsx:298-318`) | 200 for the owner | PARTIAL: OQ-34 |
| Pending status poll | `GET …/report/status` (`exam-report-routes.ts:193`) | `report_state`, `review_unlocked`, `estimated_ready_at` | `ExamReportPage.tsx:55-67` | same | OK |

## 9. Calendar

| Element | Backing endpoint | Field(s) | Client today | Entitlement | Status |
|---|---|---|---|---|---|
| Week/Month, Today, arrows, title | `GET /api/calendar?from&to&device_timezone` (`calendar-routes.ts:496-560`) | `days[].{local_date, status}` | `client/src/features/calendar/api/client.ts:165-176` | `calendar_access` (402 flat) | OK |
| Block category, "15 questions, about 30 min", domain tags | same | `blocks[].block.{block_type, section, target_count, scope.mix[].domain}`; `estimates` | BlockCard | paid | OK. Section-level (cold start) blocks have no domain tags |
| Month view bars | same | `days[].blocks[]` | MonthGrid | paid | OK. Days past the plan horizon are empty, by design |
| Test day ★ (week, month, mini month) | same | `profile.target_exam_date` | not rendered | paid; free has no read | OK paid (client). Free: OQ-25 |
| Edit schedule | `PUT /api/calendar/profile` (`calendar-routes.ts:573-588`) | `makeStudyProfileUpsertSchema`; chips from `bounds` | SettingsSheet | ungated (SCL-130) | OK |
| Regenerate plan | `POST /api/calendar/plan/regenerate` (`calendar-routes.ts:592-634`) | `{idempotency_key}` → `{version_no}` | `useRegeneratePlan` | paid | OK |
| Add block | `PUT /api/calendar/days/:date` (`:707-789`) | `{members[], idempotency_key}` | CreateBlockSheet | paid | OK |
| Click block (launch) | `POST /api/calendar/blocks/:id/launch` (`:793-845`) | `{engine, session_id, next, resumed}` | `useLaunchBlock` | paid | OK |
| Mini month, Show filters | client | — | LeftRail | — | OK |
| Goal card: days until SAT, ★ pill, Target | `GET /api/calendar` | `profile.target_exam_date`, `profile.target_score` | `CountdownFact`, `TargetFact` | paid only | PARTIAL: free has no read once a profile exists. OQ-25 |
| Goal card: Projected (paid) | same | `projection[]` | `ProjectionFact` | paid | OK |
| Goal card: "Training for" dream school | `GET /api/profile/background` (`server/routes/student-background-routes.ts:77-86`) | `dream_schools[position 1].name` | none | student-only, ungated | OK server. UI-S8 hold: OQ-37 |
| Edit goals | `PUT /api/calendar/profile` + `PUT /api/profile/background {dream_school_ids}`; search `GET /api/reference/colleges?q=` | — | profile only | ungated | OK server |
| Free: setup form (test date, target) | `GET /api/calendar` → `setup_required` (`calendar-routes.ts:519-543`) | `defaults`, `entitled` | `SetupPopup` | served before the gate | PARTIAL: once a free student saves, `GET /api/calendar` answers 402 (`:545`), so the form cannot show the saved answers. OQ-25 |
| Free: plan upsell card | `GET /api/calendar` → 402 `entitlement_required`, `calendar_access` | `code`, `details.feature` | `CalendarStates.tsx:25-27` keys on status 402 | 402 | OK server; client must key on the code (SCL-185) |

## 10. LISA

| Element | Backing endpoint | Field(s) | Client today | Entitlement | Status |
|---|---|---|---|---|---|
| Messages | `GET /api/tutor/conversations/:id` (`tutor-runtime.ts:2068`) | messages, `before_message_id` cursor, `next_cursor` | `useConversation` | `tutor_access` (403) | OK |
| Header subject ("Math, today") | list/detail | `title`, `updated_at`; no section field | `chat.tsx:564` | paid | PARTIAL: OQ-39(g) |
| Composer send | `POST /api/tutor/messages` (`:836`) | `SendMessageInput` | `useSendMessage` | paid | OK |
| Typing indicator, disclaimer | client | — | `ThinkingIndicator`, `TutorThreadParts.tsx:408` | — | OK (copy) |
| New session, End session | `POST /api/tutor/conversations` (`:587`); `POST …/:id/end` (`:2452`) | — | `useCreateConversation`, `useEndConversation` | paid | OK |
| History, Show older (UI-16) | `GET /api/tutor/conversations` (`:2238-2440`) | `conversations[]`, `pagination{has_more, next_cursor}` | `useConversations` with `status=active` | paid | OK server. Whether history includes ended sessions is OQ-39(f) |
| Free: headline and "Unlock LISA" | every `/api/tutor/*` → 403 `entitlement_required`, `tutor_access`; under-13 → 403 `age_restriction` first | `code`, `details.feature` | `LisaUpgradeCard` | 403 | PARTIAL: the no-call lock needs OQ-29 |

## 11. Settings

| Element | Backing endpoint | Field(s) | Client today | Entitlement | Status |
|---|---|---|---|---|---|
| Profile: name (read) | `GET /api/profile` | `name`, `display_name` | `UserProfile.tsx` (input disabled) | none | OK |
| Profile: name (save) | `PATCH /api/profile` (`profile-routes.ts:281-520`) | `profileCompletionSchema` (`:134-141`) | none | none | PARTIAL: a name-only save clears `marketingOptIn` (§8 F-54) and re-stamps completion. OQ-28 |
| Profile: test date and target, only when a calendar profile exists (OQ-20) | save `PUT /api/calendar/profile` (ungated); existence/read: only `GET /api/calendar` ready (paid) | `target_exam_date`, `target_score` | none in Settings | read gated | **MISSING** (read): OQ-25 |
| Profile: About you (graduation year, GPA, high school, dream schools) | `GET`/`PUT /api/profile/background`; `GET /api/reference/high-schools`, `/colleges` | `studentBackgroundSchema` | none | student-only | OK server; hidden until UI-S8 closes |
| Account: email | `GET /api/profile` | `user.email` | `UserProfile.tsx` | — | OK |
| Account: sign-in method | **none**. `hasPasswordIdentity` (`server/lib/password-credentials.ts:87-97`) is internal | — | none | — | **MISSING**: OQ-26 |
| Account: change password (hidden for Google-only) | `POST /api/auth/change-password` (`server/routes/supabase-auth-routes.ts:661-743`) | `{current_password, new_password}`; 409 `NO_PASSWORD_IDENTITY` | none | — | OK server. Hiding depends on OQ-26 |
| Account: delete account | `POST /api/account/delete` (`server/routes/account-deletion-routes.ts:285`) | visibility from `/api/profile` `featureFlags`, `pendingDeletion` | `DeleteAccountCard.tsx:44` | — | OK |
| Guardian: link status, code, copy, email it, new code | `GET /api/students/:id/links` (`student-resources.ts:846-929`); `GET …/link-code` (`:708-786`); `POST …/link-code/invite` (`:931-1080`); `POST …/link-code/regenerate` (`:788-845`) | `links[]`; `{code, expiresAt}` | `StudentGuardiansPanel`, `StudentLinkCodePanel` | none | OK |
| Guardian: "what a guardian can see" | static | — | — | — | Copy: OQ-38 |
| Billing: self / guardian / free | `GET /api/billing/status` | `plan`, `currentPeriodEnd`, `effectiveAccess`, `managedBy` | `UserProfile.tsx` uses `hasManageableSubscription`, not `managedBy` | none | OK server (live, §0). Client switches to `managedBy` |
| Billing: Manage billing → Stripe | `POST /api/billing/portal` (`billing-routes.ts:912`) | `{url}`; 409 `NO_STRIPE_CUSTOMER` | `useBillingPortal` | — | OK |
| Billing: See plans | `/upgrade`; `GET /api/billing/plans` | — | `UserProfile.tsx` | — | OK |
| Notifications: Email notifications switch | **none**: no preference storage, and no sender would honour one. `profiles.marketing_opt_in` exists but no sender reads it | — | `EmailNotificationsCard.tsx` (bounce suppression only) | — | **MISSING**: OQ-27 |
| Appearance | none needed | — | none | — | Client only (UI-47) |

## 12. Help

| Element | Backing endpoint | Field(s) | Client today | Entitlement | Status |
|---|---|---|---|---|---|
| Seven FAQs | static. Claims checked against code: deletion email with a recovery link (`account-deletion-routes.ts:316-323`, `:574`); Manage billing (`billing-routes.ts:912`); guardian-managed plans (`:880`) | none | no page | free | OK (client) |
| Contact support | `SUPPORT_EMAIL` (`packages/shared/src/support-contact.ts`), already a `mailto:` elsewhere | none | none | free | OK as `mailto:`. Form vs mailto is OQ-39(d) |
| Policies list | `/legal/privacy-policy`, `/legal/student-terms`, `/legal/trust-and-safety` | none | marketing footer | free | OK |

## 13. Not prototyped (backing only; screenshots go to Karl before merge)

| Page | Backing | Entitlement | Status |
|---|---|---|---|
| Mastery (domain grid, skills per domain) | `GET /api/students/:id/mastery/domains` (`student-resources.ts:289`), `…/mastery/skills` (`:359`) | `mastery_detail` | OK |
| Notifications | `GET /api/notifications` (cursor, 20; `server/routes/notifications.ts:112`), `/unread-count` (`:207`), `/mark-all-seen` (`:236`), `/mark-all-read` (`:269`), `PATCH /:message_id` (`:298`) | free | OK |
| Upgrade / plans | `GET /api/billing/plans` (`billing-routes.ts:1039`), checkout | — | OK |
| Bare-card pages | existing auth and legal routes | — | OK |
| Pending-deletion screen | `GET /api/profile` `pendingDeletion`; `POST /api/account/recover-deletion` (`account-deletion-routes.ts:574`) | — | OK |

---

## 14. MISSING and PARTIAL rows that need the owner

Each item below is in register §9. "New endpoint" and "new field" both need Karl's approval under Brief 13.

| OQ | Gap | Smallest backing change |
|---|---|---|
| OQ-21 | Free quota line and ruler ("N of 40 left today") | Add a `quota: {limit, remaining, resetAt, unlimited}` field to `GET /api/practice/sessions/open`, from `checkAndReservePracticeQuota({dryRun: true})` (`apps/api/src/lib/rate-limit-ledger.ts:146`). Alternative: a new `GET /api/practice/quota` with the same body |
| OQ-22 | Sessions named by their criteria (runner title, open-session rows on Home, Practice and Review) | Add `criteria: {sections, domains, skills, difficulties}` (from `metadata.session_spec` / review metadata) to practice and review `/state` and `/sessions/open`. Never the raw `filters` |
| OQ-23 | Recent sessions (Home) and Recent practice (Practice) | Either relabel the panels as "sessions with questions to review" and reuse `/api/review/pool` (no server change), or a new `GET /api/sessions/recent?limit=5` over finished practice and review sessions, diagnostic excluded |
| OQ-24 | "Past sessions (N)" on Review | Add `sessions_total` to the `/api/review/pool` response, counted before paging (`review-pool.ts:509-530`) |
| OQ-25 | The study profile, read without a subscription (free goal card, free setup form after the first save, Settings' OQ-20 condition) | New `GET /api/calendar/profile` → `{profile: StudyProfile \| null}` from `readStudyProfile`, ungated like `PUT /profile` (SCL-130). No plan data |
| OQ-26 | Sign-in method, and hiding Change password for Google-only (F-38) | Add `hasPassword: boolean` to `GET /api/profile` `user`, from the existing `hasPasswordIdentity` |
| OQ-27 | Email notifications switch | A ruling first: what the switch controls. Nothing stores it and no sender would read it. Smallest truthful option: it is `profiles.marketing_opt_in`, with a narrow write path. Anything wider changes the notifications contract |
| OQ-28 | Name save in Settings | A narrow `PATCH /api/profile/name {displayName}`, or drop the `.default(false)` on `marketingOptIn` so an absent field is left alone (F-54) |
| OQ-29 | Rail lock state with no call to the gated endpoint | Add `features: Record<feature, boolean>` to `GET /api/billing/status`, computed with `canAccessFeature`. Also: which predicate is authoritative for LISA (`isEntitlementActiveForProfile` differs), and what an under-13 student sees on the LISA lock |
| OQ-30 | Full-Length score history | A new paid-gated `GET /api/tests/sessions?state=scored` (Doc 04C §16.3 projection: `session_id, test_form_name, completed_at, total_scaled, rw_scaled, math_scaled, disclosure.summary`). Doc 04C §16.3 defers the multi-session list to V1.1 |
| OQ-31 | "Completed, score" on the Full-Length card | **Conflict.** E7b ruling 2 says state words on the card and never a score (`TestsHomePage.tsx:6`; Doc 04C §15.1 needs the disclosure next to any score). DESIGN.md shows the score. Which stands? |
| OQ-32 | "In progress: section, module" | Client fetches `GET /api/tests/sessions/:id/state` for the one in-progress form (no server change), or add `active_section`/`active_module` to `latest_session` |
| OQ-33 | Exam "Review your answers" | Doc 04C §16.1 routes are not built. In scope for this vertical, or keep the disabled button? |
| OQ-34 | Lapsed student's report has no renewal action | `serializeUnavailable` sends `resume_action: {type: "renew_entitlement", url: null}` (register §2 / OQ-5); the client opens the upgrade modal. One line, server |
| OQ-35 | A practice pool smaller than the request silently yields fewer questions, which shows the pool size | Refuse with a 422, or serve fewer with a "fewer questions match" note and no number |
| OQ-36 | `/api/progress/projection` gives free students the frozen baseline only (`server/routes/legacy/progress.ts:103-116`), against the §2 free-projection ruling, and returns `confidenceBand` | Home moves to `projections/sections` (no server change). Retire `/api/progress/projection` except `estimateStatus`, or ungate it and drop `confidenceBand`? |
| OQ-37 | The calendar's "Training for" dream school and its picker | Held until UI-S8 closes, like "About you"? |
| OQ-38 | The guardian sentence ("your mastery and your test scores") | Since the 2026-09-26 §16 amendment a guardian also sees the plan, target score, test date, projection and streak. Copy to correct |
| OQ-39 | Small choices | (a) "Trust and Safety" → `/legal/trust-and-safety` or `/trust`? (b) Notification bell: where, if anywhere? (c) Free Home after the diagnostic: not prototyped. (d) Contact support: `mailto:` or a form? (e) "See plans": `/upgrade` or Settings → Billing? (f) LISA history: include ended sessions? (g) LISA header subject: drop it, or add a nullable `section`? |

Client-only gaps (no backing change) are left to Wave 4 and 5 and listed in the rows above.
