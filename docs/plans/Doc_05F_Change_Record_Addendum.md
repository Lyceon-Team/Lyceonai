# Doc 05F — change-record addendum (server layer, Brief 3)

**`docs/Spec/` is canonical and read-only; nothing here has been applied to it.**
These are rows for the owner to paste into `Doc_05F_formula_sheet.md` §8, continuing its
numbering from item 19. Items 20–22 were approved in conversation during Brief 3; the rest
were ruled on by the owner across the 2026-09-22 rounds.

**NOTHING in this file is awaiting a decision any more.** Item 24 was the last open row and
is now approved. Item **16R** is a row of the FORMULA SHEET rather than of this addendum —
its ruling is recorded here because `docs/Spec/` is read-only to this workstream, and the
owner applies it there.

Every row names the artefact that already implements it, so a reader can check the claim
rather than take it.

Every row names the artefact that already implements it, so a reader can check the claim
rather than take it.

| # | Doc 05F | Change | Status | Where it lives |
|---|---|---|---|---|
| 20 | §12.1, §15 | `day_regenerate` and `day_reset` had no writer — the two strings appear only in the `calendar_plan_versions.trigger` CHECK. `calendar_regenerate_day(student, date, trigger, generator_version, idempotency_key)` is that writer, one function for both routes because the only difference is the trigger recorded on the version. It takes the same `FOR UPDATE` on the study profile before the ledger read that every other calendar writer takes. | **Owner-approved** (Brief 3, Step 0) | `supabase/migrations/20260917140000` §3; gates Z-22…Z-27 |
| 21 | §10.3, §21 | A new validator mode, `day_regenerate` — mode `generated` minus V-14, and nothing else. V-14 refuses a non-student version owning an overridden date; clearing that override IS the operation of these two routes, and they are student-initiated by §12.1, so the rule is not aimed at them. Separately, `weekly_job_interval_minutes` is bounded 15…**1440** rather than §21's 15…360: the job is a daily Vercel cron and a ceiling the launch value already violates is a ceiling nobody is enforcing. | **Owner-approved** (Brief 3, Step 0) | `20260917140000` §2 and §1; gate Z-25 |
| 22 | §9.1 | The adapter contract is **four** methods: `create`, `activityUnits`, `progress`, `nextLaunchSize`. `matches` and `scopeOf` are served by `unitMatchesBlock` in `@lyceon/shared`, which the §13 allocator already uses — an adapter with its own copy would be a second answer to "did this item count". `allowedPlanSizes` and `estimateSeconds` are not adapter methods either: the generator budgets from the snapshot's `engine_planning`, in PL/pgSQL, and the formula lives there only. | **Owner-approved** (Brief 3, Step 1) | `server/services/calendar/adapters/types.ts` |
| 23 | §10.2, §21 | `generator_version` becomes a `calendar_runtime_config` row, seeded by the migration that defines the formula. It is not a tunable: it is the formula naming its own revision, and its value is that migration's timestamp, so any stored `calendar_plan_versions` row traces to the exact SQL that produced it. Any later migration changing `calendar_compute_plan`, `calendar_compute_plan_fallback`, `calendar_place_full_lengths`, `calendar_plan_to_output` or `calendar_validate_plan` must update the row in the same file. The alternative was a literal in the server, which §17 forbids. | **RULING 2026-09-22 — approved as built** | `20260917140000` §1; gate C-09 (format) + the CI step's filesystem half |
| 24 | §7.1 | §7.1 puts the timezone check "at the route, against `pg_timezone_names`", and the route cannot: that view lives in `pg_catalog`, which PostgREST does not expose. `calendar_is_known_timezone(text)` is the check, so the answer comes from the database that will consume the value (`AT TIME ZONE` in `calendar_build_plan_input`) rather than from a second IANA list in TypeScript. A false answer is sheet item 19's fall-open to `America/Chicago`, never a 400. | **RULING 2026-09-22 — approved as built** | `20260917140000` §3b; `profile-service.ts` |
| 25 | §12.7, §15 | §12.7 defines the acknowledgement watermark and §15 gives `POST /api/calendar/acknowledge` no idempotency key, which is only sound if the write is monotonic — but no writer existed. `calendar_acknowledge_version(student, version_no)` raises `last_acknowledged_nonstudent_version_no` as `GREATEST(current, LEAST(requested, highest accepted))`. The clamp is the part worth reviewing: without it a client could acknowledge version 10⁹ and permanently suppress the §17.4 banner, including for a support rollback it has never been shown. | **RULING 2026-09-22 — approved as built** | `20260917140000` §3c; `plan-service.ts` |
| 27 | §7, §15 | The two regenerate routes are marked "key + rate limit" and §7 names the mechanism (`RateLimitLedger`, Doc 01A Part V), but no LIMIT. Two buckets are seeded: `calendar_plan_regenerate` 20/day and `calendar_day_regenerate` 60/day. **Both numbers need a ruling** — they are not decorative, because `checkAndIncrement` RAISES on an undefined bucket and both routes would otherwise answer 503. Two buckets rather than one shared number because they are different surfaces: the horizon refresh replans the whole fortnight and a student has few honest reasons to do it often, while a day reset touches one date and a student tidying a week can legitimately do it several times in a sitting. One shared quota would let a morning of day edits lock the student out of the refresh button, which is the control they reach for when the plan is wrong. | **RULING 2026-09-22 — approved as built**, 20/day and 60/day stand | `20260917140000` §6; `calendar-routes.ts` |
| 28 | §12.5 | The weekly-job predicate ships as one SQL function, `calendar_weekly_candidates(p_limit)`, returning `(student_id, period_key, outcome)` where `outcome IS NULL` means generate. §12.5 names three conditions and a Monday-anchored truncation in a per-student timezone — all queries, none of them formula — so they live where the read model can see them rather than being reimplemented in the job. It returns the OUTCOME rather than only the due students, because `calendar_job_runs.outcome` already enumerates three skips and a function that filtered them away would make three of its five values unreachable. | **RULING 2026-09-22 — approved as built** | `20260917140000` §3d; gates Z-28…Z-32 |
| 26 | §15, §17.5 | **A pre-setup student is a 200, not a 404.** `GET /api/calendar` returns a discriminated union on `status`: `{ status: "setup_required", defaults: { timezone, daily_minutes_presets, daily_minutes_min, daily_minutes_max, target_exam_date_max_days } }` or `{ status: "ready", … }`. Owner reasoning: *a student who has not set up has an empty calendar, not a missing one — a 404 makes every fetch hook treat the most common first visit as an error and log it as one.* `timezone` is the `device_timezone` query parameter when `calendar_is_known_timezone` accepts it, else `America/Chicago`; every other default is a `calendar_runtime_config` row, so the setup sheet's chips and the server's own validation cannot disagree. The guardian route returns the same `status` with **no `defaults`** — §16 gives a guardian no write path, so offering the chips would be offering a control that does not exist. `CALENDAR_SETUP_REQUIRED` is gone. The one 404 that remains is the MUTATION path (a write against a student with no profile at all), under its own code `CALENDAR_NO_PROFILE`, so the two situations cannot be conflated. | **RULING 2026-09-22 — reversed the proposal** | `packages/shared/src/calendar/api.ts`; `read-service.ts`; `calendar-routes.ts`; `student-resources.ts` |
| 29 | §12.1 | **System triggers own dates from TOMORROW.** `weekly` and `post_exam` are system-initiated, so they must not replace a block sitting on the student's today. `setup`, `profile_change`, `student_refresh` and `rollback` keep owning from today — the student or an admin asked. Owner reasoning: V-12 and `calendar_carry_started` already protect a *started* block; this closes the gap for an **unstarted** one. **Implemented by narrowing the OUTPUT, not the input date series** — see the note below, which is the part worth reading. A `weekly` version owns 13 dates, not 14: §12.1 gives it "future non-overridden dates in the horizon", and the horizon is `[today, today+13]`. | **RULING 2026-09-22** | `supabase/migrations/20260922000000_calendar_system_triggers_from_tomorrow.sql`; gates Z-33…Z-38, and Z-05/Z-06 updated |
| 16R | §17.6 | **The re-keyed copy table, ruled.** Formula-sheet item 16 re-keyed §17.6 to the vocabulary the generators emit but supplied no sentences, so this row IS the copy. Block keys: `review_due` "Questions you missed earlier are due for a retry." · `exam_review` "Going over what you missed on your last full-length." · `exam_review_placeholder` "Going over what you missed on your last practice test." · `final_rehearsal` "Your last full rehearsal before test day." · `exam_cadence` "A full-length every two weeks keeps you test-ready." · `taper` "Test week: lighter days so you arrive rested." · `cold_start` "We're still learning where you stand — this balances the sections." · `fallback` "A balanced session while we catch up on your progress data." · **`weighted` has NO block-level copy** — it is the key on a practice block that HAS a domain mix, and the mix's per-domain reasons are more specific and already on screen. Domain keys: `weak` "One of your weaker areas right now." · `exploring` "We haven't seen enough of this yet." · `balanced` "Keeping this one moving." · `strength` "You're strong here — a short set keeps it sharp." · `post_exam` "Your last test pointed here." | **RULING 2026-09-22** | `client/src/features/calendar/copy/explanations.ts`; `explanations.test.ts` asserts every key has copy except the one ruled exemption |
| 30 | §15, §16, §17.1 | **`estimates` on BOTH payloads.** §17.1 renders "~N min" on every practice row and neither seconds-per-unit constant was served: `review_estimated_seconds_per_item` is a `calendar_runtime_config` row, `target_seconds_per_question` a `practice_runtime_config` row (Doc 02B §41 owns practice timing; §20 says the calendar references it rather than restating it). Both now travel on `GET /api/calendar` **and** on `GET /api/students/:studentId/calendar` as `estimates`. Owner reasoning: the parent view is identical to the student's, and minutes are not among §16's exclusions — those are controls, explanation copy and the target score. Withholding them was not a protection: with no estimate the card fell back to "Full sitting" for every block type, so a guardian reading a 15-question Math set was told it was a full sitting. | **RULING 2026-09-22** | `packages/shared/src/calendar/api.ts` (`planningEstimatesSchema`); `config.ts`; `read-service.ts`; guardian parity test in `calendar.read-service.test.ts` |
| 31 | §9.2, §13 | **An activity unit is retrieval, never a skip.** The adapters select activity with `status = 'answered'`, not `answered_at IS NOT NULL`. Those read as synonyms and are not: a skipped item also carries a non-null `answered_at` — review has two such rows in production today, and review's handoff puts practice skips into the queue as well. On the old predicate a student could clear a block by skipping through it and §13 would report the work done. `answered_at` remains the unit's `occurred_at`: it was the wrong FILTER, not the wrong timestamp. Changed before practice had any skips, because the first one turns this from a latent defect into silent bad data with no error to notice. | **RULING 2026-09-22** (review handoff H2) | `server/services/calendar/adapters/practice.ts`; `tests/ci/calendar.activity-units.skip.ci.test.ts`, plant recorded in the PR |
| 32 | §9.3 | **`review_due_by_date` joins `servable_questions`.** A queue entry whose question has since been retired or issue-flagged is not servable, so it must not be planned either — the queue stores no question metadata (review ruling 19) and review's prefill joins this same view at serve time. Without the join the generator sizes a review block against rows the engine will refuse to serve, and the block runs short with nothing to explain it. INNER join: "absent from the view" and "retired" are the same answer to the only question being asked. | **RULING 2026-09-22** (review handoff H5) | `supabase/migrations/20260924000000_calendar_review_due_servable_join.sql`, built from the `20260921000000` body with that one edit; gate B-01 green |
| 33 | §21 | **`review_estimated_seconds_per_item` stays 120 at launch.** It errs toward SMALLER review blocks, which is the safe direction: a block that finishes early costs a student nothing, one that overruns the day's budget costs them the rest of the plan. **Revisit once 200 answered review items exist**, measuring `answered_at − served_at` across them. 120 is a planning figure with no observed data behind it yet, and this row is the note that says so rather than letting it calcify into a number nobody remembers choosing. | **RULING 2026-09-22** (review handoff H6) | `calendar_runtime_config`; read through `loadCalendarConfig` |

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


