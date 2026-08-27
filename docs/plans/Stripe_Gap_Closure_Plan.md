# Stripe Vertical — Gap Closure Plan

**Type:** Sequencing plan. **Not an SCL, not a spec document.** No new rules are created here.
**Date:** 2026-08-21 · **Status:** Proposed. Owner rules before anything is built from it.
**Scope:** current state → launch-ready on the billing / entitlement surface.

---

## 0. How to read this

**Every line item traces to a source.** Nothing in this plan is invented scope. The sources are:

| Short form | Document |
|---|---|
| `SCL-0NN` | `docs/SpecAudit/SPEC_CHANGES_LOG.md` — the eleven Stripe entries, 042–052, all `PROPOSED` |
| `G-NN` / `Q-NN` | `docs/SpecAudit/STRIPE_GROUNDING_AUDIT.md` §4 gap register (47 rows) and §5 open questions |
| `PCE §N` | `docs/plans/Stripe_Phase_C_Evidence.md` |
| `D-N` | `docs/plans/STRIPE_DDL_QUEUE.md` |
| `PRE §N` | `docs/plans/Stripe_Phase_C_Preflight.md` |
| `WS-M §N` / `M0.N` | `docs/plans/WS-M_Migration_Integrity.md` |
| `WS-GL §N` | `docs/plans/WS-GL_Guardian_Link_Data_Layer.md` |
| `SWEEP §N` | `docs/plans/Replit_Remnant_Sweep.md` |
| `CH §N` | `docs/plans/Stripe_Vertical_Session_Charter.md` |
| `OQ Q1–Q4` | `docs/plans/Stripe_Open_Questions.md` |
| `MEMO §8` | `docs/plans/Stripe_Entitlements_Options_Memo.md` |

Cited by reference only. This document never restates what a source says; it sequences it.

**Blocker classes.** Exactly one per item.

| Class | Meaning |
|---|---|
| `READY` | Buildable now. No external dependency. |
| `OWNER` | Needs a Dashboard action, a secret, a merge, or SQL. Not delegable. |
| `COUNSEL` | Needs a legal ruling or a published artifact amended. |
| `FREEZE` | Needs DDL. Blocked behind WS-M M1.2 (`WS-M §4`). |
| `EXTERNAL` | Depends on another workstream — WS-GL or the Replit purge. Named per item. |

**Exit proof, not completion claims.** Every item names the artifact that proves it done: a printed
runtime value, a `SELECT` and its output, a Stripe delivery log entry, or a planted failure observed
and reverted. Per `CH §5`, a gate never observed failing is not known to work. **No item in this plan
exits on CI-green alone** — including the items that add CI checks.

**No dates, no effort estimates.** The critical path runs through counsel rulings and a migration
freeze whose gate criterion is itself stale (§8.2). Day counts would be fiction.

---

## 1. The definition of launch-ready — adopted, with three challenges

The proposed definition is adopted as the target:

> A real payer completes a live-mode purchase; the correct student receives entitlement; cancellation
> delivers the access already paid for; a refund revokes access; both guardian-paid and
> unaccompanied-student paths work; ARL consent is captured with a durable record; secrets are
> environment-scoped; and no gate exists that has not been observed failing.

Three challenges, each against a source rather than a preference. None of them rejects the
definition; two add to it and one flags a clause whose premise is contested.

### 1.1 "A refund revokes access" rests on a premise counsel has not ruled

`SCL-048`'s launch gate records that two published consumer documents conflict on whether refunds
exist at all — Student Terms §11 against the Refund Policy's four refund paths — and that both sit at
authority level 1 under `CH §1`, so the authority order cannot resolve it. `SCL-048` states plainly
that if the Student Terms were to govern there would be no refund path to revoke on.

The clause is therefore **conditional, not merely unbuilt**. The engineering item (handle `refund.*`,
revoke at `succeeded`) is `READY` and is scheduled in Phase 2. Whether the rule it implements is the
operative one is `COUNSEL`. The plan schedules the mechanism and marks the rule contested; it does
not design around the conflict, per the standing instruction on the three legal launch gates.

### 1.2 The definition omits country eligibility, which is a live invariant with no data source

`INV-03-08` (cited in `SCL-046`) gates LISA access on billing-address country. `G-10` records that
`requires_tier_1_country` is `true` on all eight `entitlement_features` rows and is read by zero
application code. `SCL-046`/`SCL-047` evidence records `profiles.country_code` non-null on 0 of 115
rows, and `G-12` records `entitlement_runtime_config` at 0 rows — so the Tier-1 country list the gate
would read does not exist either.

