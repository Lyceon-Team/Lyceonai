# WS-0 — Stop the Bleed — Correctness Contract

**Workstream:** WS-0 per `docs/SpecAudit/10-gap-registry/closure-plan.md`
**Closes (pending owner apply + probe):** GAP-TB-01, GAP-TB-02, GAP-TB-03, GAP-ID-11, GAP-TU-06, GAP-MA-09
**Deployed-state evidence:** `docs/SpecAudit/00-supabase-live-state.csv` (capture generated 2026-06-07 03:03:35 UTC). Repo migration SQL is **not** deployed-state evidence. Every object name in the apply script is taken verbatim from this capture; citations below are `capture:<line>`.

This contract enumerates **falsifiable post-conditions** that define correctness independent of implementation. Each post-condition names its proving probe. The DB post-conditions (TB-01/02/03, TU-06, MA-09) are proven by `scripts/probe/ws0-probe.ts` against production **after the owner applies** `supabase/migrations/20260607_ws0_stop_the_bleed.sql`. The ID-11 post-conditions are proven by the route tests in `tests/ci/guardian-consent.id11.contract.test.ts` (run under `pnpm test`), because the forgery vector is an app-layer flow not reachable through anonymous PostgREST.

---

## Shared precondition (proven once, relied on by TB-01/TB-02/TB-03/TU-06)

**P0 — No non-service-role client reads these tables.** Revoking `anon`/`authenticated` access and enabling RLS is safe **only if** the product never reads these tables through the `anon` or `authenticated` PostgREST role. Evidence:

- The browser bundle has **no Supabase data client**. The only `client/src` Supabase file is `client/src/lib/supabase.ts`, which contains **types only** (`export interface SupabaseProfile { … }`) — no `createClient`. Grep for `@supabase`/`createClient` under `client/src` returns only a type import.
- All server reads of the target tables use a **service-role** client (`supabaseServer` / `getSupabaseAdmin` / `getSupabaseClient`, all constructed with `SUPABASE_SERVICE_ROLE_KEY`): `server/routes/questions-runtime.ts:58,167,185,271`, `server/routes/practice-canonical.ts:645`, `server/routes/tutor-runtime.ts:287,1278`, `apps/api/src/services/fullLengthExam.ts:14` (`getSupabaseAdmin`), `apps/api/src/lib/vector.ts:30` (service role), `apps/api/src/lib/supabase-server.ts`.
- The `anon` key is used server-side **only** for `auth.getUser(token)` / sign-in flows (`server/middleware/supabase-auth.ts:84,357`, `server/routes/supabase-auth-routes.ts`), never for `.from(<target table>)` reads.
- `service_role` has `bypasses_rls=true` (capture:8357 — I2). `anon`/`authenticated` have `bypasses_rls=false` (capture:8335,8336). Therefore: enabling RLS and revoking `anon`/`authenticated` grants leaves every service-role read/write path intact, and closes every anonymous/authenticated PostgREST path.

If any anon/authenticated read path had been found, WS-0 would HALT and surface it rather than default-deny. None was found.

---

## GAP-TB-01 — `questions` answer columns not readable by anon or authenticated

Capture state: `questions` `rls_enabled=true` (capture:61); **two** USING-true SELECT policies are present — `questions_select_accessible :: roles={anon,authenticated} :: USING true` (capture:7930) and `questions_select_authenticated :: roles={authenticated} :: USING true` (capture:7933). `anon` and `authenticated` hold the full grant set incl. SELECT (capture:3235–3248). Answer-bearing columns: `correct_answer` (NOT NULL, capture:607), `explanation` (capture:592), `answer_text` (capture:591). The apply script drops both policies (`IF EXISTS`) and `REVOKE ALL` from anon/auth.

