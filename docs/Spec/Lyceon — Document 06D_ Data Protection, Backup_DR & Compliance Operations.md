# **Lyceon — Document 06D: Data Protection, Backup/DR & Compliance Operations**

**Version:** V1.0 **Status:** LOCKED 2026-05-21 (draft-for-lock cleanup round 1 applied in-lock-cycle, RB-06D-V1-01..12 per CR-06D-04; round 2 SWE cleanup applied in-lock-cycle, RB-06D-V1-13..18 per CR-06D-05; no version bump) **Lock scope note (RB-06D-V1-15):** 06D is **spec-locked** as of 2026-05-21. 06D alert-emitting mechanisms (`ALERT-DATA-01`, `ALERT-DATA-02`, and every 06D-owned alert tagged `source_class = doc06d_event` per §7.4 / §6.5 / §9.4 / §10.8 / §11.5 / §12.5) are **deploy-blocked until CR-06C-05 lands in 06C** — 06C-owner applies post-lock additive `RB-06C-V1-16` extending the alert-registry source\_class enum \+ adding 06D event rows to the severity-crosswalk and alert-registry registries. Spec-lock authorizes downstream consumers (06E, code-level work, validation contracts) to reference 06D's mechanisms by name; deploy-readiness requires CR-06C-05 closure. Tracked as W8 in §17 and as criterion \#18 in §18. **Last updated:** 2026-05-21 **Owners:** Founder / CTO review **Governed by:** Document 06 Parent V1.0 (LOCKED 2026-05-18) → Document 00 (Authoritative Platform Directive) **Depends on:** Doc 06 Parent V1.0; Doc 06A V1.0 (LOCKED 2026-05-18 \+ post-lock additives RB-06A-V1-11/12 per CR-06A-06; §8 prod-data-in-lower-env doctrine, §10 release-gate manifest, §11 migration recovery contract with `data_impact` enum, §15 backup infrastructure topology); Doc 06B V1.0 (LOCKED 2026-05-21 \+ RB-06B-V1-13; §8 privileged-op audit substrate consumed for deletion-action audit); Doc 06C V1.0 (LOCKED 2026-05-21 \+ RB-06C-V1-01..15 per CR-06C-04; §8 scheduled-job heartbeat substrate for restore-test \+ retention jobs, §10 incident lifecycle extended for privacy/data-breach sub-class, §6 severity crosswalk consumed); Doc 01A V1.0 (CANONICAL — §14 PII redaction rules, §19 log retention); Doc 01 V6.0 (CANONICAL at V6 for deletion lifecycle — §19 Account Deletion and Soft-Delete Lifecycle owns the 7-day grace, T+7 hard delete, `deidentify_user`, `account_deletion_requests`, guardian/admin-initiated paths; V8 §40.5 / §5.1 / §44 / Appendix E **bounded FWD-06-02** for the V8 retention/audit/support-access extensions); Doc 03 Main V1.1 (§14.2 Data Retention Matrix for LISA tables, §21.3 safety-review queue — referenced via project handoff record per §3.4); Doc 03C V3.0 (§28.7 privacy/anti-leak failure class consumed); Doc 05D V1.0 (§10 account-deletion cascade, §11 deletion-proof tests D20/D21, INV-05D-15 audit append-only mode — referenced via project handoff record per §3.5; sanctioned FWD-06-04). **Forward-references (bounded):** Doc 07 (FWD-06-01 — analytics retention surface; sanctioned single forward-ref across the 06 family); Doc 01 V8 (FWD-06-02 — retention/audit/support-access V8 extensions); Doc 05D body (FWD-06-04 — cite-path identical to FWD-06-03 / Doc 03 Main, source not in current tree). **Applies to:** platform-level RPO/RTO targets \+ restore-test acceptance target (with subsystem-stricter-target consumer pattern); backup/PITR/DR substrate-consumer wrapper; restore-test executable-proof; deletion executable-proof harness (INV-06-08 body); compliance-gate registry \+ evidence/approval/audit process feeding 06A `infra/release-gates.yaml` (INV-06-11 body); platform retention policy registry \+ enforcement; the anonymization standard (joint with 06A for INV-06-03); privacy/data-breach incident sub-class on 06C §10 lifecycle; audit-archival surface (partial-provable per FWD-06-02). **Explicitly excludes:** every primitive *body* owned by 01A §14 / §19 (referenced, never restated); Doc 01 V6 §19 deletion lifecycle body (referenced, never restated — 06D adds only the executable-proof wrapper); Doc 05D §10/§11 cascade body (referenced via FWD-06-04, never restated); Doc 03 Main §14.2 LISA retention matrix (referenced via §3.4 cite-path); Doc 06A §10 release-gate enforcement runtime \+ §11 `data_impact` enum (referenced, never restated); Doc 06C §8 heartbeat / §10 incident lifecycle bodies (consumed, never restated).

---

# **§1 — Purpose & Position in the Doc 06 Family**

06D is the data-protection-operations sub-document. It answers: *how does the platform prove every deletion completed, how does it prove every backup is recoverable to a measured target, how does it gate deploys on compliance evidence rather than aspiration, how does it ensure retention policies are honored across every PII surface, and how does it do all of this without restating Doc 01's deletion lifecycle, Doc 05D's cascade, Doc 03 Main's retention matrix, or 01A's redaction rules.*

06D owns the operational/proof wrapper for three Parent invariants outright (**INV-06-08** every irreversible deletion has executable proof; **INV-06-09** every backup has restore-test proof; **INV-06-11** compliance gates are deploy gates) and the anonymization-standard slice of one joint invariant (**INV-06-03** no production data in lower environments — 06A owns the scan body, 06D owns the anonymization standard the scan checks against). Per Parent §4 every capability statement names a proving mechanism with the §6.13 six-element implemented-definition; per Parent §5 every primitive body remains 01A / Doc 01 V6 / Doc 03 / Doc 05D / 06A / 06B / 06C canonical and is referenced, never restated.

---

# **§2 — Scope and Boundary**

## **2.1 06D owns**

The platform-level RPO/RTO targets and the restore-test acceptance target (§7 — Parent §3 explicit: 06D *must* define the platform target; subsystems may declare stricter in their own owning docs); the PITR/DR substrate-consumer wrapper (§7 — Supabase PITR is the V1 substrate, consumed not redefined); the `ops/restore-test` executable-proof body for INV-06-09, including the trigger-based-plus-monthly-minimum cadence per Q-06D-3=d (§8); the deletion executable-proof harness for INV-06-08, consuming Doc 05D §10 cascade and D20/D21 tests and adding the post-deletion verification job wrapper (§6); the platform retention policy registry (`infra/retention-policy-registry.yaml`) mapping every PII surface named in 01A §14, Doc 01 V6 §19, and Doc 03 Main §14.2 to a retention horizon \+ purge substrate \+ purge alert (§9); the retention enforcement mechanism (`ops/retention-policy-conformance`) that proves retention purges happen on schedule (§9); the **asynchronous** compliance-evidence process per Q-06D-2=b — `infra/compliance-gate-registry.yaml` \+ `docs/compliance-evidence/<gate-id>/<NN>.md` evidence artifacts \+ relational `compliance_gate_evidence` substrate \+ state-machine transition RPC — feeding 06A's `infra/release-gates.yaml` as registered compliance-gate entries (§10); the privacy/data-breach incident sub-class extension to 06C §10, including the compliance-evidence attachment requirement specific to privacy-class incidents (§11); the anonymization standard (`infra/anonymization-standard.yaml`) consumed by 06A's INV-06-03 scan body — 06D owns *what counts as anonymized*; 06A owns *the scan that enforces it* (§12); the audit-archival surface stub, partial-provable until Doc 01 V8 §5.1 lands per FWD-06-02 (§13).

## **2.2 06D explicitly does NOT own (Decision 5 — referenced, never restated)**

| Concern | Canonical owner (referenced by exact §) |
| ----- | ----- |
| PII redaction rules at write-time (logs, observability payloads) | 01A §14 |
| Log sinks and retention (Dev/Staging/Prod tiers) | 01A §19 |
| Account deletion lifecycle (7-day grace, T+7 hard delete, `deidentify_user`, `account_deletion_requests`, guardian/admin-initiated paths, recovery-within-grace path, recovery-after-T+7-impossible rule, COPPA guardian-initiated path) | Doc 01 V6 §19 — Account Deletion and Soft-Delete Lifecycle |
| Profile canonical writer (`profile-service.ts` → `markProfileForDeletion`, `finalizeDeletion`) | Doc 01 V6 — Profile Canonical Writer section |
| V8 user-deletion / V8 PII retention extension / V8 support-mediated audit | Doc 01 V8 §40.5 / §5.1 / §44 / Appendix E — **bounded FWD-06-02** |
| Mastery/projection deletion cascade (FK-ordered txn, 10 identity-linked derived tables, anonymized-retention vs hard-delete fallback per INV-05D-15) | Doc 05D §10 \+ §11 — referenced via project handoff record per §3.5 (FWD-06-04) |
| LISA Data Retention Matrix (10 LISA tables, retention/delete-triggers/recovery, 7-day soft-delete, 90/180/365-day archival crons) | Doc 03 Main §14.2 — referenced via project handoff record per §3.4 |
| LISA privacy/anti-leak failure class | Doc 03C §28.7 |
| Migration `data_impact` enum (`none / additive_only / transforms_data / deletes_data`) | Doc 06A §11.3 RB-06A-V1-06 |
| Release-gate manifest schema (`infra/release-gates.yaml` shape) and `ci/release-gates` enforcement runtime | Doc 06A §10 |
| Privileged-op audit substrate (for deletion-action audit visibility) | Doc 06B §8 |
| Scheduled-job heartbeat substrate (consumed by `ops/restore-test`, `ops/retention-policy-conformance`, `ops/deletion-proof-conformance`) | Doc 06C §8 |
| Incident lifecycle base table \+ transition RPC (`incidents`, `incident_phase_transitions`, `transition_incident_phase`) | Doc 06C §10 |
| `lower-env-data-provenance-scan` scan body (the actual probe that runs against lower environments) | Doc 06A §8 |
| Analytics retention surface | Doc 07 — sanctioned FORWARD\_REF (FWD-06-01) |
| §10.5 envelope schema (12 common fields \+ per-mechanism extras matrix) | Doc 06 Parent §10.5 / 06A §10.5.1 (extended in §14) |

## **2.3 03C boundary (inherited from 06A §2.2 / 06B §2.3 / 06C §2.3)**

Any LISA-tier observability or retention surface — every LISA table named in Doc 03 Main §14.2, every retention rule applied to LISA tutor conversations, every Doc 03C §28.7 privacy/anti-leak failure-class body — is **canonical to Doc 03 / Doc 03C** and referenced by exact §. 06D owns the *cross-tier wrapper* (the platform retention registry references the LISA tables by exact §; the deletion executable-proof harness references the LISA cascade rows by exact §) and does not state a LISA-tier retention horizon, a tutor-conversation purge cadence, or a Doc 03C §28.7 alert threshold. Restating any such body in 06D is a `DD-06-REDEF` defect.

## **2.4 Inheritance**

