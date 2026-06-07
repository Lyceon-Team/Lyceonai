# Claude Code Verification Pass

**Worktree SHA:** `be91469fb7e9cd3847d5fa54cc31b4bb46dc97ac` — run from `git rev-parse HEAD` = `05201943dbdb6a8399764656f91ffe939f53b5ea` (audit-docs commits atop `be91469`; `git diff --stat be91469 HEAD` excluding `docs/SpecAudit/01-code-audit-claude/` is empty → audited code tree == `be91469`).
**Date:** 2026-06-07
**Ground truth:** `docs/Spec/` (read-only) + `docs/SpecAudit/00-supabase-live-state.csv` (read-only; **the only evidence of deployed DB state**; H1 = 0 applied migrations, so repo migration SQL is never deployed-state evidence). Read-only run; no fixes, no recommendations.

---

## VP-01 — Under-13 / minimum-age / guardian-consent enforcement on the tutor surface

**Verdict: PARTIAL**

**(1) Controlling spec rules.** Doc 03 — LISA §12.1: *"LISA is a Paid-tier-only feature at V1 launch. Free accounts have no LISA access."* §12.2 (Access Check Contract): *"entitlement.tier = 'paid' AND entitlement.status = 'active' AND student.age >= 13 AND student.billing_address.country IN (Tier 1 country set) — All four conditions must hold."* §12.5: *"Accounts with age < 13 have no LISA access."* §12.4: *"Guardians have zero LISA access of any kind."* Doc 03B §0.2: INV-03-07 (age 13 minimum) and INV-03-08 (Tier-1 country) *"enforced inside V8 `canAccessFeature`."* Doc 01 V6 §17: under-13 with `guardian_consent=false` → 403 on all feature routes incl. tutor. Doc 02B §21: *"Tutor is premium-only across all surfaces … Server validates premium entitlement before any tutor interaction."*

**(2) Entry points.** Mount `server/index.ts:303-309`: `app.use("/api/tutor", ragLimiter, requireSupabaseAuth, requireStudentOrAdmin, doubleCsrfProtection, tutorRuntimeRouter)`. Routes in `server/routes/tutor-runtime.ts`: `POST /conversations` (`:789`), `GET /conversations/:id` (`:878`), `GET /conversations` (`:924`), `POST /conversations/:id/close` (`:976`), `POST /messages` (`:1016`); plus in-process `tutorHardThrottle` (`:263`).

**(3) Per-route enforcement (identical chain on all five):**
| Condition | Enforced? | Where |
|---|---|---|
| Authenticated | YES | `requireSupabaseAuth` (`server/index.ts:304`) + `requireRequestUser` per route |
| Guardian excluded | YES | `requireStudentOrAdmin` (`server/index.ts:305`) |
| Entitlement (paid active) | YES | `ensureTutorEntitlement` → `resolvePaidKpiAccessForUser` (`server/services/kpi-access.ts:52-68`), per route (`tutor-runtime.ts:797,885,931,983,1023`) |
| Under-13 **without** consent | YES | `requireStudentOrAdmin` → `supabase-auth.ts:578` blocks `is_under_13 && !guardian_consent && !isAdmin` |
| **Absolute age ≥ 13** (LISA floor) | **NO** | no standalone `is_under_13` denial anywhere; `ensureTutorEntitlement` checks only paid access (`kpi-access.ts:52-68`) |
| **Tier-1 country** (INV-03-08) | **NO** | no country check on the tutor path |

**(4) Upstream.** `requireStudentOrAdmin` fires on every `/api/tutor/*` route, so the COPPA case (under-13 + no consent) has no bypass. But the gate is the **composite** `is_under_13 && !guardian_consent`; an exported `requireConsentCompliance` (`supabase-auth.ts:529-548`) exists but is **never mounted**. The Doc 03 §12.2 absolute age floor and §12.5 (*"age < 13 have no LISA access"*, regardless of consent) are not enforced: an under-13 student who has completed COPPA consent (`guardian_consent=true`) passes `requireStudentOrAdmin` and reaches all five tutor routes; country gating is likewise absent.

**Basis for PARTIAL:** auth + entitlement + guardian-exclusion + under-13-without-consent are enforced; the LISA-specific **age-≥13 minimum** and **Tier-1 country** conditions (Doc 03 §12.2/§12.5, INV-03-07/08) are not. The broad claim "reachable without age/consent gating" is false; the narrow age-floor/country gating is confirmed absent.

---

