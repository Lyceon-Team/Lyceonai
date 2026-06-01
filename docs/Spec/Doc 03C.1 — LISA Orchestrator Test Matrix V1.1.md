# **Doc 03C.1 — LISA Orchestrator Test Matrix V1.1**

**Version:** V1.1 **Status:** Draft for lock (companion to Doc 03C V3; pending review against V3 spec body) **Document family:** Doc 03C V3 \+ this Test Matrix \+ Doc 03C Operations Runbook V1 (pending) **Owners:** Lyceon Platform Engineering **Last updated:** 2026-04-29 **Depends on:** Doc 03C V3 (canonical-final spec); Doc 01A V1 (test conventions); Doc 03B V4.1 (envelope-builder contract); Doc 03A V3 (memory refresh \+ compaction algorithm) **Test framework:** pnpm \+ Vitest. Tests scaffolded in `apps/lisa-orchestrator/src/**/__tests__/*.test.ts` and `apps/lisa-orchestrator/src/**/__tests__/*.integration.test.ts` (planned path; verify at session 0 grounding before authoring). **Lock conditions:**

1. Doc 03C V3 ship status \= APPROVED (canonical-final) — ✅ confirmed  
2. Engineering review of all P0 scenarios (per §19 gates)  
3. Ops review of §13 async job \+ §16 chaos \+ §18 deployment scenarios  
4. Companion Operations Runbook V1 cross-checks the §29.3 V3 deployment-step verifications referenced from §18

---

## **V1.1 scope statement**

V1.1 is the **production-ready Test Matrix** companion to Doc 03C V3 (canonical-final). V1.1 absorbs V3 contracts, fixes test-matrix-quality issues found by an unbiased review of V1.0, and adds the missing-test scenarios that V2.2/V3 amendments require.

**V1.1 closeouts (review findings against V1.0):**

* **TM-V1.1-01 — Spec reference bump (V2.1 → V3).** V1.0 references "V2.1" throughout (header, §1, §2, §19, §20, end block). V1.1 updates all references. Where V1.0 said "blocker IDs BLK-V2-01 through BLK-V2-05", V1.1 maps each blocker to its V3-equivalent finding ID (or notes "carried unchanged from V2.1").  
* **TM-V1.1-02 — Model alias usage throughout (V3 F-V3-15).** V1.0 hardcoded `gemini-2.5-flash` and `gemini-2.5-pro` literals in test scenarios. V3 §5.2 introduced `flash_class` / `pro_class` aliases. V1.1 updates assertions to verify the alias is selected (not the provider string), with one explicit test (§8.16) verifying alias-to-provider-string resolution at the SDK call site.  
* **TM-V1.1-03 — PII tier matrix update (V3 F-V3-07/F-V3-08; V2.2 AMD-V2.2-01).** V1.0 §11.5 \+ §11.6 asserted bare ISO/US dates BLOCK at P0 — but V3 contextual matrix demotes bare dates to WARN. V1.1 flips these tests: bare dates verify WARN-only behavior; new tests verify identity-context-adjacent dates BLOCK; new test verifies V3 F-V3-07 second-match-correctness fix (matchAll iteration catches identity-adjacent matches that V2.2 first-match logic would miss).  
* **TM-V1.1-04 — Disable knob → break-glass discipline (V2.2 AMD-V2.2-02; V3 F-V3-10).** V1.0 §11.15 tested `pii_guard.enabled=false` as a normal runtime knob. V2.2 made this unsafe in production. V1.1 replaces with three tests: (a) production startup REJECTS `enabled=false` without break-glass ticket; (b) production startup ACCEPTS `enabled=false` with valid ticket \+ future expiration ≤4hr; (c) per-turn paging fires every disabled-mode turn while break-glass active.  
* **TM-V1.1-05 — Server-scope override resistance test (V2.2 AMD-V2.2-05).** V1.0 had no test for §3.5 envelope `.strict()` rejection of unknown scope-bearing fields. V1.1 adds §7.14 (P0).  
* **TM-V1.1-06 — Streaming chunk gate test family (V2.2 AMD-V2.2-04; V3 F-V3-04 \+ F-V3-05 \+ F-V3-06).** V1.0 had no chunk-gate tests. V1.1 adds §6.8–§6.13: per-pattern blocking; F-V3-04 chunk-overlap correctness (innocent chunks not blocked); F-V3-05 cascade thresholds; F-V3-06 Choose-X false-positive negative case.  
* **TM-V1.1-07 — Streaming persistence ownership prose \+ tests (V2.2 AMD-V2.2-03).** V1.0 §6 had no explicit prose for V2.2 ownership split. V1.1 adds §6 prelude \+ §6.14 (P0) verifying 03C does NOT write durable state during streaming, and §6.15 (P0) verifying 03B persists only after terminal `done`.  
* **TM-V1.1-08 — Cache equivalence invariant (V2.2 MTC-V2.2-02).** V1.0 had no test for §6.10. V1.1 adds §9.14 (P0).  
* **TM-V1.1-09 — Pre-cache PII guard (V2.2 MTC-V2.2-01).** V1.0 had no test for §6.5.1. V1.1 adds §11.19 (P0).  
* **TM-V1.1-10 — Mastery write block \+ entitlement signal trust (V2.2 MTC-V2.2-03/04).** V1.0 had no explicit tests. V1.1 adds TM-1.6.A (§5.11 P0 — code search \+ RLS denial) and TM-1.6.B (§7.15 P0 — entitlement only from HMAC-verified envelope).  
* **TM-V1.1-11 — V3 §28.7 \+ §28.8 SLI / failure-matrix alerts.** V1.0 §17 observability tests didn't cover the V3 PII/scope/break-glass SLIs. V1.1 expands §17 with V3-tagged scenarios.  
* **TM-V1.1-12 — V3 §29.3 deployment Step 7a (break-glass config validation in staging).** V1.0 §18.7 was malformed (asserted precondition mismatch as test result). V1.1 rewrites §18.7 as a true preflight scenario AND adds §18.11 for the V3 Step 7a verification.  
* **TM-V1.1-13 — Re-tier with invariant tags.** V1.0 P0/P1 assignments were ad-hoc per the §2 "violates Doc 00 invariants" principle. V1.1 makes the principle mechanical: every scenario receives one or more invariant tags from the canonical set {AUTH, ENTITLEMENT, PRIVACY, ANTI\_LEAK, NO\_FAIL\_OPEN, IDEMPOTENCY, AUDITABILITY, MIGRATION\_SAFETY, DETERMINISM, OBSERVABILITY}. Any tag from {AUTH, ENTITLEMENT, PRIVACY, ANTI\_LEAK, NO\_FAIL\_OPEN, IDEMPOTENCY, AUDITABILITY, MIGRATION\_SAFETY} → P0 by rule. {DETERMINISM, OBSERVABILITY} default P1 unless paired with a P0 tag. P0 count falls out organically.  
* **TM-V1.1-14 — Replace "industry SRE pattern" prose.** V1.0 §2 line 21 used generic copywriting. V1.1 replaces with the actual two-tier release gating principle Lyceon uses.  
* **TM-V1.1-15 — Fix §10.5 non-deterministic phrasing.** V1.0 §10.5 P0 said "Day 1 ordering ≠ Day 2 ordering (high probability — diversity rotation)" — non-deterministic phrasing in a P0 deterministic test. V1.1 fixes to a proper deterministic equality assertion using a controlled fixture.  
* **TM-V1.1-16 — Repo path verification flag.** V1.0 declared `apps/lisa-orchestrator/src/**/__tests__/` paths without verifying repo state. V1.1 marks paths as "Planned path (verify at session 0 grounding)" and notes that lock requires repo audit confirmation.  
* **TM-V1.1-17 — End block / §20 cross-doc dependency update.** V1.0 §20 said "this Test Matrix V1.1 should incorporate corresponding test updates" — V1.0 was V1.0, not V1.1; stale forward-reference. V1.1 cleans up the section and adds V3 cross-doc dependency rows (03B V5 §16 anti-leak coordination per V3 §32.6; 03B V5 §18 error registry per V3 §32.7).

**V1.1 architecture posture:** companion to Doc 03C V3. No new test scenarios beyond what V3 \+ V2.2 \+ carried V1.0 require. Re-tiering is mechanical via invariant tags, not subjective.

**V1.1 ship gating:** Draft-for-lock. Lock requires (a) engineering review of P0 scenarios, (b) ops review of async job \+ chaos \+ deployment scenarios, (c) repo path audit confirmation, (d) Operations Runbook V1 cross-checks the §29.3 V3 deployment-step verifications.

---

## **§1 Purpose**

Doc 03C.1 enumerates the test scenarios required to verify Doc 03C V3 spec compliance. It is the **acceptance contract** for engineering: every P0 scenario must pass before 03C V3 ships to production; every P1 scenario must pass before steady-state production traffic is permitted.

The Test Matrix is **not** the test code. It is the spec for what the test code must cover. Engineering writes the test code in Vitest using the scenarios below as the authoritative definition of correctness. Engineering may organize Vitest files however suits the codebase; the Test Matrix asserts coverage, not file structure.

## **§2 Severity tiers**

V1.1 uses a **two-tier release gating model** grounded in Doc 00 platform invariants. Tier assignment is mechanical, not subjective: every scenario receives one or more invariant tags from the canonical set, and the tags determine the tier.

| Tier | Meaning | Gate |
| ----- | ----- | ----- |
| **P0** | Must pass before 03C V3 ships to production. Failures block deployment. | Pre-launch CI gate per Doc 03C V3 §29.3 step 0 |
| **P1** | Required for production but can deploy and fix-forward. Failures do not block deployment if all P0 are clean. | Post-launch within 14 days of canary start |

### **§2.1 Invariant tags (canonical set)**

Every test scenario receives one or more tags from this set:

| Tag | Meaning | Tier rule |
| ----- | ----- | ----- |
| `AUTH` | Authentication / HMAC / OIDC / Cloud Run IAM | P0 by rule |
| `ENTITLEMENT` | Per-student entitlement gating; signal trust | P0 by rule |
| `PRIVACY` | PII guard; redaction; minor-safety | P0 by rule |
| `ANTI_LEAK` | Pre-submit answer concealment; chunk gate; full-response anti-leak | P0 by rule |
| `NO_FAIL_OPEN` | Fail-closed behavior on missing context, broken cache, stale scope | P0 by rule |
| `IDEMPOTENCY` | Idempotency posture (03C non-idempotent; 03B handles); replay safety | P0 by rule |
| `AUDITABILITY` | Mastery write block; tutor instruction logging; canonical write order | P0 by rule |
| `MIGRATION_SAFETY` | Schema migration forward-compat; rollback safety | P0 by rule |
| `DETERMINISM` | Deterministic ordering / candidate slots / hash-based selection | P1 default; P0 if paired with P0 tag |
| `OBSERVABILITY` | SLI emission; correlation; redacted logging | P1 default; P0 if paired with P0 tag |

A scenario tagged with ANY of {AUTH, ENTITLEMENT, PRIVACY, ANTI\_LEAK, NO\_FAIL\_OPEN, IDEMPOTENCY, AUDITABILITY, MIGRATION\_SAFETY} is P0 by rule. Scenarios tagged ONLY with {DETERMINISM, OBSERVABILITY} are P1 unless paired with a P0 tag.

This makes tier assignment auditable: any reviewer can verify the P0/P1 split by inspecting the tag set on each scenario, without subjective judgment.

### **§2.2 Tier override rule**

In rare cases where a scenario is tagged P0 by rule but the failure mode is genuinely non-blocking for first launch (e.g., a P0-tagged observability test that only fails when a downstream Cloud Monitoring alert is misconfigured), the scenario may be downgraded to P1 with explicit justification documented in the scenario's `Tier override:` line. No silent overrides; reviewer audits this list.

V1.1 has zero tier overrides. The mechanical tagging produced a P0 set every reviewer can verify.

## **§3 Test conventions**

### **3.1 Test format**

Tests are specified as **given/when/then scenarios** with explicit setup, action, and expected outcome.

Scenario: \<descriptive name\>  
Tier: P0 | P1  
Tags: \<invariant tag(s) from §2.1\>  
Spec section: \<Doc 03C V3 §X.Y reference\>  
Owner: Engineering | Platform | Ops

Given:  
  \<preconditions; environment state; fixtures\>

When:  
  \<action under test\>

Then:  
  \<expected outcome; assertions; observable signals\>

`Tags:` is required. `Tier override:` is optional and used only when §2.2 applies.

### **3.2 Test types**

| Type | Suffix | Runs in CI | Notes |
| ----- | ----- | ----- | ----- |
| Unit test | `.test.ts` | Yes (pre-merge) | Isolated, fast, mocked external deps |
| Integration test | `.integration.test.ts` | Yes (post-merge) | Real Postgres \+ mocked Vertex SDK |
| Contract test | `.contract.test.ts` | Yes (post-merge) | Verifies wire-format envelopes against fixture pairs |
| Chaos test | `.chaos.test.ts` | Manual \+ nightly | Process kills, network partition, DB drops |
| Load test | `.load.test.ts` | Manual \+ weekly | Validates P95/P99 targets under realistic concurrency |

### **3.3 Vitest helpers**

Standard test helpers expected to exist (planned interface; engineering authors actual implementations):

// Reference shapes only  
import { mockVertexSDK, type MockVertexResponse } from '@lyceon/test-helpers/vertex';  
import { withTestDB, withMigrations } from '@lyceon/test-helpers/db';  
import { mockCloudTasks, drainTaskQueue } from '@lyceon/test-helpers/cloud-tasks';  
import { buildEnvelope, type RequestEnvelope } from '@lyceon/test-helpers/envelope';  
import { signHmac, withFixedTime } from '@lyceon/test-helpers/auth';  
import { simulateSseStream, type SseEvent } from '@lyceon/test-helpers/sse'; // V1.1 added for chunk gate tests  
import { resolveProviderModel } from '@lyceon/test-helpers/model-alias'; // V1.1 added for alias tests

### **3.4 Fixture conventions**

Fixtures live under (planned path; verify at session 0 grounding) `apps/lisa-orchestrator/src/__fixtures__/`:

* `envelope/` — request envelope JSON fixtures, named per scenario  
* `vertex/` — mocked Vertex response payloads  
* `pii/` — PII pattern positive \+ negative test strings (V1.1 expanded with V3 contextual matrix cases)  
* `streaming/` — SSE chunk sequences for chunk gate tests (V1.1 added)  
* `migrations/` — pre/post-migration SQL snapshots

### **3.5 Test isolation**

* Every integration test runs in a transaction that rolls back on completion  
* Database state never leaks between tests  
* Mocked Vertex client resets between tests  
* Cloud Tasks queue mock drains between tests  
* Streaming SSE simulator resets per-test

### **3.6 What's out of scope for V1**

* End-to-end production-traffic replay tests (V2 once production logs exist)  
* Soak tests / multi-day stability (V2; load tests at 1-hour duration sufficient for launch)  
* Multi-region failover tests (V1 is single-region per Doc 03C V3 §2.2)  
* Streaming production traffic tests beyond simulation (V3 §29.3 / F-V3-17 launch posture: streaming defaults disabled at V1 launch; chunk gate exercised under simulated traffic only at first launch)

### **3.7 Repo path verification (V1.1 — TM-V1.1-16)**

All file paths declared in this document (e.g., `apps/lisa-orchestrator/src/**/__tests__/`, `apps/lisa-orchestrator/src/__fixtures__/`) are **planned paths**, not verified against current repo state. Lock conditions in §header require a repo audit before P0 acceptance. Engineering may relocate the actual test files; the Test Matrix asserts coverage, not file structure.

---

## **§4 Test categories overview (V1.1 re-tiered with invariant tags)**

V1.1 P0 count is derived mechanically from §2.1 tag rules. The table below shows V1.1 counts after re-tiering and absorbing V3/V2.2 contracts.

| Section | Category | V1.1 P0 | V1.1 P1 |
| ----- | ----- | ----- | ----- |
| §5 | Happy path orchestrator turn (sync) | 7 | 4 |
| §6 | Happy path orchestrator turn (SSE streaming) \+ chunk gate | 12 | 3 |
| §7 | Envelope validation \+ scope override resistance \+ entitlement signal | 10 | 5 |
| §8 | Vertex integration & model routing \+ alias resolution | 11 | 5 |
| §9 | Vertex context cache \+ cache equivalence | 9 | 5 |
| §10 | Candidate slots & schema split | 8 | 4 |
| §11 | PII guard (V3 contextual matrix \+ break-glass \+ pre-cache) | 17 | 7 |
| §12 | Pro→Flash fallback & budget circuit breaker | 6 | 4 |
| §13 | Async jobs (compaction, refresh, reconciliation) | 14 | 8 |
| §14 | Circuit breaker | 5 | 3 |
| §15 | Authentication (HMAC, OIDC, IAM) | 6 | 3 |
| §16 | Failure recovery & chaos | 7 | 7 |
| §17 | Observability (V3 §28.7/§28.8 alerts) | 8 | 4 |
| §18 | Schema migration & deployment \+ V3 Step 7a | 8 | 3 |
| **Total** |  | **128** | **65** |

193 scenarios total (P0 \+ P1). P0 coverage spans every V3 finding (F-V3-01 through F-V3-17), every V2.2 amendment (AMD-V2.2-01 through AMD-V2.2-06), every V2.2 missing-test contract (MTC-V2.2-01 through MTC-V2.2-04), and every V2.0/V2.1 blocker (BLK-V2-01 through BLK-V2-05). P1 coverage extends to edge cases, regression scenarios, deterministic-ordering nuances, and observability validation.

**Tag distribution across P0 set (informational):**

* AUTH: \~10 P0 scenarios  
* ENTITLEMENT: \~3 P0 scenarios  
* PRIVACY: \~25 P0 scenarios (largest single category — V3 PII contextual matrix expansion \+ break-glass \+ pre-cache \+ chunk gate cascade)  
* ANTI\_LEAK: \~15 P0 scenarios  
* NO\_FAIL\_OPEN: \~12 P0 scenarios  
* IDEMPOTENCY: \~6 P0 scenarios  
* AUDITABILITY: \~8 P0 scenarios  
* MIGRATION\_SAFETY: \~9 P0 scenarios

(Scenarios may have multiple tags; counts above are non-exclusive.)

---

## **§5 Happy path orchestrator turn (sync mode)**

Maps to Doc 03C V3 §28A.1 \+ §V \+ §VI.

### **5.1 \[P0\] Scoped question, scaffolded variant, Pro-class routed, cache miss**

Scenario: Sync turn — scoped\_question \+ scaffolded → pro\_class alias; cache miss creates new entry  
Tier: P0  
Tags: AUTH, ANTI\_LEAK, AUDITABILITY, OBSERVABILITY  
Spec section: §3.2 envelope; §5.2 alias resolution; §5.3.1 priority 7; §6.5 cache create; §7.1 response  
Owner: Engineering

Given:  
  \- Envelope: entry\_mode='scoped\_question', source\_surface='practice', policy\_variant='scaffolded',  
    prompt\_version='v1.0', resolved\_scope.source\_question\_canonical\_id set, recent\_messages with 3 turns  
  \- tutor\_memory\_summaries has 'ready' teaching\_profile row  
  \- tutor\_vertex\_context\_cache has no row matching composite cache key  
  \- Mocked Vertex SDK returns valid Pro-class response with strict-schema match  
  \- HMAC signature valid, timestamp current

When:  
  \- 03B → 03C calls POST /orchestrate/turn (streaming.enabled=false)

Then:  
  \- Routing produces envelope.selectedAlias='pro\_class' (per §5.3.1 priority 7\)  
  \- 03C invokes Vertex with model=resolveProviderModel('pro\_class', runtimeConfig) — verified at SDK call site  
  \- 03C creates new Vertex CachedContent (composite of policy \+ teaching\_profile)  
  \- INSERT row in tutor\_vertex\_context\_cache with kind='student\_composite'  
  \- Response 200 with response.content \+ suggested\_action \+ ui\_hints; question\_links empty;  
    instruction\_exposures populated; orchestration\_meta.model\_alias='pro\_class', cache\_used=false  
  \- SLI: orchestrator\_turn\_success\_rate, vertex\_model\_pro\_share increment;  
    vertex\_context\_cache\_creation\_latency\_p95 records  
  \- End-to-end P95 latency \<5000ms (verified by load.test variant)

### **5.2 \[P0\] Scoped question, concise variant, Flash-class routed, cache hit**

Scenario: Sync turn — scoped\_question \+ concise → flash\_class alias; cache hit reuses existing entry  
Tier: P0  
Tags: AUTH, AUDITABILITY, OBSERVABILITY  
Spec section: §5.2 alias resolution; §5.3.1 priority 8; §6.4 cache hit; §7.1 response  
Owner: Engineering

Given:  
  \- Envelope: entry\_mode='scoped\_question', policy\_variant='concise', prompt\_version='v1.0'  
  \- teaching\_profile.summary\_version=3  
  \- tutor\_vertex\_context\_cache has row: kind='student\_composite',  
    cache\_key='concise:v1.0:{student\_id}:v3', invalidated\_at=NULL, expires\_at\>now()  
  \- Mocked Vertex returns valid Flash-class response

When:  
  \- 03B → 03C calls POST /orchestrate/turn

Then:  
  \- Routing produces envelope.selectedAlias='flash\_class'  
  \- 03C lookup finds existing CachedContent  
  \- Vertex called with model=resolveProviderModel('flash\_class', runtimeConfig) AND cachedContent={existing CachedContent name}  
  \- No new tutor\_vertex\_context\_cache row created  
  \- Response 200; orchestration\_meta.cache\_used=true, model\_alias='flash\_class'  
  \- SLI: vertex\_context\_cache\_hit\_rate increments

### **5.3 \[P0\] Review surface precedence over policy\_variant**

Scenario: Sync turn — source\_surface='review' overrides concise→flash\_class to pro\_class  
Tier: P0  
Tags: AUTH, ANTI\_LEAK, AUDITABILITY  
Spec section: §5.3.1 priority 4 vs 8 precedence  
Owner: Engineering

Given:  
  \- Envelope: source\_surface='review', policy\_variant='concise' (would route flash\_class priority 8\)

When:  
  \- 03B → 03C calls POST /orchestrate/turn

Then:  
  \- Routing rule priority 4 (source\_surface='review') matches first  
  \- envelope.selectedAlias='pro\_class'  
  \- Vertex called with model=resolveProviderModel('pro\_class', runtimeConfig)  
  \- Response orchestration\_meta.model\_alias='pro\_class'

