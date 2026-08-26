# WS-GL Stage 1 — Read-Only Audit

**Date:** 2026-08-21 · **Stage:** 1 of 7. Read-only. No code changed, no DDL, no SQL beyond `SELECT`.
**Governs:** `docs/plans/Stripe_Vertical_Session_Charter.md` with the §0 substitutions.
**Extends:** `docs/plans/WS-GL_Guardian_Link_Data_Layer.md` (the defect record this audit widens).

**Authority order applied:** legal artifacts → `docs/Spec/` → `supabase/migrations/00000000000000_genesis.sql`
for naming → nothing else. Stripe documentation does not apply to this surface.

---

## 0. The answer to the question this workstream unblocks

> Can a guardian link two students, and can an under-13 student's guardian complete consent, end to
> end, against real Postgres?

**No, and no.** Neither has ever worked. But the reason is not the column drift, and that matters for
the closure plan.

`POST /api/guardian/link` mounts `durableRateLimiter` as middleware at
`server/routes/guardian-routes.ts:159`, **before** the handler body. That middleware counts rows in
`guardian_link_audit`. That table does not exist in production. `checkRateLimit` throws
(`server/lib/durable-rate-limiter.ts:31`), the middleware catches and returns **500**
(`:114-121`). Every link attempt has always died there.

So the column drift recorded in `WS-GL_Guardian_Link_Data_Layer.md` is real and is the **third**
thing that breaks, not the first:

| Order | Blocker | Where | What it does |
|---|---|---|---|
| 1 | `guardian_link_audit` does not exist | `durable-rate-limiter.ts:20` via `guardian-routes.ts:159` | 500 before the handler runs |
| 2 | RPC `ensure_account_for_user` does not exist | `guardian-routes.ts:242` → `account.ts:169` | would throw next |
| 3 | `guardian_links` column drift | `account.ts:39-72` | would throw third |

A closure plan that fixes only the column names produces a route that still returns 500. Stated here
because that is precisely the mistake the charter's evidence discipline exists to prevent.

---

## 1. Schema authority — genesis verified against production

Charter §3 requires genesis be verified against production before it is relied on, because the Stripe
drift check found genesis declaring a table constraint where production held only an index.

**No such drift here.** Both tables match column-for-column, in ordinal order.

`guardian_links` — production, 12 columns:

```
1 id                     uuid        NOT NULL  gen_random_uuid()
2 guardian_profile_id    uuid        NOT NULL
3 student_profile_id     uuid        NOT NULL
4 status                 text        NOT NULL
5 initiated_by           text        NOT NULL
6 initiated_at           timestamptz NOT NULL  now()
7 accepted_at            timestamptz NULL
8 accepted_by_profile_id uuid        NULL
9 revoked_at             timestamptz NULL
10 revoked_by_profile_id uuid        NULL
11 revocation_reason     text        NULL
12 created_at            timestamptz NOT NULL  now()
```

`guardian_consent_requests` — production, 10 columns:

```
1 student_profile_id       uuid        NOT NULL   (pos 2; pos 1 is id)
3 guardian_email           text        NOT NULL
4 guardian_profile_id      uuid        NULL
5 status                   text        NOT NULL
6 consent_token            text        NOT NULL
7 consent_token_expires_at timestamptz NOT NULL
8 consented_at             timestamptz NULL
9 denied_at                timestamptz NULL
10 created_at              timestamptz NOT NULL  now()
```

Both match `genesis.sql:219-251`, which in turn matches the DDL printed in Doc 01 V8 §35 and §37.2
verbatim. Constraints and indexes also match — including `unique_active_link` being present as both a
table constraint (`UNIQUE NULLS NOT DISTINCT (guardian_profile_id, student_profile_id, status)
DEFERRABLE INITIALLY DEFERRED`) and its backing unique index. **Genesis, production, and the spec all
agree.** That is why this is a defect and not an SCL.

