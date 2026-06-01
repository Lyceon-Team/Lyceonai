# **Doc 05D — Mastery Audit, Recompute & Constants Governance**

| Field | Value |
| ----- | ----- |
| **Document** | Doc 05D — Mastery Audit, Recompute & Constants Governance |
| **Version** | V1.0 |
| **Status** | Locked 2026-05-14 (in-lock-cycle cleanup applied, RB-05D-V1-01..05 blockers \+ A/B/C/D non-blocking; no version bump per Doc 04/05 family precedent). Spec locked; standing deploy gates: two 04B seam items (§12, `BLOCKING_UPSTREAM_GAP`) \+ the privacy/compliance Layer-2 decision (§10.4, `BLOCKING_PRIVACY_GAP`) \+ the §11.K/L 05A reconciliations. |
| **Scope** | The two locked audit tables `mastery_event_audit_log` (05A per-event, idempotency-bearing) and `mastery_domain_refresh_audit_log` (05B per-domain-refresh) — defined here exactly as the locked siblings contracted; projections excluded (05C snapshots are the projection audit trail); the `mastery_constants` write-governance model and append-only `mastery_constants_change_log` (capture-only, no recompute trigger — changed constants affect future computes only); the backfill recompute job (never-computed case only, NOT a constants-change recompute, which does not exist in this family); the recompute-verification harness (backfill \+ general determinism invariant); the Parent §11.1 account-deletion cascade ordering and the one-way anonymization of the event/audit layer; the daily projection-refresh sweep and the `projection_refresh_outbox` consumer schedules that 05C's throttle depends on; the 04B→05C seam contract (the two `BLOCKING_UPSTREAM_GAP` items, governed here without rewriting Doc 04B). |
| **Audience** | Engineering, AI, Product, Data, Security, QA, Ops, Privacy/Compliance |
| **Governed by** | Doc 05 Parent V1.0 (Locked 2026-05-13, RB-05P-V1-01..15) |
| **Depends on** | Doc 00 · Doc 01 · Doc 02 Preamble V3.0 · Doc 02A V6 · Doc 02B V4 · Doc 04 Parent V3.0 · Doc 04A V2.2 · Doc 04B V4.3 · Doc 04C V1.0 · Doc 05A V1.0 · Doc 05B V1.0 · Doc 05C V1.0 |
| **Sibling sub-docs** | 05A (Mastery Formula & Skill Mastery), 05B (Domain Mastery & KPI Rollups), 05C (Score Projections & Snapshots) |
| **Superseded** | None at the V1 boundary — 05D is a clean-slate sub-doc of the locked Parent. It is the capstone: every sibling that wrote "05D owns X" is resolved here. |

---

## **1\. Purpose**

Doc 05D is the **capstone** of the Doc 05 family. Every sibling sub-doc deferred a set of cross-doc responsibilities to "05D"; this document resolves all of them and adds nothing the family did not already promise. It is the governance, audit, recompute, and lifecycle hub.

This document defines:

* **The mastery audit log layer — two locked tables.** The capstone cross-doc audit found that pre-draft Q1=c ("one unified log") contradicts two locked sibling contracts: 05A (RB-05A-V1-20) writes `mastery_event_audit_log` with a load-bearing `(event_source_kind, event_id)` UNIQUE constraint enforcing INV-05A-10 idempotency, and 05B explicitly contracted a *separate* `mastery_domain_refresh_audit_log` ("separate table … because the events are different"). Locked siblings win (§2.1). 05D therefore defines **both** tables exactly as contracted (§4). Projection refreshes are excluded from both — Doc 05C's `student_section_projection_snapshots` is the canonical projection audit trail (05C Q6 / INV-05C-17); 05D references it read-only and never duplicates it. The Q1=c "unified/discriminator" framing is superseded by §4.0 as incompatible with locked V1.0 siblings; the "projections excluded" part of Q1=c stands.  
* **The `mastery_constants` write-governance model.** Per the locked decision (Q2, revised): there is **no recompute trigger anywhere in the family**. A `mastery_constants` change affects only *future* computes; existing rows keep the `constants_snapshot_hash` / `projection_constants_hash` they were computed under and migrate to new constant values naturally through the normal event-driven refresh path. The append-only `mastery_constants_change_log` is a pure governance audit record (who/what/when/why), captured by an `ENABLE ALWAYS` trigger plus a periodic reconciliation hash-check so a dashboard-level direct edit cannot silently bypass the log.  
* **The backfill recompute job.** Per the locked decision (Q3, collapsed): 05D owns a per-student, strict-dependency-order (skill → domain → KPI → projection), one-transaction-per-student, bounded-batch recompute for the **never-computed case only** — the "legacy: canonical events exist but mastery/KPI/projection rows do not" migration path that 05B §11.2 and 05C §11.2 reference. This is explicitly **NOT** a constants-change recompute; that workflow does not exist in this family.  
* **The recompute-verification harness.** Per the locked decision (Q6, narrowed): 05D owns a harness that re-runs the backfill recompute over the same canonical events and the same constants snapshot and asserts byte-identical output, and that exercises the general determinism invariant the whole family asserts. It does not verify a constants-change recompute (there is none).  
* **The account-deletion cascade.** Per the locked decision (Q5=b): at 7-day soft-delete expiry, one foreign-key-ordered transaction hard-deletes every identity-linked derived row across 05A/05B/05C; in the *same* transaction it anonymizes the canonical event history and BOTH audit tables (`mastery_event_audit_log`, `mastery_domain_refresh_audit_log`) one-way by construction (irreversible surrogate, no reversible mapping table, minimal modeling tuple retained). 05D references the already-locked deletion/retention contract (the 7-day soft-delete window, immediate subscription cancellation) rather than re-litigating it; it defines only the ordering, transactional guarantees, and the irreversibility invariant. A privacy/compliance-confirmation gate must clear before the anonymized-retention path is enabled in production.  
* **The schedules 05C depends on.** The 05C projection-refresh throttle leans on a daily time-trigger sweep and a `projection_refresh_outbox` consumer; 05D owns the schedule definitions for both (05C owns the contracts they call).  
* **The 04B→05C seam contract.** Per the locked decision (Q7=a): 05D is the single governed home for the two `BLOCKING_UPSTREAM_GAP` items 05C raised — 04B naming the canonical completed-full-length section-score read surface, and 04B inserting the `projection_refresh_outbox` row in its scoring transaction. 05D specifies the contract shape without rewriting Doc 04B (which is locked at V4.3).

Doc 05D does NOT define:

* The mastery formula and skill mastery rows — owned by 05A. 05D's backfill *invokes* 05A's locked `recompute_skill_mastery` RPC (05A §5, the named 05D-caller recompute path); it never calls the pure inner `compute_mastery_for_entity` directly and never reimplements the formula.  
* Domain mastery rows, KPI rollups, or their refresh functions — owned by 05B. 05D's recompute *invokes* 05B's `refresh_domain_mastery` and KPI refreshers.  
* The projection formula, blend, range, or `compute_section_projection` — owned by 05C. 05D's recompute *invokes* 05C's RPC; the sweep/outbox consumer *calls* 05C's contract.  
* The raw-to-scaled scoring of full-length tests — owned by Doc 04B (locked V4.3). 05D's seam contract specifies what 04B must *expose*; it does not re-score and does not rewrite 04B.  
* The legal sufficiency of anonymized-minor-data retention — owned by privacy/compliance. 05D makes the *engineering* contract sound (irreversible, one-way, minimal tuple) and gates production enablement on explicit privacy/compliance sign-off; it does not adjudicate COPPA/SOPIPA/GDPR applicability.

---

## **2\. Doctrine (Sub-Doc Level)**

### **2.1 The capstone adds no new behavior; it resolves promised responsibilities**

Every "05D owns X" in Parent/05A/05B/05C is enumerated in §14 and resolved in this document. 05D introduces no mastery, scoring, projection, or entitlement behavior of its own. If a reader finds a 05D rule that is not traceable to a sibling's deferral or a locked pre-draft decision, that rule is a defect.

### **2.2 Changed constants affect future computes only — there is no recompute trigger**

This is the load-bearing simplification of the family. A `mastery_constants` change does not restamp any existing row. Each `student_*_mastery` / KPI / projection row carries the hash of the constant set it was computed under; that hash is the truthful record of its vintage. Rows migrate to new constants naturally as students remain active and their data refreshes through the normal event-driven path. A dormant student's rows legitimately remain on an older constant vintage until the student returns — this is correct, visible (the hash says so), and auditable, not a defect. The single most dangerous operation a mastery system can have — a constants edit stampeding a full-base restamp — does not exist in this family by design.

### **2.3 The audit log is append-only and is never the read path**

`mastery_event_audit_log` (05A per-event) and `mastery_domain_refresh_audit_log` (05B per-domain-refresh) record that a transition/refresh happened and the before/after of the canonical row. It is never read by any student/guardian surface and is never a source of truth for mastery — the `student_*_mastery` rows are. It exists for debugging, recompute traceability, and regulatory defense. Append-only: no UPDATE/DELETE except the §10 account-deletion anonymization.

### **2.4 Recompute is backfill-only and deterministic by construction**

The only recompute in the family is the never-computed backfill. It is per-student, strictly dependency-ordered, one transaction per student, and idempotent: the same canonical events under the same constants snapshot produce byte-identical rows. There is no partial-recompute, no constants-change recompute, and no "refresh everyone" button. 05D owns a harness that proves the determinism rather than asserting it.

### **2.5 Deletion hard-deletes identity-linked derived state and one-way-anonymizes the modeling layer**

At soft-delete expiry, derived rows are gone (no anonymized residue), and the event/audit layer is anonymized irreversibly in the same transaction. Anonymization is one-way *by construction* — a reversible `student_id → surrogate` mapping table is forbidden, because that would be pseudonymization (still personal data), not anonymization, and would make the "retained for modeling" claim a compliance liability. There is never a window where derived rows are deleted but event rows still carry identity.

### **2.6 05D governs cross-doc seams; it does not rewrite siblings**

The 04B→05C seam is documented and governed here because 05D is the family's seam owner. Documenting a contract that 04B must satisfy is not rewriting 04B. The seam items remain `BLOCKING_UPSTREAM_GAP` until 04B (locked V4.3) satisfies them; 05D is the single place that obligation is recorded for the family.

---

## **3\. Hard Invariants**

### **3.1 Inherited from Parent §6 (re-applied at the governance grain)**

* **INV-05D-P1 (server-authoritative):** every 05D-owned write (audit log, change log, recompute output, cascade) is performed only by `service_role` through the defined paths. No client write path exists.  
* **INV-05D-P2 (no client trust):** recompute inputs are canonical server-side records only; the cascade operates on the authenticated deletion request resolved server-side.  
* **INV-05D-P3 (entitlement irrelevance for governance):** the audit log, change log, and recompute are internal; they have no student/guardian read surface and no entitlement gate (there is nothing for a student or guardian to read here).  
* **INV-05D-P4 (deterministic recompute):** the backfill recompute over the same canonical events and the same constants snapshot produces byte-identical `student_*_mastery` / KPI / projection rows.

### **3.2 Inherited from 05A/05B/05C and re-applied at 05D grain**

* **INV-05D-A1 (one formula path):** 05D recompute calls 05A's LOCKED recompute RPC `recompute_skill_mastery` (skill), 05B's `refresh_domain_mastery` (domain), and 05C's `compute_section_projection` (projection), plus 05B's KPI refreshers. It never calls 05A's pure inner `compute_mastery_for_entity` directly (that does not persist rows) and never reimplements any formula, blend, or range (RB-05D-V1-A).  
* **INV-05D-A2 (hash-vintage honesty):** 05D never rewrites the `constants_snapshot_hash` / `projection_constants_hash` of an existing row outside of a backfill that recomputes the row from canonical events. A constants change never restamps a hash.  
* **INV-05D-A3 (operational/formula separation preserved):** the change log records `affects_formula_hash` as informational metadata; 05D never folds operational constants into the formula hash and never folds formula constants out of it (RB-05B-V1-01 / RB-05C-V1-06 precedent).

### **3.3 05D-specific invariants**

### **INV-05D-13 — No recompute trigger exists**

There is no database trigger, scheduled job, or RPC anywhere in the family that recomputes existing mastery/KPI/projection rows in response to a `mastery_constants` change. The only recompute is the explicitly-invoked, never-computed backfill (§7). Enforcement: §6.4 (change log has no `recompute_status`), a CI guard `no_constants_change_recompute_path`, and the §13 fixture asserting a constant change leaves existing rows' hashes unchanged.

### **INV-05D-14 — Constants change log cannot be silently bypassed**

Every write to `mastery_constants` (INSERT/UPDATE/DELETE), including direct dashboard/migration edits, produces a `mastery_constants_change_log` row. This is guaranteed by an `ENABLE ALWAYS` capture trigger (fires even under `session_replication_role = replica`, the mode migrations/replication run in) plus a periodic reconciliation hash-check that alarms if current constants state diverges from the last change-log entry's resulting-state hash. Enforcement: §6 trigger definition \+ §6.5 reconciliation job \+ §13 fixture (bypass attempt → reconciliation alarm).

### **INV-05D-15 — The audit log is append-only**

Neither `mastery_event_audit_log` nor `mastery_domain_refresh_audit_log` has an UPDATE or DELETE policy for any role except the §10 account-deletion cascade. **When the anonymized-retention path is enabled** (§10.4 privacy/compliance gate cleared), that cascade UPDATEs `student_id` to the locked UUID surrogate and never DELETEs an audit row. **In the privacy-conservative fallback mode** (gate not yet cleared, §10.4), the cascade instead hard-DELETEs the Layer-2 audit rows for the deleted student — this is the single, explicit, documented exception to "never deleted," and it is *more* privacy-protective, not less. INV-05D-15's append-only/never-delete guarantee is therefore scoped: it holds in normal operation and under anonymized-retention; it is deliberately relaxed only by the §10.4 fallback hard-delete (RB-05D-V1-B). Enforcement: §4.6 RLS (no UPDATE/DELETE policy for any non-cascade role) \+ §10.4 mode definition \+ §13 fixtures D20 (fallback hard-delete) and D21 (retention anonymize-not-delete).