### **5.4 \[P0\] General entry mode routes Pro**

Scenario: Sync turn — entry\_mode='general' (dashboard) routes Pro per priority 5  
Tier: P0  
Spec section: §5.3.1 priority 5  
Owner: Engineering  
Tags: AUTH, AUDITABILITY

Given:  
  \- Envelope: entry\_mode='general', source\_surface='dashboard', policy\_variant='concise'  
  \- resolved\_scope all null

When:  
  \- 03B → 03C calls POST /orchestrate/turn

Then:  
  \- envelope.selectedAlias='pro\_class' (per §5.3.1 priority 5\)  
  \- Vertex called with model=resolveProviderModel('pro\_class', runtimeConfig)  
  \- Cache eligibility evaluated; eligibility passes if teaching\_profile present  
  \- Response orchestration\_meta.model\_alias='pro\_class'

### **5.5 \[P0\] Default fallback to flash\_class on no-rule-match**

Scenario: Sync turn — strategy\_first variant defaults to flash\_class via priority 8  
Tier: P0  
Tags: AUTH, AUDITABILITY  
Spec section: §5.3.1 priority 9 default  
Owner: Engineering

Given:  
  \- Envelope: entry\_mode='scoped\_question', policy\_variant='strategy\_first'

When:  
  \- Request processed

Then:  
  \- Priority 8 matches: envelope.selectedAlias='flash\_class'  
  \- Vertex called with model=resolveProviderModel('flash\_class', runtimeConfig)  
  \- Response orchestration\_meta.model\_alias='flash\_class'

### **5.6 \[P0\] Cache eligibility null-prompt-version short-circuit**

Scenario: Sync turn — prompt\_version=null disables cache, proceeds uncached  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §6.3 eligibility check  
Owner: Engineering

Given:  
  \- Envelope: policy\_assignment.prompt\_version=null

When:  
  \- 03B → 03C calls POST /orchestrate/turn

Then:  
  \- Cache lookup short-circuits returning null  
  \- Vertex invoked with NO cachedContent param; full systemInstruction provided directly  
  \- No INSERT in tutor\_vertex\_context\_cache  
  \- SLI: vertex\_context\_cache\_eligibility\_rate decrements (counted as ineligible)

### **5.7 \[P1\] Empty memory\_summaries causes ineligibility**

Scenario: Sync turn — no teaching\_profile in envelope; cache ineligible  
Tier: P1  
Tags: OBSERVABILITY  
Spec section: §6.3 eligibility  
Owner: Engineering

Given:  
  \- Envelope: memory\_summaries=\[\] (new student)

When:  
  \- Request processed

Then:  
  \- Cache lookup short-circuits ineligible  
  \- Vertex invoked with full systemInstruction; no cache writeback

### **5.8 \[P1\] Concurrent conversations independent**

Scenario: Sync turn — same student, two conversations; envelopes scoped per conversation\_id  
Tier: P1  
Tags: DETERMINISM  
Spec section: §3.2; Doc 03B V4.1 §13.7  
Owner: Engineering

Given:  
  \- Two envelopes for same student\_id, different conversation\_id

When:  
  \- Both processed concurrently

Then:  
  \- Each invocation resolves its own scope independently  
  \- Vertex calls do not cross-contaminate context  
  \- Both succeed

### **5.9 \[P1\] orchestration\_meta fields populated correctly**

Scenario: Sync turn — every orchestration\_meta field accurate  
Tier: P1  
Tags: OBSERVABILITY, AUDITABILITY  
Spec section: §7.1 orchestration\_meta; §11.3  
Owner: Engineering

Given:  
  \- Standard happy-path envelope; conversation has 22 turns (\>20 threshold)

When:  
  \- Request processed

Then:  
  \- orchestration\_meta.model\_alias \= selected alias ('flash\_class' or 'pro\_class')  
  \- orchestration\_meta.cache\_used \= boolean reflects hit/miss accurately  
  \- orchestration\_meta.compaction\_recommended \= true (\>20 turns triggers per §VIII.3)  
  \- orchestration\_meta.fallback\_applied \= false (Pro→Flash NOT triggered)  
  \- orchestration\_meta.input\_tokens / output\_tokens populated from Vertex usageMetadata  
  \- orchestration\_meta.latency\_ms \= wall-clock from request to response

### **5.10 \[P1\] SLI emission timing**

Scenario: Sync turn — SLIs emit per §11.2 conventions; no duplicates  
Tier: P1  
Tags: OBSERVABILITY  
Spec section: §11.2; §11.5 correlation  
Owner: Engineering

Given:  
  \- Standard envelope; metrics collector intercepting all metric.\* calls

When:  
  \- Request processed

Then:  
  \- orchestrator\_turn\_latency\_p95 records exactly once after response  
  \- vertex\_call\_latency\_p95 records once after Vertex returns (excludes 03C overhead)  
  \- All metrics tagged with request\_id and correlation\_id  
  \- No duplicate emissions; no missing emissions

### **5.11 \[P0\] Tutor cannot write to mastery tables (TM-1.6.A; V2.2 MTC-V2.2-03)**

Scenario: 03C code path enumeration \+ DB-level RLS denial verifies mastery write block  
Tier: P0  
Tags: AUDITABILITY, ENTITLEMENT  
Spec section: §1.6 MTC-V2.2-03; §12.3 IAM least-privilege; §8.7 bounded writeback  
Owner: Engineering

Given:  
  \- 03C codebase deployed; lisa-orchestrator and lisa-memory-worker service accounts present  
  \- Mastery tables (02C-owned) exist in DB with RLS policies denying writes to lisa-\* roles