06D inherits Doc 00, Parent §11.3 (production-data canonical definition — DB rows, dumps, object storage, identifier-bearing logs/traces, analytics exports, backups, screenshots, model/RAG payloads; this is the scope 06A's INV-06-03 scan checks and 06D's anonymization standard targets), Parent §6.13 (named ≠ implemented), Parent §10.5 (Standard Proof Artifact Envelope), Parent §13 severity model (Page / Warn / Info \+ `operational_response_urgency`), Parent §14 (compliance-gates-are-deploy-gates doctrine — 06D owns the process behind, 06A owns the manifest enforcement), 06A §11.3 `data_impact` enum (consumed by §8 restore-test trigger), 06B §8.6 independent expected-source discipline (applied throughout 06D reconciliations — no self-comparison), 06C §6.0 registry-canonical principle (06D's registries are the canonical machine-readable sources, not the markdown rendering of them).

---

# **§3 — Threat Model (Operational)**

Operational threats this document addresses. 01A and Doc 01 V6 defend against the redaction and lifecycle-correctness threats at primitive layer; 05D defends against cascade incompleteness; 06D addresses the proof-and-process threats — the cases where the policy exists but no proof exists that it's being followed, or where compliance is treated as documentation rather than as a deploy control.

1. **Unverified deletion.** A user requests deletion; `account_deletion_requests` row is created; T+7 fires; `deidentify_user` runs; the 05D cascade runs. But nothing *proves* the deletion completed across all layers — identity layer might succeed while mastery cascade fails silently, leaving orphaned data. *Defense:* §6 deletion executable-proof harness — post-deletion verification job \+ signed deletion-proof manifest \+ `ops/deletion-proof-conformance` reconciliation.  
2. **Unverifiable backup.** The substrate (Supabase PITR) advertises continuous WAL archival. Nothing *proves* we can actually restore from those backups to a measured RPO/RTO target. *Defense:* §8 `ops/restore-test` with Q-06D-3=d trigger-based \+ monthly minimum cadence; signed restore-proof manifest with observed RPO/RTO; `ci/restore-test-recency` blocking gate.  
3. **Compliance as documentation.** A compliance gate (e.g. Doc 05D `BLOCKING_PRIVACY_GAP`) exists as a written rule but is not wired into deploy enforcement. The gate is satisfied by claim, not by evidence. *Defense:* §10 async compliance-evidence registry \+ `compliance_gate_evidence` relational state machine \+ 06A `infra/release-gates.yaml` entry that mechanically blocks deploys when the gate is unapproved (Parent §14 doctrine; INV-06-11 body).  
4. **Retention drift.** A PII surface exists in the platform (a column, a log file, a table) but no retention policy is attached to it. Data accumulates indefinitely; a GDPR/COPPA inquiry surfaces the gap. *Defense:* §9 `infra/retention-policy-registry.yaml` \+ `ci/retention-policy-registry-parity` (every PII surface in canonical sources is mapped) \+ `ops/retention-policy-conformance` (purges actually happen).  
5. **Anonymization theatre.** A lower-environment dataset is "anonymized" but the anonymization is reversible (e.g. hashed emails that map 1:1 back to identity, name fields with first-letter preserved). 06A's INV-06-03 scan reports green; the substrate is actually still PII-bearing. *Defense:* §12 `infra/anonymization-standard.yaml` defining per-field anonymization patterns \+ reversibility classification; 06A's scan checks against the standard 06D defines.  
6. **Privacy incident invisibility.** A data-exposure incident is treated as an ordinary infra incident; postmortem omits compliance-evidence linkage; regulator-notification obligations are missed. *Defense:* §11 privacy/data-breach incident sub-class on 06C §10 \+ relational `incident_privacy_class_attachments` substrate \+ the postmortem-must-include-compliance-evidence rule.  
7. **Audit-archival blind spot.** Audit logs accumulate without retention policy; old audit data persists past the regulatory window or is deleted before it should be. *Defense:* §13 audit-archival surface stub (partial-provable until Doc 01 V8 §5.1 lands per FWD-06-02).

Threats explicitly *not* addressed here:

* Cryptographic / authentication threats — 06B §3.  
* Per-primitive observability blind spots — 06C §3.  
* Migration data-impact misclassification — 06A §11.3.  
* LISA-specific privacy/anti-leak in-runtime detection — Doc 03C §28.7.  
* DDoS / volumetric attacks targeting backup substrate — Cloudflare WAF, out of 06D scope.

## **3.4 Doc 03 Main citation path (carried from 06C §3.4)**

Doc 03 Main V1.1 is not present in this session's source tree. Citations to §14.2 (Data Retention Matrix), §26.A (failure matrix referenced for crosswalk lookup), §21.3 (safety-review queue) are made per the project handoff record and Parent §13.2's established precedent. On Doc 03 Main upload, `ci/retention-policy-registry-parity` (§9) gains a parsed §14.2 table-of-LISA-tables as additional input; until then, cited section names are recorded in proof artifacts as `cited_per_project_handoff_record` (audit P3 pass reports the cite-path; never silently passes). Registered as W3 in §17 (non-blocking).

## **3.5 Doc 05D citation path (FWD-06-04 — new sanctioned cite-path)**

Doc 05D V1.0 (LOCKED 2026-05-14) is not present in this session's source tree but is the canonical owner of mastery/projection deletion cascade (§10) and the deletion-proof test harness (§11, including D20/D21 tests). 06D consumes 05D heavily for INV-06-08. Following the §3.4 precedent for Doc 03 Main, citations to Doc 05D §10 / §11 / INV-05D-15 (audit append-only per-mode rule) / `BLOCKING_PRIVACY_GAP` deploy gate are made per the project handoff record. On Doc 05D upload to the source tree, `ops/deletion-proof-conformance` (§6) gains a parsed §10 cascade table-row index as additional input. Registered as W4 in §17 — sanctioned **FWD-06-04**, non-blocking for spec-lock; consistent with the FWD-06-02 / FWD-06-03 patterns already in use across the 06 family.

---

# **§4 — Data Classification & Retention Model (Reference, Not Redefinition)**

06D does not define data classification or retention horizons. The classification and retention bodies live in canonical owners; 06D's registries map each PII surface to its canonical owner and its retention horizon as defined by that owner.

## **4.1 Canonical classification sources (referenced, body resides at the cited §)**

| Classification axis | Canonical owner | What 06D consumes from it |
| ----- | ----- | ----- |
| PII redaction tier (write-time, logs/observability) | 01A §14 (referenced) | The list of fields classified as PII; the redaction patterns; the retention extension from V8 §5.1 (bounded FWD-06-02) |
| Log sinks \+ retention windows (Dev/Staging/Prod tiers) | 01A §19 (referenced) | The Dev/Staging/Prod retention windows; the post-90-day cold archive policy; the PII-in-logs-transition-to-domain-only-after-90-days rule (referenced from V8 §5.1, FWD-06-02) |
| Account-deletion lifecycle (identity layer) | Doc 01 V6 §19 (referenced) | The 7-day grace, T+7 hard-delete, `deidentify_user` RPC, `account_deletion_requests` table, guardian/admin paths, recovery-within-grace and recovery-after-T+7-impossible rules |
| Mastery/projection deletion cascade | Doc 05D §10 (FWD-06-04) | The FK-ordered txn covering 10 identity-linked derived tables; the anonymized-retention vs privacy-conservative-hard-delete fallback per INV-05D-15 |
| LISA data retention matrix | Doc 03 Main §14.2 (FWD-06-04-parallel; §3.4) | The 10 LISA tables; per-table retention horizons; per-table delete-triggers; per-table recovery procedures; 7-day soft-delete; 90/180/365-day archival crons |
| LISA privacy/anti-leak failure class (operational signal) | Doc 03C §28.7 (referenced) | The alert-routing pattern for in-runtime privacy violations (06D references via 06C §6 crosswalk) |
| Analytics retention surface | Doc 07 — FWD-06-01 (bounded) | Pending; partial-provable until Doc 07 drafts |

## **4.2 06D's responsibility in the model**

06D does not classify data and does not set retention horizons. 06D's responsibilities are:

1. **Inventory completeness:** every PII surface named by a canonical owner above MUST appear as a row in `infra/retention-policy-registry.yaml` (§9.2). The `ci/retention-policy-registry-parity` mechanism (§9.3) enforces this against the parseable canonical sources; non-parseable sources (Doc 03 Main §14.2, Doc 05D §10, Doc 01 V8 §5.1) are recorded as `cited_per_project_handoff_record` per §3.4/§3.5/FWD-06-02 until the source ships.  
2. **Enforcement proof:** every retention horizon listed in the registry has an `ops/retention-policy-conformance` run that produces a per-surface proof of purges happening on schedule (§9.4).  
3. **Deletion proof:** every user-initiated deletion produces a deletion-proof manifest covering all four layers (identity / mastery / LISA / analytics) per §6.  
4. **No restatement:** 06D never states a retention horizon, a redaction pattern, or a cascade rule that belongs to a canonical owner. Any apparent restatement is a `DD-06-REDEF` defect surfaced by audit P10 / P15.

---

# **§5 — Soft-Delete / Hard-Delete Vocabulary (Reference to Doc 01 V6 §19) — RB-06D-V1-11 corrected**

Doc 01 V6 §19 owns the soft-delete / hard-delete model body. 06D consumes the model entirely and adds nothing to its mechanics. The 06D-owned addition is the executable-proof wrapper documented in §6.

**RB-06D-V1-11 corrected — no restatement of deletion timing, state names, cancellation rules, guardian/admin paths, or recovery semantics.** All of those phases, transitions, paths, and rules are canonical to **Doc 01 V6 §19 — Account Deletion and Soft-Delete Lifecycle**. Readers should consult that section directly for the lifecycle body. 06D consumes the lifecycle solely to trigger the §6 proof harness:

* The §6 deletion-proof harness fires when Doc 01 V6 §19's T+7 hard-delete job emits its completion event for a given `account_deletion_requests.id`.  
* The §6 `layers_verified` JSONB (§6.3) covers all four documented deletion layers (identity per Doc 01 V6 §19; mastery per Doc 05D §10; LISA per Doc 03 Main §14.2; analytics per Doc 07 FWD-06-01).  
* 06D defines NO deletion timing, state name, cancellation rule, guardian path, admin path, or recovery semantics. Any apparent restatement is a `DD-06-REDEF` defect.

The Doc 05D §10 cascade (mastery/projection layer) runs as part of the T+7 hard-delete path. The Doc 03 Main §14.2 LISA-tier deletions run on their own retention crons (not user-initiated). 06D's §6 proof harness covers both identity-layer and 05D-cascade verification end-to-end without restating either body.

---

# **§6 — Deletion Executable-Proof Harness (INV-06-08)**

## **6.1 Scope**

INV-06-08: every irreversible deletion has an executable proof of completion. 06D owns the proof harness; the deletion *bodies* are owned by Doc 01 V6 §19 (identity layer) and Doc 05D §10 (mastery cascade). The harness consumes those bodies and adds the verification \+ manifest layer.

## **6.2 Relational substrate**

CREATE TABLE deletion\_verification\_records (  
  id                          uuid PRIMARY KEY,  
  deletion\_request\_id         text NOT NULL,                            \-- references Doc 01 V6 account\_deletion\_requests.id  
  verification\_started\_at     timestamptz NOT NULL,  
  verification\_completed\_at   timestamptz,  
  verification\_outcome        text NOT NULL DEFAULT 'in\_progress',      \-- 'in\_progress' | 'pass' | 'fail'  
  layers\_verified             jsonb NOT NULL,                           \-- structured layer-coverage record (see §6.3)  
  proof\_manifest\_ref          text,                                     \-- path/hash of signed manifest artifact when completed  
  CHECK (verification\_outcome IN ('in\_progress','pass','fail')),  
  CHECK (verification\_outcome \<\> 'in\_progress' OR verification\_completed\_at IS NULL),  
  CHECK (verification\_outcome  \= 'in\_progress' OR verification\_completed\_at IS NOT NULL),  
  CHECK (verification\_outcome \<\> 'pass' OR proof\_manifest\_ref IS NOT NULL)  
);  
CREATE INDEX idx\_deletion\_verification\_request  
  ON deletion\_verification\_records (deletion\_request\_id);  
CREATE INDEX idx\_deletion\_verification\_outcome\_recent  
  ON deletion\_verification\_records (verification\_outcome, verification\_started\_at DESC);

Single-writer governance per Doc 01 V6 "Profile Canonical Writer" discipline (referenced); only the post-deletion verification job's service identity may INSERT or UPDATE. Direct writes from application code are forbidden — see §6.4.

## **6.3 Layer-coverage shape (`layers_verified` JSONB)**

Every deletion-verification record MUST cover all four documented deletion layers, OR explicitly mark a layer as `out_of_scope` with a referenced reason. The shape:

{  
  "identity": {  
    "verified": true | false,  
    "canonical\_owner": "Doc 01 V6 §19",  
    "evidence\_query": "\<sql or rpc that proved identity layer was deleted\>",  
    "result": "\<row count, hash, or boolean expected\>",  
    "out\_of\_scope": false  
  },  
  "mastery": {  
    "verified": true | false,  
    "canonical\_owner": "Doc 05D §10 (cited per project handoff record)",  
    "evidence\_query": "\<sql proving 05D cascade tables are empty for student\_id\>",  
    "result": "\<row count expected \= 0\>",  
    "out\_of\_scope": false  
  },  
  "lisa": {  
    "verified": true | false,  
    "canonical\_owner": "Doc 03 Main §14.2 (cited per project handoff record)",  
    "evidence\_query": "\<sql proving LISA tables purged for student\_id, or that 90/180/365-day cron has scheduled the purge\>",  
    "result": "\<row count, schedule confirmation\>",  
    "out\_of\_scope": false  
  },  
  "analytics": {  
    "verified": false,  
    "canonical\_owner": "Doc 07 (FWD-06-01)",  
    "out\_of\_scope": true,  
    "out\_of\_scope\_reason": "analytics retention surface pending Doc 07 — bounded forward-ref per Parent §3"  
  }  
}

The `analytics` layer is `out_of_scope: true` at V1 (Doc 07 forward-ref); the other three layers MUST be `verified: true` for `verification_outcome = 'pass'`. Audit P21 (deletion-cascade reference exhaustiveness) verifies every passing deletion-verification record has all in-scope layers verified.

## **6.4 Validated write path RPC**

The `deletion_verification_records.deletion_request_id` column is text — it references `account_deletion_requests.id` in the Doc 01 V6 identity database but is not a database FK (the table may live in a different logical schema). Direct INSERT is forbidden by §6.2 single-writer governance; writes go through:

record\_deletion\_verification(  
  p\_deletion\_request\_id   text,  
  p\_layers\_verified       jsonb,  
  p\_outcome               text,  
  p\_proof\_manifest\_ref    text DEFAULT NULL  
) RETURNS uuid

The RPC:

1. Validates `p_deletion_request_id` against `account_deletion_requests` (Doc 01 V6 referenced).  
2. Validates `p_layers_verified` structure against the §6.3 schema.  
3. INSERTs or UPDATEs the verification record under the same transaction.  
4. Logs at 01A §13 INFO on success, ERROR on validation failure with the offending field.

## **6.5 Proving mechanism — `ops/deletion-proof-conformance` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled reconciliation job (Vercel Cron) \+ post-T+7-job trigger |
| Trigger cadence | Triggered immediately after each Doc 01 V6 §19 T+7 hard-delete job completes for a given `deletion_request_id`; daily aggregate reconciliation against `account_deletion_requests.status` |
| Input registry | `deletion_verification_records` \+ `account_deletion_requests` rows where `status = 'completed'` in past 14 days \+ Doc 05D D20/D21 test-result records (cited per project handoff record per §3.5; replaced with parsed test-result index when 05D source lands) |
| Failure condition | (a) any `account_deletion_requests.status = 'completed'` row in the past 14 days with no matching `deletion_verification_records.deletion_request_id` row — Page; (b) any `deletion_verification_records` row with `verification_outcome = 'fail'` — Page; (c) any `verification_outcome = 'in_progress'` row older than 1 hour — Page (stuck verification); (d) any `verification_outcome = 'pass'` row whose `layers_verified` JSONB is missing an in-scope layer per §6.3 (identity / mastery / lisa must be `verified: true` unless `out_of_scope: true` with reason) — Page; (e) any `verification_outcome = 'pass'` row with NULL `proof_manifest_ref` — Page (CHECK constraint catches this at write-time; reconciliation catches drift from out-of-band updates) |
| Proof artifact | `deletion-proof-conformance` record per Parent §10.5 \+ extras (§14): `deletions_checked[]`, per-deletion `{deletion_request_id, verification_outcome, layers_verified_summary: {identity, mastery, lisa, analytics}, proof_manifest_ref, lag_to_t_plus_7_seconds}` |
| Owner / paging | Platform/CTO; per 06C §11 unified rotation |

---

# **§7 — Backup Substrate & RPO/RTO Targets (Q-06D-1 \= b)**

## **7.1 Substrate-consumer model**

The V1 backup substrate is **Supabase PITR** (continuous WAL archival with point-in-time recovery). 06D *consumes* Supabase PITR; 06D does NOT redefine its mechanics. The substrate provides: continuous WAL archival to object storage, time-travel restore to any point in the retention window, restore-to-new-project (the V1 restore-test target). The substrate retention window is a Supabase product setting; **06D verifies it against `configured_min_retention_window_seconds` (§8.5 PITR coverage check) — a distinct metric from RPO. The RPO target (§7.2) is verified separately using `latest_recoverable_point_lag_seconds` per RB-06D-V1-02; retention-window coverage and RPO are NOT the same signal and are NOT cross-derived (RB-06D-V1-14).**

## **7.2 V1 platform RPO/RTO targets (Q-06D-1 \= b)**

| Target | V1 platform value | Stated meaning |
| ----- | ----- | ----- |
| **RPO (Recovery Point Objective)** | **15 minutes** | In the worst documented substrate-failure case, no more than 15 minutes of committed user data may be lost. |
| **RTO (Recovery Time Objective)** | **4 hours** | In the worst documented substrate-failure case, the platform is restored to a production-equivalent state within 4 hours of the recovery decision. |

**Substrate-margin rationale:** Supabase PITR product targets are tighter than these (\~2-minute recovery-point capability under normal substrate operation); the platform target sits above substrate capability so the SLA is achievable in restore drills, not a promise of substrate marketing numbers under degraded conditions.

**Subsystem stricter-target consumer pattern (Parent §3 explicit):** subsystems may declare *stricter* canonical RPO/RTO in their owning docs (e.g. Doc 04B exam scoring may declare RPO \= 2 minutes for the `score_runs` critical path; Doc 01 may declare RTO \= 30 minutes for identity). 06D references stricter subsystem targets; 06D does not enumerate them (the values live with their owners). 06D's restore-test (§8) verifies the platform target; subsystem-specific restore tests are subsystem-owned proving mechanisms.

## **7.3 Substrate consumption boundary**

06D does NOT:

* Specify Supabase PITR's internal WAL archival cadence (substrate-owned).  
* Specify Supabase PITR retention-window setting (substrate config; managed via 01A §3 config doctrine).  
* Specify restore-to-new-project mechanics (substrate-owned).

06D DOES:

* Specify the platform RPO/RTO target above (§7.2).  
* Specify the restore-test cadence \+ proof shape (§8).  
* Specify the alerts when the substrate signals RPO breach OR PITR coverage breach (§7.4 — two distinct alerts post-RB-06D-V1-02).

## **7.4 Substrate-coverage alerts — RB-06D-V1-02 corrected**

Two distinct substrate-coverage alerts; the prior draft conflated them.

`alert-registry.yaml` (06C §7) entries (subject to RB-06D-V1-03 06C post-lock additive for `source_class = doc06d_event` — see §17 W8):

* **`ALERT-DATA-01` (RPO breach):** severity `Page`, urgency `immediate`. Fires when the observed `latest_recoverable_point_lag_seconds` (substrate's "how stale is the most recent restorable point") exceeds the RPO target stated in §7.2 (900 seconds). **This is the correct RPO signal.** Observed on every `ops/restore-test` run (§8.5 failure condition c) AND on substrate-state-change webhooks (where available) AND on a daily passive check (§8 monthly\_baseline cadence floor).  
* **`ALERT-DATA-02` (PITR coverage breach):** severity `Page`, urgency `next-business-hour` (less urgent — coverage breach degrades historical-restore ability but does not invalidate near-term recovery). Fires when the observed `pitr_retention_window_seconds` drops below `configured_min_retention_window_seconds` (V1 baseline \= 604800s / 7 days; **configured value owned by 01A §3 config doctrine and materialized in `infra/data-protection-config.yaml` — RB-06D-V1-16**; see §8.5 failure condition d).

The two alerts are kept distinct because the operational responses are distinct: an RPO breach indicates active substrate degradation (WAL archival stalling) and demands immediate triage; a coverage breach typically indicates a Supabase plan/config drift and tolerates next-business-hour triage. Both feed the `ops/restore-test` envelope (§8.5).

---

# **§8 — Restore-Test Executable-Proof (INV-06-09) — `ops/restore-test`**

## **8.1 Scope**

INV-06-09: every backup has a restore-test proof. 06D owns `ops/restore-test`, the periodic PITR/restore drill that produces a signed restore-proof manifest. Cadence is Q-06D-3=d locked: trigger-based \+ monthly minimum.

## **8.2 Trigger model (Q-06D-3 \= d) — RB-06D-V1-01**

The trigger model separates **pre-apply** verification (a baseline restore-test plus the 06A pre-apply backup proof must exist before a data-impact migration deploys) from **post-deploy** verification (a `data_impact_migration` restore-test is enqueued *after* a successful production deploy and its outcome gates the *next* deploy). This eliminates the pre-deploy / post-deploy contradiction in the prior draft.

| Trigger type | Trigger condition | Rationale |
| ----- | ----- | ----- |
| `monthly_baseline` | At the start of each calendar month (UTC), if no `data_impact_migration` trigger has fired in the prior 30 days, a baseline restore test is enqueued. The monthly\_baseline outcome is the artifact `ci/restore-test-recency` consults for the "recent baseline" pre-deploy check. | Ensures the restore runbook stays current even in quiet months; verifies substrate health when no risky migrations land; provides the recent-baseline artifact every pre-deploy gate requires. |
| `data_impact_migration` | A production deploy *successfully completes* a migration with `data_impact ∈ {transforms_data, deletes_data}` (06A §11.3 RB-06A-V1-06 enum referenced). The restore test is enqueued **after** the deploy succeeds. The deploy that triggered it is NOT gated by its own outcome (impossible to have); the **next** production deploy is gated per §8.6. | Verify restore works against the *post-migration* substrate state — only meaningful after the migration has actually been applied to production. Coupling to the next deploy ensures every data-impact migration receives a restore-test pass before further changes layer on top. |

Both triggers produce a `restore_test_runs` row. Outcome must complete within 4 hours of trigger (matching the RTO target stated in §7.2) — exceeding the bound is a Page alert per §8.5.

**Decoupling note (corrects the prior-draft contradiction):** the `data_impact_migration` restore-test runs *after* its triggering deploy succeeds. The pre-deploy gate (`ci/restore-test-recency` per §8.6) verifies a fresh `monthly_baseline` pass and a fresh 06A pre-apply backup proof; it does NOT require the data-impact restore-test for the *current* PR's migration (which cannot exist yet). It DOES require that no prior `data_impact_migration` restore-test is left `pending` / `failed` / stale `aborted` — those block the next deploy until remediated.

## **8.3 Relational substrate**

CREATE TABLE restore\_test\_runs (  
  id                              uuid PRIMARY KEY,  
  trigger\_reason                  text NOT NULL,                            \-- 'data\_impact\_migration' | 'monthly\_baseline'  
  triggering\_migration\_id         text,                                     \-- non-null when trigger\_reason \= 'data\_impact\_migration'  
  started\_at                      timestamptz NOT NULL,  
  completed\_at                    timestamptz,  
  outcome                         text NOT NULL DEFAULT 'in\_progress',      \-- 'in\_progress' | 'pass' | 'fail' | 'aborted'  
  rpo\_observed\_seconds            int,                                      \-- measured RPO at restore: (now \- restored\_point\_in\_time)  
  rto\_observed\_seconds            int,                                      \-- measured RTO at restore: (completed\_at \- started\_at)  
  \-- RB-06D-V1-02 (B2): split substrate metrics. retention\_window answers "how far back can we restore?"; recoverable\_point\_lag answers "how stale is the latest restorable point?" The RPO check enforces against lag, NOT against retention window.  
  pitr\_retention\_window\_seconds          int,                               \-- substrate-observed: oldest restorable point lookback (governs PITR coverage)  
  latest\_recoverable\_point\_lag\_seconds   int,                               \-- substrate-observed: (now \- latest\_recoverable\_point) — this is the RPO signal  
  integrity\_checks\_passed         jsonb,                                    \-- shape required by §8.3.1 (RB-06D-V1-09)  
  proof\_manifest\_ref              text,                                     \-- signed manifest artifact when outcome \= pass  
  CHECK (trigger\_reason IN ('data\_impact\_migration','monthly\_baseline')),  
  CHECK (outcome IN ('in\_progress','pass','fail','aborted')),  
  CHECK (trigger\_reason \<\> 'data\_impact\_migration' OR triggering\_migration\_id IS NOT NULL),  
  CHECK (outcome \<\> 'pass' OR (proof\_manifest\_ref IS NOT NULL  
                               AND rpo\_observed\_seconds IS NOT NULL  
                               AND rto\_observed\_seconds IS NOT NULL  
                               AND latest\_recoverable\_point\_lag\_seconds IS NOT NULL  
                               AND pitr\_retention\_window\_seconds IS NOT NULL))  
);  
CREATE INDEX idx\_restore\_test\_runs\_outcome\_recent  
  ON restore\_test\_runs (outcome, started\_at DESC);  
CREATE INDEX idx\_restore\_test\_runs\_trigger  
  ON restore\_test\_runs (trigger\_reason, started\_at DESC);

## **8.3.1 `integrity_checks_passed` required JSONB shape — RB-06D-V1-09**

Every `restore_test_runs` row with `outcome = 'pass'` MUST have `integrity_checks_passed` conforming to the shape below. The §8.5 failure-condition checks read these fields by name; an absent or malformed shape is a `DD-06-PROOF` defect.

{  
  "schema\_presence": {  
    "checked\_tables": \["\<list of table names verified present in the restored DB\>"\],  
    "missing\_tables": \["\<list MUST be empty for outcome=pass\>"\]  
  },  
  "fk\_integrity": {  
    "violations\_count": 0,  
    "queries": \["\<list of FK-integrity SQL queries run; each must report 0 violations for outcome=pass\>"\]  
  },  
  "row\_count\_checks": \[  
    {  
      "table": "\<table name\>",  
      "source\_count": 0,  
      "restored\_count": 0,  
      "tolerance": 0,  
      "decision": "pass|fail"  
    }  
  \],  
  "seed\_canary\_checks": \[  
    {  
      "canary\_id": "\<stable ID of a known seed row planted for restore verification\>",  
      "found\_in\_restore": true  
    }  
  \]  
}

Tolerance semantics: `row_count_checks[].decision = 'pass'` when `|source_count - restored_count| <= tolerance`; otherwise `'fail'`. Tolerance is typically 0 for the substrate-managed PITR path; non-zero tolerances permitted only for tables whose row counts can legitimately differ between source and restored snapshots (e.g., active-session tables) with rationale documented in the proof manifest.

## **8.4 Validated write path RPC**

record\_restore\_test\_run(  
  p\_trigger\_reason                          text,  
  p\_triggering\_migration\_id                 text DEFAULT NULL,  
  p\_started\_at                              timestamptz,  
  p\_completed\_at                            timestamptz DEFAULT NULL,  
  p\_outcome                                 text DEFAULT 'in\_progress',  
  p\_rpo\_observed\_seconds                    int  DEFAULT NULL,  
  p\_rto\_observed\_seconds                    int  DEFAULT NULL,  
  p\_pitr\_retention\_window\_seconds           int  DEFAULT NULL,  
  p\_latest\_recoverable\_point\_lag\_seconds    int  DEFAULT NULL,  
  p\_integrity\_checks\_passed                 jsonb DEFAULT NULL,  
  p\_proof\_manifest\_ref                      text DEFAULT NULL  
) RETURNS uuid

RPC validates: `p_trigger_reason` ∈ enum; if `data_impact_migration` then `p_triggering_migration_id` resolves against the migrations record (referenced from 06A §11); on `outcome = 'pass'` the manifest \+ observed RPO/RTO \+ both substrate-metric fields \+ a §8.3.1-conformant `integrity_checks_passed` are ALL populated. Direct INSERT to `restore_test_runs` is forbidden — single-writer per the restore-test job's service identity.

## **8.5 Proving mechanism — `ops/restore-test` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions workflow (separate from 06A's `ci/release-gates`; runs against a Supabase restore-target project, not production); invoked by trigger model in §8.2 |
| Trigger cadence | Per §8.2: `monthly_baseline` (calendar-month boundary check, provides the recent-baseline artifact for pre-deploy gates) \+ `data_impact_migration` (post-deploy enqueue after a successful migration deploy) |
| Input registry | `restore_test_runs` \+ recent migration outcomes (joined with 06A's migration-recovery substrate by `triggering_migration_id`) \+ Supabase PITR substrate state observed via Supabase Management API (two distinct fields per RB-06D-V1-02: `pitr_retention_window_seconds` for substrate coverage; `latest_recoverable_point_lag_seconds` for the RPO signal) |
| External-fetch failure semantics | If the Supabase Management API fetch fails (timeout/non-2xx/parse): record `pitr_retention_window_seconds = NULL` AND `latest_recoverable_point_lag_seconds = NULL` \+ `outcome = 'aborted'` \+ post a Warn alert via §7.4 channel. Retry on next trigger; do NOT silently pass. (06C P18 discipline applied.) |
| Failure condition | (a) any `restore_test_runs` row with `outcome = 'fail'` — Page; (b) any `outcome = 'in_progress'` row older than 4 hours from `started_at` (RTO target) — Page; (c) **RPO breach (RB-06D-V1-02):** `latest_recoverable_point_lag_seconds > 900` at test time OR in a `pass` row — Page (substrate is not honoring the RPO target; this is the correct RPO signal — NOT retention window); (d) **PITR coverage breach (RB-06D-V1-02):** `pitr_retention_window_seconds < configured_min_retention_window_seconds` (**config value owned by 01A §3 config doctrine and materialized in `infra/data-protection-config.yaml` — RB-06D-V1-16**; V1 baseline \= 604800 seconds \= 7 days, matching Supabase Pro PITR defaults) — Page (substrate retention window is too narrow; cannot meet historical-restore needs); (e) `rpo_observed_seconds > 900` OR `rto_observed_seconds > 14400` in a `pass` row — Page (measured target breach during the restore drill itself); (f) `integrity_checks_passed` fails any §8.3.1 check (`missing_tables` non-empty, `fk_integrity.violations_count > 0`, any `row_count_checks[].decision = 'fail'`, any `seed_canary_checks[].found_in_restore = false`) — Page; (g) `monthly_baseline` cadence breach (\>35 days since most recent `pass` outcome of `trigger_reason = 'monthly_baseline'`) — Page; (h) **aborted-state escalation (RB-06D-V1-08):** any `outcome = 'aborted'` row older than 24 hours without a subsequent `pass` for the same `(trigger_reason, triggering_migration_id)` tuple — escalates from Warn to Page; (i) **data-impact aborted blocks next deploy (RB-06D-V1-08):** any `outcome = 'aborted'` row with `trigger_reason = 'data_impact_migration'` blocks subsequent production deploys via §8.6 until a `pass` for that `triggering_migration_id` exists |
| Proof artifact | `restore-test` record per Parent §10.5 \+ extras (§14): per-run `{run_id, trigger_reason, triggering_migration_id, started_at, completed_at, outcome, rpo_observed_seconds, rto_observed_seconds, pitr_retention_window_seconds, latest_recoverable_point_lag_seconds, integrity_checks_passed_summary: {schema_presence_ok, fk_violations_count, row_count_failures, canary_misses}, proof_manifest_ref, target_breach: bool, aborted_age_hours_if_applicable: int}`. **Proof artifact is subject to the no-PII rule (§8.7 / RB-06D-V1-10).** |
| Owner / paging | Platform/CTO; per 06C §11 unified rotation |

## **8.6 Proving mechanism — `ci/restore-test-recency` (Parent §6.13) — RB-06D-V1-01 corrected**

A pre-deploy CI gate that verifies the platform never deploys without (a) a recent successful baseline restore-test and (b) for data-impact migrations, the corresponding 06A pre-apply backup proof exists, and (c) no prior `data_impact_migration` restore-test is left `pending` / `failed` / stale `aborted`. Wires into 06A `ci/release-gates` as a `pre_deploy` gate.

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions; called by 06A `ci/release-gates` as a `pre_deploy` blocking gate |
| Trigger cadence | Per production-deploy PR |
| Input registry | `restore_test_runs` rows \+ 06A pre-apply backup proof artifacts (joined by `triggering_migration_id` for data-impact PRs) \+ the deploying PR's migration manifest (read from 06A §11.3 migration record) |
| Failure condition (RB-06D-V1-01 corrected — three-check shape) | **(1) Recent baseline check:** most recent `outcome = 'pass'` row with `trigger_reason = 'monthly_baseline'` is older than 35 days (covers the monthly cadence \+ 5-day grace) — Page (deploy-blocking). **(2) Pre-apply backup proof (data-impact only):** if the deploying PR contains a migration with `data_impact ∈ {transforms_data, deletes_data}`, a 06A pre-apply backup proof for that migration MUST exist (referenced from 06A §11 migration-recovery substrate); absent proof — Page (deploy-blocking). **(3) Prior data-impact restore-test cleanliness:** ANY prior `data_impact_migration` row with `outcome ∈ {'in_progress', 'fail'}` older than 4 hours, OR `outcome = 'aborted'` older than 24 hours, OR `outcome = 'pass'` missing required §8.3.1 / RPO-lag / proof\_manifest fields — Page (deploy-blocking until remediated). |
| **Explicit non-check (RB-06D-V1-01)** | This gate does NOT require a `data_impact_migration` restore-test pass for the *current* PR's migration — that test runs *after* the deploy by §8.2 definition. The post-deploy outcome gates the *next* deploy (failure condition 3 above), not this one. The triggering deploy gets its safety from (1) recent baseline \+ (2) 06A pre-apply backup proof. |
| Proof artifact | `restore-test-recency` record per Parent §10.5 \+ extras (§14): `most_recent_baseline_pass_age_days`, `deploying_migration_data_impact`, `pre_apply_backup_proof_ref` (or null if not required), `prior_data_impact_test_status: {in_progress_count, fail_count, aborted_count, pending_remediation[]}`, \`decision: allow |
| Owner / paging | Platform/CTO; PR-blocking |

## **8.7 No-PII proof-artifact rule (RB-06D-V1-10 — applies family-wide; canonical statement)**

Every 06D proof artifact produced by ANY §6 / §8 / §9 / §10 / §11 / §12 mechanism MUST NOT contain raw PII, raw student content, raw tutor content, emails, names, phone numbers, DOBs, addresses, access tokens, OR full user IDs. Permitted contents:

* Stable opaque IDs (deletion\_request\_id, incident\_id, gate\_id, evidence\_id, policy\_id, run\_id, canary\_id, ticket IDs).  
* Aggregate counts, durations, table names, decision enums (pass/fail/allow/block), boolean flags.  
* Hash digests of identifiers (SHA-256 with a **proof-run-local salt that is generated per run AND IS NEVER stored in the artifact itself**) — used when identity linkage across two artifacts of the same run is required for verification. **RB-06D-V1-18 reproducibility note (R2 M2):** salted hashes are for *within-artifact/within-run correlation only*, NOT for future recomputation. A later auditor cannot re-derive a row's salted hash because the salt is intentionally discarded with the run; future verification relies on the original source-of-truth queries (the canonical-owner tables) plus the aggregate proof fields in the artifact (counts, decision enums, pass/fail bits), not on re-identifying the salted hash. This is a deliberate property: the salt-discard pattern lets the artifact prove "the same identity appeared at step 1 and step 2 of this run" without ever embedding a reversible identifier or enabling post-hoc re-identification.  
* Redacted/shortened identifiers conformant to 01A §14 redaction patterns.

Forbidden contents: any field whose canonical owner classifies it as PII (01A §14, Doc 01 V6 §19, Doc 03 Main §14.2 — the registered set in §9 retention registry is the inventory); raw SQL result rows; raw payloads from RAG/LLM exchanges; full-resolution audit-log bodies. Where identity-linkage is necessary, use the salted-hash pattern above; where row-counts are emitted, use aggregate counts only.

**Enforcement:** an audit pass on every proof-artifact emitter (extending 06C P14 schema-completeness discipline) verifies the artifact schema declares only the permitted field set. A proof artifact containing a forbidden field is a `DD-06-PROOF` defect. The §16 audit suite gains pass **P22** (no-PII proof-artifact conformance) — added in CR-06D-04.

---

# **§9 — Retention Policy Registry & Enforcement**

## **9.1 Registry — `infra/retention-policy-registry.yaml`**

The canonical machine-readable inventory of every PII surface in the platform mapped to its retention horizon, purge substrate, and purge alert.

retention\_policies:  
  \- policy\_id: \<stable id; format 'RPOL-\<area\>-\<NN\>'\>  
    pii\_surface\_name: \<e.g. 'profiles.email' | 'lisa.tutor\_conversations.body' | 'audit\_logs.request\_payload'\>  
    canonical\_owner\_doc\_and\_section: \<e.g. '01A §14' | 'Doc 01 V6 §19' | 'Doc 03 Main §14.2' | 'Doc 05D §10'\>  
    classification: \<pii | identifier | content | operational | analytics\>     \# consumed from canonical owner; 06D does not classify  
    retention\_horizon\_seconds: \<int | null\>                                     \# consumed from canonical owner; 06D does not set. null permitted only when partial\_provable\_until is set (RB-06D-V1-12).  
    partial\_provable\_until: \<forward-ref token | null\>                          \# e.g. 'FWD-06-02'; null otherwise. When set, ci/retention-policy-registry-parity (§9.3) AND ops/retention-policy-conformance (§9.4) skip numeric enforcement for this policy (RB-06D-V1-12).  
    purge\_substrate: \<pg\_cron | scheduled\_job | doc05d\_cascade | doc01v6\_t\_plus\_7 | doc03\_lisa\_cron | manual\>  
    \# RB-06D-V1-05: per-policy purge-lag allowance. Replaces the prior global "retention\_horizon \+ 7-day-grace" (which baked in identity-deletion semantics inappropriate for log/audit/LISA surfaces). Each policy declares its own allowance; canonical owners may define the value.  
    purge\_lag\_allowance\_seconds: \<int\>                                          \# max delay beyond retention\_horizon\_seconds before purge-staleness alerts fire. Canonical owner of the value is the canonical owner of the policy.  
    purge\_alert\_id: \<links to 06C §7 alert-registry\>  
    out\_of\_scope: \<true | false\>                                                \# only true for explicit deferrals  
    out\_of\_scope\_reason: \<required when out\_of\_scope=true; references canonical owner\>  
    last\_reviewed\_at: \<iso8601\>

The registry V1 ships with the launch-known set:

* Doc 01 V6 §19 identity PII (referenced by `pii_surface_name`\-prefixed `profiles.*` entries; canonical\_owner \= `Doc 01 V6 §19`)  
* 01A §14 redaction-tier PII (referenced by `logs.*` and `observability.*` entries; canonical\_owner \= `01A §14`)  
* Doc 03 Main §14.2 LISA tables — registered as `cited_per_project_handoff_record` placeholder entries (10 entries); reconciled on Doc 03 Main upload  
* Doc 05D §10 mastery cascade — registered as `cited_per_project_handoff_record` placeholder entries (10 derived tables per memory); reconciled on Doc 05D upload  
* Doc 07 analytics — `out_of_scope: true` with `out_of_scope_reason: 'pending Doc 07 (FWD-06-01)'` for the analytics layer entries

## **9.2 Hard rules**

1. **Inventory completeness.** Every PII surface in 01A §14 \+ Doc 01 V6 §19 (parsed from source where available) MUST appear in the registry. Surfaces in non-source-tree docs (Doc 03 Main §14.2, Doc 05D §10) are registered as `cited_per_project_handoff_record` until reconciliation. Missing surface \= `ci/retention-policy-registry-parity` failure.  
2. **Canonical owner cited.** `canonical_owner_doc_and_section` MUST resolve to a referenced doc \+ § anchor. Restating a retention horizon without citing its owner is a `DD-06-REDEF` defect.  
3. **Purge substrate documented.** `purge_substrate` MUST be one of the enumerated values; `manual` is permitted only with `out_of_scope: false` AND a documented `purge_alert_id` to detect manual purges that don't happen.  
4. **Out-of-scope must be justified.** `out_of_scope: true` requires `out_of_scope_reason` text. The only V1 legitimate out-of-scope reason is the Doc 07 analytics forward-ref.

## **9.3 Proving mechanism — `ci/retention-policy-registry-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, on PRs touching `infra/retention-policy-registry.yaml` or any referenced canonical owner doc; plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/retention-policy-registry.yaml` \+ parsed 01A §14 PII field index \+ parsed Doc 01 V6 §19 PII field index (extracted from "deidentify\_user" target list — email, name, phone, DOB, address) \+ 06C §7 `infra/alert-registry.yaml` (every `purge_alert_id` MUST resolve there) \+ canonical-owner index (each `canonical_owner_doc_and_section` MUST resolve to a referenced doc \+ § OR be marked `cited_per_project_handoff_record`) |
| Failure condition | (a) any 01A §14 PII field not in the registry (without `out_of_scope: true`); (b) any Doc 01 V6 §19 PII field (email/name/phone/DOB/address per the `deidentify_user` body) not in the registry; (c) any `canonical_owner_doc_and_section` not resolving (citation parity); (d) any `purge_alert_id` not in `infra/alert-registry.yaml`; (e) any `out_of_scope: true` without `out_of_scope_reason`; (f) any `last_reviewed_at` older than 180 days; (g) any policy with `purge_substrate = 'manual'` and no `purge_alert_id`; **(h) RB-06D-V1-05:** any policy with `retention_horizon_seconds IS NOT NULL` AND `purge_lag_allowance_seconds IS NULL` (lag allowance is mandatory whenever a numeric retention horizon is set; canonical-owner-defined value required); **(i) RB-06D-V1-12:** any policy with `retention_horizon_seconds IS NULL` AND `partial_provable_until IS NULL` (null retention horizon permitted ONLY when a forward-ref token is declared); conversely any policy with both `retention_horizon_seconds` and `partial_provable_until` populated (mutually exclusive — partial-provable means the horizon is not yet set by the canonical owner) |
| Proof artifact | `retention-policy-registry-parity` record per Parent §10.5 \+ extras (§14): `policies_checked[]`, per-policy `{policy_id, pii_surface_name, canonical_owner_resolution, alert_link_check, last_reviewed_age_days, out_of_scope, partial_provable_until_token_if_any, purge_lag_allowance_check, decision}`, `canonical_pii_surfaces_inventory_check: {sources_parsed[], surfaces_required, surfaces_present, surfaces_missing[]}` |
| Owner / paging | Platform/CTO; PR-blocking |

## **9.4 Proving mechanism — `ops/retention-policy-conformance` (Parent §6.13) — RB-06D-V1-05 \+ RB-06D-V1-12 corrected**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled reconciliation job (Vercel Cron); registered in 06C §8.2 scheduled-job registry as `JOB-DATA-RETENTION` with external\_watchdog substrate per 06C §8.7 discipline |
| Trigger cadence | Every 6 hours |
| Input registry | `infra/retention-policy-registry.yaml` \+ per-substrate observed purge state: pg\_cron's `cron.job_run_details` for pg\_cron policies; `scheduled_job_heartbeats` (06C §8.3) for scheduled\_job policies; Doc 05D D20/D21 test results for `doc05d_cascade` policies (cited per project handoff record per §3.5); Doc 01 V6 §19 T+7 job heartbeats for `doc01v6_t_plus_7` policies (joined via 06C §8.3); Doc 03 Main §14.2 cron heartbeats for `doc03_lisa_cron` policies (cited per project handoff record per §3.4) |
| Failure condition (RB-06D-V1-05 \+ RB-06D-V1-12 corrected) | **(a) Per-policy staleness (RB-06D-V1-05):** for each policy where `partial_provable_until IS NULL` (full-provable) AND `purge_substrate ∈ {pg_cron, scheduled_job, doc01v6_t_plus_7, doc03_lisa_cron, doc05d_cascade}`: most recent observed purge older than `retention_horizon_seconds + purge_lag_allowance_seconds` — Page via `purge_alert_id`. The per-policy `purge_lag_allowance_seconds` replaces the prior global 7-day grace; the value is owned by the canonical owner of the policy (e.g., Doc 01 V6 §19 owns the value for `doc01v6_t_plus_7` policies; 01A §19 owns it for log policies; etc.). **(b) Partial-provable skip (RB-06D-V1-12):** any policy with `partial_provable_until IS NOT NULL` is excluded from numeric staleness checks; reported as `partial_provable_skipped` with the forward-ref token in the proof artifact. This excludes §13 audit-archival placeholder rows whose `retention_horizon_seconds` is null pending Doc 01 V8. (c) for `purge_substrate = 'doc01v6_t_plus_7'`: any `account_deletion_requests.scheduled_delete_at < now() - 24 hours` with `status = 'pending'` (T+7 fired but no completion) — Page; (d) for `doc05d_cascade`: D20/D21 test failure or test absence beyond 30 days — Page (when 05D source available); (e) **independent source rule (06B §8.6 precedent applied):** the purge-observation source MUST be the substrate's native run-record table (`cron.job_run_details`, `scheduled_job_heartbeats`, etc.), NEVER the same table the policy itself purges (self-comparison antipattern); (f) any policy with `out_of_scope: true` whose `out_of_scope_reason` no longer applies (the deferring forward-ref has closed) — Warn |
| Proof artifact | `retention-policy-conformance` record per Parent §10.5 \+ extras (§14): `policies_checked[]`, per-policy `{policy_id, purge_substrate, partial_provable_until_token_if_any, last_observed_purge_at, retention_horizon_seconds, purge_lag_allowance_seconds, lag_seconds, source_independent_check: bool, decision}`. **Subject to §8.7 no-PII rule.** |
| Owner / paging | Platform/CTO; per 06C §11 unified rotation |

---

# **§10 — Compliance-Evidence Process (INV-06-11) — Q-06D-2 \= b Async**

## **10.1 Scope**

INV-06-11: compliance gates are deploy gates. 06A §10 owns `infra/release-gates.yaml` and `ci/release-gates`. 06D owns the *evidence/approval/audit process* behind each compliance-gate entry — the process that produces the gate's `proof_artifact_ref` value. Q-06D-2=b locked: asynchronous standalone registry pattern.

## **10.2 Registry — `infra/compliance-gate-registry.yaml`**

compliance\_gates:  
  \- gate\_id: \<stable id; format 'CGATE-\<area\>-\<NN\>'\>                           \# MUST match a 06A infra/release-gates.yaml entry by id  
    rule\_canonical\_owner: \<doc \+ § where the compliance rule is defined\>      \# e.g. 'Doc 05D §11.2' for BLOCKING\_PRIVACY\_GAP  
    rule\_summary: \<one-line summary of what the rule requires; not the rule body\>  
    evidence\_file\_shape:                                                       \# required schema for the evidence document  
      sections: \[\<list of required markdown sections in docs/compliance-evidence/\<gate-id\>/\<NN\>.md\>\]  
      attachments: \[\<required attachment types: legal-review | tech-review | data-impact-assessment | other\>\]  
      approver\_role: \<CODEOWNERS-resolved role authorized to approve\>  
    current\_evidence:  
      evidence\_id: \<NN — increments with each re-submission\>  
      evidence\_path: \<docs/compliance-evidence/\<gate-id\>/\<NN\>.md\>  
      current\_state: \<pending | under\_review | approved | rejected | expired\>  
      submitted\_at: \<iso8601\>  
      reviewed\_at: \<iso8601 or null\>  
      approval\_window\_expires\_at: \<iso8601 or null — approved evidence expires; re-submission required\>  
    release\_gate\_entry\_ref: \<06A infra/release-gates.yaml gate\_id this maps to\>  
    last\_reviewed\_at: \<iso8601\>

V1 registry ships with one entry: **`CGATE-PRIVACY-01`** — corresponding to Doc 05D's `BLOCKING_PRIVACY_GAP` (Parent §14 explicitly: "first canonical compliance gate registered under INV-06-11"). Future gates (COPPA, GDPR, jurisdictional launch-sequence gates per the project compliance brief) register here as their canonical-owner docs define them.

## **10.3 Relational substrate**

CREATE TABLE compliance\_gate\_evidence (  
  id                          uuid PRIMARY KEY,  
  gate\_id                     text NOT NULL,                                  \-- matches infra/compliance-gate-registry.yaml gate\_id  
  evidence\_id                 int  NOT NULL,                                  \-- per-gate sequence, increments per re-submission  
  evidence\_path               text NOT NULL,                                  \-- docs/compliance-evidence/\<gate-id\>/\<NN\>.md  
  \-- RB-06D-V1-07: durable evidence identity. Path alone is mutable (filesystem); commit\_sha \+ file\_sha256 give the audit trail a fixed reference point.  
  evidence\_commit\_sha         text,                                            \-- git commit SHA at which this evidence row was submitted; populated by the CI submission layer at PR merge  
  evidence\_file\_sha256        text,                                            \-- SHA-256 of the evidence file contents at submission time; populated by the CI submission layer  
  submitted\_at                timestamptz NOT NULL,  
  submitted\_by\_user\_id        uuid NOT NULL,  
  current\_state               text NOT NULL DEFAULT 'pending',                \-- 'pending' | 'under\_review' | 'approved' | 'rejected' | 'expired'  
  reviewed\_at                 timestamptz,  
  reviewed\_by\_user\_id         uuid,  
  rejection\_reason            text,                                            \-- required when current\_state \= 'rejected'  
  approval\_window\_expires\_at  timestamptz,                                    \-- required when current\_state \= 'approved'  
  CHECK (current\_state IN ('pending','under\_review','approved','rejected','expired')),  
  CHECK (evidence\_path \~ '^docs/compliance-evidence/\[a-z0-9\_-\]+/\[0-9\]{2}\\.md$'),  
  CHECK (current\_state NOT IN ('approved','rejected','expired') OR reviewed\_at IS NOT NULL),  
  CHECK (current\_state \<\> 'rejected' OR rejection\_reason IS NOT NULL),  
  CHECK (current\_state \<\> 'approved' OR approval\_window\_expires\_at IS NOT NULL),  
  \-- RB-06D-V1-07: for current\_state ∈ {'approved','expired'}, commit\_sha \+ file\_sha256 MUST be populated (durable audit identity).  
  CHECK (current\_state NOT IN ('approved','expired') OR (evidence\_commit\_sha IS NOT NULL AND evidence\_file\_sha256 IS NOT NULL)),  
  UNIQUE (gate\_id, evidence\_id)  
);  
CREATE INDEX idx\_compliance\_gate\_evidence\_gate\_current  
  ON compliance\_gate\_evidence (gate\_id, current\_state, submitted\_at DESC);  
CREATE INDEX idx\_compliance\_gate\_evidence\_approval\_expiry  
  ON compliance\_gate\_evidence (approval\_window\_expires\_at)  
  WHERE current\_state \= 'approved';

## **10.4 State-machine transition RPC**

Per 06C P16 discipline (state-machine tables need transition RPCs, not just CHECK constraints), compliance-gate evidence state changes go through:

transition\_compliance\_gate\_evidence\_state(  
  p\_evidence\_id              uuid,  
  p\_to\_state                 text,  
  p\_actor\_user\_id            uuid,  
  p\_rejection\_reason         text DEFAULT NULL,  
  p\_approval\_window\_days     int  DEFAULT 365  
) RETURNS void

RPC validates:

1. Reads current state `FOR UPDATE`.

Rejects with `ILLEGAL_STATE_TRANSITION` unless `(from, to)` is in the legal-transition table:

 Legal transitions (and only these — RB-06D-V1-06 corrected):  
  pending        → under\_review  
  under\_review   → approved  
  under\_review   → rejected         \-- TERMINAL for this evidence\_id row  
  approved       → expired          \-- window passed; new submission required  
  \-- rejected and approved-then-expired are TERMINAL states for the originating row.  
  \-- A new submission (after a rejection OR an expiry) is NOT a transition on the rejected/expired row.  
  \-- It is a NEW row created via record\_compliance\_gate\_evidence\_submission() (§10.5)  
  \-- with the next evidence\_id for the same gate\_id, starting in 'pending'.

2.   
3. For `→ approved`: sets `approval_window_expires_at = now() + (p_approval_window_days days)` and `reviewed_at = now()`.

4. For `→ rejected`: requires `p_rejection_reason`; sets `reviewed_at = now()`. **The row is terminal; further state changes for this `(gate_id, evidence_id)` are rejected with `ILLEGAL_STATE_TRANSITION`.**

5. For `→ expired`: only callable by the periodic expiry job (§10.7); rejects callers other than the expiry job's service identity. **The row is terminal.**

6. Logs at 01A §13 INFO on success, ERROR on rejection with the offending `(from, to)` pair.

**RB-06D-V1-06 corrected: re-submission is an INSERT, not a transition.** When a `rejected` or `expired` evidence row needs to be superseded, the submitter calls `record_compliance_gate_evidence_submission()` (§10.5), which creates a NEW row with `evidence_id = max(existing) + 1` for the same `gate_id`, starting in `pending`. The prior `rejected` / `expired` row remains in the table as terminal audit history. The `infra/compliance-gate-registry.yaml` `current_evidence` block points to the most recent (highest `evidence_id`) row; readers of the registry get the active state automatically. This preserves the full submission history while keeping the state machine clean.

Direct UPDATE to `compliance_gate_evidence.current_state` from application code is forbidden — the §10.7 audit's transition-skip detection catches violations after the fact; the RPC prevents them up-front.

## **10.5 Initial submission RPC — RB-06D-V1-07 corrected**

record\_compliance\_gate\_evidence\_submission(  
  p\_gate\_id                  text,  
  p\_evidence\_path            text,  
  p\_submitted\_by\_user\_id     uuid,  
  p\_evidence\_commit\_sha      text DEFAULT NULL,  
  p\_evidence\_file\_sha256     text DEFAULT NULL  
) RETURNS uuid

**RB-06D-V1-07 corrected — split responsibility:** a database RPC cannot reliably inspect a Git working tree to verify file existence. The previous draft conflated these. The corrected responsibility split:

| Check | Owner | When |
| ----- | ----- | ----- |
| `p_gate_id` resolves in `infra/compliance-gate-registry.yaml` | RPC | At write time |
| `p_evidence_path` matches canonical regex `^docs/compliance-evidence/[a-z0-9_-]+/[0-9]{2}\.md$` | RPC \+ DB CHECK constraint | At write time |
| `evidence_id` increments correctly per gate | RPC | At write time |
| Evidence file exists at `p_evidence_path` in the repo | **CI (`ci/compliance-gate-registry-parity` §10.7)** | At PR-merge time \+ nightly |
| `evidence_commit_sha` \= the SHA at which submission landed | **CI submission layer** | At PR-merge time |
| `evidence_file_sha256` \= SHA-256 of the file contents at that commit | **CI submission layer** | At PR-merge time |
| `evidence_commit_sha` \+ `evidence_file_sha256` populated before approval | DB CHECK constraint (`current_state ∈ {'approved','expired'}`) | Transition time |

The RPC INSERTs the row in `pending` state with the (`gate_id`, `evidence_path`, `submitted_by_user_id`) tuple and optional commit/file SHAs (NULL on initial submission if the CI layer hasn't computed them yet; required before approval per the CHECK constraint). The CI submission layer (a GitHub Action triggered on PR merge of a `docs/compliance-evidence/**` change) computes the commit SHA and file SHA-256 and UPDATEs the row via a separate validated path:

populate\_compliance\_evidence\_artifact\_identity(  
  p\_evidence\_db\_id      uuid,  
  p\_commit\_sha          text,  
  p\_file\_sha256         text  
) RETURNS void

Only the CI submission layer's service identity may call `populate_compliance_evidence_artifact_identity()`; the function refuses callers otherwise. Direct INSERT and direct UPDATE to `compliance_gate_evidence` from application code remain forbidden.

## **10.6 Bridge to 06A `infra/release-gates.yaml`**

For each `compliance_gates[].gate_id` in 06D's registry, 06A's `infra/release-gates.yaml` MUST have a matching entry. That 06A entry's `proof_artifact_ref` points to the compliance-gate-evidence record path (resolves through `current_evidence.evidence_path` \+ `current_state = 'approved'` \+ non-expired `approval_window_expires_at`). When the 06A `ci/release-gates` job evaluates the gate (per 06A §10), it:

1. Reads 06D's `infra/compliance-gate-registry.yaml` to locate the `current_evidence`.  
2. Queries `compliance_gate_evidence` for the matching `(gate_id, evidence_id)` row.  
3. Gate result \= `pass` if `current_state = 'approved'` AND `approval_window_expires_at > now()`; else `fail` (blocks deploy).

06A `ci/release-gates` is the enforcement; 06D's registry \+ relational table is the data feeding it. 06D does not modify 06A's manifest schema.

## **10.7 Proving mechanism — `ci/compliance-gate-registry-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, on PRs touching `infra/compliance-gate-registry.yaml` or `docs/compliance-evidence/**`; plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/compliance-gate-registry.yaml` \+ `docs/compliance-evidence/**` filesystem listing \+ 06A `infra/release-gates.yaml` (every `gate_id` MUST resolve there per §10.6) \+ canonical-owner index (each `rule_canonical_owner` MUST resolve to a referenced doc \+ § OR be marked `cited_per_project_handoff_record`) |
| Failure condition | (a) any `gate_id` in 06D registry not present in 06A `infra/release-gates.yaml`; (b) any `rule_canonical_owner` not resolving; (c) any `evidence_path` whose file does not exist in the repo; (d) any `evidence_file_shape.sections` missing from the actual evidence document (parsed by required-section header match); (e) any registry entry with `current_evidence.current_state = 'approved'` whose `compliance_gate_evidence` row has `current_state ≠ 'approved'` (registry-substrate drift); (f) any `last_reviewed_at` older than 180 days |
| Proof artifact | `compliance-gate-registry-parity` record per Parent §10.5 \+ extras (§14): `gates_checked[]`, per-gate `{gate_id, rule_canonical_owner_resolution, evidence_path_existence, evidence_shape_check, release_gate_bridge_check, registry_substrate_alignment, decision}` |
| Owner / paging | Platform/CTO; PR-blocking |

## **10.8 Proving mechanism — `ops/compliance-gate-evidence-conformance` (Parent §6.13)**

Periodic reconciliation that approved-state evidence hasn't expired silently and that no stuck states linger.

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled reconciliation job (Vercel Cron); registered in 06C §8.2 as `JOB-COMPLIANCE-EVIDENCE` with external\_watchdog substrate per 06C §8.7 |
| Trigger cadence | Daily |
| Input registry | `compliance_gate_evidence` rows where `current_state ∈ {'pending','under_review','approved'}` |
| Failure condition | (a) any `current_state = 'approved'` row with `approval_window_expires_at < now()` not yet transitioned to `expired` — Page (stale approval; the §10.4 expiry job is failing); (b) any `current_state = 'under_review'` row older than 14 days — Page (stuck review); (c) any `current_state = 'pending'` row older than 7 days — Warn (delayed pickup); (d) expiry job itself: if no `current_state` transitions to `expired` have occurred in the past 90 days AND the registry contains approved evidence whose `approval_window_expires_at` is within 30 days, alert that the expiry job has not exercised its path recently — Warn |
| Proof artifact | `compliance-gate-evidence-conformance` record per Parent §10.5 \+ extras (§14): per-active-evidence `{gate_id, evidence_id, current_state, days_since_submission, days_to_expiry, expiry_job_recent_activity}` |
| Owner / paging | Founder \+ ops-lead (compliance review is founder/CTO scope); per 06C §11 unified rotation |

---

# **§11 — Privacy/Data-Breach Incident Sub-Class (06C §10 Extension)**

## **11.1 Scope**

06C §10 owns the incident lifecycle base (`incidents`, `incident_phase_transitions`, `incident_action_items`, `transition_incident_phase`). 06D adds a privacy/data-breach sub-class via a sidecar table — never modifies 06C's base schema. A privacy-class incident is an incident whose triggering event involves potential or confirmed unauthorized data exposure (LISA tutor conversation leakage per Doc 03C §28.7, an unauthorized PII access, a backup leak, etc.).

## **11.2 Relational substrate (sidecar to 06C `incidents`)**

CREATE TABLE incident\_privacy\_class\_attachments (  
  id                              uuid PRIMARY KEY,  
  incident\_id                     text NOT NULL REFERENCES incidents(incident\_id) ON DELETE RESTRICT,  
  attached\_at                     timestamptz NOT NULL DEFAULT now(),  
  attached\_by\_user\_id             uuid NOT NULL,  
  pii\_exposure\_scope              text NOT NULL,                  \-- 'identifier\_only' | 'identifier\_plus\_content' | 'unknown'  
  affected\_compliance\_gates       text\[\],                          \-- array of CGATE-\* refs (per §10 registry)  
  regulator\_notification\_required boolean NOT NULL DEFAULT false,  \-- set by Platform/CTO based on jurisdiction analysis  
  regulator\_notification\_window\_expires\_at timestamptz,            \-- 72h GDPR / state-specific; required when notification\_required=true  
  CHECK (pii\_exposure\_scope IN ('identifier\_only','identifier\_plus\_content','unknown')),  
  CHECK (regulator\_notification\_required \= false OR regulator\_notification\_window\_expires\_at IS NOT NULL),  
  UNIQUE (incident\_id)                                              \-- one privacy-class attachment per incident  
);  
CREATE INDEX idx\_incident\_privacy\_class\_window  
  ON incident\_privacy\_class\_attachments (regulator\_notification\_window\_expires\_at)  
  WHERE regulator\_notification\_required \= true;

## **11.3 Validated write path RPC**

attach\_privacy\_class\_to\_incident(  
  p\_incident\_id                     text,  
  p\_attached\_by\_user\_id             uuid,  
  p\_pii\_exposure\_scope              text,  
  p\_affected\_compliance\_gates       text\[\],  
  p\_regulator\_notification\_required boolean,  
  p\_regulator\_notification\_window\_expires\_at timestamptz DEFAULT NULL  
) RETURNS uuid

RPC validates: `p_incident_id` exists in `incidents`; `p_pii_exposure_scope` ∈ enum; if `p_regulator_notification_required = true` then `p_regulator_notification_window_expires_at` is non-null; each entry in `p_affected_compliance_gates` resolves against 06D's compliance-gate registry. Direct INSERT forbidden.

## **11.3.1 Privacy regulator notifications relational substrate — RB-06D-V1-04**

The prior draft tracked notification deadlines on the privacy-class attachment row and relied on parsing postmortem prose for proof-of-notification. That is not executable enough — a regulated-notification path cannot be gated on free-text matching. The corrected substrate captures notification state in its own relational table with a notification\_status state machine.

CREATE TABLE privacy\_regulator\_notifications (  
  id                    uuid PRIMARY KEY,  
  incident\_id           text NOT NULL REFERENCES incidents(incident\_id) ON DELETE RESTRICT,  
  regulator             text NOT NULL,                           \-- e.g. 'EU\_GDPR' | 'UK\_ICO' | 'CCPA\_CA\_AG' | 'COPPA\_FTC' | 'IN\_DPDP\_BOARD'  
  notification\_required boolean NOT NULL,  
  notification\_status   text NOT NULL DEFAULT 'pending'  
                        CHECK (notification\_status IN ('not\_required','pending','sent','missed\_deadline')),  
  deadline\_at           timestamptz,                              \-- jurisdiction-dependent; 72h for GDPR; state-specific elsewhere  
  sent\_at               timestamptz,  
  evidence\_ref          text,                                     \-- path/hash of notification artifact (letter, portal-submission receipt, etc.) — subject to §8.7 no-PII rule  
  reviewed\_by\_user\_id   uuid,  
  CHECK (notification\_required \= false OR deadline\_at IS NOT NULL),  
  CHECK (notification\_status \<\> 'sent' OR (sent\_at IS NOT NULL AND evidence\_ref IS NOT NULL)),  
  CHECK (notification\_status \<\> 'not\_required' OR notification\_required \= false),  
  \-- RB-06D-V1-13 (R2 B1): CHECK is structural-only. The temporal rule (only legal to enter missed\_deadline once clock\_timestamp() \> deadline\_at) is owned by transition\_privacy\_regulator\_notification\_state (§11.3.2) and re-verified by ops/privacy-incident-conformance (§11.5). CHECK constraints cannot reference now() safely — they evaluate on INSERT/UPDATE only, not continuously, and would make row validity depend on wall-clock time. Structural invariant: missed\_deadline requires deadline\_at set and sent\_at NULL; the "deadline actually elapsed" check is enforced by the RPC at transition time.  
  CHECK (notification\_status \<\> 'missed\_deadline' OR (deadline\_at IS NOT NULL AND sent\_at IS NULL))  
);  
CREATE INDEX idx\_privacy\_regulator\_notif\_incident  
  ON privacy\_regulator\_notifications (incident\_id);  
CREATE INDEX idx\_privacy\_regulator\_notif\_deadline  
  ON privacy\_regulator\_notifications (deadline\_at)  
  WHERE notification\_status IN ('pending','missed\_deadline');

One incident may produce **multiple** regulator notifications (e.g., a multi-jurisdiction breach triggers EU GDPR \+ UK ICO \+ state AGs separately). Each row is one regulator × one incident. The status enum encodes the lifecycle:

* `not_required` — jurisdiction analysis concluded no notification obligation; terminal.  
* `pending` — required; not yet sent. Reconciled against `deadline_at`.  
* `sent` — required; sent within deadline. `sent_at` and `evidence_ref` populated; terminal.  
* `missed_deadline` — required; deadline elapsed without `sent`. Terminal — the missed-deadline state is preserved permanently for audit. A subsequent send (if it occurs) is recorded via a new row with status `sent` referencing the same incident.

## **11.3.2 Validated write paths for regulator notifications**

record\_privacy\_regulator\_notification(  
  p\_incident\_id           text,  
  p\_regulator             text,  
  p\_notification\_required boolean,  
  p\_deadline\_at           timestamptz DEFAULT NULL  
) RETURNS uuid

transition\_privacy\_regulator\_notification\_state(  
  p\_notification\_id  uuid,  
  p\_to\_state         text,  
  p\_actor\_user\_id    uuid,  
  p\_sent\_at          timestamptz DEFAULT NULL,  
  p\_evidence\_ref     text DEFAULT NULL  
) RETURNS void

Legal transitions for `transition_privacy_regulator_notification_state`:

pending  → sent              (requires sent\_at, evidence\_ref; sent\_at MUST be \<= deadline\_at to satisfy compliance)  
pending  → missed\_deadline   (only callable by the §11.5 conformance job after clock\_timestamp() \> deadline\_at AND sent\_at IS NULL; the RPC enforces both preconditions before transition; no other caller is permitted)  
pending  → not\_required      (jurisdiction analysis re-evaluation; requires actor with compliance-review role)

**RB-06D-V1-13 temporal-ownership note (R2 B1):** the relational substrate's CHECK constraints are structural-only — they verify field-presence invariants (e.g., `missed_deadline` requires `deadline_at IS NOT NULL AND sent_at IS NULL`) but NEVER reference `now()` / `clock_timestamp()`, because CHECK constraints evaluate on INSERT/UPDATE only and a time-referencing CHECK would make row validity depend on wall-clock time. The temporal rule ("deadline has actually elapsed") lives in the transition RPC: the `pending → missed_deadline` transition is rejected by the RPC unless `clock_timestamp() > deadline_at AND sent_at IS NULL` at call time. The §11.5 conformance job is the sole authorized caller and observes its own time check before invocation. This separation keeps the lifecycle ownership deterministic and avoids schema-time drift.

`sent`, `missed_deadline`, and `not_required` are terminal — no further transitions from these states. Direct UPDATE to `notification_status` from application code is forbidden. The §10.4 RPC-discipline pattern (06C P16) is applied identically here.

## **11.4 Postmortem extension (Doc 06C §10.5 extension for privacy class)**

A privacy-class incident's postmortem (06C §10.5) MUST include — in addition to 06C's required sections — a **"Privacy / compliance attachment"** section containing:

* The `incident_privacy_class_attachments` row content (or a structured equivalent).  
* The list of affected compliance gates (CGATE-\* refs) — each one identified.  
* A **structured reference to the `privacy_regulator_notifications` rows for this incident** (regulator \+ status \+ deadline \+ sent\_at \+ evidence\_ref). The postmortem may *describe* these for readability; the **canonical proof source is the table**, NOT the postmortem prose (RB-06D-V1-04).  
* The data-protection-officer (DPO) sign-off if any `privacy_regulator_notifications.notification_required = true`.

This extension is enforced by §11.5 below. 06C §10.5 is unchanged; 06D adds the privacy-class sub-section requirement.

## **11.5 Proving mechanism — `ops/privacy-incident-conformance` (Parent §6.13) — RB-06D-V1-04 corrected**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled reconciliation job (Vercel Cron); registered in 06C §8.2 as `JOB-PRIVACY-INCIDENT-CONFORMANCE` with external\_watchdog per 06C §8.7 |
| Trigger cadence | Daily |
| Input registry | `incidents` rows where `severity = 'Page'` \+ `incident_privacy_class_attachments` \+ `privacy_regulator_notifications` (canonical source for notification status — RB-06D-V1-04) \+ `docs/postmortems/INC-*.md` filesystem listing (consulted only for the §11.4 extension-section presence check, NOT for notification-status determination) |
| Failure condition (RB-06D-V1-04 corrected) | (a) any `incidents` row triggered by an alert with `source_class = 'doc03c_failure_class'` AND `source_ref.section = '§28.7'` (privacy/anti-leak) with no `incident_privacy_class_attachments` row — Page (privacy incident not classified); (b) **notification-status reconciliation against the table, NOT postmortem prose:** any `privacy_regulator_notifications` row with `notification_status = 'pending'` AND `deadline_at < now()` — Page (regulator deadline breached). The conformance job, on detecting this, automatically calls `transition_privacy_regulator_notification_state(p_to_state := 'missed_deadline')` to preserve the breach state in audit (the job is the sole authorized caller of that transition); (c) any `privacy_regulator_notifications` row with `notification_status = 'pending'` AND `deadline_at - now() < 24h` — Page (notification deadline approaching; preempt the breach); (d) any incident with a privacy-class attachment whose postmortem document (06C §10.5 file) does not contain a "Privacy / compliance attachment" section — Page (postmortem extension missing); (e) any privacy-class incident whose `affected_compliance_gates[]` entries do not resolve in 06D's compliance-gate registry — Warn (registry drift); (f) any `privacy_regulator_notifications` row with `notification_status = 'sent'` where `sent_at > deadline_at` — Page (sent after deadline; the row should never have reached `sent` per the transition rule but reconciliation catches drift from out-of-band updates) |
| Proof artifact | `privacy-incident-conformance` record per Parent §10.5 \+ extras (§14): `privacy_incidents_checked[]`, per-incident `{incident_id, pii_exposure_scope, affected_compliance_gates, regulator_notifications: [{regulator, notification_status, deadline_at, sent_at_relative_to_deadline, evidence_ref_present_bool}], postmortem_extension_check, decision}`. **Subject to §8.7 no-PII rule** — `evidence_ref` is included as a hash/path reference only; raw notification content is never in the proof artifact. |
| Owner / paging | Founder \+ ops-lead; per 06C §11 unified rotation |

---

# **§12 — Anonymization Standard (Joint with 06A INV-06-03)**

## **12.1 Scope and joint-ownership boundary**

INV-06-03 (no production data in lower environments without anonymization) is jointly owned by 06A and 06D per Parent §11.3. 06A owns the *scan that detects production data* (`ops/lower-env-data-provenance-scan`); 06D owns the *anonymization standard the scan checks against* (`infra/anonymization-standard.yaml`). When 06A's scan finds a field in a lower environment, it consults 06D's standard to determine whether the field is properly anonymized; a non-matching field is a `LOWER_ENV_PROD_DATA_DETECTED` finding.

01A §14 redaction is for *write-time logs/observability*. 06D anonymization is for *data copies into lower environments*. These are distinct operations with distinct rules; 06D references but does not restate 01A §14.

## **12.2 Standard — `infra/anonymization-standard.yaml`**

fields:  
  \- canonical\_field\_name: \<fully-qualified field, e.g. 'profiles.email'\>  
    pii\_classification\_reference: \<e.g. '01A §14' | 'Doc 01 V6 §19'\>     \# references canonical owner; does not restate the classification  
    anonymization\_pattern: \<pattern specification — see §12.3\>  
    reversibility: \<irreversible | reversible\_with\_key | not\_anonymized\_keep\_for\_test\>  
    applies\_to\_environments: \[\<list of lower envs this rule covers\>\]      \# e.g. \['development','staging','preview'\]  
    rationale: \<one-line explanation, especially for not\_anonymized\_keep\_for\_test\>

## **12.3 Anonymization patterns (06D-owned vocabulary)**

| Pattern keyword | Meaning | Example |
| ----- | ----- | ----- |
| `random_email_at_test_domain` | Replace with `<random8>@anonymized.lyceon.test`; no recoverable identity | `alice@example.com` → `k3mp9xq2@anonymized.lyceon.test` |
| `random_token_n<bytes>` | Replace with a random N-byte token; no recoverable identity | `random_token_n8` for short name fields |
| `zero_phone` | Replace with `+00000000000` | phone numbers |
| `zero_ip` | Replace with `0.0.0.0` (consistent with 01A §14 write-time IP truncation reference) | IPs in non-log fields |
| `year_bucket_dob` | Replace DOB with first-day-of-year (year preserved, day/month removed) | `2008-03-15` → `2008-01-01` |
| `null_field` | Replace with NULL | for fields not needed in lower envs |
| `passthrough_synthetic` | Replace with a deterministic synthetic value generated from a seed | for test-data continuity needs |

`reversibility`:

* `irreversible` — no key, no salt, the anonymization output cannot be reversed even with maximum prior context. This is the default and required for fields classified as PII.  
* `reversible_with_key` — anonymization is reversible by an offline key held only by Platform/CTO. Permitted only for non-PII operational fields where test-environment reproducibility requires it. Each `reversible_with_key` entry requires a `rationale` and an exception approval via the §10 compliance-gate registry.  
* `not_anonymized_keep_for_test` — explicit non-PII operational field kept verbatim in lower envs. Requires `rationale`. P12 audit (06C precedent) checks no field marked `not_anonymized_keep_for_test` is classified PII by its canonical owner.

## **12.4 Hard rules**

1. **Canonical-owner consistency.** A field's `pii_classification_reference` MUST point to a canonical owner that actually classifies the field as PII (when `reversibility = irreversible`) or operational (when `not_anonymized_keep_for_test`). Misclassification is a `DD-06-REDEF` defect.  
2. **No restating PII classification.** 06D's standard names the field's *anonymization pattern* and *reversibility*; it does NOT restate why the field is PII. That body stays at the canonical owner.  
3. **Lower environments enumerated.** `applies_to_environments` MUST contain at least one of `{development, staging, preview}` per 06A's environment matrix; production is never an `applies_to_environments` entry (production data is not anonymized; the anonymization standard targets copies *into* lower envs).

## **12.5 Proving mechanism — `ci/anonymization-standard-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, on PRs touching `infra/anonymization-standard.yaml` or any referenced canonical owner doc; plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/anonymization-standard.yaml` \+ parsed 01A §14 PII field index \+ parsed Doc 01 V6 §19 `deidentify_user` target field list \+ 06A environment matrix (`infra/environments.yaml` referenced — 06A §7) \+ 06D compliance-gate registry (for `reversible_with_key` exception approvals) |
| Failure condition | (a) any field in 01A §14 / Doc 01 V6 §19 PII inventory absent from the standard; (b) any field with `reversibility = irreversible` whose `pii_classification_reference` does not resolve to a PII classification at the canonical owner; (c) any field with `reversibility = reversible_with_key` without an approved compliance-gate exception in the §10 registry; (d) any `applies_to_environments` containing `'production'` — Page (anonymization standard mis-targeted); (e) any pattern keyword outside the §12.3 vocabulary; (f) any field with `reversibility = not_anonymized_keep_for_test` whose canonical owner classifies it as PII — Page |
| Proof artifact | `anonymization-standard-parity` record per Parent §10.5 \+ extras (§14): `fields_checked[]`, per-field `{canonical_field_name, classification_resolution, pattern_check, reversibility_check, environment_scope_check, exception_check_if_reversible, decision}` |
| Owner / paging | Platform/CTO; PR-blocking |

## **12.6 06A consumer wiring**

06A's `ops/lower-env-data-provenance-scan` consumes `infra/anonymization-standard.yaml` to determine whether a detected field is properly anonymized. 06D does not modify 06A's scan; the scan reads 06D's standard at run time. The 06D / 06A seam is data-driven, not code-coupled.

---

# **§13 — Audit-Archival Surface (Partial-Provable per FWD-06-02)**

## **13.1 Scope**

Audit logs (events emitted via 01A §15 metrics \+ 01A §19 log sinks, plus the deletion-action audit events emitted into 06B §8 privileged-op audit substrate, plus the incident-lifecycle audit in 06C §10) accumulate over time. They require their own retention treatment: long enough to satisfy regulatory inquiry windows (typically 1–7 years jurisdiction-dependent), short enough to honor user-deletion obligations under GDPR/CCPA/COPPA.

## **13.2 V1 status — partial-provable**

Doc 01 V8 §5.1 owns the canonical body of the audit-retention rules (extending V6's audit\_logs surface). V8 §5.1 also specifies the "PII in logs transitions to domain-only after 90 days" rule (per Parent §11.3 reference and 01A §19 reference). Until V8 lands, audit-archival is **partial-provable** under FWD-06-02 — 06D registers the audit-archival surface in §9 retention policy registry as a single forward-ref entry:

retention\_policies:  
  \- policy\_id: RPOL-AUDIT-01  
    pii\_surface\_name: 'audit\_logs.user\_context'                       \# generic; V8 will refine  
    canonical\_owner\_doc\_and\_section: 'Doc 01 V8 §5.1 (FWD-06-02)'  
    classification: pii  
    retention\_horizon\_seconds: null                                    \# populated when V8 lands; null permitted because partial\_provable\_until is set (RB-06D-V1-12)  
    partial\_provable\_until: FWD-06-02                                  \# RB-06D-V1-12: explicit forward-ref token. ci/retention-policy-registry-parity (§9.3) AND ops/retention-policy-conformance (§9.4) skip numeric enforcement for this row until the forward-ref closes.  
    purge\_substrate: scheduled\_job                                     \# confirmed at V8  
    purge\_lag\_allowance\_seconds: null                                  \# populated when V8 lands; null permitted under partial\_provable\_until  
    purge\_alert\_id: ALERT-DATA-AUDIT-01  
    out\_of\_scope: false  
    last\_reviewed\_at: 2026-05-21

The `ci/retention-policy-registry-parity` mechanism (§9.3 RB-06D-V1-12) recognizes the explicit `partial_provable_until: FWD-06-02` token, skips the "retention\_horizon\_seconds IS NOT NULL" requirement for this row, and reports the row as `partial_provable_skipped` in the proof artifact. On V8 upload, the entry is reconciled to concrete `retention_horizon_seconds` \+ `purge_lag_allowance_seconds` values (Tier-1 06D cleanup), `partial_provable_until` is set to null, and the mechanism's check becomes fully enforceable.

## **13.3 What 06D does NOT own at V1**

The audit-retention rules themselves (90-day domain-only transition, archival cron schedule, deletion-correlation for user-initiated deletion of audit-correlated rows) are V8 §5.1 body. 06D registers the surface and the FWD-06-02 cite-path; 06D does not state the retention horizon. The §13.2 entry above is a placeholder, not a body.

---

# **§14 — Per-Mechanism Envelope Extras (Parent §10.5.1 Extension) — Updated CR-06D-04**

The Parent §10.5 envelope is canonical; this section extends the §10.5.1 per-mechanism extra-field matrix with 06D's mechanisms. Updated under CR-06D-04 to reflect schema/cleanup changes from RB-06D-V1-02 (split substrate metrics), RB-06D-V1-04 (regulator notification table), RB-06D-V1-07 (commit\_sha \+ file\_sha256), RB-06D-V1-08 (aborted age), RB-06D-V1-12 (partial\_provable token). **All artifacts are subject to the §8.7 no-PII rule (RB-06D-V1-10).**

| Mechanism | Required extra fields |
| ----- | ----- |
| `ops/deletion-proof-conformance` (§6.5) | `deletions_checked[]`, per-deletion `{deletion_request_id, verification_outcome, layers_verified_summary: {identity, mastery, lisa, analytics}, proof_manifest_ref, lag_to_t_plus_7_seconds}` |
| `ops/restore-test` (§8.5) | per-run `{run_id, trigger_reason, triggering_migration_id, started_at, completed_at, outcome, rpo_observed_seconds, rto_observed_seconds, pitr_retention_window_seconds, latest_recoverable_point_lag_seconds, integrity_checks_passed_summary: {schema_presence_ok, fk_violations_count, row_count_failures, canary_misses}, proof_manifest_ref, target_breach: bool, aborted_age_hours_if_applicable: int}` |
| `ci/restore-test-recency` (§8.6) | `most_recent_baseline_pass_age_days`, `deploying_migration_data_impact`, `pre_apply_backup_proof_ref` (or null if not required), `prior_data_impact_test_status: {in_progress_count, fail_count, aborted_count, pending_remediation[]}`, \`decision: allow |
| `ci/retention-policy-registry-parity` (§9.3) | `policies_checked[]`, per-policy `{policy_id, pii_surface_name, canonical_owner_resolution, alert_link_check, last_reviewed_age_days, out_of_scope, partial_provable_until_token_if_any, purge_lag_allowance_check, decision}`, `canonical_pii_surfaces_inventory_check: {sources_parsed[], surfaces_required, surfaces_present, surfaces_missing[]}` |
| `ops/retention-policy-conformance` (§9.4) | `policies_checked[]`, per-policy `{policy_id, purge_substrate, partial_provable_until_token_if_any, last_observed_purge_at, retention_horizon_seconds, purge_lag_allowance_seconds, lag_seconds, source_independent_check: bool, decision}` |
| `ci/compliance-gate-registry-parity` (§10.7) | `gates_checked[]`, per-gate `{gate_id, rule_canonical_owner_resolution, evidence_path_existence, evidence_shape_check, release_gate_bridge_check, registry_substrate_alignment, evidence_commit_sha_present_if_approved: bool, evidence_file_sha256_present_if_approved: bool, decision}` |
| `ops/compliance-gate-evidence-conformance` (§10.8) | per-active-evidence `{gate_id, evidence_id, current_state, days_since_submission, days_to_expiry, expiry_job_recent_activity}` |
| `ops/privacy-incident-conformance` (§11.5) | `privacy_incidents_checked[]`, per-incident `{incident_id, pii_exposure_scope, affected_compliance_gates, regulator_notifications: [{regulator, notification_status, deadline_at, sent_at_relative_to_deadline, evidence_ref_present_bool}], postmortem_extension_check, decision}` |
| `ci/anonymization-standard-parity` (§12.5) | `fields_checked[]`, per-field `{canonical_field_name, classification_resolution, pattern_check, reversibility_check, environment_scope_check, exception_check_if_reversible, decision}` |

---

# **§15 — Cross-Document Seam Table (Grounded by Exact §)**

| Seam | 06D side | Canonical owner \+ exact § | Reconciliation status |
| ----- | ----- | ----- | ----- |
| PII redaction (write-time logs) | §9 (registry references), §12 (anonymization standard references) | 01A §14 | RESOLVED — referenced |
| Log sinks \+ retention | §9, §13 | 01A §19 | RESOLVED |
| Metrics emission \+ correlation IDs | All mechanism artifacts | 01A §15, §17 | RESOLVED |
| Alert routing tiers (Page / Warn / Info) | All §6.1.5 / §6.1.7 alert classes | 01A §18 (via 06C §6 crosswalk) | RESOLVED |
| Account-deletion lifecycle | §5, §6 (consumed entirely; 06D adds proof wrapper) | Doc 01 V6 §19 — Account Deletion and Soft-Delete Lifecycle | RESOLVED — V6 canonical body |
| Profile canonical writer (`deidentify_user`, `finalizeDeletion`) | §6.2 single-writer governance | Doc 01 V6 — Profile Canonical Writer | RESOLVED |
| V8 user-deletion / PII-retention / support-mediated audit extensions | §13 audit-archival surface partial-provable | Doc 01 V8 §40.5 / §5.1 / §44 / Appendix E — **FWD-06-02** | OPEN — bounded |
| Mastery/projection deletion cascade | §6 layers\_verified `mastery` layer | Doc 05D §10 \+ §11 — **FWD-06-04** (cited per project handoff record per §3.5) | OPEN — bounded |
| Doc 05D `BLOCKING_PRIVACY_GAP` first canonical compliance gate | §10 registry `CGATE-PRIVACY-01` | Doc 05D §11.2 (cited per project handoff record) | OPEN — bounded; first registered gate |
| LISA Data Retention Matrix (10 LISA tables) | §9 registry placeholder entries | Doc 03 Main §14.2 (cited per project handoff record per §3.4) | OPEN — bounded; §3.4 cite-path |
| LISA privacy/anti-leak failure class | §11.5 incident-trigger source class | Doc 03C §28.7 | RESOLVED |
| Doc 06A `data_impact` enum | §8.2 restore-test trigger | Doc 06A §11.3 RB-06A-V1-06 | RESOLVED — consumer |
| Doc 06A release-gate manifest schema | §10.6 bridge | Doc 06A §10 (`infra/release-gates.yaml`) | RESOLVED — consumer |
| Doc 06A `ci/release-gates` enforcement runtime | §10.6 bridge | Doc 06A §10.4 | RESOLVED — consumer |
| Doc 06A `lower-env-data-provenance-scan` body (INV-06-03 joint) | §12 anonymization standard (06A consumes) | Doc 06A §8 | RESOLVED — joint |
| Doc 06A environment matrix | §12.4 hard rule (lower-env scope) | Doc 06A §7 | RESOLVED |
| Doc 06A backup infrastructure topology (informational) | §7.1 substrate identification | Doc 06A §15 | RESOLVED |
| Doc 06B privileged-op audit substrate | §6.5 deletion-action audit consumed (T+7 hard-delete is a privileged op) | Doc 06B §8 \+ §8.6 source registry | RESOLVED — consumer |
| Doc 06C scheduled-job heartbeat substrate | §8 `ops/restore-test` \+ §9.4 retention \+ §10.8 compliance evidence registered as scheduled jobs | Doc 06C §8 (`infra/scheduled-job-registry.yaml` \+ heartbeat table) | RESOLVED — consumer |
| Doc 06C scheduled-job external\_watchdog discipline | §9.4 \+ §10.8 \+ §11.5 registered jobs carry external\_watchdog blocks | Doc 06C §8.7 (RB-06C-V1-01) | RESOLVED — applied |
| Doc 06C incident lifecycle (base `incidents` table \+ transition RPC) | §11 privacy-class sidecar attaches to incidents | Doc 06C §10 (`incidents`, `incident_phase_transitions`, `transition_incident_phase`) | RESOLVED — consumer |
| Doc 06C alert-registry \+ severity crosswalk | §7.4, §11.5 alert IDs registered | Doc 06C §7 \+ §6 | RESOLVED — consumer |
| Doc 06C postmortem document shape (privacy-class extension) | §11.4 extension | Doc 06C §10.5 | RESOLVED — extender |
| Doc 06C alert-registry / severity-crosswalk source\_class enum (RB-06D-V1-03) | §7.4 alerts \+ every 06D-owned alert ID requires `source_class = doc06d_event` extension | Doc 06C §6 \+ §7 — **CR-06C-05 post-lock additive required** | OPEN — bounded (W8); 06D ships with the additive obligation declared; 06C-owner applies RB-06C-V1-16 in-lock-cycle |
| Privacy regulator notifications relational substrate (RB-06D-V1-04) | §11.3.1 `privacy_regulator_notifications` table \+ state-machine \+ transition RPC; §11.5 reconciles against the table, not postmortem prose | 06D-owned (sidecar to 06C `incidents`) | RESOLVED |
| Parent §10.5 envelope | §14 \+ every proving mechanism | Doc 06 Parent §10.5 / 06A §10.5.1 | RESOLVED — extended in §14 |
| Parent §14 compliance-gates-are-deploy-gates doctrine | §10 body | Doc 06 Parent §14 | RESOLVED — 06D is the body |
| Parent §11.3 INV-06-03 production-data canonical definition | §12 anonymization standard targets this scope | Doc 06 Parent §11.3 | RESOLVED |
| Doc 07 analytics retention | §6.3 layers\_verified `analytics` out\_of\_scope; §9 registry analytics entries out\_of\_scope | Doc 07 (not drafted) — **FWD-06-01** | OPEN — bounded |

---

# **§16 — Audit Profile**

Inherits Parent §17 six passes \+ 06A-specific passes (03C-boundary, registry-schema-completeness) \+ 06B-specific passes (primitive-body-restatement detection, audit-substrate exhaustiveness) \+ 06C-specific passes P13–P18 (self-monitoring watchdog, schema-completeness, registry-canonical, state-machine RPC, text-FK validated write path, external-fetch failure semantics). Plus four 06D-specific passes (P21 \+ P22 added/extended under CR-06D-04):

* **06D P19 — Retention-coverage exhaustiveness.** Every PII surface named in the parseable canonical sources (01A §14, Doc 01 V6 §19's `deidentify_user` target list) MUST appear in `infra/retention-policy-registry.yaml`, OR be explicitly `out_of_scope: true` with `out_of_scope_reason`. Non-parseable canonical sources (Doc 03 Main §14.2, Doc 05D §10) report `cited_per_project_handoff_record` and partial-provability per §3.4/§3.5. Implemented as `ci/retention-policy-registry-parity` (§9.3); the audit pass verifies the mechanism's coverage check is configured against the right sources.  
* **06D P20 — Compliance-gate registry parity.** Every registered compliance gate has (a) a `rule_canonical_owner` citation that resolves (against parseable sources, or `cited_per_project_handoff_record` for non-parseable); (b) an `evidence_file_shape` spec; (c) a matching `release_gate_entry_ref` in 06A's `infra/release-gates.yaml`. Implemented as `ci/compliance-gate-registry-parity` (§10.7); the audit pass verifies the mechanism's failure conditions cover all three checks.  
* **06D P21 — Deletion-cascade reference exhaustiveness.** Any 06D-defined deletion-related proof MUST reference all four documented deletion layers (identity per Doc 01 V6 §19; mastery per Doc 05D §10; LISA per Doc 03 Main §14.2; analytics per Doc 07 FWD-06-01) — explicitly verified or explicitly `out_of_scope` with reason. Implemented as the §6.3 layer-coverage shape and verified by `ops/deletion-proof-conformance` (§6.5); the audit pass verifies the `layers_verified` shape is enforced.  
* **06D P22 — No-PII proof-artifact conformance (CR-06D-04 / RB-06D-V1-10).** Every 06D proof-artifact schema defined in §14 MUST conform to the §8.7 no-PII rule: only permitted field types (opaque IDs, aggregate counts, decision enums, hash digests of identifiers with proof-run-local salt, decision-boolean flags) appear in artifact schemas. Forbidden fields (raw email, name, phone, DOB, address, access token, full user\_id, raw SQL result rows, raw RAG payloads, full-resolution audit-log bodies) are absent. Implemented as a static-analysis check over the §14 matrix; the audit pass enforces the §8.7 rule mechanically across the family.

Known false-positive class (carry-over from 06A/06B/06C \+ 06D-specific): doc titles containing flagged words; the §15 seam table (cites bodies — required, not restatement); SQL CHECK constraint values for relational substrate vocabulary (`identifier_only` / `identifier_plus_content` / `data_impact_migration` / `monthly_baseline`); the §21 cleanup register's SWE review-severity vocabulary (`BLOCKER` / `HIGH` / `MEDIUM`), distinct from the alert-routing severity vocabulary; the §12.3 anonymization pattern keywords (`random_email_at_test_domain` etc.) which are 06D-owned vocabulary, not restatements.

---

# **§17 — Open Items & Watch List**

| ID | Item | Status / handling |
| ----- | ----- | ----- |
| **W1** | Doc 01 V8 §40.5 / §5.1 / §44 / Appendix E retention/audit/support-access extensions (FWD-06-02) | Bounded; §13 audit-archival surface registered as `partial_provable_until_v8`; §6 deletion proof harness covers V6 surface today; on V8 upload, reconciliation applied as a Tier-1 06D cleanup. Non-blocking for spec-lock. |
| **W2** | Doc 07 analytics retention surface (FWD-06-01) | Bounded; §6.3 `analytics` layer registered as `out_of_scope: true` with `out_of_scope_reason: 'pending Doc 07'`; §9 registry contains analytics placeholders flagged accordingly. Reconciled on Doc 07 draft. Non-blocking. |
| **W3** | Doc 03 Main not in source tree at draft time (§3.4) | Continued from 06C §3.4. LISA retention matrix references made per project handoff record. Audit P3 (citation parity) reports the cite-path. Reconciled on Doc 03 Main upload. Non-blocking. |
| **W4** | Doc 05D not in source tree at draft time (§3.5) — **new sanctioned FWD-06-04** | New cite-path same pattern as W3. Doc 05D §10 cascade \+ §11 D20/D21 tests \+ INV-05D-15 audit append-only rule \+ `BLOCKING_PRIVACY_GAP` first canonical compliance gate are referenced per project handoff record. Reconciled on Doc 05D upload. Non-blocking. |
| **W5** | Subsystem stricter RPO/RTO targets (e.g. Doc 04B exam scoring) | Parent §3 explicit consumer-stricter pattern. §7.2 platform target stated; subsystem-stricter targets are referenced from their owning docs as they declare them (not from 06D). No-op until a subsystem declares one. Non-blocking. |
| **W6** | Doc 01 V6 → V8 retention surface reconciliation | V6 §19 is canonical for the deletion-lifecycle body. V8 §5.1 will extend retention semantics (per Parent §11.3 references). When V8 lands, §13 audit-archival entry is reconciled (Tier-1 06D cleanup) and any §9 retention policies whose `canonical_owner_doc_and_section` cites V6 are checked against V8 for divergence. Bounded; no-op meanwhile. Non-blocking. |
| **W7** | Cross-jurisdictional compliance gates (COPPA / GDPR / state) | The compliance brief (project memory) covers COPPA 2025 amended rule (April 2026 deadline), GDPR/UK GDPR Children's Code, India DPDP, Brazil Digital ECA, CCPA/CPRA. As each gate is formalized, it registers in §10 `infra/compliance-gate-registry.yaml`. V1 ships with one gate (`CGATE-PRIVACY-01` for Doc 05D `BLOCKING_PRIVACY_GAP`); jurisdiction-specific gates land per the launch-sequence brief. Non-blocking — registry capacity is unlimited. |
| **W8** (new — RB-06D-V1-03) | **06C post-lock additive required (CR-06C-05) — `doc06d_event` source\_class enum extension \+ 06D event rows in severity-crosswalk and alert-registry.** | 06D introduces a new alert source class (`source_class = doc06d_event`) used by `ALERT-DATA-01` (RPO breach), `ALERT-DATA-02` (PITR coverage breach), and the alert IDs referenced by §6.5 / §9.4 / §10.8 / §11.5 / §12.5. Locked 06C's `infra/alert-registry.yaml` source\_class enum and `infra/severity-crosswalk-registry.yaml` event rows do not yet include this class — `ci/alert-runbook-parity` (06C-owned) will reject 06D alerts until extended. Required CR-06C-05 additive items: (a) extend alert-registry source\_class enum with `doc06d_event`; (b) extend severity-crosswalk registry rows for 06D-owned events: restore-test failure (`ALERT-DATA-01` RPO, `ALERT-DATA-02` PITR-coverage, restore-test outcome=fail, restore-test aborted-stale), deletion-proof failure (deletion-verification mismatch, deletion-verification stuck), retention-policy breach (purge stall, T+7 stuck, manual-purge missing), compliance-gate evidence (approval expired, under-review stuck, pending stale), privacy-incident notification-deadline breach, anonymization-standard-parity failure. Coordinates: this is the **single required 06C post-lock additive** carried by 06D; tracked as W8 in 06D and as CR-06C-05 in 06C (06C-owner applies post-lock cleanup pass in-lock-cycle as `RB-06C-V1-16` per 06C §21 register pattern). **Non-blocking for 06D spec-lock** because the seam is a cross-doc registry extension, not a 06D internal defect; both docs lock with the additive obligation declared explicitly. 06D deploy is gated on the additive landing — recorded as a deploy gate per §18 acceptance criterion 18 below. |

None of W1–W8 block 06D spec-lock.

---

# **§18 — Acceptance Criteria (Executable-Proof Framed)**

Per the Doc 06A §19 / 06B §18 / 06C §18 split (A/B/C).

## **A — 06D-owned criteria**

1. `ops/deletion-proof-conformance` fails on any `account_deletion_requests.status = 'completed'` in past 14 days with no matching `deletion_verification_records` row; any `verification_outcome = 'fail'`; any `in_progress` row \> 1 hour; any `pass` row with missing in-scope layer verification or NULL `proof_manifest_ref` (§6.5).  
2. **`ops/restore-test` fails on (RB-06D-V1-02 corrected):** any `outcome = 'fail'`; any `in_progress` \> 4 hours (RTO target); **`latest_recoverable_point_lag_seconds > 900` (RPO check on lag, NOT retention window)**; `pitr_retention_window_seconds < configured_min_retention_window_seconds` (PITR coverage check); observed RPO \> 900 OR observed RTO \> 14400 in a `pass` row; integrity-check failures per §8.3.1 shape; monthly\_baseline cadence breach \> 35 days. **Aborted-state escalation (RB-06D-V1-08):** any `outcome = 'aborted'` older than 24 hours without subsequent pass escalates Warn → Page; data-impact-migration aborted blocks subsequent deploys per §8.6 (§8.5).  
3. **`ci/restore-test-recency` fails (deploy-blocking, RB-06D-V1-01 corrected) on (1)** monthly\_baseline pass older than 35 days; **(2)** data-impact PR missing 06A pre-apply backup proof; **(3)** any prior `data_impact_migration` row in `in_progress` \>4h / `fail` / stale `aborted` / `pass` missing required §8.3.1 \+ RPO-lag \+ manifest fields. Gate does NOT require the current PR's own data\_impact\_migration restore-test pass (impossible pre-deploy). The current PR's post-deploy restore-test gates the NEXT deploy (§8.6).  
4. **`ci/retention-policy-registry-parity` fails (RB-06D-V1-05 \+ RB-06D-V1-12) on:** any 01A §14 / Doc 01 V6 §19 PII surface absent from the registry (audit P19); any `canonical_owner_doc_and_section` not resolving; any `purge_alert_id` not in 06C alert-registry; any `out_of_scope: true` without reason; any `last_reviewed_at` \> 180 days; any `manual` purge\_substrate without a paging alert; **any policy with `retention_horizon_seconds IS NOT NULL` AND `purge_lag_allowance_seconds IS NULL`** (lag-allowance mandatory when horizon is set); **any policy with `retention_horizon_seconds IS NULL` AND `partial_provable_until IS NULL`** (null horizon permitted only under explicit forward-ref); conversely both fields populated together (mutually exclusive) (§9.3).  
5. **`ops/retention-policy-conformance` fails (RB-06D-V1-05 \+ RB-06D-V1-12) on:** for each policy where `partial_provable_until IS NULL` AND `purge_substrate ∈ {pg_cron, scheduled_job, doc01v6_t_plus_7, doc03_lisa_cron, doc05d_cascade}`, most recent observed purge older than `retention_horizon_seconds + purge_lag_allowance_seconds` (per-policy allowance owned by the canonical owner — replaces the prior global 7-day grace); partial-provable rows are skipped from numeric checks and reported as `partial_provable_skipped`; T+7 deletion stuck \> 24 hours; 05D D20/D21 stale \> 30 days. **Independent source rule (06B §8.6 precedent):** purge-observation source MUST be the substrate's native run-record table, NEVER the same table the policy itself purges (§9.4).  
6. **`ci/compliance-gate-registry-parity` fails (RB-06D-V1-07 corrected) on:** any `gate_id` not in 06A `infra/release-gates.yaml`; any `rule_canonical_owner` not resolving; any `evidence_path` whose file does not exist in the repo (CI-owned check, not RPC-owned); any `evidence_file_shape.sections` missing from the actual evidence document; any registry-substrate state drift; any `last_reviewed_at` \> 180 days; **any `current_state ∈ {'approved','expired'}` row with NULL `evidence_commit_sha` OR NULL `evidence_file_sha256`** (durable identity required for approved/expired evidence per RB-06D-V1-07) (§10.7).  
7. `ops/compliance-gate-evidence-conformance` fails on any `approved` row past `approval_window_expires_at` not yet `expired` (expiry-job failing); any `under_review` \> 14 days; `pending` \> 7 days (Warn); expiry-job inactivity Warn (§10.8).  
8. **`ops/privacy-incident-conformance` fails (RB-06D-V1-04 corrected) on:** any incident triggered by `doc03c_failure_class § 28.7` with no privacy-class attachment; **any `privacy_regulator_notifications` row with `notification_status = 'pending'` AND `deadline_at < now()`** (regulator deadline breached — reconciled against the relational substrate, NOT postmortem prose); pending notification with deadline within 24 hours; any privacy postmortem missing the §11.4 extension section; affected\_compliance\_gates not resolving (§11.5).  
9. `ci/anonymization-standard-parity` fails on any 01A §14 / Doc 01 V6 §19 PII field absent from the standard; any `reversibility = irreversible` whose classification does not resolve to PII at the owner; any `reversible_with_key` without compliance-gate exception; any `applies_to_environments` containing `production` (Page); any field with `not_anonymized_keep_for_test` classified as PII by canonical owner (Page) (§12.5).  
10. **State-machine RPC discipline applied (RB-06D-V1-06 corrected):** `transition_compliance_gate_evidence_state` is the only path to update `compliance_gate_evidence.current_state`; **`rejected` and `expired` are TERMINAL states** for the originating evidence row; re-submission is a NEW row via `record_compliance_gate_evidence_submission()` (an INSERT, not a transition). `transition_privacy_regulator_notification_state` enforces the privacy-notification state machine identically.  
11. **Text-FK validated write paths applied:** `record_deletion_verification`, `record_restore_test_run`, `record_compliance_gate_evidence_submission`, `populate_compliance_evidence_artifact_identity` (RB-06D-V1-07), `attach_privacy_class_to_incident`, `record_privacy_regulator_notification` (RB-06D-V1-04) are the only paths to INSERT/UPDATE their respective tables; direct INSERT/UPDATE forbidden per 06C P17 discipline.  
12. Every 06D proof artifact conforms to Parent §10.5 envelope \+ §14 per-mechanism extras; an artifact missing any common-envelope field or its mechanism-specific extras is a `DD-06-PROOF` defect. **No-PII rule (§8.7 / RB-06D-V1-10):** every artifact contains only opaque IDs, aggregate counts, decision enums, hash digests with proof-run-local salt, or boolean flags — never raw PII or raw content. Enforced by audit pass P22.

## **B — Cross-doc gate-body criteria (06D's slice only)**

13. **INV-06-03 (no prod data in lower envs) joint with 06A:** 06D provides `infra/anonymization-standard.yaml` (§12.2) \+ `ci/anonymization-standard-parity` (§12.5); 06A's `ops/lower-env-data-provenance-scan` consumes the standard at run time. The joint body is split: 06D defines what counts as anonymized; 06A enforces it in the lower-env scan.  
14. **INV-06-08 (every irreversible deletion has executable proof):** `ops/deletion-proof-conformance` (§6.5) is the body. The proof harness consumes Doc 05D §10 cascade \+ Doc 05D D20/D21 tests (FWD-06-04) \+ adds the §6 post-deletion verification job \+ manifest. Partial-provable for the LISA layer until Doc 03 Main §14.2 source available (§3.4); partial-provable for the mastery layer until Doc 05D source available (§3.5); identity layer fully provable from Doc 01 V6 §19 today.  
15. **INV-06-09 (every backup has restore-test proof, RB-06D-V1-01 \+ RB-06D-V1-02 corrected):** `ops/restore-test` (§8.5) \+ `ci/restore-test-recency` (§8.6) are the body. Cadence is Q-06D-3=d: `monthly_baseline` provides the recent-baseline artifact for pre-deploy gates; `data_impact_migration` enqueues post-deploy and gates the NEXT deploy. RPO \= 15min enforced against `latest_recoverable_point_lag_seconds`; PITR retention coverage enforced separately against `pitr_retention_window_seconds`; platform RTO=4h locked per Q-06D-1=b; subsystem-stricter-target consumer pattern per Parent §3.  
16. **INV-06-11 (compliance gates are deploy gates):** `ci/compliance-gate-registry-parity` (§10.7) \+ `ops/compliance-gate-evidence-conformance` (§10.8) \+ 06A `infra/release-gates.yaml` bridge (§10.6) constitute the body. Q-06D-2=b async pattern: standalone evidence artifacts in `docs/compliance-evidence/`; `compliance_gate_evidence` relational state machine; 06A's `ci/release-gates` consumes the approved-state evidence as gate input. Durable evidence identity (`evidence_commit_sha` \+ `evidence_file_sha256`) required for approved/expired rows (RB-06D-V1-07).

## **C — Audit closure**

17. The §16 audit reports zero `DD-06-PROOF`, `DD-06-REDEF`, `DD-06-SEAM`, `DD-06-FWD` defects; zero 03C-boundary violations; zero §10.5 envelope-conformance violations; zero severity-crosswalk numeric-restatement defects; zero severity-vocabulary-integrity violations; citation-parity reports either resolved-anchor or `cited_per_project_handoff_record` for every cross-doc citation; P13 (self-monitoring watchdog) passes for every 06D scheduled-job registration (all carry external\_watchdog blocks); P14 (schema-completeness) passes for every JSONB / multi-field schema; P15 (registry-canonical) passes (no production gate consumes spec prose); P16 (state-machine RPC) passes for both `compliance_gate_evidence.current_state` AND `privacy_regulator_notifications.notification_status` (RB-06D-V1-04); P17 (text-FK validated write path) passes for all 06D tables with text-FK columns; P18 (external-fetch failure semantics) passes for `ops/restore-test`'s Supabase API consumption; P19/P20/P21/**P22** 06D-specific passes report clean (P22 added in CR-06D-04 enforces §8.7 no-PII rule).

18. **W8 / CR-06C-05 deploy gate (RB-06D-V1-03):** 06D deploy is gated on the 06C-owned post-lock additive landing — `doc06d_event` source\_class enum extension \+ 06D event rows in `infra/severity-crosswalk-registry.yaml` \+ `infra/alert-registry.yaml`. Until that additive (`RB-06C-V1-16` per 06C §21 register pattern) lands, 06D mechanisms emitting alerts under `source_class = doc06d_event` will be rejected by 06C's `ci/alert-runbook-parity`. **This is a deploy gate, not a spec-lock gate** — 06D locks with the obligation explicitly declared (W8); CR-06C-05 closure is a coordinated cross-doc cleanup tracked at both ends.

Per Parent §6.13, each mechanism above is **specified, not deploy-proven**, until its owning artifact (CI job / scheduled job / manifest / registry) supplies all six §6.13 elements.

---

# **§19 — Drafting & Lock Conventions**

Inherits Parent §8 verbatim: tool-neutral workflow (primary drafting agent → independent SWE review → in-lock-cycle `RB-06D-V1-NN` cleanup → **current 22-pass audit suite run twice** — RB-06D-V1-17 corrected; P1-P12 base \+ P13-P18 from 06C \+ P19-P21 from 06D draft \+ P22 from CR-06D-04 / RB-06D-V1-10); `.bak` / `.bak2` before each pass; draft-for-lock cleanup keeps `DRAFT` and transitions once to `LOCKED` on clean re-audit; post-lock in-lock-cycle cleanup keeps `LOCKED`, version and lock date unchanged.

---

# **§20 — Change Records**

**CR-06D-01** — Doc 06D V1.0 established. Scope: platform RPO/RTO targets \+ restore-test acceptance target (Q-06D-1=b: RPO=15min, RTO=4h); restore-test trigger model (Q-06D-3=d: trigger-based \+ monthly minimum); compliance-evidence process (Q-06D-2=b: async standalone registry); deletion executable-proof harness (INV-06-08 body, consuming Doc 05D cascade \+ D20/D21 via FWD-06-04 cite-path); retention policy registry \+ enforcement (consuming 01A §14, Doc 01 V6 §19, Doc 03 Main §14.2, Doc 05D §10); anonymization standard (joint with 06A INV-06-03); privacy/data-breach incident sub-class as 06C §10 sidecar; audit-archival surface partial-provable per FWD-06-02. Three Parent invariants owned outright (INV-06-08, INV-06-09, INV-06-11); INV-06-03 joint with 06A (06D owns the standard, 06A owns the scan).

**CR-06D-02** — Pre-draft alignment: 01A §14 / §19 anchors pinned by exact §; Doc 01 V6 §19 deletion lifecycle confirmed as V6-canonical (prose-section heading convention); Doc 05D §10/§11/§11.2 / INV-05D-15 cited per project handoff record (§3.5 — new sanctioned cite-path FWD-06-04); Doc 03 Main §14.2 cited per §3.4 cite-path (continued from 06C); Doc 03C §28.7 referenced for privacy-class incident source; 06A §10/§11/§7/§15 consumed for release-gate bridge, `data_impact` enum, environment matrix, backup-substrate topology; 06B §8 privileged-op audit consumed for deletion-action audit; 06C §6/§7/§8/§10 consumed for severity crosswalk, alert-registry, scheduled-job heartbeat substrate, incident lifecycle base.

**CR-06D-03** — Pre-draft Q\&A locked: Q-06D-1 \= (b) RPO \= 15 minutes / RTO \= 4 hours at platform level; subsystem-stricter-target consumer pattern preserved per Parent §3; Q-06D-2 \= (b) async compliance-evidence process — standalone `docs/compliance-evidence/<gate-id>/<NN>.md` artifacts \+ `infra/compliance-gate-registry.yaml` \+ `compliance_gate_evidence` relational state machine \+ `transition_compliance_gate_evidence_state()` RPC \+ 06A `infra/release-gates.yaml` bridge; Q-06D-3 \= (d) restore-test cadence is trigger-based (after every `data_impact ∈ {transforms_data, deletes_data}` production migration) \+ monthly minimum baseline. Three new 06D-specific audit passes added: P19 (retention-coverage exhaustiveness), P20 (compliance-gate registry parity), P21 (deletion-cascade reference exhaustiveness); audit suite expands from 18 to 21 passes, run twice per the standing-instruction discipline.

**CR-06D-04** — External SWE review applied in-lock-cycle. 5 blockers \+ 5 highs \+ 2 mediums resolved as `RB-06D-V1-01..12` per §21 register. Status transitions `DRAFT` → `LOCKED`. Highlights: B1 (trigger contradiction) — split into pre-deploy baseline \+ 06A pre-apply backup proof vs post-deploy enqueue gating next deploy; B2 (RPO conflated with retention window) — split `pitr_retention_window_seconds` from `latest_recoverable_point_lag_seconds`; RPO enforced against lag, PITR coverage enforced separately. B3 (06C source\_class extension) — registered as W8 and CR-06C-05 obligation; cross-doc additive coordinated, non-blocking for spec-lock; deploy gate per §18 \#18. B4 (privacy regulator notifications) — added `privacy_regulator_notifications` relational substrate \+ state machine \+ transition RPC; §11.5 now reconciles against the table, not postmortem prose. B5 (global 7-day grace) — replaced with per-policy `purge_lag_allowance_seconds`. H1 — `rejected` and `expired` are terminal states for compliance-evidence rows; re-submission is a new row. H2 — split RPC vs CI responsibility for evidence file existence; added `evidence_commit_sha` \+ `evidence_file_sha256` for durable audit identity. H3 — aborted-state escalation rule (\>24h Warn→Page; data-impact aborted blocks next deploy). H4 — §8.3.1 `integrity_checks_passed` JSONB schema specified explicitly. H5 — §8.7 no-PII rule for proof artifacts; enforced family-wide; audit pass P22 added. M1 — §5 detailed deletion-phase table removed; pointer-only to Doc 01 V6 §19. M2 — explicit `partial_provable_until: FWD-06-02` token replaces ambiguous null-with-comment in §13 placeholder. Audit suite expanded 21 → 22 passes (P22 added). All passes clean × 2 runs post-cleanup.

**CR-06D-05** — Second SWE review (post-CR-06D-04) applied in-lock-cycle. 1 blocker \+ 3 highs \+ 2 mediums resolved as `RB-06D-V1-13..18` per §21 register. Status holds at `LOCKED 2026-05-21`; no version bump; lock date unchanged (multi-round in-lock-cycle cleanup precedent from Doc 04C). Highlights: **B1 (RB-06D-V1-13)** — removed the time-based `now() > deadline_at` CHECK constraint on `privacy_regulator_notifications` (CHECK constraints evaluate on INSERT/UPDATE only and cannot safely reference wall-clock time); structural-only CHECK retained; temporal precondition (`pending → missed_deadline` requires `clock_timestamp() > deadline_at AND sent_at IS NULL`) explicitly owned by `transition_privacy_regulator_notification_state` per §11.3.2. **H1 (RB-06D-V1-14)** — §7.1 lingering conflation between PITR retention window and RPO target fixed; retention-window coverage is verified against `configured_min_retention_window_seconds`, RPO is verified independently against `latest_recoverable_point_lag_seconds`. **H2 (RB-06D-V1-15)** — header lock-scope note added: 06D is spec-locked but alert-emitting mechanisms are deploy-blocked until CR-06C-05 lands in 06C (preserves clarity that spec-lock ≠ deploy-ready while the cross-doc additive is pending). **H3 (RB-06D-V1-16)** — informal `mastery_constants`\-style config-owner reference replaced with canonical owner: `configured_min_retention_window_seconds` is owned by 01A §3 config doctrine and materialized in `infra/data-protection-config.yaml`. **M1 (RB-06D-V1-17)** — §19 stale "21-pass" reference updated to "current 22-pass audit suite run twice" with full pass-suite breakdown. **M2 (RB-06D-V1-18)** — §8.7 salted-hash bullet extended with reproducibility note: salted hashes are for within-run correlation only, NOT for future recomputation; later auditors rely on canonical-owner queries plus aggregate proof fields, not on re-identifying the salted hash (the salt-discard is intentional). Audit suite unchanged at 22 passes; all passes clean × 2 runs post-cleanup.

---

# **§21 — Cleanup Register (RB-06D-V1-NN)**

Populated during CR-06D-04 (round 1, draft-for-lock SWE review cleanup; items 01–12) and CR-06D-05 (round 2, post-lock SWE review cleanup; items 13–18). All items resolved in-lock-cycle; status holds at `LOCKED 2026-05-21` across both rounds.

| Tag | Severity | Source | Resolution |
| ----- | ----- | ----- | ----- |
| RB-06D-V1-01 | BLOCKER | SWE B1 (R1): restore-test trigger contradicts pre-deploy gate | §8.2 trigger model rewritten — pre-deploy gate verifies recent baseline \+ 06A pre-apply backup proof \+ prior data-impact cleanliness; post-deploy `data_impact_migration` enqueue gates the NEXT deploy via §8.6 failure condition (3). Removes the impossible "deploy-gated-by-its-own-post-deploy-result" loop. |
| RB-06D-V1-02 | BLOCKER | SWE B2 (R1): RPO conflated with PITR retention window | §8.3 schema, §8.4 RPC, §8.5 failure conditions, §7.4 alerts all split. `latest_recoverable_point_lag_seconds` is the RPO signal; `pitr_retention_window_seconds` is the PITR coverage signal. Two distinct alerts (`ALERT-DATA-01` immediate-urgency for RPO breach; `ALERT-DATA-02` next-business-hour for coverage). |
| RB-06D-V1-03 | BLOCKER | SWE B3 (R1): `doc06d_event` source\_class not in locked 06C alert-registry enum | Declared explicitly as W8 / CR-06C-05 — required 06C post-lock additive. 06C-owner applies `RB-06C-V1-16` in-lock-cycle: extends source\_class enum \+ adds 06D event rows to severity-crosswalk and alert-registry. Non-blocking for 06D spec-lock per cross-doc-additive convention; recorded as 06D deploy gate per §18 \#18. |
| RB-06D-V1-04 | BLOCKER | SWE B4 (R1): regulator notification proof relies on postmortem prose | §11.3.1 added — `privacy_regulator_notifications` relational table \+ status state machine ({not\_required, pending, sent, missed\_deadline}) \+ `record_privacy_regulator_notification()` \+ `transition_privacy_regulator_notification_state()` transition RPC. §11.5 reconciles against this table. §11.4 postmortem extension still required, but the canonical proof source is the table. |
| RB-06D-V1-05 | BLOCKER | SWE B5 (R1): global hardcoded "retention\_horizon \+ 7-day-grace" | §9.1 schema adds per-policy `purge_lag_allowance_seconds`. §9.4 failure condition (a) rewritten to use per-policy allowance. §9.3 failure condition (h) requires lag-allowance when horizon is set. 7-day-grace remains semantically valid only for Doc 01 V6 §19 identity policies; logs / audit / LISA / etc. carry their own canonical-owner-defined allowances. |
| RB-06D-V1-06 | HIGH | SWE H1 (R1): `rejected → pending` is wrong (transition vs new submission) | §10.4 legal-transition table rewritten: `rejected` and `approved-then-expired` are TERMINAL. Re-submission is an INSERT via `record_compliance_gate_evidence_submission()` creating a new `evidence_id` row in `pending` state. The terminal `rejected` / `expired` rows remain as audit history. |
| RB-06D-V1-07 | HIGH | SWE H2 (R1): DB RPC can't verify repo file existence | §10.5 split — RPC validates path-shape \+ gate\_id \+ evidence\_id sequence; CI submission layer (PR-merge GitHub Action) verifies file existence and populates `evidence_commit_sha` \+ `evidence_file_sha256` via separate `populate_compliance_evidence_artifact_identity()` RPC. §10.3 schema adds the SHA columns with CHECK constraint requiring them for `approved` / `expired` states. §10.7 failure condition checks SHA-presence-for-approved-rows. |
| RB-06D-V1-08 | HIGH | SWE H3 (R1): restore-test `aborted` outcome under-specified | §8.5 failure conditions (h) and (i) added: aborted \>24h without subsequent pass escalates Warn → Page; data-impact-migration aborted blocks subsequent deploys via §8.6 failure condition (3). §8.6 explicitly lists aborted-state in the "prior data-impact restore-test cleanliness" check. |
| RB-06D-V1-09 | HIGH | SWE H4 (R1): `integrity_checks_passed` JSONB has no schema | §8.3.1 added — explicit JSONB shape: `schema_presence` (checked\_tables, missing\_tables), `fk_integrity` (violations\_count, queries), `row_count_checks[]` (per-table source/restored/tolerance/decision), `seed_canary_checks[]` (canary\_id, found\_in\_restore). §8.5 failure condition (f) reads named fields, not free-form JSONB. Tolerance semantics specified. |
| RB-06D-V1-10 | HIGH | SWE H5 (R1): proof manifests can accidentally contain PII | §8.7 added — canonical statement of the no-PII rule applied family-wide. Only opaque IDs, aggregate counts, decision enums, hash digests of identifiers (with proof-run-local salt NOT stored in artifact), boolean flags permitted. Audit pass P22 added (§16) — enforces the rule mechanically across §14 schema definitions. |
| RB-06D-V1-11 | MEDIUM | SWE M1 (R1): §5 restates Doc 01 V6 §19 deletion timing | §5 rewritten — detailed phase table removed; replaced with explicit pointer to Doc 01 V6 §19 with no values restated. The §6 proof harness body explains what 06D consumes (the T+7 hard-delete completion event for the §6.3 layers\_verified harness); deletion bodies stay canonical to V6. |
| RB-06D-V1-12 | MEDIUM | SWE M2 (R1): §13 placeholder has `retention_horizon_seconds: null` while §9 schema implies int | §9.1 schema extended — explicit `partial_provable_until: <forward-ref token | null>` field. §13 placeholder uses `partial_provable_until: FWD-06-02`. §9.3 failure condition (i) and §9.4 failure condition (b) explicitly skip numeric enforcement for `partial_provable_until IS NOT NULL` rows; reports `partial_provable_skipped` in proof artifact. |
| RB-06D-V1-13 | BLOCKER | SWE B1 (R2): time-based CHECK `now() > deadline_at` on `privacy_regulator_notifications` is unsafe schema design | §11.3.1 CHECK constraint rewritten to structural-only invariant (`missed_deadline` requires `deadline_at IS NOT NULL AND sent_at IS NULL`). §11.3.2 transition RPC documentation extended with explicit "temporal-ownership note": the time precondition (`clock_timestamp() > deadline_at AND sent_at IS NULL`) lives in `transition_privacy_regulator_notification_state` and is re-verified by §11.5 conformance job; the §11.5 job is the sole authorized caller of `pending → missed_deadline`. Eliminates wall-clock dependence in row-validity invariants. |
| RB-06D-V1-14 | HIGH | SWE H1 (R2): §7.1 still conflated PITR retention with RPO target | §7.1 substrate-consumer language rewritten: substrate retention window is verified against `configured_min_retention_window_seconds` (PITR coverage) — a distinct metric from RPO. RPO is verified separately using `latest_recoverable_point_lag_seconds`. The two signals are not cross-derived. Aligns §7.1 with the corrected §7.4 / §8.5 split from RB-06D-V1-02. |
| RB-06D-V1-15 | HIGH | SWE H2 (R2): header `LOCKED` without lock-scope note risks deploy-readiness confusion | Lock-scope note added to header: 06D is **spec-locked** as of 2026-05-21, but 06D alert-emitting mechanisms (every alert tagged `source_class = doc06d_event`) are **deploy-blocked** until 06C-owner applies CR-06C-05 / RB-06C-V1-16 (extends 06C alert-registry source\_class enum \+ adds 06D event rows). Distinguishes spec-lock semantics (authorizes downstream consumers to reference) from deploy-readiness semantics (requires CR-06C-05 closure). Tracked as W8 in §17 and as criterion \#18 in §18. |
| RB-06D-V1-16 | HIGH | SWE H3 (R2): `mastery_constants`\-style config-owner reference too informal for locked doc | §8.5 failure condition (d) and §7.4 `ALERT-DATA-02` reference rewritten: `configured_min_retention_window_seconds` is owned by **01A §3 config doctrine and materialized in `infra/data-protection-config.yaml`** — canonical config-registry owner with exact-§ reference. Removes "style" language from locked spec. |
| RB-06D-V1-17 | MEDIUM | SWE M1 (R2): §19 audit-count language still said "21-pass" | §19 updated to "current 22-pass audit suite run twice" with full pass-suite breakdown (P1-P12 base \+ P13-P18 from 06C \+ P19-P21 from 06D draft \+ P22 from CR-06D-04 / RB-06D-V1-10). Removes stale pass count introduced by P22 addition in CR-06D-04. |
| RB-06D-V1-18 | MEDIUM | SWE M2 (R2): salted-hash bullet missing reproducibility clarification | §8.7 salted-hash bullet extended with explicit reproducibility note: salted hashes are for **within-artifact/within-run correlation only**, NOT for future recomputation. Later auditors cannot re-derive a row's salted hash (salt is discarded with the run); future verification relies on canonical-owner source queries plus aggregate proof fields (counts, decision enums, pass/fail bits), not on re-identifying the salted hash. The salt-discard is a deliberate property — proves "same identity at step 1 and step 2 of one run" without enabling post-hoc re-identification. |

**Convention:** `.bak` / `.bak2` / `.bak_pre_swe_cleanup` / `.bak_pre_swe_r2` before each pass; resolved items tagged `RB-06D-V1-NN`; §20 change-record row appended per pass; draft-for-lock pass (round 1, CR-06D-04) transitions status `DRAFT` → `LOCKED`; post-lock passes (round 2, CR-06D-05, and any subsequent) leave status / version / lock-date unchanged (Parent §8 multi-round in-lock-cycle precedent from Doc 04C / Doc 05D). Lock holds at 2026-05-21 across both rounds.

---

# **§22 — Closing**

06D is the platform's data-protection-proof layer. It exists because the deletion bodies (Doc 01 V6 §19 \+ Doc 05D §10 \+ Doc 03 Main §14.2), the backup substrate (Supabase PITR), the redaction rules (01A §14), and the compliance rules (Doc 05D `BLOCKING_PRIVACY_GAP` and successors) all exist as policy without an executable-proof layer binding them to deploys. 06D supplies that layer: every deletion produces a manifest; every backup produces a restore-test pass; every compliance gate is wired into 06A's release-gate enforcement; every retention horizon is exercised by a reconciliation job. None of the policy bodies are restated — they remain canonical to their owners, and 06D consumes them by exact §-citation throughout. Decision 5 holds end-to-end.

*End of Doc 06D V1.0 (LOCKED 2026-05-21; RB-06D-V1-01..12 applied in-lock-cycle per CR-06D-04; RB-06D-V1-13..18 applied in-lock-cycle per CR-06D-05). Next on lock: 06E (Cost/Capacity/Vendor — lightweight, V1.1 expansion hook per Parent §3).*

