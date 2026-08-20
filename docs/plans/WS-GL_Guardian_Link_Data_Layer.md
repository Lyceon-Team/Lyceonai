# WS-GL — Guardian-Link Data Layer Breakage

**Type:** Defect record + workstream. **Not an SCL** — the spec is correct and the code is wrong.
**Scope widened 2026-08-20:** the same drift class is confirmed on `guardian_consent_requests`. See §8.
**Status:** Open. Unowned.
**Date recorded:** 2026-08-20
**Recorded by:** Stripe vertical Phase B. **Out of edit scope for that vertical** (Charter §4) — reported, not fixed.
**Blocks:** the guardian-paid billing path in its entirety. See §4.

---

## 1. The defect

Every guardian-link read and write in `server/lib/account.ts` queries columns that do not exist in
production, in `supabase/migrations/00000000000000_genesis.sql`, or in any migration under
`supabase/migrations/`. The code targets a pre-genesis table shape that exists nowhere.

**Production `guardian_links` — 12 columns:**

```sql
SELECT a.attnum, a.attname, format_type(a.atttypid,a.atttypmod) AS type
FROM pg_attribute a WHERE a.attrelid='public.guardian_links'::regclass
  AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum;
```
```
1  id                     uuid
2  guardian_profile_id    uuid
3  student_profile_id     uuid
4  status                 text
5  initiated_by           text
6  initiated_at           timestamptz
7  accepted_at            timestamptz
8  accepted_by_profile_id uuid
9  revoked_at             timestamptz
10 revoked_by_profile_id  uuid
11 revocation_reason      text
12 created_at             timestamptz
```

**There is no `student_user_id`, no `account_id`, no `linked_at`.** The exact query the application
issues fails:

```sql
SELECT student_user_id, account_id, linked_at FROM public.guardian_links
WHERE status='active' ORDER BY linked_at ASC LIMIT 2;
```
```
ERROR: 42703: column "student_user_id" does not exist
```

Genesis agrees with production, not with the code — `genesis.sql:219-237` defines
`student_profile_id`, `initiated_at`, `accepted_at`. Confirmed absent from every migration:

```
$ grep -rn "student_user_id\|linked_at" supabase/migrations/ | grep -i guardian
   (no output)
```

## 2. Affected call sites

| `file:line` | Symbol | Broken column reference |
|---|---|---|
| `server/lib/account.ts:39-72` | `createGuardianLink` | selects `student_user_id`; orders by `linked_at` |
| `server/lib/account.ts:538-568` | `getPrimaryGuardianLink` | selects `student_user_id, account_id, linked_at`; orders by `linked_at` |
| `server/lib/account.ts:575-597` | `getAllGuardianStudentLinks` | selects `student_user_id, linked_at`; orders by `linked_at` |
| `server/lib/account.ts:600-637` | `getLinkedGuardianForStudent` | same family |

**Downstream surfaces that therefore throw before doing anything:**

| `file:line` | Surface |
|---|---|
| `server/routes/billing-routes.ts:142` | `POST /api/billing/checkout` — guardian branch |
| `server/routes/billing-routes.ts:342` | `GET /api/billing/status` — guardian branch |
| `server/routes/billing-routes.ts:709` | `POST /api/billing/portal` — guardian branch |
| `server/routes/guardian-routes.ts:111` | `GET /api/guardian/students` — the dashboard student list |
| `server/routes/guardian-routes.ts:395` | post-unlink student-list refresh |

## 3. Why it has never been observed

Nothing has exercised it. `guardian_links` is empty, so the failing query has never been reached in
anger by a real guardian:

```sql
SELECT 'guardian_links' t, count(*) n FROM public.guardian_links
UNION ALL SELECT 'profiles', count(*) FROM public.profiles
UNION ALL SELECT 'profiles_role_guardian', count(*) FROM public.profiles WHERE role='guardian';
```
```
guardian_links          0
profiles                115
profiles_role_guardian  14
```

Fourteen guardian profiles, zero links.

**CI does not catch it either**, because every test that touches these functions mocks the module.
`tests/ci/guardian-linking.contract.test.ts:54` is `vi.mock('../../server/lib/account', () =>
accountMocks)`, which replaces `createGuardianLink` with a `vi.fn()`. The suite is green and proves
only the route's error-code→HTTP mapping at `server/routes/guardian-routes.ts:249-279`. Verified by
planting a failure — changing the matched code string yields `AssertionError: expected 500 to be
409` — so the test is not hollow, but its name (`Guardian Linking 1:1 Enforcement Contract`)
overclaims: the invariant it names lives in the mocked-out function.

## 4. Blocking relationship to billing

**The guardian-paid path cannot be built or tested until this is fixed.** SCL-043 (payer identity),
SCL-045 (one subscription item per student), and SCL-046 (country derives from the payer) all
describe guardian behaviour whose first step is resolving a guardian's linked students — which is
exactly the call that throws.

This is why the Stripe vertical's Phase C thin slice is the **unaccompanied-student** path: payer and
student are the same person, no guardian link is read, and this defect is not on the critical path.

**The guardian-paid path is blocked on WS-GL. Name it as a dependency in any plan that schedules it.**

## 5. Scope note — SCL-045 is a separate concern

SCL-045 records that `createGuardianLink` refuses a second student (`GUARDIAN_ALREADY_LINKED`,
`account.ts:39-72`) and that `tests/ci/guardian-linking.contract.test.ts` must retire with SCL-045's
promotion. That is the **multi-student** question and is owner-ruled.

