# **Lyceon — Document 06 (Parent): Reliability, Infrastructure, Security & Compliance Operations**

**Version:** V1.0 **Status:** LOCKED 2026-05-18 (draft-for-lock cleanup round 1 applied in-lock-cycle, RB-06P-V1-01..09; no version bump) **Last updated:** 2026-05-18 **Owners:** Founder / CTO review **Governed by:** Document 00 (Authoritative Platform Directive) **Depends on:** Doc 00; Doc 01A V1.0 (Platform Primitives, CANONICAL); Doc 01 (Identity/Access/Billing/Guardian Trust — V8 canonical per 01A/03 family; **V6.0 provided, V8 pending — bounded upgrade-ref scoped to 06D, see §9/§20**); Doc 03 Main V1.1; Doc 03A V3.0; Doc 03B V4.1; Doc 03C V3.0; Doc 03C.1 V1.0 (V1.1 pending); Doc 04 family (Parent V3.0, 04A V2.2, 04B V4.3, 04C V1.0, 04D V1.0 — all LOCKED); Doc 05 family (Parent V1.0, 05A V1.0, 05B V1.0, 05C V1.0, 05D V1.0 — all LOCKED). **Forward-references (bounded, non-spec-lock-blocking):** Doc 07 (Analytics — not drafted). **Applies to:** All production-readiness, infrastructure, deployment, security operations, observability operations, incident response, data-protection operations, backup/DR, compliance operations, and cost/capacity operations across the Lyceon platform.

---

# **§1 — Purpose, Mission & Family Identity**

## **1.1 The question Doc 06 answers**

Per the canonical document map: **"How do we run the platform safely?"** Doc 06 is the production-readiness and operational-control family. It governs the operational substrate that every product family (01/02/03/04/05) depends on to run reliably, securely, and compliantly in production — **without owning any business logic inside those runtimes**.

## **1.2 What Doc 06 is**

Doc 06 is the **operational, runbook, and executable-proof layer that sits on top of the platform primitives defined in Doc 01A V1.0 and the LISA GCP substrate defined in Doc 03C V3.0.** It does not define how a primitive works; it defines who operates it, where it pages, who owns the response, what SLO it must meet, what runbook governs its failure, and — critically — what runnable mechanism *proves* each of those operational guarantees holds.

## **1.3 What Doc 06 is not**

* Doc 06 is **not** the LISA tutor family. That is Doc 03 (03 Main V1.1, 03A V3.0, 03B V4.1, 03C V3.0, 03C.1 V1.0; separate, canonical).  
* Doc 06 is **not** the platform-primitives family. That is Doc 01A V1.0 (config, observability, caching, idempotency, rate limiting, abuse scoring, internal service auth). Doc 06 **references** 01A primitives by exact section; it never redefines them (§5).  
* Doc 06 is **not** identity/access/billing. That is Doc 01 (V8 canonical; V6.0 provided, see §9).  
* Doc 06 is **not** analytics/warehousing. That is Doc 07 (not drafted; bounded forward-reference, §9).

## **1.4 The two governing doctrines (the family spine)**

Doc 06 is built on two doctrines that every sub-document and every audit pass enforces:

1. **The Executable-Proof Doctrine (Decision 4 — §4).** Every invariant that asserts an operational capability must name the runnable mechanism that proves it and the durable proof artifact that mechanism produces. A capability claim without a named proving mechanism is a drafting defect.  
2. **The Reference-Not-Redefine Rule (Decision 5 — §5).** Doc 06 never restates or redefines any mechanism, number, schema, or interface owned by a locked sibling (01A, 01, 02, 03, 04, 05). It references the canonical owner by exact section and adds *only* the operational wrapper.

These two doctrines are not aspirational. §17 specifies the audit passes that mechanically enforce both.

---

# **§2 — Scope and Relationship to the Locked Corpus**

## **2.1 In scope**

Infrastructure topology and the portfolio environment model; CI/CD and release-gate governance; deployment and migration runbook *shapes* (not bodies); backup/PITR/DR with restore-test executable proof; security operations (secret-storage policy, key-rotation runbook shape, privileged-access and break-glass process, privileged-op audit process); the observability *operations* layer (cross-product SLO umbrella, incident-response lifecycle, paging/owner/runbook-shape wrapper); data-protection and compliance *operations* (the evidence/approval/audit process behind compliance deploy gates); and cost/capacity operations.

## **2.2 Out of scope (owned elsewhere — referenced, never restated)**

| Concern | Canonical owner |
| ----- | ----- |
| Config doctrine, `*_runtime_config`, LISTEN/NOTIFY config invalidation | Doc 01A §1–§9 |
| Structured logger, correlation IDs, metric naming, PII redaction, log levels/sinks/retention, alert routing | Doc 01A §10–§19.1 |
| Two-tier caching topology, invalidation, listener reconnection | Doc 01A §20–§28.1 |
| `IdempotencyService` interface, storage, conflict semantics, retention | Doc 01A §29–§38 |
| `RateLimitLedger`, abuse multiplier, 429 response shape, rollback | Doc 01A §39–§47 |
| `AbuseScoreService` tiers, incident taxonomy, scoring formula, ledger | Doc 01A §48–§59 |
| Internal service auth (HMAC-SHA256), secrets table, rotation, replay tolerance | Doc 01A §61–§71 |
| Per-primitive latency budgets / SLOs and SLO-breach enforcement model | Doc 01A §74A |
| LISA-tier GCP deployment, environments, Cloud Run operational contract, blue-green, rollback, schema-migration ordering, network/IAM/Vertex isolation | Doc 03C §13, §28A, §28B, §29.3, §12 |
| LISA failure-mode matrix and SLA targets | Doc 03 Main §26.A, §26.B; Doc 03C §28 |
| LISA cost metrics | Doc 03 Main §24; Doc 03C §11.3 |
| Mastery/projection deletion cascade, recompute, constants governance | Doc 05D §10, §11, INV-05D-13 |
| Identity, deletion execution rules, support-access audit, governance classes | Doc 01 V8 §5.1, §40.5, §44, Appendix E (**V8 pending — §9/§20**) |
| Migration runbook bodies; primitive engineer runbooks; primitive test matrices | Doc 01.2 (Migration Runbooks); Doc 01.3 (Engineer Runbooks); Doc 01.1 (Test Matrix); `docs/runbooks/` |

## **2.3 Inheritance from Doc 00**

Every Doc 06 operational rule operates within the Doc 00 platform directive: server-authoritative mutations, single canonical writer per table, no client trust, deterministic flow, one-way auditable flow, data protection by default, truth anchors over derived state. Doc 06 adds operational enforcement and proof of these directives; it does not weaken any of them.

## **2.4 Relationship to Doc 01A V1.0 (the load-bearing seam)**

Doc 01A V1.0 §72–§74 already enumerates the provision-to-consumer map for all seven primitives, §74A already owns per-primitive SLOs, §75 already owns the primitive launch-blocking acceptance items, and the deviation box in each primitive part already routes that primitive's migration runbook to **Doc 01.2**. Doc 06's relationship to 01A is therefore strictly additive and operational: Doc 06 owns the *cross-product* operational wrapper (who is paged, who commands the incident, what platform-wide SLO umbrella applies, what release gate blocks the deploy, what restore-test proves the backup) and references 01A's primitive-level definitions by exact section. **01A §75 and §74A are the two highest restatement-risk surfaces; both are explicitly reference-only in Doc 06 (§5.4).**

---

# **§3 — Family Decomposition**

Doc 06 \= Parent \+ five sub-documents. Drafting order: **Parent → 06A → 06B → 06C → 06D → 06E** (Decision 6: same conventions, audit, and review cycle as the 04/05 families).

