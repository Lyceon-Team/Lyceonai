# **Lyceon — Document 01: Identity, Access, Billing & Guardian Trust (V6)**

**Version:** 6.0 **Last Updated:** 2026-04-21 **Status:** Authoritative Product \+ Engineering Directive **Owner:** Founder / CTO Review **Governed By:** Document 00 (Authoritative Platform Directive) **Depends On:** Supabase Auth, Stripe, `copilot` schema, runtime repos (product \+ content) **Applies To:** All identity, account, authentication, authorization, billing, entitlement, MFA, guardian trust, consent, and account-lifecycle flows across Lyceon platform

---

# **Table of Contents**

1. Purpose and Mission  
2. Scope and Out-of-Scope  
3. Inheritance from Doc 00  
4. Supersession and Relationship to Prior Versions  
5. Current-State vs Target-State Doctrine  
6. Naming and Verification Doctrine  
7. Identity Model  
8. Roles and Role Resolution  
9. Canonical Writer for Profiles  
10. Authentication Flows  
11. Multi-Factor Authentication (MFA)  
12. Authorization and Access Control  
13. Billing and Subscription Model  
14. Entitlement Model  
15. Guardian Trust and Linkage  
16. Guardian Visibility and Consent Workflow  
17. Under-13 Consent and COPPA Compliance  
18. Role Switching  
19. Account Deletion and Soft-Delete Lifecycle  
20. Password Reset and Account Recovery  
21. Support-Mediated Operations  
22. Security and Audit  
23. Constants Doctrine  
24. Failure Modes  
25. Observability  
26. CI / Testing Standards  
27. Known Architectural Debt  
28. Change Control  
29. Verification Before Refactor Checklist  
30. Cross-Document Dependencies  
31. Final Principles  
32. Change Records  
33. Worked Examples  
34. Appendix A — Identity Constants Catalog

---

# **1\. Purpose and Mission**

## **Purpose**

Lyceon's identity and access layer is foundational. Every feature — practice, review, exams, tutor, billing, guardian oversight — depends on correctly identifying who is using the system, what they are allowed to do, and what protects their access. If identity is wrong, everything downstream is wrong. If access control is wrong, academic integrity, financial integrity, and child safety all fail simultaneously.

This document governs how Lyceon establishes who a user is (identity), how we verify it's actually them (authentication including MFA), what they are allowed to do (authorization and role-based access), how their use is billed (subscriptions through Stripe), what premium features they can access (entitlement), how guardians supervise minor students (guardian trust), and how accounts begin and end safely (creation, role switching, deletion).

## **Strategic Mission**

Build an identity and access layer that is invisible when working, uncompromising when challenged, and operationally clean. Students, guardians, tutors, and admins should not have to think about identity. The system should feel automatic — login is fast, MFA is frictionless, guardian oversight is clear without being intrusive, billing is transparent, and the edges (role transitions, account deletion, consent revocation) are handled with care.

At the same time, every shortcut a competitor might take — weak MFA enforcement, loose under-13 gating, vague entitlement boundaries, multi-writer identity tables — is a shortcut Lyceon explicitly refuses. Identity is the floor of product trust. It cannot be rebuilt later without breaking existing users.

## **Why This Matters**

Identity bugs are catastrophic because they touch everything. A misrouted auth token, a role escalation exploit, an under-13 account created without consent, an entitlement that leaks premium features — each of these damages the product substantially and is often impossible to fully recover from. Competitors fail at identity all the time (data breaches, COPPA violations, stale subscriptions charging after cancellation). Lyceon's discipline here is a moat, not a constraint.

---

# **2\. Scope and Out-of-Scope**

## **In Scope**

Identity canonicalization on `profiles`; role resolution and enforcement; authentication flows including Supabase Auth integration, email/password, magic links, OAuth providers; MFA via Supabase `auth.mfa_factors`; authorization including RLS policies and application-layer entitlement checks; billing via Stripe and subscription lifecycle; entitlement state and transitions; guardian-student linkage and visibility; guardian consent workflow including under-13 COPPA compliance; role switching mechanism; account deletion with 7-day soft-delete lifecycle; password reset; support-mediated operations; MFA rollout policy by role; canonical writer consolidation for `profiles`; audit logging of identity-relevant events; constants-in-DB discipline for identity/access configuration.

## **Out of Scope**

Runtime engine behavior (Doc 02B), content governance (Doc 02A), mastery computation (Doc 02C), tutor model architecture (future Doc 03), study plan scheduling (future Doc 04), marketing and growth surfaces (future Doc 05), non-SAT exam family expansion (future Doc 06). This document touches billing to the extent it affects entitlement; the full Stripe integration spec and webhook handling internals are operational concerns that implement this doc.

---

# **3\. Inheritance from Doc 00**

This document inherits all Doc 00 platform-level invariants. Particularly load-bearing:

* **Server-authoritative mutations.** All identity, role, entitlement, and billing state changes happen server-side. Client state is never trusted for these values.  
* **Single writer per canonical table.** Identity tables especially must have a canonical writer. V6 declares and enforces this for `profiles`.  
* **No client role trust.** Roles are resolved from `profiles.role` server-side on every request. No role claim in client storage is trusted.  
* **One identity per user.** Each authenticated user corresponds to exactly one `profiles` row. Duplicate profiles are architectural bugs.  
* **Auditable flow.** Identity changes, role changes, entitlement changes, and consent changes are all audited.  
* **Data protection by default.** No data leakage at any layer — embeddings, analytics exports, guardian surfaces, or runtime responses.

Doc 00's doctrine is this document's foundation. Where this document specifies identity and access behavior, it does so within the bounds Doc 00 establishes.

---

# **4\. Supersession and Relationship to Prior Versions**

V6 is a full rewrite of Doc 01\. It supersedes V5 entirely. Content in V5 that remains accurate is preserved in updated form; content that reflected outdated schema or repository assumptions is corrected; sections V5 left thin are expanded.

Specifically, V6 corrects V5's assumption that `lyceon_accounts`/`lyceon_account_members` is canonical. Current reality is that `accounts`/`account_members` is live via the `ensure_account_for_user` RPC. V6 takes target-state entitlement-on-profile as canonical and flags the current-state RPC pattern as debt to resolve.

V6 also formally consolidates the canonical writer for `profiles` — V5 left this implicit and allowed the five-writer pattern to emerge. V6 declares `profile-service.ts` as the single canonical writer, with all other paths required to migrate.

Prior V5 content moves to `docs/old-spec-docs/` as historical reference.

---

# **5\. Current-State vs Target-State Doctrine**

This specification uses two operating lenses throughout.

**Current-State** describes the implementation present today based on the DB schema audit and repository runtime audit. It may include legacy tables still receiving writes, mid-migration states, and known debt items.

**Target-State** describes the preferred mature architecture after controlled migration. It has stronger isolation, tighter contracts, consolidated writers, and full audit capability.

## **Conflict Resolution Order**

When current-state and target-state conflict, the resolution order is:

1. **Current-state is how the system behaves today.** Truth for understanding production.  
2. **Target-state is the destination.** Truth for understanding the goal.  
3. **Before any refactor, engineers verify current state** from actual repository and database, not from assumption.  
4. **Refactors move current toward target.** They do not preserve current state indefinitely.  
5. **Change records document the gap path** from current to target, including migration pre-conditions, rollback strategy, verification criteria.

## **V6 Posture**

V6 documents target-state as canonical throughout. Current-state realities are flagged as debt with explicit resolution paths. This is the appropriate stance for governance-level documentation — V6 describes what Lyceon identity should be; Doc 02B describes what runtime actually does; both converge as migrations complete.

## **Why This Matters**

Identity specs that describe only current reality become obsolete every time the DB changes. Identity specs that describe only ideal state become fiction. V6 does both: target is the document's spine; current-state debt is cataloged, owned, and time-bounded.

---

# **6\. Naming and Verification Doctrine**

This document uses actual table, column, and schema names where verified through the DB schema audit and repository audit. Where names are introduced for target-state components, they are described by intent and bracketed as proposals subject to verification.

## **Verification-Before-Change Discipline**

Every operational section in V6 carries a verification callout. Before any team refactors a component described here, they gather proof of current behavior from the actual repository, actual database, and actual deployed runtime. They compare verified truth to V6. Any divergence is documented and resolved intentionally.

## **Naming Conventions Confirmed at V6**

* Identity: `profiles` canonical with `profiles.id` (maps to `auth.uid()`) and `profiles.role` (profile\_role enum); `users` deprecated  
* Auth: Supabase-managed `auth.users`, `auth.mfa_factors`, `auth.mfa_challenges`, `auth.mfa_amr_claims`, `auth.sessions`, `auth.refresh_tokens`  
* Billing: `entitlements` canonical (target: linked to `profiles.id`; current: linked to `accounts.id` via `ensure_account_for_user` RPC); `profiles.stripe_customer_id`; `usage_daily`; `stripe_webhook_events`  
* Account lifecycle (current state): `accounts`, `account_members` (legacy, being phased out); `lyceon_accounts`, `lyceon_account_members` (policy-healthy but may be orphaned)  
* Account deletion: `account_deletion_requests` with FK to `profiles.id`; `deidentify_user` RPC  
* Guardian: `guardian_links`, `guardian_link_audit`, `guardian_consent_requests`, `profiles.guardian_profile_id` self-reference  
* Under-13 consent: `profiles.is_under_13`, `profiles.guardian_email`, `profiles.guardian_consent`, `profiles.consent_given_at`  
* Audit: `audit_logs` (FK to legacy `users.id` — Wave 1 fossil); `system_event_logs`  
* Canonical profile writer: `profile-service.ts` (target; current state has 5 writers)

---

# **7\. Identity Model**

## **`profiles` as Canonical Identity**

The single source of truth for user identity is the `public.profiles` table. Every authenticated user of Lyceon has exactly one `profiles` row, keyed by `profiles.id` which maps 1:1 to `auth.uid()` from Supabase Auth.

No other table is authoritative for identity. The legacy `users` table still exists as a FK target for Wave 1 tables (`attempts`, `audit_logs`, `chat_messages`) but is deprecated; these FKs are migration targets, not current-state identity references.

## **Profile Structure**

Each `profiles` row captures:

**Core identity:**

* `id` — UUID, primary key, maps to `auth.uid()`  
* `email` — canonical email address  
* `display_name` — user-facing display name  
* `role` — enum: student, guardian, admin, tutor, teacher

**Personal details (optional at creation):**

* `first_name`, `last_name`, `phone_number`, `date_of_birth`, `address`  
* `time_zone` — defaults to America/Chicago if unset  
* `preferred_language` — defaults to 'en'

**Under-13 consent state:**

* `is_under_13` — boolean  
* `guardian_email` — email of linked guardian for under-13 students  
* `guardian_consent` — boolean; true when guardian has completed consent  
* `consent_given_at` — timestamp of consent

**Guardian relationship:**

* `guardian_profile_id` — self-referencing FK; set on student profiles to point to linked guardian's profile

**Billing:**

* `stripe_customer_id` — Stripe customer identifier for billing operations

**Link codes:**

* `student_link_code` — short code used by guardians to link to a student

**Account state:**

* `created_at`, `updated_at`, `last_login_at`, `profile_completed_at`  
* `marketing_opt_in`

**Personalization (optional):**

* `overall_level`, `primary_style`, `secondary_style`, `explanation_level`, `competency_map`, `persona_tags`, `learning_prefs`