- **TB-01.1** With the **anon** key, `GET {SUPABASE_URL}/rest/v1/questions?select=correct_answer,explanation` returns **zero rows or a privilege/RLS error** (HTTP 200 with `[]`, or 401/403/4xx). Probe: `ws0-probe.ts` assertion `TB-01.anon`.
- **TB-01.2** With an **authenticated student JWT** (`TEST_STUDENT_JWT`), the same request returns **zero rows or a privilege error**. Probe: `ws0-probe.ts` assertion `TB-01.auth` (skipped-with-warning if no JWT supplied).
- **TB-01.3** Service-role serializers are unchanged: the routes that read `questions` via service role still function — `server/routes/questions-runtime.ts` (`GET /api/questions/...`) and `server/routes/practice-canonical.ts` materialization. These are proven by the existing app test suite continuing to pass (no anti-leak serializer touched). The probe does **not** hold a service-role key.

## GAP-TB-02 — denormalized answer columns on the three session-item tables not readable pre-submit via PostgREST

Capture state: all three `rls_enabled=true` (practice_session_items capture:54, review_session_items capture:64, full_length_exam_questions capture:35). Self-SELECT policies: `practice_session_items_select_own :: USING (user_id = auth.uid())` (capture:7861); `review_session_items_select_own :: USING (student_id = auth.uid())` (capture:7951); `full_length_exam_questions` exposes **two** public self-SELECT policies `flx_questions_select` (capture:7625) and `questions_select_own` (capture:7652), both `USING (… s.user_id = auth.uid())`. `anon`/`authenticated` hold full grants (practice capture:3039–3052, review capture:3319–3332, flx capture:2507–2520).

Answer-bearing columns enumerated from A2:
- `practice_session_items`: `question_explanation` (capture:501), `question_correct_answer` (capture:507).
- `review_session_items`: `question_correct_answer` (capture:650), `question_explanation` (capture:651).
- `full_length_exam_questions`: `question_answer_text` (capture:327), `question_explanation` (capture:328), `question_correct_answer` (capture:331).

- **TB-02.1** With an authenticated student JWT, selecting any answer-bearing column above from each of the three tables returns **zero rows or a privilege error** (the owning student can no longer self-read their own denormalized answers via PostgREST). Probe: `ws0-probe.ts` assertions `TB-02.practice`, `TB-02.review`, `TB-02.flx` (each requests the answer columns explicitly).
- **TB-02.2** With the anon key the same selects return **zero rows or a privilege error**. Probe: same assertions, anon pass.
- **TB-02.3** Service-role app serializers (`projectStudentSafeQuestion`, the runtime materialization/submit paths) are unchanged and still read via service role — proven by the existing suite.

## GAP-TB-03 — nine RLS-disabled tables get RLS + writes (and unneeded reads) revoked for anon/authenticated

The nine tables and capture evidence (`rls_enabled=false`, full anon/auth grants):

| table | A1 rls_enabled | A7 grants (anon/auth) | runtime read path |
|---|---|---|---|
| `test_forms` | false (capture:83) | capture:3851–3864 | service-role only (`apps/api/src/services/fullLengthExam.ts:741,759` via `getSupabaseAdmin`) |
| `constants_audit_log` | false (capture:21) | capture:2115–2128 | none (written by SECURITY-INVOKER audit triggers running as the privileged updater; capture:4649,4681) |
| `documents` | false (capture:24) | capture:2199–2212 | none in user-facing server (ingestion/workers, service-role) |
| `embeddings` | false (capture:25) | capture:2227–2240 | none in user-facing server |
| `question_classification_updates` | false (capture:58) | capture:3151–3164 | none (offline scripts only) |
| `question_embeddings` | false (capture:59) | capture:3179–3192 | service-role only (`apps/api/src/lib/vector.ts:30`, `apps/api/src/lib/supabase.ts`) |
| `sat_math_topics_ref` | false (capture:66) | capture:3375–3388 | none (0 rows; reference) |
| `sat_rw_skills_ref` | false (capture:67) | capture:3403–3416 | none (0 rows; reference) |
| `sat_sections_ref` | false (capture:68) | capture:3431–3444 | none (0 rows; reference) |

