# WS-GL Stage 2 — Closure Plan

**Date:** 2026-08-24 · **Stage:** 2 of 7. Plan only. No code changed, no DDL, no SQL beyond `SELECT`.
**Reads:** `docs/plans/WS-GL_Stage1_Audit.md` (the gap set this closes).
**Governs:** `docs/plans/Stripe_Vertical_Session_Charter.md` with the WS-GL §0 substitutions.
**Owner rulings applied:** 2026-08-24 — recorded verbatim in §1.

**Design posture: as boring as possible.** Every step below consumes an object that already exists in
production or deletes one that does not. Nothing is invented, nothing is generalised, and no step
introduces a primitive the corpus already owns.

---

## 1. The three rulings, and what each one bought

| # | Ruling | Consequence for this plan |
|---|---|---|
| 1 | **`guardian_link_audit` — option (b). Do not create it.** Doc 01A Part V owns rate limiting via `RateLimitLedger`, and §36.2 names it. A bespoke table redefines another document's primitive and conflates rate-limit counting with audit trail — two concerns with canonical homes already in production. Consume `rate_limit_ledger` and `audit_logs`. | **Zero DDL. WS-M is off this workstream's critical path entirely.** See §2 for why that is stronger than expected. |
| 2 | **The `accounts` model is retired on this surface.** `accountId` leaves the signatures entirely. No table, no members table, no RPC — anything threading `accountId` carries a parameter that can never resolve. | §5. And the sweep it asked for found the retirement is **not confined to this surface** — see §7. |
| 3 | **WS-GL changes `resolveLinkedPairPremiumAccessForGuardian`.** Precedent set by Phase C repointing imports outside its surface. A field rename forced by the callee's contract, no behaviour delta; it cannot be broken by this because it currently reads a field that exists on no table. | §6, declared as a consequence edit in the deletion manifest. |

**Base:** stays on `stripe`. `CLAUDE.md`'s scope table has been corrected to route WS-GL there rather
than the reverse (owner ruling, same date) — the change is in this branch.

---

## 2. What the ruling bought, verified against production

The "no DDL" claim is stronger than the ruling needed it to be. Both primitives exist **and so does
the atomic increment function §41 specifies**:

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'rate_limit%';
```
```
rate_limit_check_and_increment | p_profile_id uuid, p_bucket_key text, p_cost integer,
                                 p_window_start timestamptz, p_window_end timestamptz, p_limit integer
```

That signature is character-for-character Doc 01A §41's (heading verified:
`## **§41 Postgres ledger implementation**`). **There is no DDL need anywhere in this plan** — not the
table, not the function, not an index.

Current state of the two primitives:

```
rate_limit_ledger              0 rows   RPC present   zero application consumers
audit_logs                     0 rows                 zero application writers
usage_rate_limit_ledger       99 rows   in use        different table, different helper — NOT TOUCHED
rate_limit_runtime_config      7 rows   all tutor_*   no guardian bucket, no bucket_definitions key
```

**Consuming these means writing the first consumer of each, not wiring into an existing helper.**
`grep -rn "rate_limit_ledger" --include=*.ts` returns four hits, all inside
`tests/ci/rate-limit-sql.contract.test.ts`, which asserts migration SQL text; `audit_logs` returns one,
a table name in `scripts/ci/check_rls_enabled.ts:28`. Stated plainly so no step is scoped as "reuse the
existing wrapper" when no wrapper exists.

### 2.1 This is not a WS-GL invention — Doc 01A §47 already prescribes it

§47's deviation box (heading verified: `## **§47 RateLimitLedger deviation box**`) names this exact
situation and its remedy. Current-state: *"`server/lib/durable-rate-limiter.ts` is a separate helper
used for guardian linking. No canonical `RateLimitLedger` interface wraps these."* Migration path step
**(2): "Consolidate `durable-rate-limiter.ts` into canonical wrapper."** Cutover criterion **(c):
"`RateLimitLedger` is the only path writing `rate_limit_ledger` table."**

§46 (heading verified: `## **§46 Consumed by**`) lists the consumer by name:
`V8 guardian linking (§36.2) | guardian_link_attempts_daily | Abuse prevention`.

**So steps A1 and A2 below are Doc 01A §47 migration-path steps 1 and 2, executed.** The owner's ruling and the spec's
own migration path are the same instruction arrived at independently.

