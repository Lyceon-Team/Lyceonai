# Stripe Validation Matrix

**Owner: Agent A (Core).** Other agents propose rows via PR comment; A merges them.

**Status: published for row assignment.** Filled against current code on
`claude/stripe-grounding-audit-u2tus0` @ `9effe91` (PR #674, green, unmerged).

Governing: `Stripe_End_To_End_Flow.md` §0/§9 (paths), SCL register 042–076 (rules),
Parallel Execution Plan §1 (this file is the coordination artifact).

> **A row is claimed by exactly one agent, and claimed before work starts.**
> An empty cell is a defect. A *wrongly filled* cell is worse, because it reads
> as verified — see Finding 1.

---

## 1. Method

Every cell below was read out of the code, not carried over from the previous
round. Call sites are invocation lines, verified by printing the line. Gate
claims are verified by locating the gate's enclosing function and confirming the
path reaches it.

Counts, printed from the source:

| quantity | value | source |
|---|---|---|
| subscribed events | 19 | `event-surface.ts` `SUBSCRIBED_EVENTS` |
| HANDLED | 10 | `EVENT_DISPOSITION` |
| ignored (stated reason each) | 9 | `EVENT_DISPOSITION` |
| production `upsertEntitlement` call sites | 3 | grep, repo-wide |
| other writes to `entitlements` | 0 | all remaining touches are `.select` |

---

## 2. The chokepoint, verified

The country gate is **not** wired per call site. It sits inside the two writers,
conditioned on the effect:

| writer | defined | gate | write |
|---|---|---|---|
| `writeEntitlementFromSubscription` | `webhook-handler.ts:479` | `:506` `if (tier === "premium")` | `:533` |
| `writeEntitlementsForAllItems` | `webhook-handler.ts:1078` | `:1139` `if (tier === "premium")` | `:1195` |
| `revokeAllProfiles` | `webhook-handler.ts:779` | *(none, by design)* | `:784` |

Consequences, and why this is the structure §4A asks for:

- Every granting path that routes through a writer **inherits** the gate. A new
  granting path cannot omit it without also bypassing the sole writer.
- `if (tier === "premium")` is what keeps revocation ungated. `customer.subscription.deleted`
  reaches the same writer with `tier = "free"` and is therefore not country-gated.
  The asymmetry is a property of the guard, not of a caller remembering.
- `upsertEntitlement` (`account.ts:562`) is the **sole writer**, verified: its only
  production callers are `:533`, `:1195`, `:784`. Every other reference to the
  `entitlements` table in production (`account.ts:488`, `:530`,
  `account-deletion-execute.ts:53`) is a `.select` read.

Route side gates separately, at `billing-routes.ts:271–277`, with the
branch-then-gate ordering: `isAddItem ? deniesEntitlement(...) : blocksCheckout(...)`.

**Chokepoint verdict: expressible and expressed on the webhook side.** The route
side is a second derivation point by necessity (no Stripe event exists yet at
checkout time). That is two derivation points, not one — recorded here rather
than hidden, per §4A's instruction to say so when a single chokepoint is not available.

---

## 3. The matrix

Gate keys: **SIG** signature · **LM** livemode (SCL-049) · **IDEM** `stripe_webhook_events`
insert-once (23505) · **SHAPE** Zod boundary parse · **SETL** settlement (SCL-071) ·
**CTRY** INV-03-08 Tier-1 (SCL-046) · **PLINK** Payment Link refusal · **SUBJ** subject
resolved against active `guardian_links` · **PROV** charge→invoice→subscription
provenance · **AUTH** session + role · **SEL** selected student is an active link.

| # | Path | Trigger | Effect | Gates | Writer | Idempotency | Test | Call site |
|---|---|---|---|---|---|---|---|---|
| 1 | Checkout completed, settled | `checkout.session.completed` | grant | SIG LM IDEM SHAPE PLINK SETL CTRY SUBJ | `fulfilCheckoutSession` → writer | event id insert-once; upsert on `profile_id` | `stripe-settlement.contract.test.ts` | `webhook-handler.ts:1522` (settle check `:1508`) |
| 2 | Delayed payment settled | `checkout.session.async_payment_succeeded` | grant | SIG LM IDEM SHAPE PLINK SETL CTRY SUBJ | `fulfilCheckoutSession` → writer | event id insert-once; upsert on `profile_id` | `stripe-settlement.contract.test.ts` | `webhook-handler.ts:1522` (settle check `:1508`) |
| 3 | Delayed payment failed | `checkout.session.async_payment_failed` | none | SIG LM IDEM | none — grants nothing, revokes nothing (SCL-071) | event id insert-once | `stripe-settlement.contract.test.ts` | `webhook-handler.ts:1526` |
| 4 | Subscription created | `customer.subscription.created` | grant | SIG LM IDEM SHAPE CTRY SUBJ | `writeEntitlementsForAllItems` \| `writeEntitlementFromSubscription` | event id insert-once; upsert on `profile_id` | `stripe-lifecycle-gate.contract.test.ts` | `webhook-handler.ts:1578` (fan-out) / `:1583` (single) |
| 5 | Subscription updated | `customer.subscription.updated` | extend | SIG LM IDEM SHAPE CTRY SUBJ | as row 4 | event id insert-once; upsert on `profile_id` | `stripe-lifecycle-gate.contract.test.ts` | `webhook-handler.ts:1578` / `:1583` |
| 6 | Subscription canceled | `customer.subscription.deleted` | revoke | SIG LM IDEM SHAPE — **no CTRY, by design** | `writeEntitlementFromSubscription` (tier=free) | event id insert-once; upsert on `profile_id` | `stripe-lifecycle-gate.contract.test.ts` | `webhook-handler.ts:1583` |
| 7 | Chargeback opened | `charge.dispute.created` | revoke | SIG LM IDEM SHAPE PROV — **no CTRY** | `revokeAllProfiles` (`pause_collection` first, SCL-073) | event id insert-once; upsert on `profile_id` | `stripe-dispute.contract.test.ts` | `webhook-handler.ts:1473` |
| 8 | Dispute closed in our favour | `charge.dispute.closed` | restore | SIG LM IDEM SHAPE PROV CTRY SUBJ | `rederiveEntitlementsForSubscription` (resume first, SCL-073) | event id insert-once; upsert on `profile_id` | `stripe-lifecycle-gate.contract.test.ts` | `webhook-handler.ts:1478` |
| 9 | Full refund | `refund.updated` | revoke | SIG LM IDEM SHAPE PROV — **no CTRY** | `revokeAllProfiles` (SCL-048/072) | event id insert-once; upsert on `profile_id` | `stripe-refund.contract.test.ts` | `webhook-handler.ts:1468` |
| 10 | Country egress (payer left Tier-1) | `customer.updated` | revoke | SIG LM IDEM SHAPE | none directly — `cancel_at_period_end` on Stripe; free arrives at period end (SCL-047) | event id insert-once; `cancel_at_period_end` is idempotent | `stripe-lifecycle-gate.contract.test.ts` | `webhook-handler.ts:1463` |
| 11 | Renewal paid | `invoice.payment_succeeded` | **none** *(corrected — see Finding 2)* | SIG LM IDEM | none — `EVENT_DISPOSITION` marks this **ignored**; the period is written from `customer.subscription.updated` and nowhere else (§4.5 single-writer) | event id insert-once | `stripe-lifecycle-gate.contract.test.ts` (row 5 is the real path) | `event-surface.ts` disposition; no handler |
| 12 | Guardian adds a student | `POST /api/billing/checkout` | grant | AUTH SHAPE SEL CTRY SUBJ | `subscriptionItems.create`; row written by `customer.subscription.updated` | already-funded guard refuses a second item for the same student | `identity-entitlement.contract.test.ts` | `billing-routes.ts:271` |
| 13 | **Customer deleted — orphaned entitlement** | `customer.deleted` | **revoke (INTENDED, NOT IMPLEMENTED)** | SIG LM IDEM | **none — open gap** | n/a | **none** | **no handler; `EVENT_DISPOSITION` ignored with an open ruling** |

Rows 1–12 describe shipped behaviour. **Row 13 is an open gap**, added here
because a revocation the system intends and does not perform is exactly what the
matrix exists to surface — see Finding 3.

---

## 4. Findings from filling it

### Finding 1 — the call-site column was unverified, and 7/7 cells were wrong

`ENTITLEMENT_PATHS` cited `webhook-handler.ts` lines `476, 629, 796, 1233, 1411, 1520`
and `billing-routes.ts:227`. Printing those lines returns a closing paren, four
docblock fragments and a comment. Two errors compounded:

1. The values were **definition** lines, not call sites, though the field is
   documented as "`file:line` of the production call site".
2. They had drifted 3 lines when the file grew above them.

The enforcing test cannot catch either. It asserts the cell *shape*
(`toMatch(/^[\w./-]+:\d+$/)`) and that the *file* exists (`existsSync`). It never
reads the line. Any integer passes.

*Provisional:* `SCL-DRAFT-A-citation-verification`.

### Finding 2 — a row claimed gates that never execute

Row 11 (`invoice.payment_succeeded`) was recorded as effect `extend` carrying
CTRY and SUBJ. `EVENT_DISPOSITION` marks that event **ignored** (`event-surface.ts:120`),
correctly, under the §4.5 single-writer rule. No gate runs on that trigger at all;
the gates listed belong to row 5.

The test cannot catch this either: it checks that a *granting row lists* CTRY,
never that the gate *executes* on that path. So mislabelling the effect
manufactured a gate claim out of nothing. Corrected to `none` above.

*Provisional:* `SCL-DRAFT-A-effect-truthfulness`.

### Finding 3 — a known revocation gap was hidden by omission

`customer.deleted` is subscribed and ignored, with this stated reason in
`event-surface.ts:92`:

> "a deleted Customer orphans an entitlement row that Doc 05D's cascade cannot
> see… Intended behaviour is to revoke the entitlements keyed to that Customer;
> the seam is flagged and the ruling is open."

So the system knows it should revoke here and does not. It had **no matrix row**,
because the completeness test only walks HANDLED events — an ignored event with
entitlement intent is invisible to it. That is the precise failure mode the
matrix was built to prevent, one level down: not "handled but absent", but
"ignored, should revoke, and absent".

Left premium in place after Customer deletion, this is a revenue-and-access
defect, not a tidiness one. **Needs an owner ruling before it can be a claimable row.**

*Provisional:* `SCL-DRAFT-A-customer-deleted-orphan`.

### What verified clean

- `upsertEntitlement` is the sole writer — 3 production callers, all inside the
  three intended functions; every other `entitlements` touch is a read.
- The country gate is a real chokepoint on the webhook side, inherited rather
  than wired, and `if (tier === "premium")` keeps revocation ungated.
- Route-side branch-then-gate ordering is correct at `billing-routes.ts:271–277`.
- 19 events, 10 HANDLED / 9 ignored, every ignored one carrying a stated reason.

---

## 5. Proposed row assignment

Ownership follows the layer split; these are proposals, not claims.

| Row / item | Suggested agent | Note |
|---|---|---|
| Finding 1 — verify cited lines in the test | **A** | A owns the matrix and its test |
| Finding 2 — effect truthfulness | **A** | corrected in this doc; code matrix still to follow |
| Finding 3 — `customer.deleted` orphan | **blocked on owner ruling** | then A (gate/writer) + B (SDK read) |
| Rows 1–3 settlement | A (derivation) / B (dispatch) | one derivation, two entry points |
| Rows 4–6 lifecycle | A (gate) / B (schemas, dispatcher) | |
| Rows 7–9 dispute & refund | B | provenance + `pause_collection` |
| Row 10 egress | B | `customer.updated` SDK surface |
| Row 12 add-item | C | route, contract, selection input |
| Fixtures, plants, PG wiring for all rows | D | |

---

## 6. Standing

No DDL applied. Nothing merged. Two verifications remain open until credentials
exist — the live subscription object, and Checkout→SubscriptionItem metadata
propagation. Nothing is substituted for either.
