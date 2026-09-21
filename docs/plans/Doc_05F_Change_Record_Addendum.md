# Doc 05F — change-record addendum (server layer, Brief 3)

**Status: proposed. `docs/Spec/` is canonical and read-only; nothing here has been applied to it.**
These are rows for the owner to paste into `Doc_05F_formula_sheet.md` §8, continuing its
numbering from item 19. Items 20–22 were approved in conversation during Brief 3 and had no
durable home until this file; 23–27 arose while building the services and the routes, and
are flagged for ruling rather than presented as settled.

Every row names the artefact that already implements it, so a reader can check the claim
rather than take it.

| # | Doc 05F | Change | Status | Where it lives |
|---|---|---|---|---|
| 20 | §12.1, §15 | `day_regenerate` and `day_reset` had no writer — the two strings appear only in the `calendar_plan_versions.trigger` CHECK. `calendar_regenerate_day(student, date, trigger, generator_version, idempotency_key)` is that writer, one function for both routes because the only difference is the trigger recorded on the version. It takes the same `FOR UPDATE` on the study profile before the ledger read that every other calendar writer takes. | **Owner-approved** (Brief 3, Step 0) | `supabase/migrations/20260917140000` §3; gates Z-22…Z-27 |
| 21 | §10.3, §21 | A new validator mode, `day_regenerate` — mode `generated` minus V-14, and nothing else. V-14 refuses a non-student version owning an overridden date; clearing that override IS the operation of these two routes, and they are student-initiated by §12.1, so the rule is not aimed at them. Separately, `weekly_job_interval_minutes` is bounded 15…**1440** rather than §21's 15…360: the job is a daily Vercel cron and a ceiling the launch value already violates is a ceiling nobody is enforcing. | **Owner-approved** (Brief 3, Step 0) | `20260917140000` §2 and §1; gate Z-25 |
| 22 | §9.1 | The adapter contract is **four** methods: `create`, `activityUnits`, `progress`, `nextLaunchSize`. `matches` and `scopeOf` are served by `unitMatchesBlock` in `@lyceon/shared`, which the §13 allocator already uses — an adapter with its own copy would be a second answer to "did this item count". `allowedPlanSizes` and `estimateSeconds` are not adapter methods either: the generator budgets from the snapshot's `engine_planning`, in PL/pgSQL, and the formula lives there only. | **Owner-approved** (Brief 3, Step 1) | `server/services/calendar/adapters/types.ts` |
| 23 | §10.2, §21 | `generator_version` becomes a `calendar_runtime_config` row, seeded by the migration that defines the formula. It is not a tunable: it is the formula naming its own revision, and its value is that migration's timestamp, so any stored `calendar_plan_versions` row traces to the exact SQL that produced it. Any later migration changing `calendar_compute_plan`, `calendar_compute_plan_fallback`, `calendar_place_full_lengths`, `calendar_plan_to_output` or `calendar_validate_plan` must update the row in the same file. The alternative was a literal in the server, which §17 forbids. | **Proposed** | `20260917140000` §1; gate C-09 (format) + the CI step's filesystem half |
| 24 | §7.1 | §7.1 puts the timezone check "at the route, against `pg_timezone_names`", and the route cannot: that view lives in `pg_catalog`, which PostgREST does not expose. `calendar_is_known_timezone(text)` is the check, so the answer comes from the database that will consume the value (`AT TIME ZONE` in `calendar_build_plan_input`) rather than from a second IANA list in TypeScript. A false answer is sheet item 19's fall-open to `America/Chicago`, never a 400. | **Proposed** | `20260917140000` §3b; `profile-service.ts` |
| 25 | §12.7, §15 | §12.7 defines the acknowledgement watermark and §15 gives `POST /api/calendar/acknowledge` no idempotency key, which is only sound if the write is monotonic — but no writer existed. `calendar_acknowledge_version(student, version_no)` raises `last_acknowledged_nonstudent_version_no` as `GREATEST(current, LEAST(requested, highest accepted))`. The clamp is the part worth reviewing: without it a client could acknowledge version 10⁹ and permanently suppress the §17.4 banner, including for a support rollback it has never been shown. | **Proposed** | `20260917140000` §3c; `plan-service.ts` |
| 27 | §7, §15 | The two regenerate routes are marked "key + rate limit" and §7 names the mechanism (`RateLimitLedger`, Doc 01A Part V), but no LIMIT. Two buckets are seeded: `calendar_plan_regenerate` 20/day and `calendar_day_regenerate` 60/day. **Both numbers need a ruling** — they are not decorative, because `checkAndIncrement` RAISES on an undefined bucket and both routes would otherwise answer 503. Two buckets rather than one shared number because they are different surfaces: the horizon refresh replans the whole fortnight and a student has few honest reasons to do it often, while a day reset touches one date and a student tidying a week can legitimately do it several times in a sitting. One shared quota would let a morning of day edits lock the student out of the refresh button, which is the control they reach for when the plan is wrong. | **Proposed — needs a ruling** | `20260917140000` §6; `calendar-routes.ts` |
| 26 | §15, §17.5 | `GET /api/calendar` needs a pre-setup answer. The §15 response shape requires `profile`, and a student who has never completed setup has no `student_study_profile` row to serve — R-08-04 puts the first generation on the first entitled open *after setup completes*, so the row genuinely does not exist yet. The read service returns `setup_required` and the route answers **404** with `code: "CALENDAR_SETUP_REQUIRED"`, which §17.5's "pre-setup" state renders as the setup sheet over the greyed preview week. **This is the item most worth a ruling** — the alternative is making `profile` nullable in the response schema, which changes the wire contract the client layer is already built against. | **Proposed — needs a ruling** | `read-service.ts`; `calendar.read-service.test.ts` |