## **Profile Creation Flow**

Profiles are created as a side-effect of Supabase Auth signup. When a new user signs up:

1. Supabase creates an `auth.users` row and issues a session  
2. The profile bootstrap process runs on the backend (target: within `profile-service.ts`)  
3. A `profiles` row is created with `profiles.id = auth.uid()`  
4. Initial `role` is determined from signup context (see §8)  
5. Profile is written as incomplete; user is prompted to complete profile details

No direct client-initiated `profiles` inserts. The canonical writer handles all profile creation through `profile-service.ts` at target state.

## **Profile Update Flow**

All `profiles` updates flow through `profile-service.ts` per the canonical writer rule (§9). Clients call API routes; routes call the service; service performs the update, emits audit events, and invalidates relevant caches.

## **One Identity Per User**

Each user has exactly one profile. If a user needs additional accounts (e.g., a guardian who is also a student), they either use role switching (§18) or maintain separate Supabase Auth identities entirely with separate profile rows. Lyceon does not support multi-profile accounts per user.

## **Why This Matters**

Identity consistency prevents an entire class of bugs: cross-user data leaks, duplicate billing subscriptions, role ambiguity at authorization checks, unclear guardian relationships. Every downstream system (mastery, entitlement, analytics, audit) assumes one profile per user and works correctly only when that assumption holds.

## **Verification Before Refactor**

Before refactoring identity: inspect `profiles` schema for current column set, verify `profiles.id` is FK-compatible with `auth.uid()`, confirm no orphaned rows where `auth.users` exists without `profiles` row, audit legacy `users` table write patterns to confirm it's receiving no new writes.

---

# **8\. Roles and Role Resolution**

## **Role Vocabulary**

The `profiles.role` enum defines five roles:

* **student** — end user taking SAT prep; the primary product user  
* **guardian** — parent or legal guardian of a minor student; has visibility into linked student's aggregate data  
* **admin** — Lyceon internal staff with operational privileges  
* **tutor** — Lyceon-affiliated tutor with access to tutor surfaces (future expansion; minimal at launch)  
* **teacher** — classroom instructor using Lyceon for cohorts (future expansion; minimal at launch)

## **Role Assignment at Signup**

Role is set at profile creation based on signup context:

* Standard signup → `student`  
* Guardian signup (via link-to-student flow) → `guardian`  
* Internal staff signup (via admin-created account) → `admin`  
* Tutor signup (via admin invitation) → `tutor`  
* Teacher signup (via admin invitation) → `teacher`

Students and guardians can self-signup. Admins, tutors, and teachers require admin-created accounts.

## **Role Resolution at Runtime**

Every authenticated request resolves role server-side by reading `profiles.role` for the authenticated `auth.uid()`. Clients never assert their own role. Role claims in JWT tokens (via Supabase claims) may be used for coarse routing but are validated against `profiles.role` for any authorization-relevant decision.

## **Role Permissions (High-Level)**

| Role | Can access | Key restrictions |
| ----- | ----- | ----- |
| student | Practice, review, exams, tutor, mastery, study plan per entitlement | Cannot see other students' data; cannot act as guardian |
| guardian | Dashboard with aggregate data for linked students; billing on behalf | Cannot see individual question responses or answers; cannot modify student profile directly |
| admin | Full operational access | All actions audited; no student content modification outside Doc 02A flows |
| tutor | Tutor surfaces for assigned students | Minimal at launch; future expansion |
| teacher | Cohort management surfaces | Minimal at launch; future expansion |

Detailed permissions in §12.

## **Why This Matters**

Role is the axis around which all other authorization decisions rotate. Misrouted role assignment (e.g., a student accidentally given admin role) is catastrophic. Role resolved only server-side from canonical truth prevents role escalation via token tampering.

## **Verification Before Refactor**

Before refactoring role resolution: audit all role-check sites in runtime code, verify they read `profiles.role` (not JWT claim directly), confirm no client-trusted role paths, test role-based RLS policies for correctness across all roles.

---

# **9\. Canonical Writer for Profiles**

## **The Rule**

`profile-service.ts` is the **only** canonical writer for the `profiles` table. All profile mutations — create, update, role change, guardian link, consent flag, soft-delete mark — flow through this service.

This is a target-state declaration. Current state has five writers:

* `profile-service.ts` (intended canonical)  
* `profile-bootstrap.ts`  
* `guardian-routes.ts`  
* `guardian-consent-routes.ts`  
* `profile-routes.ts`  
* `supabase-auth-routes.ts`

Per Q3 decision, V6 consolidates all of these into `profile-service.ts` with other paths deprecated.

## **Scope of Canonical Writer**

`profile-service.ts` exposes typed operations for every profile mutation:

* `createProfile(authUserId, initialData)` — called by auth signup trigger  
* `updateProfile(profileId, changes, actorContext)` — general update  
* `updateProfileRole(profileId, newRole, actorContext)` — role transition  
* `setGuardianLink(studentProfileId, guardianProfileId, actorContext)` — guardian linking  
* `updateConsentState(profileId, consentChanges, actorContext)` — under-13 consent  
* `markProfileForDeletion(profileId, actorContext)` — soft-delete flag  
* `finalizeDeletion(profileId, actorContext)` — hard-delete anonymization call

Each operation validates inputs, performs the write, emits audit events to `audit_logs`, invalidates caches, and returns the updated profile.

## **Migration Plan: Five to One**

Current state has five writers. Consolidation to one happens in phases:

**Phase 1 — Service implementation.** Build `profile-service.ts` with all required operations. Unit tests verify each operation writes the intended columns. No routing changes yet.

**Phase 2 — Migrate easy cases.** Move `profile-routes.ts` updates to call the service. These are the most direct user-initiated updates and should migrate cleanly.

**Phase 3 — Migrate auth-side writes.** Move `profile-bootstrap.ts` and `supabase-auth-routes.ts` writes into the service. These are triggered by Supabase Auth events; the service becomes the handler for those events.

**Phase 4 — Migrate guardian flows.** Move `guardian-routes.ts` and `guardian-consent-routes.ts` writes into the service. Guardian operations typically involve two-sided updates (student profile \+ guardian profile \+ guardian\_links); the service orchestrates these atomically.

**Phase 5 — Deprecate and delete.** Remove direct `profiles` writes from all non-service files. Linter or CI check enforces that only `profile-service.ts` contains writes to `profiles`.

**Phase 6 — Verify.** Audit production writes. Confirm only the service produces them. Close the debt item.

## **Why One Writer**

The one-writer rule exists because:

1. **Consistency.** A single code path for writes eliminates race conditions between competing writers and enforces consistent validation.  
2. **Auditability.** Every write passes through one seam where audit events are emitted. Nothing bypasses the log.  
3. **Atomicity.** Multi-field updates (e.g., role change \+ audit event \+ cache invalidation) are one transaction.  
4. **Testability.** Unit tests focused on one service cover every profile write path.  
5. **Refactor safety.** Schema changes touch one file's queries, not five.  
6. **Authorization uniformity.** Service checks actor authorization before any write; routes become thin and presentation-focused.

## **What About Reads?**

Reads from `profiles` are unrestricted in the sense that many routes read profile data directly for their own purposes (rendering dashboards, checking roles, etc.). The canonical writer rule applies to writes only. Read consolidation is not required.

## **Verification Before Refactor**

Before refactoring any profile-touching code: grep the repository for `UPDATE profiles`, `INSERT INTO profiles`, and `.from('profiles').update(`, `.from('profiles').insert(` patterns; confirm the only matches are in `profile-service.ts`. If matches appear elsewhere, they are debt that must migrate to the service.

---

# **10\. Authentication Flows**

## **Supabase Auth as Foundation**

Lyceon uses Supabase Auth for authentication primitives. Supabase manages password hashing, session tokens, refresh tokens, OAuth provider integration, and magic link delivery. Lyceon does not reimplement any of these.

## **Supported Auth Methods**

**Launch:**

* Email and password  
* Magic link (passwordless email)  
* OAuth: Google

**Post-launch expansion (planned):**

* Additional OAuth providers (Apple, Microsoft) as demand warrants  
* WebAuthn passkeys (rides on Supabase capabilities)

## **Signup Flow**

1. User provides email and chooses auth method  
2. Supabase creates `auth.users` row  
3. Email verification (for password signups and magic links)  
4. On successful verification, `profile-service.ts` creates `profiles` row via the profile creation path (§7)  
5. User lands in onboarding flow to complete profile  
6. For under-13 signup: guardian consent flow (§17) triggers before any feature access

## **Login Flow**

1. User authenticates via Supabase Auth (email/password, magic link, or OAuth)  
2. Supabase issues session JWT  
3. Backend validates JWT on each request via Supabase middleware  
4. `profiles.role` read for authorization context  
5. `profiles.last_login_at` updated on successful authentication

## **Session Management**

Sessions are Supabase-managed JWTs with standard expiration (configurable per Supabase settings). Refresh tokens enable session continuation. On token expiry mid-request, client receives 401; client re-authenticates silently via refresh token or prompts user for login.

Multi-device sessions are allowed — a user can be logged in from multiple devices simultaneously. Exam integrity constraints (concurrent access) are handled per Doc 02B §17.

## **Logout Flow**

Client calls Supabase signOut. Session is invalidated. Server-side session state (if any) cleared. No additional custom logout logic required beyond Supabase primitives.

## **Why This Matters**

Authentication is the front door. Building on Supabase Auth means Lyceon gets battle-tested authentication primitives (password hashing via Argon2, secure session tokens, CSRF protection, OAuth state validation) without reinventing them. The focus is on the Lyceon-specific layer — profile creation, role assignment, under-13 consent, MFA rollout policy — not the underlying auth mechanics.

## **Verification Before Refactor**

Before refactoring auth: verify Supabase Auth configuration matches product expectations (session duration, refresh token TTL, email templates), confirm JWT validation happens on every protected route, test OAuth callbacks for all supported providers, verify magic link flows including expiration handling.

---

# **11\. Multi-Factor Authentication (MFA)**

## **MFA as Supabase-Managed**

MFA is implemented via Supabase's `auth.mfa_factors`, `auth.mfa_challenges`, and `auth.mfa_amr_claims` tables. Lyceon uses Supabase's MFA primitives directly; no custom MFA implementation.

Supported MFA methods (per Supabase capabilities):

* TOTP (authenticator apps like Google Authenticator, Authy, 1Password)  
* WebAuthn / FIDO2 (biometric and hardware security keys; rolls out as Supabase support matures)

SMS-based MFA is not supported at launch — SMS is phishable and not compliant with modern best practices.

## **MFA Rollout Policy by Role**

MFA rollout matches the V5 policy:

| Role | MFA at launch | Enforcement timeline |
| ----- | ----- | ----- |
| admin | **Required** | From day one; no exceptions |
| tutor | **Required** | From day one; no exceptions |
| teacher | **Required** | From day one; no exceptions |
| student | Encouraged at signup; required within 14 days or before billing action | Soft-prompt at signup; hard gate at 14 days or first billing action |
| guardian | Encouraged at signup; required within 14 days or before billing action | Same as student |

## **Rationale for Staged Rollout**

