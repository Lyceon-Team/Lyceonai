# **Doc 04D — Exam Audit, Observability, Reliability & Failure Handling**

**Version:** V1.0 **Status:** **LOCKED 2026-05-12** — fresh canonical against Parent V3.0 §3 subdoc map \+ Karl's scope outline (2026-05-12) \+ Doc 04C V1.0 §20.5 minimum contract; ChatGPT SWE review cleanup applied within lock cycle (no version bump; 4 reviewer items \+ 3 non-blocking items per Change Records) **Scope:** SAT MVP — exam runtime / scoring / reporting audit, observability, reliability, failure handling **Audience:** Engineering, QA, Ops, Security, Product **Owns:** audit event taxonomy (hybrid: schema-locked critical events \+ informational view/access events), `exam_failure_ledger` schema and lifecycle, outbox health monitoring, runtime / scoring / reporting / admin action audit, security audit events, metrics/SLIs/SLOs, alerting rules, dead-letter and replay runbooks, incident metadata consumed by 04C, data retention, audit access control, internal read surfaces for ops/audit **Does NOT own:** runtime transitions themselves (04A), scoring formula (04B), report projection (04C), mastery interpretation (Doc 05), auth/entitlement storage (Doc 01), question authoring (Doc 02), tutor coordination (Doc 03\)

**Depends on:** Doc 04 Parent V3.0 (LOCKED 2026-05-12). Doc 04A V2.2 (LOCKED 2026-05-12). Doc 04B V4.3 (spec-locked 2026-05-12; deploy-time attestation values pending). Doc 04C V1.0 (LOCKED 2026-05-12). Doc 02 series. Doc 01\.

**Keywords.** MUST, MUST NOT, SHOULD, SHOULD NOT, MAY follow RFC 2119\.

---

## **Design provenance (V1.0)**

This is the V1.0 fresh canonical draft. There is no prior V0.x to supersede. The document derives from:

* **Parent V3.0 §3 subdoc family map** — locks 04D's scope as "Audit, Observability, Reliability & Failure Handling."  
* **Karl's scope outline (2026-05-12)** — establishes the 20-section structure, the 3 hard invariants, the failure ledger schema sketch, the audit event taxonomy (4 categories × \~30 events), the SLI/SLO list.  
* **Doc 04C V1.0 §20.5** — locks the minimum 5-field `exam_failure_ledger` contract 04D MUST satisfy for 04C derivation to work.  
* **04A V2.2 §6, §13, §14, §17** — locks the runtime events 04D observes (form publish, completion, abandonment, idempotency body-mismatch).  
* **04B V4.3 §9, §12, §19, §22** — locks the scoring events 04D observes (scoring orchestration, version attestation, validation packet attestation, score-run insert-once semantics).

### **V1.0 scope alignment (Karl 2026-05-12)**

Three alignment decisions made before drafting:

| Decision | V1.0 stance | Rationale |
| ----- | ----- | ----- |
| `exam_failure_ledger` schema completeness | **Minimum viable \+ `source`** — the 5 fields Doc 04C V1.0 §20.5 requires for derivation, plus `source` (NB\#1 promoted to V1.0); V1.1 expands further | Unblocks 04C immediately; the V1.1 expansion (`failure_message`, `severity`, `related_outbox_id`, `metadata`, ack/resolve timestamps) remains purely additive |
| Audit event taxonomy completeness | **Hybrid** — schema-locked for critical security / admin / scoring-failure events; informational for view/access logging | Critical events need stable contracts day 1 (security, scoring traceability); view/access events evolve with Product UX and don't gate downstream behavior |
| SLI/SLO commitments | **Concrete numeric targets** — implementable as day-1 alerts | Karl's stance: ship with thresholds, tune from production data; no production-tuning placeholder |

These decisions shape §5 (ledger), §4/§6/§7/§8 (taxonomy split), §12/§13 (SLI/SLO \+ alerts).

---

## **1\. Purpose**

Doc 04D defines the **operational and audit truth** for everything that happens across the Doc 04 family (04A runtime, 04B scoring, 04C reporting). The runtime layer owns session state; the scoring layer owns score computation; the reporting layer owns report projection; 04D owns:

* **What evidence is recorded** for every critical state transition (audit event taxonomy)  
* **Where failures land** when they prevent canonical state from being written (failure ledger)  
* **How outbox health is monitored** so completion → scoring delays are detectable before they hurt students  
* **What metrics, SLIs, and SLOs** govern reliability commitments  
* **What alerts fire** and what runbooks exist when they do  
* **How dead-letter and replay** procedures work for the runtime outbox and the scoring event ledger  
* **What data retention rules** apply to audit and ledger rows  
* **Who can read what** in audit surfaces (ops vs support vs admin)

04D is **write-mostly** for canonical audit rows, **read-mostly** for downstream consumption (04C reads the ledger; ops dashboards read SLIs; runbooks read alerts).

**Critical seam (locked by Doc 04C V1.0 §20.5):** 04D's `exam_failure_ledger` is the source-of-truth for 04C's `failed_requires_review` report state. When 04B's orchestrator hits a V4.3 §19 hard failure, 04D writes an open ledger row; 04C reads it on the next report request and surfaces `failed_requires_review`. If 04D's ledger does not write, 04C cannot distinguish "scoring pending" from "permanently failed" — so the ledger is operationally critical, not just observability.

---

## **2\. Parent V3.0 inherited constraints**

The constraints below are inherited from Parent V3.0 and are not negotiable at the 04D level. Changes require Parent revision.

### **2.1 Audit emits no canonical state (Parent V3.0 hard guarantee \#11 \+ Doc 04C V1.0 invariant \#8)**

04D audit events are observability, NOT canonical state. No downstream system MAY use 04D audit events as the source of truth for:

* Mastery (Doc 05 reads `test_session_answers JOIN questions` directly per Parent V3.0 RB-V3-08)  
* Session state (04A's `test_sessions.state` is canonical)  
* Score state (04B's `score_runs` is canonical)  
* Report state (04C derives at read time from `test_sessions` \+ `score_runs` \+ `exam_failure_ledger`)

04D events MAY be consumed by:

* Ops dashboards (SLI computation)  
* Alerting pipelines  
* Incident investigation tooling  
* Cohort analytics (Doc 09, future)

The distinction: canonical state survives audit retention windows; audit events are subject to retention pruning (§17) and MUST NOT be the only record of an operationally-important fact.

### **2.2 No data leakage in audit (Parent V3.0 §12 \+ Doc 04C V1.0 §14)**

Audit events MUST NOT log:

* `correct_answer` values from Doc 02 questions  
* Student answer values (`test_session_answers.answer`)  
* Raw tutor exchanges (Doc 03 owns this; 04D doesn't observe tutor content)  
* Doc 01 secrets, tokens, password hashes, session cookies  
* `module2_path` values in any student-derived or guardian-derived event payload (admin-tagged events MAY carry it)

Audit events MAY log:

* Schema-level field NAMES that exist in the canonical tables (e.g., "answer was submitted for `(section, module, ordinal)`")  
* Idempotency keys (these are client-generated; not secrets)  
* `score_run_id`, `test_session_id`, outbox event IDs  
* Failure codes, severity classifications, and the structured error envelope from upstream raises  
* Disclosure-version IDs

The redaction list is part of the canonical event contract (§4.4); a serializer test fails CI if a forbidden field name appears in any locked event payload definition.

### **2.3 Modeled-score discipline survives operational events (Parent V3.0 §12 forbidden phrases)**

Audit event payloads, alert messages, runbook copy, and incident notifications MUST NOT use Parent V3.0 §12 forbidden phrases ("official SAT score," "your projected SAT score," etc.) — even in internal-only contexts. This prevents:

* Operational copy leaking into student-facing surfaces by mistake  
* Internal mental models drifting from modeled-score discipline  
* Audit dumps shared with content/legal accidentally undermining disclosure framing

### **2.4 Admin actions require audit (Parent V3.0 hard guarantee \#8 \+ 04A V2.2 §6)**

Every admin-initiated mutation MUST produce an audit row in the same transaction as the primary mutation where possible. The taxonomy in §8 enumerates which admin actions are observed. Admin actions that escape audit are a contract violation, not an operational gap.

### **2.5 04C → 04D failure ledger contract (Doc 04C V1.0 §20.5)**

04C's report-state derivation depends on `exam_failure_ledger` carrying at minimum: `id`, `test_session_id`, `failure_code`, `status`, `created_at`. V1.0 of 04D MUST honor this contract; V1.1 expansion MUST remain backward-compatible (additive columns only; no removal or rename of the 5 fields).

---

## **3\. Hard audit / reliability invariants**

These cannot be violated. Tests verify them. Schema enforces them where possible.

1. **Every critical state transition is reconstructable from canonical state \+ audit events.** For any test session, ops MUST be able to reconstruct: who started it, which form was bound, which scoring model version was bound, when each module started / submitted / timed out, which `module2_path` was locked, which idempotency keys were replayed, which outbox events were written, whether scoring succeeded or failed, whether review was unlocked. 04D does NOT duplicate canonical data — it records audit events that, combined with canonical tables, support the reconstruction. If a transition is observable in canonical state but not via a 04D event (or vice versa), that is an audit gap.  
2. **No fire-and-forget audit for admin or scoring-impacting operations.** Admin actions (form publish, routing-threshold override, form retirement, manual outbox reset, scoring-version activation, constants sealing, validation-packet attestation update, score-failure remediation) MUST write durable audit rows in the same transaction as the primary mutation when the primary mutation is a database transaction. When the primary mutation is not a single transaction (e.g., a multi-step orchestration), the audit MUST land before the next state-changing step proceeds. "Best-effort fire-and-forget" is forbidden for these classes.  
3. **The failure ledger is the source-of-truth for `failed_requires_review`.** When 04B's orchestrator hits a hard failure that prevents `score_runs` insertion, 04D MUST write an open `exam_failure_ledger` row before the orchestrator's transaction ends (or in a compensating transaction immediately afterward; see §5.4). 04C reads this ledger to determine `failed_requires_review` per Doc 04C V1.0 §10. The ledger row MUST exist within 60 seconds of the orchestrator's failure return; longer is a §13 alert condition.  
4. **Outbox health is monitored.** The `exam_runtime_outbox` (04A V2.2 §5.7), `score_run_event_ledger` (04B V4.3 §12), and any future admin audit outbox MUST be observed by 04D's outbox-health metrics (§12). Pending row age exceeding §13 thresholds fires an alert; rows in `failed` status fire an alert; dead-letter buildup fires an alert. No outbox table is "monitored at implementation time but not in 04D" — if the outbox exists in canonical schema, it appears in §12.  
5. **Audit redaction is enforced at the serializer.** Forbidden fields (§2.2 list) MUST NOT appear in audit payloads under any code path. A serializer test scans every audit event's payload type definition against the forbidden list and fails CI on any match.  
6. **Audit events are append-only.** 04D's audit tables (§4) MUST NOT support UPDATE or DELETE in application code paths. Retention pruning (§17) operates via a periodic job with elevated privileges, not via the application service role. Modifications-after-write are visible as new audit rows referencing the original.  
7. **Critical event names are stable (hybrid taxonomy).** The schema-locked subset of audit events (§7 scoring-failure, §8 admin, §11 security) has stable `event_name` strings; changing them requires a 04D revision and a 04C compatibility check (since 04C consumes failure-ledger entries indirectly tied to these events). Informational events (§6 view/access logging) have evolvable names — they can change without a 04D revision.  
8. **Incident severity classifications are canonical.** The severity enum (`info`, `warning`, `page`, `critical`) is the single classification used across the failure ledger, alert rules, and runbook references. New severity tiers require a 04D revision; ad-hoc severities are forbidden.  
9. **No raw stack traces in audit or ledger payloads (V1.0 lock-cycle NB\#3).** Audit event payloads and `exam_failure_ledger` payloads MUST NOT store raw exception stack traces. Stack traces can carry path information, internal field names from upstream libraries, environment-specific module identifiers, and (in the worst case) values from local variables captured by exception-decoration libraries. The canonical storable shape is: sanitized exception class name, stable `failure_code` (per §5.5 enum), `request_id`, and `source` (§5.1 column). V1.1's `failure_message` column (§5.2) MAY carry a sanitized exception message string but MUST NOT carry the underlying trace. A CI lint test scans audit payload type definitions and ledger column types for any pattern likely to admit stack traces (e.g., a column named `traceback`, `stack`, or `exc_info`).

---

## **4\. Audit event taxonomy**

V1.0 adopts the **hybrid taxonomy** (Karl alignment Q2): schema-locked for critical security / admin / scoring-failure events; informational naming for view/access events.

### **4.1 Two-tier classification**

**Schema-locked tier.** Event names, payload shapes, and severity classifications are canonical and stable. Changes require a 04D revision. These events are direct dependencies of:

* Failure ledger entries (which 04C reads for `failed_requires_review`)  
* Admin compliance review (regulatory, security)  
* Incident reconstruction (post-mortem traceability)

Sections: §7 (scoring events that produce failure ledger entries), §8 (admin actions), §11 (security events).

**Informational tier.** Event names are documented for orientation but treated as implementation-evolvable. Payload shapes are NOT canonically locked at the field level. Changes do NOT require a 04D revision. These events feed:

* Ops dashboards (count metrics, rate of access, etc.)  
* Product analytics (Doc 09 future)  
* Engineering troubleshooting

Sections: §6 (runtime non-failure transitions), §9 (report access logging), other view/access logging.

### **4.2 Audit table schema**

Two physical tables for the two tiers:

\-- Schema-locked tier: stable contract, append-only  
CREATE TABLE exam\_audit\_events (  
  id              uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  event\_name      text NOT NULL,                  \-- from §7 / §8 / §11 enumerations  
  event\_category  text NOT NULL CHECK (event\_category IN ('runtime\_critical', 'scoring', 'admin', 'security')),  
  severity        text NOT NULL CHECK (severity IN ('info', 'warning', 'page', 'critical')),  
  test\_session\_id uuid NULL,                      \-- session linkage; null for non-session events (model activation, etc.)  
  actor\_kind      text NOT NULL CHECK (actor\_kind IN ('student', 'guardian', 'admin', 'system', 'orchestrator')),  
  actor\_id        uuid NULL,                      \-- nullable when actor is 'system'/'orchestrator'  
  request\_id      text NULL,                      \-- correlation ID for cross-service tracing  
  payload         jsonb NOT NULL,                 \-- event-specific structured fields per §7 / §8 / §11  
  created\_at      timestamptz NOT NULL DEFAULT clock\_timestamp()  
);

CREATE INDEX idx\_exam\_audit\_events\_session  ON exam\_audit\_events (test\_session\_id, created\_at DESC) WHERE test\_session\_id IS NOT NULL;  
CREATE INDEX idx\_exam\_audit\_events\_name     ON exam\_audit\_events (event\_name, created\_at DESC);  
CREATE INDEX idx\_exam\_audit\_events\_severity ON exam\_audit\_events (severity, created\_at DESC) WHERE severity IN ('page', 'critical');  
CREATE INDEX idx\_exam\_audit\_events\_actor    ON exam\_audit\_events (actor\_kind, actor\_id, created\_at DESC) WHERE actor\_id IS NOT NULL;

\-- Informational tier: evolvable, append-only, retention-pruned more aggressively  
CREATE TABLE exam\_audit\_events\_informational (  
  id              uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  event\_name      text NOT NULL,                  \-- from §6 / §9 enumerations; evolvable  
  test\_session\_id uuid NULL,  
  actor\_kind      text NOT NULL CHECK (actor\_kind IN ('student', 'guardian', 'admin', 'system')),  
  actor\_id        uuid NULL,  
  request\_id      text NULL,  
  payload         jsonb NOT NULL,  
  created\_at      timestamptz NOT NULL DEFAULT clock\_timestamp()  
);

CREATE INDEX idx\_exam\_audit\_informational\_session ON exam\_audit\_events\_informational (test\_session\_id, created\_at DESC) WHERE test\_session\_id IS NOT NULL;  
CREATE INDEX idx\_exam\_audit\_informational\_name    ON exam\_audit\_events\_informational (event\_name, created\_at DESC);

**Why two tables.** The retention rules differ (§17): schema-locked events retain longer because they feed incident reconstruction and regulatory review; informational events retain shorter because they feed dashboards and lose value after the relevant operating window. Splitting at the table level lets the retention pruning job operate independently per tier.

**Append-only enforcement.** Both tables have no UPDATE or DELETE permission for application service roles. The retention pruning job runs under an elevated role and uses time-bounded DELETE (`WHERE created_at < $cutoff`). Per invariant \#6.

### **4.3 Event emission contract**

Every event emission MUST satisfy:

* **Schema-locked tier (§7 / §8 / §11):** structured payload conforming to the locked type per §4.4; runtime validation against a JSON schema before INSERT.  
* **Informational tier (§6 / §9):** structured payload, but field-level shape is evolvable; the JSON schema is a soft check (warn on mismatch, do not reject).  
* **All tiers:** redaction at the serializer per invariant \#5; correlation `request_id` populated where available; `created_at` is server-side `clock_timestamp()` (per 04A V2.2 §8.1 time-source discipline; never trust application clocks).

Emission is non-blocking by default for the originating request path:

* Schema-locked **admin** and **security** events emit in the same DB transaction as the primary mutation (invariant \#2; failure aborts the primary mutation).  
* Schema-locked **scoring-failure** events emit AFTER the failure ledger row is durable, per the precedence rule below.  
* All other events emit asynchronously via a write queue; emission failures degrade silently (event lost; logged as `exam_audit_emission_failed` for ops review).

**Scoring-failure precedence rule (V1.0 lock-cycle RB-04D-V1-02).** When 04B raises a hard failure, the priority order is unambiguous: **ledger write FIRST; audit event SECOND.** Specifically:

1. Write the `exam_failure_ledger` row (status='open'). This is the canonical artifact 04C V1.0 §20.5 depends on; it MUST become durable.  
2. Emit the `exam_scoring_failed` audit event (§7), referencing the ledger row's ID in `payload.failure_ledger_id`.  
3. **If step 2 fails after step 1 succeeded, the ledger row REMAINS committed.** The system emits `exam_audit_emission_failed` (§11; informational degradation, page-severity alert per §13) and fires `exam_data_integrity_violation_detected` if structural invariants are at risk. The orchestrator's retry may re-attempt the audit emission; it MUST NOT roll back or delete the ledger row.

Rationale: 04C derives `failed_requires_review` from the ledger, not from audit events (Doc 04C V1.0 §5.3). A failed audit emission is observability degradation; a missing ledger row is a student-impact failure. The two are not equivalent severities, and the failure-handling code MUST preserve that distinction.

The two emission modes (blocking for admin/security; precedence-ordered for scoring-failure) are deliberate: they protect the invariants other systems depend on while preventing audit-system degradation from masking or amplifying primary-system failures.

### **4.4 Schema-locked payload contracts (forward reference)**

The locked payload type definitions live in their respective enumeration sections:

* §7 Scoring events  
* §8 Admin actions  
* §11 Security events

Each enumeration row carries: event name (stable string), severity, payload type definition (TypeScript-style), and the trigger condition (which upstream code path emits it).

### **4.5 What 04D explicitly does NOT enumerate**

Per the hybrid stance, 04D does NOT lock:

* Every runtime non-failure event (those are §6, informational)  
* Every report-access event (those are §9, informational)  
* Tutor events (Doc 03 owns its own audit; 04D does not duplicate)  
* Mastery events (Doc 05 will own its audit; out of scope for 04D)  
* Operational telemetry that is not an "audit event" (request/response latency histograms, throughput counters, etc. — those are §12 metrics, not §4–§11 events)

---

## **5\. Failure ledger schema**

The failure ledger is the operationally-critical component that backs Doc 04C V1.0's `failed_requires_review` report state.

### **5.1 V1.0 minimum-viable schema (Karl alignment Q1 \+ V1.0 lock-cycle additions)**

CREATE TABLE exam\_failure\_ledger (  
  id              uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  test\_session\_id uuid NOT NULL REFERENCES test\_sessions(id),  
  failure\_code    text NOT NULL,  
  source          text NOT NULL CHECK (source IN ('runtime', 'scoring', 'reporting', 'outbox')) DEFAULT 'scoring',  
  status          text NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved')),  
  created\_at      timestamptz NOT NULL DEFAULT clock\_timestamp()  
);

CREATE INDEX idx\_exam\_failure\_ledger\_session  
  ON exam\_failure\_ledger (test\_session\_id, status, created\_at DESC);

CREATE INDEX idx\_exam\_failure\_ledger\_open  
  ON exam\_failure\_ledger (created\_at DESC)  
  WHERE status IN ('open', 'acknowledged');

\-- Dedupe: at most one open or acknowledged row per (session, failure\_code).  
\-- Resolved rows do not block; recurring failures after resolution can write new rows.  
CREATE UNIQUE INDEX one\_open\_failure\_per\_session\_code  
  ON exam\_failure\_ledger (test\_session\_id, failure\_code)  
  WHERE status IN ('open', 'acknowledged');

**Field set (V1.0):**

* The 5 fields originally required by Doc 04C V1.0 §20.5 (`id`, `test_session_id`, `failure_code`, `status`, `created_at`) — minimum contract.  
* `source` (V1.0 lock-cycle NB\#1) — included in V1.0 instead of deferring to V1.1. Operational dashboards and runbook flows benefit too much from per-source filtering to make this an additive-later column. DEFAULT `'scoring'` preserves the §5.4 Pattern A pseudocode contract without forcing every call site to supply it explicitly.

**Indexes (V1.0):**

* `idx_exam_failure_ledger_session`: supports Doc 04C V1.0 §5.3 per-session derivation.  
* `idx_exam_failure_ledger_open`: supports ops dashboards filtering across all sessions with open/acknowledged failures.  
* `one_open_failure_per_session_code` (V1.0 lock-cycle RB-04D-V1-04): partial unique index preventing duplicate open-or-acknowledged rows for the same `(test_session_id, failure_code)`. See §5.7 for dedupe semantics.

### **5.2 V1.1 expansion path (forward-compatible)**

V1.1 of 04D will additively expand the ledger with:

\-- V1.1 additions (NOT in V1.0; documented here for forward planning).  
\-- Note: \`source\` was originally planned for V1.1 but promoted to V1.0 per  
\-- the V1.0 lock-cycle NB\#1 (operational dashboard utility justified inclusion).  
ALTER TABLE exam\_failure\_ledger ADD COLUMN failure\_message  text NOT NULL DEFAULT '';  
ALTER TABLE exam\_failure\_ledger ADD COLUMN severity         text NOT NULL CHECK (severity IN ('info', 'warning', 'page', 'critical')) DEFAULT 'page';  
ALTER TABLE exam\_failure\_ledger ADD COLUMN related\_outbox\_id    uuid NULL;  
ALTER TABLE exam\_failure\_ledger ADD COLUMN related\_score\_run\_id uuid NULL;  
ALTER TABLE exam\_failure\_ledger ADD COLUMN metadata         jsonb NOT NULL DEFAULT '{}';  
ALTER TABLE exam\_failure\_ledger ADD COLUMN resolved\_at      timestamptz NULL;  
ALTER TABLE exam\_failure\_ledger ADD COLUMN acknowledged\_at  timestamptz NULL;  
ALTER TABLE exam\_failure\_ledger ADD COLUMN acknowledged\_by  uuid NULL REFERENCES admins(id);

The V1.1 additions are purely additive (DEFAULT values supplied for all NOT NULL columns) so existing V1.0 rows remain valid. V1.0 implementations MUST NOT depend on these columns being absent; future-compatible code MAY skip-read them if not present.

### **5.3 Lifecycle**

             ┌──────────┐  
              │   open   │   ← initial state when written  
              └────┬─────┘  
                   │  
       ┌───────────┴───────────┐  
       │                       │  
       ▼                       ▼  
┌──────────────┐         ┌──────────┐  
│ acknowledged │  ←───   │ resolved │  
└──────┬───────┘         └──────────┘  
       │  
       └─────────► resolved

* **`open`**: row was just written; no operator has reviewed; the underlying issue is still surfacing as `failed_requires_review` per 04C.  
* **`acknowledged`**: an operator has seen the failure (via §12 alert \+ dashboard); investigation is in progress. 04C still surfaces `failed_requires_review` while in this state (per Doc 04C V1.0 §5.3 derivation — `open` OR `acknowledged` both qualify).  
* **`resolved`**: the underlying issue has been fixed. The failure no longer surfaces as `failed_requires_review`. If 04B has subsequently produced a `score_runs` row, 04C will surface `scored` / `partial_scored` per its derivation. If not, the report falls back to `scoring_pending` per Doc 04C V1.0 §5.3 fallback.

State transitions:

* `open → acknowledged`: operator action; V1.0 path is direct DB UPDATE with admin audit row (§8) for the acknowledgement.  
* `acknowledged → resolved` OR `open → resolved`: operator action; same audit pattern.  
* `resolved → *`: not permitted. A ledger row, once resolved, does not reopen. If the same session subsequently fails again, a NEW ledger row is written.

### **5.4 Write timing (invariant \#3 elaboration)**

When 04B's orchestrator hits a V4.3 §19 hard failure, the failure ledger MUST be written within 60 seconds (per invariant \#3). Two implementation patterns:

**Pattern A (V1.0 canonical): same-transaction ledger write, then audit emission.** The orchestrator's exception handler writes the ledger row in a compensating transaction BEFORE emitting the audit event, and BEFORE re-raising the exception out of the orchestration boundary. The application service role has INSERT permission on `exam_failure_ledger`. Pseudocode:

try:  
    compute\_and\_insert\_score\_run(test\_session\_id)  
except V43HardFailure as e:  
    \# STEP 1: Write the failure ledger row. This is the priority.  
    \# Doc 04C V1.0 §20.5 depends on this row existing.  
    with new\_transaction():  
        ledger\_id \= insert\_failure\_ledger(  
            test\_session\_id=test\_session\_id,  
            failure\_code=e.code,  
            source='scoring',           \# V1.0 lock-cycle NB\#1  
            status='open'  
        )  
    \# STEP 2: Emit the audit event referencing the ledger row.  
    \# If this fails, the ledger row REMAINS committed. Do NOT roll back.  
    try:  
        emit\_audit\_event(scoring\_failure\_event(e, failure\_ledger\_id=ledger\_id))  \# §7  
    except AuditEmissionFailure as ae:  
        \# Observability degradation, not a correctness failure.  
        \# The ledger row is durable; 04C will surface failed\_requires\_review.  
        emit\_audit\_event\_or\_log(audit\_emission\_failed\_event(ae))  \# §11, best-effort  
    raise  \# re-raise the original V43HardFailure to upstream caller

The `new_transaction()` block ensures the ledger write is durable even if the outer orchestration transaction (if any) rolls back.

**Failure-mode precedence (V1.0 lock-cycle RB-04D-V1-02).** The pseudocode is explicit about precedence:

* If step 1 (ledger write) fails: critical failure; emit `exam_data_integrity_violation_detected` (§11); §14.10 runbook. 04C will fall back to `scoring_pending` because no ledger entry exists; an ops-level alert fires for the violation.  
* If step 1 succeeds but step 2 (audit emission) fails: the ledger row is durable; 04C correctly surfaces `failed_requires_review`. The audit gap is observability degradation, captured by `exam_audit_emission_failed`. NO rollback of the ledger row.  
* If both succeed: normal failure path; 04C surfaces `failed_requires_review` with an incident reference traceable to the audit event.

This precedence is invariant — implementations MUST NOT swap the order or couple the two writes such that step 2's failure invalidates step 1\.

**Forward-compat note (V1.1+).** If the orchestrator ever runs in an environment that cannot open a compensating transaction (e.g., strict serverless contexts where the runtime forbids nested transactions), V1.1 can introduce an outbox-driven write pattern with a `scoring_failure_outbox` table drained by a publisher worker. The 60-second invariant would then attach to outbox drain SLI rather than direct write timing. V1.0 implementations use Pattern A; this paragraph is documented so the forward-compat path doesn't need a discovery exercise later. **V1.0 SHIPS WITH PATTERN A; THIS PARAGRAPH IS NON-NORMATIVE FORWARD PLANNING.**

### **5.5 `failure_code` enumeration (V1.0 canonical set)**

V1.0 locks the complete set of failure codes that 04B's orchestrator MAY produce. The enumeration is closed: 04B revisions adding new failure codes require a 04D revision to extend this set. The codes match the §7 scoring-failure event names 1:1 for traceability:

| `failure_code` | Origin (V4.3 §) | Severity | 04C surfacing |
| ----- | ----- | ----- | ----- |
| `unattested_scoring_model_version` | V4.3 §19.6 | `page` | `failed_requires_review` |
| `scoring_model_version_missing` | V4.3 §12.1 | `critical` | `failed_requires_review` |
| `scoring_model_version_status_invalid` | V4.3 §12.1 | `page` | `failed_requires_review` |
| `scoring_constants_integrity_violation` | V4.3 §22 | `critical` | `failed_requires_review` |
| `validation_packet_unattested` | V4.3 §19.6 | `page` | `failed_requires_review` |
| `score_run_insert_failed` | V4.3 §12 (idempotency violation) | `critical` | `failed_requires_review` |
| `module2_path_missing_or_invalid` | V4.3 §15 | `page` | `failed_requires_review` |
| `outbox_event_unparseable` | V4.3 §12.2 | `page` | `failed_requires_review` |

V1.1 may add codes (additive); V1.0 implementations MUST handle unknown codes gracefully on read (log a warning, surface `failed_requires_review` regardless — code-level granularity is for ops, not for the report state derivation).

### **5.6 Dedupe semantics for recurring failures (V1.0 lock-cycle RB-04D-V1-04)**

The `one_open_failure_per_session_code` partial unique index (§5.1) enforces: **at most one open-or-acknowledged ledger row per `(test_session_id, failure_code)`**. Recurring failures during an open/acknowledged window are handled by audit events, not by new ledger rows.

**Behavior:**

* **First occurrence of a `(session, failure_code)` pair.** The compensating-transaction INSERT succeeds; ledger row is durable; `exam_scoring_failed` audit event references the new ledger row.  
* **Recurrence while the prior row is `open` or `acknowledged`.** The INSERT fails the unique constraint. The orchestrator catches this as a known signal — NOT a `report_data_integrity_violation` — and emits a new `exam_scoring_failed` audit event referencing the **existing** ledger row's ID via `payload.failure_ledger_id`. Operational metrics increment via §12 counters. No new ledger row is written.  
* **Recurrence after the prior row is `resolved`.** The unique constraint does NOT block (resolved rows are excluded from the partial index). A new ledger row is written; the prior row's resolution stands; ops can see the timeline via the per-session query in §15.2.

**Why dedupe at the ledger but not at audit events.** Audit events are the per-occurrence log; the ledger is the per-incident state. Treating every recurrence as a new incident would inflate `failed_requires_review_count` (§12.3) misleadingly and create alert spam on §13's `failed_requires_review_count_nonzero` rule. Treating them as the same open incident keeps the ops-dashboard signal sharp while preserving full audit traceability.

**Pseudocode update for Pattern A (extends §5.4):**

try:  
    compute\_and\_insert\_score\_run(test\_session\_id)  
except V43HardFailure as e:  
    \# STEP 1a: Try ledger INSERT.  
    try:  
        with new\_transaction():  
            ledger\_id \= insert\_failure\_ledger(  
                test\_session\_id=test\_session\_id,  
                failure\_code=e.code,  
                source='scoring',  
                status='open'  
            )  
    except UniqueConstraintViolation('one\_open\_failure\_per\_session\_code'):  
        \# STEP 1b: A prior open/acknowledged row exists. Find it; reuse its ID.  
        ledger\_id \= lookup\_open\_or\_acknowledged\_ledger\_id(  
            test\_session\_id=test\_session\_id,  
            failure\_code=e.code  
        )  
    \# STEP 2: Emit audit event referencing whichever ledger ID we have.  
    \# (Original row ID on first failure; existing row ID on recurrence.)  
    try:  
        emit\_audit\_event(scoring\_failure\_event(e, failure\_ledger\_id=ledger\_id))  
    except AuditEmissionFailure as ae:  
        emit\_audit\_event\_or\_log(audit\_emission\_failed\_event(ae))  
    raise

The `lookup_open_or_acknowledged_ledger_id()` helper is a SELECT against the partial unique index — single-row hit by construction.

### **5.7 No PII or answer content in ledger**

Per §2.2: `failure_code` is the only structured detail in V1.0. V1.1's `failure_message` and `metadata` columns MUST NOT carry:

* Student answer values  
* Correct answer values from Doc 02  
* Doc 01 tokens, cookies, password hashes  
* Raw stack traces containing sensitive data (sanitized exception types and message snippets are acceptable in V1.1's `failure_message`)

A redaction enforcement test fails CI if V1.1 message/metadata payloads contain forbidden patterns.

---

## **6\. Outbox observability**

Two production outbox tables exist in the Doc 04 family today; future outboxes (admin audit, scoring-failure backstop) MAY join later. 04D's job is to observe their health, not to manage their content.

### **6.1 Tables observed**

| Outbox | Owner | What 04D observes |
| ----- | ----- | ----- |
| `exam_runtime_outbox` | 04A V2.2 §5.7 | Pending row age, status distribution, retry counts, dead-letter buildup |
| `score_run_event_ledger` | 04B V4.3 §12 | Insert-once contract violations (defensive), event processing latency |

### **6.2 SLIs computed from outbox observation**

Per §12 (full metric definitions), the outbox-driven SLIs are:

* `outbox_publish_lag_seconds` — `clock_timestamp() - outbox.created_at` for rows still in `pending`; computed as max and p95 across all pending rows per outbox table  
* `outbox_pending_count` — current count of rows in `pending` status per outbox table  
* `outbox_failed_count` — current count of rows in `failed` (dead-letter) status per outbox table

These are computed via a periodic query (every 60 seconds is the V1.0 cadence) that scans the outbox tables and emits gauge metrics to the metrics pipeline. The scan is read-only and uses the indexes already declared in 04A V2.2 §5.7 (`idx_exam_runtime_outbox_pending`).

### **6.3 Outbox health is not the failure ledger**

A pending outbox row is NOT a failure ledger entry. The outbox represents:

* A completion event waiting to be consumed by 04B → not a failure; just normal queueing.  
* A retry-in-progress for a transient downstream issue → not a failure yet; the retry budget hasn't been exhausted.

Only when an outbox row reaches `failed` (dead-letter) status AND the underlying business event was scoring-impacting does the failure ledger come into play. The dead-letter handler (§14) decides whether to write a ledger row.

### **6.4 Informational tier events for outbox observability**

Outbox-state-change events are emitted at the informational tier (§4.1):

| Event name (informational) | Trigger |
| ----- | ----- |
| `outbox_row_inserted` | New row appears in any observed outbox |
| `outbox_row_published` | Row transitions to `published` |
| `outbox_row_retry` | Worker retries with incremented attempt count |
| `outbox_row_dead_lettered` | Row transitions to `failed` |

These are observability artifacts; they do NOT gate downstream behavior. The 04D alert rules in §13 read SLI gauges (not these events) for production firing.

---

## **7\. Scoring pipeline audit**

This is one of the schema-locked tiers. Every event in this section has a stable name, payload shape, and severity. Changes require a 04D revision.

### **7.1 Event enumeration**

| `event_name` | Trigger (04B V4.3 §) | Severity | `event_category` |
| ----- | ----- | ----- | ----- |
| `exam_scoring_started` | Orchestrator begins consuming an outbox event for `(test_session_id, scoring_run_kind)` | `info` | `scoring` |
| `exam_scoring_succeeded` | `score_runs` row successfully inserted | `info` | `scoring` |
| `exam_scoring_failed` | Orchestrator raises any V4.3 §19 hard failure; failure ledger row written | `page` | `scoring` |
| `exam_scoring_duplicate_event_ignored` | Insert-once contract caused a no-op (event already processed) | `info` | `scoring` |
| `exam_scoring_model_activated` | Admin promotes a `scoring_model_versions` row from `candidate` to `active` | `warning` | `scoring` |
| `exam_scoring_model_superseded` | Admin transitions a row from `active` to `superseded` | `warning` | `scoring` |
| `exam_scoring_constants_sealed` | Admin completes the constants sealing for an active version | `warning` | `scoring` |
| `exam_validation_packet_attested` | Admin attaches the validation packet hash to a scoring version | `warning` | `scoring` |

### **7.2 Payload contracts**

type ScoringStartedPayload \= {  
  scoring\_run\_kind: 'full' | 'partial';  
  source\_outbox\_event\_id: string;  
  test\_form\_id: string;  
  scoring\_model\_version: string;  
};

type ScoringSucceededPayload \= {  
  scoring\_run\_kind: 'full' | 'partial';  
  source\_outbox\_event\_id: string;  
  score\_run\_id: string;  
  scoring\_model\_version: string;  
  total\_scaled: number | null;             // null for partial  
  partial\_display\_scaled: number | null;   // null for full  
  rw\_scaled: number | null;  
  math\_scaled: number | null;  
  latency\_ms: number;                       // orchestrator start → score\_runs insert  
};

type ScoringFailedPayload \= {  
  scoring\_run\_kind: 'full' | 'partial';  
  source\_outbox\_event\_id: string;  
  failure\_code: string;                     // matches §5.5 enum  
  scoring\_model\_version: string | null;     // null if version-not-found  
  failure\_ledger\_id: string;                // the ledger row this failure produced  
  latency\_ms: number;                       // orchestrator start → failure raise  
};

type ScoringDuplicateEventIgnoredPayload \= {  
  source\_outbox\_event\_id: string;  
  existing\_score\_run\_id: string;  
};

type ScoringModelActivatedPayload \= {  
  scoring\_model\_version: string;  
  prior\_active\_version: string | null;       // the version that transitioned to superseded, if any  
  constants\_sha256: string;  
  validation\_packet\_sha256: string;  
};

type ScoringModelSupersededPayload \= {  
  scoring\_model\_version: string;  
  superseded\_at: string;  
  reason: string;  
};

type ScoringConstantsSealedPayload \= {  
  scoring\_model\_version: string;  
  constants\_sha256: string;  
};

type ValidationPacketAttestedPayload \= {  
  scoring\_model\_version: string;  
  validation\_packet\_sha256: string;  
  validation\_packet\_url: string;  
};

### **7.3 Cross-reference to failure ledger**

`exam_scoring_failed.payload.failure_ledger_id` MUST point to the `exam_failure_ledger.id` written for this failure (per §5.4 timing requirement). Test: for every `exam_scoring_failed` event, the referenced ledger row exists and has `status IN ('open', 'acknowledged', 'resolved')` and `failure_code` matching the event payload's `failure_code`.

### **7.4 Why scoring success is `info`, not `warning`**

The success event is high-volume (one per scored session). Setting severity above `info` would create noise in alerting pipelines that filter by severity. Operational anomalies (latency spikes, unexpected failure-rate jumps) are detected via the §12 SLI metrics, not by raising the success event's severity.

---

## **8\. Admin action audit**

This is the second schema-locked tier. Every admin-initiated mutation in the Doc 04 family produces an audit row in the same transaction as the primary mutation (per invariant \#2).

### **8.1 Event enumeration (04A admin actions)**

| `event_name` | Trigger (04A V2.2 §) | Severity | Notes |
| ----- | ----- | ----- | ----- |
| `exam_admin_form_publish` | Form transitions `draft → published` per §6.3 | `warning` | Includes `score_table_version`, routing thresholds, override info if applicable |
| `exam_admin_form_publish_rejected` | Publish handler rejects per §6.2 / §16.3 subcodes | `warning` | Records the rejection subcode \+ details |
| `exam_admin_form_retire` | Admin flips `is_selectable = false` per 04A V2.2 §6.5 (V2.2 lock-cycle BL1) | `warning` | Records reason if Product runbook specifies |
| `exam_admin_routing_override_used` | Form published with `routing_override_approved_by` non-null per §6.3 | `warning` | Carries override approver UUID \+ ticket ID |
| `exam_admin_outbox_retry` | Admin manually retries a `failed` outbox row | `warning` | Records original failure, retry target |
| `exam_admin_outbox_deadletter_reset` | Admin resets a `failed` row to `pending` for re-processing | `warning` | High-trust action; carries justification |

### **8.2 Event enumeration (04B admin actions)**

The 04B admin actions overlap with the §7 scoring events for some transitions; the distinction is intent:

* **§7 events** observe what the system does (scoring run started/succeeded/failed) — automatic emissions tied to runtime behavior.  
* **§8 events** observe what an admin did (model activated, constants sealed) — explicit human-actor emissions tied to admin endpoint invocations.

For some transitions (e.g., model activation), both events fire: §8 captures the admin intent; §7 captures the resulting state change. This is intentional — separating intent from effect supports compliance review.

| `event_name` | Trigger (04B V4.3 §) | Severity | Notes |
| ----- | ----- | ----- | ----- |
| `exam_admin_score_failure_acknowledged` | Admin transitions failure ledger row to `acknowledged` per §5.3 | `info` | Standard ops workflow; low-stakes audit |
| `exam_admin_score_failure_resolved` | Admin transitions failure ledger row to `resolved` per §5.3 | `warning` | Closes the loop on `failed_requires_review`; ops-impacting |
| `exam_admin_scoring_remediation` | Admin manually triggers a re-score after a resolved failure | `page` | Bypasses normal orchestration; carries justification \+ ticket ID |

### **8.3 Payload contracts**

type AdminFormPublishPayload \= {  
  test\_form\_id: string;  
  test\_form\_name: string;  
  score\_table\_version: string;  
  routing\_threshold\_rw: number;  
  routing\_threshold\_m: number;  
  routing\_override: {  
    approved\_by: string;            // UUID  
    reason: string;  
    ticket\_id: string;  
  } | null;  
};

type AdminFormPublishRejectedPayload \= {  
  test\_form\_id: string;  
  rejection\_subcode:  
    | 'score\_table\_version\_not\_found'  
    | 'score\_table\_version\_not\_active'  
    | 'routing\_threshold\_override\_required'  
    | 'invalid\_form\_composition';  
  details: object;                     // matches 04A V2.2 §16.3 details payload  
};

type AdminFormRetirePayload \= {  
  test\_form\_id: string;  
  retired\_at: string;  
  reason: string | null;  
};

type AdminRoutingOverrideUsedPayload \= {  
  test\_form\_id: string;  
  routing\_threshold\_rw: number;  
  routing\_threshold\_m: number;  
  expected\_rw\_range: \[number, number\];  
  expected\_m\_range: \[number, number\];  
  approved\_by: string;  
  reason: string;  
  ticket\_id: string;  
};

type AdminOutboxRetryPayload \= {  
  outbox\_table: 'exam\_runtime\_outbox' | 'score\_run\_event\_ledger';  
  outbox\_row\_id: string;  
  prior\_failure\_reason: string;  
  retry\_count: number;  
};

type AdminOutboxDeadLetterResetPayload \= {  
  outbox\_table: string;  
  outbox\_row\_id: string;  
  prior\_status: 'failed';  
  reset\_justification: string;  
  ticket\_id: string;  
};

type AdminScoreFailureAcknowledgedPayload \= {  
  failure\_ledger\_id: string;  
  test\_session\_id: string;  
  failure\_code: string;  
};

type AdminScoreFailureResolvedPayload \= {  
  failure\_ledger\_id: string;  
  test\_session\_id: string;  
  failure\_code: string;  
  resolution\_summary: string;  
  ticket\_id: string;  
};

type AdminScoringRemediationPayload \= {  
  test\_session\_id: string;  
  triggered\_by\_failure\_ledger\_id: string;  
  remediation\_justification: string;  
  ticket\_id: string;  
};

### **8.4 Same-transaction emission (invariant \#2 elaboration)**

For DB-mutating admin actions (form publish, retirement, override, ledger acknowledgement/resolution), the audit row INSERT MUST execute in the same database transaction as the primary mutation. If the audit INSERT fails (constraint violation, etc.), the primary mutation rolls back.

For action sequences that span multiple transactions (e.g., scoring remediation that re-triggers orchestration), the audit row for the admin intent MUST land BEFORE the next state-changing step proceeds. The orchestration may fail subsequently; the audit row already documents that an admin attempted the action.

This is stronger than "best-effort logging" because admin actions are the primary surface where regulatory compliance / security review happens; missing audit on an admin action is a contract violation.

### **8.5 Audit-before-irreversible-side-effect rule (V1.0 lock-cycle NB\#2)**

For admin actions whose primary mutation CANNOT be represented as a single database transaction — multi-step orchestrations, calls into external systems, file-system operations, etc. — the same-transaction rule cannot apply mechanically. The canonical V1.0 stance:

**When a primary action cannot be wrapped in a single DB transaction, the admin audit row MUST be written and committed BEFORE the irreversible external side effect begins.**

Examples:

* **Manual outbox dead-letter reset** (§8.1 `exam_admin_outbox_deadletter_reset`): the reset modifies the outbox row AND triggers downstream re-processing. The audit row MUST be committed before the reset UPDATE proceeds, so a post-reset crash does not leave the reset un-attributable.  
* **Scoring remediation re-trigger** (§8.2 `exam_admin_scoring_remediation`): the remediation enqueues a new scoring run AND may dispatch to external infrastructure. The audit row MUST be committed before the enqueue, so an admin's intent is recorded even if the orchestration subsequently fails.  
* **Form retirement that affects external content distribution** (§8.1 `exam_admin_form_retire`): if retirement triggers downstream content-CDN invalidation, the audit row MUST be committed before the invalidation request is dispatched.

The principle: audit precedes irreversibility. An admin cannot perform a side effect that ops cannot trace back to them. If audit emission fails, the irreversible step does NOT proceed — the admin sees an error and retries.

---

## **9\. Runtime state transition audit (informational tier)**

These events feed dashboards and incident reconstruction. Per §4.1 hybrid taxonomy, they live in `exam_audit_events_informational` and are evolvable — adding/renaming/restructuring them does NOT require a 04D revision.

### **9.1 Event enumeration (informational)**

| `event_name` | Trigger (04A V2.2 §) | Typical use |
| ----- | ----- | ----- |
| `exam_session_created` | `POST /api/tests/sessions` succeeds per §7.3 | Volume tracking, cohort analysis |
| `exam_module_started` | Module start endpoint succeeds per 04A V2.2 §8.5 | Funnel analysis |
| `exam_answer_submitted` | Answer submission succeeds per §11.2 (new submission, not replay) | Engagement tracking |
| `exam_answer_idempotent_replay` | Answer submission returns stored response per §11.2 replay path | Client-bug detection |
| `exam_answer_idempotency_body_mismatch` | Same idempotency key, different body per §11.2 step 2 (V2.2 lock-cycle HIGH1) | Client-bug investigation |
| `exam_module_submitted` | Module 1 or Module 2 submitted by student | Funnel analysis |
| `exam_module_timeout_submitted` | Module auto-submits via §8.4 timeout path | Strict-mode behavior tracking |
| `exam_module2_path_locked` | Routing decision executed per §9.1 | Internal-only; carries `module2_path` (admin-tagged only) |
| `exam_section_submitted` | Section reaches `submitted` state | Funnel analysis |
| `exam_session_completed` | Session reaches `completed` state per §13 | Volume tracking, cross-check vs outbox events |
| `exam_session_abandoned_final` | Session reaches `abandoned_final` per §14.3 | Abandonment funnel |
| `exam_session_partial_scored_abandoned` | Session reaches `partial_scored_abandoned` per §14.3 | Partial-completion tracking |
| `exam_form_published` | Form transitions `draft → published` (mirrors §8 admin event with student-facing context) | Dashboard rollups |

### **9.2 `module2_path` redaction (Parent V3.0 §9 \#15)**

`exam_module2_path_locked` carries the routed path in its payload. Per Parent V3.0 §9 \#15 \+ 04A V2.2 §3.4 \+ Doc 04C V1.0 invariant \#3, `module2_path` is internal-only:

* The event is emitted with `actor_kind = 'system'` and stored with the path in payload.  
* Read access to this event is restricted to admin role only (§17 access control).  
* Student-tier or guardian-tier audit-dump endpoints (out of scope for V1.0; flagged for §17.4 V1.1) MUST filter out `exam_module2_path_locked` events.

### **9.3 Why these are informational, not schema-locked**

The runtime non-failure events are emitted at high volume (every session, every module, every answer). Locking their payload shapes would create a heavy schema-revision burden for any UX tweak that wants to capture additional context. The hybrid stance lets these events evolve with Product needs without a 04D revision.

The trade-off: downstream consumers (ops dashboards, Doc 09 future analytics) MUST defensively handle missing or renamed fields. Schema validation at read time is recommended but not required.

### **9.4 What is NOT in this section**

* **Heartbeats** (04A §8.3) are NOT emitted as audit events. They're high-volume, low-signal; metrics (§12 `answer_submit_p95_latency` style) capture the operational signal.  
* **State reads** (`GET /state`) are NOT audited. Reads are §6 informational events on a different code path; over-auditing reads creates noise.

---

## **10\. Report access audit (informational tier)**

These events observe 04C report and review accesses. Per §4.1 hybrid taxonomy, they live in `exam_audit_events_informational` and are evolvable.

### **10.1 Event enumeration (informational)**

| `event_name` | Trigger (04C V1.0 §) | Typical use |
| ----- | ----- | ----- |
| `exam_report_requested` | Any 04C `/report` or `/report/status` endpoint receives a request after passing auth | Access volume tracking |
| `exam_report_returned` | 04C returns a payload (any state) | Funnel: requested → returned |
| `exam_report_pending_returned` | Specifically when `report_state = 'scoring_pending'` is returned | Pending-state polling tracking |
| `exam_report_failed_requires_review_returned` | Specifically when `report_state = 'failed_requires_review'` is returned | Incident-impact tracking |
| `exam_report_unavailable_returned` | When `report_state = 'unavailable'` is returned with HTTP 200 (revoked access) | Entitlement-lapse impact tracking |
| `exam_review_unlocked` | First `/review` or `/review/items` request after `score_runs` insert (per session per student) | Engagement tracking |
| `exam_review_item_viewed` | `/review/items/:question_id` request | Engagement tracking; high-volume |
| `guardian_exam_report_requested` | Guardian `/report` request | Guardian engagement tracking |
| `guardian_exam_report_returned` | Guardian receives a payload | Guardian funnel |

### **10.2 PII / answer redaction in report access events**

These events MUST NOT include:

* Scaled scores (`total_scaled`, `rw_scaled`, `math_scaled`)  
* Decomposition fields (`rw_module1_correct`, etc.)  
* Question content (`stem`, `options`, `explanation`)  
* Student answer values  
* `module2_path` in student-tier or guardian-tier audit payloads

These events MAY include:

* `test_session_id`, `student_id`, `request_id`  
* `report_state` value (the discriminator string only)  
* `review_unlocked` boolean  
* HTTP status returned  
* Latency

### **10.3 Note: enumeration-probing detection lives in §11**

The `exam_report_forbidden_403` event, which captures `never_existed` access classifications returning HTTP 403 (Doc 04C V1.0 §16.6), is **schema-locked in the security tier (§11)** — NOT informational. Reason: its payload carries enumeration-sensitive information (which session ID a requester tried, classification reason) that is operationally similar to `exam_unauthorized_session_access`. Keeping all enumeration-probing signals in the security tier ensures consistent read-access restriction (§17 security-role gating) and consistent retention (§16 schema-locked tier retention).

V1.0 lock-cycle decision (RB-04D-V1-03): an earlier draft tried to keep this event in informational with a "carve-out" lock; the carve-out is a design smell — events with enumeration-sensitive payloads belong in the security tier proper.

---

## **11\. Security audit events**

This is the third schema-locked tier. Security events have stable names, locked payloads, and are retained at the schema-locked tier's retention window (§17).

### **11.1 Event enumeration**

| `event_name` | Trigger | Severity | Notes |
| ----- | ----- | ----- | ----- |
| `exam_auth_failure` | Any 04A/04C endpoint receives a request with invalid/expired token | `info` | High-volume; threshold-based alert (§13) |
| `exam_unauthorized_session_access` | Authenticated requester attempts to access a session they don't own (student endpoint) or aren't linked to (guardian endpoint) | `warning` | Aligns with `exam_report_forbidden_403`; both events are security-tier and read-restricted per §17 |
| `exam_report_forbidden_403` | 04C `/report` or `/review/*` endpoint classifies the request as `never_existed` per Doc 04C V1.0 §16.6 and returns HTTP 403 | `info` | Enumeration-probing detection signal; volume thresholds drive §13.4 per-actor alerts. Security-tier (V1.0 lock-cycle RB-04D-V1-03). |
| `exam_admin_action_authorization_failed` | Non-admin role attempts an admin endpoint | `page` | Should be rare; indicates a role-check bypass attempt or misconfigured role assignment |
| `exam_role_assumption_attempted` | Token presents role claim incompatible with the requested endpoint's role | `warning` | Distinct from `exam_admin_action_authorization_failed`; covers all role mismatches |
| `exam_audit_redaction_violation_detected` | Serializer detected a forbidden field in an audit payload before emission (the redaction guard prevented the violation) | `page` | Defensive — a fired alert here means a code path tried to log forbidden data |
| `exam_audit_emission_failed` | An async audit emission (informational tier) lost an event due to queue overflow or service degradation | `warning` | Volume threshold alert (§13) |
| `exam_data_integrity_violation_detected` | Any 04A/04B/04C defensive check (e.g., duplicate `score_runs` in 04C §7.4) fired | `critical` | Includes the originating system \+ violation type |
| `exam_pii_exposure_attempt_blocked` | Audit serializer detected a structured-data pattern matching a known PII regex and blocked emission | `critical` | Defensive — should never fire in healthy operation |

### **11.2 Payload contracts**

type ExamAuthFailurePayload \= {  
  endpoint: string;  
  reason: 'token\_missing' | 'token\_invalid' | 'token\_expired' | 'token\_signature\_mismatch';  
  // No token content; no actor ID (request was unauthenticated)  
};

type ExamUnauthorizedSessionAccessPayload \= {  
  endpoint: string;  
  attempted\_session\_id: string;  
  actor\_id: string;  
  actor\_kind: 'student' | 'guardian';  
  classification: 'never\_existed';    // V1.0: aligned with 04C §16.6  
};

type ExamReportForbidden403Payload \= {  
  endpoint: string;                                     // e.g., '/api/tests/sessions/:id/report'  
  attempted\_session\_id: string;  
  actor\_id: string;  
  actor\_kind: 'student' | 'guardian' | 'admin' | 'unauthenticated';  
  classification\_reason: 'session\_not\_found' | 'ownership\_mismatch' | 'no\_guardian\_link' | 'role\_mismatch';  
};

type ExamAdminActionAuthorizationFailedPayload \= {  
  endpoint: string;  
  actor\_id: string;  
  actor\_kind: 'student' | 'guardian' | 'unknown';  
  attempted\_action: string;            // endpoint path or admin action name  
};

type ExamRoleAssumptionAttemptedPayload \= {  
  endpoint: string;  
  actor\_id: string;  
  presented\_role: string;  
  required\_role: string;  
};

type ExamAuditRedactionViolationDetectedPayload \= {  
  audit\_event\_name: string;  
  forbidden\_field\_name: string;  
  source\_code\_location: string | null;  // file:line if introspection available  
  // No actual forbidden value content  
};

type ExamAuditEmissionFailedPayload \= {  
  audit\_event\_name: string;  
  reason: 'queue\_overflow' | 'serializer\_error' | 'transport\_failure' | 'unknown';  
  // No payload content  
};

type ExamDataIntegrityViolationDetectedPayload \= {  
  detecting\_system: '04A' | '04B' | '04C' | '04D';  
  violation\_type: string;               // e.g., 'duplicate\_score\_runs', 'orphaned\_outbox\_event'  
  related\_session\_id: string | null;  
  related\_score\_run\_id: string | null;  
  related\_failure\_ledger\_id: string | null;  
};

type ExamPiiExposureAttemptBlockedPayload \= {  
  audit\_event\_name: string;  
  detected\_pattern\_class: string;       // e.g., 'email\_address', 'phone\_number', 'ssn\_like'  
  source\_code\_location: string | null;  
  // No content of the detected value  
};

### **11.3 Security events are read-restricted (§18)**

Read access to `exam_audit_events` filtered by `event_category = 'security'` is restricted to security-role admins (§18). Standard ops/support admin roles do NOT have read access to security events. This separates incident investigation (where security context is needed) from routine operations (where it isn't).

### **11.4 Why some severities are `info`**

`exam_auth_failure` is `info` despite being security-tier because the absolute count is low-signal (any production system has continuous auth failures from bots, expired sessions, etc.). The signal comes from §13 burst-detection alerts, not from individual event severity. The same logic applies to high-volume informational events in other tiers.

---

## **12\. Metrics, SLIs, SLOs**

V1.0 commits to concrete numeric SLO targets per Karl alignment Q3. Targets are subject to production tuning; the metric names and definitions are stable.

**Target grounding (V1.0):** the numeric targets below are derived from three signals:

* **Lyceon UX expectations**: students completing a test expect to see scores within \~1 minute. The 60-second `scoring_time_to_score_run` p95 \+ 90-second `report_unlock_lag_seconds` p95 \+ 60-second `e2e_completion_to_score_available_p95` together bound this expectation with operational headroom.  
* **Standard SaaS-adjacent reliability norms**: 99.5% success rate on session create (high-stakes user-initiated action), 0.1% error rate on answer submit (per-keystroke action; must feel reliable), p95 latency targets aligned with typical interactive-form benchmarks (≤500ms).  
* **Defensive zero-tolerance for known failure modes**: 0 dead-lettered outbox rows, 0 `failed_requires_review_count`, 0 sustained data-integrity violations. These aren't aspirational — they're contractual: a single occurrence is operationally significant and warrants paging.

Production data over the first 30–90 days of operation may justify loosening some targets (the p95 latency targets in particular) or tightening others. V1.1 of 04D revisits the table after baseline data exists.

### **12.1 Runtime SLIs (04A surface)**

| Metric name | Type | Definition | V1.0 SLO target |
| ----- | ----- | ----- | ----- |
| `exam_session_create_success_rate` | rate | (count of `POST /api/tests/sessions` returning 2xx) / (total non-401/403 attempts) over rolling 5m | ≥ 99.5% |
| `answer_submit_p95_latency_ms` | histogram p95 | server-side handler latency for `POST /api/tests/answer` excluding network | ≤ 500 ms |
| `answer_submit_error_rate` | rate | (count of `POST /api/tests/answer` returning 5xx) / (total submissions) over rolling 5m | ≤ 0.1% |
| `module_timeout_handler_success_rate` | rate | timeout handler executions producing the expected state transition / total timeout invocations over rolling 5m | ≥ 99.9% |
| `idempotency_replay_rate` | rate | (count of idempotent replays) / (total answer submissions) over rolling 1h | informational; no SLO |
| `idempotency_body_mismatch_count` | counter | total `exam_answer_idempotency_body_mismatch` events over rolling 1h | informational; ≥ 100/h fires investigation (not a hard alert) |

### **12.2 Scoring SLIs (04B surface)**

| Metric name | Type | Definition | V1.0 SLO target |
| ----- | ----- | ----- | ----- |
| `scoring_time_to_score_run_seconds` | histogram p95 | time from `exam_session_completed` outbox row creation to `score_runs` row insert | ≤ 60 seconds |
| `scoring_time_to_score_run_p99` | histogram p99 | same window, 99th percentile | ≤ 180 seconds |
| `scoring_failure_rate` | rate | (count of `exam_scoring_failed` events) / (count of `exam_scoring_started` events) over rolling 1h | ≤ 0.1% |
| `outbox_publish_lag_seconds` | gauge | max(`clock_timestamp() - exam_runtime_outbox.created_at`) where status \= 'pending' | ≤ 60 seconds (alert at 120s) |
| `outbox_pending_count` | gauge | count of `exam_runtime_outbox` rows where status \= 'pending' | informational; alert if \> 100 |
| `outbox_failed_count` | gauge | count of `exam_runtime_outbox` rows where status \= 'failed' | 0 (any failed row fires §13 alert) |
| `score_run_event_ledger_duplicate_rate` | counter | total duplicate-event-ignored events over rolling 1h | informational; ≥ 10/h fires investigation |

### **12.3 Reporting SLIs (04C surface)**

| Metric name | Type | Definition | V1.0 SLO target |
| ----- | ----- | ----- | ----- |
| `report_unlock_lag_seconds` | histogram p95 | time from `test_sessions.completed_at` to first successful `/report` request returning `scored` | ≤ 90 seconds |
| `failed_requires_review_count` | gauge | count of sessions currently surfacing `failed_requires_review` (i.e., open/acknowledged failure ledger entries with no subsequent `score_runs`) | 0 (any count fires §13 alert) |
| `report_request_p95_latency_ms` | histogram p95 | server-side handler latency for `GET /api/tests/sessions/:id/report` excluding network | ≤ 200 ms |
| `report_request_error_rate` | rate | (count of `/report` returning 5xx) / (total `/report` requests) over rolling 5m | ≤ 0.1% |
| `exam_report_forbidden_403_per_actor_rate` | rate | per-actor 403 count over rolling 5m | informational; per-actor threshold drives §13.4 |

### **12.4 Cross-system SLO**

| Metric name | Type | Definition | V1.0 SLO target |
| ----- | ----- | ----- | ----- |
| `e2e_completion_to_score_available_p95` | histogram p95 | end-to-end time from completion (04A) to `report_state = scored` available (04C) | ≤ 60 seconds |
| `e2e_completion_terminal_state_resolved_5min` | rate | (count of sessions reaching either `scored` / `partial_scored` / `failed_requires_review` within 5 min of completion) / (total completions) over rolling 1h | ≥ 99.5% |

The second metric captures invariant \#1's reconstructability commitment: a completed session reaches a defined terminal state within an operationally-meaningful window. If a session lingers in `scoring_pending` past 5 minutes without either succeeding or producing a failure ledger entry, that is an audit gap.

### **12.5 SLO error budget framing**

For each rate SLO (success rate, error rate, failure rate), the **error budget** for a rolling 30-day window is `1 - SLO_target`. For example:

* `exam_session_create_success_rate` SLO 99.5% → error budget 0.5% over 30 days → \~3.6 hours of acceptable degradation per month  
* `scoring_failure_rate` SLO 0.1% → error budget 99.9% of attempts must succeed → \~1 in 1000 may fail without breaching budget

Error budget consumption is computed by the metrics pipeline and surfaces on the ops dashboard. Burning more than 50% of the budget in the first 50% of the window fires an early-warning alert (§13).

---

## **13\. Alerting rules**

V1.0 alerting rules map metrics to operator action. Each rule has a severity (matching §3 invariant \#8 enum) and a runbook reference (§14).

### **13.1 Alert table**

| Alert name | Trigger condition | Severity | Runbook |
| ----- | ----- | ----- | ----- |
| `outbox_dead_letter_immediate` | `outbox_failed_count > 0` for any observed outbox | `page` | §14.2 |
| `outbox_publish_lag_high` | `outbox_publish_lag_seconds > 120` for \> 5 minutes | `page` | §14.1 |
| `outbox_pending_buildup` | `outbox_pending_count > 100` for \> 10 minutes | `warning` | §14.1 |
| `scoring_failure_rate_high` | `scoring_failure_rate > 1%` over rolling 1h | `page` | §14.3 |
| `scoring_failure_rate_critical` | `scoring_failure_rate > 5%` over rolling 15m | `critical` | §14.3 \+ on-call escalation |
| `failed_requires_review_count_nonzero` | `failed_requires_review_count > 0` for \> 10 minutes | `page` | §14.4 |
| `e2e_completion_terminal_state_resolved_5min_breach` | `< 99% of completions reach terminal state within 5 min` over rolling 1h | `page` | §14.5 |
| `answer_submit_error_rate_high` | `answer_submit_error_rate > 0.5%` over rolling 5m | `page` | §14.6 |
| `answer_submit_p95_latency_high` | `answer_submit_p95_latency_ms > 1000` for \> 5 minutes | `warning` | §14.6 |
| `report_request_error_rate_high` | `report_request_error_rate > 0.5%` over rolling 5m | `page` | §14.7 |
| `auth_failure_burst_per_actor` | A single actor produces \> 50 `exam_auth_failure` events in 5 minutes | `warning` | §14.8 |
| `forbidden_403_burst_per_actor` | A single actor produces \> 100 `exam_report_forbidden_403` events in 5 minutes | `warning` | §14.8 (enumeration probing) |
| `audit_emission_failure_burst` | `exam_audit_emission_failed` count \> 1% of total events over rolling 5m | `warning` | §14.9 |
| `data_integrity_violation_immediate` | any `exam_data_integrity_violation_detected` event | `critical` | §14.10 |
| `pii_exposure_attempt_blocked_immediate` | any `exam_pii_exposure_attempt_blocked` event | `critical` | §14.10 |
| `audit_redaction_violation_detected_immediate` | any `exam_audit_redaction_violation_detected` event | `critical` | §14.10 |
| `error_budget_burned_50pct_at_50pct` | any SLO error budget consumed \> 50% with \< 50% window elapsed | `warning` | §14.11 |

### **13.2 Why `outbox_dead_letter_immediate` is `page`, not `critical`**

A single dead-letter row is alarming but recoverable — it represents one stuck event, not a systemic failure. Pages get on-call attention within \~15 minutes; critical escalates to senior engineering and incident commander within \~5 minutes. The dead-letter alert pages on first occurrence so it gets human review; if multiple dead-letters accumulate, that pattern would surface via `audit_emission_failure_burst` or related metrics and escalate.

### **13.3 Severity escalation rules**

* `info` events are not alerted; they feed dashboards only.  
* `warning` events are alerted via low-noise channels (e.g., team Slack), with no on-call paging.  
* `page` events are alerted via on-call paging with a 15-minute response SLA.  
* `critical` events are alerted via on-call paging \+ automatic escalation to senior engineering \+ incident commander declaration within 5 minutes.

These map to invariant \#8's canonical severity enum.

### **13.4 Per-actor burst alerts (anti-enumeration)**

`forbidden_403_burst_per_actor` and `auth_failure_burst_per_actor` are designed to detect:

* Credential-stuffing attempts (high `auth_failure` from one IP/actor)  
* Session-ID enumeration attempts (high `forbidden_403` from one authenticated actor probing session IDs)

The per-actor threshold is intentionally high (50–100 in 5 minutes) to avoid false positives from buggy clients. Security tooling MAY supplement with lower-threshold anomaly detection; 04D's contribution is the underlying event stream \+ threshold-based alert.

### **13.5 Alert routing is operational concern**

Where alerts route (PagerDuty, Slack channel, email) is an operational concern owned by Ops / DevOps runbooks, not by 04D. 04D's responsibility ends at "alert defined with severity \+ runbook reference."

---

## **14\. Dead-letter and replay runbooks**

V1.0 documents the procedural framework. Detailed runbook content (commands, screenshots, contact lists) lives in operational runbook material maintained outside this spec; this section anchors what each runbook MUST cover.

### **14.1 Outbox pending buildup / publish lag**

Triggers: `outbox_pending_buildup`, `outbox_publish_lag_high`.

Investigation steps:

1. Check the outbox publisher worker status. If down, restart and verify it processes from `created_at` ASC.  
2. Check downstream consumer (04B orchestrator for `exam_runtime_outbox`; report consumers for `score_run_event_ledger`). If the consumer is degraded, address its health first.  
3. If buildup persists despite healthy infrastructure, sample 3-5 pending rows and inspect their payload \+ `attempts` count. A consistent failure signature across rows indicates a payload-shape mismatch or a downstream contract violation.  
4. If a contract violation is identified, escalate to the owner doc (04A for outbox shape; 04B for consumer expectations).

Remediation: workers re-process automatically once unblocked. Rows that have exhausted retry budget (`status = 'failed'`) trigger §14.2 separately.

### **14.2 Outbox dead-letter**

Triggers: `outbox_dead_letter_immediate`.

Investigation steps:

1. Identify the dead-lettered row(s). Inspect `failure_reason` (04A V2.2 §5.7 \+ 04B V4.3 §12) for the recorded cause.  
2. Determine root cause: transient infrastructure issue (downstream temporary outage), payload corruption (canonical data drift), or contract violation (downstream expected something different from what was sent).  
3. For transient causes once resolved: reset to `pending` via `exam_admin_outbox_deadletter_reset` admin action (§8). The reset MUST carry a justification \+ ticket ID (§8.3 payload).  
4. For non-transient causes: do NOT reset. Investigate the underlying issue; consider whether canonical data must be corrected before retry would succeed.

A dead-letter row left unresolved blocks any consumer relying on event ordering downstream. The reset action's audit event is the canonical record of operator intervention.

### **14.3 Scoring failure rate elevated**

Triggers: `scoring_failure_rate_high`, `scoring_failure_rate_critical`.

Investigation steps:

1. Group recent `exam_scoring_failed` events by `failure_code`. A single dominant code indicates a specific cause; spread codes indicate an infrastructure issue.  
2. For `unattested_scoring_model_version` / `validation_packet_unattested`: check deploy state — was V4.3 attestation completed? If not, halt new scoring until attestation lands.  
3. For `scoring_constants_integrity_violation`: this is CRITICAL — constants tampering is implied. Engage security \+ halt scoring immediately.  
4. For `score_run_insert_failed`: investigate DB health, idempotency-ledger state.

Remediation: failure ledger entries created during the incident remain `open`. Once root cause is resolved, batch-resolve via `exam_admin_score_failure_resolved` (§8.2) — each ledger row gets its own admin action audit row for traceability. Sessions affected MAY require re-scoring via `exam_admin_scoring_remediation` (§8.2).

### **14.4 `failed_requires_review` count nonzero**

Triggers: `failed_requires_review_count_nonzero`.

Investigation steps:

1. List all sessions surfacing `failed_requires_review` (open or acknowledged failure ledger rows with no subsequent `score_runs`).  
2. Categorize by `failure_code`. Group remediation per category (see §14.3).  
3. For each affected student, draft student-facing communication if remediation will exceed expected scoring window (per §10.4 of Doc 04C — student-facing copy uses generic supportive language with `incident_reference`).  
4. Resolve failure ledger entries in batches as remediation completes.

This runbook is the primary student-impact one — it represents students currently unable to see their scores.

### **14.5 E2E terminal state SLO breach**

Triggers: `e2e_completion_terminal_state_resolved_5min_breach`.

Investigation steps:

1. Identify completed sessions that have not reached any terminal state (`scored`, `partial_scored`, `failed_requires_review`) within 5 minutes.  
2. For each, trace the pipeline: outbox row written? Consumed by 04B? `score_runs` written? Or failure ledger written?  
3. The gap is in one of the steps; treat as outbox issue (§14.1/14.2), scoring failure (§14.3), or ledger write failure (escalate immediately — invariant \#3 violation).

### **14.6 Answer-submit latency or error spike**

Triggers: `answer_submit_p95_latency_high`, `answer_submit_error_rate_high`.

This is a 04A runtime issue. Investigation routes through 04A's operational owners; 04D's audit data (request\_id, latency, error code) supports incident triage but the root-cause analysis is in 04A's domain.

### **14.7 Report-request error spike**

Triggers: `report_request_error_rate_high`.

Most common causes: 04C-served-`report_data_integrity_violation` (duplicate score runs, missing disclosure version — Doc 04C V1.0 §16.7); upstream DB issues affecting derivation queries; Doc 02 question fetch failures during review.

### **14.8 Auth / 403 burst (anti-abuse)**

Triggers: `auth_failure_burst_per_actor`, `forbidden_403_burst_per_actor`.

Investigation steps:

1. Identify the actor and the targeted endpoints / session IDs.  
2. Cross-reference with Doc 01 for actor's session history.  
3. If clearly abusive (sequential session-ID probing, credential stuffing), escalate to security \+ temporarily block the actor at the auth layer.  
4. If false positive (buggy client retrying), no action needed; tune threshold if recurring.

### **14.9 Audit emission failure burst**

Triggers: `audit_emission_failure_burst`.

Indicates the async audit queue is degraded (queue overflow, serializer regression, transport failure). Investigation:

1. Check the queue depth and worker status.  
2. Sample failed events. A consistent failure signature (e.g., one specific event name) indicates a recent code change introduced a bad serializer.  
3. Restart workers or roll back the offending change.

Lost informational events do NOT trigger student-facing impact, but the alert exists because audit completeness is critical for incident reconstruction. A sustained audit gap during an actual incident makes the post-mortem much harder.

### **14.10 Data integrity / PII exposure / redaction violation**

Triggers: `data_integrity_violation_immediate`, `pii_exposure_attempt_blocked_immediate`, `audit_redaction_violation_detected_immediate`.

These are CRITICAL alerts. Each represents a defensive guard that fired — the system caught a violation before it propagated, but the fact that the guard fired means there's a code path or data state that shouldn't exist.

Investigation steps:

1. Capture full event payload \+ correlation IDs immediately.  
2. Identify the originating code path (`source_code_location` if available).  
3. For data integrity: trace which canonical table is in a violating state; do NOT auto-remediate.  
4. For PII exposure: identify what data triggered the guard; rotate any potentially-exposed credentials if relevant.  
5. For redaction: identify what field/event was caught; review recent code changes that introduced the path.  
6. Escalate to senior engineering \+ security. These don't auto-resolve.

### **14.11 Error budget burn alerts**

Triggers: `error_budget_burned_50pct_at_50pct`.

Indicates an SLO is on track to breach by end-of-window. Investigation routes to the owning system; 04D's contribution is the alert itself plus the metric history showing the burn rate.

---

## **15\. Incident states consumed by 04C**

This section anchors the cross-doc contract between 04D and Doc 04C V1.0 §20.5.

### **15.1 The minimum contract (V1.0)**

Per Doc 04C V1.0 §20.5, 04C's report-state derivation depends on `exam_failure_ledger` carrying at minimum:

* `id` — for incident reference generation (Doc 04C V1.0 §10.3)  
* `test_session_id` — for derivation join  
* `failure_code` — for ops categorization (NOT student-facing per Doc 04C V1.0 §10.3)  
* `status` — for derivation predicate (`open` OR `acknowledged` → surface `failed_requires_review`; `resolved` → fallback)  
* `created_at` — for ordering and SLI computation

04D V1.0 honors this contract exactly (§5.1 schema).

### **15.2 Read access pattern**

Doc 04C V1.0 §4.2 \+ §5.3 reads the ledger via:

SELECT id, status, created\_at  
FROM exam\_failure\_ledger  
WHERE test\_session\_id \= $session\_id  
  AND status IN ('open', 'acknowledged')  
ORDER BY created\_at DESC  
LIMIT 1;

The most-recent open or acknowledged failure backs `failed_requires_review`. Resolved failures do NOT surface — they are operational history.

The `idx_exam_failure_ledger_session` index (§5.1) supports this query efficiently.

### **15.3 What happens when 04B re-scores after resolution**

Per §5.3 lifecycle: when a failure ledger entry transitions to `resolved`, if 04B has subsequently produced a `score_runs` row, 04C will surface `scored` / `partial_scored` on next read (no 04C code change; the derivation re-runs and finds the new score). If 04B has NOT yet re-scored, 04C surfaces `scoring_pending` (the resolved ledger entry no longer surfaces; the score\_run is absent; fallback to pending).

This means resolving a ledger entry WITHOUT triggering re-scoring will leave the session in `scoring_pending` indefinitely. Runbooks for §14.3 \+ §14.4 MUST include re-scoring as a step when applicable.

### **15.4 V1.1 expansion is forward-compatible**

When V1.1 adds `failure_message`, `severity`, `related_outbox_id`, etc. (§5.2), Doc 04C V1.0's reads continue to work (it only reads the 5 fields from §20.5; `source` is in V1.0 but Doc 04C does not depend on it yet). Doc 04C V1.1 MAY consume the additional fields for richer ops surfaces (admin report payload could include `failure_message` in the `internal` block).

---

## **16\. Data retention**

Different tiers retain at different windows. The retention pruning job runs nightly under an elevated role.

### **16.1 Retention windows**

| Table / tier | Retention window | Pruning trigger |
| ----- | ----- | ----- |
| `exam_audit_events` (schema-locked) | 7 years | `created_at < clock_timestamp() - INTERVAL '7 years'` |
| `exam_audit_events_informational` | 90 days | `created_at < clock_timestamp() - INTERVAL '90 days'` |
| `exam_failure_ledger` | 7 years | `created_at < clock_timestamp() - INTERVAL '7 years'` AND `status = 'resolved'` (open/acknowledged rows are NOT pruned) |
| Outbox tables (4A `exam_runtime_outbox`, 4B `score_run_event_ledger`) | Owned by 04A / 04B; not 04D's pruning concern | (n/a) |

### **16.2 Why 7 years for schema-locked tiers**

Regulatory framing: education-related records typically have 7-year retention requirements in US state contexts. This is a conservative default; V1.1 may relax for specific event categories that don't carry regulatory weight (subject to Legal review).

### **16.3 Why 90 days for informational**

Informational events feed dashboards and recent-incident triage. After 90 days, the signal value is low relative to storage cost. Aggregate metrics (computed from these events) live in the metrics pipeline with their own (longer) retention.

### **16.4 Pruning safety**

The retention pruning job:

* Runs nightly during low-traffic hours  
* Uses `LIMIT N` batched deletes to avoid long-running transactions  
* Emits a `exam_admin_retention_pruning_executed` audit event (admin tier) recording row counts deleted per table  
* Has a kill switch that ops can flip to halt pruning during incident windows where audit history is being actively investigated

### **16.5 Failure ledger never-prune-while-open**

`exam_failure_ledger` rows in `status IN ('open', 'acknowledged')` are NEVER pruned regardless of age. This prevents the scenario where a long-unresolved failure silently drops off the ledger and 04C stops surfacing `failed_requires_review` for the affected session.

### **16.6 Pruning is auditable**

Per invariant \#6 (audit append-only) and §16.4: the pruning job's deletes are themselves audited via the `exam_admin_retention_pruning_executed` event. Row-count-level traceability lets ops verify pruning behavior over time.

---

## **17\. Privacy and access control**

Read access to 04D's tables is tightly scoped.

### **17.1 Role enumeration**

V1.0 defines four read-access roles (Doc 01 owns the role implementation; 04D specifies what each role MAY read):

| Role | `exam_audit_events` (schema-locked) | `exam_audit_events_informational` | `exam_failure_ledger` | Notes |
| ----- | ----- | ----- | ----- | ----- |
| Student | (no direct read; only via 04C report) | (none) | (none) | Students see incident references via 04C `failure_summary.incident_reference` only |
| Guardian | (no direct read) | (none) | (none) | Same as student |
| Support | Filtered: own-actor events only via Doc 01 support tooling | Same | (none) | Support sees a student's audit trail when escalated; no security events |
| Ops admin | Full read EXCEPT security tier | Full read | Full read | Standard incident triage |
| Security admin | Full read INCLUDING security tier | Full read | Full read | Incident investigation requiring security context |

### **17.2 Security-tier read restriction**

Events with `event_category = 'security'` (§11) are readable ONLY by security-role admins. Standard ops admins do NOT see these events even via direct DB query — the DB role they assume has a row-level security policy excluding them. This is the principle-of-least-privilege application.

### **17.3 PII in payloads**

Audit event payloads MAY contain `student_id`, `actor_id`, and `test_session_id` (which transitively identify students). Read access to these is constrained per §17.1.

Per §2.2 \+ invariant \#5, audit payloads MUST NOT contain:

* Student answer values  
* Doc 02 correct-answer values  
* Doc 01 tokens, cookies, password hashes, password reset tokens  
* Free-form student-submitted text beyond what's structurally necessary (e.g., explicit-null answers are recorded as the literal NULL, not as a transcript)

### **17.4 V1.0 deferred: student/guardian audit dump endpoints**

V1.0 does NOT expose any audit-dump endpoint to students or guardians. If Product wants "show me my own audit trail" (privacy regulation compliance, etc.), V1.1 adds that endpoint with the redactions per §9.2 (no `module2_path` visible to non-admin roles) and §10.2 (no scores in audit payloads).

### **17.5 Admin endpoint protection**

The admin read endpoints (§18) require:

* Doc 01 admin role  
* The specific sub-role (ops vs security) for tier-gated reads  
* Audit emission of every admin read (recursive: reading the audit log is itself audited)

Recursive audit prevents an admin from quietly reviewing another admin's actions without trace. The recursive emission lives in the schema-locked admin tier.

---

## **18\. API / internal read surface**

V1.0 defines the minimum read endpoints needed for ops triage. Production tooling MAY wrap these with richer UI; the canonical read surface is what's defined here.

### **18.1 Endpoint enumeration**

| Method | Path | Purpose | Required role |
| ----- | ----- | ----- | ----- |
| `GET` | `/api/admin/audit/sessions/:session_id/events` | All audit events for a session (both tiers, filtered by role per §17) | Ops or Security admin |
| `GET` | `/api/admin/audit/failure-ledger/:ledger_id` | Single failure ledger entry detail | Ops or Security admin |
| `GET` | `/api/admin/audit/failure-ledger?status=open` | List open / acknowledged failure ledger entries | Ops or Security admin |
| `POST` | `/api/admin/audit/failure-ledger/:ledger_id/acknowledge` | Transition `open → acknowledged` (writes admin audit row in same txn) | Ops or Security admin |
| `POST` | `/api/admin/audit/failure-ledger/:ledger_id/resolve` | Transition `* → resolved` (writes admin audit row \+ carries `resolution_summary` \+ `ticket_id` per §8.3) | Ops or Security admin |
| `GET` | `/api/admin/audit/events?event_name=:name&since=:ts` | Query audit events by name \+ time window | Ops or Security admin (security-tier names require Security role) |
| `GET` | `/api/admin/observability/outbox-health` | Current outbox metrics (pending counts, lag, failed counts) | Ops or Security admin |
| `GET` | `/api/admin/observability/sli-snapshot` | Current SLI values | Ops or Security admin |

### **18.2 Standard precondition chain**

Every 04D admin endpoint runs these checks in order:

1. **Authentication.** Verify Doc 01 admin session token. Fail → `401 unauthenticated`.  
2. **Role check.** Verify the actor holds the required role (ops vs security). Fail → `403 forbidden`.  
3. **Recursive audit emission.** Emit an admin audit event recording the read or mutation. Failure to emit aborts the request (per invariant \#2 for mutations; for reads, the audit emission is best-effort but logged).  
4. **Tier filter application.** For `/events` queries, apply the §17 tier filter based on the actor's role. Security events are silently excluded from non-Security queries (they don't appear in results; they aren't surfaced as 403).

### **18.3 Standard error codes**

| Code | HTTP | When |
| ----- | ----- | ----- |
| `unauthenticated` | 401 | No valid admin token |
| `forbidden` | 403 | Authenticated but lacks required admin role |
| `ledger_entry_not_found` | 404 | `/failure-ledger/:id` references nonexistent ID |
| `ledger_state_conflict` | 409 | Attempted state transition is invalid (e.g., resolving an already-resolved entry) |
| `audit_query_window_too_large` | 400 | `/events` query window exceeds the V1.0 limit (default: 30 days) |

### **18.4 Response envelope**

Same envelope as Doc 04C V1.0 §16.8 (`{ data, meta: { request_id, served_at } }` for success; `{ error: { code, message, details }, meta: ... }` for failure).

### **18.5 Volume-bounded reads**

`/events` queries are paginated with a server-enforced max page size of 100 rows. Window queries (`since=:ts`) are bounded to 30 days; longer windows require a separate batch-export path (out of scope for V1.0).

---

## **19\. Failure modes**

| Failure | Handling |
| ----- | ----- |
| Audit event emission fails during admin mutation | Primary mutation aborts (invariant \#2); transaction rolls back; client sees 5xx; retry produces same outcome because the admin action is idempotent |
| Audit event emission fails during scoring orchestration | Per §4.3 \+ §5.4 precedence rule: the ledger row write happens FIRST and MUST remain durable. If `exam_scoring_failed` emission fails after the ledger row is committed, `exam_audit_emission_failed` (§11) is emitted on best-effort basis and a page-severity alert fires (§13); the ledger row is NOT rolled back. 04C continues to derive `failed_requires_review` correctly from the durable ledger row. |
| Async audit queue overflow | Informational events drop with `exam_audit_emission_failed` recording the drop; primary request path unaffected; alert fires per §13 |
| Failure ledger row write fails | Critical — 04C cannot derive `failed_requires_review`; orchestrator's Pattern A compensating-transaction (§5.4) retries the ledger write before re-raising; if the compensating write also fails after retry, the `exam_data_integrity_violation_detected` event fires (§14.10 runbook) |
| Outbox dead-letter buildup | §13 alert; §14.2 runbook; admin manually resets per §8 with audit |
| Audit redaction guard fires | `exam_audit_redaction_violation_detected` event; §13 critical alert; emission is blocked (the forbidden field never appears in storage); §14.10 runbook |
| Audit retention pruning encounters open ledger rows | Pruning SKIPS them per §16.5; no error; routine behavior |
| Audit retention pruning fails mid-batch | Batched delete contained — failed batch rolls back; next batch proceeds; alert if total prune duration exceeds expected window |
| Admin endpoint receives request without admin role | `403 forbidden` per §18.3; security audit event `exam_admin_action_authorization_failed` per §11 |
| Cross-system clock drift | 04D inherits 04A V2.2 §8.1 time-source discipline — `clock_timestamp()` from Postgres is the authoritative source; application clocks are not used for `created_at` |
| Doc 01 role predicate inconsistency mid-request | 04D caches the role result per request (one Doc 01 call per endpoint invocation); cross-request inconsistency is acceptable |
| `exam_failure_ledger` row written for a session that's not yet `completed` | Defensive: log the inconsistency via `exam_data_integrity_violation_detected`; do NOT block the write (ledger may be valid in some 04B failure paths that happen pre-completion-state-write — e.g., outbox processing failure before state finalization) |
| Two failure ledger writes for the same session \+ failure\_code in quick succession | Per §5.6 dedupe: the partial unique index `one_open_failure_per_session_code` rejects the second INSERT; orchestrator falls through to `lookup_open_or_acknowledged_ledger_id()` and emits a new `exam_scoring_failed` audit event referencing the existing ledger row's ID; no duplicate row created |
| Two failure ledger writes for the same session \+ DIFFERENT failure\_codes | Both rows persist (the unique index is per-`(session, failure_code)`); 04C reads the most-recent per §15.2; ops dashboards show both via the per-session query |
| Admin action issued without ticket ID where required | `400` rejection at API layer; the §8.3 payload contracts mark `ticket_id` non-nullable for sensitive actions |
| SLI computation query timeout | SLI temporarily unavailable; dashboards show "no data" state; the underlying alert rules continue firing if the trigger condition was previously satisfied |

---

## **20\. Acceptance criteria**

This document is satisfied when:

1. **Hybrid taxonomy is implemented.** Two physical tables exist (`exam_audit_events`, `exam_audit_events_informational`) per §4.2; schema-locked events (§7, §8, §11) land in the first; informational events (§6, §9, §10) land in the second.  
2. **Append-only enforcement is in place.** Application service roles lack UPDATE / DELETE permission on both audit tables; the retention pruning job is the only DELETE writer per §16.4.  
3. **Failure ledger V1.0 schema honors Doc 04C V1.0 §20.5 contract.** The 5 fields (`id`, `test_session_id`, `failure_code`, `status`, `created_at`) are present with the correct types; the two indexes (`idx_exam_failure_ledger_session`, `idx_exam_failure_ledger_open`) exist; 04C's derivation query (§15.2) returns expected results across all states.  
4. **Failure ledger write timing.** Integration tests verify that every 04B V4.3 §19 hard failure produces a `exam_failure_ledger` row within 60 seconds (per invariant \#3); a deliberate orchestrator-failure injection fixture confirms the contract.  
5. **Schema-locked event payload contracts (§7, §8, §11) are validated at emit time.** A JSON-schema check refuses INSERT of malformed payloads; CI tests cover every locked event with valid \+ invalid payload fixtures.  
6. **Audit redaction is enforced at the serializer.** A CI scan against §2.2 forbidden field list runs across every locked event payload type definition; any match fails CI. A runtime guard (the `exam_audit_redaction_violation_detected` emission) catches dynamic-data violations.  
7. **Same-transaction admin emission.** Integration tests verify that admin mutations (form publish, ledger acknowledgement / resolution, override-recorded publish, outbox reset) emit their audit row in the same transaction as the primary mutation; injecting an audit-emission failure aborts the primary mutation.  
8. **Compensating-transaction scoring failure emission.** Integration tests verify that 04B V4.3 §19 failures produce both the `exam_scoring_failed` audit event and the `exam_failure_ledger` row, even if the orchestrator's primary transaction rolls back.  
9. **Hybrid taxonomy stability test.** A canonical event-name registry exists for the schema-locked tier; a CI test verifies that renaming a schema-locked event requires updating the registry AND the corresponding tests.  
10. **Outbox observability operates.** Periodic SLI computation job runs at 60-second cadence (§6.2); the §12 outbox metrics are emitted; the §13 outbox alerts fire under simulated failure scenarios.  
11. **Concrete SLO targets are implemented.** Each §12 SLO target maps to a §13 alert rule; the §13 alerts have well-defined runbook references per §14.  
12. **Error budget tracking is computed.** For each rate SLO, the rolling 30-day error budget consumption is tracked per §12.5; the `error_budget_burned_50pct_at_50pct` alert fires under simulated breach.  
13. **Severity escalation routing is defined operationally.** §13.3 mappings (info → no alert, warning → low-noise, page → on-call, critical → escalation) are configured in the alerting pipeline; this is operationally validated, not contract-tested.  
14. **Retention pruning operates with audit traceability.** The nightly pruning job emits `exam_admin_retention_pruning_executed` per run; row-count traceability is preserved; the never-prune-while-open rule (§16.5) is enforced.  
15. **Role-based read access is enforced.** §17 role enumeration is implemented via Doc 01 \+ DB-level row-level security; tests verify ops admins cannot read security-tier events; tests verify recursive audit emission for admin reads (§17.5).  
16. **Admin endpoint preconditions execute in order.** Integration tests verify §18.2 step ordering by injecting failures and asserting the corresponding error code.  
17. **Forward compatibility with V1.1 failure ledger expansion.** A V1.1-additions test fixture demonstrates that the additive columns from §5.2 can be added without breaking V1.0 reads (Doc 04C V1.0 §20.5 minimum contract continues to function).  
18. **No fan-out, no canonical state from audit.** Doc 05's draft (when it arrives) does NOT take a dependency on 04D audit events; integration tests verify that 04C's derivation function reads `exam_failure_ledger` directly and does NOT consume audit events.

---

## **21\. Cross-doc contract summary**

This section is a compact reference for engineers building against 04D. It does not introduce new contracts — it summarizes what was established elsewhere in this document.

### **21.1 What 04D reads**

test\_sessions                    (04A V2.2 §5.3)            — for audit cross-reference  
test\_session\_sections            (04A V2.2 §5.4)            — for audit cross-reference  
score\_runs                       (04B V4.3 §9)              — for SLI computation, cross-reference  
exam\_runtime\_outbox              (04A V2.2 §5.7)            — for outbox health observability  
score\_run\_event\_ledger           (04B V4.3 §12)             — for outbox health observability  
Doc 01 admin role predicates

### **21.2 What 04D writes**

exam\_audit\_events                (schema-locked tier; this doc §4.2)  
exam\_audit\_events\_informational  (informational tier; this doc §4.2)  
exam\_failure\_ledger              (this doc §5.1)

### **21.3 What 04D emits to other systems**

Metrics pipeline                  (gauges \+ histograms per §12)  
Alerting pipeline                 (alerts per §13)  
Recursive admin audit             (admin reads of audit are themselves audited per §17.5)

### **21.4 What 04D does NOT own**

session state machine (04A V2.2)  
scoring formula (04B V4.3)  
report projection (04C V1.0)  
question authoring (Doc 02\)  
tutor coordination (Doc 03\)  
mastery math (Doc 05\)  
entitlement / role / guardian-link storage (Doc 01\)  
operational alert routing (Ops / DevOps runbooks)

### **21.5 04C → 04D failure ledger handoff (the critical seam)**

The seam that locks Doc 04C V1.0 §20.5:

04B raises (V4.3 §19 hard failure)  
    ↓  
04D writes exam\_failure\_ledger row (status='open') within 60s (invariant \#3)  
    ↓  
04D emits exam\_scoring\_failed audit event (§7) with failure\_ledger\_id reference  
    ↓  
04D fires page-severity alert (§13)  
    ↓  
04C read derivation function (§5.3) checks for the open ledger entry  
    ↓  
04C returns failed\_requires\_review payload with incident\_reference (§10.2)  
    ↓  
Ops resolves underlying issue; admin transitions ledger row to 'resolved'  
    ↓  
04B re-scores if applicable; score\_runs row inserted  
    ↓  
04C read derivation now returns 'scored' or 'partial\_scored'

### **21.6 What other docs should NOT do**

* **Doc 05** MUST NOT take a 04D-event dependency for mastery state. Mastery reads canonical answer state per Parent V3.0 RB-V3-08.  
* **Doc 04C** MUST NOT read `exam_audit_events` for state derivation. The ledger is the canonical source-of-truth; audit events are observability.  
* **04A / 04B** MUST NOT log forbidden fields (§2.2) into their own logs/audits that 04D might mirror. The redaction discipline starts at the originating system.  
* **Doc 02 / Doc 03** MAY emit their own audit streams to 04D-adjacent infrastructure, but they own their own taxonomies. 04D V1.0 does not enumerate non-exam events.

---

## **22\. Change Records**

| Version | Date | Reviewer | Summary | Source |
| ----- | ----- | ----- | ----- | ----- |
| V1.0 | 2026-05-12 | Karl \+ Claude | Initial canonical draft. Establishes hybrid audit taxonomy (schema-locked critical tier \+ informational evolvable tier); minimum-viable `exam_failure_ledger` schema honoring Doc 04C V1.0 §20.5 (5 fields: id, test\_session\_id, failure\_code, status, created\_at) with forward-compatible V1.1 expansion path; outbox observability for `exam_runtime_outbox` and `score_run_event_ledger`; full scoring event audit (§7); full admin action audit (§8) with same-transaction emission invariant; full security event audit (§11) with security-role read restriction; runtime informational events (§9) with `module2_path` redaction; report access informational events (§10) with PII redaction; concrete SLI/SLO targets day-1-implementable (§12); alert rules with severity → runbook mapping (§13); dead-letter and replay runbooks (§14); 04C handoff anchored at §15; retention policy 7y for schema-locked / 90d for informational (§16); role-based access with recursive admin-read audit (§17); minimum admin API surface (§18); forward-compatibility test fixtures (§20 acceptance \#17). | Parent V3.0 §3 subdoc map \+ Karl's scope outline (2026-05-12) \+ Doc 04C V1.0 §20.5 minimum contract \+ 04A V2.2 \+ 04B V4.3 |
| V1.0 lock-cycle cleanup | 2026-05-12 | Karl \+ ChatGPT (SWE review) | Post-review cleanup applied within the V1.0 lock cycle (no version bump). **RB-04D-V1-01 (HIGH)** Cross-reference drift fixed: §18 access control → §17 (line 746); §19 admin endpoints → §18 (line 1266); §18 V1.1 → §17.4 (line 747). **RB-04D-V1-02 (BLOCKER)** Failure ledger write priority inverted — the original §4.3 \+ §19 wording made audit emission failure block the ledger write, which would break 04C V1.0's `failed_requires_review` derivation. New §4.3 scoring-failure precedence rule states ledger first, audit second; §5.4 Pattern A pseudocode rewritten with explicit two-step error handling that preserves the durable ledger row even if audit emission fails; §19 failure-modes row rewritten. The corresponding `exam_audit_emission_failed` event in §11 now correctly characterizes the degradation. **RB-04D-V1-03 (HIGH)** `exam_report_forbidden_403` moved from §10 informational tier (with awkward "schema-locked exception" carve-out) to §11 security tier proper, with payload contract now properly enumerated alongside `exam_unauthorized_session_access`; §10.3 now contains a note pointing to §11 rather than a carve-out. **RB-04D-V1-04 (MEDIUM)** Added partial unique index `one_open_failure_per_session_code ON exam_failure_ledger (test_session_id, failure_code) WHERE status IN ('open', 'acknowledged')` to dedupe recurring failures; new §5.6 dedupe-semantics section \+ pseudocode showing lookup-existing-row fallback; §19 failure-modes row split into (same-code recurrence → dedupe via existing row; different-code → both rows persist). **NB\#1**: `source` column promoted from V1.1-additive to V1.0-included on the ledger (operational dashboard utility justifies inclusion); §5.2 expansion path updated. **NB\#2**: New §8.5 audit-before-irreversible-side-effect rule for admin actions whose primary mutation cannot be wrapped in a single DB transaction. **NB\#3**: New hard invariant \#9 — no raw stack traces in audit or ledger payloads; sanitized exception class \+ stable failure\_code \+ request\_id \+ source is the canonical storable shape. | ChatGPT SWE review verdict "PASS with required cleanup" |

---

**End of Doc 04D V1.0.**

The seam holds. 04A writes runtime \+ outbox; 04B writes score\_runs (or raises into the failure path); 04D writes the failure ledger \+ audit events \+ tracks SLIs; 04C reads canonical state \+ failure ledger and projects reports; Doc 05 reads canonical answer state directly. No system mistakes audit events for canonical state. No state-changing event leaves 04D. The Doc 04 family is complete.