Launching against this definition as written ships LISA with a compliance invariant enforced nowhere.
**Proposed addition to the definition:** *the billing-address country is populated for entitled
students and the Tier-1 gate is enforced from configured data.* Phase 5 carries the work either way;
the owner rules whether it is launch-blocking or V1.1.

Note the coupling the standing instruction anticipated: the **complete** country rule spans all three
payer cases and its guardian-paid half blocks on WS-GL (`WS-GL §4`, `SCL-046`). The unaccompanied
half does not — payer and student are the same profile, so no link is read. The plan splits it rather
than deferring the whole feature behind a workstream that only gates part of it.

### 1.3 Deferring the billing portal to V1.1 contradicts a requirement already cited in an SCL

`SCL-042`'s evidence names the Auto-Renewal Notice §6.4 click-to-cancel requirement as the case where
the carve-out bites in Stripe's favour — the Billing Portal is configured to permit cancellation
*rather than* Lyceon building a bespoke surface. That is a launch requirement with a named mechanism,
not a V1.1 nicety.

It is also further along than the deferral implies: `POST /api/billing/portal` is built and calls
`billingPortal.sessions.create` (`server/routes/billing-routes.ts:264-311`). What is absent is the
Dashboard portal configuration and a client entry point.

**Recommendation:** move the portal out of the deferred list and into Phase 2. If the owner intends
the deferral to mean something narrower — deferring the *client surface* while the Dashboard
configuration ships — the plan should say so, because as written the deferral removes the only named
mechanism satisfying §6.4. **SCL candidate**, noted and not written: no entry states which surface
discharges §6.4.

---

## 2. Phase 1 — the live end-to-end purchase

**The expectation was that Phase 1 is unblocked today. The evidence half-agrees, and the half that
disagrees is the important half.**

*Unblocked* is correct in the sense that **no engineering work remains on it.** The code path is
built, merged (`bc9188d`), and its artifacts are printed in `PCE §3`. Engineering contributes nothing
further to this phase.

*Executable today* is false. Every remaining link is `OWNER`, and one of them is a hard stop:
`PRE §1` item 0b records a "Needs Attention" badge on both `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` whose meaning is unresolved, and the standing instruction was not to proceed
past it on an assumption. Beneath that, `PRE §5` records that both registered endpoints point at
**dead Replit hosts** on the path `/api/stripe/webhook` while the application mounts
`/api/billing/webhook` — which is why `stripe_webhook_events` has never held a row.

**Entry gate:** the vertical's code is merged to `stripe`. Met — `bc9188d`.

| # | Item | Source | Class | Exit proof |
|---|---|---|---|---|
| 1.1 | Resolve the "Needs Attention" badge on both Stripe secrets; establish what it means before anything downstream is trusted | `PRE §1` item 0b, `PRE §4` | `OWNER` | The badge's meaning stated, and the badge cleared. Screenshot or Vercel CLI output. No downstream item exits while it stands. |
| 1.2 | Scope `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` per environment — test values in preview and development, live in production only | `SCL-049` amendment; `PRE §3` | `OWNER` | `vercel env ls` output showing three distinct environment scopes. **This precedes 1.5.** With one key across all environments the mode assertion is structurally blind — see §2.1. |
| 1.3 | Delete both registered endpoints; register endpoints at the Vercel domains, path ending `/api/billing/webhook`, one per mode | `SCL-050` owner action 1; `SCL-049`'s one-account-one-environment-per-mode rule; `PRE §5`; `G-21` | `OWNER` | The Dashboard endpoint list showing the correct hosts and path. `stripe._managed_webhooks` is a stale mirror and is not evidence. **Note a gap in the source:** `SCL-050`'s owner action provisions *one test-mode endpoint*. A live-mode purchase — the definition's first clause — additionally requires a live-mode endpoint against production. Either the owner action is incomplete or the live endpoint is deliberately later; the plan cannot tell which and does not guess. |
| 1.4 | Bind the new endpoint's signing secret to `STRIPE_WEBHOOK_SECRET`, per environment | `SCL-049`; `G-22` (secret currently also in Postgres) | `OWNER` | A delivery that verifies. Proven by 1.5, not separately. |
| 1.5 | Execute one live-mode purchase on the unaccompanied-student path and capture the five artifacts `PCE §3.6` names as unproven | `PCE §3.6`; `CH §2` | `OWNER` (execution) over `READY` (code) | All five: the Stripe Checkout Session object Stripe returned; the Stripe delivery log entry showing 2xx; `SELECT * FROM stripe_webhook_events WHERE event_id = …`; `SELECT * FROM entitlements WHERE profile_id = …`; `SELECT entitlement_active('<profile_id>')` → `true`; and one authenticated request passing `denyIfNotEntitled` (`server/routes/tutor-runtime.ts:185-196`). |
| 1.6 | Observe the `livemode` gate fail against a real delivery — deliver a test-mode event to the production URL (CLI forwarding, or a temporary test-mode endpoint pointed at production) and confirm rejection | `SCL-049`; `CH §5` | `OWNER` | A non-2xx in the Stripe delivery log, plus the structured log line naming the mismatch. The gate is currently proven only by unit test (`tests/ci/stripe-client-mode.contract.test.ts`); it has not been observed failing in the environment the assertion exists to protect. |

