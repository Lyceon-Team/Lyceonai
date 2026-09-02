# Stripe Vertical — Parallel Execution Plan

**Governing documents:** `Stripe_End_To_End_Flow.md` (the paths), the SCL register 042–076 (the rules), the charter (the discipline).

**This plan defines who owns what.** It does not restate the flow or the rules.

---

## 0. The split, and why it is by layer

Phases 4–7 all write entitlement. Splitting four agents across four phases produces four writers, which is this vertical's entire defect history in one move — parallel paths built differently, controls wired where the last audit pointed, two implementations of one operation.

**So the split is by layer.** Each shared thing has exactly one owner, end to end. Phase work consumes those layers; it never reimplements them.

| Agent | Owns | Never touches |
|---|---|---|
| **A — Core** | `upsertEntitlement`, the country evaluator, the settlement check, the gates, the §9 matrix and its test | Stripe SDK call sites, tests outside its own |
| **B — Stripe surface** | Zod schemas, charge→invoice→subscription provenance, subscription/item/customer/dispute/refund SDK modules, the webhook dispatcher | The entitlement writer, the gates |
| **C — Routes and client contract** | Checkout and add-item routes, portal, `packages/shared` billing contract, guardian selection input | Webhook handlers, the writer, the gates |
| **D — Deletion and test surface** | Deletion manifest, fixtures, plants, PG wiring, CI steps | Production code outside deletions |

**A owns the gates. Nobody else gates.** B, C and D call into A's evaluator. If an agent finds a path needing a gate, it files a matrix row against A — it does not add a check.

---

## 1. The matrix is the coordination artifact

`docs/plans/Stripe_Validation_Matrix.md`. One row per path that grants, extends, restores, or revokes. Columns: path · trigger event · gates applied · writer · idempotency · test · production call site.

**A owns the file.** Other agents propose rows via PR comment; A merges them.

**A row is claimed by exactly one agent and claimed before work starts.** Two agents on one row is the failure this whole split exists to prevent. An empty cell is a defect, not a gap.

---

## 2. Branches, PRs, merge order

One branch per agent: `claude/stripe-core`, `-surface`, `-routes`, `-deletion`. One PR each, base `stripe`.

**Merge order is fixed and the owner merges: A → B → C → D.** Core lands first because everything consumes it. Deletion lands last because it needs to see final call sites to prove zero references.

**After each merge, every other agent rebases onto `stripe` before continuing.** Not optional. A `main` merge previously resurrected an already-resolved SCL-042 collision; four concurrent branches multiply that.

**Codex audits each PR before its merge**, scoped to that agent's layer plus the interfaces it crosses. Not one pass at the end — four surfaces landing together is the diff-scoped review problem inverted.

---

## 3. SCL allocation under concurrency

The allocation rule reads the maximum; it does not reserve. It has already lost three races sequentially. Four concurrent agents make a collision near-certain.

**Agents do not allocate numbers.** Drafts carry provisional ids — `SCL-DRAFT-<agent>-<slug>` — and the owner assigns a number at merge. The duplicate gate stays as the backstop.

---

## 4. Per-agent scope

### A — Core

The §9 matrix and the test that enforces it: an ungated grant row fails, and a handled event with no row fails. Prove both by planting.

The country evaluator as a single function called at every derivation point, structured so a new granting path **cannot** omit it. If a chokepoint is not expressible, say so and propose the nearest available rather than wiring call sites by hand.

`upsertEntitlement` as the sole writer. Enumerate every caller. Where two writers can race, state the last-writer-wins outcome in the matrix rather than leaving it implicit.

The settlement check per SCL-071 — `payment_status` in `{paid, no_payment_required}` — shared by `checkout.session.completed` and `async_payment_succeeded`. One derivation, two entry points.

### B — Stripe surface

Zod at every boundary: retrieved Charges, subscription lists, invoices, disputes, refunds. Absent normalises to null; a shape failure is fail-closed and releases the idempotency gate for retry.

Charge provenance: charge → PaymentIntent → invoice payment → invoice → subscription. Where provenance cannot be established, **change nothing and surface for an operator**.

Dispute and refund modules, `pause_collection` read alongside status, both orderings preserved. All eight `Dispute.Status` members explicit.

The dispatcher: 19 events, one shared list, every event processed or ignored with a stated reason.

### C — Routes and client contract

Checkout route with the first-purchase / add-item branch determined **before** any gate runs. Guardian per-student selection reading active `guardian_links` server-side — selection identifies, it does not authorise. Add-item via `subscriptionItems.create` with `proration_behavior` unset.

Portal route and its client entry point. The shared billing contract in `packages/shared`, one discriminated shape across both branches.

Reject any session carrying `payment_link`, and alert.

### D — Deletion and test surface

**The deletion manifest is the closure condition and has slipped four rounds.** Every file, function, route, table reference and test removed, each with what replaces it and grep-proven zero remaining references. Scope: billing, entitlement, Stripe. Report anything outside; edit nothing there.

**The vertical does not close while a second path exists for any operation in the flow.** Enumerate operations, name the implementations of each, and prove one survives.

Fixtures faithful to what Stripe actually produces — a subscription without a customer is not a real shape, and equal charged and list amounts make a refund assertion vacuous. Seed real config in PG rather than mocking the reader, per the precedent already set.

Every PG-requiring test named in a PGHOST-bearing workflow step in the same commit that adds it.

---

## 5. Standing conditions — all agents

Printed runtime artifacts, never descriptions.

Every test answers whether it would fail if its behaviour were deleted. Plant it, watch it fail, revert. **A plant that fails to fail is a finding requiring a second formulation, never evidence the test works** — it has fired four times now, twice in one round.

Assert both halves: response and state change.

No caller-supplied value gates entitlement. A signature proves Stripe sent the bytes, not that we derived the value.

Fail closed, but distinguish absence from ambiguity.

Stripe claims cite the sample repos or the pinned SDK. **The samples are minimal happy-path demos** — they do not check `payment_status` and therefore do not corroborate SCL-071. Useful for shape, not for correctness, and "the sample doesn't do it" is not a reason to omit a gate.

No DDL applied. Nothing merged by an agent.

Two verifications stay open until credentials exist: the live subscription object, and Checkout-to-SubscriptionItem metadata propagation. Substitute nothing.

---

## 6. Sequence

1. **A publishes the matrix first**, filled against current code. Every other agent's work list comes from it. Nobody starts before it exists.
2. Owner assigns rows.
3. A, B, C work concurrently. D runs the deletion sweep concurrently and holds its manifest until the others' call sites are final.
4. Codex per PR. Merge A → B → C → D, rebasing between each.
5. Final Codex pass on the merged surface, scoped to interactions rather than to any one layer.

**Report at the matrix, before rows are assigned.**
