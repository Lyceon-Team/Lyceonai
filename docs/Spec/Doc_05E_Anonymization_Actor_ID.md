# Doc 05E — Anonymized Retention & Identity Decoupling (Governance)

**Status:** LOCKED
**Family:** 05 (Mastery / Data Governance)
**Type:** Governance & compliance doctrine. This document owns the *mandate, legal basis, invariants, and procedural requirements* for anonymized retention. It does **not** prescribe schema, column names, or SQL — those are derived at build time against live schema, audited per the canonical build process, the same as every other 05-family implementation.
**Counsel:** Mechanism approved — decoupled synthetic actor identifier, lifelong cross-service grouping, identity-linkage destroyed at deletion, structured-data-only retention.
**Relationship to Doc 05D:** 05D §10 defines the hard-delete cascade (built, proven 2026-06-25). This document defines the **anonymize** disposition that 05D §10 stubbed. Hard-delete is retained as the internal/admin tool; anonymize is the user-facing default.

---

## 1. Mandate

Retain a user's full learning activity end-to-end across all services, stripped of any reconstructable path back to their identity, in a form that meets the legal standard for **anonymized retention** (not merely pseudonymization). The retained data is canonical training input for the world model.

- The user-facing account-deletion action invokes the **anonymize** disposition.
- **Hard-delete** (Doc 05D §10) is retained as a `service_role`-only internal tool, used only where even anonymized retention must be purged (legal order, specific regulatory demand).

### 1.1 Purpose limitation

Retained anonymized activity is held for a defined purpose: **world-model / instructional-model training and product analytics.** This purpose is the basis on which retention is justified. A materially different use of the retained data requires fresh review (and, where the data is still pseudonymous during active life, a lawful basis for that use). Purpose limitation protects the retention basis: the data is not a general-purpose store to be repurposed at will.

---

## 2. The Governing Distinction: Pseudonymization vs Anonymization

This is the legal line the entire design exists to clear. Counsel's approval is conditioned on it.

- **Pseudonymized data** remains personal data and remains subject to the right to erasure. Any retained identifier that *was* an identity key, or from which identity can be derived or re-linked, is pseudonymous.
- **Anonymized data** is outside the scope of personal-data obligations and may be retained, *provided* re-identification is not reasonably possible.

**Requirement:** the identifier under which activity is retained MUST be one that never had a stored, derivable, or reconstructable link to identity that survives deletion. The link may exist during the user's active life (the data is then lawfully the live user's own personal data); it MUST be destroyed at anonymization, after which no path from the retained identifier to the person exists in any system.

**Who certifies "reasonably possible," and when:** the determination that re-identification is not reasonably possible is a legal judgment made by **counsel**, not assumed once and forgotten. It is re-assessed at each gate that changes the re-identification calculus — notably any new retained-data surface (INV-05E-04) and any change to the grouping model (§7.1). The technical re-identification spot-check (§8.1) verifies that no identity or fingerprint columns survive; it supports but does not substitute for counsel's legal determination.

---

## 3. Doctrine: Decoupled Synthetic Identity

Activity is grouped under a **synthetic identifier**, generated per user, that is distinct from every identity key and is never stored on any identity-bearing surface that survives deletion.

**The four governing rules** (any compliant implementation must satisfy all four):