| Sub-doc | Title | Owns (operational/proof wrapper only) | References (canonical owner \+ exact §) |
| ----- | ----- | ----- | ----- |
| **06 Parent** | This document | Family governance; INV-06-01..12 \+ proving mechanisms; ownership boundary; cross-doc seam table; FORWARD\_REF register; grounding-findings & version reality; the §10.4 01A-§74-label reconciliation note | 01A §72–§80; Doc 03 Main §26; Doc 03C §28 |
| **06A** | Infrastructure, Environments & Deployment | Portfolio infra topology (Vercel \+ Supabase \+ GCP **project inventory**); cross-cutting environment-matrix doctrine (§11); prod-data-in-lower-env prohibition; CI/CD \+ release-gate governance; Vercel/Supabase platform deploy \+ migration runbook **shapes** | Config doctrine → 01A §1–§9; caching topology → 01A §20–§28.1; LISA-tier GCP deploy/env/rollback/migration → Doc 03C §13, §28B, §29.3; primitive migration runbooks → Doc 01.2 |
| **06B** | Security Operations, Secrets & Access | Secret-storage operational policy (where secrets live per platform); HMAC key-**rotation runbook shape \+ ownership**; prod-access / break-glass process; privileged-op audit *process* | Internal service auth → 01A §61–§71 (rotation §65, emergency revoke §66, no-public-exposure §69); rate limiting → 01A §39–§47; abuse scoring/taxonomy → 01A §48–§59; LISA network/IAM/secret isolation → Doc 03C §12, §9.4 |
| **06C** | Observability Operations, SLOs & Incident Response | Cross-product / product-tier SLO umbrella; incident-response lifecycle (severity model, commander, postmortem); paging / owner / runbook-shape wrapper; the severity crosswalk (§13) | Logger/correlation/PII-redaction/metrics/alert-routing → 01A §10–§19.1 (PII §14, alert §18); **per-primitive SLOs → 01A §74A**; LISA failure matrix → Doc 03 Main §26.A \+ Doc 03C §28; SLA numbers → Doc 03 Main §26.B (referenced, never restated) |
| **06D** | Data Protection, Backup/DR & Compliance Operations | **Owns** platform-level RPO/RTO targets \+ the restore-test acceptance target (unless a subsystem declares stricter canonical targets in its owning doc; 06D may reference stricter subsystem targets, must define the platform target) \+ PITR/DR \+ **restore-test executable proof**; compliance evidence/approval/audit *process* for compliance deploy gates (e.g. Doc 05D `BLOCKING_PRIVACY_GAP`) | Deletion execution / PII retention / support-access audit / governance classes → **Doc 01 V8 §5.1, §40.5, §44, Appendix E (V8 pending — §9/§20)**; mastery/projection deletion → Doc 05D §10/§11; LISA retention → Doc 03 Main §14.2; analytics retention seam → **Doc 07 (sanctioned FORWARD\_REF)** |
| **06E** | Cost, Capacity & Vendor Operations (lightweight) | Cost/capacity ops wrapper; vendor-outage operational paths; V1.1 expansion hook | LISA cost cap / alert thresholds → Doc 03 Main §24; LISA cost observability → Doc 03C §11.3 (referenced, never restated) |

06E is intentionally lighter than 06A–06D (Decision 2): a standalone but thin sub-document with an explicit V1.1 expansion hook. Cost matters disproportionately because the LISA tutor is the platform's largest cost driver, but the canonical cost numbers are owned by Doc 03 Main §24 / Doc 03C §11.3 and are referenced, not restated.

---

# **§4 — The Executable-Proof Doctrine (Decision 4 — The Spine)**

## **4.1 Principle**

Doc 06 makes operational guarantees. An operational guarantee that cannot be mechanically demonstrated is a story, not a control. Therefore:

**Every Doc 06 invariant that asserts an operational capability MUST name (a) the runnable proving mechanism, (b) what executes that mechanism, and (c) the durable proof artifact it produces. A capability invariant without all three is a drafting defect of class `DD-06-PROOF`.**

## **4.2 What counts as a proving mechanism**

A proving mechanism is a concrete, named, runnable artifact of one of these kinds:

* A **CI check** (named pipeline job, blocks merge or deploy)  
* A **scheduled job** (named cron/worker, emits a structured proof record on every run)  
* A **test suite or named test** (in the relevant test matrix; e.g. Doc 03C.1 for the LISA tier)  
* An **automated reconciliation/audit job** (compares declared state to observed state, raises a typed alert on drift)

A prose assertion, a manual checklist with no recorded artifact, or "operations will ensure…" is **not** a proving mechanism.

## **4.3 The proving-mechanism contract**

Every INV-06 row in §6 carries four mandatory columns: `Invariant`, `Owner sub-doc`, `Proving mechanism (named)`, `Executed by → Proof artifact`. The same discipline propagates into every sub-document: every operational capability statement in 06A–06E carries the same four-column contract. Sub-document acceptance criteria are written as *proof obligations*, not aspirations.

## **4.4 Proof-artifact durability**

Proof artifacts must be durable and queryable: a CI run record retained per the repo's CI retention policy, a structured row in an audit/heartbeat table, or a signed file artifact (e.g. a restore-proof manifest, mirroring the Doc 04B evidence-packet pattern and the Doc 05D executable-proof discipline). Ephemeral console output is not a proof artifact.

## **4.5 Interaction with sibling proof disciplines**

Doc 06 does not re-invent proof mechanisms that locked siblings already own. Where 01A §75 already specifies a primitive's launch-blocking acceptance item, or Doc 03C.1 already specifies a LISA-tier test, or Doc 05D already specifies an executable-deletion-proof harness, **Doc 06 references that mechanism as the proof and adds only the operational wrapper around it** (e.g. "blocks the release gate", "pages owner X on failure"). Doc 06 introduces a new proving mechanism only for a guarantee that no sibling already proves.

---

# **§5 — The Reference-Not-Redefine Rule (Decision 5\)**

## **5.1 Rule**

Where any operational behavior in Doc 06 depends on a mechanism owned by a locked sibling, Doc 06 states: *"defined in \[Doc XX §Y\]; that file is canonical and is referenced here for the definition,"* and then adds **only** the operational wrapper (where it pages, who owns it, what SLO/gate applies, what runbook governs it). Doc 06 never restates the mechanism body — not the schema, not the formula, not the constants, not the interface signature, not the numeric thresholds.

## **5.2 Why this rule is load-bearing here specifically**

