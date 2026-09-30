# Settings inventory: `/profile` and its endpoints (read-only, 2026-09-30)

Taken on `cleanup` @ `fc2a16f4`. No code was changed. Every claim cites file:line on that commit. Findings that are new to the register are listed at the end and filed in §8 of the register (F-37 to F-41).

> **Update, 2026-09-30, after `cleanup` moved to `3efe69bb`.** One claim in §5 no longer holds: SCL-191 (`supabase/migrations/20261015000000_exam_score_renewal_decision.sql:158-163`) added `entitlements.payer_profile_id`, and the webhook now writes it (`server/lib/stripe/webhook-handler.ts:731`, `:1400` on `3efe69bb`). §5 and F-40 carry the correction. F-40 itself still holds: the student branch of `/api/billing/status` and `UserProfile.tsx` are unchanged, so the student still sees "Manage Subscription" and gets a 409. Every other cited line is on `fc2a16f4`, as stated above.

**In one paragraph.** A student's settings live on `/profile` (`client/src/App.tsx:296` → `client/src/pages/UserProfile.tsx`), which has four tabs: Profile, Progress, Settings and Billing.
- **Profile tab:** read-only. The name and email inputs are disabled, and there is no edit path.
- **Progress tab:** placeholders. It is dead, and the live endpoints are used only by the dashboard.
- **Settings tab:** the guardian-link panels, the email-suppression card and account deletion.
- **Billing tab:** plan status and the Stripe portal button.

Test date and target score are editable, but only from the calendar's settings sheet, not from `/profile`. Password change is a separate page with no current-password check and no handling of Google-only accounts. There are no per-type notification preferences.

---

## 1. Tabs and fields shown today

The page reads `GET /api/profile` through the shared profile query (`UserProfile.tsx:109-115` → `client/src/hooks/useProfileQuery.ts:91-117`; server `server/routes/profile-routes.ts:141-267`, mounted `server/index.ts:419-424` behind `requireSupabaseAuth, doubleCsrfProtection`). Tabs are deep-linkable with `?tab=profile|progress|settings|billing` (`UserProfile.tsx:155-169`). All three roles see every tab. The only role branches are:
- the two link panels, for students only (`:628`, `:633`);
- the Administrator badge (`:315`);
- the billing CTA label and target, for guardians (`:745`, `:750`).

### Header (all tabs)

| Field | Renders at | Reads | Writes |
|---|---|---|---|
| Avatar initial | `UserProfile.tsx:293-299` | `/api/profile` `name` | display-only |
| Name | `:306` | `name` = `display_name` or the email local part (`profile-routes.ts:170-174`, `:243`) | display-only |
| Email | `:312` | `/api/profile` `email` (`profile-routes.ts:241`) | display-only |
| Administrator badge | `:315-320` | `isAdmin` (`profile-routes.ts:246`) | display-only |
| Member since | `:321-324` | always "Unavailable": `/api/profile` never sends `created_at` (`profile-routes.ts:239-261`). Already register F-23 | display-only (dead) |
| Sign out | `:328-335` | — | `POST /api/auth/signout` (`server/routes/supabase-auth-routes.ts:379`) |

### Profile tab (`UserProfile.tsx:367-533`)

| Field | Renders at | Reads | Writes |
|---|---|---|---|
| Full name | `:379-384`, `disabled` | `name` | **none**: "editing coming soon" (`:372`) |
| Username | `:388-393`, `disabled` | email local part, not a stored column (`profile-routes.ts:170-172`, `:244`) | none |
| Email | `:397-406`, `disabled` | `email` | none: "Email changes are currently support-managed" (`:405`) |
| Account security | `:413-442` | static text, static "Active" badge | display-only. No link to `/update-password` (`:436-438` names the flow in prose only) |
| Request role change | `:444-532` | local state | no API call: builds a `mailto:` link (`:195`, `:509`) |

### Progress tab (`:536-622`)

Static placeholders; see §2.

### Settings tab (`:625-653`)

| Control | Renders at | Reads | Writes |
|---|---|---|---|
| Link code (students only) | `:628-630` → `client/src/components/student/StudentLinkCodePanel.tsx` | `GET /api/students/:id/link-code` | `POST …/link-code/regenerate`, `POST …/link-code/invite` (§4) |
| Linked guardians (students only) | `:633-635` → `StudentGuardiansPanel.tsx` | `GET /api/students/:id/links` | `DELETE …/links/:linkId` (§4) |
| Email notifications | `:649` → `client/src/components/account/EmailNotificationsCard.tsx` | `GET /api/account/email-suppression` (`EmailNotificationsCard.tsx:33, 45`) | `POST /api/account/email-suppression/clear` (`:50-55`). Renders nothing unless the address is suppressed (`:75`) |
| Delete account | `:650` → `DeleteAccountCard.tsx` | shown only when `accountDeletionLifecycleV2` is on (`DeleteAccountCard.tsx:65`; flag from `profile-routes.ts:235-237`) | `POST /api/account/delete` (`DeleteAccountCard.tsx:44` → `server/routes/account-deletion-routes.ts:288`) |