### **INV-05D-16 — Deletion anonymization is one-way by construction**

The account-deletion cascade anonymizes the event/audit layer by replacing `student_id` with an irreversible surrogate and dropping identifying columns, in the same transaction as the derived-row hard-delete. No reversible `student_id → surrogate` mapping table may exist. Enforcement: §10 cascade definition \+ INV-05D-16 CI guard `no_reverse_anonymization_map` (asserts no table maps surrogate back to student\_id) \+ the §13 cascade fixture \+ the §10 privacy/compliance gate.

### **INV-05D-17 — Recompute is backfill-only and dependency-ordered**

The only recompute path is selected exclusively for never-computed / incomplete-derived students by the §7.3 backfill driver — never by a constants change. Within a selected student's single transaction: skill and domain rows are created only when missing; KPI and projection are terminal materialized surfaces refreshed deterministically so they reflect final derived state. Strict skill → domain → KPI → projection order, one transaction per student. There is no partial recompute, no out-of-order recompute, and no constants-change recompute (RB-05D-V1-04). Enforcement: §7 job definition \+ §7.4 ordering assertion \+ the §8 verification harness \+ the §13 fixture.

### **INV-05D-18 — Every family deferral resolves here**

Every "05D owns/defines X" forward-reference in Parent/05A/05B/05C is enumerated in §14 with the resolving §-anchor in this document. A deferral with no resolving anchor is a release blocker. Enforcement: §14 closure table \+ the end-to-end audit's family-closure sweep.

---

## **4\. Mastery Audit Log Layer (Two Locked Tables — 05A & 05B Contracts)**

### **4.0 Reconciliation note: the family locked TWO audit tables, not one**

The pre-draft Q1 decision selected a "unified" audit log. During the capstone cross-doc audit this was found to **contradict two locked sibling contracts**, and the locked siblings win (INV-05D-18 / §2.1 — the capstone resolves promises, it does not override locked decisions):

* **Doc 05A V1.0 (locked, RB-05A-V1-20)** writes to a table named **`mastery_event_audit_log`** with a specific 20-column schema (§4.8) and a **`(event_source_kind, event_id)` UNIQUE constraint that enforces INV-05A-10 idempotency**. 05A's `apply_mastery_event` dedup semantics *depend* on this constraint; 05A's §11 gate hard-fails `BLOCKING_05D_CONTRACT_GAP` without it.  
* **Doc 05B V1.0 (locked)** writes to a table named **`mastery_domain_refresh_audit_log`** and states verbatim: *"separate table from 05A's `mastery_event_audit_log` because the events are different — 05A logs per-event applications, 05B logs per-domain refreshes."* 05B's §11 gate hard-fails `BLOCKING_05D_CONTRACT_GAP` without it.

