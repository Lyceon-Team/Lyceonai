# Front-of-Wave CODE Audit — current-surface verdicts (WS-2 ∥ WS-3 resume)

> Per the recut loop (RECUT-CONTRACT; GAP-WAVE-MAP), each app-layer **CODE** gap is
> re-audited against the **current** post-genesis surface (grep the whole surface,
> not a diff). The registry still lists these OPEN — this record **verifies** that,
> with current-surface file:line evidence. A gap flips to CLOSED only in its wave's
> owner-proven closure; nothing is flipped here.
>
> Grounding: branch `claude/sweet-tesla-8vktqh`. Two app trees exist (`server/` and
> `apps/api/src/` — AR-04/SP-03); registry file:line refs predate genesis, so every
> location below is re-derived on the live surface.

| Gap | Registry | Current-surface verdict | Wave |
|---|---|---|---|
| EX-05 | OPEN | **OPEN** (confirmed) | WS-2 |
| TU-04 | OPEN | **OPEN** (confirmed) | WS-2 |
| ID-09 | OPEN | **OPEN** (confirmed) | WS-2/4/5 |
| ID-10 | OPEN | **OPEN** (confirmed) | WS-2 |
| MA-06 | OPEN | **PARTIAL** (live math is DB-delegated; residual live literals remain) | WS-3 |

---

## EX-05 — Module-2 adaptive-bucket disclosure — **OPEN**
Two independent disclosure paths on the live surface (bucket value = `easy|medium|hard`,
`DifficultyBucket` at `apps/api/src/services/fullLengthExam.ts:153`):
- **Mid-exam (worst):** `POST /sessions/:id/module/submit` returns `result` unstripped
  (`server/routes/full-length-exam-routes.ts:549`); `result.nextModule.difficultyBucket`
  is set on Module-1 submit (`apps/api/src/services/fullLengthExam.ts:2783`, returned
  `:2816`) — the adaptive routing decision reaches the client **before Module 2 is seen**.
- **Review:** `GET /sessions/:id/review` returns `review` unstripped
  (`full-length-exam-routes.ts:739`); `formattedModules[].difficultyBucket` =
  `m.difficulty_bucket` (`fullLengthExam.ts:3548`).
- **UI badge:** `client/src/components/full-length-exam/FullLengthReviewView.tsx:125`
  — `{module.difficultyBucket && <Badge>Adaptive: {module.difficultyBucket}</Badge>}`.

Fix surface: strip `difficultyBucket` from both responses (server-authoritative) + remove
the badge. The literal "easier/harder" wording in the registry is not used; the
equivalent bucket is disclosed.

## TU-04 — tutor leak filter scope — **OPEN**
- Leak detector `hasDirectAnswerLeak` (`server/routes/tutor-runtime.ts:528-541`) is gated
  by `if (conversation.source_surface === "practice")` **and** `isPreSubmit`
  (`tutor-runtime.ts:1365-1378`). `source_surface` union is
  `practice|review|test_review|dashboard` (`:54`).
- **`review` pre-submit is unfiltered** (no `hasDirectAnswerLeak` gate); `test_review`
  has only a completion-unlock gate (`:1092-1104`), not a content leak filter.
- **Replay endpoint unfiltered:** `GET /conversations/:conversationId`
  (`tutor-runtime.ts:878`) returns each `message: row.message` verbatim (`:915`); only
  `publicTutorMessageContentJson` metadata-strip is applied (`:916`), never the leak
  detector. Non-practice writes are inserted unfiltered (`:1385-1406`), so leaks persist
  and replay.

## ID-09 — entitlement gates on premium routes — **OPEN**
- The spec'd gate `EntitlementService.canAccessFeature(...)` **does not exist** (0 matches
  repo-wide). Canonical `EntitlementService` (`server/services/entitlement-service.ts:41`)
  exposes only `isEntitlementActiveForProfile`. Premium routes gate via the ad-hoc
  `resolvePaidKpiAccessForUser` (`server/services/kpi-access.ts:60`).