Doc 06 sits directly on top of the densest, most security-sensitive seam in the corpus (01A's HMAC service-auth §61–§71 and observability/PII-redaction §10–§19.1). A single restated HMAC field, rotation cadence, or PII-redaction rule that drifts from 01A is a security defect, not a documentation nit. The Reference-Not-Redefine rule is the structural defense against that drift, and it is the same defect class (05D-Q1) the project has already paid a full restructure to learn.

## **5.3 Mechanical check**

Every "references" cell in §3, §7, and every sub-document seam table resolves to exactly one owner document and one exact section. The §17 audit's **redefinition-detection pass** flags any Doc 06 line that states an owned *number, schema, formula, interface, or mechanism body* instead of citing its owner+§. A flagged line is a defect of class `DD-06-REDEF` and blocks lock until reduced to reference-plus-wrapper.

## **5.4 Named highest-risk restatement traps (explicitly reference-only)**

The following surfaces are the audit's priority targets because they are the most tempting to paraphrase:

* **01A §74A** — per-primitive latency budgets (P50/P95/P99) and the SLO-breach → Warn/Page enforcement model. 06C references §74A; 06C owns only the cross-product SLO umbrella.  
* **01A §75 / §76** — primitive launch-blocking acceptance and migration order. Doc 06 references; Doc 06 acceptance (§16) is the *operational* layer, not a copy.  
* **01A §50 / §52 / §53 / §55** — abuse tiers, incident taxonomy, scoring formula, ledger schema. 06B references; 06B owns only the enforcement-review and incident-ops wrapper.  
* **01A §44 / §65 / §66** — 429 response shape; rotation cadence; emergency revoke. 06B references; 06B owns only the rotation *runbook shape and ownership*.  
* **Doc 03 Main §26.B / §24** — LISA SLA numbers and cost caps. 06C/06E reference; numbers are never reproduced.  
* **Doc 05D §10 / INV-05D-13** — deletion cascade and the no-constants-recompute simplification. 06D references; 06D owns only the compliance-evidence process around the gate.

---

# **§6 — Hard Invariants (INV-06-01..12) with Proving Mechanisms**

Each invariant below carries its named proving mechanism per §4. Mechanism names are canonical identifiers Doc 06 owns; their bodies live in CI configuration / scheduled-job code / the relevant test matrix and are governed by the runbook-shape contract (§12). Where a sibling already proves the guarantee, the "Proving mechanism" cell names that sibling artifact and Doc 06 adds the wrapper noted.

| \# | Invariant | Owner | Proving mechanism (named) | Executed by → Proof artifact |
| ----- | ----- | ----- | ----- | ----- |
| **INV-06-01** | No production deploy proceeds unless all required release gates pass. | 06A | CI workflow `ci/release-gates` (aggregate gate; composes all blocking checks incl. INV-06-06/-08/-09/-11 gates) | CI on every deploy-targeted PR/merge → pipeline gate-state record (retained per CI policy) |
| **INV-06-02** | No service-role / privileged secret is ever shipped to a client bundle or exposed to a client surface. | 06B | CI check `ci/no-server-secret-in-client` (client-bundle secret scan \+ server-only env allowlist) — wraps Doc 00 no-client-trust and 01A §64 secret governance | CI per PR \+ nightly scan → scan report artifact |
| **INV-06-03** | No production data (per the §11.3 canonical definition: DB rows/dumps, object storage, identifier-bearing logs/traces, analytics exports, backups, screenshots, model/RAG payloads) reaches a lower environment without anonymization. | 06A \+ 06D | Scheduled job `ops/lower-env-data-provenance-scan` (must cover every medium in §11.3 — DB-only coverage is a gamed control) | Nightly → provenance-scan report row \+ per-medium coverage matrix (raises `LOWER_ENV_PROD_DATA_DETECTED` on hit) |
| **INV-06-04** | Every scheduled job is monitored (heartbeat \+ failure alert with owner). | 06C | Reconciliation check `ci/scheduled-job-registry-parity` (declared job registry ↔ 01A §18 alert-routing config) \+ per-job heartbeat | CI per PR \+ heartbeat monitor → registry-parity record \+ heartbeat table |
| **INV-06-05** | Every async queue **or transactional outbox** has a bounded-retry path, a terminal failure state, an owner alert, and a replay/remediation path. | 06A | Static audit `ci/queue-dlq-parity` over the declared queue/outbox inventory — validates **either** an external dead-letter queue **or** a database terminal failed/dead-letter status \+ owner alert; references Doc 03C §8.2 queue topology and Doc 05C `projection_refresh_outbox` / Doc 05D §11.N additive `attempt_count` \+ terminal `failed` state as canonical outbox definitions | CI per PR → queue/outbox-parity record |
| **INV-06-06** | Every schema migration ships with a tested rollback **or** a documented, tested forward-fix recovery plan. | 06A | CI check `ci/migration-recovery-present` (migration PR template \+ presence of either a dry-run-tested rollback script **or** a documented, tested forward-fix plan) — references Doc 03C §29.3 migration ordering / break-glass verification for the LISA tier; consistent with Doc 05D's forward-only posture (INV-05D-13: constants changes migrate via the normal event path, no recompute rollback) | CI per migration PR → migration-recovery record |
| **INV-06-07** | Every privileged operation is auditable. | 06B | Test suite `audit-coverage` \+ reconciliation `ops/privileged-op-audit-coverage` — fully provable **now** against 01A §5 config-history and Doc 05D admin-RLS audit substrates; the Doc 01 §44 support-access audit slice is **gated on FWD-06-02** (Doc 01 V8 pending) and completed in 06D once V8 is provided | CI \+ periodic reconciliation → audit-coverage assertion record (01A/05D coverage now; Doc 01 §44 slice on V8) |
| **INV-06-08** | Every irreversible deletion has an executable proof of completion. | 06D | Deletion executable-proof harness — references Doc 05D §10 cascade \+ D20/D21 tests as the canonical deletion-proof tests; adds the post-deletion verification job wrapper | CI (D20/D21) \+ post-deletion verification job → deletion-proof manifest |
| **INV-06-09** | Every backup has a restore-test proof. | 06D | Scheduled job `ops/restore-test` (periodic PITR/restore drill on backup cadence) | Restore-test scheduler → signed restore-proof manifest |
| **INV-06-10** | Every high-severity alert has a named owner and a runbook. | 06C | Parity check `ci/alert-runbook-parity` (alert registry ↔ runbook inventory ↔ owner map) — references 01A §18 alert routing \+ Doc 03 Main §26.A failure modes | CI per PR \+ nightly → alert-runbook-parity record |
| **INV-06-11** | Compliance gates are deploy gates (a failing/unapproved compliance gate blocks release). | 06D | Compliance-gate registry wired as blocking checks inside `ci/release-gates` — references Doc 05D `BLOCKING_PRIVACY_GAP` as the canonical first registered gate | CI on every deploy → compliance-gate state record |
| **INV-06-12** | Every vendor/third-party outage has an explicit, documented response path. | 06E \+ 06C | Coverage audit `ci/vendor-outage-path-coverage` (vendor inventory ↔ outage-path matrix) — references Doc 03 Main §26.A (13 LISA failure modes) \+ Doc 03C §28 (8-class failure matrix) as canonical for the LISA tier | CI per PR → vendor-path coverage record |

**Drafting-defect classes enforced at §17 audit:** `DD-06-PROOF` (capability invariant without all three proof columns), `DD-06-REDEF` (restatement of an owned mechanism), `DD-06-SEAM` (a seam cell that does not resolve to a single owner+§), `DD-06-FWD` (an unflagged forward-reference).

## **6.13 Proving Mechanism Status (named ≠ implemented)**

All Doc 06-owned proving mechanisms named in §6 (every `ci/*` and `ops/*` identifier, every harness, every registry/parity check) are **required controls Doc 06 specifies, not assumed-existing artifacts.** Naming a mechanism in this Parent specifies the obligation; it does not assert the control exists or is passing.

A Doc 06-owned proving mechanism is considered **implemented** only when its owning sub-document defines all six of:

1. execution location (which CI pipeline / scheduler / worker / test matrix runs it),  
2. trigger cadence (per PR / per deploy / nightly / on backup cadence / on event),  
3. input registry (the declared set it reconciles against — e.g. queue inventory, alert registry, vendor inventory),  
4. failure condition (the typed error or gate-fail it raises, and what it blocks),  
5. proof-artifact schema and location (the durable, queryable record per §4.4),  
6. owner and paging route (mapped to 01A §18 alert tiers, referenced not restated).

Until its owning sub-document supplies all six, the invariant is **specified but not deploy-proven**, and the §16 acceptance obligation for it is open. Where a proving mechanism cell *references a sibling-owned artifact* (e.g. Doc 05D D20/D21, 01A §75 acceptance items, Doc 03C.1 tests), that sibling artifact's existing status governs; Doc 06 adds only the operational wrapper and does not re-prove it. The §17 executable-proof pass treats a mechanism asserted as existing/passing without these six as a `DD-06-PROOF` defect.

---

# **§7 — Cross-Document Seam Table (Grounded by Exact §)**

Every seam below is grounded against the *provided* canonical documents by exact section. Reconciliation status is explicit. This table is the single source the §17 audit's cross-doc pass checks.

| Seam | Doc 06 side | Canonical owner \+ exact § | Consumption | Reconciliation status |
| ----- | ----- | ----- | ----- | ----- |
| Config / runtime constants | 06A | 01A §1–§9 (LISTEN/NOTIFY §4, history §5, magic-number CI §6, tables catalog §8) | Doc 06 operational tunables live in `*_runtime_config` per doctrine; Doc 06 defines no parallel config layer | RESOLVED |
| Observability conventions | 06C | 01A §10–§19.1 (logger §11, correlation §12, PII redaction §14, metrics §15, alert routing §18, sinks/retention §19) | 06C operates on top of these conventions; defines no parallel logger/metrics | RESOLVED |
| Caching topology | 06A | 01A §20–§28.1 (LISTEN/NOTIFY §22, TTL/hard-stale §24, prod modes/pooler §26, reconnection §28) | 06A operational guidance references the pattern; defines no parallel cache | RESOLVED |
| Idempotency | 06A | 01A §29–§38 (storage §31, flow §32, 409 §33, retention §34) | INV-06-05 references the idempotency \+ outbox terminal-failure pattern; no restatement | RESOLVED |
| Rate limiting | 06B | 01A §39–§47 (RPC §41, abuse multiplier §42, 429 §44) | 06B references; defines no parallel limiter; 429 shape not restated | RESOLVED |
| Abuse scoring | 06B | 01A §48–§59 (tiers §50, taxonomy §52, scoring §53, ledger §55, visibility-none §57) | 06B owns only the incident-ops \+ enforcement-review wrapper | RESOLVED |
| Internal service auth (HMAC) | 06B | 01A §61–§71 (verify §63, secrets §64, rotation §65, replay tol. §66, no-public §69) | 06B owns only the rotation runbook shape/ownership \+ break-glass | RESOLVED |
| Per-primitive SLOs | 06C | 01A §74A (budgets \+ SLO-breach → Warn/Page model) | 06C references §74A; owns only the cross-product SLO umbrella | RESOLVED |
| Primitive acceptance / migration order | 06A/06D | 01A §75, §76 | Doc 06 acceptance (§16) is the operational layer; no copy of §75 items | RESOLVED |
| LISA GCP deploy & environments | 06A | Doc 03C §13 (3 GCP projects, blue-green, rollback), §28B (Cloud Run operational contract) | 06A owns portfolio project inventory \+ env-matrix doctrine only; LISA-tier deploy is 03C-canonical | RESOLVED |
| LISA schema-migration ordering | 06A | Doc 03C §29, §29.3 (ordering \+ break-glass verification) | INV-06-06 references for the LISA tier | RESOLVED |
| LISA network/IAM/secret isolation | 06B | Doc 03C §12 (§12.1 network, §12.2 secrets, §12.3 IAM, §12.4 Vertex isolation), §9.4 emergency revoke | 06B references; owns only the cross-platform secret-storage policy wrapper | RESOLVED |
| LISA failure matrix & SLAs | 06C | Doc 03 Main §26.A (13 modes), §26.B (SLA targets); Doc 03C §28 (8-class matrix), §28A (per-endpoint) | 06C crosswalk (§13) maps each entry to severity \+ owner \+ runbook-shape; bodies not owned | RESOLVED |
| LISA cost metrics | 06E | Doc 03 Main §24 ($ cap/alert/target); Doc 03C §11.3 (cost observability) | 06E references; reproduces no cost numbers | RESOLVED |
| Safety-incident workflow | 06D | Doc 03 Main §21.3 (Safety Review Queue, founder/ops-lead, SLA) | 06D references as the canonical safety-incident workflow; adds compliance-ops wrapper | RESOLVED |
| LISA data retention matrix | 06D | Doc 03 Main §14.2 (10 LISA tables, retention/archival crons) | 06D references; INV-06-04 covers the cron monitoring wrapper | RESOLVED |
| Mastery/projection deletion & governance | 06D | Doc 05D §10 (FK-ordered cascade), §11.N (outbox dead-letter), INV-05D-13 (no constants recompute) | 06D references; owns only the compliance-evidence process around the gate | RESOLVED |
| Compliance privacy deploy gate | 06D | Doc 05D `BLOCKING_PRIVACY_GAP` (Layer-2 privacy decision) | INV-06-11 registers this as the first canonical compliance gate; conservative hard-delete fallback ships meanwhile (05D-stated) | RESOLVED — gate process owned by 06D, rule owned by 05D |
| Scoring outbox seam | 06D/06A | Doc 04B V4.3 scoring outbox; Doc 05C `projection_refresh_outbox` schema; Doc 05D §11.N additive `attempt_count` \+ terminal `failed` columns | INV-06-05 references these as canonical outbox definitions (terminal-failure-state pattern, not external DLQ) | RESOLVED |
| Identity / deletion-execution / support-audit / governance classes | 06D (+ INV-06-07 partial) | Doc 01 **V8** §5.1, §40.5, §44, Appendix E | **GAP — V8 pending; V6.0 provided.** The deletion-execution/PII-retention/governance-class surface is scoped to 06D only. The **§44 support-access audit slice additionally touches Parent INV-06-07**, which is therefore explicitly partial-gated on FWD-06-02 (provable now for 01A §5 \+ Doc 05D admin-RLS; Doc 01 §44 slice on V8). 01A's primitives (the actual bulk Doc 06 dependency surface) are at V1.0 and clean. | OPEN — non-spec-lock-blocking for Parent/06A/06B/06C per Q1=a; INV-06-07 partial-provable now |
| Analytics / warehouse retention & event lineage | 06C/06D | Doc 07 (not drafted) | Sanctioned single forward-reference (§9); pattern \= 05C→04B | OPEN — bounded FORWARD\_REF, non-blocking |

---

# **§8 — Drafting & Lock Conventions (Decision 6\)**

Doc 06 follows the 04/05 family conventions exactly:

* **Workflow (tool-neutral):** primary drafting agent drafts → independent SWE review → cleanup pass applied **in-lock-cycle** with grep-traceable tags `RB-06<X>-V1-NN` → aggressive end-to-end audit. *Project-local instantiation (process metadata, not product doctrine): the drafting agent is Claude and the independent SWE review is performed via ChatGPT; this binding is a project convention, not a Doc 06 spec requirement, and may change without a Doc 06 version bump.*  
* **File flow:** draft in the working directory → copy to the outputs directory → present → multi-pass audit before delivery.  
* **Backups:** `.bak` / `.bak2` before each cleanup pass.  
* **Cleanup register:** `§21`\-style table (Tag / Severity / Source / Resolution); change-record row appended; **no version bump and no lock-date change** for in-lock-cycle cleanup.  
* **Drafting order:** Parent → 06A → 06B → 06C → 06D → 06E. Each sub-doc: draft → independent SWE review → in-lock-cycle `RB-06*-V1-NN` cleanup → aggressive end-to-end audit.  
* **Status semantics (draft vs post-lock cleanup must not be conflated):**  
  * *Draft-for-lock cleanup* (the current phase): status remains `DRAFT — pending external review` while review-driven cleanup is applied; on a clean re-audit the status transitions once to `LOCKED` (the Doc 04B "Draft for lock" → review → lock precedent).  
  * *Post-lock in-lock-cycle cleanup* (later passes after lock): status remains `LOCKED`; the version number and the lock date are **unchanged**; only the `RB-06*-V1-NN` register and a §20 change-record row are appended.

---

# **§9 — Grounding Findings & Version Reality**

Grounding (full read of Doc 01A V1.0; targeted reads of Doc 01 V6.0, Doc 03C V3.0, Doc 03C.1 V1.0, Doc 03B V4.1) surfaced five scope-shaping findings beyond the original scope brief. Each is recorded here because, under the project's pre-draft discipline, dependency findings are surfaced before drafting, not mid-draft.

## **9.1 Version reality table**

| Doc | Provided | Canonical refs expect | Doc 06 handling |
| ----- | ----- | ----- | ----- |
| 01A | **V1.0 CANONICAL** (2026-04-23) | V1.0 | Clean; fully in context; the primary Doc 06 dependency surface |
| 01 | **V6.0** (2026-04-21) | **V8** (cited by 01A, 03B, 03C) | 2-version gap; scoped to **06D only**; bounded upgrade-ref; non-blocking for Parent/06A/06B/06C per Q1=a |
| 03C | **V3.0 CANONICAL FINAL** (2026-04-29) | V3 | Clean; owns the LISA GCP substrate |
| 03C.1 | **V1.0** (companion to 03C V2.1) | 03C.1 **V1.1 (pending)** | Test matrix lags spec; cited by role with version flagged per Q5=a |
| 03B | **V4.1 CANONICAL** (2026-04-24) | V4.1 | Clean; confirms Doc 02B V4 / 02C V4 |

## **9.2 Finding 1 — 01A is §-numbered, not "Part I–VII flat"**

The scope brief approximated 01A as "Part I–VII". 01A V1.0 is canonically §-numbered. All Doc 06 references resolve to the exact sections enumerated in §2.2/§7. The brief's "§52/§55/§64–67" approximations are now pinned to exact §.

## **9.3 Finding 2 — 01A §74A already owns per-primitive SLOs**

01A §74A owns P50/P95/P99 \+ alert thresholds for all seven primitives *and* the enforcement model (thresholds in `observability_runtime_config`; SLO breach → Warn; sustained \>1hr → Page). **06C does not own primitive SLOs**; it references §74A and owns only the cross-product/product-tier SLO umbrella and the incident-lifecycle wrapper.

## **9.4 Finding 3 — Runbook ownership is distributed and is not Doc 06's**

01A deviation boxes route every primitive migration runbook to **Doc 01.2 (Migration Runbooks)**; there is also **Doc 01.1 (Test Matrix)** and **Doc 01.3 (Engineer Runbooks)** — a Doc 01 companion series. Doc 03C routes its operations to a pending **Doc 03C Operations Runbook V1**. Per Decision 3, Doc 06 governs runbook *required-shape* and owns the platform-wide *inventory pointer*; runbook bodies belong to Doc 01.2 / Doc 03C-Ops / `docs/runbooks/`. This is formalized in §12.

## **9.5 Finding 4 — 03C V3.0 already owns the LISA GCP operational substrate**

Doc 03C V3.0 owns §13 Deployment & Environments (3 GCP projects), §28B Cloud Run Operational Contract (incl. §28B.6 blue-green, §28B.7 rollback, §28B.8 config), §29/§29.3 schema-migration ordering with break-glass verification, §28 Failure Matrix, §28A per-endpoint operational contracts, §11.2 SLI catalog, §11.3 cost observability, §12 network/secret/IAM/Vertex isolation. **06A's GCP ownership is the portfolio-level project inventory \+ cross-cutting environment-matrix doctrine only**; LISA-tier GCP deploy/rollback/migration/failure contracts are 03C-canonical, referenced not restated.

## **9.6 Finding 5 — 01A §74 stale "Doc 06" label (flag-only, non-blocking)**

01A §74 lists "Future Doc 06 (Multi-exam) — consumes primitive interfaces unchanged." This predates the finalized document map (Doc 06 \= Reliability/Infra/Security/Compliance Ops; multi-exam/expansion is Doc 08). 01A's substantive claim ("consumes primitive interfaces unchanged") holds regardless of label. **Doc 06 does not edit 01A** (01A governance §78–§80 owns that). Doc 06 Parent records that 01A §74's "Doc 06" row is a stale label and that 01A likely needs a `CR-01A` change-record to realign §74; this is a flag, not a blocker, and is tracked in §20.

---

# **§10 — FORWARD\_REF Register**

Forward-references are explicit, bounded, named, and non-spec-lock-blocking (the 05C→04B pattern). Any forward-reference not in this register is a `DD-06-FWD` defect.

| Ref ID | What | Where used | Bound | Blocking? |
| ----- | ----- | ----- | ----- | ----- |
| **FWD-06-01** | Doc 07 (Analytics/Warehouse) — event lineage, analytics retention, decision-systems seam | 06C (analytics observability seam), 06D (analytics data-retention seam) | Named seam in 06C/06D; reconciled when Doc 07 drafts; pattern \= 05C→04B | No — bounded |
| **FWD-06-02** | Doc 01 **V8** — identity, deletion execution (§40.5), support-access audit (§44), PII retention (§5.1), governance classes (Appendix E) | 06D compliance-ops \+ deletion-proof wrapper; **\+ Parent INV-06-07 §44 support-access slice (bounded)** | Bulk surface scoped to **06D only**; the §44 support-access slice additionally gates only INV-06-07's Doc-01 portion (01A §5 \+ Doc 05D admin-RLS coverage provable now). V6.0 provided; 06D drafting gated on V8; Parent/06A/06B/06C otherwise unaffected (dependency is 01A V1.0, clean) | No for Parent/06A/06B/06C spec lock; INV-06-07 Doc-01 slice \+ 06D drafting-gated per Q1=a |
| **FWD-06-03** | Doc 03C.1 **V1.1 (pending)** — LISA orchestrator test matrix at 03C V3.0 parity | 06C executable-proof references to the LISA test matrix | Cite by role ("Doc 03C.1, V1.1 pending; V1.0 current"); contract (test matrix \= proof artifact) stable, only version in flux | No — version-flagged per Q5=a |
| **FWD-06-04** | Doc 01.1 / 01.2 / 01.3 companion series; Doc 03C Operations Runbook V1 (pending) | 06A/06B/06C/06D runbook-shape references | Doc 06 owns shape \+ inventory pointer; bodies owned by these companions | No — Decision 3 |

---

# **§11 — Environment Model (Q2=a)**

## **11.1 Canonical three-tier model**

The platform-wide canonical environment model is **three tiers: `development` / `staging` / `production`.** This is not a new definition — it is the platform-wide *adoption* of the environment vocabulary already canonical in:

* Doc 01A §2 / §7 — the `environment` enum (`all | development | staging | production`) and the per-environment config-value scoping rule.  
* Doc 03C §13.1 — the LISA tier instantiates exactly this model (`lyceon-lisa-prod` / `-staging` / `-dev` GCP projects, each with isolated Cloud Run services, queues, Vertex binding, service accounts, secrets).

## **11.2 Doc 06's operational wrapper (what 06A owns)**

06A owns only the cross-cutting **environment-matrix doctrine**: the prod-data-in-lower-env prohibition (INV-06-03), the per-environment privilege/secret-scope rule, the per-tier deploy-gate stringency, and the portfolio environment matrix (which Vercel project / which Supabase project / which GCP project maps to which tier). 06A does **not** redefine 01A's `environment` enum or 03C's GCP project topology; it references them.

## **11.3 Canonical definition of "production data" (scopes INV-06-03)**

Because INV-06-03 is a Parent-owned invariant, its scope term is defined canonically here so it is not re-invented (or narrowed) per sub-document. **"Production data" \= any data derived from production users, in any storage medium**, including: database rows; database dumps/exports; object-storage files; logs and traces containing user identifiers; analytics exports; backups and PITR snapshots; screenshots; and model/RAG payloads (prompts, responses, retrieved context) derived from production users.

The breadth is deliberate: a provenance scan that inspects only DB tables while logs, object storage, backups, or model/RAG payloads leak is a gamed control. **`ops/lower-env-data-provenance-scan` (INV-06-03) must cover every medium in this definition**; coverage of all media is a §16 acceptance obligation. The *enforcement detail* (scan implementation, medium-by-medium coverage matrix, anonymization standard) is owned by **06A**; this definition is the canonical scope 06A enforces against and may not narrow.

## **11.4 Divergence is a violation**

Any Doc 06 environment definition that diverges from 01A §2/§7's enum or 03C §13.1's instantiation is itself a Decision-5 violation (`DD-06-REDEF`). The three-tier model is canonical precisely because two locked siblings already instantiate it; Doc 06 aligns, it does not re-author.

---

# **§12 — Runbook Ownership & Required-Shape Contract (Decision 3\)**

## **12.1 Ownership split**

| Layer | Owner | Doc 06 role |
| ----- | ----- | ----- |
| Runbook **required shape** (mandatory fields, executable-proof acceptance criteria, owner/paging/SLO/severity binding) | **Doc 06** | Owns and governs |
| Platform-wide runbook **inventory pointer** (the index of which runbook governs which failure, where it lives) | **Doc 06** | Owns the pointer; not the bodies |
| Primitive **migration** runbook bodies | Doc 01.2 | Referenced |
| Primitive **engineer** runbook bodies | Doc 01.3 | Referenced |
| Primitive **test matrices** | Doc 01.1 | Referenced |
| LISA-tier operations runbook bodies | Doc 03C Operations Runbook V1 (pending) | Referenced (FWD-06-04) |
| Repo-local operational runbook bodies | `docs/runbooks/` (per locked coding-standards doc) | Referenced |

## **12.2 Required-shape contract**

Every runbook referenced by a Doc 06 invariant must conform to the Doc 06 required-shape contract: a stable identifier; the triggering failure mode (mapped to the §13 severity crosswalk); the named owner; the paging route (mapped to 01A §18 alert tiers, referenced not restated); the step sequence; and an **executable-proof acceptance criterion** stating the runnable mechanism that proves the runbook's recovery actually restores the guaranteed state. A runbook body that does not conform fails the §17 audit's runbook-shape pass; Doc 06 does not inline the body to fix it — it flags the owner.

---

# **§13 — Incident Severity Model & Crosswalk Doctrine (Q3=a)**

## **13.1 Severity model (reuses 01A §18 verbatim — no new level)**

Doc 06C's incident severity vocabulary is exactly the 01A §18 alert-tier vocabulary — **Page / Warn / Info** (with Debug being 01A's dashboard-only, non-incident tier). Doc 06 introduces **no new severity level**. Severity classification is owned by 01A §18; 06C references it and does not extend, reorder, or redefine it (doing so would itself be a `DD-06-REDEF` violation of §5).

