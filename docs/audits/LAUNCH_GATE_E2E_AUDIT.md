# LAUNCH GATE E2E AUDIT (Proof-only)

## Mandatory grounding
- Repo root: `/workspace/Lyceonai`
- Active branch: `work`
- Git status: clean during collection (see PROOFS verbatim)
- Commit: `3bcc8ac`
- Node: `v22.21.1`
- pnpm: `10.13.1`
- Verbatim outputs: `docs/audits/LAUNCH_GATE_E2E_PROOFS.md`

## Scope note
This audit is evidence-first. Runtime flows requiring live Supabase/Stripe accounts were not fully executable from local static inspection alone; those checks are marked `UNKNOWN` unless proven by command output/tests.

---

### Gate 1: Identity, Roles, Guardian Trust, Entitlements
**Status:** PARTIAL

**User-visible workflow**
1. User logs in at `/login` (client router at `client/src/App.tsx:68-72`).
2. Student/guardian/admin routes are role-gated in UI by `RequireRole` wrappers (`client/src/App.tsx:91-125`).
3. Guardian links/unlinks student and views summary via guardian routes (`server/routes/guardian-routes.ts:74-205`).

**UI evidence**
- Routes: `/login`, `/dashboard`, `/guardian` in `client/src/App.tsx:68-125`.
- Role wrappers: `RequireRole allow=[...]` in `client/src/App.tsx:91-125`.

**Backend evidence**
- Sign-in sets cookies through helper (`server/routes/supabase-auth-routes.ts:247-301`, `server/lib/auth-cookies.ts:3-31`).
- Sign-out clears cookies (`server/routes/supabase-auth-routes.ts:312-327`, `server/lib/auth-cookies.ts:34-62`).
- Session refresh path exists (`server/routes/supabase-auth-routes.ts:359-389`).
- Cookie-only token extraction / bearer rejection (`server/middleware/supabase-auth.ts:32-69`).
- Guardian role and link checks (`server/routes/guardian-routes.ts:14-24`, `:74-205`, `:206-260`).
- Guardian entitlement gate (`server/middleware/guardian-entitlement.ts:9-149`).

**DB evidence**
- `profiles.student_link_code`, `profiles.guardian_profile_id`, FK and self-link prevention constraints (`supabase/migrations/20260102_guardian_link_code.sql:29-110`).
- Unique index for link code and generation triggers (`supabase/migrations/20260102_guardian_link_code.sql:140-189`).
- Audit table creation for guardian link events (`supabase/migrations/20260102_guardian_link_code.sql:199-220`).

**Proofs**
- `LAUNCH_GATE_E2E_PROOFS.md` sections: Grounding, Gate 1 Commands, Test Commands.

**Edge cases tested**
- Missing auth for tutor endpoint → 401 (vitest IDOR regression, proven in PROOFS).
- Bearer-only to `/api/rag` blocked with CSRF/auth path (403 in entitlements regression, PROOFS).
- Invalid credentials / stale cookie / multi-tab logout consistency: `UNKNOWN` (no live account-based curl flow proof captured).

**Failure modes**
- Live session-expiry timing behavior cannot be empirically confirmed from this run; source shows refresh logic but no runtime timing proof.

---

### Gate 2: Canonical Content Layer + Anti-leak
**Status:** PARTIAL

**UI evidence**
- Practice routes exist (`client/src/App.tsx:95-109`).

**Backend evidence**
- Serve question omits answer/explanation via `SafeQuestionDTO` (`server/routes/practice-canonical.ts:44-66`, `:233-311`).
- Submit answer returns correctness and explanation only post-submit (`server/routes/practice-canonical.ts:349-418`, `:495-505`).

**DB evidence**
- Canonical ID added, non-null, unique index, format check (`supabase/migrations/20251222_add_canonical_id_to_questions.sql:6-121`).
- `shared/schema.ts` declares canonical ID unique + answer/explanation fields (`shared/schema.ts:155-194`).

**Edge cases tested**
- Query-param-based reveal bypass: `UNKNOWN` (no runtime endpoint fuzzing output).
- Pre-submit leak: code proof shows omission; runtime proof `UNKNOWN`.

**Failure modes**
- Publish/release lifecycle controls for questions are not proven by route/schema evidence in this audit set (marked gap).

---

### Gate 3: Practice Engine (Flow + Structured Sessions)
**Status:** PARTIAL

**Evidence**
- Session create/continue behavior and next-question selection (`server/routes/practice-canonical.ts:233-305`).
- Ownership enforcement on answer submit (`server/routes/practice-canonical.ts:339-348`).
- Idempotent retry behavior by client attempt ID (`server/routes/practice-canonical.ts:420-446`).
- Persistence tables + unique index + RLS (`supabase/migrations/20260110_practice_canonical_plus_events.sql:8-267`).

**Edge cases**
- Double submit handled in code (duplicate + idempotency path).
- Refresh/resume determinism and rapid prev/next: `UNKNOWN` runtime proof.

---

### Gate 4: Mastery Engine + Adaptive Selection
**Status:** PARTIAL

