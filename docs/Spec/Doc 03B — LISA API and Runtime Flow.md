# **Doc 03B — LISA API and Runtime Flow**

**Version:** V4.1 **Status:** CANONICAL (supersedes V4.0, V3.0, V2.0, V1.0) **Document family:** Doc 03 Preamble \+ Doc 03 Main V1.1 \+ Doc 03A V3 (Context & Memory Runtime) \+ Doc 03B (this document) \+ Doc 03C (GCP Orchestration, pending V1) **Owners:** Lyceon Platform Team **Last updated:** 2026-04-24 **Supersedes:** Doc 03B V4.0 (2026-04-24), V3.0 (2026-04-24), V2.0 (2026-04-23), V1.0; prior draft "TUTOR\_API\_AND\_RUNTIME\_FLOW\_CONTRACT" **Depends on:** Doc 00 Platform Directive, Doc 01 V8 (Identity/Access/Billing/Guardian Trust), Doc 01A V1 (Platform Primitives), Doc 03 Main V1.1, Doc 03A V3, Doc 02B V4, Doc 02C V4.

**V4.1 update scope:** Patch release closing V4 internal review items. V4's architectural direction preserved. V4.1 closes 2 new Blockers introduced in V4's fixes, 3 Ambiguities, 3 SWE Standard Improvements, and 2 Nice-to-Haves from V4 internal review. What changes vs V4:

**Blocker fixes (BLK-V4-01, V4-02):**

* **§13.7 advisory-lock pattern honesty (BLK-V4-01)** — V4's pattern was described as eliminating orphaned `in_progress` records. Re-examination showed the pattern actually *reduces* the orphan window (concurrent retry serialization works) but does not *eliminate* the handler-crash stuck-record scenario, which still relies on 01A §35 stuck-record recovery timer. §13.7 is rewritten for precision: what the pattern achieves (serialized retries, clean `pending → in_progress` transition within steps 1-2 transaction) versus what remains delegated to 01A §35 (handler-crash recovery after steps 1-2 commit). CR-03B-V4-01 updated to match.  
* **§15.10 guardian visibility of bypass events (BLK-V4-02)** — V4 §15.10 emitted audit events for minor-user bypass without specifying whether guardian accounts (per Doc 01 V8 guardian trust model) could see them. V4.1 adds §15.10.5 explicit rule: guardian dashboards never surface abuse score, tier, or bypass events. Matches 01A §57 no-visibility posture for student and extends to guardian. Ops-only audit event visibility.

**Ambiguity resolutions (AMB-V4-01 through V4-03):**

* **§12B Vertex cache nomenclature (AMB-V4-01)** — V4 invented "Tier 3" label for Vertex provider-side cache, extending 01A Part III canonical tier taxonomy without upstream buy-in. V4.1 renames to "Vertex provider-side cache (not part of 01A Part III two-tier topology)." Tier 1 / Tier 2 remain the only canonical tier labels.  
* **§28A.2 rollback honesty (AMB-V4-02)** — V4 rollback note claimed "all schema changes are additive" conflating schema migration safety with behavioral change safety. V4.1 distinguishes explicitly: schema migrations are additive and safe to roll back; behavioral changes (specifically §15.10 minor bypass) are breaking for the subset of minors currently using the bypass path — emergency-only rollback with recommended manual intervention via 01A §56 `adjustScore` for affected students first.  
* **§12B.5.5 Vertex savings projection (AMB-V4-03)** — V4 gave single-point savings estimates ($27k/yr, $270k/yr, $2.7M/yr) with optimistic "50% savings" assumption. V4.1 hedges: context-cached tokens typically bill at 25% of regular input cost (75% savings on cached bytes, not 100%), and output tokens aren't cached. Net revised range: $15-30k/yr at V1 launch scale; post-launch actuals required for precision. Single-point figures removed.

**SWE Standard Improvements (SWE-V4-01 through V4-03):**

* **§13.7 `reservePending` failed-state handling (SWE-V4-01)** — V4 pseudocode branch analysis missed the `failed` case (dropped through to "we own this attempt" but `status !== 'pending'` would fail the UPDATE guard). V4.1 makes the state machine explicit: `reservePending` internally normalizes `failed → pending` on new attempt with matching content hash; pseudocode simplified to three external branches (`completed-match`, `in_progress`, `completed-mismatch`) plus the `pending` own-it branch.  
* **§12B.5.1 write-through race (SWE-V4-02)** — V4 pattern did Vertex delete before Postgres commit. Concurrent orchestrator turn could create a new `CachedContent` mid-sequence, leading to the writer's `UPDATE invalidated_at` hitting the wrong row. V4.1 inverts order: mark mapping `invalidated_at` first (inside Postgres txn); Vertex delete runs after txn commits (outside); concurrent orchestrator reads see `invalidated_at IS NOT NULL` and proceed to fresh cache creation without race.  
* **CR-03B-V4-01 deploy coordination (SWE-V4-03)** — V4 CR did not flag that 01A V1.1 must ship *before* 03B V4 for the `idempotency_records.status = 'pending'` enum value to be understood by 01A's stuck-record recovery. V4.1 adds the coordination note: 01A V1.1 backward-compatible ships first, then 03B V4.1.

**Nice-to-Have closeouts (NTH-V4-01, V4-02):**

* **CR-03B-V4-01 honesty (NTH-V4-01)** — updated to reflect BLK-V4-01 analysis (partial closeout: reduces orphan window, stuck-record timer still required).  
* **Residual V3 phrasing sweep (NTH-V4-02)** — minor phrasing cleaned; Part XVIII header re-confirmed as "V4 Template" with V4.1 notation.

**Review posture:** V4.1 is the version intended for external review and downstream implementation. V4 had two blockers that external review would have caught; V4.1 fixes them before that review.

---

# **Part 0 — Doc 03B Preamble**

## **0.1 Purpose**

Doc 03B defines the API surface and runtime flow for LISA. It is the authoritative specification for:

* HTTP endpoints exposed to the client (web app, future mobile)  
* Authentication and authorization at the API boundary  
* Server-side step ordering for every tutor operation  
* Trusted scope resolution from client-supplied references  
* Entitlement enforcement per request  
* Idempotency semantics for retries  
* Rate limiting and quota enforcement  
* Error envelope shapes and HTTP status code mapping  
* Anti-leak enforcement at the API boundary  
* Conversation reuse rules  
* Integration with Doc 03A context resolution and Doc 03C orchestration

Doc 03B does not specify: context resolution algorithm (Doc 03A), orchestration/model invocation (Doc 03C), persona behavior (Doc 03 Main §4), entitlement model internals (Doc 01 V8), mastery read mechanics (Doc 02C V4).

## **0.2 Relationship to Doc 03 Main V1.1, Doc 01 V8, Doc 01A V1, and Doc 03A V3**

Doc 03B is the transport and enforcement layer. It sits between the client and the orchestration layer. Its job is to:

* Validate client requests  
* Enforce authentication, authorization, entitlement  
* Re-check invariants at every request boundary  
* Resolve trusted scope from client references  
* Call into context resolution (Doc 03A) to build the envelope  
* Invoke orchestration (Doc 03C) with the envelope  
* Persist canonical records in the correct order  
* Return a clean, predictable response envelope

**What 03B consumes from upstream canonicals:**

* V8 `EntitlementService.canAccessFeature('tutor_access', studentId)` — per-request entitlement check (§3.2, §12)  
* V8 `AuditLogger` conventions — identity audit events at `/api/tutor/*` boundaries (§22.7)  
* V8 account deletion soft-delete semantics (§29, §27)  
* 01A Part I config doctrine — `tutor_context_runtime_config` per `*_runtime_config` pattern (§27A)  
* 01A Part II structured logger \+ correlation IDs \+ metrics naming \+ PII redaction transport (§22)  
* 01A Part III caching topology — two-tier, LISTEN/NOTIFY invalidation, hard-staleness bounds (Part V.5; LISA augments with Cloud Run and Vertex AI specifics)  
* 01A Part IV `IdempotencyService` with `tutor_turn` scope, 7-day TTL (§14)  
* 01A Part V `RateLimitLedger` with buckets `tutor_turns_daily` and related burst buckets (§15)  
* 01A Part VI `AbuseScoreService` for scoring, tier computation, enforcement multipliers (§15.7, §15.8)  
* 01A Part VII internal service auth — HMAC-SHA256 per service pair (§19.5)  
* 01A §0.6 error class catalog — `IdempotencyConflictError`, `RateLimitExceededError`, `CacheUnavailableError`, `AbuseScoreUnavailableError`, `UnauthorizedError` (§6.9 error mapping)  
* 03A V3 context envelope shape (§5.4) — input to orchestration call  
* 03A V3 `tutor_injection_log` — LISA-specific forensic detail (not the abuse ledger)

**What 03B owns exclusively (not upstream):**

* `/api/tutor/*` endpoint contracts  
* Turn flow state machine and persistence ordering (§13)  
* Inference result cache for retry cost recovery (§13.5, §12B.4) — genuinely LISA-specific  
* Vertex AI context cache integration (§12B.5) — LISA-specific, not in 01A  
* LISA-specific soft-warning UX and quota appeal surface (§15.3, §15.5)  
* LISA-specific anti-leak enforcement at the API boundary (§16)  
* `tutor_error_codes` registry (§27B) — LISA-specific error taxonomy mapping to HTTP status

Every invariant from Doc 03 Main §11 that has an API touchpoint is enforced here:

* INV-03-02 (live exam unavailability) — blocked at API layer for full-length-in-progress state  
* INV-03-03 (paid entitlement requirement) — re-checked per request via V8 `EntitlementService`  
* INV-03-04 (no pre-submit answer reveal) — context filter invoked before orchestration  
* INV-03-05 (zero guardian access) — RLS \+ API role check  
* INV-03-06 (server-authoritative context) — client-supplied references validated server-side  
* INV-03-07 (age 13 minimum) — enforced inside V8 `canAccessFeature`  
* INV-03-08 (Tier 1 country gating) — enforced inside V8 `canAccessFeature`  
* INV-03-16 (crisis classifier per turn) — every append-turn invokes classifier via orchestrator  
* INV-03-18 (per-boundary entitlement check) — enforced here, the primary location; re-checked on every turn, not cached across conversation  
* INV-03-19 (7-day soft-delete window) — retention semantics respected in list/fetch paths per V8 §40

## **0.3 Supersession Notice**

**Superseded by V3:** Doc 03B V2.0 is superseded by this document. V2's endpoint contracts and persistence ordering are preserved. V2's primitive reimplementations (entitlement cache, abuse scoring, HMAC convention, rate limit counter storage) are superseded by consumption of upstream canonicals in V8 \+ 01A \+ 03A V3.

**Superseded by V1 (preserved from V1 supersession):** Prior internal draft titled "TUTOR\_API\_AND\_RUNTIME\_FLOW\_CONTRACT" — rebased as Doc 03B V1. All content from the prior draft either appears here updated or is explicitly replaced by decisions from Doc 03 Main V1.1, Doc 03A V3, Doc 01 V8, and Doc 01A V1.

**Not superseded:** Doc 03A V3 context resolution, Doc 02B V4 runtime engines, Doc 01 V8 entitlement model, Doc 01A V1 platform primitives, Doc 03 Main V1.1 persona and invariants.

## **0.4 V1 and launch terminology**

Doc 03B uses "V1" and "launch" interchangeably for the initial commercial release. "V2" denotes near-term post-launch. "Future target" denotes undated longer-term items. The version suffix on this document itself (V3.0) refers to the document revision, not the product version — at document V3, the product is still at V1 launch target.

---

# **Part I — Core Principles**

## **§1 Core Principles**

LISA's API layer is governed by eleven core principles.

### **1.1 Server resolves truth**

Clients send references (IDs, claims about state). The API resolves the authoritative records. Client claims about student identity, entitlement, role, session state, current question, or any product state are inputs that must be validated, never trusted.

### **1.2 Authenticated and paid-only**

Every tutor endpoint requires a valid authenticated student session. Every endpoint requires active Paid entitlement at V1. Unauthenticated, Free-tier, downgraded, or expired students are blocked with clear error responses.

### **1.3 Guardian exclusion**

Guardians cannot invoke any tutor endpoint. Role checks reject guardian JWTs at the API boundary before any data access. No guardian view of tutor data exists at the API layer or any other layer (INV-03-05).

### **1.4 Blocking logs**

Message persistence and policy-assignment persistence are blocking for every turn. If either fails, the turn is not treated as successful. The API does not return a response claiming success while canonical logs are missing.

### **1.5 Anti-leak at the boundary**

Context scrubbing happens before orchestration. Output scanning happens after orchestration. The API layer is the last line of defense before a response leaves the server — it enforces both checks.

### **1.6 Idempotency required**

All state-changing operations accept an idempotency key (`client_turn_id` for message append, implicit via `conversation_id` for close). Duplicate retries never create duplicate state. Implementation delegates to 01A Part IV `IdempotencyService` with scope `tutor_turn` (§14).

### **1.7 Bounded synchronous semantics**

V1 is request/response synchronous. Streaming is explicitly out of scope for V1 (§14). Requests complete within the orchestrator timeout (default 8000ms) or fail with a recoverable error envelope.

### **1.8 Fail closed**

When invariants can't be verified (entitlement check errors, orchestrator unreachable, context resolution fails), the API fails closed with a clear error response. No request completes based on partial or assumed state.

### **1.9 Runtime constants live in DB tables**

Every runtime value that could plausibly need tuning — quota thresholds, rate limits, character bounds, timeout values, cache TTLs, freshness windows, pagination defaults, error message templates, country allow-lists, age bounds — lives in `tutor_context_runtime_config` (per 01A §8 naming convention, §27A) and is loaded into process memory at startup with periodic refresh via 01A §4 LISTEN/NOTIFY invalidation. Hardcoded magic numbers in application code are a failure mode, not a feature.

Consequences of this principle:

* Values can be adjusted without code deploy (faster iteration on calibration)  
* Values are auditable via `tutor_context_runtime_config_history` (per 01A §5 shared-append-only pattern)  
* Values can vary by environment (different thresholds in staging vs production per 01A §7)  
* Application layer must gracefully handle config unavailability at startup (fail-fast with `MissingRequiredConfigError` per 01A §0.6 bootstrap order)  
* Values are versioned in the history table for rollback

Throughout Doc 03B, numeric values shown are the launch defaults that get seeded into `tutor_context_runtime_config`. The authoritative values at runtime are the config table values. Whenever this document shows a specific number, the corresponding `config_key` is referenced per §27A.

### **1.10 Upstream canonicals owned once**

03B does not reimplement primitives that V8 or 01A canonically own. The principle: every primitive (entitlement, abuse scoring, rate limiting, idempotency, caching, config, observability, internal service auth) is owned by exactly one document across the stack. 03B consumes via canonical interfaces; 03B does not define or duplicate.

Consequences:

* V2's `tutor_abuse_scores` table is removed in V3 — consume 01A `abuse_scores` instead  
* V2's inline entitlement SQL \+ Redis cache is removed — consume V8 `EntitlementService` instead  
* V2's per-cache invalidation mechanics are removed — consume 01A Part III two-tier pattern  
* V2's inline HMAC signing spec is removed — consume 01A Part VII convention

Where LISA-specific behavior genuinely can't be expressed through a canonical (inference retry cache, Vertex AI context cache, LISA error code mapping), it stays in 03B. See §0.2 "What 03B owns exclusively."

### **1.11 Cloud Run and Vertex AI topology awareness**

LISA's API surface runs on Google Cloud Run: stateless container instances, autoscaled, ephemeral. Orchestration invokes Vertex AI Gemini. This topology has implications that generic 01A patterns do not cover:

**Cloud Run implications:**

* In-process caches are per-instance and do not survive scale-in (instance termination on scale-down)  
* New instances start with cold caches — warm-up behavior affects p99 latency during scale-up bursts  
* Instances can be scheduled with no warning; in-flight requests honor graceful shutdown signal (SIGTERM → drain → exit) but long-running orchestration calls may be cut short  
* Cross-instance coordination flows through Postgres tier (01A Part III) — instances do not share in-process state  
* LISTEN/NOTIFY subscribers require a persistent connection; this works in Cloud Run only if the instance maintains an idle Postgres connection, which has cost implications (see §12A.4)

**Vertex AI implications:**

* Context caching is a Vertex-specific cost/latency optimization for stable prefixes (system prompt, teaching profile summaries) — worth using, not covered by 01A Part III (§12B.5)  
* Vertex request latency dominates the turn budget (P95 \~3-5s for Gemini Pro-class models) — all other steps must fit comfortably in the remaining budget  
* Vertex rate limits are platform-imposed (RPM/TPM quotas per region) — can produce 429s from the model that we must distinguish from our own 01A `RateLimitLedger` 429s  
* Vertex outages cascade to 100% tutor unavailability — failure matrix explicitly addresses this (§28A)

These concerns are called out inline where relevant and summarized in §28C Cloud Run Operational Contract.

---

# **Part II — Authentication and Authorization**

## **§2 Authentication**

### **2.1 Identity provider**

Lyceon uses Supabase Auth. Every tutor request carries a JWT issued by Supabase. The JWT is validated by the API gateway (or equivalent middleware) before any tutor endpoint logic runs.

### **2.2 JWT validation steps**

On every request to any `/api/tutor/*` endpoint:

1. Extract `Authorization: Bearer <jwt>` header. If absent or malformed, respond `401 Unauthenticated`.  
2. Verify JWT signature against Supabase's public key. If invalid, `401 Unauthenticated`.  
3. Verify JWT not expired. If expired, `401 Unauthenticated` with `token_expired` error code.  
4. Extract `sub` claim as `auth_user_id`. This is the authenticated user's ID.  
5. Proceed to authorization (§3).

### **2.3 Session binding**

The API does not maintain server-side sessions beyond what Supabase provides. JWT is the session token. Refresh is handled by the Supabase client library on the frontend; the API never issues or refreshes tokens.

### **2.4 Service role bypass (internal endpoints only)**

Internal endpoints (memory refresh, archival jobs) use Supabase service role keys with dedicated narrowed roles per Doc 03A V3 §17.4. These keys never flow through the client; they are scoped to server-to-server calls within the Lyceon platform.

## **§3 Authorization**

### **3.1 Role check**

After JWT validation, the API resolves the user's role via a query against `profiles`:

SELECT id, role, tier, age\_years, country\_code  
FROM profiles  
WHERE id \= $auth\_user\_id;

Allowed roles for LISA endpoints: `student` only. Any other role (`guardian`, `admin`, `support`) receives `403 Forbidden` with error code `role_not_permitted`.

Operational note: this read is cached per 01A Part III topology using key `profile:role:{auth_user_id}` with 60s TTL; LISTEN/NOTIFY invalidation on `profiles_updated` channel when role changes. Cache miss falls through to DB read; hard staleness bound 300s before fail-closed.

### **3.2 Entitlement check — delegated to V8**

Entitlement verification is not 03B's to define. The canonical call is:

const access \= await entitlementService.canAccessFeature(  
  'tutor\_access',  
  authUserId,  
  { request\_id, source\_surface }  
);

V8 §27.3 is authoritative for the check semantics — tier, age, country, entitlement status, expiry, and 01A §50 abuse-score tier check at step 7\. 03B does not re-implement these conditions. V8 owns:

* Profile tier check per INV-03-03  
* Age check per INV-03-07  
* Country check per INV-03-08  
* Entitlement status and expiry  
* Abuse-score tier check via 01A Part VI

03B responsibilities:

* Call `canAccessFeature` at the authorization boundary (§3.2, early in every request)  
* Translate denial reason to HTTP error per the table in §3.2.1  
* Emit observability event for every call per §22.7  
* Honor V8's fail-closed posture on check failure

### **3.2.1 Translation of V8 denial reasons to HTTP responses**

| V8 `canAccessFeature` outcome | HTTP status | `error.code` | User-facing message |
| ----- | ----- | ----- | ----- |
| `allow: true` | (proceed to §3.3) | — | — |
| `allow: false, reason: not_authenticated` | 401 | `authentication_required` | "Please sign in to continue." |
| `allow: false, reason: wrong_role` | 403 | `role_not_permitted` | Generic auth error (never expose role detail) |
| `allow: false, reason: age_below_minimum` | 403 | `age_restriction` | "This feature requires an older account." |
| `allow: false, reason: country_not_supported` | 403 | `country_restriction` | "LISA is not available in your region yet." |
| `allow: false, reason: no_active_entitlement` | 403 | `entitlement_required` | "Your LISA access needs to be renewed." |
| `allow: false, reason: entitlement_expired` | 403 | `entitlement_required` | Same as above |
| `allow: false, reason: abuse_score_lockout` | 403 | `account_under_review` | Generic "contact support" per 01A §57 no-visibility rule — never mention abuse score |
| `allow: false, reason: manual_suspension` | 403 | `account_under_review` | Generic |

**Observability:** every call emits `tutor_entitlement_check` event per §22.7 with `allow` boolean and `reason` label (bounded cardinality, safe as metric dimension per 01A §15).

### **3.2.2 Service unavailability**

If `canAccessFeature` throws per V8's error classes:

* `AbuseScoreUnavailableError` (01A §0.6) — V8 fail-closed posture honored  
* `CacheUnavailableError` — V8 fail-closed posture honored  
* Timeout — HTTP 503 `service_degraded` per 01A §0.6 mapping; client sees "Verifying your account, please try again"

03B does not override V8's fail-closed default with 03B-level grace periods. The `no grace period` invariant (INV-03-18) is preserved through V8's binary decision contract.

### **3.2.3 Why no 03B-level entitlement cache**

V2 had a 60s Redis cache at 03B for entitlement decisions. V3 removes this: V8 owns entitlement caching internally (V8 §27.3 caches the underlying `entitlements` \+ `profiles` reads). Adding a second cache layer at 03B would produce double-invalidation complexity without latency improvement — V8's cache is closer to the decision logic. 03B calls `canAccessFeature` every request; the V8-owned cache absorbs the read load.

**Operational Contract:**

* **Fail posture:** fail-closed (INV-03-18, V8 §27.3 binary)  
* **Timeout:** inherited from V8 (default 200ms for `canAccessFeature`; V8 owns this config key)  
* **Retry:** none at 03B (V8 owns internal retry semantics for DB reads)  
* **Fallback:** none — fail-closed is the design  
* **Degraded mode:** 503 to client; natural retry  
* **Owner:** V8 for decision logic; 03B for translation and observability

### **3.3 Conversation ownership check**

For endpoints that reference a specific `conversation_id` (append turn, fetch, close), the API verifies ownership:

SELECT student\_id  
FROM tutor\_conversations  
WHERE id \= $conversation\_id  
  AND deleted\_at IS NULL;