"Time-to-respond" is a **separate, Doc 06-owned runbook dimension**, orthogonal to 01A §18 severity and applied only *after* an alert has already been classified Page/Warn/Info by 01A §18:

operational\_response\_urgency ∈ { immediate | same\_day | next\_business\_day }

This is a runbook-shape field (governed by the §12.2 required-shape contract), **not** an alert-routing tier and **not** a severity. It carries no paging semantics of its own — paging is determined solely by the 01A §18 severity. A Page-severity incident is `immediate`; a Warn-severity incident that nonetheless needs same-day attention is `same_day`; this captures the operational nuance the earlier `High` band was reaching for without touching 01A's severity vocabulary.

## **13.2 The crosswalk is the only new artifact**

06C owns exactly one new artifact here: a **crosswalk table** that maps every entry in the three pre-existing canonical failure/SLO sources to an **01A §18 severity (referenced, not redefined) \+ the Doc 06 `operational_response_urgency` field \+ named owner \+ runbook-shape**, owning none of the source bodies and introducing no new severity level:

| Source (canonical owner) | What it enumerates | Crosswalk obligation |
| ----- | ----- | ----- |
| Doc 03 Main §26.A | 13 LISA failure modes with severities \+ recovery | Each row → 01A §18 severity (referenced) \+ `operational_response_urgency` \+ owner \+ runbook-shape; §26.A severities/recovery referenced, never restated |
| Doc 03C §28 (§28.1–§28.8) | 8-class LISA orchestration failure matrix | Each class → 01A §18 severity \+ `operational_response_urgency` \+ owner \+ runbook-shape |
| Doc 01A §74A | Per-primitive SLO-breach → Warn/Page model | Each primitive's breach → owner \+ runbook-shape; severities and thresholds referenced from §74A/§18, never restated |

