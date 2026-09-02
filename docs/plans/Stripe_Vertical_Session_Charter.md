# Stripe Vertical — Session Charter

> **Provenance.** Owner-authored, delivered 2026-08-19 as a session directive. Committed here
> 2026-08-20 by the Stripe vertical because eleven SCL entries (SCL-042…SCL-052) cite it and it had
> no durable location — the same unversioned-source problem those SCLs keep flagging, pointed the
> other way. **Reproduced verbatim.** Any edit is an owner edit.

Owner ruling, 2026-08-19. Governs this session end to end.

Companion documents, referenced not restated:

* `docs/SpecAudit/STRIPE_GROUNDING_AUDIT.md` — accepted grounding, plus the Phase A addendum and the G-28 correction
* `docs/plans/Stripe_Phase1_SCL_and_ThinSlice_Briefs.md` — the ten SCL briefs (A–J) and the thin-slice definition

Those files hold the detail. This one holds the rules. Where they conflict, this file wins.

## 1. Authority order

When two sources disagree, the higher one wins. No exceptions, no judgement calls.

1. The Refund Policy and Subscription/Auto-Renewal Notice. Published consumer contracts with statutory backing. Stripe supplies mechanism; it has no opinion on our windows or on California §17602.
2. Stripe's own documentation — on mechanism. Subscription modelling, idempotency keying, proration, consent collection, webhook verification, replay, dunning. Where Stripe documents a pattern, that pattern wins and the spec gets an SCL.
3. `docs/Spec/` — on product truth. Who a subscription is for, what entitlement means, what a guardian may see. Stripe cannot arbitrate these.
4. `supabase/genesis.sql` — for schema naming, subject to §3.
5. Nothing else. Repo code and CI tests carry zero authority and are presumed defective.

Doc 01 V8 is canonical. V6 is retired; if a V6 file is still present in `docs/Spec/`, treat it as absent and report it.

## 2. Evidence discipline

* Print the artifact, don't read the code. The webhook payload, the entitlement row, the Checkout Session object, the request body. Not the type, not the handler, not a description of the flow. When you would write "X is handled correctly," print X instead.
* `file:line` for repo claims. The literal `SELECT` and its output for production claims. Doc + section + verified heading for spec claims — open the section and confirm it says what you claim. A citation whose heading doesn't match its use is a finding.
* Every Stripe assertion links a specific Stripe documentation page. An SCL claiming "Stripe does it this way" without a link is not reviewable, and unlinked appeals to Stripe-native turn the ruling into an excuse for whatever you already wanted to build.
* Absence requires proof — the command and its empty output, on more than one search term. Never report a failed command as a zero result.
* Never restate spec content into a working document. Reference by document and section. A plan that enumerates a spec's table list becomes a second unversioned source of truth that drifts.

## 3. Schema naming — genesis first, prod verifies

`supabase/genesis.sql` is the naming reference for authoring. Use it for every table, column, function, and constraint name so nothing is written against remembered or invented shapes.

But genesis is a repo artifact, and the repo is dirty. Twenty-nine migrations are unrecorded in the ledger, and application code has already been found targeting `guardian_links` columns that exist nowhere — `student_user_id`, `account_id`, `linked_at`. Genesis is claimed to mirror production; that claim is unverified.

Before Phase C, run a drift check across the billing and entitlement surface: `genesis.sql` versus `information_schema.columns` filtered to `table_schema='public'`, for `entitlements`, `stripe_webhook_events`, `entitlement_features`, `entitlement_runtime_config`, `profiles`, `guardian_links`. Report column-level deltas.

If they agree, use genesis freely. If they disagree, production wins, genesis gets a defect record, and you say so loudly — a mirror that isn't one is more dangerous than no mirror, because it is trusted.

## 4. Deletion authority

This vertical is not closed while dead code from the old path remains.

In scope: billing, entitlement, and Stripe surfaces. Delete, then rebuild from spec and Stripe.

Out of scope — report, never edit: the guardian-link data layer, `resolvePaidKpiAccessForUser` and its LISA call sites, and `guardian-linking.contract.test.ts`. That last one is a required green check enforcing a retired 1:1 rule; the owner retires it, bundled with SCL-D's promotion, never before. Removing it early leaves the invariant unenforced with no replacement.

Delete-first is safe here and only here. Zero entitlement rows, zero webhook events, zero rows across all 29 sync tables. Nothing has ever worked, so there is no regression to protect. This is a fact about this surface, not a general licence.

