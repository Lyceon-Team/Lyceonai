# **Doc 03C — Operations Runbook V3**

**Version:** V3.0 **Status:** Draft for lock (companion to Doc 03C V3 spec \+ Doc 03C.1 Test Matrix V1.1; pending engineering review, ops review, and staging dry-run evidence per lock conditions) **Document family:** Doc 03C V3 (canonical-final spec) \+ Doc 03C.1 Test Matrix V1.1 (acceptance contract) \+ this Operations Runbook **Owners:** Lyceon Platform Operations (with Engineering joint review) **Last updated:** 2026-05-01 **Depends on:** Doc 03C V3; Doc 03C.1 Test Matrix V1.1; Doc 01A V1 (HMAC, observability, runtime config); Doc 00 (canonical platform invariants)

---

## **Naming clarification (carried from V2)**

This document is **Operations Runbook V3** — V3 of the runbook authored to close V2 review findings. It is NOT a V3 of Doc 03C the orchestrator service (which has been at V3 spec since the launch-trio finalization). The "V3 runbook trigger" originally referenced from V1 (a future incident-rich revision after launch experience accumulates) is now called **"V4 runbook trigger"** to avoid confusion with this V3.

| Term | Meaning |
| ----- | ----- |
| **Doc 03C V3** | Canonical-final orchestrator spec (shipped) |
| **Operations Runbook V3** | This document — V3 of operational procedures, closes V2 review findings |
| **V4 runbook trigger** | Future post-launch absorption-revision threshold (see end of document) |

---

## **Lock conditions (V3 — strengthened)**

1. Doc 03C V3 ship status \= APPROVED (canonical-final) — ✅ confirmed  
2. Doc 03C.1 Test Matrix V1.1 status \= Locked or Draft for lock — ✅ confirmed (Draft for lock)  
3. Engineering review of Part II deployment procedures \+ Part III day-2 procedures  
4. Ops review of Part IV incident response \+ Part V governance  
5. Repo path audit confirmation (per Test Matrix V1.1 §3.7)  
6. **All gcloud commands in §4, §5, §8, §13, §14, §17, §18 dry-run in staging; verification outputs captured in lock-evidence ticket** — including the verified `gcloud monitoring snoozes create/cancel` syntax in §17 (RB-V3-02)  
7. **All §3.10 launch-blocker values resolved and replaced** before production deploy  
8. Karl sign-off on V1 launch posture (streaming-disabled, single-region, business-hours coverage, 4-hour RTO)  
9. Karl sign-off on PII guard break-glass operational policy in §17  
10. **PagerDuty alert-policy resource names captured per §3.6** (RB-V3-11) — used by §17.4 snooze procedure

---

## **V3 scope statement**

V3 is the **production-ready Operations Runbook** companion to Doc 03C V3 spec and Test Matrix V1.1. V3 closes 13 review findings against V2 (6 BLOCKER, 4 ACCEPT non-blocking, 3 self-found additions surfaced during the V2 review normalization pass).

### **V3 closeout register (13 findings)**

* **RB-V3-01 — Pre-shift traffic state capture pattern.** V2's §4.9 rollback inferred "previous revision" via `gcloud run revisions list --sort-by='~metadata.creationTimestamp' | sed -n '2p'`, which is unsafe when test/break-glass/HMAC-rotation revisions exist. V3 introduces §4.0b: capture the full Cloud Run service traffic map as JSON immediately before every traffic shift; rollback restores from the captured map by revision name \+ percentage. Applied uniformly across §4, §8, §14, §17. This also addresses RB-V3-06 (JSON service-status fallback for brittle `--format` expressions).  
* **RB-V3-02 — Cloud Monitoring snooze CLI corrected.** V2 invented `gcloud alpha monitoring policies update --snooze-duration=4h --no-snooze`, which is not real CLI syntax. V3 replaces with verified `gcloud monitoring snoozes create --display-name --criteria-policies --start-time --end-time` (per Cloud Monitoring docs) and `gcloud monitoring snoozes cancel <full snooze name>` for early termination. The snooze takes alert policy by full resource name `projects/PROJECT/alertPolicies/POLICY_ID`; the cancel command takes the snooze's full name `projects/PROJECT/snoozes/SNOOZE_ID` returned at create time.  
* **RB-V3-03 — Break-glass canary ordering fixed.** V2 runbook §17.4 had contradictory ordering: preamble said "before shifting traffic, snooze the alert"; Step 4 said "confirm initial PagerDuty page is received before snoozing." V3 runbook §17.4 explicit linear ordering: (1) deploy break-glass revision at 0% traffic, (2) verify boot-time `pii_guard_break_glass_active_at_startup` log event, (3) verify initial PagerDuty page received from boot event, (4) acknowledge incident, (5) create bounded snooze on the per-turn disabled-mode alert ONLY (SEV-1 privacy bypass alerts remain active), (6) shift 5% traffic.  
* **RB-V3-04 — Hard preconditions before 100% PII break-glass rollout.** V2 runbook §17.5 required Karl approval \+ privacy-risk acceptance for 100% but didn't establish what evidence Karl is approving against. V3 runbook §17.5 adds 5 hard preconditions: (1) false-positive class affects broad share of legitimate traffic, (2) scoped pattern suppression unavailable as alternative, (3) rollback removes more safety than it restores, (4) Karl explicit privacy-risk acceptance recorded in incident ticket, (5) Engineering confirms matched values remain unlogged \+ SLIs still emit. V3 runbook §17.0 adds: "prefer targeted pattern fix, scoped suppression, or rollback over 100% break-glass" as general posture.  
* **RB-V3-05 — `/health` readiness-not-liveness explicit note.** V3 §28B.4 defines `/health` as a readiness gate (200 only when DB \+ Vertex \+ Secret Manager all reachable), but the naming choice is non-standard (Kubernetes convention uses `/healthz` for liveness \+ `/readyz` for readiness). V3 runbook adds a one-line operational note at every traffic-ramp gate clarifying the readiness semantic, preventing future operators from treating `/health` as a shallow liveness check.  
* **RB-V3-06 — JSON service-status fallback.** Folds into RB-V3-01 — the pre-shift traffic capture pattern produces full JSON output that serves as both the rollback source AND a verification fallback when filter expressions like `--format='value(status.traffic[?tag==...].url)'` fail or behave unexpectedly. V3 runbook §4.0b establishes the canonical "capture JSON; extract via jq if needed; record both" pattern.  
* **RB-V3-07 — HMAC rotation tag variable extracted.** V2 §14 used `$(date +%Y%m%d)` inside both shell and gcloud format expressions, leading to potential mismatch if the date crossed a UTC boundary mid-procedure. V3 extracts to `ROTATION_TAG="hmac-rotation-$(date -u +%Y%m%d)"` once at procedure start; all subsequent commands reference `${ROTATION_TAG}`. UTC pinned to avoid timezone drift across operator workstations.  
* **RB-V3-08 — Strengthened V3.x-spec language for `runtime_config_reloaded` log event.** V2 runbook §11.3 flagged the missing log event as a "V3.x consideration." V3 strengthens to "near-term V3.x requirement" in §11.3 with rationale: behavior-side verification is acceptable for draft but not robust for ops at scale. V3 runbook does NOT author the spec change itself; it raises the priority of the flag.  
* **RB-V3-09 — Cost budget routing language normalized.** V2 had inconsistency between §2.4 ("100% daily budget pages to Karl email") and §18.1 ("PAGE at 100% routes to Karl \+ Ops Slack; PagerDuty SEV-2 only if composite anomaly fires"). V3 unifies: 100% daily budget alone → Karl \+ Ops Slack (no PagerDuty); 100% daily budget \+ cost-runaway-with-anomaly composite policy fire → PagerDuty SEV-2. Applied consistently in §2.2, §2.4, §18.1.  
* **RB-V3-10 — IAM project-scope vs resource-scope wording fixed.** V2 runbook §5.7 said "expected output: exactly the 6 roles from §5.2" but V2 runbook §5.2 narrowed Cloud Tasks \+ Secret Manager to resource-scope; project IAM output won't list those. V3 runbook §5.7 separates: project-scoped IAM verification (4 roles) \+ resource-scoped IAM verification per queue \+ per secret (separate commands). Audit script in §5.8 updated accordingly.  
* **RB-V3-11 — PagerDuty alert-policy resource names captured at pre-launch.** V2 §17.4 snooze procedure assumed an alert policy ID was available at execution time but never specified where it comes from. V3 adds §3.6 checklist item: capture the full resource name `projects/PROJECT/alertPolicies/POLICY_ID` for the per-turn PII-disabled-mode alert policy in the lock-evidence ticket; §17.4 references the captured name.  
* **RB-V3-12 — Explicit 0% deploy step in break-glass canary procedure.** V2 runbook §17.4 implicitly required a 0% deploy before the 5% shift (so the boot-event PagerDuty page could fire without serving traffic), but didn't make it an explicit step. V3 runbook §17.4 makes the 0% deploy \+ verification its own numbered step before traffic shift. Aligns with the linear ordering fix in RB-V3-03.  
* **RB-V3-13 — Snooze name captured on create; referenced on cancel.** V2's snooze cancel command was vague about how to identify the right snooze. V3 runbook §17.4 captures the snooze's full resource name from the `gcloud monitoring snoozes create` response output and stores it for use in §17.8 cancel. Pattern: parse "Created snooze \[projects/...\]" line from create output.

### **V2 closeouts carried forward (unchanged in V3)**

V3 inherits all 23 V2 closeouts (RB-V2-01 through RB-V2-23). Where V3 changes touch a V2-touched section, both closeout IDs are referenced. Where V3 makes no change, V2's resolution stands.

### **What V3 deliberately does NOT do**

* **Does not author V3.x spec changes.** Three items remain flagged for spec consideration: runtime config validation function, `runtime_config_reloaded` log event, PII guard "monitor-only" mode. V3 runbook strengthens the language flagging these but does not introduce them as runbook procedures pending spec backing.  
* **Does not expand V1 incident response scope.** Q2 lock holds: V1 covers break-glass \+ Pro→Flash circuit breaker only. V4 runbook absorbs additional incident playbooks once production incidents accumulate.  
* **Does not resolve §3.10 launch-blocker values.** Vertex daily budget, Pro/Flash quotas, GCP project IDs, LISA team owner contact, and PagerDuty composite alert policy wiring remain organizational decisions captured in the lock-evidence ticket. The runbook's structure ensures procedures dependent on these values are gated on resolution.

---

## **V3 launch posture**

This runbook governs Doc 03C V3 production launch. Per Karl's Q1/Q2/Q3 calibration locks (carried from V1/V2):

* **Q1 (a):** Karl \+ engineering team; business-hours coverage; PagerDuty wired  
* **Q2 (c):** Minimal incident response — break-glass \+ Pro→Flash circuit breaker only at V1 launch; comprehensive incident playbook deferred to V4 runbook (post-launch incident absorption)  
* **Q3 (c):** Mix — technical defaults baked in (90-day log retention, 14-day HMAC overlap, 4-hour RTO, single region); organizational decisions flagged (on-call rotation depth, after-hours SLA, DR target evolution)

**V4 runbook trigger** (whichever first):

1. 30 days post-launch with stable sync-mode traffic AND streaming enablement is approved  
2. First production incident requiring runbook-authored procedure beyond §17/§18 V3 scope  
3. Multi-region expansion approved  
4. On-call rotation grows beyond engineering team  
5. Engineering ships bulk-memory-refresh prerequisite (per §13.1) — V4 absorbs the bulk procedure operationally

V3 is a **launch-readiness \+ day-2 procedures \+ minimal incident response framework**. It is NOT a battle-tested incident playbook. Real incident-specific procedures get authored as real incidents happen and are absorbed into V4.

---

## **Cross-document anchor map**

| Operational concern | Authoritative source | This runbook's role |
| ----- | ----- | ----- |
| Failure modes \+ alert thresholds | Doc 03C V3 §28 (including §28.7 \+ §28.8) | Reference \+ triage decision tree (§16) |
| SLI catalog | Doc 03C V3 §11.2 | Reference |
| Configuration keys \+ JSONB schema | Doc 03C V3 §30 \+ §31.5 | Reference \+ day-2 change procedure (§11) |
| Schema migrations DDL | Doc 03C V3 §29.1 \+ §29.2 | Reference; this runbook adds executable migration procedure (§4 \+ §6) |
| Test acceptance gates | Doc 03C.1 Test Matrix V1.1 §19 | Reference \+ pre-launch checklist enforcement (§3) |
| **Break-glass procedure** | Doc 03C V3 §30.7 \+ §30.7.1 | **Authoritative** — full operational detail in §17 of this runbook |
| **Deployment sequence executable form** | Doc 03C V3 §29.3 (table) | **Joint authoritative** — V3 spec defines sequence; §4 is the executable form |
| HMAC key rotation operational steps | Doc 01A V1 Part VII | **Authoritative for 03C** — operational steps in §14 |
| Cloud Run service spec | Doc 03C V3 §28B | Reference; §5 \+ §4 are the operational instantiation |
| **Health endpoint behavior** | Doc 03C V3 §28B.4 | Reference; §4 \+ §5 use `/health` as a **readiness gate** (DB \+ Vertex \+ Secret Manager dependency check), not liveness |
| PII guard pattern semantics | Doc 03C V3 §4.2.2 | Reference; §17 break-glass procedure references contextual matrix \+ matchAll behavior |

When V3 spec and this runbook drift on a procedural detail, file a discrepancy ticket per §23. **V3 spec wins for behavior contracts; this runbook wins for procedural details.**

---

# **Part I — Operational Readiness**

## **§1 Purpose \+ scope**

Doc 03C V3 is the orchestrator service that mediates between the LISA tutor API (Doc 03B) and Vertex AI Gemini. This runbook defines the operational procedures for deploying it, running it day-to-day, and handling the minimal set of V1-launch incident response scenarios.

The runbook is intended to be **executable**: a delegate operator with Cloud Run access and the listed credentials should be able to run the procedures here without consulting the spec body. Where commands are interim (e.g., GCP project IDs), they are clearly flagged in §3.10 launch-blocker checklist.

## **§2 V1 launch posture**

### **§2.1 Production architecture**

| Aspect | V1 launch value | Source |
| ----- | ----- | ----- |
| Region | us-central1 | V3 §2.2 |
| Streaming | Disabled (`vertex.streaming.enabled = false`) | V3 F-V3-17 \+ §30.1 |
| Cloud Run min instances (orchestrator) | 1 | V3 §28B.1 |
| Cloud Run max instances (orchestrator) | 50 | V3 §28B.1 |
| Cloud Run min instances (memory worker) | 0 | V3 §28B.1 |
| Cloud Run max instances (memory worker) | 20 | V3 §28B.1 |
| Cold start P99 target | \<3000ms (orchestrator); \<5000ms (memory worker) | V3 §28B.2 |
| HMAC key overlap window | 14 days | 01A §65 |
| Cloud Tasks queues | `lisa-compaction` (100 req/s), `lisa-memory-refresh` (50 req/s), `lisa-pending-reconciliation` (20 req/s) | V3 §VIII |
| Cloud Scheduler reconciliation cadence | Every 5 minutes | V3 §29.3 step 10 |

### **§2.2 Coverage posture (Q1 lock)**

**On-call:** Karl \+ engineering team. Business-hours coverage (defined as 9 AM – 6 PM Central Time, Monday–Friday). PagerDuty wired for SEV-2+ alerts.

**After-hours:** best-effort. SEV-2 pages route to PagerDuty oncall; if not acknowledged within 30 minutes, page escalates to Karl directly. No formal SLA for after-hours response.

**Alert routing (V3 — RB-V3-09 normalized):**

| Alert class | Channel | Response target |
| ----- | ----- | ----- |
| §28.1 turn-path PAGE | PagerDuty primary on-call | Acknowledge within 15 min business hours; 30 min after-hours |
| §28.2 Vertex SEV-2 | PagerDuty primary on-call | Same |
| §28.7 privacy/anti-leak (every PAGE entry) | PagerDuty privacy escalation channel | Acknowledge within 15 min any time |
| §28.8 configuration (every PAGE entry) | PagerDuty primary on-call | Same |
| Cost runaway (`vertex_cost_per_day` ≥ 80% of daily cap) | Email to Karl \+ Ops Slack channel | Within 1 business day; investigate context |
| **Cost runaway at 100% daily cap (alone, no anomaly)** | **Karl \+ Ops Slack channel** (no PagerDuty) | Karl decision: let breaker auto-recover at UTC midnight OR raise cap per §18.4 |
| **Cost runaway at 100% \+ composite anomaly fires** | **PagerDuty SEV-2** (via cost-runaway-with-anomaly composite policy) | Acknowledge within 30 min any time; treat as potential abuse or runaway loop |
| WARN-level alerts (any §28 section) | Ops Slack channel | Informational; no immediate action; investigate during business hours |

**Composite alert policy `cost-runaway-with-anomaly`:** Cloud Monitoring policy fires SEV-2 PagerDuty when ALL of: `vertex_cost_per_day ≥ daily_cap` AND any of: `orchestrator_turn_count_per_minute > 2x_baseline`, `hmac_auth_failure_rate > 1%`, `single_student_turn_rate > 100/min`. Wiring details captured in lock-evidence ticket per §3.10.

**Flag for review** (revise when team scales): formal on-call rotation, after-hours SLA, escalation tree depth.

### **§2.3 DR / RTO posture (V1 default — flag for review)**

**V1 default:** 4-hour acceptable RTO (recovery time objective) for us-central1 regional outage. No automated multi-region failover. Manual restoration when GCP returns capacity.

**Rationale:** Lyceon at V1 is a single-region service. Multi-region adds operational complexity (cross-region DB replication, traffic routing, eventual consistency on `tutor_memory_summaries`) that exceeds V1 launch capacity. V1 launch traffic is small enough that a 4-hour outage during a regional event is tolerable.

**V4 runbook absorbs:** RTO reduction (target: \<30 min via active-passive multi-region), automated failover.

### **§2.4 Cost posture (V3 — RB-V3-09 normalized)**

**V1 default Vertex daily budget:** see §3.10 launch-blocker checklist. Value provided by Karl before launch and recorded in lock-evidence ticket. Configured in Google Cloud Billing.

**Pro→Flash budget circuit breaker** triggers at 100% of daily budget per V3 §5.3.3.

Below circuit breaker activation, cost runaway alert fires per §2.2:

* 80% of daily budget → WARN to Karl \+ Ops Slack  
* 100% of daily budget alone → Karl \+ Ops Slack (no PagerDuty)  
* 100% of daily budget AND cost-runaway-with-anomaly composite policy fires → PagerDuty SEV-2

**V4 runbook absorbs:** dynamic budget scaling, tiered budget alerts at 50%/80%/100%, automated cost-anomaly detection.

## **§3 Pre-launch readiness checklist**

Before V3 ships to production, ALL items below must be checked. Each item maps to a V3 §29.3 pre-deployment gate, a Test Matrix V1.1 P0 scenario, or a runbook section.

### **§3.1 Documents**