## **13.3 Anti-restatement guard**

The crosswalk maps to, and never reproduces, the source severities, recovery steps, SLA numbers, or thresholds. A crosswalk cell that restates a §26.A recovery step or a §74A threshold is `DD-06-REDEF`.

---

# **§14 — Compliance-Gates-Are-Deploy-Gates Doctrine (INV-06-11)**

## **14.1 Principle**

A compliance requirement that does not block a release is not a control. INV-06-11 elevates registered compliance gates to blocking checks inside `ci/release-gates`. The compliance *rules* are owned by their canonical documents; Doc 06D owns the *evidence/approval/audit process* that determines whether a gate is satisfied and the wiring that makes an unsatisfied gate block the deploy.

## **14.2 First registered gate**

Doc 05D's `BLOCKING_PRIVACY_GAP` (the Layer-2 privacy/compliance decision) is the first canonical compliance gate registered under INV-06-11. Doc 06D owns the evidence-and-approval process for clearing it. The conservative hard-delete fallback that always ships safely meanwhile is a Doc 05D-stated property, referenced not restated. Other gates (e.g. COPPA/GDPR/jurisdictional launch-sequence gates) register into the same registry as their owning documents define them; Doc 06D owns the process, not the rule.

---

# **§15 — Vendor / Third-Party Outage Doctrine (INV-06-12)**