### 1.1 One genesis/spec divergence — reported, not judged

Doc 01 V8 §35 (heading verified: `## **§35 Guardian-student linkage**`) closes with: *"Additional
audit table `guardian_link_audit` captures every status change for traceability."* It states the
table as existing.

`genesis.sql:18-21` explicitly defers it: *"`guardian_link_audit` (Doc 01 V8 §35 shared append-only)
is a DEFERRED identity object — its exact DDL is not pinned in the sections grounded for this pass;
it lands in a precise identity follow-up (contract §F), not invented here."*

Production: `SELECT to_regclass('public.guardian_link_audit')` → `NULL`.

The spec says it exists, genesis says it was deliberately deferred, production says it is absent, and
two code paths write to it. Per the task's instruction this is a finding, not a judgement — it needs
an owner ruling before Stage 2 can sequence around it. See §7 for why the ruling is not obvious.

---

## 2. Row counts — delete-first is safe, and confirmed

```
guardian_links                                    0
guardian_consent_requests                         0
profiles WHERE role='guardian'                   14
profiles WHERE is_under_13                        2
profiles (all)                                  115
consent_runtime_config                            0
```

Fourteen guardian profiles that have never linked anything; two under-13 profiles that have never had
a consent request created. Nothing has ever worked, so there is no regression to protect — the
charter's delete-first posture applies unchanged.

`consent_runtime_config` at **0 rows** is a blocker in its own right, not a footnote: §37.2 step 2,
§37.3 and §37.4 all read their values from it. See §6.

---

## 3. The wrong-table-shape sweep

