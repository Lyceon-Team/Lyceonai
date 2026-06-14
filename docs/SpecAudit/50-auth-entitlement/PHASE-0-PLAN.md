# Auth + Entitlement Wave — Phase-0 plan (PLAN MODE; no build)

> Grounded verbatim in the locked corpus (Doc 01 V8 "Identity, Access, Billing & Guardian Trust";
> Doc 01A "Platform Primitives" Part VII) and the already-built genesis primitives, **not** summaries.
> HEAD `4601ab0`. Precedent format: [`../40-ws2-ws3/PHASE-0-PLAN.md`](../40-ws2-ws3/PHASE-0-PLAN.md).
> **Plan only.** No migration, no code, no live apply until the owner approves this plan and rules the
> HALTs. Off cleanup; PRs to cleanup; owner runs any live apply (migrations, secrets, Vercel env).

---

## Central finding (corrects the premise)

"Auth + Entitlement" is **not a fresh build** and **not one of the genesis-recut waves** — the
recut already distributed identity/entitlement gaps across WS-1 (DB, *built*), WS-2/WS-5 (CODE),
and WS-6/WS-8 (consolidation) (`30-genesis-recut/GAP-WAVE-MAP.md` Zone ID). The genesis migration
**already built every identity/entitlement/guardian DB primitive by construction** (CBC-native):
`profiles` ↔ `auth.users`, `entitlements`, `entitlement_features`, `guardian_links`,
`guardian_consent_requests`, `audit_logs`, the `set_profile_age_fields` trigger, RLS-enabled on all
of them, plus the canonical `entitlement_active()` / `guardian_can_view_student()` functions and the
guardian-mirror RLS policies the mastery stack already consumes.

What this wave actually is: **re-point the surviving legacy app-layer auth/entitlement TypeScript
onto the genesis schema, prove RLS end-to-end across four personas, and collapse the entitlement
definition to one canonical source (SP-25).** The recut tore down and rebuilt the DB; per the recut's
own disposition vocabulary, **"what survives the teardown is app-layer code (TypeScript gating,
serializers, service layer — not DB)"** (`GAP-WAVE-MAP.md`). That surviving code in `server/**` now
points at tables/columns the genesis schema renamed or never recreated — that mismatch is the wave.

**The sharpest defect (drives SP-25 + HALT-1):** there are **two** live "is this user entitled?"
definitions and they disagree in **both** directions:

| Definition | Location | "Entitled" set | Includes grace? | Includes trial? |
|---|---|---|---|---|
| Canonical SQL `entitlement_active(uuid)` | `supabase/migrations/20260613010000_05b_domain_mastery_kpi.sql:107` | `status IN ('active','past_due')` | ✅ `past_due` | ❌ `trialing` |
| Legacy TS `isEntitlementActive()` | `server/lib/account.ts` | `plan==='paid' && status IN ('active','trialing')` | ❌ no `past_due` | ✅ `trialing` |

The legacy TS even reads a column genesis does not have (`entitlement.plan`; genesis is
`entitlements.tier`). Collapsing these to one definition — and ruling what the canonical entitled
*set* is — is the spine of this wave.

---

## 1. The identity + entitlement seam map

Three states: **EXISTS** (genesis, canonical, on main — consume, never fork) · **DIVERGENT-LEGACY**
(surviving `server/**` TS that mis-points at the old schema — must be reconciled onto the canonical
primitive) · **UNBUILT** (genesis-aligned flow that does not yet exist).

### 1a. EXISTS — canonical genesis primitives (consume these; do not fork)