## **15.1 Principle**

Every external dependency (Vercel, Supabase/Neon Postgres, GCP/Cloud Run, Vertex AI, Stripe) must have an explicit, documented operational response path. INV-06-12's coverage audit fails if any inventoried vendor lacks a mapped outage path.

## **15.2 Reference, do not restate, the LISA-tier paths**

For the LISA tier, the vendor-outage paths are already canonical: Doc 03 Main §26.A (Vertex outage/quota, Cloud Run scaling, Supabase degraded/unavailable, context-cache corruption, cost anomaly, etc.) and Doc 03C §28 (8-class orchestration failure matrix incl. §28.2 Vertex invocation, §28.6 deployment+infra). 06E/06C reference these and add only the cross-product owner/paging/runbook-shape wrapper. The non-LISA vendor paths (Vercel edge, Supabase Postgres, Stripe billing) are genuinely unowned and are first-class 06E/06A content with executable-proof coverage.

---

# **§16 — Family Acceptance Criteria (Executable-Proof Framed)**

Doc 06 acceptance is written as proof obligations (§4), not aspirations, and is the *operational* layer — it does not copy 01A §75's primitive launch-blocking list (that is referenced).

The Doc 06 family is acceptance-complete when:

1. `ci/release-gates` exists and composes all blocking gates; a deploy with any failing gate is demonstrably blocked in staging (INV-06-01).  
2. `ci/no-server-secret-in-client` runs per PR and nightly; a deliberately planted client-bundle secret is demonstrably caught (INV-06-02).  
3. `ops/lower-env-data-provenance-scan` runs nightly, covers every medium in the §11.3 production-data definition (DB, object storage, logs/traces, analytics exports, backups, screenshots, model/RAG payloads), and raises `LOWER_ENV_PROD_DATA_DETECTED` on an induced violation in any medium (INV-06-03).  
4. Every declared scheduled job appears in the registry and has a heartbeat \+ owner; `ci/scheduled-job-registry-parity` fails on an unregistered job (INV-06-04).  
5. `ci/queue-dlq-parity` fails when a declared queue lacks a dead-letter path; Doc 03C §8.2 and Doc 05D §11.N queues are present in the inventory (INV-06-05).  
6. `ci/migration-recovery-present` fails a migration PR with neither a tested rollback nor a documented, tested forward-fix recovery plan; the LISA tier references Doc 03C §29.3 ordering (INV-06-06).  
7. `audit-coverage` \+ `ops/privileged-op-audit-coverage` demonstrate every privileged op writes an audit record (INV-06-07).  
8. The deletion executable-proof harness (Doc 05D D20/D21 \+ post-deletion verification job) produces a deletion-proof manifest on an induced deletion (INV-06-08).  
9. `ops/restore-test` produces a signed restore-proof manifest on the backup cadence. **Doc 06D owns platform-level RPO/RTO targets and the restore-test acceptance target** unless a lower-level subsystem declares stricter canonical targets in its owning doc (06D may reference stricter subsystem targets but must define the platform restore-test acceptance target; no numbers are stated in Parent — ownership and the no-restate rule are). The restore drill demonstrably meets the 06D-defined platform target (INV-06-09).  
10. `ci/alert-runbook-parity` fails when a high-severity alert lacks an owner or runbook; the §13 crosswalk is complete against Doc 03 Main §26.A / Doc 03C §28 / 01A §74A (INV-06-10).  
11. The compliance-gate registry is wired into `ci/release-gates`; Doc 05D `BLOCKING_PRIVACY_GAP` is registered and an unsatisfied gate demonstrably blocks deploy (INV-06-11).  
12. `ci/vendor-outage-path-coverage` fails when an inventoried vendor lacks a mapped outage path; LISA-tier paths resolve to Doc 03 Main §26.A / Doc 03C §28 (INV-06-12).  
13. The §17 audit reports zero `DD-06-PROOF`, `DD-06-REDEF`, `DD-06-SEAM`, `DD-06-FWD` defects across Parent and all five sub-documents.