## An open dependency the weekly job cannot satisfy

§12.5 routes a failed per-student run to a **Doc 06C dead-letter**. Doc 06C has not landed:
a repository-wide search finds no dead-letter table, no queue and no enqueue helper. The job
therefore records `outcome = 'failed'` in `calendar_job_runs` with its reason and logs at
ERROR, and nothing is enqueued. The `failed` branch in `weekly-job.ts` is where the enqueue
goes when 06C ships; it is marked in the file rather than left to be rediscovered. This is
stated as a gap, not worked around — inventing a dead-letter table here would be the
hand-rolled infrastructure CLAUDE.md's managed-service rule exists to prevent, and it would
be the wrong shape when the real one arrives.

## The plants (Brief 3 Step 7), each run and reverted

Every one was applied to the working tree, the named gate was run, the failure was observed,
and the change was reverted. A gate that cannot fail is not a gate.

| Plant | Gate that went red |
|---|---|
| (a) the practice adapter forwards `${key}:v2` instead of the key it was given | `calendar.launch-contract.practice.ci.test.ts` — "forwards the idempotency key UNCHANGED" |
| (b) the guardian calendar route serializes through `readCalendar` (the STUDENT type) instead of `readGuardianCalendar` | `student-resources.contract.test.ts` — "the guardian payload really contains the block, and none of §16's withheld keys" |
| (c) `GET /api/calendar` drops its `calendar_access` check | `calendar.routes.contract.test.ts` — "GET /api/calendar answers 402 with the shared CTA payload" |
| (d) the weekly predicate counts `day_edit` as a horizon refresh | `calendar-writer-gates.sql` Z-31 — "a day_edit version suppressed the weekly run" |
| (e) `GET /api/me/streak` acquires a `calendar_access` check | `calendar.routes.contract.test.ts` — "answers 200 for the very caller every calendar route refuses" |
| (f) `launchBlock` computes `seq` from the clock instead of the stored launch rows | `calendar-postgrest-gate.sh` — 3 of its 4 cases, through the real transport |

