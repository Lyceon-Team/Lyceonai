# Stripe Vertical — Phase 1: SCL Briefs (A–J) and Thin-Slice Definition

> **Provenance.** Owner-authored, delivered 2026-08-19 as the Phase 1 task directive (originally
> circulated as `CC_Stripe_Phase1_SCL_and_ThinSlice.md`, which had no location in this repo).
> Committed here 2026-08-20 by the Stripe vertical so the eleven SCL entries that cite it resolve to
> a durable, versioned source. **Reproduced verbatim**; the delta report from the executing session
> is appended below the rule, clearly separated. Any edit to the verbatim section is an owner edit.

---

## 0. Standing constraints

### 0.1 Stripe-native supersedes the spec — on mechanism

Owner ruling, 2026-08-19. Where Stripe documents a pattern, that pattern wins and the spec gets an SCL. This covers subscription modelling, idempotency keying, proration, consent collection at Checkout, webhook verification, and replay.

Two carve-outs, neither negotiable:

- **The Refund Policy and Subscription/Auto-Renewal Notice** are published consumer contracts with statutory backing. Stripe supplies the mechanism; it has no opinion on our windows or on California §17602. Where Stripe's default and the Notice differ, configure Stripe to match the Notice.
- **Entitlement is student-scoped.** Stripe has no concept of who a subscription is *for*. That mapping is ours.

Corollary: before hand-rolling scheduling, retries, dunning, proration, tax, or a billing portal, name the Stripe feature you rejected and why. "We already have code for it" is not a reason.

### 0.2 Assume the repo and production are dirty

Owner ruling. Nothing currently in the repo or the database is evidence of intent. Specifically:

- **Do not resurrect the 52 unrun billing/entitlement tests.** Read them for coverage intent, then write new ones. Tests written against a path we are deleting import the assumptions we are shedding.
- **Do not reconcile the four orphan Stripe Customers** on `profiles.stripe_customer_id`. They predate both current models. Abandon them.
- **Rebuild, don't patch.** Where a surface has accumulated defects, delete and rebuild from spec plus Stripe's docs.

### 0.3 Migration freeze

WS-M is in force. **Phase C requires zero DDL.** Any DDL you identify goes into a queue file, not a migration. The owner applies all SQL.

### 0.4 Evidence

`file:line` for repo claims, the literal `SELECT` and its output for production claims, Doc + section + **verified heading** for spec claims. Print the runtime artifact rather than describing the code. Absence claims carry the command and its empty output.

---

## PHASE A — Multi-student corpus verification

The audit returned Q-A3 as SPEC-SILENT. The owner has ruled multi-student **in scope at launch**, so confirm nothing was missed before the SCLs are written against a wrong premise.

Targeted searches across `docs/Spec/` and `docs/plans/`:

1. Every section describing a guardian linked to more than one student — enumerate with Doc + section + heading.
2. Any statement about *purchasing* for more than one student: a second subscription, a household or family plan, seats, quantity, or sibling pricing.
3. Every constraint that forecloses it. `getPrimaryGuardianLink` is one; find the rest — grep the guardian-link model for single-student assumptions in both spec and repo.
4. Whether any doc specifies what a guardian sees when they have several linked students with different entitlement states.
5. Doc 09 §5.2's "three paid tiers" — quote the sentence and state plainly whether they are entitlement tiers or billing periods.

**Report and stop.** Classification per the audit's scheme. No SCLs yet.

---

## PHASE B — The SCL set

Read `docs/SpecAudit/SPEC_CHANGES_LOG.md` for format before writing. All entries `PROPOSED`; only the owner promotes. Do not edit `docs/Spec/`.

Each entry: what the spec says now (cite section + verified heading), what it should say, why, what the owner must amend. Where the reason is a Stripe pattern, **link the specific Stripe doc page** — this is the supremacy ruling in action, and an SCL asserting "Stripe does it this way" without a link is not reviewable.

Write these ten. If Phase A changes the premise of any, say so rather than writing it anyway.