Do not reconcile the four orphan Stripe Customers. Do not resurrect the 52 unrun tests — read them for coverage intent, then write new ones.

## 5. Tests

Build to spec and Stripe, then update tests to match. Never the reverse. A test that disagrees with the spec is retired, not accommodated.

For every test you write: would this fail if the behaviour it guards were deleted? If not, it is decoration. This repo has shipped tests asserting functions that never existed and static guards matching patterns absent from the codebase.

A gate that has never been observed failing is not known to work. Plant the failure, watch it fail, then trust it.

Zero new entries on `ci-known-gaps`.

## 6. Safety invariants

* No caller-supplied value gates an entitlement decision. Entitlement derives from Stripe's webhook events and the database. A client claiming to be entitled is a client, not a fact. This includes deriving a decision from whether a field is present — a caller controls that too.
* Fail closed. Every gate denies on error, never permits.
* Never collapse an error into a legitimate empty value. A failed lookup is not an empty result set.
* Signature verification and `livemode` assertion precede all processing.
* No secrets, card data, or raw payer PII in logs.

## 7. Irreversible operations — owner only

The owner performs every one: migrations, merges, secret rotation, Stripe dashboard changes, flag activation.

**Every DDL change lands in three places: a migration file, production, and `genesis.sql`.** Author the migration under `supabase/migrations/` and fold the identical end state into `00000000000000_genesis.sql`, which is the schema reference in the repo. The OWNER applies the change to production — an agent never does, and the Supabase connector stays read-only. `scripts/ci/genesis-fresh-apply.sh` then proves on every CI run that the pipeline reproduces the committed snapshot, so a migration that disagrees with genesis fails before it reaches a review.

Genesis is the reference for names, production is the reference for existence. Where the two disagree, report it — never pick silently.

The migration freeze (WS-M) is GONE, permanently, by owner ruling 2026-09-01. `docs/plans/WS-M_Migration_Integrity.md` was deleted in `aa4fd40`, and this paragraph used to assert the freeze while citing that deleted file — a dangling citation of exactly the class this program keeps catching. The freeze does not come back.

You work on `claude/*` branches, open draft PRs, never merge, never force-push a shared branch.

## 8. Communication

The owner is terse and overrides freely. Give the ruling, the key reason, the next action. No status theatre, no restating these rules back.

Push back when something over-engineers, reinvents a platform-native pattern, adds structure where less would do, or breaks a core pillar. State the pushback, the reason, and the trade-off, then let the owner decide. Agreement that turns out wrong costs more than disagreement that turns out wrong.

Managed-service first. Before implementing scheduling, queueing, retries, dunning, proration, tax, or a billing portal, name the Stripe feature you rejected and why. "We already have code for it" is not a reason.

## 9. Direction

Three phases, hard gates between them. Report and stop at each. Phase A is complete and ruled on.

### Phase B — the SCL set

Write the ten SCLs (A–J) per the briefs in `docs/plans/Stripe_Phase1_SCL_and_ThinSlice_Briefs.md`, with the Phase A amendments already ruled:

* SCL-D also records the application-layer foreclosure (`createGuardianLink` refuses the second link) and the CI gate that must retire with it. Cite Doc 01 V8 §36.4 — "You are still paying for this student's subscription" — as spec-level support for per-item granularity over a quantity model.
* SCL-B cites Refund Policy §10's existing contemplation of a third-party payer.
* Add a short vocabulary SCL against Doc 09 §5.2: "tier" there means billing period, not entitlement level.

The guardian-link data-layer breakage is a defect, not an SCL — the spec is right and the code is wrong. Record it as a defect with its own workstream and name it in the plan as a blocking dependency for the guardian-paid path. Do not fix it.

Also produce B1 (Stripe Entitlements options memo — argue both sides, recommend nothing) and B2 (open questions: the two for counsel, plus the guardian-multi-student-display question flagged as product, not legal).

Before starting Phase B, resolve the outstanding Phase A question: `guardian-linking.contract.test.ts` is green, but if `createGuardianLink` queries columns that don't exist, the first link should throw and the second-link 409 should be unreachable. Determine why it passes — mock, different path, or a 409 arriving for an unrelated reason. The third case is a hollow test in its subtlest form and is a finding.

### Phase C — the thin slice