### Billing tab (`:656-757`)

| Control | Renders at | Reads | Writes |
|---|---|---|---|
| Current status | `:707-711` | `GET /api/billing/status` (§5) | display-only |
| "Link a student" note (guardian) | `:712-717` | `hasActiveLink` | display-only |
| Manage Subscription | `:720-729` | — | `POST /api/billing/portal` (§5) |
| View Plans / Go to your dashboard | `:743-751` | — | navigation only |

**Onboarding (`/profile/complete`, `client/src/pages/profile-complete.tsx`).**
- Fields: display name (`:293-300`), role (`:305-318`), date of birth (`:325-331`) and a marketing opt-in (`:352-356`).
- Write: `PATCH /api/profile` (`:136-145`).
- Once the profile is complete, the page redirects away (`:210-219`), so a completed student has no UI that reaches this PATCH.

---

## 2. Progress: dead

- **Every value is a hard-coded placeholder.**
  - Overall Score (`UserProfile.tsx:559`), Questions Answered (`:579`) and Study Time (`:599`) each render a literal `—` with "Check Dashboard".
  - "Subject Progress" is a "Coming Soon" empty state (`:616-619`).
  - A banner says the tab is "intentionally disabled until the rebuild is complete. Visit the Dashboard…" (`:540-542`).
  - The source comment says the same (`:92-94`: "temporarily disabled and shown as placeholders").
- **No API call.** `git grep -n "/api/" client/src/pages/UserProfile.tsx` finds none for progress. The page's reads are the profile, billing status and portal hooks only.
- **The live endpoints exist but serve only the dashboard.** Both are mounted behind `requireSupabaseAuth, requireStudentOrAdmin`, and their consumers are `client/src/pages/lyceon-dashboard.tsx:114, :124` and `projectionApi.ts:122`.
  - `GET /api/progress/projection` (`server/index.ts:467-472`)
  - `GET /api/progress/kpis` (`server/index.ts:475-480`)

---

## 3. Server-side write path per profile field

| Field | Write path today | Endpoint → handler | Writer | Validation |
|---|---|---|---|---|
| Display name | **Server only**; no UI after onboarding | `PATCH /api/profile` → `profile-routes.ts:274-485` | `profiles.display_name` (`:432`) | `profileCompletionSchema` (`profile-routes.ts:129-135`, local, not in `packages/shared`): `z.string().trim().min(1).max(120)`. `role` is required on every call, so a name-only edit must resend it. Each call re-stamps `profile_completed_at` (`:439`). Initial value set at signup (`supabase-auth-routes.ts:146`) |
| First / last name | **None** | — | — | No such fields anywhere: `git grep -n "first_name\|last_name\|firstName\|lastName" -- server client/src packages/shared/src supabase/migrations ':!*.test.*'` returns 0 lines |
| Email | **None** | — | — | No email-change call: the only `auth.updateUser` is the password one (`supabase-auth-routes.ts:517`). The `email_change` OTP type is only allowlisted in the callback (`oauth-callback-routes.ts:57`). The UI says support-managed (`UserProfile.tsx:405`) |
| Password | **Yes** | `POST /api/auth/update-password` → `supabase-auth-routes.ts:489-535` | Supabase Auth `updateUser({ password })` on the request's cookie session (`:516-517`) | `z.object({ password: passwordSchema })` (`:499`); shared `passwordSchema` (`packages/shared/src/password-policy.ts:157`): 8–72 characters, at least one letter and one digit (`:33`, `:35`, `:73-100`). See §7 |
| Date of birth | **Yes, restricted** | (a) `PATCH /api/profile` (`profile-routes.ts:363-389`, `:436`). (b) `POST /api/profile/date-of-birth`, guardians only (`:501-564`) | `profiles.date_of_birth`; `is_under_13` is derived by a DB trigger, never written (`:434-435`) | (a) See the note below. (b) `setDateOfBirthRequestSchema` (`packages/shared/src/profile-role-choice-schema.ts:65-67`; `YYYY-MM-DD` at `:24-26`, `.strict()`), adults only (`:518`), fills only a NULL value (`:539`, else 409 `DATE_OF_BIRTH_ALREADY_SET`) |
| Test date (`target_exam_date`) | **Yes, from the calendar only** | `PUT /api/calendar/profile` → `server/routes/calendar-routes.ts:573-588` → `upsertStudyProfile` (`server/services/calendar/profile-service.ts:235`); mounted `server/index.ts:453-459` (`requireSupabaseAuth, doubleCsrfProtection, requireStudentOrAdmin`). Client: `client/src/features/calendar/api/client.ts:221-233`, used by the calendar `SettingsSheet.tsx:317` and the setup popup | `student_study_profile.target_exam_date` (`profile-service.ts:266-267`, `:343-350`) | `makeStudyProfileUpsertSchema` (`packages/shared/src/calendar/profile.ts:219-309`): real `YYYY-MM-DD` date, not in the past (`:295-300`), no further ahead than the `calendar_runtime_config` bound (`:301-306`), `idempotency_key` UUID required (`:207`), `.strict()`. Not entitlement-gated, by ruling (`calendar-routes.ts:562-572`) |
| Target score | **Yes, same calendar route** | as above; `SettingsSheet.tsx:335` | `student_study_profile.target_score` (`profile-service.ts:268`) | `targetScoreSchema` (`profile.ts:107-113`): integer 400–1600 in steps of 10; optional (SCL-130) |