| # | Subject |
|---|---|
| **SCL-A** | **Stripe-native supremacy.** Records §0.1 above as governing doctrine, including both carve-outs. This one governs every future session; write it first and write it carefully. |
| **SCL-B** | **Payer identity.** The Stripe Customer is the payer, never the student-by-default. Guardian pays → guardian is Customer. Unaccompanied student → the payer is the Customer and may have no Lyceon profile. Entitlement always attaches to the student profile. Doc 01 V8 §31.4 is directionally right and the code implements retired V6. Include the consequence: `profiles.stripe_customer_id` presumes every Customer is a Lyceon user, which the unaccompanied case breaks — `metadata.student_profile_id` on the subscription becomes the authoritative mapping and the profile column a convenience index. |
| **SCL-C** | **Payer affirmation, and no ID verification.** At Checkout the person entering the card affirms they are 18+ and authorized to use the payment method, via `consent_collection.terms_of_service: required` with the language carried in `custom_text.terms_of_service_acceptance`. **Do not store the cardholder name** — it is unverified by every network and is PII duplication with no evidentiary value. What Lyceon persists is a *consent record*: session id, customer id, terms version, hash of the exact text displayed, Stripe's recorded consent value, timestamp, IP, user agent, entitled student profile, and payer relationship (`self` / `guardian` / `third_party`). No name, no address, no card data. Also record: do not prefill `customer_email` with the student's address in the unaccompanied case — the Customer email must be the payer's, because it receives receipts, renewal reminders, and the portal link. |
| **SCL-D** | **Multi-student billing shape.** One Customer per payer, one Subscription, **one SubscriptionItem per student**, each carrying `metadata.student_profile_id`. Individual billing is the one-item case. Quantity-based seats are rejected: students are not fungible, and decrementing quantity cannot express which student lost access. Consequence: `entitlements` currently carries `UNIQUE (stripe_subscription_id)` and `UNIQUE (profile_id)`, which structurally forecloses group billing. The entitlement key must become the subscription **item**. This is DDL — queue it, do not author it. |
| **SCL-E** | **Country eligibility derives from the payer's Stripe billing address.** INV-03-08 gates the student; `customer.updated` syncs to the Customer's profile, which in the guardian case is not the student's. Doc 01 §22.1 must state that student country derives from the paying Customer's billing address. Note that `profiles.country_code` is non-null on zero rows today — the invariant has no data source in either model. |
| **SCL-F** | **Country egress.** A subscriber whose billing country leaves Tier-1: `cancel_at_period_end`, access retained until the period ends, gate applied at renewal. Owner ruled (b). Record why (a) was rejected: Stripe does not automatically refund negative prorations — they land on the customer balance, and converting that to a card refund requires issuing the refund then manually zeroing the balance. Not native, so not taken. |
| **SCL-G** | **Refund events.** Doc 01 V8 §22.1's seven events omit refunds. Refund Policy §8.1 requires immediate access loss on refund, so `charge.refunded` must revoke. Also record that the Refund Policy governs over Doc 09 §5.6 on the renewal window, being the published consumer artifact. |
| **SCL-H** | **`livemode` assertion.** One Stripe account, one Lyceon environment per mode. The handler asserts `event.livemode` against the expected mode and rejects on mismatch — fail closed. Spec is silent; this creates the rule. Cite the current state: two registered endpoints, one live-mode, both pointing at Replit URLs against this database. |
| **SCL-I** | **Remove the undocumented `stripe` sync schema, and delete both webhook endpoints.** 29 tables, every one at zero rows, no owning document, no retention rule, no entry in the Doc 05D or 07E deletion cascades. Mirroring `charges` (42 cols) and `invoices` (68 cols) to serve a binary entitlement multiplies the PII footprint of a minors' product for no need we have. Already failing open: `billingStorage` calls `query_stripe_products`, which does not exist — **verified absent, zero procs matching `query_stripe%`** — returning empty product lists silently. Note the managed-service counter-argument and why it loses: managed-service-first applies to needs we have. Schema removal is DDL — queue it. Endpoint deletion is an owner dashboard action. |
| **SCL-J** | **Under-13 requires a guardian-held account and a real VPC method.** Owner ruled under-13 permitted where the guardian holds the account and the child has a supervised profile. Record that this is necessary but not sufficient: the amended COPPA Rule's compliance deadline passed 2026-04-22 and is enforceable now, and the approved consent methods are knowledge-based authentication, government ID matched against a facial image, or text-to-parent with confirmation. Email-plus covers internal-use collection only. Flag the open counsel question of whether LISA's calls to Vertex AI are internal operations or third-party disclosure, since the amended Rule requires separate consent for the latter. This is a launch gate, not a Phase C build item. |

