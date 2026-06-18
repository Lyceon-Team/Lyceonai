# Auth Login — End-to-End Wiring — Validation Contract (DRAFT for review)

> The e2e-verification contract for the auth-login wave: **Google OAuth + email/password, both native
> Supabase Auth, one `@supabase/ssr` session model, DOB-gated on both signup paths, account-linking
> handled, guardian-link notification emitted.** This is the platform's **first end-to-end
> verification target** — structured so the seams are provable by Playwright (CI) and drivable by an
> in-app browser on localhost.
>
> **Grounding:** HEAD `f98b9a7` (`claude/determined-tesla-1jb9a5`). The backend is already merged and
> correct (native SSR session, single-source `entitlement_active = {active,past_due,trialing}`,
> guardian model, native OAuth dashboard config). This wave **wires + proves**, it does not rebuild.
> Spec: Doc 01 V8 (CANONICAL) Part I §3–§4 (Identity / profile-per-human / canonical writer), Part II §6
> (Authentication), Part V §25 (EntitlementService), Part VI §35/§36 (Guardian linkage / flow), §37
> (Under-13 / COPPA), §38 (Guardian visibility).
> Contracts consumed: `auth-entitlement-sp25.contract.md`, `freemium-practice-quota.contract.md`,
> `notification-outbox.contract.md`. Catalog: `docs/SpecAudit/notification-triggers.md` (`guardian_linked`).
> HALT rulings: `docs/SpecAudit/50-auth-entitlement/PHASE-0-PLAN.md` §8 (HALT-1…HALT-10).
> Branch policy: develop on `claude/determined-tesla-1jb9a5`; PR → `cleanup`.

## 0. Premise — this is a verify-and-close-the-seams wave

Exploration (4-agent map, 2026-06-17) established the lane is ~90% built on this branch:

| Area                             | State       | Evidence                                                                            |
| -------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| Google OAuth (native PKCE)       | **built**   | `SupabaseAuthContext.tsx:318` → `oauth-callback-routes.ts:43,71`                    |
| Email/password (native)          | **built**   | `supabase-auth-routes.ts` signup/signin/reset/update; `SupabaseAuthForm.tsx` forms  |
| One `@supabase/ssr` session      | **built**   | `server/lib/supabase-ssr.ts`; httpOnly cookie; server-authoritative `getUser()`     |
| DOB soft-gate + both-path wiring | **built**   | `profile-complete.tsx:131`; `RequireRole.tsx:81-95`; `oauth-callback-routes.ts:118` |
| Entitlement + 40/day quota gate  | **built**   | `entitlement-service.ts:41`; `practice-canonical.ts` 402 gate                       |
| `notification_outbox` table      | **applied** | `supabase/migrations/20260617000000_notification_outbox.sql` (live)                 |

The **four real gaps** this wave closes are: **(G1)** `guardian_linked` emission is not wired;
**(G2)** the email-confirmation handoff callback is not wired; **(G3)** same-email-different-provider
account-linking is unhandled in code; **(G4)** no e2e proof that DOB gates _both_ paths / entitlement
renders. Everything else is verification.

---

## 1. Native-only invariant (no custom auth logic)

Both entry methods resolve to **one** session model. No code path may:

- mint, sign, store, or refresh a session token itself (Supabase + `@supabase/ssr` own this);
- hand-roll password hashing, email-confirmation tokens, or recovery tokens (native `signUp`,
  `signInWithPassword`, `resetPasswordForEmail`, `verifyOtp`/`exchangeCodeForSession` only);
- trust client-held role/entitlement/session/elapsed-time (server-authoritative, §6 standards).

**Falsifiable:** grep of the diff shows no `jsonwebtoken` sign/verify, no bcrypt/argon, no bespoke
`crypto.randomBytes` token mint on any auth path. Any temptation to add custom logic is flagged in
the PR body, not silently added.

---

## 2. Post-conditions (falsifiable; each maps to a proof)

### AL-1 — Google OAuth, end-to-end (Point 1; VERIFY)