| Primitive | Where | What it is |
|---|---|---|
| `profiles` (id PK → `auth.users(id)` ON DELETE RESTRICT; `role` enum; `date_of_birth`, derived `age_years`/`is_under_13`; `stripe_customer_id`; `deleted_at`) | `genesis.sql:139–165` | Canonical identity. Doc 01 V8 §1: "`profiles.id` maps to `auth.uid()`". One profile per human. |
| `set_profile_age_fields()` trigger (`profiles_set_age` BEFORE INSERT/UPDATE OF `date_of_birth`) | `genesis.sql:113–125, 164` | Write-time age derivation. **NULL DOB → `age_years`/`is_under_13` = NULL** (branches before `age()` math). |
| `entitlements` (`profile_id`, `tier ∈ {free,premium}`, `status ∈ {active,past_due,canceled,unpaid,incomplete,incomplete_expired,trialing}`, stripe ids, period, `grace_period_ends_at`) | `genesis.sql:167–183` | Comment line 167: **"writer: Stripe webhook handler."** `idx_entitlements_active` = `status IN ('active','past_due')`. |
| `entitlement_features` (`feature_key`, `required_tier`, `required_age_minimum` dflt 13, `requires_tier_1_country`, `blocked_during_live_exam`, `enabled`) + launch seed (`tutor_access`, `practice_unlimited`, `exam_full_length`, `mastery_detail`, …) | `genesis.sql:185–207` | Doc 01 V8 §27 declarative feature gates — the substrate for a `canAccessFeature` evaluation. |
| `entitlement_active(p_profile_id uuid) → bool` (SQL STABLE SECURITY DEFINER; `status IN ('active','past_due')`; `REVOKE ALL`; `GRANT EXECUTE … service_role`) | `…_05b_domain_mastery_kpi.sql:107–119` | The single canonical entitlement oracle. Owner ruling 2026-06-14: **grace-inclusive**. |
| `guardian_can_view_student(p_student_id uuid) → bool` (active `guardian_links` row where `guardian_profile_id = auth.uid()` AND `student_profile_id = p_student_id` AND `status='active'`) **AND** `entitlement_active(p_student_id)`; SECURITY DEFINER; granted `authenticated, service_role` | `…_05b_domain_mastery_kpi.sql:129–139` | THE guardian gate. "active link AND active student entitlement, single source, can't drift." |
| `guardian_links` (status state machine: `active / pending_student_accept / pending_guardian_accept / revoked`; `initiated_by`; accept/revoke audit cols; `unique_active_link`; `guardian_not_self`) | `genesis.sql:209–229` | Doc 01 V8 §35 — **single** guardian-derivation mechanism. |
| `guardian_consent_requests` (under-13 COPPA: `consent_token`, `…_expires_at`, status) | `genesis.sql:230–242` | Doc 01 V8 §37.2 — consent flow substrate. |
| `audit_logs` (immutable; `audit_logs_no_mutate` trigger) | `genesis.sql:260–276` | Doc 01 V8 §5 identity-event sink. |
| RLS enabled on **all** identity tables; only policy so far: `profiles_select_self` (`id = auth.uid()`); guardian-mirror policies on mastery/KPI consume `guardian_can_view_student()` | `genesis.sql:278–288`; `…_05b…sql:143–148, 278–302`; `…_05c…sql` | Writes are service-role only. **Student-self mastery/KPI reads gate on `student_id = auth.uid()` — identity only, NOT entitlement** (see §2). |
| RLS persona-proof harness (`createTestUser` / `getUserJwt`, plant-as-A / read-as-B) | `tests/rls/rls.spec.ts`, `tests/rls/util/supabaseTestUsers.ts` | The template the end-to-end RLS proof extends. |
| Guardian-gate proof tests (unlinked→403, revoked→403, unpaid→402, expired→402; admin audit emits `{method,path,studentId}` only) | `server/__tests__/guardian-access.test.ts`, `tests/ci/guardian-entitlement.admin-audit.contract.test.ts` | Plant-and-assert discipline to mirror per persona. |
| Env schema (Zod): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CSRF_SECRET` | `packages/shared/src/env.ts` | Single source for env validation. |
| Structured logger w/ `redactSensitive` (redacts `authorization/cookie/token/password/secret/api_key/session/email`, whole `body`) | `server/logger.ts` | "secrets never logged" is already enforceable. |

### 1b. DIVERGENT-LEGACY — surviving `server/**` TS that mis-points (reconcile, don't extend)

| Legacy artifact | Where | Divergence from canonical |
|---|---|---|
| `isEntitlementActive()` | `server/lib/account.ts` | Reads `entitlement.plan` (genesis col is `tier`); set `{active,trialing}` ≠ canonical `{active,past_due}`. **SP-25 / HALT-1.** |
| `resolveLinkedPairPremiumAccessForGuardian/Student`, account split-brain reads (`accounts`/`account_members`/`lyceon_accounts`) | `server/lib/account.ts` | GAP-ID-04: genesis **did not recreate** `accounts`/`lyceon_accounts` (CBC-moot). Guardian link cols in legacy (`student_user_id`,`account_id`) ≠ genesis `guardian_links(student_profile_id)`. |
| `requireGuardianEntitlement` middleware (403/402, admin bypass, audit) | `server/middleware/guardian-entitlement.ts` | Sound shape; must source truth from genesis `guardian_links` + `entitlement_active`, not the legacy account model. |
| `supabaseAuthMiddleware`, `requireSupabaseAuth/Admin/StudentOrAdmin`, `requireConsentCompliance` (cookie-only `sb-access-token`, profile bootstrap) | `server/middleware/supabase-auth.ts` | Functional today; `requireConsentCompliance` **exists but is never mounted** (GAP-TU-08). Re-point profile reads at genesis `profiles`. |
| Signup / signin / signout / refresh / consent / admin-provision | `server/routes/supabase-auth-routes.ts` | Exists and live; must write the genesis `profiles`/`auth.users` shape and enforce DOB at signup (§3, HALT-3). |
| Google OAuth start + callback | `server/routes/google-oauth-routes.ts` | Exists (consent-gated, state cookie, code→Supabase). Maps onto §3 + DOB-enforcement HALT. |
| Route gate consumes ad-hoc premium helper (`kpi-access.ts`) not `canAccessFeature`/`entitlement_active` | per `gap-registry.md` GAP-ID-09; SP-25 follow-up | The TS↔SQL drift to close (§6). |

> Note: `docs/supabase-auth-setup.md` documents the legacy `server/**` runtime as "current" and is
> dated pre-recut; it is the inventory of what exists, not a spec. Genesis is canonical.

### 1c. UNBUILT — genesis-aligned flow that does not yet exist

- **Genesis-aligned profile-on-first-login / signup write path** that produces a genesis `profiles`
  row (role server-set to `student`, DOB captured) — legacy exists but mis-points.
- **DOB enforcement at production signup** (password **and** OAuth) — the WS-1 NULL-DOB ruling assumes
  "production signup enforces a DOB" but the enforcement point itself is unbuilt (§3, HALT-3).
- **Entitlement lifecycle writer** — a single service_role-only canonical transition path
  (create → activate → past_due/grace → canceled) the entitlements table can receive. Today the
  table is "Stripe webhook handler" writer (genesis comment) but **no Stripe webhook exists**
  (no webhook migration/route; legacy `billing-routes.ts` is checkout/portal/status only). §5.
- **Student-self entitlement RLS posture** — there is no authenticated grant on `entitlement_active`
  and no `entitlements` self-SELECT policy; student own-entitlement is enforced **route-side** only.
  Whether RLS should *also* gate student-self premium rows is a design decision (§2, HALT-2).
- **The four-persona end-to-end RLS proof** as one gate (§2).
- **`canAccessFeature` consuming `entitlement_features` + `entitlement_active`** as the single route
  gate (§6, closes SP-25 + GAP-ID-09 app-layer).
- **`guardian_link_audit` table (Doc 01 V8 §35) + the `entitlement_invalidate` NOTIFY on
  `guardian_links` status changes (§36.5)** — both spec-required and **deferred in genesis**
  (`genesis.sql:19–21`: "`guardian_link_audit` … is a DEFERRED identity object"). The step-5 linking
  slice must land them (every status change writes the audit row + emits NOTIFY); step-5 dependency
  under HALT-8 (§10).

---

## 2. The end-to-end RLS proof plan

**The thing this wave must prove** (task): entitled student sees own data; non-entitled student is
gated; guardian sees only their linked **and** entitled student; unlinked/unauth sees nothing.

**Framing correction it must encode (HALT-2).** Genesis enforces this across **two layers**, and the
proof must assert both — collapsing them into "RLS does it all" would be wrong:

- **RLS owns:** (a) **identity isolation** — student-self reads gate on `student_id = auth.uid()`
  (`…_05b…sql:143`), so student A can never read student B; (b) the **guardian-mirror gate** —
  guardian reads gate on `guardian_can_view_student()` = active link AND `entitlement_active(student)`.
- **Route/app layer owns:** the **student's own** entitlement/feature gate. Genesis student-self RLS
  is identity-only by design; a non-entitled student still *owns* their rows, but premium **surfaces**
  are gated by `canAccessFeature`/`entitlement_active` at the route (Doc 01 V8 §27 evaluation order;
  `entitlement_features`). "Non-entitled student is gated" is therefore a **route-gate** assertion,
  not an RLS one.

**The proof = one gate, two complementary suites, same plant-and-assert discipline as the guardian
gate** (mirror `tests/rls/rls.spec.ts` + `guardian-access.test.ts`). It plants real personas via
`createTestUser`/`getUserJwt` and asserts the visibility boundary against a live Supabase — not mocks.

Personas planted: **S1** entitled student · **S2** non-entitled student · **G** guardian (active link
to S1, S1 entitled) · **G2** guardian whose link is `revoked` / student not entitled · **U** unlinked
authenticated user · **anon** (no JWT).

**Suite A — RLS persona-boundary (live DB, JWT per persona):**

| Actor | Target | Expected | Asserts |
|---|---|---|---|
| S1 | own mastery/KPI rows | rows returned | `student_id = auth.uid()` |
| S1 | S2's rows | empty | identity isolation |
| G | S1's mirror rows | rows returned | `guardian_can_view_student(S1)` true (link active AND `entitlement_active(S1)`) |
| G | S2's rows (not linked) | empty | guardian sees only linked |
| G2 | S1's rows | empty | revoked link AND/OR non-entitled student both fail the gate |
| U | anyone's rows | empty | no link, not self |
| anon | anything | denied / empty | RLS + auth |
| any guardian | per-attempt / `mastery_score` internal cols | **no exposure** | aggregate-only invariant (GAP-ID-02) |

**Suite B — route-layer entitlement gate (the "non-entitled student is gated" half):**

| Actor | Premium route (e.g. `tutor_access`, `mastery_detail`, `exam_full_length`) | Expected |
|---|---|---|
| S1 (entitled) | premium surface | 200 |
| S2 (non-entitled) | premium surface | 402/403 from `canAccessFeature`/`entitlement_active` |
| S2 | free surface | 200 (free tier) |
| guardian (entitled-linked) | guardian premium surface | 200 |
| guardian (unlinked/revoked/non-entitled) | guardian premium surface | 403 (no link) / 402 (not entitled) |

**CI form:** runs under the existing RLS harness gate (`canRunRlsTests()` requires
`SUPABASE_SERVICE_ROLE_KEY`); skips cleanly without it, hard-asserts with it. Both suites are the
wave's machine acceptance — same "airtight proof, not asserted" bar as the guardian gate.

---

## 3. Google OAuth via Supabase — wiring plan

Identity provider is Supabase Auth (Doc 01 V8 §9.2 names OAuth among login methods; Google OAuth is
live in `server/routes/google-oauth-routes.ts` + `vercel.json:11–14` — not a §6.1, which does not
exist). The genesis identity model is canonical (`profiles.id = auth.users.id`).

**Redirect flow (consume the existing shape, re-point at genesis):**
1. `GET /api/auth/google/start` — require explicit legal consent (terms+privacy) **before** redirect
   (existing behavior, `google-oauth-routes.ts`); mint a state nonce in an httpOnly cookie.
2. Google → `GET /auth/google/callback` (Vercel routes `^/auth/google/callback$` → `/api/index`,
   `vercel.json:11–14`). Validate state; exchange code; obtain Supabase session.
3. Set `sb-access-token` / `sb-refresh-token` httpOnly cookies (server-side; cookie-only token model
   per `supabase-auth.ts`).

**Profile-on-first-login mapping:**
- On first OAuth login Supabase creates the `auth.users` row; the server creates the **`profiles`**
  row keyed by `auth.users.id` (Doc 01 V8 §9.2 OAuth login; profile bootstrap follows the §9.1
  `profile-service.ts` mechanism) — exactly one profile per human (§2 invariant).
- **Role is server-authoritative** = `student` on self-serve signup; never trust client/OAuth claims
  (`supabase-auth-setup.md`: "Signup and fallback profile bootstrap never assign admin").
- Writing `profiles.date_of_birth` fires `set_profile_age_fields` → derives `age_years`/`is_under_13`.

**DOB enforcement point (the COPPA seam — HALT-3).** OAuth returns **no date of birth**. The WS-1
ruling (`RESEED-MAPPING.md:101–109`, owner 2026-06-09) is explicit: *"a NULL `is_under_13` means
age-unknown and MUST NOT be treated as under-13 — a DOB-less account is not gated … production signup
enforces a DOB, so NULL is a test-data artifact."* So **this wave is where production signup must
enforce DOB**: first OAuth login lands in onboarding that **blocks feature access until DOB is
captured** (and under-13 → the guardian-consent flow before any feature access, Doc 01 V8 §9). The
recurring birthday-transition recompute of `is_under_13` (GAP-SP-08 / GAP-OP-01 scheduler) is **out
of scope — forward-ref to WS-6** (the scheduler substrate); this wave only enforces DOB capture at
signup.

---

## 4. Secrets + service-auth model

**Inventory (verbatim, `supabase-auth-setup.md:15–23` + `packages/shared/src/env.ts`):**
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SITE_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CSRF_SECRET`, `ADMN_PASSCODE` (guarded admin path only).

**Where they live:** Vercel project env (server/serverless scope), validated at startup via the Zod
`envSchema`. Owner-run for any live set/rotate. Redirect URIs that must be registered (owner-side):
Google console `https://<domain>/auth/google/callback`; Supabase provider callback
`https://<project>.supabase.co/auth/v1/callback`; `PUBLIC_SITE_URL` = exact app origin
(`supabase-auth-setup.md:39–48`).

**Hard rule — no `service_role` to the client, ever (existing invariant):**
- Client bundle gets **anon key only**; the browser is governed by RLS. Service_role is server-only
  (Vercel functions under `/api/index`, `vercel.json:6–10`).
- Genesis encodes this: `entitlement_active` is `REVOKE ALL … GRANT EXECUTE … service_role` (no
  authenticated grant); `guardian_can_view_student` is SECURITY DEFINER so a guardian gets a boolean
  without a broad `entitlements` read. The wave **consumes** this; it must not add an authenticated
  grant to `entitlement_active` or expose service_role anywhere reachable by the client.
- Logger `redactSensitive` already redacts tokens/cookies/secrets/email — verify any new auth log
  emits no secret/PII (Coding Standards §12).
- A negative CI guard: assert `SUPABASE_SERVICE_ROLE_KEY` (and any `*_SECRET`) never appears in
  `dist/public/**` (the client output dir, `vercel.json:5`).

**Doc 01A Part VII (internal service auth) — consume, don't restate.** Part VII (§61–§70) is
**service-to-service** HMAC (`X-Lyceon-Service-Id` / `-Timestamp` / `-Signature-V1`, timing-safe,
`/api/internal/*`, not public) and is explicitly **"Not applicable: user-facing API requests"**
(trailing note in §68). User-facing auth here uses Supabase user auth, so Part VII is a forward-ref — it becomes
relevant **only if** the entitlement-transition writer (§5) is later exposed as an internal endpoint
that the billing service calls; if so, it lives under `/api/internal/*` with Part VII HMAC. Flagged
in HALT-5.

---

## 5. Entitlement-lifecycle scope split (+ Stripe forward-ref boundary)

**Confirming the owner's lean — yes, split it this way.** It is the same forward-ref pattern the
WS-2/3 Phase-0 used for cross-wave seams (e.g. "the table + consumer are WS-3; the *emit* is WS-4",
`40-ws2-ws3/PHASE-0-PLAN.md` H4/H5).

**In scope this wave (entitlement state + RLS consumption, settable without Stripe):**
- The genesis `entitlements` table already exists; this wave adds the **single canonical
  service_role-only transition writer** (e.g. a PL/pgSQL `apply_entitlement_transition` or a thin
  service module) that performs create → activate → `past_due`/grace → canceled, idempotently, so the
  end-to-end RLS proof (§2) can **set entitlement state directly** (owner/test-controlled) and verify
  RLS reacts. Writes stay service-role only; the writer-quarantine posture is preserved.
- `canAccessFeature` over `entitlement_features` + `entitlement_active` as the route gate (§6).

**Forward-ref to the billing wave (out of scope, named):**
- **FWD-AE-01 — Stripe emits the transition.** Doc 01 V8 §22: "Stripe webhooks are the authoritative
  trigger for entitlement state changes" (`checkout.session.completed`, `customer.subscription.*`).
  The webhook endpoint, signature verification, and event-ledger dedup that **call** the transition
  writer are deferred to the billing wave. Genesis already reserves the seam: `entitlements` comment
  "writer: Stripe webhook handler"; `account_deletion_requests.stripe_cancellation_status` (A5).
  This wave builds the *receiver*; billing builds the *emitter*.

**State-vocabulary reconciliation (feeds HALT-1).** Doc 01 V8 §22 narrates states as
`premium_trial / premium / past_due / free`; genesis models them as `(tier, status)`. Mapping:
`premium_trial` = `tier=premium, status=trialing`; `premium` = `tier=premium, status=active`;
grace = `status=past_due`; `free` = `tier=free` (or canceled/unpaid). The open question
`entitlement_active` must answer: **is `trialing` entitled?** §22.1 says trial → premium access (yes),
but the canonical fn currently excludes it. Owner ruling required (HALT-1).

---

## 6. SP-25 closure plan

SP-25 (`gap-registry.md` GAP-SP-25; migration comments at `…_05b…sql:103–104`, `…_05c…sql:39`): the
guardian-mirror SQL side is **settled** — owner ruling 2026-06-14 fixed all six guardian-mirror RLS
policies onto the one `entitlement_active` (`{active,past_due}`). The **OPEN residual** is the
follow-up named in the registry: *"the route-layer student premium gate (kpi-access) should consume
the same definition to fully close TS↔SQL drift."*

**Closure in this wave:**
1. **One definition, one place.** The canonical entitled predicate is the SQL `entitlement_active`
   (status set ruled in HALT-1). The TS route gate consumes that single definition — via a
   service_role RPC to `entitlement_active(profile_id)` or a single shared TS predicate whose status
   set is asserted byte-identical to the SQL set by a parity test (the same anti-drift discipline as
   `idx_entitlements_active`).
2. **Retire the fork.** Delete/replace `server/lib/account.ts:isEntitlementActive` (`plan==='paid'`,
   `{active,trialing}`, reads non-existent `plan` col). Route gates (`requireGuardianEntitlement`,
   the ad-hoc `kpi-access` helper, GAP-ID-09 premium routes) consume the canonical predicate +
   `canAccessFeature` over `entitlement_features`.
3. **Parity CI.** A test that fails if the TS entitled-status set ≠ the SQL `entitlement_active` set
   (closes the literal-vs-intent drift permanently). Plus the Suite-B route gate proof (§2).

Result: **one entitlement definition across SQL and TS**, consumed by both the guardian-mirror RLS
and the route gate — the SP-25 close the task calls for. (SQL spec wording in Doc 05B §5.3/§6.6 stays
owner-side in the WS-S spec-revision lock-cycle — tracked via `gap-registry.md` GAP-SP-25 +
`closure-plan.md`; **not** a blocking prerequisite for the SP-25 migration to apply. `docs/Spec` is
read-only.)

---

## 7. HALT items (numbered; owner ruling required before any build)

1. **HALT-1 — the canonical entitled status set (is `trialing` entitled?).** SQL
   `entitlement_active` = `{active,past_due}` (no trial); legacy TS = `{active,trialing}` (no grace);
   Doc 01 V8 §22.1 says trial → premium access. Rule the one canonical set. **Lean:**
   `{active, past_due, trialing}` if trials ship at launch, else keep `{active,past_due}` and treat
   `trialing` as out-of-scope-at-launch. Everything downstream (SP-25, the writer, the proof) keys
   off this.

2. **HALT-2 — student-own-entitlement enforcement layer.** Genesis gates student-self mastery/KPI
   reads on **identity only** (`student_id = auth.uid()`); the student's own premium gate is
   route-layer (`canAccessFeature`). Confirm RLS stays identity-only for student-self (route layer
   owns the entitlement gate) — **or** rule that RLS should *also* gate student-self premium rows on
   `entitlement_active`. **Lean:** keep RLS identity-only + route-layer feature gate (matches Doc 01
   V8 §27 and the existing mastery RLS); the §2 proof asserts both layers.

3. **HALT-3 — the DOB-enforcement point for OAuth signup.** OAuth carries no DOB; WS-1 ruling says
   production signup must enforce one (NULL = age-unknown, not gated; "test-data artifact"). Confirm
   this wave makes first-login onboarding **block feature access until DOB is captured** (under-13 →
   guardian-consent before any access), and that the birthday-transition recompute (GAP-OP-01) is
   forward-ref'd to WS-6. **Lean:** yes — enforce DOB capture at signup here; defer the scheduler.

4. **HALT-4 — entitlement-lifecycle scope split.** Confirm: build the entitlement **state + single
   service_role transition writer + RLS consumption** now (settable directly for the proof), and
   **forward-ref the Stripe-emits-the-transition webhook (FWD-AE-01) to the billing wave.** **Lean:**
   yes (owner's stated lean; matches the WS-4 forward-ref pattern).

5. **HALT-5 — does the transition writer touch Doc 01A Part VII?** If the entitlement writer is ever
   reachable by an internal service (the future billing webhook handler), it must sit under
   `/api/internal/*` with Part VII HMAC (§62–§69). Confirm whether to **stub the `/api/internal/*`
   boundary now** (so billing plugs in cleanly) or leave the writer service-role-internal only and
   wire Part VII in the billing wave. **Lean:** leave writer service-role-internal now; wire Part VII
   with the webhook in billing.

6. **HALT-6 — guardian linking flow scope (six-digit code).** The genesis `guardian_links` state
   machine exists, but the **claim/redemption mechanism** (the "six-digit code" flow the task names)
   is **not** a genesis column — the task references it but genesis carries no `student_link_code` (it
   was a dropped legacy column, `RESEED-MAPPING.md:97`). Confirm whether linking-flow build
   (initiate→accept) is **in scope for this wave** or stays a separate guardian-onboarding slice;
   and confirm the code/redemption mechanism (email token vs short code) since GAP-ID-11's residual
   ("`requestId` remains an email-delivered bearer capability") is the live precedent. **Lean:** scope
   only the *gate consumption* (`guardian_can_view_student`) here; treat the linking-flow build as a
   sibling slice unless you want it folded in.

7. **HALT-7 — deployment topology / "testable live on Vercel".** `vercel.json` deploys the legacy
   `server/**` Express app (via `/api/index`) + the `client/**` bundle, against the **rebuilt**
   genesis DB — so the live app's auth/entitlement TS currently mis-points (§1b). Confirm the wave's
   live target is **re-pointing the deployed `server/**` runtime at genesis** (not standing up a new
   `apps/api` surface), so "testable live on Vercel" means the existing deploy path. **Lean:**
   re-point `server/**`; do not fork a parallel `apps/api` auth surface.

---

## 8. HALT rulings (owner, 2026-06-14) — all 9 ruled; scope expanded

| HALT | Ruling | Scope effect |
|---|---|---|
| **1 — entitled set** | **`{active, past_due, trialing}`.** Launch ships a 7-day **Stripe-native** trial (no custom trial logic). This wave makes `trialing` a first-class entitled state (writer accepts it; RLS + route gates honor it). | Edits the landed canonical `entitlement_active` + `idx_entitlements_active` to add `trialing`; guardian-mirror then honors `trialing` by construction; re-proof with a trialing persona. Trial *mechanics* (`trial_period_days`, `trial_will_end`, trial→active/canceled) = **FWD-AE-01** (billing). |
| **2 — student-self layer** | **Confirmed.** RLS identity-only for student-self; the route layer owns the entitlement gate. | No change to genesis student-self RLS; §2 proof asserts both layers. |
| **3 — DOB point** | **Confirmed, soft-gate.** Signup surfaces DOB; **server-side** blocks feature access until DOB persisted; under-13 → consent before access. The 3-dial picker is a frontend slice consuming the gate; default = `current_date − 13 years` computed **dynamically** (never hardcoded — it drifts). | OAuth-complete-but-no-DOB → blocked persona stands. Birthday-recompute scheduler → WS-6. |
| **4 — lifecycle split** | **Confirmed.** State + writer + RLS now; Stripe emit (incl. trial-start) → billing. | As §5 / FWD-AE-01. |
| **5 — Part VII** | **Confirmed.** Writer stays service-role-internal; Part VII HMAC wired with the billing webhook. | No `/api/internal/*` stub this wave. |
| **6 — guardian linking** | **IN SCOPE (owner-designed).** Bidirectional, two paths: **(a) email-link** — a party enters the other's email in settings → connection link emailed → recipient clicks to connect; **(b) 6-digit code** — student portal shows a code → guardian enters it to connect. Both resolve to a `guardian_links` row transition. Treat code **and** email token as **security-sensitive credentials**: 6-digit code short-lived + single-use + rate-limited/attempt-capped (1M combos = brute-forceable); email token single-use + expiring (GAP-ID-11 precedent). Both verify link direction (guardian-is-guardian; reject self/reversed beyond `guardian_not_self`). Standard invite-flow patterns; no custom logic. | **New build slice** (credential store + flow + proof). Raises **HALT-8** (§10). |
| **7 — topology** | **Confirmed, aggressive.** Build `server/**` to the genesis spec and **delete dead/legacy code** — replace custom forks with the standard pattern consuming the canonical primitive (Supabase-Auth-native, standard OAuth, Stripe-native entitlement; no custom workflows). The `isEntitlementActive` fork, the split-brain account model, the ad-hoc helpers: **deleted and replaced, not re-pointed.** | Deletions sequenced so consumers repoint first → CI green throughout. |
| **8 — guardian-link credential store** | **Approved as proposed; params locked.** One `guardian_link_invites` table; secret **stored hashed, never plaintext**. **Consume the existing canonical `rate_limit_ledger`** (genesis.sql:310; Doc 01A §41) — no forked rate-limiter. **6-digit code:** 10-min TTL, **hard 5-attempt lockout** (code invalidated after 5 fails — enforced server-side, a real lockout, **not** a soft throttle), single-use. **Email token:** 256-bit, 24h TTL, single-use. **v1 restricted to two existing registered accounts**; invite-to-unregistered deferred to a later slice. | Locks the step-5 credential store + rate-limit reuse + the linking-flow proof params. |
| **9 — `trialing` on guardian mirror** | **Confirmed.** `trialing` flows to the guardian mirror via single-source `entitlement_active` — automatic, no exclusion. | Guardian of a `trialing` linked student sees the mirror; asserted by the `trialing` persona in the §2 proof. |

**Branch policy (owner, 2026-06-14):** feature branches cut from **`cleanup`**; PRs target **`cleanup`**, not `main`. (This Phase-0 doc already landed in both via #373/#374.)

## 9. Re-confirmed build order (expanded scope — guardian-linking is now a real slice)

Each step: **contract-first → implement → spec-auditor → Codex → tests → CI**;
`pnpm -s run build && pnpm test`; genesis-fresh-apply for any genesis-extending migration.
Owner runs all live apply (migration, Vercel env, OAuth redirect URIs).

0. **✅ HALT rulings locked (§8).**
1. **SP-25 — single entitlement definition (LEADS; unblocks every gate).** Canonical set
   `{active, past_due, trialing}`: `CREATE OR REPLACE entitlement_active` + rebuild
   `idx_entitlements_active` (new migration; both byte-identical sets); TS consumes the one
   definition (RPC / shared predicate + parity gate); **delete** `isEntitlementActive` + the
   `entitlement.plan` reads; re-run the guardian gate proof with a `trialing` persona.
   → contract: `contracts/auth-entitlement-sp25.contract.md` (this PR).
2. **Entitlement transition writer + RLS consumption.** Service-role-internal, idempotent:
   create → `trialing` → `active` → `past_due`/grace → `canceled`. Settable directly so the proof
   can plant entitlement state without Stripe. Stripe emit = FWD-AE-01.
3. **Re-point + delete legacy `server/**`** auth/entitlement onto genesis (Supabase-Auth-native;
   delete split-brain account model + ad-hoc premium helpers + dead bearer/csrf). Deletions only
   after consumers repoint (CI green throughout).
4. **OAuth + DOB soft-gate onboarding.** Server-side gate (OAuth-complete-but-no-DOB → blocked;
   under-13 → consent). Frontend 3-dial picker (default `current_date − 13y`, dynamic).
   Birthday recompute → WS-6.
5. **Guardian-linking slice (NEW).** Both paths (email-link + 6-digit code) → `guardian_links`
   transition; credential store + single-use/expiry/rate-limit/attempt-cap; direction +
   self/reverse rejection. Depends on HALT-8 ruling.
6. **The two load-bearing proofs (acceptance):**
   (a) **four-persona end-to-end RLS proof** — both suites, airtight-plant (§2), incl. the
   `trialing` persona; (b) **guardian-linking flow proof** — both paths create a valid
   `guardian_links` row; the code is rate-limited/single-use; reversed/self links rejected.
7. **`/grill-me` + `spec-auditor` + Codex** before declaring complete.

## 10. HALTs surfaced by the expanded scope — RESOLVED (owner, 2026-06-14)

8. **HALT-8 — guardian-link credential store + rate-limit primitive (blocks step 5). RESOLVED.**
   Genesis has **no** store for the 6-digit code or the email connection token (`student_link_code`
   was a dropped legacy column, `RESEED-MAPPING.md:97`); `guardian_links` is the *result* state
   machine, not the credential store. **RULED — approved as proposed, params locked:**
   - **One `guardian_link_invites` table** feeding the `guardian_links` transition (both channels):
     `id`, `direction` (`guardian_invites_student` | `student_invites_guardian`),
     `initiator_profile_id`, `channel` (`email_token` | `code`), `target_email` (email path),
     **`secret_hash`** (hash of the code/token — **stored hashed, never plaintext**; GAP-ID-11
     bearer-credential precedent), `expires_at`, `consumed_at`, `attempt_count`, `max_attempts`,
     `created_at`.
   - **Rate limiting:** **consume the existing canonical `rate_limit_ledger`** (genesis.sql:310;
     Doc 01A §41, via the `RateLimitLedger` service §39–§47) — **no forked rate-limiter.**
     *(Corrected 2026-06-14 from the proposed `usage_rate_limit_ledger`, a pre-recut legacy artifact
     genesis did not recreate; the ruling's intent — "consume the existing ledger, no fork" — is
     preserved by pointing at the canonical genesis table.)*
   - **6-digit code:** **10-min TTL; hard 5-attempt lockout** — the code is **invalidated after 5
     failed attempts**, enforced **server-side as a real lockout, not a soft throttle**; **single-use.**
   - **Email token:** **256-bit; 24h TTL; single-use.**
   - **v1 scope:** **two existing registered accounts only**; invite-to-unregistered **deferred to a
     later slice.**
   - **Dependency (spec-auditor):** the slice also lands `guardian_link_audit` (Doc 01 V8 §35) + the
     §36.5 `entitlement_invalidate` NOTIFY on `guardian_links` status changes — both **deferred in
     genesis** (`genesis.sql:19–21`); the linking-flow proof asserts the audit row + NOTIFY on each
     transition.
   - Both paths verify link **direction** (guardian-is-guardian; reject self/reversed beyond
     `guardian_not_self`). These params are the step-5 build spec and the linking-flow proof asserts
     them (TTL expiry, the 5-fail lockout invalidating the code, single-use, reversed/self rejection).

9. **HALT-9 — `trialing` flows to the guardian mirror. RESOLVED — confirmed.** `trialing` flows to
   the guardian mirror via single-source `entitlement_active` — **automatic, no exclusion** (the
   guardian gate calls the same fn). Step 1 edits the landed, owner-ruled canonical primitive and
   re-runs the guardian proof with a `trialing` persona (guardian of a trialing linked student →
   visible; guardian of a canceled student → empty).

## 11. HALT surfaced by the pre-build spec-auditor pass (OPEN — needs ruling before SP-25 builds)

10. **HALT-10 — `canceled`-at-period-end entitlement.** Doc 01 V8 §21 + Appendix C `isStatusActive`
    treat a `canceled` subscription with `cancel_at_period_end = true` AND `current_period_end > now()`
    as **still entitled** until the period ends. The canonical set `{active,past_due,trialing}` is a
    pure `status IN (…)` filter and **cannot** express that temporal case; adding it would force a
    temporal arm (`OR status='canceled' AND cancel_at_period_end AND current_period_end > now()`),
    which breaks the clean status-set predicate **and** makes post-condition **E3 (index ≡ predicate)
    impossible** — a partial index cannot reference `now()`.
    **Analysis (Stripe-native, HALT-7):** a cancel-at-period-end subscription keeps Stripe
    `status='active'` (with `cancel_at_period_end=true`) until the period actually ends, when
    `customer.subscription.deleted` fires and status flips to `canceled`. So the paid-but-canceling
    window is already `active` (entitled), and a `canceled` row only exists once access should end
    (not entitled) — the §21/Appendix C temporal arm describes a **non-Stripe-native** model and is
    moot here. **Lean:** keep `{active,past_due,trialing}`; rely on Stripe-native keeping status
    `active` through the paid period; reconcile Doc 01 V8 §21 / Appendix C `isStatusActive` owner-side
    (WS-S, `docs/Spec` read-only). **Object only if** Lyceon sets `status='canceled'` at
    cancel-*request* time rather than at period end — then `entitlement_active` needs the temporal arm
    and E3 must be relaxed to a non-index-backed predicate.
