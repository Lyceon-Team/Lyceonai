# WS-GL Phase B — execution report

**Governing:** `docs/plans/WS-GL_Stage2_Closure_Plan.md` §4 (Phase B), as amended by the owner's
Phase B v2 brief. **Charter:** `docs/plans/Stripe_Vertical_Session_Charter.md` with the WS-GL §0
substitutions. **Base:** `stripe`. **Date:** 2026-08-26.

Zero DDL. No `docs/Spec/` edits. No SQL applied to production. No merges.

---

## 1. The four exit criteria — printed, not asserted

All four produced by `tests/ci/guardian-link.pg.ci.test.ts` against real PostgreSQL 16.13 with all
45 migrations applied. Verbatim run output.

### Criterion 1 — `POST /api/guardian/link` returns 2xx for an authenticated guardian

```
[WS-GL §5] POST /api/guardian/link → 202 {"data":{"link_id":"b370caa9-e7bb-482d-b53b-7c2770675943",
  "status":"pending_student_accept","student":{"id":"2222…","display_name":null}},"requestId":"wsgl-phase-b"}
[WS-GL §5] guardian_links after initiation (1 rows):
  {"guardian_profile_id":"1111…","student_profile_id":"2222…","status":"pending_student_accept",
   "initiated_by":"guardian","initiated_at_set":true,"accepted_at":null,"accepted_by_profile_id":null}
```

202, not 200: §36.1 makes the student's acceptance the only route to `active`, so the request is
accepted for processing rather than completed. Every column §36.1 requires at initiation is written;
the two acceptance columns are correctly still null.

Before this phase, this call returned **500 on every request, for the life of the surface**.

### Criterion 2 — one guardian, two students

```
[WS-GL §5] guardian_links — both pending (2 rows):
  {"student_profile_id":"2222…","status":"pending_student_accept"}
  {"student_profile_id":"3333…","status":"pending_student_accept"}
[WS-GL §5] guardian_links — TWO ACTIVE links for one guardian (§35) (2 rows):
  {"guardian_profile_id":"1111…","student_profile_id":"2222…","status":"active",
   "initiated_by":"guardian","accepted_at_set":true,"accepted_by_profile_id":"2222…"}
  {"guardian_profile_id":"1111…","student_profile_id":"3333…","status":"active",
   "initiated_by":"guardian","accepted_at_set":true,"accepted_by_profile_id":"3333…"}
[WS-GL §5] audit_logs — one row per transition (2 rows):
  {"action":"guardian_link_initiated","actor_profile_id":"1111…","target_profile_id":"2222…"}
  {"action":"guardian_link_initiated","actor_profile_id":"1111…","target_profile_id":"3333…"}
```

This is the question the workstream exists to answer. §35 — *"Guardians are linked to one or more
students"* — and §31.3 — *"If a guardian has multiple linked students, any one active premium student
grants the guardian premium derivation"* — both require it; the retired 1:1 rule refused the second
student outright. Note `accepted_by_profile_id` is the **student's** id in both rows: the acceptor is
the counterparty, which is the entire content of the two-step flow.

### Criterion 3 — the §9 test is named in a PGHOST-bearing CI job

`.github/workflows/ci.yml`, in the `practice-integration` job (the one job with a live Postgres
service), alongside the two existing PG proofs:

```yaml
      - name: Guardian link surface → real PG proof
        env:
          PGHOST: localhost
          …
        run: pnpm exec vitest run tests/ci/guardian-link.pg.ci.test.ts
```

**Not yet observed green in CI** — that happens on the push, and is the one exit artifact this report
cannot contain because it is produced by the CI run of the commit that carries it. Local green with
`PGHOST` set is recorded below; CI green is verifiable on the PR.

### Criterion 4 — both buckets write, denial observed at the limit

```
[WS-GL §5] rate_limit_ledger after initiation (2 rows):
  {"bucket_key":"guardian_link_attempts_daily","used_count":1,"limit_count":10}
  {"bucket_key":"guardian_link_email_attempts:ca2bbb37df9c6c51","used_count":1,"limit_count":3}

[WS-GL §5] statuses across 4 attempts: 202,409,409,429
[WS-GL §5] denial response → 429 {"error":{"code":"rate_limit_exceeded",
  "message":"You've reached your limit for this action. Please try again later.",
  "bucket":"guardian_link_email_attempts:ca2bbb37df9c6c51","limit":3,
  "resetAt":"2026-08-27T00:00:00.000Z","retryAfterSeconds":57077},"requestId":"wsgl-phase-b"}
[WS-GL §5] rate_limit_ledger at the denied boundary (2 rows):
  {"bucket_key":"guardian_link_attempts_daily","used_count":3,"limit_count":10}
  {"bucket_key":"guardian_link_email_attempts:ca2bbb37df9c6c51","used_count":3,"limit_count":3}

[WS-GL §5] guardian_links — revoked row (§36.3) (1 rows):
  {"status":"revoked","revoked_at_set":true,"revoked_by_profile_id":"1111…",
   "revocation_reason":"no longer required"}
[WS-GL §5] audit_logs — the revocation transition (1 rows):
  {"action":"guardian_link_revoked","actor_profile_id":"1111…","target_profile_id":"2222…",
   "changes":{"to":"revoked","from":"active","revoked_by":"guardian","revocation_reason_present":true}}
```

