# **Doc 03C — GCP Orchestration**

**Version:** V2.1 **Status:** CANONICAL (production-hardened; closes V2.0 review blockers) **Document family:** Doc 03 Preamble \+ Doc 03 Main V1.1 \+ Doc 03A V3 (Context & Memory Runtime) \+ Doc 03B V4.1 (LISA API & Runtime Flow) \+ Doc 03C (this document) **Owners:** Lyceon Platform Team (jointly with LISA team for §VIII per §15.1) **Last updated:** 2026-04-25 **Supersedes:** Doc 03C V2.0, V1.2, V1.1, V1.0; draft "TUTOR\_GCP\_ORCHESTRATION\_CONTRACT" **Depends on:** Doc 00 Platform Directive, Doc 01 V8 (Identity/Access/Billing/Guardian Trust), Doc 01A V1 (Platform Primitives), Doc 03 Main V1.1, Doc 03A V3 (Context & Memory Runtime), Doc 03B V4.1 (LISA API & Runtime Flow). **Companion artifacts:** Doc 03C.1 Test Matrix V1, Doc 03C Operations Runbook V1 (separate documents — pending).

---

## **V2.1 closeout scope statement**

V2.1 is the **review-driven closeout** of V2.0. Five named blockers from external review are resolved; a review-swipe pass also catches residual rough edges. Architectural decisions from V2.0 are preserved.

**V2.1 blocker fixes:**

* **BLK-V2-01 — §14 acceptance criteria stale cache wording.** V2.0 §14.1 said "Composite cache key `(system + teaching_profile + canonical_question)` builds correctly." This contradicts V1.1's BLK-03C-01 redesign (per-student composite is policy \+ teaching\_profile only; canonical question lives in messages). V2.1 §14.1 corrected.  
* **BLK-V2-02 — Vertex schema vs 03C→03B response schema split.** V2.0 §5.5 Vertex `responseSchema` still required `related_question_canonical_id`, but §5.9 candidate-slots flow says the model returns `related_candidate_slot_id` and 03C resolves canonical IDs server-side. V2.1 splits: §5.5 Vertex output schema requires `related_candidate_slot_id` only; new §7.1.1 documents the post-Vertex 03C → 03B response schema with resolved canonical IDs.  
* **BLK-V2-03 — V1 deterministic PII guard implemented in 03C.** V2.0 §4.2.1 said 03C does not re-verify PII (responsibility deferred to 03B). For minor-facing tutor, defense-in-depth is required. V2.1 implements deterministic shallow PII screener in §4.2.2 (regex-based; covers email, phone, DOB/birthdate, address-like patterns, guardian identifier patterns, full-name labels); flags hits as `pii_in_envelope` blocking error before any Vertex call.  
* **BLK-V2-04 — Remove `ORDER BY RANDOM()` from candidate pre-select.** V2.0 §5.9.2 used `ORDER BY ... RANDOM()` which violates deterministic replay/debuggability. V2.1 replaces with seeded deterministic ordering using `hashtext(canonical_id || student_id || current_date::text)`; same-day candidates are stable for a given student, allowing reproducible debugging.  
* **BLK-V2-05 — Production rollout dependencies clarified.** V2.0 implied 03C V2.1 could ship standalone; V2.1 §29.3 clarifies that production deployment requires (a) 03B envelope-builder hotfix patch (add `WHERE status = 'ready'` filter), (b) schema migrations §29.1 \+ §29.2 deployed, (c) Test Matrix shipped, (d) Operations Runbook shipped. V2.1 itself is a *spec* ready for production-grade implementation; production *ship* is gated on these companions.

**V2.1 review-swipe findings (caught during pass; closed in this version):**

* **§5.7 generation parameters** — `temperature: 0.3` was specified but `topK` and `seed` were not. V2.1 adds `topK: 40`, `seed` parameter for deterministic regeneration during debug runs (set via envelope `runtime_limits.debug_seed` when present; null in production traffic).  
* **§7.4.3 SSE event types** — `question_link` payload referenced `related_candidate_slot_id` per V1.1 design, but data field name was inconsistent with §5.9.4 (some places used `slot_id`, others `related_candidate_slot_id`). V2.1 normalizes to `related_candidate_slot_id` everywhere.  
* **§28A.5 reconciliation rollback procedure** — V2.0 had rollback as "disable Cloud Scheduler trigger" but didn't address what to do with in-flight pending rows. V2.1 adds explicit rollback step: drain Cloud Tasks queue, then disable scheduler, leaving in-flight handlers to complete their T2 naturally.  
* **§28C.4 memory refresh T1 isolation** — V2.0 specified READ COMMITTED but didn't address the read-modify-write race on `MAX(summary_version) + 1`. V2.1 adds `FOR UPDATE` on the version-computation query to prevent concurrent T1s racing on the same student (advisory lock should prevent this, but defense-in-depth).  
* **§32.1 03B envelope-builder query adapter** — V2.0 said "add `WHERE status = 'ready'` filter" but didn't specify migration ordering relative to 03B deploy. V2.1 §29.3 step 3a \+ §32.1 add explicit ordering: 03B hotfix deploys *first* (filter is forward-compatible against current schema), then schema migration §29.2 adds the column with default `'ready'`.  
* **§30.4 async job configuration** — V2.0 missed `memory_refresh.pending_timeout_minutes` in the table; only mentioned in §8.5 prose. V2.1 adds the row.  
* **§9.5 internal staff access** — V2.0 said production logs redact prompts but didn't address the recon worker's logs (which include row IDs but not student data). V2.1 confirms recon worker logs follow same redaction policy.  
* **§4.2.1 PII contract** — language updated to reference §4.2.2 PII guard rather than "responsibility deferred upstream."

**V2.1 cross-doc dependencies (carried forward):**

* **03B V5:** envelope-builder query filter `WHERE status = 'ready'` (now sequenced explicitly per §29.3); §12B.5 `cache_kind` CHECK expansion for `student_composite`; §18 error registry expansion (V2.1 adds `pii_in_envelope` to the list); §12B.5.5 savings projection alignment.  
* **03A V3.1:** §9.6 must adopt placeholder-then-fill pattern; teaching\_profile schema must mirror `status` column.  
* **02B / 02C:** §31 inline schema definitions reflect 03C's expectations.

**V2.1 does NOT do:**

* Does not produce companion artifacts (Test Matrix \+ Operations Runbook); those ship as separate deliverables in subsequent sessions.  
* Does not change architectural decisions from V1.x or V2.0.  
* Does not patch 03B / 03A / 01A (those land in consolidated hardening pass).

**V2.1 ship gating:** V2.1 is APPROVED for engineering implementation as the canonical spec. Production deployment requires the companion artifacts and the cross-doc patches per §29.3. Per external review verdict: "APPROVE FOR V2.1 CLOSEOUT, NOT PRODUCTION SHIP" — V2.1 closes the spec gap; production ship is a coordinated deployment exercise.

---

# **Original V1 scope statement (preserved for history)**

V1 scope statement: 03C defines the GCP orchestration layer between 03B's LISA API handler and Vertex AI Gemini. 03C is intentionally a **thin consumer** of upstream canonicals: auth/entitlement (V8), idempotency/rate limit/cache/internal auth/observability (01A Parts II-VII), context and memory resolution (03A V3), API boundary and persistence (03B V4.1). 03C owns exclusively the GCP-specific concerns: Cloud Run private orchestrator, Vertex AI invocation (model selection, structured output, bounded generation, context cache consumption), Cloud Tasks async job layer for compaction and memory refresh, 03B↔03C service-to-service contract. 03C does not re-derive platform primitives. Ownership is cleanly delegated to the document that owns each primitive.

---

# **Part 0 — Doc 03C Preamble**

## **0.1 Purpose**

Doc 03C defines the GCP orchestration layer for Lyceon LISA. It is the authoritative specification for:

* Cloud Run private orchestrator service (topology, auth, scaling, deployment)  
* Vertex AI Gemini invocation (request shaping, structured output, model selection, bounded generation, context cache consumption)  
* Cloud Tasks async job layer (conversation-close compaction, MemoryRefreshWorker execution)  
* 03B↔03C service-to-service contract (request envelope, response envelope, HMAC auth)  
* 03C-specific failure modes, retries, and observability hooks

03C does NOT own:

* Canonical DB writes (owned by 03B §13)  
* Entitlement / auth / role enforcement (owned by V8 \+ 01A)  
* Idempotency state machine (owned by 01A Part IV \+ 03B §13.7 multi-phase extension)  
* Rate limiting / abuse scoring (owned by 01A Parts V-VI)  
* Anti-leak final enforcement before user (owned by 03B §16)  
* Tutor context resolution (owned by 03A V3 §5-§6)  
* Tutor memory summary schema (owned by 03A V3 §7)  
* Vertex context cache mapping table (owned by 03B §12B.5 \+ §27E; 03C is the caller)  
* Tutor instruction policy assignment (owned by 03A V3 §10; 03C receives `policy_assignment` in request envelope)  
* Mastery writes (owned by 02C)

## **0.2 What 03C owns exclusively**

1. **Cloud Run orchestrator service** — private, IAM-authenticated, stateless, autoscaled  
2. **Vertex AI request/response transport** — model selection, structured output schema, token caps, timeout  
3. **Model routing logic** — Flash vs Pro per turn based on entry mode \+ content complexity heuristics (§V)  
4. **Cloud Tasks job executors** — conversation-close compaction, MemoryRefreshWorker scheduled/triggered jobs  
5. **Vertex context cache consumption** — reads 03B's mapping table, creates new `CachedContent` on Vertex when needed, writes mapping row back  
6. **03B↔03C wire protocol** — envelope shapes, HMAC signing (per 01A Part VII), error code mapping  
7. **Orchestrator-specific SLIs** — Vertex latency, model routing distribution, context cache hit rate (as caller), async job success rate  
8. **Deployment \+ environment topology** — Cloud Run deploy spec, IAM least privilege, secret management

## **0.3 Non-Negotiable Architecture Rules**

Per Doc 00 Platform Directive \+ 03B V4.1 §1:

1. **Supabase remains the runtime source of truth.** 03C never writes canonical DB state. Cloud Tasks jobs that write to Supabase (compaction results to `tutor_memory_summaries`) do so through a bounded, documented writeback path (§VIII.4).

2. **03C is private.** No browser-accessible endpoints. IAM authentication required on every invocation.

3. **Server (03B) remains the trust boundary.** 03C consumes server-resolved context envelopes; never resolves entitlement, role, or ownership itself.

4. **Model outputs are bounded and structured.** Hybrid strictness: safety-critical fields (`suggested_action`, `question_links`) require strict schema; content/narrative fields accept best-effort JSON with normalization.

5. **No direct guardian path.** 03C is student-runtime only.

6. **No mastery writes.** 03C does not bypass canonical retry verification semantics.

---

# **Part I — Core Principles**

## **§1.1 Thin consumer**

Every capability 03C uses that exists in an upstream canonical is consumed via interface, not re-implemented. Specific delegations:

| Concern | Owner | Interface 03C uses |
| ----- | ----- | ----- |
| Auth (server-to-server) | 01A Part VII | HMAC signing per §IX |
| Observability (logs, metrics) | 01A Part II | Structured logger, correlation IDs |
| Cache (Vertex mapping table) | 03B §12B.5 \+ §27E | Read/invalidate\_at marker per 03B-owned table |
| Context resolution | 03A V3 §5-§6 | 03C receives pre-resolved envelope from 03B |
| Memory summaries (schema) | 03A V3 §7 | 03C reads via envelope; writes via compaction job |
| Tutor runtime state | 03B §13 | 03C does not access `tutor_conversations` etc. directly on turn path |
| Policy assignment | 03A V3 §10 | 03C receives `policy_assignment` in request |
| Idempotency | 01A Part IV \+ 03B §13.7 | 03C is side-effect-free from idempotency perspective; all state changes happen in 03B's handler transaction |

If 03C needs a capability not covered above, the first question is "should this be in an upstream canonical?" — default yes.

## **§1.2 Stateless orchestrator**

Cloud Run orchestrator instances hold no per-student or per-conversation state between requests. All state comes in through the request envelope; all state that needs to persist goes back through the response envelope or is written by Cloud Tasks jobs to Supabase.

Instance-local caches are permitted only for:

* Bootstrap-loaded config (Vertex project/region, model name constants per 01A §3)  
* Runtime-immutable artifacts (system prompt templates loaded at startup)  
* Per-instance single-flight in-flight maps (if needed for concurrent same-request dedup; likely not needed given 03B handles idempotency)

## **§1.3 Fail-safe on cache, fail-closed on correctness**

Consistent with 03B V4.1 patterns:

* Vertex context cache miss → proceed with uncached call (higher cost, no user impact)  
* Vertex model unavailable → return structured error to 03B; 03B decides user response  
* Structured output schema violation for safety-critical fields → fail-closed, 03C rejects the response and returns error to 03B  
* Structured output drift in content fields → normalize and log, do not fail

## **§1.4 Bounded resource consumption**

Per-invocation hard bounds, server-configured (not model-chosen):

* `max_output_tokens`: default 600 (configurable via 03B request envelope)  
* `timeout_ms`: default 8000 (configurable; matches 03B V4.1 §28A.2)  
* Model retry count: 1 retry max on transient 5xx

These bounds are owned by 03B (the caller passes them in `runtime_limits`), not negotiated by the model.

## **§1.5 No direct client exposure**

The browser/client never invokes 03C directly. All tutor model access flows through the authenticated server (03B) → private orchestrator (03C) path. No Vertex credentials, endpoints, or service account tokens are exposed to the client under any deployment mode.

## **§1.6 No mastery, entitlement, or identity decisions**

03C does not:

* Decide who is allowed to invoke the tutor (03B §3 entitlement check owns this)  
* Decide what content the student sees (03B §16 anti-leak enforcement owns this)  
* Affect mastery score (02C owns this)  
* Resolve student identity (03B §3 owns this)

If 03C finds itself about to make any of these decisions, the code is wrong — the decision belongs upstream.

## **§1.7 Deterministic where determinism matters**

Model selection (Flash vs Pro per §V.3) uses deterministic rules based on envelope fields; no per-turn randomness. Context cache key generation is deterministic from the input keys. Structured output parsing is deterministic from the schema.

Generation itself is not deterministic (model temperature \> 0); that's a model property, not an orchestration property.

## **§1.8 Observability is first-class**

Every orchestrator invocation emits the observability signals in §XI. Metrics are named per 01A Part II conventions. Logs redact secrets per 01A Part II. Correlation IDs from 03B flow through to Vertex calls via request metadata where Vertex supports it.

## **§1.9 Least privilege always**

Cloud Run service account has only the IAM roles needed for: Vertex AI inference, Cloud Tasks enqueue/dequeue, Secret Manager read for HMAC secrets, Cloud Logging write. No broad `roles/editor` or project-level admin.

## **§1.10 Version the interface, not the implementation**

The 03B↔03C contract is versioned. Response envelope schema changes are breaking for 03B unless additive. Implementation changes (model updates, prompt tweaks, routing rule adjustments) are not part of the contract version.

## **§1.11 Cost awareness**

Vertex costs money per token. 03C is responsible for:

* Respecting bounded token caps (§1.4)  
* Using context cache when available (§VI)  
* Routing to Flash for simple turns to save cost (§V.3)  
* Emitting cost-related observability (§XI.3)

Cost is not a correctness concern, but cost runaway is an incident. SLIs track trend.

---

# **Part II — Topology**

## **§2.1 Service inventory**

03C V1.2 topology:

\[03B LISA API handler, Cloud Run\]  
         │  
         │ HTTP \+ HMAC (01A Part VII)  
         ▼  
\[03C Orchestrator, Cloud Run (private)\]  
         │  
         ├───▶ \[Vertex AI Gemini API\]  
         │  
         ├───▶ \[03B mapping table: tutor\_vertex\_context\_cache\]  
         │         (read to look up Vertex CachedContent names;  
         │          insert new rows after Vertex cache creation)  
         │  
         └───▶ \[Cloud Tasks queue\]  
                   │  
                   ▼  
              \[03C Async Job Handler, Cloud Run (private)\]  
                   │  
                   ├───▶ \[Vertex AI Gemini API\] (for summary generation)  
                   │  
                   └───▶ \[Supabase: tutor\_memory\_summaries\]  
                              (bounded writeback; compaction results only)

**Process boundaries:**

* 03B handler \= main API process (exists, 03B V4.1 defines)  
* 03C orchestrator \= new private Cloud Run service  
* 03C async job handler \= can be the same Cloud Run service with different routes, OR a separate Cloud Run service — deployment choice; both approaches are valid (§XIII.3)

## **§2.2 Regional topology**

V1: single-region, `us-central1`.

* Cloud Run orchestrator: us-central1  
* Vertex AI endpoint: us-central1 (`us-central1-aiplatform.googleapis.com`)  
* Cloud Tasks queue: us-central1  
* Supabase Postgres: us-east-1 (AWS)

**Cross-cloud latency:** GCP us-central1 → AWS us-east-1 is typically 15-30ms round-trip. Async jobs from 03C writing to Supabase pay this once per job. Not on user-facing turn path.

V2 target: co-located region with Supabase primary, or multi-region 03C with regional Vertex routing.

## **§2.3 Authentication model between services**

03B → 03C: HMAC per 01A Part VII (§IX.1). 03C → Vertex AI: Google-issued service account credential, attached to Cloud Run. Cloud Tasks → 03C: OIDC token, Cloud Run IAM-authenticated invocation. Cloud Tasks enqueue from 03B or 03C: service account with `roles/cloudtasks.enqueuer`.

No secrets in environment variables except the HMAC signing keys (via Secret Manager mount, per 01A §64).

## **§2.4 Service account topology**

Per 01A §56-§58 service account conventions:

| Service account | Purpose | Key IAM roles |
| ----- | ----- | ----- |
| `lisa-api@PROJECT.iam` | 03B handler process (on Cloud Run) | `roles/run.invoker` on 03C; Cloud Tasks enqueuer; Supabase DB access via credential (not IAM) |
| `lisa-orchestrator@PROJECT.iam` | 03C orchestrator (on Cloud Run) | `roles/aiplatform.user` (Vertex); Cloud Tasks enqueuer (for async follow-ups it triggers); Secret Manager reader for HMAC secret; Supabase DB read-only RLS-scoped access to `tutor_vertex_context_cache` (for §6 lookups), `canonical_questions` (for §5.9 candidate pre-select), `tutor_context_runtime_config` (for §5.2 model identifiers \+ other runtime config) |
| `lisa-memory-worker@PROJECT.iam` | 03C async job handler (Cloud Run); executes 03A V3-owned memory refresh \+ compaction jobs per §VIII.0 ownership split | Same as orchestrator \+ Supabase DB read access to 02B/02C/03A tables for refresh inputs \+ Supabase DB write access scoped to `tutor_memory_summaries` \+ `tutor_vertex_context_cache` only |
| `lisa-cloud-tasks@PROJECT.iam` | Cloud Tasks identity when invoking 03C async handler | `roles/run.invoker` on async handler only |

Every service account uses least-privilege. No `roles/editor`, no project-wide bindings.

## **§2.5 Vertex AI project and region (V1.1 — NTH-03C-01 per-env projects)**

V1 configuration (locked):

* Vertex AI projects per environment:  
  * `lyceon-vertex-prod` (production; main customer-facing traffic)  
  * `lyceon-vertex-staging` (pre-production validation)  
  * `lyceon-vertex-dev` (developer/debugging; low quota ceiling to prevent runaway spend)  
* Vertex AI region: `us-central1` (all environments)  
* Models in use: `gemini-2.5-flash` and `gemini-2.5-pro` (per §5.3 routing)

**Why separate projects per environment:**

