# **Doc 03C.1 — LISA Orchestrator Test Matrix V1**

**Version:** V1.0 **Status:** CANONICAL (companion to Doc 03C V2.1) **Document family:** Doc 03C V2.1 \+ this Test Matrix \+ Doc 03C Operations Runbook V1 (pending) **Owners:** Lyceon Platform Engineering **Last updated:** 2026-04-25 **Depends on:** Doc 03C V2.1 (canonical spec); Doc 01A V1 (test conventions); Doc 03B V4.1 (envelope-builder contract) **Test framework:** pnpm \+ Vitest. Tests scaffolded in `apps/lisa-orchestrator/src/**/__tests__/*.test.ts` and `apps/lisa-orchestrator/src/**/__tests__/*.integration.test.ts`.

---

## **§1 Purpose**

Doc 03C.1 enumerates the test scenarios required to verify Doc 03C V2.1 spec compliance. It is the **acceptance contract** for engineering: every P0 scenario must pass before 03C V2.1 ships to production; every P1 scenario must pass before steady-state production traffic is permitted.

The Test Matrix is **not** the test code. It is the spec for what the test code must cover. Engineering writes the test code in Vitest using the scenarios below as the authoritative definition of correctness.

## **§2 Severity tiers**

Two-tier classification per industry SRE pattern:

| Tier | Meaning | Gate |
| ----- | ----- | ----- |
| **P0** | Must pass before 03C V2.1 ships to production. Failures block deployment. | Pre-launch CI gate per Doc 03C V2.1 §29.3 step 0 |
| **P1** | Required for production but can deploy and fix-forward. Failures do not block deployment if all P0 are clean. | Post-launch within 14 days of canary start |

P0 tests are non-negotiable. P1 tests provide coverage that catches regression but isn't existential for first-launch correctness.

**Tier assignment principle:** a test is P0 if its failure means a real user gets broken behavior in a way that violates Doc 00 platform invariants (server-auth, no client role trust, no data leak, no randomness post-state, audit-friendly), or if its failure means a privacy incident, or if its failure means engineers can't deterministically debug production issues. Otherwise P1.

## **§3 Test conventions**

### **3.1 Test format**

Tests are specified as **given/when/then scenarios** with explicit setup, action, and expected outcome.

Scenario: \<descriptive name\>  
Tier: P0 | P1  
Spec section: \<Doc 03C V2.1 §X.Y reference\>  
Owner: Engineering | Platform | Ops

Given:  
  \<preconditions; environment state; fixtures\>

When:  
  \<action under test\>

Then:  
  \<expected outcome; assertions; observable signals\>

### **3.2 Test types**

| Type | Suffix | Runs in CI | Notes |
| ----- | ----- | ----- | ----- |
| Unit test | `.test.ts` | Yes (pre-merge) | Isolated, fast, mocked external deps |
| Integration test | `.integration.test.ts` | Yes (post-merge) | Real Postgres \+ mocked Vertex SDK |
| Contract test | `.contract.test.ts` | Yes (post-merge) | Verifies wire-format envelopes against fixture pairs |
| Chaos test | `.chaos.test.ts` | Manual \+ nightly | Process kills, network partition, DB drops |
| Load test | `.load.test.ts` | Manual \+ weekly | Validates P95/P99 targets under realistic concurrency |

### **3.3 Vitest helpers**

Standard test helpers expected to exist:

// Reference shapes only; engineering authors actual helpers  
import { mockVertexSDK, type MockVertexResponse } from '@lyceon/test-helpers/vertex';  
import { withTestDB, withMigrations } from '@lyceon/test-helpers/db';  
import { mockCloudTasks, drainTaskQueue } from '@lyceon/test-helpers/cloud-tasks';  
import { buildEnvelope, type RequestEnvelope } from '@lyceon/test-helpers/envelope';  
import { signHmac, withFixedTime } from '@lyceon/test-helpers/auth';

### **3.4 Fixture conventions**

Fixtures live in `apps/lisa-orchestrator/src/__fixtures__/`:

* `envelope/` — request envelope JSON fixtures, named per scenario  
* `vertex/` — mocked Vertex response payloads  
* `pii/` — PII pattern positive \+ negative test strings  
* `migrations/` — pre/post-migration SQL snapshots

### **3.5 Test isolation**

* Every integration test runs in a transaction that rolls back on completion  
* Database state never leaks between tests  
* Mocked Vertex client resets between tests  
* Cloud Tasks queue mock drains between tests

### **3.6 What's out of scope for V1**

* End-to-end production-traffic replay tests (V2 once production logs exist)  
* Soak tests / multi-day stability (V2; load tests at 1-hour duration sufficient for launch)  
* Multi-region failover tests (V1 is single-region per Doc 03C V2.1 §2.2)

---

## **§4 Test categories overview**

| Section | Category | P0 count | P1 count |
| ----- | ----- | ----- | ----- |
| §5 | Happy path orchestrator turn (sync) | 6 | 4 |
| §6 | Happy path orchestrator turn (SSE streaming) | 4 | 3 |
| §7 | Envelope validation | 8 | 5 |
| §8 | Vertex integration & model routing | 9 | 6 |
| §9 | Vertex context cache | 7 | 5 |
| §10 | Candidate slots & schema split | 8 | 4 |
| §11 | PII guard | 12 | 6 |
| §12 | Pro→Flash fallback & budget circuit breaker | 6 | 4 |
| §13 | Async jobs (compaction, refresh, reconciliation) | 14 | 8 |
| §14 | Circuit breaker | 5 | 3 |
| §15 | Authentication (HMAC, OIDC, IAM) | 6 | 3 |
| §16 | Failure recovery & chaos | 9 | 5 |
| §17 | Observability | 6 | 4 |
| §18 | Schema migration & deployment | 7 | 3 |
| **Total** |  | **107** | **63** |

170 scenarios total. P0 coverage spans every named blocker (BLK-V2-01 through BLK-V2-05) plus every §28 failure-matrix entry's primary path. P1 coverage extends to edge cases, regression scenarios, and observability validation.

---

## **§5 Happy path orchestrator turn (sync mode)**

Maps to Doc 03C V2.1 §28A.1 \+ §V \+ §VI.

### **5.1 \[P0\] Scoped question, scaffolded variant, Pro routed, cache miss**

Scenario: Sync turn — scoped\_question \+ scaffolded → Pro; cache miss creates new entry  
Tier: P0  
Spec section: §3.2 envelope; §5.3.1 priority 7; §6.5 cache create; §7.1 response  
Owner: Engineering

Given:  
  \- Envelope: entry\_mode='scoped\_question', source\_surface='practice', policy\_variant='scaffolded',  
    prompt\_version='v1.0', resolved\_scope.source\_question\_canonical\_id set, recent\_messages with 3 turns  
  \- tutor\_memory\_summaries has 'ready' teaching\_profile row  
  \- tutor\_vertex\_context\_cache has no row matching composite cache key  
  \- Mocked Vertex SDK returns valid Pro response with strict-schema match  
  \- HMAC signature valid, timestamp current

When:  
  \- 03B → 03C calls POST /orchestrate/turn (streaming.enabled=false)

Then:  
  \- 03C invokes Vertex with model='gemini-2.5-pro' (per §5.3.1 priority 7\)  
  \- 03C creates new Vertex CachedContent (composite of policy \+ teaching\_profile)  
  \- INSERT row in tutor\_vertex\_context\_cache with kind='student\_composite'  
  \- Response 200 with response.content \+ suggested\_action \+ ui\_hints; question\_links empty;  
    instruction\_exposures populated; orchestration\_meta.model\_name='gemini-2.5-pro', cache\_used=false  
  \- SLI: orchestrator\_turn\_success\_rate, vertex\_model\_pro\_share increment;  
    vertex\_context\_cache\_creation\_latency\_p95 records  
  \- End-to-end P95 latency \<5000ms (verified by load.test variant)