Two details worth reading closely:

- **The guardian bucket reads `used_count: 3`, not 4.** Four requests reached it; the fourth was
  refused by the email bucket and its guardian increment was **rolled back** per Doc 01A §47. Without
  the rollback this row reads 4 and the guardian silently loses quota to a denial on a different
  control. The test asserts 3, so removing the rollback fails it (planted, below).
- **`202,409,409,429`.** The 409s are the pair already having a pending link — and a 409 is proof the
  limiter *let the request through to the handler*. The assertion is that no attempt before the limit
  is a 429, not that all are 2xx; asserting `< 400` there would have been a wrong assertion that
  happened to be checkable.

---

## 2. Deletion manifest — grep-proven

| Deleted | Replaced by | Proof |
|---|---|---|
| `server/lib/durable-rate-limiter.ts` | `packages/shared/src/services/rate-limit-ledger.ts` | Deleted in Phase A. Remaining hits are three pass-through mocks in unrelated guardian tests and two prose references. |
| `auditLog` helper writing `guardian_link_audit` (`guardian-routes.ts:68-99`) | `auditGuardianLink` writing `audit_logs` | `grep -rn "guardian_link_audit" --include=*.ts .` → **zero code references**; only prose comments explaining the replacement. |
| `ensureAccountForUser` call sites in routes | — (accounts model retired on this surface) | `grep -rn "ensureAccountForUser" server/routes/` → **no output** |
| `accountId` param / `account_id` column across the guardian-link family | — | `grep -n "account_id" server/lib/account.ts` scoped to the guardian family → **no output**. Remaining hits are `account_members`/`usage_daily`, both out of scope and reported in the plan's §7. |
| `student_user_id`, `linked_at` column references | `student_profile_id`, `created_at` | `grep -rn "student_user_id\|linked_at" --include=*.ts .` → only prose comments and `apps/api/src/lib/rate-limit-ledger.ts` (a different surface, referred). |
| The 1:1 foreclosure — `.limit(2)` + "1:1 invariant violated" throws in `getPrimaryGuardianLink`, `getAllGuardianStudentLinks`, `getLinkedGuardianForStudent`, and the two conflict checks in `createGuardianLink` | §35's "one or more" | `grep -n "1:1 invariant" server/lib/account.ts` → **no output** |
| `tests/ci/guardian-linking.contract.test.ts` | Criterion 2's two-active-links proof | Owner-authorised retirement, 2026-08-26 (see §5). Not named in any workflow — it ran inside `pnpm run test:ci`'s directory sweep — so no branch-protection change is implied by its removal. |

**Consequence edits, declared:**

| Edit | Why forced | Behaviour delta |
|---|---|---|
| `resolveLinkedPairPremiumAccessForGuardian` reads `student_profile_id` | The callee's contract now names the column the table has | None. The field it read before exists on no table. |
| `guardian-consent-routes.ts:406` creates then accepts | `createGuardianLink` now requires an initiator, and §36.1 routes every link through a pending state | None. End state is an ACTIVE link, as before. |
| Frontend `guardian-dashboard.tsx` link form | The route's input is now the student's email per §36.1 | See §4 — this is a product-visible change and is called out, not buried. |

---

## 3. Per-test would-it-fail answers, with planted failures observed and reverted

Charter §5. Every plant was applied, the run observed, and the file restored from a backup taken
before the plant.

| # | Plant | Result |
|---|---|---|
| 1 | Restore the 1:1 rule as a check on existing **active** links | **4 passed — the plant did NOT fail the test.** Recorded as a finding about the test, not as a pass: under §36.1's two-step flow both links are created while *pending*, so an active-only check never fires. |
| 1b | Restore the 1:1 rule as it actually manifests — refuse a second link when any **occupying** (active or pending) link exists | ✅ `× §35 — one guardian holds TWO active links` — 1 failed / 3 passed |
| 2 | Write `status: "active"` directly, skipping §36.1's pending state | ✅ 3 failed / 1 passed (§36.1, §35 and §36.3 all catch it) |
| 3 | Drop the §47 rollback after an email-bucket denial | ✅ `× §36.2 — the per-email bucket denies at its limit, and the guardian bucket is rolled back` |
| 4 | Stop writing `revoked_by_profile_id` / `revocation_reason` | ✅ `× §36.3 — revocation records revoked_at, revoked_by_profile_id and revocation_reason` |
| 5 | Stop writing the `audit_logs` trail | ✅ 2 failed / 2 passed |

