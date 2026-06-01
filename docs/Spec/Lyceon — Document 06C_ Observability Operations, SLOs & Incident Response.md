# **Lyceon — Document 06C: Observability Operations, SLOs & Incident Response**

**Version:** V1.0 **Status:** LOCKED 2026-05-21 (DRAFT → LOCKED on clean re-audit after CR-06C-04 cleanup pass; all 18 audit passes green × 2 runs) **Last updated:** 2026-05-21 **Owners:** Founder / CTO review **Governed by:** Document 06 Parent V1.0 (LOCKED 2026-05-18) → Document 00 (Authoritative Platform Directive) **Depends on:** Doc 06 Parent V1.0; Doc 06A V1.0 (LOCKED 2026-05-18 \+ post-lock additives RB-06A-V1-11/12 per CR-06A-06; §7 env matrix, §10.5 envelope, §18.1 V1 BFF/worker binding, `infra/route-surface-classification.yaml`); Doc 06B V1.0 (LOCKED 2026-05-21 \+ RB-06B-V1-13; §6 HMAC ops, §7–§8 privileged-op audit substrate, §9 abuse-ops queue, §11–§12 internal-endpoint enforcement); Doc 01A V1.0 (CANONICAL — §10–§19.1 observability primitive bodies, §18 alert tiers, §74A per-primitive SLOs); Doc 01 (V6 provided; V8 canonical per FWD-06-02; 06C consumes V6 surface, V8 §44 slice gated on FWD-06-02 only for the support-mediated audit substrate's observability surface); Doc 03 Main V1.1 (§26.A 13-mode failure matrix, §26.B SLA targets, §21.3 LISA safety-review queue — referenced via project handoff record per §3.4; canonical for tutor-class); Doc 03C V3.0 (§11.2 SLI catalog, §28.1–§28.8 8-class failure matrix, §11.3 cost observability — canonical for LISA tier). **Forward-references (bounded):** Doc 07 (FWD-06-01 — analytics consumer of observability surfaces); Doc 01 V8 §44 support-mediated audit substrate's observability surface (FWD-06-02 — partial-gates 06C's `ops/observability-consumer-parity` mechanism only for the V8 slice). **Applies to:** cross-product composite SLO contract shape \+ registry mechanism; incident-response lifecycle (declare/commander/comms/mitigate/resolve/postmortem); the Parent §13 severity crosswalk body wiring Doc 03 §26.A \+ 03C §28 \+ 01A §74A breach → severity \+ `operational_response_urgency` \+ owner \+ runbook-shape; alert-registry parity body (`ci/alert-runbook-parity` — Parent INV-06-10); scheduled-job registry \+ heartbeat substrate (Parent INV-06-04); synthetic-probe execution-location binding; status-page operational shape; unified non-tutor on-call rotation; observability-consumer parity over the 06B privileged-op audit substrate. **Explicitly excludes:** every primitive *body* owned by 01A §10–§19.1 / §74A (referenced, never restated); Doc 03 / 03C LISA observability and failure-matrix bodies (referenced, never restated); 06B audit-substrate definitions (consumed, not redefined).

---

# **§1 — Purpose & Position in the Doc 06 Family**

06C is the observability-operations sub-document. It answers: *how does the platform know it is healthy, how does the platform respond when it is not, who is paged for what, what proves every high-severity alert has a real owner and a real runbook, and how do per-primitive SLO breaches and feature-path SLO breaches and LISA failure modes resolve into one severity model and one paging substrate without redefining anything 01A or Doc 03 or 03C owns.*

06C owns the operational/proof wrapper for two Parent invariants outright (**INV-06-04** every scheduled job is monitored with a heartbeat; **INV-06-10** every high-severity alert has a named owner and a runbook), and the platform-wide non-LISA portion of one (**INV-06-12** every vendor outage path is explicit; LISA-tier portion is Doc 03C §28 canonical and Doc 06E owns the joint non-LISA tail). Per Parent §4 every capability statement names a proving mechanism with the §6.13 six-element implemented-definition; per Parent §5 every primitive body remains 01A / Doc 03 / 03C canonical and is referenced, never restated.

---

# **§2 — Scope and Boundary**

## **2.1 06C owns**

The cross-product composite SLO *contract shape* and the registry mechanism (§5; **the per-path values themselves are owned by feature docs per Q-06C-3=b** — Doc 02B for practice/exam, Doc 03B for tutor, Doc 04 family for calendar, etc. — and 06C does not state them); the unified Parent §13 severity crosswalk between Doc 03 Main §26.A's 13 LISA failure modes, Doc 03C §28's 8 orchestration failure classes, 01A §74A's per-primitive SLO breaches, 06B's privileged-op-coverage findings, 06A's release-gate failures, and Parent §13's `Page / Warn / Info` × `immediate / same_day / next_business_day` matrix (§6); the alert-registry that pairs every alert with its severity, owner, runbook, and `operational_response_urgency` (§7); the scheduled-job registry \+ heartbeat substrate that proves INV-06-04 (§8); the synthetic-probe execution-location binding (GitHub Actions hosted runner per Q-06C-1=a) and the body of the §10.5 envelope for synthetic-probe artifacts (§9); the incident-response lifecycle from declare → commander → comms → mitigate → resolve → postmortem, including the relational `incidents` \+ `incident_phase_transitions` \+ `incident_action_items` audit substrate (§10); the unified non-tutor on-call rotation (founder \+ ops-lead \+ backup per Q-06C-2=a) and its parity check (§11); the status-page operational shape and the `ops/status-page-conformance` proof (§12); the observability-consumer parity over 06B's privileged-op audit substrate (§13).

## **2.2 06C explicitly does NOT own (Decision 5 — referenced, never restated)**

| Concern | Canonical owner (referenced by exact §) |
| ----- | ----- |
| Structured logging principle | 01A §10 |
| Logger interface (`logger.info / .warn / .error`) | 01A §11 |
| Correlation IDs (request\_id, session\_id, async propagation) | 01A §12, §17 |
| Log levels and usage (DEBUG/INFO/WARN/ERROR) | 01A §13 |
| PII redaction rules (extends V8 §5.1) | 01A §14 |
| Metrics emission (counters/histograms/gauges, naming convention `<service>_<metric>_<unit>`) | 01A §15 |
| Percentile conventions (P50/P95/P99 reporting) | 01A §16 |
| Log sinks and retention (Dev stdout / Staging 30d / Prod 90d hot \+ 1y cold) | 01A §19 |
| Observability deviation/migration | 01A §19.1 |
| Alert routing tiers (Page / Warn / Info / Debug — body) | 01A §18 |
| Per-primitive SLO budgets (cache, config, idempotency, rate-limit, abuse, internal-auth) | **01A §74A** |
| Doc 03 §26.A 13-mode failure matrix (Vertex outage/quota, Cloud Run scaling, Supabase degraded/unavailable, context-cache corruption, cost anomaly, injection burst, entitlement read failure, etc.) | **Doc 03 Main §26.A** |
| Doc 03 §26.B SLA targets (latency P50/P95/P99, availability 99.5% non-exam / 100% live-exam-blocking, error-rate, cache-hit) | **Doc 03 Main §26.B** |
| LISA safety-review queue (tutor-class incident workflow) | Doc 03 Main §21.3 |
| LISA SLI catalog (every `vertex_*`, `orchestrator_*`, `async_job_*`, `candidate_*`, `memory_refresh_*`, `pii_guard_*`, `hmac_*`, `cloud_run_*`, `health_check_*`, `deployment_*` metric) | **Doc 03C §11.2** |
| LISA 8-class orchestration failure matrix (§28.1 turn-path, §28.2 Vertex, §28.3 cache, §28.4 candidate, §28.5 async, §28.6 deploy/infra, §28.7 privacy/anti-leak, §28.8 config) | **Doc 03C §28.1–§28.8** |
| LISA cost observability | Doc 03C §11.3 (06E joint) |
| 06B privileged-op audit substrate | Doc 06B §8 (consumed) |
| 06A release-gate failures (CI surface) | Doc 06A §10 (consumed) |
| Privileged-session relational tables | Doc 06B §8.3 (consumed) |
| Privileged-op source registry | Doc 06B §8.6 (consumed) |
| Internal-endpoint probe (HTTP-layer ingress check) | Doc 06B §11.4 (consumed; 06C provides only the execution location) |
| §10.5 envelope schema (12 common fields \+ per-mechanism extras matrix) | Doc 06 Parent §10.5 / 06A §10.5.1 / 06B §15 (extended in §14) |

## **2.3 03C boundary (inherited from 06A §2.2 / 06B §2.3)**

Any LISA-tier observability surface — every `vertex_*` / `orchestrator_*` / `cloud_run_*` / `health_check_*` / `deployment_*` SLI, every entry in §28.1–§28.8, the Cloud Run autoscaling SLI, the Vertex cost SLI — is **Doc 03C V3.0 canonical** and is referenced by exact § only. 06C owns the *cross-tier crosswalk* (mapping LISA failure modes onto the Parent §13 severity vocabulary so they share an on-call substrate with non-LISA breaches) and does not state a `vertex_*` threshold, an `orchestrator_*` percentile, or a Vertex routing target (`DD-06-REDEF` defect; §16 03C-boundary audit pass).

## **2.4 Inheritance**

06C inherits Doc 00, Parent §11.3 (production-data definition — observability payloads can contain production data, hence 01A §14 redaction is non-negotiable in every observability path), Parent §6.13 (named ≠ implemented), Parent §10.5 (Standard Proof Artifact Envelope), Parent §13 severity model (Page / Warn / Info \+ `operational_response_urgency ∈ {immediate, same_day, next_business_day}`), 06A §18.1 V1 BFF/worker binding (Vercel serverless \+ separate worker host), 06B §8.6 privileged-op source registry pattern (independent `expected_event_source ≠ observed_audit_source` discipline applied throughout 06C reconciliations).

---

# **§3 — Threat Model (Operational)**

Operational threats this document addresses. The primitive bodies in 01A / 03C defend against the cryptographic and infrastructure threats; 06C addresses the operational-blind-spot threats — the cases where the system is failing and nobody notices, or notices but cannot act.

1. **Silent SLO degradation** — a per-primitive 01A §74A budget is breached (e.g. `RateLimitLedger.checkAndIncrement` P99 sustained beyond §74A's alert threshold) but no composite user-facing alarm fires because there is no cross-product SLO. *Defense:* §5 composite-SLO registry \+ §7 alert-registry parity. *Caveat:* 06C owns the contract shape and registry; the values are feature-doc-owned (Q-06C-3=b).  
2. **Unaudited scheduled job failure** — a cron job (nightly abuse recompute, audit archival, idempotency purge, HMAC rotation drill) silently stops running and the failure surfaces only when the downstream invariant is violated. *Defense:* §8 scheduled-job registry \+ heartbeat substrate proving INV-06-04.  
3. **Alert without an owner or runbook** — an alert fires and the on-call has no documented procedure. *Defense:* §7 `ci/alert-runbook-parity` proving INV-06-10.  
4. **Severity-vocabulary fragmentation** — Doc 03 Main §26.A uses CRITICAL/HIGH/MEDIUM/LOW; 01A §18 uses Page/Warn/Info/Debug; 03C §28 uses page/warn/info per-row; 06B §7.6 uses PAGE per 01A §18. Without a single crosswalk, the on-call has to translate between four vocabularies during an incident. *Defense:* §6 severity crosswalk (Parent §13 body), no vocabulary restatement.  
5. **Synthetic-probe whitelist-masking** — the 06B §11 internal-endpoint probe executes from a network whose IPs the ingress restriction has whitelisted (intentionally or by drift), producing a false `ingress_rejected` result. *Defense:* §9 execution-location binding to GitHub Actions hosted runner (Q-06C-1=a) \+ §9.2 mitigation rules.  
6. **Incident-response improvisation** — incidents are declared informally; the commander role is unclear; comms are ad-hoc; postmortems are skipped under time pressure. *Defense:* §10 relational incident lifecycle \+ `ops/incident-lifecycle-conformance` reconciliation.  
7. **On-call ambiguity** — at any moment, no single person knows they are primary. *Defense:* §11 unified non-tutor rotation (Q-06C-2=a) \+ `ci/oncall-rotation-parity`.  
8. **Status-page silence during an incident** — customer-facing surface is degraded; the status page does not reflect it. *Defense:* §12 status-page conformance reconciliation against the §10 incidents table.  
9. **Observability consumer drift over 06B substrate** — 06B §8.6 names the privileged-op source registry; if 06C's observability surfaces (alerts, dashboards) do not consume that registry, INV-06-07's "every privileged op auditable" becomes one-way (the audit row exists but nobody is watching). *Defense:* §13 `ops/observability-consumer-parity`.

Threats explicitly *not* addressed here:

* Cryptographic / authentication threats — 06B §3.  
* Per-primitive performance tuning — 01A §74A revision protocol (post-launch measurement informs revision, not 06C tuning).  
* LISA-specific failure-mode bodies — Doc 03 Main §26.A and Doc 03C §28 (referenced, never redefined; 06C provides only the crosswalk).  
* DDoS / volumetric — Cloudflare WAF (06A §4 leverage).

## **3.4 Doc 03 Main citation path**

Doc 03 Main V1.1 is not present in the current session's uploads (only 03B V4.1 and 03C V3.0). Citations to Doc 03 Main §26.A / §26.B / §21.3 are made per the project handoff record (which established these sections as canonical) and Parent §13.2's crosswalk (which also cites these sections). On Doc 03 Main upload to the source tree, `ci/alert-runbook-parity` (§7.3) and `ci/composite-slo-registry-parity` (§5.5) gain a parsed §26.A row index as input; until then, the cited section names are recorded in the proof artifact's `source_ref_resolved` field as `cited_per_project_handoff_record`. Registered as W3 in §17 (non-blocking).

---

# **§4 — Severity & Urgency Model (Parent §13 Inheritance)**

Per Parent §13, the severity model is `Page / Warn / Info` (01A §18 vocabulary, referenced) plus an orthogonal **`operational_response_urgency`** field on every runbook with values `immediate | same_day | next_business_day`. 06C does not redefine either axis; it operationalizes them.

| Axis | Owner | 06C use |
| ----- | ----- | ----- |
| Severity (Page / Warn / Info / Debug) | 01A §18 (referenced) | Routes the alert to the §11 rotation paging tier |
| `operational_response_urgency` | Parent §13 (referenced) | Bounds the runbook's acceptance criterion timing (see §7 alert-registry) |
| Doc 03 §26.A severity (CRITICAL/HIGH/MEDIUM/LOW) | Doc 03 Main §26.A (referenced) | Crosswalked to 01A §18 vocabulary in §6 — no parallel severity table |
| 03C §28 per-row alert column (page/warn/info) | Doc 03C §28 (referenced) | Already 01A §18-aligned; 06C passes through |

**Crosswalk hard rule:** any Doc 03 §26.A failure or Doc 03C §28 row that reaches the 06C alert-registry MUST do so via §6.1's mapping — never via a re-stated severity. A row whose 06C severity does not derive from the §6.1 mapping is a `DD-06-REDEF` defect (§16 audit pass).

---

# **§5 — Composite SLO Contract Shape & Registry (Q-06C-3 \= b)**

## **5.1 Scope of ownership**

06C owns the **contract shape** — the schema of what a composite SLO declaration must contain — and the **registry mechanism** — the file format and the parity check that the registry is internally consistent. **06C does NOT define the V1 set of composite SLO values for any user-facing path; those are feature-doc-owned** (Q-06C-3=b). For example, "first question latency from session-start" is a Doc 02B-owned composite SLO; "first tutor turn latency" is a Doc 03B-owned composite SLO; "exam scoring transaction p95" is a Doc 04B-owned composite SLO. 06C provides the shape and the parity gate.

## **5.2 Contract shape**

composite\_slos:  
  \- composite\_slo\_id: \<stable id; format 'CSLO-\<doc\>-\<NN\>'\>  
    owning\_doc: \<feature doc that defines this user-facing path; e.g. Doc 02B, Doc 03B, Doc 04B\>  
    user\_facing\_path: \<one-line description of the path; e.g. 'practice session start → first question delivered'\>  
    consumed\_primitive\_slos:                      \# references into 01A §74A — never restates the budgets  
      \- primitive\_owner: 01A §74A  
        operation: \<exact operation name from §74A table\>  
        consumed\_percentile: \<P50|P95|P99\>  
    consumed\_lisa\_slis:                           \# references into Doc 03C §11.2 — never restates the SLIs  
      \- sli\_name: \<exact §11.2 SLI name, e.g. 'orchestrator\_turn\_latency\_p95'\>  
        sli\_owner: Doc 03C §11.2  
    application\_layer\_overhead\_budget\_ms:         \# the feature-doc-defined application work on top of the primitives  
      p50: \<ms\>  
      p95: \<ms\>  
      p99: \<ms\>  
    composite\_target:                              \# the user-facing path budget; feature-doc-owned  
      p50\_ms: \<total p50 budget\>  
      p95\_ms: \<total p95 budget\>  
      p99\_ms: \<total p99 budget\>  
    severity\_on\_breach: \<Page|Warn|Info per 01A §18\>  
    operational\_response\_urgency: \<immediate|same\_day|next\_business\_day per Parent §13\>  
    owner\_role: \<CODEOWNERS-resolved owning role\>  
    alert\_id: \<link to §7 alert-registry entry\>  
    last\_reviewed\_at: \<iso8601\>

## **5.3 Hard rules (the contract-shape invariants)**

1. **Composite SLO never restates a primitive SLO budget.** `consumed_primitive_slos[].operation` MUST refer to an exact 01A §74A operation name (string match against the §74A table); the percentile values themselves are NOT carried in 06C's registry — they are read from 01A §74A at parity-check time. Restating a §74A value is a `DD-06-REDEF` defect.  
2. **Composite SLO never restates a LISA SLI threshold.** `consumed_lisa_slis[].sli_name` MUST refer to an exact 03C §11.2 SLI name; thresholds are NOT carried in 06C — read from 03C §11.2 at parity-check time.  
3. **Composite target ≥ sum of consumed budgets \+ application\_layer\_overhead, per percentile (RB-06C-V1-02).** For each percentile in `{p50, p95, p99}` populated in the composite SLO, the composite target at that percentile MUST be ≥ Σ(consumed primitive budget at that percentile, read from 01A §74A) \+ `application_layer_overhead_budget_ms[percentile]`. A composite tighter than its decomposition *at any populated percentile* is a defect. Percentiles the schema leaves unpopulated for a given composite are marked `not_applicable` in the proof artifact and skipped.  
4. **Every composite SLO links to an alert entry.** `alert_id` MUST resolve to a §7 alert-registry row. An orphan composite SLO is a defect.  
5. **Composite SLO IDs are doc-prefixed.** `CSLO-02B-NN` for Doc 02B, `CSLO-03B-NN` for Doc 03B, etc. — makes ownership scannable.

## **5.4 V1 set — none defined in 06C (per Q-06C-3=b)**

06C does not define the V1 composite-SLO values. The registry file `infra/composite-slo-registry.yaml` exists at V1 with an empty `composite_slos: []` array. Feature docs populate it as they reach lock; 06C's parity check (§5.5) enforces the contract shape against whatever is present.

## **5.5 Proving mechanism — `ci/composite-slo-registry-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, on PRs touching `infra/composite-slo-registry.yaml` or any feature doc that declares a composite SLO, plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/composite-slo-registry.yaml` \+ 01A §74A operation-name index (parsed once at job start from the canonical 01A source) \+ Doc 03C §11.2 SLI-name index (parsed from the canonical 03C source) \+ §7 `infra/alert-registry.yaml` |
| Failure condition | (a) any `consumed_primitive_slos[].operation` not matching an 01A §74A row by exact string; (b) any `consumed_lisa_slis[].sli_name` not matching a 03C §11.2 SLI by exact string; (c) **for any populated percentile in `{p50, p95, p99}`**: composite target at that percentile \< Σ(consumed primitive budget at that percentile, read from 01A §74A) \+ `application_layer_overhead_budget_ms[percentile]` — the registry consults the consumed budgets at *check time*, never carries them at *store time* (RB-06C-V1-02); (d) any composite SLO with no `alert_id` or with an `alert_id` not in `infra/alert-registry.yaml`; (e) any composite SLO ID without a doc prefix or with a doc prefix that does not own the path |
| Proof artifact | `composite-slo-registry-parity` record conforming to Parent §10.5 envelope \+ extras (§14): `composite_slos_checked[]`, per-row `{composite_slo_id, owning_doc, primitive_refs_resolved[], lisa_sli_refs_resolved[], decomposition_check: {p50: pass|fail|not_applicable, p95: pass|fail|not_applicable, p99: pass|fail|not_applicable}, alert_link_check, decision}` |
| Owner / paging | Platform/CTO; PR-blocking; nightly drift \= Warn per 01A §18 |

---

# **§6 — Severity Crosswalk (Parent §13 Body)**

## **6.0 Canonical source direction (RB-06C-V1-03)**

`infra/severity-crosswalk-registry.yaml` (defined in §7.4) is the **canonical machine-readable source** for the severity crosswalk. The `§6.1` tables below are the **human-readable rendering** of that registry. Production gates (`ci/severity-crosswalk-parity`, `ci/alert-runbook-parity`) consult the YAML registry, never the markdown. The §7.5 parity check verifies that the rendered §6.1 tables match the YAML registry; when they diverge, the YAML registry is authoritative and the markdown is corrected in the next cleanup cycle (Tier-1 06C cleanup, never a Tier-2 version bump). Markdown parsing of spec prose MAY NOT be used as a production-control input — this is a hard rule for 06C and forward.

## **6.1 Crosswalk rules (rendered from `infra/severity-crosswalk-registry.yaml`)**

The single rule that resolves four vocabularies (01A §18, Doc 03 §26.A, 03C §28, 06A/06B findings) into one alert-routing decision.

### **6.1.1 01A §18 → 01A §18 (pass-through)**

01A §18's `Page / Warn / Info / Debug` is the canonical 06C vocabulary. No mapping needed.

### **6.1.2 Doc 03 Main §26.A (CRITICAL / HIGH / MEDIUM / LOW) → 01A §18**

| Doc 03 §26.A severity (referenced) | 01A §18 severity (canonical) | `operational_response_urgency` |
| ----- | ----- | ----- |
| CRITICAL | Page | immediate |
| HIGH | Page | same\_day OR immediate (the §7 alert-registry row carries the precise binding per failure mode — same\_day if remediation bounded, immediate if user-facing impact ongoing) |
| MEDIUM | Warn | same\_day |
| LOW | Info | next\_business\_day |

The choice between same\_day / immediate for HIGH is made per-row in §7 (the alert-registry row owns the urgency assignment), never in this table.

### **6.1.3 Doc 03C §28 per-row alert column → 01A §18 (pass-through)**

Doc 03C §28's per-row alert column already uses `page / warn / info` (already 01A §18-aligned). 06C passes it through without remapping. **No restatement of the per-row thresholds or alert conditions.**

### **6.1.4 01A §74A SLO breach → 01A §18**

01A §74A specifies its own breach escalation (referenced — not restated). 06C honors §74A's rule and adds nothing. The alert-registry entry for an SLO breach inherits §74A's escalation timing.

### **6.1.5 06B finding → 01A §18**

| 06B finding class | 01A §18 severity | `operational_response_urgency` |
| ----- | ----- | ----- |
| Break-glass session out-of-scope action (06B §7.6) | Page | immediate |
| HMAC rotation overdue (06B §6.4) — `warn` state | Warn | same\_day |
| HMAC rotation overdue (06B §6.4) — `overdue` state | Page | immediate |
| Internal-endpoint reachable from public (06B §11.4) — 200 or app-error | Page | immediate |
| Internal-endpoint reachable from public — HMAC 401 (ingress missed; defense-in-depth caught) | Warn | same\_day |
| `ci/no-server-secret-in-client` blocker pattern (06B §5.3) | Page | immediate (PR-blocking) |
| `ci/no-server-secret-in-client` expired allowlist (06B §5.4.1) | Warn | next\_business\_day |
| Privileged-op coverage gap (06B §8.4) — substrate has live writes | Page | immediate |
| Privileged-op coverage gap (06B §8.4) — reserved slot (V8 §44 FWD) | Warn | next\_business\_day |
| Rate-limit config governance failure (06B §10.4) — multiplier weakened below default | Page | immediate |
| Rate-limit config governance failure — change without PR | Warn | same\_day |

### **6.1.6 06A release-gate failure → 01A §18**

| 06A release-gate failure class | 01A §18 severity | `operational_response_urgency` |
| ----- | ----- | ----- |
| `pre_deploy` gate fails | Page (PR-blocking) | immediate |
| `post_deploy` gate fails | Page | immediate |
| `nightly` gate fails | Warn | same\_day |
| Migration with `data_impact ∈ {transforms_data, deletes_data}` missing pre-apply backup proof (06A §11.3 RB-06A-V1-06 enum; RB-06C-V1-11) | Page | immediate (deploy-blocking) |
| Queue/outbox dead-letter rate exceeds threshold | Page | immediate |

### **6.1.7 06C-owned events → 01A §18**

Self-references for the proving mechanisms 06C introduces:

| 06C event | 01A §18 severity | `operational_response_urgency` |
| ----- | ----- | ----- |
| Scheduled-job heartbeat missing past `expected_max_gap_seconds` (§8.4) | Page | immediate |
| Synthetic-probe execution failure (the probe itself fails, not what it tests) (§9.4) | Warn | same\_day |
| Synthetic-probe finds CF Access policy contains GitHub IP ranges (§9.4) | Page | immediate |
| Incident-lifecycle declared but no commander assigned past §10.3 timing requirement (§10.4) | Page | immediate |
| Status-page state diverges from `incidents` table (§12.4) | Warn | same\_day |
| On-call rotation gap (no primary assigned for a calendar window) (§11.4) | Page | immediate |

## **6.2 No severity restatement — audit-enforced**

The §16 audit's primitive-body-restatement pass extends to 06C: any number from 01A §74A, any threshold from 03C §11.2, any 03C §28 row alert string, any 01A §18 response-time, is a `DD-06-REDEF` defect when stated in 06C without a `(referenced; 01A §X / 03C §Y)` citation. The crosswalk tables above use category names only — no numeric thresholds.

---

# **§7 — Alert Registry (`infra/alert-registry.yaml`)**

## **7.1 Required shape**

Every alert that fires in production has an entry. The registry is the **single source of truth** for alert → owner → runbook → severity → urgency. An alert without an entry is INV-06-10 violation.

alerts:  
  \- alert\_id: \<stable id; format 'ALERT-\<area\>-\<NN\>'\>  
    source\_class: \[01a\_primitive\_slo | doc03\_failure\_mode | doc03c\_failure\_class | doc06a\_release\_gate | doc06b\_finding | doc06c\_event\]  
    source\_ref:                                    \# exact pointer into canonical owner  
      doc: \<01A | Doc 03 Main | Doc 03C | Doc 06A | Doc 06B | Doc 06C\>  
      section: \<exact §, e.g. '§74A' | '§26.A' | '§28.2' | '§10' | '§8.4'\>  
      row\_id\_or\_name: \<if a specific row/SLI name applies\>  
    severity: \<Page | Warn | Info\>                 \# per 01A §18 (referenced)  
    operational\_response\_urgency: \<immediate | same\_day | next\_business\_day\>   \# per Parent §13  
    owner\_role: \<CODEOWNERS-resolved role\>  
    rotation\_ref: \<link to §11 rotation; for non-tutor see '06c\_non\_tutor\_unified'; for tutor see 'doc03\_main\_21\_3'\>  
    runbook\_ref:                                   \# link to a runbook in docs/runbooks/ or referenced owning doc  
      path: \<docs/runbooks/X.md | Doc 03/03C/06A/06B/06C §Y\>  
      acceptance\_criterion: \<executable proof per Parent §12.2 — e.g. 'incident resolved within urgency\_target AND postmortem committed'\>  
    paging\_target\_v1: \<01A §18 routing — phone/SMS/Slack-page | Slack-warn | Slack-info\>  
    user\_facing\_impact: \<true | false\>             \# used by §12 status-page conformance  
    tutor\_class: \<true | false\>                    \# RB-06C-V1-13: per-alert classification driving §11.4 rotation routing; default per §11.4 03C source-range table  
    last\_reviewed\_at: \<iso8601\>

## **7.2 Hard rules (the alert-registry invariants)**

1. **`source_class` and `source_ref` together MUST resolve to a canonical owner.** A self-attributed alert (e.g. `source_class: 06c_event`, `source_ref.doc: 06C`) is permitted only for the 06C-owned events listed in §6.1.7; any other self-attribution is a `DD-06-REDEF` defect.  
2. **Severity MUST match the §6.1 crosswalk row** for the given source\_class and source\_ref. Hand-edited severity that does not derive from the crosswalk is a defect.  
3. **Every Page-severity row MUST have a populated `runbook_ref` AND `acceptance_criterion`.** A Page alert without a runbook is the literal INV-06-10 violation.  
4. **`rotation_ref` MUST be `doc03_main_21_3` for any tutor-class alert, `06c_non_tutor_unified` for all others.** Routing a tutor-class alert to the non-tutor rotation, or vice versa, is a defect (§11.4 parity).  
5. **`last_reviewed_at` MUST be within 180 days.** Stale alerts fail `ci/alert-runbook-parity`.

## **7.3 Proving mechanism — `ci/alert-runbook-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, on PRs touching `infra/alert-registry.yaml` or any referenced runbook file under `docs/runbooks/`, plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/alert-registry.yaml` \+ the §6.1 crosswalk encoded as a YAML rule table at `infra/severity-crosswalk-registry.yaml` \+ the runbook file tree under `docs/runbooks/` \+ canonical owner indices: 01A §74A operations, 01A §18 severities, Doc 03 §26.A failure modes (cited per project handoff record at draft time; replaced with parsed index when Doc 03 Main lands in the source tree per §3.4), Doc 03C §28.1–§28.8 row IDs (parsed from the 03C source) |
| Failure condition | (a) any alert row whose `source_ref` does not resolve to a canonical-owner row; (b) any alert row whose `severity` does not match the §6.1 crosswalk; (c) any Page-severity row whose `runbook_ref` does not resolve to an existing file OR whose `acceptance_criterion` is empty; (d) any tutor-class alert routed to `06c_non_tutor_unified` (or inverse); (e) any alert with `last_reviewed_at` older than 180 days; (f) any alert with no rotation\_ref |
| Proof artifact | `alert-runbook-parity` record per Parent §10.5 \+ extras (§14): `alerts_checked[]`, per-alert `{alert_id, source_class, source_ref_resolved, severity_crosswalk_check, runbook_resolved, rotation_check, last_reviewed_age_days, decision}` |
| Owner / paging | Platform/CTO; PR-blocking |

## **7.4 Severity-crosswalk registry — `infra/severity-crosswalk-registry.yaml`**

The §6.1 crosswalk is encoded as a machine-readable YAML registry so `ci/alert-runbook-parity` can mechanically check that each alert's severity derives from a crosswalk row. Maintained by Platform/CTO; changes require a PR \+ CODEOWNERS review \+ emit 01A §5 config-history per the §10 release-gate manifest.

crosswalk\_rows:  
  \# §6.1.2 Doc 03 §26.A  
  \- source\_class: doc03\_failure\_mode  
    source\_ref\_severity: CRITICAL  
    canonical\_severity: Page  
    operational\_response\_urgency: immediate  
  \- source\_class: doc03\_failure\_mode  
    source\_ref\_severity: HIGH  
    canonical\_severity: Page  
    operational\_response\_urgency: \[immediate, same\_day\]   \# per-row choice in alert-registry  
  \- source\_class: doc03\_failure\_mode  
    source\_ref\_severity: MEDIUM  
    canonical\_severity: Warn  
    operational\_response\_urgency: same\_day  
  \- source\_class: doc03\_failure\_mode  
    source\_ref\_severity: LOW  
    canonical\_severity: Info  
    operational\_response\_urgency: next\_business\_day  
  \# §6.1.3 03C §28 — pass-through; severity field already canonical  
  \- source\_class: doc03c\_failure\_class  
    pass\_through: true  
  \# §6.1.4 01A §74A — defer to §74A's own escalation rule  
  \- source\_class: 01a\_primitive\_slo  
    defer\_to\_owner: '01A §74A'  
  \# §6.1.5 06B findings — explicit per-finding-class table per §6.1.5  
  \# (one row per 06B finding-class; encoded explicitly in the YAML)  
  \# §6.1.6 06A release-gate failures — explicit per-class table per §6.1.6  
  \# §6.1.7 06C-owned events — explicit per-event table per §6.1.7

## **7.5 Proving mechanism — `ci/severity-crosswalk-parity` (Parent §6.13)**

Per §6.0, the YAML registry is the canonical source. This mechanism verifies that the rendered §6.1 tables in this document match the registry — divergence is a markdown-rendering defect, never a registry defect (the registry is authoritative).

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, on PRs touching `infra/severity-crosswalk-registry.yaml` or Doc 06C §6, plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/severity-crosswalk-registry.yaml` (canonical) \+ this document's §6.1 tables (parsed structurally for rendering-verification only — markdown is NOT a production-control input per §6.0 hard rule) (RB-06C-V1-03) |
| Failure condition | (a) any rendered §6.1 row absent from the YAML registry; (b) any YAML registry row whose rendered §6.1 row diverges in `source_class`, `source_ref_severity`, `canonical_severity`, or `operational_response_urgency`; (c) any alert-registry row whose `severity` does not resolve through a YAML registry row (i.e. the canonical lookup path); (d) the rendered §6.1 contains a row not in the YAML registry (orphan markdown) |
| Proof artifact | `severity-crosswalk-parity` record per Parent §10.5 \+ extras (§14): `yaml_rows_parsed[]` (canonical), `markdown_rows_rendered[]` (rendering), `rendering_mismatches[]`, `orphan_markdown_rows[]`, `alert_registry_lookup_failures[]` |
| Owner / paging | Platform/CTO; PR-blocking |

## **7.6 Runbook required shape (Parent §12.2 — applied)**

Per Parent §12, runbook bodies live in `docs/runbooks/` (06C does not inline them). Each runbook has:

runbook\_id:                \<stable id; matches alert\_registry runbook\_ref.path filename stem\>  
trigger:                   \<which alert(s) trigger it\>  
pre\_conditions:            \<state the runbook expects on entry\>  
procedure:                 \<step list — references canonical-owner § for any primitive-body step; never restates\>  
executable\_proof\_acceptance\_criterion:  
                           \<a measurable condition that, when true, proves the runbook succeeded\>  
owner:                     \<CODEOWNERS-resolved\>  
paging:                    \<01A §18 routing\>  
operational\_response\_urgency: \<immediate | same\_day | next\_business\_day\>

The `executable_proof_acceptance_criterion` is the non-negotiable element — a runbook whose acceptance criterion is "engineer judgement" or "looks healthy" is a `DD-06-PROOF` defect.

---

# **§8 — Scheduled-Job Registry & Heartbeat Substrate (INV-06-04)**

## **8.1 Coverage rule**

INV-06-04: every scheduled job in the platform emits a heartbeat with a known cadence and a maximum acceptable gap. A missing heartbeat past `expected_max_gap_seconds` is a Page-severity alert.

## **8.2 Scheduled-job registry — `infra/scheduled-job-registry.yaml`**

scheduled\_jobs:  
  \- job\_id: \<stable id; format 'JOB-\<area\>-\<NN\>'\>  
    job\_name: \<human-readable\>  
    canonical\_owner\_doc\_and\_section: \<e.g. '06B §6.4' | '01A §54' | '06D §X' | '03C §28.5'\>  
    execution\_substrate: \<vercel\_cron | github\_actions\_cron | gcp\_cloud\_scheduler | pg\_cron | manual\>  
    cadence: \<ISO8601 duration or cron expression\>  
    expected\_max\_gap\_seconds: \<int — heartbeat must arrive within this gap\>  
    heartbeat\_substrate: scheduled\_job\_heartbeats     \# the relational table below  
    failure\_alert\_id: \<links to §7 alert-registry\>  
    owner\_role: \<CODEOWNERS-resolved\>  
    last\_observed\_heartbeat\_at: \<iso8601 — kept in sync by the heartbeat substrate, not hand-edited\>

## **8.3 Heartbeat substrate (relational, single-writer per job)**

Each scheduled job, on successful execution, MUST INSERT one row into `scheduled_job_heartbeats`:

CREATE TABLE scheduled\_job\_heartbeats (  
  id                    uuid PRIMARY KEY,  
  job\_id                text NOT NULL,                  \-- matches registry job\_id  
  observed\_at           timestamptz NOT NULL DEFAULT now(),  
  execution\_substrate   text NOT NULL,  
  execution\_run\_id      text,                            \-- substrate-native run id (Vercel deployment id, GHA run id, etc.)  
  execution\_outcome     text NOT NULL,                   \-- 'success' | 'partial\_success' | 'failure'  
  proof\_artifact\_ref    text,                            \-- pointer to the job's §10.5 envelope artifact (where applicable)  
  CHECK (execution\_outcome IN ('success','partial\_success','failure'))  
);  
CREATE INDEX idx\_scheduled\_job\_heartbeats\_job\_recent  
  ON scheduled\_job\_heartbeats (job\_id, observed\_at DESC);

Single-writer governance per Doc 01 V6 §3.1.4 discipline (referenced) — only the job's own service identity may INSERT.

## **8.4 Proving mechanism — `ops/scheduled-job-heartbeat-conformance` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled job itself (Vercel Cron, executes independently of the substrates it monitors), reconciling against `scheduled_job_heartbeats` |
| Trigger cadence | Every 5 minutes |
| Input registry | `infra/scheduled-job-registry.yaml` \+ `scheduled_job_heartbeats` (latest row per `job_id`) |
| Failure condition | For any `job_id` in the registry: `(now - last_observed_heartbeat.observed_at) > expected_max_gap_seconds` → Page per the registry's `failure_alert_id`; OR `latest_execution_outcome = 'failure'` for two consecutive heartbeats → Page; OR a registry `job_id` with no heartbeat row in the past 24h → Page (job never ran since registration); OR a `scheduled_job_heartbeats` row with no matching `job_id` in the registry → Warn (drift: job is running but not registered) |
| Proof artifact | `scheduled-job-heartbeat-conformance` record per Parent §10.5 \+ extras (§14): `jobs_checked[]`, per-job \`{job\_id, last\_observed\_heartbeat\_at, gap\_seconds, expected\_max\_gap\_seconds, latest\_outcome, status: ok |
| Owner / paging | Platform/CTO; per §11 unified rotation |

## **8.5 INV-06-04 partial-provability**

Per Parent §6.13, until every scheduled job in the platform is registered in `infra/scheduled-job-registry.yaml` AND emits to `scheduled_job_heartbeats`, INV-06-04 is partial-provable. The registry file at V1 contains the launch-known set (06B §6.4 HMAC rotation currency, 06B §10.4 rate-limit config governance, 01A §54 abuse score recompute, idempotency retention cron per 01A §34, audit archival per Doc 01 V8 §5.1 when V8 lands \[FWD-06-02\]); feature docs add their own as they reach lock. The §16 audit's `ci/scheduled-job-registry-parity` pass reports the partial set with line numbers, never silently passes a missing entry.

## **8.6 Proving mechanism — `ci/scheduled-job-registry-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, on PRs touching `infra/scheduled-job-registry.yaml`, plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/scheduled-job-registry.yaml` \+ the §7 `infra/alert-registry.yaml` (every job's `failure_alert_id` MUST resolve there) \+ the canonical-owner index (each job's `canonical_owner_doc_and_section` MUST resolve to a referenced doc and §) |
| Failure condition | (a) any `failure_alert_id` not resolving in the alert-registry; (b) any `canonical_owner_doc_and_section` not resolving (doc not in the dependency set OR § not present in the canonical doc's anchor index); (c) any `expected_max_gap_seconds` outside the **2×–24× cadence band UNLESS the registry entry carries an `expected_max_gap_seconds_exception` block with `justification`, `approver_role`, and `approved_at` (RB-06C-V1-12)** — long-cadence jobs (monthly/quarterly) and jobs with intrinsically variable cadence require explicit exception with audit trail, no silent escape; (d) any registry entry without an `execution_substrate` matching the §18 V1 environment matrix; (e) **the monitor job itself (`JOB-OBS-HEARTBEAT-CONFORMANCE`, §8.7) MUST be registered with an `external_watchdog` block (RB-06C-V1-01)** |
| Proof artifact | `scheduled-job-registry-parity` record per Parent §10.5 \+ extras (§14): `jobs_checked[]`, per-job `{job_id, alert_link_check, canonical_owner_check, gap_to_cadence_ratio, exception_present, substrate_check, watchdog_check, decision}` |
| Owner / paging | Platform/CTO; PR-blocking |

## **8.7 External watchdog requirement for the monitor job (RB-06C-V1-01)**

The §8.4 `ops/scheduled-job-heartbeat-conformance` job is itself a scheduled job — if it shares a substrate class with the jobs it monitors, a substrate-class failure can silently take both down. INV-06-04 then fails at the monitor layer with no signal.

V1 mitigation (06C-owned, mandatory):

1. **The monitor is registered.** `JOB-OBS-HEARTBEAT-CONFORMANCE` is itself an entry in `infra/scheduled-job-registry.yaml` and emits to `scheduled_job_heartbeats` like every other registered job.

**The monitor has an external watchdog on a different substrate class.** Each registry entry carries an `external_watchdog` block (REQUIRED for the monitor job; OPTIONAL for every other job until V1.1):

 scheduled\_jobs:  
  \- job\_id: JOB-OBS-HEARTBEAT-CONFORMANCE  
    job\_name: 'Heartbeat conformance reconciliation'  
    canonical\_owner\_doc\_and\_section: 'Doc 06C §8.4'  
    execution\_substrate: vercel\_cron  
    cadence: 'PT5M'                                  \# every 5 minutes  
    expected\_max\_gap\_seconds: 900                    \# 3× cadence  
    heartbeat\_substrate: scheduled\_job\_heartbeats  
    failure\_alert\_id: ALERT-OBS-01  
    owner\_role: platform\_cto  
    external\_watchdog:  
      substrate: github\_actions\_cron                 \# different substrate class from execution\_substrate  
      expected\_artifact: scheduled-job-heartbeat-conformance  
      expected\_max\_gap\_seconds: 1800                 \# ≥ 2× the monitor's own gap, never tighter  
      watchdog\_failure\_alert\_id: ALERT-OBS-02        \# links to a separate alert routing through §11 unified rotation

2.   
3. **Substrate-class diversity check.** The `external_watchdog.substrate` MUST be in a different substrate class from the monitored job's `execution_substrate`. The §8.6 parity check enforces this — a watchdog and its monitor on the same substrate class is a defect.

4. **Watchdog gap looser than monitor gap.** The watchdog's `expected_max_gap_seconds` MUST be ≥ 2× the monitor's `expected_max_gap_seconds` to avoid false-positive cascades when the monitor is merely slow.

## **8.8 Heartbeat insert validated write path (RB-06C-V1-08)**

The `scheduled_job_heartbeats.job_id` column is `text` (not a database FK to a registry row, because the registry is a YAML file). A typo in a job's own heartbeat call would create an "unregistered heartbeat" warning per §8.4 instead of correctly flagging "the real job missed its heartbeat."

V1 mitigation: heartbeat inserts MUST go through a server-side RPC `record_scheduled_job_heartbeat(p_job_id, p_outcome, p_proof_artifact_ref)` that:

1. Loads the current registry snapshot (cached per Doc 01A §3 invalidation pattern; referenced).  
2. **Rejects** the insert with `JOB_ID_NOT_REGISTERED` if `p_job_id` is not in the snapshot — the caller's exception is the typo detector.  
3. **Inserts** into `scheduled_job_heartbeats` with `execution_substrate` populated from the registry entry (eliminating per-call drift), `execution_outcome = p_outcome`, `proof_artifact_ref = p_proof_artifact_ref`.  
4. **Logs** at 01A §13 INFO level on success, ERROR on rejection.

Direct `INSERT INTO scheduled_job_heartbeats` from application code is forbidden; the §11.2 audit substrate's single-writer governance (Doc 01 V6 §3.1.4 referenced) applies — only the RPC may write the table.

---

# **§9 — Synthetic-Probe Execution Location (Q-06C-1 \= a)**

## **9.1 V1 binding**

Synthetic probes that must execute from a network *outside* both Vercel and GCP — currently the 06B §11.4 `ops/internal-endpoint-exposure-probe`, and any future probe of "we're publicly unreachable" / "we're publicly reachable as expected" type — execute on **GitHub Actions hosted runners** (Q-06C-1=a locked).

## **9.2 Why hosted runner and mitigation of whitelist-masking risk**

GitHub Actions hosted runners egress from GitHub's published IP ranges. The risk is that an ingress restriction inadvertently whitelists GitHub IP space — which would produce false `ingress_rejected` results.

V1 mitigation (06C-owned):

1. **The probe's §10.5 envelope artifact records the egress IP** (the runner's outbound IP at probe time) AND a SHA-256 hash of the CF Access policy state fetched in the same job.  
2. **Hard rule (06C-owned):** the CF Access policy MAY NOT contain GitHub IP ranges as allowed sources. The §9.4 proving mechanism reads the CF Access policy (via the CF Access API) and parses it structurally — extracting all `include`\-rule IP-range entries — then checks each against GitHub's documented public IP-range list (`https://api.github.com/meta` → `actions` array, fetched in the same job). Any overlap is a Page-severity finding.  
3. **The probe additionally asserts** that an authenticated HMAC request from a *registered service pair* (staging-only per 06B §6.5 / RB-06B-V1-01) successfully reaches the application — confirming the ingress restriction is the *only* layer doing the work, not just blocking unknown IPs.

V1.1 hook: a second-substrate probe (Cloudflare Workers or a small dedicated VM per the Q-06C-1 alternatives) is registered in §17 W4 as a watch-item.

## **9.3 Probe inventory — `infra/synthetic-probes.yaml`**

synthetic\_probes:  
  \- probe\_id: \<stable id; format 'PROBE-\<area\>-\<NN\>'\>  
    probe\_name: \<human-readable\>  
    execution\_substrate: github\_actions\_hosted\_runner    \# V1; Tier-2 may add others  
    cadence: \<ISO8601\>  
    target\_routes\_source: \<e.g. 'infra/route-surface-classification.yaml\#is\_internal\_api'\>  
    expected\_outcome\_class: \<ingress\_rejected | application\_rejected\_after\_hmac | application\_succeeded\>  
    failure\_alert\_id: \<links to §7\>  
    owner\_role: \<CODEOWNERS-resolved\>

## **9.4 Proving mechanism — `ops/synthetic-probe-conformance` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions hosted runner (Q-06C-1=a) |
| Trigger cadence | Per `synthetic_probes[].cadence` (V1: daily for `PROBE-INTERNAL-01` \= 06B §11.4 internal-endpoint exposure) |
| Input registry | `infra/synthetic-probes.yaml` \+ `infra/route-surface-classification.yaml` (06A §5.3.1, extended per RB-06A-V1-11) \+ the Cloudflare Access policy state (fetched via CF API) \+ GitHub's IP-range list for the `actions` runner pool (fetched from `https://api.github.com/meta` in the same job) \+ `infra/github-meta-snapshot.json` — the last-successful-fetch snapshot persisted in the repo (RB-06C-V1-09) |
| External-fetch failure semantics (RB-06C-V1-09) | If the live `https://api.github.com/meta` fetch fails (any non-2xx, timeout, or parse failure), the probe MUST: (i) fall back to `infra/github-meta-snapshot.json` and continue overlap detection against the snapshot; (ii) record `github_meta_fetch_result: failed` \+ `metadata_source: snapshot` \+ `metadata_snapshot_age_seconds`; (iii) the probe RESULT is `inconclusive` (not pass) for the github-IP-overlap check specifically — `target_results[].decision` for that sub-check is `inconclusive`; (iv) snapshot age \> 7 days → Warn; \> 30 days → Page (the snapshot is stale enough that overlap detection is unreliable). Live-fetch success refreshes the snapshot. Silent pass on metadata-fetch failure is forbidden. |
| Failure condition | (a) any target route whose observed `probe_response_class` does not match `expected_outcome_class`; (b) any overlap between CF Access policy `include` rule IP-ranges and GitHub's `actions` IP-ranges (Page — §9.2 hard rule; parsed structurally from the CF policy JSON, not regex-matched against rule descriptions); (c) the probe itself fails to execute (no envelope artifact produced for the cadence window) — Warn (§6.1.7); (d) authenticated staging HMAC request from registered service pair fails to reach the application (proves the ingress isn't blocking by accident) — Page; (e) GitHub meta fetch fails AND snapshot age \> 30 days — Page (RB-06C-V1-09); (f) GitHub meta fetch fails AND snapshot age 7–30 days — Warn (RB-06C-V1-09) |
| Proof artifact | `synthetic-probe-conformance` record per Parent §10.5 \+ extras (§14): `probes_run[]`, per-probe `{probe_id, egress_ip_observed, cf_access_policy_hash, github_meta_fetch_result, metadata_source, metadata_snapshot_age_seconds, github_ip_range_overlap_check: {overlap_count, overlapping_ranges[], decision: pass|fail|inconclusive}, target_results[]: {route, expected_outcome_class, observed_outcome_class, hmac_legit_path_check}}` |
| Owner / paging | Platform/CTO; per §11 unified rotation |

## **9.5 Boundary**

`PROBE-INTERNAL-01`'s HTTP-layer ingress check body is **06B §11.4 canonical** (referenced); 06C provides only the *execution location* and the *outcome-class registry* \+ the §9.2 CF Access mitigation rule. Restating the probe's HTTP-layer assertions is a `DD-06-REDEF` defect.

---

# **§10 — Incident-Response Lifecycle**

## **10.1 Lifecycle phases**

Every incident progresses through these phases. Phases are not skipped (a postmortem-skipped incident is a `DD-06-PROOF` defect against §10.4 below).

| Phase | Entry condition | Exit condition |
| ----- | ----- | ----- |
| `declared` | A Page-severity alert fires AND an operator (or automated rule) declares the incident | A commander is assigned |
| `investigating` | Commander assigned | Mitigation plan identified |
| `mitigating` | Mitigation plan agreed | User-facing impact resolved OR no further mitigation possible |
| `resolved` | Mitigation complete; alert recovered | Postmortem scheduled |
| `postmortem` | Postmortem scheduled | Postmortem document committed to repo at `docs/postmortems/INC-YYYYMMDD-NN.md` |

## **10.2 Relational incident substrate**

CREATE TABLE incidents (  
  incident\_id           text PRIMARY KEY,           \-- format 'INC-YYYYMMDD-NN'  
  declared\_at           timestamptz NOT NULL,  
  declared\_by\_user\_id   uuid NOT NULL,  
  triggering\_alert\_id   text,                       \-- links to §7 alert-registry (NULL if declared manually)  
  commander\_user\_id     uuid,                       \-- NULL until phase \= 'investigating' (CHECK below)  
  severity              text NOT NULL,              \-- 'Page' | 'Warn' (incidents are NOT declared for Info)  
  current\_phase         text NOT NULL,              \-- 'declared' | 'investigating' | 'mitigating' | 'resolved' | 'postmortem'  
  user\_facing\_impact    boolean NOT NULL DEFAULT false,   \-- drives §12 status-page conformance  
  resolved\_at           timestamptz,  
  postmortem\_path       text,                       \-- relative path; required for Page-severity at phase=postmortem  
  CHECK (severity IN ('Page','Warn')),  
  CHECK (current\_phase IN ('declared','investigating','mitigating','resolved','postmortem')),  
  CHECK (current\_phase \= 'declared' OR commander\_user\_id IS NOT NULL),  
  CHECK (current\_phase \<\> 'postmortem' OR severity \<\> 'Page' OR postmortem\_path IS NOT NULL),  
  CHECK (postmortem\_path IS NULL OR postmortem\_path \~ '^docs/postmortems/INC-\[0-9\]{8}-\[0-9\]{2}\\.md$')   \-- RB-06C-V1-05  
);  
CREATE INDEX idx\_incidents\_phase    ON incidents (current\_phase) WHERE current\_phase \<\> 'postmortem';  
CREATE INDEX idx\_incidents\_declared ON incidents (declared\_at DESC);  
CREATE INDEX idx\_incidents\_user\_facing\_open  
  ON incidents (severity, current\_phase) WHERE user\_facing\_impact \= true AND current\_phase \<\> 'postmortem';

CREATE TABLE incident\_phase\_transitions (  
  id                      uuid PRIMARY KEY,  
  incident\_id             text NOT NULL REFERENCES incidents(incident\_id),  
  from\_phase              text,  
  to\_phase                text NOT NULL,  
  transitioned\_at         timestamptz NOT NULL DEFAULT now(),  
  transitioned\_by\_user\_id uuid NOT NULL,  
  notes                   text,  
  CHECK (to\_phase IN ('declared','investigating','mitigating','resolved','postmortem'))  
);  
CREATE INDEX idx\_incident\_phase\_transitions\_incident  
  ON incident\_phase\_transitions (incident\_id, transitioned\_at);

CREATE TABLE incident\_action\_items (  
  id                  uuid PRIMARY KEY,  
  incident\_id         text NOT NULL REFERENCES incidents(incident\_id),  
  description         text NOT NULL,  
  assigned\_to\_user\_id uuid,  
  due\_at              timestamptz,  
  completed\_at        timestamptz,  
  linked\_ticket       text                          \-- issue tracker reference  
);  
CREATE INDEX idx\_incident\_action\_items\_open  
  ON incident\_action\_items (incident\_id) WHERE completed\_at IS NULL;

Single-writer governance per Doc 01 V6 §3.1.4 discipline (referenced); break-glass session activity inside an incident is also recorded in 06B §8.3 `privileged_session_actions` with `incident_ref` pointing at `incidents.incident_id`.

## **10.2.1 Phase-transition RPC (RB-06C-V1-04)**

The schema CHECK constraints validate phase *values* but not phase *transitions* (a direct UPDATE setting `current_phase = 'declared'` on a row already at `resolved` is structurally legal). Phase transitions MUST be done through a single server-side RPC `transition_incident_phase(p_incident_id, p_to_phase, p_actor_user_id, p_notes)` that:

1. Reads the incident's `current_phase` (`SELECT ... FOR UPDATE` in the same transaction).

**Rejects** with `ILLEGAL_PHASE_TRANSITION` unless `(from_phase, to_phase)` is in the legal-transition table:

 Legal transitions (and only these):  
  declared      → investigating  
  investigating → mitigating  
  mitigating    → resolved  
  resolved      → postmortem  
  \-- no reverse transitions; no phase skips; postmortem is terminal

2.   
3. **Updates** `incidents.current_phase` and **inserts** `incident_phase_transitions(from_phase, to_phase, transitioned_at, transitioned_by_user_id, notes)` in the **same transaction** — the two writes never separate.

4. **Validates pre-conditions** specific to the destination phase: `declared → investigating` requires `commander_user_id IS NOT NULL` (set in the same RPC call or a preceding one); `resolved → postmortem` requires `resolved_at IS NOT NULL`; etc.

5. **Logs** at 01A §13 INFO level on success, ERROR on rejection with the offending `(from_phase, to_phase)` pair.

Direct `UPDATE incidents SET current_phase = ...` from application code is forbidden — the §10.4 audit's phase-skip detection catches violations after the fact; the RPC prevents them up-front. The §10.4 reconciliation continues running as defense in depth.

## **10.3 Phase timing requirements**

### **10.3.1 Page-severity incidents**

* **`declared` → `investigating`** within **5 minutes** of declaration. A declared incident with no commander after 5 minutes raises the §6.1.7 self-alert.  
* **`mitigating` → `resolved`** has no fixed clock; the `operational_response_urgency` of the triggering alert sets the soft target (immediate → resolved within hours; same\_day → within the business day; next\_business\_day → within the next business day).  
* **`resolved` → `postmortem`** within **5 business days**; postmortem document committed at `docs/postmortems/INC-YYYYMMDD-NN.md` with the §10.5 required shape.

### **10.3.2 Warn-severity incident declaration rule (RB-06C-V1-10)**

Warn alerts are not automatically incidents — they fire into the §11 rotation but do not create an `incidents` row by default. A Warn alert MAY be **promoted** to an incident by explicit operator judgement when the alert requires coordinated response (multiple owners, cross-system mitigation, or sustained-impact concerns). Promotion is recorded by the operator calling `declare_incident(..., severity='Warn', triggering_alert_id=...)`. Promoted Warn incidents follow the same §10.1 lifecycle, with timing relaxed to match the underlying alert's `operational_response_urgency`:

* **`declared` → `investigating`** within the time bound the alert's urgency implies (same\_day → before end of business day; next\_business\_day → before end of next business day; immediate → 5 minutes, treated as Page-equivalent for timing only — if the situation actually warrants 5-minute response, the alert should be re-assessed for severity revision per §10.5 feedback loop).  
* **`mitigating` → `resolved`** governed by the alert's urgency same as Page incidents.  
* **`resolved` → `postmortem`** — postmortem is **OPTIONAL** for Warn incidents (the §10.5 schema CHECK only requires `postmortem_path` for `severity = 'Page'`); a Warn incident commander MAY choose to commit a postmortem if it produced systemic learnings. Reconciliation (§10.4) does not penalize a Warn incident lacking a postmortem.

This prevents every Warn alert from becoming an incident by implication. The §10.4 `ops/incident-lifecycle-conformance` check distinguishes `severity = 'Warn'` and applies the relaxed timing per the triggering alert's urgency, not the strict Page timing.

## **10.4 Proving mechanism — `ops/incident-lifecycle-conformance` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled reconciliation job (Vercel Cron) reconciling against `incidents` \+ `incident_phase_transitions` \+ the `docs/postmortems/` directory |
| Trigger cadence | Every hour during active incidents, daily aggregate |
| Input registry | `incidents` rows in past 90 days \+ `incident_phase_transitions` per incident \+ filesystem listing of `docs/postmortems/INC-*.md` |
| Failure condition | (a) any incident in `declared` phase for \>5 minutes with `severity = 'Page'` and `commander_user_id IS NULL`; (b) any incident in `resolved` phase \>5 business days with `severity = 'Page'` and no `postmortem_path`; (c) any incident with `current_phase = 'postmortem'`, `severity = 'Page'`, and `postmortem_path` referencing a file that does not exist in the repo (NULL is CHECK-blocked at schema level; file existing is filesystem-level); (d) any incident\_phase\_transitions sequence that skips a phase (e.g. `declared → mitigating` without `investigating`); (e) any Page-severity incident with open `incident_action_items` past `due_at` |
| Proof artifact | `incident-lifecycle-conformance` record per Parent §10.5 \+ extras (§14): `incidents_checked[]`, per-incident `{incident_id, severity, current_phase, phase_durations, commander_assignment_lag_seconds, postmortem_path, postmortem_file_exists, open_overdue_action_items[]}` |
| Owner / paging | Founder \+ ops-lead; per §11 unified rotation |

## **10.5 Postmortem document required shape**

\# Incident INC-YYYYMMDD-NN — \<one-line title\>

\#\# Summary  
\<2-3 sentences\>

\#\# Timeline  
| Time (UTC) | Event |

\#\# Impact  
\<user-facing impact: who, how many, for how long\>

\#\# Root cause  
\<why this happened\>

\#\# Contributing factors  
\<what made it worse or harder to recover\>

\#\# What went well  
\<the things that did work\>

\#\# Action items  
\<linked to incident\_action\_items\[\]\>

\#\# Severity assessment  
\<was the declared severity correct in retrospect; if not, what should it have been\>

The `Severity assessment` section is required — it is the feedback loop into the §6.1 crosswalk: if a class of incidents is consistently mis-severity'd, the alert-registry row's `severity` field needs revision (this is a Tier-1 06C cleanup, not a Tier-2 change).

### **10.5.1 Severity-assessment feedback ownership (RB-06C-V1-15)**

Severity-assessment findings accumulate in postmortem documents. To close the feedback loop into the alert-registry without ad-hoc handling:

* **Owner:** Platform/CTO.  
* **Cadence:** monthly review of all postmortem `Severity assessment` sections committed in the prior calendar month.  
* **Output:** when a class of incidents shows a pattern of mis-severity assignment (≥2 postmortems in a 90-day window with consistent assessment that the declared severity was wrong), the owner opens a PR against `infra/alert-registry.yaml` and (where applicable) `infra/severity-crosswalk-registry.yaml` adjusting the affected rows. The PR is reviewed via the standard `ci/alert-runbook-parity` \+ `ci/severity-crosswalk-parity` gates.  
* **Audit trail:** the monthly review is itself logged via a `scheduled_job_heartbeats` entry for `JOB-OBS-SEV-ASSESSMENT-REVIEW` (registered in `infra/scheduled-job-registry.yaml`); missing the monthly review is a Warn finding under §8.4.

---

# **§11 — Unified Non-Tutor On-Call Rotation (Q-06C-2 \= a)**

## **11.1 Locked V1 model**

A single non-tutor on-call rotation covers every alert routed to `06c_non_tutor_unified` (per §7.2 rule 4). Tutor-class alerts route to Doc 03 Main §21.3 (canonical, unchanged — 06C does not modify §21.3's scope, cadence, or escalation).

| Role | V1 occupants | Schedule shape |
| ----- | ----- | ----- |
| Primary | Founder OR ops-lead (alternating week) | Weekly handoff; documented in `infra/oncall-rotation-registry.yaml` |
| Secondary | The other of founder / ops-lead | Same week; covers when primary unreachable |
| Backup | Designated backup operator | On-call beyond secondary's window |

The "alternating week" cadence is a V1 default; the rotation registry's `infra/oncall-rotation-registry.yaml` is the canonical source of truth.

## **11.2 Rotation registry — `infra/oncall-rotation-registry.yaml`**

rotations:  
  \- rotation\_id: 06c\_non\_tutor\_unified  
    description: 'Unified non-tutor on-call rotation per Doc 06C §11'  
    cadence\_shape: weekly\_alternating                   \# V1 default; configurable  
    roles:  
      \- role: primary  
        schedule:                                       \# explicit per-week assignment  
          \- { week\_start: \<iso8601\>, user\_id: \<uuid\>, paging\_target: \<01A §18 routing destination\> }  
      \- role: secondary  
        schedule: \[...\]  
      \- role: backup  
        schedule: \[...\]  
    coverage\_window:                                    \# the calendar window the rotation must cover  
      start\_at: \<iso8601 — typically the start of V1 production operation\>  
      end\_at:   \<iso8601 — typically 1 year forward, rolling-extended quarterly\>  
    last\_reviewed\_at: \<iso8601\>

  \- rotation\_id: doc03\_main\_21\_3                        \# tutor-class queue; canonical owner Doc 03 Main §21.3  
    description: 'Referenced from Doc 03 Main §21.3 — 06C does not own; included here for §7 alert-registry routing lookup ONLY'  
    canonical\_owner: Doc 03 Main §21.3  
    \# No schedule body in 06C — Doc 03 Main §21.3 owns

## **11.3 Coverage rule**

For every minute in the `coverage_window`, exactly one `primary` user MUST be assigned to `06c_non_tutor_unified` (or to `doc03_main_21_3` per Doc 03 Main §21.3). A gap is a `DD-06-PROOF` defect.

## **11.4 Proving mechanism — `ci/oncall-rotation-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, on PRs touching `infra/oncall-rotation-registry.yaml`, plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/oncall-rotation-registry.yaml` \+ `infra/alert-registry.yaml` \+ **Doc 01 active-operator identity source** (the canonical eligibility set of operators with active admin/operator entitlement; read-only consumer of Doc 01's identity surface per V6 §3.1; V8 §44 support-mediated slice gated on FWD-06-02 for the support-class operators specifically) (RB-06C-V1-07) |
| Failure condition | (a) any minute in the coverage\_window with no `primary` assignment; (b) any alert in `infra/alert-registry.yaml` with `rotation_ref` not in `{06c_non_tutor_unified, doc03_main_21_3}`; (c) **any alert whose `tutor_class: true` field routes to `06c_non_tutor_unified`, or `tutor_class: false` routes to `doc03_main_21_3` (RB-06C-V1-13 — per-alert classification; not per-source-class)**; (d) coverage\_window `end_at` within 30 days (rotation registry must be rolling-extended quarterly); (e) **any scheduled `primary`, `secondary`, or `backup` `user_id` that does not resolve to an active eligible operator in the Doc 01 identity source — Page-severity (RB-06C-V1-07)**; identity check is point-in-time per the schedule entry's `week_start` |
| Proof artifact | `oncall-rotation-parity` record per Parent §10.5 \+ extras (§14): `rotations_checked[]`, per-rotation `{rotation_id, coverage_window_check, gaps_found[], alerts_routed_to_this_rotation_count, misroute_findings[], identity_resolution_check: {scheduled_user_ids_total, active_eligible_count, unresolved_user_ids[]}}` |
| Owner / paging | Founder \+ ops-lead; PR-blocking |

**Note on tutor-class classification (RB-06C-V1-13):** the per-source-class routing rule from the prior draft (blanket `doc03c_failure_class → doc03_main_21_3`) was wrong — Doc 03C's §28.6 (deployment \+ infra failures) and §28.8 (config failures) describe operational platform incidents that need platform-on-call competence, not the §21.3 safety-review queue (which exists for content/safety/anti-leak workflows with 48h→24h SLA). Routing is now per-alert via the `tutor_class: bool` field on each `alert-registry.yaml` entry. Default classification at registry-time:

| 03C source range | Default `tutor_class` |
| ----- | ----- |
| §28.1 (turn-path), §28.2 (Vertex), §28.3 (cache), §28.4 (candidate), §28.5 (async), §28.7 (privacy/anti-leak) | `true` → `doc03_main_21_3` |
| §28.6 (deployment \+ infra) | `false` → `06c_non_tutor_unified` |
| §28.8 (config) | `false` → `06c_non_tutor_unified` (configuration failures are platform-operational by default; a specific safety-critical config alert MAY override to `true`) |

The `ci/alert-runbook-parity` gate (§7.3) verifies each alert's `tutor_class` is set explicitly (no default-from-source-class), and the §11.4 gate above verifies routing matches the classification.

## **11.5 Boundary with Doc 03 Main §21.3**

§21.3 governs the tutor-class queue's roster, escalation, and 48h→24h SLA. 06C does not modify any of those. The `doc03_main_21_3` rotation entry in 06C's registry is a *routing pointer* — it identifies where tutor-class alerts go, not what they do once there. Any 06C change to §21.3's substantive content is a `DD-06-REDEF` defect.

---

# **§12 — Status-Page Operational Shape**

## **12.1 Scope**

Customer-facing status communication during incidents. 06C owns the operational shape (when to post, what to post, when to update, when to close out); the V1 status-page substrate itself is a Tier-2 platform decision (candidates: Statuspage.io, a self-hosted page on Cloudflare Pages, a Notion/GitHub-Pages static surface) and is recorded as W2 in §17.

## **12.2 Operational rule**

For every incident with `severity = 'Page'` AND `user_facing_impact = true` (the boolean column on `incidents` per §10.2; set at declaration from the triggering alert's `user_facing_impact` flag, OR explicit operator assertion):

1. **Within 15 minutes of `declared_at`:** post an "investigating" status update to the status-page surface.  
2. **At every phase transition** (declared → investigating → mitigating → resolved): update the status-page.  
3. **At `resolved`:** post the resolution and link to the eventual postmortem path (the page may carry "postmortem pending" until the document commits, after which the link is updated).

The 15-minute rule is the 06C-owned bound. Non-user-facing incidents (Page-severity but no customer impact — e.g. internal infrastructure that doesn't touch users) do not require status-page posts; the incident lifecycle (§10) still applies.

## **12.3 Status-page state model**

status\_page\_states := { operational | degraded | partial\_outage | major\_outage | maintenance }

These names are the operational vocabulary; the V1 substrate's native vocabulary may differ and is mapped on entry via `infra/status-page-state-mapping.yaml`.

### **12.3.1 Required mapping schema (RB-06C-V1-14)**

The `infra/status-page-state-mapping.yaml` file, when populated post-W2, MUST contain the following minimum fields per state:

substrate: \<statuspage\_io | cloudflare\_pages | self\_hosted | other\>  
state\_mapping:  
  \- canonical\_state: \<operational | degraded | partial\_outage | major\_outage | maintenance\>  
    substrate\_native\_state: \<substrate's native string for this state\>  
    impact\_severity\_trigger:                       \# which incident shapes map to this canonical state  
      min\_user\_facing\_impact\_scope: \<single\_feature | feature\_family | platform\_wide | maintenance\>  
      severity\_floor: \<Page | Warn\>  
    operator\_override\_allowed: \<true | false\>      \# whether ops can post a state without an open incident

Each canonical state MUST have exactly one mapping row. A mapping file with duplicate `canonical_state` entries, missing states, or no `impact_severity_trigger` definition fails `ops/status-page-conformance` (see §12.4 failure condition (e)).

## **12.4 Proving mechanism — `ops/status-page-conformance` (Parent §6.13)**

**Partial-provability (RB-06C-V1-06):** until W2 closes (the status-page substrate is selected) AND `infra/status-page-state-mapping.yaml` is populated per §12.3.1, this mechanism is **specified but not enforceable** per Parent §6.13. Page-severity user-facing incidents still require manual status updates during this window (the §12.2 operational rule applies, manually); API-backed conformance proof cannot be produced until the substrate binding lands. The §16 audit reports the partial-provable status, never silently passes the mechanism as deploy-proven.

| Element | Value |
| ----- | ----- |
| Execution location | Scheduled reconciliation job (Vercel Cron) — **enabled only when W2 has closed** |
| Trigger cadence | Every 15 minutes during active incidents; hourly otherwise |
| Input registry | `incidents` rows where `severity = 'Page'` AND `user_facing_impact = true` \+ `infra/status-page-state-mapping.yaml` (§12.3.1) \+ the status-page substrate's current state (fetched via substrate API) \+ `incident_phase_transitions` per incident \+ status-page post history (fetched via substrate API) |
| Failure condition | (a) user-facing Page-severity incident with no status-page post within 15 minutes of `declared_at`; (b) an `incident_phase_transitions` row newer than the latest status-page update for that incident (phase moved but page not updated); (c) status-page state shows `operational` while an unresolved user-facing Page-severity incident exists; (d) status-page shows degraded/outage while no corresponding `incidents` row exists (status posted by mistake or out-of-band); (e) `infra/status-page-state-mapping.yaml` violates §12.3.1 schema (missing required field, duplicate canonical\_state, etc.) (RB-06C-V1-14) |
| Proof artifact | `status-page-conformance` record per Parent §10.5 \+ extras (§14): per-active-incident `{incident_id, status_page_first_post_lag_seconds, status_page_update_count, phase_to_post_alignment[]}` \+ `unattributed_status_page_states[]` \+ `mapping_schema_check` \+ `partial_provable_until_w2_closes: bool` |
| Owner / paging | Founder \+ ops-lead; per §11 unified rotation |

---

# **§13 — Observability Consumer Parity over 06B Privileged-Op Substrate**

## **13.1 Why this exists**

06B §8 establishes the privileged-op audit substrate and the §8.6 source registry that proves INV-06-07. INV-06-07 is satisfied *only* if the audit substrate is also *observed* — an audit row that nobody is paged on is unread. 06C is the consumer; this section closes the loop.

## **13.2 Required consumer surfaces**

For each substrate in 06B §8.6's `privileged_op_sources` (the eight V1 entries plus the V8 §44 reserved slot), 06C MUST have:

1. An alert-registry entry whose `source_class = 'doc06b_finding'` and `source_ref.section = '§8.4'` (the audit-coverage reconciliation result).  
2. A dashboard panel (06C-named, V1 substrate Tier-2-bound per W6) surfacing the substrate's `coverage_ratio`, `lag_observed_max_seconds`, and any open `finding`.  
3. The alert-registry runbook\_ref pointing at a runbook in `docs/runbooks/` that says (at minimum) how to investigate a coverage gap for that substrate, and the executable-proof acceptance criterion is "substrate's `coverage_ratio = 1.0` for two consecutive reconciliation runs after intervention."

## **13.3 Proving mechanism — `ops/observability-consumer-parity` (Parent §6.13)**

| Element | Value |
| ----- | ----- |
| Execution location | GitHub Actions, on PRs touching `infra/privileged-op-source-registry.yaml` (06B-owned) or `infra/alert-registry.yaml` (06C-owned), plus nightly |
| Trigger cadence | Per PR \+ nightly |
| Input registry | `infra/privileged-op-source-registry.yaml` (06B §8.6 — read-only consumer) \+ `infra/alert-registry.yaml` (06C §7) \+ the dashboard configuration manifest `infra/observability-dashboards.yaml` (06C-owned schema; substrate body Tier-2 per W6) |
| Failure condition | (a) any 06B §8.6 substrate without a corresponding alert-registry entry (`source_class = 'doc06b_finding'` \+ `source_ref` resolving to that substrate); (b) any such alert-registry entry with no runbook\_ref or an empty acceptance\_criterion; (c) any substrate without a dashboard panel mapping; (d) the V8 §44 slot specifically — partial-provable: registered as gated on FWD-06-02, reported as such (Warn-severity, not Page) |
| Proof artifact | `observability-consumer-parity` record per Parent §10.5 \+ extras (§14): per-substrate `{substrate_id, alert_registry_entry_found, runbook_resolved, dashboard_panel_mapped, fwd_gated: bool}` |
| Owner / paging | Platform/CTO; PR-blocking |

---

# **§14 — Per-Mechanism Envelope Extras (Parent §10.5.1 Extension)**

The Parent §10.5 envelope is canonical; this section extends the §10.5.1 per-mechanism extra-field matrix with 06C's mechanisms.

| Mechanism | Required extra fields |
| ----- | ----- |
| `ci/composite-slo-registry-parity` (§5.5) | `composite_slos_checked[]`, per-row `{composite_slo_id, owning_doc, primitive_refs_resolved[], lisa_sli_refs_resolved[], decomposition_check, alert_link_check, decision}` |
| `ci/alert-runbook-parity` (§7.3) | `alerts_checked[]`, per-alert `{alert_id, source_class, source_ref_resolved, severity_crosswalk_check, runbook_resolved, rotation_check, last_reviewed_age_days, decision}` |
| `ci/severity-crosswalk-parity` (§7.5) | `yaml_rows_parsed[]` (canonical), `markdown_rows_rendered[]` (rendering), `rendering_mismatches[]`, `orphan_markdown_rows[]`, `alert_registry_lookup_failures[]` |
| `ci/scheduled-job-registry-parity` (§8.6) | `jobs_checked[]`, per-job `{job_id, alert_link_check, canonical_owner_check, gap_to_cadence_ratio, exception_present, substrate_check, watchdog_check, decision}` |
| `ops/scheduled-job-heartbeat-conformance` (§8.4) | `jobs_checked[]`, per-job `{job_id, last_observed_heartbeat_at, gap_seconds, expected_max_gap_seconds, latest_outcome, status}`, `unregistered_heartbeats[]`, `rpc_rejection_count` (heartbeat-RPC `JOB_ID_NOT_REGISTERED` outcomes, RB-06C-V1-08) |
| `ops/synthetic-probe-conformance` (§9.4) | `probes_run[]`, per-probe `{probe_id, egress_ip_observed, cf_access_policy_hash, github_meta_fetch_result, metadata_source, metadata_snapshot_age_seconds, github_ip_range_overlap_check: {overlap_count, overlapping_ranges[], decision}, target_results[]: {route, expected_outcome_class, observed_outcome_class, hmac_legit_path_check}}` |
| `ops/incident-lifecycle-conformance` (§10.4) | `incidents_checked[]`, per-incident `{incident_id, severity, current_phase, phase_durations, commander_assignment_lag_seconds, postmortem_path, postmortem_file_exists, postmortem_path_format_check, open_overdue_action_items[]}` |
| `ci/oncall-rotation-parity` (§11.4) | `rotations_checked[]`, per-rotation `{rotation_id, coverage_window_check, gaps_found[], alerts_routed_to_this_rotation_count, misroute_findings[], identity_resolution_check: {scheduled_user_ids_total, active_eligible_count, unresolved_user_ids[]}}` |
| `ops/status-page-conformance` (§12.4) | per-active-incident `{incident_id, status_page_first_post_lag_seconds, status_page_update_count, phase_to_post_alignment[]}`, `unattributed_status_page_states[]`, `mapping_schema_check`, `partial_provable_until_w2_closes` |
| `ops/observability-consumer-parity` (§13.3) | per-substrate `{substrate_id, alert_registry_entry_found, runbook_resolved, dashboard_panel_mapped, fwd_gated}` |

---

# **§15 — Cross-Document Seam Table (Grounded by Exact §)**

| Seam | 06C side | Canonical owner \+ exact § | Reconciliation status |
| ----- | ----- | ----- | ----- |
| Logger interface | §4, §5 (used by every metric/alert mechanism) | 01A §11 | RESOLVED — referenced |
| Correlation IDs | §10 (incident records carry `request_id` from the triggering alert) | 01A §12, §17 | RESOLVED |
| Log levels | §4, §6 | 01A §13 | RESOLVED |
| PII redaction | §10 (incident records, postmortems) | 01A §14 | RESOLVED |
| Metrics emission \+ percentile conventions | §5, §6 | 01A §15, §16 | RESOLVED |
| Alert routing tiers (Page / Warn / Info / Debug body) | §4, §6.1.1 | 01A §18 | RESOLVED |
| Log sinks and retention | §10 (incident logs retained per §19) | 01A §19 | RESOLVED |
| Per-primitive SLO budgets | §5.2 `consumed_primitive_slos`, §6.1.4 | **01A §74A** | RESOLVED |
| Doc 03 §26.A 13-mode failure matrix | §6.1.2 crosswalk | **Doc 03 Main §26.A** (cited per project handoff record; replaced with parsed index on Doc 03 Main upload — see §3.4) | RESOLVED (cite path noted) |
| Doc 03 §26.B SLA targets | §6 (referenced as background for severity binding) | **Doc 03 Main §26.B** (same cite path as §26.A) | RESOLVED |
| Doc 03 Main §21.3 safety-review queue | §7.2 rule 4, §11.5 | Doc 03 Main §21.3 | RESOLVED — canonical for tutor-class routing |
| Doc 03C §11.2 SLI catalog | §5.2 `consumed_lisa_slis`, §6.1.3 | **Doc 03C §11.2** | RESOLVED |
| Doc 03C §28.1–§28.8 failure matrix | §6.1.3 crosswalk | **Doc 03C §28.1–§28.8** | RESOLVED |
| Doc 03C §11.3 cost observability | §6 (cross-referenced) | Doc 03C §11.3 (06E joint) | RESOLVED — pass-through to 06E |
| 06A release-gate failures | §6.1.6 crosswalk | Doc 06A §10 | RESOLVED — consumer |
| 06A `infra/route-surface-classification.yaml` | §9.4 input | Doc 06A §5.3.1 (extended RB-06A-V1-11) | RESOLVED — consumer |
| 06B privileged-op audit substrate | §13 observability-consumer parity | Doc 06B §8 \+ §8.6 source registry | RESOLVED — consumer |
| 06B §8.3 relational `privileged_sessions` / `privileged_session_actions` | §10 incident actions during break-glass link via `incident_ref` | Doc 06B §8.3 | RESOLVED — consumer |
| 06B `ops/internal-endpoint-exposure-probe` HTTP-layer body | §9.5 — execution location only | Doc 06B §11.4 | RESOLVED — 06C provides only execution location \+ §9.2 mitigation |
| 06B §6 HMAC rotation operations | §7 alert-registry crosswalk row | Doc 06B §6.4 | RESOLVED |
| 06B §9 abuse-ops queue | §7 alert-registry — non-tutor abuse routes via 06B queue → 06C rotation per §11 | Doc 06B §9 | RESOLVED |
| Parent §13 severity model | §4, §6 (body of crosswalk) | Doc 06 Parent §13 | RESOLVED — 06C is the body |
| Parent §10.5 envelope | §14 \+ every proving mechanism | Doc 06 Parent §10.5 / 06A §10.5.1 / 06B §15 | RESOLVED — extended in §14 |
| Doc 01 V8 §44 support-mediated audit observability | §13.3 — partial-gated | **Doc 01 V8 §44 — FWD-06-02** | OPEN — bounded; substrate slot registered, surface partial-provable |
| Doc 07 analytics consumer | §13 future analytics consumer of observability surfaces | Doc 07 (not drafted) | OPEN — bounded FORWARD\_REF (Parent FWD-06-01) |
| Doc 06E vendor outage path (non-LISA) | §6 / §7 (non-LISA vendor outages route through alert-registry) | Doc 06E (pending; covers INV-06-12 joint with §13 of 06C) | OPEN — bounded; cross-references documented in §20 register on 06E lock |

---

# **§16 — Audit Profile**

Inherits Parent §17 six passes \+ the 06A-specific passes (03C-boundary, registry-schema-completeness) \+ the §10.5 envelope-conformance pass \+ the 06B-specific passes (primitive-body restatement detection, audit-substrate exhaustiveness). Plus three 06C-specific passes:

* **06C Pass 1 — Severity-crosswalk numeric-restatement detection:** any 06C line that states (rather than references by exact §) a numeric threshold from 01A §74A (P50/P95/P99/ms values), from 03C §11.2 (any `*_rate` / `*_latency_p95` numeric target), or from 03C §28 (per-row alert threshold strings) is a `DD-06-REDEF` defect. Highest-risk targets: §5 (consumed-budget restatement), §6 (severity crosswalk — names only, no numbers), §9 (synthetic-probe rules — names only).  
* **06C Pass 2 — Severity-vocabulary integrity:** any 06C alert-registry-related line that uses a severity vocabulary outside `{Page, Warn, Info, Debug}` (01A §18 canonical) or outside `{immediate, same_day, next_business_day}` (Parent §13 canonical) is a `DD-06-REDEF` defect — except in §6.1.2 / §6.1.3 / §6.1.5 / §6.1.6 / §6.1.7 explicit crosswalk tables where the source-vocabulary appears alongside the canonical mapping (the audit's known false-positive class).  
* **06C Pass 3 — Citation-parity:** every cited section (§X) MUST resolve to an actual section anchor in the source doc. The audit script parses each cited doc's `^#+ §X` anchor index and verifies citation parity. Anchors not parseable (Doc 03 Main not in source tree) are recorded as `cited_per_project_handoff_record` per §3.4 and reported in the audit summary, never silently passed.

Known false-positive class: doc titles containing flagged words; phase / state vocabulary that overlaps with severity (`declared` / `resolved`); `operational_response_urgency` enum values in tables; the §6.1 crosswalk tables themselves (they intentionally show both source and canonical vocabularies side-by-side); the §15 seam table (cites bodies — required, not restatement); the `incidents` schema's `severity` CHECK constraint values (intentional restatement at schema level).

---

# **§17 — Open Items & Watch List**

| ID | Item | Status / handling |
| ----- | ----- | ----- |
| **W1** | Doc 01 V8 §44 support-mediated audit observability surface (FWD-06-02) | Bounded; §13.3 substrate slot reserved; alert-registry entry partial-provable (Warn-severity until V8 lands). Non-blocking. |
| **W2** | Status-page substrate selection (§12 V1 substrate Tier-2 decision) | The operational shape is locked (§12.2). The substrate (Statuspage.io vs Cloudflare Pages vs self-hosted) is a Tier-2 platform binding. `ops/status-page-conformance` is **partial-provable until W2 closes** AND `infra/status-page-state-mapping.yaml` is populated per §12.3.1 (RB-06C-V1-06); meanwhile §12.2 operational rule applies manually. Non-blocking for spec-lock. |
| **W3** | Doc 03 Main not in source tree at draft time (§3.4) | Citations to §26.A / §26.B / §21.3 made per project handoff record; replaced with parsed index when Doc 03 Main lands. Audit Pass 3 reports cite-path; non-blocking. |
| **W4** | Second-substrate synthetic probe (V1.1 hook from §9.2) | V1 ships with GitHub Actions hosted runner \+ the §9.2 CF Access policy GitHub-IP overlap check. V1.1 hook: add a second-substrate probe (Cloudflare Workers or dedicated VM) so the two probes cross-validate. Registered, non-blocking for V1. |
| **W5** | Worker-host platform binding (propagated from 06A §18.1 / 06B §17 W2) | Inherited; 06C's `infra/scheduled-job-registry.yaml` `execution_substrate` field accepts the placeholder until 06E confirms. Non-blocking. |
| **W6** | Dashboard substrate body (§13.3 — V1 substrate Tier-2) | The `infra/observability-dashboards.yaml` panel-to-substrate mapping is 06C-owned (the schema); the substrate binding (Sentry dashboards / Vercel Analytics / Datadog if adopted) is Tier-2. Non-blocking. |
| **W7** | Doc 06E vendor outage path (non-LISA) (INV-06-12 joint) | 06C owns the alert-registry shape; 06E will populate the non-LISA-vendor rows on 06E lock. 06C's §15 seam table flags this; cross-references will be added in a CR-06C post-lock additive when 06E lands. Non-blocking. |

None of W1–W7 block 06C spec-lock.

---

# **§18 — Acceptance Criteria (Executable-Proof Framed)**

Per the Doc 06A §19 / 06B §18 split (A/B/C) — 06C-owned criteria, cross-doc gate-presence criteria, audit closure.

## **A — 06C-owned criteria**

1. `ci/composite-slo-registry-parity` fails on any composite SLO whose `consumed_primitive_slos[].operation` does not match an 01A §74A row by exact string; any `consumed_lisa_slis[].sli_name` not in 03C §11.2; **at any populated percentile in `{p50, p95, p99}`** the composite target is tighter than the sum of consumed budgets \+ `application_layer_overhead_budget_ms[percentile]` (RB-06C-V1-02); any orphan composite without an alert\_id; any composite SLO ID without a doc prefix (§5.5).  
2. `ci/alert-runbook-parity` fails on any alert without a canonical-owner-resolving `source_ref`; any severity not derived through the canonical YAML severity-crosswalk registry per §6.0 (RB-06C-V1-03); any Page-severity row without `runbook_ref` \+ `acceptance_criterion`; any `tutor_class: true` alert routed to `06c_non_tutor_unified` (or `tutor_class: false` to `doc03_main_21_3`) (RB-06C-V1-13); any `last_reviewed_at` older than 180 days (§7.3).  
3. `ci/severity-crosswalk-parity` enforces the §6.0 canonical direction: YAML registry is authoritative; any rendered §6.1 row absent from the YAML registry, any YAML row whose rendering diverges, any alert-registry row whose severity does not resolve through the YAML registry, any orphan rendered row (RB-06C-V1-03; §7.5).  
4. `ci/scheduled-job-registry-parity` fails on any `failure_alert_id` not resolving in the alert-registry; any `canonical_owner_doc_and_section` not resolving; any `expected_max_gap_seconds` outside the \[2× cadence, 24× cadence\] band UNLESS the entry carries an `expected_max_gap_seconds_exception` block with justification \+ approver \+ approved\_at (RB-06C-V1-12); any `execution_substrate` not in the §18 V1 environment matrix; the monitor job (`JOB-OBS-HEARTBEAT-CONFORMANCE`) absent from the registry or missing its `external_watchdog` block (RB-06C-V1-01); §8.6.  
5. `ops/scheduled-job-heartbeat-conformance` fails on any registered `job_id` with no heartbeat row in the past 24h; any `(now - last_observed_heartbeat) > expected_max_gap_seconds`; two consecutive failure outcomes; any `scheduled_job_heartbeats` row with no matching registry entry. Heartbeat inserts that do not go through `record_scheduled_job_heartbeat()` are forbidden by the §11.2 single-writer discipline and surface as a `JOB_ID_NOT_REGISTERED` exception at write time (RB-06C-V1-08); §8.4.  
6. `ops/synthetic-probe-conformance` fails on any target route whose observed outcome class does not match `expected_outcome_class`; any overlap between CF Access policy `include` IP-ranges and GitHub's `actions` IP-ranges (Page-severity per §9.2 hard rule); probe self-failure; authenticated staging HMAC request from registered service pair failing to reach the application; **GitHub-meta fetch failure with snapshot age \> 30 days (Page) or 7–30 days (Warn) — silent pass on metadata-fetch failure is forbidden (RB-06C-V1-09)**; §9.4.  
7. `ops/incident-lifecycle-conformance` fails on any Page-severity incident with no commander assigned within 5 minutes; any Page-severity incident in `resolved` for \>5 business days without a `postmortem_path` resolving to a real file (file path is also CHECK-constrained to `^docs/postmortems/INC-[0-9]{8}-[0-9]{2}\.md$` at schema level — RB-06C-V1-05); any phase-skip in `incident_phase_transitions`; any open `incident_action_items` past `due_at`. Phase transitions are restricted to `transition_incident_phase()` RPC at write-time (RB-06C-V1-04); Warn-severity incident timing follows §10.3.2 (RB-06C-V1-10); §10.4.  
8. `ci/oncall-rotation-parity` fails on any minute in `coverage_window` with no primary assignment; any alert with `rotation_ref` outside `{06c_non_tutor_unified, doc03_main_21_3}`; any `tutor_class: true` / non-tutor cross-routing or `tutor_class: false` / tutor cross-routing (RB-06C-V1-13); `coverage_window.end_at` within 30 days; **any scheduled user\_id not resolving to an active eligible operator in Doc 01's identity source (RB-06C-V1-07)**; §11.4.  
9. `ops/status-page-conformance` (partial-provable until W2 closes per RB-06C-V1-06) fails on any user-facing Page-severity incident with no status-page post within 15 minutes; any `incident_phase_transitions` row newer than the latest status-page update for that incident; status-page `operational` while an unresolved user-facing Page-severity incident exists; status-page state without a matching incident; `infra/status-page-state-mapping.yaml` violating §12.3.1 schema (RB-06C-V1-14); §12.4.  
10. `ops/observability-consumer-parity` fails on any 06B §8.6 substrate without a corresponding alert-registry entry; any such entry with no runbook\_ref or empty acceptance\_criterion; any substrate without a dashboard panel mapping; the V8 §44 slot is reported as partial-provable (FWD-06-02), Warn-severity, not Page (§13.3).  
11. Every 06C proof artifact conforms to Parent §10.5 envelope \+ the §14 per-mechanism extras; an artifact missing any common-envelope field or its mechanism-specific extras is a `DD-06-PROOF` defect.

## **B — Cross-doc gate-body criteria (06C's slice only)**

12. **INV-06-04 (scheduled-job monitoring):** `ops/scheduled-job-heartbeat-conformance` (§8.4) is the body; `infra/scheduled-job-registry.yaml` is the canonical inventory; partial-provability noted (§8.5) until every platform scheduled job is registered.  
13. **INV-06-10 (alert+runbook+owner):** `ci/alert-runbook-parity` (§7.3) is the body; `infra/alert-registry.yaml` is the canonical inventory; the severity model is enforced by `ci/severity-crosswalk-parity` (§7.5) against `infra/severity-crosswalk-registry.yaml`.  
14. **INV-06-12 (vendor outage paths):** 06C provides the alert-registry shape for vendor outages; LISA-tier rows already canonical in Doc 03C §28; non-LISA-tier rows are joint with Doc 06E (W7); the body is split per Parent §13.

## **C — Audit closure**

15. The §16 audit reports zero `DD-06-PROOF`, `DD-06-REDEF`, `DD-06-SEAM`, `DD-06-FWD` defects; zero 03C-boundary violations; zero §10.5 envelope-conformance violations; zero severity-crosswalk numeric-restatement defects (Pass 1); zero severity-vocabulary-integrity violations (Pass 2); citation-parity (Pass 3\) reports either resolved-anchor or `cited_per_project_handoff_record` for every cross-doc citation.

Per Parent §6.13, each mechanism above is **specified, not deploy-proven**, until its owning artifact (CI job / scheduled job / manifest / registry) supplies all six §6.13 elements.

---

# **§19 — Drafting & Lock Conventions**

Inherits Parent §8 verbatim: tool-neutral workflow (primary drafting agent → independent SWE review → in-lock-cycle `RB-06C-V1-NN` cleanup → audit); `.bak` / `.bak2` before each pass; draft-for-lock cleanup keeps `DRAFT` and transitions once to `LOCKED` on clean re-audit; post-lock in-lock-cycle cleanup keeps `LOCKED`, version and lock date unchanged.

---

# **§20 — Change Records**

**CR-06C-01** — Doc 06C V1.0 established. Scope: composite SLO contract shape \+ registry mechanism (Q-06C-3=b — values feature-doc-owned, not 06C-owned); Parent §13 severity crosswalk body (four-vocabulary unification — 01A §18 / Doc 03 §26.A / 03C §28 / 06A-06B findings — no body restatement); `infra/alert-registry.yaml` with `ci/alert-runbook-parity` proving INV-06-10; `infra/severity-crosswalk-registry.yaml` machine-readable encoding of §6.1 with `ci/severity-crosswalk-parity`; `infra/scheduled-job-registry.yaml` \+ relational `scheduled_job_heartbeats` substrate with both `ci/scheduled-job-registry-parity` and `ops/scheduled-job-heartbeat-conformance` proving INV-06-04; synthetic-probe execution location bound to GitHub Actions hosted runner (Q-06C-1=a) with §9.2 CF Access GitHub-IP-range overlap hard rule; incident-response lifecycle with relational `incidents` \+ `incident_phase_transitions` \+ `incident_action_items` substrate; unified non-tutor on-call rotation (Q-06C-2=a) \+ `ci/oncall-rotation-parity`; status-page operational shape \+ `ops/status-page-conformance`; observability-consumer parity over 06B §8.6 privileged-op source registry. Two Parent invariants owned outright (INV-06-04, INV-06-10); INV-06-12 non-LISA portion joint with Doc 06E.

**CR-06C-02** — Pre-draft alignment: 01A §10–§19.1 / §74A / §18 anchors pinned by exact §; Doc 03 Main §26.A / §26.B / §21.3 cited per project handoff record (W3, §3.4 — Doc 03 Main not in current source tree); Doc 03C §11.2 SLI catalog and §28.1–§28.8 failure matrix referenced canonical. Doc 06A `infra/route-surface-classification.yaml` (extended per RB-06A-V1-11) consumed as the route inventory for §9. Doc 06B §8 privileged-op audit substrate \+ §8.6 source registry consumed for §13. All primitive bodies remain canonical-owned; 06C is operational-wrapper-and-crosswalk only.

**CR-06C-03** — Pre-draft Q\&A locked: Q-06C-1 \= (a) GitHub Actions hosted runner for synthetic-probe execution location, with §9.2 CF Access GitHub-IP-range overlap hard rule (structural CF policy parse \+ GitHub `actions` IP-range fetch) as the whitelist-masking mitigation; Q-06C-2 \= (a) one unified non-tutor on-call rotation (founder \+ ops-lead \+ backup, alternating-week V1 default); Q-06C-3 \= (b) 06C owns the composite SLO contract shape \+ registry mechanism; per-path values are feature-doc-owned (Doc 02B for practice/exam, Doc 03B for tutor, Doc 04B for scoring transaction, etc.); 06C does NOT define a V1 set of composite SLO values.

**CR-06C-04** — Draft-for-lock cleanup round 1 (external SWE review, 2026-05-21), RB-06C-V1-01..15 applied in-lock-cycle, **no version bump**, status transitioned `DRAFT` → `LOCKED`. 3 blockers (01: external-watchdog requirement on the heartbeat-conformance monitor job — §8.7 \+ monitor self-registration \+ substrate-class-diversity check; 02: composite SLO decomposition extended to all populated percentiles p50/p95/p99 not just p95 — §5.3/§5.5/§14; 03: severity-crosswalk YAML registry inverted to canonical source — §6.0 hard rule \+ §7.5 mechanism reversed, markdown is the rendering not the control input). 7 highs (04: phase-transition RPC `transition_incident_phase()` with legal-transition table; 05: postmortem\_path schema CHECK constraint regex; 06: status-page conformance marked partial-provable until W2 closes; 07: oncall identity-source resolution against Doc 01; 08: heartbeat insert via validated `record_scheduled_job_heartbeat()` RPC; 09: GitHub-meta fetch failure semantics — fallback snapshot \+ inconclusive result \+ age-based escalation; 10: Warn-severity incident declaration rule \+ relaxed timing \+ optional postmortem). 5 mediums (11: data\_impact enum alignment with 06A's `none|additive_only|transforms_data|deletes_data`; 12: long-cadence exception block for the 2×/24× band rule; 13: `tutor_class: bool` per-alert routing replacing per-source-class blanket routing — default classification table for 03C §28 ranges; 14: status-page state-mapping required-schema fields; 15: severity-assessment feedback owner Platform/CTO \+ monthly cadence \+ `JOB-OBS-SEV-ASSESSMENT-REVIEW` audit-trail). Cross-doc: no propagation needed (no 06A/06B/01A/03/03C bodies altered — only references reorganized; 06B §13 runbook stale-name fix already applied via CR-06B-05/RB-06B-V1-13). Re-audit clean across all 12 §16 passes; zero `DD-06-*` defects; zero 03C-boundary violations; zero envelope-conformance violations; zero severity-vocabulary-integrity leaks; zero citation-parity unresolveds.

---

# **§21 — Cleanup Register (RB-06C-V1-NN)**

Populated by the draft-for-lock cleanup pass (external SWE review round 1, 2026-05-21). All items applied in-lock-cycle; status transitioned `DRAFT` → `LOCKED` on clean re-audit per §19.

| Tag | Severity | Source | Resolution |
| ----- | ----- | ----- | ----- |
| RB-06C-V1-01 | BLOCKER | SWE B1 | §8.7 added: external-watchdog requirement for the `JOB-OBS-HEARTBEAT-CONFORMANCE` monitor job. The monitor is itself registered in `infra/scheduled-job-registry.yaml`; an `external_watchdog` block with `substrate: github_actions_cron` (different substrate class from the monitor's own `vercel_cron`) provides the second-tier signal. Substrate-class diversity enforced by §8.6 parity. Closes the self-monitoring blind spot — substrate-class failure of Vercel Cron cannot silently take down INV-06-04. |
| RB-06C-V1-02 | BLOCKER | SWE B2 | §5.3 rule 3 \+ §5.5 failure condition (c) \+ §14 envelope extras extended to all populated percentiles in `{p50, p95, p99}`. Composite SLO decomposition check no longer evaluates p95 alone — every percentile carried in the schema is checked at parity time, with `not_applicable` for unpopulated percentiles. Closes the p50/p99 correctness gap. |
| RB-06C-V1-03 | BLOCKER | SWE B3 | §6.0 added: `infra/severity-crosswalk-registry.yaml` is canonical machine-readable source; §6.1 tables are the human-readable rendering. §7.5 mechanism inverted: parity verifies rendering against registry (not the reverse); production gates consult the YAML registry, never the markdown. Hard rule established for 06C and forward: markdown parsing MAY NOT be a production-control input. |
| RB-06C-V1-04 | HIGH | SWE H1 | §10.2.1 added: phase transitions MUST go through `transition_incident_phase()` RPC. Reads `current_phase` `FOR UPDATE`, validates legal-transition table (5 legal pairs only, no reverse, no skip, postmortem terminal), updates `current_phase` and inserts `incident_phase_transitions` in same transaction, validates phase-specific pre-conditions. Direct UPDATE forbidden; §10.4 reconciliation remains defense in depth. |
| RB-06C-V1-05 | HIGH | SWE H2 | §10.2 `incidents` schema: added `CHECK (postmortem_path IS NULL OR postmortem_path ~ '^docs/postmortems/INC-[0-9]{8}-[0-9]{2}\.md$')` constraining postmortem file paths to the canonical location. Prevents path-shape drift and out-of-directory commits at schema level. |
| RB-06C-V1-06 | HIGH | SWE H3 | §12.4 marked **partial-provable until W2 closes** AND `infra/status-page-state-mapping.yaml` is populated per §12.3.1. Aligns with Parent §6.13 partial-provability discipline. §12.2 operational rule applies manually during the window. W2 watch-list entry updated. |
| RB-06C-V1-07 | HIGH | SWE H4 | §11.4 `ci/oncall-rotation-parity` extended: scheduled `user_id` values MUST resolve to active eligible operators in Doc 01's identity source. New failure condition (e); new proof extras `identity_resolution_check`. V8 §44 support-class operators gated on FWD-06-02 specifically. |
| RB-06C-V1-08 | HIGH | SWE H5 | §8.8 added: heartbeat inserts MUST go through `record_scheduled_job_heartbeat()` RPC. RPC validates `p_job_id` against the registry snapshot and rejects with `JOB_ID_NOT_REGISTERED`; direct INSERT forbidden by §11.2 single-writer discipline. Closes the typo-becomes-unregistered-heartbeat ambiguity. |
| RB-06C-V1-09 | HIGH | SWE H6 | §9.4 GitHub-meta fetch failure semantics specified: live fetch fail → fall back to `infra/github-meta-snapshot.json` snapshot; result is `inconclusive` (not pass) for the GitHub-overlap sub-check; snapshot age 7–30 days → Warn; \> 30 days → Page. Silent pass on metadata-fetch failure explicitly forbidden. |
| RB-06C-V1-10 | HIGH | SWE H7 | §10.3.2 added: Warn-severity incident declaration rule. Warn alerts NOT auto-incidents; explicit operator promotion via `declare_incident(severity='Warn', ...)`. Promoted Warn incidents follow same lifecycle with relaxed timing per the underlying alert's `operational_response_urgency`; postmortem OPTIONAL for Warn. Reconciliation distinguishes by severity. |
| RB-06C-V1-11 | MEDIUM | SWE M1 | §6.1.6 migration row updated: `data_impact: yes` → `data_impact ∈ {transforms_data, deletes_data}` matching 06A §11.3's RB-06A-V1-06 enum (\`none |
| RB-06C-V1-12 | MEDIUM | SWE M2 | §8.6 expanded: `expected_max_gap_seconds` outside \[2× cadence, 24× cadence\] band requires an `expected_max_gap_seconds_exception` block with `justification`, `approver_role`, `approved_at`. Closes the false-positive on monthly/quarterly jobs while preventing silent escape — exceptions are auditable. |
| RB-06C-V1-13 | MEDIUM | SWE M3 | §11.4 tutor-class routing inverted: not per-source-class, per-alert via `tutor_class: bool` field on `alert-registry.yaml`. Default classification table for Doc 03C §28 ranges: §28.1/§28.2/§28.3/§28.4/§28.5/§28.7 → `tutor_class: true`; §28.6 (deployment/infra) and §28.8 (config) → `tutor_class: false` (platform on-call). Each row's classification explicit, no default-from-source-class. |
| RB-06C-V1-14 | MEDIUM | SWE M4 | §12.3.1 added: required schema for `infra/status-page-state-mapping.yaml` — per-canonical-state row with `substrate_native_state`, `impact_severity_trigger.min_user_facing_impact_scope`, `severity_floor`, `operator_override_allowed`. Exactly one mapping per canonical state. §12.4 failure condition (e) enforces. |
| RB-06C-V1-15 | MEDIUM | SWE M5 | §10.5.1 added: severity-assessment feedback ownership (Platform/CTO), cadence (monthly review of prior-month postmortems), output (PRs against `infra/alert-registry.yaml` \+ `infra/severity-crosswalk-registry.yaml` when ≥2 postmortems in 90 days agree on mis-severity), audit trail via `JOB-OBS-SEV-ASSESSMENT-REVIEW` heartbeat. Closes the feedback loop. |

**Convention:** `.bak` / `.bak2` before each pass; resolved items tagged `RB-06C-V1-NN`; a §20 change-record row appended per pass; draft-for-lock pass transitions status `DRAFT` → `LOCKED`; post-lock passes leave status / version / lock-date unchanged (Parent §8).

---

# **§22 — Closing**

06C is the platform's operational-attention layer. It exists because the primitive observability (01A §10–§19.1) and the LISA observability (Doc 03 / 03C §11.2 / §28) need a unifying *attention substrate* — somewhere all the signals resolve into a small number of routable, actionable, owned alerts — and a unifying *lifecycle substrate* — somewhere incidents get declared, mitigated, and reviewed without improvisation. Neither replaces nor restates the canonical owners; both live under decision 5 by construction.

*End of Doc 06C V1.0 (LOCKED 2026-05-21). Next on lock: 06D (Data Protection, Backup/DR & Compliance Operations).*