Sub-document acceptance criteria refine these into per-document proof obligations using the §4.3 four-column contract.

---

# **§17 — Doc 06 Audit Profile (Decision 6 \+ Redefinition-Detection Pass)**

Doc 06 is runbook/policy/process-heavy, not SQL-heavy, so the audit profile differs from the 04/05 SQL-balance-centric profile. The reusable audit profile (currently implemented as `audit_06X.py`; the exact path is an implementation note, not normative) must perform:

1. **Internal consistency / structure pass** — section structure, no dupes, invariant register completeness, every INV-06 has all four proof columns (catches `DD-06-PROOF`).  
2. **Redefinition-detection pass (new, central for Doc 06\)** — scans every Doc 06 line for restatement of an owned number/schema/formula/interface/mechanism body that a referenced doc (01A/01/03/04/05) owns; any such line is `DD-06-REDEF`. Priority targets: the §5.4 named traps (01A §74A SLO numbers, §75 acceptance items, §50/§52/§53/§55 abuse bodies, §44/§65/§66 auth values, Doc 03 §26.B/§24 numbers, Doc 05D §10/INV-05D-13).  
3. **Cross-doc seam-resolution pass** — every "references" cell in §3/§7 and every sub-doc seam table resolves to exactly one owner+§; unresolved or owner-ambiguous cells are `DD-06-SEAM`.  
4. **Executable-proof pass** — every operational capability claim names a real, runnable proving mechanism \+ executor \+ proof artifact; aspirational claims are `DD-06-PROOF`.  
5. **Forward-ref closure pass** — every forward-reference is in the §10 register, bounded, and non-spec-lock-blocking; any unflagged forward-reference is `DD-06-FWD`.  
6. **Runbook-shape pass** — every runbook a Doc 06 invariant depends on conforms to the §12.2 required-shape contract (Doc 06 flags the owner; it does not inline the body).

**Known false-positive class** (carried from the 04/05 audit lineage, adapted): section-header rows containing an owned term; the §5.4 "named traps" list itself (it *names* the traps to forbid them — not a restatement); acceptance-criterion lines that *reference* a proof mechanism (legitimate, not aspirational); the §7 seam table's "exact §" citations (citations, not restatements).

---

# **§18 — Standing Deploy Gates & Open Items**

These are explicitly enumerated, none block Parent spec lock (the 05D enumerated-gates pattern):

1. **06D drafting gate \+ INV-06-07 Doc-01 slice (FWD-06-02):** Doc 01 V8 must be provided before 06D drafts. V6.0 provided; 06D's compliance-ops/deletion-proof wrapper references V8 §5.1/§40.5/§44/Appendix E. **INV-06-07 is partial-provable now** (01A §5 config-history \+ Doc 05D admin-RLS); only its Doc 01 §44 support-access slice is gated on V8. Parent/06A/06B/06C otherwise unaffected (dependency is 01A V1.0, clean). Per Q1=a.  
2. **Doc 07 forward-ref (FWD-06-01):** 06C/06D analytics seams reconcile when Doc 07 drafts. Bounded, non-blocking.  
3. **03C.1 version flag (FWD-06-03):** 06C executable-proof references to the LISA test matrix cite "Doc 03C.1 V1.1 pending; V1.0 current". Non-blocking; reconcile at 03C.1 V1.1.  
4. **01A §74 label reconciliation (Finding 5):** 01A §74's "Doc 06" row is a stale label (multi-exam is Doc 08). Doc 06 flags only; recommends a `CR-01A` realignment by 01A's owner. Doc 06 does not edit 01A.  
5. **Companion-series references (FWD-06-04):** Doc 01.1/01.2/01.3 and Doc 03C Operations Runbook V1 are referenced for runbook bodies; Doc 06 owns shape \+ inventory pointer only.

---

# **§19 — Review Triggers, Lock Semantics & Change Control**

## **19.1 Review triggers**

Doc 06 (any sub-doc) is reviewed when: a referenced 01A primitive interface changes (01A §78 propagation); Doc 01 advances to V8 (06D reconciliation); Doc 03C revises (LISA-substrate seam re-check); Doc 07 drafts (FWD-06-01 closure); a new compliance gate is added to the INV-06-11 registry; a Doc 00 platform invariant changes; a security audit finds an operational-control gap.

## **19.2 Lock semantics**

"Locked" means: Doc 06 operational contracts are authoritative; in-lock-cycle cleanup (`RB-06*-V1-NN`) does not bump the version and does not change the lock date; behavior-changing changes require an explicit version bump and change record; sub-documents reference Doc 06 invariants and the Parent's ownership boundary, and a change to either triggers sub-document review.

## **19.3 Change-control tiers**