**Method, so it can be re-run.** A parser walked 525 `.ts`/`.tsx` files outside `node_modules`,
`dist`, and `docs`, matched every `.from("<table>")`, and collected the column names referenced in the
following 30 lines from `.select()`, the filter methods (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`,
`ilike`, `is`, `in`, `order`, `contains`), the object keys of `.insert()` / `.update()` / `.upsert()`,
and `onConflict` targets. That produced **771 distinct (table, column) pairs across 60 tables**. Each
pair was then checked against production `information_schema.columns`.

### 3.1 The premise, refined

The task states that `student_user_id` and `account_id` are borrowed from `usage_rate_limit_ledger`.
Confirmed — and the borrowing account does not cover all four names:

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public'
  AND column_name IN ('linked_at','child_id','expires_at','student_user_id','account_id');
```
```
usage_rate_limit_ledger | account_id
idempotency_records     | expires_at
usage_rate_limit_ledger | student_user_id
```

Three rows for five names. So there are **two** defect classes here, not one:

- **Borrowed from another table's shape:** `student_user_id`, `account_id` — both real columns, on
  `usage_rate_limit_ledger`.
- **Invented outright:** `linked_at` and `child_id` exist on **no table in production**. They were
  not copied from anywhere; they were made up.

The distinction matters for the sweep's reach. A borrowed name can be found by asking "does this
column live on a different table?" An invented one cannot — it only shows up against the real schema.
Both classes are invisible to a generated types file, which is why neither surfaced until now.

### 3.2 Confirmed instances

| Table | Referenced but absent | Table exists? | Call sites |
|---|---|---|---|
| `guardian_links` | `student_user_id`, `account_id`, `linked_at` | yes | `account.ts:11,50,77,103,136,542,579,604` |
| `guardian_consent_requests` | `child_id`, `expires_at` | yes | `guardian-consent-routes.ts:62,70,156,164,293,335,405,410,435`; `profile-routes.ts:269-272,296-301` |
| `guardian_link_audit` | all 9 referenced columns | **no** | `durable-rate-limiter.ts:20,47`; `guardian-routes.ts:78` |
| `account_members` | all 4 referenced columns | **no** | `account.ts:195` (`getAccountIdForUser`) |
| `entitlements` | `stripe_customer_id` | yes | Stripe surface — **reported, not touched** (§0 substitution) |

`guardian_links` never references `student_profile_id`, `initiated_by`, `initiated_at`,
`accepted_at`, or `accepted_by_profile_id` anywhere in the codebase. Five of twelve columns have no
reader and no writer.

### 3.3 Sweep false positives, corrected

The raw sweep also flagged `guardian_consent_requests.consent_given_at`, `.email`,
`.guardian_consent`, and `profiles.account_id`, `.user_id`. **All five are parser artifacts**, not
real. The 30-line window bled across adjacent `.from("profiles")` chains — verified at
`guardian-consent-routes.ts:330-335` and `:344-346`, where those columns are read and written on
`profiles`, where they legitimately exist. Targeted greps for `profiles` + `account_id` / `user_id`
returned no output.

Recorded because Charter §2 forbids collapsing an unverified result into a finding. The sweep's
window is a known limitation of the method; every hit in §3.2 was confirmed at `file:line`.

---

## 4. `guardian_links` — the gap set against Doc 01 V8

### 4.1 The 1:1 rule, which §35 contradicts

§35 (heading verified above): *"Guardians are linked to **one or more** students via
`guardian_links`."* §31.3 (heading verified: `### **31.3 Guardian with multiple linked students**`)
specifies the derivation for that case explicitly.

The database agrees with the spec: `unique_active_link` is on
`(guardian_profile_id, student_profile_id, status)` and permits N students per guardian. **The
foreclosure is entirely in application code:**

| `file:line` | Function | What it does |
|---|---|---|
| `account.ts:39-72` | `createGuardianLink` | Two `.limit(2)` probes; throws `GUARDIAN_ALREADY_LINKED` if any other student is linked, and `STUDENT_ALREADY_LINKED` if the student has any other guardian |
| `account.ts:538-568` | `getPrimaryGuardianLink` | `.limit(2)`, throws *"1:1 invariant violated"* on >1 |
| `account.ts:575-597` | `getAllGuardianStudentLinks` | Docstring says *"Get ALL active student links"*; `.limit(2)` and throws on >1. **Plural name, singular behaviour** |
| `account.ts:600-637` | `getLinkedGuardianForStudent` | Enforces one guardian per student — a retired V6 rule V8 never restates |

### 4.2 The initiation state machine is absent

§36.1 (heading verified: `### **36.1 Initiation**`) specifies two paths, both two-step: a request is
created in `pending_student_accept` or `pending_guardian_accept`, an email goes out, the other party
accepts, and only then does `status` become `active` with `accepted_at` set.

`guardian-routes.ts:193-194` implements neither. The guardian submits a **student link code**, looked
up against `profiles.student_link_code`, and `createGuardianLink` writes `status: "active"`
immediately (`account.ts:109`). There is no pending state, no acceptance, no email.

Consequence: the `status` CHECK admits four values and the code writes exactly two (`active`,
`revoked`). `initiated_by` is `NOT NULL` with no default and is written by nothing — a correct-shaped
insert would fail on it today.

### 4.3 Rate limiting targets a table that does not exist, while the spec's mechanism does

§36.2 (heading verified: `### **36.2 Rate limiting and abuse controls**`) specifies Doc 01A
`RateLimitLedger`, bucket `guardian_link_attempts:{guardian_id}:{day}`, max 10 per guardian per day
and max 3 per student-email per day.

The code uses `guardian_link_audit` with a 15-minute window, 10 attempts, guardian only — no
per-student-email bucket at all (`durable-rate-limiter.ts:10-31`).

Production holds `rate_limit_ledger (profile_id, bucket_key, window_start, window_end, used_count,
limit_count, updated_at)` — the spec's mechanism, present and unused. `grep -rn "rate_limit_ledger"
--include=*.ts` returns four hits, all inside `tests/ci/rate-limit-sql.contract.test.ts`, which
asserts the migration's SQL text. **Zero application readers or writers.**

So the spec names a mechanism that exists in the database, and the code implements a different one
against a table that does not. The `guardian_link_audit` DDL question in §1.1 turns on this.

### 4.4 `§36.5` NOTIFY

§36.5 (heading verified: `### **36.5 Cache invalidation on link status changes**`) requires a NOTIFY
to `entitlement_invalidate` on every status change. Zero implementation — already recorded as
grounding-audit `G-06`; noted here only because it is a §36 obligation this rebuild would own.

---

## 5. `guardian_consent_requests` — §37.2 is absent, not partial

### 5.1 The token mechanism does not exist

§37.2 (heading verified: `### **37.2 Consent request flow**`) step 3: *"Guardian clicks link → lands
on consent page (no auth required; token is the auth)."* The token is the authentication mechanism,
not merely a `NOT NULL` column.

```
$ grep -rn "consent_token" --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v "^./docs/"
   (no output)
```

Zero occurrences. What stands in its place: `GET /api/consent/request/:id`
(`guardian-consent-routes.ts:55`) takes the raw request UUID from the URL path and serves the consent
record on it — an unauthenticated bearer capability in a query string. `digest8`
(`guardian-consent-routes.ts:17`) exists to keep that identifier out of logs, which is the tell.

A substitute is not an implementation. §37.2 step 8 (*"Consent token is invalidated after use"*) has
nothing to invalidate.

### 5.2 The INSERT cannot succeed

`profile-routes.ts:294-301`:

```ts
.insert({
  id: requestId,
  child_id: userId,
  guardian_email: guardianEmail!,
  status: "pending",
  expires_at: expiresAt.toISOString(),
})
```

Three `NOT NULL` columns omitted — `student_profile_id`, `consent_token`,
`consent_token_expires_at` — and two invented columns supplied. It throws rather than writing a weak
row, which is the one merciful property of the defect.

### 5.3 The status value is outside the CHECK domain

`guardian-consent-routes.ts:325` writes `.update({ status: "approved" })` and `:288` branches on
`request.status === "approved"`.

```
guardian_consent_requests_status_check
  CHECK ((status = ANY (ARRAY['pending','consented','denied','expired'])))
```

`approved` is not in the domain. **Even with every column name corrected, that UPDATE fails with
`23514`.** §37.2's own DDL uses `consented`. This is a second, independent defect on the same
statement and would not have been caught by a column-name fix.

### 5.4 The TTL is hardcoded and its config source is empty

`profile-routes.ts:292` hardcodes 14 days. §37.2 step 2 specifies
`consent_runtime_config.consent_request_ttl_days`, default 7. The table exists and holds **0 rows**,
so the spec-correct read has nothing to read. Same for §37.3's
`consent_request_resend_cooldown_minutes` and `consent_request_max_resends_per_day`, and §37.4's
`consent_expiration_deletion_days`.

### 5.5 Identity verification by Stripe charge

`POST /api/consent/create-checkout-session` and `POST /api/consent/verify-session` implement guardian
identity verification as a $0.50 Stripe Checkout charge. §37.2's eight steps are token-and-email
throughout and specify no payment. Already recorded as grounding-audit `G-26`; it is in this
workstream's scope because it is the surface §37.2 must replace, and the standing ruling was to stop
rather than remove it. **No edit was made.**

### 5.6 §37.3, §37.4, §37.5 — nothing implemented

Resend cooldown (§37.3), expiration-without-action and the 30-day auto-delete (§37.4), and consent
revocation with the 7-day delete prompt (§37.5): no code, no scheduled job, no route. `denied_at` and
`consented_at` are written by nothing.

---

## 6. Blockers that are not code

| # | Blocker | Evidence | Class |
|---|---|---|---|
| B-1 | `guardian_link_audit` absent from production while §35 states it exists and genesis defers it | `to_regclass` → NULL; `genesis.sql:18-21` | Owner ruling, then possibly DDL |
| B-2 | `consent_runtime_config` at 0 rows | `SELECT count(*)` → 0 | Owner DML |
| B-3 | RPC `ensure_account_for_user` absent; `account_members` absent | `pg_proc` sweep → `[]`; `to_regclass` → NULL | Owner ruling — these belong to the retired `accounts` model (`G-37`) |
| B-4 | WS-M migration freeze | `WS-M §4` | Any DDL from B-1 waits on M1.2 |

**No DDL was authored.** If B-1's ruling requires the audit table, it becomes a queue entry, not a
migration.

---

## 7. Why the `guardian_link_audit` ruling is not obvious

Two defensible readings, and the closure plan changes shape depending on which the owner picks:

**(a) Create it.** §35 states the table exists. Genesis deferred it only because its DDL was not
pinned in the grounded sections — an explicit "not invented here", not a rejection. Creating it
restores the spec's stated shape and both current writers keep working.

**(b) Remove it.** §36.2's rate-limiting mechanism is `RateLimitLedger`, and `rate_limit_ledger`
already exists in production, unused. `audit_logs (actor_profile_id, target_profile_id, action,
changes, context, ip_address, user_agent, created_at)` also already exists and covers §35's
traceability requirement. Under this reading `guardian_link_audit` is a third parallel path of the
kind the Stripe vertical spent its whole run collapsing, and creating it would add a table to serve a
need two existing tables already serve.

Reading (b) is the one the charter's managed-service-first and single-source-of-truth posture points
at, and it needs no DDL — which also takes B-4 off the critical path. **It is still an owner ruling,
not mine**, because §35 states the table as existing and only the owner can decide the spec is owed
an amendment. If (b) is chosen, that amendment is an SCL candidate, noted and not written.

---

## 8. Tests — the disqualified set

Both named tests are confirmed exactly as described, and the sweep found three more that hide the
`guardian_link_audit` defect.

| Test | Defect | In CI? |
|---|---|---|
| `tests/ci/guardian-linking.contract.test.ts` | Mocks `server/lib/account` wholesale (`:54`), mocks `durable-rate-limiter` to a pass-through (`:44`), mocks `supabase-server` (`:48`), and **injects `GUARDIAN_ALREADY_LINKED` itself** (`:102-105`). Names itself `Guardian Linking 1:1 Enforcement Contract` (`:94`) while asserting only the route's error-code→HTTP mapping. Guards a rule §35 contradicts | **Yes — required** |
| `tests/ci/guardian-consent.id11.contract.test.ts` | Declares `ConsentRow` with `child_id` and `expires_at` (`:39-45`) and supplies the entire database in memory (`:59-120`) | Yes |
| `tests/ci/calendar.guardian-parity.contract.test.ts:213` | Mocks `durable-rate-limiter` to a pass-through | Yes |
| `tests/ci/guardian-reporting.contract.test.ts:176,196` | Same, plus mocks `guardian_link_audit` as a table that accepts inserts | Yes |
| `tests/ci/guardian-full-length-report.contract.test.ts:52` | Same pass-through mock | Yes |
| `server/__tests__/guardian-payment-access.test.ts:39` | Mocks `guardian_links` rows | **No — unrun (`G-42`)** |

The three pass-through mocks are why a 500-on-every-link has been green in CI for the life of the
surface: every test that touches the route replaces the middleware that fails.

**None of these can fail if the behaviour it guards is deleted.** Replacements must exercise the real
modules against real Postgres; any test that mocks the module under test is disqualified by
construction.

---

## 9. Full call-site inventory

**`server/lib/account.ts`** — `getGuardianLinkForStudent:6`, `isGuardianLinkedToStudent:29`,
`createGuardianLink:39`, `revokeGuardianLink:127`, `getAccountIdForUser:191`,
`getPrimaryGuardianLink:538`, `getAllGuardianStudentLinks:575`, `getLinkedGuardianForStudent:600`,
`ensureAccountForUser:164`.

**Routes — `server/routes/guardian-routes.ts`** (mounted at `/api/guardian`, `server/index.ts:611`):
`GET /students:101`, `POST /link:155`, `DELETE /link/:studentId:327`, plus five read surfaces at
`:415, :524, :626, :724, :851`, all gated on `isGuardianLinkedToStudent`. Local `auditLog:68` writes
`guardian_link_audit` and swallows the error.

**Routes — `server/routes/guardian-consent-routes.ts`** (mounted at `/api/consent`,
`server/index.ts:398`): `GET /request/:id:55`, `POST /create-checkout-session:97`,
`POST /verify-session:186`.

**Routes — `server/routes/profile-routes.ts`**: the consent-request read and INSERT at `:268` and
`:295`.

**Client:** `client/src/pages/guardian-dashboard.tsx:283,321`;
`client/src/pages/guardian-consent-verify.tsx:58,61,71,88`.

**Interface boundary — out of edit scope, must be coordinated.**
`account.ts:686-697` `resolveLinkedPairPremiumAccessForGuardian` calls `getPrimaryGuardianLink` and
reads `link.student_user_id`. It is the entitlement surface, which §0 places out of scope. When the
link layer returns `student_profile_id`, this call site breaks. Stage 2 must name the change and the
owner must rule on who makes it — this workstream reports it and does not edit it.

---

## 10. Logging — raw identifiers, Doc 01A §14

| `file:line` | Emits |
|---|---|
| `durable-rate-limiter.ts:26, 40, 115` | `key` — the raw guardian profile id |
| `guardian-consent-routes.ts:156, 164, 435` | `childId` — the raw student profile id |

`digest8` exists at `guardian-consent-routes.ts:17` and is applied to session and request ids but not
to profile ids in the same log calls. The rebuild owns this; it is not a separate workstream.

---

## 11. Self-check

1. **Every cited section opened and its heading confirmed?** Yes — §31.3, §35, §36.1, §36.2, §36.5,
   §37.1, §37.2, §37.3, §37.4, §37.5, all read in full from
   `docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md`.
2. **Built to spec behaviour, or only to production column names?** Nothing built — this is Stage 1.
   The spec-behaviour gaps that column names alone would miss are §4.2 (the state machine), §4.3 (the
   rate-limit mechanism), §5.1 (the token as auth), and §5.3 (the status domain).
3. **Genesis verified against production before relying on it?** Yes — §1, both tables, columns and
   constraints. No drift.
4. **Does any test written here mock the module it tests?** No tests were written.
5. **Stripe or entitlement surface touched?** No. `entitlements.stripe_customer_id` (§3.2) and
   `resolveLinkedPairPremiumAccessForGuardian` (§9) are reported and unedited. The
   `503 GUARDIAN_BILLING_UNAVAILABLE` responses are untouched.
6. **DDL authored, SQL applied, anything merged?** No. All SQL was `SELECT`.
7. **Runtime artifacts printed, or code described?** Printed — production column lists, constraint
   definitions, row counts, `to_regclass` and `pg_proc` results, and the grep outputs. The one
   inference, `.from()`-chain parsing, is disclosed with its window limitation and every hit
   confirmed at `file:line` (§3.3).

---

## 12. Stopping here

Stage 1 is complete. Stage 2 (the closure plan) needs three owner rulings first, because each changes
the plan's shape rather than its detail:

1. **B-1** — `guardian_link_audit`: create it, or remove it in favour of `rate_limit_ledger` +
   `audit_logs` (§7).
2. **B-3** — `ensure_account_for_user` and `account_members`: is the `accounts` model retired on this
   surface, so `accountId` leaves these signatures entirely?
3. **§9 boundary** — who changes `resolveLinkedPairPremiumAccessForGuardian` when
   `getPrimaryGuardianLink` stops returning `student_user_id`?