### 2.2 One shape tension, resolved with a citation — SCL candidate

§36.2 gives the bucket key template as `guardian_link_attempts:{guardian_id}:{day}`. §41's table has
`PRIMARY KEY (profile_id, bucket_key, window_start)` — profile and window are already key columns.
Embedding `{guardian_id}` and `{day}` inside `bucket_key` would double-key both.

**Resolution:** `bucket_key = 'guardian_link_attempts_daily'` (§46's literal), `profile_id` = the
guardian, `window_start`/`window_end` = the day. §36.2's suffix is redundant under §41's shape, not
contradictory.

**SCL candidate, surfaced not written:** §36.2's key template cannot be implemented literally against
§41's primary key. One of the two should be restated.

---

## 3. Phase A — the rate-limit path

**Entry gate:** none. Everything this phase needs exists.
**Why first:** it is blocker #1 in Stage 1 §0. Until it is fixed, no route past it can be observed at
all, so no later phase can be evidenced.

| # | Step | Source | Exit proof |
|---|---|---|---|
| A1 | Add `packages/shared/services/rate-limit-ledger.ts` — the canonical wrapper §47 step 1 names, calling the existing `rate_limit_check_and_increment` RPC. `checkAndIncrement` / `rollback` / `getUsage` per §40's interface. Fail closed on RPC error. | Doc 01A §39, §40, §41; §47 step 1 | A `SELECT * FROM rate_limit_ledger WHERE bucket_key='guardian_link_attempts_daily'` returning a real row written by a real request, printed. Today the table has 0 rows and no writer. |
| A2 | Repoint the guardian-link middleware at the wrapper; delete `server/lib/durable-rate-limiter.ts`. | §47 step 2; Stage 1 §4.3 | `grep -rn "durable-rate-limiter"` → no output. Plus a request that is **allowed**, evidenced by the ledger row and a 2xx. |
| A3 | Add the per-student-email bucket §36.2 requires and the code has never had (max 3/day). | §36.2 | Two ledger rows for one link attempt — the guardian bucket and the student-email bucket — printed side by side. |
| A4 | 429 shape per §44, with `Retry-After`. | Doc 01A §44; §47 blocking condition | The 429 response headers printed from a real 11th attempt. |

**Owner action inside this phase, not delegable:** `rate_limit_runtime_config` holds 7 rows, all
`tutor_*`. There is no `guardian_link_attempts_daily` limit and no `bucket_definitions` key. §47 names
this as a blocking condition by name — *"bucket definition missing from
`rate_limit_runtime_config.bucket_definitions`."* **This is DML, not DDL** (Charter §7 reserves it to
the owner), and it is the same class as `consent_runtime_config` being empty (Stage 1 §6, B-2).

**Exit criterion:** `POST /api/guardian/link` no longer returns 500 at the middleware. Proven by a
ledger row and a response that is not 500 — not by a passing test.

---

## 4. Phase B — the §36.1 state machine

**Entry gate:** Phase A exit. The route must reach its handler before handler behaviour can be observed.

Stage 1 §4.2 established that §36.1 is absent, not partial: links are written straight to `active`,
`initiated_by` is `NOT NULL` with no default and is written by nothing, and the code takes a
`student_link_code` where §36.1 takes the student's email.

| # | Step | Source | Exit proof |
|---|---|---|---|
| B1 | Correct the `guardian_links` column references to the genesis/production names throughout `server/lib/account.ts`. | Stage 1 §1, §3.2 | A `SELECT` of a real row written through the corrected path. |
| B2 | Write the two-step flow: guardian-initiated → `pending_student_accept`; student-initiated → `pending_guardian_accept`; acceptance sets `status='active'`, `accepted_at`, `accepted_by_profile_id`. Populate `initiated_by` and `initiated_at`. | Doc 01 V8 §36.1 | One row printed in each of the three states across its lifecycle, with all four previously-unwritten columns non-null at the right step. |
| B3 | Lift the 1:1 foreclosure — `createGuardianLink`, `getPrimaryGuardianLink`, `getAllGuardianStudentLinks` (which is plural-named and singular-behaved), `getLinkedGuardianForStudent` (a retired V6 rule §35 never restates). | Doc 01 V8 §35, §31.3; Stage 1 §4.1 | `SELECT` showing two active links for one guardian — the thing §35 permits and the code refuses. |
| B4 | Revocation per §36.3 — either party, `revoked_at`, `revoked_by_profile_id`, `revocation_reason`. | Doc 01 V8 §36.3 | A revoked row printed with all three columns set. |
| B5 | Write the link audit trail to `audit_logs` (`actor_profile_id`, `target_profile_id`, `action`, `changes`, `context`), replacing the `guardian_link_audit` writes at `guardian-routes.ts:78` and the local `auditLog` helper at `:68`. | Ruling 1; §35's traceability requirement | `SELECT * FROM audit_logs` returning the link/unlink rows. Today: 0 rows, no writer. |

