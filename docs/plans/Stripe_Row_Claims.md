# Stripe Vertical — Row Claims Register

**Owner: the orchestrator (this session).** Agents claim through it; no agent edits
this file. Companion to `docs/plans/Stripe_Validation_Matrix.md`, which defines the
rows. Base for all three branches: `origin/stripe` @ `4335fb3`.

**Status: RULED 2026-08-31. B and C dispatched. D HELD.**

**Why D is held.** D's deletion manifest and the `@spec` re-annotation sweep are the
same surface, so dispatching D before the annotation ruling lands guarantees rework.
Owner ruling: merged code carries `@spec [Stripe Integration End-to-End Flow §…]`
pointing at a **plan** document, now committed to `docs/plans/` on `stripe`. The
annotations should instead cite Doc 01 sections — Doc 01 owns identity, access and
billing, i.e. the rules — and reference the flow document as a plan, which describes
paths. That truthfulness sweep is D's scope. **No annotation is retargeted now.**

The plan documents stay in `docs/plans/`. `docs/Spec/` is owner-only and neither
document has been through the draft-review-publish cycle; they are plans, not spec.

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
| `entitlement_runtime_config` keys — re-derive, report readers, DML only for read keys | **B** — reassigned from D by owner ruling; it is D's one item that does not overlap the held surface. Doc 01 Appendix A.4 (**not** Doc 01A). Six unread keys is how this vertical started: do not seed dead config. |
| `@spec` annotation truthfulness sweep across the Stripe surface | **D — HELD**, see status above |

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

## SCOPE — owner ruling 2026-08-31

**The only definition of done:** a student pays and gets access; a guardian pays for a
student and that student gets access. Both verified end to end against production, not
against tests. Everything in flight serves that or it is noise.

**Findings outside billing, entitlement and Stripe get ONE LINE in a plan file and no
further work.** No write-ups, no evidence gathering, no verification.

**The bar for raising anything to the owner:** does it stop a student or guardian paying
and receiving entitlement access? If not, it is a line in a file.

Closed under this rule, one line each, no further work:

- Crisis-response content is US-scoped by owner ruling. `FINDING_crisis_resources_default_to_US.md` is CLOSED.
- `@spec` annotation truthfulness sweep — a line in a file, not work. Removed from D's scope.
- `no-dupe-keys` enforced by nobody (typescript-eslint disables it; tsc excludes `tests/`) — a line in a file, not work.
- Error-class conflation across 13 throw sites — a line in a file. Does not stop anyone paying.

## Defects found by agents — not spec changes

**Owner ruling 2026-08-31 on SCL discipline.** An SCL exists when the spec says
something and that something is wrong. Not when the spec is silent, not when code
needs improving, not when a decision needs recording. Two of B's provisional drafts
were withdrawn under that test and are recorded here instead.

| Defect | Found by | Owner | Sequence |
|---|---|---|---|
| **Error-class conflation.** One `StripePayloadShapeError` is thrown from 13 sites in `webhook-handler.ts` for at least three distinct facts — a genuine shape failure, an INV-03-08 country denial, and an ambiguity refusal — all carrying the message `"payload failed shape validation"` (single template at `webhook-handler.ts:383`). An operator reading `…payload failed shape validation: billing country is not Tier-1 eligible` will hunt for an API drift that is not there. It also defeated B's first plant formulation, which could not tell a parse failure from a country denial. Violates "distinguish absence from ambiguity". | B | **B** | **After C and D land.** It is a cross-cutting rename over 13 sites and fixtures owned by C and D; doing it before they merge guarantees conflicts. Withdrawn as `SCL-DRAFT-B-shape-error-conflation` — the spec says nothing about this error class, so no SCL is owed. |
| **`no-dupe-keys` is enforced by nobody.** `typescript-eslint` disables the rule expecting `tsc` to report ts(1117), and `tsc --listFilesOnly \| grep -c '/tests/ci/'` returns **0** — the tsconfig excludes tests. Two duplicate-key fixtures survived on that gap. B closed it in-layer with a test rather than touching shared config. | B | **orchestrator or D** | Systemic fix is `eslint.config.mjs` / `tsconfig.json`; both are shared config and would collide across three branches. |

## Open, verified NON-BLOCKING — listed, not worked

Owner ruling: the bar is *does it stop someone paying and getting access?* None of these do.
One line each, no further work, no write-ups.

| item | why it does not block |
|---|---|
| SCL-047 lifecycle denial still throws and retries | Ruled: becomes `cancel_at_period_end`, access to period end, gate at renewal, no refund of history — general rule, a gate denying a grant returns 200. New work for B; affects renewals, not first purchase. |
| Customer-facing refund notification | `notification_outbox.event_type` CHECK enum has no refund member and `recipient_profile_id` is `NOT NULL FK → profiles`. DDL authored, not applied. The operator alert fires and says the customer has not been told. |
| Six of Doc 01 A.4's seven `entitlement_runtime_config` keys unseeded | Verified 2026-09-01: only `tier_1_countries` exists, and it is the only one with a reader. Seeding the rest would seed dead config. |
| Pre-5.1 `entitlements` row: `stripe_subscription_item_id` and both period bounds NULL | Not backfilled. `entitlement_active()` reads `status` only, so access is unaffected. |
| `entitlement-paths.ts` citations anchored on line numbers | Any edit above the dispatcher moves all eleven; renumbered three times in one change. The gate catches every drift, so nothing is wrong — re-anchoring on the enclosing function name is A's, after the merges. |
| `BillingPlanMetadata` forked (client `number`, server `number \| null`) | A display-type divergence; does not touch the pay-to-access path. |
| Pre-selection "already funded" state not built | No endpoint exposes per-student funding. The server refuses `STUDENT_ALREADY_FUNDED` with a 409 **before money moves** — costs a wasted click, not a charge. |
| Error-class conflation across 13 throw sites | Operator legibility. Scheduled for B after the merges. |
| `no-dupe-keys` enforced by nobody | typescript-eslint disables it expecting tsc; tsc excludes `tests/`. Closed in-layer with a test. |

## Merge order

B → C → D. Codex audits each PR before its merge, scoped to that layer plus the
interfaces it crosses — not one pass at the end, which is where the last three
rejections came from. Rebase between each. A final Codex pass on the merged surface,
scoped to interactions rather than any one layer.

**The owner merges. Not the orchestrator, not an agent.**