**Date of birth through `PATCH /api/profile` (a):**
- The field is `z.string().optional().nullable()` (`:132`), with **no format check** (F-41).
- It is required for students (`:391-395`).
- Guardians must be 18 or older (`:399-413`; `server/lib/role-choice.ts:137-162`; `GUARDIAN_MIN_AGE` at `packages/shared/src/profile-role-choice-schema.ts:21`).
- It is locked once the profile is complete: 409 `DATE_OF_BIRTH_LOCKED` (`:368-386`), also enforced by the trigger `profiles_lock_date_of_birth` (`supabase/migrations/20261014010000_profiles_date_of_birth_lock.sql:34, 64-65`).

---

## 4. Guardian-link endpoints the student side calls

- **Mount and gating:** all on `server/routes/student-resources.ts`, mounted `server/index.ts:441-446` (`requireSupabaseAuth, doubleCsrfProtection`, no role gate). Each route resolves the subject (`server/middleware/subject-resolver.ts:83`; `via: "self"` only when the caller is the student, `:106-110`) and returns 404 to anyone else.
- **Under-13 gate:** deliberately **not** on these routes. They are how an under-13 student gets a link (`student-resources.ts:225-229`).
- **Where they render:** on `/profile` (Settings tab) and on `/guardian-required` (`client/src/pages/guardian-required.tsx:83-84`).

| Action | Method + path | Client | Server | What it does |
|---|---|---|---|---|
| Show code | `GET /api/students/:id/link-code` | `StudentLinkCodePanel.tsx:66-77`, `:83` | `student-resources.ts:676-742` | Returns `{code, expiresAt}`; issues a code if none is live (`:721`); 503 `LINK_CODE_UNCONFIGURED` if no TTL is configured (`:685-693`) |
| New code | `POST …/link-code/regenerate` | `StudentLinkCodePanel.tsx:88-104` | `student-resources.ts:756-799` (rate-limited `:759`) | Invalidates the old code and issues a new one |
| Email the code | `POST …/link-code/invite` | `StudentLinkCodePanel.tsx:118-134` | `student-resources.ts:899-1023` | Zod-parsed (`:908`), rate-limited (`:931-937`), sends the invite (`:995`); 202 whether or not the address has an account (`:1019`) |
| Status / list | `GET /api/students/:id/links` | `StudentGuardiansPanel.tsx:57-66`, `:78` | `student-resources.ts:814-873` | Active links only: `{links:[{link_id, guardian_display_name, linked_at}]}` |
| Unlink | `DELETE …/links/:linkId` | `StudentGuardiansPanel.tsx:83-95` (confirm dialog) | `student-resources.ts:1050-…` | Revokes (§36.3) with the student as `revoked_by` (`:1093-1098`); 404 if not the student's link (`:1087`), 409 if not active (`:1113-1118`); notifies the guardian |

- **Link:** the student cannot create a link. They share a code, and **the guardian redeems it**: `POST /api/guardian/link/redeem` (`server/routes/guardian-routes.ts:332-337`, guardian role only, `:47`). The code comment says "Sharing this code IS the consent (SCL-080)" (`StudentLinkCodePanel.tsx:11-12`).
- **Status:** there is no dedicated status endpoint.
  - The list above is the per-link view.
  - `GET /api/profile` carries `guardianConsentRequired = is_under_13 && !hasActiveGuardianLink` (`profile-routes.ts:204-207`, `:256`; read in `server/lib/guardian-link-state.ts:16-30`). This drives the `/guardian-required` redirect.