**Exit criterion:** a real entitlement row exists in production, written by a real Stripe delivery,
and one real gated request passed on the strength of it — every artifact printed, not described.
Until 1.5 produces output, `entitlements` remains at 0 rows and nothing downstream has a subject.

### 2.1 Why 1.2 is a prerequisite and not a parallel task

`SCL-049`'s amendment establishes that a shared secret makes the mode assertion structurally blind:
every environment computes the same expected mode and asserts it identically, so a preview deployment
holding the live key would accept a live event and write a real entitlement row.

**That argument survives the post-audit change and must not be assumed closed by it.** `PCE §8.1`
finding 1 replaced the `STRIPE_ENV` selector with derivation from the secret-key prefix, which removes
a *second* source of truth. It does not un-share the key. If preview holds the live key, the derived
mode is `live`, a live event matches, and the write happens. The enforcement point is still Vercel
scoping; the handler assertion is still defence in depth.

---

## 3. Phase 2 — the events that make the lifecycle honest

**Entry gate:** Phase 1 exit. A live entitlement row must exist before revocation can be proven
against anything.

The handler currently dispatches four event types — `checkout.session.completed` and the three
`customer.subscription.*` (`server/lib/stripe/webhook-handler.ts:44-46, 282`). Doc 01 V8 §22.1
specifies seven, and `SCL-048` adds the refund family.

| # | Item | Source | Class | Exit proof |
|---|---|---|---|---|
| 2.1 | Handle `refund.created` / `refund.updated`; revoke entitlement when the refund reaches `succeeded` | `SCL-048`; `G-36` | `READY` (mechanism) · rule is `COUNSEL` per §1.1 | Stripe delivery log for a real refund event; `SELECT status FROM entitlements WHERE profile_id = …` before and after; the same gated request from 1.5 now denied. Plus a planted failure on the status gate observed and reverted. |
| 2.2 | Cancellation delivers access already paid for — `cancel_at_period_end` honoured through `current_period_end` | definition §1; `SCL-047` rationale (Stripe does not auto-refund negative prorations) | `READY` | A cancelled subscription with `cancel_at_period_end = true`; `SELECT status, current_period_end FROM entitlements` showing access retained; `entitlement_active()` still `true` before the period end and `false` after. |
| 2.3 | Configure the Stripe Billing Portal to permit cancellation; expose the entry point | `SCL-042` evidence (Auto-Renewal Notice §6.4 click-to-cancel); route exists at `billing-routes.ts:264-311` | `OWNER` (Dashboard config) + `READY` (client entry) | The portal configuration object printed from the Dashboard; a real portal session URL returned by `POST /api/billing/portal`; a cancellation completed through it and visible in 2.2's `SELECT`. **See §1.3 — this is currently on the deferred list and should not be.** |
| 2.4 | Handle `invoice.payment_succeeded` — confirm entitlement, update `current_period_end` | `G-03` (the handler previously handled `invoice.paid`, a different event) | `READY` | Stripe delivery log; `SELECT current_period_end` advancing across a renewal. |
| 2.5 | Handle `invoice.payment_failed` → past-due grace transition driven by `grace_period_ends_at` | `G-04`; `G-14` (column exists in prod, never written, never read) | `READY` | `SELECT status, grace_period_ends_at FROM entitlements` after a failed payment; `entitlement_active()` still `true` inside the grace window and `false` past it. |
| 2.6 | The "not Used the Service since the Renewal Charge" activity signal that Refund Policy §4.1 conditions the renewal refund on | `SCL-048` evidence; `G-35` — recorded there as a build item, not an SCL | `READY` | A printed timestamp comparison for a real account: last activity against the renewal charge time. |
| 2.7 | Observe the fifteen Phase C gates that were argued from the assertion rather than watched failing | `PCE §5` — eighteen rows, three planted failures observed; `PCE §8.1` adds four observed on separate tests; `CH §5` | `READY` | Each of the fifteen: the planted failure, the observed failure output, the revert, the re-verified green. Three of the eighteen are done. |