**Plant 1 is the one worth keeping.** It is the reason the plant discipline exists: a plausible
restoration of the deleted rule passed, and only re-planting it in the form the current code path
would actually take made the test fail. A single plant that passes is not evidence the test is
wrong — it is evidence the plant was wrong — but you cannot tell those apart without trying the
second form.

**Does any test I wrote mock the module it tests?** No. The mock boundary of
`tests/ci/guardian-link.pg.ci.test.ts` is stated in the file: the database transport and the auth
entry point are substituted. `server/lib/account`, `server/middleware/guardian-link-rate-limit`,
`packages/shared/src/services/rate-limit-ledger` and `server/routes/guardian-routes` all run for
real.

**Does every assertion require the state change as well as the response?** Yes, by construction —
each test asserts the HTTP result *and* a `SELECT` of the rows it produced. The Phase A trap (a 503
denial satisfying "not 500" while writing zero ledger rows) cannot recur here: criterion 1 asserts
the status band *and* the link row *and* two ledger rows.

---

## 4. Findings

### 4.1 The link route's input is the student's EMAIL, not a link code — and that is product-visible

§36.1 step 1: *"Guardian enters student's email on their dashboard."* `student_link_code` appears
**nowhere** in the locked spec corpus:

```
grep -rn "student_link_code\|link code\|link_code" docs/Spec/   →   no matches
```

The 8-character code was a pre-spec invention. Under "spec is canonical without exception" the input
is the email, and this also gives §36.2's per-student-email control a subject — with a code, the
address is not known until after the lookup.

**This changes what a guardian types into the dashboard.** `client/src/pages/guardian-dashboard.tsx`
is updated as a forced consequence edit. Flagging it because it is a product decision wearing an
implementation's clothes: if the code mechanism was deliberate and unrecorded, this is the moment to
say so.

The response is deliberately uninformative about whether the address belongs to a Lyceon student —
same 202 either way — because §36.1 step 3 reaches the student by email regardless, and a
distinguishing response would make this endpoint an account-enumeration oracle.

### 4.2 A3's residual gap — per-guardian, not global

Implemented per the ruling: `bucket_key = guardian_link_email_attempts:<sha256(normalised email)[0:16]>`,
`profile_id` = the **guardian**. §41's `PRIMARY KEY (profile_id, bucket_key, window_start)` then reads
"this guardian, against this email, today", without requiring the email to have a profile.

**Not fully closed, and must not be recorded as such.** N distinct guardians can each reach the limit
against the same address. §36.2's text — *"Per-student-email: max 3 link attempts per day (prevents
spam linking to an email)"* — is genuinely ambiguous between per-guardian and global scope; this
closes the per-guardian reading only. The gap is named in
`packages/shared/src/services/subject-digest.ts` and in the middleware.

### 4.3 §31.3's multi-student derivation is NOT built — entitlement surface

§31.3 says a guardian's premium derives from *any one* active premium student — a fold over all
links. `resolveLinkedPairPremiumAccessForGuardian` still resolves through a single link
(`getPrimaryGuardianLink`, now returning the oldest active link deterministically instead of throwing
"1:1 invariant violated").

Phase B removed the throw; it did **not** change the derivation, because that is a behaviour change
on the entitlement surface and outside WS-GL's edit scope (Charter §0). Consequence: a guardian with
two linked students, only the second of whom is premium, derives `free`. That is a real gap against
§31.3 and it wants an owner. It is not a regression — the previous code threw outright in that
situation.

### 4.4 `initiated_by = 'admin'` is in the CHECK and in no flow

genesis admits `('guardian','student','admin')`. §36.1 specifies two initiation paths. §36.3 mentions
admin revocation, not admin initiation. No function writes `'admin'`; the write-side type is narrowed
to the two §36.1 defines, while the read-side type admits all three because the column does.

### 4.5 The student-side halves of §36.1 and §36.3 are not mounted

`acceptGuardianLink` and `revokeGuardianLink` are written party-agnostically and are exercised from
both sides by the PG test. Only the guardian-facing HTTP routes are mounted, because the student's
"accept this guardian" and "remove guardian" controls belong on the student profile surface, not the
guardian router. Reported rather than silently omitted.