Only after Phase B is ruled on. Zero DDL. The unaccompanied-student path — it exercises the payer-affirmation model, which nobody has built, and it avoids the dead guardian-link layer entirely.

One student, one Stripe test-mode subscription, one real entitlement row, one authenticated request through `denyIfNotEntitled`. Built new. Run the §3 drift check first.

Owner prerequisites — verify, do not assume: both existing webhook endpoints deleted and one test-mode endpoint created against Vercel; Terms of Service URL set in Dashboard → Settings → Business → Public details (`terms_of_service: 'required'` throws without it and every checkout 500s with no code-level signal); Doc 01 V6 quarantined; the $0.50 guardian verification charge removed.

Deliverables: the printed evidence set per the thin-slice brief, the deletion manifest, and the DDL queue.

## 10. Closure

This vertical closes when, and not before:

* Every item in the audit's §3.1 repo inventory is marked kept / rebuilt / deleted, each with the spec section or Stripe doc page that replaces it
* Grep-proven zero remaining references to every deleted symbol
* Every deleted test replaced by one built to spec, or justified in writing
* Zero new `ci-known-gaps` entries
* Dead database objects queued for removal — `_rl_has_active_entitlement` is used by zero policies, verified
* Every DDL need queued, none authored

## 11. Self-check before reporting any phase

1. Did I open every spec section I cited and confirm its heading?
2. Does every Stripe claim link a specific Stripe doc page?
3. Did I print runtime artifacts, or describe code?
4. Did I use genesis names, and did I verify them against production?
5. Did I delete anything outside the billing/entitlement surface?
6. Did I author DDL, apply SQL, or merge?
7. Does anything trust a client-supplied value — including field presence — for an entitlement decision?
8. Would each test I wrote fail if the behaviour it guards were deleted?

---

## Amendments after the Phase B ruling (owner, 2026-08-20)

Recorded here so the charter stays the single rules document. Not part of the 2026-08-19 verbatim text above.

1. **Phase B approved.** All four brief corrections accepted (SCL-G `refund.*` over `charge.refunded`; SCL-D `UNIQUE(profile_id)` kept; SCL-D foreclosure wider than `getPrimaryGuardianLink`; `%consent%` sweep returns three tables).
2. **SCL-D verified independently against production.** `entitlements_profile_id_unique` exists as a unique *index*, not a table constraint — which is why it is absent from `pg_constraint` and why the brief missed it. It is a valid `onConflict` target. D-1 as queued is correct.
3. **SCL-G amended** for partial refunds. Refund Policy §8.1 cannot carry a partial-no-revoke carve-out; the distinction became `Stripe_Open_Questions.md` Q4.
4. **New DDL queue item D-5** — parallel-paths class: the entitled-status set exists in two independent copies (`entitlement_active()` body and `idx_entitlements_active` predicate).
5. **B1 ruled — Stripe Entitlements REJECTED**, on the Customer-keying argument, not the seven-versus-one count. `entitlement_features` stays, as data.

## Amendment to §5 Tests (owner, 2026-08-27)

**A plant that fails to fail is a FINDING requiring a second formulation — never evidence the test
works.**

§5 already says to plant the failure and watch it fail. It did not say what to do when the plant
*passes*. The tempting reading — "the behaviour must be covered some other way" — is exactly
backwards: a plant that does not fail proves the test cannot see the defect it names.

The rule: when a plant passes, the test is not validated, it is **disproven**. Reformulate the test
so the plant fails, and keep the reformulated test. State in the commit that the second formulation
exists because the first could not catch the defect — that sentence is the audit trail.

Two instances, both real:

1. **The 1:1 rule under the two-step flow (WS-GL Phase B).** The planted violation did not fail
   because the guard was reached only on a path the test never drove.
2. **The refund list-price substitution (Phase 3 §4.3, 2026-08-27).** Substituting a hard-coded list
   price for `charge.amount` **passed**. Every handler refund test used charge `4900`, equal to the
   planted list price, so the substitution was arithmetically invisible and the tests were not
   pinning SCL-072 at all. Second formulation: a **discounted** charge — 2450 charged, 2450 refunded,
   where charged and list differ. The same plant then failed. That test exists solely because the
   first formulation could not catch it.

The common shape in both: the plant was invisible because the *fixture* made two different values
coincide. When choosing plant values, prefer inputs where the correct and incorrect implementations
must diverge — equal values hide substitutions.
