# **Lyceon — Document 01: Identity, Access, Billing & Guardian Trust**

**Version:** V8.0 **Status:** CANONICAL (supersedes V7.1, V7.0, V6.0) **Last updated:** 2026-04-23 **Owners:** Founder / CTO review **Governed by:** Document 00 (Authoritative Platform Directive) **Depends on:** Supabase Auth, Stripe, Neon Postgres, Doc 01A V1 (Platform Primitives) **Applies to:** All identity, account, authentication, authorization, billing, entitlement, MFA, guardian trust, consent, and account-lifecycle flows across the Lyceon platform (web \+ mobile)

**V8.0 update scope:** Targeted polish pass addressing V7.1 external review (8.8/10). No structural changes, no architectural reversals. Net additions: §17A strengthened — session invalidation required on privileged role elevation (admin/tutor/teacher) so stale lower-privilege sessions cannot silently gain elevated capability; §18.1 cross-references §17A; §8.6.1 (new) — independent web/mobile sessions threat model, consistent with §7.2.1/§8.7.1/§8.8.1 brief-inline pattern; §40.3 wording corrected — "subscription is already canceled" replaced with "cancellation initiated immediately; retries continue in background while account remains inaccessible" (resolves V7.1 internal contradiction between §40.3 and §40.2.1 flagged by reviewer); §44 opens with one-line acknowledgment of launch-reality support staffing (founder/admin-backed at launch, formalized into distinct roles post-scale); §45A header adds disclaimer — performance budgets are launch targets subject to proof during prelaunch load validation, not measured current-state numbers; four critical deviation boxes tightened with "cutover criteria / blocking conditions / completion proof" structure (§3 profile writer, §14.3 RLS reinstatement, §24 Stripe queue ownership, §34 entitlement migration); Appendix E adds Ownership Class column (single-writer / shared-append / admin-mutable) with class definitions; footer companion artifacts marked by launch-blocking status. Five new change records CR-01-39 through CR-01-43. V7.1 core content, architecture, and interfaces preserved unchanged.

**V8 scope history (cumulative):** V8 polishes V7.1 review corrections. V7.1 added targeted V7.0 review corrections (audit retention, threat models, role conflict, abuse override, guardian N+1, deletion partial failure, OpenAPI/Zod, SLO/SLI, internal composition, DB ownership, companion artifacts). V7.0 was the full V6 rewrite with target-dominant doctrine, mobile auth spec, cookie-canonical web auth, and canonical EntitlementService module.

---

# **Part 0 — Preamble**

## **0.1 Purpose**

Lyceon's identity and access layer is foundational. Every feature — practice, review, exams, tutor, billing, guardian oversight, future mobile — depends on correctly identifying who is using the system, what they are allowed to do, and what protects their access. If identity is wrong, everything downstream is wrong. If access control is wrong, academic integrity, financial integrity, and child safety all fail simultaneously.

This document governs how Lyceon establishes user identity, authenticates users (including MFA), resolves roles and authorizes actions, processes subscriptions through Stripe, manages entitlement through a canonical `EntitlementService`, oversees guardian-student relationships, and handles account lifecycle (creation, role switching, deletion). V8 is the target-state specification for the repo rewrite; current repo deviations are flagged per section.

## **0.2 Scope and out-of-scope**

**In scope:**

* Identity canonicalization on `profiles`  
* Authentication for web (HttpOnly cookie) and mobile (Keychain/Keystore) clients  
* Authorization: role resolution, three-layer access control, RLS (target) \+ application-layer filtering (launch), audit logging  
* MFA via Supabase `auth.mfa_factors`  
* Billing via Stripe and subscription lifecycle  
* Canonical `EntitlementService` module — interface, caching strategy, invalidation, failure modes, feature-to-entitlement mapping  
* Guardian trust model, linkage, consent workflow including COPPA  
* Account deletion with 7-day soft-delete lifecycle  
* Password reset and account recovery  
* Support-mediated operations  
* Role switching mechanism  
* MFA rollout policy by role  
* Audit logging of identity-relevant events

**Out of scope (owned elsewhere):**

* Cross-cutting platform primitives (Doc 01A V1): RateLimitLedger, IdempotencyService, AbuseScoreService, internal service auth, observability conventions, config doctrine, caching strategy pattern  
* Runtime engine behavior (Doc 02B)  
* Content governance (Doc 02A)  
* Mastery computation (Doc 02C)  
* Tutor architecture (Doc 03 family)  
* Study plan scheduling (future Doc 04\)  
* Marketing and growth surfaces (future Doc 05\)  
* Non-SAT exam family expansion (future Doc 06\)

## **0.3 Relationship to Doc 00 and Doc 01A**

**Doc 00 inheritance:** Server-authoritative mutations. Single writer per canonical table. No client role trust. One identity per user. Auditable flow. Data protection by default. Every V8 behavior operates within Doc 00 bounds.

**Doc 01A consumption:** V8 consumes Doc 01A platform primitives rather than reimplementing them. Specifically:

* Stripe webhook handlers consume `IdempotencyService` (Doc 01A §18-§27) for event deduplication  
* Authentication rate limiting consumes `RateLimitLedger` (Doc 01A §9-§17) for login throttling, password reset throttling  
* `EntitlementService` cache invalidation uses the LISTEN/NOTIFY pattern from Doc 01A §4  
* All V8 logging follows Doc 01A §53-§64 observability conventions  
* All V8 constants live in `*_runtime_config` tables per Doc 01A §65-§74 config doctrine  
* High-risk identity actions (guardian linking, role switching, account deletion) consult `AbuseScoreService` (Doc 01A §28-§41) for trust-weighted decisions

**Feature doc consumption:** V8 provides the canonical interfaces consumed by all feature docs. See §44 for the interface-to-consumer map.

## **0.4 Supersession notice**

V8 supersedes V6.0 entirely. Prior V6 content moves to `docs/old-spec-docs/` as historical reference. V6 current-state/target-state doctrine is replaced by target-dominant doctrine.

V5 content was already superseded by V6; V5 references in this document are historical only.

## **0.5 Target-dominant doctrine**

V8 describes target-state as canonical. Where current repo implementation differs materially from target (per 2026-04-23 repo audit or prior known debt), a **current-state deviation box** is included in the relevant section. Format:

**Current-state deviation:** \[what repo does today, audit-sourced\] **Target-state:** \[what V8 specifies\] **Migration path:** \[migration steps, pre-conditions, verification criteria\]

Deviation boxes are present only where material. Sections where target and current align have no deviation box.

This doctrine is cleaner than V6's per-section dual-lens prose. It concentrates divergence where it exists rather than interleaving it throughout.

## **0.6 Audit lineage**

V8 incorporates findings from the 2026-04-23 repo audit covering authentication, entitlement, caching, and server-authoritative boundary. Audit findings that materially contradict V6 assumptions are flagged in the relevant deviation boxes:

* §7 Web auth — cookie-only, Bearer rejected  
* §14 Authorization — RLS bypassed via Neon pooling; application-layer filtering canonical at launch  
* Part V EntitlementService — `resolveLinkedPairPremiumAccessForGuardian` exists in `server/lib/account.ts:591-643`; V8 formalizes and wraps it  
* V8 consumption of Doc 01A RateLimitLedger — `apps/api/src/lib/rate-limit-ledger.ts` is the repo reference implementation

---

# **Part I — Identity Model**

## **§1 Canonical identity on `profiles`**

Identity is canonical on `profiles`. One authenticated user corresponds to exactly one `profiles` row. `profiles.id` maps to `auth.uid()` from Supabase Auth. Duplicate profiles are architectural bugs, not a supported state.

All identity reads and writes reference `profiles.id`. Legacy `users` table is deprecated; any remaining references must be migrated to `profiles`.

## **§2 One identity per user invariant**

Invariant: one row in `profiles` per human user. No feature creates a duplicate profile. No flow — signup, role switch, account restoration — produces a second profile for the same human.

Enforcement:

* Unique constraint on `profiles.id` (primary key)  
* `profile-service.ts` is the single canonical writer (§3); no other path inserts into `profiles`  
* Role switching (§17A) does not delete and recreate a profile; it updates role in place

## **§3 Canonical writer: `profile-service.ts`**

`profile-service.ts` is the single canonical writer for `profiles`. All `profiles` mutations flow through this module:

* Profile creation (post-authentication signup)  
* Profile updates (name, DOB, country, role change, preference changes)  
* Profile soft-delete and restoration (per Part VII)  
* Profile field derivation refresh (e.g., age recomputation)

Every `profiles` write:

1. Validates input  
2. Performs the write in a transaction  
3. Emits audit event to `audit_logs`  
4. Invalidates relevant caches (via LISTEN/NOTIFY per Doc 01A §4)  
5. Returns the updated profile

No API route writes directly to `profiles`. All routes call `profile-service.ts`. No test utility bypasses this writer in non-test environments.

**Current-state deviation:** Multiple writers exist today (account creation path, some admin flows, legacy restoration logic). V6 identified this five-writer pattern. **Target-state:** Single writer via `profile-service.ts`. All other writes migrated. **Migration path:** (1) Inventory all `profiles` write sites via repo grep. (2) Migrate each call site to invoke `profile-service.ts`. (3) Add CI check rejecting direct `profiles` writes outside `profile-service.ts`. (4) Confirm audit events emitted for all mutations post-migration. **Cutover criteria (required before closing the gap):** (a) full inventory of all direct `profiles` write sites documented with file:line references; (b) each site migrated to a `profile-service.ts` method with matching semantics; (c) CI check deployed and passing on main branch for at least 7 days with zero direct-write violations; (d) audit event coverage verified — a sampling query confirms every profile mutation within a test window emits a matching `audit_logs` row. **Blocking conditions (prevent cutover):** any production code path still writing `profiles` directly outside `profile-service.ts`; any admin tooling that bypasses the writer; absence of CI enforcement; audit event coverage gaps. **Completion proof:** CI check running with zero violations; grep of repo returns zero direct-write call sites outside `profile-service.ts`; retrospective query of `audit_logs` shows complete coverage of `profiles` mutations in a 7-day verification window. Detailed runbook in Doc 01.2.

## **§4 Profile schema (target-state)**

CREATE TABLE profiles (  
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,

  \-- Identity  
  email TEXT NOT NULL,  
  full\_name TEXT,  
  display\_name TEXT,

  \-- Role  
  role profile\_role NOT NULL DEFAULT 'student',

  \-- Demographics  
  date\_of\_birth DATE,  
  age\_years INTEGER GENERATED ALWAYS AS (  
    EXTRACT(YEAR FROM age(date\_of\_birth))::INTEGER  
  ) STORED,  
  country\_code TEXT,  \-- ISO 3166-1 alpha-2, from billing address (authoritative)

  \-- Billing linkage  
  stripe\_customer\_id TEXT UNIQUE,

  \-- Under-13 COPPA fields (see Part VI)  
  is\_under\_13 BOOLEAN GENERATED ALWAYS AS (age\_years \< 13\) STORED,  
  guardian\_email TEXT,  
  guardian\_consent BOOLEAN DEFAULT FALSE,  
  consent\_given\_at TIMESTAMPTZ,

  \-- Guardian self-reference (for guardian accounts)  
  guardian\_profile\_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  \-- Lifecycle  
  last\_login\_at TIMESTAMPTZ,  
  deleted\_at TIMESTAMPTZ,  \-- Soft-delete marker (Part VII)

  \-- Timestamps  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  updated\_at TIMESTAMPTZ NOT NULL DEFAULT now()  
);

CREATE TYPE profile\_role AS ENUM (  
  'student', 'guardian', 'admin', 'tutor', 'teacher'  
);

CREATE INDEX idx\_profiles\_role ON profiles (role) WHERE deleted\_at IS NULL;  
CREATE INDEX idx\_profiles\_stripe\_customer ON profiles (stripe\_customer\_id)  
  WHERE stripe\_customer\_id IS NOT NULL;  
CREATE INDEX idx\_profiles\_deleted ON profiles (deleted\_at)  
  WHERE deleted\_at IS NOT NULL;  
CREATE UNIQUE INDEX idx\_profiles\_email\_active ON profiles (lower(email))  
  WHERE deleted\_at IS NULL;

**Schema rationale:**

* `age_years` and `is_under_13` are generated columns — no drift risk between DOB and derived fields  
* `country_code` is populated from Stripe billing address (not self-declared at signup) per entitlement invariant that country follows billing  
* `stripe_customer_id` is unique (one Stripe customer per profile)  
* `deleted_at` supports 7-day soft-delete per Part VII  
* Case-insensitive unique email for active profiles (soft-deleted profiles can share emails with new active profiles)

**RLS target-state** (enforced once Neon pooling allows, per §14 deviation):

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;  
CREATE POLICY profiles\_select\_self ON profiles  
  FOR SELECT USING (id \= auth.uid());  
\-- Writes are service-role only (via profile-service.ts)

## **§5 Identity audit trail**

Every `profiles` mutation emits an entry to `audit_logs` with:

* `actor_profile_id` — who performed the action (may be the profile itself for self-service, or an admin)  
* `target_profile_id` — which profile was mutated  
* `action` — enum: `profile_created`, `profile_updated`, `role_changed`, `profile_soft_deleted`, `profile_restored`, `profile_hard_deleted`, `field_updated`  
* `changes` — JSONB diff of field changes  
* `context` — JSONB with request ID, origin, support case ID if applicable  
* `timestamp`

Retention per Doc 01A §74 observability config.

## **§5.1 Audit log retention and PII boundaries**

Audit logs contain identity-sensitive data. V8 specifies retention, PII handling, and access controls.

### **Retention tiers**

| Audit event category | Retention | Rationale |
| ----- | ----- | ----- |
| Authentication events (login, logout, MFA challenge) | 90 days | Security forensics window |
| Identity mutations (profile updates, role changes) | 365 days | Regulatory and operational trail |
| Entitlement/billing events | 7 years | Financial records minimum |
| Account deletion requests | 7 years (anonymized after 1 year) | Regulatory \+ evidence of compliance |
| Guardian consent events | Permanent (anonymized after 1 year) | COPPA compliance evidence |
| Support-mediated operations | 365 days | Dispute resolution window |

Retention values live in `observability_runtime_config` per Doc 01A §74.

### **PII redaction**

Fields NEVER written to audit\_logs:

* Passwords (even hashed)  
* MFA secrets or recovery codes  
* Session tokens or JWTs  
* Credit card numbers or payment credentials  
* Full Stripe customer metadata (use `stripe_customer_id` reference only)

Fields ALWAYS redacted at log-write time:

* `date_of_birth` → replaced with `age_years` only  
* IP addresses → truncated to /24 (IPv4) or /48 (IPv6)  
* User agent strings → browser family \+ OS family only, no version-specific details  
* Email addresses in `changes` JSONB → domain-only retention after 90 days

### **GDPR / data deletion interaction**

When a profile hard-deletes (T+7 per §40.5):

* Audit logs for the deleted profile enter "anonymized retention" mode  
* `actor_profile_id` and `target_profile_id` become NULL  
* Only anonymized metadata retained: action type, timestamp, status code  
* After `account_deletion_runtime_config.anonymization_retention_days` (default 365), audit logs are hard-deleted

Minor-specific handling: for profiles that were under 13 at deletion time, COPPA consent event retention is extended (permanent anonymized record of consent action for regulatory defense), but all identifying links are severed per §40.5.

### **Access controls**

Audit logs are service-role writable only. Read access:

* Users: can request export of their own audit logs (GDPR Article 15 right of access) via support escalation  
* Admins: can read all audit logs for operational purposes; admin reads are themselves audited (meta-audit)  
* Automated systems: can read aggregated, non-PII log data for metrics; cannot read raw log content

### **Cold storage transition**

Audit logs older than 90 days transition from primary `audit_logs` table to cold storage (`audit_logs_archive` — compressed Postgres table, or external archive per Doc 01A observability sinks). Primary table remains queryable for ongoing operations; cold storage is for compliance retrieval only.

---

# **Part II — Authentication**

## **§6 Authentication stack**

Lyceon uses **Supabase Auth** as the authentication provider. This gives us battle-tested primitives:

* Password hashing via Argon2  
* Secure session tokens  
* CSRF protection  
* OAuth state validation  
* Magic link generation and validation  
* MFA factor management via `auth.mfa_factors`

V8 specifies the Lyceon-specific layer on top of Supabase Auth — profile creation, role assignment, under-13 consent gating, MFA rollout policy, mobile-specific handling — not the underlying auth mechanics.

## **§7 Web authentication — HttpOnly cookie canonical**

**Web authentication uses `sb-access-token` HttpOnly cookie. Bearer tokens are explicitly rejected.**

### **7.1 Token storage**

* `sb-access-token` — short-lived JWT (default 1 hour TTL), HttpOnly, Secure, SameSite=Lax  
* `sb-refresh-token` — long-lived refresh token (default 30 days TTL), HttpOnly, Secure, SameSite=Lax

Cookies are set by Supabase Auth on successful sign-in. Subsequent requests include cookies automatically. Client-side JavaScript cannot read or manipulate these tokens (HttpOnly enforcement).

### **7.2 Token validation (`supabaseAuthMiddleware`)**

Every `/api/*` request passes through `supabaseAuthMiddleware`. The middleware:

1. Extracts `sb-access-token` from request cookies  
2. **Explicitly rejects any `Authorization: Bearer <token>` header** with 401 (prevents client-side JS from bypassing HttpOnly storage)  
3. Validates JWT signature against Supabase JWKS  
4. Validates JWT expiry  
5. Validates JWT audience and issuer claims  
6. Extracts `sub` claim as `auth_user_id`  
7. Loads `profiles` row for `auth_user_id` → `req.user`  
8. Attaches authenticated Supabase client to `req.supabase`  
9. Proceeds to route handler

Failure at any step returns 401 with a specific error code:

* `unauthenticated` — no cookie present  
* `bearer_rejected` — Bearer header found (security violation logged)  
* `token_invalid` — signature or claim validation failed  
* `token_expired` — JWT past expiry  
* `profile_not_found` — JWT valid but no profile row (orphan auth record; requires support escalation)

### **7.2.1 Threat model — why Bearer is rejected**

**Threat mitigated:** XSS-driven token exfiltration. If a future XSS vulnerability is introduced (via third-party script compromise, a missed sanitization path, or a browser extension), an attacker who can execute JavaScript on `lyceon.ai` can read anything JavaScript can read. HttpOnly cookies are unreadable by JavaScript; Bearer tokens stored anywhere JavaScript can access them (localStorage, sessionStorage, memory, inline HTML) are exfiltratable.

**Attack that Bearer acceptance enables:**

1. XSS gains code execution on an authenticated user's browser session  
2. Attacker's script reads the Bearer token from localStorage (where it must live if Bearer is accepted)  
3. Token is sent to attacker's server  
4. Attacker uses token to impersonate user server-side (not bound to browser or device)

**Defense via cookie-only:**

* HttpOnly cookies cannot be read by any JavaScript  
* Cookies bind to a specific origin; attacker-controlled domains cannot send them  
* SameSite=Lax prevents cross-site request forgery attacks that would let a malicious site trigger authenticated requests

**User cost of Bearer rejection:** negligible. Programmatic API access (future) uses service account tokens with different threat model; end-user API access always uses the cookie-bound browser session. Mobile uses a different, non-JavaScript storage path per §8.1.

**Kept because:** XSS remediation is expensive and incomplete by nature; architectural prevention (no JS-readable credentials) is cheaper and more reliable than perfect XSS hygiene.

### **7.3 Session refresh**

On 401 `token_expired`:

* Client makes a POST to `/api/auth/refresh` with `sb-refresh-token` cookie  
* Supabase issues new access token  
* Original request is retried automatically by client SDK  
* If refresh token also expired, user is redirected to login