Button (`data-testid="google-signin"`) → `signInWithOAuth({provider:'google', redirectTo:<site>/auth/callback})`
→ `GET /auth/callback?code=…` → `exchangeCodeForSession` writes the `sb-<ref>-auth-token` httpOnly
cookie via the SSR adapter → redirect to `/profile/complete | /guardian | /dashboard`.
**Proof:** `10_auth_google.spec.ts` asserts button visible, click redirects toward Google/`/auth/callback`,
and `GET /auth/callback` (no code) is a 302 to `/login?error=…` (route live, never 404).

### AL-2 — Email/password, end-to-end, one session model (Point 2; VERIFY)

`signUp` / `signInWithPassword` / `resetPasswordForEmail` / `updateUserById` are the **only** auth
primitives; the session they establish is the **same** httpOnly `@supabase/ssr` cookie as AL-1.
**Proof:** `11_auth_password.spec.ts` completes signin → redirect off `/login` → session survives
reload → logout clears it. No bearer token anywhere (`auth-surface.contract.test.ts`).

### AL-3 — Email-confirmation handoff (Point 2; BUILD — G2)

`signUp` sets `options.emailRedirectTo = <PUBLIC_SITE_URL>/auth/callback`. The confirmation link
(PKCE `code`, or `token_hash`+`type` for the OTP variant) lands on the **existing** `/auth/callback`,
which completes it via `exchangeCodeForSession` (or `verifyOtp` for `token_hash`) and establishes the
native session — then falls through the same post-auth profile/DOB routing as AL-1. No separate
session, no custom token parsing.
**Proof:** contract test asserts `signUp` is invoked with `emailRedirectTo` pointing at `/auth/callback`;
callback test asserts a `token_hash`+`type=signup` (or `code`) request establishes a session and
redirects to `/profile/complete`. Pre-confirm, signup returns `202 outcome:"verification_required"`
(no session leaked).

### AL-4 — DOB soft-gate fires on BOTH signup paths (Point 3; PROVE BOTH — the crux seam)

A freshly-created human — **whether via Google or via email/password** — cannot reach study/feature
access until `date_of_birth` is persisted; under-13 → guardian-consent path before any access. Both
paths converge on the **single** server-authoritative seam:

- server redirect: `oauth-callback-routes.ts:118` (`profileNeedsCompletion`) for Google;
- `nextPath:"/profile/complete"` from signup for email/password;
- enforced for every protected route by `RequireRole.needsOnboarding` (`RequireRole.tsx:81-95`), whose
  inputs (`profileCompletedAt`, `requiredConsentsComplete`, `guardianConsentRequired`) come from the
  server `/api/profile` hydration (`profile-routes.ts:78-80`), never client state.
  **Proof (both, explicitly):** an e2e spec drives a Google-shaped first login → lands `/profile/complete`;
  an email signup → first protected nav lands `/profile/complete`. A server contract test asserts
  `needsOnboarding`-equivalent gating is keyed off server hydration for both. DOB default = dynamic
  `today − 13y` (`profile-complete.tsx:131`), never hardcoded.

### AL-5 — Entitlement renders post-login, both methods (Point 4; VERIFY/CLOSE)

After either login the authenticated, entitlement-aware session is identical. Entitled
(`{active,past_due,trialing}` via the single `entitlement_active` evaluator) → full access; unpaid →
the 40/day practice quota gate (`daily_quota_free` from `practice_runtime_config` + `EntitlementService`),
surfaced as `402 PRACTICE_FREE_DAILY_QUOTA_EXCEEDED` with an upgrade affordance. No second entitlement
definition is introduced (consumes `auth-entitlement-sp25` + `freemium-practice-quota`).
**Proof:** e2e asserts an unpaid session hits the quota affordance; the entitlement evaluator is the
existing single source (no new gate).

### AL-6 — `guardian_linked` emission, atomic + idempotent (Point 6; BUILD — G1)

When a `guardian_links` row goes **active**, exactly one `notification_outbox` row is emitted **in the
same transaction**:

- `event_type='guardian_linked'`, `recipient_kind='both'`, `recipient_profile_id=<student profile>`,
  `payload={ guardian_profile_id, link_id }` (ids only, §12);