* \[ \] Doc 03C V3 reviewed \+ signed off by engineering  
* \[ \] Doc 03C.1 Test Matrix V1.1 status \= Locked or Draft for lock with engineering \+ ops review complete per V1.1 §header  
* \[ \] This runbook (V3) reviewed by engineering \+ ops  
* \[ \] Repo path audit complete (Test Matrix V1.1 §3.7 confirms `apps/lisa-orchestrator/` paths match production repo)

### **§3.2 Code \+ tests**

* \[ \] All P0 scenarios in Test Matrix V1.1 §5–§18 pass in CI (128 P0 scenarios)  
* \[ \] Coverage report shows 100% of P0 scenarios executed; no skipped P0 tests  
* \[ \] Chaos tests in Test Matrix §13.12, §16.1–§16.7 pass in chaos-test environment  
* \[ \] Load tests in Test Matrix §9.11, §11.16 hit P95/P99 targets (V3 P95 \<12ms PII guard latency)

### **§3.3 Schema \+ migrations**

* \[ \] V3 §29.1 (`cache_kind` CHECK expansion) DDL reviewed \+ tested in dev  
* \[ \] V3 §29.2 (`tutor_memory_summaries.status` column) DDL reviewed \+ tested in dev  
* \[ \] Migration rollback tested per Test Matrix §18.5 \+ §18.6  
* \[ \] Migration idempotency verified (re-run is no-op per Test Matrix §18.8)

### **§3.4 Cross-doc patches (03B coordination)**

* \[ \] 03B envelope-builder hotfix authored \+ reviewed (filter `WHERE status = 'ready'` added) — required per V3 §29.3 step 5  
* \[ \] 03B V5 §18 error registry expansion authored OR forward-compat addendum (codes: `pii_in_envelope`, `streaming_chunk_gate_blocked`, `streaming_anti_leak_cascade`, `client_scope_override_attempted`) per V3 §32.7  
* \[ \] 03B V5 §16 anti-leak coordination documented per V3 §32.6  
* \[ \] LISA team owner for 03B coordination identified (deploy step 5–6 owner; recorded in lock-evidence ticket)

### **§3.5 Infrastructure**

* \[ \] GCP projects provisioned: production / staging / dev (project IDs verified per §3.10)  
* \[ \] Service accounts created per §5: `lisa-orchestrator@`, `lisa-memory-worker@`, `lisa-cloud-tasks@`  
* \[ \] IAM bindings applied per §5.2 (V1 minimum; flagged for resource-level narrowing review)  
* \[ \] Vertex AI quota allocated for production traffic (specific values per §3.10)  
* \[ \] Cloud Run services `lisa-orchestrator` \+ `lisa-memory-worker` deployed to staging with V3 image  
* \[ \] Cloud Tasks queues created per §5.3  
* \[ \] Cloud Scheduler job `lisa-pending-reconciliation-trigger` configured (paused; §29.3 step 10 enables)  
* \[ \] Secret Manager: HMAC signing key \+ canonical PII guard config secret (`lisa-pii-guard-config-prod`) provisioned per §5.6  
* \[ \] Runtime config table `tutor_context_runtime_config` populated per §11

### **§3.6 Observability (V3 — RB-V3-11 added)**

* \[ \] Cloud Monitoring dashboard published per Test Matrix §17.10  
* \[ \] All §28 PAGE alerts wired to PagerDuty per Test Matrix §17.4 \+ §17.11 \+ §17.12  
* \[ \] Composite alert policy `cost-runaway-with-anomaly` wired per §2.2  
* \[ \] PagerDuty on-call rotation populated (Karl \+ engineering team)  
* \[ \] Cloud Billing budget alert configured per §2.4 (with values from §3.10)  
* \[ \] Test §17.11 \+ §17.12 verify V3 §28.7 \+ §28.8 alert wiring (executed in staging before sign-off)  
* \[ \] **PagerDuty alert policy resource names captured in lock-evidence ticket** (V3 — RB-V3-11), specifically:  
  * Per-turn PII-disabled-mode alert policy: full resource name `projects/<PROJECT>/alertPolicies/<POLICY_ID>` (used by §17.4 break-glass snooze procedure)  
  * Boot-event break-glass active-at-startup alert policy: full resource name (NOT snoozed during break-glass; remains active to verify boot event)  
  * SEV-1 privacy bypass alert policies: full resource names (NEVER snoozed under any circumstance)

### **§3.7 V3 Step 7a verification (per V3 §29.3 \+ Test Matrix V1.1 §18.11)**

* \[ \] PII guard config validation tested in staging with all three sub-checks (a/b/c per §8 of this runbook)  
* \[ \] Sub-test 18.11.regression passes (validates that production cannot silently disable PII guard)  
* \[ \] Dedicated staging test secrets pre-provisioned per §8.0: `lisa-pii-guard-config-staging-test-bad`, `lisa-pii-guard-config-staging-test-valid`

### **§3.8 Sign-offs**

* \[ \] Engineering lead sign-off on code \+ tests  
* \[ \] Ops lead sign-off on procedures \+ this runbook  
* \[ \] Karl sign-off on V1 launch posture  
* \[ \] Karl sign-off on PII guard break-glass operational policy per §17  
* \[ \] LISA team sign-off on 03B cross-doc patches

### **§3.9 V3 spec alignment audit**

* \[ \] Runtime config NOTIFY channel name in §11 matches V3 §31.5 (`runtime_config_updated`)  
* \[ \] Runtime config table schema in §11 matches V3 §31.5 PRIMARY KEY `(config_key, environment)` and column names (`config_key`, `environment`, `config_value`, `updated_at`, `updated_by`)  
* \[ \] Health endpoint references throughout §4, §5, §17 use V3 §28B.4 single-`/health`\-endpoint readiness semantic (RB-V3-05)

### **§3.10 Launch-blocker values — MUST RESOLVE BEFORE PRODUCTION DEPLOY**

These values are explicit launch blockers. The runbook's §18 Pro→Flash circuit breaker procedure depends on the daily budget being a real number; §22 quota management depends on actual quota allocations. No production deploy proceeds until each is resolved by Karl and recorded in the lock-evidence ticket.

| Launch blocker | Required by | Resolution owner | Captured in |
| ----- | ----- | ----- | ----- |
| `vertex.pro_budget_circuit_breaker.daily_cap_usd` (production daily Vertex budget in USD) | §18 procedure | Karl | Lock-evidence ticket |
| Gemini Pro requests-per-minute quota for production project | §22.1 \+ §22.3 | Karl \+ GCP support | Lock-evidence ticket |
| Gemini Flash requests-per-minute quota for production project | §22.1 \+ §22.3 | Karl \+ GCP support | Lock-evidence ticket |
| Cloud Billing monthly budget alert threshold | §2.4 | Karl | Lock-evidence ticket \+ Cloud Billing UI |
| GCP project IDs (production, staging, dev) | §3.5 \+ §4 \+ §5 commands | Karl | Lock-evidence ticket; replace placeholders before staging dry-run |
| LISA team owner contact for 03B cross-doc coordination | §3.4 \+ §4.5 \+ §4.6 | Karl | Lock-evidence ticket |
| Cloud Monitoring composite alert policy `cost-runaway-with-anomaly` wiring | §2.2 \+ §3.6 | Platform engineering on-call | Lock-evidence ticket \+ Cloud Monitoring UI |
| **PagerDuty per-turn PII-disabled-mode alert policy resource name** (V3 — RB-V3-11) | §17.4 break-glass snooze procedure | Platform engineering on-call | Lock-evidence ticket |

**Deploy gate:** ALL launch-blocker rows MUST be checked off before §4 deployment sequence begins. The deploy script in §4 should verify these values are not placeholder strings before proceeding.

### **§3.11 Staging dry-run requirement**

Every gcloud and psql command in §4, §5, §8, §13, §14, §17, §18 must be dry-run in staging before production deploy. Dry-run evidence captured in lock-evidence ticket.

**Special attention items for V3 dry-run:**

* The `gcloud monitoring snoozes create` and `gcloud monitoring snoozes cancel` commands in §17.4 / §17.8 (RB-V3-02) — these were corrected in V3 from V2's invalid syntax; staging dry-run must produce a real snooze and cancel it  
* The pre-shift traffic JSON capture pattern in §4.0b (RB-V3-01) — verify `gcloud run services describe ... --format=json` produces parseable output and that `jq` extraction works as documented  
* The `--criteria-policies` flag accepts the full resource name `projects/<PROJECT>/alertPolicies/<POLICY_ID>`, not just the bare policy ID — staging dry-run validates the captured §3.6 resource name format

**Dry-run definition:** the command is executed against the staging environment with appropriate substitutions; verification queries are run; output is captured. Commands marked "production-only" (e.g., production migration) are dry-run with the corresponding staging command and noted as "verified equivalent for production execution."

ALL items in §3.1 through §3.11 must check before §29.3 sequence step 7 (canary deployment) begins.

---

# **Part II — Deployment Procedures**

## **§4 V3 §29.3 deployment sequence (executable)**

This is the executable form of Doc 03C V3 spec §29.3. Each step has a precondition, action, verification, "falsifies if" line, rollback, owner, evidence to capture, and rough duration.

**Total sequence duration:** \~6–8 hours under green path; longer if ramping more cautiously.

**Critical rule:** ANY step fails → halt sequence; execute step-specific rollback. No fix-forward at deploy time. Re-attempt once root cause is fixed.

**Project ID convention in this section:** commands show `lyceon-vertex-prod` and `lyceon-vertex-staging` as placeholders. Substitute actual project IDs from §3.10 lock-evidence ticket before execution.

**Operational note (V3 — RB-V3-05):** `/health` per Doc 03C V3 spec §28B.4 is a **readiness gate** (returns 200 only when DB \+ Vertex API \+ Secret Manager all reachable), not a liveness check. Traffic ramp must not begin unless `/health` returns 200 with body `{"status": "ready"}`. A 503 response indicates a dependency failure and blocks ramp.

### **§4.0 Step 0 — Document publication \+ sign-offs**

**Owner:** Engineering lead \+ Ops lead

**Precondition:** §3 pre-launch checklist 100% green, including §3.10 launch-blocker values resolved and §3.11 staging dry-run evidence captured.

**Action:**

1. Doc 03C V3 in `/mnt/user-data/outputs/Lyceon_Doc_03C_V3.md` — confirmed  
2. Doc 03C.1 Test Matrix V1.1 in `/mnt/user-data/outputs/Lyceon_Doc_03C_1_Test_Matrix_V1_1.md` — confirmed  
3. This runbook V3 in `/mnt/user-data/outputs/Lyceon_Doc_03C_Operations_Runbook_V3.md` — confirmed at deploy time  
4. Engineering lead approves PR with all three docs (or equivalent merge-to-main signal)  
5. Ops lead approves PR  
6. Karl approves V1 launch posture \+ break-glass operational policy

**Verification:** All three docs present in canonical location; PR merged with sign-offs; lock-evidence ticket records sign-off timestamps.

**Falsifies if:** Any sign-off is missing OR any §3 checklist item is unchecked.

**Rollback if step fails:** Defer launch. Address gaps; re-run §3 checklist.

**Evidence to capture:** Lock-evidence ticket URL; PR URLs; sign-off timestamps.

**Duration:** Variable (depends on review cycle).

### **§4.0a Deployment evidence template**

For each subsequent step, capture the following evidence in the deployment ticket:

\#\# Step \<N\>: \<step name\>  
\*\*Date/time started (UTC):\*\* \<ISO timestamp\>  
\*\*Owner (named individual):\*\* \<person\>  
\*\*Environment:\*\* staging | production  
\*\*Pre-shift traffic capture (if traffic shift):\*\* \<path to traffic-before-step-N.json per §4.0b\>  
\*\*Command executed:\*\*