This defect is narrower and independent: even the *first* link is broken. Fixing the 1:1 rule without
fixing the column names produces a path that still throws. Fix order is this defect first, then
SCL-045's cardinality change.

## 6. What is NOT claimed here

- No repair is proposed. The correct fix — rename the code's references to the genesis/production
  column names, or something else — is a design decision for whoever owns this workstream.
- No DDL is implied. Production and genesis agree; **the schema is right**. This is a code defect
  only, so it does not enter the WS-M migration freeze or `STRIPE_DDL_QUEUE.md`.
- No assessment of whether other `account.ts` functions carry the same drift beyond the four listed.
  The sweep covered the guardian-link family only.

## 7. Owner actions

1. Assign an owner. This is not a billing workstream item.
2. Sequence it before any guardian-paid billing work.
3. Decide whether the drift extends beyond `guardian_links` — a repo-wide
   code-columns-vs-`information_schema.columns` sweep would answer it, and the Stripe vertical is
   running that check for its own six tables at Phase C (Charter §3) but no further.

---

## 8. Second instance — `guardian_consent_requests` (added 2026-08-20)

Found while verifying the Stripe vertical's Phase C gate item 4. **Same defect class, different
table, and this one carries the under-13 COPPA consent flow.**

**Production `guardian_consent_requests` — 10 columns, matching Doc 01 V8 §37.2 (heading verified:
`### **37.2 Consent request flow**`) and `genesis.sql:240` exactly:**

```sql
SELECT a.attnum, a.attname, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull
FROM pg_attribute a WHERE a.attrelid='public.guardian_consent_requests'::regclass
  AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum;
```
```
1  id                        uuid         NOT NULL
2  student_profile_id        uuid         NOT NULL
3  guardian_email            text         NOT NULL
4  guardian_profile_id       uuid
5  status                    text         NOT NULL
6  consent_token             text         NOT NULL
7  consent_token_expires_at  timestamptz  NOT NULL
8  consented_at              timestamptz
9  denied_at                 timestamptz
10 created_at                timestamptz  NOT NULL
```

**The code targets `child_id` and `expires_at`. Neither exists:**

```sql
SELECT id, child_id, guardian_email, expires_at, status FROM public.guardian_consent_requests LIMIT 1;
```
```
ERROR: 42703: column "child_id" does not exist
```

| `file:line` | Operation | Broken reference |
|---|---|---|
| `server/routes/profile-routes.ts:267-275` | SELECT existing pending request | `child_id`, `expires_at` (also orders by `expires_at`) |
| `server/routes/profile-routes.ts:294-301` | INSERT new request | writes `child_id`, `expires_at`; **omits `consent_token` and `consent_token_expires_at`, both `NOT NULL` with no default** |
| `server/routes/guardian-consent-routes.ts:61-64` | SELECT request for the verification UI | joins `profiles:child_id(...)`; reads `request.expires_at` at `:71` |
| `server/routes/guardian-consent-routes.ts:114` | SELECT request for checkout | `.select("*")` — survives, but downstream reads `request.child_id` at `:159`, `:169` |
| `server/routes/guardian-consent-routes.ts:277`, `:324` | SELECT / UPDATE during verify | same family |

The INSERT fails twice over: unknown columns, and two `NOT NULL` columns absent from the payload.

**§37.2 is therefore not implemented — not partially, not differently. It is absent.**

```
$ grep -rn "consent_token" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v "^./docs/"
   (no output)
```

Zero hits. `consent_token` **is** the §37.2 mechanism — the spec's step 3 reads "Guardian clicks link
→ lands on consent page (no auth required; **token is the auth**)." The code substitutes the raw
`guardian_consent_requests.id` UUID as the bearer capability in the verification URL
(`profile-routes.ts:318`, `guardian-consent-routes.ts:158`), which is why `digest8`
(`guardian-consent-routes.ts:17`) exists to keep it out of logs. A substitute for the token is not an
implementation of it.

### 8.1 Consequence for the Stripe vertical — gate item 4 stops here

The owner ruled the $0.50 guardian verification charge in scope for removal, with Doc 01 V8 §37.2's
token-and-email flow as the fallback, conditioned on: *"If the route does not already implement it,
that is a defect for WS-GL; report it and stop."*

**It does not.** Removing the charge mechanics at `guardian-consent-routes.ts:95, 127, 143, 145, 419`
would delete the only thing the verify path currently gates on and leave a consent route that
approves on an unverified UUID from the URL — a worse posture than the one being removed, and a
change of consent mechanism rather than the deletion of a payment step.

**The Stripe vertical has stopped on this item and made no edit to
`server/routes/guardian-consent-routes.ts`.** Removal becomes safe once §37.2 exists.

### 8.2 Why the CI suite does not catch this either

`tests/ci/guardian-consent.id11.contract.test.ts` mocks the Supabase client wholesale — its
`if (table === "guardian_consent_requests")` branch at `:77` returns hand-built objects, so no query
ever reaches a real schema. Same mechanism as `guardian-linking.contract.test.ts` (§3): the suite
proves route behaviour given a fabricated row shape, and the fabricated shape is the one that does
not exist.

### 8.3 Scope note

This does not change §6 — still no DDL implied, still not a WS-M item. Production and genesis agree
on both tables; the code disagrees with both. The open question in §7.3 (does the drift extend
further than `guardian_links`?) is now answered "yes, at least to `guardian_consent_requests`," which
raises the priority of the repo-wide sweep.