**Exit criterion:** for one real subscription, every entitlement-affecting transition — purchase,
renewal, failed payment, cancellation, refund — has been driven by a real Stripe delivery and
evidenced by a `SELECT` on either side of it. Not one of them asserted from a unit test alone.

---

## 4. Phase 3 — ARL consent capture

**Entry gate — three conditions, all outside engineering:**
1. WS-M M1.2 passed, so D-2 can be applied (`WS-M §4`; `D-2`).
2. `OQ Q1` ruled — one Stripe Checkout consent control against California §17602(a)'s
   separate-and-distinct requirement.
3. The terms version string reconciled. `SCL-044`'s launch gate records the page header reading
   `2024-12-20` and the PDF reading `12/20/2025`, and states that a wrong displayed version makes
   every consent record wrong for its whole retention life.

**Nothing in this phase starts before all three close.** Building consent capture against an
ambiguous version writes records that must later be discarded, which is worse than not writing them.

| # | Item | Source | Class | Exit proof |
|---|---|---|---|---|
| 3.1 | Rule `OQ Q1` — one checkbox vs separate-and-distinct | `OQ Q1`; `SCL-044` | `COUNSEL` | The written ruling, and the surface it names. |
| 3.2 | Reconcile the terms version string to a single source | `SCL-044` launch gate | `COUNSEL` | Both artifacts showing one identical version string, and the single source it is read from. |
| 3.3 | Resolve Student Terms §11 against the Refund Policy | `SCL-048` launch gate | `COUNSEL` | Amended published document. Gates §1.1 and item 2.1's rule. |
| 3.4 | Apply the consent-record table | `D-2`; `SCL-044` item 4 | `FREEZE` → `OWNER` | The applied migration recorded in `schema_migrations`, and `\d` of the created table. |
| 3.5 | Set the Terms of Service URL in Dashboard business public details | `SCL-044` rationale — a hard prerequisite that fails silently; `PRE §1` item 3, deferred by ruling and explicitly not set as a workaround | `OWNER` | The configured URL printed from the Dashboard. |
| 3.6 | Approve the affirmation text | `SCL-044` rationale — Stripe's own caution makes the language counsel-owned | `COUNSEL` | The approved text and its hash, matching what 3.7 persists. |
| 3.7 | Add `consent_collection[terms_of_service]` + `custom_text` to Checkout and persist the consent record | `SCL-044`; `G-33` | `READY` once 3.1–3.6 close | The Stripe Checkout Session showing `consent.terms_of_service = accepted`; `SELECT` of the persisted row showing timestamp, version, text hash, entitled student profile, payer relationship; a planted failure proving checkout is refused when the record cannot be written. |

**Exit criterion:** one real purchase produced one durable consent record whose version string matches
the published document and whose text hash matches the approved text — both printed side by side.

---

## 5. Phase 4 — guardian-paid and multi-student

**Entry gate — four conditions:**
1. WS-GL fixed (`WS-GL §4`: *"the guardian-paid path cannot be built or tested until this is fixed"*).
2. WS-M M1.2 passed, so D-1 can be applied.
3. D-1 applied.
4. `SCL-045` promoted, bundled with retiring `tests/ci/guardian-linking.contract.test.ts`.

**The EXTERNAL dependency, named.** WS-GL must deliver: the `guardian_links` code references
corrected to the genesis/production column names (`WS-GL §1` — production has no `student_user_id`,
no `account_id`, no `linked_at`), and the same drift corrected on `guardian_consent_requests`
(`WS-GL §8` — the code targets `child_id` and `expires_at`, neither of which exists). `WS-GL §7`
records the workstream as **unowned**; assigning an owner is item 5.1 and is upstream of everything
else in this phase. `WS-GL §5` fixes the order: the column drift first, then `SCL-045`'s cardinality
change — fixing the 1:1 rule against wrong column names produces a path that still throws.

