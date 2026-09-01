# Consent flow — pre-deletion audit (adoption plan step 8)

**Date:** 2026-08-28 · **Branch:** `claude/guardian-link-lifecycle` · **Base:** `bc344a9`
**Verdict: DO NOT DELETE. Step 8 must not be executed as scoped.**

Owner instruction that produced this document:

> before deleting the consent flow, confirm the two new routes genuinely cover every path it was
> producing. It was the only producer of active links, and the audit showed it creating with
> initiator "student" then immediately accepting in the same handler. If any real behaviour lived
> there beyond that shortcut — under-13 semantics, a Stripe interaction, a notification — it needs
> naming before deletion, not after.

Real behaviour lived there. Seven distinct mechanisms, of which the create-then-accept shortcut is
one. Two of the other six exist nowhere else in the codebase.

---

## 1. What the surface actually does

`server/routes/guardian-consent-routes.ts` (467 lines), mounted at `/api/consent`
(`server/index.ts:400`), three routes:

| # | Mechanism | Also exists elsewhere? |
|---|---|---|
| 1 | **COPPA identity verification via Stripe Checkout** — a $0.50 `capture_method: "manual"` authorization, voided afterwards with `paymentIntents.cancel` (`:399-410`) | **No** |
| 2 | **Payer-identity binding** — `customer_email` set server-side from the stored guardian address (`:132`), so a hijack attempt emails the victim. Recorded as GAP-ID-11.9 under an owner ruling | **No** |
| 3 | **Server-authoritative selection** — the request id is derived from `session.metadata.requestId`, with compare-and-reject against any body value (`:243-273`) | **No** |
| 4 | **`profiles.guardian_consent = true` + `consent_given_at`** (`:332-333`) | **No — this is the only writer in the repo** |
| 5 | **Guardian account provisioning** — `admin.auth.admin.generateLink({type:"invite"})` for a guardian who has no account yet (`:365`) | **No** |
| 6 | **Two transactional emails** — existing-guardian notification, new-guardian invitation carrying the action link (`:352`, `:386`) | **No** |
| 7 | The create-then-accept link shortcut (`:417-422`) | **Yes — steps 1–3 of this plan** |

Steps 1–3 replace row 7 **and nothing else**.

## 2. Why deleting it would be a P0

`guardian_consent` is read as a hard access gate in four places:

- `server/middleware/supabase-auth.ts:796` — `requireConsentCompliance`, mounted on **10 routes**
- `server/middleware/supabase-auth.ts:951`
- `server/routes/profile-routes.ts:263`
- `server/routes/oauth-callback-routes.ts:206`

It is written `true` in exactly one place: `guardian-consent-routes.ts:332`. The only other writer,
`profile-routes.ts:343`, sets it to `false` or preserves the existing value — never `true`.

Delete the flow and an under-13 account can never obtain consent, is blocked on ten route families
permanently, and its guardian never receives an account.

It is also spec-mandated. Doc 01 V8 §36.1 step 2: *"If student is under-13, this path is the
**required** path before any feature access (COPPA flow §37)."*

## 3. The shortcut is specified, not accidental

Doc 01 V8 §37.2 step 6, verbatim:

> On consent: `profiles.guardian_consent = true`, `profiles.consent_given_at = now()`;
> `guardian_links` row created with `status = 'active'`.

Under §36.1's pending model an active link cannot be created directly, so "create as
student-initiated, then accept as the guardian in the same breath" is the correct rendering of that
sentence — not a workaround. The guardian giving verified consent *is* their acceptance; there is no
second confirmation to ask for, and no user-facing route could stand in, because the guardian has no
account at that moment.

It also improved for free at step 4: both calls now go through the audited RPCs, so a consent link
and its `audit_logs` rows land in one transaction.

## 4. THE ACTUAL FINDING — the flow cannot run against the real schema

While confirming coverage, the surface turned out to be written against a table that does not exist.
Same defect class as the guardian-link surface, and it explains the same symptom.

`public.guardian_consent_requests` as shipped (`supabase/migrations/00000000000000_genesis.sql:240`,
confirmed byte-for-byte in `scripts/ci/genesis-schema.expected.sql:4210`) has
`student_profile_id`, `consent_token NOT NULL UNIQUE`, `consent_token_expires_at NOT NULL`, and
`CHECK (status IN ('pending','consented','denied','expired'))`.