## VP-02 — `tutor_memory_summaries` writers and RLS posture

**Verdict: CONFIRMED**

**(1) Capture.** A1 (`:89`): `tutor_memory_summaries | table | rls_enabled=true | 0 rows`. A7 (`:4019-4032`): `anon` and `authenticated` each hold `INSERT/UPDATE/DELETE/SELECT`. C1 policies (verbatim):
```
tutor_memory_summaries :: tutor_memory_summaries_student_insert :: PERMISSIVE :: roles={authenticated} :: cmd=INSERT
    USING: (none)
    WITH CHECK: (student_id = auth.uid())
tutor_memory_summaries :: tutor_memory_summaries_student_select :: PERMISSIVE :: roles={authenticated} :: cmd=SELECT
    USING: (student_id = auth.uid())
    WITH CHECK: (none)
```

**(2) Repo write/read trace.** Grep `tutor_memory_summaries` across `*.ts`: the only non-test/script reference is `server/routes/tutor-runtime.ts:1278-1283` — a **`.select(...)`** via `supabaseServer` (service_role), filtered `student_id = user.id`, `limit 3`. There is **no `.insert`/`.upsert`** to this table anywhere in `server/`, `apps/`, or the tutor worker (the compaction route is a stub). 

**(3a) Can `authenticated` self-insert?** YES — `tutor_memory_summaries_student_insert` is `PERMISSIVE … cmd=INSERT … WITH CHECK (student_id = auth.uid())`; RLS=true but this policy permits a row with the caller's own `student_id`. **(3b) Trusted internal writer?** NO — no server-side writer exists; rows can be created only through the student self-insert RLS path.

**(4) Injection vector.** `tutor-runtime.ts:1278-1284` reads `content_json` from this table and feeds it into `normalizedMemory` → `orchestratorPayload.memory_summaries` (`:1294+`), which is sent to the LISA orchestrator (Vertex AI). Because the rows are student-insertable and there is no trusted writer, a student can craft `content_json` that flows into their own LISA prompt context. `normalizeMemorySummaries` (`:1284`) is a schema-compat filter, not content sanitization. This makes the table an **injection vector**, not merely a data-integrity issue — contra Doc 03A INV-03-06 (*"LISA's context is resolved from authenticated server-side records only. Client claims … never trusted."*).

---

## VP-03 — `tutor_interactions` live columns (auditor conflict)

**Verdict: REFUTED** (the "verbatim columns were dropped" assertion is false; deployed state retains them)

**Capture A2 — complete column list for `tutor_interactions` (verbatim, `:1146-1155`):**
```
| tutor_interactions | 1  | id                 | uuid                     | NO  | gen_random_uuid() |
| tutor_interactions | 2  | user_id            | uuid                     | NO  |                   |
| tutor_interactions | 3  | mode               | text                     | NO  |                   |
| tutor_interactions | 4  | canonical_ids_used | ARRAY (_text)            | NO  | '{}'::text[]      |
| tutor_interactions | 5  | primary_style      | text                     | YES |                   |
| tutor_interactions | 6  | secondary_style    | text                     | YES |                   |
| tutor_interactions | 7  | explanation_level  | integer                  | YES |                   |
| tutor_interactions | 8  | message            | text                     | NO  |                   |
| tutor_interactions | 9  | answer             | text                     | NO  |                   |
| tutor_interactions | 10 | created_at         | timestamptz              | NO  | now()             |
```
A1 (`:88`): `tutor_interactions | table | rls_enabled=true | 0 rows`.

Both verbatim-content columns **exist in deployed state**: `message` (col 8, `NOT NULL`) and `answer` (col 9, `NOT NULL`). Current row count is **0**. Per the capture rule (0 applied migrations), the repo's `20260606_tutor_interactions_drop_verbatim.sql` is not deployed and is not evidence; the deployed table still carries the verbatim columns (and, being `NOT NULL`, any insert must supply them). This also corrects this auditor's own earlier first-pass/CC2 characterization of `tutor_interactions` as "verbatim-stripped."

---

## VP-04 — Entitlement checks on specific routes

**Verdict: CONFIRMED** (entitlement absent on the named read/mutation routes; create-session is the lone exception; RAG tier is spec-silent)