**Deliberately deferred, and named:** §36.5's NOTIFY to `entitlement_invalidate` is not built here. It
has no listener (grounding audit `G-07` records that the Supabase HTTP client cannot LISTEN), so
emitting it would be a write nothing reads. Recorded in Stage 1 §4.4; belongs with the entitlement
cache work, which is deferred to V1.1 in `Stripe_Gap_Closure_Plan.md` §9.

**Exit criterion:** one guardian holds two active links, each having passed through a pending state,
with an `audit_logs` row per transition — every claim a printed `SELECT`.

---

## 5. Phase C — `accountId` leaves the signatures

**Entry gate:** none within this surface; can run alongside Phase B.

Ruling 2. Inside WS-GL's scope this is subtraction only:

| # | Step | Source | Exit proof |
|---|---|---|---|
| C1 | Drop the `accountId` parameter from `createGuardianLink` (`account.ts:39-72`) and the `account_id` column write at `:108`. | Ruling 2; Stage 1 §3.2 | The signature, and `grep -n "account_id" server/lib/account.ts` scoped to the guardian-link family → no output. |
| C2 | Drop the `ensureAccountForUser` calls at `guardian-routes.ts:242` and `guardian-consent-routes.ts:403, 408`, and their imports. | Ruling 2 | `grep -rn "ensureAccountForUser" server/routes/` → no output. |
| C3 | Drop `account_id` from the return shapes of `getPrimaryGuardianLink`, `getAllGuardianStudentLinks`, `getGuardianLinkForStudent`, `getLinkedGuardianForStudent`. | Ruling 2 | The four signatures. |

**Not deleted here, and why:** `ensureAccountForUser` (`account.ts:164`), `getAccountIdForUser`
(`:191`), and `getAllAccountsForUser` (`:211`) keep live callers outside this surface — see §7. WS-GL
removes its own call sites and reports the rest. Deleting a function whose remaining caller is the auth
middleware is not this workstream's call.

---

## 6. Phase D — consent, and the §37.2 token

**Entry gate:** Phase B exit for the linking half (§37.2 step 6 creates a `guardian_links` row).

| # | Step | Source | Exit proof |
|---|---|---|---|
| D1 | Implement `consent_token` as the authentication mechanism §37.2 step 3 specifies — *"no auth required; token is the auth."* A cryptographically random token, stored, matched, single-use, invalidated per step 8. Replace the raw-request-UUID-in-the-URL capability at `guardian-consent-routes.ts:55`. | Doc 01 V8 §37.2; Stage 1 §5.1 (`grep consent_token` → zero hits) | A consent request row printed with `consent_token` **redacted at the boundary** — the digest, never the value — and the same token rejected on second use. |
| D2 | Correct the INSERT at `profile-routes.ts:294-301` to supply all three `NOT NULL` columns (`student_profile_id`, `consent_token`, `consent_token_expires_at`) and drop the invented `child_id` / `expires_at`. | Stage 1 §5.2 | A written row. Today the statement throws. |
| D3 | **Correct `"approved"` to `"consented"`** at `guardian-consent-routes.ts:288` (read) and `:325` (write). | `guardian_consent_requests_status_check` admits `('pending','consented','denied','expired')`; Stage 1 §5.3 | A completed consent row with `status='consented'` and `consented_at` set. **This defect is independent of the column names** — the UPDATE fails `23514` even after every column is corrected. |
| D4 | Read the TTL from `consent_runtime_config.consent_request_ttl_days` instead of the hardcoded 14 days. | Doc 01 V8 §37.2 step 2; Stage 1 §5.4 | The configured value printed, and an expiry computed from it. **Owner DML prerequisite:** the table holds 0 rows. |
| D5 | §37.3 resend cooldown and max-per-day, through the Phase A wrapper rather than a second mechanism. | Doc 01 V8 §37.3 | A ledger row for the resend bucket; the second resend inside the cooldown refused. |