* **Admin/tutor/teacher at launch:** Staff accounts are high-leverage targets. Compromise affects many users. Immediate MFA is required.  
* **Student/guardian staged:** Requiring MFA at signup adds friction that suppresses signup conversion. The 14-day or billing-action grace period gives time to onboard before hard-gating; billing action is a natural enforcement trigger because the user has already demonstrated engagement and commitment.

## **MFA Enrollment Flow**

1. User navigates to security settings or is prompted (by timeline or before billing)  
2. User chooses MFA method (TOTP or WebAuthn)  
3. Supabase generates enrollment challenge  
4. User completes enrollment (scans QR for TOTP, registers key for WebAuthn)  
5. Supabase records factor in `auth.mfa_factors`  
6. User is now MFA-enabled

## **MFA Challenge Flow**

On login for MFA-enabled users:

1. Primary authentication completes (password, OAuth, or magic link)  
2. Supabase returns session in MFA-pending state  
3. User prompted for second factor  
4. User provides TOTP code or WebAuthn assertion  
5. Supabase verifies challenge; session transitions to fully authenticated

## **MFA Recovery**

Users with lost MFA devices recover via support-mediated flow (§21). They verify identity through email and security questions; support resets MFA factors. Users then re-enroll.

No recovery codes at launch (complexity, low utility at low MFA adoption). Post-launch, recovery codes may be added if MFA-disablement support burden grows.

## **MFA Enforcement at Sensitive Actions**

Even beyond login, certain sensitive actions re-challenge MFA:

* Billing changes (adding payment method, upgrading subscription, changing address)  
* Account deletion initiation  
* Email address change  
* Guardian-link establishment for a newly linked student  
* Role-switch requests

At launch, these re-challenges are lightweight (freshly-authenticated session check). Post-launch, explicit MFA re-challenge for specific actions may be added.

## **Why This Matters**

MFA is the most cost-effective security upgrade available. Credential stuffing, phishing, and SIM-swap attacks all fail against MFA. Requiring MFA for staff from day one protects Lyceon's entire user base from a compromised admin account. Staging MFA for students and guardians balances security with onboarding conversion — a dead-simple tradeoff once the policy is explicit.

## **Verification Before Refactor**

Before refactoring MFA: inspect Supabase configuration for enabled MFA factor types, verify enrollment flow in repository, test challenge flow including edge cases (expired codes, browser tab closed mid-flow, concurrent enrollment attempts), confirm MFA-required roles cannot authenticate without MFA enrolled, verify the 14-day timer or billing-action trigger is implemented for students/guardians.

---

# **12\. Authorization and Access Control**

## **Authorization Layers**

Lyceon has three authorization layers, each enforcing access control at a different level:

**Layer 1: RLS (Row-Level Security)** on DB tables. Every user-scoped table has RLS policies that enforce row ownership via `auth.uid() = user_id` or through join conditions to ownership tables (e.g., guardian can read linked student data through `guardian_links`).

**Layer 2: Application-layer entitlement checks.** Premium features are gated in application code by reading `entitlements` state. Free tier quota limits are enforced in application code. Role-based feature gates (e.g., admin-only UIs) are checked in application code.

**Layer 3: Audit logging.** Every authorization-relevant action is logged, whether granted or denied. Denied actions at the RLS layer are silent (rows not returned); denied actions at the application layer return 403 or equivalent and log with reason.

## **RLS Canonical Pattern**

The standard RLS pattern for user-scoped tables:

CREATE POLICY table\_select\_own ON table\_name  
  FOR SELECT TO authenticated  
  USING (user\_id \= auth.uid());

CREATE POLICY table\_insert\_own ON table\_name  
  FOR INSERT TO authenticated  
  WITH CHECK (user\_id \= auth.uid());

Writes are typically restricted to `service_role` with application-layer validation, but self-service reads and some writes follow the pattern above.

## **Guardian Read Access Pattern**

Guardian reads on linked students' aggregate data use an EXISTS join through `guardian_links`:

CREATE POLICY table\_select\_guardian\_read ON table\_name  
  FOR SELECT TO authenticated  
  USING (  
    EXISTS (  
      SELECT 1 FROM guardian\_links gl  
      WHERE gl.guardian\_profile\_id \= auth.uid()  
        AND gl.student\_profile\_id \= table\_name.user\_id  
    )  
  );

This pattern is used for dashboards showing aggregate student progress to guardians. Question-level data is excluded from guardian surfaces entirely (enforced at application layer and by not including detailed data in the query result).

## **Admin Access Pattern**

Admin-only reads use `is_admin_jwt()` function which reads the JWT's role claim. This is the canonical admin check pattern. Legacy policies using `EXISTS (SELECT 1 FROM users WHERE is_admin = true)` are deprecated and should be migrated to `is_admin_jwt()`.

## **Service-Role Write Pattern**

Service-role writes bypass RLS and happen via Supabase's service-role key used by backend services. Every service-role write path (`profile-service.ts`, `mastery-write.ts`, `ensure_account_for_user` RPC, etc.) handles authorization in application code before executing writes.

## **No Client Role Trust**

Client-asserted roles are never used for authorization. JWT claims from Supabase contain a role field; this field may be used for coarse routing in middleware but is validated against `profiles.role` for any authorization-critical decision.

## **Permission Matrix (Summary)**

| Action | Student | Guardian | Admin | Tutor | Teacher |
| ----- | ----- | ----- | ----- | ----- | ----- |
| Self profile read/update | ✓ | ✓ | ✓ | ✓ | ✓ |
| Linked student profile read | — | Aggregate only | ✓ | — | — |
| Linked student profile write | — | — | ✓ | — | — |
| Practice/review/exam self | ✓ | — | ✓ (own) | — | — |
| Mastery self | ✓ | Aggregate only for linked | ✓ | — | — |
| Billing self | ✓ (own entitlement) | ✓ (pay for linked student) | ✓ | — | — |
| Content publishing | — | — | ✓ (via Doc 02A flow) | — | — |
| Role switching | — | — | ✓ (process requests) | — | — |
| Admin surfaces | — | — | ✓ | — | — |
| Tutor surfaces (assigned students) | — | — | ✓ | ✓ (future) | — |
| Teacher surfaces (cohort students) | — | — | ✓ | — | ✓ (future) |

## **Why This Matters**

Authorization determines who can see and do what. Getting it wrong leaks student data to wrong guardians, lets admins-masquerading-as-students skew analytics, exposes internal content to unauthorized users. Layered enforcement (RLS \+ application \+ audit) means no single bypass catastrophically fails.

## **Verification Before Refactor**

Before refactoring authorization: audit all RLS policies for canonical pattern adherence, verify no client-trusted role paths in application code, test guardian read patterns against non-linked students to confirm RLS blocks access, test admin access using `is_admin_jwt()` vs legacy patterns, verify service-role writes emit audit events.

---

# **13\. Billing and Subscription Model**

## **Stripe as Billing Provider**

All subscription billing happens via Stripe. Lyceon uses Stripe for:

* Subscription lifecycle (create, upgrade, downgrade, cancel, reactivate)  
* Payment method management  
* Invoicing and receipts  
* Refunds  
* Dunning and involuntary churn recovery

Lyceon does not build billing primitives. Stripe handles card tokenization, PCI compliance, payment method storage, failed payment retry logic, and regulatory requirements (tax, SCA, etc.).

## **Stripe Customer per Profile**

Each Lyceon profile that enters billing has a Stripe customer created. The Stripe customer ID lives on `profiles.stripe_customer_id`. One Stripe customer per profile, regardless of who pays.