- **Guardian side, for contrast** (`server/index.ts:519-524`):
  - `GET /api/guardian/students` (`guardian-routes.ts:147-150`)
  - `POST /api/guardian/link/redeem` (`:332-337`)
  - `DELETE /api/guardian/link/:studentId` (`:620-623`)

---

## 5. Billing

**Plan status.**
- **Client:** `UserProfile.tsx:118-123` → `client/src/hooks/useBillingStatusQuery.ts:61-67` → `GET /api/billing/status`. The body is not Zod-parsed (`:16-17`; register F-22).
- **Server:** `server/routes/billing-routes.ts:649-827`, `requireSupabaseAuth`; admins get 403 (`:659-663`).
- **The student branch** (`:765-813`) makes **no Stripe call**. It reads:
  - the student's own `entitlements` row by `profile_id` (`server/lib/account.ts:464-480`);
  - SQL `entitlement_active()`;
  - `profiles.stripe_customer_id` (`account.ts:566-582`).
- **Response** (`:794-805`): `plan`, `stripeStatus`, `currentPeriodEnd`, `stripeSubscriptionId`, `effectiveAccess`, `needsPaymentUpdate`, `lapsed`, `hasBillingAccount`, `isPaid`, `requestId`. The guardian branch (`:678-763`) adds `hasActiveLink` and `source: "guardian_linked_student"`.

**Customer portal: exists.**
- **Endpoint:** `POST /api/billing/portal` (`billing-routes.ts:842-918`). It runs behind `requireSupabaseAuth`, `doubleCsrfProtection` and `requireGuardianLinkForUnder13` (`:843-849`); admins get 403 (`:858-862`).
- **What it does:** it opens the caller's **own** Stripe customer (`billingPortal.sessions.create({ customer, return_url })`, `:894-897`) and returns 409 `NO_STRIPE_CUSTOMER` if the caller has none (`:873-880`).
- **Called from the student UI:** `UserProfile.tsx:192`, `:721-729` → `client/src/hooks/useBillingPortal.ts:51-68` → `client/src/lib/billing-client.ts:165-180`.
- **No cancel endpoint:** cancellation happens in the portal only (`billing-routes.ts:835-840`).

**Guardian-paid plan.**
- **No payer column in the database (true on `fc2a16f4`; superseded, see the update at the top):** `git grep -n -i payer -- supabase/migrations` returns 0 lines. `entitlements` (`supabase/migrations/00000000000000_genesis.sql:178-194`, re-keyed per subscription item by `20260827010000_entitlements_item_level_key.sql:74-90`) has no payer or source field.
- **Stripe metadata is the only record of who pays (on `fc2a16f4`; since SCL-191 the webhook copies `metadata.payer_profile_id` into `entitlements.payer_profile_id`).** Checkout sets `payer_profile_id`, `student_profile_id` and `payer_relationship: "guardian"` (`billing-routes.ts:445-456`; self-pay sets `"self"`, `:472-476`). The webhook treats a subscription with `metadata.payer_profile_id` as guardian-paid and writes one entitlement per item (`server/lib/stripe/webhook-handler.ts:2670`).
- **The student is not told that a guardian pays.** The student branch of `/api/billing/status` has no payer or source field. The guardian's subscription id is on the student's row, so `hasManageableSubscription` (`UserProfile.tsx:202-209`) is true and the student sees **"Manage Subscription"**.
- **What that button does:** a student with no Stripe customer gets the 409 and a toast ("If someone else pays for this subscription, they can manage it from their own account settings", `useBillingPortal.ts:37-39`). This is F-40.

---

## 6. Notification preferences: none; only the email-suppression flag

- **No preference code anywhere.** `git grep -n -i "notification_pref\|notificationPreferences" -- server supabase/migrations client/src packages contracts` returns 0 lines.
- **The outbox migration defers them explicitly:** "user notification preferences are the END-STAGE notification lane and are NOT built here" (`supabase/migrations/20260617000000_notification_outbox.sql:22`).
- **Channels are fixed per event type in SQL** (`contracts/notifications.contract.md` §2 C2.3, `:76-95`).
- **Recipients cannot opt out.** A recipient can change only `seen_at` / `read_at` / `archived_at` on in-app rows (§3, `:107-112`).
- **The contract has no preferences section,** so the code does not diverge from it.
- **What the student has:**
  - The email-suppression card: `GET /api/account/email-suppression` and `POST /api/account/email-suppression/clear` (`server/routes/account-routes.ts:33-35`, `:73-76`; mounted `server/index.ts:545`). This matches `contracts/notifications.contract.md` C11A.6 (`:320-333`): address from the session, only manual entries clearable.
  - The in-app feed endpoints (`server/routes/notifications.ts:112, 207, 236, 269, 298`). They are read state, not preferences, and are not called from `/profile`.
  - `profiles.marketing_opt_in`, which is written by the onboarding PATCH (`profile-routes.ts:134`, `:438`) but not shown on `/profile`.