### Phase B also produces two short artifacts

**B1 — Stripe Entitlements options memo** (`docs/plans/`, no decision). Stripe now ships its own Entitlements product — `stripe.active_entitlements` and the `entitlements.active_entitlement_summary.updated` event both appear in the sync schema. Under the supremacy ruling this deserves an argued answer, not an assumption. Argue both sides: Stripe Entitlements owning the paid/not-paid axis versus `entitlement_features`; note that Stripe cannot express age, country, abuse tier, or live-exam blocking. **Recommend nothing.** The owner rules.

**B2 — Two open questions for counsel**, stated plainly, one paragraph each:

1. Stripe provides exactly one consent checkbox. California requires auto-renewal offer terms be separate and distinct from general terms of use. Does folding "18+, authorized payer, auto-renewal, ToS" into one checkbox satisfy §17602, or does the affirmation need its own control via embedded Checkout? Spec both options; build neither yet.
2. The VPC question from SCL-J.

**Report and stop.**

---

## PHASE C — The thin slice

Only after Phase B is ruled on. **Zero DDL.** One student, one Stripe test-mode subscription, one real entitlement row, one authenticated request that passes `denyIfNotEntitled`.

Build it new. Do not adapt the existing checkout path.

1. **Checkout session creation** — `client_reference_id` = student profile id; `metadata.student_profile_id` on the subscription; `consent_collection.terms_of_service: required`; payer affirmation language in `custom_text`. Test mode.
2. **Webhook handler** — signature verification, `livemode` assertion per SCL-H, idempotency via the existing `stripe_webhook_events` 23505 gate (the `IdempotencyService` migration is a later phase; Doc 01A §38 names this handler as its pilot consumer, so implement to 01A's interface then, and do not design a local variant).
3. **Entitlement write** — from `checkout.session.completed` and `customer.subscription.*` only. Never from anything the client sends.
4. **Consent record** — persist what SCL-C specifies, into whatever table exists. If none does, **stop and report** rather than authoring DDL.
5. **One authenticated request** through the gate, end to end.

### Prerequisites the owner must complete first — verify, don't assume

- Both existing webhook endpoints deleted, one test-mode endpoint created against Vercel
- Terms of Service URL set in Dashboard → Settings → Business → Public details. `terms_of_service: 'required'` throws without it and every checkout 500s with no code-level signal.
- `docs/Spec/` Doc 01 V6 quarantined
- The $0.50 guardian verification charge deleted from `server/routes/guardian-consent-routes.ts` (:95, :127, :212, :419) — unspecified, takes a real payment from a guardian, has no disclosure or refund path

### Evidence required at completion

Print, do not describe:

- The Checkout Session object created
- The raw webhook payload received
- The `entitlements` row after processing, as a `SELECT`
- `entitlement_active(profile_id)` returning true
- The authenticated request passing the gate, with its response

For each test written: **would this fail if the behaviour it guards were deleted?** Answer per test. Plant one failure and observe the gate fail before trusting it.

### DDL queue

Everything you could not do without a migration, in one file, with the reason. Expected to include at minimum the item-level entitlement key (SCL-D), the consent record table (SCL-C), and the sync schema removal (SCL-I).

---

## Self-check before reporting any phase

1. Did I open every spec section I cited and confirm its heading?
2. Does every Stripe claim link a specific Stripe doc page?
3. Did I print runtime artifacts, or describe code?
4. Did I reuse anything from the existing Stripe path, or the unrun tests?
5. Did I author any DDL, apply any SQL, or merge anything?
6. Did I restate spec content into a working document instead of referencing it?
7. Does anything in Phase C trust a client-supplied value for an entitlement decision?

---
---

# DELTA REPORT — executing session's reading vs the briefs above

Added 2026-08-20 by the Stripe vertical, on owner instruction. Everything below this rule is the
executing session's own words, not the owner's.

**Letter → SCL number map:** A=SCL-042, B=SCL-043, C=SCL-044, D=SCL-045, E=SCL-046, F=SCL-047,
G=SCL-048, H=SCL-049, I=SCL-050, J=SCL-051, plus SCL-052 (Doc 09 vocabulary, added per the charter's
Phase B amendments).

## Deltas where the written SCL departs from the brief

Five. Four were reported at the Phase B gate and approved; the fifth is a factual correction to the
brief's own text that was silently right in the SCL and is called out here for the record.

| # | Brief says | SCL says | Status |
|---|---|---|---|
| 1 | SCL-G: "`charge.refunded` must revoke" | SCL-048 uses `refund.created` / `refund.updated`, per Stripe's Acacia 2024-10-28 changelog, which added those events so integrators stop branching on `charge.refunded`. `charge.refunded` still fires and is not wrong, but Stripe's guidance prefers `refund.*`. | **Approved** 2026-08-20 |
| 2 | SCL-D: "`entitlements` currently carries `UNIQUE (stripe_subscription_id)` and `UNIQUE (profile_id)`, which structurally forecloses group billing" | SCL-045: **only the first forecloses it.** `UNIQUE (profile_id)` is correct, is the `upsert` `onConflict` target at `server/lib/account.ts:353-370`, and must be kept. Queued D-1 drops only `entitlements_stripe_subscription_id_key`. | **Approved** 2026-08-20. Owner additionally verified `entitlements_profile_id_unique` is a unique *index*, not a table constraint — which is why it is absent from `pg_constraint` and why the brief missed it. |
| 3 | Phase A item 3: "`getPrimaryGuardianLink` is one; find the rest" | SCL-045 records four application-layer foreclosures, of which `createGuardianLink` (`account.ts:39-72`) is the binding one — it refuses the second link outright. The database forecloses nothing. | **Approved** 2026-08-20 |
| 4 | SCL-C: implies a `%consent%` sweep returning one table | SCL-044's evidence line records three (`guardian_consent_requests`, `consent_runtime_config`, `consent_runtime_config_history`). None is a billing consent artifact, so the conclusion is unchanged. | **Approved** 2026-08-20 |
| 5 | SCL-H: "two registered endpoints, one live-mode, **both pointing at Replit URLs**" | SCL-049 does not repeat the Replit claim. The `url` column of `stripe._managed_webhooks` was not read — only `id`, `livemode`, `status`, `secret IS NOT NULL`, and `enabled_events`. **The endpoint URLs are unverified by this session.** The SCL's substance does not depend on them. | **Recorded, not asserted.** Flagged here rather than carried into the SCL as an unverified claim. |

## Amendments applied after the Phase B ruling

| Item | Where |
|---|---|
| SCL-G partial refunds — §8.1 cannot carry the carve-out; interim rule is revoke on any `succeeded` refund; distinction deferred | SCL-048 + `Stripe_Open_Questions.md` Q4 |
| Parallel-paths class — entitled-status set duplicated across `entitlement_active()` and `idx_entitlements_active` | `STRIPE_DDL_QUEUE.md` D-5 |
| B1 ruled — Stripe Entitlements rejected on the Customer-keying argument | `Stripe_Entitlements_Options_Memo.md` §8 |

## Brief items with no delta

Everything else was written as specified. SCL-A/042's two carve-outs, SCL-B/043's
`profiles.stripe_customer_id`-as-convenience-index consequence, SCL-C/044's no-cardholder-name and
payer-`customer_email` rules, SCL-E/046's zero-rows note, SCL-F/047's rejection rationale for
option (a), SCL-I/050's managed-service counter-argument, and SCL-J/051's launch-gate framing all
appear as briefed. B1 argued both sides and recommended nothing as instructed, before the owner's
subsequent ruling closed it. B2 carried the two counsel questions plus the product question the
charter added.

## Phase C brief items not yet actioned

Phase C has not started. The four owner prerequisites are outstanding and verified as such in the
Phase B gate report.