Per-table read decision: **no anon/authenticated SELECT path exists for any of the nine** (table above + P0). Default-deny applies to all nine; no exception is carried.

- **TB-03.1** For each of the nine tables, `rls_enabled = true` after apply. Proven by the apply script's `pg_class.relrowsecurity` verification block; spot-checked at runtime by the probe's write attempts failing.
- **TB-03.2** For each of the nine tables, with the anon key and with an authenticated JWT, `INSERT`, `UPDATE`, and `DELETE` via PostgREST **all fail** (RLS deny + revoked grant → 401/403/4xx, never 2xx). Probe: `ws0-probe.ts` assertions `TB-03.<table>.insert/update/delete`.
- **TB-03.3** SELECT via anon/authenticated returns **zero rows or a privilege error** for all nine (recorded per-table; default-deny). Probe: `ws0-probe.ts` assertion `TB-03.<table>.select`.
- **TB-03.4** `constants_audit_log` audit-write path still works: an UPDATE to `mastery_constants`/`kpi_constants` by a privileged role still produces an audit row (the trigger function is SECURITY INVOKER and the updater bypasses RLS). Proven by MA-09's verification block (trigger enabled) + the owner's post-apply constants reconciliation; not reachable by the anon/auth probe.

## GAP-TU-06 — `tutor_memory_summaries` is server-write-only

Capture state: `rls_enabled=true` (capture:89). Policies: `tutor_memory_summaries_student_insert :: WITH CHECK (student_id = auth.uid())` (capture:8137) — the injection vector — and `tutor_memory_summaries_student_select :: USING (student_id = auth.uid())` (capture:8140). Full anon/auth grants (capture:4019–4032). Sole runtime reference is a **service-role read** at `server/routes/tutor-runtime.ts:1278-1284`.

- **TU-06.1** With an authenticated student JWT, `INSERT` into `tutor_memory_summaries` via PostgREST **fails** (policy dropped + INSERT grant revoked → 401/403/4xx). Probe: `ws0-probe.ts` assertion `TU-06.auth-insert`.
- **TU-06.2** With the anon key, `INSERT` fails. Probe: assertion `TU-06.anon-insert`.
- **TU-06.3** `UPDATE`/`DELETE` by anon/authenticated fail. Probe: assertions `TU-06.*-update`.
- **TU-06.4** The runtime read path (`tutor-runtime.ts:1278-1284`, service-role) still returns memory rows. The student SELECT policy is **left untouched** (out of WS-0 scope) — SELECT grant retained. Proven by the existing tutor suite; not a probe assertion.

## GAP-ID-11 — guardian consent verify is bound to the Stripe session's own metadata

Baseline defect (`server/routes/guardian-consent-routes.ts`): `POST /api/consent/verify-session:110` reads `requestId`+`sessionId` from the body, verifies only that the Stripe session is paid, and **never compares** `session.metadata.requestId` (set at checkout creation `:84`) to the body `requestId` before flipping `guardian_consent_requests.status='approved'` (`:149`) and `profiles.guardian_consent=true` on `child_id` (`:157`).

Owner ruling for this PR (metadata-binding core; **no HMAC token** — `create-checkout-session` is an open mint, so a signature adds nothing against the stated attacker):