| # | Item | Source | Class | Exit proof |
|---|---|---|---|---|
| 5.1 | Assign an owner to WS-GL | `WS-GL §7` item 1 | `OWNER` | The assignment. Nothing else in this phase can start. |
| 5.2 | Correct the `guardian_links` column references | `WS-GL §1`, `§2` | `EXTERNAL` → WS-GL | A real guardian link resolved end to end: `SELECT` of the row, and the route returning it rather than throwing. |
| 5.3 | Correct the `guardian_consent_requests` column references; §37.2 is absent, not partial | `WS-GL §8`, `§8.1` | `EXTERNAL` → WS-GL | One consent request created and consumed against real columns, printed. |
| 5.4 | Apply D-1 — drop `entitlements_stripe_subscription_id_key`; add `stripe_subscription_item_id TEXT UNIQUE`. **`entitlements_profile_id_unique` is kept** | `D-1`; `SCL-045` evidence | `FREEZE` → `OWNER` | `SELECT conname, pg_get_constraintdef(oid)` before and after, showing the subscription-id unique gone, the item-id unique present, and the profile-id unique untouched. |
| 5.5 | Lift the application-layer 1:1 foreclosure in `createGuardianLink`, `getPrimaryGuardianLink`, `getAllGuardianStudentLinks` | `SCL-045` evidence (`account.ts:39-72, 538-568, 575-597`) | `READY` after 5.2, 5.4 | Two active links for one guardian, printed from `SELECT`. |
| 5.6 | Retire `tests/ci/guardian-linking.contract.test.ts`, bundled with `SCL-045`'s promotion and never before | `SCL-045` owner action 3 | `OWNER` (ruling) + `READY` (removal) | The removal in the same change as the cardinality lift, and a replacement gate asserting the new invariant with its planted failure observed. |
| 5.7 | One subscription, one item per student, `metadata.student_profile_id` per item; entitlement keyed on the item | `SCL-045`; `SCL-043` | `READY` after 5.4 | `SELECT profile_id, stripe_subscription_id, stripe_subscription_item_id FROM entitlements` showing two rows sharing one subscription id and carrying distinct item ids — the exact shape D-1 exists to permit. |
| 5.8 | Replace `503 GUARDIAN_BILLING_UNAVAILABLE` on checkout / status / portal | `PCE §4` deletion manifest | `READY` after 5.7 | A guardian-initiated purchase entitling a linked student, evidenced as in 1.5; and the planted failure on the removed blocker observed. |
| 5.9 | Under-13: amend Student Terms §2, supply a Rule-compliant VPC method, rule `OQ Q2` | `SCL-051` launch gate; `OQ Q2` | `COUNSEL` | Amended published document; the named VPC method; the written ruling on whether LISA's Vertex AI calls are third-party disclosure. `SCL-051` states both must close — amending §2 does not supply a method and supplying a method does not fix §2. |

**Exit criterion:** one guardian funds two students on one subscription; both students hold
entitlement rows; neither route returns the named blocker; the retired 1:1 gate has a successor whose
failure has been observed.

---

## 6. Phase 5 — country eligibility

**Entry gate:** `customer.updated` can resolve a payer to an entitled student. For the unaccompanied
case that is true after Phase 1. For the guardian and third-party cases it requires Phase 4 item 5.7,
because the mapping lives in subscription-item metadata (`SCL-046`, `SCL-043`).

| # | Item | Source | Class | Exit proof |
|---|---|---|---|---|
| 6.1 | Seed `entitlement_runtime_config` — Tier-1 countries, grace days, trial days, min age, cache TTL, hard staleness | `G-12` (`SELECT count(*)` → 0, zero application reads); Doc 01 V8 Appendix A.4 as cited there | `OWNER` (DML, per `CH §7`) | `SELECT * FROM entitlement_runtime_config` returning the configured row. |
| 6.2 | Handle `customer.updated` → write the payer's billing country to the **entitled student's** `profiles.country_code` | `SCL-046`; `G-02` | `READY` (unaccompanied) · `EXTERNAL` → WS-GL + 5.7 (guardian, third-party) | `SELECT count(*) FROM profiles WHERE country_code IS NOT NULL` moving off 0; the specific row printed after a real `customer.updated` delivery. |
| 6.3 | Enforce `requires_tier_1_country` — currently `true` on all eight feature rows and read by zero code | `G-10`; `INV-03-08` via `SCL-046` | `READY` after 6.1, 6.2 | A denial for a non-Tier-1 student printed with its reason, and the matching allow for a Tier-1 student. Planted failure on the gate observed. |
| 6.4 | Country egress — set `cancel_at_period_end`, access to period end, gate at renewal | `SCL-047` | `READY` after 6.2 | The subscription showing `cancel_at_period_end = true` after an egress `customer.updated`; access retained through `current_period_end`, evidenced as in 2.2. |