\<exact command\> \`\`\` \*\*Output:\*\* \`\`\` \<paste command output\> \`\`\` \*\*Verification command:\*\* \`\`\` \<verification command\> \`\`\` \*\*Verification output:\*\* \`\`\` \<paste verification output\> \`\`\` \*\*Date/time completed (UTC):\*\* \<ISO timestamp\> \*\*Outcome:\*\* ✅ success | ❌ failure (then capture rollback execution below) \*\*Notes:\*\* \<any deviations, anomalies, observations\> \`\`\`

This template applies to every executed step in §4. Use the same template for §8 sub-checks.

### **§4.0b Pre-shift traffic capture pattern (V3 — RB-V3-01 \+ RB-V3-06)**

**Critical operational pattern.** Every traffic shift in §4, §8, §14, §17 captures the full Cloud Run service traffic state as JSON immediately before the shift. Rollback restores from the captured state by revision name \+ percentage. Do NOT infer rollback target from revision creation order, tag-based filters, or "previous revision" heuristics.

**Capture command (run BEFORE every traffic shift):**

\# Variables expected: REGION, SERVICE (e.g., "lisa-orchestrator"), STEP\_LABEL (e.g., "step-8-canary-5pct")  
mkdir \-p ./deploy-evidence  
TRAFFIC\_BEFORE\_FILE="./deploy-evidence/traffic-before-${STEP\_LABEL}-$(date \-u \+%Y%m%dT%H%M%SZ).json"

gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "${TRAFFIC\_BEFORE\_FILE}"

echo "Traffic state captured: ${TRAFFIC\_BEFORE\_FILE}"

**Extract human-readable traffic map from captured JSON:**

\# Requires jq  
jq \-r '.status.traffic\[\] | "\\(.revisionName // "(latest)")\\t\\(.percent // 0)%\\t\\(.tag // "(no tag)")"' \\  
  "${TRAFFIC\_BEFORE\_FILE}"

Example output:

lisa-orchestrator-00041-xyz	95%	(no tag)  
lisa-orchestrator-00042-abc	5%	v3-canary

**Capture key fields for the deploy ticket:**

* File path of captured JSON  
* Human-readable traffic map (output of jq command above)  
* Timestamp of capture

**Rollback command (restore from captured state):**

\# Build the \--to-revisions argument from the captured JSON  
\# Each entry is REVISION\_NAME=PERCENT  
TO\_REVISIONS=$(jq \-r '  
  \[.status.traffic\[\]  
    | select(.revisionName \!= null and .percent \!= null and .percent \> 0\)  
    | "\\(.revisionName)=\\(.percent)"\]  
  | join(",")  
' "${TRAFFIC\_BEFORE\_FILE}")

echo "Rollback target: ${TO\_REVISIONS}"

gcloud run services update-traffic ${SERVICE} \\  
  \--to-revisions=${TO\_REVISIONS} \\  
  \--region=${REGION}

**Rules:**

* Capture JSON BEFORE the traffic shift, not after the failure  
* Store captured JSON in deploy-evidence directory; reference path in deploy ticket  
* Rollback restores by **revision name**, never by tag (tags can be reassigned; revision names are immutable)  
* If captured JSON is unavailable at rollback time, this is a critical incident — escalate to Engineering lead before manual recovery

**Verification fallback (V3 — RB-V3-06):** the captured JSON also serves as a fallback when filter expressions like `--format='value(status.traffic[?tag==X].revisionName)'` fail or return unexpected output. Operator can extract any field from the JSON via `jq` rather than trusting brittle inline filters.

### **§4.1 Step 1 — Migration §29.1 to staging**

**Owner:** Platform engineering on-call

**Precondition:** Step 0 complete; staging DB accessible; migration file `migrations/03C-V2-01-cache-kind-expand.sql` matches V3 §29.1 DDL.

**Action:**

psql "$STAGING\_DATABASE\_URL" \\  
  \-f migrations/03C-V2-01-cache-kind-expand.sql

The migration file is the DDL block from V3 spec §29.1 (idempotent; safe to re-run).

**Verification:**

psql "$STAGING\_DATABASE\_URL" \-c "\\d+ tutor\_vertex\_context\_cache" \\  
  | grep "tutor\_vertex\_context\_cache\_cache\_kind\_check"

Expected output includes `student_composite` in the CHECK clause.

**Falsifies if:** Verification command returns no rows OR CHECK clause does not include `'student_composite'`.

**Rollback if step fails:**

ALTER TABLE tutor\_vertex\_context\_cache  
  DROP CONSTRAINT tutor\_vertex\_context\_cache\_cache\_kind\_check;

ALTER TABLE tutor\_vertex\_context\_cache  
  ADD CONSTRAINT tutor\_vertex\_context\_cache\_cache\_kind\_check  
  CHECK (cache\_kind IN ('system\_prompt', 'teaching\_profile', 'canonical\_question'));

**Evidence to capture:** Per §4.0a template.

**Duration:** \~5 minutes.

### **§4.2 Step 2 — Migration §29.1 to production**

**Owner:** Platform engineering on-call

**Precondition:** Step 1 verified in staging; staging traffic stable for ≥1 hour.

**Action:**

psql "$PROD\_DATABASE\_URL" \\  
  \-f migrations/03C-V2-01-cache-kind-expand.sql

**Verification:** Same as Step 1 against production DB.

**Falsifies if:** Same as Step 1\.

**Rollback if step fails:** Same DDL as Step 1 rollback against production.

**Evidence to capture:** Per §4.0a template; explicitly note this is production execution.

**Duration:** \~5 minutes.

### **§4.3 Step 3 — Migration §29.2 to staging**

**Owner:** Platform engineering on-call

**Precondition:** Step 2 complete.

**Action:**

psql "$STAGING\_DATABASE\_URL" \\  
  \-f migrations/03C-V2-02-memory-summaries-status.sql

The migration file is the DDL block from V3 spec §29.2 (idempotent; adds `status` column with default `'ready'`).

**Verification:**

psql "$STAGING\_DATABASE\_URL" \-c "\\d+ tutor\_memory\_summaries" \\  
  | grep \-E "status.\*\\sNOT NULL.\*DEFAULT"

Expected: `status` column present, default `'ready'`, NOT NULL constraint, CHECK constraint includes `'pending'`, `'ready'`, `'failed'`.

**Falsifies if:** Status column is missing OR does not have NOT NULL OR does not have DEFAULT 'ready' OR CHECK constraint missing one of pending/ready/failed.

**Rollback if step fails:**

ALTER TABLE tutor\_memory\_summaries DROP COLUMN status;

**Note:** This rollback is destructive; safe at staging because no V3 traffic has run. NEVER execute against production once V3 traffic has begun reading the column. See §4.4 for production rollback constraints.

**Evidence to capture:** Per §4.0a template; capture row count of `tutor_memory_summaries` before \+ after migration.

**Duration:** \~10 minutes.

### **§4.4 Step 4 — Migration §29.2 to production**

**Owner:** Platform engineering on-call

**Precondition:** Step 3 verified in staging; staging traffic stable for ≥1 hour.

**Action:**

psql "$PROD\_DATABASE\_URL" \\  
  \-f migrations/03C-V2-02-memory-summaries-status.sql

**Verification:** Same as Step 3 against production DB.

**Falsifies if:** Same as Step 3\.

**Rollback policy:**

Production rollback of `tutor_memory_summaries.status` column is **prohibited** after any V3 writer has created `pending` or `failed` rows in production. Detection query:

SELECT count(\*) FROM tutor\_memory\_summaries WHERE status IN ('pending', 'failed');

**Default rollback** (V3 traffic not yet started, OR rollback decision made before §4.7 step 7):

* Keep the column  
* Roll back code (revision rollback per §4 patterns using §4.0b restoration)  
* Do NOT drop the schema column

**Conditional rollback** (column drop required for some reason):

* Requires Engineering lead approval  
* Requires data-preservation plan documented (e.g., archive `pending`/`failed` rows to backup table before drop)  
* Cannot proceed without lock-evidence ticket update documenting rationale

**Evidence to capture:** Per §4.0a template; capture row count \+ status distribution before \+ after migration.

**Duration:** \~10–30 minutes (depends on production row count).

### **§4.5 Step 5 — 03B envelope-builder hotfix to staging**

**Owner:** LISA team owner (per §3.10 lock-evidence ticket)

**Precondition:** Step 4 complete (migration §29.2 must apply BEFORE 03B hotfix references the `status` column, per Test Matrix V1.1 §18.7).

**Action:**

1. LISA team deploys 03B envelope-builder hotfix to staging:  
   * Filter `WHERE status = 'ready'` added to envelope-builder query  
   * V3 error codes registered in 03B error registry: `pii_in_envelope`, `streaming_chunk_gate_blocked`, `streaming_anti_leak_cascade`, `client_scope_override_attempted`  
2. LISA team runs 03B regression suite in staging.

**Verification:**

* 03B envelope-builder query includes status filter (code review)  
* Synthetic envelope generation in staging produces no rows with `status != 'ready'`  
* 03B error registry includes V3 codes (code review)

**Falsifies if:** 03B regression suite fails OR envelope-builder query does not contain status filter OR error registry missing any V3 code.

**Rollback if step fails:** Revert 03B to prior staging revision via LISA team's 03B deployment process.

**Evidence to capture:** Per §4.0a template; LISA team confirmation of regression-suite green.

**Duration:** Depends on LISA team scheduling.

### **§4.6 Step 6 — 03B envelope-builder hotfix to production**

**Owner:** LISA team owner

**Precondition:** Step 5 verified; staging stable for ≥1 hour.

**Action:** LISA team deploys 03B hotfix to production via their standard deployment process.

**Verification:** Same as Step 5 against production. Monitor 03B-side SLIs for 30 minutes post-deploy; confirm envelope generation rate stable.

**Falsifies if:** 03B-side SLIs degrade post-deploy OR envelope generation rate drops.

**Rollback if step fails:** LISA team reverts to prior 03B production revision.

**Evidence to capture:** Per §4.0a template; LISA team confirmation of post-deploy SLI stability.

**Duration:** Depends on LISA team deployment cadence.

### **§4.7 Step 7 — 03C V3 to staging at 0% traffic**

**Owner:** Platform engineering on-call

**Precondition:** Step 6 complete.

**Action:**

PROJECT="lyceon-vertex-staging"  
REGION="us-central1"  
SERVICE="lisa-orchestrator"  
STEP\_LABEL="step-7-staging-deploy"

\# §4.0b: capture pre-shift traffic state (no shift yet, but baseline for any future rollback)  
mkdir \-p ./deploy-evidence  
TRAFFIC\_BEFORE\_FILE="./deploy-evidence/traffic-before-${STEP\_LABEL}-$(date \-u \+%Y%m%dT%H%M%SZ).json"  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "${TRAFFIC\_BEFORE\_FILE}"

\# Build new revision with \--no-traffic (0% production traffic)  
\# \--tag creates a TRAFFIC TAG (not a revision name); deploy creates an immutable revision  
\# with auto-generated name like lisa-orchestrator-00042-abc  
gcloud run deploy ${SERVICE} \\  
  \--image=gcr.io/${PROJECT}/lisa-orchestrator:v3.0.0 \\  
  \--region=${REGION} \\  
  \--no-traffic \\  
  \--tag=v3-canary

\# Capture the actual revision name created by this deploy (per §4.0b extraction pattern)  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "./deploy-evidence/traffic-after-${STEP\_LABEL}.json"

NEW\_REVISION=$(jq \-r '.status.traffic\[\] | select(.tag \== "v3-canary") | .revisionName' \\  
  "./deploy-evidence/traffic-after-${STEP\_LABEL}.json")

echo "New revision: $NEW\_REVISION"  
\# Record NEW\_REVISION in lock-evidence ticket; subsequent verification commands  
\# use this revision name (NOT the tag name).

Run smoke tests against the tagged URL:

SMOKE\_URL=$(jq \-r '.status.traffic\[\] | select(.tag \== "v3-canary") | .url' \\  
  "./deploy-evidence/traffic-after-${STEP\_LABEL}.json")

curl \-X POST "${SMOKE\_URL}/orchestrate/turn" \\  
  \-H "Content-Type: application/json" \\  
  \-H "X-Lyceon-Signature: $(./scripts/sign-fixture envelope-fixture.json)" \\  
  \-d @envelope-fixture.json

Expected: HTTP 200 with valid response envelope.

**Verification:**

\# Health endpoint check (per V3 §28B.4 — readiness gate, not liveness)  
curl \-f "${SMOKE\_URL}/health"  
\# Expected: HTTP 200 with body {"status": "ready"}  
\# A 503 response means a dependency check failed (DB, Vertex, or Secret Manager unreachable)

\# Revision describe (using actual revision name extracted via jq, NOT tag)  
gcloud run revisions describe ${NEW\_REVISION} \\  
  \--region=${REGION} \\  
  \--format='value(status.conditions\[0\].type,status.conditions\[0\].status)'  
\# Expected: Ready True

\# Cold-start CI gate (Test Matrix V1.1 §16.4)  
./scripts/cold-start-test ${SMOKE\_URL} 100  
\# Expected: P99 latency \<3000ms over 100 invocations

**Falsifies if:** `/health` returns non-200 OR revision describe shows `Ready: False` OR cold-start P99 exceeds 3000ms over 100 invocations.

**Rollback if step fails:** Per §4.0b pattern — restore traffic from `${TRAFFIC_BEFORE_FILE}`. The new revision exists at 0% traffic, so no traffic restoration is needed; just delete the failed canary revision after investigation:

\# Investigate the failed revision's logs first  
gcloud logging read \\  
  "resource.type=cloud\_run\_revision AND resource.labels.revision\_name=${NEW\_REVISION}" \\  
  \--limit=100 \--order=desc

\# Then delete the failed revision  
gcloud run revisions delete ${NEW\_REVISION} \--region=${REGION} \--quiet

**Evidence to capture:** Per §4.0a template; record `${TRAFFIC_BEFORE_FILE}` path; record `${NEW_REVISION}` name; record cold-start test result.

**Duration:** \~20 minutes.

### **§4.7a Step 7a — V3 §29.3 break-glass config validation in staging (V3 spec F-V3-10)**

**Owner:** Platform engineering on-call

**Precondition:** Step 7 complete; v3-canary revision live in staging at 0% traffic.

This step runs the three sub-checks from Test Matrix V1.1 §18.11. All three must pass; ANY failure halts the deployment sequence.

**See §8 of this runbook for the full executable procedure** (including dedicated test secrets). Summary:

* **Sub-check (a):** Deploy a staging revision with `pii_guard.enabled=false` and missing break-glass ticket. Boot MUST FAIL.  
* **Sub-check (b):** Deploy with valid break-glass ticket. Boot MUST SUCCEED with log event \+ PagerDuty page.  
* **Sub-check (c):** Deploy with default config. Boot MUST SUCCEED normally.

**Verification:** All three sub-checks pass per §8 verification commands.

**Falsifies if:** Any sub-check produces unexpected outcome.

**Rollback if step fails:** Halt deployment sequence; investigate config validation code path; do NOT proceed to step 8 until validation is wired up correctly.

**Evidence to capture:** Per §8 evidence requirements (each sub-check has its own evidence template).

**Duration:** \~30–45 minutes (three deploy cycles).

### **§4.8 Step 8 — 03C V3 canary at 5% production traffic**

**Owner:** Platform engineering on-call

**Precondition:** Step 7a all sub-checks pass; v3-canary stable in staging for ≥30 minutes.

**Action:**

PROJECT="lyceon-vertex-prod"  
REGION="us-central1"  
SERVICE="lisa-orchestrator"  
STEP\_LABEL="step-8-prod-canary-5pct"

\# §4.0b: capture pre-shift traffic state BEFORE deploying or shifting  
mkdir \-p ./deploy-evidence  
TRAFFIC\_BEFORE\_FILE="./deploy-evidence/traffic-before-${STEP\_LABEL}-$(date \-u \+%Y%m%dT%H%M%SZ).json"  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "${TRAFFIC\_BEFORE\_FILE}"

\# Show the captured traffic state for ticket evidence  
echo "=== Pre-shift traffic state \==="  
jq \-r '.status.traffic\[\] | "\\(.revisionName // "(latest)")\\t\\(.percent // 0)%\\t\\(.tag // "(no tag)")"' \\  
  "${TRAFFIC\_BEFORE\_FILE}"

\# Promote canary revision in production with \--no-traffic  
gcloud run deploy ${SERVICE} \\  
  \--image=gcr.io/${PROJECT}/lisa-orchestrator:v3.0.0 \\  
  \--region=${REGION} \\  
  \--no-traffic \\  
  \--tag=v3-canary

\# Extract the new canary revision name  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "./deploy-evidence/traffic-after-deploy-${STEP\_LABEL}.json"

NEW\_REVISION=$(jq \-r '.status.traffic\[\] | select(.tag \== "v3-canary") | .revisionName' \\  
  "./deploy-evidence/traffic-after-deploy-${STEP\_LABEL}.json")  
echo "Production canary revision: $NEW\_REVISION"

\# Wait for revision Ready status before shifting traffic  
for i in {1..60}; do  
  READY=$(gcloud run revisions describe ${NEW\_REVISION} \\  
    \--region=${REGION} \\  
    \--format='value(status.conditions\[?type==\`Ready\`\].status)' | head \-1)  
  if \[ "$READY" \= "True" \]; then  
    echo "Revision ready"  
    break  
  fi  
  sleep 1  
done

\# Verify health endpoint is returning 200 on the tagged URL before traffic shift  
CANARY\_URL=$(jq \-r '.status.traffic\[\] | select(.tag \== "v3-canary") | .url' \\  
  "./deploy-evidence/traffic-after-deploy-${STEP\_LABEL}.json")  
curl \-f "${CANARY\_URL}/health" || { echo "Health check failed; aborting traffic shift"; exit 1; }

\# Now shift 5% traffic to v3-canary; remaining 95% stays on prior revision  
gcloud run services update-traffic ${SERVICE} \\  
  \--to-tags=v3-canary=5 \\  
  \--region=${REGION}

**Verification (1-hour observation window):**

* §28 SLIs all within target rates over the 1-hour window  
* Explicit checks for §28.7 PII guard SLIs:  
  * `orchestrator_pii_blocked_turns_total{callsite='main_turn'}` \= 0 (no false-positive blocks)  
  * `orchestrator_pii_blocked_turns_total{callsite='cache_creation'}` \= 0  
  * `client_scope_override_attempted_total` \= 0  
* §28.8 config SLIs: no `pii_guard_break_glass_active_at_startup` events  
* `orchestrator_turn_latency_p95` within 10% of pre-V3 baseline  
* `vertex_call_latency_p95` within 10% of baseline  
* Health endpoint `/health` (V3 §28B.4 readiness gate) returning 200 consistently for v3-canary revision

**Falsifies if:** Any §28.7 PII PAGE alert fires OR §28.8 configuration alert fires OR turn-latency P95 degrades \>10% OR turn-success-rate drops below baseline OR `/health` returns 503 sustained for \>2 consecutive probes.

**Rollback if step fails:** Per §4.0b pattern — restore traffic from `${TRAFFIC_BEFORE_FILE}`:

TO\_REVISIONS=$(jq \-r '  
  \[.status.traffic\[\]  
    | select(.revisionName \!= null and .percent \!= null and .percent \> 0\)  
    | "\\(.revisionName)=\\(.percent)"\]  
  | join(",")  
' "${TRAFFIC\_BEFORE\_FILE}")

echo "Rollback target: ${TO\_REVISIONS}"

gcloud run services update-traffic ${SERVICE} \\  
  \--to-revisions=${TO\_REVISIONS} \\  
  \--region=${REGION}

**Evidence to capture:** Per §4.0a template; `${TRAFFIC_BEFORE_FILE}` path; `${NEW_REVISION}` name; SLI snapshot at start \+ end of observation window.

**Duration:** 1+ hour observation.

### **§4.9 Step 9 — 03C V3 ramp to 25%, 50%, 100%**

**Owner:** Platform engineering on-call

**Precondition:** Step 8 stable for ≥1 hour with all SLIs within target.

**Action:** Three sub-steps with 1-hour observation between each. **Each sub-step captures pre-shift traffic state per §4.0b before its traffic shift.**

REGION="us-central1"  
SERVICE="lisa-orchestrator"

\# 9a: ramp to 25%  
STEP\_LABEL="step-9a-prod-canary-25pct"  
TRAFFIC\_BEFORE\_9A="./deploy-evidence/traffic-before-${STEP\_LABEL}-$(date \-u \+%Y%m%dT%H%M%SZ).json"  
gcloud run services describe ${SERVICE} \--region=${REGION} \--format=json \> "${TRAFFIC\_BEFORE\_9A}"

gcloud run services update-traffic ${SERVICE} \\  
  \--to-tags=v3-canary=25 \--region=${REGION}  
\# Wait 1 hour; verify SLIs (per §4.8 verification list)

\# 9b: ramp to 50%  
STEP\_LABEL="step-9b-prod-canary-50pct"  
TRAFFIC\_BEFORE\_9B="./deploy-evidence/traffic-before-${STEP\_LABEL}-$(date \-u \+%Y%m%dT%H%M%SZ).json"  
gcloud run services describe ${SERVICE} \--region=${REGION} \--format=json \> "${TRAFFIC\_BEFORE\_9B}"

gcloud run services update-traffic ${SERVICE} \\  
  \--to-tags=v3-canary=50 \--region=${REGION}  
\# Wait 1 hour; verify SLIs

\# 9c: ramp to 100%  
STEP\_LABEL="step-9c-prod-canary-100pct"  
TRAFFIC\_BEFORE\_9C="./deploy-evidence/traffic-before-${STEP\_LABEL}-$(date \-u \+%Y%m%dT%H%M%SZ).json"  
gcloud run services describe ${SERVICE} \--region=${REGION} \--format=json \> "${TRAFFIC\_BEFORE\_9C}"

gcloud run services update-traffic ${SERVICE} \\  
  \--to-tags=v3-canary=100 \--region=${REGION}  
\# Wait 30 minutes; final stability check

**Verification at each sub-step:** Same as Step 8 SLI checks; sustained over the 1-hour observation window.

**Falsifies if:** Same falsifies-if as Step 8 at any sub-step.

**Rollback if any sub-step fails:** Per §4.0b pattern — restore from the captured traffic file for THAT sub-step:

\# Example: rollback from sub-step 9b failure  
TO\_REVISIONS=$(jq \-r '  
  \[.status.traffic\[\]  
    | select(.revisionName \!= null and .percent \!= null and .percent \> 0\)  
    | "\\(.revisionName)=\\(.percent)"\]  
  | join(",")  
' "${TRAFFIC\_BEFORE\_9B}")

gcloud run services update-traffic ${SERVICE} \\  
  \--to-revisions=${TO\_REVISIONS} \\  
  \--region=${REGION}

**Critical:** rollback target is the captured pre-shift state, NOT a heuristic about revision creation order. Each sub-step captures its own traffic file; rollback uses the file matching the failed sub-step.

**Evidence to capture:** Per §4.0a template; the three `TRAFFIC_BEFORE_*` JSON file paths; SLI snapshots at each ramp step.

**Duration:** 3.5 hours total (1 hour each at 25/50, 30 min final).

### **§4.10 Step 10 — Enable Cloud Scheduler reconciliation trigger**

**Owner:** Platform engineering on-call

**Precondition:** Step 9 complete; 03C V3 at 100% production traffic stable for ≥30 minutes.

**Action:**

gcloud scheduler jobs resume lisa-pending-reconciliation-trigger \\  
  \--location=us-central1

The job target: HTTP POST to `lisa-orchestrator/async/pending-reconciliation/sweep` with OIDC-signed token; runs every 5 minutes.

**Verification:**

\# Wait 5+ minutes for first sweep  
sleep 360

\# Check sweep is running  
gcloud logging read \\  
  "resource.type=cloud\_scheduler\_job AND resource.labels.job\_id=lisa-pending-reconciliation-trigger" \\  
  \--limit=5 \--order=desc

\# Verify SLI  
gcloud monitoring time-series list \\  
  \--filter='metric.type="custom.googleapis.com/pending\_reconciliation\_sweep\_count"' \\  
  \--interval-end-time=$(date \-u \+%Y-%m-%dT%H:%M:%SZ) \\  
  \--interval-start-time=$(date \-u \-d '-15 minutes' \+%Y-%m-%dT%H:%M:%SZ)

Expected: `pending_reconciliation_sweep_count` increments at 5-minute cadence; `pending_reconciliation_orphaned_count` reads as 0 (or expected baseline).

**Falsifies if:** First sweep does not run within 6 minutes OR sweep handler logs error OR `pending_reconciliation_orphaned_count` shows accumulating without sweep.

**Rollback if step fails:**

gcloud scheduler jobs pause lisa-pending-reconciliation-trigger \--location=us-central1

**Evidence to capture:** Per §4.0a template; first sweep log; SLI initial read.

**Duration:** \~10 minutes.

### **§4.11 Post-deployment**

After Step 10 completes successfully:

1. Karl \+ engineering announce V3 production launch in ops channel  
2. Update operational status page  
3. Open V4 runbook tracking ticket (per §V4 trigger criteria)  
4. Schedule 24-hour post-launch review  
5. Archive deploy-evidence directory to lock-evidence ticket attachments

## **§5 IAM provisioning**

V3 spec §IX \+ §28B specify the service account architecture. This section is the executable IAM setup. Project IDs in commands are placeholders per §3.10.

### **§5.1 Service accounts**

| Service account | Purpose | Project |
| ----- | ----- | ----- |
| `lisa-orchestrator@<PROJECT>.iam.gserviceaccount.com` | Cloud Run service `lisa-orchestrator` runtime identity | per env |
| `lisa-memory-worker@<PROJECT>.iam.gserviceaccount.com` | Cloud Run service `lisa-memory-worker` runtime identity | per env |
| `lisa-cloud-tasks@<PROJECT>.iam.gserviceaccount.com` | Cloud Tasks queue invoker (signs OIDC tokens for async handler invocations) | per env |

**Creation:**

PROJECT="lyceon-vertex-prod"

for SA in lisa-orchestrator lisa-memory-worker lisa-cloud-tasks; do  
  gcloud iam service-accounts create $SA \\  
    \--display-name="LISA ${SA\#lisa-}" \\  
    \--project=$PROJECT  
done

### **§5.2 IAM role bindings (V1 minimum; flagged for resource-level narrowing)**

**Important:** these role bindings are V1 minimum-viable least-privilege. They use project-scope bindings where Google Cloud's IAM model permits resource-scope. Before V3 lock, Engineering \+ Platform should review whether each project-scope binding can be narrowed to specific resources (e.g., specific Vertex models, specific Cloud SQL instances). Resource-level narrowing is preferred where supported.

**`lisa-orchestrator@`:**

| Role | Resource scope (V1 minimum) | Why | Resource-narrowing opportunity |
| ----- | ----- | ----- | ----- |
| `roles/aiplatform.user` | Project | Vertex AI inference (Application Default Credentials path) | Narrow to specific model resources via custom role (V4 runbook absorbs) |
| `roles/cloudtasks.enqueuer` | **Per queue** | Enqueue compaction \+ memory-refresh tasks | Already resource-scoped per §5.3 |
| `roles/cloudsql.client` | Project | DB connection via Cloud SQL Proxy | Already narrowed to project; instance-scope possible for V4 runbook |
| `roles/secretmanager.secretAccessor` | **Per secret** | Read HMAC signing key \+ PII guard config | Already resource-scoped per §5.6 |
| `roles/logging.logWriter` | Project | Cloud Logging write | Standard project scope |
| `roles/monitoring.metricWriter` | Project | Cloud Monitoring metric emission | Standard project scope |

**Binding commands:**

PROJECT="lyceon-vertex-prod"  
SA="lisa-orchestrator@${PROJECT}.iam.gserviceaccount.com"

\# Project-scope bindings (4 roles)  
for ROLE in roles/aiplatform.user roles/cloudsql.client roles/logging.logWriter roles/monitoring.metricWriter; do  
  gcloud projects add-iam-policy-binding $PROJECT \\  
    \--member="serviceAccount:${SA}" \\  
    \--role="${ROLE}"  
done

\# Cloud Tasks: resource-scoped per queue (preferred)  
for QUEUE in lisa-compaction lisa-memory-refresh lisa-pending-reconciliation; do  
  gcloud tasks queues add-iam-policy-binding $QUEUE \\  
    \--location=us-central1 \\  
    \--member="serviceAccount:${SA}" \\  
    \--role="roles/cloudtasks.enqueuer"  
done

\# Secret Manager: per-secret bindings (preferred)  
for SECRET in lyceon-hmac-signing-key lisa-pii-guard-config-prod; do  
  gcloud secrets add-iam-policy-binding $SECRET \\  
    \--member="serviceAccount:${SA}" \\  
    \--role="roles/secretmanager.secretAccessor" \\  
    \--project=$PROJECT  
done

**`lisa-memory-worker@`:** Similar to orchestrator EXCEPT:

* Does NOT need `roles/cloudtasks.enqueuer` (it's a consumer, not enqueuer)  
* Does need full RLS-scoped DB access (writes to `tutor_memory_summaries`)  
* Does need `roles/aiplatform.user` (calls Vertex Flash for compaction)  
* Does NOT need PII guard config secret access (only orchestrator reads PII config)

**`lisa-cloud-tasks@`:**

| Role | Resource | Why |
| ----- | ----- | ----- |
| `roles/run.invoker` | `lisa-orchestrator` Cloud Run service | Invoke async handler endpoints with OIDC token |

gcloud run services add-iam-policy-binding lisa-orchestrator \\  
  \--region=us-central1 \\  
  \--member="serviceAccount:lisa-cloud-tasks@${PROJECT}.iam.gserviceaccount.com" \\  
  \--role="roles/run.invoker"

### **§5.3 Cloud Tasks queues**

PROJECT="lyceon-vertex-prod"  
LOCATION="us-central1"

\# Compaction queue (100 req/s)  
gcloud tasks queues create lisa-compaction \\  
  \--location=$LOCATION \\  
  \--max-dispatches-per-second=100 \\  
  \--max-concurrent-dispatches=10 \\  
  \--max-attempts=5 \\  
  \--max-retry-duration=3600s \\  
  \--min-backoff=10s \\  
  \--max-backoff=600s

\# Memory refresh queue (50 req/s)  
gcloud tasks queues create lisa-memory-refresh \\  
  \--location=$LOCATION \\  
  \--max-dispatches-per-second=50 \\  
  \--max-concurrent-dispatches=5 \\  
  \--max-attempts=5 \\  
  \--max-retry-duration=3600s \\  
  \--min-backoff=10s \\  
  \--max-backoff=600s

\# Pending reconciliation queue (20 req/s; V3 spec §VIII)  
gcloud tasks queues create lisa-pending-reconciliation \\  
  \--location=$LOCATION \\  
  \--max-dispatches-per-second=20 \\  
  \--max-concurrent-dispatches=3 \\  
  \--max-attempts=3 \\  
  \--max-retry-duration=1800s \\  
  \--min-backoff=30s \\  
  \--max-backoff=300s

### **§5.4 Cloud Scheduler reconciliation trigger**

Pre-launch creation of the Cloud Scheduler job that triggers `pending-reconciliation` sweeps. Job is created in **paused state**; §4.10 enables it post-canary.

PROJECT="lyceon-vertex-prod"  
LOCATION="us-central1"  
ORCHESTRATOR\_URL=$(gcloud run services describe lisa-orchestrator \\  
  \--region=$LOCATION \--format='value(status.url)')

gcloud scheduler jobs create http lisa-pending-reconciliation-trigger \\  
  \--location=$LOCATION \\  
  \--schedule="\*/5 \* \* \* \*" \\  
  \--time-zone="UTC" \\  
  \--uri="${ORCHESTRATOR\_URL}/async/pending-reconciliation/sweep" \\  
  \--http-method=POST \\  
  \--oidc-service-account-email="lisa-cloud-tasks@${PROJECT}.iam.gserviceaccount.com" \\  
  \--oidc-token-audience="${ORCHESTRATOR\_URL}" \\  
  \--max-retry-attempts=3 \\  
  \--min-backoff=30s \\  
  \--max-backoff=300s

gcloud scheduler jobs pause lisa-pending-reconciliation-trigger \--location=$LOCATION

**Verification:**

gcloud scheduler jobs describe lisa-pending-reconciliation-trigger \\  
  \--location=$LOCATION \\  
  \--format='value(state,schedule,httpTarget.uri)'

Expected: `state: PAUSED`, schedule `*/5 * * * *`, URI matching the orchestrator's reconciliation endpoint.

### **§5.5 Cloud Run service IAM (private; ingress=internal)**

gcloud run services update lisa-orchestrator \\  
  \--ingress=internal \\  
  \--region=us-central1

gcloud run services add-iam-policy-binding lisa-orchestrator \\  
  \--region=us-central1 \\  
  \--member="serviceAccount:lisa-api@${PROJECT}.iam.gserviceaccount.com" \\  
  \--role="roles/run.invoker"

### **§5.6 Secret Manager secrets**

Single canonical PII guard config secret per environment:

| Secret name | Purpose | Environments |
| ----- | ----- | ----- |
| `lisa-pii-guard-config-prod` | Production runtime PII guard config (default `enabled: true`; break-glass updates per §17) | prod |
| `lisa-pii-guard-config-staging` | Staging baseline PII guard config (default `enabled: true`); referenced by §8.3 sub-check (c) and ongoing staging operations | staging |
| `lisa-pii-guard-config-dev` | Dev environment baseline PII guard config | dev |
| `lisa-pii-guard-config-staging-test-bad` | Step 7a sub-check (a) — invalid config (no break-glass) | staging only |
| `lisa-pii-guard-config-staging-test-valid` | Step 7a sub-check (b) — valid break-glass config (test ticket \+ future expiration) | staging only |
| `lyceon-hmac-signing-key` | HMAC shared secret between 03B and 03C | All environments (separate values per env) |

**Creation:**

PROJECT="lyceon-vertex-prod"

\# Production canonical PII guard config (default: enabled)  
echo '{"pii\_guard": {"enabled": true}}' | \\  
  gcloud secrets create lisa-pii-guard-config-prod \\  
  \--data-file=- \\  
  \--project=$PROJECT \\  
  \--replication-policy=automatic

For staging-only test secrets, create in staging project:

PROJECT="lyceon-vertex-staging"

\# Staging baseline PII guard config (default: enabled) — referenced by §8.3 sub-check (c)  
echo '{"pii\_guard": {"enabled": true}}' | \\  
  gcloud secrets create lisa-pii-guard-config-staging \\  
  \--data-file=- \\  
  \--project=$PROJECT \\  
  \--replication-policy=automatic

\# Test secret (a): invalid config without break-glass  
echo '{"pii\_guard": {"enabled": false}}' | \\  
  gcloud secrets create lisa-pii-guard-config-staging-test-bad \\  
  \--data-file=- \\  
  \--project=$PROJECT \\  
  \--replication-policy=automatic

\# Test secret (b): placeholder; actual JSON populated at sub-check (b) execution time per §8.2  
gcloud secrets create lisa-pii-guard-config-staging-test-valid \\  
  \--project=$PROJECT \\  
  \--replication-policy=automatic

**Application code reads `PII_GUARD_CONFIG_JSON` environment variable.** Cloud Run mounts the secret value into this env var. Single canonical name across all environments and Step 7a sub-checks.

### **§5.7 IAM verification (V3 — RB-V3-10 wording fixed)**

After all IAM bindings \+ secrets applied, verification has TWO distinct parts: project-scoped IAM and resource-scoped IAM. Each is verified separately.

**Project-scoped IAM (4 roles expected):**

gcloud projects get-iam-policy ${PROJECT} \\  
  \--flatten="bindings\[\].members" \\  
  \--filter="bindings.members:lisa-orchestrator@${PROJECT}.iam.gserviceaccount.com" \\  
  \--format="value(bindings.role)"

Expected output: exactly 4 project-scoped roles for `lisa-orchestrator@`:

* `roles/aiplatform.user`  
* `roles/cloudsql.client`  
* `roles/logging.logWriter`  
* `roles/monitoring.metricWriter`

NO `roles/editor`, NO `roles/owner`, NO project-wide `roles/secretmanager.secretAccessor`, NO project-wide `roles/cloudtasks.enqueuer`.

**Resource-scoped IAM (verified per resource, not via project-level get-iam-policy):**

Cloud Tasks queue bindings (3 queues):

for QUEUE in lisa-compaction lisa-memory-refresh lisa-pending-reconciliation; do  
  echo "=== Queue: $QUEUE \==="  
  gcloud tasks queues get-iam-policy $QUEUE \--location=us-central1  
done

Expected per queue: `lisa-orchestrator@` listed with `roles/cloudtasks.enqueuer`. Memory worker NOT listed as enqueuer.

Secret Manager bindings (2 secrets):

for SECRET in lyceon-hmac-signing-key lisa-pii-guard-config-prod; do  
  echo "=== Secret: $SECRET \==="  
  gcloud secrets get-iam-policy $SECRET \--project=${PROJECT}  
done

Expected: `lisa-orchestrator@` listed with `roles/secretmanager.secretAccessor` on both secrets. `lisa-memory-worker@` NOT listed (worker doesn't need PII config or HMAC at V1).

Cloud Run service IAM:

gcloud run services get-iam-policy lisa-orchestrator \--region=us-central1

Expected: `lisa-cloud-tasks@` listed with `roles/run.invoker`. `lisa-api@` listed with `roles/run.invoker` (per §5.5).

**Test Matrix coverage:** §15.7 (P1 service account least-privilege audit) verifies these.

### **§5.8 Quarterly IAM audit (Q-default)**

V3 spec §12.3 requires quarterly IAM audit. Audit checklist:

\# Audit script (run quarterly)  
./scripts/audit-iam.sh ${PROJECT}

\# Expected verifications:  
\# 1\. lisa-orchestrator project-scope IAM: exactly the 4 roles in §5.2 project-scoped row  
\# 2\. lisa-orchestrator resource-scope IAM: enqueuer on each queue \+ secretAccessor on each secret  
\# 3\. lisa-memory-worker project-scope IAM: per §5.2 narrative  
\# 4\. lisa-cloud-tasks: only run.invoker on lisa-orchestrator service  
\# 5\. No new bindings added since prior audit (compare against snapshot)  
\# 6\. No service account keys exist (use Workload Identity)

If audit fails: investigate the new binding; remove if not justified; update audit baseline.

## **§6 Schema migrations (day-2 procedure)**

This section is the day-2 procedure for ALL future schema migrations affecting 03C tables, not just V3 §29.1/§29.2 (those are executed in §4 launch sequence).

### **§6.1 Migration authoring**

Every migration must:

1. Be idempotent (use `IF EXISTS` / `IF NOT EXISTS` / `DO $$ BEGIN ... END $$` blocks)  
2. Be forward-compatible (new schema works with old code; old code ignores new columns)  
3. Have an explicit rollback DDL block in the same file (commented out by default)  
4. Be reviewed by Engineering \+ Platform before deployment

### **§6.2 Migration deployment procedure**

\# 1\. Author migration file: migrations/03C-\<feature\>-\<descriptor\>.sql  
\# 2\. Review \+ approve PR  
\# 3\. Deploy to dev  
psql "$DEV\_DATABASE\_URL" \-f migrations/03C-\<file\>.sql

\# 4\. Verify dev (specific verification query per migration)

\# 5\. Deploy to staging (after dev stable)  
psql "$STAGING\_DATABASE\_URL" \-f migrations/03C-\<file\>.sql

\# 6\. Wait 24 hours; staging traffic exercises new schema  
\# 7\. Deploy to production  
psql "$PROD\_DATABASE\_URL" \-f migrations/03C-\<file\>.sql

### **§6.3 Migration failure procedure**

If migration fails partway:

1. **DO NOT manually patch the schema** to "fix" the half-applied state  
2. Re-run the migration (must be idempotent; rerun completes any missed steps)  
3. If re-run fails: investigate root cause (lock contention? insufficient disk? constraint violation on existing data?)  
4. If schema is in inconsistent state: execute the migration's rollback DDL; restart from clean state

### **§6.4 Migration rollback procedure**

**Default rollback policy:** prefer code rollback over schema rollback. Schema columns added by V3 are forward-compatible; rolling back code (revision rollback per §4 patterns \+ §4.0b traffic restoration) is the standard recovery path.

**Schema rollback prohibitions:**

**`tutor_memory_summaries.status` column drop** is **prohibited** in production after V3 traffic has begun. Detection query:

 SELECT count(\*) FROM tutor\_memory\_summaries WHERE status IN ('pending', 'failed');

*  If count \> 0: column drop requires Engineering lead approval \+ data-preservation plan.

**`tutor_vertex_context_cache.cache_kind` CHECK constraint reduction** is **prohibited** in production after any row with `cache_kind='student_composite'` exists. Detection query:

 SELECT count(\*) FROM tutor\_vertex\_context\_cache WHERE cache\_kind='student\_composite';

* 

**Conditional schema rollback (when prohibitions triggered):**

1. Engineering lead approval recorded in incident ticket  
2. Data-preservation plan documented (e.g., archive affected rows to backup table before drop)  
3. Plan reviewed \+ approved before execution  
4. Execute archival  
5. Execute schema rollback  
6. Document in lock-evidence ticket update

**Rollback execution:**

psql "$ENV\_DATABASE\_URL" \-f migrations/03C-\<file\>-rollback.sql

## **§7 Cross-doc patches (03B coordination)**

03C V3 production launch requires 03B coordination per V3 spec §29.3 \+ §32. This section documents what 03C requires from 03B and where the coordination interface lives.

### **§7.1 03B envelope-builder hotfix (required for V3 launch)**

**What 03B must change:**

* Envelope-builder query that reads `tutor_memory_summaries` MUST add filter `WHERE status = 'ready'`  
* Without this filter, 03B reads `pending` rows (created by V2.0 placeholder-then-fill pattern) which have empty content; tutor receives degraded prompts

**Coordination:** §4.5/§4.6 deploys this hotfix BEFORE 03C V3 ramp begins. LISA team owns the 03B-side change.

**Test verification:** Test Matrix V1.1 §18.7 (deploy-script preflight ordering enforcement).

### **§7.2 03B V5 §18 error registry expansion (required for V3 launch)**

**What 03B must change:** 03B error registry must register V3 error codes so that 03B-side handling translates 03C errors correctly:

| Code | 03B handling |
| ----- | ----- |
| `pii_in_envelope` | HTTP 500 to client; do not retry; alert ops |
| `streaming_chunk_gate_blocked` | Already handled per V2.2 §16; no new behavior |
| `streaming_anti_leak_cascade` | Serve safe-hint reply per Doc 03B V4.1 §16 |
| `client_scope_override_attempted` | HTTP 500 to client; do not retry; alert privacy on-call |

**Coordination:** §4.5/§4.6 deploys this with the envelope-builder hotfix.

**If 03B V5 not yet shipped:** acceptable to ship a forward-compat addendum to 03B V4.1 that registers these codes; full V5 absorption can come later.

### **§7.3 03B V5 §16 anti-leak coordination**

**What 03B must change:** 03B's full-response anti-leak per Doc 03B V4.1 §16 must coordinate with 03C V3 §7.4.9 chunk gate cascade semantics. Specifically: when 03C emits `streaming_anti_leak_cascade` error event, 03B serves a safe-hint reply to the student.

**Coordination:** Documented in V3 spec §7.4.9 cross-doc coordination paragraph. 03B-side test ownership; 03C tests verify the 03C-side emission only.

**Note:** This is design coordination, not a hotfix. 03B V4.1 already supports the safe-hint reply path. V5 makes it explicit.

## **§8 Step 7a break-glass config validation procedure**

This is the §29.3 step 7a sub-procedure. Three sub-checks; ALL must pass; ANY failure halts deployment.

### **§8.0 Pre-test secret provisioning**

The dedicated staging-only test secrets must be provisioned during pre-launch infrastructure setup (§3.5 / §5.6). They are NOT created at test execution time. This avoids polluting production project with throwaway secret versions and ensures test inputs are auditable.

Pre-provisioned in staging:

* `lisa-pii-guard-config-staging-test-bad` — content `{"pii_guard": {"enabled": false}}` (invalid; missing break-glass)  
* `lisa-pii-guard-config-staging-test-valid` — content updated at sub-check (b) execution time with current 3.5-hour future expiration

### **§8.1 Sub-check (a) — production-style boot rejects invalid config**

**Action:**

PROJECT="lyceon-vertex-staging"  
REGION="us-central1"  
SERVICE="lisa-orchestrator"

gcloud run deploy ${SERVICE} \\  
  \--image=gcr.io/${PROJECT}/lisa-orchestrator:v3.0.0 \\  
  \--region=${REGION} \\  
  \--no-traffic \\  
  \--tag=v3-step7a-bad-a \\  
  \--set-env-vars="LISA\_ENV=production" \\  
  \--update-secrets="PII\_GUARD\_CONFIG\_JSON=lisa-pii-guard-config-staging-test-bad:latest"

\# Capture the actual revision name created by this deploy (per §4.0b extraction pattern)  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "./deploy-evidence/step7a-bad-a-after-deploy.json"

BAD\_A\_REVISION=$(jq \-r '.status.traffic\[\] | select(.tag \== "v3-step7a-bad-a") | .revisionName' \\  
  "./deploy-evidence/step7a-bad-a-after-deploy.json")

\# Wait for revision to attempt boot  
sleep 60

\# Check revision status  
gcloud run revisions describe ${BAD\_A\_REVISION} \\  
  \--region=${REGION} \\  
  \--format='value(status.conditions\[?type==\`Ready\`\].status,status.conditions\[?type==\`Ready\`\].message)'

**Expected result:** Revision shows `Ready: False` with message containing `CONFIG ERROR: pii_guard.enabled=false requires pii_guard.break_glass_ticket_id in production`.

**Pass criterion:** Revision boot fails with the expected error message.

**Falsifies if:** Revision boots successfully (Ready: True) — this means V3 break-glass guard is broken; HALT deployment sequence.

**Evidence to capture:** Per §4.0a template; full revision describe output; Cloud Run logs showing boot failure with config error.

### **§8.2 Sub-check (b) — production-style boot accepts valid break-glass**

**Action:**

PROJECT="lyceon-vertex-staging"  
REGION="us-central1"  
SERVICE="lisa-orchestrator"

\# Generate ticket \+ expiration JSON  
TICKET\_ID=$(uuidgen)  
EXPIRES\_AT=$(date \-u \-d '+3.5 hours' '+%Y-%m-%dT%H:%M:%SZ')

\# Update the pre-provisioned valid-config secret with current expiration  
echo "{  
  \\"pii\_guard\\": {  
    \\"enabled\\": false,  
    \\"break\_glass\_ticket\_id\\": \\"${TICKET\_ID}\\",  
    \\"break\_glass\_expires\_at\\": \\"${EXPIRES\_AT}\\"  
  }  
}" | gcloud secrets versions add lisa-pii-guard-config-staging-test-valid \--data-file=- \--project=${PROJECT}

\# Deploy revision with valid break-glass config  
gcloud run deploy ${SERVICE} \\  
  \--image=gcr.io/${PROJECT}/lisa-orchestrator:v3.0.0 \\  
  \--region=${REGION} \\  
  \--no-traffic \\  
  \--tag=v3-step7a-good-b \\  
  \--set-env-vars="LISA\_ENV=production" \\  
  \--update-secrets="PII\_GUARD\_CONFIG\_JSON=lisa-pii-guard-config-staging-test-valid:latest"

\# Capture revision name (per §4.0b)  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "./deploy-evidence/step7a-good-b-after-deploy.json"

GOOD\_B\_REVISION=$(jq \-r '.status.traffic\[\] | select(.tag \== "v3-step7a-good-b") | .revisionName' \\  
  "./deploy-evidence/step7a-good-b-after-deploy.json")

sleep 60

\# Check revision status (expected: Ready: True)  
gcloud run revisions describe ${GOOD\_B\_REVISION} \\  
  \--region=${REGION} \\  
  \--format='value(status.conditions\[?type==\`Ready\`\].status)'

**Expected result:** Revision boots successfully (`Ready: True`).

Verify break-glass log event:

gcloud logging read \\  
  "resource.type=cloud\_run\_revision AND resource.labels.revision\_name=${GOOD\_B\_REVISION} AND jsonPayload.event=pii\_guard\_break\_glass\_active\_at\_startup" \\  
  \--limit=1 \--format=json

**Expected:** One log event with `ticket_id=${TICKET_ID}`, `expires_at=${EXPIRES_AT}`.

Verify PagerDuty page received (manual confirmation):

* Wait up to 2 minutes  
* Confirm primary on-call PagerDuty receives a page tagged `pii_guard_break_glass_active_at_startup`

**Pass criterion:** All three signals present (boot success \+ log event \+ PagerDuty page).

**Falsifies if:** Boot fails OR log event missing OR PagerDuty page not received within 2 minutes.

**Evidence to capture:** Per §4.0a template; revision describe output; log event JSON; PagerDuty page screenshot or incident link.

### **§8.3 Sub-check (c) — production-style boot under default config**

**Action:**

PROJECT="lyceon-vertex-staging"  
REGION="us-central1"  
SERVICE="lisa-orchestrator"

\# Deploy revision with default config (uses staging-default secret behavior)  
gcloud run deploy ${SERVICE} \\  
  \--image=gcr.io/${PROJECT}/lisa-orchestrator:v3.0.0 \\  
  \--region=${REGION} \\  
  \--no-traffic \\  
  \--tag=v3-step7a-default-c \\  
  \--set-env-vars="LISA\_ENV=production" \\  
  \--update-secrets="PII\_GUARD\_CONFIG\_JSON=lisa-pii-guard-config-staging:latest"

\# Capture revision name (per §4.0b)  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "./deploy-evidence/step7a-default-c-after-deploy.json"

DEFAULT\_C\_REVISION=$(jq \-r '.status.traffic\[\] | select(.tag \== "v3-step7a-default-c") | .revisionName' \\  
  "./deploy-evidence/step7a-default-c-after-deploy.json")

sleep 60

\# Check revision status  
gcloud run revisions describe ${DEFAULT\_C\_REVISION} \\  
  \--region=${REGION} \\  
  \--format='value(status.conditions\[?type==\`Ready\`\].status)'

\# Verify NO break-glass log event  
gcloud logging read \\  
  "resource.type=cloud\_run\_revision AND resource.labels.revision\_name=${DEFAULT\_C\_REVISION} AND jsonPayload.event=pii\_guard\_break\_glass\_active\_at\_startup" \\  
  \--limit=1 \--format=json

**Expected:** Revision boots successfully; no break-glass log event.

**Pass criterion:** Boot success AND no break-glass event AND no PagerDuty page.

**Falsifies if:** Boot fails OR break-glass event present (would mean PII guard config broken in default state).

**Evidence to capture:** Per §4.0a template; revision describe; log query result (empty).

### **§8.4 Cleanup**

After all three sub-checks complete:

\# Delete test revisions (cost optimization)  
for REV in $BAD\_A\_REVISION $GOOD\_B\_REVISION $DEFAULT\_C\_REVISION; do  
  if \[ \-n "$REV" \]; then  
    gcloud run revisions delete $REV \--region=us-central1 \--quiet  
  fi  
done

\# Note: pre-provisioned test secrets are NOT deleted; they're reusable for future Step 7a runs

### **§8.5 Exit criteria**

Step 7a passes if all three sub-checks pass. Document the test results in the deployment ticket. Then proceed to Step 8\.

If ANY sub-check fails: HALT deployment. File engineering investigation ticket. Do not proceed to Step 8 until V3 break-glass code path is verified.

---

# **Part III — Day-2 Operations**

**Section numbering note:** §9 (canary \+ ramp procedure) and §10 (rollback procedures) from initial outline were absorbed into §4 (V3 §29.3 deployment sequence) where each step has its own canary mechanics \+ §4.0b pre-shift traffic capture pattern \+ step-specific rollback. Part III therefore begins at §11.

## **§11 Configuration management**

V3 spec §30 lists all runtime config keys. V3 spec §31.5 defines the table schema. This section is the procedure for changing config values without deploying new code.

### **§11.1 Runtime config storage**

V3 spec uses Postgres table `tutor_context_runtime_config` for runtime-mutable config. Schema per V3 spec §31.5:

\-- Authoritative schema (per V3 spec §31.5)  
CREATE TABLE tutor\_context\_runtime\_config (  
  config\_key TEXT NOT NULL,  
  environment TEXT NOT NULL,                            \-- 'production' | 'staging' | 'development'  
  config\_value JSONB NOT NULL,                          \-- string, number, boolean, or object  
  updated\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  updated\_by TEXT,  
  PRIMARY KEY (config\_key, environment)  
);

Each Cloud Run instance subscribes to LISTEN/NOTIFY on channel `runtime_config_updated`; updates propagate within \~1s of the NOTIFY.

### **§11.2 Updating a config key**

\# Connect to production DB  
psql "$PROD\_DATABASE\_URL"

\-- Example: change vertex.pro\_budget\_circuit\_breaker.daily\_cap\_usd in production  
BEGIN;

UPDATE tutor\_context\_runtime\_config  
SET config\_value \= '500'::jsonb,  
    updated\_at \= now(),  
    updated\_by \= 'ops@lyceon.example'  
WHERE config\_key \= 'vertex.pro\_budget\_circuit\_breaker.daily\_cap\_usd'  
  AND environment \= 'production';

\-- Trigger NOTIFY on V3-canonical channel name  
NOTIFY runtime\_config\_updated, 'vertex.pro\_budget\_circuit\_breaker.daily\_cap\_usd';

COMMIT;

### **§11.3 Verifying propagation (V3 — RB-V3-08 strengthened V3.x flag)**

V3 spec does not currently define a `runtime_config_reloaded` log event. V2 referenced this event; V3 maintains the V2 fix (no fabricated event reference) and re-frames verification:

After update:

sleep 5  \# wait for NOTIFY propagation across all instances

Verify config-reload behavior via behavior-side check: trigger an action that depends on the new config value and observe the new behavior.

For `vertex.pro_budget_circuit_breaker.daily_cap_usd`, the verification is:

* Force a Vertex call that would trigger the breaker; verify breaker fires at the new cap (not the old cap)  
* OR query the in-process config via a debug endpoint (if one exists; behavior-side endpoint required for V4 runbook to add a more direct verification)

**V3.x near-term requirement (V3 — RB-V3-08 strengthened from "consideration" to "near-term requirement"):** spec a `runtime_config_reloaded` log event in V3.x §30 that emits per Cloud Run instance on each config reload. Rationale: behavior-side verification is acceptable for draft-quality ops but not robust at scale — operators can't quickly confirm config propagation after every change without invoking real Vertex calls. A simple structured log event (`{"event": "runtime_config_reloaded", "config_key": "...", "config_value_hash": "..."}`) would let `gcloud logging read` directly verify NOTIFY propagation across all running instances. This requires a V3.x spec change; V3 runbook flags it as near-term but does not implement.

### **§11.4 Audit trail**

\-- View last 10 config changes for production  
SELECT config\_key, config\_value, updated\_at, updated\_by  
FROM tutor\_context\_runtime\_config  
WHERE environment \= 'production'  
ORDER BY updated\_at DESC  
LIMIT 10;

### **§11.5 Config keys NOT changeable at runtime**

Some keys require Cloud Run revision redeploy (build-time config). Per V3 spec §30.5:

* `LISA_ENV` (production/staging/dev)  
* Service account bindings  
* Vertex SDK version  
* DB connection string

Changes to these require §6 migration procedure or new revision deployment.

### **§11.6 Operationally-mutable config schema**

This table summarizes the JSONB shape expected per operationally-mutable key. Use this to construct correct UPDATE statements; mismatched JSONB shapes cause runtime errors.

| Config key | JSONB type | Example | Default | Notes |
| ----- | ----- | ----- | ----- | ----- |
| `vertex.pro_budget_circuit_breaker.daily_cap_usd` | number | `500` | (per §3.10) | Integer or float USD cents-precision optional |
| `vertex.pro_budget_circuit_breaker.active` | boolean | `false` | `false` | Auto-set by breaker; manual override emergency only |
| `vertex.streaming` | object | `{"enabled": false}` | `{"enabled": false}` | Object form; future fields per V3 spec §30.1 |
| `vertex.model.flash_class_alias` | string | `"gemini-2.5-flash"` | (per V3 spec §30.1) | Alias indirection per V3 spec §5.2 |
| `vertex.model.pro_class_alias` | string | `"gemini-2.5-pro"` | (per V3 spec §30.1) | Alias indirection per V3 spec §5.2 |
| `pii_guard.warn_severity_blocks` | boolean | `false` | `false` | Emergency tightening flag per V3 spec §4.2.2 |
| `cloud_tasks.lisa-memory-refresh.max_dispatches_per_second` | number | `50` | `50` | Adjust for bulk-refresh per §13 (when available) |

**V3.x consideration (flagged):** add a runtime config validation function that rejects mismatched JSONB shapes at write time:

\-- Example: spec'd in V3.x  
SELECT validate\_runtime\_config\_key(config\_key, config\_value);  
\-- Returns true if value matches expected shape for key; raises exception otherwise

This is a V3.x spec change; V3 runbook flags it but does not implement.

## **§12 Streaming enablement post-launch (deferred per F-V3-17)**

This procedure runs **only after V1 launch is stable for ≥30 days**.

### **§12.1 Prerequisites**

1. 30 days of stable sync-mode production traffic (no SEV-2 incidents in trailing 14 days)  
2. Chunk gate SLI dashboards live (V3 spec §11.2 streaming SLIs visible in Cloud Monitoring)  
3. Karl \+ engineering approve streaming launch  
4. 03B V5 anti-leak coordination per V3 spec §32.6 deployed (full-response anti-leak coordinates with chunk gate cascade)

### **§12.2 Pre-flight**

Verify chunk gate SLIs are wired:

gcloud monitoring metrics-descriptors describe \\  
  \--metric-type=custom.googleapis.com/orchestrator\_streaming\_chunk\_gate\_hit\_total

Verify alert policies:

* `orchestrator_streaming_anti_leak_cascade_total` PAGE alert wired  
* `orchestrator_streaming_chunks_blocked_total` rate\>1% alert wired

### **§12.3 Canary streaming enablement**

Streaming enablement is a runtime config flip per §11. Use canary percentage approach:

\-- Step 1: enable streaming for 5% of users (production)  
BEGIN;

UPDATE tutor\_context\_runtime\_config  
SET config\_value \= '{  
    "enabled": true,  
    "rollout\_percent": 5,  
    "rollout\_seed": "v3-streaming-canary"  
  }'::jsonb,  
  updated\_at \= now(),  
  updated\_by \= 'ops@lyceon.example'  
WHERE config\_key \= 'vertex.streaming'  
  AND environment \= 'production';

NOTIFY runtime\_config\_updated, 'vertex.streaming';

COMMIT;

(V3 spec must support `rollout_percent` config; verify implementation before §12.3.)

### **§12.4 Monitoring during canary**

Watch these SLIs for 4 hours:

* `orchestrator_streaming_first_chunk_latency_p95` (target: \<2s)  
* `orchestrator_streaming_total_duration_p95` (target: \<10s)  
* `orchestrator_streaming_chunk_gate_hit_total{severity='block'}` (target: rate \<1% of streaming turns)  
* `orchestrator_streaming_anti_leak_cascade_total` (target: 0; PAGE if any)  
* `orchestrator_turn_success_rate` overall (must not regress vs sync-only baseline)

### **§12.5 Ramp**

If canary stable for 4 hours:

* Move to 25% rollout (4-hour observation)  
* Move to 50% rollout (4-hour observation)  
* Move to 100% rollout (24-hour observation)

### **§12.6 Rollback**

If any SLI degrades:

BEGIN;

UPDATE tutor\_context\_runtime\_config  
SET config\_value \= '{"enabled": false}'::jsonb,  
    updated\_at \= now(),  
    updated\_by \= 'ops@lyceon.example (rollback)'  
WHERE config\_key \= 'vertex.streaming'  
  AND environment \= 'production';

NOTIFY runtime\_config\_updated, 'vertex.streaming';

COMMIT;

Rollback is immediate (\~5 seconds for NOTIFY propagation).

## **§13 Bulk memory refresh — NOT AVAILABLE AT V1 LAUNCH**

**V1 launch posture:** bulk memory refresh as an operational procedure is NOT supported. V1 does not include the engineering prerequisite (an admin script for bulk-batched refresh tasks). This section documents the engineering prerequisite and the procedure that becomes available once it ships.

### **§13.1 Engineering prerequisite**

Bulk refresh requires:

1. Admin script `scripts/lisa/enqueue-memory-refresh.ts` that batches refresh tasks via Cloud Tasks API directly (NOT via `pg_notify` from a SELECT — that pattern is fragile and was incorrectly proposed in V1)  
2. Test Matrix coverage proving the script produces correct task payloads \+ idempotency under concurrent invocation  
3. Cloud Tasks queue rate-limit tuning runbook (the `gcloud tasks queues update` command in §13.3, which is operationally simple but depends on the batched enqueue mechanism existing)  
4. SLI: `bulk_refresh_in_progress` (gauge; on/off) so monitoring can distinguish bulk-mode from steady-state refresh

### **§13.2 V1 launch alternative**

For V1 launch, if a bulk refresh becomes operationally necessary (e.g., teaching\_profile schema change), the procedure is:

1. Engineering authors a one-off migration script  
2. Migration is reviewed via §6 procedure  
3. Migration includes data-update logic that does not depend on Vertex calls (e.g., reset `summary_version` so MemoryRefreshWorker picks up the affected rows on its normal schedule)  
4. The standard MemoryRefreshWorker handles the actual regeneration over time per its rate limits

This avoids the need for a "bulk refresh" operational mode at V1.

### **§13.3 Bulk refresh procedure (when prerequisite ships — V4 runbook absorbs)**

When the engineering prerequisite ships, this section is updated with the executable procedure:

1. Verify `scripts/lisa/enqueue-memory-refresh.ts` is present \+ tested

Temporarily raise rate limit:  
 gcloud tasks queues update lisa-memory-refresh \\  \--location=us-central1 \\  \--max-dispatches-per-second=200

2. 

Run the admin script:  
 ./scripts/lisa/enqueue-memory-refresh.ts \\  \--filter="last\_teaching\_profile\_prompt\_version\<v2.0" \\  \--batch-size=100 \\  \--dry-run=false

3.   
4. Monitor via SLIs (per §13.4 below)

Reset rate limit when complete:  
 gcloud tasks queues update lisa-memory-refresh \\  \--location=us-central1 \\  \--max-dispatches-per-second=50

5. 

### **§13.4 Bulk refresh monitoring (when available)**

SLIs to watch:

* `cloud_tasks_queue_depth{queue='lisa-memory-refresh'}` — should drain over time  
* `async_job_success_rate{job_type='memory_refresh'}` (target \>95%)  
* `memory_refresh_pending_window_p95` (should not exceed 10 min)  
* `vertex_call_5xx_rate` (watch for Vertex throttling)  
* `bulk_refresh_in_progress` (1 during bulk mode; should be 0 in steady state)

### **§13.5 Cost considerations**

Bulk refresh of 100k students × \~1500 input tokens × Flash pricing ≈ $30-50 USD. Karl approval before initiating bulk refresh of \>10k students; coordinate with §3.10 budget.

## **§14 HMAC key rotation (V3 — RB-V3-07 ROTATION\_TAG variable)**

Per V3 spec §9.4 \+ 01A Part VII. Rotation is required:

* On schedule (annual minimum per 01A §65)  
* On suspected compromise (immediate per 01A §66)

### **§14.1 Procedure**

**Important traffic implication:** `gcloud run services update --update-secrets=...` triggers a new Cloud Run revision deploy. Treat this as a small revision deploy with the same traffic implications as §4.7 (canary) but for a config-only change. Schedule rotation during low-traffic windows and use the §4 ramp pattern if traffic is high.

**Step 0: set rotation variables once at procedure start (V3 — RB-V3-07)**

\# Pin rotation tag to UTC date once; reference everywhere  
ROTATION\_TAG="hmac-rotation-$(date \-u \+%Y%m%d)"  
PROJECT="lyceon-vertex-prod"  
REGION="us-central1"  
SERVICE="lisa-orchestrator"

echo "Rotation tag: ${ROTATION\_TAG}"

**Step 1: generate new key**

NEW\_KEY=$(openssl rand \-base64 32\)

\# Add as new Secret Manager version  
echo \-n "$NEW\_KEY" | gcloud secrets versions add lyceon-hmac-signing-key \--data-file=-

**Step 2: capture pre-shift traffic state per §4.0b**

mkdir \-p ./deploy-evidence  
TRAFFIC\_BEFORE\_FILE="./deploy-evidence/traffic-before-${ROTATION\_TAG}-$(date \-u \+%Y%m%dT%H%M%SZ).json"  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "${TRAFFIC\_BEFORE\_FILE}"

**Step 3: deploy 03C with new secret version (triggers new revision)**

gcloud run deploy ${SERVICE} \\  
  \--image=gcr.io/${PROJECT}/lisa-orchestrator:CURRENT\_VERSION \\  
  \--region=${REGION} \\  
  \--no-traffic \\  
  \--tag=${ROTATION\_TAG} \\  
  \--update-secrets="HMAC\_SIGNING\_KEY=lyceon-hmac-signing-key:latest"

\# Capture revision name (per §4.0b extraction pattern)  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "./deploy-evidence/${ROTATION\_TAG}-after-deploy.json"

NEW\_REVISION=$(jq \-r \--arg tag "${ROTATION\_TAG}" \\  
  '.status.traffic\[\] | select(.tag \== $tag) | .revisionName' \\  
  "./deploy-evidence/${ROTATION\_TAG}-after-deploy.json")  
echo "Rotation revision: ${NEW\_REVISION}"

\# Verify health endpoint before traffic shift (V3 §28B.4 readiness gate)  
ROTATION\_URL=$(jq \-r \--arg tag "${ROTATION\_TAG}" \\  
  '.status.traffic\[\] | select(.tag \== $tag) | .url' \\  
  "./deploy-evidence/${ROTATION\_TAG}-after-deploy.json")  
curl \-f "${ROTATION\_URL}/health" || { echo "Health check failed; aborting traffic shift"; exit 1; }

\# Wait for ready, then ramp using §4 patterns  
sleep 60  
gcloud run services update-traffic ${SERVICE} \\  
  \--to-tags=${ROTATION\_TAG}=10 \--region=${REGION}

\# Monitor hmac\_auth\_failure\_rate for 15 minutes; if stable, ramp to 100%  
gcloud run services update-traffic ${SERVICE} \\  
  \--to-tags=${ROTATION\_TAG}=100 \--region=${REGION}

**LISA team coordination:** rotates 03B's pinned secret version simultaneously per their standard procedure.

**Step 4: 14-day overlap window (per 01A §65)**

During overlap, both old and new keys are valid for verification. 03C reads BOTH versions:

* Sign outgoing requests with new key  
* Verify incoming requests against {new, old} key set

After 14 days, old key version is revoked.

**Step 5: monitor `hmac_auth_failure_rate`**

Expected: brief spike during rotation (\<1% for \~5 minutes as instances roll over). Sustained elevated rate (\>1% for \>10 minutes) indicates rotation failure.

gcloud monitoring time-series list \\  
  \--filter='metric.type="custom.googleapis.com/hmac\_auth\_failure\_rate"' \\  
  \--interval-end-time=$(date \-u \+%Y-%m-%dT%H:%M:%SZ) \\  
  \--interval-start-time=$(date \-u \-d '-1 hour' \+%Y-%m-%dT%H:%M:%SZ)

**Rollback if any of Step 3 sub-steps fails:** Per §4.0b — restore traffic from `${TRAFFIC_BEFORE_FILE}`:

TO\_REVISIONS=$(jq \-r '  
  \[.status.traffic\[\]  
    | select(.revisionName \!= null and .percent \!= null and .percent \> 0\)  
    | "\\(.revisionName)=\\(.percent)"\]  
  | join(",")  
' "${TRAFFIC\_BEFORE\_FILE}")

gcloud run services update-traffic ${SERVICE} \\  
  \--to-revisions=${TO\_REVISIONS} \\  
  \--region=${REGION}

**Step 6: revoke old key after 14 days**

gcloud secrets versions list lyceon-hmac-signing-key

\# Disable old version (after 14 days)  
gcloud secrets versions disable \<OLD\_VERSION\_NUMBER\> \\  
  \--secret=lyceon-hmac-signing-key

### **§14.2 Emergency rotation (suspected compromise)**

If compromise suspected:

1. Generate new key \+ deploy (Steps 0-3 above with same `ROTATION_TAG` variable)  
2. **Skip overlap window**: immediately disable old version  
3. Accept that in-flight requests signed with old key will fail (\~10-20s of failures)  
4. File security incident ticket  
5. Audit logs for unauthorized requests in the period the old key was active

\# Emergency revoke (skip overlap)  
gcloud secrets versions disable \<OLD\_VERSION\> \--secret=lyceon-hmac-signing-key

### **§14.3 Vertex API key rotation**

Vertex uses Application Default Credentials via service account; there are NO Vertex API keys to rotate. If Vertex compromise is suspected, rotate the Cloud Run service account itself (separate procedure, contact GCP support).

## **§15 Stuck advisory lock recovery**

V3 spec §VIII mentions advisory lock chaos scenarios. This procedure recovers from a stuck per-student advisory lock.

### **§15.1 Detection**

Symptoms:

* `memory_refresh_pending_window_p95` exceeds 10 minutes for a specific student  
* `async_job_success_rate{job_type=memory_refresh}` drops for that student's tasks  
* Manual: student-facing report of stale teaching\_profile

### **§15.2 Diagnosis**

psql "$PROD\_DATABASE\_URL"

\-- Find advisory locks held by lisa-memory-worker connections  
SELECT  
  pid,  
  usename,  
  application\_name,  
  state,  
  state\_change,  
  query  
FROM pg\_stat\_activity  
WHERE application\_name LIKE 'lisa-memory-worker%'  
  AND state IN ('idle in transaction', 'idle');

\-- Find specific advisory locks  
SELECT  
  locktype,  
  classid,  
  objid,  
  pid,  
  granted  
FROM pg\_locks  
WHERE locktype \= 'advisory';

### **§15.3 Recovery procedure**

**If lock is held by an active query:** wait for completion (do not kill).

**If lock is held by an idle connection (\>5 minutes idle, no active query):** the worker likely crashed without releasing the lock. Two options:

**Option A: terminate the holding connection** (lock released automatically):

SELECT pg\_terminate\_backend(\<PID\>);

**Option B: explicit advisory unlock** (if PID is known but connection cannot be terminated):

SELECT pg\_advisory\_unlock(\<classid\>, \<objid\>);

(Note: `pg_advisory_unlock` only works from the same session that acquired the lock, so Option A is usually the correct path.)

### **§15.4 Verification**

SELECT count(\*) FROM pg\_locks WHERE locktype \= 'advisory';

Then verify reconciliation worker picks up the abandoned `pending` row:

SELECT student\_id, summary\_type, status, updated\_at  
FROM tutor\_memory\_summaries  
WHERE status \= 'pending' AND updated\_at \< now() \- interval '10 minutes';

The pending-reconciliation sweep (every 5 minutes per §4.10) will mark these `failed` and re-enqueue.

### **§15.5 Root cause investigation**

Stuck advisory locks indicate worker crash without graceful shutdown. Investigate:

* Cloud Run instance crash logs (`cloud_run_instance_crash_rate` SLI)  
* SIGTERM handling in `lisa-memory-worker` (per V3 spec §28B.5)  
* Memory exhaustion (worker OOM)

Document findings in V4 runbook absorption ticket.

---

# **Part IV — Minimal Incident Response**

Per Karl Q2 lock: V1 covers PII guard break-glass \+ Pro→Flash circuit breaker only. All other incident response procedures defer to V4 runbook (post-launch absorption based on real production incidents).

## **§16 Incident classification \+ on-call triage**

### **§16.1 SEV definitions (mapped to V3 spec §28 thresholds)**

V3 spec §28 uses "PAGE" and "WARN" alert severities. V3 runbook maps these to SEV tiers operationally:

| SEV | V3 spec §28 mapping | Trigger examples | Response time target |
| ----- | ----- | ----- | ----- |
| **SEV-1** | (Reserved; no §28 entry directly) | PII guard bypass without authorization (e.g., production runs with `pii_guard.enabled=false` and no valid break-glass ticket); evidence of canonical safety-invariant violation | Immediate page; ack within 15 min any time; no business-hours grace |
| **SEV-2** | All §28 PAGE entries (including §28.1, §28.2, §28.7, §28.8) | Sustained Vertex outage (\>15 min); PII guard PAGE alerts (§28.7); configuration boot failures (§28.8); cost-runaway-with-anomaly composite policy fires | 15 min business hours; 30 min after-hours |
| **SEV-3** | All §28 WARN entries | Degraded but functional (elevated fallback rate, elevated PII guard block rate, elevated cache miss rate, elevated cold-start latency) | 1 business day |
| **(no SEV / informational)** | Cloud Run scaling events, normal-rate metric changes | Single warn-level alert that's expected operational behavior | No immediate action |

**Mapping rationale:**

* §28 PAGE alerts are operationally significant; SEV-2 is the appropriate default  
* SEV-1 is reserved for safety-invariant violations that the §28 matrix doesn't catch directly (e.g., a deployed-but-not-via-break-glass PII guard disabled state would fire §28.7 alerts but the underlying cause — bypass — is SEV-1)  
* §28 WARN alerts are informational and SEV-3 by default

### **§16.2 V1 triage decision tree**

When PagerDuty fires:

1. **Acknowledge the page** (don't let it escalate)  
2. **Identify alert source** (which SLI? Which §28 entry?)  
3. **Classify SEV** per §16.1  
4. **Match to V1 procedure:**  
   * If alert is `pii_guard_disabled_turns_total` or `pii_guard_break_glass_active_at_startup`: see §17  
   * If alert is `vertex_pro_budget_circuit_breaker_active`: see §18  
   * If alert is anything else: see §16.3 V1 fallback  
5. **Execute procedure**  
6. **Post-incident:** file ticket; if procedure was insufficient, escalate to V4 runbook authoring

### **§16.3 V1 fallback for non-§17/§18 incidents**

For SEV-2+ alerts NOT covered by §17 or §18 (V1 minimal scope), the V1 fallback is:

1. **Acknowledge \+ investigate**: review Cloud Run logs, recent deployments, GCP status page  
2. **Triage**:  
   * If recent deploy: consider rollback per §4 step-specific rollback procedures (using §4.0b pattern)  
   * If GCP outage: monitor; document RTO impact  
   * If unknown root cause: escalate to Karl \+ engineering  
3. **Mitigate if possible** (e.g., disable a misbehaving feature via runtime config per §11)  
4. **Document**: open V4 runbook authoring ticket with incident detail; this becomes a V4 runbook section

V1's intent: get through V1 launch without comprehensive incident playbooks. As real incidents happen, V4 runbook absorbs the procedures.

### **§16.4 Escalation tree (V1 default — flag for review)**

| Tier | Person | Trigger |
| ----- | ----- | ----- |
| Tier 1 | Primary on-call (rotating among engineering team) | Any PagerDuty page |
| Tier 2 | Engineering lead | If Tier 1 unable to ack within 15 min OR procedure unclear |
| Tier 3 | Karl | If Tier 2 unable to resolve within 1 hour OR business decision required |

V1 default: Karl is final escalation. Flag for review when team scales beyond \~5 engineers.

## **§17 PII guard break-glass procedure (authoritative; V3 — RB-V3-02 \+ RB-V3-03 \+ RB-V3-04 \+ RB-V3-12 \+ RB-V3-13)**

Per V3 spec §30.7.1: this section is the authoritative operational detail for the break-glass procedure.

### **§17.0 Operational policy**

**Break-glass is a privacy emergency state, not a routine operational valve.** For Lyceon's minor-facing tutor product, full PII guard disable in production carries real privacy risk. The procedure below treats it as last resort only.

**Posture (V3 — RB-V3-04):** prefer targeted pattern fix, scoped suppression, or rollback over 100% break-glass. Break-glass exists because, in some failure modes, none of those options is fast enough — but every break-glass invocation should be accompanied by a parallel effort to ship one of the preferred remediations.

**What break-glass disables:** PII guard's blocking action. Per V3 spec §4.2.2, when break-glass is active:

* **Pattern detection continues running** (regex matches still fire; SLI `orchestrator_pii_pattern_hit_total` continues incrementing)  
* **Blocking is suppressed** (turns proceed to Vertex even when patterns match)  
* **Matched values are NEVER logged** (the redaction discipline in V3 spec §4.2.2 logs only `pattern_name`, `severity`, `callsite` — never the matched substring)  
* **Per-turn paging fires** for every disabled-mode turn (so observability remains intact, until snoozed per §17.4)

**What break-glass does NOT do:**

* It does not stop logging  
* It does not alter the SLI catalog  
* It does not lower severity from PAGE to WARN  
* It does NOT snooze SEV-1 privacy bypass alerts (those remain active throughout)

**Karl-required approval thresholds:**

| Rollout level | Approval required |
| ----- | ----- |
| 0% deploy \+ verification | Platform engineering on-call |
| 5% canary (initial monitoring window) | Platform engineering on-call |
| \>5% rollout | Karl |
| 100% rollout | Karl \+ 5 hard preconditions per §17.5 \+ explicit privacy-risk acceptance recorded in incident ticket |

**For V3.x consideration (flagged):** the underlying architecture currently supports only "block" or "disabled-block" modes. A "monitor-only" mode (pattern detection emits SLIs \+ WARN alerts but never blocks) would be a safer break-glass primitive than today's binary block/disabled. This requires a V3.x spec change to introduce a third mode (e.g., `pii_guard.mode = 'block' | 'monitor' | 'disabled'`) and is NOT in V3 runbook scope.

### **§17.1 When to use break-glass**

Break-glass is appropriate when ALL of the following hold:

1. **Demonstrated false-positive harm:** PII guard is blocking legitimate traffic at a rate harming users (\>1% of turns blocked, OR a specific high-priority feature blocked)  
2. **Pattern fix not immediate:** the fix (relaxing a regex, adjusting contextual matrix) requires \>1 hour to author \+ test \+ deploy  
3. **Operational relief is needed:** waiting for the pattern fix would cause unacceptable user impact  
4. **Reverting is the worse option:** rolling back to a prior 03C version would lose other safety features

Break-glass is NOT appropriate for:

* Routine debugging (use staging instead)  
* General PII guard inconvenience (file a ticket; ship a pattern fix the normal way)  
* Anything that can wait until next business day  
* Suppressing alerts (PagerDuty fatigue is not justification)

### **§17.2 Pre-checks before invoking**

Before generating break-glass ticket:

1. **Confirm rate**: query `orchestrator_pii_blocked_turns_total` to verify high block rate  
2. **Sample blocked content**: review (without surfacing PII) which patterns are firing — is it a known false-positive class?  
3. **Estimate fix time**: can a pattern fix ship in \<1 hour? If yes, do that instead; skip break-glass  
4. **Get approval**: per §17.0 thresholds — initial 0% deploy \+ 5% canary requires platform engineering on-call approval; \>5% requires Karl  
5. **Coordinate**: notify privacy on-call channel of break-glass plan \+ expected duration  
6. **Confirm PagerDuty alert policy resource name is captured** in lock-evidence ticket (per §3.6 RB-V3-11) — needed for snooze command in §17.4

### **§17.3 Generate break-glass ticket**

TICKET\_ID=$(uuidgen)  
EXPIRES\_AT=$(date \-u \-d '+3.5 hours' '+%Y-%m-%dT%H:%M:%SZ')  
echo "Break-glass ticket: $TICKET\_ID"  
echo "Expires at: $EXPIRES\_AT"

\# Document in incident ticket:  
\# \- Why break-glass is needed (rate, sample patterns, estimated fix time)  
\# \- Who approved (platform engineering on-call name; Karl if \>5% planned)  
\# \- Expected revert time  
\# \- Approval-threshold compliance per §17.0 table  
\# \- Reference to PagerDuty alert policy resource name from §3.6

### **§17.4 Deploy disabled-state via canary — explicit linear ordering (V3 — RB-V3-03 \+ RB-V3-12 \+ RB-V3-13)**

V2 had a contradictory ordering between "snooze before traffic shift" and "verify boot-event PagerDuty page before snoozing." V3 makes the ordering linear and explicit. **Execute steps in the exact order below; do not reorder.**

#### **Step 17.4.1 — Capture pre-shift traffic state**

PROJECT="lyceon-vertex-prod"  
REGION="us-central1"  
SERVICE="lisa-orchestrator"

mkdir \-p ./deploy-evidence  
TRAFFIC\_BEFORE\_FILE="./deploy-evidence/traffic-before-breakglass-${TICKET\_ID:0:8}-$(date \-u \+%Y%m%dT%H%M%SZ).json"  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "${TRAFFIC\_BEFORE\_FILE}"

#### **Step 17.4.2 — Update Secret Manager with break-glass config**

echo "{  
  \\"pii\_guard\\": {  
    \\"enabled\\": false,  
    \\"break\_glass\_ticket\_id\\": \\"${TICKET\_ID}\\",  
    \\"break\_glass\_expires\_at\\": \\"${EXPIRES\_AT}\\"  
  }  
}" | gcloud secrets versions add lisa-pii-guard-config-prod \--data-file=- \--project=${PROJECT}

#### **Step 17.4.3 — Deploy break-glass revision at 0% traffic (V3 — RB-V3-12)**

The 0% deploy lets the break-glass revision boot and emit its boot-event PagerDuty page WITHOUT yet serving traffic. This is critical: it validates the boot-time alerting wiring before any user request hits the disabled-guard code path.

gcloud run deploy ${SERVICE} \\  
  \--image=gcr.io/${PROJECT}/lisa-orchestrator:CURRENT\_VERSION \\  
  \--region=${REGION} \\  
  \--no-traffic \\  
  \--tag=v3-breakglass-${TICKET\_ID:0:8} \\  
  \--update-secrets="PII\_GUARD\_CONFIG\_JSON=lisa-pii-guard-config-prod:latest"

\# Capture revision name (per §4.0b)  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "./deploy-evidence/breakglass-${TICKET\_ID:0:8}-after-deploy.json"

BG\_REVISION=$(jq \-r \--arg tag "v3-breakglass-${TICKET\_ID:0:8}" \\  
  '.status.traffic\[\] | select(.tag \== $tag) | .revisionName' \\  
  "./deploy-evidence/breakglass-${TICKET\_ID:0:8}-after-deploy.json")  
echo "Break-glass revision: ${BG\_REVISION}"

#### **Step 17.4.4 — Verify boot-event log fires**

sleep 60

gcloud logging read \\  
  "resource.type=cloud\_run\_revision AND resource.labels.revision\_name=${BG\_REVISION} AND jsonPayload.event=pii\_guard\_break\_glass\_active\_at\_startup" \\  
  \--limit=1 \--format=json

**Expected:** Log event with matching `ticket_id` \+ `expires_at`.

**Falsifies if:** Log event missing — config validation may be broken; HALT before any traffic shift.

#### **Step 17.4.5 — Verify initial PagerDuty page received (NOT yet snoozed)**

A PagerDuty page should fire automatically per V3 spec §28.8 on the boot event itself.

* Wait up to 2 minutes  
* Confirm primary on-call PagerDuty receives a page tagged `pii_guard_break_glass_active_at_startup`

**Falsifies if:** Initial PagerDuty page does NOT fire — observability is broken; HALT before any traffic shift. Don't proceed to snooze (snooze on broken alerting hides the problem).

#### **Step 17.4.6 — Acknowledge the boot-event incident**

Acknowledge the PagerDuty incident manually (this prevents auto-escalation). The acknowledgment establishes operator awareness; subsequent paging behavior is then governed by the snooze in Step 17.4.7.

#### **Step 17.4.7 — Create bounded snooze on per-turn disabled-mode alert ONLY (V3 — RB-V3-02 verified CLI; RB-V3-13 capture snooze name)**

Once the boot-event alert has fired, paged, and been acknowledged, create a bounded snooze covering ONLY the per-turn disabled-mode alert policy (NOT the boot-event policy, NOT SEV-1 privacy bypass policies). This prevents continuous paging during the canary observation window while leaving safety-critical alerts active.

\# Look up the per-turn alert policy resource name from §3.10 lock-evidence ticket  
\# Format: projects/\<PROJECT\>/alertPolicies/\<POLICY\_ID\>  
PII\_DISABLED\_TURN\_POLICY\_NAME="projects/${PROJECT}/alertPolicies/\<POLICY\_ID\_FROM\_LOCK\_EVIDENCE\>"

\# Compute snooze interval: now → 4 hours (matching break-glass expiration window)  
SNOOZE\_START=$(date \-u \+%Y-%m-%dT%H:%M:%SZ)  
SNOOZE\_END=$(date \-u \-d '+4 hours' \+%Y-%m-%dT%H:%M:%SZ)

\# Create snooze (V3 — RB-V3-02 verified CLI syntax)  
SNOOZE\_OUTPUT=$(gcloud monitoring snoozes create \\  
  \--display-name="break-glass-${TICKET\_ID:0:8}-disabled-mode-paging" \\  
  \--criteria-policies="${PII\_DISABLED\_TURN\_POLICY\_NAME}" \\  
  \--start-time="${SNOOZE\_START}" \\  
  \--end-time="${SNOOZE\_END}" \\  
  \--project=${PROJECT})

echo "${SNOOZE\_OUTPUT}"

\# Capture snooze full resource name (V3 — RB-V3-13)  
\# Output line format: "Created snooze \[projects/PROJECT/snoozes/SNOOZE\_ID\]"  
SNOOZE\_NAME=$(echo "${SNOOZE\_OUTPUT}" | grep \-oE 'projects/\[^/\]+/snoozes/\[^\]\]+')  
echo "Snooze name: ${SNOOZE\_NAME}"  
echo "${SNOOZE\_NAME}" \> ./deploy-evidence/breakglass-${TICKET\_ID:0:8}-snooze-name.txt

**Snooze policy:**

* Snoozed: per-turn `pii_guard_disabled_turns_total` paging policy ONLY  
* NOT snoozed: boot-event `pii_guard_break_glass_active_at_startup` policy  
* NOT snoozed: SEV-1 privacy bypass alert policies  
* NOT snoozed: any other §28 policy

The snooze auto-expires at `SNOOZE_END` (4 hours from creation). If revert (per §17.8) happens before expiration, the snooze is also explicitly cancelled. If revert is delayed and the snooze auto-expires while break-glass is still active, PagerDuty resumes paging — this is intentional fail-safe behavior.

#### **Step 17.4.8 — Shift 5% traffic to break-glass revision**

gcloud run services update-traffic ${SERVICE} \\  
  \--to-tags=v3-breakglass-${TICKET\_ID:0:8}=5 \\  
  \--region=${REGION}

#### **Step 17.4.9 — Monitor 15 minutes (canary observation)**

* `pii_guard_disabled_turns_total{callsite='main_turn'}` increments per turn served by break-glass revision (informational; per-turn paging snoozed)  
* `orchestrator_turn_success_rate` should improve toward target (the false-positive class no longer blocks)  
* No new SEV-1 alerts (privacy SEV-1 alert policies are NOT snoozed; only the disabled-turn paging is)  
* `pii_guard_break_glass_active_at_startup` boot-event policy is NOT snoozed; if a new instance boots into break-glass mode (e.g., due to autoscale), it will page

### **§17.5 Roll out beyond 5% — hard preconditions for 100% (V3 — RB-V3-04)**

**Approval gates per §17.0 carry forward:**

* 5% requires Karl approval (recorded in incident ticket)

* 100% requires Karl \+ 5 hard preconditions below

**5 hard preconditions for 100% rollout (V3 — RB-V3-04):**

100% rollout is allowed ONLY if ALL of the following are true and documented in the incident ticket:

1. **Broad legitimate-traffic impact:** the false-positive class affects a broad share of legitimate traffic (not just a niche feature). Quantification: ≥5% of all production turns are being incorrectly blocked, OR a feature serving ≥10% of MAU is materially degraded.  
2. **Scoped suppression unavailable:** scoped pattern suppression is NOT available as a remediation alternative. (V3 spec does not currently support pattern-level enable/disable; if V3.x adds scoped pattern suppression, that becomes the preferred remediation and 100% break-glass becomes harder to justify.)  
3. **Rollback would remove more safety than it restores:** reverting to a prior 03C version would lose other safety features (e.g., other PII patterns, anti-leak guards) — i.e., the false-positive being remediated is in a NEW pattern that was a net safety improvement on balance.  
4. **Karl explicit privacy-risk acceptance:** Karl explicitly accepts the privacy risk in the incident ticket. The acceptance is recorded as a comment with timestamp \+ reasoning, NOT just a checkbox or thumbs-up emoji.  
5. **Engineering verification of remaining safety surface:** Engineering confirms that during break-glass:  
   * Matched PII values remain unlogged (per V3 spec §4.2.2)  
   * All SLIs continue to emit (`orchestrator_pii_pattern_hit_total`, `pii_guard_disabled_turns_total`)  
   * SEV-1 privacy bypass alert policies are NOT snoozed  
   * Boot-event alert policy is NOT snoozed

If ANY of the 5 preconditions cannot be met: do NOT roll out to 100%. Hold at the highest acceptable canary percentage (typically 5% or 25%) until the pattern fix ships per §17.7.

**Roll out commands** (when preconditions met):

\# Karl approves \>5% in incident ticket; capture pre-shift state per §4.0b  
TRAFFIC\_BEFORE\_25="./deploy-evidence/traffic-before-breakglass-${TICKET\_ID:0:8}-25pct-$(date \-u \+%Y%m%dT%H%M%SZ).json"  
gcloud run services describe ${SERVICE} \--region=${REGION} \--format=json \> "${TRAFFIC\_BEFORE\_25}"

gcloud run services update-traffic ${SERVICE} \\  
  \--to-tags=v3-breakglass-${TICKET\_ID:0:8}=25 \\  
  \--region=${REGION}  
\# Monitor 30 minutes per §17.6

\# Karl approves 100% with 5 hard preconditions documented \+ explicit privacy-risk acceptance  
TRAFFIC\_BEFORE\_100="./deploy-evidence/traffic-before-breakglass-${TICKET\_ID:0:8}-100pct-$(date \-u \+%Y%m%dT%H%M%SZ).json"  
gcloud run services describe ${SERVICE} \--region=${REGION} \--format=json \> "${TRAFFIC\_BEFORE\_100}"

gcloud run services update-traffic ${SERVICE} \\  
  \--to-tags=v3-breakglass-${TICKET\_ID:0:8}=100 \\  
  \--region=${REGION}

### **§17.6 Monitor during break-glass window**

Watch continuously:

* `pii_guard_disabled_turns_total{callsite='main_turn'}` (expected: high; this is the desired state during break-glass)  
* `orchestrator_pii_pattern_hit_total{severity='warn'}` (expected: continues to fire; pattern detection unchanged)  
* `orchestrator_turn_success_rate` (expected: improved vs pre-break-glass)  
* Privacy alerts channel (expected: acknowledged; no NEW SEV-1)  
* Snooze auto-expire timer at `SNOOZE_END` — don't let snooze auto-expire before §17.8 revert; if revert is delayed, generate a new break-glass ticket per §17.10 rather than extending

### **§17.7 Ship pattern fix in parallel**

While break-glass is active, engineering authors \+ tests \+ deploys the pattern fix:

1. Author pattern adjustment (typically a regex tweak in `patterns.ts` per V3 spec §4.2.2)  
2. Add Test Matrix scenario covering the fixed false-positive case  
3. Run full Test Matrix V1.1 §11 PII guard suite  
4. Deploy via standard §4 sequence (small change; canary at 5% → ramp; uses §4.0b pre-shift capture)

### **§17.8 Revert before expiration (V3 — RB-V3-13 cancel by snooze name)**

**Critical:** revert break-glass BEFORE `break_glass_expires_at`. Auto-expiration is fail-closed; turns AFTER expiration return HTTP 500 until config is fixed.

PROJECT="lyceon-vertex-prod"  
REGION="us-central1"  
SERVICE="lisa-orchestrator"

\# Step 1: capture pre-revert traffic state per §4.0b  
TRAFFIC\_BEFORE\_REVERT="./deploy-evidence/traffic-before-revert-${TICKET\_ID:0:8}-$(date \-u \+%Y%m%dT%H%M%SZ).json"  
gcloud run services describe ${SERVICE} \--region=${REGION} \--format=json \> "${TRAFFIC\_BEFORE\_REVERT}"

\# Step 2: update secret to remove break-glass (PII guard re-enabled)  
echo '{"pii\_guard": {"enabled": true}}' | \\  
  gcloud secrets versions add lisa-pii-guard-config-prod \--data-file=- \--project=${PROJECT}

\# Step 3: deploy new revision with re-enabled config \+ the pattern fix  
gcloud run deploy ${SERVICE} \\  
  \--image=gcr.io/${PROJECT}/lisa-orchestrator:NEW\_PATTERN\_VERSION \\  
  \--region=${REGION} \\  
  \--no-traffic \\  
  \--tag=v3-breakglass-revert-${TICKET\_ID:0:8} \\  
  \--update-secrets="PII\_GUARD\_CONFIG\_JSON=lisa-pii-guard-config-prod:latest"

\# Capture revert revision name  
gcloud run services describe ${SERVICE} \\  
  \--region=${REGION} \\  
  \--format=json \> "./deploy-evidence/revert-${TICKET\_ID:0:8}-after-deploy.json"

REVERT\_REVISION=$(jq \-r \--arg tag "v3-breakglass-revert-${TICKET\_ID:0:8}" \\  
  '.status.traffic\[\] | select(.tag \== $tag) | .revisionName' \\  
  "./deploy-evidence/revert-${TICKET\_ID:0:8}-after-deploy.json")

\# Step 4: verify clean boot (no break-glass log event on revert revision)  
sleep 60  
gcloud logging read \\  
  "resource.type=cloud\_run\_revision AND resource.labels.revision\_name=${REVERT\_REVISION} AND jsonPayload.event=pii\_guard\_break\_glass\_active\_at\_startup" \\  
  \--limit=1  
\# Expected: no results

\# Step 5: ramp revert revision to 100%  
gcloud run services update-traffic ${SERVICE} \\  
  \--to-tags=v3-breakglass-revert-${TICKET\_ID:0:8}=100 \\  
  \--region=${REGION}

\# Step 6: cancel the snooze (V3 — RB-V3-13 reference by captured name)  
SNOOZE\_NAME=$(cat ./deploy-evidence/breakglass-${TICKET\_ID:0:8}-snooze-name.txt)  
echo "Cancelling snooze: ${SNOOZE\_NAME}"

gcloud monitoring snoozes cancel "${SNOOZE\_NAME}" \\  
  \--project=${PROJECT}

**Verification:** confirm `pii_guard_disabled_turns_total` reads 0 in steady state; confirm PagerDuty per-turn alert is un-snoozed (if a synthetic disabled-mode turn were to fire, it would page).

**Rollback if revert fails:** use §4.0b restoration from `${TRAFFIC_BEFORE_REVERT}` to return traffic to break-glass revision; investigate revert failure; do not leave a partially-reverted state.

### **§17.9 Post-incident review**

Within 48 hours of break-glass resolution:

1. Document the incident:  
   * What pattern was over-blocking?  
   * Why was it not caught by Test Matrix?  
   * How was the pattern fix authored?  
   * What was the user impact?  
   * What was the break-glass duration?  
   * What was the rollout percentage progression (5% → 25% → 100%) and approval timestamps?  
   * Were the 5 hard preconditions for 100% met (per §17.5)? Document each.  
2. Add a Test Matrix scenario for the fixed false-positive class (prevents regression)  
3. Review break-glass procedure: did anything in this section need to change?  
4. If procedural change needed: update this runbook \+ V4 absorption ticket  
5. Audit `pii_guard_disabled_turns_total` SLI to verify break-glass is fully reverted (=0 in steady state)  
6. Verify PagerDuty snooze was cancelled (`gcloud monitoring snoozes list` should not show the break-glass snooze in active state)

### **§17.10 Break-glass extension policy**

A break-glass ticket cannot be extended. If the pattern fix takes longer than 4 hours:

1. Allow current break-glass to expire (turns fail closed)  
2. **OR** generate a new break-glass ticket with a fresh 4-hour window (document why a single 4-hour window was insufficient)

Each new ticket fires a fresh PagerDuty page on the boot-event alert (which remains un-snoozed). This is intentional friction to discourage abuse.

**For V3.x consideration (flagged):** introduce a "monitor-only" mode to V3 spec as a safer break-glass primitive. Today's break-glass is binary (block or disabled); a monitor-only mode would let pattern detection continue producing SLIs and WARN alerts without blocking, with no need for the per-turn PAGE that the current disabled mode requires. This is a V3.x spec change, not a V3 runbook change.

## **§18 Pro→Flash budget circuit breaker ops playbook**

Per V3 spec §5.3.3 \+ §28.2. The circuit breaker auto-trips at 100% of daily budget; this is the ops procedure when it fires.

### **§18.1 Detection (V3 — RB-V3-09 normalized routing)**

Alerts (consistent with §2.2 \+ §2.4):

* WARN at 80% daily budget (`vertex_pro_budget_circuit_breaker_warn`); routes to Karl \+ Ops Slack  
* 100% daily budget alone (no anomaly) → Karl \+ Ops Slack (no PagerDuty)  
* 100% daily budget AND `cost-runaway-with-anomaly` composite policy fires → PagerDuty SEV-2

### **§18.2 Verify the alert**

\# Check current state  
psql "$PROD\_DATABASE\_URL" \-c "  
  SELECT config\_key, config\_value, updated\_at  
  FROM tutor\_context\_runtime\_config  
  WHERE config\_key LIKE 'vertex.pro\_budget\_circuit\_breaker%'  
    AND environment \= 'production';  
"

\# Check today's spend  
gcloud monitoring time-series list \\  
  \--filter='metric.type="custom.googleapis.com/vertex\_cost\_per\_day"' \\  
  \--interval-end-time=$(date \-u \+%Y-%m-%dT%H:%M:%SZ) \\  
  \--interval-start-time=$(date \-u \-d 'today 00:00:00 UTC' \+%Y-%m-%dT%H:%M:%SZ)

### **§18.3 Assess severity**

**Three scenarios:**

**Scenario A: budget reached due to organic traffic.**

* Symptom: `vertex_call_5xx_rate` is normal; `orchestrator_turn_success_rate` is normal; cost is just at expected upper bound for the day; composite anomaly policy did NOT fire  
* Response: let breaker auto-recover at UTC midnight. Pro requests fall back to Flash for the rest of the day. User impact: slightly degraded tutoring quality on Pro-routed turns.  
* Karl decision (via Ops Slack): is this acceptable for the rest of today, OR should budget be raised per §18.4?

**Scenario B: budget reached due to traffic spike (e.g., marketing event).**

* Symptom: traffic 2-5x baseline; spike correlates with known event; composite anomaly may or may not fire  
* Response: raise budget cap per §18.4 (Karl approval required); OR let breaker stay tripped  
* Decision factors: is the spike one-time? Is user experience worth the cost?

**Scenario C: budget reached due to runaway / abuse.**

* Symptom: traffic 10x+ baseline; pattern looks abusive (single student, repeated requests); composite alert policy `cost-runaway-with-anomaly` fired SEV-2 PagerDuty page  
* Response: investigate immediately. Possible attack or runaway loop in 03B  
* Mitigation: rate-limit at 03B level if confirmed abusive; contact LISA team for upstream throttle

### **§18.4 Raise budget cap (validation rule)**

Validation: the new daily cap must not exceed (monthly budget ÷ 30\) × 1.5 (i.e., 50% above prorated daily). Raises beyond that require Karl \+ finance approval recorded in incident ticket.

\# Compute the validation ceiling  
MONTHLY\_BUDGET\_USD=\<from §3.10 lock-evidence ticket\>  
DAILY\_PRORATED=$(echo "scale=2; $MONTHLY\_BUDGET\_USD / 30" | bc)  
DAILY\_CEILING=$(echo "scale=2; $DAILY\_PRORATED \* 1.5" | bc)  
echo "Validation ceiling for daily cap: \\$$DAILY\_CEILING"

\# Confirm proposed new cap is at or below ceiling  
NEW\_CAP=\<proposed\>  
if (( $(echo "$NEW\_CAP \> $DAILY\_CEILING" | bc \-l) )); then  
  echo "PROPOSED CAP EXCEEDS VALIDATION CEILING — requires Karl \+ finance approval"  
  \# Halt; obtain approval before proceeding  
fi

If validation passes:

BEGIN;

UPDATE tutor\_context\_runtime\_config  
SET config\_value \= '\<NEW\_DAILY\_CAP\_USD\>'::jsonb,  
    updated\_at \= now(),  
    updated\_by \= 'ops@lyceon.example (incident \<ID\>)'  
WHERE config\_key \= 'vertex.pro\_budget\_circuit\_breaker.daily\_cap\_usd'  
  AND environment \= 'production';

NOTIFY runtime\_config\_updated, 'vertex.pro\_budget\_circuit\_breaker.daily\_cap\_usd';

COMMIT;

### **§18.5 Verify breaker recovery**

Once budget cap is raised (or new UTC day begins):

psql "$PROD\_DATABASE\_URL" \-c "  
  SELECT config\_key, config\_value FROM tutor\_context\_runtime\_config  
  WHERE config\_key \= 'vertex.pro\_budget\_circuit\_breaker.active'  
    AND environment \= 'production';  
"

\# Should show: false

If still `true` after raising cap: investigate. Possible issues:

* NOTIFY not propagating (check channel name is `runtime_config_updated`, not the V1-bug name `runtime_config_changed`)  
* Multiple Cloud Run instances stuck on stale config (force restart if so)  
* Cap value below current spend

### **§18.6 Force breaker recovery (emergency only)**

If breaker is stuck (e.g., NOTIFY broken) and traffic is impacted:

BEGIN;

UPDATE tutor\_context\_runtime\_config  
SET config\_value \= 'false'::jsonb,  
    updated\_at \= now(),  
    updated\_by \= 'ops@lyceon.example (manual recovery)'  
WHERE config\_key \= 'vertex.pro\_budget\_circuit\_breaker.active'  
  AND environment \= 'production';

NOTIFY runtime\_config\_updated, 'vertex.pro\_budget\_circuit\_breaker.active';

COMMIT;

If even this doesn't work: force restart Cloud Run instances:

gcloud run services update lisa-orchestrator \--region=us-central1 \\  
  \--update-labels=force-restart=$(date \+%s)

### **§18.7 Post-incident**

Document:

* Why was budget reached?  
* Was budget raised? By how much?  
* Validation ceiling check: did proposed cap pass §18.4 validation, or was Karl \+ finance approval invoked?  
* Is the new cap permanent or one-day adjustment?  
* If runaway: what was the root cause? Has it been fixed?

If a new permanent cap is needed: update §3.10 lock-evidence ticket \+ Cloud Billing budget.

---

# **Part V — Governance**

## **§19 On-call (V1 default — flag for review)**

### **§19.1 V1 rotation**

| Tier | Members | Coverage | Tool |
| ----- | ----- | ----- | ----- |
| Primary on-call | Engineering team rotating weekly | Business hours (9 AM – 6 PM CT, M–F) | PagerDuty primary schedule |
| After-hours | Best-effort same engineers | Outside business hours | PagerDuty after-hours schedule (best-effort SLA) |
| Final escalation | Karl | Any time, any SEV | PagerDuty escalation policy |

**Rationale:** Lyceon at V1 launch has a small engineering team and limited traffic. A formal 24/7 on-call rotation with SLA-backed response times is over-engineered for V1. Best-effort after-hours coverage is acceptable given the V1 traffic profile and the 4-hour RTO posture in §2.3.

### **§19.2 Page acknowledgment expectations**

| SEV | Business hours ack target | After-hours ack target |
| ----- | ----- | ----- |
| SEV-1 | 15 min | 30 min |
| SEV-2 | 15 min | 30 min |
| SEV-3 | Next business day | N/A (no after-hours response) |

### **§19.3 Handoff protocol**

Weekly rotation handoff every Monday 10 AM CT:

1. Outgoing on-call lists active incidents \+ ongoing investigations  
2. Outgoing on-call lists any anomalies seen but not yet escalated  
3. Incoming on-call confirms PagerDuty schedule transition  
4. Incoming on-call reviews dashboard for last 24 hours

### **§19.4 V4 runbook absorbs**

* Formal multi-tier rotation with explicit SLA  
* 24/7 coverage if traffic \+ revenue justify cost  
* Escalation tree depth (Tier 4 platform engineering separate from product engineering)  
* Burnout-aware rotation policies (no 2 weeks consecutive primary)

## **§20 Log retention \+ privacy posture**

### **§20.1 Log retention defaults (V1 — Q3 baked in)**

| Log type | Retention | Storage | Source |
| ----- | ----- | ----- | ----- |
| Cloud Run application logs | 90 days | Cloud Logging default sink | V3 spec §11.3 \+ Q3 default |
| Audit logs (admin activity) | 400 days | Cloud Logging default sink | GCP default |
| HMAC auth failure logs | 90 days | Cloud Logging | V3 spec §28.7 |
| PII guard pattern hit logs (no matched values) | 90 days | Cloud Logging | V3 spec §4.2.2 |
| Break-glass invocation logs | 7 years | BigQuery long-term archive | V3 spec §30.7.1 \+ privacy compliance |
| Runtime config change logs | 7 years | BigQuery long-term archive | Audit \+ compliance |

### **§20.2 What is NEVER logged**

Per V3 spec §4.2.2 redaction discipline, the following NEVER appear in logs:

* Matched PII values (only `pattern_name`, `severity`, `callsite`)  
* Full envelope contents on PII block (only metadata)  
* Student-identifying free text from tutor context  
* HMAC signing key material  
* Vertex API credentials

V3 runbook adds: any operational verification command in this runbook MUST NOT inadvertently surface these. Operators executing verification commands during incident response are responsible for ensuring command outputs are not pasted into incident tickets if they contain PII.

### **§20.3 Privacy escalation**

If logs are found to contain matched PII values (regression):

1. SEV-1 incident  
2. Page privacy on-call channel immediately  
3. Halt log-export pipelines if necessary (BigQuery sink, etc.)  
4. Investigate redaction code path; ship fix  
5. Coordinate with legal on disclosure obligations

### **§20.4 V4 runbook absorbs**

* Log analytics workflows (BigQuery query patterns for incident investigation)  
* Long-term archive lifecycle (when 7-year retention period expires)  
* Cross-region log replication (when multi-region ships)  
* DSAR (Data Subject Access Request) workflow when GDPR/COPPA inbound

## **§21 DR \+ regional failover**

### **§21.1 V1 posture (carried from §2.3)**

* Single region: us-central1  
* 4-hour RTO acceptable  
* No automated multi-region failover  
* Manual restoration when GCP returns capacity

### **§21.2 Regional outage detection**

* GCP status page indicates us-central1 outage affecting Cloud Run / Cloud SQL / Vertex  
* Cloud Run health checks failing across all instances  
* `lisa-orchestrator` `/health` endpoint returning 503 sustained for \>5 minutes despite multiple revision restarts  
* Vertex API uniformly unreachable (not just throttled)

### **§21.3 V1 response procedure**

1. **Acknowledge regional outage**: confirm via GCP status page  
2. **Communicate**: post status update in Ops Slack channel \+ status page  
3. **Wait for GCP capacity**: there is no automated failover at V1  
4. **Monitor**: watch GCP status page for ETR  
5. **On capacity restoration**: verify orchestrator boots cleanly; verify all dependencies (DB, Vertex, Secret Manager) reachable; verify `/health` returns 200; resume normal operations  
6. **Post-incident**: file regional-outage absorption ticket for V4 (multi-region planning)

### **§21.4 Backup \+ restore (database)**

Cloud SQL automated backups: enabled by default. PITR (point-in-time recovery) window: 7 days.

\# Verify backup config  
gcloud sql instances describe lyceon-prod \\  
  \--format='value(settings.backupConfiguration.enabled,settings.backupConfiguration.pointInTimeRecoveryEnabled,settings.backupConfiguration.transactionLogRetentionDays)'

Expected: `enabled: true`, `pointInTimeRecoveryEnabled: true`, `transactionLogRetentionDays: 7`.

**Restore procedure** (if catastrophic data loss):

1. SEV-1; engage Karl  
2. Identify target restore timestamp (just before data loss event)  
3. Restore to a NEW Cloud SQL instance via PITR (do not overwrite current instance)  
4. Validate restore on new instance  
5. Cut over via DB connection string change in runtime config (per §11)  
6. Old instance retained for \~7 days for forensics, then deleted

### **§21.5 V4 runbook absorbs**

* Multi-region active-passive (target RTO \<30 min)  
* DB cross-region replication topology  
* Automated traffic-routing during regional outage  
* DR drill cadence (semi-annual recommended)

## **§22 Vertex quota management**

### **§22.1 V1 baseline quotas**

Quotas resolved per §3.10 launch-blocker checklist and recorded in lock-evidence ticket. Two quota types:

* **Pro RPM** (requests-per-minute for `gemini-2.5-pro`)  
* **Flash RPM** (requests-per-minute for `gemini-2.5-flash`)

Both per production GCP project.

### **§22.2 Quota request procedure**

If approaching quota:

1. Detect via `vertex_throttled_call_rate` SLI exceeding 0.5% over 1 hour  
2. File quota increase request via GCP Console → IAM & Admin → Quotas

Justification template:  
 Service: Lyceon (SAT learning platform for minors)Current quota: \<X\> RPM \<Pro|Flash\>Requested quota: \<Y\> RPM \<Pro|Flash\>Justification: organic traffic growth; current quota exceeded during peak hours; users experiencing throttle-induced fallback to Flash on Pro requestsPeak traffic timeline: \[3-month chart from Cloud Monitoring\]Production project ID: \<from §3.10\>

3.   
4. GCP support typically responds within 1-3 business days for routine increases  
5. Once approved: quota auto-applies; verify via `gcloud compute project-info describe`

### **§22.3 Quota fallback during request period**

While quota request is pending, V3 spec defines fallback behavior:

* Pro request → quota throttle → fall back to Flash (per V3 spec §5.3.2)  
* Flash quota throttle → return turn-failed envelope (per V3 spec §28.2)  
* 03B-side: surfaces as turn failure to tutor; tutor can retry

This is automatic per V3 spec; no manual intervention needed during throttle period.

If throttle rate exceeds 5% sustained for \>1 hour: escalate to Karl; consider pausing non-critical feature flags (e.g., disable streaming if it ships) to reduce request volume.

### **§22.4 V4 runbook absorbs**

* Multi-region quota allocation  
* Fine-grained quota by feature (e.g., separate quotas for context cache creation vs. inference)  
* Quota burst budgets for marketing events

## **§23 Runbook update protocol**

### **§23.1 Triggers for update**

1. **V3 spec change**: any V3 spec amendment that affects operational procedures (e.g., new alert in §28, new config key in §30, new schema column in §29)  
2. **Real production incident**: every SEV-2+ incident triggers a post-incident review per §17.9 / §18.7 / V1 fallback (§16.3); if procedure was insufficient or wrong, runbook updates  
3. **External tooling change**: GCP CLI deprecation, new gcloud syntax, etc.  
4. **Quarterly review**: every quarter, scheduled review of runbook against V3 spec for drift

### **§23.2 Update procedure**

1. Author update as PR against this runbook  
2. Reviewers: Engineering lead \+ Ops lead (joint approval required)  
3. If update is non-trivial procedural change: dry-run in staging before merge  
4. Merge increments runbook minor version (V3.0 → V3.1, etc.)  
5. Major-version bump (V3 → V4) only on V4 trigger criteria below  
6. Notify on-call engineers of merge

### **§23.3 V3 → V4 trigger criteria (whichever first)**

V4 runbook supersedes V3 when ANY of the following becomes true:

1. **30 days post-launch with stable sync-mode traffic AND streaming enablement is approved** — V4 absorbs §12 streaming procedure as launched-and-tested rather than provisional  
2. **First production incident requiring runbook-authored procedure beyond §17/§18 V3 scope** — V4 absorbs the new procedure  
3. **Multi-region expansion approved** — V4 absorbs DR/RTO posture changes (§21) and quota multi-region (§22)  
4. **On-call rotation grows beyond engineering team** (e.g., dedicated SRE hire) — V4 absorbs formal rotation in §19  
5. **Engineering ships bulk-memory-refresh prerequisite per §13.1** — V4 absorbs §13.3 procedure as operational

When V4 trigger fires: file V4 authoring ticket; freeze V3 except for critical security fixes; author V4 with continuous reference to V3.

### **§23.4 V3.x patch versions**

Between V3.0 and V4, runbook patch versions (V3.1, V3.2, ...) accumulate from §23.1 triggers. Each patch is recorded in §24.

## **§24 V3 patch records**

### **§24.0 V3.0 (this version) — major changes from V2**

Reference: V2 review normalization captured in V2→V3 disposition table; 13 RB-V3-XX closeouts listed in V3 closeout register at the top of this document.

| Change ID | Section(s) touched | Summary |
| ----- | ----- | ----- |
| RB-V3-01 | §4.0b NEW; §4.7, §4.8, §4.9, §8, §14, §17 | Pre-shift traffic JSON capture pattern; rollback restores from captured state, not from revision-creation-order heuristic |
| RB-V3-02 | §17.4, §17.8 | Verified `gcloud monitoring snoozes create/cancel` syntax replaces V2's invented `gcloud alpha monitoring policies update --snooze-duration=4h --no-snooze` |
| RB-V3-03 | §17.4 (full reorder) | Break-glass canary linear ordering: 0% deploy → boot event → initial PagerDuty page → ack → snooze per-turn alert ONLY → 5% shift |
| RB-V3-04 | §17.0, §17.5 | 5 hard preconditions for 100% break-glass; "prefer targeted fix" posture |
| RB-V3-05 | §4 opening, cross-doc anchor map, every traffic-ramp gate | `/health` is readiness-not-liveness per V3 §28B.4 |
| RB-V3-06 | §4.0b (folds in) | JSON service-status fallback for brittle `--format` expressions |
| RB-V3-07 | §14 Step 0 | `ROTATION_TAG` variable extracted once; UTC pinned; referenced everywhere |
| RB-V3-08 | §11.3 | Strengthened `runtime_config_reloaded` from "V3.x consideration" to "near-term V3.x requirement" with rationale |
| RB-V3-09 | §2.2, §2.4, §18.1 | Normalized cost budget routing: 100% alone → Karl \+ Ops Slack; 100% \+ composite anomaly → PagerDuty SEV-2 |
| RB-V3-10 | §5.7, §5.8 | Project-scope IAM (4 roles) verified separately from resource-scope IAM (per queue \+ per secret) |
| RB-V3-11 | §3.6, §3.10 | PagerDuty alert policy resource names captured at pre-launch in lock-evidence ticket; referenced by §17.4 |
| RB-V3-12 | §17.4.3 | Explicit 0% deploy step before traffic shift in break-glass canary |
| RB-V3-13 | §17.4.7, §17.8 | Snooze name captured on create (parsed from output); referenced by name on cancel |

**Self-applied fix during mid-draft review pass 3:** §5.6 originally created only `lisa-pii-guard-config-prod` and the two staging-test secrets, but §8.3 sub-check (c) referenced `lisa-pii-guard-config-staging` which was undefined. Fix: §5.6 now creates per-environment baseline secrets (`lisa-pii-guard-config-prod`, `lisa-pii-guard-config-staging`, `lisa-pii-guard-config-dev`) \+ the two staging-only test secrets. §5.6 secret table updated accordingly.

### **§24.1 reserved (V3.1 — first patch)**

To be populated when V3.1 ships per §23.1 triggers.

---

# **End block**

## **V3 closeout register summary**

13 closeouts applied in V3.0:

* 6 BLOCKER findings from V2 review (RB-V3-01 through RB-V3-06)  
* 4 ACCEPT non-blocking findings (RB-V3-07 through RB-V3-10)  
* 3 self-found additions surfaced during normalization (RB-V3-11, RB-V3-12, RB-V3-13)

V2's 23 closeouts (RB-V2-01 through RB-V2-23) carry forward; where V3 changes touch a V2-touched section, both closeout IDs are referenced.

## **Authoritative-for sections**

This runbook is **authoritative** (not just operational instantiation) for:

* §17 PII guard break-glass procedure — per V3 spec §30.7.1 cross-reference  
* §14 HMAC key rotation operational steps — per Doc 01A V1 Part VII cross-reference (V3 spec defers operational detail to this runbook)  
* §4 V3 §29.3 deployment sequence executable form — joint-authoritative with V3 spec §29.3 (spec defines sequence; this runbook is the executable form)

Where V3 spec and this runbook conflict on a procedural detail in these sections: **V3 spec wins for behavior contracts; this runbook wins for procedural details.** Discrepancies file a ticket per §23.

## **Reference \+ procedural overlay sections**

This runbook **references** (without duplicating) V3 spec for:

* §28 failure matrix — including §28.1 turn-path, §28.2 Vertex, §28.7 PII privacy/anti-leak, §28.8 configuration boot  
* §11.2 SLI catalog  
* §29.1 \+ §29.2 schema migration DDL  
* §28B Cloud Run service spec  
* §28B.4 health endpoint readiness gate semantic (RB-V3-05)  
* §30 \+ §31.5 runtime configuration  
* §4.2.2 PII guard pattern semantics

When operating, treat V3 spec sections above as authoritative for behavior; treat this runbook as the executable procedural overlay.

## **Companion artifacts**

* **Doc 03C V3 spec** (canonical-final, ✅) — `/mnt/user-data/outputs/Lyceon_Doc_03C_V3.md`  
* **Doc 03C.1 Test Matrix V1.1** (Draft for lock, ✅) — `/mnt/user-data/outputs/Lyceon_Doc_03C_1_Test_Matrix_V1_1.md`; 193 scenarios; acceptance contract  
* **Doc 03C Operations Runbook V3** (Draft for lock; this document) — `/mnt/user-data/outputs/Lyceon_Doc_03C_Operations_Runbook_V3.md`

The launch trio: spec defines behavior, test matrix verifies behavior, runbook operationalizes deployment \+ day-2 \+ minimal incident response.

## **V4 runbook trigger criteria**

V4 supersedes V3 when ANY of the following first becomes true (per §23.3):

1. 30 days post-launch with stable sync-mode traffic AND streaming enablement approved  
2. First production incident requiring runbook-authored procedure beyond §17/§18 V3 scope  
3. Multi-region expansion approved  
4. On-call rotation grows beyond engineering team  
5. Engineering ships bulk-memory-refresh prerequisite per §13.1

When any trigger fires: file V4 authoring ticket; freeze V3 except for critical security fixes; author V4.

## **V3.x considerations flagged (NOT IN V3 RUNBOOK SCOPE)**

Three items flagged for V3.x spec consideration; V3 runbook strengthens the language but does NOT introduce them as runbook procedures pending spec backing:

1. **Runtime config validation function** (§11.6) — `validate_runtime_config_key(config_key, config_value)` to reject mismatched JSONB shapes at write time; spec change required  
2. **`runtime_config_reloaded` log event** (§11.3 — RB-V3-08 strengthened) — structured log emission per Cloud Run instance on each runtime config reload; would replace today's behavior-side verification with direct log-based verification; spec change required  
3. **PII guard "monitor-only" mode** (§17.0 \+ §17.10) — third mode beyond binary block/disabled to make break-glass less binary; pattern detection emits SLIs \+ WARN alerts but never blocks; would be a safer break-glass primitive; spec change required

These remain V3.x spec authoring items, not V3 runbook procedural authoring.

## **Honest caveat on "fully shippable" status**

Per the user's "fully shippable version" instruction, V3.0 is the most complete operational ceiling achievable given the project's structure:

**What V3.0 CAN claim:**

* Every procedural detail under operator control: correct  
* Every gcloud command: syntactically verified (snooze CLI verified against Cloud Monitoring docs in this normalization session; pre-shift traffic capture pattern verified against Cloud Run docs)  
* Every cross-reference: accurate  
* Every step: has falsifiability \+ evidence \+ rollback  
* 13/13 closeouts applied; mid-draft review passes caught one secret-name gap and fixed it

**What V3.0 CANNOT claim** without organizational input:

* §3.10 launch-blocker values are not authored by this runbook — they are organizational decisions Karl provides via lock-evidence ticket (Vertex daily budget, Pro/Flash quotas, GCP project IDs, LISA team owner contact, PagerDuty composite alert policy wiring, PagerDuty per-turn alert policy resource name)  
* Staging dry-run evidence per §3.11 is not yet captured (this is a lock-evidence ticket artifact, not a runbook content item)  
* Engineering review \+ Ops review \+ Karl V1 launch sign-off \+ Karl break-glass operational policy sign-off — these are governance artifacts, not runbook items

V3.0 ships as **Draft for lock**. The 10 lock conditions at the top of this document define the path to **Locked for V1 launch**. After §3.10 organizational values resolve and §3.11 staging dry-run evidence is captured, the runbook crosses the Draft → Locked threshold.

---

**End of Doc 03C Operations Runbook V3.0.**