**Out of scope, unchanged, reported:** the $0.50 Stripe Checkout identity charge
(`create-checkout-session` / `verify-session`) stays untouched — Charter §0 places the Stripe surface
out of edit scope and the standing ruling was to stop rather than remove it. §37.2 specifies
token-and-email throughout and no payment; that remains an open owner question, not a WS-GL edit.

**Also out of scope:** §37.4 (expiration → 30-day auto-delete) and §37.5 (revocation → 7-day delete)
both drive the soft-delete flow in Doc 01 V8 Part VII. That is the deletion lifecycle surface, not this
one. Reported, not built.

---

## 7. The `accounts` retirement is wider than this surface — the finding ruling 2 asked for

> *"if it's retired here it's likely retired everywhere, and that's its own finding."*

It is. Every remaining reference, `file:line`:

| `file:line` | What it does | Resolves? |
|---|---|---|
| `server/middleware/supabase-auth.ts:603` | Calls `ensureAccountForUser` on **every authenticated student or guardian request** | **No** — RPC absent |
| `server/lib/account.ts:164-186` | `ensureAccountForUser` — the RPC wrapper | No |
| `server/lib/account.ts:191-205` | `getAccountIdForUser` — reads `account_members` | No — table absent |
| `server/lib/account.ts:211-230` | `getAllAccountsForUser` — reads `account_members` joined to `accounts` | No — both absent |
| `server/routes/account-routes.ts:21` | `GET /api/account/status` calls `getAllAccountsForUser` | No |
| `server/lib/account.ts:439-480` | `incrementUsage` — writes `usage_daily.account_id`; the column is real, the value's only source is not | **Dead** — zero callers |
| `server/routes/guardian-routes.ts:242` | WS-GL scope — removed by C2 | — |
| `server/routes/guardian-consent-routes.ts:403, 408` | WS-GL scope — removed by C2 | — |

**The auth-middleware instance is the serious one, and it is worse than dead code.**
`supabase-auth.ts:601-631` calls the absent RPC for every student and guardian request, inside a
`try/catch` that logs `logger.error("AUTH", "account_ensure_failed", …)` and continues. So on the
current deployment:

- the call fails on **100 % of authenticated student/guardian requests**;
- the failure is swallowed, so nothing surfaces it as an outage;
- it emits one `ERROR`-level log line per request — an error channel that is pure noise, which is how a
  real error in that channel would be missed;
- that log line carries `userId` **unredacted**, on every request (Doc 01A §14).

`account-routes.ts:21` is a second live instance: an authenticated route that can only 500.

**Reported, not edited** — both are outside WS-GL's substituted scope (Charter §0). They are named here
because ruling 2 asked for the sweep and because the auth-middleware instance is the highest-severity
thing this workstream has found. It wants an owner and is not a billing item.

---

## 8. The mock-the-failing-dependency pattern — a repo-wide finding, not three coincidences

**Named class: a test that neutralises the thing it exists to observe.** Three recorded instances, one
shape.

| # | Instance | How it neutralises | Recorded in |
|---|---|---|---|
| 1 | `genesis-schema.expected.sql` compared against a snapshot of its own output | The gate's input is its own output, so it passes under the regression it guards | `WS-M_Migration_Integrity.md` §0.2, which named it a **tautological test** — *"an assertion that passes under the regression it guards against"* |
| 2 | `tests/ci/guardian-linking.contract.test.ts:54` mocks `server/lib/account` wholesale | The 1:1 invariant it names in its own `describe` is enforced inside the mocked-out function, so it asserts only a route's error-code→HTTP mapping | SCL-045 evidence; `WS-GL_Guardian_Link_Data_Layer.md:96` — *"every test that touches these functions mocks the module"* |
| 3 | `calendar.guardian-parity:213`, `guardian-reporting:176`, `guardian-full-length-report:52` each mock `durable-rate-limiter` to a **pass-through** | The middleware that returns 500 on every request is replaced by `next()`, so a route broken for the life of the surface stayed green in the required `ci` job | `WS-GL_Stage1_Audit.md` §8 |