Tier 1 — in-lock-cycle cleanup (typos, clarifications, seam-citation corrections): no version bump, lock date holds. Tier 2 — additive operational wrapper (new runbook-shape field, new registered compliance gate): minor version bump. Tier 3 — invariant change, ownership-boundary change, or a Decision-1..6 change: explicit new version \+ change record \+ sub-document review.

---

# **§20 — Change Records**

Change-record numbering is fresh for Doc 06 (`CR-06-XX`).

**CR-06-01** — Doc 06 Parent V1.0 established. Family \= Reliability/Infrastructure/Security/Compliance Operations; decomposition Parent \+ 06A–06E; two governing doctrines locked (Executable-Proof §4, Reference-Not-Redefine §5); INV-06-01..12 each carrying a named proving mechanism \+ executor \+ proof artifact; cross-doc seam table grounded by exact § against provided canonical docs.

**CR-06-02** — Scope re-cut against actual Doc 01A V1.0 (§-numbered, not Part I–VII) and Doc 03C V3.0 (owns LISA GCP substrate). Five grounding findings recorded (§9): (1) 01A §-numbering pinned; (2) 01A §74A owns per-primitive SLOs; (3) runbook ownership distributed to Doc 01.1/01.2/01.3 \+ 03C-Ops; (4) 03C V3.0 owns LISA GCP deploy/env/rollback/migration; (5) 01A §74 "Doc 06" stale label flagged (no 01A edit).

**CR-06-03** — Version reality recorded: Doc 01 provided at V6.0, canonical refs expect V8; V8 carried as bounded upgrade-ref scoped to 06D only (FWD-06-02), non-spec-lock-blocking for Parent/06A/06B/06C per pre-draft Q1=a. Doc 07 not drafted → sanctioned single FORWARD\_REF (FWD-06-01). Doc 03C.1 version flag recorded (FWD-06-03).

**CR-06-04** — Pre-draft decisions locked: Q1=a (draft Parent→06A→06B→06C now, Doc 01 V8 scoped to 06D), Q2=a (three-tier environment model aligned to 01A §2/§7 \+ 03C §13.1), Q3=a (severity model reuses 01A §18 vocab \+ crosswalk-only new artifact), Q4=a (06D owns platform RPO/RTO first-class with restore-test proof), Q5=a (03C.1 cited by role, version-flagged), Q6=confirm (06E thin, references Doc 03 §24 \+ 03C §11.3). Decisions 1–6 from the scope brief carried.

**CR-06-05** — Draft-for-lock cleanup round 1 (external SWE review, 2026-05-18), RB-06P-V1-01..09 applied in-lock-cycle, **no version bump**, status transitioned `DRAFT` → `LOCKED`. 2 blockers (01: §6.13 proving-mechanism-status — named ≠ implemented; 02: removed `High` severity, Option A, "same-day" → orthogonal `operational_response_urgency` runbook field, restoring strict Decision-5 compliance vs 01A §18). 5 highs (03: migration recovery \= rollback-or-forward-fix; 04: canonical broad production-data definition §11.3; 05: queue/outbox generalization aligned to 05C/05D outbox; 06: INV-06-07 partial-gating accuracy vs FWD-06-02; 07: explicit 06D RPO/RTO ownership). 2 mediums (08: draft vs post-lock status disambiguation; 09: tool-neutral workflow \+ non-normative audit path). Re-audit clean across all 6 §17 passes; zero `DD-06-*` defects.

---

# **§21 — Cleanup Register (RB-06P-V1-NN)**

Round 1 (external SWE review, 2026-05-18): 2 blockers \+ 5 highs \+ 2 mediums, all accepted and applied in-lock-cycle. No version bump; this is the draft-for-lock cleanup pass that transitions status `DRAFT` → `LOCKED` on clean re-audit.

| Tag | Severity | Source | Resolution |
| ----- | ----- | ----- | ----- |
| RB-06P-V1-01 | BLOCKER | SWE B1 | Added §6.13 Proving Mechanism Status: all Doc 06-owned `ci/*`/`ops/*` mechanisms are required controls, not assumed-existing; six-element implemented-definition; sibling-referenced artifacts governed by sibling status; asserted-as-existing without the six \= `DD-06-PROOF`. |
| RB-06P-V1-02 | BLOCKER | SWE B2 | §13.1/§13.2 — removed the `High` severity level (Decision-5 violation). Severity vocabulary is 01A §18 verbatim (Page/Warn/Info; Debug non-incident). "Same-day" relocated to a separate Doc 06-owned runbook field `operational_response_urgency ∈ {immediate|same_day|next_business_day}`, explicitly non-paging, applied after 01A classification. Option A taken. |
| RB-06P-V1-03 | HIGH | SWE H1 | INV-06-06 → "tested rollback **or** documented, tested forward-fix recovery plan"; mechanism renamed `ci/migration-rollback-present` → `ci/migration-recovery-present`; consistency note vs Doc 05D INV-05D-13; §16 criterion 6 \+ §7 LISA-migration row updated. |
| RB-06P-V1-04 | HIGH | SWE H2 | Added §11.3 canonical "production data" definition (DB rows/dumps, object storage, identifier-bearing logs/traces, analytics exports, backups, screenshots, model/RAG payloads); INV-06-03 \+ §16 criterion 3 require per-medium scan coverage; enforcement detail explicitly deferred to 06A, definition may not be narrowed. |
| RB-06P-V1-05 | HIGH | SWE H3 | INV-06-05 generalized: "async queue **or transactional outbox** — bounded retry \+ terminal failure state \+ owner alert \+ replay/remediation path"; proof validates external DLQ **or** DB terminal `failed` status; references Doc 05C/05D `attempt_count`\+`failed`; §7 idempotency \+ scoring-outbox rows aligned. |
| RB-06P-V1-06 | HIGH | SWE H4 | INV-06-07 reframed as partial-gated: provable now via 01A §5 \+ Doc 05D admin-RLS; Doc 01 §44 support-access slice gated on FWD-06-02. §7 governance-class row, §10 FWD-06-02, §18 gate-1 corrected so the "06D only" claim is no longer overstated. |
| RB-06P-V1-07 | HIGH | SWE H5 | §3 06D row \+ §16 criterion 9 — explicit: Doc 06D owns platform-level RPO/RTO \+ restore-test acceptance target unless a subsystem declares stricter canonical targets in its owning doc; no numbers stated in Parent (ownership \+ no-restate rule only). |
| RB-06P-V1-08 | MEDIUM | SWE M1 | §8 status semantics split into draft-for-lock cleanup (status stays DRAFT, transitions once to LOCKED on clean re-audit) vs post-lock in-lock-cycle cleanup (status stays LOCKED, version \+ lock date unchanged). No longer conflated. |
| RB-06P-V1-09 | MEDIUM | SWE M2 \+ M3 | §8 workflow made tool-neutral ("primary drafting agent → independent SWE review"), Claude/ChatGPT binding labelled project-local process metadata (not product doctrine, no version bump on change). §17 audit path made non-normative (implementation note). |

**Change-record convention for this register:** on each cleanup pass, `.bak`/`.bak2` is taken first; resolved items are appended with `RB-06P-V1-NN` tags; a change-record row is appended to §20 summarizing the pass. Round 1 was the draft-for-lock pass (status transitioned DRAFT → LOCKED). Any subsequent post-lock in-lock-cycle pass leaves status `LOCKED`, the version number, and the lock date **unchanged** (§8 status semantics).

---

*End of Doc 06 Parent V1.0 (LOCKED 2026-05-18; RB-06P-V1-01..09 applied in-lock-cycle, no version bump). Next: 06A (Infrastructure, Environments & Deployment).*

