# Auth — Standard Flow (Jakob's Law) — Validation Contract (DRAFT for review)

> Make the auth + legal-acceptance flow behave **exactly as users expect from any standard app** —
> native Supabase throughout, no custom cleverness. **Scope = behavioral violations of the standard,
> NOT a visual/layout redesign** (the Sign In/Sign Up tabs, email+password, "Forgot password?",
> "Continue with Google" under an OR divider already match convention — do not rebuild them).
>
> **Grounding:** HEAD on `claude/determined-tesla-1jb9a5` (post legal_acceptances outage fix).
> Spec: Doc-01_V8 §6 (Authentication stack), §9 (Login and signup flows), §37.1 (Under-13 gating),
> §5 (Identity audit trail / legal-consent). Consumes `auth-login-e2e.contract.md` (AL-1…AL-9),
> `notification-outbox.contract.md` (the outbox discipline this reuses). Branch → PR `cleanup`.
>
> **Why now:** the `legal_acceptances`-missing-table incident took down ALL logins because a durable
> side-effect (recording consent) was coupled to session survival — a legal-acceptance write failure
> ran `signOut` and destroyed a valid session. Jakob's Law: users expect _authenticate → you're in_;
> consent recording is bookkeeping that must never decide auth availability.

## 0. The standard, stated

Auth is the most-standardized flow on the internet. The behavioral contract is the universal one:
**a successful authentication signs you in and keeps you in.** Required gates (is your email
verified? is your DOB set? — COPPA) may _route_ you (to confirm-email / to /profile/complete), but a
**bookkeeping side-effect must never turn a successful auth into a failure.** Errors are human and
recoverable, never raw codes.

## 1. Finalize-path audit — every post-auth step classified (binding)

After a session is established (`exchangeCodeForSession` / `verifyOtp` / `signInWithPassword`), each
post-auth step is exactly one of:

| Step                                                                              | File                                                          | Category                    | Behavior (binding)                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ensureProfileForAuthUser` (profile must exist; resolves role + onboarding state) | `oauth-callback-routes.ts:136`, `supabase-auth.ts:474`        | **(a) required gate**       | May block; on genuine failure → **human recoverable error**, never a raw `?error=` code. `AccountEmailConflictError` → human "use your original method". |
| DOB / onboarding gate (`profileNeedsCompletion` → `/profile/complete`)            | `oauth-callback-routes.ts:166`, `RequireRole.tsx`             | **(a) required gate**       | **Correct as-is** — routes, does not error. COPPA-load-bearing.                                                                                          |
| `recordLegalAcceptances` (consent audit write)                                    | `oauth-callback-routes.ts:144`, `supabase-auth-routes.ts:193` | **(b) durable side-effect** | **MUST NOT block / signOut / 500.** Record-and-retry via a durable outbox. Session survives unconditionally.                                             |

**Rule:** no category-(b) step may call `signOut`, return a non-2xx for an otherwise-successful auth,
or redirect to an error. Adding a new finalize step requires classifying it here.

## 2. Post-conditions (falsifiable)

### AS-1 — Legal-acceptance is decoupled from session survival (THE core fix)

A successful auth ALWAYS keeps the session. `recordLegalAcceptances` failure (table/constraint/
transient) **never** triggers `signOut`, **never** turns OAuth into `?error=post_auth_finalize`,
**never** makes signup 500. Consent is captured durably (`legal_acceptance_outbox`) and drained to
`legal_acceptances` to completion (retry).
**Proof:** a contract test drives the OAuth finalize + signup with a failing direct legal write →
asserts (a) NO `signOut`, (b) session/redirect is the normal authenticated landing, (c) a pending
outbox row is enqueued; a drain test applies it to `legal_acceptances` and marks it processed
(idempotent, re-drain is a no-op).

### AS-2 — Required gates still block (no regression)

The DOB/onboarding gate still routes incomplete profiles to `/profile/complete`; the
profile-per-human conflict still surfaces (now as a human message). `ensureProfileForAuthUser`
genuine failure yields a human recoverable error + a clean state (safe to retry), not a stranded
half-session.
**Proof:** existing `oauth-callback.contract.test.ts` DOB/branch cases stay green; conflict → human message.

### AS-3 — Human, recoverable error messages (standard error UX)

Every user-facing auth failure shows a clear, human, actionable message — never a raw code. `/login`
reads `?error=<code>` and renders the mapped human copy in the existing Alert UI; form errors are
already human. Codes are retained **server-side only** (logs/diagnostics).
**Proof:** a client test maps each code (`post_auth_finalize`, `supabase_exchange`,
`google_oauth_failed`, `account_exists`, unknown) → its human, recoverable sentence; `/login?error=…`
renders it. No raw code string reaches the DOM.

### AS-4 — Standard flows confirmed (verify, don't rebuild)

Each flow matches the universal pattern, native Supabase only:

- **Sign in:** email+password → `signInWithPassword` → session → land. "Forgot password?" present.
- **Sign up:** `signUp` (+ `emailRedirectTo=/auth/callback`) → confirm-email handoff → `verifyOtp` → land.
- **Google:** `signInWithOAuth({provider:'google'})` → `/auth/callback` → `exchangeCodeForSession` → land.
- **Password reset:** see AS-5.
  Deviations are flagged in the PR and fixed only where genuine. No bespoke token mint/parse anywhere.

### AS-5 — Password reset, end-to-end (native)

Forgot password → email → click → a **recovery session is established** natively
(`/auth/callback` → `verifyOtp(type=recovery)` / `exchangeCodeForSession`) → user lands on a
**reachable set-new-password page that has that session** → `updateUser({password})` → done.
The recovery link must NOT land on a `RequireRole`-gated page with no session (current bug:
`reset-password` sets `redirectTo=/update-password`). The callback honors a safe same-origin `next`
for the recovery flow.
**Proof:** callback test — `type=recovery` (+ `next`) establishes a session and routes to the
set-password page (not `/dashboard`); a reset flow test asserts request → completion → updated.

### AS-6 — Native-only (no custom auth logic)

Only native primitives establish/verify/reset sessions: `signUp`, `signInWithPassword`,
`resetPasswordForEmail`/`admin.generateLink(recovery)`, `verifyOtp`, `exchangeCodeForSession`,
`updateUser`/`admin.updateUserById`, `signOut`. Email _delivery_ via the platform provider is infra,
not auth logic. No `jsonwebtoken`/bcrypt/`randomBytes` token mint on any path.

### AS-7 — Post-deploy production smoke test (the gate that would've caught the outage)

A smoke check that exercises a real auth round-trip against the live deployment (a seeded probe
account: `signin` → 200 + session cookie → `/api/profile` 200), runnable post-deploy. This is the
gate the `legal_acceptances` outage slipped past (CI mocked the DB). Deliver the script + wiring;
the probe-account/cron is owner-config.

## 3. The outbox (reuses the established discipline)

`legal_acceptance_outbox` — durable intent queue, same shape/discipline as `notification_outbox`
(service-role-only, RLS-enabled, append + mark-processed). Capture: try the direct
`legal_acceptances` upsert; on ANY failure enqueue the intent (never throw). Drain: idempotent upsert
to `legal_acceptances` + stamp `processed_at`; retried opportunistically on the user's next
authenticated hydration (`GET /api/profile`) so it completes without a cron. Owner-run migration
(staged + applied to prod, like the `legal_acceptances` hotfix).

## 4. Build order

1. Outbox migration (apply to prod + governed file) → `captureLegalAcceptances` (try-direct-else-enqueue, never-throws) + `drainLegalAcceptanceOutbox`.
2. Re-point finalize (OAuth + signup) onto `captureLegalAcceptances`; remove the legal-acceptance→signOut coupling. Keep the (a)-gate behavior. Opportunistic drain in `/api/profile`.
3. Human error map + `/login` `?error=` rendering.
4. Password-reset completion linkage (AS-5).
5. Smoke-test script (AS-7).
6. Tests (AS-1 decouple+drain, AS-3 errors, AS-5 reset) → `/grill-me` → spec-auditor → build+test green → PR.

## 5. Out of scope

Visual/layout redesign; new auth methods (magic-link UI, MFA); changing email delivery infra;
`docs/Spec/**`; the guardian-consent (under-13) flow internals (separate lane).

## 6. Revisions — Codex pass (2026-06-18)

Three findings from the post-merge Codex audit of #390, all legitimate, are folded in:

- **AS-1 both-fail (AS1-OUTBOX-DROP-001, was BLOCKING).** The decoupling must not become a _silent
  compliance-loss_ path. `captureLegalAcceptances` now returns `{durable:boolean}`: `true` when consent
  is recorded **or** durably queued (single-store failure → session survives, unchanged); `false` ONLY
  when **both** stores fail. On `durable:false` the callers **fail closed BEFORE granting a session**
  (OAuth → `signOut` + `?error=consent_capture_failed`; signup → `503` before `persistSession`) — a
  recoverable error, never a silent drop. This is distinct from the original outage, which tore down an
  _already-valid_ session on the _common_ missing-table case; the outbox now absorbs that. The contract
  test that asserted silent-drop is acceptable is **inverted** to assert `durable:false`.
- **AS-3/AS-5 reset enumeration (AS3-AS5-RESET-ENUM-001, was BLOCKING).** `POST /api/auth/reset-password`
  returns the **same** generic response (`"If an account exists for that email, we've sent password
reset instructions."`) whether or not the email maps to an account; provider errors are logged
  server-side only. True config failures (missing `PUBLIC_SITE_URL`) remain a 500. Non-enumerable.
- **AS-1 drain liveness (AS1-DRAIN-LIVENESS-001, was HIGH).** A durable outbox needs a _guaranteed_
  drain, not only the opportunistic `/api/profile` one. Added `drainAllPendingLegalAcceptances` + a
  CRON_SECRET-gated endpoint `GET /api/internal/legal-acceptance-drain` + an hourly Vercel cron
  (`vercel.json`). The `/api/profile` drain remains the fast path; the cron guarantees eventual
  recording for a user who never returns. (CRON_SECRET is owner-config; unset ⇒ endpoint 404s.)