1. **Born dissociated.** The grouping identifier is synthetic and is never itself an identity key (not the auth id, not the profile key, not a hash or derivation of either).
2. **Never co-located with identity on a surviving surface.** It is not written to authentication records, payment/billing systems, logs, URLs, or analytics sinks. The single linkage between identity and the synthetic identifier lives on exactly one surface, which is destroyed at anonymization.
3. **Stable across services and time** (per counsel's lifelong-cross-service approval). One synthetic identifier per user, reused across every service so the full trajectory coheres — never regenerated per row or per session in a way that fragments a user's activity.
4. **Linkage destroyed at anonymization.** At deletion, identity is scrubbed and the identity<->synthetic-identifier linkage is irreversibly destroyed, leaving retained activity grouped but unattributable.

### 3.1 Industry precedent

This is the established pattern for erasure-with-retention in mature platforms: Jira's alias translation (identity replaced by an opaque participant alias across contribution history) and JetBrains Hub's randomized anonymization scheme (identifying properties and the primary user identifier overwritten with random values, history preserved read-only). Doc 05E adopts the same doctrine.

---

## 4. Rejected Mechanisms (on record — do not reintroduce)

Each fails a governing rule or a platform invariant. Recorded so a future implementer cannot "simplify" back into a non-compliant or moat-damaging shape.

1. **Retain the identity key (profile/auth id) as the grouping key** — pseudonymous; the key *was* identity (violates Rule 1). REJECTED.
2. **Hash or otherwise derive the grouping key from the user id** — reversible/derivable, pseudonymous (violates Rule 1). REJECTED.
3. **Null the identity link with no synthetic grouping key** — anonymizes but collapses all deleted users together, destroying the per-user trajectory the world model requires. REJECTED.
4. **Drop foreign-key constraints on live event tables to permit arbitrary re-keying** — permanently removes referential integrity from the moat's live write path to serve a deletion-time need. REJECTED; the live write path keeps its integrity constraints.
5. **Bind anonymization to a `BEFORE DELETE` trigger on the authentication table** — makes the most consequential data operation an implicit, ungated side-effect of any auth deletion, bypassing the status guard, operator-attribution preflight, transactional rollback, and audit gate. Fragile against platform-managed schema. REJECTED; anonymization runs only inside the explicit, gated deletion function.
6. **Collapse all anonymized users onto a shared sentinel identity** — loses per-user grouping (violates Rule 3). REJECTED.

---

## 5. Disposition Model

Anonymization classifies every user-scoped table into exactly one disposition. The authoritative table-by-table classification is owned by the deletion-completeness invariant (§6, INV-05E-03 / INV-DELETION-COMPLETE), not enumerated here, so it cannot drift from the live schema.

- **Derived state** (mastery, KPI, projections, scheduling): **deleted.** Recomputable from retained activity if ever needed; no value in retaining identity-linked derived rows.
- **Activity / event sources** (the canonical learning-event record): **retained, identity-decoupled.** Identity link severed; synthetic grouping identifier preserved; client/device fingerprints removed; the structured learning signal kept.
- **Audit layer** (append-only event-application logs): **one-way anonymized per Doc 05D §10**, idempotency guarantees untouched. Not treated as a re-keyable event source.
- **Identity & PII** (profile, auth, billing linkage): **scrubbed / neutralized / destroyed.**

### 5.1 What is retained vs removed in activity rows

- **Retained** (the training signal): the learning interaction — item answered, response chosen, correctness, difficulty/domain/skill/section, ordering, timing, and shared question-bank content (which is identical for all users and is not user-authored).
- **Removed:** the identity link and any client/device/session fingerprint that could enable re-identification.

---

## 6. Invariants

- **INV-05E-01 — No reverse map.** No retained surface contains any column, hash, mapping, or derivable value linking the synthetic identifier back to a user or any identity. No reverse-mapping object exists post-anonymization.
- **INV-05E-02 — Linkage isolation.** The identity<->synthetic-identifier linkage exists on exactly one surface during active life and on no surface that survives anonymization.
- **INV-05E-03 — Coverage (deletion-completeness).** Every user-scoped table — current and future — must be explicitly classified in a §5 disposition, and every retained activity table must carry the synthetic grouping identifier. Enforced as a CI guard (INV-DELETION-COMPLETE) that fails on any unclassified user-scoped table or any retained activity table lacking the grouping identifier. This guard is the authoritative, drift-proof enumeration; prose lists are non-authoritative.
- **INV-05E-04 — Free-text boundary.** The structured-data low-risk posture (§7) covers only structured, non-user-authored content. Any service introducing free-text user-authored input requires separate counsel review before its data may be retained under this doctrine.
- **INV-05E-05 — Explicit-gated only.** Anonymization executes only within the explicit, gated, audited deletion function. No implicit trigger path, no execution outside the gate.
- **INV-05E-06 — Stable per-user identifier.** Exactly one synthetic identifier per user, assigned once, reused across all activity; never generated per-row or in any way that fragments a user's trajectory.
- **INV-05E-07 — Fail-closed grouping.** Anonymization must refuse (raise, block, alert) if any activity row to be retained lacks its grouping identifier. A retained-but-ungrouped row is a defect; never sever identity from an ungrouped row.
- **INV-05E-08 — Determinism & atomicity (SQL disposition).** The SQL anonymize disposition is deterministic and runs in a single transaction with all-or-nothing rollback (inherited from Doc 05D §10): on any SQL-step failure the user's data is left fully intact and the request survives for retry. The end-to-end lifecycle also involves non-transactional API operations (storage purge, billing teardown) that Postgres cannot roll back; these follow the API-then-SQL ordering discipline (perform API steps before the irreversible SQL disposition; block and alert on API failure rather than proceeding), per §8.1 and the deletion-lifecycle (PR-4) governance. Atomicity is guaranteed for the SQL disposition; end-to-end integrity is guaranteed by ordering + fail-closed, not by a single transaction.

---

## 7. Behavioral-Fingerprinting Posture

Even with the relational identity link severed, retained data must not be *itself* re-identifying. Regulators treat a sufficiently unique behavioral trace as personal data regardless of key removal.

- **Current posture: low risk.** Retained activity is structured and non-user-authored (controlled values + shared question content). It contains no free-text prompts, location, or user-supplied identifiers. Device/session fingerprints are removed at anonymization.
- **Forward obligation (INV-05E-04):** any future free-text or high-granularity-trace surface (e.g. a conversational tutor) is a distinct risk class requiring its own counsel review and possibly stricter measures (e.g. session-scoped rather than lifelong grouping) before retention.

### 7.1 The lifelong-grouping tradeoff (explicit decision)

§3 Rule 3 mandates a **lifelong, cross-service** identifier. This is a deliberate choice with a real tradeoff, recorded here so counsel's approval is on the actual decision, not an understated one:

- **The choice:** lifelong grouping maximizes world-model value (full multi-year learning trajectory under one identifier) but is also the highest behavioral-fingerprinting-risk form, because the trace under a single key accumulates and enriches over time. The alternative — **session-scoped or periodic re-keying** — caps the accumulated trace per identifier and is the standard mitigation, at the cost of fragmenting the trajectory.
- **Why lifelong is acceptable here:** the retained data is structured and non-user-authored (§7), which keeps even an accumulated trace low-uniqueness relative to free-text or location traces. Counsel approved lifelong grouping **conditioned on structured-only retention**.
- **Compensating controls** (all mandatory while lifelong grouping is in force): (a) the free-text boundary (INV-05E-04) — lifelong grouping does NOT extend to any free-text surface without fresh counsel review; (b) the purpose limitation (§1.1); (c) a retention-horizon review — the re-identification calculus changes as the trace grows, so the "reasonably possible" determination (§2) is re-assessed by counsel at each new-data-surface gate, not treated as settled once.
- **If any compensating control cannot hold** (e.g. a free-text surface ships, or the trace becomes high-uniqueness), the grouping model reverts to session-scoped for the affected surface pending counsel re-approval.

---

## 8. Implementation Procedure (governance-level)

Doc 05E specifies *what must be true*, not *how*. Each build PR derives the specifics against live schema and passes the full gate (read-only audit -> plan -> implement -> spec-auditor -> independent audit -> owner applies). The required procedural sequence:

1. **Substrate.** Introduce the synthetic-identifier surface and the per-user assignment, and make the activity-table identity columns capable of being severed without violating their constraints — preserving live write-path integrity (no dropped FKs). Grounded against live schema at build time.
2. **Write-path assignment.** Every activity write across every service assigns the synthetic identifier server-side. Coverage enforced by INV-05E-03.
3. **Backfill.** Existing users receive their stable identifier applied consistently across all their existing activity (one per user — INV-05E-06).
4. **Anonymize disposition.** Implement the anonymize branch of the gated deletion function per the §5 disposition model and §6 invariants; hard-delete remains the internal-only disposition.
5. **User-facing wiring.** Connect the user-facing deletion lifecycle (request -> grace -> execution) to the anonymize disposition. Substrate and write-path assignment (steps 1–2) and backfill (step 3) MUST precede user-facing wiring, so no anonymization can run before the grouping identifier is universally present (INV-05E-07).

### 8.1 Verification obligations

- Anonymize disposition proven on a real prod target with a surviving negative control, per the Doc 05D §10 destructive-test discipline (exact-target precision, atomic rollback, idempotent re-run).
- INV-05E-03 coverage guard committed and proven (fails on a deliberately unclassified table).
- Re-identification spot-check: retained activity for an anonymized user is unreachable by any user-context query and carries no surviving identity or fingerprint column.

---

## 9. Open Seam

The user-facing deletion lifecycle (grace-expiry driver, storage purge, billing teardown, scheduling) is the vehicle that invokes this anonymize disposition. Its build interleaves with the substrate/assignment/backfill steps above; the ordering constraint in §8 step 5 governs.