**Exit criterion:** `INV-03-08` is enforced from configured data against a populated column, for at
least one real student in each direction. Today it is enforced nowhere — that is the state 6.3 exits.

---

## 7. Phase 6 — hygiene and vertical closure

**This phase has no dependents.** Nothing in Phases 1–5 waits on it, which is why it sits last; its
position is a consequence of the dependency graph, not a judgement about importance. Its only entry
gate is WS-M M1.2 for the three DDL items.

| # | Item | Source | Class | Exit proof |
|---|---|---|---|---|
| 7.1 | `DROP SCHEMA stripe CASCADE` | `D-3`; `SCL-050`; `G-20` | `FREEZE` → `OWNER` | `SELECT nspname FROM pg_namespace WHERE nspname='stripe'` returning zero rows. |
| 7.2 | Drop `public._rl_has_active_entitlement(uuid)` | `D-4`; `CH §10` | `FREEZE` → `OWNER` | `pg_proc` sweep returning zero rows. Zero-policy use already verified (`D-4`). |
| 7.3 | Derive the entitled-status set from one source, or CI-guard the drift between `entitlement_active()` and `idx_entitlements_active` | `D-5` | `FREEZE` or `READY` depending on which option is ruled | If CI-guarded: the check, plus a planted divergence observed failing. Not CI-green alone. |
| 7.4 | Rule on the unrun test surface — wire in or delete | `G-42`; `OQ` item 17 | `OWNER` (ruling) then `READY` | Either the CI job executing them with output, or their deletion with a grep proving zero references. |
| 7.5 | Rename `STRIPE_PRICE_PARENT_*` → `STRIPE_PRICE_PREMIUM_*` | `PRE §6` — proposal only; the `PARENT_` prefix encodes a payer assumption `SCL-043` breaks | `OWNER` | The renamed variables in `vercel env ls`, and the parity check green against the renamed schema keys. |
| 7.6 | Complete `CH §10` closure — every item in the audit's §3.1 repo inventory marked kept / rebuilt / deleted with its replacing citation | `CH §10` | `READY` | The completed inventory table. Deletions are already grep-proven (`PCE §4`); the kept and rebuilt columns are not yet marked. |
| 7.7 | Replit purge outside the billing surface — the E2E `baseURL` default first | `SWEEP §4` | `EXTERNAL` → Replit purge workstream | Per `SWEEP §4`'s ordering. Item 1 (`tests/playwright.config.ts:8`) is the live default pointing at a dead host. |

---

## 8. Critical path

### 8.1 To the live end-to-end purchase

```
1.1 badge resolved  →  1.2 per-environment scoping  →  1.3 endpoint registered
                    →  1.4 signing secret bound     →  1.5 purchase executed
                    →  1.6 livemode gate observed failing
```

**Every link is `OWNER`. None is engineering.** That is the finding, and it is the sense in which
"Phase 1 is unblocked today" is both true and misleading: engineering has no remaining work, and
engineering also cannot advance the chain by one step. The code was merged at `bc9188d`; from there
the path runs entirely through the Stripe Dashboard and Vercel environment configuration.

`1.1` is a stop, not a step — an unresolved badge on both secrets means the credentials the whole
chain depends on are in an unknown state.

### 8.2 To launch

```
WS-M M0.2 → M0.3 → M1.1 (owner) → M1.2 ─┬→ D-2 → Phase 3 consent
                                        └→ D-1 → Phase 4 guardian → Phase 5 country

counsel, in parallel and independent of the freeze:
  OQ Q1 (checkbox vs §17602)  ─→ Phase 3
  terms version reconciliation ─→ Phase 3
  Student Terms §11 vs Refund Policy ─→ the premise under Phase 2 item 2.1
  Student Terms §2 + VPC method + OQ Q2 ─→ Phase 4 item 5.9

WS-GL owner assigned → column drift fixed → Phase 4 → Phase 5 (guardian half)
```

**The non-engineering links dominate, as expected — and one of them is worse than expected.**