**(1) Spec matrix (Doc 02B §12, lines ~469-488), relevant rows verbatim:** Full-length exams — *Free: No / Premium: Yes*. Review queue access — *Free: No / Premium: Yes*. Domain-level mastery breakdown — *Free: No / Premium: Yes*. Skill-level mastery breakdown — *Free: No / Premium: Yes*. Practice — free with quota (40/day). RAG/similar-question retrieval — **no standalone row**; Doc 02B §21 makes the tutor (its consumer) premium-only. Doc 01 §14: *"Entitlement controls visibility, not computation"* — mastery is computed for all but the breakdown **views** are premium.

**(2)+(3) Per-route table** (all under mount `requireSupabaseAuth` + `requireStudentOrAdmin`, which are identity/role gates, not entitlement):
| Route | Spec tier | Entitlement check | Verdict |
|---|---|---|---|
| `POST /api/full-length/sessions` (create) | Premium-only | PRESENT — `ensureFullLengthPremium` → `resolvePaidKpiAccessForUser` (`full-length-exam-routes.ts:184`) | Enforced |
| `GET /api/full-length/sessions/current` | Premium-only | NONE (`:302-332`) | **ABSENT** |
| `POST /api/full-length/sessions/:id/start` | Premium-only | NONE (`:343-381`) | **ABSENT** |
| `POST /api/full-length/sessions/:id/answer` | Premium-only | NONE (`:394-451`) | **ABSENT** |
| `POST /api/full-length/sessions/:id/module/submit` | Premium-only | NONE (`:526-572`) | **ABSENT** |
| `GET /api/full-length/sessions/:id/review` | Premium-only (full-length + review queue) | NONE; only a completion-state gate in the service (`:722-754`) | **ABSENT** |
| `POST /api/rag/v2` | No standalone spec row (tutor infra; tutor is premium) | NONE (`apps/api/src/routes/rag-v2.ts:63-98`) | **AMBIGUOUS** — spec assigns no tier to standalone RAG |
| `GET /api/me/weakness/skills` | Premium-only (skill breakdown) | NONE (`apps/api/src/routes/weakness.ts:8-31`) | **ABSENT** |
| `GET /api/me/weakness/clusters` | Premium-only (domain breakdown) | NONE (`apps/api/src/routes/weakness.ts:33-61`) | **ABSENT** |

**Nuance (not a softening of the verdict):** the full-length **mutation/read** sub-routes (`answer`, `module/submit`, `current`, `review`, `:id/start`) operate on a session that could only have been created through the entitlement-gated `POST /sessions` (`:184`) — so a *never*-entitled user cannot manufacture one; the confirmed defect is the absence of any **per-request re-check** (a user whose premium lapses mid-exam continues uninterrupted) plus `review` gating only on completion. The two `/api/me/weakness/*` routes have **no such precondition** — they serve premium-only mastery-breakdown views to any authenticated student directly, making them the cleanest confirmed gaps. RAG is recorded AMBIGUOUS because the matrix has no row for retrieval-in-isolation.

---

## VP-05 — Practice serve-before-reserve ordering

**Verdict: CONFIRMED**

Order in `server/routes/practice-canonical.ts`:
- **Session start** (`startOrReplaySession`, handler `:1842`): inserts `practice_sessions` (`:1229`) and all `practice_session_items` (`:1299`), marking item[0] `status: index === 0 ? "served" : "queued"` (`:1284`) — with **no** call to `check_and_reserve_practice_quota` anywhere in session creation.
- **Next-item** (`serveNextForSession`, `:1428`, handler `:2060`): the **new-item** path promotes a queued item to `served` (`:1616`) **then** reserves quota (`reservePracticeQuestionQuota`, `:1637`), rolling the item back to `queued` on denial (`:1647-1655`) before returning (`:1694`) — reserve-before-serve, correct.
- **Secondary (resume) path:** when `getCurrentUnansweredItem` returns an already-`served` item (`:1469-1470`), the handler returns it to the client (`:1524-1541`, `:1552-1565`) **with no quota call on either sub-path.**

Because item[0] is materialized as `served` at session creation without a reservation, the subsequent `/next` lands in the resume branch and returns it without reserving. The reservation gate is reached only for the **2nd+** items (queued→served promotion at `:1637`). Re-fetching the *same* served item is benign; the confirmed serve-before-reserve is the **first item of every session**, and session creation (`POST /sessions`) itself performs no quota reservation — so an item is served on a path where reservation has not succeeded.

---

## VP-06 — Client-trusted identifiers

**Verdict (a) CONFIRMED; (b) PARTIAL**