---

## 7. Password change

**Change flow.**
1. The `/update-password` page (`client/src/pages/update-password.tsx`; route `client/src/App.tsx:320-327`, all roles).
2. `updatePassword(password)` (`:69`) → `SupabaseAuthContext.updatePassword` (`client/src/contexts/SupabaseAuthContext.tsx:450-472`).
3. `POST /api/auth/update-password` (`server/routes/supabase-auth-routes.ts:489-535`; `requireSupabaseAuth, doubleCsrfProtection`).
4. Zod `{ password }` (`:499`).
5. `updateUser({ password })` on the request's cookie session (`:516-517`). A Supabase error returns a generic 400 (`:519-527`).

**Current password / reauthentication: not required.** The page has only New and Confirm fields (`update-password.tsx:92-111`). The server schema is `{ password }`, and `git grep -n "reauthenticat\|nonce" -- server client/src` returns nothing, so a valid session is the only gate. Whether Supabase's "require reauthentication to update password" setting is on in production is **not determinable from the repo**: it is recorded only as informational in `scripts/provisioning/supabase-auth-config-snapshot.ts:42, :136-141`, and there is no `supabase/config.toml`.

**Entry point.** `/profile` does not link to the page (`UserProfile.tsx:436-438` is prose only). The only producer of the path is the reset email's redirect (`supabase-auth-routes.ts:454`; `RECOVERY_NEXT` in `oauth-callback-routes.ts:74`). A signed-in user can still open it directly.

**Google-only (OAuth) accounts: not handled.** No code reads the account's identities or provider (`git grep -n "identities\|app_metadata" -- server client/src ':!*.test.*'` returns only unrelated account-deletion comments). The page hides nothing, and the server refuses nothing. An OAuth-only user who opens `/update-password` sends `updateUser({ password })` unchanged. What Supabase then does (most likely adds a password to the account) is not visible from the repo. This is F-38.

**Forgot-password flow: a different endpoint, then the same page.**
1. `POST /api/auth/reset-password` (`supabase-auth-routes.ts:424-482`; `authRateLimiter, doubleCsrfProtection`).
2. It reads `email` from the body **without Zod**, with only a truthiness check (`:430-431`). This is F-37.
3. It calls `resetPasswordForEmail(email, { redirectTo: …/auth/callback?next=/update-password })` (`:453-455`) and always returns a generic, non-enumerating response (`:470-474`).
4. The recovery callback sets the session, and then the flow above applies.

There is no provider check here either.

---

## New findings (filed as register §8 rows; not fixed)

| Row | Finding |
|---|---|
| F-37 | `POST /api/auth/reset-password` reads `email` from the body without Zod (`supabase-auth-routes.ts:430-431`), against Coding Standards §7.1 |
| F-38 | No handling of Google-only accounts on password change or reset: no provider or identity check in the UI or on the server (§7). Owner question: hide the form for OAuth-only accounts, refuse on the server, or allow adding a password deliberately |
| F-39 | A guardian can be issued a student link code: `GET /api/students/<own id>/link-code` resolves as `via: "self"`, and `issueStudentLinkCode` (`server/lib/student-link-code.ts:85-100`) has no role filter. The code can never be redeemed, because redemption filters `role = 'student'` (`:148`). Harmless but wrong |
| F-40 | A student whose plan a guardian pays sees "Manage Subscription" (`UserProfile.tsx:202-209`: `stripeSubscriptionId` is the guardian's) and gets a 409 toast when clicking it. `/api/billing/status` has no payer or source field for the student, though since SCL-191 the database stores the payer (`entitlements.payer_profile_id`), so the server can now tell a guardian-paid row from a self-paid one |
| F-41 | `PATCH /api/profile` accepts `dateOfBirth` as any string (`profile-routes.ts:132`), with no `YYYY-MM-DD` check. The guardian-only `POST /api/profile/date-of-birth` has one (`profile-role-choice-schema.ts:24-26`) |

Already in the register: "Member since" is always "Unavailable" (F-23); `/api/profile` and `/api/billing/status` have no shared Zod schema (F-22).