### 4.6 §36.1 step 3's email is not sent

*"Student receives email with acceptance link."* Not sent. The `notification_outbox` emission
contract governs that surface and no dispatcher exists; emitting into it is separate, declared work.
The link is created and the audit row written; nobody is notified.

### 4.7 Deliberately unchanged, reported

- `supabase-auth.ts:601-631` — the absent-RPC call on every authenticated request, inside a
  swallowing try/catch, emitting an unredacted `userId` per request. Highest-severity item this
  workstream has found. Out of scope; unchanged. Its ERROR noise during these runs is not a failure
  of this work.
- `account-routes.ts:21` — `GET /api/account/status` can only 500. Unchanged.
- The $0.50 Stripe Checkout identity charge. Unchanged.
- §36.4's unlink billing prompt, §36.5's NOTIFY (no listener — grounding audit G-07).

---

## 5. Owner decision taken during execution

`tests/ci/guardian-linking.contract.test.ts` asserted the exact 1:1 rule B3 removes. Its replacement
— criterion 2's two-active-links proof — landed in this commit, so the brief's condition ("retires
only when its replacement lands") was met. The owner ruled on 2026-08-26: **delete it now**. Done.

It was not named in any workflow file, so its removal implies no branch-protection change; it ran
inside `pnpm run test:ci`'s directory sweep.

---

## 6. Verification

| Check | Result |
|---|---|
| `pnpm -s run build` | exit 0 |
| `pnpm test:ci` | **630 passed, 43 skipped, 0 failed** (93 files) |
| `pnpm test:security` | 6 passed |
| `pnpm exec vitest run tests/ci/guardian-link.pg.ci.test.ts` (PGHOST set) | 4 passed |
| `pnpm exec vitest run server/__tests__` | 89 passed |
| `pnpm exec vitest run` (full suite) | 5 failing files — **all five failing identically on the unmodified baseline** (`fullLengthExam.runtime.contract`, `fullLengthExam`, `practice.duration-wiring`, `review-errors.mastery-bridge`, `review-session.lifecycle.contract`). Verified by `git stash`. None is on this surface. |
| `pnpm exec tsc --noEmit` on changed files | no errors |
| `pnpm exec eslint` on changed files | 5 errors, **all pre-existing**, all in the out-of-scope `accounts` functions and one calendar `any`. Baseline for `account.ts` was 14; it is now 5. |

---

## 7. Deliverables index

| Item | Where |
|---|---|
| Printed evidence set (§5's four criteria) | §1 above |
| Deletion manifest, grep-proven | §2 above |
| Per-test would-it-fail answers + planted failures | §3 above |
| A3 residual-gap statement | §4.2 above; `subject-digest.ts` |
| SCL-053 | `docs/SpecAudit/SPEC_CHANGES_LOG.md`, `PROPOSED` |
| Rate-limit config alignment referral | `docs/plans/WS-GL_PhaseB_Referrals.md` §1 |
| CI-workstream referral | `docs/plans/WS-GL_PhaseB_Referrals.md` §2 |
| SCL candidate — §35's duplicate `guardian_link_audit` table | §8 below |
| SCL candidate — §36.2/§41's inexpressible per-email bucket | §8 below |

---

## 8. SCL candidates — surfaced, NOT written

Per the standing constraint. Both need an owner ruling before anything is written.

**Candidate A — §35's `guardian_link_audit` duplicates `rate_limit_ledger` + `audit_logs`.**
Doc 01 V8 §35 closes with *"Additional audit table `guardian_link_audit` captures every status change
for traceability"*, and §36.2 adds *"Linking is also rate-limited via `guardian_link_audit` table"*.
That table does not exist in production. Its two jobs are already covered by objects that do:
`rate_limit_ledger` (Doc 01A §41) for the rate limiting, `audit_logs` for the trail. Owner ruling
2026-08-24 chose those two over creating the table. §35 and §36.2 still name it.

**Candidate B — §36.2's per-email bucket is not expressible against §41's primary key.**
§36.2 states a per-student-email limit. §41's ledger is `profile_id uuid NOT NULL REFERENCES
profiles(id)` with `PRIMARY KEY (profile_id, bucket_key, window_start)`. An address with no Lyceon
profile — the case the control exists to protect — cannot be the ledger's subject. Phase B implements
the per-guardian reading via a digest discriminator in `bucket_key`. A **global** per-email cap needs
a subject abstraction §41 cannot express: that is DDL, therefore V1.1. §36.2 also gives a bucket key
template (`guardian_link_attempts:{guardian_id}:{day}`) that double-keys two of §41's key columns —
recorded separately in the Stage 2 plan §2.2.
