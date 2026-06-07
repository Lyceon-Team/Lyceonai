# Pass 3 — Cross-Document Consistency

**Audit:** Claude state-assessment (read-only)
**HEAD audited:** `be91469fb7e9cd3847d5fa54cc31b4bb46dc97ac` (`2026-06-06 22:37:46 -0500`, Merge #339)
**Live-state ground truth:** `docs/SpecAudit/00-supabase-live-state.csv` (generated `2026-06-07 03:03:35+00`, Postgres 17.6)
**Scope of this pass:** Do implementations honor the corpus's cross-document boundaries — single-canonical-writer per domain, service-layer-only DB access, no restatement of another doc's mechanism, seam contracts between domain families, and the LISA storage boundary (inference in GCP, ALL persistence in Supabase per the Doc 03 ADR-001).

> Evidence discipline: repo claims carry `file:line`; DB claims carry the capture section (A1/A7/B1/C1/D1…) + object name. Severity scheme is provisional (not locked).

---

## CC-P3-001 — Route handlers write DB tables directly; no service layer for practice/review/tutor/calendar

- **Severity:** HIGH
- **Tag:** DRIFT
- **Spec basis:** `docs/Spec/lyceon-coding-standards.md` §2 "Layering Rule (Hard)" — *"Routes/controllers: parse → authz → entitlement check → call pure domain logic … DB access: centralized utilities only — no ad-hoc SQL scattered across handlers"*; §8.1 "Thin Handlers — Fixed Order … No business logic lives in the handler."
- **Evidence:**
  - `server/routes/practice-canonical.ts` — session/item lifecycle persisted inline in the route file: `practice_sessions` insert `:1229`, updates `:987,:1102,:1345`; `practice_session_items` insert `:1299`, updates `:760,:1488,:1617,:1647`; `practice_events` written inline. No `practice-session-service` exists.
  - `server/routes/review-session-routes.ts` — `review_sessions` insert `:521` + updates `:473,:507,:554,:679,:728,:914`; `review_session_items` insert `:627` + updates `:283,:330,:790,:829,:911`; `review_error_attempts` insert `:807`; `review_session_events` insert `:225`.
  - `server/routes/tutor-runtime.ts` — `tutor_conversations` insert `:844`; `tutor_messages` insert `:1128,:1386`; `tutor_instruction_assignments` insert `:1169`; `tutor_question_links` insert `:683`; `tutor_instruction_exposures` insert `:730`.
  - `apps/api/src/routes/calendar.ts` — 183-line write-path `persistGeneratedDays()` lives inside the route: `student_study_plan_days` upsert `:958,:1707`; `student_study_plan_tasks` delete/insert/update `:969,:978,:1757,:1823`; `student_study_profile` upsert `:1128`.
- **Statement:** The Layering Rule requires DB access via centralized utilities and forbids ad-hoc writes in handlers. Practice, review, tutor, and calendar domains persist all state with inline `.from(...).insert/update` calls in the route files, with no service module owning the writes.

---

## CC-P3-002 — `profiles` has four writers across three routes + a lib; no single canonical writer

- **Severity:** HIGH
- **Tag:** DRIFT
- **Spec basis:** `docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust (V6).md` §3 Scope — *"canonical writer consolidation for `profiles`"*; CLAUDE.md "Shared primitives … are single-source-of-truth."
- **Evidence (repo):** `server/lib/profile-bootstrap.ts` (read+update); `server/routes/supabase-auth-routes.ts:127` (update role), `:297` (upsert admin); `server/routes/guardian-consent-routes.ts:156` (update `guardian_consent`); `server/routes/profile-routes.ts:256` (update display_name/role).
- **Evidence (DB):** `profiles` is the live identity table — A1 row count 61; multiple BEFORE-INSERT/UPDATE triggers in D1 (`profiles_set_updated_at`, `set_student_link_code`, `set_student_link_code_update`).
- **Statement:** Doc 01 V6 names profile-writer consolidation as in-scope; the live code has four independent writers of `profiles` spread across three route files and one lib, none designated canonical.

---

## CC-P3-003 — Three concurrent `service_role` Supabase clients (DB-access primitive duplicated)

- **Severity:** MEDIUM
- **Tag:** DRIFT
- **Spec basis:** CLAUDE.md "Unified code across agents & sessions" — *"Shared primitives (… DB utilities, the logger, identity helpers) are single-source-of-truth; extend the canonical definition, don't duplicate it."*
- **Evidence (repo):** `apps/api/src/lib/supabase-server.ts` (`supabaseServer`, SERVICE_ROLE_KEY); `apps/api/src/lib/supabase-admin.ts` (`getSupabaseAdmin()`, SERVICE_ROLE_KEY); `server/middleware/supabase-auth.ts:282` (`supabaseAdmin` proxy, SERVICE_ROLE_KEY) — three separate full-privilege clients, all RLS-bypassing, used concurrently. A fourth older singleton `apps/api/src/lib/supabase.ts` (`getSupabaseClient()`) also exists.
- **Evidence (DB):** `service_role` has `bypasses_rls=true` (capture I2) — every one of these clients holds RLS-bypass authority.
- **Statement:** The standard mandates a single canonical DB primitive; three independent service-role client initializations exist and are used in production simultaneously.

---

## CC-P3-004 — `system_event_logs` written from both routes and a service (3 writers, no owner)

- **Severity:** MEDIUM
- **Tag:** DRIFT
- **Spec basis:** `docs/Spec/lyceon-coding-standards.md` §2 Layering Rule (centralized DB access; one owner per table).
- **Evidence (repo):** `server/routes/guardian-routes.ts:37`; `apps/api/src/services/fullLengthExam.ts:1331`; `apps/api/src/routes/calendar.ts:459`.
- **Evidence (DB):** `system_event_logs` exists, A1 row count 2, "RLS enabled - admin-only access."
- **Statement:** A single audit-log table is written from two route files and one service with no canonical writer.

---

## CC-P3-005 — `guardian_consent_requests` written from two routes

- **Severity:** LOW
- **Tag:** DRIFT
- **Spec basis:** `docs/Spec/lyceon-coding-standards.md` §2 Layering Rule.
- **Evidence (repo):** `server/routes/profile-routes.ts:221` (insert); `server/routes/guardian-consent-routes.ts:149` (update).
- **Statement:** Two route files share write ownership of the consent-request table.

---

## CC-P3-006 — LISA storage boundary: worker is correctly stateless, but verbatim tutor content is retained with no expiry mechanism

- **Severity:** HIGH
- **Tag:** DRIFT
- **Spec basis:** `docs/Spec/Lyceon — Doc 03 ADR-001_ LISA Storage Architecture.md` §3 (GCP holds no durable LISA state; Supabase owns all persistence) and §6 ("Reading B": *"the canonical conversation store legitimately holds verbatim content within the spec'd retention window before pseudonymization"*); Doc 03 §14.2 / INV-03-19 (7-day soft-delete + 90/180/365-day archival, *"Hard delete is automatic at window expiry"*).
- **Evidence (repo):**
  - PASS half: `apps/workers/tutor-orchestrator/src/**` contains **no** Supabase client and persists nothing — `index.ts`, `lib/vertex.ts`, `routes/orchestrate.ts`, `routes/compact.ts` are stateless. Inference-in-GCP / persistence-in-Supabase is honored at the worker.
  - DRIFT half: `server/routes/tutor-runtime.ts:1128` stores the student message verbatim (`message: body.message`) and `:1386` stores the tutor turn verbatim (`message: cleaned`) into `tutor_messages`.
- **Evidence (DB):** `tutor_messages`, `tutor_conversations`, `tutor_memory_summaries` exist (A1) with **no** retention job — pg_cron G1/G2 show `(0 jobs defined)` / `(0 run-history rows)`; no caller of any purge exists (cross-ref **CC-P1** scheduling findings).
- **Statement:** ADR-001 §6 permits verbatim conversation storage *only* as conditioned on the retention/pseudonymization window being enforced. The window-expiry hard-delete required by Doc 03 §14.2 / INV-03-19 is unimplemented, so the verbatim store grows without the bounded-retention guarantee the permission depends on. The worker-side boundary itself is compliant.

---

## CC-P3-007 — Tutor→mastery seam: the ADR-001 `mastery_outbox` path is unimplemented; review writes mastery via direct RPC

- **Severity:** HIGH
- **Tag:** MISSING
- **Spec basis:** `docs/Spec/Lyceon — Doc 03 ADR-001_ LISA Storage Architecture.md` §5 — *"the retry … emits the canonical mastery event to the Supabase `mastery_outbox`. … The cross-platform write boundary is therefore exactly one well-defined path: GCP orchestration → review-engine-mediated event → Supabase outbox."*
- **Evidence (DB):** `mastery_outbox` does not appear anywhere in the capture (0 occurrences across A1 tables and B1 functions).
- **Evidence (repo):** the review engine writes mastery by calling the RPC directly — `server/routes/review-session-routes.ts:864` → `applyLearningEventToMastery(...)` → `apps/api/src/services/mastery-write.ts:74` `.rpc("apply_learning_event_to_mastery", …)`. No outbox table, no outbox enqueue, no outbox consumer exists.
- **Statement:** The single spec'd cross-platform mastery seam (review → `mastery_outbox`) does not exist; mastery is written synchronously via direct RPC from the review route instead of the outbox contract the ADR defines. (The *"LISA never writes mastery directly"* half is honored — see CC-P3-008.)

---

## CC-P3-008 — Mastery write choke-point holds at the TS layer (positive), but a second DB writer remains callable

- **Severity:** MEDIUM
- **Tag:** DRIFT
- **Spec basis:** Doc 05 Parent §6.2 (*"Exactly one canonical write function per Doc 05-owned table. No application code writes these tables directly. CI enforces with grep guard."*); §6.4 / Doc 03 §15.1 (tutor never writes mastery).
- **Evidence (repo, PASS half):** Only `apps/api/src/services/mastery-write.ts:74` invokes a mastery RPC; the tutor runtime (`apps/workers/tutor-orchestrator/**`, `server/routes/tutor-runtime.ts`) imports no mastery writer. Guard tests exist: `tests/mastery.writepaths.guard.test.ts`, `apps/api/test/mastery-writepaths.guard.test.ts`.
- **Evidence (DB, DRIFT half):** Two DB functions both write `student_skill_mastery` — `apply_learning_event_to_mastery` (B1; the one TS calls) and `upsert_skill_mastery`/`upsert_cluster_mastery` (B1, comment *"True Half-Life formula … Beta priors"*). The TS grep-guard cannot prevent a direct DB/dashboard call to `upsert_skill_mastery`. RLS lockdown (`student_skill_mastery :: skill_mastery_no_direct_write :: USING false / WITH CHECK false`, C1) blocks `authenticated`/`anon`, so this is reachable only via `service_role`/`postgres`.
- **Statement:** "One canonical write function per table" is honored in the TypeScript call graph but not in the DB: a second, differently-shaped mastery writer remains installed and invokable by privileged roles. (Formula-correctness of these functions is in Pass 2.)

---

## CC-P3-009 — Two parallel API trees (`server/` and `apps/api/`) — single deployed unit, divergent conventions

- **Severity:** LOW
- **Tag:** AMBIGUITY
- **Spec basis:** `docs/Spec/lyceon-coding-standards.md` §2 Monorepo Layout (Authoritative) distinguishes `apps/api/` (API/BFF) from `server/` (routes, middleware, logger) as separate concerns; CLAUDE.md "one coherent codebase, not several divergent ones."
- **Evidence (repo):** `vercel.json` routes `^/api(?:/.*)?$` → `/api/index`; `api/index.ts` imports `../dist/vercel-api.cjs`, built by `esbuild server/index.ts` (root `package.json` build script). `server/` is the deployed entrypoint; `apps/api/src/routes/{calendar,mastery,weakness,rag-v2}.ts` are mounted into the same Express app and `apps/api/src/services` are imported by `server/` routes (e.g. `server/routes/practice-canonical.ts` imports `apps/api/src/lib/supabase-server`). They are one deployed process, not two services.
- **Statement:** The layout standard frames `apps/api` and `server` as distinct layers; in reality they are a single deployed unit with overlapping responsibilities (two of the three service-role clients live on each side — see CC-P3-003), which is a coherence/convention drift rather than a deployment split. Recorded as AMBIGUITY because the corpus does not state which tree is canonical for routes vs services.

---

### Pass 3 summary

| ID | Severity | Tag | One-line |
|---|---|---|---|
| CC-P3-001 | HIGH | DRIFT | Route handlers write DB directly; no service layer (practice/review/tutor/calendar) |
| CC-P3-002 | HIGH | DRIFT | `profiles` written by 4 sites across 3 routes + lib; no canonical writer |
| CC-P3-003 | MEDIUM | DRIFT | Three concurrent service-role Supabase clients |
| CC-P3-004 | MEDIUM | DRIFT | `system_event_logs` written from 2 routes + 1 service |
| CC-P3-005 | LOW | DRIFT | `guardian_consent_requests` written from 2 routes |
| CC-P3-006 | HIGH | DRIFT | Verbatim tutor store retained with no expiry job (ADR permission unmet) |
| CC-P3-007 | HIGH | MISSING | ADR-001 `mastery_outbox` seam unimplemented; review writes via direct RPC |
| CC-P3-008 | MEDIUM | DRIFT | Second DB mastery writer remains callable despite TS choke-point |
| CC-P3-009 | LOW | AMBIGUITY | `server/` vs `apps/api/` parallel trees, one deployed unit |