- `event_id` deterministic over `('guardian_linked', student_user_id, guardian_profile_id)` — the
  link's natural key (1:1 with `link_id`) — computed **server-side in the RPC** via the genesis
  `extensions.digest(…, 'sha256')` pattern (no `uuid-ossp` dependency), `INSERT … ON CONFLICT
(event_id) DO NOTHING`.
- Atomicity is achieved by an owner-run Postgres RPC that performs the link upsert **and** the outbox
  insert in one transaction; `createGuardianLink` (`account.ts:39`) calls it via `.rpc()`. **Both**
  call sites (over-13 `guardian-routes.ts:164`, under-13 `guardian-consent-routes.ts:410`) inherit
  emission through the single `createGuardianLink`.
  **Proof:** contract test asserts (a) link-active path invokes the RPC once with the right args;
  (b) re-link (revoke→relink) / retry emits **at most one** row (same `event_id`); (c) `recipient_kind`
  is `both` and the subject is the student; (d) no PII in payload. Migration ships a reversible DOWN and
  is staged owner-run (`supabase/migrations-pending/`) per the `notification_outbox` precedent.
  **Scope guard:** emission is wired **only** at the guardian-link moment in this lane — no other
  catalog moment (`quota_reached`, `trial_ending`, …) is wired here.

### AL-7 — Profile-per-human across providers (Point 5; BUILD — G3, config-agnostic)

One human → exactly one `profiles` row, regardless of how many providers (email/password, Google) they
authenticate with on the **same email**. Two layers:

1. **Required dashboard config (documented):** Supabase "link identities with the same email" enabled,
   so a verified same-email second provider attaches to the **same** `auth.users.id` → the existing
   profile (`ensureProfileForAuthUser` returns the existing row keyed on `id`). Documented in
   `docs/SpecAudit/50-auth-entitlement/OAUTH-001-branding-path.md` (working area; not `docs/Spec`).
2. **Code guard (holds even if the toggle is wrong):** `ensureProfileForAuthUser` must never create a
   **second** profile for an email that already anchors a profile under a different `id`. On that
   collision it does not silently fork the human — it surfaces a deliberate, server-authoritative
   conflict (telling the user to sign in with their original method), preserving profile-per-human.
   **Proof:** contract test — (a) same email, second provider, linking-on → resolves to the **same**
   profile id, zero new rows; (b) same email, second provider, linking-off-shaped collision → guard
   rejects/surfaces, **no duplicate profile**. Never asserts on dashboard state at runtime.

### AL-8 — Invariants intact across both flows (Point 5)

- **Server-authoritative roles:** role read from `profiles.role` server-side every request; signup
  can never mint admin (`supabase-auth-routes.ts:102`, `profile-bootstrap.ts:27`).
- **Guardian view-only:** linking/emission grant zero write into student learning state; guardian
  visibility stays derived via `guardian_can_view_student` (link-active AND student-entitled).
- **No client privilege:** every gate (DOB, entitlement, role) enforced server-side; UI only reflects.
- **Anti-leak:** unaffected — no question content on any auth surface.

### AL-9 — e2e structure (cross-cutting)

New/extended specs live in `tests/specs/` (`chromium`, `data-testid` kebab convention), driveable
against `BASE_URL`/localhost with no mock Supabase, so CI and an in-app browser exercise the same
seams. New UI elements carry stable `data-testid`s.

---

## 3. Build order (each step leads to the next; contract-first → implement → spec-auditor → /grill-me → e2e → CI)

1. **AL-6 foundation** — emission RPC migration (owner-run, `migrations-pending/`) + `createGuardianLink`
   `.rpc()` rewrite + contract test. _(Leads: establishes the atomic-emit template.)_
2. **AL-3** — `emailRedirectTo` on `signUp` + callback handles `token_hash`/`type` (OTP variant) + tests.
3. **AL-7** — account-linking guard in `ensureProfileForAuthUser` + config doc + proof test.
4. **AL-5 / AL-1 / AL-2 / AL-4** — verify + extend e2e specs proving both-path DOB gate + entitlement.
5. **/grill-me** + **spec-auditor** → fix findings → `pnpm -s run build && pnpm test` green → PR → `cleanup`.

## 4. Out of scope (do not build here)

Notification dispatcher/delivery/UI/preferences (end-stage lane); any non-guardian-link emission;
birthday-transition recompute (WS-6); Stripe entitlement emit (billing lane); changes to
`docs/Spec/**` (read-only) or to the locked entitlement definition.