- **Counsel gates four separate things**: the consent surface (`OQ Q1`), the version string, the
  refund premise, and the entire under-13 cohort. Two of the four are amendments to *published*
  consumer documents, which is the slowest form of the dependency.
- **The migration freeze gates both DDL branches**, and its own gate criterion is stale. `WS-M`
  M1.2's acceptance reads *"`schema_migrations` returns 32 rows matching the 32 repo files exactly."*
  `supabase/migrations/` now holds **45** files, and `G-43` records 16 ledger rows with 29
  unrecorded; `G-44` records 13 migrations authored after the freeze. **M1.2 as written cannot pass**
  — the criterion counts a repo that no longer exists. M0.2 and M0.3 have no recorded completion
  either; only M0.1 is marked COMPLETE. This is not an SCL matter (WS-M is a plan, not spec) but it
  is an amendment the owner must make before the freeze can lift, and it is the single longest pole
  in §8.2. **It is upstream of everything in Phases 3, 4 and 5 that needs a table or a constraint.**
- **WS-GL is unowned** (`WS-GL §7`). An unowned workstream on the critical path is a stall with no
  scheduled end. It gates the guardian path, the third-party payer path, the guardian half of country
  eligibility, and — via the guardian-held-account model — the under-13 cohort.

**Where engineering sits on the critical path:** almost nowhere. Phase 2's items are `READY` and
depend only on Phase 1's owner chain. Everything else waits on counsel, on the freeze, or on WS-GL.

---

## 9. Deferred to V1.1

Each with the ruling that deferred it and the trigger for revisiting.

| Item | Deferred by | Trigger to revisit |
|---|---|---|
| **Stripe Entitlements owning the paid axis** | `MEMO §8` — ruled REJECTED 2026-08-20 on the Customer-keying argument. The memo is closed. | Only if the Customer-keying constraint changes — i.e. if Stripe gains a concept of who a subscription is *for*. `SCL-042` carve-out 2 says it does not. |
| **`canAccessFeature` full contract** — `{allowed, reason, entitlementSnapshot}` and the 7-step evaluation order | `G-08`, `G-09` — steps 1 and 5 implemented, 2/3/4/6/7 absent | When a second denial reason must be distinguishable to a caller. **Note the coupling:** `G-10`'s gating columns carry live values read by nothing, and Phase 5 item 6.3 needs the country step. Deferring the whole contract while shipping one of its steps needs a ruling on where that step lives. **SCL candidate**, noted not written. |
| **`IdempotencyService` migration** — Stripe webhook dedupe under the canonical service | `G-05`, `G-47` — the table exists in prod and no service writes it; the raw constraint-checked 23505 gate stands in | When a second mutation surface needs the same scope, or when `idempotency_records` acquires its first writer. |
| **Restricted-key migration** (`rk_*`) | Not separately ruled; `server/lib/stripe/client.ts` already accepts `rk_live_`/`rk_test_` prefixes | When the secret key's blast radius is scoped down — the mode derivation already supports it, so this is configuration, not code. |
| **Multi-currency** | `G-46` — Doc 09 §6.7 is USD-only; Auto-Renewal Notice §3.2 requires local-currency display in all Tier-1 markets. A directional doc against a published legal artifact | The first non-US Tier-1 market that is actually opened. `G-46` is an unresolved contradiction, not a settled deferral. |
| **In-process entitlement cache**, 60s TTL, hard staleness | `G-13` | When entitlement read volume justifies it. `G-12` gates it either way — the TTL lives in `entitlement_runtime_config`, which is empty. |
| **`NOTIFY entitlement_invalidate` + LISTEN loop** | `G-06`, `G-07` — `G-07` records that the Supabase HTTP client cannot LISTEN | Depends on the cache above. Without a cache there is nothing to invalidate. |
| **Dunning notification cadence** Day 0 / 3 / 6 / 8 | `G-15` — no email or notification path on any billing event | When Phase 2 item 2.5's grace transition exists and has something to notify about. |
| **`stripeCancellationQueue`** durable queue + retry worker | `G-16` — `to_regclass` → NULL | On the first observed cancellation-write failure. Managed-service-first (`CH §8`) applies: name the rejected Cloud Tasks alternative before building a Postgres queue. |
| **Canonical-writer CI linter** | `G-17` | With WS-M M3.2, which builds the adjacent `ci/single-migration-root` check. |

**Not deferred, contrary to the proposed list: the billing portal.** See §1.3 — `SCL-042` cites
Auto-Renewal Notice §6.4 as a launch requirement and the route is already built. Scheduled as item
2.3, pending the owner's ruling.

