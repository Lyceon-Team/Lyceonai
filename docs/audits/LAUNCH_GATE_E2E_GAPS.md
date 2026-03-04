# Launch Gate E2E Gaps

## Mandatory grounding
- Repo root: `/workspace/Lyceonai`
- Active branch: `work`
- Git status: clean during evidence capture
- Commit: `3bcc8ac`
- Node: `v22.21.1`
- pnpm: `10.13.1`
- Verbatim outputs: `docs/audits/LAUNCH_GATE_E2E_PROOFS.md`

## Gap register

### GAP-01 — Missing proven live auth lifecycle curl transcript
- **Severity:** MEDIUM
- **Category:** Security
- **Repro:** Attempted static audit and regression tests; no live credentialed curl transcript proving sign-in → protected success → sign-out → protected fail sequence.
- **Evidence:** Auth endpoints and cookie handlers exist in source (`server/routes/supabase-auth-routes.ts:247-352`, `server/lib/auth-cookies.ts:3-62`), but no captured runtime account flow output in PROOFS.
- **Fix surface:** `server/routes/supabase-auth-routes.ts`, QA script under `scripts/` for deterministic auth smoke.

### GAP-02 — Question publish lifecycle not proven
- **Severity:** HIGH
- **Category:** Data integrity
- **Repro:** Search for `published|release|visibility` in question-serving backend did not produce a clear admin-only publish state transition tied to question API behavior.
- **Evidence:** Command outputs in PROOFS Gate 2; canonical ID schema exists but no explicit publish-gate proof (`supabase/migrations/20251222_add_canonical_id_to_questions.sql`).
- **Fix surface:** Question ingestion/admin routes (`apps/api/src/routes/admin-questions.ts`, `server/admin-review-routes.ts`), question schema migrations.

### GAP-03 — Stripe event log table DDL absent from audited SQL set
- **Severity:** BLOCKER
- **Category:** Billing
- **Repro:** Code references `stripe_event_log` for idempotency; DDL was not found via SQL grep in this run.
- **Evidence:** `server/lib/webhookHandlers.ts:30-87` uses `stripe_event_log`; repo SQL search in PROOFS Gate 9 did not show corresponding `CREATE TABLE`.
- **Fix surface:** Add/verify migration containing `stripe_event_log` + retention/index strategy.

### GAP-04 — Full exam runtime timeout/resume behavior not empirically proven
- **Severity:** MEDIUM
- **Category:** Availability
- **Repro:** Static code and schema show support, but no live end-to-end timer expiration trace captured.
- **Evidence:** Service and route logic exist (`apps/api/src/services/fullLengthExam.ts:1-71`, `server/routes/full-length-exam-routes.ts:44-306`), no runtime timing transcript in PROOFS.
- **Fix surface:** Integration test in `tests/integration` for timeout + reconnect.

### GAP-05 — Admin ingestion stage auditability only partially evidenced
- **Severity:** HIGH
- **Category:** Data integrity
- **Repro:** Admin endpoints exist, but explicit staged ingestion state machine with publish lock and rollback proof is not fully evidenced.
- **Evidence:** PROOFS Gate 10 command output + route existence (`client/src/App.tsx:127-135`).
- **Fix surface:** ingestion pipeline docs/code in `server/admin-review-routes.ts`, `apps/api/src/routes/admin-questions.ts`, migrations for ingestion status fields.

### GAP-06 — Logging safety not proven against all raw console usage
- **Severity:** MEDIUM
- **Category:** Compliance
- **Repro:** Logger includes redaction, but full codebase has raw `console.*` paths that may bypass centralized redaction.
- **Evidence:** `server/logger.ts:9-51` redacts sensitive keys; grep outputs in Gate 11 show broader logging surface.
- **Fix surface:** route/service files still using `console.*`; enforce logger-only lint rule.