If the student\_id does not match `auth_user_id`, respond `404 Not Found` (not `403`, to avoid leaking existence of other students' conversations).

If the conversation is soft-deleted (`deleted_at IS NOT NULL`), respond `404 Not Found`.

**Caching:** ownership check uses 01A Part III two-tier pattern with key `conv_owner:{conversation_id}`, 60s soft TTL / 300s hard staleness. Invalidation on conversation close/abandon/soft-delete via `conversation_updated` LISTEN/NOTIFY channel.

**Operational Contract:**

* **Fail posture:** fail-closed on DB unreachable past hard staleness  
* **Timeout:** 50ms cache lookup; 200ms DB fallback; 300ms hard ceiling  
* **Retry:** none at API layer; 01A §28 handles cache listener reconnection  
* **Fallback:** hard-staleness cache serve up to 300s during DB outage  
* **Degraded mode:** 503 to client past hard staleness  
* **Owner:** 03B (tutor-specific table)

### **3.4 Full-length exam block**

Before allowing any tutor turn, check if the student has an active full-length exam session:

SELECT 1  
FROM full\_length\_exams  
WHERE student\_id \= $auth\_user\_id  
  AND status \= 'in\_progress'  
LIMIT 1;

If a row exists, respond `403 Forbidden` with error code `tutor_unavailable_during_live_exam`. This is INV-03-02.

**Caching:** 01A Part III pattern with key `live_exam:{student_id}`, 30s soft TTL (shorter than other caches because exam state transitions affect tutor availability and false-positives violate INV-03-02). 60s hard staleness. Invalidation on exam start/complete/abandon via `exam_status_changed` LISTEN/NOTIFY channel.

**Operational Contract:**

* **Fail posture:** fail-closed (INV-03-02 is absolute)  
* **Timeout:** 50ms cache; 150ms DB fallback  
* **Retry:** none  
* **Fallback:** 60s hard-staleness cache serve during DB outage (narrower than other caches due to INV severity)  
* **Degraded mode:** 503 if DB unreachable past hard staleness  
* **Owner:** Doc 02B (exam table) for source of truth; 03B for read path

---

# **Part III — Endpoint Specifications**

## **§4 Endpoint Catalog**

V1 LISA API surface:

| Method | Path | Purpose | Auth |
| ----- | ----- | ----- | ----- |
| POST | `/api/tutor/conversations` | Start or resolve/reuse a conversation | Student |
| POST | `/api/tutor/messages` | Append turn, get tutor response | Student |
| GET | `/api/tutor/conversations/:id` | Fetch conversation with messages | Student |
| GET | `/api/tutor/conversations` | List recent conversations | Student |
| POST | `/api/tutor/conversations/:id/close` | Mark conversation closed or abandoned | Student |

Internal (service-to-service, no public endpoint):

* Memory refresh writes via `tutor_memory_writer` role (Doc 03A V3 §9, §17.4)  
* Archival writes via `tutor_archival_writer` role  
* Injection log writes via `tutor_injection_writer` role

## **§5 POST /api/tutor/conversations — Start Conversation**

### **5.1 Purpose**

Create a new tutor conversation, or resolve and reuse an eligible active one per the reuse rule (§5.5).

### **5.2 Auth**

Student only. All checks from Part II apply.

### **5.3 Request shape**

{  
  "entry\_mode": "scoped\_question | scoped\_session | general",  
  "source\_surface": "practice | review | test\_review | dashboard",  
  "source\_session\_id": "uuid | null",  
  "source\_session\_item\_id": "uuid | null",  
  "source\_question\_row\_id": "uuid | null",  
  "source\_question\_canonical\_id": "text | null"  
}

### **5.4 Input validation**

Before processing:

1. `entry_mode` must be one of the three enum values  
2. `source_surface` must be one of the four enum values  
3. `entry_mode` and `source_surface` consistency: `scoped_question` requires a non-null question reference; `general` from dashboard with all nulls is valid; others enumerated in Appendix A  
4. UUIDs if present must be valid UUIDv4  
5. If `source_session_id` or `source_question_row_id` are provided, they must resolve to existing rows owned by the authenticated student (validated via RLS — cross-student references return null → treated as invalid reference)

Invalid input responds `400 Bad Request` with error code `invalid_input` and details on which field failed.

### **5.5 Server steps**

1. Validate JWT and role (Part II §2, §3.1)  
2. Check entitlement (§11) — fail closed with `403 Forbidden` \+ `entitlement_required` if not Paid/active  
3. Check age and country (§11.2) — fail with `403 Forbidden` if ineligible  
4. Check live exam block (§3.4) — fail with `403 Forbidden` if in-progress exam  
5. Validate request payload per §5.4  
6. Resolve trusted scope from references:  
   * For each non-null reference, verify it exists and belongs to the student  
   * Populate `resolved_scope` with validated values  
   * Stale or unresolvable references → clear that field (fall back to broader scope)  
7. Apply reuse rule (§5.5) — check for eligible existing active conversation  
8. If reusing: return existing conversation  
9. If creating: insert new `tutor_conversations` row via `tutor_runtime_writer` role  
10. Return canonical conversation envelope (§5.7)

### **5.6 Reuse rule**

Conversation reuse is allowed when all match on an existing active conversation:

* Same authenticated `student_id`  
* Same `source_surface`  
* Same `entry_mode`  
* Same `source_session_id` (or both null)  
* Same `source_session_item_id` (or both null)  
* Same `source_question_row_id` (or both null) — canonical ID is supplementary  
* Existing conversation `status = 'active'`  
* Existing conversation `deleted_at IS NULL`  
* **Existing conversation `updated_at > now() - interval '<freshness.conversation_reuse_days> days'`** — default 7 days per `freshness.conversation_reuse_days` config key; conversations stale beyond this window are not reused

**Resolution when multiple eligible:** Pick the most recently updated (by `updated_at DESC`). This is per Doc 03A V3 §18.1 CR-03A-17 — the DB allows multiple active conversations per envelope; the API picks the most recent.

**If no eligible conversation exists (none matching OR all stale):** Create a new one. Stale conversations remain in the DB under their active status until either (a) the soft-delete retention window expires, or (b) an explicit close is requested. The freshness window governs reuse eligibility only, not lifecycle transitions.

Rationale for freshness window (CR-03B-24): prevents reviving weeks-old conversations that the student has contextually abandoned. A student returning 45 days later and clicking the same question gets a fresh conversation rather than resuming context that no longer makes sense. The 7-day default is a calibration target; the value lives in `tutor_context_runtime_config` for tuning.

Rationale for "pick most recent" vs "unique by envelope": preserves flexibility for rare cases where duplicate active conversations exist (race condition, old client bug, explicit ops creation), while giving the expected default of "resume my last conversation on this thing."

### **5.7 Force-new (V2 target, not V1)**

V1 does not expose a `force_new: true` client parameter. Students who want a fresh conversation on an envelope with an existing active conversation must close the existing one first (POST /close). If product data post-launch shows this is commonly needed, V2 will add the parameter.

### **5.8 Response shape**

Success (`200 OK` for reuse, `201 Created` for new):

{  
  "data": {  
    "conversation\_id": "uuid",  
    "reused": "boolean",  
    "entry\_mode": "scoped\_question | scoped\_session | general",  
    "source\_surface": "practice | review | test\_review | dashboard",  
    "status": "active",  
    "crisis\_flagged": false,  
    "resolved\_scope": {  
      "source\_session\_id": "uuid | null",  
      "source\_session\_item\_id": "uuid | null",  
      "source\_question\_row\_id": "uuid | null",  
      "source\_question\_canonical\_id": "text | null"  
    },  
    "created\_at": "timestamptz",  
    "updated\_at": "timestamptz"  
  }  
}

`reused: true` indicates the client can continue a prior conversation; the client loads existing messages via §7 fetch. `reused: false` indicates a fresh conversation with empty message history.

### **5.9 Error responses**

| Condition | Status | Error code |
| ----- | ----- | ----- |
| Missing or invalid JWT | 401 | `unauthenticated` |
| Token expired | 401 | `token_expired` |
| Guardian or non-student role | 403 | `role_not_permitted` |
| Not Paid tier or inactive entitlement | 403 | `entitlement_required` |
| Under 13 | 403 | `age_restricted` |
| Outside Tier 1 country | 403 | `region_not_supported` |
| Active full-length exam in progress | 403 | `tutor_unavailable_during_live_exam` |
| Invalid payload | 400 | `invalid_input` |
| Rate limit exceeded | 429 | `rate_limited` |
| Internal error | 500 | `internal_error` |
| Entitlement check error | 503 | `entitlement_check_unavailable` |

All error codes are registered in `tutor_error_codes` per §27B with canonical HTTP mappings, user message templates, and retry semantics. Application code reads error details from that table rather than hardcoding mappings.

**Status code change from V1 (CR-03B-21):** V1 used `402 Payment Required` for entitlement failures. V2 changes to `403 Forbidden` with `error.code = "entitlement_required"`. Rationale: 402 has inconsistent handling across HTTP proxies, CDNs, browser fetch, and client SDKs; some treat it as a client error requiring payment UI, others as an unrecognized status. 403 is universally understood as "you cannot access this" with the error code carrying the specific reason. Client UX remains unchanged — the client reads `error.code` and renders the entitlement renewal flow.

## **§6 POST /api/tutor/messages — Append Turn**

### **6.1 Purpose**

Persist a student turn, build context envelope, invoke orchestration, scan output, persist tutor response, return response to client.

This is the primary endpoint. Every meaningful student-LISA interaction flows through this.

### **6.2 Auth**

Student only. All Part II checks apply. Ownership check (§3.3) on `conversation_id`.

### **6.3 Request shape**

{  
  "conversation\_id": "uuid",  
  "message": "text",  
  "content\_kind": "message | suggestion | consent\_prompt | system\_note",  
  "client\_turn\_id": "uuid",  
  "client\_scope": {  
    "source\_session\_id": "uuid | null",  
    "source\_session\_item\_id": "uuid | null",  
    "source\_question\_row\_id": "uuid | null",  
    "source\_question\_canonical\_id": "text | null"  
  }  
}

### **6.4 Input validation**

Beyond Part II checks:

1. `conversation_id` must exist, be active (`status = 'active'`), not soft-deleted, owned by student  
2. `message` must be non-empty and ≤ 4000 characters (per Doc 03A V3 §12.3 length bound)  
3. `content_kind` must be a valid enum value; default `message` if absent  
4. `client_turn_id` must be a valid UUIDv4 and required (idempotency key — §9)  
5. `client_scope` fields if present must be valid UUIDs; stale or unresolvable references are ignored per §6.6

### **6.5 Server steps — authoritative order**

For a successful tutor turn, steps execute in this exact order. Failure at any step maps to a response per §6.7.

1. **Validate JWT and role** (Part II §2, §3.1)  
2. **Check entitlement** (§11) — per-boundary check (INV-03-18)  
3. **Check age and country** (§11.2)  
4. **Check live exam block** (§3.4)  
5. **Verify conversation ownership** (§3.3)  
6. **Validate request payload** (§6.4)  
7. **Check rate limits** (§12) — daily, weekly, monthly quotas per Doc 03 Main §13  
8. **Check idempotency** (§9) — if `client_turn_id` already persisted, skip to step 12  
9. **Re-resolve scope** — load stored conversation scope; reconcile with `client_scope` per precedence rule (§6.6)  
10. **Run input sanitization** — length bound, tag pass-through escaping, injection pattern scan (Doc 03A V3 §12.3)  
11. **Persist student message** to `tutor_messages` via `tutor_runtime_writer`  
12. **Persist instructional assignment** to `tutor_instruction_assignments` via `tutor_runtime_writer`  
13. **Build context envelope** via Doc 03A V3 §5.4 — loads conversation history, memory summaries, student learning context  
14. **Invoke orchestration** via Doc 03C — crisis classifier, model call, structured output parse  
15. **Run anti-leak output scan** on orchestrator response (Doc 03 Main §18 Layer 4\)  
16. **Persist tutor message** to `tutor_messages`  
17. **Persist question links** to `tutor_question_links` if any  
18. **Persist instruction exposures** to `tutor_instruction_exposures` if any  
19. **Return success response** (§6.8)

This sequence exists so that:

* The student turn is never invisible (persisted before orchestration)  
* The policy decision is logged before the tutor reply is accepted  
* The tutor reply is not returned unless all blocking writes succeeded  
* Anti-leak scan happens after generation and before response  
* The orchestrator never sees un-validated input

### **6.6 Scope precedence rule**

The scope used for context resolution follows this precedence:

1. **Stored conversation scope** (from `tutor_conversations` row) is authoritative  
2. **`client_scope`** may supplement missing scope fields (e.g., the conversation was created at session-scope but the client is now on a specific question — the question canonical\_id can fill in)  
3. **`client_scope` may NOT override a valid stored scope** — if stored has `source_question_canonical_id = 'SATM1ABC123'` and client sends `'SATM1DEF456'`, the client field is ignored  
4. **Any conflict between client and server scope is logged** to `reason_snapshot.scope_conflict` on the instruction assignment for this turn

This rule prevents clients from redirecting conversations to unintended scopes mid-turn and prevents injection attacks that attempt to use scope references as a side channel.

### **6.7 Response shape**

Success (`200 OK`):

{  
  "data": {  
    "conversation\_id": "uuid",  
    "message\_id": "uuid",  
    "client\_turn\_id": "uuid",  
    "response": {  
      "content": "text",  
      "content\_kind": "message",  
      "suggested\_action": {  
        "type": "none | offer\_similar\_question | offer\_broader\_coaching | offer\_stay\_focused",  
        "label": "text | null"  
      },  
      "ui\_hints": {  
        "show\_accept\_decline": "boolean",  
        "allow\_freeform\_reply": "boolean",  
        "suggested\_chip": "text | null"  
      }  
    },  
    "conversation\_updated\_at": "timestamptz"  
  }  
}

Recoverable failure (`503 Service Unavailable` with retry-after) — §13.3:

{  
  "error": {  
    "code": "orchestration\_failed\_recoverable",  
    "message": "Tutor orchestration encountered a transient failure. Please retry with the same client\_turn\_id.",  
    "retry\_after\_ms": 2000,  
    "details": {  
      "failure\_layer": "orchestrator | model | context\_resolution"  
    }  
  }  
}

Blocking failure (various 4xx/5xx) — §13.1:

{  
  "error": {  
    "code": "canonical\_write\_failed",  
    "message": "A canonical log write failed; the turn was not completed. Retry with the same client\_turn\_id.",  
    "retry\_after\_ms": null  
  }  
}

### **6.8 Idempotency behavior on retry**

If `client_turn_id` matches an existing `tutor_messages` row for this conversation:

* The student message is not duplicated (unique constraint prevents this at DB layer)  
* If a tutor response message was already persisted for this turn, the cached response is returned with `200 OK` and an internal flag `cached: true` (not exposed to client)  
* If the student message was persisted but the tutor response was not (previous request failed mid-flow), the server attempts to complete the flow from where it stopped, or returns a recoverable-failure response asking the client to retry once more

### **6.9 Error responses**

| Condition | Status | Error code |
| ----- | ----- | ----- |
| Missing or invalid JWT | 401 | `unauthenticated` |
| Not Paid tier or inactive entitlement | 403 | `entitlement_required` |
| Guardian or non-student role | 403 | `role_not_permitted` |
| Live exam in progress | 403 | `tutor_unavailable_during_live_exam` |
| Age restricted | 403 | `age_restricted` |
| Region not supported | 403 | `region_not_supported` |
| Conversation not found or not owned | 404 | `conversation_not_found` |
| Conversation soft-deleted | 404 | `conversation_not_found` |
| Conversation closed | 409 | `conversation_closed` |
| Invalid payload (missing fields, wrong types, \>max\_chars) | 400 | `invalid_input` |
| Rate limit exceeded | 429 | `rate_limited` |
| Quota exceeded (daily/weekly/monthly) | 429 | `quota_exceeded` |
| Idempotency key conflict (same key, different content) | 409 | `idempotency_conflict` |
| Canonical write failure (blocking) | 500 | `canonical_write_failed` |
| Orchestration transient failure (recoverable) | 503 | `orchestration_failed_recoverable` |
| Orchestration permanent failure | 500 | `orchestration_failed` |
| Entitlement check service error | 503 | `entitlement_check_unavailable` |

All mappings seeded in `tutor_error_codes` per §27B. Error message templates are not hardcoded in application code — they are loaded from the table at startup with periodic refresh. Localization of error messages (V2 target) uses the same table with additional `locale` column.

## **§7 GET /api/tutor/conversations/:id — Fetch Conversation**

### **7.1 Purpose**

Return a student-owned tutor conversation with message history.

### **7.2 Auth**

Student only. Ownership check (§3.3).

### **7.3 Query parameters**

* `message_limit` (optional, default `validation.message_pagination_default` \= 50, max `validation.message_pagination_max` \= 200\) — maximum number of messages to return  
* `before_message_id` (optional) — pagination cursor; return messages before this ID

**Cursor encoding (CR-03B-28):**

Cursors are opaque base64-encoded strings. The client must treat them as opaque — no structure, ordering, or parsing is guaranteed. Server-side format:

cursor\_raw \= {  
  "v": 1,  
  "sort": "created\_at\_desc",  
  "anchor\_ts": "2026-04-23T14:35:22.123Z",  
  "anchor\_id": "uuid"  
}  
cursor\_encoded \= base64url(json(cursor\_raw))

Version field enables future cursor format changes without breaking clients. Anchor timestamp \+ UUID together provide stable pagination even with equal-timestamp messages. Cursor format version bump triggers server-side migration — old cursors accepted during transition window.

### **7.4 Server steps**

1. Validate JWT and role  
2. Check entitlement  
3. Verify conversation ownership  
4. Load conversation row  
5. Load messages with pagination  
6. Return envelope

### **7.5 Response shape**

{  
  "data": {  
    "conversation": {  
      "conversation\_id": "uuid",  
      "entry\_mode": "text",  
      "source\_surface": "text",  
      "status": "text",  
      "resolved\_scope": { /\* ... \*/ },  
      "created\_at": "timestamptz",  
      "updated\_at": "timestamptz",  
      "closed\_at": "timestamptz | null"  
    },  
    "messages": \[  
      {  
        "message\_id": "uuid",  
        "role": "student | tutor | system",  
        "content\_kind": "text",  
        "message": "text",  
        "created\_at": "timestamptz"  
      }  
    \],  
    "pagination": {  
      "has\_more": "boolean",  
      "next\_cursor": "uuid | null"  
    }  
  }  
}

### **7.6 Error responses**

Standard auth/entitlement errors plus:

| Condition | Status | Error code |
| ----- | ----- | ----- |
| Conversation not found or not owned | 404 | `conversation_not_found` |

## **§8 GET /api/tutor/conversations — List Recent Conversations**

### **8.1 Purpose**

Return the authenticated student's recent conversations, most recent first.

### **8.2 Auth**

Student only.

### **8.3 Query parameters**

* `limit` (default `validation.pagination_default` \= 20, max `validation.pagination_max` \= 100\) — number of conversations  
* `cursor` (optional) — pagination cursor, opaque base64-encoded per §7.3 cursor format specification  
* `source_surface` (optional) — filter by surface  
* `status` (optional) — filter by status (default: `active` and `closed`; excludes `abandoned` unless explicitly requested)

### **8.4 Server steps**

1. Validate JWT and role  
2. Check entitlement  
3. Query conversations scoped to student\_id with filters and pagination  
4. Exclude soft-deleted (`deleted_at IS NULL`)  
5. Return envelope

### **8.5 Response shape**

{  
  "data": {  
    "conversations": \[  
      {  
        "conversation\_id": "uuid",  
        "entry\_mode": "text",  
        "source\_surface": "text",  
        "status": "text",  
        "resolved\_scope": { /\* ... \*/ },  
        "last\_message\_preview": "text | null",  
        "message\_count": "integer",  
        "created\_at": "timestamptz",  
        "updated\_at": "timestamptz"  
      }  
    \],  
    "pagination": {  
      "has\_more": "boolean",  
      "next\_cursor": "text | null"  
    }  
  }  
}

`last_message_preview` is truncated to 100 characters for list display. Clients that want full message content call `GET /api/tutor/conversations/:id`.

## **§9 POST /api/tutor/conversations/:id/close — Close Conversation**

### **9.1 Purpose**

Mark a conversation as closed or abandoned. May trigger async memory compaction per Doc 03A V3 §9.1.

### **9.2 Auth**

Student only. Ownership check.

### **9.3 Request shape**

{  
  "status": "closed | abandoned"  
}

* `closed` — student finished intentionally (UI close button)  
* `abandoned` — client detected implicit abandonment (tab closed, timeout, etc.)

### **9.4 Server steps**

1. Validate JWT and role  
2. Check entitlement  
3. Verify conversation ownership  
4. Verify conversation is not already closed (`status = 'active'`)  
5. Update `tutor_conversations.status`, `closed_at = now()`  
6. Enqueue async memory compaction job (Doc 03C owns execution)  
7. Return success

### **9.5 Response shape**

{  
  "data": {  
    "conversation\_id": "uuid",  
    "status": "closed | abandoned",  
    "closed\_at": "timestamptz"  
  }  
}

### **9.6 Error responses**

Standard plus:

| Condition | Status | Error code |
| ----- | ----- | ----- |
| Conversation already closed | 409 | `conversation_already_closed` |
| Invalid status value | 400 | `invalid_input` |

### **9.7 Note on close and retention**

Closing a conversation does not delete it. The conversation remains accessible via fetch for the retention window per Doc 03 Main §14.2 (active \+ 7 days post-entitlement-loss, or until explicit account deletion). Close is a lifecycle state transition, not a deletion.

## **§10 Internal Worker Endpoints**

V1 internal writes for memory summaries, instruction exposures, archival, and injection logging are service-to-service operations, not public HTTP endpoints. They use dedicated service roles per Doc 03A V3 §17.4 and run via:

* Supabase Edge Functions for memory refresh (invoked by pg\_cron)  
* Scheduled cron jobs for archival and soft-delete cleanup  
* Doc 03C orchestrator direct writes for instruction exposures (where applicable)

No client-facing HTTP endpoint exposes these writes. Any future internal endpoint added for operations (admin tooling, support) must be on a separate route prefix (`/api/internal/tutor/*`) with service role authentication, audit logging, and explicit ops approval.

---

# **Part IV — Trusted Scope Resolution**

## **§11 Scope Resolution**

Trusted scope is the server-authoritative identification of what the current conversation is about: the student, the session, the item, the question. Clients send references; the API resolves them against canonical records.

### **11.1 Resolution order**

For every tutor request that requires scope (conversation start, append turn):

1. **Authenticated `student_id`** — from JWT `sub` claim, validated per Part II  
2. **Existing conversation scope** — loaded from `tutor_conversations` if `conversation_id` is provided; this is authoritative for ongoing conversations  
3. **Validated client references** — from `source_session_id`, `source_session_item_id`, `source_question_row_id`, `source_question_canonical_id`; each verified to exist and belong to the student  
4. **Fallback path** — if any reference is stale, missing, deleted, or unauthorized, apply fallback per §11.3

### **11.2 Reference validation queries**

For each non-null client reference, validate ownership:

\-- source\_session\_id validation (practice session)  
SELECT 1 FROM practice\_sessions  
WHERE id \= $source\_session\_id AND student\_id \= $auth\_user\_id;  
\-- OR (review session)  
SELECT 1 FROM review\_sessions  
WHERE id \= $source\_session\_id AND student\_id \= $auth\_user\_id;  
\-- OR (full-length exam)  
SELECT 1 FROM full\_length\_exams  
WHERE id \= $source\_session\_id AND student\_id \= $auth\_user\_id;

\-- source\_question\_row\_id validation  
SELECT id, canonical\_id FROM questions  
WHERE id \= $source\_question\_row\_id AND active \= true;

If a session ID doesn't resolve to an owned session of any of the three types, the reference is invalid and cleared (treated as null).

If a question row doesn't exist or is inactive (retired), the reference is cleared.

If both row\_id and canonical\_id are provided, they must match. Mismatch is treated as an invalid reference (clear both, fall back).

### **11.3 Fallback chain**

When scope resolution finds stale or invalid references:

1. **Use most recent valid scoped item** in the same conversation if one exists (loaded from recent `tutor_messages` turn-level scope fields)  
2. **Degrade to `scoped_session`** if the source session still exists (keep session scope, drop question scope)  
3. **Degrade to `general`** with explicit student-facing fallback prompt

Every fallback is logged to `reason_snapshot.fallback_used = true` on the instruction assignment.

### **11.4 No fail-open rule**

Missing scope must not cause broad unrelated retrieval across the student's history or across other students. If scope resolution fails entirely (no valid references, no conversation history to fall back on), the API returns a scope-resolution error rather than proceeding with unbounded context.

### **11.5 Scope immutability within a conversation**

Per Doc 03A V3 §2.4, `entry_mode` and `source_surface` on a conversation are immutable after creation. Re-resolution produces scope fields consistent with the original envelope; it does not rewrite entry\_mode or source\_surface.

---

# **Part V — Entitlement and Access Enforcement**

## **§12 Per-Request Entitlement Check (INV-03-18)**

V3 collapses §12 to a short delegation section. The full semantics are owned by V8 §27.3 and invoked from 03B at §3.2.

### **12.1 Where the check happens**

Every student-facing tutor request invokes `entitlementService.canAccessFeature('tutor_access', authUserId, { request_id, source_surface })` during authorization (§3.2), before any other data read or mutation. The check is part of the thin handler per Lyceon coding standards §8.1 ordering:

1\. Auth (JWT validation) — §2  
2\. Role check — §3.1  
3\. Entitlement check — THIS, via V8  
4\. Conversation ownership — §3.3  
5\. Full-length exam block — §3.4  
6\. Zod parse of input  
7\. Rate limit \+ quota check — §15  
8\. Idempotency check — §14  
9\. Domain logic (call into 03A context resolution, 03C orchestration)  
10\. Serialize and return

### **12.2 No grace period (INV-03-18)**

Binary pass/fail per V8 §27.3 semantics. A student whose entitlement expires at 03:00:00 cannot send a LISA turn at 03:00:01. V8 owns any internal cache TTL that might produce brief false-positive allows — 03B does not add a second cache layer.

### **12.3 Mid-conversation entitlement changes**

If entitlement changes during an active conversation (webhook fires, subscription ends, payment fails, abuse tier escalates), the next turn's check catches it. The `canAccessFeature` call is made per-turn, not cached across conversation. Existing conversation history persists per retention policy (§17, V8 §40).

Student sees: "Your LISA access needs to be renewed to continue this conversation." UI surfaces renewal path. For abuse lockout specifically, student sees generic "account under review" per §3.2.1 — never the underlying abuse tier.

### **12.4 Check failure behavior**

See §3.2.2. If V8 `canAccessFeature` throws, 03B responds 503 `service_degraded` and the client retries. 03B does not have a fallback cache or bypass path — fail-closed is the design.

### **12.5 Observability**

See §3.2 operational contract and §22.7 audit log emission. Every entitlement check emits a structured log event per 01A §11 logger interface with bounded-cardinality labels (`allow`, `reason`) safe for metrics per 01A §15.

---

# **Part V.5 — Caching Strategy (Cloud Run \+ Vertex AI Specifics)**

## **§12A Caching Philosophy and Delegation**

Caching for every generic concern — topology, key convention, TTL \+ hard-staleness pattern, LISTEN/NOTIFY invalidation, CacheEntry shape, cache stampede, listener reconnection — is canonically owned by Doc 01A Part III. 03B does not redefine these mechanics. V3 replaces V2's seven-layer spec with a short inventory of LISA caches (all following 01A Part III) plus expanded treatment of two LISA-specific concerns 01A does not cover:

1. **Cloud Run instance-ephemerality** — Tier 1 in-process caches have specific behavior on ephemeral Cloud Run containers that a static-topology spec cannot express  
2. **Vertex AI context caching** — LISA-specific optimization for stable prefixes sent to Gemini; not a generic primitive

Everything else in Part V.5 is a directory of LISA's cache consumers with a cross-reference to 01A.

### **12A.1 Principles inherited from 01A Part III**

* Caches are optimizations, not sources of truth (01A §21)  
* Authoritative source is Postgres (01A §22; no Redis per Lyceon stack — see §12A.2)  
* Two-tier topology: in-process (Tier 1\) \+ Postgres (Tier 2\) (01A §22)  
* Cache keys structured and namespaced per 01A §25 convention  
* `CacheEntry<T>` shape with soft TTL \+ hard staleness (01A §24)  
* LISTEN/NOTIFY invalidation on Postgres channels (01A §26, §27)  
* Reconnection with exponential backoff \+ jitter (01A §28)  
* Cache stampede protection via single-flight (01A hardening item, extended in §12E below)  
* No decision affecting security, entitlement, or data integrity is made from cache without defined fallback to authoritative source

### **12A.2 No Redis at the Lyceon stack**

Important architectural note inherited from 01A: the Lyceon stack uses Postgres for all cross-instance shared cache needs, not Redis. The in-process layer is per-instance memory. The Postgres layer provides cross-instance coordination via LISTEN/NOTIFY and authoritative reads.

V2 referenced Redis throughout. V3 removes all Redis references. Anything V2 specified as "Redis cache" is either:

* In-process (Tier 1\) — for stable, instance-local reads with LISTEN/NOTIFY invalidation  
* Postgres-backed (Tier 2\) — for cross-instance shared state (quota counters, idempotency records, inference cache)  
* Or genuinely unnecessary — eliminated

The two exceptions discussed below (Vertex context cache, inference retry cache) are both Postgres-backed in V3.

### **12A.3 CDN tier**

V1 does not use a CDN cache for tutor endpoints — all tutor endpoints are authenticated POST or authenticated GET with user-specific response content. CDN caching has no applicable surface here.

### **12A.4 Cloud Run instance-ephemerality — consequences for caching**

LISA's API instances run on Cloud Run. A Cloud Run instance is a container that the runtime can create, run, and destroy at any time based on traffic patterns. This has concrete implications that a static-topology cache spec cannot express:

**Instance lifecycle:**

* Instances start on demand and during scale-up (cold start adds latency, especially for first request hitting a fresh instance)  
* Instances terminate on scale-down (SIGTERM → grace period → SIGKILL); in-flight requests honor graceful shutdown if possible  
* Instances have no persistent local storage across restarts  
* There is no cross-instance memory — two instances serving the same student have independent in-process caches

**Cold-start cache behavior:**

* Fresh instances load `tutor_context_runtime_config` from Postgres at boot per 01A §3 bootstrap order (`loadAllConfig → init logger/metrics/pool → startConfigInvalidationListener → accept connections`)  
* Until bootstrap completes, the instance does not accept traffic (Cloud Run `PORT` binding happens after bootstrap per 01A §3)  
* Runtime config is a one-time DB read amortized across all future requests on this instance; acceptable overhead  
* Per-student caches (ownership, live exam, memory summary) are populated lazily on first use per student per instance; first request per (student, instance) pair pays DB fallback cost

**Cold-start implications on p99 latency:**

* During scale-up, a new instance handles its first N requests with cache misses falling through to DB  
* P99 latency alert threshold must tolerate this: cold instance handles traffic for \~10-30 seconds before cache populates  
* Aggressive pre-warming is not implemented at V1 — accepted p99 impact during scale-up events  
* V2 target: structured warm-up request that pre-populates `tutor_context_runtime_config` and issues synthetic health check before Cloud Run routes traffic

**Scale-in cache loss:**

* When Cloud Run terminates an instance, its in-process Tier 1 caches are destroyed  
* Correctness unaffected — Postgres is authoritative, next instance handles subsequent requests and populates its own cache  
* Observable symptom: brief spike in cache miss rate during scale-down events (visible in §22.12 SLI table)

**LISTEN/NOTIFY in Cloud Run (V4 closeout of AMB-V3-04 — explicit connection math):**

LISTEN requires a persistent Postgres connection per instance. This connection cannot be multiplexed through pgbouncer transaction-mode (LISTEN is session-scoped). It must use either direct Postgres connection or pgbouncer session-mode.

**Connection budget assumptions (V1 launch):**

* Supabase Team tier: 400 pool connections across all pooling modes (per [Supabase docs](https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pool-connection-limits))  
* Connection-mode allocation (V4 proposed split):  
  * Session-mode pool: 150 connections (LISTEN subscribers)  
  * Transaction-mode pool: 200 connections (regular query traffic)  
  * Direct / session-mode reserve: 50 connections (maintenance, migrations, admin)

**Per-instance connection demand:**

* 1 persistent LISTEN connection (session-mode pool)  
* 5-10 transient query connections (transaction-mode pool) — pgbouncer multiplexes, so this isn't 1:1 with concurrent requests

**Max Cloud Run instances supportable:**

* LISTEN ceiling: 150 (session-mode pool size)  
* Query ceiling: much higher due to multiplexing (\~200 concurrent × 80 concurrency/instance ≈ effectively unbounded for query side)  
* **LISTEN connection is the binding constraint: 150-instance cap at Supabase Team tier**

**V1 Cloud Run max instances:** 100 (§28B.2). Fits comfortably in 150-instance LISTEN ceiling with 50-connection headroom (50% buffer for burst scaling \+ admin connections).

**Scaling beyond 150 instances:**

* Option A: upgrade Supabase tier (Team → Enterprise, higher pool limits)  
* Option B: move to dedicated pgbouncer deployment with higher session-mode pool capacity  
* Option C: switch to regional Google Cloud Pub/Sub for cache invalidation (broker-based pattern, eliminates per-instance persistent connections) — V2 target

**V1 posture:** 100-instance cap is sufficient for V1 launch traffic (10k active students × 5-10 concurrent conversations peak ≈ 500-1000 concurrent requests / 80 concurrency-per-instance \= \~10-15 active instances steady-state, 30-50 during bursts). Headroom to 100 absorbs 5-10× traffic growth.

**Monitoring:** `postgres_listen_connection_count_active` metric; alert at \>120 instances (80% of session-mode pool). At that threshold, decide between Option A/B/C above.

* 01A §28.1 reconnection pattern handles connection drops with exponential backoff \+ jitter  
* If the LISTEN connection drops and cannot reconnect past `listen_connection_hard_timeout_sec` (01A config, default 300s), the instance degrades: it no longer receives invalidation events and serves from TTL alone. Per 01A §24, hard-staleness bounds apply.

### **12A.5 Vertex AI context caching**

Vertex AI provides a native **context caching** feature for Gemini models. Stable prefix content sent as input can be explicitly cached on Vertex's side, reducing input token cost and input processing latency for subsequent calls with the same prefix.

LISA has natural stable prefixes that benefit:

* **System prompt** — stable across every turn of a conversation; changes only on policy\_variant/prompt\_version updates  
* **Teaching profile summary** — stable within a \~5-minute window; refreshed on teaching\_profile write per 03A V3 §7.4  
* **Canonical question content** — stable per question; referenced identically across retries of the same turn

This is a LISA-specific optimization, not a generic 01A primitive. 01A Part III addresses our server-side caches; Vertex context caching is a *provider-side* cache that LISA explicitly manages.

**Detailed spec in §12B.5 below.** Summary: opt-in per-call, keyed by conversation\_id \+ prompt\_version, TTL aligned with cache invalidation triggers (policy\_version bumps, teaching\_profile refresh). Cost/latency benefit measured via §22.12 Vertex SLI block.

---

## **§12B Cache Inventory (LISA Consumers of 01A Part III)**

Every cache below follows 01A Part III pattern (two-tier, `CacheEntry<T>`, LISTEN/NOTIFY invalidation, soft TTL \+ hard staleness, exponential-backoff reconnection). This section names what LISA caches; 01A Part III is authoritative for how.

**Tier labels (V4.1 corrected per AMB-V4-01):** Every cache entry below is explicitly tagged with canonical tier labels from 01A Part III:

* **Tier 1** \= per-Cloud-Run-instance in-process memory (ephemeral per instance; lost on scale-in)  
* **Tier 2** \= Postgres-backed shared storage (survives instance lifecycle; accessible across instances)

The Vertex AI provider-side cache (§12B.5) is outside 01A Part III's two-tier topology — it is a **provider-side cache** owned by Vertex, not a LISA- or Lyceon-managed tier. V4.1 deliberately avoids extending the canonical tier numbering to "Tier 3" to preserve 01A Part III's authoritative vocabulary. LISA's *mapping table* for Vertex caches (`tutor_vertex_context_cache`, §27E) is itself a Tier 2 resource; the cached content bytes live on Vertex's infrastructure and are not part of our tier hierarchy.

Default rationale: per-student or per-conversation data with frequent reads and rare writes favors Tier 1 (avoid Postgres round-trip on hot path). Cross-instance-authoritative state (rate limit counters, idempotency records) favors Tier 2\. Vertex provider-side caches apply only where Vertex specifically offers context caching as a cost/latency optimization.

### **12B.1 Entitlement cache — owned by V8**

LISA does not manage an entitlement cache at 03B. V8 `EntitlementService` owns its internal cache per V8 §27.3. See §3.2.3 rationale for removing V2's second-layer cache.

**Tier:** N/A (owned by V8; V8 internal topology is Tier 2-backed per V8 §27.3).

**Removed from V2:** `entitlement:{student_id}` Redis cache at 03B layer.

### **12B.2 Conversation ownership cache**

* **Tier:** Tier 1 (in-process per instance; Postgres fallback on miss)  
* **Key:** `conv_owner:{conversation_id}`  
* **Value shape:** `CacheEntry<{student_id, status, deleted_at}>`  
* **Soft TTL:** `cache.conversation_ownership_ttl_sec` (default 60s)  
* **Hard staleness:** `cache.conversation_ownership_hard_staleness_sec` (default 300s)  
* **Invalidation channel:** `conversation_updated` (NOTIFY payload `{conversation_id}`)  
* **Fired on:** conversation close, abandon, soft-delete  
* **Failure:** 01A §24 hard-staleness behavior; `CacheUnavailableError` beyond bound → 503  
* **Tier rationale:** per-conversation data, frequent reads (every message append), rare writes (only on close/abandon). Tier 1 hit absorbs hot-path cost; Postgres read on miss bounded.  
* See §3.3 operational contract

### **12B.3 Live exam status cache**

* **Tier:** Tier 1 (in-process per instance; Postgres fallback on miss)  
* **Key:** `live_exam:{student_id}`  
* **Value shape:** `CacheEntry<{has_active_exam, exam_id}>`  
* **Soft TTL:** 30s (shorter than other caches — INV-03-02 exposure)  
* **Hard staleness:** 60s  
* **Invalidation channel:** `exam_status_changed`  
* **Fired on:** exam start, complete, abandon (emitted by Doc 02B)  
* **Failure:** fail-closed past hard staleness (INV-03-02 absolute)  
* **Tier rationale:** per-student data checked every turn; short TTL and strict hard staleness limit exposure; Postgres fallback on miss is fine  
* See §3.4 operational contract

### **12B.4 Inference result cache (LISA-specific)**

LISA-specific. Not a generic 01A primitive; belongs in 03B.

* **Tier:** Tier 2 (Postgres-backed; cross-instance coordination needed because retry from client could hit a different Cloud Run instance than the original)  
* **Purpose:** recovery from partial persistence failure without re-invoking Vertex AI (cost avoidance — single Vertex call can be $0.001-$0.05 at V1 model tier; repeated re-inference during DB instability produces a cost spiral)  
* **Storage:** Postgres table `tutor_inference_cache` (V3 change — V2 specified Redis; V3 moves to Postgres for topology consistency per §12A.2)  
* **Tier rationale:** retry recovery requires cross-instance visibility (a Cloud Run scale event could route retry to a different instance than original); Tier 1 would miss this case. Tier 2 (Postgres) ensures all instances see the same retry cache.

**Schema (§27D):**

CREATE TABLE tutor\_inference\_cache (  
  cache\_key TEXT PRIMARY KEY,  \-- format: "inference:{conversation\_id}:{client\_turn\_id}"  
  student\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,  
  conversation\_id UUID NOT NULL REFERENCES tutor\_conversations(id) ON DELETE CASCADE,  
  client\_turn\_id UUID NOT NULL,  
  response\_envelope JSONB NOT NULL,  \-- full orchestrator response per 03C contract  
  scan\_result JSONB NOT NULL,  \-- output scan decision  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  expires\_at TIMESTAMPTZ NOT NULL  
    GENERATED ALWAYS AS (created\_at \+ interval '60 seconds') STORED  
);

CREATE INDEX idx\_tutor\_inference\_cache\_expires  
  ON tutor\_inference\_cache (expires\_at);

CREATE INDEX idx\_tutor\_inference\_cache\_turn  
  ON tutor\_inference\_cache (conversation\_id, client\_turn\_id);

\-- Retention cleanup: row-level TTL via periodic cron  
\-- (Postgres has no native TTL; §27G partitioning strategy replaces hourly cleanup)

**TTL:** `cache.inference_result_ttl_sec` (default 60s). Rows past expires\_at are candidates for deletion; cleanup cron runs every 60s per 01A §34 retention pattern.

**Write:** after step 4 (scan complete), before step 5 (tutor message persist). Single-row insert with `ON CONFLICT (cache_key) DO UPDATE` — a retry that reaches step 4 again overwrites (should not happen in normal flow; defensive).

**Read:** on retry with existing `client_turn_id`, before step 3 (orchestration), check cache; if hit and not expired, skip directly to step 5\.

**Delete:** after step 7 (all persistence complete) — explicit DELETE to free storage; not strictly required (TTL will clean up).

**Failure modes:**

* Cache write fails after orchestration → retry re-invokes orchestration (fallback, not a correctness issue)  
* Cache hit but cached content fails scan re-verification → fall back to re-inference (defense against stale/corrupt cache)  
* TTL expired before retry → re-inference

**Not what this cache is:**

* Not a general-purpose response cache  
* Not keyed by question content (different client\_turn\_id always re-inferences)  
* Not a cost-optimization for fresh requests  
* Specifically and only: a retry-recovery mechanism to absorb orchestrator cost during partial-failure retry windows

**Operational Contract:**

* **Fail posture:** fail-safe to re-inference (cache miss → full flow)  
* **Timeout:** 50ms read; 100ms write; 200ms hard ceiling  
* **Retry:** none (fallback to full flow is cheap)  
* **Fallback:** re-invoke orchestration  
* **Degraded mode:** no degradation; just higher Vertex spend during DB instability  
* **Owner:** 03B (LISA-specific)

### **12B.5 Vertex AI context cache (LISA-specific) — V4 closeout of BLK-V3-03**

Vertex AI native context caching for stable prompt prefixes. LISA-managed; 01A does not cover this because it's a provider-side cache, not a server-side one.

**Scope:** Vertex AI's `CachedContent` resource for Gemini. A `CachedContent` object is created on Vertex's side; subsequent calls reference it by ID instead of re-sending the cached content.

**Cache designation:** Vertex provider-side cache (outside 01A Part III two-tier topology). Vertex owns the actual cached bytes; LISA owns the mapping from logical identity to Vertex's `CachedContent.name`. The mapping table itself (`tutor_vertex_context_cache`, §27E) is Tier 2 (Postgres-backed); the cached content bytes live on Vertex's infrastructure.

**Cache kinds:**

1. **System prompt \+ policy instructions** — per `(policy_variant, prompt_version)`

   * Stable until policy\_version bumps  
   * Vertex cache TTL: 24 hours (Vertex default)  
   * Keyed by `policy_variant + prompt_version`  
   * Expected bounded staleness: ≤ 24h from policy\_version bump to worst-case Vertex eviction  
   * Invalidation: policy\_version change → delete Vertex cache (write-through, per §12B.5.1)  
2. **Teaching profile summary** — per student

   * Stable until `tutor_memory_summaries` teaching\_profile refresh (14-day cadence per 03A V3 §7.4)  
   * Vertex cache TTL: 1 hour (lower than 24h to bound staleness on out-of-band refresh)  
   * Keyed by `student_id + teaching_profile_version`  
   * Expected bounded staleness: ≤ 1h from teaching\_profile refresh to worst-case Vertex eviction  
   * Invalidation: teaching\_profile refresh → write-through delete (§12B.5.1)  
3. **Canonical question content** — per question

   * Stable until question retirement (rare per 03A V3 §4.5)  
   * Vertex cache TTL: 24 hours  
   * Keyed by `source_question_canonical_id`  
   * Expected bounded staleness: ≤ 24h  
   * Invalidation: question retirement → write-through delete

**What LISA does NOT cache in Vertex:**

* Recent conversation messages (not stable — changes every turn)  
* Current question content when conversation is actively about that question (the canonical question cache is for *stable* references, not active discussion that flows as part of the user turn)  
* Student learning context snapshot (mastery state changes frequently)

**Mapping table (§27E):**

Schema updated in V4 to include `student_id` column per SWE-V3-05. See §27E for full schema.

### **12B.5.1 Invalidate-then-delete pattern (V4.1 — SWE-V4-02 corrected)**

V3 used write-then-notify: the Postgres write (e.g., new `tutor_memory_summaries` teaching\_profile row) happened first, then a NOTIFY fired, then 03B listener deleted the Vertex cache. This produced a race (BLK-V3-03) where a tutor turn in-flight between the Postgres commit and the Vertex delete could serve a response using stale teaching profile content still in Vertex's cache.

V4 attempted a "write-through" fix: delete Vertex cache first, then commit Postgres. On review (SWE-V4-02), this introduced a different race: while the writer was between Phase 1 (Vertex delete) and Phase 3 (Postgres commit), a concurrent orchestrator turn could create a *new* `CachedContent` on Vertex for the student's (pre-refresh) teaching profile, leading to two possible end states — either the writer's `UPDATE invalidated_at` hits the new row (incorrect: new row should stay valid), or the writer creates an orphan by missing the new row's insertion.

**V4.1 pattern: invalidate-then-delete.** The mapping table's `invalidated_at` marker is the authoritative signal for "do not use this cache." Orchestrator reads check `invalidated_at IS NULL` before referencing a cache. By marking invalidation *inside* the Postgres transaction and deleting from Vertex *after* commit, concurrent orchestrator reads see `invalidated_at IS NOT NULL` and proceed to fresh cache creation without racing the deleter.

Sequence:

// In MemoryRefreshWorker (03A V3 §9) and similar writers:  
async function writeTeachingProfileWithCacheInvalidation(  
  studentId: string,  
  newProfile: TeachingProfile,  
): Promise\<void\> {  
  // Phase 1 (inside Postgres transaction):  
  // Mark existing Vertex cache mapping as invalidated AND write new teaching\_profile.  
  // Collect the invalidated rows' Vertex names for Phase 2\.  
  const invalidatedRows \= await db.transaction(async (tx) \=\> {  
    // Insert new teaching\_profile row  
    await tx.query(\`  
      INSERT INTO tutor\_memory\_summaries (student\_id, summary\_type, content\_json, version, ...)  
      VALUES ($1, 'teaching\_profile', $2, $3, ...)  
    \`, \[studentId, newProfile, newProfile.version\]);

    // Mark Vertex cache mapping invalidated AND collect names to delete.  
    // UPDATE ... RETURNING is atomic inside the transaction.  
    const result \= await tx.query(\`  
      UPDATE tutor\_vertex\_context\_cache  
      SET invalidated\_at \= now()  
      WHERE cache\_kind \= 'teaching\_profile'  
        AND student\_id \= $1  
        AND invalidated\_at IS NULL  
      RETURNING id, vertex\_cached\_content\_name  
    \`, \[studentId\]);

    // NOTIFY for secondary invalidation (mapping cache consumers, other listeners)  
    await tx.query(\`  
      SELECT pg\_notify('teaching\_profile\_updated', json\_build\_object(  
        'student\_id', $1,  
        'teaching\_profile\_version', $2  
      )::text)  
    \`, \[studentId, newProfile.version\]);

    return result.rows;  
  });

  // Phase 2 (outside transaction, post-commit):  
  // Delete the Vertex-side CachedContent. Best-effort.  
  // Orchestrator reads that happen between commit and this delete see  
  // invalidated\_at IS NOT NULL in the mapping and proceed to fresh cache creation,  
  // so they do not race with or depend on this delete completing.  
  for (const row of invalidatedRows) {  
    try {  
      await vertexClient.deleteCachedContent(row.vertex\_cached\_content\_name);  
    } catch (err) {  
      // Log and move on. Vertex's own TTL (1h teaching\_profile, 24h others)  
      // caps the residual cost of the un-deleted cache. A background reaper  
      // (§12B.5.4 failure modes table) sweeps up invalidated rows with  
      // still-present Vertex names on a periodic cadence.  
      await logger.warn('vertex\_cache\_post\_commit\_delete\_failed', {  
        student\_id: studentId,  
        vertex\_name: row.vertex\_cached\_content\_name,  
        mapping\_row\_id: row.id,  
        err: err.message,  
      });  
    }  
  }  
}

**Why this is race-free for concurrent orchestrator reads:**

Orchestrator cache lookup in §12B.5.3 checks `invalidated_at IS NULL` as the first condition for referencing a cache. Three interleaving scenarios:

1. **Orchestrator reads mapping before writer's transaction commits:** reads show `invalidated_at IS NULL`, Vertex cache exists, request proceeds with cache reference. This is acceptable — the student's in-flight turn uses the pre-refresh teaching profile, and the refresh takes effect on the *next* turn. Bounded staleness matches §12B.5.2 contract (≤1h).  
2. **Orchestrator reads mapping after writer's transaction commits, before Phase 2 Vertex delete:** reads show `invalidated_at IS NOT NULL`, mapping row is skipped, orchestrator creates a new `CachedContent` for the new teaching\_profile version and inserts a new mapping row. No race with Phase 2 because the old row's `vertex_cached_content_name` is captured in `invalidatedRows` and will be deleted regardless.  
3. **Orchestrator reads mapping after Phase 2 Vertex delete:** reads show `invalidated_at IS NOT NULL` plus the Vertex cache itself is gone; same path as scenario 2\.

In all three, the orchestrator never references a cache that is about to be deleted; it either references the current cache (pre-refresh, bounded staleness) or creates a new one.

**Concurrent orchestrator inserting a new mapping row during Phase 1:** if an orchestrator turn is mid-insert of a new `tutor_vertex_context_cache` row for the *new* teaching\_profile version while the writer's Phase 1 UPDATE is running, the writer's `UPDATE ... WHERE invalidated_at IS NULL` may or may not include the new row depending on when the orchestrator's INSERT commits. Two sub-cases:

* Orchestrator INSERT commits before writer UPDATE: writer's UPDATE may hit the new row too, setting `invalidated_at` on something that shouldn't be invalidated. Protection: the UNIQUE constraint `(cache_kind, cache_key)` in §27E — the new row has a *different* cache\_key (includes new teaching\_profile\_version), so it's a distinct row. Writer's UPDATE filters by `student_id` and `cache_kind = 'teaching_profile'` which would match both rows. **Bug risk.**  
* Orchestrator INSERT commits after writer UPDATE: new row is not seen by writer's UPDATE; new row remains valid, no problem.

**Fix (V4.1 refinement):** writer's UPDATE filters by `teaching_profile_version < $new_version` to avoid invalidating a concurrently-inserted newer row:

UPDATE tutor\_vertex\_context\_cache  
SET invalidated\_at \= now()  
WHERE cache\_kind \= 'teaching\_profile'  
  AND student\_id \= $1  
  AND invalidated\_at IS NULL  
  AND (  
    cache\_key NOT LIKE '%:v' || $2::text  
    OR cache\_key IS NULL  
  )  
RETURNING id, vertex\_cached\_content\_name;

Where `$2` is the new teaching\_profile version. This matches the V3 pattern where `cache_key` encodes version; the filter excludes the new row from the UPDATE scope. If the orchestrator inserted the new row first, that row stays valid.

**Properties of V4.1 invalidate-then-delete:**

* Mapping `invalidated_at` is the source of truth; orchestrator reads respect it  
* Postgres transaction boundary ensures mapping invalidation and teaching\_profile write commit atomically  
* Vertex delete is best-effort post-commit; failures don't block the write  
* Background reaper (§12B.5.4) sweeps `invalidated_at IS NOT NULL` rows with still-present Vertex names for eventual cleanup  
* Concurrent orchestrator cache creation during the writer's transaction is race-free via the version-filter refinement above

### **12B.5.2 Bounded staleness contract**

Per-cache worst-case staleness windows are explicit and observable:

| Cache kind | Worst-case staleness | Bounding mechanism |
| ----- | ----- | ----- |
| `system_prompt` | ≤ 24h | Vertex TTL \+ write-through delete (usually near-zero) |
| `teaching_profile` | ≤ 1h | Shorter Vertex TTL \+ write-through delete |
| `canonical_question` | ≤ 24h | Vertex TTL \+ write-through delete; retirement is rare so staleness window rarely actualizes |

**User-facing implication:** a student whose teaching\_profile just refreshed could, in worst-case conditions (write-through Vertex delete failed \+ NOTIFY failed \+ listener down \+ Vertex cache still live), receive up to 1 turn that references their pre-refresh profile. Given the 1h Vertex TTL, this staleness window is bounded and cannot extend further. V1 product posture: accept this bounded staleness.

**Observability (new in V4):** `teaching_profile_staleness_lag_minutes` SLI tracks the time between Postgres teaching\_profile write commit and observed zero-hit-rate on old teaching\_profile cache. Target: \<5 minutes. Alert at \>30 minutes (write-through failing \+ NOTIFY failing \+ TTL not yet expired).

### **12B.5.3 On read (03C orchestrator path)**

Flagged here for 03B↔03C interface. 03C:

1. Before assembling Vertex request, look up cached content names for (policy\_variant, prompt\_version), (student\_id, teaching\_profile\_version), and (canonical\_question\_id) as applicable  
2. Reference cached content in Vertex request per their API (`cached_content: "projects/.../cachedContents/..."`)  
3. If mapping row has `invalidated_at IS NOT NULL` → skip, create new cache  
4. If cache miss → create new `CachedContent` on Vertex side and upsert mapping row  
5. On Vertex 404 "cache not found" (TTL expired Vertex-side without our knowing) → create new cache and retry once; log event

### **12B.5.4 Failure modes**

| Failure | Behavior | User impact |
| ----- | ----- | ----- |
| Vertex cache creation fails | Proceed with uncached Vertex call | Higher cost; no user impact |
| Vertex cache lookup fails | Proceed with uncached Vertex call | Higher cost |
| Mapping table read fails | Proceed with uncached Vertex call | Higher cost |
| Stale mapping (Vertex-side cache expired) | Vertex returns 404; retry with fresh cache | Minor latency bump on first turn post-expiry |
| Write-through Vertex delete fails | Logged; secondary NOTIFY-based invalidation runs; worst-case staleness bounded by TTL | Up to 1h stale teaching\_profile worst case |

Never fail the user-facing turn due to context cache issues.

### **12B.5.5 Expected value (V4.1 hedged per AMB-V4-03)**

**Per-turn input token composition (estimate):**

* System prompt: \~500-1500 tokens (stable)  
* Teaching profile: \~200-400 tokens (stable per \~14-day window)  
* Canonical question (when scoped): \~100-300 tokens (stable per question)  
* Recent conversation messages: \~500-2000 tokens (NOT cached)  
* User turn content: \~50-500 tokens (NOT cached)

**Cache hit coverage:** caching the stable \~800-2200 tokens out of \~1350-4700 total input tokens \= 40-60% of input tokens are cache-eligible at steady state.

**Cost savings math (ranged estimate):**

Key pricing consideration: context-cached tokens on Vertex Gemini typically bill at a **reduced rate** (published Vertex pricing for cached content is a fraction of regular input token cost — verify current rate at launch). This means cached tokens are cheaper but not free. Output tokens are not cached and continue billing at their standard (higher) rate per turn.

Realistic savings math:

* Cache-eligible input tokens: 40-60% of total input  
* Price reduction on those tokens: \~75% (cached bytes cost \~25% of regular rate; rate subject to provider pricing)  
* Net input cost reduction: (40-60%) × 75% \= \~30-45% of input-token cost  
* Input-token cost as fraction of total Vertex cost per turn: \~50-70% (output tokens often dominate longer responses)  
* **Net total Vertex cost reduction: \~15-30% at steady state**

At V1 launch target of 1M turns/day (10k active students × 100 turns/day):

* Gross Vertex spend projection: \~$100-300/day (depends on actual token mix and current pricing)  
* Steady-state savings from context caching: \~$15-90/day  
* **Annualized range at V1 launch scale: \~$5k-$30k/yr**

At 10× scale (10M turns/day): \~$50k-$300k/yr. At 100× scale: \~$500k-$3M/yr. These ranges widen at scale because cache hit rates improve with traffic concentration (hotter system prompts, repeated teaching profile reads) but also because pricing may be renegotiated at higher volume.

**Caveats on this projection:**

1. Actual Vertex cached-content pricing must be confirmed at launch; rates change  
2. Output-token dominance varies by conversation type (short answers vs long explanations); actual input/output ratio needs measurement  
3. Cache hit rate depends on traffic patterns and may be lower than steady-state projection during ramp-up  
4. This is a cost optimization, not a revenue driver — the primary justification is latency (cached prefixes reduce inference time) and correctness (stable context reduces model drift)

**Single-point figures are deliberately not given.** Post-launch actuals should replace the range estimate; V1.1 hardening pass can revise §12B.5.5 with measured numbers.

**Investment to capture value:** mapping table \+ 03C integration \+ write-through invalidation logic ≈ 1-2 engineer-weeks. Payback at V1 launch scale: within the first year, earlier at growth scale.

**Observability:** §22.12 Vertex SLI block (`vertex_context_cache_hit_rate`, `vertex_context_cache_creation_latency_p95`, `teaching_profile_staleness_lag_minutes`) tracks actual vs projected savings. Revise this section with real data post-launch.

### **12B.5.6 Operational Contract**

* **Fail posture:** fail-safe to uncached Vertex call  
* **Timeout:** 100ms for mapping table read; Vertex's own latency for cache operations (typically \<200ms)  
* **Retry:** 1 retry on transient Vertex 5xx; otherwise fall back to uncached  
* **Fallback:** uncached Vertex call  
* **Degraded mode:** higher token cost, no user impact  
* **Rollback:** V4→V3 rollback disables write-through invalidation (reverts to write-then-notify); acceptable temporary regression since staleness window still bounded by 1-24h Vertex TTL  
* **Owner:** 03B (mapping table, write-through logic in writers); 03C (orchestration Vertex integration)

### **12B.6 Memory summary cache**

Per 03A V3 §8.6 pattern — 03A owns mastery read cache; this entry covers LISA's read of `tutor_memory_summaries`.

* **Tier:** Tier 1 (in-process per instance; Postgres fallback on miss)  
* **Key:** `memory:{student_id}:{summary_type}`  
* **Value shape:** `CacheEntry<MemorySummary>`  
* **Soft TTL:** `cache.memory_summary_ttl_sec` (default 300s)  
* **Hard staleness:** 900s  
* **Invalidation channel:** `memory_summary_updated` (payload `{student_id, summary_type}`)  
* **Fired on:** memory refresh service write (per 03A V3 §9.4)  
* **Failure:** 01A §24 hard-staleness; context resolution proceeds with partial memory past hard bound (soft degradation per 03A V3 §9.3)  
* **Tier rationale:** per-student data read every turn; memory content is stable (minute-to-hour time scale between refreshes); Tier 1 hit rate target \>85%

### **12B.7 Canonical question cache**

* **Tier:** Tier 1 (in-process LRU of top 1000 questions) \+ Tier 2 (Postgres fallback on miss)  
* **Keys:** `question:row:{question_row_id}` and `question:canonical:{canonical_id}` (both → same payload)  
* **Value shape:** `CacheEntry<CanonicalQuestion>`  
* **Soft TTL:** `cache.canonical_question_ttl_sec` (default 86400s / 24h — effectively immutable)  
* **Hard staleness:** `cache.canonical_question_hard_staleness_sec` (default 172800s / **48h per SWE-V3-04 closeout**; V3 had 7d which was too long for stale retired-question serving)  
* **Invalidation channel:** `question_retired` (payload `{question_row_id, canonical_id}`)  
* **Fired on:** question retirement (rare operational event)  
* **Failure:** DB fallback; no degradation past hard bound → 503  
* **Tier rationale:** questions are effectively immutable with rare retirement; highest-hit-rate cache in the system; Tier 1 LRU captures Pareto tail (top 1000 questions serve \~90% of requests per typical Zipf distribution)

**Cloud Run note:** the in-process tier (Tier 1\) retains LRU of top 1000 questions for hot-path optimization. On instance cold-start, LRU is empty; first hundreds of requests on the instance pay Postgres cost. Given the 24h soft TTL and rare invalidation, warm instances serve \~98%+ from Tier 1 LRU. §22.12 tracks tier-level hit rates.

### **12B.8 Runtime config cache**

* **Tier:** Tier 1 (in-process per instance; refreshed via LISTEN/NOTIFY)  
* **Data:** `tutor_context_runtime_config` loaded at bootstrap per 01A §3 order  
* **Invalidation:** LISTEN/NOTIFY on `tutor_context_runtime_config_invalidate` channel per 01A §4  
* **TTL:** none (event-driven refresh only)  
* **Hit rate:** effectively 100% in steady state after bootstrap  
* **Tier rationale:** stable read-mostly config; Tier 1 is the only sensible choice (no per-request DB round-trip); invalidation is event-driven so no TTL needed

### **12B.9 Tutor error codes cache**

* **Tier:** Tier 1 (in-process per instance)  
* **Data:** `tutor_error_codes` registry (§27C) loaded at bootstrap alongside runtime config  
* **Invalidation:** LISTEN/NOTIFY on `tutor_error_codes_invalidate` channel  
* **Hit rate:** effectively 100%  
* **Tier rationale:** same as runtime config — stable, read-mostly, event-driven refresh

### **12B.10 Rate limit and quota counters**

* **Tier:** Tier 2 (Postgres-authoritative; no cache layer)  
* **Storage:** `rate_limit_ledger` table per 01A §41 canonical  
* **Access pattern:** single atomic RPC for check-and-increment; no cross-instance caching  
* **Tier rationale:** rate limiting is cross-instance-critical (counter must be authoritative across all Cloud Run instances); Tier 1 would produce inconsistency. Direct Postgres RPC is fast enough (01A §74A: \<50ms P95)  
* **See:** §15 for full rate limiting spec

**Removed from V2:** separate `quota:daily:{student_id}` Redis keys \+ DB mirror. V3 uses single Postgres-authoritative store.

---

## **§12C LISA-Specific Invalidation Channels**

Every channel below is a Postgres NOTIFY channel emitted by LISA code paths. Receivers are 03B instances holding relevant caches.

| Channel | Payload | Emitter | Subscribers |
| ----- | ----- | ----- | ----- |
| `conversation_updated` | `{conversation_id}` | Conversation close/abandon/soft-delete | Ownership cache |
| `exam_status_changed` | `{student_id}` | Doc 02B exam start/complete/abandon | Live exam cache |
| `memory_summary_updated` | `{student_id, summary_type}` | 03A V3 §9 memory refresh worker | Memory summary cache |
| `question_retired` | `{question_row_id, canonical_id}` | Doc 02B question retirement | Canonical question cache |
| `teaching_profile_updated` | `{student_id, teaching_profile_version}` | 03A V3 §9 memory refresh worker | Vertex context cache |
| `policy_version_bumped` | `{policy_variant, prompt_version}` | Ops-triggered policy update | Vertex context cache |
| `tutor_context_runtime_config_invalidate` | `{config_key}` | 01A config trigger | Runtime config cache |
| `tutor_error_codes_invalidate` | `{error_code}` | Manual admin update | Error codes cache |

All channels follow 01A §27 NOTIFY-after-commit rule — emission happens after the writing transaction commits. Receivers drop affected cache keys; next read falls through to Postgres.

**Listener lifecycle:** each 03B instance maintains one persistent Postgres connection subscribing to all channels. Per §12A.4 Cloud Run considerations, this is `N instances × 1 listener connection`. Reconnection per 01A §28.

---

## **§12D Failure Behavior Summary**

Per-cache failure posture consolidated from §12B Operational Contract cards:

| Cache | Fail posture | Hard staleness | Degraded mode |
| ----- | ----- | ----- | ----- |
| Entitlement (V8-owned) | fail-closed | V8-defined | 503 to client |
| Conversation ownership | fail-closed past hard bound | 300s | 503 past bound |
| Live exam status | fail-closed past hard bound (INV-03-02) | 60s | 503 past bound |
| Inference result | fail-safe to re-inference | n/a | Higher Vertex spend |
| Vertex context | fail-safe to uncached call | n/a | Higher token cost |
| Memory summary | soft degrade (partial context) | 900s | Context without memory past bound |
| Canonical question | fail-closed past hard bound | 604800s | 503 past bound (rare) |
| Runtime config | fail-fast at bootstrap; event-driven after | n/a | `MissingRequiredConfigError` at boot |
| Error codes | bundled defaults at boot | n/a | Known error codes only |
| Rate limit counters | fail-closed (Postgres auth) | n/a | 503 per 01A §47 |

## **§12E Cache Stampede / Single-Flight**

Per 01A hardening item flagged in 01A review: when N concurrent requests arrive at a single instance for the same cache key during a miss window, without coordination they all fall through to the authoritative DB, producing an N× spike in DB load (thundering herd). Single-flight prevents this.

**Implementation pattern (per-instance, not cross-instance):**

// In packages/shared/cache/single-flight.ts  
class SingleFlight\<K, V\> {  
  private inflight \= new Map\<K, Promise\<V\>\>();

  async get(key: K, fetch: () \=\> Promise\<V\>): Promise\<V\> {  
    const existing \= this.inflight.get(key);  
    if (existing) return existing;

    const promise \= fetch().finally(() \=\> this.inflight.delete(key));  
    this.inflight.set(key, promise);  
    return promise;  
  }  
}

**Application:** wrapping the DB fallback path in every Tier 1 cache. On miss, only one concurrent request per key performs the DB read; others await the same promise.

**Scope:** single-flight is per-instance. Cross-instance stampede (all N Cloud Run instances miss simultaneously for the same key) is not prevented by this pattern. Acceptable: at steady state, different instances have independently warm caches; simultaneous cold-start of all instances is a deployment-time event, not a steady-state concern.

**V1 scope:** every Tier 1 cache in §12B uses single-flight. Memory, ownership, live-exam, question, Vertex context all wrap DB reads through the single-flight abstraction.

**Observability:** `single_flight_coalesce_count` metric per cache key prefix measures how often multiple concurrent requests collapse to one DB fetch. Operational: high coalesce count during scale events is expected; high coalesce count during steady state suggests cache TTL too short.

---

---

# **Part VI — Persistence Order and Idempotency**

## **§13 Persistence Order (Authoritative)**

For a successful tutor turn via POST /api/tutor/messages, writes execute in this order:

1. **Persist student message** to `tutor_messages` (role='student')  
2. **Persist instructional assignment** to `tutor_instruction_assignments`  
3. **Invoke orchestration** via Doc 03C (not a DB write, but sequenced)  
4. **Run anti-leak output scan** (not a DB write, but sequenced)  
5. **Persist tutor message** to `tutor_messages` (role='tutor')  
6. **Persist question links** to `tutor_question_links` if any  
7. **Persist instruction exposures** to `tutor_instruction_exposures` if any  
8. **Update conversation updated\_at** implicitly via trigger

### **13.1 Blocking vs non-blocking**

**Blocking (failure blocks the turn):**

* Authentication  
* Role check  
* Entitlement check  
* Conversation ownership verification  
* Student message persistence (step 1\)  
* Instructional assignment persistence (step 2\)  
* Anti-leak scan (step 4\) — if detects leak, response is substituted with safe fallback but turn still completes  
* Tutor message persistence (step 5\)

**Non-blocking (failure logs but doesn't block turn success):**

* Question links persistence (step 6\) — logged, turn succeeds; manual reconciliation if needed  
* Instruction exposures persistence (step 7\) — logged, turn succeeds

**Critical: Tutor must not appear to succeed while blocking writes failed.** If a blocking write fails, the API does not return a success response; it returns a `canonical_write_failed` error per §6.9.

### **13.2 Transaction boundaries**

Steps 1-2 execute in a single DB transaction. If step 2 fails, step 1 rolls back — the student message is not persisted, the student retries with the same `client_turn_id`.

Steps 5-7 execute in a single DB transaction after orchestration returns. If step 5 fails, steps 6-7 roll back.

Steps 1-2 and steps 5-7 are separate transactions because orchestration (step 3\) happens between them and is not a DB operation. This is intentional — the student message and policy decision are committed before orchestration so they're visible in observability even if orchestration fails or is slow.

### **13.3 Orchestration failure after student turn persisted**

Scenario: Steps 1-2 succeed; step 3 (orchestration) fails or times out. What happens?

* Student message is persisted (visible in conversation history)  
* Instruction assignment is persisted (shows the intended variant/register)  
* No tutor message persisted (step 5 didn't run)  
* Response: `503 Service Unavailable` with error code `orchestration_failed_recoverable`, `retry_after_ms: 2000`

On client retry with same `client_turn_id`:

* Server recognizes `client_turn_id` matches existing student message → skips step 1  
* Server recognizes instructional assignment exists → skips step 2  
* Server re-invokes orchestration (step 3\)  
* Completes remaining steps 4-7 normally

This idempotent recovery is why `client_turn_id` is required and why the DB has the `tutor_messages_client_turn_unique` constraint (Doc 03A V3 §18.2).

### **13.4 Tutor message write failure after orchestration success**

Scenario: Orchestration returns valid response; step 5 (tutor message persistence) fails.

* Student message persisted; assignment persisted; orchestration succeeded  
* Tutor response exists in memory but not in DB  
* **Before returning error: write orchestration result to inference cache (§13.5)**  
* Response: `500 Internal Server Error` with error code `canonical_write_failed`  
* On retry with same `client_turn_id`: server detects existing student message, checks inference cache, replays cached result if available (skipping re-inference), completes flow

### **13.5 Inference result cache (summary — see §12B.4 for full spec)**

Between orchestration success (step 4 scan complete) and persistence completion (step 7), the orchestrator response exists in a volatile state. If step 5, 6, or 7 fails, retrying without an inference cache means re-running the expensive Vertex call — potentially repeatedly if DB instability persists. The inference cache prevents this cost spiral.

**Storage:** Postgres table `tutor_inference_cache` (V3 change from V2 Redis — §12A.2 stack consistency; schema in §27D).

**Key shape:** `inference:{conversation_id}:{client_turn_id}`

**Write:** after step 4 (scan complete), before step 5 (tutor message persist).

**Read on retry:** before step 3 on retry with existing `client_turn_id`; on hit, skip directly to step 5 with cached response.

**Delete:** after step 7 (all persistence complete); TTL cleanup cron catches misses.

**TTL:** `cache.inference_result_ttl_sec` (default 60s). Covers the vast majority of retry scenarios (network blip, transient DB failure, orchestrator timeout recovery). Retries beyond 60s fall back to re-inference — acceptable cost.

**Failure:** fall back to re-inference. Not a correctness issue. See §12B.4 operational contract.

**What this cache does NOT do:**

* Does not cache responses for new requests with different `client_turn_id`  
* Does not cache across students or conversations  
* Does not cache beyond the retry window  
* It is not a general-purpose response cache — specifically a retry-recovery mechanism

Full spec including table schema, cleanup cron, and operational contract in §12B.4 and §27D.

### **13.6 Isolation levels per DB interaction (cross-ref to §28C)**

§28C is authoritative for isolation level per DB operation. Summary for §13 flow:

* Steps 1-2 transaction: `REPEATABLE READ` — ensures consistent view for the combined student message \+ instructional assignment write under concurrent retry  
* Steps 5-7 transaction: `READ COMMITTED` — tutor message \+ links \+ exposures; no cross-row consistency requirement across these writes  
* 01A `IdempotencyService` record insert: `SERIALIZABLE` per 01A §33 (content hash conflict detection)  
* 01A `RateLimitLedger` check-and-increment: `REPEATABLE READ` per 01A §41 (atomic bucket increment)

See §28C table for full enumeration including cache read paths.

### **13.7 Idempotency / transaction nesting pattern (V4.1 — BLK-V3-01 partial closeout, BLK-V4-01 honesty)**

V3 left ambiguous how 01A `IdempotencyService.checkOrRecord` interacts with the §13 step transactions. V4 introduced a two-phase pattern using advisory locks. V4.1 rewrites this section for precision about what the pattern achieves versus what it does not.

**Problem V3 left open:**

01A V1 `checkOrRecord` creates an `idempotency_records` row with status `in_progress` *before* the handler runs (01A §35). The handler executes §13 steps 1-2 in its own transaction. If that transaction rolls back (step 2 fails), the `idempotency_records` row is now orphaned — it points to "in\_progress" work that never persisted. On retry, 01A §35 sees `in_progress` and throws `IdempotencyInProgressError`, which 03B translates to 409\. But the retry could have safely executed the handler again because nothing was persisted.

**V4 pattern claimed to "eliminate" this; V4.1 honesty: it reduces but does not eliminate.**

What the V4 pattern *does* achieve:

1. **Clean `pending → in_progress` transition** — the transition happens atomically with the steps 1-2 transaction. If that transaction rolls back, the record stays `pending` (not orphaned `in_progress`). A retry can re-own it immediately via 01A's `reservePending` returning status `pending`.  
2. **Concurrent retry serialization** — `pg_try_advisory_xact_lock` prevents two concurrent handler instances from entering the steps 1-2 transaction for the same `client_turn_id`. Combined with the §14.4 UNIQUE constraint, silent duplicate `tutor_messages` rows are impossible.

What the V4 pattern does *not* solve (handled by 01A §35 stuck-record recovery, not by V4's additions):

3. **Handler crash after steps 1-2 commit but before completion** — if the Cloud Run instance crashes during phase 3 (orchestration) or phase 4 (steps 5-7 commit), the `idempotency_records` row is in `in_progress` status with no further progress. Retries see `in_progress` and get 409 until 01A §35's stuck-record recovery timer (default 5 minutes) transitions the record to `failed` and allows fresh re-execution.

**This 5-minute stuck-record window is the residual orphan case.** It is not a correctness bug — data is not corrupted; subsequent retries eventually succeed. It is a latency bug for a specific failure mode: legitimate retries during a handler-crash window get 409s for up to 5 minutes. Acceptable for V1 launch given Cloud Run crash rates are low (\<0.1% of requests per typical service), but not eliminated.

**Fully eliminating the stuck-record window would require** 01A V1.1 to expose a `runInTransaction(callerTx, fn)` variant that defers the `idempotency_records` insert *into* the caller's transaction. Then the record itself rolls back with the handler on any failure, and there is no stuck state. This is flagged as an upstream 01A V1.1 requirement — V4.1 pattern is the best correctness 03B can achieve without that upstream change.

**V4.1 pattern:**

async function appendTurnHandler(request: AppendTurnRequest): Promise\<TurnResponse\> {  
  const clientTurnId \= request.body.client\_turn\_id;  
  const lockKey \= hashToInt64(clientTurnId);

  // Phase 1: 01A idempotency record.  
  // reservePending normalizes failed → pending internally on content-hash match.  
  // Return statuses are: pending, in\_progress, completed.  
  const record \= await idempotencyService.reservePending({  
    scope: 'tutor\_turn',  
    clientKey: clientTurnId,  
    content: canonicalizeRequest(request),  
    ttl: 'scope\_default',  
  });

  // Case 1: already completed — return cached result (idempotent replay)  
  if (record.status \=== 'completed' && record.contentHashMatches) {  
    return record.cachedResult;  
  }

  // Case 2: already completed with different content — conflict  
  if (record.status \=== 'completed' && \!record.contentHashMatches) {  
    throw new IdempotencyConflictError(clientTurnId);  
  }

  // Case 3: another attempt is actively processing — ask client to wait  
  if (record.status \=== 'in\_progress') {  
    throw new IdempotencyInProgressError(clientTurnId);  
  }

  // Case 4: record.status \=== 'pending' — we own this attempt  
  // (reservePending internally handled failed → pending transition)

  try {  
    // Phase 2: handler transaction with advisory lock \+ status transition  
    await db.transaction(async (tx) \=\> {  
      // Acquire advisory lock on client\_turn\_id hash; auto-released on txn end  
      const locked \= await tx.query(  
        'SELECT pg\_try\_advisory\_xact\_lock($1) AS ok', \[lockKey\]  
      );  
      if (\!locked.rows\[0\].ok) {  
        // Another concurrent handler instance is in steps 1-2 for this key  
        throw new ConcurrentRetryError(clientTurnId);  
      }

      // Transition 01A record to in\_progress INSIDE this transaction.  
      // If the UPDATE finds status \!= 'pending' (another handler raced past  
      // reservePending and transitioned first), this returns 0 rows — retry path.  
      const updated \= await tx.query(  
        \`UPDATE idempotency\_records  
         SET status \= 'in\_progress'  
         WHERE id \= $1 AND status \= 'pending'  
         RETURNING id\`,  
        \[record.id\]  
      );  
      if (updated.rowCount \=== 0\) {  
        throw new ConcurrentRetryError(clientTurnId);  
      }

      // Steps 1-2: student message \+ instruction assignment  
      await insertStudentMessage(tx, request);  
      await insertInstructionAssignment(tx, request);  
    });

    // Phase 3: orchestration (outside any transaction)  
    // If the worker crashes here, record stays in\_progress until 01A §35 timer.  
    const orchestratorResult \= await invokeOrchestrator(request);

    // Phase 4: steps 4-7 \+ complete idempotency record (new transaction)  
    // If crash happens before this commits, same stuck-record window applies.  
    const finalResult \= await db.transaction(async (tx) \=\> {  
      await scanOutput(orchestratorResult);  
      await writeInferenceCache(tx, request, orchestratorResult);  
      await insertTutorMessage(tx, orchestratorResult);  
      await insertQuestionLinks(tx, orchestratorResult);  
      await insertInstructionExposures(tx, orchestratorResult);

      // Complete 01A record with result; participates in this transaction  
      // so if any of the above writes fail, the completion rolls back too.  
      await idempotencyService.complete(tx, record.id, orchestratorResult);

      return orchestratorResult;  
    });

    return finalResult;  
  } catch (err) {  
    // Mark 01A record as failed; retries can re-execute.  
    // Best-effort (does not participate in any transaction).  
    // If this itself fails (DB down), record stays in\_progress and 01A §35  
    // stuck-record timer handles recovery after threshold.  
    await idempotencyService.markFailed(record.id, err);  
    throw err;  
  }  
}

**State machine (V4.1 canonical; extends 01A §35):**

\<new\>    → pending       (via reservePending initial insert)  
pending  → in\_progress   (via UPDATE inside phase-2 txn)  
pending  → \<stays pending on phase-2 rollback; retry re-owns\>  
pending  → failed        (via markFailed on phase-1 handler error before phase-2)  
in\_progress → completed  (via complete() inside phase-4 txn)  
in\_progress → failed     (via markFailed on phase-3/phase-4 handler error)  
in\_progress → \<stuck\>    (worker crash; 01A §35 stuck-record timer → failed)  
failed   → pending       (via reservePending on new attempt with matching content hash)  
completed → (terminal)

**01A interface requirements (V1.1 upstream — V4.1 unchanged from V4):**

1. `reservePending({ scope, clientKey, content, ttl }): PendingRecord` — returns a record with status one of `pending | in_progress | completed`. Internal behavior:

   * If no record exists for clientKey: INSERT with `status = 'pending'`, return.  
   * If existing record has `status = 'pending'`: return existing.  
   * If existing record has `status = 'in_progress'`: return existing.  
   * If existing record has `status = 'completed'` and content hash matches: return with `contentHashMatches: true`.  
   * If existing record has `status = 'completed'` and content hash differs: return with `contentHashMatches: false`.  
   * **If existing record has `status = 'failed'` and content hash matches: UPDATE to `status = 'pending'`, return.** (This is the failed-state normalization — keeps caller pseudocode simple.)  
   * If existing record has `status = 'failed'` and content hash differs: treat as conflict (return as completed-with-mismatch so caller throws conflict).  
2. `complete(tx, recordId, result): void` — transitions record to `completed`, participates in caller's transaction. Cached for next replay.

3. `markFailed(recordId, error): void` — transitions record to `failed`, independent of caller txn (best-effort).

**Deploy coordination (V4.1 — SWE-V4-03 closeout):**

The schema addition of `status = 'pending'` to the `idempotency_records` enum must be understood by 01A's own internal logic (stuck-record recovery, retention). Deploy order:

1. **01A V1.1 ships first.** 01A V1.1 is backward-compatible: it understands `pending` and normalizes it to `failed` after the stuck-record threshold if a V4 03B handler crashed before transitioning. Existing 01A V1 `checkOrRecord` callers continue to work.  
2. **Then 03B V4.1 ships.** V4.1 03B calls `reservePending`; V1.1 01A handles it correctly.

If 03B V4.1 were to ship before 01A V1.1, 01A V1 would not know about `pending` status — its stuck-record recovery query (`WHERE status = 'in_progress'`) would miss `pending` rows and they would accumulate. 01A V1's retention cleanup would not purge them either. This is recoverable but messy; strict deploy ordering avoids it.

**Until 01A V1.1 ships:** V4.1 handlers use the inline implementation (equivalent to the above using raw DB ops on `idempotency_records` table). This is a tolerated short-term deviation from the "upstream canonicals owned once" principle (§1.10).

**Migration from V4 handler code:** minor — V4 already uses `reservePending/complete/markFailed`. V4.1 clarifies the pseudocode to explicitly show the `failed` case being handled internally by `reservePending`, and adds the `UPDATE ... RETURNING id; rowCount === 0 → ConcurrentRetryError` guard.

**Operational signals:**

* `idempotency_orphan_pending_rate` — `pending` records older than 60s. Expected rate near-zero; alerts at \>1/min indicate handler bugs.  
* `idempotency_stuck_in_progress_rate` — `in_progress` records past the stuck-record threshold (5 min). Expected rate \<0.01%; alerts at \>0.1% indicate handler crash correlation with specific failure mode. This is the residual orphan window the V4.1 pattern does not eliminate.

## **§14 Idempotency Semantics**

### **14.1 Delegation to 01A Part IV \+ 03B-layer extension**

Idempotency for POST /api/tutor/messages is primarily delegated to 01A Part IV `IdempotencyService`, with a 03B-layer two-phase extension documented in §13.7 (BLK-V3-01 closeout).

**01A Part IV ownership:** canonical JSON serialization (§32), content hash comparison (§33), record retention (§34), 409 conflict response shape.

**03B-layer extension:** the two-phase nesting pattern via advisory lock \+ `reservePending/complete/markFailed` interface per §13.7. This is required because 01A V1's `checkOrRecord` does not support multi-phase handlers with orchestration between DB transactions. V4 adds three new 01A interface methods as an upstream requirement (01A V1.1 consolidated hardening pass).

**Client contract unchanged:** `client_turn_id` is still the idempotency key; clients generate UUIDv4 per logical turn and retry with same ID.

### **14.2 Client responsibilities**

* Generate a fresh UUIDv4 for each logical new turn  
* Persist the `client_turn_id` locally until the request succeeds  
* On retry (network error, timeout, 5xx), send the same `client_turn_id`  
* On receiving a success response, mark the turn complete locally  
* If receiving 409 `idempotency_conflict`, recognize that the request content differs from the previous attempt with that key — rotate to a new UUID and re-submit  
* If receiving 409 `idempotency_in_progress`, wait and retry with same `client_turn_id`; do NOT rotate

### **14.3 Server behavior by scenario (via 01A §35 \+ §13.7 state machine)**

V3's state machine (per 01A §35: `in_progress | completed | failed`) is extended in V4 to include `pending` status for the two-phase pattern per §13.7.

**First request, fresh client\_turn\_id:**

* 01A `reservePending` creates record with status `pending`  
* Handler transitions to `in_progress` inside steps 1-2 transaction (atomic with advisory lock)  
* On success: 01A `complete` transitions to `completed` inside steps 5-7 transaction with result cached  
* Response: 200 OK with result

**Retry during pending execution (steps 1-2 running, not yet committed):**

* Second attempt calls `reservePending`; 01A returns existing `pending` record  
* Handler attempts advisory lock; `pg_try_advisory_xact_lock` returns false (first txn holds it)  
* 03B throws `ConcurrentRetryError` → 409 with `retry_after_ms: 500`  
* Client waits briefly, retries; either original txn has committed (status \= `in_progress` or `completed`) or rolled back (status \= `pending` again, retry re-owns it)

**Retry during in\_progress execution (orchestration running):**

* 01A returns record with status `in_progress`  
* 03B throws `IdempotencyInProgressError` → 409 with `retry_after_ms: 2000`  
* Client waits longer (orchestration can take 5-8s), retries

**Retry after completed success:**

* 01A returns record with status `completed` \+ matching content hash  
* Returns cached result envelope from DB  
* 03B returns 200 OK with original response  
* No re-inference, no new writes, no NOTIFY emission

**Retry after failed handler:**

* 01A returns record with status `failed`  
* If content hash matches → new attempt proceeds from `pending` phase (01A `reservePending` transitions `failed` → `pending` on new attempt per V4 extension)  
* Handler executes §13 flow again via advisory lock \+ new phase-1 transaction  
* Prior `failed` record is archived (01A §35 retention) — not overwritten; new record for new attempt

**Retry with DIFFERENT content, same client\_turn\_id:**

* 01A detects content hash mismatch on any status  
* 03B throws `IdempotencyConflictError` → 409 with `error.code = idempotency_conflict`  
* Client must use a different `client_turn_id`

**Worker crash mid-flow:**

* Record stuck in `pending` or `in_progress`; 01A §35 stuck-record timer marks `failed` after threshold (default 5 minutes)  
* Next client retry sees `failed`, proceeds as fresh attempt  
* No data corruption (advisory lock released on txn rollback; unique constraint enforces uniqueness even if locks were ever bypassed)

### **14.4 Persistence safety \+ defense in depth (AMB-V3-02 closeout)**

**`tutor_messages (conversation_id, client_turn_id)` UNIQUE constraint retained in V4.** V3 dropped this on the grounds that 01A `IdempotencyService` owns uniqueness. V4 reinstates as defense-in-depth:

ALTER TABLE tutor\_messages  
  ADD CONSTRAINT tutor\_messages\_client\_turn\_unique  
    UNIQUE (conversation\_id, client\_turn\_id);

**Rationale:**

* 01A is primary idempotency layer; works correctly in all documented scenarios  
* But: the §13.7 advisory-lock pattern relies on `pg_try_advisory_xact_lock` serialization within a single Postgres instance; cross-instance races could in theory bypass it during Postgres primary failover or logical replica scenarios  
* The UNIQUE constraint is a hard DB-level guarantee that survives any failure of the application-layer idempotency logic  
* Cost: one btree index on `(conversation_id, client_turn_id)` — already exists for `client_turn_id` lookup by handler retry path  
* Benefit: silent duplicate `tutor_messages` rows are impossible even under application-layer bugs

The constraint adds one check per insert. Expected violation rate: near-zero after V4 pattern lands (advisory lock does the work). Non-zero violation rate indicates either: (1) application bug in handler retry path, or (2) 01A service is failing to detect replays, in which case the constraint surfaces the bug via 409 rather than allowing silent corruption.

**Constraint violation handling:**

try {  
  await insertStudentMessage(tx, request);  
} catch (err) {  
  if (err.code \=== '23505' && err.constraint \=== 'tutor\_messages\_client\_turn\_unique') {  
    // Duplicate client\_turn\_id in tutor\_messages — 01A idempotency layer missed it  
    // This should not happen after V4; if it does, emit high-severity alert  
    log.error('idempotency\_unique\_constraint\_violation', { clientTurnId, conversationId });  
    throw new IdempotencyConflictError(clientTurnId);  
  }  
  throw err;  
}

### **14.5 Conversation close idempotency**

POST /api/tutor/conversations/:id/close is naturally idempotent via conversation status machine — does not need 01A `IdempotencyService`:

* First close: `status = 'active'` → updated to requested status  
* Repeat close: `status != 'active'` → `409 conversation_already_closed`

Clients that want silent idempotent close can check status first or handle 409 gracefully.

### **14.6 Start conversation idempotency**

POST /api/tutor/conversations is idempotent via the reuse rule (§5.5). Calling it repeatedly with the same envelope returns the same existing active conversation (if one matches). Does not need 01A `IdempotencyService`.

**Operational Contract for §14 flow:**

* **Fail posture:** fail-closed at 409 on conflict; fail-retry-safe on in-progress and pending  
* **Timeout:** `reservePending` typically \<5ms; advisory lock acquire typically \<1ms; full idempotency path \<10ms overhead  
* **Retry:** 01A owns state machine; 03B surfaces 409 conditions to client  
* **Fallback:** none (idempotency is a correctness primitive)  
* **Degraded mode:** if 01A or advisory-lock-supporting Postgres unavailable, turn fails 503  
* **Owner:** 01A Part IV for core service; 03B §13.7 for multi-phase extension; 01A V1.1 consolidated hardening pass for upstream migration

---

# **Part VII — Rate Limiting and Quota Enforcement**

## **§15 Rate Limits, Quotas, and Abuse Enforcement**

V3 restructures §15 as "LISA-specific rate limit and abuse consumption." Enforcement mechanics (counter storage, atomic increment, bucket definitions, abuse score computation, tier multipliers) are owned by 01A Part V `RateLimitLedger` and 01A Part VI `AbuseScoreService`. 03B specifies only what LISA-specific concerns layer on top: bucket definitions, 80% soft warning UX, appeal flow, child-user sensitivity.

### **15.1 Enforcement location**

Rate and quota checks happen at **step 7** of the append-turn flow (after auth, role, entitlement, ownership, payload validation; before idempotency check). Ordering rationale:

* Auth errors (401) precede quota errors (429) — no point checking quota for unauthenticated requests  
* Entitlement errors (403 \+ `entitlement_required`) precede quota errors — non-entitled users don't consume quota  
* Quota errors precede idempotency — reject at the gate even if the client is retrying

const rateCheck \= await rateLimitLedger.checkAndIncrement({  
  studentId: authUserId,  
  bucketKey: 'tutor\_turns\_daily',  
  cost: 1  
});  
if (\!rateCheck.allowed) {  
  throw new RateLimitExceededError(  
    rateCheck.bucketKey,  
    rateCheck.resetAt,  
    rateCheck.retryAfterSeconds  
  );  
}

01A Part V §41 is authoritative for atomic check-and-increment semantics. 01A §42 applies abuse-score multipliers to effective limits.

### **15.2 LISA buckets in `rate_limit_runtime_config.bucket_definitions`**

LISA-specific buckets registered in 01A's config table:

| Bucket key | Window | Base limit | Notes |
| ----- | ----- | ----- | ----- |
| `tutor_turns_daily` | 24h rolling | 120 | Per Doc 03 Main §13 |
| `tutor_turns_weekly` | 7d rolling | 2,500 | Per Doc 03 Main §13 |
| `tutor_turns_monthly` | Calendar month | 10,000 | Per Doc 03 Main §13 |
| `tutor_burst_60s` | 60s sliding | 10 | Per §1.7 burst control |
| `tutor_burst_5min` | 5min sliding | 30 | Per §1.7 burst control |

All limits are `rate_limit_runtime_config` values; shown as launch defaults. 01A §42 applies the abuse-score tier multiplier to these base values at check time.

**Removed from V2:** `tutor_abuse_scores` table with `quota_multiplier` and `rate_multiplier` columns. V3 uses 01A `abuse_scores` table \+ 01A §42 tier multiplier mechanics. See §15.7.

### **15.3 Soft warning at 80% (V4 closeout of AMB-V3-03)**

LISA-specific UX. When any bucket reaches 80% of **effective limit** (base × abuse multiplier), the turn succeeds but response includes:

{  
  "data": { /\* normal response \*/ },  
  "meta": {  
    "quota\_warning": {  
      "bucket\_key": "tutor\_turns\_daily",  
      "used": 96,  
      "limit": 120,  
      "percent\_used": 80,  
      "reset\_at": "2026-04-25T00:00:00Z"  
    }  
  }  
}

**V4 decision (AMB-V3-03 locked):** `limit` and `used` numbers reflect **effective** values (post-abuse-multiplier), not base. Rationale:

1. **Correct math for user:** if a student's abuse multiplier is 0.5, their effective daily limit is 60\. Showing "used 96 / limit 120" with hard rejection at 60 is confusing. Showing "used 48 / limit 60" matches what the user experiences.  
2. **Privacy posture:** 01A §57 prohibits exposing abuse score or tier label directly. Showing the effective number means the student may notice their limit differs from a public "120/day" messaging, but they can't infer their specific tier. Acceptable per product posture.  
3. **Appeal flow:** quota-exceeded appeal (§15.5) includes context about which bucket was hit; the appeal automatically includes the effective limit so support sees what the user saw.

**What the student sees:**

* Normal posture: "96/120 daily LISA turns used"  
* Flagged tier (multiplier 0.75): "54/90 daily LISA turns used" — discrepancy from public 120 is minor and unremarked  
* Concerning tier (0.5): "24/60 daily LISA turns used" — more noticeable  
* High-risk tier (0.25): "6/30 daily LISA turns used" — very noticeable but does not reveal tier

**What the student does NOT see:**

* Their abuse score (blocked by 01A §57)  
* Their tier label (blocked by 01A §57)  
* The discrepancy between base and effective limit (not surfaced)  
* Any signal that their limit is reduced due to abuse flags

Clients surface this as a popup per Doc 03 Main §13. No UI dashboard at V1.

01A Part V §43 emits a soft-warning signal via `getUsage`. 03B reads usage at step 7 check time (part of the same `checkAndIncrement` response if 01A supports; otherwise a follow-up `getUsage` call) and surfaces the warning when `used / effective_limit ≥ warning_threshold_pct` (default 80%, config `quota.warning_threshold_pct`).

### **15.4 Hard limit response**

When a bucket is exceeded, `checkAndIncrement` throws `RateLimitExceededError` (01A §0.6). 03B translates:

{  
  "error": {  
    "code": "quota\_exceeded",  
    "message": "Your daily LISA quota has been reached. Quotas reset at midnight UTC. Appeal available.",  
    "details": {  
      "bucket\_key": "tutor\_turns\_daily",  
      "used": 120,  
      "limit": 120,  
      "reset\_at": "2026-04-25T00:00:00Z",  
      "appeal\_url": "/api/tutor/quota-appeal"  
    }  
  }  
}

HTTP 429 per 01A §44. `Retry-After` header populated from `RateLimitExceededError.retryAfterSeconds` per 01A §44 response shape.

For burst limits (`tutor_burst_60s`, `tutor_burst_5min`), same 429 response with `error.code = rate_limit_exceeded` and shorter retry-after values.

### **15.5 Quota appeal endpoint**

Automated 1-click appeal per Doc 03 Main §13. Endpoint `POST /api/tutor/quota-appeal`. V1 integrates with V8 support-escalation flow per V8 §44 support-request path; appeal writes a record in V8's support queue with context (which bucket, reset\_at, student\_id, abuse score tier if non-zero).

Automated approval logic at V1 is conservative:

* First appeal for a student in 30 days, abuse tier `clean` (01A §50), bucket \= daily → auto-approve with quota reset  
* Any other condition → manual review in V8 support queue

V2 target: ML-scored appeal classification for automated handling of additional cases.

### **15.6 No Flash-Lite downgrade at V1**

Per Doc 03 Main §13 locked decisions: V1 does NOT downgrade to a cheaper model when quota is hit. Quota exceeded \= pause \+ appeal. Simpler than dynamic model routing.

### **15.7 Abuse-based effective limits (delegated to 01A §42)**

01A Part V §42 applies the abuse-score tier multiplier to base bucket limits automatically when `checkAndIncrement` is called. 03B does not implement the multiplier logic — it's 01A's, applied transparently.

**Tier → multiplier mapping (01A §42 launch defaults, reproduced for context):**

| 01A tier (score range) | Multiplier | Effective daily turns | User experience |
| ----- | ----- | ----- | ----- |
| Clean (0-20) | 1.0× | 120 | Normal |
| Flagged (21-40) | 0.75× | 90 | Slightly tighter |
| Concerning (41-60) | 0.5× | 60 | Noticeable restriction |
| High-risk (61-80) | 0.25× | 30 | Heavy restriction |
| Critical (81-100) | 0× | 0 | Functional lockout |

Score 81-100 effectively suspends LISA. V8 `canAccessFeature` also returns `abuse_score_lockout` for critical tier per V8 §27.3 step 7 — so critical-tier students are blocked at §3.2 entitlement check (before rate limit check is reached). §15 rate multipliers at other tiers apply only to students who pass entitlement.

**Per 01A §57 no-visibility rule:** students never see their abuse score or tier. Soft warnings at 80% of effective limit fire using the effective limit number (not base). Per §15.3 locked decision, users see their post-multiplier effective limit; tier inference is bounded by the absence of any direct score/tier signal.

### **15.8 Abuse incident emission**

03B emits `AbuseScoreService.recordIncident` for LISA-API-level abuse patterns not caught by 03A V3 §12A:

* **`tutor_api_injection_attempt`** — input sanitization flagged a signature match (§6.5 step 10); severity 5, triggers real-time recompute per 01A §54  
* **`tutor_api_retry_storm`** — 01A `IdempotencyService` receives \>5 retries of the same `client_turn_id` in 60s from the 03B layer; severity 3  
* **`tutor_api_quota_exhaustion_pattern`** — systematic quota-exhaustion behavior (daily bucket hits limit within 10 minutes of reset, repeated for 3+ days); severity 3

These emission points are inline where relevant in the flow. 01A §52 canonical incident types are used; LISA-specific sub-types go in `abuse_score_incidents.context.sub_type`.

### **15.9 No scoring logic in 03B**

V2 had extensive score computation logic in §15.9. V3 removes it entirely — 01A Part VI §53 is the canonical scoring formula:

`score = clamp(0, 100, Σ severity × base_weight × exp(-days_old / half_life_days))`

Weights live in `abuse_score_runtime_config.base_weights` per 01A §52. Nightly batch recompute \+ real-time recompute for severity ≥ 4 per 01A §54.

`tutor_injection_log` remains in 03A V3 for LISA-specific forensic detail (signature matched, response substituted). `abuse_score_incidents` (01A §55) is the platform-wide scoring ledger.

### **15.10 Child-user sensitivity — 03B-local pre-check (BLK-V3-02 closeout, Option C)**

**Motivation:** abuse score tier thresholds may over-penalize student users who are still minors and whose flagged behavior may reflect immaturity or confusion rather than ill intent. Platform policy is to avoid auto-locking minor accounts even under severe abuse signals, preferring manual ops review.

**V3 pitfall:** V3 §15.10 specified the rule as if it were enforced at V8 §27.3 step 7, but V8 V8 does not implement age-conditional tier adjustment. Implementing 03B V3 faithfully would have left the rule unenforced. V4 corrects this by moving the rule to a 03B-layer pre-check wrapper.

**V4 implementation pattern:**

// In 03B handler, wrapping V8 canAccessFeature:  
async function checkTutorAccessWithMinorAdjustment(  
  authUserId: string,  
  context: AccessCheckContext,  
): Promise\<AccessDecision\> {  
  // First call: standard V8 check  
  const v8Result \= await entitlementService.canAccessFeature(  
    'tutor\_access', authUserId, context,  
  );

  // If V8 allows, no adjustment needed  
  if (v8Result.allow) return v8Result;

  // If V8 denies for any reason OTHER than abuse\_score\_lockout, honor the denial  
  if (v8Result.reason \!== 'abuse\_score\_lockout') return v8Result;

  // V8 denied due to abuse\_score\_lockout — check minor-adjustment exception  
  const profile \= await profileCache.get(authUserId);  
  if (profile.age\_years \>= 16\) {  
    // Not a minor — V8 denial stands  
    return v8Result;  
  }

  // Minor account with abuse-score lockout: fetch score and check adjusted threshold  
  const score \= await abuseScoreService.getScore(authUserId);  // 01A Part VI  
  const standardCriticalThreshold \= 81;  // 01A §50 canonical  
  const minorAdjustedCriticalThreshold \= 91;  // V4 03B-local override

  if (score.current \>= minorAdjustedCriticalThreshold) {  
    // Still locked out even with minor adjustment  
    return v8Result;  
  }

  // Minor account in 81-90 range: override V8 denial to allow  
  await logger.warn('tutor\_minor\_lockout\_bypass\_applied', {  
    auth\_user\_id: authUserId,  
    abuse\_score: score.current,  
    request\_id: context.request\_id,  
  });  
  await metrics.increment('tutor\_abuse\_minor\_age\_adjustment\_applied');

  // Emit audit event for ops review queue  
  await auditLogger.emit({  
    event: 'tutor\_minor\_lockout\_bypass',  
    student\_id: authUserId,  
    score\_at\_bypass: score.current,  
    tier\_at\_bypass: score.tier,  
    request\_id: context.request\_id,  
  });

  return {  
    allow: true,  
    reason: 'minor\_override',  // LISA-specific reason; not in V8's taxonomy  
  };  
}

**Behavior summary:**

| Profile age | Abuse score | V8 decision | 03B override | User experience |
| ----- | ----- | ----- | ----- | ----- |
| ≥ 16 | Any | As V8 says | None | V8 decision stands |
| 13-15 | ≤ 80 (any non-critical tier) | Allow (tier multiplier applies via 01A §42) | None | Normal with compressed limits |
| 13-15 | 81-90 (critical per 01A) | Deny `abuse_score_lockout` | Override to allow \+ log | Access granted; ops review queued |
| 13-15 | ≥ 91 | Deny `abuse_score_lockout` | None | Lockout stands |

Quota multipliers (§15.7) still apply at all tiers regardless of age — compression at flagged/concerning/high-risk tiers is a soft-enforcement mechanism that reduces exposure without hard lockout. The age override only affects the critical-tier lockout decision.

**Why this lives in 03B and not V8 (for now):**

* V4 ships with V8 V8 unchanged; no spec-vs-implementation gap  
* The rule is LISA-specific at launch; other V8-gated features may want different age policies  
* When the consolidated hardening pass runs for V8 §27.3, this rule migrates upstream and the 03B pre-check is removed (principle §1.10: owned once)  
* The override emits a loud ops audit event so it's not invisible

**Concerns about the 03B-local approach:**

1. Duplicates V8 logic: 03B does a V8 call, then independently reads age \+ score to make a second decision. Inefficient (2 round-trips instead of 1\) but correct.  
2. Race: score could change between V8's internal read and 03B's follow-up read. Acceptable — both are eventually-consistent reads, and the override only applies to a narrow 81-90 band.  
3. Audit complexity: bypass events are logged; safety review queue owner reviews weekly per 01A §58 pattern.

### **15.10.1 Metrics and ops review**

* `tutor_abuse_minor_age_adjustment_applied` — counts bypass events; expected rate low (\<10/week at 10k active students)  
* `tutor_minor_lockout_bypass_score_distribution` — histogram over bypass score values (81-90); informs whether threshold should shift  
* Weekly review: all bypass events audited; patterns like repeat bypasses for same student flagged for manual intervention

### **15.10.2 Migration path to V8 ownership**

When V8 §27.3 is updated in consolidated hardening pass:

1. V8 adds age parameter to `canAccessFeature` or reads `profiles.age_years` internally  
2. V8 implements the 81-90 minor-adjusted threshold  
3. 03B removes §15.10 pre-check wrapper; calls V8 `canAccessFeature` directly  
4. `tutor_abuse_minor_age_adjustment_applied` metric migrates to V8's namespace

Target for migration: 01A V1.1 \+ V8 V9 consolidated hardening pass (next major review cycle).

### **15.10.3 Rate-limit multiplier interaction**

The age override applies ONLY to critical-tier lockout (V8's binary allow/deny at score ≥81). Rate multipliers at lower tiers are administered by 01A §42 and are not overridden by §15.10:

* Age 13-15 student with score 45 (concerning tier) still sees 0.5× quota multiplier per 01A §42 table  
* Age 13-15 student with score 85 (critical → bypassed by §15.10) sees 0× critical multiplier NOT applied because §15.10 bypass grants access; effective multiplier falls back to 0.25× (high-risk tier equivalent) for rate-limit purposes

Per 01A §42 interface: when 03B overrides to allow, it passes a `rate_multiplier_override: 0.25` hint to subsequent `RateLimitLedger.checkAndIncrement` calls for that turn. This is a new 01A §42 interface requirement flagged for 01A V1.1.

### **15.10.4 Safety net**

The 03B override is NOT a blanket bypass. Critical-tier scores ≥ 91 still result in lockout, because at that severity the platform policy (01A §50) treats the behavior as warranting functional suspension regardless of age.

If a minor account repeatedly cycles through bypass events (e.g., 3+ bypasses in 30 days), ops may choose to apply manual escalation via 01A §56 `adjustScore` or place the account on support hold via V8 §44 support-request path. Manual tooling is outside §15.10's automated scope.

### **15.10.5 Guardian visibility rule (V4.1 — BLK-V4-02 closeout)**

**Guardians MUST NOT see any §15.10 signal.** Specifically:

* Guardian dashboards do not surface the student's abuse score (extends 01A §57 no-visibility posture from student to guardian)  
* Guardian dashboards do not surface the student's abuse tier label  
* Guardian dashboards do not surface §15.10 bypass events  
* Guardian dashboards do not surface the fact that the student is currently benefiting from a minor-override (e.g., no "your student's access is being maintained under special review" messaging)  
* Guardian aggregate metrics (tutor usage per day, per week) reflect the *observed* values (which are already compressed by the 0.25× rate multiplier under bypass). Guardian does not see the underlying quota structure.

**Rationale:**

01A §57 posture: the student does not see their abuse score or tier, because surfacing it creates both a privacy-leak risk and a behavioral-shaping risk (gaming the threshold, stigma from a numerical score). §15.10 extends this posture to the guardian side because:

1. **Student-guardian trust relationship** — the guardian trust model (Doc 01 V8 guardian section) is for learning-progress visibility, not for platform-policy enforcement visibility. Surfacing bypass events to guardians turns the guardian into an enforcement agent, which is not the product posture.  
2. **Minor safety posture** — surfacing "your minor child has been flagged for abuse behavior on Lyceon" to a guardian creates household dynamics (punishment, removal of access) that the platform should not instigate. If the behavior warrants guardian involvement, that is a support-escalation path (V8 §44), not a dashboard line.  
3. **Bypass is an ops-safety-review event, not a guardian-facing event** — the weekly audit (§15.10.1) exists so safety review can identify patterns. Nothing about this function requires guardian visibility.

**Audit event visibility posture (canonical):**

| Audience | Access to §15.10 bypass events |
| ----- | ----- |
| Student | None (per 01A §57) |
| Guardian | None (V4.1 §15.10.5) |
| Ops safety review team | Full (via `tutor_minor_lockout_bypass` audit log; weekly review cadence per §15.10.1) |
| Customer support | Partial — visible only when handling a specific support escalation case for the named student (V8 §44); not browseable |
| Admin/engineering | Full via standard admin audit access (per 01A §58 support escalation pattern) |

**Related consolidation:** when V8 §27.3 absorbs the age-conditional tier adjustment in consolidated hardening pass (flagged for V8 V9), this §15.10.5 rule must be carried forward — V8's own guardian dashboard spec must explicitly not surface abuse-related events to guardians.

**Observability:**

* `tutor_minor_bypass_guardian_surface_violation` — counts any UI or API path that accidentally exposes bypass events to guardian audience. Target rate: 0\. Alert on any non-zero rate. This is a bug-surfacer metric — if it ever fires, there is a bug in a downstream consumer.

### **15.11 V1 scope summary**

* Nightly score computation operational per 01A Part VI  
* All 03A V3 §12A LISA-specific patterns logged (via `recordIncident`)  
* All §15.8 LISA-API-level patterns logged  
* Quota and rate multipliers enforced automatically per 01A §42  
* False positive review queue operational via 01A §58  
* Appeal process manual (V8 support escalation)  
* Child-user age adjustment (§15.10) applied at entitlement check

### **15.12 V2 targets**

* ML-based anomaly detection feeding score beyond rule-based incidents  
* Real-time score updates beyond severity-4+ incident triggers  
* Automated appeal handling for low-severity flags (especially first-time)  
* Cross-account correlation (account sharing detection via coordinated signals)

**Operational Contract for §15 turn-level check:**

* **Fail posture:** fail-closed on `RateLimitCheckUnavailableError` (01A §0.6)  
* **Timeout:** 50ms per 01A §74A for `checkAndIncrement`  
* **Retry:** none at 03B; 01A owns internal retry  
* **Fallback:** none — correctness primitive  
* **Degraded mode:** 503 to client if 01A unavailable  
* **Owner:** 01A Part V for mechanics; 03B for bucket registration \+ UX translation

---

# **Part VIII — Anti-Leak Runtime Enforcement at API**

## **§16 Anti-Leak at the API Boundary**

### **16.0 V4 alignment review (NTH-V3-01 closeout)**

V4 reviewed §16 content for alignment with V3/V4 hardening direction. Findings:

* §16 content is V2-aligned and remains correct under V3/V4 rebase  
* Anti-leak enforcement touchpoints (input sanitization, output scanning, response-envelope validation) are unchanged by V3 rebase or V4 blocker fixes  
* No substantive changes required

V4 preserves §16.1-§16.5 as written. Review closes as no-action.

Anti-leak enforcement per Doc 03 Main §17 has touchpoints throughout the stack. The API layer is responsible for:

### **16.1 Input sanitization (before orchestration)**

At step 10 of append-turn flow:

* **Length bound:** `message` length ≤ 4000 characters. Exceeding \= `400 invalid_input`  
* **Tag pass-through escape:** Replace literal `</student_message_content>` and similar boundary-marker strings with escaped variants before forwarding to orchestrator  
* **Injection pattern scan:** Run known-signature check; matches are logged and flagged in context envelope; severe signatures cause turn rejection with generic response per Doc 03A V3 §12.3

### **16.2 Context scrubbing (before orchestration)**

The context envelope sent to orchestration (Doc 03A V3 §5.4) has specific fields scrubbed based on surface and mode:

* **Pre-submit practice:** `current_question.correct_answer = null`, `current_question.explanation = null`  
* **Live exam:** (not reachable — blocked at §3.4)  
* **Review and test\_review post-submit:** full content available  
* **Dashboard/general:** no specific question content unless student asks about a specific item

The scrubbing happens in Doc 03A context resolution; the API layer verifies it was applied before forwarding to orchestration. Any context envelope with `current_question.correct_answer != null` on a pre-submit surface is a bug and raises an internal alert; the API rejects the turn rather than risk a leak.

### **16.3 Output scanning (after orchestration)**

At step 15 of append-turn flow, the orchestrator's response passes through the output scanner:

* **Answer leak detection:** For pre-submit contexts, scan for answer-revealing patterns ("the answer is B", option-elimination patterns, certainty language about specific options)  
* **Canonical ID leak:** Scan for SAT{M|RW}{1|2}\[A-Z0-9\]{6} patterns in response text (INV-03-10)  
* **System prompt leak:** Scan for signature phrases from the cached system prompt (INV-03-17)  
* **Policy variant leak:** Scan for `concise`, `scaffolded`, `socratic`, `strategy_first` appearing as apparent variant names  
* **Cross-student content:** Scan for references to other students' skills, conversations, or identifiable information (should be impossible via RLS, but belt-and-suspenders)

### **16.4 Scanner fail behavior**

If the scanner detects a leak:

* **Block the response** from being returned verbatim  
* **Substitute** a safe fallback response (e.g., "Let me think about this differently. Can you walk me through how you approached this?")  
* **Log the incident** to `tutor_injection_log` with `detection_layer = 'layer_4_output'`  
* **Persist the SUBSTITUTED response**, not the blocked one — the blocked content never reaches the student  
* **Increment a metric** for scanner block rate

### **16.5 Silent handling (INV-03-13)**

From the student's perspective, a scanner-blocked response looks like a normal LISA turn. No acknowledgment that something was blocked. No narration of the defense. The substituted response is genuinely pedagogical, not an error message.

### **16.6 Scope leak prevention**

Beyond output content scanning, the API layer ensures the response envelope doesn't leak scope information:

* `resolved_scope` in responses includes only the student's own scope (never another student's)  
* `source_question_canonical_id` is returned when the student's conversation references it, but it's the student's own data (RLS prevents cross-student leakage)  
* Internal fields (policy\_variant, emotional\_register, reason\_snapshot contents) are never in client-facing response bodies

---

# **Part IX — Similar-Question Runtime Flow**

## **§17 Similar-Question Offer and Acceptance**

Per Doc 03 Main §4 and Doc 03A V3 §6.5, LISA may offer a similar question under deterministic trigger conditions. The API layer manages the offer → consent → rendering flow.

### **17.1 Offer detection**

During orchestration (Doc 03C), the model may return a `suggested_action` of type `offer_similar_question`. This is not a side channel — the structured response from the orchestrator includes the suggestion explicitly.

When the API receives an orchestrator response with this suggestion:

1. The response is persisted to `tutor_messages` with `content_kind = 'suggestion'` in addition to the main message content  
2. The API writes a preliminary row to `tutor_question_links` capturing the offered question with `relationship_type = 'similar_retry'` (or whichever type applies) and `reason_code` indicating the trigger  
3. The client renders the consent prompt to the student

### **17.2 Consent flow**

The student's next turn indicates acceptance or decline. This is a normal append-turn request where `message` content is something like "yes", "sure", "no thanks", or via a structured UI button that sends `"Yes, show me the similar question"`.

The orchestrator recognizes the acceptance/decline in the context of the prior `suggested_action` and returns the appropriate next response:

* **Accept:** orchestrator's response references the related question; API loads the related question content and renders it  
* **Decline:** orchestrator's response continues the original discussion

### **17.3 Related question selection**

If the student accepts, related question selection happens server-side (not client-side) to prevent spoofing:

1. API reads the `tutor_question_links` row from step 17.1 to get the `related_question_row_id`  
2. API loads the canonical question content (stripping correct\_answer per anti-leak rules since this is pre-submit for the new question)  
3. Context envelope for the next orchestration call includes the new question as scoped content  
4. Student sees the rendered question (stem, options) via LISA's response; the canonical ID is never exposed

### **17.4 Attempt flow**

If the student attempts the related question during the LISA conversation:

* The attempt is a normal submission via the practice or review surface (Doc 02B V4), NOT via LISA  
* The API layer for LISA does not write practice\_session\_items or review\_session\_items  
* Mastery events flow through Doc 02B V4 runtime engines with `source_family` \= `practice` or `review` (never `tutor`)  
* The `tutor_question_links` row remains as the audit trail connecting the student's attempt to the LISA-originated suggestion

### **17.5 Difficulty variance logging**

If the related question has different difficulty than the source question, `difficulty_delta` on `tutor_question_links` captures the change (`-2`, `-1`, `0`, `+1`, `+2`). Per Doc 03 Main §4 constraints:

* Same difficulty by default  
* Easier allowed when "too sticky" trigger fired  
* Harder allowed only when clearly warranted  
* Every difficulty deviation is logged

### **17.6 Canonical ID confidentiality**

The student sees the rendered question content. The canonical ID (SAT{M|RW}{1|2}\[A-Z0-9\]{6}) is never displayed, never in API responses, never in UI elements (INV-03-10). Canonical ID is internal-only for logging and retrieval.

---

# **Part X — Concurrent Conversations and Reuse**

## **§18 Concurrent Conversation Rules**

### **18.1 Multiple active conversations allowed**

Per Doc 03A V3 §18.1 (CR-03A-17), the DB allows multiple active conversations per (student, envelope). This is intentional — preserves flexibility for edge cases and concurrency.

Common concurrent scenarios:

* Student has a `scoped_question` conversation on Math question A and opens a new LISA launch from Math question B → two separate scoped\_question conversations  
* Student has a `general` dashboard conversation and opens LISA from a practice session → one general \+ one scoped\_session, both active  
* Network race condition creates two active conversations with identical envelope → both exist; API reuse logic picks most-recent on next start

### **18.2 Reuse vs new**

Per §5.5, POST /api/tutor/conversations looks for eligible existing active conversations and returns the most recent. This is the default — the expected user flow:

* Student opens LISA from a question  
* Client calls POST /api/tutor/conversations with that envelope  
* Server finds existing conversation, returns it  
* Client fetches message history via GET and resumes

If the student explicitly wants a fresh conversation on the same envelope, they close the existing one first (POST /close) and then start a new one. V1 does not expose "force new conversation" as a client parameter; if product data shows this is commonly needed, V2 may add it.

### **18.3 Parallel turn submission**

If a student sends two append-turn requests in quick succession to the same conversation:

* Both requests authenticate and authorize  
* Both check entitlement and quota  
* Idempotency: if `client_turn_id` matches, second request is treated as retry (returns cached or completes the flow)  
* If `client_turn_id` differs: both proceed as separate turns  
* DB: turns are written in receipt order; `tutor_messages` ordering by `created_at` preserves sequence

No artificial serialization per conversation. Parallel turns are possible (rare in practice — humans don't type two messages at the same millisecond).

### **18.4 Conversation context isolation**

Per Doc 03A V3 §20.4 and Doc 03 Main: each conversation is independently scoped. Turns in conversation A do not affect turns in conversation B. Memory summaries are shared across conversations (per-student), but per-conversation history is isolated.

### **18.5 Cross-conversation inference**

Per Doc 03A V3 §7.3 hybrid memory fields: the `last_struggled_skill` and `last_mastered_skill` in `teaching_profile` may reflect signals from any conversation. When loaded into a context envelope for conversation B, LISA can "remember" struggles observed in conversation A. This is the intended "Knows Me" behavior per Doc 03 Main §4.10.

Conversation-specific context (message history, recent friction within this session) remains isolated.

---

# **Part XI — Internal and Support Access**

## **§19 Internal Access Controls**

### **19.1 Default deny**

No internal role has blanket access to LISA runtime data. RLS policies deny everything by default. Access requires explicit, narrowed, role-based grants per Doc 03A V3 §17.4.

### **19.2 Allowed internal access cases**

Per Doc 03 Main §15.3 and §21.3:

* **Production incident investigation:** ops on-call investigates a specific incident; temporary role grant with time-boxed access  
* **Abuse/safety investigation:** safety review queue owner (§21.3) reviews crisis-flagged conversations or injection-log events  
* **Approved support escalation:** narrowly scoped support ticket requiring view of specific conversation; requires explicit audit and user-awareness where applicable  
* **QA in non-production environments:** staging and dev tutor data is test data; no production access via this path

### **19.3 Audit requirement**

Every internal access to a specific student's tutor data writes an audit log entry with:

* Accessing role / user  
* Target student\_id  
* Data accessed (tables, row IDs)  
* Justification (ticket ID, incident ID, case ID)  
* Timestamp

Audit logs are queried weekly by the safety review queue owner to verify access patterns.

### **19.4 No implicit support access**

Support staff do not have default access to tutor conversations. A support ticket about a specific student requires explicit role activation (time-boxed, logged) to view that student's data. General support tooling does not pre-load tutor data.

### **19.5 HMAC signing for internal worker calls — delegated to 01A Part VII**

V2 specified an HMAC signing scheme inline. V3 delegates to 01A Part VII canonical convention — same mechanics, centralized location.

**01A Part VII canonical:**

* Signing string: `METHOD\nPATH\nTIMESTAMP\nSHA256_OF_BODY` per 01A §62.1  
* Headers: `X-Lyceon-Service-Id`, `X-Lyceon-Timestamp`, `X-Lyceon-Signature-V1` per 01A §62  
* Secret storage: `service_auth_secrets` table per 01A §64  
* Rotation: 90-day cadence, 14-day overlap per 01A §65  
* Timestamp tolerance: 5 minutes per 01A §66  
* Timing-safe comparison per 01A §67  
* Reverse-proxy enforcement of `/api/internal/*` per 01A §69

**LISA service pairs consuming 01A Part VII:**

| Service pair | Purpose | Endpoint |
| ----- | ----- | ----- |
| `memory-refresh-scheduler → memory-refresh-worker` | Schedules nightly refresh job | Per 03A V3 §9.4 |
| `memory-refresh-worker → main-api` | Writes back compacted summary to main API | `/api/internal/memory/compact-writeback` |
| `archival-scheduler → archival-worker` | Schedules nightly archival job | Per 03A V3 §19.3 |
| `archival-worker → main-api` | Writes deletion confirmations to main API | `/api/internal/tutor/archival/complete` |
| `main-api → vertex-orchestrator` | Main API invokes Doc 03C GCP orchestrator | Per Doc 03C (pending) |
| `vertex-orchestrator → main-api` | 03C calls back for async events (rare) | `/api/internal/tutor/orchestrator-callback` |

V2's three "service pairs" have grown to six in V3 as the architecture crystallized across 03A V3 \+ 03B V3.

**Removed from V2:** inline HMAC signing spec. Replaced by 01A §62 reference.

### **19.6 Emergency secret revoke (hardening item)**

Canonical revocation flow for compromised internal auth secrets. V2 had rotation cadence but no revoke procedure.

**Normal rotation:** per 01A §65, 90-day cadence with 14-day overlap. New secret active; old secret valid during overlap; old secret expires at end of window.

**Emergency revoke:** when a secret is known/suspected compromised, the normal 14-day overlap is unacceptable. Procedure:

1. **Generate new secret** and write to `service_auth_secrets` with `created_at = now()`  
2. **Revoke old secret** by setting `service_auth_secrets.revoked_at = now()` — queries in 01A §64 `loadActiveSecret` exclude rows where `revoked_at IS NOT NULL OR created_at + interval '<overlap>' < now()`  
3. **Force instance restart** to drop any in-memory cached secret (if applicable to the architecture) — Cloud Run: trigger a new revision deployment which replaces all instances  
4. **Monitor** `service_auth_signature_failure_rate` metric — should show brief spike as any in-flight requests using the revoked secret fail, then return to baseline as legitimate callers pick up the new secret

**V1 launch requirement:** emergency revoke procedure documented in Doc 01.2 runbook. Ops tooling to execute step 1-3 in a single workflow (set revoked\_at, insert new secret, trigger Cloud Run deployment). Target: revoke-to-drop time under 10 minutes.

**Detection signals:** unexpected `service_auth_signature_failure_rate` spike from a known service pair triggers Page alert. Consistent signature failures from a specific source IP could indicate attacker attempting replay with captured signatures (01A §66 5-minute timestamp tolerance caps this exposure, but `X-Lyceon-Service-Id` header allows per-pair investigation).

**V2 target:** automated revoke triggered by detection heuristics (spike in failures \+ IP anomaly → auto-revoke and regenerate).

**Operational Contract for internal auth (both §19.5 rotation and §19.6 revoke):**

* **Fail posture:** fail-closed on signature mismatch  
* **Timeout:** 5ms for signature verification per 01A §74A  
* **Retry:** not applicable to signature verification; caller retries transient network failures with 1 max retry  
* **Fallback:** during legitimate rotation, 14-day overlap protects most requests; during emergency revoke, accepted exposure is new secret propagation delay  
* **Degraded mode:** 401 response; caller operator investigates  
* **Owner:** 01A Part VII for mechanics; 03B for service pair registration and runbook

### **19.7 No tutor internals in student-facing surfaces**

Internal access paths never expose tutor internals (`reason_snapshot`, `policy_variant`, `emotional_register`, scanner block logs) to student-facing UIs. Internal dashboards for support use different presentation than the student dashboard.

---

# **Part XII — UI Launch Contract**

## **§20 Client Responsibilities**

The client (web app at V1, future mobile) is the primary consumer of Doc 03B APIs. This section specifies what the client must do to interact correctly.

### **20.1 Practice launch**

When student opens LISA from a practice question:

1. Client calls POST /api/tutor/conversations with:  
   * `entry_mode = 'scoped_question'`  
   * `source_surface = 'practice'`  
   * `source_session_id = <practice_session.id>`  
   * `source_session_item_id = <practice_session_item.id>`  
   * `source_question_row_id = <question.id>`  
   * `source_question_canonical_id = <question.canonical_id>`  
2. Client receives conversation\_id (new or reused)  
3. Client fetches history via GET if `reused: true`  
4. Client starts rendering LISA UI with context

### **20.2 Review launch**

When student opens LISA from a review item:

1. POST /api/tutor/conversations with:  
   * `entry_mode = 'scoped_question'`  
   * `source_surface = 'review'`  
   * `source_session_id = <review_session.id>`  
   * `source_session_item_id = <review_session_item.id>`  
   * `source_question_row_id = <question.id>`  
   * `source_question_canonical_id = <question.canonical_id>`

### **20.3 Full-length review launch**

When student opens LISA from a test review item (after exam complete):

1. POST /api/tutor/conversations with:  
   * `entry_mode = 'scoped_question'`  
   * `source_surface = 'test_review'`  
   * `source_session_id = <full_length_exam.id>`  
   * `source_session_item_id = <full_length_exam_response.id>`  
   * `source_question_row_id = <question.id>`  
   * `source_question_canonical_id = <question.canonical_id>`

Client must verify exam is complete before offering LISA launch — attempting to launch during live exam will be blocked at API (per §3.4) but the client should not surface the option in the first place.

### **20.4 Dashboard/general launch**

When student opens LISA from dashboard:

1. POST /api/tutor/conversations with:

   * `entry_mode = 'general'`  
   * `source_surface = 'dashboard'`  
   * All other fields null  
2. Client presents recommended chips per Doc 03 Main §20:

   * Review my recent mistakes  
   * Help with my last full-length  
   * Explain a topic or skill  
   * Help me decide what to study today  
   * Ask a general question  
3. Student picks a chip or types freeform

4. Client sends first append-turn with chip selection or typed content

### **20.5 Turn submission**

For every LISA message:

1. Generate fresh UUIDv4 for `client_turn_id`  
2. POST /api/tutor/messages with conversation\_id, message, content\_kind, client\_turn\_id, client\_scope  
3. On success: append response to UI; mark turn complete  
4. On `503 orchestration_failed_recoverable`: retry with SAME `client_turn_id` after `retry_after_ms`; max 1 retry per turn  
5. On `500 canonical_write_failed`: same — retry with same `client_turn_id`; max 1 retry  
6. On `429 quota_exceeded`: surface appeal UI per Doc 03 Main §13  
7. On `403 entitlement_required`: surface renewal UI  
8. On `403 tutor_unavailable_during_live_exam`: surface "LISA is not available during exams" message  
9. On other errors: standard error toast with retry option

### **20.6 Quota warnings**

On successful response with `meta.quota_warning`, surface a popup informing the student they're at 80% of quota. No UI dashboard at V1.

### **20.7 Close conversation**

When the student navigates away or explicitly ends the conversation:

1. If navigation: POST /close with `status = 'abandoned'`  
2. If explicit close button: POST /close with `status = 'closed'`

Client handles `409 conversation_already_closed` gracefully (no-op).

### **20.8 Idempotency across app restarts**

If the client crashes mid-turn, on restart:

* Check local storage for pending `client_turn_id` that didn't receive a response  
* Retry POST /api/tutor/messages with the same `client_turn_id`  
* Server returns cached response or completes flow (per §14.3)

This is the happy-path failure recovery. The client should implement it.

---

# **Part XIII — Streaming (V1 Scope and V2 Roadmap)**

## **§21 Streaming Status**

### **21.1 V1 scope: synchronous only**

Per Doc 03A V3 §12 injection defense layer assumptions and Doc 03C orchestration design, V1 uses synchronous request/response. POST /api/tutor/messages blocks until the orchestrator returns a complete response (or times out at `runtime_limits.timeout_ms`, default 8000ms).

Rationale for V1:

* Simpler API semantics  
* Simpler error handling (one request → one response)  
* Simpler output scanning (scan complete response once)  
* Simpler persistence ordering (no partial state mid-stream)  
* Simpler rate limiting (one request → one counter increment)  
* Perceived latency acceptable at sub-second P50 for typical responses

### **21.2 Why not streaming at V1**

Streaming introduces:

* Partial response handling — what to persist and when?  
* Mid-stream failure semantics  
* Mid-stream scanner blocking (if injection detected mid-token, how to recover?)  
* More complex client state machine  
* More complex idempotent retry

These are solvable but not necessary for V1 — initial perceived latency with Flash-tier models is typically under 2s for most responses. Streaming delivers perceived improvement but adds complexity that's better deferred until V1 is stable.

### **21.3 V2 roadmap**

Streaming is a V2 target per Doc 03 Main §27. When implemented:

* New endpoint: `POST /api/tutor/messages/stream` (WebSocket or SSE)  
* Response delivered token-by-token  
* Output scanner runs on complete response before final commit; if scan blocks, the stream is replaced with safe fallback (client sees a brief flash, then the safe response)  
* Persistence happens at stream close (same ordering as synchronous — student message before orchestration, tutor message after scan)  
* Error handling: mid-stream failures cause the stream to close with an error frame; client retries with same `client_turn_id`

### **21.4 No partial streaming in V1**

V1 does not partially stream. Every successful response is delivered whole via the existing POST /api/tutor/messages endpoint. Clients that want perceived faster responses during V1 can implement typing indicators or placeholder UI; no server-side streaming exists.

---

# **Part XIV — API Observability**

## **§22 Observability at the API Layer**

V3 rebases §22 onto 01A Part II canonical observability. Doc 03A V3 §19A covers context-layer observability. Together these give a complete picture of LISA runtime health, with all generic conventions (logger interface, correlation IDs, metrics naming, PII redaction, alert routing) owned centrally by 01A.

**Inherited from 01A Part II (not re-specified here):**

* Structured logger interface (01A §11)  
* `request_id` correlation middleware and propagation through async boundaries (01A §12, §17)  
* Log levels, log sinks, retention (01A §13, §19)  
* PII redaction transport — includes raw tutor prompts, raw tutor responses, student answers, tutor content per blocked-fields list (01A §14)  
* Metrics interface, naming convention `<subsystem>_<object>_<verb>[_<unit>]`, percentile conventions P50/P95/P99 (01A §15, §16)  
* Alert routing (Page / Warn / Info / Debug) per 01A §18

**LISA-API-specific observability (specified below):**

### **22.1 Per-endpoint metrics**

Every endpoint emits:

* `request_count` — total requests  
* `request_duration_ms` — P50 / P95 / P99 end-to-end latency  
* `response_status_code` — distribution of 2xx / 4xx / 5xx  
* `error_code_distribution` — breakdown by `error.code` for 4xx/5xx responses  
* `auth_failure_rate` — 401/403 as share of total  
* `entitlement_failure_rate` — 403 with `entitlement_required` as share of total

Dashboards aggregate per endpoint and globally.

### **22.2 Append-turn-specific metrics**

POST /api/tutor/messages additionally emits:

* `idempotency_hit_rate` — share of turns served from cache vs fresh inference  
* `idempotent_retry_rate` — share of turns that are retries of a prior `client_turn_id`  
* `orchestration_failure_rate` — share of turns where orchestration returned 503-recoverable  
* `canonical_write_failure_rate` — share of turns where blocking writes failed  
* `scanner_block_rate` — share of turns where output scanner substituted response  
* `injection_flag_rate` — share of turns flagged by input sanitization  
* `mean_tokens_per_turn` — input \+ output tokens for cost attribution  
* `scope_conflict_rate` — share of turns where `client_scope` disagreed with stored conversation scope

### **22.3 Conversation lifecycle metrics**

* `conversation_create_rate` — new conversations per unit time  
* `conversation_reuse_rate` — share of POST /conversations that returned existing conversation  
* `conversation_close_rate` by status (`closed` vs `abandoned`)  
* `turns_per_conversation` distribution  
* `session_duration` distribution (create → close or abandon)  
* `concurrent_active_conversations_per_student` distribution

### **22.4 Rate limit and quota metrics**

* `rate_limit_rejection_rate` — 429 from burst limit  
* `quota_exceeded_rate` per quota type (daily / weekly / monthly)  
* `quota_warning_rate` — share of responses carrying `meta.quota_warning`  
* `quota_appeal_request_rate` — appeals submitted  
* `quota_appeal_approval_rate` — appeals approved (feeds to Doc 03 Main §13 review)

### **22.5 API-layer SLO targets**

Adding to Doc 03 Main §26.B baseline and Doc 03A V3 §19A.7:

| Metric | Target | Notes |
| ----- | ----- | ----- |
| POST /api/tutor/messages P50 | \<2000ms | Including orchestration |
| POST /api/tutor/messages P95 | \<5000ms | Hard ceiling for user experience |
| POST /api/tutor/messages P99 | \<8000ms | Matches orchestration timeout |
| POST /api/tutor/conversations P95 | \<200ms | No orchestration, just reuse check |
| GET /api/tutor/conversations/:id P95 | \<300ms | Includes paginated message load |
| GET /api/tutor/conversations P95 | \<250ms | List endpoint |
| POST /api/tutor/conversations/:id/close P95 | \<150ms | Lightweight |
| API uptime | \>99.5% | Quarterly rolling average |
| Scanner block false positive rate | \<5% of blocks | Weekly review |
| Canonical write success rate | \>99.9% | Alert below threshold |

### **22.6 Alerting**

**V1 launch alerts (paged):**

* POST /api/tutor/messages P95 \>7000ms sustained 10 min  
* Error rate \>5% of requests sustained 5 min  
* Canonical write failure rate \>0.5% sustained 5 min  
* Orchestration failure rate \>10% sustained 5 min  
* Entitlement check service failure rate \>1% sustained 5 min  
* Scanner block rate \>2% sustained 30 min (indicates either prompt drift or attack)  
* Rate limit rejection rate \>5% of requests sustained 10 min (suggests something broken, not just abuse)

**V1 launch alerts (non-paged, dashboard review):**

* Scope conflict rate \>1% — client may be sending stale scope  
* Idempotent retry rate \>3% — network reliability issue or client retry logic aggressive  
* Quota warning popup rate daily trend — informs limit calibration

### **22.7 Correlation and tracing**

Every API request is assigned a `request_id` (UUIDv4) on entry. This ID threads through:

* All API-level logs for this request  
* The context envelope passed to Doc 03C  
* Orchestration internal logs  
* DB query logs where supported  
* Response header `X-Request-Id` for client debugging

Distributed tracing is V2 target. V1 uses correlation via `request_id` in structured logs.

### **22.8 Structured logging**

Every API log entry is structured JSON with:

{  
  "timestamp": "iso8601",  
  "level": "info | warn | error",  
  "request\_id": "uuid",  
  "student\_id": "uuid | null",  
  "endpoint": "POST /api/tutor/messages",  
  "duration\_ms": "integer",  
  "status\_code": "integer",  
  "error\_code": "text | null",  
  "conversation\_id": "uuid | null",  
  "client\_turn\_id": "uuid | null",  
  "meta": { /\* endpoint-specific extras \*/ }  
}

Logs go to the standard Lyceon observability backend. No tutor internals in logs (no `reason_snapshot`, no `policy_variant`, no scanner-block detail at INFO level — those go to dedicated audit channels).

### **22.9 Cost metrics**

Per Doc 03 Main §24 and Doc 03A V3 §19A.5:

* `input_tokens_per_turn` — attributed per student and globally  
* `output_tokens_per_turn` — attributed per student and globally  
* `total_cost_per_student_per_day` — rolled up  
* `cost_anomaly_alert` — per Doc 03 Main §26.A Failure Mode Matrix: alert if a student's daily cost exceeds 3x their 30-day average

Cost metrics drive the Doc 03 Main §24 cost model reconciliation and inform quota tuning over time.

### **22.10 API version header (CR-03B-26)**

Per MED-01 from Doc 03B V1 review: every response includes an `X-API-Version` header indicating the API contract version this response conforms to.

**Header format:**

X-API-Version: 1.0

Value comes from `misc.api_version` config key. Bumps on breaking changes:

* Major version bump: breaking change (new endpoint URL prefix `/api/v2/tutor/*`, old endpoints maintained for deprecation window)  
* Minor version bump: additive, non-breaking changes (new optional fields, new error codes in additional-info-only category)  
* Patch version bump: internal changes that don't affect contract (logging, performance)

Clients can optionally send `X-Accept-API-Version: 1.x` on requests to negotiate version. V1 servers ignore this header (single version); V2 uses it for version routing.

**Observability:**

Track `api_version_distribution` across responses — useful for tracking deployment coverage during version rollouts.

### **22.11 Schema-driven API contract (CR-03B-26)**

Per MED-02 from Doc 03B V1 review: API request and response shapes must be defined as Zod schemas with OpenAPI generation, not handwritten drift.

**Requirement:**

Every endpoint's request body, response body, and error envelope is defined as a Zod schema in `packages/shared/schemas/tutor/` per the Lyceon coding standards §7.2 single source of truth rule. These Zod schemas:

1. **Validate requests at the API boundary** — runtime validation of incoming bodies  
2. **Serve as TypeScript type source** — `type Foo = z.infer<typeof fooSchema>`  
3. **Generate OpenAPI spec** — via `@asteasolutions/zod-to-openapi` or equivalent  
4. **Drive client SDK generation** — TypeScript client types generated from OpenAPI spec  
5. **Drive test fixtures** — property-based test fixtures generated from schemas

The OpenAPI spec is committed to the repo and regenerated on every schema change. CI verifies that schema changes produce regenerated OpenAPI without manual intervention.

**What this prevents:**

* API documentation drifting from implementation (docs manually maintained → always wrong eventually)  
* Client SDK types drifting from server types (hand-written client types diverge silently)  
* Different services sharing a concept but having slightly different schemas (single source of truth prevents this)  
* Test fixtures hand-crafted from memory rather than from schema (test invariants don't match implementation)

**V1 launch requirement:**

Every endpoint in this document has corresponding Zod schemas before launch. Missing schemas block launch. Re-validation on every schema change in CI is required.

**V2 targets:**

* GraphQL schema generation from same source  
* Automated breaking-change detection in CI (e.g., removing a required field bumps major version automatically)  
* Runtime contract validation in staging — production responses validated against schema, mismatches logged

### **22.12 Per-Primitive SLI table (V4.1 updated)**

The hardening template introduces per-primitive SLIs — narrow, actionable indicators tied to specific failure modes rather than broad latency/error-rate aggregates. V4 added SLIs from V3 blocker fixes (`teaching_profile_staleness_lag_minutes`, `idempotency_orphan_pending_rate`) and organized all SLIs into 4 dashboard groups. V4.1 adds `idempotency_stuck_in_progress_rate` (BLK-V4-01 residual-window tracker) and `tutor_minor_bypass_guardian_surface_violation` (BLK-V4-02 bug-surfacer).

| SLI | Target | Alert threshold | Upstream owner | Dashboard |
| ----- | ----- | ----- | ----- | ----- |
| `idempotency_hit_rate` (01A Part IV) | 0.5-2% of requests | \>10% (client retry logic aggressive) | 01A Part IV | Turn Flow Health |
| `idempotency_conflict_rate` (01A §33) | \<0.1% | \>1% (client bug or attack) | 01A Part IV | Turn Flow Health |
| `idempotency_in_progress_rate` | \<0.1% | \>1% (handler deadlock risk) | 01A Part IV | Turn Flow Health |
| `idempotency_orphan_pending_rate` (V4 — §13.7) | \~0 (near-zero after V4.1 pattern) | \>1/min (handler bug) | 01A Part IV \+ 03B §13.7 | Turn Flow Health |
| `idempotency_stuck_in_progress_rate` (V4.1 — BLK-V4-01 residual) | \<0.01% | \>0.1% (crash correlation) | 01A §35 \+ 03B §13.7 | Turn Flow Health |
| `canonical_write_success_rate` | \>99.9% | \<99% | 03B §13 | Turn Flow Health |
| `scope_conflict_rate` | \<0.5% | \>1% | 03B §11 | Turn Flow Health |
| `orchestrator_callback_success_rate` | \>99% | \<95% | 03C | Turn Flow Health |
| `tutor_minor_bypass_guardian_surface_violation` (V4.1 — §15.10.5) | 0 | any non-zero | 03B §15.10.5 | Platform Integration |
| `cache_stale_serve_rate` (all caches) | \<5% | \>20% (invalidation failing) | 01A Part III | Cache Layer Health |
| `cache_stampede_coalesce_count` (per-key) | Informational | N/A | §12E | Cache Layer Health |
| `listen_connection_reconnect_rate` | \<10/hr/instance | \>100/hr (pooler degradation) | 01A §28 | Cache Layer Health |
| `teaching_profile_staleness_lag_minutes` (V4 new — §12B.5.2) | \<5 min | \>30 min (write-through \+ NOTIFY failing) | 03B §12B.5 | Cache Layer Health |
| `vertex_context_cache_hit_rate` | \>70% steady state | \<50% (cache churn) | 03B §12B.5 | Cache Layer Health |
| `vertex_context_cache_creation_latency_p95` | \<1000ms | \>3000ms (Vertex degradation) | 03B §12B.5 | Cache Layer Health |
| `inference_result_cache_hit_rate` (on retry) | \>80% of retries | \<50% (TTL too short or DB write slow) | 03B §12B.4 | Cache Layer Health |
| `entitlement_check_latency_p95` | \<50ms | \>200ms | V8 | Platform Integration |
| `v8_abuse_score_unavailable_rate` | \<0.01% | \>1% | 01A Part VI | Platform Integration |
| `rate_limit_false_positive_rate` | \<0.5% | \>2% (bucket threshold mis-calibrated) | 01A Part V | Platform Integration |
| `rate_limit_soft_warning_rate` | Informational | Sudden shift (new abuse pattern) | 01A Part V | Platform Integration |
| `hmac_auth_failure_rate` per service pair | \<0.01% | \>1% (compromise signal) | 01A Part VII | Platform Integration |
| `memory_refresh_job_success_rate` | \>99% | \<95% | 03A V3 §9 | Platform Integration |
| `cloud_run_instance_cold_start_rate` | \<1% of requests | \>5% (scaling thrash) | 03B §12A.4 | Cloud Run \+ Vertex |
| `postgres_listen_connection_count_active` | \<120 (80% of pool) | \>140 (93% of pool) | 03B §28B.4 | Cloud Run \+ Vertex |

**Dashboard groupings (V4 closeout of SWE-V3-03):**

**Dashboard 1 — Turn Flow Health:** primary user-facing health. Tracks the POST /api/tutor/messages happy path and its correctness primitives (idempotency, scope, persistence, orchestrator). Ops primary view during incidents affecting user experience.

**Dashboard 2 — Cache Layer Health:** diagnoses cache-related degradation. Split between Tier 1/2 caches (stale serve, coalesce, listener reconnect) and Vertex-provider-side caches (hit rate, creation latency, teaching\_profile staleness, inference retry). Weekly review cadence for capacity planning.

**Dashboard 3 — Platform Integration:** health of upstream canonicals that LISA consumes. V8 entitlement, 01A abuse/rate limit/auth, 03A memory refresh. Ops uses this to attribute LISA-visible symptoms to upstream causes.

**Dashboard 4 — Cloud Run \+ Vertex Topology:** infrastructure-level health. Instance scaling behavior, Postgres pool utilization, Vertex-level SLIs (from §22.13). Ops ownership for scaling decisions.

Each SLI is emitted via the 01A §15 metrics interface with the subsystem prefix matching its owner (`tutor_`, `idempotency_`, `rate_limit_`, `cache_`, `service_auth_`, `vertex_`, etc.). Ops reviews all four dashboards weekly during post-launch phase; Page alerts from any dashboard escalate to on-call.

### **22.13 Vertex AI SLI block (LISA-specific)**

Vertex AI is LISA's largest single external dependency. Its performance and availability directly dictate user experience. Dedicated SLIs:

| Vertex SLI | Target | Alert threshold |
| ----- | ----- | ----- |
| `vertex_request_latency_p50` | \<2000ms | \>3500ms |
| `vertex_request_latency_p95` | \<4500ms | \>6000ms |
| `vertex_request_latency_p99` | \<7000ms | \>9000ms (near 8s orchestrator timeout) |
| `vertex_availability` | \>99.9% | \<99% (daily) |
| `vertex_429_rate` (platform rate limits) | \<0.1% | \>1% (Vertex-side throttling — need to shift traffic or scale tier) |
| `vertex_500_rate` | \<0.1% | \>1% (Vertex service degradation) |
| `vertex_context_cache_hit_rate` | \>70% | \<50% |
| `vertex_context_cache_invalidation_lag_ms` | \<1000ms | \>5000ms |
| `vertex_input_tokens_per_turn_mean` | 1500-3000 | \>5000 (context bloat) |
| `vertex_output_tokens_per_turn_mean` | \<500 | \>1000 (prompt drift or LLM verbosity) |

Vertex outages are handled per §28A Failure Mode Matrix: complete Vertex unavailability produces 503 on every turn attempt; no LISA-side fallback (we do not have a local model backup). Status page reflects the outage; users retry once Vertex recovers. Expected frequency: Vertex SLA is 99.9% monthly, so \~43 minutes/month of potential outage. Acceptable risk at V1.

**Cloud Run \+ Vertex combined failure posture:**

* Cloud Run healthy, Vertex degraded → every turn returns 503; auth/health endpoints return 200  
* Cloud Run degraded, Vertex healthy → Cloud Run autoscaling surfaces 503s during scale-up; requests retry  
* Both degraded → 503 on everything; user-facing message explains temporary unavailability

---

# **Part XV — V1 Launch Core vs V2 Targets**

Paralleling Doc 03 Main §25 and Doc 03A V3 §21A-D. This section makes explicit what ships at V1 launch and what is deferred.

## **§23A V1 Launch Core (Must Ship)**

Non-negotiable for V1 launch. Missing any blocks launch.

**Authentication and authorization:**

* \[ \] Supabase JWT validation on every `/api/tutor/*` endpoint  
* \[ \] Role check rejecting non-student roles with 403  
* \[ \] Guardian exclusion architecturally (no tutor endpoint accessible via guardian JWT)  
* \[ \] Conversation ownership check on all endpoints referencing `conversation_id`  
* \[ \] Full-length exam block enforced (INV-03-02)

**Endpoints:**

* \[ \] POST /api/tutor/conversations with reuse rule  
* \[ \] POST /api/tutor/messages with 19-step server flow  
* \[ \] GET /api/tutor/conversations/:id with pagination  
* \[ \] GET /api/tutor/conversations with filter and pagination  
* \[ \] POST /api/tutor/conversations/:id/close with async memory compaction enqueue

**Entitlement enforcement:**

* \[ \] Per-request entitlement check (INV-03-18)  
* \[ \] Age (\>=13) and country (Tier 1\) checks integrated  
* \[ \] No grace period; fail-closed on check errors  
* \[ \] Mid-conversation entitlement changes block next turn

**Idempotency:**

* \[ \] `client_turn_id` required on append-turn  
* \[ \] DB uniqueness constraint on `(conversation_id, client_turn_id)`  
* \[ \] Retry semantics: partial-failure recovery completes flow with same key  
* \[ \] Retry semantics: full-success returns cached response

**Persistence ordering:**

* \[ \] Authoritative 19-step sequence implemented  
* \[ \] Blocking vs non-blocking writes distinguished correctly  
* \[ \] Transactions: steps 1-2 atomic; steps 5-7 atomic  
* \[ \] Failure modes produce correct error codes and preserve idempotent retry

**Rate limiting and quotas:**

* \[ \] Daily (120), weekly (2,500), monthly (10,000) quotas enforced  
* \[ \] Burst rate limit (10/60s, 30/5min) enforced  
* \[ \] Soft 80% warning via response metadata  
* \[ \] Hard 100% rejection with appeal URL  
* \[ \] Quota appeal endpoint integration point defined

**Anti-leak enforcement:**

* \[ \] Input sanitization (length bound 4000, tag escape, signature scan) on every turn  
* \[ \] Context scrubbing verified before orchestration forwarding  
* \[ \] Output scanning after orchestration with safe fallback substitution  
* \[ \] Silent handling of blocked responses (INV-03-13)

**Similar-question flow:**

* \[ \] Offer detection from orchestrator structured response  
* \[ \] Server-side related-question selection from `tutor_question_links` row  
* \[ \] Consent via student's next turn  
* \[ \] Attempt flow through Doc 02B V4 (never `tutor` source\_family)  
* \[ \] Canonical ID never exposed in responses (INV-03-10)

**Error handling:**

* \[ \] HTTP status codes per §6.9 and §5.8 tables  
* \[ \] Error envelope shape consistent across endpoints  
* \[ \] `retry_after_ms` on recoverable 503 responses  
* \[ \] Client-actionable error messages without leaking internals

**Observability:**

* \[ \] Per-endpoint metrics emitted  
* \[ \] Append-turn specific metrics (idempotency, scanner, orchestration)  
* \[ \] V1 launch dashboards configured  
* \[ \] V1 launch alerts configured and routed  
* \[ \] Structured logging with `request_id` correlation  
* \[ \] Cost metrics per turn attributed per student

**Integration:**

* \[ \] Doc 03A V3 context envelope produced per §5.4 spec  
* \[ \] Doc 03A V3 dedicated service roles used for all writes (tutor\_runtime\_writer primary)  
* \[ \] Doc 03C orchestration integration point defined and functional  
* \[ \] Doc 02B V4 retry flow correctly routes mastery events (source\_family \!= tutor)

**Client contract:**

* \[ \] All launch surfaces (practice, review, test\_review, dashboard) produce correct conversation envelopes  
* \[ \] Client handles all documented error codes  
* \[ \] Client supports idempotent retry across app restart  
* \[ \] Client surfaces quota warnings and appeals  
* \[ \] Client never attempts to launch LISA during live full-length exam

## **§23B V1 Post-Launch Phased Rollout**

Post-launch phases align with Doc 03A V3 §21B.

**Phase 1 (launch):** Everything in §23A.

**Phase 2 (week 4-6 post-launch):**

* Quota calibration based on real usage data  
* Scanner block threshold tuning based on false-positive review  
* P95 latency optimization if observed beyond SLO targets  
* Client retry backoff tuning based on observed failure patterns

**Phase 3 (week 8-10 post-launch):**

* Expand internal support access tooling (gated on audit trail being mature)  
* Cost anomaly alerting thresholds refined  
* Observability dashboard V2 refresh based on real operator workflow

## **§23C V2 Targets**

Deferred to V2 roadmap. Not launch-blocking.

**Streaming:**

* `POST /api/tutor/messages/stream` endpoint (WebSocket or SSE)  
* Partial response persistence semantics  
* Mid-stream scanner fail recovery  
* Client state machine for streaming

**Advanced idempotency:**

* Request hash-based idempotency (detects same content with different keys)  
* Extended cache TTL for idempotent responses

**Advanced rate limiting:**

* Abuse-based quota multipliers (Doc 03A V3 §12A.5 active enforcement)  
* ML-driven anomaly-based rate limiting  
* Per-endpoint differentiated limits

**Force-new conversation:**

* Optional `force_new: true` parameter on POST /api/tutor/conversations if product data shows this is needed

**Observability extensions:**

* Distributed tracing integration  
* Per-feature A/B cohort analysis  
* ML-driven anomaly detection on metrics

**API versioning:**

* `/api/v2/tutor/*` path prefix when breaking changes become necessary  
* V1 endpoints maintained for backward compatibility during transition

## **§23D Future Targets (Undated)**

Acknowledged but not on V2 roadmap:

* GraphQL or gRPC API surface (currently REST-only)  
* Multi-region API gateway routing  
* Mobile-optimized endpoints (bulk fetch, prefetch hints)  
* Offline conversation capability  
* Third-party API integrations

Product-direction statements, not engineering commitments.

---

# **Part XVI — Acceptance Criteria**

## **§24 Acceptance Criteria for Doc 03B V1**

Doc 03B V1 is satisfied when:

**Authentication and authorization:**

* \[ \] All `/api/tutor/*` endpoints require valid Supabase JWT  
* \[ \] JWT validation rejects expired and invalid tokens with 401  
* \[ \] Non-student roles rejected with 403  
* \[ \] Conversation ownership verified on id-referencing endpoints  
* \[ \] Ownership mismatch returns 404 (not 403\) to avoid existence leak

**Entitlement:**

* \[ \] Entitlement check runs on every request (INV-03-18)  
* \[ \] Paid tier \+ age \+ country \+ entitlement status all verified  
* \[ \] No grace period; check errors fail closed with 503  
* \[ \] Mid-conversation entitlement changes block next turn with 403 \+ `entitlement_required`

**Endpoints behave per spec:**

* \[ \] POST /conversations creates or reuses per §5.5 rule  
* \[ \] POST /messages executes 19-step flow correctly  
* \[ \] GET /conversations/:id returns paginated messages with ownership enforced  
* \[ \] GET /conversations lists scoped to student, excludes soft-deleted  
* \[ \] POST /close transitions status and enqueues memory compaction

**Scope resolution:**

* \[ \] Stored conversation scope is authoritative over client\_scope  
* \[ \] Scope conflicts logged to `reason_snapshot.scope_conflict`  
* \[ \] Stale references trigger fallback chain per §11.3  
* \[ \] No fail-open: missing scope triggers error, not broad retrieval

**Idempotency:**

* \[ \] `client_turn_id` required on append-turn  
* \[ \] Duplicate key with same content returns cached response  
* \[ \] Duplicate key with different content returns 409  
* \[ \] Partial-failure retry completes flow correctly

**Persistence:**

* \[ \] Student message persisted before orchestration (step 1\)  
* \[ \] Instructional assignment persisted before tutor response returned (step 2\)  
* \[ \] Tutor message persisted only after output scan (step 5\)  
* \[ \] Blocking write failures prevent success response  
* \[ \] Transactions correct per §13.2

**Rate limits and quotas:**

* \[ \] Burst limits enforced (10/60s, 30/5min)  
* \[ \] Daily/weekly/monthly quotas enforced per Doc 03 Main §13  
* \[ \] 80% warning surfaces via response metadata  
* \[ \] 100% exceeded returns 429 with appeal URL  
* \[ \] No Flash-Lite downgrade at V1

**Anti-leak:**

* \[ \] Input length bounded to 4000 chars  
* \[ \] Tag pass-through escaped before orchestration  
* \[ \] Output scanner runs on every orchestrator response  
* \[ \] Scanner blocks substitute safe fallback  
* \[ \] Silent handling per INV-03-13  
* \[ \] No canonical IDs in any response body (INV-03-10)

**Similar-question:**

* \[ \] Offer detected from orchestrator structured response  
* \[ \] Related question selected server-side via `tutor_question_links`  
* \[ \] Attempt flows through Doc 02B V4 with `source_family != 'tutor'`  
* \[ \] Canonical ID never in client-facing output

**Concurrent conversations:**

* \[ \] DB allows multiple active conversations per envelope  
* \[ \] API reuse picks most-recently-updated matching conversation  
* \[ \] Parallel turn submissions both succeed per idempotency rules  
* \[ \] Cross-conversation memory inference works (`last_struggled_skill`, `last_mastered_skill`)

**Internal access:**

* \[ \] Default deny — no implicit support access  
* \[ \] Audit logs on every internal access  
* \[ \] Time-boxed role grants for incident investigation

**Error handling:**

* \[ \] HTTP status codes per §6.9 and §5.8  
* \[ \] Error envelope shape consistent  
* \[ \] `retry_after_ms` on 503-recoverable responses  
* \[ \] No internal details leaked via error messages

**Observability:**

* \[ \] All metrics in §22 emitted  
* \[ \] Dashboards configured and accessible  
* \[ \] Alerts configured and routing to on-call  
* \[ \] `request_id` threaded through logs and `X-Request-Id` header  
* \[ \] Cost metrics attributed per student per day

**Integration:**

* \[ \] Doc 03A V3 context envelope produced correctly  
* \[ \] Doc 03C orchestration integration point functional  
* \[ \] Dedicated service roles (Doc 03A V3 §17.4) used for writes

**UI contract:**

* \[ \] Client sends correct envelopes for all four launch surfaces  
* \[ \] Client handles all documented error codes  
* \[ \] Client implements idempotent retry with `client_turn_id` persistence

---

# **Part XVII — Governance**

## **§25 Review Triggers**

Doc 03B must be reviewed when any of the following occur:

* Doc 03A V3 context envelope shape changes (§5.4)  
* Doc 03C orchestration interface changes  
* Doc 01 V8 entitlement model changes — specifically `EntitlementService.canAccessFeature` signature or denial reason taxonomy  
* Doc 01 V8 account deletion or soft-delete retention policy changes  
* Doc 01A platform primitive interface changes (config, logger, cache, idempotency, rate limit, abuse score, internal service auth) — specifically changes to 01A §52 incident taxonomy, 01A §42 multiplier table, 01A §62 signing string, 01A §0.6 error class additions  
* Doc 01A addition of child-user sensitivity rule to `AbuseScoreService` (per §15.10 V3 requirement flagged for upstream)  
* Doc 03 Main invariants added, modified, or retired  
* New endpoint added or existing endpoint's contract changes  
* HTTP status code table changes  
* Error envelope shape changes  
* Rate limit or quota base values change (note: tier multipliers are 01A-owned, not 03B)  
* New authentication method added (beyond Supabase JWT)  
* Vertex AI model family change (Gemini version bump) — implicates §12B.5 cache invalidation behavior  
* Cloud Run regional/multi-region topology change — implicates §12A.4 scaling behavior  
* Streaming endpoint added (V2)  
* Breaking API changes requiring version bump

## **§26 Lock Semantics**

"Locked" means:

* The API contract is authoritative for client and server implementation  
* Changes require explicit update of this document with change record  
* Silent drift in implementation is not allowed  
* Client SDK must match this contract

Post-lock, additive clarification is allowed. Behavior-changing changes require explicit review, version update, change record, and client coordination.

Breaking changes require a new API version (`/api/v2/tutor/*`) and a deprecation window for the prior version.

## **§27 Migration Rule (governance)**

If the deployed API behavior differs from this document, the mismatch must be reconciled explicitly:

1. Log the discrepancy  
2. Determine canonical truth (spec or production)  
3. Update whichever is wrong  
4. Document the reconciliation in change records

This document must not silently drift from the deployed API contract.

## **§27.1 Client SDK alignment**

A client SDK (TypeScript, at V1) is maintained alongside this document. The SDK must match the endpoint contracts here. SDK type definitions should be generated from the same Zod schemas used in API validation per §22.11.

SDK version numbers track API contract versions. SDK v1.x supports API v1.x. Breaking API changes bump SDK major version.

---

# **Part XVII.5 — Database Tables Reference**

Per Karl directive: reference current tutor tables and suggest expansion as needed. V3 updates this section to reflect the 03A V3 table landscape with 01A ownership cross-references.

## **§27A Current LISA Runtime Tables**

| Table | Owned by | Purpose | 03B interaction |
| ----- | ----- | ----- | ----- |
| `tutor_conversations` | 03A V3 §18.1 | Conversation envelope and scope metadata | Reads every request; writes on create/close/status change |
| `tutor_messages` | 03A V3 §18.2 | Line-by-line conversation history | Writes student message (step 1\) and tutor message (step 5\) per §13 |
| `tutor_memory_summaries` | 03A V3 §18.3 | Durable compact summaries including V1 structured fields | Reads during context resolution; memory refresh worker writes |
| `tutor_instruction_assignments` | 03A V3 §18.4 | Policy decision log per turn or pivot | Writes per step 2 |
| `tutor_question_links` | 03A V3 §18.5 | Question relationship log for similar-question flow | Writes at suggestion offer (§17.1) and on acceptance (§17.3) |
| `tutor_instruction_exposures` | 03A V3 §18.6 | Rendered surface log | Writes per step 7 (non-blocking) |
| `tutor_context_runtime_config` | 03A V3 §18.7 (renamed per 01A §8) | Runtime configuration key-value store | Read at bootstrap per 01A §3; LISTEN/NOTIFY refresh per 01A §4 |
| `tutor_context_runtime_config_history` | 03A V3 / 01A §5 shared-append-only | Config change audit trail | Ops read; append on every config update |
| `tutor_injection_signatures` | 03A V3 §18.7 | Known attack signature patterns | Reads during input sanitization (§6.5 step 10\) |
| `tutor_injection_log` | 03A V3 §18.7 | LISA-specific forensic detail for safety review (per 03A V3 §12.8 dual-write) | Writes on detection; `abuse_score_incidents` (01A §55) is the separate platform-wide abuse ledger |

**V3 table changes from V2:**

* `tutor_context_config` → renamed to `tutor_context_runtime_config` per 01A §8 naming convention  
* `tutor_context_config_history` → renamed to `tutor_context_runtime_config_history`  
* **`tutor_abuse_scores` deleted** — 03B consumes 01A `abuse_scores` (01A §55) directly; no LISA-specific abuse score table  
* `tutor_inference_cache` moved from Redis pattern to Postgres table (V3 change §12B.4)  
* `tutor_vertex_context_cache` added (V3 new §12B.5)

**V4 table changes from V3:**

* `tutor_messages (conversation_id, client_turn_id)` UNIQUE constraint **retained** (V3 had dropped it; V4 keeps as defense-in-depth per §14.4)  
* `tutor_vertex_context_cache.student_id` column **added** as nullable FK with `ON DELETE CASCADE` per SWE-V3-05 (enables clean cascade on account deletion)  
* `idempotency_records.status` extended to include `pending` (V4 extension of 01A §35 state machine per §13.7; upstream migration to 01A V1.1 pending)

## **§27B Expanded `tutor_context_runtime_config`**

Doc 03A V3 §18.7 defined `tutor_context_runtime_config` with four seed values (`recent_message_window`, `memory_summary_staleness_days`, `injection_length_bound_chars`, `study_context_relevance_window_days`). Doc 03B V2 expands this table per core principle §1.9 (runtime constants live in DB tables).

**Schema expansion (migration from Doc 03A V3 shape):**

\-- Expand existing table with additional columns  
ALTER TABLE tutor\_context\_runtime\_config  
  ADD COLUMN config\_category TEXT,  
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'all',  
  ADD COLUMN changed\_by TEXT,  
  ADD COLUMN change\_reason TEXT,  
  ADD COLUMN effective\_from TIMESTAMPTZ NOT NULL DEFAULT now();

\-- Add constraint on category values  
ALTER TABLE tutor\_context\_runtime\_config  
  ADD CONSTRAINT tutor\_context\_runtime\_config\_category\_check  
  CHECK (config\_category IN (  
    'quota', 'rate\_limit', 'validation', 'timeout', 'cache\_ttl',  
    'freshness', 'pagination', 'security', 'misc'  
  ));

\-- Index for category-scoped reads  
CREATE INDEX idx\_tutor\_context\_runtime\_config\_category  
  ON tutor\_context\_runtime\_config (config\_category, environment);

\-- Audit history table for config changes  
CREATE TABLE tutor\_context\_runtime\_config\_history (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  config\_key TEXT NOT NULL,  
  previous\_value JSONB,  
  new\_value JSONB NOT NULL,  
  changed\_by TEXT,  
  change\_reason TEXT,  
  changed\_at TIMESTAMPTZ NOT NULL DEFAULT now()  
);

\-- Trigger to log every config change  
CREATE OR REPLACE FUNCTION log\_config\_change() RETURNS TRIGGER AS $$  
BEGIN  
  INSERT INTO tutor\_context\_runtime\_config\_history (  
    config\_key, previous\_value, new\_value, changed\_by, change\_reason  
  ) VALUES (  
    NEW.config\_key,  
    OLD.config\_value,  
    NEW.config\_value,  
    NEW.changed\_by,  
    NEW.change\_reason  
  );  
  RETURN NEW;  
END;  
$$ LANGUAGE plpgsql;

CREATE TRIGGER tutor\_context\_runtime\_config\_audit  
  AFTER UPDATE ON tutor\_context\_runtime\_config  
  FOR EACH ROW EXECUTE FUNCTION log\_config\_change();

**V1 launch seed values (supersedes Doc 03A V3 §18.7 seed):**

INSERT INTO tutor\_context\_runtime\_config (config\_key, config\_category, config\_value, description) VALUES  
\-- Quota  
('quota.daily\_turns', 'quota', '120', 'Daily LISA turn limit per student'),  
('quota.weekly\_turns', 'quota', '2500', 'Weekly LISA turn limit per student'),  
('quota.monthly\_turns', 'quota', '10000', 'Monthly LISA turn limit per student'),  
('quota.warning\_threshold\_pct', 'quota', '80', 'Soft warning threshold percentage'),  
('quota.appeal\_url\_path', 'quota', '"/api/tutor/quota-appeal"', 'Appeal endpoint path'),

\-- Rate limit  
('rate\_limit.burst\_per\_60s', 'rate\_limit', '10', 'Max turns per 60-second window'),  
('rate\_limit.burst\_per\_5min', 'rate\_limit', '30', 'Max turns per 5-minute window'),

\-- Validation  
('validation.message\_max\_chars', 'validation', '4000', 'Max characters per student message'),  
('validation.pagination\_default', 'validation', '20', 'Default page size for list endpoints'),  
('validation.pagination\_max', 'validation', '100', 'Max page size for list endpoints'),  
('validation.message\_pagination\_default', 'validation', '50', 'Default message page size for fetch conversation'),  
('validation.message\_pagination\_max', 'validation', '200', 'Max message page size'),

\-- Timeout  
('timeout.orchestrator\_ms', 'timeout', '8000', 'Max orchestrator call duration'),  
('timeout.orchestrator\_retry\_after\_ms', 'timeout', '2000', 'Retry-after suggestion on recoverable failure'),  
('timeout.entitlement\_check\_ms', 'timeout', '500', 'Max entitlement check duration before fail-closed'),  
('timeout.api\_overall\_p99\_ms', 'timeout', '10000', 'Hard ceiling for any API request'),

\-- Cache TTL  
('cache.entitlement\_ttl\_sec', 'cache\_ttl', '60', 'Entitlement cache TTL'),  
('cache.entitlement\_hard\_staleness\_sec', 'cache\_ttl', '300', 'Max staleness during DB outage before fail-closed'),  
('cache.conversation\_ownership\_ttl\_sec', 'cache\_ttl', '60', 'Conversation ownership cache TTL'),  
('cache.live\_exam\_ttl\_sec', 'cache\_ttl', '30', 'Live exam status cache TTL'),  
('cache.inference\_result\_ttl\_sec', 'cache\_ttl', '60', 'Inference result cache window for retry recovery'),  
('cache.canonical\_question\_ttl\_sec', 'cache\_ttl', '86400', 'Canonical question content cache (24h)'),  
('cache.memory\_summary\_ttl\_sec', 'cache\_ttl', '300', 'Memory summary cache TTL'),  
('cache.runtime\_config\_ttl\_sec', 'cache\_ttl', '60', 'In-process config refresh interval'),  
('cache.abuse\_score\_ttl\_sec', 'cache\_ttl', '300', 'Abuse score cache TTL'),

\-- Freshness  
('freshness.conversation\_reuse\_days', 'freshness', '7', 'Max conversation age for reuse eligibility'),  
('freshness.memory\_teaching\_profile\_days', 'freshness', '14', 'Teaching profile staleness threshold'),  
('freshness.memory\_recent\_learning\_pattern\_days', 'freshness', '7', 'Recent learning pattern staleness'),  
('freshness.memory\_study\_context\_days', 'freshness', '3', 'Study context staleness'),  
('freshness.recent\_message\_window', 'freshness', '12', 'Default recent messages loaded in context Layer 2'),  
('freshness.memory\_summary\_staleness\_days', 'freshness', '14', 'Days after which teaching\_profile flagged stale'),

\-- Pagination (merged into validation category; kept as aliases for backward reference)  
\-- (see validation.\* keys above)

\-- Security  
('security.min\_age\_years', 'security', '13', 'Minimum student age'),  
('security.tier\_1\_countries', 'security', '\["US","CA","UK","AU","NZ","IE","SG"\]', 'Tier 1 country allow-list'),  
('security.hmac\_timestamp\_tolerance\_sec', 'security', '60', 'HMAC request timestamp skew tolerance'),  
('security.service\_role\_rotation\_days', 'security', '90', 'Service role credential rotation cadence'),  
('security.injection\_length\_bound\_chars', 'security', '4000', 'Max student message before injection check rejection'),  
('security.study\_context\_relevance\_window\_days', 'security', '7', 'Days before exam that triggers study context load'),

\-- Misc  
('misc.api\_version', 'misc', '"1.0"', 'Current API contract version'),  
('misc.default\_policy\_variant', 'misc', '"scaffolded"', 'Default policy variant for new conversations'),  
('misc.default\_emotional\_register', 'misc', '"default"', 'Default emotional register');

**Migration from V1 seed (Doc 03A V3):**

\-- Existing V1 keys updated with categories  
UPDATE tutor\_context\_runtime\_config SET config\_category \= 'freshness'  
  WHERE config\_key IN ('recent\_message\_window', 'memory\_summary\_staleness\_days', 'study\_context\_relevance\_window\_days');  
UPDATE tutor\_context\_runtime\_config SET config\_category \= 'security'  
  WHERE config\_key \= 'injection\_length\_bound\_chars';

**Application-layer loading:**

Every API instance loads the full config table at startup and refreshes every `cache.runtime_config_ttl_sec` seconds (default 60s). The loaded config is an in-process map keyed by `config_key`. Reads are O(1) hash lookups. Missing keys fall back to bundled defaults with a logged warning.

**V1 launch blocker:**

Before launch, `tutor_context_runtime_config` must contain all keys listed above with their default values. Missing keys cause bundled-default fallback with alerts; all seed values should be present and reviewed.

## **§27C `tutor_error_codes` (LISA-specific)**

Per §22.11 schema-driven contract and the error tables in §5.9 and §6.9, error codes become a DB-backed registry.

**Schema:**

CREATE TABLE tutor\_error\_codes (  
  error\_code TEXT PRIMARY KEY,  
  http\_status INTEGER NOT NULL,  
  category TEXT NOT NULL CHECK (category IN (  
    'auth', 'entitlement', 'validation', 'rate\_limit',  
    'conflict', 'orchestration', 'internal', 'scope'  
  )),  
  user\_message\_template TEXT NOT NULL,  
  internal\_description TEXT,  
  retry\_allowed BOOLEAN NOT NULL DEFAULT FALSE,  
  retry\_after\_ms\_default INTEGER,  
  localization\_key TEXT,  
  added\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  deprecated\_at TIMESTAMPTZ  
);

CREATE INDEX idx\_tutor\_error\_codes\_category  
  ON tutor\_error\_codes (category)  
  WHERE deprecated\_at IS NULL;

\-- RLS: service role only  
ALTER TABLE tutor\_error\_codes ENABLE ROW LEVEL SECURITY;  
\-- Config-level tables; manual admin writes only

**V1 launch seed (selected):**

INSERT INTO tutor\_error\_codes (error\_code, http\_status, category, user\_message\_template, retry\_allowed, retry\_after\_ms\_default) VALUES  
('unauthenticated', 401, 'auth', 'Please sign in to continue.', TRUE, null),  
('token\_expired', 401, 'auth', 'Your session has expired. Please sign in again.', TRUE, null),  
('role\_not\_permitted', 403, 'auth', 'This feature is not available for your account type.', FALSE, null),  
('entitlement\_required', 403, 'entitlement', 'LISA access requires an active paid subscription.', FALSE, null),  
('age\_restricted', 403, 'entitlement', 'LISA is available for students age 13 and older.', FALSE, null),  
('region\_not\_supported', 403, 'entitlement', 'LISA is not yet available in your region.', FALSE, null),  
('tutor\_unavailable\_during\_live\_exam', 403, 'entitlement', 'LISA is not available during a live full-length exam.', TRUE, null),  
('conversation\_not\_found', 404, 'validation', 'That conversation no longer exists.', FALSE, null),  
('conversation\_closed', 409, 'conflict', 'This conversation has ended. Start a new one?', FALSE, null),  
('conversation\_already\_closed', 409, 'conflict', 'Conversation already closed.', FALSE, null),  
('invalid\_input', 400, 'validation', 'There''s an issue with your request. Please try again.', TRUE, null),  
('rate\_limited', 429, 'rate\_limit', 'Too many requests. Please wait a moment.', TRUE, 5000),  
('quota\_exceeded', 429, 'rate\_limit', 'Your LISA quota has been reached.', FALSE, null),  
('idempotency\_conflict', 409, 'conflict', 'Duplicate request detected with different content.', FALSE, null),  
('canonical\_write\_failed', 500, 'internal', 'Something went wrong saving your turn. Please retry.', TRUE, 2000),  
('orchestration\_failed\_recoverable', 503, 'orchestration', 'LISA is momentarily unavailable. Please retry.', TRUE, 2000),  
('orchestration\_failed', 500, 'orchestration', 'LISA encountered an unexpected error.', TRUE, 5000),  
('entitlement\_check\_unavailable', 503, 'entitlement', 'Verifying your account. Please try again.', TRUE, 5000),  
('account\_under\_review', 403, 'entitlement', 'Your LISA access is paused pending review. Contact support.', FALSE, null),  
('internal\_error', 500, 'internal', 'Something went wrong. Please try again.', TRUE, 5000);

**Application usage:**

Error code registry is loaded at startup. Error responses are constructed from the registry rather than hardcoded strings in route handlers:

// Pseudo-code  
function errorResponse(errorCode: string, details?: object): Response {  
  const entry \= errorCodeRegistry.get(errorCode);  
  return {  
    status: entry.http\_status,  
    body: {  
      error: {  
        code: entry.error\_code,  
        message: entry.user\_message\_template,  
        retry\_after\_ms: entry.retry\_after\_ms\_default,  
        details  
      }  
    }  
  };  
}

**V2 targets:**

* Localization: add `locale` column and per-locale message templates  
* Error code deprecation workflow: `deprecated_at` set, client-facing warning in response metadata for deprecated codes

## **§27D `tutor_inference_cache` (LISA-specific, Postgres)**

Per §12B.4 inference result cache. V3 moved this from Redis (V2) to Postgres, consistent with §12A.2 no-Redis stack decision.

**Schema:**

CREATE TABLE tutor\_inference\_cache (  
  cache\_key TEXT PRIMARY KEY,  \-- format: "inference:{conversation\_id}:{client\_turn\_id}"  
  student\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,  
  conversation\_id UUID NOT NULL REFERENCES tutor\_conversations(id) ON DELETE CASCADE,  
  client\_turn\_id UUID NOT NULL,  
  response\_envelope JSONB NOT NULL,  \-- orchestrator response per 03C contract  
  scan\_result JSONB NOT NULL,  \-- output scan decision  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  expires\_at TIMESTAMPTZ NOT NULL  
    GENERATED ALWAYS AS (created\_at \+ interval '60 seconds') STORED,

  CONSTRAINT tutor\_inference\_cache\_turn\_unique  
    UNIQUE (conversation\_id, client\_turn\_id)  
);

CREATE INDEX idx\_tutor\_inference\_cache\_expires  
  ON tutor\_inference\_cache (expires\_at);

**§27D.1 Scheduled cleanup (V4 justification, AMB-V3-05 closeout):**

SELECT cron.schedule(  
  'tutor\_inference\_cache\_cleanup',  
  '\* \* \* \* \*',  \-- every minute (tunable via cache.inference\_cleanup\_interval\_seconds)  
  $$DELETE FROM tutor\_inference\_cache WHERE expires\_at \< now();$$  
);

**Cadence rationale:** V1 launch cadence is per-minute. Expected row count at steady-state:

* 1M turns/day \= \~700 turns/minute  
* 60s TTL → \~700 rows × 1 minute retention ≈ 700 rows at steady state  
* Per-minute DELETE scans \~0-1400 rows (depending on arrival jitter) — trivial DB cost

**Tuning target:** config key `cache.inference_cleanup_interval_seconds` (default 60). At launch, per-minute keeps table small; post-launch, 5-minute cadence is viable (\~3500 rows between cleanups; still trivial) if per-minute cron proves noisy.

**Why not partitioning:** for 60s TTL with \~700 rows at steady state, table is small enough that row-level DELETE is fine. Partitioning (§27G) is for high-volume tables with month-scale retention where DROP PARTITION is faster than DELETE. Inference cache doesn't fit that pattern.

Per §12B.4 operational contract — fail-safe to re-inference on cache miss.

## **§27E `tutor_vertex_context_cache` (LISA-specific, Postgres) — V4 updated per SWE-V3-05**

Per §12B.5 Vertex AI context cache mapping. Persists LISA's mapping from logical cache identity to Vertex-side `CachedContent` name.

**V4 schema (adds `student_id` column):**

CREATE TABLE tutor\_vertex\_context\_cache (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  cache\_kind TEXT NOT NULL CHECK (cache\_kind IN (  
    'system\_prompt', 'teaching\_profile', 'canonical\_question'  
  )),  
  cache\_key TEXT NOT NULL,  \-- logical key per kind  
  student\_id UUID REFERENCES profiles(id) ON DELETE CASCADE,  \-- V4: nullable FK for student-scoped kinds  
  vertex\_cached\_content\_name TEXT NOT NULL,  \-- Vertex-assigned name  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  expires\_at TIMESTAMPTZ NOT NULL,  
  invalidated\_at TIMESTAMPTZ,

  UNIQUE (cache\_kind, cache\_key),

  \-- student\_id MUST be non-null for teaching\_profile kind; optional for others  
  CONSTRAINT tutor\_vertex\_context\_cache\_student\_id\_required  
    CHECK (  
      (cache\_kind \!= 'teaching\_profile' OR student\_id IS NOT NULL)  
    )  
);

CREATE INDEX idx\_tutor\_vertex\_context\_cache\_expiry  
  ON tutor\_vertex\_context\_cache (expires\_at)  
  WHERE invalidated\_at IS NULL;

CREATE INDEX idx\_tutor\_vertex\_context\_cache\_invalidated  
  ON tutor\_vertex\_context\_cache (invalidated\_at, vertex\_cached\_content\_name)  
  WHERE invalidated\_at IS NOT NULL;

\-- V4 addition: partial index for student-scoped invalidation queries  
CREATE INDEX idx\_tutor\_vertex\_context\_cache\_student  
  ON tutor\_vertex\_context\_cache (student\_id, cache\_kind)  
  WHERE student\_id IS NOT NULL AND invalidated\_at IS NULL;

**Rationale for V4 schema change (SWE-V3-05):** V3 schema had no `student_id` column; deletion on account purge required parsing `cache_key` strings. `ON DELETE CASCADE` now handles deletion cleanly. For cache kinds that aren't student-scoped (system\_prompt, canonical\_question), the column is NULL and unused.

Invalidated rows are kept briefly (24 hours) to allow cleanup of Vertex-side resources before final row deletion.

**Cleanup:**

SELECT cron.schedule(  
  'tutor\_vertex\_cache\_cleanup',  
  '0 \* \* \* \*',  \-- hourly  
  $$DELETE FROM tutor\_vertex\_context\_cache  
    WHERE invalidated\_at IS NOT NULL AND invalidated\_at \< now() \- interval '24 hours';$$  
);

## **§27F Summary of V3 Table Changes**

| Table | Action | Rationale |
| ----- | ----- | ----- |
| `tutor_context_config` | Renamed to `tutor_context_runtime_config` | 01A §8 naming convention |
| `tutor_context_config_history` | Renamed to `tutor_context_runtime_config_history` | Same |
| `tutor_error_codes` | Retained (V2 new) | LISA-specific, not in 01A |
| `tutor_abuse_scores` | **Deleted** | Consumes 01A `abuse_scores` (01A §55); no duplication |
| `tutor_inference_cache` | Moved Redis→Postgres | Stack consistency per §12A.2 |
| `tutor_vertex_context_cache` | New in V3 | LISA-specific Vertex AI mapping (§12B.5) |
| `abuse_score_incidents` (01A §55) | Consumed, not owned | Platform-wide incident ledger; `tutor_injection_log` remains LISA-specific forensic detail per 03A V3 §12.8 dual-write |

## **§27G Partitioning Strategy for High-Volume Tables (hardening item)**

Three tables grow at rates high enough to warrant partitioning in production: `tutor_messages`, `tutor_injection_log`, and `tutor_instruction_assignments`. V3 specifies the partitioning strategy; V2 did not.

**Volume estimates (launch \+ 6 months):**

* `tutor_messages`: \~200 messages/day/active-student × 10k active students × 6 months ≈ 360M rows  
* `tutor_injection_log`: \~5 events/day/active-student × 10k active students × 6 months ≈ 9M rows  
* `tutor_instruction_assignments`: \~100 assignments/day/active-student × 10k active students × 6 months ≈ 180M rows

Without partitioning, these tables become expensive to index, vacuum, and query at time-range scale.

**Partition scheme: monthly native Postgres partitions.**

\-- Convert existing tables to partitioned in staging; production migration per Doc 01.2 runbook  
ALTER TABLE tutor\_messages  
  \-- converted to PARTITION BY RANGE (created\_at) with monthly partitions  
  \-- pseudo — actual migration requires table recreation in Postgres \<13; CREATE TABLE PARTITION OF  
;

\-- Monthly partition creation via cron job (creates N+1 and N+2 ahead):  
CREATE TABLE tutor\_messages\_2026\_04 PARTITION OF tutor\_messages  
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE tutor\_messages\_2026\_05 PARTITION OF tutor\_messages  
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');  
\-- ...

**Retention via partition drop:**

* Per V8 §40 and 03A V3 §17.3: retention matrix defines per-table age limits  
* `tutor_messages` \+ `tutor_instruction_assignments`: 90 days post-conversation-close \+ 7-day soft-delete window ≈ 100 days effective retention for most conversations  
* `tutor_injection_log`: 180 days per 03A V3 §17.3  
* Dropping old partitions (`DROP TABLE tutor_messages_2025_04`) is O(1) vs `DELETE WHERE created_at < ...` which is slow on large tables

**V1 launch decision:**

Partition scheme documented in spec. Actual migration from non-partitioned to partitioned can happen pre-launch (clean slate) or post-launch (planned maintenance window). Launch-blocking: partition scheme must be validated against expected growth; post-launch migration blocker is before any of the three tables exceeds 50M rows.

**V2 target:** automated monthly partition creation cron (creates next 2 months ahead, drops partitions beyond retention window). Procedure in Doc 01.2 runbook.

## **§27H Relationship to Doc 01 V8 Quota Counters**

03B consumes 01A Part V `RateLimitLedger` for quota counting. The underlying table is 01A `rate_limit_ledger` (01A §41), not a tutor-specific table.

**V2 referenced `student_usage_counters` (Doc 01 V8 pending).** V3 supersedes this — 01A Part V is now canonical and V8 §27.3 entitlement check references 01A `abuse_scores` \+ 01A `rate_limit_ledger` directly. No separate `student_usage_counters` table is needed.

---

# **Part XVIII — Hardening (V4 Template, V4.1 patches)**

V3 established the hardening template; V4 extended with target rates, rollback fields, and all review closeouts; V4.1 refined the advisory-lock idempotency honesty, guardian-visibility rules, and invalidate-then-delete cache pattern. This Part will subsequently roll to V8, 01A, and 03A in consolidated hardening pass.

## **§28 Failure Mode Matrix (per primitive)**

Consolidated view of every primitive with a concrete failure posture. Each row answers: when this fails, what happens to the user, how do we recover, what do we alert on, and what is the expected baseline rate.

V4 adds **Target rate** column (SWE-V3-01 closeout) — baseline expected rate for each failure mode. Makes alert thresholds actionable rather than decorative.

### **28.1 V8 Entitlement (§3.2)**

| Failure | Target rate | Behavior | Retry | Alert threshold | User impact |
| ----- | ----- | ----- | ----- | ----- | ----- |
| V8 DB unreachable | \~0 | `CacheUnavailableError` → 503 | Client retries | Page at any sustained | "Verifying your account" |
| V8 timeout (\>200ms) | \<0.01% | 503 | Client retries | Page at \>1% | Same |
| `AbuseScoreUnavailableError` | \<0.01% | 503 per V8 fail-closed | Client retries | Page at \>0.1% | Same |
| V8 `canAccessFeature` returns `deny` | 1-5% of requests (Free-tier users, expired entitlements) | 403 with mapped error code | N/A | Warn if sudden spike (\>2× baseline) | Specific message per §3.2.1 table |
| Abuse tier \= critical | \<0.1% of requests | 403 `account_under_review` | N/A | Warn at \>1% (classifier drift) | Generic "contact support" per 01A §57 |

### **28.2 01A Idempotency (§14 — V4 extension per §13.7)**

| Failure | Target rate | Behavior | Retry | Alert threshold | User impact |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `IdempotencyConflictError` (different content) | \<0.1% | 409 | Client uses new UUID | Warn at \>1% (client bug) | "Use a fresh message ID" |
| `IdempotencyInProgressError` (concurrent retry) | \<0.5% (brief retries expected) | 409 with `retry_after_ms` | Client waits | Info; investigate \>2% | Brief wait |
| `ConcurrentRetryError` (V4 new — advisory lock busy) | \<0.1% | 409 with short retry | Client waits 500ms | Info; investigate \>0.5% | Very brief wait |
| Stuck `pending` past 60s (V4 — §13.7) | \~0 | Orphan cleanup; next attempt re-owns | Server-internal | Page at \>1/min | Transparent after recovery |
| Stuck `in_progress` past 5min (01A §35) | \~0 | 01A §35 stuck-record recovery → fresh attempt | Server-internal | Warn | Transparent |
| 01A DB write fails | \~0 | 500 via 01A error class | Client retries | Page at any | "Try again in a moment" |

### **28.3 01A Rate Limiting (§15)**

| Failure | Target rate | Behavior | Retry | Alert threshold | User impact |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `RateLimitExceededError` (burst or quota) | 1-5% of requests (expected; user-driven) | 429 with `Retry-After` | Client honors retry-after | Info (expected); investigate \>10% | "Slow down" or "Quota reached" |
| 01A DB unreachable | \~0 | `RateLimitCheckUnavailableError` → 503 fail-closed | Client retries | Page at any | "Verifying your account" |
| Bucket misconfigured in `rate_limit_runtime_config` | 0 (bootstrap blocker) | `MissingRequiredConfigError` at bootstrap | Server won't start | Page at deploy time | Deployment blocker |

### **28.4 01A Abuse Score (§15.7-§15.9)**

| Failure | Target rate | Behavior | Retry | Alert threshold | User impact |
| ----- | ----- | ----- | ----- | ----- | ----- |
| Score compute job fails | \<1% of scheduled runs | Previous score cache continues serving | Next batch retries | Warn at \>5% | None immediate |
| Real-time recompute fails (sev ≥ 4 incident) | \<1% of sev-4+ incidents | Event logged; score not updated | Ops investigates | Page if queue backs up | Mild score lag (minutes) |
| `abuse_scores` read fails | \~0 | V8 fail-closed → 503 | Client retries | Page at any | "Verifying your account" |
| `recordIncident` write fails | \<0.1% of incidents | Emit to DLQ; ledger catches up | Retry from DLQ | Page if DLQ \>100 items | None immediate |

### **28.5 01A Part III Caching (per cache, §12B)**

| Cache | Target stale rate | Fail behavior | Alert threshold |
| ----- | ----- | ----- | ----- |
| Conversation ownership (§12B.2) | \<5% | Hard staleness 300s → 503 | Page past bound |
| Live exam (§12B.3) | \<1% (INV-03-02 sensitivity) | Hard staleness 60s → 503 | Page past bound |
| Memory summary (§12B.6) | \<5% | Hard staleness 900s → partial context | Warn past bound |
| Canonical question (§12B.7) | \<0.1% (effectively immutable) | Hard staleness 48h (V4 per SWE-V3-04) → 503 (rare) | Page past bound |
| Runtime config (§12B.8) | 0 (event-driven) | Bootstrap failure → `MissingRequiredConfigError` | Page at deploy |
| Error codes (§12B.9) | 0 | Bundled defaults fall back | Warn |

### **28.6 01A Internal Auth (§19.5)**

| Failure | Target rate | Behavior | Retry | Alert threshold | User impact |
| ----- | ----- | ----- | ----- | ----- | ----- |
| Signature mismatch | \<0.01% per service pair | 401 at receiving service | Caller investigates | Page at \>1% (compromise signal) | Internal request fails (not user-facing) |
| Timestamp skew \> 5 min | \<0.1% | 401 | Caller retries with fresh timestamp | Warn at \>1% | Same |
| Secret rotation in flight | 0 failures (overlap absorbs) | 14-day overlap absorbs | N/A | Info | Transparent |
| Emergency revoke | Brief spike (\<1 hour) | Brief 401s then recovery | Caller picks up new secret | Page at trigger | Internal ops only |

### **28.7 03C Orchestrator / Vertex AI (§13)**

| Failure | Target rate | Behavior | Retry | Alert threshold | User impact |
| ----- | ----- | ----- | ----- | ----- | ----- |
| Vertex 429 (platform RL) | \<0.1% | 03B maps to 503 `service_degraded` with backoff | Client retries | Page at \>1% | "Busy, try again" |
| Vertex 500 | \<0.1% | 03B maps to 503 `orchestration_failed_recoverable` | Client retries same `client_turn_id` | Page at \>5% | Same |
| Vertex timeout (\>8s) | \<1% | 03B maps to 503 | Client retries | Page at \>2% | Same |
| Vertex unavailable (full outage) | Bounded by Vertex SLA (\~43min/month) | 100% turn failures | Status page update | Page immediate | LISA unavailable |
| Context cache miss (unexpected) | 10-30% (first turn of day) | Uncached call proceeds | N/A | Info at \>50% | Higher cost, slight latency |
| Inference result cache miss on retry | 10-30% of retries | Full re-inference | N/A | Info | Higher cost |

### **28.8 03B Persistence Writes (§13)**

| Failure | Target rate | Behavior | Retry | Alert threshold | User impact |
| ----- | ----- | ----- | ----- | ----- | ----- |
| Student message write fails (step 1\) | \<0.01% | 500 `canonical_write_failed` | Client retries | Page at any | "Try again" |
| Tutor message write fails (step 5\) | \<0.01% | Store in inference cache; 500 | Client retries; inference cache absorbs re-inference cost | Page at any | "Try again" — transparent recovery on next attempt |
| Non-blocking write fails (step 6, 7\) | \<0.1% | Log; turn succeeds | Ops reconciles | Warn at \>1% | None |
| DB primary failover | \~0 (planned events only) | Brief 503 spike; 01A reconnection logic catches up | Retry within seconds | Page at trigger | Brief interruption |

## **§28A Per-Endpoint Operational Contract cards**

Every public endpoint has an explicit operational contract. This mirrors the per-section operational contracts (§3.3, §3.4, §14, §15, §19) and consolidates for ops visibility.

### **28A.1 POST /api/tutor/conversations**

* **Purpose:** Start or reuse conversation (§5)  
* **Fail posture:** Fail-closed on any DB/infrastructure failure  
* **P95 target:** 200ms (no orchestration)  
* **Timeout:** 2000ms hard ceiling  
* **Retry:** Safe to retry (idempotent via reuse rule)  
* **Fallback:** None (lightweight; no degraded mode)  
* **Degraded mode:** 503 to client  
* **Rollback (V4):** V4→V3 clean — no handler changes between V3 and V4 for this endpoint; revert deployment per §28B.6 blue-green  
* **Dependencies:** V8 entitlement, Postgres  
* **Owner:** 03B

### **28A.2 POST /api/tutor/messages**

* **Purpose:** Append turn, invoke orchestration, persist response (§6, §13)

* **Fail posture:** Fail-closed; retry-safe for partial failure via idempotency

* **P95 target:** 5000ms (including orchestration)

* **Timeout:** 8000ms P99 \+ 2000ms buffer \= 10s hard ceiling

* **Retry:** Required with same `client_turn_id`; state machine per §14

* **Fallback:** Inference cache on persistence failure after orchestration (§12B.4)

* **Degraded mode:** 503 on Vertex outage; 503 on entitlement service outage

* **Rollback (V4.1):** Distinguishes schema-migration safety from behavioral-change safety.

   *Schema migrations are additive and safe to roll back:* `idempotency_records.status = 'pending'` enum value, `tutor_vertex_context_cache.student_id` column. Leaving them in place after rollback is harmless; they are not consumed by V3 handler paths.

   *Behavioral changes include breaking impacts for subsets of users:*

  * Rolling back §15.10 child-user override means minor students (age 13-15) currently using the bypass path will receive `account_under_review` denial on their next turn. For students in the 81-90 abuse-score band, this is a service loss. Recommended mitigation before rollback: ops runs an inventory query (`SELECT DISTINCT student_id FROM audit_log WHERE event = 'tutor_minor_lockout_bypass' AND created_at > now() - interval '7 days'`) and either (a) manually adjusts those students' scores downward via 01A §56 `adjustScore` to remove the lockout trigger, or (b) flags the rollback to support for per-student outreach.  
  * Rolling back the §13.7 two-phase idempotency pattern reintroduces the BLK-V3-01 orphan condition (legitimate retries get 409 during partial handler failure). Not user-visible corruption but degrades retry UX.  
  * Rolling back the §12B.5.1 write-through Vertex invalidation reintroduces the BLK-V3-03 staleness race. Bounded by Vertex TTL (1h for teaching\_profile) but user-observable in edge cases.  
* *Rollback posture:* emergency-only. Manual user-impact mitigation (inventory \+ per-student intervention) recommended for §15.10 regression. Deploy pipeline requires an explicit flag (`--allow-behavioral-regression`) for rollback past the V4→V3 boundary.

* **Dependencies:** V8 entitlement, 01A idempotency, 01A rate limit, 01A abuse, 03A context, 03C orchestration, Vertex AI, Postgres

* **Owner:** 03B

### **28A.3 GET /api/tutor/conversations/:id**

* **Purpose:** Fetch conversation with paginated messages (§7)  
* **Fail posture:** Fail-closed  
* **P95 target:** 300ms  
* **Timeout:** 2000ms  
* **Retry:** Safe to retry (read-only)  
* **Fallback:** None  
* **Degraded mode:** 503  
* **Rollback (V4):** V4→V3 clean — no handler changes; revert deployment per §28B.6 blue-green  
* **Dependencies:** V8 entitlement, Postgres  
* **Owner:** 03B

### **28A.4 GET /api/tutor/conversations**

* **Purpose:** List recent conversations (§8)  
* **Fail posture:** Fail-closed  
* **P95 target:** 250ms  
* **Timeout:** 2000ms  
* **Retry:** Safe to retry  
* **Fallback:** None  
* **Degraded mode:** 503  
* **Rollback (V4):** V4→V3 clean — no handler changes; revert deployment per §28B.6 blue-green  
* **Dependencies:** V8 entitlement, Postgres  
* **Owner:** 03B

### **28A.5 POST /api/tutor/conversations/:id/close**

* **Purpose:** Close or abandon conversation (§9)  
* **Fail posture:** Fail-closed; retry-safe (state machine idempotency per §14.5)  
* **P95 target:** 150ms  
* **Timeout:** 1000ms  
* **Retry:** Safe (409 on repeat is expected)  
* **Fallback:** None  
* **Degraded mode:** 503  
* **Rollback (V4):** V4→V3 clean — no handler changes; revert deployment per §28B.6 blue-green  
* **Dependencies:** Postgres  
* **Owner:** 03B

## **§28B Cloud Run Operational Contract**

Covers deployment sizing, autoscaling behavior, graceful shutdown, and regional topology implications.

### **28B.1 Instance sizing**

V1 launch target:

* **CPU:** 2 vCPU per instance  
* **Memory:** 2 GiB per instance (headroom for in-process caches — runtime config, error codes, single-flight in-flight map, tutor\_injection\_signatures)  
* **Concurrency per instance:** 80 (Cloud Run default); tune based on observed P95 and memory pressure  
* **Cold start target:** \<3 seconds from request → accepting (includes 01A §3 bootstrap)

**Cold-start CI gate (V4 closeout of NTH-V3-03):**

* Weekly synthetic traffic triggers cold-start measurement: N=30 fresh instances instantiated; P50/P99 boot-to-accept latency recorded  
* Baseline captured at each release; regressions detected  
* **CI gate:** cold-start P99 regression \>20% over 4-week baseline blocks next deploy (deploy pipeline queries metric; deploy paused with alert; ops investigates)  
* Rationale: cold-start is user-visible during scale-up bursts; uncontrolled regression degrades P99 across the fleet  
* Measurement method: synthetic `POST /api/tutor/health-check` from outside region, forcing Cloud Run routing to a fresh instance; captures boot overhead separately from warm-path

V2 target: dedicated warm-up endpoint that pre-populates runtime config cache before Cloud Run routes traffic.

### **28B.2 Autoscaling configuration**

* **Minimum instances:** 1 (Cloud Run min-instances; keeps one warm at all times to absorb first-request latency)  
* **Maximum instances:** 100 (V1 ceiling; scales higher via Cloud Run quota increase if traffic demands)  
* **Scale-up trigger:** concurrent requests per instance \> 80%  
* **Scale-down delay:** 15 minutes of low utilization before instance termination  
* **Regional:** single-region V1 (us-central1); multi-region V2 target

### **28B.3 Graceful shutdown**

* Cloud Run sends SIGTERM to terminating instance  
* Application handler catches SIGTERM:  
  1. Stop accepting new requests (return 503 on new incoming)  
  2. Allow in-flight requests up to 10 seconds to complete  
  3. Close LISTEN connection cleanly (release pooler slot)  
  4. Flush any buffered metrics/logs  
  5. Exit cleanly  
* Cloud Run SIGKILL after 10 seconds if still running

### **28B.4 LISTEN/NOTIFY connection budget (V4 closeout of AMB-V3-04)**

**Assumption:** Supabase Team tier, 400 pool connections total.

**Allocation (V4 spec):**

* Session-mode pool: 150 connections (for LISTEN subscribers — cannot multiplex)  
* Transaction-mode pool: 200 connections (for query traffic — multiplexed)  
* Reserve: 50 connections (maintenance, admin, migration tools)

**Per-instance demand:**

* 1 LISTEN connection (session-mode) — persistent  
* 5-10 query connections (transaction-mode) — multiplexed through pgbouncer

**Max supportable instances:**

* LISTEN is binding constraint: 150 / 1 \= **150 instances max** at current tier  
* V1 Cloud Run max (§28B.2): 100 instances. Fits with 50-connection (50%) buffer.

**Scaling trigger points:**

* 80 active LISTEN connections (80 instances): Info alert; within normal operation  
* 120 active LISTEN connections (120 instances / 80% of session-mode pool): Warning alert; evaluate upgrade path  
* 140 active LISTEN connections (93% of session-mode pool): Page alert; at cap imminent

**Scaling options when binding constraint approaches:**

* Option A: Upgrade Supabase tier (Team → Enterprise, expanded pools)  
* Option B: Dedicated pgbouncer deployment (+ architectural investment)  
* Option C: Migrate to Google Cloud Pub/Sub for cache invalidation, eliminating per-instance LISTEN connections entirely (V2 architectural target per §28B.5)

**Monitoring:**

* `postgres_listen_connection_count_active` — total active LISTEN connections across all instances  
* `postgres_listen_connection_reconnect_rate` — per §22.12 SLI  
* Pooler dashboards track both session-mode and transaction-mode utilization  
* Alert thresholds per §22.6 (V4 adds specific thresholds for LISTEN pool)

### **28B.5 Region topology implications**

**V1 single-region:**

* All instances, Postgres primary, Vertex AI region all in us-central1  
* Latency: \~0-5ms instance↔Postgres; \~30-100ms instance↔Vertex  
* Risk: regional outage takes down LISA entirely

**V2 multi-region targets:**

* Instance replication to eu-west1, asia-southeast1  
* Postgres read replicas per region (writes still to primary)  
* Vertex AI multi-region routing  
* Risk: consistency across regions (especially rate limit counters — 01A §41 single-primary authoritativeness)

### **28B.6 Deployment rollout strategy**

* Blue-green deployment via Cloud Run revisions  
* New revision deployed alongside old  
* Traffic shifted in stages: 10% → 50% → 100% over 30 minutes  
* Automatic rollback if SLI degradation detected (error rate \>2× baseline, P95 \>1.5× baseline)  
* Revision history retained for 7 days for rapid rollback

### **28B.7 Secret rotation during deployment**

* Per §19.5-19.6, service auth secrets rotate on 90-day cadence with 14-day overlap  
* Deployment picks up new secrets from `service_auth_secrets` table at bootstrap  
* No secret environment-variable injection — all secrets read from Postgres at bootstrap

## **§28C Isolation Level Statements per DB Interaction**

Hardening template includes explicit isolation level per DB interaction. V3 specifies; V2 did not.

**Default:** READ COMMITTED (Postgres default). Appropriate for most tutor operations where stale reads are acceptable within the request window.

**Explicit overrides:**

| Operation | Isolation level | Rationale |
| ----- | ----- | ----- |
| Student message INSERT (step 1\) | READ COMMITTED | Standard insert; no read dependency |
| Student message INSERT \+ assignment INSERT (steps 1+2) | READ COMMITTED inside single txn | Atomic write pair; no cross-row correctness issue |
| Tutor message INSERT \+ links \+ exposures (steps 5-7) | READ COMMITTED inside single txn | Same |
| Conversation ownership read (§3.3) | READ COMMITTED | Cache fallback read; staleness bounded by hard staleness window |
| Entitlement check (delegated to V8) | V8-owned | V8 §27.3 may specify SERIALIZABLE for score tier read; 03B doesn't override |
| Rate limit check (delegated to 01A) | REPEATABLE READ per 01A §41 | Atomic check-and-increment correctness |
| Idempotency check (delegated to 01A) | SERIALIZABLE per 01A §33 | Content hash conflict detection |
| Conversation status update (§9 close) | REPEATABLE READ | Single-row compare-and-update; protects against concurrent close requests |
| Vertex context cache mapping UPSERT | READ COMMITTED | Last-writer-wins on cache invalidation; race OK |

**Not using SERIALIZABLE by default:**

Postgres SERIALIZABLE has retry overhead on conflicts. LISA's workload has high read/write volume per turn; SERIALIZABLE globally would degrade P95. Explicit SERIALIZABLE for genuinely serializable operations only (per 01A §33 idempotency conflict detection).

**Operational signal:** `postgres_serialization_failure_rate` metric per endpoint. Alert if sustained \>0.1% — indicates either contention hotspot or inappropriate isolation level choice.

---

# **Part XIX — Legal Hold, Export, and Backup Integration (hardening item)**

## **§29 Legal Hold / Export / Backup Integration**

LISA interacts with student data retention and purge. V3 specifies how 03B's tutor tables integrate with V8 §40 account deletion and V8 §39 legal hold.

### **29.1 Account deletion — V8-initiated**

Per V8 §40, when a user account is marked for deletion:

1. V8 creates a soft-delete record with 7-day purge window  
2. During 7-day window: account disabled; LISA requests blocked at entitlement (`deleted_account` reason → 403\)  
3. At 7 days: V8 triggers hard delete across all tables

03B's responsibility at hard delete:

* All `tutor_conversations` where `student_id = $deleted` → cascade delete via FK  
* All `tutor_messages` → cascade delete via FK to conversations  
* All `tutor_instruction_assignments`, `tutor_question_links`, `tutor_instruction_exposures` → cascade delete  
* All `tutor_memory_summaries` → cascade delete  
* All `tutor_injection_log` rows → cascade delete  
* All `tutor_inference_cache` rows → cascade delete (short TTL usually clears first)  
* All `tutor_vertex_context_cache` rows for `(student_id, teaching_profile)` key kind → cascade delete \+ explicit Vertex-side `CachedContent` deletion

**Vertex-side cleanup:** when purging student-scoped Vertex cached content, 03B issues `CachedContent.delete` calls to Vertex. Failure to delete Vertex-side is logged but not blocking — Vertex content eventually expires on its own 24h TTL.

### **29.2 Legal hold**

Per V8 §39, a student may be placed on legal hold by ops for compliance/litigation reasons. Legal hold prevents deletion.

03B integration:

* LISA continues to function normally under legal hold (student can still use LISA)  
* Deletion of any tutor-scoped row is blocked by V8 §39 `legal_hold_active(student_id)` check  
* FK cascade delete on account deletion respects legal hold: if `legal_hold_active = true`, deletion fails with specific error; ops resolves per V8 §39 runbook

### **29.3 Data export (V8 §41)**

When a student requests data export per V8 §41:

* V8 orchestrates the export  
* 03B contributes: conversations \+ messages (full text), question links, memory summaries, exposures, injection log (only if not security-sensitive — safety review queue items excluded per INV-03-15)  
* Raw `tutor_inference_cache` and `tutor_vertex_context_cache` NOT exported (they're caches, not user data)  
* Raw `reason_snapshot`, `policy_variant`, scanner block logs NOT exported (internal observability; not user data)

### **29.4 Backup purge policy**

Per V8 §42 backup retention:

* Postgres full backups retained 30 days  
* Account deletion → backups containing the deleted account also purged per 30-day cycle  
* 30-day window \= max window where deleted student data could still exist in backups  
* Legal hold extends backup retention indefinitely for relevant rows

**Operational Contract for §29:**

* **Fail posture:** fail-safe (deletion errors block deletion; don't silently skip)  
* **Timeout:** deletion is async; per-table timeouts documented in V8 §40  
* **Retry:** V8 owns retry cadence  
* **Fallback:** failed deletion queued for manual review  
* **Degraded mode:** brief delay in deletion completion (minutes to hours in worst case)  
* **Owner:** V8 for overall orchestration; 03B for tutor-table cascade behavior and Vertex-side cleanup

---

# **Change Records**

Lyceon change record convention: prefix `CR-03B-<version>-<number>`. V4 introduces fresh numbering under `CR-03B-V4-NN` for the review closeout. V3 records (CR-03B-V3-01 through V3-25) are preserved in V3 file archive. V1+V2 records (CR-03B-01 through CR-03B-30) are preserved in V2 file archive.

Each CR is tagged with change class and migration requirement flags (V4 closeout of SWE-V3-06):

* `[BREAKING]` — changes client-observable API contract or handler semantics  
* `[ADDITIVE]` — adds capability without breaking existing consumers  
* `[REFACTOR]` — internal reorganization; no observable change to consumers  
* `[MIGRATION-REQ]` — requires coordinated change at deploy  
* `[SCHEMA-MIGRATION]` — requires DB schema change  
* `[NO-MIGRATION]` — safe to deploy without coordinated migration

**CR-03B-V4-01** `[REFACTOR][SCHEMA-MIGRATION]` — BLK-V3-01 **partial** closeout (amended in V4.1 per BLK-V4-01 review). §13.7 \+ §14 rewritten to specify two-phase idempotency \+ transaction nesting pattern. 01A `IdempotencyService` nests with §13 step transactions via advisory-lock-based pattern: `reservePending` creates idempotency\_records in new `pending` status (outside caller txn), handler acquires `pg_try_advisory_xact_lock` on hash of `client_turn_id` inside steps 1-2 transaction, UPDATE to `in_progress` is atomic with step 1 insert via `UPDATE ... WHERE status = 'pending' RETURNING id` (rowCount \=== 0 → ConcurrentRetryError). Phase 4 (steps 5-7) uses `complete(tx, recordId, result)` to participate in caller txn. **What this achieves:** (a) clean pending → in\_progress transition — no orphan `in_progress` from steps 1-2 rollback; (b) concurrent retry serialization — silent duplicate writes impossible. **What this does NOT achieve:** handler crash after steps 1-2 commit but before phase-4 completion still leaves record stuck in `in_progress` until 01A §35 stuck-record recovery timer (5 min). This 5-minute residual orphan window is acceptable for V1 (Cloud Run crash rates \<0.1%) but not eliminated. Full elimination requires 01A V1.1 `runInTransaction` variant that defers idempotency\_records insert into caller transaction. New SLIs: `idempotency_orphan_pending_rate`, `idempotency_stuck_in_progress_rate` (V4.1 — the latter tracks the residual window). Upstream requirement flagged for 01A V1.1: add `reservePending`, `complete(tx, id, result)`, `markFailed(id, err)` interface methods; extend status enum with `pending`. **Deploy coordination (V4.1 — SWE-V4-03):** 01A V1.1 ships first (backward-compatible understanding of `pending`), then 03B V4.1. Reverse order accumulates `pending` rows that 01A V1 stuck-record recovery does not see. Until 01A V1.1 ships, 03B implements inline via raw DB ops on `idempotency_records` — tolerated deviation from §1.10 owned-once principle, documented.

**CR-03B-V4-02** `[ADDITIVE][SCHEMA-MIGRATION]` — BLK-V3-02 closeout (Option C). §15.10 child-user sensitivity moved to 03B-local pre-check wrapper around V8 `canAccessFeature`. V3 had specified the rule as if V8 enforced it; V8 V8 does not. V4 implements: if V8 returns `deny` with reason `abuse_score_lockout`, 03B checks `profiles.age_years`; if age \< 16 and score ≤ 90, 03B overrides to allow \+ emits audit event. Score ≥ 91 still denied. Quota multipliers at other tiers unaffected. §15.10.1-§15.10.4 document metrics, migration path, rate-limit interaction, safety net. V8 §27.3 upstream migration flagged for consolidated hardening pass; 03B pre-check is tolerated short-term duplication. New 01A V1.1 requirement: `rate_multiplier_override` hint in `RateLimitLedger.checkAndIncrement` for bypass-path effective multiplier.

**CR-03B-V4-03** `[REFACTOR][SCHEMA-MIGRATION]` — BLK-V3-03 closeout (amended in V4.1 per SWE-V4-02). §12B.5 Vertex context cache invalidation reworked. V4 initially switched from write-then-notify to write-through (Vertex delete before Postgres commit). V4.1 review identified a new race: concurrent orchestrator cache creation during the writer's Phase 1-3 window could produce orphaned or incorrectly-invalidated rows. V4.1 final pattern is **invalidate-then-delete**: (Phase 1 inside Postgres txn) mark mapping row `invalidated_at = now()` and insert new teaching\_profile row atomically, with version filter to exclude concurrently-inserted newer rows; (Phase 2 outside txn, post-commit) delete Vertex `CachedContent` best-effort. Mapping `invalidated_at IS NOT NULL` is the source of truth for "don't use this cache"; concurrent orchestrator reads see the invalidation marker and create fresh caches without racing the deleter. Bounded staleness documented: ≤ 1h teaching\_profile, ≤ 24h system\_prompt and canonical\_question (capped by Vertex provider TTL). New SLI `teaching_profile_staleness_lag_minutes` (target \<5 min, alert \>30 min). §12B.5.2 staleness contract table. §12B.5.5 savings projection hedged in V4.1 (AMB-V4-03) — range $5-30k/yr at V1 launch scale vs V4's optimistic single-point $27k/yr. §29 account deletion integration updated.

**CR-03B-V4-04** `[ADDITIVE][NO-MIGRATION]` — AMB-V3-01 closeout (amended in V4.1 per AMB-V4-01). Every cache entry in §12B now explicitly labeled with canonical tier designation (Tier 1 in-process / Tier 2 Postgres-backed). V4 originally invented "Tier 3" for Vertex provider-side cache; V4.1 removes this to preserve 01A Part III's authoritative two-tier vocabulary. Vertex caches are described as "Vertex provider-side (outside 01A Part III topology)" with no tier number. Per-cache rationale inline: cross-instance-authoritative state (rate limits, idempotency records) → Tier 2; per-student/per-conversation hot-path reads → Tier 1 with Postgres fallback. Removes engineer-guess ambiguity for implementation.

**CR-03B-V4-05** `[ADDITIVE][SCHEMA-MIGRATION]` — AMB-V3-02 closeout. `tutor_messages (conversation_id, client_turn_id)` UNIQUE constraint retained as defense-in-depth in V4 (V3 had dropped it). Rationale: 01A is primary idempotency layer and works correctly in documented scenarios, but hard DB-level uniqueness guarantees correctness under application-layer bugs or cross-instance races during Postgres failover. Cost: one btree index (already exists for lookup path). Violation handler emits high-severity alert and 409\.

**CR-03B-V4-06** `[BREAKING][NO-MIGRATION]` — AMB-V3-03 closeout. §15.3 soft warning quota display decision locked: `limit` and `used` numbers shown to users reflect **effective** (post-abuse-multiplier) values, not base. V3 had left this as an open product question. Rationale: correct user-facing math, bounded tier-inference privacy exposure (score/tier still hidden per 01A §57). `[BREAKING]` only in that client-side any previously-expected behavior showing base values must be updated — V1 launch has no such behavior.

**CR-03B-V4-07** `[ADDITIVE][NO-MIGRATION]` — AMB-V3-04 closeout. §12A.4 \+ §28B.4 Cloud Run LISTEN connection math made explicit. Supabase Team tier (400 connection pool) assumed; session-mode pool 150 / transaction-mode pool 200 / reserve 50\. Binding constraint: session-mode at 150 LISTEN connections → 150-instance cap. V1 Cloud Run max 100 instances fits with 50-connection (50%) buffer. Scaling beyond 150: Option A tier upgrade, Option B dedicated pgbouncer, Option C migrate to Pub/Sub broker (V2 target). Monitoring via new SLI `postgres_listen_connection_count_active`.

**CR-03B-V4-08** `[ADDITIVE][NO-MIGRATION]` — AMB-V3-05 closeout. §27D.1 inference cache cleanup cron cadence justified with steady-state math (\~700 rows at 1M turns/day launch scale; trivial DELETE cost at per-minute cadence). Config key `cache.inference_cleanup_interval_seconds` added for tuning. Post-launch target: 5-minute cadence once backlog proven bounded. Clarifies relationship with §27G partitioning strategy (not applicable to 60s-TTL cache).

**CR-03B-V4-09** `[ADDITIVE][NO-MIGRATION]` — SWE-V3-01 closeout. §28 Failure Mode Matrix — every subsection table now has Target rate column. Baseline ops expectations made explicit rather than implicit in alert thresholds. Alert thresholds calibrated against expected rates (e.g., V8 timeout target \<0.01%, alert at \>1% → 100× the expected rate). Enables ops to tune alerting without guessing baseline.

**CR-03B-V4-10** `[ADDITIVE][NO-MIGRATION]` — SWE-V3-02 closeout. §28A Operational Contract cards — Rollback field added per endpoint. V4→V3 rollback semantics per endpoint documented. POST /api/tutor/messages has detailed rollback note (re-introduces BLK-V3-01 and BLK-V3-03 risks; emergency-only). All V4 schema changes are additive — data migration not required for rollback.

**CR-03B-V4-11** `[ADDITIVE][NO-MIGRATION]` — SWE-V3-03 closeout. §22.12 SLI table organized into 4 named dashboards: (1) Turn Flow Health, (2) Cache Layer Health, (3) Platform Integration, (4) Cloud Run \+ Vertex Topology. Per-dashboard display and review guidance added. Two V4 SLIs added: `idempotency_orphan_pending_rate`, `teaching_profile_staleness_lag_minutes`, `postgres_listen_connection_count_active`.

**CR-03B-V4-12** `[ADDITIVE][NO-MIGRATION]` — SWE-V3-04 closeout. §12B.7 canonical question cache hard staleness shortened from 7d to 48h. Retired-question serve window now bounded at 2 days during DB outage. Balances infrastructure resilience against stale-content serving risk.

**CR-03B-V4-13** `[ADDITIVE][SCHEMA-MIGRATION]` — SWE-V3-05 closeout. §27E `tutor_vertex_context_cache` schema extended with nullable `student_id UUID REFERENCES profiles(id) ON DELETE CASCADE` column and partial index. CHECK constraint: `student_id` non-null required for `teaching_profile` cache\_kind. Enables clean cascade-delete on account purge (§29.1 simplified); replaces V3 pattern of parsing `cache_key` strings.

**CR-03B-V4-14** `[ADDITIVE][NO-MIGRATION]` — SWE-V3-06 closeout. Every V4 CR tagged with `[CLASS][MIGRATION]` flags (see header of this Change Records section). Enables fast scan for downstream readers planning migrations and deployment coordination.

**CR-03B-V4-15** `[REFACTOR][NO-MIGRATION]` — NTH-V3-01 closeout. §16.0 V4 alignment preface added. §16 anti-leak content confirmed V2-aligned and consistent with V3/V4 hardening direction; no substantive changes required.

**CR-03B-V4-16** `[ADDITIVE][NO-MIGRATION]` — NTH-V3-02 closeout (hedged in V4.1 per AMB-V4-03). §12B.5.5 Vertex cache savings projection. V4 provided single-point figures ($27k/yr at V1 launch, $270k/yr at 10×, $2.7M/yr at 100×) assuming 50% input token savings and fixed input token cost. V4.1 revises to ranged estimate: context-cached tokens bill at reduced rate (\~25% of regular), output tokens uncached, net total Vertex cost reduction \~15-30% at steady state. V4.1 range: **$5-30k/yr at V1 launch scale**, widening to $50-300k at 10× and $500k-3M at 100× growth. Single-point figures removed; post-launch actuals required for precision.

**CR-03B-V4-17** `[ADDITIVE][NO-MIGRATION]` — NTH-V3-03 closeout. §28B.1 cold-start CI gate requirement added. Weekly synthetic traffic measurement (N=30 fresh instances); cold-start P99 regression \>20% over 4-week baseline blocks next deploy. Deploy pipeline queries metric; ops investigates. Measurement method: synthetic `POST /api/tutor/health-check` from outside region forcing fresh-instance routing.

**CR-03B-V4-18** `[REFACTOR][NO-MIGRATION]` — §27F V3/V4 table change summaries consolidated at §27A footer. V4 additions documented: `tutor_messages` UNIQUE retained, `tutor_vertex_context_cache.student_id` added, `idempotency_records.status` extended with `pending` (pending 01A V1.1 upstream migration).

---

**V4.1 patch records (BLK-V4, AMB-V4, SWE-V4, NTH-V4 closeouts):**

**CR-03B-V4.1-01** `[REFACTOR][NO-MIGRATION]` — BLK-V4-01 closeout. §13.7 rewritten for honesty. V4 claimed "eliminates orphaned in\_progress records"; V4.1 acknowledges the pattern reduces-but-does-not-eliminate: concurrent retry serialization is achieved, but handler crash after steps 1-2 commit still leaves record stuck in `in_progress` for up to 01A §35 stuck-record recovery timer (5 min). New SLI `idempotency_stuck_in_progress_rate` tracks this residual window. Full elimination requires 01A V1.1 `runInTransaction` variant. CR-03B-V4-01 amended.

**CR-03B-V4.1-02** `[ADDITIVE][NO-MIGRATION]` — BLK-V4-02 closeout. §15.10.5 added: guardian visibility rule for bypass events. Guardians MUST NOT see student abuse score, tier label, §15.10 bypass events, or aggregate signals derived from these. Extends 01A §57 no-visibility posture from student to guardian. Canonical audience-access table added. New SLI `tutor_minor_bypass_guardian_surface_violation` (target rate 0; alerts any non-zero). Rule must be carried forward when V8 §27.3 absorbs age-conditional tier adjustment in consolidated hardening pass.

**CR-03B-V4.1-03** `[REFACTOR][NO-MIGRATION]` — AMB-V4-01 closeout. "Tier 3" label removed from §12B. Vertex provider-side cache (§12B.5) renamed as outside 01A Part III's two-tier topology, not as a "Tier 3" extension. Preserves 01A Part III's authoritative vocabulary. CR-03B-V4-04 amended.

**CR-03B-V4.1-04** `[REFACTOR][NO-MIGRATION]` — AMB-V4-02 closeout. §28A.2 POST /api/tutor/messages rollback field rewritten to distinguish schema-migration safety from behavioral-change safety. Schema migrations are additive and safe; §15.10 rollback is breaking for minors currently using bypass (recommended mitigation: manual 01A §56 `adjustScore` per affected student). Deploy pipeline requires explicit `--allow-behavioral-regression` flag for V4→V3 rollback.

**CR-03B-V4.1-05** `[REFACTOR][NO-MIGRATION]` — AMB-V4-03 closeout. §12B.5.5 Vertex savings projection hedged. V4 single-point figures ($27k/$270k/$2.7M yr) replaced with ranged estimates ($5-30k/$50-300k/$500k-3M yr) reflecting realistic cached-token pricing (\~25% of regular rate, not 0%) and output-token non-cacheability. Caveats added. CR-03B-V4-16 amended.

**CR-03B-V4.1-06** `[REFACTOR][NO-MIGRATION]` — SWE-V4-01 closeout. §13.7 pseudocode simplified. `reservePending` internally normalizes `failed → pending` on new attempt with matching content hash, so caller has three external branches (`completed-match`, `completed-mismatch`, `in_progress`) plus the `pending` own-it branch. Handler no longer needs to handle `failed` explicitly at call site. Phase 2 UPDATE guard made explicit: `WHERE status = 'pending' RETURNING id; rowCount === 0 → ConcurrentRetryError`.

**CR-03B-V4.1-07** `[REFACTOR][NO-MIGRATION]` — SWE-V4-02 closeout. §12B.5.1 Vertex cache invalidation pattern changed from write-through (V4) to **invalidate-then-delete** (V4.1). Mapping `invalidated_at` is set atomically inside the Postgres transaction with the new teaching\_profile write; Vertex-side delete happens post-commit, best-effort. Concurrent orchestrator reads check `invalidated_at IS NOT NULL` and create fresh caches without racing the deleter. Version-filter refinement on the UPDATE excludes concurrently-inserted newer rows. CR-03B-V4-03 amended.

**CR-03B-V4.1-08** `[ADDITIVE][NO-MIGRATION]` — SWE-V4-03 closeout. CR-03B-V4-01 amended with deploy coordination note: 01A V1.1 must ship first (backward-compatible understanding of `pending` status), then 03B V4.1. Reverse order leaves `pending` rows invisible to 01A V1 stuck-record recovery.

**CR-03B-V4.1-09** `[REFACTOR][NO-MIGRATION]` — NTH-V4-01 closeout. CR-03B-V4-01 honesty pass: amended language reflects BLK-V4-01 analysis (partial closeout, 5-min residual window). Change records match actual achievements.

**CR-03B-V4.1-10** `[REFACTOR][NO-MIGRATION]` — NTH-V4-02 closeout. Residual V3 phrasing swept. Part XVIII header re-confirmed as "V4 Template (V4.1 patches)". No substantive content changes; labeling consistency.

---

# **End of Doc 03B V4.1**

**Canonical for Lyceon platform as of 2026-04-24.**

**Supersedes:** Doc 03B V4.0 (2026-04-24), V3.0 (2026-04-24), V2.0 (2026-04-23), V1.0, prior internal "TUTOR\_API\_AND\_RUNTIME\_FLOW\_CONTRACT" draft.

**Depends on:** Doc 00 Platform Directive, Doc 01 V8, Doc 01A V1, Doc 03 Main V1.1, Doc 03A V3, Doc 02B V4, Doc 02C V4.

**Coordinates with:** Doc 03C (GCP Orchestration — pending V1; consumes 03B §12B.5 Vertex context cache interface and §28A.2 operational contract).

**Next review trigger:** per §25 — Doc 01 V8 entitlement model change, Doc 01A Part III-VII interface change, Doc 03A V3 context envelope change, Doc 03C orchestration interface change, Vertex AI model family change, Cloud Run topology change, or breaking API contract change.

**V4 \+ V4.1 scope summary:**

V4 closed V3 review items: 3 Blockers (idempotency/transaction boundary, child-user sensitivity enforcement gap, Vertex context cache staleness race), 5 Ambiguities, 6 SWE Standard Improvements, 3 Nice-to-Haves. 18 V4 change records.

V4.1 closes V4 review items: 2 new Blockers (BLK-V4-01 idempotency pattern honesty, BLK-V4-02 guardian visibility of bypass events), 3 Ambiguities (Tier 3 nomenclature, §28A.2 rollback honesty, Vertex savings hedge), 3 SWE Standard Improvements (`reservePending` failed-state, write-through race, deploy coordination), 2 Nice-to-Haves (CR-V4-01 honesty, phrasing sweep). 10 V4.1 patch change records.

V3 architectural direction preserved across V4 and V4.1 (rebase onto V8 \+ 01A \+ 03A V3; hardening template). V1 launch scope preserved; no decisions reversed.

**Upstream requirements flagged for consolidated hardening pass (V4.1 final):**

* **01A V1.1 (deploy before 03B V4.1):** Add `IdempotencyService.reservePending`, `complete(tx, id, result)`, `markFailed(id, err)` interface; extend `idempotency_records.status` enum with `pending`. Understand `pending` in stuck-record recovery (backward-compatible with V1 callers). Fully eliminating the 5-min residual orphan window (BLK-V4-01) requires an optional `runInTransaction` variant in a subsequent 01A V1.2.  
* **V8 V9:** Add age-conditional tier adjustment at §27.3 step 7\. Enables removing 03B's pre-check wrapper per §15.10. V8 V9 guardian dashboard spec must carry forward §15.10.5 rule (no guardian visibility of abuse signals).  
* **01A V1.1:** Add `rate_multiplier_override` parameter to `RateLimitLedger.checkAndIncrement`. Enables §15.10's 0.25× fallback multiplier on minor bypass path.  
* **03A V3.1:** Integrate invalidate-then-delete Vertex cache pattern (V4.1 §12B.5.1) into `MemoryRefreshWorker`. V4.1 03B specs the pattern; 03A V3.1 carries the implementation.

**Companion artifacts (not shipped with this doc, scoped separately):**

* Doc 03B.1 Test Matrix — scenario tests per §28 failure matrix \+ V4/V4.1 blocker-fix tests (two-phase idempotency under handler crash, stuck-record recovery integration, child-user override \+ guardian visibility negative tests, invalidate-then-delete concurrent orchestrator race). Owner: Engineering. Target: before launch.  
* Doc 01.2 Operations Runbook — per §19.6 emergency revoke, §27G partitioning migration, §28B deployment rollout, §28A.2 V4→V3 behavioral-regression rollback procedure, §29 deletion flow. Owner: Ops. Target: before launch.

**Hardening template usage:** patterns introduced in V3 and refined in V4/V4.1 (failure matrix with target rates, per-endpoint/per-primitive operational contracts with schema-vs-behavioral rollback distinction, Cloud Run contract with CI gate, isolation-level statements, legal hold integration, child-user sensitivity with explicit audience-access matrix, invalidate-then-delete provider-side cache pattern, two-phase advisory-lock idempotency with honest residual-window acknowledgment) are expected to apply back to V8, 01A, and 03A in the consolidated hardening pass. V4.1 is the mature template; earlier docs will be retrofitted.

**Review posture:** V4.1 is intended for external review and downstream implementation. V4 had 2 blockers that self-review caught before external review; V4.1 resolves them. Ready to ship.