**Plant (b) is the one worth reading twice.** The generic `ANTI-LEAK /calendar` cases —
the ones driven from the route table over the RULE-4 column list — did **not** fail. RULE-4
is the mastery-score family; `explanation_key` is not in it. Only the explicit §16 case
caught it. A workstream that had relied on the existing anti-leak sweep alone would have
shipped the guardian leak green.

**Plant (d) also reddened a gate it was not aimed at.** Re-creating the function outside the
migration dropped its REVOKE, and Z-19 — the sweep over every `calendar_%` function — caught
the missing grant before Z-31 was reached. That is the fourth time this session a sweep has
caught something a targeted check would not have.


## The crash-retry proof, and what the recorder could not have seen

`scripts/ci/calendar-postgrest-gate.sh` drives `CalendarLaunchService` over
`liveLaunchDeps` against real PostgREST on a real HS256 `service_role` JWT, with real
Postgres carrying genesis and every migration. Exactly one thing is substituted: the first
`linkLaunch` fails, which IS §18's "Created but link failed" and is the one event a test
cannot produce by asking politely.

Writing it surfaced a defect in a **fixture pattern already in the repository**. The
existing `calendar.launch-contract.practice.ci.test.ts` seeds questions with
`options: '["A","B","C","D"]'`, and the `questions_item_shape_chk` CHECK accepts that — but
`parseCanonicalMcOptions` skips any element without both a `key` and a `text`, so those
options parse to **zero**, `isCanonicalRuntimeQuestion` drops every row, and the practice
engine answers 422 `empty_pool`. That contract test never noticed because it asserts the SQL
filter directly and never serves a question. Only actually creating a session through the
engine can see it. The new fixture uses `{key, text}` objects and says why in a comment.