Instance 1 was named as a class and scoped to self-referential gates. Instances 2 and 3 are the same
class reached by a different route — mocking the dependency whose failure is the finding — and were
each recorded as a local defect of their own workstream. **Three separate incident reports of one
failure mode is itself the finding.** The unifying property: *the test replaces the component whose
real behaviour is the only thing that would have failed.*

**Proposed repo-wide gate, scoped and not built here** — a CI check that fails when a test file mocks a
module that the file under test imports at runtime, i.e. `vi.mock('X')` where `X` is in the transitive
import graph of the route or module the test's `describe` names. The three instances above are its
negative controls: it must fail on all three before it is trusted (Charter §5). **This is a
CI-workstream item, not a WS-GL one.** WS-GL's obligation is §9 — replacing its own five.

---

## 9. Tests — the five replacements

Any test that mocks the module it tests is **disqualified by construction**; reproducing that pattern
here would be the deepest possible failure of this workstream.

| Retire | Replace with | Would the replacement fail if the behaviour were deleted? |
|---|---|---|
| `guardian-linking.contract.test.ts` (**required check** — retires only when its replacement lands, never before) | Two active links for one guardian, against real Postgres | Yes — restoring any `.limit(2)` throw fails it |
| `guardian-consent.id11.contract.test.ts` | Real `guardian_consent_requests` rows through the real route | Yes — it cannot be satisfied by an in-memory shape with `child_id` |
| `calendar.guardian-parity`, `guardian-reporting`, `guardian-full-length-report` — the three pass-through mocks | Real wrapper against real Postgres, with the rate limiter allowed to deny | Yes — a broken limiter now fails them, which is the whole point |

**Every replacement gets a planted failure observed and reverted**, per Charter §5. A gate never
observed failing is not known to work — and this surface is the proof of that rule, not an exception to
it.

**The first test to write, before any of the five:** one that asserts `POST /api/guardian/link` does
**not** return 500 for an authenticated guardian, with nothing mocked. It fails today. It is the
regression test for the defect this entire workstream exists to close, and it is the only one whose
red-to-green transition is evidence that the surface works.

---

## 10. Deletion manifest (planned)

| Deleted | Replaced by | Why |
|---|---|---|
| `server/lib/durable-rate-limiter.ts` | `packages/shared/services/rate-limit-ledger.ts` | §47 migration step 2; targets a table that does not exist |
| `auditLog` helper, `guardian-routes.ts:68-99` | `audit_logs` writes | Ruling 1 |
| `guardian_link_audit` insert, `guardian-routes.ts:78` | same | same |
| `accountId` parameters and `account_id` columns across the guardian-link family | — | Ruling 2 |
| The raw-UUID capability at `guardian-consent-routes.ts:55` | `consent_token` per §37.2 | Stage 1 §5.1 |
| The five tests in §9 | real-Postgres replacements | §9 |

**Consequence edit, declared per ruling 3.** `resolveLinkedPairPremiumAccessForGuardian`
(`account.ts:686-697`) reads `link.student_user_id` at `:697`. When `getPrimaryGuardianLink` returns
`student_profile_id`, that read is renamed. It is the entitlement surface and outside WS-GL's edit
scope, taken under ruling 3's precedent: a field rename forced by the callee's contract, no behaviour
delta, and unbreakable by this change because the field it reads today exists on no table.

---

## 11. What this plan does not do

- **No DDL, and none is needed** (§2). WS-M's freeze does not gate any step here.
- **No `guardian_link_audit`.** Ruling 1.
- **No spec edits.** Two SCL candidates surfaced and not written: §35 naming a table that duplicates
  two existing primitives (ruling 1), and §36.2's bucket key template being unimplementable against
  §41's primary key (§2.2).
- **No edits outside the substituted scope.** §7's five references and the $0.50 charge are reported.
- **No test that mocks the module it tests.** §9.
- **Nothing executed.** Every exit proof in this document is a statement of what would constitute
  proof, per Charter §2. None has been obtained.

---

## 12. Owner prerequisites before Stage 3

Two DML seeds, both the same class as each other and neither DDL:

1. `rate_limit_runtime_config` — the `guardian_link_attempts_daily` limit and the per-student-email
   limit. §47 names its absence as a blocking condition. Phase A cannot exit without it.
2. `consent_runtime_config` — 0 rows; §37.2 step 2, §37.3, §37.4 all read it. Phase D steps D4 and D5
   cannot exit without it.

Everything else in Phases A–D is `READY`.