**(a) Guardian-consent verify — `server/routes/guardian-consent-routes.ts`, handler `:110`.** No auth middleware on the route (handler signature is bare `req: Request`). `const { requestId, sessionId } = req.body` (`:111`) — both client-supplied. `sessionId` is used to retrieve the Stripe checkout session (`:116`); `requestId` looks up `guardian_consent_requests` by `.eq('id', requestId)` (`:134-138`); state changes execute against it: `guardian_consent_requests.status='approved'` (`:149`) and `profiles.guardian_consent=true` on `request.child_id` (`:157`). The handler verifies the Stripe session is paid and the request row exists, but **does not** re-derive ownership against an authenticated principal, and **does not** check `session.metadata.requestId === requestId` (the metadata is set at checkout creation `:84` but never compared). **CONFIRMED** — client-supplied identifiers drive consent state changes without server-side ownership re-validation. *Attacker reach (one sentence):* a caller supplying any known `requestId` plus any paid `sessionId` could flip `guardian_consent=true` for an arbitrary child profile.

**(b) Tutor conversation creation — `server/routes/tutor-runtime.ts`, handler `:789`.** Authentication enforced (`requireRequestUser`, `:791`); the row is inserted with `student_id: user.id` (`:844-856`), so conversation ownership is correctly bound. However, client scope fields (`source_session_id`, `source_session_item_id`, `source_question_row_id`, `source_question_canonical_id`) are normalized (`normalizeScope`, `:805`) and inserted **verbatim** without ownership validation at create time; the ownership-checking helpers (`:369-455`) are invoked only later via `resolveScope` at message-append (`:1085`). **PARTIAL** — the conversation is bound to the authenticated student, but unvalidated client scope IDs are persisted and echoed in `resolved_scope`; content is not read into context until the later `resolveScope` re-validation. *Attacker reach (one sentence):* a student could open a conversation row whose scope references another student's session/question ID, polluting `tutor_conversations`, though the question content itself is not surfaced until the later validated `resolveScope`.

---

## VP-07 — Constants row values

**Verdict: UNVERIFIABLE-PENDING-DATA**

`docs/SpecAudit/00-supabase-live-state-constants.md` does not exist (pre-flight `ls` failed). The CSV capture contains schema (A2) and function bodies (B2) but **no row dump** of `mastery_constants`, `kpi_constants`, `full_length_adaptive_config`, or `test_forms.blueprint`. Per the item's own gate, this comparison is UNVERIFIABLE-PENDING-DATA; stopped.

---

## Summary table

| VP | Verdict | One-line basis |
|---|---|---|
| VP-01 | PARTIAL | Auth/entitlement/guardian/under-13-no-consent enforced (`index.ts:303-309`, `supabase-auth.ts:578`, `kpi-access.ts:52-68`); absolute age-≥13 floor + Tier-1 country gate absent → under-13-with-consent reaches all 5 tutor routes (Doc 03 §12.2/§12.5, INV-03-07/08) |
| VP-02 | CONFIRMED | `tutor_memory_summaries_student_insert WITH CHECK (student_id=auth.uid())` lets `authenticated` self-insert; no server-side writer exists (only a service-role `.select` at `tutor-runtime.ts:1278`); rows feed `orchestratorPayload.memory_summaries` → injection vector (INV-03-06) |
| VP-03 | REFUTED | Deployed `tutor_interactions` retains verbatim `message` (col 8, NOT NULL) and `answer` (col 9, NOT NULL); 0 rows; the "dropped" claim is false (migration unapplied per H1) |
| VP-04 | CONFIRMED | No entitlement gate on full-length `current`/`:id/start`/`answer`/`module/submit`/`review` or `/api/me/weakness/{skills,clusters}` (all premium per Doc 02B §12); only `POST /sessions` create is gated (`:184`); RAG tier spec-silent (AMBIGUOUS) |
| VP-05 | CONFIRMED | Item[0] materialized `served` at session create with no reservation (`practice-canonical.ts:1284`); resume branch serves without quota (`:1470-1566`); reservation only on 2nd+ queued→served (`:1637`) |
| VP-06 | (a) CONFIRMED / (b) PARTIAL | (a) consent verify drives `guardian_consent=true` off client `requestId`/`sessionId` with no auth + no ownership re-validation (`guardian-consent-routes.ts:110,149,157`); (b) tutor conversation bound to `user.id` but client scope IDs persisted unvalidated until `resolveScope` (`tutor-runtime.ts:844,1085`) |
| VP-07 | UNVERIFIABLE | `00-supabase-live-state-constants.md` absent; no config-table row dump in the capture |