Two more schema facts the transport corrected: `questions` has `skill_codes`, not `skill`;
and the practice engine stores its idempotency key as `session_start_idempotency_key` inside
`practice_sessions.filters`, not in a column of its own. Each of those was a green mocked
assumption until a real query ran.


## Why item 29 narrows the output instead of the date series

The obvious implementation — start the `generate_series` in `calendar_persist_version` at
`v_today + 1` for the two system triggers — **does not work**, and fails in the worst
direction. It was built and measured before the migration was written:

```
weekly, live body      → {"generator":"deterministic_v1", "validator_result":"accepted"}
weekly, series + 1     → {"generator":"fallback_v1", "validator_result":"rejected",
                          "violations":[{"date":"<today>","rule":"V-01",
                                         "detail":"date is outside generated_for.dates"}]}
                         → version written REJECTED, owning ZERO dates
```

`calendar_compute_plan` never reads `generated_for.dates`. It loops
`FOR v_i IN 0 .. k_horizon_days - 1` over `p_today + v_i`, and `p_today` comes from the
snapshot's own `today`, which `calendar_build_plan_input` sets from the profile clock
independently of the `p_dates` it was handed. So narrowing the *input* narrows only what
V-01 will **accept**, never what the generator **emits** — the primary is rejected, the
fallback is rejected for the same reason, and `calendar_current_plan` (accepted only) never
sees the new version. **The weekly job would fail for every student, forever.**

`calendar_compute_plan` is the formula and is byte-locked by the parity gate's 6018
comparisons, so it is not the thing to change. The answer is the pattern
`calendar_regenerate_day` already uses: let the generator reason over the whole horizon,
then narrow the output. V-01 is a *membership* test and `v_gen_dates` is read at exactly one
place in `calendar_validate_plan` — that test — so there is no completeness rule requiring
every `generated_for` date to appear, and dropping one validates cleanly.

Gate **Z-34** exists because of this: it asserts the weekly version is `accepted` and
`deterministic_v1` and owns a non-empty date set *before* asserting it does not own today.
Asserting only "weekly does not own today" passes just as well when the version was rejected
and owns nothing at all. The literal implementation was planted and Z-34 caught it, naming
the cause.

## Two gates this ruling changed, and why that is not loosening them

**Z-05** asserted "exactly one version owns every date" after `setup` then `weekly`. That is
now false by construction and correctly so: today stays on the setup version and the rest
moves to the weekly one, because `calendar_current_plan` resolves ownership *per date*. The
gate now asserts the exact ownership — today on the setup version, every future date on the
weekly one — which still reddens on a stale version lingering over a date it no longer owns,
and additionally reddens if a third version appears.

**Z-06** started **today's** block and expected `weekly` to carry it. After the ruling there
is no later version of today to carry it onto — the block is protected *more* strongly, by
never being owned. Z-06 now starts a strictly-future block, which is where carrying is what
protects a started block, and new gate **Z-38** covers the today case directly.
