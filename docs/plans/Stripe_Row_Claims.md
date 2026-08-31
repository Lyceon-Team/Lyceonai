# Stripe Vertical — Row Claims Register

**Owner: the orchestrator (this session).** Agents claim through it; no agent edits
this file. Companion to `docs/plans/Stripe_Validation_Matrix.md`, which defines the
rows. Base for all three branches: `origin/stripe` @ `4335fb3`.

**Status: PROPOSED — awaiting the owner's ruling. Nothing dispatched.**

## The one rule this file exists to enforce

A row is claimed by exactly one agent, and claimed before work starts. Two agents on
one row is the failure the split exists to prevent.

**A owns the gates.** A's work is merged and the gate is live. B, C and D call into
the evaluator and never add a check. An agent finding a path that needs a gate files
a matrix row through the orchestrator; it does not write a local condition. That
single rule is what prevents four evaluators.

## Claims

| Row | Trigger | Claimed by | What that agent owns on it |
|---|---|---|---|
| 1 | `checkout.session.completed` | **B** | boundary schema + dispatch only. Writer and gates are A's, merged, frozen. |
| 2 | `checkout.session.async_payment_succeeded` | **B** | as row 1 |
| 3 | `checkout.session.async_payment_failed` | **B** | dispatch arm; grants nothing, revokes nothing (SCL-071) |
| 4 | `customer.subscription.created` | **B** | subscription + item schemas, dispatch |
| 5 | `customer.subscription.updated` | **B** | as row 4 |
| 6 | `customer.subscription.deleted` | **B** | as row 4 |
| 7 | `customer.updated` | **B** | Customer schema, egress dispatch (SCL-047) |
| 8 | `customer.deleted` | **B — verification only** | whether Stripe cancels subscriptions on Customer delete. **Does not change the handler**; changes what the row records. Any matrix edit comes through the orchestrator. |
| 9 | `charge.dispute.created` | **B** | dispute module, provenance, `pause_collection` ordering (SCL-073) |
| 10 | `charge.dispute.closed` | **B** | as row 9, restore side |
| 11 | `refund.updated` | **B** | refund module, provenance (SCL-048/072) |
| 12–19 | the 8 ignored events | **B** | dispatcher disposition across all 19; they stay ignored unless a finding says otherwise |
| 20 | `POST /api/billing/checkout` | **C** | route, branch-before-gate ordering, selection, shared contract |

**Not matrix rows, claimed the same way:**

| Item | Claimed by |
|---|---|
| Portal route + client entry point | **C** |
| Shared billing contract in `packages/shared` (one discriminated shape) | **C** |
| Payment Link refusal at the route | **C** |
| Deletion manifest — every operation, every implementation, exactly one survivor | **D** |
| Fixture faithfulness (subscription without `customer`; equal charged/list amounts) | **D** |
| PG-seeded config over a mocked reader; PGHOST wiring in the same commit | **D** |
| Duplicate `customer` key, `stripe-webhook-disposition.contract.test.ts:273-275` | **B** (it is B's fixture, in B's suite) |
| `entitlement_runtime_config` keys — re-derive, report readers, DML only for read keys | **B** (first in merge order) |

## Contested surfaces, arbitrated in advance

These are the places two agents could plausibly reach for the same file. Ruled now,
rather than after both have committed:

- **`webhook-handler.ts`** — B only. D may remove from it *only* what D has proven
  duplicated, and only the removal.
- **`billing-routes.ts`** — C only. Same exception for D.
- **`packages/shared` billing schemas** — C owns the contract shape. B owns Stripe
  *inbound* payload schemas. If they meet, that is a layer-boundary error, not a file
  to split: report it.
- **`account.ts` / `upsertEntitlement`** — nobody. A's, merged, frozen.
- **`country-eligibility.ts`** — nobody. The gate.
- **`docs/plans/Stripe_Validation_Matrix.md`** — the orchestrator only. Agents
  propose rows; they do not edit the matrix.

## Merge order

B → C → D. Codex audits each PR before its merge, scoped to that layer plus the
interfaces it crosses — not one pass at the end, which is where the last three
rejections came from. Rebase between each. A final Codex pass on the merged surface,
scoped to interactions rather than any one layer.

**The owner merges. Not the orchestrator, not an agent.**