When a guardian pays for a student, the payment is processed through the guardian's payment method but attaches to the student's Stripe customer (the student's `profiles.stripe_customer_id`). The student's subscription is the billing record; the guardian's payment method is the funding source.

## **Subscription Lifecycle**

**Trial → Active:** Students may sign up with a trial period (if marketing offers one). Trial converts to active subscription automatically at trial end unless canceled.

**Active:** Subscription is paid and entitlement is premium.

**Past Due:** Payment failure. Stripe handles retry logic per configured dunning schedule. Entitlement may remain active during grace period (configured per `entitlement_runtime_config.grace_period_days`, directional 7).

**Canceled:** Subscription explicitly canceled. Entitlement transitions to free at the end of the current billing period (not immediately — users keep access they've already paid for).

**Paused:** Stripe-level pause for operational reasons. Rare; used for support-mediated account holds.

## **Payment Methods**

Guardians and students over 18 can add payment methods. Under-18 students cannot add payment methods directly; their guardian adds the method on their behalf.

Payment methods are stored in Stripe; Lyceon never stores card details. Stripe's customer portal handles payment method management UI.

## **Webhook Handling**

Stripe webhooks are processed via `webhookHandlers.ts`. Each webhook event is idempotent — the `stripe_webhook_events` table tracks processed events by ID to prevent double-processing on retry.

Webhook events that affect entitlement (subscription.created, subscription.updated, subscription.deleted, invoice.payment\_succeeded, invoice.payment\_failed) update `entitlements` table and emit audit events.

## **Guardian-Paid-Student Model**

When a guardian pays for a student:

1. Guardian initiates billing via their dashboard (for linked student)  
2. Stripe checkout session created; student is the customer, guardian is the payment source  
3. On successful payment, Stripe creates subscription on student's Stripe customer  
4. `entitlements` table updated: entitlement record for student profile reflects active subscription  
5. Guardian receives receipt; student sees their entitlement flipped to premium  
6. Future renewals charge the guardian's payment method

If the guardian removes their payment method or cancels, Stripe handles dunning. If dunning fails, the student's subscription enters past due and eventually canceled state.

## **Entitlement Flip Timing**

Entitlement state changes with subscription state:

| Stripe Event | Entitlement State | Runtime Effect |
| ----- | ----- | ----- |
| subscription.created (trial) | premium\_trial | User has premium access |
| subscription.created (active) | premium | User has premium access |
| subscription.updated to active | premium | User has premium access |
| invoice.payment\_failed (first) | premium (in grace) | User retains access during grace period |
| invoice.payment\_failed (exhausted retries) | free (past\_due history retained) | User loses premium features |
| subscription.deleted (at period end) | free | Premium access ends at period end, not immediately |
| subscription.deleted (immediate) | free | Premium access ends immediately (admin action, refund, etc.) |

## **Why This Matters**

Billing is where Lyceon gets revenue and users get value transparency. Misroutes here — a canceled user still being charged, a paid user not getting premium access, a guardian-paid student losing access when the guardian hits a card expiry — destroy trust fast and generate support tickets that cost disproportionately.

## **Verification Before Refactor**

Before refactoring billing: inspect `webhookHandlers.ts` for idempotency (UNIQUE on `stripe_webhook_events.id`), verify webhook signature validation, test subscription lifecycle end-to-end in Stripe test mode, audit `profiles.stripe_customer_id` for uniqueness, confirm guardian-paid-student flow handles payment method changes correctly.

---

# **14\. Entitlement Model**

## **Entitlement as Canonical State**

`entitlements` table holds the authoritative entitlement record per profile. Entitlement state answers: is this user premium or free? Is there a grace period in effect? When does the current entitlement window end?

## **Target-State: Entitlement on Profile**

Target-state: `entitlements.profile_id → profiles.id`. One entitlement record per profile. Direct FK; no intermediate account concept.

This is the simplification locked in V6 per CR-02B-26. Profile is already the identity unit (has `stripe_customer_id`). Adding a separate `accounts` abstraction between profile and entitlement was an unnecessary layer that created the dual account system debt.

## **Current-State: Entitlement via Accounts**

Current state: `entitlements.account_id → accounts.id`. The `ensure_account_for_user` RPC creates an `accounts` row and an `account_members` row linking the profile to the account, then creates the entitlements row attached to the account.

This is debt to resolve. The target migration retires `accounts`/`account_members` and links entitlements directly to profile.

## **Entitlement Transitions**

Transitions follow Stripe events (§13). Every transition is atomic:

* Read current entitlement state  
* Apply change (update tier, extend grace, set end timestamp)  
* Write to `entitlements`  
* Emit audit event to `audit_logs`

Application code does not compute entitlement; it reads the current `entitlements` row.

## **Mastery Compute for All Tiers**

Both free and premium profiles have mastery computed per Doc 02C. Entitlement controls **visibility**, not **computation**. Free users accumulate mastery data invisibly; upgrading reveals the accumulated state retroactively.

## **Review Queue Accumulation for All Tiers**

Similarly, both free and premium profiles accumulate review queue entries when they miss practice questions. Free users see no review surface; premium users see their queue. Upgrading a free user reveals the accumulated queue with SM-2 scheduling activated.

## **Entitlement-Gated Features (Canonical List)**

Per Doc 02B §12 entitlement matrix, these features are entitlement-gated:

**Free:**

* Daily practice quota (40 at launch)  
* Static canonical explanation post-submit in practice  
* Single overall score projection (no breakdown)  
* Desmos and formula sheet on math (free for all; not a premium gate)

**Premium:**

* Unlimited practice  
* Interactive tutor (practice post-submit and review pre-submit)  
* Full review with spaced repetition  
* Full-length exams  
* Section-level projection, domain-level mastery breakdown, skill-level mastery, competency map  
* Historical trend data  
* Study calendar

See Doc 02B §12 for the authoritative entitlement matrix.

## **Guardian-Paid Student Entitlement**

Per CR-02B-26 and §13, entitlement for a guardian-paid student lives on the student's profile. Runtime entitlement resolution is profile-scoped regardless of payer. Guardian visibility is separately governed by `guardian_links` (§15).

## **Why This Matters**

Entitlement is the commercial core of Lyceon. Wrong entitlement state means either revenue loss (premium features leaked to free) or user pain (premium user locked out). The single-canonical-entitlement-record rule prevents drift; the "compute for all, show to premium" pattern makes upgrades feel like unlocking rather than migrating.

## **Verification Before Refactor**

Before refactoring entitlement: inspect `entitlements` current table state, verify whether current state links to account or profile (target migration status), confirm all entitlement read paths honor the grace period, audit cross-profile entitlement leaks (a premium profile's access should not affect free profiles), test guardian-paid-student flow end-to-end.

---

# **15\. Guardian Trust and Linkage**

## **Guardian-Student Relationship**

A guardian is linked to one or more students. Lyceon captures this relationship via:

* `guardian_links` — table recording (guardian\_profile\_id, student\_profile\_id) pairs  
* `profiles.guardian_profile_id` — self-reference on student profiles to the guardian's profile  
* `guardian_link_audit` — audit trail of link creation, modification, and deletion

One guardian may be linked to multiple students (multi-child families). One student may have one guardian linked (no multi-guardian for a single student at launch; can be added later if needed).

## **Linking Flow**

**Student-initiated (over-13):**

1. Student navigates to settings → guardian  
2. Student provides guardian's email  
3. System sends guardian an invitation email with link  
4. Guardian clicks link, authenticates (or signs up if new)  
5. Guardian confirms linkage  
6. `guardian_links` row created; `profiles.guardian_profile_id` set on student profile

**Guardian-initiated (over-13 student):**

1. Guardian creates guardian account  
2. Guardian provides student's email or `student_link_code`  
3. System sends student a notification (if student has account) or invitation (if not)  
4. Student accepts link  
5. `guardian_links` row created

**Under-13 student flow:**

1. Under-13 signup requires guardian email at profile creation  
2. Guardian receives consent request via `guardian_consent_requests`  
3. Consent flow completes before student gets any feature access (§17)  
4. On consent, `guardian_links` row created and `profiles.guardian_consent = true`

## **Unlinking Flow**

Either party can initiate unlinking:

* Student → settings → remove guardian (requires password or MFA confirmation)  
* Guardian → dashboard → unlink student (requires password or MFA confirmation)

Unlinking is logged to `guardian_link_audit`. For under-13 students, unlinking without a replacement guardian triggers consent revocation handling (§17).

## **Guardian Profile Role**

Guardian accounts are a distinct role (`profiles.role = 'guardian'`). A guardian profile has:

* Own email and authentication  
* No practice/exam/review capabilities (guardians are not students)  
* Access to guardian dashboard for linked students  
* Ability to manage billing for linked students  
* No direct access to student raw data (aggregate only)

## **Multi-Student Guardians**

A guardian linked to multiple students sees a selector on their dashboard to pick which student's data to view. Each student's data is isolated; guardians cannot see cross-student comparisons beyond what's naturally visible when switching students.

## **Multi-Guardian Students (Future)**

At launch, one guardian per student. Post-launch may support multiple guardians per student (e.g., divorced parents, legal co-guardians). Schema supports this already (`guardian_links` is a many-to-many table); application layer at launch enforces one-guardian constraint.

## **Why This Matters**

Guardian trust is a core promise: parents entrust Lyceon with oversight of their child's learning. Correct guardian-student linkage is the foundation of that trust. Wrong linkage (strangers seeing kids' data, kids unlinked from their guardian without notice) is a trust-destroying event at any scale.

## **Verification Before Refactor**

Before refactoring guardian linkage: inspect `guardian_links` schema, verify `profiles.guardian_profile_id` is kept consistent with `guardian_links` (belt-and-suspenders), audit the unlinking flow for under-13 consent implications, test invitation email deliverability and security (signed tokens, expiration).

---

# **16\. Guardian Visibility and Consent Workflow**

## **Guardian Visibility Scope**

Guardians see **aggregate data only** for linked students. This is a cross-cutting invariant from Doc 00 (INV-02-06) and must not be weakened anywhere in the product.

**What guardians can see:**

* Student's scaled score estimates (overall, section)  
* Mastery level by domain (High/Medium/Low labels, not exact scores)  
* Practice activity summary (sessions per week, hours studied)  
* Exam completion history (scores, not question-level detail)  
* Subscription status and billing history (if guardian is payer)

**What guardians cannot see:**

* Individual question content  
* Student's specific answers (right or wrong)  
* Tutor conversation content  
* Raw mastery deltas or per-question performance  
* Student's message history with tutor  
* Student's journal entries, notes, or personal reflections (if these exist)

## **Guardian Dashboard (Read-Only, Derived)**

The guardian dashboard is fully derived from existing tables. There is no parallel "guardian data" layer. Queries joining `guardian_links`, `profiles`, `student_domain_mastery`, `full_length_exam_score_rollups`, and relevant aggregate views produce dashboard content.

This is a deliberate architectural choice: one source of truth (student's actual state), one query layer that respects visibility rules. No sync issues, no staleness, no drift between "what the student sees" and "what the guardian sees about the student."

## **Consent Workflow (Under-13)**

Under-13 students cannot use Lyceon without explicit guardian consent. The flow:

1. Under-13 student signs up with guardian email  
2. Student profile created with `is_under_13 = true`, `guardian_email = <provided>`, `guardian_consent = false`  
3. System creates `guardian_consent_requests` row with a unique token  
4. Consent email sent to guardian with link containing token  
5. Guardian clicks link, authenticates (or signs up as guardian), reviews Lyceon's data practices, confirms consent  
6. On confirmation:  
   * `guardian_consent_requests.status = 'approved'`, `approved_at` timestamp set  
   * `profiles.guardian_consent = true`, `profiles.consent_given_at` set  
   * `guardian_links` row created  
   * `profiles.guardian_profile_id` set  
7. Student is now feature-accessible

Until consent is granted, the student account exists but has no feature access (practice, review, exams all locked; profile view only).

## **Consent Request Expiration**

Consent request tokens expire after 7 days. If guardian doesn't consent in 7 days:

* Consent request marked expired  
* Student account remains locked  
* Student can request a new consent email  
* After 30 days without granted consent, the student account is flagged for automatic deletion (with notice to the student's email)

## **Consent Revocation**

Guardian can revoke consent at any time via guardian dashboard:

1. Guardian clicks "revoke consent" for the under-13 student  
2. Confirmation prompt requires MFA or password re-entry  
3. On confirm: `profiles.guardian_consent = false`, student account immediately suspended per §17  
4. Audit event logged to `guardian_link_audit` and `audit_logs`

## **Consent Workflow (Over-13)**

For students over 13, guardian consent is not required for account creation or feature access. Guardian linkage is optional — a student may or may not have a linked guardian. If linked, the guardian sees the aggregate dashboard; if not, there is no guardian access.

Guardian linkage for over-13 students is a visibility arrangement, not a consent gate. Over-13 students can unlink a guardian without consent implications.

## **Guardian Consent During Account Deletion**

When a student with guardian linkage requests account deletion (§19):

* During the 7-day grace period, guardian links remain readable  
* Guardian sees "account pending deletion" status on their dashboard for the linked student  
* Guardian can contact support to reverse (student's intent is authoritative; support confirms with student)  
* At T+7, guardian links are deleted along with the rest of the student's data

This is the Q9 C decision: maintain guardian visibility during grace, with a clear "pending deletion" indicator so the guardian can check with the student before irreversible data loss.

## **Why This Matters**

Aggregate-only guardian visibility is the single most important trust rule for minor students. If parents could read their child's tutor conversations or every answer they ever submitted, students would not use Lyceon honestly. The aggregate boundary is what makes the product safe for teenagers. Under-13 consent is legally required (COPPA) and operationally reasonable; the workflow must be clean because any friction here costs signups.

## **Verification Before Refactor**

Before refactoring guardian visibility: audit dashboard queries to confirm aggregate-only, verify no question-level data reaches guardian API responses, test consent workflow end-to-end including expiration and revocation, confirm under-13 student account is fully locked pre-consent and immediately suspended on revocation, verify pending-deletion indicator on guardian dashboard.

---

# **17\. Under-13 Consent and COPPA Compliance**

## **COPPA as Floor, Not Ceiling**

Lyceon's under-13 handling exceeds COPPA minimum requirements. COPPA compliance is the floor. The actual standard is: would a reasonable parent be comfortable with how their child's data is handled? When in doubt, default to stricter.

## **Under-13 State Flags**

On `profiles`:

* `is_under_13` — boolean set at signup based on date of birth  
* `guardian_email` — required for under-13 accounts at signup  
* `guardian_consent` — boolean; false until guardian completes consent  
* `consent_given_at` — timestamp of consent completion

On `guardian_consent_requests`:

* Full consent request lifecycle (pending, approved, expired, revoked)

## **Feature Lock Pre-Consent**

Under-13 student with `guardian_consent = false` has **no feature access**:

* Cannot start practice sessions (all API calls return 403\)  
* Cannot access review, exams, tutor  
* Cannot upgrade to premium  
* Cannot change profile details beyond basic info  
* Can log in and see consent pending status

This is enforced at the application layer: every feature-gated route checks `profiles.is_under_13 AND NOT profiles.guardian_consent` and returns 403 if true.

## **Consent Revocation — Immediate Suspension**

Per Q10 A decision, consent revocation immediately suspends the under-13 student's account:

* All active sessions terminated  
* All feature access revoked  
* Login redirects to consent-pending screen  
* Data remains (not deleted) until resolution — consent re-established or account deleted  
* Guardian is the only party who can resolve (re-consent or initiate deletion)

This is a strict stance because COPPA requires active, ongoing consent. If consent is revoked, data collection must stop immediately. Waiting for a grace period or staged shutdown is not COPPA-compliant.

## **Data Practices Disclosed at Consent**

Consent email and consent screen disclose Lyceon's data practices:

* What data is collected (practice answers, exam responses, tutor interactions, mastery state)  
* How data is used (learning algorithms, analytics, product improvement)  
* Who has access (student, guardian aggregate, Lyceon staff for support)  
* Retention policy (data retained while account active; deleted per §19 on account deletion)  
* No third-party sharing for marketing  
* No sale of data  
* Contact information for questions or complaints

## **Birthday Transition (Under-13 to 13\)**

When an under-13 student turns 13:

* `profiles.is_under_13` transitions to false (automated via daily job reading DOB)  
* Guardian consent state preserved (student's data remains under the consented terms)  
* Student gains normal feature access as over-13  
* Guardian linkage remains unless either party unlinks  
* No re-consent required

## **Why This Matters**

Under-13 handling is both legally required and morally important. Getting it wrong exposes kids to inappropriate data practices, exposes Lyceon to regulatory penalties, and destroys parent trust. Getting it right means some signup friction but produces a product parents can trust with their young children.

## **Verification Before Refactor**

Before refactoring under-13 handling: audit all feature-gated routes for the under-13-without-consent check, verify consent request expiration and cleanup (no orphaned pending consents), test consent revocation for immediate suspension, confirm birthday transition handling (daily job exists and runs correctly), inspect consent email content for COPPA compliance.

---

# **18\. Role Switching**

## **What Roles Can Switch**

Per Q11, V6 documents all possible role transitions:

| From | To | Supported | Method | Notes |
| ----- | ----- | ----- | ----- | ----- |
| student | guardian | Yes | Support-mediated | Common: student turns 18, becomes own guardian, wants to use own account to supervise a sibling or child |
| guardian | student | Yes | Support-mediated | Common: guardian wants to take SAT themselves using existing account |
| student | admin | No | N/A | Admin accounts are admin-created only |
| student | tutor/teacher | No | N/A | Tutor/teacher accounts are admin-created only |
| guardian | admin | No | N/A | Admin accounts are admin-created only |
| guardian | tutor/teacher | No | N/A | Admin-created only |
| admin | student/guardian | Yes | Support-mediated \+ admin approval | Rare; usually staff leaving company |
| tutor/teacher | student | Yes | Support-mediated \+ admin approval | Rare |
| Multi-role same account | N/A | No | Users with multiple roles maintain separate accounts |  |

## **The Rule**

Role switching is support-mediated at launch, not self-service. Users request role switches via profile/settings; the request pre-drafts an email to support (`support@lyceon.ai`); support processes the request after verifying identity and appropriate conditions.

## **Why Support-Mediated**

Self-service role switching has significant failure modes:

* A compromised student account could escalate to admin  
* A guardian who wants to become a student might have historical guardian-link obligations to clean up  
* Role changes have tax and billing implications for paid accounts  
* Role changes need audit trail beyond what typical user actions receive

Support-mediated lets humans handle the edge cases at launch. Post-launch, high-frequency transitions (student ↔ guardian, especially at the 18th birthday transition) may become self-service with appropriate safeguards.

## **Request Flow**

1. User navigates to profile/settings → change role  
2. User selects target role and reason  
3. System generates pre-drafted email with user context and request details  
4. User sends email to support  
5. Support receives request; verifies identity via existing support channel (MFA, security questions)  
6. Support verifies conditions:  
   * For student → guardian: any active paid subscriptions on the student account? Guardian linkages?  
   * For guardian → student: any linked students? How are they handled?  
   * For admin → any: admin approval required in addition  
7. Support approves or rejects; communicates decision to user  
8. On approval: admin action updates `profiles.role` via `profile-service.ts`; audit event logged to `audit_logs`  
9. User receives confirmation email; next login reflects new role

## **Data Implications**

Role transitions don't automatically migrate data. A student-turning-guardian keeps their practice history, mastery, and exam results as historical data (they may or may not see it in the guardian UI; depends on product decision). A guardian-turning-student starts as a fresh student with no prior history.

Support may assist in data handling per user preference.

## **18th Birthday Transition (Common Case)**

Under-13 students who reach 13 simply have `is_under_13` flip to false (§17). They don't change role.

Over-13 students who reach 18 may want to become their own guardian or remain as a student. This is a user choice:

* If the student had a linked guardian, that linkage can remain or be dissolved  
* If the student wants to add themselves as a guardian (for their own future purposes), they request role switch  
* Default: no change. Student remains student.

## **Why This Matters**

Role is a high-leverage attribute. A role switch can expose or lock features, change billing responsibility, change visibility rules. Support-mediation at launch prevents entire categories of bugs (accidental switches, unauthorized escalations, data loss from misconfigured transitions). Post-launch, the most common transitions become self-service once patterns are clear.

## **Verification Before Refactor**

Before refactoring role switching: audit current role-switch request handlers, verify no self-service role changes are possible, test admin approval flow for role-switch requests, confirm audit events include enough context to reverse a problematic switch.

---

# **19\. Account Deletion and Soft-Delete Lifecycle**

## **Deletion Request Flow**

Users can request account deletion via profile/settings. The flow:

1. User clicks "delete my account" in settings  
2. Confirmation prompt explains consequences: 7-day soft-delete window, premium subscription cancels at T+7 (not immediately), guardian links pending-deletion status, data anonymization at T+7  
3. User confirms (requires password or MFA)  
4. `account_deletion_requests` row created with status='pending', `scheduled_delete_at = now() + 7 days`  
5. `profile-service.ts` marks profile with deletion state  
6. Notification email sent to user confirming deletion request and recovery window

## **Seven-Day Grace Period**

During the 7-day grace period:

* User can log in and use the product normally (full feature access preserved)  
* Premium subscription remains active; billing continues per Stripe schedule  
* User can cancel the deletion request via settings (returns to normal)  
* Guardian sees "pending deletion" on their dashboard if linked  
* No automated cleanup or data mutation

The grace period is deliberately generous to prevent accidental deletion (rage-deletes, confused clicks). Most users who change their mind do so within a day or two.

## **T+7 Hard Delete**

At T+7 (scheduled\_delete\_at reached), the hard-delete process runs:

1. **Entitlement cancellation.** Active Stripe subscription canceled immediately. Premium entitlement transitions to free. Per Q8 decision: entitlement hard-deletes at T+7, not at deletion request. This gives users access during their final grace period (they paid for it; they get it).

2. **Data anonymization.** `deidentify_user` RPC runs. Personal identifiers (email, name, phone, DOB, address) are replaced with anonymized placeholders. Question responses, mastery state, and activity history are preserved as anonymized data (retained for analytics, fully detached from identity).

3. **Guardian link deletion.** `guardian_links` rows deleted. If this was an under-13 student's only guardian link, the remaining anonymized profile is still deleted (no orphaned under-13 data).

4. **Session termination.** All active sessions terminated. Refresh tokens invalidated.

5. **Stripe customer handling.** Stripe customer is preserved (may have historical invoice/receipt needs) but marked as deleted in Stripe. Card details already deleted from Stripe-side tokenization.

6. **Audit event.** Final deletion event logged to `audit_logs` with full context.

7. **Profile marked deleted.** `profiles` row may be preserved in anonymized form or fully deleted depending on data retention policy (future determination).

## **Recovery Within Grace**

User cancels deletion request:

1. User navigates to settings and sees pending-deletion banner  
2. User clicks "cancel deletion"  
3. Confirmation prompt  
4. On confirm: `account_deletion_requests.status = 'canceled'`, `profiles` deletion state cleared  
5. User returns to normal state; guardian pending-deletion indicator removed

## **Recovery After T+7 (Impossible)**

After T+7, deletion is irreversible. The anonymized profile cannot be re-identified. Users who regret the deletion must create a new account and start fresh.

## **Guardian-Initiated Deletion (Under-13)**

For under-13 students, guardians may initiate deletion on the student's behalf:

1. Guardian navigates to guardian dashboard for the student  
2. Guardian clicks "delete student account"  
3. Same 7-day flow applies  
4. Student receives notification (to student's email)  
5. At T+7, student account deleted

This is a legal and practical requirement for COPPA compliance — parents must be able to remove their child's data.

## **Admin-Initiated Deletion**

Admins can initiate deletion for accounts via admin UI. Same 7-day flow applies unless marked as emergency (in which case immediate deletion, no grace). Emergency deletion is used only for legal or safety reasons (court order, abuse investigation, etc.) and requires admin approval \+ audit trail.

## **Why This Matters**

Deletion is user sovereignty. Users must be able to remove their data, predictably and completely. The 7-day grace prevents accidents. The T+7 entitlement cancellation respects that users paid for access through the current period. The anonymization preserves data utility (analytics, research) without preserving identity (privacy).

## **Verification Before Refactor**

Before refactoring deletion: inspect `account_deletion_requests` for proper lifecycle, verify `deidentify_user` RPC correctly anonymizes all PII fields, test guardian-initiated deletion flow, audit the T+7 scheduled job runs on schedule and is idempotent (doesn't double-delete), confirm grace-period cancellation actually reverts deletion state cleanly.

---

# **20\. Password Reset and Account Recovery**

## **Password Reset (Self-Service)**

Password reset uses Supabase-managed flows:

1. User clicks "forgot password" on login  
2. User enters email  
3. Supabase sends password reset email with signed link (short TTL, configurable via Supabase)  
4. User clicks link, enters new password  
5. Supabase updates password hash; session state unaffected (user is logged in if they reset from logged-in state; prompted to log in if reset from logged-out state)  
6. Audit event logged

Email template is custom (Supabase dashboard-level custom SMTP per V5 decision). Email content reinforces security (verifies the reset came from the user, mentions Lyceon branding, provides contact info for concerns).

## **Account Recovery (MFA Lost)**

If user has lost their MFA device and cannot complete MFA challenge:

1. User initiates recovery via login screen's "lost MFA device" link  
2. User verifies identity via email (confirmation link)  
3. User provides additional verification per security questions (or phone if SMS is eventually supported as fallback — not at launch)  
4. Support ticket created for manual review if additional verification fails  
5. On success, MFA factors reset; user must re-enroll MFA per §11 rollout policy

This is deliberately not fully self-service because MFA recovery is the highest-leverage exploit path. Phishers and social engineers target MFA recovery flows. Slower, multi-step verification at launch is safer than convenient self-service.

## **Account Lockout**

After 5 failed login attempts (configurable via `auth_runtime_config.failed_login_lockout_threshold`, directional 5):

* Account is soft-locked for 15 minutes (`auth_runtime_config.lockout_duration_minutes`)  
* User sees "too many failed attempts" message  
* Locked state does not prevent password reset (user can still recover via email)

## **Email Change**

Changing email is a security-sensitive operation:

1. User initiates email change in settings  
2. User provides new email  
3. Lyceon sends verification email to new address  
4. User clicks verification link from new email  
5. Lyceon sends notification email to old address (security notice)  
6. If no objection from old email within 24 hours, email change completes  
7. Audit event logged

Old email can initiate cancellation of the change within 24 hours if it wasn't them.

## **Support-Mediated Recovery**

Some recovery scenarios require support:

* User lost access to both password AND email (no self-service possible)  
* User's account is compromised and they can't regain control  
* User's MFA is lost and self-service recovery fails  
* Suspicious activity flagged on the account

Support-mediated recovery requires identity verification beyond the account (e.g., billing details, answers to historical security questions, government ID in extreme cases). Details of the support process are operational (see §21).

## **Why This Matters**

Recovery flows are where attackers probe. Weak recovery means the strongest MFA is moot — if an attacker can trick the recovery flow, they bypass MFA. Lyceon's staged recovery (self-service for common cases, support-mediated for edge cases) balances convenience against security.

## **Verification Before Refactor**

Before refactoring recovery: inspect password reset email content and TTL, verify lockout threshold and duration are configured, test MFA lost-device flow end-to-end, audit email-change notification path (old address notification is critical), confirm support-mediated recovery has documented runbook.

---

# **21\. Support-Mediated Operations**

## **When Support is Required**

Some operations are support-mediated at launch:

* Role switching (§18)  
* Account recovery for complex cases (§20)  
* Emergency account actions (legal holds, abuse reports)  
* Data export requests (for compliance or user request)  
* Billing disputes and refunds beyond Stripe customer portal  
* Account merges (rare; typically when a user accidentally created multiple accounts)

## **Support Email**

All user-initiated support flows direct to `support@lyceon.ai`. The profile/settings UI pre-drafts emails with relevant user context (user ID, account state, request type) to minimize back-and-forth.

## **Support Authentication**

Users reaching out to support must authenticate their support request. Methods:

* Pre-drafted email from within the app (authenticated session verified the sender is the account holder)  
* Security question answers for out-of-band requests  
* MFA challenge via email for high-sensitivity actions

## **Admin Actions and Audit**

Every admin action affecting a user account is audited. `audit_logs` entries include:

* Admin user ID  
* Target profile ID  
* Action type  
* Before/after state  
* Reason (free text)  
* Timestamp

Admin accesses student data only for specific support purposes. Blanket student-data browsing is not an admin action — it would require separate policy.

## **Role Switch Approval**

Role switches (§18) flow through support. Support agent:

1. Verifies user identity (MFA, security questions)  
2. Reviews request conditions (active subscriptions, linkages, etc.)  
3. For admin-level role changes, escalates to CTO approval  
4. On approval, uses admin UI to trigger role change via `profile-service.ts`  
5. Confirms via email to user

## **Why This Matters**

Support-mediation for sensitive operations is a deliberate layer of human judgment. Automated flows can be exploited; humans add friction that exploits struggle with. Post-launch, high-volume support flows can be automated once patterns are clear.

## **Verification Before Refactor**

Before refactoring support operations: audit admin action audit trail for completeness, verify every role-switch goes through canonical writer, confirm no direct DB access patterns for support (all operations should be via admin UI which uses services), test support email deliverability.

---

# **22\. Security and Audit**

## **Defense in Depth**

Identity security operates at multiple layers:

* **Supabase Auth:** session tokens, password hashing, JWT validation, refresh tokens  
* **MFA:** second factor for MFA-enrolled users (§11)  
* **RLS:** row-level authorization at DB  
* **Application-layer:** entitlement checks, rate limits, role validation  
* **Audit:** immutable log of all security-relevant events  
* **Monitoring:** anomaly detection (unusual login patterns, high failure rates, etc.)

Each layer is independently sufficient for most threats; combined, they cover threats any single layer misses.

## **Audit Scope**

Events audited to `audit_logs`:

* Authentication: login (success and failure), logout, MFA challenge (success and failure)  
* Authorization: role checks failing with reason, entitlement checks  
* Profile mutations: every write via `profile-service.ts`  
* Guardian: linkage creation/deletion, consent changes  
* Billing: entitlement transitions, subscription changes  
* Account lifecycle: deletion request, deletion finalization  
* Admin actions: any admin-initiated change to another user's state  
* Security-relevant: failed MFA, password changes, email changes

`system_event_logs` captures non-user-specific system events (deploys, migration runs, etc.). `audit_logs` FK still points to legacy `users.id`; migration to `profiles.id` is Doc 01 debt.

## **Audit Query Patterns**

Audit logs are queryable by admin for:

* User's login history  
* Account state changes over time  
* Actions by a specific admin  
* Suspicious patterns (many failed logins, role changes, etc.)

Audit logs are append-only. No editing or deletion. Retention policy TBD (directional: 7 years for compliance, anonymized for inactive users after 90 days).

## **Rate Limiting**

Rate limits at the application layer:

* Login attempts per account (per §20 lockout)  
* Login attempts per IP (per hour)  
* Password reset requests per account  
* Guardian consent request retries per student  
* MFA challenge attempts  
* Role switch requests

Limits live in `auth_runtime_config` (§23).

## **Anomaly Detection**

Post-launch, anomaly detection for:

* Logins from unusual locations  
* Unusual billing patterns (rapid upgrade/downgrade)  
* Mass role change requests  
* Unusual support request patterns

At launch, basic monitoring only; advanced anomaly detection is post-launch.

## **Why This Matters**

Security at the identity layer is the last line of defense. Audit logs let us investigate incidents after the fact; rate limits prevent brute-force attacks; anomaly detection catches novel patterns. Without these, a breach could be silent and persistent.

## **Verification Before Refactor**

Before refactoring security: audit current audit log coverage (are all sensitive events logged?), verify rate limiting is implemented for identified surfaces, test MFA lockout for edge cases, confirm audit log migrations from `users` FK to `profiles` FK are planned.

---

# **23\. Constants Doctrine**

## **Principle**

All identity-and-access-affecting constants live in DB configuration tables. No magic numbers in runtime code. This is the cross-cutting constants doctrine per Doc 02B §33 and INV-02B-15, extended to identity and access.

## **Domain-Specific Tables**

Identity/access constants live in domain-specific tables following the `mastery_constants`/`kpi_constants` pattern:

* `auth_runtime_config` (proposed) — MFA policy, lockout thresholds, session TTLs  
* `consent_runtime_config` (proposed) — under-13 consent expiration, grace periods  
* `entitlement_runtime_config` (proposed) — grace period for past due, entitlement transition delays  
* `account_deletion_runtime_config` (proposed) — 7-day grace period, retention policy parameters

See Appendix A for the full catalog.

## **Governance**

Per Doc 02B §33:

* Owners: Product for product-policy constants; Engineering for technical (timeouts, lockouts); Security for security-related constants (MFA enforcement timelines)  
* Bounds defined; min/max prevent misconfiguration  
* Descriptions required  
* Changes audited  
* Environment parity

## **Change Effective-Windows**

* Lockout threshold changes: effective immediately for new lockouts  
* MFA enforcement timeline changes: effective for new enrollments; existing users grandfathered until their current deadline  
* Grace period changes: effective for new deletion requests; existing pending deletions honor original grace

## **Why This Matters**

Identity constants should be tunable operationally without code deploys. Marketing wants to test a shorter MFA grace period? Config change. Security wants to lower the lockout threshold? Config change. The doctrine applies across all runtime layers, not just 02B.

## **Verification Before Refactor**

Verify current magic numbers in identity/access code, plan migration of hardcoded values to DB, confirm CI enforcement catches new magic numbers.

---

# **24\. Failure Modes**

| Failure | Expected Response |
| ----- | ----- |
| Login with wrong password | Return generic error; increment failed count; lockout at threshold |
| Login during account lockout | Return lockout message with time remaining |
| MFA challenge failure | Return MFA error; increment failed count; support-mediated recovery after threshold |
| Auth token expired mid-request | Return 401; client refreshes via refresh token or re-authenticates |
| Session hijack suspected | Invalidate session; require re-auth \+ MFA |
| Email verification token expired | Request user to re-send verification |
| Password reset token expired | Request user to re-initiate reset |
| OAuth callback failure | Return user to signup/login with error; no partial state |
| Consent email delivery failure | Retry; after persistent failure, flag for support |
| Guardian consent request expires (7 days) | Student account remains locked; student can request new consent |
| Guardian revokes consent mid-session | Immediately terminate all student sessions; account suspended |
| Stripe webhook signature invalid | Return 401; log incident; do not process |
| Duplicate Stripe webhook | Idempotency check via `stripe_webhook_events.id`; return success without double-processing |
| Entitlement read during write lock | Read last-committed state; application layer tolerates stale reads briefly |
| Profile update race condition | Canonical writer serializes; retry with backoff |
| Role resolution fails (no profile row) | Return 500; page ops; should be impossible with correct signup flow |
| Account deletion during grace — subscription expires naturally | Entitlement transitions to free at subscription end; deletion still processes at T+7 |
| Account deletion grace — user attempts to re-subscribe | Allow; subscription activates; user may cancel deletion request |
| Cross-profile RLS violation attempt | RLS blocks at DB; row not returned; no error exposed to user |
| Guardian link deletion during active session | Student's features continue until session ends; guardian dashboard loses access |
| Under-13 birthday transition — is\_under\_13 flip fails | Batch job retries; eventual consistency acceptable (user unaffected by 1-day delay) |
| MFA device lost, recovery fails | Support ticket; manual identity verification; MFA reset on approval |
| Password reset while logged in from another device | Both sessions remain valid until token expiry; user can force-logout all sessions via settings |
| Multi-device concurrent login | Allowed by default; exam-integrity concurrent control per Doc 02B §17 |
| Account deletion — guardian tries to initiate after student is over 18 | Rejected; over-18 students self-manage deletion |

## **Why This Matters**

Failure mode documentation is operational contract. Every identity-related incident has an expected response. Without documented responses, support agents and on-call engineers improvise — producing inconsistent user experience and sometimes incorrect behavior.

---

# **25\. Observability**

## **Metrics**

* **Authentication:** login success rate, MFA challenge success rate, failed login rate per IP  
* **Signup funnel:** signup initiation, email verification, consent completion (under-13), profile completion  
* **Guardian workflow:** consent request sent, consent granted rate, consent expiration rate  
* **Billing:** subscription creation rate, upgrade rate, cancel rate, past due resolution rate  
* **Account deletion:** deletion requests, recovery rate, T+7 completions  
* **MFA enrollment:** new enrollments per day, factor type distribution, adoption rate per role  
* **Role switching:** requests per week, approval rate, time to resolution

## **Alerts**

* Authentication failure rate \>5% over 15min — possible attack or system issue  
* MFA enrollment failure rate above threshold  
* Stripe webhook failure or signature failures  
* Consent email delivery failure spike  
* Abnormal account deletion requests (potential abuse or mass action)  
* Role change request anomaly

## **Audit Log Querying**

Operations can query `audit_logs` by user, time range, action type. Security reviews examine admin action patterns, consent revocations, failed authentication clusters.

## **Why This Matters**

Identity observability is the early warning system. Attack patterns, billing issues, and consent workflow problems all show up in metrics first, long before they become support volumes.

---

# **26\. CI / Testing Standards**

## **Required Test Coverage**

* Signup end-to-end for each role (student, guardian, under-13 student, admin-created tutor/teacher)  
* Login with each auth method (email/password, magic link, Google OAuth)  
* MFA enrollment and challenge for TOTP  
* Password reset flow  
* MFA recovery flow  
* Guardian consent workflow end-to-end (invitation, consent, revocation)  
* Under-13 feature lock pre-consent  
* Under-13 consent revocation — immediate suspension  
* Role switching — support-mediated admin action  
* Account deletion — 7-day grace and T+7 cleanup  
* Account deletion — grace cancellation  
* Entitlement transitions on subscription events  
* Guardian-paid-student billing flow  
* Canonical writer enforcement — `profile-service.ts` is the only path for profiles writes  
* Magic number prohibition — CI static analysis catches new hardcoded identity constants

## **Coverage Thresholds**

* ≥95% on authentication code paths  
* ≥95% on consent workflow  
* ≥90% on canonical writer  
* ≥90% on entitlement transition code  
* ≥85% on account deletion lifecycle  
* ≥80% overall identity/access code

## **Integration Tests**

End-to-end against Supabase test project, not production. Scenarios include full signup-through-upgrade-through-deletion user lifecycle, guardian consent for under-13, admin-initiated role change, MFA enrollment and challenge across multiple factor types.

## **Regression Tests**

Known-good scenarios: specific user lifecycle with expected state at each step, specific guardian consent flow, specific billing transition, specific deletion lifecycle.

## **Why This Matters**

Identity code is touched rarely but failures are catastrophic. Comprehensive test coverage compensates for the low touch frequency. Canonical writer enforcement via CI prevents regression.

---

# **27\. Known Architectural Debt**

## **Multi-Writer on `profiles` — Q3/Q7 resolution: consolidate to `profile-service.ts`**

Five current writers: `profile-service.ts`, `profile-bootstrap.ts`, `guardian-routes.ts`, `guardian-consent-routes.ts`, `profile-routes.ts`, `supabase-auth-routes.ts`. Consolidation plan in §9. Owner: Doc 01 scope. Resolution: migration in 6 phases.

## **Dual Account System — `accounts`/`account_members` vs target profile-direct**

Current state: `ensure_account_for_user` RPC writes to legacy `accounts`/`account_members`. Target: entitlement directly linked to profile. Migration plan:

1. Add `entitlements.profile_id` column (nullable initially)  
2. Backfill `entitlements.profile_id` from existing account\_members linkages  
3. Update entitlement reads to prefer profile\_id when present, fall back to account path  
4. Refactor `ensure_account_for_user` RPC or replace with `ensure_entitlement_for_profile` that writes direct  
5. Drop `account_id` from `entitlements`; drop `accounts` and `account_members` tables  
6. Drop stale policies referencing legacy tables

Owner: Doc 01 scope.

## **Wave 1 FKs to `users.id`**

`attempts`, `audit_logs`, `chat_messages` still FK to legacy `users`. Migration to `profiles` is coordinated with Wave 1 table deprecation (these tables are themselves legacy). Owner: Doc 01 \+ DBA.

## **Duplicate `updated_at` on `profiles`**

`profiles` has both `updated_at` and `_updated_at` columns. Drop one. Owner: DBA / migration.

## **Double `updated_at` Triggers on `usage_daily`**

Two `updated_at` triggers on the table. Drop one. Owner: DBA.

## **`lyceon_accounts` / `lyceon_account_members` Potentially Orphaned**

Has RLS policies but may not receive writes via `ensure_account_for_user` (which writes to legacy `accounts`). Investigate and either:

* Migrate ensure\_account\_for\_user to write lyceon\_\* and retire legacy accounts  
* Drop lyceon\_\* as dead code

Owner: Doc 01 \+ DBA.

## **Admin Check Inconsistency**

Some policies use `EXISTS (SELECT 1 FROM users WHERE is_admin=true)` instead of canonical `is_admin_jwt()`. Standardize on `is_admin_jwt()`. Owner: DBA / migration.

## **`public.question_embeddings` Security Leak**

Per Doc 02B §32 and CR-02B-27. Runtime uses `public.question_embeddings` with RLS disabled. Target: migrate to `copilot.question_embeddings`, delete public variant. Owner: Runtime team \+ Security. Doc 02B tracks.

## **Cross-Domain Writes**

Per Doc 02B §34. Routes like `account-deletion-routes` writing to `entitlements`, `notification-routes` duplicating `notification-authority`, etc. Consolidation is Doc 05 scope. Doc 01 acknowledges but doesn't resolve.

## **Why This Matters**

Known debt is manageable debt. Silent debt becomes the incident. Cataloging debt items with owners and resolution paths makes them actionable.

---

# **28\. Change Control**

Meaningful changes to identity/access behavior follow Doc 00 change control:

1. Proof of current behavior from inspection  
2. Proposed replacement  
3. Migration plan  
4. Rollback path  
5. Success metrics  
6. Changelog record

Cross-file changes, invariant changes, and structural scope changes require Founder \+ CTO approval.

High-risk changes (authentication, authorization, consent workflow, entitlement transitions, canonical writer enforcement, role switching logic) require Founder \+ CTO approval regardless of apparent scope.

---

# **29\. Verification Before Refactor Checklist**

Before any refactor of components described here, gather proof from the actual system:

## **Identity**

* Current `profiles` schema, column set, constraints  
* FK targets using legacy `users` still in place  
* Identity write paths (should be 5 currently; target 1\)  
* RLS policies on `profiles`

## **Authentication**

* Supabase Auth configuration (session TTL, email templates, MFA factor types enabled)  
* OAuth provider configuration  
* Email deliverability for verification/reset/consent

## **MFA**

* `auth.mfa_factors` usage patterns  
* MFA enrollment rates by role  
* MFA enforcement logic (role-based, timeline-based for students/guardians)

## **Authorization**

* RLS policies for canonical pattern adherence  
* Application-layer entitlement checks  
* Admin check function (`is_admin_jwt()` vs legacy)  
* Audit log coverage

## **Billing**

* Stripe customer IDs on profiles  
* `entitlements` schema and FK target (account vs profile — target migration status)  
* Webhook idempotency via `stripe_webhook_events`  
* Guardian-paid-student end-to-end

## **Guardian**

* `guardian_links` consistency with `profiles.guardian_profile_id`  
* Consent workflow tables (`guardian_consent_requests`) lifecycle  
* Consent email deliverability  
* Under-13 feature lock enforcement

## **Deletion**

* `account_deletion_requests` lifecycle  
* `deidentify_user` RPC correctness  
* 7-day scheduled job for T+7 deletions  
* Grace period cancellation

## **Support**

* Role switch request handling  
* Support email pre-drafting  
* Admin action audit completeness

Only after gathering this should a refactor proposal include verified current state, target state, migration path, rollback.

---

# **30\. Cross-Document Dependencies**

## **Governed By**

* **Doc 00** — Platform-level invariants

## **Depends On**

* Supabase Auth (external dependency)  
* Stripe (external dependency)  
* Coding Standards — TypeScript, Zod, logging, testing

## **Depended On By**

* **Doc 02A** — Content access gating (authenticated-read at MVP per CR-02B-18)  
* **Doc 02B** — Runtime engines read identity, role, entitlement; consume the entitlement model defined here  
* **Doc 02C** — Mastery attribution uses profile-scoped events; respects guardian visibility rules  
* **Doc 03** — Future tutor doc respects entitlement boundaries and surface-aware behavior defined jointly with Doc 02B  
* **Doc 04** — Calendar respects student role and entitlement  
* **Doc 05** — Growth/marketing surfaces respect all identity rules (no leaking minor data in public spaces)

## **Why This Matters**

Every document in the Lyceon spec suite depends on correct identity handling. Changes here cascade. Explicit dependency listing prevents orphaned contract changes.

---

# **31\. Final Principles**

Lyceon's identity and access layer is the floor of product trust. Every guarantee the product makes — accurate mastery, honest exam scores, correct billing, safe experience for minors — rests on identity being correct.

That's why the invariants in this document are uncompromising:

* **Profiles are canonical**, because one identity per user is the only way to make downstream systems work  
* **Role is server-resolved**, because trusting the client with role is handing users root  
* **Single writer for profiles**, because multi-writer identity tables are bug farms  
* **MFA for staff at launch**, because compromised staff accounts are catastrophic  
* **Aggregate-only guardian visibility**, because minors need private space for honest learning  
* **Under-13 consent before features**, because COPPA compliance is a floor and doing less is illegal  
* **Immediate suspension on consent revocation**, because active consent is required at all times  
* **7-day deletion grace**, because users deserve reconsideration time  
* **T+7 irreversible**, because users deserve to actually be deleted when they request it  
* **Support-mediated role changes**, because role changes have implications that automated flows miss  
* **Everything audited**, because investigation after the fact requires a trail  
* **Constants in DB**, because tuning without deploy is operational power

Identity is invisible when right, catastrophic when wrong. Lyceon is uncompromising on invisibility.

---

# **32\. Change Records**

## **CR-01-01**

**Previous Rule:** Identity canonical unclear; dual `users` / `profiles` tables treated ambiguously. **Updated Rule:** `profiles` is canonical. `users` deprecated; remaining Wave 1 FKs flagged as debt. **Why:** Schema audit confirmed `profiles` is new canonical with `auth.uid()` mapping; `users` is Wave 1 fossil. **Build Impact:** All runtime identity reads use `profiles.id` and `profiles.role`. Wave 1 FKs to `users` scheduled for migration.

## **CR-01-02**

**Previous Rule:** Multi-writer pattern on `profiles` table implicit. **Updated Rule:** `profile-service.ts` is the sole canonical writer for `profiles`. Five-writer current state flagged as debt; consolidation plan in 6 phases. **Why:** Consistency, auditability, atomicity, testability. **Build Impact:** All profile writes migrate to service; CI enforces no direct `profiles` writes outside service.

## **CR-01-03**

**Previous Rule:** Entitlement linked to account (Option B per V5). **Updated Rule:** Target-state: `entitlements.profile_id → profiles.id`. Account abstraction removed. Current state (legacy `accounts`/`account_members` via RPC) flagged as debt per CR-02B-24 and CR-02B-26. **Why:** Simplification. Profile is already identity+billing unit. Separate account tables are unnecessary indirection. **Build Impact:** Migration plan: add profile\_id column, backfill, migrate reads, retire accounts. RPC `ensure_account_for_user` retired or refactored.

## **CR-01-04**

**Previous Rule:** MFA rollout unspecified or loose. **Updated Rule:** Admin/tutor/teacher require MFA at launch. Student/guardian encouraged at signup; required within 14 days or before billing action. **Why:** Staff accounts are high-leverage attack targets. Student/guardian friction staged to balance signup conversion. **Build Impact:** MFA enforcement check in auth middleware; 14-day timer tracked; billing-action gate enforces MFA.

## **CR-01-05**

**Previous Rule:** Under-13 consent handling unspecified or loose. **Updated Rule:** Under-13 accounts are feature-locked until guardian consent granted. Consent revocation immediately suspends account. COPPA compliance is floor, not ceiling. **Why:** Legal requirement and moral obligation. **Build Impact:** Every feature-gated route checks `is_under_13 AND NOT guardian_consent`. Revocation flows trigger immediate session termination.

## **CR-01-06**

**Previous Rule:** Guardian visibility scope fuzzy. **Updated Rule:** Aggregate-only; question-level data never surfaces to guardian. Dashboard derived entirely from existing tables. No parallel "guardian data" layer. **Why:** Minors need private space for honest learning. Aggregate is both privacy-respecting and informative for parents. **Build Impact:** Audit all guardian-accessible queries for aggregation; no raw question/answer data in any guardian-accessible surface.

## **CR-01-07**

**Previous Rule:** Account deletion timing unclear. **Updated Rule:** 7-day grace period. Hard delete at T+7 includes entitlement cancellation (per Q8). Grace allows user to cancel and return to normal. During grace, guardian sees "pending deletion" indicator (per Q9). **Why:** 7-day grace prevents accidents. T+7 entitlement gives users access they paid for. Pending indicator lets guardian notice and verify. **Build Impact:** Scheduled job at T+7; `deidentify_user` RPC runs; guardian dashboard shows pending status during grace.

## **CR-01-08**

**Previous Rule:** Role switching via support-email flow. **Updated Rule:** All role transitions documented (student ↔ guardian main; admin/tutor/teacher admin-only). Support-mediated at launch. Pre-drafted email from settings includes context. **Why:** Role changes have billing, guardian, data implications; human judgment at launch prevents automated exploits. **Build Impact:** Settings page surfaces pre-drafted emails; admin UI for support to execute role changes via `profile-service.ts`.

## **CR-01-09**

**Previous Rule:** Audit logging scattered or implicit. **Updated Rule:** Every identity-relevant event audited to `audit_logs`. Scope defined: auth events, MFA events, profile mutations, billing transitions, deletion lifecycle, admin actions. FK migration from `users` to `profiles` pending (Wave 1 debt). **Why:** Audit trail is required for incident investigation, compliance, and debugging. **Build Impact:** All sensitive operations emit audit events; audit log schema extended as needed; retention policy defined.

## **CR-01-10**

**Previous Rule:** Identity constants hardcoded. **Updated Rule:** All identity/access constants live in DB per cross-cutting constants doctrine (INV-02B-15 extended to Doc 01 scope). Domain-specific tables: `auth_runtime_config`, `consent_runtime_config`, `entitlement_runtime_config`, `account_deletion_runtime_config`. **Why:** Operational tunability. Security response faster. Audit trail on changes. **Build Impact:** New config tables; runtime reads; CI enforces no magic numbers in identity/access code.

## **CR-01-11**

**Previous Rule:** Guardian-paid-student relationship unclear. **Updated Rule:** Entitlement lives on student's profile regardless of payer. Guardian pays via their payment method attached to student's Stripe customer. Guardian visibility separately governed by `guardian_links`. **Why:** Runtime entitlement is profile-scoped. Payment flow distinct from visibility flow. Clean separation. **Build Impact:** Stripe customer per profile; guardian-initiated checkout attaches payment method to student customer; subscription on student's customer.

## **CR-01-12**

**Previous Rule:** V5 Option B "each account owns its own entitlement." **Updated Rule:** V6 supersedes: each profile owns its entitlement. Account concept retired at target state. **Why:** Simplification unlocks cleaner migration and removes dual-account debt. **Build Impact:** Major migration (per CR-01-03). Doc 01 target state is canonical for future; current state is debt.

---

# **33\. Worked Examples**

## **Example One: Under-13 Student Signup with Guardian Consent**

A 12-year-old signs up on the Lyceon homepage.

**Signup.** User provides email, password, date of birth. System detects age \< 13\. Signup form asks for guardian email.

**Profile creation.** Supabase creates `auth.users` row. `profile-service.ts` creates `profiles` row: `is_under_13=true`, `guardian_email=parent@example.com`, `guardian_consent=false`, `role='student'`.

**Feature lock.** User lands in app; sees consent-pending screen. All feature routes return 403 for this user.

**Consent email.** System creates `guardian_consent_requests` row with signed token. Email dispatched to `parent@example.com` with link.

**Guardian consent flow.** Parent receives email, clicks link (token validated), signs up as guardian (or authenticates if existing account). Reviews Lyceon data practices. Confirms consent.

**Consent completion.** Transaction:

* `guardian_consent_requests.status='approved'`, `approved_at=now()`  
* `profiles.guardian_consent=true`, `consent_given_at=now()`  
* `guardian_links` row created (guardian\_profile\_id, student\_profile\_id)  
* `profiles.guardian_profile_id` set on student's profile  
* Audit events written to `guardian_link_audit` and `audit_logs`

**Student unlock.** Student refreshes; feature-gate check now passes. Student can start practice.

**Guardian dashboard.** Parent logs in, sees their dashboard with the under-13 student linked. Aggregate data visible: "Child has completed 8 practice questions this week, overall mastery Low."

## **Example Two: 18th Birthday — Role Switch Decision**

A student turns 18\. Their guardian has been linked since age 12\.

**Birthday transition.** Daily job detects DOB transition. No change to role; `is_under_13=false` transition happened at age 13 already.

**Student's options:**

* Keep everything as-is: remain student, guardian remains linked with aggregate visibility.  
* Unlink guardian: student decides they want privacy. Navigates to settings → guardian → unlink. MFA challenge; on confirm, link removed.  
* Change own role to guardian for their own future use: rare but supported. Student emails support via pre-drafted flow. Support verifies identity, coordinates with student on any active subscription (does it transfer? does it cancel?). Admin action changes `profiles.role = 'guardian'` via `profile-service.ts`. Student is now a guardian profile.

**Default behavior.** Most 18-year-olds take no action. Relationship continues. Parent continues to see aggregate data.

## **Example Three: Premium Guardian Pays for Student**

Parent wants to pay for their 16-year-old's premium access.

**Setup.** Student has account. Guardian has account. Link exists.

**Billing initiation.** Guardian navigates to guardian dashboard, selects linked student, clicks "upgrade to premium for this student."

**Stripe flow.** Client creates Stripe checkout session. Checkout: student is the Stripe customer (identified by `profiles.stripe_customer_id` on student's profile); guardian's payment method is the funding source. Checkout completes.

**Webhook.** Stripe sends `invoice.payment_succeeded` to `webhookHandlers.ts`. Idempotency check (new event). `entitlements` updated for student's profile: tier=premium, end\_at=next billing cycle.

**Runtime effect.** Student's next runtime request sees premium entitlement. All premium features unlock.

**Dashboard.** Guardian sees billing status on their dashboard. Student sees "Premium" badge. Receipts sent to guardian.

**Renewal.** Stripe charges guardian's payment method monthly. Each payment triggers webhook; entitlement renews.

**Card expiration.** Guardian's card expires. Stripe retries per dunning schedule. If retries exhaust, `invoice.payment_failed` final webhook; entitlement transitions to free; guardian receives email to update payment method.

## **Example Four: Account Deletion with Recovery**

Premium student decides to delete their account.

**Request.** Student navigates to settings → delete account. Confirmation screen explains: 7-day grace, subscription cancels at T+7, data anonymized at T+7.

**MFA challenge.** Student completes MFA (or password re-entry for non-MFA users).

**Deletion request created.** `account_deletion_requests` row: status=pending, scheduled\_delete\_at=now()+7 days. `profile-service.ts` marks profile with deletion flag. Confirmation email sent to student.

**Grace period begins.** Student still has premium access. Practice, review, exams all work. Stripe billing continues (next invoice may hit during grace; that's fine — they're paying for access they still have).

**Guardian notice.** Guardian (if linked) sees "pending deletion" on dashboard for this student. Status is visible but actions on the student's account are disabled.

**Day 3: student reconsiders.** Logs in, sees pending-deletion banner, clicks "cancel deletion." Confirmation. Transaction:

* `account_deletion_requests.status='canceled'`  
* `profiles` deletion flag cleared  
* Guardian's pending indicator clears

Student returns to normal. Stripe continues billing as normal.

**Alternative: no reconsidered.** At T+7:

* Scheduled job runs  
* Stripe subscription canceled immediately (premium drops to free)  
* `deidentify_user` RPC runs: email, name, phone, DOB, address anonymized  
* `guardian_links` rows deleted  
* Active sessions terminated  
* `audit_logs` final deletion event  
* `profiles` row retained in anonymized form (data for analytics; identity removed)

Student cannot log in (email and identity gone). Guardian no longer sees the student on dashboard.

---

# **34\. Appendix A — Identity Constants Catalog**

This appendix enumerates every identity/access runtime constant referenced in this document. Authoritative catalog for INV-02B-15 as extended to Doc 01\.

## **auth\_runtime\_config**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `failed_login_lockout_threshold` | 5 | 3 | 10 | Security | Failed login attempts before lockout |
| `lockout_duration_minutes` | 15 | 5 | 120 | Security | Lockout period after threshold hit |
| `session_ttl_hours` | 24 | 1 | 168 | Engineering | Supabase session TTL (alignment with Supabase config) |
| `refresh_token_ttl_days` | 30 | 7 | 90 | Engineering | Refresh token TTL |
| `email_verification_ttl_hours` | 24 | 1 | 72 | Product | Verification link expiration |
| `password_reset_ttl_hours` | 1 | 0.5 | 24 | Security | Password reset link expiration |
| `magic_link_ttl_minutes` | 15 | 5 | 60 | Security | Magic link expiration |
| `mfa_enforcement_days_for_students` | 14 | 3 | 60 | Product | Grace before MFA required for students |
| `mfa_enforcement_days_for_guardians` | 14 | 3 | 60 | Product | Grace before MFA required for guardians |

## **consent\_runtime\_config**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `consent_request_ttl_days` | 7 | 3 | 30 | Product | Guardian consent request expiration |
| `consent_expiration_deletion_days` | 30 | 14 | 90 | Product | Auto-delete under-13 unconsented accounts after |
| `consent_request_resend_cooldown_minutes` | 60 | 15 | 1440 | Engineering | Minimum time between consent email resends |
| `consent_request_max_resends_per_day` | 3 | 1 | 10 | Engineering | Max consent email sends per day per request |

## **entitlement\_runtime\_config**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `grace_period_days_past_due` | 7 | 0 | 30 | Product | Premium access during Stripe dunning |
| `entitlement_cache_ttl_seconds` | 60 | 10 | 600 | Engineering | Cache TTL for entitlement reads |
| `trial_period_days` | 0 (launch) | 0 | 30 | Product | Trial period if offered (none at launch) |
| `cancellation_at_period_end_default` | true | — | — | Product | Default cancellation timing (at period end vs immediate) |

## **account\_deletion\_runtime\_config**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `grace_period_days` | 7 | 1 | 30 | Product | Soft-delete grace before hard delete |
| `scheduled_deletion_job_cron` | daily\_at\_02\_utc | — | — | Engineering | Schedule for T+7 deletion job |
| `anonymization_retention_days` | 365 | 30 | 3650 | Product | How long anonymized data retained for analytics |
| `guardian_pending_deletion_visibility` | true | — | — | Product | Show guardian the pending-deletion indicator |

## **auth\_mfa\_config**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `mfa_required_roles` | \["admin", "tutor", "teacher"\] | — | — | Security | Roles requiring MFA at launch |
| `mfa_factor_types_allowed` | \["totp", "webauthn"\] | — | — | Security | Supported MFA methods |
| `mfa_challenge_ttl_seconds` | 300 | 60 | 1800 | Security | MFA challenge window |
| `mfa_enrollment_required_before_billing` | true | — | — | Product | Gate billing actions on MFA enrollment for students/guardians |

## **Why This Matters**

This catalog is the authoritative list for what must live in DB per extended INV-02B-15. CI enforcement tests that every constant has a DB row and no new magic numbers appear.