### **5.2 \[P0\] Scoped question, concise variant, Flash routed, cache hit**

Scenario: Sync turn — scoped\_question \+ concise → Flash; cache hit reuses existing entry  
Tier: P0  
Spec section: §5.3.1 priority 8; §6.4 cache hit; §7.1 response  
Owner: Engineering

Given:  
  \- Envelope: entry\_mode='scoped\_question', policy\_variant='concise', prompt\_version='v1.0'  
  \- teaching\_profile.summary\_version=3  
  \- tutor\_vertex\_context\_cache has row: kind='student\_composite',  
    cache\_key='concise:v1.0:{student\_id}:v3', invalidated\_at=NULL, expires\_at\>now()  
  \- Mocked Vertex returns valid Flash response

When:  
  \- 03B → 03C calls POST /orchestrate/turn

Then:  
  \- 03C lookup finds existing CachedContent  
  \- Vertex called with model='gemini-2.5-flash' AND cachedContent={existing CachedContent name}  
  \- No new tutor\_vertex\_context\_cache row created  
  \- Response 200; orchestration\_meta.cache\_used=true, model\_name='gemini-2.5-flash'  
  \- SLI: vertex\_context\_cache\_hit\_rate increments

### **5.3 \[P0\] Review surface precedence over policy\_variant**

Scenario: Sync turn — source\_surface='review' overrides concise→Flash to Pro  
Tier: P0  
Spec section: §5.3.1 priority 4 vs 8 precedence  
Owner: Engineering

Given:  
  \- Envelope: source\_surface='review', policy\_variant='concise' (would route Flash priority 8\)

When:  
  \- 03B → 03C calls POST /orchestrate/turn

Then:  
  \- Routing rule priority 4 (source\_surface='review') matches first  
  \- Vertex called with model='gemini-2.5-pro'  
  \- Response orchestration\_meta.model\_name='gemini-2.5-pro'

### **5.4 \[P0\] General entry mode routes Pro**

Scenario: Sync turn — entry\_mode='general' (dashboard) routes Pro per priority 5  
Tier: P0  
Spec section: §5.3.1 priority 5  
Owner: Engineering

Given:  
  \- Envelope: entry\_mode='general', source\_surface='dashboard', policy\_variant='concise'  
  \- resolved\_scope all null

When:  
  \- 03B → 03C calls POST /orchestrate/turn

Then:  
  \- Vertex called with model='gemini-2.5-pro'  
  \- Cache eligibility evaluated; eligibility passes if teaching\_profile present  
  \- Response orchestration\_meta.model\_name='gemini-2.5-pro'

### **5.5 \[P0\] Default fallback to Flash on no-rule-match**

Scenario: Sync turn — strategy\_first variant defaults to Flash via priority 8  
Tier: P0  
Spec section: §5.3.1 priority 9 default  
Owner: Engineering

Given:  
  \- Envelope: entry\_mode='scoped\_question', policy\_variant='strategy\_first'

When:  
  \- Request processed

Then:  
  \- Priority 8 matches: Flash routed  
  \- Response orchestration\_meta.model\_name='gemini-2.5-flash'

### **5.6 \[P0\] Cache eligibility null-prompt-version short-circuit**

Scenario: Sync turn — prompt\_version=null disables cache, proceeds uncached  
Tier: P0  
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
Spec section: §7.1 orchestration\_meta; §11.3  
Owner: Engineering

Given:  
  \- Standard happy-path envelope; conversation has 22 turns (\>20 threshold)

When:  
  \- Request processed

Then:  
  \- orchestration\_meta.model\_name \= selected model  
  \- orchestration\_meta.cache\_used \= boolean reflects hit/miss accurately  
  \- orchestration\_meta.compaction\_recommended \= true (\>20 turns triggers per §VIII.3)  
  \- orchestration\_meta.fallback\_applied \= false (Pro→Flash NOT triggered)  
  \- orchestration\_meta.input\_tokens / output\_tokens populated from Vertex usageMetadata  
  \- orchestration\_meta.latency\_ms \= wall-clock from request to response