Refresh token rotation is enabled (Supabase setting): each refresh issues a new refresh token. Prior refresh tokens become invalid after rotation grace window (default 10 seconds, per Supabase config).

### **7.4 Logout**

Client calls `supabase.auth.signOut()`. Supabase:

1. Invalidates the session server-side  
2. Clears `sb-access-token` and `sb-refresh-token` cookies  
3. Returns success

No additional custom logout logic needed.

**Current-state deviation:** Per 2026-04-23 audit, the middleware correctly uses cookies and rejects Bearer tokens. No deviation; audit confirmed alignment with target.

## **§8 Mobile authentication**

Mobile clients (iOS and Android, post-launch) authenticate via a different token storage mechanism. Web and mobile sessions are **separate** — a user logged in on web must authenticate independently on mobile.

### **8.1 Token storage**

**iOS:** Tokens stored in **Keychain** with:

* `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` accessibility  
* Application-prefix binding (tokens are not synced via iCloud Keychain)  
* Access control flags requiring device unlock

**Android:** Tokens stored in **Keystore-backed EncryptedSharedPreferences** with:

* Master key generated in Android Keystore (hardware-backed where available)  
* AES256-GCM encryption scheme  
* No backup to Google Drive (`android:allowBackup="false"` on app tag, or explicit rule excluding token storage)

**Explicit prohibitions:**

* Never use `AsyncStorage` (React Native) — not encrypted at rest  
* Never use `SharedPreferences` directly (Android) — not encrypted  
* Never use `NSUserDefaults` (iOS) — not encrypted  
* Never log tokens  
* Never include tokens in crash reports (integrate with redaction rules per Doc 01A §57)

### **8.2 Token refresh (silent refresh, 401 handling)**

Mobile clients implement automatic silent refresh:

1. On any API response returning `401 token_expired`:  
   * Intercept the response before surfacing to UI  
   * Call `/api/auth/refresh` with current refresh token  
   * On refresh success: retry original request with new access token  
   * On refresh failure (refresh token also expired): clear all tokens, emit auth-required event to UI layer  
2. On app launch, if tokens exist in secure storage but access token is expired, silently refresh before any API call  
3. Refresh logic is implemented once in a shared auth module (not repeated per API caller)

### **8.3 Session persistence (background/foreground, app kill)**

**Background/foreground transitions:**

* Tokens persist in secure storage across backgrounding  
* On foreground after \>10 minutes background, validate access token is still within expiry; refresh silently if needed  
* No biometric re-auth required for simple backgrounding (only for sensitive actions per §8.4)

**App kill/relaunch:**

* Tokens persist in secure storage  
* On relaunch, auth state is restored from secure storage  
* If tokens are intact and valid (or refreshable), user lands directly in authenticated state  
* If refresh token is expired/invalid, user lands on login screen

**Session TTLs (mobile-specific):**

* Access token TTL: same as web (default 1 hour)  
* Refresh token TTL: same as web (default 30 days)  
* Values in `auth_runtime_config` per Appendix A

### **8.4 Biometric re-authentication for sensitive actions**

Biometric re-auth (FaceID / TouchID / Android fingerprint or face) is required before these actions in the mobile app:

* Account deletion request  
* Billing changes (payment method update, subscription cancellation)  
* MFA enrollment or change  
* Password change  
* Email change  
* Role switching (tutor/teacher request)  
* Guardian linking or unlinking

Biometric challenge is implemented via:

* **iOS:** `LocalAuthentication` framework with `LAPolicyDeviceOwnerAuthenticationWithBiometrics`  
* **Android:** `BiometricPrompt` API with `BIOMETRIC_STRONG` authenticator

Biometric success does not issue a new token — it unlocks access to the sensitive action for a short window (default 60 seconds, configurable via `auth_runtime_config.biometric_action_window_seconds`).