---

## 10. Standing risk list

True now. None is blocking; each can bite later.

| Risk | Source | Why it bites |
|---|---|---|
| **The 29-table `stripe` schema is live** pending owner DDL | `G-20`; `SCL-050`; `D-3` | No owning document, so no retention rule and no deletion cascade entry. All tables are at 0 rows and the ACL grants no `anon`/`authenticated`, so this is cost and principle today. It becomes exposure the moment anything starts writing — and `stripe-replit-sync` has been removed (`SWEEP §1`), so nothing should. Until D-3 is applied, "nothing should" is a belief, not a constraint. |
| **The unrun test surface** | `G-42`; `PCE §4` | Two of the five original files remain (`guardian-payment-access.test.ts`, `deletion-lifecycle.test.ts`) alongside a wider set of unrun files. Tests that execute in no job are indistinguishable from tests that pass, which is how `guardian-linking.contract.test.ts` came to assert an invariant enforced in a mocked-out function (`SCL-045` evidence). |
| **`_rl_has_active_entitlement` is dead in production** | `G-45`; `D-4` | A second named entitlement entry point invisible to `entitlement.single-evaluator.contract.test.ts`, which scans TypeScript only. It delegates correctly and fails closed today. The risk is a future policy attaching to it and creating a second evaluator nobody is looking at. |
| **Replit remnants outside billing scope** | `SWEEP §1`, `§4` | `tests/playwright.config.ts:8` silently targets a dead host when `BASE_URL` is unset — an E2E suite that appears to run and tests nothing. `.replit:47` carries `V4_DEBUG_AUTH_BYPASS = "true"`, dead today with zero readers, live again if that config is ever restored. |
| **The credential sweep covered the working tree only** | `SWEEP §2` | Zero real credential values found, and that finding does not extend to git history. A value committed and later removed would not appear. Stated as a bounded negative, not a clean bill. |
| **`entitlements_profile_id_unique` is an index in prod and a table constraint in genesis** | `PCE §2.1` | Object-level drift with no practical impact — `ON CONFLICT (profile_id)` resolves against either. It is the reason a `pg_constraint`-only reading got the Phase 1 brief wrong, and it will mislead the next reader the same way. |
| **The `stripe._managed_webhooks` mirror is stale** | `PRE §5`; standing instruction | It is not evidence of Dashboard state and must not be read as such — including after item 1.3 changes that state. |
| **Four orphan `profiles.stripe_customer_id` rows** | `SCL-043` evidence | Predate both payer models, abandoned per `CH §4`. They will not resolve to a Stripe Customer under the current model. |
| **The migration freeze has been violated 13 times** | `G-44`; `WS-M §4` | Each post-freeze migration enlarges the M0.2 replay set that must be verified before the freeze can lift, so the violations lengthen the very gate they bypass. |

---

## 11. SCL candidates — noted, not written

Per the standing constraint, these are surfaced and stopped at. None is appended to the log.

1. **Which surface discharges Auto-Renewal Notice §6.4 click-to-cancel.** `SCL-042` cites the
   requirement and names the Billing Portal as the mechanism, but no entry states that the portal is
   the launch surface for it. §1.3 above turns on this.
2. **Whether `entitlement_runtime_config` must be populated at launch, and who owns seeding it.**
   `G-12` records it empty with zero application reads; Doc 01 V8 Appendix A.4 requires it to hold
   the Tier-1 list, grace days, trial days and min age. Phase 5 item 6.1 assumes it must be seeded;
   no entry says so.
3. **Whether `G-10`'s gating columns are launch-required or should be dropped.** `required_age_minimum`,
   `blocked_during_live_exam`, `min_abuse_score_tier` carry live values on all eight feature rows and
   are read by zero code. Deferring `canAccessFeature` to V1.1 (§9) leaves them permanently
   decorative unless a ruling says otherwise.

---

## 12. What this plan does not claim

- **No item here has been executed.** This is a sequencing document produced from the sources in §0.
- **No exit proof in this document has been obtained.** Every one is a statement of what would
  constitute proof, per `CH §2`.
- **The phase boundaries are derived, not decreed.** Where a phase could be split or merged without
  changing the dependency graph, that is a presentation choice and the owner may re-cut it.
- **Nothing here overrides a source.** Where this plan and a cited document disagree, the cited
  document is right and this plan is defective.