### **5.10 \[P1\] SLI emission timing**

Scenario: Sync turn — SLIs emit per §11.2 conventions; no duplicates  
Tier: P1  
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

---

## **§6 Happy path orchestrator turn (SSE streaming mode)**

Maps to §7.4 SSE wire format \+ §28A.2 streaming endpoint contract.

### **6.1 \[P0\] Streaming end-to-end**

Scenario: SSE turn — full path from request to done event  
Tier: P0  
Spec section: §7.4.1 HTTP contract; §7.4.2 event format; §7.4.3 event types  
Owner: Engineering

Given:  
  \- Envelope: streaming.enabled=true  
  \- Mocked Vertex in streaming mode emits: 5 content\_delta, 1 suggested\_action\_set,  
    1 ui\_hints\_set, 2 instruction\_exposure, 0 question\_link, 1 orchestration\_meta, 1 done

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

### **6.2 \[P0\] Streaming question\_link uses slot ID per §7.4.5**

Scenario: SSE turn — question\_link event payload contains slot\_id, not canonical\_id  
Tier: P0  
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

Scenario: SSE turn — Vertex 5xx mid-stream emits error event then closes  
Tier: P0  
Spec section: §7.4.6 failure mode in streaming  
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
  \- No DB writes (per §7.4.8 no state mutation during streaming)  
  \- SLI: vertex\_call\_5xx\_rate increments

### **6.4 \[P0\] Streaming opt-out by default**

Scenario: Sync turn — streaming.enabled defaults to false → JSON response  
Tier: P0  
Spec section: §7.4.7 V1 posture  
Owner: Engineering

Given:  
  \- Envelope without streaming field (or streaming.enabled=false explicitly)

When:  
  \- Request processed

Then:  
  \- 03C treats as sync mode  
  \- Response Content-Type='application/json'; not text/event-stream  
  \- Full envelope returned in single response body

### **6.5 \[P1\] Streaming sequence\_ordinal monotonicity**

Scenario: SSE turn — content\_delta events have monotonic increasing sequence\_ordinal  
Tier: P1  
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

---

## **§7 Envelope validation**

Maps to §3.4 envelope validation \+ §7.3 error code registry.

### **7.1 \[P0\] Missing schema\_version**

Scenario: Envelope validation — missing schema\_version field  
Tier: P0  
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
Spec section: §3.2; §5.7 V2.1 seed parameter  
Owner: Engineering

Given:  
  \- Envelope with schema\_version='1.0', runtime\_limits.debug\_seed=42

When:  
  \- Request submitted

Then:  
  \- Envelope accepted (debug\_seed is additive backward-compatible)  
  \- 03C passes seed=42 to Vertex generationConfig per §5.7

---

## **§8 Vertex integration & model routing**

Maps to §V Vertex invocation \+ §28.2 failure matrix.

### **8.1 \[P0\] Hybrid strict schema rejects safety-critical drift**

Scenario: Vertex — model returns suggested\_action.type='unknown\_value'; strict schema fails  
Tier: P0  
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

---

## **§9 Vertex context cache**

Maps to §VI cache consumption \+ §28.3 failure matrix.

### **9.1 \[P0\] Composite cache key construction**

Scenario: Cache — composite key from (policy\_variant, prompt\_version, student\_id, teaching\_profile\_version)  
Tier: P0  
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

---

## **§10 Candidate slots & schema split (BLK-V2-02 \+ BLK-V2-04)**

Maps to §5.9 candidate-slots flow \+ §7.1.1 schema split.

### **10.1 \[P0\] Vertex output schema requires only related\_candidate\_slot\_id**

Scenario: Schema split — Vertex responseSchema has slot\_id, NOT canonical\_id  
Tier: P0  
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

### **10.5 \[P0\] Deterministic ordering — varies across days**

Scenario: Candidate pre-select — same student/source, different date → different ordering  
Tier: P0  
Spec section: §5.9.2 determinism guarantee  
Owner: Engineering