If biometric is unavailable (not enrolled, device doesn't support), the user is prompted for password re-entry as a fallback.

### **8.5 Deep linking and OAuth callbacks**

**Magic links on mobile:**

* Email magic links open the mobile app via universal links (iOS) / App Links (Android)  
* App handles the magic link by extracting the auth code, exchanging for tokens, and storing tokens securely  
* If the app is not installed, magic link falls back to web browser (opens web app)

**OAuth (Google, Apple, etc.) on mobile:**

* Uses native SDKs: Sign in with Apple (iOS native), Google Sign-In SDK, etc.  
* OAuth flow completes in native UI (no in-app browser for OAuth)  
* On success, native SDK returns an ID token which is exchanged with Supabase Auth for Lyceon session tokens  
* Redirect URIs registered with each OAuth provider per Doc 01 V8 Appendix D

### **8.6 Web ↔ mobile session continuity**

**Web and mobile sessions are independent.** A user logged into the web app must log in separately on the mobile app. This is intentional:

* Different token storage mechanisms (cookies vs Keychain/Keystore)  
* Different threat models (browser XSS vs mobile app compromise)  
* Different session lifetimes acceptable (mobile may extend refresh token TTL in future; web stays conservative)  
* Simpler security model — device compromise on one surface does not automatically compromise the other

Future target: Web → mobile seamless login via QR code pairing (user scans a QR code in web → mobile app receives a one-time exchange code → mobile exchanges code for tokens). Not in V8 scope.

### **8.6.1 Threat model — why independent sessions**

**Threat mitigated:** Cross-surface compromise amplification. A session model that unifies web and mobile means a single credential compromise (XSS on web OR device theft on mobile OR phishing into either) instantly grants the attacker access to both surfaces. Independent sessions contain the blast radius.

**Attack patterns contained:**

* **Browser XSS gaining access** → if XSS extracts the cookie-bound session despite HttpOnly defenses, attacker has web access but no automatic path to a working mobile session  
* **Lost/stolen unlocked device** → attacker with the mobile session has mobile access but no automatic web login on their own computer  
* **Phishing harvesting a mobile login** → attacker gets mobile tokens but must phish separately for web credentials  
* **Malicious browser extension** → extension-level compromise stays contained to web; mobile is untouched

**User cost acknowledged:** Users must log in separately on each surface. This is friction. It trades convenience for defense-in-depth.

**Why QR pairing is deferred, not just rejected:** QR pairing with a short-lived exchange code (visible to the user on both devices) gives seamless UX with bounded compromise window. Designing it safely requires time; implementing it prematurely could undermine the very isolation benefit described above (a weak pairing flow becomes the new weakest link). Deferring to V2 keeps V1 defensible and adds seamless UX once the pairing design is reviewed.

**Kept because:** Consumer platforms serving minors should default to stronger isolation unless UX pressure is significant. At V1 scale, onboarding volume is small; re-login friction is minor.

### **8.7 Device fingerprinting**

On mobile, the app generates a stable **device identifier** stored in secure storage:

* iOS: `identifierForVendor` combined with app-generated UUID on first launch  
* Android: app-generated UUID on first launch (do not use `ANDROID_ID` due to deprecation and multi-user complexity)

Device identifier is sent as `X-Device-Id` header on authenticated requests. This identifier:

* Feeds `AbuseScoreService` signals (Doc 01A §28-§41) for patterns like "same credential used from 10 devices in 24 hours"  
* Is not used for authentication by itself (auth is token-based)  
* Is rotatable — if user reports account takeover, device identifiers can be invalidated server-side

### **8.7.1 Threat model — why device fingerprinting (and why it's minimal)**

**Threat mitigated:** Credential stuffing and account takeover via compromised credentials used from new devices.

**Attack pattern:** Attacker obtains username/password from unrelated breach, attempts login on Lyceon from their infrastructure. Without device identity, successful auth is indistinguishable from legitimate login. With device identity, the "new device" signal can gate additional verification (MFA challenge, email notification to user).

**What Lyceon explicitly does NOT do:**

* Cross-app or cross-site tracking (device ID is app-local, not platform-wide identifier)  
* Browser fingerprinting techniques (canvas fingerprinting, font enumeration, etc.) — not used on web  
* Location tracking — device ID does not include geographic data  
* Hardware fingerprinting beyond `identifierForVendor` (iOS) and app-generated UUID (Android)  
* Silent sharing of device ID with third parties — header is used server-side only

**User cost:** minimal. Device ID is app-generated, privacy-friendly, user-facing only in security event notifications ("new device signed in").

**Kept because:** Credential stuffing is the most common attack vector against consumer apps. Device signal gives meaningful defense at low privacy cost.

### **8.8 Certificate pinning**

Mobile app pins certificates for API calls to `*.lyceon.ai`:

* **Primary pin:** SHA-256 hash of the current API server certificate's public key  
* **Backup pin:** SHA-256 hash of the next planned certificate's public key (to allow rotation without app update)  
* **Pin refresh:** every 6 months per certificate rotation schedule  
* **Failure behavior:** pinning failure blocks the request; client shows "connection security error, please update the app"

Pinning configuration lives in app bundle (not fetched dynamically). App updates ship new pins ahead of certificate rotation.

### **8.8.1 Threat model — why pinning (with acknowledged tradeoff)**

**Threat mitigated:** Man-in-the-middle attacks on compromised networks (hostile wifi, compromised ISPs, nation-state intercept), and CA compromise attacks where a trusted CA issues a fraudulent certificate for `lyceon.ai`.

**Attack pattern without pinning:** Attacker on user's network (coffee shop wifi, malicious VPN) uses a fraudulent cert signed by a trusted CA to intercept HTTPS. Browser validates the cert chain and trusts it. API traffic decrypted in flight. Authentication tokens and student data exposed.

**What pinning gains:** Cert chain validation alone is insufficient because any trusted CA can issue a valid-looking cert for our domain (DigiNotar, Symantec incidents show this is not theoretical). Pinning binds trust to specific key material we control, not to the broader CA ecosystem.

**Acknowledged operational cost:**

* Certificate rotation becomes app-release-coupled (new cert requires app update shipping new pin ahead of rotation)  
* Emergency cert rotation (compromise response) requires emergency app release  
* Misconfiguration can break the app for all users simultaneously

**Risk mitigation:**

* Backup pin shipped alongside primary enables rotation without app update in normal cases  
* Pin refresh cadence (180 days) aligned with certificate rotation schedule in `mobile_auth_config`  
* Pinning only on `*.lyceon.ai` calls (not third-party services)  
* App update review before cert rotation with verified backup pin present

**User cost:** minimal when done correctly (user never sees it), catastrophic when done incorrectly (app broken until update). Mitigation via careful rotation discipline and backup pins.

**Kept because:** Minor's data warrants defense above browser-default trust. Operational discipline cost is acceptable given the backup pin pattern.

### **8.9 Offline behavior — entitlement and access fail closed**

**Mobile clients do not cache entitlement state for offline use.** If the device has no connectivity, entitlement-gated features are unavailable and surface a "connection required" message.

Rationale: Cached entitlement on the client is an attack surface. A user could:

* Cache a Premium entitlement then cancel billing, and the cache would permit Premium access offline  
* Manipulate local state to elevate cached entitlement  
* Continue using Premium features indefinitely if the device stays offline

Fail-closed is the correct default for entitlement, especially on a platform serving minors.

**Exception — read-only access to prior work:** Cached practice history, saved explanations, and offline-marked content may remain accessible offline. These are read operations on content the user already accessed online; no entitlement check is bypassed.

**Exception — cached identity for UX:** User's display name and profile picture may be cached for offline UI rendering. These are cosmetic, not access-granting.

### **8.10 Mobile auth rate limiting**

Login, signup, password reset, and magic link request endpoints are rate-limited via Doc 01A `RateLimitLedger` (consumed uniformly across web and mobile):

* Per-IP \+ per-device-id rate limits  
* Failed login lockout per §11  
* Magic link request cooldown  
* Password reset request cooldown

Limits live in `auth_runtime_config` per Appendix A.

### **8.11 Mobile-specific failure modes**

| Scenario | Mobile behavior |
| ----- | ----- |
| Refresh token expired | Redirect to login screen |
| Access token expired during request | Silent refresh \+ retry; if refresh fails, redirect to login |
| Biometric not available at time of sensitive action | Fall back to password re-entry prompt |
| Secure storage unavailable (rare; hardware issue) | Block authentication; show diagnostic UI |
| Device identifier changes (device reset, app reinstall) | Treated as new device; may trigger step-up auth |
| Clock skew detected (\>5 min from server) | Show diagnostic; refuse auth until corrected |
| Certificate pin failure | Block request; prompt to update app |
| Jailbreak/root detected | (Future target) Log signal to `AbuseScoreService`; may restrict high-value actions |

## **§9 Login and signup flows**

### **9.1 Signup flow**

1. User submits email/password via signup form  
2. Supabase Auth creates `auth.users` row, sends email verification  
3. User clicks verification link  
4. On verification, `profile-service.ts` creates `profiles` row  
5. User lands in onboarding flow to complete profile (name, DOB, country via billing if applicable)  
6. For under-13 signup: guardian consent flow (Part VI) triggers before any feature access

### **9.2 Login flow**

1. User authenticates via Supabase Auth (email/password, magic link, or OAuth)  
2. Supabase issues session JWT, sets cookies (web) or returns tokens (mobile)  
3. Backend validates JWT on each request via `supabaseAuthMiddleware`  
4. `profiles.role` read for authorization context → `req.user.role`  
5. `profiles.last_login_at` updated on successful authentication  
6. MFA challenge if required by role (§10)

### **9.3 Multi-device sessions**

A user can be logged in from multiple devices simultaneously (web desktop \+ web mobile browser \+ iOS app \+ Android app). Exam integrity constraints (concurrent exam access) are handled per Doc 02B §17, not at the auth layer.

## **§10 Multi-Factor Authentication**

MFA uses Supabase's `auth.mfa_factors`, `auth.mfa_challenges`, `auth.mfa_amr_claims` tables. V8 specifies the rollout policy and enforcement on top of Supabase primitives.

### **10.1 MFA requirement by role**

| Role | MFA at launch | MFA gate |
| ----- | ----- | ----- |
| admin | Required | Immediate — no admin can authenticate without MFA enrolled |
| tutor | Required | Immediate |
| teacher | Required | Immediate |
| guardian | Encouraged → Required | 14-day grace from signup, OR required before first billing action |
| student | Encouraged → Required | 14-day grace from signup, OR required before first billing action |

Grace periods and gate triggers live in `auth_runtime_config.mfa_enforcement_days_for_students` and `auth_runtime_config.mfa_enforcement_days_for_guardians` (Appendix A).

### **10.2 Allowed MFA factor types**

At launch: **TOTP** (authenticator app) and **WebAuthn** (platform authenticators including FaceID/TouchID/Windows Hello/Android biometric, plus roaming authenticators like YubiKey).

SMS MFA is **not** supported (SIM swap vulnerability). Email MFA is **not** supported (not a second factor — email is already tied to the account).

Allowed factors live in `auth_mfa_config.mfa_factor_types_allowed` (Appendix A).

### **10.3 MFA enrollment**

Enrollment flow:

1. User navigates to Security settings  
2. Selects factor type (TOTP or WebAuthn)  
3. **TOTP:** app generates QR code, user scans in authenticator app, enters first code to verify  
4. **WebAuthn:** app invokes browser/platform WebAuthn API, user completes biometric or hardware key challenge  
5. Factor is persisted to `auth.mfa_factors`  
6. User prompted to save recovery codes (generated once, shown once, stored hashed server-side)

### **10.4 MFA challenge flow**

On login for MFA-required user:

1. Password or OAuth succeeds → preliminary session issued  
2. Challenge prompt: "Enter your authenticator code" or "Complete WebAuthn challenge"  
3. User provides code/completes challenge  
4. On success: full session issued (MFA-claimed JWT)  
5. Preliminary session is elevated or replaced

Challenge TTL: 5 minutes (`auth_mfa_config.mfa_challenge_ttl_seconds`).

### **10.5 MFA recovery**

If user loses MFA device:

1. Enter one of the recovery codes generated at enrollment  
2. Recovery code is single-use; marked used in DB after success  
3. On success, user is prompted to re-enroll MFA  
4. If all recovery codes exhausted: account locked; support escalation (§21 in V6, carried forward as §44.5 here)

## **§11 Failed login lockout**

After N failed login attempts within a time window, account is soft-locked.

* Threshold: `auth_runtime_config.failed_login_lockout_threshold` (default 5\)  
* Window: rolling 15 minutes  
* Lockout duration: `auth_runtime_config.lockout_duration_minutes` (default 15\)  
* Lockout communication: user sees "Account temporarily locked due to failed login attempts"  
* Support unlock: admin/support can unlock via support panel (§44.5)

Enforcement goes through Doc 01A `RateLimitLedger` with bucket key `login_attempts:{email}`.

## **§12 Password reset and account recovery**

### **12.1 Password reset flow**

1. User clicks "Forgot password" → enters email  
2. Rate-limited via `RateLimitLedger` bucket `password_reset:{email}` (default: 3/hour)  
3. Supabase sends password reset email (custom SMTP per V6 decision — Supabase dashboard custom SMTP at launch)  
4. User clicks link → arrives at password reset page  
5. Link TTL: `auth_runtime_config.password_reset_ttl_hours` (default 1 hour)  
6. User enters new password → reset completes → all active sessions invalidated  
7. Audit event emitted: `password_reset_completed`

### **12.2 Account recovery (lost email access)**

If user cannot access email (lost email account, forgot email):

1. Support escalation via contact form  
2. Identity verification: billing method on file, security questions, guardian confirmation for under-13  
3. Support-mediated recovery (§44.5) with audit trail

## **§13 Authentication deviation box**

**Current-state deviation:** Audit confirmed `supabaseAuthMiddleware` correctly uses HttpOnly cookies and rejects Bearer tokens. MFA enforcement is in place but rollout timing (14-day grace) requires verification. **Target-state:** Full §7-§12 spec. **Migration path:** Verify MFA grace timer implementation. Add CI check that no test or API path uses Bearer tokens. Document and implement mobile auth per §8 when mobile work begins. Verify SMS and email MFA are not silently allowed (Supabase config check).

---

# **Part III — Authorization**

## **§14 Three-layer authorization model**

Lyceon enforces authorization at three layers. **At V1 launch, Layer 1 is application-layer filtering; RLS is target-state pending Neon pooling resolution.**

### **Layer 1 — Application-layer row filtering (LAUNCH CANONICAL)**

Every query reading user-scoped data includes an explicit `WHERE user_id = req.user.id` filter (or the equivalent for the table's ownership column). This is enforced via:

**Canonical query helpers:**

// packages/shared/db/scoped-queries.ts  
function scopedFrom\<T\>(  
  supabase: SupabaseClient,  
  table: string,  
  userId: string  
): ScopedQueryBuilder\<T\> {  
  return supabase.from(table).eq('user\_id', userId) as ScopedQueryBuilder\<T\>;  
}

All routes use `scopedFrom(req.supabase, 'table_name', req.user.id)` rather than raw `from().eq()` calls. This centralizes the filter application and makes audit trivial.

**CI enforcement:** Lint rule rejects direct `supabase.from('<user-scoped-table>')` calls outside the scoped helper. Exceptions (admin read-across, service-role operations) are explicitly annotated.

### **Layer 2 — Row-Level Security (TARGET STATE)**

RLS policies enforce row ownership at the database layer. Format:

ALTER TABLE \<user\_scoped\_table\> ENABLE ROW LEVEL SECURITY;  
CREATE POLICY \<table\>\_select\_own ON \<user\_scoped\_table\>  
  FOR SELECT USING (user\_id \= auth.uid());  
CREATE POLICY \<table\>\_insert\_own ON \<user\_scoped\_table\>  
  FOR INSERT WITH CHECK (user\_id \= auth.uid());

RLS is target-state, disabled at launch due to Neon connection pooling dropping session context (see §14.3 deviation box). When RLS is re-enabled (via pooler migration), both layers operate as defense-in-depth: Layer 1 is a belt, Layer 2 is suspenders.

### **Layer 3 — Audit logging**

Every authorization-relevant action logs to `audit_logs`:

* Granted actions: logged at INFO level with actor, target, action, context  
* Denied actions at application layer: logged at WARN level with reason  
* Denied actions at RLS layer: logged implicitly (query returned no rows; not surfaced as explicit denials)

Audit retention per Doc 01A §74 observability config.

## **§14.3 Authorization deviation box**

**Current-state deviation:** Per 2026-04-23 audit, Neon connection pooling drops Postgres session context, rendering `auth.uid()` unreliable in RLS policies. Data isolation is enforced purely at application layer via `WHERE user_id = req.user.id` in queries. Audit finding: "Extending the ecosystem logic safely relies completely on manual WHERE user\_id filters. Forgetting the filter allows catastrophic boundary leakage." (Severity: MEDIUM). **Target-state:** Both Layer 1 (application-layer filtering) AND Layer 2 (RLS policies) enforced. Defense-in-depth model. **Migration path:** (1) Investigate Supabase Supavisor connection pooler (RLS-compatible session mode) or equivalent Neon configuration that preserves session context. (2) Before RLS re-enablement, audit all RLS policies for correctness across roles. (3) Enable RLS table-by-table with canary deployments; verify no query regressions. (4) Retain application-layer filtering permanently as defense-in-depth. (5) Add CI check that every user-scoped table has both RLS policies AND scoped query helper usage. **Cutover criteria (required before RLS reinstatement):** (a) pooler or connection-mode change validated to preserve `auth.uid()` in session context under load; (b) every user-scoped table has a documented RLS policy set reviewed for correctness by engineering; (c) policy set tested in staging with real multi-role traffic demonstrating correct isolation; (d) canary deployment plan identifies the first table to enable RLS on and the rollback trigger; (e) application-layer `scopedFrom` helper remains in place as defense-in-depth (not removed). **Blocking conditions:** pooler does not reliably preserve session context; any user-scoped table lacks an RLS policy; staging tests show RLS breaking legitimate queries; absence of per-table canary deployment plan; proposal to remove application-layer filtering as part of RLS rollout (must remain as defense-in-depth). **Completion proof:** RLS enabled on every user-scoped table; staging and production traffic show zero query regressions attributable to RLS; test matrix (Doc 01.1) includes cross-role privilege escalation tests that pass with RLS enabled; `scopedFrom` helper still in use with CI enforcement. Per-table migration runbook in Doc 01.2.

## **§15 Role resolution**

On every authenticated request, `req.user.role` is resolved from `profiles.role` (not from JWT claims). JWT role claims may be used for coarse middleware routing but are **validated against `profiles.role` for any authorization-relevant decision**.

### **Role enum (target-state)**

CREATE TYPE profile\_role AS ENUM (  
  'student', 'guardian', 'admin', 'tutor', 'teacher'  
);

Future roles (e.g., `school_admin`, `district_admin`) will be added via enum extension migration.

### **Role change audit**

Every role change emits `role_changed` audit event with old and new role. Role changes require support escalation for non-self-service changes (§44.5).

## **§16 Permission matrix**

| Action | Student | Guardian | Admin | Tutor | Teacher |
| ----- | ----- | ----- | ----- | ----- | ----- |
| Self profile read/update | ✓ | ✓ | ✓ | ✓ | ✓ |
| Linked student profile read | — | Aggregate only | ✓ | — | — |
| Linked student profile write | — | — | ✓ | — | — |
| Practice/review/exam (own) | ✓ | — | ✓ (own) | — | — |
| Tutor (own) | ✓ (per entitlement) | — | ✓ (own) | — | — |
| Mastery (own) | ✓ | Aggregate only for linked | ✓ | — | — |
| Billing self | ✓ | ✓ (pay for linked student) | ✓ | — | — |
| Content publishing | — | — | ✓ (via Doc 02A flow) | — | — |
| Role switching requests | — | — | ✓ (process requests) | — | — |
| Admin surfaces | — | — | ✓ | — | — |
| Tutor surfaces (assigned students) | — | — | ✓ | ✓ (future) | — |
| Teacher surfaces (cohort students) | — | — | ✓ | — | ✓ (future) |
| Guardian linking | — | ✓ (initiate) | ✓ | — | — |
| Account deletion (self) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Account deletion (other) | — | — | ✓ (support-mediated) | — | — |

## **§17 Admin access pattern**

Admin-only reads use `is_admin_jwt()` function which reads the JWT's role claim. This is the canonical admin check pattern.

CREATE OR REPLACE FUNCTION is\_admin\_jwt() RETURNS BOOLEAN AS $$  
BEGIN  
  RETURN (  
    SELECT role FROM profiles  
    WHERE id \= auth.uid()  
  ) \= 'admin';  
END;  
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

**Legacy admin check deprecated:** Policies using `EXISTS (SELECT 1 FROM users WHERE is_admin = true)` are legacy. Migrate to `is_admin_jwt()`.

## **§17A Role switching**

Students can request role switches (e.g., student → tutor upon becoming a verified tutor). Role switching is **support-mediated**, not self-service:

1. User initiates role switch request via profile/settings  
2. Request sends pre-drafted email to support via `supportEscalation.sendRoleSwitchRequest(profileId, requestedRole)` helper  
3. Support agent verifies eligibility (background check, credentials for tutor/teacher roles, guardian verification for guardian role, etc.)  
4. Support agent approves or rejects via admin panel  
5. On approval, `profile-service.ts` updates `profiles.role` with audit event  
6. **If the new role is privileged (admin, tutor, teacher) and differs from the prior role, all active sessions for the profile are invalidated via `supabase.auth.admin.signOutUser(profileId)`** — this forces the user to re-authenticate (which naturally re-challenges MFA per §10) before any elevated capability is available  
7. User receives notification of role change with "please sign in again to complete the transition" messaging when applicable  
8. Role-specific permissions take effect on the next authenticated request after re-login

Role switching does NOT delete and recreate the profile. Same `profiles.id` retained.

### **17A.1 Session invalidation on privileged elevation (security guardrail)**

When a role change elevates the user into a **privileged role** (`admin`, `tutor`, `teacher`), `profile-service.ts` invalidates all active sessions for the profile as part of the role-change transaction.

**What this prevents:**

Without this guardrail, a stale low-privilege session (e.g., an old student JWT cached in a browser that has been idle for days) would silently gain elevated capability on the next request — since `profiles.role` is authoritative per §18 and JWT role claims are discarded. An attacker who had compromised a user's session while they were a regular student would retain access that now reaches admin surfaces.

**Security posture after guardrail:**

Role elevation forces re-authentication. Re-authentication triggers the MFA challenge required for the new role per §10.1 (MFA required immediately for admin/tutor/teacher). The combination means: (1) any attacker holding a stolen pre-elevation session loses it on elevation, and (2) the re-login re-verifies identity via MFA before any privileged action is possible.

**Scope:**

* **Elevation into** privileged roles (`student` → `admin`, `guardian` → `tutor`, etc.): invalidation applies  
* **Lateral** privileged role changes (`tutor` → `teacher`): invalidation applies (still a capability change)  
* **De-elevation** out of privileged roles (`admin` → `student`): invalidation applies (preserves symmetry; ensures audit clarity)  
* **Same-role** writes (profile field updates that don't change role): no invalidation

**Failure behavior:**

If `signOutUser` call fails after the `profiles.role` update commits, the role change is **not** rolled back. The role change is the authoritative state; session invalidation is a security guardrail layered on top. Retry logic:

* `signOutUser` failure is logged at WARN level with `role_change_session_invalidation_failed` event  
* A background retry (up to 3 attempts, 30s apart) completes the invalidation  
* If all retries fail, ops is alerted and manual intervention runs the invalidation  
* Stale sessions are bounded by the JWT expiry window (1 hour per §7.1 defaults) even if invalidation never succeeds — so worst-case exposure is one JWT TTL, not indefinite

### **Role switch invariants**

* Role downgrade (e.g., admin → student) allowed but requires admin approval  
* Under-13 students cannot switch to any non-student role  
* Guardian role switch requires unlinking from all students first  
* All role changes between privileged and non-privileged roles invalidate sessions per §17A.1

## **§18 No client role trust principle**

Client-asserted roles are **never** used for authorization. JWT claims from Supabase contain a role field; this field may be used for coarse middleware routing (e.g., don't even send admin UI HTML to non-admin JWTs) but the authoritative role check is always `profiles.role` read server-side.

This prevents role escalation via:

* JWT tampering  
* Local storage manipulation (not applicable with HttpOnly cookies, but principle holds)  
* Replay of stale JWTs with elevated claims

### **18.1 Conflict resolution — JWT role vs profile role**

When JWT role claim and `profiles.role` disagree, **profile role wins every time**. The JWT role is discarded for authorization decisions. Behavior table:

| JWT role claim | `profiles.role` | Authorization outcome | Action taken |
| ----- | ----- | ----- | ----- |
| `student` | `student` | Authorized as student | Normal flow |
| `admin` | `admin` | Authorized as admin | Normal flow |
| `admin` | `student` | **Authorized as student** | JWT claim discarded; logged as anomaly |
| `student` | `admin` | Authorized as admin | JWT claim discarded; `profiles.role` wins |
| `<missing>` | `student` | Authorized as student | Default-to-profile behavior |
| `student` | `<missing>` | 401 `profile_not_found` | Orphan auth record; support escalation |
| `student` | `<soft-deleted>` | 401 `unauthenticated` | Soft-deleted accounts cannot authenticate |

**Why profile wins:** JWT is signed by Supabase Auth and carries claims set at token issue time. `profiles.role` is the canonical, real-time role state. A role change (student → admin via support escalation) updates `profiles.role` immediately but does not invalidate existing JWTs. The next request with the old JWT would carry stale role claim; authoritative read from `profiles.role` corrects this immediately without forcing all users to re-authenticate.

**Anomaly logging:** JWT role ≠ profile role is logged at WARN level with `auth_role_mismatch` event. Not an attack by itself (expected during role transitions), but elevated frequency is a signal worth monitoring. Per-user high frequency may indicate compromised credentials and is fed to `AbuseScoreService`.

**Cache staleness:** `profiles.role` is read fresh on every authenticated request (part of `req.user` hydration in `supabaseAuthMiddleware`). No cache of `profiles.role` exists. Role changes take effect on next request.

**Retry behavior:** None. The authoritative answer is computed per request; clients don't need to retry on role mismatch.

**Elevation security posture (cross-reference to §17A.1):** The rule that `profiles.role` wins every time has a security implication — a stale lower-privilege JWT would silently gain elevated capability if `profiles.role` were upgraded while the old session was still valid. To prevent this, §17A.1 mandates that all privileged role elevations (into admin/tutor/teacher) invalidate active sessions. The user must re-authenticate, which re-challenges MFA per §10. The JWT vs profile conflict rule in this section is the authoritative runtime behavior; the elevation session invalidation in §17A.1 is the security guardrail that makes this behavior safe.

## **§19 Role enforcement helpers (canonical)**

// server/middleware/auth-role.ts

export const requireStudentOrAdmin \= (req, res, next) \=\> {  
  if (\!\['student', 'admin'\].includes(req.user.role)) {  
    return res.status(403).json({  
      error: { code: 'role\_not\_permitted', message: 'Student access required' }  
    });  
  }  
  next();  
};

export const requireGuardian \= (req, res, next) \=\> { /\* ... \*/ };  
export const requireAdmin \= (req, res, next) \=\> { /\* ... \*/ };  
export const requireTutorOrAdmin \= (req, res, next) \=\> { /\* ... \*/ };  
export const requireTeacherOrAdmin \= (req, res, next) \=\> { /\* ... \*/ };

All routes apply the appropriate role helper. CI enforces that every non-public route has at least one role helper applied.

**Current-state deviation:** Audit confirmed `requireStudentOrAdmin` and `requireGuardianRole` exist in `server/middleware/`. `requireTutorOrAdmin` and `requireTeacherOrAdmin` are target additions (tutor and teacher roles are future, not launch). **Target-state:** All five helpers present; applied universally. **Migration path:** Verify existing helpers match interface. Add `requireTutorOrAdmin` and `requireTeacherOrAdmin` when those roles ship.

---

# **Part IV — Billing & Stripe**

## **§20 Subscription model**

Lyceon uses **Stripe-native** subscription management:

* Stripe Customer per Lyceon profile (one-to-one, `profiles.stripe_customer_id`)  
* Stripe Subscription per entitled profile  
* Stripe Checkout for signup and subscription upgrades  
* Stripe Billing Portal for self-service subscription management (pause, cancel, update payment method)  
* Stripe webhooks drive entitlement transitions (§22)

### **Subscription tiers (at launch)**

* **Free** — no subscription; default state for new accounts  
* **Premium** — paid subscription; unlocks premium features per §30 matrix

Future tiers (e.g., Family, School) will be added with migration plan.

### **Stripe Tax**

Sales tax / VAT is handled by Stripe Tax. Enabled for all Tier 1 countries (US, CA, UK, AU, NZ, IE, SG). Tax calculation happens at Checkout and is included in subscription pricing.

### **Who pays**

* **Student pays for self:** standard case — student profile has `stripe_customer_id`, subscription attaches to student profile entitlement  
* **Guardian pays for linked student:** guardian initiates Checkout on student's behalf; payment method on guardian's Stripe customer; **entitlement attaches to the student profile**, not the guardian (§31)  
* **Guardian pays for self only:** guardian has Free tier unless also paying for own account; guardian-only subscriptions do NOT exist at launch (guardians are free users; benefit comes from supervising premium student)

## **§21 Subscription states and transitions**

| Stripe Subscription Status | Lyceon Entitlement | Runtime Effect |
| ----- | ----- | ----- |
| `active` | Premium active | Full premium feature access |
| `trialing` | Premium trial (not at launch) | Full premium feature access |
| `past_due` | Premium with grace period | Access continues for `entitlement_runtime_config.grace_period_days_past_due` (default 7); transitions to free after |
| `canceled` (at period end) | Premium until `current_period_end`, then free | Access continues to end of paid period; converts at period\_end |
| `canceled` (immediate) | Free | Access cuts immediately |
| `unpaid` | Free | Access cuts; user prompted to update payment method |
| `incomplete` | Free | Initial payment failed; user prompted to complete |
| `incomplete_expired` | Free | Initial payment never completed; subscription void |

## **§22 Stripe webhook handling**

Stripe webhooks are the authoritative trigger for entitlement state changes.

### **22.1 Handled webhook events**

| Event | Action |
| ----- | ----- |
| `checkout.session.completed` | Create or update subscription record; flip entitlement to premium |
| `customer.subscription.created` | Upsert `entitlements` row |
| `customer.subscription.updated` | Update `entitlements` row per new status |
| `customer.subscription.deleted` | Mark entitlement as canceled; schedule transition per §21 |
| `invoice.payment_succeeded` | Confirm continued entitlement; update `current_period_end` |
| `invoice.payment_failed` | Move to past\_due grace period |
| `customer.updated` | Sync billing address → `profiles.country_code` for entitlement gating |

### **22.2 Webhook idempotency**

Stripe webhook idempotency is handled via Doc 01A `IdempotencyService`:

// server/lib/webhookHandlers.ts  
await idempotencyService.checkOrRecord({  
  scope: 'stripe\_webhook',  
  clientKey: stripeEvent.id,  
  contentHash: hashStripeEvent(stripeEvent),  
  handler: () \=\> processStripeEvent(stripeEvent)  
});

Duplicate webhooks (same event ID) are silently ignored after the first successful processing, per `IdempotencyService` contract.

**Current-state deviation:** Audit confirmed `stripe_webhook_events` table with unique constraint on event ID is already the idempotency mechanism in `server/lib/webhookHandlers.ts:119`. Target-state formalizes this via `IdempotencyService` wrapper for consistency with other idempotency use cases.

### **22.3 Webhook signature verification**

Every webhook request is verified using Stripe's signature verification:

const event \= stripe.webhooks.constructEvent(  
  req.rawBody,  
  req.headers\['stripe-signature'\],  
  process.env.STRIPE\_WEBHOOK\_SECRET  
);

Invalid signature → 400 rejection. Signature verification runs before any event processing.

### **22.4 Webhook cache invalidation**

After entitlement state change in DB, webhook handler issues `NOTIFY entitlement_invalidate '{student_id}'` per Doc 01A §4 pattern. All API instances listening to this channel invalidate their in-process entitlement cache for that student.

## **§23 Past due and grace period behavior**

When payment fails:

1. Stripe marks subscription `past_due`  
2. `invoice.payment_failed` webhook fires  
3. Entitlement enters grace period (default 7 days, `entitlement_runtime_config.grace_period_days_past_due`)  
4. Stripe's Smart Retries attempts charge retry automatically  
5. During grace period, user retains Premium access  
6. If retry succeeds: `invoice.payment_succeeded` → back to active  
7. If grace expires: entitlement transitions to Free

User is notified at:

* Day 0 (payment failed email)  
* Day 3 (reminder with update payment method link)  
* Day 6 (final warning)  
* Day 8 (transition to Free confirmation)

## **§24 Billing deviation box**

**Current-state deviation:** Stripe webhook handling is implemented in `server/lib/webhookHandlers.ts` with idempotency via `stripe_webhook_events` unique constraint (audit-confirmed reliable). Stripe Tax enablement and Tier 1 country setup require verification of Stripe dashboard configuration. `stripeCancellationQueue` (referenced by §40.2.1 deletion flow) is a new Postgres-backed queue that does not yet exist. **Target-state:** §20-§23 spec plus `stripeCancellationQueue` Postgres-backed durable queue for deletion-phase Stripe retry. **Migration path:** (1) Wrap existing webhook handler in Doc 01A `IdempotencyService` interface. (2) Verify Stripe Tax is enabled for all Tier 1 countries. (3) Add NOTIFY emission after entitlement writes per §22.4. (4) Audit that all subscription state transitions produce audit events. (5) Build `stripeCancellationQueue` as a Postgres table with owning service per Doc 01A §2 pattern; implement retry worker with exponential backoff schedule per §40.2.1. **Cutover criteria:** (a) webhook handler invokes `IdempotencyService.checkOrRecord` rather than the raw unique-constraint pattern; (b) Stripe Tax dashboard verification artifact attached; (c) NOTIFY emission test confirmed end-to-end (webhook → DB write → NOTIFY → LISTEN-side cache invalidation); (d) `stripeCancellationQueue` table created with retry worker deployed; (e) operational ownership named — billing-service module owns queue logic; ops team owns alerting on `deletion_stripe_cancellation_failure_rate`. **Blocking conditions:** webhook handler still using raw unique-constraint idempotency without `IdempotencyService` abstraction; Stripe Tax not verified on dashboard; no NOTIFY emission test in CI; `stripeCancellationQueue` missing or retry worker not running; no named operational owner for the retry queue. **Completion proof:** webhook handler test suite covers `IdempotencyService` happy-path and duplicate-event paths; Stripe Tax verified artifact stored in ops doc; NOTIFY→LISTEN invalidation tested in staging and measurable via `entitlement_cache_invalidated` log events; queue worker processes test-injected failures within expected backoff windows; `stripe_cancellation_status` transitions visible in staging deletion tests. Detailed runbook in Doc 01.2 (billing migrations) and Doc 01.3 (operational procedures).

---

# **Part V — EntitlementService (Canonical Spec)**

This part establishes the canonical `EntitlementService` — the single repo-wide module that every feature doc consumes for entitlement checks. No feature defines its own entitlement cache, webhook handler, or check logic.

## **§25 EntitlementService overview**

### **25.1 Purpose**

`EntitlementService` is the single authoritative source for answering: "Can this student access this feature right now?" Every entitlement-gated surface (practice, review, exam, tutor, calendar, mobile-specific features, future surfaces) consumes this service.

### **25.2 Design principles**

* **One service, one cache, one invalidation path.** No duplication across feature docs.  
* **Feature-check interface.** Callers ask "can access feature X?" — service returns allow/deny \+ reason. No scattered `if (tier === 'premium')` checks.  
* **Cached by default with LISTEN/NOTIFY invalidation.** In-process memory cache, 60s TTL, event-driven invalidation via Postgres NOTIFY on Stripe webhook and profile updates.  
* **Fail closed on DB unavailability.** No cached fallback beyond the hard staleness bound.  
* **Guardian derivation included.** Guardian premium access is derived from linked student's entitlement per §31, not a separate guardian entitlement record.

### **25.3 Non-goals**

* Not a billing service (that's §20-§23)  
* Not an authorization service (role checks are §15-§19; `EntitlementService` only checks entitlement, not role)  
* Not a rate limiter (that's Doc 01A `RateLimitLedger`)

## **§26 Interface**

### **26.1 Method signatures**

interface EntitlementService {  
  /\*\*  
   \* Check if a student can access a specific feature.  
   \* Primary method — every entitlement gate calls this.  
   \*/  
  canAccessFeature(  
    studentId: string,  
    featureKey: FeatureKey,  
    req: AuthenticatedRequest  
  ): Promise\<FeatureAccessResult\>;

  /\*\*  
   \* Get the student's full entitlement snapshot.  
   \* Used for dashboards, renewal banners, upgrade UX.  
   \*/  
  getEntitlementSnapshot(  
    studentId: string,  
    req: AuthenticatedRequest  
  ): Promise\<EntitlementSnapshot\>;

  /\*\*  
   \* Invalidate cached entitlement for a student.  
   \* Called by Stripe webhook handler, profile update paths.  
   \* Emits NOTIFY for cross-instance invalidation.  
   \*/  
  invalidate(studentId: string): Promise\<void\>;  
}

type FeatureAccessResult \= {  
  allowed: boolean;  
  reason?: AccessDenialReason;  
  entitlementSnapshot: EntitlementSnapshot;  
};

type AccessDenialReason \=  
  | 'not\_paid'  
  | 'expired'  
  | 'under\_age'  
  | 'region\_blocked'  
  | 'live\_exam\_in\_progress'  
  | 'account\_soft\_deleted'  
  | 'abuse\_score\_lockout';

type EntitlementSnapshot \= {  
  tier: 'free' | 'premium';  
  isActive: boolean;  
  expiresAt: Date | null;  
  graceUntil: Date | null;  
  source: 'student\_direct' | 'guardian\_linked\_student' | 'none';  
  countryCode: string;  
  ageYears: number | null;  
  accountStatus: 'active' | 'soft\_deleted';  
};

type FeatureKey \=  
  | 'practice\_unlimited'  
  | 'practice\_daily\_free'  
  | 'tutor\_access'  
  | 'review\_full'  
  | 'exam\_full\_length'  
  | 'calendar\_access'  
  | 'mastery\_detail'  
  | 'historical\_trends'  
  | ...;

### **26.2 Method semantics**

**`canAccessFeature`:**

* Runs complete check: Paid \+ not-expired \+ age-eligible \+ region-eligible \+ not-in-live-exam \+ not-soft-deleted \+ abuse-score-ok  
* Returns `allowed: true` only if all conditions pass  
* On denial, returns the **first** failing reason (deterministic order per §27.1)  
* Always includes `entitlementSnapshot` for UX (renewal banner, countdown)

**`getEntitlementSnapshot`:**

* Returns the current snapshot without feature-specific gating logic  
* Used for rendering billing UI, showing current tier

**`invalidate`:**

* Clears the local in-process cache entry for the student  
* Emits `NOTIFY entitlement_invalidate '{student_id}'` for cross-instance invalidation  
* Called by Stripe webhook handler after entitlement DB write, and by `profile-service.ts` after profile updates that affect entitlement (country change, age change, soft-delete)

## **§27 Feature-to-entitlement mapping**

### **27.1 `entitlement_features` table**

CREATE TABLE entitlement\_features (  
  feature\_key TEXT PRIMARY KEY,  
  required\_tier TEXT NOT NULL CHECK (required\_tier IN ('free', 'premium')),  
  required\_age\_minimum INTEGER DEFAULT 13,  
  requires\_tier\_1\_country BOOLEAN DEFAULT TRUE,  
  blocked\_during\_live\_exam BOOLEAN DEFAULT FALSE,  
  min\_abuse\_score\_tier TEXT DEFAULT 'clean',  
  enabled BOOLEAN DEFAULT TRUE,  
  description TEXT,  
  added\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  deprecated\_at TIMESTAMPTZ  
);

Feature gates are declarative — adding or modifying a gate is a DB row change, not a code change.

### **27.2 Launch seed**

INSERT INTO entitlement\_features (feature\_key, required\_tier, blocked\_during\_live\_exam, description) VALUES  
('practice\_daily\_free', 'free', FALSE, 'Daily practice quota for free tier'),  
('practice\_unlimited', 'premium', FALSE, 'Unlimited practice'),  
('tutor\_access', 'premium', TRUE, 'LISA AI tutor access; blocked during live exam'),  
('review\_full', 'premium', FALSE, 'Full review with spaced repetition'),  
('exam\_full\_length', 'premium', FALSE, 'Full-length SAT exams'),  
('calendar\_access', 'premium', FALSE, 'Study calendar'),  
('mastery\_detail', 'premium', FALSE, 'Section/domain/skill-level mastery breakdown'),  
('historical\_trends', 'premium', FALSE, 'Historical mastery trend data');

### **27.3 Feature access evaluation order**

For `canAccessFeature(studentId, featureKey)`, checks run in this deterministic order. First failure wins:

1. **Feature exists and is enabled** — if feature key not in table or `enabled = false` → `allowed: false, reason: 'feature_disabled'`  
2. **Account not soft-deleted** — `profiles.deleted_at IS NULL` → else `account_soft_deleted`  
3. **Age eligible** — `profiles.age_years >= feature.required_age_minimum` → else `under_age`  
4. **Country eligible** — if `requires_tier_1_country`, `profiles.country_code IN tier_1_countries` → else `region_blocked`  
5. **Tier sufficient** — resolve entitlement snapshot; `snapshot.tier >= feature.required_tier` → else `not_paid` or `expired`  
6. **Live exam not in progress** — if `blocked_during_live_exam`, check no active full-length exam → else `live_exam_in_progress`  
7. **Abuse score acceptable** — check `AbuseScoreService` tier \>= minimum → else `abuse_score_lockout`

All checks pass → `allowed: true`.

### **27.3.1 Abuse lockout override path**

When `AbuseScoreService.tier === 'critical'` (score 81-100 per Doc 01A §32), a user is functionally locked out of entitlement-gated features with `abuse_score_lockout`. This lockout is reversible via support.

**Override path:**

1. User (or guardian on their behalf) contacts support  
2. Support agent reviews the abuse score audit trail (which incidents contributed to the score, severity, timing)  
3. Agent determines if override is warranted (false positive from classifier, explained behavior, dispute resolution)  
4. If override granted, agent uses admin panel to:  
   * Adjust score via `AbuseScoreService.adjustScore(studentId, newScore, reason, actorId)` per Doc 01A §30  
   * Score adjustment is audited; the `reason` field is mandatory  
5. Override takes effect on next entitlement check (cache TTL 60s, or immediate if support triggers explicit invalidation)  
6. Student notified: "Your account has been restored. If you believe incidents were in error, reach out at any time."

**Reversibility guarantees:**

* Every score adjustment is reversible — `AbuseScoreService` stores the adjustment history, not just current score  
* Adjustments are additive events, not overwrites, so support can roll back their own override if investigation reveals the original lockout was correct  
* Automated nightly re-scoring (Doc 01A §35) does not override manual adjustments within a 30-day window (`abuse_score_runtime_config.manual_override_respect_days`)

**Audit trail:**

* `tutor_abuse_scores.appeal_history` JSONB (per Doc 01A §33) captures every adjustment with timestamp, actor, prior score, new score, reason  
* Appeal events additionally log to `audit_logs` with action `abuse_score_adjusted`  
* Weekly review of adjustments by trust & safety team to catch patterns (specific agent granting many overrides, specific incident types being consistently overridden as false positive → classifier tuning signal)

**Out of support scope at V1:**

* Automated appeal resolution (V2 target per Doc 01A §37)  
* User-visible abuse score or appeal UI (intentionally not exposed to avoid gaming)  
* Bulk override operations (individual review required)

## **§28 Caching strategy**

Per Doc 01A §1-§8 caching pattern: in-process memory cache per API instance with LISTEN/NOTIFY invalidation.

### **28.1 Cache layer**

* **Storage:** in-process Map\<studentId, { snapshot, expiresAt }\>  
* **Key:** `studentId` (UUID string)  
* **Value:** `EntitlementSnapshot` \+ local expiry timestamp  
* **TTL:** `entitlement_runtime_config.entitlement_cache_ttl_seconds` (default 60s)

### **28.2 Cache read flow**

async canAccessFeature(studentId, featureKey, req) {  
  const cached \= entitlementCache.get(studentId);  
  const snapshot \= (cached && cached.expiresAt \> Date.now())  
    ? cached.snapshot  
    : await this.loadAndCacheSnapshot(studentId);

  return evaluateFeatureAccess(snapshot, featureKey, req);  
}

Cache miss or expiry → DB read → cache write. Multi-threaded safety: cache is shared Map; Node single-threaded event loop means no lock required within a process.

### **28.3 Cache write**

On DB read:

entitlementCache.set(studentId, {  
  snapshot: loadedSnapshot,  
  expiresAt: Date.now() \+ (CONFIG.entitlement\_cache\_ttl\_seconds \* 1000\)  
});

## **§29 Cache invalidation**

### **29.1 NOTIFY channel**

Channel: `entitlement_invalidate` Payload: JSON with `{ student_id }`

### **29.2 Invalidation triggers**

Every write path that affects a student's entitlement emits a NOTIFY after the DB write commits:

1. **Stripe webhook handler** — after writing `entitlements` row → NOTIFY for student\_id  
2. **`profile-service.ts`** — after updating `profiles.country_code`, `profiles.date_of_birth`, `profiles.deleted_at` → NOTIFY  
3. **Guardian linking** (`guardian_links` insert/delete) — NOTIFY for affected student\_id  
4. **Admin entitlement override** (support tool) — NOTIFY

### **29.3 LISTEN loop**

Every API instance runs a background task:

const listener \= await pool.connect();  
await listener.query('LISTEN entitlement\_invalidate');  
listener.on('notification', (msg) \=\> {  
  const { student\_id } \= JSON.parse(msg.payload);  
  entitlementCache.delete(student\_id);  
});

Dropped connections: listener reconnects with exponential backoff. Missed notifications during disconnection: 60s TTL catches up.

### **29.4 Invalidation failure behavior**

* NOTIFY failure at emitter side: logged, not blocking for the underlying DB write. TTL catches up within 60s.  
* LISTEN connection dropped at consumer side: logged, reconnect attempted with backoff. Stale cache entries age out via TTL within 60s.

Invalidation is best-effort for correctness. TTL is the safety net.

### **29.5 Production modes (cross-reference)**

The LISTEN/NOTIFY pattern has operational subtleties that live in Doc 01A §4 caching strategy. V8 entitlement invalidation inherits those operational modes:

* **Single-instance launch mode** — one API instance; LISTEN loop local; invalidation effectively synchronous  
* **Multi-instance mode** — N API instances; each runs its own LISTEN loop; NOTIFY fans out to all listeners via Postgres native pub/sub  
* **Degraded mode** — one or more instances have dropped LISTEN connections; affected instances fall back to TTL-only invalidation (60s worst-case staleness) until reconnection  
* **Migration mode** — rolling deploys cycle instances; LISTEN connections briefly drop and reconnect; in-flight notifications during the gap are missed but caught by TTL  
* **pgBouncer/connection pooler considerations** — LISTEN requires session-mode connections (not transaction-mode); Supavisor session mode or direct Postgres connections required for listener; documented in Doc 01A §4

Operational runbooks for these modes live in Doc 01.3 Engineer Runbooks (scoped as companion artifact per V8 footer).

## **§30 Failure modes**

### **30.1 DB unavailability during cache miss**

* Cache miss → DB read attempted → DB times out or errors  
* Response: `503 Service Unavailable` with error code `entitlement_check_unavailable`  
* Client sees: "Verifying your account, please try again"  
* Retried after transient issue resolves

### **30.2 DB unavailability with cached value present**

If cache has a non-expired value, use it. If TTL expired but DB unavailable:

* Check hard staleness bound: `entitlement_runtime_config.entitlement_hard_staleness_seconds` (default 300s)  
* If cached value within hard staleness bound: use it with warning logged  
* If beyond hard staleness: fail closed with 503

This is the limited degradation per §30.1 — preserves service during transient DB blips without indefinite staleness.

### **30.3 Cache poisoning defense**

* Cache is written only by the service's own DB read path  
* No external API or process can inject cache entries  
* Cache values include full snapshot (no incremental updates); cache corruption would require process memory corruption

### **30.4 Invalidation race**

Race scenario: Stripe webhook fires → DB write → NOTIFY → LISTEN picks up → cache cleared. Meanwhile, another request starts, sees no cache entry, reads DB. If the request started before DB commit of new state, it could read old entitlement.

Mitigation: NOTIFY is emitted **after** DB commit. Requests reading DB after NOTIFY see new state. Requests reading DB in the brief window before commit see old state (acceptable — this is the normal transaction isolation boundary).

## **§31 Guardian-derived entitlement**

### **31.1 Guardian premium comes from linked student**

Guardians do NOT have their own entitlement. A guardian's access to premium surfaces (i.e., guardian dashboard showing linked student's premium data) derives from the linked student's entitlement.

### **31.2 Derivation logic**

async resolveGuardianEntitlement(guardianProfileId, req) {  
  const linkedStudents \= await db.query(  
    'SELECT student\_profile\_id FROM guardian\_links WHERE guardian\_profile\_id \= $1 AND status \= $2',  
    \[guardianProfileId, 'active'\]  
  );

  const activeStudents \= await Promise.all(  
    linkedStudents.map(link \=\>  
      this.getEntitlementSnapshot(link.student\_profile\_id, req)  
    )  
  );

  const anyActive \= activeStudents.some(snap \=\> snap.isActive && snap.tier \=== 'premium');

  return {  
    tier: anyActive ? 'premium' : 'free',  
    isActive: anyActive,  
    source: anyActive ? 'guardian\_linked\_student' : 'none',  
    // ... other fields  
  };  
}

### **31.3 Guardian with multiple linked students**

If a guardian has multiple linked students, any one active premium student grants the guardian premium derivation. Unlinking the premium student reverts guardian to free (if no other premium students linked).

### **31.2.1 Query pattern for guardian derivation**

The reference implementation in §31.2 shows `Promise.all` over per-student `getEntitlementSnapshot` calls. At launch scale (vast majority of guardians link 1-3 students), this pattern is correct:

* Each `getEntitlementSnapshot` call hits the in-process cache first  
* Cache hits return in microseconds (Map lookup)  
* Cache misses for 3 students are 3 parallel DB reads (not serial)  
* Total latency for cold-cache guardian derivation: max(3 parallel reads) ≈ single read latency

**When N+1 becomes a concern:**

* Guardian linked to \>10 students (edge case; V2 product target for school accounts)  
* Bulk guardian dashboard rendering (not a V1 surface)  
* Cold cache scenario after instance restart serving many guardians simultaneously

**V1 scope — `Promise.all` pattern is sufficient** because:

* Guardian dashboard reads are infrequent (not hot path like tutor turns)  
* Typical guardian has 1-3 linked students  
* Cache hit rate \>95% in steady state (per Doc 03A V2 §19A.2 cache metrics)

**Future optimization (V2 target, not required at launch):**

Single aggregate query for guardians with many students:

SELECT  
  student\_id,  
  tier,  
  status,  
  current\_period\_end,  
  grace\_period\_ends\_at  
FROM profiles p  
JOIN guardian\_links gl ON gl.student\_profile\_id \= p.id  
LEFT JOIN entitlements e ON e.profile\_id \= p.id  
WHERE gl.guardian\_profile\_id \= $1  
  AND gl.status \= 'active'  
  AND p.deleted\_at IS NULL;

Triggered when `linked_students.length > 5`. Falls back to current pattern for typical guardians.

**Caching strategy for aggregate query:**

Guardian-level aggregate cache entry `guardian_entitlement:{guardianId}` with 60s TTL. Invalidated by any member student's entitlement change via additional NOTIFY on `guardian_entitlement_invalidate` channel (fires when any linked student's entitlement changes, payload includes all guardians linked to that student).

V1 does not implement this optimization. V2 target based on observed latency distribution.

### **31.4 Guardian paying for linked student**

Guardian pays for student (Stripe Customer is guardian; `stripe_customer_id` on guardian's profile). Subscription produces entitlement on **student's profile**, not guardian's. Guardian's premium access derives from that student (§31.2).

**Current-state deviation:** Audit confirmed `resolveLinkedPairPremiumAccessForGuardian` exists in `server/lib/account.ts:591-643` implementing this derivation. Target-state wraps this in the `EntitlementService.getEntitlementSnapshot` interface for consistency. **Target-state:** Canonical `EntitlementService` with guardian derivation as a first-class case. **Migration path:** (1) Refactor `resolveLinkedPairPremiumAccessForGuardian` into `EntitlementService.resolveGuardianEntitlement`. (2) Migrate all call sites to use `EntitlementService` interface. (3) Remove direct `resolveLinkedPairPremiumAccessForGuardian` calls.

## **§32 Reference implementation**

### **32.1 Internal composition (V7.1)**

The external interface remains unified — every consumer calls `canAccessFeature(studentId, featureKey, req)` and gets a single decision. Internally, `EntitlementService` composes four focused modules to keep the implementation testable and avoid a god-object pattern:

EntitlementService (external interface)  
│  
├─ CacheManager        — in-process cache \+ LISTEN/NOTIFY invalidation  
├─ PolicyEvaluator     — tier, age, country, account status checks (declarative rules)  
├─ RuntimeGuard        — live exam state, deletion state, transient blocks  
└─ AbuseCheck          — adapter over Doc 01A AbuseScoreService

Each module has a focused responsibility, a tested interface, and can be swapped independently. `EntitlementService.canAccessFeature` orchestrates them in the evaluation order from §27.3.

**Why not split externally?** Callers only ever ask one question: "can this user access feature X right now?" Forcing callers to orchestrate 4 services means every caller has to know the evaluation order and composition rules. Keeping the orchestration inside `EntitlementService` is the correct layering — complexity hidden behind a simple interface.

**Composition diagram:**

canAccessFeature(studentId, featureKey)  
  │  
  ▼  
CacheManager.getSnapshot(studentId)   ──► hit: return cached snapshot  
  │                                    └► miss: DB read → cache write  
  ▼  
loadFeatureConfig(featureKey)          ──► entitlement\_features row  
  │  
  ▼  
PolicyEvaluator.evaluate(snapshot, feature)  
  │  
  │ Runs ordered checks (§27.3):  
  │   1\. feature enabled  
  │   2\. account not soft-deleted  
  │   3\. age eligible  
  │   4\. country eligible  
  │   5\. tier sufficient  
  │  
  │ First failure → return { allowed: false, reason }  
  │  
  ▼  
RuntimeGuard.check(snapshot, feature, req)  
  │ If feature.blocked\_during\_live\_exam:  
  │   check full\_length\_exams status  
  │  
  ▼  
AbuseCheck.verify(studentId)  
  │ Read AbuseScoreService tier  
  │ If 'critical': return { allowed: false, reason: 'abuse\_score\_lockout' }  
  │  
  ▼  
return { allowed: true, entitlementSnapshot: snapshot }

### **32.2 Implementation**

// packages/shared/services/entitlement-service.ts

import type { SupabaseClient } from '@supabase/supabase-js';  
import { config } from '../config/runtime-config';  
import { logger } from '../observability/logger';

type CacheEntry \= { snapshot: EntitlementSnapshot; expiresAt: number };  
const cache \= new Map\<string, CacheEntry\>();

export class EntitlementService {  
  constructor(  
    private supabase: SupabaseClient,  
    private abuseScoreService: AbuseScoreService  
  ) {}

  async canAccessFeature(  
    studentId: string,  
    featureKey: FeatureKey,  
    req: AuthenticatedRequest  
  ): Promise\<FeatureAccessResult\> {  
    const snapshot \= await this.getEntitlementSnapshot(studentId, req);  
    return this.evaluateFeatureAccess(snapshot, featureKey, req);  
  }

  async getEntitlementSnapshot(  
    studentId: string,  
    req: AuthenticatedRequest  
  ): Promise\<EntitlementSnapshot\> {  
    const cached \= cache.get(studentId);  
    if (cached && cached.expiresAt \> Date.now()) {  
      return cached.snapshot;  
    }

    const snapshot \= await this.loadFromDb(studentId, req);  
    cache.set(studentId, {  
      snapshot,  
      expiresAt: Date.now() \+ config.entitlement.cache\_ttl\_seconds \* 1000  
    });  
    return snapshot;  
  }

  async invalidate(studentId: string): Promise\<void\> {  
    cache.delete(studentId);  
    await this.supabase.rpc('notify\_entitlement\_invalidate', { student\_id: studentId });  
  }

  private async loadFromDb(studentId, req): Promise\<EntitlementSnapshot\> {  
    const { data, error } \= await this.supabase  
      .from('profiles')  
      .select('role, tier, country\_code, age\_years, deleted\_at, entitlements(\*)')  
      .eq('id', studentId)  
      .single();

    if (error) {  
      const staleFallback \= this.checkStaleFallback(studentId);  
      if (staleFallback) {  
        logger.warn('entitlement\_db\_unavailable\_stale\_fallback', { studentId });  
        return staleFallback;  
      }  
      logger.error('entitlement\_check\_failed', { studentId, error });  
      throw new EntitlementCheckUnavailableError();  
    }

    // Handle guardian derivation if role is guardian  
    if (data.role \=== 'guardian') {  
      return this.resolveGuardianEntitlement(studentId, req);  
    }

    return this.buildSnapshot(data);  
  }

  private async evaluateFeatureAccess(  
    snapshot: EntitlementSnapshot,  
    featureKey: FeatureKey,  
    req: AuthenticatedRequest  
  ): Promise\<FeatureAccessResult\> {  
    const feature \= await this.loadFeatureConfig(featureKey);  
    if (\!feature || \!feature.enabled) {  
      return { allowed: false, reason: 'feature\_disabled', entitlementSnapshot: snapshot };  
    }

    if (snapshot.accountStatus \=== 'soft\_deleted') {  
      return { allowed: false, reason: 'account\_soft\_deleted', entitlementSnapshot: snapshot };  
    }

    if (snapshot.ageYears \=== null || snapshot.ageYears \< feature.required\_age\_minimum) {  
      return { allowed: false, reason: 'under\_age', entitlementSnapshot: snapshot };  
    }

    if (feature.requires\_tier\_1\_country && \!config.entitlement.tier\_1\_countries.includes(snapshot.countryCode)) {  
      return { allowed: false, reason: 'region\_blocked', entitlementSnapshot: snapshot };  
    }

    if (feature.required\_tier \=== 'premium' && \!snapshot.isActive) {  
      return {  
        allowed: false,  
        reason: snapshot.expiresAt && snapshot.expiresAt \< new Date() ? 'expired' : 'not\_paid',  
        entitlementSnapshot: snapshot  
      };  
    }

    if (feature.blocked\_during\_live\_exam) {  
      const inLiveExam \= await this.checkLiveExamInProgress(snapshot, req);  
      if (inLiveExam) {  
        return { allowed: false, reason: 'live\_exam\_in\_progress', entitlementSnapshot: snapshot };  
      }  
    }

    const abuseScore \= await this.abuseScoreService.getScore(snapshot.studentId, req);  
    if (abuseScore.tier \=== 'critical') {  
      return { allowed: false, reason: 'abuse\_score\_lockout', entitlementSnapshot: snapshot };  
    }

    return { allowed: true, entitlementSnapshot: snapshot };  
  }

  // ... additional helpers: resolveGuardianEntitlement, checkLiveExamInProgress,  
  //     buildSnapshot, checkStaleFallback, loadFeatureConfig  
}

// LISTEN loop (runs once per API instance at startup)  
export async function startEntitlementInvalidationListener(pool: PgPool) {  
  const listener \= await pool.connect();  
  await listener.query('LISTEN entitlement\_invalidate');  
  listener.on('notification', (msg) \=\> {  
    const { student\_id } \= JSON.parse(msg.payload);  
    cache.delete(student\_id);  
    logger.debug('entitlement\_cache\_invalidated', { student\_id });  
  });  
  listener.on('error', (err) \=\> {  
    logger.error('entitlement\_listener\_error', { err });  
    // Reconnect with exponential backoff  
  });  
}

Full implementation detail in Appendix C.

## **§33 Consumed by**

Every entitlement-gated surface consumes `EntitlementService`:

| Surface | Usage |
| ----- | ----- |
| Practice routes | `canAccessFeature(userId, 'practice_unlimited')` before premium practice; `canAccessFeature(userId, 'practice_daily_free')` for free-tier daily quota |
| Review routes | `canAccessFeature(userId, 'review_full')` |
| Exam routes | `canAccessFeature(userId, 'exam_full_length')` |
| Tutor routes (Doc 03B) | `canAccessFeature(userId, 'tutor_access')` |
| Calendar routes | `canAccessFeature(userId, 'calendar_access')` |
| Mastery routes | `canAccessFeature(userId, 'mastery_detail')` |
| Historical data routes | `canAccessFeature(userId, 'historical_trends')` |
| Guardian dashboard | `getEntitlementSnapshot(guardianId)` → derivation per §31 |

No surface implements its own tier check. No surface maintains its own entitlement cache. All entitlement state flows through `EntitlementService`.

## **§34 Entitlement deviation box**

**Current-state deviation:** Audit confirmed that entitlement reads happen through `server/lib/account.ts` helpers (`isEntitlementActive`, `resolveLinkedPairPremiumAccessForGuardian`). Current state is entitlement-via-accounts (legacy `entitlements.account_id` → `accounts.id` via `ensure_account_for_user` RPC), not entitlement-on-profile. No canonical `EntitlementService` module exists as a single wrapped interface. **Target-state:** §25-§33 — canonical `EntitlementService` module. Entitlement-on-profile (`entitlements.profile_id`) per V6 CR-01-26 target. **Migration path:** (1) Create `packages/shared/services/entitlement-service.ts` wrapping existing `account.ts` helpers. (2) Migrate `entitlements` table from `account_id` FK to `profile_id` FK — add new column, backfill, migrate reads, retire old column. (3) Retire `ensure_account_for_user` RPC and `accounts`/`account_members` tables. (4) Migrate all entitlement read call sites to use `EntitlementService` interface. (5) Add NOTIFY emission in Stripe webhook handler and `profile-service.ts`. (6) Start LISTEN loop on API startup. (7) Add `entitlement_features` table with launch seed. (8) CI check: no direct `entitlements` table reads outside `EntitlementService`. **Cutover criteria:** (a) `entitlement-service.ts` deployed and passing contract tests; (b) `entitlements.profile_id` column added and backfilled with 100% coverage against `entitlements.account_id → accounts.owner_profile_id` joins; (c) comparison-read window run for at least 72 hours where both old and new code paths read entitlement and disagreements logged to `entitlement_migration_audit` (zero disagreements required before cutover); (d) all call sites migrated to `EntitlementService.canAccessFeature` and `EntitlementService.getEntitlementSnapshot`; (e) `entitlement_features` table populated and feature keys in use match launch seed in §27.2; (f) LISTEN loop demonstrated running on every API instance; (g) NOTIFY emission verified in staging webhook tests. **Blocking conditions:** any non-zero disagreement in comparison-read window (indicates backfill incorrectness); any remaining direct `entitlements` or `accounts` table read outside `EntitlementService`; any call site still using `isEntitlementActive` or `resolveLinkedPairPremiumAccessForGuardian` directly; absence of feature config in `entitlement_features` for a feature being gated; LISTEN loop not confirmed running on all instances. **Completion proof:** (a) 7-day production window with `EntitlementService` as sole entitlement path and zero fallback-reads to legacy helpers; (b) `accounts` and `account_members` tables have zero live read traffic (verified via query logging); (c) CI check on direct-read prohibition passing; (d) `entitlements.account_id` column retired; (e) feature access decisions measurable via `EntitlementService` metrics (`entitlement_check_latency_ms`, `entitlement_cache_hit_rate`). Detailed runbook in Doc 01.2.

---

# **Part VI — Guardian Trust & Consent**

## **§35 Guardian-student linkage**

Guardians are linked to one or more students via `guardian_links`:

CREATE TABLE guardian\_links (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  guardian\_profile\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,  
  student\_profile\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  status TEXT NOT NULL CHECK (status IN ('active', 'pending\_student\_accept', 'pending\_guardian\_accept', 'revoked')),

  \-- Initiation  
  initiated\_by TEXT NOT NULL CHECK (initiated\_by IN ('guardian', 'student', 'admin')),  
  initiated\_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  \-- Acceptance  
  accepted\_at TIMESTAMPTZ,  
  accepted\_by\_profile\_id UUID REFERENCES profiles(id),

  \-- Revocation  
  revoked\_at TIMESTAMPTZ,  
  revoked\_by\_profile\_id UUID REFERENCES profiles(id),  
  revocation\_reason TEXT,

  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT unique\_active\_link UNIQUE NULLS NOT DISTINCT  
    (guardian\_profile\_id, student\_profile\_id, status)  
    DEFERRABLE INITIALLY DEFERRED,

  CHECK (guardian\_profile\_id \!= student\_profile\_id)  
);

CREATE INDEX idx\_guardian\_links\_guardian ON guardian\_links (guardian\_profile\_id) WHERE status \= 'active';  
CREATE INDEX idx\_guardian\_links\_student ON guardian\_links (student\_profile\_id) WHERE status \= 'active';

Additional audit table `guardian_link_audit` captures every status change for traceability.

## **§36 Guardian linking flow**

### **36.1 Initiation**

Two initiation paths:

**Guardian-initiated:**

1. Guardian enters student's email on their dashboard  
2. Guardian linking request created with `status = 'pending_student_accept'`  
3. Student receives email with acceptance link  
4. Student clicks → lands on acceptance page after authenticating  
5. Student confirms → `status = 'active'`, `accepted_at` set  
6. Both parties notified

**Student-initiated:**

1. Student enters guardian's email on their profile  
2. If student is under-13, this path is the **required** path before any feature access (COPPA flow §37)  
3. Linking request created with `status = 'pending_guardian_accept'`  
4. Guardian receives email; creates guardian account if new, or logs in  
5. Guardian confirms → `status = 'active'`

### **36.2 Rate limiting and abuse controls**

Guardian linking is rate-limited via Doc 01A `RateLimitLedger`:

* Per-guardian: max 10 link attempts per day (bucket `guardian_link_attempts:{guardian_id}:{day}`)  
* Per-student-email: max 3 link attempts per day (prevents spam linking to an email)

Linking is also rate-limited via `guardian_link_audit` table (existing pattern per audit — `server/lib/durable-rate-limiter.ts`).

### **36.3 Revocation**

Either party can revoke an active link:

* Guardian dashboard → "Remove student" → confirmation → `status = 'revoked'`  
* Student profile → "Remove guardian" → confirmation → `status = 'revoked'`  
* Admin can revoke via support escalation

Revocation is immediate. Guardian loses access to student's data. If student was premium via guardian-paid subscription, see §36.4.

### **36.4 Unlinking and billing implications**

If a guardian was paying for a linked student's subscription:

* Unlinking does not automatically cancel the subscription  
* Guardian is prompted at unlinking: "You are still paying for this student's subscription. Keep or cancel?"  
* If kept: subscription continues, student retains premium, but guardian loses visibility  
* If canceled: subscription canceled via Stripe; transition per §21

### **36.5 Cache invalidation on link status changes**

Every `guardian_links` status change emits NOTIFY to `entitlement_invalidate` for:

* The guardian (their derivation may change)  
* The student (their linked-guardian list changes, though not their entitlement directly)

## **§37 Under-13 consent and COPPA compliance**

### **37.1 Under-13 gating**

On signup, if user declares DOB making them under 13:

1. Account cannot proceed to any feature until guardian consent is obtained  
2. `profiles.is_under_13 = true` (generated column)  
3. Signup flow prompts for `guardian_email`  
4. Consent request sent to guardian email (`guardian_consent_requests` table)

### **37.2 Consent request flow**

CREATE TABLE guardian\_consent\_requests (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  student\_profile\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,  
  guardian\_email TEXT NOT NULL,  
  guardian\_profile\_id UUID REFERENCES profiles(id),  \-- populated once guardian creates account

  status TEXT NOT NULL CHECK (status IN ('pending', 'consented', 'denied', 'expired')),

  consent\_token TEXT NOT NULL UNIQUE,  
  consent\_token\_expires\_at TIMESTAMPTZ NOT NULL,

  consented\_at TIMESTAMPTZ,  
  denied\_at TIMESTAMPTZ,

  created\_at TIMESTAMPTZ NOT NULL DEFAULT now()  
);

1. Consent request created; email sent with unique token  
2. Token TTL: `consent_runtime_config.consent_request_ttl_days` (default 7 days)  
3. Guardian clicks link → lands on consent page (no auth required; token is the auth)  
4. Guardian must create or sign into a guardian account  
5. Guardian reviews student's info and provides explicit consent  
6. On consent: `profiles.guardian_consent = true`, `profiles.consent_given_at = now()`; `guardian_links` row created with `status = 'active'`  
7. Student receives notification that they can now access features  
8. Consent token is invalidated after use

### **37.3 Resend cooldown**

If consent email is lost or expired:

* Student can request resend from their profile  
* Cooldown: `consent_runtime_config.consent_request_resend_cooldown_minutes` (default 60\)  
* Max resends: `consent_runtime_config.consent_request_max_resends_per_day` (default 3\)

### **37.4 Consent expiration without action**

If consent request expires without guardian action:

* Account remains locked (no feature access)  
* After `consent_runtime_config.consent_expiration_deletion_days` (default 30 days total from signup):  
  * Student account is auto-deleted via soft-delete flow (Part VII)  
  * No data retained beyond audit trail of account creation and deletion

### **37.5 Consent revocation**

A guardian can revoke consent at any time. Revocation:

* Immediately blocks all feature access for the student  
* Prompts the guardian to confirm: "Revoking consent will delete this student's account after 7 days. Proceed?"  
* If confirmed: triggers soft-delete flow

## **§38 Guardian visibility model**

### **38.1 Aggregate-only access**

Guardians see aggregate/summary data for linked students, not raw data:

* Overall mastery score (yes)  
* Skill-level mastery (yes)  
* Activity trends (yes)  
* Individual question content (no)  
* Individual question responses (no)  
* Tutor conversation content (no)  
* Detailed session data (no)

### **38.2 Tutor data exclusion**

Per Doc 03 Main INV-03-05 and Doc 03A V2 §16: guardians have zero access to tutor conversations, messages, memory summaries, or any tutor-originated data. This is architecturally enforced at the tutor table layer; V8 reinforces at the authorization layer.

### **38.3 Guardian dashboard implementation**

Guardian dashboard is a read-only view derived from:

* `profiles` (linked student names, ages)  
* `student_skill_mastery` (aggregate mastery per domain/skill — per Doc 02C V4)  
* `practice_sessions`, `review_sessions` (counts, not contents)  
* `full_length_exams` (completed exam summaries)  
* `entitlements` (current tier, renewal date)

No tutor tables, no question-level data, no raw responses.

## **§39 Guardian deviation box**

**Current-state deviation:** Audit confirmed `guardian_links`, `guardian_link_audit`, `guardian_consent_requests`, and `profiles.guardian_profile_id` exist. Consent flow implemented. Current state aligns with target for most of Part VI. **Target-state:** §35-§38 spec. **Migration path:** (1) Verify NOTIFY emission on `guardian_links` status changes. (2) Confirm rate limits on linking match config. (3) Verify consent resend cooldown and max-per-day enforcement. (4) Audit that guardian dashboard does not inadvertently query tutor tables.

---

# **Part VII — Account Deletion**

## **§40 Account deletion lifecycle**

Account deletion follows a 7-day soft-delete → hard-delete pattern.

### **40.1 Deletion request**

User requests deletion via profile settings:

1. Confirmation dialog explaining consequences (subscription cancellation, data loss)  
2. Biometric re-auth (mobile) or password re-entry (web) per §8.4  
3. User confirms → `profile-service.ts` executes the deletion request flow

### **40.2 Deletion request flow**

async requestDeletion(profileId: string, actorId: string) {  
  await db.transaction(async (tx) \=\> {  
    // 1\. Soft-delete profile  
    await tx.from('profiles')  
      .update({ deleted\_at: now() })  
      .eq('id', profileId);

    // 2\. Create deletion request record  
    await tx.from('account\_deletion\_requests')  
      .insert({  
        profile\_id: profileId,  
        requested\_at: now(),  
        scheduled\_hard\_delete\_at: now() \+ interval '7 days',  
        actor\_profile\_id: actorId,  
        status: 'pending'  
      });

    // 3\. Cancel Stripe subscription immediately  
    await stripe.subscriptions.del(subscriptionId, { prorate: false });

    // 4\. Invalidate sessions  
    await supabase.auth.admin.signOutUser(profileId);

    // 5\. Emit audit event  
    await auditLog.emit({ action: 'profile\_soft\_deleted', target: profileId, actor: actorId });

    // 6\. Invalidate entitlement cache  
    await entitlementService.invalidate(profileId);  
  });

  // Send confirmation email with recovery link valid for 7 days  
  await email.sendDeletionScheduledEmail(profileId);  
}

### **40.2.1 Partial failure semantics (Stripe API failure mid-deletion)**

The §40.2 pseudocode wraps multiple operations in a single transaction. In practice, Stripe cancellation is an **external API call**, which should not sit inside a DB transaction. V7.1 revises the flow to split DB state from external side effects.

**Ordering rule — DB first, external second:**

async requestDeletion(profileId: string, actorId: string) {  
  // Phase 1: DB transaction (atomic, fast, milliseconds)  
  await db.transaction(async (tx) \=\> {  
    await tx.from('profiles')  
      .update({ deleted\_at: now() })  
      .eq('id', profileId);

    await tx.from('account\_deletion\_requests').insert({  
      profile\_id: profileId,  
      requested\_at: now(),  
      scheduled\_hard\_delete\_at: now() \+ interval '7 days',  
      actor\_profile\_id: actorId,  
      status: 'pending',  
      stripe\_cancellation\_status: 'pending'  
    });

    await auditLog.emit({ action: 'profile\_soft\_deleted', target: profileId, actor: actorId });  
  });

  // Phase 2: Stripe cancellation (post-commit, retryable)  
  try {  
    await stripe.subscriptions.cancel(subscriptionId, { prorate: false });  
    await db.from('account\_deletion\_requests')  
      .update({ stripe\_cancellation\_status: 'completed' })  
      .eq('profile\_id', profileId);  
  } catch (err) {  
    logger.warn('stripe\_cancellation\_failed\_queued\_retry', { profileId, err });  
    await stripeCancellationQueue.enqueue({ profileId, subscriptionId, attempt: 1 });  
  }

  // Phase 3: Session and cache invalidation (post-commit, best-effort)  
  try {  
    await supabase.auth.admin.signOutUser(profileId);  
  } catch (err) {  
    logger.warn('session\_invalidation\_failed', { profileId, err });  
  }  
  await entitlementService.invalidate(profileId);

  // Phase 4: Confirmation email  
  await email.sendDeletionScheduledEmail(profileId);  
}

**Why DB first, external second:**

* User-visible deletion effect (cannot log in, cannot access features) depends on DB state, not Stripe state  
* DB transaction is milliseconds; external calls are seconds  
* Stripe failure does not mean deletion failed — user expects account deactivated immediately  
* Background retry is acceptable (grace period provides reconciliation window)

**Stripe cancellation retry:**

* `stripeCancellationQueue` is a Postgres-backed durable queue (no external queue at V1 per Doc 01A caching/topology constraints)  
* Retry schedule: 1min → 5min → 30min → 2h → 12h → 24h (exponential with jitter)  
* After 24h without success: alert ops for manual intervention  
* Stripe cancellation is idempotent — re-running after partial success is safe  
* `account_deletion_requests.stripe_cancellation_status`: `pending` | `in_progress` | `completed` | `failed_manual` | `cancelled_by_recovery`

**Recovery edge cases:**

Per §40.4, user can recover their account within the 7-day grace window.

* **Recovery before Stripe cancellation retried:** recovery flow cancels the pending queue job; subscription never actually canceled; user retains Premium; `stripe_cancellation_status = 'cancelled_by_recovery'`  
* **Recovery after Stripe cancellation completed:** subscription already canceled; recovery restores profile but NOT subscription; user prompted to re-subscribe via Stripe Checkout  
* **Recovery during active Stripe cancellation attempt:** race handled by advisory lock on `account_deletion_requests.profile_id`; recovery waits for in-flight cancellation to complete or fail, then proceeds per the resulting state

**Observability:**

* `deletion_stripe_cancellation_latency_ms` metric  
* `deletion_stripe_cancellation_failure_rate` metric  
* Alert: sustained failure rate \> 5% of deletions over 30 minutes

### **40.3 Soft-delete state behavior**

During 7-day grace period:

* Profile is marked `deleted_at`; all queries excluding soft-deleted rows honor this  
* User cannot log in (auth middleware checks `deleted_at` and rejects)  
* User can restore account via recovery email link  
* **Subscription handling follows the deletion lifecycle's grace model.** At deletion request, no Stripe operation occurs; the subscription and the student's paid entitlement remain active throughout the 7-day grace period (the user paid for the period and retains access during reconsideration). At T+7 execution, the deletion driver pauses Stripe billing (pause_collection with behavior 'void', voiding upcoming invoices) and the cascade removes the entitlement. A deletion cancelled during grace leaves the subscription uninterrupted. Entitlement is removed at T+7, not at deletion request.  
* `account_deletion_requests.stripe_cancellation_status` reflects the current Stripe-side reconciliation state (`pending` | `in_progress` | `completed` | `failed_manual` | `cancelled_by_recovery` per §40.2.1)  
* Data remains in DB (no hard deletion yet)

### **40.4 Recovery during grace period**

User clicks recovery link in email:

1. Authenticates with prior credentials (MFA if enrolled)  
2. Recovery confirmation: "Restore your account?"  
3. On confirm:  
   * `profiles.deleted_at` cleared  
   * `account_deletion_requests.status = 'cancelled'`  
   * `profile_restored` audit event  
   * User can resume; subscription must be re-established manually (Stripe Checkout)  
   * Entitlement cache invalidated

### **40.5 Hard delete at T+7**

Daily cron job runs `scheduled_deletion_job_cron` (default `daily_at_02_utc`):

1. Select all `account_deletion_requests` where `scheduled_hard_delete_at <= now()` and `status = 'pending'`  
2. For each: execute `deidentify_user(profile_id)` RPC  
3. RPC performs:  
   * `UPDATE profiles SET email = 'deleted_<id>@anonymized.lyceon', full_name = NULL, display_name = 'Deleted User', stripe_customer_id = NULL, guardian_email = NULL, date_of_birth = NULL`  
   * Hard-delete rows from feature-level tables where retention is not required (tutor conversations, messages per Doc 03A V2 retention)  
   * Retain anonymized data for analytics per `account_deletion_runtime_config.anonymization_retention_days` (default 365\)  
   * Cascade delete audit logs after anonymization retention window  
4. `account_deletion_requests.status = 'completed'`

### **40.6 Under-13 accelerated deletion**

For under-13 accounts whose guardian revokes consent (§37.5) or whose consent expires (§37.4):

* Same soft-delete → hard-delete flow, but without the 7-day grace period option for restoration  
* Account is marked for immediate deletion; hard-delete runs on next nightly cron

### **40.7 Guardian visibility during deletion**

If a guardian is linked to a deleting student:

* Guardian dashboard shows "Pending deletion — resolves on {date}" indicator per `account_deletion_runtime_config.guardian_pending_deletion_visibility` (default true)  
* Guardian can see the deletion date  
* Guardian cannot prevent the deletion (student or admin-initiated)  
* Guardian can choose to continue paying for student up to deletion (rare; usually subscription canceled at deletion request)

## **§41 Account deletion deviation box**

**Current-state deviation:** Audit did not specifically confirm the deletion flow; V6 specifies this lifecycle. `account_deletion_requests` table exists per V6 naming doctrine. `deidentify_user` RPC referenced. **Target-state:** §40 spec. **Migration path:** (1) Verify `account_deletion_requests` and `deidentify_user` exist. (2) Verify 7-day grace period is honored by daily cron. (3) Ensure `entitlementService.invalidate` is called on soft-delete. (4) Add biometric re-auth gate on mobile. (5) Verify guardian notification of pending deletion is implemented.

---

# **Part VIII — Cross-Document Integration**

## **§42 Interfaces provided by V8**

V8 provides these canonical interfaces consumed by other docs:

| V8 Interface | Consumed by | Usage |
| ----- | ----- | ----- |
| `EntitlementService.canAccessFeature` | All feature docs | Pre-action entitlement gate |
| `EntitlementService.getEntitlementSnapshot` | Guardian dashboard, billing UI | Render entitlement state |
| `EntitlementService.invalidate` | Stripe webhook handler, `profile-service.ts` | Cache invalidation on state change |
| `supabaseAuthMiddleware` | All API routes | Authentication gate |
| `requireStudentOrAdmin`, `requireGuardian`, etc. | All API routes | Role enforcement |
| `profile-service.ts` | All profile mutation paths | Canonical profile writer |
| Guardian linking and consent flows | Doc 05 (Growth), Doc 04 (Calendar) | Under-13 gates, family plan handling (future) |
| Soft-delete status check | All feature docs | Honor `deleted_at` on profile reads |
| `auditLog.emit` | All identity-relevant mutations | Audit trail |

## **§42A Schema-driven interface contracts (OpenAPI/Zod mandate)**

Per Doc 03B V2 §22.11 pattern applied repo-wide: every interface V8 provides to consuming docs is defined as a Zod schema in `packages/shared/schemas/` and generates OpenAPI spec automatically.

**Requirement:**

Every interface listed in §42 has a corresponding Zod schema:

* `EntitlementService.canAccessFeature` → `canAccessFeatureRequestSchema`, `featureAccessResultSchema`  
* `EntitlementService.getEntitlementSnapshot` → `entitlementSnapshotSchema`  
* `profile-service.ts` methods → request/response schemas per method  
* Authentication middleware response shapes → `authErrorResponseSchema`, `authSuccessContextSchema`  
* Role enforcement helper error responses → `roleErrorResponseSchema`  
* Stripe webhook payload validators → per-event schemas (even though Stripe owns the shape, we validate on receipt)

**These Zod schemas:**

1. **Validate at boundary** — runtime validation when data enters or exits the service  
2. **Serve as TypeScript type source** — `type FeatureAccessResult = z.infer<typeof featureAccessResultSchema>`  
3. **Generate OpenAPI spec** — via `@asteasolutions/zod-to-openapi` or equivalent  
4. **Drive SDK generation** — TypeScript client types generated from OpenAPI; iOS/Android SDKs generated from OpenAPI for mobile  
5. **Drive test fixtures** — property-based test fixtures generated from schemas

**CI enforcement:**

* Every new interface method requires a Zod schema before merge  
* OpenAPI spec regenerated and committed on every schema change  
* Type drift between schema and implementation blocks merge  
* Mobile SDK type definitions regenerated on OpenAPI change

**V1 launch requirement:**

Every interface in §42 has corresponding Zod schema. Missing schemas block launch. CI verification is mandatory.

**What this prevents:**

* Interface drift between V8 spec and implementation  
* Mobile SDK diverging from server contract  
* Hand-written types going stale as interfaces evolve  
* Undocumented API surface (every schema is automatically documented via OpenAPI)

## **§43 Consumption of Doc 01A primitives**

V8 itself consumes Doc 01A primitives:

| Doc 01A Primitive | V8 Consumer | Usage |
| ----- | ----- | ----- |
| `IdempotencyService` | Stripe webhook handler (§22.2) | Deduplicate webhook events |
| `RateLimitLedger` | Login, password reset, magic link, guardian linking | Brute force and abuse prevention |
| `AbuseScoreService` | `EntitlementService.canAccessFeature` (§27.3 step 7\) | Trust-weighted access gating |
| LISTEN/NOTIFY pattern | `EntitlementService.invalidate` (§29) | Cache invalidation across instances |
| Observability logger | All V8 modules | Structured logging |
| Internal service auth (HMAC) | `profile-service.ts` called by internal jobs | Service-to-service integrity |
| Config doctrine | `auth_runtime_config`, `entitlement_runtime_config`, etc. | Runtime constants from DB |

## **§44 Support-mediated operations**

**Launch staffing reality:** At launch, the "support / admin / trust & safety" functions described below are performed by the founder and a small admin team. As volume scales post-launch, these functions will be formalized into distinct support, trust & safety, and operations roles with appropriate training, tooling, and on-call rotations. The flows below are designed to work for both staffing models — the required discipline (verification protocols, audit trails, access controls) does not change, only the number of people executing.

### **44.1 Scope**

Operations requiring support/admin intervention:

* Account recovery when email access lost  
* MFA reset when all recovery codes exhausted  
* Role switch requests (student ↔ tutor ↔ teacher)  
* Manual entitlement adjustment (e.g., refund period extension)  
* Guardian link forced revocation (dispute)  
* Account deletion force-through (e.g., legal demand)  
* Under-13 consent verification escalation

### **44.2 Support escalation flow**

1. User contacts support (chat, email, or in-app form)  
2. Support agent verifies identity per defined verification protocol:  
   * Billing method confirmation  
   * Security questions  
   * Guardian confirmation for minors  
   * Document verification for high-risk actions (account takeover claim, role switch to tutor/teacher)  
3. Agent uses admin panel to execute the action  
4. Every action emits audit event with `actor_profile_id = admin_id`, `on_behalf_of_profile_id = user_id`, `ticket_id`, `justification`  
5. User receives confirmation email describing what was changed

### **44.3 Admin panel access controls**

* Admin panel access requires admin role (§17)  
* Admin panel requires MFA (§10 — admin is MFA-required role)  
* Every admin panel action logged  
* Sensitive actions (entitlement override, data deletion, role change) require secondary admin approval (four-eyes principle — target state; launch is single-admin with strong audit)

### **44.4 Support-mediated role switch**

Per §17A, role switches are support-mediated:

1. User requests role switch via profile/settings → pre-drafted email to support  
2. Support verifies eligibility (background check for tutor/teacher roles, guardian verification)  
3. Support executes role change via admin panel  
4. Audit event emitted; user notified

### **44.5 Support-mediated account recovery**

When user has lost email access:

1. Support verifies identity (billing method, security questions, government ID for high-value accounts)  
2. Support updates email address via `profile-service.ts`  
3. New email triggers password reset flow  
4. User regains access  
5. All sessions previously active are invalidated

---

# **Part IX — Acceptance Criteria**

## **§45 V8 Launch Criteria**

Launch-blocking items (must ship):

**Identity:**

* \[ \] `profiles` schema migrated to target state (§4)  
* \[ \] `profile-service.ts` is single canonical writer; all other writers migrated or removed  
* \[ \] CI check rejects direct `profiles` writes outside `profile-service.ts`

**Authentication:**

* \[ \] `supabaseAuthMiddleware` rejects Bearer tokens (audit-confirmed; verify CI check exists)  
* \[ \] JWT signature, audience, issuer, expiry all validated  
* \[ \] MFA required for admin, tutor, teacher roles at launch  
* \[ \] MFA grace period (14 days / before billing) enforced for students and guardians  
* \[ \] Password reset flow with custom SMTP at launch  
* \[ \] Failed login lockout via `RateLimitLedger`  
* \[ \] Mobile auth spec implemented when mobile ships (§8 full scope)

**Authorization:**

* \[ \] All user-scoped queries use `scopedFrom` helper (application-layer filtering)  
* \[ \] CI check rejects direct `from('<user-scoped-table>')` calls outside helpers  
* \[ \] RLS reinstatement plan documented with pooler migration path  
* \[ \] All role enforcement helpers present and applied to every non-public route

**Billing:**

* \[ \] Stripe webhook handling via `IdempotencyService`  
* \[ \] `entitlements` migrated to `profile_id` FK (from `account_id`)  
* \[ \] `accounts` and `account_members` tables retired  
* \[ \] Stripe Tax enabled for Tier 1 countries  
* \[ \] NOTIFY emitted on entitlement writes

**EntitlementService:**

* \[ \] `packages/shared/services/entitlement-service.ts` implemented per §32  
* \[ \] LISTEN loop running on every API instance  
* \[ \] `entitlement_features` table populated with launch seed  
* \[ \] All feature docs' call sites migrated to `EntitlementService.canAccessFeature`  
* \[ \] `resolveLinkedPairPremiumAccessForGuardian` wrapped in `EntitlementService.resolveGuardianEntitlement`  
* \[ \] Cache TTL, hard staleness bounds, tier 1 countries configured in `entitlement_runtime_config`

**Guardian:**

* \[ \] `guardian_links`, `guardian_link_audit`, `guardian_consent_requests` schemas verified  
* \[ \] Under-13 consent flow enforced (account locked until guardian consent)  
* \[ \] NOTIFY emission on `guardian_links` status changes  
* \[ \] Guardian dashboard excludes tutor data

**Deletion:**

* \[ \] Soft-delete 7-day grace period enforced  
* \[ \] Daily hard-delete cron running  
* \[ \] Recovery email link during grace period  
* \[ \] Stripe subscription canceled on deletion request  
* \[ \] `entitlementService.invalidate` called on soft-delete

**Observability:**

* \[ \] All identity events emit to `audit_logs`  
* \[ \] Structured logging per Doc 01A §53-§64  
* \[ \] Alerts configured per Doc 01A for auth failure spikes, webhook processing failures, cache invalidation failures

## **§45A Performance Budgets (SLO/SLI)**

V8 operations have performance budgets. Values live in `observability_runtime_config` per Doc 01A.

**Launch budgets — subject to proof during prelaunch load validation.** The values in the tables below are **launch targets**, not measured current-state numbers. They were set based on architectural assumptions (Neon latency profile, Supabase client overhead, in-process cache hit patterns, cross-region DB topology, cold-cache rebuild cost). Before V1 launch, load testing must verify that these targets are achievable at expected peak load; targets may be revised up or down after validation. Post-launch, the values transition from "targets" to "committed SLOs" and drive alerting and capacity planning per Doc 01A §62. Any target missed in load validation is a launch-blocking issue requiring architecture review or target adjustment, documented via change record.

### **Surface latency budgets**

| Surface | P50 | P95 | P99 | Source |
| ----- | ----- | ----- | ----- | ----- |
| `supabaseAuthMiddleware` JWT validation | \<10ms | \<30ms | \<80ms | Per-request overhead |
| `EntitlementService.canAccessFeature` (cache hit) | \<3ms | \<10ms | \<25ms | Map lookup \+ evaluation |
| `EntitlementService.canAccessFeature` (cache miss) | \<40ms | \<80ms | \<150ms | DB read \+ cache write |
| `EntitlementService.getEntitlementSnapshot` (cache hit) | \<2ms | \<8ms | \<20ms | Snapshot return |
| `EntitlementService.getEntitlementSnapshot` (cache miss) | \<35ms | \<70ms | \<130ms | DB read |
| `EntitlementService.invalidate` | \<15ms | \<40ms | \<90ms | DEL \+ NOTIFY emit |
| Guardian derivation (3 linked students, cached) | \<8ms | \<25ms | \<60ms | 3x cache hits \+ aggregate |
| Guardian derivation (3 linked students, cold cache) | \<60ms | \<120ms | \<220ms | 3 parallel DB reads |
| `profile-service.ts` write (single field) | \<30ms | \<80ms | \<180ms | Transaction \+ audit \+ NOTIFY |
| Stripe webhook processing (per event) | \<500ms | \<1500ms | \<3000ms | Verification \+ DB write \+ NOTIFY |
| Login flow (password) | \<150ms | \<400ms | \<800ms | Supabase \+ profile load \+ MFA check |
| Login flow (MFA challenge) | \<200ms | \<500ms | \<1000ms | Challenge issue \+ verify |
| Account deletion Phase 1 (DB transaction) | \<50ms | \<150ms | \<300ms | Soft-delete \+ audit \+ NOTIFY |
| Account deletion Phase 2 (Stripe cancel) | \<800ms | \<2000ms | \<5000ms | External API call |

### **Availability budgets**

| Service | Monthly uptime target | Error budget |
| ----- | ----- | ----- |
| `supabaseAuthMiddleware` | 99.9% | 43.2 minutes |
| `EntitlementService` | 99.9% | 43.2 minutes |
| `profile-service.ts` | 99.5% | 3.6 hours |
| Stripe webhook processing | 99.5% | 3.6 hours |

Auth and entitlement are in the critical path for every authenticated request; their budgets are tighter.

### **Throughput targets (V1 launch)**

| Operation | Sustained rate | Peak rate |
| ----- | ----- | ----- |
| Authenticated requests | 50 req/s | 200 req/s |
| Login attempts | 5 req/s | 30 req/s |
| Stripe webhooks | 10 req/s | 50 req/s |
| Account deletions | 0.1 req/s | 2 req/s |

Peak rates sustainable for 5-minute bursts without degradation.

### **Cold start budgets**

| Scenario | Target |
| ----- | ----- |
| API instance startup (config load \+ LISTEN connect) | \<3 seconds |
| First `EntitlementService` call after restart | \<200ms (cold cache) |
| LISTEN reconnect after dropped connection | \<5 seconds |

### **Alert thresholds**

* `supabaseAuthMiddleware` P95 \>50ms sustained 10 min → page  
* `EntitlementService` cache hit rate \<85% sustained 15 min → warn  
* Stripe webhook processing P95 \>3s sustained 10 min → page  
* `entitlement_db_unavailable_stale_fallback` rate \>1% of requests over 5 min → page  
* `auth_role_mismatch` rate \>10/min per-user → warn (potential compromise signal)  
* Account deletion Stripe cancellation failure rate \>5% over 30 min → page

### **Monitoring location**

All metrics emitted per Doc 01A §53-§64 observability conventions with correlation via `request_id`. Dashboards and alert routing defined in Doc 01.3 Engineer Runbooks (companion artifact).

---

# **Part X — Governance**

## **§46 Review triggers**

V8 must be reviewed when:

* Doc 00 platform invariants change  
* Doc 01A platform primitives interfaces change  
* Stripe billing model changes (new tiers, new countries)  
* Authentication provider changes (Supabase → alternative)  
* Neon connection pooling resolution enables RLS reinstatement  
* Mobile app shipping (§8 implementation verification)  
* Breaking schema migration affecting `profiles`, `entitlements`, `guardian_links`, or related tables  
* New role added to `profile_role` enum  
* Country allow-list changes (Tier 1 expansion)  
* COPPA or equivalent regulatory changes

## **§47 Lock semantics**

"Locked" means:

* V8 is authoritative for implementation  
* Changes require explicit version update with change record  
* Silent drift in code or DB is not allowed  
* Feature docs reference V8 interfaces; changes to V8 trigger feature doc review

Post-lock, additive clarification is allowed. Behavior-changing changes require explicit review and version bump.

## **§48 Migration rule**

If live DB or repo contracts differ from V8:

1. Log the discrepancy with audit finding  
2. Determine canonical truth (spec or production)  
3. Update whichever is wrong  
4. Document reconciliation in change records

V8 must not silently drift from deployed reality. Current-state deviation boxes document known gaps; new discoveries require updating the deviation box or closing the gap.

---

# **Part XI — Change Records**

Change records continue from V6's last CR per decision Q6 (b).

**CR-01-27** — V8 established as canonical. Supersedes V6. Authentication spec corrected per 2026-04-23 repo audit (cookie-only, Bearer rejected). Authorization model corrected — Layer 1 is application-layer filtering at launch; RLS target-state pending Neon pooling resolution. New canonical `EntitlementService` module defined (§25-§33) with feature-check interface, LISTEN/NOTIFY invalidation, 60s cache TTL, guardian derivation as first-class case.

**CR-01-28** — Full mobile authentication spec added in §8. Keychain/Keystore storage canonical. Biometric re-auth for sensitive actions. Web ↔ mobile sessions independent (no continuity at launch; QR pairing is V2 target). Offline fail-closed for entitlement. Device fingerprinting feeds `AbuseScoreService`.

**CR-01-29** — Platform primitives extracted to Doc 01A V1. V8 no longer defines RateLimitLedger, IdempotencyService, AbuseScoreService, internal service auth, observability conventions, config doctrine, or caching strategy pattern. V8 consumes these from 01A. Reduces V8 scope to identity-native concerns.

**CR-01-30** — `entitlement_features` table added (§27.1). Feature-to-entitlement mapping is declarative DB-backed, not hardcoded. Adding or modifying a feature gate is a DB row change.

**CR-01-31** — Feature access evaluation order locked (§27.3). First-failure-wins deterministic precedence: feature\_disabled → account\_soft\_deleted → under\_age → region\_blocked → not\_paid/expired → live\_exam\_in\_progress → abuse\_score\_lockout. All denial reasons enumerated in `AccessDenialReason` type.

**CR-01-32** — Canonical query helper `scopedFrom` mandated (§14 Layer 1). All user-scoped queries must use the helper; CI enforces. Provides audit-traceable application-layer filtering that remains in place as defense-in-depth even after RLS reinstatement.

**CR-01-33** — Target-dominant doctrine adopted (§0.5). Replaces V6's per-section dual-lens prose. Current-state deviations concentrated in deviation boxes where material.

**CR-01-34** — All V8 constants live in `*_runtime_config` tables per Doc 01A §65-§74 config doctrine. No magic numbers in V8-scope code. Consolidated configuration tables listed in Appendix A.

**CR-01-35** — Guardian derivation formalized (§31). `resolveLinkedPairPremiumAccessForGuardian` existing helper in `server/lib/account.ts` wrapped in `EntitlementService.resolveGuardianEntitlement`. Guardian tier follows any linked student's active premium; unlinking the premium student reverts guardian to free.

**CR-01-36** — Biometric re-auth gate added to sensitive mobile actions (§8.4). FaceID/TouchID/Android fingerprint required before: account deletion, billing changes, MFA changes, password change, email change, role switching, guardian linking. Fallback to password re-entry if biometric unavailable.

**CR-01-37** — Certificate pinning required for mobile API calls (§8.8). Primary \+ backup pin; refresh every 6 months. Pinning failure blocks request with "update app" messaging.

**CR-01-38** — Web ↔ mobile sessions independent at launch (§8.6). Intentional security separation. QR-code seamless pairing is V2 target, not V1.

**CR-01-39** (V8) — Privileged role elevation requires session invalidation (§17A.1). When `profiles.role` transitions into admin/tutor/teacher (or between privileged roles, or out of privileged roles), all active sessions for the profile are invalidated via `supabase.auth.admin.signOutUser`. Forces re-authentication which re-challenges MFA per §10. Prevents stale lower-privilege JWT from silently gaining elevated capability when `profiles.role` is upgraded per the §18.1 "profile wins" rule. Alternative approach (fresh-MFA step-up without invalidation) rejected for simplicity — session invalidation forces the login flow which naturally re-challenges MFA, same effective security with simpler implementation.

**CR-01-40** (V8) — §40.3 deletion wording corrected. V7.1 §40.3 stated "Subscription is already canceled" which contradicted V7.1 §40.2.1 partial-failure semantics (where Stripe cancellation may be pending retry). V8 §40.3 now reads "Stripe subscription cancellation is initiated immediately" with explicit acknowledgment of retry state via `stripe_cancellation_status`. Resolves internal contradiction flagged by external reviewer.

**CR-01-41** (V8) — Appendix E ownership class labeling added. Three classes distinguished with explicit definitions and per-class CI enforcement rules: single-writer (strictly one module), shared append-only (multiple services insert, UPDATE/DELETE prohibited), admin-mutable (configuration owned by ops tooling, readable by runtime services). Previously-conflated governance patterns (e.g., `audit_logs` labeled "every identity-service module" in V7.1) now explicit about append-only semantics.

**CR-01-42** (V8) — Companion artifacts marked by launch-blocking urgency. Doc 01.1 Identity Test Matrix is launch-blocking. Doc 01.2 Migration Runbooks are blocking per-migration but not globally before launch. Doc 01.3 Engineer Runbooks are strongly recommended but not launch-blocking.

**CR-01-43** (V8) — Four critical deviation boxes tightened with cutover criteria / blocking conditions / completion proof structure (§3 profile writer consolidation, §14.3 RLS reinstatement, §24 Stripe queue operational ownership, §34 entitlement migration). Provides in-spec anchors for launch-critical migration decisions without duplicating full runbooks (which remain in Doc 01.2). Plus §8.6.1 independent sessions threat model added; §44 launch-reality support staffing note; §45A launch-target disclaimer.

---

# **Appendix A — Identity Constants Catalog**

All V8-scope constants live in DB-backed `*_runtime_config` tables per Doc 01A config doctrine (§65-§74). Tables consolidated below.

## **A.1 `auth_runtime_config`**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `failed_login_lockout_threshold` | 5 | 3 | 10 | Security | Failed login attempts before lockout |
| `lockout_duration_minutes` | 15 | 5 | 120 | Security | Lockout period after threshold hit |
| `session_ttl_hours` | 24 | 1 | 168 | Engineering | Supabase session TTL |
| `refresh_token_ttl_days` | 30 | 7 | 90 | Engineering | Refresh token TTL |
| `email_verification_ttl_hours` | 24 | 1 | 72 | Product | Verification link expiration |
| `password_reset_ttl_hours` | 1 | 0.5 | 24 | Security | Password reset link expiration |
| `magic_link_ttl_minutes` | 15 | 5 | 60 | Security | Magic link expiration |
| `mfa_enforcement_days_for_students` | 14 | 3 | 60 | Product | Grace before MFA required for students |
| `mfa_enforcement_days_for_guardians` | 14 | 3 | 60 | Product | Grace before MFA required for guardians |
| `biometric_action_window_seconds` | 60 | 30 | 300 | Security | Mobile biometric challenge validity window |
| `password_reset_rate_per_hour` | 3 | 1 | 10 | Security | Per-email password reset requests per hour |
| `magic_link_rate_per_hour` | 5 | 2 | 20 | Security | Per-email magic link requests per hour |

## **A.2 `auth_mfa_config`**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `mfa_required_roles` | `["admin","tutor","teacher"]` | — | — | Security | Roles requiring MFA at launch |
| `mfa_factor_types_allowed` | `["totp","webauthn"]` | — | — | Security | Supported MFA methods |
| `mfa_challenge_ttl_seconds` | 300 | 60 | 1800 | Security | MFA challenge window |
| `mfa_enrollment_required_before_billing` | `true` | — | — | Product | Gate billing actions on MFA enrollment |
| `mfa_recovery_codes_count` | 10 | 6 | 20 | Security | Recovery codes generated per enrollment |

## **A.3 `consent_runtime_config`**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `consent_request_ttl_days` | 7 | 3 | 30 | Product | Guardian consent request expiration |
| `consent_expiration_deletion_days` | 30 | 14 | 90 | Product | Auto-delete unconsented under-13 after |
| `consent_request_resend_cooldown_minutes` | 60 | 15 | 1440 | Engineering | Min time between consent email resends |
| `consent_request_max_resends_per_day` | 3 | 1 | 10 | Engineering | Max consent email sends per day |

## **A.4 `entitlement_runtime_config`**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `entitlement_cache_ttl_seconds` | 60 | 10 | 600 | Engineering | In-process cache TTL |
| `entitlement_hard_staleness_seconds` | 300 | 60 | 900 | Engineering | Max staleness during DB outage |
| `grace_period_days_past_due` | 7 | 0 | 30 | Product | Premium access during Stripe dunning |
| `trial_period_days` | 0 | 0 | 30 | Product | Trial period (none at launch) |
| `cancellation_at_period_end_default` | `true` | — | — | Product | Default cancellation timing |
| `tier_1_countries` | `["US","CA","UK","AU","NZ","IE","SG"]` | — | — | Product | Countries where LISA/premium is available |
| `min_age_years` | 13 | 13 | 18 | Legal | Minimum student age |

## **A.5 `account_deletion_runtime_config`**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `grace_period_days` | 7 | 1 | 30 | Product | Soft-delete grace before hard delete |
| `scheduled_deletion_job_cron` | `daily_at_02_utc` | — | — | Engineering | Schedule for T+7 deletion job |
| `anonymization_retention_days` | 365 | 30 | 3650 | Product | How long anonymized data retained |
| `guardian_pending_deletion_visibility` | `true` | — | — | Product | Show guardian the pending-deletion indicator |

## **A.6 `mobile_auth_config` (new in V8)**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `cert_pin_primary_sha256` | (env-specific) | — | — | Security | Primary certificate pin |
| `cert_pin_backup_sha256` | (env-specific) | — | — | Security | Backup certificate pin |
| `cert_pin_refresh_days` | 180 | 90 | 365 | Security | Certificate rotation cadence |
| `biometric_sensitive_actions` | `["account_deletion","billing_change","mfa_change","password_change","email_change","role_switch","guardian_link","guardian_unlink"]` | — | — | Security | Actions requiring biometric re-auth |
| `device_id_header_name` | `"X-Device-Id"` | — | — | Engineering | Header for device identifier |
| `clock_skew_tolerance_seconds` | 300 | 60 | 600 | Engineering | Max client-server clock skew |

---

# **Appendix B — Identity Schemas (Target-State Canonical)**

## **B.1 `profiles`**

See §4 for full schema.

## **B.2 `entitlements`**

CREATE TABLE entitlements (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  profile\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  tier TEXT NOT NULL CHECK (tier IN ('free', 'premium')),  
  status TEXT NOT NULL CHECK (status IN ('active', 'past\_due', 'canceled', 'unpaid', 'incomplete', 'incomplete\_expired', 'trialing')),

  \-- Stripe linkage  
  stripe\_subscription\_id TEXT UNIQUE,  
  stripe\_price\_id TEXT,

  \-- Period tracking  
  current\_period\_start TIMESTAMPTZ,  
  current\_period\_end TIMESTAMPTZ,  
  cancel\_at\_period\_end BOOLEAN DEFAULT FALSE,

  \-- Grace period  
  grace\_period\_ends\_at TIMESTAMPTZ,

  \-- Timestamps  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  updated\_at TIMESTAMPTZ NOT NULL DEFAULT now()  
);

CREATE INDEX idx\_entitlements\_profile ON entitlements (profile\_id);  
CREATE INDEX idx\_entitlements\_active ON entitlements (profile\_id)  
  WHERE status \= 'active' OR status \= 'past\_due';

## **B.3 `entitlement_features`**

See §27.1.

## **B.4 `guardian_links`**

See §35.

## **B.5 `guardian_consent_requests`**

See §37.2.

## **B.6 `account_deletion_requests`**

CREATE TABLE account\_deletion\_requests (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  profile\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,  
  requested\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  scheduled\_hard\_delete\_at TIMESTAMPTZ NOT NULL,  
  actor\_profile\_id UUID NOT NULL REFERENCES profiles(id),  
  status TEXT NOT NULL CHECK (status IN ('pending', 'cancelled', 'completed')),  
  completion\_at TIMESTAMPTZ,  
  deletion\_reason TEXT,  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now()  
);

CREATE INDEX idx\_account\_deletion\_pending  
  ON account\_deletion\_requests (scheduled\_hard\_delete\_at)  
  WHERE status \= 'pending';

## **B.7 `audit_logs`**

CREATE TABLE audit\_logs (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  actor\_profile\_id UUID REFERENCES profiles(id),  
  target\_profile\_id UUID REFERENCES profiles(id),  
  action TEXT NOT NULL,  
  changes JSONB,  
  context JSONB,  
  ip\_address INET,  
  user\_agent TEXT,  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now()  
);

CREATE INDEX idx\_audit\_logs\_target ON audit\_logs (target\_profile\_id, created\_at DESC);  
CREATE INDEX idx\_audit\_logs\_actor ON audit\_logs (actor\_profile\_id, created\_at DESC);  
CREATE INDEX idx\_audit\_logs\_action ON audit\_logs (action, created\_at DESC);

---

# **Appendix C — EntitlementService Reference Implementation**

Full pseudocode reference implementation of `packages/shared/services/entitlement-service.ts`. The §32 body showed the core structure; this appendix provides complete pseudocode including helper methods.

// packages/shared/services/entitlement-service.ts

import type { SupabaseClient } from '@supabase/supabase-js';  
import type { Pool as PgPool } from 'pg';  
import { config } from '../config/runtime-config';  
import { logger } from '../observability/logger';  
import { AbuseScoreService } from './abuse-score-service';

type CacheEntry \= {  
  snapshot: EntitlementSnapshot;  
  expiresAt: number;  
  hardStaleAt: number;  
};

const cache \= new Map\<string, CacheEntry\>();

export class EntitlementService {  
  constructor(  
    private supabase: SupabaseClient,  
    private abuseScoreService: AbuseScoreService  
  ) {}

  async canAccessFeature(  
    studentId: string,  
    featureKey: FeatureKey,  
    req: AuthenticatedRequest  
  ): Promise\<FeatureAccessResult\> {  
    const snapshot \= await this.getEntitlementSnapshot(studentId, req);  
    return this.evaluateFeatureAccess(snapshot, featureKey, req);  
  }

  async getEntitlementSnapshot(  
    studentId: string,  
    req: AuthenticatedRequest  
  ): Promise\<EntitlementSnapshot\> {  
    const cached \= cache.get(studentId);  
    const now \= Date.now();

    if (cached && cached.expiresAt \> now) {  
      return cached.snapshot;  
    }

    try {  
      const snapshot \= await this.loadFromDb(studentId, req);  
      cache.set(studentId, {  
        snapshot,  
        expiresAt: now \+ config.entitlement.cache\_ttl\_seconds \* 1000,  
        hardStaleAt: now \+ config.entitlement.hard\_staleness\_seconds \* 1000  
      });  
      return snapshot;  
    } catch (err) {  
      // DB unavailable: attempt stale fallback  
      if (cached && cached.hardStaleAt \> now) {  
        logger.warn('entitlement\_db\_unavailable\_stale\_fallback', { studentId, err: err.message });  
        return cached.snapshot;  
      }  
      logger.error('entitlement\_check\_unavailable', { studentId, err });  
      throw new EntitlementCheckUnavailableError('Entitlement check service unavailable');  
    }  
  }

  async invalidate(studentId: string): Promise\<void\> {  
    cache.delete(studentId);  
    try {  
      await this.supabase.rpc('notify\_entitlement\_invalidate', { p\_student\_id: studentId });  
    } catch (err) {  
      // NOTIFY failure is non-blocking; TTL will catch up  
      logger.warn('entitlement\_notify\_failed', { studentId, err: err.message });  
    }  
  }

  private async loadFromDb(studentId: string, req): Promise\<EntitlementSnapshot\> {  
    const { data: profile, error: profileErr } \= await this.supabase  
      .from('profiles')  
      .select(\`  
        id, role, country\_code, age\_years, deleted\_at,  
        entitlements ( tier, status, current\_period\_end, grace\_period\_ends\_at, cancel\_at\_period\_end )  
      \`)  
      .eq('id', studentId)  
      .single();

    if (profileErr) throw profileErr;  
    if (\!profile) throw new ProfileNotFoundError(studentId);

    if (profile.role \=== 'guardian') {  
      return this.resolveGuardianEntitlement(studentId, req);  
    }

    return this.buildStudentSnapshot(profile);  
  }

  private buildStudentSnapshot(profile: ProfileRow): EntitlementSnapshot {  
    const ent \= profile.entitlements?.\[0\];  
    const isActive \= ent && this.isStatusActive(ent);

    return {  
      studentId: profile.id,  
      tier: isActive ? 'premium' : 'free',  
      isActive,  
      expiresAt: ent?.current\_period\_end ? new Date(ent.current\_period\_end) : null,  
      graceUntil: ent?.grace\_period\_ends\_at ? new Date(ent.grace\_period\_ends\_at) : null,  
      source: isActive ? 'student\_direct' : 'none',  
      countryCode: profile.country\_code,  
      ageYears: profile.age\_years,  
      accountStatus: profile.deleted\_at ? 'soft\_deleted' : 'active'  
    };  
  }

  private isStatusActive(ent: EntitlementRow): boolean {  
    if (ent.status \=== 'active' || ent.status \=== 'trialing') return true;  
    if (ent.status \=== 'past\_due' && ent.grace\_period\_ends\_at && new Date(ent.grace\_period\_ends\_at) \> new Date()) return true;  
    if (ent.status \=== 'canceled' && ent.cancel\_at\_period\_end && ent.current\_period\_end && new Date(ent.current\_period\_end) \> new Date()) return true;  
    return false;  
  }

  private async resolveGuardianEntitlement(  
    guardianProfileId: string,  
    req: AuthenticatedRequest  
  ): Promise\<EntitlementSnapshot\> {  
    const { data: guardianProfile } \= await this.supabase  
      .from('profiles')  
      .select('id, country\_code, age\_years, deleted\_at')  
      .eq('id', guardianProfileId)  
      .single();

    const { data: links } \= await this.supabase  
      .from('guardian\_links')  
      .select('student\_profile\_id')  
      .eq('guardian\_profile\_id', guardianProfileId)  
      .eq('status', 'active');

    if (\!links || links.length \=== 0\) {  
      return this.buildGuardianSnapshot(guardianProfile, 'none', false);  
    }

    // Check each linked student's entitlement (reuse cache where possible)  
    const studentSnapshots \= await Promise.all(  
      links.map(link \=\> this.getEntitlementSnapshot(link.student\_profile\_id, req))  
    );

    const anyActivePremium \= studentSnapshots.some(s \=\> s.isActive && s.tier \=== 'premium');

    return this.buildGuardianSnapshot(  
      guardianProfile,  
      anyActivePremium ? 'guardian\_linked\_student' : 'none',  
      anyActivePremium  
    );  
  }

  private buildGuardianSnapshot(  
    profile: ProfileRow,  
    source: EntitlementSource,  
    isActive: boolean  
  ): EntitlementSnapshot {  
    return {  
      studentId: profile.id,  
      tier: isActive ? 'premium' : 'free',  
      isActive,  
      expiresAt: null,  
      graceUntil: null,  
      source,  
      countryCode: profile.country\_code,  
      ageYears: profile.age\_years,  
      accountStatus: profile.deleted\_at ? 'soft\_deleted' : 'active'  
    };  
  }

  private async evaluateFeatureAccess(  
    snapshot: EntitlementSnapshot,  
    featureKey: FeatureKey,  
    req: AuthenticatedRequest  
  ): Promise\<FeatureAccessResult\> {  
    const feature \= await this.loadFeatureConfig(featureKey);

    if (\!feature || \!feature.enabled) {  
      return this.denyResult(snapshot, 'feature\_disabled');  
    }

    if (snapshot.accountStatus \=== 'soft\_deleted') {  
      return this.denyResult(snapshot, 'account\_soft\_deleted');  
    }

    if (snapshot.ageYears \=== null || snapshot.ageYears \< feature.required\_age\_minimum) {  
      return this.denyResult(snapshot, 'under\_age');  
    }

    if (feature.requires\_tier\_1\_country && \!config.entitlement.tier\_1\_countries.includes(snapshot.countryCode)) {  
      return this.denyResult(snapshot, 'region\_blocked');  
    }

    if (feature.required\_tier \=== 'premium' && \!snapshot.isActive) {  
      const reason \= snapshot.expiresAt && snapshot.expiresAt \< new Date() ? 'expired' : 'not\_paid';  
      return this.denyResult(snapshot, reason);  
    }

    if (feature.blocked\_during\_live\_exam && await this.checkLiveExamInProgress(snapshot.studentId, req)) {  
      return this.denyResult(snapshot, 'live\_exam\_in\_progress');  
    }

    const abuseTier \= (await this.abuseScoreService.getScore(snapshot.studentId, req)).tier;  
    if (abuseTier \=== 'critical') {  
      return this.denyResult(snapshot, 'abuse\_score\_lockout');  
    }

    return { allowed: true, entitlementSnapshot: snapshot };  
  }

  private denyResult(snapshot: EntitlementSnapshot, reason: AccessDenialReason): FeatureAccessResult {  
    return { allowed: false, reason, entitlementSnapshot: snapshot };  
  }

  private async loadFeatureConfig(featureKey: FeatureKey) {  
    // Cached at process level; refreshed on config reload  
    return await featureConfigCache.get(featureKey);  
  }

  private async checkLiveExamInProgress(studentId: string, req): Promise\<boolean\> {  
    const { count } \= await this.supabase  
      .from('full\_length\_exams')  
      .select('id', { count: 'exact', head: true })  
      .eq('profile\_id', studentId)  
      .eq('status', 'in\_progress');  
    return (count ?? 0\) \> 0;  
  }  
}

// LISTEN loop — started once per API instance at server startup  
export async function startEntitlementInvalidationListener(pool: PgPool): Promise\<void\> {  
  const connect \= async () \=\> {  
    const listener \= await pool.connect();  
    await listener.query('LISTEN entitlement\_invalidate');  
    listener.on('notification', (msg) \=\> {  
      try {  
        const { student\_id } \= JSON.parse(msg.payload ?? '{}');  
        if (student\_id) {  
          cache.delete(student\_id);  
          logger.debug('entitlement\_cache\_invalidated', { student\_id });  
        }  
      } catch (err) {  
        logger.warn('entitlement\_notify\_parse\_error', { payload: msg.payload, err });  
      }  
    });  
    listener.on('error', async (err) \=\> {  
      logger.error('entitlement\_listener\_error', { err: err.message });  
      listener.release(true);  
      await retryConnect();  
    });  
  };

  const retryConnect \= async (attempt \= 1\) \=\> {  
    const backoff \= Math.min(60000, 1000 \* Math.pow(2, attempt));  
    await new Promise(r \=\> setTimeout(r, backoff));  
    try {  
      await connect();  
    } catch (err) {  
      await retryConnect(attempt \+ 1);  
    }  
  };

  await connect();  
}

// SQL helper function (migration)  
// CREATE OR REPLACE FUNCTION notify\_entitlement\_invalidate(p\_student\_id UUID)  
// RETURNS VOID AS $$  
// BEGIN  
//   PERFORM pg\_notify('entitlement\_invalidate', json\_build\_object('student\_id', p\_student\_id)::text);  
// END;  
// $$ LANGUAGE plpgsql;

---

# **Appendix D — Mobile Auth Flow Diagrams (Textual)**

## **D.1 Cold start with valid refresh token**

App launches  
  ↓  
Read tokens from Keychain/Keystore  
  ↓  
Access token expired?  
  ├─ No → Make API call with access token → 200 → proceed  
  └─ Yes → Silent refresh  
           ↓  
           POST /api/auth/refresh with refresh\_token  
           ↓  
           ├─ 200 → Store new tokens → retry original → proceed  
           └─ 401 → Clear tokens → show Login screen

## **D.2 Biometric re-auth for sensitive action**

User taps "Delete Account"  
  ↓  
Show confirmation modal  
  ↓  
User confirms → invoke LAContext / BiometricPrompt  
  ↓  
Biometric challenge (FaceID/TouchID/fingerprint)  
  ├─ Success → Start biometric\_action\_window\_seconds timer (60s)  
  │            ↓  
  │            Proceed with account deletion API call  
  │  
  ├─ Failure (3x) → Fall back to password re-entry  
  │                 ↓  
  │                 Password verified → Start window → Proceed  
  │  
  └─ Cancel → Abort action

## **D.3 Magic link deep link flow**

User requests magic link on mobile  
  ↓  
Email arrives on device  
  ↓  
User taps link  
  ↓  
iOS Universal Link / Android App Link opens app  
  ↓  
App extracts auth code from URL  
  ↓  
App calls Supabase Auth: exchangeCodeForTokens(code)  
  ↓  
Tokens returned → Store in Keychain/Keystore  
  ↓  
App navigates to authenticated home

## **D.4 Certificate pin failure handling**

App makes API call  
  ↓  
TLS handshake  
  ↓  
Compare server cert public key SHA-256 to pinned values  
  ├─ Primary pin matches → Proceed  
  ├─ Backup pin matches → Proceed (log event for monitoring)  
  └─ No match → Abort request  
                ↓  
                Show user: "Connection security issue. Please update the app."  
                ↓  
                Block further API calls until app update verified

---

# **Appendix E — DB Table Ownership Matrix**

Every table V8 references has a named writer governance pattern. Governance class and CI enforcement vary by class. Direct writes outside the canonical pattern are CI violations.

## **Ownership class definitions**

V8 recognizes three ownership classes. Each has different governance rules:

| Class | Pattern | CI enforcement | Example |
| ----- | ----- | ----- | ----- |
| **Single-writer** | Exactly one module writes this table. All other writes are violations. | Linter rejects direct writes outside the named module. Tests verify the module is the only code path reaching the table. | `profiles` — only `profile-service.ts` writes |
| **Shared append-only** | Multiple modules may insert rows (by design — e.g., any service writes audit events), but rows are never updated or deleted after insert. | Linter permits inserts from allowed module list. Schema-level constraint prevents UPDATE/DELETE. | `audit_logs` — multiple services emit |
| **Admin-mutable** | Rows managed by ops tooling (admin panel, DB migrations, runtime config tooling). Runtime services read these tables but do not write. | Linter rejects writes from runtime service code. Writes permitted only from migration scripts and admin tooling paths. | `*_runtime_config` tables |

## **Ownership matrix**

| Table | Ownership Class | Canonical Writer | Readers (allowed) | Notes |
| ----- | ----- | ----- | ----- | ----- |
| `profiles` | Single-writer | `profile-service.ts` | All authenticated routes via `req.user`; admin panel | Single-writer invariant (§3); launch-blocking consolidation per §3 cutover criteria |
| `entitlements` | Single-writer | Stripe webhook handler (billing-service module) \+ admin override path | `EntitlementService` via DB read | Writes on subscription lifecycle events only; admin override separately audited |
| `entitlement_features` | Admin-mutable | Admin panel \+ DB migration seed | `EntitlementService` via DB read | Declarative config; infrequent writes by ops |
| `guardian_links` | Single-writer | `guardian-service.ts` (new in V8) | `EntitlementService` for derivation; guardian dashboard | Status transitions only; rows never hard-deleted |
| `guardian_link_audit` | Shared append-only | `guardian-service.ts` (audit side effect); admin panel for forced revocation events | Admin panel; support tools | Append-only; UPDATE/DELETE prohibited at schema level |
| `guardian_consent_requests` | Single-writer | `consent-service.ts` (new in V8) | `profile-service.ts` on consent receipt | Status updates only |
| `account_deletion_requests` | Single-writer | `deletion-service.ts` (new in V8) | Scheduled hard-delete cron | Status transitions: pending → cancelled / completed / failed\_manual |
| `audit_logs` | Shared append-only | Every identity-service module (`profile-service.ts`, `guardian-service.ts`, `consent-service.ts`, `deletion-service.ts`, Stripe webhook handler, admin panel) | Admin panel; user GDPR export flow (via support) | Append-only; UPDATE/DELETE prohibited at schema level; retention per §5.1 |
| `audit_logs_archive` | Single-writer | Retention cron job | Compliance queries (rare) | Cold storage; service-role only |
| `auth_runtime_config` | Admin-mutable | Admin panel / ops tool | All services at startup \+ periodic refresh | Per Doc 01A config doctrine |
| `auth_mfa_config` | Admin-mutable | Admin panel / ops tool | Auth flow | Per Doc 01A |
| `consent_runtime_config` | Admin-mutable | Admin panel / ops tool | Consent flow | Per Doc 01A |
| `entitlement_runtime_config` | Admin-mutable | Admin panel / ops tool | `EntitlementService` | Per Doc 01A |
| `account_deletion_runtime_config` | Admin-mutable | Admin panel / ops tool | Deletion service \+ cron | Per Doc 01A |
| `mobile_auth_config` | Admin-mutable | Admin panel / ops tool | Mobile auth module | Per Doc 01A |
| `stripe_webhook_events` | Single-writer | Stripe webhook handler | Idempotency check (self-read) | Audit-confirmed existing |
| `stripeCancellationQueue` | Single-writer | `deletion-service.ts` (enqueue on Phase 2 failure); billing-service retry worker (dequeue \+ status update) | Ops dashboards; admin tooling | New table per §40.2.1; retry worker runs out-of-band |
| `usage_daily` | Single-writer | `RateLimitLedger` (Doc 01A) | Quota checks across all surfaces | Owned by Doc 01A; V8 notes dependency |

**CI enforcement by class:**

* **Single-writer class:** Linter rule rejects `supabase.from('<table>').insert/update/delete/upsert` outside the named canonical writer module. Exceptions (test setup, one-time migration scripts) are explicitly tagged with a `// canonical-writer-exception: <reason>` comment.  
* **Shared append-only class:** Linter permits `supabase.from('<table>').insert` from any module on the allow-list; rejects `update`, `delete`, `upsert`. Schema-level: CHECK constraints and/or triggers reject UPDATE and DELETE at DB level.  
* **Admin-mutable class:** Linter rejects any write operation from runtime service code (identified by path prefix `server/` or `apps/api/`). Writes permitted only from migration scripts (`infra/supabase/migrations/`) and admin tooling paths (`apps/admin/`).

**Quarterly audit:** Scan repo for any new tables; classify and add to this matrix. Verify existing tables have not added unauthorized writers.

**Why this matters:**

Mixing writer governance classes silently is worse than any one class done consistently. A table that is "mostly single-writer but occasionally written by admin tooling" hides the admin exception from the CI enforcement model. Explicit class labeling makes the governance pattern part of the schema contract, not an implicit convention.

Multiple writers to identity tables without shared-append semantics create:

* Duplicate audit events (or missing ones if writer forgets to emit)  
* Race conditions on cache invalidation (one writer invalidates; another forgets)  
* Inconsistent validation (one writer enforces uniqueness; another doesn't)  
* Diverging schemas over time (one writer adds new columns its callers know about; other writers don't)

Single-writer discipline, where appropriate, is the cheapest way to prevent these failure modes. Shared-append-only is appropriate where the write is append-by-design (audit logs). Admin-mutable is appropriate where the data is configuration managed by ops.

---

# **End of Doc 01 V8.0**

**Canonical for Lyceon platform as of 2026-04-23.** **Supersedes Doc 01 V7.0 and V6.0.** **Coordinates with Doc 00 (Platform Directive), Doc 01A V1 (Platform Primitives, pending), Doc 02 family (Runtime), Doc 03 family (Tutor, pending rewrite against V7.1+01A).** **Next review trigger:** Doc 01A V1 lock; Neon pooling resolution enabling RLS reinstatement; mobile app shipping; Stripe billing model change; new role added to `profile_role`; country allow-list change; COPPA regulatory change.

---

## **Companion Artifacts (Scoped Separately)**

V8 is the canonical spec. Implementation-focused materials are scoped as separate companion artifacts, owned by engineering. Urgency classified by launch-blocking status:

* **\[LAUNCH-BLOCKING\] Doc 01.1 — Identity Test Matrix** — 100+ scenario tests covering auth flows, role enforcement (including privileged elevation session invalidation per §17A.1), entitlement transitions, guardian consent, deletion recovery, MFA, mobile auth, privilege escalation attempts, race conditions. Owner: Engineering. Target: before V1 launch. V1 cannot ship without this — test coverage for security-relevant flows is a launch prerequisite.

* **\[BLOCKING PER MIGRATION\] Doc 01.2 — Identity Migration Runbooks** — Per-migration runbooks covering: `accounts/account_members` retirement → `entitlements.profile_id` direct FK; multiple `profiles` writers → single `profile-service.ts` canonical writer; RLS reinstatement via Supavisor pooler migration; `stripeCancellationQueue` introduction. Each runbook follows the additive → dual-write → backfill → compare-reads → cutover → cleanup pattern and aligns with the cutover criteria / blocking conditions / completion proof structure in the relevant V8 deviation boxes. Owner: Engineering. Target: each runbook blocks its respective migration, not V1 launch globally (except for migrations required before launch).

* **\[STRONGLY RECOMMENDED\] Doc 01.3 — Identity Engineer Runbooks** — Implementation-focused walkthroughs for: auth middleware integration, `EntitlementService` consumption in new feature routes, guardian linking flow, MFA enrollment and recovery, Stripe webhook handler additions for new event types, LISTEN/NOTIFY operational modes, dashboards and alert routing per §45A. Owner: Engineering. Target: alongside V8 rollout. Not formally launch-blocking — engineering can operate from V8 directly — but strongly recommended to reduce ramp-up time and prevent per-engineer rediscovery of operational patterns.

V8 stays spec-grade. Companion docs carry the implementation detail. Feature docs consume V8 interfaces.

---

**V8.0 scope summary:** Targeted polish of V7.1 addressing external review (8.8/10). Five targeted fixes land: (1) §17A.1 privileged role elevation session invalidation — stale lower-privilege JWTs cannot silently gain elevated capability; (2) §40.3 wording contradiction resolved — Stripe cancellation phrased consistently with §40.2.1 partial-failure semantics; (3) Appendix E ownership class labeling — explicit single-writer / shared-append / admin-mutable classification with per-class CI enforcement rules; (4) footer companion artifacts marked by launch-blocking status; (5) §45A launch-target disclaimer making SLO/SLI aspirational-until-validated explicit. Three targeted additions: (a) §8.6.1 threat model for independent web/mobile sessions (consistent with other brief-inline threat models); (b) §44 launch-reality support staffing note (founder/admin-backed at launch, role differentiation post-scale); (c) four deviation boxes (§3, §14.3, §24, §34) tightened with cutover criteria / blocking conditions / completion proof structure for launch-critical migrations. Five change records CR-01-39 through CR-01-43. V7.1 architecture, interfaces, and core content preserved unchanged.

**V7.1 scope summary:** V7.0 full rewrite supersedes V6. V7.1 adds targeted corrections from V7.0 external review (7.9/10): audit log retention \+ PII boundaries (§5.1), Bearer/device-fingerprint/cert-pinning threat models inline (§7.2.1, §8.7.1, §8.8.1), JWT vs profile role conflict resolution (§18.1), abuse lockout override path (§27.3.1), LISTEN/NOTIFY production modes cross-reference (§29.5), guardian N+1 query pattern (§31.2.1), deletion Stripe-failure partial-semantics (§40.2.1), OpenAPI/Zod schema generation mandate repo-wide (§42A), Performance Budgets SLO/SLI table (§45A), EntitlementService internal composition refactor (§32.1 — unified external interface, internal modules: CacheManager \+ PolicyEvaluator \+ RuntimeGuard \+ AbuseCheck), DB Table Ownership Matrix (Appendix E), three scoped companion artifacts (Doc 01.1/01.2/01.3) as separate deliverables.

**Core spec: identity canonicalization on `profiles` with single-writer `profile-service.ts`; web auth via HttpOnly `sb-access-token` (Bearer rejected per audit); full mobile auth — Keychain/Keystore, silent refresh, biometric re-auth, deep linking, cert pinning, offline fail-closed, device fingerprinting, independent web↔mobile sessions; three-layer authorization with Layer 1 app-layer filtering canonical at launch (Neon pooling bypasses RLS; reinstatement target-state pending pooler migration), `scopedFrom` helper \+ CI enforcement; privileged role elevation invalidates active sessions forcing re-authentication with MFA (§17A.1); Stripe-native billing with Tier 1 countries, Stripe Tax, past-due grace, `entitlements.profile_id` target-state; canonical `EntitlementService` with feature-check interface, in-process cache \+ LISTEN/NOTIFY invalidation (60s TTL, 300s hard staleness), guardian derivation wrapping existing `resolveLinkedPairPremiumAccessForGuardian`, deterministic evaluation order, declarative `entitlement_features` mapping, internal composition of 4 focused modules; MFA with TOTP \+ WebAuthn only; guardian trust with linking, COPPA consent, aggregate-only visibility excluding tutor data; 7-day soft-delete with phased Stripe cancellation, retry queue, wording consistent between initiation and reconciliation; support-mediated operations with acknowledged launch staffing reality; target-dominant doctrine with tightened deviation boxes carrying cutover/blocking/completion structure on launch-critical migrations; constants in DB-backed `*_runtime_config`; platform primitives consumed from Doc 01A V1; 17 change records continuing V6 lineage (CR-01-27 through CR-01-43); 5 appendices (Identity Constants Catalog, Schemas, EntitlementService Reference Implementation, Mobile Auth Flow Diagrams, DB Table Ownership Matrix with ownership class governance).**