- `server/routes/full-length-exam-routes.ts` — only **3 of 11** routes gated:
  gated → `POST /sessions` (`:184`), `GET /sessions` (`:259`), `GET /sessions/:id/report`
  (`:688`). **Ungated** → `current` (`:302`), `start` (`:343`), `answer` (`:394`),
  `calculator-state` (`:457`), `module/submit` (`:526`), `break/continue` (`:583`),
  `complete` (`:633`), **`review` (`:722`)**. Lapse-mid-exam continues uninterrupted.
- `apps/api/src/routes/weakness.ts` — `GET /skills` (`:8`) and `GET /clusters` (`:33`)
  are **ungated** (only `requireRequestUser`); mounted at `/api/me/weakness`
  (`server/index.ts:423-428`) with no entitlement middleware. Premium mastery breakdowns
  served to any authenticated student.

## ID-10 — reserve-before-serve at practice session create — **OPEN**
- Session create `startOrReplaySession` (`server/routes/practice-canonical.ts:1175`)
  materializes item[0] as `served` at insert (`:1488`, `status: index===0 ? "served" :
  "queued"`) and returns (`:1557`) with **no** `reservePracticeQuestionQuota` call in the
  create path.
- The reservation (`reservePracticeQuestionQuota` `:963` → `checkAndReservePracticeQuota`)
  fires only on 2nd+ queued→served promotion (`:1874`, mutate-then-reserve with best-effort
  rollback `:1882-1892`). Resume/state paths return served items unreserved
  (`:1696-1800`, `:2066-2108`, `:2466`). **First item of every session bypasses quota.**

## MA-06 — constants-from-DB — **PARTIAL** (not CLOSED)
Live mastery math is correctly DB-delegated (`apply_learning_event_to_mastery` RPC reads
`mastery_constants`; projections materialized DB-side via `read_projection_constants`).
Residual violations:
- **Live level-boundary literals** `< 40` / `< 70` hardcoded as fallbacks in two mounted
  paths: `apps/api/src/routes/mastery.ts:122-123` (`/mastery/weakest`) and
  `apps/api/src/services/mastery-read.ts:105-106` (`mapMasteryStatusFromLevel`, used by
  `/mastery/skills` and `server/routes/guardian-routes.ts:582`). These are the five
  mastery level boundaries Doc 05 says live in `mastery_constants`.
- **Dead-but-divergent literals** in `apps/api/src/services/mastery-constants.ts`
  (`ALPHA`, `BASE_DELTA`, `HALF_LIFE_WEEKS=6.0`, `MASTERY_STATUS_THRESHOLDS`,
  `DIAGNOSTIC_TOTAL_QUESTIONS=20`, …) — unimported, but a re-import-and-diverge hazard and
  a literal-rule violation.
- **Scheduling/projection-class literals** in `apps/api/src/services/calendar-planner.ts:103-109`
  (`SCORING_WEIGHTS 0.65/0.20/0.15`, horizons, cadence/decay) — live, used in
  `rankSectionCandidates`.

MA-06 closes (WS-3) by reading the level boundaries from `mastery_constants` at the two
live sites and removing the dead literal block; calendar-planner constants are config-class
(needs a calendar `*_runtime_config` decision — none is read in TS today).

---

### Substrate verification for WS-3 wiring (live introspection, this session)
- **MA-04 (05C projections):** `student_section_projections` live with full Doc 05C columns
  (`projected_score_mid/low/high`, `range_width`, `mastery_term`, `fl1/fl2_score`,
  `fl_count_used`, `blend_denominator`, `projection_constants_hash`); RLS = 2 policies.
- **MA-07 (mastery seam):** RE-DISPOSED — canonical seam is the **synchronous**
  `apply_mastery_event` RPC (live); `projection_refresh_outbox` live for the projection
  refresh seam. No `mastery_outbox` by design.
- **ID-02 (mastery RLS half):** `student_domain_mastery` has 2 RLS policies;
  `student_kpi_rollups_current` has **0 policies** (RLS-on, deny-all) — but it is an
  unpopulated shell with no writer (see STEP-2 contract).
- **EX-08 (review substrate):** `review_schedule` + `review_runtime_config` live
  (SM-2 params seeded).