Given:  
  \- Fixed student\_id, fixed source\_question.canonical\_id  
  \- Day 1: current\_date='2026-04-25'; Day 2: current\_date='2026-04-26'

When:  
  \- Pre-select run on each day

Then:  
  \- Day 1 ordering ≠ Day 2 ordering (high probability — diversity rotation)  
  \- Both orderings individually reproducible if their day is fixed

### **10.6 \[P0\] Empty candidate result skips slot block**

Scenario: Candidate — no eligible questions; model receives no candidate list  
Tier: P0  
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

## **§11 PII guard (BLK-V2-03)**

Maps to §4.2.2 PII guard implementation \+ §28.1 orchestrator turn path.

### **11.1 \[P0\] Email pattern blocks turn**

Scenario: PII guard — email in assembled prompt blocks turn  
Tier: P0  
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
Spec section: §4.2.2 dob\_label pattern  
Owner: Engineering

Given:  
  \- Assembled prompt contains 'date of birth: 2009-03-15' (variations: DOB:, birthdate:, birthday:)

When:  
  \- PII guard runs

Then:  
  \- dob\_label pattern matches all variations; blocked

### **11.5 \[P0\] ISO date pattern blocks turn**

Scenario: PII guard — ISO 8601 date YYYY-MM-DD blocks turn  
Tier: P0  
Spec section: §4.2.2 date\_iso pattern  
Owner: Engineering

Given:  
  \- Assembled prompt contains '2009-03-15' (no DOB label, just bare date)

When:  
  \- PII guard runs

Then:  
  \- date\_iso pattern matches; blocked  
  \- Note: false-positive surface acceptable per §4.2.2 — academic content with dates should use stripped ISO timestamps in envelope per 03A V3 §6

### **11.6 \[P0\] US date pattern blocks turn**

Scenario: PII guard — US date MM/DD/YYYY blocks turn  
Tier: P0  
Spec section: §4.2.2 date\_us pattern  
Owner: Engineering

Given:  
  \- Assembled prompt contains '03/15/2009' (variations: 3/15/2009, 03/15/09)

When:  
  \- PII guard runs

Then:  
  \- date\_us pattern matches all variations; blocked

### **11.7 \[P0\] Address street pattern blocks turn**

Scenario: PII guard — street address blocks turn  
Tier: P0  
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

### **11.15 \[P1\] PII guard runtime disable**

Scenario: PII guard — pii\_guard.enabled=false bypasses guard entirely  
Tier: P1  
Spec section: §30.7 pii\_guard.enabled  
Owner: Engineering  
Note: emergency-only configuration; ops runbook documents when to use

Given:  
  \- Runtime config: pii\_guard.enabled=false  
  \- Assembled prompt contains email 'student@example.com'

When:  
  \- Request processed

Then:  
  \- PII guard is skipped (no pattern checks run)  
  \- 03C proceeds to Vertex  
  \- SLI: orchestrator\_pii\_blocked\_turns\_total does NOT increment  
  \- SLI: orchestrator\_pii\_guard\_disabled\_state=1 (gauge; should always be 0 in normal ops)

### **11.16 \[P1\] PII guard latency P95 \<5ms**

Scenario: PII guard — performance bound verified  
Tier: P1  
Spec section: §4.2.2 performance bound  
Owner: Engineering  
Note: Load test, not unit/integration

Given:  
  \- Mixed prompt corpus: 1000 prompts ranging 2k-16k tokens

When:  
  \- PII guard runs over each

Then:  
  \- P95 latency \<5ms  
  \- P99 latency \<15ms  
  \- No outliers \>50ms (would indicate regex pathological case)

### **11.17 \[P1\] PII guard fixture coverage table**

Scenario: PII guard — fixture coverage matrix per pattern  
Tier: P1  
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

---

## **§12 Pro→Flash fallback & budget circuit breaker**

Maps to §5.3.2 fallback \+ §5.3.3 budget circuit breaker.

### **12.1 \[P0\] Pro 5xx fallback to Flash succeeds**