**Evidence**
- Practice submissions invoke mastery update path (`server/routes/practice-canonical.ts:468-491`).
- Mastery formula and clamping persisted in SQL function (`supabase/migrations/20260210_mastery_v1.sql:116-193`).
- Mastery tables and diagnostic RLS policies exist (`supabase/migrations/20260210_mastery_v1.sql:37-110`).

**Edge cases**
- Retry/race consistency across concurrent submissions: `UNKNOWN` (no concurrency proof run).
- Tutor-chat-only mutation prevention: no direct write path observed here, but not runtime-proven.

---

### Gate 5: AI Tutor + RAG Safeguards
**Status:** PARTIAL

**Evidence**
- Auth + CSRF on tutor endpoint (`server/routes/tutor-v2.ts:184-196`).
- Request schema validation (`server/routes/tutor-v2.ts:14-20`, `:190-196`).
- Reveal policy strips answer/explanation unless admin or prior attempt (`server/routes/tutor-v2.ts:215-238`).
- Route mount enforces auth/role/usage limit (`server/index.ts:272`).

**Edge cases tested**
- Unauthorized tutor access returns 401 in regression test (PROOFS Test Commands).
- Prompt injection, cross-student leak, token runaway: `UNKNOWN` no dedicated runtime adversarial test output.

---

### Gate 6: Full-length Exams + Scoring
**Status:** PARTIAL

**Evidence**
- Full lifecycle endpoints (`server/routes/full-length-exam-routes.ts:44-306`).
- Service docs indicate server-authoritative timing, adaptive M2, anti-leak (`apps/api/src/services/fullLengthExam.ts:1-16`, `:31-71`).
- Exam tables/constraints/RLS (`supabase/migrations/20260213_full_length_exam_hardening.sql:16-257`).

**Edge cases**
- Time expiration mid-question, reconnect resume, and deterministic score recalculation are code-indicated but not proven by live E2E traces in this run (`UNKNOWN`).

---

### Gate 7: Calendar + Study Plan
**Status:** PARTIAL

**Evidence**
- Calendar profile validation + persistence (`apps/api/src/routes/calendar.ts:105-186`).
- Timezone-aware day bounds + streak logic (`apps/api/src/routes/calendar.ts:21-39`, `:188-254`).
- Study profile/plan day tables + RLS (`supabase/migrations/20251227_study_calendar_tables.sql:8-97`).

**Edge cases**
- Regeneration with overrides determinism not fully proven by tests here (`UNKNOWN`).

---

### Gate 8: KPIs + Reporting
**Status:** PARTIAL

**Evidence**
- Progress routes mounted (`server/index.ts:451-458`).
- Guardian summary computes practice minutes/questions/accuracy from server-side queries (`server/routes/guardian-routes.ts:206-260`).
- Progress route computes projection from stored mastery (`apps/api/src/routes/progress.ts:439-532`).

**Failure modes**
- KPI correctness against production dataset cannot be proven in this offline run.

---

### Gate 9: Stripe Payments + Entitlement Enforcement
**Status:** PARTIAL

**Evidence**
- Checkout endpoint in billing routes (`server/routes/billing-routes.ts:222-251`).
- Webhook route mounted before JSON parser (`server/index.ts:96-131`).
- Webhook idempotency check + event log state transitions (`server/lib/webhookHandlers.ts:30-87`, `:230-260`).
- Guardian access gated by entitlement middleware (`server/middleware/guardian-entitlement.ts:68-149`).

**DB evidence**
- Unique entitlement hardening migration (`supabase/migrations/20260108_sprint21_hardening.sql:18-28`).
- `stripe_event_log` table DDL not found in audited SQL set (`UNKNOWN` for schema proof).

---

### Gate 10: Admin Ingestion + QA + Publish Controls
**Status:** UNKNOWN

**Evidence**
- Admin route exists in UI (`client/src/App.tsx:127-135`) and admin APIs are present (`server/admin-review-routes.ts`).
- Explicit publish-state transition model (schema + endpoint + authorization chain) was not conclusively proven by inspected files/commands.

---

### Gate 11: Observability + Privacy-safe Logging
**Status:** PARTIAL

**Evidence**
- Request ID middleware installed first (`server/index.ts:88-90`).
- Structured logger redacts keys containing `authorization|cookie|token` (`server/logger.ts:9-51`, `:156-195`).
- Test logs in PROOFS show request IDs attached on HTTP warnings.

**Failure modes**
- End-to-end proof that no sensitive payload ever reaches raw `console.*` calls is `UNKNOWN` (grep shows remaining `console` usage in codebase).

---

### Gate 12: Trust Center + SEO Surfaces
**Status:** PASS

**Evidence**
- Public trust/legal routes in client router (`client/src/App.tsx:81-88`).
- Footer links to Trust/Legal/Privacy/Terms (`client/src/components/layout/Footer.tsx:16-21`, `:70-80`).
- Canonical/meta SSR injection and legacy redirects (`server/index.ts:169-227`, `:235-239`).

**Failure modes**
- `robots/sitemap/noindex` runtime headers not exhaustively curl-verified here; static SEO route/meta wiring is proven.