When:  
  \- (a) Static analysis: code search across apps/lisa-orchestrator and lisa-memory-worker source for SQL targeting any 02C-owned mastery table (e.g., tables with \`mastery\` in name)  
  \- (b) Integration test: simulated lisa-orchestrator role attempts INSERT/UPDATE/DELETE on each mastery table

Then:  
  \- (a) Code search returns zero matches; no SQL writes mastery tables from 03C code paths  
  \- (b) Each attempted write fails with PostgreSQL permission-denied (RLS or grant denial); no write succeeds  
  \- Both (a) and (b) must pass; either failure blocks deployment  
  \- This test is the canonical verification of TM-1.6.A from Doc 03C V3 §1.6

---

## **§6 Happy path orchestrator turn (SSE streaming mode) \+ chunk gate**

Maps to §7.4 SSE wire format \+ §7.4.8 persistence ownership (V2.2 AMD-V2.2-03) \+ §7.4.9 chunk gate (V2.2 AMD-V2.2-04 \+ V3 F-V3-04/F-V3-05/F-V3-06) \+ §28A.2 streaming endpoint contract.

**§6 prelude (V1.1 — TM-V1.1-07): streaming persistence ownership.** Per Doc 03C V3 §7.4.8 (AMD-V2.2-03), 03C streams events but commits NO durable state during streaming. 03B owns persistence after the terminal `done` event. On `error` event, 03B does NOT persist a successful turn. The `tutor_messages`, `tutor_question_links`, and `tutor_instruction_exposures` rows are written only by 03B post-`done`. §6.14 and §6.15 verify this contract directly.

**§6 prelude (V1.1 — TM-V1.1-06): streaming chunk gate.** Per Doc 03C V3 §7.4.9, every `content_delta` chunk passes through deterministic regex anti-leak before emission. V3 F-V3-04 requires the gate fire only on patterns overlapping the current chunk text (not patterns entirely within `buffered_prefix`). V3 F-V3-05 requires cumulative cascade thresholds (3 consecutive / 5 cumulative blocks → terminal `streaming_anti_leak_cascade` error). V3 F-V3-06 requires the `choose_directive` pattern not fire on multi-option scaffolding. §6.8–§6.13 verify all of this.

**§6 V1 launch posture (V3 F-V3-17):** `vertex.streaming.enabled = false` at V1 launch. All §6 tests run under simulated streaming via the `simulateSseStream` helper, NOT against production traffic.

### **6.1 \[P0\] Streaming end-to-end**

Scenario: SSE turn — full path from request to done event  
Tier: P0  
Tags: AUTH, AUDITABILITY, OBSERVABILITY  
Spec section: §7.4.1 HTTP contract; §7.4.2 event format; §7.4.3 event types  
Owner: Engineering

Given:  
  \- Envelope: streaming.enabled=true; envelope.resolved\_scope.context='practice\_post\_submit'  
    (chunk gate light mode; no anti-leak blocks expected for clean fixtures)  
  \- Mocked Vertex in streaming mode emits: 5 content\_delta, 1 suggested\_action\_set,  
    1 ui\_hints\_set, 2 instruction\_exposure, 0 question\_link, 1 orchestration\_meta, 1 done  
  \- Each content\_delta passes chunk gate (no anti-leak patterns)

When:  
  \- 03B → 03C calls POST /orchestrate/turn streaming envelope

Then:  
  \- HTTP headers: Content-Type='text/event-stream; charset=utf-8',  
    Cache-Control='no-cache', Connection='keep-alive', Transfer-Encoding='chunked'  
  \- Events emit in order per §7.4.4: content\_delta×5 (monotonic sequence\_ordinal),  
    suggested\_action\_set, ui\_hints\_set, instruction\_exposure×2, orchestration\_meta, done  
  \- 'done' is final event with empty data payload  
  \- Connection closes cleanly after done  
  \- No state mutation in 03C during streaming (verified by post-stream DB inspection)  
  \- Chunk gate observability: orchestrator\_streaming\_chunk\_gate\_hit\_total emitted with severity='warn' or no hits at all (no blocks)

### **6.2 \[P0\] Streaming question\_link uses slot ID per §7.4.5**

Scenario: SSE turn — question\_link event payload contains slot\_id, not canonical\_id  
Tier: P0  
Tags: ANTI\_LEAK, AUDITABILITY  
Spec section: §7.4.3 event types; §7.4.5 canonical ID resolution in streaming  
Owner: Engineering

Given:  
  \- Envelope: streaming.enabled=true, scoped\_question with similar-question trigger  
  \- Candidate slots pre-selected: 5 candidates with slot\_ids  
  \- Mocked Vertex emits question\_link event with related\_candidate\_slot\_id='slot\_3'

When:  
  \- 03C streams to 03B

Then:  
  \- question\_link event payload contains related\_candidate\_slot\_id='slot\_3'  
    (NOT canonical\_id per §7.4.5)  
  \- 03B (consumer) resolves slot\_3 → canonical\_id post-stream OR during stream pass-through  
  \- Stream completes with done event

### **6.3 \[P0\] Streaming Vertex error mid-flight**

Scenario: SSE turn — Vertex 5xx mid-stream emits error event then closes; no persistence  
Tier: P0  
Tags: NO\_FAIL\_OPEN, AUDITABILITY  
Spec section: §7.4.6 failure mode in streaming; §7.4.8 persistence ownership  
Owner: Engineering

Given:  
  \- Envelope: streaming.enabled=true  
  \- Mocked Vertex emits 2 content\_delta events then errors with HTTP 500

When:  
  \- Stream in progress

Then:  
  \- 03C emits 'error' event with code='vertex\_5xx\_retriable', retryable=true  
  \- Connection closes immediately after error event  
  \- No 'done' event emitted (per §7.4.4: error and done are mutually exclusive terminals)  
  \- No DB writes by 03C (per §7.4.8)  
  \- 03B does NOT persist tutor\_messages assistant turn, tutor\_question\_links, or tutor\_instruction\_exposures (per §7.4.8 — terminal error means no successful turn)  
  \- SLI: vertex\_call\_5xx\_rate increments

### **6.4 \[P0\] Streaming opt-out by default (V3 F-V3-17 launch posture)**

Scenario: Sync turn — streaming.enabled defaults to false → JSON response  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §7.4.7 V1 posture; §28A.2 V3 launch posture  
Owner: Engineering

Given:  
  \- Envelope without streaming field (or streaming.enabled=false explicitly)  
  \- Runtime config: vertex.streaming.enabled=false (V1 launch default)

When:  
  \- Request processed

Then:  
  \- 03C treats as sync mode  
  \- Response Content-Type='application/json'; not text/event-stream  
  \- Full envelope returned in single response body

### **6.5 \[P1\] Streaming sequence\_ordinal monotonicity**

Scenario: SSE turn — content\_delta events have monotonic increasing sequence\_ordinal  
Tier: P1  
Tags: DETERMINISM, OBSERVABILITY  
Spec section: §7.4.4 event ordering guarantees  
Owner: Engineering

Given:  
  \- Mocked Vertex emits 10 content chunks

When:  
  \- Stream processed

Then:  
  \- sequence\_ordinal: 1, 2, 3, ..., 10 (strictly monotonic)  
  \- No gaps; no duplicates; no out-of-order

### **6.6 \[P1\] Empty suggested\_action emission**

Scenario: SSE turn — model emits suggested\_action.type='none' fires single event  
Tier: P1  
Tags: OBSERVABILITY  
Spec section: §7.4.3  
Owner: Engineering

Given:  
  \- Mocked Vertex returns suggested\_action.type='none', label=null

When:  
  \- Stream processed

Then:  
  \- suggested\_action\_set event fires exactly once with payload {type: 'none', label: null}

### **6.7 \[P1\] Streaming heartbeat or TCP keepalive**

Scenario: SSE turn — long generation does not time out client connection  
Tier: P1  
Tags: OBSERVABILITY  
Spec section: §7.4.1 HTTP keep-alive  
Owner: Engineering  
Note: V1 may not require app-level heartbeats; TCP keep-alive at OS level may suffice

Given:  
  \- Vertex streaming with 10-second silent gap

When:  
  \- Stream in progress

Then:  
  \- Either: 03C emits SSE comment ': heartbeat' every 5s  
    OR: TCP keep-alive enabled at OS level  
  \- Client does not time out

### **6.8 \[P0\] Chunk gate blocks "the answer is X" pattern in pre-submit**

Scenario: Streaming chunk gate — V2.2 answer\_is\_phrase pattern blocks in pre-submit  
Tier: P0  
Tags: ANTI\_LEAK, PRIVACY  
Spec section: §7.4.9 chunk gate; ANTI\_LEAK\_PATTERNS answer\_is\_phrase  
Owner: Engineering

Given:  
  \- Envelope: streaming.enabled=true, resolved\_scope.context='practice\_pre\_submit'  
  \- Mocked Vertex emits 3 content\_delta chunks: \['Looking at the question, ', 'the correct answer is ', 'B.'\]

When:  
  \- Stream processed; chunk gate runs on each content\_delta

Then:  
  \- Chunk 1 passes gate (no anti-leak pattern)  
  \- Chunk 2 OR chunk 3 (depending on buffered\_prefix span) blocked: emit\_text='\[…\]'  
  \- SLI: orchestrator\_streaming\_chunk\_gate\_hit\_total{pattern\_name='answer\_is\_phrase', severity='block', context='practice\_pre\_submit'} increments  
  \- SLI: orchestrator\_streaming\_chunks\_blocked\_total{context='practice\_pre\_submit'} increments  
  \- Stream continues (single block does not trigger cascade)  
  \- logger.warn 'streaming\_chunk\_gate\_blocked' logged WITHOUT original chunk text (privacy: no leak in logs)

### **6.9 \[P0\] Chunk gate F-V3-04 chunk-overlap correctness — innocent chunk NOT re-blocked**

Scenario: Streaming chunk gate — pattern entirely in buffered\_prefix does NOT re-block current chunk  
Tier: P0  
Tags: ANTI\_LEAK, NO\_FAIL\_OPEN  
Spec section: §7.4.9 V3 chunk-overlap rule; F-V3-04 fix  
Owner: Engineering

Given:  
  \- Envelope: streaming.enabled=true, resolved\_scope.context='practice\_pre\_submit'  
  \- Prior chunk emitted text containing 'the answer is X' (already escaped through some upstream path; assume pre-V3 algorithm allowed it)  
  \- bufferedPrefix='the correct answer is B. Now '  
  \- Current chunk='let me explain the reasoning.' (entirely innocent)

When:  
  \- Chunk gate runs on current chunk

Then:  
  \- matchAll iterates patterns over (bufferedPrefix \+ currentChunk)  
  \- For pattern 'answer\_is\_phrase': match span entirely within bufferedPrefix (matchEnd \<= prefixLen)  
  \- Per V3 F-V3-04 fix: skip this match (matchEnd \<= prefixLen condition)  
  \- No hits recorded for current chunk  
  \- Current chunk emits unchanged: 'let me explain the reasoning.'  
  \- Verifies V2.2 algorithm bug is fixed: V2.2 would have re-blocked this innocent chunk; V3 does not

### **6.10 \[P0\] Chunk gate F-V3-05 cascade — 3 consecutive blocks terminate stream**

Scenario: Streaming chunk gate — 3 consecutive blocks → streaming\_anti\_leak\_cascade error event  
Tier: P0  
Tags: ANTI\_LEAK, NO\_FAIL\_OPEN  
Spec section: §7.4.9 V3 cascade thresholds; F-V3-05  
Owner: Engineering

Given:  
  \- Envelope: streaming.enabled=true, resolved\_scope.context='practice\_pre\_submit'  
  \- Mocked Vertex emits 4 content\_delta chunks, each containing distinct anti-leak pattern:  
    \['the correct answer is A.', 'Option B is correct.', 'choose D.', 'fourth chunk content'\]

When:  
  \- Stream processed

Then:  
  \- Chunk 1 blocked: consecutiveBlocks=1, cumulativeBlocks=1  
  \- Chunk 2 blocked: consecutiveBlocks=2, cumulativeBlocks=2  
  \- Chunk 3 blocked: consecutiveBlocks=3, cumulativeBlocks=3  
  \- Cascade threshold (consecutive\_block\_limit=3) crossed  
  \- 03C emits 'error' event with code='streaming\_anti\_leak\_cascade', retryable=false  
  \- Connection closes; no 'done' event  
  \- SLI: orchestrator\_streaming\_anti\_leak\_cascade\_total{context='practice\_pre\_submit'} increments  
  \- StreamingCascadeError raised internally; chunk 4 never reached  
  \- 03B serves safe-hint reply per Doc 03B V4.1 §16 (verified by 03B-side test in companion)

### **6.11 \[P0\] Chunk gate F-V3-05 cascade — 5 cumulative blocks terminate stream**

Scenario: Streaming chunk gate — 5 cumulative blocks (non-consecutive) → cascade  
Tier: P0  
Tags: ANTI\_LEAK, NO\_FAIL\_OPEN  
Spec section: §7.4.9 V3 cumulative threshold; F-V3-05  
Owner: Engineering

Given:  
  \- Envelope: streaming.enabled=true, resolved\_scope.context='practice\_pre\_submit'  
  \- Mocked Vertex emits 9 content\_delta chunks; chunks 1, 3, 5, 7, 9 contain anti-leak patterns; chunks 2, 4, 6, 8 are clean

When:  
  \- Stream processed

Then:  
  \- Chunks 1, 3, 5, 7 blocked: consecutiveBlocks resets each time non-blocked chunk passes; cumulativeBlocks reaches 4  
  \- Chunk 9 blocked: cumulativeBlocks=5 → cumulative\_block\_limit crossed  
  \- 03C emits 'error' event with code='streaming\_anti\_leak\_cascade'  
  \- Stream terminates  
  \- This verifies cumulative threshold fires even when consecutive threshold has not crossed

### **6.12 \[P0\] Chunk gate F-V3-06 — Choose pattern NOT blocked on multi-option scaffolding**

Scenario: Streaming chunk gate — V3 narrowed choose\_directive pattern does NOT block Socratic content  
Tier: P0  
Tags: ANTI\_LEAK  
Spec section: §7.4.9 V3 choose\_directive negative lookahead; F-V3-06  
Owner: Engineering

Given:  
  \- Envelope: streaming.enabled=true, resolved\_scope.context='practice\_pre\_submit'  
  \- Mocked Vertex emits chunk: "Think about it this way: Choose A if you think the slope is positive, Choose B if you think it's negative, or Choose C if it's zero."  
  \- This is legitimate Socratic content; pattern would have triggered V2.2 choose\_directive without negative lookahead

When:  
  \- Chunk gate runs

Then:  
  \- matchAll iterates 'choose\_directive' pattern over chunk  
  \- V3 pattern includes negative lookahead (?\!\\s+(?:if|when|because))  
  \- "Choose A if" — lookahead matches " if"; pattern does NOT fire  
  \- "Choose B if" — same  
  \- "Choose C if" — same  
  \- No hits recorded; chunk emits unchanged  
  \- Verifies F-V3-06 false-positive fix

### **6.13 \[P0\] Chunk gate post-submit context degrades to warn**

Scenario: Streaming chunk gate — post-submit context demotes severity to warn (no block)  
Tier: P0  
Tags: ANTI\_LEAK, OBSERVABILITY  
Spec section: §7.4.9 severity matrix per context  
Owner: Engineering

Given:  
  \- Envelope: streaming.enabled=true, resolved\_scope.context='practice\_post\_submit'  
  \- Mocked Vertex emits chunk: 'the correct answer is B.'

When:  
  \- Chunk gate runs

Then:  
  \- Pattern 'answer\_is\_phrase' matches with severity\_post\_submit='warn'  
  \- hits\[\].severity='warn'; no entries with severity='block'  
  \- gateResult.ok=true (only blocking-severity hits set ok=false)  
  \- Chunk emits unchanged  
  \- SLI: orchestrator\_streaming\_chunk\_gate\_hit\_total{severity='warn'} increments (informational)  
  \- 03B's full-response anti-leak per Doc 03B V4.1 §16 still runs at terminal done

### **6.14 \[P0\] Streaming persistence ownership — 03C writes nothing during stream**

Scenario: Streaming persistence — 03C database state unchanged across full stream lifecycle  
Tier: P0  
Tags: AUDITABILITY, AUTH  
Spec section: §7.4.8 persistence ownership; AMD-V2.2-03  
Owner: Engineering

Given:  
  \- Envelope: streaming.enabled=true; clean happy-path fixture  
  \- Pre-stream snapshot of: tutor\_messages, tutor\_question\_links, tutor\_instruction\_exposures, tutor\_vertex\_context\_cache (count by table)

When:  
  \- Full stream runs to terminal 'done' event

Then:  
  \- During streaming (between request receipt and 'done'): NO inserts/updates/deletes from 03C process to tutor\_messages, tutor\_question\_links, or tutor\_instruction\_exposures  
  \- The only DB writes during streaming permitted: tutor\_vertex\_context\_cache mapping write (per §6.5.1 cache creation, IF cache miss)  
  \- Pre-stream and during-stream snapshots of tutor\_messages/tutor\_question\_links/tutor\_instruction\_exposures are identical  
  \- This verifies AMD-V2.2-03 contract: 03B owns persistence; 03C streams events only

### **6.15 \[P0\] Streaming persistence ownership — 03B persists only after `done`**

Scenario: Streaming persistence — 03B writes durable rows on terminal done; on error, no writes  
Tier: P0  
Tags: AUDITABILITY, NO\_FAIL\_OPEN  
Spec section: §7.4.8 persistence ownership; AMD-V2.2-03  
Owner: Engineering / LISA team (joint)

Given:  
  \- Two streaming runs:  
    Run A: completes with terminal 'done' event  
    Run B: terminates with 'error' event (e.g., vertex\_5xx\_retriable per §6.3 OR streaming\_anti\_leak\_cascade per §6.10)

When:  
  \- Both runs complete

Then:  
  \- Run A: 03B persists tutor\_messages assistant turn, tutor\_question\_links (if any), tutor\_instruction\_exposures (if any) AFTER done  
  \- Run B: 03B persists NO assistant turn, NO question links, NO instruction exposures (the student's input message was already persisted before 03C call per Doc 03B V4.1 §13.5)  
  \- On Run B, 03B serves a fallback UI to the student (no tutor reply visible) per Doc 03B V4.1 §16  
  \- Verifies the contract: terminal done \= persist; terminal error \= do not persist

---

## **§7 Envelope validation \+ scope override resistance \+ entitlement signal**

Maps to §3.4 envelope validation \+ §3.5 scope override resistance (V2.2 AMD-V2.2-05) \+ §7.3 error code registry. V1.1 adds §7.14 (scope override resistance) and §7.15 (entitlement signal trust) per V3 finding TM-V1.1-05 and TM-V1.1-10. All §7 scenarios receive AUTH or AUDITABILITY tags by default; specific tags listed per scenario.

### **7.1 \[P0\] Missing schema\_version**

Scenario: Envelope validation — missing schema\_version field  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §3.4 step 1  
Owner: Engineering

Given:  
  \- Envelope JSON with schema\_version field omitted

When:  
  \- Request submitted

Then:  
  \- HTTP 400; error.code='invalid\_envelope'; error.retryable=false  
  \- error.details references 'schema\_version' as failed field  
  \- SLI: orchestrator\_envelope\_validation\_failure\_rate increments  
  \- 03B treats as internal bug; 500 to client

### **7.2 \[P0\] Unknown schema\_version**

Scenario: Envelope validation — schema\_version='99.0' rejected  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §3.4 step 1  
Owner: Engineering

Given:  
  \- Envelope with schema\_version='99.0' (V1.x supports '1.0' only)

When:  
  \- Request submitted

Then:  
  \- HTTP 400; error.code='invalid\_envelope'  
  \- No Vertex call

### **7.3 \[P0\] Invalid HMAC signature**

Scenario: Envelope validation — HMAC mismatch returns 401  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §3.4 step 2; §IX.1  
Owner: Engineering

Given:  
  \- Valid envelope JSON  
  \- HMAC signature computed with wrong secret OR different timestamp than X-Lyceon-Timestamp

When:  
  \- Request submitted

Then:  
  \- HTTP 401; error.code='auth\_failed'; retryable=false  
  \- SLI: hmac\_auth\_failure\_rate increments  
  \- No envelope parsing beyond auth header  
  \- No Vertex call

### **7.4 \[P0\] Expired HMAC timestamp**

Scenario: Envelope validation — timestamp \>5 min old rejected  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §IX.1; 01A Part VII §62 timestamp window  
Owner: Engineering

Given:  
  \- Valid envelope, valid signature against fake clock 6 minutes ago

When:  
  \- Request submitted at current time

Then:  
  \- HTTP 401; error.code='auth\_failed'; message references timestamp window  
  \- No Vertex call

### **7.5 \[P0\] max\_output\_tokens bounds violation**

Scenario: Envelope validation — runtime\_limits.max\_output\_tokens=3000 exceeds 2000 max  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §3.4 step 4  
Owner: Engineering

Given:  
  \- Envelope with runtime\_limits.max\_output\_tokens=3000

When:  
  \- Request submitted

Then:  
  \- HTTP 400; error.code='envelope\_bounds\_exceeded'  
  \- error.details.field='runtime\_limits.max\_output\_tokens', max=2000

### **7.6 \[P0\] timeout\_ms bounds violation**

Scenario: Envelope validation — runtime\_limits.timeout\_ms=20000 exceeds 15000 max  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §3.4 step 4  
Owner: Engineering

Given:  
  \- Envelope with runtime\_limits.timeout\_ms=20000

When:  
  \- Request submitted

Then:  
  \- HTTP 400; error.code='envelope\_bounds\_exceeded'  
  \- error.details.field='runtime\_limits.timeout\_ms', max=15000

### **7.7 \[P0\] recent\_messages length bound**

Scenario: Envelope validation — recent\_messages.length=51 exceeds 50 max  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §3.4 step 5  
Owner: Engineering

Given:  
  \- Envelope with 51 recent\_messages entries

When:  
  \- Request submitted

Then:  
  \- HTTP 400; error.code='invalid\_envelope'  
  \- error.details references unbounded recent\_messages

### **7.8 \[P0\] Missing required policy\_variant**

Scenario: Envelope validation — policy\_assignment.policy\_variant null  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §3.4 step 3  
Owner: Engineering

Given:  
  \- Envelope with policy\_assignment.policy\_variant=null

When:  
  \- Request submitted

Then:  
  \- HTTP 400; error.code='invalid\_envelope'  
  \- error.details references missing required field  
  \- 03B logs internal bug; alerts page (per §7.3)

### **7.9 \[P1\] Unknown policy\_variant value**

Scenario: Envelope validation — policy\_variant='nonexistent' rejected at template-load step  
Tier: P1  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §4.3 prompt template loading  
Owner: Engineering

Given:  
  \- Envelope with policy\_variant='nonexistent'  
  \- 03C bootstrap loaded only known variants

When:  
  \- Request submitted

Then:  
  \- HTTP 400; error.code='invalid\_envelope'  
  \- error.details: 'unknown policy\_variant; no prompt template loaded for this value'

### **7.10 \[P1\] Empty entry\_mode**

Scenario: Envelope validation — entry\_mode='' rejected  
Tier: P1  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §3.4 step 3  
Owner: Engineering

Given:  
  \- Envelope with entry\_mode=''

When:  
  \- Request submitted

Then:  
  \- HTTP 400; error.code='invalid\_envelope'

### **7.11 \[P1\] Mismatched conversation\_id format**

Scenario: Envelope validation — conversation\_id is not a UUID  
Tier: P1  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §3.2 envelope schema  
Owner: Engineering

Given:  
  \- Envelope with conversation\_id='not-a-uuid'

When:  
  \- Request submitted

Then:  
  \- HTTP 400; error.code='invalid\_envelope'

### **7.12 \[P1\] Forward schema\_version warns and rejects**

Scenario: Envelope validation — schema\_version='1.5' (forward) is logged warn but rejected  
Tier: P1  
Tags: AUTH, NO\_FAIL\_OPEN  
Spec section: §3.4 step 1  
Owner: Engineering

Given:  
  \- Envelope with schema\_version='1.5'

When:  
  \- Request submitted

Then:  
  \- HTTP 400; error.code='invalid\_envelope'  
  \- Logger emits warn: 'envelope\_schema\_version\_forward\_received'

### **7.13 \[P1\] V2.1 debug\_seed accepted at schema\_version 1.0**

Scenario: Envelope validation — schema\_version='1.0' accepts runtime\_limits.debug\_seed  
Tier: P1  
Tags: DETERMINISM  
Spec section: §3.2; §5.7 V2.1 seed parameter  
Owner: Engineering

Given:  
  \- Envelope with schema\_version='1.0', runtime\_limits.debug\_seed=42

When:  
  \- Request submitted

Then:  
  \- Envelope accepted (debug\_seed is additive backward-compatible)  
  \- 03C passes seed=42 to Vertex generationConfig per §5.7

### **7.14 \[P0\] Server-resolved scope override resistance — strict-mode rejects unknown fields (V2.2 AMD-V2.2-05)**

Scenario: Envelope validation — Zod .strict() rejects scope-bearing fields outside resolved\_scope  
Tier: P0  
Tags: AUTH, ENTITLEMENT, ANTI\_LEAK, NO\_FAIL\_OPEN  
Spec section: §3.5 server-resolved scope override resistance; AMD-V2.2-05; F-V3-11 §32.7 adapter  
Owner: Engineering

Given:  
  \- Envelope with valid resolved\_scope.source\_question\_canonical\_id='SATM1ABC123'  
  \- PLUS attacker-style additional top-level field: client\_scope\_hint={source\_question\_canonical\_id:'SATM1XYZ999'}

When:  
  \- Envelope passes through Zod schema validation

Then:  
  \- Schema is .strict() per §3.5 implementation  
  \- Validation FAILS at parse time with error.details mentioning unknown key 'client\_scope\_hint'  
  \- HTTP 400; error.code='invalid\_envelope'  
  \- 03C never invokes Vertex; never reads client\_scope\_hint  
  \- SLI: client\_scope\_override\_attempted\_total increments (V3 §28.7)  
  \- PAGE alert fires per §28.7 (any hit)  
  \- Verifies V2.2 AMD-V2.2-05 contract: 03C trusts ONLY envelope.resolved\_scope; rejects sibling scope-bearing fields

### **7.15 \[P0\] Entitlement signal trust — only HMAC-verified envelope (TM-1.6.B; V2.2 MTC-V2.2-04)**

Scenario: 03C entitlement read path enumeration — code search verifies entitlement only from HMAC-verified envelope  
Tier: P0  
Tags: AUTH, ENTITLEMENT, AUDITABILITY  
Spec section: §1.6 MTC-V2.2-04; §IX.1 HMAC; §3.4 step 2  
Owner: Engineering

Given:  
  \- 03C codebase deployed  
  \- HMAC verification middleware applied to all inbound endpoints

When:  
  \- (a) Static analysis: code search across apps/lisa-orchestrator and lisa-memory-worker for any read of entitlement state from sources other than envelope-after-HMAC-verification (e.g., direct DB reads of entitlement tables, header inspection, query-string inspection, environment variable reads of per-student entitlement)  
  \- (b) Integration test: request with valid envelope structure but missing/invalid HMAC signature

Then:  
  \- (a) Code search returns zero matches; entitlement reads come exclusively from envelope post-HMAC verification  
  \- (b) Request rejected at §3.4 step 2 with HTTP 401 error.code='auth\_failed' BEFORE any envelope content (including entitlement claims) is processed  
  \- Both (a) and (b) must pass; either failure blocks deployment  
  \- This test is the canonical verification of TM-1.6.B from Doc 03C V3 §1.6

---

## **§8 Vertex integration & model routing**

Maps to §V Vertex invocation \+ §28.2 failure matrix.

### **8.1 \[P0\] Hybrid strict schema rejects safety-critical drift**

Scenario: Vertex — model returns suggested\_action.type='unknown\_value'; strict schema fails  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.4 hybrid strictness; §28.2 structured\_output\_violation  
Owner: Engineering

Given:  
  \- Mocked Vertex returns suggested\_action.type='unknown\_value'  
    (not in enum: none | offer\_similar\_question | offer\_broader\_coaching | offer\_stay\_focused)

When:  
  \- Vertex response parsed

Then:  
  \- 03C detects strict-field violation  
  \- HTTP 502; error.code='structured\_output\_violation'  
  \- SLI: vertex\_output\_schema\_violation\_rate increments

### **8.2 \[P0\] Lenient schema normalizes content drift**

Scenario: Vertex — ui\_hints with extra unknown field is normalized  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.4 lenient normalization  
Owner: Engineering

Given:  
  \- Mocked Vertex returns ui\_hints={suggested\_chip: 'Try similar', extra\_unknown\_field: 'data'}

When:  
  \- Vertex response parsed

Then:  
  \- 03C strips extra\_unknown\_field  
  \- Response envelope ui\_hints.suggested\_chip='Try similar'; no extra fields  
  \- SLI: vertex\_output\_schema\_drift\_rate increments (warn-level)  
  \- Turn succeeds

### **8.3 \[P0\] Vertex safety filter trip**

Scenario: Vertex — safety filter blocks response (HARM\_CATEGORY\_HATE\_SPEECH)  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.7 safetySettings; §28.2 vertex\_safety\_blocked  
Owner: Engineering

Given:  
  \- Mocked Vertex returns finishReason='SAFETY' with HARM\_CATEGORY\_HATE\_SPEECH

When:  
  \- Vertex response received

Then:  
  \- HTTP 422; error.code='vertex\_safety\_blocked'; retryable=false  
  \- SLI: vertex\_safety\_block\_rate increments  
  \- 03B substitutes safe hint per Doc 03B V4.1 §16  
  \- No retry (422 not retryable per §5.8)

### **8.4 \[P0\] Vertex 5xx with retry+jitter**

Scenario: Vertex — 503 first attempt, success on retry with jitter  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.8 retry policy with jitter  
Owner: Engineering

Given:  
  \- Mocked Vertex returns 503 first call, valid response second call  
  \- Fake clock for backoff timing

When:  
  \- 03C invokes Vertex

Then:  
  \- First call: 503  
  \- Wait 200ms ± 50ms jitter (range 150-250ms)  
  \- Second call: success  
  \- SLI: vertex\_call\_retry\_rate increments by 1; vertex\_call\_5xx\_rate increments by 1  
  \- Turn succeeds

### **8.5 \[P0\] Vertex 400 no retry**

Scenario: Vertex — 400 (validation) does not retry  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.8 retry exclusion  
Owner: Engineering

Given:  
  \- Mocked Vertex returns 400 with malformed-request error

When:  
  \- 03C invokes Vertex

Then:  
  \- 03C does NOT retry  
  \- SLI: vertex\_call\_retry\_rate does NOT increment

### **8.6 \[P0\] Vertex 422 (safety) no retry**

Scenario: Vertex — 422 safety block does not retry  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.8 retry exclusion  
Owner: Engineering

Given:  
  \- Mocked Vertex returns 422

When:  
  \- 03C invokes Vertex

Then:  
  \- No retry  
  \- HTTP 422; error.code='vertex\_safety\_blocked'

### **8.7 \[P0\] Vertex 429 quota → Pro→Flash fallback**

Scenario: Vertex — Pro 429 triggers automatic Flash fallback per §5.3.2  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.3.2 Pro→Flash fallback; §5.8; §28.2 vertex\_quota\_exhausted  
Owner: Engineering

Given:  
  \- Envelope routes to Pro per §5.3.1  
  \- Mocked Vertex Pro returns 429 quota exhausted

When:  
  \- 03C invokes Vertex

Then:  
  \- Pro call returns 429; per §5.8 NO retry on Pro  
  \- Per §5.3.2 fallback: 03C retries with Flash for this turn  
  \- If Flash succeeds: turn succeeds, orchestration\_meta.fallback\_applied=true  
  \- If Flash also 429: HTTP 429; error.code='vertex\_quota\_exhausted'  
  \- SLI: vertex\_pro\_fallback\_rate increments

### **8.8 \[P0\] Native Gemini Content\[\] format**

Scenario: Vertex — request uses native Content\[\] array, not concatenated string  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §4.2 V1.1 AMB-03C-02  
Owner: Engineering

Given:  
  \- Envelope with 5 recent\_messages

When:  
  \- 03C builds Vertex request

Then:  
  \- contents=\[  
      {role: 'user', parts: \[{text: '\<question\_context\>...\</question\_context\>'}\]},  
      {role: 'user', parts: \[{text: msg1}\]},  
      {role: 'model', parts: \[{text: msg2}\]},  
      ... (recent\_messages mapped per §4.2 role conversion)  
    \]  
  \- System instruction goes in systemInstruction field, NOT contents\[\]

### **8.9 \[P0\] V2.1 generation parameters present**

Scenario: Vertex — request includes topK=40, seed=undefined for prod traffic  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.7 V2.1 review-swipe  
Owner: Engineering

Given:  
  \- Standard envelope (no debug\_seed)

When:  
  \- 03C builds Vertex request

Then:  
  \- generationConfig.temperature=0.3  
  \- generationConfig.topP=0.95  
  \- generationConfig.topK=40  
  \- generationConfig.seed undefined (or null; not passed)

### **8.10 \[P0\] V2.1 debug\_seed propagation**

Scenario: Vertex — runtime\_limits.debug\_seed=42 propagates to generation config  
Tier: P0  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.7 V2.1 deterministic regeneration  
Owner: Engineering

Given:  
  \- Envelope with runtime\_limits.debug\_seed=42

When:  
  \- 03C builds Vertex request

Then:  
  \- generationConfig.seed=42

### **8.11 \[P1\] model\_override='flash' beats Pro routing**

Scenario: Routing override — model\_override='flash' beats normal Pro routing  
Tier: P1  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.3.1 priority 1  
Owner: Engineering

Given:  
  \- Envelope: source\_surface='review' (would route Pro per priority 4\)  
  \- runtime\_limits.model\_override='flash'

When:  
  \- Request processed

Then:  
  \- Flash routed (priority 1 wins)  
  \- SLI: vertex\_model\_routing\_distribution records override case  
  \- Logger emits info: 'routing\_override\_applied'

### **8.12 \[P1\] Routing distribution per (entry\_mode, source\_surface)**

Scenario: Vertex routing — distribution recorded per dimension combination  
Tier: P1  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §11.2 vertex\_model\_routing\_distribution  
Owner: Engineering

Given:  
  \- 100 turns mixed across entry modes

When:  
  \- All processed

Then:  
  \- Histogram has buckets for each (entry\_mode, source\_surface) combination  
  \- Counts match invocation distribution

### **8.13 \[P1\] Retry max 2 attempts**

Scenario: Vertex — 3 consecutive 5xx exhausts retry budget  
Tier: P1  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.8 max 2 retries  
Owner: Engineering

Given:  
  \- Mocked Vertex returns 503 on attempts 1, 2, 3

When:  
  \- 03C invokes Vertex

Then:  
  \- Attempt 1: 503; wait 200ms ± jitter  
  \- Attempt 2: 503; wait 800ms ± jitter  
  \- Attempt 3: 503  
  \- Total attempts: 3 (1 \+ 2 retries)  
  \- HTTP 503; error.code='vertex\_5xx\_retriable'  
  \- Total wall-clock \< runtime\_limits.timeout\_ms \+ 1500ms buffer

### **8.14 \[P1\] Circuit breaker trips at 50% error rate**

Scenario: Vertex — circuit breaker trips when 5/10 calls fail in 60s  
Tier: P1  
Tags: AUTH, NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §10.2 circuit breaker  
Owner: Engineering

Given:  
  \- Cloud Run instance past warmup (10 calls succeeded prior)  
  \- Subsequent 10 calls: 5 succeed, 5 fail (50% over 60s)

When:  
  \- 11th call attempted

Then:  
  \- Circuit breaker tripped for selected model  
  \- 11th call short-circuits: HTTP 503 with Retry-After: 30s  
  \- SLI: vertex\_circuit\_breaker\_trip\_count, vertex\_circuit\_breaker\_state='tripped'  
  \- Pages alert per §28.2

### **8.15 \[P1\] Circuit breaker recovery via probe**

Scenario: Vertex — half-open probe succeeds, breaker closes  
Tier: P1  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §10.2.3 state machine  
Owner: Engineering

Given:  
  \- Circuit breaker tripped 30s ago  
  \- Vertex now healthy

When:  
  \- First call after 30s timeout

Then:  
  \- Breaker tripped → half-open  
  \- Probe call succeeds  
  \- Breaker half-open → closed  
  \- SLI: vertex\_circuit\_breaker\_state='closed'

### **8.16 \[P0\] Model alias resolution at SDK call site (V2.2 AMD-V2.2-06; V3 F-V3-15)**

Scenario: Vertex SDK invocation uses resolveProviderModel(envelope.selectedAlias, runtimeConfig)  
Tier: P0  
Tags: AUTH, AUDITABILITY, OBSERVABILITY  
Spec section: §5.2 alias indirection; §30.1 config; AMD-V2.2-06; F-V3-15 standardization  
Owner: Engineering

Given:  
  \- Runtime config: vertex.model.flash\_class\_alias='gemini-2.5-flash', vertex.model.pro\_class\_alias='gemini-2.5-pro'  
  \- Two test envelopes:  
    Envelope A: routing produces selectedAlias='flash\_class'  
    Envelope B: routing produces selectedAlias='pro\_class'

When:  
  \- Both envelopes processed; mocked Vertex SDK records the \`model\` param it receives

Then:  
  \- Envelope A: SDK called with model='gemini-2.5-flash' (from flash\_class\_alias config)  
  \- Envelope B: SDK called with model='gemini-2.5-pro' (from pro\_class\_alias config)  
  \- resolveProviderModel function is invoked at call site (verified via spy or mock)  
  \- No code path passes raw 'gemini-2.5-flash' or 'gemini-2.5-pro' literal to SDK; all literals come from config resolution  
  \- Verifies F-V3-15 (standardized field name selectedAlias) and AMD-V2.2-06 (alias indirection)

Sub-test 8.16.b \[P0\]:  
  Given:  
    \- Runtime config updated: vertex.model.flash\_class\_alias='gemini-2.5-flash-002' (hypothetical version bump)  
  When:  
    \- Same Envelope A processed  
  Then:  
    \- SDK called with model='gemini-2.5-flash-002'  
    \- Spec body unchanged; config-only model upgrade works without code deploy  
    \- Verifies forward-compat against future Google model releases per §5.2 alias rationale

Sub-test 8.16.c \[P0\]:  
  Given:  
    \- Runtime config: vertex.model.flash\_class\_alias=null (misconfigured)  
  When:  
    \- Envelope A processed  
  Then:  
    \- resolveProviderModel throws 'unknown model alias' OR 'alias not configured'  
    \- 03C returns HTTP 500 internal\_error  
    \- SLI: configuration error event logged  
    \- Verifies §28.8 model alias resolution failure

---

## **§9 Vertex context cache**

Maps to §VI cache consumption \+ §28.3 failure matrix.

### **9.1 \[P0\] Composite cache key construction**

Scenario: Cache — composite key from (policy\_variant, prompt\_version, student\_id, teaching\_profile\_version)  
Tier: P0  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §6.2 V2.1 cache design (BLK-V2-01)  
Owner: Engineering

Given:  
  \- Envelope: policy\_variant='scaffolded', prompt\_version='v1.0', student\_id='abc-123',  
    teaching\_profile.summary\_version=5

When:  
  \- 03C computes cache\_key

Then:  
  \- cache\_key='scaffolded:v1.0:abc-123:v5'  
  \- cache\_kind='student\_composite'  
  \- Canonical question content NOT in cache key

### **9.2 \[P0\] Cache lookup hit**

Scenario: Cache — lookup matches valid row, returns CachedContent name  
Tier: P0  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §6.4 lookup flow  
Owner: Engineering

Given:  
  \- Row in tutor\_vertex\_context\_cache: kind='student\_composite',  
    cache\_key matches envelope, invalidated\_at=NULL, expires\_at\>now()  
  \- vertex\_cached\_content\_name='cachedContents/abc123'

When:  
  \- 03C performs lookup

Then:  
  \- Returns 'cachedContents/abc123'  
  \- Lookup latency \<100ms  
  \- SLI: vertex\_context\_cache\_hit\_rate increments

### **9.3 \[P0\] Cache lookup miss**

Scenario: Cache — no matching row → null  
Tier: P0  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §6.4  
Owner: Engineering

Given:  
  \- No matching row

When:  
  \- 03C performs lookup

Then:  
  \- Returns null  
  \- 03C proceeds to creation flow

### **9.4 \[P0\] Lookup ignores invalidated rows**

Scenario: Cache — invalidated\_at NOT NULL row treated as miss  
Tier: P0  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §6.7 invalidation handling  
Owner: Engineering

Given:  
  \- Row exists with invalidated\_at=now()-interval '1 minute', expires\_at\>now()

When:  
  \- 03C performs lookup

Then:  
  \- Returns null (filter excludes invalidated)  
  \- 03C creates fresh cache  
  \- SLI: vertex\_context\_cache\_miss\_on\_lookup\_rate increments

### **9.5 \[P0\] Lookup ignores expired rows**

Scenario: Cache — expires\_at \< now() treated as miss  
Tier: P0  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §6.4 lookup query  
Owner: Engineering

Given:  
  \- Row with invalidated\_at=NULL, expires\_at=now()-interval '1 minute'

When:  
  \- 03C performs lookup

Then:  
  \- Returns null  
  \- 03C creates fresh cache

### **9.6 \[P0\] Cache creation upsert on conflict**

Scenario: Cache — concurrent 03C instances creating same composite key  
Tier: P0  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §6.5 ON CONFLICT upsert  
Owner: Engineering

Given:  
  \- Two parallel orchestrator processes running creation flow for same student  
  \- Both call Vertex createCachedContent → both succeed with name1, name2

When:  
  \- Both attempt INSERT concurrently

Then:  
  \- First INSERT succeeds  
  \- Second INSERT triggers ON CONFLICT clause  
  \- Final row contains either name1 or name2 (last writer wins per §6.5)  
  \- Orphaned Vertex CachedContent expires via 1h TTL (acceptable cost leak)  
  \- Both turns succeed

### **9.7 \[P0\] Creation timeout fails open uncached**

Scenario: Cache — Vertex createCachedContent fails, fallback uncached  
Tier: P0  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §1.3 fail-safe; §6.8 failure modes  
Owner: Engineering

Given:  
  \- Mocked Vertex SDK throws on createCachedContent

When:  
  \- 03C attempts cache creation

Then:  
  \- Logger warn: 'cache\_creation\_failed\_uncached\_fallback'  
  \- 03C proceeds with full systemInstruction; no cachedContent reference  
  \- Turn succeeds  
  \- SLI: vertex\_context\_cache\_creation\_failure\_rate increments  
  \- User-facing impact: NONE

### **9.8 \[P0\] Lookup timeout (\>100ms) falls back uncached**

Scenario: Cache — DB lookup query exceeds 100ms timeout  
Tier: P0  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §6.4 lookup timeout  
Owner: Engineering

Given:  
  \- DB simulated with 200ms artificial latency

When:  
  \- 03C performs lookup

Then:  
  \- Lookup aborts at 100ms  
  \- 03C proceeds uncached  
  \- SLI: vertex\_context\_cache\_lookup\_timeout\_rate increments

### **9.9 \[P1\] Stale invalidation race during invocation**

Scenario: Cache — Vertex 404 for cached content invalidated mid-call  
Tier: P1  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §6.8  
Owner: Engineering

Given:  
  \- Lookup finds valid mapping; uses cachedContent='cachedContents/abc123'  
  \- During Vertex call, MemoryRefreshWorker invalidates row \+ deletes CachedContent  
  \- Vertex returns 404

When:  
  \- 03C handles 404

Then:  
  \- 03C creates fresh cache and retries Vertex once  
  \- Retry succeeds: turn succeeds with minor latency bump  
  \- Retry fails: returns vertex\_5xx\_retriable  
  \- SLI: vertex\_context\_cache\_miss\_on\_lookup\_rate increments

### **9.10 \[P1\] Cache TTL 1 hour on creation**

Scenario: Cache — newly created CachedContent has TTL=3600s  
Tier: P1  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §6.5 TTL rationale  
Owner: Engineering

Given:  
  \- Cache miss; 03C creates new CachedContent

When:  
  \- 03C calls Vertex createCachedContent

Then:  
  \- Vertex SDK call has ttl=3600  
  \- Mapping row expires\_at \= now() \+ 1 hour

### **9.11 \[P1\] Steady-state hit rate \>50%**

Scenario: Cache — steady-state hit rate \>50% per V2.1 target  
Tier: P1  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §6.9; §28.3 cache hit rate  
Owner: Engineering  
Note: Load test, not unit/integration

Given:  
  \- Synthetic load: 1000 students, 10 turns each, valid teaching\_profile

When:  
  \- All processed in 1-hour window

Then:  
  \- vertex\_context\_cache\_hit\_rate \> 50%  
  \- \<50% triggers alert per §28.3

### **9.12 \[P1\] Mapping write failure logs orphan**

Scenario: Cache — Vertex creation succeeds but DB INSERT fails  
Tier: P1  
Tags: AUDITABILITY, OBSERVABILITY  
Spec section: §6.8 mapping write failure  
Owner: Engineering

Given:  
  \- Vertex createCachedContent succeeds  
  \- DB write throws (connection drop)

When:  
  \- 03C handles failure

Then:  
  \- Turn proceeds (Vertex call uses new cache reference for this turn)  
  \- Logger warn: 'cache\_mapping\_write\_failed\_orphan\_will\_expire'  
  \- Vertex CachedContent expires via 1h TTL; cost leak bounded  
  \- SLI: vertex\_context\_cache\_mapping\_write\_failure\_rate increments

### **9.13 \[P1\] Cache hit when teaching\_profile updated to new version**

Scenario: Cache — version bump invalidates old cache, new cache created  
Tier: P1  
Tags: AUDITABILITY  
Spec section: §6.7 invalidation  
Owner: Engineering

Given:  
  \- Existing cache for cache\_key='scaffolded:v1.0:abc-123:v5'  
  \- Memory refresh worker bumps teaching\_profile to v6 (with invalidation per §8.4 T1)  
  \- New turn for same student

When:  
  \- Lookup runs

Then:  
  \- Lookup for new key 'scaffolded:v1.0:abc-123:v6' returns null (no row yet)  
  \- 03C creates fresh cache for v6  
  \- Old v5 row remains with invalidated\_at populated

### **9.14 \[P0\] Cache equivalence invariant — hit and miss produce equivalent responses (V2.2 MTC-V2.2-02)**

Scenario: Cache equivalence — same envelope produces functionally equivalent response on cache hit and cache miss  
Tier: P0  
Tags: AUDITABILITY, ANTI\_LEAK, AUTH  
Spec section: §6.10 cache equivalence invariant; MTC-V2.2-02  
Owner: Engineering

Given:  
  \- Fixed envelope: same student\_id, policy\_variant, prompt\_version, teaching\_profile\_version  
  \- Two test runs, both with deterministic seed: runtime\_limits.debug\_seed=12345  
  \- Run A: tutor\_vertex\_context\_cache pre-populated with composite cache for the envelope's cache\_key  
  \- Run B: tutor\_vertex\_context\_cache empty for that cache\_key (forces creation flow)

When:  
  \- Both runs invoked with identical envelope

Then:  
  \- Run A response.content text and Run B response.content text are functionally equivalent (subject to model determinism with fixed seed; engineering validates "equivalent" via fixture comparison)  
  \- Run A response.suggested\_action.type \=== Run B response.suggested\_action.type (must be IDENTICAL)  
  \- Run A response.ui\_hints structure \=== Run B response.ui\_hints structure (same shape)  
  \- Run A question\_links resolved canonical\_ids \=== Run B question\_links resolved canonical\_ids (same canonical mapping)  
  \- Run A instruction\_exposures \=== Run B instruction\_exposures (same exposure types and structure)  
  \- Run A and Run B 03C → 03B response envelopes are equal EXCEPT for orchestration\_meta.cache\_used (true vs false), orchestration\_meta.latency\_ms, orchestration\_meta.input\_tokens (cached path uses smaller input)  
  \- This verifies V2.2 MTC-V2.2-02: cache is a transparent layer; never changes tutoring content, anti-leak posture, or audit trail

Sub-test 9.14.b \[P0\]:  
  Given:  
    \- Same fixed envelope; cache pre-populated  
  When:  
    \- Run with cache; capture tutor\_instruction\_assignments row written by 03B post-run  
  Then:  
    \- tutor\_instruction\_assignments row has same policy\_family, policy\_variant, policy\_version, prompt\_version, assignment\_mode, assignment\_key as a cache-miss run with same envelope  
    \- Cache state is INVISIBLE in audit trail except via orchestration\_meta.cache\_used; no other audit-trail divergence

---

## **§10 Candidate slots & schema split (BLK-V2-02 \+ BLK-V2-04)**

Maps to §5.9 candidate-slots flow \+ §7.1.1 schema split.

### **10.1 \[P0\] Vertex output schema requires only related\_candidate\_slot\_id**

Scenario: Schema split — Vertex responseSchema has slot\_id, NOT canonical\_id  
Tier: P0  
Tags: ANTI\_LEAK, DETERMINISM  
Spec section: §5.5 V2.1 BLK-V2-02; §7.1.1  
Owner: Engineering

Given:  
  \- 03C builds Vertex request

When:  
  \- Inspect generationConfig.responseSchema

Then:  
  \- question\_links\[\].properties has 'related\_candidate\_slot\_id' (NOT 'related\_question\_canonical\_id')  
  \- question\_links\[\].required \= \['relationship\_type', 'reason\_code'\]  
  \- 'source\_question\_canonical\_id', 'related\_question\_canonical\_id' fields NOT in schema

### **10.2 \[P0\] 03C → 03B response envelope has resolved canonical IDs**

Scenario: Schema split — 03C populates canonical\_id from candidate list  
Tier: P0  
Tags: ANTI\_LEAK, DETERMINISM  
Spec section: §7.1.1; §5.9.5 resolveQuestionLinks  
Owner: Engineering

Given:  
  \- Candidate list pre-selected: 5 candidates with slot\_ids slot\_1..slot\_5,  
    canonical\_id values q\_aaa..q\_eee  
  \- Mocked Vertex returns question\_links=\[{related\_candidate\_slot\_id: 'slot\_3',  
    relationship\_type: 'similar\_retry', reason\_code: 'sticky\_question'}\]

When:  
  \- 03C resolves and returns response envelope

Then:  
  \- Response envelope question\_links\[0\].related\_question\_canonical\_id='q\_ccc'  
  \- Response envelope question\_links\[0\].related\_question\_row\_id matches candidate row\_id  
  \- Response envelope question\_links\[0\].source\_question\_canonical\_id from envelope.resolved\_scope  
  \- difficulty\_delta \= candidate.difficulty \- source\_question.difficulty

### **10.3 \[P0\] Hallucinated slot ID dropped, turn succeeds**

Scenario: Schema split — model returns nonexistent slot\_id; link dropped  
Tier: P0  
Tags: ANTI\_LEAK, DETERMINISM  
Spec section: §5.9.5; §28.4  
Owner: Engineering

Given:  
  \- Candidates pre-selected: slot\_1..slot\_5  
  \- Mocked Vertex returns question\_links=\[{related\_candidate\_slot\_id: 'slot\_999',  
    relationship\_type: 'similar\_retry', reason\_code: 'r1'}\]

When:  
  \- 03C resolves

Then:  
  \- Logger warn: 'vertex\_candidate\_slot\_hallucination'  
  \- Response envelope question\_links=\[\] (link dropped)  
  \- Turn succeeds (200 OK)  
  \- SLI: vertex\_candidate\_slot\_hallucination\_rate increments  
  \- Alert if rate \>5% per §28.4

### **10.4 \[P0\] Deterministic candidate ordering — same day replay**

Scenario: Candidate pre-select — same student/source/date → same ordering (BLK-V2-04)  
Tier: P0  
Tags: ANTI\_LEAK, DETERMINISM  
Spec section: §5.9.2 V2.1 BLK-V2-04  
Owner: Engineering

Given:  
  \- Fixed student\_id, fixed source\_question.canonical\_id  
  \- Fixed current\_date (frozen via withFixedTime helper)  
  \- canonical\_questions table has 20 eligible candidates

When:  
  \- Candidate pre-select query runs twice in succession

Then:  
  \- Both runs return identical candidate list in identical order  
  \- Top 5 candidate slot\_ids assigned identically  
  \- Query uses ORDER BY hashtext(canonical\_id || $student\_id || current\_date::text), LIMIT 5  
  \- No RANDOM() in query (verify by code review and pg\_stat\_statements inspection)

### **10.5 \[P0\] Deterministic ordering — varies across days (V1.1 — TM-V1.1-15 deterministic phrasing fix)**

Scenario: Candidate pre-select — same student/source, different date → different but each-individually-deterministic ordering  
Tier: P0  
Tags: DETERMINISM, AUDITABILITY  
Spec section: §5.9.2 determinism guarantee; F-V3-15 mechanical-determinism principle  
Owner: Engineering

Given:  
  \- Fixed student\_id='STUDENT-A', fixed source\_question.canonical\_id='SATM1ABC123'  
  \- Fixed candidate fixture: 5 eligible candidates with canonical\_ids \['SATM1XYZ001', 'SATM1XYZ002', 'SATM1XYZ003', 'SATM1XYZ004', 'SATM1XYZ005'\]  
  \- Day 1 fixture: current\_date='2026-04-25' (Saturday)  
  \- Day 2 fixture: current\_date='2026-04-26' (Sunday)  
  \- Pre-select uses deterministic ordering: ORDER BY hashtext(canonical\_id || student\_id || current\_date)

When:  
  \- Pre-select run on Day 1 (4 separate invocations); pre-select run on Day 2 (4 separate invocations)

Then:  
  \- All 4 Day-1 invocations produce IDENTICAL ordering of the 5 candidate canonical\_ids  
  \- All 4 Day-2 invocations produce IDENTICAL ordering of the 5 candidate canonical\_ids  
  \- Day 1 ordering and Day 2 ordering are NOT identical (deterministic test fixture chosen to verify date-rotation behavior; engineering selects test data such that hash difference is verifiable)  
  \- Specifically: assert that for the chosen fixture, hashtext('SATM1XYZ001' || 'STUDENT-A' || '2026-04-25') ≠ hashtext('SATM1XYZ001' || 'STUDENT-A' || '2026-04-26'), and ordering differs accordingly  
  \- This is a deterministic test (no probabilistic phrasing); fixture is specifically chosen so hash-rotation across the two dates yields a different ordering for this exact data  
  \- Verifies §5.9.2 contract: determinism per-day (reproducible) \+ diversity across days (rotation visible)

### **10.6 \[P0\] Empty candidate result skips slot block**

Scenario: Candidate — no eligible questions; model receives no candidate list  
Tier: P0  
Tags: ANTI\_LEAK, DETERMINISM  
Spec section: §5.9.2; §5.9.6  
Owner: Engineering

Given:  
  \- Source question has no eligible candidates (all attempted in last 30 days OR question bank gap)

When:  
  \- Pre-select runs

Then:  
  \- Returns empty array  
  \- Vertex prompt does NOT include \<candidate\_questions\> block  
  \- Model cannot suggest similar question  
  \- Turn proceeds with empty question\_links\[\]  
  \- SLI: candidate\_preselect\_empty\_rate increments

### **10.7 \[P0\] Pre-select timeout falls back to no slots**

Scenario: Candidate — DB query exceeds 200ms timeout  
Tier: P0  
Tags: ANTI\_LEAK, DETERMINISM  
Spec section: §5.9.2 timeout  
Owner: Engineering

Given:  
  \- DB simulated with 300ms latency on canonical\_questions read

When:  
  \- Pre-select runs

Then:  
  \- Aborts at 200ms  
  \- Empty candidate list passed forward  
  \- SLI: candidate\_preselect\_timeout\_rate increments  
  \- Logger warn: 'candidate\_preselect\_timeout'

### **10.8 \[P0\] Source canonical\_id always from envelope**

Scenario: Schema split — source\_question\_canonical\_id from envelope, never from model  
Tier: P0  
Tags: ANTI\_LEAK, DETERMINISM  
Spec section: §7.1.1  
Owner: Engineering

Given:  
  \- Envelope.resolved\_scope.source\_question\_canonical\_id='q\_xxx'  
  \- Mocked Vertex returns question\_links=\[{related\_candidate\_slot\_id: 'slot\_1', ...}\]

When:  
  \- 03C resolves

Then:  
  \- Response envelope question\_links\[0\].source\_question\_canonical\_id='q\_xxx'  
    (taken from envelope, NOT from model output)

### **10.9 \[P1\] No similar-question trigger → no candidate pre-select**

Scenario: Candidate — no trigger detected; pre-select skipped entirely  
Tier: P1  
Tags: ANTI\_LEAK, DETERMINISM  
Spec section: §5.9.1  
Owner: Engineering

Given:  
  \- Envelope: no confusion signals in recent\_messages, conversation turn count=2

When:  
  \- Pre-select decision evaluated

Then:  
  \- 03C skips candidate pre-selection entirely  
  \- Vertex prompt has no candidate block

### **10.10 \[P1\] Difficulty filter ±1 enforced**

Scenario: Candidate — query enforces difficulty BETWEEN $-1 AND $+1  
Tier: P1  
Tags: ANTI\_LEAK, DETERMINISM  
Spec section: §5.9.2  
Owner: Engineering

Given:  
  \- source\_question.difficulty=3  
  \- canonical\_questions has questions of difficulty 1, 2, 3, 4, 5

When:  
  \- Pre-select runs

Then:  
  \- Returned candidates only difficulty 2, 3, 4  
  \- Difficulty 1 and 5 excluded

### **10.11 \[P1\] Recent-attempt exclusion (last 30 days)**

Scenario: Candidate — student attempted in last 30 days excluded  
Tier: P1  
Tags: ANTI\_LEAK, DETERMINISM  
Spec section: §5.9.2 NOT EXISTS subquery  
Owner: Engineering

Given:  
  \- student\_question\_attempts: student attempted Q\_ABC at now()-15 days  
  \- Q\_ABC otherwise eligible

When:  
  \- Pre-select runs

Then:  
  \- Q\_ABC excluded from candidates  
  \- NOT EXISTS subquery filters correctly

### **10.12 \[P1\] Candidate slot tag in prompt**

Scenario: Candidate — slots wrapped in \<candidate\_questions\> tags  
Tier: P1  
Tags: ANTI\_LEAK, DETERMINISM  
Spec section: §5.9.3; §6.6 V1.2 tag-prefix convention  
Owner: Engineering

Given:  
  \- 5 candidates pre-selected

When:  
  \- Vertex prompt assembled

Then:  
  \- contents\[\] contains user-role message:  
    \<candidate\_questions\>  
    slot\_id: slot\_1 | difficulty: 3 | subskill: ...  
    slot\_id: slot\_2 | difficulty: 3 | subskill: ...  
    ...  
    \</candidate\_questions\>

---

## **§11 PII guard — V3 contextual matrix \+ break-glass \+ pre-cache (BLK-V2-03 \+ AMD-V2.2-01 \+ AMD-V2.2-02 \+ MTC-V2.2-01)**

Maps to Doc 03C V3 §4.2.2 PII guard implementation (V3 matchAll fix per F-V3-07/F-V3-08) \+ §6.5.1 pre-cache PII check (V2.2 MTC-V2.2-01) \+ §30.7 \+ §30.7.1 break-glass procedure (V2.2 AMD-V2.2-02) \+ §28.7 privacy/anti-leak failure matrix (V3 F-V3-02) \+ §28.1 orchestrator turn path.

**§11 V1.1 changes (TM-V1.1-03 \+ TM-V1.1-04 \+ TM-V1.1-09):**

* **§11.5 \+ §11.6 (date patterns):** flipped from P0 BLOCK to P0 WARN-only for bare dates; new §11.5b \+ §11.6b verify identity-context-adjacent dates BLOCK per V2.2 AMD-V2.2-01 contextual matrix  
* **§11.15 (disable knob):** removed; replaced with §11.15a (production startup REJECTS), §11.15b (production startup ACCEPTS with valid break-glass), §11.15c (per-turn paging fires while break-glass active) per V2.2 AMD-V2.2-02  
* **§11.19 NEW (pre-cache PII guard):** verifies §6.5.1 callsite per V2.2 MTC-V2.2-01  
* **§11.20 NEW (matchAll second-match correctness):** verifies V3 F-V3-07 fix that V2.2's first-match-only check would have silently missed

### **11.1 \[P0\] Email pattern blocks turn**

Scenario: PII guard — email in assembled prompt blocks turn  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 PII guard PII\_PATTERNS email  
Owner: Engineering

Given:  
  \- Envelope with student\_context containing 'student@example.com' (test fixture pii/email\_positive\_\*.txt)

When:  
  \- 03C assembles prompt and runs preVertexPiiCheck

Then:  
  \- piiGuard returns ok=false with pattern\_name='email', severity='block'  
  \- 03C throws PiiInEnvelopeError  
  \- HTTP 400; error.code='pii\_in\_envelope'; retryable=false  
  \- SLI: orchestrator\_pii\_pattern\_hit\_total{pattern\_name='email', severity='block'} increments  
  \- SLI: orchestrator\_pii\_blocked\_turns\_total increments  
  \- PAGE alert (privacy-incident-adjacent)  
  \- No Vertex call made  
  \- Logger error: 'orchestrator\_pii\_blocked' with blocking\_patterns=\['email'\] (pattern names only, NOT values)

### **11.2 \[P0\] Phone US pattern blocks turn**

Scenario: PII guard — US phone (NANP format) blocks turn  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 phone\_us pattern  
Owner: Engineering

Given:  
  \- Assembled prompt contains '(555) 123-4567' (variations: 555-123-4567, 555.123.4567, \+1 555 123 4567\)

When:  
  \- PII guard runs

Then:  
  \- All four variations match phone\_us pattern  
  \- All four blocked with severity='block'  
  \- SLI: orchestrator\_pii\_pattern\_hit\_total{pattern\_name='phone\_us'} increments

### **11.3 \[P0\] Phone international pattern blocks turn**

Scenario: PII guard — international phone blocks turn  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 phone\_intl pattern  
Owner: Engineering

Given:  
  \- Assembled prompt contains '+44 20 7946 0958' (UK format)

When:  
  \- PII guard runs

Then:  
  \- phone\_intl pattern matches; blocked

### **11.4 \[P0\] DOB label blocks turn**

Scenario: PII guard — explicit DOB label blocks turn  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 dob\_label pattern  
Owner: Engineering

Given:  
  \- Assembled prompt contains 'date of birth: 2009-03-15' (variations: DOB:, birthdate:, birthday:)

When:  
  \- PII guard runs

Then:  
  \- dob\_label pattern matches all variations; blocked

### **11.5 \[P1\] Bare ISO date is WARN, NOT block (V3 contextual matrix; AMD-V2.2-01)**

Scenario: PII guard — bare ISO date YYYY-MM-DD warns, does NOT block (V3 false-positive avoidance for SAT R\&W content)  
Tier: P1  
Tags: PRIVACY, OBSERVABILITY  
Spec section: §4.2.2 date\_iso\_bare pattern severity='warn'; AMD-V2.2-01 contextual matrix  
Owner: Engineering

Given:  
  \- Assembled prompt contains '2009-03-15' (no identity-context labels nearby)  
  \- Example real-world fixture: SAT R\&W passage about a publication date or historical event

When:  
  \- PII guard runs

Then:  
  \- date\_iso\_bare pattern matches with severity='warn'  
  \- piiGuard returns ok=true (only blocking-severity hits cause ok=false)  
  \- SLI: orchestrator\_pii\_pattern\_hit\_total{pattern\_name='date\_iso\_bare', severity='warn', callsite='main\_turn'} increments  
  \- SLI: orchestrator\_pii\_warn\_rate increments  
  \- Turn proceeds to Vertex  
  \- Verifies V2.2 AMD-V2.2-01 false-positive avoidance for legitimate SAT content

### **11.5b \[P0\] Identity-context-adjacent ISO date BLOCKS (V3 contextual matrix; AMD-V2.2-01)**

Scenario: PII guard — ISO date within 30 chars of identity-context label BLOCKS turn  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 date\_iso\_with\_identity\_context pattern; AMD-V2.2-01  
Owner: Engineering

Given:  
  \- Assembled prompt fixture A: 'student birth date is 2009-03-15' — date within 30 chars of 'student' AND 'birth'  
  \- Assembled prompt fixture B: 'guardian profile updated 2009-03-15' — date within 30 chars of 'guardian' AND 'profile'

When:  
  \- PII guard runs on each fixture independently

Then:  
  \- Fixture A: date\_iso\_with\_identity\_context BLOCKS; HTTP 400; error.code='pii\_in\_envelope'  
  \- Fixture B: same — BLOCKS  
  \- SLI: orchestrator\_pii\_blocked\_turns\_total{callsite='main\_turn'} increments per fixture  
  \- PAGE alert per §28.7 fires (any blocked turn)  
  \- Verifies V2.2 AMD-V2.2-01 contextual proximity check: identity-context-adjacent date triggers BLOCK while bare date does not

### **11.6 \[P1\] Bare US date is WARN, NOT block (V3 contextual matrix; AMD-V2.2-01)**

Scenario: PII guard — bare US date MM/DD/YYYY warns, does NOT block  
Tier: P1  
Tags: PRIVACY, OBSERVABILITY  
Spec section: §4.2.2 date\_us\_bare pattern severity='warn'; AMD-V2.2-01  
Owner: Engineering

Given:  
  \- Assembled prompt contains '03/15/2009' (variations: 3/15/2009, 03/15/09; no identity-context labels nearby)

When:  
  \- PII guard runs

Then:  
  \- date\_us\_bare pattern matches all variations with severity='warn'  
  \- piiGuard returns ok=true  
  \- Turn proceeds to Vertex

### **11.6b \[P0\] Identity-context-adjacent US date BLOCKS (V3 contextual matrix; AMD-V2.2-01)**

Scenario: PII guard — US date within 30 chars of identity-context label BLOCKS turn  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 date\_us\_with\_identity\_context pattern; AMD-V2.2-01  
Owner: Engineering

Given:  
  \- Assembled prompt: 'student account created 03/15/2009' — date within 30 chars of 'student' AND 'account'

When:  
  \- PII guard runs

Then:  
  \- date\_us\_with\_identity\_context BLOCKS; HTTP 400; error.code='pii\_in\_envelope'  
  \- SLI: orchestrator\_pii\_blocked\_turns\_total{callsite='main\_turn'} increments  
  \- PAGE alert fires

### **11.7 \[P0\] Address street pattern blocks turn**

Scenario: PII guard — street address blocks turn  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 address\_street pattern  
Owner: Engineering

Given:  
  \- Assembled prompt contains '123 Main Street' (variations: 123 Main St, 456 Oak Avenue,  
    789 Park Blvd, 555 Elm Road)

When:  
  \- PII guard runs

Then:  
  \- address\_street pattern matches all variations; blocked

### **11.8 \[P0\] Full-name label blocks turn**

Scenario: PII guard — explicit full-name labels block turn  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 name\_label pattern  
Owner: Engineering

Given:  
  \- Assembled prompt contains 'student name: Alex' (variations: full name:, first name:,  
    last name:, guardian name:, parent name:)

When:  
  \- PII guard runs

Then:  
  \- name\_label pattern matches all variations; blocked

### **11.9 \[P0\] Guardian identifier blocks turn**

Scenario: PII guard — explicit guardian identifier labels block turn  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 guardian\_id pattern  
Owner: Engineering

Given:  
  \- Assembled prompt contains 'guardian email: x' (variations: guardian id:, guardian phone:,  
    parent account:)

When:  
  \- PII guard runs

Then:  
  \- guardian\_id pattern matches; blocked

### **11.10 \[P0\] Clean prompt passes guard**

Scenario: PII guard — typical academic prompt has zero hits, passes through  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 false-negative protection  
Owner: Engineering

Given:  
  \- Standard envelope: SAT math question with reading passage about historical dates  
    formatted as ISO timestamps stripped from raw dates (per 03A V3 §6 contract)  
  \- student\_context contains only UUID-scoped references, numerical scores, categorical tags

When:  
  \- PII guard runs

Then:  
  \- piiGuard returns ok=true; no blocking hits  
  \- 03C proceeds to Vertex call  
  \- SLI: orchestrator\_pii\_blocked\_turns\_total does NOT increment

### **11.11 \[P0\] PII guard runs before Vertex (ordering)**

Scenario: PII guard — runs after content safety pre-pass, before cache lookup  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 pipeline placement  
Owner: Engineering

Given:  
  \- Envelope with PII (email pattern)  
  \- Order trace instrumentation in 03C pipeline

When:  
  \- Request processed

Then:  
  \- Order: §4.5 content safety pre-pass → §4.2.2 PII guard → BLOCKED  
  \- §VI cache lookup NOT reached  
  \- Vertex call NOT made  
  \- No data leaves 03C boundary on the failure path

### **11.12 \[P0\] PII guard does NOT log matched substring**

Scenario: PII guard — logs pattern name only, not matched value  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 privacy of guard itself  
Owner: Engineering

Given:  
  \- Envelope with email 'student@example.com'

When:  
  \- Guard blocks

Then:  
  \- Logger emits 'orchestrator\_pii\_blocked' with blocking\_patterns=\['email'\]  
  \- Log payload does NOT contain 'student@example.com' literal  
  \- Log payload does NOT contain assembledPromptBody  
  \- Verified by capturing log output and grep for the email literal — must return zero matches

### **11.13 \[P1\] ZIP code is warn severity, does not block**

Scenario: PII guard — bare 5-digit number is warn-level, does not block  
Tier: P1  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 zip\_code pattern severity='warn'  
Owner: Engineering

Given:  
  \- Assembled prompt contains '12345' (could be ZIP, could be the year in a math problem)

When:  
  \- PII guard runs

Then:  
  \- zip\_code pattern matches with severity='warn'  
  \- piiGuard returns ok=true (only blocking-severity hits cause ok=false)  
  \- SLI: orchestrator\_pii\_pattern\_hit\_total{pattern\_name='zip\_code', severity='warn'} increments  
  \- 03C proceeds to Vertex

### **11.14 \[P1\] warn\_severity\_blocks=true converts warn to block**

Scenario: PII guard — emergency runtime config blocks all warn-level hits  
Tier: P1  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §30.7 pii\_guard.warn\_severity\_blocks  
Owner: Engineering

Given:  
  \- Runtime config: pii\_guard.warn\_severity\_blocks=true  
  \- Assembled prompt contains '12345' (warn-level zip\_code hit)

When:  
  \- PII guard runs

Then:  
  \- All warn-level hits treated as blocking  
  \- piiGuard returns ok=false  
  \- HTTP 400; error.code='pii\_in\_envelope'

### **11.15a \[P0\] Production startup REJECTS pii\_guard.enabled=false without break-glass (V2.2 AMD-V2.2-02)**

Scenario: PII guard config — production env rejects disabled config without break-glass  
Tier: P0  
Tags: PRIVACY, AUTH, NO\_FAIL\_OPEN  
Spec section: §30.7 V2.2 break-glass; §28.8 configuration failures; AMD-V2.2-02  
Owner: Engineering / Ops (joint)

Given:  
  \- Environment: LISA\_ENV='production'  
  \- Runtime config: pii\_guard.enabled=false; pii\_guard.break\_glass\_ticket\_id=null

When:  
  \- 03C process starts (validatePiiGuardConfigOrCrash runs at boot)

Then:  
  \- Boot FAILS with thrown Error containing message 'CONFIG ERROR: pii\_guard.enabled=false requires pii\_guard.break\_glass\_ticket\_id in production'  
  \- Cloud Run revision deploy halts; readiness probe fails; auto-rollback to prior revision  
  \- SLI / log event: configuration error event captured  
  \- Verifies AMD-V2.2-02 contract: production cannot silently disable PII guard

### **11.15b \[P0\] Production startup ACCEPTS valid break-glass ticket \+ future expiration ≤4hr (V2.2 AMD-V2.2-02)**

Scenario: PII guard config — production accepts valid break-glass with proper ticket and expiration  
Tier: P0  
Tags: PRIVACY, AUTH, AUDITABILITY  
Spec section: §30.7 V2.2; §30.7.1 break-glass procedure  
Owner: Engineering / Ops (joint)

Given:  
  \- Environment: LISA\_ENV='production'  
  \- Runtime config:  
    \- pii\_guard.enabled=false  
    \- pii\_guard.break\_glass\_ticket\_id='INC-2026-04-29-001' (valid UUID-like)  
    \- pii\_guard.break\_glass\_expires\_at=ISO timestamp 3.5 hours in future (within 4hr max)

When:  
  \- 03C process starts

Then:  
  \- Boot SUCCEEDS  
  \- Log event 'pii\_guard\_break\_glass\_active\_at\_startup' emitted with ticket\_id and expires\_at  
  \- PAGE alert fires per §28.8 (any boot event with break-glass active)  
  \- Cloud Run instance becomes ready

Sub-test 11.15b.bad-1 \[P0\] (expiration \>4hr):  
  Given:  
    \- pii\_guard.break\_glass\_expires\_at \= 5 hours in future (\>4hr max)  
  Then:  
    \- Boot FAILS with 'CONFIG ERROR: pii\_guard.break\_glass\_expires\_at exceeds 4-hour maximum window'

Sub-test 11.15b.bad-2 \[P0\] (expiration in past):  
  Given:  
    \- pii\_guard.break\_glass\_expires\_at \= past ISO timestamp  
  Then:  
    \- Boot FAILS with 'CONFIG ERROR: pii\_guard.break\_glass\_expires\_at is in the past'

Sub-test 11.15b.bad-3 \[P0\] (missing expiration):  
  Given:  
    \- pii\_guard.break\_glass\_ticket\_id present but pii\_guard.break\_glass\_expires\_at=null  
  Then:  
    \- Boot FAILS with 'CONFIG ERROR: pii\_guard.break\_glass\_ticket\_id requires pii\_guard.break\_glass\_expires\_at'

### **11.15c \[P0\] Per-turn paging while break-glass active (V2.2 AMD-V2.2-02)**

Scenario: PII guard runtime — every turn during break-glass logs and pages  
Tier: P0  
Tags: PRIVACY, AUDITABILITY, OBSERVABILITY  
Spec section: §30.7 break-glass per-turn enforcement  
Owner: Engineering

Given:  
  \- 03C running in production with break-glass active (per §11.15b config)  
  \- Three sequential turns processed, each with assembled prompt that would normally hit PII patterns

When:  
  \- Turns 1, 2, 3 process

Then:  
  \- For each turn: logger.error 'pii\_guard\_disabled\_turn' emitted with request\_id, student\_id, callsite, break\_glass\_ticket\_id, break\_glass\_expires\_at  
  \- SLI: pii\_guard\_disabled\_turns\_total{callsite='main\_turn'} increments 3 times  
  \- PAGE alert fires per §28.7 on first hit in 1-min window (subsequent hits within window suppressed per Cloud Monitoring policy)  
  \- Each turn proceeds to Vertex despite PII presence (break-glass active)  
  \- This verifies §30.7 per-turn enforcement: even when disabled, every disabled-mode turn is auditable

Sub-test 11.15c.expired \[P0\]:  
  Given:  
    \- Same setup, but pii\_guard.break\_glass\_expires\_at has now passed (e.g., process running 4.5 hours)  
  When:  
    \- Turn 4 processes  
  Then:  
    \- preVertexPiiCheckWithBreakGlass throws ConfigError('pii\_guard break-glass has expired')  
    \- Turn fails with HTTP 500 internal\_error  
    \- Process logs critical event; ops must restart with valid config  
    \- This verifies fail-closed behavior on expiration

### **11.16 \[P1\] PII guard latency P95 \<12ms (V3 — F-V3-07/F-V3-08 matchAll iteration)**

Scenario: PII guard — performance bound verified with V3 matchAll iteration  
Tier: P1  
Tags: OBSERVABILITY  
Spec section: §4.2.2 V3 performance bound; F-V3-07/F-V3-08  
Owner: Engineering  
Note: Load test, not unit/integration

Given:  
  \- Mixed prompt corpus: 1000 prompts ranging 2k-16k tokens

When:  
  \- PII guard runs over each

Then:  
  \- P95 latency \<12ms (V3 — matchAll iteration; up from V2.2 \<8ms target)  
  \- P99 latency \<25ms  
  \- No outliers \>75ms (would indicate regex pathological case)

### **11.17 \[P1\] PII guard fixture coverage table**

Scenario: PII guard — fixture coverage matrix per pattern  
Tier: P1  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2; fixture conventions §3.4  
Owner: Engineering

Given:  
  \- Fixture directory apps/lisa-orchestrator/src/\_\_fixtures\_\_/pii/ contains:  
    \- email\_positive\_\*.txt (5 variations: simple, with subdomain, with plus, edu, intl)  
    \- email\_negative\_\*.txt (5 false-positive checks: '@' alone, partial address, code refs)  
    \- phone\_us\_positive\_\*.txt (5 formats)  
    \- phone\_intl\_positive\_\*.txt (5 country codes)  
    \- dob\_positive\_\*.txt (5 label variations)  
    \- date\_iso\_positive\_\*.txt  
    \- date\_us\_positive\_\*.txt  
    \- address\_positive\_\*.txt (5 street types)  
    \- address\_negative\_\*.txt (street name without type)  
    \- name\_label\_positive\_\*.txt  
    \- guardian\_id\_positive\_\*.txt  
    \- clean\_prompt\_\*.txt (10 academic content samples)

When:  
  \- Tests iterate over fixtures

Then:  
  \- Every positive fixture triggers expected pattern with severity='block'  
  \- Every negative fixture does NOT trigger blocking pattern  
  \- clean\_prompt\_\* passes guard cleanly with zero hits

### **11.18 \[P1\] Multiple patterns hit on single prompt**

Scenario: PII guard — prompt with email \+ phone reports both patterns  
Tier: P1  
Tags: OBSERVABILITY, PRIVACY  
Spec section: §4.2.2 piiGuardResult shape  
Owner: Engineering

Given:  
  \- Assembled prompt contains email 'a@b.com' AND phone '555-123-4567'

When:  
  \- Guard runs

Then:  
  \- piiGuardResult.hits has 2 entries: pattern\_name='email', pattern\_name='phone\_us'  
  \- Both severity='block'  
  \- SLI emits twice: once per pattern  
  \- Logger 'blocking\_patterns'=\['email', 'phone\_us'\]

### **11.19 \[P0\] PII guard runs before Vertex.createCachedContent (V2.2 MTC-V2.2-01)**

Scenario: PII guard pre-cache — composite content checked before cache creation  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §6.5.1 pre-cache PII check; MTC-V2.2-01  
Owner: Engineering

Given:  
  \- Envelope: clean main turn (no PII in main prompt body)  
  \- But: composite content (policy\_instruction \+ teaching\_profile\_summary) contains email 'student@example.com' (simulating upstream envelope-builder bug where teaching\_profile leaks PII)  
  \- Cache miss path: tutor\_vertex\_context\_cache has no row for the cache\_key

When:  
  \- 03C reaches createCompositeCache with cache miss

Then:  
  \- preVertexPiiCheck called with callsite='cache\_creation' BEFORE Vertex.createCachedContent invocation  
  \- PII detected in composite content; throws PiiInEnvelopeError  
  \- Vertex.createCachedContent NEVER called (verified via mock spy)  
  \- tutor\_vertex\_context\_cache row NEVER inserted  
  \- Turn returns HTTP 400 error.code='pii\_in\_envelope' to 03B  
  \- SLI: orchestrator\_pii\_blocked\_turns\_total{callsite='cache\_creation'} increments  
  \- PAGE alert fires per §28.7 (block-severity hit on cache\_creation callsite)  
  \- Verifies V2.2 MTC-V2.2-01: PII never persisted server-side via Vertex cache

### **11.20 \[P0\] Matchall iteration catches second-match identity-context (V3 F-V3-07 correctness fix)**

Scenario: PII guard — second match in identity context BLOCKS even when first match was non-adjacent (V2.2 bug fixed in V3)  
Tier: P0  
Tags: PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 V3 matchAll iteration; F-V3-07 fix  
Owner: Engineering

Given:  
  \- Assembled prompt contains TWO ISO dates:  
    \- First occurrence: '...the war began in 1914-07-28 and ended...' (no identity context within ±30 chars)  
    \- Second occurrence: '...the student account was created 2009-03-15 with...' (identity context 'student' \+ 'account' within ±30 chars)

When:  
  \- PII guard runs (V3 algorithm using matchAll)

Then:  
  \- matchAll returns BOTH date occurrences as match objects  
  \- First match checked for identity proximity → no labels found → contextual hit skipped (continues)  
  \- Second match checked for identity proximity → 'student' AND 'account' found within ±30 chars → BLOCK hit recorded  
  \- piiGuard returns ok=false  
  \- HTTP 400; error.code='pii\_in\_envelope'  
  \- SLI: orchestrator\_pii\_blocked\_turns\_total{callsite='main\_turn'} increments  
  \- SLI: orchestrator\_pii\_pattern\_hit\_total{pattern\_name='date\_iso\_with\_identity\_context', severity='block', callsite='main\_turn'} increments

Sub-test 11.20.regression \[P0\] (verifies V2.2 bug):  
  Given:  
    \- Same fixture  
  When:  
    \- Hypothetically run V2.2 algorithm using pattern.exec() (first-match-only)  
  Then:  
    \- First match (the war date) checked for proximity → no identity context → contextual rule skips  
    \- V2.2 algorithm STOPS HERE (only checks first match)  
    \- Second match (student account date) NEVER CHECKED — silent PII leak  
  This sub-test exists to document the regression risk: any future change that reverts to first-match-only logic causes this scenario to fail. F-V3-07 fix is permanent; matchAll iteration is required.

---

## **§12 Pro→Flash fallback & budget circuit breaker**

Maps to §5.3.2 fallback \+ §5.3.3 budget circuit breaker.

### **12.1 \[P0\] Pro 5xx fallback to Flash succeeds**

Scenario: Fallback — Pro 5xx triggers Flash retry; turn succeeds  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.3.2 Pro→Flash fallback  
Owner: Engineering

Given:  
  \- Envelope routed to Pro per §5.3.1  
  \- Mocked Vertex Pro returns 503 after retry budget exhausted  
  \- Mocked Vertex Flash returns valid response

When:  
  \- 03C handles Pro failure

Then:  
  \- 03C invokes Flash with same prompt (same cache reference if cache exists for Flash key)  
  \- Turn succeeds  
  \- orchestration\_meta.fallback\_applied=true  
  \- orchestration\_meta.model\_alias='flash\_class' (resolves to 'gemini-2.5-flash' per §30.1 config)  
  \- SLI: vertex\_pro\_fallback\_rate increments  
  \- SLI: vertex\_pro\_fallback\_success\_rate increments

### **12.2 \[P0\] Pro 429 quota fallback to Flash**

Scenario: Fallback — Pro 429 quota triggers Flash retry  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.3.2  
Owner: Engineering

Given:  
  \- Pro returns 429  
  \- Flash succeeds

When:  
  \- 03C handles

Then:  
  \- Same as 12.1: Flash invoked, fallback\_applied=true

### **12.3 \[P0\] Pro timeout fallback to Flash**

Scenario: Fallback — Pro timeout triggers Flash retry  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.3.2  
Owner: Engineering

Given:  
  \- Pro call exceeds runtime\_limits.timeout\_ms  
  \- Flash succeeds within remaining budget

When:  
  \- 03C handles

Then:  
  \- Flash invoked with bounded timeout (remaining budget)  
  \- Turn succeeds; fallback\_applied=true  
  \- If Flash also times out: HTTP 504; error.code='vertex\_timeout'

### **12.4 \[P0\] Both Pro and Flash fail**

Scenario: Fallback — Pro 503 \+ Flash 503 → final error  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.3.2 fallback exhaustion  
Owner: Engineering

Given:  
  \- Pro returns 503  
  \- Flash returns 503

When:  
  \- 03C handles

Then:  
  \- HTTP 503; error.code='vertex\_5xx\_retriable'; retryable=true  
  \- SLI: vertex\_pro\_fallback\_rate increments  
  \- SLI: vertex\_pro\_fallback\_failure\_rate increments  
  \- 03B retries turn per §5.8 (client side)

### **12.5 \[P0\] Budget circuit breaker trips at 100% daily spend**

Scenario: Budget circuit breaker — daily Pro spend hits cap, breaker trips  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.3.3 budget circuit breaker  
Owner: Engineering

Given:  
  \- Runtime config: vertex.pro.daily\_budget\_usd=200  
  \- Today's accumulated Pro spend reaches $200  
  \- vertex.pro.budget\_circuit\_breaker\_enabled=true

When:  
  \- Next turn that would route to Pro

Then:  
  \- Budget circuit breaker tripped  
  \- 03C automatically routes to Flash for this turn (Pro effectively disabled)  
  \- orchestration\_meta.fallback\_applied=true with reason='budget\_circuit\_breaker'  
  \- SLI: vertex\_pro\_budget\_circuit\_breaker\_state=1 (gauge)  
  \- PAGE alert per §28.2  
  \- Breaker stays tripped until midnight UTC reset

### **12.6 \[P0\] Budget circuit breaker warning at 80%**

Scenario: Budget circuit breaker — 80% threshold emits warn  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.3.3 warning threshold  
Owner: Engineering

Given:  
  \- Runtime config: vertex.pro.daily\_budget\_usd=200  
  \- vertex.pro.budget\_circuit\_breaker\_warning\_pct=80  
  \- Today's accumulated spend reaches $160 (80%)

When:  
  \- 03C accumulates spend metric

Then:  
  \- Pro routing continues normally (NOT yet tripped)  
  \- SLI: vertex\_pro\_budget\_warning\_state=1 (gauge)  
  \- Logger warn: 'pro\_budget\_warning\_threshold\_reached'  
  \- Alert WARN (not page) per §28.2

### **12.7 \[P1\] Daily budget reset at UTC midnight**

Scenario: Budget circuit breaker — daily counter resets at 00:00 UTC  
Tier: P1  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §5.3.3 reset cadence  
Owner: Engineering

Given:  
  \- Yesterday: budget exhausted, breaker tripped  
  \- Fake clock advances past 00:00 UTC

When:  
  \- First Pro-routed turn after reset

Then:  
  \- Counter reset to $0  
  \- Breaker state transitions tripped → closed  
  \- Pro routing resumes normally  
  \- SLI: vertex\_pro\_budget\_circuit\_breaker\_state=0

### **12.8 \[P1\] Budget circuit breaker disabled config**

Scenario: Budget circuit breaker — runtime disable bypasses budget check  
Tier: P1  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §30.1 vertex.pro.budget\_circuit\_breaker\_enabled  
Owner: Engineering  
Note: emergency-only configuration

Given:  
  \- Runtime config: vertex.pro.budget\_circuit\_breaker\_enabled=false  
  \- Spend exceeds daily budget

When:  
  \- Pro-routed turn

Then:  
  \- Pro called normally (no breaker check)  
  \- Logger info: 'budget\_circuit\_breaker\_disabled'  
  \- SLI: vertex\_pro\_budget\_circuit\_breaker\_state=-1 (gauge sentinel for disabled)

### **12.9 \[P1\] Fallback observability — fallback\_applied propagates**

Scenario: Fallback — orchestration\_meta.fallback\_applied=true on every fallback type  
Tier: P1  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §7.1 orchestration\_meta  
Owner: Engineering

Given:  
  \- Three fallback scenarios: Pro 5xx, Pro 429, budget circuit breaker

When:  
  \- Each scenario triggers fallback

Then:  
  \- Response envelope orchestration\_meta.fallback\_applied=true in all three cases  
  \- orchestration\_meta.model\_alias='flash\_class' (resolves to 'gemini-2.5-flash' per §30.1 config) in all three  
  \- orchestration\_meta.fallback\_reason in {'pro\_5xx', 'pro\_quota', 'budget\_circuit\_breaker'} accordingly

### **12.10 \[P1\] Fallback rate alert thresholds**

Scenario: Fallback — sustained \>5% rate triggers warn alert  
Tier: P1  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §28.2 vertex\_pro\_fallback\_rate  
Owner: Engineering  
Note: Load/observability test

Given:  
  \- 1-hour window of traffic where 6% of turns trigger fallback

When:  
  \- Alert evaluation runs

Then:  
  \- WARN alert: 'vertex\_pro\_fallback\_rate exceeded 5%'  
  \- PAGE if exceeds 10% per §28.2

---

## **§13 Async jobs (compaction, refresh, reconciliation)**

Maps to §VIII async jobs, biggest section. Covers compaction, MemoryRefreshWorker T1/T2/generation, PendingReconciliationWorker.

### **13.1 \[P0\] Compaction job happy path**

Scenario: Compaction — conversation closed; compaction job runs end-to-end  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.3 conversation-close compaction; 03A V3 §14  
Owner: Engineering

Given:  
  \- Conversation has 22 turns (\>20 threshold) and is marked closed  
  \- Cloud Tasks compaction queue receives task  
  \- Mocked Vertex Flash returns valid summary

When:  
  \- lisa-memory-worker handles task

Then:  
  \- 03C reads tutor\_messages for conversation  
  \- Vertex called with model=resolveProviderModel('flash\_class', runtimeConfig) (per 03A V3 §14.5)  
  \- INSERT into tutor\_memory\_summaries with summary\_type='chat\_compaction'  
  \- NOTIFY emitted on dependent cache invalidation per 03B §12B.5.1  
  \- SLI: async\_job\_success\_rate{job\_type='compaction'} increments  
  \- SLI: async\_job\_latency\_p95{job\_type='compaction'} records

### **13.2 \[P0\] MemoryRefreshWorker T1 happy path**

Scenario: Memory refresh T1 — invalidate \+ pending insert  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.4.1 T1 transaction  
Owner: Engineering

Given:  
  \- Cloud Tasks memory-refresh queue receives task: student\_id='abc-123', summary\_type='teaching\_profile'  
  \- tutor\_memory\_summaries has row at summary\_version=5, status='ready'  
  \- tutor\_vertex\_context\_cache has student\_composite rows for this student

When:  
  \- lisa-memory-worker handles T1

Then:  
  \- Advisory lock acquired: pg\_try\_advisory\_lock(hashtext('memory\_refresh:abc-123'))  
  \- Inside transaction:  
    \- SELECT MAX(summary\_version) FOR UPDATE returns 5; new\_version=6  
    \- UPDATE tutor\_vertex\_context\_cache SET invalidated\_at=now() for student\_composite rows  
    \- INSERT new row at summary\_version=6, status='pending', content\_json='{}'  
    \- NOTIFY emitted on 'teaching\_profile\_updated'  
  \- T1 commits within 100ms (P95 target)  
  \- SLI: memory\_refresh\_t1\_latency\_ms records

### **13.3 \[P0\] MemoryRefreshWorker generation phase**

Scenario: Memory refresh generation — Vertex Flash produces new summary  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.4.1 out-of-transaction generation  
Owner: Engineering

Given:  
  \- T1 completed; pending row at summary\_version=6  
  \- Mocked Vertex Flash returns valid summary

When:  
  \- Generation phase executes

Then:  
  \- Source data loaded: practice attempts, review sessions, full-length history, KPI, mastery  
  \- Vertex called with model='gemini-2.5-flash', timeoutMs=240000  
  \- Returns valid contentJson  
  \- SLI: memory\_refresh\_generation\_latency\_ms records (target \<60s)

### **13.4 \[P0\] MemoryRefreshWorker T2 happy path**

Scenario: Memory refresh T2 — fill content \+ transition to ready  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.4.1 T2 transaction  
Owner: Engineering

Given:  
  \- Generation completed; contentJson populated  
  \- Pending row at summary\_version=6 still exists

When:  
  \- T2 executes

Then:  
  \- UPDATE tutor\_memory\_summaries SET content\_json=$1, status='ready', ready\_at=now()  
    WHERE student\_id, summary\_type, summary\_version=6 AND status='pending'  
  \- rowCount=1  
  \- NOTIFY emitted on 'teaching\_profile\_ready'  
  \- Advisory lock released by handler finally clause  
  \- SLI: memory\_refresh\_t2\_latency\_ms records  
  \- SLI: memory\_refresh\_success\_total increments

### **13.5 \[P0\] MemoryRefreshWorker advisory lock contention**

Scenario: Memory refresh — concurrent task for same student fast-fails  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.4.2 advisory lock scope  
Owner: Engineering

Given:  
  \- Worker A is in generation phase for student\_id='abc-123' (advisory lock held)  
  \- Cloud Tasks delivers second task for same student to Worker B

When:  
  \- Worker B attempts T1

Then:  
  \- pg\_try\_advisory\_lock returns false  
  \- Worker B throws ConcurrentRefreshError  
  \- Cloud Tasks retries Worker B with backoff  
  \- SLI: memory\_refresh\_failure\_total{phase='lock\_contention'} increments  
  \- When Worker A completes and releases lock, retry of Worker B succeeds

### **13.6 \[P0\] PendingReconciliationWorker sweep query**

Scenario: Reconciliation — sweep finds rows older than pending\_timeout\_minutes  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.5.2 sweep query  
Owner: Engineering

Given:  
  \- tutor\_memory\_summaries rows:  
    \- row A: status='pending', created\_at=now()-15 minutes  
    \- row B: status='pending', created\_at=now()-5 minutes  
    \- row C: status='ready', created\_at=now()-15 minutes

When:  
  \- Sweep runs (default 5min cadence; pending\_timeout\_minutes=10)

Then:  
  \- Sweep query SELECT FOR UPDATE SKIP LOCKED returns row A only  
  \- Row B excluded (within timeout window)  
  \- Row C excluded (not pending)  
  \- Per-row reconciliation task enqueued for row A

### **13.7 \[P0\] PendingReconciliationWorker handler marks failed and re-enqueues**

Scenario: Reconciliation — handler transitions pending→failed, enqueues fresh refresh  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.5.3 reconciliation handler  
Owner: Engineering

Given:  
  \- Reconciliation task for row\_id of pending row (created\_at \>10min ago)

When:  
  \- Handler runs

Then:  
  \- Inside transaction: row re-verified pending and old; UPDATE SET status='failed', ready\_at=now()  
  \- SLI: memory\_refresh\_reconciled\_failed\_total{summary\_type=...} increments  
  \- Outside transaction: enqueueRefreshTask called with trigger\_reason='reconciliation\_retry',  
    previous\_attempt\_summary\_version=\<failed version\>  
  \- SLI: memory\_refresh\_reconciliation\_re\_enqueued\_total increments

### **13.8 \[P0\] PendingReconciliationWorker re-verification skips already-ready row**

Scenario: Reconciliation — row transitioned to ready between sweep and handler; no-op  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.5.4 concurrency safety  
Owner: Engineering

Given:  
  \- Sweep enqueued reconciliation for row A (was pending)  
  \- Between sweep and handler execution, T2 of original refresh completes successfully:  
    row A status='ready'

When:  
  \- Reconciliation handler runs

Then:  
  \- Re-verification query (status='pending' AND created\_at\<now()-10min) returns 0 rows  
  \- Logger info: 'reconciliation.row\_not\_eligible'  
  \- No mark-as-failed; no re-enqueue  
  \- Handler exits cleanly

### **13.9 \[P0\] PendingReconciliationWorker FOR UPDATE SKIP LOCKED concurrency**

Scenario: Reconciliation — two concurrent sweep instances do not double-enqueue  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.5.2 FOR UPDATE SKIP LOCKED  
Owner: Engineering

Given:  
  \- 5 eligible pending rows  
  \- Two sweep instances running concurrently

When:  
  \- Both query

Then:  
  \- First sweep locks rows; receives subset A  
  \- Second sweep skips locked rows; receives subset B  
  \- A ∩ B \= ∅ (no overlap)  
  \- A ∪ B \= all 5 eligible rows  
  \- Each row enqueued exactly once

### **13.10 \[P0\] Compaction Cloud Tasks retry on handler 5xx**

Scenario: Compaction — handler returns 500; Cloud Tasks retries  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.2 retry policy  
Owner: Engineering

Given:  
  \- Compaction handler throws on first invocation

When:  
  \- Cloud Tasks observes 500

Then:  
  \- Cloud Tasks waits 5s (min backoff)  
  \- Retries up to 5 times with exponential backoff (capped at 300s)  
  \- SLI: async\_job\_retry\_rate{queue='lisa-compaction'} increments  
  \- On success during retry: async\_job\_success\_rate increments

### **13.11 \[P0\] Cloud Tasks dead-letter behavior**

Scenario: Compaction — handler fails 5 times; task dead-lettered  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.2 dead letter behavior  
Owner: Engineering

Given:  
  \- Compaction handler fails on every retry

When:  
  \- All 5 retries exhausted

Then:  
  \- Task marked dead-letter in Cloud Tasks  
  \- Cloud Logging emits dead-letter event  
  \- SLI: async\_job\_dead\_letter\_rate{queue='lisa-compaction'} increments  
  \- SEV-2 alert per §28.5 if dead-letter rate \>1/hr

### **13.12 \[P0\] MemoryRefreshWorker advisory lock released on worker crash**

Scenario: Memory refresh — worker process killed mid-generation; lock auto-released  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.4.2 stuck-lock recovery; §8.4.4 worker crash mid-handler  
Owner: Chaos test

Given:  
  \- Worker handling memory refresh; advisory lock held  
  \- Generation phase in progress (Vertex call pending)

When:  
  \- SIGKILL sent to worker process

Then:  
  \- Connection drops to Postgres  
  \- Postgres releases advisory lock automatically  
  \- Pending row remains in tutor\_memory\_summaries  
  \- 10 minutes later: PendingReconciliationWorker sweeps the orphaned pending row  
  \- Reconciliation marks failed and re-enqueues  
  \- New worker picks up retry task; succeeds

### **13.13 \[P0\] FOR UPDATE on version computation prevents race**

Scenario: Memory refresh — FOR UPDATE blocks concurrent T1 even if advisory lock fails  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §28C.4 V2.1 review-swipe defense-in-depth  
Owner: Engineering

Given:  
  \- Hypothetical: advisory lock check is bypassed (e.g., via direct test injection)  
  \- Two concurrent T1s for same (student\_id, summary\_type)

When:  
  \- Both reach SELECT MAX(summary\_version) \+ 1 FOR UPDATE simultaneously

Then:  
  \- First T1 acquires row lock; computes new\_version=N+1; commits  
  \- Second T1 blocks on FOR UPDATE; after first commits, sees updated MAX; computes new\_version=N+2  
  \- No two T1s produce same summary\_version  
  \- Unique constraint on (student\_id, summary\_type, summary\_version) never violated

### **13.14 \[P0\] Compaction job correlates request\_id**

Scenario: Compaction — task payload includes request\_id; logs correlate  
Tier: P0  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.7 logging correlation  
Owner: Engineering

Given:  
  \- Originating turn at request\_id='req-abc'  
  \- Conversation closes; compaction enqueued

When:  
  \- Handler runs

Then:  
  \- Task payload contains origin\_request\_id='req-abc'  
  \- All handler logs include origin\_request\_id field  
  \- Tracing query for 'req-abc' surfaces both the originating turn AND the compaction job

### **13.15 \[P1\] Compaction handler timeout**

Scenario: Compaction — handler exceeds 5min timeout; Cloud Tasks retries  
Tier: P1  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.2 deadline per task  
Owner: Engineering

Given:  
  \- Mocked Vertex hangs (never returns)

When:  
  \- Handler timeout fires

Then:  
  \- Connection terminated  
  \- Cloud Tasks sees timeout; retries with backoff  
  \- SLI: async\_job\_latency\_p95 records timeout case

### **13.16 \[P1\] Memory refresh trigger reasons recorded**

Scenario: Memory refresh — every trigger\_reason value handled correctly  
Tier: P1  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.4 task payload  
Owner: Engineering

Given:  
  \- Three task payloads with trigger\_reason in {'scheduled', 'data\_event', 'reconciliation\_retry'}

When:  
  \- Each handler runs

Then:  
  \- All three execute identical T1+generation+T2 flow  
  \- Logs include trigger\_reason field  
  \- SLI: async\_job\_success\_rate{trigger\_reason=...} per-reason buckets

### **13.17 \[P1\] T2 finds no pending row (race recovery)**

Scenario: Memory refresh — T2 rowCount=0 because reconciliation marked failed first  
Tier: P1  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.4.1 T2 no-pending-row handling  
Owner: Engineering

Given:  
  \- T1 \+ generation completed for summary\_version=6  
  \- Reconciliation worker (running concurrently) marked the pending row as 'failed' due to timing edge  
  \- T2 attempts UPDATE WHERE status='pending'

When:  
  \- T2 runs

Then:  
  \- rowCount=0  
  \- Logger warn: 'memory\_refresh.t2\_no\_pending\_row' with summary\_version=6  
  \- SLI: memory\_refresh\_t2\_no\_pending\_row\_total increments  
  \- Handler exits cleanly (no error thrown; reconciliation will re-enqueue)

### **13.18 \[P1\] Compaction job idempotency**

Scenario: Compaction — duplicate task delivery does not double-write  
Tier: P1  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.0 ownership; idempotency expectation  
Owner: Engineering

Given:  
  \- Same (conversation\_id, compaction\_request\_id) delivered twice by Cloud Tasks

When:  
  \- Both handlers run

Then:  
  \- First handler INSERTs summary row  
  \- Second handler detects existing summary at same version; no-op OR overwrites with identical content  
  \- No duplicate rows in tutor\_memory\_summaries

### **13.19 \[P1\] Reconciliation handler idempotency**

Scenario: Reconciliation — duplicate task delivery does not double-mark or double-enqueue  
Tier: P1  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.5.4  
Owner: Engineering

Given:  
  \- Same row\_id delivered twice to reconciliation queue

When:  
  \- Both handlers run

Then:  
  \- First handler: marks failed, enqueues retry  
  \- Second handler: re-verification query returns 0 rows (status='failed', not 'pending')  
  \- Logger info: 'reconciliation.row\_not\_eligible'  
  \- No double-enqueue

### **13.20 \[P1\] Pending-window timeout configurable**

Scenario: Reconciliation — memory\_refresh.pending\_timeout\_minutes=2 shortens window  
Tier: P1  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §30.4 pending\_timeout\_minutes  
Owner: Engineering

Given:  
  \- Runtime config: memory\_refresh.pending\_timeout\_minutes=2  
  \- Pending row created 3 minutes ago

When:  
  \- Sweep runs

Then:  
  \- Row eligible (3 min \> 2 min timeout)  
  \- Reconciliation task enqueued

### **13.21 \[P1\] Bulk refresh under rate limit**

Scenario: Memory refresh — 1000 students bulk-enqueued; queue rate-limits ingestion  
Tier: P1  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.2 rate limit 50 req/s  
Owner: Engineering  
Note: Load test

Given:  
  \- 1000 memory-refresh tasks enqueued in burst

When:  
  \- Cloud Tasks dispatches at 50 req/s

Then:  
  \- Total drain time \~20 seconds (1000/50)  
  \- No queue overflow  
  \- All 1000 handlers eventually succeed (subject to retry on transient failures)

### **13.22 \[P1\] Async writeback scope enforcement**

Scenario: Async jobs — handler attempts write to disallowed table; RLS rejects  
Tier: P1  
Tags: IDEMPOTENCY, AUDITABILITY  
Spec section: §8.7 bounded writeback scope  
Owner: Engineering

Given:  
  \- Mocked handler attempts INSERT into student\_question\_attempts (disallowed for lisa-memory-worker@)

When:  
  \- Query executes

Then:  
  \- Postgres RLS rejects with permission denied  
  \- Handler logs error  
  \- Test verifies that lisa-memory-worker@ has WRITE only on tutor\_memory\_summaries and tutor\_vertex\_context\_cache; no other tables

---

## **§14 Circuit breaker**

Maps to §10.2 per-instance circuit breaker.

### **14.1 \[P0\] Warmup period prevents premature trip**

Scenario: Circuit breaker — first 10 calls cannot trip the breaker  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §10.2.2 warmup period  
Owner: Engineering

Given:  
  \- Fresh Cloud Run instance (in-memory breaker state initialized)  
  \- Mocked Vertex returns 503 on first 5 calls

When:  
  \- 5 calls made during warmup

Then:  
  \- Circuit breaker remains closed despite 100% error rate  
  \- SLI: vertex\_circuit\_breaker\_state='closed' (warmup not enough samples)  
  \- SLI: vertex\_circuit\_breaker\_warmup\_active=1

### **14.2 \[P0\] Trip after warmup at \>50% error rate**

Scenario: Circuit breaker — trips when error\_rate\_threshold=0.5 exceeded post-warmup  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §10.2.3 state machine; §28.2  
Owner: Engineering

Given:  
  \- Past warmup: 10 prior successful calls  
  \- Subsequent 10 calls in 60s window: 6 fail, 4 succeed (60% error rate)

When:  
  \- 11th call attempted

Then:  
  \- Breaker tripped (60% \> 50% threshold)  
  \- 11th call short-circuits without invoking Vertex  
  \- HTTP 503 with Retry-After: 30s  
  \- SLI: vertex\_circuit\_breaker\_trip\_count, vertex\_circuit\_breaker\_state='tripped'  
  \- PAGE alert per §28.2

### **14.3 \[P0\] Half-open probe success closes breaker**

Scenario: Circuit breaker — half-open probe succeeds; breaker closes  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §10.2.3  
Owner: Engineering

Given:  
  \- Breaker tripped 30s ago  
  \- Vertex now healthy

When:  
  \- First call after 30s timeout

Then:  
  \- Breaker tripped → half-open  
  \- Probe call invokes Vertex; succeeds  
  \- Breaker half-open → closed  
  \- Subsequent traffic resumes normal  
  \- SLI: vertex\_circuit\_breaker\_state='closed'

### **14.4 \[P0\] Half-open probe failure re-trips breaker**

Scenario: Circuit breaker — half-open probe fails; breaker re-trips  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §10.2.3  
Owner: Engineering

Given:  
  \- Breaker tripped 30s ago  
  \- Vertex still failing

When:  
  \- First call after 30s; breaker enters half-open  
  \- Probe call invokes Vertex; 503

Then:  
  \- Probe failure detected  
  \- Breaker half-open → tripped (re-trip)  
  \- 30s timeout reset  
  \- Subsequent calls again short-circuit

### **14.5 \[P0\] Per-instance scope (no shared state)**

Scenario: Circuit breaker — instance A trips; instance B unaffected  
Tier: P0  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §10.2.1 per-instance scope V1  
Owner: Engineering

Given:  
  \- Two Cloud Run instances A and B serving traffic  
  \- Instance A: breaker tripped due to local error rate  
  \- Instance B: 100% success rate locally

When:  
  \- Traffic distributed across both

Then:  
  \- Instance A: short-circuits to 503  
  \- Instance B: routes Vertex normally; succeeds  
  \- Per-instance state confirmed via instance\_id tag in SLI emissions

### **14.6 \[P1\] Configuration override via runtime config**

Scenario: Circuit breaker — error\_rate\_threshold updated via runtime config takes effect  
Tier: P1  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §30.1 vertex.circuit\_breaker.error\_rate\_threshold; 03A V3 §18.7 runtime config  
Owner: Engineering

Given:  
  \- Default threshold 0.5  
  \- Runtime config updates to 0.3 via LISTEN/NOTIFY

When:  
  \- Threshold change propagates to instance

Then:  
  \- In-memory threshold updated to 0.3 within 5s of NOTIFY  
  \- Subsequent error-rate evaluation uses new threshold  
  \- Logger info: 'circuit\_breaker\_threshold\_updated'

### **14.7 \[P1\] Window slides correctly (60s rolling)**

Scenario: Circuit breaker — error rate reflects only most-recent 60s  
Tier: P1  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §30.1 vertex.circuit\_breaker.window\_seconds  
Owner: Engineering

Given:  
  \- 5 errors at t=0, then 60s passes with 10 successes

When:  
  \- At t=61s, error rate evaluated

Then:  
  \- Errors at t=0 fall outside window  
  \- Current window: 0 errors / 10 successes \= 0% error rate  
  \- Breaker remains closed

### **14.8 \[P1\] Breaker observability**

Scenario: Circuit breaker — state transitions emit SLIs  
Tier: P1  
Tags: NO\_FAIL\_OPEN, OBSERVABILITY  
Spec section: §11.2 vertex\_circuit\_breaker\_state  
Owner: Engineering

Given:  
  \- Breaker transitions: closed → tripped → half-open → closed

When:  
  \- Each transition occurs

Then:  
  \- SLI emits gauge for each state with timestamp  
  \- vertex\_circuit\_breaker\_trip\_count counter increments on every closed→tripped  
  \- vertex\_circuit\_breaker\_recovery\_count counter increments on every half-open→closed

---

## **§15 Authentication (HMAC, OIDC, IAM)**

Maps to §IX service-to-service auth \+ §28.6 deployment failures.

### **15.1 \[P0\] HMAC sign \+ verify roundtrip**

Scenario: Auth — 03B signs envelope with HMAC; 03C verifies successfully  
Tier: P0  
Tags: AUTH  
Spec section: §IX.1; 01A Part VII §62  
Owner: Engineering

Given:  
  \- Shared HMAC\_SIGNING\_KEY (test fixture)  
  \- 03B uses signHmac() helper to sign envelope payload  
  \- X-Lyceon-Signature header set; X-Lyceon-Timestamp set to current UTC

When:  
  \- 03C receives request and runs verifyHmac()

Then:  
  \- Signature verifies successfully  
  \- Request proceeds to envelope validation  
  \- SLI: hmac\_auth\_failure\_rate does NOT increment

### **15.2 \[P0\] HMAC tampering detected**

Scenario: Auth — body modified after signing; signature mismatch detected  
Tier: P0  
Tags: AUTH  
Spec section: §IX.1  
Owner: Engineering

Given:  
  \- 03B signs envelope with body B1  
  \- Body modified to B2 after signing (e.g., proxy injection attack)

When:  
  \- 03C verifies

Then:  
  \- Signature mismatch  
  \- HTTP 401; error.code='auth\_failed'  
  \- SLI: hmac\_auth\_failure\_rate increments  
  \- PAGE per §28.1 if sustained \>1/min

### **15.3 \[P0\] OIDC token from Cloud Tasks accepted**

Scenario: Auth — Cloud Tasks → handler uses OIDC; verified  
Tier: P0  
Tags: AUTH  
Spec section: §IX.3 OIDC for async  
Owner: Engineering

Given:  
  \- Cloud Tasks task has X-Goog-Iap-Jwt-Assertion (or Authorization: Bearer \<OIDC\>)  
  \- Handler verifies token via Google OAuth jwks

When:  
  \- Handler receives task

Then:  
  \- Token verifies; iss='https://accounts.google.com'  
  \- Token's sub matches expected service account 'lisa-memory-worker@'  
  \- Handler proceeds

### **15.4 \[P0\] OIDC token rejected for wrong service account**

Scenario: Auth — task sourced from wrong service account; rejected  
Tier: P0  
Tags: AUTH  
Spec section: §IX.3  
Owner: Engineering

Given:  
  \- Task delivered with OIDC token from unauthorized service account

When:  
  \- Handler verifies

Then:  
  \- Service account mismatch  
  \- HTTP 403  
  \- Logger error: 'oidc\_unauthorized\_principal'

### **15.5 \[P0\] Cloud Run IAM private (ingress=internal)**

Scenario: IAM — direct external request to Cloud Run rejected at network layer  
Tier: P0  
Tags: AUTH  
Spec section: §13.1 Cloud Run ingress=internal  
Owner: Platform / Ops

Given:  
  \- Cloud Run service deployed with ingress=internal-and-cloud-load-balancing  
  \- Direct curl from external IP

When:  
  \- Request attempted

Then:  
  \- Connection rejected at network layer (no HTTP response)  
  \- Verified via integration test from public-net runner

### **15.6 \[P0\] HMAC key rotation overlap window**

Scenario: Auth — HMAC key rotated; old \+ new keys both valid during 14-day overlap  
Tier: P0  
Tags: AUTH  
Spec section: §30.6 HMAC\_SIGNING\_KEY rotation; 01A §65  
Owner: Platform

Given:  
  \- Two HMAC keys deployed: KEY\_PREVIOUS (rotated 7 days ago), KEY\_CURRENT (active)

When:  
  \- 03B signs with KEY\_PREVIOUS (mid-rotation lag)  
  \- 03B signs with KEY\_CURRENT (post-rotation)

Then:  
  \- 03C verifies both successfully via key\_id header lookup  
  \- SLI: hmac\_auth\_success\_rate{key\_id='previous'} increments (legacy)  
  \- SLI: hmac\_auth\_success\_rate{key\_id='current'} increments

### **15.7 \[P1\] HMAC key beyond overlap window rejected**

Scenario: Auth — HMAC key 15 days old (past overlap) rejected  
Tier: P1  
Tags: AUTH  
Spec section: 01A §65 14-day overlap  
Owner: Platform

Given:  
  \- Old HMAC key from 15 days ago

When:  
  \- Signature attempted

Then:  
  \- HTTP 401; error.code='auth\_failed'  
  \- Logger warn: 'hmac\_key\_beyond\_overlap'

### **15.8 \[P1\] Service account least-privilege audit**

Scenario: IAM — quarterly audit verifies SA permissions match §12.3 spec  
Tier: P1  
Tags: AUTH  
Spec section: §12.3 quarterly review  
Owner: Ops

Given:  
  \- Production project IAM bindings

When:  
  \- Audit script enumerates lisa-orchestrator@ and lisa-memory-worker@ permissions

Then:  
  \- lisa-orchestrator@ has: Vertex AI User, Cloud SQL Client, Secret Manager Secret Accessor;  
    NO Cloud Tasks Enqueuer (only schedulers enqueue per §IX); NO write to non-cache tables  
  \- lisa-memory-worker@ has: Vertex AI User, Cloud SQL Client, narrowly scoped DB credentials  
    per §8.7; NO write to anything except tutor\_memory\_summaries \+ tutor\_vertex\_context\_cache  
  \- No "roles/owner" or "roles/editor" on either SA

### **15.9 \[P1\] HMAC failure metric does not leak signature**

Scenario: Auth — failure log/metric does NOT contain signature value  
Tier: P1  
Tags: AUTH  
Spec section: §11.4 logging redaction  
Owner: Engineering

Given:  
  \- Invalid HMAC submitted

When:  
  \- Failure logged

Then:  
  \- Log payload does NOT contain X-Lyceon-Signature value  
  \- SLI tags do NOT include signature value  
  \- Verified by capturing log output and grep for the signature

---

## **§16 Failure recovery & chaos**

Maps to §28.6 deployment \+ infra failures \+ cross-cutting recovery.

### **16.1 \[P0\] Vertex region unavailable**

Scenario: Chaos — Vertex us-central1 region down; circuit breaker trips; ops alerted  
Tier: P0  
Tags: NO\_FAIL\_OPEN  
Spec section: §10.2; §28.2  
Owner: Chaos test

Given:  
  \- Mocked Vertex returns 503 across all calls  
  \- 1000 turns over 5 minutes

When:  
  \- Traffic continues

Then:  
  \- Per-instance circuit breakers trip after warmup  
  \- Subsequent traffic short-circuits to 503 with Retry-After  
  \- PAGE alerts fire: vertex\_call\_5xx\_rate, vertex\_circuit\_breaker\_state  
  \- 03B clients retry per their retry policy; eventually surface error to user  
  \- No cascading failures (Cloud Run instances do not crash)

### **16.2 \[P0\] DB connection drop mid-transaction**

Scenario: Chaos — Postgres connection drops during T1; transaction rolls back  
Tier: P0  
Tags: NO\_FAIL\_OPEN  
Spec section: §28C.4  
Owner: Chaos test

Given:  
  \- Memory refresh handler in T1; connection killed mid-transaction (test injects connection close)

When:  
  \- T1 attempts COMMIT

Then:  
  \- Client receives connection error  
  \- Transaction rolled back automatically (Postgres atomicity)  
  \- No partial state in tutor\_memory\_summaries or tutor\_vertex\_context\_cache  
  \- Cloud Tasks retries handler with backoff

### **16.3 \[P0\] Cloud Run instance crash mid-orchestrate-turn**

Scenario: Chaos — Cloud Run instance crashes during sync turn; client retries  
Tier: P0  
Tags: NO\_FAIL\_OPEN  
Spec section: §28B.5 graceful shutdown; §28A.1  
Owner: Chaos test

Given:  
  \- Sync turn in progress; Vertex call pending  
  \- SIGKILL sent to Cloud Run instance

When:  
  \- Crash occurs

Then:  
  \- 03B observes connection drop OR HTTP 502 from Cloud Run load balancer  
  \- 03B retries turn (per §5.8 retryable on 5xx)  
  \- Retry routes to a different healthy instance; succeeds  
  \- SLI: cloud\_run\_instance\_crash\_rate increments

### **16.4 \[P0\] Cloud Run cold start under SLO**

Scenario: Cold start — first request after scale-to-zero P99 \<3s  
Tier: P0  
Tags: NO\_FAIL\_OPEN  
Spec section: §28B.2 cold start target  
Owner: Engineering / Load test

Given:  
  \- Cloud Run service scaled to 0 instances  
  \- First request arrives

When:  
  \- Cold start occurs

Then:  
  \- Bootstrap completes (load policy templates, init Vertex SDK, init DB pool)  
  \- First response delivered  
  \- End-to-end P99 \<3000ms  
  \- SLI: orchestrator\_cold\_start\_latency\_p99 records

### **16.5 \[P0\] Health check liveness/readiness**

Scenario: Health — /healthz responds 200; /readyz waits for DB pool ready  
Tier: P0  
Tags: NO\_FAIL\_OPEN  
Spec section: §28B.4 health checks  
Owner: Engineering

Given:  
  \- Cloud Run instance booting

When:  
  \- /healthz queried during boot  
  \- /readyz queried during boot

Then:  
  \- /healthz returns 200 immediately (process alive)  
  \- /readyz returns 503 until DB pool established \+ first DB ping succeeds  
  \- /readyz transitions to 200 once ready  
  \- Cloud Run probes /readyz before routing traffic

### **16.6 \[P0\] Graceful shutdown drains in-flight requests**

Scenario: Shutdown — SIGTERM allows in-flight turns to complete  
Tier: P0  
Tags: NO\_FAIL\_OPEN  
Spec section: §28B.5 graceful shutdown  
Owner: Chaos test

Given:  
  \- Instance handling 5 in-flight orchestrate turns  
  \- SIGTERM sent

When:  
  \- Shutdown initiated

Then:  
  \- Instance stops accepting new requests (returns 503 from /readyz)  
  \- In-flight turns continue processing  
  \- Each completes within 10s grace period  
  \- After grace period: any remaining are forcibly closed (cloud\_run\_grace\_period\_exceeded SLI)  
  \- Otherwise clean shutdown

### **16.7 \[P0\] Vertex CachedContent orphan cleanup**

Scenario: Chaos — orphaned Vertex CachedContent expires via TTL; no leak  
Tier: P0  
Tags: NO\_FAIL\_OPEN  
Spec section: §6.8 cost leak bounded  
Owner: Engineering / Load test

Given:  
  \- 100 orphaned CachedContent entries created (mapping write failures, race losers)  
  \- Each has TTL=3600s

When:  
  \- 1 hour passes

Then:  
  \- All 100 expire on Vertex side  
  \- Vertex billing for these stops at TTL expiration  
  \- No accumulating cost leak verified via gcloud billing query

### **16.8 \[P1\] DB pool exhaustion behavior**

Scenario: Chaos — DB pool size 20; 25 concurrent requests  
Tier: P1  
Tags: NO\_FAIL\_OPEN  
Spec section: §28B.3 scaling; pool sizing  
Owner: Engineering / Load test

Given:  
  \- Cloud Run instance with DB pool size=20  
  \- 25 concurrent orchestrate-turn requests

When:  
  \- Load applied

Then:  
  \- 20 acquire connections immediately  
  \- 5 wait in pool queue (with bounded timeout)  
  \- Either: requests succeed sequentially as connections free  
    OR: pool timeout exceeded → HTTP 503; SLI db\_pool\_timeout\_rate increments

### **16.9 \[P1\] Cloud Tasks queue backpressure**

Scenario: Chaos — handler service down; Cloud Tasks accumulates pending  
Tier: P1  
Tags: NO\_FAIL\_OPEN  
Spec section: §8.2 retry policy  
Owner: Chaos test

Given:  
  \- lisa-memory-worker service unavailable (returns 502\)  
  \- 1000 tasks enqueued

When:  
  \- Handlers return 502 on each delivery attempt

Then:  
  \- Cloud Tasks retries with exponential backoff (max 5 retries)  
  \- SLI: async\_job\_retry\_rate spikes  
  \- When service recovers: queue drains  
  \- Tasks past retry budget dead-letter; SLI: async\_job\_dead\_letter\_rate

### **16.10 \[P1\] Network partition between Cloud Run and Cloud SQL**

Scenario: Chaos — Cloud SQL unreachable; instance health degrades  
Tier: P1  
Tags: NO\_FAIL\_OPEN  
Spec section: §28B.4 health checks  
Owner: Chaos test

Given:  
  \- Cloud SQL connection refused (network partition simulated)

When:  
  \- Instance receives request

Then:  
  \- DB pool exhausted; subsequent queries time out  
  \- /readyz returns 503 (DB ping fails)  
  \- Cloud Run removes instance from load balancer  
  \- New traffic routed to healthy instances OR cold-start spawns new instance

### **16.11 \[P1\] Stuck advisory lock recovery**

Scenario: Chaos — handler holding advisory lock with hung connection; lock released after timeout  
Tier: P1  
Tags: NO\_FAIL\_OPEN  
Spec section: §8.4.2 stuck-lock recovery  
Owner: Chaos test

Given:  
  \- Worker holding advisory lock; Vertex call hung  
  \- Handler timeout fires at 5min

When:  
  \- Timeout

Then:  
  \- Connection killed  
  \- Postgres releases advisory lock  
  \- Pending row remains; reconciliation worker handles after pending-window

### **16.12 \[P1\] Multiple workers crash simultaneously**

Scenario: Chaos — 5 workers crash at once mid-handler; reconciliation handles all  
Tier: P1  
Tags: NO\_FAIL\_OPEN  
Spec section: §8.5 reconciliation high-volume  
Owner: Chaos test

Given:  
  \- 5 concurrent memory refresh handlers, all in generation phase  
  \- All 5 instances killed simultaneously

When:  
  \- Crashes occur

Then:  
  \- 5 advisory locks released  
  \- 5 pending rows remain  
  \- 10 minutes later: sweep detects all 5; enqueues 5 reconciliation tasks  
  \- All 5 marked failed; 5 retry tasks enqueued  
  \- All 5 retries eventually succeed  
  \- SLI: memory\_refresh\_orphaned\_pending\_count gauge spikes to 5 then returns to 0

### **16.13 \[P1\] Vertex deterministic-mode failure**

Scenario: Chaos — Vertex returns non-deterministic output despite seed parameter  
Tier: P1  
Tags: NO\_FAIL\_OPEN  
Spec section: §5.7 V2.1 seed semantics  
Owner: Engineering

Given:  
  \- Two debug runs with identical envelope \+ debug\_seed=42  
  \- Vertex deterministic mode unavailable for selected model

When:  
  \- Both runs execute

Then:  
  \- Outputs differ (non-deterministic)  
  \- Logger info: 'vertex\_seed\_passed\_but\_nondeterministic\_output'  
  \- Test PASSES (acknowledges deterministic mode is best-effort, not guaranteed)  
  \- Production traffic unaffected (debug\_seed null)

### **16.14 \[P1\] Schema migration partial failure recovery**

Scenario: Chaos — migration §29.2 partially applied (status column added but default 'ready' fails)  
Tier: P1  
Tags: NO\_FAIL\_OPEN  
Spec section: §29.3 deployment ordering rollback  
Owner: Platform

Given:  
  \- Migration runs ALTER TABLE ADD COLUMN status TEXT  
  \- Subsequent ALTER TABLE ALTER COLUMN status SET DEFAULT 'ready' fails (e.g., pre-existing rows)

When:  
  \- Failure detected

Then:  
  \- Migration rolled back per §29.3 step 4 rollback procedure: ALTER TABLE DROP COLUMN status  
  \- Pre-migration schema restored  
  \- SLI: deployment\_rollback\_count increments  
  \- Logger error captured for post-mortem

---

## **§17 Observability — V3 §28.7 \+ §28.8 SLI alerts (TM-V1.1-11)**

Maps to Doc 03C V3 §11.2 SLI catalog \+ §28 failure matrix (including V3 §28.7 privacy/anti-leak \+ §28.8 configuration sections) \+ cross-cutting SLI verification.

**§17 V1.1 changes (TM-V1.1-11):**

* §17.1 SLI coverage list expanded to include all V3 §11.2 SLIs (chunk gate, scope override, cascade, break-glass disabled-mode)  
* §17.5 expanded to cover V3 PII / chunk gate / scope override / break-glass alert wiring  
* §17.11 NEW (V3 §28.7 privacy/anti-leak alerts wired)  
* §17.12 NEW (V3 §28.8 configuration alerts wired)

### **17.1 \[P0\] Every SLI in §11.2 emits in production paths (V1.1 expanded)**

Scenario: Observability — full SLI coverage verified against V3 §11.2 list  
Tier: P0  
Tags: OBSERVABILITY, AUDITABILITY  
Spec section: §11.2 V3 consolidated SLI list (V3 F-V3-01)  
Owner: Engineering

Given:  
  \- Comprehensive synthetic load covering all entry modes, surfaces, error cases, PII fixtures, chunk gate cascades, scope override attempts

When:  
  \- Load runs over 1 hour

Then:  
  \- Every SLI listed in §11.2 emits at least once with non-default value  
  \- Verified by querying Cloud Monitoring metric explorer for each SLI name  
  \- V3 SLI list includes (non-exclusive):  
    Turn path: orchestrator\_turn\_\*, orchestrator\_callback\_success\_rate, orchestrator\_envelope\_validation\_failure\_rate, orchestrator\_prompt\_oversize\_rate, orchestrator\_cold\_start\_latency\_p99, hmac\_auth\_failure\_rate  
    Vertex: vertex\_call\_\*, vertex\_model\_routing\_distribution, vertex\_model\_flash\_share, vertex\_model\_pro\_share, vertex\_pro\_fallback\_rate, vertex\_pro\_budget\_circuit\_breaker\_\*, vertex\_output\_schema\_\*, vertex\_safety\_block\_rate, vertex\_candidate\_slot\_hallucination\_rate  
    Cache: vertex\_context\_cache\_\*, vertex\_context\_cache\_eligibility\_rate, vertex\_context\_cache\_mapping\_write\_failure\_rate  
    Candidate: candidate\_preselect\_\*, similar\_question\_offer\_rate  
    Async jobs: async\_job\_\*, compaction\_job\_success\_rate, memory\_refresh\_job\_success\_rate, memory\_refresh\_pending\_window\_p95, pending\_reconciliation\_orphaned\_count, teaching\_profile\_staleness\_lag\_minutes  
    Circuit breaker: vertex\_circuit\_breaker\_\*  
    Privacy / anti-leak (V3): orchestrator\_pii\_pattern\_hit\_total{callsite}, orchestrator\_pii\_blocked\_turns\_total{callsite}, orchestrator\_pii\_warn\_rate, pii\_guard\_disabled\_turns\_total{callsite}, orchestrator\_streaming\_chunk\_gate\_hit\_total, orchestrator\_streaming\_chunks\_blocked\_total, orchestrator\_streaming\_anti\_leak\_cascade\_total, client\_scope\_override\_attempted\_total  
    Configuration (V3): pii\_guard\_break\_glass\_active\_at\_startup (log-based)  
    Streaming (V3): orchestrator\_streaming\_first\_chunk\_latency\_p95, orchestrator\_streaming\_total\_duration\_p95, orchestrator\_streaming\_chunk\_count\_p95  
    Deployment / infra: cloud\_run\_\*, health\_check\_\*, deployment\_rollback\_count  
  \- No SLI listed in §11.2 fails to emit during the test window

### **17.2 \[P0\] Request\_id correlation across log lines**

Scenario: Observability — request\_id propagates through full request lifecycle  
Tier: P0  
Tags: OBSERVABILITY  
Spec section: §11.5 correlation  
Owner: Engineering

Given:  
  \- Single sync turn end-to-end; envelope.request\_id='req-test-123'

When:  
  \- Turn processes

Then:  
  \- All log lines for this request include request\_id='req-test-123' as structured field:  
    \- envelope\_validation log  
    \- cache\_lookup log  
    \- vertex\_invoke log  
    \- vertex\_response log  
    \- response\_envelope\_emit log  
  \- Cloud Logging query 'jsonPayload.request\_id="req-test-123"' returns all expected lines

### **17.3 \[P0\] Log redaction in production**

Scenario: Observability — production logs redact prompt \+ response content  
Tier: P0  
Tags: OBSERVABILITY  
Spec section: §11.4 logging redaction  
Owner: Engineering

Given:  
  \- LISA\_ENV=production  
  \- Sync turn with content 'sensitive content'

When:  
  \- Turn processes

Then:  
  \- Log lines do NOT contain 'sensitive content' literal  
  \- Log lines have 'prompt\_body\_redacted=true' field  
  \- Log lines have prompt body length recorded as int but content removed  
  \- Verified by capturing logs and grep for sensitive content (must return zero matches)

### **17.4 \[P0\] Alert thresholds wired to Cloud Monitoring**

Scenario: Observability — every PAGE/WARN alert in §28 has Cloud Monitoring alert policy  
Tier: P0  
Tags: OBSERVABILITY  
Spec section: §28; §11 observability  
Owner: Ops

Given:  
  \- Cloud Monitoring alert policies deployed via Terraform/IaC

When:  
  \- Audit script enumerates policies

Then:  
  \- Every PAGE alert in §28 has corresponding alert policy with notification channel \= on-call PagerDuty  
  \- Every WARN alert has alert policy with notification \= ops Slack channel  
  \- Alert thresholds match §28 specifications exactly

### **17.5 \[P0\] PII guard / chunk gate / scope override SLIs propagate to dashboards (V1.1 expanded)**

Scenario: Observability — V3 §28.7 privacy/anti-leak SLIs visible in dashboards with correct alert thresholds  
Tier: P0  
Tags: OBSERVABILITY, PRIVACY, ANTI\_LEAK  
Spec section: §4.2.2 V3 PII guard; §6.5.1 pre-cache; §7.4.9 chunk gate; §3.5 scope override; §11.2 V3 SLI catalog; §28.7 failure matrix  
Owner: Ops \+ Engineering (joint)

Given:  
  \- Synthetic test injection across the privacy/anti-leak surface:  
    \- 1 turn with email PII (main turn block)  
    \- 1 turn with email PII in composite content (cache\_creation block)  
    \- 1 streaming turn with answer-leak chunk pattern (chunk gate hit)  
    \- 1 streaming turn with cascade trigger (3 consecutive blocks)  
    \- 1 turn with envelope-extra-field scope override attempt

When:  
  \- 5 minutes after test injections; Cloud Monitoring queried

Then:  
  \- orchestrator\_pii\_blocked\_turns\_total{callsite='main\_turn'} \= 1  
  \- orchestrator\_pii\_blocked\_turns\_total{callsite='cache\_creation'} \= 1  
  \- orchestrator\_streaming\_chunk\_gate\_hit\_total{severity='block', context='practice\_pre\_submit'} ≥ 1  
  \- orchestrator\_streaming\_chunks\_blocked\_total{context='practice\_pre\_submit'} ≥ 1  
  \- orchestrator\_streaming\_anti\_leak\_cascade\_total{context='practice\_pre\_submit'} \= 1  
  \- client\_scope\_override\_attempted\_total \= 1  
  \- PAGE alert fires for each (per §28.7): privacy SEV-2 escalation channel  
  \- All dashboard panels render without query errors

### **17.6 \[P0\] Memory refresh staleness lag SLI**

Scenario: Observability — teaching\_profile\_staleness\_lag\_minutes computed correctly  
Tier: P0  
Tags: OBSERVABILITY  
Spec section: §8.8 SLI; 03B §22.12  
Owner: Engineering

Given:  
  \- Student's teaching\_profile.summary\_version=5 written at t=0  
  \- Memory refresh runs at t=20 minutes

When:  
  \- SLI evaluated at t=10 minutes (mid-staleness)

Then:  
  \- teaching\_profile\_staleness\_lag\_minutes records 10 (minutes since last refresh)  
  \- Alert WARN if \>5 min (per §8.8)  
  \- Alert PAGE if \>30 min

### **17.7 \[P1\] Cost SLI per Vertex call**

Scenario: Observability — vertex\_call\_cost\_usd records per call  
Tier: P1  
Tags: OBSERVABILITY  
Spec section: §11.3 cost observability  
Owner: Engineering

Given:  
  \- Sync turn: Pro call with 1500 input tokens, 200 output tokens

When:  
  \- Turn completes

Then:  
  \- SLI: vertex\_call\_cost\_usd records with tags {model, entry\_mode, source\_surface}  
  \- Aggregate query produces daily Pro spend used by §5.3.3 budget circuit breaker

### **17.8 \[P1\] Distribution metric histogram buckets**

Scenario: Observability — orchestrator\_turn\_latency\_p95 histogram has correct buckets  
Tier: P1  
Tags: OBSERVABILITY  
Spec section: §11.2 latency histograms  
Owner: Engineering

Given:  
  \- 1000 turns mixed latency

When:  
  \- Histogram queried

Then:  
  \- Buckets: \[50, 100, 250, 500, 1000, 2000, 5000, 10000\] ms  
  \- Counts distributed appropriately  
  \- P50, P95, P99 percentiles computable from buckets

### **17.9 \[P1\] Trace propagation to Cloud Trace**

Scenario: Observability — distributed trace from 03B → 03C → Vertex captured  
Tier: P1  
Tags: OBSERVABILITY  
Spec section: §11.5  
Owner: Engineering

Given:  
  \- 03B initiates trace span; passes traceparent header

When:  
  \- 03C receives request

Then:  
  \- 03C extracts traceparent  
  \- 03C creates child span 'orchestrate\_turn'  
  \- 03C creates child span 'vertex\_invoke' under orchestrate\_turn  
  \- All spans visible in Cloud Trace explorer

### **17.10 \[P1\] Dashboard rendering — happy path**

Scenario: Observability — main 03C dashboard renders without errors  
Tier: P1  
Tags: OBSERVABILITY  
Spec section: §11; ops runbook  
Owner: Ops

Given:  
  \- Dashboard URL deployed

When:  
  \- Loaded in browser

Then:  
  \- All panels render data (no "metric not found" errors)  
  \- Time-range selector works  
  \- Filtering by entry\_mode, source\_surface, model works

### **17.11 \[P0\] V3 §28.7 alert policies wired to PagerDuty (TM-V1.1-11)**

Scenario: Observability — every V3 §28.7 PAGE-class alert has live PagerDuty wire  
Tier: P0  
Tags: OBSERVABILITY, PRIVACY, ANTI\_LEAK  
Spec section: §28.7 V3 privacy/anti-leak failure matrix; §11.2 V3 SLI catalog  
Owner: Ops

Given:  
  \- Cloud Monitoring alert policies deployed

When:  
  \- Audit the alert policy list against §28.7 PAGE-class entries

Then:  
  \- Every PAGE-class entry in §28.7 has corresponding alert policy:  
    \- PII guard pattern hit (block-severity, main\_turn) → policy threshold "any hit in 5-min window"  
    \- PII guard pattern hit (block-severity, cache\_creation) → same threshold  
    \- PII guard blocked turns total → "any hit in 5-min window"  
    \- PII guard disabled-mode turn (production break-glass active) → "any hit in 1-min window"  
    \- Streaming chunk gate block-severity in pre-submit → "rate \>1% over 5-min window"  
    \- Streaming chunks blocked rate → "rate \>1% over 5-min window"  
    \- Streaming anti-leak cascade → "any hit"  
    \- Client scope override attempted → "any hit"  
  \- All policies route to on-call PagerDuty channel (privacy SEV-2 escalation)  
  \- All policies have annotation linking to §28.7 entry

### **17.12 \[P0\] V3 §28.8 configuration alerts wired (TM-V1.1-11)**

Scenario: Observability — V3 §28.8 configuration failures alert correctly  
Tier: P0  
Tags: OBSERVABILITY, PRIVACY  
Spec section: §28.8 V3 configuration failures  
Owner: Ops

Given:  
  \- Cloud Monitoring alert policies deployed

When:  
  \- Trigger each §28.8 failure mode in a controlled test environment:  
    (a) attempt production deploy with pii\_guard.enabled=false missing break-glass  
    (b) production startup with valid break-glass active  
    (c) simulate model alias resolution failure (mis-configured runtime config)

Then:  
  \- (a) Boot failure → log-based alert "production\_pii\_guard\_disable\_without\_break\_glass" fires; PagerDuty paged  
  \- (b) Boot success with break-glass → log-based alert "pii\_guard\_break\_glass\_active\_at\_startup" fires; PagerDuty paged  
  \- (c) Configuration error event → "model\_alias\_resolution\_failure" alert fires; PagerDuty paged  
  \- All policies have annotation linking to §28.8 entry

---

## **§18 Schema migration & deployment**

Maps to §29 schema migrations \+ §29.3 deployment ordering.

### **18.1 \[P0\] Migration §29.1 cache\_kind CHECK expansion**

Scenario: Migration — ALTER TABLE adds 'student\_composite' to cache\_kind CHECK  
Tier: P0  
Tags: MIGRATION\_SAFETY  
Spec section: §29.1  
Owner: Platform

Given:  
  \- Pre-migration schema: cache\_kind CHECK IN ('system\_prompt', 'teaching\_profile', 'canonical\_question')

When:  
  \- Migration §29.1 applied

Then:  
  \- Post-migration: cache\_kind CHECK IN ('system\_prompt', 'teaching\_profile', 'canonical\_question', 'student\_composite')  
  \- Existing rows unchanged (constraint additive)  
  \- Verified via \\d+ tutor\_vertex\_context\_cache or pg\_constraint query

### **18.2 \[P0\] Migration §29.1 backward compatibility**

Scenario: Migration — V1.x readers still work with expanded CHECK  
Tier: P0  
Tags: MIGRATION\_SAFETY  
Spec section: §29.3 step 2 forward-compat  
Owner: Platform

Given:  
  \- Migration §29.1 applied  
  \- Old V1.x reader code still deployed (does not know 'student\_composite')

When:  
  \- V1.x reader queries cache

Then:  
  \- Reader queries succeed for old cache\_kinds  
  \- Reader does not see student\_composite rows (no rows yet at this point)  
  \- No breakage

### **18.3 \[P0\] Migration §29.2 status column addition**

Scenario: Migration — ALTER TABLE adds status column with default 'ready'  
Tier: P0  
Tags: MIGRATION\_SAFETY  
Spec section: §29.2  
Owner: Platform

Given:  
  \- Pre-migration schema: tutor\_memory\_summaries without status column

When:  
  \- Migration §29.2 applied

Then:  
  \- Column status TEXT NOT NULL DEFAULT 'ready' added  
  \- Existing rows have status='ready' (default backfill)  
  \- CHECK constraint: status IN ('pending', 'ready', 'failed')  
  \- Index added: CREATE INDEX ON tutor\_memory\_summaries (status, created\_at) WHERE status='pending'

### **18.4 \[P0\] Migration §29.2 forward-compat for V1.x readers**

Scenario: Migration — V1.x readers (pre-status filter) still work  
Tier: P0  
Tags: MIGRATION\_SAFETY  
Spec section: §29.3 step 4 forward-compat  
Owner: Platform

Given:  
  \- Migration §29.2 applied; all existing rows status='ready'  
  \- V1.x reader code (does not include status filter)

When:  
  \- V1.x reader queries tutor\_memory\_summaries

Then:  
  \- Reader sees only status='ready' rows (since none are pending yet at this point)  
  \- Reader behavior identical to pre-migration  
  \- No errors, no missing data

### **18.5 \[P0\] Migration rollback safety §29.1**

Scenario: Migration rollback — DROP CONSTRAINT restores pre-V2.1 state  
Tier: P0  
Tags: MIGRATION\_SAFETY  
Spec section: §29.3 step 1-2 rollback per step  
Owner: Platform

Given:  
  \- Migration §29.1 applied; canary fails post-deployment

When:  
  \- Rollback executed: ALTER TABLE DROP CONSTRAINT and recreate with old enum

Then:  
  \- Schema reverted to pre-§29.1 state  
  \- Verified: no 'student\_composite' allowed; pre-existing data intact  
  \- SLI: deployment\_rollback\_count increments

### **18.6 \[P0\] Migration rollback safety §29.2**

Scenario: Migration rollback — DROP COLUMN status reverts schema  
Tier: P0  
Tags: MIGRATION\_SAFETY  
Spec section: §29.3 step 3-4 rollback per step  
Owner: Platform

Given:  
  \- Migration §29.2 applied  
  \- Rollback decision

When:  
  \- ALTER TABLE DROP COLUMN status executed

Then:  
  \- status column removed  
  \- Pre-existing rows unchanged  
  \- Index dropped automatically with column  
  \- 03B envelope-builder hotfix (added WHERE status='ready') must NOT be deployed yet  
    (per §29.3 sequence: rollback §29.2 only valid before step 6\)

### **18.7 \[P0\] Deployment sequence preflight — script enforces step ordering (V1.1 — TM-V1.1-12 rewrite)**

Scenario: Deployment script — preflight verification rejects out-of-order steps  
Tier: P0  
Tags: MIGRATION\_SAFETY, NO\_FAIL\_OPEN  
Spec section: §29.3 V3 deployment ordering; §32.1 03B hotfix adapter  
Owner: Platform / Ops (joint)

Given:  
  \- Deployment script implementing the §29.3 V3 sequence  
  \- Two test invocations:  
    (a) Steps run in correct order: §29.1 → §29.2 → 03B hotfix → 03C V3 canary  
    (b) Steps run out of order: 03B hotfix attempted BEFORE §29.2 migration applied

When:  
  \- Each invocation runs

Then:  
  \- (a) All steps succeed; deployment progresses to canary; no errors  
  \- (b) Deployment script REFUSES to deploy 03B hotfix before §29.2; error message references the dependency: "Cannot deploy 03B envelope-builder hotfix before migration §29.2 has applied (status column missing)"  
  \- Script verifies preconditions for each step before executing; refuses to proceed if precondition not met  
  \- This verifies §29.3 ordering is enforced operationally, not just documented  
  \- Replaces V1.0 §18.7 which incorrectly documented the failure as expected behavior; V1.1 verifies the deploy-script gate that prevents the failure

### **18.8 \[P1\] Migration deployment idempotency**

Scenario: Migration — re-running migration §29.1 is no-op  
Tier: P1  
Tags: MIGRATION\_SAFETY  
Spec section: §29.3 verification gates  
Owner: Platform

Given:  
  \- Migration §29.1 already applied

When:  
  \- Migration script re-runs (CI re-deploy without state tracking)

Then:  
  \- DDL detects existing constraint; emits notice; no error  
  \- Schema unchanged

### **18.9 \[P1\] Cloud Tasks queue creation idempotency**

Scenario: Deployment — re-creating existing Cloud Tasks queue is no-op  
Tier: P1  
Tags: MIGRATION\_SAFETY  
Spec section: §29.3 step 0; ops runbook  
Owner: Ops

Given:  
  \- lisa-pending-reconciliation queue already exists

When:  
  \- Terraform/gcloud apply re-runs

Then:  
  \- No-op detected; configuration drift check passes  
  \- Existing queue rate limit \+ retry policy unchanged

### **18.10 \[P1\] Cloud Scheduler reconciliation trigger**

Scenario: Deployment — Cloud Scheduler invokes reconciliation sweep every 5 minutes  
Tier: P1  
Tags: MIGRATION\_SAFETY  
Spec section: §8.5.1 trigger; §29.3 step 10  
Owner: Ops

Given:  
  \- Cloud Scheduler job 'lisa-pending-reconciliation-sweep' deployed  
  \- Schedule: '\*/5 \* \* \* \*' (every 5 minutes)  
  \- Target: HTTP POST to /async/pending-reconciliation/sweep

When:  
  \- Scheduler fires

Then:  
  \- Sweep handler invoked  
  \- SLI: pending\_reconciliation\_sweep\_count increments every 5 minutes

### **18.11 \[P0\] V3 §29.3 Step 7a — break-glass config validation in staging (TM-V1.1-12; F-V3-10)**

Scenario: V3 deployment Step 7a — staging verifies PII guard config validation BEFORE production rollout  
Tier: P0  
Tags: MIGRATION\_SAFETY, PRIVACY, NO\_FAIL\_OPEN, AUDITABILITY  
Spec section: §29.3 V3 Step 7a; §30.7 \+ §30.7.1 break-glass; F-V3-10  
Owner: Platform / Ops (joint)

Given:  
  \- Staging environment with 03C V3 deployed (matching production config validation paths)  
  \- Three deployment-config fixtures:  
    (a) pii\_guard.enabled=false; pii\_guard.break\_glass\_ticket\_id=null (invalid)  
    (b) pii\_guard.enabled=false; valid break-glass ticket \+ future expiration ≤4hr (valid)  
    (c) Default config (pii\_guard.enabled=true; no break-glass) (normal)

When:  
  \- Each fixture deployed to staging Cloud Run revision

Then:  
  \- (a) Staging deploy FAILS at boot with thrown Error 'CONFIG ERROR: pii\_guard.enabled=false requires pii\_guard.break\_glass\_ticket\_id in production' (or equivalent staging-validates-as-prod check)  
  \- (b) Staging deploy SUCCEEDS at boot; emits log event 'pii\_guard\_break\_glass\_active\_at\_startup' with ticket\_id and expires\_at; PagerDuty paged  
  \- (c) Staging deploy SUCCEEDS at boot; no break-glass log event; normal startup  
  \- All three sub-checks must pass; failure of ANY blocks the production deployment per §29.3 Step 7a halt rule  
  \- Verifies V3 F-V3-10 contract: PII guard config validation code path is wired up and exercised before production

Sub-test 18.11.regression \[P0\]:  
  Given:  
    \- Hypothetical regression where validatePiiGuardConfigOrCrash function is removed from boot path  
  When:  
    \- Fixture (a) deployed  
  Then:  
    \- Boot SUCCEEDS (silent disable of PII guard in production)  
    \- This sub-test would FAIL (boot should have failed); flags the regression  
  This sub-test is the canonical guard against regression of the V2.2 §30.7 / V3 F-V3-10 break-glass discipline.

---

# **§19 Test execution & gating**

## **§19.1 Pre-launch gate (P0)**

Before 03C V3 ships to production per Doc 03C V3 §29.3 step 7-9:

* \[ \] All P0 scenarios in §5–§18 pass in CI (128 P0 scenarios per V1.1 re-tier)  
* \[ \] Coverage report shows 100% of P0 scenarios executed  
* \[ \] No skipped P0 tests  
* \[ \] Chaos tests in §13.12, §16.1–§16.7 pass in chaos-test environment  
* \[ \] Load tests in §9.11, §11.16 hit P95/P99 targets (V3 P95 \<12ms PII guard latency target)  
* \[ \] Schema migration tests in §18.1–§18.6 verified in staging  
* \[ \] §18.7 deployment ordering preflight test passes  
* \[ \] **§18.11 V3 Step 7a break-glass config validation passes in staging** (mandatory gate per Doc 03C V3 §29.3 Step 7a; halts deployment if any sub-check misbehaves)

## **§19.2 Post-launch gate (P1)**

Within 14 days of canary start:

* \[ \] All P1 scenarios pass in CI (65 P1 scenarios per V1.1 re-tier)  
* \[ \] Observability tests §17.1–§17.12 pass (including V1.1 §17.11 V3 §28.7 alerts and §17.12 V3 §28.8 alerts)  
* \[ \] No regression in P0 coverage  
* \[ \] Coverage report archived for compliance audit

## **§19.3 Continuous coverage**

After launch, all 193 scenarios run in CI on every merge to main. P0 failures block merge. P1 failures block merge to release branches.

## **§19.4 V1.1 invariant tag audit**

A reviewer can verify the P0/P1 split by inspecting the `Tags:` line on each scenario against §2.1 tag rules. Any scenario tagged with {AUTH, ENTITLEMENT, PRIVACY, ANTI\_LEAK, NO\_FAIL\_OPEN, IDEMPOTENCY, AUDITABILITY, MIGRATION\_SAFETY} must be P0; any scenario tagged ONLY with {DETERMINISM, OBSERVABILITY} may be P1. Audit script:

\# Pseudo-code for tag audit  
for each scenario in test-matrix:  
  required\_p0 \= any tag in {AUTH, ENTITLEMENT, PRIVACY, ANTI\_LEAK, NO\_FAIL\_OPEN, IDEMPOTENCY, AUDITABILITY, MIGRATION\_SAFETY}  
  if required\_p0 and tier \!= P0:  
    fail "Scenario {N} has P0-required tag but tier=P1; needs §2.2 tier override justification"

V1.1 has zero tier overrides. Audit must pass before lock.

---

# **§20 Cross-doc dependencies (V1.1 — TM-V1.1-17)**

This Test Matrix depends on:

| Document | Spec sections referenced | V1.1 dependency notes |
| ----- | ----- | ----- |
| **Doc 03C V3** | canonical-final spec; section references throughout | V1.1 absorbs all 17 V3 findings (F-V3-01 through F-V3-17) |
| **Doc 03B V4.1** | envelope-builder contract; §13, §15.1, §22.12; required for §6.15 streaming persistence ownership joint test, §13 async job tests | V3 cross-doc patches required: 03B envelope-builder hotfix (§29.3 step 5-6), 03B V5 §16 anti-leak coordination (§32.6), 03B V5 §18 error registry expansion (§32.7) |
| **Doc 03A V3** | memory refresh \+ compaction algorithm; §6, §9, §14; §13 async job tests reference 03A V3 algorithms | Forward-compat to 03A V3.1 §9.6 placeholder-then-fill (§32.X adapter; verified via §13.2-§13.4 tests) |
| **Doc 01A V1** | test conventions; §3.3 helper expectations | No changes |
| **Doc 03C Operations Runbook V1 (pending)** | deployment procedures; §18 deployment tests verify runbook steps; §11.15a/b/c break-glass tests verify §30.7.1 procedure | Runbook required before V3 production launch; cross-checks §29.3 V3 Step 7a verification |

When upstream docs ship V5/V3.1 updates, this Test Matrix should be reviewed for additional test scenarios (incremental update; not a Test Matrix V1.2 trigger).

---