Scenario: Fallback — Pro 5xx triggers Flash retry; turn succeeds  
Tier: P0  
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
  \- orchestration\_meta.model\_name='gemini-2.5-flash'  
  \- SLI: vertex\_pro\_fallback\_rate increments  
  \- SLI: vertex\_pro\_fallback\_success\_rate increments

### **12.2 \[P0\] Pro 429 quota fallback to Flash**

Scenario: Fallback — Pro 429 quota triggers Flash retry  
Tier: P0  
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
Spec section: §7.1 orchestration\_meta  
Owner: Engineering

Given:  
  \- Three fallback scenarios: Pro 5xx, Pro 429, budget circuit breaker

When:  
  \- Each scenario triggers fallback

Then:  
  \- Response envelope orchestration\_meta.fallback\_applied=true in all three cases  
  \- orchestration\_meta.model\_name='gemini-2.5-flash' in all three  
  \- orchestration\_meta.fallback\_reason in {'pro\_5xx', 'pro\_quota', 'budget\_circuit\_breaker'} accordingly

### **12.10 \[P1\] Fallback rate alert thresholds**

Scenario: Fallback — sustained \>5% rate triggers warn alert  
Tier: P1  
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
  \- Vertex called with model='gemini-2.5-flash' (per 03A V3 §14.5)  
  \- INSERT into tutor\_memory\_summaries with summary\_type='chat\_compaction'  
  \- NOTIFY emitted on dependent cache invalidation per 03B §12B.5.1  
  \- SLI: async\_job\_success\_rate{job\_type='compaction'} increments  
  \- SLI: async\_job\_latency\_p95{job\_type='compaction'} records

### **13.2 \[P0\] MemoryRefreshWorker T1 happy path**

Scenario: Memory refresh T1 — invalidate \+ pending insert  
Tier: P0  
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

## **§17 Observability**

Maps to §11 observability \+ cross-cutting SLI verification.

### **17.1 \[P0\] Every SLI in §11.2 emits in production paths**

Scenario: Observability — full SLI coverage verified against §11.2 list  
Tier: P0  
Spec section: §11.2 (consolidated SLI list)  
Owner: Engineering

Given:  
  \- Comprehensive synthetic load covering all entry modes, surfaces, error cases

When:  
  \- Load runs over 1 hour

Then:  
  \- Every SLI listed in §11.2 emits at least once with non-default value  
  \- Verified by querying Cloud Monitoring metric explorer for each SLI name  
  \- List includes: orchestrator\_turn\_\*, vertex\_call\_\*, vertex\_context\_cache\_\*,  
    vertex\_pro\_fallback\_\*, vertex\_circuit\_breaker\_\*, async\_job\_\*, memory\_refresh\_\*,  
    pending\_reconciliation\_\*, hmac\_auth\_\*, candidate\_preselect\_\*,  
    orchestrator\_pii\_pattern\_hit\_total, orchestrator\_pii\_blocked\_turns\_total,  
    cloud\_run\_\*, deployment\_rollback\_count

### **17.2 \[P0\] Request\_id correlation across log lines**

Scenario: Observability — request\_id propagates through full request lifecycle  
Tier: P0  
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

### **17.5 \[P0\] PII guard SLIs propagate to dashboards**

Scenario: Observability — orchestrator\_pii\_blocked\_turns\_total visible in dashboard  
Tier: P0  
Spec section: §4.2.2 V2.1 BLK-V2-03; §11.2  
Owner: Ops

Given:  
  \- PII guard blocks 1 turn

When:  
  \- Dashboard queried

Then:  
  \- orchestrator\_pii\_blocked\_turns\_total dashboard panel shows 1 in last 5 minutes  
  \- PAGE alert fires per §4.2.2 (any hit during 5-min window)

### **17.6 \[P0\] Memory refresh staleness lag SLI**

Scenario: Observability — teaching\_profile\_staleness\_lag\_minutes computed correctly  
Tier: P0  
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

---

## **§18 Schema migration & deployment**

Maps to §29 schema migrations \+ §29.3 deployment ordering.