## Two decisions recorded here that are NOT spec changes

**The streak service is `server/services/activity-streak.ts`, not `server/services/calendar/streak-service.ts`.**
Brief 3 asked for four services under `services/calendar/`. Sheet §8 item 11 says the streak is
**not calendar-owned**, §14 names this exact path and function (`getStudentActivityStreak`), and
§15 serves it without a `calendar_access` check (INV-08-20) — which is only coherent if it has no
calendar dependency. A copy under `services/calendar/` would make the practice page's streak and
the calendar header's streak two different numbers. The brief's substance is met: it reads
`student_overall_kpi` only, and its test asserts no other table is touched.

**No `computeActivityStreak` was written.** §14 also names pure math in
`packages/shared/src/streak.ts`; sheet item 11 supersedes it. Until SCL-08-E gives Doc 05B a
student-local day boundary and the rest-day skip, the route returns 05B's stored value with
`history_complete: false`. Writing the math now would be a second streak — one stored, one
derived — disagreeing the day they diverge.

## One substitution worth naming

`readDiagnosticState` returns `null` when the diagnostic lifecycle cannot be established, and
§15's response shape has no null for `diagnostic_state`. §17.1 item 2 renders the recommendation
card for every state except `baseline_ready`, so within this surface the three non-ready values
are indistinguishable and the substitution is invisible to the student. The read service
substitutes `baseline_pending` rather than `not_taken`, because `not_taken` is the one claim known
to be harmful — telling a student who finished their diagnostic to take one is the defect
`readDiagnosticState` exists to remove.


## One refactor, recorded because it touches another workstream's file

`singleBucketRateLimit` was a private function inside
`server/middleware/guardian-link-rate-limit.ts`, importable from nowhere. The calendar's
regenerate routes need the same shape, and CLAUDE.md is explicit that the answer to "the
helper already exists" is to consume the canonical one, never to fork a second. It moved
UNCHANGED to `server/middleware/rate-limit.ts` together with the header and 429-body helpers;
the guardian module imports them and its own exports are behaviour-identical. The full suite
was run before and after the move with the same result (2794 passing), so the extraction is
provably neutral.