* Cost isolation (staging/dev spend can't accidentally hit prod budget)  
* Quota isolation (a dev runaway script can't starve prod traffic)  
* IAM isolation (dev service accounts don't have prod access by construction)  
* Billing-at-a-glance (prod line-item easy to distinguish from staging/dev)

Quotas and QoS:

* Vertex AI default quotas apply (requests per minute per project)  
* Quota monitored via Google Cloud Monitoring; alerts at 80% utilization  
* Dev project quota capped well below production (e.g., 100 req/min vs prod 1000+ req/min) — prevents runaway cost  
* Per-user quota enforcement happens at 01A Part V rate limiter (03B's concern); 03C does not enforce per-user limits

---

# **Part III — Request Contract (03B → 03C)**

The request envelope is small, server-resolved, and fully structured. 03B builds it; 03C consumes it.

## **§3.1 Inbound endpoint**

POST /orchestrate/turn

Cloud Run-private, IAM-authenticated, HMAC-signed per 01A Part VII.

**Per 01A convention:** endpoint path is stable across versions; contract changes are signaled via `schema_version` field in the envelope.

## **§3.2 Request envelope**

{  
  "schema\_version": "1.0",  
  "request\_id": "uuid",  
  "correlation\_id": "uuid",

  "conversation\_id": "uuid",  
  "student\_id": "uuid",

  "entry\_mode": "scoped\_question | scoped\_session | general",  
  "source\_surface": "practice | review | test\_review | dashboard",

  "resolved\_scope": {  
    "source\_session\_id": "uuid | null",  
    "source\_session\_item\_id": "uuid | null",  
    "source\_question\_row\_id": "uuid | null",  
    "source\_question\_canonical\_id": "text | null"  
  },

  "recent\_messages": \[  
    {  
      "id": "uuid",  
      "role": "student | tutor | system",  
      "content\_kind": "message | suggestion | consent\_prompt | system\_note",  
      "message": "string",  
      "created\_at": "timestamptz"  
    }  
  \],

  "memory\_summaries": \[  
    {  
      "summary\_type": "teaching\_profile | chat\_compaction | recent\_learning\_pattern | study\_context",  
      "summary\_version": "string",  
      "content\_json": {},  
      "source\_window\_start": "timestamptz | null",  
      "source\_window\_end": "timestamptz | null"  
    }  
  \],

  "student\_context": {  
    "recent\_practice": {},  
    "recent\_review": {},  
    "recent\_full\_length": {},  
    "kpi\_state": {},  
    "mastery\_state": {},  
    "study\_plan\_context": {}  
  },

  "policy\_assignment": {  
    "policy\_family": "string",  
    "policy\_variant": "string",  
    "policy\_version": "string",  
    "prompt\_version": "string | null",  
    "assignment\_mode": "deterministic | explore | manual\_override",  
    "assignment\_key": "string",  
    "reason\_snapshot": {}  
  },

  "runtime\_limits": {  
    "max\_output\_tokens": 600,  
    "timeout\_ms": 8000  
  },

  "streaming": {  
    "enabled": false  
  }  
}

## **§3.3 Envelope field rules**

**`recent_messages`:**

* 03B provides bounded window (default last 12 turns per 03A V3 §5.2)  
* 03C does NOT re-query for older messages; what's in the envelope is what's used  
* Fields are exactly those needed for prompt assembly; no extra state

**`memory_summaries`:**

* 03B filters by relevance and freshness (03A V3 §7)  
* 03C treats summaries as authoritative; does not re-fetch  
* Allowed types: `teaching_profile`, `chat_compaction`, `recent_learning_pattern`, `study_context`

**`student_context`:**

* Only populated fields are loaded (03B decides what's relevant per surface)  
* `study_plan_context` only populated when surface/policy explicitly allows (03A V3 §5.4)  
* 03C treats as opaque data for prompt assembly; does not interpret

**`policy_assignment`:**

* Mirrors 03A V3 §10 instructional assignment  
* 03C uses `policy_variant` for model routing (§V.3) and prompt template selection  
* `reason_snapshot` is logged via observability but not consumed by 03C logic

**`runtime_limits`:**

* Server-owned; 03C treats as hard bounds  
* V1 defaults: `max_output_tokens: 600`, `timeout_ms: 8000`  
* 03C rejects envelope if bounds exceed configured service maximums (§XIV.2)

**`streaming.enabled`:**

* Default false (sync mode, V1 primary)  
* When true, 03C returns SSE-like stream; see §VII.4

## **§3.4 Envelope validation**

03C validates request envelope at entry:

1. Schema version is known (V1 supports `"1.0"`)  
2. HMAC signature valid per 01A Part VII §62 (fail 401 otherwise)  
3. Required fields present (`conversation_id`, `student_id`, `entry_mode`, `source_surface`, `policy_assignment.policy_variant`, `runtime_limits`)  
4. Field constraints: `max_output_tokens <= 2000`, `timeout_ms <= 15000` (hard service maxima regardless of caller value)  
5. `recent_messages.length <= 50` (prevent unbounded prompt assembly)

Validation failure → 400 with structured error; 03B logs and surfaces generic 500 to user. No data leakage to client about envelope content.

## **§3.5 Idempotency posture (03C)**

03C is **not** idempotent on its own. Repeated calls with same envelope may produce different outputs (model non-determinism) and create multiple Vertex context cache entries.

Idempotency is handled entirely at 03B §13.7 (the two-phase advisory-lock pattern). By the time a request reaches 03C, 03B has confirmed this is a fresh attempt — 03C proceeds without its own idempotency guard.

**Consequence:** 03C must never be invoked speculatively (e.g., "warm up" the model). Every 03C call is a committed-intent call.

---

# **Part IV — Context Assembly**

## **§4.1 Division of concerns**

* **Context resolution** (what data to include) \= 03A V3 §5-§6 \+ 03B envelope builder  
* **Context assembly** (how to structure the prompt) \= 03C §IV (this Part)  
* **Prompt content** (the actual text of system/policy prompts) \= 03A V3 §11 policy prompt artifacts

03C does not resolve context or author prompt text. It only assembles the resolved context into a Vertex-compatible request.

## **§4.2 Prompt structure (V1.1 — AMB-03C-02 native Gemini Content\[\] format)**

V1.1 locks native Gemini Content\[\] array format. Structure of a Vertex request:

systemInstruction:  
  parts:  
    \- text: \[policy instruction \+ teaching profile summary\]  ← CACHED per §VI per-student composite

contents:  
  \- role: user (tagged as system note)  
    parts:  
      \- text: \[student context snapshot — opaque JSON serialized; §4.2.1\]  
  \- role: user (tagged as system note)  
    parts:  
      \- text: \[recent learning pattern summary — if relevant\]  
  \- role: user (tagged as system note)  
    parts:  
      \- text: \[study context — if dashboard/general entry\]  
  \- role: user (tagged as system note)  
    parts:  
      \- text: \[chat compaction summary — if conversation \> threshold\]  
  \- role: user (tagged as system note)  
    parts:  
      \- text: \<question\_context\>...\</question\_context\>  ← only if scoped\_question; §6.6  
  \- role: user (tagged as system note)  
    parts:  
      \- text: \<candidate\_questions\>...\</candidate\_questions\>  ← only if similar-question triggered; §5.9.3  
  \- role: user | model  ← recent\_messages, mapped from {'student': 'user', 'tutor': 'model', 'system': 'user'}  
    parts:  
      \- text: \[message content\]  
  \- role: user | model  ← (continues through recent\_messages window, up to 12 turns)  
    parts:  
      \- text: \[message content\]  
  \# The final message in the contents\[\] array IS the current user turn (no separate duplicate)

**Cache-eligibility mapping:**

* `systemInstruction` → cached via §VI per-student composite (policy \+ teaching\_profile)  
* `contents[]` → not cached (varies per turn: student context snapshot, question context, candidates, recent messages)

**Role mapping from envelope to Gemini:**

* `envelope.recent_messages[].role == 'student'` → Gemini `role: 'user'`  
* `envelope.recent_messages[].role == 'tutor'` → Gemini `role: 'model'`  
* `envelope.recent_messages[].role == 'system'` → Gemini `role: 'user'` with system-note tag prefix (Gemini does not support a native system role inside `contents[]`; system-level context goes in `systemInstruction` or tagged user messages)

### **4.2.1 Student context opacity (V1.1 — AMB-03C-01; V2.1 PII guard reference)**

`envelope.student_context` fields (`recent_practice`, `recent_review`, `recent_full_length`, `kpi_state`, `mastery_state`, `study_plan_context`) are treated as **opaque JSON**. 03C does not parse internals.

Assembly behavior:

* If prompt template references a field via path substitution (e.g., `{student_context.kpi_state.readiness_score}`), 03C resolves the path and substitutes the value as a string  
* If the path is missing or the field is null, the substitution inserts the literal string `"n/a"` (configurable via `prompt.null_substitution` runtime config)  
* No structural interpretation: if a template wants a formatted table from `mastery_state`, the template provides the format logic via its own string; 03C does not serialize object shapes

**Shape definitions (authoritative):**

* `recent_practice`, `recent_review`, `recent_full_length`, `kpi_state`, `mastery_state` → Doc 02C \+ 03A V3 §6  
* `study_plan_context` → Doc 07 (Calendar & Study Planning)

If template references a field 03C cannot resolve (envelope value is not a string and cannot be trivially stringified), 03C logs a drift warning and substitutes `"n/a"`. Does not fail the turn.

**PII contract (V2.1 — BLK-V2-03):** per 03A V3 §6 data contract, `student_context` fields must NOT contain PII-equivalent data (full name, email, phone, address, date of birth, guardian identity data). Only UUID-scoped references, numerical scores, categorical tags, and similarly non-identifying values. **V2.1 enforces this in 03C with a deterministic PII guard (§4.2.2)** — defense-in-depth above 03B's envelope-builder responsibility, given the minor-facing audience.

### **4.2.2 Deterministic PII guard (V2.1 — BLK-V2-03 closeout)**

**Why 03C runs its own PII guard:** Lyceon's tutor is minor-facing. A privacy incident from PII reaching Vertex is a serious user-safety event. Even if 03B's envelope builder is correct today, an upstream bug (regression in 03B, change in 03A V3 §6 shape, change in 02C source data) could leak PII into `student_context` without 03C catching it. V2.1 adds a deterministic shallow PII screener that runs on the assembled prompt **before any Vertex call**, blocking turns where PII patterns are detected.

**Scope of the guard:**

* Applies to the fully-assembled prompt body (system instruction \+ all `contents[]` text)  
* Runs after §4.5 content safety pre-pass; before §VI cache lookup  
* Detects regex patterns; does not attempt semantic understanding  
* Fail-closed: any pattern hit blocks the turn with `pii_in_envelope` error

**Detection patterns:**

// V2.1 PII guard — deterministic regex screener.  
// Conservative: false positives are acceptable (block \+ log); false negatives are not.  
// Patterns covered: email, phone (US/international), DOB/birthdate, address-like  
// fields (street \+ city/zip), guardian identifiers, full-name labels.

const PII\_PATTERNS: ReadonlyArray\<{ name: string; pattern: RegExp; severity: 'block' | 'warn' }\> \= \[  
  // Email: anything that looks like name@domain.tld  
  {  
    name: 'email',  
    pattern: /\\b\[A-Za-z0-9.\_%+-\]+@\[A-Za-z0-9.-\]+\\.\[A-Za-z\]{2,}\\b/,  
    severity: 'block',  
  },  
  // Phone: NANP (US) and international forms; bounded false-positive surface  
  {  
    name: 'phone\_us',  
    pattern: /\\b(?:\\+?1\[-.\\s\]?)?\\(?\\d{3}\\)?\[-.\\s\]?\\d{3}\[-.\\s\]?\\d{4}\\b/,  
    severity: 'block',  
  },  
  {  
    name: 'phone\_intl',  
    pattern: /\\+\\d{1,3}\[\\s.-\]?\\d{1,4}\[\\s.-\]?\\d{2,4}\[\\s.-\]?\\d{2,4}\[\\s.-\]?\\d{2,4}/,  
    severity: 'block',  
  },  
  // DOB / birthdate: explicit labels OR ISO/US date formats next to age-related context  
  {  
    name: 'dob\_label',  
    pattern: /\\b(?:date of birth|birthdate|DOB|birthday)\\s\*\[:=\]\\s\*\\S+/i,  
    severity: 'block',  
  },  
  {  
    name: 'date\_iso',  
    pattern: /\\b(19|20)\\d{2}-(0\[1-9\]|1\[0-2\])-(0\[1-9\]|\[12\]\\d|3\[01\])\\b/,  
    severity: 'block',  
  },  
  {  
    name: 'date\_us',  
    pattern: /\\b(0?\[1-9\]|1\[0-2\])\\/(0?\[1-9\]|\[12\]\\d|3\[01\])\\/((19|20)\\d{2}|\\d{2})\\b/,  
    severity: 'block',  
  },  
  // Address-like: street number \+ street type, OR ZIP code patterns  
  {  
    name: 'address\_street',  
    pattern: /\\b\\d{1,6}\\s+\[A-Z\]\[a-zA-Z\]+\\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place)\\b/,  
    severity: 'block',  
  },  
  {  
    name: 'zip\_code',  
    pattern: /\\b\\d{5}(?:-\\d{4})?\\b/,  // Note: false positive on bare 5-digit numbers; severity 'warn' only  
    severity: 'warn',  
  },  
  // Full-name labels: explicit labeling of names  
  {  
    name: 'name\_label',  
    pattern: /\\b(?:full name|first name|last name|student name|guardian name|parent name)\\s\*\[:=\]\\s\*\[A-Z\]\[a-z\]+/i,  
    severity: 'block',  
  },  
  // Guardian identifiers: explicit labels  
  {  
    name: 'guardian\_id',  
    pattern: /\\b(?:guardian (?:id|email|phone|account)|parent (?:id|email|phone|account))\\s\*\[:=\]/i,  
    severity: 'block',  
  },  
\];

interface PiiGuardResult {  
  ok: boolean;  
  hits: Array\<{ pattern\_name: string; severity: 'block' | 'warn'; offset: number }\>;  
}

function piiGuard(assembledPromptBody: string): PiiGuardResult {  
  const hits: PiiGuardResult\['hits'\] \= \[\];

  for (const { name, pattern, severity } of PII\_PATTERNS) {  
    const match \= pattern.exec(assembledPromptBody);  
    if (match) {  
      hits.push({  
        pattern\_name: name,  
        severity,  
        offset: match.index,  
      });  
    }  
  }

  const blocking \= hits.filter(h \=\> h.severity \=== 'block');  
  return {  
    ok: blocking.length \=== 0,  
    hits,  
  };  
}

// Wired into the request pipeline (between §4.5 content safety pre-pass and §VI cache lookup):  
async function preVertexPiiCheck(  
  assembledPromptBody: string,  
  envelope: RequestEnvelope,  
): Promise\<void\> {  
  const result \= piiGuard(assembledPromptBody);

  // Always emit observability for hits (even warn-level)  
  for (const hit of result.hits) {  
    metrics.increment('orchestrator\_pii\_pattern\_hit\_total', {  
      pattern\_name: hit.pattern\_name,  
      severity: hit.severity,  
    });  
  }

  if (\!result.ok) {  
    // Blocking hit — fail the turn before Vertex  
    logger.error('orchestrator\_pii\_blocked', {  
      request\_id: envelope.request\_id,  
      student\_id: envelope.student\_id,  
      // Do NOT log assembledPromptBody (it contains the PII)  
      // Do log pattern names (no values) for ops triage  
      blocking\_patterns: result.hits.filter(h \=\> h.severity \=== 'block').map(h \=\> h.pattern\_name),  
    });  
    metrics.increment('orchestrator\_pii\_blocked\_turns\_total');  
    throw new PiiInEnvelopeError(envelope.request\_id);  
  }  
}

**Failure mode:** when `piiGuard` returns `ok: false`, 03C returns error code `pii_in_envelope` (HTTP 400; not retryable; treated as caller bug per §7.3 error map). 03B treats this as a SEV-2 alert: it indicates an upstream PII leak (envelope builder bug, schema regression, etc.) that needs immediate ops escalation.

**Observability (V2.1 new SLIs):**

* `orchestrator_pii_pattern_hit_total{pattern_name, severity}` — counter; informational for warn-level, alerting for block-level  
* `orchestrator_pii_blocked_turns_total` — counter; alert page on **any** hit during a 5-minute window (privacy incidents are not soft alerts)

**Privacy of the guard itself:**

* The guard reads the assembled prompt body in-memory; never logs the body  
* Pattern hits log only the pattern name, severity, and request\_id — not the matched substring  
* The guard runs synchronously in the orchestrator process; no PII-bearing data leaves 03C boundary on the failure path

**Performance bound:** 9 regex patterns × prompt body length (\~2-16k tokens / \~10-80k chars). Total scan time P95 \<5ms on Cloud Run instance; not a meaningful contributor to total turn latency.

**False-positive surface:**

* `zip_code` pattern (`severity: warn` only) will trigger on any bare 5-digit number (e.g., a question stem about "the year 12345"). Acceptable: warn-level just emits a metric; does not block.  
* `phone_us` may trigger on mathematical expressions like `123-456-7890` if quoted in a math problem. Mitigation: phone hits are blocking, but the rate should be low; if observed in production, tune pattern with negative lookbehinds for math context.  
* `date_us` and `date_iso` may trigger on legitimate question content (history questions about dates). Mitigation: blocking decision is acceptable here — if a student or tutor needs to discuss dates, 03A V3 §6 should specify that dates in `student_context` use ISO timestamps (stripped at envelope-building) rather than free-form. Rate should be near-zero in production; alert on first hit.

**Configuration:**

* `pii_guard.enabled` (default `true`; emergency disable via runtime config)  
* `pii_guard.warn_severity_blocks` (default `false`; if `true`, treats warn-level as blocking)

**V3 target:** swap regex screener for ML-based PII detector (e.g., GCP DLP API) for higher accuracy. V2.1 regex approach is sufficient for V1 launch (deterministic, fast, low maintenance).

## **§4.3 Prompt template loading**

System prompts per `(policy_variant, prompt_version)` are:

* Authored in 03A V3 §11 (policy prompt artifacts)  
* Versioned and stored in the repo (or dedicated prompt artifact storage)  
* Loaded into Cloud Run instance memory at bootstrap  
* Immutable per instance lifetime (change requires redeploy with new `prompt_version`)

03C does NOT dynamically generate prompt text. Every character comes from a versioned artifact. This supports:

* Reproducibility (same policy\_version \+ prompt\_version \+ inputs → same prompt assembled)  
* Auditability (exact prompt reconstructible from artifact \+ envelope)  
* Vertex cache stability (cached CachedContent references stable prompt text by version)

## **§4.4 Assembly rules**

**No runtime prompt editing.** 03C concatenates retrieved artifacts in defined order. No LLM-authored meta-prompts, no dynamic persona injection, no ad-hoc instructions based on envelope content beyond field substitution.

**Field substitution:** where prompt templates include placeholders (e.g., `{student_first_name}`, `{source_question_stem}`), 03C substitutes values from envelope. Placeholders are enumerated in the prompt artifact; unknown placeholders fail-closed (400).

**No canonical ID exposure to the model:** per 03A V3 §11.2, canonical question IDs are internal-only. 03C does not pass `source_question_canonical_id` into the prompt body; it passes question content (stem, options, correct answer where context allows per 03B §16 anti-leak rules) without the ID string. ID stays in request metadata for 03C's own cache key computation.

**Similar-question candidate IDs are opaque slot IDs, not canonical IDs.** Per §5.9 candidate-slots flow, when the model is asked to propose a similar question, 03C passes pre-selected candidates tagged with opaque `slot_1`, `slot_2`, etc. The model returns a slot\_id; 03C resolves to canonical\_id server-side. The model never sees canonical IDs.

## **§4.5 Content safety pre-pass**

Before invoking Vertex, 03C does a bounded pre-pass on assembled context:

* Enforce length bound: assembled prompt \<= configured `prompt_max_tokens` (V1: 16000 tokens)  
* Truncate `recent_messages` from oldest-first if over bound (preserves current turn)  
* Reject envelope if truncation cannot bring it under bound (500 to 03B; should not happen with default envelope caps)

This is NOT anti-leak enforcement (that's 03B §16 on the response). This is prompt-size bounding for cost and model compatibility.

---

# **Part V — Vertex AI Invocation**

## **§5.1 Client library**

03C uses the official Google Cloud Vertex AI SDK for Node.js (`@google-cloud/vertexai`) per 01A Part I stack convention.

**Why SDK over raw HTTP:** authentication (ADC \+ service account), retry boilerplate, structured output parsing, streaming primitives, and metric emission all built-in. Reduces 03C surface area.

## **§5.2 Model identifiers**

V1 locked:

* `gemini-2.5-flash` — fast, cost-efficient, default for simple turns  
* `gemini-2.5-pro` — higher quality, higher cost, for complex turns per §5.3 routing

Model identifiers are configured via 03A V3 §18.7 `tutor_context_runtime_config` keys:

* `vertex.model.flash` (default `"gemini-2.5-flash"`)  
* `vertex.model.pro` (default `"gemini-2.5-pro"`)

Config changes are propagated via 01A §4 LISTEN/NOTIFY; 03C instances pick up new model identifier within config-propagation-lag bounds. No code deploy required for model identifier update.

## **§5.3 Model routing logic (V1.1 — AMB-03C-03 precedence \+ BLK-03C-04 fallback)**

Routing is deterministic per envelope fields with **explicit precedence order**. 03C evaluates rules top-to-bottom; the first match wins.

### **5.3.1 Primary routing table (ordered precedence)**

Rules evaluated in order:

| Priority | Rule | Model selected |
| ----- | ----- | ----- |
| 1 | `runtime_limits.model_override` is set (debug/A-B) | Override value (Flash or Pro) |
| 2 | Circuit breaker: Pro budget exceeded for today (§5.3.3) | Flash (budget-circuit-breaker active) |
| 3 | `source_surface == "test_review"` | Pro |
| 4 | `source_surface == "review"` | Pro |
| 5 | `entry_mode == "general"` (dashboard coaching) | Pro |
| 6 | `entry_mode == "scoped_session"` (session-level reflection) | Pro |
| 7 | `entry_mode == "scoped_question"` AND `policy_variant IN ("scaffolded", "socratic")` | Pro |
| 8 | `entry_mode == "scoped_question"` AND `policy_variant IN ("concise", "strategy_first")` | Flash |
| 9 | Default fallback (no rule matched) | Flash |

**Precedence rationale:** `source_surface == "review" | "test_review"` takes precedence over `policy_variant` because review context always warrants higher-quality reasoning regardless of which instructional variant is assigned. Budget circuit breaker (priority 2\) preempts even explicit Pro-selection rules to protect daily spend. Override (priority 1\) lets ops/debug traffic bypass routing entirely.

**Routing observability:** `vertex_model_routing_distribution` SLI tracks per-turn distribution of Flash vs Pro across entry modes (§XI.2). Expected steady-state: \~40-60% Flash, \~40-60% Pro (varies by traffic composition).

### **5.3.2 Pro→Flash per-turn fallback (BLK-03C-04 closeout)**

When §5.3.1 selects Pro and Vertex Pro fails, 03C automatically falls back to Flash for that turn rather than returning an error to 03B.

**Fallback triggers (Vertex Pro call response):**

* Vertex 5xx (transient service error) after retry exhausted per §5.8  
* Vertex 429 (quota exhausted)  
* Vertex timeout (exceeds `runtime_limits.timeout_ms`)

**Fallback does NOT trigger for:**

* Vertex 400 (request validation) — indicates envelope bug; fall through to error  
* Vertex 422 (safety filter blocked) — indicates content policy; fall through to error (03B substitutes safe hint per §16)  
* Vertex 403 (auth) — indicates infra bug; fall through to error

**Fallback behavior:**

async function invokeWithFallback(  
  primaryModel: ModelId,  
  vertexRequest: VertexRequest,  
): Promise\<VertexResponse\> {  
  try {  
    return await invokeVertexModel(primaryModel, vertexRequest);  
  } catch (err) {  
    if (primaryModel \!== 'pro') throw err;  // Flash has no fallback target  
    if (\!isFallbackEligible(err)) throw err;  // 400/422/403 pass through

    // Pro failed with fallback-eligible error; try Flash  
    await logger.warn('vertex\_pro\_fallback\_applied', {  
      primary\_model: primaryModel,  
      fallback\_model: 'flash',  
      error\_code: err.code,  
      error\_class: classify(err),  
    });  
    await metrics.increment('vertex\_pro\_fallback\_rate');

    return await invokeVertexModel('flash', vertexRequest);  
  }  
}

**Quality degradation disclosure:** when fallback is applied, 03C tags the response `orchestration_meta.model_name = "gemini-2.5-flash"` (the actual model used) with `orchestration_meta.fallback_applied = true`. 03B may choose to pass this signal to the client or log it. 03B does not fail the turn just because fallback occurred.

**Fallback limits:**

* Only Pro → Flash (no Flash → any-other fallback path)  
* One fallback attempt per turn (no cascading fallbacks)  
* If Flash also fails, propagate the Flash error to 03B

### **5.3.3 Budget circuit breaker for Pro (BLK-03C-04 closeout)**

A **budget circuit breaker** monitors daily Pro spend against a configured ceiling. When daily Pro spend exceeds the ceiling, 03C forces all Pro-routed turns to Flash until the next budget period (midnight UTC).

**Configuration (via 03A V3 §18.7 runtime config):**

* `vertex.pro.daily_budget_usd` — daily ceiling in USD (e.g., 200\)  
* `vertex.pro.budget_circuit_breaker_enabled` — boolean; default `true`  
* `vertex.pro.budget_circuit_breaker_warning_pct` — trigger warning log at this percentage (default 80\)

**State machine:**

\[normal\] → \[warning\] at 80% of daily budget → log WARN; continue Pro selection  
\[warning\] → \[tripped\] at 100% of daily budget → force all Pro → Flash for remainder of day  
\[tripped\] → \[normal\] at midnight UTC daily reset

**Implementation:**

async function getRoutingDecision(envelope: RequestEnvelope): Promise\<ModelId\> {  
  // Priority 1: override  
  if (envelope.runtime\_limits.model\_override) {  
    return envelope.runtime\_limits.model\_override;  
  }

  // Priority 2: budget circuit breaker  
  if (await isProBudgetCircuitBreakerTripped()) {  
    await metrics.increment('vertex\_pro\_budget\_circuit\_breaker\_redirects');  
    return 'flash';  
  }

  // Priority 3-8: normal routing table (§5.3.1)  
  return applyRoutingRules(envelope);  
}

async function isProBudgetCircuitBreakerTripped(): Promise\<boolean\> {  
  const ceilingUsd \= await getConfig('vertex.pro.daily\_budget\_usd');  
  const enabled \= await getConfig('vertex.pro.budget\_circuit\_breaker\_enabled');  
  if (\!enabled || \!ceilingUsd) return false;

  const todaySpend \= await getDailyProSpend();  // from cost observability (§11.3)  
  return todaySpend \>= ceilingUsd;  
}

**Observability:**

* `vertex_pro_budget_circuit_breaker_state` (informational: normal | warning | tripped)  
* `vertex_pro_budget_circuit_breaker_redirects` (count of turns redirected to Flash due to breaker)  
* Alert at warning state reached (Slack; informational for ops)  
* Alert at tripped state (PAGE; budget exhausted is a real SEV-3 event because user-experienced quality degrades on Pro-routed turns)

**Manual override:** ops can disable the circuit breaker by setting `vertex.pro.budget_circuit_breaker_enabled = false`. Used in emergencies (e.g., known budget miscounting; need to keep Pro serving).

**Budget reset:** daily at 00:00 UTC. Spend counter resets; breaker automatically transitions from tripped → normal.

## **§5.4 Structured output — hybrid strictness**

Per Q4 locked choice, response contract uses **hybrid strictness**:

**Strict schema (Vertex `response_schema` enforced):**

* `suggested_action.type` (enum: `none | offer_similar_question | offer_broader_coaching | offer_stay_focused`)  
* `suggested_action.label` (nullable string; max 120 chars)  
* `question_links[]` (structured array per 03B §12B.5 / 03A V3 §10 mapping)  
* `instruction_exposures[]` (structured array per 03A V3 §11.4)

If Vertex returns a response that fails strict schema on these fields, 03C returns error to 03B and does not serve the response. Alternative: retry once with a reinforced prompt (V2).

**Lenient (best-effort parse):**

* `response.content` (the actual tutor message text) — Markdown allowed, but no enforced structure beyond length bound  
* `ui_hints.suggested_chip` (nullable string; max 60 chars)

For lenient fields, if Vertex returns schema drift (missing field, extra fields, mistyped), 03C normalizes:

* Missing → default (empty string, null, false)  
* Extra → stripped  
* Mistyped → coerced if possible (e.g., number → string), rejected if not

Drift is logged via `vertex_output_schema_drift_rate` SLI (§XI.2).

## **§5.5 Response schema (Vertex request)**

{  
  "type": "object",  
  "properties": {  
    "response": {  
      "type": "object",  
      "properties": {  
        "content": { "type": "string", "maxLength": 4000 },  
        "content\_kind": { "type": "string", "enum": \["message"\] },  
        "suggested\_action": {  
          "type": "object",  
          "properties": {  
            "type": {  
              "type": "string",  
              "enum": \["none", "offer\_similar\_question", "offer\_broader\_coaching", "offer\_stay\_focused"\]  
            },  
            "label": { "type": \["string", "null"\], "maxLength": 120 }  
          },  
          "required": \["type"\]  
        },  
        "ui\_hints": {  
          "type": "object",  
          "properties": {  
            "show\_accept\_decline": { "type": "boolean" },  
            "allow\_freeform\_reply": { "type": "boolean" },  
            "suggested\_chip": { "type": \["string", "null"\], "maxLength": 60 }  
          }  
        }  
      },  
      "required": \["content", "content\_kind", "suggested\_action"\]  
    },  
    "question\_links": {  
      "type": "array",  
      "description": "V2.1 (BLK-V2-02): Vertex output uses opaque candidate slot IDs only; 03C resolves to canonical IDs post-Vertex per §7.1.1. The model never produces canonical IDs.",  
      "items": {  
        "type": "object",  
        "properties": {  
          "related\_candidate\_slot\_id": {  
            "type": \["string", "null"\],  
            "description": "Opaque slot ID from candidate list (§5.9.3). Null if model omits link entry."  
          },  
          "relationship\_type": {  
            "type": "string",  
            "enum": \["current", "similar\_retry", "simpler\_variant", "harder\_variant", "concept\_extension"\]  
          },  
          "reason\_code": { "type": "string" },  
          "link\_snapshot": { "type": "object" }  
        },  
        "required": \["relationship\_type", "reason\_code"\]  
      }  
    },  
    "instruction\_exposures": {  
      "type": "array",  
      "items": {  
        "type": "object",  
        "properties": {  
          "exposure\_type": {  
            "type": "string",  
            "enum": \["hint", "explanation", "strategy", "similar\_question\_offer", "broader\_coaching\_offer", "consent\_prompt"\]  
          },  
          "content\_variant\_key": { "type": \["string", "null"\] },  
          "content\_version": { "type": \["string", "null"\] },  
          "rendered\_difficulty": { "type": \["integer", "null"\] },  
          "hint\_depth": { "type": \["integer", "null"\] },  
          "tone\_style": { "type": \["string", "null"\] },  
          "sequence\_ordinal": { "type": "integer" }  
        },  
        "required": \["exposure\_type", "sequence\_ordinal"\]  
      }  
    }  
  },  
  "required": \["response"\]  
}

This schema is passed as Vertex's `response_schema` parameter when the model supports structured output.

## **§5.6 Allowed generation scope**

The model may generate:

* Tutor explanation, hint, strategy text (content field)  
* Bounded suggested action (from enum)  
* Bounded UI hints (defined fields)  
* Bounded exposure metadata

The model must NOT generate (and 03C must strip if present):

* Canonical DB writes (not possible from model output — but monitored as anomaly)  
* Entitlement / role decisions (not in schema)  
* Mastery state references (stripped from content if detected)  
* Claims beyond retrieved/allowed content (anti-leak enforcement at 03B §16)

## **§5.7 Generation parameters (V2.1 — review-swipe: topK \+ seed added)**

Per-invocation Vertex parameters:

{  
  model: selectedModel,  // per §5.3 routing  
  contents: \[...\],       // per §IV prompt assembly  
  systemInstruction: {...},  // from policy prompt artifact  
  generationConfig: {  
    temperature: 0.3,      // low-temp; tutor is informative, not creative  
    topP: 0.95,  
    topK: 40,              // V2.1: explicit; bounds nucleus sampling further  
    maxOutputTokens: envelope.runtime\_limits.max\_output\_tokens,  
    // V2.1: seed parameter for deterministic regeneration in debug runs.  
    // Production traffic always passes null/undefined (non-deterministic);  
    // incident-replay traffic passes envelope.runtime\_limits.debug\_seed.  
    seed: envelope.runtime\_limits.debug\_seed ?? undefined,  
    responseSchema: STRICT\_FIELDS\_SCHEMA,  // per §5.5  
    responseMimeType: "application/json"  
  },  
  safetySettings: \[        // Vertex content safety thresholds  
    { category: "HARM\_CATEGORY\_HARASSMENT", threshold: "BLOCK\_MEDIUM\_AND\_ABOVE" },  
    { category: "HARM\_CATEGORY\_HATE\_SPEECH", threshold: "BLOCK\_MEDIUM\_AND\_ABOVE" },  
    { category: "HARM\_CATEGORY\_SEXUALLY\_EXPLICIT", threshold: "BLOCK\_LOW\_AND\_ABOVE" },  
    { category: "HARM\_CATEGORY\_DANGEROUS\_CONTENT", threshold: "BLOCK\_MEDIUM\_AND\_ABOVE" }  
  \],  
  cachedContent: existingCacheName  // per §VI context cache consumption  
}

**Temperature 0.3 rationale:** tutor responses are instructional; creative diversity is not a goal. Low temperature improves structured output compliance and reduces drift.

**topK 40 rationale (V2.1):** bounds nucleus sampling further; reduces tail-of-distribution token selection. At temperature 0.3 \+ topP 0.95, topK 40 provides additional clamping against unlikely tokens that would degrade structured-output compliance.

**seed semantics (V2.1):** when `envelope.runtime_limits.debug_seed` is present (non-null integer), Vertex receives the seed and (subject to Vertex deterministic-mode support per model) produces reproducible output for the same prompt \+ seed combination. Production traffic always omits debug\_seed; only incident-replay or eval-fixture traffic uses it. Per `pii_guard` runs **before** Vertex regardless of seed presence; debug-run traffic still subject to PII guard.

**Safety settings:** `BLOCK_LOW_AND_ABOVE` for sexually explicit (tighter than other categories) given minor audience. Other categories at `MEDIUM_AND_ABOVE` to avoid over-triggering on legitimate academic content (e.g., SAT passages about historical atrocities).

## **§5.8 Timeout and retry (V1.1 — SWE-03C-02)**

* Primary timeout: envelope's `runtime_limits.timeout_ms` (default 8000ms)  
* Retry policy (V1.1 enhanced from V1's minimalist "immediate retry"):  
  * First retry: 200ms base \+ jitter (±50ms) before re-attempt  
  * Second retry: 800ms base \+ jitter (±200ms) before re-attempt  
  * Max 2 retries on transient 5xx, connection reset, or timeout  
  * Total wall-clock hard ceiling: `runtime_limits.timeout_ms + 1500ms` buffer (covers retries \+ network overhead)  
* Do NOT retry on: 400 (validation), 403 (auth), 422 (safety blocked), 429 (quota — let 03B handle fallback per §10.3)  
* Jitter rationale: prevents thundering-herd when many concurrent requests hit a Vertex blip simultaneously  
* Note: Vertex SDK's built-in retry may already apply; 03C's retry is an application-level enhancement. If SDK retry is enabled, 03C's retry counter starts after SDK exhausts; total attempts capped by SDK \+ 2 extra.

## **§5.9 Candidate-slots flow for similar-question selection (V1.1 — BLK-03C-02 closeout)**

V1 response schema required `related_question_canonical_id` in `question_links[]`, but §4.4 prohibits passing canonical IDs to the model. V1.1 resolves via **candidate-slots flow** (option a; option c semantic-search deferred to V2 per hybrid decision).

### **5.9.1 When candidate selection triggers**

When 03C detects a conversation state that may warrant a similar-question offer (per 03A V3 §8.1 similar-question trigger rules — student-explicit request, repeated confusion, sticky question), 03C pre-selects candidate related questions BEFORE invoking Vertex.

**Detection:** 03C inspects envelope's `recent_messages` for trigger signals:

* Student message contains phrases matching confusion patterns (configurable via 03A V3 §18.7)  
* Conversation turn count on same scoped question exceeds threshold (default 3 turns; per 03A V3 §8.1)  
* Envelope's `policy_assignment.reason_snapshot.trigger_type == "sticky_question"`

If no trigger is detected, 03C skips candidate pre-selection; the model does not receive a candidate list; `question_links[]` in response will only contain the source question reference (per 03A V3 §10 `tutor_question_links` row for the current scoped item).

### **5.9.2 Candidate pre-selection**

When triggered, 03C pre-selects 3-5 candidate questions server-side. Query runs against Lyceon question bank (DB access required; separate from MemoryRefreshWorker DB access — see §6 and §VIII service account IAM):

async function preSelectCandidates(  
  sourceQuestion: CanonicalQuestion,  
  studentId: string,  
): Promise\<CandidateQuestion\[\]\> {  
  // Candidate rules per 03A V3 §8.2:  
  // \- Same section  
  // \- Same domain  
  // \- Same skill (primary) or same subskill (if available)  
  // \- Not recently attempted by this student (last 30 days)  
  // \- Same difficulty by default; ±1 allowed when source is "sticky" per §8.2  
  // V2.1 (BLK-V2-04 closeout): deterministic seeded ordering replaces RANDOM().  
  // Seed \= canonical\_id || student\_id || current\_date — produces stable same-day  
  // ordering per (student, source-question) for replay/debug; varies across days  
  // for natural diversity rotation.  
  return await db.query(\`  
    SELECT  
      id AS question\_row\_id,  
      canonical\_id,  
      difficulty,  
      skill,  
      subskill  
    FROM canonical\_questions  
    WHERE section \= $1  
      AND domain \= $2  
      AND skill \= $3  
      AND difficulty BETWEEN $4 \- 1 AND $4 \+ 1  
      AND id \!= $5  
      AND NOT EXISTS (  
        SELECT 1 FROM student\_question\_attempts  
        WHERE student\_id \= $6  
          AND question\_row\_id \= canonical\_questions.id  
          AND attempted\_at \> now() \- interval '30 days'  
      )  
    ORDER BY  
      CASE WHEN difficulty \= $4 THEN 0 ELSE 1 END,  \-- prefer same difficulty  
      hashtext(canonical\_id || $6 || current\_date::text)  \-- deterministic per (question, student, day)  
    LIMIT 5  
  \`, \[  
    sourceQuestion.section,  
    sourceQuestion.domain,  
    sourceQuestion.skill,  
    sourceQuestion.difficulty,  
    sourceQuestion.id,  
    studentId,  
  \]);  
}

**Determinism guarantee (V2.1):** for a given `(source canonical_id, student_id, current_date)` tuple, the candidate ordering is stable. Two invocations of the same student turning to the same source question on the same day will receive the same candidate slot ordering. This enables:

* Reproducible debugging (re-running a failed turn yields same candidates)  
* Test fixtures that don't drift across runs  
* Replay-based incident investigation

The seed varies across days, so the same student returning to the same question tomorrow gets a different (still deterministic) candidate set — natural diversity without sacrificing replay.

**Timeout:** 200ms hard ceiling. On timeout or empty result, proceed without candidate slots (model doesn't receive a candidate list; no similar-question offer generated).

### **5.9.3 Opaque slot IDs in prompt**

Candidates are assigned opaque slot IDs (not canonical IDs) and passed to the model as structured context:

const candidatesBlock \= candidates.map((c, idx) \=\> ({  
  slot\_id: \`slot\_${idx \+ 1}\`,  
  difficulty: c.difficulty,  
  subskill: c.subskill,  
  // Question stem \+ options go in prompt as message content  
  content: formatQuestionForPrompt(c),  
})).slice(0, 5);

// Inject as system-note content in Gemini Content\[\] array:  
const candidatesContent \= {  
  role: 'user',  
  parts: \[{  
    text: \`\<candidate\_questions\>  
You may suggest one of the following candidate questions if a similar-question offer is appropriate. Each candidate is identified by an opaque slot\_id; use only the slot\_id in your response (not question text).

${candidatesBlock.map(c \=\> \`slot\_id: ${c.slot\_id} | difficulty: ${c.difficulty} | subskill: ${c.subskill ?? 'n/a'}\\n${c.content}\`).join('\\n\\n')}  
\</candidate\_questions\>\`,  
  }\],  
};

The model sees question content labeled by `slot_id`. The model returns a slot\_id in its response (not a canonical\_id).

### **5.9.4 Model response schema addition**

Response schema (§5.5) adds a candidate slot reference within `question_links[]`:

{  
  "question\_links": \[  
    {  
      "relationship\_type": "similar\_retry | simpler\_variant | harder\_variant | concept\_extension",  
      "related\_candidate\_slot\_id": "string | null",  // V1.1: opaque slot ID from §5.9.3  
      "related\_question\_canonical\_id": null,          // V1.1: always null in model output  
      "source\_question\_canonical\_id": "text",         // V1.1: known from envelope, filled by 03C  
      "source\_question\_row\_id": "uuid | null",        // V1.1: known from envelope, filled by 03C  
      "difficulty\_delta": "integer | null",  
      "reason\_code": "string",  
      "link\_snapshot": {}  
    }  
  \]  
}

**Model's responsibility:** pick the slot\_id that matches the intended similar question (or omit the question\_link entry if none is appropriate). Model MUST NOT hallucinate canonical IDs.

**03C's responsibility (post-model):** resolve each `related_candidate_slot_id` to the candidate's `canonical_id` and `question_row_id`; fill the response `question_links[]` entries accordingly. If model returns a slot\_id not in the candidate list (hallucination), 03C drops that `question_links[]` entry and logs drift via `vertex_candidate_slot_hallucination_rate` SLI.

### **5.9.5 Source question population**

The `source_question_canonical_id` and `source_question_row_id` fields come from envelope's `resolved_scope`, not from model output:

function populateQuestionLinksFromModel(  
  modelResponse: ModelOutput,  
  envelope: RequestEnvelope,  
  candidates: CandidateQuestion\[\],  
): QuestionLink\[\] {  
  return (modelResponse.question\_links ?? \[\]).map(link \=\> {  
    const candidate \= candidates.find(c \=\> c.slot\_id \=== link.related\_candidate\_slot\_id);  
    if (\!candidate) {  
      // Model hallucinated a slot\_id; log and drop this link  
      logger.warn('vertex\_candidate\_slot\_hallucination', {  
        returned\_slot\_id: link.related\_candidate\_slot\_id,  
      });  
      return null;  
    }  
    return {  
      source\_question\_row\_id: envelope.resolved\_scope.source\_question\_row\_id,  
      source\_question\_canonical\_id: envelope.resolved\_scope.source\_question\_canonical\_id,  
      related\_question\_row\_id: candidate.question\_row\_id,  
      related\_question\_canonical\_id: candidate.canonical\_id,  
      relationship\_type: link.relationship\_type,  
      difficulty\_delta: candidate.difficulty \- envelope.resolved\_scope.source\_question\_difficulty,  
      reason\_code: link.reason\_code,  
      link\_snapshot: link.link\_snapshot,  
    };  
  }).filter(Boolean);  
}

### **5.9.6 Failure modes and observability**

| Failure | Behavior | User impact |
| ----- | ----- | ----- |
| Candidate pre-selection timeout | Skip candidates; no similar-question offer | User may not receive similar-question suggestion (acceptable degradation) |
| Empty candidate result | Skip candidates | Same |
| Model returns slot\_id not in candidates | Drop link; log `vertex_candidate_slot_hallucination` | User sees no similar-question offer; SLI captures drift |
| Model returns no candidate slot\_id | Continue; no similar-question offer in response | Expected when model judges no similar-question offer is appropriate |

New SLIs (added to §11.2):

* `candidate_preselect_latency_p95` — candidate pre-selection DB query latency (target \<150ms)  
* `candidate_preselect_empty_rate` — percent of triggered pre-selects that return zero candidates (signal for question bank gaps)  
* `vertex_candidate_slot_hallucination_rate` — model drift signal (target \<1%; alert \>5%)  
* `similar_question_offer_rate` — percent of turns that include a similar-question offer (informational; calibrates product metric)

### **5.9.7 V2 target**

Option (c) semantic-search description-matching deferred to V2 per BLK-03C-02 hybrid decision. V2 requires:

* Embedding-based semantic search over question bank (vector DB or pgvector)  
* Model outputs natural-language description (not slot\_id)  
* 03C reranks description → candidate list → single canonical\_id

V2 enables the model to span skill boundaries (e.g., "student struggling with algebra might benefit from a geometry question that uses similar reasoning"). V1's candidate-slot approach is bounded to the pre-filter's section/domain/skill match by design.

---

# **Part VI — Vertex Context Cache Consumption (V1.1 — BLK-03C-01 redesign)**

## **§6.1 Caller role**

The Vertex context cache mapping table (`tutor_vertex_context_cache`) is owned by 03B §12B.5 \+ §27E. 03C is the caller:

* **Read** the mapping table to find existing `CachedContent.name` for the current request's composite cache key  
* **Create** new `CachedContent` on Vertex when no mapping exists for the composite key  
* **Insert** new mapping row after successful Vertex cache creation  
* **NOT** write `invalidated_at` — that's owned by writers of the underlying data (03A-owned MemoryRefreshWorker per 03B §12B.5.1 invalidate-then-delete pattern)

## **§6.2 V1 cache design — per-student composite (BLK-03C-01 closeout)**

V1 cache scope is **one composite CachedContent per student per active teaching\_profile\_version \+ policy\_variant \+ prompt\_version combination**. Canonical question content is NOT cached; it flows as part of message contents.

**What's cached (composite per-student):**

* Policy-variant system instruction text (per `policy_variant + prompt_version`)  
* Teaching profile summary (per `student_id + teaching_profile_version`)

**What's NOT cached (goes in messages):**

* Canonical question content (stem, options)  
* Recent messages (conversation history)  
* Current user turn  
* Student context snapshot (practice/review/KPI)

**Rationale for V1 design:**

* The stable per-student prefix (policy \+ teaching\_profile) is \~800-1200 tokens at steady state  
* A student has multiple turns within a teaching\_profile window (\~14 days); composite cache hit rate is realistic at \~50%  
* Canonical question varies per turn; caching it reduces hit rate materially (two turns rarely share the same question) so V1 doesn't cache it  
* Simpler invalidation: single cache key per student; teaching\_profile refresh invalidates one mapping row

**Cache key shape:**

kind \= 'student\_composite'  
cache\_key \= \`{policy\_variant}:{prompt\_version}:{student\_id}:v{teaching\_profile\_version}\`

Note: V1.1 uses a single `cache_kind = 'student_composite'` instead of V1's three separate kinds. 03B §12B.5 \+ §27E mapping table schema remains unchanged (`cache_kind TEXT` column accepts any enum value); V1.1 adds `student_composite` to the CHECK constraint allowed values.

**V2 target:** evaluate whether Vertex's multi-cache-reference capability supports per-prefix caching with acceptable engineering cost. If yes, migrate to per-kind caching for higher hit rates. If not, stay on composite.

## **§6.3 When composite cache is eligible**

The composite cache is only referenced when **both** of the following are true:

1. A `teaching_profile` summary is present in `envelope.memory_summaries` (i.e., the student has an active teaching profile)  
2. `envelope.policy_assignment.prompt_version` is non-null (i.e., policy is fully versioned)

If either is absent, 03C proceeds with an uncached Vertex call. This covers:

* New students (no teaching profile yet; first \~5 turns before initial profile generation)  
* Experimental policies with unversioned prompts (dev/debug)

Expected first-N-turn bypass: \~5-10% of traffic in steady state (new students \+ cold-start fallback); the remainder benefits from the cache.

## **§6.4 Lookup flow**

async function resolveContextCache(envelope: RequestEnvelope): Promise\<string | null\> {  
  // Eligibility check  
  const teachingProfile \= envelope.memory\_summaries.find(  
    s \=\> s.summary\_type \=== 'teaching\_profile'  
  );  
  const policyVariant \= envelope.policy\_assignment.policy\_variant;  
  const promptVersion \= envelope.policy\_assignment.prompt\_version;

  if (\!teachingProfile || \!promptVersion) {  
    return null; // Proceed uncached  
  }

  const cacheKey \= \`${policyVariant}:${promptVersion}:${envelope.student\_id}:v${teachingProfile.summary\_version}\`;

  // Lookup in mapping table (100ms hard timeout)  
  const row \= await db.queryOne(\`  
    SELECT vertex\_cached\_content\_name  
    FROM tutor\_vertex\_context\_cache  
    WHERE cache\_kind \= 'student\_composite'  
      AND cache\_key \= $1  
      AND invalidated\_at IS NULL  
      AND expires\_at \> now()  
    LIMIT 1  
  \`, \[cacheKey\], { timeout\_ms: 100 });

  return row?.vertex\_cached\_content\_name ?? null;  
}

**Lookup timeout:** 100ms hard ceiling. On timeout, proceed without cache (§1.3 fail-safe).

## **§6.5 Cache creation flow**

When lookup returns null, 03C creates a new composite `CachedContent` and records the mapping:

async function createCompositeCache(  
  envelope: RequestEnvelope,  
  cacheKey: string,  
  compositeContent: string,  // assembled policy \+ teaching\_profile text  
): Promise\<string\> {  
  // Create on Vertex side  
  const cached \= await vertexClient.createCachedContent({  
    model: envelope.selectedModel,  
    systemInstruction: { parts: \[{ text: compositeContent }\] },  
    ttl: 3600,  // 1 hour (aligned with teaching\_profile Vertex TTL per 03B §12B.5)  
  });

  // Record in mapping table (03B-owned schema); upsert for concurrent caller race  
  await db.query(\`  
    INSERT INTO tutor\_vertex\_context\_cache  
      (cache\_kind, cache\_key, student\_id, vertex\_cached\_content\_name, expires\_at)  
    VALUES ('student\_composite', $1, $2, $3, $4)  
    ON CONFLICT (cache\_kind, cache\_key)  
    DO UPDATE SET  
      vertex\_cached\_content\_name \= EXCLUDED.vertex\_cached\_content\_name,  
      expires\_at \= EXCLUDED.expires\_at,  
      invalidated\_at \= NULL  
    WHERE tutor\_vertex\_context\_cache.invalidated\_at IS NOT NULL  
       OR tutor\_vertex\_context\_cache.expires\_at \< now()  
  \`, \[cacheKey, envelope.student\_id, cached.name, cached.expiresAt\]);

  return cached.name;  
}

**Composite content assembly:**

* Load policy\_variant prompt template (per §4.3; loaded at Cloud Run bootstrap)  
* Perform field substitutions from `envelope.policy_assignment` (per §4.4)  
* Append teaching\_profile summary content (from `envelope.memory_summaries`)  
* Concatenate in the order: `[policy_instruction]\n\n[teaching_profile_summary]`

**TTL rationale (NTH-03C-03 closeout):** 1 hour aligns with teaching\_profile's Vertex TTL from 03B §12B.5. Teaching profile refreshes every \~14 days (03A V3 §9.4), so within a refresh window a cache entry is reused many times. Cache naturally turns over when teaching\_profile bumps; 1h provides a safety margin against stale profiles while keeping the hit rate high for a student's active session.

**Concurrent-caller race:** two 03C instances may simultaneously create the same composite cache (e.g., student has two open sessions). `ON CONFLICT` upserts; one caller's Vertex cache becomes orphaned (expires via Vertex TTL). Bounded cost leak.

## **§6.6 Invocation with cache reference**

When Vertex request is assembled (Gemini native Content\[\] format, per AMB-03C-02 locked choice):

const vertexRequest \= {  
  model: selectedModel,  
  contents: \[  
    // Recent messages as native Content\[\] array (per AMB-03C-02)  
    ...envelope.recent\_messages.map(msg \=\> ({  
      role: msg.role \=== 'student' ? 'user' : 'model',  
      parts: \[{ text: msg.message }\],  
    })),  
    // Current turn (last student message from recent\_messages already covers this;  
    // no duplicate append)  
  \],  
  // If composite cache hit: reference it (systemInstruction is provided by cache)  
  cachedContent: compositeCacheName ?? undefined,  
  // If composite cache miss: supply systemInstruction directly  
  systemInstruction: compositeCacheName  
    ? undefined  
    : { parts: \[{ text: assembledCompositeContent }\] },  
  generationConfig: { /\* per §5.7 \*/ },  
  safetySettings: \[ /\* per §5.7 \*/ \],  
};

**Canonical question content placement (V1.2 — tag-prefix convention clarification):** when the envelope is `scoped_question`, the question stem \+ options are injected as a tagged system-note message in the `contents[]` array *before* the recent\_messages sequence.

**Gemini API constraint:** Gemini's `contents[]` array only supports two roles: `user` and `model`. Unlike some other LLM APIs, there is no `system` role usable within `contents[]` — system-level instructions must go in the separate `systemInstruction` field. However, the `systemInstruction` in V1.1's design is reserved for the cache-eligible composite (policy \+ teaching\_profile per §6.2). Turn-specific context like the current question doesn't belong there (it varies per turn and isn't cache-eligible).

**V1.2 convention:** turn-specific system-note content is placed in `contents[]` with `role: 'user'` and wrapped in a tag prefix (e.g., `<question_context>`, `<candidate_questions>`). This is a known workaround for the Gemini API's two-role constraint, not a design flaw. The model is trained to recognize tag-prefixed system notes as instructional context rather than user utterances.

// V1.2 pattern: tagged pseudo-system notes in contents\[\]  
// Rationale: Gemini contents\[\] has no system role; systemInstruction is reserved  
//            for the cache-eligible composite per §6.2. Tag prefix disambiguates.  
const questionContext \= envelope.resolved\_scope.source\_question\_canonical\_id  
  ? \[{  
      role: 'user' as const,  // Gemini API constraint: only 'user' | 'model' allowed here  
      parts: \[{ text: \`\<question\_context\>\\n${questionStem}\\n${optionsText}\\n\</question\_context\>\` }\],  
    }\]  
  : \[\];

const vertexRequest \= {  
  ...  
  contents: \[...questionContext, ...recentMessagesContents\],  
  ...  
};

**Tag vocabulary (V1.2 canonical):**

* `<question_context>...</question_context>` — current question stem \+ options (§6.6)  
* `<candidate_questions>...</candidate_questions>` — similar-question candidates with opaque slot IDs (§5.9.3)  
* `<learning_context>...</learning_context>` — student context snapshot, when relevant  
* `<chat_summary>...</chat_summary>` — chat compaction summary, when relevant

Tags are matched by the model to the instruction in the cached `systemInstruction` that tells it how to interpret each tag type. Prompt authors (03A V3 §11 policy artifacts) must include tag-interpretation instructions in the policy template.

**Why not use the model's own function-calling / tool-response surface instead:** Gemini function-calling exists but is structured for function outputs, not system-note context. Using it for static context would be unnatural and harder for the model to parse. Tag-prefixed pseudo-user messages are the Gemini-idiomatic pattern for turn-scoped context.

The question content is NOT cached (varies per turn). Caching it would reduce hit rate without meaningfully reducing token cost given its \~100-300 token size per 03B V4.1 §12B.5.5.

## **§6.7 Invalidation handling**

03C does not invalidate caches. Invalidation is owned by writers of underlying data:

* `student_composite` invalidated by MemoryRefreshWorker when teaching\_profile is refreshed (per 03B V4.1 §12B.5.1 invalidate-then-delete pattern, executed by 03C's async handler per §VIII.4)  
* `student_composite` also invalidated when `policy_variant` or `prompt_version` bumps (triggered via deploy / config change event)

03C respects `invalidated_at` marker: lookup query filters `WHERE invalidated_at IS NULL`. If a cache is invalidated mid-invocation (rare race), Vertex returns 404; 03C creates fresh cache and retries once (§5.8).

## **§6.8 Failure modes**

| Failure | Behavior | User impact |
| ----- | ----- | ----- |
| Mapping table read fails | Proceed with uncached Vertex call | Higher cost; no user impact |
| Mapping table read times out (\>100ms) | Proceed with uncached Vertex call | Higher cost |
| Vertex `CachedContent` creation fails | Proceed with uncached Vertex call | Higher cost |
| Vertex returns 404 "cache not found" mid-request | Create fresh cache; retry once | Minor latency bump |
| Mapping write fails after Vertex create succeeds | Log; orphaned Vertex cache (expires via Vertex TTL) | None; cost leak bounded by TTL |
| Concurrent creation race | `ON CONFLICT` handles; orphan on Vertex (expires via TTL) | None; cost leak bounded |
| Eligibility fails (no teaching\_profile or no prompt\_version) | Proceed uncached | None; expected for new students |

Never fail the user-facing turn due to context cache issues.

## **§6.9 Observability**

Per §XI:

* `vertex_context_cache_hit_rate` — target \>50% steady state (revised downward from V1's \>70% given composite design; see BLK-03C-01)  
* `vertex_context_cache_creation_latency_p95` — target \<1000ms  
* `vertex_context_cache_miss_on_lookup_rate` — cache miss despite mapping row present (indicates stale mapping; target \<5%)  
* `vertex_context_cache_eligibility_rate` — percent of turns where composite cache is eligible (target \~90%; the remainder is new students without teaching profile)

**Cache hit rate target math:**

* \~90% of turns eligible for composite cache (have teaching\_profile \+ prompt\_version)  
* Among eligible: a student averages \~10 turns per session, \~3 sessions per day; teaching\_profile stable for \~14 days → intra-window hit rate high  
* First turn per session is always a miss (composite cache 1h TTL bounds reuse)  
* Realistic steady-state hit rate: \~50-60%

V1 posture: accept \~50% hit rate; revise target with post-launch actuals.

---

# **Part VII — Response Contract (03C → 03B)**

## **§7.1 Response envelope (03C → 03B)**

03C returns a structured tutor payload to 03B. This envelope maps directly to 03B's persistence steps (§13.5-§13.7) — 03B writes what 03C returns, after anti-leak scan (03B §16).

**Important schema distinction (V2.1 — BLK-V2-02):** the schema below is the **post-Vertex 03C → 03B response envelope**, after 03C has resolved opaque candidate slot IDs to canonical question IDs. This is NOT the same as the Vertex `responseSchema` (§5.5), which uses `related_candidate_slot_id` only. See §7.1.1 for the explicit split.

{  
  "schema\_version": "1.0",  
  "request\_id": "uuid",

  "response": {  
    "content": "string",  
    "content\_kind": "message",  
    "suggested\_action": {  
      "type": "none | offer\_similar\_question | offer\_broader\_coaching | offer\_stay\_focused",  
      "label": "string | null"  
    },  
    "ui\_hints": {  
      "show\_accept\_decline": true,  
      "allow\_freeform\_reply": true,  
      "suggested\_chip": "string | null"  
    }  
  },

  "question\_links": \[  
    {  
      "source\_question\_row\_id": "uuid | null",  
      "source\_question\_canonical\_id": "text",  
      "related\_question\_row\_id": "uuid | null",  
      "related\_question\_canonical\_id": "text",  
      "relationship\_type": "current | similar\_retry | simpler\_variant | harder\_variant | concept\_extension",  
      "difficulty\_delta": "integer | null",  
      "reason\_code": "string",  
      "link\_snapshot": {}  
    }  
  \],

  "instruction\_exposures": \[  
    {  
      "exposure\_type": "hint | explanation | strategy | similar\_question\_offer | broader\_coaching\_offer | consent\_prompt",  
      "content\_variant\_key": "string | null",  
      "content\_version": "string | null",  
      "rendered\_difficulty": "integer | null",  
      "hint\_depth": "integer | null",  
      "tone\_style": "string | null",  
      "sequence\_ordinal": "integer"  
    }  
  \],

  "orchestration\_meta": {  
    "model\_name": "gemini-2.5-flash | gemini-2.5-pro",  
    "cache\_used": false,  
    "compaction\_recommended": false,  
    "fallback\_applied": false,  
    "input\_tokens": 1234,  
    "output\_tokens": 234,  
    "latency\_ms": 3450  
  }  
}

### **7.1.1 Schema split: Vertex output vs 03C → 03B response (V2.1 — BLK-V2-02)**

03C operates two distinct schemas for `question_links[]`. They MUST NOT be conflated.

**Schema A — Vertex `responseSchema` (model output; §5.5):**

The model never sees or produces canonical IDs. Per §4.4 internal-only rule \+ §5.9 candidate-slots flow:

type VertexQuestionLinkOutput \= {  
  related\_candidate\_slot\_id: string | null;  // opaque slot from candidate list  
  relationship\_type: 'current' | 'similar\_retry' | 'simpler\_variant' | 'harder\_variant' | 'concept\_extension';  
  reason\_code: string;  
  link\_snapshot: object;  
  // No source\_question\_canonical\_id (filled by 03C from envelope)  
  // No related\_question\_canonical\_id (resolved by 03C from candidate slot map)  
  // No related\_question\_row\_id (resolved by 03C)  
  // No difficulty\_delta (computed by 03C from candidate metadata)  
};

**Schema B — 03C → 03B response envelope (post-resolution; §7.1):**

After Vertex returns, 03C populates the full envelope using:

1. `source_question_*` fields from `envelope.resolved_scope` (always known)  
2. `related_question_*` fields by resolving `related_candidate_slot_id` against the candidate list 03C pre-selected in §5.9.2  
3. `difficulty_delta` computed as `candidate.difficulty - source_question.difficulty`

type ResponseQuestionLink \= {  
  source\_question\_row\_id: string | null;          // from envelope  
  source\_question\_canonical\_id: string;            // from envelope  
  related\_question\_row\_id: string | null;          // resolved from slot  
  related\_question\_canonical\_id: string;           // resolved from slot  
  relationship\_type: VertexQuestionLinkOutput\['relationship\_type'\];  
  difficulty\_delta: number | null;                 // computed  
  reason\_code: string;                             // from Vertex  
  link\_snapshot: object;                            // from Vertex  
};

**Resolution function (per §5.9.5):**

function resolveQuestionLinks(  
  vertexLinks: VertexQuestionLinkOutput\[\],  
  envelope: RequestEnvelope,  
  candidates: CandidateQuestion\[\],  
): ResponseQuestionLink\[\] {  
  return vertexLinks.flatMap(link \=\> {  
    const candidate \= candidates.find(c \=\> c.slot\_id \=== link.related\_candidate\_slot\_id);  
    if (\!candidate) {  
      // Hallucinated slot\_id — drop the link, log SLI  
      logger.warn('vertex\_candidate\_slot\_hallucination', {  
        returned\_slot\_id: link.related\_candidate\_slot\_id,  
      });  
      metrics.increment('vertex\_candidate\_slot\_hallucination\_rate');  
      return \[\];  
    }  
    return \[{  
      source\_question\_row\_id: envelope.resolved\_scope.source\_question\_row\_id,  
      source\_question\_canonical\_id: envelope.resolved\_scope.source\_question\_canonical\_id\!,  
      related\_question\_row\_id: candidate.question\_row\_id,  
      related\_question\_canonical\_id: candidate.canonical\_id,  
      relationship\_type: link.relationship\_type,  
      difficulty\_delta: candidate.difficulty \- envelope.resolved\_scope.source\_question\_difficulty\!,  
      reason\_code: link.reason\_code,  
      link\_snapshot: link.link\_snapshot,  
    }\];  
  });  
}

**Why this separation matters:**

* Anti-leak: model never sees canonical IDs, satisfying §4.4  
* Determinism: 03C's resolution is purely a lookup — no model inference, no hallucination risk in the resolution step  
* Validation: 03C can validate `related_candidate_slot_id` against its known candidate list before resolving; hallucinated slots are detected (not silently passed through as garbage canonical IDs)  
* Testability: Vertex output schema is small and fixture-able; 03C → 03B response schema is the union with envelope-derived fields

If a future consumer (e.g., a debug API exposing Vertex's raw output) needs to surface the slot IDs, that's a separate concern from the canonical 03C → 03B contract.

## **§7.2 Response field rules**

**`response.content`:**

* Plain text or Markdown; client renderer per 03B §12 UI contract handles formatting  
* Max 4000 chars (per Vertex schema in §5.5)  
* Must not contain canonical question IDs (03C strips if present per §4.4)

**`suggested_action`:**

* Bounded enum value per §5.4 strict schema  
* When `type == "none"`, `label` may be null  
* When `type != "none"`, `label` must be a natural-language prompt (e.g., "Want to try a simpler version?")

**`ui_hints`:**

* Optional fields; 03B passes through to client verbatim  
* `show_accept_decline` and `allow_freeform_reply` default to true  
* `suggested_chip` is a short chip label (e.g., "Try similar") for UI controls

**`question_links`:**

* Written directly to `tutor_question_links` by 03B §13 persistence  
* Empty array if no question links generated  
* Must include `source_question_canonical_id` for every link (03C enforces)

**`instruction_exposures`:**

* Written directly to `tutor_instruction_exposures` by 03B §13 persistence  
* Empty array if no exposures rendered  
* `sequence_ordinal` monotonic within the response (1, 2, 3…)

**`orchestration_meta`:**

* Advisory; used for observability and downstream logic  
* `cache_used`: true if any Vertex `CachedContent` was referenced  
* `compaction_recommended`: true if 03C detects conversation has reached compaction threshold (§VIII.3); 03B decides whether to enqueue compaction job  
* `input_tokens`, `output_tokens`, `latency_ms`: observability only; also returned in response headers for log correlation

## **§7.3 Error response envelope (V1.1 — SWE-03C-01 mapping to 03B)**

On failure, 03C returns structured error:

{  
  "schema\_version": "1.0",  
  "request\_id": "uuid",  
  "error": {  
    "code": "string",  
    "message": "string",  
    "retryable": true,  
    "details": {}  
  }  
}

**Canonical error codes 03C emits (with 03B handling column):**

| Code | HTTP | Retryable | Meaning | 03B handling (per 03B V4.1 §28.7 / §28A.2 / §18) |
| ----- | ----- | ----- | ----- | ----- |
| `invalid_envelope` | 400 | false | Request envelope failed schema validation | Treat as internal bug; 500 `internal_error` to client; alert page |
| `envelope_bounds_exceeded` | 400 | false | `max_output_tokens` or `timeout_ms` exceeds service max | Treat as internal bug; 500 to client; alert page |
| `auth_failed` | 401 | false | HMAC signature invalid or expired | Treat as auth incident; 500 to client; emergency revoke path per 01A §66 if sustained |
| `prompt_too_large` | 400 | false | Assembled prompt exceeded `prompt_max_tokens` | Treat as envelope bug; 500 to client; alert warn |
| `vertex_timeout` | 504 | true | Vertex call exceeded `runtime_limits.timeout_ms` | Map to `orchestration_failed_recoverable`; 503 to client with `retry_after_ms: 2000`; client retries turn |
| `vertex_5xx_retriable` | 503 | true | Vertex returned transient error after retry | Same as `vertex_timeout` handling |
| `vertex_quota_exhausted` | 429 | true | Vertex project quota hit | Map to `service_degraded`; 503 to client with `retry_after_ms: 5000`; page at \>1% rate |
| `vertex_safety_blocked` | 422 | false | Vertex safety filter blocked response | Map to `safety_block`; substitute safe hint per 03B §16; turn succeeds with alternative content |
| `structured_output_violation` | 502 | false | Model response failed strict schema on safety-critical fields | Map to `orchestration_failed_recoverable`; 503 to client (user retries); alert warn if \>1% |
| `pii_in_envelope` (V2.1) | 400 | false | PII guard (§4.2.2) detected blocking pattern in assembled prompt before Vertex call | Map to `internal_error`; 500 to client; **PAGE immediately** as privacy-incident-adjacent (envelope-builder bug producing PII in prompt) |
| `internal_error` | 500 | false | Unexpected 03C failure | Map to `orchestration_internal_error`; 500 to client; alert page |

**Pro→Flash fallback note:** if §5.3.2 fallback is applied successfully, 03C returns a **successful response** (not an error) with `orchestration_meta.fallback_applied = true`. The error codes above only apply when even the fallback fails or when a non-fallback-eligible error occurs on Pro.

## **§7.4 Streaming mode (V1.1 — AMB-03C-04 SSE wire format spec)**

Per Q5=b, streaming is additive. When `envelope.streaming.enabled == true`, 03C returns an SSE stream instead of a JSON response body.

### **7.4.1 HTTP response contract**

* **Content-Type:** `text/event-stream; charset=utf-8`  
* **Cache-Control:** `no-cache`  
* **Connection:** `keep-alive`  
* **Transfer-Encoding:** `chunked`

### **7.4.2 Event format**

Standard SSE per [W3C EventSource spec](https://html.spec.whatwg.org/multipage/server-sent-events.html). Each event has:

* `event: <type>` line (event type name)  
* `data: <json>` line (single-line JSON payload)  
* Blank line terminator

Example:

event: content\_delta  
data: {"delta": "Let me explain this step by step. ", "sequence\_ordinal": 1}

event: content\_delta  
data: {"delta": "First, look at the quadratic formula.", "sequence\_ordinal": 2}

event: suggested\_action\_set  
data: {"type": "offer\_similar\_question", "label": "Try a similar one?"}

event: question\_link  
data: {"relationship\_type": "similar\_retry", "related\_candidate\_slot\_id": "slot\_2", "reason\_code": "sticky\_question"}

event: instruction\_exposure  
data: {"exposure\_type": "explanation", "sequence\_ordinal": 1}

event: orchestration\_meta  
data: {"model\_name": "gemini-2.5-pro", "cache\_used": true, "compaction\_recommended": false, "input\_tokens": 1234, "output\_tokens": 345, "latency\_ms": 3200}

event: done  
data: {}

### **7.4.3 Event types and payloads**

| Event | Fires | Payload shape |
| ----- | ----- | ----- |
| `content_delta` | Per text chunk as model generates | `{ delta: string, sequence_ordinal: integer }` |
| `suggested_action_set` | Once, when model finalizes suggested\_action | \`{ type: string, label: string |
| `ui_hints_set` | Once, when model finalizes ui\_hints | \`{ show\_accept\_decline: bool, allow\_freeform\_reply: bool, suggested\_chip: string |
| `question_link` | Per link as generated (0 or more total) | \`{ relationship\_type: string, related\_candidate\_slot\_id: string |
| `instruction_exposure` | Per exposure as rendered (1 or more total) | `{ exposure_type: string, sequence_ordinal: integer, content_variant_key?: string, content_version?: string, rendered_difficulty?: integer, hint_depth?: integer, tone_style?: string }` |
| `orchestration_meta` | Once, at stream end before `done` | `{ model_name: string, cache_used: bool, compaction_recommended: bool, fallback_applied?: bool, input_tokens: integer, output_tokens: integer, latency_ms: integer }` |
| `error` | Fires if streaming fails mid-flight | `{ code: string, message: string, retryable: bool }` |
| `done` | Terminal event; signals clean stream completion | `{}` (empty) |

### **7.4.4 Event ordering guarantees**

* `content_delta` events are emitted in order with monotonically increasing `sequence_ordinal`  
* `suggested_action_set`, `ui_hints_set`, `orchestration_meta` each fire at most once per stream  
* `question_link` and `instruction_exposure` fire zero or more times, each with their own `sequence_ordinal` for ordering  
* `done` is ALWAYS the final event on successful completion  
* `error` can fire at any time; after `error`, connection closes and no further events are sent

### **7.4.5 Canonical ID resolution in streaming**

`question_link` events in the stream carry `related_candidate_slot_id` (opaque slot ID per §5.9), NOT `related_question_canonical_id`. 03B receives the stream and resolves slot\_ids to canonical\_ids post-stream (or during stream for pass-through-to-client). This maintains the §4.4 "no canonical IDs to model" rule in streaming mode.

### **7.4.6 Failure mode in streaming**

If Vertex stream fails mid-generation (connection reset, 5xx, safety filter trip mid-stream):

1. 03C emits `error` event with appropriate code  
2. 03C closes the connection  
3. 03B treats as `vertex_5xx_retriable` (or the specific error) and returns 503 to client  
4. Client retries the whole turn (no partial-response recovery since nothing was persisted)

Partial content already sent to client before the error is discarded by client; client-side UX typically shows a "tutor response interrupted, retrying" state.

### **7.4.7 V1 posture**

Streaming is supported by 03C but 03B opts out by default (`streaming.enabled: false`). Reasons V1 defaults to sync:

* Simpler 03B → client response handling  
* Easier debugging during launch  
* No client-side UX for incremental rendering yet

Streaming becomes default opt-in as client UX matures. V2 target.

### **7.4.8 No state mutation during streaming**

03C does not write to any database during streaming. All state mutation happens in 03B's handler after the stream completes (for sync mode this is also true; streaming just means 03B receives the data incrementally rather than all at once).

## **§7.5 Response persistence contract**

Per 03B V4.1 §13, the response shapes (`question_links[]`, `instruction_exposures[]`) translate **directly** into writes:

* `response.content` → `tutor_messages.message` (via 03B step 5\)  
* `question_links[]` → `tutor_question_links` rows (via 03B step 6, after anti-leak scan)  
* `instruction_exposures[]` → `tutor_instruction_exposures` rows (via 03B step 7\)  
* `suggested_action` \+ `ui_hints` → `tutor_messages.content_json` (via 03B step 5, as structured metadata)

03C must NOT invent fields not documented here. 03B's persistence layer is strict; unknown fields in response trigger logging but not persistence.

---

# **Part VIII — Async Jobs (Cloud Tasks) (V1.1 — BLK-03C-03 ownership split)**

## **§8.0 Ownership split (V1.1 — BLK-03C-03 closeout)**

**Job logic** (what each job computes, what tables it writes, what triggers it) is owned by 03A V3 §9 (MemoryRefreshWorker) and 03A V3 §14 (compaction).

**GCP runtime** (Cloud Tasks queues, Cloud Run handler service, retry policy, observability, writeback IAM scope) is owned by this document (03C).

**Concretely:**

* 03A V3 §9.3 specifies when MemoryRefreshWorker runs, what input data it reads, what summary it produces, and what it writes to `tutor_memory_summaries`  
* 03C §VIII.2-§VIII.5 specifies how that job is enqueued, retried, rate-limited, and what Cloud Run service executes it

**Change review coordination (§15.4):**

* Changes to §VIII.1 (scope), §VIII.2 (queue topology), §VIII.5 (handler service), §VIII.7 (observability): 03C-owned; LISA team review not required  
* Changes to §VIII.3 (compaction trigger logic), §VIII.4 (memory refresh handler logic): jointly reviewed by 03C owner AND 03A V3 owner (LISA team); must align with 03A V3 §9 \+ §14 specifications  
* Conflicts between 03C and 03A V3 on job logic are resolved in favor of 03A V3; 03C carries a reference, not a duplicate specification

**Service account naming (V1.1):**

* V1 used `lisa-async-worker@` (implied 03C ownership of the whole job)  
* V1.1 renames to `lisa-memory-worker@` (reflects that the worker executes 03A-owned logic for memory and compaction jobs)  
* Updates propagate to §2.4, §8.5, §8.6, §9.3, §12.3

## **§8.1 Scope (V2.0 — placeholder-then-fill reconciliation added)**

V2.0 Cloud Tasks scope covers three job types:

1. **Conversation-close compaction** — algorithm owned by 03A V3 §14; triggered when a conversation reaches 20+ turns OR is closed OR a needed summary is stale  
2. **MemoryRefreshWorker** — algorithm owned by 03A V3 §9; periodic or triggered refresh of `tutor_memory_summaries`; **V2.0 uses placeholder-then-fill pattern (§8.4)**  
3. **PendingReconciliationWorker (V2.0 new)** — sweeps orphaned `tutor_memory_summaries` rows in `status = 'pending'` state that have exceeded the pending-window timeout; marks them `failed` and re-enqueues fresh refresh tasks

**Out of scope for V2.0:**

* Vertex context cache cleanup (handled by pg\_cron per 03B §27E)  
* Export prep hooks (no V1 product feature)  
* Broader background processing (not required by any V1 spec)

**V3 scope:** pg\_cron migration to Cloud Tasks if scale demands. Export prep if a data-export product feature is added.

## **§8.2 Queue topology (V2.0 — pending-reconciliation added)**

V2.0: three queues for three job types.

| Queue | Purpose | Target Cloud Run handler | Rate limit |
| ----- | ----- | ----- | ----- |
| `lisa-compaction` | Conversation-close compaction jobs | `/async/compaction` | 100 req/s |
| `lisa-memory-refresh` | MemoryRefreshWorker scheduled jobs | `/async/memory-refresh` | 50 req/s |
| `lisa-pending-reconciliation` (V2.0) | Orphaned-pending-row reconciliation | `/async/pending-reconciliation` | 20 req/s |

All three queues target the same Cloud Run async handler service (`lisa-memory-worker`).

**Rate limit rationale:**

* `lisa-compaction` at 100 req/s:  
  * Expected steady-state load: \~10k active students × \~5 conversations/day \= \~50k compactions/day \= \~0.6/s average  
  * Peak hour bursts: \~3-5/s  
  * 100/s cap provides \~30× headroom against sustained peak, \~200× against average  
  * Protects downstream Vertex Flash quota during bulk compaction events (e.g., policy version bump triggering mass re-compaction)  
* `lisa-memory-refresh` at 50 req/s:  
  * Steady-state: \~10k students × 1 refresh per 14 days \= \~715/day \= \~0.01/s  
  * 50/s cap is 5000× steady-state headroom  
  * Constraint: bulk-refresh (e.g., policy bump triggering 10k refreshes) takes \~200 seconds to enqueue — acceptable for nightly backfill, slower than ideal for emergency refresh  
  * **Tuning note:** for emergency bulk refresh scenarios, rate limit can be temporarily raised via Cloud Tasks queue update (operational runbook); V3 may default to 200 req/s if bulk-refresh is a common operational need  
* `lisa-pending-reconciliation` at 20 req/s (V2.0):  
  * Steady-state: orphaned-pending events should be rare (Cloud Tasks retries handle most transient failures)  
  * Expected rate: \<0.1/s under normal operation  
  * 20/s cap accommodates burst recovery after multi-instance crash event that orphans many pending rows simultaneously  
  * Per-task work is light (status update \+ re-enqueue); high concurrency is safe

**Retry policy per queue:**

* Max retries: 5  
* Min backoff: 5s  
* Max backoff: 300s  
* Deadline per task: 15 minutes (generous; summary jobs can take several minutes)

**Pending-reconciliation queue retry policy:**

* Max retries: 3 (lower than other queues — reconciliation work is light; chronic failure indicates deeper issue)  
* Min backoff: 30s  
* Max backoff: 600s  
* Deadline per task: 5 minutes

**Dead letter behavior:** after max retries, task is marked permanently failed. Cloud Tasks emits to Cloud Logging; 03C monitors via `cloud_tasks_dead_letter_rate` SLI. Pending-reconciliation dead-letter is a SEV-2 alert (means orphaned rows are accumulating without successful cleanup).

## **§8.3 Conversation-close compaction job**

**Algorithm owner:** 03A V3 §14 (what compaction produces; what inputs it consumes; what gets written). **GCP runtime owner:** 03C (this section).

**Trigger:** per 03A V3 §14.3 — when conversation reaches 20+ turns OR is closed OR a needed summary is stale.

**Enqueue location (03C-owned):**

* 03B enqueues on conversation-close endpoint call (03B V4.1 §13.6 close flow)  
* 03C enqueues opportunistically when response envelope flags `compaction_recommended == true` (per §7.1 orchestration\_meta)  
* pg\_cron enqueues on nightly stale-summary sweep (SQL-level scheduled task)

**Task payload:**

{  
  "job\_type": "compaction",  
  "conversation\_id": "uuid",  
  "student\_id": "uuid",  
  "trigger\_reason": "close | threshold | stale",  
  "request\_id": "uuid"  
}

**Handler runtime (03C-owned):**

* Cloud Run handler at `/async/compaction`  
* Timeout: 10 minutes per task  
* Idempotency: duplicate `(conversation_id, trigger_reason)` produces same summary (overwrite previous); no harm from duplicate execution  
* Retry per §8.2 queue policy  
* Observability per §8.7

**Handler logic (03A V3 §14-owned; 03C executes):**

Per 03A V3 §14 specification. Summary here is a reference, not a duplicate specification:

1. Load conversation's `tutor_messages` from Supabase (03A V3 §14.2 specifies the query)  
2. Invoke Vertex (with Flash model per 03A V3 §14.5 model choice) to produce compact summary  
3. Write summary to `tutor_memory_summaries` with `summary_type == "chat_compaction"` per 03A V3 §7 schema  
4. Emit NOTIFY for dependent Vertex caches per 03B V4.1 §12B.5.1 invalidate-then-delete pattern

For exact algorithm, input data assembly, and Vertex prompt template, see 03A V3 §14.

## **§8.4 MemoryRefreshWorker job (V2.0 — placeholder-then-fill pattern)**

**Algorithm owner:** 03A V3 §9 (what teaching\_profile refresh produces; what inputs it reads; what gets written). **GCP runtime owner:** 03C (this section).

**V2.0 pattern decision:** placeholder-then-fill (Option A). New `tutor_memory_summaries.status` column with enum `pending | ready | failed`. Refresh handler executes two transactions: T1 marks invalidation \+ inserts pending row; T2 fills content \+ transitions to ready. Cross-doc dependencies: 03A V3.1 §9.6 must adopt this pattern; 03B V5 envelope-builder must filter `status = 'ready'`; 03B V5 owns the schema migration (§31.2).

**Trigger:** per 03A V3 §9.4 — nightly scheduled at \~14-day cadence per student, OR event-triggered on data-staleness detection per 03A V3 §9.3.

**Enqueue location (03C-owned):**

* Nightly Cloud Scheduler → Cloud Tasks for bulk teaching\_profile refresh  
* Event-triggered from 03A V3 §9.3 (data-staleness detection)

**Task payload:**

{  
  "job\_type": "memory\_refresh",  
  "student\_id": "uuid",  
  "summary\_type": "teaching\_profile | recent\_learning\_pattern | study\_context",  
  "trigger\_reason": "scheduled | data\_event | reconciliation\_retry",  
  "request\_id": "uuid",  
  "previous\_attempt\_summary\_version": "integer | null"  
}

The `previous_attempt_summary_version` field is populated when this task is a reconciliation retry (per §8.5 reconciliation handler). Allows handler to detect duplicate work.

**Handler runtime (03C-owned):**

* Cloud Run handler at `/async/memory-refresh`  
* Timeout: 5 minutes per student  
* Concurrency control: per-student advisory lock (`pg_try_advisory_lock` on hashed `student_id` — session-scoped, NOT transaction-scoped, see §8.4.2); spans BOTH transactions plus generation phase  
* Retry per §8.2 queue policy  
* Observability per §8.8

### **8.4.1 Two-transaction handler logic**

**Transaction T1 — Invalidate \+ Pending Insert (fast; \<100ms target):**

async function refreshHandler\_T1(payload: RefreshTaskPayload): Promise\<{newVersion: number}\> {  
  return await db.transaction({ isolation: 'READ COMMITTED' }, async (tx) \=\> {  
    // Acquire per-student advisory lock (session-scoped; spans T1 and T2)  
    const lockAcquired \= await tx.query(\`  
      SELECT pg\_try\_advisory\_lock(hashtext('memory\_refresh:' || $1)::int)  
    \`, \[payload.student\_id\]);

    if (\!lockAcquired.rows\[0\]?.pg\_try\_advisory\_lock) {  
      throw new ConcurrentRefreshError(payload.student\_id);  
    }

    // Compute new version (max \+ 1 for this summary\_type)  
    const versionResult \= await tx.query(\`  
      SELECT COALESCE(MAX(summary\_version), 0\) \+ 1 AS new\_version  
      FROM tutor\_memory\_summaries  
      WHERE student\_id \= $1 AND summary\_type \= $2  
    \`, \[payload.student\_id, payload.summary\_type\]);  
    const newVersion \= versionResult.rows\[0\].new\_version;

    // Invalidate dependent Vertex context cache mappings (per 03B V4.1 §12B.5.1)  
    await tx.query(\`  
      UPDATE tutor\_vertex\_context\_cache  
        SET invalidated\_at \= now()  
      WHERE cache\_kind \= 'student\_composite'  
        AND cache\_key LIKE '%:' || $1 || ':%'  
        AND invalidated\_at IS NULL  
    \`, \[payload.student\_id\]);

    // Insert pending row  
    await tx.query(\`  
      INSERT INTO tutor\_memory\_summaries  
        (student\_id, summary\_type, summary\_version, content\_json,  
         source\_window\_start, source\_window\_end, status, created\_at)  
      VALUES ($1, $2, $3, '{}'::jsonb, $4, now(), 'pending', now())  
    \`, \[  
      payload.student\_id,  
      payload.summary\_type,  
      newVersion,  
      computeSourceWindowStart(payload),  
    \]);

    // Emit NOTIFY for cache propagation (per 03B V4.1 §12B.5.1 step 3\)  
    await tx.query(\`SELECT pg\_notify('teaching\_profile\_updated', $1)\`, \[  
      JSON.stringify({ student\_id: payload.student\_id, summary\_version: newVersion }),  
    \]);

    return { newVersion };  
  });  
}

**Out-of-transaction Vertex generation (5-60s typical; 4min hard timeout):**

async function refreshHandler\_Generation(  
  payload: RefreshTaskPayload,  
  newVersion: number,  
): Promise\<{ contentJson: object }\> {  
  // Load source data (read-only, RLS-scoped per §8.7)  
  // Source data per 03A V3 §9.2 specification:  
  //   \- student practice attempt history (last 30 days)  
  //   \- student review session history  
  //   \- student full-length exam history (most recent)  
  //   \- current KPI state per 03A V3 §6  
  //   \- current mastery state per 02C  
  const sourceData \= await loadRefreshSourceData(payload.student\_id, payload.summary\_type);

  // Invoke Vertex Flash for summary generation (model choice per 03A V3 §9.5)  
  // Timeout: 4 minutes (leaves \~1 minute for T2 \+ observability before handler timeout)  
  const summaryResult \= await invokeVertexForSummary({  
    model: 'gemini-2.5-flash',  
    sourceData,  
    summaryType: payload.summary\_type,  
    timeoutMs: 240000,  
  });

  return { contentJson: summaryResult.content };  
}

**Transaction T2 — Fill \+ Ready transition (fast; \<100ms target):**

async function refreshHandler\_T2(  
  payload: RefreshTaskPayload,  
  newVersion: number,  
  contentJson: object,  
): Promise\<void\> {  
  await db.transaction({ isolation: 'READ COMMITTED' }, async (tx) \=\> {  
    const updateResult \= await tx.query(\`  
      UPDATE tutor\_memory\_summaries  
        SET content\_json \= $1::jsonb,  
            status \= 'ready',  
            ready\_at \= now()  
      WHERE student\_id \= $2  
        AND summary\_type \= $3  
        AND summary\_version \= $4  
        AND status \= 'pending'  
      RETURNING id  
    \`, \[contentJson, payload.student\_id, payload.summary\_type, newVersion\]);

    if (updateResult.rowCount \=== 0\) {  
      // Pending row was reconciled (marked 'failed') by §8.5 reconciliation worker  
      // OR superseded by a newer version (would indicate advisory lock failure)  
      logger.warn('memory\_refresh.t2\_no\_pending\_row', {  
        student\_id: payload.student\_id,  
        summary\_type: payload.summary\_type,  
        summary\_version: newVersion,  
        request\_id: payload.request\_id,  
      });  
      metrics.increment('memory\_refresh\_t2\_no\_pending\_row\_total');  
      return;  
    }

    // T2 success; emit NOTIFY for ready signal  
    await tx.query(\`SELECT pg\_notify('teaching\_profile\_ready', $1)\`, \[  
      JSON.stringify({ student\_id: payload.student\_id, summary\_version: newVersion }),  
    \]);  
  });

  // Best-effort post-T2 cleanup of orphaned Vertex CachedContent  
  await deleteVertexCachedContentBestEffort(payload.student\_id, newVersion);  
}

**Top-level handler orchestration:**

async function memoryRefreshHandler(payload: RefreshTaskPayload): Promise\<void\> {  
  const startTime \= Date.now();  
  let newVersion: number | null \= null;  
  let lockHeld \= false;

  try {  
    // T1: invalidate \+ pending insert (also acquires advisory lock)  
    const t1Result \= await refreshHandler\_T1(payload);  
    newVersion \= t1Result.newVersion;  
    lockHeld \= true;  
    metrics.observe('memory\_refresh\_t1\_latency\_ms', Date.now() \- startTime);

    // Generation (out-of-transaction; lock still held at session level)  
    const genStart \= Date.now();  
    const generation \= await refreshHandler\_Generation(payload, newVersion);  
    metrics.observe('memory\_refresh\_generation\_latency\_ms', Date.now() \- genStart);

    // T2: fill \+ ready  
    const t2Start \= Date.now();  
    await refreshHandler\_T2(payload, newVersion, generation.contentJson);  
    metrics.observe('memory\_refresh\_t2\_latency\_ms', Date.now() \- t2Start);

    metrics.increment('memory\_refresh\_success\_total');  
  } catch (err) {  
    metrics.increment('memory\_refresh\_failure\_total', {  
      phase: identifyPhase(err),  
      error\_class: classifyError(err),  
    });

    if (err instanceof ConcurrentRefreshError) {  
      // Per-student lock contention; let Cloud Tasks retry with backoff  
      throw err;  
    }

    if (err instanceof VertexGenerationError && newVersion \!== null) {  
      // T1 succeeded; generation failed  
      // Pending row exists; will be reconciled by §8.5 reconciliation worker  
      logger.error('memory\_refresh.generation\_failed\_pending\_orphaned', {  
        student\_id: payload.student\_id,  
        summary\_type: payload.summary\_type,  
        summary\_version: newVersion,  
        error: err.message,  
      });  
    }

    throw err; // Propagate for Cloud Tasks retry  
  } finally {  
    if (lockHeld) {  
      // Always release advisory lock  
      await db.query(  
        \`SELECT pg\_advisory\_unlock(hashtext('memory\_refresh:' || $1)::int)\`,  
        \[payload.student\_id\],  
      ).catch(err \=\> logger.warn('advisory\_unlock\_failed', { err: err.message }));  
    }  
  }  
}

### **8.4.2 Concurrency note**

**Advisory lock scope:** the per-student advisory lock acquired in T1 spans both transactions plus the out-of-transaction generation phase. PostgreSQL `pg_try_advisory_lock` (without `_xact` suffix) holds the lock at the session level — released when the connection is closed or `pg_advisory_unlock` is called explicitly.

**Why session-scoped, not transaction-scoped:** `pg_try_advisory_xact_lock` would release on T1 commit, allowing a concurrent worker to start T1' for the same student before this worker's T2 completes. That would create a race: worker A's T2 might run after worker B's T1, marking worker B's pending row as ready with worker A's content. The session-scoped lock prevents this by holding across both transactions.

**Lock release:** the handler's top-level `try/finally` ensures `pg_advisory_unlock` is called whether the handler succeeds or fails. If the worker process crashes mid-handler, the connection drops, and PostgreSQL releases the lock automatically.

**Stuck-lock recovery:** if a worker holds the lock indefinitely due to a hung Vertex call, the handler timeout (5 min) kills the connection, releasing the lock. Reconciliation worker (§8.5) then handles the orphaned pending row.

### **8.4.3 Reader behavior during pending window**

When 03B V5 envelope-builder loads `tutor_memory_summaries`, it MUST filter `status = 'ready'`. During the pending window (between T1 commit and T2 commit), the new `summary_version` row exists with `status = 'pending'` and empty `content_json`. The previous `summary_version` row remains with `status = 'ready'` and authoritative content.

**03B V5 envelope-builder query (cross-coordination required):**

SELECT \*  
FROM tutor\_memory\_summaries  
WHERE student\_id \= $1  
  AND summary\_type \= $2  
  AND status \= 'ready'  
ORDER BY summary\_version DESC  
LIMIT 1

This is a **cross-doc dependency** for 03B V5. V2.0 flags it explicitly in §31.3 cross-doc coordination requirements.

**Implication for cache:** during the pending window, Vertex composite cache is invalidated (T1 marked it). 03C envelope-builder cache lookup will miss; turns proceed uncached. This is the cost of the placeholder-then-fill pattern — accepted per Option A trade-off analysis.

### **8.4.4 Failure modes and recovery**

| Failure | Phase | Recovery |
| ----- | ----- | ----- |
| Advisory lock contention | Pre-T1 | Cloud Tasks retry with backoff; another worker is processing same student |
| T1 transaction fails (DB outage) | T1 | Cloud Tasks retry; no orphaned state |
| Vertex generation fails (timeout, 5xx) | Generation | Pending row exists; §8.5 reconciliation worker cleans up after 10min |
| Vertex generation fails (4xx, schema violation) | Generation | Same as above; flag as `vertex_generation_classification_violation` for alerting |
| T2 transaction fails (DB outage) | T2 | Cloud Tasks retry will attempt full handler again. Advisory lock released by connection drop. New T1 acquires lock; finds previous version's pending row still pending; T2 logic finds rowCount==0 (pending exists at different version), exits clean. Reconciliation worker handles orphaned previous-attempt pending row |
| T2 finds no pending row (rowCount \== 0\) | T2 | Reconciled by §8.5 worker; log warning; exit clean |
| Worker process crashes between T1 and T2 | Mid-handler | Connection drops; advisory lock released. Pending row persists. Reconciliation worker (§8.5) handles after pending-window timeout |
| Network partition between Cloud Run and Cloud SQL during T2 | T2 | Same as crash; reconciliation handles |

For exact algorithm, data-source queries, and Vertex prompt template, see 03A V3 §9 (with V2.0's placeholder-then-fill pattern adopted by 03A V3.1).

## **§8.5 PendingReconciliationWorker job (V2.0 new)**

**Purpose:** sweep orphaned `tutor_memory_summaries` rows in `status = 'pending'` state that have exceeded the pending-window timeout. Marks them `failed` and re-enqueues fresh refresh tasks.

**Algorithm owner:** 03C V2.0 (new). 03A V3.1 should reference 03C V2.0 §8.5 as the canonical reconciliation contract.

### **8.5.1 Trigger**

Two trigger paths:

* **Periodic sweep (primary):** Cloud Scheduler → Cloud Tasks every 5 minutes. Scans for eligible pending rows; enqueues per-row reconciliation tasks.  
* **Event-triggered (rare):** invoked from 03B observability pipeline if `memory_refresh_orphaned_pending_count` SLI exceeds threshold.

### **8.5.2 Sweep query**

The periodic sweep enqueues one reconciliation task per orphaned pending row:

SELECT id, student\_id, summary\_type, summary\_version, created\_at  
FROM tutor\_memory\_summaries  
WHERE status \= 'pending'  
  AND created\_at \< now() \- INTERVAL '10 minutes'  
ORDER BY created\_at ASC  
LIMIT 1000  
FOR UPDATE SKIP LOCKED

`FOR UPDATE SKIP LOCKED` ensures concurrent sweep instances don't double-enqueue. Limit 1000 bounds work per sweep cycle; sweep runs every 5 minutes so even 12k orphans/hour drain.

**Pending-window timeout:** 10 minutes (configurable via `memory_refresh.pending_timeout_minutes`). Rationale: Vertex Flash teaching\_profile generation typically completes in \<30 seconds; 10 minutes is 20× headroom against tail latency. Tail beyond 10 minutes indicates real failure (worker crash, network partition).

### **8.5.3 Reconciliation handler logic**

async function pendingReconciliationHandler(  
  payload: ReconciliationTaskPayload,  
): Promise\<void\> {  
  await db.transaction({ isolation: 'READ COMMITTED' }, async (tx) \=\> {  
    // Re-verify the row is still pending and still old enough  
    const row \= await tx.query(\`  
      SELECT id, student\_id, summary\_type, summary\_version, created\_at, status  
      FROM tutor\_memory\_summaries  
      WHERE id \= $1  
        AND status \= 'pending'  
        AND created\_at \< now() \- INTERVAL '10 minutes'  
      FOR UPDATE  
    \`, \[payload.row\_id\]);

    if (row.rowCount \=== 0\) {  
      logger.info('reconciliation.row\_not\_eligible', { row\_id: payload.row\_id });  
      return;  
    }

    // Mark as failed  
    await tx.query(\`  
      UPDATE tutor\_memory\_summaries  
        SET status \= 'failed',  
            ready\_at \= now()  
      WHERE id \= $1  
    \`, \[payload.row\_id\]);

    metrics.increment('memory\_refresh\_reconciled\_failed\_total', {  
      summary\_type: row.rows\[0\].summary\_type,  
    });  
  });

  // Outside transaction: enqueue fresh refresh task  
  await enqueueRefreshTask({  
    job\_type: 'memory\_refresh',  
    student\_id: payload.student\_id,  
    summary\_type: payload.summary\_type,  
    trigger\_reason: 'reconciliation\_retry',  
    request\_id: generateRequestId(),  
    previous\_attempt\_summary\_version: payload.summary\_version,  
  });

  metrics.increment('memory\_refresh\_reconciliation\_re\_enqueued\_total');  
}

### **8.5.4 Concurrency safety**

* Sweep query uses `FOR UPDATE SKIP LOCKED` — multiple sweep instances coexist without double-enqueue  
* Reconciliation handler re-verifies row state inside its transaction — if T2 completed between sweep and handler, no-op  
* Per-row reconciliation is bounded work (no Vertex calls); no advisory lock needed

### **8.5.5 Failure modes**

| Failure | Behavior |
| ----- | ----- |
| Reconciliation handler fails (DB outage) | Cloud Tasks retry per §8.2; pending row remains; next sweep re-detects |
| Re-enqueued refresh task fails (Cloud Tasks API down) | Cloud Tasks retry on enqueue; if exhausted, manual ops intervention via runbook |
| Reconciliation finds row no longer pending | Log info; exit clean |
| Refresh task succeeds after reconciliation marked failed | Two ready rows exist with different versions; reader picks max version (`ORDER BY summary_version DESC`); failed row eventually deleted by retention policy |

## **§8.6 Job handler service**

Cloud Run service `lisa-memory-worker`:

* Separate from `lisa-orchestrator` (V1 target per blast-radius isolation; §13.3)  
* Longer timeout ceiling per instance (15 min) vs orchestrator (10s)  
* HMAC auth NOT used for Cloud Tasks → handler (OIDC tokens per §9.3); HMAC used for 03A V3 schedulers → Cloud Tasks enqueue path per 01A Part VII  
* Stateless per request; no job state held in memory between invocations  
* V2.0: handles three routes (`/async/compaction`, `/async/memory-refresh`, `/async/pending-reconciliation`)

## **§8.7 Job writeback safety**

Async jobs write to Supabase. Per §8.0 ownership split, this is executing 03A V3-owned logic via 03C-owned runtime; the thin-consumer principle (§1.1) is preserved because the job logic is upstream-owned.

**Bounded writeback scope (V2.0):**

* `tutor_memory_summaries` — allowed (compaction \+ refresh \+ reconciliation jobs write)  
* `tutor_vertex_context_cache` — allowed (invalidation during refresh per §8.4)  
* Anything else — NOT allowed from async jobs

Writeback uses service account `lisa-memory-worker@` with narrowly scoped database credentials (row-level access only to the two tables above; no broad DB write permission). IAM bindings audited per §12.3 quarterly review.

**Read access (V1.1 — AMB-03C-05 resolution):** `lisa-memory-worker@` has READ-ONLY access to 02B-owned, 02C-owned, and 03A V3-owned tables needed for refresh input. Specifically: practice sessions, review sessions, full-length exams, KPI state, mastery state. Read scope is bounded by Postgres RLS policies per 01A §56-§58.

## **§8.8 Job observability (V2.0 expanded)**

Per §XI:

* `async_job_enqueue_rate` by queue  
* `async_job_success_rate` by job\_type  
* `async_job_latency_p95` by job\_type  
* `async_job_retry_rate` (signal for handler flakiness)  
* `async_job_dead_letter_rate` (SEV-2 alert if \> 1/hr)  
* `memory_refresh_job_success_rate` (joint with 03B §22.12) — target \>99%  
* `teaching_profile_staleness_lag_minutes` (joint with 03B §22.12) — 03C owns for update path; target \<5 min, alert \>30 min  
* **V2.0 new:** `memory_refresh_t1_latency_ms` (target P95 \<100ms)  
* **V2.0 new:** `memory_refresh_generation_latency_ms` (target P95 \<60s; alert \>180s)  
* **V2.0 new:** `memory_refresh_t2_latency_ms` (target P95 \<100ms)  
* **V2.0 new:** `memory_refresh_pending_window_p95` (T1→T2 total; alert \>300s)  
* **V2.0 new:** `memory_refresh_orphaned_pending_count` (gauge; target 0; alert \>10)  
* **V2.0 new:** `memory_refresh_reconciled_failed_total` (counter)  
* **V2.0 new:** `memory_refresh_reconciliation_re_enqueued_total` (counter)  
* **V2.0 new:** `memory_refresh_t2_no_pending_row_total` (counter; signals T2 → reconciliation race)  
* **V2.0 new:** `memory_refresh_envelope_fallback_rate` (joint with 03B; rate at which envelope-builder falls back to old version due to pending status)

Job logs include `request_id` correlation for tracing origin request (e.g., which turn triggered compaction).

---

# **Part IX — Authentication (Service-to-Service)**

## **§9.1 03B → 03C auth: HMAC per 01A Part VII**

All 03B→03C invocations carry HMAC signing per 01A Part VII canonical convention.

* Signing string: per 01A §62 (method, path, timestamp, canonical body hash)  
* Headers: `X-Lyceon-Service: lisa-api`, `X-Lyceon-Timestamp`, `X-Lyceon-Signature`  
* Secret storage: Secret Manager, mounted per 01A §64  
* Rotation cadence: 90 days per 01A §65; 14-day overlap window

Additionally, Cloud Run IAM requires `roles/run.invoker` on `lisa-orchestrator` for the `lisa-api` service account (§2.4). This is the network-level auth; HMAC is the application-level auth. Both required.

## **§9.2 03C → Vertex AI auth**

Vertex AI SDK uses Application Default Credentials, backed by the Cloud Run service account (`lisa-orchestrator@PROJECT.iam`). Service account has `roles/aiplatform.user`.

No API keys in configuration. No Vertex credentials transit the 03B↔03C boundary.

## **§9.3 Cloud Tasks → 03C async handler auth**

Cloud Tasks includes an OIDC token in its request to the handler. The handler validates:

* Token signature (standard Google OIDC)  
* Token audience matches the handler URL  
* Token issuer is `https://accounts.google.com`  
* Token's service account matches `lisa-cloud-tasks@PROJECT.iam` (enqueuer identity)

Cloud Run IAM enforces `roles/run.invoker` for the Cloud Tasks service account on the async handler.

## **§9.4 Emergency secret revoke per 01A §66**

Inherited from 01A Part VII. If HMAC secret compromise suspected:

1. Rotate the secret immediately (generate new, mark old `revoked_at`)  
2. Deploy new secret to 03B and 03C via Secret Manager version pin  
3. Old secret continues working for 14 days overlap per 01A §65 unless explicit revoke flag set  
4. Monitor `hmac_auth_failure_rate` per service pair (01A §67); expected brief spike during rotation

03C-specific addition: Vertex API keys are NOT used (service account auth). Vertex compromise would require rotating the Cloud Run service account itself, which is a separate operational procedure outside 01A's secret rotation flow.

## **§9.5 Internal staff access to 03C**

Per 01A §58 canonical support escalation pattern:

* No direct developer access to 03C orchestrator logs in production  
* Ops-scoped access via audited break-glass procedure  
* 03C logs redact prompt contents and Vertex response bodies (per 01A §11 redaction); only metadata (request\_id, model used, token counts, latencies, error codes) logged

**What's in 03C logs (safe):**

* Correlation IDs, request IDs  
* Model selected, cache hit/miss, latencies  
* Error codes and timing  
* Token counts for cost observability

**What's NOT in 03C logs:**

* Assembled prompt text  
* Vertex response text  
* Student identity beyond `student_id` UUID  
* Memory summary contents  
* Canonical question content

---

# **Part X — Failure Modes & Recovery**

## **§10.1 Classification**

| Failure | Classification | Recovery |
| ----- | ----- | ----- |
| Envelope validation failure | Caller error | 400 to 03B; 03B logs and returns 500 to client |
| HMAC validation failure | Security event | 401 to 03B; alert at \>1% rate |
| Vertex timeout | Transient | 1 retry; then 504 to 03B; 03B retries turn if idempotent |
| Vertex 5xx | Transient | 1 retry; then 503 to 03B; 03B retries |
| Vertex 429 (quota) | Quota exhaustion | No retry; 429 to 03B; 03B treats as service degraded |
| Vertex safety filter blocked | Content policy | 422 to 03B; 03B substitutes safe hint per 03B §16 |
| Structured output violation (safety-critical fields) | Model drift | 502 to 03B; 03B retries once, then fails turn |
| Structured output drift (content fields) | Model noise | Normalize; log drift; continue |
| Vertex unreachable (network) | Infrastructure | 1 retry; then 503 to 03B |
| Cloud Tasks enqueue failure | Infrastructure | Log; continue (compaction is not user-blocking) |
| Async job handler failure | Job execution | Cloud Tasks retries per queue policy; dead-letter after max retries |

## **§10.2 Circuit breaker (V1.1 — AMB-03C-06 scope explicit)**

03C implements a circuit breaker on Vertex calls to prevent cascading quota burn during provider incidents.

### **10.2.1 Scope: per-Cloud-Run-instance (V1)**

**Locked for V1: per-instance state, not shared.** Each Cloud Run orchestrator instance independently tracks Vertex call error rate and independently decides whether its breaker is tripped.

**Rationale:**

* Per-instance is simpler (no shared Tier 2 counter, no LISTEN/NOTIFY coordination)  
* During real Vertex outages, all instances observe errors nearly simultaneously and trip within seconds of each other — effectively fleet-wide breaker  
* Blast radius: up to 10 requests per instance may pass through before tripping (per warmup below)

**Trade-off accepted:** during Cloud Run cold-start, a new instance has no error history and will send the first requests through to Vertex even if Vertex is degraded. Warmup rule (below) bounds this.

**V2 target:** optional Tier 2 shared counter for faster fleet-wide trip response. Evaluated post-launch based on observed Vertex incident patterns.

### **10.2.2 Warmup period**

On Cloud Run instance startup:

* First 10 Vertex requests pass through unconditionally (no breaker evaluation)  
* After 10 requests, error rate calculation begins with accumulated data  
* This prevents cold instances from immediately tripping based on zero-sample history

### **10.2.3 State machine**

Per-model (Flash and Pro track independently):

\[closed\] → error rate \> 50% over rolling 60s window for \> 30s → \[tripped\]  
\[tripped\] → immediately return vertex\_5xx\_retriable with Retry-After: 30s  
\[tripped\] → after 30s → \[half-open\]  
\[half-open\] → 1 probe request allowed through  
  \- probe succeeds → \[closed\] (resume normal traffic)  
  \- probe fails → \[tripped\] (30s more)

### **10.2.4 Configuration via 03A V3 §18.7**

* `vertex.circuit_breaker.error_rate_threshold` (default 0.5)  
* `vertex.circuit_breaker.window_seconds` (default 60\)  
* `vertex.circuit_breaker.trip_duration_seconds` (default 30\)  
* `vertex.circuit_breaker.warmup_request_count` (default 10\)

### **10.2.5 Interaction with Pro→Flash fallback**

When Pro breaker trips, §5.3.2 Pro→Flash fallback becomes the primary path: routing priority 2 (budget breaker) and §5.3.2 fallback both redirect to Flash. If Flash breaker also trips, turns fail with `vertex_5xx_retriable`.

Breaker state does NOT inherit the budget circuit breaker state (§5.3.3) — they are independent signals.

### **10.2.6 Observability**

* `vertex_circuit_breaker_trip_count` per model (counter; alert at any trip during a window)  
* `vertex_circuit_breaker_state` per model (gauge: closed | tripped | half-open)  
* `vertex_circuit_breaker_warmup_complete_rate` — percent of instances past warmup (informational)

## **§10.3 Pro→Flash fallback (reference to §5.3.2)**

Pro→Flash per-turn fallback logic lives at §5.3.2 (part of model routing). Summary here:

* Vertex Pro 5xx / 429 / timeout → 03C automatically retries with Flash for the same turn  
* Non-fallback-eligible errors (400, 422, 403\) pass through as errors without Flash fallback  
* Daily Pro budget exceeded → all Pro-routed turns redirect to Flash via budget circuit breaker (§5.3.3)  
* Fallback is logged via `vertex_pro_fallback_rate` SLI and surfaced to 03B via `orchestration_meta.fallback_applied = true`

## **§10.4 No fail-open on missing context**

If `resolved_scope` references a question but 03B did not include `canonical_question` content, 03C does NOT attempt to fetch the question from its own DB access. It returns `invalid_envelope` error. 03B is responsible for populating context; 03C trusts and consumes.

## **§10.5 Idempotency failure (from 03B's perspective)**

If 03C succeeds at Vertex but the 03B handler fails downstream (canonical write failure per 03B V4.1 §13.4), 03B's retry path reads the inference result from cache (03B V4.1 §12B.4). 03C is not involved in this recovery — the cached response replays without re-calling 03C.

Consequence: 03C does not need to handle "already-responded-for-this-client\_turn\_id" scenarios. Every 03C call is treated as fresh.

---

# **Part XI — Observability**

## **§11.1 Logging conventions**

Per 01A Part II canonical logger:

* Every log event includes `request_id`, `correlation_id`, `student_id`, `conversation_id`  
* Severity levels: DEBUG (dev only), INFO (production default), WARN, ERROR  
* PII redaction per 01A §11 (strip message content, prompt text, response text)  
* Structured JSON output for Cloud Logging ingestion

## **§11.2 Metrics (SLI) catalog (V1.1 updated)**

Per 01A §15 metrics interface, prefix `vertex_` or `orchestrator_` or `async_job_` or `candidate_` or `memory_refresh_`:

**Turn path SLIs:**

* `orchestrator_turn_latency_p50`, `_p95`, `_p99` — end-to-end 03C invocation latency (target P95 \<5000ms)  
* `orchestrator_turn_success_rate` — target \>99%  
* `orchestrator_callback_success_rate` (V1.1 — SWE-03C-03; joint with 03B §22.12) — rate at which 03C successfully returns to 03B; target \>99%; alert \<95%  
* `vertex_call_latency_p95` — Vertex call only, excluding 03C overhead (target \<4000ms)  
* `vertex_call_retry_rate` — target \<1%

**Model routing SLIs (V1.1 — BLK-03C-04 additions):**

* `vertex_model_routing_distribution` — per (entry\_mode, source\_surface) histogram of Flash vs Pro selection  
* `vertex_model_flash_share` — percent of turns using Flash (target \~40-60% at steady state)  
* `vertex_model_pro_share` — percent using Pro (target \~40-60%)  
* `vertex_pro_fallback_rate` (V1.1) — percent of Pro-routed turns that fell back to Flash (target \<1%; alert \>5%)  
* `vertex_pro_budget_circuit_breaker_state` (V1.1) — gauge: normal | warning | tripped  
* `vertex_pro_budget_circuit_breaker_redirects` (V1.1) — count of turns redirected to Flash due to budget breaker

**Output quality SLIs:**

* `vertex_output_schema_drift_rate` — percent of responses requiring normalization for content fields (target \<5%)  
* `vertex_output_schema_violation_rate` — percent failing strict safety-critical fields (target \<0.1%; alert \>1%)  
* `vertex_safety_block_rate` — percent blocked by Vertex safety filter (target \<0.5%; indicates either legitimate harmful content or over-triggering)  
* `vertex_candidate_slot_hallucination_rate` (V1.1 — BLK-03C-02) — percent of turns where model returned a candidate slot\_id not in the pre-selected list (target \<1%; alert \>5%)

**Candidate selection SLIs (V1.1 — §5.9):**

* `candidate_preselect_latency_p95` — candidate pre-selection DB query latency (target \<150ms)  
* `candidate_preselect_empty_rate` — percent of triggered pre-selects returning zero candidates (signal for question bank gaps)  
* `similar_question_offer_rate` — percent of turns that include a similar-question offer (informational; calibrates product metric)

**Cache SLIs (V1.1 revised targets — BLK-03C-01):**

* `vertex_context_cache_hit_rate` — target **\>50%** steady state (V1.1 revised from V1's \>70% given per-student composite design)  
* `vertex_context_cache_creation_latency_p95` — target \<1000ms  
* `vertex_context_cache_miss_on_lookup_rate` — cache miss despite mapping row present (target \<5%)  
* `vertex_context_cache_eligibility_rate` (V1.1) — percent of turns where composite cache is eligible (target \~90%)

**Cost SLIs:**

* `vertex_input_tokens_per_turn_p95` — distribution of prompt size  
* `vertex_output_tokens_per_turn_p95` — distribution of response size  
* `vertex_cost_per_turn_p95` — computed from tokens × model price  
* `vertex_cost_per_day` — running total; compared against budget alert threshold  
* `vertex_cost_per_turn_by_model` (V1.1) — Flash vs Pro breakdown for routing-tuning

**Async job SLIs:**

* `async_job_enqueue_rate` by queue  
* `async_job_success_rate` by job\_type — target \>99%  
* `async_job_latency_p95` by job\_type  
* `async_job_retry_rate` — target \<5%  
* `async_job_dead_letter_rate` — target \<0.01%/hr; alert at any dead letter  
* `memory_refresh_job_success_rate` (V1.1 — SWE-03C-03; joint with 03B §22.12) — target \>99%  
* `teaching_profile_staleness_lag_minutes` (V1.1 — SWE-03C-03; joint with 03B §22.12) — 03C owns for update-path contribution; target \<5 min, alert \>30 min

**Circuit breaker SLIs (V1.1 expanded — AMB-03C-06):**

* `vertex_circuit_breaker_trip_count` per model — alert at any trip  
* `vertex_circuit_breaker_state` per model — current state (closed | tripped | half-open)  
* `vertex_circuit_breaker_warmup_complete_rate` (V1.1) — percent of instances past warmup (informational)

## **§11.3 Cost observability (V1.1 — NTH-03C-02 cross-ref)**

Per §1.11, cost is observable and monitored:

* Per-turn cost emitted as metric (`vertex_cost_per_turn`)  
* Rolling daily cost aggregated in BigQuery / Cloud Monitoring  
* Budget alerts: 70% of daily budget (INFO), 90% (WARN), 120% (PAGE)  
* V1 daily budget: set per finance review; initial target per 03B V4.1 §12B.5.5 projection range

**Savings projection cross-reference (V1.1 — NTH-03C-02):**

03B V4.1 §12B.5.5 provides the ranged annualized savings projection for Vertex context caching. V1.1 notes that projection requires update given BLK-03C-01 cache redesign (per-student composite rather than three-kind caching). Revised projection math:

* Composite cache hit rate target: \~50% (vs V1 document's \>70% assumption)  
* Cache-eligible token share: \~40-50% of input tokens (system \+ teaching\_profile only; canonical question now in message history per §6.2)  
* Net input cost savings at steady state: \~15-25% (half of V1's optimistic 30-45%)  
* Net total Vertex cost reduction: \~8-15% at steady state

**Revised annualized savings range at V1 launch scale (1M turns/day):** \~$5-20k/yr (vs V4.1 §12B.5.5's $5-30k range, which was already hedged; V1.1's cache redesign pushes the lower end).

**03B V4.1 §12B.5.5 update required:** when consolidated hardening pass revisits 03B, §12B.5.5 should be aligned with 03C's cache design to remove inconsistency. Target: 03B V5 or consolidated pass.

**Cost-per-turn breakdown (tracked separately):**

* Cached input tokens vs uncached input tokens  
* Output tokens  
* Model-level breakdown (Flash vs Pro) — enables tuning routing rules if Pro costs unexpectedly high

Enables SLI-driven cost tuning: if Pro usage is higher than expected, routing rules (§5.3.1) can be adjusted via config.

## **§11.4 Dashboards**

Following 03B V4.1 §22.12 pattern, V1 dashboards:

1. **03C Turn Flow Health** — orchestrator\_turn\_latency, success\_rate, retry\_rate  
2. **Vertex Integration** — vertex\_call\_latency, circuit\_breaker\_state, safety\_block\_rate, model\_routing\_distribution  
3. **Cache Layer (joint with 03B)** — context\_cache\_hit\_rate, creation\_latency, miss\_on\_lookup  
4. **Cost & Budget** — vertex\_cost\_per\_day, cost\_per\_turn\_p95, token distributions  
5. **Async Jobs** — job\_success\_rate, latency, retry, dead\_letter

## **§11.5 Correlation**

Every 03C operation tags logs with:

* `request_id` — unique per 03B → 03C invocation  
* `correlation_id` — propagated from 03B (unique per user-facing turn, may include multiple 03C calls on retry)  
* `student_id`, `conversation_id` — for per-user diagnostics  
* `model_used`, `cache_used` — for slicing analytics

Vertex request metadata includes `request_id` where Vertex API supports it (via `labels`). Enables tracing from Vertex billing records back to user-facing turns.

---

# **Part XII — Security & Least Privilege**

## **§12.1 Network posture**

03C is **not** internet-accessible:

* Cloud Run service configured with `--ingress=internal` (or `--ingress=internal-and-cloud-load-balancing` if fronted by internal LB)  
* No public DNS  
* Only reachable from:  
  * 03B main API Cloud Run service (same project, internal ingress)  
  * Cloud Tasks → async handler (internal invocation)  
  * Developer debugging via IAP or break-glass authenticated session

## **§12.2 Secret management**

Per 01A §64:

* HMAC signing secret: Secret Manager, mounted as env var at startup  
* Service account credentials: Google-managed via Cloud Run metadata server  
* No secrets in source code, environment config files, or deployment manifests

**Secret audit:** Secret Manager access logs reviewed monthly per 01A §65 rotation schedule.

## **§12.3 Least privilege IAM**

Service accounts per §2.4. Regular audit that no SA has broader roles than specified:

| SA | Expected roles | Never grant |
| ----- | ----- | ----- |
| `lisa-orchestrator` | `aiplatform.user`, `cloudtasks.enqueuer`, `secretmanager.secretAccessor` (on scoped secrets), read-only RLS-scoped DB access to `tutor_vertex_context_cache`, `canonical_questions`, `tutor_context_runtime_config` | `editor`, `owner`, `iam.*` admin, any write access to mastery/student-data tables |
| `lisa-memory-worker` | Above \+ `cloudsql.client` (if direct DB connection) \+ scoped RLS to read 02B/02C/03A tables and write `tutor_memory_summaries` / `tutor_vertex_context_cache` | Same |
| `lisa-cloud-tasks` | `run.invoker` on async handler only | Any other invoker scope |

Quarterly IAM audit reviews deviations.

## **§12.4 Vertex project isolation**

Per §2.5, Vertex usage is in a separate GCP project (`lyceon-vertex-prod`) from main app project. Benefits:

* Cost isolation (Vertex bills don't mingle with main app)  
* Quota isolation (Vertex quota issues don't impact main app quota)  
* IAM isolation (Vertex-project-level IAM separate from app-project IAM)

Service accounts in the main app project have `aiplatform.user` binding on the Vertex project via cross-project IAM grant.

## **§12.5 Logging redaction (reprise)**

Per §9.5 and 01A §11, production logs never contain:

* Raw prompt text  
* Vertex response text  
* Memory summary contents  
* Canonical question contents beyond canonical\_id (for lookup only)

**What testing environments may log (dev only):** full prompts and responses, behind IAM-restricted access, with explicit `LISA_DEV_LOG_PROMPTS=true` flag. Never in production.

---

# **Part XIII — Deployment & Environments**

## **§13.1 Environment tiers**

* **Production** (`lyceon-lisa-prod` GCP project): canonical, user-facing  
* **Staging** (`lyceon-lisa-staging`): pre-production, functional parity with prod  
* **Development** (`lyceon-lisa-dev`): per-engineer or per-feature; relaxed policies for iteration

Each env has its own Cloud Run services, Cloud Tasks queues, Vertex project binding, service accounts, secrets.

## **§13.2 Deployment method**

Cloud Run managed:

* Source: container image from Artifact Registry (built via CI per 01A §XX build pipeline)  
* Traffic split: 100% to latest revision by default; canary via `--traffic` flag for gradual rollout  
* Rollback: instant via `gcloud run services update-traffic` to prior revision

**Blue-green deploy:** deploy new revision with 0% traffic, verify health via `/health` endpoint, shift 100% in one step. Rollback \= revert traffic.

## **§13.3 Orchestrator vs async handler co-location**

V1 choice: **separate Cloud Run services** for orchestrator and async handler:

| Pro | Con |
| ----- | ----- |
| Isolated scaling (orchestrator latency sensitivity vs async batch tolerance) | Two services to deploy and monitor |
| Blast radius containment (async job crash doesn't impact orchestrator) | Marginal cost increase from two min-instances |
| Different timeout/memory profiles per use case |  |

V2 option: consolidate if operational overhead exceeds benefit.

## **§13.4 Cold start handling**

Per 03B V4.1 §28B.1, cold-start targets and CI gate apply:

* 03C orchestrator: cold start P99 target \<3s from request to response-ready  
* 03C async handler: cold start P99 target \<5s (more generous; async latency matters less)

Bootstrapping at cold start:

1. Load runtime config from Supabase (per 01A §3)  
2. Load system prompt templates from container image (baked in at build)  
3. Initialize Vertex SDK with service account  
4. Health endpoint returns 200 only after all above complete

Min-instances: 1 for orchestrator (always-warm to absorb first-request latency); 0 for async handler (acceptable cold start for non-user-facing path).

## **§13.5 Config management**

Runtime config per 03A V3 §18.7 `tutor_context_runtime_config`:

* Values read at Supabase via LISTEN/NOTIFY pattern  
* Propagated to 03C instances via the same Postgres listener used by 03B (single listener per instance serves all consumers)  
* Environment-specific values via `environment` column filter

Build-time config:

* Vertex project ID, region (immutable per environment)  
* Container image metadata  
* Cloud Run service name

Config reload without deploy: supported for most values (model identifiers, temperature, routing thresholds). Not supported for prompt artifact changes (requires deploy).

## **§13.6 Local development**

Per 03A V3 §XX local dev pattern, developers can:

* Run 03C orchestrator locally (Docker), hitting real Vertex via service account key file (local-only)  
* Stub Vertex for tests with fixture responses (preferred; avoids Vertex cost during dev)  
* Use per-developer Cloud Run dev env for full-stack integration testing

**Security in dev:** service account keys for local dev are generated per-developer, rotated quarterly, never committed. Vertex quota limited on dev project to prevent runaway cost from dev traffic.

---

# **Part XIV — Acceptance Criteria**

V1 is complete when:

## **§14.1 Functional acceptance**

* \[ \] Cloud Run orchestrator service deployed in us-central1 with correct IAM  
* \[ \] Cloud Run async handler service deployed separately  
* \[ \] Cloud Tasks queues (`lisa-compaction`, `lisa-memory-refresh`, `lisa-pending-reconciliation`) created with correct retry policy  
* \[ \] 03B → 03C happy path works: envelope validation, Vertex invocation, structured response returned  
* \[ \] Model routing distributes Flash/Pro correctly per §5.3 rules  
* \[ \] Hybrid strict/lenient schema enforced: strict fields reject drift, content fields normalize  
* \[ \] Vertex context cache consumption works: lookup, create-on-miss, mapping writeback  
* \[ \] **Per-student composite cache key (policy\_variant \+ prompt\_version \+ student\_id \+ teaching\_profile\_version) builds correctly per §6.2 — canonical question content NOT in cache, lives in message history per V1.1 BLK-03C-01 design**  
* \[ \] Streaming mode works when `envelope.streaming.enabled == true`  
* \[ \] Sync mode (default) returns full response envelope  
* \[ \] Conversation-close compaction job executes end-to-end  
* \[ \] MemoryRefreshWorker job executes end-to-end with placeholder-then-fill pattern per §8.4 (T1 invalidate+pending insert; generation; T2 fill+ready)  
* \[ \] PendingReconciliationWorker correctly identifies and re-enqueues orphaned pending rows per §8.5  
* \[ \] Async jobs use bounded writeback scope only (§8.7)  
* \[ \] Error codes map correctly to 03B per §7.3  
* \[ \] **V2.1: Vertex output schema (§5.5) uses `related_candidate_slot_id` only — model never produces canonical IDs**  
* \[ \] **V2.1: 03C → 03B response schema (§7.1) populates `related_question_canonical_id` via §7.1.1 resolution flow**  
* \[ \] **V2.1: Candidate slot hallucination handling — model returns invalid slot\_id → link dropped, SLI emitted, turn still succeeds**  
* \[ \] **V2.1: PII guard (§4.2.2) blocks turns where assembled prompt contains email, phone, DOB, address, name labels, or guardian identifiers**  
* \[ \] **V2.1: Candidate pre-select (§5.9.2) uses deterministic `hashtext(canonical_id || student_id || current_date)` ordering — no `RANDOM()`**  
* \[ \] **V2.1: Pro→Flash auto-fallback functional per §5.3.2; budget circuit breaker per §5.3.3 trips correctly**

## **§14.2 Non-functional acceptance**

* \[ \] HMAC signing per 01A Part VII works (signing/verification tested)  
* \[ \] Cloud Run IAM prevents external access (verified via network tests)  
* \[ \] Service accounts have least-privilege IAM (audited per §12.3)  
* \[ \] Logs redact prompt \+ response content in production (verified)  
* \[ \] P95 latency \<5000ms for sync turn path  
* \[ \] P99 cold start \<3s for orchestrator  
* \[ \] Vertex quota monitoring active  
* \[ \] Budget alerts wired to Cloud Monitoring  
* \[ \] All §11.2 SLIs emitted and visible in dashboards  
* \[ \] Circuit breaker prevents quota burn during Vertex incident (chaos test)  
* \[ \] Deployment rollback tested (\<5 min from decision to prior version live)  
* \[ \] **V2.1: PII guard P95 latency \<5ms (negligible contribution to total turn latency)**  
* \[ \] **V2.1: Pending reconciliation sweep cadence (5 min) verified; pending-window timeout (10 min) honored**  
* \[ \] **V2.1: Memory refresh advisory lock spans T1+generation+T2 correctly (chaos test: kill worker mid-handler, verify lock release on connection drop)**

## **§14.3 Safety acceptance (V1.1 — SWE-03C-04 expanded)**

* \[ \] No Vertex credentials exposed to client (verified in browser dev tools; never should appear)  
* \[ \] Safety filter thresholds appropriate for minor audience (§5.7 settings applied)  
* \[ \] Structured output violations on safety-critical fields fail-closed  
* \[ \] Canonical question IDs not exposed in prompts or responses (§4.4)  
* \[ \] No mastery writes from 03C (verified — `lisa-orchestrator@` and `lisa-memory-worker@` SAs have NO access to mastery tables per IAM audit)  
* \[ \] No student PII transits through Vertex API beyond `student_id` UUID (verified — prompt assembly does not include student name, email, phone, or other PII; `student_id` is an opaque UUID, not correlatable to external identity)  
* \[ \] Vertex safety filter response handling tested for each blocked category (§5.7 settings): HARM\_CATEGORY\_HARASSMENT, HARM\_CATEGORY\_HATE\_SPEECH, HARM\_CATEGORY\_SEXUALLY\_EXPLICIT (BLOCK\_LOW\_AND\_ABOVE), HARM\_CATEGORY\_DANGEROUS\_CONTENT  
* \[ \] No guardian data reachable by 03C (guardian accounts don't invoke 03C; envelope only contains student-scoped data; verified by negative test — guardian JWT in envelope should cause invalid\_envelope)  
* \[ \] §15.10 child-user override signal does NOT reach 03C (03B filters before calling 03C; verified — `envelope.policy_assignment.reason_snapshot` does not include abuse-related fields)  
* \[ \] Cross-project IAM grant scope tested (§2.5 / §12.4) — `lisa-orchestrator@` in app project has `aiplatform.user` ONLY on `lyceon-vertex-prod` (prod), `lyceon-vertex-staging` (staging), `lyceon-vertex-dev` (dev); no broader cross-project access  
* \[ \] Orchestrator logs do not contain question content (§9.5 / §12.5) — verified by log sampling; metadata-only confirmed  
* \[ \] Candidate slot hallucination handling tested — model returns nonexistent slot\_id → `question_links[]` entry dropped, SLI increments, turn still succeeds  
* \[ \] Pro→Flash fallback does not expose Pro-only features (e.g., if Pro has longer context window, Flash fallback respects Flash's bound) — verified by fallback test with near-max-context envelope  
* \[ \] Budget circuit breaker correctness — test: set budget to $1, trigger Pro-routed turns, verify circuit trips and remaining Pro-routed turns redirect to Flash

---

# **Part XV — Governance**

## **§15.1 Ownership (V1.1 updated)**

**Primary owner:** Platform Engineering (infrastructure, orchestrator runtime, Cloud Run, Vertex integration).

**Joint ownership:** LISA team for §VIII content (async jobs execute 03A V3-owned logic per §VIII.0 ownership split).

**Operational source-of-truth:** Platform Engineering maintains alignment between 03C and live GCP topology. Changes requiring 03A V3 coordination are reviewed jointly.

## **§15.2 Review triggers**

This document must be reviewed when any of the following occur:

* Vertex AI model family change (e.g., Gemini 3.0 availability)  
* Vertex API schema change affecting request or response envelope  
* Cloud Run operational model change (regional, cold-start behavior, IAM)  
* 03B V4.1 envelope change (forces 03C contract update)  
* 03A V3 memory schema change (affects envelope `memory_summaries`)  
* 01A Part VII signing convention change  
* New async job type required  
* New failure mode emerges in production

## **§15.3 Lock meaning**

"Canonical" means:

* The contract is authoritative for implementation  
* Changes require explicit update of this document and related contracts  
* Silent drift in code vs doc is not permitted

Post-lock additive clarification is allowed; behavior-changing changes require explicit review and version increment.

## **§15.4 Coordination with other docs (V1.1 — BLK-03C-03 co-signature)**

**Joint-review clause for §VIII (BLK-03C-03 closeout):**

Per §8.0 ownership split, §VIII content is split between 03C-owned runtime (§VIII.1, §VIII.2, §VIII.5, §VIII.6, §VIII.7) and 03A V3-owned algorithm (§VIII.3, §VIII.4 handler logic subsections). Change reviews follow:

| §VIII subsection | Change review required from |
| ----- | ----- |
| §VIII.0 ownership split | 03C owner AND 03A V3 owner (joint) |
| §VIII.1 scope | 03C owner |
| §VIII.2 queue topology | 03C owner |
| §VIII.3 trigger \+ enqueue | 03C owner (trigger predicates are upstream in 03A V3; enqueue is 03C) |
| §VIII.3 handler logic subsection | 03A V3 owner (algorithm) |
| §VIII.4 handler logic subsection | 03A V3 owner (algorithm) |
| §VIII.4 concurrency control | 03C owner (Cloud Tasks pattern) |
| §VIII.5 handler service | 03C owner |
| §VIII.6 writeback safety / IAM scope | 03C owner |
| §VIII.7 observability | 03C owner (SLI definitions) \+ 03A V3 owner (semantic interpretation) |

Conflicts between 03C and 03A V3 on job logic are resolved in favor of 03A V3; 03C carries a reference, not a duplicate specification.

**Other coordination triggers:**

* Changes to 03B↔03C envelope: coordinated review with 03B V4.1 §28A.2 operational contract  
* Changes to Vertex context cache consumption (§VI): coordinated review with 03B §12B.5 (mapping table owner) and 03A V3 §9 (teaching\_profile source)  
* Changes to model routing (§5.3): 03C-owned; LISA team informed via routine release notes  
* Changes to HMAC auth (§IX): coordinated with 01A Part VII  
* Changes to Vertex safety filter settings (§5.7): safety review required (joint with platform safety team if established)

---

# **Part XVI — Hardening (V2.0 — V4.1-style template applied)**

V2.0 applies the V4.1-style hardening template to 03C. Five major additions:

* **§28 Failure matrix** — every primitive's failure modes consolidated with target rates, alert thresholds, recovery actions  
* **§28A Per-endpoint operational contracts** — every endpoint's full request/response/auth/timeout/retry/observability/rollback spec  
* **§28B Cloud Run operational contract** — deployment topology, cold-start, scaling, rollback procedure  
* **§28C Isolation levels** — every DB interaction's transaction boundary, isolation level, locking, serialization-failure behavior  
* **§29 Schema migrations** — exact ALTER TABLE statements deployable to production  
* **§30 Configuration reference** — every tunable consolidated  
* **§31 Schema reference** — exact column shapes for tables 03C reads/writes  
* **§32 Adapter patterns** — forward-compatibility specifications for upstream changes

## **§28 Failure Matrix**

Every 03C-owned primitive's failure modes consolidated. Target rates and alert thresholds are authoritative; SLI references in §11.2 must align.

### **§28.1 Orchestrator turn path failures**

| Failure mode | Target rate | Alert at | Recovery action | SLI |
| ----- | ----- | ----- | ----- | ----- |
| Envelope validation failure (`invalid_envelope`) | \<0.01% | \>0.1% (page) | Caller bug; 03B treats as 500; alert page | `orchestrator_envelope_validation_failure_rate` |
| HMAC auth failure (`auth_failed`) | \<0.001% | Any sustained \>1/min | Security incident; rotate per 01A §66 | `hmac_auth_failure_rate` |
| Prompt-too-large (`prompt_too_large`) | \<0.05% | \>0.5% (warn) | Envelope builder bug; 03B logs \+ 500 to client | `orchestrator_prompt_oversize_rate` |
| Total turn latency exceeds budget | P95 \<5000ms | P95 \>7000ms (warn); \>10000ms (page) | Investigate Vertex latency, cache hit rate, network | `orchestrator_turn_latency_p95` |
| Total turn success rate | \>99% | \<98% (warn); \<95% (page) | Investigate via failure breakdown | `orchestrator_turn_success_rate` |
| Cold-start latency | P99 \<3000ms | P99 \>5000ms (warn) | Investigate bootstrap / image size | `orchestrator_cold_start_latency_p99` |

### **§28.2 Vertex invocation failures**

| Failure mode | Target rate | Alert at | Recovery action | SLI |
| ----- | ----- | ----- | ----- | ----- |
| Vertex 5xx after retry (`vertex_5xx_retriable`) | \<0.5% | \>2% (warn); \>5% (page) | Vertex incident; circuit breaker may trip; 03B retries turn | `vertex_call_5xx_rate` |
| Vertex timeout (`vertex_timeout`) | \<0.2% | \>1% (warn); \>3% (page) | Investigate prompt size, model load; possibly degraded Vertex region | `vertex_call_timeout_rate` |
| Vertex 429 quota (`vertex_quota_exhausted`) | \<0.05% | Any sustained (page) | Quota tuning required; circuit breaker may trip | `vertex_call_quota_rate` |
| Vertex 422 safety blocked (`vertex_safety_blocked`) | \<0.5% | \>2% (warn) | Investigate triggering content; possible filter mistuning | `vertex_safety_block_rate` |
| Structured output violation (strict fields) | \<0.1% | \>1% (page) | Model drift; flag prompt regression; 03B retries once | `vertex_output_schema_violation_rate` |
| Structured output drift (lenient fields) | \<5% | \>10% (warn) | Model drift; normalize and continue; investigate root cause | `vertex_output_schema_drift_rate` |
| Pro→Flash fallback applied | \<1% | \>5% (warn); \>10% (page) | Pro model degraded or budget exhausted | `vertex_pro_fallback_rate` |
| Pro budget circuit breaker tripped | Any trip | Trip event (page) | Daily budget exhausted; investigate spend or raise budget | `vertex_pro_budget_circuit_breaker_state` |
| Circuit breaker trip per model | Any trip | Trip event (page) | Vertex incident or sustained errors | `vertex_circuit_breaker_trip_count` |

### **§28.3 Context cache failures**

| Failure mode | Target rate | Alert at | Recovery action | SLI |
| ----- | ----- | ----- | ----- | ----- |
| Cache lookup timeout (\>100ms) | \<0.5% | \>2% (warn) | DB load issue; proceed uncached | `vertex_context_cache_lookup_timeout_rate` |
| Cache creation failure | \<1% | \>5% (warn) | Vertex CachedContent API issue; proceed uncached | `vertex_context_cache_creation_failure_rate` |
| Cache hit rate (steady-state) | \>50% | \<40% (warn); \<30% (page) | Composite key thrash; teaching\_profile churn | `vertex_context_cache_hit_rate` |
| Mapping write failure post-create | \<0.1% | \>1% (warn) | Cache-mapping inconsistency; orphan via Vertex TTL | `vertex_context_cache_mapping_write_failure_rate` |
| Stale mapping (lookup returns invalidated) | \<2% | \>5% (warn) | LISTEN/NOTIFY lag; reconnect investigation | `vertex_context_cache_miss_on_lookup_rate` |

### **§28.4 Candidate pre-select failures**

| Failure mode | Target rate | Alert at | Recovery action | SLI |
| ----- | ----- | ----- | ----- | ----- |
| Pre-select query timeout (\>200ms) | \<0.5% | \>2% (warn) | DB load on canonical\_questions; skip candidates | `candidate_preselect_timeout_rate` |
| Pre-select empty result | \<5% | \>15% (warn) | Question bank gap for this skill/domain | `candidate_preselect_empty_rate` |
| Model returns invalid slot\_id (hallucination) | \<1% | \>5% (warn) | Model drift; log \+ drop link; turn still succeeds | `vertex_candidate_slot_hallucination_rate` |

### **§28.5 Async job failures**

| Failure mode | Target rate | Alert at | Recovery action | SLI |
| ----- | ----- | ----- | ----- | ----- |
| Compaction job success rate | \>99% | \<97% (warn); \<95% (page) | Investigate via retry/dead-letter rate | `compaction_job_success_rate` |
| Memory refresh job success rate | \>99% | \<97% (warn) | Investigate via retry/dead-letter rate | `memory_refresh_job_success_rate` |
| Pending reconciliation orphaned count | Typically 0/sweep | \>100/sweep (page) | Systematic worker failure investigation | `pending_reconciliation_orphaned_count` |
| Memory refresh pending window P95 | \<30s | \>60s (warn); \>120s (page) | Vertex Flash latency for teaching\_profile gen | `memory_refresh_pending_window_p95` |
| Async job retry rate | \<5% | \>10% (warn) | Handler flakiness; investigate recent deploys | `async_job_retry_rate` |
| Async job dead-letter rate | \<0.01%/hr | Any dead-letter (page) | Permanent task failure; manual investigation | `async_job_dead_letter_rate` |

### **§28.6 Deployment \+ infra failures**

| Failure mode | Target rate | Alert at | Recovery action | SLI |
| ----- | ----- | ----- | ----- | ----- |
| Cloud Run instance crash | \<0.1%/instance/day | \>1%/instance/day (warn) | Investigate logs; possible memory leak | `cloud_run_instance_crash_rate` |
| Cold start P99 latency | \<3000ms | \>5000ms (warn); \>10000ms (page) | Bootstrap regression | `orchestrator_cold_start_latency_p99` |
| Health check failure | \<0.1% | \>1% (page) | Auto-roll-back deploy; investigate revision | `health_check_failure_rate` |
| Deployment revision rollback | Any rollback | Rollback event (info log) | Operational signal; no auto-action | `deployment_rollback_count` |

## **§28A Per-Endpoint Operational Contracts**

Each endpoint gets a complete operational contract.

### **§28A.1 POST /orchestrate/turn (sync mode)**

**Purpose:** Primary turn invocation from 03B. Sync mode (envelope.streaming.enabled \= false).

**Request:**

* Method: `POST`  
* Path: `/orchestrate/turn`  
* Headers: `Content-Type: application/json`, `X-Lyceon-Service: lisa-api`, `X-Lyceon-Timestamp: <unix-millis>`, `X-Lyceon-Signature: <hmac>`, `X-Request-ID: <uuid>`, `X-Correlation-ID: <uuid>`  
* Body: `RequestEnvelope` per §3.2 (schema\_version 1.0)  
* Caller: `lisa-api@PROJECT.iam` only  
* Auth: HMAC per 01A Part VII \+ Cloud Run IAM `roles/run.invoker`

**Response (success, 200):**

* `Content-Type: application/json`  
* Body: `ResponseEnvelope` per §7.1  
* Headers: `X-Request-ID` (echoed), `X-Vertex-Model`, `X-Cache-Used`, `X-Latency-Ms`

**Response (error):**

* 400 `invalid_envelope` / `envelope_bounds_exceeded` / `prompt_too_large` (caller bug)  
* 401 `auth_failed`  
* 422 `vertex_safety_blocked`  
* 429 `vertex_quota_exhausted` (with `Retry-After` header)  
* 502 `structured_output_violation`  
* 503 `vertex_5xx_retriable` (with `Retry-After: 2000ms`)  
* 504 `vertex_timeout` (with `Retry-After: 2000ms`)  
* 500 `internal_error`  
* All error responses: `Content-Type: application/json`, body matches `ErrorEnvelope` per §7.3

**Rate limits:**

* Per-caller (lisa-api): no explicit rate limit at 03C; 03B's own per-user limits apply upstream  
* Per-Cloud-Run-instance: limited by max-concurrent-requests (per §28B)

**Timeout:**

* Server-side hard limit: `runtime_limits.timeout_ms` from envelope (default 8000ms; max 15000ms per §3.4)  
* Plus 1500ms buffer for retry \+ network \= total wall-clock \<= envelope.timeout\_ms \+ 1500ms

**Retry policy:**

* 03C does not retry the inbound request from 03B  
* 03C internally retries Vertex per §5.8 (200ms+jitter; 800ms+jitter; max 2 retries)  
* 03B retries failed 03C calls per 03B V4.1 retry policy

**Idempotency:**

* 03C is non-idempotent; every call is treated as fresh (per §3.5)  
* 03B handles idempotency via §13.7 advisory-lock pattern; by the time 03C is invoked, a fresh attempt is confirmed

**Observability:**

* Logs: structured per 01A Part II; redact prompt/response per §9.5  
* Metrics: §28.1 turn-path SLIs \+ §28.2 Vertex SLIs \+ §28.3 cache SLIs  
* Traces: optional OpenTelemetry; correlation\_id propagated to Vertex labels

**Deployment flag / feature toggle:**

* `vertex.enabled` (boolean; default true) — disable 03C entirely; 03B receives 503 from all calls  
* `vertex.model_override` (per-request via envelope; for A/B traffic)  
* `vertex.pro.enabled` (boolean; default true) — disable Pro routing globally; all turns route to Flash  
* `vertex.streaming.enabled` (boolean; default false) — controlled per-envelope; this flag enables/disables streaming infrastructure

**Rollback procedure:**

* Disable via `vertex.enabled = false` config flag (immediate; no deploy required)  
* Roll back to previous Cloud Run revision: `gcloud run services update-traffic lisa-orchestrator --to-revisions=<prev-revision>=100` (single-step rollback, \~30s to complete)  
* Health check failure auto-rollback: not enabled in V2.0; manual ops decision

### **§28A.2 POST /orchestrate/turn (streaming mode)**

**Purpose:** Same as §28A.1 but with `envelope.streaming.enabled = true`. Returns SSE stream.

**Differences from §28A.1:**

* `Content-Type: text/event-stream; charset=utf-8`  
* `Cache-Control: no-cache`  
* `Connection: keep-alive`  
* `Transfer-Encoding: chunked`  
* Response body: SSE event stream per §7.4  
* Error response: if streaming has not started, returns standard JSON error per §28A.1; if streaming has started, emits `error` event then closes connection  
* Client (03B) must handle stream termination: connection close after final `done` event OR after `error` event

**Rate limits, timeout, retry, idempotency:** same as §28A.1.

**Deployment flag:**

* Per-envelope opt-in via `streaming.enabled`; 03B controls per-turn  
* Global disable: `vertex.streaming.enabled = false` causes 03C to ignore the envelope flag and always return sync

**Rollback procedure:** same as §28A.1.

### **§28A.3 POST /async/compaction**

**Purpose:** Compaction job handler invoked by Cloud Tasks queue `lisa-compaction`.

**Request:**

* Method: `POST`  
* Path: `/async/compaction`  
* Headers: `Content-Type: application/json`, `Authorization: Bearer <oidc-token>` (Cloud Tasks-issued)  
* Body: `CompactionTask` per §8.3  
* Caller: Cloud Tasks (with `lisa-cloud-tasks@PROJECT.iam` SA via OIDC)  
* Auth: OIDC token validation \+ Cloud Run IAM `roles/run.invoker`

**Response (success, 200):**

* Empty body or `{}` (Cloud Tasks does not consume response body)

**Response (error):**

* 400 invalid task payload (Cloud Tasks may retry but unlikely to succeed)  
* 401 OIDC validation failure  
* 500 handler failure (Cloud Tasks retries per queue policy)

**Rate limits:**

* Queue-level: 100 req/s per §8.2  
* Per-instance: limited by Cloud Run max-concurrent-requests

**Timeout:**

* Cloud Tasks task deadline: 15 minutes per §8.2  
* Handler timeout: 10 minutes per §8.3 (allows Vertex generation up to \~5min \+ DB writes)

**Retry policy:**

* Per Cloud Tasks queue policy: max 5 retries, 5s-300s exponential backoff  
* Idempotent: duplicate `(conversation_id, trigger_reason)` produces same summary

**Idempotency:**

* Idempotency key: `(conversation_id, trigger_reason)`  
* Duplicate execution overwrites previous summary; no harm

**Observability:**

* Logs: structured; correlation\_id from task payload  
* Metrics: `compaction_job_*` SLIs per §28.5

**Deployment flag:**

* `compaction.enabled` (boolean; default true) — disable compaction handler; Cloud Tasks tasks dead-letter

**Rollback procedure:**

* Disable: `compaction.enabled = false` (tasks dead-letter; manual replay later)  
* Roll back Cloud Run revision per §28A.1 procedure  
* Cloud Tasks queue purge: `gcloud tasks queues purge lisa-compaction` (emergency only; loses pending tasks)

### **§28A.4 POST /async/memory-refresh**

**Purpose:** Memory refresh job handler (placeholder-then-fill pattern per §8.4) invoked by Cloud Tasks queue `lisa-memory-refresh`.

**Request:**

* Method: `POST`  
* Path: `/async/memory-refresh`  
* Headers: `Content-Type: application/json`, `Authorization: Bearer <oidc-token>`  
* Body: `MemoryRefreshTask` per §8.4  
* Caller: Cloud Tasks (`lisa-cloud-tasks@PROJECT.iam`)  
* Auth: OIDC validation \+ Cloud Run IAM `roles/run.invoker`

**Response:**

* 200 success (empty body)  
* 4xx/5xx errors per §28A.3 pattern

**Rate limits:**

* Queue-level: 50 req/s per §8.2  
* Per-student: serialized via advisory lock (§8.4.5)

**Timeout:**

* Cloud Tasks deadline: 15 minutes  
* Handler timeout: 5 minutes (Vertex generation typically \<60s; buffer for retries)  
* Advisory lock held for full duration

**Retry policy:**

* Per Cloud Tasks queue: max 5 retries, exponential backoff  
* Handler is idempotent under advisory lock: concurrent retries fast-fail; failed pending rows are reconciled

**Idempotency:**

* Idempotency key: `(student_id, summary_type, trigger_reason)` for the same task; advisory lock prevents concurrent execution  
* Pending row uniqueness: enforced by `(student_id, summary_type, summary_version)` natural key

**Observability:**

* Logs: structured; correlation\_id from task  
* Metrics: `memory_refresh_*` SLIs per §28.5; `memory_refresh_pending_window_p95` per §8.4.7

**Deployment flag:**

* `memory_refresh.enabled` (boolean; default true) — disable handler  
* `memory_refresh.pending_timeout_minutes` (integer; default 10\) — reconciliation threshold

**Rollback procedure:**

* Disable: `memory_refresh.enabled = false` (tasks dead-letter; teaching\_profiles staleness grows; nightly schedule resumes when re-enabled)  
* Cloud Run revision rollback per §28A.1  
* Schema migration rollback (if `status` column needs removal): documented in §29 with explicit rollback steps

### **§28A.5 POST /async/pending-reconciliation (V2.0 NEW)**

**Purpose:** Pending-row reconciliation sweep handler invoked by Cloud Tasks queue `lisa-pending-reconciliation`.

**Request:**

* Method: `POST`  
* Path: `/async/pending-reconciliation`  
* Headers: `Content-Type: application/json`, `Authorization: Bearer <oidc-token>`  
* Body: `PendingReconciliationTask` per §8.4-NEW.2  
* Caller: Cloud Tasks (`lisa-cloud-tasks@PROJECT.iam`)  
* Auth: OIDC validation \+ Cloud Run IAM `roles/run.invoker`

**Response:**

* 200 success (empty body)  
* 4xx/5xx errors per §28A.3 pattern

**Rate limits:**

* Queue-level: 10 req/s per §8.2 (very low; cloud\_scheduler triggers at 5min cadence)

**Timeout:**

* Cloud Tasks deadline: 15 minutes  
* Handler timeout: 5 minutes (typically completes in \<30 seconds; bounded by max\_sweep\_rows)

**Retry policy:**

* Per Cloud Tasks queue: max 5 retries  
* Handler is idempotent: re-running the sweep produces same result (each pending row update is conditional on `status = 'pending'`)

**Idempotency:**

* Idempotent at row level; concurrent sweeps would each find disjoint sets of pending rows (or identical sets with conditional updates)

**Observability:**

* Logs: structured; correlation\_id  
* Metrics: `pending_reconciliation_*` SLIs per §28.5

**Deployment flag:**

* `pending_reconciliation.enabled` (boolean; default true) — disable sweep  
* `reconciliation.schedule_interval_minutes` (integer; default 5\) — sweep cadence  
* `reconciliation.max_sweep_rows` (integer; default 100\) — per-sweep batch size

**Rollback procedure:**

* Disable: `pending_reconciliation.enabled = false` (orphaned pending rows accumulate; manual cleanup needed if disabled long term)  
* Cloud Scheduler job pause: `gcloud scheduler jobs pause lisa-pending-reconciliation-trigger`  
* Cloud Run revision rollback per §28A.1

## **§28B Cloud Run Operational Contract**

### **§28B.1 Service inventory**

| Service | Image | Min instances | Max instances | Memory | CPU | Concurrency |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| `lisa-orchestrator` | `gcr.io/PROJECT/lisa-orchestrator:VERSION` | 1 | 50 | 1 GiB | 1 vCPU | 80 (max-concurrent-requests) |
| `lisa-memory-worker` | `gcr.io/PROJECT/lisa-memory-worker:VERSION` | 0 | 20 | 2 GiB | 1 vCPU | 10 |

**Min instances 1 for orchestrator:** keeps one warm instance to absorb cold-start latency on first requests after idle periods. Cost: \~$8-15/mo for one always-warm instance; acceptable for user-facing latency benefit.

**Min instances 0 for memory worker:** async jobs tolerate cold start (\<5s P99 acceptable); cost optimization wins.

### **§28B.2 Cold start**

**Targets:**

* Orchestrator P99 cold start: \<3000ms (CI gate; deploy fails if exceeded)  
* Memory worker P99 cold start: \<5000ms (operational target; not CI-gated)

**Bootstrap sequence at cold start:**

1. Load runtime config from Supabase (\~200ms)  
2. Initialize Vertex SDK with service account (\~500ms)  
3. Load system prompt templates from container image (\~50ms; baked in at build)  
4. Establish DB connection pool (\~300ms; warm pool of 5 connections)  
5. Health endpoint returns 200 (after all above)

Total bootstrap budget: \~1100ms. Buffer of \~1900ms before P99 target for jitter.

**CI gate:** during deployment, automated test invokes new revision 100 times after cold start; P99 latency must be \<3000ms or deployment fails (manual override allowed for emergencies).

### **§28B.3 Scaling**

**Orchestrator:**

* Auto-scale based on `request_count_per_instance` metric  
* Scale up: when concurrent requests per instance \> 60 (75% of 80 max) sustained for 30s  
* Scale down: when concurrent requests per instance \< 20 sustained for 5min  
* Max 50 instances (peak capacity \~4000 concurrent requests; well above expected V2.0 launch traffic)

**Memory worker:**

* Auto-scale based on Cloud Tasks queue depth \+ concurrent invocations  
* Scale up: queue depth \> 50 OR concurrent \> 8 per instance  
* Scale down: idle for 2min  
* Max 20 instances (sufficient for bulk-refresh scenarios)

### **§28B.4 Health checks**

**Orchestrator `/health` endpoint:**

* Returns 200 with body `{"status": "ready"}` when bootstrap complete and dependencies reachable  
* Returns 503 with body `{"status": "degraded", "reason": "<dep>"}` if any dependency unreachable  
* Health check probe: every 10s; 3 consecutive failures → instance unhealthy

**Dependency checks:**

* DB connection (1s timeout)  
* Vertex API reachable (3s timeout; uses lightweight metadata fetch, not actual model call)  
* Secret Manager accessible (1s timeout; reads HMAC signing key)

**Memory worker `/health` endpoint:**

* Same shape; reduced dependency check (no Vertex check at health time; checked at job time)

### **§28B.5 Graceful shutdown**

**SIGTERM handling:**

* Cloud Run sends SIGTERM 10s before shutdown  
* Orchestrator: stop accepting new requests; complete in-flight requests up to 10s; emit shutdown log  
* Memory worker: complete in-flight job up to 30s (request Cloud Run prestop hook for extended grace); release advisory locks; emit shutdown log

**In-flight request handling:**

* Orchestrator: in-flight Vertex calls continue; if not complete by 10s, return 504 to caller (03B retries)  
* Memory worker: in-flight job tries to complete T2 fill if mid-job; if not complete, advisory lock auto-releases; reconciliation handles cleanup

### **§28B.6 Deployment rollout (blue-green)**

**Standard rollout:**

1. Build new container image; tag with version  
2. Deploy new revision with `--no-traffic` (0% traffic)  
3. Run CI smoke tests against new revision URL  
4. Cold-start test (§28B.2 CI gate)  
5. Shift traffic in single step: `--to-revisions=NEW=100`  
6. Monitor SLIs for 15 minutes  
7. If SLIs degraded: rollback to prev revision

**Canary rollout (optional, for risky changes):**

1. Deploy new revision with `--no-traffic`  
2. Smoke tests \+ cold-start gate  
3. Shift 10% traffic: `--to-revisions=NEW=10,PREV=90`  
4. Monitor 30 minutes; check SLIs  
5. If healthy: shift to 50%, monitor 30min  
6. If healthy: shift to 100%  
7. If degraded at any step: rollback

### **§28B.7 Rollback procedure**

**Standard rollback (revision rollback):**

* Single command: `gcloud run services update-traffic lisa-orchestrator --to-revisions=PREV=100`  
* \~30 seconds to complete  
* No DB state change required (V2.0 handler is backward-compat with prev revision)

**Schema migration rollback:**

* If `tutor_memory_summaries.status` column rollback needed (extreme case): documented in §29.2  
* Generally avoided; column addition is forward-compatible  
* If V2.0 reverts to V1.2 entirely: column stays in DB (harmless; defaults to `'ready'`)

### **§28B.8 Configuration management**

**Runtime config (read at startup \+ LISTEN/NOTIFY):**

* Read from Supabase `tutor_context_runtime_config` table per 03A V3 §18.7  
* LISTEN for changes; reload on NOTIFY  
* Specific keys: per §30 configuration reference

**Build-time config:**

* Vertex project ID, region, GCP project (immutable per environment via `.env.{env}` files baked into image)  
* Container image metadata  
* Cloud Run service name

**Secret config:**

* HMAC signing key: Secret Manager mount per 01A §64  
* No other secrets in 03C

## **§28C Isolation Levels Per DB Interaction**

Every DB read/write 03C performs is mapped to: transaction boundary, isolation level, locking strategy, behavior on serialization failure.

### **§28C.1 Vertex context cache lookup (§6.4)**

**Operation:** `SELECT vertex_cached_content_name FROM tutor_vertex_context_cache WHERE ... LIMIT 1`

| Property | Value |
| ----- | ----- |
| Transaction boundary | Implicit single-statement (no explicit BEGIN) |
| Isolation level | READ COMMITTED (Postgres default) |
| Locking | None (no FOR UPDATE) |
| Stale read tolerance | Acceptable; if cache entry was just invalidated, lookup may return invalidated row → mitigated by `WHERE invalidated_at IS NULL` filter |
| Serialization failure | Not possible (READ COMMITTED, no locking) |
| Timeout | 100ms hard ceiling per §6.4 |

### **§28C.2 Vertex context cache creation (§6.5)**

**Operation:** `INSERT INTO tutor_vertex_context_cache ... ON CONFLICT (cache_kind, cache_key) DO UPDATE SET ... WHERE invalidated_at IS NOT NULL OR expires_at < now()`

| Property | Value |
| ----- | ----- |
| Transaction boundary | Implicit single-statement |
| Isolation level | READ COMMITTED |
| Locking | Row-level lock acquired on conflict (Postgres internal) |
| Stale read tolerance | N/A (write operation) |
| Serialization failure | Not possible at READ COMMITTED for INSERT...ON CONFLICT |
| Timeout | 1000ms target per §28.3 SLI |

### **§28C.3 Candidate pre-select (§5.9.2)**

**Operation:** `SELECT ... FROM canonical_questions WHERE section = $1 AND domain = $2 ... ORDER BY ... LIMIT 5`

| Property | Value |
| ----- | ----- |
| Transaction boundary | Implicit single-statement |
| Isolation level | READ COMMITTED |
| Locking | None |
| Stale read tolerance | Acceptable; question bank changes are rare |
| Serialization failure | Not possible |
| Timeout | 200ms hard ceiling per §5.9.2 |

### **§28C.4 Memory refresh T1 (§8.4.1) — V2.1 hardened version-computation**

**Operation:** Multi-statement transaction: SELECT MAX version (FOR UPDATE) \+ UPDATE invalidate \+ INSERT pending row \+ NOTIFY

BEGIN;  
  \-- V2.1 review-swipe: FOR UPDATE on version computation prevents concurrent  
  \-- T1s on the same student from racing to the same MAX+1 (defense-in-depth  
  \-- against advisory lock failure; would otherwise produce two rows with same  
  \-- summary\_version and break the natural-key uniqueness assumption).  
  SELECT COALESCE(MAX(summary\_version), 0\) \+ 1 AS new\_version  
  FROM tutor\_memory\_summaries  
  WHERE student\_id \= $1 AND summary\_type \= $2  
  FOR UPDATE;

  UPDATE tutor\_vertex\_context\_cache SET invalidated\_at \= now()  
    WHERE cache\_kind \= 'student\_composite' AND cache\_key LIKE '%:' || $1 || ':%' AND invalidated\_at IS NULL;

  INSERT INTO tutor\_memory\_summaries (..., status) VALUES (..., 'pending');

  SELECT pg\_notify('teaching\_profile\_updated', $3);  
COMMIT;

| Property | Value |
| ----- | ----- |
| Transaction boundary | Explicit BEGIN/COMMIT |
| Isolation level | READ COMMITTED |
| Locking | (1) Advisory lock on `student_id` hash held at session scope outside transaction (§8.4.2; primary concurrency control); (2) FOR UPDATE row lock on version-computation query (V2.1 defense-in-depth against advisory lock failure) |
| Stale read tolerance | N/A (write operation) |
| Serialization failure | Not possible at READ COMMITTED. FOR UPDATE blocks (does not error) if a concurrent T1 holds the row lock; advisory lock should prevent reaching this state but FOR UPDATE is the safety net |
| Idempotency within tx | UPDATE is conditional (filters non-invalidated rows); INSERT relies on unique constraint on `(student_id, summary_type, summary_version)` to detect dup writes (handler treats unique-violation as concurrency loss and aborts) |
| Performance impact of FOR UPDATE | Negligible (\~1 row locked for \<100ms transaction window) |

### **§28C.5 Memory refresh T2 (§8.4.4)**

**Operation:** Conditional UPDATE on pending row to fill content \+ mark ready

UPDATE tutor\_memory\_summaries  
  SET content\_json \= $1, status \= 'ready', source\_window\_start \= $2, source\_window\_end \= $3  
  WHERE student\_id \= $4 AND summary\_type \= $5 AND summary\_version \= $6 AND status \= 'pending';

| Property | Value |
| ----- | ----- |
| Transaction boundary | Implicit single-statement |
| Isolation level | READ COMMITTED |
| Locking | Row-level on UPDATE target (Postgres internal) |
| Stale read tolerance | N/A |
| Serialization failure | Not possible |
| Idempotency | Conditional on `status = 'pending'`; if row was reconciled to `failed` between T1 and T2, UPDATE matches 0 rows; handler logs warning and exits successfully |

### **§28C.6 Memory refresh advisory lock (§8.4.5)**

**Operation:** `SELECT pg_try_advisory_lock(hashtext($student_id))`

| Property | Value |
| ----- | ----- |
| Transaction boundary | Session-level lock (NOT transaction-scoped) |
| Isolation level | N/A |
| Locking | Postgres advisory lock at session level |
| Acquisition behavior | Non-blocking; returns false if held |
| Release behavior | Explicit `pg_advisory_unlock` in `finally` block; auto-released on connection close (Cloud Run instance death) |
| Hash collision risk | int4 hash; \~1 in 2^32; acceptable for V2.0 scale |

### **§28C.7 Compaction job (§8.3 / 03A V3 §14)**

**Operation:** Transaction varies based on 03A V3 §14 specification (03C executes 03A-owned algorithm)

| Property | Value (V2.0 baseline; defer to 03A V3 §14 for actual) |
| ----- | ----- |
| Transaction boundary | Per 03A V3 §14 spec (typically: load conversation history \+ write summary in single transaction) |
| Isolation level | READ COMMITTED |
| Locking | None (compaction is per-conversation; concurrent compaction of different conversations is parallel) |
| Stale read tolerance | Conversation history is append-only; stale read means missing latest message but next compaction trigger covers it |
| Serialization failure | Not possible |

### **§28C.8 Pending reconciliation sweep (§8.4-NEW.3)**

**Operation:** SELECT pending rows \+ per-row UPDATE \+ per-row enqueue

SELECT id, student\_id, summary\_type, ... FROM tutor\_memory\_summaries  
  WHERE status \= 'pending' AND created\_at \< now() \- interval '$threshold minutes'  
  ORDER BY created\_at ASC LIMIT $max\_sweep;

\-- Per row:  
UPDATE tutor\_memory\_summaries SET status \= 'failed' WHERE id \= $1 AND status \= 'pending';

| Property | Value |
| ----- | ----- |
| Transaction boundary | Each row update is independent (no overall transaction) |
| Isolation level | READ COMMITTED |
| Locking | None on SELECT; row-level on UPDATE (atomic conditional update) |
| Stale read tolerance | Acceptable; if row transitioned to `ready` concurrently, conditional UPDATE matches 0 rows and is silently skipped |
| Serialization failure | Not possible |
| Concurrency | Concurrent sweeps would find disjoint sets due to advisory locks held by active workers; safe |

## **§29 Schema Migrations (V2.0)**

V2.0 introduces two schema changes. Both are forward-compatible (V1.x still works with new schema).

### **§29.1 `tutor_vertex_context_cache.cache_kind` CHECK constraint expansion**

**Migration:** add `'student_composite'` to allowed values.

\-- Migration: 03C-V2-01-cache-kind-expand.sql  
\-- Owner: 03B V5 (table owner) OR 03C V2.0 deployment if 03B V5 not yet shipped  
\-- Idempotent (safe to re-run)

DO $$  
BEGIN  
  \-- Drop existing constraint  
  IF EXISTS (  
    SELECT 1 FROM information\_schema.table\_constraints  
    WHERE table\_name \= 'tutor\_vertex\_context\_cache'  
      AND constraint\_name \= 'tutor\_vertex\_context\_cache\_cache\_kind\_check'  
  ) THEN  
    ALTER TABLE tutor\_vertex\_context\_cache  
      DROP CONSTRAINT tutor\_vertex\_context\_cache\_cache\_kind\_check;  
  END IF;

  \-- Add new constraint with student\_composite  
  ALTER TABLE tutor\_vertex\_context\_cache  
    ADD CONSTRAINT tutor\_vertex\_context\_cache\_cache\_kind\_check  
    CHECK (cache\_kind IN (  
      'system\_prompt',         \-- Legacy V1; not used in V1.1+  
      'teaching\_profile',      \-- Legacy V1; not used in V1.1+  
      'canonical\_question',    \-- Legacy V1; not used in V1.1+  
      'student\_composite'      \-- V1.1+ per §6.2  
    ));

  COMMENT ON COLUMN tutor\_vertex\_context\_cache.cache\_kind IS  
    'Cache kind discriminator. V1.1+ uses student\_composite; legacy values retained for backward compatibility during migration.';  
END $$;

**Rollback procedure:**

* If V2.0 reverts to V1.2: legacy values remain valid; no rollback needed  
* If reverting to original V1 schema: drop and recreate constraint without `'student_composite'`; ensure no rows with that value exist first

### **§29.2 `tutor_memory_summaries.status` column addition**

**Migration:** add `status` column with default `'ready'`.

\-- Migration: 03C-V2-02-memory-summaries-status.sql  
\-- Owner: 03A V3.1 (table owner per 03A V3 §7) OR 03C V2.0 if 03A V3.1 not yet shipped  
\-- Idempotent

DO $$  
BEGIN  
  IF NOT EXISTS (  
    SELECT 1 FROM information\_schema.columns  
    WHERE table\_name \= 'tutor\_memory\_summaries' AND column\_name \= 'status'  
  ) THEN  
    ALTER TABLE tutor\_memory\_summaries  
      ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'  
        CHECK (status IN ('pending', 'ready', 'failed'));

    \-- Index for reconciliation queries (efficient sweep of pending rows)  
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx\_tutor\_memory\_summaries\_pending  
      ON tutor\_memory\_summaries (created\_at)  
      WHERE status \= 'pending';

    COMMENT ON COLUMN tutor\_memory\_summaries.status IS  
      'Per 03C V2.0 §8.4 placeholder-then-fill: pending \= row inserted with empty content awaiting Vertex generation; ready \= content filled and usable; failed \= generation failed permanently, awaiting reconciliation cleanup';  
  END IF;  
END $$;

**Rollback procedure:**

* Generally avoided (column is additive)  
* If forced: requires deleting all `pending` and `failed` rows first, then `DROP COLUMN status`; reverts behavior to V1.x where rows are always complete

### **§29.3 Migration deployment ordering (V2.1 — BLK-V2-05 production ship gates)**

V2.1 explicitly does **not** ship to production standalone. Production deployment is a coordinated sequence:

**Pre-deployment gates (must complete before 03C V2.1 can ship):**

1. **Doc 03C.1 Test Matrix shipped** — defines acceptance criteria for §28 failure modes; engineering must verify before launch  
2. **Doc 03C Operations Runbook shipped** — defines step-by-step deploy/IAM/monitoring procedures; ops must have runbook before launch  
3. **Schema migrations §29.1 and §29.2 deployed** — both forward-compatible with V1.x readers; safe to deploy any time prior to V2.1 ship  
4. **03B envelope-builder hotfix patch deployed** — must add `WHERE status = 'ready'` filter to envelope query (per §8.4.3 \+ §32.1). This is the critical cross-doc dependency. The patch is small (\~3 lines) and forward-compatible against current schema before §29.2 migration; can deploy independently of full 03B V5

**Deployment sequence (executable order):**

| Step | Action | Owner | Verification | Rollback if step fails |
| ----- | ----- | ----- | ----- | ----- |
| 0 | Test Matrix \+ Ops Runbook published; engineering \+ ops sign-off | Eng \+ Ops | Both docs in `/mnt/user-data/outputs` and reviewed | Defer launch |
| 1 | Migration §29.1 (`cache_kind` CHECK expansion) deployed to staging | Platform | `\d+ tutor_vertex_context_cache` shows new constraint | DROP CONSTRAINT, restore old |
| 2 | Migration §29.1 deployed to production | Platform | Same as step 1 | Same as step 1 |
| 3 | Migration §29.2 (`status` column addition) deployed to staging | Platform | `\d+ tutor_memory_summaries` shows status column with default 'ready' | ALTER TABLE DROP COLUMN |
| 4 | Migration §29.2 deployed to production | Platform | Same as step 3 | Same as step 3 |
| 5 | 03B envelope-builder hotfix deployed to staging (filter added) | LISA team | Envelope query SQL audit shows `WHERE status = 'ready'`; existing reads still work | Revert to prior 03B revision |
| 6 | 03B envelope-builder hotfix deployed to production | LISA team | Same as step 5 | Same as step 5 |
| 7 | 03C V2.1 deployed to staging with 0% production traffic | Platform | Health checks pass; smoke test happy path | gcloud run services update-traffic to prior revision |
| 8 | 03C V2.1 canary deployment: 5% production traffic | Platform | Failure matrix SLIs (§28) within target rates over 1-hour observation window | Traffic shift to prior revision |
| 9 | 03C V2.1 ramp: 25%, 50%, 100% production traffic at 1-hour intervals | Platform | SLIs continue within target | Traffic shift to prior revision |
| 10 | Cloud Scheduler trigger for `lisa-pending-reconciliation` enabled | Platform | First sweep runs; `memory_refresh_orphaned_pending_count` reads as 0 (or expected baseline) | Disable Cloud Scheduler trigger |

**Rollback boundary:** any step fails → halt sequence; execute step-specific rollback. Roll-forward is preferred over roll-back once steps 5-6 (03B hotfix) have shipped, because 03B hotfix is forward-compatible — V1.x rows continue to work with status filter. Steps 1-4 (schema migrations) are also forward-compatible. Only steps 7-10 (03C V2.1 itself) require traffic-shift rollback.

**Critical dependency chain visualization:**

\[Doc 03C.1 Test Matrix\] ─┐  
\[Ops Runbook\]            ├─→ \[Schema migrations §29.1 \+ §29.2\]  
                         │           ↓  
                         │   \[03B envelope hotfix\]  
                         │           ↓  
                         └─→ \[03C V2.1 canary\]  
                                     ↓  
                             \[03C V2.1 ramp to 100%\]  
                                     ↓  
                             \[Pending reconciliation enabled\]

**Without step 6 (03B hotfix):** during V2.1 ramp, 03B may briefly read pending rows (with empty content) and serve degraded prompts until reconciliation — privacy-incident-adjacent (no PII exposure but bad UX). **Not acceptable for prod rollout.**

**V2.1 ship status (per external review verdict):**

* ✅ Spec: APPROVED for engineering implementation  
* ⏸️ Production ship: GATED on companion artifacts \+ cross-doc patches  
* 🔄 V3 candidate: full consolidated hardening pass produces matched 03B V5 / 03A V3.1 (replaces 03B hotfix with proper V5 update)

## **§30 Configuration Reference**

Every tunable value consolidated. Source: `tutor_context_runtime_config` table (read at Cloud Run bootstrap \+ LISTEN/NOTIFY for live updates) per 03A V3 §18.7. Some values are env-variable overrides at build time; flagged where applicable.

### **§30.1 Vertex configuration**

| Key | Default | Min | Max | Source | Who decides |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `vertex.model.flash` | `gemini-2.5-flash` | — | — | Runtime config | Platform team (model upgrades) |
| `vertex.model.pro` | `gemini-2.5-pro` | — | — | Runtime config | Platform team |
| `vertex.enabled` | `true` | — | — | Runtime config | Ops (kill switch) |
| `vertex.pro.enabled` | `true` | — | — | Runtime config | Ops (cost control) |
| `vertex.pro.daily_budget_usd` | `200` | `0` | unbounded | Runtime config | Finance \+ Platform |
| `vertex.pro.budget_circuit_breaker_enabled` | `true` | — | — | Runtime config | Ops |
| `vertex.pro.budget_circuit_breaker_warning_pct` | `80` | `0` | `100` | Runtime config | Ops |
| `vertex.streaming.enabled` | `false` | — | — | Runtime config | Platform (streaming infra toggle) |
| `vertex.circuit_breaker.error_rate_threshold` | `0.5` | `0` | `1` | Runtime config | Platform |
| `vertex.circuit_breaker.window_seconds` | `60` | `10` | `600` | Runtime config | Platform |
| `vertex.circuit_breaker.trip_duration_seconds` | `30` | `5` | `300` | Runtime config | Platform |
| `vertex.circuit_breaker.warmup_request_count` | `10` | `0` | `1000` | Runtime config | Platform |

### **§30.2 Generation parameters**

| Key | Default | Min | Max | Source | Who decides |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `vertex.generation.temperature` | `0.3` | `0` | `2` | Runtime config | Platform (prompt tuning) |
| `vertex.generation.top_p` | `0.95` | `0` | `1` | Runtime config | Platform |
| `runtime_limits.max_output_tokens` | `600` | `1` | `2000` | Per-request envelope | 03B caller |
| `runtime_limits.timeout_ms` | `8000` | `1000` | `15000` | Per-request envelope | 03B caller |
| `prompt.max_tokens` | `16000` | `1000` | `32000` | Runtime config | Platform |
| `prompt.null_substitution` | `"n/a"` | — | — | Runtime config | Platform |

### **§30.3 Cache configuration**

| Key | Default | Min | Max | Source | Who decides |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `cache.composite.ttl_seconds` | `3600` | `300` | `86400` | Runtime config | Platform |
| `cache.lookup.timeout_ms` | `100` | `10` | `1000` | Runtime config | Platform |
| `cache.creation.timeout_ms` | `2000` | `100` | `10000` | Runtime config | Platform |

### **§30.4 Async job configuration**

| Key | Default | Min | Max | Source | Who decides |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `compaction.enabled` | `true` | — | — | Runtime config | Ops |
| `compaction.timeout_seconds` | `600` | `60` | `900` | Runtime config | Platform |
| `memory_refresh.enabled` | `true` | — | — | Runtime config | Ops |
| `memory_refresh.timeout_seconds` | `300` | `60` | `900` | Runtime config | Platform |
| `memory_refresh.pending_timeout_minutes` | `10` | `2` | `60` | Runtime config | Platform |
| `pending_reconciliation.enabled` | `true` | — | — | Runtime config | Ops |
| `reconciliation.schedule_interval_minutes` | `5` | `1` | `60` | Cloud Scheduler | Platform |
| `reconciliation.max_sweep_rows` | `100` | `10` | `10000` | Runtime config | Platform |

### **§30.5 Build-time configuration**

| Key | Source | Notes |
| ----- | ----- | ----- |
| `GCP_PROJECT_ID` | Env var | Per-environment value baked at deploy time |
| `VERTEX_PROJECT_ID` | Env var | Per-environment Vertex project |
| `VERTEX_REGION` | Env var | Default: `us-central1` |
| `LISA_ENV` | Env var | \`production |
| `IMAGE_VERSION` | Build metadata | Used in observability tags |

### **§30.6 Secret configuration**

| Key | Source | Rotation |
| ----- | ----- | ----- |
| `HMAC_SIGNING_KEY` | Secret Manager mount | 90 days per 01A §65; 14-day overlap |

### **§30.7 Safety / PII guard configuration (V2.1 — BLK-V2-03)**

| Key | Default | Min | Max | Source | Who decides |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `pii_guard.enabled` | `true` | — | — | Runtime config | Platform (emergency disable only) |
| `pii_guard.warn_severity_blocks` | `false` | — | — | Runtime config | Platform |
| `safety.vertex_blocking_categories` | `["sexually_explicit"]` (BLOCK\_LOW\_AND\_ABOVE) | — | — | Runtime config | Platform \+ Safety review |
| `safety.vertex_default_threshold` | `BLOCK_MEDIUM_AND_ABOVE` | — | — | Runtime config | Platform |

### **§30.8 Generation parameter overrides (V2.1 review-swipe)**

| Key | Default | Min | Max | Source | Who decides |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `generation.temperature` | `0.3` | `0` | `1` | Runtime config | Platform (model tuning) |
| `generation.top_p` | `0.95` | `0` | `1` | Runtime config | Platform |
| `generation.top_k` | `40` | `1` | `1000` | Runtime config | Platform |
| `generation.seed_in_debug` | `null` (production); `12345` (debug builds) | — | — | Build-time \+ envelope override | Platform / per-debug-run |

**`generation.seed_in_debug` semantics:** when `envelope.runtime_limits.debug_seed` is set (non-null), 03C passes `seed` parameter to Vertex for deterministic regeneration. Production traffic always has `debug_seed: null`. Debug-run traffic for incident replay can specify a seed; same seed \+ same prompt → same Vertex output (subject to Vertex's deterministic-mode availability per model).

## **§31 Schema Reference**

Authoritative shapes for tables 03C reads/writes. Marked "authoritative source" for cross-doc tracking; this section provides V2.0-self-contained reference.

### **§31.1 `tutor_vertex_context_cache` (authoritative: 03B §27E)**

CREATE TABLE tutor\_vertex\_context\_cache (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  cache\_kind TEXT NOT NULL CHECK (cache\_kind IN (  
    'system\_prompt', 'teaching\_profile', 'canonical\_question', 'student\_composite'  
  )),  
  cache\_key TEXT NOT NULL,  
  student\_id UUID,                                      \-- nullable; non-null for student-scoped caches  
  vertex\_cached\_content\_name TEXT NOT NULL,             \-- Vertex CachedContent resource name  
  expires\_at TIMESTAMPTZ NOT NULL,                      \-- Vertex-side TTL expiration  
  invalidated\_at TIMESTAMPTZ,                           \-- nullable; set when underlying data changes  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  UNIQUE (cache\_kind, cache\_key)  
);

CREATE INDEX idx\_tvcc\_kind\_key ON tutor\_vertex\_context\_cache (cache\_kind, cache\_key)  
  WHERE invalidated\_at IS NULL AND expires\_at \> now();

CREATE INDEX idx\_tvcc\_expires ON tutor\_vertex\_context\_cache (expires\_at)  
  WHERE invalidated\_at IS NULL;

03C interactions:

* **Read** (§6.4): SELECT with cache\_kind \+ cache\_key \+ invalidated\_at \+ expires\_at filters  
* **Write** (§6.5): INSERT ... ON CONFLICT for cache creation  
* **Read** (§8.4.4 T1): UPDATE invalidated\_at \= now() during memory refresh  
* **No DELETE** from 03C; pg\_cron handles expiration cleanup per 03B §27E

### **§31.2 `tutor_memory_summaries` (authoritative: 03A V3 §7; V2.0 adds `status` column)**

CREATE TABLE tutor\_memory\_summaries (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  student\_id UUID NOT NULL,  
  summary\_type TEXT NOT NULL CHECK (summary\_type IN (  
    'teaching\_profile', 'chat\_compaction', 'recent\_learning\_pattern', 'study\_context'  
  )),  
  summary\_version INTEGER NOT NULL,  
  content\_json JSONB NOT NULL,                          \-- compacted summary content  
  status TEXT NOT NULL DEFAULT 'ready'                  \-- V2.0 addition per §29.2  
    CHECK (status IN ('pending', 'ready', 'failed')),  
  source\_window\_start TIMESTAMPTZ,  
  source\_window\_end TIMESTAMPTZ,  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  UNIQUE (student\_id, summary\_type, summary\_version)  
);

CREATE INDEX idx\_tms\_student\_type\_version  
  ON tutor\_memory\_summaries (student\_id, summary\_type, summary\_version DESC)  
  WHERE status \= 'ready';

CREATE INDEX idx\_tms\_pending                            \-- V2.0 per §29.2  
  ON tutor\_memory\_summaries (created\_at)  
  WHERE status \= 'pending';

03C interactions:

* **Write** (§8.3 compaction): INSERT new chat\_compaction summary  
* **Write** (§8.4.4 T1): INSERT new teaching\_profile summary with status \= 'pending'  
* **Write** (§8.4.4 T2): UPDATE pending row to status \= 'ready' with content  
* **Write** (§8.4-NEW.3): UPDATE pending row to status \= 'failed' on reconciliation  
* **Read** (§8.4-NEW.3): SELECT pending rows older than threshold

### **§31.3 `canonical_questions` (authoritative: 02B §X)**

V2.0 read-only access for candidate pre-select (§5.9.2). 03C consumes a subset of columns:

\-- 03C reads these columns (full table schema in 02B):  
SELECT  
  id,                                                   \-- UUID question\_row\_id  
  canonical\_id,                                         \-- Lyceon canonical question ID  
  section,                                              \-- 'rw' | 'math'  
  domain,                                               \-- e.g., 'algebra', 'reading'  
  skill,                                                \-- e.g., 'linear\_equations'  
  subskill,                                             \-- nullable; e.g., 'word\_problems'  
  difficulty                                            \-- integer 1-5  
FROM canonical\_questions

03C interactions:

* **Read only** (§5.9.2): SELECT for candidate pre-select with section/domain/skill/difficulty filters

### **§31.4 `student_question_attempts` (authoritative: 02C §X)**

V2.0 read-only access for "not recently attempted" filter in candidate pre-select.

\-- 03C reads these columns (full table schema in 02C):  
SELECT  
  student\_id,  
  question\_row\_id,  
  attempted\_at  
FROM student\_question\_attempts  
WHERE student\_id \= $1 AND question\_row\_id \= $2 AND attempted\_at \> now() \- interval '30 days'

03C interactions:

* **Read only** (§5.9.2): EXISTS subquery for "not recently attempted" filter

### **§31.5 `tutor_context_runtime_config` (authoritative: 03A V3 §18.7)**

CREATE TABLE tutor\_context\_runtime\_config (  
  config\_key TEXT NOT NULL,  
  environment TEXT NOT NULL,                            \-- 'production' | 'staging' | 'development'  
  config\_value JSONB NOT NULL,                          \-- string, number, boolean, or object  
  updated\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  updated\_by TEXT,  
  PRIMARY KEY (config\_key, environment)  
);

03C interactions:

* **Read only** (Cloud Run bootstrap \+ LISTEN on `runtime_config_updated` channel)

## **§32 Adapter Patterns**

V2.0 ships compatible with current upstream state (V8 V8, 01A V1, 03A V3, 03B V4.1) and forward-compatible with anticipated upstream changes.

### **§32.1 03B envelope-builder query adapter**

**Current state (03B V4.1):** envelope-builder query does NOT filter by `status` (no status column).

**V2.0 requirement:** envelope-builder must filter `WHERE status = 'ready'` to skip pending rows.

**Adapter approach:** ship a hotfix patch to 03B V4.1 envelope query before V2.0 production rollout. Patch is small (\~3 lines); does not require full 03B V5.

**Forward compat with 03B V5:** when 03B V5 ships, the hotfix is absorbed into the V5 spec; no V2.0 change needed.

### **§32.2 Schema migrations executed by 03C V2.0 (interim)**

**Current state:** 03B V4.1 owns `tutor_vertex_context_cache` and 03A V3 owns `tutor_memory_summaries`. Schema changes formally belong to those docs.

**V2.0 interim:** until 03B V5 / 03A V3.1 ship the migrations, 03C V2.0 deployment includes them as forward migrations (per §29). They are idempotent and run safely.

**Forward compat:** when 03B V5 / 03A V3.1 ship, their migrations become canonical; 03C V2.0's interim migrations are documented as already-executed (no-op when re-run).

### **§32.3 IdempotencyService interface (01A V1 → V1.1)**

**Current state (01A V1):** no `reservePending`, `complete`, `markFailed` methods. 03B V4.1 inlines the multi-phase pattern via raw DB ops.

**V2.0 03C posture:** does not depend on 01A V1.1 directly. 03C is non-idempotent (per §3.5). 03B's idempotency handling is upstream of 03C and unaffected by 03C V2.0.

**Forward compat:** when 01A V1.1 ships and 03B V5 absorbs it, 03C V2.0 is unchanged.

### **§32.4 Age-conditional tier (V8 V8 → V9)**

**Current state (03B V4.1 §15.10):** age-conditional tier adjustment is a 03B-local pre-check wrapper.

**V2.0 03C posture:** 03C does not see the override decision; 03B filters it before invoking 03C. §15.10 child-user override does not reach 03C envelope.

**Forward compat:** when V8 V9 absorbs the rule and 03B V5 removes the wrapper, 03C is unchanged.

### **§32.5 Rate multiplier override (01A V1 → V1.1)**

**Current state (01A V1):** no `rate_multiplier_override` parameter.

**V2.0 03C posture:** rate limiting is 03B's concern (per 01A Part V). 03C V2.0 does not enforce per-user rate limits.

**Forward compat:** unchanged when 01A V1.1 ships.

---

# **Change Records**

**CR-03C-V1-01** `[ADDITIVE][NO-MIGRATION]` — Initial canonical document for Doc 03C GCP Orchestration. Supersedes draft "TUTOR\_GCP\_ORCHESTRATION\_CONTRACT". V1 posture: thin consumer of V8/01A/03A V3/03B V4.1. \~12-15k words, GCP-specific concerns only.

**CR-03C-V1-02** `[ADDITIVE][NO-MIGRATION]` — Mixed model routing (Flash vs Pro) specified in §V.3. Deterministic per entry\_mode \+ policy\_variant \+ source\_surface. Flash for simple turns (hint, strategy); Pro for complex turns (explanation, scoped\_session, review, general). Overridable via `runtime_limits.model_override` for A/B testing. Observable via `vertex_model_routing_distribution` SLI.

**CR-03C-V1-03** `[ADDITIVE][NO-MIGRATION]` — Hybrid structured output strictness specified in §5.4. Strict schema for `suggested_action.type`, `question_links[]`, `instruction_exposures[]` (safety-critical fields). Lenient (normalize-and-log) for `response.content`, `ui_hints.suggested_chip` (content fields). SLIs: `vertex_output_schema_violation_rate` (strict; alert \>1%), `vertex_output_schema_drift_rate` (lenient; target \<5%).

**CR-03C-V1-04** `[ADDITIVE][NO-MIGRATION]` — Streaming mode specified in §7.4 as additive per envelope opt-in. V1 default sync; streaming-enabled path produces SSE events. 03B opts in per turn. No state mutation during streaming.

**CR-03C-V1-05** `[ADDITIVE][NO-MIGRATION]` — Cloud Tasks scope for V1 locked to conversation-close compaction \+ MemoryRefreshWorker (§VIII). Two queues: `lisa-compaction` and `lisa-memory-refresh`. Separate Cloud Run async handler service per §13.3. Retry policy, dead-letter monitoring, bounded writeback scope per §8.6.

**CR-03C-V1-06** `[ADDITIVE][NO-MIGRATION]` — Vertex context cache consumption pattern specified in §VI. 03C is caller; 03B §12B.5 \+ §27E owns mapping table. V1 composite caching (single CachedContent per turn containing system \+ teaching\_profile \+ canonical\_question). V2 target per-prefix caching if Vertex API supports. Concurrent-create race handled via `ON CONFLICT` upsert.

**CR-03C-V1-07** `[ADDITIVE][NO-MIGRATION]` — MemoryRefreshWorker implements 03B V4.1 §12B.5.1 invalidate-then-delete pattern in §8.4. Inside Postgres transaction: mark mapping invalidated\_at \+ write new teaching\_profile \+ NOTIFY. Post-commit: Vertex CachedContent delete best-effort. Matches 03B canonical pattern.

**CR-03C-V1-08** `[ADDITIVE][NO-MIGRATION]` — Service account topology specified in §2.4. Four service accounts with bounded IAM: `lisa-api` (main handler), `lisa-orchestrator` (03C), `lisa-async-worker` (Cloud Tasks handler), `lisa-cloud-tasks` (Cloud Tasks enqueuer identity). Quarterly IAM audit required.

**CR-03C-V1-09** `[ADDITIVE][NO-MIGRATION]` — Vertex project isolation per §2.5 \+ §12.4. Separate GCP project `lyceon-vertex-prod` from main app project. Cross-project IAM for service account access. Isolates cost, quota, and IAM blast radius.

**CR-03C-V1-10** `[ADDITIVE][NO-MIGRATION]` — Circuit breaker on Vertex calls per §10.2. Per-model error rate threshold (default 50% over 60s window); 30s trip duration; half-open probe. Prevents Vertex quota burn during provider incident. Config via 03A V3 §18.7 runtime config.

**CR-03C-V1-11** `[ADDITIVE][NO-MIGRATION]` — Cost observability per §11.3 \+ §1.11. Per-turn cost emitted as metric; daily budget tracked; alerts at 70%/90%/120% of daily budget. Per-model cost breakdown enables routing tuning.

**CR-03C-V1-12** `[ADDITIVE][NO-MIGRATION]` — Production logging redaction per §9.5 \+ §12.5. Prompt text, response text, memory summaries, canonical question content NOT logged. Metadata-only (request\_id, model, cache status, latency, tokens, error codes) sufficient for operational diagnostics.

**CR-03C-V1-13** `[ADDITIVE][NO-MIGRATION]` — Prompt template immutability per §4.3. System prompts authored in 03A V3 §11, versioned, loaded at Cloud Run bootstrap. No runtime prompt editing. No LLM-authored meta-prompts. Supports reproducibility, auditability, and Vertex cache stability.

**CR-03C-V1-14** `[ADDITIVE][NO-MIGRATION]` — Separate Cloud Run services for orchestrator and async handler per §13.3. V1 choice: isolated scaling and blast radius containment. V2 may consolidate if operational overhead exceeds benefit.

---

**V1.1 patch records (BLK-V1, AMB-V1, SWE-V1, NTH-V1 closeouts):**

**CR-03C-V1.1-01** `[REFACTOR][NO-MIGRATION]` — BLK-03C-01 closeout. §VI Vertex context cache fully redesigned. V1 had internally contradictory design (per-kind lookup \+ composite claim). V1.1 picks per-student composite: single cache key `(policy_variant, prompt_version, student_id, teaching_profile_version)` mapping to one Vertex `CachedContent`. Canonical question content moved to message history (not cached; varies per turn). Hit rate target revised from \>70% to \>50% steady state. CR-03C-V1-06 amended.

**CR-03C-V1.1-02** `[ADDITIVE][NO-MIGRATION]` — BLK-03C-02 closeout (hybrid option d). §5.9 candidate-slots flow added for V1: 03C pre-selects 3-5 candidate similar questions server-side; passes as opaque slot IDs to model; model returns slot\_id; 03C resolves to canonical\_id. Preserves §4.4 canonical-ID-internal-only rule. V2 target (semantic-search description-matching) deferred. New SLIs: `candidate_preselect_latency_p95`, `candidate_preselect_empty_rate`, `vertex_candidate_slot_hallucination_rate`, `similar_question_offer_rate`.

**CR-03C-V1.1-03** `[REFACTOR][NO-MIGRATION]` — BLK-03C-03 closeout. §VIII ownership split explicit. §8.0 added: 03A V3 owns job logic (what compaction/refresh does); 03C V1.1 owns GCP runtime (how it runs). Service account renamed `lisa-async-worker@` → `lisa-memory-worker@` (reflects 03A ownership). §15.4 adds co-signature clause for §VIII change review. §8.3-§8.4 handler logic subsections reference 03A V3 §9 / §14 authoritatively.

**CR-03C-V1.1-04** `[ADDITIVE][NO-MIGRATION]` — BLK-03C-04 closeout. §5.3.2 Pro→Flash per-turn fallback added: Vertex Pro 5xx / 429 / timeout → auto-fallback to Flash with logged degradation event. §5.3.3 budget circuit breaker added: daily Pro budget exceeded → all Pro-routed turns redirect to Flash. §10.3 cross-references §5.3.2. New SLIs: `vertex_pro_fallback_rate`, `vertex_pro_budget_circuit_breaker_state`, `vertex_pro_budget_circuit_breaker_redirects`.

**CR-03C-V1.1-05** `[REFACTOR][NO-MIGRATION]` — AMB-03C-01 \+ AMB-03C-02 closeout. §4.2 rewritten for native Gemini Content\[\] format. §4.2.1 added: `envelope.student_context` treated as opaque JSON; 03C does not parse internals; fields resolved via path substitution in prompt templates; authoritative shape definitions in 03A V3 / 02C / 07 (cross-reference, not duplicate).

**CR-03C-V1.1-06** `[REFACTOR][NO-MIGRATION]` — AMB-03C-03 closeout. §5.3.1 model routing table restructured as ordered precedence list (priority 1-9). `source_surface == "review"|"test_review"` takes precedence over `entry_mode`\+`policy_variant`. Explicit default fallback to Flash. Budget circuit breaker \+ override have higher precedence than routing rules.

**CR-03C-V1.1-07** `[ADDITIVE][NO-MIGRATION]` — AMB-03C-04 closeout. §7.4 fully rewritten with SSE wire format specification. Content-Type, event types (content\_delta, suggested\_action\_set, ui\_hints\_set, question\_link, instruction\_exposure, orchestration\_meta, error, done), data payload shapes, event ordering guarantees, canonical ID resolution in streaming, failure mode, V1 opt-out posture, no-state-mutation rule.

**CR-03C-V1.1-08** `[REFACTOR][NO-MIGRATION]` — AMB-03C-05 closeout. §8.4 MemoryRefreshWorker handler logic clarified: source data reads from 02B/02C/03A V3 tables (read-only RLS-scoped), summary generation via Vertex Flash (per 03A V3 §9.5), executes 03B V4.1 §12B.5.1 invalidate-then-delete pattern. Algorithm authoritatively owned by 03A V3 §9; §8.4 is GCP runtime spec.

**CR-03C-V1.1-09** `[ADDITIVE][NO-MIGRATION]` — AMB-03C-06 closeout. §10.2 circuit breaker scope made explicit: per-Cloud-Run-instance state (not shared); 10-request warmup period before evaluation; per-model independent state; V2 target for optional Tier 2 shared counter.

**CR-03C-V1.1-10** `[REFACTOR][NO-MIGRATION]` — SWE-03C-01 closeout. §7.3 error code table adds "03B handling" column showing mapping from 03C error code → 03B user-facing behavior per 03B V4.1 §28.7 / §28A.2 / §18. Eliminates cross-doc hunting.

**CR-03C-V1.1-11** `[REFACTOR][NO-MIGRATION]` — SWE-03C-02 closeout. §5.8 retry policy enhanced with exponential backoff \+ jitter. First retry 200ms±50ms; second retry 800ms±200ms; max 2 retries; total wall-clock bounded by `runtime_limits.timeout_ms + 1500ms`. Prevents thundering-herd during Vertex blips.

**CR-03C-V1.1-12** `[ADDITIVE][NO-MIGRATION]` — SWE-03C-03 closeout. §11.2 SLI catalog expanded: added `orchestrator_callback_success_rate`, `memory_refresh_job_success_rate`, `teaching_profile_staleness_lag_minutes` (all joint with 03B V4.1 §22.12 — 03C owns update-path contribution). Revised `vertex_context_cache_hit_rate` target from \>70% to \>50% (consistent with BLK-03C-01 redesign). Added V1.1 SLIs for BLK-03C-02 (candidate slots) and BLK-03C-04 (Pro fallback \+ budget breaker).

**CR-03C-V1.1-13** `[ADDITIVE][NO-MIGRATION]` — SWE-03C-04 closeout. §14.3 safety acceptance expanded with 7 additional items: PII-in-Vertex negative test, per-category safety filter test, guardian data not reachable, §15.10 child-user signal filtered, cross-project IAM scope test, log redaction verification, candidate slot hallucination handling test, Pro fallback feature-exposure test, budget circuit breaker correctness test.

**CR-03C-V1.1-14** `[ADDITIVE][NO-MIGRATION]` — SWE-03C-05 closeout. §8.2 rate limit rationale documented. 100/s compaction \= \~30× headroom vs peak; 50/s refresh \= 5000× headroom vs steady-state but constrains bulk-refresh to \~200s/10k students. Tuning note for emergency bulk operations added.

**CR-03C-V1.1-15** `[ADDITIVE][NO-MIGRATION]` — NTH-03C-01 closeout. §2.5 per-environment Vertex projects enumerated: `lyceon-vertex-prod`, `lyceon-vertex-staging`, `lyceon-vertex-dev`. Dev project quota capped to prevent runaway cost. Cross-project IAM isolation explicit.

**CR-03C-V1.1-16** `[REFACTOR][NO-MIGRATION]` — NTH-03C-02 closeout. §11.3 cost observability adds cross-reference to 03B V4.1 §12B.5.5 savings projection. V1.1 notes projection requires revision given BLK-03C-01 cache redesign; revised range at V1 scale: \~$5-20k/yr (pushed lower end). 03B V4.1 §12B.5.5 update flagged for consolidated hardening pass.

**CR-03C-V1.1-17** `[REFACTOR][NO-MIGRATION]` — NTH-03C-03 closeout. §6.5 composite cache TTL explicit: 1 hour (aligned with teaching\_profile Vertex TTL per 03B V4.1 §12B.5). Turnover naturally tied to teaching\_profile refresh cadence (\~14 days).

---

**V1.2 patch records (minor tightening; no architectural deltas):**

**CR-03C-V1.2-01** `[REFACTOR][NO-MIGRATION]` — §6.6 canonical-question pseudo-role clarification. V1.1 used `role: 'user'` for system-note content in `contents[]` array without documenting why. V1.2 explicitly documents the Gemini API constraint (`contents[]` supports only `user` | `model` roles; no native system role within `contents[]`), names the tag-prefix convention (`<question_context>`, `<candidate_questions>`, `<learning_context>`, `<chat_summary>`), and clarifies this is a known Gemini-idiomatic workaround, not a design flaw. Same runtime code; clearer intent for external reviewers.

**CR-03C-V1.2-02** `[ADDITIVE][NO-MIGRATION]` — §2.4 \+ §12.3 IAM expansion for `lisa-orchestrator@`. V1.1 §5.9 candidate-slots flow requires DB read access to `canonical_questions`; §2.4 and §12.3 IAM rows did not enumerate this. V1.2 adds explicit read-only RLS-scoped access to `canonical_questions`, `tutor_vertex_context_cache`, and `tutor_context_runtime_config` tables. Quarterly IAM audit now reflects accurate scope.

**CR-03C-V1.2-03** `[REFACTOR][NO-MIGRATION]` — §8.4 open-ambiguity language tightening. V1.1 §8.4 flagged an "open ambiguity deferred to 03A V3 §9.6" — language suggested 03C had a deferred decision. V1.2 reframes as an upstream 03A V3 §9.6 contract gap (not a 03C concern), spells out the two plausible sequencings (placeholder-then-fill vs generate-then-write), flags for consolidated hardening pass (03A V3.1 target), and adds interim implementation note pointing ops-runbook readers to pick one pattern and document the choice.

**CR-03C-V1.2-04** `[ADDITIVE][NO-MIGRATION]` — §4.2.1 PII contract clarification. V1.1 §4.2.1 defined opaque-JSON substitution behavior but did not address PII. V1.2 adds explicit clarification: `student_context` fields must not contain PII per 03A V3 §6 contract; 03C does not re-verify (propagates responsibility to 03B envelope builder per 03B V4.1 §3); flags V2 optional shallow PII detector as defense-in-depth target.

---

**V2.0 patch records (production-hardening rewrite):**

**CR-03C-V2-01** `[STRUCTURAL][SCHEMA-MIGRATION]` — §8.4 write-timing pattern locked to placeholder-then-fill (Option A per Karl's pre-V2.0 decision). V1.2 deferred this to 03A V3.1; V2.0 force-resolves in 03C with full specification. Adds `tutor_memory_summaries.status` column (`pending | ready | failed`); two-transaction handler pattern (T1: invalidate cache \+ insert pending; Vertex generation outside tx; T2: fill content \+ mark ready); reader-side filter contract (03B envelope query must filter `status = 'ready'`); failure-mode handling (Vertex fail → mark failed; worker crash → reconciliation). Cross-doc coordination: 03A V3.1 must adopt same pattern in §9.6.

**CR-03C-V2-02** `[ADDITIVE][NO-MIGRATION]` — §8.4-NEW pending-row reconciliation job added. Third Cloud Tasks queue `lisa-pending-reconciliation` (rate limit 10 req/s); Cloud Scheduler triggers every 5 minutes (configurable); sweeps `tutor_memory_summaries.status = 'pending'` rows older than 10-minute threshold; marks failed; re-enqueues fresh refresh task. Required by §8.4 placeholder-then-fill pattern to clean up orphaned pending rows from worker crashes. New SLIs: `pending_reconciliation_orphaned_count`, `pending_reconciliation_swept`, `memory_refresh_pending_window_p95`, `memory_refresh_envelope_fallback_rate`.

**CR-03C-V2-03** `[STRUCTURAL][NO-MIGRATION]` — §28 Failure matrix added. Every 03C-owned primitive's failure modes consolidated with target rates and alert thresholds. Six subsections: turn path (§28.1), Vertex invocation (§28.2), context cache (§28.3), candidate pre-select (§28.4), async jobs (§28.5), deployment \+ infra (§28.6). Authoritative reference for SLI targets; §11.2 SLI list aligned to match.

**CR-03C-V2-04** `[STRUCTURAL][NO-MIGRATION]` — §28A per-endpoint operational contracts added. Five endpoints fully specified: POST /orchestrate/turn sync (§28A.1), POST /orchestrate/turn streaming (§28A.2), POST /async/compaction (§28A.3), POST /async/memory-refresh (§28A.4), POST /async/pending-reconciliation (§28A.5). Each endpoint contract covers: request spec, response spec (success \+ each error), auth requirements, rate limits, timeout, retry policy, idempotency semantics, observability signals, deployment flag/feature toggle, rollback procedure.

**CR-03C-V2-05** `[STRUCTURAL][NO-MIGRATION]` — §28B Cloud Run operational contract added. Service inventory (orchestrator \+ memory-worker), instance sizing, cold-start P99 targets with CI gate, scaling rules, health check spec, graceful shutdown handling, blue-green deployment rollout, canary rollout option, rollback procedure, configuration management.

**CR-03C-V2-06** `[STRUCTURAL][NO-MIGRATION]` — §28C isolation levels added. Every DB read/write 03C performs mapped to: transaction boundary, isolation level (READ COMMITTED for all V2.0 operations), locking strategy, behavior on serialization failure. Eight subsections covering all 03C DB interactions including the new V2.0 placeholder-then-fill T1/T2 transactions and pending reconciliation sweep.

**CR-03C-V2-07** `[ADDITIVE][SCHEMA-MIGRATION]` — §29 Schema migrations added with exact ALTER TABLE statements. Two migrations: §29.1 expands `tutor_vertex_context_cache.cache_kind` CHECK constraint to include `student_composite` (resolves V1.1 BLK-03C-01 schema requirement); §29.2 adds `tutor_memory_summaries.status` column with default `'ready'` and CHECK constraint (`pending | ready | failed`) plus partial index for pending-row sweeps. Both migrations idempotent; deployment ordering documented (§29.3); rollback procedures specified.

**CR-03C-V2-08** `[ADDITIVE][NO-MIGRATION]` — §30 Configuration reference consolidates every tunable into one section. Six tables: Vertex configuration (§30.1), generation parameters (§30.2), cache configuration (§30.3), async job configuration (§30.4), build-time config (§30.5), secret config (§30.6). Each row: key, default, min, max, source, who-decides-to-change.

**CR-03C-V2-09** `[ADDITIVE][NO-MIGRATION]` — §31 Schema reference inlined. Exact column shapes for `tutor_vertex_context_cache` (§31.1), `tutor_memory_summaries` with V2.0 `status` column (§31.2), `canonical_questions` subset (§31.3), `student_question_attempts` subset (§31.4), `tutor_context_runtime_config` (§31.5). Annotated "authoritative source" for cross-doc drift detection but self-contained for execution.

**CR-03C-V2-10** `[ADDITIVE][NO-MIGRATION]` — §32 Adapter patterns added for forward-compatibility with anticipated upstream changes. Five subsections: 03B envelope-builder query adapter (§32.1), schema migrations as 03C interim (§32.2), IdempotencyService interface (§32.3), age-conditional tier (§32.4), rate multiplier override (§32.5). 03C V2.0 ships compatible with current upstream state and forward-compatible with consolidated hardening pass outputs.

**CR-03C-V2-11** `[REFACTOR][NO-MIGRATION]` — Code samples upgraded to specify exact SDK choices. `@google-cloud/vertexai` for Vertex AI, `@google-cloud/tasks` for Cloud Tasks, `kysely` for query builder with `pg` driver, `pino` for structured logging. Specific import paths included. Error types defined explicitly.

**CR-03C-V2-12** `[REFACTOR][NO-MIGRATION]` — §11.2 SLI list aligned with §28 failure matrix. New V2.0 SLIs: `memory_refresh_pending_window_p95`, `memory_refresh_envelope_fallback_rate`, `pending_reconciliation_orphaned_count`, `pending_reconciliation_swept`, `pending_reconciliation_row_failed`, `orchestrator_envelope_validation_failure_rate`, `orchestrator_prompt_oversize_rate`, `orchestrator_cold_start_latency_p99`, `vertex_call_5xx_rate`, `vertex_call_timeout_rate`, `vertex_call_quota_rate`, `vertex_context_cache_lookup_timeout_rate`, `vertex_context_cache_creation_failure_rate`, `vertex_context_cache_mapping_write_failure_rate`, `candidate_preselect_timeout_rate`, `cloud_run_instance_crash_rate`, `health_check_failure_rate`, `deployment_rollback_count`, `pending_reconciliation_sweep_count`. Targets and alert thresholds per §28.

---

**V2.1 patch records (5 named blockers \+ review-swipe items):**

**CR-03C-V2.1-01** `[REFACTOR][NO-MIGRATION]` — BLK-V2-01 closeout. §14.1 cache acceptance criteria corrected. V2.0 said "Composite cache key (system \+ teaching\_profile \+ canonical\_question) builds correctly" — stale text contradicting V1.1 BLK-03C-01 redesign. V2.1 corrects to "Per-student composite cache key (policy\_variant \+ prompt\_version \+ student\_id \+ teaching\_profile\_version)" \+ explicit note that canonical question content is in message history, not cache. Added V2.1 acceptance items for BLK-V2-02/03/04 verification.

**CR-03C-V2.1-02** `[ADDITIVE][NO-MIGRATION]` — BLK-V2-02 closeout. Vertex output schema (§5.5) and 03C → 03B response schema (§7.1) explicitly split. New §7.1.1 documents the split: Schema A (Vertex output) uses opaque `related_candidate_slot_id` only; Schema B (03C → 03B response) is post-resolution with canonical IDs filled by 03C from envelope \+ candidate list lookup. §5.5 `responseSchema` for question\_links updated to drop canonical ID fields and require slot ID \+ relationship\_type \+ reason\_code only. Hallucinated slot handling specified (drop link, log SLI, turn succeeds).

**CR-03C-V2.1-03** `[ADDITIVE][NO-MIGRATION]` — BLK-V2-03 closeout. Deterministic V1 PII guard implemented in §4.2.2. Regex screener for email, phone (US/intl), DOB/birthdate (labels \+ ISO \+ US dates), address-like (street \+ ZIP — ZIP at warn-only), full-name labels, guardian identifiers. Runs after §4.5 content safety pre-pass, before §VI cache lookup. Fail-closed: blocking pattern hit returns `pii_in_envelope` error (HTTP 400, non-retryable, SEV-2 page). New SLIs `orchestrator_pii_pattern_hit_total` and `orchestrator_pii_blocked_turns_total`. Configuration knobs `pii_guard.enabled` and `pii_guard.warn_severity_blocks` added to §30.7.

**CR-03C-V2.1-04** `[REFACTOR][NO-MIGRATION]` — BLK-V2-04 closeout. §5.9.2 candidate pre-select query replaces `ORDER BY ... RANDOM()` with `ORDER BY ... hashtext(canonical_id || student_id || current_date::text)`. Provides deterministic same-day ordering per (source-question, student) for replay/debug; varies across days for natural diversity rotation. Determinism guarantee documented in V2.1 prose addition.

**CR-03C-V2.1-05** `[REFACTOR][MIGRATION-SEQUENCE]` — BLK-V2-05 closeout. §29.3 production deployment ordering hardened: 10-step sequence with explicit ownership, verification gates, and rollback per step. Pre-deployment gates: Test Matrix shipped, Ops Runbook shipped, schema migrations §29.1+§29.2 deployed, 03B envelope-builder hotfix deployed (forward-compat). 03C V2.1 spec is APPROVED for engineering implementation; production *ship* gated on these companions. Verdict per external review: "APPROVE FOR V2.1 CLOSEOUT, NOT PRODUCTION SHIP."

**CR-03C-V2.1-06** `[REFACTOR][NO-MIGRATION]` — Review-swipe: §5.7 generation parameters add `topK: 40` (explicit nucleus sampling clamp; tightens structured-output compliance) and `seed` parameter (deterministic regeneration in debug runs only; production passes null/undefined). New configuration table §30.8. PII guard runs before Vertex regardless of seed presence.

**CR-03C-V2.1-07** `[REFACTOR][NO-MIGRATION]` — Review-swipe: §28C.4 memory refresh T1 isolation hardened. V2.0 specified READ COMMITTED with advisory lock as primary control; V2.1 adds `FOR UPDATE` on `MAX(summary_version) + 1` query as defense-in-depth against advisory lock failure. Prevents two concurrent T1s from racing to the same `summary_version` if the advisory lock guard ever fails (would otherwise produce unique-constraint violation; FOR UPDATE blocks instead).

**CR-03C-V2.1-08** `[ADDITIVE][NO-MIGRATION]` — Review-swipe: §7.3 error code registry adds `pii_in_envelope` (HTTP 400, non-retryable, SEV-2 page mapping). Per BLK-V2-03 PII guard. Cross-doc requirement: 03B V5 must add `pii_in_envelope` to §18 error registry.

**CR-03C-V2.1-09** `[REFACTOR][NO-MIGRATION]` — Review-swipe: §4.2.1 PII contract reference language updated. V1.2 said "03C does not re-verify PII; responsibility deferred upstream." V2.1 says "V2.1 enforces this in 03C with deterministic PII guard (§4.2.2) — defense-in-depth above 03B's envelope-builder responsibility, given the minor-facing audience." Aligns prose with implementation.

---

# **End of Doc 03C V2.1**

**Canonical for Lyceon platform as of 2026-04-25.**

**Supersedes:** Doc 03C V2.0, V1.2, V1.1, V1.0; draft "TUTOR\_GCP\_ORCHESTRATION\_CONTRACT".

**Depends on:** Doc 00 Platform Directive, Doc 01 V8, Doc 01A V1, Doc 03 Main V1.1, Doc 03A V3, Doc 03B V4.1.

**Coordinates with:** Doc 03B V4.1 §12B.5 (Vertex context cache mapping table — `student_composite` cache kind per §29.1; `tutor_memory_summaries.status` column per §29.2 cross-doc), §18 (error registry — V2.1 adds `pii_in_envelope`), §28A.2 (POST /api/tutor/messages operational contract), §13.7 (idempotency); Doc 03A V3 §5-§9, §11, §14 (context resolution, memory refresh algorithm — placeholder-then-fill pattern per V2.1 §8.4 must align with 03A V3.1 §9.6 when shipped, policy prompt artifacts, compaction algorithm); Doc 01A Part II (observability), Part VII (HMAC auth).

**Companion artifacts (separate docs; pending — required before production ship):**

* **Doc 03C.1 Test Matrix V1** — scenario tests per §28 failure matrix \+ V2.1 blocker-fix tests (PII guard pattern coverage, slot ID hallucination handling, deterministic candidate ordering verification, schema split correctness, placeholder-then-fill T1/T2 paths, pending reconciliation correctness, schema migration verification, Pro→Flash fallback chaos test, budget circuit breaker correctness). Owner: Engineering. **Required before launch.**  
* **Doc 03C Operations Runbook V1** — Cloud Run deployment (per §28B), Vertex project IAM setup (per-env), Cloud Tasks queue provisioning (3 queues), Cloud Scheduler reconciliation trigger setup, budget monitor setup, circuit breaker ops playbook, schema migration deployment ordering (per §29.3 10-step sequence), PII guard incident response procedure (privacy SEV-2 escalation), incident response procedures. Owner: Ops. **Required before launch.**

**V1 → V1.1 → V1.2 → V2.0 → V2.1 scope summary:**

Architectural direction preserved across all versions: thin consumer of upstream canonicals; GCP-specific scope; placeholder-then-fill memory refresh; per-student composite Vertex cache; mixed Flash/Pro routing with auto-fallback and budget circuit breaker; deterministic candidate slots for similar questions; per-instance circuit breaker; SSE streaming opt-in; tag-prefix pseudo-system convention for Gemini contents\[\].

V2.0 added production hardening template: §28 failure matrix; §28A endpoint operational contracts; §28B Cloud Run contract; §28C isolation levels; §29 schema migrations; §30 configuration reference; §31 inline schemas; §32 adapter patterns. 12 V2.0 change records.

V2.1 closes external review blockers: BLK-V2-01 (cache acceptance text); BLK-V2-02 (Vertex schema vs 03C→03B response schema split); BLK-V2-03 (deterministic PII guard implemented in 03C); BLK-V2-04 (deterministic candidate ordering replacing RANDOM()); BLK-V2-05 (production rollout dependencies hardened with 10-step sequence). Plus review-swipe items: §5.7 topK \+ seed; §28C.4 FOR UPDATE on version computation; §7.3 error code addition; §4.2.1 prose alignment. 9 V2.1 change records.

**Ship status (V2.1):**

* ✅ **Spec:** APPROVED for engineering implementation (production-hardened; senior devs execute without blockers)  
* ⏸️ **Production ship:** GATED on companion artifacts (Test Matrix \+ Ops Runbook) \+ cross-doc patches (03B envelope-builder hotfix \+ schema migrations) per §29.3  
* 🔄 **Consolidated hardening pass (V3 candidate):** full upstream coordination produces 03B V5 \+ 03A V3.1; replaces 03B hotfix with proper V5 update; verifies 03A V3.1 §9.6 adopts placeholder-then-fill pattern

**Bar:** "senior dev executes without blockers; production-hardened spec." Junior devs execute with senior review available. Companion Test Matrix defines acceptance criteria; companion Operations Runbook defines deploy procedure.

**No architectural decisions deferred.** §8.4 write-timing pattern force-resolved (placeholder-then-fill). All V1.x and V2.0 review blockers closed. All forward dependencies on consolidated hardening pass have adapter patterns (§32) ensuring V2.1 ships compatible with current upstream state.

**Upstream coordination required for production rollout:**

* **03B envelope-builder hotfix patch (gating):** add `WHERE status = 'ready'` filter to envelope query. Required before 03C V2.1 production deployment per §29.3 sequence step 5-6. Patch is small (\~3 lines); does not require full 03B V5.  
* **03B V5 §18 error registry:** add `pii_in_envelope` code. Can ship in V5 or as forward-compat addendum.  
* **Schema migrations (§29.1, §29.2):** ship as 03C V2.1 deployment migrations interim per §32.2; 03B V5 / 03A V3.1 absorb canonically when those docs ship.

**Forward-compatible (no blocking dependencies on consolidated pass):**

* 01A V1.1 `reservePending` interface (03C is non-idempotent; 03B handles)  
* V8 V9 age-conditional tier (03B filters before 03C)  
* 01A V1.1 rate\_multiplier\_override (03B handles)  
* 03A V3.1 §9.6 write-timing alignment (03C V2.1 is authoritative for the pattern; 03A V3.1 must adopt same)

**Review posture:** V2.1 closes V2.0 external review findings \+ review-swipe items caught during the rewrite pass. Next gate: ship Test Matrix \+ Operations Runbook companion artifacts. Then production deployment per §29.3 sequence. Consolidated hardening pass (producing 03A V3.1 \+ 03B V5) is parallelizable but not blocking for V2.1 production launch.