- **ID-11.1 — metadata binding / forgery rejection.** verify-session selects the consent request **only** by `session.metadata.requestId`. If the body `requestId` is present and differs from `session.metadata.requestId`, respond **400** with **no DB mutation**. If `session.metadata.requestId` is absent/empty, respond **400** with no mutation. Proven by `guardian-consent.id11.contract.test.ts` → `forged body requestId mismatch → 400, zero update() calls`.
- **ID-11.2 — paid-session-for-another-request rejection.** A paid session whose `metadata.requestId` points at request A cannot approve request B: selection follows metadata, so request B is never touched. Proven by the same test (mutation asserted only against the metadata-derived id).
- **ID-11.3 — pending-state gate.** verify-session approves only when the metadata-derived request is in an approvable (`pending`) state (CHECK domain `pending|approved|expired|revoked`, capture migration). A `revoked`/`expired` request is **not** mutated (respond 400/409). Proven by test `revoked request → not approved`.
- **ID-11.4 — expiry gate.** verify-session rejects when `guardian_consent_requests.expires_at` (NOT NULL, capture:376) is in the past — stale emailed links die — with no mutation. Proven by test `expired request → 400, no mutation`.
- **ID-11.5 — idempotent approve.** Re-running verify-session on an already-`approved` request returns success (`{ success: true }`) **without** re-issuing the approve update / re-linking. Proven by test `replay on approved → success, no second update`.
- **ID-11.6 — happy path.** A paid session whose `metadata.requestId` equals the body `requestId`, for a `pending`, unexpired request, approves it and sets `profiles.guardian_consent=true` on `child_id`. Proven by test `valid metadata-bound flow → approved`.
- **ID-11.7 — input validation.** The body is Zod-parsed (`{ requestId?: uuid, sessionId: string }`); malformed input → 400. Proven by test `missing sessionId → 400`.
- **ID-11.8 — rate limited.** verify-session carries the standard `express-rate-limit` limiter (same library as `server/routes/supabase-auth-routes.ts:17`). Asserted structurally by the test importing the router without error and by code review; 429 semantics on overflow.
- **ID-11.9 — payment-identity binding (detection).** `create-checkout-session` sets Stripe `customer_email` **server-side** from the stored `guardian_consent_requests.guardian_email` (capture:371), so a hijack attempt emits a Stripe receipt to the victim's inbox. Proven by test `create-checkout-session sets customer_email from stored guardian_email`.

**Residual (registered, not closed here):** `requestId` remains an email-delivered **bearer capability** by design — `create-checkout-session` is unauthenticated, so an attacker who already knows a victim's `requestId` can still mint a metadata-matching paid session for $0.50. Metadata binding closes "any paid session approves any request"; full guardian-identity binding of the consent flow is **deferred to WS-3** and must be revisited there. This residual is added to GAP-ID-11 in the registry in this PR.

## GAP-MA-09 — constants-audit triggers fire in replica mode

Capture state (D1): `trg_audit_mastery_constants_changes` on `mastery_constants` and `trg_audit_kpi_constants_changes` on `kpi_constants` are both `[ENABLED (origin)]` (capture:8225,8223) — bypassable under `session_replication_role='replica'`.

- **MA-09.1** After apply, `pg_trigger.tgenabled = 'A'` (ENABLE ALWAYS) for both `trg_audit_mastery_constants_changes` and `trg_audit_kpi_constants_changes`. Proven by the apply script's `pg_trigger` verification block (expected output stated in SQL comments) — owner-run after apply. Not reachable by the anon/auth probe.

---

## Artifact → assertion map

| Artifact | Proves |
|---|---|
| `supabase/migrations/20260607_ws0_stop_the_bleed.sql` | TB-01.*, TB-02.*, TB-03.*, TU-06.1–3, MA-09.1 (DB state) |
| `scripts/probe/ws0-probe.ts` | TB-01.1/2, TB-02.1/2, TB-03.1/2/3, TU-06.1/2/3 (runtime, post-apply, anon + student JWT) |
| `server/routes/guardian-consent-routes.ts` | ID-11.1–9 (implementation) |
| `tests/ci/guardian-consent.id11.contract.test.ts` | ID-11.1–9 (executable proof under `pnpm test`) |
| existing app/anti-leak suite | TB-01.3, TB-02.3, TU-06.4 (service-role paths unbroken) |
| owner post-apply verification block | TB-03.1/4, MA-09.1 |