Unifying these would break 05A's locked idempotency constraint contract and 05B's locked explicit-separation statement. Therefore 05D defines **both tables exactly as the locked siblings contracted**. The "unified surface discriminator" idea is dropped as incompatible with locked V1.0 siblings; this section supersedes the Q1=c framing with the only family-consistent resolution. Projections remain excluded from both (05C's snapshot table is the projection audit trail — that part of Q1=c stands and does not conflict with anything).

### **4.1 `mastery_event_audit_log` (05A contract — per-event, idempotency-bearing)**

Exact schema 05D MUST provide so 05A's locked §4.8 insert and INV-05A-10 hold:

CREATE TABLE IF NOT EXISTS public.mastery\_event\_audit\_log (  
    audit\_row\_id            uuid          NOT NULL DEFAULT gen\_random\_uuid() PRIMARY KEY,

    student\_id              uuid          NOT NULL,  
    section                 text          NOT NULL CHECK (section IN ('M','RW')),  
    domain                  text          NOT NULL,  
    skill                   text          NOT NULL,

    source\_family           text          NOT NULL CHECK (source\_family IN ('test','practice','review')),  
    event\_source\_kind       text          NOT NULL  
        CHECK (event\_source\_kind IN ('practice\_attempt','diagnostic\_attempt','review\_error\_attempt','full\_length\_answer')),  
    event\_id                uuid          NOT NULL,  
    question\_id             uuid          NULL,

    difficulty              smallint      NULL,  
    correct                 boolean       NULL,  
    occurred\_at             timestamptz   NULL,

    mastery\_score\_before    numeric(10,9) NULL,  
    mastery\_score\_after     numeric(10,9) NULL,  
    mastery\_level\_before    smallint      NULL,  
    mastery\_level\_after     smallint      NULL,  
    event\_count\_after       integer       NOT NULL CHECK (event\_count\_after \>= 0),

    constants\_snapshot\_hash text          NOT NULL,  
    mastery\_model\_version   text          NOT NULL,

    applied\_at              timestamptz   NOT NULL DEFAULT now(),

    \-- INV-05A-10 idempotency: the dedup key 05A's RPC relies on  
    \-- (RB-05A-V1-20). 05A's pre-write dedup SELECTs this pair and the  
    \-- unique-violation handler interprets a collision as completed  
    \-- idempotent re-entry. This constraint is load-bearing for 05A  
    \-- semantics and MUST exist exactly as named.  
    CONSTRAINT mastery\_event\_audit\_log\_dedup\_uq  
        UNIQUE (event\_source\_kind, event\_id)  
);

CREATE INDEX IF NOT EXISTS idx\_meal\_student\_time  
    ON public.mastery\_event\_audit\_log (student\_id, applied\_at DESC);

Column order and names match 05A §4.8's `INSERT ... VALUES` exactly. The `(event_source_kind, event_id)` UNIQUE constraint is the single most contract-critical object in 05D: 05A's idempotency invariant INV-05A-10 is enforced *here*. 05D guarantees its presence and shape; 05A writes by contract (INV-05D-A1 — 05D owns the table, 05A owns the call site).

### **4.2 `mastery_domain_refresh_audit_log` (05B contract — per-domain refresh)**

Exact schema 05D MUST provide so 05B's locked §4.8 insert holds:

CREATE TABLE IF NOT EXISTS public.mastery\_domain\_refresh\_audit\_log (  
    audit\_row\_id            uuid          NOT NULL DEFAULT gen\_random\_uuid() PRIMARY KEY,

    student\_id              uuid          NOT NULL,  
    section                 text          NOT NULL CHECK (section IN ('M','RW')),  
    domain                  text          NOT NULL,

    mastery\_score\_before    numeric(10,9) NULL,  
    mastery\_score\_after     numeric(10,9) NULL,  
    mastery\_level\_before    smallint      NULL,  
    mastery\_level\_after     smallint      NULL,  
    event\_count\_after       integer       NOT NULL CHECK (event\_count\_after \>= 0),

    \-- 05B's locked provenance enum: 'event' (normal refresh path) or  
    \-- 'backfill\_recompute' (§7). No 'constants\_change' value — INV-05D-13.  
    triggered\_by            text          NOT NULL  
        CHECK (triggered\_by IN ('event','backfill\_recompute')),

    last\_event\_id           uuid          NULL,  
    last\_event\_occurred\_at  timestamptz   NULL,

    constants\_snapshot\_hash text          NOT NULL,  
    mastery\_model\_version   text          NOT NULL,

    applied\_at              timestamptz   NOT NULL DEFAULT now()  
);

CREATE INDEX IF NOT EXISTS idx\_mdral\_student\_time  
    ON public.mastery\_domain\_refresh\_audit\_log (student\_id, applied\_at DESC);  
CREATE INDEX IF NOT EXISTS idx\_mdral\_triggered\_by  
    ON public.mastery\_domain\_refresh\_audit\_log (triggered\_by, applied\_at DESC);

Columns match 05B §4.8 (the `triggered_by` enum, `last_event_*` audit anchors from RB-05B-V1-08, before/after, hash, version). This is per-domain-refresh provenance, deliberately separate from per-event provenance (05B's locked rationale).

### **4.3 Why two tables (locked sibling rationale, restated)**

|  | `mastery_event_audit_log` | `mastery_domain_refresh_audit_log` |
| ----- | ----- | ----- |
| Owner of contract | 05A (RB-05A-V1-20) | 05B (§4.8) |
| Grain | one row per `apply_mastery_event` (per upstream event) | one row per `refresh_domain_mastery` (per domain refresh) |
| Load-bearing constraint | `(event_source_kind, event_id)` UNIQUE → INV-05A-10 idempotency | none (refreshes are not deduped by event) |
| Written by | 05A skill-mastery RPC, blocking, in the upsert txn | 05B `refresh_domain_mastery`, blocking, in the upsert txn |
| `triggered_by` | n/a (every event application logs) | `event` | `backfill_recompute` |

Conflating them would have destroyed 05A's idempotency dedup (the unique key is on an event pair that has no meaning at domain-refresh grain) — which is why 05B explicitly contracted them apart. 05D honors the locked design.

### **4.4 Skill-refresh audit**

05A's per-event write to `mastery_event_audit_log` already captures skill-grain transitions (`section, domain, skill, mastery_score_before/after` at skill grain — §4.1 columns). There is no separate skill-refresh audit table; the per-event log *is* the skill audit trail (05A logs every event application, which is exactly a skill transition). This matches 05A's locked contract and adds nothing.

### **4.5 Projections excluded (Q1=c, the part that stands)**

Neither audit table records projection refreshes. 05C's append-only `student_section_projection_snapshots` is the canonical projection audit trail (05C §7.2 / INV-05C-17). 05D references it read-only for the §7 backfill and never duplicates it. This is the one part of the original Q1=c framing that is fully consistent with the locked family and is retained.

### **4.6 RLS and grants (both tables)**

ALTER TABLE public.mastery\_event\_audit\_log          ENABLE ROW LEVEL SECURITY;  
ALTER TABLE public.mastery\_domain\_refresh\_audit\_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mastery\_event\_audit\_log          FROM PUBLIC;  
REVOKE ALL ON public.mastery\_domain\_refresh\_audit\_log FROM PUBLIC;

GRANT ALL    ON public.mastery\_event\_audit\_log          TO service\_role;  
GRANT ALL    ON public.mastery\_domain\_refresh\_audit\_log TO service\_role;  
GRANT SELECT ON public.mastery\_event\_audit\_log          TO admin\_role;  
GRANT SELECT ON public.mastery\_domain\_refresh\_audit\_log TO admin\_role;

\-- RB-05D-V1-08: with RLS ENABLED, a GRANT SELECT alone does NOT let  
\-- admin\_role read rows — RLS denies by default when no policy matches.  
\-- An explicit admin SELECT policy is REQUIRED (preferred over relying  
\-- on a BYPASSRLS role attribute: a policy is auditable and least-  
\-- privilege). service\_role bypasses RLS by Supabase convention; it  
\-- needs no policy.  
CREATE POLICY admin\_select\_mastery\_event\_audit\_log  
    ON public.mastery\_event\_audit\_log  
    FOR SELECT TO admin\_role USING (true);

CREATE POLICY admin\_select\_mastery\_domain\_refresh\_audit\_log  
    ON public.mastery\_domain\_refresh\_audit\_log  
    FOR SELECT TO admin\_role USING (true);

\-- No authenticated policy on either (internal; INV-05D-P3). No  
\-- UPDATE/DELETE policy for any role except the §10 cascade path  
\-- (service\_role, RLS-bypassing). Append-only (INV-05D-15, mode-scoped  
\-- per §4.7).

### **4.7 Append-only & retention**

Both tables are append-only (INV-05D-15) with exactly one cascade exception, mode-dependent (RB-05D-V1-06, reconciling §4.7 with the §10.4 privacy fallback):

* **Normal operation:** strictly append-only — no UPDATE/DELETE by any role.  
* **§10 cascade, anonymized-retention mode** (privacy/compliance gate cleared): the cascade UPDATEs `student_id` to the locked UUID surrogate; no rows are deleted.  
* **§10 cascade, privacy-conservative fallback mode** (gate not cleared): the cascade hard-DELETEs the deleted student's Layer-2 rows from BOTH tables.

Both modes are mandatory test paths — D21 (anonymized-retention: row counts unchanged, `student_id` surrogated) and D20 (fallback: Layer-2 rows hard-deleted). Retained indefinitely in V1.0 except the §10 cascade; volume-driven partition/retention is a §16.6 V1.1 note. The §10 cascade Layer-2 touches BOTH tables (they both carry `student_id`).

## **5\. `mastery_constants` Write Governance**

### **5.1 The model: future-only, no recompute**

Per Q2 (revised): a `mastery_constants` change affects only computes that happen *after* the change. No existing row is restamped. There is no recompute trigger (INV-05D-13). The governance surface is therefore narrow: guarantee that every constant change is *recorded* (so there is no silent drift), and make the vintage of every row self-evident (already locked — every row carries its constants hash).

### **5.2 `mastery_constants_change_log`**

CREATE TABLE IF NOT EXISTS public.mastery\_constants\_change\_log (  
    change\_id            bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    op                   text          NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),  
    constant\_key         text          NOT NULL,

    old\_value            jsonb         NULL,    \-- NULL for INSERT  
    new\_value            jsonb         NULL,    \-- NULL for DELETE

    \-- Informational metadata only (NOT a recompute control — INV-05D-13).  
    \-- True if constant\_key is in the formula-hash key set; false if it is  
    \-- an operational key (KPI windows, projection deltas, refresh  
    \-- thresholds, domain weights). Recorded for at-a-glance triage, never  
    \-- read by any recompute path (there is none).  
    affects\_formula\_hash boolean       NOT NULL,

    \-- Provenance: who/where, even for a direct dashboard/migration edit.  
    actor\_role           text          NOT NULL,   \-- current\_user at write time  
    actor\_session\_user   text          NOT NULL,   \-- session\_user at write time  
    txid                 bigint        NOT NULL,   \-- txid\_current()

    \-- Resulting-state hash AFTER this change, over the full active  
    \-- constants set. The §6.5 reconciliation job compares the live  
    \-- constants hash against the most recent row's value here.  
    resulting\_state\_hash text          NOT NULL,

    changed\_at           timestamptz   NOT NULL DEFAULT now()  
);

CREATE INDEX IF NOT EXISTS idx\_mccl\_key\_time  
    ON public.mastery\_constants\_change\_log (constant\_key, changed\_at DESC);  
CREATE INDEX IF NOT EXISTS idx\_mccl\_time  
    ON public.mastery\_constants\_change\_log (changed\_at DESC);

There is deliberately **no `recompute_status` column** (the Q4 premise is void — no recompute is triggered by a change). A reviewer looking for recompute orchestration state here will correctly find none; INV-05D-13.

RLS and grants (RB-05D-V1-C — specified here with the same explicitness as the §4.6 audit tables):

ALTER TABLE public.mastery\_constants\_change\_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL    ON public.mastery\_constants\_change\_log FROM PUBLIC;  
GRANT  ALL    ON public.mastery\_constants\_change\_log TO   service\_role;  
GRANT  SELECT ON public.mastery\_constants\_change\_log TO   admin\_role;

\-- RB-05D-V1-08: explicit admin SELECT policy required (GRANT alone does  
\-- not bypass enabled RLS). service\_role bypasses RLS by convention.  
CREATE POLICY admin\_select\_mastery\_constants\_change\_log  
    ON public.mastery\_constants\_change\_log  
    FOR SELECT TO admin\_role USING (true);

\-- No authenticated (student/guardian) policy — this is an internal  
\-- governance audit record (INV-05D-P3). Append-only: no UPDATE/DELETE  
\-- policy for any role. Unlike the §4 audit tables, the change log is  
\-- NOT touched by the §10 account-deletion cascade — a constants change  
\-- is not student-identifying (actor\_role/session\_user are operator  
\-- identities, not the deleted student), so change-log rows are retained  
\-- across account deletions for governance continuity.

The change log is append-only with no exceptions (it is never anonymized or deleted by the §10 cascade because it contains no student identity — its `actor_*` columns are operator/migration identities). This is a deliberate distinction from the §4 audit tables, which do carry `student_id` and therefore participate in the §10 Layer-2 path.

### **5.3 Write path**

Direct table writes to `mastery_constants` are permitted for `service_role` and the admin/migration path (Q2=b: no mandatory RPC). This matches the dashboard-level operational workflow used elsewhere in the family (e.g., the Supabase-dashboard SMTP/password-reset decisions). Safety does not come from forcing an RPC; it comes from the capture trigger (§6) being unbypassable and the reconciliation job (§6.5) detecting any bypass.

### **5.4 `affects_formula_hash` classification**

The trigger (§6) sets `affects_formula_hash` by testing membership of `constant_key` in the canonical formula-hash key set (the set serialized by 05A's `canonicalize_mastery_constants_serialized()`). Operational keys (`KPI_RECENCY_WINDOW_*`, all `PROJECTION_*`, refresh thresholds, `PROJECTION_DOMAIN_WEIGHTS`) classify `false`; formula keys classify `true`. This is metadata for human triage only; no code path branches on it for recompute (there is no recompute). The classification function is `public.constant_affects_formula_hash(key text) RETURNS boolean`, defined in §6.3, and is the single source of the formula/operational boundary at the governance layer (consistent with INV-05D-A3).

---

## **6\. Capture Trigger & Reconciliation (No Recompute)**

### **6.1 Capture-only trigger — `ENABLE ALWAYS`**

Per the locked decision, the only trigger on `mastery_constants` is a **capture-only** trigger that records every change into the change log. It does NOT recompute anything (INV-05D-13). It is `ENABLE ALWAYS` so it fires even if a privileged migration, a replication-apply process, or an operational script runs with `session_replication_role = replica` (RB-05D-V1-01). Normal migrations usually run under `origin` semantics — where a plain `ENABLE` trigger already fires — but logical-replication apply and any script that sets `replica` would silently skip a plain `ENABLE` trigger, reintroducing exactly the silent-drift failure class the family is built against. `ENABLE ALWAYS` closes that replica-mode bypass (INV-05D-14).

CREATE OR REPLACE FUNCTION public.capture\_mastery\_constant\_change()  
RETURNS trigger  
LANGUAGE plpgsql  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $func$  
DECLARE  
    v\_key          text;  
    v\_old          jsonb;  
    v\_new          jsonb;  
    v\_affects      boolean;  
    v\_state\_hash   text;  
BEGIN  
    IF TG\_OP \= 'INSERT' THEN  
        v\_key := NEW.key;  v\_old := NULL;        v\_new := NEW.value;  
    ELSIF TG\_OP \= 'UPDATE' THEN  
        v\_key := NEW.key;  v\_old := OLD.value;   v\_new := NEW.value;  
    ELSE  \-- DELETE  
        v\_key := OLD.key;  v\_old := OLD.value;   v\_new := NULL;  
    END IF;

    v\_affects := public.constant\_affects\_formula\_hash(v\_key);

    \-- RB-05D-V1-02: resulting-state hash over the FULL active constants  
    \-- set AFTER this change, via the SINGLE canonical serializer (§6.6).  
    \-- The earlier inline \`mc.value \#\>\> '{}'\` was only correct for scalar  
    \-- JSONB and produced unstable text for object-valued constants like  
    \-- PROJECTION\_DOMAIN\_WEIGHTS — exactly the RB-05C-V1-06 discipline.  
    \-- The trigger and the §6.5 reconciliation job MUST use the same  
    \-- helper so they can never diverge.  
    v\_state\_hash := encode(  
        digest(  
            convert\_to(  
                public.canonicalize\_active\_mastery\_constants\_state(),  
                'UTF8'),  
            'sha256'),  
        'hex');

    INSERT INTO public.mastery\_constants\_change\_log (  
        op, constant\_key, old\_value, new\_value,  
        affects\_formula\_hash,  
        actor\_role, actor\_session\_user, txid,  
        resulting\_state\_hash, changed\_at  
    ) VALUES (  
        TG\_OP, v\_key, v\_old, v\_new,  
        v\_affects,  
        current\_user, session\_user, txid\_current(),  
        v\_state\_hash, now()  
    );

    RETURN NULL;  \-- AFTER trigger; return value ignored  
END;  
$func$;

DROP TRIGGER IF EXISTS trg\_capture\_mastery\_constant\_change ON public.mastery\_constants;

CREATE TRIGGER trg\_capture\_mastery\_constant\_change  
    AFTER INSERT OR UPDATE OR DELETE ON public.mastery\_constants  
    FOR EACH ROW  
    EXECUTE FUNCTION public.capture\_mastery\_constant\_change();

\-- ENABLE ALWAYS so it fires even under session\_replication\_role \=  
\-- replica (logical-replication apply, or a privileged script that sets  
\-- replica). Normal migrations run under origin where a plain ENABLE  
\-- already fires; this closes the replica-mode bypass. INV-05D-14.  
ALTER TABLE public.mastery\_constants  
    ENABLE ALWAYS TRIGGER trg\_capture\_mastery\_constant\_change;

The trigger is `AFTER ... FOR EACH ROW` so a multi-row constant migration produces one change-log row per changed key (correct granularity for audit). It computes the resulting-state hash from the post-change `mastery_constants` content so the reconciliation job (§6.5) has a per-change checkpoint.

### **6.2 What the trigger does NOT do**

It does not enqueue, schedule, or perform any recompute. It does not write `recompute_status` (no such column). It does not touch any `student_*_mastery` / KPI / projection row. It does not read or modify the formula hash on any existing row. Its sole effect is appending one change-log row. This is the entire constants-change side-effect surface of the family (INV-05D-13).

### **6.3 `constant_affects_formula_hash` classifier**

CREATE OR REPLACE FUNCTION public.constant\_affects\_formula\_hash(p\_key text)  
RETURNS boolean  
LANGUAGE plpgsql  
IMMUTABLE  
AS $func$  
DECLARE  
    \-- RB-05D-V1-03: CLOSED-WORLD classifier. The earlier version returned  
    \-- true for ANY key not in the operational list, so a typo like  
    \-- 'PROJECTION\_MIN\_DETLA' was silently classified formula-affecting  
    \-- instead of failing as an unknown constant — a governance hole.  
    \-- Now: known formula key \-\> true; known operational key \-\> false;  
    \-- ANYTHING else \-\> raise CONSTANT\_KEY\_UNKNOWN. Both sets are explicit  
    \-- registries; their union is the entire legal constant key space.  
    v\_operational text\[\] := ARRAY\[  
        'KPI\_RECENCY\_WINDOW\_SHORT\_DAYS',  
        'KPI\_RECENCY\_WINDOW\_LONG\_DAYS',  
        'PROJECTION\_TARGET\_QUESTION\_COUNT\_PER\_SECTION',  
        'PROJECTION\_MIN\_DELTA',  
        'PROJECTION\_MAX\_DELTA',  
        'PROJECTION\_MIDPOINT\_ROUND\_TO',  
        'PROJECTION\_BOUND\_ROUND\_TO',  
        'PROJECTION\_SECTION\_MAX\_SCORE',  
        'PROJECTION\_SECTION\_MIN\_SCORE',  
        'PROJECTION\_REFRESH\_EVENT\_THRESHOLD',  
        'PROJECTION\_REFRESH\_TIME\_THRESHOLD\_HOURS',  
        'PROJECTION\_DOMAIN\_WEIGHTS'  
    \];  
    \-- The formula key registry MUST equal the key set serialized by 05A's  
    \-- canonicalize\_mastery\_constants\_serialized() (24-key canonical list,  
    \-- 05A §9.3 / RB-05A-V1-12/21). The §11 gate asserts byte-equality;  
    \-- this array is the governance-layer mirror of that locked set.  
    v\_formula text\[\] := ARRAY\[  
        'WEIGHT\_SOURCE\_TEST', 'WEIGHT\_SOURCE\_PRACTICE', 'WEIGHT\_SOURCE\_REVIEW',  
        'DIFFICULTY\_WEIGHT\_EASY', 'DIFFICULTY\_WEIGHT\_MEDIUM', 'DIFFICULTY\_WEIGHT\_HARD',  
        'POSITION\_WEIGHT\_HALFLIFE', 'MASTERY\_SCORE\_MIN', 'MASTERY\_SCORE\_MAX',  
        'MIN\_EVENTS\_FOR\_MASTERY', 'ROUND\_MASTERY\_PCT\_DECIMALS',  
        'MASTERY\_LEVEL\_BOUNDARY\_1', 'MASTERY\_LEVEL\_BOUNDARY\_2',  
        'MASTERY\_LEVEL\_BOUNDARY\_3', 'MASTERY\_LEVEL\_BOUNDARY\_4',  
        'DIAGNOSTIC\_TOTAL\_QUESTIONS', 'SECTION\_DOMAIN\_COUNT',  
        'MASTERY\_MODEL\_VERSION', 'CANONICAL\_DIFFICULTY\_MIN',  
        'CANONICAL\_DIFFICULTY\_MAX', 'SOURCE\_FAMILY\_RENORM\_MISSING',  
        'MACRO\_AVERAGE\_MODE', 'COLD\_START\_NULL\_POLICY', 'EVENT\_POSITION\_TIEBREAK'  
    \];  
BEGIN  
    IF p\_key \= ANY (v\_formula)     THEN RETURN true;  END IF;  
    IF p\_key \= ANY (v\_operational) THEN RETURN false; END IF;  
    RAISE EXCEPTION  
        'CONSTANT\_KEY\_UNKNOWN: % is in neither the formula nor the operational registry — unknown/typo constant key, not classifiable',  
        p\_key;  
END;  
$func$;

This is the single governance-layer statement of the operational/formula boundary (INV-05D-A3). It is **closed-world** (RB-05D-V1-03): a key in neither registry raises `CONSTANT_KEY_UNKNOWN` rather than being silently classified — so a misspelled constant key fails loudly at write time (the capture trigger calls this; an unknown key aborts the constants write) instead of being recorded with a wrong `affects_formula_hash`. The §11 verification gate asserts (a) `v_formula` equals the key set 05A's `canonicalize_mastery_constants_serialized()` serializes, byte-for-byte, and (b) `v_operational` equals the 05B/05C-declared operational keys, so the two registries' union is exactly the legal constant key space and the classifier can never disagree with the formula hash. CI guards: `operational_key_set_matches_formula_hash_complement` and `classifier_is_closed_world` (asserts the function raises on an unknown key).

Implementation caveat: the `v_formula` array is the *governance-layer mirror* of 05A's locked 24-key canonical formula-constant list (05A §9.3 / RB-05A-V1-12/21). The member strings shown are the expected set; they MUST be reconciled byte-for-byte against 05A's `canonicalize_mastery_constants_serialized()` during the §11 gate (`BLOCKING_UPSTREAM_GAP` if 05A's locked list and this mirror differ). The closed-world *behavior* (unknown key → raise `CONSTANT_KEY_UNKNOWN`) is the locked contract regardless of the exact membership; only the precise key strings are pending the §11 reconciliation.

### **6.4 No `recompute_status` — by design**

The change log has no recompute-orchestration columns because no recompute is triggered (INV-05D-13). A constant change is *complete* the moment its change-log row is written. Existing rows' vintages are unaffected and self-described by their stored hashes (§2.2). This is the deliberate elimination of the most dangerous operation class in a mastery system; it is not an omission.

### **6.5 Reconciliation hash-check (bypass detection)**

A trigger can be bypassed by a sufficiently privileged actor (`ALTER TABLE ... DISABLE TRIGGER`, or dropping it). `ENABLE ALWAYS` closes the `session_replication_role = replica` gap, but defense-in-depth requires detecting a bypass that disabled or dropped the trigger entirely. 05D owns a periodic reconciliation job:

\-- 05D-owned scheduled job (cadence: at least daily; 05D owns the  
\-- schedule, see §9). Pseudocode contract:  
\--  
\--   v\_live\_hash := encode(digest(convert\_to(  
\--                    public.canonicalize\_active\_mastery\_constants\_state(),  
\--                    'UTF8'),'sha256'),'hex')  
\--                  \-- THE SAME helper the §6.1 trigger uses  
\--                  \-- (RB-05D-V1-02); they cannot diverge.  
\--  
\--   v\_last\_log\_hash := resulting\_state\_hash of the FINAL change-log  
\--                      checkpoint, selected by:  
\--                        SELECT resulting\_state\_hash  
\--                        FROM   public.mastery\_constants\_change\_log  
\--                        ORDER BY change\_id DESC      \-- RB-05D-V1-09  
\--                        LIMIT 1;  
\--                      MUST order by change\_id DESC (the monotonic  
\--                      identity), NOT by changed\_at: a multi-row  
\--                      constant migration writes several rows with the  
\--                      SAME changed\_at; timestamp ordering could pick a  
\--                      non-final intermediate row and raise a FALSE  
\--                      CONSTANTS\_DRIFT\_DETECTED. The highest change\_id  
\--                      is by definition the final post-migration  
\--                      checkpoint (the trigger computes resulting\_state\_  
\--                      hash over the full active set AFTER each row, so  
\--                      the last-applied row's hash is the true end state).  
\--  
\--   IF v\_live\_hash \<\> v\_last\_log\_hash THEN  
\--       RAISE / alarm: 'CONSTANTS\_DRIFT\_DETECTED' — a constants write  
\--       occurred without a change-log row (trigger bypassed/disabled),  
\--       OR the change log is otherwise inconsistent. This is an  
\--       operational incident, not a silent state.  
\--   END IF;  
\--  
\--   (The job also re-asserts the trigger is present and ENABLE ALWAYS;  
\--    a missing/disabled trigger is itself the alarm condition.)

This makes INV-05D-14 enforceable rather than merely asserted: even a privileged direct edit that disabled the trigger is caught at the next reconciliation, with an explicit `CONSTANTS_DRIFT_DETECTED` incident rather than silent drift. The §13 fixture exercises the bypass path (disable trigger → direct UPDATE → reconciliation must alarm).

### **6.6 `canonicalize_active_mastery_constants_state()` (RB-05D-V1-02)**

Per RB-05D-V1-02, the resulting-state hash is computed over a *canonical* serialization, mirroring 05C's `canonicalize_projection_constants_serialized()` (RB-05C-V1-06) and 05A's `canonicalize_mastery_constants_serialized()` disciplines. A single helper is used by BOTH the §6.1 capture trigger and the §6.5 reconciliation job so they can never produce divergent hashes for the same constants state. It serializes every active constant with sorted keys, deterministic object serialization for JSONB-object constants (e.g. `PROJECTION_DOMAIN_WEIGHTS`), and fixed numeric formatting.

CREATE OR REPLACE FUNCTION public.canonicalize\_active\_mastery\_constants\_state()  
RETURNS text  
LANGUAGE sql  
STABLE  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $func$  
    \-- One deterministic line per active constant, keys sorted. For each  
    \-- value:  
    \--   \* JSONB scalar  \-\> its text via \#\>\> '{}'  
    \--   \* JSONB object  \-\> recursively key-sorted "k=v,k=v" with numeric  
    \--                       values fixed-formatted (FM9990.000000)  
    \-- jsonb\_build is NOT used for hashing input (its text form is not a  
    \-- canonicalization guarantee across PG versions); we build the string  
    \-- explicitly.  
    SELECT COALESCE(string\_agg(line, E'\\n' ORDER BY k), '')  
    FROM (  
        SELECT  
            mc.key AS k,  
            mc.key || '=' ||  
            CASE jsonb\_typeof(mc.value)  
                WHEN 'object' THEN  
                    '{' || COALESCE((  
                        SELECT string\_agg(  
                                 o.key || '=' ||  
                                 CASE jsonb\_typeof(o.value)  
                                     WHEN 'number'  
                                       THEN to\_char((o.value \#\>\> '{}')::numeric,  
                                                    'FM9990.000000')  
                                     ELSE  (o.value \#\>\> '{}')  
                                 END,  
                                 ',' ORDER BY o.key)  
                        FROM jsonb\_each(mc.value) o  
                    ), '') || '}'  
                WHEN 'number' THEN  
                    to\_char((mc.value \#\>\> '{}')::numeric, 'FM9990.000000')  
                ELSE  
                    (mc.value \#\>\> '{}')  
            END AS line  
        FROM public.mastery\_constants mc  
        WHERE mc.active \= true  
    ) s;  
$func$;

REVOKE ALL ON FUNCTION public.canonicalize\_active\_mastery\_constants\_state FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.canonicalize\_active\_mastery\_constants\_state TO service\_role;

Output is a stable, human-inspectable multi-line string. Both the trigger (§6.1) and the reconciliation job (§6.5) hash exactly this; a CI guard `constants_state_hash_single_serializer` asserts no other serialization of the active-constants state exists in the codebase. Object constants (only `PROJECTION_DOMAIN_WEIGHTS` in V1.0) serialize deterministically with sorted inner keys and fixed numeric formatting, so the reconciliation hash is stable across Postgres versions and jsonb internals — closing the RB-05D-V1-02 gap.

---

## **7\. Backfill Recompute (Never-Computed Case Only)**

### **7.1 Scope**

Per Q3 (collapsed): the ONLY recompute in the family. It exists for one scenario — canonical events exist for a student but the derived rows do not (the "legacy" migration path 05B §11.2 and 05C §11.2 reference: 05B/05C deployed after events already existed, or a greenfield import of historical events). It is NOT a constants-change recompute (INV-05D-13/17). It does not recompute rows that already exist; an existing row is left untouched (its hash records its vintage, §2.2).

### **7.2 `backfill_recompute_student` RPC**

CREATE OR REPLACE FUNCTION public.backfill\_recompute\_student(  
    p\_student\_id  uuid,  
    p\_t\_now       timestamptz DEFAULT now()  
)  
RETURNS void  
LANGUAGE plpgsql  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $func$  
DECLARE  
    v\_sec   text;  
    v\_dom   text;  
    v\_skl   text;  
BEGIN  
    \-- One transaction per student (the caller invokes this once per  
    \-- student; the bounded batch driver in §7.3 manages the set).  
    PERFORM pg\_advisory\_xact\_lock(  
        hashtext('backfill|' || p\_student\_id::text)  
    );  
    SET LOCAL lock\_timeout \= '10s';

    \-- STRICT DEPENDENCY ORDER (INV-05D-17): skill \-\> domain \-\> KPI \-\>  
    \-- projection. Each step is a sibling-owned RPC; 05D never  
    \-- reimplements a formula (INV-05D-A1).  
    \--  
    \-- RB-05D-V1-04 semantics: skill and domain ROWS are created only  
    \-- when missing (the never-computed selection). KPI and projection  
    \-- are TERMINAL MATERIALIZED SURFACES — they are refreshed  
    \-- deterministically at the end of THIS selected student's  
    \-- transaction because they must reflect the final derived state.  
    \-- This is NOT a constants-change recompute: the student was  
    \-- selected by the never-computed/incomplete-derived backfill driver  
    \-- (§7.3), not by a constants change (INV-05D-13 still holds).

    \-- 1\. Skill mastery: RB-05D-V1-A — call 05A's LOCKED recompute RPC  
    \--    \`recompute\_skill\_mastery\` (05A §5), which truncates the derived  
    \--    skill row and replays canonical event history through the one  
    \--    formula function. compute\_mastery\_for\_entity is 05A's PURE  
    \--    inner function (no writes) and is the WRONG call here — it  
    \--    would compute but never persist student\_skill\_mastery. 05A §5  
    \--    explicitly names "05D's audit/recompute lifecycle" as this  
    \--    RPC's caller; the per-event apply\_mastery\_event path is also  
    \--    wrong for backfill (it is the event-time path, not recompute).  
    FOR v\_sec, v\_dom, v\_skl IN  
        SELECT DISTINCT e.section, e.domain, e.skill  
        FROM   public.canonical\_mastery\_events\_for\_student(p\_student\_id) e  
        WHERE  NOT EXISTS (  
                   SELECT 1 FROM public.student\_skill\_mastery sm  
                   WHERE  sm.student\_id \= p\_student\_id  
                     AND  sm.section \= e.section  
                     AND  sm.domain  \= e.domain  
                     AND  sm.skill   \= e.skill )  
    LOOP  
        \-- Signature per 05A §5 locked contract recompute\_skill\_mastery(  
        \--   p\_student\_id, p\_skill\_id/entity filter). The exact entity-  
        \--   filter parameter shape is reconciled in §11.B against 05A's  
        \--   locked signature (RB-05B-V1-07 cross-doc-seam discipline).  
        PERFORM public.recompute\_skill\_mastery(  
            p\_student\_id, v\_sec, v\_dom, v\_skl  
        );  
    END LOOP;

    \-- 2\. Domain mastery: 05B refresh for every (section,domain) with  
    \--    events but no student\_domain\_mastery row. refresh\_domain\_mastery  
    \--    internally chains the KPI refreshers (05B §4.9), so step 3 is  
    \--    satisfied by step 2 for the domains it touches.  
    FOR v\_sec, v\_dom IN  
        SELECT DISTINCT e.section, e.domain  
        FROM   public.canonical\_mastery\_events\_for\_student(p\_student\_id) e  
        WHERE  NOT EXISTS (  
                   SELECT 1 FROM public.student\_domain\_mastery dm  
                   WHERE  dm.student\_id \= p\_student\_id  
                     AND  dm.section \= e.section  
                     AND  dm.domain  \= e.domain )  
    LOOP  
        PERFORM public.refresh\_domain\_mastery(p\_student\_id, v\_sec, v\_dom);  
    END LOOP;

    \-- 3\. KPI rollups (TERMINAL SURFACE — refreshed unconditionally,  
    \--    RB-05D-V1-04). refresh\_domain\_mastery (step 2\) already chained  
    \--    the section/domain/skill/overall KPI refreshers per 05B §4.9  
    \--    for domains it touched; this terminal refresh guarantees the  
    \--    four KPI surfaces reflect final derived state even when domain  
    \--    rows pre-existed (partial-legacy student). Deterministic upsert,  
    \--    not a reimplementation; still backfill-only because the STUDENT  
    \--    was never-computed-selected.  
    PERFORM public.refresh\_section\_kpi(p\_student\_id, 'M',  p\_t\_now);  
    PERFORM public.refresh\_section\_kpi(p\_student\_id, 'RW', p\_t\_now);  
    PERFORM public.refresh\_overall\_kpi(p\_student\_id, p\_t\_now);

    \-- 4\. Projection (TERMINAL SURFACE — refreshed unconditionally,  
    \--    RB-05D-V1-04). The Q4 gate inside compute\_section\_projection  
    \--    self-protects (emits NULL projection if the 8-domain gate is  
    \--    not met), so calling it unconditionally is correct and  
    \--    deterministic. Backfill-only by student selection, not a  
    \--    constants-change recompute (INV-05D-13).  
    PERFORM public.compute\_section\_projection(p\_student\_id, 'M',  p\_t\_now);  
    PERFORM public.compute\_section\_projection(p\_student\_id, 'RW', p\_t\_now);  
END;  
$func$;

REVOKE ALL ON FUNCTION public.backfill\_recompute\_student FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.backfill\_recompute\_student TO service\_role;

Every step calls a sibling-owned RPC (INV-05D-A1): skill via 05A's locked `recompute_skill_mastery` (RB-05D-V1-A — the named 05D-caller recompute RPC, 05A §5; *not* the pure `compute_mastery_for_entity` and *not* the event-time `apply_mastery_event`), domain via 05B's `refresh_domain_mastery`, KPI/projection via the 05B/05C terminal-surface refreshers. The audit-log rows produced by steps 1–2 carry `triggered_by = 'backfill_recompute'` (§4.2). The advisory lock serializes a backfill against a concurrent live refresh for the same student.

**RB-05D-V1-04 — precise backfill semantics (no contradiction):** *skill and domain rows are created only when missing* (the `NOT EXISTS` selection); *KPI and projection are terminal materialized surfaces refreshed deterministically at the end of the selected student's transaction* because they must reflect final derived state. This is **not** a constants-change recompute and does **not** violate INV-05D-13/17: the *student* enters this function only via the never-computed/incomplete-derived backfill driver (§7.3) — never because a constant changed. INV-05D-17 is stated precisely in §7.4 to reflect this (selection is never-computed-only; inside the selected student's transaction, terminal surfaces refresh deterministically).

### **7.3 Bounded batch driver**

Per Q3=c, students are processed through a bounded batch, never all-at-once:

\-- 05D-owned batch driver contract (scheduled or operator-invoked):  
\--   SELECT student\_id  
\--   FROM   \<students with canonical events\>  
\--   WHERE  NOT EXISTS (a complete derived-row set for that student)  
\--   ORDER BY student\_id  
\--   LIMIT  :batch\_size           \-- bounded; e.g. 200 students/batch  
\--   \-- for each: PERFORM backfill\_recompute\_student(student\_id, now());  
\--   \-- one transaction per student (NOT one transaction for the batch),  
\--   \-- so a single bad student aborts only its own recompute and the  
\--   \-- batch continues; failures are logged per student.

One transaction **per student**, not per batch — INV-05D-17 plus blast-radius containment. `batch_size` is an operational parameter (05D-governed; not a formula constant, so not in `mastery_constants` — it lives in the batch job's own config).

### **7.4 Ordering assertion**

The dependency order skill → domain → KPI → projection is mandatory: domain mastery is event-aggregated (not a skill rollup — 05B INV-05B-13) but the projection (05C) reads domain mastery, and the Q4 gate reads domain `event_count_total`. Computing projection before domain rows exist would emit a spurious NULL projection that a later refresh would have to correct. The §8 harness asserts that after `backfill_recompute_student`, for every student, the projection row's inputs are consistent with the domain rows that exist at end-of-transaction (no projection computed against absent domain state).

### **7.5 What backfill does NOT do**

It does not create skill/domain rows that already exist (the `NOT EXISTS` selection — RB-05D-V1-04). It does not run on a constants change (INV-05D-13). It does not restamp any existing skill/domain row's hash. It does not run "for everyone" — only for never-computed/incomplete-derived students selected by the §7.3 driver. It is idempotent: a second run for the same student creates no new skill/domain rows (every `NOT EXISTS` is now false) and the terminal KPI/projection refreshers are deterministic upserts producing byte-identical rows (§8.2 proves this). The terminal KPI/projection refresh is not a contradiction of "no recompute": the *student* was never-computed-selected; KPI/projection are materialized derivatives that must reflect final state (RB-05D-V1-04).

---

## **8\. Recompute-Verification Harness**

### **8.1 Purpose**

Per Q6 (narrowed): 05D owns a harness that proves the family's "deterministic and auditable" promise for the backfill path and the general determinism invariant. It does NOT verify a constants-change recompute (there is none — INV-05D-13).

### **8.2 Determinism verification**

For a fixture student S with a fixed canonical event set and a fixed  
mastery\_constants snapshot:

  1\. Run backfill\_recompute\_student(S, FIXED\_T\_NOW).  
  2\. Snapshot all derived rows \+ their hashes:  
       student\_skill\_mastery, student\_domain\_mastery,  
       student\_section\_kpi/domain/skill/overall\_kpi,  
       student\_section\_projections.  
  3\. Hard-delete those derived rows (simulate never-computed again).  
  4\. Re-run backfill\_recompute\_student(S, FIXED\_T\_NOW).  
  5\. Assert the new derived rows are BYTE-IDENTICAL to the step-2  
     snapshot, including constants\_snapshot\_hash and  
     projection\_constants\_hash.

Any diff is a determinism failure and blocks release (INV-05D-P4).

### **8.3 Ordering verification**

After backfill\_recompute\_student(S):  
  \- every student\_domain\_mastery row's event\_count\_total equals the  
    count of canonical events for that (section,domain) \[05B INV-05B-13  
    event-aggregation, re-asserted at the seam\];  
  \- the projection row, if non-NULL, was computed against domain rows  
    that exist at end-of-transaction (no projection vs. absent-domain  
    inconsistency — §7.4);  
  \- skill rows exist for every (section,domain,skill) with \>=  
    MIN\_EVENTS\_FOR\_MASTERY events.

### **8.4 Constants-vintage verification (no-recompute proof)**

INV-05D-13 proof:  
  1\. Compute student S normally (event path); record every derived  
     row's constants\_snapshot\_hash / projection\_constants\_hash \= H0.  
  2\. Change a formula constant via the §6 path (change-log row written;  
     resulting\_state\_hash advances).  
  3\. Do NOT trigger any recompute (there is no trigger to fire).  
  4\. Re-read S's derived rows. Assert every hash is STILL H0 — the  
     constant change did not restamp any existing row.  
  5\. Drive one new event for S through the normal path. Assert ONLY the  
     rows that event touched advance to the new hash; untouched rows  
     remain H0.

This fixture is the executable proof of §2.2 / INV-05D-13.

### **8.5 Harness ownership**

The harness is 05D-owned and runs in CI alongside the §13 fixtures. It is not a production runtime path. It is the family's end-to-end determinism gate — the place the per-doc determinism assertions (05A/05B/05C) are checked *together* rather than in isolation.

---

## **9\. Schedules 05C Depends On**

### **9.1 Ownership split (restated for closure)**

05C's projection-refresh throttle (05C §8) names two 05D-owned schedules. 05D owns the *schedule definitions*; 05C owns the *contracts they call*. Restated here so the seam is closed in one place (INV-05D-18):

| Schedule | 05D owns | Calls (05C-owned contract) | Cadence |
| ----- | ----- | ----- | ----- |
| Daily projection-refresh sweep | the scheduled job: select students with `events_since_refresh > 0` and `last_refresh_at` older than `PROJECTION_REFRESH_TIME_THRESHOLD_HOURS` (05C §8.4 query), invoke per student | `compute_section_projection(student,'M'/'RW',now())` \+ reset `student_projection_refresh_state` | at least daily |
| `projection_refresh_outbox` consumer | the worker loop: drain unprocessed `projection_refresh_outbox` rows (05C §7.7), invoke per row, stamp `processed_at` | `compute_section_projection(student,'M'/'RW',now())` (idempotent, at-least-once) | short interval (seconds) |
| Constants reconciliation (§6.5) | the scheduled job: compare live constants hash vs. last change-log `resulting_state_hash`; alarm on mismatch | (no sibling contract — internal) | at least daily |
| Backfill batch driver (§7.3) | operator-invoked or scheduled bounded batch | `backfill_recompute_student(student,now())` | on-demand / migration |

### **9.2 Idempotency, at-least-once & failure handling (RB-05D-V1-D)**

The outbox consumer is at-least-once: a redelivered row re-invokes `compute_section_projection`, which is idempotent (05C §8.5 — identical current row, an extra identical snapshot, harmless). The daily sweep is idempotent for the same reason. Neither schedule may assume exactly-once; both rely on 05C's RPC idempotency, which 05C locked.

Per RB-05D-V1-D, the outbox-consumer failure/retry contract is explicit so the "processed but only one section refreshed" failure class cannot occur:

* **Claim with `SKIP LOCKED`.** The consumer selects unprocessed rows with `FOR UPDATE SKIP LOCKED` so concurrent workers never double-claim a row and a stuck row never blocks the queue.  
* **Atomic per-row completion.** For a claimed row, the worker calls `compute_section_projection` for **both** `M` and `RW` and resets the 05C-owned `student_projection_refresh_state` counter. `processed_at` is stamped **only after all of**: M refresh succeeded, RW refresh succeeded, and the counter reset succeeded. A failure at any step leaves `processed_at` NULL and rolls back that row's work — the row is simply retried on the next drain (idempotent, so the partial work is harmless).  
* **Dead-letter after N attempts.** An `attempt_count` is incremented per claim. After a bounded N (operational config, default 5\) the row is marked `failed` (a distinct terminal state, not `processed`) and an ops alert is emitted; it is excluded from normal draining and surfaced for manual investigation rather than retried forever.  
* **No silent partial success.** Because `processed_at` is set only on full success, a crash between the M and RW refreshes results in re-processing the whole row (both sections again) on retry — never a row marked done with only one section refreshed.

The daily sweep follows the same discipline: per-student work is one transaction; a failed student is logged and retried on the next sweep; it never marks a student "swept" with only one section refreshed. The constants-reconciliation job has no row-level processing — it is a stateless check that alarms on mismatch (§6.5); a failed run simply re-runs next cadence and the drift (if real) is still detected.

These contracts are 05D-owned (the schedules are 05D's); the per-row idempotency they rely on is 05C-owned and locked. The §13 fixture does not simulate scheduler crashes (out of scope for a SQL fixture) but the §11 verification gate requires the consumer implementation to demonstrate the `SKIP LOCKED` claim, the all-or-nothing `processed_at` stamp, and the dead-letter path before the schedule deploys.

### **9.3 No schedule performs a constants-change recompute**

None of these schedules recompute existing rows on a constants change. The sweep and outbox consumer refresh projections on the *normal* throttle/event semantics (a student who is active migrates to new constants naturally, §2.2). The reconciliation job only *detects* drift; it never *repairs* it by recompute. INV-05D-13 holds across every schedule.

---

## **10\. Account-Deletion Cascade & One-Way Anonymization**

### **10.1 Trigger and reference to the locked deletion contract**

The cascade fires at **7-day soft-delete expiry** (the already-locked account-deletion model: 7-day soft-delete window with immediate subscription cancellation at the deletion *request*). 05D does NOT re-litigate the soft-delete window, the cancellation timing, or the user-facing deletion flow — those are owned by the identity/billing contract (Doc 01\) and the existing privacy/retention contract. 05D defines ONLY: (a) the ordering and transactional guarantees of the derived-row hard-delete across 05A/05B/05C, and (b) the one-way anonymization of the event/audit layer in the same transaction (Q5=b).

### **10.2 Two layers, one transaction**

At soft-delete expiry, in a single transaction:

**Layer 1 — hard-delete identity-linked derived state (no residue):**

FK-safe order (children before parents; a table with no FK to another in this set may delete in any relative order, but the listed order is canonical and the migration encodes it exactly):

1\.  student\_section\_projection\_snapshots      (05C; append-only history)  
2\.  student\_section\_projections               (05C; current row)  
3\.  student\_projection\_refresh\_state          (05C; §7.7)  
4\.  projection\_refresh\_outbox                 (05C; §7.7 — both pending and processed rows for this student)  
5\.  student\_section\_kpi                       (05B)  
6\.  student\_domain\_kpi                         (05B)  
7\.  student\_skill\_kpi                          (05B)  
8\.  student\_overall\_kpi                        (05B)  
9\.  student\_domain\_mastery                     (05B)  
10\. student\_skill\_mastery                      (05A)

These are hard `DELETE`s. No anonymized residue of derived state is kept — derived state is reconstructable from canonical events and is not needed for modeling.

**Layer 2 — one-way anonymize the event/audit layer (same transaction):**

\-- v\_surrogate := gen\_random\_uuid()   \-- computed ONCE per deleted  
\--   student (RB-05D-V1-05/07), reused for every Layer-2 UPDATE below.  
\--   A bare \`SET student\_id \= gen\_random\_uuid()\` (per-row) is FORBIDDEN:  
\--   it would emit a different UUID per row and destroy trajectory  
\--   continuity. All Layer-2 UPDATEs use the SAME v\_surrogate, no  
\--   stored linkage to the original student\_id.

11\. canonical event sources (the practice/review/test answer-event rows  
    that feed mastery — the 05A/05B canonical event population):  
        UPDATE ... SET student\_id \= v\_surrogate,  
                       \<drop/null any identifying free-text columns\>  
    keeping only the modeling tuple:  
        (difficulty, source\_family, correct, position-or-ordinal,  
         occurred\_at-as-relative-offset, domain, skill, section, outcome)

12\. mastery\_event\_audit\_log AND mastery\_domain\_refresh\_audit\_log (both carry student\_id):  
        UPDATE ... SET student\_id \= v\_surrogate   \-- SAME surrogate as  
                       step 11 for this student, so per-student trajectory  
                       shape survives for modeling without identity;  
                       keep surface/score-before-after/hash/version  
                       (non-identifying). NEVER DELETE an audit row when  
                       the anonymized-retention path is enabled  
                       (INV-05D-15; see §10.4 fallback exception).

The surrogate is `gen_random_uuid()`, generated once per deleted student, written into the existing `uuid` columns, with no stored linkage — **irreversible by construction** (§10.3, RB-05D-V1-05). Layers 1 and 2 commit together: there is never a window where derived rows are deleted but event/audit rows still carry the real `student_id` (INV-05D-16).

### **10.3 Irreversibility by construction (INV-05D-16)**

The surrogate replacing `student_id` MUST be one-way. **V1.0 locks the surrogate to a fresh random UUID** (`gen_random_uuid()`) written into the existing `student_id uuid NOT NULL` columns of the event/audit tables, with **no stored linkage** to the original `student_id` (RB-05D-V1-05). This is type-safe: the retained columns are typed `uuid`, and a random UUID is itself the no-mapping-table guarantee (there is nothing — no salt, no hash input, no row — from which the original could be derived; it is strictly stronger than a destroyed-salt hash because there is no salt that could be accidentally persisted). A salted-hash or any non-UUID surrogate is **NOT permitted in V1.0** because the retained columns are typed `uuid` and a hash would require either a lossy cast or a schema change; it is a V1.1-only option *and only if* the schema adds a separate `text` surrogate column (noted in §16.6). Forbidden in all versions: any table, column, log, or artifact that maps surrogate → original `student_id` (that would be pseudonymization — still personal data — not anonymization, and would make the "retained for modeling" claim a compliance liability, §2.5).

The Layer-2 anonymization therefore is (RB-05D-V1-07 — the surrogate MUST be computed ONCE per deleted student and reused; a bare `SET student_id = gen_random_uuid()` would generate a different UUID *per row* and destroy the per-student trajectory continuity §10.2/§10.3 require):

\-- Computed ONCE per deleted student, before any Layer-2 UPDATE.  
v\_surrogate uuid := gen\_random\_uuid();

\-- Then, for the canonical event tables and BOTH audit tables, in the  
\-- same transaction, the identical surrogate:  
UPDATE \<layer2\_table\>  
   SET student\_id \= v\_surrogate            \-- NOT gen\_random\_uuid() inline  
       /\* , identifying free-text columns NULLed/dropped \*/  
 WHERE student\_id \= p\_deleted\_student\_id;

One `v_surrogate` per deleted student, reused across the canonical event rows and both audit tables in the same transaction, so the deleted student maps to one consistent surrogate across the retained modeling tuple (preserving per-student trajectory shape for modeling without identity). Generating the UUID inside the `SET` would emit a distinct value per row and is explicitly forbidden.

A CI guard `no_reverse_anonymization_map` statically asserts no schema object stores both a surrogate and a real `student_id` in a way that re-links them. The §13 cascade fixture asserts that after deletion, no query can recover the original `student_id` from the retained event/audit rows.

### **10.4 Privacy/compliance gate (production enablement)**

The engineering contract here (irreversible, one-way, minimal tuple, no mapping table) makes anonymized retention *technically* sound. It does NOT adjudicate whether retaining anonymized minor-derived learning data for model training is permissible under the regimes Lyceon operates in (US minor-facing SAT product: COPPA, state student-privacy laws such as SOPIPA, and GDPR/CCPA where applicable may treat de-identified minor data differently). Per the precedent set by the tutor-runtime contract ("this document does not itself settle legal compliance questions; privacy/compliance docs must define the final workflow"):

The Layer-2 anonymized-retention path MUST NOT be enabled in production until privacy/compliance has explicitly confirmed, in a privacy/compliance-owned document, that one-way-anonymized retention of this tuple from minor users is permissible for the intended modeling use. Until that confirmation, the implementation MUST treat Layer 2 as **hard-delete the event/audit rows too** (the privacy-conservative fallback), not retain-anonymized.

This gate is a `BLOCKING_PRIVACY_GAP` recorded in §11 and §14. The spec is locked either way; which Layer-2 behavior deploys depends on the privacy/compliance decision. The fallback (hard-delete everything) is always safe to ship; the anonymized-retention path ships only after sign-off.

### **10.5 Idempotency & failure**

The cascade is idempotent: re-running it for an already-deleted student is a no-op (Layer-1 deletes match zero rows; Layer-2 finds no rows with the original `student_id` because they were already anonymized). If the transaction fails partway, it rolls back entirely — there is no partial deletion and no partial anonymization (the "same transaction" guarantee, §10.2). The deletion request remains in soft-delete state and the cascade is retried.

---

## **11\. Pre-Implementation Verification Gate**

Mirrors 05B §11 / 05C §11. Before any 05D SQL or migration is written, the implementing engineer/agent MUST verify each item against the live database and post `pre_impl_verification_05d.md` with exact `\d` / `\df` / `\dp` output. Any deviation blocks implementation until reconciled.

### **11.1 What MUST be verified**

**A. 05D-owned objects do not pre-exist (or reconcile column-by-column if they do):** `public.mastery_event_audit_log` (§4.1), `public.mastery_domain_refresh_audit_log` (§4.2), `public.mastery_constants_change_log` (§5.2), `public.capture_mastery_constant_change` \+ trigger `trg_capture_mastery_constant_change` (§6.1, must be `ENABLE ALWAYS`), `public.constant_affects_formula_hash` (§6.3), `public.canonicalize_active_mastery_constants_state` (§6.6), `public.backfill_recompute_student` (§7.2). **`pgcrypto` extension MUST be present** (RB-05D-V1-11): the §6.1 trigger and §6.6 helper use `digest(...)`. Verify `CREATE EXTENSION IF NOT EXISTS pgcrypto;` is in the 05D migration or that `pgcrypto` is already installed (`SELECT 1 FROM pg_extension WHERE extname='pgcrypto'`); a missing extension makes the migration fail at trigger-function creation. The admin SELECT RLS policies (§4.6, §5.2 — RB-05D-V1-08) MUST exist for all three internal tables; a `GRANT SELECT` without a matching policy returns zero rows under enabled RLS.

**B. Sibling RPCs the backfill invokes (read-only dependency; 05D never reimplements):** `public.compute_mastery_for_entity` (05A), `public.refresh_domain_mastery` (05B), `public.refresh_section_kpi` / `refresh_overall_kpi` (05B), `public.compute_section_projection` (05C), `public.canonicalize_mastery_constants` (05A), `public.canonicalize_mastery_constants_serialized` (05A), a per-student canonical-event accessor (`canonical_mastery_events_for_student` or the locked equivalent — reconcile the exact name, RB-05B-V1-07 cross-doc-seam discipline).

**C. Two-table contract verification (§4.0):** confirm `mastery_event_audit_log` exists with the EXACT 05A §4.8 column set AND the `(event_source_kind, event_id)` UNIQUE constraint `mastery_event_audit_log_dedup_uq` (INV-05A-10 is load-bearing on it — its absence is `BLOCKING_05A_CONTRACT_GAP`). Confirm `mastery_domain_refresh_audit_log` exists with 05B §4.8's `triggered_by` enum \+ `last_event_*` \+ before/after columns. The two tables MUST NOT be unified (would break 05A idempotency / 05B's locked separation).

**D. The 05A/05B audit write call sites:** confirm 05A's `apply_mastery_event` inserts into `mastery_event_audit_log` (the locked §4.8 20-column insert) and 05B's `refresh_domain_mastery` inserts into `mastery_domain_refresh_audit_log`, each blocking, each in the canonical upsert transaction. If absent, `BLOCKING_UPSTREAM_GAP — sibling audit write missing`.

**E. RLS / GRANTs:** `mastery_event_audit_log`, `mastery_domain_refresh_audit_log`, and `mastery_constants_change_log` have NO `authenticated` policy and NO UPDATE/DELETE policy except the §10 cascade path; both granted SELECT to `admin_role`, ALL to `service_role`.

**F. The formula/operational key boundary:** `constant_affects_formula_hash`'s operational list is exactly the complement of the keys `canonicalize_mastery_constants_serialized()` (05A) serializes. CI guard `operational_key_set_matches_formula_hash_complement`.

**G. Cascade target inventory:** confirm the 10 derived tables in §10.2 Layer 1 exist with the FK relationships the canonical order assumes, and the canonical event sources \+ both audit tables (`mastery_event_audit_log`, `mastery_domain_refresh_audit_log`) for Layer 2\. A missing/renamed table is a `BLOCKING_UPSTREAM_GAP`.

**H. 04B→05C seam (§12):** the two items from 05C, governed here. Status `BLOCKING_UPSTREAM_GAP` until 04B satisfies them (§12.3). 05D may lock as spec; the sweep/outbox consumer (§9) and the projection deploy stay gated.

**I. Privacy/compliance gate (§10.4):** `BLOCKING_PRIVACY_GAP` until privacy/compliance confirms Layer-2 anonymized retention for minor data; until then Layer 2 \= hard-delete fallback.

**J. CI guards present and passing:** `no_constants_change_recompute_path` (INV-05D-13), `operational_key_set_matches_formula_hash_complement` (§6.3), `classifier_is_closed_world` (RB-05D-V1-03 — `constant_affects_formula_hash` raises on unknown keys), `constants_state_hash_single_serializer` (RB-05D-V1-02 — trigger and reconciliation use the one §6.6 helper), `no_reverse_anonymization_map` (INV-05D-16), `surrogate_is_uuid_only` (RB-05D-V1-05 — Layer-2 surrogate is `gen_random_uuid()`, no non-UUID path), `audit_log_append_only_except_cascade` (INV-05D-15 with the §10.4 fallback exception), `capture_trigger_is_enable_always` (INV-05D-14), `backfill_calls_recompute_skill_mastery` (RB-05D-V1-A — skill step calls 05A's locked recompute RPC, not the pure inner function).

**K. The 05A formula-key-registry reconciliation (RB-05D-V1-03):** `constant_affects_formula_hash`'s `v_formula` array MUST equal, byte-for-byte, the key set 05A's `canonicalize_mastery_constants_serialized()` serializes (05A §9.3). `BLOCKING_UPSTREAM_GAP — 05A formula key set unreconciled` until confirmed.

**L. 05A recompute RPC signature (RB-05D-V1-A):** confirm `public.recompute_skill_mastery` exists with the entity-filter signature §7.2 calls; reconcile the exact parameter shape against 05A §5's locked signature. `BLOCKING_UPSTREAM_GAP` if absent or mismatched.

**M. Outbox-consumer failure contract (RB-05D-V1-D):** the consumer implementation MUST demonstrate `FOR UPDATE SKIP LOCKED` claim, all-or-nothing `processed_at` (set only after both M/RW refreshes \+ counter reset), and the dead-letter-after-N path before the §9 schedule deploys.

**N. `projection_refresh_outbox` table shape (RB-05D-V1-10 — gate against 05C):** §9.2's dead-letter/retry contract requires the 05C-owned `projection_refresh_outbox` table to expose: `attempt_count` (or equivalent retry counter), a terminal `status`/`failed` marker (distinct from `processed_at`), `processed_at`, and the columns needed for `FOR UPDATE SKIP LOCKED` draining. 05C §7.7 V1.0 specified the table with `student_id`, `reason`, `requested_at`, `processed_at` — it does **NOT** yet include `attempt_count` or a terminal `failed` state. This is recorded as `BLOCKING_05C_CONTRACT_GAP — projection_refresh_outbox missing attempt_count/failed-state`: the §9.2 dead-letter behavior is the locked 05D contract, but it cannot deploy until the 05C-owned table carries these columns. Because 05C is locked, this is a 05C deploy-time additive-column reconciliation (not a 05C rewrite — adding nullable bookkeeping columns to an append-only outbox is additive and within 05C §16.3 post-lock additive-clarification scope); the gate is recorded here and surfaced in §16.5 standing gates. Until reconciled, the §9 outbox consumer deploys in a degraded mode: at-least-once retry without the bounded dead-letter terminal state (a stuck row retries indefinitely with ops alerting on age, rather than transitioning to `failed`).

### **11.2 Migration paths**

| Scenario | Action |
| ----- | ----- |
| Greenfield (no events, no derived rows) | Apply 05D migrations (audit log, change log, trigger, RPCs, schedules). Nothing to backfill. |
| Legacy (events exist, some/all derived rows missing) | Apply 05D migrations; run §7.3 bounded backfill batch. Verify with §8 harness on a sample. |
| Legacy (one audit table exists, other missing) | Create the missing locked table per §4.1/§4.2; do NOT unify. If a prior migration unified them, split per the locked 05A/05B contracts (documented, not silent). |
| Constants already drifted (live hash ≠ any change-log row, or no change log) | Seed an initial change-log baseline row (op='INSERT'-equivalent baseline) capturing current state; reconciliation green from that point. Document the baseline as a one-time governance event. |

---

## **12\. The 04B → 05C Seam Contract (Governed Here, No 04B Rewrite)**

### **12.1 Why this lives in 05D**

Per Q7=a. 05C raised two `BLOCKING_UPSTREAM_GAP` items against Doc 04B (locked V4.3). 05D is the family's cross-doc-seam owner (§2.6), so the obligation is recorded in exactly one governed place rather than scattered. Documenting a contract 04B must satisfy is not rewriting 04B; Doc 04B V4.3 is unchanged.

### **12.2 Seam item 1 — canonical completed-full-length section-score read surface**

04B MUST expose a stable read surface (view or table) that 05C's `compute_section_projection` §5.7 consumes, with at minimum:

student\_id            uuid  
section               text   ('M' | 'RW')  
section\_scaled\_score  integer (200..800)  
is\_complete           boolean  
completed\_at          timestamptz  
id                    (stable unique id for ordering tiebreak)

Locked semantics 04B must guarantee: `is_complete = true` IFF both modules of that full-length section were submitted and scored (an abandoned/partial full-length never appears as `is_complete = true`, so 05C's "completed full-lengths only" blend is correct by construction). The exact object name is 04B's to choose; 05C currently references the placeholder `full_length_section_scores`. When 04B names it, the §11.B reconciliation records the real name and 05C's §5.7 binds to it.

### **12.3 Seam item 2 — projection-refresh outbox insert**

04B's full-length-finalization transaction MUST insert one row into `public.projection_refresh_outbox` (05C §7.7-owned table):

projection\_refresh\_outbox(student\_id, reason \= 'full\_length\_completed')

in the SAME transaction that finalizes the full-length section score, so the outbox event commits atomically with the score and the 05D-owned consumer (§9) refreshes the projection immediately. 04B owns only this insert obligation; 05C owns the table; 05D owns the consumer schedule.

### **12.4 Status**

Both items are `BLOCKING_UPSTREAM_GAP`. 05D and the rest of the family lock as spec. The following stay gated until 04B satisfies both: the §9 outbox-consumer schedule (no outbox rows arrive until 04B inserts them), the immediate post-test projection refresh, and 05C's `compute_section_projection` production deploy (already gated in 05C). No 05-family document is rewritten when 04B resolves these; only the §11.B name reconciliation and the gate clearance are recorded.

---

## **13\. Stress-Test Fixture**

All scenarios run inside a transaction, seed canonical inputs, exercise the 05D-owned object, assert, then ROLLBACK. Fixed `T_now` for determinism (05B/05C precedent).

### **13.1 Audit log scenarios**

| ID | Setup | Asserts |
| ----- | ----- | ----- |
| D1 | 05A `apply_mastery_event` for one `(s,sec,dom,skl)` | exactly one `mastery_event_audit_log` row with the 05A §4.8 columns; a duplicate `(event_source_kind,event_id)` re-submit hits `mastery_event_audit_log_dedup_uq` and is handled as idempotent re-entry (INV-05A-10) |
| D2 | 05B `refresh_domain_mastery` for one `(s,sec,dom)` | exactly one `mastery_domain_refresh_audit_log` row, `triggered_by='event'`, before/after captured |
| D3 | attempt `UPDATE`/`DELETE` on an audit row as `authenticated` and as `admin_role` | denied (no policy / SELECT-only) — INV-05D-15 |
| D4 | projection refresh fires (05C) | ZERO rows in either audit table (projections excluded, §4.5); the row lives in `student_section_projection_snapshots` instead |

### **13.2 Constants governance scenarios**

| ID | Setup | Asserts |
| ----- | ----- | ----- |
| D5 | `UPDATE mastery_constants` (formula key) via normal path | one `mastery_constants_change_log` row, `op='UPDATE'`, `affects_formula_hash=true`, `resulting_state_hash` advanced, actor/txid populated |
| D6 | `UPDATE mastery_constants` (operational key, e.g. `PROJECTION_MIN_DELTA`) | change-log row `affects_formula_hash=false` |
| D7 | formula constant changed; NO recompute invoked; existing student rows re-read | every existing `constants_snapshot_hash`/`projection_constants_hash` UNCHANGED (INV-05D-13 / §2.2 / §8.4 proof) |
| D8 | after D7, drive one new event for the student | only the rows that event touched advance to the new hash; untouched rows still old hash |
| D9 | disable `trg_capture_mastery_constant_change`, direct `UPDATE`, run §6.5 reconciliation | reconciliation raises `CONSTANTS_DRIFT_DETECTED` (INV-05D-14) |
| D10 | migration-mode write (`session_replication_role='replica'`) to a constant | change-log row STILL written (trigger is `ENABLE ALWAYS`) — INV-05D-14 |

### **13.3 Backfill recompute scenarios**

| ID | Setup | Asserts |
| ----- | ----- | ----- |
| D11 | student with canonical events, zero derived rows; run `backfill_recompute_student` | skill→domain→KPI→projection all created; audit rows `triggered_by='backfill_recompute'`; projection self-gates NULL if \<8 domains |
| D12 | run D11 twice | second run is a no-op for skill/domain (NOT EXISTS now false); KPI/projection deterministic-identical (idempotent, §7.5) |
| D13 | determinism: backfill, snapshot rows+hashes, delete, re-backfill | byte-identical incl. all hashes (INV-05D-P4 / §8.2) |
| D14 | student with domain rows already present but missing KPI rows | backfill creates missing KPI/projection only; existing domain rows untouched (their hashes unchanged) |
| D15 | ordering: instrument call order in `backfill_recompute_student` | skill calls precede domain calls precede KPI precede projection (INV-05D-17 / §7.4) |

### **13.4 Cascade & anonymization scenarios**

| ID | Setup | Asserts |
| ----- | ----- | ----- |
| D16 | full derived-row set \+ events \+ audit rows for student; run cascade | all 10 Layer-1 tables have zero rows for the student; Layer-2 event/audit rows have surrogate `student_id`, original not recoverable |
| D17 | post-cascade, attempt to recover original `student_id` from retained rows by any join | impossible — no mapping object exists (INV-05D-16 / `no_reverse_anonymization_map`) |
| D18 | cascade transaction forced to fail at Layer 2 | full rollback: Layer-1 rows still present, no partial anonymization (§10.5) |
| D19 | re-run cascade for already-deleted student | no-op, no error (idempotent, §10.5) |
| D20 | privacy gate OFF (fallback mode) | Layer 2 hard-deletes event/audit rows instead of anonymizing (§10.4 conservative fallback) |
| D21 | audit row anonymized, never deleted (gate ON) | rows in BOTH audit tables still exist with surrogate id; row counts unchanged, `student_id` changed (INV-05D-15 \+ §10.2) |

### **13.5 Runner expectations**

* D7/D8 are the executable proof of the family's load-bearing simplification (no constants-change recompute). They MUST be in CI.  
* D9/D10 prove the trigger cannot be silently bypassed (the reviewer's recurring "silent drift" concern, RB-05B-V1-02 lineage).  
* D16/D17 prove one-way anonymization; D20 proves the privacy-conservative fallback ships safely.  
* All scenarios assert via the §8 harness where determinism is involved.

---

## **14\. Family Closure Table (Every "05D owns X" Resolved)**

This is the capstone's defining section (INV-05D-18). Every forward-reference in Parent/05A/05B/05C that defers to 05D is enumerated with the resolving anchor. The end-to-end audit's family-closure sweep checks this table against the locked sibling docs; an unresolved deferral is a release blocker.

| Deferred by | Deferral (verbatim intent) | Resolved in 05D |
| ----- | ----- | ----- |
| 05B §4 | `mastery_domain_refresh_audit_log` table \+ domain-refresh audit write | §4.2 — defined exactly as 05B contracted (NOT unified; §4.0 records why Q1=c was superseded) |
| 05A (RB-05A-V1-20) | `mastery_event_audit_log` \+ `(event_source_kind,event_id)` UNIQUE enforcing INV-05A-10 | §4.1 — defined exactly as 05A contracted incl. the load-bearing dedup constraint; §4.4 (per-event log IS the skill audit trail) |
| 05B / 05C §11.2 | "legacy: events exist, derived rows don't" backfill recompute | §7 `backfill_recompute_student` \+ §7.3 bounded batch |
| 05C §7.6 / §8.4 | daily projection-refresh sweep schedule | §9.1 daily sweep (05D owns schedule, 05C owns contract) |
| 05C §7.7 / §8.3 | `projection_refresh_outbox` consumer schedule | §9.1 outbox consumer (05D owns schedule) |
| 05C §9.4 / 05B (constants) | constant-change → recompute orchestration | RESOLVED BY ELIMINATION: INV-05D-13 — no constants-change recompute exists; §2.2 future-only model; §6.4 no `recompute_status` |
| 05C §16 / 05B | `mastery_constants` governance lifecycle (who may write, change-log) | §5 write-governance \+ §5.2 change log \+ §6 capture trigger \+ §6.5 reconciliation |
| Parent §11.1 | account-deletion cascade definition (all 05A/05B/05C tables) | §10 cascade ordering \+ §10.2 two-layer \+ §10.3 irreversibility |
| 05C §7.6 / §10.1 | "snapshot table is the audit trail; 05D references it read-only" | §4.5 — projections excluded from both audit tables; 05C snapshots remain canonical projection audit |
| 05B/05C | constants\_snapshot\_hash / projection\_constants\_hash vintage governance | §2.2 \+ INV-05D-A2 — hashes are the vintage record; never restamped outside backfill |
| 05C §11 (\#10/\#11 review) | 04B completed-full-length read surface \+ outbox-insert obligation | §12 seam contract (governed, no 04B rewrite) |
| 05C §9.4 (locked) | "a `PROJECTION_DOMAIN_WEIGHTS` change → 05D's recompute orchestration re-runs `compute_section_projection` for all affected students" | RECONCILED, NOT contradicted: 05C §9.4 was written before the no-recompute simplification (Q2-revised) was locked in the 05D session. INV-05D-13 supersedes it: a weights change is future-only (§2.2); existing projection rows keep their `projection_constants_hash` and migrate when the student next refreshes through the normal throttle. 05C §9.4's "05D re-runs" expectation is explicitly downgraded to "05D does NOT re-run; rows migrate naturally." This is a deliberate, documented supersession of a locked-sibling sentence by a later-locked family decision, surfaced by the capstone audit — not a silent contradiction. |
| 05C §11.2 ("run a 05D one-off backfill calling compute\_section\_projection for every student past Q4 gate") | the legacy-migration backfill | §7 `backfill_recompute_student` — this IS a never-computed backfill (rows don't exist yet), fully consistent with INV-05D-17; distinct from the §9.4 constants-change case which is eliminated |
| 05C | recompute-verification / determinism proof across the family | §8 harness (backfill \+ general determinism \+ no-recompute proof) |

Fourteen deferrals; fourteen resolutions (twelve direct \+ the two cross-doc reconciliations the capstone audit surfaced: the 05C §9.4 weight-recompute supersession and the 05C §11.2 backfill mapping). No "05D owns X" or "05D re-runs" reference in any locked sibling lacks an anchor or an explicit documented supersession here. The audit sweep (§17 process) re-derives this table from the sibling docs independently and diffs.

---

## **15\. Acceptance Criteria**

Doc 05D V1.0 is acceptable when all of the following hold:

1. Two locked append-only audit tables are defined exactly as the siblings contracted: `mastery_event_audit_log` (§4.1, 05A, with the `(event_source_kind,event_id)` UNIQUE enforcing INV-05A-10) and `mastery_domain_refresh_audit_log` (§4.2, 05B); they are NOT unified (§4.0 records why Q1=c was superseded by locked siblings); projections excluded from both (§4.5); no 05A/05B rewrite.  
2. The audit log is append-only with no `authenticated` policy and no UPDATE/DELETE except the §10 cascade (INV-05D-15); both 05A and 05B write blocking audit rows in their canonical upsert transactions.  
3. There is NO recompute trigger anywhere (INV-05D-13); a `mastery_constants` change affects future computes only (§2.2); the change log has no `recompute_status` (§6.4); D7/D8 prove existing hashes are unchanged by a constant change.  
4. `mastery_constants_change_log` (§5.2) captures every change with op/old/new/`affects_formula_hash`/actor/txid/`resulting_state_hash`; `affects_formula_hash` is informational only.  
5. The capture trigger (§6.1) is `AFTER ... FOR EACH ROW` and `ENABLE ALWAYS` (fires even under `session_replication_role='replica'` — logical-replication apply or a privileged replica-mode script; normal `origin` migrations already fire a plain `ENABLE`, RB-05D-V1-01); it performs no recompute (§6.2); D10 proves replica-mode capture.  
6. The §6.5 reconciliation job detects any trigger bypass via live-vs-logged state-hash mismatch and raises `CONSTANTS_DRIFT_DETECTED` (INV-05D-14, D9).  
7. `constant_affects_formula_hash` (§6.3) is exactly the complement of the formula-hash key set; the CI guard `operational_key_set_matches_formula_hash_complement` enforces it (INV-05D-A3).  
8. `backfill_recompute_student` (§7.2) is the ONLY recompute; student selection is never-computed/incomplete-derived only (never constants-driven); skill/domain rows created only when missing, KPI/projection refreshed as terminal surfaces (RB-05D-V1-04); strict skill→domain→KPI→projection order; skill step calls 05A's locked `recompute_skill_mastery` not the pure inner function (RB-05D-V1-A); one transaction per student, idempotent, every step a sibling RPC (INV-05D-A1/17); §7.3 bounds the batch.  
9. The §8 harness proves determinism (byte-identical re-backfill incl. hashes), ordering, and the no-constants-recompute property (§8.4); it runs in CI.  
10. The §10 cascade hard-deletes all 10 identity-linked derived tables in FK-safe order and, in the SAME transaction (Q5=b), processes the event/audit layer per the active privacy mode: anonymized-retention mode UPDATEs `student_id` to the locked UUID surrogate with no deletes (INV-05D-15 append-only holds); privacy-conservative fallback mode hard-deletes the Layer-2 rows. Irreversibility is by construction with no reverse-mapping object (INV-05D-16). Both modes are exercised (D21 retention, D20 fallback) — RB-05D-V1-06.  
11. The §10.4 privacy/compliance gate blocks production anonymized-retention until sign-off; the conservative fallback (hard-delete event/audit too) always ships safely; `BLOCKING_PRIVACY_GAP` recorded.  
12. The §12 04B seam contract governs both `BLOCKING_UPSTREAM_GAP` items in one place without rewriting Doc 04B V4.3; §12.4 enumerates exactly what stays gated.  
13. The §9 schedules (daily sweep, outbox consumer, reconciliation, backfill driver) are 05D-owned with 05C-owned contracts; all idempotent / at-least-once; none performs a constants-change recompute (§9.3).  
14. The §14 family-closure table resolves every "05D owns X" deferral with an anchor; the audit re-derives it independently and diffs (INV-05D-18).  
15. The §11 verification gate covers 05D objects, sibling RPCs, the name reconciliation, audit call sites, RLS/GRANTs, the key-boundary, cascade inventory, the 04B seam, the privacy gate, and all CI guards.  
16. The §13 fixture covers audit (D1-D4), constants governance incl. bypass \+ migration-mode (D5-D10), backfill incl. determinism \+ ordering \+ idempotency (D11-D15), and cascade incl. irreversibility \+ fallback \+ rollback (D16-D21).  
17. INV-05D-13..18 each have a stated enforcement mechanism (trigger, CI guard, RLS absence, harness, or fixture).  
18. No item in Doc 05D contradicts Doc 05 Parent V1.0, 05A V1.0, 05B V1.0, 05C V1.0, or Doc 04B V4.3 (verified by the end-to-end cross-doc audit sweep, §17 process).

---

## **16\. Governance & Lock Process**

### **16.1 Owner**

Product \+ Engineering joint ownership; Engineering maintains runtime/schema alignment; Privacy/Compliance owns the §10.4 gate decision.

### **16.2 Review trigger**

Review when: any sibling adds a new "05D owns X" deferral; the deletion/retention contract changes; the formula/operational key boundary changes; a new derived table is added to any sibling (cascade inventory grows); 04B resolves either seam item; the privacy/compliance gate decision is made.

### **16.3 Lock meaning**

"Locked" \= authoritative for implementation; changes require explicit doc update; silent drift not allowed. Post-lock additive clarification allowed; behavior-changing change requires explicit review \+ a grep-traceable `RB-05D-V1-NN` register entry, status stays "Locked", no version bump (Doc 04/05 family precedent).

### **16.4 Dependency**

Depends on Parent V1.0 (RB-05P-V1-01..15), 05A V1.0 (RB-05A-V1-01..23), 05B V1.0 (RB-05B-V1-01..08), 05C V1.0 (RB-05C-V1-01..08), Doc 04B V4.3. 05D is the terminal sub-doc; nothing in the 05 family defers past it.

### **16.5 Standing gates (lock-vs-deploy)**

05D locks as a complete spec now. Deploy-time gates that remain: the two §12 04B seam items (`BLOCKING_UPSTREAM_GAP`); the §10.4 privacy/compliance decision (`BLOCKING_PRIVACY_GAP`); the §11.K/L 05A-alignment reconciliations (formula-key registry parity, `recompute_skill_mastery` signature); and the §11.N `projection_refresh_outbox` shape reconciliation (`BLOCKING_05C_CONTRACT_GAP` — the 05C-owned table needs additive `attempt_count` \+ terminal `failed`\-state columns before the §9.2 bounded dead-letter path deploys; degraded at-least-once-with-age-alerting mode ships meanwhile). None blocks the *spec* lock; all gate specific *deploy* paths, each explicitly enumerated (§12.4, §10.4, §11.K/L/N).

### **16.6 Noted V1.1 considerations (NOT enforced in V1.0)**

* Volume-driven partition/retention policy for `mastery_event_audit_log` and `mastery_domain_refresh_audit_log` (currently retained indefinitely except §10 anonymization).  
* A formally governed RPC write path for `mastery_constants` if dashboard-direct-edit governance proves insufficient in practice (V1.0 uses trigger+reconciliation per Q2=b).  
* Backfill batch parallelism (V1.0 is sequential per-student bounded batch).  
* `mastery_constants_change_log` retention/partition at scale.  
* Non-UUID (e.g. salted-hash) anonymization surrogate — V1.1 only, and only if the schema adds a separate `text` surrogate column; V1.0 is locked to `gen_random_uuid()` into the existing `uuid` columns (RB-05D-V1-05).

### **16.7 Cleanup register (in-lock-cycle, no version bump)**

Per Doc 04/05 family precedent, SWE-review cleanup is applied within the lock cycle with grep-traceable tags; status reflects the register; no version bump.

| Tag | Severity | Source | Resolution |
| ----- | ----- | ----- | ----- |
| RB-05D-V1-01 | BLOCKER | SWE review (ENABLE ALWAYS overclaims migration coverage) | §6.1 \+ §6.5 comments \+ acceptance \#5 softened: `ENABLE ALWAYS` closes the *replica-mode* bypass (logical-replication apply / privileged replica-mode script); normal `origin` migrations already fire a plain `ENABLE`. Invariant unchanged; justification corrected. |
| RB-05D-V1-02 | BLOCKER | SWE review (constants hash not canonical for object constants) | Added §6.6 `canonicalize_active_mastery_constants_state()` (sorted keys, deterministic object serialization, fixed numeric format). Trigger §6.1 and reconciliation §6.5 now both hash this single helper; inline `#>> '{}'` removed. CI guard `constants_state_hash_single_serializer`. |
| RB-05D-V1-03 | BLOCKER | SWE review (classifier silently treats unknown keys as formula) | §6.3 rewritten closed-world: known formula → true, known operational → false, else `RAISE CONSTANT_KEY_UNKNOWN`. Explicit formula registry (mirrors 05A's locked set, reconciled §11.K). CI guards `classifier_is_closed_world` \+ `operational_key_set_matches_formula_hash_complement`. |
| RB-05D-V1-04 | BLOCKER | SWE review (backfill "never-computed only" vs unconditional KPI/projection) | §7.2/§7.4/§7.5 \+ INV-05D-17 restated precisely: skill/domain rows created only when missing; KPI/projection are *terminal materialized surfaces* refreshed deterministically within the selected student's txn; student selection is never-computed-only. No contradiction. |
| RB-05D-V1-05 | BLOCKER | SWE review (surrogate vs `uuid NOT NULL` column type) | §10.3/§10.2 lock V1.0 surrogate to `gen_random_uuid()` into the existing `uuid` columns (type-safe; stronger than destroyed-salt). Salted-hash forbidden in V1.0; V1.1-only with a separate `text` column. CI guard `surrogate_is_uuid_only`. |
| RB-05D-V1-A | BLOCKER-equiv | SWE review (backfill calls pure `compute_mastery_for_entity`, not the writing RPC) | §7.2 skill step now calls 05A's LOCKED `recompute_skill_mastery` (05A §5, persists rows) — not the pure inner `compute_mastery_for_entity` and not event-time `apply_mastery_event`. INV-05D-A1/§1/acceptance \#8 aligned. §11.L signature reconcile. CI guard `backfill_calls_recompute_skill_mastery`. |
| RB-05D-V1-B | IMPORTANT | SWE review (INV-05D-15 vs privacy fallback) | INV-05D-15 scoped: never-delete holds in normal op \+ anonymized-retention; §10.4 fallback hard-deletes Layer-2 audit rows as the single documented exception. D20/D21 cover both modes. |
| RB-05D-V1-C | IMPORTANT | SWE review (change-log RLS/GRANTs unspecified) | §5.2 specifies RLS, REVOKE PUBLIC, ALL→service\_role, SELECT→admin\_role, no authenticated, append-only, and that the change log is NOT touched by the §10 cascade (no student identity in it). |
| RB-05D-V1-D | IMPORTANT | SWE review (schedules lack dead-letter/retry) | §9.2 adds the outbox-consumer failure contract: `FOR UPDATE SKIP LOCKED`, all-or-nothing `processed_at`, dead-letter after N \+ ops alert, no silent partial success. §11.M verification. |
| RB-05D-V1-06 | BLOCKER | SWE review R2 (§4.7/\#10 still "never DELETE" vs privacy fallback) | §4.7 and acceptance \#10 rewritten to three explicit modes (normal append-only / anonymized-retention UPDATE-surrogate / privacy fallback hard-delete), both cascade modes mandatory test paths (D20/D21). Reconciles the main body with the RB-B INV-05D-15 scoping. |
| RB-05D-V1-07 | BLOCKER | SWE review R2 (`SET student_id = gen_random_uuid()` is per-row) | §10.3 prose \+ §10.2 pseudocode now mandate `v_surrogate := gen_random_uuid()` computed ONCE per deleted student, reused across all Layer-2 UPDATEs (`WHERE student_id = p_deleted_student_id`). Per-row inline generation explicitly forbidden (would destroy trajectory continuity). |
| RB-05D-V1-08 | BLOCKER | SWE review R2 (GRANT SELECT ≠ RLS bypass) | Explicit `CREATE POLICY admin_select_* ... FOR SELECT TO admin_role USING (true)` added for all three internal tables (§4.6, §5.2). Preferred over relying on a BYPASSRLS role attribute (auditable, least-privilege). §11.A verifies the policies exist. |
| RB-05D-V1-09 | BLOCKER | SWE review R2 (reconciliation "most recent" ambiguous under tied changed\_at) | §6.5 now mandates `ORDER BY change_id DESC LIMIT 1` (the monotonic identity), explicitly NOT `changed_at` — a multi-row migration writes equal `changed_at`; the highest `change_id` is the true final post-migration checkpoint. Prevents false `CONSTANTS_DRIFT_DETECTED`. |
| RB-05D-V1-10 | IMPORTANT | SWE review R2 (§9.2 assumes outbox columns 05C doesn't have) | §11.N added: `projection_refresh_outbox` (05C-owned, locked at `outbox_id/student_id/reason/requested_at/processed_at`) lacks `attempt_count` \+ terminal `failed` state. Recorded `BLOCKING_05C_CONTRACT_GAP` — additive nullable columns within 05C §16.3 post-lock additive scope (not a 05C rewrite); degraded at-least-once-with-age-alert mode ships meanwhile. Surfaced in §16.5. |
| RB-05D-V1-11 | IMPORTANT | SWE review R2 (`pgcrypto` dependency implicit) | §11.A now requires `CREATE EXTENSION IF NOT EXISTS pgcrypto;` in the 05D migration or proof it is installed; `digest()` in §6.1/§6.6 fails the migration without it. |
| RB-05D-V1-12 | IMPORTANT | SWE review R2 (serializer NULL on empty active set) | §6.6 wrapped in `COALESCE(string_agg(...), '')` so an empty active-constants set hashes deterministically (the empty-string SHA-256) rather than `NULL`. |

All five R1 blockers \+ four R1 non-blocking \+ four R2 blockers \+ three R2 non-blocking applied within the lock cycle of 2026-05-14 (RB-05D-V1-01..12 \+ A/B/C/D). Standing `BLOCKING_*` reconciliations against *locked* siblings, surfaced by the fixes and recorded as deploy gates (not 05D defects, not spec-lock blockers): §11.K formula-key-registry parity \+ §11.L `recompute_skill_mastery` signature (05A); §11.N `projection_refresh_outbox` additive-column shape (05C).

---

## **17\. Change Record**

| Version | Date | Author | Summary |
| ----- | ----- | ----- | ----- |
| V1.0 | 2026-05-14 | Claude (drafted), Karl (locked pending review) | Initial draft of the Doc 05 family **capstone**. Locks: the two-table audit layer defined EXACTLY as the locked siblings contracted — `mastery_event_audit_log` (05A/RB-05A-V1-20, with the load-bearing `(event_source_kind,event_id)` UNIQUE enforcing INV-05A-10) and `mastery_domain_refresh_audit_log` (05B, deliberately separate per 05B's locked rationale); the capstone cross-doc audit found pre-draft Q1=c ("one unified log") contradicted these locked contracts and the locked siblings won (§4.0 supersedes Q1=c; only its "projections excluded" part stands, 05C snapshots remain the projection audit trail); no 05A/05B rewrite; the load-bearing simplification — **no recompute trigger anywhere** (INV-05D-13), `mastery_constants` changes affect future computes only (§2.2), existing rows keep their vintage hash and migrate naturally, change log has no `recompute_status` (§6.4); `mastery_constants_change_log` as a pure governance record with op/old/new/`affects_formula_hash`(informational)/actor/txid/`resulting_state_hash` (§5.2); capture-only `ENABLE ALWAYS` trigger that fires under `session_replication_role='replica'` and performs zero recompute (§6.1/§6.2) plus a periodic reconciliation hash-check raising `CONSTANTS_DRIFT_DETECTED` on any bypass (§6.5, INV-05D-14); `constant_affects_formula_hash` as the single governance-layer operational/formula boundary, the exact complement of 05A's formula-hash key set (§6.3, INV-05D-A3); `backfill_recompute_student` as the ONLY recompute — never-computed case only, strict skill→domain→KPI→projection order, one transaction per student, bounded batch, every step a sibling-owned RPC, idempotent (§7, INV-05D-17); a 05D-owned recompute-verification harness proving byte-identical determinism, ordering, and the no-constants-recompute property in CI (§8); the Parent §11.1 account-deletion cascade — FK-ordered hard-delete of all 10 identity-linked derived tables across 05A/05B/05C plus same-transaction one-way anonymization of the event/audit layer, irreversible by construction with a forbidden reverse-mapping object (§10, INV-05D-16), audit rows anonymized never deleted (INV-05D-15), privacy-conservative hard-delete fallback until the §10.4 `BLOCKING_PRIVACY_GAP` clears; the §9 schedules 05C depends on (daily sweep, outbox consumer, reconciliation, backfill driver) — 05D owns schedules, 05C owns contracts, all idempotent/at-least-once, none recomputes on constants change; the §12 04B→05C seam contract governed in one place without rewriting locked Doc 04B V4.3 (two `BLOCKING_UPSTREAM_GAP` items, §12.4 deploy-gate enumeration); the §14 family-closure table resolving all fourteen "05D owns X" deferrals (twelve direct \+ two cross-doc reconciliations the capstone audit surfaced) with anchors (INV-05D-18); §11 pre-implementation verification gate; §13 21-scenario stress fixture (D1–D21); 6 sub-doc invariants INV-05D-13..18 plus INV-05D-A1/A2/A3 and inherited Parent/05A/05B/05C invariants; 18 acceptance criteria. **Capstone end-to-end cross-doc audit findings folded in:** (a) §4 restructured from the incorrect Q1=c unified table to the two locked sibling tables after the audit found unification would break 05A's INV-05A-10 idempotency UNIQUE constraint and 05B's locked explicit-separation statement (§4.0); (b) the 05C §9.4 "05D recompute orchestration re-runs on weights change" sentence is explicitly reconciled in §14 as superseded by INV-05D-13 (future-only, no recompute) rather than left as a silent contradiction; (c) §14 closure tally corrected to fourteen. Spec locks complete; standing deploy gates: two 04B seam items \+ the privacy/compliance Layer-2 decision (§16.5). **In-lock-cycle SWE-review cleanup applied 2026-05-14 (RB-05D-V1-01..05 blockers \+ A/B/C/D; no version bump):** RB-01 ENABLE ALWAYS justification corrected to replica-mode-bypass (invariant unchanged); RB-02 single canonical `canonicalize_active_mastery_constants_state()` helper for the resulting-state hash, used by both trigger and reconciliation (was unstable `#>> '{}'` for object constants); RB-03 closed-world `constant_affects_formula_hash` raising `CONSTANT_KEY_UNKNOWN` with an explicit 05A-mirrored formula registry (was silent unknown→formula); RB-04 backfill semantics restated — skill/domain rows created-only-if-missing, KPI/projection are terminal materialized surfaces refreshed deterministically, student selection never-computed-only (no contradiction); RB-05 V1.0 anonymization surrogate locked to `gen_random_uuid()` into the existing `uuid` columns (salted-hash deferred to V1.1 w/ separate text column); RB-A backfill skill step calls 05A's locked `recompute_skill_mastery` not the pure inner `compute_mastery_for_entity`; RB-B INV-05D-15 scoped with the explicit §10.4 fallback hard-delete exception; RB-C `mastery_constants_change_log` RLS/GRANTs specified \+ change-log excluded from the §10 cascade; RB-D outbox-consumer dead-letter/retry contract (SKIP LOCKED, all-or-nothing processed\_at, dead-letter after N). Two new 05A-alignment `BLOCKING_UPSTREAM_GAP` reconciliations recorded (§11.K/L); not 05D defects, not spec-lock blockers. Status: Locked; deploy gated on the two 04B seam items \+ the privacy/compliance Layer-2 decision \+ the §11.K/L 05A reconciliations \+ the §11.N 05C outbox additive-column reconciliation. **Second SWE-review round applied 2026-05-14 (RB-05D-V1-06..12; no version bump):** RB-06 §4.7/\#10 rewritten to three explicit privacy modes (reconciles main body with the RB-B INV-05D-15 scoping); RB-07 anonymization mandates one `v_surrogate` per deleted student reused across all Layer-2 UPDATEs (per-row `gen_random_uuid()` forbidden); RB-08 explicit admin SELECT RLS policies on all three internal tables (GRANT alone does not bypass enabled RLS); RB-09 reconciliation selects the final checkpoint by `change_id DESC` not `changed_at` (prevents false drift on tied timestamps); RB-10 §11.N records the 05C `projection_refresh_outbox` missing `attempt_count`/`failed`\-state as a `BLOCKING_05C_CONTRACT_GAP` deploy gate with a degraded-mode fallback; RB-11 explicit `pgcrypto` migration check; RB-12 canonical serializer `COALESCE` for the empty-active-set case. |

---

*End of Doc 05D V1.0.*

---

 