The code uses `child_id`, `expires_at`, and writes `status = 'approved'`. `child_id` appears in **no**
migration and **no** expected-schema file.

Executed against a database carrying genesis + every migration:

```
-- (1) profile-routes.ts:268 — the creator's SELECT
SELECT id, guardian_email, expires_at, status FROM public.guardian_consent_requests
 WHERE child_id = gen_random_uuid();
ERROR:  column "expires_at" does not exist

-- (2) profile-routes.ts:295 — the creator's INSERT
INSERT INTO public.guardian_consent_requests (id, child_id, guardian_email, status, expires_at) ...
ERROR:  column "child_id" of relation "guardian_consent_requests" does not exist

-- (3) guardian-consent-routes.ts:324 — the approval, against a VALID pre-inserted row
UPDATE public.guardian_consent_requests SET status = 'approved' WHERE id = '4444...';
ERROR:  new row for relation "guardian_consent_requests" violates check constraint
        "guardian_consent_requests_status_check"

-- the spec-legal value, same row, for contrast
UPDATE public.guardian_consent_requests SET status = 'consented' WHERE id = '4444...';
UPDATE 1
```

(3) was first run against a `WHERE` that matched nothing and returned `UPDATE 0` — a CHECK is not
evaluated over zero rows. It is re-run above against a real row, because "no error" on an empty
update is not evidence the constraint permits the value.

### What a real under-13 signup does today

`profile-routes.ts:263` enters the branch → the SELECT at `:268` errors on `child_id`/`expires_at` →
`:277` returns **HTTP 500, "Failed to load guardian consent state"**. The request row is never
created, so no email is sent, no Stripe session is created, and nothing downstream runs.

**An under-13 user cannot complete profile setup at all.** This is a live P0 and it is not caused by
anything on this branch — `git log` shows both files untouched by it.

Partially known: the route's own docblock (`:411-414`) says *"the §37.2 `consent_token`, the
`"approved"` CHECK violation) is Phase D's work and is untouched here"*. The `child_id` /
`expires_at` mismatch and the resulting 500 on profile completion are not recorded anywhere.

## 5. Why the existing tests did not catch it

`tests/ci/guardian-consent.id11.contract.test.ts` passes, 8/8. It mocks the Supabase client, so its
fixtures return whatever shape the test author wrote — `child_id` included. The suite agrees with the
code instead of with the schema, which is the same failure the fixture-canonicality gate was built
for on the mastery side, one table over.

## 6. Recommendation — not taken, because it is not this PR's scope

Reconcile the code to the shipped schema (the spec is right; the code is wrong, per CLAUDE.md):

1. `child_id` → `student_profile_id`, `expires_at` → `consent_token_expires_at`, in both files.
2. `'approved'` → `'consented'`; set `consented_at`; populate `guardian_profile_id` once known.
3. Generate and store `consent_token` on creation (`NOT NULL UNIQUE`) and make it the bearer
   capability §37.2 step 3 specifies, replacing the requestId-as-capability residual.
4. Replace the mocked client in the contract test with the real-Postgres harness
   (`tests/helpers/pg-supabase.ts`) so the suite is answerable to the schema.
5. Then, and only then, revisit whether row 7 is worth routing through the new link routes. It
   probably is not: §37.2 step 6 specifies the outcome directly and the guardian has no session.

This is a self-contained vertical of its own. It is reported rather than started, because it is
larger than the step it was found inside and because a half-migrated consent flow is worse than a
uniformly broken one.

## 7. Owner questions

1. **Scope.** Take the reconciliation as the next workstream on this branch, or as its own PR?
2. **`'consented'` vs `'approved'`.** The spec's CHECK is the shipped one, so the code moves. Confirm
   there is no external consumer of the string `'approved'` (nothing in this repo reads it).
3. **The requestId-as-bearer residual.** GAP-ID-11 deferred full guardian-identity binding to WS-3.
   Does adopting the specified `consent_token` close that, or is WS-3 still owed?
4. **Under-13 accounts in production right now.** If any exist with `guardian_consent = false` and a
   failed profile completion, they need a remediation path once the flow works. Worth a
   `scripts/prod-verify/` count before the fix lands.