### **18.1 \[P0\] Migration §29.1 cache\_kind CHECK expansion**

Scenario: Migration — ALTER TABLE adds 'student\_composite' to cache\_kind CHECK  
Tier: P0  
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

### **18.7 \[P0\] Deployment sequence Step 5: 03B envelope-builder hotfix**

Scenario: Deployment sequence — 03B hotfix forward-compat with pre-migration schema  
Tier: P0  
Spec section: §29.3 step 5 03B hotfix; §32.1 adapter  
Owner: LISA team

Given:  
  \- 03B envelope-builder query updated: WHERE status \= 'ready'  
  \- Schema does NOT yet have status column (test pre-migration condition)

When:  
  \- 03B query runs

Then:  
  \- Query fails with "column status does not exist" → expected behavior; means hotfix must deploy AFTER §29.2  
  \- Confirms required deployment ordering: §29.2 → 03B hotfix  
  \- Reverse order is unsafe and must be rejected by deployment script

### **18.8 \[P1\] Migration deployment idempotency**

Scenario: Migration — re-running migration §29.1 is no-op  
Tier: P1  
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

---

# **§19 Test execution & gating**

## **§19.1 Pre-launch gate (P0)**

Before 03C V2.1 ships to production per Doc 03C V2.1 §29.3 step 7:

* \[ \] All P0 scenarios in §5–§18 pass in CI  
* \[ \] Coverage report shows 100% of P0 scenarios executed  
* \[ \] No skipped P0 tests  
* \[ \] Chaos tests in §13.12, §16.1–§16.7 pass in chaos-test environment  
* \[ \] Load tests in §9.11, §11.16 hit P95/P99 targets  
* \[ \] Schema migration tests in §18.1–§18.7 verified in staging

## **§19.2 Post-launch gate (P1)**

Within 14 days of canary start:

* \[ \] All P1 scenarios pass in CI  
* \[ \] Observability tests §17.1–§17.10 pass  
* \[ \] No regression in P0 coverage  
* \[ \] Coverage report archived for compliance audit

## **§19.3 Continuous coverage**

After launch, all 170 scenarios run in CI on every merge to main. P0 failures block merge. P1 failures block merge to release branches.

---

# **§20 Cross-doc dependencies**

This Test Matrix depends on:

* **Doc 03C V2.1:** canonical spec; section references throughout  
* **Doc 03B V4.1:** envelope-builder contract; §15.1, §29.3 step 5-6 03B hotfix tests  
* **Doc 03A V3:** memory refresh algorithm; §13.2–§13.4 reference 03A V3 §9  
* **Doc 01A V1:** test conventions; §3.3 helper expectations  
* **Doc 03C Operations Runbook V1 (pending):** deployment procedures; §18 deployment tests verify runbook steps

When upstream docs ship V5/V3.1/V1.1 updates, this Test Matrix V1.1 should incorporate corresponding test updates.

---

# **End of Doc 03C.1 Test Matrix V1**

**Total scenarios:** 170 (107 P0 \+ 63 P1) **Spec coverage:** Doc 03C V2.1 §3, §IV, §V, §VI, §VII, §VIII, §IX, §X, §XI, §XII, §XIII, §XIV, §28, §28A, §28B, §28C, §29 **Blocker coverage:** BLK-V2-01 (§9.1, §17.5), BLK-V2-02 (§10.1–§10.3, §10.8), BLK-V2-03 (§11.1–§11.18, §17.5), BLK-V2-04 (§10.4, §10.5), BLK-V2-05 (§18.7) **Format:** given/when/then scenarios; framework convention pnpm \+ Vitest per V1 lock

**Companion artifacts:**

* Doc 03C V2.1 (canonical spec — shipped)  
* Doc 03C Operations Runbook V1 (pending — next session)

**Owner:** Lyceon Platform Engineering. Test code authored in Vitest per §3 conventions.

**V1 review posture:** companion artifact to V2.1 spec; reviewed alongside Operations Runbook before production launch per Doc 03C V2.1 §29.3 pre-deployment gates.

